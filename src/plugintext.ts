// The plugin text (MAP.md, "Plugins"): the names, descriptions and first lines of the skills, agents and MCP servers in the
// plugins of the marketplaces listed here, kept for Find to search plugins that are not installed. A job of its own in the main
// process, outside the queue, that reads text and nothing more: nothing fetched is installed or run, and nothing is written to
// a home or a tool, only this build's plugin-text.json (writeDurably).
// - A plugin kept in its marketplace: its catalog's own read (plugins.ts parseCatalog `keepContents`), at every run.
// - A plugin kept in another repository (catalogdetail.ts remoteOf): at its pinned commit (unpinned: its ref's tip, once a day),
//   the tree with no contents, then only the files the app's reader names (catalogdetail.ts searchedParts), in a bare repository
//   made for that one fetch and deleted after (fetchRepository). One fetch per repository and commit serves all its plugins.
// A run (pluginTextJob run): the listed marketplaces' catalogs as their copies on disk say; what is gone dropped (settle); what is
// outstanding fetched eight at a time while the switch is on (off, a run only matches the file to the listing), each fetch begun
// only while still wanted and its result checked against the listing again before it is kept and saved (keep). The text is one
// home's at a time: a home switch drops what the new home doesn't list, read again on return.
// Not here: which marketplaces are listed (marketplaces.ts listings, and its look, which reports each new listing), how Git runs
// (plugins.ts runGit), the switch (main.ts AppSettings pluginText) and its row on Settings (settingspage.ts pluginTextRow).
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative } from 'node:path';
import { searchedFile, searchedParts } from './catalogdetail.ts';
import { catalogFolder, eachLimited, parseCatalog, runGit, sameSource, sourceKey, whyGitFailed, type RunOptions } from './plugins.ts';
import { errorCode, writeDurably } from './share.ts';
import { isFolder, record } from './values.ts';
import type { CatalogPlugin, PluginContents, PluginTextView } from './types.ts';

/** One item of a plugin, as kept. */
export interface PluginTextItem {
  kind: 'skill' | 'agent' | 'mcp';
  name: string;
  description: string;
  /** The first 1,000 characters of its file; a server's, of its entry as JSON. */
  start: string;
  /** A server's command or address. */
  runs?: string;
  /** A skill's folder or an agent's file, inside the plugin. */
  path?: string;
}
/** One plugin's text, kept by its marketplace's canonical source and its name (textKey). */
export interface PluginText {
  /** Its marketplace, as listed. */
  source: string;
  marketName: string;
  plugin: string;
  /** Kept elsewhere: what chose its files (fromOf). One that is not its plugin's now (its pin moved, the new read not landed) is still given, not counted as read. */
  from?: string;
  /** The commit its text was read at, for a plugin kept in another repository. */
  commit?: string;
  /** Kept elsewhere: when its text was fetched (an unpinned plugin is fetched again a day after). Kept in its marketplace: when its text last changed in the catalog's read. */
  readAt: string;
  items: PluginTextItem[];
}

const FORMAT = 1;
const START_CHARS = 1000;
const AT_ONCE = 8;
const DAY_MS = 24 * 60 * 60_000;
/** A repository that could not be read waits this long before it is tried again, doubling each time, up to a day. */
const RETRY_MS = 10 * 60_000;
/**
 * What bounds a read, so that it can neither slow nor fill the app: only a server that has said it filters is fetched from, and
 * then only one commit's tree and the chosen files; per plugin at most MOST_ENTRIES entries are looked at and MOST_FILES files
 * chosen; a git command's output (the blobs read) is kept up to MOST_READ; each git command stops at GIT_MS.
 */
const MOST_ENTRIES = 20_000, MOST_FILES = 2_000, MOST_READ = 32 * 1024 * 1024, GIT_MS = 60_000;
/** What a server says it can do, in a packet Git received (its trace names the program that received it): v2's `fetch=` values, or v0's list after the first ref's NUL. */
const CAPABILITIES = /^.*packet:\s+\S+< (?:fetch=(.*)|[0-9a-f]{40,64} \S+\\0(.*))$/m;
/** The files a plugin's own lists are in: fetched first, with the links, since they name the rest. */
const MANIFESTS = ['.claude-plugin/plugin.json', '.mcp.json'];

