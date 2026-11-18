// The main process (MAP.md, "The app's shell and Settings"): the window, the menu bar icon, the app menu and the Dock; the app's
// own settings (app-settings.json, AppSettings) and log; which home is open; whether another build of Central Knot holds this
// one (heldReason, from otherbuilds.ts: one install at a time), and a home's record taken over from another build (takeOverHome,
// the one place it changes hands); watching its folders and polling; and the queue each change takes its turn in (queued). It
// runs the pass of the whole home (pass, through homepass.ts homePass), builds the view every page reads (syncThenView:
// types.ts HomeView), and registers every IPC channel the page calls through preload.ts
// (the Plugins page's are marketplaces.ts's, registered with this module's handle). Each handler hands its request to an engine;
// a click on an item page goes through the `changes` sanitizer, which must copy each field of types.ts Change. Not here: what a
// change does (the engines: librarypass.ts and each kind, profiles.ts, sources.ts, gitrepo.ts, instructions.ts, plugins.ts) and
// what a page shows (from renderer.ts).
import { onlyAllowed, PRODUCT, record, strings } from './values.ts';
import packageInfo from '../package.json' with { type: 'json' };
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { discover, findOtherApps, forgetVersions } from './discovery.ts';
import { envOverride, harnesses, harnessIds, writeRoot } from './harnesses.ts';
import { appCandidates, executableCandidates, macPlaces, searchPath } from './platform.ts';
import { intoFolder, lookForBuilds, quitBuild, removeBuild, runsOutside, type BuildsContext } from './otherbuilds.ts';
import { forgetStale, leftOutNow, managedNow, readRecord, remember, syncGate, takeOverSync, writeAccess, type ShareContext } from './share.ts';
import { everythingEntryAction, setSyncEverything } from './everything.ts';
import { chooseTools, whatJoiningDoes } from './toolchoice.ts';
import { pruneHistory, readHistory } from './history.ts';
import { applySkills, clearSwitch, restoreSkill, skillChange, skillFolders, skillVersion, skillsView, takeOver } from './skills.ts';
import { agentTools, mcpTools, noteTools, pluginTools, presentTools } from './presence.ts';
import { forgetRefusals, installedPlugins } from './plugins.ts';
import { checkFeed, type FeedCheck } from './bundlefeed.ts';
import { mcpFile } from './mcp.ts';
import { switchPath } from './skillswitch.ts';
import { applyServers, restoreServer, serversView, serverVersion } from './servers.ts';
import { agentVersion, agentsView, applyAgents, restoreAgent } from './agents.ts';
import { agentsFolder } from './agentfiles.ts';
import { libraryEntry } from './historyactions.ts';
import { applyBase, baseView, instructionsView, instructionVersion, repoBase, saveInstruction, undoBase } from './instructions.ts';
import { clearDraftFolders, draftSources, draftTools, writeDraft } from './draftbase.ts';
import { registerMarketplaces } from './marketplaces.ts';
import { connectRepo, disconnectRepo, pullRepo, pushRepo, repoView, undoPulledBase, undoSettingsChange } from './gitrepo.ts';
import { addSource, checkDue, checkSource, previewSource, removeSource, rowClick, sourcesView } from './sources.ts';
import { readUsage } from './usage.ts';
import { linkLabel } from './sourcelink.ts';
import { readItemTexts, readPluginItems } from './pluginitems.ts';
import { trayIconPng } from './trayicon.ts';
import { homePass, passTells } from './homepass.ts';
import { deleteProfile, liveNow, readProfiles, saveProfile, switchProfile, undoSwitch } from './profiles.ts';
import { homeItems, inUse, inUseName, switchable, type LiveItem } from './profileplan.ts';
import { defaultHistoryDays, historyDayChoices, holdingBuild, holdsUntil } from './model.ts';
import { signInArgs, signInLabel, signInState, whyNoSignIn } from './signin.ts';
import type { ActionReport, Appearance, ApplyResult, BuildOutcome, OtherBuild, PartRef, AppPreferences, PluginActionResult, PluginUpdatesView, UpdateView, BaseApply, BaseDraft, BaseUndo, Change, DestinationResult, HarnessId, HistoryDays, HistoryList, HistoryPrune, HistoryWindowSaved, HomeMode, HomeView, PassResult as LibraryPass, ProfilesView, LogFolderOpened, LogTail, Snapshot, SyncNotice } from './types.ts';
import { machineNames, writesRealHome } from './machine.ts';
import { joinedWords, pageNames, toolList } from './words.ts';
import { buildTag, startUpdater, type PendingUpdate } from './updater.ts';
import { lineApp, releaseLine } from './updates.ts';
import { autoUpdates, CHECK_EVERY_MS, PLUGIN_UPDATES_DEFAULT, type UpdatesRecord } from './pluginupdates.ts';
import type { PluginDone } from './pluginplan.ts';
import { CARRIED_FOLDER, STANDARD_BUILD, aboutBuild, openBundle, readCustomBuildSync, releaseDate, releaseLabel, type ActiveBundle } from './bundle.ts';

const smoke = process.argv.includes('--smoke-test');
const logPath = () => join(app.getPath('userData'), 'central-knot.log');
/** A short main-process log (window life, failed requests, and what each change came to: see logOutcome) in the app's data folder, for finding out what happened on a tester's Mac. */
function log(line: string) {
  try { appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ }
}
/** Keeps the log short: once it passes a megabyte, only its newer half stays (from a line's start). Run once, at start. */
function trimLog() {
  try {
    if (statSync(logPath()).size < 1_000_000) return;
    const text = readFileSync(logPath(), 'utf8');
    writeFileSync(logPath(), text.slice(text.indexOf('\n', Math.floor(text.length / 2)) + 1));
  } catch { /* no log yet, or it can't be read: nothing to trim */ }
}
/** A custom build (bundle.ts): its identity file sits beside this code. */
const custom = readCustomBuildSync(__dirname);
/**
 * The app this build is: a custom build's own, or the one its release tag's line is (updates.ts lineApp: an alpha is
 * "Central Knot Alpha"); the standard app otherwise. Any other app than the standard one keeps its settings and log in a
 * folder of its own, so it never shares the standard app's settings (ORG-07); a build reads another's only to keep them when it
 * takes a home's record over from it (settingsFolderOf, keepSettingsOf). A data folder named on the command line (tests) still wins.
 */
const own = custom ?? lineApp(releaseLine(buildTag()));
if (own.bundleId !== STANDARD_BUILD) {
  app.setName(own.name);
  // Named by its bundle id, which no other app's folder is (a build named after a company could otherwise land in that company's own app's folder).
  if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), own.bundleId));
}
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'central-knot-smoke-')));
// Test-only, read only when set: an update's restart is opened by macOS afresh, with no arguments and the login's own HOME, so
// a test build carries its throwaway home, data folder and debug port in its environment (Info.plist LSEnvironment) instead
// of HOME, --user-data-dir and --remote-debugging-port (scripts/update-proof.mjs).
if (process.env.CK_TEST_HOME) process.env.HOME = process.env.CK_TEST_HOME;
if (process.env.CK_TEST_USER_DATA) app.setPath('userData', process.env.CK_TEST_USER_DATA);
if (process.env.CK_TEST_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.CK_TEST_DEBUG_PORT);
// Test-only too: CK_TEST_APPS names a folder that stands in for /Applications, the running apps and the Trash (platform.ts
// macPlaces), so a test never looks at or removes the real ones; with it, another build is looked for in a development run too.
const testApps = !!process.env.CK_TEST_APPS;
/** Whether this run looks for other builds of Central Knot (buildsContext): on a Mac in an installed app, or where a test named its stand-ins; never in a smoke run. */
const looksForBuilds = !smoke && ((process.platform === 'darwin' && app.isPackaged) || testApps);
// Asked now, while the window is being made, so the first read of this computer's tools doesn't wait on a shell's startup.
void searchPath();
/** This build's name in a home's sync record: its app's bundle id (the standard app's, the alpha's or a custom build's own). */
const BUILD = own.bundleId;
/** The marketplace a bundled build carries, as unpacked at open (bundle.ts); undefined for any other build, or when it couldn't be unpacked. */
let bundle: ActiveBundle | undefined;
let window: BrowserWindow;
let current: { mode: HomeMode; home: string; label: string } | undefined;
/** Whether the open home can be written; read with each view, so the menus can say "preview only" like the window. */
let homeWritable = true;
let lastManagedCount = 0;
/** The open home's profiles as last read, for the menu bar's Profile menu. */
let lastProfiles: ProfilesView = { profiles: [] };
/** The library's live items as last read (profileplan.ts LiveItem): which profile is in use is worked out from them. */
let lastItems: LiveItem[] = [];
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

const overrideFor = (id: HarnessId) => (current?.mode === 'actual' ? envOverride(harnesses[id], process.env) : undefined);

async function read(): Promise<Snapshot[]> {
  const { mode, home } = current!;
  const path = mode === 'actual' ? await searchPath() : '';
  return Promise.all(harnessIds.map(id => discover({
    home, mode, harness: id, configOverride: overrideFor(id),
    binaries: mode === 'actual' ? executableCandidates(home, path, harnesses[id].binary) : [],
    apps: mode === 'actual' ? appCandidates(home, harnesses[id].binary) : [],
    runProbes: mode === 'actual',
  })));
}

/**
 * The read the page's latest view was built from, handed over as the view's readId. A request made right after it
 * (Plugins after a Refresh or a home switch) passes the id back and uses this read rather than reading the home again.
 */
let handoff = { id: 0, home: '', snapshots: [] as Snapshot[] };

function context(): ShareContext {
  return {
    home: current!.home, mode: current!.mode, read, build: BUILD, buildName: own.name,
    settingsPath: join(app.getPath('userData'), 'sharing-settings.json'), realHome: homedir(),
    allowActualWrites: writesRealHome(process.platform) && !smoke,
    overrides: Object.fromEntries(harnessIds.map(id => [id, overrideFor(id)])),
    historyDays: historyDays(), held: heldReason(),
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
  // Plugin updates pause with Automatic sync (off means nothing is written to the tools in the background).
  await pluginUpdatesSwitched(on);
}
/** A switch that plugin updates follow was turned (their own in Settings, or Automatic sync): the page hears of it, and turned on, a check that is due runs now. */
async function pluginUpdatesSwitched(on: boolean) {
  if (!pluginUpdates) return;
  send('plugin-updates:changed', await pluginUpdates.view());
  if (on) void pluginUpdates.tick().catch(error => logFailure('plugin updates', error));
}

/** Sends the page a message, when there is a window to send it to. */
function send(channel: 'sync:changed' | 'settings:changed' | 'navigate' | 'updates:changed' | 'plugin-updates:changed' | 'said' | 'window:shown', ...args: unknown[]) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, ...args);
}

// ---------- Running in the background (PLT-03, PLT-04, D-36) ----------

/** The home last opened, so a start at sign-in syncs it again; and whether to start at sign-in (on by default). */
interface AppSettings { home?: { mode: HomeMode; path?: string }; startAtSignIn?: boolean; /** The first close said once that Central Knot keeps running. */ closeExplained?: boolean; /** Light, dark, or as the system is set (the default). */ appearance?: Appearance; /** How long History keeps things. */ historyDays?: HistoryDays; /** Plugins are updated automatically (pluginupdates.ts). */ pluginUpdates?: boolean; /** An update prepared for the next launch to report on (updater.ts). */ update?: PendingUpdate }
const appSettingsPath = () => join(app.getPath('userData'), 'app-settings.json');
let appSettings: AppSettings = {};
/** A file that isn't a JSON object (damaged, or hand-edited) counts as no settings yet: each one falls back to its default. */
async function loadAppSettings() {
  try {
    appSettings = record(JSON.parse(await readFile(appSettingsPath(), 'utf8'))) ?? {};
  } catch { appSettings = {}; }
}
/**
 * Every writer (the Settings page, the menu bar menu, the app menu, the first-close dialog, a home switch) saves through this
 * one chain, so writes never interleave. Each merges only its own fields into the settings as last saved, and keeps fields
 * this version doesn't know. It is not the sync queue: a settings change never waits behind sync. The memory copy changes
 * only once the file is written, so a failed save leaves the last saved value in force; the page hears of every saved change.
 */
