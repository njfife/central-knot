import type { HarnessId, HistoryDays, Snapshot } from './types.ts';

const monograms: Record<HarnessId, string> = { 'claude-cli': 'Cc', 'copilot-cli': 'Cp', 'codex-cli': 'Cx', 'pi-cli': 'Pi' };
export { toolName } from './words.ts';
export const toolMonogram = (tool: HarnessId) => monograms[tool];
export const fullToolName = (snapshot: Snapshot) => `${snapshot.harnessName} ${snapshot.surface}`;
/** A clock time in the person's own format: "9:20 AM". */
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** One day, for ages and windows counted in days. */
export const DAY_MS = 86_400_000;
/** How many days History can keep changes and deleted items (Settings), and how many it keeps unless told otherwise. */
export const historyDayChoices: readonly HistoryDays[] = [7, 30, 90];
export const defaultHistoryDays: HistoryDays = 30;
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** Distinct skills: the same folder name in two of a tool's folders is one skill to that tool. */
export const skillCount = (snapshot: Snapshot) => new Set(snapshot.skills.map(skill => skill.folder.normalize('NFC').toLowerCase())).size;

/** Items grouped by a key, groups and items in the order first seen (Map.groupBy, which ES2023 lacks). */
export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const at = key(item);
    const group = groups.get(at);
    if (group) group.push(item); else groups.set(at, [item]);
  }
  return groups;
}
