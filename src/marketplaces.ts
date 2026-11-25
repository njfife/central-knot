// Marketplaces in the main process: the list added here, each catalog as last read, what each tool has installed, and the
// requests the Plugins page makes. Kept apart from the other features: createMarketplaces holds the logic as plain
// functions (tested), and registerMarketplaces wires them to IPC with a few host functions from main.ts.
import { access, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { inside, installedContents, marketplacePage, pluginDetail, pluginFiles, readmeIn, sourceLabel, type PluginFiles } from './catalogdetail.ts';
import { searchPath } from './platform.ts';
import { failedFor, reverse, runPlan, succeeded, type PlanApi, type PluginDone, type PluginOp } from './pluginplan.ts';
import { clickGoes, clickHeld, clickRuns, entryOf, firstEntry, firstRecord, newEntry, owedTo, readPluginRecord, savePluginRecord, withEntry, type Holding, type Owed, type PluginEntry, type PluginRecord, type PluginSwitch, type WaitedBefore } from './pluginrecord.ts';
import { findBinary, probeVersion } from './discovery.ts';
import * as engine from './plugins.ts';
import { suggestedMarketplaces, type SuggestedMarketplace } from './suggested.ts';
import { itemTools, itemsBack, itemsView, lookAtKinds, readPlugin, runItems, withItemsOf, type ItemsAsk, type ItemState, type KindLooks } from './pluginlibrary.ts';
import { recordedIds } from './sourcestore.ts';
import { holds, pluginTools, takesPlugins, type PluginTool } from './presence.ts';
import { waysFrom } from './reload.ts';
import type { ItemKind } from './library.ts';
import type { ActionReport, BundledView, Catalog, ListedReport, DesktopApp, CatalogPlugin, HarnessId, InstallState, InstalledCopy, MarketplaceView, PartRef, PluginActionResult, PluginDetail, PluginTurn, PluginTurnResult, PluginView, PluginsView, Snapshot, SyncNotice, YourName } from './types.ts';
import { harnessIds } from './harnesses.ts';
import { errorCode, liftFirst, syncGate, writeDurably, type ShareContext } from './share.ts';
import type { Listed } from './plugintext.ts';
import { readRecord as readPartsRecord, type PartsRecord, type PluginNow } from './partsmigrate.ts';
import { MARKET_UNREAD, SKILL_SWITCH_TESTED_FROM, copyDiffers, partWords, firstReadWaits, heldReason, keptReason, marketTitle, notCarried, recordUnread, toolNow, updateTools, versionToCompare, waitsToMove } from './pluginstatus.ts';
import { readLink } from './sourcelink.ts';
import { isFolder, isHttps, onlyAllowed, record, shortBuild } from './values.ts';
import { leftOutSentence, pageNames, toPluginsLabel, toolName } from './words.ts';

/** What runs a tool's plugin commands when it is a desktop app's own copy: "Claude desktop’s Code tab 2.1.321". */
export const viaLabel = (app: DesktopApp, answered = app.carriedVersion) => `${app.name}’s ${app.carries}${answered ? ` ${shortBuild(answered)}` : ''}`;

/** What the marketplace feature needs from the app around it. */
export interface MarketplaceHost {
  /** The home on screen, or undefined before one is open. `actual`: it is this computer's own home, not a folder opened as one. */
  home(): { home: string; overrides?: Partial<Record<HarnessId, string>>; actual?: boolean } | undefined;
  /**
   * The tools Central Knot manages in this home (presence.ts managedTools), in the order the page shows them, and the snapshots
   * they were found in: one read (or the read a Refresh or home switch just made, named by `readId`), so the columns and what
   * each tool's install says always agree.
   */
  read(readId?: number): Promise<{ tools: HarnessId[]; snapshots: Snapshot[] }>;
  /** The tools whose Manage switch is off here (share.ts SyncRecord leftOut): no plugin action writes in them, whatever a request names. */
  leftOut?(): Promise<HarnessId[]>;
  /** Whether writing is allowed in this home, and why not. */
  writeAccess(): Promise<{ allowed: boolean; reason?: string }>;
  /** Central Knot's own data folder: the added list here, Git copies under plugins/. */
  dataDir: string;
  pickFolder(): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  /**
   * The skills, MCP and agents engines' context for the home on screen, for a plugin's items in Pi, OpenCode and Antigravity (pluginlibrary.ts)
   * and the record of parts from before the library (partsmigrate.ts). Without it, Pi, OpenCode and Antigravity are no columns.
   */
  share?(): ShareContext;
  /** Why the move of parts from before the library waits, as the last pass gave it (main.ts pass); none when it doesn't. */
  partsWait?(): string | undefined;
  /** A plugin was installed, updated or uninstalled in these tools, and it worked. */
  changed?(source: string, plugin: string, tools: HarnessId[]): void;
  /** A bundled build's own marketplace (bundle.ts): the folder it is unpacked in, and how the page shows it. Always listed, first. */
  bundled?(): { source: string; view: BundledView } | undefined;
  /** What a run on a plugin's items told the Library (pluginlibrary.ts runItems), to show there once, as a pass's notices are. */
  notices?(kind: ItemKind, notices: SyncNotice[]): void;
  /** The installs the version before waited to make in a tool new here, in the open home (pluginupdates.ts waitedBefore): read once, by the plugins record's first read. */
  waitedBefore?(): Promise<WaitedBefore[]>;
  /** Every marketplace was listed again (a view of them all; `fresh`: each Git catalog was fetched first), for the plugin text (plugintext.ts listed). */
  listed?(listing: Listed, fresh: boolean): void;
}
/** The engine calls that touch Git or a tool, replaceable in tests. */
export interface MarketplaceEngine {
  findClis(): Promise<Routes>;
  checkAccess: typeof engine.checkAccess;
  addMarketplace: typeof engine.addMarketplace;
  readCatalog: typeof engine.readCatalog;
  readRemotePlugin: typeof engine.readRemotePlugin;
  install: typeof engine.install;
  uninstall: typeof engine.uninstall;
  update: typeof engine.update;
  setSkill: typeof engine.setSkill;
  setPart: typeof engine.setPart;
  setWhole: typeof engine.setWhole;
}

/** How the plugins record was read for one view (marketplaces recordFor). */
interface RecordRead { record?: PluginRecord; problem?: string; unknown: HarnessId[]; partsKnown: boolean }

/** The binary each tool's plugin commands run with, and for those that are a desktop app's own copy, which app carries it. */
export interface Routes { binaries: Partial<Record<HarnessId, string>>; apps: Partial<Record<HarnessId, DesktopApp>> }

/**
 * Each tool's plugin route: its own CLI, from the same candidate list version probes use; with no CLI, the copy of the tool
 * its desktop app carries (Claude desktop's Code tab, the GitHub Copilot app's runtime, ChatGPT desktop's Codex), which runs
 * the same commands (PLG-04, proved in V-01). That copy never counts as a CLI install (CD §3). Searched in this computer's
 * own home, not the home on screen: a Practice copy or backup has no tools of its own, and the ones found here are pointed
 * at the home on screen when they run.
 */
async function findClis(): Promise<Routes> {
  const routes: Routes = { binaries: {}, apps: {} };
  const path = await searchPath();
  for (const tool of pluginTools) {
    const found = await findBinary(tool, homedir(), path);
    if (!found) continue;
    routes.binaries[tool] = found.binary;
    if (found.app) routes.apps[tool] = found.app;
  }
  return routes;
}
const realEngine: MarketplaceEngine = { findClis, checkAccess: engine.checkAccess, addMarketplace: engine.addMarketplace, readCatalog: engine.readCatalog, readRemotePlugin: engine.readRemotePlugin, install: engine.install, uninstall: engine.uninstall, update: engine.update, setSkill: engine.setSkill, setPart: engine.setPart, setWhole: engine.setWhole };

/** Tools named by the page: only those that install plugins. */
const toolIds = (value: unknown): PluginTool[] => onlyAllowed(value, pluginTools);
/** Reports go to the page without each run's file bytes (kept only for the record here); the page never reads them. */
const withoutFileBytes = (reports: ActionReport[]): ActionReport[] => reports.map(report => ({ ...report, runs: report.runs.map(run => ({ ...run, changed: run.changed.map(change => ({ path: change.path, before: null, after: null })) })) }));
/** How long a Git source that couldn't be fetched (with no copy to show) waits before it is tried again on its own. */
const RETRY_MS = 60_000;
/** Said of a plugin a tool still has that its marketplace's catalog dropped, beside its "No longer offered" mark. */
export const NO_LONGER_OFFERED = 'Stays installed as it is until you uninstall it.';
/** A plugin's contents with nothing in them, for a plugin whose files couldn't be read (its `problem` says why). */
const empty: PluginDetail = { skills: [], commands: [], agents: [], instructions: [], onlyInstructions: false, hooks: [], hooksByTool: {}, mcpServers: [], mcpUsesPluginRoot: false, lspServers: [], bin: false, offered: false };

export function createMarketplaces(host: MarketplaceHost, use: MarketplaceEngine = realEngine, offers: SuggestedMarketplace[] = suggestedMarketplaces) {
  const listPath = join(host.dataDir, 'marketplaces.json');
  /** How the page shows this marketplace when it is the one this build carries; undefined for any other. */
  const carriedAs = (source: string) => { const carried = host.bundled?.(); return carried && engine.sameSource(carried.source, source) ? carried.view : undefined; };
  /** Central Knot's own list of added marketplaces: none where there is no file; undefined where there is one that can't be read. */
  const readOwnList = async (): Promise<string[] | undefined> => {
    try { const list = JSON.parse(await readFile(listPath, 'utf8')); return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : undefined; }
    catch (error) { return errorCode(error) === 'ENOENT' ? [] : undefined; }
  };
  const added = async () => (await readOwnList()) ?? [];
  const saveAdded = (list: string[]) => writeDurably(listPath, `${JSON.stringify(list, null, 2)}\n`);
  // Suggested marketplaces the person said no to (suggested.ts): never offered again on this computer.
  const declinedPath = join(host.dataDir, 'marketplaces-declined.json');
  const declined = async (): Promise<string[]> => {
    try { const list = JSON.parse(await readFile(declinedPath, 'utf8')); return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []; } catch { return []; }
  };
  /** Each CLI's version (`--version`, kept by discovery.ts probeVersion while the binary is the same file), for a plugin skill switch's tested range. */
  const cliVersion = async (binary: string | undefined) => (binary ? (await probeVersion(binary)).version : undefined);
  /** A tool's build: its CLI's, else the one discovery read for this home (ChatGPT desktop's own Codex, which isn't a CLI here). */
  const buildOf = async (ctx: engine.PluginContext, tool: HarnessId, snapshots: Snapshot[]) => (await cliVersion(ctx.binaries[tool])) ?? snapshots.find(snapshot => snapshot.harness === tool)?.probe.version;
  /** A context for one request. `clis`: look for the tools' CLIs; `ways`: read how each tool was found for reload advice. */
  const context = async ({ clis = false, ways = false } = {}): Promise<engine.PluginContext> => {
    const open = host.home();
    if (!open) throw new Error('No home is open.');
    const routes = clis ? await use.findClis() : { binaries: {}, apps: {} };
    return { home: open.home, actual: open.actual, dataDir: join(host.dataDir, 'plugins'), binaries: routes.binaries, apps: routes.apps,
      ...(ways ? { ways: waysFrom((await host.read()).snapshots) } : {}), overrides: open.overrides };
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
  async function catalogFor(ctx: engine.PluginContext, source: string, { fresh = false, counts = true, local = false } = {}): Promise<{ catalog?: Catalog; stale?: boolean; problem?: string }> {
    if (isFolder(source)) {
      const catalog = await engine.parseCatalog(source, source, 'folder', { counts });
      if (fresh && !catalog.problem) await dropRemoteCopies(ctx, catalog);
      return { catalog, problem: catalog.problem };
    }
    const known = fetched.get(source);
    if (known && !fresh && (known.catalog || Date.now() - (known.at ?? 0) < RETRY_MS)) return known;
    const onDisk = fresh ? undefined : await engine.cachedCatalog(ctx, source);
    // `local`: only the copy on disk; with none, nothing (the Refresh rules decide when a Git marketplace is fetched).
    if (!onDisk && local) return {};
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
    // Each tool's own switch for a whole plugin, read once: one turned off there is still installed, marked off.
    const offIn = new Map(await Promise.all(tools.map(async tool => [tool, new Set((await engine.installedOnce(ctx, tool).catch(() => [])).filter(found => found.off).map(found => `${found.plugin}@${found.marketplace}`))] as const)));
    const states: MarketplaceView['states'] = {};
    for (const plugin of plugins) {
      const pairs = await Promise.all(tools.map(async tool => {
        const read = held.get(tool) ?? await engine.installState(ctx, tool, catalog.name, plugin.name, plugin.entry);
        const own: InstallState = read.state === 'installed' && offIn.get(tool)?.has(`${plugin.name}@${catalog.name}`) ? { ...read, off: true } : read;
        // Claude Code may have this same plugin from the Anthropic Directory instead.
        return [tool, own.state === 'not-installed' && tool === 'claude-cli' ? (await engine.fromDirectory(ctx, catalog, plugin)) ?? own : own] as const;
      }));
      states[plugin.name] = Object.fromEntries(pairs);
    }
    return states;
  }

  /**
   * Where a plugin's files are: its folder in the marketplace, or a copy of the repository it lives in (read now if
   * needed), with the entry listing its components (for a plugin elsewhere, without the `source` naming that repository).
   */
  async function locate(ctx: engine.PluginContext, root: string, item: CatalogPlugin, local = false): Promise<{ folder: string; entry: Record<string, unknown>; root: string } | { problem: string; nowhere?: true }> {
    if (item.folder) return { folder: item.folder, entry: item.entry ?? {}, root };
    if (!item.remote) return { problem: 'Its files can’t be read.', nowhere: true };
    const copy = local ? { root: engine.remoteCopyFolder(ctx, item.remote), folder: resolve(engine.remoteCopyFolder(ctx, item.remote), item.remote.path || '.') }
      : await use.readRemotePlugin(ctx, item.remote);
    if ('problem' in copy) return { problem: `Its files couldn’t be read from ${item.from?.label ?? item.remote.url}: ${copy.problem}` };
    if (local && !(await inside(copy.root, copy.folder))) return { problem: 'Its files can’t be read.' };
    // The entry may list its components; its `source` names the repository, not a path in it.
    const { source: _where, ...listed } = item.entry ?? {};
    return { folder: copy.folder, entry: listed, root: copy.root };
  }

  /** A plugin's skill folders, agent files and MCP servers, for its items (pluginlibrary.ts) and the move of its parts (beforeParts). */
  async function filesOf(ctx: engine.PluginContext, catalog: Catalog, plugin: string): Promise<{ files?: PluginFiles; problem?: string }> {
    const item = catalog.plugins.find(entry => entry.name === plugin);
    if (!item || !catalog.root) return { problem: 'It is no longer in the marketplace as last read. Refresh the marketplace.' };
    const where = await locate(ctx, catalog.root, item);
    return 'problem' in where ? where : { files: await pluginFiles(where.folder, where.entry, where.root) };
  }

  /** A plugin's files from its marketplace's copy as last read, for its items (pluginlibrary.ts), with when that copy was read. */
  async function itemFiles(ctx: engine.PluginContext, source: string, plugin: string): Promise<{ files?: PluginFiles; commitAt: string; problem?: string }> {
    const { catalog } = await catalogFor(ctx, source, { counts: false });
    const read = catalog?.root ? await filesOf(ctx, catalog, plugin).catch(() => ({ problem: 'Its files can’t be read.' })) : { problem: MARKET_UNREAD };
    return { ...read, commitAt: catalog?.fetchedAt ?? '' };
  }

  /**
   * Each tool's installed copy of one plugin, read from the folder that tool keeps it in, as that tool reads it (see
   * pluginContents): Claude Code and Copilot CLI by the copy's own plugin.json with the marketplace entry's part lists
   * added (paths a copy of another release doesn't have are simply not found; for Copilot CLI a listed skills folder
   * replaces skills/); Codex by the one manifest it picks, its .codex-plugin one when the copy has it, without the entry. A
   * copy's commands, agents and instruction files are listed as it holds them; "In each tool" says what each tool does with
   * its commands and agents (no tool reads its instruction files). The detail request names just a source and a plugin, so
   * the tools and their install states are read here again.
   */
  async function installedCopies(ctx: engine.PluginContext, catalog: Catalog, source: string, item: CatalogPlugin, only?: PluginTool): Promise<Partial<Record<HarnessId, InstalledCopy>>> {
    const tools = only ? [only] : toolIds((await host.read()).tools);
    const states = (await statesFor(ctx, tools, catalog, source, [item]))[item.name] ?? {};
    const copies = await Promise.all(Object.entries(states).map(async ([tool, state]) => {
      if (state?.state !== 'installed') return undefined;
      const { skills, commands, agents, instructions } = await installedContents(tool as HarnessId, state.path, item.entry, !!item.isMarketplaceRoot);
      return [tool, { skills, commands, agents, instructions, version: state.version }] as const;
    }));
    return Object.fromEntries(copies.filter(copy => !!copy));
  }

  /**
   * The plugins some tool still has installed from this marketplace that its catalog no longer lists, by name. A tool
   * counts only when the marketplace it has under this name is this one (the same source), and only its own record of an
   * install does: nothing is inferred from a catalog that couldn't be read (the caller has one that was).
   */
  async function droppedPlugins(ctx: engine.PluginContext, tools: PluginTool[], catalog: Catalog, source: string): Promise<string[]> {
    const names = new Set<string>();
    for (const tool of tools) {
      const registered = (await engine.registeredMarketplaces(ctx, tool)).find(entry => entry.name === catalog.name);
      if (!registered || !engine.sameSource(registered.source, source)) continue;
      for (const found of await engine.installedOnce(ctx, tool)) if (found.marketplace === catalog.name && found.state.state !== 'not-installed' && !catalog.plugins.some(plugin => plugin.name === found.plugin)) names.add(found.plugin);
    }
    return [...names].sort();
  }

  /**
   * One marketplace on the page. A catalog that can't be read becomes a problem on its entry, never a broken page.
   * `recorded`: the plugins record's entries.
   */
  async function entryView(ctx: engine.PluginContext, tools: HarnessId[], source: string, origins: MarketplaceView['origins'], fresh: boolean, recorded: PluginEntry[]): Promise<MarketplaceView> {
    const bundled = carriedAs(source);
    const base: MarketplaceView = { source, origins, name: '', kind: isFolder(source) ? 'folder' : 'git', plugins: [], states: {}, page: marketplacePage(source), sourceLabel: bundled ? `Comes with ${bundled.app}` : sourceLabel(source), ...(bundled ? { bundled } : {}) };
    try {
      const { catalog: read, stale, problem } = await catalogFor(ctx, source, { fresh });
      // A catalog that couldn't be read (no name) lists nothing but the plugins the home records from it (unreadEntry).
      const catalog = read?.name ? read : undefined;
      // The raw entry and remote address stay here; the page gets what it shows.
      const shown: PluginView[] = (catalog?.plugins ?? []).map(({ entry: _entry, remote: _remote, ...plugin }) => plugin);
      if (!catalog) return { ...base, ...await unreadEntry(ctx, tools, source, recorded.filter(entry => engine.sameSource(entry.source, source)), shown), name: recorded.find(entry => engine.sameSource(entry.source, source))?.marketName ?? '', problem: problem ?? read?.problem };
      // A plugin the catalog dropped stays listed while a tool still has it installed: kept as it is, marked, until it is uninstalled (PLG-08).
      const dropped = await droppedPlugins(ctx, tools.filter(takesPlugins), catalog, source);
      for (const name of dropped) {
        const listed = shown.find(plugin => plugin.name === name);
        if (listed) listed.description = NO_LONGER_OFFERED;
        else shown.push({ name, description: NO_LONGER_OFFERED, gone: true });
      }
      const states = await statesFor(ctx, tools.filter(takesPlugins), catalog, source, [...catalog.plugins, ...dropped.map(name => ({ name, description: '' }))]);
      if (base.bundled) base.bundled = { ...base.bundled, addedTo: (await readAdded(catalog.name))[ctx.home] ?? [] };
      const refused = Object.fromEntries((await Promise.all(tools.filter(takesPlugins).map(async tool => [tool, await engine.refusedBy(ctx, tool, source)] as const))).filter(([, said]) => said));
      return { ...base, name: catalog.name, fetchedAt: catalog.fetchedAt, problem, stale, owner: catalog.owner, description: catalog.description, copilotRefuses: catalog.copilotRefuses, codexOnly: catalog.codexOnly, plugins: shown, states, ...(Object.keys(refused).length ? { refusedBy: refused } : {}) };
    } catch { return { ...base, problem: 'It could not be read.' }; }
  }

  /**
   * A marketplace whose catalog can't be read, for the plugins the home records from it: each stays listed, with what each
   * tool's own record says it has, read by the name the record keeps, so a catalog that can't be read never reads as "not
   * installed" (its switch can still turn it off; nothing can go in until the catalog reads).
   */
  async function unreadEntry(ctx: engine.PluginContext, tools: HarnessId[], source: string, recorded: PluginEntry[], shown: PluginView[]): Promise<Pick<MarketplaceView, 'plugins' | 'states'>> {
    const plugins = [...shown];
    for (const entry of recorded) if (!plugins.some(plugin => plugin.name === entry.plugin)) plugins.push({ name: entry.plugin, description: 'Its marketplace can’t be read now. It stays as it is in the tools that have it.', gone: true });
    const states: MarketplaceView['states'] = {};
    for (const marketName of new Set(recorded.map(entry => entry.marketName))) {
      const mine = plugins.filter(plugin => recorded.some(entry => entry.plugin === plugin.name && entry.marketName === marketName));
      Object.assign(states, await statesFor(ctx, tools.filter(takesPlugins), { name: marketName, source, kind: isFolder(source) ? 'folder' : 'git', fetchedAt: '', plugins: [] }, source, mine));
    }
    return { plugins, states };
  }

  /**
   * The home's plugins record (pluginrecord.ts), made by its first read when there is none and saved where writing is allowed.
   * `unknown`: the tools whose own record of their plugins can't be read now, and `partsKnown`, whether the record of parts from
   * before the library (`parts`, partsmigrate.ts readRecord) can be. While one can't, a home with no record yet gets none
   * (`problem` says why), so nothing is decided from a read that isn't whole.
   */
  async function recordFor(ctx: engine.PluginContext, tools: HarnessId[], writable: boolean, parts: PartsRecord): Promise<RecordRead> {
    const unknown = (await Promise.all(tools.filter(takesPlugins).map(async tool => ((await engine.recordReadable(ctx, tool)) ? [] : [tool])))).flat();
    const partsKnown = parts !== 'unreadable';
    const read = await readPluginRecord(ctx.home);
    if (read.problem || read.record) return { ...read, unknown, partsKnown };
    if (unknown.length || !partsKnown) return { problem: firstReadWaits(unknown, partsKnown), unknown, partsKnown };
    const record = firstRecord(tools, await holdingsIn(ctx, tools, parts), await host.waitedBefore?.() ?? []);
    // It names every tool this build knows: on a home an earlier build wrote, saved only once its sync record is lifted.
    const share = host.share?.();
    if (writable && !(share && await liftFirst(share))) await savePluginRecord(ctx.home, record);
    return { record, unknown, partsKnown };
  }

  /**
   * Before a pass while plugin-parts.json is there (main.ts pass; partsmigrate.ts waits for plugins.json): the record's first read
   * (recordFor), and how the migration reads a plugin, from its marketplace's copy on disk only (no fetch). None after.
   */
  async function beforeParts(): Promise<PluginNow | undefined> {
    const share = host.share?.(), parts = share ? await readPartsRecord(share.home) : 'absent';
    if (parts === 'absent') return undefined;
    const ctx = await context();
    await recordFor(ctx, columns((await host.read()).tools), (await host.writeAccess()).allowed && !(await waitsForResume()), parts);
    return async entry => {
      const { catalog } = await catalogFor(ctx, entry.source, { counts: false, local: true });
      const listed = catalog?.root ? catalog.plugins.find(each => each.name === entry.plugin) : undefined;
      const { files } = listed?.folder ? await filesOf(ctx, catalog!, entry.plugin) : {};
      const commitAt = catalog?.fetchedAt ?? '';
      return files && { reads: await readPlugin(files, entry, commitAt, new Set(), []), commitAt };
    };
  }

  /**
   * The plugins the managed tools hold now, for the first read: installed whole from a marketplace the tool's record names, and
   * parts on record (`parts`), in a managed tool or in Pi or OpenCode left out (the move decides those as the record knew them:
   * partsmigrate.ts).
   */
  async function holdingsIn(ctx: engine.PluginContext, tools: HarnessId[], parts: PartsRecord): Promise<Holding[]> {
    const holdings: Holding[] = [];
    for (const tool of tools.filter(takesPlugins)) {
      const registered = await engine.registeredMarketplaces(ctx, tool);
      for (const found of await engine.installedPlugins(ctx, tool)) {
        const source = registered.find(entry => entry.name === found.marketplace)?.source;
        if (source && found.state.state !== 'not-installed') holdings.push({ tool, source, marketName: found.marketplace, plugin: found.plugin });
      }
    }
    const counted = (tool: HarnessId) => tools.includes(tool) || !takesPlugins(tool);
    if (typeof parts === 'object') for (const { install: { tool, source, marketName, plugin } } of parts) if (counted(tool)) holdings.push({ tool, source, marketName, plugin });
    return holdings;
  }

  /** One listed plugin's switch: its entry in `record`, and the table's answer for each tool of the view (pluginrecord.ts owedTo). */
  function switchOf(view: PluginsView, entry: MarketplaceView, plugin: PluginView, known: RecordRead, record = known.record): PluginSwitch {
    const recorded = entryOf(record, entry.source, plugin.name);
    const offSomewhere = view.tools.some(tool => { const state = entry.states[plugin.name]?.[tool]; return state?.state === 'installed' && !!state.off; });
    const owed = (tool: HarnessId): Owed => owedTo(recorded, tool, toolNow(view, entry, plugin.name, tool, plugin.components, known.unknown.includes(tool) || !known.partsKnown), record?.tools ?? [], offSomewhere);
    return { ...(recorded ? { entry: { on: recorded.on, except: recorded.except } } : {}), tools: Object.fromEntries(view.tools.map(tool => [tool, owed(tool)])) };
  }

  /**
   * Each listed plugin with items (pluginlibrary.ts withItemsOf), read from its marketplace's copy as the table reads it
   * (itemsView): its page's "Its items", and what Pi, OpenCode and Antigravity have of it (pluginstatus.ts toolNow). A plugin that is On with
   * nothing linked is read too, and listed only where none of it can be on in a tool it is wanted in (itemsView `notIn`) or a
   * name it has is his (`yours`), so its page says why. A plugin whose parts wait to be moved (pluginstatus.ts waitsToMove) is not read: it has no Its items, so
   * Update and Update all bring it nothing. The home is looked at once for them all (pluginlibrary.ts lookAtKinds), when the first is read.
   */
  async function withItems(ctx: engine.PluginContext, share: ShareContext, tools: HarnessId[], marketplaces: MarketplaceView[], entries: PluginEntry[]) {
    const read = await withItemsOf(share, entries), recorded = (await recordedIds(share.home)).ids;
    const asked = [...read, ...entries.filter(entry => entry.on && !read.includes(entry) && itemTools(tools).some(tool => !entry.except.includes(tool)))];
    let looks: KindLooks | undefined;
    for (const market of marketplaces) for (const plugin of market.plugins) {
      const entry = entryOf({ plugins: asked }, market.source, plugin.name);
      if (!entry || waitsToMove(market, plugin.name)) continue;
      const at: Awaited<ReturnType<typeof itemFiles>> = plugin.gone ? { commitAt: '', problem: MARKET_UNREAD } : await itemFiles(ctx, market.source, plugin.name);
      const reads = at.files && await readPlugin(at.files, entry, at.commitAt, recorded, []);
      looks ??= await lookAtKinds(share, tools);
      const shown = await itemsView(tools, looks, entry, reads || undefined, at.problem);
      if (read.includes(entry) || shown.notIn || shown.yours) (market.items ??= {})[plugin.name] = shown;
    }
  }

  /** The page's tools: Pi, OpenCode and Antigravity take no plugins, only their items (pluginlibrary.ts), so each is a column only where those can go in. */
  const columns = (tools: HarnessId[]) => tools.filter(tool => takesPlugins(tool) || !!host.share);

  /** Every marketplace: added here, or already added in a tool. `fresh`: every Git source fetched again. */
  const view = async (fresh = false, readId?: number): Promise<PluginsView> => (await look(fresh, readId)).view;

  /**
   * The marketplaces listed for these tools, each once however it is spelled (sameSource), with where each is listed from; with
   * the record of parts from before the library, which lists the marketplaces its plugins waiting to be moved come from; and
   * whether every list they come from could be read (`complete`).
   */
  async function listedSources(ctx: engine.PluginContext, tools: HarnessId[]) {
    const known: { source: string; origins: MarketplaceView['origins'] }[] = [];
    const note = (source: string, origin: MarketplaceView['origins'][number]) => {
      const entry = known.find(item => engine.sameSource(item.source, source));
      if (entry) { if (!entry.origins.includes(origin)) entry.origins.push(origin); } else known.push({ source, origins: [origin] });
    };
    // The marketplace this build carries comes first, whatever else is added.
    const carried = host.bundled?.();
    if (carried) note(carried.source, 'bundle');
    const ownList = await readOwnList();
    for (const source of ownList ?? []) note(source, 'central-knot');
    // A source that could read as an option is never passed on to a tool or to Git.
    let unread = false;
    for (const tool of tools.filter(candidate => takesPlugins(candidate))) {
      const registered = await engine.registrations(ctx, tool);
      unread ||= registered.unread;
      for (const entry of registered.entries) if (!entry.source.startsWith('-')) note(entry.source, tool);
    }
    // A marketplace a plugin waiting to be moved comes from stays listed (after the tools', so "Added in Codex" still shows), and
    // so does its copy, which the move reads (Remove is not offered for it: pluginspage.ts).
    const share = host.share?.();
    const parts = share ? await readPartsRecord(share.home) : 'absent', onRecord = typeof parts === 'object' ? parts.map(({ install }) => install) : [];
    for (const install of onRecord) if (!known.some(item => engine.sameSource(item.source, install.source))) note(install.source, 'central-knot');
    return { known, parts, onRecord, complete: !!ownList && parts !== 'unreadable' && !unread };
  }

  /** The marketplaces listed in the open home, as the page lists them, for the plugin text (plugintext.ts): no CLI is run and nothing is fetched. */
  async function listings(readId?: number): Promise<Listed | undefined> {
    if (!host.home()) return undefined;
    const { known, complete } = await listedSources(await context(), columns((await host.read(readId)).tools));
    return { sources: known.map(item => item.source), complete };
  }

  /**
   * The view, and how the plugins record was read for it (`known`). `only`: just that marketplace (a click on one of its
   * plugins), with no suggestions.
   */
  async function look(fresh = false, readId?: number, only?: string): Promise<{ view: PluginsView; known: RecordRead }> {
    const ctx: engine.PluginContext = { ...(await context({ clis: true })), reads: new Map() };
    const read = await host.read(readId);
    const tools = columns(read.tools);
    const writing = await host.writeAccess();
    const { known, parts, onRecord, complete } = await listedSources(ctx, tools);
    const recordRead = await recordFor(ctx, tools, writing.allowed, parts);
    const marketplaces: MarketplaceView[] = [];
    // All at once: one unreachable source doesn't hold up the others.
    const listed = only ? known.filter(item => engine.sameSource(item.source, only)) : known;
    marketplaces.push(...await Promise.all(listed.map(({ source, origins }) => entryView(ctx, tools, source, origins, fresh, recordRead.record?.plugins ?? []))));
    if (!only) host.listed?.({ sources: known.map(item => item.source), complete }, fresh);
    for (const market of marketplaces) {
      const waiting = [...new Set(onRecord.filter(install => engine.sameSource(install.source, market.source)).map(install => install.plugin))];
      if (waiting.length) market.waiting = waiting;
    }
    const partsWait = host.partsWait?.();
    const desktopOnly = Object.fromEntries(tools.flatMap(tool => { const app = read.snapshots.find(snapshot => snapshot.harness === tool)?.app; return !ctx.binaries[tool] && app ? [[tool, app.name]] : []; }));
    // The app's own copy, named with the version it answers (the Copilot runtime may run a newer Copilot CLI it updated to).
    const via = Object.fromEntries(await Promise.all(Object.entries(ctx.apps ?? {}).filter(([tool]) => tools.includes(tool as HarnessId)).map(async ([tool, app]) => [tool, viaLabel(app, await cliVersion(ctx.binaries[tool as HarnessId]))] as const)));
    const versions = Object.fromEntries((await Promise.all(tools.filter(tool => SKILL_SWITCH_TESTED_FROM[tool]).map(async tool => [tool, await buildOf(ctx, tool, read.snapshots)] as const))).filter(([, version]) => version));
    // What is offered without being looked for: the default of a plugin tool that is here, unless it is listed already (a
    // tool added it, or the person did), was declined, or this build carries its own marketplace.
    const no = await declined();
    const suggested = host.bundled?.() || only ? [] : offers
      .map(offer => ({ source: offer.source, name: offer.name, tools: offer.tools.filter(tool => read.tools.includes(tool)) }))
      .filter(offer => offer.tools.length && ![...known.map(item => item.source), ...no].some(source => engine.sameSource(source, offer.source)));
    const shown: PluginsView = { home: ctx.home, tools, clis: Object.fromEntries(tools.map(tool => [tool, !!ctx.binaries[tool]])), canWrite: writing.allowed, reason: writing.allowed ? undefined : writing.reason, marketplaces, desktopOnly, via, versions, suggested,
      ...(recordRead.problem ? { switchProblem: recordRead.problem } : {}), ...(partsWait ? { partsWait } : {}) };
    // The record of parts from before the library unreadable: no plugin is read as items, and Pi and OpenCode read as unknown.
    const share = host.share?.();
    if (share && recordRead.record && recordRead.partsKnown) await withItems(ctx, share, read.tools, marketplaces, recordRead.record.plugins);
    for (const entry of marketplaces) entry.switches = Object.fromEntries(entry.plugins.map(plugin => [plugin.name, switchOf(shown, entry, plugin, recordRead)]));
    return { view: shown, known: recordRead };
  }

  /**
   * A plugin's contents and README, from the marketplace's files or, when it lives elsewhere, its own repository; with
   * each tool's installed copy, which may be another version. `local` (the list's background read) reads only what is on
   * disk: a plugin whose files would have to be fetched first is not read (null), as if never asked.
   */
  async function detail(source: string, plugin: string, local = false): Promise<PluginDetail | null> {
    const ctx = await context();
    const { catalog } = await catalogFor(ctx, source, { counts: false, local });
    const item = catalog?.plugins.find(entry => entry.name === plugin);
    // A plugin the catalog dropped has only what the tools still hold of it.
    if (catalog?.root && !item) {
      const installed = await installedCopies(ctx, catalog, source, { name: plugin, description: '' });
      return Object.keys(installed).length ? { ...empty, installed } : null;
    }
    if (!catalog?.root || !item) return null;
    if (local && item.remote && !(await access(engine.remoteCopyFolder(ctx, item.remote)).then(() => true, () => false))) return null;
    const [offered, installed] = await Promise.all([offeredDetail(ctx, catalog.root, item), installedCopies(ctx, catalog, source, item)]);
    if (offered) return { ...offered, installed };
    // Files the marketplace can't give (an npm or pip package) may still be read from a tool that installed it.
    return Object.keys(installed).length ? { ...empty, installed } : null;
  }

  /** What the marketplace offers of one plugin: from its own folder, or read from the repository it is kept in. */
  async function offeredDetail(ctx: engine.PluginContext, root: string, item: CatalogPlugin): Promise<PluginDetail | null> {
    const where = await locate(ctx, root, item);
    // Nowhere to read it from: no detail at all. A repository that couldn't be read: an empty detail saying why.
    if ('problem' in where) return where.nowhere ? null : { ...empty, problem: where.problem };
    return pluginDetail(where.folder, where.entry, where.root, !!item.folder && !!item.isMarketplaceRoot);
  }

  /** The marketplace's own README, from the copy already read. */
  async function readme(source: string): Promise<string | null> {
    const { catalog } = await catalogFor(await context(), source, { counts: false });
    return catalog?.root ? (await readmeIn(catalog.root)) ?? null : null;
  }

  /**
   * Adds a marketplace to Central Knot's own list (installs nothing, adds nothing to any tool). It is read first, and only
   * a readable one is added; that read is kept as its catalog. Returns the new view, the source as the view spells it (a source
   * already listed under another spelling keeps its first spelling), and whether it was on the page already (`already`: on this
   * list, or added in a tool or by the build). A web link to a branch or a folder is refused: a marketplace is read at its
   * repository's root, from its default branch (Sources' Look reads such a link: sources.ts handOff).
   */
  async function add(source: string): Promise<{ problem?: string; view?: PluginsView; source?: string; already?: true }> {
    const text = source.trim();
    if (text.startsWith('-')) return { problem: 'That isn’t a marketplace: owner/repo, a Git URL or a folder.' };
    if (/^(\.\.?|~)([\\/]|$)/.test(text)) return { problem: 'Use the folder’s full path, or choose it with Folder…' };
    const link = isFolder(text) ? undefined : readLink(text);
    if (link && 'rest' in link && link.rest) return { problem: `That link names a branch or a folder, and a marketplace is added from its repository’s address (owner/repo, or one git clones), read at its root from its default branch. Paste the link on ${pageNames.sources} instead: Look there says what it holds, and offers ${toPluginsLabel} for a marketplace this page can add.` };
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
    const shown = await view(), listed = shown.marketplaces.find(entry => engine.sameSource(entry.source, stored));
    const already = !!listedAs || !!listed?.origins.some(origin => origin !== 'central-knot');
    return { view: shown, source: listed?.source ?? stored, ...(already ? { already } : {}) };
  }

  /** A suggested marketplace the person doesn't want offered: remembered, and not offered again. `again`: offer it again after all (its Undo). */
  async function decline(source: string, again = false): Promise<PluginsView> {
    const others = (await declined()).filter(item => !engine.sameSource(item, source));
    await writeDurably(declinedPath, `${JSON.stringify(again ? others : [...others, source], null, 2)}\n`);
    return view();
  }

  /** Takes a marketplace off Central Knot's own list. Tools that added it keep it, and nothing is uninstalled. */
  async function forget(source: string): Promise<PluginsView> {
    // The marketplace a build carries is part of the build: it stays listed.
    if (carriedAs(source)) return view();
    await saveAdded((await added()).filter(item => !engine.sameSource(item, source)));
    for (const known of fetched.keys()) if (engine.sameSource(known, source)) fetched.delete(known);
    const shown = await view();
    // Its copy goes too, unless a tool still lists it (then the page still shows it, from that copy).
    if (!isFolder(source) && !shown.marketplaces.some(entry => engine.sameSource(entry.source, source))) await rm(engine.catalogFolder(await context(), source), { recursive: true, force: true });
    return shown;
  }

  /** Why plugin work of its own accord (the automatic updates, the record's first read before a pass, a carried marketplace) waits: the home waits for Resume, as its sync passes do. */
  const waitsForResume = async () => { const share = host.share?.(), gate = share && await syncGate(share); return gate?.state === 'needs-resume' ? gate.reason : undefined; };
  // Writes act only on the home on screen, only where writing is allowed there, on a home an earlier build wrote only once its
  // sync record is lifted (share.ts liftFirst: they can name a sixth tool), and in no tool whose Manage switch is off.
  const guard = async (home: unknown, tools: readonly HarnessId[] = []) => {
    if (home !== host.home()?.home) return 'The home on screen is not the one open. Nothing was changed. Read it again.';
    const writing = await host.writeAccess(), share = host.share?.();
    if (!writing.allowed) return writing.reason ?? 'Writing isn’t allowed in this home, so nothing was changed.';
    return (share && await liftFirst(share)) || leftOutOf(tools);
  };
  /** Why nothing is written in these tools, if one of them is left out here: asked at the moment of writing (host.leftOut). */
  const leftOutOf = async (tools: readonly HarnessId[]) => {
    const out = await host.leftOut?.() ?? [], tool = tools.find(each => out.includes(each));
    return tool && leftOutSentence(tool);
  };

  /**
   * Each tool's own install (or with `run`, its update). A plugin gone from the marketplace, or a marketplace that now
   * gives another name than the one chosen (`marketName`), fails for its tools instead of stopping the whole run.
   */
  async function install(source: string, marketName: string, plugin: string, tools: PluginTool[], home: unknown, run = use.install): Promise<PluginActionResult> {
    const stopped = await guard(home, tools);
    if (stopped) return { stopped, reports: [] };
    const ctx: engine.PluginContext = { ...(await context({ clis: true, ways: true })), checked: new Map() };
    const { catalog } = await catalogFor(ctx, source, { counts: false });
    if (!catalog?.plugins.some(item => item.name === plugin)) return { reports: failedFor(tools, 'It is no longer in the marketplace as last read. Refresh the marketplace.') };
    if (catalog.name !== marketName) return { reports: failedFor(tools, `Its marketplace is now named “${catalog.name}”, not “${marketName}”. Refresh, then choose it again.`) };
    // A plugin the build's marketplace lists but carries no files for is not installed from it.
    // The build's own marketplace: a plugin it no longer offers, kept for the tools that have it, goes into no other tool
    // (an update of it there runs as usual); one it lists but carries no files for is not installed from it.
    const carried = carriedAs(source), left = carried?.unpackaged.find(item => item.name === plugin);
    if (carried?.kept?.includes(plugin)) { if (run === use.install) return { reports: failedFor(tools, keptReason(carried.displayName || catalog.name)) }; }
    else if (carried && left) return { reports: failedFor(tools, notCarried(carried.app, left.reason)) };
    // One tool's error fails that tool only: what earlier tools did stays reported (and undoable), and later tools still run.
    const reports: ActionReport[] = [];
    for (const tool of tools) {
      try { reports.push(await run(ctx, catalog, plugin, tool)); }
      catch (error) { reports.push(...failedFor([tool], `It stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`)); }
      // An install from the build's own marketplace put it in that tool's list too: noted, so it is never added again by itself.
      if (carried && reports.at(-1)?.outcome === 'installed') await noteAdded(catalog.name, ctx.home, tool).catch(() => undefined);
    }
    return told(source, plugin, { reports: withoutFileBytes(reports) });
  }

  /** Tells the host which tools a change to a plugin worked in (host.changed), and gives the result back. */
  function told(source: string, plugin: string, result: PluginActionResult): PluginActionResult {
    const tools = result.reports.filter(succeeded).map(report => report.tool);
    if (tools.length) host.changed?.(source, plugin, tools);
    return result;
  }

  /**
   * Each tool's own update of an installed plugin, checked as install is. Whether the tool's copy differs from the
   * marketplace's is asked as the plugin page asks it (copyDiffers), from both copies read again each time.
   */
  const update = (source: string, marketName: string, plugin: string, tools: PluginTool[], home: unknown, options?: { reinstall?: boolean }) => install(source, marketName, plugin, tools, home, (ctx, catalog, name, tool) => {
    const item = catalog.plugins.find(entry => entry.name === name);
    const differs = async () => {
      if (!catalog.root || !item) return false;
      const [offered, copies] = await Promise.all([offeredDetail(ctx, catalog.root, item), installedCopies(ctx, catalog, source, item, tool)]);
      return !!offered && !offered.problem && copyDiffers(offered, copies[tool]);
    };
    return use.update(ctx, catalog, name, tool, differs, options);
  });

  /**
   * What is due now, with each Git marketplace fetched again first (as Refresh does). Nothing here writes to a tool.
   * - The updates Update all would choose, but what only a click brings: for each plugin some tool has installed, an update in
   *   each tool whose copy is behind (pluginstatus.updateTools, as the page asks it), and its items read again where it has
   *   something for them without a click (pluginlibrary.ts itemsView `due`, not Update's `ready`). A plugin's files are read
   *   first, as its page reads them (from the repository it is kept in, too), so a copy that differs at the same version counts. Each op carries the version offered. One turned off in a tool is still updated
   *   there, and update() keeps it off. A plugin its catalog dropped is left as it is.
   * - The installs the plugins' table owes the automatic updates (pluginrecord.ts `background`: an On plugin a managed tool
   *   new here lacks), each marked `newHere`.
   * - `newTools`: the managed tools not on the plugins record's `tools`. Each is new for one check: it joins `tools` after the
   *   check that ran for it, whatever its installs came to (pluginupdates.ts, noteJoined). A check that could read no
   *   marketplace at all names none, so it doesn't count.
   * A marketplace that couldn't be read now gives nothing and is named in `unread`: its last copy says nothing about what it
   * offers today (`unreadSources`: the same, as added; `offline`: every Git marketplace did, so the next try can come sooner).
   */
  async function pendingUpdates(home: unknown): Promise<{ stopped?: string; ops: (PluginOp & { offered?: string; newHere?: true })[]; unread: string[]; unreadSources: string[]; offline?: true; newTools?: HarnessId[] }> {
    const stopped = await guard(home) ?? await waitsForResume();
    if (stopped) return { stopped, ops: [], unread: [], unreadSources: [] };
    const shown = await view(true);
    const ops: (PluginOp & { offered?: string; newHere?: true })[] = [];
    const unread: string[] = [], unreadSources: string[] = [];
    const { record } = await readPluginRecord(shown.home);
    const reached = !shown.marketplaces.length || shown.marketplaces.some(entry => !entry.problem && !!entry.name);
    const fresh = record && reached ? shown.tools.filter(tool => !record.tools.includes(tool)) : [];
    for (const entry of shown.marketplaces) {
      if (entry.problem || !entry.name) { unread.push(marketTitle(entry)); unreadSources.push(entry.source); continue; }
      for (const plugin of entry.plugins) {
        if (plugin.gone) continue;
        for (const [tool, owed] of Object.entries(entry.switches?.[plugin.name]?.tools ?? {}) as [HarnessId, Owed][]) {
          if (owed.background && (owed.act === 'install' || owed.act === 'install-items')) ops.push({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: owed.act, newHere: true });
        }
        // A plugin with items whose read has something for them without a click (pluginlibrary.ts itemsView `due`): read and carried out once.
        const itemsTool = itemTools(shown.tools)[0];
        if (entry.items?.[plugin.name]?.due && itemsTool) ops.push({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool: itemsTool, action: 'update-items' });
        const copied = shown.tools.some(tool => { const state = entry.states[plugin.name]?.[tool]; return state?.state === 'installed' && !state.live && !state.directory; });
        if (!copied) continue;
        const files = await detail(entry.source, plugin.name).catch(() => null);
        const offered = versionToCompare(plugin, files);
        const op = (tool: HarnessId) => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action: 'update' as const, ...(offered || plugin.version ? { offered: offered ?? plugin.version } : {}) });
        ops.push(...updateTools(shown, entry, plugin.name, offered, files).map(op));
      }
    }
    // Every Git marketplace failed to read: most likely this computer is offline just now.
    const git = shown.marketplaces.filter(entry => entry.kind === 'git');
    return { ops, unread, unreadSources, newTools: fresh, ...(git.length && git.every(entry => entry.problem) ? { offline: true as const } : {}) };
  }

  /**
   * Every change to an existing plugins record (a click's entry, its Undo's, a tool joining or managed again) is one step: the
   * record read as it is now, changed, saved, one step at a time, so no change writes over another made meanwhile.
   * Undefined when there is no record (nothing is changed).
   */
  let changing: Promise<unknown> = Promise.resolve();
  const changeRecord = (home: string, change: (record: PluginRecord) => PluginRecord) => {
    const step = changing.then(async () => { const { record } = await readPluginRecord(home); if (record) await savePluginRecord(home, change(record)); return record; });
    changing = step.catch(() => undefined);
    return step;
  };

  /** Tools no longer new here, after the automatic updates' first check for them: on the plugins record's `tools` from now on (pluginrecord.ts). */
  async function noteJoined(tools: HarnessId[], home: unknown): Promise<void> {
    if (!tools.length || (await guard(home))) return;
    await changeRecord(String(home), record => ({ ...record, tools: [...record.tools, ...tools.filter(tool => !record.tools.includes(tool))] }));
  }

  /** A tool whose Manage switch was turned on again: off the plugins record's `tools`, so it is new here and owed each On plugin not kept out of it. */
  async function toolManaged(tool: HarnessId, home: unknown): Promise<void> {
    if (await guard(home)) return;
    await changeRecord(String(home), record => ({ ...record, tools: record.tools.filter(each => each !== tool) }));
  }

  /**
   * A plugin read and its items brought up to date (pluginlibrary.ts runItems, ItemsAsk `read`): the page's Update and Update all
   * (`click`), the automatic updates' check, and its install in a tool new here (`bring`).
   */
  async function items(source: string, marketName: string, plugin: string, tools: HarnessId[], home: unknown, bring = false, click = false): Promise<PluginActionResult> {
    const stopped = await guard(home, tools);
    if (stopped) return { stopped, reports: [] };
    const share = host.share?.(), entry = entryOf((await readPluginRecord(String(home))).record, source, plugin);
    if (!share || !entry) return { reports: failedFor(tools, 'It has no entry in the plugins record here, so its items aren’t read.') };
    const ran = await runItems(share, (await host.read()).tools, entry, { read: tools, ...(bring ? { bring: true as const } : {}), ...(click ? { click: true as const } : {}) }, await itemFiles(await context(), source, plugin), { source, marketName, plugin, action: bring ? 'install-items' : 'update-items' });
    for (const told of ran.notices) host.notices?.(told.kind, told.notices);
    return { ...(ran.stopped ? { stopped: ran.stopped } : {}), reports: ran.done.map(done => done.report) };
  }

  /** The calls a turn and its Undo make: this module's own, so each asks what a click asks (guard). */
  const ownApi: PlanApi = {
    install: (source, marketName, plugin, tools, home) => install(source, marketName, plugin, toolIds(tools), home),
    uninstall: (source, marketName, plugin, tool, home) => (takesPlugins(tool) ? uninstall(source, marketName, plugin, tool, home) : Promise.resolve({ reports: failedFor([tool], 'It takes no plugins.') })),
    setSkill: async () => ({ stopped: 'A whole plugin’s switch turns no single skill.', reports: [] }),
    setWhole: (source, marketName, plugin, tool, on, home) => (takesPlugins(tool) ? setWhole(source, marketName, plugin, tool, on, home) : Promise.resolve({ reports: failedFor([tool], 'It takes no plugins.') })),
  };

  /**
   * The entry a turn records: On or Off, Add's On, or one tool's box, by the table's rows for a box (pluginrecord.ts A TOOL'S
   * BOX). `has`: the tools that have it now; `managed`: the home's tools, for the first read's rule.
   */
  function turnedEntry(before: PluginEntry | undefined, what: PluginTurn, tool: HarnessId | undefined, fresh: () => PluginEntry, has: HarnessId[], managed: HarnessId[]): PluginEntry | undefined {
    if (what === 'on' || what === 'off') return { ...(before ?? fresh()), on: what === 'on' };
    if (what === 'add') return before ? undefined : { ...fresh(), on: true };
    if (!tool) return undefined;
    if (before && !before.on && what === 'keep-out') return before;
    const plain = before ?? fresh(), holders = [...new Set(what === 'let-in' ? [...has, tool] : has)].map(each => ({ ...plain, tool: each }));
    const base = before?.on ? before : { ...plain, on: true, except: holders.length ? firstEntry(managed, holders, [], holders[0]!).except : [...harnessIds] };
    // The last untick: no other tool it is let into has it (a copy left where it is kept out doesn't count).
    if (what === 'keep-out' && has.every(each => each === tool || base.except.includes(each))) return { ...base, on: false };
    return { ...base, except: harnessIds.filter(each => (each === tool ? what === 'keep-out' : base.except.includes(each))) };
  }

  /**
   * A click on a whole plugin (`what`): its switch On or Off, Add for a plugin found in a tool, or one tool's box unticked or
   * ticked. The entry is recorded first; then the table (pluginrecord.ts owedTo) is asked once with it, and what it owes runs by
   * each tool's own route: On, Add and a tick run only installs, Off and an untick only uninstalls, a box only in its tool. A
   * tool where nothing can run (held, or its record can't be
   * read) is a report saying why. `back` is the Undo: what changed, reversed (pluginplan.ts reverse), with a tool's own switch
   * for the whole plugin turned off again where an uninstall took a copy that was off there.
   */
  async function turn(source: string, plugin: string, what: PluginTurn, tool: HarnessId | undefined, home: unknown): Promise<PluginTurnResult> {
    const stopped = await guard(home);
    if (stopped) return { stopped, done: [] };
    const { view: shown, known } = await look(false, undefined, source);
    const entry = shown.marketplaces.find(candidate => engine.sameSource(candidate.source, source));
    const listed = entry?.plugins.find(candidate => candidate.name === plugin);
    if (shown.switchProblem || !known.record) return { stopped: shown.switchProblem ?? 'The plugins record isn’t there. Nothing was changed.', done: [] };
    if (!entry || !listed || (tool && !shown.tools.includes(tool))) return { stopped: 'It is no longer listed here, so nothing was changed. Read the page again.', done: [] };
    const before = entryOf(known.record, source, plugin);
    const has = (Object.entries(switchOf(shown, entry, listed, known, known.record).tools) as [HarnessId, Owed][]).filter(([, owed]) => owed.has === 'whole' || owed.has === 'items').map(([each]) => each);
    const after = turnedEntry(before, what, tool, () => newEntry(entry.source, entry.name || before?.marketName || '', plugin, false), has, shown.tools);
    if (!after) return { stopped: 'That doesn’t apply to this plugin now, so nothing was changed. Read the page again.', done: [] };
    const record = withEntry(known.record, source, plugin, after);
    // Written onto the record as it is then, so what a check wrote while this click was reading (a tool joining) stays.
    if (after !== before) await changeRecord(shown.home, now => withEntry(now, source, plugin, after));
    const ops: PluginOp[] = [], held: PluginDone[] = [], itemsIn: HarnessId[] = [];
    const marketName = entry.name || after.marketName;
    for (const [each, owed] of Object.entries(switchOf(shown, entry, listed, known, record).tools) as [HarnessId, Owed][]) {
      if (tool && each !== tool) continue;
      const act = clickRuns(what, owed);
      if (act === 'install-items' || act === 'remove-items') itemsIn.push(each);
      else if (act) ops.push({ source: entry.source, marketName, plugin, tool: each, action: act === 'install' ? 'install' : 'remove' });
      // Said on the result, and nothing run there: a record that can't be read; held in this click's way; and for Off and Keep
      // out, a tool holding another marketplace under this name (read from its state: its plugins are not this one's).
      const other = entry.states[plugin]?.[each];
      const otherMarket = clickGoes(what) === 'out' && other?.state === 'held' ? other.reason : undefined;
      const why = owed.has === 'unknown' ? recordUnread(each) : clickHeld(what, owed) ?? otherMarket;
      // A tool's refusal of this marketplace is said once, where its state is (pluginstatus.ts blocked), not on every click.
      if (why && why !== entry.refusedBy?.[each]) held.push({ source: entry.source, marketName, plugin, tool: each, action: clickGoes(what) === 'out' ? 'remove' : 'install', report: { tool: each, outcome: 'held', message: why, runs: [] } });
    }
    const ran = ops.length ? await runPlan(ops, ownApi, String(home)) : { done: [] as PluginDone[] };
    // A copy turned off in a tool's own settings comes back off: its whole-plugin switch is turned off again after the install.
    const offBefore = (each: HarnessId) => { const state = entry.states[plugin]?.[each]; return state?.state === 'installed' && !!state.off; };
    const back = reverse(ran.done).flatMap(op => (op.action === 'install' && offBefore(op.tool) ? [op, { ...op, action: 'plugin-off' as const }] : [op]));
    // Pi, OpenCode and Antigravity: its items (pluginlibrary.ts).
    // An untick that leaves the plugin Off takes its items there as Off does: each item's `except` stays for its next On.
    const items = itemsIn.length && !ran.stopped ? await turnItems(entry.source, marketName, after, what === 'keep-out' && !after.on ? 'off' : what, itemsIn) : undefined;
    if (items?.back) back.push({ source: entry.source, marketName, plugin, tool: itemsIn[0]!, action: 'items-back', items: items.back });
    const ended = ran.stopped ?? items?.stopped;
    return { done: [...ran.done, ...(items?.done ?? []), ...held], before: before ?? null, back, ...(ended ? { stopped: ended } : {}) };
  }

  /** A turn's part in the tools that take no plugins (`tools`), as pluginlibrary.ts ItemsAsk says. Its notices go to their pages. */
  async function turnItems(source: string, marketName: string, entry: PluginEntry, what: PluginTurn, tools: HarnessId[]) {
    const share = host.share?.();
    if (!share) return undefined;
    const goes = clickGoes(what) === 'in', op = { source, marketName, plugin: entry.plugin, action: goes ? 'install-items' as const : 'remove-items' as const };
    const ask: ItemsAsk = goes ? { into: tools, on: true, ...(what === 'let-in' ? { letIn: true as const } : {}) } : { outOf: tools, ...(what === 'off' ? { off: true as const } : {}) };
    const ran = await runItems(share, (await host.read()).tools, entry, ask, goes ? await itemFiles(await context(), source, entry.plugin) : { commitAt: '' }, op);
    for (const told of ran.notices) host.notices?.(told.kind, told.notices);
    return ran;
  }

  /** The Undo of a turn: the plugin's entry put back as it was (`before`; null: none), then `back` run as a turn runs. */
  async function undoTurn(source: string, plugin: string, before: PluginEntry | null, back: PluginOp[], home: unknown): Promise<{ stopped?: string; done: PluginDone[] }> {
    const stopped = await guard(home);
    if (stopped) return { stopped, done: [] };
    const { problem, record } = await readPluginRecord(String(home)), id = entryOf(record, source, plugin)?.id ?? before?.id;
    if (problem || !(await changeRecord(String(home), now => withEntry(now, source, plugin, before ?? undefined)))) return { stopped: problem ?? 'The plugins record isn’t there. Nothing was changed.', done: [] };
    // Its items as they were (pluginlibrary.ts itemsBack), by the plugin's id as the click knew it; then the tools' own steps.
    const items = back.filter(op => op.action === 'items-back'), tools = (await host.read()).tools;
    const done: PluginDone[] = [];
    for (const op of items) if (id && host.share) done.push(...(await itemsBack(host.share(), tools, id, op.items ?? [], op, itemTools(tools))).done);
    const ran = await runPlan(back.filter(op => op.action !== 'items-back'), ownApi, String(home));
    return { ...ran, done: [...done, ...ran.done] };
  }

  /**
   * Use the plugin's (library.ts TAKE): one name he has, the plugin's taken over his in one tool with no installer, by a read of
   * the plugin (pluginlibrary.ts runItems, ItemsAsk `take`); its record doesn't change. Answers as a turn does, so its Undo is
   * a turn's (undoTurn: pluginlibrary.ts itemsBack, by the take's own Undo).
   */
  async function take(source: string, plugin: string, item: Pick<YourName, 'kind' | 'key'>, tool: HarnessId, home: unknown): Promise<PluginTurnResult> {
    const stopped = await guard(home, [tool]);
    if (stopped) return { stopped, done: [] };
    if (!holds(tool, item.kind)) return { stopped: `${toolName(tool)} holds no ${partWords[item.kind][1]}, so the plugin’s ${item.key} can’t go there. Nothing was changed.`, done: [] };
    const share = host.share?.(), entry = entryOf((await readPluginRecord(String(home))).record, source, plugin);
    if (!share || !entry) return { stopped: 'It has no entry in the plugins record here, so nothing was changed.', done: [] };
    const op = { source, marketName: entry.marketName, plugin, action: 'install-items' as const };
    const ran = await runItems(share, (await host.read()).tools, entry, { into: [tool], take: item }, await itemFiles(await context(), source, plugin), op);
    for (const told of ran.notices) host.notices?.(told.kind, told.notices);
    return { done: ran.done, before: entry, ...(ran.back ? { back: [{ ...op, tool, action: 'items-back' as const, items: ran.back }] } : {}), ...(ran.stopped ? { stopped: ran.stopped } : {}) };
  }

  /** One tool's own uninstall of one plugin. `marketName` is the catalog's name for it; `source` is checked against what the tool has. */
  async function uninstall(source: string, marketName: string, plugin: string, tool: PluginTool, home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home, [tool]);
    if (stopped) return { stopped, reports: [] };
    return told(source, plugin, { reports: withoutFileBytes([await use.uninstall(await context({ clis: true }), marketName, plugin, tool, source)]) });
  }

  /** One tool's own switch for one skill of an installed plugin (ENB-06). `marketName` and `source` as for uninstall. */
  async function setSkill(source: string, marketName: string, plugin: string, skill: string, tool: PluginTool, on: boolean, home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home, [tool]);
    if (stopped) return { stopped, reports: [] };
    const ctx = await context({ clis: true, ways: true });
    // Its marketplace entry says where its skills are, so the installed copy is read as the page reads the marketplace's
    // (none to read where the tool lists no marketplace of that name now).
    const catalog = source ? (await catalogFor(ctx, source, { counts: false })).catalog : undefined;
    return { reports: withoutFileBytes([await use.setSkill(ctx, marketName, plugin, skill, tool, on, source, catalog?.plugins.find(item => item.name === plugin)?.entry)]) };
  }

  /** One tool's own switch for one MCP server or agent of an installed plugin. `marketName` and `source` as for uninstall. */
  async function setPart(source: string, marketName: string, plugin: string, part: PartRef, tool: PluginTool, on: boolean, home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home, [tool]);
    if (stopped) return { stopped, reports: [] };
    return { reports: withoutFileBytes([await use.setPart(await context({ ways: true }), marketName, plugin, part, tool, on, source)]) };
  }

  /** One tool's own switch for a whole installed plugin. `marketName` and `source` as for uninstall. */
  async function setWhole(source: string, marketName: string, plugin: string, tool: PluginTool, on: boolean, home: unknown): Promise<PluginActionResult> {
    const stopped = await guard(home, [tool]);
    if (stopped) return { stopped, reports: [] };
    const ctx = await context({ clis: true, ways: true });
    return { reports: withoutFileBytes([await use.setWhole(ctx, marketName, plugin, tool, on, source)]) };
  }

  // ---------- The build's own marketplace in each tool's own list (ORG-03) ----------

  /**
   * The tools this build has added its marketplace to, by home, kept with the build's other data. A tool is added to once:
   * if the person then takes the marketplace out in the tool, it stays out until they add it again from here. Another
   * marketplace (a build that carries a different one) starts the record again.
   */
  const addedPath = join(host.dataDir, 'bundled', 'added-to-tools.json');
  const readAdded = async (marketName: string): Promise<Record<string, HarnessId[]>> => {
    try {
      const read = JSON.parse(await readFile(addedPath, 'utf8'));
      const homes = read?.marketplace === marketName && read.homes && typeof read.homes === 'object' ? read.homes as Record<string, unknown> : {};
      return Object.fromEntries(Object.entries(homes).map(([home, tools]) => [home, toolIds(tools)]));
    } catch { return {}; }
  };
  const noteAdded = async (marketName: string, home: string, tool: HarnessId) => {
    const homes = await readAdded(marketName);
    if (homes[home]?.includes(tool)) return;
    await writeDurably(addedPath, `${JSON.stringify({ marketplace: marketName, homes: { ...homes, [home]: [...(homes[home] ?? []), tool] } }, null, 2)}\n`);
  };
  /** Tools an automatic add was tried for this session, so one that failed is tried again at the next open, not at every read. */
  const tried = new Set<string>();

  /** Adds the carried marketplace to one tool's own list and notes it when it is there afterwards. */
  async function addCarriedToTool(tool: PluginTool): Promise<ListedReport> {
    const carried = host.bundled?.();
    if (!carried) return { tool, outcome: 'failed', message: 'This build carries no marketplace.' };
    const ctx = await context({ clis: true });
    const { catalog } = await catalogFor(ctx, carried.source, { counts: false });
    if (!catalog?.name) return { tool, outcome: 'failed', message: 'The marketplace this build carries can’t be read now.' };
    const { outcome, message } = await use.addMarketplace(ctx, catalog, tool).catch(error => ({ outcome: 'failed' as const, message: `It stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}` }));
    if (outcome === 'there' || outcome === 'added') await noteAdded(catalog.name, ctx.home, tool);
    return { tool, outcome, message };
  }

  /**
   * At open, and whenever the home is read: the build's marketplace is added to the own list of every tool found here that
   * takes plugins and has not been given it yet, through that tool's own command, so it shows in the tool's own plugin
   * browser. Nothing is installed. Only in this computer's own home, where writing is allowed, and only for a tool whose
   * commands can run (its CLI, or its desktop app's copy). `turn` runs each tool's add in the app's queue, one at a time,
   * so the page's own requests go between them.
   */
  async function addCarried(present: HarnessId[], turn: <T>(work: () => Promise<T>) => Promise<T>): Promise<ListedReport[]> {
    const carried = host.bundled?.(), open = host.home();
    if (!carried || !open?.actual || !(await host.writeAccess()).allowed || await waitsForResume()) return [];
    const marketName = (await catalogFor(await context(), carried.source, { counts: false })).catalog?.name;
    if (!marketName) return [];
    const done = (await readAdded(marketName))[open.home] ?? [];
    const todo = toolIds(present).filter(tool => !done.includes(tool) && !tried.has(`${open.home}\u0000${tool}`));
    if (!todo.length) return [];
    const { binaries } = await use.findClis();
    const reports: ListedReport[] = [];
    for (const tool of todo.filter(candidate => binaries[candidate])) {
      const key = `${open.home}\u0000${tool}`;
      tried.add(key);
      // The home may have been switched (or the tool left out) while this waited its turn: then nothing more is added, and
      // the tools left are tried again the next time this computer's home is read.
      // Its Manage switch may have been turned off meanwhile too: asked again now, as every write asks it (guard).
      const report = await turn(async () => { const now = host.home(); return now?.actual && now.home === open.home && !(await leftOutOf([tool])) ? addCarriedToTool(tool) : undefined; });
      if (report) reports.push(report);
      else { tried.delete(key); break; }
    }
    return reports;
  }

  /** The same for one tool, asked for on the marketplace's About tab: also the way back after taking it out in the tool. */
  async function addCarriedTo(tool: PluginTool, home: unknown): Promise<{ stopped?: string; report?: ListedReport; view?: PluginsView }> {
    const stopped = await guard(home, [tool]);
    if (stopped) return { stopped };
    const report = await addCarriedToTool(tool);
    return { report, view: await view() };
  }

  /** One plugin's marketplace copy on disk among the open home's known marketplaces (no fetch). */
  async function pluginCopy(marketName: string, plugin: string): Promise<{ folder: string; root: string; entry: Record<string, unknown>; atMarketplaceRoot: boolean } | undefined> {
    const ctx = await context();
    const { known } = await listedSources(ctx, columns((await host.read()).tools));
    for (const { source } of known) {
      const { catalog } = await catalogFor(ctx, source, { counts: false, local: true });
      const item = catalog?.root && catalog.name === marketName ? catalog.plugins.find(entry => entry.name === plugin) : undefined;
      const where = item ? await locate(ctx, catalog!.root!, item, true) : undefined;
      if (where && !('problem' in where)) return { ...where, atMarketplaceRoot: !!item!.folder && !!item!.isMarketplaceRoot };
    }
    return undefined;
  }

  return { view, listings, detail, readme, add, forget, decline, install, update, uninstall, setSkill, setPart, setWhole, items, pendingUpdates, noteJoined, toolManaged, turn, undoTurn, take, addCarried, addCarriedTo, beforeParts, pluginCopy };
}

