// The skills recorded before the library (sync.json format 1: each tool's own folder was the truth, and Central Knot recorded
// which skills it synced, where, and at what content) made into library items. Run once per home, by skillstore.ts
// openLibrary, which writes the result.
//
// The rule: no folder in any tool changes because of the migration, and every content kept before is a version. Each state
// lands on one of three: On with the same content applied where it was synced; kept out (or Off) with a copy there and
// nothing applied, so the copy is left as it is; or not in the library at all (found, every folder as it is).
//
//   on the old record                                    in the library
//   synced                                               On at its synced content; a tool whose copy is on record (or holds
//                                                        that content) has what was last synced there applied
//   a tool it was left out of (`off`)                    that tool kept out, nothing applied: a copy there stays
//   a tool holding a differing copy never synced         that tool kept out, nothing applied; its content is a version
//     (`keptOwn`, or a collision waiting for a choice)
//   a choice not carried out yet (`use`)                 On at the chosen content; every tool holding another copy kept
//                                                        out as above, so the choice writes over nothing
//   a tool that has it another way (it reads another     nothing applied there: its own copy, if any, stays, and its line
//     tool's folder or ~/.agents/skills, a link, a       says it has it both ways (library.ts, the table's last row)
//     plugin)
//   an edit not spread yet, or a copy only behind        applied at what was last synced there: the first pass takes the
//                                                        edit in, or catches the copy up, as the earlier engine would have
//   a copy on record gone from its folder                applied: the first pass reads it as deleted by hand (Off), unless
//                                                        the folder was made again (the guards write it afresh)
//   deleted everywhere                                   a tombstone at the content it had, kept out where it was; a copy
//                                                        the deletion still owed a removal stays as it is (found)
//   kept separate, never synced, or turned off since     not in the library: found, every folder as it is; the copy
//                                                        question chooses when the person turns it on
// Every revision kept under items/<folder>/<hash>/ is a version of its skill (displaced content was kept there too); the old
// folders stay where they are. The record's folder identities (`roots`) become the library's `folders`, so a folder reset
// before the library is never read as deletions. A switch set in any tool, by a person or a profile, is left exactly as it is:
// it is read at each look (skills.ts), and a profile's is released by profilemigrate.ts.
import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { harnessIds, harnesses } from './harnesses.ts';
import { newItem, type LibraryItem, type Source } from './library.ts';
import type { FolderSeen, KindLibrary, Wanted } from './librarypass.ts';
import { managedTools } from './presence.ts';
import { readTree, storeDirectory, storeFolder, type ShareContext, type SyncRecord } from './share.ts';
import { readSkillsFolder, rootOf, type SkillCopy } from './skillfiles.ts';
import type { HarnessId } from './types.ts';

/** A copy on the old record: written (synced there), pending (a write a crash interrupted), or removing (a deletion still owed). */
interface OldCopy { harness: HarnessId; directory: string; hash: string; created: boolean; status: 'pending' | 'written' | 'removing' }
/** A skill on the old record. */
interface OldSkill {
  name: string; hash: string; state: 'shared' | 'dont-share'; copies: OldCopy[];
  off?: HarnessId[]; separate?: boolean; use?: { tool: HarnessId; hash: string }; deleted?: { at: string; tool: HarnessId; hash: string };
  keptOwn?: Partial<Record<HarnessId, string>>;
}

const knownTool = (value: unknown) => typeof value === 'string' && Object.hasOwn(harnesses, value);
/** Whether every item on the old record has the shape the earlier engine wrote (a record is read from disk: nothing is taken on trust). */
function oldSkills(items: unknown): items is Record<string, OldSkill> {
  if (typeof items !== 'object' || items === null || Array.isArray(items)) return false;
  return Object.values(items).every(item => typeof item === 'object' && item !== null
    && typeof item.name === 'string' && typeof item.hash === 'string' && (item.state === 'shared' || item.state === 'dont-share')
    && (item.off === undefined || (Array.isArray(item.off) && item.off.every(knownTool)))
    && (item.deleted === undefined || (typeof item.deleted?.at === 'string' && typeof item.deleted.hash === 'string'))
    && (item.use === undefined || (knownTool(item.use?.tool) && typeof item.use.hash === 'string'))
    && Array.isArray(item.copies) && item.copies.every((copy: Partial<OldCopy>) => typeof copy === 'object' && copy !== null
      && typeof copy.directory === 'string' && isAbsolute(copy.directory) && typeof copy.hash === 'string' && knownTool(copy.harness)));
}

/** One revision kept before the library: where it is, its content, and when it was kept. */
export interface Kept { hash: string; at: number; directory: string }

const iso = (ms: number) => new Date(ms).toISOString();
/** The same folder? Case-folded where the disk ignores case, as the earlier engine compared them. */
const sameDir = (first: string, second: string) => (process.platform === 'linux' ? first === second : first.toLowerCase() === second.toLowerCase());

/**
 * One old skill as a library item, or undefined when it is not one (found: separate, never synced, turned off since; or no
 * content of it is left). `kept`: its revisions in the old store; `onDisk`: each tool's own copy now; `managed`: the tools
 * Central Knot managed; `anotherWay`: whether a tool has the item another way (skills.ts), asked of the item as built so far.
 * Pure apart from what it is given: the worked examples are tests/skillmigrate.test.ts.
 */
