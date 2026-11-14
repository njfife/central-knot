// MCP servers on Central Knot's library: the adapter for one kind. Read library.ts first (the model, and the one rule for an
// item in the library), then librarypass.ts (the pass, the same for every kind, and `Kind`, the contract a kind implements).
// This module is the servers' Kind (serverKind) and nothing the pass does itself:
// - a copy is one entry in a tool's settings file (mcp.ts mcpFile), which holds other things too: read, written and removed
//   through mcp.ts, which keeps every other byte of the file. A version is the entry's shared part (mcp.ts NeutralServer,
//   hashed by serverHash); everything else is that tool's own: its name there, its place (OpenCode's), its own fields and,
//   in Codex, the comment lines of its table. That is kept per tool as its own part (mcp.ts OwnPart, serverstore.ts keepOwn) and put
//   back with the entry, so Off then On gives each tool back its entry. An entry has no time of its own (library.ts: of two
//   edits the first tool wins).
// - what is never taken in (readDisk, Disk.unseen with its reason): a server that belongs to an app (mcp.ts hostBound), an
//   entry in a form Central Knot doesn't edit, two names in one file that differ only by case, and an entry Central Knot wrote
//   as a plugin's part (parts.ts), which is the plugin's. A settings file that can't be read or parsed makes the whole tool
//   unseen; a missing one is away (folderSeen), so its entries are written back once it can be, never read as deletions.
// - why a tool can't be given a server (Disk.held): it can't hold its transport (mcp.ts cannotHold), or it has the server
//   through a plugin and no entry of its own.
// - Claude Code's file is written only by Write to Claude Code (writeToClaude), with Claude closed: until then its writes and
//   removals wait (Disk.locked `waits`), and each row that owes one says so (`waits`). Write to Claude Code runs the kind
//   built the other way round: Claude Code's file open, every other tool's writes waiting for the next pass.
// - a tool's own switch for a server (mcpswitch.ts) is read at each look for its mark (`switchedOff`) and never written by a
//   pass. Where it lives inside the entry (Codex, Pi, OpenCode) it is that tool's own field, so it comes back with the entry.
//   One write follows a pass: Claude Code's deny of a server the profiles migration turned Off was kept, so the server doesn't
//   start there before Write to Claude Code takes its entry out, and is cleared once the server is wanted there (releaseKeptDenies).
// Around the pass: applyServers, writeToClaude and restoreServer run it (the page's clicks);
// serversView is the MCP servers page's reading (types.ts LibraryView); serversForRepo is what the Git repo's Push sends. Elsewhere: the formats, mcp.ts; where things are kept and
// the migration from the earlier record, serverstore.ts and servermigrate.ts; the row and its words, libraryrow.ts with
// librarypages.ts; History's sentences and actions, historyactions.ts.
import { readFile, stat } from 'node:fs/promises';
import { libraryAction } from './historyactions.ts';
import { listed, noteAgainst, pendingEdits, plan, wantedIn } from './library.ts';
import type { LibraryItem, Version, VersionChange } from './library.ts';
import { copiesOf, leavingIn, lookFor, restore, runPass, sharedFileSeen, takeInAnswers, type Disk, type Kind, type Look, type PassOptions, type Wanted } from './librarypass.ts';
import { libraryWords, writesWait } from './libraryrow.ts';
import { cannotHold, editEntry, mcpFile, ownText, readTool, recoverSettings, serverHash, type McpEntry, type NeutralServer } from './mcp.ts';
import { mcpDisabled, mcpSwitchPath, readMcpSwitches, withMcpSwitch } from './mcpswitch.ts';
import { throughPlugins } from './plugins.ts';
import { mcpTools } from './presence.ts';
import { keepDenies, keepOwn, keptDenies, keptOwn, openLibrary, readVersion, recordedServers, saveLibrary, storeVersion } from './serverstore.ts';
import { errorCode, itemKey, readParts, syncGate, writeAccess, writeFileChecked, type ShareContext } from './share.ts';
import type { SwitchFile } from './skillswitch.ts';
import type { Change, HarnessId, LibraryFacts, LibraryView, PassResult, SyncNotice, ThroughPlugin, ToolCopy } from './types.ts';
import { throughPlugin, toolName } from './words.ts';

