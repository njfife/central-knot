export type HomeMode = 'fixture' | 'custom' | 'actual';
export type HarnessId = 'claude-cli' | 'copilot-cli' | 'codex-cli';
export type ProbeState = 'ok' | 'missing' | 'timeout' | 'failed' | 'malformed' | 'restricted' | 'not-run';

export interface ProbeResult {
  state: ProbeState;
  version?: string;
  detail: string;
}

export interface Skill {
  id: string;
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

export interface DestinationResult { item: string; harness?: HarnessId; outcome: 'written' | 'kept' | 'held' | 'removed' | 'stayed' | 'failed'; message: string }

export interface HomeView { mode: HomeMode; label: string; home: string; snapshots: Snapshot[]; manage: ManageView; /** MCP servers across tools, managed like skills. */ mcp: McpView; /** Agents across tools, managed like skills; lossy destinations one-way. */ agents: McpView; /** The Sync switch (SYN-03): off stops background writes; explicit actions still run. */ syncOn: boolean }

export interface DesktopApi {
  selectHome(mode: HomeMode): Promise<HomeView | null>;
  refresh(): Promise<HomeView | null>;
  apply(changes: Change[], resume: boolean, home: string): Promise<ApplyResult>;
  history(): Promise<HistoryEvent[]>;
  applyMcp(changes: Change[], home: string): Promise<McpResult>;
  writeClaude(names: string[], home: string): Promise<McpResult>;
  applyAgents(changes: Change[], home: string): Promise<McpResult>;
  /** The home last opened, else the practice copy. */
  startHome(): Promise<HomeView | null>;
  setSync(on: boolean): Promise<HomeView | null>;
  syncNow(home: string): Promise<HomeView | null>;
  onSyncChanged(callback: () => void): void;
  /** `choice`: which overwritten edit to put back, for an event with several. */
  restore(eventId: string, resume: boolean, home: string, choice?: string): Promise<ApplyResult>;
  deleteEverywhere(key: string, resume: boolean, home: string): Promise<ApplyResult>;
  plugins(): Promise<PluginsView | null>;
  addMarketplace(source: string): Promise<{ problem?: string; view?: PluginsView }>;
  refreshMarketplace(source: string): Promise<PluginsView | null>;
  forgetMarketplace(source: string): Promise<PluginsView | null>;
  pickMarketplaceFolder(): Promise<string | null>;
  installPlugin(source: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstallPlugin(marketplace: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
}

export interface PluginActionResult { stopped?: string; reports: ActionReport[]; view?: PluginsView }

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
  /** Agents: one-way tools edited or deleted there, which Central Knot stopped updating (D-26). */
  stopped?: HarnessId[];
}

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
  kind: 'edit' | 'conflict' | 'deleted' | 'kept-edit' | 'restored' | 'chosen';
  winner?: { tool: HarnessId; hash: string };
  /** Content that gave way, kept in Central Knot's store. */
  losers: { tool: HarnessId; hash: string }[];
  /** The synced content before this event, to put back on Undo. */
  previous?: string;
  orderProved: boolean;
  /** Set once undone or restored, naming the event that did it. */
  undoneBy?: string;
}

// ---------- Marketplaces and plugins ----------
export type AccessResult =
  | { state: 'ok' }
  | { state: 'sign-in' | 'no-access' | 'unknown-host' | 'passphrase' | 'network' | 'git-missing' | 'unclassified'; message: string };

export interface Components { skills: number; commands: number; agents: number; hooks: boolean; mcp: number; mcpRootVariable: boolean; bin: boolean }

export interface CatalogPlugin {
  name: string;
  description: string;
  version?: string;
  /** The plugin's folder, when it sits inside the marketplace itself. Elsewhere its components are not known before install. */
  folder?: string;
  components?: Components;
  /** Why Copilot CLI would refuse the whole marketplace because of this entry (MKT-06). */
  copilotRefuses?: string;
}

export interface Catalog { name: string; source: string; kind: 'folder' | 'git'; fetchedAt: string; plugins: CatalogPlugin[]; problem?: string }

export type InstallState = { state: 'installed'; path: string; live?: boolean } | { state: 'not-installed' } | { state: 'not-known'; reason: string };

/** One component's outcome on one tool (capability data, Appendix D). */
export interface Outcome { component: string; result: 'works' | 'limited' | 'ignored' | 'fails' | 'unknown'; text: string }

export interface NativeRun { tool: HarnessId; command: string; ok: boolean; output: string; changed: { path: string; before: string | null; after: string | null }[] }

export interface ActionReport { tool: HarnessId; outcome: 'installed' | 'uninstalled' | 'held' | 'failed' | 'not-known'; message: string; runs: NativeRun[] }

/** A catalog plugin with what each tool would get from it. */
export interface PluginView extends CatalogPlugin { outcomes: Partial<Record<HarnessId, Outcome[]>> }

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
}

export interface PluginsView {
  home: string;
  tools: HarnessId[];
  /** Tools whose own CLI was found, so their plugin commands can run. */
  clis: Partial<Record<HarnessId, boolean>>;
  canWrite: boolean;
  reason?: string;
  marketplaces: MarketplaceView[];
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

export interface McpResult { stopped?: string; results: DestinationResult[]; writes: number; notices?: SyncNotice[] }