type Handle = (channel: string, work: (...args: unknown[]) => Promise<unknown>) => void;
const isText = (value: unknown, max = 2000): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
/** Where a tool has a plugin's marketplace from, for a switch of something installed: '' where the tool lists no marketplace of that name now. */
const isSource = (value: unknown): value is string => value === '' || isText(value);
/** One item's state an Undo of a plugin's switch puts back (pluginlibrary.ts ItemState), as the page sent it back. */
const isItemState = (value: unknown): value is ItemState => {
  const state = record(value);
  return !!state && ['skill', 'agent', 'mcp'].includes(state.kind as string) && isText(state.key, 300) && typeof state.on === 'boolean'
    && Array.isArray(state.except) && state.except.every(tool => harnessIds.includes(tool as HarnessId)) && (state.entry === undefined || isText(state.entry, 100));
};
/** A marketplace or plugin name as the tools accept it; anything else never reaches a command line. */
const isName = (value: unknown): value is string => typeof value === 'string' && engine.SAFE_NAME.test(value);

/**
 * The Plugins page's requests. Each checks its arguments; anything malformed is refused, never guessed at. `handle`
 * queues a request behind the app's other work; `handleNow` answers at once, for requests that change nothing a tool uses.
 */
export function registerMarketplaces({ handle, handleNow }: { handle: Handle; handleNow: Handle }, host: MarketplaceHost): ReturnType<typeof createMarketplaces> {
  const markets = createMarketplaces(host);
  const open = () => !!host.home();
  handle('plugins:view', async (fresh, readId) => (open() ? markets.view(fresh === true, typeof readId === 'number' ? readId : undefined) : null));
  handleNow('plugins:readme', async source => (open() && isText(source) ? markets.readme(source) : null));
  handleNow('plugins:detail', async (source, plugin, local) => (open() && isText(source) && isName(plugin) ? markets.detail(source, plugin, local === true) : null));
  // Links from READMEs and marketplaces open in the browser: https only, and never inside the app.
  handleNow('open:external', async url => { if (isHttps(url)) await host.openExternal(url); });
  handle('plugins:add', async source => { if (!open() || !isText(source)) throw new Error('Invalid marketplace.'); return markets.add(source); });
  handle('plugins:forget', async source => (open() && isText(source) ? markets.forget(source) : null));
  handle('plugins:decline', async (source, again) => (open() && isText(source) ? markets.decline(source, again === true) : null));
  handle('plugins:pick-folder', async () => (await host.pickFolder()) ?? null);
  handle('plugins:add-carried', async (tool, home) => { const ids = toolIds([tool]); return open() && ids.length ? markets.addCarriedTo(ids[0]!, home) : { stopped: 'That request was malformed, so nothing ran.' }; });
  // A malformed step fails for its tools, so it never stops the rest of a run (an Update all, say).
  const refused = (tools: unknown) => ({ reports: failedFor(toolIds(Array.isArray(tools) ? tools : [tools]), 'That request was malformed, so nothing ran.') });
  handle('plugins:install', async (source, marketName, plugin, tools, home) => (open() && isText(source) && isName(marketName) && isName(plugin) ? markets.install(source, marketName, plugin, toolIds(tools), home) : refused(tools)));
  handle('plugins:update', async (source, marketName, plugin, tools, home) => (open() && isText(source) && isName(marketName) && isName(plugin) ? markets.update(source, marketName, plugin, toolIds(tools), home) : refused(tools)));
  handle('plugins:items', async (source, marketName, plugin, tools, home) => {
    const ids = itemTools(onlyAllowed(tools, harnessIds));
    return open() && isText(source) && isName(marketName) && isName(plugin) && ids.length ? markets.items(source, marketName, plugin, ids, home, false, true) : { reports: failedFor(ids, 'That request was malformed, so nothing ran.') };
  });
  handle('plugins:uninstall', async (source, marketplace, plugin, tool, home) => {
    const ids = toolIds([tool]);
    return open() && isText(source) && isName(marketplace) && isName(plugin) && ids.length ? markets.uninstall(source, marketplace, plugin, ids[0]!, home) : refused(tool);
  });
  // A skill keeps its own name (Codex writes it into config.toml as a string); the engine refuses one Copilot CLI's command line can't take.
  handle('plugins:skill', async (source, marketplace, plugin, skill, tool, on, home) => {
    const ids = toolIds([tool]);
    return open() && isSource(source) && isName(marketplace) && isName(plugin) && isText(skill, 200) && typeof on === 'boolean' && ids.length ? markets.setSkill(source, marketplace, plugin, skill, ids[0]!, on, home) : refused(tool);
  });
  handle('plugins:part', async (source, marketplace, plugin, part, tool, on, home) => {
    const ids = toolIds([tool]);
    const { kind, name } = record(part) ?? {};
    return open() && isSource(source) && isName(marketplace) && isName(plugin) && (kind === 'mcp' || kind === 'agent') && isText(name, 200) && typeof on === 'boolean' && ids.length ? markets.setPart(source, marketplace, plugin, { kind, name }, ids[0]!, on, home) : refused(tool);
  });
  // A whole plugin's switch and its Undo (turn, undoTurn). An Undo's steps come back from the page as the turn gave them: each is
  // checked to be one a turn makes, for this plugin, before any runs.
  const TURNS: PluginTurn[] = ['on', 'off', 'add', 'keep-out', 'let-in'];
  handle('plugins:turn', async (source, plugin, what, tool, home) => (open() && isText(source) && isName(plugin) && TURNS.includes(what as PluginTurn) && (tool == null || harnessIds.includes(tool as HarnessId))
    ? markets.turn(source, plugin, what as PluginTurn, (tool ?? undefined) as HarnessId | undefined, home) : { stopped: 'That request was malformed, so nothing ran.', done: [] }));
  const isBack = (source: string, plugin: string) => (op: unknown): op is PluginOp => {
    const step = record(op);
    return !!step && step.source === source && step.plugin === plugin && isName(step.marketName) && harnessIds.includes(step.tool as HarnessId)
      && ['install', 'remove', 'plugin-off', 'items-back'].includes(step.action as string)
      && (step.items === undefined || (step.action === 'items-back' && Array.isArray(step.items) && step.items.length <= 5000 && step.items.every(isItemState)));
  };
  const isEntry = (source: string, plugin: string) => (value: unknown): value is PluginEntry => {
    const entry = record(value);
    return !!entry && typeof entry.id === 'string' && engine.sameSource(String(entry.source), source) && entry.plugin === plugin && isName(entry.marketName) && typeof entry.on === 'boolean'
      && Array.isArray(entry.except) && entry.except.every(tool => harnessIds.includes(tool as HarnessId));
  };
  handle('plugins:undo-turn', async (source, plugin, before, back, home) => (open() && isText(source) && isName(plugin) && (before === null || isEntry(source, plugin)(before)) && Array.isArray(back) && back.length <= 50 && back.every(isBack(source, plugin))
    ? markets.undoTurn(source, plugin, before as PluginEntry | null, back as PluginOp[], home) : { stopped: 'That request was malformed, so nothing ran.', done: [] }));
  handle('plugins:take', async (source, plugin, item, tool, home) => {
    const { kind, key } = record(item) ?? {}, ids = itemTools(onlyAllowed([tool], harnessIds));
    return open() && isText(source) && isName(plugin) && ['skill', 'agent', 'mcp'].includes(kind as string) && isText(key, 300) && ids.length
      ? markets.take(source, plugin, { kind: kind as ItemKind, key: key as string }, ids[0]!, home) : { stopped: 'That request was malformed, so nothing ran.', done: [] };
  });
  handle('plugins:whole', async (source, marketplace, plugin, tool, on, home) => {
    const ids = toolIds([tool]);
    return open() && isSource(source) && isName(marketplace) && isName(plugin) && typeof on === 'boolean' && ids.length ? markets.setWhole(source, marketplace, plugin, ids[0]!, on, home) : refused(tool);
  });
  return markets;
}