let settingsWrites: Promise<unknown> = Promise.resolve();
function saveAppSettings(change: Partial<AppSettings>): Promise<void> {
  const write = settingsWrites.then(async () => {
    const next = { ...appSettings, ...change };
    if (!smoke) {
      await mkdir(app.getPath('userData'), { recursive: true });
      await writeFile(appSettingsPath(), `${JSON.stringify(next, null, 2)}\n`);
    }
    appSettings = next;
    // The login item follows the saved choice before anyone hears of it, so what they read back is the system's answer to it.
    if ('startAtSignIn' in change) applySignIn();
    refreshTray();
    send('settings:changed');
  });
  settingsWrites = write.catch(() => undefined);
  return write;
}
const appearances: Appearance[] = ['system', 'light', 'dark'];
/** The settings as the page shows them; a stored value this version doesn't offer counts as the default. */
const appearance = (): Appearance => appSettings.appearance && appearances.includes(appSettings.appearance) ? appSettings.appearance : 'system';
const isHistoryDays = (value: unknown): value is HistoryDays => historyDayChoices.includes(value as HistoryDays);
const historyDays = (): HistoryDays => isHistoryDays(appSettings.historyDays) ? appSettings.historyDays : defaultHistoryDays;
/**
 * Counts History window changes asked for: a queued one whose number is no longer the latest was overtaken and does nothing.
 * The page can't overtake itself (its row takes no other change until main answers); this is the backstop for a second caller.
 */
let historyRequests = 0;
/**
 * Every window change takes its turn in the queue, in the order asked, so none runs beside a sync pass or another change.
 * Whether it is shorter (and so prunes) is decided against the saved window when its turn comes, and one a newer request
 * overtook while it waited does nothing: the newest choice wins and an outdated shorter one never prunes. History reads the
 * saved window either way, so a prune that fails is logged and reported, never undoes the saved window.
 */
async function changeHistoryWindow(days: HistoryDays): Promise<HistoryWindowSaved> {
  const asked = ++historyRequests;
  const pruned = await queued(async (): Promise<HistoryPrune | undefined> => {
    if (asked !== historyRequests) return undefined;
    const shorter = days < historyDays();
    await saveAppSettings({ historyDays: days });
    if (!shorter) return undefined;
    if (!current) return 'no-home';
    return pruneHistory(context()).catch(error => { logFailure('history prune', error); return 'failed' as const; });
  });
  return { settings: preferences(), pruned };
}
/** Whether plugins are updated automatically: as chosen in Settings, else the default. */
const pluginUpdatesOn = () => (typeof appSettings.pluginUpdates === 'boolean' ? appSettings.pluginUpdates : PLUGIN_UPDATES_DEFAULT);
const preferences = (): AppPreferences => ({ appearance: appearance(), signIn: signIn(), historyDays: historyDays(), pluginUpdates: pluginUpdatesOn(),
  ...(custom ? { build: aboutBuild(custom, app.getVersion(), bundle && { name: custom.marketplace?.displayName ?? bundle.release.marketplace, date: releaseDate(bundle.release) }) } : {}) });
/**
 * Opens the folder of Central Knot's own log in Finder or Explorer, the log selected; before anything was logged, just the
 * folder it goes in. Linux always just opens the folder: selecting a file there depends on the file manager and, like every
 * selection, reports nothing back, while opening the folder says why it couldn't. So a selection can only be taken as done;
 * the page says which it got.
 */
async function openLogFolder(): Promise<LogFolderOpened> {
  const logged = await access(logPath()).then(() => true, () => false);
  if (logged && process.platform !== 'linux') { shell.showItemInFolder(logPath()); return { selected: true, logged }; }
  const failed = await shell.openPath(app.getPath('userData'));
  if (failed) throw new Error(failed);
  return { selected: false, logged };
}
/**
 * The log's last `count` lines for Settings' Show log, read whole (trimLog halves it at each start once it passes a megabyte);
 * none before anything was logged.
 */
async function readLog(count: unknown): Promise<LogTail> {
  if (!Number.isInteger(count) || (count as number) < 1) throw new Error('Invalid line count.');
  const text = await readFile(logPath(), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const shown = lines.slice(-(count as number));
  return { lines: shown, earlier: lines.length - shown.length };
}
/**
 * Applies the appearance setting. Electron's theme source decides `prefers-color-scheme` for the page, so every page's
 * light and dark styles follow it; the window's own background (seen while it draws) follows too.
 */
function applyAppearance() {
  nativeTheme.themeSource = appearance();
  if (window && !window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#000000' : '#fbfbfc');
}
/** Shows the window on one of its pages (the Settings… menu item). */
function showPage(page: string) {
  showWindow();
  send('navigate', page);
}

const signInFacts = () => ({ platform: process.platform, packaged: app.isPackaged, exe: app.getPath('exe'), smoke });
/** Whether Central Knot starts at sign-in, as the system has it now, and why not where it can't (see signin.ts). */
const signIn = () => signInState(signInFacts(), () => app.getLoginItemSettings({ args: signInArgs }));
/**
 * Registers or removes the login item as last chosen. Only a save calls it (the first launch's too), never a start: one the
 * person turned off in the system stays off. A system that refuses (a Windows policy, say) is logged; whoever asked then reads
 * the system's answer, which says it didn't change.
 */
function applySignIn() {
  if (whyNoSignIn(signInFacts())) return;
  try { app.setLoginItemSettings({ openAtLogin: appSettings.startAtSignIn !== false, args: signInArgs }); } catch (error) { logFailure('start at sign-in', error); }
}
/** On by default (PLT-03): registered at the first launch of an installed app, then left alone. */
async function firstSignIn() {
  if (whyNoSignIn(signInFacts()) || appSettings.startAtSignIn !== undefined) return;
  await saveAppSettings({ startAtSignIn: true });
}
/** Every place that turns it on or off (Settings, both menus, the first-close dialog) saves through the settings chain. */
const setStartAtSignIn = (on: boolean) => saveAppSettings({ startAtSignIn: on });
/** A menu or the dialog has nowhere to say a save failed: it is logged, and the menus go back to the system's answer. */
const saveSignInQuietly = (on: boolean) => void setStartAtSignIn(on).catch(error => { logFailure('start at sign-in', error); refreshTray(); });
/** The checkbox both menus show: the system's answer, the reason beside it, and changeable only where it can be. */
function signInItem(): MenuItemConstructorOptions {
  const state = signIn();
  // Held (heldReason), a build adds no login item, and none is changed from its menus.
  return { label: signInLabel(state), type: 'checkbox', checked: state.on, enabled: state.available && !heldReason(), click: item => saveSignInQuietly(item.checked) };
}
/** Where the person finishes or undoes it in the system's own settings: fixed places, never one the page names. */
function openSignInSettings(): Promise<void> {
  if (process.platform === 'darwin') return shell.openExternal('x-apple.systempreferences:com.apple.LoginItems-Settings.extension');
  if (process.platform === 'win32') return shell.openExternal('ms-settings:startupapps');
  return Promise.reject(new Error('No sign-in settings to open on this system.'));
}
const startedHidden = () => process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);

let tray: Tray | undefined;
let quitting = false;
let updater: ReturnType<typeof startUpdater> | undefined;
/** Sync changed something while the window was closed or in the background: the menu bar icon shows it until seen. */
let unseen = false;
/** The same for plugins updated automatically, or an update that failed; its menu line opens the Plugins page, where the note is. */
let unseenPlugins: 'updated' | 'failed' | undefined;
/** A plugin update's tool command under way: Quit waits for it (see before-quit), so what follows it is never cut off. */
let pluginStep: Promise<unknown> | undefined;
let pluginUpdates: ReturnType<typeof autoUpdates> | undefined;
/** Whether plugin checks run by themselves in this launch (an end-to-end run holds them still). */
let pluginChecksRun = false;
function showWindow() {
  // Startup makes the first window. macOS sends `activate` during startup too: that must never make a second one.
  if (!app.isReady() || !window) return;
  if (window.isDestroyed()) { createWindow(true); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  joinDock();
  // Said here, not from the window's own show event, which macOS sends only once the window is seen on a screen.
  send('window:shown');
}
/**
 * On a Mac, Central Knot is in the Dock (and the ⌘Tab list) only while it has a window: closed, it runs from its menu bar icon
 * alone. A minimised or hidden (⌘H) window still counts as one. Electron drops a request to leave made within a second of the
 * icon's return, so leaving is asked again until it holds or a window is back.
 */
let leavingDock: NodeJS.Timeout | undefined;
let menuBarOnly = false;
let joiningDock = false;
const dock = () => (process.platform === 'darwin' ? app.dock : undefined);
function leaveDock() {
  if (!tray || quitting) return;
  menuBarOnly = true;
  askToLeaveDock();
}
function askToLeaveDock(tries = 10) {
  clearTimeout(leavingDock);
  if (!menuBarOnly || quitting) return;
  dock()?.hide();
  if (tries > 0 && dock()?.isVisible()) leavingDock = setTimeout(() => askToLeaveDock(tries - 1), 400);
}
function joinDock() {
  clearTimeout(leavingDock);
  menuBarOnly = false;
  if (joiningDock || !dock() || dock()?.isVisible()) return;
  joiningDock = true;
  // macOS hands the front to the Dock while the icon is added, so the window is brought forward again once it is there. A
  // window closed meanwhile leaves the Dock again.
  void dock()?.show().then(() => {
    joiningDock = false;
    if (menuBarOnly) askToLeaveDock();
    else if (window && !window.isDestroyed() && window.isVisible()) { app.focus({ steal: true }); window.focus(); }
  });
}
/** One status line for both menus: where, and any news. */
function statusLine() {
  const where = current?.label ?? 'No home open yet';
  return unseen ? `Sync made changes · Show (${where})` : unseenPlugins ? `${unseenPlugins === 'updated' ? 'Plugins were updated' : 'A plugin couldn’t be updated'} · Show (${where})` : `Home: ${where}${current && lastManagedCount === 0 ? ' · nothing synced yet' : ''}`;
}
/** The status line's click: the window, on Plugins when what is unseen is an automatic update. */
const showNews = () => (unseenPlugins && !unseen ? showPage('plugins') : showWindow());
/**
 * A choice in the Profile menu: a switch, unless the profile is in use already (an empty switch would replace the last band's
 * Undo; the menu is only drawn again, since a checkbox item ticks itself when clicked). A switch that couldn't start waits on the
 * page with sync's results; one that changed something goes to the page's band with Undo. The menus then follow the library.
 */
function switchFromMenu(id: string) {
  if (inUse(lastProfiles.profiles, lastItems).some(profile => profile.id === id)) { refreshTray(); return; }
  void fromTray(async () => {
    if (!current) return;
    const result = await switchProfile(context(), await toolsNow(), id);
    if (result.stopped) pendingResults.push({ item: 'Profile', outcome: 'failed', message: result.stopped });
    else if (result.event && window && !window.isDestroyed()) window.webContents.send('profile:switched', result);
    pendingResults.push(...result.results.filter(item => item.outcome === 'failed'));
    lastItems = await liveNow(context());
  });
}

/**
 * Profile: one click switches, from the menu bar or the app menu. The label names the profile in use (worked out: profileplan.ts
 * inUse), each profile is a checkbox item ticked while it is in use. Before any profile exists, "Profiles…" opens the page that
 * makes one.
 */
function profileMenu(): Electron.MenuItemConstructorOptions {
  if (!lastProfiles.profiles.length) return { label: 'Profiles…', enabled: !!current, click: () => showPage('profiles') };
  const usable = homeWritable && !heldReason() && !!current, inUseNow = inUse(lastProfiles.profiles, lastItems);
  return { label: `Profile: ${inUseName(lastProfiles.profiles, lastItems)}`, submenu: [
    // One not offered (nothing in it: profileplan.ts switchable) is shown disabled, as on the Profiles page.
    ...lastProfiles.profiles.map(profile => {
      const empty = !switchable(profile, lastItems);
      return { label: empty ? `${profile.name} (empty)` : profile.name, type: 'checkbox' as const, checked: inUseNow.includes(profile), enabled: usable && !empty, click: () => switchFromMenu(profile.id) };
    }),
    { type: 'separator' },
    { label: 'Edit profiles…', click: () => showPage('profiles') },
  ] };
}

/** Automatic sync and Sync once, as both menus carry them: shown, not offered, where nothing may be written (preview only, or held: heldReason, which no menu calls preview only). */
function syncItems(): MenuItemConstructorOptions[] {
  const usable = homeWritable && !heldReason();
  return [
    { label: usable || heldReason() ? 'Automatic sync' : 'Automatic sync (paused: preview only)', type: 'checkbox', checked: syncOn && usable, enabled: usable, click: item => void fromTray(async () => { await saveSyncSetting(item.checked); }) },
    { label: 'Sync once (automatic sync stays off)', toolTip: 'Apply waiting changes once', visible: !syncOn && usable, enabled: !!current, click: () => void syncOnce() },
  ];
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Central Knot', click: showWindow },
    { label: 'Settings…', click: () => showPage('settings') },
    { type: 'separator' },
    profileMenu(),
    { type: 'separator' },
    // The status line says where, and any news; the checkbox below already says whether sync is on.
    { label: statusLine(), enabled: unseen || !!unseenPlugins, click: showNews },
    ...syncItems(),
    { type: 'separator' },
    // Linux has no start at sign-in yet, so its tray never offers one.
    { ...signInItem(), visible: process.platform !== 'linux' },
    { type: 'separator' },
    { label: syncOn && homeWritable && lastManagedCount > 0 ? 'Quit Central Knot (stops syncing)' : 'Quit Central Knot', click: () => { quitting = true; app.quit(); } },
  ]);
}
function refreshTray() {
  appMenu();
  if (!tray) return;
  tray.setContextMenu(trayMenu());
  const profile = lastProfiles.profiles.length ? inUseName(lastProfiles.profiles, lastItems) : undefined;
  tray.setToolTip(`Central Knot${profile ? ` · Profile: ${profile}` : ''}${unseen ? ': sync made changes' : unseenPlugins === 'updated' ? ': plugins were updated' : unseenPlugins ? ': a plugin couldn’t be updated' : ''}`);
  // The profile in use is always in sight: its name sits beside the menu bar icon (No profile when none is).
  // Shortened past 20 characters, so a long name can't crowd the menu bar (the full name is in the tooltip and the menu).
  const short = profile && profile.length > 20 ? `${profile.slice(0, 19)}…` : profile;
  if (process.platform === 'darwin') tray.setTitle(`${unseen || unseenPlugins ? '•' : ''}${short ? ` ${short}` : ''}`.trim());
}
/** Sync once, from either menu: one pass that writes, with Automatic sync left off. */
const syncOnce = () => fromTray(async () => { keepPass(await pass(await read(), true)); });
/** Menu bar actions take their turn like the page's, then tell the page. */
async function fromTray(work: () => Promise<void>) {
  await queued(work).catch(() => undefined);
  refreshTray();
  send('sync:changed');
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
      { label: 'Check for Updates…', click: () => { showPage('settings/updates'); void updater?.check(); } },
      { label: 'Settings…', accelerator: 'Command+,', click: () => showPage('settings') },
      profileMenu(),
      // The same status line as the menu bar menu: where, and any news.
      { label: statusLine(), enabled: unseen || !!unseenPlugins, click: showNews },
      { type: 'separator' },
      ...syncItems(),
      signInItem(),
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
  // Its menu is rebuilt as the pointer reaches the icon, so it shows a change made in System Settings while no window was open.
  tray.on('mouse-enter', () => tray?.setContextMenu(trayMenu()));
  refreshTray();
}

