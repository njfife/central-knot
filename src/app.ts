import type { ApplyResult, Change, DesktopApi, HarnessId, HistoryEvent, HomeMode, HomeView, PluginActionResult, PluginsView } from './types.ts';
import { plural } from './model.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

export type Page = 'overview' | 'skills' | 'plugins' | 'history' | 'tools';

export const state = {
  home: undefined as HomeView | undefined,
  page: 'overview' as Page,
  find: '',
  /** The skill shown in the Skills detail. */
  item: undefined as string | undefined,
  busy: undefined as string | undefined,
  /** What sync did on its own, newest last, read when the History page opens. */
  history: undefined as HistoryEvent[] | undefined,
  /** Marketplaces and what each tool has installed, read when the Plugins page opens. */
  plugins: undefined as PluginsView | undefined,
  /** What the last plugin action did, or why a marketplace could not be added. */
  pluginResult: undefined as (PluginActionResult & { problem?: string }) | undefined,
  /** The plugin whose details are open, as marketplace source and plugin name. */
  pluginOpen: undefined as string | undefined,
  /** What the last Apply all did, shown until the next action or read. */
  applied: undefined as ApplyResult | undefined,
  /** The window chooses the sidebar shape until the person uses the toggle. */
  sidebar: undefined as 'open' | 'rail' | undefined,
};

let render = () => {};
export const setRenderer = (next: () => void) => { render = next; };
/** Re-renders and puts focus back on the control that had it, found by id. */
export const rerender = () => {
  const focused = document.activeElement?.id;
  render();
  if (focused && document.activeElement?.id !== focused) document.getElementById(focused)?.focus();
};

export function announce(text: string) { document.getElementById('announcement')!.textContent = text; }

const focusById = (id?: string | null) => (id ? document.getElementById(id) : null)?.focus();

/** One piece of work at a time: every mutating control is disabled while it runs. */
async function busy(message: string, work: () => Promise<void>) {
  const focused = document.activeElement?.id;
  state.busy = message;
  document.body.dataset.busy = 'true';
  announce(message);
  rerender();
  try { await work(); }
  catch {
    announce(state.home ? `That could not finish. Still on ${state.home.label}. Read again to see where things stand.` : 'Could not read this home. Nothing changed. Try again.');
  }
  state.busy = undefined;
  document.body.dataset.busy = 'false';
  rerender();
  focusById(focused);
}

function accept(view: HomeView) {
  state.home = view;
  state.applied = undefined;
  state.item = undefined;
  state.plugins = undefined;
  state.pluginResult = undefined;
  if (state.page === 'plugins') void loadPlugins();
}

/** Sends the Overview's pending changes, then reads the home again so the page shows what is on disk. */
export const applyManage = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const home = state.home!;
  const result = await api().apply(changes, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.applied = result;
  if (!result.stopped) onDone();
  const failed = result.results.filter(entry => entry.outcome === 'failed').length;
  const written = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
  announce(result.stopped ?? [result.harnessWrites ? `${plural(result.harnessWrites, 'copy', 'copies')} written${written.length <= 3 ? `: ${written.join(', ')}` : ''}.` : 'Applied. Nothing needed copying.', failed ? `${failed} failed.` : ''].filter(Boolean).join(' '));
});

export const loadHome = (mode: HomeMode) => busy('Reading user-wide skills…', async () => {
  const view = await api().selectHome(mode);
  if (view) { accept(view); announce('Read complete. Nothing changed.'); } else announce('');
});

export const readAgain = () => busy('Reading user-wide skills…', async () => {
  const view = await api().refresh();
  if (!view) return;
  state.home = view;
  state.applied = undefined;
  announce('Read complete. Nothing changed.');
});

export function showPage(page: Page) {
  if (page === 'plugins' && state.page !== 'plugins') { state.pluginResult = undefined; void loadPlugins(); }
  if (page === 'history') void loadHistory();
  state.page = page;
  state.find = '';
  state.item = undefined;
  rerender();
}

export function selectItem(key: string | undefined) {
  state.item = key;
  rerender();
  document.getElementById('detail-scroll')?.scrollTo(0, 0);
}

