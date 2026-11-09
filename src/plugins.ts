// Marketplaces and plugins for the CLIs: read a catalog without running anything from it, show what each tool would get,
// and install or uninstall through each tool's own commands, confirmed by reading the record that tool keeps (PLG-03).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { configRoot, harnesses } from './harnesses.ts';
import { MANIFEST, inside, parseObject, pluginContents, readManifest, remoteOf, skillName, skillNamesIn, sourceOf } from './catalogdetail.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { editTomlArray, readTomlTables, type TomlValue } from './textedit.ts';
import { heldReason, noCli, offByBareName, skillSwitchBlock } from './pluginstatus.ts';
import { errorCode, writeFileChecked } from './share.ts';
import { SAFE_NAME, compareVersions, githubRepo, isFolder, isHttps, record, strings, text, withoutBom } from './values.ts';
import { toolNames } from './words.ts';
import type { ActionReport, Catalog, CatalogPlugin, Components, HarnessId, InstallState, NativeRun, SkillOff } from './types.ts';

// ---------- Shapes ----------

export interface PluginContext {
  home: string;
  /** Where this build keeps fetched catalogs and the prior bytes of native operations. */
  dataDir: string;
  /** The CLI to run for each tool, if one was found. An app's bundled CLI is never used here. */
  binaries: Partial<Record<HarnessId, string>>;
  overrides?: Partial<Record<HarnessId, string>>;
  timeoutMs?: number;
  /** Reads shared within one read-only view (each tool's records and a live folder's catalog read once). Never set for an install or uninstall, which read again after their command. */
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

/** Git hosts whose repository paths ignore case (github.com/Owner/Repo is github.com/owner/repo). */
const CASELESS_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

/** One spelling for one repository, so the same marketplace is recognised however it was typed (MKT-07). */
export function sameSource(first: string, second: string): boolean {
  const norm = (value: string) => {
    let text = value.trim();
    // A folder may be named through a link (macOS: /var is /private/var), and tools record whichever spelling they saw.
    if (isFolder(text)) { try { return realpathSync(text); } catch { return resolve(text); } }
    const repo = githubRepo(text);
    if (repo) return `github.com/${repo.toLowerCase()}`;
    const scp = text.match(/^([\w.-]+)@([\w.-]+):(.+)$/);
    if (scp) text = `ssh://${scp[1]}@${scp[2]}/${scp[3]}`;
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
      // Only hosts known to ignore case in repository paths fold it; on any other server /Team/tools and /team/tools may be two repositories.
      return `${host}${url.port ? `:${url.port}` : ''}/${CASELESS_HOSTS.has(host) ? path.toLowerCase() : path}`;
    } catch { return text; }
  };
  return norm(first) === norm(second);
}

/** The URL CK itself fetches; native commands get the text exactly as the person typed it. */
const fetchUrl = (source: string) => { const repo = githubRepo(source); return repo ? `https://github.com/${repo}.git` : source.trim(); };

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' });

