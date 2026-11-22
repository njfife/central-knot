// A plugin's skills, agents and MCP servers as library items in Pi and OpenCode, which have no plugin installer (library.ts A
// PLUGIN: the table's rows that differ for a plugin, decided by SourceSeen `plugin`). This module owns:
// - the plugin's read (readPlugin): its files as catalogdetail.ts pluginFiles reads them from the marketplace's copy
//   (marketplaces.ts locate, never a tool's installed copy), made into one SourceRead per kind by the one reader of a plugin's
//   items (atlink.ts pluginItems, its `marketplace` route), and whether each kind was read whole;
// - running it (runItems): each kind's pass (sources.ts sourceKinds) with that read and the clicks the plugin's switch makes on
//   its items, one pass per kind, as a profile switch makes them, or Use the plugin's (library.ts TAKE); and its Undo (itemsBack);
//   with the one-time move of a root skill an earlier build named otherwise (movedFrom, movedTicks: library.ts A PLUGIN, THE MOVE);
// - what the Plugins page shows of them (itemsView: "Its items", and "has it" in each tool), from one look at the home that every
//   plugin of a view shares (lookAtKinds), with why none of them is on in such a tool, which the run's report says too
//   (pluginstatus.ts notInWhy), and each name he has under each tool's box (`clashes`).
// When a plugin is read: at a click that brings it into Pi or OpenCode (On, Add, a tool's box ticked), at its Update and
// Update all, and at the automatic updates' check, for a plugin with items (withItemsOf) or a tool new here (marketplaces.ts);
// Off and a box unticked only click. A plugin whose parts from before the library wait to be moved takes this route
// only once they are (pluginstatus.ts waitsToMove). Kept elsewhere: the table (library.ts), the held answer in the tools with an
// installer (plugins.ts pluginHolds), the switch's table (pluginrecord.ts owedTo), and the let-go of an item changed here, in
// every pass (librarypass.ts letGo).
// Known miss: a skill keyed by its folder, or by its plugin's name at the plugin's root (library.ts A SOURCE, the two key rules),
// whose SKILL.md names it otherwise is loaded by Pi and OpenCode under that name, so it can meet a skill of that name there
// unmarked, and through a Git link is a second item.
import { basename } from 'node:path';
import { pluginItems, wasRead } from './atlink.ts';
import type { PluginFiles } from './catalogdetail.ts';
import { keptBack } from './clickplan.ts';
import { earlierRootName, fromLinkSinceTakeIn, itemKey, sourceAnswers, wantedIn, type ItemKind, type LibraryItem } from './library.ts';
import { copiesOf, lookFor, restoreAll, takeHeld, type KindLibrary, type SourceRead } from './librarypass.ts';
import type { PluginDone, PluginOp } from './pluginplan.ts';
import type { PluginEntry } from './pluginrecord.ts';
import { pluginItemId, pluginItemKey } from './profileplan.ts';
import { profilesNaming } from './profiles.ts';
import { takesPlugins } from './presence.ts';
import type { ShareContext } from './share.ts';
import { pluginLink } from './sourcelink.ts';
import { sourceKinds, type SourceKind } from './sources.ts';
import { recordedIds } from './sourcestore.ts';
import type { Change, HarnessId, PassResult, PluginItemLine, PluginItemsView, SyncNotice, YourName } from './types.ts';
import { harnessIds } from './harnesses.ts';
import { notInWhy, type ItemOut } from './pluginstatus.ts';
import { andList, toolNames } from './words.ts';

/** The managed tools a plugin's items go to as library items: those with no plugin installer (Pi, OpenCode). */
export const itemTools = (tools: readonly HarnessId[]) => tools.filter(tool => !takesPlugins(tool));

/** One item a plugin's switch put back by its Undo: as before the click (one it made: Off); one it took (library.ts TAKE) by its History `entry`'s own Undo. */
export interface ItemState { kind: ItemKind; key: string; on: boolean; except: HarnessId[]; entry?: string }

