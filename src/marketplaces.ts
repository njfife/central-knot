// Marketplaces in the main process: the list added here, each catalog as last read, what each tool has installed, and the
// requests the Plugins page makes. Kept apart from the other features: createMarketplaces holds the logic as plain
// functions (tested), and registerMarketplaces wires them to IPC with a few host functions from main.ts.
import { access, constants, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { marketplacePage, pluginDetail, readmeIn, sourceLabel } from './catalogdetail.ts';
import { harnesses } from './harnesses.ts';
import { executableCandidates, isBundledCli } from './platform.ts';
import { failedFor } from './pluginplan.ts';
import * as engine from './plugins.ts';
import { SAFE_NAME, cachedCatalog, heldBy, installState, parseCatalog, pluginTools, registeredMarketplaces, remoteCopyFolder, sameSource, type PluginContext } from './plugins.ts';
import type { ActionReport, Catalog, HarnessId, InstallState, MarketplaceView, PluginActionResult, PluginDetail, PluginsView, Snapshot } from './types.ts';
import { isFolder, isHttps } from './values.ts';
import { toolNames } from './words.ts';

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
      if (isBundledCli(candidate)) continue;
      try { await access(candidate, constants.X_OK); found[tool] = candidate; break; } catch { /* next */ }
    }
  }
  return found;
}
const realEngine: MarketplaceEngine = { findClis, readCatalog: engine.readCatalog, readRemotePlugin: engine.readRemotePlugin, install: engine.install, uninstall: engine.uninstall };

const toolIds = (value: unknown): HarnessId[] => (Array.isArray(value) ? value.filter((id): id is HarnessId => pluginTools.includes(id as HarnessId)) : []);
/** Reports go to the page without each run's file bytes (kept only for the record here); the page never reads them. */
const lean = (reports: ActionReport[]): ActionReport[] => reports.map(report => ({ ...report, runs: report.runs.map(run => ({ ...run, changed: run.changed.map(change => ({ path: change.path, before: null, after: null })) })) }));
/** A plugin's contents with nothing in them, for a plugin whose files couldn't be read (its `problem` says why). */
const empty: Omit<PluginDetail, 'problem'> = { skills: [], commands: [], agents: [], hooks: [], mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false };

