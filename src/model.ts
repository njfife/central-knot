import type { HarnessId, ManageView, Snapshot } from './types.ts';

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
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

