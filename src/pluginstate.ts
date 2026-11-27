// Plugins: the page's state and actions. Marketplaces, what the last run did, and where the person is browsing all live
// here, apart from the other features; app.ts only routes to it and resets it when the home changes.
// Clicks go by one of two routes, split by whether the plugin's record changes: the switch and each tool's box go through
// turnPlugin (main records first, marketplaces.ts turn); Update, Update all, a skill's switch, Use the plugin's (usePlugins, whose
// Undo is a turn's) and their Undo go through applyPluginOps or under busy as it does. Both set market.lastRun, which the window's header says with one Undo (pluginspage.ts pluginsResult); a newer
// result said there in its place lets it go (overRun).
// Which clicks wait their turn and which lock, in one place:
// - A switch or a tool's box joins the page's one list of clicks (clicklist.ts, which the item lists' switches join too) as a
//   PluginClick, sent to main one click at a time, in the order clicked (runClick); its run is decided there as an item's is
//   (clicklist.ts runAt), the run's clicks are the list's (market.clicks), and each row says its own click's state (pluginparts.ts
//   clickNote). That plugin's switch and boxes stay off from its click until
//   the view is read back after it (pluginBusy); every other plugin's switch, and the rest of the app, stay usable meanwhile. The
//   home is read once, when its run ends (app.ts oweHomeRead). Its one Undo is its last click's.
// - Every other action here runs under app.ts busy, and is off while the page acts (app.ts acting: busy, or a run of clicks,
//   which also says why), so a click on one lands on a disabled control and is dropped, never run twice. A switch is off under
//   busy too.
// - A tool's line on a plugin's item in the Library (pluginline.ts) makes a tool's box's own turn (Install the plugin, Put its
//   items here, Turn the plugin on or off): turnFromLine joins the page's one list as a run of its own; its line says it waits and runs
//   (lineBusy), and its result, with the turn's Undo (undoLine), is a LineResult (its one lifetime is there), on its line or, when
//   that isn't on screen, in the header. It sets no market.lastRun: the Plugins page's own result is its own clicks'. An act on a
//   plugin from either page retires that plugin's earlier results and Undo on both (retire).
// Steps that run by themselves (pluginupdates.ts) take their turn with the page's in main's one queue.
import { harnessTabShown, noteMove, showPage, announce, busy, focusWhenDone, oweHomeRead, pinnedRows, profileEndedLine, profilesBefore, readHomeOnce, rerender, saidInStatusBar, setHome, state as app, tell, toolWays, withReloads, type Outcome, type ProfilesBefore } from './app.ts';
import { pluginReloads, reloadAdvice, settleReloads, type ReloadAdvice, type ReloadChange } from './reload.ts';
import { clickList, drop, endRun, join, runAt, type Turn } from './clicklist.ts';
import { pin, placeIn } from './itemrow.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';
import { plural } from './model.ts';
import { notUndone, resultLines, forSource, pluginKey, resultSentence, reverse, runPlan, succeeded, unreachedOps, type LastRun, type PluginDone, type PluginOp, type ResultLine, type RunPlace } from './pluginplan.ts';
import { FIND_FROM, boxOf, categoriesOf, copiesToCompare, installedFrom, marketTitle, matches, pluginPlace, samePart, toolMark } from './pluginstatus.ts';
import { counted } from './pluginswitch.ts';
import { yoursStay } from './pluginline.ts';
import type { PluginEntry } from './pluginrecord.ts';
import { readInTurn, readInto, type Read } from './reads.ts';
import type { HarnessId, MarketplaceView, PartRef, PluginDetail, PluginTurn, PluginTurnResult, PluginsView, YourName } from './types.ts';
import { andList, toolNames } from './words.ts';

const api = () => window.centralKnot;

export type MarketTab = 'plugins' | 'about';
/**
 * The action the page is running, so it can say so; set by each action, cleared when it ends. Reading the marketplaces
 * is not an action: it is the page's data (market.read), and a read never clears an action's activity.
 */
export type MarketActivity = 'adding' | 'removing' | 'applying' | 'undoing' | 'listing' | 'checking';
/** Each activity's short label (the app's busy line) and what the page's band says while it runs. */
export const ACTIVITIES: Record<MarketActivity, { label: string; band: string }> = {
  adding: { label: 'Reading the marketplace…', band: 'Reading the marketplace… Nothing is installed by this.' },
  removing: { label: 'Removing from the list…', band: 'Removing from the list…' },
  applying: { label: 'Applying…', band: 'Applying… Each change runs that tool’s own command. An update can take a minute or more.' },
  undoing: { label: 'Undoing…', band: 'Undoing… Each change runs that tool’s own command and can take a few seconds.' },
  checking: { label: 'Checking for newer plugins…', band: 'Checking for newer plugins… Nothing is installed by this.' },
  listing: { label: 'Listing the marketplace…', band: 'Listing the marketplace in the tool’s own plugin list… Nothing is installed by this.' },
};

/** `marketName`: the marketplace to open when `source` is spelled as a tool recorded it, not as the page lists it (a plugin item's link); `hookTool`: tool selected for running hooks on the plugin's page. */
const startNav = (): { source?: string; tab: MarketTab; plugin?: string; find: string; category?: string; marketName?: string; hookTool?: HarnessId } => ({ source: undefined, tab: 'plugins', plugin: undefined, find: '', category: undefined });

const runs = new Map<RunPlace, LastRun>();
const problems = new Map<RunPlace, string>();

export const market = {
  /** Marketplaces and what each tool has installed: read when the page opens or the home changes (pagedata.ts). */
  read: pageData<PluginsView>(),
  get view(): PluginsView | undefined { return this.read.data; },
  /** Why a marketplace could not be added, or why a run stopped, for the place open now. */
  get problem(): string | undefined { return problems.get(placeNow()); },
  set problem(text: string | undefined) { setProblem(text); },
  activity: undefined as MarketActivity | undefined,
  /** The last run (a click or its Undo) for the place open now, so the header can say what happened and offer the way back, in that home only. */
  get lastRun(): LastRun | undefined { return runs.get(placeNow()); },
  set lastRun(run: LastRun | undefined) { setRun(run); },
  /** The plugin and tools a command is running for, so their marks show it is working. */
  working: undefined as { source: string; plugin: string; tools: HarnessId[] } | undefined,
  /** The switch clicks of the latest run, in the order clicked: the list's (clicklist.ts), until a new run starts or the plugins change. */
  get clicks(): PluginClick[] { return clickList.turns.filter(isPluginClick); },
  /** Where the person is: the marketplace shown, its tab, an open plugin page, and the filter. */
  nav: startNav(),
  /** Each marketplace's README, by source. */
  readmes: new Map<string, Read<string | undefined>>(),
  /** Each plugin's contents and README, by plugin key; null when its files couldn't be found. */
  details: new Map<string, Read<PluginDetail | null>>(),
  /** The last contents read of each plugin, shown while it is read again after a new view (see markDetailsStale, shownDetail, forgetDetails). */
  previous: new Map<string, PluginDetail>(),
  /** Part descriptions opened with "Show more" and part files opened, by plugin key and part, so a redraw keeps them open (see toggleOpened). */
  opened: new Set<string>(),
  /** What is typed in the add box, kept through loading and errors. */
  draftSource: '',
  /** The add box is open: always with no marketplaces yet, otherwise after "Add marketplace" is clicked. */
  addOpen: false,
  /** The one Uninstall… question open, by plugin key and tool (pluginparts.ts uninstallControl), until its Cancel, Escape or confirm. */
  asking: undefined as string | undefined,
};

