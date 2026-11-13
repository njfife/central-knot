import type { LibraryItem, Plan, TakeInAnswer, VersionChange } from './library.ts';
import type { NeutralServer } from './mcp.ts';

export type HomeMode = 'fixture' | 'custom' | 'actual';
export type HarnessId = 'claude-cli' | 'copilot-cli' | 'codex-cli' | 'pi-cli' | 'opencode-cli';
export type ProbeState = 'ok' | 'missing' | 'timeout' | 'failed' | 'malformed' | 'restricted' | 'not-run';

export interface ProbeResult {
  state: ProbeState;
  version?: string;
  detail: string;
}

/** A desktop app found on this computer, its version, and the version of the tool it carries inside when that can be read. */
export interface DesktopApp {
  name: string;
  version?: string;
  /** What the app carries: "Code tab", "Codex", "Copilot runtime". */
  carries: string;
  carriedVersion?: string;
  /** The tool's own binary the app carries, where it is on disk: the plugin route when the tool has no CLI here (PLG-04). */
  binary?: string;
}

/** An app found on this computer that runs the tools or reads their files without being a tool Central Knot manages (T3 Code, VS Code). */
export interface OtherApp { name: string; version?: string; says: string }

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
  /** Why OpenCode's older line would not load it: 1.19.5 silently leaves out a skill with no frontmatter or no name in it (2.2.5 loads it). */
  opencodeProblem?: string;
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
  /** 'Installed' and 'Version unknown' are about the CLI; 'App only': its desktop app, with no CLI found. */
  detection: 'Installed' | 'Config found but app not detected' | 'Not found' | 'Version unknown' | 'App only';
  probe: ProbeResult;
  /** The tool's desktop app, when found (Claude desktop, the GitHub Copilot app, ChatGPT desktop): never counted as the CLI (CD §3). */
  app?: DesktopApp;
  discovery: 'ready' | 'empty' | 'missing' | 'restricted' | 'failed';
  skills: Skill[];
  issues: string[];
}

export interface PlanTarget { harness: HarnessId; directory: string; limits: string[]; note?: string; skipped?: string }

export interface WriteAccess { allowed: boolean; reason: string }

export type SyncGate =
  | { state: 'first-setup' | 'ready' }
  | { state: 'needs-resume'; reason: string }
  | { state: 'stopped'; reason: string; /** Set when another build syncs this home: its identity, its name, and whether it is open now (where that can be told). */ owner?: { build: string; name: string; running?: boolean } };

export interface DestinationResult { item: string; harness?: HarnessId; /** `switched`: disabled or enabled there with the tool's own switch. */ outcome: 'written' | 'kept' | 'held' | 'removed' | 'switched' | 'stayed' | 'failed'; message: string; replaced?: true; caughtUp?: true; chooseAgain?: true; /** A refusal made before anything was changed, the record included: the click did nothing. */ unchanged?: true; /** `switched`: which way. */ disabled?: boolean; /** `held`: its copies differ, so it waits for a choice of copy (not a failure). */ differs?: true; /** `held`: waits for Write to Claude Code (MCP-02), as it should (not a failure). */ waits?: true; }

export interface HomeView { mode: HomeMode; label: string; home: string; snapshots: Snapshot[]; /** The home as a whole: its tools, access, owner and what the background did. */ sync: SyncView; /** Skills: those in Central Knot's library (library.ts) and those found in a tool. */ skills: LibraryView; /** MCP servers: those in Central Knot's library (library.ts) and those found in a tool. */ mcp: LibraryView; /** Agents: those in Central Knot's library (library.ts) and those found in a harness. */ agents: LibraryView; /** The Sync switch (SYN-03): off stops background writes; explicit actions still run. */ syncOn: boolean; /** Plugins' parts in tools without the plugin, so those items can say where they came from. */ parts?: PartsInstall[]; /** The plugins installed whole in this home's tools, with what each brings. */ pluginItems?: InstalledPlugin[]; /** This computer's home only: apps found here that run the tools or read their files (T3 Code, VS Code). */ otherApps?: OtherApp[]; /** Whether this build offers the Practice copy (dev builds and tests only). */ practice: boolean; /** The read this view was built from, to pass back for a request made right after (DesktopApi.plugins). */ readId: number; /** Profiles: named sets of library items to have On (profileplan.ts). */ profiles: ProfilesView }

