// Where an item goes in a list: what is on first, then what some tool has that Central Knot doesn't sync, then what is off.
// Someone moving an item from one tool to another finds it without scrolling past what nothing loads.

/**
 * What decides an item's place: who has a copy, where the tool's own switch turned it off, the tools that have it through a
 * plugin and have it on there (`pluginOn`: the row's switch turns those too), and whether it is synced.
 */
export interface Placed { managed: boolean; copies: Partial<Record<string, unknown>>; disabled?: readonly string[]; pluginOn?: readonly string[] }

/**
 * The tools of `tools` that load it: a copy there that the tool's own switch hasn't turned off, or a plugin's item that is on
 * there. The one meaning of "on" for a row: its place, its switch and its status line all read it.
 */
export const loadedIn = (item: Placed, tools: readonly string[]) =>
  tools.filter(tool => (item.copies[tool] !== undefined ? !item.disabled?.includes(tool) : !!item.pluginOn?.includes(tool)));

/** 0: on: synced, and some tool loads it. 1: not synced, and some tool loads it. 2: off: no tool of `tools` loads it, synced or not. */
export function standing(item: Placed, tools: readonly string[]): 0 | 1 | 2 {
  return !loadedIn(item, tools).length ? 2 : item.managed ? 0 : 1;
}

/** By name, a leading dot aside (".hidden" sorts with the h's). */
export const byKey = (first: { key: string }, second: { key: string }) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, ''));