function run(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number }): Promise<{ code: number | 'timeout' | 'missing'; output: string }> {
  return new Promise(done => {
    execFile(file, args, { env: options.env, cwd: options.cwd, timeout: options.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`.replace(/\r/g, '').trim();
      if (!error) { done({ code: 0, output }); return; }
      const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
      if (failure.code === 'ENOENT') done({ code: 'missing', output });
      // Node stops a command whose output passes maxBuffer; it ran, it just said too much.
      else if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') done({ code: 1, output: `${output.slice(-2000)}\n(output cut: more than 4 MB)` });
      else if (failure.killed) done({ code: 'timeout', output });
      else done({ code: typeof failure.code === 'number' ? failure.code : 1, output });
    });
  });
}

/** Why a Git command failed, in words a person can act on (MKT-05). */
export function whyGitFailed(code: number | 'timeout' | 'missing', output: string): string {
  const text = output.toLowerCase();
  if (code === 'missing') return 'Git is not installed, so this marketplace cannot be read.';
  if (code === 'timeout' || /could not resolve host|timed out|connection refused|network is unreachable|no route to host|failed to connect/.test(text)) return 'Can’t reach the marketplace. Check your connection; a company marketplace may need its network or VPN.';
  if (/host key verification failed/.test(text)) return 'This SSH host is not known on this computer yet. Connect to it once in a terminal (for example `ssh -T git@host`) and compare its fingerprint; Central Knot never changes known_hosts.';
  if (/passphrase/.test(text)) return 'Your SSH key needs its passphrase. Add it to your SSH agent, then try again.';
  if (/authentication failed|could not read username|terminal prompts disabled|403|401|permission denied \(publickey/.test(text)) return 'Sign-in needed. Use credentials that already work for Git on this computer, then try again.';
  if (/repository not found|not found|404|does not appear to be a git repository|access denied/.test(text)) return 'No access, or no repository there. Check the address and that your account can read it.';
  return output.split('\n').slice(-3).join(' ').slice(0, 400) || 'Git failed without saying why.';
}

// ---------- Catalog ----------

/** Where Central Knot keeps its copy of a Git marketplace, by its URL. */
export const catalogFolder = (context: PluginContext, source: string) => join(context.dataDir, 'catalogs', createHash('sha256').update(fetchUrl(source)).digest('hex').slice(0, 24));

/** Leftover stage folders of `target` (a clone stopped when the app quit), removed before a new clone of it. */
async function dropStages(target: string): Promise<void> {
  const stagePrefix = `${basename(target)}.`;
  const siblings = await readdir(dirname(target)).catch(() => [] as string[]);
  await Promise.all(siblings.filter(name => name.startsWith(stagePrefix)).map(name => rm(join(dirname(target), name), { recursive: true, force: true })));
}

/** Copies being made right now, by target folder: two reads of one repository at once share one clone instead of racing on its folder. */
const copying = new Map<string, Promise<string | undefined>>();

/**
 * A fresh shallow copy of a Git repository, with hooks, submodules and prompts off, swapped into `target` only once
 * complete. Returns a problem to show (why Git failed, in words a person can act on: MKT-05), or undefined when the copy
 * is in place. A copy of the same target already being made is shared, not started again.
 */
function shallowClone(context: PluginContext, url: string, target: string, want: CloneWant = {}): Promise<string | undefined> {
  const pending = copying.get(target) ?? cloneInto(context, url, target, want).finally(() => copying.delete(target));
  copying.set(target, pending);
  return pending;
}

/**
 * What a copy must be: on a branch or tag (`ref`), at a pinned commit (`sha`), and passing `check` (given the new copy's
 * folder, it returns a problem or undefined). A copy that fails any of them never replaces the one already there.
 */
interface CloneWant { ref?: string; sha?: string; check?: (folder: string) => Promise<string | undefined> }

async function cloneInto(context: PluginContext, url: string, target: string, { ref, sha, check }: CloneWant): Promise<string | undefined> {
  const stage = `${target}.${randomUUID()}`;
  await mkdir(dirname(target), { recursive: true });
  await dropStages(target);
  const git = (args: string[]) => run('git', ['-c', 'core.hooksPath=/dev/null', ...args], { env: gitEnv(), timeoutMs: context.timeoutMs ?? 60_000 });
  const cloned = await git(['clone', '--depth', '1', '--no-recurse-submodules', '--quiet', ...(ref ? ['--branch', ref] : []), '--', url, stage]);
  if (cloned.code !== 0) {
    await rm(stage, { recursive: true, force: true });
    return whyGitFailed(cloned.code, cloned.output);
  }
  // A pinned commit is checked out in the stage too: the copy takes its place only when it is exactly what was asked for.
  if (sha) {
    const fetched = await git(['-C', stage, 'fetch', '--depth', '1', '--quiet', 'origin', sha]);
    const checked = fetched.code === 0 ? await git(['-C', stage, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']) : fetched;
    if (checked.code !== 0) { await rm(stage, { recursive: true, force: true }); return `The commit it names (${sha.slice(0, 12)}) could not be read.`; }
  }
  const refused = check ? await check(stage) : undefined;
  if (refused) { await rm(stage, { recursive: true, force: true }); return refused; }
  await rm(target, { recursive: true, force: true });
  await rename(stage, target);
  return undefined;
}

/** Where a plugin kept in another repository is copied to, by its URL, branch and commit. */
export const remoteCopyFolder = (context: PluginContext, remote: { url: string; ref?: string; sha?: string }) =>
  join(context.dataDir, 'remote', createHash('sha256').update(`${remote.url}\u0000${remote.ref ?? ''}\u0000${remote.sha ?? ''}`).digest('hex').slice(0, 24));

/**
 * A plugin kept in its own repository, read so its page can show what it holds: a shallow copy kept with Central Knot's
 * other copies, made once and made again after its marketplace is refreshed (the copy is dropped then). Only https Git
 * URLs reach here; a pinned commit (`sha`) is checked out before the copy is used. Nothing in it is run.
 */
export async function readRemotePlugin(context: PluginContext, remote: { url: string; path: string; ref?: string; sha?: string }): Promise<{ folder: string; root: string } | { problem: string }> {
  const root = remoteCopyFolder(context, remote);
  if (!(await stat(root).then(() => true, () => false))) {
    const problem = await shallowClone(context, remote.url, root, { ref: remote.ref, sha: remote.sha });
    if (problem) return { problem };
  }
  const folder = resolve(root, remote.path || '.');
  return (await inside(root, folder)) ? { folder, root } : { problem: 'Its folder is outside its repository.' };
}

/** Reads a marketplace: a folder directly, a Git source through a fresh shallow clone with hooks off. Nothing in it is run. */
export async function readCatalog(context: PluginContext, source: string): Promise<Catalog> {
  const kind = isFolder(source) ? 'folder' : 'git';
  let root = source;
  if (kind === 'git') {
    const target = catalogFolder(context, source);
    // A fetched copy that isn't a readable marketplace never replaces the last good one, which stays browsable.
    const problem = await shallowClone(context, fetchUrl(source), target, { check: async folder => (await parseCatalog(folder, source, kind, { counts: false })).problem });
    if (problem) return { name: '', source, kind, fetchedAt: new Date().toISOString(), plugins: [], problem };
    root = target;
  }
  return parseCatalog(root, source, kind);
}

/** The last fetched copy of a Git catalog, if any, so it stays browsable when the source can't be reached (MKT-04). */
export async function cachedCatalog(context: PluginContext, source: string): Promise<Catalog | undefined> {
  if (isFolder(source)) return undefined;
  const target = catalogFolder(context, source);
  const fetched = await stat(join(target, MANIFEST)).catch(() => undefined);
  if (!fetched) return undefined;
  return { ...(await parseCatalog(target, source, 'git')), fetchedAt: fetched.mtime.toISOString() };
}

/** Why Copilot CLI would refuse a whole marketplace because of this one entry's source (MKT-06), if it would. */
function copilotRefusal(name: string, where: unknown): string | undefined {
  const source = record(where);
  if (!source) return undefined;
  if (['npm', 'pip', 'archive'].includes(text(source.source))) return `Copilot CLI refuses a marketplace with a ${text(source.source)} plugin source (“${name}”).`;
  if (/^[\w.-]+@[\w.-]+:/.test(text(source.url))) return `Copilot CLI refuses a marketplace with an SCP-style plugin URL (“${name}”).`;
  return undefined;
}

/**
 * One marketplace.json entry as a plugin the page can show, or undefined when its name isn't one the tools accept. A
 * plugin stored in the marketplace (a string `source`) gets its folder and counts; one kept elsewhere gets where it lives.
 */
async function catalogEntry(item: Record<string, unknown>, root: string, pluginRoot: string, counts: boolean): Promise<CatalogPlugin | undefined> {
  if (typeof item.name !== 'string' || !SAFE_NAME.test(item.name)) return undefined;
  const author = text(item.author) || text(record(item.author)?.name);
  const words = [...(strings(item.keywords) ?? []), ...(strings(item.tags) ?? [])];
  const plugin: CatalogPlugin = {
    name: item.name, description: text(item.description), version: text(item.version) || undefined, displayName: text(item.displayName) || undefined,
    category: text(item.category) || undefined, author: author || undefined, homepage: isHttps(item.homepage) ? item.homepage : undefined,
    license: text(item.license) || undefined, keywords: words.length ? [...new Set(words)] : undefined, from: sourceOf(item.source), remote: remoteOf(item.source), entry: item,
  };
  if (typeof item.source === 'string') {
    const where = item.source;
    // marketplace.json's metadata.pluginRoot is the folder a bare name ("formatter") is looked up in; a path that says
    // where it starts ("./plugins/formatter", "../shared") is taken from the marketplace's root as written.
    const folder = resolve(root, pluginRoot && !where.startsWith('./') && !where.startsWith('../') ? join(pluginRoot, where) : where);
    // A path outside the marketplace, through a link or not, is not read.
    if (await inside(root, folder)) { plugin.folder = folder; if (counts) plugin.components = await componentsOf(folder, item, root); }
  }
  return plugin;
}

/** At most this many plugins' files are read at once while a catalog is read. */
const READS_AT_ONCE = 8;
/** `work` for every item, at most `limit` at a time, results in the items' order. */
async function eachLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const at = next++; results[at] = await work(items[at]!); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Reads the marketplace.json in `root` (a folder, or Central Knot's copy of a Git marketplace) into a catalog: its name,
 * owner and description, and its plugins sorted by name. A file that is missing, outside `root`, unreadable or misnamed
 * gives a catalog with no plugins and a `problem` to show. Nothing is fetched or run. `counts: false` skips reading each
 * plugin's files for the counts its row shows; installing and reading one plugin's page don't need them.
 */
export async function parseCatalog(root: string, source: string, kind: Catalog['kind'], { counts = true } = {}): Promise<Catalog> {
  const fetchedAt = new Date().toISOString();
  const failed = (problem: string): Catalog => ({ name: '', source, kind, fetchedAt, plugins: [], problem });
  const read = await readManifest(root);
  if ('problem' in read) return failed(read.problem);
  const { manifest } = read;
  const name = text(manifest.name);
  if (!name) return failed('Its marketplace.json has no name.');
  // Names reach each tool's command line as plugin@marketplace: anything that could read as an option is not offered.
  if (!SAFE_NAME.test(name)) return failed(`Its name (“${name.slice(0, 60)}”) isn’t one the tools accept.`);
  const metadata = record(manifest.metadata);
  const entries = (Array.isArray(manifest.plugins) ? manifest.plugins : []).map(record).filter((item): item is Record<string, unknown> => !!item);
  const plugins = (await eachLimited(entries, READS_AT_ONCE, item => catalogEntry(item, root, text(metadata?.pluginRoot), counts))).filter((plugin): plugin is CatalogPlugin => !!plugin);
  const copilotRefuses = entries.map(item => copilotRefusal(text(item.name), item.source)).find(Boolean);
  return { name, source, kind, fetchedAt, root, owner: text(record(manifest.owner)?.name) || undefined, description: text(manifest.description) || text(metadata?.description) || undefined,
    copilotRefuses, plugins: plugins.sort((first, second) => first.name.localeCompare(second.name)) };
}

/** The counts a row shows, from the same read the plugin page uses, so the two always agree. */
async function componentsOf(folder: string, entry: Record<string, unknown>, root: string): Promise<Components> {
  return componentsFrom(await pluginContents(folder, entry, root));
}

// ---------- What each tool has ----------

const configRootOf = (context: PluginContext, tool: HarnessId) => configRoot(harnesses[tool], context.home, context.overrides?.[tool]);

/** A tool's JSON record as an object; Copilot's config.json starts with `//` comment lines, which are dropped first. */
async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try { return parseObject(withoutBom(await readFile(path, 'utf8')).replace(/^\s*\/\/.*$/gm, '')); } catch { return undefined; }
}
const recordJson = (context: PluginContext, path: string) => once(context, `json:${path}`, () => readJson(path));
/**
 * One entry of Codex's `skills.config` list in config.toml: a skill picked by `name` (a plugin's as `plugin:skill`) or by
 * the `path` of its SKILL.md, turned off by `enabled = false`. Where several pick one skill, Codex lets the last decide.
 */
interface CodexSkillSwitch { name?: string; path?: string; enabled: boolean; /** Where its `[[skills.config]]` block starts in the file; undefined for one written inline (`skills.config = [...]`), which Central Knot reads but never edits. */ start?: number }
/**
 * Codex's skill switches in a config.toml, in file order, and whether the list is written as a value (`inline`), even an
 * empty one, where a `[[skills.config]]` block can't be added. Throws when it isn't TOML this reader can follow.
 */
function codexSkillSwitches(text: string): { switches: CodexSkillSwitch[]; inline: boolean } {
  const switchOf = (fields: Record<string, TomlValue>, start?: number): CodexSkillSwitch =>
    ({ name: typeof fields.name === 'string' ? fields.name : undefined, path: typeof fields.path === 'string' ? fields.path : undefined, enabled: fields.enabled !== false, start });
  const found: CodexSkillSwitch[] = [];
  let inline = false;
  for (const table of readTomlTables(text)) {
    if (table.array && table.path.join('.') === 'skills.config') { found.push(switchOf(Object.fromEntries(table.entries.map(entry => [entry.key, entry.value])), table.start)); continue; }
    if (table.array) continue;
    // The same list written as a value: `skills.config = [{ … }]` at the top, or `config = [{ … }]` under `[skills]`.
    for (const entry of table.entries) {
      const path = [...table.path, ...entry.keys].join('.');
      // `skills = { config = [...] }` is the same list inside an inline table, which no `[[skills.config]]` block may extend.
      const value = path === 'skills' && entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value) ? entry.value.config : path === 'skills.config' ? entry.value : undefined;
      if (path !== 'skills' && path !== 'skills.config') continue;
      inline = true;
      for (const item of Array.isArray(value) ? value : []) if (item && typeof item === 'object' && !Array.isArray(item)) found.push(switchOf(item));
    }
  }
  return { switches: found, inline };
}
type CodexTables = Record<'marketplaces' | 'plugins', Record<string, Record<string, TomlValue>>> & { skills: CodexSkillSwitch[] };
/** Codex's `[marketplaces.NAME]` and `[plugins."ID"]` tables from its config.toml, by name, and its skill switches. Empty when it can't be read. */
const codexTables = (context: PluginContext, root: string) => once(context, `codex:${root}`, async (): Promise<CodexTables> => {
  const found: CodexTables = { marketplaces: Object.create(null), plugins: Object.create(null), skills: [] };
  try {
    const text = await readFile(join(root, 'config.toml'), 'utf8');
    for (const table of readTomlTables(text)) {
      const [kind, name, ...deeper] = table.path;
      if ((kind === 'marketplaces' || kind === 'plugins') && name && !deeper.length && !table.array) found[kind][name] = Object.fromEntries(table.entries.map(entry => [entry.key, entry.value]));
    }
    found.skills = codexSkillSwitches(text).switches;
  } catch { /* missing, or not TOML this reader can follow: nothing registered */ }
  return found;
});

/**
 * The marketplaces a tool already has, as added there: no setup needed to browse them. Claude Code records the ones its
 * own command added in plugins/known_marketplaces.json; Claude Code and Copilot CLI also read extraKnownMarketplaces in
 * settings.json; Codex keeps `[marketplaces.NAME]` tables in config.toml.
 */
export async function registeredMarketplaces(context: PluginContext, tool: HarnessId): Promise<{ name: string; source: string }[]> {
  const root = configRootOf(context, tool);
  if (tool === 'codex-cli') return Object.entries((await codexTables(context, root)).marketplaces).map(([name, entry]) => ({ name, source: text(entry.source) })).filter(entry => entry.source);
  const lists = [record((await recordJson(context, join(root, 'settings.json')))?.extraKnownMarketplaces)];
  if (tool === 'claude-cli') lists.unshift(await recordJson(context, join(root, 'plugins/known_marketplaces.json')));
  const found = new Map<string, string>();
  for (const [name, entry] of lists.flatMap(list => Object.entries(list ?? {}))) {
    const source = record(record(entry)?.source);
    const where = text(source?.url) || text(source?.path) || text(source?.repo);
    if (where && !found.has(name)) found.set(name, where);
  }
  return [...found].map(([name, source]) => ({ name, source }));
}

const hasFiles = async (path: string) => { try { return (await readdir(path)).length > 0; } catch { return false; } };

/** The marketplace a tool has under a name, as the source it was added from. */
async function registeredSource(context: PluginContext, tool: HarnessId, marketplace: string): Promise<string | undefined> {
  return (await registeredMarketplaces(context, tool)).find(entry => entry.name === marketplace)?.source;
}

/**
 * The source of a different marketplace the tool already has under this name, if it has one. Central Knot never installs
 * from, uninstalls from or replaces such a marketplace: it is "held".
 */
export async function heldBy(context: PluginContext, tool: HarnessId, marketplace: string, source: string): Promise<string | undefined> {
  const registered = await registeredSource(context, tool, marketplace);
  return registered && !sameSource(registered, source) ? registered : undefined;
}

/**
 * Installed only with files at the path the tool records; a record with no files is Not known yet (PLG-03). Never scans.
 * `entry` (the plugin's marketplace.json entry) says where its skills are, for the skills an installed copy holds.
 */
export async function installState(context: PluginContext, tool: HarnessId, marketplace: string, plugin: string, entry?: Record<string, unknown>): Promise<InstallState> {
  const root = configRootOf(context, tool);
  const id = `${plugin}@${marketplace}`;
  if (tool === 'claude-cli') {
    // Only the user scope counts: it is the one Central Knot installs to (--scope user) and the one `uninstall` removes.
    // A plugin installed for one project only is not installed for this person everywhere.
    const listed = record((await recordJson(context, join(root, 'plugins/installed_plugins.json')))?.plugins)?.[id];
    const user = (Array.isArray(listed) ? listed : []).map(record).find(entry => entry?.scope === 'user');
    const path = text(user?.installPath);
    if (!path) return { state: 'not-installed' };
    return (await hasFiles(path)) ? { state: 'installed', path } : { state: 'not-known', reason: 'Claude Code lists it, but its files are not where it records them.' };
  }
  if (tool === 'copilot-cli') {
    const settingsOf = () => recordJson(context, join(root, 'settings.json'));
    const listed = (await recordJson(context, join(root, 'config.json')))?.installedPlugins;
    const listing = (Array.isArray(listed) ? listed : []).map(record).find(item => item?.name === plugin && item.marketplace === marketplace);
    const cache = text(listing?.cache_path);
    if (cache) return (await hasFiles(cache)) ? withSkills(cache, entry, false, async skills => copilotSkillsOff(await settingsOf(), plugin, skills)) : { state: 'not-known', reason: 'Copilot CLI lists it, but its files are not where it records them.' };
    // A plugin from a local folder marketplace is loaded live from that folder: nothing is copied.
    const settings = await settingsOf();
    const enabled = record(settings?.enabledPlugins)?.[id] === true;
    const source = record(record(record(settings?.extraKnownMarketplaces)?.[marketplace])?.source);
    const folderPath = text(source?.path);
    if (enabled && source?.source === 'directory' && folderPath) {
      const catalog = await once(context, `catalog:${folderPath}`, () => parseCatalog(folderPath, folderPath, 'folder', { counts: false }));
      const item = catalog.plugins.find(candidate => candidate.name === plugin);
      const folder = item?.folder;
      return folder && (await hasFiles(folder)) ? withSkills(folder, item.entry ?? entry, true, async skills => copilotSkillsOff(settings, plugin, skills)) : { state: 'not-known', reason: 'Copilot CLI has it turned on, but the folder it loads from is gone.' };
    }
    return { state: 'not-installed' };
  }
  const tables = await codexTables(context, root);
  if (!tables.plugins[id]) return { state: 'not-installed' };
  const cache = join(root, 'plugins/cache', marketplace, plugin);
  const version = activeCodexVersion(await readdir(cache).catch(() => [] as string[]));
  const folder = version && join(cache, version);
  if (folder && (await hasFiles(folder))) return withSkills(folder, entry, false, skills => codexSkillsOff(tables.skills, plugin, folder, skills));
  return { state: 'not-known', reason: 'Codex lists it, but its files are not in its plugin cache.' };
}


/**
 * The version folder Codex loads of a cached plugin (core-plugin-common `active_plugin_version`): `local` when there is
 * one, otherwise the highest version. Only that one counts: if it is empty, the plugin is Not known yet, never an older one.
 */
function activeCodexVersion(versions: string[]): string | undefined {
  const valid = versions.filter(version => /^[A-Za-z0-9._+-]+$/.test(version) && version !== '.' && version !== '..');
  return valid.includes('local') ? 'local' : valid.sort(compareVersions).at(-1);
}

// ---------- One skill of an installed plugin (ENB-06) ----------
// Codex and Copilot CLI each have a switch for one skill of a plugin, by the name they give it: `plugin:skill`, the skill
// by its SKILL.md name (its folder's when it gives none). Neither touches the plugin's files, and both outlive an update.

const qualified = (plugin: string, skill: string) => `${plugin}:${skill}`;
/** The skill a `plugin:skill` name picks, if it names one of this plugin's. */
const skillOf = (plugin: string, name: string) => (name.startsWith(`${plugin}:`) ? name.slice(plugin.length + 1) : undefined);

/** An installed copy in `folder`, with the skills it holds (read with its marketplace `entry`) and, of those, the ones `offs` says the tool has turned off. */
async function withSkills(folder: string, entry: Record<string, unknown> | undefined, live: boolean, offs: (skills: string[]) => Promise<SkillOff[]>): Promise<InstallState> {
  const skills = await skillNamesIn(folder, entry);
  return { state: 'installed', path: folder, ...(live ? { live } : {}), skills, skillsOff: await offs(skills) };
}

/** Of `skills`, those Copilot CLI's `disabledSkills` (settings.json) turns off. A bare name turns off every skill so named: held. */
function copilotSkillsOff(settings: Record<string, unknown> | undefined, plugin: string, skills: string[]): SkillOff[] {
  const off = new Map<string, SkillOff>();
  for (const name of strings(settings?.disabledSkills) ?? []) {
    const skill = skillOf(plugin, name);
    if (skill && skills.includes(skill) && !off.has(skill)) off.set(skill, { skill });
    else if (!name.includes(':') && skills.includes(name)) off.set(name, { skill: name, held: offByBareName(name) });
  }
  return [...off.values()];
}

/** The skill of the plugin in `folder` that a Codex switch picks, if it picks one: by `plugin:skill`, or by a SKILL.md path inside that copy. */
async function codexSwitchSkill(entry: CodexSkillSwitch, plugin: string, folder: string): Promise<string | undefined> {
  if (entry.name) return skillOf(plugin, entry.name);
  if (!entry.path) return undefined;
  // Codex's own /skills toggle writes the path, which names one version's copy: an update leaves it behind.
  const file = basename(entry.path) === 'SKILL.md' ? resolve(entry.path) : join(resolve(entry.path), 'SKILL.md');
  if (!(await inside(folder, file))) return undefined;
  const body = await readFile(file, 'utf8').catch(() => undefined);
  return body === undefined ? undefined : skillName(body, dirname(file));
}

/** Of `skills` (the copy in `folder`), those Codex has turned off: for each skill, the last switch that picks it decides. */
async function codexSkillsOff(switches: CodexSkillSwitch[], plugin: string, folder: string, skills: string[]): Promise<SkillOff[]> {
  const enabled = new Map<string, boolean>();
  for (const entry of switches) { const skill = await codexSwitchSkill(entry, plugin, folder); if (skill && skills.includes(skill)) enabled.set(skill, entry.enabled); }
  return [...enabled].filter(([, on]) => !on).map(([skill]) => ({ skill }));
}

/**
 * Each Codex skill switch written this session, by config.toml and `plugin:skill`: the file before and after, and which
 * way. Switching that skill back while the file is still exactly as written gives the earlier bytes back whole (a block
 * the person had for the skill, a path-form one, a missing final newline), which is what makes an Undo exact.
 */
const codexWrites = new Map<string, { before: string | null; after: string; on: boolean }>();

/**
 * Codex's switch for one skill of the plugin in `folder`, in config.toml: every `[[skills.config]]` block that picks it is
 * taken out, and to turn it off one block naming it is added (by name, never by path, so an update keeps it off); or, to
 * switch back what this session just wrote, the file as it was before (see codexWrites). A file changed meanwhile, or one
 * that writes the list as a value (where a `[[skills.config]]` block would make the file invalid), is left alone.
 * Returns a problem, or undefined once written.
 */
async function switchCodexSkill(context: PluginContext, plugin: string, skill: string, on: boolean, folder: string): Promise<string | undefined> {
  const path = join(configRootOf(context, 'codex-cli'), 'config.toml');
  const key = `${path}\u0000${qualified(plugin, skill)}`;
  const before = await readOrNull(path);
  const last = codexWrites.get(key);
  // Switching back what this session wrote, with the file untouched since: its earlier bytes, whole. (A file this session
  // created is edited instead, so the skill's way back never deletes config.toml.)
  const switchesBack = last && last.on !== on && last.before !== null && before === last.after;
  const edit = switchesBack ? { text: last.before! } : await codexConfigWith(before ?? '', plugin, skill, on, folder);
  if ('problem' in edit) return edit.problem;
  const after = edit.text;
  if (after === before) return undefined;
  try { await writeFileChecked(path, after, before ?? undefined); }
  catch (error) { return errorCode(error) === 'CK_CHANGED' ? 'Codex’s config.toml changed just then, so it was left as it is. Try again.' : `Codex’s config.toml couldn’t be written: ${error instanceof Error ? error.message : String(error)}`; }
  codexWrites.set(key, { before, after, on });
  await keepRecord(context, 'codex-cli', `config.toml [[skills.config]] name = "${qualified(plugin, skill)}"${on ? ' removed' : ' enabled = false'}`, '', [{ path, before, after }]).catch(() => undefined);
  return undefined;
}

/**
 * Codex's config.toml `text` with every block that picks this skill of the plugin in `folder` taken out and, to turn it
 * off, one block naming it added; or why it can't be edited: not TOML this reader follows, or the list written as a value.
 */
async function codexConfigWith(text: string, plugin: string, skill: string, on: boolean, folder: string): Promise<{ text: string } | { problem: string }> {
  let read: ReturnType<typeof codexSkillSwitches>;
  try { read = codexSkillSwitches(text); } catch { return { problem: 'Codex’s config.toml couldn’t be read, so it was left as it is.' }; }
  const { switches, inline } = read;
  if (inline) return { problem: 'Codex’s config.toml writes skills.config as a value, a form Central Knot doesn’t edit, so it was left as it is.' };
  const picks = new Set<number>();
  for (const entry of switches) if (entry.start !== undefined && (await codexSwitchSkill(entry, plugin, folder)) === skill) picks.add(entry.start);
  return { text: editTomlArray(text, ['skills', 'config'], block => picks.has(block.start), on ? undefined : { name: qualified(plugin, skill), enabled: false }) };
}

/**
 * Turns one skill of an installed plugin off (`on` false) or back on in one tool, with that tool's own switch, then reads
 * the switch again: only what the tool then records counts (Copilot CLI's commands exit 0 even on a name they don't know).
 * The plugin's files are never touched. A tool with no such switch, a skill the installed copy lacks, or one held off by a
 * switch that isn't this plugin's own fails with the reason, and nothing changes.
 */
export async function setSkill(context: PluginContext, marketplace: string, plugin: string, skill: string, tool: HarnessId, on: boolean, source: string, entry?: Record<string, unknown>): Promise<ActionReport> {
  const name = toolNames[tool];
  const outcome = on ? 'skill-on' : 'skill-off';
  const fail = (message: string, runs: NativeRun[] = []): ActionReport => ({ tool, outcome: 'failed', message, runs });
  const blocked = skillSwitchBlock(tool, undefined, skill);
  if (blocked) return fail(blocked);
  const held = await heldBy(context, tool, marketplace, source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, marketplace, held), runs: [] };
  /** The skill in the installed copy as the tool's switch has it now: on or off, and why it is held off if it is. */
  const now = async () => {
    const state = await installState(context, tool, marketplace, plugin, entry);
    if (state.state !== 'installed') return undefined;
    const off = state.skillsOff?.find(entry => entry.skill === skill);
    return { path: state.path, skills: state.skills, on: !off, held: off?.held };
  };
  const before = await now();
  if (!before) return fail(`It isn’t installed in ${name} now.`);
  const missing = skillSwitchBlock(tool, before.skills, skill);
  if (missing) return fail(missing);
  if (before.on === on) return { tool, outcome, message: `Already ${on ? 'on' : 'off'} in ${name}.`, runs: [] };
  if (on && before.held) return fail(before.held);
  const runs: NativeRun[] = [];
  if (tool === 'codex-cli') { const problem = await switchCodexSkill(context, plugin, skill, on, before.path); if (problem) return fail(problem); }
  else runs.push(await native(context, tool, ['skill', on ? 'enable' : 'disable', qualified(plugin, skill)]));
  const after = await now();
  if (after?.on === on) return { tool, outcome, changed: true, message: `Turned ${on ? 'on' : 'off'} in ${name}. ${nextStepFor(tool, 'for this to take effect')}`.trim(), runs };
  return fail(`Still ${on ? 'off' : 'on'} in ${name}. ${after?.held ?? lastLines(runs[0]?.output ?? '')}`.trim(), runs);
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

/** Keeps a native command's output and the bytes of each file it changed, before and after, in Central Knot's data folder (FIL-03). */
async function keepRecord(context: PluginContext, tool: HarnessId, command: string, output: string, changed: NativeRun['changed']): Promise<void> {
  const folder = join(context.dataDir, 'native', `${new Date().toISOString().replace(/[:.]/g, '-')}-${tool}-${randomUUID().slice(0, 8)}`);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'command.txt'), `${command}\n\n${output}\n`);
  for (const [index, entry] of changed.entries()) {
    if (entry.before !== null) await writeFile(join(folder, `${index}-before-${basename(entry.path)}`), entry.before);
    if (entry.after !== null) await writeFile(join(folder, `${index}-after-${basename(entry.path)}`), entry.after);
  }
}

/** Runs one native command for a tool against the chosen home, keeping the prior bytes of every file it may change. */
async function native(context: PluginContext, tool: HarnessId, args: string[]): Promise<NativeRun> {
  const binary = context.binaries[tool];
  const command = `${harnesses[tool].binary} ${args.join(' ')}`;
  if (!binary) return { tool, command, ok: false, output: noCli(tool), changed: [] };
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
  // The record of what changed is kept beside the result, not instead of it: if it can't be written (a full disk), what
  // the tool did is still reported, so a real install stays in the report and its Undo.
  if (changed.length) await keepRecord(context, tool, command, result.output, changed).catch(() => undefined);
  const output = result.code === 'timeout' ? `${command} did not finish in time and was stopped. ${result.output}`.trim() : result.code === 'missing' ? `${binary} could not be run.` : result.output || (result.code === 0 ? '' : `It stopped with exit code ${result.code} and said nothing.`);
  return { tool, command, ok: result.code === 0, output, changed };
}

/** Installs one plugin into one tool: adds the marketplace there if needed (never replacing a different one of the same name), installs, then reads the tool's record. */
export async function install(context: PluginContext, catalog: Catalog, plugin: string, tool: HarnessId): Promise<ActionReport> {
  const runs: NativeRun[] = [];
  const name = toolNames[tool];
  if (tool === 'copilot-cli') {
    const refusal = catalog.copilotRefuses;
    if (refusal) return { tool, outcome: 'held', message: `${refusal} Nothing was added to Copilot CLI.`, runs };
  }
  // Held first: a same-named plugin installed from the other marketplace is not this one "already installed".
  const held = await heldBy(context, tool, catalog.name, catalog.source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, catalog.name, held), runs };
  const already = await installState(context, tool, catalog.name, plugin);
  if (already.state === 'installed') return { tool, outcome: 'installed', message: `Already installed in ${name}.`, runs };
  // Codex's CLI won't add a marketplace to a home whose .codex folder doesn't exist yet (a fresh Practice copy).
  if (tool === 'codex-cli') await mkdir(configRootOf(context, tool), { recursive: true });
  const registered = await registeredSource(context, tool, catalog.name);
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
  // A marketplace the tool already had is used as the tool last fetched it, which may predate what this page shows.
  const older = registered ? ` ${name} uses its own copy of this marketplace, which may be older than the one shown here: update it in ${name}, then try again.` : '';
  return { tool, outcome: 'failed', message: `Not installed. ${lastLines(installed.output)}${older}`.trim(), runs };
}