const textKey = (source: string, plugin: string) => `${sourceKey(source)}\u0000${plugin}`;
type Remote = NonNullable<CatalogPlugin['remote']>;
/** One fetch per repository and pin (unpinned: per ref), shared by the plugins in it. */
const fetchKey = ({ url, sha, ref }: Remote) => `${url}\u0000${sha ?? `@${ref ?? ''}`}`;
/** What chooses a plugin's files in its repository: the repository, folder, ref and pin, and the lists its marketplace entry gives. */
const fromOf = (remote: Remote, entry: Record<string, unknown>) =>
  JSON.stringify([remote.url, remote.path, remote.ref ?? '', remote.sha ?? '', entry.skills ?? null, entry.agents ?? null, entry.mcpServers ?? null]);

/** A plugin's items as kept, from what the reader found. */
const itemsOf = (parts: Pick<PluginContents, 'skills' | 'agents' | 'mcpServers'>): PluginTextItem[] => [
  ...parts.skills.map(part => ({ kind: 'skill' as const, name: part.name, description: part.description, start: part.text.slice(0, START_CHARS), path: part.path })),
  ...parts.agents.map(part => ({ kind: 'agent' as const, name: part.name, description: part.description, start: part.text.slice(0, START_CHARS), path: part.path })),
  ...parts.mcpServers.map(server => ({ kind: 'mcp' as const, name: server.name, description: '', start: server.entry.slice(0, START_CHARS), runs: server.runs })),
];

// ---------- What the listed marketplaces hold ----------

/** A plugin of a listed marketplace that can be read: kept in its marketplace (`items`, read with its catalog) or in another repository (`remote`). */
interface Wanted { key: string; source: string; marketName: string; plugin: string; items?: PluginTextItem[]; remote?: Remote; entry?: Record<string, unknown>; from?: string }
/** The marketplaces listed in the open home (marketplaces.ts listings), and whether every list they come from could be read. */
export interface Listed { sources: string[]; complete: boolean }
/**
 * The listed marketplaces (`markets`) and those whose catalog was read (by sourceKey), the Git ones with no copy here yet (`absent`),
 * each plugin of those read that can be read (by textKey), and whether the listing was read whole.
 */
interface Listing { markets: Set<string>; read: Set<string>; absent: string[]; wanted: Map<string, Wanted>; complete: boolean }

/** The listed marketplaces' catalogs, as their copies on disk say: a Git marketplace not fetched yet is not read. */
async function readListing(dataDir: string, { sources, complete }: Listed): Promise<Listing> {
  const listing: Listing = { markets: new Set(sources.map(sourceKey)), read: new Set(), absent: [], wanted: new Map(), complete };
  for (const source of sources) {
    const folder = isFolder(source), root = folder ? source : catalogFolder({ dataDir }, source);
    if (!existsSync(root)) listing.absent.push(source);
    const catalog = await parseCatalog(root, source, folder ? 'folder' : 'git', { keepContents: true }).catch(() => undefined);
    if (!catalog || catalog.problem) continue;
    listing.read.add(sourceKey(source));
    for (const plugin of catalog.plugins) {
      const key = textKey(source, plugin.name), named = { key, source, marketName: catalog.name, plugin: plugin.name };
      // Its `source` names the repository, not a path in it (as marketplaces.ts locate reads it).
      const { source: _where, ...entry } = plugin.entry ?? {};
      if (plugin.folder && plugin.contents) listing.wanted.set(key, { ...named, items: itemsOf(plugin.contents) });
      else if (!plugin.folder && plugin.remote) listing.wanted.set(key, { ...named, remote: plugin.remote, entry, from: fromOf(plugin.remote, entry) });
    }
  }
  return listing;
}

// ---------- One repository, as text ----------

/** One fetch: a repository at a pinned commit, or at its ref's tip (`at`), and its plugins. */
interface Fetch { key: string; url: string; at: string; plugins: Wanted[] }
/** What a fetch gave: the commit, and each plugin's items by textKey, with what could not be read; or why nothing could. */
type Fetched = { commit: string; items: Map<string, PluginTextItem[]>; problems: string[] } | { problem: string };
/** A plugin's folder at that commit: each blob by its path in the folder, which of them are links, and where it is laid out on disk. */
interface Laid { want: Wanted; folder: string; blobs: Map<string, string>; links: Set<string> }
/** Git run in the repository being read, stopped by the fetch's signal, its output kept up to MOST_READ. */
type InRepo = (args: string[], options?: RunOptions) => ReturnType<typeof runGit>;

