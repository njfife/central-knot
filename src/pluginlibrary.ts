// A plugin's skills, agents and MCP servers as library items in Pi and OpenCode, which have no plugin installer (library.ts A
// PLUGIN: the table's rows that differ for a plugin, decided by SourceSeen `plugin`). This module owns:
// - the plugin's read (readPlugin): its files as catalogdetail.ts pluginFiles reads them from the marketplace's copy
//   (marketplaces.ts locate, never a tool's installed copy), made into one SourceRead per kind through the per-item checks a
//   link's readers use (atlink.ts skillAt keyed by its folder's name, agentInText, serverAt), never their place-finding; and
//   whether each kind was read whole;
// - running it (runItems): each kind's pass (sources.ts sourceKinds) with that read and the clicks the plugin's switch makes on
//   its items, one pass per kind, as a profile switch makes them; and its Undo (itemsBack);
// - what the Plugins page shows of them (itemsView: "Its items", and "has it" in each tool).
// When a plugin is read: at a click that brings it into Pi or OpenCode (On, Add, Let in, Install there), at its Update and
// Update all, and at the automatic updates' check, for a plugin with items (withItemsOf) or a tool new here (marketplaces.ts);
// Off, Keep out and Take out there only click. Which plugins take this route and which keep their parts is pluginstatus.ts
// routeOf. Kept elsewhere: the table (library.ts), the held answer in the tools with an installer (plugins.ts pluginHolds),
// the switch's table (pluginrecord.ts owedTo), and the let-go of an item changed here, in every pass (librarypass.ts letGo).
// Known miss: a skill whose folder's name and SKILL.md name differ (folder pdf-tools, name pdf) is the item pdf-tools, as every
// tool's copy is named; Pi and OpenCode load it as pdf, so it can meet a skill of that name there unmarked, and the same
// repository given as a Git link brings it as a second item, pdf.
import { basename, dirname } from 'node:path';
import { agentHash } from './agentfiles.ts';
import { agentInText, serverAt, skillAt, wasRead, type ItemThere } from './atlink.ts';
import type { PluginFiles } from './catalogdetail.ts';
import { fromLinkSinceTakeIn, itemKey, sourceAnswers, wantedIn, type ItemKind, type LibraryItem } from './library.ts';
import { copiesOf, lookFor, type SourceRead } from './librarypass.ts';
import type { PluginDone, PluginOp } from './pluginplan.ts';
import type { PluginEntry } from './pluginrecord.ts';
import { takesPlugins } from './presence.ts';
import type { ShareContext } from './share.ts';
import { pluginLink } from './sourcelink.ts';
import { sourceKinds, type SourceKind } from './sources.ts';
import { recordedIds } from './sourcestore.ts';
import type { Change, HarnessId, PassResult, PluginItemLine, PluginItemsView, SyncNotice } from './types.ts';
import { toolNames } from './words.ts';

/** The managed tools a plugin's items go to as library items: those with no plugin installer (Pi, OpenCode). */
export const itemTools = (tools: readonly HarnessId[]) => tools.filter(tool => !takesPlugins(tool));

/** One item a plugin's switch put back by its Undo: as it was before the click (one the click made: Off). */
export interface ItemState { kind: ItemKind; key: string; on: boolean; except: HarnessId[] }

// ---------- The read ----------

/** Of a kind's items, two of one key are both left out, said once each (a plugin's folders are read nested). */
const onceEach = (items: ItemThere<unknown>[], what: string) => items.map((item): ItemThere<unknown> => {
  if (items.filter(other => other.key === item.key).length < 2) return item;
  const { folder, folderName, key, name, files } = item;
  return { folder, folderName, key, name, files, unreadable: `two ${what} in the plugin are named ${name}`, leftOut: true };
});

/** Each kind's items in a plugin's files, keyed as every tool's copy is (a skill by its folder, an agent by its file). */
const readers: Record<ItemKind, (files: PluginFiles) => Promise<ItemThere<unknown>[]>> = {
  skill: async files => onceEach(await Promise.all(files.skills.map(({ name, dir }) => skillAt(dirname(dir), basename(dir), name, true))), 'skills'),
  agent: async files => onceEach(files.agents.map(({ name, text, whole }): ItemThere<unknown> => {
    const where = { folder: 'agents', folderName: basename(files.folder), key: itemKey(name), name, files: [`${name}.md`] };
    const read = whole ? agentInText({ path: `${name}.md`, tool: 'claude-cli', name }, text, false) : undefined;
    if (!read) return { ...where, unreadable: whole ? `${name}.md has no front matter, so it is no agent` : `${name}.md is larger than Central Knot copies` };
    return 'unreadable' in read ? { ...where, unreadable: read.unreadable } : { ...where, hash: agentHash(read.agent), content: read.agent, own: { 'claude-cli': read.text } };
  }), 'agents'),
  mcp: files => {
    const keys = Object.keys(files.servers).map(itemKey), where = { folder: '', folderName: basename(files.folder), files: [] };
    return Promise.all(Object.entries(files.servers).map(([name, raw]) => serverAt({ ...where, key: itemKey(name), name }, raw, keys.filter(key => key === itemKey(name)).length > 1, files.folder)));
  },
};

/**
 * A plugin's files read as one SourceRead per kind (library.ts A PLUGIN): each name with its content, or why it can't be read
 * or is left out. A kind is read whole as a link's kind is (library.ts "Read whole"; atlink.ts wasRead): something in the plugin
 * was read (a plugin's folder missing from the marketplace's copy reads as empty, so it is not), its files left nothing of that
 * kind unread (PluginFiles `unread`), and every item of it was read. `outOf`: the tools a name it
 * makes is kept out of (pluginOutOf). `commitAt`: when its marketplace was read.
 */
