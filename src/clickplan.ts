// What one click on an item page does, and what its Undo puts back. The page sends the changes (app.ts applyClick); these
// decide them, read their result, and plan the Undo, without touching the page.
import type { Change, DestinationResult, HarnessId, HistoryEvent, SwitchProblem } from './types.ts';
import { andList } from './words.ts';

/**
 * What a click needs to know of an item: where it has copies, whether it is synced, the tools it is not synced to (`off`: those
 * left out, and for an agent those an Off holds, Rule A in historyrules.ts; not the Off switch itself), and where each tool's own
 * switch has it off (`disabled`).
 */
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

/** The kinds of item a page shows. */
export type ItemKind = 'skills' | 'mcp' | 'agents';

/**
 * Whether a tool has a switch of its own for this kind of item: every tool, for skills and MCP servers (skillswitch.ts,
 * mcpswitch.ts); none, for a person's own agents. The one question Off asks of each tool.
 */
export const hasSwitch = (kind: ItemKind, _tool: string) => kind !== 'agents';

/**
 * Off everywhere: each tool it is on in turns it off with its own switch (`disable`). A tool with no switch for it has its copy
 * removed, kept in History (`remove`), when the setting allows (`removeWhenNoSwitch`); otherwise it is left as it is, still on
 * (`stays`). A tool whose switch file can't be used is left on too (`held`): never removed to get round it. The rest still turn off.
 */
export function offPlan(item: Switchable, tools: readonly string[], kind: ItemKind, removeWhenNoSwitch: boolean): { disable: string[]; remove: string[]; stays: string[]; held: string[] } {
  const on = tools.filter(tool => (item.copies[tool] !== undefined || getsCopy(item, tool, tools)) && !item.disabled?.includes(tool) && !item.cannot?.[tool]);
  const switched = on.filter(tool => hasSwitch(kind, tool)), unswitched = on.filter(tool => !hasSwitch(kind, tool));
  // A tool still waiting for its copy has none to remove: once the others are off, sync gives it none.
  const removable = unswitched.filter(tool => item.copies[tool] !== undefined);
  return { disable: switched.filter(tool => !item.switchProblem?.[tool]), held: switched.filter(tool => item.switchProblem?.[tool]),
    remove: removeWhenNoSwitch ? removable : [], stays: removeWhenNoSwitch ? [] : removable };
}

/** What an agent's line needs to know of it, besides what any click does (Switchable). */
export interface AgentLine extends Switchable { oneWay?: { from: string }; stopped?: readonly string[]; limits?: Partial<Record<string, string>>; heldOff?: readonly { tool: string; source?: string }[] }
/**
 * What an agent's line in its opened row offers for one tool, decided once (matrix.ts agentToolControls draws it):
 * - 'stopped': a one-way copy that stopped updating (edited there); its switch gives it the source's copy again;
 * - 'waits': an Off holds it and its one-way source too, so it has no switch until the source is back (agents.ts waitsForSource);
 * - 'off': an Off holds it (Rule A); its switch puts the kept copy back, or, `turnedUp`, turns it on with the copy that turned up;
 * - 'left-out': left out of sync; Sync here (`has`, a copy of its own) or its switch takes it back in;
 * - 'on': its switch turns it off there, by the same rule as Off everywhere (offPlan for this one tool); `whole`: it is the
 *   one-way source, whose Off is the whole agent's;
 * - 'no-switch': on, and Settings keeps a tool's copy when it is turned off (that same rule leaves it on);
 * - none: nothing here to switch (no copy, nothing held).
 */
export type AgentToolControl = { is: 'stopped' } | { is: 'waits'; source: string } | { is: 'off'; turnedUp: boolean } | { is: 'left-out'; has: boolean } | { is: 'on'; whole: boolean } | { is: 'no-switch' };
export function agentToolControl(item: AgentLine, tool: string, removeWhenNoSwitch: boolean): AgentToolControl | undefined {
  const source = item.oneWay?.from, has = item.copies[tool] !== undefined;
  if (source && item.managed && item.stopped?.includes(tool) && !item.off.includes(tool)) return { is: 'stopped' };
  const held = item.heldOff?.find(entry => entry.tool === tool);
  if (held) return held.source ? { is: 'waits', source: held.source } : { is: 'off', turnedUp: has };
  if (item.managed && item.off.includes(tool)) return { is: 'left-out', has };
  if (!has) return undefined;
  if (!offPlan(item, [tool], 'agents', removeWhenNoSwitch).remove.length) return { is: 'no-switch' };
  return { is: 'on', whole: item.managed && source === tool && Object.keys(item.limits ?? {}).length > 0 };
}

/** Each tool left on, with its reason, the tools with the same reason together ("Still on in Codex and Pi: …"). */
export function stillOn(item: Switchable, held: readonly string[], name: (tool: string) => string, reason: (problem: SwitchProblem) => string): string | undefined {
  const byReason = new Map<string, string[]>();
  for (const tool of held) { const why = reason(item.switchProblem![tool]!); byReason.set(why, [...(byReason.get(why) ?? []), tool]); }
  return byReason.size ? [...byReason].map(([why, tools]) => `Still on in ${andList(tools.map(name))}: ${why}`).join(' ') : undefined;
}

/** A result that left something undone: failed, or held for a reason (waiting for a choice of copy, or for Write to Claude Code, is none). */
export const keptBack = (entry: DestinationResult) => entry.outcome === 'failed' || (entry.outcome === 'held' && !entry.differs && !entry.waits);

/**
 * A click's own results, out of a pass that may have done more (with Sync on, every click is a full pass), and what they say:
 * whether it did anything, a hold on the whole item (`refusal`; its `unchanged` says the click did nothing at all), whether
 * something failed, the tools where it failed or was held (`notIn`), and whether its copies differ (waiting for a choice).
 * Neither copies that differ nor Claude Code waiting for its Write step is a failure.
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
