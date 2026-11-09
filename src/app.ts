import type { ApplyResult, Change, DesktopApi, DestinationResult, HarnessId, HistoryEvent, HomeMode, HomeView, McpResult, PluginActionResult, PluginsView } from './types.ts';
import { plural } from './model.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

export type Page = 'overview' | 'skills' | 'mcp' | 'agents' | 'plugins' | 'history' | 'tools';

export const state = {
  home: undefined as HomeView | undefined,
  page: 'overview' as Page,
  find: '',
  /** The skill shown in the Skills detail. */
  item: undefined as string | undefined,
  busy: undefined as string | undefined,
  /** What the last MCP Apply all or Write now did. */
  mcpResult: undefined as McpResult | undefined,
  agentsResult: undefined as McpResult | undefined,
  /** What sync did on its own, newest last, read when the History page opens. */
  history: undefined as HistoryEvent[] | undefined,
  /** Marketplaces and what each tool has installed, read when the Plugins page opens. */
  plugins: undefined as PluginsView | undefined,
  /** What the last plugin action did, or why a marketplace could not be added. */
  pluginResult: undefined as (PluginActionResult & { problem?: string }) | undefined,
  /** The plugin whose details are open, as marketplace source and plugin name. */
  pluginOpen: undefined as string | undefined,
  /** The installed cell waiting for its confirming click to uninstall, and what that click will do. */
  pluginConfirm: undefined as string | undefined,
  pluginConfirmText: undefined as string | undefined,
  /** The plugin the last install or uninstall was for, so its report can offer the reverse. */
  pluginLast: undefined as { source: string; market: string; plugin: string } | undefined,
  /** The plugin and tools an install or uninstall is running for, so their boxes show it is working. */
  pluginWorking: undefined as { plugin: string; tools: HarnessId[] } | undefined,
  /** What the last Apply all did, shown until the next action or read. */
  applied: undefined as ApplyResult | undefined,
  /** The Skills page: the table, or one skill's files and contents beside the list. */
  skillsView: 'table' as 'table' | 'files',
  /** What the last action did, shown as a band on the page it happened on until the next action or page. */
  outcome: undefined as { page: Page; text: string; item?: string; items?: string[]; carry?: boolean; history?: boolean; undo?: { id: string; label: string }; act?: { label: string; id: string; run: () => void } } | undefined,
  /** What is typed in the marketplace box, kept through loading and errors. */
  marketDraft: '',
  /** Sync notices the person has dismissed, by History event or item. */
  dismissed: new Set<string>(),
  /** Sync notices already shown on their page, so the sidebar dot clears once seen. */
  seenNotices: new Set<string>(),
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

export function announce(text: string, quiet = false) {
  const region = document.getElementById('announcement')!;
  region.textContent = text;
  // A quiet announcement is for screen readers only: the page already shows the same thing.
  region.dataset.quiet = quiet ? 'true' : '';
}

const focusById = (id?: string | null) => (id ? document.getElementById(id) : null)?.focus();

const andText = (items: string[]) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));

