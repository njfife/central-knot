// Plugins: the page's state and actions. Marketplaces, what the last run did, and where the person is browsing all live
// here, apart from the other features; app.ts only routes to it and resets it when the home changes.
// Clicks go by one of two routes, split by whether the plugin's record changes: the switch and each tool's box go through
// turnPlugin (main records first, marketplaces.ts turn); Update, Update all, a skill's switch and their Undo go through
// applyPluginOps. Both set market.lastRun, which the toolbar says with one Undo.
// Which clicks wait their turn and which lock, in one place:
// - A switch or a tool's box joins the page's list (market.clicks), and one runner sends the list to main one click at a
//   time, in the order clicked (runClicks); each row says its own click's state (pluginparts.ts clickNote). That plugin's
//   switch and boxes stay off from its click until the view is read back after it (pluginBusy); every other plugin's switch,
//   and the rest of the app, stay usable meanwhile. The home is read once, when the list empties.
// - Every other action here runs under app.ts busy, and is off while the page acts (app.ts acting: busy, or the list running,
//   which also says why), so a click on one lands on a disabled control and is dropped, never run twice. A switch is off under
//   busy too.
// Steps that run by themselves (pluginupdates.ts) take their turn with the page's in main's one queue.
import { afterActing, announce, busy, focusWhenDone, heldRows, readHomeOnce, rerender, showActing, state as app, tell } from './app.ts';
import { hold, placeIn } from './itemrow.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';
import { plural } from './model.ts';
import { notUndone, resultLines, forSource, pluginKey, resultSentence, reverse, runPlan, succeeded, type LastRun, type PluginDone, type PluginOp, type ResultLine } from './pluginplan.ts';
import { FIND_FROM, categoriesOf, copiesToCompare, marketTitle, matches, pluginPlace, undoLimits } from './pluginstatus.ts';
import { readInTurn, readInto, type Read } from './reads.ts';
import type { HarnessId, MarketplaceView, PluginDetail, PluginTurn, PluginTurnResult, PluginsView } from './types.ts';
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

/** `marketName`: the marketplace to open when `source` is spelled as a tool recorded it, not as the page lists it (a plugin item's link). */
const startNav = (): { source?: string; tab: MarketTab; plugin?: string; find: string; category?: string; marketName?: string } => ({ source: undefined, tab: 'plugins', plugin: undefined, find: '', category: undefined });

export const market = {
  /** Marketplaces and what each tool has installed: read when the page opens or the home changes (pagedata.ts). */
  read: pageData<PluginsView>(),
  get view(): PluginsView | undefined { return this.read.data; },
  /** Why a marketplace could not be added, or why a run stopped. */
  problem: undefined as string | undefined,
  activity: undefined as MarketActivity | undefined,
  /** The last run (a click or its Undo), so the toolbar can say what happened and offer the way back, in that home only. */
  lastRun: undefined as LastRun | undefined,
  /** The plugin and tools a command is running for, so their marks show it is working. */
  working: undefined as { source: string; plugin: string; tools: HarnessId[] } | undefined,
  /** The switch clicks of the latest list, in the order clicked; kept until the next list starts or the home changes. */
  clicks: [] as PluginClick[],
  /** The list is running: a click waits or runs, or the read at its end hasn't come back. */
  clicking: false,
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
};

/** Opens or closes one remembered part ("Show more", or a part's file) and redraws. */
export function toggleOpened(key: string): void {
  if (market.opened.has(key)) market.opened.delete(key); else market.opened.add(key);
  rerender();
}

/** A different home has other tools and other installs: nothing done or read in the last one carries over. */
export function resetMarket(): void {
  // Clicks not yet sent are dropped with the list: its runner stops at its next turn (runClicks).
  market.clicks = []; market.clicking = false;
  resetPageData(market.read); market.problem = undefined; market.lastRun = undefined; market.working = undefined; market.addOpen = false;
  market.readmes.clear(); forgetDetails(); market.opened.clear(); market.nav = startNav();
}

