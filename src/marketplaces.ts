// Marketplaces in the main process: the list added here, each catalog as last read, what each tool has installed, and the
// requests the Plugins page makes. Kept apart from the other features: createMarketplaces holds the logic as plain
// functions (tested), and registerMarketplaces wires them to IPC with a few host functions from main.ts.
import { access, constants, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexManifest, marketplacePage, pluginContents, pluginDetail, readmeIn, sourceLabel } from './catalogdetail.ts';
import { harnesses } from './harnesses.ts';
import { executableCandidates, isBundledCli } from './platform.ts';
import { failedFor } from './pluginplan.ts';
import * as engine from './plugins.ts';
import { pluginTools, type PluginTool } from './presence.ts';
import type { ActionReport, Catalog, CatalogPlugin, HarnessId, InstallState, InstalledCopy, MarketplaceView, PluginActionResult, PluginDetail, PluginsView, Snapshot } from './types.ts';
import { writeDurably } from './share.ts';
import { heldReason } from './pluginstatus.ts';
import { isFolder, isHttps, onlyAllowed } from './values.ts';

/** What the marketplace feature needs from the app around it. */
export interface MarketplaceHost {
  /** The home on screen, or undefined before one is open. */
  home(): { home: string; overrides?: Partial<Record<HarnessId, string>> } | undefined;
  /**
   * This home's tools, in the order the page shows them, and the snapshots they were found in: one read (or the read a
   * Refresh or home switch just made, named by `readId`), so the columns and what each tool's install says always agree.
   */
  read(readId?: number): Promise<{ tools: HarnessId[]; snapshots: Snapshot[] }>;
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
  checkAccess: typeof engine.checkAccess;
  readCatalog: typeof engine.readCatalog;
  readRemotePlugin: typeof engine.readRemotePlugin;
  install: typeof engine.install;
  uninstall: typeof engine.uninstall;
}

/**
 * A tool's own CLI, never an app's bundled copy (CD §3), from the same candidate list version probes use. Searched in
 * this computer's own home, not the home on screen: a Practice copy or backup has no CLIs of its own, and the CLIs found
 * here are pointed at the home on screen when they run.
 */
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
const realEngine: MarketplaceEngine = { findClis, checkAccess: engine.checkAccess, readCatalog: engine.readCatalog, readRemotePlugin: engine.readRemotePlugin, install: engine.install, uninstall: engine.uninstall };

/** Tools named by the page: only those that install plugins. */
const toolIds = (value: unknown): PluginTool[] => onlyAllowed(value, pluginTools);
/** Reports go to the page without each run's file bytes (kept only for the record here); the page never reads them. */
const withoutFileBytes = (reports: ActionReport[]): ActionReport[] => reports.map(report => ({ ...report, runs: report.runs.map(run => ({ ...run, changed: run.changed.map(change => ({ path: change.path, before: null, after: null })) })) }));
/** How long a Git source that couldn't be fetched (with no copy to show) waits before it is tried again on its own. */
const RETRY_MS = 60_000;
/** A plugin's contents with nothing in them, for a plugin whose files couldn't be read (its `problem` says why). */
const empty: PluginDetail = { skills: [], commands: [], agents: [], hooks: [], mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false, offered: false };

