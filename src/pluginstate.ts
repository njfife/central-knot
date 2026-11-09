// Plugins: the page's state and actions. Marketplaces, what is chosen, what the last Apply all did, and where the person
// is browsing all live here, apart from the other features; app.ts only routes to it and resets it when the home changes.
import { announce, busy, rerender, state as app } from './app.ts';
import { plural } from './model.ts';
import { clear, describe, forSource, notUndone, pluginKey, prune, resultSentence, reverse, runPlan, type PluginDone, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { readInto, type Read } from './reads.ts';
import type { HarnessId, MarketplaceView, PluginDetail, PluginsView } from './types.ts';
import { andList, toolNames } from './words.ts';

const api = () => window.centralKnot;

export type MarketTab = 'plugins' | 'about';
/** What the page is doing, so it can say so; set by each action, cleared when it ends. */
export type MarketActivity = 'reading' | 'adding' | 'refreshing' | 'removing' | 'applying' | 'undoing';

const startNav = () => ({ source: undefined as string | undefined, tab: 'plugins' as MarketTab, plugin: undefined as string | undefined, find: '', category: undefined as string | undefined });

export const market = {
  /** Marketplaces and what each tool has installed, read when the page opens. */
  view: undefined as PluginsView | undefined,
  /** Why a marketplace could not be added, or why an Apply all stopped. */
  problem: undefined as string | undefined,
  activity: undefined as MarketActivity | undefined,
  /** Changes chosen but not applied (pluginplan.ts): nothing runs until Apply all. */
  draft: new Map() as PluginDraft,
  /**
   * The last Apply all (or Undo): each tool's report, whether it was an Undo, and in which home, so the toolbar can say
   * what happened and offer the way back there only. An Undo keeps `rest`, the reversals that didn't succeed.
   */
  lastRun: undefined as { reports: PluginDone[]; undo: boolean; home: string; rest?: PluginOp[] } | undefined,
  /** The plugin and tools a command is running for, so their boxes show it is working. */
  working: undefined as { source: string; plugin: string; tools: HarnessId[] } | undefined,
  /** Where the person is: the marketplace shown, its tab, an open plugin page, and the filter. */
  nav: startNav(),
  /** Each marketplace's README, by source. */
  readmes: new Map<string, Read<string | undefined>>(),
  /** Each plugin's contents and README, by plugin key; null when its files couldn't be found. */
  details: new Map<string, Read<PluginDetail | null>>(),
  /** What is typed in the add box, kept through loading and errors. */
  draftSource: '',
  /** The add box is open: always with no marketplaces yet, otherwise after "Add marketplace" is clicked. */
  addOpen: false,
};

/** A different home has other tools and other installs: nothing chosen, done or read in the last one carries over. */
export function resetMarket(): void {
  market.view = undefined; market.problem = undefined; market.draft.clear(); market.lastRun = undefined; market.working = undefined; market.addOpen = false;
  market.readmes.clear(); market.details.clear(); market.nav = startNav();
}

/** The marketplace on screen: the one chosen, or the first listed. The page and the reads both use this. */
export function current(): { entry: MarketplaceView; index: number } | undefined {
  const list = market.view?.marketplaces ?? [];
  const index = Math.max(0, list.findIndex(entry => entry.source === market.nav.source));
  return list[index] ? { entry: list[index]!, index } : undefined;
}

/** The toolbar's notice ("… added", "… refreshed") has done its job once the person moves on or chooses something. */
export function clearNotice(): void { if (app.outcome?.page === 'plugins') app.outcome = undefined; }

/** How many of a marketplace's plugins kept elsewhere are read ahead (each is a small Git copy), so a large catalog stays cheap. */
const REMOTE_READ_AHEAD = 8;

/** Reads, in the background, what the place on screen shows and hasn't been read yet: a README or a plugin's contents. */
function readShown(): void {
  const source = current()?.entry.source;
  if (!source) return;
  const plugin = market.nav.plugin;
  const readPlugin = (name: string) => readInto(market.details, pluginKey(source, name), () => api().pluginDetail(source, name).catch(() => null), rerender);
  if (plugin) readPlugin(plugin);
  else if (market.nav.tab === 'about') readInto(market.readmes, source, () => api().marketplaceReadme(source).catch(() => null).then(text => text ?? undefined), rerender);
  // Plugins kept in other repositories say what they hold once read; a few are read ahead so their rows can say it too.
  else for (const entry of (current()?.entry.plugins ?? []).filter(candidate => !candidate.components && candidate.from).slice(0, REMOTE_READ_AHEAD)) readPlugin(entry.name);
}

/** Moves within the page and reads what the new place shows. */
export function browse(patch: Partial<typeof market.nav>): void {
  market.nav = { ...market.nav, ...patch };
  clearNotice();
  readShown();
  rerender();
  document.getElementById('plugins-scroll')?.scrollTo(0, 0);
}

/** Reads every marketplace and install; `fresh` (Refresh all) fetches each Git marketplace again. */
export const loadPlugins = (fresh = false) => act('reading', 'Reading marketplaces…', async () => {
  market.view = (await api().plugins(fresh)) ?? undefined;
  market.problem = undefined;
  if (fresh) { market.readmes.clear(); market.details.clear(); }
  prune(market.draft, market.view);
  readShown();
  announce('');
  // With no marketplaces yet, the box to type one in is where the work starts.
  if (market.view && !market.view.marketplaces.length) requestAnimationFrame(() => document.getElementById('marketplace-source')?.focus());
});

/** Runs an action with the page saying what it is doing. */
function act(activity: MarketActivity, label: string, work: () => Promise<void>) {
  return busy(label, async () => {
    market.activity = activity;
    try { await work(); } finally { market.activity = undefined; }
  });
}

export const addMarketplace = (source: string) => act('adding', 'Reading the marketplace…', async () => {
  const result = await api().addMarketplace(source);
  if (result.view) market.view = result.view;
  market.problem = result.problem;
  if (result.problem) { announce(result.problem); return; }
  const added = market.view?.marketplaces.find(entry => entry.source === result.source);
  market.draftSource = '';
  market.addOpen = false;
  market.nav = { ...startNav(), source: added?.source };
  app.outcome = { page: 'plugins', item: added?.name || undefined, text: `${added ? `${added.name || added.source} added: ${plural(added.plugins.length, 'plugin')}` : 'Marketplace added'}. Nothing was installed.` };
  announce(app.outcome.text, true);
}).then(() => { if (!market.problem) (document.activeElement as HTMLElement | null)?.blur(); });

/** Forgets what was read for one marketplace (its README, its plugins' contents), so it is read again when shown. */
function dropReads(source: string): void {
  market.readmes.delete(source);
  for (const key of [...market.details.keys()]) if (forSource(key, source)) market.details.delete(key);
}

export const refreshMarketplace = (source: string) => act('refreshing', 'Refreshing the marketplace…', async () => {
  market.view = (await api().refreshMarketplace(source)) ?? market.view;
  dropReads(source);
  prune(market.draft, market.view);
  readShown();
  const entry = market.view?.marketplaces.find(candidate => candidate.source === source);
  app.outcome = { page: 'plugins', item: entry?.name || undefined, text: `${entry?.name || 'Marketplace'} refreshed: ${plural(entry?.plugins.length ?? 0, 'plugin')}. Nothing was installed.` };
  announce(app.outcome.text, true);
});

export const forgetMarketplace = (source: string) => act('removing', 'Removing from the list…', async () => {
  const name = market.view?.marketplaces.find(entry => entry.source === source)?.name;
  market.view = (await api().forgetMarketplace(source)) ?? market.view;
  dropReads(source);
  prune(market.draft, market.view);
  if (market.nav.source === source) market.nav = startNav();
  const text = `${name || 'It'} was removed from this list. Tools that added it keep it, and nothing was uninstalled.`;
  app.outcome = { page: 'plugins', item: name || undefined, text, act: { label: 'Add back', id: 'outcome-add-back', run: () => void addMarketplace(source) } };
  announce(text, true);
});

export const pickMarketplaceFolder = () => api().pickMarketplaceFolder();

/** Opens an https link in the browser. */
export const openLink = (url: string) => void api().openExternal(url);

/** Runs plugin changes through each tool's own command and keeps what each one did; choices not reached stay chosen. */
export const applyPluginOps = (ops: PluginOp[], undo = false) => act(undo ? 'undoing' : 'applying', undo ? 'Undoing…' : 'Applying…', async () => {
  const home = app.home!.home;
  market.problem = undefined;
  const planApi = { install: api().installPlugin, uninstall: api().uninstallPlugin };
  let result: Awaited<ReturnType<typeof runPlan>> = { done: [] };
  try {
    result = await runPlan(ops, planApi, home, step => { market.working = { source: step.source, plugin: step.plugin, tools: step.tools }; rerender(); });
  } finally {
    market.working = undefined;
    for (const entry of result.done) clear(market.draft, entry);
    market.lastRun = { reports: result.done, undo, home, rest: undo ? notUndone(ops, result.done) : undefined };
    market.problem = result.stopped;
    market.view = (await api().plugins().catch(() => null)) ?? market.view;
    prune(market.draft, market.view);
  }
  announce(market.problem ?? (resultSentence(describe(result.done, toolNames, andList, undo), undo) || 'Nothing changed.'), true);
});

/** The way back from the last run, while it is for the home on screen: its reversal, or what an Undo didn't get to. */
export function undoOps(): PluginOp[] {
  const last = market.lastRun;
  if (!last || last.home !== app.home?.home) return [];
  return last.undo ? last.rest ?? [] : reverse(last.reports);
}
