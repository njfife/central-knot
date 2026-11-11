import { PRODUCT, onlyAllowed, record, strings } from './values.ts';
import { execFile } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { discover, findOtherApps } from './discovery.ts';
import { configRoot, envOverride, harnesses, harnessIds, writeRoot } from './harnesses.ts';
import { CLAUDE_PROCESS, appCandidates, executableCandidates, searchPath } from './platform.ts';
import { syncsHere, takeOverSync, writeAccess, type ShareContext } from './share.ts';
import { applyChanges, deleteEverywhere, eventChange, manageView, pruneHistory, readHistory, restoreFromHistory } from './manage.ts';
import { agentTools, mcpTools, noteTools, pluginTools, presentTools } from './presence.ts';
import { installedPlugins } from './plugins.ts';
import { checkFeed, type FeedCheck } from './bundlefeed.ts';
import { applyMcp, mcpFile, mcpView, restoreMcp, undoClaudeWrite } from './mcp.ts';
import { agentsView, applyAgents, convertAgentToSkill, restoreAgent } from './agents.ts';
import { applyBase, baseView, instructionsView, instructionVersion, repoBase, saveInstruction, undoBase } from './instructions.ts';
import { clearDraftFolders, draftSources, draftTools, writeDraft } from './draftbase.ts';
import { registerMarketplaces } from './marketplaces.ts';
import { connectRepo, disconnectRepo, pullRepo, pushRepo, repoView, undoPulledBase, undoSettingsChange } from './gitrepo.ts';
import { readParts } from './parts.ts';
import { readItemTexts, readPluginItems } from './pluginitems.ts';
import { trayIconPng } from './trayicon.ts';
import { deleteProfile, driftNow, switchFilesStamp, readProfiles, releaseProfileHolds, saveProfile, switchedByHand, switchProfile, undoProfileSwitch } from './profiles.ts';
import { activeProfile, driftOf, NO_PROFILE, presentItems, profilesInUse, switchItems, type SwitchItem } from './profileplan.ts';
import { defaultHistoryDays, historyDayChoices, plural } from './model.ts';
import { signInArgs, signInLabel, signInState, whyNoSignIn } from './signin.ts';
import type { ActionReport, Appearance, ApplyResult, PartsPick, AppPreferences, PluginActionResult, PluginUpdatesView, UpdateView, BaseApply, BaseDraft, BaseUndo, Change, ClaudeWrite, DestinationResult, HarnessId, HistoryDays, HistoryList, HistoryPrune, HistoryWindowSaved, HomeMode, HomeView, ProfilesView, ShownLog, Snapshot, SyncNotice } from './types.ts';
import { machineNames } from './machine.ts';
import { toolList } from './words.ts';
import { startUpdater, type PendingUpdate } from './updater.ts';
import { autoUpdates, CHECK_EVERY_MS, PLUGIN_UPDATES_DEFAULT, type UpdatesRecord } from './pluginupdates.ts';
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
/**
 * A custom build (bundle.ts): its identity file sits beside this code. It keeps its settings in a folder of its own, so it
 * runs beside the standard app and never reads or writes that app's settings (ORG-07). A data folder named on the command
 * line (tests) still wins.
 */
const custom = readCustomBuildSync(__dirname);
if (custom) {
  app.setName(custom.name);
  // Named by its bundle id, which no other app's folder is (a build named after a company could otherwise land in that company's own app's folder).
  if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), custom.bundleId));
}
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'central-knot-smoke-')));
// Test-only, read only when set: an update's restart is opened by macOS afresh, with no arguments and the login's own HOME, so
// a test build carries its throwaway home, data folder and debug port in its environment (Info.plist LSEnvironment) instead
// of HOME, --user-data-dir and --remote-debugging-port (scripts/update-proof.mjs).
if (process.env.CK_TEST_HOME) process.env.HOME = process.env.CK_TEST_HOME;
if (process.env.CK_TEST_USER_DATA) app.setPath('userData', process.env.CK_TEST_USER_DATA);
if (process.env.CK_TEST_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.CK_TEST_DEBUG_PORT);
// Asked now, while the window is being made, so the first read of this computer's tools doesn't wait on a shell's startup.
void searchPath();
/** This build's name in a home's sync record: the standard app's, or a custom build's own. */
const BUILD = custom?.bundleId ?? STANDARD_BUILD;
/** The marketplace a bundled build carries, as unpacked at open (bundle.ts); undefined for any other build, or when it couldn't be unpacked. */
let bundle: ActiveBundle | undefined;
let window: BrowserWindow;
let current: { mode: HomeMode; home: string; label: string } | undefined;
/** Whether the open home can be written; read with each view, so the menus can say "preview only" like the window. */
let homeWritable = true;
let lastManagedCount = 0;
/** The open home's profiles as last read, for the menu bar's Profile menu. */
let lastProfiles: ProfilesView = { profiles: [], offByProfile: {} };
/** How many items the tools no longer match the profile in use on, as last read (the menus say so beside its name). */
let lastDrift = 0;
/**
 * The switch files' modification times as the page last read them (or the background last looked): a change since then was made
 * in a tool's own settings. Every page read takes it again, so Central Knot's own writes (a switch, a Disable, an MCP Apply) and
 * another home's files never count as one.
 */
