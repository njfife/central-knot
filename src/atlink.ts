// What is at a source's link (sources.ts), read from a copy of it by its files alone, and what was read there as the pass and
// the source's table are given it. One function decides each thing:
// - what the link's folder is (holdsAt), before any kind is read: no folder there (`missing`); a marketplace's or a plugin's
//   own files (named, nothing read: a later version); else what each kind's reader finds there (`items`), or nothing of any
//   kind (`empty`);
// - which files there are an item of one kind, each one's key, name and content, or why it is unreadable: that kind's reader
//   (sources.ts SourceKind `at`), given the items the kinds before it in the table found (`earlier`), so a file one kind holds
//   is never read as another's (heldEarlier, the one test). Skills' is skillsAt; agents' is agentsAt and MCP servers' is
//   serversAt, whose headers below say what at a link is one;
// - one kind's read, and whether it was read whole (readOf, the one place; library.ts "Read whole");
// - why a read holds nothing to bring in, in words (unreadWhy, nothingToAddWhy), each kind's part from its table entry.
// An item there that can't be read is "unreadable", with why, and is never taken to be gone. One that was read and is not
// brought in by a rule (two of one name, a name no tool can store, a skill holding a link, a server that runs files from the
// repository) is `leftOut` as well: said as not brought in, it holds back no drop (readOf).
// Not here: fetching a link (sources.ts fetchInto), the kinds' table (sources.ts sourceKinds), and the table each read meets
// (library.ts sourceAnswers).
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { agentHash, frontMatter, parseAgent, type SharedAgent } from './agentfiles.ts';
import { inside } from './catalogdetail.ts';
import { parseSkill } from './discovery.ts';
import { itemKey } from './library.ts';
import type { SourceRead } from './librarypass.ts';
import { cannotHold, fromJson, ownPartOf, runsFrom, type NeutralServer } from './mcp.ts';
import type { AgentTool } from './presence.ts';
import { readTree } from './share.ts';
import type { SkillContent } from './skillstore.ts';
import type { SourceKind } from './sources.ts';
import type { SourceRecord } from './sourcestore.ts';
import type { HarnessId, SourceHolds } from './types.ts';
import { record, withoutBom } from './values.ts';
import { andList, orList, toolName } from './words.ts';

/**
 * One item of a kind at a link, read from where it sits (`folder`, from the repository's root: a skill's own folder, the folder
 * that holds an agent's files or a .mcp.json; `folderName`, that folder's own name, the repository's for its root): its files
 * there, by path from `folder` (every file in a skill's folder, read or not), and its content, or why it is unreadable (and
 * `leftOut`: read, and not brought in by a rule). `own`: a tool's own part, by the tool whose form a file of it is in (an
 * agent's whole file, a server's other fields: library.ts A SOURCE, each tool's own fields); none for a kind without one.
 */
export type ItemThere<Content> = { folder: string; folderName: string; key: string; name: string; files: string[]; hash: string; content: Content; own?: Partial<Record<HarnessId, string>> }
  | { folder: string; folderName: string; key: string; name?: string; files: string[]; unreadable: string; leftOut?: true };
/**
 * A kind's reader (sources.ts SourceKind `at`): every item of its kind at `folder` in a copy (`root`); `rootName` names one at
 * the repository's root that its own file doesn't name; `earlier`, the items the kinds before it in the table found there,
 * each holding its `files` under its `folder` (heldEarlier).
 */
export type ReaderAt<Content> = (root: string, folder: string, rootName: string, earlier: readonly ItemThere<unknown>[]) => Promise<ItemThere<Content>[]>;
/**
 * What is at a link (holdsAt): what its folder is, and each kind's items there, in the table's order (none for no folder there,
 * a plugin or a marketplace).
 */
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
  for (const entry of kinds) read.push({ entry, items: await entry.at(root, folder, repoName(repository), read.flatMap(each => each.items)) });
  return { holds: read.some(each => each.items.length) ? 'items' : 'empty', kinds: read };
}
/** Whether an item an earlier kind found holds this path (from the repository's root): its folder joined with one of its files. */
const heldEarlier = (earlier: readonly ItemThere<unknown>[], path: string) => earlier.some(item => item.files.some(file => join(item.folder, file) === path));
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