/** One piece of work at a time: every mutating control is disabled while it runs. */
async function busy(message: string, work: () => Promise<void>) {
  const focused = document.activeElement?.id;
  state.outcome = undefined;
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
/** A row to flash on its next draw (set by Undo and Restore; the matrix reads it). */
export const flashRequests = new Set<string>();
const flashRow = (item: string) => { if (item) flashRequests.add(item.toLowerCase()); };

/** After the first Apply all on a page, its tip has done its job. */
const retireTip = (kind: 'skills' | 'mcp' | 'agents') => { try { localStorage.setItem(`ck-help-dismissed-${kind}`, '1'); } catch { /* shows again */ } };

export const applyManage = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const home = state.home!;
  const result = await api().apply(changes, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.applied = result;
  if (!result.stopped) { onDone(); retireTip('skills'); }
  const managed = changes.filter(change => change.managed).length;
  // History holds what Apply all replaced (a chosen copy); new copies are undone by turning Managed off, which leaves them in place.
  const replacedSome = result.results.some(entry => entry.outcome === 'written' && /^Now uses/.test(entry.message));
  // Say what was added and what was replaced, apart: only a replacement is kept in History.
  const toolNames: Record<string, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };
  const order = Object.values(toolNames);
  const writtenTo = (replaced: boolean) => [...new Set(result.results.filter(entry => entry.outcome === 'written' && /^Now uses/.test(entry.message) === replaced).map(entry => toolNames[entry.harness ?? ''] ?? ''))].filter(Boolean).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const added = writtenTo(false), replacedIn = writtenTo(true);
  const single = managed === 1 ? changes.find(change => change.managed)?.key : undefined;
  const singleName = single ? state.home?.manage.skills.find(skill => skill.key === single)?.name ?? single : undefined;
  // The result matches the bar before it: how many new copies, and of which skills.
  const newCopies = result.results.filter(entry => entry.outcome === 'written' && !/^Now uses/.test(entry.message));
  const newItems = [...new Set(newCopies.map(entry => entry.item))];
  const what = [managed ? (singleName ? `${singleName} managed` : `${plural(managed, 'skill')} managed`) : '', newCopies.length ? `${plural(newCopies.length, 'new copy', 'new copies')} written${!singleName && newItems.length <= 3 ? ` (${newItems.join(', ')})` : ` to ${andText(added)}`}` : '', replacedIn.length ? `replaced ${andText(replacedIn.map(name => `${name}’s copy`))} (kept in History)` : '', !added.length && !replacedIn.length ? 'nothing needed copying' : ''].filter(Boolean).join(' · ');
  // New copies are in History as 'added': one Undo here removes them again (while unchanged) and unmanages those skills.
  // Only when nothing was replaced: undoing a replacement is its own History entry, and a half-undone choice would mislead.
  const addedNow = result.stopped || replacedSome ? [] : (await api().history()).filter(event => event.kind === 'added' && !event.undoneBy && changes.some(change => change.key === event.key) && Date.now() - Date.parse(event.at) < 5 * 60_000);
  if (!result.stopped) state.outcome = { page: state.page, history: replacedSome && !addedNow.length, text: `${what}.` + (managed ? ' From now on, an edit in one tool spreads to the others.' : ''), item: singleName,
    act: addedNow.length ? { label: addedNow.length === 1 ? 'Undo' : `Undo all ${addedNow.length}`, id: 'outcome-undo-added', run: () => void undoAdded(addedNow.map(event => event.id)) } : undefined };
  const failed = result.results.filter(entry => entry.outcome === 'failed').length;
  const written = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
  announce(result.stopped ?? [result.harnessWrites ? `${plural(result.harnessWrites, 'copy', 'copies')} written${written.length <= 3 ? `: ${written.join(', ')}` : ''}.` : 'Applied. Nothing needed copying.', failed ? `${failed} failed.` : ''].filter(Boolean).join(' '));
});

/** After a read: what was found and where, so a home switch or Refresh says what it did. */
const readSummary = (view: HomeView) => {
  const skills = view.manage.skills.length, servers = view.mcp.servers.length, agents = view.agents?.servers.length ?? 0;
  return `Read ${plural(skills, 'skill')}, ${plural(servers, 'MCP server')} and ${plural(agents, 'agent')} from ${view.label}. Nothing changed.`;
};

export const loadHome = (mode: HomeMode) => busy('Reading user-wide skills…', async () => {
  const view = await api().selectHome(mode);
  if (view) { accept(view); state.outcome = { page: state.page, carry: true, text: `Opened ${view.label}. ${readSummary(view).replace(/^Read /, 'Read ').replace(` from ${view.label}`, '')}` }; announce(readSummary(view), true); } else announce('');
});

/** At launch: the home last opened (so sync resumes where it was), else the practice copy. */
export const startHome = () => busy('Reading user-wide skills…', async () => {
  const view = await api().startHome();
  // The first read is said the same way as a home switch: a band, not a passing status line.
  const practiceNote = view?.mode === 'fixture' && (() => { try { return localStorage.getItem('ck-practice-banner-dismissed') !== '1'; } catch { return true; } })();
  if (view) { accept(view); if (!practiceNote) state.outcome = { page: state.page, carry: true, text: `Opened ${view.label}. ${readSummary(view).replace(` from ${view.label}`, '')}` }; announce(readSummary(view), true); } else announce('');
});

export const readAgain = () => busy('Reading user-wide skills…', async () => {
  const view = await api().refresh();
  if (!view) return;
  state.home = view;
  state.applied = undefined;
  announce(readSummary(view));
});

