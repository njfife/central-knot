// What a marketplace says about itself and about each plugin, read from its own files: READMEs, where each plugin comes
// from, and what each plugin holds. Read only; nothing here runs a plugin, a hook or a server.
// Every file read must resolve, links followed, to a path inside the marketplace (or the plugin's own repository).
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { nameAndDescription } from './discovery.ts';
import type { HarnessId, NamedPart, PluginContents, PluginDetail } from './types.ts';
import { githubRepo, isFolder, isHttps, record, strings, text } from './values.ts';

const README_LIMIT = 60_000;
/** No file from a repository is read past this; front matter and READMEs need far less. */
const READ_LIMIT = 256 * 1024;
/** A marketplace.json lists every plugin, so it may be far larger than any other file read here. */
const MANIFEST_LIMIT = 8 * 1024 * 1024;
/** Values only Claude Code fills in (the plugin's own folder, its data folder, install-time settings): such a server can't run on its own. */
export const PLUGIN_ONLY = /\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|user_config\.)/;
/** Where a marketplace describes itself, relative to its root. */
export const MANIFEST = '.claude-plugin/marketplace.json';
/** Where Codex's own marketplaces (such as the ones ChatGPT desktop adds) describe themselves; only Codex reads this one. */
export const CODEX_MANIFEST = '.agents/plugins/marketplace.json';

/** True when `path` names something inside `root`, after both are resolved through links. A missing path is not inside. */
export async function inside(root: string, path: string): Promise<boolean> {
  try {
    const [base, target] = await Promise.all([realpath(root), realpath(path)]);
    const way = relative(base, target);
    return way === '' || (!isAbsolute(way) && way !== '..' && !way.startsWith(`..${sep}`));
  } catch { return false; }
}

/**
 * A file's text, only if it resolves inside `root`: at most `limit` bytes, with `whole` false when the file goes on past
 * that. Undefined when it is missing, unreadable or outside.
 */
