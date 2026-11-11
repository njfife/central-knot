// Where an item goes in a list: what is on first, then what some tool has that Central Knot doesn't sync, then what is off.
// Someone moving an item from one tool to another finds it without scrolling past what nothing loads.

/**
 * What decides an item's place: who has a copy, where the tool's own switch turned it off, and whether it is synced. What a
 * tool has through a plugin doesn't count: the plugin decides that, never the item's switch.
 */
export interface Placed { managed: boolean; copies: Partial<Record<string, unknown>>; disabled?: string[] }

/**
 * 0: on: synced, and some tool loads it. 1: not synced, and some tool loads it. 2: off: no tool of `tools` loads it (every
 * copy is turned off there, or no copy is left), synced or not.
 */
export function standing(item: Placed, tools: readonly string[]): 0 | 1 | 2 {
  const used = tools.some(tool => item.copies[tool] !== undefined && !item.disabled?.includes(tool));
  return !used ? 2 : item.managed ? 0 : 1;
}

/** By name, a leading dot aside (".hidden" sorts with the h's). */
export const byKey = (first: { key: string }, second: { key: string }) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, ''));