/** A server in one line, as its row and the copy question say it: "Command · npx -y docs", or "HTTP · https://…". */
export const summary = (server: NeutralServer) =>
  (server.transport === 'stdio' ? `Command · ${[server.command, ...(server.args ?? [])].filter(Boolean).join(' ')}` : `${server.transport.toUpperCase()} · ${server.url ?? ''}`);

/** Why Claude Code's writes wait: said on its line, and as each write's result until Write to Claude Code. */
export const CLAUDE_WAITS = 'Claude Code rewrites this file while it runs, so Central Knot writes it only when you click Write to Claude Code, with Claude closed.';

// ---------- What the tools hold ----------

/** What the managed tools hold of MCP servers now (librarypass.ts Disk), and what the page and the held reasons read besides. */
interface ServerDisk extends Disk<McpEntry> {
  /** Each content's shape, by its hash: every version in the library and every entry a tool has (whether a tool can hold it). */
  shapes: Map<string, NeutralServer>;
  /** The names of servers seen only in a form never taken in (Disk.unseen says why), by key: each a row. */
  unseenNames: Map<string, string>;
  /** What each tool has through its installed plugins, by key (only a server Central Knot installed elsewhere as that plugin's part). */
  through: Map<HarnessId, Map<string, ThroughPlugin>>;
  /** Each tool's own switch file for servers, read once (mcpswitch.ts). */
  switches: Map<HarnessId, SwitchFile>;
  switchedOff: Map<string, HarnessId[]>;
}
type ServerLook = Look<NeutralServer, McpEntry, ServerDisk>;

/**
 * Reads each managed tool's settings file. `writeClaude`: the pass is Write to Claude Code's, which writes Claude Code's file
 * alone (every other tool's writes and removals are left for the next pass); otherwise Claude Code's wait.
 */
async function readDisk(context: ShareContext, managed: HarnessId[], writeClaude: boolean): Promise<ServerDisk> {
  const disk: ServerDisk = {
    byKey: new Map(), unseen: new Map(), locked: new Map(), problems: [], shapes: new Map(), unseenNames: new Map(), switchedOff: new Map(),
    through: await serversThroughPlugins(context, managed), switches: await readMcpSwitches(context, managed),
    held: (item, tool) => {
      const given = disk.through.get(tool)?.get(item.key);
      if (given) return { why: throughPlugin(tool, given, 'MCP server') };
      const why = cannotTake(disk, item, tool);
      return why ? { why } : undefined;
    },
    // A tool that can't hold the current version (an SSE server, in Codex) keeps the entry it has.
    refuses: (item, tool) => cannotTake(disk, item, tool),
  };
  const parts = await readParts(context.home);
  for (const tool of managed) {
    const read = await readTool(context, tool), file = mcpFile(context, tool);
    if (read.problem) { disk.unseen.set(`${tool}:*`, read.problem); disk.problems.push(read.problem); continue; }
    const asPart = new Set(parts.filter(install => install.tool === tool).flatMap(install => install.items.filter(part => part.kind === 'mcp' && !part.removed).map(part => part.name)));
    const notTaken = (name: string, why: string) => { disk.unseen.set(`${tool}:${itemKey(name)}`, why); disk.unseenNames.set(itemKey(name), name); };
    for (const name of read.invalid ?? []) {
      notTaken(name, `${toolName(tool)}’s entry for it is not written in a form Central Knot edits, so it is left alone.`);
      disk.problems.push(`${file}: “${name}” is not written as a server entry Central Knot can edit, so it is left alone.`);
    }
    const part = `${toolName(tool)} has it as part of a plugin Central Knot installed there, so it is the plugin’s.`;
    const twice = `Two servers whose names differ only by case are in ${toolName(tool)}’s settings. Rename one so Central Knot can tell them apart.`;
    const seen = new Map<string, McpEntry>();
    for (const entry of read.entries) {
      const key = itemKey(entry.name);
      const why = entry.hostBound ?? (asPart.has(entry.name) ? part : seen.has(key) || disk.unseen.has(`${tool}:${key}`) ? twice : undefined);
      if (why) notTaken(entry.name, why); else seen.set(key, entry);
    }
    // A name seen twice is unseen for both entries.
    for (const [key, entry] of seen) if (!disk.unseen.has(`${tool}:${key}`)) disk.byKey.set(key, { ...disk.byKey.get(key), [tool]: entry });
    if (writesWait('mcp', tool) !== writeClaude) disk.locked.set(tool, { why: writeClaude ? 'Write to Claude Code writes only Claude Code’s settings.' : CLAUDE_WAITS, waits: true });
  }
  for (const item of Object.values(await recordedServers(context.home))) for (const { hash } of item.versions) {
    const version = await readVersion(context, item.key, hash);
    if (version) disk.shapes.set(hash, version);
  }
  for (const slot of disk.byKey.values()) for (const entry of Object.values(slot)) disk.shapes.set(entry.hash, entry.server);
  // Each entry its tool's own switch turns off there, read for its mark and for the rule (librarypass.ts Disk.switchedOff).
  for (const [key, slot] of disk.byKey) {
    const off = Object.values(slot).filter(entry => { const file = disk.switches.get(entry.tool); return !!file && !file.problem && mcpDisabled(entry.tool, file.text, entry.name); });
    if (off.length) disk.switchedOff.set(key, off.map(entry => entry.tool));
  }
  return disk;
}

