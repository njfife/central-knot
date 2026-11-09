import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Tray } from 'electron';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, watch, type FSWatcher } from 'node:fs';
import { access, constants, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { discover } from './discovery.ts';
import { harnesses, harnessIds, writeRoot } from './harnesses.ts';
import { executableCandidates } from './platform.ts';
import { syncGate, writeAccess, type ShareContext } from './share.ts';
import { applyChanges, deleteEverywhere, manageView, presentTools, readHistory, restoreFromHistory } from './manage.ts';
import { applyMcp, mcpView, restoreMcp } from './mcp.ts';
import { agentTools, agentsView, applyAgents, restoreAgent } from './agents.ts';
import { cachedCatalog, install, installState, outcomes, parseCatalog, pluginTools, readCatalog, registeredMarketplaces, sameSource, uninstall, type PluginContext } from './plugins.ts';
import { trayIconPng } from './trayicon.ts';
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
  refreshTray();
}

// ---------- Running in the background (PLT-03, PLT-04, D-36) ----------

/** The home last opened, so a start at sign-in syncs it again; and whether to start at sign-in (on by default). */
interface AppSettings { home?: { mode: HomeMode; path?: string }; startAtSignIn?: boolean }
const appSettingsPath = () => join(app.getPath('userData'), 'app-settings.json');
let appSettings: AppSettings = {};
async function loadAppSettings() { try { appSettings = JSON.parse(await readFile(appSettingsPath(), 'utf8')) ?? {}; } catch { appSettings = {}; } }
async function saveAppSettings(change: Partial<AppSettings>) {
  appSettings = { ...appSettings, ...change };
  if (smoke) return;
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(appSettingsPath(), `${JSON.stringify(appSettings, null, 2)}\n`);
}
/** A login item is registered only for an installed app, so a test or dev build never adds itself to sign-in. */
const canStartAtSignIn = () => app.isPackaged && !smoke && (process.platform !== 'darwin' || app.getPath('exe').startsWith('/Applications/'));
function applySignIn() {
  if (canStartAtSignIn()) app.setLoginItemSettings({ openAtLogin: appSettings.startAtSignIn !== false, args: ['--hidden'] });
}
/**
 * On by default (PLT-03): registered at the first launch of an installed app, then left alone. Turning it off in System Settings'
 * Login Items is respected; the menu shows the system's current answer.
 */
async function firstSignIn() {
  if (!canStartAtSignIn() || appSettings.startAtSignIn !== undefined) return;
  await saveAppSettings({ startAtSignIn: true });
  applySignIn();
}
const startsAtSignIn = () => canStartAtSignIn() && app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
const startedHidden = () => process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);

