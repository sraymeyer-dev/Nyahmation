import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { MenuCommand, NyahApi } from './api';

const api: NyahApi = {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (bytes, path) => ipcRenderer.invoke('project:save', bytes, path),
  importFile: () => ipcRenderer.invoke('file:import'),
  onMenuCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: MenuCommand) => listener(command);
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  },
  setDocumentState: (state) => ipcRenderer.send('document:state', state),
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    read: (relPath) => ipcRenderer.invoke('library:read', relPath),
    save: (name, bytes) => ipcRenderer.invoke('library:save', name, bytes),
    remove: (relPath) => ipcRenderer.invoke('library:remove', relPath),
    reveal: () => ipcRenderer.invoke('library:reveal'),
  },
  export: {
    choose: (format, name) => ipcRenderer.invoke('export:choose', format, name),
    begin: (options) => ipcRenderer.invoke('export:begin', options),
    frame: (session, index, bytes) => ipcRenderer.invoke('export:frame', session, index, bytes),
    end: (session) => ipcRenderer.invoke('export:end', session),
    cancel: (session) => ipcRenderer.invoke('export:cancel', session),
  },
};

contextBridge.exposeInMainWorld('nyah', api);
