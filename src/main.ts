import { onlyAllowed } from './values.ts';
import { execFile } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { appendFileSync, mkdtempSync, rmSync, watch, type FSWatcher } from 'node:fs';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { discover } from './discovery.ts';
import { configRoot, harnesses, harnessIds, writeRoot } from './harnesses.ts';
import { executableCandidates } from './platform.ts';
import { syncGate, writeAccess, type ShareContext } from './share.ts';
import { applyChanges, deleteEverywhere, eventChange, manageView, readHistory, restoreFromHistory } from './manage.ts';
import { presentTools } from './presence.ts';
import { applyMcp, mcpFile, mcpTools, mcpView, restoreMcp, undoClaudeWrite } from './mcp.ts';
import { agentTools, agentsView, applyAgents, convertAgentToSkill, restoreAgent } from './agents.ts';
import { instructionsView, instructionVersion, saveInstruction } from './instructions.ts';
import { registerMarketplaces } from './marketplaces.ts';
import { trayIconPng } from './trayicon.ts';
import type { Appearance, ApplyResult, AppPreferences, Change, ClaudeWrite, DestinationResult, HarnessId, HomeMode, HomeView, Snapshot, SyncNotice } from './types.ts';

const smoke = process.argv.includes('--smoke-test');
/** A short main-process log (window life and failed requests) in the app's data folder, for finding out what happened on a tester's Mac. */
function log(line: string) {
  try { appendFileSync(join(app.getPath('userData'), 'central-knot.log'), `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ }
}
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'central-knot-smoke-')));
const BUILD = 'com.centralknot.firstlook';
let window: BrowserWindow;
let current: { mode: HomeMode; home: string; label: string } | undefined;
/** Whether the open home can be written; read with each view, so the menus can say "preview only" like the window. */
let homeWritable = true;
let lastManagedCount = 0;
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

/** The tools as last read, for features that need what was detected (the Plugins page: bundled-only copies). */
let latestSnapshots: Snapshot[] = [];

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
interface AppSettings { home?: { mode: HomeMode; path?: string }; startAtSignIn?: boolean; /** The first close said once that Central Knot keeps running. */ closeExplained?: boolean; /** Light, dark, or as the system is set (the default). */ appearance?: Appearance }
const appSettingsPath = () => join(app.getPath('userData'), 'app-settings.json');
let appSettings: AppSettings = {};
async function loadAppSettings() { try { appSettings = JSON.parse(await readFile(appSettingsPath(), 'utf8')) ?? {}; } catch { appSettings = {}; } }
async function saveAppSettings(change: Partial<AppSettings>) {
  appSettings = { ...appSettings, ...change };
  if (smoke) return;
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(appSettingsPath(), `${JSON.stringify(appSettings, null, 2)}\n`);
}
const appearances: Appearance[] = ['system', 'light', 'dark'];
const preferences = (): AppPreferences => ({ appearance: appSettings.appearance ?? 'system' });
/**
 * Applies the appearance setting. Electron's theme source decides `prefers-color-scheme` for the page, so every page's
 * light and dark styles follow it; the window's own background (seen while it draws) follows too.
 */
function applyAppearance() {
  nativeTheme.themeSource = preferences().appearance;
  if (window && !window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#000000' : '#fbfbfc');
}
/** Shows the window on one of its pages (the Settings… menu item). */
function showPage(page: string) {
  showWindow();
  if (window && !window.isDestroyed()) window.webContents.send('navigate', page);
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
  // Startup makes the first window. macOS sends `activate` during startup too: that must never make a second one.
  if (!app.isReady() || !window) return;
  if (window.isDestroyed()) { createWindow(true); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
/** One status line for both menus: where, and any news. */
function statusLine() {
  const where = current?.label ?? 'No home open yet';
  return unseen ? `Sync made changes · Show (${where})` : `Home: ${where}${current && lastManagedCount === 0 ? ' · nothing managed yet' : ''}`;
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Central Knot', click: showWindow },
    { label: 'Settings…', click: () => showPage('settings') },
    { type: 'separator' },
    // The status line says where, and any news; the checkbox below already says whether sync is on.
    { label: statusLine(), enabled: unseen, click: showWindow },
    { label: homeWritable ? 'Automatic sync' : 'Automatic sync (paused: preview only)', type: 'checkbox', checked: syncOn && homeWritable, enabled: homeWritable, click: item => void fromTray(async () => { await saveSyncSetting(item.checked); }) },
    { label: 'Sync once (automatic sync stays off)', toolTip: 'Apply waiting changes once', visible: !syncOn && homeWritable, enabled: !!current, click: () => void fromTray(async () => { keepMcpAndAgents((await pass(true)).mcpAndAgents); }) },
    { type: 'separator' },
    { label: canStartAtSignIn() ? 'Start at sign-in' : 'Start at sign-in (move Central Knot to Applications first)', type: 'checkbox', checked: startsAtSignIn(), enabled: canStartAtSignIn(), visible: process.platform !== 'linux',
      click: item => void saveAppSettings({ startAtSignIn: item.checked }).then(() => { applySignIn(); refreshTray(); }) },
    { type: 'separator' },
    { label: syncOn && homeWritable && lastManagedCount > 0 ? 'Quit Central Knot (stops syncing)' : 'Quit Central Knot', click: () => { quitting = true; app.quit(); } },
  ]);
}
function refreshTray() {
  appMenu();
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
/**
 * The app menu carries the menu bar's controls too, so they are always reachable: a crowded menu bar (or the notch) can hide the
 * icon. Edit and Window keep the standard shortcuts (copy, paste, close, minimise).
 */
function appMenu() {
  // Off macOS the window has no menu bar: the tray icon carries these controls, and Electron's stock developer menus never show.
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' },
      { label: 'Settings…', accelerator: 'Command+,', click: () => showPage('settings') },
      // The same status line as the menu bar menu: where, and any news.
      { label: statusLine(), enabled: unseen, click: showWindow },
      { type: 'separator' },
      { label: homeWritable ? 'Automatic sync' : 'Automatic sync (paused: preview only)', type: 'checkbox', checked: syncOn && homeWritable, enabled: homeWritable, click: item => void fromTray(async () => { await saveSyncSetting(item.checked); }) },
      { label: 'Sync once (automatic sync stays off)', toolTip: 'Apply waiting changes once', visible: !syncOn && homeWritable, enabled: !!current, click: () => void fromTray(async () => { keepMcpAndAgents((await pass(true)).mcpAndAgents); }) },
      { label: canStartAtSignIn() ? 'Start at sign-in' : 'Start at sign-in (move Central Knot to Applications first)', type: 'checkbox', checked: startsAtSignIn(), enabled: canStartAtSignIn(),
        click: item => void saveAppSettings({ startAtSignIn: item.checked }).then(() => { applySignIn(); refreshTray(); }) },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { label: syncOn && homeWritable && lastManagedCount > 0 ? 'Quit Central Knot (stops syncing)' : 'Quit Central Knot', accelerator: 'Command+Q', click: () => { quitting = true; app.quit(); } },
    ] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function makeTray() {
  if (smoke || tray) return;
  const image = nativeImage.createFromBuffer(Buffer.from(trayIconPng, 'base64'), { scaleFactor: 2 });
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.on('click', () => { if (process.platform !== 'darwin') showWindow(); });
  refreshTray();
}

/** What passes did since the page last read, so no notice is lost between reads. */
let pendingResults: DestinationResult[] = [], pendingNotices: SyncNotice[] = [];
let pendingMcpNotices: SyncNotice[] = [], pendingAgentNotices: SyncNotice[] = [];
let lastStopped: string | undefined;

interface McpAndAgentsResult { failures: DestinationResult[]; stopped: DestinationResult[]; mcpNotices: SyncNotice[]; agentNotices: SyncNotice[]; changed: boolean; settling: boolean }
interface PassResult { skills?: ApplyResult; mcpAndAgents?: McpAndAgentsResult }

/** One pass on the open home: writes only with Sync on (or when asked explicitly), otherwise it just keeps the evidence. */
async function pass(explicit = false): Promise<PassResult> {
  const shared = context();
  if (!(await writeAccess(shared)).allowed || (await syncGate(shared)).state !== 'ready') return {};
  const skills = await applyChanges(shared, [], false, { observeOnly: !syncOn && !explicit });
  // MCP servers catch up with the same switch: edits and deletions spread with Sync on (Claude Code still waits for Write now).
  if (!syncOn && !explicit) return { skills };
  const tools = (await manageView(shared)).tools;
  const crashes: DestinationResult[] = [];
  const crashed = (item: string) => (error: unknown) => { crashes.push({ item, outcome: 'failed', message: `${item} could not finish: ${error instanceof Error ? error.message : String(error)}` }); return undefined; };
  const mcp = await applyMcp(shared, tools, []).catch(crashed('MCP sync'));
  // Agents follow the same switch and rules (D-32).
  const agents = await applyAgents(shared, tools, []).catch(crashed('Agents sync'));
  return { skills, mcpAndAgents: {
    failures: [...crashes, ...[...(mcp?.results ?? []), ...(agents?.results ?? [])].filter(entry => entry.outcome === 'failed')],
    stopped: ([['MCP sync', mcp?.stopped], ['Agents sync', agents?.stopped]] as const).filter(([, why]) => why).map(([item, why]) => ({ item, outcome: 'failed' as const, message: why! })),
    mcpNotices: mcp?.notices ?? [], agentNotices: agents?.notices ?? [], settling: !!(mcp?.settling || agents?.settling),
    changed: !!(mcp?.writes || mcp?.notices?.length || agents?.writes || agents?.notices?.length) } };
}

/** A failed MCP or agents pass, or a copy it could not write, is told on the page, never dropped. */
function keepMcpAndAgents(outcome: McpAndAgentsResult | undefined) {
  if (!outcome) return;
  for (const failure of outcome.failures) if (!pendingResults.some(known => known.item === failure.item && known.harness === failure.harness && known.message === failure.message)) pendingResults.push(failure);
  for (const stop of outcome.stopped) if (!pendingResults.some(known => known.message === stop.message)) pendingResults.push(stop);
  pendingMcpNotices.push(...outcome.mcpNotices);
  pendingAgentNotices.push(...outcome.agentNotices);
}

async function syncThenView(explicit = false): Promise<HomeView> {
  const shared = context();
  const { skills, mcpAndAgents } = await pass(explicit);
  keepMcpAndAgents(mcpAndAgents);
  // A pass that could not finish says so on the page instead of failing quietly.
  const caughtUp = [...pendingResults.splice(0), ...(skills?.results ?? []), ...(skills?.stopped ? [{ item: 'Sync', outcome: 'failed' as const, message: skills.stopped }] : [])];
  const notices = [...pendingNotices.splice(0), ...(skills?.notices ?? [])];
  const snapshots = await read();
  latestSnapshots = snapshots;
  const writable = (await writeAccess(shared)).allowed;
  if (writable !== homeWritable) { homeWritable = writable; refreshTray(); }
  const made: HomeView = {
    mode: current!.mode, label: current!.label, home: current!.home, snapshots, syncOn, practice: practiceAvailable(),
    manage: await manageView(shared, caughtUp.filter(result => result.outcome === 'written' || result.outcome === 'removed' || result.outcome === 'failed' || result.chooseAgain), notices),
    mcp: await mcpView(shared, presentTools(snapshots), pendingMcpNotices.splice(0)),
    agents: await agentsView(shared, presentTools(snapshots), pendingAgentNotices.splice(0)),
  };
  // How many items are managed, so the first-close note says truthfully whether anything syncs.
  lastManagedCount = [...made.manage.skills, ...made.mcp.servers, ...(made.agents?.servers ?? [])].filter(fact => fact.managed).length;
  return made;
}

/** Background passes run through the same queue as the page's requests, one at a time, and tell the page when something changed. */
const POLL_MS = 20_000;
const DEBOUNCE_MS = 1_500;
let watchers: FSWatcher[] = [];
let poller: NodeJS.Timeout | undefined;
let soon: NodeJS.Timeout | undefined;
let followUp: NodeJS.Timeout | undefined;
/** A watcher event since the last pass: with Sync off nothing is written, but the page still shows the edit as pending. */
let touched = false;

/** One thing at a time: planning and writing never interleave. */
let queue: Promise<unknown> = Promise.resolve();
function queueBackgroundPass() { if (current && !smoke) queue = queue.then(backgroundPass).catch(() => undefined); }

async function backgroundPass() {
  if (!current) return;
  const fromEvent = touched;
  touched = false;
  const { skills, mcpAndAgents } = await pass();
  keepMcpAndAgents(mcpAndAgents);
  // Sync off: an edit or deletion is only noted. The page reads again quietly so it shows as waiting, not as Synced.
  if (fromEvent && !syncOn && !window.isDestroyed()) window.webContents.send('sync:changed');
  // A deletion waits out its settle window: look again just after it, so it finishes without a click. Otherwise wait for an event or the poll.
  if (skills?.settling || mcpAndAgents?.settling) { clearTimeout(followUp); followUp = setTimeout(queueBackgroundPass, 2_500); }
  if (skills?.stopped && skills.stopped !== lastStopped) {
    pendingResults.push({ item: 'Sync', outcome: 'failed', message: skills.stopped });
    if (!window.isDestroyed()) window.webContents.send('sync:changed');
  }
  lastStopped = skills?.stopped;
  if (!skills || (!skills.harnessWrites && !skills.notices?.length && !mcpAndAgents?.changed)) return;
  pendingResults.push(...skills.results);
  pendingNotices.push(...(skills.notices ?? []));
  if (!window.isDestroyed()) window.webContents.send('sync:changed');
  // Nobody saw it: the window is closed, gone or behind other windows (D-36).
  if (window.isDestroyed() || !window.isVisible() || !window.isFocused()) { unseen = true; refreshTray(); }
}

const nudge = () => { touched = true; clearTimeout(soon); soon = setTimeout(queueBackgroundPass, DEBOUNCE_MS); };

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
  for (const id of agentTools) roots.add(join(configRoot(harnesses[id], current.home, overrideFor(id)), 'agents'));
  // MCP settings files: their folders are watched without recursion, and only an event for the file itself prompts a read.
  const shared = context();
  for (const id of mcpTools) {
    const file = mcpFile(shared, id);
    try { watchers.push(watch(dirname(file), { persistent: false }, (_event, name) => { if (!name || name === basename(file)) nudge(); })); } catch { /* not there: polling covers it */ }
  }
  for (const root of roots) {
    try { watchers.push(watch(root, { recursive: true, persistent: false }, nudge)); } catch { /* not there: polling covers it */ }
  }
  poller = setInterval(queueBackgroundPass, POLL_MS);
}


/** Whether a Claude Code process is running (macOS and Linux). When this can't be told, Write now goes ahead as asked. */
function claudeRunning(): Promise<boolean> {
  if (current?.mode !== 'actual' || process.platform === 'win32') return Promise.resolve(false);
  // The native `claude` binary, or Claude Code run through node (an npm install shows as node with its package in the command).
  const found = (args: string[]) => new Promise<boolean>(done => execFile('pgrep', args, error => done(!error)));
  // Only node running the package's CLI counts, never a shell or search that merely mentions the package.
  // A global npm install runs as `node …/bin/claude`.
  return found(['-x', 'claude']).then(native => native || found(['-f', '^[^ ]*node .*(@anthropic-ai/claude-code/|/bin/claude( |$))']));
}

async function selectHome(mode: HomeMode, remembered?: string): Promise<HomeView | null> {
  let next: NonNullable<typeof current>;
  if (mode === 'custom') {
    let folder = remembered;
    if (!folder) {
      const selection = await dialog.showOpenDialog(window, { title: 'Choose a home folder', message: 'Choose a folder that contains .claude, .copilot or .codex.', buttonLabel: 'Open as home', properties: ['openDirectory', 'showHiddenFiles'] });
      if (selection.canceled) return null;
      folder = selection.filePaths[0];
    }
    // A chosen folder is called by its own name everywhere: status bar, results and sidebar.
    next = { mode, home: folder, label: folder.split(/[\\/]/).filter(Boolean).pop() ?? 'Folder' };
  } else if (mode === 'actual') next = { mode, home: homedir(), label: process.platform === 'darwin' ? 'This Mac’s home' : 'This computer’s home' };
  else next = { mode, home: await ensurePracticeHome(), label: 'Practice copy' };
  // A switch that fails changes nothing: the home on screen stays the home open here.
  const previous = current;
  current = next;
  try {
    const shown = await syncThenView();
    void startWatching();
    await saveAppSettings({ home: { mode: next.mode, path: next.mode === 'custom' ? next.home : undefined } });
    refreshTray();
    return shown;
  } catch (error) { current = previous; throw error; }
}

/**
 * The Practice copy (throwaway sample files) exists only in dev builds and tests. A released app works on this
 * computer's own home, and other folders can still be opened. Tests switch either way: `--practice-copy` offers it in a
 * packaged build, and `--as-released` makes a development build start as a released one.
 */
const practiceAvailable = () => smoke || process.argv.includes('--practice-copy') || (!app.isPackaged && !process.argv.includes('--as-released'));

/**
 * At launch: the home last opened, else this computer's home. A remembered folder that is gone falls back the same way.
 * Dev builds and tests start on the Practice copy instead, so a development run never syncs this machine's real tools.
 */
async function startHome(): Promise<HomeView | null> {
  // A window made while a home is already open (reopened from the menu bar or the Dock) shows that home; nothing is read anew.
  if (current) return syncThenView();
  const last = smoke ? undefined : appSettings.home;
  if (last?.mode === 'actual') return selectHome('actual');
  if (last?.mode === 'custom' && last.path) { try { await access(last.path); return await selectHome('custom', last.path); } catch { /* gone */ } }
  return selectHome(practiceAvailable() ? 'fixture' : 'actual');
}

const ids = (value: unknown) => onlyAllowed(value, harnessIds);

function handle(channel: string, work: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents) throw new Error('Unexpected sender.');
    const next = queue.then(() => work(...args));
    queue = next.catch(error => { log(`request ${channel} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); });
    return next;
  });
}

