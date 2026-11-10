// Plugins: the page's state and actions. Marketplaces, what is chosen, what the last Apply all did, and where the person
// is browsing all live here, apart from the other features; app.ts only routes to it and resets it when the home changes.
import { announce, busy, rerender, setHome, state as app, tell } from './app.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';
import { plural } from './model.ts';
import { isParts, resultLines, forSource, pluginKey, prune, recordRun, resultSentence, reverse, runPlan, type LastRun, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { FIND_FROM, categoriesOf, installed, marketTitle, matches, partsOf, partsTools } from './pluginstatus.ts';
import { pluginsInDisplayOrder } from './roworder.ts';
import { readInto, type Read } from './reads.ts';
import type { HarnessId, MarketplaceView, PartPlan, PluginDetail, PluginsView } from './types.ts';

const api = () => window.centralKnot;

export type MarketTab = 'plugins' | 'about';
/**
 * The action the page is running, so it can say so; set by each action, cleared when it ends. Reading the marketplaces
 * is not an action: it is the page's data (market.read), and a read never clears an action's activity.
 */
export type MarketActivity = 'adding' | 'removing' | 'applying' | 'undoing';
/** Each activity's short label (the app's busy line) and what the page's band says while it runs. */
export const ACTIVITIES: Record<MarketActivity, { label: string; band: string }> = {
  adding: { label: 'Reading the marketplace…', band: 'Reading the marketplace… Nothing is installed by this.' },
  removing: { label: 'Removing from the list…', band: 'Removing from the list…' },
  applying: { label: 'Applying…', band: 'Applying… Each change runs that tool’s own command and can take a few seconds.' },
  undoing: { label: 'Undoing…', band: 'Undoing… Each change runs that tool’s own command and can take a few seconds.' },
};

const startNav = () => ({ source: undefined as string | undefined, tab: 'plugins' as MarketTab, plugin: undefined as string | undefined, find: '', category: undefined as string | undefined });

export const market = {
  /** Marketplaces and what each tool has installed: read when the page opens or the home changes (pagedata.ts). */
  read: pageData<PluginsView>(),
  get view(): PluginsView | undefined { return this.read.data; },
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
  /** For each plugin, what each tool without it would get as parts (parts.ts), read when its page opens. */
  partsPlans: new Map<string, Read<Partial<Record<HarnessId, PartPlan[]>> | null>>(),
  /** The last contents read of each plugin, shown while it is read again after a new view (see markDetailsStale, shownDetail, forgetDetails). */
  previous: new Map<string, PluginDetail>(),
  /** Part descriptions opened with "Show more" and part files opened, by plugin key and part, so a redraw keeps them open (see toggleOpened). */
  opened: new Set<string>(),
  /** What is typed in the add box, kept through loading and errors. */
  draftSource: '',
  /** The add box is open: always with no marketplaces yet, otherwise after "Add marketplace" is clicked. */
  addOpen: false,
};

/** Opens or closes one remembered part ("Show more", or a part's file) and redraws. */
export function toggleOpened(key: string): void {
  if (market.opened.has(key)) market.opened.delete(key); else market.opened.add(key);
  rerender();
}

/** A different home has other tools and other installs: nothing chosen, done or read in the last one carries over. */
export function resetMarket(): void {
  resetPageData(market.read); market.problem = undefined; market.draft.clear(); market.lastRun = undefined; market.working = undefined; market.addOpen = false;
  market.readmes.clear(); forgetDetails(); market.partsPlans.clear(); market.opened.clear(); market.nav = startNav();
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

/** How many of the tools shown have a plugin, whole or as parts. */
const holdingTools = (entry: MarketplaceView, plugin: string, tools: readonly HarnessId[]) => tools.filter(tool => installed(entry, plugin, tool) || !!partsOf(entry, plugin, tool)).length;

/**
 * The plugins the marketplace on screen lists under the current find text and category: those every tool has first, then
 * those some tool has, then those no tool has, by name within each. Pending choices move nothing until Apply all.
 */
export function shownPlugins(entry: MarketplaceView) {
  const tools = market.view?.tools ?? [];
  const listed = entry.plugins.filter(plugin => matches(plugin, market.nav.find) && (!market.nav.category || plugin.category === market.nav.category));
  return pluginsInDisplayOrder(listed, plugin => holdingTools(entry, plugin.name, tools), tools.length);
}

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
    if (market.view?.tools.some(tool => partsTools.includes(tool))) readInto(market.partsPlans, key, () => api().partsPlan(source, market.nav.plugin!).catch(() => null), rerender);
  }
  else if (market.nav.tab === 'about') readInto(market.readmes, source, () => api().marketplaceReadme(source).catch(() => null).then(text => text ?? undefined), rerender);
  // Plugins kept in other repositories say what they hold once read; the first few rows on screen are read ahead.
  else for (const plugin of shownPlugins(entry).filter(candidate => !candidate.components && candidate.from).slice(0, REMOTE_READ_AHEAD)) readPlugin(plugin.name);
}