/**
 * Why a tool can't be given the server (mcp.ts cannotHold: SSE in Codex, Pi and OpenCode, no command, no URL), as this pass's
 * clicks left it: its current version (Make current may have just changed it), or a found server's copy.
 */
const cannotTake = (disk: ServerDisk, item: Wanted, tool: HarnessId) => {
  const hash = item.hash ?? Object.values(disk.byKey.get(item.key) ?? {}).find(Boolean)?.hash, shape = hash && disk.shapes.get(hash);
  return shape ? cannotHold(tool, shape) : undefined;
};

/**
 * The servers each tool has through its installed plugins, by key: such a tool gets no entry of its own beside the plugin's.
 * Only a server Central Knot installed elsewhere as that plugin's part counts: a name alone could be another server.
 */
async function serversThroughPlugins(context: ShareContext, tools: HarnessId[]): Promise<ServerDisk['through']> {
  const all = await throughPlugins(context, tools, 'mcp');
  return new Map([...all].map(([tool, given]) => [tool, new Map([...given].flatMap(([key, { asParts, text: _text, ...plugin }]) => (asParts ? [[key, plugin] as const] : [])))]));
}

// ---------- The servers' Kind ----------

/**
 * MCP servers as a kind of item (librarypass.ts Kind): one entry per server in each tool's settings file. `writeClaude`: the
 * kind Write to Claude Code runs, with Claude Code's file open to writes and every other tool's waiting; every other pass uses
 * serverKind, where Claude Code's wait.
 */
function kindFor(writeClaude: boolean): Kind<NeutralServer, McpEntry, ServerDisk> {
  return {
    kind: 'mcp',
    // The item and its copy as the page names them (libraryrow.ts libraryWords); a tool's file of them only the pass says.
    words: { item: libraryWords.mcp.item, copy: libraryWords.mcp.copy, folder: 'settings file' },
    // History's MCP entries were keyed `mcp:<name>` before the library, and still are (by the server's key now).
    historyPrefix: 'mcp:',
    harnesses: tools => tools.filter(tool => mcpTools.includes(tool)),
    folder: mcpFile,
    // Every server of a tool is in one file: the settle clock is kept per entry.
    pathOf: (context, tool, name) => `${mcpFile(context, tool)}#${itemKey(name)}`,
    folderSeen: async (context, tool) => sharedFileSeen(mcpFile(context, tool), await stat(mcpFile(context, tool)).then(() => true, () => false)),
    open: openLibrary,
    save: saveLibrary,
    store: (context, item, _hash, server) => storeVersion(context, item.key, server),
    readVersion,
    hashOf: serverHash,
    recover: recoverSettings,
    read: (context, managed) => readDisk(context, managed, writeClaude),
    contentOf: entry => entry.server,
    ownOf: entry => ownText({ name: entry.name, place: entry.place, extras: entry.extras }),
    keepOwn,
    write: writeServer,
    refusesToLoad: async (_context, _item, tool, server) => cannotHold(tool, server),
    remove: async (context, _item, here) => {
      context.fault?.('before-remove');
      const stopped = await editEntry(context, here.tool, here.name, here.hash, undefined);
      return !stopped ? 'removed' : stopped.changed ? 'changed' : 'failed';
    },
    historyAction: libraryAction,
  };
}
/** The servers' Kind for every pass but Write to Claude Code's: Claude Code's writes and removals wait. */
export const serverKind = kindFor(false);

