import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import ffmpegPath from 'ffmpeg-static';

// Video export (docs/DESIGN.md §11). The renderer draws every frame at full
// quality and sends it here, one at a time; this side either pipes raw
// pixels into FFmpeg (MP4, or MOV with ProRes 4444) or writes PNG files. Nothing is ever dropped:
// each frame waits until the previous one has been written.
//
// The soundtrack arrives already mixed, as a WAV file's bytes (the renderer
// mixes it with Web Audio, E5). For MP4 and MOV it goes into a temporary file that
// FFmpeg reads as a second input; for PNG frames it is saved next to them as
// soundtrack.wav.

type Format = 'mp4' | 'hevc' | 'mov' | 'webm' | 'png';

/** The file each video format is saved as. */
const EXTENSIONS: Record<Exclude<Format, 'png'>, { ext: string; name: string }> = {
  mp4: { ext: 'mp4', name: 'MP4 video' },
  hevc: { ext: 'mp4', name: 'MP4 video (H.265)' },
  mov: { ext: 'mov', name: 'QuickTime movie (ProRes 4444)' },
  webm: { ext: 'webm', name: 'WebM video' },
};

interface Session {
  format: Format;
  /** WebM: keep see-through areas. */
  transparent?: boolean;
  path: string;
  width: number;
  height: number;
  ffmpeg?: ChildProcessWithoutNullStreams;
  stderr: string;
  exited?: Promise<number | null>;
  /** Folder holding the temporary soundtrack for FFmpeg. */
  tempDir?: string;
  /** FFmpeg couldn't be started. */
  failed?: boolean;
}

const sessions = new Map<number, Session>();
let nextId = 1;
/** Files and folders exported in this run of the app, which may be shown in Finder or Explorer. */
const exported = new Set<string>();

/** FFmpeg ships inside the app; in a packaged app it lives outside the asar archive. NYAH_FFMPEG overrides it (tests). */
export function ffmpegBinary(): string | null {
  if (process.env.NYAH_FFMPEG) return process.env.NYAH_FFMPEG;
  const p = ffmpegPath as unknown as string | null;
  return p ? p.replace('app.asar', 'app.asar.unpacked') : null;
}

function mp4Args(s: Session, fps: number, soundtrack: string | null): string[] {
  return [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${s.width}x${s.height}`,
    '-r', String(fps),
    '-i', '-',
    ...(soundtrack ? ['-i', soundtrack, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    s.path,
  ];
}

/**
 * MOV with Apple ProRes 4444 (docs/DESIGN.md E3): high quality, and it keeps
 * see-through areas, for layering characters over footage in a video editor.
 * The sound is uncompressed PCM, as editors prefer.
 */
function movArgs(s: Session, fps: number, soundtrack: string | null): string[] {
  return [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${s.width}x${s.height}`,
    '-r', String(fps),
    '-i', '-',
    ...(soundtrack ? ['-i', soundtrack, '-map', '0:v', '-map', '1:a', '-c:a', 'pcm_s16le'] : ['-an']),
    '-c:v', 'prores_ks',
    '-profile:v', '4444',
    '-pix_fmt', 'yuva444p10le',
    '-alpha_bits', '16',
    '-vendor', 'apl0',
    s.path,
  ];
}

/** MP4 with H.265 (E4): about half the size of H.264 at the same quality. Tagged so Apple devices play it. */
function hevcArgs(s: Session, fps: number, soundtrack: string | null): string[] {
  return [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${s.width}x${s.height}`,
    '-r', String(fps),
    '-i', '-',
    ...(soundtrack ? ['-i', soundtrack, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-c:v', 'libx265',
    '-preset', 'medium',
    '-crf', '22',
    '-tag:v', 'hvc1',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    s.path,
  ];
}

/** WebM with VP9 and Opus (E4): for the web, optionally see-through. */
function webmArgs(s: Session, fps: number, soundtrack: string | null): string[] {
  return [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${s.width}x${s.height}`,
    '-r', String(fps),
    '-i', '-',
    ...(soundtrack ? ['-i', soundtrack, '-map', '0:v', '-map', '1:a', '-c:a', 'libopus', '-b:a', '128k'] : ['-an']),
    '-c:v', 'libvpx-vp9',
    '-b:v', '0',
    '-crf', '30',
    '-deadline', 'good',
    '-cpu-used', '4',
    '-row-mt', '1',
    '-pix_fmt', s.transparent ? 'yuva420p' : 'yuv420p',
    ...(s.transparent ? ['-auto-alt-ref', '0'] : []),
    s.path,
  ];
}

const ARGS: Record<Exclude<Format, 'png'>, (s: Session, fps: number, soundtrack: string | null) => string[]> = {
  mp4: mp4Args,
  hevc: hevcArgs,
  mov: movArgs,
  webm: webmArgs,
};

/** PNG sequences are exported into a folder (anything without a video extension). */
function isFrameFolder(path: string): boolean {
  return !Object.values(EXTENSIONS).some(({ ext }) => path.toLowerCase().endsWith(`.${ext}`));
}

