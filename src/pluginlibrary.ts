// A plugin's skills, agents and MCP servers as library items in Pi and OpenCode, which have no plugin installer (library.ts A
// PLUGIN: the table's rows that differ for a plugin, decided by SourceSeen `plugin`). This module owns:
// - the plugin's read (readPlugin): its files as catalogdetail.ts pluginFiles reads them from the marketplace's copy
//   (marketplaces.ts locate, never a tool's installed copy), made into one SourceRead per kind by the one reader of a plugin's
//   items (atlink.ts pluginItems, its `marketplace` route), and whether each kind was read whole;
// - running it (runItems): each kind's pass (sources.ts sourceKinds) with that read and the clicks the plugin's switch makes on
//   its items, one pass per kind, as a profile switch makes them; and its Undo (itemsBack);
// - what the Plugins page shows of them (itemsView: "Its items", and "has it" in each tool), from one look at the home that every
//   plugin of a view shares (lookAtKinds), with why none of them is on in such a tool, which the run's report says too
//   (pluginstatus.ts notInWhy).
// When a plugin is read: at a click that brings it into Pi or OpenCode (On, Add, a tool's box ticked), at its Update and
// Update all, and at the automatic updates' check, for a plugin with items (withItemsOf) or a tool new here (marketplaces.ts);
// Off and a box unticked only click. A plugin whose parts from before the library wait to be moved takes this route
// only once they are (pluginstatus.ts waitsToMove). Kept elsewhere: the table (library.ts), the held answer in the tools with an
// installer (plugins.ts pluginHolds), the switch's table (pluginrecord.ts owedTo), and the let-go of an item changed here, in
// every pass (librarypass.ts letGo).
// Known miss: a skill keyed by its folder (library.ts A SOURCE, the two key rules) whose SKILL.md names it otherwise is loaded
// by Pi and OpenCode under that name, so it can meet a skill of that name there unmarked, and through a Git link is a second item.
import { pluginItems, wasRead } from './atlink.ts';
import type { PluginFiles } from './catalogdetail.ts';
import { fromLinkSinceTakeIn, sourceAnswers, wantedIn, type ItemKind, type LibraryItem } from './library.ts';
import { copiesOf, lookFor, type KindLibrary, type SourceRead } from './librarypass.ts';
import type { PluginDone, PluginOp } from './pluginplan.ts';
import type { PluginEntry } from './pluginrecord.ts';
import { takesPlugins } from './presence.ts';
import type { ShareContext } from './share.ts';
import { pluginLink } from './sourcelink.ts';
import { sourceKinds, type SourceKind } from './sources.ts';
import { recordedIds } from './sourcestore.ts';
import type { Change, HarnessId, PassResult, PluginItemLine, PluginItemsView, SyncNotice } from './types.ts';
import { harnessIds } from './harnesses.ts';
import { notInWhy, type ItemOut } from './pluginstatus.ts';
import { toolNames } from './words.ts';

/** The managed tools a plugin's items go to as library items: those with no plugin installer (Pi, OpenCode). */
export const itemTools = (tools: readonly HarnessId[]) => tools.filter(tool => !takesPlugins(tool));

/** One item a plugin's switch put back by its Undo: as it was before the click (one the click made: Off). */
export interface ItemState { kind: ItemKind; key: string; on: boolean; except: HarnessId[] }

// ---------- The read ----------

/**
 * A plugin's files read as one SourceRead per kind (library.ts A PLUGIN): each name with its content, or why it can't be read
 * or is left out. A kind is read whole as a link's kind is (library.ts "Read whole"; atlink.ts wasRead): something in the plugin
 * was read (a plugin's folder missing from the marketplace's copy reads as empty, so it is not), its files left nothing of that
 * kind unread (PluginFiles `unread`), and every item of it was read. `outOf`: the tools a name it
 * makes is kept out of (pluginOutOf). `commitAt`: when its marketplace was read.
 */
export async function readPlugin(files: PluginFiles, entry: PluginEntry, commitAt: string, recorded: ReadonlySet<string>, outOf: HarnessId[]): Promise<SourceRead<unknown>[]> {
  // A plugin that is one skill at its root is that skill, named by the plugin (as each tool's installed copy keys it: pluginrows.ts pluginItemKey).
  const read = await pluginItems(files, files.folder, entry.plugin, 'marketplace');
  const any = Object.values(read).some(each => each.items.some(wasRead));
  return sourceKinds().map((kind): SourceRead<unknown> => {
    const { items, unread } = read[kind.kind.kind], names: SourceRead<unknown>['names'] = new Map();
    for (const item of items) names.set(item.key, 'unreadable' in item ? { unreadable: item.unreadable } : { name: item.name, hash: item.hash, content: item.content, own: item.own });
    const whole = any && !unread && items.every(wasRead), link = pluginLink(entry.plugin, entry.marketName);
    return { id: entry.id, link, commitAt, kind: kind.kind.kind, mergeWith: kind.kind.merge, whole, names, recorded, plugin: { on: entry.on, outOf } };
  });
}

