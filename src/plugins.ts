// Marketplaces and plugins for the CLIs: read a catalog without running anything from it, show what each tool would get,
// and install or uninstall through each tool's own commands, confirmed by reading the record that tool keeps (PLG-03).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathBeside } from './platform.ts';
import { configRoot, harnesses } from './harnesses.ts';
import { CODEX_MANIFEST, MANIFEST, codexManifest, inside, installedContents, parseObject, pluginContents, pluginManifest, readManifest, remoteOf, skillName, skillNamesIn, sourceOf, type ReadAs } from './catalogdetail.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { editTomlArray, readTomlTables, type TomlValue } from './textedit.ts';
import { codexSkillSwitches, type CodexSkillSwitch } from './skillswitch.ts';
import { partOff, serverHeld, withPartSwitch } from './partswitch.ts';
import { DIRECTORY, INLINE_SKILLS_CONFIG, hasPartSwitch, heldReason, noCli, offByBareName, noSwitchReason, samePart } from './pluginstatus.ts';
import { takesPlugins, type PluginTool } from './presence.ts';
import { errorCode, itemKey, readParts, writeFileChecked } from './share.ts';
import { SAFE_NAME, compareVersions, githubRepo, isCommitHash, isFolder, isHttps, record, strings, text, withoutBom } from './values.ts';

/** Names the tools accept (values.ts holds it, so the page can check a skill's name too). */
export { DIRECTORY, SAFE_NAME };
import { toolNames } from './words.ts';
import type { ActionReport, Catalog, CatalogPlugin, DesktopApp, Components, HarnessId, InstallState, NativeRun, PartKind, PluginContents, SkillOff, ThroughPlugin } from './types.ts';

// ---------- Shapes ----------

export interface PluginContext {
  home: string;
  /** Where this build keeps fetched catalogs and the prior bytes of native operations. */
  dataDir: string;
  /** The binary to run for each tool's plugin commands: its CLI, or with none, the copy its desktop app carries (`apps`). */
  binaries: Partial<Record<HarnessId, string>>;
  /** Tools whose binary is a desktop app's own copy, with that app. */
  apps?: Partial<Record<HarnessId, DesktopApp>>;
  overrides?: Partial<Record<HarnessId, string>>;
  timeoutMs?: number;
  /** Reads shared within one read-only view (each tool's records and a live folder's catalog read once). Never set for an install or uninstall, which read again after their command. */
  reads?: Map<string, Promise<unknown>>;
  /** Access checks made in one request, by URL, so tools installing from one Git marketplace check it once (MKT-05). */
  checked?: Map<string, Promise<AccessResult>>;
}

/** A read done once per context when the context carries a cache. */
function once<T>(context: PluginContext, key: string, read: () => Promise<T>): Promise<T> {
  if (!context.reads) return read();
  if (!context.reads.has(key)) context.reads.set(key, read());
  return context.reads.get(key) as Promise<T>;
}


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

export const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' });

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

/** Git run with hooks and prompts off: an SSH host, key or credential that would ask fails at once instead (MKT-05). */
const git = (args: string[], timeoutMs: number) => run('git', ['-c', 'core.hooksPath=/dev/null', ...args], { env: gitEnv(), timeoutMs });
/** The same Git, for other features (the git repo of the Managed set): hooks and prompts off, this computer's own sign-in. */
export const runGit = (args: string[], timeoutMs = 60_000) => git(args, timeoutMs);

/** What a Git source said when asked for access: ok, or one MKT-05 class with words a person can act on. */
export type AccessResult = { state: 'ok' } | { state: 'sign-in' | 'no-access' | 'unknown-host' | 'passphrase' | 'network' | 'git-missing' | 'unclassified'; message: string };

/** Why a Git command failed, in classes a person can act on (MKT-05). Where the server's answer fits more than one cause, the message names each. */
/** Git's words, without what it quotes (an address, a path): a port or folder there such as 40123 is no HTTP status. */
const gitSaid = (output: string) => output.toLowerCase().replace(/'[^'\n]*'/g, "''");

