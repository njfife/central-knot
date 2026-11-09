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
      const buffer = Buffer.alloc(limit + 1);
      const { bytesRead } = await file.read(buffer, 0, limit + 1, 0);
      return { text: buffer.subarray(0, Math.min(bytesRead, limit)).toString('utf8'), whole: bytesRead <= limit };
    } finally { await file.close(); }
  } catch { return undefined; }
}
const textInside = async (root: string, path: string) => (await readInside(root, path))?.text;
const parseObject = (raw: string) => { try { return record(JSON.parse(raw)); } catch { return undefined; } };
/** A JSON object from a file inside `root`, or undefined when it is missing, outside, too large to be whole, or not an object. */
export const jsonInside = async (root: string, path: string) => { const read = await readInside(root, path); return read?.whole ? parseObject(read.text) : undefined; };

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


/** Skills from the given paths: each one a skill folder (with SKILL.md) or a folder of skill folders. */
async function skillsIn(root: string, paths: string[]): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  const add = async (dir: string) => {
    const body = await textInside(root, join(dir, 'SKILL.md'));
    if (body === undefined) return false;
    const meta = nameAndDescription(body);
    found.push({ name: meta.name || basename(dir), description: meta.description ?? '' });
    return true;
  };
  for (const path of paths) if (!(await add(path))) for (const name of await listInside(root, path)) await add(join(path, name));
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/** Markdown files (commands, agents) in the given files and folders. */
async function markdownIn(root: string, paths: string[]): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  for (const path of paths) {
    const files = path.endsWith('.md') ? [path] : (await listInside(root, path)).filter(name => name.endsWith('.md')).map(name => join(path, name));
    for (const file of files) {
      const body = await textInside(root, file);
      if (body === undefined) continue;
      const meta = nameAndDescription(body);
      found.push({ name: meta.name || basename(file, '.md'), description: meta.description ?? '' });
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

/** A section given inline or as a path to a JSON file (plugin.json allows both for hooks and MCP servers). */
async function inlineOrFile(root: string, folder: string, value: unknown, key: string): Promise<Record<string, unknown>> {
  const found = typeof value === 'string' ? await jsonInside(root, resolve(folder, value)) : record(value);
  return record(found?.[key]) ?? found ?? {};
}

/**
 * What one plugin holds, by name. Its marketplace entry and plugin.json may list component paths ("strict": false entries
 * do); otherwise the default folders are read. `root` bounds every read: the marketplace, or the plugin's own repository.
 */
export async function pluginContents(folder: string, entry: Record<string, unknown>, root: string): Promise<PluginContents> {
  const manifest = (await jsonInside(root, join(folder, '.claude-plugin/plugin.json'))) ?? {};
  const merged = { ...manifest, ...entry };
  const listed = (key: string) => strings(merged[key])?.map(path => resolve(folder, path));
  const skillPaths = listed('skills') ?? [join(folder, 'skills')];
  const hooks = { ...(record((await jsonInside(root, join(folder, 'hooks/hooks.json')))?.hooks) ?? {}), ...(merged.hooks !== undefined ? await inlineOrFile(root, folder, merged.hooks, 'hooks') : {}) };
  const servers = { ...(record((await jsonInside(root, join(folder, '.mcp.json')))?.mcpServers) ?? {}), ...(merged.mcpServers !== undefined ? await inlineOrFile(root, folder, merged.mcpServers, 'mcpServers') : {}) };
  return {
    skills: await skillsIn(root, skillPaths),
    commands: await markdownIn(root, listed('commands') ?? [join(folder, 'commands')]),
    agents: await markdownIn(root, listed('agents') ?? [join(folder, 'agents')]),
    hooks: Object.keys(hooks).sort(),
    mcpServers: Object.entries(servers).map(([name, server]) => ({ name, runs: serverRuns(server) })).sort((first, second) => first.name.localeCompare(second.name)),
    mcpUsesPluginRoot: JSON.stringify(servers).includes('${CLAUDE_PLUGIN_ROOT}'),
    lspServers: Object.keys(record(merged.lspServers) ?? {}).sort(),
    bin: (await listInside(root, folder)).includes('bin'),
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