export function createMarketplaces(host: MarketplaceHost, use: MarketplaceEngine = realEngine) {
  const listPath = join(host.dataDir, 'marketplaces.json');
  const added = async (): Promise<string[]> => {
    try { const list = JSON.parse(await readFile(listPath, 'utf8')); return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
  };
  const saveAdded = async (list: string[]) => { await mkdir(host.dataDir, { recursive: true }); await writeFile(listPath, `${JSON.stringify(list, null, 2)}\n`); };
  /**
   * A context for one request. `clis`: look for the tools' CLIs (only a request that runs or reports on them needs them).
   * `shareReads`: read each record once for the whole request; only a read-only view may, because an install reads the
   * tool's records again after its command and must see the change.
   */
  const context = async ({ clis = false, shareReads = false } = {}): Promise<PluginContext> => {
    const open = host.home();
    if (!open) throw new Error('No home is open.');
    return { home: open.home, dataDir: join(host.dataDir, 'plugins'), binaries: clis ? await use.findClis() : {}, overrides: open.overrides, reads: shareReads ? new Map() : undefined };
  };

  /** Each Git catalog as known this session: its catalog, why the last fetch failed, and whether it shows an older copy. */
  const fetched = new Map<string, { catalog?: Catalog; stale?: boolean; problem?: string }>();
  /** A catalog read again is the moment its plugins kept in other repositories are let go, so they are read again too. */
  const dropRemoteCopies = (ctx: PluginContext, catalog: Catalog) => Promise.all(catalog.plugins.map(item => (item.remote ? rm(remoteCopyFolder(ctx, item.remote), { recursive: true, force: true }) : undefined)));
  /**
   * A marketplace's catalog. A folder is read from disk every time (`counts: false` skips reading every plugin's files
   * for the row counts, when only one plugin is needed). A Git marketplace is never fetched on its own: its copy on disk
   * (from this or an earlier session) is used until `fresh` (Refresh, Refresh all), and the network is used only then or
   * while there is no copy yet. A failed fetch keeps showing the copy, marked stale.
   */
  async function catalogFor(ctx: PluginContext, source: string, { fresh = false, counts = true } = {}): Promise<{ catalog?: Catalog; stale?: boolean; problem?: string }> {
    if (isFolder(source)) {
      const catalog = await parseCatalog(source, source, 'folder', { counts });
      if (fresh && !catalog.problem) await dropRemoteCopies(ctx, catalog);
      return { catalog, problem: catalog.problem };
    }
    const known = fetched.get(source);
    if (known && !fresh) return known;
    const onDisk = fresh ? undefined : await cachedCatalog(ctx, source);
    const result = onDisk ? { catalog: onDisk } : await fetchFresh(ctx, source, fresh);
    // Kept for the session only with a catalog to show; a source never read yet is tried again next time.
    if (result.catalog) fetched.set(source, result);
    return result;
  }
  /** Fetches a Git marketplace; on failure, the copy on disk (if any) is kept and marked stale. */
  async function fetchFresh(ctx: PluginContext, source: string, dropCopies: boolean): Promise<{ catalog?: Catalog; stale?: boolean; problem?: string }> {
    const read = await use.readCatalog(ctx, source);
    if (!read.problem) {
      if (dropCopies) await dropRemoteCopies(ctx, read);
      return { catalog: read };
    }
    const older = await cachedCatalog(ctx, source);
    return { catalog: older, problem: read.problem, stale: !!older };
  }

  /** The tools' states for one marketplace's plugins. A tool holding another marketplace under this name is left alone. */
  async function statesFor(ctx: PluginContext, tools: HarnessId[], catalog: Catalog, source: string): Promise<MarketplaceView['states']> {
    const held = new Map<HarnessId, InstallState>();
    for (const tool of tools) {
      const other = await heldBy(ctx, tool, catalog.name, source);
      if (other) held.set(tool, { state: 'held', reason: `${toolNames[tool]} has a different marketplace named “${catalog.name}” (${other}). Central Knot leaves it alone.` });
    }
    const states: MarketplaceView['states'] = {};
    for (const plugin of catalog.plugins) {
      const pairs = await Promise.all(tools.map(async tool => [tool, held.get(tool) ?? await installState(ctx, tool, catalog.name, plugin.name)] as const));
      states[plugin.name] = Object.fromEntries(pairs);
    }
    return states;
  }

  /** One marketplace on the page. A catalog that can't be read becomes a problem on its entry, never a broken page. */
  async function entryView(ctx: PluginContext, tools: HarnessId[], source: string, origins: MarketplaceView['origins'], fresh: boolean): Promise<MarketplaceView> {
    const base: MarketplaceView = { source, origins, name: '', kind: isFolder(source) ? 'folder' : 'git', plugins: [], states: {}, page: marketplacePage(source), sourceLabel: sourceLabel(source) };
    try {
      const { catalog, stale, problem } = await catalogFor(ctx, source, { fresh });
      if (!catalog) return { ...base, problem };
      // The raw entry and remote address stay here; the page gets what it shows.
      const shown = catalog.plugins.map(({ entry: _entry, remote: _remote, ...plugin }) => plugin);
      return { ...base, name: catalog.name, fetchedAt: catalog.fetchedAt, problem, stale, owner: catalog.owner, description: catalog.description, copilotRefuses: catalog.copilotRefuses, plugins: shown, states: await statesFor(ctx, tools, catalog, source) };
    } catch { return { ...base, problem: 'It could not be read.' }; }
  }

  /** Every marketplace: added here, or already added in a tool. `fresh`: one source, or every Git source, fetched again. */
  async function view(fresh?: string | true): Promise<PluginsView> {
    const ctx = await context({ clis: true, shareReads: true });
    const tools = (await host.tools()).filter(tool => pluginTools.includes(tool));
    const access = await host.writeAccess();
    const known: { source: string; origins: MarketplaceView['origins'] }[] = [];
    const note = (source: string, origin: MarketplaceView['origins'][number]) => {
      const entry = known.find(item => sameSource(item.source, source));
      if (entry) { if (!entry.origins.includes(origin)) entry.origins.push(origin); } else known.push({ source, origins: [origin] });
    };
    for (const source of await added()) note(source, 'central-knot');
    // A source that could read as an option is never passed on to a tool or to Git.
    for (const tool of tools) for (const entry of await registeredMarketplaces(ctx, tool)) if (!entry.source.startsWith('-')) note(entry.source, tool);
    const marketplaces: MarketplaceView[] = [];
    for (const { source, origins } of known) marketplaces.push(await entryView(ctx, tools, source, origins, fresh === true || (fresh !== undefined && sameSource(fresh, source))));
    const snapshots = host.home()?.snapshots ?? [];
    const desktopOnly = tools.filter(tool => !ctx.binaries[tool] && snapshots.find(snapshot => snapshot.harness === tool)?.probe.bundled);
    return { home: ctx.home, tools, clis: Object.fromEntries(tools.map(tool => [tool, !!ctx.binaries[tool]])), canWrite: access.allowed, reason: access.allowed ? undefined : access.reason, marketplaces, desktopOnly };
  }

  /** A plugin's contents and README: from the marketplace's files, or from its own repository when it lives elsewhere. */
  async function detail(source: string, plugin: string): Promise<PluginDetail | null> {
    const ctx = await context();
    const { catalog } = await catalogFor(ctx, source, { counts: false });
    const item = catalog?.plugins.find(entry => entry.name === plugin);
    if (!catalog?.root || !item) return null;
    if (item.folder) return pluginDetail(item.folder, item.entry ?? {}, catalog.root, resolve(item.folder) !== resolve(catalog.root));
    if (!item.remote) return null;
    const copy = await use.readRemotePlugin(ctx, item.remote);
    if ('problem' in copy) return { ...empty, problem: `Its files couldn’t be read from ${item.from?.label ?? item.remote.url}: ${copy.problem}` };
    // The entry may list its components; its `source` names the repository, not a path in it.
    const { source: _where, ...listed } = item.entry ?? {};
    return pluginDetail(copy.folder, listed, copy.root);
  }

  /** The marketplace's own README, from the copy already read. */
  async function readme(source: string): Promise<string | null> {
    const { catalog } = await catalogFor(await context(), source, { counts: false });
    return catalog?.root ? (await readmeIn(catalog.root)) ?? null : null;
  }

  /**
   * Adds a marketplace to Central Knot's own list (installs nothing, adds nothing to any tool). It is read first, and only
   * a readable one is added; that read is kept as its catalog. Returns the new view and the source as the view spells it
   * (a source already listed under another spelling keeps its first spelling).
   */
  async function add(source: string): Promise<{ problem?: string; view?: PluginsView; source?: string }> {
    const text = source.trim();
    if (text.startsWith('-')) return { problem: 'That isn’t a marketplace: owner/repo, a Git URL or a folder.' };
    const catalog = await use.readCatalog(await context(), text);
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

  /** Takes a marketplace off Central Knot's own list. Tools that added it keep it, and nothing is uninstalled. */
  async function forget(source: string): Promise<PluginsView> {
    await saveAdded((await added()).filter(item => !sameSource(item, source)));
    for (const known of fetched.keys()) if (sameSource(known, source)) fetched.delete(known);
    return view();
  }

  // Writes act only on the home on screen, and only where writing is allowed there.
  const guard = async (home: unknown) => {
    if (home !== host.home()?.home) return 'The home on screen is not the one open. Nothing was changed. Read it again.';
    const access = await host.writeAccess();
    return access.allowed ? undefined : access.reason ?? 'Writing isn’t allowed in this home, so nothing was changed.';
  };

  /** Each tool's own install. A plugin gone from the marketplace fails for its tools instead of stopping the whole run. */
  async function install(source: string, plugin: string, tools: HarnessId[], home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home);
    if (stopped) return { stopped, reports: [] };
    const ctx = await context({ clis: true });
    const { catalog } = await catalogFor(ctx, source, { counts: false });
    if (!catalog?.plugins.some(item => item.name === plugin)) return { reports: failedFor(tools, 'It is no longer in the marketplace as last read. Refresh the marketplace.') };
    const reports: ActionReport[] = [];
    for (const tool of tools) reports.push(await use.install(ctx, catalog, plugin, tool));
    return { reports: lean(reports) };
  }

  /** One tool's own uninstall of one plugin. `marketName` is the catalog's name for it; `source` is checked against what the tool has. */
  async function uninstall(source: string, marketName: string, plugin: string, tool: HarnessId, home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home);
    if (stopped) return { stopped, reports: [] };
    return { reports: lean([await use.uninstall(await context({ clis: true }), marketName, plugin, tool, source)]) };
  }

  return { view, detail, readme, add, refresh, forget, install, uninstall };
}

