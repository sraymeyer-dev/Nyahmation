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
};

contextBridge.exposeInMainWorld('nyah', api);
