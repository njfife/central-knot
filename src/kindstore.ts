// What the three kinds' stores share (skillstore.ts, serverstore.ts, agentstore.ts): a kind's record in the home's
// `.central-knot/` (skills.json, mcp.json, agents.json) read and checked, empty, and saved; and, for agents and MCP servers, a
// content written once under the name of what it holds, and a tool's own part kept. Each store keeps its own openLibrary (its
// migration's writes), how a version is written and read, and the versions a migration made that are not stored yet.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isLibraryItem, type LibraryItem } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { NOTHING_CHANGED, errorCode, exists, sha256, storeDirectory, writeDurably } from './share.ts';
import type { HarnessId } from './types.ts';

/** A kind's record: its library (librarypass.ts KindLibrary) and the format it was written in. */
export interface StoredLibrary extends KindLibrary { formatVersion: number }
/** One kind's record file: its name in `.central-knot/`, the format this build writes, and how a sentence names it. */
export interface RecordFile { file: string; format: number; said: string }

/**
 * The empty record. No prototype on `items`, so a key such as constructor or __proto__ is only ever an item's. Whether a tool
 * can hold such a name is the kind's own rule (an agent's must start with a letter or digit: agentfiles.ts nameProblem).
 */
export const emptyLibrary = (record: RecordFile): StoredLibrary => ({ formatVersion: record.format, items: Object.create(null), folders: {} });

/**
 * Reads a kind's record as it is: its library, an earlier format the kind migrates (`older`, when `isOlder` takes it, with the
 * file's text), or none. Unreadable, damaged or newer is a `problem` that stops every write; the file is never touched. Its
 * items come back as the empty record's do, with no prototype, and without the `kind` an earlier build wrote on each.
 */
export async function readLibraryFile<Older>(home: string, record: RecordFile, isOlder?: (value: unknown) => value is Older)
  : Promise<{ library: StoredLibrary } | { older: Older; text: string } | { problem: string } | Record<string, never>> {
  let text: string;
  try { text = await readFile(join(storeDirectory(home), record.file), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: `${record.said} could not be read. ${NOTHING_CHANGED}` }; }
  const damaged = { problem: `${record.said} is damaged. ${NOTHING_CHANGED}` };
  try {
    const read = JSON.parse(text) as Partial<StoredLibrary> | null;
    const version = read?.formatVersion, items = read?.items;
    if (!Number.isInteger(version) || version! < 1 || !items || typeof items !== 'object' || Array.isArray(items)) return damaged;
    if (version! > record.format) return { problem: `${record.said} was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    if (version! < record.format) return isOlder?.(read) ? { older: read, text } : damaged;
    if (!Object.values(items).every(isLibraryItem)) return damaged;
    const library = emptyLibrary(record);
    for (const [key, { kind: _kind, ...item }] of Object.entries(items as Record<string, LibraryItem & { kind?: string }>)) library.items[key] = item;
    return { library: { ...library, folders: read!.folders ?? {} } };
  } catch { return damaged; }
}

/** Saves a kind's record, in the format this build writes. */
export const saveLibraryFile = (home: string, record: RecordFile, { items, folders }: KindLibrary) =>
  writeDurably(join(storeDirectory(home), record.file), `${JSON.stringify({ formatVersion: record.format, items, folders } satisfies StoredLibrary, null, 2)}\n`);

/** Writes a file named by its content, once. */
export async function storeOnce(path: string, text: string) {
  if (await exists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeDurably(path, text);
}

/**
 * Keeps a tool's own part of an item (agents: its whole file; MCP servers: its own fields), stored once where `pathOf` its hash
 * says, and recorded on the item; true when it differs from the one kept. The caller saves the record.
 */
export async function keepOwnPart(item: LibraryItem, tool: HarnessId, text: string, pathOf: (hash: string) => string): Promise<boolean> {
  const hash = sha256(text);
  await storeOnce(pathOf(hash), text);
  const was = item.own[tool];
  item.own[tool] = hash;
  return was !== hash;
}