type Handle = (channel: string, work: (...args: unknown[]) => Promise<unknown>) => void;
const isText = (value: unknown, max = 2000): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
/** A marketplace or plugin name as the tools accept it; anything else never reaches a command line. */
const isName = (value: unknown): value is string => typeof value === 'string' && SAFE_NAME.test(value);

/** The Plugins page's requests. Each checks its arguments; anything malformed is refused, never guessed at. */
export function registerMarketplaces(handle: Handle, host: MarketplaceHost): void {
  const markets = createMarketplaces(host);
  const open = () => !!host.home();
  handle('plugins:view', async fresh => (open() ? markets.view(fresh === true ? true : undefined) : null));
  handle('plugins:readme', async source => (open() && isText(source) ? markets.readme(source) : null));
  handle('plugins:detail', async (source, plugin) => (open() && isText(source) && isName(plugin) ? markets.detail(source, plugin) : null));
  // Links from READMEs and marketplaces open in the browser: https only, and never inside the app.
  handle('open:external', async url => { if (isHttps(url)) await host.openExternal(url); });
  handle('plugins:add', async source => { if (!open() || !isText(source)) throw new Error('Invalid marketplace.'); return markets.add(source); });
  handle('plugins:refresh', async source => (open() && isText(source) ? markets.refresh(source) : null));
  handle('plugins:forget', async source => (open() && isText(source) ? markets.forget(source) : null));
  handle('plugins:pick-folder', async () => (await host.pickFolder()) ?? null);
  // A malformed step fails for its tools, so it never stops (and then blocks) every later Apply all.
  const refused = (tools: unknown) => ({ reports: failedFor(toolIds(Array.isArray(tools) ? tools : [tools]), 'That request was malformed, so nothing ran.') });
  handle('plugins:install', async (source, plugin, tools, home) => (open() && isText(source) && isName(plugin) ? markets.install(source, plugin, toolIds(tools), home) : refused(tools)));
  handle('plugins:uninstall', async (source, marketplace, plugin, tool, home) => {
    const ids = toolIds([tool]);
    return open() && isText(source) && isName(marketplace) && isName(plugin) && ids.length ? markets.uninstall(source, marketplace, plugin, ids[0]!, home) : refused(tool);
  });
}
