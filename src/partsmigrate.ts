// Plugin parts already in a home become library items linked to their plugin (library.ts A PLUGIN), once. Up to 0.6.0 alpha 1 a
// plugin went into Pi and OpenCode (and into Claude Code, Copilot CLI or Codex where its installer couldn't run) as its parts: its
// skills, agents and MCP servers written as separate copies, recorded per plugin and tool in .central-knot/plugin-parts.json
// (parts.ts), each content kept in the store before it was written. This module owns two things, both only while that file is
// there; once the migration has renamed it to plugin-parts.v1.json neither does anything, and the code stays, as the other
// migrations' does.
//
// THE GUARD (hideParts, asked by librarypass.ts lookAt: the one read every pass, view, join count and take-in goes through). Each
// key the record has a part of that he hasn't removed is unseen in every managed tool of its kind, "waiting to be moved to the
// library": no part is taken in as a found item (Synchronize everything would turn it On in every tool), and an item of that name
// pauses. A record that is there and can't be read makes every copy of the kind unseen. Only the migration sees those copies,
// through the kind's own read (librarypass.ts Kind.read).
//
// THE MIGRATION (migrateParts: homepass.ts step 2, with Sync on or off, behind share.ts libraryGate). Each key on the record, and
// each name a plugin on the record holds that was no part anywhere (an agent, which Pi took no part of), ends as a live item linked
// to its plugin, or is left as it is when the library has a live item of that name (his own, or another source's): never found
// while a copy of it is in a tool. Its plugin is the first in the record's order with a part of that name, by its plugins.json
// entry, which the plugins record's first read makes before (marketplaces.ts beforeParts); a plugin whose parts are only in tools
// not managed gets the entry that read would have made (pluginrecord.ts firstEntry), counting only Pi and OpenCode as having it.
// The item is made as A PLUGIN's `make` makes one (over a deleted item of its name, keeping its versions): linked, On as the entry
// is, its `seen` the current version. Every managed tool of the kind, and every one the record names, managed or not (a tool left
// out keeps what the record knew of it), is decided by what it holds, first match:
//
//   the tool (Pi, OpenCode) holds                     the item there
//   the plugin's part, its copy as the part wrote it  applied: that content
//   the plugin's part, its copy edited                applied at the part's kept content where the tool is managed and the
//                                                     kind's record holds its folder identity, so the first pass lets the item
//                                                     go as his own and takes the edit in (librarypass.ts letGo); else (no
//                                                     identity: a pass would read A back from the copy, librarypass.ts
//                                                     cameBack; not managed; or nothing kept) kept out, the edit that tool's own
//   the plugin's part, no copy, deleted by hand       kept out
//   the plugin's part, no copy, never written         nothing: where the item is On, the first pass writes it, as the old
//                                                     engine's next run would have
//   anything else: the part removed by him, another   kept out
//     plugin's part, no part
// In Claude Code, Copilot CLI and Codex a part's copy, or any copy of that name, is kept out as that tool's own, and the item is
// held there by the plugin's installer anyway (plugins.ts pluginHolds). Every tool the entry keeps the plugin out of is kept out
// too, so a tool that appears later gets none of it. Any other tool not managed now: joining decides when it is managed.
//
// "As the part wrote it" compares the copy with the part's kept content as the kind reads both now (keptOf), never the recorded
// hash: alpha 1 kept a server's `args: []`, and an agent's recorded hash is its whole file's. With nothing kept, a server can't
// tell (unchangedByRecord), so its copy reads edited: wrongly his own only stops following the plugin, wrongly unedited would be
// written over by its update. Of contents that differ (one tool picked up to a later version), the current one is what the
// plugin's files hold now, else the higher version on record, never the later time; the others are kept as versions. A key whose
// copies give no content (nothing kept, every copy edited) is his own item, from the first copy. Known miss: where a plugin's files
// can't be read now, a part a first pick left out gets no item then, nor does a name that was no part, which the plugin's next
// read of its files then makes, On as the plugin is, in each tool where the plugin is (pluginlibrary.ts).
//
// It waits, writing nothing of its own, while the record can't be read, there is no sync record or the gate refuses, plugins.json
// is absent or has a problem, a kind's record has one, or a copy of a part in a managed tool can't be read for sure. Its writes,
// each safe to stop after: the new plugins.json entries, before any item names one; each kind's versions and own parts (new names
// only), then its record (a record in an older format is first written by its own migration, as any writer opens it); last, the
// record renamed to plugin-parts.v1.json (beside one there, never over it). A key with a live item is done, so a run after a stop
// finishes the rest. No tool file and no History entry: what the first pass does with the items is THE RULE's (library.ts).
// Migrated items are outside profiles (profileplan.ts liveItems).
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { agentHash, parseAgent, type AgentEntry } from './agentfiles.ts';
import { itemKey, newItem, versionAt, type ItemKind, type LibraryItem, type Version } from './library.ts';
import { unseenIn, type Disk, type Kind, type KindLibrary, type Seen, type SourceRead } from './librarypass.ts';
import { asRead, serverHash } from './mcp.ts';
import { entryOf, firstEntry, readPluginRecord, savePluginRecord, withEntry, type PluginEntry, type PluginRecord } from './pluginrecord.ts';
import { sameSource } from './plugins.ts';
import { harnessIds } from './harnesses.ts';
import { takesPlugins, type AgentTool } from './presence.ts';
import { errorCode, exists, libraryGate, partsRecordPath, readTree, storeDirectory, storedRevision, type ShareContext } from './share.ts';
import { pluginLink } from './sourcelink.ts';
import type { HarnessId, PartItem, PartsInstall } from './types.ts';
import { byToolOrder } from './words.ts';

