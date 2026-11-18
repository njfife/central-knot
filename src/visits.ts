// The window's list of places. places.ts derives and opens them. These operations keep the previous list intact.
import type { Page, HarnessTab } from './app.ts';
import type { HarnessId } from './types.ts';
import type { MarketTab } from './pluginstate.ts';

export interface Place { page: Page; tool?: HarnessId; tab?: HarnessTab; source?: string; marketName?: string; marketTab?: MarketTab; plugin?: string; skill?: string }
export interface Visits { entries: Place[]; cursor: number }
export const emptyVisits = (): Visits => ({ entries: [], cursor: -1 });
// The press matcher compares the same fields as history, regardless of property order.
export const placeKey = (p: Place) => JSON.stringify([p.page, p.tool, p.tab, p.source, p.marketName, p.marketTab, p.plugin, p.skill]);
export function recordPlace(list: Visits, place: Place, moved: boolean): Visits {
  const here = list.entries[list.cursor];
  if (here && placeKey(here) === placeKey(place)) return list;
  if (here && !moved) return land(list, list.cursor, place, p => p);
  return { entries: [...list.entries.slice(0, list.cursor + 1), place], cursor: list.cursor + 1 };
}

/** A vanished destination becomes its parent. Adjoining visits that now land there become one stop. */
export function travel(list: Visits, step: number, resolve: (p: Place) => Place): Visits {
  const at = list.cursor + step, target = list.entries[at];
  if (!target) return list;
  return land(list, at, resolve(target), resolve);
}

function land(list: Visits, at: number, landing: Place, resolve: (p: Place) => Place): Visits {
  const key = placeKey(landing);
  let first = at, last = at;
  while (first > 0 && placeKey(resolve(list.entries[first - 1]!)) === key) first--;
  while (last + 1 < list.entries.length && placeKey(resolve(list.entries[last + 1]!)) === key) last++;
  return { entries: [...list.entries.slice(0, first), landing, ...list.entries.slice(last + 1)], cursor: first };
}
