// Where the agents' part of Central Knot's library (library.ts) is kept, inside the home's `.central-knot/`:
//
//   agents.json                               the record: each agent as a LibraryItem, and each harness's agents folder as last seen
//   agents.v2.json                            the record from before the library, as it was (agentmigrate.ts made the new one from it)
//   items/agents/<key>/versions/<hash>.json   one version's content: the shared part (name, description, prompt)
//   items/agents/<key>/own/<file hash>.txt    one harness's whole file as a pass last saw or wrote it: that harness's own part
//   items/agents/<key>/<hash>/…               files kept before the library; read once by the migration, never deleted
//
// Every file under items/ is named by what it holds, so a second file never replaces a first, and nothing here is pruned.
// The pass (librarypass.ts, through agents.ts agentKind) is the only caller that changes an item; this module only reads and
// writes what it is given.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentHash, agentText, parseAgent, type AgentEntry, type SharedAgent } from './agentfiles.ts';
import { isOldRecord, migrateAgents } from './agentmigrate.ts';
import { emptyLibrary, keepOwnPart, readLibraryFile, saveLibraryFile, storeOnce, type RecordFile, type StoredLibrary } from './kindstore.ts';
import type { LibraryItem } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { sha256, storeDirectory, writeDurably, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/** agents.json. Format 3 is the library's; 2 (agentmigrate.ts) and 1 (before agents were rewritten: nothing to carry over) are migrated. */
const RECORD: RecordFile = { file: 'agents.json', format: 3, said: 'The agents record' };
const backupPath = (home: string, version: number) => join(storeDirectory(home), `agents.v${version}.json`);

/**
 * The agents' library in this home; empty when nothing is recorded yet. A record from before the library is migrated on the
 * way (agentmigrate.ts): only in memory for a reader, and written by the first caller that may write (`persist`), in an order
 * that leaves the old record and its kept files as they were whatever stops it: the new contents first (new names only), then
 * the old record's copy, then the new record in its place.
 */
export async function openLibrary(context: ShareContext, persist = false): Promise<{ library: StoredLibrary; problem?: string }> {
  const read = await readLibraryFile(context.home, RECORD, isOldRecord);
  if ('problem' in read) return { library: emptyLibrary(RECORD), problem: read.problem };
  if ('library' in read) return { library: read.library };
  if (!('older' in read)) return { library: emptyLibrary(RECORD) };
  const migrated = await migrateAgents(context, read.older);
  const library: StoredLibrary = { ...emptyLibrary(RECORD), items: migrated.items, folders: migrated.folders };
  // A reader, or a home that can't be written: the migrated contents are read from memory until a writer stores them.
  for (const { key, hash, agent } of migrated.versions) notStoredYet.set(versionPath(context, key, hash), agent);
  if (!persist) return { library };
  for (const { key, hash, agent } of migrated.versions) await storeVersion(context, key, hash, agent);
  for (const { key, text } of migrated.own) await storeOwn(context, key, text);
  context.fault?.('before-replace');
  await writeDurably(backupPath(context.home, read.older.formatVersion), read.text);
  context.fault?.('mid-replace');
  await saveLibrary(context.home, library);
  return { library };
}

export const saveLibrary = (home: string, library: KindLibrary) => saveLibraryFile(home, RECORD, library);

// ---------- Contents ----------

const itemFolder = (context: ShareContext, key: string) => join(storeDirectory(context.home), 'items', 'agents', encodeURIComponent(key));
const versionPath = (context: ShareContext, key: string, hash: string) => join(itemFolder(context, key), 'versions', `${hash}.json`);
const ownPath = (context: ShareContext, key: string, fileHash: string) => join(itemFolder(context, key), 'own', `${fileHash}.txt`);
/** Stores one version's content (its shared part) under the agent, once. */
export const storeVersion = (context: ShareContext, key: string, hash: string, { name, description, prompt }: SharedAgent) =>
  storeOnce(versionPath(context, key, hash), `${JSON.stringify({ name, description, prompt }, null, 2)}\n`);
const storeOwn = (context: ShareContext, key: string, text: string) => storeOnce(ownPath(context, key, sha256(text)), text);

/** Versions a migration made that no writer has stored yet (openLibrary), by where they will be stored. */
const notStoredYet = new Map<string, SharedAgent>();
/** Versions read once, by where they are stored: a version's file is named by its content, so it never changes. */
const readBefore = new Map<string, SharedAgent>();
/** A version's content, or undefined when the store no longer has it. */
export async function readVersion(context: ShareContext, key: string, hash: string): Promise<SharedAgent | undefined> {
  const path = versionPath(context, key, hash);
  if (readBefore.has(path)) return readBefore.get(path);
  try { const agent = JSON.parse(await readFile(path, 'utf8')) as SharedAgent; readBefore.set(path, agent); return agent; } catch { return notStoredYet.get(path); }
}

/** Keeps a harness's whole file as that harness's own part of the item (kindstore.ts keepOwnPart). */
export const keepOwn = (context: ShareContext, item: LibraryItem, tool: HarnessId, text: string) => keepOwnPart(item, tool, text, hash => ownPath(context, item.key, hash));

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
