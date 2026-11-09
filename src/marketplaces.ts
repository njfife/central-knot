// Marketplaces in the main process: the list added here, each catalog as last read, what each tool has installed, and the
// requests the Plugins page makes. Kept apart from the other features; main.ts registers it with a few host functions.
import { access, constants, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { entryIn, marketplacePage, pluginDetail, readmeIn, remoteOf } from './catalogdetail.ts';
import { harnesses } from './harnesses.ts';
import { executableCandidates } from './platform.ts';
import { cachedCatalog, install, installState, isFolder, outcomes, parseCatalog, pluginTools, readCatalog, readRemotePlugin, registeredMarketplaces, sameSource, uninstall, type PluginContext } from './plugins.ts';
import type { ActionReport, Catalog, HarnessId, MarketplaceView, PluginDetail, PluginsView, Snapshot } from './types.ts';

/** What the marketplace feature needs from the app around it. */
export interface MarketplaceHost {
  /** The home on screen, or undefined before one is open. */
  home(): { home: string; snapshots: Snapshot[]; overrides?: Partial<Record<HarnessId, string>> } | undefined;
  /** This home's tools, in the order the page shows them. */
  tools(): Promise<HarnessId[]>;
  /** Whether writing is allowed in this home, and why not. */
  writeAccess(): Promise<{ allowed: boolean; reason?: string }>;
  /** Central Knot's own data folder (the added list and Git copies live there). */
  dataDir: string;
  pickFolder(): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
}
type Handle = (channel: string, work: (...args: unknown[]) => Promise<unknown>) => void;

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

const toolIds = (value: unknown): HarnessId[] => (Array.isArray(value) ? value.filter((id): id is HarnessId => pluginTools.includes(id as HarnessId)) : []);
const failed = (tools: HarnessId[], message: string): ActionReport[] => tools.map(tool => ({ tool, outcome: 'failed', message, runs: [] }));

export function registerMarketplaces(handle: Handle, host: MarketplaceHost): void {
  const listPath = join(host.dataDir, 'marketplaces.json');
  const added = async (): Promise<string[]> => {
    try { const list = JSON.parse(await readFile(listPath, 'utf8')); return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
  };
  const saveAdded = async (list: string[]) => { await mkdir(host.dataDir, { recursive: true }); await writeFile(listPath, `${JSON.stringify(list, null, 2)}\n`); };
  const context = async (): Promise<PluginContext> => ({ home: host.home()!.home, dataDir: join(host.dataDir, 'plugins'), binaries: await findClis(), overrides: host.home()!.overrides });

  /** Each catalog as last read this session, with why the last fetch failed; a fresh read replaces it. */
  const catalogs = new Map<string, { catalog?: Catalog; stale?: boolean; problem?: string }>();
  async function catalogFor(plugins: PluginContext, source: string, fresh = false) {
    const known = catalogs.get(source);
    if (known && !fresh) return known;
    let result: { catalog?: Catalog; stale?: boolean; problem?: string };
    if (isFolder(source)) { const catalog = await parseCatalog(source, source, 'folder'); result = { catalog, problem: catalog.problem }; }
    else {
      const read = fresh || !(await cachedCatalog(plugins, source)) ? await readCatalog(plugins, source) : undefined;
      const catalog = read && !read.problem ? read : await cachedCatalog(plugins, source);
      result = { catalog, problem: read?.problem, stale: !!read?.problem && !!catalog };
    }
    catalogs.set(source, result);
    return result;
  }

  async function view(fresh?: string): Promise<PluginsView> {
    const plugins = await context();
    const tools = (await host.tools()).filter(tool => pluginTools.includes(tool));
    const access = await host.writeAccess();
    const known: { source: string; origins: MarketplaceView['origins'] }[] = [];
    const note = (source: string, origin: MarketplaceView['origins'][number]) => {
      const entry = known.find(item => sameSource(item.source, source));
      if (entry) { if (!entry.origins.includes(origin)) entry.origins.push(origin); } else known.push({ source, origins: [origin] });
    };
    for (const source of await added()) note(source, 'central-knot');
    for (const tool of tools) for (const entry of await registeredMarketplaces(plugins, tool)) note(entry.source, tool);
    const marketplaces: MarketplaceView[] = [];
    for (const { source, origins } of known) {
      const { catalog, stale, problem } = await catalogFor(plugins, source, fresh !== undefined && sameSource(fresh, source));
      const entry: MarketplaceView = { source, origins, name: catalog?.name ?? '', kind: isFolder(source) ? 'folder' : 'git', fetchedAt: catalog?.fetchedAt, problem, stale, plugins: [], states: {}, owner: catalog?.owner, description: catalog?.description, page: marketplacePage(source) };
      for (const plugin of catalog?.plugins ?? []) {
        entry.plugins.push({ ...plugin, outcomes: plugin.components ? Object.fromEntries(tools.map(tool => [tool, outcomes(tool, plugin.components!)])) : {} });
        entry.states[plugin.name] = Object.fromEntries(await Promise.all(tools.map(async tool => [tool, await installState(plugins, tool, catalog!.name, plugin.name)] as const)));
      }
      marketplaces.push(entry);
    }
    const desktopOnly = tools.filter(tool => !plugins.binaries[tool] && host.home()?.snapshots.find(snapshot => snapshot.harness === tool)?.probe.bundled);
    return { home: plugins.home, tools, clis: Object.fromEntries(tools.map(tool => [tool, !!plugins.binaries[tool]])), canWrite: access.allowed, reason: access.allowed ? undefined : access.reason, marketplaces, desktopOnly };
  }

  /** A plugin's contents and README: from the marketplace's files, or from its own repository when it lives elsewhere. */
  async function detail(source: string, plugin: string): Promise<PluginDetail | null> {
    const plugins = await context();
    const { catalog } = await catalogFor(plugins, source);
    const item = catalog?.plugins.find(entry => entry.name === plugin);
    if (!catalog?.root || !item) return null;
    const entry = await entryIn(catalog.root, plugin);
    if (item.folder) return pluginDetail(item.folder, entry, catalog.root);
    const remote = remoteOf(entry.source);
    if (!remote) return null;
    const copy = await readRemotePlugin(plugins, remote);
    if ('problem' in copy) return { skills: [], commands: [], agents: [], hooks: [], mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false, problem: `Its files couldn’t be read from ${item.from?.label ?? remote.url}: ${copy.problem}` };
    return { ...(await pluginDetail(copy.folder, {}, copy.root)), readFrom: item.from?.label ?? remote.url };
  }

  // Writes act only on the home on screen, and only where writing is allowed there.
  const guard = async (home: unknown) => {
    if (home !== host.home()?.home) return 'The home on screen is not the one open. Nothing was installed. Read it again.';
    const access = await host.writeAccess();
    return access.allowed ? undefined : access.reason;
  };

  handle('plugins:view', async () => (host.home() ? view() : null));
  // A marketplace's README (no plugin), or one plugin's contents and README, read when its page opens. Never fetches a
  // marketplace: it reads the copy already made.
  handle('plugins:detail', async (source, plugin) => {
    if (!host.home() || typeof source !== 'string' || (plugin !== undefined && typeof plugin !== 'string')) return null;
    if (plugin !== undefined) return detail(source, plugin);
    const { catalog } = await catalogFor(await context(), source);
    return catalog?.root ? { readme: await readmeIn(catalog.root) } : null;
  });
  // Links from READMEs and marketplaces open in the browser: https only, and never inside the app.
  handle('open:external', async url => { if (typeof url === 'string' && /^https:\/\/\S+$/.test(url) && url.length < 2000) await host.openExternal(url); });
  handle('plugins:add', async source => {
    if (typeof source !== 'string' || !source.trim() || source.length > 2000) throw new Error('Invalid marketplace.');
    const text = source.trim();
    const catalog = await readCatalog(await context(), text);
    if (catalog.problem) return { problem: catalog.problem };
    catalogs.delete(text);
    const list = await added();
    const stored = list.find(item => sameSource(item, text)) ?? text;
    if (stored === text && !list.includes(text)) await saveAdded([...list, text]);
    const shown = await view(text);
    return { view: shown, source: shown.marketplaces.find(entry => sameSource(entry.source, stored))?.source ?? stored };
  });
  handle('plugins:refresh', async source => (typeof source === 'string' ? view(source) : null));
  handle('plugins:forget', async source => {
    if (typeof source !== 'string') return null;
    await saveAdded((await added()).filter(item => !sameSource(item, source)));
    catalogs.delete(source);
    return view();
  });
  handle('plugins:pick-folder', async () => (await host.pickFolder()) ?? null);
  // Each tool's own install; a plugin gone from the marketplace fails for its tools instead of stopping the whole run.
  handle('plugins:install', async (source, plugin, tools, home) => {
    const stopped = await guard(home);
    if (stopped || typeof source !== 'string' || typeof plugin !== 'string') return { stopped: stopped ?? 'Invalid request.', reports: [] };
    const plugins = await context();
    const { catalog } = await catalogFor(plugins, source);
    const chosen = toolIds(tools);
    if (!catalog?.plugins.some(item => item.name === plugin)) return { reports: failed(chosen, 'It is no longer in the marketplace as last read. Refresh the marketplace.') };
    const reports: ActionReport[] = [];
    for (const tool of chosen) reports.push(await install(plugins, catalog, plugin, tool));
    return { reports };
  });
  handle('plugins:uninstall', async (marketplace, plugin, tool, home) => {
    const stopped = await guard(home);
    if (stopped || typeof marketplace !== 'string' || typeof plugin !== 'string' || !toolIds([tool]).length) return { stopped: stopped ?? 'Invalid request.', reports: [] };
    return { reports: [await uninstall(await context(), marketplace, plugin, tool as HarnessId)] };
  });
}
