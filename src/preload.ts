import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './types.ts';

const api: DesktopApi = {
  selectHome: mode => ipcRenderer.invoke('discovery:select', mode),
  refresh: () => ipcRenderer.invoke('discovery:refresh'),
  preview: (selected, dontShare) => ipcRenderer.invoke('share:preview', selected, dontShare),
  start: (selected, dontShare, resume) => ipcRenderer.invoke('share:start', selected, dontShare, resume),
  undo: (selected, only) => ipcRenderer.invoke('share:undo', selected, only),
};
contextBridge.exposeInMainWorld('centralKnot', api);
