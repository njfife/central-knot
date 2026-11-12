// Where the skills' part of Central Knot's library (library.ts) is kept, inside the home's `.central-knot/`:
//
//   skills.json                                the record: each skill as a LibraryItem, and each tool's skills folder as last seen
//   sync.v1.json                               sync.json as it was before the library (skillmigrate.ts made skills.json from it)
//   items/skills/<folder>/versions/<hash>/     one version: the skill's whole folder, byte for byte (skillfiles.ts readTree)
//   items/<folder>/<hash>/                     revisions kept before the library: read once by the migration, never deleted
//                                              here (plugin parts still keep the skills they place there: parts.ts)
//   converted.json                             skills made by Convert to skill (agentskill.ts), with the agent each came from
//
// `<folder>` is the skill's key as share.ts storeFolder writes it, so a skill keyed `agents` or `mcp` never lands among the
// agents' or MCP servers' files. Every version is named by its content, so a second never replaces a first. Versions are kept
// until the skill is deleted from Central Knot; a deleted skill's versions go once its deletion is older than History's days
// (pruneDeleted), and its tombstone stays. The pass (librarypass.ts, through skills.ts skillKind) is the only caller that
// changes an item; this module only reads and writes what it is given.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isLibraryItem, type LibraryItem } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { NOTHING_CHANGED, copyTree, errorCode, exists, finishCopy, readRecord, readTree, removeTree, saveRecord, storeDirectory, storeFolder, writeDurably, type ShareContext } from './share.ts';
import { migrateSkills, type Migrated, type ToolsRead } from './skillmigrate.ts';
import type { HarnessId } from './types.ts';

/** The record: the skills' part of the library (librarypass.ts KindLibrary: the items, and each skills folder as last seen). */
export interface SkillLibrary extends KindLibrary { formatVersion: number }
/** A version's content: the folder that holds it (in the store, or a tool's copy being taken in) and its hash. */
export interface SkillContent { directory: string; hash: string }

const FORMAT_VERSION = 1;
const recordPath = (home: string) => join(storeDirectory(home), 'skills.json');
/** No prototype on `items`: a skill may be called constructor or __proto__. */
const emptyLibrary = (): SkillLibrary => ({ formatVersion: FORMAT_VERSION, items: Object.create(null), folders: {} });

