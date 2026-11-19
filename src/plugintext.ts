// The plugin text (MAP.md, "Plugins"): the names, descriptions and first lines of the skills, agents and MCP servers in the
// plugins of the marketplaces listed here, kept for Find to search plugins that are not installed. A job of its own in the main
// process, outside the queue, that reads text and nothing more: nothing fetched is installed or run, and nothing is written to
// a home or a tool, only this build's plugin-text.json (writeDurably).
// - A plugin kept in its marketplace: its catalog's own read (plugins.ts parseCatalog `keepContents`), at every run.
// - A plugin kept in another repository (catalogdetail.ts remoteOf): at its pinned commit (unpinned: its ref's tip, once a day),
//   the tree with no contents, then only the files the app's reader names (catalogdetail.ts searchedParts), in a bare repository
//   made for that one fetch and deleted after (fetchRepository). One fetch per repository and commit serves all its plugins.
// A run (pluginTextJob run): the listed marketplaces' catalogs as their copies on disk say; what is gone dropped (settle); what is
// outstanding fetched eight at a time; each result checked against the listing as it is then before it is kept and saved (keep).
// Not here: which marketplaces are listed (marketplaces.ts listings, and its look, which reports each new listing), how Git runs
// (plugins.ts runGit), the switch (main.ts AppSettings pluginText) and its row on Settings (settingspage.ts pluginTextRow).
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
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
  /** Kept in another repository: what chose its files (fromOf); its text holds while that is unchanged. Absent for a plugin kept in its marketplace. */
  from?: string;
  /** The commit its text was read at, for a plugin kept in another repository. */
  commit?: string;
  /** When it was read: an unpinned plugin is read again after a day. */
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
 * Bounds per repository, so that what is read can neither slow nor fill the app: the bytes received and the temporary disk (its
 * pack folder, looked at twice a second while Git runs), and the blobs read; the entries looked at and the files chosen per plugin.
 */
const MOST_BYTES = 32 * 1024 * 1024, MOST_ENTRIES = 20_000, MOST_FILES = 2_000;
const GIT_MS = 60_000;
/** What a server says it can do, in Git's packet trace: with protocol v2 its fetch line, with v0 the first ref's line. */
const CAPABILITIES = /git< (?:fetch=|[0-9a-f]{40,64} \S+\\0)(.*)$/m;

const textKey = (source: string, plugin: string) => `${sourceKey(source)}\u0000${plugin}`;
type Remote = NonNullable<CatalogPlugin['remote']>;
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
/** The listed marketplaces and those whose catalog was read (by sourceKey), and each plugin of those that can be read (by textKey). */
interface Listing { listed: Set<string>; read: Set<string>; wanted: Map<string, Wanted> }