export function showPage(page: Page) {
  if (page === 'plugins' && state.page !== 'plugins') { state.pluginResult = undefined; void loadPlugins(); }
  // A new page starts clean: the last action's message and results belong to the page they happened on.
  // A home-switch result survives one page change, since switching is often followed by a click elsewhere.
  const carried = state.outcome?.carry ? { ...state.outcome, page, carry: false } : undefined;
  if (page !== state.page) { announce(''); state.pluginConfirm = undefined; state.outcome = carried; state.applied = undefined; state.mcpResult = undefined; state.agentsResult = undefined; state.skillsView = 'table'; }
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
  // The click hint only when some tool can take an install here.
  const canInstall = !!result.view && result.view.canWrite && result.view.tools.some(tool => result.view!.clis[tool]);
  const added = result.view?.marketplaces.find(entry => entry.source === source || entry.source.endsWith(source)) ?? result.view?.marketplaces.at(-1);
  const named = added ? `${added.name || added.source} added: ${plural(added.plugins.length, 'plugin')}.` : 'Marketplace added.';
  if (!result.problem) { state.marketDraft = ''; state.outcome = { page: 'plugins', text: canInstall ? `${named} Nothing was installed: click a tool’s box to install a plugin there.` : `${named} Nothing was installed.` }; }
  announce(result.problem ?? 'Marketplace added. Nothing was installed.');
});

export const refreshMarketplace = (source: string) => busy('Refreshing the marketplace…', async () => {
  state.plugins = (await api().refreshMarketplace(source)) ?? state.plugins;
  state.pluginResult = undefined;
  state.outcome = { page: 'plugins', text: 'Marketplace read again. Nothing was installed.' };
  announce('Marketplace read again. Nothing was installed.');
});

export const forgetMarketplace = (source: string) => busy('Removing from the list…', async () => {
  const before = state.plugins?.marketplaces.find(entry => entry.source === source)?.name;
  state.plugins = (await api().forgetMarketplace(source)) ?? state.plugins;
  state.pluginResult = undefined;
  const name = before;
  state.outcome = { page: 'plugins', text: `${name ? `${name} removed` : 'Removed'} from Central Knot’s list. Tools that added it keep it, and nothing was uninstalled.`, act: { label: 'Add back', id: 'outcome-add-back', run: () => void addMarketplace(source) } };
  announce('Removed from Central Knot’s list. Tools that added it keep it, and nothing was uninstalled.');
});

export const pickMarketplaceFolder = () => api().pickMarketplaceFolder();

const names: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };

export const installPlugin = (source: string, plugin: string, tools: HarnessId[]) => busy(`Installing ${plugin}…`, async () => {
  const market = state.plugins?.marketplaces.find(entry => entry.source === source)?.name ?? '';
  state.pluginWorking = { plugin, tools };
  render();
  const result = await api().installPlugin(source, plugin, tools, state.home!.home).finally(() => { state.pluginWorking = undefined; });
  if (result.view) state.plugins = result.view;
  state.pluginResult = result;
  state.pluginLast = { source, market, plugin };
  announce(result.stopped ?? result.reports.map(report => `${names[report.tool]}: ${report.message}`).join(' '));
});

export const uninstallPlugin = (marketplace: string, plugin: string, tool: HarnessId) => busy(`Uninstalling ${plugin} from ${names[tool]}…`, async () => {
  const source = state.plugins?.marketplaces.find(entry => entry.name === marketplace)?.source ?? '';
  state.pluginWorking = { plugin, tools: [tool] };
  render();
  const result = await api().uninstallPlugin(marketplace, plugin, tool, state.home!.home).finally(() => { state.pluginWorking = undefined; });
  if (result.view) state.plugins = result.view;
  state.pluginResult = result;
  state.pluginLast = { source, market: marketplace, plugin };
  announce(result.stopped ?? result.reports.map(report => report.message).join(' '));
});

// ---------- History ----------

export const loadHistory = () => busy('Reading History…', async () => {
  state.history = await api().history();
  announce('');
});

