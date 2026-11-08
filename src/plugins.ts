// Marketplaces and plugins for the CLIs: read a catalog without running anything from it, show what each tool would get,
// and install or uninstall through each tool's own commands, confirmed by reading the record that tool keeps (PLG-03).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { harnesses } from './harnesses.ts';
import type { AccessResult, ActionReport, Catalog, CatalogPlugin, Components, HarnessId, InstallState, NativeRun, Outcome } from './types.ts';
export type { AccessResult, ActionReport, Catalog, CatalogPlugin, Components, InstallState, NativeRun, Outcome } from './types.ts';

// ---------- Shapes ----------

export interface PluginContext {
  home: string;
  /** Where this build keeps fetched catalogs and the prior bytes of native operations. */
  dataDir: string;
  /** The CLI to run for each tool, if one was found. An app's bundled CLI is never used here. */
  binaries: Partial<Record<HarnessId, string>>;
  overrides?: Partial<Record<HarnessId, string>>;
  timeoutMs?: number;
}

export const pluginTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

// ---------- Sources and access ----------

const isFolder = (source: string) => isAbsolute(source) && !/^[a-z]+:\/\//i.test(source);

/** One spelling for one repository, so the same marketplace is recognised however it was typed (MKT-07). */
export function sameSource(first: string, second: string): boolean {
  const norm = (value: string) => {
    let text = value.trim();
    if (isFolder(text)) return resolve(text);
    if (/^[\w.-]+\/[\w.-]+$/.test(text)) text = `https://github.com/${text}`;
    const scp = text.match(/^([\w.-]+)@([\w.-]+):(.+)$/);
    if (scp) text = `ssh://${scp[1]}@${scp[2]}/${scp[3]}`;
    try {
      const url = new URL(text);
      return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}/${url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').toLowerCase()}`;
    } catch { return text; }
  };
  return norm(first) === norm(second);
}

/** The URL CK itself fetches; native commands get the text exactly as the person typed it. */
const fetchUrl = (source: string) => (/^[\w.-]+\/[\w.-]+$/.test(source.trim()) ? `https://github.com/${source.trim()}.git` : source.trim());

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' });

