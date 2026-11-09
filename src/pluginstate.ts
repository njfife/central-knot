// Plugins: the page's state and actions. Marketplaces, what is chosen, what the last Apply all did, and where the person
// is browsing all live here, apart from the other features; app.ts only routes to it and resets it when the home changes.
import { announce, busy, rerender, state as app } from './app.ts';
import { plural } from './model.ts';
import { batches, clear, describe, pluginKey, prune, reverse, type PluginDone, type PluginDraft, type PluginOp } from './pluginplan.ts';
import type { ActionReport, PluginActionResult, PluginDetail, PluginsView } from './types.ts';
import { andList, toolNames } from './words.ts';

const api = () => window.centralKnot;

export type MarketTab = 'plugins' | 'about';
/** What the page is doing, so it can say so; set by each action, cleared when it ends. */
export type MarketActivity = 'reading' | 'adding' | 'refreshing' | 'removing' | 'applying' | 'undoing';

export const market = {
  /** Marketplaces and what each tool has installed, read when the page opens. */
  view: undefined as PluginsView | undefined,
  /** Why a marketplace could not be added, or why an Apply all stopped. */
  problem: undefined as string | undefined,
  activity: undefined as MarketActivity | undefined,
  /** Changes chosen but not applied (pluginplan.ts): nothing runs until Apply all. */
  draft: new Map() as PluginDraft,
  /** What the last Apply all (or its Undo) did, in which home, so the band can say it and offer the way back there only. */
  done: undefined as { done: PluginDone[]; undo: boolean; home: string } | undefined,
  /** The plugin and tools a command is running for, so their boxes show it is working. */
  working: undefined as { source: string; plugin: string; tools: string[] } | undefined,
  /** Where the person is: the marketplace shown, its tab, an open plugin page, and the filter. */
  nav: { source: undefined as string | undefined, tab: 'plugins' as MarketTab, plugin: undefined as string | undefined, find: '', category: undefined as string | undefined },
  /** READMEs and plugin contents read so far, by plugin key ('' plugin: the marketplace's own README); null while reading. */
  detail: new Map<string, { readme?: string } | PluginDetail | null>(),
  /** What is typed in the add box, kept through loading and errors. */
  draftSource: '',
};

/** A different home has other tools and other installs: nothing chosen or done in the last one carries over. */
export function resetMarket(): void {
  market.view = undefined; market.problem = undefined; market.draft.clear(); market.done = undefined; market.working = undefined; market.detail.clear();
  market.nav = { ...market.nav, plugin: undefined };
}

/** Runs an action with the page saying what it is doing. */
const act = (activity: MarketActivity, label: string, work: () => Promise<void>) => busy(label, async () => {
  market.activity = activity;
  try { await work(); } finally { market.activity = undefined; }
});

/** Reads a README or a plugin's contents once, in the background, then redraws. */
function readDetail(source: string, plugin = ''): void {
  const key = pluginKey(source, plugin);
  if (market.detail.has(key)) return;
  market.detail.set(key, null);
  void api().pluginDetail(source, plugin || undefined).then(detail => { market.detail.set(key, detail ?? { readme: undefined }); rerender(); }, () => { market.detail.set(key, { readme: undefined }); rerender(); });
}

/** Moves within the page and reads what the new place shows. The "added" message has done its job once the person moves on. */
export function browse(patch: Partial<typeof market.nav>): void {
  market.nav = { ...market.nav, ...patch };
  if (app.outcome?.page === 'plugins') app.outcome = undefined;
  const source = market.nav.source ?? market.view?.marketplaces[0]?.source;
  if (source && market.nav.plugin) readDetail(source, market.nav.plugin);
  else if (source && market.nav.tab === 'about') readDetail(source);
  rerender();
  document.getElementById('plugins-scroll')?.scrollTo(0, 0);
}

export const loadPlugins = () => act('reading', 'Reading marketplaces…', async () => {
  market.view = (await api().plugins()) ?? undefined;
  market.problem = undefined;
  market.done = undefined;
  prune(market.draft, market.view);
  announce('');
  // With no marketplaces yet, the box to type one in is where the work starts.
  if (market.view && !market.view.marketplaces.length) requestAnimationFrame(() => document.getElementById('marketplace-source')?.focus());
});