/**
 * Every skill at the link's `folder`: one skill (a SKILL.md there), else each folder inside it with one, else skills/<folder>/.
 * A skill is its whole folder, byte for byte, without the repository's .git; two skills of one name are both unreadable.
 * Skills are the table's first kind, so nothing is read before them.
 */
export async function skillsAt(root: string, folder: string, rootName: string): Promise<ItemThere<SkillContent>[]> {
  const folders = await present(join(root, folder, 'SKILL.md')) ? [folder] : (await withSkill(root, folder)).length ? await withSkill(root, folder) : await withSkill(root, join(folder, 'skills'));
  const skills = await Promise.all(folders.map(each => skillAt(root, each, each === '' ? rootName : basename(each))));
  const twice = new Set(skills.map(skill => skill.key).filter((key, index, keys) => keys.indexOf(key) !== index));
  return skills.map(skill => (twice.has(skill.key) ? { ...skill, unreadable: `two skills here are named ${skill.name}`, leftOut: true } : skill));
}

/** A name a skill's folder can take in every tool: no separator, not hidden, not too long. */
const usableName = (name: string) => !!name && name.length <= 200 && !/[/\\:\0]/.test(name) && !name.startsWith('.');

/**
 * One skill's folder at a link: its name (its SKILL.md's, else its folder's, `folderName`), its files and its content, or why it
 * is unreadable. Its files are listed whatever else, so a later kind never reads one of them as its own (heldEarlier).
 */
async function skillAt(root: string, folder: string, folderName: string): Promise<ItemThere<SkillContent>> {
  const directory = join(root, folder), file = join(directory, 'SKILL.md'), tree = await readTree(directory), files = [...tree.files.keys()].sort();
  const unreadable = (why: string, name?: string, leftOut = false): ItemThere<SkillContent> =>
    ({ folder, folderName, key: itemKey(name ?? folderName), ...(name ? { name } : {}), files, unreadable: why, ...(leftOut ? { leftOut } : {}) });
  if (!(await lstat(file).then(info => info.isFile(), () => false))) return unreadable('its SKILL.md is not a plain file');
  let name: string;
  try { name = parseSkill(await readFile(file, 'utf8'), folderName).name.trim(); }
  catch (error) { return unreadable(`its SKILL.md can’t be read as a skill (${error instanceof Error ? error.message.replace(/\.$/, '') : 'its frontmatter'})`); }
  if (!usableName(name)) return unreadable(`its name “${name}” can’t be a folder’s name`, name, true);
  if (tree.held) return unreadable(`it can’t be copied as it is: ${tree.held.split('. ')[0].replace(/^It /, 'it ')}`, name, true);
  return { folder, folderName, key: itemKey(name), name, files, hash: tree.hash, content: { directory, hash: tree.hash } };
}

// ---------- Agents' reader ----------
// What at a link is an agent, place first, then content (agentsAt):
// - in an agents folder, one level deep, each file of that folder's form: `agents/` or `agent/` in the link's folder;
//   `.claude/agents/`, `.github/agents/` (`*.agent.md`), `.opencode/agent/` or `.opencode/agents/`, or `.codex/agents/`
//   (`*.toml`) there; or the link's folder itself when it is named `agents` or `agent`;
// - loose in the link's folder (when it is no agents folder): a `*.agent.md`, or a `.md` whose front matter names both `name`
//   and `description`;
// - never: a file named README, CHANGELOG, LICENSE, CONTRIBUTING, CLAUDE or AGENTS (any case, any suffix), a SKILL.md, a file
//   inside a skill's folder (heldEarlier: skills are the only kind before agents), a hidden file, or a file in any other folder.
// One test for "unreadable", in both places: a Markdown file whose front matter is there and doesn't parse (agentfiles.ts
// frontMatter), or a Codex TOML that can't be read as an agent, is unreadable, with why, and is never taken to be gone; a `.md`
// with no front matter at all is a document, neither an agent nor listed, so an `agents/index.md` page holds nothing back. A
// loose file whose front matter parses but no longer names both fields, or whose front matter was taken out, is gone.
// An agent's key and item name are its file's base name (`.agent.md`, `.md` or `.toml` taken off), never its front matter's
// `name`, which stays in its shared part as a tool's file keeps it: agents.ts writes a tool's file under the item's name, which
// must read back under the same key. Its version is the shared part as a tool reads it (agentfiles.ts parseAgent, agentHash).
// Two files of one key in one tool's form are both left out; in two tools' forms they are one agent when their shared parts
// are equal, each file that tool's own part (ItemThere `own`), else both are left out.
// Known misses, as the README says: a link that points straight at a commands or prompts folder reads each file there whose
// front matter names `name` and `description` as an agent (it arrives Off, and a delete sticks); agents in a subfolder of an
// agents folder are not read (a link to that subfolder reads them); and a loose `.md` whose front matter doesn't parse is an
// unreadable agent even if it was never meant as one, so while it is there the source turns no agent Off.