export function createMarketplaces(host: MarketplaceHost, use: MarketplaceEngine = realEngine) {
  const listPath = join(host.dataDir, 'marketplaces.json');
  const added = async (): Promise<string[]> => {
    try { const list = JSON.parse(await readFile(listPath, 'utf8')); return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
  };
  const saveAdded = (list: string[]) => writeDurably(listPath, `${JSON.stringify(list, null, 2)}\n`);
  /** A context for one request. `clis`: look for the tools' CLIs (only a request that runs or reports on them needs them). */
  const context = async ({ clis = false } = {}): Promise<engine.PluginContext> => {
    const open = host.home();
    if (!open) throw new Error('No home is open.');
    return { home: open.home, dataDir: join(host.dataDir, 'plugins'), binaries: clis ? await use.findClis() : {}, overrides: open.overrides };
  };

  /**
   * Each Git catalog as known this session: its catalog, why the last fetch failed, and whether it shows an older copy.
   * `at` is when a fetch failed with no copy to show, so an unreachable source is tried again only after RETRY_MS (or on
   * Refresh), not on every redraw of the page.
   */
  const fetched = new Map<string, { catalog?: Catalog; stale?: boolean; problem?: string; at?: number }>();
  /** A catalog read again is the moment its plugins kept in other repositories are let go, so they are read again too. */
  const dropRemoteCopies = (ctx: engine.PluginContext, catalog: Catalog) => Promise.all(catalog.plugins.map(item => (item.remote ? rm(engine.remoteCopyFolder(ctx, item.remote), { recursive: true, force: true }) : undefined)));
  /**
   * A marketplace's catalog. A folder is read from disk every time (`counts: false` skips reading every plugin's files
   * for the row counts, when only one plugin is needed). A Git marketplace is never fetched on its own: its copy on disk
   * (from this or an earlier session) is used until `fresh` (Refresh, Refresh all), and the network is used only then or
   * while there is no copy yet. A failed fetch keeps showing the copy, marked stale.
   */
  async function catalogFor(ctx: engine.PluginContext, source: string, { fresh = false, counts = true } = {}): Promise<{ catalog?: Catalog; stale?: boolean; problem?: string }> {
    if (isFolder(source)) {
      const catalog = await engine.parseCatalog(source, source, 'folder', { counts });
      if (fresh && !catalog.problem) await dropRemoteCopies(ctx, catalog);
      return { catalog, problem: catalog.problem };
    }
    const known = fetched.get(source);
    if (known && !fresh && (known.catalog || Date.now() - (known.at ?? 0) < RETRY_MS)) return known;
    const onDisk = fresh ? undefined : await engine.cachedCatalog(ctx, source);
    const result = onDisk ? { catalog: onDisk } : await fetchFresh(ctx, source, fresh);
    fetched.set(source, result.catalog ? result : { ...result, at: Date.now() });
    return result;
  }
  /** Fetches a Git marketplace; on failure, the copy on disk (if any) is kept and marked stale. */
  async function fetchFresh(ctx: engine.PluginContext, source: string, dropCopies: boolean): Promise<{ catalog?: Catalog; stale?: boolean; problem?: string }> {
    const read = await use.readCatalog(ctx, source);
    if (!read.problem) {
      if (dropCopies) await dropRemoteCopies(ctx, read);
      return { catalog: read };
    }
    const older = await engine.cachedCatalog(ctx, source);
    return { catalog: older, problem: read.problem, stale: !!older };
  }

  /** The tools' states for the given plugins of one marketplace. A tool holding another marketplace under this name is left alone. */
  async function statesFor(ctx: engine.PluginContext, tools: PluginTool[], catalog: Catalog, source: string, plugins = catalog.plugins): Promise<MarketplaceView['states']> {
    const held = new Map<HarnessId, InstallState>();
    for (const tool of tools) {
      const other = await engine.heldBy(ctx, tool, catalog.name, source);
      if (other) held.set(tool, { state: 'held', reason: heldReason(tool, catalog.name, other) });
    }
    const states: MarketplaceView['states'] = {};
    for (const plugin of plugins) {
      const pairs = await Promise.all(tools.map(async tool => [tool, held.get(tool) ?? await engine.installState(ctx, tool, catalog.name, plugin.name)] as const));
      states[plugin.name] = Object.fromEntries(pairs);
    }
    return states;
  }

  /**
   * Each tool's installed copy of one plugin, read from the folder that tool keeps it in, as that tool reads it (see
   * pluginContents): Claude Code and Copilot CLI by the copy's own plugin.json with the marketplace entry's part lists
   * added (paths a copy of another release doesn't have are simply not found); Codex by the one manifest it picks, its
   * .codex-plugin one when the copy has it, without the entry. A copy's commands and agents are listed as it holds them;
   * "In each tool" says what each tool does with them. The detail request names just a source and a plugin, so the tools
   * and their install states are read here again.
   */
  async function installedCopies(ctx: engine.PluginContext, catalog: Catalog, source: string, item: CatalogPlugin): Promise<Partial<Record<HarnessId, InstalledCopy>>> {
    const tools = toolIds((await host.read()).tools);
    const states = (await statesFor(ctx, tools, catalog, source, [item]))[item.name] ?? {};
    const copies = await Promise.all(Object.entries(states).map(async ([tool, state]) => {
      if (state?.state !== 'installed') return undefined;
      const codex = tool === 'codex-cli' ? await codexManifest(state.path) : undefined;
      const { skills, commands, agents } = await pluginContents(state.path, item.entry ?? {}, state.path, { codex, atMarketplaceRoot: !!item.isMarketplaceRoot });
      return [tool, { skills, commands, agents, version: state.version }] as const;
    }));
    return Object.fromEntries(copies.filter(copy => !!copy));
  }

  /** One marketplace on the page. A catalog that can't be read becomes a problem on its entry, never a broken page. */
  async function entryView(ctx: engine.PluginContext, tools: PluginTool[], source: string, origins: MarketplaceView['origins'], fresh: boolean): Promise<MarketplaceView> {
    const base: MarketplaceView = { source, origins, name: '', kind: isFolder(source) ? 'folder' : 'git', plugins: [], states: {}, page: marketplacePage(source), sourceLabel: sourceLabel(source) };
    try {
      const { catalog, stale, problem } = await catalogFor(ctx, source, { fresh });
      if (!catalog) return { ...base, problem };
      // The raw entry and remote address stay here; the page gets what it shows.
      const shown = catalog.plugins.map(({ entry: _entry, remote: _remote, ...plugin }) => plugin);
      return { ...base, name: catalog.name, fetchedAt: catalog.fetchedAt, problem, stale, owner: catalog.owner, description: catalog.description, copilotRefuses: catalog.copilotRefuses, plugins: shown, states: await statesFor(ctx, tools, catalog, source) };
    } catch { return { ...base, problem: 'It could not be read.' }; }
  }

  /** Every marketplace: added here, or already added in a tool. `fresh`: every Git source fetched again. */
  async function view(fresh = false, readId?: number): Promise<PluginsView> {
    const ctx: engine.PluginContext = { ...(await context({ clis: true })), reads: new Map() };
    const read = await host.read(readId);
    const tools = toolIds(read.tools);
    const writing = await host.writeAccess();
    const known: { source: string; origins: MarketplaceView['origins'] }[] = [];
    const note = (source: string, origin: MarketplaceView['origins'][number]) => {
      const entry = known.find(item => engine.sameSource(item.source, source));
      if (entry) { if (!entry.origins.includes(origin)) entry.origins.push(origin); } else known.push({ source, origins: [origin] });
    };
    for (const source of await added()) note(source, 'central-knot');
    // A source that could read as an option is never passed on to a tool or to Git.
    for (const tool of tools) for (const entry of await engine.registeredMarketplaces(ctx, tool)) if (!entry.source.startsWith('-')) note(entry.source, tool);
    const marketplaces: MarketplaceView[] = [];
    // All at once: one unreachable source doesn't hold up the others.
    marketplaces.push(...await Promise.all(known.map(({ source, origins }) => entryView(ctx, tools, source, origins, fresh))));
    const desktopOnly = tools.filter(tool => !ctx.binaries[tool] && read.snapshots.find(snapshot => snapshot.harness === tool)?.probe.bundled);
    return { home: ctx.home, tools, clis: Object.fromEntries(tools.map(tool => [tool, !!ctx.binaries[tool]])), canWrite: writing.allowed, reason: writing.allowed ? undefined : writing.reason, marketplaces, desktopOnly };
  }

  /**
   * A plugin's contents and README, from the marketplace's files or, when it lives elsewhere, its own repository; with
   * each tool's installed copy, which may be another version.
   */
  async function detail(source: string, plugin: string): Promise<PluginDetail | null> {
    const ctx = await context();
    const { catalog } = await catalogFor(ctx, source, { counts: false });
    const item = catalog?.plugins.find(entry => entry.name === plugin);
    if (!catalog?.root || !item) return null;
    const [offered, installed] = await Promise.all([offeredDetail(ctx, catalog.root, item), installedCopies(ctx, catalog, source, item)]);
    if (offered) return { ...offered, installed };
    // Files the marketplace can't give (an npm or pip package) may still be read from a tool that installed it.
    return Object.keys(installed).length ? { ...empty, installed } : null;
  }

  /** What the marketplace offers of one plugin: from its own folder, or read from the repository it is kept in. */
  async function offeredDetail(ctx: engine.PluginContext, root: string, item: CatalogPlugin): Promise<PluginDetail | null> {
    if (item.folder) return pluginDetail(item.folder, item.entry ?? {}, root, !!item.isMarketplaceRoot);
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
    if (/^(\.\.?|~)([\\/]|$)/.test(text)) return { problem: 'Use the folder’s full path, or choose it with Folder…' };
    const ctx = await context();
    // A Git source is asked for access before it is fetched: one that can't be read adds nothing and copies nothing (MKT-05).
    const access = isFolder(text) ? undefined : await use.checkAccess(ctx, text);
    if (access && access.state !== 'ok') return { problem: access.message };
    const catalog = await use.readCatalog(ctx, text);
    if (catalog.problem) return { problem: catalog.problem };
    const list = await added();
    const listedAs = list.find(item => engine.sameSource(item, text));
    if (!listedAs) await saveAdded([...list, text]);
    const stored = listedAs ?? text;
    // The read just made is the catalog: the view uses it instead of fetching again.
    if (!isFolder(stored)) fetched.set(stored, { catalog });
    const shown = await view();
    return { view: shown, source: shown.marketplaces.find(entry => engine.sameSource(entry.source, stored))?.source ?? stored };
  }

  /** Takes a marketplace off Central Knot's own list. Tools that added it keep it, and nothing is uninstalled. */
  async function forget(source: string): Promise<PluginsView> {
    await saveAdded((await added()).filter(item => !engine.sameSource(item, source)));
    for (const known of fetched.keys()) if (engine.sameSource(known, source)) fetched.delete(known);
    const shown = await view();
    // Its copy goes too, unless a tool still lists it (then the page still shows it, from that copy).
    if (!isFolder(source) && !shown.marketplaces.some(entry => engine.sameSource(entry.source, source))) await rm(engine.catalogFolder(await context(), source), { recursive: true, force: true });
    return shown;
  }

  // Writes act only on the home on screen, and only where writing is allowed there.
  const guard = async (home: unknown) => {
    if (home !== host.home()?.home) return 'The home on screen is not the one open. Nothing was changed. Read it again.';
    const writing = await host.writeAccess();
    return writing.allowed ? undefined : writing.reason ?? 'Writing isn’t allowed in this home, so nothing was changed.';
  };

  /**
   * Each tool's own install. A plugin gone from the marketplace, or a marketplace that now gives another name than the
   * one chosen (`marketName`), fails for its tools instead of stopping the whole run.
   */
  async function install(source: string, marketName: string, plugin: string, tools: PluginTool[], home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home);
    if (stopped) return { stopped, reports: [] };
    const ctx: engine.PluginContext = { ...(await context({ clis: true })), checked: new Map() };
    const { catalog } = await catalogFor(ctx, source, { counts: false });
    if (!catalog?.plugins.some(item => item.name === plugin)) return { reports: failedFor(tools, 'It is no longer in the marketplace as last read. Refresh the marketplace.') };
    if (catalog.name !== marketName) return { reports: failedFor(tools, `Its marketplace is now named “${catalog.name}”, not “${marketName}”. Refresh, then choose it again.`) };
    // One tool's error fails that tool only: what earlier tools did stays reported (and undoable), and later tools still run.
    const reports: ActionReport[] = [];
    for (const tool of tools) {
      try { reports.push(await use.install(ctx, catalog, plugin, tool)); }
      catch (error) { reports.push(...failedFor([tool], `It stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`)); }
    }
    return { reports: withoutFileBytes(reports) };
  }

  /** One tool's own uninstall of one plugin. `marketName` is the catalog's name for it; `source` is checked against what the tool has. */
  async function uninstall(source: string, marketName: string, plugin: string, tool: PluginTool, home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home);
    if (stopped) return { stopped, reports: [] };
    return { reports: withoutFileBytes([await use.uninstall(await context({ clis: true }), marketName, plugin, tool, source)]) };
  }

  return { view, detail, readme, add, forget, install, uninstall };
}

