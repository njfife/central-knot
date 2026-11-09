// Marketplaces in the main process: the list added here, each catalog as last read, what each tool has installed, and the
// requests the Plugins page makes. Kept apart from the other features: createMarketplaces holds the logic as plain
// functions (tested), and registerMarketplaces wires them to IPC with a few host functions from main.ts.
import { access, constants, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { marketplacePage, pluginDetail, readmeIn } from './catalogdetail.ts';
import { harnesses } from './harnesses.ts';
import { executableCandidates } from './platform.ts';
import { failedFor } from './pluginplan.ts';
import * as engine from './plugins.ts';
import { cachedCatalog, installState, isFolder, parseCatalog, pluginTools, registeredMarketplaces, registeredSource, remoteCopyFolder, sameSource, type PluginContext } from './plugins.ts';
import type { ActionReport, Catalog, HarnessId, InstallState, MarketplaceView, PluginActionResult, PluginDetail, PluginsView, Snapshot } from './types.ts';

/** What the marketplace feature needs from the app around it. */
export interface MarketplaceHost {
  /** The home on screen, or undefined before one is open. */
  home(): { home: string; snapshots: Snapshot[]; overrides?: Partial<Record<HarnessId, string>> } | undefined;
  /** This home's tools, in the order the page shows them. */
  tools(): Promise<HarnessId[]>;
  /** Whether writing is allowed in this home, and why not. */
  writeAccess(): Promise<{ allowed: boolean; reason?: string }>;
  /** Central Knot's own data folder: the added list here, Git copies under plugins/. */
  dataDir: string;
  pickFolder(): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
}
/** The engine calls that touch Git or a tool, replaceable in tests. */
export interface MarketplaceEngine {
  findClis(): Promise<Partial<Record<HarnessId, string>>>;
  readCatalog: typeof engine.readCatalog;
  readRemotePlugin: typeof engine.readRemotePlugin;
  install: typeof engine.install;
  uninstall: typeof engine.uninstall;
}

/** A tool's own CLI, never an app's bundled copy (CD §3), searched as version probes are. */
async function findClis(): Promise<Partial<Record<HarnessId, string>>> {
  const found: Partial<Record<HarnessId, string>> = {};
  for (const tool of pluginTools) {
    for (const candidate of executableCandidates(homedir(), process.env.PATH ?? '', harnesses[tool].binary)) {
      if (candidate.includes('/ChatGPT.app/')) continue;
      try { await access(candidate, constants.X_OK); found[tool] = candidate; break; } catch { /* next */ }
    }
  }
  return found;
}
const realEngine: MarketplaceEngine = { findClis, readCatalog: engine.readCatalog, readRemotePlugin: engine.readRemotePlugin, install: engine.install, uninstall: engine.uninstall };

const toolIds = (value: unknown): HarnessId[] => (Array.isArray(value) ? value.filter((id): id is HarnessId => pluginTools.includes(id as HarnessId)) : []);
/** Reports go to the page without each run's file bytes (kept only for the record here); the page never reads them. */
const lean = (reports: ActionReport[]): ActionReport[] => reports.map(report => ({ ...report, runs: report.runs.map(run => ({ ...run, changed: run.changed.map(change => ({ path: change.path, before: null, after: null })) })) }));
const empty: Omit<PluginDetail, 'problem'> = { skills: [], commands: [], agents: [], hooks: [], mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false };

export function createMarketplaces(host: MarketplaceHost, use: MarketplaceEngine = realEngine) {
  const listPath = join(host.dataDir, 'marketplaces.json');
  const added = async (): Promise<string[]> => {
    try { const list = JSON.parse(await readFile(listPath, 'utf8')); return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
  };
  const saveAdded = async (list: string[]) => { await mkdir(host.dataDir, { recursive: true }); await writeFile(listPath, `${JSON.stringify(list, null, 2)}\n`); };
  /**
   * A context for one request. CLIs are looked for only when a request runs or reports on them. Only a read-only view
   * shares reads: an install reads the tool's records again after its command, and must see the change.
   */
  const context = async (withClis: boolean, shareReads = false): Promise<PluginContext> => {
    const open = host.home();
    if (!open) throw new Error('No home is open.');
    return { home: open.home, dataDir: join(host.dataDir, 'plugins'), binaries: withClis ? await use.findClis() : {}, overrides: open.overrides, reads: shareReads ? new Map() : undefined };
  };

  /** Each Git catalog as last fetched this session, with why the last fetch failed. Folders are read fresh every time. */
  const fetched = new Map<string, { catalog?: Catalog; stale?: boolean; problem?: string }>();
  /** A catalog read again is the moment its plugins kept in other repositories are let go, so they are read again too. */
  const dropRemoteCopies = (plugins: PluginContext, catalog: Catalog) => Promise.all(catalog.plugins.map(item => (item.remote ? rm(remoteCopyFolder(plugins, item.remote), { recursive: true, force: true }) : undefined)));
  async function catalogFor(plugins: PluginContext, source: string, fresh = false): Promise<{ catalog?: Catalog; stale?: boolean; problem?: string }> {
    if (isFolder(source)) {
      const catalog = await parseCatalog(source, source, 'folder');
      if (fresh && !catalog.problem) await dropRemoteCopies(plugins, catalog);
      return { catalog, problem: catalog.problem };
    }
    const known = fetched.get(source);
    if (known && !fresh) return known;
    const cached = fresh ? undefined : await cachedCatalog(plugins, source);
    const read = cached ? undefined : await use.readCatalog(plugins, source);
    if (read && !read.problem && fresh) await dropRemoteCopies(plugins, read);
    const catalog = cached ?? (read && !read.problem ? read : await cachedCatalog(plugins, source));
    const result = { catalog, problem: read?.problem, stale: !!read?.problem && !!catalog };
    fetched.set(source, result);
    return result;
  }

  /** The tools' states for one marketplace's plugins. A tool holding another marketplace under this name is left alone. */
  async function statesFor(plugins: PluginContext, tools: HarnessId[], catalog: Catalog, source: string): Promise<MarketplaceView['states']> {
    const held = new Map<HarnessId, InstallState>();
    for (const tool of tools) {
      const registered = await registeredSource(plugins, tool, catalog.name);
      if (registered && !sameSource(registered, source)) held.set(tool, { state: 'held', reason: `${harnesses[tool].name} has a different marketplace named “${catalog.name}” (${registered}). Central Knot leaves it alone.` });
    }
    const states: MarketplaceView['states'] = {};
    for (const plugin of catalog.plugins) {
      const pairs = await Promise.all(tools.map(async tool => [tool, held.get(tool) ?? await installState(plugins, tool, catalog.name, plugin.name)] as const));
      states[plugin.name] = Object.fromEntries(pairs);
    }
    return states;
  }

  /** One marketplace on the page. A catalog that can't be read becomes a problem on its entry, never a broken page. */
  async function entryView(plugins: PluginContext, tools: HarnessId[], source: string, origins: MarketplaceView['origins'], fresh: boolean): Promise<MarketplaceView> {
    const base: MarketplaceView = { source, origins, name: '', kind: isFolder(source) ? 'folder' : 'git', plugins: [], states: {}, page: marketplacePage(source) };
    try {
      const { catalog, stale, problem } = await catalogFor(plugins, source, fresh);
      if (!catalog) return { ...base, problem };
      // The raw entry and remote address stay here; the page gets what it shows.
      const shown = catalog.plugins.map(({ entry: _entry, remote: _remote, ...plugin }) => plugin);
      return { ...base, name: catalog.name, fetchedAt: catalog.fetchedAt, problem, stale, owner: catalog.owner, description: catalog.description, plugins: shown, states: await statesFor(plugins, tools, catalog, source) };
    } catch { return { ...base, problem: 'It could not be read.' }; }
  }

  /** Every marketplace: added here, or already added in a tool. `fresh`: one source, or every Git source, fetched again. */
  async function view(fresh?: string | true): Promise<PluginsView> {
    const plugins = await context(true, true);
    const tools = (await host.tools()).filter(tool => pluginTools.includes(tool));
    const access = await host.writeAccess();
    const known: { source: string; origins: MarketplaceView['origins'] }[] = [];
    const note = (source: string, origin: MarketplaceView['origins'][number]) => {
      const entry = known.find(item => sameSource(item.source, source));
      if (entry) { if (!entry.origins.includes(origin)) entry.origins.push(origin); } else known.push({ source, origins: [origin] });
    };
    for (const source of await added()) note(source, 'central-knot');
    // A source that could read as an option is never passed on to a tool or to Git.
    for (const tool of tools) for (const entry of await registeredMarketplaces(plugins, tool)) if (!entry.source.startsWith('-')) note(entry.source, tool);
    const marketplaces: MarketplaceView[] = [];
    for (const { source, origins } of known) marketplaces.push(await entryView(plugins, tools, source, origins, fresh === true || (fresh !== undefined && sameSource(fresh, source))));
    const snapshots = host.home()?.snapshots ?? [];
    const desktopOnly = tools.filter(tool => !plugins.binaries[tool] && snapshots.find(snapshot => snapshot.harness === tool)?.probe.bundled);
    return { home: plugins.home, tools, clis: Object.fromEntries(tools.map(tool => [tool, !!plugins.binaries[tool]])), canWrite: access.allowed, reason: access.allowed ? undefined : access.reason, marketplaces, desktopOnly };
  }

  /** A plugin's contents and README: from the marketplace's files, or from its own repository when it lives elsewhere. */
  async function detail(source: string, plugin: string): Promise<PluginDetail | null> {
    const plugins = await context(false);
    const { catalog } = await catalogFor(plugins, source);
    const item = catalog?.plugins.find(entry => entry.name === plugin);
    if (!catalog?.root || !item) return null;
    if (item.folder) return pluginDetail(item.folder, item.entry ?? {}, catalog.root);
    if (!item.remote) return null;
    const copy = await use.readRemotePlugin(plugins, item.remote);
    if ('problem' in copy) return { ...empty, problem: `Its files couldn’t be read from ${item.from?.label ?? item.remote.url}: ${copy.problem}` };
    // The entry may list its components; its `source` names the repository, not a path in it.
    const { source: _where, ...listed } = item.entry ?? {};
    return pluginDetail(copy.folder, listed, copy.root);
  }

  /** The marketplace's own README, from the copy already read. */
  async function readme(source: string): Promise<string | null> {
    const { catalog } = await catalogFor(await context(false), source);
    return catalog?.root ? (await readmeIn(catalog.root)) ?? null : null;
  }

  async function add(source: string): Promise<{ problem?: string; view?: PluginsView; source?: string }> {
    const text = source.trim();
    if (text.startsWith('-')) return { problem: 'That isn’t a marketplace: owner/repo, a Git URL or a folder.' };
    const catalog = await use.readCatalog(await context(false), text);
    if (catalog.problem) return { problem: catalog.problem };
    const list = await added();
    const stored = list.find(item => sameSource(item, text)) ?? text;
    if (stored === text && !list.includes(text)) await saveAdded([...list, text]);
    // The read just made is the catalog: the view uses it instead of fetching again.
    if (!isFolder(stored)) fetched.set(stored, { catalog });
    const shown = await view();
    return { view: shown, source: shown.marketplaces.find(entry => sameSource(entry.source, stored))?.source ?? stored };
  }

  /** Fetches one marketplace again; its plugins kept in other repositories are read again too. */
  const refresh = (source: string): Promise<PluginsView> => view(source);

  async function forget(source: string): Promise<PluginsView> {
    await saveAdded((await added()).filter(item => !sameSource(item, source)));
    fetched.delete(source);
    return view();
  }

  // Writes act only on the home on screen, and only where writing is allowed there.
  const guard = async (home: unknown) => {
    if (home !== host.home()?.home) return 'The home on screen is not the one open. Nothing was installed. Read it again.';
    const access = await host.writeAccess();
    return access.allowed ? undefined : access.reason;
  };

  /** Each tool's own install. A plugin gone from the marketplace fails for its tools instead of stopping the whole run. */
  async function install(source: string, plugin: string, tools: HarnessId[], home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home);
    if (stopped) return { stopped, reports: [] };
    const plugins = await context(true);
    const { catalog } = await catalogFor(plugins, source);
    if (!catalog?.plugins.some(item => item.name === plugin)) return { reports: failedFor(tools, 'It is no longer in the marketplace as last read. Refresh the marketplace.') };
    const reports: ActionReport[] = [];
    for (const tool of tools) reports.push(await use.install(plugins, catalog, plugin, tool));
    return { reports: lean(reports) };
  }

  async function uninstall(source: string, marketplace: string, plugin: string, tool: HarnessId, home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home);
    if (stopped) return { stopped, reports: [] };
    return { reports: lean([await use.uninstall(await context(true), marketplace, plugin, tool, source)]) };
  }

  return { view, detail, readme, add, refresh, forget, install, uninstall };
}

