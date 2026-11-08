export type HomeMode = 'fixture' | 'custom' | 'actual';
export type HarnessId = 'claude-cli' | 'copilot-cli';
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

export interface HomeView { mode: HomeMode; label: string; home: string; snapshots: Snapshot[]; manage: ManageView }

export interface DesktopApi {
  selectHome(mode: HomeMode): Promise<HomeView | null>;
  refresh(): Promise<HomeView | null>;
  apply(changes: Change[], resume: boolean, home: string): Promise<ApplyResult>;
}

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
}

export interface ManageView {
  tools: HarnessId[];
  /** Where each tool's new copies go, and which other tools read that folder too. */
  writes: Partial<Record<HarnessId, { to: string; alsoReadBy: string[]; /** Why Central Knot does not write there, if it does not. */ blocked?: string }>>;
  skills: SkillFacts[];
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
}

export interface ApplyResult { stopped?: string; results: DestinationResult[]; harnessWrites: number }