export function gitFailure(code: number | 'timeout' | 'missing', output: string, place = 'marketplace'): Exclude<AccessResult, { state: 'ok' }> {
  const text = gitSaid(output);
  if (code === 'missing') return { state: 'git-missing', message: `Git is not installed, so this ${place} cannot be read. Install Git, then try again.` };
  if (code === 'timeout' || /could not resolve host|timed out|connection refused|could not connect to server|network is unreachable|no route to host|failed to connect/.test(text)) return { state: 'network', message: `Can’t reach the ${place}. Check your connection; a company ${place} may need its network or VPN.` };
  if (/host key verification failed/.test(text)) return { state: 'unknown-host', message: 'This SSH host is not known on this computer yet. Connect to it once in a terminal (for example `ssh -T git@host`) and compare its fingerprint; Central Knot never changes known_hosts.' };
  if (/passphrase/.test(text)) return { state: 'passphrase', message: 'Your SSH key needs its passphrase. Add it to your SSH agent, then try again.' };
  if (/authentication failed|could not read username|terminal prompts disabled|\b40[13]\b|permission denied \(publickey/.test(text)) return { state: 'sign-in', message: 'Sign-in needed, or no repository there: the server doesn’t say which. Check the address, and use credentials that already work for Git on this computer, then try again.' };
  if (/repository not found|not found|\b404\b|does not appear to be a git repository|access denied/.test(text)) return { state: 'no-access', message: 'No access, or no repository there: the server doesn’t say which. Check the address and that your account can read it.' };
  return { state: 'unclassified', message: output.split('\n').slice(-3).join(' ').slice(0, 400) || 'Git failed without saying why.' };
}

/** Why a Git command failed, in words a person can act on (MKT-05). */
export const whyGitFailed = (code: number | 'timeout' | 'missing', output: string, place?: string): string => gitFailure(code, output, place).message;

/**
 * Whether this computer can read a Git source, asked with `git ls-remote` before Add reads it and before a tool is told
 * to fetch it, because a tool's own fetch fails silently (MKT-05). Ok proves access from Central Knot only; a tool's own
 * result still decides an install. Checks made with one context's `checked` are made once per source.
 */
export function checkAccess(context: PluginContext, source: string): Promise<AccessResult> {
  const url = fetchUrl(source);
  const ask = async (): Promise<AccessResult> => {
    const listed = await git(['ls-remote', '--quiet', '--', url, 'HEAD'], context.timeoutMs ?? 20_000);
    return listed.code === 0 ? { state: 'ok' } : gitFailure(listed.code, listed.output);
  };
  if (!context.checked) return ask();
  if (!context.checked.has(url)) context.checked.set(url, ask());
  return context.checked.get(url)!;
}

/** Why a push failed: the repo moved on, or this account can't write there; anything else as whyGitFailed says. */
export function whyPushFailed(code: number | 'timeout' | 'missing', output: string, place = 'repo'): string {
  const text = gitSaid(output);
  // Refusals first: a protected branch also says "rejected", and pulling again would not help.
  if (/read-only|\b403\b|denied|not allowed|protected branch|pre-receive hook declined/.test(text)) return `The ${place} did not accept the push: your account may only be able to read it, or the branch is protected. Nothing changed here.`;
  if (/non-fast-forward|fetch first|stale info/.test(text)) return `The ${place} changed just now. Pull, then push again.`;
  return whyGitFailed(code, output, place);
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
  const timeoutMs = context.timeoutMs ?? 60_000;
  const cloned = await git(['clone', '--depth', '1', '--no-recurse-submodules', '--quiet', ...(ref ? ['--branch', ref] : []), '--', url, stage], timeoutMs);
  if (cloned.code !== 0) {
    await rm(stage, { recursive: true, force: true });
    return whyGitFailed(cloned.code, cloned.output);
  }
  // A pinned commit is checked out in the stage too: the copy takes its place only when it is exactly what was asked for.
  if (sha) {
    const fetched = await git(['-C', stage, 'fetch', '--depth', '1', '--quiet', 'origin', sha], timeoutMs);
    const checked = fetched.code === 0 ? await git(['-C', stage, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], timeoutMs) : fetched;
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
  const fetched = await stat(join(target, MANIFEST)).catch(() => stat(join(target, CODEX_MANIFEST))).catch(() => undefined);
  if (!fetched) return undefined;
  return { ...(await parseCatalog(target, source, 'git')), fetchedAt: fetched.mtime.toISOString() };
}

/** Why Copilot CLI would refuse a whole marketplace because of this one entry's source (MKT-06), if it would. */
function copilotRefusal(name: string, where: unknown): string | undefined {
  const source = record(where);
  if (!source) return undefined;
  if (['npm', 'pip', 'archive'].includes(text(source.source))) return `Copilot CLI refuses a marketplace with ${text(source.source) === 'pip' ? 'a' : 'an'} ${text(source.source)} plugin source (“${name}”).`;
  if (/^[\w.-]+@[\w.-]+:/.test(text(source.url))) return `Copilot CLI refuses a marketplace with an SCP-style plugin URL (“${name}”).`;
  return undefined;
}

/**
 * One marketplace.json entry as a plugin the page can show, or undefined when its name isn't one the tools accept. A
 * plugin stored in the marketplace (a string `source`) gets its folder and counts; one kept elsewhere gets where it lives.
 */
async function catalogEntry(item: Record<string, unknown>, root: string, pluginRoot: string, counts: boolean, codex: boolean): Promise<CatalogPlugin | undefined> {
  if (typeof item.name !== 'string' || !SAFE_NAME.test(item.name)) return undefined;
  const author = text(item.author) || text(record(item.author)?.name);
  const words = [...(strings(item.keywords) ?? []), ...(strings(item.tags) ?? [])];
  const plugin: CatalogPlugin = {
    name: item.name, description: text(item.description), version: text(item.version) || undefined, displayName: text(item.displayName) || undefined,
    category: text(item.category) || undefined, author: author || undefined, homepage: isHttps(item.homepage) ? item.homepage : undefined,
    license: text(item.license) || undefined, keywords: words.length ? [...new Set(words)] : undefined, from: sourceOf(item.source), remote: remoteOf(item.source), entry: item,
  };
  // Codex's own marketplaces name a plugin kept in them as { "source": "local", "path": "./plugins/name" }.
  const local = codex && record(item.source)?.source === 'local' ? text(record(item.source)?.path) : '';
  if (local) plugin.from = undefined;
  if (typeof item.source === 'string' || local) {
    const where = local || String(item.source);
    // marketplace.json's metadata.pluginRoot is the folder a bare name ("formatter") is looked up in; a path that says
    // where it starts ("./plugins/formatter", "../shared") is taken from the marketplace's root as written.
    const folder = resolve(root, pluginRoot && !where.startsWith('./') && !where.startsWith('../') ? join(pluginRoot, where) : where);
    // A path outside the marketplace, through a link or not, is not read.
    if (await inside(root, folder)) {
      plugin.folder = folder;
      plugin.isMarketplaceRoot = resolve(folder) === resolve(root) || undefined;
      // A Codex marketplace's plugin is read as Codex reads it, by its .codex-plugin manifest.
      const codexOwn = codex ? await codexManifest(folder) : undefined;
      const contents = counts ? await pluginContents(folder, item, root, { atMarketplaceRoot: !!plugin.isMarketplaceRoot, codex: codexOwn }) : undefined;
      if (contents) plugin.components = componentsFrom(contents);
      // Its plugin.json's version wins over the entry's, as Claude Code reads them (the counts' read already applied that).
      const fromFiles = contents ? contents.version : text((codexOwn ?? await pluginManifest(folder, root))?.version);
      if (fromFiles) plugin.version = fromFiles;
    }
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
  const plugins = (await eachLimited(entries, READS_AT_ONCE, item => catalogEntry(item, root, text(metadata?.pluginRoot), counts, read.codexOnly))).filter((plugin): plugin is CatalogPlugin => !!plugin);
  const copilotRefuses = read.codexOnly ? undefined : entries.map(item => copilotRefusal(text(item.name), item.source)).find(Boolean);
  const codexOnly = read.codexOnly ? `Only Codex reads this marketplace: it has Codex’s ${CODEX_MANIFEST}, not ${MANIFEST}.` : undefined;
  return { name, source, kind, fetchedAt, root, owner: text(record(manifest.owner)?.name) || undefined, description: text(manifest.description) || text(metadata?.description) || undefined,
    copilotRefuses, codexOnly, plugins: plugins.sort((first, second) => first.name.localeCompare(second.name)) };
}

// ---------- What each tool has ----------

const configRootOf = (context: PluginContext, tool: HarnessId) => configRoot(harnesses[tool], context.home, context.overrides?.[tool]);

/** A tool's JSON record as an object; Copilot's config.json starts with `//` comment lines, which are dropped first. */
async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try { return parseObject(withoutBom(await readFile(path, 'utf8')).replace(/^\s*\/\/.*$/gm, '')); } catch { return undefined; }
}
const recordJson = (context: PluginContext, path: string) => once(context, `json:${path}`, () => readJson(path));
type CodexTables = Record<'marketplaces' | 'plugins', Record<string, Record<string, TomlValue>>> & { skills: CodexSkillSwitch[]; skillsInline: boolean };
/** Codex's `[marketplaces.NAME]` and `[plugins."ID"]` tables from its config.toml, by name, and its skill switches. Empty when it can't be read. */
const codexTables = (context: PluginContext, root: string) => once(context, `codex:${root}`, async (): Promise<CodexTables> => {
  const found: CodexTables = { marketplaces: Object.create(null), plugins: Object.create(null), skills: [], skillsInline: false };
  try {
    const tables = readTomlTables(await readFile(join(root, 'config.toml'), 'utf8'));
    for (const table of tables) {
      const [kind, name, ...deeper] = table.path;
      if ((kind === 'marketplaces' || kind === 'plugins') && name && !deeper.length && !table.array) found[kind][name] = Object.fromEntries(table.entries.map(entry => [entry.key, entry.value]));
    }
    ({ switches: found.skills, inline: found.skillsInline } = codexSkillSwitches(tables));
  } catch { /* missing, or not TOML this reader can follow: nothing registered */ }
  return found;
});

/**
 * The marketplaces a tool already has, as added there: no setup needed to browse them. Claude Code records the ones its
 * own command added in plugins/known_marketplaces.json; Claude Code and Copilot CLI also read extraKnownMarketplaces in
 * settings.json; Codex keeps `[marketplaces.NAME]` tables in config.toml.
 */
export async function registeredMarketplaces(context: PluginContext, tool: PluginTool): Promise<{ name: string; source: string }[]> {
  const root = configRootOf(context, tool);
  switch (tool) {
    case 'codex-cli': return Object.entries((await codexTables(context, root)).marketplaces).map(([name, entry]) => ({ name, source: text(entry.source) })).filter(entry => entry.source);
    case 'claude-cli': case 'copilot-cli': {
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
  }
}

const hasFiles = async (path: string) => { try { return (await readdir(path)).length > 0; } catch { return false; } };

/** The marketplace a tool has under a name, as the source it was added from. */
async function registeredSource(context: PluginContext, tool: PluginTool, marketplace: string): Promise<string | undefined> {
  return (await registeredMarketplaces(context, tool)).find(entry => entry.name === marketplace)?.source;
}

/**
 * The source of a different marketplace the tool already has under this name, if it has one. Central Knot never installs
 * from, uninstalls from or replaces such a marketplace: it is "held".
 */
export async function heldBy(context: PluginContext, tool: PluginTool, marketplace: string, source: string): Promise<string | undefined> {
  const registered = await registeredSource(context, tool, marketplace);
  return registered && !sameSource(registered, source) ? registered : undefined;
}

/**
 * The version of a tool's installed copy: what the tool recorded, else what the copy's own manifest says (for a Codex
 * copy, `codex`, the one manifest Codex reads). Claude Code records "unknown" or a commit hash for a plugin without a
 * version, and Codex names such a copy's folder "local" or for a commit, so a commit hash is taken as no version (a real
 * version that looks like one, such as "deadbeef", is then read from the manifest instead). So are hashes joined by "-"
 * (a git-subdir plugin's commit and the hash of its path).
 */
async function copyVersion(recorded: unknown, path: string, codex = false): Promise<string | undefined> {
  const said = text(recorded);
  if (said && said !== 'unknown' && !said.split('-').every(isCommitHash)) return said;
  return text((codex ? await codexManifest(path) : await pluginManifest(path))?.version) || undefined;
}

/** A plugin as the folder marketplace at `folderPath` lists it, read once per request; `folder` is set when its files are kept there. */
async function folderItem(context: PluginContext, folderPath: string, plugin: string): Promise<CatalogPlugin | undefined> {
  const catalog = await once(context, `catalog:${folderPath}`, () => parseCatalog(folderPath, folderPath, 'folder', { counts: false }));
  return catalog.plugins.find(candidate => candidate.name === plugin);
}

/**
 * Installed only with files at the path the tool records; a record with no files is Not known yet (PLG-03). Never scans.
 * `entry` (the plugin's marketplace.json entry) says where its skills are, for the skills an installed copy holds.
 */
export async function installState(context: PluginContext, tool: PluginTool, marketplace: string, plugin: string, entry?: Record<string, unknown>): Promise<InstallState> {
  const root = configRootOf(context, tool);
  const id = `${plugin}@${marketplace}`;
  switch (tool) {
    case 'claude-cli': {
      // Only the user scope counts: it is the one Central Knot installs to (--scope user) and the one `uninstall` removes.
      // A plugin installed for one project only is not installed for this person everywhere.
      const listed = record((await recordJson(context, join(root, 'plugins/installed_plugins.json')))?.plugins)?.[id];
      const user = (Array.isArray(listed) ? listed : []).map(record).find(entry => entry?.scope === 'user');
      const path = text(user?.installPath);
      if (!path) return { state: 'not-installed' };
      // A plugin kept in a local folder marketplace is loaded from that folder at each start, whatever its record says
      // (Claude Code 2.1.321 records a cache copy and its version then, but reads the folder): the catalog's version counts.
      const lists = [await recordJson(context, join(root, 'plugins/known_marketplaces.json')), record((await recordJson(context, join(root, 'settings.json')))?.extraKnownMarketplaces)];
      const source = lists.map(list => record(record(list?.[marketplace])?.source)).find(Boolean);
      const live = source?.source === 'directory' && text(source.path) ? await folderItem(context, text(source.path), plugin) : undefined;
      if (live?.folder && (await hasFiles(live.folder))) return { state: 'installed', path: live.folder, live: true, ...(live.version ? { version: live.version } : {}) };
      return (await hasFiles(path)) ? { state: 'installed', path, version: await copyVersion(user?.version, path) } : { state: 'not-known', reason: 'Claude Code lists it, but its files are not where it records them.' };
    }
    case 'copilot-cli': {
      const settingsOf = () => recordJson(context, join(root, 'settings.json'));
      const listed = (await recordJson(context, join(root, 'config.json')))?.installedPlugins;
      const listing = (Array.isArray(listed) ? listed : []).map(record).find(item => item?.name === plugin && item.marketplace === marketplace);
      const cache = text(listing?.cache_path);
      if (cache) return (await hasFiles(cache)) ? installedCopy(cache, entry, { live: false, version: await copyVersion(listing?.version, cache), readAs: { skillsListReplaces: true } }, async skills => copilotSkillsOff(await settingsOf(), plugin, skills)) : { state: 'not-known', reason: 'Copilot CLI lists it, but its files are not where it records them.' };
      // A plugin from a local folder marketplace is loaded live from that folder: nothing is copied. Its only record is
      // enabledPlugins, true when installed. Copilot CLI's own uninstall of one only sets that to false ("disabled. It is
      // still on disk", exercised 1.0.108), the same as its disable, so false is not installed: installing again turns it on.
      const settings = await settingsOf();
      const enabled = record(settings?.enabledPlugins)?.[id] === true;
      const source = record(record(record(settings?.extraKnownMarketplaces)?.[marketplace])?.source);
      const folderPath = text(source?.path);
      if (enabled && source?.source === 'directory' && folderPath) {
        const item = await folderItem(context, folderPath, plugin);
        const folder = item?.folder;
        return folder && (await hasFiles(folder)) ? installedCopy(folder, item.entry ?? entry, { live: true, version: item.version, readAs: { skillsListReplaces: true } }, async skills => copilotSkillsOff(settings, plugin, skills)) : { state: 'not-known', reason: 'Copilot CLI lists it, but the folder it loads from is gone.' };
      }
      return { state: 'not-installed' };
    }
    case 'codex-cli': {
      const tables = await codexTables(context, root);
      if (!tables.plugins[id]) return { state: 'not-installed' };
      const cache = join(root, 'plugins/cache', marketplace, plugin);
      const version = activeCodexVersion(await readdir(cache).catch(() => [] as string[]));
      const folder = version && join(cache, version);
      if (folder && (await hasFiles(folder))) {
        // Codex names each copy's folder for its version; "local" (no version) and a commit prefix (its curated plugins)
        // name none, so the copy's manifest gives it (see copyVersion).
        const copy = await installedCopy(folder, entry, { live: false, version: await copyVersion(version === 'local' ? undefined : version, folder, true), readAs: { codex: await codexManifest(folder) } }, skills => codexSkillsOff(tables.skills, plugin, folder, skills));
        return tables.skillsInline ? { ...copy, switchesHeld: INLINE_SKILLS_CONFIG } : copy;
      }
      return { state: 'not-known', reason: 'Codex lists it, but its files are not in its plugin cache.' };
    }
  }
}


// ---------- Claude Code's Anthropic Directory ----------

/**
 * A plugin's repository and folder as Claude Code keys the Anthropic Directory: "github.com/owner/repo#path", the
 * repository in lowercase, the folder as written (its catalog has "…#HubSpot-Sales"): keys are compared ignoring case.
 * Undefined for an address that names no host (a local folder).
 */
export function repositoryKey(url: string, path = ''): string | undefined {
  const address = url.trim();
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(address);
  let where: string;
  if (scp) where = `${scp[1]}/${scp[2]}`;
  else {
    try { const parsed = new URL(address); if (!parsed.hostname) return undefined; where = `${parsed.hostname}${parsed.pathname}`; } catch { return undefined; }
  }
  const repo = where.replace(/\/+$/, '').replace(/\.git$/i, '');
  const folder = path.replace(/\\/g, '/').replace(/^(\.?\/)+/, '').replace(/\/+$/, '');
  return `${repo.toLowerCase()}#${folder}`;
}

/** A marketplace plugin's repository key: where its entry says it lives, or, kept in a Git marketplace, that repository and its folder there. */
function catalogKey(catalog: Catalog, item: CatalogPlugin): string | undefined {
  if (item.remote) return repositoryKey(item.remote.url, item.remote.path);
  if (catalog.kind !== 'git' || !catalog.root || !item.folder) return undefined;
  return repositoryKey(fetchUrl(catalog.source), relative(catalog.root, item.folder));
}

/**
 * Claude Code's copy of a marketplace plugin from the Anthropic Directory, if it has one: a user-scope install there
 * whose repository key is the plugin's. Claude Code counts the two as the same plugin and won't install it from the
 * marketplace too ("already installed from Anthropic Directory … Nothing to install", exit 0, 2.1.322), so it is
 * installed, from the directory. Its key is on the install record, or in plugin-directory-bindings.json.
 */
export async function fromDirectory(context: PluginContext, catalog: Catalog, item: CatalogPlugin): Promise<InstallState | undefined> {
  const key = catalogKey(catalog, item)?.toLowerCase();
  if (!key) return undefined;
  const root = configRootOf(context, 'claude-cli');
  const listed = record((await recordJson(context, join(root, 'plugins/installed_plugins.json')))?.plugins) ?? {};
  const bindings = record((await recordJson(context, join(root, 'plugins/plugin-directory-bindings.json')))?.bindings);
  for (const [id, entries] of Object.entries(listed)) {
    const names = idParts(id);
    if (names?.marketplace !== DIRECTORY) continue;
    const user = (Array.isArray(entries) ? entries : []).map(record).find(entry => entry?.scope === 'user');
    const bound = text(user?.directoryRepositoryKey) || text(record(bindings?.[id])?.repositoryKey);
    if (!user || bound.toLowerCase() !== key) continue;
    const state = await installState(context, 'claude-cli', DIRECTORY, names.plugin, item.entry);
    // Claude Code refuses the marketplace's copy while it lists the directory's, files or not: no Install to offer here.
    if (state.state !== 'installed') return { state: 'held', reason: `Claude Code lists it as ${id}, from the Anthropic Directory, but its files are not where it records them. Reinstall it in Claude Code (/plugin).` };
    // Claude Code records a directory copy's version as the release and the commit's first 12 digits: the release is the version.
    const sha = text(user.gitCommitSha);
    const version = state.version?.replace(/-([0-9a-f]{7,40})$/i, (whole, digits: string) => (sha && sha.toLowerCase().startsWith(digits.toLowerCase()) ? '' : whole));
    return { ...state, directory: id, ...(version ? { version } : {}) };
  }
  return undefined;
}

/** One plugin a tool has installed, as its own records say: its copy (installState), whether the whole plugin is off there, and its marketplace entry where the tool's copy of the marketplace is readable. */
export interface ToolPlugin { plugin: string; marketplace: string; state: InstallState; off: boolean; entry?: Record<string, unknown>; atMarketplaceRoot?: boolean }

/** plugin@marketplace as its two names, when both are names the tools accept (they become folder names below). */
function idParts(id: string): { plugin: string; marketplace: string } | undefined {
  const at = id.lastIndexOf('@');
  const plugin = id.slice(0, at), marketplace = id.slice(at + 1);
  return at > 0 && SAFE_NAME.test(plugin) && SAFE_NAME.test(marketplace) ? { plugin, marketplace } : undefined;
}

/**
 * Every plugin a tool has installed, whatever marketplace it came from (one added with the tool's own /plugin command counts
 * the same), read from files only. Claude Code: user-scope entries of installed_plugins.json, off when settings.json
 * enabledPlugins says false; its entry from the marketplace copy known_marketplaces.json names. Copilot CLI: config.json
 * installedPlugins (off: `enabled: false`), and plugins from a folder marketplace, which only settings.json enabledPlugins
 * records, true while installed (capability-data section 7). Codex: [plugins."ID"] tables, off with `enabled = false`.
 */
export async function installedPlugins(context: PluginContext, tool: PluginTool): Promise<ToolPlugin[]> {
  const root = configRootOf(context, tool);
  const settings = () => recordJson(context, join(root, 'settings.json'));
  const each = async (ids: string[], read: (names: { plugin: string; marketplace: string }, id: string) => Promise<ToolPlugin | undefined>) =>
    (await Promise.all([...new Set(ids)].map(id => { const names = idParts(id); return names ? read(names, id) : undefined; }))).filter((found): found is ToolPlugin => !!found);
  switch (tool) {
    case 'claude-cli': {
      const listed = record((await recordJson(context, join(root, 'plugins/installed_plugins.json')))?.plugins) ?? {};
      const known = await recordJson(context, join(root, 'plugins/known_marketplaces.json'));
      const enabled = record((await settings())?.enabledPlugins);
      const users = Object.keys(listed).filter(id => (Array.isArray(listed[id]) ? listed[id] as unknown[] : []).some(entry => record(entry)?.scope === 'user'));
      return each(users, async ({ plugin, marketplace }, id) => {
        const where = text(record(known?.[marketplace])?.installLocation) || text(record(record(known?.[marketplace])?.source)?.path);
        const item = where ? await folderItem(context, where, plugin) : undefined;
        return { plugin, marketplace, state: await installState(context, tool, marketplace, plugin, item?.entry), off: enabled?.[id] === false, entry: item?.entry, atMarketplaceRoot: item?.isMarketplaceRoot };
      });
    }
    case 'copilot-cli': {
      const listed = (await recordJson(context, join(root, 'config.json')))?.installedPlugins;
      const cached = (Array.isArray(listed) ? listed : []).map(record).filter((item): item is Record<string, unknown> => !!item && !!text(item.name) && !!text(item.marketplace));
      const found = await each(cached.map(item => `${text(item.name)}@${text(item.marketplace)}`), async ({ plugin, marketplace }) =>
        ({ plugin, marketplace, state: await installState(context, tool, marketplace, plugin), off: cached.some(item => item.name === plugin && item.marketplace === marketplace && item.enabled === false) }));
      // A folder marketplace's plugin is loaded live from that folder and recorded only in enabledPlugins: true while it is
      // installed (false is how Copilot CLI leaves one it uninstalled, see installState).
      const own = await settings();
      const turned = record(own?.enabledPlugins) ?? {};
      const live = Object.keys(turned).filter(id => turned[id] === true && !found.some(entry => `${entry.plugin}@${entry.marketplace}` === id));
      return [...found, ...await each(live, async ({ plugin, marketplace }, id) => {
        const source = record(record(record(own?.extraKnownMarketplaces)?.[marketplace])?.source);
        if (source?.source !== 'directory' || !text(source.path)) return undefined;
        const item = await folderItem(context, text(source.path), plugin);
        return { plugin, marketplace, state: await installState(context, tool, marketplace, plugin, item?.entry), off: false, entry: item?.entry, atMarketplaceRoot: item?.isMarketplaceRoot };
      })];
    }
    case 'codex-cli': {
      const tables = await codexTables(context, root);
      return each(Object.keys(tables.plugins), async ({ plugin, marketplace }, id) => ({ plugin, marketplace, state: await installState(context, tool, marketplace, plugin), off: tables.plugins[id]?.enabled === false }));
    }
  }
}

/** installedPlugins, read once per pass or view (`context.reads`). */
export const installedOnce = (context: PluginContext, tool: PluginTool): Promise<ToolPlugin[]> => once(context, `installed-plugins:${tool}`, () => installedPlugins(context, tool));

/** One installed plugin with what its copy holds, as that tool reads it; `contents` is missing where the copy isn't there or can't be read. */
export type InstalledCopyOf = ToolPlugin & { contents?: PluginContents; /** Its MCP servers and agents the tool has turned off one by one (partswitch.ts). */ serversOff?: string[]; agentsOff?: string[]; /** Its MCP servers whose switch can't be written here, each with why (Codex's settings in a form not edited). */ serversHeld?: Record<string, string> };

/** The file that holds a tool's switches for one item of a plugin: settings.json, or Codex's config.toml. */
const switchFileOf = (context: PluginContext, tool: PluginTool) => join(configRootOf(context, tool), tool === 'codex-cli' ? 'config.toml' : 'settings.json');

/** Of a plugin's MCP servers or agents (`names`), those the tool's switch file `text` turns off. A file that can't be read turns none off. */
function partsOffIn(tool: PluginTool, text: string, plugin: string, marketplace: string, kind: PartKind, names: string[]): string[] {
  try { return names.filter(name => partOff(tool, text, { plugin, marketplace, kind, name })); } catch { return []; }
}

/**
 * Each plugin a tool has installed with what its copy holds, read once per pass or view (`context.reads`): the Skills,
 * MCP servers and Agents pages' "Through a plugin" boxes and their "From plugins" rows both ask.
 */
export const installedCopies = (context: PluginContext, tool: PluginTool): Promise<InstalledCopyOf[]> => once(context, `installed-copies:${tool}`, async () => {
  const switches = (await readOrNull(switchFileOf(context, tool))) ?? '';
  return Promise.all((await installedOnce(context, tool)).map(async (found): Promise<InstalledCopyOf> => {
    const contents = found.state.state === 'installed' ? await installedContents(tool, found.state.path, found.entry, found.atMarketplaceRoot).catch(() => undefined) : undefined;
    const serversOff = partsOffIn(tool, switches, found.plugin, found.marketplace, 'mcp', (contents?.mcpServers ?? []).map(server => server.name));
    const agentsOff = partsOffIn(tool, switches, found.plugin, found.marketplace, 'agent', (contents?.agents ?? []).map(agent => agent.name));
    const serversHeld = Object.fromEntries(tool !== 'codex-cli' ? [] : (contents?.mcpServers ?? []).flatMap(({ name }) => { const why = serverHeld(switches, { plugin: found.plugin, marketplace: found.marketplace, kind: 'mcp', name }); return why ? [[name, why]] : []; }));
    return { ...found, contents, ...(serversOff.length ? { serversOff } : {}), ...(agentsOff.length ? { agentsOff } : {}), ...(Object.keys(serversHeld).length ? { serversHeld } : {}) };
  }));
});

/** One item a tool has through an installed plugin: a skill, an agent or an MCP server, with the plugin it comes through. */
export interface PluginPart extends ThroughPlugin { kind: PartKind; name: string; /** A skill's SKILL.md, to tell it from another skill of the same name. */ text?: string }

/**
 * What each of a tool's installed plugins gives it, by name: its skills in every tool, and its agents and MCP servers
 * where the tool loads a plugin's (Claude Code and Copilot CLI; Codex ignores a plugin's agents and may not start its
 * servers). With each, the plugin, the marketplace as the tool added it and the copy's version. For Claude Code, which
 * adds a marketplace entry's parts to the plugin's own, the entry is read from the marketplace's manifest where Claude
 * Code keeps it. `off`: the plugin, or that one skill, MCP server or agent, is turned off there.
 */
export async function pluginParts(context: PluginContext, tool: PluginTool): Promise<PluginPart[]> {
  const given: PluginPart[] = [];
  for (const { plugin, marketplace, off, state, contents, serversOff, agentsOff } of await installedCopies(context, tool)) {
    if (state.state !== 'installed' || !contents) continue;
    const source = await registeredSource(context, tool, marketplace);
    const from = { plugin, marketplace, ...(source ? { source } : {}), ...(state.version ? { version: state.version } : {}) };
    const add = (kind: PartKind, name: string, more: { off?: boolean; text?: string } = {}) => given.push({ kind, name, ...from, ...(off || more.off ? { off: true as const } : {}), ...(more.text === undefined ? {} : { text: more.text }) });
    for (const skill of contents.skills) add('skill', skill.name, { off: state.skillsOff?.some(entry => entry.skill === skill.name), text: skill.text });
    if (tool === 'codex-cli') continue;
    for (const agent of contents.agents) add('agent', agent.name, { off: agentsOff?.includes(agent.name) });
    for (const server of contents.mcpServers) add('mcp', server.name, { off: serversOff?.includes(server.name) });
  }
  return given;
}

/** What a tool has through a plugin, as the pages ask: `asParts`, the item is on record as that plugin's part in some tool; a skill comes with its SKILL.md. */
export type GivenByPlugin = ThroughPlugin & { asParts: boolean; text?: string };

/**
 * What each of `tools` has through its installed plugins, of one kind: by tool, then by the item's key on its page
 * (share.ts itemKey of its name). A name alone doesn't make two items one: the caller counts an item as the plugin's when it is
 * `asParts` (Central Knot installed it elsewhere as that plugin's part) or, for a skill, when its SKILL.md is the same.
 * A name two plugins hold goes by the one it is a part of, else the first listed. Read once where `home` carries `reads`
 * (one pass or one view), since the Skills, MCP servers and Agents pages all ask.
 */
export async function throughPlugins(home: { home: string; overrides?: Partial<Record<HarnessId, string>>; reads?: Map<string, Promise<unknown>> }, tools: HarnessId[], kind: PartKind): Promise<Map<HarnessId, Map<string, GivenByPlugin>>> {
  const context: PluginContext = { home: home.home, dataDir: '', binaries: {}, overrides: home.overrides, reads: home.reads ?? new Map() };
  const found = new Map<HarnessId, Map<string, GivenByPlugin>>();
  const installs = await once(context, 'plugin-parts-record', () => readParts(home.home));
  for (const tool of tools.filter(takesPlugins)) {
    // Records that can't be read give nothing: the tool then shows what its own folders hold, as before.
    const parts = await once(context, `plugin-parts:${tool}`, () => pluginParts(context, tool).catch((): PluginPart[] => []));
    const byKey = new Map<string, GivenByPlugin>();
    for (const { kind: partKind, name, ...plugin } of parts) {
      if (partKind !== kind) continue;
      const asParts = installs.some(install => install.plugin === plugin.plugin && (!plugin.source || sameSource(install.source, plugin.source)) && install.items.some(item => !item.removed && samePart(item, { kind, name })));
      const key = itemKey(name);
      if (!byKey.has(key) || (asParts && !byKey.get(key)!.asParts)) byKey.set(key, { ...plugin, name, asParts });
    }
    if (byKey.size) found.set(tool, byKey);
  }
  return found;
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

/** An installed copy in `folder` at `version`, with the skills it holds (read with its marketplace `entry`, as `readAs` says the tool reads it) and, of those, the ones `offs` says the tool has turned off. */
async function installedCopy(folder: string, entry: Record<string, unknown> | undefined, { live, version, readAs }: { live: boolean; version?: string; readAs: ReadAs }, offs: (skills: string[]) => Promise<SkillOff[]>): Promise<Extract<InstallState, { state: 'installed' }>> {
  const skills = await skillNamesIn(folder, entry, readAs);
  return { state: 'installed', path: folder, ...(live ? { live } : {}), ...(version ? { version } : {}), skills, skillsOff: await offs(skills) };
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
async function skillPickedBy(entry: CodexSkillSwitch, plugin: string, folder: string): Promise<string | undefined> {
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
  for (const entry of switches) { const skill = await skillPickedBy(entry, plugin, folder); if (skill && skills.includes(skill)) enabled.set(skill, entry.enabled); }
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
  const edit = switchesBack ? { text: last.before! } : await codexConfigSwitched(before ?? '', plugin, skill, on, folder);
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
async function codexConfigSwitched(text: string, plugin: string, skill: string, on: boolean, folder: string): Promise<{ text: string } | { problem: string }> {
  let read: ReturnType<typeof codexSkillSwitches>;
  try { read = codexSkillSwitches(readTomlTables(text)); } catch { return { problem: 'Codex’s config.toml couldn’t be read, so it was left as it is.' }; }
  const { switches, inline } = read;
  if (inline) return { problem: INLINE_SKILLS_CONFIG };
  const picks = new Set<number>();
  for (const entry of switches) if (entry.start !== undefined && (await skillPickedBy(entry, plugin, folder)) === skill) picks.add(entry.start);
  return { text: editTomlArray(text, ['skills', 'config'], block => picks.has(block.start), on ? undefined : { name: qualified(plugin, skill), enabled: false }) };
}

/**
 * Turns one skill of an installed plugin off (`on` false) or back on in one tool, with that tool's own switch, then reads
 * the switch again: only what the tool then records counts (Copilot CLI's commands exit 0 even on a name they don't know).
 * The plugin's files are never touched. A tool with no such switch, a skill the installed copy lacks, or one held off by a
 * switch that isn't this plugin's own fails with the reason, and nothing changes.
 */
export async function setSkill(context: PluginContext, marketplace: string, plugin: string, skill: string, tool: PluginTool, on: boolean, source: string, entry?: Record<string, unknown>): Promise<ActionReport> {
  const name = toolNames[tool];
  const outcome = on ? 'skill-on' : 'skill-off';
  const fail = (message: string, runs: NativeRun[] = []): ActionReport => ({ tool, outcome: 'failed', message, runs });
  // What can be known before reading the tool (no such switch, an unsafe name) fails at once; the copy is checked below.
  const blocked = noSwitchReason(tool, undefined, skill);
  if (blocked) return fail(blocked);
  const held = await heldBy(context, tool, marketplace, source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, marketplace, held), runs: [] };
  /** The skill in the installed copy as the tool's switch has it now: on or off, and why it is held off if it is. */
  const now = async () => {
    const state = await installState(context, tool, marketplace, plugin, entry);
    if (state.state !== 'installed') return undefined;
    const off = state.skillsOff?.find(candidate => candidate.skill === skill);
    return { path: state.path, skills: state.skills, on: !off, held: off?.held };
  };
  const before = await now();
  if (!before) return fail(`It isn’t installed in ${name} now.`);
  const missing = noSwitchReason(tool, before.skills, skill);
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

// ---------- One MCP server or agent of an installed plugin ----------

/**
 * Turns one MCP server or agent of an installed plugin off (`on` false) or back on in one tool, with that tool's own
 * switch (partswitch.ts), then reads the switch again: only what the tool's file then says counts. One checked write, only
 * over the text read. The plugin's files are never touched. A tool with no such switch, a plugin not installed there, a
 * part its copy lacks, or a switch file in a form not edited here fails with the reason, and nothing changes.
 */
export async function setPart(context: PluginContext, marketplace: string, plugin: string, part: { kind: PartKind; name: string }, tool: PluginTool, on: boolean, source: string): Promise<ActionReport> {
  const name = toolNames[tool];
  const outcome = on ? 'part-on' : 'part-off';
  const word = part.kind === 'mcp' ? 'MCP server' : part.kind;
  const fail = (message: string, runs: NativeRun[] = []): ActionReport => ({ tool, outcome: 'failed', message, runs });
  if (!hasPartSwitch(tool, part.kind)) return fail(`${name} has no switch for one ${word} of a plugin.`);
  const held = await heldBy(context, tool, marketplace, source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, marketplace, held), runs: [] };
  // Read now, never from a view's shared reads.
  const copy = (await installedCopies({ ...context, reads: new Map() }, tool)).find(candidate => candidate.plugin === plugin && candidate.marketplace === marketplace);
  if (copy?.state.state !== 'installed') return fail(`It isn’t installed in ${name} now.`);
  if (copy.contents && !(part.kind === 'mcp' ? copy.contents.mcpServers : copy.contents.agents).some(candidate => candidate.name === part.name)) return fail(`The copy ${name} has installed has no ${word} named “${part.name}”.`);
  const path = switchFileOf(context, tool);
  const file = basename(path);
  const at = { plugin, marketplace, ...part };
  const before = await readOrNull(path);
  let after: string;
  try {
    if (partOff(tool, before ?? '', at) === !on) return { tool, outcome, message: `Already ${on ? 'on' : 'off'} in ${name}.`, runs: [] };
    after = withPartSwitch(tool, before ?? '', at, !on);
  } catch (error) { return fail(errorCode(error) === 'CK_FORM' && error instanceof Error ? error.message : `${name}’s ${file} couldn’t be read, so it was left as it is.`); }
  try { await writeFileChecked(path, after, before ?? undefined); }
  catch (error) { return fail(errorCode(error) === 'CK_CHANGED' ? `${name}’s ${file} changed just then, so it was left as it is. Try again.` : `${name}’s ${file} couldn’t be written: ${error instanceof Error ? error.message : String(error)}`); }
  const changed = [{ path, before, after }];
  const command = `${file}: ${word} ${part.name} of ${plugin}@${marketplace} turned ${on ? 'on' : 'off'}`;
  await keepRecord(context, tool, command, '', changed).catch(() => undefined);
  const took = partsOffIn(tool, (await readOrNull(path)) ?? '', plugin, marketplace, part.kind, [part.name]).length === (on ? 0 : 1);
  const run: NativeRun = { tool, command, ok: took, output: '', changed };
  if (!took) return fail(`Still ${on ? 'off' : 'on'} in ${name}: its ${file} did not take the change.`, [run]);
  return { tool, outcome, changed: true, message: `Turned ${on ? 'on' : 'off'} in ${name}. ${nextStepFor(tool, 'for this to take effect')}`.trim(), runs: [run] };
}

// ---------- A whole plugin turned off ----------

/** Codex's `[plugins."ID"]` table in its config.toml text, if it has one. */
const codexPluginTable = (toml: string, id: string) => readTomlTables(toml).find(table => !table.array && table.path.length === 2 && table.path[0] === 'plugins' && table.path[1] === id);

/** Whether a tool has the whole plugin turned off, read now from the records installedPlugins reads (never from a view's shared reads). */
async function wholeOff(context: PluginContext, tool: PluginTool, id: string): Promise<boolean> {
  const root = configRootOf(context, tool);
  switch (tool) {
    case 'claude-cli': return record((await readJson(join(root, 'settings.json')))?.enabledPlugins)?.[id] === false;
    case 'copilot-cli': {
      const listed = (await readJson(join(root, 'config.json')))?.installedPlugins;
      return (Array.isArray(listed) ? listed : []).map(record).some(item => `${text(item?.name)}@${text(item?.marketplace)}` === id && item?.enabled === false);
    }
    case 'codex-cli': {
      try { return codexPluginTable(await readFile(join(root, 'config.toml'), 'utf8'), id)?.entries.find(entry => entry.key === 'enabled')?.value === false; } catch { return false; }
    }
  }
}

/**
 * Turns a whole plugin off (or, `on`, back on) with the tool's own switch: Claude Code's and Copilot CLI's `plugin disable`
 * and `plugin enable`; Codex has no command for it, so its `[plugins."ID"]` table takes `enabled = false` or `true`
 * (capability-data section 8). Undefined where Codex has no such table to switch.
 */
async function switchWhole(context: PluginContext, tool: PluginTool, id: string, on = false): Promise<NativeRun | undefined> {
  if (tool !== 'codex-cli') return native(context, tool, ['plugin', on ? 'enable' : 'disable', id, ...(tool === 'claude-cli' ? ['--scope', 'user'] : [])]);
  const path = join(configRootOf(context, tool), 'config.toml');
  const command = `config.toml [plugins."${id}"] enabled = ${on}`;
  const before = await readOrNull(path);
  let table: ReturnType<typeof codexPluginTable>;
  try { table = codexPluginTable(before ?? '', id); } catch { table = undefined; }
  if (before === null || !table) return undefined;
  const line = table.entries.find(entry => entry.key === 'enabled');
  // An `enabled = …` line is replaced; otherwise one goes right after the table's last key (as an MCP server's switch does).
  const at = line ? line.start : table.entries.at(-1)?.end ?? (before.indexOf('\n', table.start) + 1 || before.length);
  const head = before.slice(0, at);
  const after = `${head}${head.endsWith('\n') || !head ? '' : '\n'}enabled = ${on}\n${before.slice(line ? line.end : at)}`;
  try { await writeFileChecked(path, after, before); } catch (error) { return { tool, command, ok: false, output: `Codex’s config.toml couldn’t be written: ${error instanceof Error ? error.message : String(error)}`, changed: [] }; }
  const changed = [{ path, before, after }];
  await keepRecord(context, tool, command, '', changed).catch(() => undefined);
  return { tool, command, ok: true, output: '', changed };
}

/**
 * Turns a whole installed plugin off (`on` false) or back on in one tool, with that tool's own switch (switchWhole), then
 * reads it again: only what the tool then records counts. Everything the plugin brings there goes with it. The plugin's
 * files are never touched.
 */
export async function setWhole(context: PluginContext, marketplace: string, plugin: string, tool: PluginTool, on: boolean, source: string): Promise<ActionReport> {
  const name = toolNames[tool];
  const outcome = on ? 'plugin-on' : 'plugin-off';
  const held = await heldBy(context, tool, marketplace, source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, marketplace, held), runs: [] };
  if ((await installState(context, tool, marketplace, plugin)).state !== 'installed') return { tool, outcome: 'failed', message: `It isn’t installed in ${name} now.`, runs: [] };
  const id = `${plugin}@${marketplace}`;
  if (!(await wholeOff(context, tool, id)) === on) return { tool, outcome, message: `Already ${on ? 'on' : 'off'} in ${name}.`, runs: [] };
  const run = await switchWhole(context, tool, id, on);
  if (!run) return { tool, outcome: 'failed', message: `Codex’s config.toml has no entry for ${id} to switch.`, runs: [] };
  if (!(await wholeOff(context, tool, id)) === on) return { tool, outcome, changed: true, message: `Turned ${on ? 'on' : 'off'} in ${name}. ${nextStepFor(tool, 'for this to take effect')}`.trim(), runs: [run] };
  return { tool, outcome: 'failed', message: `Still ${on ? 'off' : 'on'} in ${name}. ${lastLines(run.output)}`.trim(), runs: [run] };
}

// ---------- Install and uninstall ----------

/** Files a tool's plugin commands may change; their bytes are kept before and after each run (FIL-03). */
const touched = (context: PluginContext, tool: PluginTool): string[] => {
  const root = configRootOf(context, tool);
  switch (tool) {
    case 'claude-cli': return [join(root, 'settings.json'), join(root, 'plugins/installed_plugins.json'), join(root, 'plugins/known_marketplaces.json')];
    case 'copilot-cli': return [join(root, 'settings.json'), join(root, 'config.json')];
    case 'codex-cli': return [join(root, 'config.toml')];
  }
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
async function native(context: PluginContext, tool: PluginTool, args: string[]): Promise<NativeRun> {
  const binary = context.binaries[tool];
  const command = `${harnesses[tool].binary} ${args.join(' ')}`;
  if (!binary) return { tool, command, ok: false, output: noCli(tool), changed: [] };
  const files = touched(context, tool);
  const before = await Promise.all(files.map(readOrNull));
  const env: NodeJS.ProcessEnv = { ...gitEnv(), HOME: context.home, USERPROFILE: context.home, PATH: pathBeside(binary) };
  const override = context.overrides?.[tool];
  // Codex on Windows finds its home from the system, not HOME or USERPROFILE (seen with ChatGPT desktop's Codex 0.165), so
  // it is named outright. CODEX_HOME at the default root is what Codex reads anyway. CLAUDE_CONFIG_DIR is never set
  // this way, because it also moves .claude.json.
  if (override) env[harnesses[tool].configEnv] = override;
  else if (tool === 'codex-cli') env.CODEX_HOME = join(context.home, harnesses[tool].defaultConfig);
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

/** Each tool's own install and uninstall of plugin@marketplace (`id`). */
const installArgs = (tool: PluginTool, id: string) => ({ 'claude-cli': ['plugin', 'install', id, '--scope', 'user'], 'copilot-cli': ['plugin', 'install', id], 'codex-cli': ['plugin', 'add', id, '--json'] })[tool];
const uninstallArgs = (tool: PluginTool, id: string) => ({ 'claude-cli': ['plugin', 'uninstall', id, '--scope', 'user'], 'copilot-cli': ['plugin', 'uninstall', id], 'codex-cli': ['plugin', 'remove', id, '--json'] })[tool];

/**
 * Adds a marketplace to one tool's own list, with the tool's own command, unless it is there already: `there` (nothing ran),
 * `added`, `held` (the tool can't take it, or has a different marketplace under its name, which is never replaced) or
 * `failed`, each with words to show. Nothing is installed.
 */
export async function addMarketplace(context: PluginContext, catalog: Catalog, tool: PluginTool): Promise<{ outcome: 'there' | 'added' | 'held' | 'failed'; message: string; runs: NativeRun[] }> {
  const name = toolNames[tool];
  const refusal = tool === 'codex-cli' ? undefined : catalog.codexOnly ?? (tool === 'copilot-cli' ? catalog.copilotRefuses : undefined);
  if (refusal) return { outcome: 'held', message: `${refusal} Nothing was added to ${name}.`, runs: [] };
  const held = await heldBy(context, tool, catalog.name, catalog.source);
  if (held) return { outcome: 'held', message: heldReason(tool, catalog.name, held), runs: [] };
  if (await registeredSource(context, tool, catalog.name)) return { outcome: 'there', message: `Already in ${name}’s own plugin list.`, runs: [] };
  // Codex's CLI won't add a marketplace to a home whose .codex folder doesn't exist yet (a fresh Practice copy).
  if (tool === 'codex-cli') await mkdir(configRootOf(context, tool), { recursive: true });
  // The tool's own add fetches a Git marketplace and fails silently, so this computer's access is checked first.
  const access = catalog.kind === 'git' && context.binaries[tool] ? await checkAccess(context, catalog.source) : undefined;
  if (access && access.state !== 'ok') return { outcome: 'failed', message: `${access.message} Nothing was added to ${name}.`, runs: [] };
  const add = await native(context, tool, ['plugin', 'marketplace', 'add', catalog.source]);
  // Only the tool's own record counts: a command that said it worked and listed nothing did not add it.
  if (add.ok && (await registeredSource(context, tool, catalog.name))) return { outcome: 'added', message: `Added to ${name}’s own plugin list.`, runs: [add] };
  return { outcome: 'failed', message: `Could not add the marketplace${add.ok ? `: ${name} doesn’t list it` : ''}. ${lastLines(add.output)}`.trim(), runs: [add] };
}

/** Installs one plugin into one tool: adds the marketplace there if needed (never replacing a different one of the same name), installs, then reads the tool's record. */
export async function install(context: PluginContext, catalog: Catalog, plugin: string, tool: PluginTool): Promise<ActionReport> {
  const name = toolNames[tool];
  // Claude Code won't install a plugin it has from the Anthropic Directory again from a marketplace: it already has it.
  const item = tool === 'claude-cli' ? catalog.plugins.find(candidate => candidate.name === plugin) : undefined;
  const directory = item ? await fromDirectory(context, catalog, item) : undefined;
  if (directory?.state === 'installed') return { tool, outcome: 'installed', message: `Already installed in ${name}, from the Anthropic Directory.`, runs: [] };
  if (directory?.state === 'held') return { tool, outcome: 'held', message: directory.reason, runs: [] };
  // Held first: a same-named plugin installed from the other marketplace is not this one "already installed".
  const listed = await addMarketplace(context, catalog, tool);
  const runs = listed.runs;
  if (listed.outcome === 'held' || listed.outcome === 'failed') return { tool, outcome: listed.outcome, message: listed.message, runs };
  const registered = listed.outcome === 'there';
  if (registered) {
    const already = await installState(context, tool, catalog.name, plugin);
    if (already.state === 'installed') return { tool, outcome: 'installed', message: `Already installed in ${name}.`, runs };
  }
  const id = `${plugin}@${catalog.name}`;
  const installed = await native(context, tool, installArgs(tool, id));
  runs.push(installed);
  const state = await installState(context, tool, catalog.name, plugin);
  if (state.state === 'installed') return { tool, outcome: 'installed', changed: true, message: `${installed.ok ? 'Installed' : 'The command reported a problem, but it is installed'}${state.live ? ', loaded live from the marketplace folder' : ''}. ${nextStepFor(tool)}`.trim(), runs };
  if (state.state === 'not-known') return { tool, outcome: 'not-known', message: state.reason, runs };
  // A marketplace the tool already had is used as the tool last fetched it, which may predate what this page shows.
  // A tool that says it has the same plugin from elsewhere has it: an older copy of this marketplace isn't why.
  const older = registered && !/already installed from/i.test(installed.output) ? ` ${name} uses its own copy of this marketplace, which may be older than the one shown here: update it in ${name}, then try again.` : '';
  return { tool, outcome: 'failed', message: `Not installed. ${lastLines(installed.output)}${older}`.trim(), runs };
}

/**
 * Updates an installed plugin through the tool's own commands, then reads its record: only the version it then records
 * counts. A Git marketplace's copy in the tool is refreshed first, since each tool installs from its own copy. Routes,
 * as run on Claude Code 2.1.311, Copilot CLI 1.0.105 and Codex 0.142.3: Claude Code `plugin marketplace update M`, then
 * `plugin update P@M --scope user` (without the refresh it says it is already at the latest); Copilot CLI `plugin
 * marketplace update M`, then `plugin update P@M`; Codex `plugin marketplace upgrade M` (which moves the installed copy
 * on its own), then `plugin add P@M` again, which for a folder marketplace is what takes the new files. An update is
 * never undone: the tools keep no way back to the earlier copy.
 *
 * `differs` says whether the tool's installed copy differs in content from the marketplace's (pluginstatus.copyDiffers).
 * A copy at the marketplace's version that differs is updated by the same route, and where the tool keeps its copy then
 * (it is at the latest version, as far as it knows), uninstalled and installed again; only a copy that no longer differs
 * counts, and the report says which route did it (`byContent`). With `reinstall` false (an update nobody is watching)
 * that second route is not taken: an uninstall whose install then failed would leave the tool without the plugin.
 *
 * A plugin its person turned off in the tool is still off afterwards: where the tool's own commands turned it on, it is
 * turned off again with the tool's own switch (switchWhole), and the report says so if that didn't hold.
 */
export async function update(context: PluginContext, catalog: Catalog, plugin: string, tool: PluginTool, differs?: () => Promise<boolean>, options: { reinstall?: boolean } = {}): Promise<ActionReport> {
  const held = await heldBy(context, tool, catalog.name, catalog.source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, catalog.name, held), runs: [] };
  // Codex keeps a plugin's server switches under the plugin's own table, which its uninstall takes out whole: an update
  // that reinstalls would turn those servers back on, so the ones that were off are turned off again.
  const copyNow = async () => (await installedCopies({ ...context, reads: new Map() }, tool)).find(copy => copy.plugin === plugin && copy.marketplace === catalog.name);
  const serversOff = tool === 'codex-cli' ? (await copyNow())?.serversOff ?? [] : [];
  const report = await updateKeptOff(context, catalog, plugin, tool, differs, options);
  if (!serversOff.length || !report.runs.length) return report;
  const after = await copyNow();
  const lost = serversOff.filter(server => after?.contents?.mcpServers.some(candidate => candidate.name === server) && !after.serversOff?.includes(server));
  for (const server of lost) {
    const again = await setPart(context, catalog.name, plugin, { kind: 'mcp', name: server }, tool, false, catalog.source);
    report.runs.push(...again.runs);
    if (again.outcome !== 'part-off') report.notes = [...(report.notes ?? []), `Its MCP server ${server} was off in ${toolNames[tool]}, and the update turned it on. It couldn’t be turned off again: ${again.message}`];
  }
  return report;
}

/** update, with the whole plugin's own switch kept: one that was off is off after, turned off again where the tool's update turned it on. */
async function updateKeptOff(context: PluginContext, catalog: Catalog, plugin: string, tool: PluginTool, differs: (() => Promise<boolean>) | undefined, { reinstall = true }: { reinstall?: boolean }): Promise<ActionReport> {
  const name = toolNames[tool];
  const id = `${plugin}@${catalog.name}`;
  const wasOff = await wholeOff(context, tool, id);
  const report = await ownUpdate(context, catalog, plugin, tool, differs, { reinstall, next: wasOff ? `It is still off in ${name}.` : nextStepFor(tool) });
  if (!wasOff || !report.runs.length || (await installState(context, tool, catalog.name, plugin)).state !== 'installed' || (await wholeOff(context, tool, id))) return report;
  const switched = await switchWhole(context, tool, id);
  if (switched) report.runs.push(switched);
  if (await wholeOff(context, tool, id)) return report;
  return { ...report, message: report.message.replace(`It is still off in ${name}.`, '').trim(), notes: [...(report.notes ?? []), `It was off in ${name}, and the update turned it on. It couldn’t be turned off again: turn it off in ${name}. ${lastLines(switched?.output ?? '')}`.trim()] };
}

/** The update itself (see update): `next` is what the report says after a change, in place of how to start using it. */
async function ownUpdate(context: PluginContext, catalog: Catalog, plugin: string, tool: PluginTool, differs: (() => Promise<boolean>) | undefined, { reinstall, next }: { reinstall: boolean; next: string }): Promise<ActionReport> {
  const name = toolNames[tool];
  const before = await installState(context, tool, catalog.name, plugin);
  if (before.state !== 'installed') return { tool, outcome: 'failed', message: `It isn’t installed in ${name} now.`, runs: [] };
  const offered = catalog.plugins.find(item => item.name === plugin)?.version;
  const current = (version?: string) => !!version && !!offered && compareVersions(version, offered) >= 0;
  // The marketplace's version (or no version known on one side), so only the content can be behind.
  const contentOnly = !!differs && !before.live && !(before.version && offered && compareVersions(before.version, offered) !== 0) && (await differs());
  if (before.live || (current(before.version) && !contentOnly)) return { tool, outcome: 'updated', version: before.version, message: `Already up to date in ${name}.`, runs: [] };
  const runs: NativeRun[] = [];
  if (catalog.kind === 'git' && (await registeredSource(context, tool, catalog.name))) {
    const refresh = await native(context, tool, ['plugin', 'marketplace', tool === 'codex-cli' ? 'upgrade' : 'update', catalog.name]);
    runs.push(refresh);
    if (!refresh.ok) return { tool, outcome: 'failed', message: `Could not refresh ${name}’s copy of the marketplace, so nothing was updated. ${lastLines(refresh.output)}`.trim(), runs };
  }
  const id = `${plugin}@${catalog.name}`;
  const args = { 'claude-cli': ['plugin', 'update', id, '--scope', 'user'], 'copilot-cli': ['plugin', 'update', id], 'codex-cli': ['plugin', 'add', id, '--json'] }[tool];
  const updated = await native(context, tool, args);
  runs.push(updated);
  const after = await installState(context, tool, catalog.name, plugin);
  if (after.state !== 'installed') return { tool, outcome: 'failed', message: `It is no longer installed in ${name}. ${lastLines(updated.output)}`.trim(), runs };
  if (contentOnly) return contentUpdate(context, catalog, plugin, tool, differs!, runs, lastLines(updated.output), { reinstall, next });
  const moved = after.version !== before.version || after.path !== before.path;
  if (moved && (current(after.version) || !offered)) return { tool, outcome: 'updated', changed: true, version: after.version, message: `Updated${after.version ? ` to ${after.version}` : ''}. ${next}`.trim(), runs };
  return { tool, outcome: 'failed', message: `Still ${after.version ?? 'the earlier copy'} in ${name}${offered ? `; the marketplace has ${offered}` : ''}. ${lastLines(updated.output)}`.trim(), runs };
}

/**
 * The rest of an update for a copy whose content differs at the same version, after the tool's own update ran (`runs`,
 * whose last words were `said`): done if the copy now matches the marketplace's; otherwise the tool kept its copy, so it
 * is uninstalled and installed again, and checked once more.
 */
async function contentUpdate(context: PluginContext, catalog: Catalog, plugin: string, tool: PluginTool, differs: () => Promise<boolean>, runs: NativeRun[], said: string, { reinstall, next }: { reinstall: boolean; next: string }): Promise<ActionReport> {
  const name = toolNames[tool];
  const done = async (byContent: 'update' | 'reinstall'): Promise<ActionReport> => {
    const state = await installState(context, tool, catalog.name, plugin);
    const version = state.state === 'installed' ? state.version : undefined;
    const copy = `the marketplace’s copy${version ? ` of ${version}` : ''}`;
    const how = byContent === 'update' ? `Updated to ${copy}.` : `Reinstalled from ${copy}: ${name}’s own update kept the copy it had.`;
    return { tool, outcome: 'updated', changed: true, version, byContent, message: `${how} ${next}`.trim(), runs };
  };
  if (!(await differs())) return done('update');
  if (!reinstall) return { tool, outcome: 'failed', kept: true, message: `${name}’s own update kept the copy it had, which still differs from the marketplace’s. Update it on its page to reinstall it. ${said}`.trim(), runs };
  const id = `${plugin}@${catalog.name}`;
  const removed = await native(context, tool, uninstallArgs(tool, id));
  runs.push(removed);
  if ((await installState(context, tool, catalog.name, plugin)).state === 'installed') return { tool, outcome: 'failed', message: `Still differs from the marketplace’s copy in ${name}, and it couldn’t be reinstalled: ${lastLines(removed.output) || said}`.trim(), runs };
  const added = await native(context, tool, installArgs(tool, id));
  runs.push(added);
  if ((await installState(context, tool, catalog.name, plugin)).state !== 'installed') return { tool, outcome: 'failed', message: `Uninstalled from ${name} to reinstall it, but it isn’t installed again. Install it again from this page. ${lastLines(added.output)}`.trim(), runs };
  if (!(await differs())) return done('reinstall');
  return { tool, outcome: 'failed', message: `Reinstalled, but ${name}’s copy still differs from the marketplace’s. ${lastLines(added.output)}`.trim(), runs };
}

/** Uninstalls through the tool's own command and reads its record again. The marketplace stays added there. */
export async function uninstall(context: PluginContext, marketplace: string, plugin: string, tool: PluginTool, source: string): Promise<ActionReport> {
  const name = toolNames[tool];
  const held = await heldBy(context, tool, marketplace, source);
  if (held) return { tool, outcome: 'held', message: heldReason(tool, marketplace, held), runs: [] };
  const before = await installState(context, tool, marketplace, plugin);
  if (before.state === 'not-installed') return { tool, outcome: 'uninstalled', message: `Not installed in ${name}.`, runs: [] };
  const id = `${plugin}@${marketplace}`;
  const removed = await native(context, tool, uninstallArgs(tool, id));
  const state = await installState(context, tool, marketplace, plugin);
  if (state.state === 'not-installed') return { tool, outcome: 'uninstalled', changed: true, message: `Uninstalled from ${name}. The marketplace stays added there.${before.state === 'installed' && before.live ? ' Its folder is the marketplace’s own and stays.' : ''}`, runs: [removed] };
  return { tool, outcome: 'failed', message: `Still installed. ${lastLines(removed.output)}`.trim(), runs: [removed] };
}


/** The end of a tool's own message, shown as it is. */
const lastLines = (output: string) => output.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 400);

/** What to do for a change to reach the tool: `purpose` says what for ("to use it"). */
const nextStepFor = (tool: PluginTool, purpose = 'to use it'): string => ({
  // Said for either route: the change may have gone in through the CLI or through the desktop app's own copy.
  'claude-cli': `Start a new Claude Code session (CLI or Claude desktop’s Code tab), or run /reload-plugins, ${purpose}.`,
  'copilot-cli': `Start a new Copilot session (CLI or the GitHub Copilot app) ${purpose}.`,
  'codex-cli': `Start a new Codex session ${purpose}; restart the ChatGPT desktop app if it is open.`,
})[tool];

