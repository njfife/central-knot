import type { DestinationResult, HarnessId, HomeView, PlanItem, Preview, Skill, Snapshot } from './types.ts';
import type { IconName } from './icons.ts';

/** One skill across tools: every copy that shares its folder name, and what the plan says about it. */
export interface Row {
  key: string;
  name: string;
  description: string;
  copies: { tool: HarnessId; skill: Skill }[];
  plan?: PlanItem;
  status: string;
}

const shortNames: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI' };
const monograms: Record<HarnessId, string> = { 'claude-cli': 'Cc', 'copilot-cli': 'Cp' };
export const toolName = (tool: HarnessId) => shortNames[tool];
export const toolMonogram = (tool: HarnessId) => monograms[tool];
export const fullToolName = (snapshot: Snapshot) => `${snapshot.harnessName} ${snapshot.surface}`;
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

const rowStatuses = ['Needs a decision', 'Not available here', 'Not known yet', 'With limits', 'Written'];
const statusFor = (plan?: PlanItem) => (plan && rowStatuses.includes(plan.status) ? plan.status : 'Not shared');

export function buildRows(home: HomeView, preview: Preview): Row[] {
  const rows = new Map<string, Row>();
  for (const snapshot of home.snapshots) for (const skill of snapshot.skills) {
    const key = skill.folder.normalize('NFC').toLowerCase();
    let row = rows.get(key);
    if (!row) {
      const plan = preview.items.find(item => item.key === key);
      row = { key, name: skill.name, description: skill.description, copies: [], plan, status: statusFor(plan) };
      rows.set(key, row);
    }
    row.description ||= skill.description;
    row.copies.push({ tool: snapshot.harness, skill });
  }
  return [...rows.values()].sort((first, second) => first.name.localeCompare(second.name));
}

export const copiesIn = (row: Row, tool: HarnessId) => row.copies.filter(copy => copy.tool === tool);

export function matches(row: Row, find: string): boolean {
  const needle = find.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.key, row.description].some(text => text.toLowerCase().includes(needle));
}

const looks: Record<string, { glyph: IconName; tone: string }> = {
  'Needs a decision': { glyph: 'triangle-alert', tone: 'warning' },
  'With limits': { glyph: 'circle-minus', tone: 'warning' },
  Written: { glyph: 'circle-check', tone: 'success' },
  'Not known yet': { glyph: 'circle-question-mark', tone: 'muted' },
  'Not available here': { glyph: 'circle-off', tone: 'muted' },
  'Not shared': { glyph: 'circle-dashed', tone: 'muted' },
  'Will copy': { glyph: 'copy', tone: 'accent' },
  'Already identical': { glyph: 'check', tone: 'muted' },
  'Already shared': { glyph: 'link-2', tone: 'muted' },
  'Don’t share': { glyph: 'circle-off', tone: 'muted' },
};
export const lookOf = (status: string) => looks[status] ?? { glyph: 'circle-question-mark' as IconName, tone: 'muted' };

const outcomes: Record<DestinationResult['outcome'], { word: string; glyph: IconName; tone: string }> = {
  written: { word: 'Written', glyph: 'circle-check', tone: 'success' },
  removed: { word: 'Removed', glyph: 'circle-check', tone: 'success' },
  kept: { word: 'Kept', glyph: 'check', tone: 'muted' },
  held: { word: 'Held', glyph: 'triangle-alert', tone: 'warning' },
  stayed: { word: 'Stayed', glyph: 'triangle-alert', tone: 'warning' },
  failed: { word: 'Failed', glyph: 'circle-x', tone: 'danger' },
};
export const outcomeOf = (outcome: DestinationResult['outcome']) => outcomes[outcome];

const planOrder: PlanItem['state'][] = ['collision', 'held', 'copy', 'identical', 'already-shared', 'dont-share'];

/** The plan grouped by what will happen, most urgent first. A group is one engine status. */
export function planGroups(items: PlanItem[]): { status: string; items: PlanItem[] }[] {
  const ordered = [...items].sort((first, second) => planOrder.indexOf(first.state) - planOrder.indexOf(second.state) || first.name.localeCompare(second.name));
  const groups = new Map<string, PlanItem[]>();
  for (const item of ordered) groups.set(item.status, [...(groups.get(item.status) ?? []), item]);
  return [...groups].map(([status, grouped]) => ({ status, items: grouped }));
}

export function planSummary(items: PlanItem[]): string {
  const count = (state: PlanItem['state']) => items.filter(item => item.state === state).length;
  const parts = [[count('copy'), 'to copy'], [count('collision'), 'to decide'], [count('held'), 'held']] as const;
  return parts.filter(([value]) => value).map(([value, label]) => `${value} ${label}`).join(' · ') || `${items.length} in step`;
}