/**
 * A request that only reads Central Knot's own copies and writes nothing a tool reads (a README, a plugin's contents):
 * answered at once, outside the queue, so background reads never hold up a change the person asked for.
 */
function handleRead(channel: string, work: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents) throw new Error('Unexpected sender.');
    return work(...args);
  });
}

/** The main window. Closing it hides it (PLT-04); if it is ever gone, Open from the menu bar makes a new one. */
let loading: Promise<void> = Promise.resolve();
function createWindow(show: boolean) {
  // One window at a time: a second would get no answers (requests are only taken from the current window).
  if (window && !window.isDestroyed()) { if (show) { window.show(); window.focus(); } return; }
  window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 860, minHeight: 560, show,
    title: 'Central Knot', backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#fbfbfc',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  log('window created');
  window.on('close', event => {
    log(`window close (${quitting ? 'quitting' : tray ? 'hidden' : 'no menu bar icon'})`);
    if (quitting || !tray) return;
    event.preventDefault();
    const shown = window;
    shown.hide();
    // The first time only: say where Central Knot went (truthfully: syncing only if something syncs), offer to quit instead, and
    // show the sign-in start it turned on, so neither a hidden window nor a login item is a surprise.
    if (!appSettings.closeExplained && !smoke) {
      void saveAppSettings({ closeExplained: true });
      const icon = process.platform === 'darwin' ? 'menu bar' : 'tray';
      const syncing = syncOn && homeWritable && lastManagedCount > 0;
      void dialog.showMessageBox({
        type: 'info', buttons: ['OK', 'Quit instead'], defaultId: 0, cancelId: 0,
        message: syncing ? 'Central Knot keeps syncing in the background' : 'Central Knot is still running',
        detail: syncing ? `Open it again from its ${icon} icon, or open Central Knot again. To stop syncing, choose Quit Central Knot there.` : `Nothing is syncing yet. Open it again from its ${icon} icon or by opening Central Knot again. To quit, choose Quit Central Knot from that icon.`,
        ...(canStartAtSignIn() ? { checkboxLabel: 'Start Central Knot at sign-in', checkboxChecked: startsAtSignIn() } : {}),
      }).then(({ response, checkboxChecked }) => {
        if (canStartAtSignIn() && checkboxChecked !== startsAtSignIn()) void saveAppSettings({ startAtSignIn: checkboxChecked }).then(() => { applySignIn(); refreshTray(); });
        if (response === 1) { quitting = true; app.quit(); }
      });
    }
  });
  window.on('closed', () => log('window closed'));
  window.webContents.on('render-process-gone', (_event, details) => log(`page process gone: ${details.reason}`));
  window.webContents.on('did-finish-load', () => log('page loaded'));
  window.on('focus', () => { if (unseen) { unseen = false; refreshTray(); } });
  const design = process.argv.find(arg => arg.startsWith('--design-preview'));
  loading = window.loadFile(join(__dirname, 'index.html'), design ? { query: { design: design.split('=')[1] ?? 'b3' } } : undefined);
}

