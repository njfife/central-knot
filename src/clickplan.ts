// What one click on an item page does, and what its Undo puts back. The page sends the changes (app.ts applyClick); these
// decide them, read their result, and plan the Undo, without touching the page.
import type { Change, DestinationResult, HarnessId, HistoryEvent, SwitchProblem } from './types.ts';
import { andList } from './words.ts';

/** What a click needs to know of an item: where it has copies, where each tool's switch has it off, and whether it is synced. */
export interface Switchable {
  copies: Partial<Record<string, unknown>>;
  managed: boolean;
  off: readonly string[];
  disabled?: readonly string[];
  cannot?: Partial<Record<string, string>>;
  switchProblem?: Partial<Record<string, SwitchProblem>>;
}

/** A tool with no copy that sync gives one at its next pass: synced there, able to load it, and some tool has a copy to start from. */
export const getsCopy = (item: Switchable, tool: string, tools: readonly string[]) =>
  item.copies[tool] === undefined && item.managed && !item.off.includes(tool) && !item.cannot?.[tool] && tools.some(other => item.copies[other] !== undefined);

/**
 * Off everywhere: each tool it is on in turns it off with its own switch. A tool whose switch file can't be used is left on
 * (`held`), so the rest still turn off.
 */
export function offPlan(item: Switchable, tools: readonly string[]): { disable: string[]; held: string[] } {
  const on = tools.filter(tool => (item.copies[tool] !== undefined || getsCopy(item, tool, tools)) && !item.disabled?.includes(tool) && !item.cannot?.[tool]);
  return { disable: on.filter(tool => !item.switchProblem?.[tool]), held: on.filter(tool => item.switchProblem?.[tool]) };
}

/** Each tool left on, with its reason, the tools with the same reason together ("Still on in Codex and Pi: …"). */
export function stillOn(item: Switchable, held: readonly string[], name: (tool: string) => string, reason: (problem: SwitchProblem) => string): string | undefined {
  const byReason = new Map<string, string[]>();
  for (const tool of held) { const why = reason(item.switchProblem![tool]!); byReason.set(why, [...(byReason.get(why) ?? []), tool]); }
  return byReason.size ? [...byReason].map(([why, tools]) => `Still on in ${andList(tools.map(name))}: ${why}`).join(' ') : undefined;
}

/** A result that left something undone: failed, or held for a reason (waiting for a choice of copy is none). */
export const keptBack = (entry: DestinationResult) => entry.outcome === 'failed' || (entry.outcome === 'held' && !entry.differs);

/**
 * A click's own results, out of a pass that may have done more (with Sync on, every click is a full pass), and what they say:
 * whether it did anything, a hold on the whole item (`refusal`; its `unchanged` says the click did nothing at all), whether
 * something failed, the tools where it failed or was held (`notIn`), and whether its copies differ (waiting for a choice,
 * which is no failure).
 */
export function clickResults(results: DestinationResult[], names: readonly string[]) {
  const own = new Set(names.map(name => name.toLowerCase()));
  const ours = results.filter(entry => own.has(entry.item.toLowerCase()));
  return {
    ours,
    did: ours.some(entry => entry.outcome === 'written' || entry.outcome === 'switched' || entry.outcome === 'removed'),
    refusal: ours.find(entry => entry.outcome === 'held' && !entry.harness && !entry.differs),
    failed: ours.some(keptBack),
    notIn: [...new Set(ours.filter(entry => keptBack(entry) && entry.harness).map(entry => entry.harness!))],
    differs: ours.some(entry => entry.outcome === 'held' && entry.differs),
  };
}

/** An item's record as the page reads it: whether it is synced, and the tools it leaves out. */
export interface Standing { managed: boolean; off: readonly string[] }

const same = (first: Standing, second: Standing) => first.managed === second.managed && [...first.off].sort().join() === [...second.off].sort().join();

/** The items whose record the click changed: their Undo puts the record back where its History entries don't. */
export const recordChanged = (before: Map<string, Standing>, after: Map<string, Standing>) =>
  [...before].filter(([key, was]) => after.has(key) && !same(was, after.get(key)!)).map(([key]) => key);

/**
 * The Undo's History entries in the order they go back: switches and removals first (while the copies they act on are still
 * there), then a copy choice (each copy back in its own tool, with the copies it added), then copies added; newest first.
 */
export function undoOrder(events: HistoryEvent[]): HistoryEvent[] {
  const rank = (event: HistoryEvent) => (event.kind === 'switched' || event.kind === 'removed' ? 0 : event.kind === 'chosen' ? 1 : 2);
  return [...events].sort((first, second) => rank(first) - rank(second) || Date.parse(second.at) - Date.parse(first.at));
}

/**
 * Once the click's History entries are undone: the change that puts each item's record back as it was before the click,
 * for an item whose record is not back yet. Made against the record as it is now (`seenManaged`), so a change since is refused.
 */
export function inverseChanges(keys: readonly string[], before: Map<string, Standing>, now: Map<string, Standing>): Change[] {
  return keys.filter(key => before.has(key) && now.has(key) && !same(before.get(key)!, now.get(key)!))
    .map(key => ({ key, managed: before.get(key)!.managed, off: [...before.get(key)!.off] as HarnessId[], seenManaged: now.get(key)!.managed }));
}