/** The agents folders inside a link's folder (agentsAt). */
const AGENT_FOLDERS = ['agents', 'agent', '.claude/agents', '.github/agents', '.opencode/agent', '.opencode/agents', '.codex/agents'];
/** A file that is never an agent, whatever its front matter: a project's own pages, and a skill's SKILL.md. */
const NOT_AN_AGENT = /^(readme|changelog|license|contributing|claude|agents)(\.|$)|^skill\.md$/i;
/** The suffix of an agents folder's files, by its path from the repository's root: Codex's TOML, Copilot's `.agent.md`, else Markdown. */
const suffixIn = (folder: string) => (folder.split('/').includes('.codex') ? '.toml' : folder.split('/').includes('.github') ? '.agent.md' : '.md');
/** The tool whose form a file at a link is in, by its path from the repository's root (library.ts A SOURCE). */
function formOf(path: string): AgentTool {
  const parts = path.split('/');
  return parts.includes('.codex') ? 'codex-cli' : parts.includes('.opencode') ? 'opencode-cli' : path.endsWith('.agent.md') ? 'copilot-cli' : 'claude-cli';
}
/** A file's base name: the item's name (`.agent.md`, `.md` or `.toml` taken off). */
const baseName = (file: string) => file.replace(/(\.agent\.md|\.md|\.toml)$/, '');
/** The folder that holds a path from the repository's root ('' for the root). */
const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** One file at a link read as an agent: its form's tool, and its agent and text, or why it is unreadable. */
type AgentFile = { path: string; tool: AgentTool; name: string } & ({ agent: SharedAgent; text: string } | { unreadable: string });

/** One file at a link (`path`, from the repository's root), read as an agent: none when it is no agent (a document; loose, a page that doesn't name both fields). */
async function agentFileAt(root: string, path: string, loose: boolean): Promise<AgentFile | undefined> {
  const tool = formOf(path), name = baseName(basename(path)), file = { path, tool, name };
  if (!(await lstat(join(root, path)).then(info => info.isFile(), () => false))) return loose ? undefined : { ...file, unreadable: `${path} is not a plain file` };
  const text = await readFile(join(root, path), 'utf8').catch(() => undefined);
  if (text === undefined) return { ...file, unreadable: `${path} can’t be read` };
  if (tool !== 'codex-cli') {
    const front = frontMatter(text);
    if (front === 'none') return undefined;
    if ('broken' in front) return { ...file, unreadable: `${path} can’t be read as an agent (${front.broken})` };
    if (loose && !path.endsWith('.agent.md') && !('name' in front.fields && 'description' in front.fields)) return undefined;
  }
  const agent = parseAgent(tool, name, text);
  if (!agent) return { ...file, unreadable: `${path} can’t be read as an agent${tool === 'codex-cli' ? ' (no developer_instructions in it)' : ''}` };
  return { ...file, agent: { name: agent.name, description: agent.description, prompt: agent.prompt }, text };
}

/** Every agent at the link's `folder` (the header above), each with its files by path from the folder that holds them. */
export async function agentsAt(root: string, folder: string, rootName: string, earlier: readonly ItemThere<unknown>[]): Promise<ItemThere<SharedAgent>[]> {
  const listed = async (at: string) => (await readdir(join(root, at), { withFileTypes: true }).catch(() => []))
    .filter(entry => !entry.isDirectory() && !entry.name.startsWith('.') && !NOT_AN_AGENT.test(entry.name)).map(entry => join(at, entry.name)).filter(path => !heldEarlier(earlier, path)).sort();
  const itself = ['agents', 'agent'].includes(basename(folder));
  const files: AgentFile[] = [];
  for (const at of [...(itself ? [folder] : []), ...AGENT_FOLDERS.map(inner => join(folder, inner))]) {
    for (const path of (await listed(at)).filter(each => each.endsWith(suffixIn(at)))) { const read = await agentFileAt(root, path, false); if (read) files.push(read); }
  }
  if (!itself) for (const path of (await listed(folder)).filter(each => each.endsWith('.md'))) { const read = await agentFileAt(root, path, true); if (read) files.push(read); }
  const byKey = new Map<string, AgentFile[]>();
  for (const file of files) byKey.set(itemKey(file.name), [...byKey.get(itemKey(file.name)) ?? [], file]);
  return [...byKey.values()].map(each => agentOf(each, folder, rootName));
}