/** The marketplace on screen: the one chosen, or the first listed. The page and the reads both use this. */
export function current(): { entry: MarketplaceView; index: number } | undefined {
  const list = market.view?.marketplaces ?? [];
  const bySource = list.findIndex(entry => entry.source === market.nav.source);
  const index = Math.max(0, bySource >= 0 ? bySource : list.findIndex(entry => !!market.nav.marketName && entry.name === market.nav.marketName));
  return list[index] ? { entry: list[index]!, index } : undefined;
}

/** The toolbar's notice ("… added", "… refreshed") has done its job once the person moves on. */
export function clearNotice(): void { if (app.outcome?.page === 'plugins') app.outcome = undefined; }

/** How many of a marketplace's plugins kept elsewhere are read ahead (each is a small Git copy), so a large catalog stays cheap. */
const REMOTE_READ_AHEAD = 8;

/**
 * The plugins the marketplace on screen lists under the current find text and category: those every tool that can take
 * them has first, then those some tool has, then those no tool has, by name within each (pluginstatus.ts pluginPlace); a
 * plugin whose switch was clicked on this list keeps the place it had (itemrow.ts Held).
 */
export function shownPlugins(entry: MarketplaceView) {
  const view = market.view;
  const listed = entry.plugins.filter(plugin => matches(plugin, market.nav.find) && (!market.nav.category || plugin.category === market.nav.category));
  if (!view) return listed;
  const held = heldRows<number>(listName(entry)), place = new Map(listed.map(plugin => [plugin.name, placeIn(held, plugin.name, pluginPlace(view, entry, plugin.name))]));
  return listed.sort((first, second) => place.get(first.name)! - place.get(second.name)!);
}

/** A marketplace's list, under its category, as the plugins held on it are named (app.ts heldRows); Find keeps them. */
const listName = (entry: MarketplaceView) => `plugins ${entry.source} ${market.nav.category ?? ''}`;

/** How many installed plugins' files the list reads at once in the background (see readShown). */
const COMPARE_AT_ONCE = 3;
/**
 * A redraw for a background read landing: it keeps the caret where the person is typing (the find box), since the redraw
 * makes a new box.
 */
function redrawKeepingCaret(): void {
  const box = document.activeElement instanceof HTMLInputElement ? document.activeElement : undefined;
  const [start, end] = [box?.selectionStart, box?.selectionEnd];
  rerender();
  const now = box?.id ? document.getElementById(box.id) : null;
  if (now instanceof HTMLInputElement && now !== box && start != null && end != null) now.setSelectionRange(start, end);
}
const comparing = readInTurn(market.details, COMPARE_AT_ONCE, redrawKeepingCaret);

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
    if (fresh) { market.readmes.clear(); forgetDetails(); }
    else for (const entry of market.view?.marketplaces ?? []) if (entry.kind === 'folder') market.readmes.delete(entry.source);
    settleView();
    // Only a Refresh the person clicked: the app's own reads after a change (the home read again, a background pass that
    // saw the files it wrote) leave the result's sentence standing.
    if (fresh) markReread();
  }
  rerender();
}

/** The person had the tools read again (Refresh): the last run's result is only named from now on (its Undo stays), never restated over a page that may differ. */
const markReread = () => { if (market.lastRun) market.lastRun = { ...market.lastRun, reread: true }; };