/** One part on the record, with the plugin and tool it went into. */
interface OnRecord { install: PartsInstall; part: PartItem }

/** The record as parts.ts wrote it, each part with its install; absent (no parts anywhere), or unreadable. */
async function readRecord(home: string): Promise<OnRecord[] | 'absent' | 'unreadable'> {
  let installs: unknown;
  try { installs = JSON.parse(await readFile(partsRecordPath(home), 'utf8'))?.installs; } catch (error) { return errorCode(error) === 'ENOENT' ? 'absent' : 'unreadable'; }
  if (!Array.isArray(installs)) return 'unreadable';
  return (installs as PartsInstall[]).flatMap(install => (Array.isArray(install?.items) ? install.items : [])
    .filter(part => ['skill', 'mcp', 'agent'].includes(part?.kind) && typeof part.name === 'string' && typeof part.hash === 'string').map(part => ({ install, part })));
}

// ---------- The guard ----------

/** THE GUARD on one kind's read (librarypass.ts lookAt): `managed` is the kind's managed tools, `unseen` its Disk.unseen. */
export async function hideParts(home: string, kind: ItemKind, managed: readonly HarnessId[], unseen: Map<string, string>) {
  const record = await readRecord(home);
  if (record === 'absent') return;
  const keys = record === 'unreadable' ? ['*'] : record.filter(({ part }) => part.kind === kind && !part.removed).map(({ part }) => itemKey(part.name));
  const why = record === 'unreadable' ? 'The record of plugins’ parts can’t be read, so nothing changes here until it can.'
    : 'A plugin’s part of this name is waiting to be moved to the library, so nothing changes here until it is.';
  for (const tool of managed) for (const key of keys) if (!unseen.has(`${tool}:${key}`)) unseen.set(`${tool}:${key}`, why);
}

// ---------- The migration ----------

/**
 * A plugin's read now (pluginlibrary.ts readPlugin), from its marketplace's copy on disk (marketplaces.ts beforeParts), when its
 * files can be read: what a part never kept takes, and which of two contents is the plugin's now.
 */
export type PluginNow = (entry: PluginEntry) => Promise<{ reads: SourceRead<unknown>[]; commitAt: string } | undefined>;

/** One content an item may be made from: its hash, its content as the kind stores it, the version on record and when it was made. */
interface Content { hash: string; content: unknown; version?: string; at: string }