async function cleanUp(s: Session): Promise<void> {
  if (s.tempDir) await rm(s.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

type BeginOptions = { format: Format; path: string; width: number; height: number; fps: number; audio?: unknown; transparent?: unknown };

export function registerExportHandlers(): void {
  ipcMain.handle('export:choose', async (event, format: unknown, suggestedName: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const name = typeof suggestedName === 'string' && suggestedName ? suggestedName : 'Untitled';
    if (format !== 'png' && typeof format === 'string' && format in EXTENSIONS) {
      const { ext, name: kind } = EXTENSIONS[format as keyof typeof EXTENSIONS];
      const options = { defaultPath: `${name}.${ext}`, filters: [{ name: kind, extensions: [ext] }] };
      const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (r.canceled || !r.filePath) return null;
      return r.filePath.toLowerCase().endsWith(`.${ext}`) ? r.filePath : `${r.filePath}.${ext}`;
    }
    const options = {
      title: 'Choose a folder for the PNG frames',
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.handle('export:begin', async (_event, opts: BeginOptions) => {
    const { format, path, width, height, fps, audio } = opts;
    if (!['mp4', 'hevc', 'mov', 'webm', 'png'].includes(format) || typeof path !== 'string' || !(width > 0 && height > 0 && fps > 0)) {
      throw new Error('Invalid export settings.');
    }
    if (audio !== undefined && !(audio instanceof Uint8Array)) throw new Error('Invalid export settings.');
    const session: Session = { format, path, width, height, stderr: '', transparent: opts.transparent === true };
    if (format === 'png') {
      await mkdir(path, { recursive: true });
      // An earlier, longer export to this folder would leave its last frames
      // after this one's (and an old soundtrack): remove what Nyahmation wrote.
      const old = (await readdir(path)).filter((f) => /^frame_\d{5}\.png$/.test(f) || f === 'soundtrack.wav');
      await Promise.all(old.map((f) => rm(join(path, f), { force: true })));
      if (audio) await writeFile(join(path, 'soundtrack.wav'), audio);
    } else {
      const bin = ffmpegBinary();
      if (!bin) throw new Error('The video encoder (FFmpeg) is missing. Try reinstalling with npm install.');
      let soundtrack: string | null = null;
      if (audio) {
        session.tempDir = await mkdtemp(join(tmpdir(), 'nyahmation-'));
        soundtrack = join(session.tempDir, 'soundtrack.wav');
        await writeFile(soundtrack, audio);
      }
      const ff = spawn(bin, ARGS[format as keyof typeof ARGS](session, fps, soundtrack));
      session.ffmpeg = ff;
      ff.stderr.on('data', (d: Buffer) => {
        session.stderr = (session.stderr + d.toString()).slice(-4000);
      });
      ff.stdin.on('error', () => {
        /* reported through the exit code */
      });
      // If FFmpeg can't start at all (not allowed to run, say), the export fails with the reason rather than crashing the app.
      session.exited = new Promise((resolve) => {
        ff.on('error', (err) => {
          session.failed = true;
          session.stderr += `\nFFmpeg couldn't start: ${err.message}`;
          resolve(-1);
        });
        ff.on('close', (code) => resolve(code));
      });
    }
    const id = nextId++;
    sessions.set(id, session);
    return id;
  });

  ipcMain.handle('export:frame', async (_event, id: number, index: number, bytes: unknown) => {
    const s = sessions.get(id);
    if (!s || !(bytes instanceof Uint8Array)) throw new Error('Export was stopped.');
    if (s.format === 'png') {
      await writeFile(join(s.path, `frame_${String(index + 1).padStart(5, '0')}.png`), bytes);
      return;
    }
    if (bytes.length !== s.width * s.height * 4) throw new Error('A frame had the wrong size.');
    const ff = s.ffmpeg!;
    if (ff.exitCode !== null || s.failed) throw new Error(`The video encoder stopped: ${s.stderr.split('\n').slice(-3).join(' ')}`);
    // Wait for FFmpeg to take the frame, unless it stops (or never started) meanwhile.
    if (!ff.stdin.write(bytes)) await Promise.race([new Promise<void>((resolve) => ff.stdin.once('drain', () => resolve())), s.exited]);
    if (ff.exitCode !== null || s.failed) throw new Error(`The video encoder stopped: ${s.stderr.split('\n').slice(-3).join(' ')}`);
  });

  ipcMain.handle('export:end', async (_event, id: number) => {
    const s = sessions.get(id);
    sessions.delete(id);
    if (!s) throw new Error('Export was stopped.');
    if (s.format === 'png') {
      exported.add(s.path);
      return { path: s.path };
    }
    s.ffmpeg!.stdin.end();
    const code = await s.exited;
    await cleanUp(s);
    if (code !== 0) throw new Error(`The video encoder failed (code ${code}): ${s.stderr.split('\n').slice(-4).join(' ')}`);
    exported.add(s.path);
    return { path: s.path, name: basename(s.path) };
  });

  ipcMain.handle('export:reveal', (_event, path: unknown) => {
    if (typeof path !== 'string' || !exported.has(path)) return;
    // A PNG export is a folder: open it. A video is shown selected in its folder.
    if (isFrameFolder(path)) void shell.openPath(path);
    else shell.showItemInFolder(path);
  });

  ipcMain.handle('export:cancel', async (_event, id: number) => {
    const s = sessions.get(id);
    sessions.delete(id);
    if (!s) return;
    if (s.ffmpeg) {
      s.ffmpeg.kill('SIGKILL');
      await s.exited;
      await rm(s.path, { force: true });
    }
    await cleanUp(s);
  });
}
