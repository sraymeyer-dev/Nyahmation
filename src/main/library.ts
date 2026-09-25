import { app, ipcMain, shell } from 'electron';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { LIBRARY_EXTENSION, readLibraryMeta } from '../io/libraryItem';
import type { LibraryEntry } from '../preload/api';

// The library is a plain folder of .nyahitem files (docs/DESIGN.md L1, L4),
// by default Documents/Nyahmation Library. Subfolders are allowed and shown.
// NYAH_LIBRARY_DIR overrides the location (used by the tests).

export function libraryDir(): string {
  return resolve(process.env.NYAH_LIBRARY_DIR || join(app.getPath('documents'), 'Nyahmation Library'));
}

/** Resolves a library-relative path, refusing anything outside the library folder. */
function insideLibrary(rel: unknown): string {
  if (typeof rel !== 'string' || rel === '') throw new Error('Invalid library path.');
  const dir = libraryDir();
  const full = resolve(dir, rel);
  if (!full.startsWith(dir + sep)) throw new Error('That file is outside the library folder.');
  return full;
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (e.name.toLowerCase().endsWith(`.${LIBRARY_EXTENSION}`)) files.push(full);
  }
  return files;
}

const toPosix = (p: string) => p.split(sep).join('/');

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 100);
  return cleaned || 'Untitled';
}

export function registerLibraryHandlers(): void {
  ipcMain.handle('library:list', async () => {
    const dir = libraryDir();
    await mkdir(dir, { recursive: true });
    const items: LibraryEntry[] = [];
    for (const file of await walk(dir)) {
      const relPath = toPosix(relative(dir, file));
      const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
      const modified = (await stat(file)).mtimeMs;
      try {
        const meta = readLibraryMeta(new Uint8Array(await readFile(file)));
        items.push({ relPath, folder, modified, ...meta });
      } catch {
        const name = relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
        items.push({ relPath, folder, modified, name, kind: 'parts', tags: [], thumbnail: null, damaged: true });
      }
    }
    items.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
    return { dir, items };
  });

  ipcMain.handle('library:read', async (_event, rel: unknown) => new Uint8Array(await readFile(insideLibrary(rel))));

  ipcMain.handle('library:save', async (_event, name: unknown, bytes: unknown) => {
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) throw new TypeError('library:save expects a name and bytes');
    const dir = libraryDir();
    await mkdir(dir, { recursive: true });
    const base = safeFileName(name);
    let file = join(dir, `${base}.${LIBRARY_EXTENSION}`);
    for (let n = 2; await exists(file); n++) file = join(dir, `${base} ${n}.${LIBRARY_EXTENSION}`);
    const tmp = `${file}.saving`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
    return toPosix(relative(dir, file));
  });

  ipcMain.handle('library:remove', async (_event, rel: unknown) => {
    await shell.trashItem(insideLibrary(rel));
  });

  ipcMain.handle('library:reveal', async () => {
    const dir = libraryDir();
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