/** Each kind's kept content of a part (parts.ts kept it before writing), as the kind reads it now; none when it is not kept. */
const keptOf: Record<ItemKind, (context: ShareContext, at: OnRecord) => Promise<Omit<Content, 'install' | 'at'> | undefined>> = {
  skill: async (context, { part }) => {
    const directory = storedRevision(context, itemKey(part.name), part.hash), tree = await readTree(directory).catch(() => undefined);
    return tree && !tree.held ? { hash: tree.hash, content: { directory, hash: tree.hash } } : undefined;
  },
  agent: async (context, { install, part }) => {
    const text = await readFile(join(storeDirectory(context.home), 'items/plugin-parts/agent', `${part.hash}.txt`), 'utf8').catch(() => undefined);
    const agent = text === undefined ? undefined : parseAgent(install.tool as AgentTool, part.name, text);
    return agent && { hash: agentHash(agent), content: agent };
  },
  // Alpha 1 kept a server in the MCP store of its time; later builds beside the agents (parts.ts serverPaths).
  mcp: async (context, { part }) => {
    for (const path of [`items/plugin-parts/mcp/${part.hash}.json`, `items/mcp/${encodeURIComponent(part.name)}/${part.hash}.json`]) {
      const server = await readFile(join(storeDirectory(context.home), path), 'utf8').then(text => asRead(JSON.parse(text)), () => undefined);
      if (server) return { hash: serverHash(server), content: server };
    }
    return undefined;
  },
};
/** With nothing kept, whether a copy is still what the part wrote, by the record: a skill's folder hash, an agent's file; never a server's. */
const unchangedByRecord: Record<ItemKind, (copy: Seen, part: PartItem) => boolean> = {
  skill: (copy, part) => copy.hash === part.hash,
  agent: (copy, part) => !!part.seen && (copy as AgentEntry).bytes === part.seen,
  mcp: () => false,
};

/**
 * One kind as the migration reads it: its record; the tools it decides (`tools`: every managed one and every one the record names,
 * managed or not) and of them the managed ones; what they hold (its own read, unguarded); its parts.
 */
interface KindRead { kind: Kind<unknown, Seen>; library: KindLibrary; tools: HarnessId[]; managed: HarnessId[]; disk: Disk<Seen>; parts: OnRecord[] }

/**
 * THE MIGRATION (the header): answers why it waits, if it does. `kinds`: every kind on the library (homepass.ts gives them, as this
 * module is below them); `pluginNow`: how a plugin is read, none where no plugin can be.
 */
export async function migrateParts(context: ShareContext, managed: HarnessId[], kinds: readonly Kind<unknown, Seen>[], pluginNow?: PluginNow): Promise<{ waits?: string }> {
  const parts = await readRecord(context.home);
  if (parts === 'absent') return {};
  if (parts === 'unreadable') return { waits: 'The record of plugins’ parts can’t be read.' };
  const gate = await libraryGate(context);
  if ('refused' in gate || !gate.record) return { waits: 'refused' in gate ? gate.refused : 'This home has no sync record yet.' };
  const plugins = await readPluginRecord(context.home);
  if (!plugins.record) return { waits: plugins.problem ?? 'The plugins record isn’t made yet.' };
  const moving: KindRead[] = [];
  for (const kind of kinds) {
    const { library, problem } = await kind.open(context, true);
    if (problem) return { waits: problem };
    const ofKind = parts.filter(({ part }) => part.kind === kind.kind), kindManaged = kind.harnesses(managed);
    const tools = kind.harnesses(harnessIds.filter(tool => kindManaged.includes(tool) || parts.some(({ install }) => install.tool === tool)));
    const disk = await kind.read(context, tools, library);
    // A copy that can't be read for sure in a managed tool waits; in one not managed that tool is kept out (itemFor).
    const unread = ofKind.map(({ install, part }) => !part.removed && kindManaged.includes(install.tool) && unseenIn(disk, install.tool, itemKey(part.name))).find(Boolean);
    if (unread) return { waits: unread };
    moving.push({ kind, library, tools, managed: kindManaged, disk, parts: ofKind });
  }
  const record = await entriesFirst(context.home, plugins.record, parts, managed);
  const reads = new Map<string, ReturnType<PluginNow>>();
  const plugin = (entry: PluginEntry) => {
    if (!reads.has(entry.id)) reads.set(entry.id, pluginNow?.(entry).catch(() => undefined) ?? Promise.resolve(undefined));
    return reads.get(entry.id)!;
  };
  const onRecord = [...new Set(parts.map(({ install }) => entryOf(record, install.source, install.plugin)!))];
  for (const read of moving) {
    const before = JSON.stringify(read.library), names = (now: Awaited<ReturnType<PluginNow>>) => now?.reads.find(one => one.kind === read.kind.kind)?.names;
    // Each key on the record, by the first plugin with a part of it; then each name a plugin on the record holds that was no part.
    const keys = new Map<string, { entry: PluginEntry; name: string }>();
    for (const { install, part } of read.parts) if (!keys.has(itemKey(part.name))) keys.set(itemKey(part.name), { entry: entryOf(record, install.source, install.plugin)!, name: part.name });
    for (const entry of onRecord) for (const [key, there] of names(await plugin(entry)) ?? []) if ('name' in there && !keys.has(key)) keys.set(key, { entry, name: there.name });
    for (const [key, { entry, name }] of keys) {
      const was = read.library.items[key];
      if (was && !was.deleted) continue;
      const ofKey = read.parts.filter(({ part }) => itemKey(part.name) === key);
      const atPlugin = async () => {
        const now = await plugin(entry), there = names(now)?.get(key);
        return there && 'hash' in there ? { hash: there.hash, content: there.content, at: now!.commitAt } : undefined;
      };
      const made = await itemFor(context, read, key, name, ofKey, entry, atPlugin);
      if (made) read.library.items[key] = made;
    }
    if (JSON.stringify(read.library) !== before) await read.kind.save(context.home, read.library);
    context.fault?.('parts-kind-saved');
  }
  context.fault?.('parts-before-rename');
  await rename(partsRecordPath(context.home), await besideOld(context.home));
  return {};
}

