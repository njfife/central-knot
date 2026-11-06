import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './types.ts';

const api: DesktopApi = { selectHome: mode => ipcRenderer.invoke('discovery:select', mode) };
contextBridge.exposeInMainWorld('centralKnot', api);
