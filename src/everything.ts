// Synchronize everything, a home's standing rule (library.ts FOUND; librarypass.ts takeInByRule takes found items in while it is
// on): the one place it is switched (setSyncEverything), and the one Undo of switching it on. The rule is kept in the home's sync
// record (share.ts SyncRecord syncEverything), absent until it is first answered: first setup asks then (firstsetup.ts), and
// Settings has the row that switches it. Each switch is a History entry (types.ts HistoryEvent 'everything'):
//
//   entry                                        action    offered while (historyactions.ts everythingAction)
//   switched on                                  Undo      it would switch the rule off (no switch came after it) or take
//                                                          something back
//   switched off                                 none: the Settings row is the way back (a first answer of No has no entry:
//                                                nothing was on)
//   a switch-on's Undo (`undo`: what it did)     Restore   one of the items it took back can be restored
//
// The one Undo takes back what the rule took in since its switch-on, found from History itself (historyactions.ts everythingPlan:
// the `sync-everything` take-ins after it, up to the next switch), whichever pass took each in: nothing is stored to mark them.
// Each goes by its own Undo, the click History runs for it alone, all of a kind in one pass (librarypass.ts restoreAll), so each
// leaves a tombstone the rule never takes in by itself again (library.ts FOUND). Each whose own Undo is no longer offered is left
// in and named (historyactions.ts TakeInHeld), as is each copy chosen meanwhile, a click with its own `chosen` entry and Undo. The
// Undo's own entry says what it did, last, once it is done; a crash before then leaves the switch-on's Undo offered, and the next
// click finishes it. Its Restore switches the rule on again (where the Undo switched it off) and runs each item's own Restore.
import { randomUUID } from 'node:crypto';
import { agentKind } from './agents.ts';
import { appendHistory, clock, readHistory, replaceHistory } from './history.ts';
import { everythingAction, everythingPlan, libraryEntry, type LeftIn } from './historyactions.ts';
import type { LibraryItem } from './library.ts';
import { restoreAll, type Kind, type Seen } from './librarypass.ts';
import { serverKind } from './servers.ts';
import { gateRefusal, newRecord, readRecord, remember, saveRecord, syncGate, writeAccess, type ShareContext, type SyncRecord } from './share.ts';
import { skillKind } from './skills.ts';
import type { ApplyResult, DestinationResult, HarnessId, HistoryEvent } from './types.ts';

const entry = (context: ShareContext, everything: NonNullable<HistoryEvent['everything']>): HistoryEvent => ({
  id: randomUUID(), at: new Date(clock(context)).toISOString(), key: 'home:everything', item: 'Synchronize everything', kind: 'everything', everything, losers: [], orderProved: true,
});

/** Why nothing may be written in this home now (preview only, another build's, a damaged record, one waiting for Resume), if so. */
async function cannotWrite(context: ShareContext): Promise<string | undefined> {
  const access = await writeAccess(context);
  return access.allowed ? gateRefusal(await syncGate(context)) : access.reason;
}

/**
 * Turns the rule on or off. A switch from off (or never answered) to on, and from on to off, is told to History first, then the
 * record is saved; a first answer of off (first setup's No) is stored with no entry, since nothing was on. Nothing is taken in
 * here: the next pass of the whole home (the background pass, or Sync once) takes in what it finds then. A home with no sync record
 * gets one, as the first click makes it. `answering`: first setup's question, refused once the home has an answer (given in another
 * window, say). Refused, in plain words, where a pass may not write.
 */
export async function setSyncEverything(context: ShareContext, on: boolean, answering = false): Promise<{ stopped?: string }> {
  const refused = await cannotWrite(context);
  if (refused) return { stopped: refused };
  const record = (await readRecord(context.home)).record ?? newRecord(context);
  if (answering && record.syncEverything !== undefined) return { stopped: `This home was asked already: Synchronize everything is ${record.syncEverything ? 'on' : 'off'}. Settings › This home can change it.` };
  await saveRule(context, record, on);
  return {};
}

/**
 * Saves the rule in the home's record: a switch from off (or never answered) to on, or from on to off, told to History first
 * (`told`: false for the one Undo, whose own entry says it), returned. A home with no record yet is remembered as this build's.
 */
async function saveRule(context: ShareContext, record: SyncRecord, on: boolean, told = true): Promise<HistoryEvent | undefined> {
  if (record.syncEverything === on) return undefined;
  const said = told && (on || record.syncEverything) ? entry(context, { on }) : undefined;
  if (said) await appendHistory(context, [said]);
  const first = (await syncGate(context)).state === 'first-setup';
  await saveRecord(context.home, { ...record, syncEverything: on });
  if (first) await remember(context, record.generation);
  return said;
}