/** Opens or closes one remembered part ("Show more", or a part's file) and redraws. */
export function toggleOpened(key: string): void {
  if (market.opened.has(key)) market.opened.delete(key); else market.opened.add(key);
  rerender();
}

/** A different home has other tools and other installs: nothing done or read in the last one carries over. */
export function resetMarket(): void {
  // Its clicks leave the list: those not yet sent never run, and the result of one running is passed over (runClick).
  drop(turn => isPluginClick(turn) || isLineClick(turn));
  viewFor = undefined;
  results = [];
  resetPageData(market.read); runs.clear(); problems.clear(); market.working = undefined; market.addOpen = false; market.asking = undefined;
  market.readmes.clear(); forgetDetails(); market.opened.clear(); market.nav = startNav();
}

/** The requested listing, including a tool's alternate spelling resolved by marketplace name. */
export function listedMarket({ source, marketName }: Pick<typeof market.nav, 'source' | 'marketName'>) {
  const list = market.view?.marketplaces;
  return list?.find(entry => entry.source === source) ?? list?.find(entry => !!marketName && entry.name === marketName);
}

/** The marketplace on screen: the one chosen, or the first listed. The page and the reads both use this. */
export function current(): { entry: MarketplaceView; index: number } | undefined {
  const list = market.view?.marketplaces ?? [], entry = listedMarket(market.nav) ?? list[0];
  return entry && { entry, index: list.indexOf(entry) };
}

/** Which plugin-result place is open now (`'plugins'`, or a tool's Plugins tab under Harnesses), if any. The one place every caller asks. */
export const pluginsResultPlace = (): RunPlace | undefined =>
  app.page === 'plugins' ? 'plugins' : harnessTabShown() === 'plugins' ? app.harness : undefined;
const placeNow = (): RunPlace => pluginsResultPlace() ?? 'plugins';
const showsPluginsResult = (place?: RunPlace) => {
  const here = pluginsResultPlace();
  return place !== undefined ? here === place : !!here;
};
const setProblem = (text: string | undefined, place: RunPlace = placeNow()) => {
  if (text) problems.set(place, text);
  else problems.delete(place);
};
const setRun = (run: LastRun | undefined, place: RunPlace = run?.place ?? placeNow()) => {
  if (run) runs.set(place, { ...run, place });
  else runs.delete(place);
};

/** The toolbar's notice ("… added", "… refreshed") has done its job once the person moves on. */
export function clearNotice(): void {
  if (pluginsResultPlace() && app.outcome?.page === app.page) app.outcome = undefined;
}

/** How many of a marketplace's plugins kept elsewhere are read ahead (each is a small Git copy), so a large catalog stays cheap. */
const REMOTE_READ_AHEAD = 8;

/**
 * The plugins the marketplace on screen lists under the current find text and category: those every tool that can take
 * them has first, then those some tool has, then those no tool has, by name within each (pluginstatus.ts pluginPlace); a
 * plugin whose switch was clicked on this list keeps the place it had (itemrow.ts Pinned).
 */
export function shownPlugins(entry: MarketplaceView) {
  const view = market.view;
  const listed = entry.plugins.filter(plugin => matches(plugin, market.nav.find) && (!market.nav.category || plugin.category === market.nav.category));
  if (!view) return listed;
  const pins = pinnedPlugins(entry), place = new Map(listed.map(plugin => [plugin.name, placeIn(pins, plugin.name, pluginPlace(view, entry, plugin.name))]));
  return listed.sort((first, second) => place.get(first.name)! - place.get(second.name)!);
}

/** The plugins pinned on a marketplace's list, named by the marketplace and its category, never Find (app.ts pinnedRows). */
export const pinnedPlugins = (entry: MarketplaceView) => pinnedRows<number>(`plugins ${entry.source} ${market.nav.category ?? ''}`);

/** How many installed plugins' files the list reads at once in the background (see readShown). */
const COMPARE_AT_ONCE = 3;
// A background read landing redraws; the find box keeps its caret there as everywhere (dom.ts keepSelection). Called through an
// arrow: app.ts, which owns rerender, imports this module, so rerender is not there yet while this one loads.
const comparing = readInTurn(market.details, COMPARE_AT_ONCE, () => rerender());

/** Reads, in the background, what the place on screen shows and hasn't been read yet: a README or a plugin's contents. */
function readShown(): void {
  const entry = current()?.entry;
  if (!entry) return;
  const source = entry.source;
  const readPlugin = (name: string) => readInto(market.details, pluginKey(source, name), () => api().pluginDetail(source, name).catch(() => null), rerender);
  if (market.nav.plugin) {
    // Opening a plugin whose files couldn't be read tries again; only a read that worked is kept.
    const key = pluginKey(source, market.nav.plugin);
    // A quiet read of it (below) gives way too: it may have left out files that need fetching.
    const last = market.details.get(key);
    if (last && (last.reading ? last.quiet : !last.value || last.value.problem)) market.details.delete(key);
    readPlugin(market.nav.plugin);
  }
  else if (market.nav.tab === 'about') readInto(market.readmes, source, () => api().marketplaceReadme(source).catch(() => null).then(text => text ?? undefined), rerender);
  // Plugins kept in other repositories say what they hold once read; the first few rows on screen are read ahead.
  else for (const plugin of shownPlugins(entry).filter(candidate => !candidate.components && candidate.from).slice(0, REMOTE_READ_AHEAD)) {
    // Not read by a quiet read (below), whose copy wasn't on disk: this read may fetch it.
    const last = market.details.get(pluginKey(source, plugin.name));
    if (last && !last.reading && last.value === null) market.details.delete(pluginKey(source, plugin.name));
    readPlugin(plugin.name);
  }
  // Then, while Plugins is open, the files of the plugins some tool has installed, a few at a time and only from disk, so
  // a copy that differs from the marketplace's shows on the list without its page being opened (pluginstatus.copyStale).
  const view = market.view;
  comparing.set(app.page === 'plugins' && view ? copiesToCompare(view, entry).map(name => [pluginKey(source, name), () => api().pluginDetail(source, name, true).catch(() => null)]) : []);
}