/** What passes did since the page last read, so no notice is lost between reads. */
let pendingResults: DestinationResult[] = [], pendingNotices: SyncNotice[] = [];
let pendingServerNotices: SyncNotice[] = [], pendingAgentNotices: SyncNotice[] = [];
/** Why the last background pass's kinds stopped (homepass.ts passTells `stopped`), so only a new reason tells an open page at once. */
let lastStopped = '';

interface ServersAndAgentsResult { serverNotices: SyncNotice[]; agentNotices: SyncNotice[]; changed: boolean; settling: boolean;
  /** The servers' and agents' found keys the pass left found (types.ts PassResult found), each with its kind's prefix. */ found: string[] }
/**
 * `told`: what the page is told of the pass, every kind alike (homepass.ts passTells); `done`: every result of the pass, all
 * three kinds, for a caller that says what it did (a tool's Manage switch).
 */
interface BackgroundPass { skills?: LibraryPass; serversAndAgents?: ServersAndAgentsResult; told?: ReturnType<typeof passTells>; done?: DestinationResult[] }

/** Each reason the move of plugin parts waited that the log has had this launch (pass). */
const partsWaitsLogged = new Set<string>();
/** Why the move of plugin parts waits, as the last pass gave it (homepass.ts partsWait); none when it doesn't. The Plugins page says it (MarketplaceHost partsWait). */
let partsWaiting: string | undefined;
/**
 * One pass on the open home: writes only with Sync on (or when asked explicitly); with Sync off nothing is done in the
 * background, and an edit or a deletion waits for Sync or a click on its item. `snapshots`: the caller's read of the home,
 * which the pass uses instead of reading it again. What a pass does, in order, is homepass.ts homePass: a profiles file from
 * before profiles were sets of items is moved before anything else, either way (it does nothing once moved), so no click
 * comes before it.
 */
async function pass(snapshots: Snapshot[], explicit = false): Promise<BackgroundPass> {
  const shared: ShareContext = { ...context(), read: async () => snapshots, reads: new Map() };
  // While plugin parts from before the library wait to be moved there, the plugins record's first read comes first (its install
  // alpha 1 waited for read from pluginUpdates, made before any pass), and the move may read a plugin (homepass.ts step 2).
  const pluginNow = await carriedMarket?.beforeParts().catch((error: unknown) => { logFailure('plugins record', error); return undefined; });
  const { synced, profilesFailed, partsFailed, partsWait } = await homePass(shared, await managedNow(shared, snapshots), syncOn || explicit, pluginNow);
  partsWaiting = partsWait;
  if (profilesFailed !== undefined) logFailure('moving profiles', profilesFailed);
  if (partsFailed !== undefined) logFailure('moving plugin parts', partsFailed);
  // Why the move of plugin parts waits, once per launch and reason (a home can wait for good: its rows say only "waiting").
  if (partsWait && !partsWaitsLogged.has(partsWait)) { partsWaitsLogged.add(partsWait); log(`plugin parts: waiting to be moved to the library: ${partsWait}`); }
  if (!synced) return {};
  const { skills, servers, agents } = synced;
  return { skills: skills ?? { results: [], writes: 0 }, done: [skills, servers, agents].flatMap(kind => kind?.results ?? []), told: passTells(synced), serversAndAgents: {
    serverNotices: servers?.notices ?? [], agentNotices: agents?.notices ?? [], settling: !!(servers?.settling || agents?.settling),
    found: [...(servers?.found ?? []).map(key => `mcp:${key}`), ...(agents?.found ?? []).map(key => `agent:${key}`)],
    changed: !!(servers?.writes || servers?.notices?.length || agents?.writes || agents?.notices?.length) } };
}

/**
 * What a pass tells the page, kept until it reads: every kind's results (homepass.ts passTells), each kept once, so a pass that
 * finds the same failure again adds nothing; and each kind's notices, for its own page.
 */
function keepPass({ told, skills, serversAndAgents }: BackgroundPass) {
  const same = (one: DestinationResult, other: DestinationResult) => one.item === other.item && one.harness === other.harness && one.outcome === other.outcome && one.message === other.message;
  for (const result of [...(told?.stopped ?? []), ...(told?.copies ?? [])]) if (!pendingResults.some(known => same(known, result))) pendingResults.push(result);
  pendingNotices.push(...(skills?.notices ?? []));
  pendingServerNotices.push(...(serversAndAgents?.serverNotices ?? []));
  pendingAgentNotices.push(...(serversAndAgents?.agentNotices ?? []));
}

async function syncThenView(explicit = false): Promise<HomeView> {
  return (await syncAndView(explicit)).view;
}

/** The look for other builds, one pass, then the view built from the home as it left it; `passed`: what the pass did. */
async function syncAndView(explicit = false): Promise<{ view: HomeView; passed: BackgroundPass }> {
  // First, so the held screen is shown before any pass could write: held, the pass below meets writeAccess's refusal. A record
  // taken over on the way is said with the view (a click on the held screen says it itself: carryOn).
  const tookOver = await lookForOthers();
  const shared: ShareContext = { ...context(), reads: new Map() };
  const before = await read();
  const passed = await pass(before, explicit), { skills } = passed;
  keepPass(passed);
  lookAgainSoon(passed);
  foundGained(passed);
  const caughtUp = pendingResults.splice(0), notices = pendingNotices.splice(0);
  const profiles = await readProfiles(current!.home);
  // The home is read again after a pass that may have written (Sync on, or Sync once): a pass that stopped part-way reports
  // no writes, yet may have made some. An observe-only pass, or one that couldn't run, wrote nothing.
  const snapshots = skills && (syncOn || explicit) ? await read() : before;
  const writable = (await writeAccess(shared)).allowed;
  const managed = await managedNow(shared, snapshots), present = presentTools(snapshots);
  const syncEverything = (await readRecord(current!.home)).record?.syncEverything;
  const readId = handoff.id + 1;
  const made: HomeView = {
    mode: current!.mode, label: current!.label, home: current!.home, snapshots, syncOn, practice: practiceAvailable(), readId, profiles, ...(tookOver ? { tookOver } : {}),
    // Apps that run the tools or read their files are looked for only on this computer, like the tools' own apps.
    ...(current!.mode === 'actual' ? { otherApps: await findOtherApps(current!.home) } : {}),
    sync: { managed, present, joining: await joiningCounts(shared, managed, present, syncEverything === true), writes: await skillFolders(shared, managed), access: await writeAccess(shared), gate: await syncGate(shared),
      caughtUp, syncEverything },
    skills: await skillsView(shared, managed, notices),
    mcp: await serversView(shared, managed, pendingServerNotices.splice(0)),
    agents: await agentsView(shared, managed, pendingAgentNotices.splice(0)),
  };
  // What plugins installed whole bring, read with the home so the Skills, MCP servers and Agents pages show it without Plugins.
  // With the view's own reads, so each tool's installed plugins are read once for these rows and the pages' Through a plugin boxes.
  made.pluginItems = await readPluginItems(pluginItemsContext(shared.overrides, shared.reads), managed);
  // What the look above found, and where this copy runs from.
  const builds = buildsContext(), outside = builds && runsOutside(builds);
  if (builds && others !== 'unlooked') {
    made.otherBuilds = others;
    if (outside) made.runsOutside = outside;
  }
  followProfiles(made.profiles, homeItems(made));
  // Only once the view is built is anything kept about this home, so a switch that fails leaves nothing behind.
  handoff = { id: readId, home: current!.home, snapshots };
  toolsChangedHere(snapshots);
  addCarriedSoon(managed);
  if (writable !== homeWritable) { homeWritable = writable; refreshTray(); }
  // How many items are managed, so the first-close note says truthfully whether anything syncs (nothing does with no tool managed).
  lastManagedCount = managed.length ? [...made.skills.items, ...made.mcp.items, ...made.agents.items].filter(fact => fact.on).length : 0;
  return { view: made, passed };
}

/** For each installed tool left out, what turning its Manage switch on would do there now (toolchoice.ts whatJoiningDoes): its card says it. */
async function joiningCounts(shared: ShareContext, managed: HarnessId[], present: HarnessId[], rule: boolean) {
  const out = present.filter(tool => !managed.includes(tool));
  return Object.fromEntries(await Promise.all(out.map(async tool => [tool, await whatJoiningDoes(shared, managed, tool, rule)] as const)));
}

