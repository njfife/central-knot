// Marketplaces and plugins for the CLIs: read a catalog without running anything from it, show what each tool would get,
// and install or uninstall through each tool's own commands, confirmed by reading the record that tool keeps (PLG-03).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { harnesses } from './harnesses.ts';
import { inside, pluginContents, sourceOf } from './catalogdetail.ts';
import { componentsFrom } from './pluginoutcomes.ts';
export { outcomes } from './pluginoutcomes.ts';
import type { AccessResult, ActionReport, Catalog, CatalogPlugin, Components, HarnessId, InstallState, NativeRun } from './types.ts';
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
  /** Reads shared within one view, so each tool's records (and a live folder's catalog) are read once, not once per plugin. */
  reads?: Map<string, Promise<unknown>>;
}

/** A read done once per context when the context carries a cache. */
function once<T>(context: PluginContext, key: string, read: () => Promise<T>): Promise<T> {
  if (!context.reads) return read();
  if (!context.reads.has(key)) context.reads.set(key, read());
  return context.reads.get(key) as Promise<T>;
}

export const pluginTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

// ---------- Sources and access ----------

export const isFolder = (source: string) => isAbsolute(source) && !/^[a-z]+:\/\//i.test(source);

/** One spelling for one repository, so the same marketplace is recognised however it was typed (MKT-07). */
export function sameSource(first: string, second: string): boolean {
  const norm = (value: string) => {
    let text = value.trim();
    // A folder may be named through a link (macOS: /var is /private/var), and tools record whichever spelling they saw.
    if (isFolder(text)) { try { return realpathSync(text); } catch { return resolve(text); } }
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

/**
 * A fresh shallow copy of a Git repository, with hooks and submodules off, swapped into `target` only once complete.
 * Returns a problem to show (true: failed for no reason Git gave), or undefined when the copy is in place.
 */
async function shallowClone(context: PluginContext, url: string, target: string, ref?: string): Promise<string | true | undefined> {
  const stage = `${target}.${randomUUID()}`;
  await mkdir(dirname(target), { recursive: true });
  const cloned = await run('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--no-recurse-submodules', '--quiet', ...(ref ? ['--branch', ref] : []), '--', url, stage], { env: gitEnv(), timeoutMs: context.timeoutMs ?? 60_000 });
  if (cloned.code !== 0) {
    await rm(stage, { recursive: true, force: true });
    const failure = classify(cloned.code, cloned.output);
    return failure.state === 'ok' ? true : failure.message;
  }
  await rm(target, { recursive: true, force: true });
  await rename(stage, target);
  return undefined;
}

/** Where a plugin kept in another repository is copied to, by its URL, branch and commit. */
export const remoteCopyFolder = (context: PluginContext, remote: { url: string; ref?: string; sha?: string }) =>
  join(context.dataDir, 'remote', createHash('sha256').update(`${remote.url}\u0000${remote.ref ?? ''}\u0000${remote.sha ?? ''}`).digest('hex').slice(0, 24));
/** Copies being made right now, so two pages opened together share one clone instead of racing on the same folder. */
const copying = new Map<string, Promise<string | true | undefined>>();

/**
 * A plugin kept in its own repository, read so its page can show what it holds: a shallow copy kept with Central Knot's
 * other copies, made once and made again when its marketplace is refreshed (`fresh`). Only https Git URLs are read; a
 * pinned commit (`sha`) is checked out when the entry gives one. Nothing in it is run.
 */
export async function readRemotePlugin(context: PluginContext, remote: { url: string; path: string; ref?: string; sha?: string }, fresh = false): Promise<{ folder: string; root: string } | { problem: string }> {
  const root = remoteCopyFolder(context, remote);
  if (fresh || !(await stat(root).then(() => true, () => false))) {
    const pending = copying.get(root) ?? (async () => {
      const problem = await shallowClone(context, remote.url, root, remote.ref);
      if (problem || !remote.sha) return problem;
      const fetched = await run('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', 'fetch', '--depth', '1', '--quiet', 'origin', remote.sha], { env: gitEnv(), timeoutMs: context.timeoutMs ?? 60_000 });
      const checked = fetched.code === 0 ? await run('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { env: gitEnv(), timeoutMs: 30_000 }) : fetched;
      return checked.code === 0 ? undefined : `The commit it names (${remote.sha.slice(0, 12)}) could not be read.`;
    })().finally(() => copying.delete(root));
    copying.set(root, pending);
    const problem = await pending;
    if (problem) return { problem: problem === true ? 'Its repository could not be copied.' : problem };
  }
  const folder = resolve(root, remote.path || '.');
  return (await inside(root, folder)) ? { folder, root } : { problem: 'Its folder is outside its repository.' };
}

/** Reads a marketplace: a folder directly, a Git source through a fresh shallow clone with hooks off. Nothing in it is run. */
export async function readCatalog(context: PluginContext, source: string): Promise<Catalog> {
  const kind = isFolder(source) ? 'folder' : 'git';
  let root = source;
  if (kind === 'git') {
    const access = await checkAccess(source, context.timeoutMs);
    if (access.state !== 'ok') return { name: '', source, kind, fetchedAt: new Date().toISOString(), plugins: [], problem: access.message };
    const target = catalogFolder(context, source);
    const problem = await shallowClone(context, fetchUrl(source), target);
    if (problem) return { name: '', source, kind, fetchedAt: new Date().toISOString(), plugins: [], problem: problem === true ? 'The marketplace could not be copied.' : problem };
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
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SyntaxError('not an object');
    manifest = parsed as Record<string, unknown>;
  }
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
    const author = typeof item.author === 'string' ? item.author : stringOr((item.author as Record<string, unknown> | undefined)?.name);
    const words = [...(Array.isArray(item.keywords) ? item.keywords : []), ...(Array.isArray(item.tags) ? item.tags : [])].filter((word): word is string => typeof word === 'string');
    const plugin: CatalogPlugin = { name: item.name as string, description: stringOr(item.description), version: typeof item.version === 'string' ? item.version : undefined,
      displayName: stringOr(item.displayName) || undefined, category: stringOr(item.category) || undefined, author: author || undefined, homepage: /^https:\/\//.test(stringOr(item.homepage)) ? stringOr(item.homepage) : undefined,
      license: stringOr(item.license) || undefined, keywords: words.length ? [...new Set(words)] : undefined, from: sourceOf(item.source) };
    const where = item.source;
    if (typeof where === 'string') {
      const folder = resolve(root, pluginRoot && !where.startsWith('./') && !where.startsWith('../') ? join(pluginRoot, where) : where);
      // A path outside the marketplace, through a link or not, is not read.
      if (await inside(root, folder)) {
        plugin.folder = folder;
        plugin.components = await componentsOf(folder, item, root);
      }
    } else if (typeof where === 'object' && where !== null) {
      const kindOf = stringOr((where as Record<string, unknown>).source);
      const url = stringOr((where as Record<string, unknown>).url);
      if (['npm', 'pip', 'archive'].includes(kindOf)) plugin.copilotRefuses = `Copilot CLI refuses a marketplace with a ${kindOf} plugin source (“${plugin.name}”).`;
      else if (/^[\w.-]+@[\w.-]+:/.test(url)) plugin.copilotRefuses = `Copilot CLI refuses a marketplace with an SCP-style plugin URL (“${plugin.name}”).`;
    }
    plugins.push(plugin);
  }
  const owner = stringOr((manifest.owner as Record<string, unknown> | undefined)?.name);
  const about = stringOr(manifest.description) || stringOr((manifest.metadata as Record<string, unknown> | undefined)?.description);
  return { name, source, kind, fetchedAt, root, owner: owner || undefined, description: about || undefined, plugins: plugins.sort((first, second) => first.name.localeCompare(second.name)) };
}