/**
 * Every new view of the marketplaces ends here. An action's view replaces the page's data (and a read still on its way
 * is dropped as older); a missing view keeps what was there. Then choices it made stale are dropped, where the person is
 * is checked against it, and what the place on screen shows is read.
 */
function showView(view?: PluginsView | null): void {
  if (view) putPageData(market.read, view);
  settleView();
}

/** After a new view: stale choices go, the place on screen is checked against it, and what it shows is read. */
function settleView(): void {
  markDetailsStale();
  prune(market.draft, market.view);
  settleNav();
  readShown();
}

/**
 * A new view carries new install states, and a plugin's contents include each tool's installed copy, so each plugin's
 * contents are read again when shown. Until then the last read stays on screen (`previous`). A read still on its way is
 * dropped when it lands (its placeholder is gone). A read that failed and holds no tool's copy is kept: it is tried again
 * only when its plugin is opened or on Refresh, so an offline Git source isn't cloned again on every view.
 */
function markDetailsStale(): void {
  for (const [key, read] of [...market.details]) {
    const value = read.reading ? undefined : read.value;
    if (value?.problem && !Object.keys(value.installed ?? {}).length) continue;
    if (value) market.previous.set(key, value);
    market.details.delete(key);
  }
}

/** Forgets every plugin's contents, the ones shown while re-reading too: after a Refresh they may all have changed. */
function forgetDetails(): void {
  market.details.clear();
  market.previous.clear();
}

/** A plugin's contents to show: the latest read, or while it is read again, the one before (undefined when never read). */
export function shownDetail(key: string): PluginDetail | null | undefined {
  const read = market.details.get(key);
  return read && !read.reading ? read.value : market.previous.get(key);
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

/**
 * Reads every marketplace and install into the page's slot; `fresh` (Refresh all) fetches each Git marketplace again,
 * and `readId` (the home's view, just read) lets the main process use that read rather than reading the home again.
 * The page says it is reading meanwhile, and anything else can go on: an action keeps its own activity and result.
 */
export async function loadPlugins(fresh = false, readId?: number): Promise<void> {
  const reading = readPageData(market.read, () => api().plugins(fresh, readId));
  rerender();
  const result = await reading;
  if (result === 'dropped') return;
  if (result === 'ready') {
    // Refresh all reads every README and every plugin's files again, and tries again those that couldn't be read (see
    // markDetailsStale); a folder marketplace is read from disk every time, so its README may have changed.
    if (fresh) { market.readmes.clear(); forgetDetails(); market.partsPlans.clear(); }
    else for (const entry of market.view?.marketplaces ?? []) if (entry.kind === 'folder') market.readmes.delete(entry.source);
    settleView();
    markReread();
  }
  rerender();
}

/** The tools were read again: the last run's result is only named from now on (its Undo stays), never restated over a page that may differ. */
const markReread = () => { if (market.lastRun) market.lastRun = { ...market.lastRun, reread: true }; };

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
  // The outcome first, the name last, so a narrow status bar that shortens the message cuts the name, not the news.
  tell({ page: 'plugins', item: added?.name || undefined, text: added ? `Marketplace added: ${plural(added.plugins.length, 'plugin')}, nothing installed (${marketTitle(added)}).` : 'Marketplace added. Nothing was installed.' });
  // Once added, focus leaves the add box (now gone), so the next key press doesn't land in an input that isn't there.
}).then(() => { if (!market.problem) (document.activeElement as HTMLElement | null)?.blur(); });

