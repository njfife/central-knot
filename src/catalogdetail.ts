// What a marketplace says about itself and about each plugin, read from its own files: READMEs, where each plugin comes
// from, and what each plugin holds. Read only; nothing here runs a plugin, a hook or a server.
// Every file read must resolve, links followed, to a path inside the marketplace (or the plugin's own repository).
import { open, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { nameAndDescription } from './discovery.ts';
import type { NamedPart, PluginContents, PluginDetail } from './types.ts';
import { githubRepo, isFolder, isHttps, record, strings, text } from './values.ts';

const README_LIMIT = 60_000;
/** No file from a repository is read past this; front matter and READMEs need far less. */
const READ_LIMIT = 256 * 1024;
/** A marketplace.json lists every plugin, so it may be far larger than any other file read here. */
const MANIFEST_LIMIT = 8 * 1024 * 1024;
/** Where a marketplace describes itself, relative to its root. */
export const MANIFEST = '.claude-plugin/marketplace.json';

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

/** The marketplace.json in `root` as an object, or the problem that kept it from being read. */
export async function readManifest(root: string): Promise<{ manifest: Record<string, unknown> } | { problem: string }> {
  const read = await readInside(root, join(root, MANIFEST), MANIFEST_LIMIT);
  if (!read) return { problem: 'There is no marketplace here: no .claude-plugin/marketplace.json.' };
  if (!read.whole) return { problem: `Its marketplace.json is larger than ${MANIFEST_LIMIT / 1024 / 1024} MB, so it isn’t read.` };
  const manifest = parseObject(read.text);
  return manifest ? { manifest } : { problem: 'Its marketplace.json could not be read as JSON.' };
}
const listInside = async (root: string, folder: string) => ((await inside(root, folder)) ? readdir(folder).catch(() => [] as string[]) : [] as string[]);

/** The README in this folder, cut to a readable size. */
export async function readmeIn(folder: string, root = folder): Promise<string | undefined> {
  const name = (await listInside(root, folder)).find(entry => /^readme(\.md|\.markdown|\.txt)?$/i.test(entry));
  const body = name ? await textInside(root, join(folder, name)) : undefined;
  return body === undefined ? undefined : body.length > README_LIMIT ? `${body.slice(0, README_LIMIT)}\n\n…` : body;
}

/**
 * Skills from the given paths: each one a skill folder (with SKILL.md) or a folder of skill folders. Each part's `path`
 * is its folder relative to the plugin's `folder`, the same in every copy of the plugin.
 */
async function skillsIn(root: string, folder: string, paths: string[]): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  const add = async (dir: string) => {
    const body = await partFile(root, join(dir, 'SKILL.md'));
    if (body === undefined) return false;
    const meta = nameAndDescription(body);
    found.push({ name: meta.name || basename(dir), description: meta.description ?? '', text: body, path: relative(folder, dir) });
    return true;
  };
  for (const path of paths) if (!(await add(path))) for (const name of await listInside(root, path)) await add(join(path, name));
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/**
 * Markdown files (commands, agents) in the given files and folders, and in those folders' subfolders one level down.
 * Each part's `path` is its file relative to the plugin's `folder`.
 */
async function markdownIn(root: string, folder: string, paths: string[]): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  const filesIn = async (folder: string) => (await listInside(root, folder)).filter(name => name.endsWith('.md')).map(name => join(folder, name));
  for (const path of paths) {
    const files = path.endsWith('.md') ? [path]
      : [...(await filesIn(path)), ...(await Promise.all((await listInside(root, path)).filter(name => !name.endsWith('.md')).map(name => filesIn(join(path, name))))).flat()];
    for (const file of files) {
      const body = await partFile(root, file);
      if (body === undefined) continue;
      const meta = nameAndDescription(body);
      found.push({ name: meta.name || basename(file, '.md'), description: meta.description ?? '', text: body, path: relative(folder, file) });
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
/** A plugin's .codex-plugin/plugin.json, which Codex reads before Claude Code's when a plugin has both. */
export const codexManifest = (folder: string) => jsonInside(folder, join(folder, '.codex-plugin/plugin.json'));

/**
 * One plugin section (hooks, MCP servers, LSP servers): its default file in the plugin folder, merged with what the
 * plugin's entry names, which may be inline, a path to a JSON file, or a list of paths. A file or inline value may hold
 * the section under its own key (`{"mcpServers": {…}}`) or be the section itself (`{"github": {…}}`); plugins in the
 * wild use both, so both are read.
 */
async function section(root: string, folder: string, named: unknown, key: string, defaultFile: string): Promise<Record<string, unknown>> {
  const unwrap = (value: Record<string, unknown> | undefined) => record(value?.[key]) ?? value ?? {};
  const fromFile = async (path: string) => unwrap(await jsonInside(root, resolve(folder, path)));
  const paths = typeof named === 'string' ? [named] : Array.isArray(named) ? strings(named) ?? [] : [];
  const parts = [await fromFile(defaultFile), ...(await Promise.all(paths.map(fromFile))), unwrap(record(named))];
  return Object.assign({}, ...parts);
}

/**
 * What one plugin holds, by name. Its marketplace entry and plugin.json may list component paths ("strict": false entries
 * do); otherwise the default folders are read. `root` bounds every read: the marketplace, or the plugin's own repository.
 */
export async function pluginContents(folder: string, entry: Record<string, unknown>, root: string): Promise<PluginContents> {
  const pluginJson = (await pluginManifest(folder, root)) ?? {};
  // The marketplace entry wins over plugin.json, as the tools read it.
  const declared = { ...pluginJson, ...entry };
  const listed = (key: string) => strings(declared[key])?.map(path => resolve(folder, path));
  const hooks = await section(root, folder, declared.hooks, 'hooks', 'hooks/hooks.json');
  const servers = await section(root, folder, declared.mcpServers, 'mcpServers', '.mcp.json');
  const lsp = await section(root, folder, declared.lspServers, 'lspServers', '.lsp.json');
  return {
    skills: await skillsIn(root, folder, listed('skills') ?? [join(folder, 'skills')]),
    commands: await markdownIn(root, folder, listed('commands') ?? [join(folder, 'commands')]),
    agents: await markdownIn(root, folder, listed('agents') ?? [join(folder, 'agents')]),
    hooks: Object.keys(hooks).sort(),
    mcpServers: Object.entries(servers).map(([name, server]) => ({ name, runs: serverRuns(server) })).sort((first, second) => first.name.localeCompare(second.name)),
    mcpUsesPluginRoot: JSON.stringify(servers).includes('${CLAUDE_PLUGIN_ROOT}'),
    lspServers: Object.keys(lsp).sort(),
    bin: (await listInside(root, folder)).includes('bin'),
    version: text(declared.version) || undefined,
  };
}

/**
 * A plugin's contents plus its README. `withReadme: false` leaves the README out: a plugin that is the marketplace's own
 * root shares the marketplace's README, which the marketplace's page already shows.
 */
export async function pluginDetail(folder: string, entry: Record<string, unknown>, root: string, withReadme = true): Promise<PluginDetail> {
  return { ...(await pluginContents(folder, entry, root)), readme: withReadme ? await readmeIn(folder, root) : undefined };
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