/**
 * Every new view of the marketplaces ends here. An action's view replaces the page's data (and a read still on its way
 * is dropped as older); a missing view keeps what was there. Then where the person is is checked against it, and what the
 * place on screen shows is read.
 */
function showView(view?: PluginsView | null): void {
  if (view) putPageData(market.read, view);
  settleView();
}

/** After a new view: the place on screen is checked against it, and what it shows is read. */
function settleView(): void {
  markDetailsStale();
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
  comparing.set([]);
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
  const selected = listedMarket(market.nav);
  if ((market.nav.source || market.nav.marketName) && !selected) { market.nav = startNav(); return; }
  const entry = selected ?? market.view?.marketplaces[0];
  if (!entry) return;
  const { plugin, category, find } = market.nav;
  const categories = categoriesOf(entry);
  market.nav = {
    ...market.nav, source: entry.source, marketName: undefined,
    plugin: plugin && entry.plugins.some(candidate => candidate.name === plugin) ? plugin : undefined,
    category: category && categories.length > 1 && categories.includes(category) ? category : undefined,
    find: entry.plugins.length > FIND_FROM ? find : '',
  };
}

/** Moves within the page and reads what the new place shows. */
export function browse(patch: Partial<typeof market.nav>): void {
  if ('source' in patch || 'tab' in patch || 'plugin' in patch) noteMove();
  const base = 'source' in patch && patch.source !== current()?.entry.source ? startNav() : market.nav;
  const resetTool = 'plugin' in patch && patch.plugin !== market.nav.plugin && !('hookTool' in patch);
  market.nav = { ...base, ...patch, ...(resetTool ? { hookTool: undefined } : {}) };
  if (app.page !== 'plugins') { showPage('plugins'); return; }
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
    if (fresh) { market.readmes.clear(); forgetDetails(); }
    else for (const entry of market.view?.marketplaces ?? []) if (entry.kind === 'folder') market.readmes.delete(entry.source);
    settleView();
    // Only a Refresh the person clicked: the app's own reads after a change (the home read again, a background pass that
    // saw the files it wrote) leave the result's sentence standing.
    if (fresh) markReread();
  }
  rerender();
}

/** The person had the tools read again (Refresh): each place's last run is only named from now on (its Undo stays), never restated over a page that may differ. */
const markReread = () => { for (const [place, run] of runs) runs.set(place, { ...run, reread: true, profileLine: undefined }); };

/** Runs an action with the page saying what it is doing; a returned string is a lastRun's announcement, with any ended-profile line attached. */
function act(activity: MarketActivity, work: () => Promise<string | void>) {
  const started = placeNow();
  endListNews(started);
  return busy(ACTIVITIES[activity].label, async () => {
    market.activity = activity;
    try {
      const said = await work();
      if (said === undefined) return;
      const last = runs.get(started);
      const profileLine = last?.done.some(step => succeeded(step.report)) ? profileEndedLine() : undefined;
      if (last && profileLine) last.profileLine = profileLine;
      announce([said, profileLine].filter(Boolean).join(' '), showsPluginsResult(started) && !problems.get(started) && (undoOps(started).length > 0 || !!profileLine));
    } finally { market.activity = undefined; }
  });
}

export const addMarketplace = (source: string) => act('adding', async () => {
  const result = await api().addMarketplace(source);
  setProblem(result.problem, 'plugins');
  if (result.problem) { showView(result.view); announce(result.problem); return; }
  const added = result.view?.marketplaces.find(entry => entry.source === result.source);
  market.draftSource = '';
  market.addOpen = false;
  if (added && app.page === 'plugins') noteMove();
  market.nav = { ...startNav(), source: added?.source };
  showView(result.view);
  // The outcome first, the name last, so a narrow status bar that shortens the message cuts the name, not the news. What is
  // installed is counted as its row counts it: one a tool has already, the add didn't install.
  const what = result.already ? 'Marketplace already on this page' : 'Marketplace added', some = added && result.view ? installedFrom(result.view, added) : 0;
  const text = added ? `${what}: ${plural(added.plugins.length, 'plugin')}, ${some ? `${some} installed` : 'nothing installed'} (${marketTitle(added)}).` : `${what}. Nothing was installed.`;
  tell({ page: 'plugins', item: added?.name || undefined, text });
  // Once added, focus leaves the add box (now gone), so the next key press doesn't land in an input that isn't there.
}).then(() => { if (!problems.get('plugins')) (document.activeElement as HTMLElement | null)?.blur(); });

