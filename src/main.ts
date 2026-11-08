import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, watch, type FSWatcher } from 'node:fs';
import { access, constants, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { discover } from './discovery.ts';
import { harnesses, harnessIds, writeRoot } from './harnesses.ts';
import { executableCandidates } from './platform.ts';
import { syncGate, writeAccess, type ShareContext } from './share.ts';
import { applyChanges, deleteEverywhere, manageView, readHistory, restoreFromHistory } from './manage.ts';
import { cachedCatalog, install, installState, outcomes, parseCatalog, pluginTools, readCatalog, registeredMarketplaces, sameSource, uninstall, type PluginContext } from './plugins.ts';
import type { ActionReport, ApplyResult, Catalog, Change, HarnessId, HomeMode, HomeView, MarketplaceView, PluginsView, Snapshot } from './types.ts';

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


// ---------- Sync switch, watching and polling (SYN-03, SYN-04) ----------

const syncSettingsPath = () => join(app.getPath('userData'), 'sync-settings.json');
let syncOn = true;
async function loadSyncSetting() {
  try { syncOn = JSON.parse(await readFile(syncSettingsPath(), 'utf8')).syncOn !== false; } catch { syncOn = true; }
}
async function saveSyncSetting(on: boolean) {
  syncOn = on;
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(syncSettingsPath(), `${JSON.stringify({ syncOn: on }, null, 2)}\n`);
}

/** What background passes did since the page last read, so no notice is lost between reads. */
let pendingResults: ApplyResult['results'] = [];
let pendingNotices: NonNullable<ApplyResult['notices']> = [];
let lastStopped: string | undefined;

/** One pass on the open home: writes only with Sync on (or when asked explicitly), otherwise it just keeps the evidence. */
async function pass(explicit = false): Promise<ApplyResult | undefined> {
  const shared = context();
  if (!(await writeAccess(shared)).allowed || (await syncGate(shared)).state !== 'ready') return undefined;
  return applyChanges(shared, [], false, { observeOnly: !syncOn && !explicit });
}

async function view(explicit = false): Promise<HomeView> {
  const shared = context();
  const result = await pass(explicit);
  // A pass that could not finish says so on the page instead of failing quietly.
  const caughtUp = [...pendingResults, ...(result?.results ?? []), ...(result?.stopped ? [{ item: 'Sync', outcome: 'failed' as const, message: result.stopped }] : [])];
  const notices = [...pendingNotices, ...(result?.notices ?? [])];
  pendingResults = [];
  pendingNotices = [];
  const snapshots = await read();
  return {
    mode: current!.mode, label: current!.label, home: current!.home, snapshots, syncOn,
    manage: await manageView(shared, caughtUp.filter(result => result.outcome === 'written' || result.outcome === 'removed' || result.outcome === 'failed' || (result.outcome === 'held' && /choose again/.test(result.message))), notices),
  };
}

/** Background passes run through the same queue as the page's requests, one at a time, and tell the page when something changed. */
const POLL_MS = 20_000;
const DEBOUNCE_MS = 1_500;
let watchers: FSWatcher[] = [];
let poller: NodeJS.Timeout | undefined;
let soon: NodeJS.Timeout | undefined;
let followUp: NodeJS.Timeout | undefined;

function background() {
  if (!current || smoke) return;
  const work = queue.then(async () => {
    if (!current) return;
    const result = await pass();
    // A deletion waits out its settle window: look again just after it, so it finishes without a click. Otherwise wait for an event or the poll.
    if (result?.settling) { clearTimeout(followUp); followUp = setTimeout(background, 2_500); }
    if (result?.stopped && result.stopped !== lastStopped) {
      lastStopped = result.stopped;
      pendingResults.push({ item: 'Sync', outcome: 'failed', message: result.stopped });
      if (!window.isDestroyed()) window.webContents.send('sync:changed');
    }
    if (!result?.stopped) lastStopped = undefined;
    if (!result || (!result.harnessWrites && !result.notices?.length)) return;
    pendingResults.push(...result.results);
    pendingNotices.push(...(result.notices ?? []));
    if (!window.isDestroyed()) window.webContents.send('sync:changed');
  });
  queue = work.catch(() => undefined);
}

const nudge = () => { clearTimeout(soon); soon = setTimeout(background, DEBOUNCE_MS); };

function stopWatching() {
  for (const watcher of watchers) watcher.close();
  watchers = [];
  clearInterval(poller); clearTimeout(soon); clearTimeout(followUp);
  poller = undefined;
}

/** Watches each tool's skills folders (an event only prompts a read, CON-04), with polling as the fallback (T-08: at most 30 s). */
async function startWatching() {
  stopWatching();
  if (!current || smoke) return;
  const roots = new Set<string>(harnessIds.map(id => writeRoot(harnesses[id], current!.home, overrideFor(id))));
  roots.add(join(current.home, '.agents/skills'));
  for (const root of roots) {
    try { watchers.push(watch(root, { recursive: true, persistent: false }, nudge)); } catch { /* not there: polling covers it */ }
  }
  poller = setInterval(background, POLL_MS);
}

// ---------- Marketplaces and plugins ----------

/** A tool's own CLI, never an app's bundled copy (CD §3), searched as version probes are. */
async function findClis(): Promise<Partial<Record<HarnessId, string>>> {
  const found: Partial<Record<HarnessId, string>> = {};
  for (const tool of pluginTools) {
    for (const candidate of executableCandidates(homedir(), process.env.PATH ?? '', harnesses[tool].binary)) {
      if (candidate.includes('/ChatGPT.app/')) continue;
      try { await access(candidate, constants.X_OK); found[tool] = candidate; break; } catch { /* next */ }
    }
  }
  return found;
}

async function pluginContext(): Promise<PluginContext> {
  return { home: current!.home, dataDir: join(app.getPath('userData'), 'plugins'), binaries: await findClis(), overrides: context().overrides };
}

/** The marketplaces added in Central Knot: this build's own list, separate from what each tool has added. */
const listPath = () => join(app.getPath('userData'), 'marketplaces.json');
async function addedSources(): Promise<string[]> {
  try { const list = JSON.parse(await readFile(listPath(), 'utf8')); return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
}
const saveSources = async (list: string[]) => { await mkdir(app.getPath('userData'), { recursive: true }); await writeFile(listPath(), `${JSON.stringify(list, null, 2)}\n`); };

/** Problems from the last fetch of each source this session; the catalog itself comes from disk. */
const lastProblem = new Map<string, string | undefined>();

async function catalogFor(plugins: PluginContext, source: string, fresh: boolean): Promise<{ catalog?: Catalog; stale?: boolean; problem?: string }> {
  if (source.startsWith('/')) { const catalog = await parseCatalog(source, source, 'folder'); return { catalog, problem: catalog.problem }; }
  if (fresh || !(await cachedCatalog(plugins, source))) {
    const catalog = await readCatalog(plugins, source);
    lastProblem.set(source, catalog.problem);
    if (!catalog.problem) return { catalog };
  }
  const cached = await cachedCatalog(plugins, source);
  const problem = lastProblem.get(source);
  return cached ? { catalog: cached, stale: !!problem, problem } : { problem };
}

async function pluginsView(fresh?: string): Promise<PluginsView> {
  const plugins = await pluginContext();
  const tools = (await manageView(context())).tools.filter(tool => pluginTools.includes(tool));
  const access = await writeAccess(context());
  const known: { source: string; origins: MarketplaceView['origins'] }[] = [];
  const note = (source: string, origin: MarketplaceView['origins'][number]) => {
    const entry = known.find(item => sameSource(item.source, source));
    if (entry) { if (!entry.origins.includes(origin)) entry.origins.push(origin); } else known.push({ source, origins: [origin] });
  };
  for (const source of await addedSources()) note(source, 'central-knot');
  for (const tool of tools) for (const entry of await registeredMarketplaces(plugins, tool)) note(entry.source, tool);
  const marketplaces: MarketplaceView[] = [];
  for (const { source, origins } of known) {
    const { catalog, stale, problem } = await catalogFor(plugins, source, fresh !== undefined && sameSource(fresh, source));
    const view: MarketplaceView = { source, origins, name: catalog?.name ?? '', kind: source.startsWith('/') ? 'folder' : 'git', fetchedAt: catalog?.fetchedAt, problem, stale, plugins: [], states: {} };
    for (const plugin of catalog?.plugins ?? []) {
      view.plugins.push({ ...plugin, outcomes: plugin.components ? Object.fromEntries(tools.map(tool => [tool, outcomes(tool, plugin.components!)])) : {} });
      view.states[plugin.name] = Object.fromEntries(await Promise.all(tools.map(async tool => [tool, await installState(plugins, tool, catalog!.name, plugin.name)] as const)));
    }
    marketplaces.push(view);
  }
  return { home: current!.home, tools, clis: Object.fromEntries(tools.map(tool => [tool, !!plugins.binaries[tool]])), canWrite: access.allowed, reason: access.allowed ? undefined : access.reason, marketplaces };
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
  try { const shown = await view(); void startWatching(); return shown; } catch (error) { current = previous; throw error; }
}

const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is HarnessId => harnessIds.includes(id as HarnessId)) : []);

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
  await loadSyncSetting();
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
  // Writes act only on the home the window says it is showing.
  const changes = (value: unknown): Change[] => (Array.isArray(value) ? value : []).filter((change): change is Change =>
    typeof change?.key === 'string' && typeof change.managed === 'boolean' && Array.isArray(change.off)
    && (change.use === undefined || change.use === 'separate' || harnessIds.includes(change.use)) && (change.useHash === undefined || typeof change.useHash === 'string') && (change.seenManaged === undefined || typeof change.seenManaged === 'boolean')).map(change => ({ key: change.key, managed: change.managed, off: ids(change.off), use: change.use, useHash: change.useHash, seenManaged: change.seenManaged }));
  handle('plugins:view', async () => (current ? pluginsView() : null));
  handle('plugins:add', async source => {
    if (typeof source !== 'string' || !source.trim() || source.length > 2000) throw new Error('Invalid marketplace.');
    const text = source.trim();
    const catalog = await readCatalog(await pluginContext(), text);
    if (catalog.problem) return { problem: catalog.problem };
    const list = await addedSources();
    if (!list.some(item => sameSource(item, text))) await saveSources([...list, text]);
    lastProblem.set(text, undefined);
    return { view: await pluginsView() };
  });
  handle('plugins:refresh', async source => (typeof source === 'string' ? pluginsView(source) : null));
  handle('plugins:forget', async source => {
    if (typeof source !== 'string') return null;
    await saveSources((await addedSources()).filter(item => !sameSource(item, source)));
    return pluginsView();
  });
  handle('plugins:pick-folder', async () => {
    const choice = await dialog.showOpenDialog(window, { title: 'Choose a marketplace folder', properties: ['openDirectory'] });
    return choice.canceled ? null : choice.filePaths[0];
  });
  // Plugin writes act only on the home on screen, and only where writing is allowed there.
  const pluginGuard = async (home: unknown) => {
    if (home !== current?.home) return 'The home on screen is not the one open. Nothing was installed. Read it again.';
    const access = await writeAccess(context());
    return access.allowed ? undefined : access.reason;
  };
  handle('plugins:install', async (source, plugin, tools, home) => {
    const stopped = await pluginGuard(home);
    if (stopped || typeof source !== 'string' || typeof plugin !== 'string') return { stopped: stopped ?? 'Invalid request.', reports: [] };
    const plugins = await pluginContext();
    const { catalog } = await catalogFor(plugins, source, false);
    if (!catalog?.plugins.some(item => item.name === plugin)) return { stopped: 'That plugin is not in the marketplace as last read. Refresh it, then try again.', reports: [] };
    const reports: ActionReport[] = [];
    for (const tool of ids(tools).filter(entry => pluginTools.includes(entry))) reports.push(await install(plugins, catalog, plugin, tool));
    return { reports, view: await pluginsView() };
  });
  handle('plugins:uninstall', async (marketplace, plugin, tool, home) => {
    const stopped = await pluginGuard(home);
    if (stopped || typeof marketplace !== 'string' || typeof plugin !== 'string' || !ids([tool]).length) return { stopped: stopped ?? 'Invalid request.', reports: [] };
    const report = await uninstall(await pluginContext(), marketplace, plugin, tool as HarnessId);
    return { reports: [report], view: await pluginsView() };
  });
  handle('history:list', async () => (current ? readHistory(current.home) : []));
  handle('history:restore', async (eventId, resume, home) => (home === current?.home && typeof eventId === 'string'
    ? restoreFromHistory(context(), eventId, resume === true)
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0 } satisfies ApplyResult));
  handle('manage:delete-everywhere', async (key, resume, home) => (home === current?.home && typeof key === 'string'
    ? deleteEverywhere(context(), key, resume === true)
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0 } satisfies ApplyResult));
  handle('sync:set', async on => { await saveSyncSetting(on === true); return current ? view() : null; });
  handle('sync:now', async home => (home === current?.home ? view(true) : null));
  // With Sync off, Apply all writes exactly the skills it shows; spreading anything else waits for Sync.
  handle('manage:apply', async (list, resume, home) => (home === current?.home
    ? applyChanges(context(), changes(list), resume === true, syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0 } satisfies ApplyResult));
  await window.loadFile(join(__dirname, 'index.html'), process.argv.some(arg => arg.startsWith('--design-preview')) ? { query: { design: process.argv.find(arg => arg.startsWith('--design-preview'))!.split('=')[1] ?? 'b3' } } : undefined);
  if (smoke) {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise((resolveResult, rejectResult) => {
        const deadline = Date.now() + 5000;
        const check = async () => {
          if (document.body.dataset.ready === 'true') {
            const view = await window.centralKnot.refresh();
            resolveResult({ rows: document.querySelectorAll('.ov-row[data-key]').length, home: document.querySelector('#home-label').textContent, skills: view.manage.skills.map(skill => skill.key + ':' + Object.keys(skill.copies).length).join(','), allowed: view.manage.access.allowed });
          } else if (Date.now() > deadline) rejectResult(new Error('Renderer did not become ready'));
          else setTimeout(check, 30);
        }; check();
      })`);
      const skills = 'notes:2,release-notes:1,review:2,standup:1';
      if (result.rows !== 4 || result.home !== 'Practice copy' || result.skills !== skills || !result.allowed) throw new Error('Unexpected fixture render.');
      console.log(JSON.stringify({ smoke: 'pass', ...result }));
      app.exit(0);
    } catch {
      console.error('Fixture renderer smoke test failed.');
      app.exit(1);
    }
  }
}).catch(() => { console.error('Central Knot could not open.'); app.exit(1); });

app.on('window-all-closed', () => { stopWatching(); app.quit(); });
app.on('will-quit', () => { stopWatching(); if (practiceHome) rmSync(practiceHome, { recursive: true, force: true }); });
