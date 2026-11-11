import type { HarnessId, HistoryDays, HistoryEvent, HomeView, ManageView, Snapshot } from './types.ts';

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
/** Whether `later` is a deletion of `event`'s item, made at or after it, that still stands (not restored). */
const deletes = (later: HistoryEvent, event: HistoryEvent) => later.id !== event.id && later.key === event.key && later.kind === 'deleted' && !later.undoneBy
  && Date.parse(later.at) >= Date.parse(event.at);
/**
 * Whether the item `event` is about was deleted after it, by a deletion that still stands: what `event` did is then that
 * deletion's to put back. History's prune, its page, an Off row and turning an item on again all ask this one question.
 */
export const deletedSince = (event: HistoryEvent, events: HistoryEvent[]) => events.some(later => deletes(later, event));
/** An Off: a removal for tools with no switch for the item (`turnedOff`), not turned on again (undone). */
const isOff = (event: HistoryEvent) => event.kind === 'removed' && !!event.turnedOff && !event.undoneBy;
/** Whether `event` turned an item off and still stands: an Off not deleted since. Its Off row and its way back On read it. */
export const standingOff = (event: HistoryEvent, events: HistoryEvent[]) => isOff(event) && !deletedSince(event, events);
/**
 * Whether History keeps `event` whatever its age (`cutoff`: the oldest moment it keeps otherwise): an Off, and the content it
 * names, while anything can still bring its copies back. That is while it stands, and once a deletion ended it, for as long as
 * History keeps that deletion, whose Restore brings the Off back.
 */
export const keptOff = (event: HistoryEvent, events: HistoryEvent[], cutoff: number) => isOff(event) && !events.some(later => deletes(later, event) && Date.parse(later.at) < cutoff);
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
