import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { discover } from './discovery.ts';
import { harnesses, harnessIds } from './harnesses.ts';
import { executableCandidates } from './platform.ts';
import { buildPreview, start, undo, type ShareContext } from './share.ts';
import type { ActionResult, HarnessId, HomeMode, HomeView, Snapshot } from './types.ts';

const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'central-knot-smoke-')));
const BUILD = 'com.centralknot.firstlook';
let window: BrowserWindow;
let current: { mode: HomeMode; home: string; label: string } | undefined;
let practiceHome: string | undefined;

/** Files in the package are read-only, so practice happens on a throwaway copy made for this launch. */
async function copyFixture(source: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyFixture(join(source, entry.name), join(target, entry.name));
    else await writeFile(join(target, entry.name), await readFile(join(source, entry.name)));
  }
}

async function ensurePracticeHome(): Promise<string> {
  if (practiceHome) return practiceHome;
  const home = mkdtempSync(join(tmpdir(), 'central-knot-practice-'));
  await copyFixture(join(app.getAppPath(), 'fixtures/home'), home);
  practiceHome = home;
  return home;
}

const overrideFor = (id: HarnessId) => (current?.mode === 'actual' ? process.env[harnesses[id].configEnv] : undefined);

async function read(): Promise<Snapshot[]> {
  const { mode, home } = current!;
  return Promise.all(harnessIds.map(id => discover({
    home, mode, harness: id, configOverride: overrideFor(id),
    binaries: mode === 'actual' ? executableCandidates(home, process.env.PATH ?? '', harnesses[id].binary) : [],
    runProbes: mode === 'actual',
  })));
}

function context(): ShareContext {
  return {
    home: current!.home, mode: current!.mode, read, build: BUILD,
    settingsPath: join(app.getPath('userData'), 'sharing-settings.json'), realHome: homedir(),
    allowActualWrites: process.platform === 'darwin' && !smoke,
    overrides: Object.fromEntries(harnessIds.map(id => [id, overrideFor(id)])),
  };
}

const present = (snapshot: Snapshot) => snapshot.detection !== 'Not found' || snapshot.skills.length > 0;

async function view(): Promise<HomeView> {
  const snapshots = await read();
  const selected = snapshots.filter(present).map(snapshot => snapshot.harness);
  return { mode: current!.mode, label: current!.label, home: current!.home, snapshots, preview: await buildPreview(context(), selected, []) };
}

async function selectHome(mode: HomeMode): Promise<HomeView | null> {
  let next: NonNullable<typeof current>;
  if (mode === 'custom') {
    const selection = await dialog.showOpenDialog(window, { title: 'Choose a simulated home folder', properties: ['openDirectory'] });
    if (selection.canceled) return null;
    next = { mode, home: selection.filePaths[0], label: 'Selected folder' };
  } else if (mode === 'actual') next = { mode, home: homedir(), label: 'This Mac’s home' };
  else next = { mode, home: await ensurePracticeHome(), label: 'Practice copy' };
  // A switch that fails changes nothing: the home on screen stays the home open here.
  const previous = current;
  current = next;
  try { return await view(); } catch (error) { current = previous; throw error; }
}

const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is HarnessId => harnessIds.includes(id as HarnessId)) : []);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** One thing at a time: planning and writing never interleave. */
let queue: Promise<unknown> = Promise.resolve();
function handle(channel: string, work: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents) throw new Error('Unexpected sender.');
    const next = queue.then(() => work(...args));
    queue = next.catch(() => undefined);
    return next;
  });
}

if (!smoke && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 860, minHeight: 560, show: !smoke,
    title: 'Central Knot', backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#fbfbfc',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  handle('discovery:select', async mode => {
    if (!['fixture', 'custom', 'actual'].includes(String(mode))) throw new Error('Invalid home selection.');
    if (smoke && mode !== 'fixture') throw new Error('Smoke test is fixture-only.');
    return selectHome(mode as HomeMode);
  });
  handle('discovery:refresh', async () => (current ? view() : null));
  handle('share:preview', async (selected, dontShare) => buildPreview(context(), ids(selected), strings(dontShare)));
  // Writes act only on the home the window says it is showing.
  const notShown = async (selected: unknown): Promise<ActionResult> => ({ stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0, preview: await buildPreview(context(), ids(selected), []) });
  handle('share:start', async (selected, dontShare, resume, home) => (home === current?.home ? start(context(), ids(selected), strings(dontShare), resume === true) : notShown(selected)));
  handle('share:undo', async (selected, only, home) => (home === current?.home ? undo(context(), ids(selected), typeof only === 'string' ? only : undefined) : notShown(selected)));
  await window.loadFile(join(__dirname, 'index.html'), process.argv.some(arg => arg.startsWith('--design-preview')) ? { query: { design: process.argv.includes('--design-preview=large') ? 'large' : '1' } } : undefined);
  if (smoke) {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise((resolveResult, rejectResult) => {
        const deadline = Date.now() + 5000;
        const check = async () => {
          if (document.body.dataset.ready === 'true') {
            const preview = await window.centralKnot.preview(['claude-cli', 'copilot-cli'], []);
            resolveResult({ rows: document.querySelectorAll('.mx-cell[data-tool="claude-cli"][data-present="true"]').length, home: document.querySelector('#home-label').textContent, plan: preview.items.map(item => item.key + ':' + item.state).join(','), allowed: preview.access.allowed });
          } else if (Date.now() > deadline) rejectResult(new Error('Renderer did not become ready'));
          else setTimeout(check, 30);
        }; check();
      })`);
      const plan = 'notes:identical,release-notes:copy,review:collision,standup:copy';
      if (result.rows !== 3 || result.home !== 'Practice copy' || result.plan !== plan || !result.allowed) throw new Error('Unexpected fixture render.');
      console.log(JSON.stringify({ smoke: 'pass', ...result }));
      app.exit(0);
    } catch {
      console.error('Fixture renderer smoke test failed.');
      app.exit(1);
    }
  }
}).catch(() => { console.error('Central Knot could not open.'); app.exit(1); });

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (practiceHome) rmSync(practiceHome, { recursive: true, force: true }); });