let lastStamp = '';
/** Every item a profile can switch, as the page last read them: a profile edit works out its drift from these, without a read. */
let lastItems: SwitchItem[] = [];
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
    home: current!.home, mode: current!.mode, read, build: BUILD, buildName: custom?.name ?? PRODUCT,
    settingsPath: join(app.getPath('userData'), 'sharing-settings.json'), realHome: homedir(),
    allowActualWrites: process.platform === 'darwin' && !smoke,
    overrides: Object.fromEntries(harnessIds.map(id => [id, overrideFor(id)])),
    historyDays: historyDays(),
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
function send(channel: 'sync:changed' | 'settings:changed' | 'navigate' | 'updates:changed' | 'plugin-updates:changed' | 'said', ...args: unknown[]) {
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
 * Shows Central Knot's own log in Finder or Explorer, selected; before anything was logged, the folder it goes in. Linux
 * always opens the folder: selecting a file there depends on the file manager and, like every selection, reports nothing
 * back, while opening the folder says why it couldn't. So a selection can only be taken as done; the page says which it got.
 */
async function showLog(): Promise<ShownLog> {
  const logged = await access(logPath()).then(() => true, () => false);
  if (logged && process.platform !== 'linux') { shell.showItemInFolder(logPath()); return { selected: true, logged }; }
  const failed = await shell.openPath(app.getPath('userData'));
  if (failed) throw new Error(failed);
  return { selected: false, logged };
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
  return { label: signInLabel(state), type: 'checkbox', checked: state.on, enabled: state.available, click: item => saveSignInQuietly(item.checked) };
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
function showWindow() {
  // Startup makes the first window. macOS sends `activate` during startup too: that must never make a second one.
  if (!app.isReady() || !window) return;
  if (window.isDestroyed()) { createWindow(true); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  joinDock();
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
  return unseen ? `Sync made changes · Show (${where})` : unseenPlugins ? `${unseenPlugins === 'updated' ? 'Plugins were updated' : 'A plugin couldn’t be updated'} · Show (${where})` : `Home: ${where}${current && lastManagedCount === 0 ? ' · nothing managed yet' : ''}`;
}
/** The status line's click: the window, on Plugins when what is unseen is an automatic update. */
const showNews = () => (unseenPlugins && !unseen ? showPage('plugins') : showWindow());
/** The active profile's name, or undefined for No profile. */
const activeProfileName = () => activeProfile(lastProfiles)?.name;
/**
 * A choice in the Profile menu. The profile in use, already matching, needs nothing: an empty switch's band would replace the last
 * one's Undo (the menu is only drawn again, since a radio item ticks itself when clicked). The drift it goes by is the background's
 * last look, at most one poll old. Otherwise it switches: a switch that couldn't start, or that changed nothing (every flip failed),
 * waits on the page with sync's results; one that changed something goes to the page's band with Undo. Its own writes are stamped,
 * as a page read stamps them, so the background never takes them for a change made in a tool.
 */
function switchFromMenu(id: string | null) {
  if (id === (lastProfiles.active ?? null) && !lastDrift) { refreshTray(); return; }
  void fromTray(async () => {
    if (!current) return;
    const result = await switchProfile(context(), id);
    if (result.stopped) pendingResults.push({ item: 'Profile', outcome: 'failed', message: result.stopped });
    else if (result.event && window && !window.isDestroyed()) window.webContents.send('profile:switched', result);
    else pendingResults.push(...result.results.filter(item => item.outcome === 'failed'));
    lastStamp = await switchFilesStamp(context()).catch(() => lastStamp);
    const fresh = await driftNow(context());
    lastItems = fresh.items;
    followProfiles(fresh.profiles, fresh.drift);
  });
}

/**
 * Profile: one click switches, from the menu bar or the app menu. The label says which is in use; each profile is a radio item.
 * Before any profile exists (and nothing is held off by one), "Profiles…" opens the page that makes one.
 */
function profileMenu(): Electron.MenuItemConstructorOptions {
  if (!profilesInUse(lastProfiles)) return { label: 'Profiles…', enabled: !!current, click: () => showPage('profiles') };
  const usable = homeWritable && !!current;
  const drift = lastDrift ? ` (${plural(lastDrift, 'item')} to apply)` : '';
  return { label: `Profile: ${activeProfileName() ?? NO_PROFILE}${drift}`, submenu: [
    { label: NO_PROFILE, type: 'radio', checked: !lastProfiles.active, enabled: usable, click: () => switchFromMenu(null) },
    // An empty profile would turn everything off: offered once something is in it, as on the Profiles page.
    ...lastProfiles.profiles.map(profile => {
      const empty = !presentItems(profile, lastItems).length;
      return { label: empty ? `${profile.name} (empty)` : profile.name, type: 'radio' as const, checked: profile.id === lastProfiles.active, enabled: usable && (!empty || profile.id === lastProfiles.active), click: () => switchFromMenu(profile.id) };
    }),
    // The profile in use no longer matches the tools: applying it again is one click here too, as in the status bar menu.
    ...(lastDrift ? [{ type: 'separator' as const }, { label: `Apply ${activeProfileName() ?? NO_PROFILE} to tools (${plural(lastDrift, 'item')})`, enabled: usable, click: () => switchFromMenu(lastProfiles.active ?? null) }] : []),
    { type: 'separator' },
    { label: 'Edit profiles…', click: () => showPage('profiles') },
  ] };
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
    { label: homeWritable ? 'Automatic sync' : 'Automatic sync (paused: preview only)', type: 'checkbox', checked: syncOn && homeWritable, enabled: homeWritable, click: item => void fromTray(async () => { await saveSyncSetting(item.checked); }) },
    { label: 'Sync once (automatic sync stays off)', toolTip: 'Apply waiting changes once', visible: !syncOn && homeWritable, enabled: !!current, click: () => void syncOnce() },
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
  const profile = activeProfileName();
  tray.setToolTip(`Central Knot${profile ? ` · Profile: ${profile}` : ''}${unseen ? ': sync made changes' : unseenPlugins === 'updated' ? ': plugins were updated' : unseenPlugins ? ': a plugin couldn’t be updated' : ''}`);
  // The active profile is always in sight: its name sits beside the menu bar icon.
  // Shortened past 20 characters, so a long name can't crowd the menu bar (the full name is in the tooltip and the menu).
  const short = profile && profile.length > 20 ? `${profile.slice(0, 19)}…` : profile;
  if (process.platform === 'darwin') tray.setTitle(`${unseen || unseenPlugins ? '•' : ''}${short ? ` ${short}` : ''}`.trim());
}
/** Sync once, from either menu: one pass that writes, with Automatic sync left off. */
const syncOnce = () => fromTray(async () => { keepMcpAndAgents((await pass(await read(), true)).mcpAndAgents); });
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
      { label: homeWritable ? 'Automatic sync' : 'Automatic sync (paused: preview only)', type: 'checkbox', checked: syncOn && homeWritable, enabled: homeWritable, click: item => void fromTray(async () => { await saveSyncSetting(item.checked); }) },
      { label: 'Sync once (automatic sync stays off)', toolTip: 'Apply waiting changes once', visible: !syncOn && homeWritable, enabled: !!current, click: () => void syncOnce() },
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
let pendingMcpNotices: SyncNotice[] = [], pendingAgentNotices: SyncNotice[] = [];
let lastStopped: string | undefined;

interface McpAndAgentsResult { failures: DestinationResult[]; stopped: DestinationResult[]; mcpNotices: SyncNotice[]; agentNotices: SyncNotice[]; changed: boolean; settling: boolean }
interface PassResult { skills?: ApplyResult; mcpAndAgents?: McpAndAgentsResult }

/**
 * One pass on the open home: writes only with Sync on (or when asked explicitly), otherwise it just keeps the evidence.
 * `snapshots`: the caller's read of the home, which the pass uses instead of reading it again.
 */
async function pass(snapshots: Snapshot[], explicit = false): Promise<PassResult> {
  const shared: ShareContext = { ...context(), read: async () => snapshots, reads: new Map() };
  if (!(await syncsHere(shared))) return {};
  const skills = await applyChanges(shared, [], false, { observeOnly: !syncOn && !explicit });
  // MCP servers catch up with the same switch: edits and deletions spread with Sync on (Claude Code still waits for Write now).
  if (!syncOn && !explicit) return { skills };
  const present = presentTools(snapshots);
  const crashes: DestinationResult[] = [];
  const crashed = (item: string) => (error: unknown) => { crashes.push({ item, outcome: 'failed', message: `${item} could not finish: ${error instanceof Error ? error.message : String(error)}` }); return undefined; };
  const mcp = await applyMcp(shared, present, []).catch(crashed('MCP sync'));
  // Agents follow the same switch and rules (D-32).
  const agents = await applyAgents(shared, present, []).catch(crashed('Agents sync'));
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
  const shared: ShareContext = { ...context(), reads: new Map() };
  const before = await read();
  const { skills, mcpAndAgents } = await pass(before, explicit);
  keepMcpAndAgents(mcpAndAgents);
  // A pass that could not finish says so on the page instead of failing quietly.
  const caughtUp = [...pendingResults.splice(0), ...(skills?.results ?? []), ...(skills?.stopped ? [{ item: 'Sync', outcome: 'failed' as const, message: skills.stopped }] : [])];
  const notices = [...pendingNotices.splice(0), ...(skills?.notices ?? [])];
  const profiles = await readProfiles(current!.home);
  // Taken before the reads below, so a switch turned in a tool while they run is still seen by the background's next look.
  lastStamp = profilesInUse(profiles) ? await switchFilesStamp(shared).catch(() => '') : '';
  // The home is read again after a pass that may have written (Sync on, or Sync once): a pass that stopped part-way reports
  // no writes, yet may have made some. An observe-only pass, or one that couldn't run, wrote nothing.
  const snapshots = skills && (syncOn || explicit) ? await read() : before;
  const writable = (await writeAccess(shared)).allowed;
  const readId = handoff.id + 1;
  const made: HomeView = {
    mode: current!.mode, label: current!.label, home: current!.home, snapshots, syncOn, practice: practiceAvailable(), readId, profiles, parts: await readParts(current!.home),
    // Apps that run the tools or read their files are looked for only on this computer, like the tools' own apps.
    ...(current!.mode === 'actual' ? { otherApps: await findOtherApps(current!.home) } : {}),
    manage: await manageView(shared, { caughtUp: caughtUp.filter(result => result.outcome === 'written' || result.outcome === 'removed' || result.outcome === 'failed' || result.chooseAgain), notices, snapshots }),
    mcp: await mcpView(shared, presentTools(snapshots), pendingMcpNotices.splice(0)),
    agents: await agentsView(shared, presentTools(snapshots), pendingAgentNotices.splice(0)),
  };
  // What plugins installed whole bring, read with the home so the Skills, MCP servers and Agents pages show it without Plugins.
  // With the view's own reads, so each tool's installed plugins are read once for these rows and the pages' Through a plugin boxes.
  made.pluginItems = await readPluginItems(pluginItemsContext(shared.overrides, shared.reads), presentTools(snapshots));
  // Another build syncs this home: whether it is open now decides what the page says about it.
  if (made.manage.gate.state === 'stopped' && made.manage.gate.owner) made.manage.gate.owner.running = await buildRunning(made.manage.gate.owner.build);
  lastItems = switchItems(made.manage, made.mcp);
  followProfiles(made.profiles);
  // Only once the view is built is anything kept about this home, so a switch that fails leaves nothing behind.
  handoff = { id: readId, home: current!.home, snapshots };
  toolsChangedHere(snapshots);
  addCarriedSoon(presentTools(snapshots));
  if (writable !== homeWritable) { homeWritable = writable; refreshTray(); }
  // How many items are managed, so the first-close note says truthfully whether anything syncs.
  lastManagedCount = [...made.manage.skills, ...made.mcp.servers, ...made.agents.servers].filter(fact => fact.managed).length;
  return made;
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
  if (!feed || smoke) return Promise.resolve();
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
 * Whether the build with this identity is open now, as macOS has it (an installed app, by its bundle id); undefined
 * where that can't be told (other systems, or a build run from its source).
 */
function buildRunning(build: string): Promise<boolean | undefined> {
  if (process.platform !== 'darwin' || !app.isPackaged) return Promise.resolve(undefined);
  return new Promise(done => execFile('/usr/bin/lsappinfo', ['info', '-only', 'pid', '-app', build], { timeout: 5_000 }, (error, out) => done(error ? undefined : /"pid"\s*=\s*\d+/.test(String(out)))));
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
    send('said', `Nothing was installed: ${custom?.marketplace?.displayName ?? bundle?.release.marketplace} is listed in ${added.length > 2 ? 'your tools' : toolList(added)} (see Plugins).`);
  }, error => logFailure('adding the carried marketplace to the tools', error));
}

/** Background passes run through the same queue as the page's requests, one at a time, and tell the page when something changed. */
const POLL_MS = 20_000;
const DEBOUNCE_MS = 1_500;
let watchers: FSWatcher[] = [];
let poller: NodeJS.Timeout | undefined;
let soon: NodeJS.Timeout | undefined;
let followUp: NodeJS.Timeout | undefined;

/** The menus follow the open home's profiles and how many items its tools no longer match the profile in use on. */
function followProfiles(profiles: ProfilesView, drift = driftOf(lastItems, profiles)) {
  if (JSON.stringify(profiles) === JSON.stringify(lastProfiles) && drift === lastDrift) return;
  lastProfiles = profiles;
  lastDrift = drift;
  refreshTray();
}

/**
 * After a profile is made, changed or deleted (Central Knot's own file only, no tool changes): the profiles for the page, which
 * needs no other read, and the menus. Profiles that just came into play start the background's look at switch files here.
 */
async function profilesSaved(): Promise<ProfilesView> {
  const profiles = await readProfiles(current!.home);
  if (profilesInUse(profiles) && !lastStamp) lastStamp = await switchFilesStamp(context()).catch(() => '');
  followProfiles(profiles);
  return profiles;
}

/**
 * A switch turned in a tool's own settings (outside Central Knot) changes no content, so sync writes nothing: while profiles are
 * in play, the background looks at the switch files on its own. When one changed since the page read them, or something else
 * changed (the pass wrote, or a file event: an item may have come or gone), drift is worked out again and the menus follow it.
 * Returns whether the page should read again (its marks show each switch). Codex's config.toml and Pi's mcp.json hold MCP
 * entries too, so an MCP edit there counts.
 */
async function lookAtSwitchFiles(somethingChanged: boolean): Promise<boolean> {
  if (!profilesInUse(lastProfiles)) return false;
  const stamp = await switchFilesStamp(context()).catch(() => '');
  const switched = stamp !== lastStamp;
  if (!switched && !somethingChanged) return false;
  lastStamp = stamp;
  const fresh = await driftNow(context()).catch(() => undefined);
  if (fresh) lastItems = fresh.items;
  const drift = fresh?.drift ?? lastDrift;
  const drifted = drift !== lastDrift;
  followProfiles(fresh?.profiles ?? lastProfiles, drift);
  return switched || drifted;
}

/** A watcher event since the last pass: with Sync off nothing is written, but the page still shows the edit as pending. */
let touched = false;

/** The tools in the open home, read now: the one way the requests below learn them. */
const presentNow = async (): Promise<HarnessId[]> => presentTools(await read());

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

/** Notes the open home's tools (noteTools); when they changed, the folders are watched again, so a new tool is watched like the rest. */
function toolsChangedHere(snapshots: Snapshot[]): boolean {
  const { noted, changed } = noteTools(lastPresent, current?.home ?? '', snapshots);
  lastPresent = noted;
  if (changed) void startWatching();
  return changed;
}

function queueBackgroundPass() { if (current && !smoke) void queued(backgroundPass).catch(() => undefined); }

async function backgroundPass() {
  if (!current) return;
  const fromEvent = touched;
  touched = false;
  // The home is read once per pass, whatever Sync or write access say (reading writes nothing), and the pass uses that read.
  // Whatever the pass finds, the page is told once, at the end (it keeps the news until it can read).
  const snapshots = await read();
  // A tool installed or removed changes every page's columns.
  let changed = toolsChangedHere(snapshots);
  const { skills, mcpAndAgents } = await pass(snapshots);
  keepMcpAndAgents(mcpAndAgents);
  // Sync off: an edit or deletion is only noted. The page reads again quietly so it shows as waiting, not as Synced.
  if (fromEvent && !syncOn) changed = true;
  // A deletion waits out its settle window: look again just after it, so it finishes without a click. Otherwise wait for an event or the poll.
  if (skills?.settling || mcpAndAgents?.settling) { clearTimeout(followUp); followUp = setTimeout(queueBackgroundPass, 2_500); }
  if (skills?.stopped && skills.stopped !== lastStopped) {
    pendingResults.push({ item: 'Sync', outcome: 'failed', message: skills.stopped });
    changed = true;
  }
  lastStopped = skills?.stopped;
  const wrote = !!skills && !!(skills.harnessWrites || skills.notices?.length || mcpAndAgents?.changed);
  // Profiles: a switch turned in a tool, or an item that came or went (a file event can be one), changes what is held.
  if (await lookAtSwitchFiles(wrote || fromEvent)) changed = true;
  if (wrote) {
    pendingResults.push(...skills!.results);
    pendingNotices.push(...(skills!.notices ?? []));
    // Nobody saw it: the window is closed, gone or behind other windows (D-36).
    if (window.isDestroyed() || !window.isVisible() || !window.isFocused()) { unseen = true; refreshTray(); }
  }
  if (changed || wrote) send('sync:changed');
}

const nudge = () => { touched = true; clearTimeout(soon); soon = setTimeout(queueBackgroundPass, DEBOUNCE_MS); };

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


/** Whether Claude Code (its CLI, or Claude desktop and its Code tab) is running (macOS and Linux). When this can't be told, Write now goes ahead as asked. */
function claudeRunning(): Promise<boolean> {
  if (current?.mode !== 'actual' || process.platform === 'win32') return Promise.resolve(false);
  const found = (args: string[]) => new Promise<boolean>(done => execFile('pgrep', args, error => done(!error)));
  return found(['-x', 'claude']).then(native => native || found(['-f', CLAUDE_PROCESS]));
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
 * it (with the tool's own output when its command failed), and each item an Apply all couldn't change. The words the page
 * showed, and where they name one, the path and the system's error code; never an item's content.
 */
function logOutcome(channel: string, args: unknown[], result: unknown) {
  try { logged(channel, args, result); } catch (error) { logFailure(`${channel} (logging its outcome)`, error); }
}
function logged(channel: string, args: unknown[], result: unknown) {
  if (!result || typeof result !== 'object') return;
  const { stopped, reports, results } = result as { stopped?: unknown; reports?: unknown; results?: unknown };
  if (typeof stopped === 'string') log(`${channel} stopped: ${stopped}`);
  // A plugin step's request names the marketplace and the plugin second and third; a pick of single parts names them last.
  const pick = channel === 'plugins:parts' ? args[7] as PartsPick | null : null;
  const picked = pick ? ` (${[pick.on.length ? `on: ${pick.on.map(part => `${part.kind} ${part.name}`).join(', ')}` : '', pick.off.length ? `off: ${pick.off.map(part => `${part.kind} ${part.name}`).join(', ')}` : '', pick.rest ? 'with the rest' : ''].filter(Boolean).join('; ')})` : '';
  const plugin = channel.startsWith('plugins:') && typeof args[1] === 'string' && typeof args[2] === 'string' ? ` ${args[2]}@${args[1]}${picked}` : '';
  for (const report of Array.isArray(reports) ? reports as ActionReport[] : []) {
    log(`${channel}${plugin} in ${report.tool}: ${report.outcome}${report.changed ? '' : ', nothing changed'}: ${[report.message, ...(report.notes ?? [])].join(' ')}`);
    for (const run of report.runs.filter(run => !run.ok)) log(`${channel}${plugin} in ${report.tool}: \`${run.command}\` failed: ${run.output.trim().slice(0, 2000)}`);
  }
  for (const item of Array.isArray(results) ? results as DestinationResult[] : []) {
    if (item.outcome === 'failed' || item.outcome === 'held') log(`${channel} ${item.item}${item.harness ? ` in ${item.harness}` : ''}: ${item.outcome}: ${item.message}`);
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
  // are rebuilt and the page re-reads, both from this one event.
  window.on('focus', () => { unseen = false; unseenPlugins = undefined; refreshTray(); send('settings:changed'); });
  const design = process.argv.find(arg => arg.startsWith('--design-preview'));
  loading = window.loadFile(join(__dirname, 'index.html'), design ? { query: { design: design.split('=')[1] ?? 'b3' } } : undefined);
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
  if (custom?.feed) feedTimer = setTimeout(() => void lookAtFeed(), FEED_FIRST_MS);
  applyAppearance();
  await firstSignIn();
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
  handleNow('settings:show-log', showLog);
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
  handle('discovery:refresh', async () => (current ? syncThenView() : null));
  // Writes act only on the home the window says it is showing.
  const changes = (value: unknown): Change[] => (Array.isArray(value) ? value : []).filter((change): change is Change =>
    typeof change?.key === 'string' && typeof change.managed === 'boolean' && Array.isArray(change.off)
    && (change.use === undefined || change.use === 'separate' || harnessIds.includes(change.use)) && (change.useHash === undefined || typeof change.useHash === 'string') && (change.seenManaged === undefined || typeof change.seenManaged === 'boolean')
  ).map(change => ({ key: change.key, managed: change.managed, off: ids(change.off), use: change.use, useHash: change.useHash, seenManaged: change.seenManaged,
    ...(change.disable ? { disable: ids(change.disable) } : {}), ...(change.enable ? { enable: ids(change.enable) } : {}), ...(change.remove ? { remove: ids(change.remove) } : {}) }));
  // Marketplaces and plugins: their own module, given only what it needs from here.
  const markets = carriedMarket = registerMarketplaces({ handle, handleNow }, {
    home: () => (current ? { home: current.home, overrides: context().overrides, actual: current.mode === 'actual' } : undefined),
    read: async readId => { const snapshots = await readFor(readId); return { tools: presentTools(snapshots), snapshots }; },
    writeAccess: () => writeAccess(context()),
    dataDir: app.getPath('userData'),
    pickFolder: async () => { const choice = await dialog.showOpenDialog(window, { title: 'Choose a marketplace folder', properties: ['openDirectory'] }); return choice.canceled ? undefined : choice.filePaths[0]; },
    openExternal: url => shell.openExternal(url),
    share: () => context(),
    // A change to a plugin that worked (an update, an uninstall, its parts) settles what failed there by itself before.
    changed: (source, plugin, tools) => void pluginUpdates?.settled(source, plugin, tools).catch(error => logFailure('plugin updates', error)),
    bundled: () => (bundle && custom ? { source: bundle.folder, view: {
      app: custom.name, displayName: custom.marketplace?.displayName, logo: custom.marketplace?.logo && `${CARRIED_FOLDER}/${custom.marketplace.logo}`,
      release: releaseDate(bundle.release, true), from: bundle.release.from || undefined, unpackaged: bundle.release.unpackaged, kept: bundle.release.kept,
      ...(custom.feed ? { feed: feedSeen ? { checked: new Date(feedSeen.checked).toISOString(), outcome: feedSeen.outcome, message: feedSeen.message } : {} } : {}),
    } } : undefined),
  });
  // Plugin updates that arrive by themselves (pluginupdates.ts): each step takes its turn in the queue, like the page's own
  // Apply all, and is logged as one; none starts once the app is quitting (one already running is waited for: see before-quit).
  const noPluginUpdates: PluginUpdatesView = { on: false, paused: false, checking: false, updated: [], failed: [], first: false };
  if (!smoke) {
    const recordPath = join(app.getPath('userData'), 'plugin-updates.json');
    const step = (channel: string, args: unknown[], work: () => Promise<PluginActionResult>): Promise<PluginActionResult> => queued(async () => {
      if (quitting) return { stopped: 'Central Knot was quitting.', reports: [] };
      const running = pluginStep = work();
      try { const result = await running; logOutcome(`${channel} (by itself)`, args, result); return result; }
      finally { if (pluginStep === running) pluginStep = undefined; }
    });
    // Test-only, read only when set: the time between checks in milliseconds, or `never` for no checks but those asked for
    // (the end-to-end run's other flows, which a check a minute after start would walk into).
    const paced = process.env.CK_PLUGIN_UPDATES_EVERY_MS;
    const every = Number(paced) || CHECK_EVERY_MS;
    pluginUpdates = autoUpdates({
      home: () => current?.home, on: pluginUpdatesOn, paused: () => !syncOn, log, now: Date.now, every,
      pending: home => queued(() => markets.pendingUpdates(home)),
      api: {
        update: (source, marketName, plugin, tools, home) => step('plugins:update', [source, marketName, plugin, tools, home], () => markets.update(source, marketName, plugin, onlyAllowed(tools, pluginTools), home, { reinstall: false })),
        parts: (source, marketName, plugin, tool, mode, run, home, pick) => step('plugins:parts', [source, marketName, plugin, tool, mode, run, home, pick], () => markets.parts(source, marketName, plugin, tool, mode, run, home, pick)),
      },
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
      const updates = pluginUpdates;
      const turn = () => void updates.tick().catch(error => logFailure('plugin updates', error));
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
  handle('history:change', async eventId => (current && typeof eventId === 'string' ? eventChange(context(), eventId) : undefined));
  handle('agents:convert', async (key, home) => (home === current?.home && typeof key === 'string'
    ? convertAgentToSkill(context(), await presentNow(), key)
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.' }));
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
  handle('history:restore', async (eventId, resume, home, choice) => (home === current?.home && typeof eventId === 'string'
    ? await (async () => {
      const past = (await readHistory(context())).find(entry => entry.id === eventId);
      if (past?.kind === 'profile') {
        const undone = await undoProfileSwitch(context(), eventId);
        return { stopped: undone.stopped, results: undone.results, harnessWrites: undone.flips.length, flips: undone.flips };
      }
      const key = past?.key ?? '';
      // A pull that changed only an agent's Claude Code settings has its own Undo (its earlier file, kept whole).
      if (past?.settingsFile) return undoSettingsChange(context(), eventId);
      // A Pull that edited or deleted the base instructions: the base's own Undo puts the earlier base and its tools back.
      if (past?.base) return undoPulledBase(context(), await read(), eventId);
      const tools = await presentNow();
      if (key.startsWith('mcp:')) {
        const result = await restoreMcp(context(), tools, eventId);
        // Undo of a server's Disable or Enable is a choice made by hand too.
        await releaseProfileHolds(context(), switchedByHand([{ key: key.slice('mcp:'.length) }], result.results, 'mcp'));
        return { stopped: result.stopped, results: result.results, harnessWrites: result.writes };
      }
      if (key.startsWith('agent:')) return restoreAgent(context(), tools, eventId, typeof choice === 'string' ? choice : undefined).then(result => ({ stopped: result.stopped, results: result.results, harnessWrites: result.writes }));
      const restored = await restoreFromHistory(context(), eventId, resume === true, typeof choice === 'string' ? choice : undefined);
      // Undo of a Disable or Enable is a choice made by hand, like the switch itself: profiles stop holding those switches.
      await releaseProfileHolds(context(), switchedByHand([{ key }], restored.results));
      return restored;
    })()
    : { stopped: elsewhere, results: [], harnessWrites: 0 } satisfies ApplyResult));
  handle('manage:delete-everywhere', async (key, resume, home) => (home === current?.home && typeof key === 'string'
    ? deleteEverywhere(context(), key, resume === true)
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], harnessWrites: 0 } satisfies ApplyResult));
  // Profiles: their definitions are Central Knot's own file; a switch flips each tool's own switches (profiles.ts).
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
    if (home !== current?.home || (id !== null && typeof id !== 'string')) return { stopped: elsewhere, results: [], flips: [] };
    const result = await switchProfile(context(), id as string | null);
    return { ...result, view: await syncThenView() };
  });
  handle('sync:set', async on => { await saveSyncSetting(on === true); return current ? syncThenView() : null; });
  handle('sync:now', async home => (home === current?.home ? syncThenView(true) : null));
  // Take over syncing (ORG-08): this build becomes the home's sync owner, then reads and syncs it as its owner.
  handle('sync:take-over', async home => {
    if (home !== current?.home) return { stopped: elsewhere, view: null };
    const taken = await takeOverSync(context());
    if (taken.from) log(`sync: took over syncing ${home} from ${taken.from}`);
    return { ...taken, view: await syncThenView() };
  });
  // With Sync off, Apply all writes exactly the skills it shows; spreading anything else waits for Sync.
  // MCP: Apply all writes every tool but Claude Code; Claude Code only through Write now, once Claude is closed (MCP-02).
  handle('mcp:apply', async (list, resume, home) => {
    if (home !== current?.home) return { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 };
    const asked = changes(list);
    const result = await applyMcp(context(), await presentNow(), asked, { resume: resume === true, ...(syncOn ? {} : { only: new Set(asked.map(change => change.key)) }) });
    // A Disable or Enable chosen here takes that switch over from profiles, as a skill's does.
    await releaseProfileHolds(context(), switchedByHand(asked.filter(change => change.disable?.length || change.enable?.length), result.results, 'mcp'));
    return result;
  });
  handle('agents:apply', async (list, resume, home) => (home === current?.home
    ? applyAgents(context(), await presentNow(), changes(list), { resume: resume === true, ...(syncOn ? {} : { only: new Set(changes(list).map(change => change.key)) }) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  // Write now is for when Claude Code is closed (MCP-02): a running Claude Code would write its older copy back over it.
  // Its Undo goes through the same check: Claude Code closed, or it would write its copy back over the undone one.
  handle('mcp:unwrite-claude', async (written, home) => (home === current?.home && Array.isArray(written)
    ? current?.mode !== 'fixture' && await claudeRunning() ? { stopped: 'Claude Code or Claude desktop is still running. Quit it first, then click Undo again.', results: [], writes: 0 }
      : undoClaudeWrite(context(), written.filter((write): write is ClaudeWrite => !!write && typeof write.name === 'string' && typeof write.after === 'string' && (write.before === null || typeof write.before === 'string')))
    : { stopped: elsewhere, results: [], writes: 0 }));
  handle('mcp:write-claude', async (names, home) => (home === current?.home && Array.isArray(names)
    // The practice copy is sample files: the real Claude Code never reads them, so it need not be closed there.
    ? current?.mode !== 'fixture' && await claudeRunning() ? { stopped: 'Claude Code or Claude desktop is still running. Quit it first (every window and terminal session), then click Write to Claude Code again.', results: [], writes: 0 } : applyMcp(context(), await presentNow(), [], { claudeNow: names.filter((name): name is string => typeof name === 'string'), ...(syncOn ? {} : { only: new Set(names.filter((name): name is string => typeof name === 'string')) }) })
    : { stopped: 'The home on screen is not the one open. Nothing was written. Read it again.', results: [], writes: 0 }));
  handle('manage:apply', async (list, resume, home) => {
    if (home !== current?.home) return { stopped: elsewhere, results: [], harnessWrites: 0 } satisfies ApplyResult;
    const asked = changes(list);
    const result = await applyChanges(context(), asked, resume === true, syncOn ? {} : { only: new Set(asked.map(change => change.key)) });
    // A Disable or Enable chosen here takes that switch over from profiles: a later switch leaves it as set by hand.
    await releaseProfileHolds(context(), switchedByHand(asked.filter(change => change.disable?.length || change.enable?.length), result.results));
    return result;
  });
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