/** One agent from its files at a link (one key's): the one agent they hold, or why it is unreadable (agentsAt's header). */
function agentOf(files: AgentFile[], folder: string, rootName: string): ItemThere<SharedAgent> {
  const at = files.every(file => parentOf(file.path) === parentOf(files[0].path)) ? parentOf(files[0].path) : folder;
  const name = files[0].name, where = { folder: at, folderName: at ? basename(at) : rootName, key: itemKey(name), name, files: files.map(file => file.path.slice(at ? at.length + 1 : 0)) };
  const broken = files.find(file => 'unreadable' in file);
  if (broken && 'unreadable' in broken) return { ...where, unreadable: broken.unreadable };
  const read = files as Extract<AgentFile, { agent: SharedAgent }>[], forms = read.map(file => file.tool);
  const twice = forms.find((tool, index) => forms.indexOf(tool) !== index);
  if (twice) return { ...where, unreadable: `two files here are named ${name} in ${toolName(twice)}’s form`, leftOut: true };
  if (new Set(read.map(file => agentHash(file.agent))).size > 1) return { ...where, unreadable: `its ${andList(forms.map(toolName))} files differ in name, description or prompt`, leftOut: true };
  return { ...where, hash: agentHash(read[0].agent), content: read[0].agent, own: Object.fromEntries(read.map(file => [file.tool, file.text])) };
}

// ---------- MCP servers' reader ----------
// What at a link is an MCP server (serversAt): an entry of the `.mcp.json` in the link's folder (Claude Code's project file),
// a plain file, unless an earlier item holds that path (heldEarlier: a skill whose folder is the link's keeps it as one of its
// files). The file holds `{"mcpServers": {…}}` or the map bare. One that is no plain file, can't be read, isn't JSON, isn't an
// object, or whose `mcpServers` isn't an object is one unreadable line, keyed by the file's name and with no name (sources.ts
// namesOf), so no server turns Off. Each entry is read by Claude Code's own reader (mcp.ts fromJson): its key its name's, its
// version its shared part's hash, as Claude Code's entry reads back once written, and its other fields Claude Code's own part
// (`own`). Unreadable, with why: an entry that isn't an object, or has no command or no URL (mcp.ts cannotHold). Left out:
// two names that differ only by case (both); one that runs files from the repository or names a plugin's own folder or settings
// (mcp.ts runsFrom), or runs from inside an app (fromJson `hostBound`); one that mixes a command with a URL, which OpenCode
// and Codex would each hold differently.
// Never read: a tool's or editor's own settings (.vscode/mcp.json, .cursor/mcp.json, .claude/settings.json), an `mcp.json`
// without the dot, a .mcp.json in a folder inside (a link to that folder reads it), Central Knot's own repo layout
// (mcp/<name>.json), and a plugin's manifest (a link holding a plugin is read as nothing: holdsAt).
// Known miss, as the README says: a server left out stays left out while it is there, and the source never turns it Off.

