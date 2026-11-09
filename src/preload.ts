import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './types.ts';

const api: DesktopApi = {
  selectHome: mode => ipcRenderer.invoke('discovery:select', mode),
  refresh: () => ipcRenderer.invoke('discovery:refresh'),
  apply: (changes, resume, home) => ipcRenderer.invoke('manage:apply', changes, resume, home),
  history: () => ipcRenderer.invoke('history:list'),
  instructions: () => ipcRenderer.invoke('instructions:view'),
  convertAgent: (key, home) => ipcRenderer.invoke('agents:convert', key, home),
  eventChange: eventId => ipcRenderer.invoke('history:change', eventId),
  saveInstruction: (tool, text, expected, home) => ipcRenderer.invoke('instructions:save', tool, text, expected, home),
  instructionVersion: (tool, id) => ipcRenderer.invoke('instructions:version', tool, id),
  applyMcp: (changes, home) => ipcRenderer.invoke('mcp:apply', changes, home),
  writeClaude: (names, home) => ipcRenderer.invoke('mcp:write-claude', names, home),
  startHome: () => ipcRenderer.invoke('discovery:start'),
  applyAgents: (changes, home) => ipcRenderer.invoke('agents:apply', changes, home),
  setSync: on => ipcRenderer.invoke('sync:set', on),
  syncNow: home => ipcRenderer.invoke('sync:now', home),
  onSyncChanged: callback => { ipcRenderer.on('sync:changed', () => callback()); },
  restore: (eventId, resume, home, choice) => ipcRenderer.invoke('history:restore', eventId, resume, home, choice),
  deleteEverywhere: (key, resume, home) => ipcRenderer.invoke('manage:delete-everywhere', key, resume, home),
  plugins: () => ipcRenderer.invoke('plugins:view'),
  addMarketplace: source => ipcRenderer.invoke('plugins:add', source),
  refreshMarketplace: source => ipcRenderer.invoke('plugins:refresh', source),
  forgetMarketplace: source => ipcRenderer.invoke('plugins:forget', source),
  pickMarketplaceFolder: () => ipcRenderer.invoke('plugins:pick-folder'),
  installPlugin: (source, plugin, tools, home) => ipcRenderer.invoke('plugins:install', source, plugin, tools, home),
  uninstallPlugin: (marketplace, plugin, tool, home) => ipcRenderer.invoke('plugins:uninstall', marketplace, plugin, tool, home),
};
contextBridge.exposeInMainWorld('centralKnot', api);
