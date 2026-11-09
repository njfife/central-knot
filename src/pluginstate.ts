// Plugins: the page's state and actions. Marketplaces, what is chosen, what the last Apply all did, and where the person
// is browsing all live here, apart from the other features; app.ts only routes to it and resets it when the home changes.
import { announce, busy, rerender, state as app } from './app.ts';
import { plural } from './model.ts';
import { resultLines, forSource, pluginKey, prune, recordRun, resultSentence, reverse, runPlan, succeeded, type LastRun, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { FIND_FROM, categoriesOf, marketTitle, matches } from './pluginstatus.ts';
import { readInto, type Read } from './reads.ts';
import type { HarnessId, MarketplaceView, PluginDetail, PluginsView } from './types.ts';

const api = () => window.centralKnot;

export type MarketTab = 'plugins' | 'about';
/** What the page is doing, so it can say so; set by each action, cleared when it ends. */
export type MarketActivity = 'reading' | 'adding' | 'refreshing' | 'removing' | 'applying' | 'undoing';
/** Each activity's short label (the app's busy line) and what the page's band says while it runs. */
export const ACTIVITIES: Record<MarketActivity, { label: string; band: string }> = {
  reading: { label: 'Reading marketplaces…', band: 'Reading marketplaces… Nothing is installed by this.' },
  adding: { label: 'Reading the marketplace…', band: 'Reading the marketplace… Nothing is installed by this.' },
  refreshing: { label: 'Refreshing the marketplace…', band: 'Refreshing the marketplace… Nothing is installed by this.' },
  removing: { label: 'Removing from the list…', band: 'Removing from the list…' },
  applying: { label: 'Applying…', band: 'Applying… Each change runs that tool’s own command and can take a few seconds.' },
  undoing: { label: 'Undoing…', band: 'Undoing… Each change runs that tool’s own command and can take a few seconds.' },
};

const startNav = () => ({ source: undefined as string | undefined, tab: 'plugins' as MarketTab, plugin: undefined as string | undefined, find: '', category: undefined as string | undefined });

export const market = {
  /** Marketplaces and what each tool has installed, read when the page opens. */
  view: undefined as PluginsView | undefined,
  /** Why a marketplace could not be added, or why an Apply all stopped. */
  problem: undefined as string | undefined,
  activity: undefined as MarketActivity | undefined,
  /** Changes chosen but not applied (pluginplan.ts): nothing runs until Apply all. */
  draft: new Map() as PluginDraft,
  /** The last Apply all (or Undo), so the toolbar can say what happened and offer the way back, in that home only. */
  lastRun: undefined as LastRun | undefined,
  /** The plugin and tools a command is running for, so their boxes show it is working. */
  working: undefined as { source: string; plugin: string; tools: HarnessId[] } | undefined,
  /** Where the person is: the marketplace shown, its tab, an open plugin page, and the filter. */
  nav: startNav(),
  /** Each marketplace's README, by source. */
  readmes: new Map<string, Read<string | undefined>>(),
  /** Each plugin's contents and README, by plugin key; null when its files couldn't be found. */
  details: new Map<string, Read<PluginDetail | null>>(),
  /** Part descriptions opened with "Show more", by plugin key and part, so a redraw keeps them open. */
  opened: new Set<string>(),
  /** What is typed in the add box, kept through loading and errors. */
  draftSource: '',
  /** The add box is open: always with no marketplaces yet, otherwise after "Add marketplace" is clicked. */
  addOpen: false,
};

/** A different home has other tools and other installs: nothing chosen, done or read in the last one carries over. */
export function resetMarket(): void {
  market.view = undefined; market.problem = undefined; market.draft.clear(); market.lastRun = undefined; market.working = undefined; market.addOpen = false;
  market.readmes.clear(); market.details.clear(); market.opened.clear(); market.nav = startNav();
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

/** The plugins the marketplace on screen lists under the current find text and category. */
export const shownPlugins = (entry: MarketplaceView) => entry.plugins.filter(plugin => matches(plugin, market.nav.find) && (!market.nav.category || plugin.category === market.nav.category));

/** Reads, in the background, what the place on screen shows and hasn't been read yet: a README or a plugin's contents. */
function readShown(): void {
  const entry = current()?.entry;
  if (!entry) return;
  const source = entry.source;
  const readPlugin = (name: string) => readInto(market.details, pluginKey(source, name), () => api().pluginDetail(source, name).catch(() => null), rerender);
  if (market.nav.plugin) {
    // Opening a plugin whose files couldn't be read tries again; only a read that worked is kept.
    const key = pluginKey(source, market.nav.plugin);
    const last = market.details.get(key);
    if (last && !last.reading && (!last.value || last.value.problem)) market.details.delete(key);
    readPlugin(market.nav.plugin);
  }
  else if (market.nav.tab === 'about') readInto(market.readmes, source, () => api().marketplaceReadme(source).catch(() => null).then(text => text ?? undefined), rerender);
  // Plugins kept in other repositories say what they hold once read; the first few rows on screen are read ahead.
  else for (const plugin of shownPlugins(entry).filter(candidate => !candidate.components && candidate.from).slice(0, REMOTE_READ_AHEAD)) readPlugin(plugin.name);
}

/**
 * Every action that gets a new view of the marketplaces ends here. The view replaces the old one; a missing view keeps
 * the old one, unless `replace` (a full read that failed shows that nothing could be read). Then choices it made stale
 * are dropped, where the person is is checked against it, and what the place on screen shows is read.
 */
function showView(view: PluginsView | null | undefined, { replace = false } = {}): void {
  if (view || replace) market.view = view ?? undefined;
  prune(market.draft, market.view);
  settleNav();
  readShown();
}

/**
 * Lets go of a place that no longer exists after a refresh: a plugin no longer listed, a category no longer there, or
 * a find text once the list is short enough to have no find box (its filter would hide plugins with no way to clear it).
 */
function settleNav(): void {
  const entry = current()?.entry;
  if (!entry) return;
  const { plugin, category, find } = market.nav;
  const categories = categoriesOf(entry);
  market.nav = {
    ...market.nav,
    plugin: plugin && entry.plugins.some(candidate => candidate.name === plugin) ? plugin : undefined,
    category: category && categories.length > 1 && categories.includes(category) ? category : undefined,
    find: entry.plugins.length > FIND_FROM ? find : '',
  };
}

/** Moves within the page and reads what the new place shows. */
export function browse(patch: Partial<typeof market.nav>): void {
  market.nav = { ...market.nav, ...patch };
  clearNotice();
  readShown();
  rerender();
  document.getElementById('plugins-scroll')?.scrollTo(0, 0);
}

/** Another page's quiet look at what is installed where (Harnesses): read once, with no busy state and no reads ahead. */
export function peekPlugins(): void {
  if (market.view || peeking) return;
  peeking = true;
  void api().plugins(false).then(view => { if (view && !market.view) { market.view = view; rerender(); } }, () => undefined).finally(() => { peeking = false; });
}
let peeking = false;

/** Reads every marketplace and install; `fresh` (Refresh all) fetches each Git marketplace again. */
export const loadPlugins = (fresh = false) => act('reading', async () => {
  const view = await api().plugins(fresh);
  market.problem = undefined;
  // Refresh all reads everything again; a folder marketplace is read from disk every time, so what was read from it may have changed.
  if (fresh) { market.readmes.clear(); market.details.clear(); }
  else for (const entry of view?.marketplaces ?? []) if (entry.kind === 'folder') dropReads(entry.source);
  showView(view, { replace: true });
  announce('');
});

/** Runs an action with the page saying what it is doing. */
function act(activity: MarketActivity, work: () => Promise<void>) {
  return busy(ACTIVITIES[activity].label, async () => {
    market.activity = activity;
    try { await work(); } finally { market.activity = undefined; }
  });
}

export const addMarketplace = (source: string) => act('adding', async () => {
  const result = await api().addMarketplace(source);
  market.problem = result.problem;
  if (result.problem) { showView(result.view); announce(result.problem); return; }
  const added = result.view?.marketplaces.find(entry => entry.source === result.source);
  market.draftSource = '';
  market.addOpen = false;
  market.nav = { ...startNav(), source: added?.source };
  showView(result.view);
  app.outcome = { page: 'plugins', item: added?.name || undefined, text: `${added ? `${marketTitle(added)} added: ${plural(added.plugins.length, 'plugin')}` : 'Marketplace added'}. Nothing was installed.` };
  announce(app.outcome.text, true);
  // Once added, focus leaves the add box (now gone), so the next key press doesn't land in an input that isn't there.
}).then(() => { if (!market.problem) (document.activeElement as HTMLElement | null)?.blur(); });

/** Forgets what was read for one marketplace (its README, its plugins' contents), so it is read again when shown. */
function dropReads(source: string): void {
  market.readmes.delete(source);
  for (const key of [...market.details.keys()]) if (forSource(key, source)) market.details.delete(key);
}

export const refreshMarketplace = (source: string) => act('refreshing', async () => {
  const view = await api().refreshMarketplace(source);
  dropReads(source);
  showView(view);
  const entry = market.view?.marketplaces.find(candidate => candidate.source === source);
  app.outcome = { page: 'plugins', item: entry?.name || undefined, text: `${entry ? marketTitle(entry) : 'Marketplace'} refreshed: ${plural(entry?.plugins.length ?? 0, 'plugin')}. Nothing was installed.` };
  announce(app.outcome.text, true);
});

export const forgetMarketplace = (source: string) => act('removing', async () => {
  const gone = market.view?.marketplaces.find(entry => entry.source === source);
  const name = gone ? marketTitle(gone) : undefined;
  const view = await api().forgetMarketplace(source);
  dropReads(source);
  if (market.nav.source === source) market.nav = startNav();
  showView(view);
  const text = `${name || 'It'} was removed from this list. Tools that added it keep it, and nothing was uninstalled.`;
  app.outcome = { page: 'plugins', item: name || undefined, text, act: { label: 'Add back', id: 'outcome-add-back', run: () => void addMarketplace(source) } };
  announce(text, true);
});

export const pickMarketplaceFolder = () => api().pickMarketplaceFolder();

/** Opens an https link in the browser. */
export const openLink = (url: string) => void api().openExternal(url);

/** Runs plugin changes through each tool's own command and keeps what each one did; choices not reached stay chosen. */
export const applyPluginOps = (ops: PluginOp[], undo = false) => act(undo ? 'undoing' : 'applying', async () => {
  const home = app.home!.home;
  market.problem = undefined;
  const planApi = { install: api().installPlugin, uninstall: api().uninstallPlugin };
  let result: Awaited<ReturnType<typeof runPlan>> = { done: [] };
  try {
    result = await runPlan(ops, planApi, home, step => { market.working = { source: step.source, plugin: step.plugin, tools: step.tools }; rerender(); });
  } finally {
    market.working = undefined;
    market.lastRun = recordRun(market.draft, ops, result.done, undo, home);
    market.problem = result.stopped;
    showView(await api().plugins().catch(() => null));
  }
  announce(market.problem ?? (resultSentence(resultLines(result.done, undo), undo) || 'Nothing changed.'), true);
});

/**
 * Closes the problem band: the stop reason and the failure lines go, and what succeeded stays, so the toolbar keeps its
 * result line and Undo.
 */
export function dismissProblems(): void {
  market.problem = undefined;
  if (market.lastRun) market.lastRun = { ...market.lastRun, done: market.lastRun.done.filter(entry => succeeded(entry.report)) };
}

/** The way back from the last run, while it is for the home on screen: its reversal, or what an Undo didn't get to. */
export function undoOps(): PluginOp[] {
  const last = market.lastRun;
  if (!last || last.home !== app.home?.home) return [];
  return last.undo ? last.rest ?? [] : reverse(last.done);
}