/** `git cat-file --batch` output (`<id> blob <size>`, the bytes, a newline; `<id> missing`) as each blob's bytes by id. */
function blobsFrom(out: Buffer): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  for (let at = 0; at < out.length;) {
    const end = out.indexOf(10, at);
    if (end < 0) break;
    const [id, , size] = out.subarray(at, end).toString('latin1').split(' ');
    if (size === undefined) { at = end + 1; continue; }
    blobs.set(id!, out.subarray(end + 1, end + 1 + Number(size)));
    at = end + 2 + Number(size);
  }
  return blobs;
}

/**
 * Whether a repository's server filters what it sends, asked before anything is fetched from it (one that declines a filtered
 * fetch sends the whole commit instead): its capabilities, through `ls-remote` with Git's packet trace on. True only when the
 * probe ended well and received the capability `filter` itself; else why not, and nothing is fetched (that waits like any failure).
 */
async function filters(url: string, signal: AbortSignal): Promise<true | string> {
  const asked = await runGit(['ls-remote', '--', url, 'HEAD'], GIT_MS, { signal, env: { GIT_TRACE_PACKET: '1' } });
  const said = asked.code === 0 ? CAPABILITIES.exec(asked.output) : null;
  if (said) return (said[1] ?? said[2]!).trim().split(/\s+/).includes('filter') || 'its server declines a filtered fetch, and a whole copy is never taken.';
  return asked.code === 0 ? 'its server did not say what it can send.' : whyGitFailed(asked.code, asked.output.split('\n').filter(line => !line.includes('packet:')).join('\n'), 'repository');
}

/** A plugin's folder at `commit`, listed (no contents yet), to be laid out in `folder`; or why it can't be. Submodules are skipped. */
async function listFolder(git: InRepo, commit: string, want: Wanted, folder: string): Promise<Laid | string> {
  const path = want.remote!.path.replace(/\/+$/, ''), prefix = path ? `${path}/` : '';
  const listed = await git(['ls-tree', '-r', '-z', commit, ...(path ? ['--', path] : [])]);
  const entries = listed.stdout.toString('utf8').split('\0').filter(Boolean);
  if (entries.length > MOST_ENTRIES) return `${want.plugin}: more than ${MOST_ENTRIES} files.`;
  const laid: Laid = { want, folder, blobs: new Map(), links: new Set() };
  for (const line of entries) {
    const tab = line.indexOf('\t'), [mode, type, id] = line.slice(0, tab).split(' '), name = line.slice(tab + 1);
    if (type !== 'blob' || !name.startsWith(prefix)) continue;
    laid.blobs.set(name.slice(prefix.length), id!);
    if (mode === '120000') laid.links.add(name.slice(prefix.length));
  }
  // Nothing under it (absent, or a file of that name): no folder there.
  return listed.code === 0 && laid.blobs.size ? laid : `${want.plugin}: its folder is not in the repository at that commit.`;
}

/**
 * The folder laid out for the reader's first pass: an empty stand-in for each file it may name (searchedFile), every file fetched
 * already with its text (`first`: the manifests, and what a linked manifest leads to), and its links, made last, so that no
 * file is written through one.
 */
async function layOut(laid: Laid, first: Map<string, Buffer>) {
  for (const [name, id] of laid.blobs) if (!laid.links.has(name) && (searchedFile(name) || first.has(id))) await put(join(laid.folder, name), first.get(id) ?? '');
  for (const name of laid.links) await mkdir(dirname(join(laid.folder, name)), { recursive: true }).then(() => symlink(first.get(laid.blobs.get(name)!)?.toString('utf8') ?? '', join(laid.folder, name))).catch(() => undefined);
  await mkdir(laid.folder, { recursive: true });
}

/** A path in the plugin's folder as the tree lists it, through the folder's own links (their targets from `first`); undefined where it leaves the folder or names no file. */
function inTree(laid: Laid, first: Map<string, Buffer>, path: string, hops = 0): string | undefined {
  const parts = posix.normalize(path).split('/');
  for (let at = 1; at <= parts.length; at++) {
    const head = parts.slice(0, at).join('/');
    if (!laid.links.has(head)) continue;
    const target = first.get(laid.blobs.get(head)!)?.toString('utf8');
    return target && !target.startsWith('/') && hops < 8 ? inTree(laid, first, posix.join(posix.dirname(head), target, ...parts.slice(at)), hops + 1) : undefined;
  }
  return laid.blobs.has(parts.join('/')) ? parts.join('/') : undefined;
}