export const addMarketplace = (source: string) => act('adding', 'Reading the marketplace…', async () => {
  const result = await api().addMarketplace(source);
  if (result.view) market.view = result.view;
  market.problem = result.problem;
  if (result.problem) { announce(result.problem); return; }
  const added = market.view?.marketplaces.find(entry => entry.source === result.source);
  market.draftSource = '';
  market.nav = { source: added?.source, tab: 'plugins', plugin: undefined, find: '', category: undefined };
  const named = added ? `${added.name || added.source} added: ${plural(added.plugins.length, 'plugin')}.` : 'Marketplace added.';
  app.outcome = { page: 'plugins', item: added?.name || undefined, text: `${named} Nothing was installed.` };
  announce(app.outcome.text, true);
}).then(() => { if (!market.problem) (document.activeElement as HTMLElement | null)?.blur(); });

export const refreshMarketplace = (source: string) => act('refreshing', 'Refreshing the marketplace…', async () => {
  market.view = (await api().refreshMarketplace(source)) ?? market.view;
  for (const key of [...market.detail.keys()]) if (key.startsWith(pluginKey(source, ''))) market.detail.delete(key);
  prune(market.draft, market.view);
  const entry = market.view?.marketplaces.find(candidate => candidate.source === source);
  app.outcome = { page: 'plugins', item: entry?.name || undefined, text: `${entry?.name || 'Marketplace'} refreshed: ${plural(entry?.plugins.length ?? 0, 'plugin')}. Nothing was installed.` };
  announce(app.outcome.text, true);
}).then(() => browse({}));

export const forgetMarketplace = (source: string) => act('removing', 'Removing from the list…', async () => {
  const name = market.view?.marketplaces.find(entry => entry.source === source)?.name;
  market.view = (await api().forgetMarketplace(source)) ?? market.view;
  prune(market.draft, market.view);
  if (market.nav.source === source) market.nav = { ...market.nav, source: undefined, plugin: undefined };
  const text = `${name || 'It'} was removed from this list. Tools that added it keep it, and nothing was uninstalled.`;
  app.outcome = { page: 'plugins', item: name || undefined, text, act: { label: 'Add back', id: 'outcome-add-back', run: () => void addMarketplace(source) } };
  announce(text, true);
});

export const pickMarketplaceFolder = () => api().pickMarketplaceFolder();

/** Opens an https link in the browser. */
export const openLink = (url: string) => void api().openExternal(url);

/** A failure for each tool of a batch that could not run at all, so the report says so and Undo leaves it alone. */
const failedReports = (tools: PluginOp['tool'][], message: string): ActionReport[] => tools.map(tool => ({ tool, outcome: 'failed', message, runs: [] }));

/** Runs plugin changes through each tool's own command, in pluginplan's order, and keeps what each one did. */
export const applyPluginOps = (ops: PluginOp[], undo = false) => act(undo ? 'undoing' : 'applying', undo ? 'Undoing…' : 'Applying…', async () => {
  const home = app.home!.home;
  const done: PluginDone[] = [];
  market.problem = undefined;
  try {
    for (const batch of batches(ops)) {
      market.working = { source: batch.source, plugin: batch.plugin, tools: batch.tools };
      rerender();
      let result: PluginActionResult;
      try {
        result = batch.action === 'install'
          ? await api().installPlugin(batch.source, batch.plugin, batch.tools, home)
          : await api().uninstallPlugin(batch.market, batch.plugin, batch.tools[0]!, home);
      } catch { result = { reports: failedReports(batch.tools, 'It stopped unexpectedly. Refresh to see where it stands.') }; }
      for (const report of result.stopped ? failedReports(batch.tools, result.stopped) : result.reports) done.push({ source: batch.source, market: batch.market, plugin: batch.plugin, tool: report.tool, action: batch.action, report });
      // A refusal for the whole home (it changed, or writing isn't allowed) stops the run; the rest stays chosen.
      if (result.stopped) { market.problem = result.stopped; break; }
    }
  } finally {
    market.working = undefined;
    for (const entry of done) clear(market.draft, entry);
    market.done = { done, undo, home };
    market.view = (await api().plugins().catch(() => null)) ?? market.view;
    prune(market.draft, market.view);
  }
  announce(market.problem ?? describe(done, toolNames, andList).map(line => `${line.plugin}: ${line.text}`).join('. '), true);
});

/** Undo for the last Apply all, while it is for the home on screen. */
export const undoOps = (): PluginOp[] => {
  const last = market.done;
  if (!last || last.undo || last.home !== app.home?.home) return [];
  return reverse(last.done);
};
