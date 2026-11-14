// Where the MCP servers' part of Central Knot's library (library.ts) is kept, inside the home's `.central-knot/`:
//
//   mcp.json                                  the record: each server as a LibraryItem, and each tool's settings file as last seen
//   mcp.v1.json                               the record from before the library, as it was (servermigrate.ts made the new one from it)
//   items/mcp/<key>/versions/<hash>.json      one version's content: the shared part (mcp.ts NeutralServer)
//   items/mcp/<key>/own/<hash>.json           one tool's own part of the server's entry (mcp.ts OwnPart), as a pass last saw it
//   items/mcp/<name>/<hash>.json, <hash>/…    servers kept before the library: read once by the migration, never deleted
//   claude-denies.json                        Claude Code's denies of servers that the profiles migration kept (servers.ts
//                                             releaseKeptDenies clears each, and drops it here, once its server is wanted there)
//
// Every file under items/ is named by what it holds, so a second file never replaces a first, and nothing here is pruned.
// The pass (librarypass.ts, through servers.ts serverKind) changes the items, and so does the profiles migration, once: items
// Off and kept own parts without their switch (profilemigrate.ts). This module only reads and writes what it is given.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyLibrary, keepOwnPart, readLibraryFile, saveLibraryFile, storeOnce, type RecordFile, type StoredLibrary } from './kindstore.ts';
import type { LibraryItem } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { serverHash, type NeutralServer, type OwnPart } from './mcp.ts';
import { isOldRecord, migrateServers } from './servermigrate.ts';
import { sha256, storeDirectory, writeDurably, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/** mcp.json. Format 2 is the library's; format 1 (servermigrate.ts) is migrated. */
const RECORD: RecordFile = { file: 'mcp.json', format: 2, said: 'The MCP record' };
const backupPath = (home: string) => join(storeDirectory(home), 'mcp.v1.json');

/**
 * The servers' library in this home; empty when nothing is recorded yet. A record from before the library is migrated on
 * the way (servermigrate.ts): only in memory for a reader, and written by the first caller that may write (`persist`), in an
 * order that leaves the old record and its kept files as they were whatever stops it: the versions first (new names only),
 * then the old record's copy (mcp.v1.json), then the new record in its place.
 */
export async function openLibrary(context: ShareContext, persist = false): Promise<{ library: StoredLibrary; problem?: string }> {
  const read = await readLibraryFile(context.home, RECORD, isOldRecord);
  if ('problem' in read) return { library: emptyLibrary(RECORD), problem: read.problem };
  if ('library' in read) return { library: read.library };
  if (!('older' in read)) return { library: emptyLibrary(RECORD) };
  const migrated = await migrateServers(context, read.older);
  const library: StoredLibrary = { ...emptyLibrary(RECORD), items: migrated.items, folders: migrated.folders };
  // A reader, or a home that can't be written: the migrated versions are read from memory until a writer stores them.
  for (const { key, server } of migrated.versions) notStoredYet.set(versionPath(context, key, serverHash(server)), server);
  if (!persist) return { library };
  for (const { key, server } of migrated.versions) await storeVersion(context, key, server);
  for (const { key, text } of migrated.own) await storeOwn(context, key, text);
  context.fault?.('before-replace');
  await writeDurably(backupPath(context.home), read.text);
  context.fault?.('mid-replace');
  await saveLibrary(context.home, library);
  return { library };
}

export const saveLibrary = (home: string, library: KindLibrary) => saveLibraryFile(home, RECORD, library);

/** The servers recorded as they are, for a reading of the tools (the current version's shape): none before the migration has written them. */
export async function recordedServers(home: string): Promise<Record<string, LibraryItem>> {
  const read = await readLibraryFile(home, RECORD);
  return 'library' in read ? read.library.items : {};
}

// ---------- Contents ----------

const itemFolder = (context: ShareContext, key: string) => join(storeDirectory(context.home), 'items', 'mcp', encodeURIComponent(key));
const versionPath = (context: ShareContext, key: string, hash: string) => join(itemFolder(context, key), 'versions', `${hash}.json`);
const ownPath = (context: ShareContext, key: string, hash: string) => join(itemFolder(context, key), 'own', `${hash}.json`);
/** Stores one version's content (the server's shared part) under the server, once. */
export const storeVersion = (context: ShareContext, key: string, server: NeutralServer) =>
  storeOnce(versionPath(context, key, serverHash(server)), `${JSON.stringify(server, null, 2)}\n`);

/** Versions a migration made that no writer has stored yet (openLibrary), by where they will be stored. */
const notStoredYet = new Map<string, NeutralServer>();
/** A version's content, or undefined when the store no longer has it. */
export async function readVersion(context: ShareContext, key: string, hash: string): Promise<NeutralServer | undefined> {
  const path = versionPath(context, key, hash);
  try { return JSON.parse(await readFile(path, 'utf8')) as NeutralServer; } catch { return notStoredYet.get(path); }
}

const storeOwn = (context: ShareContext, key: string, text: string) => storeOnce(ownPath(context, key, sha256(text)), text);

/** Keeps a tool's own part of the server's entry as that tool's own part of the item (kindstore.ts keepOwnPart). */
export const keepOwn = (context: ShareContext, item: LibraryItem, tool: HarnessId, text: string) => keepOwnPart(item, tool, text, hash => ownPath(context, item.key, hash));

/** The own part kept for a tool, which an entry written there afresh gets back (none kept: the item's name and the tool's defaults). */
export async function keptOwn(context: ShareContext, item: LibraryItem, tool: HarnessId): Promise<OwnPart | undefined> {
  const hash = item.own[tool];
  if (!hash) return undefined;
  try { return JSON.parse(await readFile(ownPath(context, item.key, hash), 'utf8')) as OwnPart; } catch { return undefined; }
}

// ---------- Claude Code's denies the profiles migration kept ----------

const deniesPath = (home: string) => join(storeDirectory(home), 'claude-denies.json');
/** The servers, by their names in Claude Code, whose deny there the profiles migration kept (profilemigrate.ts); none when there is no list. */
export async function keptDenies(home: string): Promise<string[]> {
  try { const names: unknown = JSON.parse(await readFile(deniesPath(home), 'utf8')); return Array.isArray(names) ? names.filter(name => typeof name === 'string') : []; } catch { return []; }
}
/** Keeps the list as given. */
export const keepDenies = (home: string, names: string[]) => writeDurably(deniesPath(home), `${JSON.stringify([...new Set(names)])}\n`);