/** The files the reader names in the laid-out folder (skills', agents', and each server file its manifest names, whatever the suffix), by tree path and blob (inTree). */
async function chooseFiles(laid: Laid, first: Map<string, Buffer>): Promise<Map<string, string> | string> {
  const named = await searchedParts(laid.folder, laid.want.entry ?? {}, laid.folder);
  const files = [...named.skills.map(part => join(part.path, 'SKILL.md')), ...named.agents.map(part => part.path), ...named.serverFiles.map(file => relative(laid.folder, file))];
  if (files.length > MOST_FILES) return `${laid.want.plugin}: more than ${MOST_FILES} files to read.`;
  const chosen = new Map<string, string>();
  for (const file of files) {
    const name = inTree(laid, first, file), id = name && laid.blobs.get(name);
    if (id && !first.has(id)) chosen.set(name, id);
  }
  return chosen;
}

/** A fetched file written at its path in the tree, only through real folders: never through a link, whatever the case of its name. */
async function putInside(folder: string, name: string, bytes: Buffer) {
  const parts = name.split('/'), file = parts.pop()!;
  let at = folder;
  for (const part of parts) {
    const seen = await lstat(at = join(at, part)).catch(() => undefined);
    if (seen && !seen.isDirectory()) return;
    if (!seen) await mkdir(at);
  }
  const seen = await lstat(join(at, file)).catch(() => undefined);
  if (!seen || seen.isFile()) await writeFile(join(at, file), bytes);
}

/**
 * One repository read as text, in a bare repository made for it in `stage` and deleted after: if its server says it filters, the
 * tree at `at` with no contents; each plugin's folder listed (listFolder); its manifests and links fetched and laid out (layOut);
 * the files the reader names fetched (chooseFiles) and written in (putInside); the reader's items. Stopped by `signal`.
 */