type Handle = (channel: string, work: (...args: unknown[]) => Promise<unknown>) => void;
const isText = (value: unknown, max = 2000): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;

/** The Plugins page's requests. Each checks its arguments; anything malformed is refused, never guessed at. */
export function registerMarketplaces(handle: Handle, host: MarketplaceHost): void {
  const markets = createMarketplaces(host);
  const open = () => !!host.home();
  handle('plugins:view', async fresh => (open() ? markets.view(fresh === true ? true : undefined) : null));
  handle('plugins:readme', async source => (open() && isText(source) ? markets.readme(source) : null));
  handle('plugins:detail', async (source, plugin) => (open() && isText(source) && isText(plugin, 300) ? markets.detail(source, plugin) : null));
  // Links from READMEs and marketplaces open in the browser: https only, and never inside the app.
  handle('open:external', async url => { if (isText(url) && /^https:\/\/\S+$/.test(url)) await host.openExternal(url); });
  handle('plugins:add', async source => { if (!open() || !isText(source)) throw new Error('Invalid marketplace.'); return markets.add(source); });
  handle('plugins:refresh', async source => (open() && isText(source) ? markets.refresh(source) : null));
  handle('plugins:forget', async source => (open() && isText(source) ? markets.forget(source) : null));
  handle('plugins:pick-folder', async () => (await host.pickFolder()) ?? null);
  // A malformed step fails for its tools, so it never stops (and then blocks) every later Apply all.
  const refused = (tools: unknown) => ({ reports: failedFor(toolIds(Array.isArray(tools) ? tools : [tools]), 'That request was malformed, so nothing ran.') });
  handle('plugins:install', async (source, plugin, tools, home) => (open() && isText(source) && isText(plugin, 300) ? markets.install(source, plugin, toolIds(tools), home) : refused(tools)));
  handle('plugins:uninstall', async (source, marketplace, plugin, tool, home) => {
    const ids = toolIds([tool]);
    return open() && isText(source) && isText(marketplace, 300) && isText(plugin, 300) && ids.length ? markets.uninstall(source, marketplace, plugin, ids[0]!, home) : refused(tool);
  });
}
