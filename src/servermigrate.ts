// The MCP record from before the library (mcp.json format 1: each tool's settings file was the truth, and Central Knot recorded
// which servers it synced, where, and at what content) made into library items, by serverstore.ts openLibrary: in memory at
// each look until the first pass that may write saves the result.
//
// The rule: no settings file that is there changes because of the migration (one the old record had as away is written afresh
// by the first pass), and every content kept before, or in a tool now, is a version.
//
//   on the old record                                    in the library
//   synced (`state: 'shared'`)                           On at its synced content; each recorded copy has what was last
//                                                        synced there applied, so a copy that is behind (Claude Code
//                                                        waiting for Write) is still owed it, and an edit not spread yet is
//                                                        taken in by the first pass, as the earlier engine would have
//   a copy whose file was missing at the last look       nothing applied there: an entry missing there is written afresh,
//     (`away`)                                           never read as deleted by hand
//   a tool it was left out of (`off`)                    that tool kept out, nothing applied: an entry there stays
//   a tool holding a differing entry never recorded      that tool kept out, nothing applied: the entry stays as it is
//     (a same-name collision waiting for a choice)
//   a copy recorded in another settings file (a moved    nothing applied there
//     config root)
//   deleted everywhere (`deleted`)                       a tombstone at the content it had; a removal still owed (`status:
//                                                        'removing'`, Claude Code's waiting for Write) stays applied while
//                                                        the entry is as it was, so it still goes once it can
//   kept separate, never synced, or turned off since     not in the library: found, every entry as it is
//   entries displaced by a pass that stopped part-way    versions (they are kept in the old store)
//
// Every server kept under items/mcp/<name>/<hash>.json is a version; each tool's latest own fields kept for the current
// content (<hash>/<tool>.json) become that tool's own part, so On or Restore writes them back. The fixed copies History named
// (<hash>/<tool>-<ref>.json) are not carried: the old folder stays as the backup. Each tool's settings file becomes the
// library's `folders` (away where it is missing), so the first pass's guard reads a missing file as away, never as deletions.
// `missingSince` is dropped. A server of which no content is left anywhere gets no item. Two old names that differ only by
// case are one item now (library.ts itemKey): the first, in the order the old record lists them, keeps its place, and the
// other's kept contents become its versions.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { newItem, type LibraryItem, type Origin } from './library.ts';
import { sharedFileSeen, type KindLibrary } from './librarypass.ts';
import { mcpFile, ownText, readTool, serverHash, type McpEntry, type NeutralServer } from './mcp.ts';
import { mcpTools } from './presence.ts';
import { itemKey, sha256, storeDirectory, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/** A copy on the old record: `removing`, a removal a deletion still owed; `away`, its file was missing at the last look; `file`, where it was. */
interface OldCopy { tool: HarnessId; hash: string; file?: string; status?: 'removing'; away?: boolean }
/** A server on the old record, keyed by its name as written. */
interface OldItem {
  state: 'shared' | 'dont-share'; off: HarnessId[]; hash: string; copies: OldCopy[]; separate?: boolean;
  deleted?: { at: string; tool: HarnessId; hash: string };
  displaced?: { tool: HarnessId; hash: string }[];
}
export interface OldServerRecord { formatVersion: number; items: Record<string, OldItem> }

export function isOldRecord(record: unknown): record is OldServerRecord {
  const items = (record as Partial<OldServerRecord> | null)?.items;
  const isItem = (item: Partial<OldItem> | null) =>
    !!item && typeof item === 'object' && typeof item.state === 'string' && Array.isArray(item.off) && Array.isArray(item.copies);
  return !!items && Object.values(items).every(isItem);
}

/** One content kept before the library: the server, when it was kept, and each tool's own fields kept with it. */
export interface KeptServer { hash: string; server: NeutralServer; at: number; own: Partial<Record<HarnessId, string>> }

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * One old server as a library item, from what is kept of it (`kept`) and each tool's entry now (`onDisk`, in tools whose file
 * reads; `files`: each tool's settings file now); undefined when it is not one (found) or no content of it is left. Pure:
 * the worked examples are tests/servermigrate.test.ts.
 */
export function migrateItem(name: string, old: OldItem, kept: KeptServer[], onDisk: McpEntry[], files: Partial<Record<HarnessId, string>>): LibraryItem | undefined {
  const synced = old.state === 'shared', deleted = !synced ? old.deleted : undefined;
  if (!synced && !deleted) return undefined;
  const contents = new Map<string, { at: number; from: Origin }>(kept.map(content => [content.hash, { at: content.at, from: { how: 'migrated' } }]));
  for (const entry of onDisk) if (!contents.has(entry.hash)) contents.set(entry.hash, { at: 0, from: { how: 'was-in', harness: entry.tool } });
  const current = deleted?.hash ?? old.hash;
  if (!contents.has(current)) return undefined;
  const item: LibraryItem = { ...newItem(itemKey(name), name), on: true, hash: current };
  if (deleted) item.deleted = { at: deleted.at };
  // The order the library takes them in: the current one last taken (first), then the others newest first.
  const versions = [...contents].map(([hash, { at, from }]) => ({ hash, at: iso(at), from })).sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  item.versions = [...versions.filter(version => version.hash === current), ...versions.filter(version => version.hash !== current)];
  const leftOut = new Set(old.off);
  for (const copy of old.copies) {
    const here = onDisk.find(entry => entry.tool === copy.tool);
    // A copy recorded in a file its tool no longer uses (a moved config root) was let go by the earlier engine.
    if (copy.file && copy.file !== files[copy.tool]) continue;
    // A removal still owed goes once it can, while the entry is the one it was owed for.
    if (copy.status === 'removing') { if (!synced && here?.hash === copy.hash) item.applied[copy.tool] = copy.hash; }
    else if (synced && !leftOut.has(copy.tool) && !copy.away) item.applied[copy.tool] = copy.hash;
  }
  // An entry that differs and was never on record: the earlier engine held for a choice of copy and wrote nothing there.
  if (synced) for (const entry of onDisk) if (item.applied[entry.tool] === undefined && entry.hash !== current) leftOut.add(entry.tool);
  item.except = [...leftOut];
  for (const [tool, text] of Object.entries(kept.find(content => content.hash === current)?.own ?? {})) item.own[tool as HarnessId] = sha256(text);
  return item;
}

/** What is kept of one server from before the library: `<hash>.json` per content, with each tool's own fields in `<hash>/<tool>.json`. */
async function readKept(context: ShareContext, name: string): Promise<KeptServer[]> {
  const base = join(storeDirectory(context.home), 'items', 'mcp', encodeURIComponent(name));
  const found: KeptServer[] = [];
  for (const file of (await readdir(base).catch(() => [] as string[])).filter(entry => /^[0-9a-f]{64}\.json$/.test(entry))) {
    const hash = file.slice(0, -'.json'.length);
    let server: NeutralServer;
    try { server = JSON.parse(await readFile(join(base, file), 'utf8')); } catch { continue; }
    if (!server || typeof server !== 'object' || serverHash(server) !== hash) continue;
    const own: KeptServer['own'] = {};
    for (const tool of mcpTools) {
      const text = await readFile(join(base, hash, `${tool}.json`), 'utf8').catch(() => undefined);
      const extras = text === undefined ? undefined : (() => { try { return JSON.parse(text).extras; } catch { return undefined; } })();
      if (extras && typeof extras === 'object') own[tool] = ownText({ name, extras });
    }
    found.push({ hash, server, at: await stat(join(base, file)).then(info => info.mtimeMs, () => 0), own });
  }
  return found;
}

/** A migrated record: its items and folders, and the versions the new store needs, and each tool's own fields for them. */
export interface Migrated {
  items: Record<string, LibraryItem>;
  folders: KindLibrary['folders'];
  versions: { key: string; server: NeutralServer }[];
  own: { key: string; text: string }[];
}

/** The whole old record as library items. Reads the old store and every tool's settings file; writes nothing. */
export async function migrateServers(context: ShareContext, old: OldServerRecord): Promise<Migrated> {
  const migrated: Migrated = { items: Object.create(null), folders: {}, versions: [], own: [] };
  // Every tool's settings file in this home is read, managed or not: an entry is left alone wherever it is.
  const onDisk: McpEntry[] = [], files: Partial<Record<HarnessId, string>> = {};
  for (const tool of mcpTools) {
    const file = mcpFile(context, tool), read = await readTool(context, tool);
    files[tool] = file;
    migrated.folders[tool] = sharedFileSeen(file, read.exists);
    onDisk.push(...read.entries);
  }
  for (const [name, was] of Object.entries(old.items)) {
    const key = itemKey(name), kept = await readKept(context, name), known = migrated.items[key];
    const here = onDisk.filter(entry => entry.name === name);
    // A second old name for the same key: its kept contents are versions of the first.
    const item = known ?? migrateItem(name, was, kept, here, files);
    if (!item) continue;
    migrated.items[key] = item;
    for (const content of kept) {
      migrated.versions.push({ key, server: content.server });
      if (known && !known.versions.some(version => version.hash === content.hash)) known.versions.push({ hash: content.hash, at: iso(content.at), from: { how: 'migrated' } });
    }
    if (known) continue;
    for (const entry of here) if (!kept.some(content => content.hash === entry.hash)) migrated.versions.push({ key, server: entry.server });
    for (const text of Object.values(kept.find(content => content.hash === item.hash)?.own ?? {})) migrated.own.push({ key, text });
  }
  return migrated;
}
