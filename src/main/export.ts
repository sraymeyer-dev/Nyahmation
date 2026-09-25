import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import ffmpegPath from 'ffmpeg-static';

// Video export (docs/DESIGN.md §11). The renderer draws every frame at full
// quality and sends it here, one at a time; this side either pipes raw
// pixels into FFmpeg (MP4) or writes PNG files. Nothing is ever dropped:
// each frame waits until the previous one has been written.

type Format = 'mp4' | 'png';

interface Session {
  format: Format;
  path: string;
  width: number;
  height: number;
  ffmpeg?: ChildProcessWithoutNullStreams;
  stderr: string;
  exited?: Promise<number | null>;
}

const sessions = new Map<number, Session>();
let nextId = 1;

/** FFmpeg ships inside the app; in a packaged app it lives outside the asar archive. */
export function ffmpegBinary(): string | null {
  const p = ffmpegPath as unknown as string | null;
  return p ? p.replace('app.asar', 'app.asar.unpacked') : null;
}

function mp4Args(s: Session, fps: number): string[] {
  return [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${s.width}x${s.height}`,
    '-r', String(fps),
    '-i', '-',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    s.path,
  ];
}

export function registerExportHandlers(): void {
  ipcMain.handle('export:choose', async (event, format: unknown, suggestedName: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const name = typeof suggestedName === 'string' && suggestedName ? suggestedName : 'Untitled';
    if (format === 'mp4') {
      const options = { defaultPath: `${name}.mp4`, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] };
      const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (r.canceled || !r.filePath) return null;
      return r.filePath.toLowerCase().endsWith('.mp4') ? r.filePath : `${r.filePath}.mp4`;
    }
    const options = {
      title: 'Choose a folder for the PNG frames',
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.handle('export:begin', async (_event, opts: { format: Format; path: string; width: number; height: number; fps: number }) => {
    const { format, path, width, height, fps } = opts;
    if ((format !== 'mp4' && format !== 'png') || typeof path !== 'string' || !(width > 0 && height > 0 && fps > 0)) {
      throw new Error('Invalid export settings.');
    }
    const session: Session = { format, path, width, height, stderr: '' };
    if (format === 'png') {
      await mkdir(path, { recursive: true });
    } else {
      const bin = ffmpegBinary();
      if (!bin) throw new Error('The video encoder (FFmpeg) is missing. Try reinstalling with npm install.');
      const ff = spawn(bin, mp4Args(session, fps));
      session.ffmpeg = ff;
      ff.stderr.on('data', (d: Buffer) => {
        session.stderr = (session.stderr + d.toString()).slice(-4000);
      });
      ff.stdin.on('error', () => {
        /* reported through the exit code */
      });
      session.exited = new Promise((resolve) => ff.on('close', (code) => resolve(code)));
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
    if (ff.exitCode !== null) throw new Error(`The video encoder stopped: ${s.stderr.split('\n').slice(-3).join(' ')}`);
    if (!ff.stdin.write(bytes)) await new Promise<void>((resolve) => ff.stdin.once('drain', () => resolve()));
  });

  ipcMain.handle('export:end', async (_event, id: number) => {
    const s = sessions.get(id);
    sessions.delete(id);
    if (!s) throw new Error('Export was stopped.');
    if (s.format === 'png') return { path: s.path };
    s.ffmpeg!.stdin.end();
    const code = await s.exited;
    if (code !== 0) throw new Error(`The video encoder failed (code ${code}): ${s.stderr.split('\n').slice(-4).join(' ')}`);
    return { path: s.path, name: basename(s.path) };
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
  });
}