/** Runs an action with the page saying what it is doing. */
function act(activity: MarketActivity, work: () => Promise<void>) {
  endListNews();
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
  const what = result.already ? 'Marketplace already on this page' : 'Marketplace added';
  tell({ page: 'plugins', item: added?.name || undefined, text: added ? `${what}: ${plural(added.plugins.length, 'plugin')}, nothing installed (${marketTitle(added)}).` : `${what}. Nothing was installed.` });
  // Once added, focus leaves the add box (now gone), so the next key press doesn't land in an input that isn't there.
}).then(() => { if (!market.problem) (document.activeElement as HTMLElement | null)?.blur(); });

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
export const applyPluginOps = (ops: PluginOp[], undo = false) => act(undo ? 'undoing' : 'applying', async () => {
  const home = app.home!.home;
  market.problem = undefined;
  const planApi = { install: api().installPlugin, update: api().updatePlugin, uninstall: api().uninstallPlugin, setSkill: api().setPluginSkill, items: api().pluginItems };
  let result: Awaited<ReturnType<typeof runPlan>> = { done: [] };
  try {
    result = await runPlan(ops, planApi, home, step => { market.working = { source: step.source, plugin: step.plugin, tools: step.tools }; rerender(); });
  } finally {
    market.working = undefined;
    market.lastRun = { done: result.done, undo, home, ...(undo ? { rest: notUndone(ops, result.done) } : {}) };
    // A run that stopped after some steps names the plugins it didn't reach; the toolbar says what did run.
    const unrun = [...new Set(ops.filter(op => !result.done.some(entry => entry.source === op.source && entry.plugin === op.plugin)).map(op => op.plugin))];
    market.problem = result.stopped && result.done.length && unrun.length ? `Stopped before ${andList(unrun)}: ${result.stopped}` : result.stopped;
    await readAgain();
  }
  // A result that offers Undo is said in the toolbar, with its Undo; one that only tells (an Undo done) in the status bar.
  announce(market.problem ?? (resultSentence(resultLines(result.done, undo), undo) || 'Nothing changed.'), !market.problem && undoOps().length > 0);
});

/** What each tool now has changed: the page and the item pages read again, once for the action (app.ts readHomeOnce). */
async function readAgain(): Promise<void> {
  showView(await api().plugins().catch(() => null));
  // The item pages show what plugins bring, each with its switch in each tool, and a plugin's items in Pi and OpenCode: every
  // plugin change is seen there (and where it came from) at once.
  await readHomeOnce();
  readShown();
}

/**
 * One click in the page's list: the plugin, what was clicked (in one tool, for a tool's box), what its row says while it waits
 * and while it runs (`said`: aimWords), and where it is: waiting, running (main has it), reading (main returned `ran`, and the
 * view is read back) or ended.
 */
export interface PluginClick { source: string; plugin: string; what: PluginTurn; tool?: HarnessId; said: { waiting: string; running: string }; state: 'waiting' | 'running' | 'reading' | 'ended'; ran?: PluginTurnResult }

const waits = (click: PluginClick) => click.state === 'waiting';
/** The latest click on this plugin in the page's list, if one is there. */
export const clickOn = (source: string, plugin: string) => market.clicks.findLast(click => click.source === source && click.plugin === plugin);
/** A plugin's switch and boxes are off: under busy, and from a click on it until the view is read back after it. */
export const pluginBusy = (source: string, plugin: string) => !!app.busy || (clickOn(source, plugin)?.state ?? 'ended') !== 'ended';

/**
 * The latest list's rows are its news, true until the plugins change or are read again: they go at a new list, at any other
 * plugin action (act), at an item page's switch for a plugin's item (app.ts runSwitches), at the person's Refresh (app.ts
 * readAgain) and with another home (resetMarket). A running list keeps them.
 */
export function endListNews(): void { if (!market.clicking) market.clicks = []; }

/**
 * A plugin's one switch (pluginrecord.ts), clicked: On or Off, Add for one found in a tool, or one tool's box on its page
 * unticked or ticked (`tool`). The click joins the page's list and waits its turn there; the first click after a list has ended
 * starts a new one.
 */
export function turnPlugin(entry: MarketplaceView, plugin: string, what: PluginTurn, tool?: HarnessId): void {
  if (!market.clicking) { endListNews(); market.problem = undefined; clearNotice(); }
  market.clicks.push({ source: entry.source, plugin, what, tool, said: aimWords(what, tool), state: 'waiting' });
  // Its row stays where it is on the list (itemrow.ts Held), until the list is drawn afresh.
  if (market.view) hold(heldRows<number>(listName(entry)), plugin, pluginPlace(market.view, entry, plugin));
  // The control clicked waits until it is read back; Add gives way to the switch then. The focus goes back to it at the
  // list's end if nothing else took it.
  clickedLast = document.activeElement?.id.replace(/^padd/, 'pswitch');
  if (!market.clicking) void runClicks(market.clicks, app.home!.home);
  rerender();
}
let clickedLast: string | undefined;