/** The listed marketplaces' catalogs, as their copies on disk say: a Git marketplace not fetched yet is not read. */
async function readListing(dataDir: string, sources: string[]): Promise<Listing> {
  const listing: Listing = { listed: new Set(sources.map(sourceKey)), read: new Set(), wanted: new Map() };
  for (const source of sources) {
    const folder = isFolder(source);
    const catalog = await parseCatalog(folder ? source : catalogFolder({ dataDir }, source), source, folder ? 'folder' : 'git', { keepContents: true }).catch(() => undefined);
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

/** One fetch: a repository at a pinned commit, or at its ref's tip (`at`), and its plugins. `known`: the commit all of them were last read at, when unpinned. */
interface Fetch { key: string; url: string; at: string; pinned: boolean; plugins: Wanted[]; known?: string }
/** What a fetch gave: the commit, and each plugin's items by textKey (none when `known` was still the tip), with what could not be read; or why nothing could. */
type Fetched = { commit: string; items?: Map<string, PluginTextItem[]>; problems: string[] } | { problem: string };
/** A plugin's folder at that commit: each blob by its path in the folder, which of them are links, and where it is laid out on disk. */
interface Laid { want: Wanted; folder: string; blobs: Map<string, string>; links: Set<string> }
/** Git run in the repository being read, bounded by the fetch's signal and MOST_BYTES. */
type InRepo = (args: string[], options?: RunOptions) => ReturnType<typeof runGit>;

/** The size of a repository's packs, where what Git receives is written. */
const packBytes = async (repo: string) => {
  const pack = join(repo, 'objects/pack');
  let size = 0;
  for (const name of await readdir(pack).catch(() => [] as string[])) size += (await stat(join(pack, name)).catch(() => undefined))?.size ?? 0;
  return size;
};

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
 * Whether a repository's server filters what it sends, asked before anything is fetched from it (a server that declines a
 * filtered fetch sends the whole commit instead): its capabilities, through `ls-remote` with Git's packet trace on. Undefined
 * when it could not be asked: the fetch then says why.
 */
async function filters(url: string, signal: AbortSignal): Promise<boolean | undefined> {
  const said = CAPABILITIES.exec((await runGit(['ls-remote', '--', url, 'HEAD'], GIT_MS, { signal, env: { GIT_TRACE_PACKET: '1' } })).output)?.[1];
  return said === undefined ? undefined : /\bfilter\b/.test(said);
}

/** A plugin's folder at `commit`, listed (no contents yet), to be laid out in `folder`; or why it can't be. Submodules are skipped. */
async function listFolder(git: InRepo, commit: string, want: Wanted, folder: string): Promise<Laid | string> {
  const path = want.remote!.path.replace(/\/+$/, ''), prefix = path ? `${path}/` : '';
  const listed = await git(['ls-tree', '-r', '-z', commit, ...(path ? ['--', path] : [])]);
  const entries = listed.stdout.toString('utf8').split('\0').filter(Boolean);
  if (listed.code !== 0) return `${want.plugin}: its folder is not in the repository.`;
  if (entries.length > MOST_ENTRIES) return `${want.plugin}: more than ${MOST_ENTRIES} files.`;
  const laid: Laid = { want, folder, blobs: new Map(), links: new Set() };
  for (const line of entries) {
    const tab = line.indexOf('\t'), [mode, type, id] = line.slice(0, tab).split(' '), name = line.slice(tab + 1);
    if (type !== 'blob' || !name.startsWith(prefix)) continue;
    laid.blobs.set(name.slice(prefix.length), id!);
    if (mode === '120000') laid.links.add(name.slice(prefix.length));
  }
  return laid;
}

/**
 * The folder laid out for the reader's first pass: an empty stand-in for each file it may name (searchedFile), the manifests
 * with their text (`first`), and its links, made last, so that no file is written through one.
 */
async function layOut(laid: Laid, first: Map<string, Buffer>) {
  for (const [name, id] of laid.blobs) if (!laid.links.has(name) && (searchedFile(name) || first.has(id))) await put(join(laid.folder, name), first.get(id) ?? '');
  for (const name of laid.links) await mkdir(dirname(join(laid.folder, name)), { recursive: true }).then(() => symlink(first.get(laid.blobs.get(name)!)?.toString('utf8') ?? '', join(laid.folder, name))).catch(() => undefined);
  await mkdir(laid.folder, { recursive: true });
}

/** The files the reader names in the laid-out folder (its skills', its agents' and its servers'), by path and blob, not fetched yet; or why there are too many. */
async function chooseFiles(laid: Laid, first: Map<string, Buffer>): Promise<Map<string, string> | string> {
  const named = await searchedParts(laid.folder, laid.want.entry ?? {}, laid.folder), real = await realpath(laid.folder);
  const files = [...named.skills.map(part => join(laid.folder, part.path, 'SKILL.md')), ...named.agents.map(part => join(laid.folder, part.path)), ...named.serverFiles];
  if (files.length > MOST_FILES) return `${laid.want.plugin}: more than ${MOST_FILES} files to read.`;
  const chosen = new Map<string, string>();
  for (const file of files) {
    // Through the folder's own links (the reader read only inside it), to the path the tree lists.
    const name = relative(real, await realpath(file).catch(() => real)).split(sep).join('/'), id = laid.blobs.get(name);
    if (id && !laid.links.has(name) && !first.has(id)) chosen.set(name, id);
  }
  return chosen;
}

/**
 * One repository read as text, in a bare repository made for it in `stage` and deleted after: if its server filters, the tree
 * at `at` with no contents; each plugin's folder listed (listFolder); the manifests and links fetched and the folder laid out
 * (layOut); the files the reader names fetched (chooseFiles), and written over their stand-ins; the reader's items. Stopped
 * by `signal`, or past MOST_BYTES.
 */
async function fetchRepository(fetch: Fetch, stage: string, signal: AbortSignal): Promise<Fetched> {
  const dir = join(stage, randomUUID()), repo = join(dir, 'git');
  const tooLarge = new AbortController(), stop = AbortSignal.any([signal, tooLarge.signal]);
  const watch = setInterval(() => void packBytes(repo).then(size => { if (size > MOST_BYTES) tooLarge.abort(); }), 500);
  const git: InRepo = (args, options = {}) => runGit(['--literal-pathspecs', '-C', repo, ...args], GIT_MS, { signal: stop, maxBytes: MOST_BYTES, ...options });
  const failed = (step: { code: number | 'timeout' | 'missing'; output: string }) =>
    new Error(tooLarge.signal.aborted ? `it is larger than ${MOST_BYTES / 1024 / 1024} MB.` : whyGitFailed(step.code, step.output, 'repository'));
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
    if ((await filters(fetch.url, stop)) === false) return { problem: 'its server declines a filtered fetch, and a whole copy is never taken.' };
    await mkdir(dir, { recursive: true });
    for (const args of [['init', '-q', '--bare', repo], ['-C', repo, 'remote', 'add', 'origin', fetch.url]]) {
      const made = await runGit(args, GIT_MS, { signal: stop });
      if (made.code !== 0) throw failed(made);
    }
    const tree = await git([...get, '--depth', '1', 'origin', fetch.at]);
    if (tree.code !== 0) throw failed(tree);
    const head = await git(['rev-parse', 'FETCH_HEAD']), commit = head.stdout.toString('utf8').trim();
    if (head.code !== 0 || !commit) throw failed(head);
    if (fetch.known === commit) return { commit, problems: [] };
    const problems: string[] = [], laid: Laid[] = [];
    for (const want of fetch.plugins) {
      const listed = await listFolder(git, commit, want, join(dir, 'plugins', String(laid.length)));
      if (typeof listed === 'string') problems.push(listed); else laid.push(listed);
    }
    // The manifests and the links first: they name the rest.
    const first = await blobs(laid.flatMap(one => [...one.blobs].filter(([name]) => one.links.has(name) || name === '.claude-plugin/plugin.json' || name === '.mcp.json').map(([, id]) => id)));
    const chosen = new Map<Laid, Map<string, string>>();
    for (const one of laid) {
      await layOut(one, first);
      const files = await chooseFiles(one, first);
      if (typeof files === 'string') problems.push(files); else chosen.set(one, files);
    }
    const second = await blobs([...chosen.values()].flatMap(files => [...files.values()]));
    const items = new Map<string, PluginTextItem[]>();
    for (const [one, files] of chosen) {
      for (const [name, id] of files) if ((await lstat(join(one.folder, name)).catch(() => undefined))?.isFile()) await writeFile(join(one.folder, name), second.get(id) ?? '');
      items.set(one.want.key, itemsOf(await searchedParts(one.folder, one.want.entry ?? {}, one.folder)));
    }
    return { commit, items, problems };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  } finally {
    clearInterval(watch);
    await rm(dir, { recursive: true, force: true });
  }
}
/** A stand-in or a fetched file, written where its folder is made first. */
const put = async (path: string, bytes: Buffer | string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); };