/**
 * Writes a version into one tool's settings file: over its entry (only while that holds what was read), the tool's own
 * fields as they are there now; else as the entry the tool last had (its kept own part: its name, place and own fields), or
 * a new one under the item's name. What it wrote is kept as that tool's own part by the next pass that reads it, before any
 * removal there (librarypass.ts syncItem keepOwn).
 */
async function writeServer(context: ShareContext, item: LibraryItem, tool: HarnessId, here: McpEntry | undefined, server: NeutralServer) {
  context.fault?.('before-rename');
  const kept = here ? undefined : await keptOwn(context, item, tool);
  const stopped = await editEntry(context, tool, here?.name ?? kept?.name ?? item.name, here?.hash, server, kept?.extras, kept?.place);
  return stopped && { stopped: stopped.stopped };
}

// ---------- The pass, for servers ----------

/** What Pull brings for one server (gitrepo.ts): its name and shared part, or its removal. */
export type PulledServer = { name: string; server: NeutralServer } | { removed: true };
type ServerPassOptions = Omit<PassOptions<NeutralServer>, 'pulled'> & { pulled?: Map<string, PulledServer> };

/** One pass over the servers (librarypass.ts runPass): the page's clicks in `changes`, then every server brought into line. */
export async function applyServers(context: ShareContext, tools: HarnessId[], changes: Change[], options: ServerPassOptions = {}): Promise<PassResult> {
  const pulled = options.pulled && new Map([...options.pulled].map(([key, brought]) =>
    [key, 'removed' in brought ? brought : { name: brought.name, content: brought.server }] as const));
  return releaseKeptDenies(context, tools, await runPass(serverKind, context, tools, changes, { ...options, pulled }));
}

/**
 * After a pass that ran (`done`): Claude Code's deny of each server the profiles migration kept it for (serverstore.ts
 * keptDenies) is cleared once the server is wanted in Claude Code, so it is never left switched off there once it is On; it
 * stays while the server is Off, kept out of Claude Code or deleted, where its entry may still wait for Write to Claude Code.
 * A settings file that can't be read or changed meanwhile keeps the deny for the next pass.
 */
async function releaseKeptDenies(context: ShareContext, tools: HarnessId[], done: PassResult): Promise<PassResult> {
  const kept = done.stopped || !tools.includes('claude-cli') ? [] : await keptDenies(context.home);
  if (!kept.length) return done;
  const { library } = await openLibrary(context);
  const wanted = kept.filter(name => { const item = library.items[itemKey(name)]; return !!item && wantedIn(item, 'claude-cli'); });
  if (!wanted.length) return done;
  const file = mcpSwitchPath(context, 'claude-cli');
  try {
    const text = await readFile(file, 'utf8').catch(error => { if (errorCode(error) === 'ENOENT') return ''; throw error; });
    const cleared = wanted.reduce((now, name) => withMcpSwitch('claude-cli', now, name, false), text);
    if (cleared !== text) await writeFileChecked(file, cleared, text);
    await keepDenies(context.home, kept.filter(name => !wanted.includes(name)));
  } catch { /* the next pass tries again */ }
  return done;
}

/**
 * Write to Claude Code, with Claude closed (main.ts checks): a pass for the servers named (the rows that owe Claude Code a
 * write or a removal), with Automatic sync on or off, that writes Claude Code's file alone; it says only what it did there.
 * Its Undo is the library's: Make current an earlier version, then Write again.
 */
export async function writeToClaude(context: ShareContext, tools: HarnessId[], keys: string[]): Promise<PassResult> {
  const done = await releaseKeptDenies(context, tools, await runPass(kindFor(true), context, tools, [], { only: new Set(keys) }));
  return { ...done, results: done.results.filter(result => result.harness === 'claude-cli') };
}

