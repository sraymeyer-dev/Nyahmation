import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RecoveryEntry } from '../preload/api';

// Autosave and crash recovery (docs/DESIGN.md F3). Each window writes its
// unsaved work to its own recovery file about once a minute:
//   Recovery/<session>.nyah   the project, packed like a normal save
//   Recovery/<session>.json   { name, path, savedAt }
// A window that closes normally (saved, or changes discarded) deletes its
// files, so any file still there when the app starts was left by a crash or
// a force-quit, and is offered back to the user.
// NYAH_RECOVERY_DIR overrides the location (used by the tests).

export function recoveryDir(): string {
  return resolve(process.env.NYAH_RECOVERY_DIR || join(app.getPath('userData'), 'Recovery'));
}

/** Recovery session of each window, by webContents id. */
const sessions = new Map<number, string>();

function sessionOf(event: IpcMainInvokeEvent): string {
  let id = sessions.get(event.sender.id);
  if (!id) sessions.set(event.sender.id, (id = randomUUID()));
  return id;
}

const files = (id: string) => ({ project: join(recoveryDir(), `${id}.nyah`), meta: join(recoveryDir(), `${id}.json`) });

/** Only ids this module made, so a message can't reach outside the folder. */
function checkId(id: unknown): string {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid recovery id.');
  if ([...sessions.values()].includes(id)) throw new Error('That recovery file belongs to an open window.');
  return id;
}

/** Deletes a window's recovery files when it closes normally. Synchronous, so it finishes even while quitting. */
export function forgetWindow(webContentsId: number): void {
  const id = sessions.get(webContentsId);
  if (!id) return;
  sessions.delete(webContentsId);
  const f = files(id);
  rmSync(f.project, { force: true });
  rmSync(f.meta, { force: true });
}

/** Detaches a window from its recovery files without deleting them (its page crashed), so they are offered back. */
export function releaseWindow(webContentsId: number): void {
  sessions.delete(webContentsId);
}

export function registerRecoveryHandlers(): void {
  ipcMain.handle('recovery:write', async (event, bytes: unknown, meta: { name?: unknown; path?: unknown }) => {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('recovery:write expects bytes');
    const f = files(sessionOf(event));
    await mkdir(recoveryDir(), { recursive: true });
    // Project first, then the description: a listed entry always has its project.
    await writeFile(`${f.project}.saving`, bytes);
    await rename(`${f.project}.saving`, f.project);
    const entry = {
      name: typeof meta?.name === 'string' ? meta.name : 'Untitled',
      path: typeof meta?.path === 'string' ? meta.path : null,
      savedAt: Date.now(),
    };
    await writeFile(f.meta, JSON.stringify(entry));
  });

  ipcMain.handle('recovery:clear', async (event) => {
    const id = sessions.get(event.sender.id);
    if (!id) return;
    const f = files(id);
    await rm(f.meta, { force: true });
    await rm(f.project, { force: true });
  });

  ipcMain.handle('recovery:list', async (): Promise<RecoveryEntry[]> => {
    let names: string[];
    try {
      names = await readdir(recoveryDir());
    } catch {
      return [];
    }
    const live = new Set(sessions.values());
    const entries: RecoveryEntry[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (id === name || live.has(id) || !names.includes(`${id}.nyah`)) continue;
      try {
        const meta = JSON.parse(await readFile(join(recoveryDir(), name), 'utf8')) as Partial<RecoveryEntry>;
        entries.push({
          id,
          name: typeof meta.name === 'string' ? meta.name : 'Untitled',
          path: typeof meta.path === 'string' ? meta.path : null,
          savedAt: typeof meta.savedAt === 'number' ? meta.savedAt : 0,
        });
      } catch {
        // A damaged description: skip it rather than block startup.
      }
    }
    return entries.sort((a, b) => b.savedAt - a.savedAt);
  });

  ipcMain.handle('recovery:read', async (_event, id: unknown) => new Uint8Array(await readFile(files(checkId(id)).project)));

  ipcMain.handle('recovery:discard', async (_event, id: unknown) => {
    const f = files(checkId(id));
    await rm(f.meta, { force: true });
    await rm(f.project, { force: true });
  });
}
