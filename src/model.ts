import type { HarnessId, HistoryDays, HomeView, ManageView, Snapshot } from './types.ts';

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
/** 'today' or 'yesterday' for a time on one of those days, in the person's own time zone; undefined otherwise. */
export function nearDay(iso: string): 'today' | 'yesterday' | undefined {
  const day = new Date(iso).toDateString();
  return day === new Date().toDateString() ? 'today' : day === new Date(Date.now() - DAY_MS).toDateString() ? 'yesterday' : undefined;
}
/** "today", "yesterday", else "Nov 8" (with the year when it isn't this one). */
function dayWords(iso: string): string {
  const date = new Date(iso);
  return nearDay(iso) ?? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
/** "today at 9:20 AM", "yesterday at 9:20 AM", else "Nov 8 at 9:20 AM" (with the year when it isn't this one). */
export const dayAndTime = (iso: string) => `${dayWords(iso)} at ${clockTime(iso)}`;
/**
 * When each row of one list happened, every row in the same form so they read alike (History, an agent's versions): how
 * long ago ("just now", "3 min ago", "2 h ago") when every row is today and no two would read the same; else the clock
 * time, to the second when two rows would read the same. `withDay`: a row before today says its day too ("yesterday at
 * 9:20 AM"); History, under day headings, says the time alone.
 */
export function timesApart(isos: readonly string[], now = Date.now(), withDay = false): string[] {
  const apart = (said: string[]) => new Set(said).size === said.length;
  const days = isos.map(iso => new Date(iso).toDateString()), today = new Date(now).toDateString();
  const ago = isos.map(iso => {
    const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
    return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
  });
  if (days.every(day => day === today) && apart(ago)) return ago;
  const clock = (seconds: boolean) => isos.map(iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }));
  const minutes = clock(false);
  const times = apart(minutes.map((time, index) => `${days[index]} ${time}`)) ? minutes : clock(true);
  return times.map((time, index) => (withDay && days[index] !== today ? `${dayWords(isos[index])} at ${time}` : time));
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