type Inspected = { library: SkillLibrary } | { problem: string } | Record<string, never>;
/** Reads the record as it is. Unreadable, damaged or newer is a `problem` that stops every write; the file is never touched. */
async function inspect(home: string): Promise<Inspected> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: `The skills record could not be read. ${NOTHING_CHANGED}` }; }
  const damaged = { problem: `The skills record is damaged. ${NOTHING_CHANGED}` };
  try {
    const record = JSON.parse(text) as Partial<SkillLibrary> | null;
    const version = record?.formatVersion, items = record?.items;
    if (!Number.isInteger(version) || version! < 1 || !items || typeof items !== 'object' || Array.isArray(items)) return damaged;
    if (version! > FORMAT_VERSION) return { problem: `The skills record was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    if (!Object.values(items).every(isLibraryItem)) return damaged;
    return { library: { formatVersion: FORMAT_VERSION, items: Object.assign(Object.create(null), items), folders: record!.folders ?? {} } };
  } catch { return damaged; }
}

/**
 * The skills' library in this home; empty when nothing is recorded yet. Skills recorded before the library (in sync.json,
 * format 1) are migrated on the way (skillmigrate.ts): only in memory for a reader, and written by the first caller that may
 * write (`persist`), in an order that leaves the earlier files as they were whatever stops it: the versions first (new
 * names only), then sync.json's copy (sync.v1.json), then skills.json, then sync.json without its skills. A crash after
 * skills.json is written is finished by the next opening (finishMigration).
 */
export async function openLibrary(context: ShareContext, persist: boolean, read: (context: ShareContext, managed: HarnessId[]) => Promise<ToolsRead>): Promise<{ library: SkillLibrary; problem?: string }> {
  const found = await inspect(context.home);
  if ('problem' in found) return { library: emptyLibrary(), problem: found.problem };
  const { record, problem } = await readRecord(context.home);
  if ('library' in found) {
    if (persist && record?.formatVersion === 1) await finishMigration(context);
    return { library: found.library };
  }
  if (problem || record?.formatVersion !== 1) return { library: emptyLibrary() };
  let migrated: Migrated;
  try { migrated = await migrateSkills(context, record, read); }
  catch (error) { return { library: emptyLibrary(), problem: `The skills recorded before could not be read: ${error instanceof Error ? error.message : String(error)} ${NOTHING_CHANGED}` }; }
  const library: SkillLibrary = { ...emptyLibrary(), items: migrated.items, folders: migrated.folders };
  // A reader, or a home that can't be written: the migrated versions are read where they are until a writer stores them.
  for (const version of migrated.versions) notStoredYet.set(versionPath(context, version.key, version.hash), version.directory);
  if (!persist) return { library };
  for (const version of migrated.versions) await storeVersion(context, version.key, { directory: version.directory, hash: version.hash });
  context.fault?.('before-replace');
  await writeDurably(join(storeDirectory(context.home), 'sync.v1.json'), migrated.recordText);
  context.fault?.('mid-replace');
  await saveLibrary(context.home, library);
  context.fault?.('after-rename');
  await finishMigration(context);
  return { library };
}

/** The skills recorded in skills.json as they are, for a reading of the tools: none before the migration has written it. */
export async function recordedSkills(home: string): Promise<Record<string, LibraryItem>> {
  const read = await inspect(home);
  return 'library' in read ? read.library.items : {};
}

/** sync.json without the skills it held before the library (format 2): who owns this home, its generation and its tools stay. */
async function finishMigration(context: ShareContext) {
  const { record } = await readRecord(context.home);
  if (record?.formatVersion !== 1) return;
  const backup = join(storeDirectory(context.home), 'sync.v1.json');
  if (!(await exists(backup))) await writeDurably(backup, `${JSON.stringify(record, null, 2)}\n`);
  const { items: _items, roots: _roots, lastStartId: _last, activeStartId: _active, ...kept } = record as typeof record & Record<string, unknown>;
  await saveRecord(context.home, { ...kept, formatVersion: 2 });
}

export const saveLibrary = (home: string, { items, folders }: KindLibrary) =>
  writeDurably(recordPath(home), `${JSON.stringify({ formatVersion: FORMAT_VERSION, items, folders } satisfies SkillLibrary, null, 2)}\n`);

// ---------- Versions ----------

const itemFolder = (context: ShareContext, key: string) => join(storeDirectory(context.home), 'items', 'skills', storeFolder(key));
export const versionPath = (context: ShareContext, key: string, hash: string) => join(itemFolder(context, key), 'versions', hash);

/**
 * Stores one version under the skill, once: its folder is copied, checked against its hash, then put in place. A folder that
 * no longer holds that content (an edit landed since it was read) is refused (CK_CHANGED), and nothing is stored.
 */
export async function storeVersion(context: ShareContext, key: string, { directory, hash }: SkillContent): Promise<void> {
  const target = versionPath(context, key, hash);
  if (await exists(target)) return;
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${randomUUID()}.tmp`;
  try {
    const tree = await readTree(directory);
    if (tree.hash !== hash || tree.held) throw Object.assign(new Error('It changed while it was being kept, so it was left as it is. The next pass reads it again.'), { code: 'CK_CHANGED' });
    await copyTree(directory, staging, tree);
    if ((await readTree(staging)).hash !== hash) throw Object.assign(new Error('It changed while it was being kept.'), { code: 'CK_CHANGED' });
    await rename(staging, target);
    await finishCopy(directory, target);
  } finally { await removeTree(staging).catch(() => undefined); }
}

/** Versions a migration found that no writer has stored yet (openLibrary), by where they will be stored: where they are now. */
const notStoredYet = new Map<string, string>();
/** A version's content, or undefined when the store no longer has it. */
export async function readVersion(context: ShareContext, key: string, hash: string): Promise<SkillContent | undefined> {
  const path = versionPath(context, key, hash);
  if (await exists(path)) return { directory: path, hash };
  const before = notStoredYet.get(path);
  return before && (await exists(before)) ? { directory: before, hash } : undefined;
}

/**
 * Lets a deleted skill's versions go once its deletion is older than `cutoff`, History's days (history.ts calls it: its
 * Restore has left History by then); its tombstone stays, so a stale copy that turns up is still found, never taken in by
 * itself. A live skill keeps every version.
 */
export async function pruneDeleted(context: ShareContext, cutoff: number): Promise<void> {
  const read = await inspect(context.home);
  if (!('library' in read)) return;
  for (const item of Object.values(read.library.items) as LibraryItem[]) {
    if (item.deleted && Date.parse(item.deleted.at) < cutoff) await removeTree(join(itemFolder(context, item.key), 'versions')).catch(() => undefined);
  }
}

// ---------- Skills made by Convert to skill ----------

/** A skill Convert to skill made from an agent (agentskill.ts): which agent, from which tool, and what an agent had that a skill does not. */
export interface ConvertedFrom { agent: string; origin: HarnessId; at: string; losses: string[] }
const convertedPath = (home: string) => join(storeDirectory(home), 'converted.json');
export async function readConverted(home: string): Promise<Record<string, ConvertedFrom>> {
  // A null-prototype map: a skill named "constructor" or "__proto__" is a key like any other, never a built-in.
  try { return Object.assign(Object.create(null), JSON.parse(await readFile(convertedPath(home), 'utf8'))); } catch { return Object.create(null); }
}
export async function recordConverted(home: string, key: string, from: ConvertedFrom) {
  const all = await readConverted(home);
  all[key] = from;
  await writeDurably(convertedPath(home), `${JSON.stringify(all, null, 2)}\n`);
}
