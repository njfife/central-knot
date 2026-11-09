// What a marketplace says about itself and about each plugin, read from its own files: READMEs, where each plugin comes
// from, and what each plugin holds. Read only; nothing here runs a plugin, a hook or a server.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

export interface NamedPart { name: string; description: string }
export interface PluginDetail {
  readme?: string;
  skills: NamedPart[];
  commands: NamedPart[];
  agents: NamedPart[];
  /** Hook events it listens to, such as PreToolUse. */
  hooks: string[];
  /** Each MCP server with what it runs or connects to. */
  mcpServers: { name: string; runs: string }[];
  lspServers: string[];
}
/** Component paths a marketplace entry names itself (`"strict": false` entries list them instead of using default folders). */
export interface ListedPaths { skills?: string[]; commands?: string[]; agents?: string[] }

const README_LIMIT = 60_000;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isDir = (path: string) => stat(path).then(entry => entry.isDirectory(), () => false);
const isFile = (path: string) => stat(path).then(entry => entry.isFile(), () => false);
const json = (path: string) => readFile(path, 'utf8').then(raw => JSON.parse(raw) as Record<string, unknown>, () => undefined);
const list = (value: unknown) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);

/** A README in this folder, cut to a readable size. */
export async function readmeIn(folder: string): Promise<string | undefined> {
  let names: string[] = [];
  try { names = await readdir(folder); } catch { return undefined; }
  const name = names.find(entry => /^readme(\.md|\.markdown|\.txt)?$/i.test(entry));
  if (!name) return undefined;
  const body = await readFile(join(folder, name), 'utf8').catch(() => undefined);
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
    if (first === '>' || first === '|' || first === '>-' || first === '|-') {
      const rest: string[] = [];
      for (const line of lines.slice(at + 1)) { if (!/^\s+\S/.test(line)) break; rest.push(line.trim()); }
      return rest.join(first.startsWith('|') ? '\n' : ' ');
    }
    return first.replace(/^(["'])([\s\S]*)\1$/, '$2');
  };
  return { name: value('name'), description: value('description') };
}

/** Paths a marketplace entry lists for its components, resolved inside the plugin folder; anything pointing outside is dropped. */
export function listedPaths(entry: Record<string, unknown>, folder: string): ListedPaths {
  const inside = (paths: string[] | undefined) => paths?.map(path => resolve(folder, path)).filter(path => !relative(folder, path).startsWith('..'));
  return { skills: inside(list(entry.skills)), commands: inside(list(entry.commands)), agents: inside(list(entry.agents)) };
}

async function skillsIn(folder: string, listed?: string[]): Promise<NamedPart[]> {
  const dirs = listed ?? (await readdir(join(folder, 'skills')).catch(() => [] as string[])).map(name => join(folder, 'skills', name));
  const found: NamedPart[] = [];
  for (const dir of dirs) {
    const body = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => undefined);
    if (body === undefined) continue;
    const meta = frontMatter(body);
    found.push({ name: meta.name || basename(dir), description: meta.description ?? '' });
  }
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/** Markdown files in a folder (commands, agents), or the files and folders a marketplace entry lists. */
async function markdownIn(defaultFolder: string, listed?: string[]): Promise<NamedPart[]> {
  const files: string[] = [];
  for (const path of listed ?? [defaultFolder]) {
    if (await isDir(path)) files.push(...(await readdir(path).catch(() => [] as string[])).filter(name => name.endsWith('.md')).map(name => join(path, name)));
    else if (path.endsWith('.md') && await isFile(path)) files.push(path);
  }
  const found: NamedPart[] = [];
  for (const file of files) {
    const meta = frontMatter(await readFile(file, 'utf8').catch(() => ''));
    found.push({ name: meta.name || basename(file, '.md'), description: meta.description ?? '' });
  }
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/** What MCP server runs: its command and arguments, or the URL it connects to. */
const serverRuns = (server: unknown): string => {
  if (typeof server !== 'object' || server === null) return '';
  const entry = server as Record<string, unknown>;
  if (text(entry.url)) return text(entry.url);
  return [text(entry.command), ...(list(entry.args) ?? [])].filter(Boolean).join(' ');
};

/** Everything one plugin holds, by name, plus its README. The marketplace entry may list its own component paths. */
export async function pluginDetail(folder: string, entry: Record<string, unknown> = {}, marketRoot?: string): Promise<PluginDetail> {
  const manifest = (await json(join(folder, '.claude-plugin/plugin.json'))) ?? {};
  const listed = listedPaths({ ...manifest, ...entry }, folder);
  const servers = { ...(((await json(join(folder, '.mcp.json')))?.mcpServers ?? {}) as Record<string, unknown>), ...(typeof manifest.mcpServers === 'object' && manifest.mcpServers ? manifest.mcpServers as Record<string, unknown> : {}) };
  const hookFile = (await json(join(folder, 'hooks/hooks.json')))?.hooks;
  const hookObject = typeof manifest.hooks === 'object' && manifest.hooks ? (manifest.hooks as Record<string, unknown>).hooks ?? manifest.hooks : undefined;
  const lsp = (typeof entry.lspServers === 'object' && entry.lspServers) || (typeof manifest.lspServers === 'object' && manifest.lspServers) || {};
  return {
    // A plugin that is the marketplace's own root shares its README; it is shown once, for the marketplace.
    readme: marketRoot && resolve(folder) === resolve(marketRoot) ? undefined : await readmeIn(folder),
    skills: await skillsIn(folder, listed.skills),
    commands: await markdownIn(join(folder, 'commands'), listed.commands),
    agents: await markdownIn(join(folder, 'agents'), listed.agents),
    hooks: Object.keys(typeof hookFile === 'object' && hookFile ? hookFile : typeof hookObject === 'object' && hookObject ? hookObject : {}).sort(),
    mcpServers: Object.entries(servers).map(([name, server]) => ({ name, runs: serverRuns(server) })).sort((first, second) => first.name.localeCompare(second.name)),
    lspServers: Object.keys(lsp).sort(),
  };
}

/** One plugin's own entry in a marketplace.json, as written. */
export async function entryIn(root: string, plugin: string): Promise<Record<string, unknown>> {
  const manifest = await json(join(root, '.claude-plugin/marketplace.json'));
  const entries = Array.isArray(manifest?.plugins) ? manifest.plugins as unknown[] : [];
  return (entries.find(entry => typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).name === plugin) as Record<string, unknown> | undefined) ?? {};
}

/** Where a plugin outside the marketplace comes from, in words, with a web link when there is a safe one. */
export function sourceOf(where: unknown): { label: string; url?: string } | undefined {
  if (typeof where !== 'object' || where === null) return undefined;
  const entry = where as Record<string, unknown>;
  const kind = text(entry.source);
  const path = text(entry.path).replace(/^\.?\//, '');
  if (kind === 'github' && /^[\w.-]+\/[\w.-]+$/.test(text(entry.repo))) {
    const repo = text(entry.repo);
    return { label: `GitHub · ${repo}${path ? `/${path}` : ''}`, url: `https://github.com/${repo}${path ? `/tree/${text(entry.ref) || 'HEAD'}/${path}` : ''}` };
  }
  if ((kind === 'url' || kind === 'git-subdir' || kind === 'git') && text(entry.url)) {
    const url = text(entry.url).replace(/\.git$/, '');
    const web = /^https:\/\//.test(url) ? (path && /^https:\/\/github\.com\//.test(url) ? `${url}/tree/${text(entry.ref) || 'HEAD'}/${path}` : url) : undefined;
    return { label: `${url.replace(/^https:\/\//, '')}${path ? `/${path}` : ''}`, url: web };
  }
  if (kind === 'npm' && text(entry.package)) return { label: `npm · ${text(entry.package)}`, url: `https://www.npmjs.com/package/${text(entry.package)}` };
  if (kind === 'pip' && text(entry.package)) return { label: `pip · ${text(entry.package)}` };
  if (kind === 'command' && text(entry.command)) return { label: `Found by running: ${text(entry.command)}` };
  return kind ? { label: kind } : undefined;
}

/** A web page for the marketplace itself, for GitHub sources. */
export function marketplacePage(source: string): string | undefined {
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) return `https://github.com/${source}`;
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(source);
  return match ? `https://github.com/${match[1]}` : undefined;
}
