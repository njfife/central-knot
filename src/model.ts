import type { AppPreferences, HarnessId, HistoryDays, HomeView, ManageView, Snapshot } from './types.ts';

const monograms: Record<HarnessId, string> = { 'claude-cli': 'Cc', 'copilot-cli': 'Cp', 'codex-cli': 'Cx', 'pi-cli': 'Pi', 'opencode-cli': 'Oc' };
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
/**
 * A view the page set aside (it arrived while an action ran) gave main's pending notices and caught-up results to the page,
 * so they go into the next view taken of the same home rather than being lost. Each is told once.
 */
export function withSetAside(aside: HomeView | undefined, view: HomeView): HomeView {
  if (!aside || aside.home !== view.home) return view;
  const once = <T>(earlier: T[], later: T[]) => [...new Map([...earlier, ...later].map(entry => [JSON.stringify(entry), entry])).values()];
  return {
    ...view,
    manage: { ...view.manage, notices: once(aside.manage.notices, view.manage.notices), caughtUp: once(aside.manage.caughtUp, view.manage.caughtUp) },
    mcp: { ...view.mcp, notices: once(aside.mcp.notices, view.mcp.notices) },
    agents: { ...view.agents, notices: once(aside.agents.notices, view.agents.notices) },
  };
}
/** One day, for ages and windows counted in days. */
export const DAY_MS = 86_400_000;
/** How many days History can keep changes and deleted items (Settings), and how many it keeps unless told otherwise. */
export const historyDayChoices: readonly HistoryDays[] = [7, 30, 90];
export const defaultHistoryDays: HistoryDays = 30;
/**
 * What Off does in a tool with no switch for an item, by Settings' "When a tool can't turn something off, remove its copy there":
 * remove that copy, keep it, or, before Settings could be read, neither: Off then changes nothing there and says why.
 */
export const noSwitchRule = (preferences: Pick<AppPreferences, 'removeWhenNoSwitch'> | undefined): 'remove' | 'keep' | 'unread' => (!preferences ? 'unread' : preferences.removeWhenNoSwitch ? 'remove' : 'keep');
/** How many days History keeps things, as Settings has it; the default until Settings is read. */
export const keptDays = (preferences: Pick<AppPreferences, 'historyDays'> | undefined) => preferences?.historyDays ?? defaultHistoryDays;
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