/** What a row says of its click while it waits and while it runs: a tool's box names its tool ("Waiting to install in Codex"). */
function aimWords(what: PluginTurn, tool?: HarnessId): PluginClick['said'] {
  const name = tool ? ` ${toolNames[tool]}` : '';
  const [to, doing] = { on: ['install', 'Installing'], off: ['uninstall', 'Uninstalling'], add: ['add', 'Adding'], 'keep-out': ['uninstall from', 'Uninstalling from'], 'let-in': ['install in', 'Installing in'] }[what];
  return { waiting: `Waiting to ${to}${name}`, running: `${doing}${name}…` };
}

/**
 * The list's runner: each click sent to main in turn (main's queue orders it with passes and the automatic updates), then the
 * home read once, which stands for the background refresh held back meanwhile (app.ts acting). A click made during that read
 * runs too, and the home is read again after it. A list of several clicks is said as a whole at its end. A list the home's
 * change dropped (resetMarket) stops at its next turn.
 */
async function runClicks(list: PluginClick[], home: string): Promise<void> {
  market.clicking = true;
  showActing();
  for (let next = list.find(waits); market.clicks === list; next = list.find(waits)) {
    if (next) await runClick(next, home);
    else { await readHomeOnce(); if (!list.some(waits)) break; }
  }
  if (market.clicks !== list) return;
  market.clicking = false;
  // A plugin that partly failed is said once, where it went and where not ("beta: installed in Claude Code, not in Codex");
  // one that went nowhere is named as failed.
  const lines = lastLines(), went = new Set(lines.filter(line => line.ok).map(line => line.plugin));
  const notIn = (plugin: string) => [...new Set(list.filter(click => click.plugin === plugin).flatMap(click => click.ran?.done ?? []).filter(step => !succeeded(step.report)).map(step => toolNames[step.tool]))];
  const said = lines.map(line => (line.ok && notIn(line.plugin).length ? { ...line, text: `${line.text}, not in ${andList(notIn(line.plugin))}` } : line));
  const failed = [...new Set(lines.filter(line => !line.ok && !went.has(line.plugin)).map(line => line.plugin))];
  if (list.length > 1) announce([resultSentence(said, false), failed.length ? `${andList(failed)} failed.` : ''].filter(Boolean).join(' ') || 'Nothing changed.', !lines.some(line => !line.ok) && undoOps().length > 0);
  showActing();
  rerender();
  if (document.activeElement === document.body && clickedLast) document.getElementById(clickedLast)?.focus({ preventScroll: true });
  afterActing();
}

/**
 * One click, through main (marketplaces.ts turn: recorded first, then what its table owes): its row says it runs, then what
 * main returned; then the view is read back, so its switch and marks are true and it is free again. The last click to end
 * holds the one Undo, with what that Undo can't put back.
 */
async function runClick(click: PluginClick, home: string): Promise<void> {
  const view = market.view, entry = view?.marketplaces.find(each => each.source === click.source);
  click.state = 'running';
  market.working = { source: click.source, plugin: click.plugin, tools: click.tool ? [click.tool] : view?.tools ?? [] };
  rerender();
  const result = await api().turnPlugin(click.source, click.plugin, click.what, click.tool, home).catch((): PluginTurnResult => ({ stopped: 'That could not finish. Click Refresh to see where things stand.', done: [] }));
  if (!market.clicks.includes(click)) return;
  Object.assign(click, { state: 'reading', ran: result });
  market.working = undefined;
  const removed = result.done.filter(step => step.action === 'remove' && step.report.changed).map(step => step.tool);
  const limits = view && entry ? undoLimits(view, entry, click.plugin, removed, app.home?.pluginItems) : [];
  market.lastRun = { done: result.done, undo: false, home, ...(result.back ? { turn: { source: click.source, plugin: click.plugin, before: result.before ?? null, back: result.back, limits } } : {}) };
  announce(result.stopped ?? (resultSentence(resultLines(result.done, false), false) || `Nothing changed for ${click.plugin}.`), !result.stopped && undoOps().length > 0);
  rerender();
  showView(await api().plugins().catch(() => null));
  click.state = 'ended';
  rerender();
}

