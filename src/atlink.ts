// What is at a source's link (sources.ts), read from a copy of it by its files alone, and what was read there as the pass and
// the source's table are given it. One function decides each thing:
// - what the link's folder is (holdsAt), before any kind is read: no folder there (`missing`); a marketplace's or a plugin's
//   own files (named, nothing read: a later version); else what each kind's reader finds there (`items`), or nothing of any
//   kind (`empty`);
// - which files there are an item of one kind, each one's key, name and content, or why it is unreadable: that kind's reader
//   (sources.ts SourceKind `at`). Skills' is skillsAt: a SKILL.md in the link's own folder (one skill), else each folder inside
//   it with one, else skills/<folder>/; a skill is its whole folder, byte for byte, without the repository's .git, named as
//   its SKILL.md names it; two skills of one name are both unreadable;
// - one kind's read, and whether it was read whole (readOf, the one place; library.ts "Read whole");
// - why a read holds nothing to bring in, in words (unreadWhy, nothingToAddWhy), each kind's part from its table entry.
// An item there that can't be read is "unreadable", with why, and is never taken to be gone.
// Not here: fetching a link (sources.ts fetchInto), the kinds' table (sources.ts sourceKinds), and the table each read meets
// (library.ts sourceAnswers).
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inside } from './catalogdetail.ts';
import { parseSkill } from './discovery.ts';
import { itemKey } from './library.ts';
import type { SourceRead } from './librarypass.ts';
import { readTree } from './share.ts';
import type { SkillContent } from './skillstore.ts';
import type { SourceKind } from './sources.ts';
import type { SourceRecord } from './sourcestore.ts';
import type { SourceHolds } from './types.ts';

/**
 * One item of a kind at a link, read from where it sits (`folder`, from the repository's root; `folderName`, that folder's own
 * name, the repository's for its root): its files there, and its content, or why it is unreadable.
 */
export type ItemThere<Content> = { folder: string; folderName: string; key: string; name: string; files: string[]; hash: string; content: Content }
  | { folder: string; folderName: string; key: string; name?: string; files: string[]; unreadable: string };
/** A kind's reader (sources.ts SourceKind `at`): every item of its kind at `folder` in a copy (`root`); `rootName` names one at the repository's root that its own file doesn't name. */
export type ReaderAt<Content> = (root: string, folder: string, rootName: string) => Promise<ItemThere<Content>[]>;
/** What is at a link (holdsAt): what its folder is, and each kind's items there, in the table's order (none for no folder there, a plugin or a marketplace). */
export interface Holds { holds: SourceHolds; kinds: { entry: SourceKind; items: ItemThere<unknown>[] }[] }

const present = (path: string) => lstat(path).then(() => true, () => false);
const isFolder = (path: string) => lstat(path).then(info => info.isDirectory(), () => false);

/**
 * What is at the link's `folder` in a copy (`root`) of `repository`, in this order: no folder there, a marketplace, a plugin,
 * else what each kind's reader finds.
 */
export async function holdsAt(root: string, folder: string, repository: string, kinds: readonly SourceKind[]): Promise<Holds> {
  const at = join(root, folder);
  if (!(await isFolder(at)) || !(await inside(root, at))) return { holds: 'missing', kinds: [] };
  if (await present(join(at, '.claude-plugin/marketplace.json')) || await present(join(at, '.agents/plugins/marketplace.json'))) return { holds: 'marketplace', kinds: [] };
  if (await present(join(at, '.claude-plugin')) || await present(join(at, '.codex-plugin'))) return { holds: 'plugin', kinds: [] };
  const read: Holds['kinds'] = [];
  for (const entry of kinds) read.push({ entry, items: await entry.at(root, folder, repoName(repository)) });
  return { holds: read.some(each => each.items.length) ? 'items' : 'empty', kinds: read };
}
/** A repository's own name ("skill-deslop"), which names an item at its root that its own file doesn't. */
const repoName = (repository: string) => basename(repository.replace(/\/+$/, '')).replace(/\.git$/, '') || 'skill';
/** One kind's items in what is at a link (none where that kind wasn't read). */
export const itemsOf = (found: Holds, entry: SourceKind) => found.kinds.find(each => each.entry.kind.kind === entry.kind.kind)?.items ?? [];

// ---------- Skills' reader ----------