/** plugins.json with an entry for each plugin on the record that has none (the first read's: pluginrecord.ts firstEntry), saved first. */
async function entriesFirst(home: string, record: PluginRecord, parts: OnRecord[], managed: HarnessId[]): Promise<PluginRecord> {
  const holdings = parts.map(({ install: { tool, source, marketName, plugin } }) => ({ tool, source, marketName, plugin }));
  // A tool with an installer that holds only the parts' loose copies hasn't the plugin: kept out, it is owed no install beside them.
  const having = holdings.filter(held => !takesPlugins(held.tool));
  const made = holdings.reduce((now, held) => (entryOf(now, held.source, held.plugin) ? now : withEntry(now, held.source, held.plugin, firstEntry(managed, having, [], held))), record);
  if (made !== record) await savePluginRecord(home, made);
  return made;
}

/**
 * One key's item (the header's table), its versions and own parts stored; none for the known miss. `atPlugin`: what the plugin's
 * files hold of the key now, read only where it decides.
 */
async function itemFor(context: ShareContext, { kind, library, tools, managed, disk }: KindRead, key: string, name: string, ofKey: OnRecord[], entry: PluginEntry,
  atPlugin: () => Promise<{ hash: string; content: unknown; at: string } | undefined>): Promise<LibraryItem | undefined> {
  const ours = ofKey.filter(({ install }) => install.plugin === entry.plugin && sameSource(install.source, entry.source));
  const except: HarnessId[] = [], applied = new Map<HarnessId, Content>(), unedited: Content[] = [], partCopies: Seen[] = [];
  const keptAt = (at: OnRecord) => ({ version: at.install.version, at: at.install.at });
  for (const tool of tools) {
    const at = ofKey.find(({ install }) => install.tool === tool), copy = disk.byKey.get(key)?.[tool], unseen = !!unseenIn(disk, tool, key);
    const partHere = at && ours.includes(at) && !at.part.removed && !takesPlugins(tool);
    if (!partHere) { if (!takesPlugins(tool) || copy || unseen) except.push(tool); continue; }
    if (!copy || unseen) { if (at.part.seen || unseen) except.push(tool); continue; }
    partCopies.push(copy);
    const kept = await keptOf[kind.kind](context, at);
    const content: Content = { hash: copy.hash, content: kind.contentOf(copy), ...keptAt(at) };
    if (kept ? copy.hash === kept.hash : unchangedByRecord[kind.kind](copy, at.part)) { applied.set(tool, content); unedited.push(content); }
    // Never in a tool not managed, though its identity may be on record (the MCP record's migration notes every tool's file; alpha 1
    // let a left-out tool's go only at its next pass): its edit stays its own whatever order the first pass takes (letGo, cameBack).
    else if (kept && managed.includes(tool) && library.folders[tool]) applied.set(tool, { ...kept, ...keptAt(at) });
    else except.push(tool);
  }
  // A tool the plugin is kept out of gets none of its items, whenever it appears (pluginlibrary.ts pluginOutOf, the same).
  for (const tool of entry.except) if (!takesPlugins(tool) && !applied.has(tool) && !except.includes(tool)) except.push(tool);
  const keptAll = async () => (await Promise.all(ours.map(async at => {
    const kept = await keptOf[kind.kind](context, at);
    return kept && { ...kept, ...keptAt(at) };
  }))).filter(each => !!each);
  const pool = unedited.length ? unedited : await keptAll();
  // The plugin's files are read only where they decide: no content, or contents that differ.
  const now = new Set(pool.map(each => each.hash)).size === 1 ? undefined : await atPlugin();
  const fromPlugin = now && { ...now, at: now.at || ours[0]?.install.at || versionAt(undefined) };
  const higher = (one: Content, other: Content) => (other.version ?? '').localeCompare(one.version ?? '', undefined, { numeric: true });
  const current = pool.find(each => each.hash === fromPlugin?.hash) ?? [...pool].sort(higher)[0] ?? fromPlugin;
  if (!current) return partCopies.length ? ownFromCopy(context, kind, library.items[key] ?? newItem(key, partCopies[0].name), partCopies[0], tools) : undefined;
  const item = library.items[key] ?? newItem(key, name);
  delete item.deleted;
  const link = pluginLink(entry.plugin, entry.marketName), contents = [...new Map([...applied.values(), current].map(each => [each.hash, each])).values()];
  for (const each of contents) await kind.store(context, item, each.hash, each.content);
  const made: Version[] = contents.filter(each => each !== current).map(each => ({ hash: each.hash, at: each.at, from: { how: 'source', link } }));
  Object.assign(item, { name, on: entry.on, hash: current.hash, source: entry.id, seen: current.hash, except: except.sort(byToolOrder),
    versions: [{ hash: current.hash, at: current.at, from: { how: 'source', link } }, ...made, ...item.versions],
    applied: Object.fromEntries([...applied].map(([tool, each]) => [tool, each.hash])) } satisfies Partial<LibraryItem>);
  for (const copy of partCopies) if (applied.has(copy.tool)) { const text = kind.ownOf(copy); if (text !== undefined) await kind.keepOwn(context, item, copy.tool, text); }
  return item;
}