/**
 * The plugins of a marketplace that a tool in this computer's own home has installed. A release of the carried
 * marketplace that no longer packs one of them carries it over, so it keeps working there until it is uninstalled. (By
 * the marketplace's name: a tool with another marketplace under that name keeps a same-named plugin here too, which
 * costs a folder and nothing else.)
 */
async function carriedInstalled(marketplace: string): Promise<string[]> {
  const context = { home: homedir(), dataDir: join(app.getPath('userData'), 'plugins'), binaries: {}, overrides: Object.fromEntries(harnessIds.map(id => [id, process.env[harnesses[id].configEnv]])) };
  const found = await Promise.all(pluginTools.map(tool => installedPlugins(context, tool).catch(() => [])));
  return [...new Set(found.flat().filter(plugin => plugin.marketplace === marketplace && plugin.state.state !== 'not-installed').map(plugin => plugin.plugin))];
}

// ---------- A bundled build's feed of newer plugins (ORG-05; bundlefeed.ts) ----------

const FEED_FIRST_MS = 5_000, FEED_EVERY_MS = 4 * 60 * 60_000, FEED_RETRY_MS = 15 * 60_000;
/** The last look at the feed, for the marketplace's About tab. */
let feedSeen: { checked: number; outcome: FeedCheck['outcome']; message: string } | undefined;
let feedTimer: NodeJS.Timeout | undefined;
let feedLook: Promise<void> | undefined;
/**
 * Looks at the feed: shortly after the app opens, every few hours while it runs (window closed too), sooner again after a
 * look that failed, and when asked on the About tab. One look at a time. Newer plugins are put in use in the app's queue;
 * the page then reads the marketplace again and the status bar says what arrived.
 */
function lookAtFeed(): Promise<void> {
  const feed = custom?.feed;
  // Held, not even the build's own folder, which the tools load the carried marketplace from: freed starts it again.
  if (!feed || smoke || heldReason()) return Promise.resolve();
  feedLook ??= (async () => {
    clearTimeout(feedTimer);
    // Read past the app's web cache: a static server gives no cache rules, and a cached manifest would hide a new release for days.
    const result = await checkFeed({ feed, dataDir: app.getPath('userData'), appVersion: app.getVersion(), fetch: (url, init) => net.fetch(url, { ...init, cache: 'no-store' }), keep: carriedInstalled, turn: queued })
      .catch((error): FeedCheck => ({ outcome: 'failed', message: `Couldn’t check for newer plugins: ${error instanceof Error ? error.message : String(error)}` }));
    feedSeen = { checked: Date.now(), outcome: result.outcome, message: result.message };
    log(`feed: ${result.outcome}: ${result.message}${result.detail ? ` (${result.detail})` : ''}`);
    if (result.outcome === 'updated' && result.active) {
      bundle = result.active;
      send('sync:changed');
      send('said', `${custom?.marketplace?.displayName ?? bundle.release.marketplace} ${result.message.charAt(0).toLowerCase()}${result.message.slice(1)}`);
    }
    feedTimer = setTimeout(() => void lookAtFeed(), result.outcome === 'failed' ? FEED_RETRY_MS : FEED_EVERY_MS);
  })().finally(() => { feedLook = undefined; });
  return feedLook;
}

/**
 * What a look at another build of Central Knot, or a click on one, goes by (otherbuilds.ts BuildsContext); the one guard on all
 * of it: undefined, so nothing is looked for, quit or removed, but on a Mac in an installed app (where macOS can say which apps
 * run), or where a test named its stand-ins (CK_TEST_APPS); never in a smoke run.
 */
function buildsContext(): BuildsContext | undefined {
  if (!looksForBuilds) return undefined;
  const places = macPlaces(homedir());
  return {
    own: BUILD, places, home: homedir(), settingsFolder: settingsFolderOf,
    // Test-only, with stand-ins: where this copy is to say it runs from (CK_TEST_OWN_BUNDLE: an Applications folder, the Trash).
    ...(testApps && process.env.CK_TEST_OWN_BUNDLE ? { ownBundle: process.env.CK_TEST_OWN_BUNDLE } : app.isPackaged ? { ownBundle: process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '') } : {}),
    trash: places.trash ? intoFolder(places.trash) : bundle => shell.trashItem(bundle),
  };
}

// ---------- One install at a time (otherbuilds.ts; the page's held screen: otherbuildview.ts) ----------

/**
 * What the last look at other builds of Central Knot found (otherbuilds.ts lookForBuilds), never stored: 'unlooked' until the
 * first look answers, so nothing is written before it; undefined where nothing is looked for or an Applications folder can't be read.
 */
let others: OtherBuild[] | undefined | 'unlooked' = looksForBuilds ? 'unlooked' : undefined;
/** Why this build may write nothing now (share.ts ShareContext held): another build is here (model.ts holdingBuild), or the first look hasn't answered. */
function heldReason(): string | undefined {
  const holder = holdingBuild(others);
  if (holder === 'unlooked') return `${own.name} is still looking for other builds of ${PRODUCT} on this Mac, so nothing is written yet.`;
  return holder && `${holder.name} is also ${holder.installed ? 'installed' : 'running'} on this Mac, and only one build of ${PRODUCT} works at a time, so ${own.name} changes nothing in this home or your tools ${holdsUntil(holder)}.`;
}
/**
 * Whether taking over the open home's record carries the Automatic sync and plugin updates of the build it names, `named`
 * (takeOverHome): only from the build this build was just freed from, `freedFrom`, or on this Mac's own home. The look asks it
 * at the take-over, and asks it ahead for the held screen (OtherBuild carries): Replace or Quit of a found build frees this
 * build from it where no other build is found.
 */
const carriesChoices = (named: string, freedFrom: string | undefined) => named === freedFrom || current!.mode === 'actual';
/**
 * The look (syncAndView's first step), and what follows from it: held, the window is shown, even after a start at sign-in.
 * Not held, where the look could answer, a home's record that names another build is taken over (takeOverHome): at launch, at
 * each view and switch of home, and at the look that frees this build, carrying that build's choices where carriesChoices says
 * so. Then, at the first look or freed, what waits for a build that isn't held (freed). Answers what the take-over said for the
 * page, where it said anything.
 */
async function lookForOthers(): Promise<string | undefined> {
  const builds = buildsContext();
  if (!builds) return undefined;
  const before = holdingBuild(others), owner = (await readRecord(current!.home)).record?.owner;
  const found = await lookForBuilds(builds, owner), alone = (build: string) => !!found?.every(other => other.build === build);
  // The held screen's promise, asked ahead: Replace or Quit of the build the record names frees this build from it where it is alone.
  others = found?.map(each => (each.ownsRecord && carriesChoices(each.build, alone(each.build) ? each.build : undefined) ? { ...each, carries: true as const } : each));
  if (others === undefined) log('other builds: an Applications folder can’t be read, so whether another build is here isn’t known; not held');
  if (heldReason() && (window.isDestroyed() || !window.isVisible())) showWindow();
  if (!!heldReason() !== !!before) refreshTray();
  if (heldReason()) return undefined;
  // A look that couldn't answer takes nothing over: whether another build is here isn't known.
  const freedFrom = before === 'unlooked' ? undefined : before?.build;
  const said = Array.isArray(others) && owner && owner !== BUILD ? await takeOverHome(carriesChoices(owner, freedFrom)) : undefined;
  if (before) await freed();
  return said;
}
/** What waits for a build that isn't held: its login item at its first open (firstSignIn) and a bundled build's feed. At launch, else once the look finds none. */
async function freed() {
  await firstSignIn();
  if (custom?.feed) { clearTimeout(feedTimer); feedTimer = setTimeout(() => void lookAtFeed(), FEED_FIRST_MS); }
}
/**
 * After a click on the build that holds this one (Replace, or Quit X): the look again, which takes the home's record over where
 * this build is free now (lookForOthers); what that said comes first. Then the view.
 */
async function carryOn(other: OtherBuild, outcome: BuildOutcome): Promise<BuildOutcome & { view: HomeView | null }> {
  log(`other build: ${other.name} (${other.build}): ${outcome.said}`);
  const said = [await lookForOthers(), outcome.said].filter(Boolean).join(' ');
  return { said, done: outcome.done, ...(outcome.show ? { show: outcome.show } : {}), view: await syncThenView() };
}
/**
 * Takes the open home's record over from the build it names (share.ts takeOverSync), the one place a record changes hands; only
 * the look calls it (lookForOthers). First, where that build's settings folder is found and the home may be written, History's
 * days, the longer of the two, so no take-over shortens History (keepSettingsOf). Then the record. Then, with `carry`, that
 * build's Automatic sync and automatic plugin updates too, and the record is remembered as this build's (share.ts remember), so
 * it needn't Resume. Not carried, the home waits for Resume where this build has no memory of this record (an older one's is
 * let go: share.ts forgetStale), and only the log says what happened. A take-over that can't be made (a home that can't be
 * written, a record that can't be written) is logged, and the record and the other choices stay as they were. Answers what the
 * page says with the view.
 */
async function takeOverHome(carry: boolean): Promise<string | undefined> {
  const shared = context(), named = (await readRecord(current!.home)).record;
  if (!named) return undefined;
  const found = (await writeAccess(shared)).allowed && await keepSettingsOf(named.owner, false);
  // A record that can't be written (a read-only folder) fails here: logged, and the view is built as it would have been.
  const taken = await takeOverSync(shared).catch((error: unknown) => ({ stopped: error instanceof Error ? error.message : String(error), from: undefined }));
  if (!taken.from) {
    log(`sync: ${current!.home}’s record names ${named.owner}, and it wasn’t taken over: ${taken.stopped}${found ? ' History’s days were kept first (the longer of the two).' : ''}`);
    return undefined;
  }
  if (!carry) {
    await forgetStale(shared, named.generation);
    log(`sync: took over ${current!.home}’s record from ${taken.from}${found ? ', keeping the longer History days' : ' (its settings folder wasn’t found)'}`);
    return undefined;
  }
  const kept = found && await keepSettingsOf(named.owner, true);
  log(`sync: took over ${current!.home}’s record from ${taken.from}${kept ? ', keeping its settings' : ' (its settings folder wasn’t found)'}`);
  await remember(shared, named.generation);
  const choices = 'whether Automatic sync is on, whether plugins update by themselves and how many days of History are kept (the longer of the two)';
  return kept ? `${own.name} syncs this home now, and keeps ${taken.from}’s choices: ${choices}.`
    : `${own.name} syncs this home now, with its own settings: ${taken.from}’s settings folder wasn’t found, so History is kept for as many days `
      + `as ${own.name} keeps it, and anything older is dropped at its next change.`;
}
/** Where a build keeps its settings: beside this build's folder, named as every build's is (the standard app's by the package's name, any other's by its bundle id: `own` above). */
const settingsFolderOf = (build: string) => join(dirname(app.getPath('userData')), build === STANDARD_BUILD ? packageInfo.name : build);
/**
 * Another build's own choices that decide what is written, read from its settings folder as that build reads them (a value it
 * never saved is its default) and saved as this build's: History's days always, the longer of the two, since they are this
 * build's for every home it opens and a take-over never shortens History (saved only where that changes them); with `all`,
 * Automatic sync and automatic plugin updates too. False, and nothing saved, where that folder isn't there.
 */
async function keepSettingsOf(build: string, all: boolean): Promise<boolean> {
  const folder = settingsFolderOf(build);
  if (!await access(folder).then(() => true, () => false)) return false;
  const read = (name: string) => readFile(join(folder, name), 'utf8').then(text => record(JSON.parse(text))).catch(() => undefined);
  const theirs = (await read('app-settings.json') ?? {}) as AppSettings;
  const days = Math.max(historyDays(), isHistoryDays(theirs.historyDays) ? theirs.historyDays : defaultHistoryDays) as HistoryDays;
  if (!all) { if (days !== historyDays()) await saveAppSettings({ historyDays: days }); return true; }
  await saveAppSettings({ historyDays: days, pluginUpdates: theirs.pluginUpdates });
  await saveSyncSetting((await read('sync-settings.json'))?.syncOn !== false);
  return true;
}