/** Each kind's items linked to the plugin, in each kind's library as given. */
type Linked = { kind: ItemKind; item: LibraryItem };
const linkedIn = (libraries: { kind: ItemKind; library: KindLibrary }[], id: string): Linked[] =>
  libraries.flatMap(({ kind, library }) => Object.values(library.items).filter(item => item.source === id && !item.deleted).map(item => ({ kind, item })));
/** Each kind's items linked to the plugin, as the record holds them now. */
async function linkedItems(context: ShareContext, id: string): Promise<Linked[]> {
  return linkedIn(await Promise.all(sourceKinds().map(async kind => ({ kind: kind.kind.kind, library: (await kind.kind.open(context)).library }))), id);
}

/**
 * The plugins worth reading for the page: each with an item linked to it, or one with a version from it since its last take-in
 * (library.ts fromLinkSinceTakeIn: his own after a let-go, one he deleted), so its page still says why those aren't brought in.
 */
export async function withItemsOf(context: ShareContext, entries: PluginEntry[]): Promise<PluginEntry[]> {
  const items = (await Promise.all(sourceKinds().map(async kind => Object.values((await kind.kind.open(context)).library.items)))).flat();
  return entries.filter(entry => items.some(item => (item.source === entry.id && !item.deleted) || fromLinkSinceTakeIn(item, pluginLink(entry.plugin, entry.marketName))));
}

/**
 * How many items linked to the plugin are wanted in a tool with no installer (none in one with an installer): the one place
 * "has it" there is worked out, one or more (pluginrecord.ts); the page reads it from itemsView (pluginstatus.ts itemsIn).
 */
const onIn = (linked: Linked[], tool: HarnessId) => (takesPlugins(tool) ? 0 : linked.filter(({ item }) => wantedIn(item, tool)).length);

/**
 * The tools a name the plugin makes is kept out of (library.ts A PLUGIN): each managed tool with no installer where the plugin
 * is not now (no item linked to it wanted there), but those a click brings it into (`into`); and each the entry keeps it out
 * of, managed or not, so a tool that appears later gets none of it (partsmigrate.ts keeps a moved item out of them too). The
 * step adds each tool with a copy of that name (librarypass.ts fromSourceStep).
 */
const pluginOutOf = (entry: PluginEntry, tools: readonly HarnessId[], linked: Linked[], into: readonly HarnessId[]) =>
  [...new Set([...itemTools(entry.except), ...itemTools(tools).filter(tool => !into.includes(tool) && !onIn(linked, tool))])];

// ---------- Running it ----------

/**
 * What a plugin's switch asks of its items: every item On (`on`: its On and Add) or Off (`off`: its Off, and an untick that
 * leaves the plugin Off); a tool's box ticked lets that tool in, in each item's `except` alone, and turns each item On (`on` and
 * `letIn`; an item that comes On from Off is kept out of every other tool: clickOn); a box unticked keeps that tool out (`outOf`). Or a read alone: the page's Update (`click`, which brings back a name of its own he
 * deleted), the automatic check, and its install in a tool new here (`bring`, which counts as where the plugin is).
 * `into`, `outOf` and `read` name the tools its result reports on.
 */
export type ItemsAsk = { into: HarnessId[]; on?: true; letIn?: true } | { outOf: HarnessId[]; off?: true } | { read: HarnessId[]; bring?: true; click?: true };

/**
 * A plugin's switch on its items (pluginrecord.ts rows 5 and 10, Update, a tool new here), one kind at a time: the plugin's
 * read first where the ask has one, then each item linked to it after that read clicked (clickOn), taken only while it is still
 * linked (types.ts Change forPlugin). Answers one report per tool named, and the items' states before, for the Undo.
 */