// One Central Knot at a time: a second launch hands over to the first (which shows its window) and exits at once, before it opens
// a window of its own. app.quit() would let it start up first.
const primary = smoke || app.requestSingleInstanceLock();
if (!primary) app.exit(0);
app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; });
// A signal to stop is a Quit, not a window close: nothing waits in the menu bar.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { quitting = true; app.quit(); });

app.whenReady().then(async () => {
  if (!primary) return;
  await loadSyncSetting();
  await loadAppSettings();
  applyAppearance();
  await firstSignIn();
  makeTray();
  createWindow(!smoke && !startedHidden());
  handle('settings:get', async () => preferences());
  handle('settings:appearance', async appearance => {
    if (!appearances.includes(appearance as Appearance)) throw new Error('Invalid appearance.');
    await saveAppSettings({ appearance: appearance as Appearance });
    applyAppearance();
    return preferences();
  });
  handle('discovery:select', async mode => {
    if (!['fixture', 'custom', 'actual'].includes(String(mode))) throw new Error('Invalid home selection.');
    if (smoke && mode !== 'fixture') throw new Error('Smoke test is fixture-only.');
    if (mode === 'fixture' && !practiceAvailable()) throw new Error('The practice copy is only in development builds.');
    return selectHome(mode as HomeMode);
  });
  handle('discovery:start', async () => startHome());
  handle('discovery:refresh', async () => (current ? syncThenView() : null));
  // Writes act only on the home the window says it is showing.
  const changes = (value: unknown): Change[] => (Array.isArray(value) ? value : []).filter((change): change is Change =>
    typeof change?.key === 'string' && typeof change.managed === 'boolean' && Array.isArray(change.off)
    && (change.use === undefined || change.use === 'separate' || harnessIds.includes(change.use)) && (change.useHash === undefined || typeof change.useHash === 'string') && (change.seenManaged === undefined || typeof change.seenManaged === 'boolean')).map(change => ({ key: change.key, managed: change.managed, off: ids(change.off), use: change.use, useHash: change.useHash, seenManaged: change.seenManaged }));
  // Marketplaces and plugins: their own module, given only what it needs from here.
  registerMarketplaces({ handle, handleRead }, {
    home: () => (current ? { home: current.home, snapshots: latestSnapshots, overrides: context().overrides } : undefined),
    tools: async () => presentTools(latestSnapshots),
    writeAccess: () => writeAccess(context()),
    dataDir: app.getPath('userData'),
    pickFolder: async () => { const choice = await dialog.showOpenDialog(window, { title: 'Choose a marketplace folder', properties: ['openDirectory'] }); return choice.canceled ? undefined : choice.filePaths[0]; },
    openExternal: url => shell.openExternal(url),
  });
  handle('history:list', async () => (current ? readHistory(current.home) : []));
  // Instruction files: read fresh each time; a save writes only the file the editor opened, for the home on screen.
  // Reveal only: the file manager selects it; nothing is opened, run or written.
  handle('file:show', async path => { if (typeof path === 'string' && isAbsolute(path)) shell.showItemInFolder(path); });
  handle('history:change', async eventId => (current && typeof eventId === 'string' ? eventChange(context(), eventId) : undefined));
  handle('agents:convert', async (key, home) => (home === current?.home && typeof key === 'string'
    ? convertAgentToSkill(context(), presentTools(await read()), key)
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.' }));
  handle('instructions:view', async () => (current ? instructionsView(context(), await read()) : null));
  handle('instructions:save', async (tool, text, expected, home) => (home === current?.home && typeof tool === 'string' && typeof text === 'string' && typeof expected === 'string'
    ? saveInstruction(context(), await read(), tool as HarnessId, text, expected)
    : { stopped: 'The home on screen is not the one open. Nothing was saved. Read it again.' }));
  handle('instructions:version', async (tool, id) => (current && typeof tool === 'string' && typeof id === 'string' ? instructionVersion(context(), tool as HarnessId, id) : undefined));
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
  handle('sync:set', async on => { await saveSyncSetting(on === true); return current ? syncThenView() : null; });
  handle('sync:now', async home => (home === current?.home ? syncThenView(true) : null));
  // With Sync off, Apply all writes exactly the skills it shows; spreading anything else waits for Sync.
  // MCP: Apply all writes every tool but Claude Code; Claude Code only through Write now, once Claude is closed (MCP-02).
  handle('mcp:apply', async (list, resume, home) => (home === current?.home
    ? applyMcp(context(), (await manageView(context())).tools, changes(list), { resume: resume === true, ...(syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) }) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  handle('agents:apply', async (list, resume, home) => (home === current?.home
    ? applyAgents(context(), (await manageView(context())).tools, changes(list), { resume: resume === true, ...(syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) }) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  // Write now is for when Claude Code is closed (MCP-02): a running Claude Code would write its older copy back over it.
  // Its Undo goes through the same check: Claude Code closed, or it would write its copy back over the undone one.
  handle('mcp:unwrite-claude', async (written, home) => (home === current?.home && Array.isArray(written)
    ? current?.mode !== 'fixture' && await claudeRunning() ? { stopped: 'Claude Code is still running. Quit it first, then click Undo again.', results: [], writes: 0 }
      : undoClaudeWrite(context(), written.filter((write): write is ClaudeWrite => !!write && typeof write.name === 'string' && typeof write.after === 'string' && (write.before === null || typeof write.before === 'string')))
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  handle('mcp:write-claude', async (names, home) => (home === current?.home && Array.isArray(names)
    // The practice copy is sample files: the real Claude Code never reads them, so it need not be closed there.
    ? current?.mode !== 'fixture' && await claudeRunning() ? { stopped: 'Claude Code is still running. Quit it first (every window and terminal session), then click Write to Claude Code again.', results: [], writes: 0 } : applyMcp(context(), (await manageView(context())).tools, [], { claudeNow: names.filter((name): name is string => typeof name === 'string'), ...(syncOn ? {} : { only: new Set(names.filter((name): name is string => typeof name === 'string')) }) })
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
            resolveResult({ rows: document.querySelectorAll('.kind-card').length, home: document.querySelector('#home-label').textContent, skills: view.manage.skills.map(skill => skill.key + ':' + Object.keys(skill.copies).length).join(','), allowed: view.manage.access.allowed });
          } else if (Date.now() > deadline) rejectResult(new Error('Renderer did not become ready'));
          else setTimeout(check, 30);
        }; check();
      })`);
      const skills = 'notes:2,release-notes:1,review:2,standup:1';
      // The Overview opens first: one card each for skills, MCP servers and agents.
      if (result.rows !== 3 || result.home !== 'Practice copy' || result.skills !== skills || !result.allowed) throw new Error('Unexpected fixture render.');
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