async function fetchRepository(fetch: Fetch, stage: string, signal: AbortSignal): Promise<Fetched> {
  const dir = join(stage, randomUUID()), repo = join(dir, 'git');
  const git: InRepo = (args, options = {}) => runGit(['--literal-pathspecs', '-C', repo, ...args], GIT_MS, { signal, maxBytes: MOST_READ, ...options });
  const failed = (step: { code: number | 'timeout' | 'missing'; output: string }) => new Error(whyGitFailed(step.code, step.output, 'repository'));
  const get = ['fetch', '--quiet', '--no-tags', '--recurse-submodules=no', '--filter=blob:none'];
  /** These blobs' bytes: fetched in one request, then read in one go. */
  const blobs = async (ids: string[]) => {
    if (!ids.length) return new Map<string, Buffer>();
    const input = `${[...new Set(ids)].join('\n')}\n`, fetched = await git([...get, '--stdin', 'origin'], { input });
    if (fetched.code !== 0) throw failed(fetched);
    const read = await git(['cat-file', '--batch'], { input });
    if (read.code !== 0) throw failed(read);
    return blobsFrom(read.stdout);
  };
  try {
    const filtering = await filters(fetch.url, signal);
    if (filtering !== true) return { problem: filtering };
    await mkdir(dir, { recursive: true });
    for (const args of [['init', '-q', '--bare', repo], ['-C', repo, 'remote', 'add', 'origin', fetch.url]]) {
      const made = await runGit(args, GIT_MS, { signal });
      if (made.code !== 0) throw failed(made);
    }
    const tree = await git([...get, '--depth', '1', 'origin', fetch.at]);
    if (tree.code !== 0) throw failed(tree);
    const head = await git(['rev-parse', 'FETCH_HEAD']), commit = head.stdout.toString('utf8').trim();
    if (head.code !== 0 || !commit) throw failed(head);
    const problems: string[] = [], laid: Laid[] = [];
    for (const want of fetch.plugins) {
      const listed = await listFolder(git, commit, want, join(dir, 'plugins', String(laid.length)));
      if (typeof listed === 'string') problems.push(listed); else laid.push(listed);
    }
    // The manifests and the links first: they name the rest.
    const first = await blobs(laid.flatMap(one => [...one.blobs].filter(([name]) => one.links.has(name) || MANIFESTS.includes(name)).map(([, id]) => id)));
    // A manifest that is a link: what it leads to as well, so that the files it names are chosen.
    const led = laid.flatMap(one => MANIFESTS.filter(name => one.links.has(name)).map(name => one.blobs.get(inTree(one, first, name) ?? '')).filter(id => id && !first.has(id)) as string[]);
    for (const [id, bytes] of await blobs(led)) first.set(id, bytes);
    const chosen = new Map<Laid, Map<string, string>>();
    for (const one of laid) {
      await layOut(one, first);
      const files = await chooseFiles(one, first);
      if (typeof files === 'string') problems.push(files); else chosen.set(one, files);
    }
    const second = await blobs([...chosen.values()].flatMap(files => [...files.values()]));
    const items = new Map<string, PluginTextItem[]>();
    for (const [one, files] of chosen) {
      for (const [name, id] of files) await putInside(one.folder, name, second.get(id) ?? Buffer.alloc(0));
      items.set(one.want.key, itemsOf(await searchedParts(one.folder, one.want.entry ?? {}, one.folder)));
    }
    return { commit, items, problems };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
/** A stand-in or a manifest, written before any link is made, its folder made first. */
const put = async (path: string, bytes: Buffer | string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); };

// ---------- The kept file ----------

const isItem = (value: unknown) => { const item = record(value); return !!item && ['skill', 'agent', 'mcp'].includes(item.kind as string) && [item.name, item.description, item.start].every(field => typeof field === 'string'); };
const isPluginText = (value: unknown) => {
  const entry = record(value);
  return !!entry && [entry.source, entry.marketName, entry.plugin, entry.readAt].every(field => typeof field === 'string') && !Number.isNaN(Date.parse(entry.readAt as string))
    && Array.isArray(entry.items) && entry.items.every(isItem);
};
/** The kept file, by textKey. One damaged or of another format is thrown away (said in the log); an entry not of the kept shape is dropped. Either is read again. */
async function load(file: string, log: (line: string) => void): Promise<Map<string, PluginText>> {
  let saved: Record<string, unknown> | undefined;
  try { saved = record(JSON.parse(await readFile(file, 'utf8'))); } catch (error) { if (errorCode(error) === 'ENOENT') return new Map(); }
  const plugins = saved?.format === FORMAT && Array.isArray(saved.plugins) ? saved.plugins : undefined;
  if (!plugins) { log('plugin text: plugin-text.json was damaged or of another format; it is read again'); return new Map(); }
  const whole = plugins.filter(isPluginText) as PluginText[];
  if (whole.length < plugins.length) log(`plugin text: ${plugins.length - whole.length} damaged entries of plugin-text.json are read again`);
  return new Map(whole.map(entry => [textKey(entry.source, entry.plugin), entry]));
}

// ---------- The job ----------

export interface PluginTextJob {
  /** A home was opened (at launch, or switched to) or the switch turned on: what is under way stops, the listing is asked for again, and a run begins. */
  restart(): void;
  /**
   * The marketplaces were listed again (marketplaces.ts look): what is outstanding follows, even in a run under way. `fresh` (a
   * Refresh, the four-hour read): each Git catalog was fetched just before, and a repository that failed is tried again at once.
   */
  listed(listing: Listed, fresh: boolean): void;
  /** Quit, or the switch turned off: git is stopped, with every process it started; what had finished is saved, the count pushed, and then the promise ends. */
  stop(): Promise<void>;
  /** The count: of the plugins listed that can be read (`of`), those whose kept text was read at the pin now listed (`read`). */
  view(): PluginTextView;
  /**
   * The last text read for every plugin still listed (matched at each run, the switch on or off), also one whose new pin's read
   * has not landed: for finding a skill, yesterday's text is better than none. Empty until a run has loaded the file.
   */
  texts(): PluginText[];
}
export interface PluginTextHost {
  /** Where the file is kept and fetches are made: this build's plugins folder (beside plugins/catalogs). */
  dataDir: string;
  /** The switch: off, nothing is fetched. */
  on(): boolean;
  /** The marketplaces listed in the open home (marketplaces.ts listings), or undefined with none open. */
  listings(): Promise<Listed | undefined>;
  /** What Settings shows changed. */
  changed(view: PluginTextView): void;
  log(line: string): void;
  now?: () => number;
}

export function pluginTextJob(host: PluginTextHost): PluginTextJob {
  const file = join(host.dataDir, 'plugin-text.json'), stage = join(host.dataDir, 'text-fetch'), clock = host.now ?? Date.now;
  let kept = new Map<string, PluginText>(), loaded = false;
  /** The listing as last told (`said`), or asked for when a home opened: its catalogs as read (`read`), and once they are (`done`). A newer telling replaces it. */
  let told: { said: Listed; read: Promise<Listing>; done?: Listing } | undefined;
  let running: Promise<void> | undefined, again = false, cancel = new AbortController(), shown: PluginTextView = { read: 0, of: 0, elsewhere: 0, reading: false, on: host.on() };
  /** Repositories that failed, by fetch key: when each may be tried again. */
  const waits = new Map<string, { tries: number; until: number }>();
  /** The time, as kept in `readAt`. */
  const stamp = () => new Date(clock()).toISOString();
  const telling = (said: Listed) => {
    const next: NonNullable<typeof told> = { said, read: readListing(host.dataDir, said) };
    next.read.then(done => { next.done = done; }, () => undefined);
    return next;
  };
  /** The listing as told most recently, its catalogs read: one told while they were being read takes its place. */
  async function listing(): Promise<Listing | undefined> {
    for (let asked = told; asked; asked = told) { const read = await asked.read; if (asked === told) return read; }
    return undefined;
  }
  /** A listed Git marketplace with no copy here at the last read now has one (the Plugins page fetched it first). */
  const catalogArrived = () => !!told?.done?.absent.some(source => existsSync(catalogFolder({ dataDir: host.dataDir }, source)));
  /**
   * Writes the file whole when something was kept or dropped since it was last written (`dirty`): after each batch of AT_ONCE
   * finished fetches, and at the end of each run. Writes take turns; each writes what is kept at its turn, or nothing; one that
   * fails leaves it `dirty` for the next.
   */
  let saving = Promise.resolve(), dirty = false;
  const save = () => (saving = saving.then(async () => {
    if (!dirty) return;
    dirty = false;
    try { await writeDurably(file, JSON.stringify({ format: FORMAT, plugins: [...kept.values()] })); }
    catch (error) { dirty = true; host.log(`plugin text: not saved: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  /** Pushes the count (view) to Settings and to Find (main.ts textChanged). */
  const show = (busy: boolean) => {
    const wanted = [...(told?.done?.wanted.values() ?? [])], read = wanted.filter(want => { const have = kept.get(want.key); return !!have && (!want.remote || have.from === want.from); });
    shown = { read: read.length, of: wanted.length, elsewhere: wanted.filter(want => want.remote).length, reading: busy, on: host.on() };
    host.changed(shown);
  };

  /** Drops what is gone and puts in each plugin kept in its marketplace (both make the file `dirty`); gives the fetches outstanding. */
  function settle(now: Listing): Fetch[] {
    for (const [key, entry] of kept) {
      // A marketplace not in a listing read whole loses its plugins; one whose catalog was read loses those it no longer has. A failed read proves nothing.
      const market = sourceKey(entry.source);
      if ((now.complete && !now.markets.has(market)) || (now.read.has(market) && !now.wanted.has(key))) { kept.delete(key); dirty = true; }
    }
    const fetches = new Map<string, Fetch>();
    for (const want of now.wanted.values()) {
      const have = kept.get(want.key);
      if (want.items) {
        if (have?.from !== undefined || JSON.stringify(have?.items) !== JSON.stringify(want.items)) { kept.set(want.key, { source: want.source, marketName: want.marketName, plugin: want.plugin, readAt: stamp(), items: want.items }); dirty = true; }
        continue;
      }
      const key = fetchKey(want.remote!);
      if ((have && have.from === want.from && (want.remote!.sha || clock() - Date.parse(have.readAt) < DAY_MS)) || (waits.get(key)?.until ?? 0) > clock()) continue;
      const fetch = fetches.get(key) ?? { key, url: want.remote!.url, at: want.remote!.sha ?? want.remote!.ref ?? 'HEAD', plugins: [] };
      fetch.plugins.push(want);
      fetches.set(key, fetch);
    }
    return [...fetches.values()];
  }

  /** A fetch's result, kept for each plugin still listed with the same `from` as when it was fetched; a failure waits, doubling. */
  async function keep(fetch: Fetch, got: Fetched, signal: AbortSignal) {
    if (signal.aborted) return;
    const problems = 'problem' in got ? [got.problem] : got.problems;
    if (problems.length) {
      const tries = (waits.get(fetch.key)?.tries ?? 0) + 1, wait = Math.min(DAY_MS, RETRY_MS * 2 ** (tries - 1));
      waits.set(fetch.key, { tries, until: clock() + wait });
      host.log(`plugin text: ${fetch.url} at ${fetch.at}: ${problems.join(' ')} Tried again in ${Math.round(wait / 60_000)} minutes.`);
    } else waits.delete(fetch.key);
    if ('problem' in got) return;
    const now = await listing();
    if (signal.aborted || !now) return;
    for (const want of fetch.plugins) {
      const items = got.items.get(want.key);
      if (items && now.wanted.get(want.key)?.from === want.from) { kept.set(want.key, { source: want.source, marketName: want.marketName, plugin: want.plugin, from: want.from, commit: got.commit, readAt: stamp(), items }); dirty = true; }
    }
    show(true);
  }

  /** The outstanding fetches, AT_ONCE at a time, each begun only while one of its plugins is still wanted at the same `from`; saved after each AT_ONCE. */
  async function fetchEach(fetches: Fetch[], signal: AbortSignal) {
    let finished = 0;
    await eachLimited(fetches, AT_ONCE, async fetch => {
      const now = await listing();
      if (signal.aborted || !fetch.plugins.some(want => now?.wanted.get(want.key)?.from === want.from)) return;
      await keep(fetch, await fetchRepository(fetch, stage, signal), signal);
      if (++finished % AT_ONCE === 0) await save();
    });
  }

  async function run(signal: AbortSignal) {
    if (!loaded) { kept = await load(file, host.log); loaded = true; }
    try {
      do {
        again = false;
        if (!told) { const asked = await host.listings(); if (signal.aborted || !asked) return; told ??= telling(asked); }
        const now = await listing();
        if (!now || signal.aborted) return;
        const fetches = settle(now);
        show(true);
        if (host.on()) await fetchEach(fetches, signal);
        await save();
      } while (again && !signal.aborted);
    } finally { await rm(stage, { recursive: true, force: true }).catch(() => undefined); }
  }
  /**
   * The next run by itself, the switch on: when the first listed plugin kept elsewhere is due, the later of its wait's end and its
   * text going stale (at once if not read at the pin now listed; a day after its read if unpinned; never if pinned and read).
   */
  let later: ReturnType<typeof setTimeout> | undefined;
  function plan() {
    clearTimeout(later);
    const due = [...told?.done?.wanted.values() ?? []].filter(want => want.remote).map(want => {
      const have = kept.get(want.key), stale = !have || have.from !== want.from ? 0 : want.remote!.sha ? Infinity : Date.parse(have.readAt) + DAY_MS;
      return Math.max(stale, waits.get(fetchKey(want.remote!))?.until ?? 0);
    });
    const next = Math.min(...due);
    // Never sooner than a second, nor later than a day (a date far ahead, from a clock set back, then counts no further).
    if (host.on() && next < Infinity) later = setTimeout(start, Math.min(DAY_MS, Math.max(1000, next - clock()))).unref();
  }
  function start() {
    if (running) { again = true; return; }
    const signal = (cancel = new AbortController()).signal;
    running = run(signal).catch(error => host.log(`plugin text: stopped: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { running = undefined; show(false); if (again) start(); else if (!signal.aborted) plan(); });
  }

  return {
    restart() { told = undefined; if (running) { again = true; cancel.abort(); } else start(); },
    listed(next, fresh) {
      // Refresh: every wait is due now; how often each repository failed is kept, so the next wait still doubles.
      if (fresh) for (const wait of waits.values()) wait.until = 0;
      const was = told?.said, same = was?.complete === next.complete && was.sources.length === next.sources.length && next.sources.every(source => was.sources.some(other => sameSource(source, other)));
      // The same listing, already read, with no catalog arrived since: nothing new. Told while it is still being read, it is read again.
      if (!fresh && same && told?.done && !catalogArrived()) return;
      told = telling(next);
      start();
    },
    stop() { again = false; cancel.abort(); clearTimeout(later); return (running ?? Promise.resolve()).then(() => save()).then(() => show(false)); },
    view: () => ({ ...shown, on: host.on() }),
    texts: () => [...kept.values()],
  };
}
