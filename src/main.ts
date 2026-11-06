import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { discover } from './discovery.ts';
import { executableCandidates } from './platform.ts';
import type { HomeMode } from './types.ts';

const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'central-knot-smoke-')));
let window: BrowserWindow;

async function selectHome(mode: HomeMode) {
  let home = join(app.getAppPath(), 'fixtures/home');
  if (mode === 'custom') {
    const selection = await dialog.showOpenDialog(window, { title: 'Choose a simulated home folder', properties: ['openDirectory'] });
    if (selection.canceled) return null;
    home = selection.filePaths[0];
  } else if (mode === 'actual') {
    home = homedir();
  }
  return discover({
    home, mode,
    configOverride: mode === 'actual' ? process.env.CLAUDE_CONFIG_DIR : undefined,
    binaries: mode === 'actual' ? executableCandidates(home, process.env.PATH ?? '') : [],
    runProbes: mode === 'actual',
  });
}

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1060, height: 760, minWidth: 760, minHeight: 540, show: !smoke,
    title: 'Central Knot · First look', backgroundColor: '#f6f7f9',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.handle('discovery:select', async (event, mode: unknown) => {
    if (event.sender !== window.webContents || !['fixture', 'custom', 'actual'].includes(String(mode))) throw new Error('Invalid home selection.');
    if (smoke && mode !== 'fixture') throw new Error('Smoke test is fixture-only.');
    return selectHome(mode as HomeMode);
  });
  await window.loadFile(join(__dirname, 'index.html'));
  if (smoke) {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise((resolveResult, rejectResult) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          if (document.body.dataset.ready === 'true') resolveResult({ rows: document.querySelectorAll('.skill-row').length, fixture: document.querySelector('#home-label').textContent });
          else if (Date.now() > deadline) rejectResult(new Error('Renderer did not become ready'));
          else setTimeout(check, 30);
        }; check();
      })`);
      if (result.rows !== 2 || result.fixture !== 'Bundled fixture') throw new Error('Unexpected fixture render.');
      console.log(JSON.stringify({ smoke: 'pass', ...result }));
      app.exit(0);
    } catch {
      console.error('Fixture renderer smoke test failed.');
      app.exit(1);
    }
  }
}).catch(() => { console.error('Central Knot could not open.'); app.exit(1); });

app.on('window-all-closed', () => app.quit());
