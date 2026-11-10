import type { HarnessId, HistoryDays, ManageView, Snapshot } from './types.ts';

const monograms: Record<HarnessId, string> = { 'claude-cli': 'Cc', 'copilot-cli': 'Cp', 'codex-cli': 'Cx', 'pi-cli': 'Pi' };
export { toolName } from './words.ts';
export const toolMonogram = (tool: HarnessId) => monograms[tool];
export const fullToolName = (snapshot: Snapshot) => `${snapshot.harnessName} ${snapshot.surface}`;
/** A clock time in the person's own format: "9:20 AM". */
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** A path's last part: the file's own name. */
export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
/** Skills a catch-up copied where they were missing, leaving out those a sync notice already tells (`told`: their names). */
export const caughtUpNames = (manage: ManageView, told: Set<string>) =>
  [...new Set(manage.caughtUp.filter(result => result.outcome === 'written' && !told.has(result.item)).map(result => result.item))];
/** One day, for ages and windows counted in days. */
export const DAY_MS = 86_400_000;
/** How many days History can keep changes and deleted items (Settings), and how many it keeps unless told otherwise. */
export const historyDayChoices: readonly HistoryDays[] = [7, 30, 90];
export const defaultHistoryDays: HistoryDays = 30;
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