export interface DesktopApi {
  selectHome(mode: HomeMode): Promise<HomeView | null>;
  refresh(): Promise<HomeView | null>;
  applySkills(changes: Change[], resume: boolean, home: string): Promise<PassResult>;
  /** Clears a tool's own switch that turns a skill off there (skills.ts clearSwitch). */
  clearSkillSwitch(key: string, tool: HarnessId, home: string): Promise<PassResult>;
  /** Makes a copy outside Central Knot's own (a link, a copy in ~/.agents/skills) Central Knot's (skills.ts takeOver). */
  takeOverSkill(key: string, tool: HarnessId, home: string): Promise<PassResult>;
  /** One version of a skill: its SKILL.md and the names of its other files (skills.ts skillVersion). */
  skillVersion(key: string, hash: string): Promise<{ skill: string; files: string[] } | null>;
  history(): Promise<HistoryList>;
  applyServers(changes: Change[], resume: boolean, home: string): Promise<PassResult>;
  /** Write to Claude Code, with Claude closed: what the servers named owe Claude Code's settings file (servers.ts writeToClaude). */
  writeClaude(keys: string[], home: string): Promise<PassResult>;
  /** One version of an MCP server: its shared part (servers.ts serverVersion). */
  serverVersion(key: string, hash: string): Promise<NeutralServer | null>;
  applyAgents(changes: Change[], resume: boolean, home: string): Promise<PassResult>;
  /** The home last opened, else this computer's home (dev builds: the practice copy). */
  startHome(): Promise<HomeView | null>;
  setSync(on: boolean): Promise<HomeView | null>;
  syncNow(home: string): Promise<HomeView | null>;
  /** Turns the open home's standing rule, Synchronize everything, on or off (share.ts setSyncEverything), then reads and syncs the home. */
  setSyncEverything(on: boolean, home: string): Promise<{ stopped?: string; view: HomeView | null }>;
  /** Makes this build the home's sync owner, in place of the build that syncs it now; every managed item and choice stays. */
  takeOverSync(home: string): Promise<{ stopped?: string; from?: string; view: HomeView | null }>;
  onSyncChanged(callback: () => void): void;
  /** Main did something on the person's behalf outside any request (a bundled build added its marketplace to their tools): words for the status bar. */
  onSaid(callback: (text: string) => void): void;
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
  /** Turns automatic plugin updates on or off (pluginupdates.ts). */
  setPluginUpdates(on: boolean): Promise<AppPreferences>;
  /** Automatic plugin updates: the last check, and the note of what was updated and what couldn't be. */
  pluginUpdates(): Promise<PluginUpdatesView>;
  /** Checks the marketplaces now and updates what is behind, failed updates included; answers once it is done. */
  checkPluginUpdates(): Promise<PluginUpdatesView>;
  /** Closes one half of the note of what automatic updates did: what was updated, or what couldn't be. */
  closePluginUpdates(what: 'updated' | 'failed'): Promise<PluginUpdatesView>;
  /** Automatic plugin updates changed (a check began or ended). `news`: it updated something, or else an update failed. */
  onPluginUpdatesChanged(callback: (view: PluginUpdatesView, news?: 'updated' | 'failed') => void): void;
  /** The main process asks for a page (the Settings… menu item). */
  onNavigate(callback: (page: string) => void): void;
  /** Updates (updates.ts): what this build is, whether it can update itself, and the last check or update. */
  updates(): Promise<UpdateView>;
  /** Asks GitHub now for a newer release; answers once the check is done. */
  checkForUpdates(): Promise<UpdateView>;
  /** Downloads the newer release and prepares it; progress and the outcome come through onUpdatesChanged. */
  installUpdate(): Promise<UpdateView>;
  /** Restarts into the prepared update, once no write is under way. */
  restartToUpdate(): Promise<void>;
  /** Main's update state changed (a check, download progress, ready, failed). */
  onUpdatesChanged(callback: (view: UpdateView) => void): void;
  /** `choice`: which overwritten edit to put back, for an event with several. */
  restore(eventId: string, resume: boolean, home: string, choice?: string): Promise<ApplyResult>;
  /** Each tool's own instruction file (INS-01). */
  instructions(readId?: number): Promise<InstructionFile[] | null>;
  /** One version of an agent as Central Knot's library holds it: its name, description and prompt; null when it is no longer kept. */
  agentVersion(key: string, hash: string): Promise<{ name: string; description: string; prompt: string } | null>;
  /** Convert to skill (AGT-02): an agent as a Pi skill. */
  convertAgent(key: string, home: string): Promise<{ stopped?: string; skill?: string; origin?: HarnessId }>;
  /** A skill edit's SKILL.md before and after, for "See change". */
  eventChange(eventId: string): Promise<{ before: string; after: string } | undefined>;
  /** Shows a file in the system file manager (Finder, Explorer); nothing is opened or changed. */
  showFile(path: string): Promise<void>;
  /** A marketplace's own README, from the copy already read. */
  marketplaceReadme(source: string): Promise<string | null>;
  /** One plugin's contents and README; null when its files can't be found, or with `local` when they would have to be fetched first. */
  pluginDetail(source: string, plugin: string, local?: boolean): Promise<PluginDetail | null>;
  /** Opens an https link in the browser. */
  openExternal(url: string): Promise<void>;
  /** `restoring`: an earlier version put back (or a save undone): its base copy is judged again, counting as one Central Knot
   *  wrote only when it matches a base text Central Knot kept; otherwise it stays protected as an edit. */
  saveInstruction(tool: HarnessId, text: string, expected: string, home: string, restoring?: boolean): Promise<InstructionSave>;
  instructionVersion(tool: HarnessId | 'base', id: string): Promise<string | undefined>;
  /** The base instructions and the tools that get them (INS-03). */
  instructionBase(): Promise<BaseView | null>;
  applyBase(request: BaseApply, home: string): Promise<BaseResult>;
  /** Has `tool` write a draft of the base from every tool's own instructions. Nothing is saved: the draft is reviewed first. */
  draftBase(tool: HarnessId, home: string): Promise<BaseDraft>;
  /** Stops the draft being written, if one is. */
  cancelDraft(): Promise<void>;
  undoBase(undo: BaseUndo, home: string): Promise<BaseResult>;
  /** Marketplaces and installs; `fresh` fetches every Git marketplace again, and `readId` (a view's) reuses the read that view was built from, when it is the latest. */
  plugins(fresh?: boolean, readId?: number): Promise<PluginsView | null>;
  /** Adds a marketplace; `source` is how it was stored, so the page can open exactly that one. */
  addMarketplace(source: string): Promise<{ problem?: string; view?: PluginsView; source?: string }>;
  forgetMarketplace(source: string): Promise<PluginsView | null>;
  /** Stops offering a suggested marketplace; `again`: offers it again (the Undo of that). */
  declineMarketplace(source: string, again?: boolean): Promise<PluginsView | null>;
  /** Adds the marketplace this build carries to one tool's own plugin list, with that tool's own command. Installs nothing. */
  addCarriedTo(tool: HarnessId, home: string): Promise<{ stopped?: string; report?: ListedReport; view?: PluginsView }>;
  /** Looks now at a bundled build's feed for newer plugins, and takes them if there are any. The Plugins view is read again afterwards. */
  checkCarriedFeed(): Promise<void>;
  pickMarketplaceFolder(): Promise<string | null>;
  installPlugin(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstallPlugin(source: string, marketName: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
  updatePlugin(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  /** The git repo the Managed set lives in, if any. `check` asks the repo for its latest commit first. */
  repo(check?: boolean): Promise<RepoView | null>;
  connectRepo(url: string, branch: string, home: string): Promise<RepoResult>;
  pullRepo(home: string): Promise<RepoResult>;
  pushRepo(home: string): Promise<RepoResult>;
  disconnectRepo(home: string): Promise<RepoResult>;
  /** Adds or changes a profile's name and items (Central Knot's own file; no tool is written). */
  saveProfile(profile: ProfileEdit, home: string): Promise<{ problem?: string; id?: string; profiles?: ProfilesView }>;
  deleteProfile(id: string, home: string): Promise<{ problem?: string; profiles?: ProfilesView }>;
  /** Switches to a profile: what it names On, every other library item Off. One History entry, with Undo. */
  switchProfile(id: string, home: string): Promise<ProfileSwitchResult>;
  /** A switch made from the menu bar: what it did, so the page can show it with Undo. */
  onProfileSwitched(callback: (result: ProfileSwitchResult) => void): void;
  /** Turns one skill of an installed plugin off (`on` false) or back on in one tool, with that tool's own switch (ENB-06). */
  setPluginSkill(source: string, marketName: string, plugin: string, skill: string, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
  /** Turns one MCP server or agent of an installed plugin off (`on` false) or back on in one tool, with that tool's own switch (partswitch.ts). */
  setPluginPart(source: string, marketName: string, plugin: string, part: PartRef, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
  /** Turns a whole installed plugin off (`on` false) or back on in one tool, with that tool's own switch. */
  setPluginOn(source: string, marketName: string, plugin: string, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
  /** What each tool without the plugin would get as its parts, and why each other part wouldn't go in. */
  partsPlan(source: string, plugin: string): Promise<Partial<Record<HarnessId, PartPlan[]>> | null>;
  /** Installs (or updates), removes or undoes a plugin's parts in one tool; `run` names the parts run an Undo reverses; `pick` installs or takes out only the parts it names. */
  pluginParts(source: string, marketName: string, plugin: string, tool: HarnessId, mode: 'install' | 'remove' | 'undo', run: string | undefined, home: string, pick?: PartsPick): Promise<PluginActionResult>;
  /** One skill's or agent's file as each tool's installed copy of a plugin has it, read when its row is opened. */
  pluginItemTexts(plugin: string, marketName: string, kind: PartKind, name: string): Promise<{ tool: HarnessId; text: string }[]>;
}

export interface PluginActionResult { stopped?: string; reports: ActionReport[] }

// ---------- Managing skills across tools ----------


export interface ToolCopy {
  hash: string;
  directory: string;
  rootLabel: string;
  lines: number;
  modified: string;
  /**
   * What a copy question quotes to tell differing copies apart (copywords.ts shortQuote shortens it): a skill's first body
   * line, whole; an agent's description; an MCP entry's "Command · …" or "HTTP · …".
   */
  summary: string;
  /**
   * A library kind: the part of a copy the copy question compares and shows side by side, under the kind's word for it
   * (libraryrow.ts RowWords body: an agent's prompt).
   */
  body?: string;
  /** Whether Central Knot may write over this copy (an MCP entry's file). */
  writable: boolean;
  /** Folder name as found, with its case. */
  folder: string;
  /** Skills: the name this tool reads for this copy (its frontmatter name), which Copilot's switch goes by. */
  name?: string;
  /** A library kind: the names in this harness's own part of its copy (an agent's settings in its file: tools, model, …), which never leave it. */
  ownPart?: string[];
}

/** What is true now for one skill, across every tool. The page derives its marks from this. */
/** The plugin a tool has an item through: its name, the marketplace as that tool added it, and the installed copy's version. `off`: turned off there. */
export interface ThroughPlugin { plugin: string; marketplace: string; source?: string; version?: string; off?: true; /** The item's own name in the plugin (a skill's SKILL.md name), which the tool's switch goes by. */ name?: string }

export interface SkillFacts {
  /** Made by Convert to skill from an agent (AGT-02): which agent, from which tool, and what an agent had that a skill does not. */
  converted?: { agent: string; origin: HarnessId; losses: string[] };
  key: string;
  name: string;
  description: string;
  copies: Partial<Record<HarnessId, ToolCopy>>;
  managed: boolean;
  off: HarnessId[];
  /** Why a tool that lacks the skill could not load a copy. */
  cannot: Partial<Record<HarnessId, string>>;
  /**
   * Tools with no copy of their own that have the skill through a plugin installed there. Each is in `cannot` too, in
   * words: no separate copy is placed beside a plugin's.
   */
  plugin?: Partial<Record<HarnessId, ThroughPlugin>>;
  /** Tools whose copy of this managed skill was edited since the last sync and has not spread yet. */
  edited?: HarnessId[];
  /**
   * For each tool's copy, what stops every tool from using it: a differing copy Central Knot does not change, or a tool that
   * cannot load it. Each has the tool it concerns, so a tool turned off no longer counts, and `reason`: the cause alone, a
   * sentence naming that tool as the page does (copywords.ts cantUse makes it a row's or a result's sentence).
   */
  choiceBlocks: Partial<Record<HarnessId, { tool: HarnessId; reason: string }[]>>;
  /** A library kind's row (LibraryFacts, as itemrow.ts kindSource gives the page): its `unseen`, `plan`, `takeInAnswers` and `versionChanges`. */
  unseen?: LibraryFacts['unseen'];
  plan?: LibraryFacts['plan'];
  takeInAnswers?: LibraryFacts['takeInAnswers'];
  versionChanges?: LibraryFacts['versionChanges'];
  /** MCP servers: tools whose write or removal waits for Write to Claude Code (types.ts LibraryFacts waits). */
  waits?: HarnessId[];
  /** Skills and MCP servers: why a tool's switch can't be used at all: its settings file can't be read or is in a form Central Knot doesn't edit. */
  switchProblem?: Partial<Record<HarnessId, SwitchProblem>>;
  /** A library kind's row (LibraryFacts, as itemrow.ts kindSource gives the page): how a tool has it another way, and which copies Take over can make Central Knot's. */
  anotherWay?: LibraryFacts['anotherWay'];
  takeOver?: LibraryFacts['takeOver'];
  /** Skills: a tool whose own switch turns it off there, said as its mark says it ("switched off in Codex’s own settings"); itemrow.ts kindSource words it. */
  switched?: Partial<Record<HarnessId, string>>;
}

/** Why a tool's skill switch can't be used: its settings file, and what is wrong with it ("isn’t valid JSON."). */
export interface SwitchProblem { file: string; reason: string }

/** One tool's copy of a skill, as its switch names it: Claude Code by folder, Copilot by name, Codex and Pi by SKILL.md path. */
export interface SwitchTarget { folder: string; name: string; /** Absolute path to the copy's SKILL.md (where it is, or where it will be written). */ skillFile: string }

/**
 * One switch a 'switched' History event changed: which way, and for a skill the entry it named and a Claude Code override it
 * replaced ("name-only"). An MCP server's switch goes by the server's name (the event's item), so it has no `target`.
 */
export interface SwitchRecord { tool: HarnessId; disabled: boolean; target?: SwitchTarget; before?: string }

/**
 * What is true of the open home as a whole, which every page reads: the tools Central Knot manages, where each keeps its
 * skills, whether Central Knot may write here and who syncs it, and what the background passes did since the page last read.
 */
export interface SyncView {
  tools: HarnessId[];
  /** Where each tool's skills folder is, which other apps read it too, and why Central Knot does not write there, if it does not. */
  writes: Partial<Record<HarnessId, { to: string; alsoReadBy: string[]; blocked?: string }>>;
  access: WriteAccess;
  gate: SyncGate;
  /** What the background passes did since the page last read: copies written or removed, and what failed. */
  caughtUp: DestinationResult[];
  /** The home's standing rule, Synchronize everything, is on (share.ts SyncRecord syncEverything): found items are taken in by themselves. */
  syncEverything: boolean;
}

/**
 * One click on an item, as the page sends it to any kind's engine. `managed` and `off` always say how it should be managed
 * afterwards: a caller changing only switches or removals passes the skill's current ones (from its SkillFacts), with
 * `seenManaged`, or it changes those too. A library kind's pass reads it as its own click (librarypass.ts ItemClick, made by
 * itemClick: `managed` is On, `off` the harnesses it is kept out of). A field added here reaches an engine only once main.ts's
 * `changes` sanitizer copies it.
 */
export interface Change {
  key: string;
  managed: boolean;
  off: HarnessId[];
  /** A found item whose copies differ: the tool whose copy every tool should use. */
  use?: HarnessId;
  /** The content ID of the chosen copy as the person saw it. A copy changed since is not used. */
  useHash?: string;
  /** Whether the page showed it managed: a change made from an older read is refused if that no longer holds. */
  seenManaged?: boolean;
  /** A library item: the version to make current (its hash), in every harness the item is on in. */
  version?: string;
  /** A library item: true deletes it from Central Knot (out of every harness; History can restore it); false restores a deleted one. */
  deleted?: boolean;
  /**
   * A library item, sent by an Undo (History's entry `tookFrom`): each harness whose own copy the undone click took over, and
   * that copy's content (a version). Where the item no longer goes there after this click, that copy is given back as the
   * harness's own instead of being removed.
   */
  giveBack?: Partial<Record<HarnessId, string>>;
}

export interface ApplyResult { stopped?: string; /** An Undo refused before it wrote anything: why, without "so nothing was undone", for a band that also says what else was undone. */ refused?: string; results: DestinationResult[]; harnessWrites: number; /** The History events the asked changes made (copies added, switches flipped, copies removed, a copy chosen, copies taken over), for their one Undo; never what sync did alongside. */ made?: string[]; /** An Undo of a profile switch (profiles.ts undoSwitch): as types.ts ProfileSwitchResult says them, what it turned On and Off, what is not as it asked, and the MCP servers that wait for Write to Claude Code. */ switched?: Pick<ProfileSwitchResult, 'on' | 'off' | 'left' | 'waits'>; /** Automatic resolutions to tell the person about (CON-02). */ notices?: SyncNotice[]; /** A copy went missing and is inside its settle window: look again shortly. */ settling?: boolean }

/**
 * What sync did on its own, told once on its kind's page: to one item (ItemNotice), or the found items Synchronize everything
 * took in, in one pass (TakenInNotice). Both are keyed by `history`.
 */
export type SyncNotice = ItemNotice | TakenInNotice;

/** What sync did to one item on its own: an edit spread, competing edits resolved, or a copy deleted by hand that turned it off. */
export interface ItemNotice {
  key: string;
  item: string;
  kind: 'edit' | 'conflict' | 'deleted' | 'kept-edit';
  /** The tool whose edit or deletion won. */
  winner: HarnessId;
  /** Tools whose differing copies gave way, or still hold the item after a deletion lost. */
  losers: HarnessId[];
  /** False when the order could not be proved and the fixed tool order decided (CON-04, D-04). */
  orderProved: boolean;
  /** The History event to Undo or Restore from. */
  history: string;
}

/**
 * What Synchronize everything took into Central Knot in one pass of one kind (librarypass.ts takeInByRule): the items, by name,
 * and the tools they were found in. Each has its own History entry, with an Add's Undo; `history` is the first, which keys the notice.
 */
export interface TakenInNotice { kind: 'taken-in'; items: string[]; from: HarnessId[]; history: string }

/** One entry in History: what changed, which content won, and what is kept to Undo or Restore it. */
/**
 * A skill's take-over from before the library (Replace with managed copies), as its History entry recorded it: links replaced
 * by real copies, shared copies removed, copies made for tools that read the shared one. Only read to tell such an entry
 * apart (historyactions.ts librarySentence): it shows as past, with no action.
 */
export interface TookOver {
  /** Each link and its text. `placed`: the content put in its place (none: a link left leading nowhere, removed). */
  links: { tool: HarnessId; path: string; linkTo: string; hash: string; placed?: string }[];
  shared: { path: string; hash: string; linkTo?: string }[];
  placed: { tool: HarnessId; path: string; hash: string }[];
  /** The same click started syncing the skill: Undo also undoes that. */
  managedNow?: boolean;
  /** The 'added' event the same click made for this skill's new copies: one Undo undoes both. */
  addedId?: string;
}

export interface HistoryEvent {
  id: string;
  at: string;
  key: string;
  item: string;
  /** 'profile': a profile switch, or the profiles migration (key 'profiles:switch', item the profile's name: `profile`).
   * 'switched': a skill's tool switch cleared, or its Undo (`switched`).
   * 'took-over': a skill's copy outside Central Knot taken over (`losers`: that copy), which has no Undo.
   * From before an item was on the library, read only for their sentences (historypage.ts describe): 'added' (copies a change
   * wrote, `rejoined` where it synced to more tools), 'removed', 'written' (Write to Claude Code over an entry History didn't
   * hold), 'restored', and 'took-over' with `tookOver`.
   * Library items (historyactions.ts has each one's action):
   * 'on' / 'off': it was turned On or Off (`cause` says why), in every harness or (`only`) in one; `losers` are the harnesses
   *   written or removed.
   * 'current': an earlier version (`version`) was made current; `previous` is the one before.
   * 'edit' / 'conflict': an edit taken in (`winner`), or Pull's (`cause`); `losers` are the harnesses written, each with what it
   *   held before, and on a 'conflict' the edits that gave way. 'kept-edit': edits not taken in that were written over (`losers`),
   *   or (`cause: 'tool-back'`) a copy a tool managed again held, which gave way to the current version.
   * 'deleted': it was deleted from Central Knot. 'chosen': it was taken in with the `winner`'s copy, where the found copies differed. */
  kind: 'edit' | 'conflict' | 'deleted' | 'kept-edit' | 'restored' | 'chosen' | 'added' | 'switched' | 'removed' | 'profile' | 'took-over' | 'written' | 'on' | 'off' | 'current';
  /** 'on' / 'off': the one harness it was turned on or off in. */
  only?: HarnessId;
  /**
   * A library item's: what made it happen, read by historyactions.ts alone. `switch`: the person's switch ('on' / 'off'). `found`:
   * a found item taken in by a click on Add ('on'; `winner`: where it was found). `sync-everything`: the same, taken in by the
   * home's standing rule, Synchronize everything, with no click. `pulled`: Pull did it ('on' for an item new here, 'edit',
   * 'deleted'). `deleted-by-hand`: its copy was deleted by hand ('off'; `winner`: where). `tool-back`: a tool managed again held a
   * copy the item didn't have ('kept-edit'; `losers`: that copy), which gave way to the current version (library.ts managedAgain).
   */
  cause?: 'switch' | 'found' | 'sync-everything' | 'pulled' | 'deleted-by-hand' | 'tool-back';
  /**
   * The version current once this entry's change was made: 'current', the version made current; an 'edit' Pull made, the
   * version pulled; 'on' / 'off' by a switch, the version it was at (historyactions.ts asTheClickLeftIt).
   */
  version?: string;
  /** 'took-over' from before the library: what was replaced, removed and placed (read only to tell such an entry apart). */
  tookOver?: TookOver;
  /**
   * 'profile': a profile switch (`toName`: the profile, by its name then), or the profiles migration's one entry (`migrated`,
   * `toName` the profile last switched to before it, written when it turns something Off): the library items it turned On and Off. Its Undo turns back each item still as it left it (profileplan.ts undoPlan). An entry from before profiles
   * were sets of items has neither `on` nor `off`: it is past.
   */
  profile?: { toName?: string; on?: SwitchedItem[]; off?: SwitchedItem[]; migrated?: true };
  /** 'switched': each tool and whether it was disabled there (true) or enabled (false); `before`, a Claude Code override it replaced ("name-only"), for Undo. */
  switched?: SwitchRecord[];
  /** 'added', from before the library: copies for tools a synced item synced to again. */
  rejoined?: boolean;
  winner?: { tool: HarnessId; hash: string };
  /** Content that gave way, kept in Central Knot's store. */
  losers: { tool: HarnessId; hash: string;
    /** 'took-over': the copy taken over was outside the tool's own folder (in ~/.agents/skills), at this path. */ path?: string;
    /** 'took-over': the copy was a link with this text. */ linkTo?: string }[];
  /**
   * A library item's click: each harness whose own copy (one Central Knot had not put there) the click took over, by writing
   * over it or by counting it as the item's because it was the same, with that copy's content. Its Undo gives each back.
   */
  tookFrom?: { tool: HarnessId; hash: string }[];
  /** A library item's Undo: the harnesses whose own copy it gave back instead of removing it (the undone entry's `tookFrom`). */
  gaveBack?: HarnessId[];
  /** The synced content before this event, to put back on Undo. */
  previous?: string;
  orderProved: boolean;
  /** Set once undone or restored, naming the event that did it (one from before the library may name none: 'already-as-it-was'). */
  undoneBy?: string;
  /** Made by Pull from the git repo. */
  via?: 'repo';
  /**
   * A change to only an agent's Claude Code settings (by Pull, or by undoing one): that tool's file, the file it replaced (kept whole,
   * what Undo puts back), and a hash of what it wrote (Undo goes ahead only while the file still holds that).
   */
  settingsFile?: { path: string; kept: string; wrote: string };
  /** 'edit' or 'deleted' by Pull, of the base instructions (key 'instructions:base'): what the base's own Undo puts back, the base and its tools. */
  base?: BaseUndo;
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
  /** No longer in the catalog, listed only because its parts are still in a tool, so they can be removed together. */
  gone?: boolean;
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
  /** Why only Codex can take this marketplace's plugins (it is in Codex's own format), if so. */
  codexOnly?: string;
}

/**
 * One of an installed plugin's skills that a tool has turned off (ENB-06), by its name (SKILL.md's, or its folder's).
 * `held`: why it can't be turned back on from here: the switch holding it off isn't this plugin's own.
 */
export interface SkillOff { skill: string; held?: string }

export type InstallState = { state: 'installed'; path: string; live?: boolean;
  /**
   * Claude Code has this plugin from the Anthropic Directory, not from this marketplace: the same plugin (the same
   * repository and folder), under this id there. It is installed for the person, and Claude Code keeps it.
   */
  directory?: string;
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

export interface ActionReport { tool: HarnessId; outcome: 'installed' | 'uninstalled' | 'updated' | 'skill-off' | 'skill-on' | 'part-off' | 'part-on' | 'plugin-off' | 'plugin-on' | 'held' | 'failed' | 'not-known'; message: string; runs: NativeRun[]; /** This action changed what the tool has (Undo reverses only these). */ changed?: boolean;
  /** An update: the version the tool records now. */ version?: string;
  /** An update of a copy that differed at the same version: done by the tool's own update, or by uninstalling and installing again. */ byContent?: 'update' | 'reinstall';
  /** A failed update with nobody watching: the tool's own update kept its copy, and only a reinstall (never made unasked) would change that. */ kept?: true;
  /** Parts already there were brought up to date, not installed new. */ partsUpdated?: boolean; /** The parts run to undo, when it changed something. */ partsRun?: string;
  /** Parts left alone this run, each saying why (edited since, a same-named item already there): shown to be read. */ notes?: string[];
  /** Skills this run wrote in place of a link that led nowhere, by name. */ replacedLinks?: string[] }

// ---------- A plugin's parts in a tool without plugins (parts.ts) ----------
export type PartKind = 'skill' | 'mcp' | 'agent';
/** One part put in a tool: a skill folder, an MCP entry or an agent file, by name, with the hash it had when it went in. */
export interface PartItem { kind: PartKind; name: string; hash: string; /** What it was on disk once written (for an MCP entry, with the tool's own settings), to tell a later edit. */ seen?: string;
  /** Out by the person's choice (turned off, or removed from the tool by hand): updates leave it out while the plugin still has it. */ removed?: true }
/** A plugin's parts in one tool: from which plugin and version, when, and which items. `digest` identifies the parts' content then. */
export interface PartsInstall { source: string; marketName: string; plugin: string; version?: string; tool: HarnessId; at: string; digest: string; items: PartItem[] }
/** One part of a plugin for one tool: it can go in (with a limit, maybe), or `why` not. `out`: the person turned it off or removed it there, so it stays out until chosen. */
export interface PartPlan { kind: PartKind; name: string; why?: string; /** `why` holds for every part of this kind in this tool (Pi has no agents). */ wholeKind?: true; limit?: string; out?: true; /** It is in and can stay, but can't be taken out or rewritten there now, and why. */ fixed?: string }
/** A part by kind and name. */
export type PartRef = Pick<PartItem, 'kind' | 'name'>;
/**
 * Single parts chosen for one tool: those to put in and those to take out and leave out. `rest`: the tool's other parts
 * are installed or brought up to date in the same run (an install or update of all its parts, with these exceptions).
 */
export interface PartsPick { on: PartRef[]; off: PartRef[]; rest?: boolean }
/** A plugin's parts in one tool, as the Plugins page shows them. `changed`: the plugin's parts differ now from what went in. */
export interface PartsState { version?: string; at: string; items: Pick<PartItem, 'kind' | 'name'>[]; changed?: boolean; /** The catalog's version now, when it differs. */ now?: string }

// ---------- What a plugin installed whole brings (pluginitems.ts) ----------
/** One skill, MCP server or agent inside a tool's installed copy of a plugin, by its real name (the tool calls it `plugin:name`). */
export interface PluginItem { kind: PartKind; name: string; description: string; /** MCP servers: what it runs or connects to. */ runs?: string }
/** A plugin installed whole in one tool, read from that tool's own records and its copy of the plugin. */
export interface InstalledPlugin { tool: HarnessId; plugin: string; marketName: string; version?: string;
  /** The whole plugin is turned off in that tool. */ off?: boolean;
  /** Its skills that tool has turned off one by one (Copilot CLI's and Codex's switch). */ skillsOff?: string[];
  /** Its MCP servers and agents that tool has turned off one by one (partswitch.ts). */ serversOff?: string[]; agentsOff?: string[];
  /** Why none of its skills can be switched here (Codex's skill rules in a form not edited), if so. */ switchesHeld?: string;
  /** Skills held off by a switch that isn't this plugin's own, each with why it can't be turned on here. */ skillsHeld?: Record<string, string>;
  /** MCP servers whose switch can't be written here, each with why. */ serversHeld?: Record<string, string>;
  /** Loaded live from a folder marketplace, nothing copied (Copilot CLI): turned off, such a plugin is no longer installed. */ live?: boolean;
  items: PluginItem[];
  /** Why what it brings couldn't be read; then `items` is empty. */ problem?: string;
  /** Its marketplace is on the Plugins page (it is added in a tool), so the plugin's page can be opened there. */ listed: boolean;
  /** Where that tool has its marketplace from, as it records it. */ source?: string }

/** A catalog plugin as the page gets it: what the catalog says about it, without its raw entry or repository address. */
export type PluginView = Omit<CatalogPlugin, 'remote' | 'entry'>;

/** What adding a marketplace to one tool's own list came to: already `there`, `added`, `held` (left alone, with why) or `failed`. */
export interface ListedReport { tool: HarnessId; outcome: 'there' | 'added' | 'held' | 'failed'; message: string }

/**
 * The marketplace a bundled build carries, as the page shows it: the app's name, the name and picture the build gave the
 * marketplace, its release ("November 10, 2026", made from "GitHub: acme/plugins at 1a2b3c4d5e"), and each plugin the
 * marketplace lists whose files the build doesn't carry, with why.
 */
export interface BundledView { app: string; displayName?: string; logo?: string; /** Its release's date and time, in words. */ release: string; /** What the release was made from, for whoever needs to tell releases apart. */ from?: string; unpackaged: { name: string; reason: string }[]; /** The tools of the open home this build added the marketplace to (by itself or when asked), as its own record has it. */ addedTo?: HarnessId[];
  /** Plugins the marketplace no longer offers that stay because a tool here has them installed. */ kept?: string[];
  /** Set when the build has a feed of newer plugins: when it was last looked at, and what that came to, in words (bundlefeed.ts). */ feed?: { checked?: string; outcome?: 'current' | 'updated' | 'held' | 'failed'; message?: string } }

export interface MarketplaceView {
  source: string;
  /** Where it is known from: added in Central Knot, carried by this build (a bundled build), or already added in a tool. */
  origins: ('central-knot' | 'bundle' | HarnessId)[];
  /** Set for the marketplace this build carries. */
  bundled?: BundledView;
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
  /** Why only Codex can take this marketplace's plugins (it is in Codex's own format), if so. */
  codexOnly?: string;
  /** Plugins whose parts are in tools that can't take the plugin itself, by plugin and tool. */
  parts?: Record<string, Partial<Record<HarnessId, PartsState>>>;
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
  /** Tools whose plugin commands can run: through their own CLI, or with none, through the copy their desktop app carries (`via`). */
  clis: Partial<Record<HarnessId, boolean>>;
  /** Tools with no CLI whose plugin commands run through their desktop app's own copy, each with what that copy is: "Claude desktop’s Code tab 2.1.321". */
  via?: Partial<Record<HarnessId, string>>;
  canWrite: boolean;
  reason?: string;
  marketplaces: MarketplaceView[];
  /** Tools present here only as their desktop app, with no CLI and no copy of the tool in the app to run plugin commands: each with the app's name. */
  desktopOnly?: Partial<Record<HarnessId, string>>;
  /** Each found CLI's version, where it could be read (a plugin skill's switch is offered only from a tested build). */
  versions?: Partial<Record<HarnessId, string>>;
  /** Marketplaces offered without being looked for (suggested.ts): each with the tools here it is the default of. One click adds one; nothing is fetched before. */
  suggested?: { source: string; name: string; tools: HarnessId[] }[];
}

// ---------- A kind on Central Knot's library (library.ts): its page's view ----------

/**
 * A library kind's page (agents.ts agentsView): every item in the library and every one found in a managed harness, read
 * the way a pass reads them, so each mark says what the next pass will do. The page reads it through itemrow.ts kindSource.
 */
export interface LibraryView {
  /** The managed harnesses that can hold this kind. */
  tools: HarnessId[];
  /** One row per item: in the library (On or Off), or found in a harness. */
  items: LibraryFacts[];
  /** Every item in the library by key, deleted ones too, as the library holds it. */
  library: Record<string, LibraryItem>;
  access: WriteAccess;
  gate: SyncGate;
  /** What could not be read, so it is not offered. */
  problems: string[];
  /** What a pass did on its own since the page last read. */
  notices: SyncNotice[];
}

/** One row of a library kind's page: what each managed harness holds of the item and, for one in the library, what the next pass does. */
export interface LibraryFacts {
  key: string;
  name: string;
  description: string;
  /** Each managed harness's copy. */
  copies: Partial<Record<HarnessId, ToolCopy>>;
  /** On (library.ts LibraryItem `on`); false for an item that is Off and for one only found. */
  on: boolean;
  /** The harnesses it is kept out of. */
  except: HarnessId[];
  /** Why a harness it should be in can't be given a copy (a held copy, or one its plan would write but can't). */
  cannot: Partial<Record<HarnessId, string>>;
  /** Harnesses with no copy of their own that have it through a plugin installed there. */
  plugin?: Partial<Record<HarnessId, ThroughPlugin>>;
  /** Harnesses whose copy can't be seen for sure right now, and why. Nothing changes there until it can. */
  unseen?: Partial<Record<HarnessId, string>>;
  /** Harnesses whose copy holds an edit the next pass takes in, or that gives way to that edit. */
  edited: HarnessId[];
  /** In the library: what the next pass does in each harness (library.ts plan, from librarypass.ts copiesOf), which the marks say. */
  plan?: Plan;
  /** In the library: for each version as library.ts listed orders them, what it changed. */
  versionChanges?: VersionChange[];
  /**
   * Found, not in the library: what a click on its Add does, and what Synchronize everything does with it (library.ts
   * takeInAnswer, each kind's view through librarypass.ts takeInAnswers).
   */
  takeInAnswers?: { click: TakeInAnswer; rule: TakeInAnswer };
  /**
   * Skills: how a tool has it another way (a link, a folder Central Knot doesn't own, another tool's folder it reads, a plugin),
   * as its line says it, On or Off (skills.ts anotherWay). Nothing of Central Knot's goes there while it does.
   */
  anotherWay?: Partial<Record<HarnessId, string>>;
  /**
   * Skills, found with copies that differ: what stops one tool's copy being the one every tool takes (the copy question): a
   * tool holding another copy that wouldn't load this one, with why (copywords.ts cantUse leads it in).
   */
  choiceBlocks?: Partial<Record<HarnessId, { tool: HarnessId; reason: string }[]>>;
  /** Skills: a copy outside Central Knot's own that Take over can make Central Knot's, by tool: a link in its folder, or a copy in ~/.agents/skills. */
  takeOver?: Partial<Record<HarnessId, { kind: 'link' | 'shared'; path: string }>>;
  /**
   * Skills: the copy each tool loads (its own, or one it has another way; not a plugin's), as its own switch names it, and
   * whether that switch turns it off there (`off`): the copy stays, and the tool doesn't load it. Read at each look.
   */
  loads?: Partial<Record<HarnessId, SwitchTarget & { off: boolean }>>;
  /** Skills and MCP servers: why a tool's own switch can't be read (its settings file), for the tools that have a copy. */
  switchProblem?: Partial<Record<HarnessId, SwitchProblem>>;
  /** MCP servers: tools whose own switch turns it off there (mcpswitch.ts), read at each look: the entry stays, and the tool doesn't start it. */
  switchedOff?: HarnessId[];
  /**
   * MCP servers: tools where the next pass's write or removal waits for Write to Claude Code (librarypass.ts Disk.locked
   * `waits`); a server deleted from Central Knot whose entry there is still to go is one too (its row is a found one).
   */
  waits?: HarnessId[];
  /** Skills: made by Convert to skill from an agent: which, from which tool's, and what an agent had that a skill doesn't. */
  converted?: { agent: string; origin: HarnessId; losses: string[] };
}

/**
 * What one pass did (librarypass.ts runPass, restore). `made`: the History entries the
 * asked changes made, for their one Undo (ApplyResult.made). `outcome: 'held'` on a result is an action not done this time
 * (DestinationResult), not a held copy.
 */
export interface PassResult {
  stopped?: string; results: DestinationResult[]; writes: number; made?: string[]; notices?: SyncNotice[];
  /** A deletion is inside its settle window: look again shortly. */
  settling?: boolean;
  /** A pass of the whole home (librarypass.ts PassOptions background): the found keys it left found; main.ts tells an open page when one is new (foundGained). */
  found?: string[];
}

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
  versions: InstructionVersion[];
  /** Other tools reading this same physical file (linked dotfiles): one destination for the base. */
  sameFile: HarnessId[];
  /** Set when this tool gets the base instructions (`chosen`) or its file holds a base block: its own text, its copy of the base,
   *  and how that copy compares (see BaseHeld.state). */
  base?: BaseHeld;
}
/** How a tool's file holds the base. */
export interface BaseHeld {
  /** The tool is on the base list and the base isn't blank (a blank base reaches no tool). */
  chosen: boolean;
  /** Its copy: the same as the base, the older base Central Knot last wrote there, edited in the file (anything else), or none. */
  state: 'same' | 'older' | 'edited' | 'missing';
  own: string;
  copy?: string;
  /** Its whole text is exactly the base text Central Knot left as plain text when the tool was taken off the list. Adding the
   *  tool again moves that text back into the block instead of repeating it. */
  leftPlain?: boolean;
}
export interface InstructionVersion { id: string; at: string; firstLine: string; lines: number; /** Lines that differ from the text as it is now. */ differs: number }

/** A tool file save: stopped (why), or saved; `problem`: something after the write could not be finished, said with the result. */
export interface InstructionSave { stopped?: string; saved?: boolean; problem?: string }

/** The base instructions: one text Central Knot keeps in every chosen tool's file, after that tool's own text. */
export interface BaseView { path: string; text: string; hash: string; tools: HarnessId[]; versions: InstructionVersion[];
  /** The tools on this computer that can write a draft of the base (INS-06): each has a CLI, or a desktop app carrying one. */
  drafters: HarnessId[] }
/** Set the base and its tools. `expected`: the base's hash when opened. `adopt`: the tool whose own text became the base.
 *  `overwrite`: tools whose edited copy is replaced by the base. `own`: for a draft a tool wrote, each chosen tool's own text
 *  as the draft sorted it, which replaces that tool's own text. */
export interface BaseApply { text: string; expected: string; tools: HarnessId[];
  /** The files the review showed, by tool: the path and the hash it held then ('' for no file). Only these are written. */
  seen: Partial<Record<HarnessId, { path: string; hash: string }>>;
  adopt?: HarnessId; overwrite?: HarnessId[]; own?: Partial<Record<HarnessId, string>> }
/**
 * A draft of the base written by one of the person's tools (INS-06): `stopped` says why there is none, `cancelled` that the
 * person stopped it. The draft: who wrote it, the base, each sorted tool's own text (a tool's file that had none is not
 * listed), and the hash of each file and of the base it was written from, so a review can tell what changed since.
 */
export interface BaseDraft { stopped?: string; cancelled?: true;
  draft?: { by: HarnessId; base: string; own: Partial<Record<HarnessId, string>>; read: Partial<Record<HarnessId, string>>; baseHash: string } }
/** What an apply or undo did per tool. */
export interface BaseResult { stopped?: string; /** Stopped because the base or a file changed since the review. */ changed?: boolean;
  written: BaseWritten[];
  /** Not written: its copy was edited there (for an undo: the file changed since), or the write failed. */
  left: { tool: HarnessId; why: 'edited' | 'failed' }[];
  /** Something after the files were written could not be finished, said with the result. */ problem?: string;
  undo?: BaseUndo }
/** One file written: where, the text before (null: the write created it) and the hash of the text after. */
export interface BaseWritten { tool: HarnessId; path: string; before: string | null; afterHash: string }
/**
 * What Central Knot keeps beside base.md: which tools get the base; for each, the hash of the base copy it last wrote into that
 * tool's file (a copy matching it but not the base is just older; anything else was edited there); and, for each tool taken off
 * the list whose file then held nothing but the base, the hash of the plain text left there (only that exact text moves back
 * into the block when the tool is added again).
 */
export interface BaseList { tools: HarnessId[]; written: Partial<Record<HarnessId, string>>; leftPlain: Partial<Record<HarnessId, string>> }
/** Everything an apply changed, to put back: the base and its tools, and each file it wrote, by path. */
export interface BaseUndo { text: string; list: BaseList;
  /** The base's hash right after the apply: Undo runs only while it still holds that. */ baseHash: string; files: BaseWritten[] }

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
/** Central Knot's own settings, shown on its Settings page. `pluginUpdates`: plugins are updated automatically (pluginupdates.ts). */
export interface AppPreferences { appearance: Appearance; signIn: SignIn; historyDays: HistoryDays; pluginUpdates: boolean; /** A custom build's own lines about itself (bundle.ts aboutBuild); none for the standard app. */ build?: string[] }
/** One line of what automatic plugin updates did: when, which plugin of which marketplace, and the words. `warn`: it needs reading (a part was left alone). */
export interface PluginUpdateLine { at: number; source: string; plugin: string; text: string; warn?: true; /** A failed update that is tried again by itself. */ again?: true }
/**
 * Automatic plugin updates as the main process has them, for the open home. `on`: the switch in Settings; `paused`:
 * Automatic sync is off, so nothing is updated by itself whatever the switch says. `checking`: a check is under way.
 * `checked`: the last check: when, how many updates it made, how many are failing now, the
 * marketplaces it couldn't read (`offline`: every Git one, so it is tried again sooner), and why it did nothing (`stopped`;
 * `partway`: it stopped during its updates, so the rest are tried again sooner). `failed` counts the failures the note still shows.
 * The note: `updated`, what was updated since the note was last closed, oldest first, and `failed`, the updates that couldn't
 * be made (`again`: tried again by itself). `first`: no note has been closed in this home yet, so the note says once that
 * plugins update by themselves now.
 */
export interface PluginUpdatesView {
  on: boolean; paused: boolean; checking: boolean;
  checked?: { at: number; updated: number; failed: number; unread: string[]; offline?: true; stopped?: string; partway?: true };
  updated: PluginUpdateLine[]; failed: PluginUpdateLine[]; first: boolean;
}
/** Why this copy can't update itself (see updates.ts for each one's words). */
export type UpdateReason = 'dev' | 'untagged' | 'unsigned' | 'applications' | 'readonly';
/** A newer release: its tag, its Mac zip (where and how many bytes) and its page, which has the release notes. */
export interface UpdateRelease { tag: string; zip: string; size: number; page: string }
/**
 * Updates as the main process has them. `shown`: false where there are no releases (not macOS), and nothing is said anywhere.
 * `tag`: the release tag this build was made from; `reason`: why it can't update itself. `checked`: the last check, and why
 * it failed. `available`: a newer release; `step` and `progress` (0 to 1): an update under way; `failed`: why the last update
 * stopped (the installed app unchanged). `updated`: this launch is the first after an update to that release.
 */
export interface UpdateView {
  shown: boolean; version: string; tag?: string; reason?: { key: UpdateReason; text: string };
  checking: boolean; checked?: { at: number; failed?: string };
  available?: UpdateRelease; step?: 'downloading' | 'installing' | 'ready'; progress?: number; failed?: string;
  updated?: { tag: string; page: string };
}
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


// ---------- Git repo ----------

/** What one item of the Managed set is, in the repo's layout. */
export type RepoKind = 'skill' | 'mcp' | 'agent' | 'base';

/** One item that differs between the Managed set here and the repo. */
export interface RepoChange {
  /** History's key for the item (a skill's key, `mcp:<name>`, `agent:<key>`), or `instructions:base`. */
  key: string;
  kind: RepoKind;
  name: string;
  /** What happened to it on the side it comes from. */
  change: 'added' | 'changed' | 'removed';
  /** Incoming: it changed here too since the last pull (or was removed here, or is no longer Managed), or the repo adds one by the name of an item here that isn't Managed. The repo's version wins on Pull; History keeps yours. */
  alsoHere?: 'changed' | 'removed' | 'unmanaged';
  /** Incoming, an MCP server's or agent's deletion: 'waits' while Automatic sync is off (Pull can't spread it); 'ready' once sync is on after a Pull left it waiting. */
  sync?: 'waits' | 'ready';
  /** Incoming: what Pull does with it now: brings it in, tries it again (the last Pull left it), leaves it until Automatic sync is on, or can't take it. */
  pull?: 'moves' | 'again' | 'waits' | 'stuck';
  /** Outgoing: removed in the repo but changed here, so your change stays and goes back with the next Push. */
  keptHere?: boolean;
  /** Why it can't be brought across, if it can't. */
  held?: string;
  /** Held only because the last Pull couldn't finish it: the next Pull tries again. */
  retry?: boolean;
}

export interface RepoCommit { id: string; subject: string; at: string }

export type RepoView =
  | { connected: false; access: WriteAccess }
  | {
    connected: true;
    access: WriteAccess;
    url: string;
    branch: string;
    /** The commit last pulled or pushed here, and the repo's latest commit as last checked. */
    base?: RepoCommit;
    latest?: RepoCommit;
    pulledAt?: string;
    pushedAt?: string;
    checkedAt?: string;
    /** Why the last check could not reach the repo. */
    problem?: string;
    incoming: RepoChange[];
    outgoing: RepoChange[];
    /** Why Push can't run now. */
    pushBlocked?: string;
    /** The repo no longer has this branch: Push puts it back. */
    branchGone?: boolean;
  };
/** The page of a connected repo. */
export type ConnectedRepoView = Extract<RepoView, { connected: true }>;

export interface RepoResult { view: RepoView; stopped?: string; /** Connect: the field the refusal concerns. */ field?: 'url' | 'branch'; results: DestinationResult[]; /** Push: the commit made. */ pushed?: RepoCommit; /** Pull: how many items came in. */ pulled?: number; /** Pull: MCP servers that reach Claude Code only with Write to Claude Code. */ waitsForClaude?: string[] }
// ---------- Profiles ----------

/**
 * A named set of library items to have On (profileplan.ts): `skill:<key>`, `agent:<key>` and `mcp:<key>`. Switching to it
 * turns those On and every other library item Off; nothing else is kept about it, and which profile is in use is worked out.
 */
export interface Profile { id: string; name: string; items: string[] }

export interface ProfilesView {
  profiles: Profile[];
  /** Why profiles can't be read or saved here, if they can't. */
  problem?: string;
}

/**
 * A profile to add (no `id`) or change: only the fields given change, so a rename and a tick never undo each other. `restore` makes
 * a deleted profile again with its own `id` (Undo of Delete).
 */
export interface ProfileEdit { id?: string; name?: string; items?: string[]; restore?: boolean }

/** A library item a profile switch named, as History keeps it: its id (profileplan.ts itemId) and its name then. */
export interface SwitchedItem { id: string; name: string }

/**
 * What a switch did: the profile's name, the items it turned On and Off and those not as it asked once its passes ran (`left`:
 * one turned Off again because a copy was deleted by hand; History says so), by name; the MCP servers whose Claude Code part
 * waits for Write to Claude Code, by key; and what could not be done in a tool (`results`). `event`: its History entry; none
 * when nothing changed.
 */
export interface ProfileSwitchResult { stopped?: string; name?: string; on: string[]; off: string[]; left: string[]; waits: string[]; results: DestinationResult[]; event?: string; view?: HomeView }