/** Undo or Restore from History: a new revision that spreads to every tool the skill syncs to. */
export const restoreEvent = (eventId: string, choice?: string) => busy('Restoring…', async () => {
  const home = state.home!;
  const result = await api().restore(eventId, home.manage.gate.state === 'needs-resume', home.home, choice);
  const view = await api().refresh();
  if (view) state.home = view;
  state.history = await api().history();
  state.applied = result;
  const restored = result.results.filter(entry => entry.outcome === 'written');
  const toolNames: Record<string, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };
  const where = [...new Set(restored.map(entry => toolNames[entry.harness ?? ''] ?? entry.harness ?? ''))].filter(Boolean);
  // The new History event is the one that undid this; offering it inline makes the undo itself undoable here.
  const past = state.history?.find(event => event.id === eventId);
  const undoneBy = past?.undoneBy;
  const everywhere = where.length >= (state.home?.snapshots.length ?? 3) ? `all ${where.length} tools` : andText(where);
  const item = restored[0]?.item ?? past?.item ?? '';
  const removedFrom = [...new Set(result.results.filter(entry => entry.outcome === 'removed').map(entry => toolNames[entry.harness ?? ''] ?? ''))].filter(Boolean);
  if (past?.kind === 'added') {
    const stayed = result.results.filter(entry => entry.outcome === 'held');
    if (!result.stopped) { state.outcome = { page: state.page, item: past.item, text: `Removed the new copies of ${past.item}${removedFrom.length ? ` from ${andText(removedFrom)}` : ''}.${stayed.length ? ` ${stayed.map(entry => entry.message).join(' ')}` : ` ${past.item} is unmanaged again.`}` }; flashRow(past.item); }
    announce(result.stopped ?? state.outcome?.text ?? '', !result.stopped);
    return;
  }
  const text = past?.kind === 'deleted' ? `${item} is back in ${everywhere}.`
    : past?.kind === 'restored' ? `Redone: ${item} is as it was before the undo, in ${everywhere}.`
      : `Undid ${past?.winner ? `${toolNames[past.winner.tool] ?? past.winner.tool}’s ${past.kind === 'chosen' ? 'chosen copy' : 'edit'}` : 'the change'} to ${item}. The earlier version is back in ${everywhere}.`;
  const label = past?.kind === 'deleted' ? 'Delete again in all tools' : past?.kind === 'restored' ? 'Undo again' : `Redo edit ${where.length >= (state.home?.snapshots.length ?? 3) ? 'in all tools' : `in ${andText(where)}`}`;
  if (!result.stopped && restored.length) state.outcome = { page: state.page, item, history: !undoneBy, undo: undoneBy ? { id: undoneBy, label } : undefined, text };
  // Screen readers hear the same sentence the band shows; the restored row flashes like a synced one.
  if (!result.stopped && restored.length) flashRow(item);
  announce(result.stopped ?? (restored.length ? text : `Restored in ${plural(restored.length, 'tool')}.`), !result.stopped && !!restored.length);
});

/** Undo of Apply all's new copies, for every skill it made Managed: each goes back to unmanaged, its new copies removed. */
export const undoAdded = (ids: string[]) => busy('Undoing Apply all…', async () => {
  const home = state.home!;
  const results: DestinationResult[] = [];
  let stopped: string | undefined;
  for (const id of ids) {
    const result = await api().restore(id, home.manage.gate.state === 'needs-resume', home.home);
    if (result.stopped) { stopped = result.stopped; break; }
    results.push(...result.results);
  }
  const view = await api().refresh();
  if (view) state.home = view;
  state.history = await api().history();
  const removed = results.filter(entry => entry.outcome === 'removed').length;
  const stayed = results.filter(entry => entry.outcome === 'held');
  const items = [...new Set(results.map(entry => entry.item))];
  if (!stopped) state.outcome = { page: state.page, items, text: `Undone: removed ${plural(removed, 'new copy', 'new copies')}; ${andText(items)} ${items.length === 1 ? 'is' : 'are'} unmanaged again.${stayed.length ? ` ${stayed.map(entry => entry.message).join(' ')}` : ''}` };
  for (const item of items) flashRow(item);
  announce(stopped ?? state.outcome?.text ?? '', !stopped);
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
  announce(on ? 'Automatic sync on.' : 'Automatic sync off.', true);
});

export const syncNow = () => busy('Syncing…', async () => {
  const view = await api().syncNow(state.home!.home);
  if (view) state.home = view;
  announce('Synced once. Automatic sync stays off.', true);
});

