// Synchronize everything, a home's standing rule (library.ts FOUND; librarypass.ts takeInByRule takes found items in while it is
// on): the one place it is switched (setSyncEverything), and the one Undo of switching it on, with that Undo's Restore
// (everythingEntryAction). The rule is kept in the home's sync record (share.ts SyncRecord syncEverything), absent until it is
// first answered: first setup asks then (firstsetup.ts), and Settings has the row that switches it. Each switch is a History entry
// (types.ts HistoryEvent 'everything'):
//
//   entry                                        action    offered while (historyactions.ts everythingAction)
//   switched on                                  Undo      it would switch the rule off (no switch came after it) or take
//                                                          something back
//   switched off                                 none: the Settings row is the way back (a first answer of No has no entry:
//                                                nothing was on)
//   a switch-on's Undo (`undo`: what it did)     Restore   it can put an item back (historyactions.ts restorePlan)
//
// The one Undo takes back what the rule took in since its switch-on, found from History itself (historyactions.ts everythingPlan:
// the `sync-everything` take-ins after it, up to the next switch), whichever pass took each in: nothing is stored to mark them.
// Each goes by its own Undo, the click History runs for it alone, all of a kind in one pass (librarypass.ts restoreAll), so each
// leaves a tombstone the rule never takes in by itself again (library.ts FOUND). A take-in is taken back only while every place it
// was found in still holds the copy it held then, in a tool still managed (historyactions.ts takeInHeld, which decides its own
// Undo too, on the copies as a pass reads them now); each other is left in and named, as is each copy chosen meanwhile (a click,
// with its own `chosen` entry and Undo). The Undo's own entry says what it did, last, once it is done; a crash before then leaves
// the switch-on's Undo offered, and the next click finishes it.
// Its Restore undoes that Undo: the rule on again where the Undo switched it off, each item it took back that was not added,
// changed or deleted since put back by its own Restore, and the switch-on and those take-ins in force again, so the switch-on's
// Undo takes back exactly what the Restore put back.
import { randomUUID } from 'node:crypto';
import { agentKind } from './agents.ts';
import { appendHistory, clock, readHistory, replaceHistory } from './history.ts';
import { everythingAction, everythingPlan, libraryEntry, restorePlan, type EntryItem, type LeftIn } from './historyactions.ts';
import { itemsNow, restoreAll, type Kind, type Seen } from './librarypass.ts';
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
  const said = told && (on || record.syncEverything) ? entry(context, { ruleOn: on }) : undefined;
  if (said) await appendHistory(context, [said]);
  const first = (await syncGate(context)).state === 'first-setup';
  await saveRecord(context.home, { ...record, syncEverything: on });
  if (first) await remember(context, record.generation);
  return said;
}


/** Each entry's item as History's actions are decided on it: each kind's items and what the managed tools hold of them now (librarypass.ts itemsNow). */
async function entryItems(context: ShareContext, tools: HarnessId[]): Promise<EntryItem> {
  const kinds = { skills: await itemsNow(skillKind, context, tools), mcp: await itemsNow(serverKind, context, tools), agents: await itemsNow(agentKind, context, tools) };
  return about => { const at = libraryEntry(about); return at ? kinds[at.kind].of(about) : { item: undefined, now: { managed: tools, edited: [] } }; };
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

/** A Synchronize everything entry's History action: a switch-on's one Undo, or that Undo's Restore (historyactions.ts everythingAction says which). */
export async function everythingEntryAction(context: ShareContext, tools: HarnessId[], eventId: string): Promise<ApplyResult> {
  const refused = await cannotWrite(context);
  if (refused) return { stopped: refused, results: [], harnessWrites: 0 };
  const history = await readHistory(context), event = history.find(each => each.id === eventId), about = await entryItems(context, tools);
  const action = event && everythingAction(event, history, about);
  if (!action) return { stopped: 'That change has nothing left to undo.', results: [], harnessWrites: 0 };
  const did = action.label === 'Undo' ? await takeBack(context, tools, event, history, about) : await putBack(context, tools, event, history, about);
  return { results: did.results, harnessWrites: did.writes, made: did.made };
}

/**
 * The one Undo of a switch-on: the rule off (where no switch came after it), each take-in everythingPlan finds taken back by its
 * own Undo, then the Undo's entry, saying what it did, with the switch-on marked undone by it. A take-in refused meanwhile (it
 * changed between the plan and its Undo) is left in, as changed.
 */
async function takeBack(context: ShareContext, tools: HarnessId[], switchOn: HistoryEvent, history: HistoryEvent[], about: EntryItem) {
  const plan = everythingPlan(switchOn, history, about), { record } = await readRecord(context.home);
  if (plan.switchOff && record) await saveRule(context, record, false, false);
  const { results, writes, undid } = await ownActions(context, tools, plan.takeBack);
  const itemUndos = plan.takeBack.flatMap(takeIn => (undid.has(takeIn.id) ? [undid.get(takeIn.id)!] : []));
  const left: LeftIn[] = [...plan.left, ...plan.takeBack.filter(takeIn => !undid.has(takeIn.id)).map(takeIn => ({ item: takeIn.item, why: 'changed' as const }))];
  const undo = entry(context, { ruleOn: (await readRecord(context.home)).record?.syncEverything === true, undo: { switchedOff: plan.switchOff, itemUndos, left, keptIn: plan.keptIn } });
  await markDone(context, switchOn.id, undo.id, undo);
  return { results, writes, made: [undo.id] };
}

/**
 * The Restore of that Undo (restorePlan): the rule on again where the Undo switched it off, with no entry of its own; each item it
 * took back that was not added, changed or deleted since, by its own Restore; then the switch-on, and each take-in whose item came
 * back, in force again (their `undoneBy` let go), so the switch-on's Undo takes back what this put back. The Undo's entry is marked
 * done by the first entry this made; each item passed over is said in the results.
 */
async function putBack(context: ShareContext, tools: HarnessId[], undo: HistoryEvent, history: HistoryEvent[], about: EntryItem) {
  const { back, passed } = restorePlan(undo, history, about), { record } = await readRecord(context.home);
  if (undo.everything!.undo!.switchedOff && record) await saveRule(context, record, true, false);
  const { results, writes, undid } = await ownActions(context, tools, back);
  const now = await readHistory(context), restored = new Set(undid.keys());
  for (const each of now) if ((each.undoneBy && restored.has(each.undoneBy)) || each.undoneBy === undo.id) delete each.undoneBy;
  const made = [...undid.values()], mine = now.find(each => each.id === undo.id);
  if (mine && made.length) mine.undoneBy = made[0];
  await replaceHistory(context, now);
  const stays = passed.map((item): DestinationResult => ({ item, outcome: 'held', message: `${item} was added, changed or deleted since the Undo, so it stays as it is.` }));
  return { results: [...results, ...stays], writes, made };
}

/** Marks an entry done (`undoneBy`) by the entry `by`, with `appended` (that entry, new) added in the same write. */
async function markDone(context: ShareContext, id: string, by: string, appended?: HistoryEvent) {
  const history = [...await readHistory(context), ...(appended ? [appended] : [])];
  const done = history.find(each => each.id === id);
  if (done) done.undoneBy = by;
  await replaceHistory(context, history);
}