type Handle = (channel: string, work: (...args: unknown[]) => Promise<unknown>) => void;
const isText = (value: unknown, max = 2000): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
/** A marketplace or plugin name as the tools accept it; anything else never reaches a command line. */
const isName = (value: unknown): value is string => typeof value === 'string' && engine.SAFE_NAME.test(value);

/**
 * The Plugins page's requests. Each checks its arguments; anything malformed is refused, never guessed at. `handle`
 * queues a request behind the app's other work; `handleNow` answers at once, for requests that change nothing a tool uses.
 */
export function registerMarketplaces({ handle, handleNow }: { handle: Handle; handleNow: Handle }, host: MarketplaceHost): void {
  const markets = createMarketplaces(host);
  const open = () => !!host.home();
  handle('plugins:view', async (fresh, readId) => (open() ? markets.view(fresh === true, typeof readId === 'number' ? readId : undefined) : null));
  handleNow('plugins:readme', async source => (open() && isText(source) ? markets.readme(source) : null));
  handleNow('plugins:detail', async (source, plugin) => (open() && isText(source) && isName(plugin) ? markets.detail(source, plugin) : null));
  // Links from READMEs and marketplaces open in the browser: https only, and never inside the app.
  handleNow('open:external', async url => { if (isHttps(url)) await host.openExternal(url); });
  handle('plugins:add', async source => { if (!open() || !isText(source)) throw new Error('Invalid marketplace.'); return markets.add(source); });
  handle('plugins:forget', async source => (open() && isText(source) ? markets.forget(source) : null));
  handle('plugins:pick-folder', async () => (await host.pickFolder()) ?? null);
  // A malformed step fails for its tools, so it never stops (and then blocks) every later Apply all.
  const refused = (tools: unknown) => ({ reports: failedFor(toolIds(Array.isArray(tools) ? tools : [tools]), 'That request was malformed, so nothing ran.') });
  handle('plugins:install', async (source, marketName, plugin, tools, home) => (open() && isText(source) && isName(marketName) && isName(plugin) ? markets.install(source, marketName, plugin, toolIds(tools), home) : refused(tools)));
  handle('plugins:uninstall', async (source, marketplace, plugin, tool, home) => {
    const ids = toolIds([tool]);
    return open() && isText(source) && isName(marketplace) && isName(plugin) && ids.length ? markets.uninstall(source, marketplace, plugin, ids[0]!, home) : refused(tool);
  });
}