/** A background pass changed something: read again quietly, keeping drafts, unless the person is in the middle of an action. */
let refreshing = false;
api().onSyncChanged(async () => {
  if (state.busy || refreshing || !state.home) return;
  refreshing = true;
  // Something happened on its own: its notice tells it, so an earlier action's message no longer stands beside it.
  try { const view = await api().refresh(); if (view) { state.home = view; announce(''); state.outcome = undefined; rerender(); } } finally { refreshing = false; }
});

// ---------- MCP servers ----------

export const applyMcpChanges = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const result = await api().applyMcp(changes, state.home!.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.mcpResult = result;
  if (!result.stopped) { onDone(); retireTip('mcp'); }
  if (!result.stopped) {
    const toolNames: Record<string, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };
    const to = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => toolNames[entry.harness ?? ''] ?? ''))].filter(Boolean);
    const managed = changes.filter(change => change.managed).length;
    // The write band right below says what waits for Claude Code; the result names what was written, and where.
    const copied = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
    const matched = changes.filter(change => change.managed && !copied.includes(change.key)).map(change => change.key);
    state.outcome = { page: state.page, items: [...copied, ...changes.filter(change => change.managed && !copied.includes(change.key)).map(change => change.key)], text: `${managed ? `${plural(managed, 'server')} now managed` : 'Applied'}. ${copied.length ? `${andText(copied)} copied to ${andText(to)}` : 'Nothing needed writing'}${matched.length && copied.length ? `; ${andText(matched)} already matched there` : ''}. To take a new copy back out of a tool, turn off that tool’s box and Apply all, then delete it there.` };
  }
  announce(result.stopped ?? (result.writes ? 'Applied.' : 'Applied. Nothing needed writing.'), !result.stopped);
});

// ---------- Agents ----------

export const applyAgentsChanges = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const result = await api().applyAgents(changes, state.home!.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.agentsResult = result;
  if (!result.stopped) { onDone(); retireTip('agents'); }
  if (!result.stopped) {
    // One-way agents are said apart: an edit spreads from their source only.
    const managed = changes.filter(change => change.managed).map(change => state.home?.agents?.servers.find(server => server.key === change.key)).filter(server => !!server);
    const oneWay = managed.filter(server => Object.keys(server.limits ?? {}).length);
    const twoWay = managed.filter(server => !Object.keys(server.limits ?? {}).length);
    const nameOf = (server: { name?: string; key: string }) => server.name ?? server.key;
    const source = (server: (typeof managed)[number]) => { const match = /^One-way from ([^.]+)\./.exec(Object.values(server.limits ?? {})[0] ?? ''); return match?.[1] ?? 'its source'; };
    const how = [...oneWay.map(server => `${nameOf(server)} is one-way from ${source(server)} (↗)`), twoWay.length ? `${andText(twoWay.map(nameOf))} ${twoWay.length === 1 ? 'syncs' : 'sync'} both ways` : ''].filter(Boolean).join('; ');
    state.outcome = { page: state.page, text: `${plural(managed.length, 'agent')} managed · ${result.writes ? `${plural(result.writes, 'file')} written` : 'nothing needed writing'}.${how ? ` ${how}.` : ''}${result.writes ? ' To take a new copy back out of a tool, turn off that tool’s box and Apply all, then delete it there.' : ''}` };
  }
  announce(result.stopped ?? (result.writes ? `${plural(result.writes, 'agent file', 'agent files')} written.` : 'Applied. Nothing needed writing.'));
});

/** Write now: Claude Code's entries, once the person has quit Claude Code (MCP-02). */
export const writeClaudeNow = (names: string[]) => busy('Writing to Claude Code…', async () => {
  const result = await api().writeClaude(names, state.home!.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.mcpResult = result;
  if (!result.stopped) state.outcome = { page: state.page, item: names.length === 1 ? names[0] : undefined, text: `Written to Claude Code: ${names.join(', ')}. Start Claude Code again to use ${names.length === 1 ? 'it' : 'them'}. To take ${names.length === 1 ? names[0] : 'them'} back out of Claude Code, turn off ${names.length === 1 ? 'its' : 'their'} Claude Code box and Apply all.` };
  announce(result.stopped ?? `${plural(result.writes, 'server')} written to Claude Code.`);
});