/** The folders in `folder` (none hidden, none a link) that hold a SKILL.md, from the repository's root. */
async function withSkill(root: string, folder: string): Promise<string[]> {
  const names = (await readdir(join(root, folder), { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  const found: string[] = [];
  for (const entry of names.sort((first, second) => first.name.localeCompare(second.name))) if (await present(join(root, folder, entry.name, 'SKILL.md'))) found.push(join(folder, entry.name));
  return found;
}

/** Every skill at the link's `folder`: one skill, the folders inside with a SKILL.md, or skills/<folder>/. Two skills with one name are both unreadable. */
export async function skillsAt(root: string, folder: string, rootName: string): Promise<ItemThere<SkillContent>[]> {
  const folders = await present(join(root, folder, 'SKILL.md')) ? [folder] : (await withSkill(root, folder)).length ? await withSkill(root, folder) : await withSkill(root, join(folder, 'skills'));
  const skills = await Promise.all(folders.map(each => skillAt(root, each, each === '' ? rootName : basename(each))));
  const twice = new Set(skills.map(skill => skill.key).filter((key, index, keys) => keys.indexOf(key) !== index));
  return skills.map(skill => (twice.has(skill.key) ? { ...skill, unreadable: `two skills here are named ${skill.name}, so neither is brought in` } : skill));
}

/** A name a skill's folder can take in every tool: no separator, not hidden, not too long. */
const usableName = (name: string) => !!name && name.length <= 200 && !/[/\\:\0]/.test(name) && !name.startsWith('.');

/** One skill's folder at a link: its name (its SKILL.md's, else its folder's, `folderName`), its files and its content, or why it is unreadable. */
async function skillAt(root: string, folder: string, folderName: string): Promise<ItemThere<SkillContent>> {
  const directory = join(root, folder), file = join(directory, 'SKILL.md');
  const unreadable = (why: string, name?: string): ItemThere<SkillContent> => ({ folder, folderName, key: itemKey(name ?? folderName), ...(name ? { name } : {}), files: [], unreadable: why });
  if (!(await lstat(file).then(info => info.isFile(), () => false))) return unreadable('its SKILL.md is not a plain file');
  let name: string;
  try { name = parseSkill(await readFile(file, 'utf8'), folderName).name.trim(); }
  catch (error) { return unreadable(`its SKILL.md can’t be read as a skill (${error instanceof Error ? error.message.replace(/\.$/, '') : 'its frontmatter'})`); }
  if (!usableName(name)) return unreadable(`its name “${name}” can’t be a folder’s name`, name);
  const tree = await readTree(directory);
  if (tree.held) return unreadable(`it can’t be copied as it is: ${tree.held.split('. ')[0].replace(/^It /, 'it ')}`, name);
  return { folder, folderName, key: itemKey(name), name, files: [...tree.files.keys()].sort(), hash: tree.hash, content: { directory, hash: tree.hash } };
}

// ---------- A read, and why it holds nothing ----------

/** A click on one name's line at a source, as its kind's read carries it: Add on one held deleted (`bringBack`), or Replace, Merge or Keep mine on one whose version waits (`replace`, `merge`, `keep`). */
export type RowClick = Pick<SourceRead<unknown>, 'bringBack' | 'replace' | 'merge' | 'keep'>;

/** Whether what is at a link holds an item of any kind that can be read. */
const readable = (found: Holds) => found.kinds.some(each => each.items.some(item => !('unreadable' in item)));

/**
 * What was read at a source of one kind, as the pass and the table are given it (the one place that decides it): each item of
 * that kind there by key, with its content or why it is unreadable, and whether the source was read whole for this kind: the
 * link's folder is there and is no plugin or marketplace, at least one item of any kind there can be read, and every item of
 * this kind can be read (library.ts "Read whole"). `recorded`: the ids of the sources the home records.
 */
export function readOf(source: SourceRecord, found: Holds, entry: SourceKind, recorded: ReadonlySet<string>, clicked: RowClick = {}): SourceRead<unknown> {
  const there = itemsOf(found, entry), names: SourceRead<unknown>['names'] = new Map();
  for (const item of there) names.set(item.key, 'unreadable' in item ? { unreadable: item.unreadable } : { name: item.name, hash: item.hash, content: item.content });
  const whole = found.holds === 'items' && readable(found) && there.every(item => !('unreadable' in item));
  return { id: source.id, link: source.link, commitAt: source.commitAt, kind: entry.kind.kind, mergeWith: entry.kind.merge, whole, names, recorded, ...clicked };
}

/** Each kind's word for one item, as a sentence that names any of them says it: "skill". */
const anyItem = (found: Holds) => found.kinds.map(each => each.entry.kind.words.item).join(' or ');

/**
 * Why what is at a link can't be read, in words, none when it can: the link's folder isn't in the read (moved or deleted there;
 * or, for a source's row, no read of it is kept here), a plugin or a marketplace, or nothing of any kind there (each kind's
 * part from its entry: SourceKind `noneThere`). Look refuses Add for it, and a source's row says it; an item there that can't
 * be read says why on its own line (sources.ts namesOf).
 */
export function unreadWhy(found: Holds, where: Pick<SourceRecord, 'ref' | 'folder'>): string | undefined {
  const at = where.folder ? `the folder ${where.folder}` : 'its root';
  if (found.holds === 'missing') return `Nothing at ${at} on ${where.ref} to read: moved or deleted there, or not read here yet.`;
  if (found.holds === 'plugin') return 'The link holds a plugin (a .claude-plugin or .codex-plugin folder). Plugins from a link come in a later version; nothing here is read.';
  if (found.holds === 'marketplace') return 'The link holds a marketplace. Add it on the Plugins page; plugins from a link come in a later version, so nothing here is read.';
  if (found.holds === 'empty') return `No ${anyItem(found)} at ${at}: ${found.kinds.map(each => each.entry.noneThere).join('; ')}.`;
  return undefined;
}
/** Why Look refuses Add: nothing there can be read (unreadWhy, or each item's line says why). */
export const nothingToAddWhy = (found: Holds, where: Pick<SourceRecord, 'ref' | 'folder'>) =>
  unreadWhy(found, where) ?? (readable(found) ? undefined : `No ${anyItem(found)} there can be read: each one’s line says why.`);
