// Which tools came under Central Knot's management by themselves (installed while the app was closed or while it is open, or
// found again after being away), and how many items the pass that first saw each copied there. The rule, in two sentences: the
// managed tools each pass of the whole home sees are kept per home, whatever Automatic sync is, and a tool managed now that was
// not among them has arrived, so one seen gone and back, its Manage switch still on, arrives again. A home with nothing kept yet
// is seeded silently, from the tools its records name, else (a first setup) from what is managed now; and a tool turned on by
// its Manage switch is kept before its pass (byHand), so it is no arrival: its switch says what it did.
// Kept in main.ts's settings (AppSettings toolsSeen), by main.ts pass (the one caller of observe), `tools:manage` and
// `tools:dismiss-arrival`; the Overview says each arrival until it is dismissed (overview.ts arrivalLines). Each copy that pass put
// there has its own History entry (librarypass.ts logItem). Not here: which tools are managed (presence.ts managedTools).
import { agentKind } from './agents.ts';
import { harnessIds } from './harnesses.ts';
import type { HomePass } from './homepass.ts';
import { serverKind } from './servers.ts';
import type { ShareContext } from './share.ts';
import { skillKind } from './skills.ts';
import type { Arrival, HarnessId } from './types.ts';
import { onlyAllowed, record } from './values.ts';

/** One home's managed tools as the last pass saw them, and the arrivals the Overview says until each is dismissed. */
export interface ToolsSeen { managed: HarnessId[]; arrived: Arrival[] }

/** A home's entry as the settings hold it, or undefined where there is none or it isn't in this shape (a hand edit): it is seeded again. */
export function seenIn(stored: unknown): ToolsSeen | undefined {
  const entry = record(stored);
  if (!entry || !Array.isArray(entry.managed)) return undefined;
  const arrived = (Array.isArray(entry.arrived) ? entry.arrived : []).map(record).flatMap(each => (each && harnessIds.includes(each.tool as HarnessId)
    ? [{ tool: each.tool as HarnessId, ...(typeof each.copied === 'number' ? { copied: each.copied } : {}) }] : []));
  return { managed: onlyAllowed(entry.managed, harnessIds), arrived };
}

/**
 * The home's tools as last seen (`stored`, seenIn), or where none are kept, seeded from its records before any pass changes them:
 * the tools each kind's record names (a folder as a pass last saw it there, a copy applied there), else `managed`.
 */
export async function seenBefore(stored: unknown, context: ShareContext, managed: HarnessId[]): Promise<ToolsSeen> {
  const kept = seenIn(stored);
  if (kept) return kept;
  const named = new Set<string>();
  for (const kind of [skillKind, serverKind, agentKind]) {
    const { library } = await kind.open(context);
    for (const tool of Object.keys(library.folders)) named.add(tool);
    for (const item of Object.values(library.items)) for (const tool of Object.keys(item.applied)) named.add(tool);
  }
  const onRecord = harnessIds.filter(tool => named.has(tool));
  return { managed: onRecord.length ? onRecord : managed, arrived: [] };
}

/**
 * What a pass that saw `managed` leaves kept: each tool not seen before has arrived, with how many items the pass put there
 * where it had none (`copied`; absent where it wrote nothing: `writes` false, Automatic sync off); an arrival whose tool is no
 * longer managed goes, so no line names a tool Central Knot doesn't manage.
 */
export function observe(before: ToolsSeen, managed: HarnessId[], writes: boolean, synced: HomePass['synced']): ToolsSeen {
  const still = before.arrived.filter(arrival => managed.includes(arrival.tool));
  const arrived = managed.filter(tool => !before.managed.includes(tool)).map(tool => (writes ? { tool, copied: copiedTo(tool, synced) } : { tool }));
  return { managed, arrived: [...still, ...arrived] };
}

/** The items a pass put in `tool` where it had none, every kind's (one result per item and tool): not a copy written over, the same already, or held. */
const copiedTo = (tool: HarnessId, synced: HomePass['synced']) => [synced?.skills, synced?.servers, synced?.agents]
  .flatMap(done => done?.results ?? []).filter(result => result.harness === tool && result.outcome === 'written' && !result.replaced).length;

/** A tool turned on by its Manage switch, kept as seen before the pass that brings it into line. */
export const byHand = (seen: ToolsSeen, tool: HarnessId): ToolsSeen => (seen.managed.includes(tool) ? seen : { ...seen, managed: [...seen.managed, tool] });
