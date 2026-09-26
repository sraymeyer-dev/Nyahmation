import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { registerExportHandlers } from './export';
import { registerLibraryHandlers } from './library';
import { buildMenu } from './menu';

// The main process only touches the file system. Everything about the
// project's contents (packing, validation) happens in the renderer, so it
// can be unit-tested without Electron.

const PROJECT_FILTERS = [{ name: 'Nyahmation Project', extensions: ['nyah'] }];
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'flac'];
const IMPORT_FILTERS = [
  { name: 'Art or Sound', extensions: ['svg', 'png', 'jpg', 'jpeg', ...AUDIO_EXTENSIONS] },
  { name: 'SVG', extensions: ['svg'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
  { name: 'Sound', extensions: AUDIO_EXTENSIONS },
];

/** Unsaved-changes state reported by each window's renderer. */
const dirtyWindows = new WeakSet<BrowserWindow>();

// ---- Opening project files from Finder or Explorer ---------------------------
// Double-clicking a .nyah file (or dropping it on the Dock icon) opens it.
// macOS reports it with the 'open-file' event, possibly before the window
// exists; Windows passes it on the command line. Paths wait here until a
// window's page says it's ready to receive them.

const pendingPaths: string[] = [];
/** Windows whose page has asked for files (see 'project:ready'). */
const readyWindows = new WeakSet<BrowserWindow>();

function projectPathIn(argv: readonly string[]): string | undefined {
  return argv.slice(1).find((a) => a.toLowerCase().endsWith('.nyah') && !a.startsWith('-'));
}

async function sendProject(win: BrowserWindow, path: string): Promise<void> {
  try {
    const bytes = new Uint8Array(await readFile(path));
    win.webContents.send('project:openFile', { path, name: basename(path), bytes });
  } catch (err) {
    dialog.showErrorBox("Couldn't open the project", `${basename(path)}: ${(err as Error).message}`);
  }
}

function openPath(path: string): void {
  const win = BrowserWindow.getAllWindows().find((w) => readyWindows.has(w));
  if (!win) {
    pendingPaths.push(path);
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  void sendProject(win, path);
}

app.on('open-file', (event, path) => {
  event.preventDefault();
  openPath(path);
});

// One copy of the app: opening a file while it runs goes to the open window.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();
app.on('second-instance', (_event, argv) => {
  const path = projectPathIn(argv);
  if (path) openPath(path);
  else BrowserWindow.getAllWindows()[0]?.focus();
});
{
  const path = projectPathIn(process.argv);
  if (path) pendingPaths.push(path);
}

ipcMain.on('project:ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  readyWindows.add(win);
  for (const path of pendingPaths.splice(0)) void sendProject(win, path);
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'Nyahmation',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('close', (event) => {
    if (!dirtyWindows.has(win)) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Discard Changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'If you close now, your changes since the last save will be lost.',
    });
    if (choice === 1) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** Writes to a temporary file first, so a crash mid-save never damages the existing project. */
async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmp = `${path}.saving`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

ipcMain.handle('project:open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { properties: ['openFile' as const], filters: PROJECT_FILTERS };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  if (result.canceled || !path) return null;
  const bytes = new Uint8Array(await readFile(path));
  return { path, name: basename(path), bytes };
});

ipcMain.handle('project:save', async (event, bytes: unknown, existingPath: unknown) => {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('project:save expects bytes');
  let path = typeof existingPath === 'string' && existingPath.endsWith('.nyah') ? existingPath : null;
  if (!path) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { filters: PROJECT_FILTERS, defaultPath: 'Untitled.nyah' };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    path = result.filePath.endsWith('.nyah') ? result.filePath : `${result.filePath}.nyah`;
  }
  await writeFileAtomic(path, bytes);
  return { path, name: basename(path) };
});

ipcMain.handle('file:importMany', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { properties: ['openFile' as const, 'multiSelections' as const], filters: IMPORT_FILTERS.slice(1, 3) };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return Promise.all(result.filePaths.map(async (path) => ({ name: basename(path), bytes: new Uint8Array(await readFile(path)) })));
});

ipcMain.handle('file:import', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { properties: ['openFile' as const], filters: IMPORT_FILTERS };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  if (result.canceled || !path) return null;
  return { name: basename(path), bytes: new Uint8Array(await readFile(path)) };
});

ipcMain.on('document:state', (event, state: { title?: unknown; path?: unknown; dirty?: unknown }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const dirty = state.dirty === true;
  if (dirty) dirtyWindows.add(win);
  else dirtyWindows.delete(win);
  const title = typeof state.title === 'string' ? state.title : 'Untitled';
  win.setTitle(`${title}${dirty && process.platform !== 'darwin' ? ' •' : ''} — Nyahmation`);
  if (process.platform === 'darwin') {
    win.setDocumentEdited(dirty);
    win.setRepresentedFilename(typeof state.path === 'string' ? state.path : '');
  }
});

void app.whenReady().then(() => {
  if (!isFirstInstance) return;
  registerLibraryHandlers();
  registerExportHandlers();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