/**
 * What the toolbar and the problems band say of the last run: while the latest list's rows are there, every click of it together
 * (a click main stopped is its plugin's line); else the last run's own. The one Undo stays the last run's (undoOps).
 */
export function lastLines(): ResultLine[] {
  const last = market.lastRun, ran = market.clicks.filter(click => click.ran);
  if (!last || !ran.length) return last ? resultLines(last.done, last.undo) : [];
  return ran.flatMap(({ source, plugin, ran: { done, stopped } = { done: [] } }) => [...resultLines(done), ...(stopped ? [{ source, plugin, ok: false, text: stopped, short: stopped }] : [])]);
}

/** The Undo of a plugin's switch (or "Undo the rest" after it): its entry put back, then its steps run, in main. */
const undoTurn = (last: LastRun & { turn: NonNullable<LastRun['turn']> }) => act('undoing', async () => {
  const home = app.home!.home, back = last.undo ? last.rest ?? [] : last.turn.back;
  market.problem = undefined;
  market.working = { source: last.turn.source, plugin: last.turn.plugin, tools: [...new Set(back.map(op => op.tool))] };
  rerender();
  let done: PluginDone[] = [];
  try {
    const result = await api().undoPluginTurn(last.turn.source, last.turn.plugin, last.turn.before, back, home);
    done = result.done;
    market.lastRun = { done, undo: true, home, rest: notUndone(back, done), turn: last.turn };
    market.problem = result.stopped;
  } finally {
    market.working = undefined;
    await readAgain();
  }
  // The focus goes to the plugin it undid, on the list or on its page, as Undo itself may go.
  const at = market.view?.marketplaces.findIndex(each => each.source === last.turn.source);
  focusWhenDone(`pswitch-${market.nav.plugin ? 'page-' : ''}${at}-${last.turn.plugin}`);
  announce(market.problem ?? (resultSentence(resultLines(done, true), true) || 'Nothing changed.'));
});

/**
 * Undo's label: "Undo the rest" after an Undo that didn't finish; with the click it reverses ("Undo gamma", "Undo gamma in Codex"
 * for a box) when the sentence beside it (lastLines) names more than that one click, since it reverses only the last; else "Undo".
 */
export function undoLabel(): string {
  const last = market.lastRun, ran = market.clicks.filter(click => click.ran), click = ran.at(-1);
  if (last?.undo) return 'Undo the rest';
  return last?.turn && click && ran.length > 1 ? `Undo ${click.plugin}${click.tool ? ` in ${toolNames[click.tool]}` : ''}` : 'Undo';
}

/** Undo, or "Undo the rest": the last run's way back, by the route that made it (turnPlugin or applyPluginOps). */
export function undoLast(): void {
  const last = market.lastRun;
  if (last?.turn) void undoTurn({ ...last, turn: last.turn });
  else void applyPluginOps(undoOps(), true);
}

/**
 * Closes the problem band: the stop reason and the problem lines go, and the run itself stays, so the toolbar keeps its
 * result line and Undo (for what a run that partly failed did change).
 */
export function dismissProblems(): void {
  market.problem = undefined;
  // Closed, not dropped: a run that partly failed keeps its Undo for what it did change.
  if (market.lastRun) market.lastRun = { ...market.lastRun, problemsClosed: true };
}

/** The way back from the last run, while it is for the home on screen: its reversal (a switch's, as main gave it), or what an Undo didn't get to. */
export function undoOps(): PluginOp[] {
  const last = market.lastRun;
  if (!last || last.home !== app.home?.home) return [];
  return last.undo ? last.rest ?? [] : last.turn?.back ?? reverse(last.done);
}