// ---------- The kept file ----------

const isPluginText = (value: unknown) => {
  const entry = record(value);
  return !!entry && [entry.source, entry.marketName, entry.plugin, entry.readAt].every(field => typeof field === 'string')
    && Array.isArray(entry.items) && entry.items.every(item => typeof record(item)?.name === 'string');
};
/** The kept file, by textKey. One that is damaged, or of another format, is thrown away (said in the log) and built again. */
async function load(file: string, log: (line: string) => void): Promise<Map<string, PluginText>> {
  let saved: Record<string, unknown> | undefined;
  try { saved = record(JSON.parse(await readFile(file, 'utf8'))); } catch (error) { if (errorCode(error) === 'ENOENT') return new Map(); }
  const plugins = saved?.format === FORMAT && Array.isArray(saved.plugins) && saved.plugins.every(isPluginText) ? saved.plugins as PluginText[] : undefined;
  if (!plugins) { log('plugin text: plugin-text.json was damaged or of another format; it is read again'); return new Map(); }
  return new Map(plugins.map(entry => [textKey(entry.source, entry.plugin), entry]));
}

// ---------- The job ----------

export interface PluginTextJob {
  /** A home was opened (at launch, or switched to) or the switch turned on: the listing is asked for again and a run begins. */
  restart(): void;
  /** The marketplaces were listed again (marketplaces.ts look); `fresh`: each Git catalog was fetched just before. A run takes it up. */
  listed(sources: string[], fresh: boolean): void;
  /** Quit, or the switch turned off: what is under way is stopped; what is saved stays. */
  stop(): void;
  view(): PluginTextView;
  /** Every plugin's text as kept now (none before the first run has loaded the file). */
  texts(): PluginText[];
}
export interface PluginTextHost {
  /** Where the file is kept and fetches are made: this build's plugins folder (beside plugins/catalogs). */
  dataDir: string;
  /** The switch: off, no run starts. */
  on(): boolean;
  /** The marketplaces listed in the open home (marketplaces.ts listings), or undefined with none open. */
  listings(): Promise<string[] | undefined>;
  /** What Settings shows changed. */
  changed(view: PluginTextView): void;
  log(line: string): void;
  now?: () => number;
}