// ---------- The read ----------

/**
 * A plugin's files read as one SourceRead per kind (library.ts A PLUGIN): each name with its content, or why it can't be read
 * or is left out; a skill at the plugin's own folder (a plugin that is one skill at its root) named for the plugin, never for
 * the folder its files are read from, which may be a copy Central Knot keeps under a name of its own (plugins.ts
 * remoteCopyFolder). A kind is read whole as a link's kind is (library.ts "Read whole"; atlink.ts wasRead): something in the plugin
 * was read (a plugin's folder missing from the marketplace's copy reads as empty, so it is not), its files left nothing of that
 * kind unread (PluginFiles `unread`), and every item of it was read. `outOf`: the tools a name it
 * makes is kept out of (pluginOutOf); `into`: those it brings its items into. `commitAt`: when its marketplace was read.
 */
export async function readPlugin(files: PluginFiles, entry: PluginEntry, commitAt: string, recorded: ReadonlySet<string>, outOf: HarnessId[], into: HarnessId[] = []): Promise<SourceRead<unknown>[]> {
  const read = await pluginItems(files, files.folder, entry.plugin, 'marketplace');
  const any = Object.values(read).some(each => each.items.some(wasRead));
  return sourceKinds().map((kind): SourceRead<unknown> => {
    const { items, unread } = read[kind.kind.kind], names: SourceRead<unknown>['names'] = new Map();
    for (const item of items) names.set(item.key, 'unreadable' in item ? { unreadable: item.unreadable } : { name: item.name, hash: item.hash, content: item.content, own: item.own });
    const whole = any && !unread && items.every(wasRead), link = pluginLink(entry.plugin, entry.marketName);
    return { id: entry.id, link, commitAt, kind: kind.kind.kind, mergeWith: kind.kind.merge, whole, names, recorded, plugin: { on: entry.on, outOf, into } };
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
 * How many items linked to the plugin are wanted in a tool with no installer (none in one with an installer), from the record
 * alone: for a run (its report; where a name it makes goes: pluginOutOf). The page counts what its look finds there (itemsView `on`).
 */
const onIn = (linked: Linked[], tool: HarnessId) => (takesPlugins(tool) ? 0 : linked.filter(({ item }) => wantedIn(item, tool)).length);

/**
 * The tools a name the plugin makes is kept out of (library.ts A PLUGIN): each managed tool with no installer where the plugin
 * is not now (no item linked to it, nor his of the same content, wanted there), but those a click brings it into (`into`); and each the entry keeps it out
 * of, managed or not, so a tool that appears later gets none of it (partsmigrate.ts keeps a moved item out of them too). The
 * step adds each tool with a copy of that name (librarypass.ts fromSourceStep).
 */
const pluginOutOf = (entry: PluginEntry, tools: readonly HarnessId[], linked: Linked[], into: readonly HarnessId[]) =>
  [...new Set([...itemTools(entry.except), ...itemTools(tools).filter(tool => !into.includes(tool) && !onIn(linked, tool))])];

/** His items of the same content as the plugin's (library.ts `alike`), by the table for its read. */
async function alikeIn(context: ShareContext, reads: SourceRead<unknown>[]): Promise<Linked[]> {
  return (await Promise.all(reads.map(async read => {
    const items = (await sourceKinds().find(each => each.kind.kind === read.kind)!.kind.open(context)).library.items;
    return [...sourceAnswers(items, read, read.recorded)].flatMap(([key, answer]) => (answer === 'alike' ? [{ kind: read.kind, item: items[key]! }] : []));
  }))).flat();
}

/**
 * How many of a plugin's items are on in a tool with no installer, as a look finds them: each of `items` (those linked to it, and
 * where the plugin is wanted his of the same content) wanted there with its copy present. The one count the plugin's box
 * (itemsView `on`) and a run's report say.
 */
const onThere = (looks: KindLooks, items: Linked[], tool: HarnessId) => items.filter(({ kind, item }) => {
  const look = looks.find(each => each.kind.kind.kind === kind)!.look, now = look.library.items[item.key];
  return !!now && wantedIn(now, tool) && copiesOf(look, now)[tool]?.is === 'present';
}).length;

// ---------- Running it ----------

/**
 * What a plugin's switch asks of its items: every item On (`on`: its On and Add) or Off (`off`: its Off, and an untick that
 * leaves the plugin Off); a tool's box ticked lets that tool in, in each item's `except` alone, and turns each item On (`on` and
 * `letIn`; an item that comes On from Off is kept out of every other tool: clickOn); a box unticked keeps that tool out (`outOf`). Or a read alone: the page's Update (`click`, which brings back a name of its own he
 * deleted), the automatic check, and its install in a tool new here (`bring`, which counts as where the plugin is). Or Use the
 * plugin's (`take`, with `into` its one tool): a read of that one name, his taken in that tool (library.ts TAKE), and nothing else.
 * `into`, `outOf` and `read` name the tools its result reports on.
 */
export type ItemsAsk = { into: HarnessId[]; on?: true; letIn?: true; take?: Pick<YourName, 'kind' | 'key'> } | { outOf: HarnessId[]; off?: true } | { read: HarnessId[]; bring?: true; click?: true };

/**
 * A plugin's switch on its items (pluginrecord.ts rows 5 and 10, Update, a tool new here), one kind at a time: the plugin's
 * read first where the ask has one, then each item linked to it after that read clicked (clickOn), taken only while it is still
 * linked (types.ts Change forPlugin). Answers one report per tool named, and the items' states before, for the Undo.
 */
export async function runItems(context: ShareContext, tools: HarnessId[], entry: PluginEntry, ask: ItemsAsk, files: Files, op: Op): Promise<Ran & { back?: ItemState[] }> {
  const before = await linkedItems(context, entry.id), named = 'into' in ask ? ask.into : 'outOf' in ask ? ask.outOf : ask.read;
  const brought = 'into' in ask || ('read' in ask && ask.bring) ? named : [];
  const recorded = (await recordedIds(context.home)).ids, plain = files.files && !('outOf' in ask) ? await readPlugin(files.files, entry, files.commitAt, recorded, [], brought) : [];
  // His items of the same content put the plugin in each tool they are wanted in, as its own items do.
  const alike = await alikeIn(context, plain), outOf = pluginOutOf(entry, tools, [...before, ...alike], brought);
  // THE MOVE (library.ts A PLUGIN): the root skill is made where the earlier build's copy was.
  const folder = files.files && basename(files.files.folder), moved = 'take' in ask ? undefined : movedFrom(before, plain, entry, folder);
  // Its Update's click alone brings back the version he took an item back from (library.ts TAKEN BACK).
  const update = 'read' in ask && ask.click ? { update: true as const } : {};
  const read = plain.map(each => ({ ...each, plugin: { ...each.plugin!, ...update, ...(moved && each.kind === 'skill' ? { on: moved.on, outOf: moved.except } : { outOf }) } }));
  // A click that turns its items On (its On, Add, a box ticked), or its Update, brings back a name of its own he deleted; the
  // background never does (library.ts A PLUGIN).
  // Use the plugin's reads its one name, as not read whole, so nothing else of the plugin changes.
  const taken = 'take' in ask && ask.take, bringsBack = ('into' in ask && ask.on) || ('read' in ask && ask.click);
  const one = (each: SourceRead<unknown>, key: string) => ({ ...each, whole: false, names: new Map([...each.names].filter(([name]) => name === key)), take: new Set([key]) });
  const reads = taken ? read.filter(each => each.kind === taken.kind).map(each => one(each, taken.key)) : read.map(each => (bringsBack ? { ...each, bringBack: new Set(each.names.keys()) } : each));
  const results: Passed[] = [];
  for (const kind of sourceKinds()) {
    const read = reads.find(each => each.kind === kind.kind.kind), passed = (result: PassResult) => results.push({ kind: kind.kind.kind, result });
    // The read first, so the clicks reach what it made or linked again (a name linked again after an Undo, say).
    if (read) passed(await kind.apply(context, tools, [], { source: read }));
    if (results.at(-1)?.result.stopped) break;
    // A tool let in stays out of each item it has a copy of its own of (Central Knot never applied it there): never written over.
    const disk = 'into' in ask && ask.letIn ? (await lookFor(kind.kind, context, tools)).look.disk.byKey : undefined;
    const own = (item: LibraryItem) => (tool: HarnessId) => !!disk?.get(item.key)?.[tool] && item.applied[tool] === undefined;
    const linked = 'read' in ask || taken ? [] : (await linkedItems(context, entry.id)).filter(each => each.kind === kind.kind.kind);
    if (linked.length) passed(await kind.apply(context, tools, linked.map(({ item }) => clickOn(ask, item, own(item), entry.id)), { only: new Set() }));
    if (results.at(-1)?.result.stopped) break;
  }
  const after = await linkedItems(context, entry.id);
  const sourced = results.flatMap(({ kind, result }) => (result.sourced ?? []).map(said => ({ kind, said }))), made = new Set(sourced.filter(({ said }) => said.answer === 'make').map(({ kind, said }) => `${kind}:${said.name}`));
  const took = new Map(sourced.flatMap(({ kind, said }) => (said.answer === 'take' && said.history ? [[`${kind}:${itemKey(said.name)}`, said.history] as const] : [])));
  const undo = after.flatMap(({ kind, item }): ItemState[] => {
    const history = took.get(`${kind}:${item.key}`);
    if (history) return [{ kind, key: item.key, on: item.on, except: item.except, entry: history }];
    const was = before.find(each => each.kind === kind && each.item.key === item.key)?.item;
    if (was && was.on === item.on && was.except.join() === item.except.join()) return [];
    return [{ kind, key: item.key, on: !!was?.on, except: was?.except ?? item.except }];
  });
  // Why none is on in a tool, from what this run knows (no other look): its names not brought in (an unreadable one in the read,
  // his own or another source's by the pass's answer), and an item made now and kept out had a copy of its kind and name there.
  const lines: PluginItemLine[] = [...read.flatMap(each => [...each.names].flatMap(([key, name]) => ('unreadable' in name ? [{ kind: each.kind, key, name: key, state: 'not-brought' as const, why: name.unreadable }] : []))),
    ...sourced.flatMap(({ kind, said }) => (['differs', 'another', 'alike'].includes(said.answer) ? [{ kind, key: said.name, name: said.name, state: 'not-brought' as const, why: { another: ANOTHER, alike: SAME }[said.answer as string] ?? YOURS }] : []))];
  const looks = await lookAtKinds(context, tools);
  const madeOut = (tool: HarnessId) => (item: LibraryItem, kind: ItemKind) => item.except.includes(tool) && made.has(`${kind}:${item.name}`);
  const why = (tool: HarnessId) => files.problem ?? `Nothing of ${entry.plugin} is on in ${toolNames[tool]}. ${notInWhy(tool, entry.plugin, outsIn(tool, lines, after, madeOut(tool), heldByShared(looks, tool))).join(' ')}`;
  // A take that can't land says why, and nothing changed. What is on in each tool is counted as the box counts it (onThere).
  const refused = sourced.find(({ said }) => said.held)?.said, his = sourced.filter(({ said }) => said.answer === 'differs').length;
  const on = (tool: HarnessId) => onThere(looks, [...after, ...(!('outOf' in ask) && entry.on && !entry.except.includes(tool) ? alike : [])], tool);
  const ticks = await movedTicks(context, entry, before, after, moved, folder);
  const done = named.map((tool): PluginDone => ({ ...op, tool, report: refused ? { tool, outcome: 'held', message: `${refused.name}: ${refused.held}`, runs: [], changed: false }
    : reportIn(tool, ask, before, after, results, why(tool), !!files.problem, on(tool), after.length + alike.length + his, ticks) }));
  return { ...ran(done, results), ...(undo.length ? { back: undo } : {}) };
}
/**
 * THE MOVE (library.ts A PLUGIN): the one skill linked to the plugin, under a name an earlier build gave its root skill (`folder`:
 * the folder the plugin is read from), where the whole read's one skill is that root skill under the plugin's name; else none.
 */
function movedFrom(before: Linked[], reads: SourceRead<unknown>[], entry: PluginEntry, folder?: string): LibraryItem | undefined {
  const skills = reads.find(read => read.kind === 'skill'), linked = before.filter(({ kind }) => kind === 'skill'), root = itemKey(entry.plugin);
  if (!skills?.whole || skills.names.size !== 1 || !skills.names.has(root) || linked.length !== 1) return undefined;
  return linked[0]!.item.key !== root && earlierRootName(linked[0]!.item.name, folder) ? linked[0]!.item : undefined;
}

/**
 * THE MOVE's profiles (library.ts A PLUGIN): where the root skill was made in `moved`'s place, each profile that named `moved`
 * names the root skill; where an earlier build's root skill was dropped otherwise, the sentence naming each profile that still
 * names it, for the result (else none).
 */
async function movedTicks(context: ShareContext, entry: PluginEntry, before: Linked[], after: Linked[], moved?: LibraryItem, folder?: string): Promise<string | undefined> {
  const id = (name: string) => pluginItemId('skill', pluginItemKey(entry, { kind: 'skill', name }));
  const linked = (key: string) => after.some(each => each.kind === 'skill' && each.item.key === key);
  const dropped = before.filter(({ kind, item }) => kind === 'skill' && !linked(item.key) && earlierRootName(item.name, folder)).map(({ item }) => item.name);
  const made = !!moved && dropped.includes(moved.name) && linked(itemKey(entry.plugin));
  const named = dropped.length ? await profilesNaming(context, dropped.map(id), made ? id(entry.plugin) : undefined) : [];
  if (made || !named.length) return undefined;
  return `${andList(named)} still ${named.length === 1 ? 'names' : 'name'} ${dropped.join(', ')}, the name an earlier version gave ${entry.plugin}’s skill: tick ${entry.plugin} there instead.`;
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
 * One tool's report of a run on a plugin's items: how many of its `of` are on there now (onThere), and whether the run changed what
 * it has. `why`: why none is on there, the plugin's files unreadable (`unread`) or each item's reason (notInWhy). `ticks`: what the
 * run says of profiles after every message (movedTicks).
 */
function reportIn(tool: HarnessId, ask: ItemsAsk, before: Linked[], after: Linked[], results: Passed[], why: string, unread: boolean, on: number, of: number, ticks?: string): PluginDone['report'] {
  const has = on > 0, name = toolNames[tool];
  const changed = onIn(after, tool) > 0 !== onIn(before, tool) > 0 || wroteIn(results, tool);
  // Why an item its pass held in the tool isn't there yet (it waits for the shared skills folder, say), each reason once.
  const held = new Set(results.flatMap(({ result }) => result.results.filter(each => each.harness === tool && keptBack(each) && after.some(({ item }) => item.name === each.item)).map(each => each.message)));
  const said = [`${on} of its ${of} items ${on === 1 ? 'is' : 'are'} on in ${name}.`, ...held].join(' ');
  // Its notes: what the run also changed in the tool's own settings with its items' copies (Pi's list: librarypass.ts Kind.follow).
  const notes = results.flatMap(({ result }) => result.results.flatMap(each => (each.harness === tool && each.settingsChanged ? [each.settingsChanged] : [])));
  const reloads = reloadsIn(results, tool);
  const report = (outcome: PluginDone['report']['outcome'], message = said) => ({ tool, outcome, message: ticks ? `${message} ${ticks}` : message, runs: [], changed, ...(notes.length ? { notes } : {}), ...(reloads.length ? { reloads } : {}) });
  if ('outOf' in ask) return report(has ? 'failed' : 'uninstalled');
  if (!has && 'into' in ask) return report('held', held.size ? said : why);
  if (unread && 'read' in ask) return report('failed', why);
  return report('read' in ask && !ask.bring ? 'updated' : 'installed', unread ? `${said} ${why}` : said);
}

/**
 * Why each of a plugin's items is not on in a tool with no installer, the one place the run's report and the page ask (both say
 * it by pluginstatus.ts notInWhy): a name of its `lines` not brought in (his own, another source's, unreadable) or deleted,
 * each item `linked` to it not wanted there (off on its own row, or kept out: `own` when the tool has its own copy, never
 * written over), and each `linked` item wanted there held out by his copy in the shared skills folder (`shared`).
 */
type Out = { name: string; kind: ItemKind; out: ItemOut };
/** Whether a linked item wanted in `tool` is held out there by his copy in the shared skills folder (librarypass.ts copiesOf). */
const heldByShared = (looks: KindLooks, tool: HarnessId) => (item: LibraryItem, kind: ItemKind) => { const copy = copiesOf(looks.find(each => each.kind.kind.kind === kind)!.look, item)[tool]; return copy?.is === 'held' && !!copy.throughShared; };
function outsIn(tool: HarnessId, lines: PluginItemLine[], linked: Linked[], own: (item: LibraryItem, kind: ItemKind) => boolean, shared: (item: LibraryItem, kind: ItemKind) => boolean): Out[] {
  return [...lines.flatMap(({ name, kind, state, why }): Out[] => (state === 'deleted' ? [{ name, kind, out: 'deleted' }]
    : state === 'not-brought' ? [{ name, kind, out: why === YOURS ? 'yours' : why === ANOTHER ? 'another' : { cannot: why! } }] : [])),
  ...linked.filter(({ item }) => !wantedIn(item, tool)).map(({ kind, item }): Out => ({ name: item.name, kind, out: !item.on ? 'off' : own(item, kind) ? 'own' : 'kept' })),
  ...linked.filter(({ item, kind }) => wantedIn(item, tool) && shared(item, kind)).map(({ kind, item }): Out => ({ name: item.name, kind, out: 'shared' }))];
}
const wroteIn = (results: Passed[], tool: HarnessId) => results.some(({ result }) => result.results.some(each => each.harness === tool && (each.outcome === 'written' || each.outcome === 'removed')));
const reloadsIn = (results: Passed[], tool: HarnessId) => results.flatMap(({ result }) => result.reloads.filter(each => each.tool === tool));

/**
 * The Undo of a run on a plugin's items (runItems' `back`): each item as it was, by the same clicks, taken only while it is
 * still linked to the plugin; one the run made goes Off, linked, with its versions (the plugin's next On turns it On again); one
 * it took over his (`entry`) by its take's own Undo, as History's (library.ts TAKE): his own again, never Off and still linked.
 */
export async function itemsBack(context: ShareContext, tools: HarnessId[], id: string, states: ItemState[], op: Op, named: HarnessId[]): Promise<Ran> {
  const before = await linkedItems(context, id), results: Passed[] = [];
  for (const kind of sourceKinds()) {
    const mine = states.filter(state => state.kind === kind.kind.kind), taken = mine.flatMap(state => (state.entry ? [state.entry] : []));
    if (taken.length) results.push({ kind: kind.kind.kind, result: await restoreAll(kind.kind, context, tools, taken) });
    const clicks = mine.filter(state => !state.entry).map((state): Change => ({ key: state.key, on: state.on, except: state.except, forPlugin: id }));
    if (clicks.length) results.push({ kind: kind.kind.kind, result: await kind.apply(context, tools, clicks, { only: new Set() }) });
  }
  const after = await linkedItems(context, id);
  const done = named.map((tool): PluginDone => {
    const has = onIn(after, tool) > 0, changed = has !== onIn(before, tool) > 0 || wroteIn(results, tool), reloads = reloadsIn(results, tool);
    const kept = results.flatMap(({ result }) => result.results).filter(each => each.harness === tool && each.outcome === 'held').map(each => ` ${each.item}: ${each.message}`);
    return { ...op, tool, report: { tool, outcome: has ? 'installed' : 'uninstalled', message: `Its items are as they were in ${toolNames[tool]}.${kept.join('')}`, runs: [], changed, ...(reloads.length ? { reloads } : {}) } };
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
 * has that is not brought in, with why, and each of his under each tool's box (`yours`); how many are there in each tool, as
 * its look reads them; whether Update has something to do (`ready`), and whether the automatic check has (`due`: Update's but
 * the version he took an item back from, which only a click brings: library.ts TAKEN BACK). `reads`: none where the plugin can't
 * be read now (`problem` says why); then only its linked items are listed. `looks`: the home as lookAtKinds read it.
 */
export async function itemsView(tools: readonly HarnessId[], looks: KindLooks, entry: PluginEntry, reads: SourceRead<unknown>[] | undefined, problem?: string): Promise<PluginItemsView> {
  const lines: PluginItemLine[] = [], linked = linkedIn(looks.map(({ kind, look }) => ({ kind: kind.kind.kind, library: look.library })), entry.id);
  // Of those, the ones a tool's own settings keep out (librarypass.ts Disk.switchedOff: Pi's list, say), which it doesn't load.
  const switchedOff = (kind: ItemKind, key: string) => looks.find(each => each.kind.kind.kind === kind)!.look.disk.switchedOff?.get(key) ?? [];
  const keptOut = Object.fromEntries(itemTools(tools).map(tool => [tool, linked.filter(({ kind, item }) => wantedIn(item, tool) && switchedOff(kind, item.key).includes(tool)).length]).filter(([, out]) => out));
  let ready = false, due = false;
  for (const { kind, look } of looks) {
    const items = look.library.items, read = reads?.find(each => each.kind === kind.kind.kind), copies = (item: LibraryItem) => copiesOf(look, item);
    const answers = read ? sourceAnswers(items, read, read.recorded, { copies }) : new Map();
    // Update's click, as runItems reads it (`update`), also brings back the version he took an item back from (library.ts TAKEN BACK).
    const clicked = read ? sourceAnswers(items, { ...read, plugin: { ...read.plugin!, update: true } }, read.recorded, { copies }) : new Map();
    for (const [key, background] of answers) {
      const item = items[key], there = read!.names.get(key), name = there && 'name' in there ? there.name : item?.name ?? key;
      const answer = background === 'nothing' && clicked.get(key) === 'update' ? 'update' : background;
      if (['update', 'make', 'drop'].includes(answer)) ready = true;
      if (['update', 'make', 'drop'].includes(background)) due = true;
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
  // His names (a clash, or the same content: `alike`), each with his item. What is on in each tool: onThere, his of the same
  // content counted where the plugin is wanted.
  const look = (kind: ItemKind) => looks.find(each => each.kind.kind.kind === kind)!.look;
  const his = lines.filter(line => line.state === 'alike' || line.why === YOURS).map(line => ({ line, item: look(line.kind).library.items[line.key]! }));
  const alike = his.filter(({ line }) => line.state === 'alike').map(({ line, item }) => ({ kind: line.kind, item })), wanted = itemTools(tools).filter(tool => entry.on && !entry.except.includes(tool));
  const on = Object.fromEntries(itemTools(tools).map(tool => [tool, onThere(looks, [...linked, ...(wanted.includes(tool) ? alike : [])], tool)]));
  const ownIn = (tool: HarnessId) => (item: LibraryItem, kind: ItemKind) => !!look(kind).disk.byKey.get(item.key)?.[tool] && item.applied[tool] === undefined;
  // A name of his is said apart, under each tool's box (`yours`, below), so not among these.
  const away = reads && !lines.some(line => line.state === 'new') ? wanted.filter(tool => !on[tool]).flatMap(tool => {
    const why = outsIn(tool, lines, linked, ownIn(tool), heldByShared(looks, tool)).filter(({ out }) => out !== 'yours');
    const tickHelps = why.some(({ out }) => out === 'kept' || out === 'off' || out === 'deleted');
    return !why.length && lines.length ? [] : [[tool, { reasons: notInWhy(tool, entry.plugin, why), tickHelps }] as const];
  }) : [];
  // Linked items kept out by his own copy there (not a Library item, or only in the shared folder), where `notIn` didn't already say it.
  const heldOut = Object.fromEntries(wanted.filter(tool => away.every(([each]) => each !== tool)).flatMap(tool => {
    const held = outsIn(tool, [], linked, ownIn(tool), heldByShared(looks, tool)).filter(({ out }) => out === 'own' || out === 'shared');
    return held.length ? [[tool, notInWhy(tool, entry.plugin, held)] as const] : [];
  }));
  // Each name of his under each tool's box the plugin is wanted in, whatever else is so: the same as his, or Use the plugin's but
  // where its take can't land there (librarypass.ts takeHeld: his through the shared folder, say).
  const yours: Partial<Record<HarnessId, YourName[]>> = {};
  for (const tool of his.length ? wanted : []) yours[tool] = await Promise.all(his.map(async ({ line: { kind, key, name, state }, item }): Promise<YourName> => {
    const plugins = reads?.find(each => each.kind === kind)?.names.get(key), held = plugins && 'content' in plugins ? await takeHeld(look(kind), item, tool, plugins.content) : undefined;
    return { kind, key, name, ...(state === 'alike' ? { same: true as const } : held ? { held: { why: held.why, ...(held.throughShared ? { shared: true as const } : {}) } } : {}) };
  }));
  return { lines, on, of: linked.length + his.length, ...(Object.keys(keptOut).length ? { keptOut } : {}), ...(ready ? { ready: true as const } : {}), ...(due ? { due: true as const } : {}), ...(problem ? { problem } : {}),
    ...(away.length ? { notIn: Object.fromEntries(away) } : {}), ...(Object.keys(heldOut).length ? { heldOut } : {}), ...(Object.keys(yours).length ? { yours } : {}) };
}

/** A name not brought in, as its line says why: his own item of that name, another source's, or his of the same content (a run's report). */
const YOURS = 'you keep your own', ANOTHER = 'another source has it', SAME = 'the same as yours, so yours stays.';
/** One name's line in "Its items", from the table's answer for it (library.ts SourceAnswer). */
function lineOf(kind: SourceKind, key: string, name: string, item: LibraryItem | undefined, answer: string, unreadable?: string): PluginItemLine {
  const base = { kind: kind.kind.kind, key, name };
  if (unreadable) return { ...base, state: 'not-brought', why: unreadable };
  if (answer === 'make') return { ...base, state: 'new' };
  if (answer === 'deleted') return { ...base, state: 'deleted' };
  if (answer === 'differs' || answer === 'another') return { ...base, state: 'not-brought', why: answer === 'another' ? ANOTHER : YOURS };
  if (answer === 'alike') return { ...base, state: 'alike' };
  return { ...base, state: answer === 'update' ? 'update' : answer === 'drop' ? 'going' : 'linked', on: !!item?.on, except: item?.except ?? [] };
}
