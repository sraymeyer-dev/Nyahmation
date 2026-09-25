import { contextBridge, ipcRenderer } from 'electron';
import type { NyahApi } from './api';

const api: NyahApi = {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (bytes, path) => ipcRenderer.invoke('project:save', bytes, path),
};

contextBridge.exposeInMainWorld('nyah', api);