let tray: Tray | undefined;
let quitting = false;
/** Sync changed something while the window was closed or in the background: the menu bar icon shows it until seen. */
let unseen = false;
function showWindow() {
  if (!app.isReady()) return;
  if (!window || window.isDestroyed()) { createWindow(true); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function trayMenu() {
  const where = current?.label ?? 'No home open yet';
  return Menu.buildFromTemplate([
    { label: 'Open Central Knot', click: showWindow },
    { type: 'separator' },
    { label: unseen ? 'Sync made changes. Open to see them.' : `${syncOn ? 'Sync on' : 'Sync off'} · ${where}`, enabled: false },
    { label: 'Sync', type: 'checkbox', checked: syncOn, click: item => void fromTray(async () => { await saveSyncSetting(item.checked); }) },
    { label: 'Sync now', enabled: !!current, click: () => void fromTray(async () => { await pass(true); }) },
    { type: 'separator' },
    { label: canStartAtSignIn() ? 'Start at sign-in' : 'Start at sign-in (move Central Knot to Applications first)', type: 'checkbox', checked: startsAtSignIn(), enabled: canStartAtSignIn(),
      click: item => void saveAppSettings({ startAtSignIn: item.checked }).then(() => { applySignIn(); refreshTray(); }) },
    { type: 'separator' },
    { label: 'Quit Central Knot', click: () => { quitting = true; app.quit(); } },
  ]);
}
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(trayMenu());
  tray.setToolTip(unseen ? 'Central Knot: sync made changes' : 'Central Knot');
  if (process.platform === 'darwin') tray.setTitle(unseen ? '•' : '');
}
/** Menu bar actions take their turn like the page's, then tell the page. */
async function fromTray(work: () => Promise<void>) {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  await next.catch(() => undefined);
  refreshTray();
  if (window && !window.isDestroyed()) window.webContents.send('sync:changed');
}
function makeTray() {
  if (smoke || tray) return;
  const image = nativeImage.createFromBuffer(Buffer.from(trayIconPng, 'base64'), { scaleFactor: 2 });
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.on('click', () => { if (process.platform !== 'darwin') showWindow(); });
  refreshTray();
}

/** What background passes did since the page last read, so no notice is lost between reads. */
let pendingResults: ApplyResult['results'] = [];
let pendingNotices: NonNullable<ApplyResult['notices']> = [];
let lastStopped: string | undefined;
/** What MCP sync did on its own since the page last read, and whether the last pass changed anything. */
let pendingMcpNotices: NonNullable<ApplyResult['notices']> = [];
let mcpChanged = false;
/** An MCP or agent deletion is inside its settle window: the background looks again shortly, as for skills. */
let otherSettling = false;

/** One pass on the open home: writes only with Sync on (or when asked explicitly), otherwise it just keeps the evidence. */
async function pass(explicit = false): Promise<ApplyResult | undefined> {
  const shared = context();
  if (!(await writeAccess(shared)).allowed || (await syncGate(shared)).state !== 'ready') return undefined;
  const result = await applyChanges(shared, [], false, { observeOnly: !syncOn && !explicit });
  // MCP servers catch up with the same switch: edits and deletions spread with Sync on (Claude Code still waits for Write now).
  if (syncOn || explicit) {
    const mcp = await applyMcp(shared, (await manageView(shared)).tools, []).catch(() => undefined);
    pendingMcpNotices.push(...(mcp?.notices ?? []));
    // Agents follow the same switch and rules (D-32).
    const agents = await applyAgents(shared, (await manageView(shared)).tools, []).catch(() => undefined);
    pendingMcpNotices.push(...(agents?.notices ?? []));
    mcpChanged = !!(mcp?.writes || mcp?.notices?.length || agents?.writes || agents?.notices?.length);
    otherSettling = !!(mcp?.settling || agents?.settling);
  }
  return result;
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
    ...(await (async () => {
      const notices = pendingMcpNotices.splice(0);
      return {
        mcp: await mcpView(shared, presentTools(snapshots), notices.filter(notice => !notice.key.startsWith('agent:'))),
        agents: await agentsView(shared, presentTools(snapshots), notices.filter(notice => notice.key.startsWith('agent:'))),
      };
    })()),
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
    const fromEvent = touched;
    touched = false;
    const result = await pass();
    // Sync off: an edit or deletion is only noted. The page reads again quietly so it shows as waiting, not as Synced.
    if (fromEvent && !syncOn && !window.isDestroyed()) window.webContents.send('sync:changed');
    // A deletion waits out its settle window: look again just after it, so it finishes without a click. Otherwise wait for an event or the poll.
    if (result?.settling || otherSettling) { clearTimeout(followUp); followUp = setTimeout(background, 2_500); }
    if (result?.stopped && result.stopped !== lastStopped) {
      lastStopped = result.stopped;
      pendingResults.push({ item: 'Sync', outcome: 'failed', message: result.stopped });
      if (!window.isDestroyed()) window.webContents.send('sync:changed');
    }
    if (!result?.stopped) lastStopped = undefined;
    if (!result || (!result.harnessWrites && !result.notices?.length && !mcpChanged)) return;
    pendingResults.push(...result.results);
    pendingNotices.push(...(result.notices ?? []));
    if (!window.isDestroyed()) window.webContents.send('sync:changed');
    // Nobody saw it: the window is closed, gone or behind other windows (D-36).
    if (window.isDestroyed() || !window.isVisible() || !window.isFocused()) { unseen = true; refreshTray(); }
  });
  queue = work.catch(() => undefined);
}

/** A watcher event since the last pass: with Sync off nothing is written, but the page still shows the edit as pending. */
let touched = false;
const nudge = () => { touched = true; clearTimeout(soon); soon = setTimeout(background, DEBOUNCE_MS); };

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
  // Agents folders too: an agent edited in one tool spreads like a skill (D-32).
  for (const id of agentTools) roots.add(join(overrideFor(id) ?? join(current.home, harnesses[id].defaultConfig), 'agents'));
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

async function selectHome(mode: HomeMode, remembered?: string): Promise<HomeView | null> {
  let next: NonNullable<typeof current>;
  if (mode === 'custom') {
    let folder = remembered;
    if (!folder) {
      const selection = await dialog.showOpenDialog(window, { title: 'Choose a simulated home folder', properties: ['openDirectory'] });
      if (selection.canceled) return null;
      folder = selection.filePaths[0];
    }
    next = { mode, home: folder, label: 'Selected folder' };
  } else if (mode === 'actual') next = { mode, home: homedir(), label: 'This Mac’s home' };
  else next = { mode, home: await ensurePracticeHome(), label: 'Practice copy' };
  // A switch that fails changes nothing: the home on screen stays the home open here.
  const previous = current;
  current = next;
  try {
    const shown = await view();
    void startWatching();
    await saveAppSettings({ home: { mode: next.mode, path: next.mode === 'custom' ? next.home : undefined } });
    refreshTray();
    return shown;
  } catch (error) { current = previous; throw error; }
}