export async function runItems(context: ShareContext, tools: HarnessId[], entry: PluginEntry, ask: ItemsAsk, files: Files, op: Op): Promise<Ran & { back?: ItemState[] }> {
  const before = await linkedItems(context, entry.id), named = 'into' in ask ? ask.into : 'outOf' in ask ? ask.outOf : ask.read;
  const brought = 'into' in ask || ('read' in ask && ask.bring) ? named : [];
  const outOf = pluginOutOf(entry, tools, before, brought), recorded = (await recordedIds(context.home)).ids;
  const read = files.files && !('outOf' in ask) ? await readPlugin(files.files, entry, files.commitAt, recorded, outOf) : [];
  // A click that turns its items On (its On, Add, a box ticked) brings back a name of its own he deleted; the background never does (library.ts A PLUGIN).
  const reads = ('into' in ask && ask.on) || ('read' in ask && ask.click) ? read.map(each => ({ ...each, bringBack: new Set(each.names.keys()) })) : read;
  const results: Passed[] = [];
  for (const kind of sourceKinds()) {
    const read = reads.find(each => each.kind === kind.kind.kind), passed = (result: PassResult) => results.push({ kind: kind.kind.kind, result });
    // The read first, so the clicks reach what it made or linked again (a name linked again after an Undo, say).
    if (read) passed(await kind.apply(context, tools, [], { source: read }));
    if (results.at(-1)?.result.stopped) break;
    // A tool let in stays out of each item it has a copy of its own of (Central Knot never applied it there): never written over.
    const disk = 'into' in ask && ask.letIn ? (await lookFor(kind.kind, context, tools)).look.disk.byKey : undefined;
    const own = (item: LibraryItem) => (tool: HarnessId) => !!disk?.get(item.key)?.[tool] && item.applied[tool] === undefined;
    const linked = 'read' in ask ? [] : (await linkedItems(context, entry.id)).filter(each => each.kind === kind.kind.kind);
    if (linked.length) passed(await kind.apply(context, tools, linked.map(({ item }) => clickOn(ask, item, own(item), entry.id)), { only: new Set() }));
    if (results.at(-1)?.result.stopped) break;
  }
  const after = await linkedItems(context, entry.id);
  const back = after.flatMap(({ kind, item }): ItemState[] => {
    const was = before.find(each => each.kind === kind && each.item.key === item.key)?.item;
    if (was && was.on === item.on && was.except.join() === item.except.join()) return [];
    return [{ kind, key: item.key, on: !!was?.on, except: was?.except ?? item.except }];
  });
  // Why none is on in a tool, from what this run knows (no other look): its names not brought in (an unreadable one in the read,
  // his own or another source's by the pass's answer), and an item made now and kept out had a copy of that name there.
  const sourced = results.flatMap(({ kind, result }) => (result.sourced ?? []).map(said => ({ kind, said }))), made = new Set(sourced.filter(({ said }) => said.answer === 'make').map(({ said }) => said.name));
  const lines: PluginItemLine[] = [...read.flatMap(each => [...each.names].flatMap(([key, name]) => ('unreadable' in name ? [{ kind: each.kind, key, name: key, state: 'not-brought' as const, why: name.unreadable }] : []))),
    ...sourced.flatMap(({ kind, said }) => (said.answer === 'differs' || said.answer === 'another' ? [{ kind, key: said.name, name: said.name, state: 'not-brought' as const, why: said.answer === 'another' ? ANOTHER : YOURS }] : []))];
  const why = (tool: HarnessId) => files.problem ?? `Nothing of ${entry.plugin} is on in ${toolNames[tool]}. ${notInWhy(tool, entry.plugin, outsIn(tool, lines, after, item => item.except.includes(tool) && made.has(item.name))).join(' ')}`;
  const done = named.map((tool): PluginDone => ({ ...op, tool, report: reportIn(tool, ask, before, after, results, why(tool), !!files.problem) }));
  return { ...ran(done, results), ...(back.length ? { back } : {}) };
}
type Op = Pick<PluginOp, 'source' | 'marketName' | 'plugin' | 'action'>;
/** A plugin's files as its marketplace's copy gives them now (none: not listed, or unreadable, `problem` says why), and when that copy was read. */
type Files = { files?: PluginFiles; commitAt: string; problem?: string };
/** What a run on a plugin's items answers: each tool's report, why it stopped, and each kind's notices for its page. */
type Ran = { done: PluginDone[]; stopped?: string; notices: { kind: ItemKind; notices: SyncNotice[] }[] };
type Passed = { kind: ItemKind; result: PassResult };
const ran = (done: PluginDone[], results: Passed[]): Ran => {
  const stopped = results.find(({ result }) => result.stopped)?.result.stopped;
  return { done, notices: results.map(({ kind, result }) => ({ kind, notices: result.notices ?? [] })), ...(stopped ? { stopped } : {}) };
};

