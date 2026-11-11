// Design preview: sample skills for iterating on the Overview's layout. Started only with --design-preview.
import { comparedTools, copiesDiffer } from './syncrules.ts';
import type { GoneItem, Outside, SwitchProblem, ThroughPlugin } from './types.ts';
export { comparedTools, copiesDiffer };
// Nothing here reads or writes disk; the controls act on this sample alone.

/** A tool column. The design preview can add a third, imagined tool to show how the page grows. */
export type Tool = string;
const params = new URLSearchParams(location.search);
export const threeTools = (params.get('design') ?? '').endsWith('3') || ['1', ''].includes(params.get('design') ?? '');
export const tools: Tool[] = threeTools ? ['claude-cli', 'copilot-cli', 'codex-cli'] : ['claude-cli', 'copilot-cli'];

/** A copy's content id per tool (same id = same bytes), or absent. */
export interface SampleSkill {
  key: string;
  /** Made by Convert to skill from an agent. */
  converted?: { agent: string; origin: string; losses: string[] };
  /** Shown name, with its case. */
  name?: string;
  /** Other copies a tool also reads, for the details. */
  extra?: { tool: Tool; directory: string; summary: string; writable: boolean; same: boolean; outside?: Outside }[];
  description: string;
  copies: Partial<Record<Tool, string>>;
  managed: boolean;
  off: Tool[];
  cannot?: Partial<Record<Tool, string>>;
  /** Tools with no copy of their own that have it through a plugin installed there (each is in `cannot` too). */
  plugin?: Partial<Record<Tool, ThroughPlugin>>;
  /** Copies that differ, left as separate skills on purpose. */
  separate?: boolean;
  /** Why this skill cannot be managed at all. */
  held?: string;
  /** For each tool's copy, what stops every tool from using it, by the tool concerned. */
  blocks?: Partial<Record<Tool, { tool: Tool; reason: string }[]>>;
  /** Tools whose copy was edited since the last sync and waits to spread. */
  edited?: Tool[];
  /** Each tool's main copy's content ID, to tie a choice to what was seen. */
  hashes?: Partial<Record<Tool, string>>;
  /** Where each copy lives, for the details. */
  paths?: Partial<Record<Tool, string>>;
  /** For the compare view: one line per copy that differs. */
  versions?: Partial<Record<Tool, { lines: string; changed: string; text: string }>>;
  /** Agents: the With limits label for each tool that lacks some of the origin's fields. */
  limits?: Partial<Record<Tool, string>>;
  oneWay?: { from: Tool; lost: string[] };
  kept?: string[];
  /** Agents: one-way tools edited or deleted there, no longer updated. */
  stopped?: Tool[];
  /** MCP: tools whose copy waits for an explicit write (Claude Code, Write now). */
  waits?: Tool[];
  /** Skills: tools whose copy is disabled with the tool's own switch (it stays there; the tool doesn't load it). */
  disabled?: Tool[];
  /** Skills: why a tool's switch can't be used at all (its settings file, named in `file`). */
  switchProblem?: Partial<Record<Tool, SwitchProblem>>;
  /** Skills: a quiet note that Disable isn't verified on a tool's build (older, or unreadable); the switch is offered anyway. */
  disableNote?: Partial<Record<Tool, string>>;
  /** Skills: whether Central Knot may change each tool's copy (not a link or a shared folder), so Remove can be offered. */
  writable?: Partial<Record<Tool, boolean>>;
  /** Skills: a tool whose copy is another tool's, read in that tool's own folder (OpenCode reads Claude Code's), and whose. */
  reads?: Partial<Record<Tool, Tool>>;
  /** Skills: a tool's copy that is a link in its own folder, or the shared folder's copy: taken over when the person asks. */
  outside?: Partial<Record<Tool, Outside>>;
  /** Skills: a broken link by this name in a tool's own folder, and where it led: a copy written there replaces it. */
  brokenLink?: Partial<Record<Tool, string>>;
  /** Skills, managed: its links or shared copy are back since a take-over removed them. */
  outsideBack?: boolean;
  /** Skills, before Apply all: tools whose copy is removed then. */
  removing?: Tool[];
  /** No tool has a copy any more; History can put it back. */
  gone?: GoneItem;
}