/** The marketplace feature's own work at open (marketplaces.ts); set once its requests are registered. */
let carriedMarket: ReturnType<typeof registerMarketplaces> | undefined;
/**
 * A bundled build adds its marketplace to the own list of each tool found in this computer's home (ORG-03), after the home
 * was read and outside that read: each tool's own command takes its turn in the queue. The page hears when one was added,
 * and the log keeps what each came to.
 */
function addCarriedSoon(present: HarnessId[]) {
  if (!bundle || !carriedMarket) return;
  void carriedMarket.addCarried(present, queued).then(reports => {
    for (const report of reports) log(`bundle: ${bundle?.release.marketplace} in ${report.tool}: ${report.outcome}: ${report.message}`);
    const added = reports.filter(report => report.outcome === 'added').map(report => report.tool);
    if (!added.length) return;
    // The page reads the tools again, and the status bar says once what was done on the person's behalf: first, that nothing
    // was installed, and short enough to be read whole (About names every tool).
    send('sync:changed');
    send('said', `Nothing was installed: ${custom?.marketplace?.displayName ?? bundle?.release.marketplace} is listed in ${added.length > 2 ? 'your tools' : toolList(added)} (see ${pageNames.plugins}).`);
  }, error => logFailure('adding the carried marketplace to the tools', error));
}

/** Background passes run through the same queue as the page's requests, one at a time, and tell the page when something changed. */
const POLL_MS = 20_000;
const DEBOUNCE_MS = 1_500;
let watchers: FSWatcher[] = [];
let poller: NodeJS.Timeout | undefined;
let soon: NodeJS.Timeout | undefined;
let followUp: NodeJS.Timeout | undefined;
/**
 * The found items the last pass of the whole home left found, all kinds. One that is new there is news for an open page though
 * nothing was written (copies that differ, which the rule leaves). One that left by a click or by the rule's writes came with a read
 * of its own, so it tells the page nothing: a read per click would slow every Add. One whose copies were all deleted by hand
 * stays on an open page until its next read; its Add then says no tool has a copy.
 */
let lastFound = new Set<string>();
function foundGained({ skills, serversAndAgents }: BackgroundPass): boolean {
  if (!skills) return false;
  const found = new Set([...(skills.found ?? []), ...(serversAndAgents?.found ?? [])]), gained = [...found].some(key => !lastFound.has(key));
  lastFound = found;
  return gained;
}
/**
 * Something a pass left inside its settle window (a copy missing just now, or a new one Synchronize everything waits to take
 * in while it is still being saved): look again just after it, so it finishes without a click. Otherwise an event or the poll.
 */
function lookAgainSoon({ skills, serversAndAgents }: BackgroundPass) {
  if (skills?.settling || serversAndAgents?.settling) { clearTimeout(followUp); followUp = setTimeout(queueBackgroundPass, 2_500); }
}

/** The menus follow the open home's profiles and the library's items, which say which profile is in use. */
function followProfiles(profiles: ProfilesView, items = lastItems) {
  if (JSON.stringify([profiles, items]) === JSON.stringify([lastProfiles, lastItems])) return;
  lastProfiles = profiles;
  lastItems = items;
  refreshTray();
}

/** After a profile is made, changed or deleted (Central Knot's own file only, no tool changes): the profiles for the page, and the menus. */
async function profilesSaved(): Promise<ProfilesView> {
  const profiles = await readProfiles(current!.home);
  followProfiles(profiles);
  return profiles;
}

/**
 * A watcher event since the last pass: with Sync off nothing is written, but the page still shows the edit as pending.
 * `settingsTouched`: one was for a settings file (an MCP settings file or a tool's switch file), whose own switch a tool may
 * have turned, which changes no content and so no write: the page reads again for it whether or not the pass wrote.
 */
let touched = false, settingsTouched = false;

/** The tools Central Knot manages in the open home, read now: the one way the requests below learn them. */
const toolsNow = async (): Promise<HarnessId[]> => managedNow(context(), await read());

/**
 * The home for a request that names the read it follows (`readId`, from the page's view): that read when it is the one
 * just handed over, else a new read. A new read that finds the tools changed tells the page, so the sidebar and every
 * page follow it, not only the request that noticed.
 */
async function readFor(readId?: number): Promise<Snapshot[]> {
  if (current && readId === handoff.id && handoff.home === current.home) return handoff.snapshots;
  const snapshots = await read();
  if (toolsChangedHere(snapshots)) send('sync:changed');
  return snapshots;
}

/** The tools in the open home as last noted (presence.ts), with the home they were noted in, so a change is acted on once. */
let lastPresent = { home: '', tools: '' };

/**
 * Notes the open home's tools (noteTools); when they changed, the folders are watched again, so a new tool is watched like the
 * rest, and a tool installed since the last note that Central Knot manages (it isn't left out) is said once in the status bar.
 */
function toolsChangedHere(snapshots: Snapshot[]): boolean {
  const { noted, changed, joined } = noteTools(lastPresent, current?.home ?? '', snapshots);
  lastPresent = noted;
  if (changed) void startWatching();
  const shared = context();
  void leftOutNow(shared).then(leftOut => {
    const managing = joined.filter(tool => !leftOut.includes(tool));
    if (managing.length) send('said', joinedWords(managing));
    // A managed tool new here gets each On plugin not kept out of it at a check made now (pluginupdates.ts toolJoined).
    if (managing.length && pluginChecksRun) return pluginUpdates?.toolJoined();
  }).catch(error => logFailure('plugin updates', error));
  return changed;
}

function queueBackgroundPass() { if (current && !smoke) void queued(backgroundPass).catch(() => undefined); }

async function backgroundPass() {
  if (!current) return;
  const fromEvent = touched, fromSettings = settingsTouched;
  touched = settingsTouched = false;
  // The home is read once per pass, whatever Sync or write access say (reading writes nothing), and the pass uses that read.
  // Whatever the pass finds, the page is told once, at the end (it keeps the news until it can read).
  const snapshots = await read();
  // A tool installed or removed changes every page's columns.
  let changed = toolsChangedHere(snapshots);
  const passed = await pass(snapshots), { skills, serversAndAgents, told } = passed;
  keepPass(passed);
  // The page reads again whether or not the pass wrote: with Sync off an edit or deletion is only noted (it shows as waiting,
  // not as Synced), and a tool's own switch turned in its settings changes no content, only that tool's mark.
  if ((fromEvent && !syncOn) || fromSettings) changed = true;
  // A new found item left as it is (copies that differ, say) writes nothing: the page hears of it all the same.
  if (foundGained(passed)) changed = true;
  lookAgainSoon(passed);
  // A kind's pass that could not finish says so on the page at once, instead of failing quietly; the same reason again waits for a read.
  const stopped = (told?.stopped ?? []).map(stop => `${stop.item}: ${stop.message}`).join('\n');
  if (stopped && stopped !== lastStopped) changed = true;
  lastStopped = stopped;
  const wrote = !!skills && !!(skills.writes || skills.notices?.length || serversAndAgents?.changed);
  if (wrote) {
    // An item the pass turned On or Off (a copy deleted by hand, one taken in) may change which profile is in use.
    followProfiles(lastProfiles, await liveNow(context()));
    // Nobody saw it: the window is closed, gone or behind other windows (D-36).
    if (window.isDestroyed() || !window.isVisible() || !window.isFocused()) { unseen = true; refreshTray(); }
  }
  if (changed || wrote) send('sync:changed');
}

const nudge = (settings = false) => { touched = true; settingsTouched ||= settings; clearTimeout(soon); soon = setTimeout(queueBackgroundPass, DEBOUNCE_MS); };

/** Stops watching the folders and the poll; passes already due (an edit's debounce, a deletion's settle) still run. */
function closeWatchers() {
  for (const watcher of watchers) watcher.close();
  watchers = [];
  clearInterval(poller);
  poller = undefined;
}

/** Stops everything background work would do on the open home: the watch, the poll and any pass already due. */
function stopWatching() {
  closeWatchers();
  clearTimeout(soon); clearTimeout(followUp);
}

/** Watches each tool's skills folders (an event only prompts a read, CON-04), with polling as the fallback (T-08: at most 30 s). */
async function startWatching() {
  closeWatchers();
  if (!current || smoke) return;
  const roots = new Set<string>(harnessIds.map(id => writeRoot(harnesses[id], current!.home, overrideFor(id))));
  roots.add(join(current.home, '.agents/skills'));
  // Agents folders too (Pi's is its skills folder, above): an agent edited in one tool spreads like a skill (D-32).
  for (const id of agentTools) roots.add(agentsFolder(context(), id));
  // MCP settings files and each tool's switch file (skillswitch.ts switchPath; a server's is one or the other): their folders are
  // watched without recursion, and only an event for one of those files prompts a read. Claude Code's MCP file holds no switch
  // (mcpswitch.ts) and Claude Code rewrites it while it runs, so its events are not settings events: the page isn't redrawn for them.
  const shared = context(), noSwitch = mcpFile(shared, 'claude-cli');
  const files = [...new Set([...mcpTools.map(id => mcpFile(shared, id)), ...harnessIds.map(id => switchPath(shared, id))])];
  for (const folder of new Set(files.map(file => dirname(file)))) {
    const names = new Set(files.filter(file => dirname(file) === folder).map(file => basename(file)));
    try { watchers.push(watch(folder, { persistent: false }, (_event, name) => { if (!name || names.has(name)) nudge(!name || join(folder, name) !== noSwitch); })); } catch { /* not there: polling covers it */ }
  }
  for (const root of roots) {
    try { watchers.push(watch(root, { recursive: true, persistent: false }, () => nudge())); } catch { /* not there: polling covers it */ }
  }
  poller = setInterval(queueBackgroundPass, POLL_MS);
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
  } else if (mode === 'actual') next = { mode, home: homedir(), label: machineNames(process.platform).home };
  else next = { mode, home: await ensurePracticeHome(), label: 'Practice copy' };
  // A switch that fails changes nothing: the home on screen stays the home open here, with its hand-off and watchers.
  const previous = { current, handoff, lastPresent };
  current = next;
  try {
    const shown = await syncThenView();
    // Saving the settings rebuilds the menus with the new home.
    await saveAppSettings({ home: { mode: next.mode, path: next.mode === 'custom' ? next.home : undefined } });
    // Only once the switch has succeeded: passes due on the home before are dropped, and the new home is watched.
    stopWatching();
    void startWatching();
    return shown;
  } catch (error) { ({ current, handoff, lastPresent } = previous); throw error; }
}

/**
 * The Practice copy (throwaway sample files) exists only in dev builds and tests. A released app works on this
 * computer's own home, and other folders can still be opened. Tests switch either way: `--practice-copy` offers it in a
 * packaged build, and `--as-released` makes a development build start as a released one.
 */
const practiceAvailable = () => smoke || process.argv.includes('--practice-copy') || (!app.isPackaged && !process.argv.includes('--as-released'));

/**
 * At launch: the home last opened, else this computer's home. A remembered folder that is gone falls back the same way.
 * Dev builds and tests fall back to the Practice copy instead, so a development run doesn't sync this machine's real tools unasked.
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

/** The draft of the base a tool is writing now, to stop it (draftbase.ts). */
let drafting: AbortController | undefined;
/** What a write answers when the page shows another home than the one open here. */
const elsewhere = 'The home on screen is not the one open. Nothing was written. Read it again.';