/** A History entry's action on a server (librarypass.ts restore; historyactions.ts says which click it is). */
export const restoreServer = async (context: ShareContext, tools: HarnessId[], eventId: string, version?: string) =>
  releaseKeptDenies(context, tools, await restore(serverKind, context, tools, eventId, version));

// ---------- For the callers around a pass ----------

/** One version's content, for the MCP servers page to show: undefined when the store no longer has it. */
export const serverVersion = (context: ShareContext, key: string, hash: string) => readVersion(context, key, hash);

/** The servers that are On in the library, by key (plugin parts ask which servers Central Knot keeps in step: parts.ts). */
export async function serversOn(context: ShareContext): Promise<Map<string, LibraryItem>> {
  const { library } = await openLibrary(context);
  return new Map(Object.values(library.items).filter(item => item.on && !item.deleted).map(item => [item.key, item]));
}

/**
 * What the Git repo holds for each server in the library, On or Off (gitrepo.ts Push): its current version, or the edit a
 * tool holds that no pass has taken in yet (it goes as a click's own pass would take it in; no tool is written), none when
 * the store no longer has it; with Claude Code's own fields for it where Central Knot has them.
 */
export async function serversForRepo(context: ShareContext, tools: HarnessId[]): Promise<{ item: LibraryItem; server?: NeutralServer; claudeOwn?: Record<string, unknown> }[]> {
  const { look, live } = await lookFor(serverKind, context, tools);
  return Promise.all(live.map(async item => {
    const slot = look.disk.byKey.get(item.key) ?? {}, takeIn = plan(item, copiesOf(look, item)).takeIn;
    const server = (takeIn ? slot[takeIn]?.server : undefined) ?? await readVersion(context, item.key, item.hash);
    return { item, server, claudeOwn: slot['claude-cli']?.extras ?? (await keptOwn(context, item, 'claude-cli'))?.extras };
  }));
}

// ---------- View ----------

/** The parts of a server a version's note names, in the order a sentence lists them. */
const PARTS: [keyof NeutralServer, string][] = [['transport', 'transport'], ['command', 'command'], ['args', 'arguments'], ['env', 'environment'], ['cwd', 'working folder'], ['url', 'URL'], ['headers', 'headers']];
const changedParts = (was: NeutralServer, is: NeutralServer) => PARTS.filter(([part]) => JSON.stringify(was[part] ?? null) !== JSON.stringify(is[part] ?? null)).map(([, words]) => words);

/** Each version's note (library.ts VersionChange), as agents.ts changesOf says it for an agent's fields. */
async function changesOf(context: ShareContext, item: LibraryItem): Promise<VersionChange[]> {
  const compare = async (version: Version, against: string) => {
    const [was, is] = await Promise.all([readVersion(context, item.key, against), readVersion(context, item.key, version.hash)]);
    return was && is ? changedParts(was, is) : undefined;
  };
  return Promise.all(listed(item).map(async (version): Promise<VersionChange> => {
    const basis = noteAgainst(item, version);
    if (typeof basis === 'string') return basis;
    const parts = await compare(version, basis.against);
    return !parts ? 'unknown' : basis.how === 'differs' ? { differs: parts } : { changed: parts };
  }));
}

/**
 * The MCP servers page's rows: every server in the library (On, or Off: in Central Knot only), every one found in a managed
 * tool, and every one seen only in a form never taken in (it says why). `library` gives the page and History each item as the
 * library holds it, deleted ones too.
 */
export async function serversView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<LibraryView> {
  const { look, live, problem } = await lookFor(serverKind, context, tools);
  const { library, managed } = look;
  const keys = [...new Set([...look.disk.byKey.keys(), ...look.disk.unseenNames.keys(), ...live.map(item => item.key)])].sort((first, second) => first.localeCompare(second));
  const items: LibraryFacts[] = [];
  for (const key of keys) items.push(await rowFacts(look, key, live.find(item => item.key === key)));
  const gate = problem ? { state: 'stopped' as const, reason: problem } : await syncGate(context);
  const problems = problem ? [problem, ...look.disk.problems] : look.disk.problems;
  return { tools: managed, items, library: library.items, access: await writeAccess(context), gate, problems, notices };
}