export const sample: SampleSkill[] = [
  { key: 'code-review', description: 'Review the changes since a fixed point.', copies: { 'claude-cli': 'a', 'copilot-cli': 'a' }, managed: true, off: [] },
  { key: 'tdd', description: 'Test-driven development, one failing test at a time.', copies: { 'claude-cli': 'b', 'copilot-cli': 'b' }, managed: true, off: [] },
  { key: 'handoff', description: 'Hand the conversation to a fresh agent.', copies: { 'claude-cli': 'c' }, managed: true, off: ['copilot-cli'] },
  { key: 'sec-api', description: 'Query SEC filing metadata.', copies: { 'claude-cli': 'd' }, managed: true, off: [] },
  { key: 'wizard', description: 'Step-by-step setup helper.', copies: { 'claude-cli': 'e', 'copilot-cli': 'e2' }, managed: true, off: [],
    versions: { 'claude-cli': { lines: '42 lines', changed: 'edited 3 days ago', text: 'Ask one question at a time, then confirm the whole plan.' }, 'copilot-cli': { lines: '38 lines', changed: 'edited yesterday', text: 'Ask every question up front, then start.' } } },
  { key: 'grill-me', description: 'Relentless questions about a plan.', copies: { 'claude-cli': 'f', 'copilot-cli': 'f' }, managed: false, off: [] },
  { key: 'triage', description: 'Sort incoming issues by urgency.', copies: { 'claude-cli': 'g', 'copilot-cli': 'g' }, managed: false, off: [] },
  { key: 'release-notes', description: 'Draft release notes from merged changes.', copies: { 'claude-cli': 'h' }, managed: false, off: [] },
  { key: 'standup', description: 'Three-line standup from yesterday’s commits.', copies: { 'copilot-cli': 'i' }, managed: false, off: [] },
  { key: 'review', description: 'Summarize a diff.', copies: { 'claude-cli': 'j', 'copilot-cli': 'j2' }, managed: false, off: [],
    versions: { 'claude-cli': { lines: '12 lines', changed: 'edited 2 weeks ago', text: 'Summarize what changed and what to check.' }, 'copilot-cli': { lines: '19 lines', changed: 'edited 4 days ago', text: 'List defects first, then missing tests.' } } },
  { key: '.scratch', description: 'Private notes skill.', copies: { 'claude-cli': 'k' }, managed: false, off: [], cannot: { 'copilot-cli': 'Copilot CLI does not load folders starting with a dot.' } },
  { key: 'writing-shape', description: 'Shape a draft before polishing it.', copies: { 'claude-cli': 'l', 'copilot-cli': 'l' }, managed: true, off: [] },
  { key: 'old-deploy', description: 'Deploy steps from the last project.', copies: { 'claude-cli': 'm' }, managed: false, off: [], disabled: ['claude-cli'] },
];

export const designMode = new URLSearchParams(location.search).has('design');
/** Which layout option to show: a, b or c. */
export const variant = (() => { const value = (params.get('design') ?? 'b').replace(/3$/, ''); return ['a', 'b', 'c'].includes(value) ? value : 'b'; })();

if (threeTools) {
  const codex: Record<string, string | undefined> = { 'code-review': 'a', tdd: 'b', 'grill-me': 'f', 'writing-shape': 'l', wizard: 'e', standup: 'i', 'release-notes': undefined };
  for (const skill of sample) {
    const id = codex[skill.key];
    if (id) skill.copies['codex-cli'] = id;
    if (skill.key === 'tdd' || skill.key === 'code-review') skill.off = skill.off.filter(tool => tool !== 'codex-cli');
    if (skill.key === 'sec-api') skill.off = [...skill.off, 'codex-cli'];
  }
}

