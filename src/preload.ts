import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './types.ts';

const api: DesktopApi = {
  selectHome: mode => ipcRenderer.invoke('discovery:select', mode),
  refresh: () => ipcRenderer.invoke('discovery:refresh'),
  apply: (changes, resume, home) => ipcRenderer.invoke('manage:apply', changes, resume, home),
};
contextBridge.exposeInMainWorld('centralKnot', api);
