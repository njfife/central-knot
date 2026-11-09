// What a marketplace says about itself and about each plugin, read from its own files: READMEs, where each plugin comes
// from, and what each plugin holds. Read only; nothing here runs a plugin, a hook or a server.
// Every file read must resolve, links followed, to a path inside the marketplace (or the plugin's own repository).
import { readdir, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NamedPart, PluginContents, PluginDetail } from './types.ts';

const README_LIMIT = 60_000;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const strings = (value: unknown) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);
const record = (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** True when `path` names something inside `root`, after both are resolved through links. A missing path is not inside. */
export async function inside(root: string, path: string): Promise<boolean> {
  try {
    const [base, target] = await Promise.all([realpath(root), realpath(path)]);
    const way = relative(base, target);
    return way === '' || (!isAbsolute(way) && way !== '..' && !way.startsWith(`..${sep}`));
  } catch { return false; }
}

/** A file's text, only if it resolves inside `root`. */
async function readInside(root: string, path: string): Promise<string | undefined> {
  return (await inside(root, path)) ? readFile(path, 'utf8').catch(() => undefined) : undefined;
}
const jsonInside = async (root: string, path: string) => { const raw = await readInside(root, path); try { return raw === undefined ? undefined : record(JSON.parse(raw)); } catch { return undefined; } };
const listInside = async (root: string, folder: string) => ((await inside(root, folder)) ? readdir(folder).catch(() => [] as string[]) : [] as string[]);

/** The README in this folder, cut to a readable size. */
export async function readmeIn(folder: string, root = folder): Promise<string | undefined> {
  const name = (await listInside(root, folder)).find(entry => /^readme(\.md|\.markdown|\.txt)?$/i.test(entry));
  const body = name ? await readInside(root, join(folder, name)) : undefined;
  return body === undefined ? undefined : body.length > README_LIMIT ? `${body.slice(0, README_LIMIT)}\n\n…` : body;
}

/** `name` and `description` from a Markdown file's front matter, including folded (`>`) and literal (`|`) descriptions. */
export function frontMatter(body: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!match) return {};
  const lines = match[1]!.split(/\r?\n/);
  const value = (key: string) => {
    const at = lines.findIndex(line => line.startsWith(`${key}:`));
    if (at < 0) return undefined;
    const first = lines[at]!.slice(key.length + 1).trim();
    if (/^[>|]-?$/.test(first)) {
      const rest: string[] = [];
      for (const line of lines.slice(at + 1)) { if (!/^\s+\S/.test(line)) break; rest.push(line.trim()); }
      return rest.join(first.startsWith('|') ? '\n' : ' ');
    }
    return first.replace(/^(["'])([\s\S]*)\1$/, '$2');
  };
  return { name: value('name'), description: value('description') };
}

async function skillsIn(root: string, dirs: string[]): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  for (const dir of dirs) {
    const body = await readInside(root, join(dir, 'SKILL.md'));
    if (body === undefined) continue;
    const meta = frontMatter(body);
    found.push({ name: meta.name || basename(dir), description: meta.description ?? '' });
  }
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/** Markdown files (commands, agents) in the given files and folders. */
async function markdownIn(root: string, paths: string[]): Promise<NamedPart[]> {
  const found: NamedPart[] = [];
  for (const path of paths) {
    const files = path.endsWith('.md') ? [path] : (await listInside(root, path)).filter(name => name.endsWith('.md')).map(name => join(path, name));
    for (const file of files) {
      const body = await readInside(root, file);
      if (body === undefined) continue;
      const meta = frontMatter(body);
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
  const skillDirs = listed('skills') ?? (await listInside(root, join(folder, 'skills'))).map(name => join(folder, 'skills', name));
  const hooks = { ...(record((await jsonInside(root, join(folder, 'hooks/hooks.json')))?.hooks) ?? {}), ...(merged.hooks !== undefined ? await inlineOrFile(root, folder, merged.hooks, 'hooks') : {}) };
  const servers = { ...(record((await jsonInside(root, join(folder, '.mcp.json')))?.mcpServers) ?? {}), ...(merged.mcpServers !== undefined ? await inlineOrFile(root, folder, merged.mcpServers, 'mcpServers') : {}) };
  return {
    skills: await skillsIn(root, skillDirs),
    commands: await markdownIn(root, listed('commands') ?? [join(folder, 'commands')]),
    agents: await markdownIn(root, listed('agents') ?? [join(folder, 'agents')]),
    hooks: Object.keys(hooks).sort(),
    mcpServers: Object.entries(servers).map(([name, server]) => ({ name, runs: serverRuns(server) })).sort((first, second) => first.name.localeCompare(second.name)),
    mcpUsesPluginRoot: JSON.stringify(servers).includes('${CLAUDE_PLUGIN_ROOT}'),
    lspServers: Object.keys(record(merged.lspServers) ?? {}).sort(),
    bin: (await listInside(root, folder)).includes('bin'),
  };
}

/** Contents plus README. A plugin that is the marketplace's own root shares the marketplace's README, shown there once. */
export async function pluginDetail(folder: string, entry: Record<string, unknown>, root: string): Promise<PluginDetail> {
  const sharesRoot = resolve(folder) === resolve(root) && entry.source !== undefined;
  return { ...(await pluginContents(folder, entry, root)), readme: sharesRoot ? undefined : await readmeIn(folder, root) };
}

/** One plugin's own entry in a marketplace.json, as written. */
export async function entryIn(root: string, plugin: string): Promise<Record<string, unknown>> {
  const manifest = await jsonInside(root, join(root, '.claude-plugin/marketplace.json'));
  const entries = Array.isArray(manifest?.plugins) ? manifest.plugins as unknown[] : [];
  return entries.map(record).find(entry => entry?.name === plugin) ?? {};
}

/** Where a plugin outside the marketplace lives: a Git URL to read it from (https only), a folder in it and a branch. */
export function remoteOf(where: unknown): { url: string; path: string; ref?: string } | undefined {
  const entry = record(where);
  if (!entry) return undefined;
  const path = text(entry.path).replace(/^\.?\//, '');
  const ref = text(entry.ref) || undefined;
  if (entry.source === 'github' && /^[\w.-]+\/[\w.-]+$/.test(text(entry.repo))) return { url: `https://github.com/${text(entry.repo)}.git`, path, ref };
  if (['url', 'git-subdir', 'git'].includes(text(entry.source)) && /^https:\/\/\S+$/.test(text(entry.url))) return { url: text(entry.url), path, ref };
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
    const github = web.startsWith('https://github.com/');
    const label = `${github ? `GitHub · ${web.slice('https://github.com/'.length)}` : web.slice('https://'.length)}${remote.path ? `/${remote.path}` : ''}`;
    return { label, url: remote.path && github ? `${web}/tree/${remote.ref ?? 'HEAD'}/${remote.path}` : web };
  }
  if (kind === 'npm' && /^(@[\w.-]+\/)?[\w.-]+$/.test(text(entry.package))) return { label: `npm · ${text(entry.package)}`, url: `https://www.npmjs.com/package/${text(entry.package)}` };
  if (kind === 'pip' && text(entry.package)) return { label: `pip · ${text(entry.package)}` };
  if (kind === 'command' && text(entry.command)) return { label: `Found by running: ${text(entry.command)}` };
  if (text(entry.url)) return { label: text(entry.url) };
  return kind ? { label: kind } : undefined;
}

/** A web page for the marketplace itself, for GitHub sources. */
export function marketplacePage(source: string): string | undefined {
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) return `https://github.com/${source}`;
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(source);
  return match ? `https://github.com/${match[1]}` : undefined;
}
