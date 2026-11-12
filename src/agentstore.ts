// Where the agents' part of Central Knot's library (library.ts) is kept, inside the home's `.central-knot/`:
//
//   agents.json                               the record: each agent as a LibraryItem, and each harness's agents folder as last seen
//   agents.v2.json                            the record from before the library, as it was (agentmigrate.ts made the new one from it)
//   items/agents/<key>/versions/<hash>.json   one version's content: the shared part (name, description, prompt)
//   items/agents/<key>/own/<file hash>.txt    one harness's whole file, kept when Central Knot took it out: that harness's own part
//   items/agents/<key>/<hash>/…               files kept before the library; read once by the migration, never deleted
//
// Every file under items/ is named by what it holds, so a second file never replaces a first, and nothing here is pruned.
// agents.ts is the only caller that changes an item; this module only reads and writes what it is given.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { agentHash, agentText, parseAgent, type AgentEntry, type SharedAgent } from './agentfiles.ts';
import { isOldRecord, migrateAgents, type OldAgentRecord } from './agentmigrate.ts';
import { isLibraryItem, type LibraryItem, type Shelf } from './library.ts';
import { NOTHING_CHANGED, errorCode, exists, sha256, storeDirectory, writeDurably, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/** A harness's agents folder as a full pass last saw it: where it is, and its identity on disk (`away`: it wasn't there). */
export type FolderSeen = { path: string } & ({ away: true } | { ino: number; birth: number });
export interface AgentLibrary { formatVersion: number; items: Record<string, LibraryItem>; folders: Partial<Record<HarnessId, FolderSeen>> }

/** Format 3 is the library's. Format 2 (agentmigrate.ts) and 1 (before agents were rewritten: nothing to carry over) are migrated. */
const FORMAT_VERSION = 3;
const recordPath = (home: string) => join(storeDirectory(home), 'agents.json');
const backupPath = (home: string, version: number) => join(storeDirectory(home), `agents.v${version}.json`);
const emptyLibrary = (): AgentLibrary => ({ formatVersion: FORMAT_VERSION, items: {}, folders: {} });

type Inspected = { library: AgentLibrary } | { older: OldAgentRecord; text: string } | { problem: string } | Record<string, never>;
/** Reads the record as it is. Unreadable, damaged or newer is a `problem` that stops every write; the file is never touched. */
async function inspect(home: string): Promise<Inspected> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: `The agents record could not be read. ${NOTHING_CHANGED}` }; }
  const damaged = { problem: `The agents record is damaged. ${NOTHING_CHANGED}` };
  try {
    const record = JSON.parse(text) as Partial<AgentLibrary> | null;
    const version = record?.formatVersion;
    if (!Number.isInteger(version) || version! < 1 || !record!.items || typeof record!.items !== 'object' || Array.isArray(record!.items)) return damaged;
    if (version! > FORMAT_VERSION) return { problem: `The agents record was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    if (version! < FORMAT_VERSION) return isOldRecord(record) ? { older: record, text } : damaged;
    return Object.values(record!.items).every(isLibraryItem) ? { library: { formatVersion: FORMAT_VERSION, items: record!.items, folders: record!.folders ?? {} } } : damaged;
  } catch { return damaged; }
}

/**
 * The agents' library in this home; empty when nothing is recorded yet. A record from before the library is migrated on the
 * way (agentmigrate.ts): only in memory for a reader, and written by the first caller that may write (`persist`), in an order
 * that leaves the old record and its kept files as they were whatever stops it: the new contents first (new names only), then
 * the old record's copy, then the new record in its place.
 */
export async function openLibrary(context: ShareContext, persist = false): Promise<{ library: AgentLibrary; problem?: string }> {
  const read = await inspect(context.home);
  if ('problem' in read) return { library: emptyLibrary(), problem: read.problem };
  if ('library' in read) return { library: read.library };
  if (!('older' in read)) return { library: emptyLibrary() };
  const migrated = await migrateAgents(context, read.older);
  const library: AgentLibrary = { ...emptyLibrary(), items: migrated.items };
  if (!persist) return { library };
  for (const { key, hash, agent } of migrated.versions) await storeVersion(context, key, hash, agent);
  for (const { key, text } of migrated.own) await storeOwn(context, key, text);
  context.fault?.('before-replace');
  await writeDurably(backupPath(context.home, read.older.formatVersion), read.text);
  context.fault?.('mid-replace');
  await saveLibrary(context.home, library);
  return { library };
}

export const saveLibrary = (home: string, library: AgentLibrary) => writeDurably(recordPath(home), `${JSON.stringify(library, null, 2)}\n`);

// ---------- Contents ----------

const itemFolder = (context: ShareContext, key: string) => join(storeDirectory(context.home), 'items', 'agents', encodeURIComponent(key));
const versionPath = (context: ShareContext, key: string, hash: string) => join(itemFolder(context, key), 'versions', `${hash}.json`);
const ownPath = (context: ShareContext, key: string, fileHash: string) => join(itemFolder(context, key), 'own', `${fileHash}.txt`);
/** Writes a file named by its content, once. */
async function storeOnce(path: string, text: string) {
  if (await exists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeDurably(path, text);
}
const storeVersion = (context: ShareContext, key: string, hash: string, { name, description, prompt }: SharedAgent) =>
  storeOnce(versionPath(context, key, hash), `${JSON.stringify({ name, description, prompt }, null, 2)}\n`);
const storeOwn = (context: ShareContext, key: string, text: string) => storeOnce(ownPath(context, key, sha256(text)), text);

/** A version's content, or undefined when the store no longer has it. */
export async function readVersion(context: ShareContext, key: string, hash: string): Promise<SharedAgent | undefined> {
  try { return JSON.parse(await readFile(versionPath(context, key, hash), 'utf8')) as SharedAgent; } catch { return undefined; }
}

/** The library's shelf for agents (library.ts Shelf): where a version's content goes, and the caller's save of the record. */
export const agentShelf = (context: ShareContext, save: () => Promise<void>): Shelf<SharedAgent> => ({ store: (item, hash, agent) => storeVersion(context, item.key, hash, agent), save });

/** Keeps a harness's whole file as that harness's own part of the item, before the file is removed. The caller saves the record. */
export async function keepOwn(context: ShareContext, item: LibraryItem, entry: AgentEntry) {
  await storeOwn(context, item.key, entry.text);
  item.own[entry.tool] = entry.bytes;
}

/**
 * The file a harness gets for a version: the file it had, exactly, when that holds this version; else that file with the
 * version's name, description and prompt written into it (its own part stays); with no file kept, a new one.
 */
export async function fileTextFor(context: ShareContext, item: LibraryItem, tool: AgentEntry['tool'], agent: SharedAgent): Promise<string> {
  const kept = item.own[tool] ? await readFile(ownPath(context, item.key, item.own[tool]!), 'utf8').catch(() => undefined) : undefined;
  if (kept === undefined) return agentText(tool, agent);
  const held = parseAgent(tool, item.name, kept);
  return held && agentHash(held) === item.hash ? kept : agentText(tool, agent, kept);
}