export function migrateItem(key: string, old: OldSkill, kept: Kept[], onDisk: Partial<Record<HarnessId, SkillCopy>>,
  managed: readonly HarnessId[], anotherWay: (item: Wanted, tool: HarnessId) => boolean): LibraryItem | undefined {
  const synced = old.state === 'shared';
  if (!synced && !old.deleted) return undefined;
  const contents = new Map<string, { at: number; from: Source }>(kept.map(content => [content.hash, { at: content.at, from: { how: 'migrated' } }]));
  for (const copy of Object.values(onDisk)) if (copy && !contents.has(copy.hash)) contents.set(copy.hash, { at: copy.at, from: { how: 'was-in', harness: copy.tool } });
  const chosen = synced && old.use && contents.has(old.use.hash) ? old.use.hash : undefined;
  const lastSynced = synced ? old.hash : old.deleted!.hash;
  const current = chosen ?? (contents.has(lastSynced) ? lastSynced : !synced && contents.has(old.hash) ? old.hash : undefined);
  if (current === undefined) return undefined;
  const item: LibraryItem = { ...newItem('skill', key, old.name), on: true, hash: current, except: [...new Set(old.off ?? [])] };
  // The order the library takes them in: the current one first, then the others newest first.
  const versions = [...contents].map(([hash, { at, from }]) => ({ hash, at: iso(at), from })).sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  item.versions = [...versions.filter(version => version.hash === current), ...versions.filter(version => version.hash !== current)];
  if (!synced) { item.deleted = { at: old.deleted!.at }; return item; }
  for (const tool of managed) {
    if (item.except.includes(tool) || anotherWay(item, tool)) continue;
    const here = onDisk[tool], recorded = old.copies.find(copy => copy.harness === tool && copy.status !== 'removing');
    if (here && (old.keptOwn?.[tool] || (chosen && here.hash !== current))) item.except.push(tool);
    else if (recorded && (here || recorded.status === 'written')) item.applied[tool] = recorded.hash;
    else if (here && (here.hash === current || kept.some(content => content.hash === here.hash))) item.applied[tool] = here.hash;
    else if (here) item.except.push(tool);
  }
  return item;
}

/** The revisions kept for one skill before the library: one folder per content, named by its hash. */
async function readKept(context: ShareContext, key: string): Promise<Kept[]> {
  const base = join(storeDirectory(context.home), 'items', storeFolder(key));
  const found: Kept[] = [];
  for (const hash of (await readdir(base).catch(() => [] as string[])).filter(name => /^[0-9a-f]{64}$/.test(name))) {
    const directory = join(base, hash);
    const tree = await readTree(directory).catch(() => undefined);
    if (tree?.hash === hash && !tree.held) found.push({ hash, directory, at: (await stat(directory)).mtimeMs });
  }
  return found;
}

/** A migrated record: its items and folders, the versions the new store needs (where each is now), and the old record's text for its backup. */
export interface Migrated {
  items: Record<string, LibraryItem>;
  folders: KindLibrary['folders'];
  versions: { key: string; hash: string; directory: string }[];
  recordText: string;
}

/** What the migration reads of the tools: each managed tool's own copies, and whether one has a skill another way (skills.ts readDisk). */
export interface ToolsRead { byKey: Map<string, Partial<Record<HarnessId, SkillCopy>>>; anotherWay(item: Wanted, tool: HarnessId): string | undefined }

/**
 * The whole old record as library items. Reads the old store and the tools (`read`: skills.ts readDisk, for the tools Central
 * Knot managed; every other tool's own folder is read here, for its contents); writes nothing. A record whose skills don't
 * have the earlier shape is refused (it throws), so nothing is written from it.
 */
export async function migrateSkills(context: ShareContext, record: SyncRecord, read: (context: ShareContext, managed: HarnessId[]) => Promise<ToolsRead>): Promise<Migrated> {
  const legacy = record as SyncRecord & { items?: unknown; roots?: Record<string, { ino: number; birth: number }> };
  const items = legacy.items ?? {};
  if (!oldSkills(items)) throw new Error('Its skills record from before is damaged.');
  const snapshots = await context.read();
  // A record from before the library leaves no tool out (the Manage switch came later): every installed tool was managed.
  const managed = snapshots.length ? managedTools(snapshots) : [...harnessIds];
  const tools = await read(context, managed);
  // Every tool's own folder in this home, managed or not: each content found is a version, and every copy is left where it is.
  const elsewhere = new Map<string, Partial<Record<HarnessId, SkillCopy>>>();
  for (const tool of harnessIds.filter(other => !managed.includes(other))) {
    for (const copy of (await readSkillsFolder(tool, rootOf(context, tool), '')).copies) elsewhere.set(copy.key, { ...elsewhere.get(copy.key), [tool]: copy });
  }
  const migrated: Migrated = { items: Object.create(null), folders: {}, versions: [], recordText: `${JSON.stringify(record, null, 2)}\n` };
  for (const tool of managed) {
    const root = rootOf(context, tool), seen = legacy.roots?.[root];
    if (seen) migrated.folders[tool] = { path: root, ino: seen.ino, birth: seen.birth } satisfies FolderSeen;
  }
  // Only a copy in a tool's own folder was ever its own: one on record elsewhere (~/.agents/skills) is another way now.
  const ownFolder = (copy: OldCopy) => sameDir(dirname(copy.directory), rootOf(context, copy.harness));
  for (const [key, old] of Object.entries(items)) {
    const kept = await readKept(context, key), onDisk = { ...elsewhere.get(key), ...tools.byKey.get(key) };
    const item = migrateItem(key, { ...old, copies: old.copies.filter(ownFolder) }, kept, onDisk, managed, (wanted, tool) => !!tools.anotherWay(wanted, tool));
    if (!item) continue;
    migrated.items[key] = item;
    for (const version of item.versions) {
      const directory = kept.find(content => content.hash === version.hash)?.directory ?? Object.values(onDisk).find(copy => copy?.hash === version.hash)?.directory;
      if (directory) migrated.versions.push({ key, hash: version.hash, directory });
    }
  }
  return migrated;
}