/** His own item from a copy no content of the plugin's can stand for (the header): On there, kept out of every other managed tool. */
async function ownFromCopy(context: ShareContext, kind: Kind<unknown, Seen>, item: LibraryItem, copy: Seen, tools: HarnessId[]): Promise<LibraryItem> {
  await kind.store(context, item, copy.hash, kind.contentOf(copy));
  Object.assign(item, { name: copy.name, on: true, hash: copy.hash, except: tools.filter(tool => tool !== copy.tool), applied: { [copy.tool]: copy.hash },
    versions: [{ hash: copy.hash, at: versionAt(copy.at), from: { how: 'found', harness: copy.tool } }, ...item.versions] } satisfies Partial<LibraryItem>);
  delete item.deleted; delete item.source; delete item.seen;
  const text = kind.ownOf(copy);
  if (text !== undefined) await kind.keepOwn(context, item, copy.tool, text);
  return item;
}

/** Where the record goes: plugin-parts.v1.json, or the first free name beside it (a home migrated before, whose record came back). */
async function besideOld(home: string): Promise<string> {
  for (let count = 1; ; count++) {
    const path = join(storeDirectory(home), count === 1 ? 'plugin-parts.v1.json' : `plugin-parts.v1-${count}.json`);
    if (!(await exists(path))) return path;
  }
}