/** The counts a row shows, from the same read the plugin page uses, so the two always agree. */
export async function componentsOf(folder: string, entry: Record<string, unknown>, root: string): Promise<Components> {
  return componentsFrom(await pluginContents(folder, entry, root));
}


// ---------- What each tool has ----------

const configRootOf = (context: PluginContext, tool: HarnessId) => context.overrides?.[tool] ?? join(context.home, harnesses[tool].defaultConfig);

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try { const value = JSON.parse((await readFile(path, 'utf8')).replace(/^\s*\/\/.*$/gm, '')); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined; } catch { return undefined; }
}
const recordJson = (context: PluginContext, path: string) => once(context, `json:${path}`, () => readJson(path));
const codexTables = (context: PluginContext, root: string) => once(context, `codex:${root}`, async () => { try { return readCodexTables(await readFile(join(root, 'config.toml'), 'utf8')); } catch { return undefined; } });

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
  if (tool === 'codex-cli') return (await codexTables(context, root))?.marketplaces[marketplace]?.source;
  const settings = await recordJson(context, join(root, 'settings.json'));
  const entry = (settings?.extraKnownMarketplaces as Record<string, { source?: { source?: string; url?: string; path?: string; repo?: string } }> | undefined)?.[marketplace]?.source;
  return entry ? entry.url ?? entry.path ?? entry.repo : undefined;
}