/** Every MCP server in the `.mcp.json` at the link's `folder` (the header above). */
export async function serversAt(root: string, folder: string, rootName: string, earlier: readonly ItemThere<unknown>[]): Promise<ItemThere<NeutralServer>[]> {
  const path = join(folder, '.mcp.json'), where = { folder, folderName: folder ? basename(folder) : rootName, files: ['.mcp.json'] };
  const info = heldEarlier(earlier, path) ? undefined : await lstat(join(root, path)).catch(() => undefined);
  const file = (why: string): ItemThere<NeutralServer>[] => [{ ...where, key: itemKey('.mcp.json'), unreadable: `its .mcp.json ${why}` }];
  if (!info) return [];
  if (!info.isFile()) return file('is not a plain file');
  const text = await readFile(join(root, path), 'utf8').catch(() => undefined);
  if (text === undefined) return file('can’t be read');
  let parsed: unknown;
  try { parsed = JSON.parse(withoutBom(text)); } catch (error) { return file(`can’t be read as JSON (${error instanceof Error ? error.message : 'not JSON'})`); }
  const whole = record(parsed), servers = whole && 'mcpServers' in whole ? record(whole.mcpServers) : whole;
  if (!servers) return file(whole ? 'has an mcpServers that is not an object' : 'is not a JSON object');
  const keys = Object.keys(servers).map(itemKey);
  return Promise.all(Object.entries(servers).map(([name, raw]) => serverAt({ ...where, key: itemKey(name), name }, raw, keys.filter(key => key === itemKey(name)).length > 1, join(root, folder))));
}

/** One entry of a .mcp.json at a link (serversAt's header): its server and Claude Code's own part, or why it is unreadable or left out. */
async function serverAt(where: Omit<ItemThere<never>, 'hash' | 'content' | 'unreadable'> & { name: string }, raw: unknown, twin: boolean, at: string): Promise<ItemThere<NeutralServer>> {
  const unreadable = (why: string, leftOut = false): ItemThere<NeutralServer> => ({ ...where, unreadable: why, ...(leftOut ? { leftOut } : {}) });
  const clause = (sentence: string) => sentence.replace(/\.$/, '').replace(/^It /, 'it ');
  const fields = record(raw);
  if (!fields) return unreadable('its entry in .mcp.json is not an object');
  const entry = fromJson(where.name, 'claude-cli', '', fields), server = entry.server, cannot = cannotHold('claude-cli', server);
  if (cannot) return unreadable(clause(cannot));
  if (twin) return unreadable('another server in its .mcp.json has this name but for case', true);
  const runs = await runsFrom(fields, at);
  if (runs) return unreadable(runs === 'settings' ? 'it names a plugin’s own folder or settings, which only Claude Code fills in, for a plugin' : 'it runs files from the repository, which aren’t copied', true);
  if (entry.hostBound) return unreadable(clause(entry.hostBound), true);
  const mixed = server.transport === 'stdio' ? !!(server.url ?? server.headers) : !!(server.command ?? server.args ?? server.env ?? server.cwd);
  if (mixed) return unreadable('it has both a command and a URL, which not every tool can hold', true);
  return { ...where, hash: entry.hash, content: server, own: { 'claude-cli': ownPartOf(entry) } };
}

// ---------- A read, and why it holds nothing ----------

/** A click on one name's line at a source, as its kind's read carries it: Add on one held deleted (`bringBack`), or Replace, Merge or Keep mine on one whose version waits (`replace`, `merge`, `keep`). */
export type RowClick = Pick<SourceRead<unknown>, 'bringBack' | 'replace' | 'merge' | 'keep'>;

/** Whether what is at a link holds an item of any kind that can be read. */
const readable = (found: Holds) => found.kinds.some(each => each.items.some(item => !('unreadable' in item)));

/**
 * What was read at a source of one kind, as the pass and the table are given it (the one place that decides it): each item of
 * that kind there by key, with its content or why it is unreadable, and whether the source was read whole for this kind
 * (library.ts "Read whole"). `recorded`: the ids of the sources the home records.
 */
export function readOf(source: SourceRecord, found: Holds, entry: SourceKind, recorded: ReadonlySet<string>, clicked: RowClick = {}): SourceRead<unknown> {
  const there = itemsOf(found, entry), names: SourceRead<unknown>['names'] = new Map();
  for (const item of there) names.set(item.key, 'unreadable' in item ? { unreadable: item.unreadable } : { name: item.name, hash: item.hash, content: item.content, ...(item.own ? { own: item.own } : {}) });
  // An item left out was read: only one that could not be read holds back this kind's drops.
  const whole = found.holds === 'items' && readable(found) && there.every(item => !('unreadable' in item) || item.leftOut);
  return { id: source.id, link: source.link, commitAt: source.commitAt, kind: entry.kind.kind, mergeWith: entry.kind.merge, whole, names, recorded, ...clicked };
}

/** Each kind's word for one item, as a sentence that names any of them says it: "skill, agent or MCP server". */
const anyItem = (found: Holds) => orList(found.kinds.map(each => each.entry.kind.words.item));

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
