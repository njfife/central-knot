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

export type PlanState = 'already-shared' | 'identical' | 'copy' | 'collision' | 'held' | 'dont-share';

export interface PlanCopy { harness: HarnessId; directory: string; realDirectory: string; hash: string; rootLabel: string }
export interface PlanTarget { harness: HarnessId; directory: string; limits: string[]; note?: string; skipped?: string }

export interface PlanItem {
  key: string;
  name: string;
  state: PlanState;
  status: string;
  reason: string;
  copies: PlanCopy[];
  targets: PlanTarget[];
  diff?: string;
  /** Recorded as Don't share; a later version offers Share. */
  locked: boolean;
  undoable: boolean;
}

export interface Disclosure { harness: HarnessId; name: string; writesTo: string; alsoReadBy: string[] }

export interface WriteAccess { allowed: boolean; reason: string }

export type SyncGate =
  | { state: 'first-setup' | 'ready' }
  | { state: 'needs-resume'; reason: string }
  | { state: 'stopped'; reason: string };

export interface Preview {
  selected: HarnessId[];
  items: PlanItem[];
  disclosures: Disclosure[];
  access: WriteAccess;
  gate: SyncGate;
  canUndo: boolean;
}

export interface DestinationResult { item: string; harness?: HarnessId; outcome: 'written' | 'kept' | 'held' | 'removed' | 'stayed' | 'failed'; message: string }

export interface ActionResult {
  stopped?: string;
  results: DestinationResult[];
  harnessWrites: number;
  preview: Preview;
}

export interface HomeView { mode: HomeMode; label: string; home: string; snapshots: Snapshot[]; preview: Preview; manage: ManageView }

export interface DesktopApi {
  selectHome(mode: HomeMode): Promise<HomeView | null>;
  refresh(): Promise<HomeView | null>;
  preview(selected: HarnessId[], dontShare: string[]): Promise<Preview>;
  start(selected: HarnessId[], dontShare: string[], resume: boolean, home: string): Promise<ActionResult>;
  undo(selected: HarnessId[], only: string | undefined, home: string): Promise<ActionResult>;
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
}

/** What is true now for one skill, across every tool. The page derives its marks from this. */
export interface SkillFacts {
  key: string;
  name: string;
  description: string;
  copies: Partial<Record<HarnessId, ToolCopy>>;
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