/** --design-preview=large adds generated skills, to see the page with hundreds of them. */
if (new URLSearchParams(location.search).get('design') === 'large') {
  const words = ['api', 'audit', 'brief', 'build', 'cache', 'check', 'commit', 'data', 'debug', 'deploy', 'diff', 'docs', 'draft', 'email', 'fix', 'format', 'graph', 'infra', 'lint', 'log', 'merge', 'notes', 'plan', 'query', 'refactor', 'release', 'report', 'review', 'schema', 'search', 'spec', 'sql', 'test', 'trace', 'triage', 'ui', 'write'];
  for (let index = 0; sample.length < 300; index++) {
    const key = `${words[index % words.length]}-${words[(index * 7 + 3) % words.length]}-${index}`;
    const pattern = index % 10;
    const id = `g${index}`;
    sample.push({
      key, description: `Generated sample skill ${index}.`,
      copies: pattern < 4 ? { 'claude-cli': id, 'copilot-cli': id } : pattern < 6 ? { 'claude-cli': id } : pattern < 8 ? { 'copilot-cli': id } : pattern === 8 ? { 'claude-cli': id, 'copilot-cli': `${id}b` } : { 'claude-cli': id, 'copilot-cli': id },
      managed: pattern < 3 || pattern === 9, off: [],
    });
  }
}

/** What one cell of the table shows. */
export type Cell = 'synced' | 'will-sync' | 'differs' | 'off' | 'present' | 'present-differs' | 'absent' | 'cannot' | 'edited' | 'waiting' | 'write-now';
export type Sync = 'in-sync' | 'pending' | 'attention' | 'none';


export function cellOf(skill: SampleSkill, tool: Tool): Cell {
  const has = skill.copies[tool] !== undefined;
  if (skill.cannot?.[tool] || (skill.held && !has)) return 'cannot';
  // MCP: Claude Code's copy waits for Write now (MCP-02), whatever the others hold.
  if (skill.managed && !skill.off.includes(tool) && skill.waits?.includes(tool)) return 'write-now';
  if (skill.separate) return has ? 'present' : 'absent';
  const counts = has && !skill.off.includes(tool);
  if (!skill.managed) return has ? (counts && copiesDiffer(skill) ? 'present-differs' : 'present') : 'absent';
  if (skill.off.includes(tool)) return has ? 'present' : 'absent';
  // Nothing can be copied here unless a tool it syncs to has a copy to start from.
  // An edit waiting to spread (Sync off, or settling) is pending, not a choice to make: the edited copy, and the copies that get it.
  if (skill.edited?.length) return skill.edited.includes(tool) ? 'edited' : 'waiting';
  if (!has) return comparedTools(skill).length ? 'will-sync' : 'absent';
  return copiesDiffer(skill) ? 'differs' : 'synced';
}

export function syncOf(skill: SampleSkill, toolList: Tool[] = tools): Sync {
  const cells = toolList.map(tool => cellOf(skill, tool));
  // A skill that cannot be managed offers no decision: there is nothing Apply all would do with one.
  if (skill.held) return skill.managed ? 'in-sync' : 'none';
  if (cells.includes('differs') || cells.includes('present-differs')) return 'attention';
  if (!skill.managed) return 'none';
  if (cells.some(cell => cell === 'will-sync' || cell === 'edited' || cell === 'waiting' || cell === 'write-now')) return 'pending';
  return 'in-sync';
}

/** Copy content on apply: managed skills reach every tool not turned off, from any copy. */
export function applied(skill: SampleSkill): SampleSkill {
  if (!skill.managed) return skill;
  const ids = new Set(Object.values(skill.copies));
  if (ids.size !== 1) return skill;
  const [id] = ids;
  const copies = { ...skill.copies };
  for (const tool of tools) if (!skill.off.includes(tool) && !skill.cannot?.[tool]) copies[tool] = id;
  return { ...skill, copies };
}