/** Forgets what was read for one marketplace (its README, its plugins' contents), so it is read again when shown. */
function dropReads(source: string): void {
  market.readmes.delete(source);
  for (const key of [...market.details.keys()]) if (forSource(key, source)) market.details.delete(key);
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

/**
 * Stops offering a suggested marketplace: it leaves the page and is not offered again, unless its Undo is pressed. Both run
 * as the page's other marketplace actions do, so the page is drawn again and a failure is said.
 */
export const declineMarketplace = (source: string, name: string) => act('removing', async () => {
  showView(await api().declineMarketplace(source));
  tell({ page: 'plugins', item: name, text: `${name} won’t be suggested again.`, act: { label: 'Undo', id: 'outcome-suggest-again', run: () => void act('adding', async () => {
    showView(await api().declineMarketplace(source, true));
    tell({ page: 'plugins', item: name, text: `${name} is suggested again.` });
  }) } });
});

/** Looks now at a bundled build's feed for newer plugins (its About tab's "Check now"), then reads the marketplace again and says what that came to. */
export const checkCarriedFeed = (entry: MarketplaceView) => act('checking', async () => {
  await api().checkCarriedFeed();
  await loadPlugins();
  const now = market.view?.marketplaces.find(candidate => candidate.source === entry.source)?.bundled?.feed;
  // Short enough for the status bar to say whole; About has the rest.
  const name = marketTitle(entry);
  tell({ page: 'plugins', item: name, warn: now?.outcome === 'failed' || now?.outcome === 'held',
    text: now?.outcome === 'updated' ? `${name} ${now.message!.charAt(0).toLowerCase()}${now.message!.slice(1)}` : now?.outcome === 'failed' ? `Newer ${name} couldn’t be used. The ones here stay in use.`
      : now?.outcome === 'held' ? `Newer ${name} wait for a newer app.` : `No newer ${name} are published.` });
});

/** Adds the marketplace this build carries to one tool's own plugin list (its About tab's "List in …"). */
export const addCarriedTo = (entry: MarketplaceView, tool: HarnessId) => act('listing', async () => {
  const result = await api().addCarriedTo(tool, market.view?.home ?? '');
  showView(result.view);
  const name = marketTitle(entry), added = result.report?.outcome === 'added' || result.report?.outcome === 'there';
  tell({ page: 'plugins', item: name, warn: !added,
    text: added ? `Nothing was installed: ${name} is now listed in ${toolNames[tool]}.` : `${name} was not listed in ${toolNames[tool]}. ${result.stopped ?? result.report?.message ?? ''}`.trim() });
});

export const pickMarketplaceFolder = () => api().pickMarketplaceFolder();

/** Opens an https link in the browser. */
export const openLink = (url: string) => void api().openExternal(url);

/**
 * One click's plugin steps (Update, Update all, a skill's switch), or the Undo of one, run at once
 * through each tool's own command. The run replaces market.lastRun. A run that stops leaves the rest unrun; the page, read
 * again, still offers their buttons.
 */
export const applyPluginOps = (ops: PluginOp[], undo = false, from?: RunPlace) => act(undo ? 'undoing' : 'applying', async () => {
  const home = app.home!.home, place = from ?? placeNow();
  for (const plugin of new Set(ops.map(op => op.plugin))) retire(plugin);
  setProblem(undefined, place);
  const planApi = { install: api().installPlugin, update: api().updatePlugin, uninstall: api().uninstallPlugin, setSkill: api().setPluginSkill, items: api().pluginItems };
  let result: Awaited<ReturnType<typeof runPlan>> = { done: [] };
  try {
    result = await runPlan(ops, planApi, home, step => { market.working = { source: step.source, plugin: step.plugin, tools: step.tools }; rerender(); });
  } finally {
    market.working = undefined;
    // A run that stopped after some steps names the plugins it didn't reach; the header says what did run, and counts them first.
    const unreached = result.stopped ? unreachedOps(ops, result.done) : [];
    setRun({ done: result.done, undo, home, place, unreached, ...(undo ? { rest: notUndone(ops, result.done) } : {}) }, place);
    const unrun = [...new Set(unreached.map(op => op.plugin))];
    setProblem(result.stopped && result.done.length && unrun.length ? `Stopped before ${andList(unrun)}: ${result.stopped}` : result.stopped, place);
    await readAgain();
  }
  return problems.get(place) ?? (resultSentence(resultLines(result.done, undo), undo) || 'Nothing changed.');
});

/**
 * Use the plugin's under a name of his under a tool's box (pluginpage.ts yourLines): main takes the plugin's over his there
 * (marketplaces.ts take; library.ts TAKE). Its one Undo is a turn's (undoTurn), which main runs as that take's own Undo in
 * History (pluginlibrary.ts itemsBack), so his comes back his own, never Off and still linked.
 */
export const usePlugins = (entry: MarketplaceView, plugin: string, tool: HarnessId, item: Pick<YourName, 'kind' | 'key'>) => act('applying', async () => {
  const home = app.home!.home, place = placeNow();
  const result = await api().takePluginItem(entry.source, plugin, { kind: item.kind, key: item.key }, tool, home)
    .catch((): PluginTurnResult => ({ stopped: 'That could not finish. Click Refresh to see where things stand.', done: [] }));
  setRun({ done: result.done, undo: false, home, place, ...(result.back ? { turn: { source: entry.source, plugin, before: result.before ?? null, back: result.back } } : {}) }, place);
  setProblem(result.stopped, place);
  await readAgain();
  return problems.get(place) ?? (resultSentence(resultLines(result.done, false), false) || `Nothing changed for ${plugin}.`);
});

/** What each tool now has changed: the page and the item lists read again, once for the action (app.ts readHomeOnce). */
async function readAgain(): Promise<void> {
  showView(await api().plugins().catch(() => null));
  // The item lists show what plugins bring, each with its switch in each tool, and a plugin's items in Pi, OpenCode and Antigravity: every
  // plugin change is seen there (and where it came from) at once.
  await readHomeOnce();
  readShown();
}

/**
 * A plugin's click in the page's list (a clicklist.ts Turn): the plugin, what was clicked (in one tool, for a tool's box), what its
 * row says while it waits and while it runs (`said`: aimWords), and once main has answered, what it returned (`ran`; the view is
 * then read back before the click ends).
 */
export interface PluginClick extends Turn { place: RunPlace; source: string; plugin: string; what: PluginTurn; tool?: HarnessId; said: { waiting: string; running: string }; ran?: PluginTurnResult }
const isPluginClick = (turn: Turn): turn is PluginClick => 'plugin' in turn;

/** The latest click on this plugin in the page's list, if one is there. */
export const clickOn = (source: string, plugin: string) => market.clicks.findLast(click => click.source === source && click.plugin === plugin);
/** A plugin's switch and boxes are off: under busy, and from a click on it until the view is read back after it. */
export const pluginBusy = (source: string, plugin: string) => !!app.busy || (clickOn(source, plugin)?.state ?? 'ended') !== 'ended';

/**
 * The latest list's rows are its news, true until the plugins change or are read again: they go at a new run, at any other
 * plugin action (act), at an item list's switch for a plugin's item (app.ts runSwitches), at the person's Refresh (app.ts
 * readAgain) and with another home (resetMarket). A running list keeps them.
 */
export function endListNews(place?: RunPlace): void {
  if (!clickList.running) drop(turn => isPluginClick(turn) && (!place || turn.place === place));
}

/**
 * A plugin's one switch (pluginrecord.ts), clicked: On or Off, Add for one found in a tool, or one tool's box on its page
 * unticked or ticked (`tool`). The click joins the page's list and waits its turn there, in the run on its place (clicklist.ts
 * runAt); a new run clears what the last one's stop and notice said.
 */
export function turnPlugin(entry: MarketplaceView, plugin: string, what: PluginTurn, tool?: HarnessId): void {
  const place = placeNow();
  const run = runAt(place === 'plugins' ? 'plugins' : `plugins:${place}`), home = app.home!.home;
  if (!clickList.turns.some(turn => turn.run === run)) { setProblem(undefined, place); clearNotice(); }
  const click: PluginClick = { state: 'waiting', run, place, work: () => runClick(click, home), ended: runEnded, source: entry.source, plugin, what, tool, said: aimWords(what, tool) };
  // Its row is pinned where it is on the list (itemrow.ts Pinned), until another list or none is drawn, or Refresh (app.ts pinnedRows).
  if (market.view) pin(pinnedPlugins(entry), plugin, pluginPlace(market.view, entry, plugin));
  // The control clicked waits until it is read back; Add gives way to the switch then. The focus goes back to it at the
  // list's end if nothing else took it; after Uninstall…, whose control goes with the copy, to the result's Undo (pluginspage.ts undoButton).
  clickedLast = what === 'uninstall' ? 'plugins-undo' : document.activeElement?.id.replace(/^padd/, 'pswitch');
  join(click);
  rerender();
}
let clickedLast: string | undefined;

/** What a row says of its click while it waits and while it runs: a tool's box names its tool ("Waiting to install in Codex"). */
function aimWords(what: PluginTurn, tool?: HarnessId): PluginClick['said'] {
  const name = tool ? ` ${toolNames[tool]}` : '';
  const [to, doing] = { on: ['turn on', 'Turning on'], off: ['turn off', 'Turning off'], add: ['add', 'Adding'], 'keep-out': ['turn off in', 'Turning off in'], 'let-in': ['turn on in', 'Turning on in'],
    uninstall: ['uninstall from', 'Uninstalling from'] }[what];
  return { waiting: `Waiting to ${to}${name}`, running: `${doing}${name}…` };
}

/**
 * The run's end (clicklist.ts): after the home read, a run of plugin clicks has its ended-profile line worked out and its
 * result said once (whether one click or several), and focus returns to the control clicked last.
 */
function runEnded(): void {
  const list = market.clicks, lastRan = list.findLast(click => click.ran);
  const ran = lastRan ? list.filter(click => click.ran && click.run === lastRan.run) : [];
  if (!ran.length) return;
  const place = lastRan!.place, last = runs.get(place);
  // A plugin that partly failed is said once, where it went and where not ("beta: installed in Claude Code, not in Codex");
  // one that went nowhere is named as failed.
  const lines = lastLines(place), went = new Set(lines.filter(line => line.ok).map(line => line.plugin));
  const notIn = (plugin: string) => [...new Set(ran.filter(click => click.plugin === plugin).flatMap(click => click.ran?.done ?? []).filter(step => !succeeded(step.report)).map(step => toolNames[step.tool]))];
  const withNotIn = (list: ResultLine[]) => list.map(line => (line.ok && notIn(line.plugin).length ? { ...line, text: `${line.text}, not in ${andList(notIn(line.plugin))}` } : line));
  const failed = [...new Set(lines.filter(line => !line.ok && !went.has(line.plugin)).map(line => line.plugin))];
  const did = ran.some(click => click.ran?.done.some(step => succeeded(step.report)));
  const profileLine = last && did ? profileEndedLine(lastRan!.run.before) : undefined;
  if (last) last.profileLine = profileLine;
  const one = ran.length === 1 ? ran[0]!.ran : undefined;
  const oneLines = one ? resultLines(one.done, false) : [];
  const oneFailed = oneLines.filter(line => !line.ok).map(line => `${line.plugin}: ${line.text}`).join(' ');
  const multi = [resultSentence(withNotIn(lines), false), failed.length ? `${andList(failed)} failed.` : ''].filter(Boolean).join(' ') || 'Nothing changed.';
  const base = one ? (one.stopped ?? (resultSentence(withNotIn(oneLines), false) || oneFailed || `Nothing changed for ${ran[0]!.plugin}.`)) : multi;
  const here = showsPluginsResult(place);
  announce([base, profileLine].filter(Boolean).join(' '), here && (one ? !!one.stopped || !!oneFailed || undoOps(place).length > 0 || !!profileLine : !lines.some(line => !line.ok) && (undoOps(place).length > 0 || !!profileLine)));
  if (here && document.activeElement === document.body && clickedLast) {
    // Undo was drawn off while the list ran, and the list's last draw comes after this: drawn usable first, so it takes the focus.
    if (clickedLast === 'plugins-undo') rerender();
    document.getElementById(clickedLast)?.focus({ preventScroll: true });
  }
}

/**
 * One click, in its turn, through main (marketplaces.ts turn: recorded first, then what its table owes): its row says it runs,
 * then what main returned; then the view is read back, so its switch and marks are true and it is free again, and the home owes
 * a read at the run's end. The last click to end holds the one Undo. A click another home
 * dropped (resetMarket) is passed over.
 */
async function runClick(click: PluginClick, home: string): Promise<void> {
  if (!clickList.turns.includes(click)) return;
  const before = profilesBefore();
  click.run.before ??= before;
  retire(click.plugin);
  const view = market.view;
  market.working = { source: click.source, plugin: click.plugin, tools: click.tool ? [click.tool] : view?.tools ?? [] };
  rerender();
  const result = await api().turnPlugin(click.source, click.plugin, click.what, click.tool, home).catch((): PluginTurnResult => ({ stopped: 'That could not finish. Click Refresh to see where things stand.', done: [] }));
  if (!clickList.turns.includes(click)) return;
  // If × ended the run while this click was running, the new run it moved to still compares with before this click ran.
  click.run.before ??= before;
  oweHomeRead();
  click.ran = result;
  market.working = undefined;
  setRun({ done: result.done, undo: false, home, place: click.place, ...(result.back ? { turn: { source: click.source, plugin: click.plugin, before: result.before ?? null, back: result.back } } : {}) }, click.place);
  if (clickList.turns.some(turn => turn.run === click.run && turn.state === 'waiting'))
    announce(result.stopped ?? (resultSentence(resultLines(result.done, false), false) || `Nothing changed for ${click.plugin}.`), showsPluginsResult(click.place) && !result.stopped && undoOps(click.place).length > 0);
  rerender();
  showView(await api().plugins().catch(() => null));
}

const ranFor = (last: LastRun) => market.clicks.filter(click => click.ran && click.place === (last.place ?? 'plugins'));

/**
 * What the toolbar and the problems band say of the last run: while the latest list's rows are there, every click of it together
 * (a click main stopped is its plugin's line); else the last run's own. The one Undo stays the last run's (undoOps).
 */
export function lastLines(place: RunPlace = placeNow()): ResultLine[] {
  const last = runs.get(place), ran = last ? ranFor(last) : [];
  if (!last || !ran.length) return last ? resultLines(last.done, last.undo) : [];
  // One clause a tool: a later click on the plugin in that tool is what the run says of it (a tick then an untick: turned off).
  const there = (step: PluginDone) => (each: PluginDone) => each.source === step.source && each.plugin === step.plugin && each.tool === step.tool;
  const later = (at: number, step: PluginDone) => ran.slice(at + 1).some(click => click.ran!.done.some(there(step)));
  return ran.flatMap(({ source, plugin, ran: { done, stopped } = { done: [] } }, at) => [...resultLines(done.filter(step => !later(at, step))), ...(stopped ? [{ source, plugin, ok: false, text: stopped, short: stopped }] : [])]);
}

/** Reload advice for the Plugins page's current run, settled chronologically so a later removal cancels an earlier write. */
export const runReloads = (place: RunPlace = placeNow()): ReloadAdvice => {
  const last = runs.get(place), ran = last ? ranFor(last) : [];
  return reloadAdvice(settleReloads(pluginReloads(last && ran.length ? ran.flatMap(click => click.ran!.done) : last?.done ?? [])), toolWays());
};

/** The Undo of a plugin's switch (or "Undo the rest" after it): its entry put back, then its steps run, in main. */
const undoTurn = (last: LastRun & { turn: NonNullable<LastRun['turn']> }) => act('undoing', async () => {
  const home = app.home!.home, place = last.place ?? 'plugins', back = last.undo ? last.rest ?? [] : last.turn.back;
  setProblem(undefined, place);
  market.working = { source: last.turn.source, plugin: last.turn.plugin, tools: [...new Set(back.map(op => op.tool))] };
  rerender();
  let done: PluginDone[] = [];
  try {
    const result = await api().undoPluginTurn(last.turn.source, last.turn.plugin, last.turn.before, back, home);
    done = result.done;
    setRun({ done, undo: true, home, place, rest: notUndone(back, done), turn: last.turn }, place);
    setProblem(result.stopped, place);
  } finally {
    market.working = undefined;
    await readAgain();
  }
  // The focus goes to the plugin it undid, on the list, on its page, or on a tool's Plugins tab, as Undo itself may go: its switch, or its Add again.
  const entry = market.view?.marketplaces.find(each => each.source === last.turn.source);
  const at = entry ? market.view!.marketplaces.indexOf(entry) : -1;
  const id = place !== 'plugins' && entry ? `harness-plugin-switch-${entry.name}-${last.turn.plugin}` : `pswitch-${market.nav.plugin ? 'page-' : ''}${at}-${last.turn.plugin}`;
  if (showsPluginsResult(place)) focusWhenDone(document.getElementById(id) ? id : id.replace(/^pswitch/, 'padd'));
  return problems.get(place) ?? (resultSentence(resultLines(done, true), true) || 'Nothing changed.');
});

/**
 * Undo's label: "Undo the rest" after an Undo that didn't finish; with the click it reverses ("Undo gamma", "Undo gamma in Codex"
 * for a box) when the sentence beside it (lastLines) names more than that one click, since it reverses only the last; else "Undo".
 */
export function undoLabel(place: RunPlace = placeNow()): string {
  const last = runs.get(place), ran = last ? ranFor(last) : [], click = ran.at(-1);
  if (last?.undo) return 'Undo the rest';
  return last?.turn && click && ran.length > 1 ? `Undo ${click.plugin}${click.tool ? ` in ${toolNames[click.tool]}` : ''}` : 'Undo';
}

/** Undo, or "Undo the rest": the last run's way back, by the route that made it (turnPlugin or applyPluginOps). */
export function undoLast(): void {
  const last = market.lastRun;
  if (last?.turn) void undoTurn({ ...last, turn: last.turn });
  else void applyPluginOps(undoOps(), true, last?.place);
}

/** × on the run's result in the header: it goes, and its problem lines with it, and the run of clicks ends (clicklist.ts endRun). */
export function closeRun(): void { endRun(); clearRun(); }
/**
 * Whether the app's result `outcome` is said in the header in the run's place (pluginspage.ts pluginsResult): one made on Plugins
 * or a tool's Plugins tab, not in the status bar, either with no action of the page's own (Sync once) or a library-item click result (`rows`).
 */
export const overRun = (outcome: Outcome | undefined): boolean =>
  !!outcome && !!pluginsResultPlace() && outcome.page === app.page && (!outcome.act || !!outcome.rows?.length) && !saidInStatusBar(outcome);
const clearRun = (place: RunPlace = placeNow()) => { runs.delete(place); problems.delete(place); };
/** The run's result with no problem line goes by itself, as a list page's result does (app.ts FADE_MS); its Undo with it. Answers whether it went. */
export function fadeRun(): boolean {
  const here = pluginsResultPlace();
  const goes = !!here && !!runs.get(here) && !problems.get(here) && lastLines(here).every(line => line.ok);
  if (goes) clearRun(here);
  return goes;
}

/** The way back from the last run, while it is for the home on screen: its reversal (a switch's, as main gave it), or what an Undo didn't get to. */
export function undoOps(place: RunPlace = placeNow()): PluginOp[] {
  const last = runs.get(place);
  if (!last || last.home !== app.home?.home) return [];
  return last.undo ? last.rest ?? [] : last.turn?.back ?? reverse(last.done);
}

// ---------- A plugin's turn from a tool's line in the Library (pluginline.ts) ----------

/**
 * The listing of a plugin on this page's view: the marketplace listing it whose source is `source` as a tool spells it, else one
 * of `marketName` (a tool may spell a source otherwise than the page lists it). The plugin's page opens there (matrix.ts
 * openPlugin), and a Library line's turn names its source as listed, the spelling main's Undo compares (marketplaces.ts undoTurn).
 */
export function listingOf(plugin: string, marketName: string | undefined, source?: string): MarketplaceView | undefined {
  const lists = (entry: MarketplaceView) => entry.plugins.some(item => item.name === plugin);
  return market.view?.marketplaces.find(entry => entry.source === source && lists(entry)) ?? market.view?.marketplaces.find(entry => !!marketName && entry.name === marketName && lists(entry));
}

/**
 * One tool's box for a plugin on its page (pluginstatus.ts boxOf, as pluginparts.ts toolBox asks it), for that tool's line in the
 * Library (pluginline.ts LineFacts box) and for a tool's Plugins tab under Harnesses (harnesspage.ts pluginRow): with the tool's
 * mark and words, the listing's source and what it lists in the plugin. No box while this page's view is read (wantView);
 * `unlisted` where no listing has it.
 */
export function lineBox(plugin: string, marketName: string, source: string | undefined, tool: HarnessId) {
  const view = market.view, entry = listingOf(plugin, marketName, source);
  if (!view || !view.tools.includes(tool)) return { box: undefined };
  if (!entry) return { box: 'unlisted' as const };
  // Found by its name alone, where another listing of that name has the plugin too: which one it comes from can't be told.
  const named = view.marketplaces.filter(each => each.name === marketName && each.plugins.some(item => item.name === plugin));
  if (entry.source !== source && named.length > 1) return { box: 'ambiguous' as const };
  const marked = toolMark(view, entry, plugin, tool, entry.switches?.[plugin]?.tools[tool]);
  return { box: boxOf(view, entry, plugin, tool, marked), mark: marked.mark, words: marked.words, source: entry.source, parts: entry.plugins.find(item => item.name === plugin)?.components };
}

/** The read of the home this page's view was last asked for by the Library (wantView); another home starts over (resetMarket). */
let viewFor: number | undefined;
/** While a plugin's item is open in the Library, its lines need this page's view, as Harnesses does: read once for each read of the home. */
export function wantView(readId: number | undefined): void {
  if (viewFor === readId || app.page === 'plugins') return;
  viewFor = readId;
  // Asked while the page is drawn: the read starts after the drawing.
  queueMicrotask(() => void loadPlugins(false, readId));
}

/**
 * A line's click: the home it is made in, the plugin as listed (`source`, the listing's own spelling), the tool, and the item whose line
 * it is (`item`), with the names his own there it said stay his (`yours`). Install, Put its items here and Turn the plugin on are
 * its box ticked (`let-in`); Turn the plugin off is its box unticked (`keep-out`).
 */
export interface LineAim { home: string; source: string; marketName: string; plugin: string; tool: HarnessId; act: 'install' | 'place' | 'keep-out' | 'let-in'; item: PartRef; yours?: PartRef[] }
/** A line's click in the page's list (clicklist.ts), a run of its own: its line says it waits and runs (lineBusy). */
interface LineClick extends Turn { aim: LineAim }
const isLineClick = (turn: Turn): turn is LineClick => 'aim' in turn;
const LINE_WORDS: Record<LineAim['act'], { waiting: string; running: string; done: string; not: string }> = {
  install: { waiting: 'Waiting to install', running: 'Installing', done: 'Installed', not: 'Not installed in' },
  place: { waiting: 'Waiting to put its items', running: 'Putting its items', done: 'Put', not: 'Not put in' },
  'keep-out': { waiting: 'Waiting to turn off', running: 'Turning off', done: 'Turned off', not: 'Not turned off in' },
  'let-in': { waiting: 'Waiting to turn on', running: 'Turning on', done: 'Turned on', not: 'Not turned on in' },
};

/**
 * A line's result: what its act did, with the one next step the tool needs (reload.ts reloadAdvice, as the header's chips say it),
 * and its Undo. ONE LIFETIME: one per plugin, for the home its act ran in, on its item's line in its tool whatever row shows that
 * item, until he closes it, an act on that plugin starts from either page (retire), he presses Refresh (forgetResults) or the
 * home changes (resetMarket). Said in the header only when that line isn't on screen as the act ends (`told`); its line shows it
 * once the header no longer does, never both at once.
 */
export interface LineResult { aim: LineAim; words: string; next: string; failed: boolean; profileLine?: string; undo?: () => void; told?: Outcome }
let results: LineResult[] = [];
/** The result a tool's line on an item shows now, if any (matrix.ts pluginLine, detailToolLine). */
export const resultOn = (tool: HarnessId, item: PartRef) => results.find(each => each.aim.tool === tool && samePart(each.aim.item, item) && !(each.told && app.outcome === each.told));
/** × on a line's result, or the header's copy of it. */
export function closeLineResult(result: LineResult): void {
  results = results.filter(each => each !== result);
  if (app.outcome === result.told) app.outcome = undefined;
  rerender();
}
/** He pressed Refresh (app.ts readAgain): every line's result goes. */
export const forgetResults = () => { results = []; };
/**
 * An act on a plugin starts, from either page (a line's, a box's or a switch's, the item lists' plugin switches: app.ts runSwitches):
 * that plugin's earlier results and their Undo go, on its line, in the header (an Outcome naming it in `plugins`), and the Plugins
 * page's last run where it was that plugin's. Only that plugin's.
 */
export function retire(plugin: string): void {
  results = results.filter(each => each.aim.plugin !== plugin);
  if (app.outcome?.plugins?.includes(plugin)) app.outcome = undefined;
  for (const [place, run] of runs) {
    if (run.turn?.plugin === plugin || run.done.some(step => step.plugin === plugin)) runs.delete(place);
  }
}

/** What a tool's line says while a click on its plugin in its tool waits or runs, on every row of the plugin's items. */
export function lineBusy(plugin: string, marketName: string, tool: HarnessId): string | undefined {
  const click = clickList.turns.filter(isLineClick).findLast(turn => turn.state !== 'ended' && turn.aim.plugin === plugin && turn.aim.marketName === marketName && turn.aim.tool === tool);
  if (!click) return undefined;
  const { aim } = click, words = LINE_WORDS[aim.act];
  if (click.state === 'waiting') return `${words.waiting} ${aim.act === 'place' ? 'in' : `${aim.plugin} in`} ${toolNames[aim.tool]}…`;
  return `${words.running} ${aim.act === 'place' ? `of ${aim.plugin} in` : `${aim.plugin} in`} ${toolNames[aim.tool]}…${aim.act === 'install' ? ' This can take a few minutes.' : ''}`;
}

/**
 * A line's click (pluginline.ts: Install the plugin, Put its items here, Turn the plugin on or off): it joins the page's list as a run of its
 * own, run in its turn by main as the plugin's box on its page is (marketplaces.ts turn).
 */
export function turnFromLine(aim: LineAim): void {
  const click: LineClick = { state: 'waiting', run: { place: 'line', lastAt: 0 }, aim, work: () => runLine(click) };
  join(click);
  rerender();
}

/**
 * One line's click in its turn: that plugin's earlier results retired, main's turn, the home and this page's view read again, then
 * its result (sayResult) with its one Undo (undoPluginTurn), as the Plugins page says them.
 */
async function runLine(click: LineClick): Promise<void> {
  const { aim } = click, atStart = profilesBefore();
  retire(aim.plugin);
  rerender();
  const result = await api().turnPlugin(aim.source, aim.plugin, aim.act === 'keep-out' ? 'keep-out' : 'let-in', aim.tool, aim.home)
    .catch((): PluginTurnResult => ({ stopped: 'That could not finish. Click Refresh to see where things stand.', done: [] }));
  if (!clickList.turns.includes(click)) return;
  const mine = result.done.filter(step => step.tool === aim.tool), problem = result.stopped ?? mine.find(step => !succeeded(step.report))?.report.message;
  // The home and this page's view read again. A read that fails is said beside the result, so the line never stays "running".
  let read = true;
  try {
    const [home, view] = await Promise.all([api().refresh(), api().plugins()]);
    setHome(home);
    showView(view);
  } catch { read = false; }
  const where = toolNames[aim.tool], words = LINE_WORDS[aim.act], ran = mine.length > 0 || !!result.stopped;
  const already = !ran || (!problem && aim.act === 'keep-out' && !mine.some(step => step.report.changed));
  // The record as the plugin's page reads it now: a click that ran nothing (the tool was already as it asked, since the line was
  // drawn) may still have changed which tools the plugin is kept out of.
  const now = market.view?.marketplaces.find(each => each.source === aim.source)?.switches?.[aim.plugin]?.entry;
  const recordChanged = !!now && (!result.before || now.on !== result.before.on || now.except.join() !== result.before.except.join());
  // The tool's own words, without the "Not installed." its report leads with (plugins.ts install).
  const theirs = problem?.replace(/^Not (installed|put in|turned on|turned off)\.\s*/, '').replace(/\.$/, '');
  // A placement says what it put there and what it left, as its own report counts and names them (pluginlibrary.ts reportIn).
  const said = already
    ? (aim.act === 'keep-out'
      ? `Nothing was run in ${where}: ${aim.plugin} is already off there.${recordChanged ? ` Central Knot now keeps it out of ${where}.` : ''}`
      : `Nothing was run in ${where}: it has ${aim.plugin} already.${recordChanged ? ` Central Knot now keeps it in ${where}.` : ''}`)
    : problem ? `${words.not} ${where}: ${theirs}. ${lineBox(aim.plugin, aim.marketName, aim.source, aim.tool).words ?? ''}`.trim()
    : aim.act === 'place' ? `Put ${aim.plugin}’s items in ${where}: ${mine[0]!.report.message}`
    : `${words.done} ${aim.plugin} in ${where}${aim.act === 'install' ? installedNow(aim) : ''}.${aim.yours?.length ? ` ${yoursStay(aim.yours)}` : ''}`;
  const back = result.back ?? [], undoes = back.length > 0 || (already && recordChanged);
  const did = mine.some(step => succeeded(step.report)) || (already && recordChanged);
  sayResult({ aim, words: [said, read ? '' : 'The page couldn’t be read again after it: Refresh shows where things stand.'].filter(Boolean).join(' '),
    next: reloadAdvice(settleReloads(pluginReloads(mine)), toolWays()).text, failed: !!problem, ...(undoes ? { undo: () => void undoLine(aim, result.before ?? null, back) } : {}) }, pluginReloads(mine), { checkProfile: did, before: atStart });
}

/**
 * A line's result kept (one per plugin), and said: on its line if that line is on screen now, else in the header, which has its
 * Undo and next step there (as chips, withReloads: one next step either way) and names its plugin for retire.
 */
function sayResult(result: LineResult, changes: ReloadChange[], check: { checkProfile?: boolean; before?: ProfilesBefore } = {}): void {
  const profileLine = check.checkProfile === false ? undefined : profileEndedLine(check.before);
  if (profileLine) result.profileLine = profileLine;
  results = [...results.filter(each => each.aim.plugin !== result.aim.plugin), result];
  rerender();
  const shown = [result.words, result.next].filter(Boolean).join(' ');
  if (document.querySelector(`[data-result="${CSS.escape(resultKey(result.aim))}"]`)) {
    announce([shown, profileLine].filter(Boolean).join(' '), false, undefined, undefined, profileLine ? shown : undefined);
    return;
  }
  result.told = withReloads({ page: 'library', text: result.words, band: true, warn: result.failed, plugins: [result.aim.plugin],
    ...(result.undo ? { act: { label: 'Undo', id: 'outcome-undo', title: 'Put back what this did', run: result.undo } } : {}) }, changes);
  tell(result.told, '', check);
  result.told = app.outcome;
}
/** The one key of the line a result is on: its tool and item (matrix.ts draws it as the result's data-result). */
export const resultKey = (aim: Pick<LineAim, 'tool' | 'item'>) => `${aim.tool}:${aim.item.kind}:${aim.item.name.toLowerCase()}`;

/** What the tool has of the plugin installed now, as read again after the click: ", with its 3 skills and 1 MCP server", or ''. */
function installedNow(aim: LineAim): string {
  const install = app.home?.pluginItems?.find(each => each.tool === aim.tool && each.plugin === aim.plugin && each.marketName === aim.marketName);
  return install?.items.length ? `, with its ${counted(install.items)}` : '';
}
/**
 * A line's Undo: the Plugins page's own (marketplaces.ts undoTurn), its record put back, then its steps, in the home its act ran in;
 * the home and this page's view read again; said as its act's result was (it retires that result: an act on its plugin).
 */
const undoLine = (aim: LineAim, before: PluginEntry | null, back: PluginOp[]) => busy('Undoing…', async () => {
  retire(aim.plugin);
  const result = await api().undoPluginTurn(aim.source, aim.plugin, before, back, aim.home);
  setHome(await api().refresh());
  showView(await api().plugins().catch(() => null));
  const worked = !result.stopped && result.done.every(step => succeeded(step.report)), where = toolNames[aim.tool];
  // An Undo with no step to run put only the record back (a click that ran nothing).
  const words = result.stopped ?? (back.length ? resultSentence(resultLines(result.done, true), true) || 'Nothing changed.'
    : `Undone: Central Knot keeps ${aim.plugin} ${aim.act === 'keep-out' ? 'in' : 'out of'} ${where} again.`);
  const failures = resultLines(result.done, true).filter(line => !line.ok).map(line => line.text);
  const did = result.done.some(step => succeeded(step.report)) || (!result.stopped && !back.length);
  sayResult({ aim, words: [words, ...failures].join(' '), next: reloadAdvice(settleReloads(pluginReloads(result.done)), toolWays()).text, failed: !worked }, pluginReloads(result.done), { checkProfile: did });
});