/** Installed only with files at the path the tool records; a record with no files is Not known yet (PLG-03). Never scans. */
export async function installState(context: PluginContext, tool: HarnessId, marketplace: string, plugin: string): Promise<InstallState> {
  const root = configRootOf(context, tool);
  const id = `${plugin}@${marketplace}`;
  if (tool === 'claude-cli') {
    const record = await recordJson(context, join(root, 'plugins/installed_plugins.json'));
    const entries = (record?.plugins as Record<string, { scope?: string; installPath?: string }[]> | undefined)?.[id];
    const user = entries?.find(entry => entry.scope === 'user') ?? entries?.[0];
    if (!user?.installPath) return { state: 'not-installed' };
    return (await hasFiles(user.installPath)) ? { state: 'installed', path: user.installPath } : { state: 'not-known', reason: 'Claude Code lists it, but its files are not where it records them.' };
  }
  if (tool === 'copilot-cli') {
    const config = await recordJson(context, join(root, 'config.json'));
    const entry = (config?.installedPlugins as { name?: string; marketplace?: string; cache_path?: string; enabled?: boolean }[] | undefined)?.find(item => item.name === plugin && item.marketplace === marketplace);
    if (entry?.cache_path) return (await hasFiles(entry.cache_path)) ? { state: 'installed', path: entry.cache_path } : { state: 'not-known', reason: 'Copilot CLI lists it, but its files are not where it records them.' };
    // A plugin from a local folder marketplace is loaded live from that folder: nothing is copied.
    const settings = await recordJson(context, join(root, 'settings.json'));
    const enabled = (settings?.enabledPlugins as Record<string, boolean> | undefined)?.[id] === true;
    const source = (settings?.extraKnownMarketplaces as Record<string, { source?: { source?: string; path?: string } }> | undefined)?.[marketplace]?.source;
    if (enabled && source?.source === 'directory' && source.path) {
      const catalog = await once(context, `catalog:${source.path}`, () => parseCatalog(source.path!, source.path!, 'folder'));
      const folder = catalog.plugins.find(item => item.name === plugin)?.folder;
      return folder && (await hasFiles(folder)) ? { state: 'installed', path: folder, live: true } : { state: 'not-known', reason: 'Copilot CLI has it turned on, but the folder it loads from is gone.' };
    }
    return { state: 'not-installed' };
  }
  const tables = await codexTables(context, root);
  if (!tables?.plugins[id]) return { state: 'not-installed' };
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
  // An app opened from Finder or a launcher gets a short PATH. A CLI that is a script (Codex runs on Node) finds its
  // interpreter beside itself, so the CLI's own folder goes first.
  const env: NodeJS.ProcessEnv = { ...gitEnv(), HOME: context.home, USERPROFILE: context.home, PATH: [dirname(binary), process.env.PATH].filter(Boolean).join(delimiter) };
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
  if (state.state === 'installed') return { tool, outcome: 'installed', changed: true, message: `${installed.ok ? 'Installed' : 'The command reported a problem, but it is installed'}${state.live ? ', loaded live from the marketplace folder (nothing copied)' : ''}. ${nextStepFor(tool)}`.trim(), runs };
  if (state.state === 'not-known') return { tool, outcome: 'not-known', message: state.reason, runs };
  return { tool, outcome: 'failed', message: `Not installed. ${lastLines(installed.output)}`.trim(), runs };
}

/** Uninstalls through the tool's own command and reads its record again. The marketplace stays added there. */
export async function uninstall(context: PluginContext, marketplace: string, plugin: string, tool: HarnessId, source?: string): Promise<ActionReport> {
  const name = harnesses[tool].name;
  const registered = source ? await registeredSource(context, tool, marketplace) : undefined;
  if (registered && source && !sameSource(registered, source)) return { tool, outcome: 'held', message: `${name}’s “${marketplace}” is a different marketplace (${registered}). Central Knot doesn’t change it.`, runs: [] };
  const before = await installState(context, tool, marketplace, plugin);
  if (before.state === 'not-installed') return { tool, outcome: 'uninstalled', message: `Not installed in ${name}.`, runs: [] };
  const id = `${plugin}@${marketplace}`;
  const args = tool === 'codex-cli' ? ['plugin', 'remove', id, '--json'] : ['plugin', 'uninstall', id];
  const removed = await native(context, tool, args);
  const state = await installState(context, tool, marketplace, plugin);
  if (state.state === 'not-installed') return { tool, outcome: 'uninstalled', changed: true, message: `Uninstalled from ${name}. The marketplace stays added there.${before.state === 'installed' && before.live ? ' Its folder is the marketplace’s own and stays.' : ''}`, runs: [removed] };
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
  'pi-cli': 'Start a new Pi session to use it.',
} as Record<HarnessId, string>)[tool];