/** At launch: the home last opened, else the practice copy. A remembered folder that is gone falls back to the practice copy. */
async function startHome(): Promise<HomeView | null> {
  const last = smoke ? undefined : appSettings.home;
  if (last?.mode === 'actual') return selectHome('actual');
  if (last?.mode === 'custom' && last.path) { try { await access(last.path); return await selectHome('custom', last.path); } catch { /* gone */ } }
  return selectHome('fixture');
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

/** The main window. Closing it hides it (PLT-04); if it is ever gone, Open from the menu bar makes a new one. */
let loading: Promise<void> = Promise.resolve();
function createWindow(show: boolean) {
  window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 860, minHeight: 560, show,
    title: 'Central Knot', backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#fbfbfc',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => { if (quitting || !tray) return; event.preventDefault(); window.hide(); });
  window.on('focus', () => { if (unseen) { unseen = false; refreshTray(); } });
  const design = process.argv.find(arg => arg.startsWith('--design-preview'));
  loading = window.loadFile(join(__dirname, 'index.html'), design ? { query: { design: design.split('=')[1] ?? 'b3' } } : undefined);
}

if (!smoke && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; });
// A signal to stop is a Quit, not a window close: nothing waits in the menu bar.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { quitting = true; app.quit(); });

app.whenReady().then(async () => {
  await loadSyncSetting();
  await loadAppSettings();
  await firstSignIn();
  makeTray();
  createWindow(!smoke && !startedHidden());
  handle('discovery:select', async mode => {
    if (!['fixture', 'custom', 'actual'].includes(String(mode))) throw new Error('Invalid home selection.');
    if (smoke && mode !== 'fixture') throw new Error('Smoke test is fixture-only.');
    return selectHome(mode as HomeMode);
  });
  handle('discovery:start', async () => startHome());
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
  handle('history:restore', async (eventId, resume, home, choice) => (home === current?.home && typeof eventId === 'string'
    ? await (async () => {
      const key = (await readHistory(current!.home)).find(entry => entry.id === eventId)?.key ?? '';
      const tools = (await manageView(context())).tools;
      if (key.startsWith('mcp:')) return restoreMcp(context(), tools, eventId).then(result => ({ stopped: result.stopped, results: result.results, harnessWrites: result.writes }));
      if (key.startsWith('agent:')) return restoreAgent(context(), tools, eventId, typeof choice === 'string' ? choice : undefined).then(result => ({ stopped: result.stopped, results: result.results, harnessWrites: result.writes }));
      return restoreFromHistory(context(), eventId, resume === true, typeof choice === 'string' ? choice : undefined);
    })()
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0 } satisfies ApplyResult));
  handle('manage:delete-everywhere', async (key, resume, home) => (home === current?.home && typeof key === 'string'
    ? deleteEverywhere(context(), key, resume === true)
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0 } satisfies ApplyResult));
  handle('sync:set', async on => { await saveSyncSetting(on === true); return current ? view() : null; });
  handle('sync:now', async home => (home === current?.home ? view(true) : null));
  // With Sync off, Apply all writes exactly the skills it shows; spreading anything else waits for Sync.
  // MCP: Apply all writes Copilot and Codex; Claude Code only through Write now, once Claude is closed (MCP-02).
  handle('mcp:apply', async (list, home) => (home === current?.home
    ? applyMcp(context(), (await manageView(context())).tools, changes(list), syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  handle('agents:apply', async (list, home) => (home === current?.home
    ? applyAgents(context(), (await manageView(context())).tools, changes(list), syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  handle('mcp:write-claude', async (names, home) => (home === current?.home && Array.isArray(names)
    ? applyMcp(context(), (await manageView(context())).tools, [], { claudeNow: names.filter((name): name is string => typeof name === 'string'), only: new Set(names.filter((name): name is string => typeof name === 'string')) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  handle('manage:apply', async (list, resume, home) => (home === current?.home
    ? applyChanges(context(), changes(list), resume === true, syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0 } satisfies ApplyResult));
  await loading;
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

app.on('window-all-closed', () => { if (tray && !quitting) return; stopWatching(); app.quit(); });
app.on('will-quit', () => { stopWatching(); if (practiceHome) rmSync(practiceHome, { recursive: true, force: true }); });