async function readInside(root: string, path: string, limit = READ_LIMIT): Promise<{ text: string; whole: boolean } | undefined> {
  if (!(await inside(root, path))) return undefined;
  try {
    const file = await open(path, 'r');
    try {
      // Sized to the file, so a small file under a large limit doesn't cost the whole limit.
      const buffer = Buffer.alloc(Math.min((await file.stat()).size, limit) + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      return { text: buffer.subarray(0, Math.min(bytesRead, limit)).toString('utf8'), whole: bytesRead <= limit };
    } finally { await file.close(); }
  } catch { return undefined; }
}
const textInside = async (root: string, path: string) => (await readInside(root, path))?.text;
/** A skill, command or agent file is shown whole up to this size; past it, what is shown says so. */
const PART_FILE_LIMIT = 4 * 1024 * 1024;
/** A part's file as written, or with a last line saying it was cut when it is larger than PART_FILE_LIMIT. */
async function partFile(root: string, path: string): Promise<string | undefined> {
  const read = await readInside(root, path, PART_FILE_LIMIT);
  return read && (read.whole ? read.text : `${read.text}\n\n[Central Knot shows the first ${PART_FILE_LIMIT / 1024 / 1024} MB of this file.]`);
}
/** A JSON object from text, or undefined when it isn't JSON or isn't an object. */
export const parseObject = (raw: string) => { try { return record(JSON.parse(raw)); } catch { return undefined; } };
/** A JSON object from a file inside `root`, or undefined when it is missing, outside, too large to be whole, or not an object. */
const jsonInside = async (root: string, path: string) => { const read = await readInside(root, path); return read?.whole ? parseObject(read.text) : undefined; };

/**
 * The marketplace.json in `root` as an object, or the problem that kept it from being read. Without Claude Code's
 * .claude-plugin one, Codex's .agents/plugins one is read, and `codexOnly` says so.
 */
export async function readManifest(root: string): Promise<{ manifest: Record<string, unknown>; codexOnly: boolean } | { problem: string }> {
  const claude = await readInside(root, join(root, MANIFEST), MANIFEST_LIMIT);
  const read = claude ?? await readInside(root, join(root, CODEX_MANIFEST), MANIFEST_LIMIT);
  if (!read) return { problem: `There is no marketplace here: no ${MANIFEST} or ${CODEX_MANIFEST}.` };
  if (!read.whole) return { problem: `Its marketplace.json is larger than ${MANIFEST_LIMIT / 1024 / 1024} MB, so it isn’t read.` };
  const manifest = parseObject(read.text);
  return manifest ? { manifest, codexOnly: !claude } : { problem: 'Its marketplace.json could not be read as JSON.' };
}
const listInside = async (root: string, folder: string) => ((await inside(root, folder)) ? readdir(folder).catch(() => [] as string[]) : [] as string[]);
/** Whether something is at this path, readable or not: a file that is there but can't be read is not absent. */
const present = (path: string) => lstat(path).then(() => true, error => error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR');
/** The same listing, noting in `unread` ('*', when given) a folder that is there but can't be listed or is outside. */
const listOrNote = async (root: string, folder: string, unread?: string[]) => {
  if (!(await inside(root, folder))) { if (unread && await present(folder)) unread.push('*'); return [] as string[]; }
  return readdir(folder).catch(error => { if (unread && !['ENOENT', 'ENOTDIR'].includes(String(error?.code))) unread.push('*'); return [] as string[]; });
};

/** The README in this folder, cut to a readable size. */
export async function readmeIn(folder: string, root = folder): Promise<string | undefined> {
  const name = (await listInside(root, folder)).find(entry => /^readme(\.md|\.markdown|\.txt)?$/i.test(entry));
  const body = name ? await textInside(root, join(folder, name)) : undefined;
  return body === undefined ? undefined : body.length > README_LIMIT ? `${body.slice(0, README_LIMIT)}\n\n…` : body;
}

/** A skill as the tools read it, from its SKILL.md `body` in folder `dir`: its `name` (else the folder's) and description. */
const skillPart = (body: string, dir: string): Pick<NamedPart, 'name' | 'description'> => { const meta = nameAndDescription(body); return { name: meta.name || basename(dir), description: meta.description ?? '' }; };
/** A skill's name as the tools read it: its SKILL.md's `name`, else its folder's. */
export const skillName = (body: string, dir: string) => skillPart(body, dir).name;


/** How many folder levels down Codex looks for a plugin's skills (MAX_SCAN_DEPTH: SKILL.md at most six below the root), and agents and commands are read. */
const NESTED_LEVELS = 6;

/**
 * Skills from the given paths: each one a skill folder (with SKILL.md) or, with `subfolders`, a folder of skill folders.
 * Read `asCodex`, every SKILL.md up to NESTED_LEVELS down counts, in skills nested inside skills too, and hidden folders
 * are skipped, as Codex walks a plugin's skills.
 * Each part's `path` is its folder relative to the plugin's `folder` ("." for the folder itself), the same in every copy.
 * A skill whose SKILL.md is there but can't be read, or a folder that can't be listed ('*'), is named in `unread`, when given.
 */
async function skillsIn(root: string, folder: string, paths: string[], subfolders = true, unread?: string[], asCodex = false): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  const add = async (dir: string) => {
    const path = relative(folder, dir) || '.';
    // A folder listed twice (skills/ and skills/pdf) is one skill.
    if (found.some(part => part.path === path)) return true;
    const body = await partFile(root, join(dir, 'SKILL.md'));
    if (body === undefined) { if (unread && await present(join(dir, 'SKILL.md'))) unread.push(basename(dir)); return false; }
    found.push({ ...skillPart(body, dir), text: body, path });
    return true;
  };
  const walk = async (dir: string, level: number): Promise<void> => {
    await add(dir);
    if (level < NESTED_LEVELS - 1) for (const name of await listOrNote(root, dir, unread)) if (!name.startsWith('.')) await walk(join(dir, name), level + 1);
  };
  for (const path of paths) {
    if (asCodex) await walk(path, 0);
    else if (!(await add(path)) && subfolders) for (const name of await listOrNote(root, path, unread)) await add(join(path, name));
  }
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/** A command's or agent's name from its file: without `.md`, and without Copilot's `.agent.md` (`reviewer.agent.md` is the agent `reviewer`). */
const agentName = (file: string) => basename(file, '.md').replace(/\.agent$/, '');

/**
 * Markdown files (commands, agents) in the given files and folders, and in those folders' subfolders, NESTED_LEVELS down.
 * Each part's `path` is its file relative to the plugin's `folder`. A file listed there that can't be read, or a folder
 * that can't be listed ('*'), is named in `unread`, when given.
 */
async function markdownIn(root: string, folder: string, paths: string[], unread?: string[]): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  const filesIn = async (dir: string, level: number): Promise<string[]> => {
    const names = await listOrNote(root, dir, unread);
    const deeper = level < NESTED_LEVELS - 1 ? await Promise.all(names.filter(name => !name.endsWith('.md')).map(name => filesIn(join(dir, name), level + 1))) : [];
    return [...names.filter(name => name.endsWith('.md')).map(name => join(dir, name)), ...deeper.flat()];
  };
  for (const path of paths) {
    const files = path.endsWith('.md') ? [path] : await filesIn(path, 0);
    for (const file of files) {
      if (found.some(part => part.path === relative(folder, file))) continue;
      const body = await partFile(root, file);
      if (body === undefined) { if (unread && await present(file)) unread.push(agentName(file)); continue; }
      const meta = nameAndDescription(body);
      found.push({ name: meta.name || agentName(file), description: meta.description ?? '', text: body, path: relative(folder, file) });
    }
  }
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/** What an MCP server runs: its command and arguments, or the URL it connects to. */
function serverRuns(server: unknown): string {
  const entry = record(server);
  if (!entry) return '';
  return text(entry.url) || [text(entry.command), ...(strings(entry.args) ?? [])].filter(Boolean).join(' ');
}

/** A plugin's own .claude-plugin/plugin.json as an object, or undefined when it has none. */
export const pluginManifest = (folder: string, root = folder) => jsonInside(root, join(folder, '.claude-plugin/plugin.json'));
/**
 * The one manifest Codex reads for a plugin copy: its .codex-plugin/plugin.json, else Claude Code's; {} when it has
 * neither. (Codex also looks first for a root plugin.json naming the agent-plugins schema; that rare layout isn't read.)
 */
export const codexManifest = async (folder: string) => (await jsonInside(folder, join(folder, '.codex-plugin/plugin.json'))) ?? (await pluginManifest(folder)) ?? {};

/**
 * One plugin section (hooks, MCP servers, LSP servers): its default file in the plugin folder, merged with what the
 * plugin's entry names, which may be inline, a path to a JSON file, or a list of paths. A file or inline value may hold
 * the section under its own key (`{"mcpServers": {…}}`) or be the section itself (`{"github": {…}}`); plugins in the
 * wild use both, so both are read.
 */
async function section(root: string, folder: string, named: unknown, key: string, defaultFile: string): Promise<{ values: Record<string, unknown>; unread: boolean }> {
  const unwrap = (value: Record<string, unknown> | undefined) => record(value?.[key]) ?? value ?? {};
  let unread = false;
  const fromFile = async (path: string) => {
    const value = await jsonInside(root, resolve(folder, path));
    // There, but not readable as a whole JSON object, or holding the section as something other than an object
    // (`"mcpServers": null`): some entries may be missing from what is returned.
    if (!value && await present(resolve(folder, path))) unread = true;
    if (value && key in value && !record(value[key])) { unread = true; return {}; }
    return unwrap(value);
  };
  const paths = typeof named === 'string' ? [named] : Array.isArray(named) ? strings(named) ?? [] : [];
  const parts = [await fromFile(defaultFile), ...(await Promise.all(paths.map(fromFile))), unwrap(record(named))];
  return { values: Object.assign({}, ...parts), unread };
}

/**
 * How to read a plugin's parts: as Codex does, by the one manifest it picks (`codex`); as Copilot CLI does, where a listed
 * skills folder replaces skills/ (`skillsListReplaces`); and whether the plugin is its marketplace's own root.
 */
export interface ReadAs { codex?: Record<string, unknown>; skillsListReplaces?: boolean; atMarketplaceRoot?: boolean }

/** A plugin's manifest as `readAs` says it is read, and the entry that adds to it (none for Codex). */
async function manifestOf(folder: string, entry: Record<string, unknown>, root: string, { codex }: ReadAs) {
  return { own: codex ?? (await pluginManifest(folder, root)) ?? {}, added: codex ? {} : entry };
}
/** The files and folders lists name, each once, resolved in `folder`: paths, lists of paths, or (commands) a map of name to { source }. */
const listedPaths = (folder: string, ...lists: unknown[]) =>
  [...new Set(lists.flatMap(list => strings(list) ?? Object.values(record(list) ?? {}).map(item => text(record(item)?.source)).filter(Boolean)).map(path => resolve(folder, path)))];

/** A plugin's skills, read by each tool's rule (see pluginContents). */
async function skillsOf(folder: string, entry: Record<string, unknown>, root: string, readAs: ReadAs, unread?: string[]): Promise<NamedPart[]> {
  const { own, added } = await manifestOf(folder, entry, root, readAs);
  const skillsFolder = join(folder, 'skills');
  const isListed = own.skills !== undefined || added.skills !== undefined;
  const skillPaths = () => {
    // Codex: its list, keeping only ./ paths as Codex does, replaces skills/; an empty one falls back to it.
    if (readAs.codex) { const listed = listedPaths(folder, (strings(own.skills) ?? []).filter(path => path.startsWith('./'))); return listed.length ? listed : [skillsFolder]; }
    // Copilot CLI: what is listed replaces skills/.
    if (readAs.skillsListReplaces && isListed) return listedPaths(folder, own.skills, added.skills);
    // A marketplace's root plugin whose entry lists skills: only those.
    if (readAs.atMarketplaceRoot && added.skills !== undefined) return listedPaths(folder, added.skills);
    // Otherwise skills/ is always read, with every listed folder added.
    return listedPaths(folder, skillsFolder, own.skills, added.skills);
  };
  const listed = await skillsIn(root, folder, skillPaths(), true, unread, !!readAs.codex);
  // Claude Code: a plugin with no skills/ (an empty one counts as none) and no list may be one skill, SKILL.md at its root.
  return listed.length || readAs.codex || isListed ? listed : skillsIn(root, folder, [folder], false, unread);
}

/**
 * The skills an installed copy of a plugin holds, by name, read as its page reads it (see pluginContents): with its
 * marketplace `entry`, or as Codex reads it when `codex` gives the manifest Codex picks.
 */
export async function skillNamesIn(folder: string, entry: Record<string, unknown> = {}, readAs: ReadAs = {}): Promise<string[]> {
  return (await skillsOf(folder, entry, folder, readAs)).map(part => part.name);
}

/**
 * What one plugin holds, by name, read as Claude Code reads it (or, with `codex`, as Codex does). `root` bounds every
 * read: the marketplace, or the plugin's own repository.
 * - Claude Code: plugin.json is the manifest, and its marketplace `entry` adds to it: the entry's skills, commands and
 *   agents are appended to plugin.json's lists (its default, "strict" mode); plugin.json's version wins. With no
 *   plugin.json the entry is the manifest. skills/ is always read, with listed skill folders added, except for a
 *   marketplace's root plugin whose entry lists skills: only those load. Commands and agents lists replace their folders.
 * - Codex (`codex`): only the manifest Codex picks, without the entry; a skills list replaces skills/ unless it is empty.
 * - A plugin that is one skill (SKILL.md at its root, no skills/, no list) is that skill.
 * Lists are paths, lists of paths, or (commands) a map of name to { source }: such a command is named by its file, not
 * its key, and an inline { content } one isn't listed. Agents folders are read too, though Claude Code takes only files.
 * An entry with "strict": false that also lists parts beside a plugin.json is one Claude Code refuses; it is read merged.
 * Hooks and servers are read from their default files plus whatever plugin.json or the entry names.
 */
export async function pluginContents(folder: string, entry: Record<string, unknown>, root: string, readAs: ReadAs = {}): Promise<PluginContents> {
  const { own, added } = await manifestOf(folder, entry, root, readAs);
  const declared: Record<string, unknown> = { ...own, ...added, version: text(own.version) || added.version };
  const listedOr = (key: string, fallback: string) => (own[key] === undefined && added[key] === undefined ? [fallback] : listedPaths(folder, own[key], added[key]));
  const hooks = (await section(root, folder, declared.hooks, 'hooks', 'hooks/hooks.json')).values;
  const servers = (await section(root, folder, declared.mcpServers, 'mcpServers', '.mcp.json')).values;
  const lsp = (await section(root, folder, declared.lspServers, 'lspServers', '.lsp.json')).values;
  return {
    skills: await skillsOf(folder, entry, root, readAs),
    commands: await markdownIn(root, folder, listedOr('commands', join(folder, 'commands'))),
    agents: await markdownIn(root, folder, listedOr('agents', join(folder, 'agents'))),
    hooks: Object.keys(hooks).sort(),
    mcpServers: Object.entries(servers).map(([name, server]) => ({ name, runs: serverRuns(server) })).sort((first, second) => first.name.localeCompare(second.name)),
    mcpUsesPluginRoot: JSON.stringify(servers).includes('${CLAUDE_PLUGIN_ROOT}'),
    lspServers: Object.keys(lsp).sort(),
    bin: (await listInside(root, folder)).includes('bin'),
    version: text(declared.version) || undefined,
  };
}

/**
 * What a tool's installed copy of a plugin holds (in `path`), as that tool reads it: Codex by its own manifest, Copilot CLI
 * with a skills list replacing the skills folder. `entry`: its marketplace entry, where known.
 */
export async function installedContents(tool: HarnessId, path: string, entry: Record<string, unknown> = {}, atMarketplaceRoot = false): Promise<PluginContents> {
  return pluginContents(path, entry, path, { codex: tool === 'codex-cli' ? await codexManifest(path) : undefined, skillsListReplaces: tool === 'copilot-cli', atMarketplaceRoot });
}

/** The files behind a plugin's skills, agents and MCP servers, for installing them as separate items (plugin parts). */
export interface PluginFiles {
  /** The plugin's folder: a server's relative paths are checked against it. */
  folder: string;
  skills: { name: string; dir: string }[];
  agents: { name: string; text: string; whole: boolean }[];
  servers: Record<string, unknown>;
  /**
   * What is there but couldn't be read: skills and agents by name, or '*' when a folder of them (or plugin.json, which may
   * name other folders) couldn't be read; `servers` when a servers file isn't readable JSON. An update keeps those parts
   * as installed rather than reading their absence as the plugin dropping them.
   */
  unread: { skills: string[]; agents: string[]; servers: boolean };
}
/** A plugin's parts as Claude Code reads them (the same readers as pluginContents), with the files to copy. */
export async function pluginFiles(folder: string, entry: Record<string, unknown>, root: string): Promise<PluginFiles> {
  const { own, added } = await manifestOf(folder, entry, root, {});
  const declared: Record<string, unknown> = { ...own, ...added };
  const listedOr = (key: string, fallback: string) => (own[key] === undefined && added[key] === undefined ? [fallback] : listedPaths(folder, own[key], added[key]));
  // An unreadable plugin.json may declare other folders for any kind: every kind's contents count as unknown then.
  const manifest = join(folder, '.claude-plugin/plugin.json');
  const manifestUnread = !(await pluginManifest(folder, root)) && await present(manifest);
  const servers = await section(root, folder, declared.mcpServers, 'mcpServers', '.mcp.json');
  const unread = { skills: manifestUnread ? ['*'] : [] as string[], agents: manifestUnread ? ['*'] : [] as string[], servers: servers.unread || manifestUnread };
  const skills = (await skillsOf(folder, entry, root, {}, unread.skills)).map(part => join(folder, part.path));
  const agents: PluginFiles['agents'] = [];
  for (const part of await markdownIn(root, folder, listedOr('agents', join(folder, 'agents')), unread.agents)) {
    // Read again with its size known: a part copied as an item is never a cut copy.
    const file = join(folder, part.path);
    const read = await readInside(root, file, PART_FILE_LIMIT);
    if (read) agents.push({ name: agentName(file), text: read.text, whole: read.whole });
    else unread.agents.push(agentName(file));
  }
  return { folder, skills: skills.map(dir => ({ name: basename(dir), dir })), agents, servers: servers.values, unread };
}

/**
 * A plugin's contents plus its README. A plugin that is the marketplace's own root (`atMarketplaceRoot`) has no README of
 * its own: it shares the marketplace's, which the marketplace's page already shows.
 */
export async function pluginDetail(folder: string, entry: Record<string, unknown>, root: string, atMarketplaceRoot = false): Promise<PluginDetail> {
  return { ...(await pluginContents(folder, entry, root, { atMarketplaceRoot })), readme: atMarketplaceRoot ? undefined : await readmeIn(folder, root), offered: true };
}

/** Where a plugin outside the marketplace lives: a Git URL to read it from (https only), a folder in it and a branch. */
export function remoteOf(where: unknown): { url: string; path: string; ref?: string; sha?: string } | undefined {
  const entry = record(where);
  if (!entry) return undefined;
  const path = text(entry.path).replace(/^\.?\//, '');
  // A branch or tag must look like one (never an option); a pinned commit is 7 to 40 hex digits.
  const ref = /^[\w./-]{1,200}$/.test(text(entry.ref)) && !text(entry.ref).startsWith('-') ? text(entry.ref) : undefined;
  const sha = /^[0-9a-f]{7,40}$/i.test(text(entry.sha)) ? text(entry.sha) : undefined;
  const repo = entry.source === 'github' ? githubRepo(text(entry.repo)) : undefined;
  if (repo) return { url: `https://github.com/${repo}.git`, path, ref, sha };
  if (['url', 'git-subdir', 'git'].includes(text(entry.source)) && isHttps(entry.url)) return { url: text(entry.url), path, ref, sha };
  return undefined;
}

/** Where a plugin outside the marketplace comes from, in words, with an https web link when there is one. */
export function sourceOf(where: unknown): { label: string; url?: string } | undefined {
  const entry = record(where);
  if (!entry) return undefined;
  const kind = text(entry.source);
  const remote = remoteOf(where);
  if (remote) {
    const web = remote.url.replace(/\.git$/, '');
    const repo = githubRepo(web);
    const label = `${repo ? `GitHub: ${repo}` : web.slice('https://'.length)}${remote.path ? `/${remote.path}` : ''}`;
    return { label, url: remote.path && repo ? `${web}/tree/${remote.ref ?? 'HEAD'}/${remote.path}` : web };
  }
  if (kind === 'npm' && /^(@[\w.-]+\/)?[\w.-]+$/.test(text(entry.package))) return { label: `npm: ${text(entry.package)}`, url: `https://www.npmjs.com/package/${text(entry.package)}` };
  if (kind === 'pip' && text(entry.package)) return { label: `pip: ${text(entry.package)}` };
  if (kind === 'command' && text(entry.command)) return { label: `Found by running: ${text(entry.command)}` };
  if (text(entry.url)) return { label: text(entry.url) };
  return kind ? { label: kind } : undefined;
}

/** Where a marketplace comes from, short: "GitHub: owner/repo", "Folder: name" (a local folder), or the source as given. */
export function sourceLabel(source: string): string {
  const repo = githubRepo(source);
  if (repo) return `GitHub: ${repo}`;
  return isFolder(source) ? `Folder: ${basename(resolve(source))}` : source;
}

/** A web page for the marketplace itself, for GitHub sources. */
export function marketplacePage(source: string): string | undefined {
  const repo = githubRepo(source);
  return repo ? `https://github.com/${repo}` : undefined;
}