/** The click a plugin's switch makes on one item linked to it (ItemsAsk); `own`: whether a tool has a copy of its own of it. */
function clickOn(ask: ItemsAsk, item: LibraryItem, own: (tool: HarnessId) => boolean, id: string): Change {
  const on = 'on' in ask ? true : 'off' in ask ? false : item.on;
  // A tick turns On only what it brings into its tool (pluginrecord.ts A TOOL'S BOX): an item Off till now is in no tool, so it
  // is kept out of every other one.
  const reach = item.on ? item.except : [...new Set([...item.except, ...itemTools(harnessIds)])];
  const except = 'into' in ask && ask.letIn ? reach.filter(tool => !ask.into.includes(tool) || own(tool))
    : 'outOf' in ask && !ask.off ? [...new Set([...item.except, ...ask.outOf])] : item.except;
  return { key: item.key, on, except, forPlugin: id };
}

/**
 * One tool's report of a run on a plugin's items: what it has of them now, and whether the run changed what it has. `why`: why
 * none is on there, the plugin's files unreadable (`unread`) or each item's reason (notInWhy).
 */
function reportIn(tool: HarnessId, ask: ItemsAsk, before: Linked[], after: Linked[], results: Passed[], why: string, unread: boolean): PluginDone['report'] {
  const on = onIn(after, tool), has = on > 0, name = toolNames[tool];
  const changed = has !== onIn(before, tool) > 0 || wroteIn(results, tool);
  const said = `${on} of its ${after.length} items ${on === 1 ? 'is' : 'are'} on in ${name}.`;
  const report = (outcome: PluginDone['report']['outcome'], message = said) => ({ tool, outcome, message, runs: [], changed });
  if ('outOf' in ask) return report(has ? 'failed' : 'uninstalled');
  if (!has && 'into' in ask) return report('held', why);
  if (unread && 'read' in ask) return report('failed', why);
  return report('read' in ask && !ask.bring ? 'updated' : 'installed', unread ? `${said} ${why}` : said);
}

/**
 * Why each of a plugin's items is not on in a tool with no installer, the one place the run's report and the page ask (both say
 * it by pluginstatus.ts notInWhy): a name of its `lines` not brought in (his own, another source's, unreadable) or deleted, and
 * each item `linked` to it not wanted there: off on its own row, or kept out of it (`own`: the tool has a copy of its own of that
 * name, never written over).
 */
type Out = { name: string; kind: ItemKind; out: ItemOut };
function outsIn(tool: HarnessId, lines: PluginItemLine[], linked: Linked[], own: (item: LibraryItem) => boolean): Out[] {
  return [...lines.flatMap(({ name, kind, state, why }): Out[] => (state === 'deleted' ? [{ name, kind, out: 'deleted' }]
    : state === 'not-brought' ? [{ name, kind, out: why === YOURS ? 'yours' : why === ANOTHER ? 'another' : { cannot: why! } }] : [])),
  ...linked.filter(({ item }) => !wantedIn(item, tool)).map(({ kind, item }): Out => ({ name: item.name, kind, out: !item.on ? 'off' : own(item) ? 'own' : 'kept' }))];
}
const wroteIn = (results: Passed[], tool: HarnessId) => results.some(({ result }) => result.results.some(each => each.harness === tool && (each.outcome === 'written' || each.outcome === 'removed')));

/**
 * The Undo of a run on a plugin's items (runItems' `back`): each item as it was, by the same clicks, taken only while it is
 * still linked to the plugin; one the run made goes Off, linked, with its versions (the plugin's next On turns it On again).
 */
export async function itemsBack(context: ShareContext, tools: HarnessId[], id: string, states: ItemState[], op: Op, named: HarnessId[]): Promise<Ran> {
  const before = await linkedItems(context, id), results: Passed[] = [];
  for (const kind of sourceKinds()) {
    const clicks = states.filter(state => state.kind === kind.kind.kind).map((state): Change => ({ key: state.key, on: state.on, except: state.except, forPlugin: id }));
    if (clicks.length) results.push({ kind: kind.kind.kind, result: await kind.apply(context, tools, clicks, { only: new Set() }) });
  }
  const after = await linkedItems(context, id);
  const done = named.map((tool): PluginDone => {
    const has = onIn(after, tool) > 0, changed = has !== onIn(before, tool) > 0 || wroteIn(results, tool);
    return { ...op, tool, report: { tool, outcome: has ? 'installed' : 'uninstalled', message: `Its items are as they were in ${toolNames[tool]}.`, runs: [], changed } };
  });
  return ran(done, results);
}