/** Each library's items now, and the item an entry is about (historyactions.ts libraryEntry), deleted or not. */
async function itemsNow(context: ShareContext) {
  const items = { skills: (await skillKind.open(context)).library.items, mcp: (await serverKind.open(context)).library.items, agents: (await agentKind.open(context)).library.items };
  return (about: HistoryEvent): LibraryItem | undefined => { const at = libraryEntry(about); return at && items[at.kind][at.key]; };
}
/**
 * Each of these entries' own History action, the click History runs for it alone, one pass per kind (librarypass.ts restoreAll):
 * what they did, and which entry undid which.
 */
async function ownActions(context: ShareContext, tools: HarnessId[], entries: HistoryEvent[]) {
  const results: DestinationResult[] = [], undid = new Map<string, string>();
  let writes = 0;
  for (const [page, kind] of [['skills', skillKind], ['mcp', serverKind], ['agents', agentKind]] as const) {
    const ids = entries.filter(about => libraryEntry(about)?.kind === page).map(about => about.id);
    if (!ids.length) continue;
    const done = await restoreAll(kind as Kind<unknown, Seen>, context, tools, ids);
    results.push(...done.results);
    writes += done.writes;
    for (const [id, by] of done.undid) undid.set(id, by);
  }
  return { results, writes, undid };
}

/** A Synchronize everything entry's action (historyactions.ts everythingAction says which, and whether it is offered). */
export async function everythingUndo(context: ShareContext, tools: HarnessId[], eventId: string): Promise<ApplyResult> {
  const refused = await cannotWrite(context);
  if (refused) return { stopped: refused, results: [], harnessWrites: 0 };
  const history = await readHistory(context), event = history.find(each => each.id === eventId), itemOf = await itemsNow(context);
  const action = event && everythingAction(event, history, itemOf, tools);
  if (!action) return { stopped: 'That change has nothing left to undo.', results: [], harnessWrites: 0 };
  const did = action.label === 'Undo' ? await takeBack(context, tools, event, history, itemOf) : await putBack(context, tools, event, history);
  return { results: did.results, harnessWrites: did.writes, made: did.made };
}

/**
 * The one Undo of a switch-on: the rule off (where no switch came after it), each take-in everythingPlan finds taken back by its
 * own Undo, then the Undo's entry, saying what it did, with the switch-on marked undone by it. A take-in refused meanwhile (it
 * changed between the plan and its Undo) is left in, as changed.
 */
async function takeBack(context: ShareContext, tools: HarnessId[], switchOn: HistoryEvent, history: HistoryEvent[], itemOf: (about: HistoryEvent) => LibraryItem | undefined) {
  const plan = everythingPlan(switchOn, history, itemOf, tools), { record } = await readRecord(context.home);
  if (plan.switchOff && record) await saveRule(context, record, false, false);
  const { results, writes, undid } = await ownActions(context, tools, plan.takeBack);
  const tookBack = plan.takeBack.flatMap(takeIn => (undid.has(takeIn.id) ? [undid.get(takeIn.id)!] : []));
  const left: LeftIn[] = [...plan.left, ...plan.takeBack.filter(takeIn => !undid.has(takeIn.id)).map(takeIn => ({ item: takeIn.item, why: 'changed' as const }))];
  const undo = entry(context, { on: (await readRecord(context.home)).record?.syncEverything === true, undo: { switchedOff: plan.switchOff, tookBack, left, keptIn: plan.keptIn } });
  await markDone(context, switchOn.id, undo.id, undo);
  return { results, writes, made: [undo.id] };
}

/**
 * The Restore of that Undo: the rule on again where the Undo switched it off (a switch-on entry of its own), then each item it
 * took back that can be restored, by its own Restore. The Undo's entry is marked done by the first entry this made.
 */
async function putBack(context: ShareContext, tools: HarnessId[], undo: HistoryEvent, history: HistoryEvent[]) {
  const { record } = await readRecord(context.home);
  const switched = undo.everything!.undo!.switchedOff && record ? await saveRule(context, record, true) : undefined;
  // Each item's own Restore, passed over for one with nothing left to restore (restored, or added again, since).
  const { results, writes, undid } = await ownActions(context, tools, history.filter(each => undo.everything!.undo!.tookBack.includes(each.id)));
  const made = [...(switched ? [switched.id] : []), ...undid.values()];
  if (made.length) await markDone(context, undo.id, made[0]);
  return { results, writes, made };
}

/** Marks an entry done (`undoneBy`) by the entry `by`, with `appended` (that entry, new) added in the same write. */
async function markDone(context: ShareContext, id: string, by: string, appended?: HistoryEvent) {
  const history = [...await readHistory(context), ...(appended ? [appended] : [])];
  const done = history.find(each => each.id === id);
  if (done) done.undoneBy = by;
  await replaceHistory(context, history);
}
