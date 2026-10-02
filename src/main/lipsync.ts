import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, ipcMain } from 'electron';
import type { LipSyncCue, LipSyncOptions } from '../preload/api';

// Automatic lip sync (docs/DESIGN.md LS7) with Rhubarb Lip Sync, a program
// downloaded by `npm run setup` into vendor/rhubarb (and shipped inside the
// packaged app). The renderer sends the dialogue as a WAV file's bytes and
// gets back mouth cues: which of the shapes A–H, X starts when.

function rhubarbDir(): string {
  if (process.env.NYAH_RHUBARB_DIR) return process.env.NYAH_RHUBARB_DIR;
  return app.isPackaged ? join(process.resourcesPath, 'rhubarb') : join(app.getAppPath(), 'vendor', 'rhubarb');
}

function rhubarbBinary(): string | null {
  const exe = join(rhubarbDir(), process.platform === 'win32' ? 'rhubarb.exe' : 'rhubarb');
  return existsSync(exe) ? exe : null;
}

/** Running analyses, by the window that asked, so they can be cancelled. */
const running = new Map<number, ChildProcess>();

const SHAPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);

export function registerLipSyncHandlers(): void {
  ipcMain.handle('lipsync:available', () => rhubarbBinary() !== null);

  ipcMain.handle('lipsync:cancel', (event) => {
    running.get(event.sender.id)?.kill();
  });

  ipcMain.handle('lipsync:run', async (event, wav: unknown, options: LipSyncOptions): Promise<LipSyncCue[]> => {
    if (!(wav instanceof Uint8Array)) throw new TypeError('lipsync:run expects WAV bytes');
    const bin = rhubarbBinary();
    if (!bin) throw new Error('Automatic lip sync isn\'t installed. In Terminal, in the Nyahmation folder, run "npm run setup" (it needs the internet), then try again.');
    if (running.has(event.sender.id)) throw new Error('Lip sync is already running.');

    const dir = await mkdtemp(join(tmpdir(), 'nyahmation-lipsync-'));
    try {
      const input = join(dir, 'dialogue.wav');
      const output = join(dir, 'cues.json');
      await writeFile(input, wav);
      const args = ['--machineReadable', '-f', 'json', '-o', output];
      args.push('-r', options?.recognizer === 'phonetic' ? 'phonetic' : 'pocketSphinx');
      const extended = typeof options?.extendedShapes === 'string' ? options.extendedShapes.replace(/[^GHX]/g, '') : 'GHX';
      args.push('--extendedShapes', extended);
      if (typeof options?.script === 'string' && options.script.trim()) {
        const script = join(dir, 'script.txt');
        await writeFile(script, options.script);
        args.push('-d', script);
      }
      args.push(input);

      const child = spawn(bin, args, { cwd: rhubarbDir() });
      running.set(event.sender.id, child);
      let stderr = '';
      let lastError = '';
      child.stderr!.on('data', (d: Buffer) => {
        stderr += d.toString();
        // One JSON event per line: progress, and failures with a message.
        const lines = stderr.split('\n');
        stderr = lines.pop()!;
        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as { type?: string; value?: number; reason?: string; log?: { level?: string; message?: string } };
            if (msg.type === 'progress' && typeof msg.value === 'number') event.sender.send('lipsync:progress', msg.value);
            if (msg.type === 'failure' && msg.reason) lastError = msg.reason;
            else if (msg.log?.level === 'Error' && msg.log.message) lastError = msg.log.message;
          } catch {
            // Not a progress line.
          }
        }
      });
      const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
      running.delete(event.sender.id);
      if (child.killed || code === null) throw new Error('Cancelled.');
      if (code !== 0) throw new Error(lastError || `Rhubarb stopped with code ${code}.`);

      const json = JSON.parse(await readFile(output, 'utf8')) as { mouthCues?: { start: number; end: number; value: string }[] };
      return (json.mouthCues ?? [])
        .filter((c) => SHAPES.has(c.value) && Number.isFinite(c.start) && Number.isFinite(c.end))
        .map((c) => ({ start: c.start, end: c.end, shape: c.value }));
    } finally {
      running.delete(event.sender.id);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
