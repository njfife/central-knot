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
/** 'today' or 'yesterday' for a time on one of those days, in the person's own time zone; undefined otherwise. */
export function nearDay(iso: string): 'today' | 'yesterday' | undefined {
  const day = new Date(iso).toDateString();
  return day === new Date().toDateString() ? 'today' : day === new Date(Date.now() - DAY_MS).toDateString() ? 'yesterday' : undefined;
}
/** "today at 9:20 AM", "yesterday at 9:20 AM", else "Nov 8 at 9:20 AM" (with the year when it isn't this one). */
export function dayAndTime(iso: string): string {
  const date = new Date(iso);
  const day = nearDay(iso) ?? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  return `${day} at ${clockTime(iso)}`;
}
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** Distinct skills: the same folder name in two of a tool's folders is one skill to that tool. */
export const skillCount = (snapshot: Snapshot) => new Set(snapshot.skills.map(skill => skill.folder.normalize('NFC').toLowerCase())).size;