/** Shorter on screen only: the real home becomes ~, and the throwaway practice folder is elided. Copying gives the full path. */
export const shownPath = (path: string) => {
  const home = state.home;
  if (!home || home.mode === 'custom' || (path !== home.home && !path.startsWith(`${home.home}/`))) return path;
  return `${home.mode === 'actual' ? '~' : '…'}${path.slice(home.home.length)}`;
};

// ---------- Plugins ----------

export const loadPlugins = () => busy('Reading marketplaces…', async () => {
  state.plugins = (await api().plugins()) ?? undefined;
  announce('');
});

export const addMarketplace = (source: string) => busy('Reading the marketplace…', async () => {
  const result = await api().addMarketplace(source);
  if (result.view) state.plugins = result.view;
  state.pluginResult = result.problem ? { reports: [], problem: result.problem } : undefined;
  announce(result.problem ?? 'Marketplace added. Nothing was installed.');
});

export const refreshMarketplace = (source: string) => busy('Refreshing the marketplace…', async () => {
  state.plugins = (await api().refreshMarketplace(source)) ?? state.plugins;
  state.pluginResult = undefined;
  announce('Marketplace read again. Nothing was installed.');
});

export const forgetMarketplace = (source: string) => busy('Removing from the list…', async () => {
  state.plugins = (await api().forgetMarketplace(source)) ?? state.plugins;
  state.pluginResult = undefined;
  announce('Removed from Central Knot’s list. Tools that added it keep it, and nothing was uninstalled.');
});

export const pickMarketplaceFolder = () => api().pickMarketplaceFolder();

const names: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };

export const installPlugin = (source: string, plugin: string, tools: HarnessId[]) => busy(`Installing ${plugin}…`, async () => {
  const result = await api().installPlugin(source, plugin, tools, state.home!.home);
  if (result.view) state.plugins = result.view;
  state.pluginResult = result;
  announce(result.stopped ?? result.reports.map(report => `${names[report.tool]}: ${report.message}`).join(' '));
});

export const uninstallPlugin = (marketplace: string, plugin: string, tool: HarnessId) => busy(`Uninstalling ${plugin} from ${names[tool]}…`, async () => {
  const result = await api().uninstallPlugin(marketplace, plugin, tool, state.home!.home);
  if (result.view) state.plugins = result.view;
  state.pluginResult = result;
  announce(result.stopped ?? result.reports.map(report => report.message).join(' '));
});

// ---------- History ----------

export const loadHistory = () => busy('Reading History…', async () => {
  state.history = await api().history();
  announce('');
});

/** Undo or Restore from History: a new revision that spreads to every tool the skill syncs to. */
export const restoreEvent = (eventId: string) => busy('Restoring…', async () => {
  const home = state.home!;
  const result = await api().restore(eventId, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.history = await api().history();
  state.applied = result;
  announce(result.stopped ?? `Restored in ${plural(result.results.filter(entry => entry.outcome === 'written').length, 'tool')}.`);
});

/** Delete everywhere: offered when an edit was kept over a deletion with order unknown. */
export const deleteEverywhereKey = (key: string) => busy('Deleting everywhere…', async () => {
  const home = state.home!;
  const result = await api().deleteEverywhere(key, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.applied = result;
  announce(result.stopped ?? `Deleted from ${plural(result.harnessWrites, 'tool')}. Restore it from History.`);
});

// ---------- Sync switch and background changes ----------

export const setSync = (on: boolean) => busy(on ? 'Turning Sync on…' : 'Turning Sync off…', async () => {
  const view = await api().setSync(on);
  if (view) state.home = view;
  announce(on ? 'Sync is on. Changes spread on their own.' : 'Sync is off. Changes are noted and spread when you turn it back on.');
});

export const syncNow = () => busy('Syncing…', async () => {
  const view = await api().syncNow(state.home!.home);
  if (view) state.home = view;
  announce('Synced once. Sync stays off.');
});

/** A background pass changed something: read again quietly, keeping drafts, unless the person is in the middle of an action. */
let refreshing = false;
api().onSyncChanged(async () => {
  if (state.busy || refreshing || !state.home) return;
  refreshing = true;
  try { const view = await api().refresh(); if (view) { state.home = view; rerender(); } } finally { refreshing = false; }
});