function run(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number }): Promise<{ code: number | 'timeout' | 'missing'; output: string }> {
  return new Promise(done => {
    execFile(file, args, { env: options.env, cwd: options.cwd, timeout: options.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`.replace(/\r/g, '').trim();
      if (!error) { done({ code: 0, output }); return; }
      const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
      if (failure.code === 'ENOENT') done({ code: 'missing', output });
      else if (failure.killed) done({ code: 'timeout', output });
      else done({ code: typeof failure.code === 'number' ? failure.code : 1, output });
    });
  });
}

/** MKT-05: failure is otherwise silent, so a Git source is checked with prompts off and a timeout, and each failure gets its class. */
export async function checkAccess(source: string, timeoutMs = 20_000): Promise<AccessResult> {
  if (isFolder(source)) return { state: 'ok' };
  const result = await run('git', ['ls-remote', '--heads', fetchUrl(source)], { env: gitEnv(), timeoutMs });
  if (result.code === 0) return { state: 'ok' };
  return classify(result.code, result.output);
}

export function classify(code: number | 'timeout' | 'missing', output: string): AccessResult {
  const text = output.toLowerCase();
  if (code === 'missing') return { state: 'git-missing', message: 'Git is not installed, so this marketplace cannot be read.' };
  if (code === 'timeout' || /could not resolve host|timed out|connection refused|network is unreachable|no route to host|failed to connect/.test(text)) return { state: 'network', message: 'Can’t reach the marketplace. Check your connection; a company marketplace may need its network or VPN.' };
  if (/host key verification failed/.test(text)) return { state: 'unknown-host', message: 'This SSH host is not known on this computer yet. Connect to it once in a terminal (for example `ssh -T git@host`) and compare its fingerprint; Central Knot never changes known_hosts.' };
  if (/passphrase/.test(text)) return { state: 'passphrase', message: 'Your SSH key needs its passphrase. Add it to your SSH agent, then try again.' };
  if (/authentication failed|could not read username|terminal prompts disabled|403|401|permission denied \(publickey/.test(text)) return { state: 'sign-in', message: 'Sign-in needed. Use credentials that already work for Git on this computer, then try again.' };
  if (/repository not found|not found|404|does not appear to be a git repository|access denied/.test(text)) return { state: 'no-access', message: 'No access, or no repository there. Check the address and that your account can read it.' };
  return { state: 'unclassified', message: output.split('\n').slice(-3).join(' ').slice(0, 400) || 'Git failed without saying why.' };
}

// ---------- Catalog ----------

const catalogFolder = (context: PluginContext, source: string) => join(context.dataDir, 'catalogs', createHash('sha256').update(fetchUrl(source)).digest('hex').slice(0, 24));

/** Reads a marketplace: a folder directly, a Git source through a fresh shallow clone with hooks off. Nothing in it is run. */
export async function readCatalog(context: PluginContext, source: string): Promise<Catalog> {
  const kind = isFolder(source) ? 'folder' : 'git';
  let root = source;
  if (kind === 'git') {
    const access = await checkAccess(source, context.timeoutMs);
    if (access.state !== 'ok') return { name: '', source, kind, fetchedAt: new Date().toISOString(), plugins: [], problem: access.message };
    const target = catalogFolder(context, source);
    const stage = `${target}.${randomUUID()}`;
    await mkdir(dirname(target), { recursive: true });
    const cloned = await run('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--no-recurse-submodules', '--quiet', fetchUrl(source), stage], { env: gitEnv(), timeoutMs: context.timeoutMs ?? 60_000 });
    if (cloned.code !== 0) {
      await rm(stage, { recursive: true, force: true });
      const failure = classify(cloned.code, cloned.output);
      return { name: '', source, kind, fetchedAt: new Date().toISOString(), plugins: [], problem: failure.state === 'ok' ? 'The marketplace could not be copied.' : failure.message };
    }
    await rm(target, { recursive: true, force: true });
    await rename(stage, target);
    root = target;
  }
  return parseCatalog(root, source, kind);
}

/** The last fetched copy of a Git catalog, if any, so it stays browsable when the source can't be reached (MKT-04). */
export async function cachedCatalog(context: PluginContext, source: string): Promise<Catalog | undefined> {
  if (isFolder(source)) return undefined;
  const target = catalogFolder(context, source);
  try { await stat(join(target, '.claude-plugin/marketplace.json')); } catch { return undefined; }
  const catalog = await parseCatalog(target, source, 'git');
  catalog.fetchedAt = (await stat(join(target, '.claude-plugin/marketplace.json'))).mtime.toISOString();
  return catalog;
}

const stringOr = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

export async function parseCatalog(root: string, source: string, kind: Catalog['kind']): Promise<Catalog> {
  const fetchedAt = new Date().toISOString();
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8')); }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { name: '', source, kind, fetchedAt, plugins: [], problem: missing ? 'There is no marketplace here: no .claude-plugin/marketplace.json.' : 'Its marketplace.json could not be read as JSON.' };
  }
  const name = stringOr(manifest.name);
  if (!name) return { name: '', source, kind, fetchedAt, plugins: [], problem: 'Its marketplace.json has no name.' };
  const pluginRoot = stringOr((manifest.metadata as Record<string, unknown> | undefined)?.pluginRoot);
  const entries = Array.isArray(manifest.plugins) ? manifest.plugins : [];
  const plugins: CatalogPlugin[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || typeof (entry as Record<string, unknown>).name !== 'string') continue;
    const item = entry as Record<string, unknown>;
    const plugin: CatalogPlugin = { name: item.name as string, description: stringOr(item.description), version: typeof item.version === 'string' ? item.version : undefined };
    const where = item.source;
    if (typeof where === 'string') {
      const folder = resolve(root, pluginRoot && !where.startsWith('./') && !where.startsWith('../') ? join(pluginRoot, where) : where);
      // A path outside the marketplace is not read.
      if (!relative(root, folder).startsWith('..') && !isAbsolute(relative(root, folder))) {
        plugin.folder = folder;
        plugin.components = await componentsOf(folder);
      }
    } else if (typeof where === 'object' && where !== null) {
      const kindOf = stringOr((where as Record<string, unknown>).source);
      const url = stringOr((where as Record<string, unknown>).url);
      if (['npm', 'pip', 'archive'].includes(kindOf)) plugin.copilotRefuses = `Copilot CLI refuses a marketplace with a ${kindOf} plugin source (“${plugin.name}”).`;
      else if (/^[\w.-]+@[\w.-]+:/.test(url)) plugin.copilotRefuses = `Copilot CLI refuses a marketplace with an SCP-style plugin URL (“${plugin.name}”).`;
    }
    plugins.push(plugin);
  }
  return { name, source, kind, fetchedAt, plugins: plugins.sort((first, second) => first.name.localeCompare(second.name)) };
}

const count = async (folder: string, test: (name: string, isDirectory: boolean) => Promise<boolean> | boolean) => {
  try {
    let total = 0;
    for (const entry of await readdir(folder, { withFileTypes: true })) if (await test(entry.name, entry.isDirectory())) total++;
    return total;
  } catch { return 0; }
};
const exists = (path: string) => stat(path).then(() => true, () => false);

/** What a plugin folder holds, read from its files. Nothing in it is run. */
export async function componentsOf(folder: string): Promise<Components> {
  let manifest: Record<string, unknown> = {};
  try { manifest = JSON.parse(await readFile(join(folder, '.claude-plugin/plugin.json'), 'utf8')); } catch { /* optional */ }
  let servers: Record<string, unknown> = {};
  try { servers = (JSON.parse(await readFile(join(folder, '.mcp.json'), 'utf8')).mcpServers ?? {}) as Record<string, unknown>; } catch { /* optional */ }
  if (typeof manifest.mcpServers === 'object' && manifest.mcpServers !== null) servers = { ...servers, ...(manifest.mcpServers as Record<string, unknown>) };
  const serverText = JSON.stringify(servers);
  return {
    skills: await count(join(folder, 'skills'), (name, isDirectory) => isDirectory && exists(join(folder, 'skills', name, 'SKILL.md'))),
    commands: await count(join(folder, 'commands'), name => name.endsWith('.md')),
    agents: await count(join(folder, 'agents'), name => name.endsWith('.md')),
    hooks: (await exists(join(folder, 'hooks/hooks.json'))) || manifest.hooks !== undefined,
    mcp: Object.keys(servers).length,
    mcpRootVariable: serverText.includes('${CLAUDE_PLUGIN_ROOT}'),
    bin: await exists(join(folder, 'bin')),
  };
}

/** What each component does on each tool (capability data, Appendix D, tested versions). */
export function outcomes(tool: HarnessId, components: Components): Outcome[] {
  const list: Outcome[] = [];
  const add = (present: boolean | number, component: string, result: Outcome['result'], text: string) => { if (present) list.push({ component, result, text }); };
  if (tool === 'claude-cli') {
    add(components.skills, 'Skills', 'works', 'Work');
    add(components.commands, 'Commands', 'works', 'Work');
    add(components.agents, 'Agents', 'works', 'Work');
    add(components.hooks, 'Hooks', 'works', 'Work; a hook failure is not an install error');
    add(components.mcp, 'MCP servers', 'works', 'Work');
  } else if (tool === 'copilot-cli') {
    add(components.skills, 'Skills', 'works', 'Work');
    add(components.commands, 'Commands', 'limited', 'Work as skills');
    add(components.agents, 'Agents', 'works', 'Work, as plugin:agent');
    add(components.hooks, 'Hooks', 'limited', 'SessionStart works; others untested');
    add(components.mcp, 'MCP servers', 'works', 'Work');
  } else {
    add(components.skills, 'Skills', 'works', 'Work, as plugin:skill');
    add(components.commands, 'Commands', 'limited', 'Converted to skills at install');
    add(components.agents, 'Agents', 'ignored', 'Ignored: copied, never offered');
    add(components.hooks, 'Hooks', 'limited', 'SessionStart after you review it in Codex; others untested');
    add(components.mcp, 'MCP servers', components.mcpRootVariable ? 'fails' : 'unknown', components.mcpRootVariable ? 'Won’t start: Codex does not expand ${CLAUDE_PLUGIN_ROOT}' : 'Untested');
  }
  if (components.bin) list.push({ component: 'Top-level bin/', result: tool === 'claude-cli' ? 'works' : 'unknown', text: tool === 'claude-cli' ? 'Documented' : 'Untested' });
  return list;
}

// ---------- What each tool has ----------

const configRootOf = (context: PluginContext, tool: HarnessId) => context.overrides?.[tool] ?? join(context.home, harnesses[tool].defaultConfig);

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\s*\/\/.*$/gm, '')); } catch { return undefined; }
}

/** Only the two kinds of table Central Knot reads from Codex's config.toml: `[marketplaces.NAME]` and `[plugins."ID"]`. Never written. */
export function readCodexTables(text: string): { marketplaces: Record<string, Record<string, string>>; plugins: Record<string, Record<string, string>> } {
  const marketplaces: Record<string, Record<string, string>> = Object.create(null);
  const plugins: Record<string, Record<string, string>> = Object.create(null);
  let current: Record<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[\s*(marketplaces|plugins)\.(?:"((?:[^"\\]|\\.)*)"|([\w.-]+))\s*\]$/);
    if (header) { const table = header[1] === 'marketplaces' ? marketplaces : plugins; current = table[header[2] ?? header[3]] ??= Object.create(null); continue; }
    if (line.startsWith('[')) { current = undefined; continue; }
    const pair = current && line.match(/^([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^#]*?))\s*(?:#.*)?$/);
    if (pair && current) current[pair[1]] = pair[2] ?? (pair[3] ?? '').trim();
  }
  return { marketplaces, plugins };
}

const hasFiles = async (path: string) => { try { return (await readdir(path)).length > 0; } catch { return false; } };

/** The marketplace a tool has under a name, as the source it was added from. */
export async function registeredSource(context: PluginContext, tool: HarnessId, marketplace: string): Promise<string | undefined> {
  const root = configRootOf(context, tool);
  if (tool === 'codex-cli') {
    try { return readCodexTables(await readFile(join(root, 'config.toml'), 'utf8')).marketplaces[marketplace]?.source; } catch { return undefined; }
  }
  const settings = await readJson(join(root, 'settings.json'));
  const entry = (settings?.extraKnownMarketplaces as Record<string, { source?: { source?: string; url?: string; path?: string; repo?: string } }> | undefined)?.[marketplace]?.source;
  return entry ? entry.url ?? entry.path ?? entry.repo : undefined;
}

/** Installed only with files at the path the tool records; a record with no files is Not known yet (PLG-03). Never scans. */
export async function installState(context: PluginContext, tool: HarnessId, marketplace: string, plugin: string): Promise<InstallState> {
  const root = configRootOf(context, tool);
  const id = `${plugin}@${marketplace}`;
  if (tool === 'claude-cli') {
    const record = await readJson(join(root, 'plugins/installed_plugins.json'));
    const entries = (record?.plugins as Record<string, { scope?: string; installPath?: string }[]> | undefined)?.[id];
    const user = entries?.find(entry => entry.scope === 'user') ?? entries?.[0];
    if (!user?.installPath) return { state: 'not-installed' };
    return (await hasFiles(user.installPath)) ? { state: 'installed', path: user.installPath } : { state: 'not-known', reason: 'Claude Code lists it, but its files are not where it records them.' };
  }
  if (tool === 'copilot-cli') {
    const config = await readJson(join(root, 'config.json'));
    const entry = (config?.installedPlugins as { name?: string; marketplace?: string; cache_path?: string; enabled?: boolean }[] | undefined)?.find(item => item.name === plugin && item.marketplace === marketplace);
    if (entry?.cache_path) return (await hasFiles(entry.cache_path)) ? { state: 'installed', path: entry.cache_path } : { state: 'not-known', reason: 'Copilot CLI lists it, but its files are not where it records them.' };
    // A plugin from a local folder marketplace is loaded live from that folder: nothing is copied.
    const settings = await readJson(join(root, 'settings.json'));
    const enabled = (settings?.enabledPlugins as Record<string, boolean> | undefined)?.[id] === true;
    const source = (settings?.extraKnownMarketplaces as Record<string, { source?: { source?: string; path?: string } }> | undefined)?.[marketplace]?.source;
    if (enabled && source?.source === 'directory' && source.path) {
      const catalog = await parseCatalog(source.path, source.path, 'folder');
      const folder = catalog.plugins.find(item => item.name === plugin)?.folder;
      return folder && (await hasFiles(folder)) ? { state: 'installed', path: folder, live: true } : { state: 'not-known', reason: 'Copilot CLI has it turned on, but the folder it loads from is gone.' };
    }
    return { state: 'not-installed' };
  }
  let tables;
  try { tables = readCodexTables(await readFile(join(root, 'config.toml'), 'utf8')); } catch { return { state: 'not-installed' }; }
  if (!tables.plugins[id]) return { state: 'not-installed' };
  const cache = join(root, 'plugins/cache', marketplace, plugin);
  const versions = await readdir(cache).catch(() => [] as string[]);
  for (const version of versions) if (await hasFiles(join(cache, version))) return { state: 'installed', path: join(cache, version) };
  return { state: 'not-known', reason: 'Codex lists it, but its files are not in its plugin cache.' };
}

// ---------- Install and uninstall ----------

/** Files a tool's plugin commands may change; their bytes are kept before and after each run (FIL-03). */
const touched = (context: PluginContext, tool: HarnessId) => {
  const root = configRootOf(context, tool);
  if (tool === 'claude-cli') return [join(root, 'settings.json'), join(root, 'plugins/installed_plugins.json'), join(root, 'plugins/known_marketplaces.json')];
  if (tool === 'copilot-cli') return [join(root, 'settings.json'), join(root, 'config.json')];
  return [join(root, 'config.toml')];
};

const readOrNull = (path: string) => readFile(path, 'utf8').catch(() => null);

/** Runs one native command for a tool against the chosen home, keeping the prior bytes of every file it may change. */
async function native(context: PluginContext, tool: HarnessId, args: string[]): Promise<NativeRun> {
  const binary = context.binaries[tool];
  const command = `${harnesses[tool].binary} ${args.join(' ')}`;
  if (!binary) return { tool, command, ok: false, output: `${harnesses[tool].name} CLI was not found, so its own plugin commands can’t run.`, changed: [] };
  const files = touched(context, tool);
  const before = await Promise.all(files.map(readOrNull));
  const env: NodeJS.ProcessEnv = { ...gitEnv(), HOME: context.home, USERPROFILE: context.home };
  const override = context.overrides?.[tool];
  if (override) env[harnesses[tool].configEnv] = override;
  else delete env[harnesses[tool].configEnv];
  const result = await run(binary, args, { env, cwd: context.home, timeoutMs: context.timeoutMs ?? 180_000 });
  const after = await Promise.all(files.map(readOrNull));
  const changed = files.map((path, index) => ({ path, before: before[index], after: after[index] })).filter(entry => entry.before !== entry.after);
  if (changed.length) {
    const folder = join(context.dataDir, 'native', `${new Date().toISOString().replace(/[:.]/g, '-')}-${tool}-${randomUUID().slice(0, 8)}`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'command.txt'), `${command}\n\n${result.output}\n`);
    for (const [index, entry] of changed.entries()) {
      if (entry.before !== null) await writeFile(join(folder, `${index}-before-${basename(entry.path)}`), entry.before);
      if (entry.after !== null) await writeFile(join(folder, `${index}-after-${basename(entry.path)}`), entry.after);
    }
  }
  const output = result.code === 'timeout' ? `${command} did not finish in time and was stopped. ${result.output}`.trim() : result.code === 'missing' ? `${binary} could not be run.` : result.output || (result.code === 0 ? '' : `It stopped with exit code ${result.code} and said nothing.`);
  return { tool, command, ok: result.code === 0, output, changed };
}

/** Installs one plugin into one tool: adds the marketplace there if needed (never replacing a different one of the same name), installs, then reads the tool's record. */
export async function install(context: PluginContext, catalog: Catalog, plugin: string, tool: HarnessId): Promise<ActionReport> {
  const runs: NativeRun[] = [];
  const name = harnesses[tool].name;
  if (tool === 'copilot-cli') {
    const refusal = catalog.plugins.find(item => item.copilotRefuses)?.copilotRefuses;
    if (refusal) return { tool, outcome: 'held', message: `${refusal} Nothing was added to Copilot CLI.`, runs };
  }
  const already = await installState(context, tool, catalog.name, plugin);
  if (already.state === 'installed') return { tool, outcome: 'installed', message: `Already installed in ${name}.`, runs };
  const registered = await registeredSource(context, tool, catalog.name);
  if (registered && !sameSource(registered, catalog.source)) return { tool, outcome: 'held', message: `${name} already has a different marketplace named “${catalog.name}” (${registered}). Central Knot doesn’t replace it.`, runs };
  if (tool === 'codex-cli') await mkdir(configRootOf(context, tool), { recursive: true });
  if (!registered) {
    const add = await native(context, tool, ['plugin', 'marketplace', 'add', catalog.source]);
    runs.push(add);
    if (!add.ok) return { tool, outcome: 'failed', message: `Could not add the marketplace. ${lastLines(add.output)}`.trim(), runs };
  }
  const id = `${plugin}@${catalog.name}`;
  const args = tool === 'claude-cli' ? ['plugin', 'install', id, '--scope', 'user'] : tool === 'copilot-cli' ? ['plugin', 'install', id] : ['plugin', 'add', id, '--json'];
  const installed = await native(context, tool, args);
  runs.push(installed);
  const state = await installState(context, tool, catalog.name, plugin);
  if (state.state === 'installed') return { tool, outcome: 'installed', message: `${installed.ok ? 'Installed' : 'The command reported a problem, but it is installed'}${state.live ? ', loaded live from the marketplace folder (nothing copied)' : ''}. ${nextStepFor(tool)}`.trim(), runs };
  if (state.state === 'not-known') return { tool, outcome: 'not-known', message: state.reason, runs };
  return { tool, outcome: 'failed', message: `Not installed. ${lastLines(installed.output)}`.trim(), runs };
}

/** Uninstalls through the tool's own command and reads its record again. The marketplace stays added there. */
export async function uninstall(context: PluginContext, marketplace: string, plugin: string, tool: HarnessId): Promise<ActionReport> {
  const name = harnesses[tool].name;
  const before = await installState(context, tool, marketplace, plugin);
  if (before.state === 'not-installed') return { tool, outcome: 'uninstalled', message: `Not installed in ${name}.`, runs: [] };
  const id = `${plugin}@${marketplace}`;
  const args = tool === 'codex-cli' ? ['plugin', 'remove', id, '--json'] : ['plugin', 'uninstall', id];
  const removed = await native(context, tool, args);
  const state = await installState(context, tool, marketplace, plugin);
  if (state.state === 'not-installed') return { tool, outcome: 'uninstalled', message: `Uninstalled from ${name}. The marketplace stays added there.${before.state === 'installed' && before.live ? ' Its folder is the marketplace’s own and stays.' : ''}`, runs: [removed] };
  return { tool, outcome: 'failed', message: `Still installed. ${lastLines(removed.output)}`.trim(), runs: [removed] };
}

/** The marketplaces a tool already has, as added there: no setup needed to browse them. */
export async function registeredMarketplaces(context: PluginContext, tool: HarnessId): Promise<{ name: string; source: string }[]> {
  const root = configRootOf(context, tool);
  if (tool === 'codex-cli') {
    try {
      const tables = readCodexTables(await readFile(join(root, 'config.toml'), 'utf8'));
      return Object.entries(tables.marketplaces).filter(([, entry]) => entry.source).map(([name, entry]) => ({ name, source: entry.source! }));
    } catch { return []; }
  }
  const settings = await readJson(join(root, 'settings.json'));
  const entries = (settings?.extraKnownMarketplaces ?? {}) as Record<string, { source?: { url?: string; path?: string; repo?: string } }>;
  return Object.entries(entries).map(([name, entry]) => ({ name, source: entry.source?.url ?? entry.source?.path ?? entry.source?.repo ?? '' })).filter(entry => entry.source);
}

/** The end of a tool's own message, shown as it is. */
const lastLines = (output: string) => output.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 400);

const nextStepFor = (tool: HarnessId) => ({
  'claude-cli': 'Start a new Claude Code session, or run /reload-plugins, to use it.',
  'copilot-cli': 'Start a new Copilot CLI session to use it.',
  'codex-cli': 'Start a new Codex session to use it; restart the ChatGPT desktop app if it is open.',
})[tool];

