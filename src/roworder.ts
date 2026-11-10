// The order lists show their rows in: what Central Knot manages, then what some tool has and uses, then what no tool uses.
// Someone moving an item from one tool to another finds it without scrolling past what nothing loads.

/** What decides an item's place: who has a copy, where the tool's own switch turned it off, and whether it is managed. */
export interface Placed { key: string; managed: boolean; copies: Partial<Record<string, unknown>>; disabled?: string[] }

/** Whether one of `tools` has a copy that its own switch has not turned off. */
export const inUse = (item: Pick<Placed, 'copies' | 'disabled'>, tools: readonly string[]) =>
  tools.some(tool => item.copies[tool] !== undefined && !item.disabled?.includes(tool));

/** 0: managed and in use. 1: unmanaged, in use in some tool. 2: in no tool, or disabled in every tool that has it. */
export const standing = (item: Placed, tools: readonly string[]): 0 | 1 | 2 => (!inUse(item, tools) ? 2 : item.managed ? 0 : 1);

/** By name, a leading dot aside (".hidden" sorts with the h's). */
export const byKey = (first: { key: string }, second: { key: string }) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, ''));

/** Managed first, then in use somewhere, then unused; by name within each. */
export const inDisplayOrder = <Item extends Placed>(list: readonly Item[], tools: readonly string[]): Item[] =>
  [...list].sort((first, second) => standing(first, tools) - standing(second, tools) || byKey(first, second));

/** A plugin's place among its marketplace's: 0 in every tool shown, 1 in some, 2 in none. `holding`: how many tools have it, whole or as parts. */
export const pluginStanding = (holding: number, tools: number): 0 | 1 | 2 => (!holding ? 2 : holding >= tools ? 0 : 1);

/** Plugins in every tool first, then in some, then in none; the order they came in (by name) within each. */
export const pluginsInDisplayOrder = <Plugin>(list: readonly Plugin[], holding: (plugin: Plugin) => number, tools: number): Plugin[] =>
  list.map((plugin, index) => ({ plugin, index, place: pluginStanding(holding(plugin), tools) }))
    .sort((first, second) => first.place - second.place || first.index - second.index).map(entry => entry.plugin);