export async function readPlugin(files: PluginFiles, entry: PluginEntry, commitAt: string, recorded: ReadonlySet<string>, outOf: HarnessId[]): Promise<SourceRead<unknown>[]> {
  const kinds = await Promise.all(sourceKinds().map(async kind => ({ kind, items: await readers[kind.kind.kind](files) })));
  const read = kinds.some(each => each.items.some(wasRead));
  const unread: Record<ItemKind, string[]> = { skill: files.unread.skills, agent: files.unread.agents, mcp: files.unread.servers ? ['*'] : [] };
  return kinds.map(({ kind, items }): SourceRead<unknown> => {
    const names: SourceRead<unknown>['names'] = new Map(unread[kind.kind.kind].filter(name => name !== '*').map(name => [itemKey(name), { unreadable: 'it can’t be read' }]));
    for (const item of items) names.set(item.key, 'unreadable' in item ? { unreadable: item.unreadable } : { name: item.name, hash: item.hash, content: item.content, own: item.own });
    const whole = read && !unread[kind.kind.kind].length && items.every(wasRead), link = pluginLink(entry.plugin, entry.marketName);
    return { id: entry.id, link, commitAt, kind: kind.kind.kind, mergeWith: kind.kind.merge, whole, names, recorded, plugin: { on: entry.on, outOf } };
  });
}

/** Each kind's items linked to the plugin, as the record holds them now. */
type Linked = { kind: ItemKind; item: LibraryItem };
async function linkedItems(context: ShareContext, id: string): Promise<Linked[]> {
  const kinds = await Promise.all(sourceKinds().map(async kind => ({ kind: kind.kind.kind, library: (await kind.kind.open(context)).library })));
  return kinds.flatMap(({ kind, library }) => Object.values(library.items).filter(item => item.source === id && !item.deleted).map(item => ({ kind, item })));
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
 * What a plugin's switch asks of its items: every item On (`on`: its On and Add) or Off (`off`: its Off); one tool let in
 * (`letIn`: Let in) or kept out (Keep out, Take out there) in each item's `except` alone; Install there, a click on one tool,
 * both lets it in and turns each item On. Or a read alone: the page's Update (`click`, which brings back a name of its own he
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
  // A click that turns its items On brings back a name of its own he deleted; Let in and the background never do (library.ts A PLUGIN).
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
  const done = named.map((tool): PluginDone => ({ ...op, tool, report: reportIn(tool, ask, before, after, results, files.problem) }));
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
  const except = 'into' in ask && ask.letIn ? item.except.filter(tool => !ask.into.includes(tool) || own(tool))
    : 'outOf' in ask && !ask.off ? [...new Set([...item.except, ...ask.outOf])] : item.except;
  return { key: item.key, on, except, forPlugin: id };
}

/** One tool's report of a run on a plugin's items: what it has of them now, and whether the run changed what it has. */
function reportIn(tool: HarnessId, ask: ItemsAsk, before: Linked[], after: Linked[], results: Passed[], problem?: string): PluginDone['report'] {
  const on = onIn(after, tool), has = on > 0, name = toolNames[tool];
  const changed = has !== onIn(before, tool) > 0 || wroteIn(results, tool);
  const said = `${on} of its ${after.length} items ${on === 1 ? 'is' : 'are'} on in ${name}.`;
  const report = (outcome: PluginDone['report']['outcome'], message = said) => ({ tool, outcome, message, runs: [], changed });
  if ('outOf' in ask) return report(has ? 'failed' : 'uninstalled');
  if (!has && 'into' in ask) return report('held', problem ?? `None of its items can go into ${name}.`);
  if (problem && 'read' in ask) return report('failed', problem);
  return report('read' in ask && !ask.bring ? 'updated' : 'installed', problem ? `${said} ${problem}` : said);
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

/**
 * What the Plugins page shows of a plugin's items (types.ts PluginItemsView), from the same table the pass carries out: each
 * item linked to it, with its state where it isn't plain (Off; an update ready; removed by the plugin's update); each name it
 * has that is not brought in, with why; how many are on in each tool (onIn); and whether Update has something to do (`ready`). `reads`: none where the plugin can't
 * be read now (`problem` says why); then only its linked items are listed.
 */
export async function itemsView(context: ShareContext, tools: readonly HarnessId[], entry: PluginEntry, reads: SourceRead<unknown>[] | undefined, problem?: string): Promise<PluginItemsView> {
  const lines: PluginItemLine[] = [], linked = await linkedItems(context, entry.id);
  const on = Object.fromEntries(itemTools(tools).map(tool => [tool, onIn(linked, tool)]));
  let ready = false;
  for (const kind of sourceKinds()) {
    const { look } = await lookFor(kind.kind, context, tools), items = look.library.items, read = reads?.find(each => each.kind === kind.kind.kind);
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
  return { lines, on, of: linked.length, ...(ready ? { ready: true as const } : {}), ...(problem ? { problem } : {}) };
}

/** One name's line in "Its items", from the table's answer for it (library.ts SourceAnswer). */
function lineOf(kind: SourceKind, key: string, name: string, item: LibraryItem | undefined, answer: string, unreadable?: string): PluginItemLine {
  const base = { kind: kind.kind.kind, key, name };
  if (unreadable) return { ...base, state: 'not-brought', why: unreadable };
  if (answer === 'make') return { ...base, state: 'new' };
  if (answer === 'deleted') return { ...base, state: 'deleted' };
  if (answer === 'differs' || answer === 'another') return { ...base, state: 'not-brought', why: answer === 'another' ? 'another source has it' : 'you have your own' };
  return { ...base, state: answer === 'update' ? 'update' : answer === 'drop' ? 'going' : 'linked', on: !!item?.on, except: item?.except ?? [] };
}