/** Uninstalls through the tool's own command and reads its record again. The marketplace stays added there. */
export async function uninstall(context: PluginContext, marketplace: string, plugin: string, tool: HarnessId, source: string): Promise<ActionReport> {
  const name = toolNames[tool];
  const held = await heldBy(context, tool, marketplace, source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, marketplace, held), runs: [] };
  const before = await installState(context, tool, marketplace, plugin);
  if (before.state === 'not-installed') return { tool, outcome: 'uninstalled', message: `Not installed in ${name}.`, runs: [] };
  const id = `${plugin}@${marketplace}`;
  const args = tool === 'codex-cli' ? ['plugin', 'remove', id, '--json'] : tool === 'claude-cli' ? ['plugin', 'uninstall', id, '--scope', 'user'] : ['plugin', 'uninstall', id];
  const removed = await native(context, tool, args);
  const state = await installState(context, tool, marketplace, plugin);
  if (state.state === 'not-installed') return { tool, outcome: 'uninstalled', changed: true, message: `Uninstalled from ${name}. The marketplace stays added there.${before.state === 'installed' && before.live ? ' Its folder is the marketplace’s own and stays.' : ''}`, runs: [removed] };
  return { tool, outcome: 'failed', message: `Still installed. ${lastLines(removed.output)}`.trim(), runs: [removed] };
}


/** The end of a tool's own message, shown as it is. */
const lastLines = (output: string) => output.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 400);

/** What to do for a change to reach the tool: `purpose` says what for ("to use it"). */
const nextStepFor = (tool: HarnessId, purpose = 'to use it') => ({
  'claude-cli': `Start a new Claude Code session, or run /reload-plugins, ${purpose}.`,
  'copilot-cli': `Start a new Copilot CLI session ${purpose}.`,
  'codex-cli': `Start a new Codex session ${purpose}; restart the ChatGPT desktop app if it is open.`,
} as Partial<Record<HarnessId, string>>)[tool] ?? '';