/** One entry as the page shows it (types.ts ToolCopy): the copy question quotes its summary; `ownPart` names its own fields. */
const toolCopy = (entry: McpEntry): ToolCopy => ({
  hash: entry.hash, directory: entry.file, rootLabel: toolName(entry.tool), lines: 0, modified: '', summary: summary(entry.server), writable: true,
  folder: entry.name, ownPart: Object.keys(entry.extras).filter(key => !key.startsWith('#')).map(key => key.replace(/^\[(.*)\]$/, '$1')),
});

/**
 * One server's row: what each managed tool holds and, for a server in the library, what the next pass does in each (`plan`,
 * from the same reading a pass makes: copiesOf) and why nothing can happen in one (`unseen`, `cannot`); the tools where a write
 * or removal waits for Write to Claude Code (`waits`, a deleted server's too, whose row is a found one), and each tool's own
 * switch (`switchedOff`).
 */
async function rowFacts(look: ServerLook, key: string, item: LibraryItem | undefined): Promise<LibraryFacts> {
  const disk = look.disk, slot = disk.byKey.get(key) ?? {};
  const entries = look.managed.flatMap(tool => (slot[tool] ? [slot[tool]!] : []));
  const name = item?.name ?? entries[0]?.name ?? disk.unseenNames.get(key) ?? key;
  const copies = Object.fromEntries(entries.map(entry => [entry.tool, toolCopy(entry)]));
  const copiesNow = item ? copiesOf(look, item) : undefined, made = item && copiesNow ? plan(item, copiesNow) : undefined;
  const tombstone = item ? undefined : look.library.items[key];
  const cannot: LibraryFacts['cannot'] = {}, plugin: NonNullable<LibraryFacts['plugin']> = {}, unseen: NonNullable<LibraryFacts['unseen']> = {};
  // A found server is asked about as taking it in would leave it: On everywhere, nothing applied yet.
  const asIf: Wanted = item ?? { key, name, on: true, except: [], applied: {} };
  for (const tool of look.managed) {
    const given = disk.through.get(tool)?.get(key);
    if (given && !slot[tool]) plugin[tool] = given;
    const copy = copiesNow?.[tool], hidden = copy?.is === 'unseen' ? copy.why : !copiesNow ? disk.unseen.get(`${tool}:${key}`) ?? disk.unseen.get(`${tool}:*`) : undefined;
    if (hidden) unseen[tool] = hidden;
    const why = copy?.is === 'held' ? copy.why : slot[tool] ? undefined : disk.held(asIf, tool)?.why;
    const touched = made?.write.includes(tool) || made?.remove.includes(tool);
    if (why && (copy?.is === 'held' || touched || (!copiesNow && !slot[tool]))) cannot[tool] = why;
  }
  // Where a write or removal waits for Write to Claude Code: the plan's, or a deleted server's copy still to leave (leavingIn).
  const waits = made ? look.managed.filter(tool => disk.locked.get(tool)?.waits && (made.write.includes(tool) || made.remove.includes(tool)))
    : tombstone ? leavingIn(look, tombstone) : [];
  const switchedOff = disk.switchedOff.get(key) ?? [];
  const switchProblem = Object.fromEntries(entries.flatMap(entry => { const problem = disk.switches.get(entry.tool)?.problem; return problem ? [[entry.tool, problem]] : []; }));
  const edited = made ? pendingEdits(made) : [];
  const shape = item ? await readVersion(look.context, key, item.hash) : entries[0]?.server;
  const some = (field: string, value: object) => (Object.keys(value).length ? { [field]: value } : {});
  return {
    key, name, description: shape ? summary(shape) : '', copies, on: !!item?.on, except: item?.except ?? [], cannot, edited,
    // The copies a tool managed again gives way with are kept before the plan, by the pass (librarypass.ts cameBack): said with it.
    ...(made && item ? { plan: { ...made, keep: [...made.keep, ...(look.givingWay.get(key) ?? [])] }, versionChanges: await changesOf(look.context, item) }
      : { takeInAnswers: takeInAnswers(look, key) }),
    ...some('plugin', plugin), ...some('unseen', unseen), ...some('waits', waits), ...some('switchedOff', switchedOff), ...some('switchProblem', switchProblem),
  };
}
