// A click's result as an item page reads it (app.ts applyClick): which of a pass's results are the click's own, and what they
// say. Pure: no page.
import type { DestinationResult } from './types.ts';

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
