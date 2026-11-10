// Where an item goes in a list: what Central Knot manages first, then what some tool has and uses, then what no tool uses.
// Someone moving an item from one tool to another finds it without scrolling past what nothing loads.

/**
 * What decides an item's place: who has a copy, where the tool's own switch turned it off, which tools have it through an
 * installed plugin instead (and whether that plugin is off there), and whether it is managed.
 */
export interface Placed { managed: boolean; copies: Partial<Record<string, unknown>>; disabled?: string[]; plugin?: Partial<Record<string, { off?: true }>> }

/**
 * 0: managed, and some tool uses it. 1: unmanaged, and some tool uses it. 2: no tool uses it, managed or not: every one of
 * `tools` that has a copy has it disabled, and every one that has it through a plugin has that plugin turned off.
 */
export function standing(item: Placed, tools: readonly string[]): 0 | 1 | 2 {
  const used = tools.some(tool => (item.copies[tool] !== undefined ? !item.disabled?.includes(tool) : !!item.plugin?.[tool] && !item.plugin[tool]!.off));
  return !used ? 2 : item.managed ? 0 : 1;
}

/** By name, a leading dot aside (".hidden" sorts with the h's). */
export const byKey = (first: { key: string }, second: { key: string }) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, ''));