/** Forgets what was read for one marketplace (its README, its plugins' contents), so it is read again when shown. */
function dropReads(source: string): void {
  market.readmes.delete(source);
  for (const key of [...market.details.keys()]) if (forSource(key, source)) market.details.delete(key);
  for (const key of [...market.partsPlans.keys()]) if (forSource(key, source)) market.partsPlans.delete(key);
}

export const forgetMarketplace = (source: string) => act('removing', async () => {
  const gone = market.view?.marketplaces.find(entry => entry.source === source);
  const name = gone ? marketTitle(gone) : undefined;
  const view = await api().forgetMarketplace(source);
  market.readmes.delete(source);
  if (market.nav.source === source) market.nav = startNav();
  showView(view);
  const text = `${name || 'It'} was removed from this list. Tools that added it keep it, and nothing was uninstalled.`;
  tell({ page: 'plugins', item: name || undefined, text, act: { label: 'Add back', id: 'outcome-add-back', run: () => void addMarketplace(source) } });
});

export const pickMarketplaceFolder = () => api().pickMarketplaceFolder();

/** Opens an https link in the browser. */
export const openLink = (url: string) => void api().openExternal(url);

/** Runs plugin changes through each tool's own command and keeps what each one did; choices not reached stay chosen. */
export const applyPluginOps = (ops: PluginOp[], undo = false) => act(undo ? 'undoing' : 'applying', async () => {
  const home = app.home!.home;
  market.problem = undefined;
  const planApi = { install: api().installPlugin, update: api().updatePlugin, uninstall: api().uninstallPlugin, setSkill: api().setPluginSkill, parts: api().pluginParts };
  let result: Awaited<ReturnType<typeof runPlan>> = { done: [] };
  try {
    result = await runPlan(ops, planApi, home, step => { market.working = { source: step.source, plugin: step.plugin, tools: step.tools }; rerender(); });
  } finally {
    market.working = undefined;
    market.lastRun = recordRun(market.draft, ops, result.done, undo, home);
    market.problem = result.stopped;
    showView(await api().plugins().catch(() => null));
    // Parts are ordinary skills, MCP servers and agents: the other pages see them (and where they came from) at once.
    if (ops.some(op => isParts(op.action))) {
      setHome(await api().refresh().catch(() => null));
      // What each tool now holds changed, so every plugin's plan (which names clash) is read again when shown.
      market.partsPlans.clear();
      readShown();
    }
  }
  // A result that offers Undo is said in the toolbar, with its Undo; one that only tells (an Undo done) in the status bar.
  announce(market.problem ?? (resultSentence(resultLines(result.done, undo), undo) || 'Nothing changed.'), !market.problem && undoOps().length > 0);
});

/**
 * Closes the problem band: the stop reason and the problem lines go, and the run itself stays, so the toolbar keeps its
 * result line and Undo (including a failed parts run's, for what it did change).
 */
export function dismissProblems(): void {
  market.problem = undefined;
  // Closed, not dropped: a failed run that still changed something (part of a parts run) keeps its Undo.
  if (market.lastRun) market.lastRun = { ...market.lastRun, problemsClosed: true };
}

/** The way back from the last run, while it is for the home on screen: its reversal, or what an Undo didn't get to. */
export function undoOps(): PluginOp[] {
  const last = market.lastRun;
  if (!last || last.home !== app.home?.home) return [];
  return last.undo ? last.rest ?? [] : reverse(last.done);
}