export function pluginTextJob(host: PluginTextHost): PluginTextJob {
  const file = join(host.dataDir, 'plugin-text.json'), stage = join(host.dataDir, 'text-fetch'), clock = host.now ?? Date.now;
  let kept = new Map<string, PluginText>(), loaded = false, sources: string[] | undefined, last: Listing | undefined;
  /** The catalogs read for `sources`; forgotten whenever the listing is told again. */
  let reading: Promise<Listing> | undefined;
  let running: Promise<void> | undefined, again = false, cancel = new AbortController(), shown: PluginTextView = { read: 0, of: 0, elsewhere: 0, reading: false };
  /** Repositories that failed, by fetch key: when each may be tried again. */
  const waits = new Map<string, { tries: number; until: number }>();
  const now = () => new Date(clock()).toISOString();

  /** The listing for the sources as last told, read once per telling. */
  const listing = async () => (last = await (reading ??= readListing(host.dataDir, sources ?? [])));
  /**
   * Writes the file whole when something was kept or dropped since it was last written (`dirty`): after each batch of AT_ONCE
   * finished fetches, and at the end of each pass. Writes take turns; each writes what is kept at its turn, or nothing.
   */
  let saving = Promise.resolve(), dirty = false;
  const save = () => (saving = saving.then(async () => {
    if (!dirty) return;
    dirty = false;
    try { await writeDurably(file, JSON.stringify({ format: FORMAT, plugins: [...kept.values()] })); }
    catch (error) { host.log(`plugin text: not saved: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  const tell = (busy: boolean) => {
    const wanted = [...(last?.wanted.values() ?? [])], read = wanted.filter(want => { const have = kept.get(want.key); return !!have && (!want.remote || have.from === want.from); });
    shown = { read: read.length, of: wanted.length, elsewhere: wanted.filter(want => want.remote).length, reading: busy };
    host.changed(shown);
  };

  /** Drops what is gone and puts in each plugin kept in its marketplace (both make the file `dirty`); gives the fetches outstanding. */
  function settle(listed: Listing): Fetch[] {
    for (const [key, entry] of kept) {
      // A marketplace no longer listed loses its plugins; one whose catalog was read loses those it no longer has. One unread proves nothing.
      const market = sourceKey(entry.source);
      if (!listed.listed.has(market) || (listed.read.has(market) && !listed.wanted.has(key))) { kept.delete(key); dirty = true; }
    }
    const fetches = new Map<string, Fetch>();
    for (const want of listed.wanted.values()) {
      const have = kept.get(want.key);
      if (want.items) {
        if (have?.from !== undefined || JSON.stringify(have?.items) !== JSON.stringify(want.items)) { kept.set(want.key, { source: want.source, marketName: want.marketName, plugin: want.plugin, readAt: now(), items: want.items }); dirty = true; }
        continue;
      }
      const { url, sha, ref } = want.remote!, key = `${url}\u0000${sha ?? `@${ref ?? ''}`}`;
      if ((have && have.from === want.from && (sha || clock() - Date.parse(have.readAt) < DAY_MS)) || (waits.get(key)?.until ?? 0) > clock()) continue;
      const fetch = fetches.get(key) ?? { key, url, at: sha ?? ref ?? 'HEAD', pinned: !!sha, plugins: [] };
      fetch.plugins.push(want);
      fetches.set(key, fetch);
    }
    // Unpinned, with every plugin read at one commit: if the tip is still that commit, nothing more is fetched.
    for (const fetch of fetches.values()) {
      const commits = new Set(fetch.plugins.map(want => (kept.get(want.key)?.from === want.from ? kept.get(want.key)?.commit : undefined)));
      if (!fetch.pinned && commits.size === 1) fetch.known = [...commits][0];
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
    const listed = await listing();
    if (signal.aborted) return;
    for (const want of fetch.plugins) {
      const items = got.items ? got.items.get(want.key) : kept.get(want.key)?.items;
      if (items && listed.wanted.get(want.key)?.from === want.from) { kept.set(want.key, { source: want.source, marketName: want.marketName, plugin: want.plugin, from: want.from, commit: got.commit, readAt: now(), items }); dirty = true; }
    }
    tell(true);
  }

  async function run(signal: AbortSignal) {
    if (!loaded) { kept = await load(file, host.log); loaded = true; }
    await rm(stage, { recursive: true, force: true });
    do {
      again = false;
      sources ??= await host.listings();
      if (!sources || signal.aborted) return;
      const fetches = settle(await listing());
      tell(true);
      let finished = 0;
      await eachLimited(fetches, AT_ONCE, async fetch => {
        if (signal.aborted) return;
        await keep(fetch, await fetchRepository(fetch, stage, signal), signal);
        if (++finished % AT_ONCE === 0) await save();
        await new Promise(resolve => setImmediate(resolve));
      });
      await save();
    } while (again && !signal.aborted);
  }
  /** The next run by itself, while the app runs: when the first repository that failed may be tried again, or an unpinned plugin's day is up. */
  let later: ReturnType<typeof setTimeout> | undefined;
  function plan() {
    clearTimeout(later);
    const due = [...waits.values()].map(wait => wait.until);
    for (const want of last?.wanted.values() ?? []) { const have = kept.get(want.key); if (want.remote && !want.remote.sha && have) due.push(Date.parse(have.readAt) + DAY_MS); }
    if (due.length) later = setTimeout(start, Math.max(1000, Math.min(...due) - clock())).unref();
  }
  function start() {
    if (running) { again = true; return; }
    if (!host.on()) return;
    const signal = (cancel = new AbortController()).signal;
    running = run(signal).catch(error => host.log(`plugin text: stopped: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { running = undefined; tell(false); if (again) start(); else if (!signal.aborted) plan(); });
  }

  return {
    restart() { sources = reading = undefined; if (running) { again = true; cancel.abort(); } else start(); },
    listed(next, fresh) {
      if (!fresh && sources?.length === next.length && next.every(source => sources!.some(other => sameSource(source, other)))) return;
      sources = next;
      reading = undefined;
      start();
    },
    stop() { again = false; cancel.abort(); clearTimeout(later); },
    view: () => shown,
    texts: () => [...kept.values()],
  };
}