// ---------- The page ----------

/** Each kind's look at the home (librarypass.ts lookFor), made once for a whole Plugins view and read by every plugin's itemsView. */
export const lookAtKinds = (context: ShareContext, tools: readonly HarnessId[]) =>
  Promise.all(sourceKinds().map(async kind => ({ kind, look: (await lookFor(kind.kind, context, tools)).look })));
export type KindLooks = Awaited<ReturnType<typeof lookAtKinds>>;

/**
 * What the Plugins page shows of a plugin's items (types.ts PluginItemsView), from the same table the pass carries out: each
 * item linked to it, with its state where it isn't plain (Off; an update ready; removed by the plugin's update); each name it
 * has that is not brought in, with why; how many are on in each tool (onIn); and whether Update has something to do (`ready`). `reads`: none where the plugin can't
 * be read now (`problem` says why); then only its linked items are listed. `looks`: the home as lookAtKinds read it.
 */
export function itemsView(tools: readonly HarnessId[], looks: KindLooks, entry: PluginEntry, reads: SourceRead<unknown>[] | undefined, problem?: string): PluginItemsView {
  const lines: PluginItemLine[] = [], linked = linkedIn(looks.map(({ kind, look }) => ({ kind: kind.kind.kind, library: look.library })), entry.id);
  const on = Object.fromEntries(itemTools(tools).map(tool => [tool, onIn(linked, tool)]));
  let ready = false;
  for (const { kind, look } of looks) {
    const items = look.library.items, read = reads?.find(each => each.kind === kind.kind.kind);
    const answers = read ? sourceAnswers(items, read, read.recorded, { copies: item => copiesOf(look, item) }) : new Map();
    for (const [key, answer] of answers) {
      const item = items[key], there = read!.names.get(key), name = there && 'name' in there ? there.name : item?.name ?? key;
      if (['update', 'make', 'drop'].includes(answer)) ready = true;
      lines.push(lineOf(kind, key, name, item, answer, there && 'unreadable' in there ? there.unreadable : undefined));
    }
    for (const item of Object.values(items)) {
      if (answers.has(item.key) || item.deleted) continue;
      if (item.source === entry.id) lines.push(lineOf(kind, item.key, item.name, item, 'nothing'));
      else if (read?.whole && !item.on && !item.source && fromLinkSinceTakeIn(item, read.link)) lines.push({ kind: kind.kind.kind, key: item.key, name: item.name, state: 'removed' });
    }
  }
  // Where a plugin that is On is wanted and none of its items is on: why (outsIn; the page looked at each tool's own copies).
  // Not where a name new to it comes in at its install (a tick, or the automatic updates for a tool new here), nor for a plugin
  // not read now (its problem is said instead).
  const disk = (kind: ItemKind) => looks.find(each => each.kind.kind.kind === kind)!.look.disk.byKey;
  const away = reads && !lines.some(line => line.state === 'new') ? itemTools(tools).filter(tool => entry.on && !entry.except.includes(tool) && !on[tool]).map(tool => {
    const why = outsIn(tool, lines, linked, item => !!disk(linked.find(each => each.item === item)!.kind).get(item.key)?.[tool] && item.applied[tool] === undefined);
    return [tool, { reasons: notInWhy(tool, entry.plugin, why), tickHelps: why.some(({ out }) => out === 'kept' || out === 'off' || out === 'deleted') }] as const;
  }) : [];
  return { lines, on, of: linked.length, ...(ready ? { ready: true as const } : {}), ...(problem ? { problem } : {}), ...(away.length ? { notIn: Object.fromEntries(away) } : {}) };
}

/** A name not brought in, as its line says why: his own item of that name, or another source's. */
const YOURS = 'you have your own', ANOTHER = 'another source has it';
/** One name's line in "Its items", from the table's answer for it (library.ts SourceAnswer). */
function lineOf(kind: SourceKind, key: string, name: string, item: LibraryItem | undefined, answer: string, unreadable?: string): PluginItemLine {
  const base = { kind: kind.kind.kind, key, name };
  if (unreadable) return { ...base, state: 'not-brought', why: unreadable };
  if (answer === 'make') return { ...base, state: 'new' };
  if (answer === 'deleted') return { ...base, state: 'deleted' };
  if (answer === 'differs' || answer === 'another') return { ...base, state: 'not-brought', why: answer === 'another' ? ANOTHER : YOURS };
  return { ...base, state: answer === 'update' ? 'update' : answer === 'drop' ? 'going' : 'linked', on: !!item?.on, except: item?.except ?? [] };
}
