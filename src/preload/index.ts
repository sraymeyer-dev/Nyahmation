import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron';
import type { MenuCommand, NyahApi, OpenedFile } from './api';

/** File-system failures in plain words (the system's own message, which starts with the code, follows). */
const PLAIN: [RegExp, string][] = [
  [/^ENOSPC\b/, 'The disk is full.'],
  [/^(EACCES|EPERM)\b/, "Nyahmation isn't allowed to use that file or folder."],
  [/^EROFS\b/, "That disk can't be written to."],
  [/^ENOENT\b/, "That file or folder isn't there (it may have been moved or deleted)."],
  [/^EBUSY\b/, 'Another program is using that file.'],
];

/**
 * Calls the main process. Errors arrive as "Error invoking remote method
 * 'x': Error: …"; only the part after that is for the user, with plain
 * words first for common file problems.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (err) {
    const message = String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
    const plain = PLAIN.find(([re]) => re.test(message))?.[1];
    throw new Error(plain ? `${plain} (${message})` : message);
  }
}

const api: NyahApi = {
  openProject: () => invoke('project:open'),
  saveProject: (bytes, path) => invoke('project:save', bytes, path),
  importFile: () => invoke('file:import'),
  importFiles: () => invoke('file:importMany'),
  onMenuCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: MenuCommand) => listener(command);
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  },
  onOpenFile: (listener) => {
    const handler = (_event: IpcRendererEvent, file: OpenedFile) => listener(file);
    ipcRenderer.on('project:openFile', handler);
    return () => ipcRenderer.removeListener('project:openFile', handler);
  },
  readyForFiles: () => ipcRenderer.send('project:ready'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  editText: (command) => ipcRenderer.send('edit:text', command),
  setDocumentState: (state) => ipcRenderer.send('document:state', state),
  openManual: () => ipcRenderer.send('help:manual'),
  askForMicrophone: () => invoke('media:microphone'),
  showContextMenu: (items) => invoke('menu:context', items),
  setInterfaceSize: (factor) => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, factor))),
  library: {
    list: () => invoke('library:list'),
    read: (relPath) => invoke('library:read', relPath),
    save: (name, bytes, replace) => invoke('library:save', name, bytes, replace),
    remove: (relPath) => invoke('library:remove', relPath),
    reveal: () => invoke('library:reveal'),
  },
  export: {
    choose: (format, name) => invoke('export:choose', format, name),
    begin: (options) => invoke('export:begin', options),
    frame: (session, index, bytes) => invoke('export:frame', session, index, bytes),
    end: (session) => invoke('export:end', session),
    cancel: (session) => invoke('export:cancel', session),
    reveal: (path) => invoke('export:reveal', path),
  },
  lipSync: {
    available: () => invoke('lipsync:available'),
    run: (wav, options) => invoke('lipsync:run', wav, options),
    cancel: () => invoke('lipsync:cancel'),
    onProgress: (listener) => {
      const handler = (_event: IpcRendererEvent, value: number) => listener(value);
      ipcRenderer.on('lipsync:progress', handler);
      return () => ipcRenderer.removeListener('lipsync:progress', handler);
    },
  },
  recovery: {
    write: (bytes, meta) => invoke('recovery:write', bytes, meta),
    clear: () => invoke('recovery:clear'),
    list: () => invoke('recovery:list'),
    read: (id) => invoke('recovery:read', id),
    discard: (id) => invoke('recovery:discard', id),
  },
};

contextBridge.exposeInMainWorld('nyah', api);
