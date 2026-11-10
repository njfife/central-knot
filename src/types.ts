export type HomeMode = 'fixture' | 'custom' | 'actual';
export type HarnessId = 'claude-cli' | 'copilot-cli' | 'codex-cli' | 'pi-cli';
export type ProbeState = 'ok' | 'missing' | 'timeout' | 'failed' | 'malformed' | 'restricted' | 'not-run';

export interface ProbeResult {
  state: ProbeState;
  version?: string;
  detail: string;
  /** Found only as an app's own bundled copy (ChatGPT desktop's Codex), which never counts as the CLI. */
  bundled?: boolean;
}

export interface Skill {
  /** Folder name: what the harness root holds and what a copy is called. */
  folder: string;
  name: string;
  description: string;
  path: string;
  /** Entry inside the harness root, possibly a user's link. */
  directory: string;
  realDirectory: string;
  rootLabel: string;
  hasFrontmatter: boolean;
  metadataKeys: string[];
  /** Why Copilot CLI refuses this skill, measured against 1.0.107. */
  copilotProblem?: string;
  /** Why Codex would refuse this skill, by the rules measured on Codex 0.142.3. */
  codexProblem?: string;
  /** Why Pi would not load it: Pi 1.5.0 silently drops a skill with no frontmatter, invalid YAML or no description (CD §4). */
  piProblem?: string;
  content: string;
  notes: string[];
  status: string;
}

export interface Snapshot {
  harness: HarnessId;
  harnessName: string;
  surface: string;
  mode: HomeMode;
  label: string;
  root: string;
  detection: 'Installed' | 'Config found but app not detected' | 'Not found' | 'Version unknown';
  probe: ProbeResult;
  discovery: 'ready' | 'empty' | 'missing' | 'restricted' | 'failed';
  skills: Skill[];
  issues: string[];
}

export interface PlanTarget { harness: HarnessId; directory: string; limits: string[]; note?: string; skipped?: string }

export interface WriteAccess { allowed: boolean; reason: string }

export type SyncGate =
  | { state: 'first-setup' | 'ready' }
  | { state: 'needs-resume'; reason: string }
  | { state: 'stopped'; reason: string };

export interface DestinationResult { item: string; harness?: HarnessId; /** `switched`: disabled or enabled there with the tool's own switch. */ outcome: 'written' | 'kept' | 'held' | 'removed' | 'switched' | 'stayed' | 'failed'; message: string; replaced?: true; caughtUp?: true; chooseAgain?: true; /** `switched`: which way. */ disabled?: boolean }

export interface HomeView { mode: HomeMode; label: string; home: string; snapshots: Snapshot[]; manage: ManageView; /** MCP servers across tools, managed like skills. */ mcp: McpView; /** Agents across tools, managed like skills; lossy destinations one-way. */ agents: McpView; /** The Sync switch (SYN-03): off stops background writes; explicit actions still run. */ syncOn: boolean; /** Whether this build offers the Practice copy (dev builds and tests only). */ practice: boolean; /** The read this view was built from, to pass back for a request made right after (DesktopApi.plugins). */ readId: number }