/** Keeps a failed request's error for a problem report; the page says what happened in plain words. */
const logFailure = (channel: string, error: unknown) => log(`request ${channel} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);

/** What the plugin items reader needs of the open home: files only, so no tool's CLI. */
const pluginItemsContext = (overrides: Partial<Record<HarnessId, string>> | undefined, reads?: Map<string, Promise<unknown>>) => ({ home: current!.home, dataDir: app.getPath('userData'), binaries: {}, overrides, reads });

/**
 * Keeps what a change came to, for a problem report: a refusal for the whole home, each plugin step as its tool reported
 * it (with the tool's own output when its command failed), and each item a change couldn't reach. The words the page
 * showed, and where they name one, the path and the system's error code; never an item's content.
 */
function logOutcome(channel: string, args: unknown[], result: unknown) {
  try { logged(channel, args, result); } catch (error) { logFailure(`${channel} (logging its outcome)`, error); }
}
function logged(channel: string, args: unknown[], result: unknown) {
  if (!result || typeof result !== 'object') return;
  const { stopped, reports, results, done } = result as { stopped?: unknown; reports?: unknown; results?: unknown; done?: unknown };
  if (typeof stopped === 'string') log(`${channel} stopped: ${stopped}`);
  // A plugin step's request names the marketplace and the plugin second and third.
  // One item's switch names the item fourth: a skill by its name, an MCP server or agent as a part.
  const part = channel === 'plugins:part' ? args[3] as PartRef | null : null;
  const switched = part ? ` (${part.kind} ${part.name})` : channel === 'plugins:skill' && typeof args[3] === 'string' ? ` (skill ${args[3]})` : '';
  const plugin = channel.startsWith('plugins:') && typeof args[1] === 'string' && typeof args[2] === 'string' ? ` ${args[2]}@${args[1]}${switched}` : '';
  for (const report of Array.isArray(reports) ? reports as ActionReport[] : []) {
    log(`${channel}${plugin} in ${report.tool}: ${report.outcome}${report.changed ? '' : ', nothing changed'}: ${[report.message, ...(report.notes ?? [])].join(' ')}`);
    for (const run of report.runs.filter(run => !run.ok)) log(`${channel}${plugin} in ${report.tool}: \`${run.command}\` failed: ${run.output.trim().slice(0, 2000)}`);
  }
  for (const item of Array.isArray(results) ? results as DestinationResult[] : []) {
    if (item.outcome === 'failed' || item.outcome === 'held') log(`${channel} ${item.item}${item.harness ? ` in ${item.harness}` : ''}: ${item.outcome}: ${item.message}`);
  }
  // A plugin's switch and its Undo (plugins:turn, plugins:undo-turn): each step it ran names its own plugin, action and tool.
  for (const step of Array.isArray(done) ? done as PluginDone[] : []) {
    log(`${channel} ${step.plugin}@${step.marketName} ${step.action} in ${step.tool}: ${step.report.outcome}${step.report.changed ? '' : ', nothing changed'}: ${[step.report.message, ...(step.report.notes ?? [])].join(' ')}`);
    for (const run of step.report.runs.filter(run => !run.ok)) log(`${channel} ${step.plugin}@${step.marketName} in ${step.tool}: \`${run.command}\` failed: ${run.output.trim().slice(0, 2000)}`);
  }
}

/** One thing at a time: planning and writing never interleave. The page's requests, menu actions and background passes all wait their turn here. */
let queue: Promise<unknown> = Promise.resolve();
const notOpenHome = 'The home on screen is not the one open. Nothing was saved. Read it again.';
const isTools = (value: unknown): value is HarnessId[] => Array.isArray(value) && ids(value).length === value.length;
const isTool = (value: unknown): value is HarnessId => isTools([value]);
/** An object keyed by tool ids whose every value passes `valid`. */
const isToolMap = <T>(value: unknown, valid: (entry: T) => boolean) => !!value && typeof value === 'object' && isTools(Object.keys(value)) && Object.values(value as Record<string, T>).every(valid);
const isBaseApply = (value: unknown): value is BaseApply => {
  const request = value as BaseApply;
  return !!request && typeof request.text === 'string' && typeof request.expected === 'string' && isTools(request.tools)
    && isToolMap(request.seen, (seen: { path?: unknown; hash?: unknown }) => typeof seen?.path === 'string' && typeof seen.hash === 'string')
    && (request.adopt === undefined || isTool(request.adopt)) && (request.overwrite === undefined || isTools(request.overwrite))
    && (request.own === undefined || isToolMap(request.own, (text: unknown) => typeof text === 'string'));
};
const isBaseUndo = (value: unknown): value is BaseUndo => {
  const undo = value as BaseUndo;
  const hashes = (value: unknown) => isToolMap(value, (hash: unknown) => typeof hash === 'string');
  return !!undo && typeof undo.text === 'string' && typeof undo.baseHash === 'string' && !!undo.list && isTools(undo.list.tools) && hashes(undo.list.written) && hashes(undo.list.leftPlain)
    && Array.isArray(undo.files) && undo.files.every(file => isTool(file?.tool) && typeof file.path === 'string' && typeof file.afterHash === 'string' && (file.before === null || typeof file.before === 'string'));
};

/** Runs `work` after everything queued before it; its failure reaches the caller but never stalls the queue. */
function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  return next;
}
/** A page request that takes its turn in the queue. */
const handle = (channel: string, work: (...args: unknown[]) => Promise<unknown>) => handleNow(channel, (...args) => queued(() => work(...args)));

/**
 * A request that touches nothing a tool reads (a README, a plugin's contents, Central Knot's own settings, even saving them):
 * answered at once, outside the queue, so it never waits behind sync and background reads never hold up a change the person asked for.
 */
function handleNow(channel: string, work: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents) throw new Error('Unexpected sender.');
    return work(...args).then(result => { logOutcome(channel, args, result); return result; }, error => { logFailure(channel, error); throw error; });
  });
}

/** The main window. Closing it hides it and, on a Mac, takes Central Knot out of the Dock (PLT-04); if it is ever gone, Open from the menu bar makes a new one. */
let loading: Promise<void> = Promise.resolve();
function createWindow(show: boolean) {
  // One window at a time: a second would get no answers (requests are only taken from the current window).
  if (window && !window.isDestroyed()) { if (show) { window.show(); window.focus(); joinDock(); } return; }
  window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 860, minHeight: 560, show,
    title: 'Central Knot', backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#fbfbfc',
    // macOS takes the app's icon from its bundle; Windows and Linux take the window's.
    ...(process.platform === 'darwin' ? {} : { icon: join(__dirname, '../assets/icon.png') }),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  log('window created');
  if (show) joinDock();
  // However the window comes back, the Dock icon comes with it. (Never the other way: macOS also calls a covered window hidden.)
  window.on('show', joinDock);
  window.on('close', event => {
    // A held build is never left running out of sight: closing its window quits it.
    if (heldReason()) quitting = true;
    log(`window close (${quitting ? 'quitting' : tray ? 'hidden' : 'no menu bar icon'})`);
    if (quitting || !tray) return;
    event.preventDefault();
    const shown = window;
    shown.hide();
    // The first time only: say where Central Knot went (truthfully: syncing only if something syncs), offer to quit instead, and
    // show the sign-in start it turned on, so neither a hidden window nor a login item is a surprise.
    if (!appSettings.closeExplained && !smoke) {
      void saveAppSettings({ closeExplained: true });
      const icon = machineNames(process.platform).trayIcon;
      const syncing = syncOn && homeWritable && lastManagedCount > 0;
      // The checkbox shows the system's answer as the dialog opens; only a change the person makes to it is saved.
      const signedIn = signIn();
      void dialog.showMessageBox({
        type: 'info', buttons: ['OK', 'Quit instead'], defaultId: 0, cancelId: 0,
        message: syncing ? 'Central Knot keeps syncing in the background' : 'Central Knot is still running',
        detail: syncing ? `Open it again from its ${icon}, or open Central Knot again. To stop syncing, choose Quit Central Knot there.` : `Nothing is syncing yet. Open it again from its ${icon} or by opening Central Knot again. To quit, choose Quit Central Knot from that icon.`,
        ...(signedIn.available ? { checkboxLabel: 'Start Central Knot at sign-in', checkboxChecked: signedIn.on } : {}),
      }).then(({ response, checkboxChecked }) => {
        if (signedIn.available && checkboxChecked !== signedIn.on) saveSignInQuietly(checkboxChecked);
        if (response === 1) { quitting = true; app.quit(); }
        leaveDock();
      });
    } else leaveDock();
  });
  window.on('closed', () => { log('window closed'); leaveDock(); });
  window.webContents.on('render-process-gone', (_event, details) => log(`page process gone: ${details.reason}`));
  window.webContents.on('did-finish-load', () => log('page loaded'));
  // Coming back to the window is when a change made in the system's own settings (Login Items, Startup apps) shows: the menus
  // are rebuilt and the page re-reads, both from this one event. A release published meanwhile shows then too (updateflow.ts).
  window.on('focus', () => { unseen = false; unseenPlugins = undefined; refreshTray(); send('settings:changed'); void updater?.checkIfStale(); });
  // A start with no window tells the page so; showWindow tells it when the window shows: it collects usage then (app.ts collectUsage).
  loading = window.loadFile(join(__dirname, 'index.html'), show ? {} : { query: { start: 'hidden' } });
}

// One Central Knot at a time: a second launch hands over to the first (which shows its window) and exits at once, before it opens
// a window of its own. app.quit() would let it start up first.
const primary = smoke || app.requestSingleInstanceLock();
if (!primary) app.exit(0);
app.on('second-instance', showWindow);
// Opening Central Knot again (the Dock, Finder, Spotlight) while it runs: its window comes back.
app.on('activate', () => { log('opened again'); showWindow(); });
// A tool writing a draft is stopped with the app: it would otherwise keep working with nobody to read its answer.
// A plugin being updated by itself is let finish (a few seconds; fifteen at most): the tool's command runs on whatever the app
// does, and what follows it here (turning a turned-off plugin off again, the note saved) must not be lost. No further step
// starts, so the check ends with that one. A check that is only reading the marketplaces holds nothing up.
let heldForPlugin = false;
app.on('before-quit', event => {
  quitting = true;
  drafting?.abort();
  if (!pluginStep || heldForPlugin) return;
  heldForPlugin = true;
  event.preventDefault();
  log('quit waits for a plugin update under way');
  const check = pluginUpdates?.underWay() ?? pluginStep;
  void Promise.race([check.catch(() => undefined), new Promise(done => setTimeout(done, 15_000))]).then(() => app.quit());
});
// A signal to stop is a Quit, not a window close: nothing waits in the menu bar.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { quitting = true; app.quit(); });

