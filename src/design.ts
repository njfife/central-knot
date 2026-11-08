// Design preview: sample skills for iterating on the Overview's layout. Started only with --design-preview.
// Nothing here reads or writes disk; the controls act on this sample alone.
import type { HarnessId } from './types.ts';

export const tools: HarnessId[] = ['claude-cli', 'copilot-cli'];

/** A copy's content id per tool (same id = same bytes), or absent. */
export interface SampleSkill {
  key: string;
  description: string;
  copies: Partial<Record<HarnessId, string>>;
  managed: boolean;
  off: HarnessId[];
  cannot?: Partial<Record<HarnessId, string>>;
}

export const sample: SampleSkill[] = [
  { key: 'code-review', description: 'Review the changes since a fixed point.', copies: { 'claude-cli': 'a', 'copilot-cli': 'a' }, managed: true, off: [] },
  { key: 'tdd', description: 'Test-driven development, one failing test at a time.', copies: { 'claude-cli': 'b', 'copilot-cli': 'b' }, managed: true, off: [] },
  { key: 'handoff', description: 'Hand the conversation to a fresh agent.', copies: { 'claude-cli': 'c' }, managed: true, off: ['copilot-cli'] },
  { key: 'sec-api', description: 'Query SEC filing metadata.', copies: { 'claude-cli': 'd' }, managed: true, off: [] },
  { key: 'wizard', description: 'Step-by-step setup helper.', copies: { 'claude-cli': 'e', 'copilot-cli': 'e2' }, managed: true, off: [] },
  { key: 'grill-me', description: 'Relentless questions about a plan.', copies: { 'claude-cli': 'f', 'copilot-cli': 'f' }, managed: false, off: [] },
  { key: 'triage', description: 'Sort incoming issues by urgency.', copies: { 'claude-cli': 'g', 'copilot-cli': 'g' }, managed: false, off: [] },
  { key: 'release-notes', description: 'Draft release notes from merged changes.', copies: { 'claude-cli': 'h' }, managed: false, off: [] },
  { key: 'standup', description: 'Three-line standup from yesterday’s commits.', copies: { 'copilot-cli': 'i' }, managed: false, off: [] },
  { key: 'review', description: 'Summarize a diff.', copies: { 'claude-cli': 'j', 'copilot-cli': 'j2' }, managed: false, off: [] },
  { key: '.scratch', description: 'Private notes skill.', copies: { 'claude-cli': 'k' }, managed: false, off: [], cannot: { 'copilot-cli': 'Copilot CLI does not load folders starting with a dot.' } },
  { key: 'writing-shape', description: 'Shape a draft before polishing it.', copies: { 'claude-cli': 'l', 'copilot-cli': 'l' }, managed: true, off: [] },
];

export const designMode = new URLSearchParams(location.search).has('design');

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
export type Cell = 'synced' | 'will-sync' | 'differs' | 'off' | 'present' | 'present-differs' | 'absent' | 'cannot';
export type Sync = 'in-sync' | 'pending' | 'attention' | 'none';

export function cellOf(skill: SampleSkill, tool: HarnessId): Cell {
  const has = skill.copies[tool] !== undefined;
  if (skill.cannot?.[tool]) return 'cannot';
  const ids = new Set(Object.values(skill.copies));
  if (!skill.managed) return has ? (ids.size > 1 ? 'present-differs' : 'present') : 'absent';
  if (skill.off.includes(tool)) return has ? (ids.size > 1 ? 'present-differs' : 'present') : 'absent';
  if (!has) return 'will-sync';
  return ids.size > 1 ? 'differs' : 'synced';
}

export function syncOf(skill: SampleSkill): Sync {
  const cells = tools.map(tool => cellOf(skill, tool));
  if (cells.includes('differs') || cells.includes('present-differs')) return 'attention';
  if (!skill.managed) return 'none';
  if (cells.includes('will-sync')) return 'pending';
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