export interface DesktopApi {
  selectHome(mode: HomeMode): Promise<HomeView | null>;
  refresh(): Promise<HomeView | null>;
  apply(changes: Change[], resume: boolean, home: string): Promise<ApplyResult>;
  history(): Promise<HistoryList>;
  applyMcp(changes: Change[], resume: boolean, home: string): Promise<McpResult>;
  writeClaude(names: string[], home: string): Promise<McpResult>;
  /** Undo of Write to Claude Code: entries back to what Claude Code held before. Claude Code must be closed. */
  unwriteClaude(written: ClaudeWrite[], home: string): Promise<McpResult>;
  applyAgents(changes: Change[], resume: boolean, home: string): Promise<McpResult>;
  /** The home last opened, else this computer's home (dev builds: the practice copy). */
  startHome(): Promise<HomeView | null>;
  setSync(on: boolean): Promise<HomeView | null>;
  syncNow(home: string): Promise<HomeView | null>;
  onSyncChanged(callback: () => void): void;
  /** Central Knot's own settings (how the app looks), as stored by the main process. */
  getSettings(): Promise<AppPreferences>;
  /** Sets the appearance; the window follows at once. Returns the settings as saved. */
  setAppearance(appearance: Appearance): Promise<AppPreferences>;
  /** Turns starting at sign-in on or off. Returns the settings as saved, with the system's answer. */
  setStartAtSignIn(on: boolean): Promise<AppPreferences>;
  /** How long History keeps things. A shorter window also removes what is now older from the open home's History. Returns the settings as saved, and what became of that older History. */
  setHistoryDays(days: HistoryDays): Promise<HistoryWindowSaved>;
  /** Opens the system's own sign-in settings: Login Items on macOS, Startup apps on Windows. */
  openSignInSettings(): Promise<void>;
  /** The settings may have changed: main saved a change (this page, a menu, a dialog), or the window came back (the system's own settings may have changed meanwhile). */
  onSettingsChanged(callback: () => void): void;
  /** Shows Central Knot's own log in the file manager, selected where the system can (else its folder). */
  showLog(): Promise<ShownLog>;
  /** The main process asks for a page (the Settings… menu item). */
  onNavigate(callback: (page: string) => void): void;
  /** `choice`: which overwritten edit to put back, for an event with several. */
  restore(eventId: string, resume: boolean, home: string, choice?: string): Promise<ApplyResult>;
  deleteEverywhere(key: string, resume: boolean, home: string): Promise<ApplyResult>;
  /** Each tool's own instruction file (INS-01). */
  instructions(): Promise<InstructionFile[] | null>;
  /** Convert to skill (AGT-02): an agent as a Pi skill. */
  convertAgent(key: string, home: string): Promise<{ stopped?: string; skill?: string; origin?: HarnessId }>;
  /** A skill edit's SKILL.md before and after, for "See change". */
  eventChange(eventId: string): Promise<{ before: string; after: string } | undefined>;
  /** Shows a file in the system file manager (Finder, Explorer); nothing is opened or changed. */
  showFile(path: string): Promise<void>;
  /** A marketplace's own README, from the copy already read. */
  marketplaceReadme(source: string): Promise<string | null>;
  /** One plugin's contents and README; null when its files can't be found. */
  pluginDetail(source: string, plugin: string): Promise<PluginDetail | null>;
  /** Opens an https link in the browser. */
  openExternal(url: string): Promise<void>;
  saveInstruction(tool: HarnessId, text: string, expected: string, home: string): Promise<InstructionSave>;
  instructionVersion(tool: HarnessId, id: string): Promise<string | undefined>;
  /** Marketplaces and installs; `fresh` fetches every Git marketplace again. */
  /** Marketplaces and installs; `readId` (a view's) reuses the read that view was built from, when it is the latest. */
  plugins(fresh?: boolean, readId?: number): Promise<PluginsView | null>;
  /** Adds a marketplace; `source` is how it was stored, so the page can open exactly that one. */
  addMarketplace(source: string): Promise<{ problem?: string; view?: PluginsView; source?: string }>;
  forgetMarketplace(source: string): Promise<PluginsView | null>;
  pickMarketplaceFolder(): Promise<string | null>;
  installPlugin(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstallPlugin(source: string, marketName: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
  /** Turns one skill of an installed plugin off (`on` false) or back on in one tool, with that tool's own switch (ENB-06). */
  setPluginSkill(source: string, marketName: string, plugin: string, skill: string, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
}

export interface PluginActionResult { stopped?: string; reports: ActionReport[] }

// ---------- Managing skills across tools ----------

export interface ToolCopy {
  hash: string;
  directory: string;
  rootLabel: string;
  lines: number;
  modified: string;
  /** First line of the skill's body, to tell differing copies apart. */
  summary: string;
  /** False for a copy reached through a link or in a folder other tools share: Central Knot never writes there. */
  writable: boolean;
  /** Folder name as found, with its case. */
  folder: string;
}

/** What is true now for one skill, across every tool. The page derives its marks from this. */
export interface SkillFacts {
  /** Made by Convert to skill from an agent (AGT-02): which agent, from which tool, and what an agent had that a skill does not. */
  converted?: { agent: string; origin: HarnessId; losses: string[] };
  key: string;
  name: string;
  description: string;
  copies: Partial<Record<HarnessId, ToolCopy>>;
  /** Further copies a tool also reads, such as Copilot's in ~/.agents/skills. */
  extra: (ToolCopy & { tool: HarnessId })[];
  managed: boolean;
  off: HarnessId[];
  /** Why a tool that lacks the skill could not load a copy. */
  cannot: Partial<Record<HarnessId, string>>;
  /** Why the skill cannot be managed at all, such as a link inside it. */
  held?: string;
  /** The person chose to keep differing copies as they are. */
  separate?: boolean;
  /** Tools whose copy of this managed skill was edited since the last sync and has not spread yet. */
  edited?: HarnessId[];
  /**
   * For each tool's copy, what stops Apply all from making every tool use it: a differing copy Central Knot does not change,
   * or a tool that cannot load it. Each names the tool it concerns, so a tool turned off no longer counts.
   */
  choiceBlocks: Partial<Record<HarnessId, { tool: HarnessId; reason: string }[]>>;
  /** Agents: for each tool that cannot hold every field, the With limits label naming what it lacks (TRN-01). */
  limits?: Partial<Record<HarnessId, string>>;
  oneWay?: { from: HarnessId; lost: string[] };
  /** Agents: the source's own settings that stay in its tool, with their values as written ("tools: Read, Grep"). */
  kept?: string[];
  /** Agents: one-way tools edited or deleted there, which Central Knot stopped updating (D-26). */
  stopped?: HarnessId[];
  /** Skills: tools whose copy is turned off with the tool's own switch. The copy stays there and keeps syncing; the tool doesn't load it. */
  disabled?: HarnessId[];
  /** Skills: why a tool's switch can't be used at all: its settings file can't be read or is in a form Central Knot doesn't edit. */
  switchProblem?: Partial<Record<HarnessId, SwitchProblem>>;
  /** Skills: why a new Disable isn't offered in a tool (a build older than the one verified). Enable stays available. */
  disableUnverified?: Partial<Record<HarnessId, string>>;
}

/** Why a tool's skill switch can't be used: its settings file, and what is wrong with it ("isn’t valid JSON."). */
export interface SwitchProblem { file: string; reason: string }

/** One tool's copy of a skill, as its switch names it: Claude Code by folder, Copilot by name, Codex and Pi by SKILL.md path. */
export interface SwitchTarget { folder: string; name: string; /** Absolute path to the copy's SKILL.md (where it is, or where it will be written). */ skillFile: string }

/** One switch a 'switched' History event changed: which way, the entry it named, and a Claude Code override it replaced ("name-only"). */
export interface SwitchRecord { tool: HarnessId; disabled: boolean; target: SwitchTarget; before?: string }

export interface ManageView {
  tools: HarnessId[];
  /** Where each tool's new copies go, and which other tools read that folder too. */
  writes: Partial<Record<HarnessId, { to: string; alsoReadBy: string[]; /** Why Central Knot does not write there, if it does not. */ blocked?: string }>>;
  skills: SkillFacts[];
  /** What sync did on its own during the read that produced this view. */
  notices: SyncNotice[];
  access: WriteAccess;
  gate: SyncGate;
  /** What the automatic catch-up just did, if anything. */
  caughtUp: DestinationResult[];
}

/**
 * One skill's change for applyChanges. `managed` and `off` always say how it should be managed afterwards: a caller changing only
 * switches or removals passes the skill's current ones (from its SkillFacts), with `seenManaged`, or it changes those too.
 */
export interface Change {
  key: string;
  managed: boolean;
  off: HarnessId[];
  /** For differing copies: the tool whose copy every tool should use, or keep both. */
  use?: HarnessId | 'separate';
  /** The content ID of the chosen copy as the person saw it. A copy changed since is not used. */
  useHash?: string;
  /** Whether the page showed it managed: a change made from an older read is refused if that no longer holds. */
  seenManaged?: boolean;
  /** Skills: tools to disable it in with each tool's own switch. Tools named in neither list keep their switch as it is. */
  disable?: HarnessId[];
  /** Skills: tools to enable it in again. */
  enable?: HarnessId[];
  /** Skills: tools whose copy is removed, kept in History for Restore. A managed skill also stops syncing there. */
  remove?: HarnessId[];
}

export interface ApplyResult { stopped?: string; results: DestinationResult[]; harnessWrites: number; /** Automatic resolutions to tell the person about (CON-02). */ notices?: SyncNotice[]; /** A copy went missing and is inside its settle window: look again shortly. */ settling?: boolean }

/** What sync did on its own: an edit spread, competing edits resolved, or a deletion spread or overruled. */
export interface SyncNotice {
  key: string;
  item: string;
  kind: 'edit' | 'conflict' | 'deleted' | 'kept-edit' | 'reset';
  /** The tool whose edit or deletion won; for a reset, the tool whose folder lost everything. */
  winner: HarnessId;
  /** Tools whose differing copies gave way, or still hold the item after a deletion lost. */
  losers: HarnessId[];
  /** False when the order could not be proved and the fixed tool order decided (CON-04, D-04). */
  orderProved: boolean;
  /** The History event to Undo or Restore from. */
  history: string;
}

/** One entry in History: what changed, which content won, and what is kept to Undo or Restore it. */
export interface HistoryEvent {
  id: string;
  at: string;
  key: string;
  item: string;
  /** 'added': Apply all wrote new copies of a skill that was not managed before; Undo removes them, if unchanged, and unmanages it.
   * 'switched': Apply all disabled or enabled it in some tools (`switched`); Undo flips them back.
   * 'removed': Apply all removed it from the tools in `losers`, keeping each copy; Restore puts them back there. */
  kind: 'edit' | 'conflict' | 'deleted' | 'kept-edit' | 'restored' | 'chosen' | 'added' | 'switched' | 'removed';
  /** 'switched': each tool and whether it was disabled there (true) or enabled (false); `before`, a Claude Code override it replaced ("name-only"), for Undo. */
  switched?: SwitchRecord[];
  /** 'removed': tools whose copy Restore has put back so far; the event is done when all are. */
  restoredTools?: HarnessId[];
  /** 'removed': tools a managed skill stopped syncing to because its copy there was removed; Restore turns syncing back on. */
  stoppedSync?: HarnessId[];
  /** 'removed': the removal took a managed skill's last copies, so it was unmanaged; Restore manages it again. */
  unmanaged?: boolean;
  winner?: { tool: HarnessId; hash: string };
  /** Content that gave way, kept in Central Knot's store. */
  losers: { tool: HarnessId; hash: string; /** MCP: which kept copy of that tool's own settings this replaced, for an exact Restore. */ kept?: string; /** 'removed': the copy's folder name as it was, to put it back under the same name. */ folder?: string;
    /** 'removed', managed: the content last synced to that copy, so Restore puts its sync record back and an unsynced edit in it spreads. */ synced?: string }[];
  /** The synced content before this event, to put back on Undo. */
  previous?: string;
  orderProved: boolean;
  /** Set once undone or restored, naming the event that did it; ALREADY_AS_IT_WAS when nothing needed doing (no event made). */
  undoneBy?: string;
}

// ---------- Marketplaces and plugins ----------
export interface Components { skills: number; commands: number; agents: number; hooks: boolean; mcp: number; mcpRootVariable: boolean; bin: boolean; /** The skills' folder names, to show how a tool will name them. */ skillNames?: string[] }

export interface CatalogPlugin {
  name: string;
  description: string;
  version?: string;
  /** The plugin's folder, when it sits inside the marketplace itself. Elsewhere its components are not known before install. */
  folder?: string;
  /** Its folder is the marketplace's own root ("source": "./"), whose entry may list the plugin's skills. */
  isMarketplaceRoot?: boolean;
  components?: Components;
  displayName?: string;
  category?: string;
  author?: string;
  /** An https page for the plugin, as the marketplace gives it. */
  homepage?: string;
  license?: string;
  keywords?: string[];
  /** For a plugin outside the marketplace: where it comes from, in words, and a web link when there is one. */
  from?: { label: string; url?: string };
  /** For a plugin outside the marketplace: the https Git repository to read it from (main process only). */
  remote?: { url: string; path: string; ref?: string; sha?: string };
  /** Its entry in marketplace.json as written, for the paths it lists (main process only; not sent to the page). */
  entry?: Record<string, unknown>;
}

/** A marketplace as read from its marketplace.json. */
export interface Catalog {
  /** The name it gives itself; tools address its plugins as plugin@name. */
  name: string;
  /** Where it was added from: owner/repo, a Git URL or a folder. */
  source: string;
  kind: 'folder' | 'git';
  /** When it was read (a Git copy: when it was fetched). */
  fetchedAt: string;
  plugins: CatalogPlugin[];
  /** Why it couldn't be read; then it has no plugins. */
  problem?: string;
  /** The folder its files were read from. */
  root?: string;
  owner?: string;
  description?: string;
  /** Why Copilot CLI would refuse this whole marketplace (MKT-06), if it would. */
  copilotRefuses?: string;
}

/**
 * One of an installed plugin's skills that a tool has turned off (ENB-06), by its name (SKILL.md's, or its folder's).
 * `held`: why it can't be turned back on from here: the switch holding it off isn't this plugin's own.
 */
export interface SkillOff { skill: string; held?: string }

export type InstallState = { state: 'installed'; path: string; live?: boolean;
  /** The version the tool records for its copy, or its copy's manifest gives (see plugins.ts copyVersion). */
  version?: string;
  /** Where the tool has a switch for one skill of a plugin: the skills the installed copy holds, and those of them turned off. */
  skills?: string[]; skillsOff?: SkillOff[];
  /** Why none of its skills can be switched here, whatever the skill: the tool's config is written in a form Central Knot doesn't edit. */
  switchesHeld?: string } | { state: 'not-installed' } | { state: 'not-known'; reason: string }
  /** The tool has a different marketplace under the same name: Central Knot neither reads nor changes its plugins. */
  | { state: 'held'; reason: string };

/** One component's outcome on one tool (capability data, Appendix D). */
export interface Outcome { component: string; result: 'works' | 'limited' | 'ignored' | 'fails' | 'unknown'; text: string; /** The tool prefixes these with the plugin's name (`plugin:skill`); the page shows the real names. */ names?: 'skill' | 'agent' }

export interface NativeRun { tool: HarnessId; command: string; ok: boolean; output: string; changed: { path: string; before: string | null; after: string | null }[] }

export interface ActionReport { tool: HarnessId; outcome: 'installed' | 'uninstalled' | 'skill-off' | 'skill-on' | 'held' | 'failed' | 'not-known'; message: string; runs: NativeRun[]; /** This action changed what the tool has (Undo reverses only these). */ changed?: boolean }

/** A catalog plugin as the page gets it: what the catalog says about it, without its raw entry or repository address. */
export type PluginView = Omit<CatalogPlugin, 'remote' | 'entry'>;

export interface MarketplaceView {
  source: string;
  /** Where it is known from: added in Central Knot, or already added in a tool. */
  origins: ('central-knot' | HarnessId)[];
  name: string;
  kind: 'folder' | 'git';
  fetchedAt?: string;
  /** Why the catalog could not be read just now; a last fetched copy may still show. */
  problem?: string;
  /** Showing the last fetched copy, because the source could not be reached. */
  stale?: boolean;
  plugins: PluginView[];
  states: Record<string, Partial<Record<HarnessId, InstallState>>>;
  owner?: string;
  description?: string;
  /** Its web page, for GitHub sources. */
  page?: string;
  /** Where it comes from, short: "GitHub: owner/repo", "Folder: name", or the source as given. */
  sourceLabel: string;
  /** Why Copilot CLI would refuse this whole marketplace (MKT-06), if it would. */
  copilotRefuses?: string;
}

/**
 * One named part of a plugin (a skill, command or agent): what it says it does, its whole file (SKILL.md or NAME.md) as
 * written, and where it sits in the plugin (`path`, the same in every copy of the plugin).
 */
export interface NamedPart { name: string; description: string; text: string; path: string }
/** What a plugin holds, read from its files (catalogdetail.ts); the row counts come from the same read. */
export interface PluginContents {
  skills: NamedPart[];
  commands: NamedPart[];
  agents: NamedPart[];
  /** Hook events it listens to, such as PreToolUse. */
  hooks: string[];
  /** Each MCP server with what it runs or connects to. */
  mcpServers: { name: string; runs: string }[];
  /** Some server refers to ${CLAUDE_PLUGIN_ROOT}, which only Claude Code fills in. */
  mcpUsesPluginRoot: boolean;
  lspServers: string[];
  /** A top-level bin/ folder (account routes refuse it). */
  bin: boolean;
  /** Its version: its plugin.json's, else its marketplace entry's, as Claude Code reads them. */
  version?: string;
}
/** A plugin's contents and README, read when its page opens; for a plugin kept elsewhere, from its own repository. */
export interface PluginDetail extends PluginContents {
  readme?: string;
  /** Why its files couldn't be read. */
  problem?: string;
  /** Whether the marketplace's own copy of its files was read; when not, its parts come only from the tools' copies. */
  offered: boolean;
  /** Each tool's installed copy, read from where that tool keeps it: its version and its parts with their files. */
  installed?: Partial<Record<HarnessId, InstalledCopy>>;
}
/** What one tool has installed of a plugin, read from that tool's own copy. */
export type InstalledCopy = Pick<PluginContents, 'skills' | 'commands' | 'agents' | 'version'>;

export interface PluginsView {
  home: string;
  tools: HarnessId[];
  /** Tools whose own CLI was found, so their plugin commands can run. */
  clis: Partial<Record<HarnessId, boolean>>;
  canWrite: boolean;
  reason?: string;
  marketplaces: MarketplaceView[];
  /** Tools present only as a desktop app's bundled copy, with no CLI to run plugin commands. */
  desktopOnly?: HarnessId[];
  /** Each found CLI's version, where it could be read (a plugin skill's switch is offered only from a tested build). */
  versions?: Partial<Record<HarnessId, string>>;
}

// ---------- MCP servers ----------
export interface McpView {
  tools: HarnessId[];
  servers: SkillFacts[];
  /** Claude Code entries are written only by Write now with Claude closed, until a background write is proved safe (V-09). */
  claudePending: string[];
  access: WriteAccess;
  gate: SyncGate;
  /** Files that could not be read, so their entries are not offered. */
  problems: string[];
  /** What MCP sync did on its own since the page last read. */
  notices: SyncNotice[];
}

export interface McpResult { stopped?: string; results: DestinationResult[]; writes: number; notices?: SyncNotice[]; /** A deletion is inside its settle window: look again shortly. */ settling?: boolean;
  /** What Write to Claude Code wrote, for its Undo: each entry's hash before (null when it was new) and after. */
  claudeWritten?: ClaudeWrite[] }
export interface ClaudeWrite { name: string; before: string | null; after: string }

// ---------- Instructions ----------

/** One tool's personal instruction file, as the editor shows it (INS-01, INS-02). */
export interface InstructionFile {
  tool: HarnessId;
  path: string;
  exists: boolean;
  text: string;
  /** Of the text opened, so a save writes only over what was seen. '' when there is no file yet. */
  hash: string;
  /** Who reads this file. */
  readers: string;
  notes: string[];
  nextStep: string;
  /** Earlier versions kept before each save, newest first. */
  versions: { id: string; at: string; firstLine: string; lines: number; /** Lines that differ from the file as it is now. */ differs: number }[];
}

export interface InstructionSave { stopped?: string; saved?: boolean }

/** How Central Knot looks: as macOS (or the system) is set, or always light or dark. */
export type Appearance = 'system' | 'light' | 'dark';
/** Why starting at sign-in can't be changed here, or why the system has it off (see signin.ts for each one's words). */
export type SignInReason = 'testing' | 'dev' | 'linux' | 'applications' | 'approval' | 'startupApps';
/** The system's own place for start at sign-in, in its words: the action that opens it, and what the page says around it. */
export interface SignInPlace { open: string; unopened: string; unchanged: string }
/**
 * Whether Central Knot starts at sign-in, as the system has it. `reason`: why it can't be changed here (`available` false) or,
 * where it can, why the system has it off. `place`: where the system keeps it, wherever it can be changed here.
 */
export interface SignIn { on: boolean; available: boolean; reason?: { key: SignInReason; text: string }; place?: SignInPlace }
/** Central Knot's own settings, shown on its Settings page. */
export interface AppPreferences { appearance: Appearance; signIn: SignIn; historyDays: HistoryDays }
/** How many days History keeps changes and deleted items (Settings); the choices are in model.ts. */
export type HistoryDays = 7 | 30 | 90;
/**
 * What a shorter History window did to the History already recorded. The window is saved in every case. `done`: removed from
 * the open home at once. `later`: this build doesn't sync the open home yet, and applies the window there with its next History
 * write. `elsewhere`: the open home is preview-only here, or another Central Knot build syncs it; whichever copy next records a
 * change there removes its older History, by its own window. `no-home`: no home is open. `failed`: tried and couldn't (the log says why).
 */
export type HistoryPrune = 'done' | 'later' | 'elsewhere' | 'no-home' | 'failed';
/** History as main reads it: the events the window covers, and the window, read together so they always agree. */
export interface HistoryList { events: HistoryEvent[]; days: HistoryDays }
/** A saved History window: the settings as saved, and `pruned` when it was shorter; none when nothing was shorter or a newer request overtook it. */
export interface HistoryWindowSaved { settings: AppPreferences; pruned?: HistoryPrune }
/** What Show log file did: selected the log in the file manager, or opened its folder (and whether anything is logged yet). */
export interface ShownLog { selected: boolean; logged: boolean }


/** HistoryEvent.undoneBy for an Undo or Restore that found everything already as it was, so it wrote nothing and made no event. */
export const ALREADY_AS_IT_WAS = 'already-as-it-was';