app.whenReady().then(async () => {
  if (!primary) return;
  trimLog();
  await loadSyncSetting();
  await loadAppSettings();
  void clearDraftFolders();
  // A bundled build unpacks the marketplace it carries before the window asks for it. What was in use stays if that fails.
  if (custom?.marketplace && !smoke) {
    const began = Date.now();
    const opened = await openBundle(app.getPath('userData'), join(__dirname, CARRIED_FOLDER), carriedInstalled);
    bundle = opened.active;
    if (opened.kept) log(`bundle: ${opened.kept}`);
    if (opened.problem) log(`bundle: ${opened.problem}`);
    else log(`bundle: ${bundle?.release.marketplace} as of ${bundle ? releaseLabel(bundle.release) : 'nothing'} (sequence ${bundle?.release.sequence}), ready in ${Date.now() - began} ms`);
  }
  applyAppearance();
  // Where other builds are looked for, this waits for the first look to find none (lookForOthers).
  if (!heldReason()) await freed();
  makeTray();
  createWindow(!smoke && !startedHidden());
  // Started at sign-in with no window: the menu bar icon only.
  if (!smoke && startedHidden()) leaveDock();
  // A read waits for settings writes already under way, so the page never sees a value older than one it just saved.
  handleNow('settings:get', async () => settingsWrites.then(preferences));
  handleNow('settings:appearance', async appearance => {
    if (!appearances.includes(appearance as Appearance)) throw new Error('Invalid appearance.');
    await saveAppSettings({ appearance: appearance as Appearance });
    applyAppearance();
    return preferences();
  });
  handleNow('settings:sign-in', async on => {
    if (typeof on !== 'boolean') throw new Error('Invalid start at sign-in.');
    const why = whyNoSignIn(signInFacts());
    if (why) throw new Error(why.text);
    await setStartAtSignIn(on);
    return preferences();
  });
  handleNow('settings:open-sign-in', openSignInSettings);
  // handleNow, not handle: changeHistoryWindow counts the request on arrival, then takes its own turn in the queue.
  handleNow('settings:history-days', async (days): Promise<HistoryWindowSaved> => {
    if (!isHistoryDays(days)) throw new Error('Invalid history days.');
    return changeHistoryWindow(days);
  });
  handleNow('settings:open-log-folder', openLogFolder);
  handleNow('settings:read-log', readLog);
  handleNow('settings:plugin-updates', async on => {
    if (typeof on !== 'boolean') throw new Error('Invalid plugin updates setting.');
    await saveAppSettings({ pluginUpdates: on });
    log(`plugin updates: turned ${on ? 'on' : 'off'}`);
    await pluginUpdatesSwitched(on);
    return preferences();
  });
  // Updates (PLT-02): checks run outside the queue; the restart waits in it, so it never lands in the middle of a write.
  // A custom build never asks for, or takes, the standard app's releases (ORG-07): it has no updater until it has a location of its own.
  updater = smoke || custom ? undefined : startUpdater({
    log, send: view => send('updates:changed', view), hasPage: () => !!window && !window.isDestroyed(),
    // The restart also waits for Central Knot's own settings file, which is written outside the queue.
    queued: work => queued(async () => { await settingsWrites; return work(); }),
    pending: () => appSettings.update, savePending: update => saveAppSettings({ update }), quitting: on => { quitting = on; },
  });
  const noUpdates = async (): Promise<UpdateView> => ({ shown: false, version: app.getVersion(), checking: false });
  handleNow('updates:view', () => updater?.view() ?? noUpdates());
  handleNow('updates:check', () => updater?.check() ?? noUpdates());
  handleNow('updates:install', () => updater?.install() ?? noUpdates());
  handleNow('updates:restart', async () => { await updater?.restart(); });
  // Asked on the marketplace's About tab; the page reads the Plugins view again when it answers.
  handleNow('bundle:check-feed', () => lookAtFeed());
  handle('discovery:select', async mode => {
    if (!['fixture', 'custom', 'actual'].includes(String(mode))) throw new Error('Invalid home selection.');
    if (smoke && mode !== 'fixture') throw new Error('Smoke test is fixture-only.');
    if (mode === 'fixture' && !practiceAvailable()) throw new Error('The practice copy is only in development builds.');
    return selectHome(mode as HomeMode);
  });
  handle('discovery:start', async () => startHome());
  handle('discovery:refresh', async asked => { if (asked === true) { forgetVersions(); forgetRefusals(); } return current ? syncThenView() : null; });
  // Writes act only on the home the window says it is showing.
  const changes = (value: unknown): Change[] => (Array.isArray(value) ? value : []).filter((change): change is Change =>
    typeof change?.key === 'string' && typeof change.on === 'boolean' && Array.isArray(change.except)
    && (change.use === undefined || harnessIds.includes(change.use)) && (change.useHash === undefined || typeof change.useHash === 'string') && (change.seenOn === undefined || typeof change.seenOn === 'boolean')
  ).map(change => ({ key: change.key, on: change.on, except: ids(change.except), use: change.use, useHash: change.useHash, seenOn: change.seenOn,
    ...(typeof change.version === 'string' ? { version: change.version } : {}), ...(typeof change.deleted === 'boolean' ? { deleted: change.deleted } : {}),
    ...(change.giveBack && typeof change.giveBack === 'object' ? { giveBack: Object.fromEntries(Object.entries(change.giveBack).filter(([tool, hash]) => harnessIds.includes(tool as HarnessId) && typeof hash === 'string')) } : {}) }));
  // Marketplaces and plugins: their own module, given only what it needs from here.
  const markets = carriedMarket = registerMarketplaces({ handle, handleNow }, {
    home: () => (current ? { home: current.home, overrides: context().overrides, actual: current.mode === 'actual' } : undefined),
    read: async readId => { const snapshots = await readFor(readId); return { tools: await managedNow(context(), snapshots), snapshots }; },
    leftOut: () => leftOutNow(context()),
    writeAccess: () => writeAccess(context()),
    dataDir: app.getPath('userData'),
    pickFolder: async () => { const choice = await dialog.showOpenDialog(window, { title: 'Choose a marketplace folder', properties: ['openDirectory'] }); return choice.canceled ? undefined : choice.filePaths[0]; },
    openExternal: url => shell.openExternal(url),
    share: () => context(),
    partsWait: () => partsWaiting,
    // A change to a plugin that worked (an update, an uninstall) settles what failed there by itself before.
    changed: (source, plugin, tools) => void pluginUpdates?.settled(source, plugin, tools).catch(error => logFailure('plugin updates', error)),
    waitedBefore: async () => pluginUpdates?.waitedBefore() ?? [],
    notices: (kind, told) => { (kind === 'skill' ? pendingNotices : kind === 'mcp' ? pendingServerNotices : pendingAgentNotices).push(...told); },
    bundled: () => (bundle && custom ? { source: bundle.folder, view: {
      app: custom.name, displayName: custom.marketplace?.displayName, logo: custom.marketplace?.logo && `${CARRIED_FOLDER}/${custom.marketplace.logo}`,
      release: releaseDate(bundle.release, true), from: bundle.release.from || undefined, unpackaged: bundle.release.unpackaged, kept: bundle.release.kept,
      ...(custom.feed ? { feed: feedSeen ? { checked: new Date(feedSeen.checked).toISOString(), outcome: feedSeen.outcome, message: feedSeen.message } : {} } : {}),
    } } : undefined),
  });
  // Sources read again by themselves once a day, on the plugin updates' schedule turn below (sources.ts checkDue holds the
  // rhythm, and pauses with Automatic sync); each check is Check now's, its pass taking its turn in the queue.
  let checkingSources = false;
  async function sourcesTurn() {
    if (!current || checkingSources) return;
    checkingSources = true;
    try {
      for (const { link, done } of await checkDue(context(), toolsNow, queued, { syncOn })) {
        logOutcome(`sources:check ${linkLabel(link)} (by itself)`, [], done);
        if (done.sourced?.length || done.results?.length) send('sync:changed');
      }
    } catch (error) { logFailure('sources (by itself)', error); } finally { checkingSources = false; }
  }
  // Plugin updates that arrive by themselves (pluginupdates.ts): each step takes its turn in the queue, like the page's own
  // steps, and is logged as one; none starts once the app is quitting (one already running is waited for: see before-quit).
  const noPluginUpdates: PluginUpdatesView = { on: false, paused: false, checking: false, updated: [], failed: [], first: false };
  if (!smoke) {
    const recordPath = join(app.getPath('userData'), 'plugin-updates.json');
    const step = (channel: string, args: unknown[], work: () => Promise<PluginActionResult>): Promise<PluginActionResult> => queued(async () => {
      if (quitting) return { stopped: 'Central Knot was quitting.', reports: [] };
      const running = pluginStep = work();
      try { const result = await running; logOutcome(`${channel} (by itself)`, args, result); return result; }
      finally { if (pluginStep === running) pluginStep = undefined; }
    });
    // Test-only, read only when set: the time between plugin checks in milliseconds, or `never` for no checks but those asked
    // for, plugins' or sources' (the end-to-end run's other flows, which a check a minute after start would walk into).
    const paced = process.env.CK_PLUGIN_UPDATES_EVERY_MS;
    const every = Number(paced) || CHECK_EVERY_MS;
    pluginUpdates = autoUpdates({
      home: () => current?.home, on: pluginUpdatesOn, paused: () => !syncOn, log, now: Date.now, every,
      pending: home => queued(() => markets.pendingUpdates(home)),
      api: {
        // An install a tool new here is owed runs as the page's own install does.
        install: (source, marketName, plugin, tools, home) => step('plugins:install', [source, marketName, plugin, tools, home], () => markets.install(source, marketName, plugin, onlyAllowed(tools, pluginTools), home)),
        update: (source, marketName, plugin, tools, home) => step('plugins:update', [source, marketName, plugin, tools, home], () => markets.update(source, marketName, plugin, onlyAllowed(tools, pluginTools), home, { reinstall: false })),
        items: (source, marketName, plugin, tools, home, bring) => step('plugins:items', [source, marketName, plugin, tools, home, bring], () => markets.items(source, marketName, plugin, tools, home, bring)),
      },
      noteJoined: (tools, home) => queued(() => markets.noteJoined(tools, home)),
      load: async () => { const saved: unknown = JSON.parse(await readFile(recordPath, 'utf8')); return Array.isArray(saved) ? saved as UpdatesRecord[] : undefined; },
      save: async saved => { await mkdir(app.getPath('userData'), { recursive: true }); await writeFile(recordPath, `${JSON.stringify(saved, null, 2)}\n`); },
      changed: (view, news) => {
        send('plugin-updates:changed', view, news);
        if (!news) return;
        // What the tools have changed: every page reads again. Nobody saw it: the menu bar icon says so until the window is back.
        if (news === 'updated') send('sync:changed');
        // An update not yet seen stays the news when a later check only failed.
        if (window.isDestroyed() || !window.isVisible() || !window.isFocused()) { unseenPlugins = unseenPlugins === 'updated' ? 'updated' : news; refreshTray(); }
      },
    });
    if (paced !== 'never') {
      pluginChecksRun = true;
      const updates = pluginUpdates;
      const turn = () => { void updates.tick().catch(error => logFailure('plugin updates', error)); void sourcesTurn(); };
      const pace = Math.min(5 * 60_000, Math.max(1_000, every / 4));
      // The first look comes a minute after start, so opening the app is never slowed by it; then every few minutes it asks whether a check is due.
      setTimeout(turn, Math.min(60_000, pace)).unref();
      setInterval(turn, pace).unref();
    }
  }
  handleNow('plugin-updates:view', async () => pluginUpdates?.view() ?? noPluginUpdates);
  handleNow('plugin-updates:check', async () => pluginUpdates?.check(true) ?? noPluginUpdates);
  handleNow('plugin-updates:close', async what => (pluginUpdates && (what === 'updated' || what === 'failed') ? pluginUpdates.close(what) : noPluginUpdates));
  // One plugin item's file in each tool's copy, read when its row is opened (the home's read leaves file text out).
  handleNow('plugin-items:texts', async (plugin, marketName, kind, name) => (current && [plugin, marketName, name].every(value => typeof value === 'string') && (kind === 'skill' || kind === 'agent')
    ? readItemTexts(pluginItemsContext(context().overrides), harnessIds, { plugin: plugin as string, marketName: marketName as string, kind, name: name as string }) : []));
  // The window is read in the same turn as the events, so History's caption always describes the events it shows.
  handle('history:list', async (): Promise<HistoryList> => ({ events: current ? await readHistory(context()) : [], days: historyDays() }));
  // Instruction files: read fresh each time; a save writes only the file the editor opened, for the home on screen.
  // Reveal only: the file manager selects it; nothing is opened, run or written.
  handle('file:show', async path => { if (typeof path === 'string' && isAbsolute(path)) shell.showItemInFolder(path); });
  handle('history:change', async eventId => (current && typeof eventId === 'string' ? skillChange(context(), eventId) : undefined));
  // The tools' session history, read when the page collects usage: outside the queue, since usage.ts changes nothing in the home. This
  // computer's home reads OpenCode's data where XDG_DATA_HOME moves it, as each tool's folder follows its own variable.
  handleNow('usage:read', async home => (current && home === current.home
    ? readUsage({ home: current.home, overrides: context().overrides, dataHome: current.mode === 'actual' ? process.env.XDG_DATA_HOME : undefined }) : null));
  handleNow('agents:version', async (key, hash) => (current && typeof key === 'string' && typeof hash === 'string' ? (await agentVersion(context(), key, hash)) ?? null : null));
  handle('instructions:view', async readId => (current ? instructionsView(context(), await readFor(readId as number | undefined)) : null));
  handle('instructions:save', async (tool, text, expected, home, restoring) => (home === current?.home && isTool(tool) && typeof text === 'string' && typeof expected === 'string'
    ? saveInstruction(context(), await read(), tool, text, expected, restoring === true)
    : { stopped: notOpenHome }));
  handle('instructions:version', async (tool, id) => (current && (tool === 'base' || isTool(tool)) && typeof id === 'string' ? instructionVersion(context(), tool, id) : undefined));
  // The tools that can write a draft are this computer's own, whichever home is on screen: the draft is written from the text
  // it is given, so the tool never reads that home.
  let drafters: Partial<Record<HarnessId, string>> = {};
  handle('instructions:base', async () => {
    if (!current) return null;
    drafters = await draftTools(homedir(), await searchPath());
    return baseView(context(), harnessIds.filter(tool => drafters[tool]));
  });
  // The files are read in turn with everything else; the tool then writes its draft outside the queue (it can take minutes,
  // and writes nothing), so sync never waits behind it.
  handleNow('instructions:draft-base', async (tool, home): Promise<BaseDraft> => {
    if (home !== current?.home || !isTool(tool)) return { stopped: notOpenHome };
    const binary = drafters[tool];
    if (!binary) return { stopped: 'That tool was not found on this computer, so it can’t write a draft.' };
    if (drafting) return { stopped: 'A draft is already being written.' };
    const mine = drafting = new AbortController();
    try { return await writeDraft(await queued(async () => draftSources(context(), await read())), tool, binary, { signal: mine.signal }); }
    finally { if (drafting === mine) drafting = undefined; }
  });
  handleNow('instructions:cancel-draft', async () => { drafting?.abort(); });
  const otherHome = { stopped: notOpenHome, written: [], left: [] };
  handle('instructions:apply-base', async (request, home) => (home === current?.home && isBaseApply(request) ? applyBase(context(), await read(), request) : otherHome));
  handle('instructions:undo-base', async (undo, home) => (home === current?.home && isBaseUndo(undo) ? undoBase(context(), await read(), undo) : otherHome));
  handle('history:restore', async (eventId, home, choice) => (home === current?.home && typeof eventId === 'string'
    ? await (async () => {
      const past = (await readHistory(context())).find(entry => entry.id === eventId);
      if (past?.kind === 'profile') return undoSwitch(context(), await toolsNow(), eventId);
      // A tool's Manage switch has no Undo (History offers none): the switch on its card is the way back.
      if (past?.kind === 'managing') return { stopped: 'Turning a tool’s Manage switch has no Undo: turn it back on the tool’s Harnesses card.', results: [], harnessWrites: 0 };
      // Synchronize everything switched on: its one Undo; that Undo's entry: its Restore (everything.ts).
      if (past?.kind === 'everything') return everythingEntryAction(context(), await toolsNow(), eventId);
      // A pull that changed only an agent's Claude Code settings has its own Undo (its earlier file, kept whole).
      if (past?.settingsFile) return undoSettingsChange(context(), eventId);
      // A Pull that edited or deleted the base instructions: the base's own Undo puts the earlier base and its tools back.
      if (past?.base) return undoPulledBase(context(), await read(), eventId);
      // A library item's entry goes to its kind's restore, by the one rule for whose an entry is; any other reaches none.
      const whose = past && libraryEntry(past);
      if (!whose) return { stopped: 'That History entry has nothing Central Knot can undo. Nothing was changed.', results: [], harnessWrites: 0 };
      const version = typeof choice === 'string' ? choice : undefined;
      const restored = await { skills: restoreSkill, mcp: restoreServer, agents: restoreAgent }[whose.kind](context(), await toolsNow(), eventId, version);
      return { stopped: restored.stopped, results: restored.results, harnessWrites: restored.writes, made: restored.made };
    })()
    : { stopped: elsewhere, results: [], harnessWrites: 0 } satisfies ApplyResult));
  // Profiles: their definitions are Central Knot's own file; a switch is the library's own On and Off clicks (profiles.ts).
  handle('profiles:save', async (profile, home) => {
    if (home !== current?.home || !profile || typeof profile !== 'object') return { problem: elsewhere };
    const input = profile as { id?: unknown; name?: unknown; items?: unknown; restore?: unknown };
    const saved = await saveProfile(context(), { id: typeof input.id === 'string' ? input.id : undefined, name: typeof input.name === 'string' ? input.name : undefined, items: strings(input.items), restore: input.restore === true });
    return saved.problem ? saved : { ...saved, profiles: await profilesSaved() };
  });
  handle('profiles:delete', async (id, home) => {
    if (home !== current?.home || typeof id !== 'string') return { problem: elsewhere };
    const deleted = await deleteProfile(context(), id);
    return deleted.problem ? deleted : { profiles: await profilesSaved() };
  });
  handle('profiles:switch', async (id, home) => {
    if (home !== current?.home || typeof id !== 'string') return { stopped: elsewhere, on: [], off: [], left: [], results: [] };
    const result = await switchProfile(context(), await toolsNow(), id);
    return { ...result, view: await syncThenView() };
  });
  handle('sync:set', async on => { await saveSyncSetting(on === true); return current ? syncThenView() : null; });
  // Synchronize everything, the open home's standing rule (everything.ts setSyncEverything): turned on, the pass right after takes
  // in what is found now, with Automatic sync on (with it off, at Sync once). `answering`: first setup's question (firstsetup.ts).
  handle('sync:everything', async (on, home, answering) => {
    if (home !== current?.home) return { stopped: elsewhere, view: null };
    const set = await setSyncEverything(context(), on === true, answering === true);
    if (!set.stopped) log(`sync: Synchronize everything ${on === true ? 'on' : 'off'} in ${home}`);
    return { ...set, view: await syncThenView() };
  });
  handle('sync:now', async home => (home === current?.home ? syncThenView(true) : null));
  // One install at a time: the build the held screen names (by its id, and for Replace its bundle) replaced, or quit where it only
  // runs; then this build carries on (carryOn). On a click alone.
  const notHere = { said: 'Another build is replaced or quit only by the installed app on a Mac.', done: false, view: null };
  const named = (build: unknown, path?: unknown) => (Array.isArray(others) ? others : []).find(each => each.build === build && (path === undefined || each.installed === path));
  const gone = async () => ({ said: 'That build isn’t found here any more, so nothing was removed or asked to quit.', done: false, view: await syncThenView() });
  handle('builds:replace', async (path, build) => {
    const builds = buildsContext(), other = named(build, path);
    return !builds || !current ? notHere : other ? carryOn(other, await removeBuild(builds, other)) : gone();
  });
  handle('builds:quit', async build => {
    const builds = buildsContext(), other = named(build);
    return !builds || !current ? notHere : other ? carryOn(other, await quitBuild(builds, other)) : gone();
  });
  handleNow('app:quit', async () => { quitting = true; app.quit(); });
  // A tool's Manage switch (toolchoice.ts chooseTools), then the home read again: with Automatic sync on, that pass brings a tool
  // turned on into line, and what it did there (`did`) is what the page's band says. A tool turned on is new to the plugins
  // record (marketplaces.ts toolManaged), and gets each On plugin not kept out of it at a check made now.
  handle('tools:manage', async (tool, on, resume, home) => {
    if (home !== current?.home || !isTool(tool) || typeof on !== 'boolean') return { stopped: elsewhere, view: null, did: [] };
    const chosen = await chooseTools(context(), tool, on, resume === true);
    if (!chosen.stopped) {
      log(`sync: ${tool} ${on ? 'managed' : 'left out'} in ${home}`);
      if (on) await markets.toolManaged(tool, home).catch(error => logFailure('plugins record', error));
      if (on && pluginChecksRun) void pluginUpdates?.toolJoined().catch(error => logFailure('plugin updates', error));
    }
    const { view, passed } = await syncAndView();
    return { ...chosen, view, did: (passed.done ?? []).filter(result => result.harness === tool) };
  });
  // With Sync off, a click writes exactly the items it is about; spreading anything else waits for Sync.
  handle('servers:apply', async (list, resume, home) => (home === current?.home
    ? applyServers(context(), await toolsNow(), changes(list), { resume: resume === true, ...(syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) }) })
    : { stopped: elsewhere, results: [], writes: 0 }));
  handle('agents:apply', async (list, resume, home) => (home === current?.home
    ? applyAgents(context(), await toolsNow(), changes(list), { resume: resume === true, ...(syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) }) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  handleNow('servers:version', async (key, hash) => (current && typeof key === 'string' && typeof hash === 'string' ? (await serverVersion(context(), key, hash)) ?? null : null));
  handle('skills:apply', async (list, resume, home) => (home === current?.home
    ? applySkills(context(), await toolsNow(), changes(list), { resume: resume === true, ...(syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) }) })
    : { stopped: elsewhere, results: [], writes: 0 }));
  // A skill's two actions a Change can't carry: a tool's own switch cleared, and a copy outside Central Knot's taken over.
  handle('skills:clear-switch', async (key, tool, resume, home) => (home === current?.home && typeof key === 'string' && isTool(tool)
    ? clearSwitch(context(), await toolsNow(), key, tool, resume === true) : { stopped: elsewhere, results: [], writes: 0 }));
  handle('skills:take-over', async (key, tool, resume, home) => (home === current?.home && typeof key === 'string' && isTool(tool)
    ? takeOver(context(), await toolsNow(), key, tool, resume === true) : { stopped: elsewhere, results: [], writes: 0 }));
  handleNow('skills:version', async (key, hash) => (current && typeof key === 'string' && typeof hash === 'string' ? (await skillVersion(context(), key, hash)) ?? null : null));
  // The git repo the Managed set lives in. Reading it, and asking the repo for its latest commit, waits for no sync pass;
  // Connect, Pull, Push and Disconnect take their turn with every other change.
  // Every repo call knows whether Automatic sync is on: while it is off, an MCP server's or agent's deletion waits for it.
  // Base instructions travel as instructions/base.md (repoBase).
  const repoOptions = () => ({ syncOn, base: repoBase(context(), read) });
  const repoElsewhere = async () => ({ stopped: elsewhere, results: [], view: await repoView(context(), repoOptions()) });
  handleNow('repo:view', async check => (current ? repoView(context(), { ...repoOptions(), check: check === true }) : null));
  handle('repo:connect', async (url, branch, home) => (home === current?.home && typeof url === 'string' && typeof branch === 'string' ? connectRepo(context(), url, branch, repoOptions()) : repoElsewhere()));
  handle('repo:pull', async home => (home === current?.home ? pullRepo(context(), repoOptions()) : repoElsewhere()));
  handle('repo:push', async home => (home === current?.home ? pushRepo(context(), { ...repoOptions(), from: current!.mode === 'actual' ? hostname() : current!.label }) : repoElsewhere()));
  handle('repo:disconnect', async home => (home === current?.home ? disconnectRepo(context(), repoOptions()) : repoElsewhere()));
  // Sources (sources.ts): a Git link read on a click, never written. Look and Check now fetch outside the queue, so a slow
  // network never holds a sync pass up; what a check brings takes its turn with every other change (`queued`).
  const sourceElsewhere = { stopped: elsewhere, view: null };
  handleNow('sources:view', async () => (current ? sourcesView(context(), await toolsNow()) : null));
  handleNow('sources:preview', async (link, home) => (home === current?.home && typeof link === 'string' ? previewSource(context(), await toolsNow(), link) : { refused: elsewhere, link: String(link ?? '') }));
  handle('sources:add', async (token, home) => (home === current?.home && typeof token === 'string' ? addSource(context(), await toolsNow(), token) : sourceElsewhere));
  handleNow('sources:check', async (id, home) => (home === current?.home && typeof id === 'string' ? checkSource(context(), toolsNow, id, queued) : sourceElsewhere));
  // A click on a name's line: its kind and click passed on as sent (as text), and refused there unless both are known.
  handle('sources:row', async (id, kind, key, click, home) => (home === current?.home && typeof id === 'string' && typeof key === 'string'
    ? rowClick(context(), await toolsNow(), id, String(kind), key, String(click)) : sourceElsewhere));
  handle('sources:remove', async (id, home) => (home === current?.home && typeof id === 'string' ? removeSource(context(), await toolsNow(), id) : sourceElsewhere));
  await loading;
  if (smoke) {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise((resolveResult, rejectResult) => {
        const deadline = Date.now() + 5000;
        const check = async () => {
          if (document.body.dataset.ready === 'true') {
            const view = await window.centralKnot.refresh();
            resolveResult({ rows: document.querySelectorAll('.kind-card').length, home: document.querySelector('#home-label').textContent, skills: view.skills.items.map(skill => skill.key + ':' + Object.keys(skill.copies).length).join(','), allowed: view.sync.access.allowed });
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
