// Plugins: browse marketplaces, choose which plugins go to which tools, then Apply all.
// The list of marketplaces sits at the left; the chosen one shows its plugins or its README, and a plugin opens its own page
// (pluginpage.ts). Boxes only choose changes; Apply all runs them (pluginstate.ts, pluginplan.ts).
import { rerender, shownPath, showPage, state as app } from './app.ts';
import { button, emptyState, h, icon } from './dom.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import { plural } from './model.ts';
import { pluginPage } from './pluginpage.ts';
import { blocked, contentsSummary, readme, toolBox } from './pluginparts.ts';
import { describe, pluginKey, queued, summary } from './pluginplan.ts';
import { addMarketplace, applyPluginOps, browse, forgetMarketplace, market, openLink, pickMarketplaceFolder, refreshMarketplace, undoOps } from './pluginstate.ts';
import type { MarketplaceView, PluginView, PluginsView } from './types.ts';
import { andList, toolNames as names } from './words.ts';

const when = (iso: string) => new Date(iso).toDateString() === new Date().toDateString() ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** A source short enough to read: owner/repo for GitHub, the folder's own name for a folder; the full text is its tooltip. */
const shortSource = (entry: MarketplaceView) => entry.kind === 'folder' ? shownPath(entry.source).split(/[\\/]/).filter(Boolean).at(-1) ?? entry.source : entry.source.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

/** The marketplace on screen: the one chosen, or the first. */
function selected(view: PluginsView): { entry: MarketplaceView; index: number } | undefined {
  const index = Math.max(0, view.marketplaces.findIndex(entry => entry.source === market.nav.source));
  const entry = view.marketplaces[index];
  return entry ? { entry, index } : undefined;
}

/** Every marketplace, with how many plugins it lists, installed and chosen; the add box below. */
function marketList(view: PluginsView, current?: MarketplaceView) {
  const add = () => { if (market.draftSource.trim()) void addMarketplace(market.draftSource.trim()); };
  const input = h('input.market-add-input', { id: 'marketplace-source', type: 'text', placeholder: 'owner/repo, Git URL or folder', 'aria-label': 'Marketplace to add', spellcheck: 'false', value: market.draftSource,
    oninput: (event: Event) => { market.draftSource = (event.target as HTMLInputElement).value; const go = document.getElementById('add-marketplace') as HTMLButtonElement | null; if (go) go.disabled = !!app.busy || !market.draftSource.trim(); },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') add(); } });
  return h('nav.market-list', { 'aria-label': 'Marketplaces' },
    view.marketplaces.length ? h('h2.market-list-title', {}, 'Marketplaces') : null,
    h('ul', {}, view.marketplaces.map(entry => {
      const count = (test: (plugin: PluginView) => boolean) => entry.plugins.filter(test).length;
      const installedCount = count(plugin => view.tools.some(tool => entry.states[plugin.name]?.[tool]?.state === 'installed'));
      const chosen = count(plugin => view.tools.some(tool => queued(market.draft, entry.source, plugin.name, tool)));
      return h('li', {}, h(`button.market-item${entry === current ? '.selected' : ''}`, { type: 'button', 'aria-current': entry === current ? 'true' : undefined, onclick: () => browse({ source: entry.source, plugin: undefined, tab: 'plugins', find: '', category: undefined }) },
        h('span.market-item-name', {}, entry.name || shortSource(entry)),
        h('span.market-item-meta', {}, entry.problem && !entry.plugins.length ? 'Couldn’t be read' : [plural(entry.plugins.length, 'plugin'), installedCount ? `${installedCount} installed` : '', chosen ? `${chosen} chosen` : ''].filter(Boolean).join(' · '))));
    })),
    h('div.market-add', {},
      h('label.market-add-label', { for: 'marketplace-source' }, 'Add a marketplace'),
      input,
      h('div.market-add-actions', {},
        button({ variant: 'primary', size: 'small', label: 'Add', id: 'add-marketplace', disabled: !!app.busy || !market.draftSource.trim(), onclick: add }),
        button({ variant: 'ghost', size: 'small', icon: 'folder-plus', label: 'Folder…', name: 'Choose a marketplace folder', id: 'pick-marketplace-folder', disabled: !!app.busy, onclick: () => void pickMarketplaceFolder().then(folder => { if (folder) void addMarketplace(folder); }) }))));
}

/** One row per plugin: what it is and holds, and a box per tool. The row opens the plugin's page. */
function pluginRow(view: PluginsView, entry: MarketplaceView, index: number, plugin: PluginView) {
  const holds = plugin.from ? `From ${plugin.from.label}` : contentsSummary(plugin);
  const open = () => browse({ plugin: plugin.name });
  return h('div.ov-row.plugin-row', { role: 'row', 'data-plugin': plugin.name, onclick: open },
    h('div.ov-name.plugin-row-name', { role: 'cell' },
      h('button.plugin-row-open', { type: 'button', id: `popen-${index}-${plugin.name}`, 'aria-label': `Open ${plugin.displayName ?? plugin.name}`, onclick: (event: Event) => { event.stopPropagation(); open(); } },
        h('span.plugin-row-title', {}, plugin.displayName ?? plugin.name), plugin.category ? h('span.plugin-chip', {}, plugin.category) : null),
      plugin.description ? h('span.plugin-row-about', { title: plugin.description }, plugin.description) : null,
      holds ? h('span.plugin-row-holds', {}, holds) : null),
    view.tools.map(tool => toolBox(view, entry, plugin, tool, index)),
    h('div.ov-cell.plugin-row-go', { role: 'cell', 'aria-hidden': 'true' }, icon('chevron-right', 14, 'tone-faint')));
}

/** Words to match: name, description, category and keywords. */
const matches = (plugin: PluginView, find: string) => !find || [plugin.name, plugin.displayName, plugin.description, plugin.category, ...(plugin.keywords ?? [])].some(text => text?.toLowerCase().includes(find.toLowerCase()));

function pluginsTab(view: PluginsView, entry: MarketplaceView, index: number) {
  const categories = [...new Set(entry.plugins.map(plugin => plugin.category).filter((category): category is string => !!category))].sort();
  const shown = entry.plugins.filter(plugin => matches(plugin, market.nav.find) && (!market.nav.category || plugin.category === market.nav.category));
  const findBox = h('input.market-find', { id: 'plugin-find', type: 'search', placeholder: `Find in ${plural(entry.plugins.length, 'plugin')}`, 'aria-label': 'Find plugins', value: market.nav.find,
    oninput: (event: Event) => {
      market.nav = { ...market.nav, find: (event.target as HTMLInputElement).value };
      rerender();
      // The redraw makes a new box; the caret goes back to where the person was typing.
      const box = document.getElementById('plugin-find') as HTMLInputElement | null;
      box?.setSelectionRange(box.value.length, box.value.length);
    } });
  const someCan = view.canWrite && view.tools.some(tool => view.clis[tool]);
  const cannot = view.tools.filter(tool => !view.clis[tool]);
  const refusal = view.tools.includes('copilot-cli') && view.clis['copilot-cli'] ? entry.plugins.find(plugin => plugin.copilotRefuses)?.copilotRefuses : undefined;
  return [
    entry.plugins.length > 8 || categories.length > 1 ? h('div.market-filter', {}, entry.plugins.length > 8 ? findBox : null,
      categories.length > 1 ? h('div.market-chips', { role: 'group', 'aria-label': 'Category' },
        [undefined, ...categories].map(category => h(`button.market-chip${market.nav.category === category ? '.selected' : ''}`, { type: 'button', 'aria-pressed': String(market.nav.category === category), onclick: () => browse({ category }) },
          category ?? 'All', h('span.market-chip-count', {}, String(category ? entry.plugins.filter(plugin => plugin.category === category).length : entry.plugins.length))))) : null) : null,
    refusal ? h('p.market-hint', {}, icon('circle-alert', 13, 'tone-warning'), `Copilot CLI can’t take this marketplace: ${refusal}`) : null,
    cannot.length && someCan ? h('p.market-hint', {}, icon('circle-alert', 13, 'tone-warning'), `No command-line tool was found for ${andList(cannot.map(tool => names[tool]))}, so it can’t install there. `,
      button({ variant: 'link', size: 'micro', label: 'See Tools', id: `market-tools-${index}`, onclick: () => showPage('tools') })) : null,
    shown.length ? withTools(view, h('div.ov.plugin-table', { role: 'table', 'aria-label': `Plugins in ${entry.name}` },
      h('div.ov-row.ov-head', { role: 'row' }, h('div.ov-name', { role: 'columnheader' }, someCan ? 'Click a tool’s box to choose it; nothing runs until Apply all.' : 'Plugin'),
        view.tools.map(tool => h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool]))), h('div.ov-cell.plugin-row-go', { role: 'columnheader' })),
      shown.map(plugin => pluginRow(view, entry, index, plugin))))
      : h('p.market-empty', {}, entry.plugins.length ? 'No plugin matches.' : entry.problem ? '' : 'This marketplace lists no plugins.'),
    shown.length ? legend(view, entry) : null,
  ];
}

function aboutTab(entry: MarketplaceView) {
  const detail = market.detail.get(pluginKey(entry.source, ''));
  if (!detail) return h('p.plugin-muted', {}, 'Reading…');
  return 'readme' in detail && detail.readme ? h('div.plugin-readme', {}, readme(detail.readme, entry.name, entry.description)) : h('p.plugin-muted', {}, 'This marketplace has no README.');
}

function marketPage(view: PluginsView, entry: MarketplaceView, index: number) {
  const plugin = market.nav.plugin ? entry.plugins.find(candidate => candidate.name === market.nav.plugin) : undefined;
  if (plugin) return pluginPage(view, entry, index, plugin);
  const title = entry.name || shortSource(entry);
  const remove = button({ variant: 'ghost', size: 'small', icon: 'circle-minus', label: 'Remove', name: `Remove ${title} from this list. Installed plugins stay installed.`, id: `forget-${index}`, disabled: !!app.busy, onclick: () => void forgetMarketplace(entry.source) });
  remove.title = 'Removes it from this list only. Installed plugins stay installed.';
  // Only another tool's copy is worth saying; added here is the usual case.
  const elsewhere = entry.origins.filter(origin => origin !== 'central-knot').map(origin => names[origin]);
  const source = entry.page ? button({ variant: 'link', size: 'micro', label: shortSource(entry), id: `market-page-${index}`, onclick: () => openLink(entry.page!) }) : h('span', { title: entry.source }, shortSource(entry));
  return h('section.market-page', { 'aria-label': title },
    h('header.market-page-head', {},
      h('div.market-page-title', {}, h('h2', {}, title),
        h('div.market-page-actions', {},
          button({ variant: 'ghost', size: 'small', icon: 'refresh-cw', label: 'Refresh', id: `refresh-${index}`, disabled: !!app.busy, onclick: () => void refreshMarketplace(entry.source) }),
          entry.origins.includes('central-knot') ? remove : null)),
      entry.description ? h('p.market-page-about', {}, entry.description) : null,
      h('p.market-page-meta', {}, [entry.owner ? `By ${entry.owner}` : '', elsewhere.length ? `Also in ${andList(elsewhere)}` : '', entry.fetchedAt ? `Updated ${when(entry.fetchedAt)}` : ''].filter(Boolean).join(' · '), ' · ', source)),
    entry.problem ? h('div.band', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, entry.problem, entry.stale && entry.fetchedAt ? ` Showing the copy from ${when(entry.fetchedAt)}; installing waits until it can be reached.` : '')) : null,
    h('div.market-tabs', { role: 'tablist' },
      (['plugins', 'about'] as const).map(tab => h(`button.market-tab${market.nav.tab === tab ? '.selected' : ''}`, { type: 'button', role: 'tab', id: `market-tab-${tab}`, 'aria-selected': String(market.nav.tab === tab), onclick: () => browse({ tab }) },
        tab === 'plugins' ? `Plugins (${entry.plugins.length})` : 'About'))),
    market.nav.tab === 'about' ? aboutTab(entry) : pluginsTab(view, entry, index));
}

/** What the boxes mean, only for the kinds on screen. */
function legend(view: PluginsView, entry: MarketplaceView) {
  const states = entry.plugins.flatMap(plugin => view.tools.map(tool => blocked(view, entry, tool) && entry.states[plugin.name]?.[tool]?.state !== 'installed' ? 'cannot' : entry.states[plugin.name]?.[tool]?.state ?? 'not-installed'));
  const chosen = entry.plugins.flatMap(plugin => view.tools.map(tool => queued(market.draft, entry.source, plugin.name, tool)));
  const item = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  return h('div.legend.plugin-legend', { 'aria-label': 'Key' },
    states.includes('installed') ? item('Installed', h('span.legend-cell.cell-synced.cell-on', {}, icon('check', 11))) : null,
    states.includes('not-installed') ? item('Not installed', h('span.legend-cell.cell-absent', {}, icon('plus', 10))) : null,
    states.includes('not-known') ? item('Unknown: the tool didn’t confirm the install', h('span.legend-cell.cell-differs', {}, icon('circle-question-mark', 11))) : null,
    states.includes('cannot') ? item('Can’t install there', h('span.legend-cell.cell-cannot', {})) : null,
    chosen.some(Boolean) ? h('span.legend-lead', {}, 'On Apply all:') : null,
    chosen.includes('install') ? item('installed', h('span.legend-cell.cell-pending.cell-chosen.cell-on', {}, icon('plus', 10))) : null,
    chosen.includes('remove') ? item('uninstalled', h('span.legend-cell.cell-pending.cell-pending-remove', {}, icon('x', 10))) : null);
}

/** Column count through the style object; the page's security policy refuses inline style attributes. */
function withTools(view: PluginsView, table: HTMLElement) {
  table.style.setProperty('--tool-count', String(view.tools.length));
  return table;
}

/** What the last Apply all did, plugin by plugin, with one Undo for everything it changed in this home. */
function report() {
  const last = market.done;
  if (!market.problem && !last?.done.length) return null;
  const lines = last ? describe(last.done, names, andList) : [];
  const back = undoOps();
  const undo = back.length ? button({ variant: 'outline', size: 'small', label: 'Undo', id: 'plugins-undo', disabled: !!app.busy, onclick: () => void applyPluginOps(back, true) }) : null;
  if (undo) undo.title = 'Reverses what changed, through each tool’s own command: uninstalls what was installed and reinstalls what was uninstalled.';
  return h(`div.band.plugin-report${market.problem && !lines.length ? '.band-danger' : ''}`, { role: 'status' },
    h('div.plugin-report-lines', {},
      lines.map(line => h('p', {}, icon(line.ok ? 'check' : 'triangle-alert', 14, line.ok ? 'tone-success' : 'tone-warning'), h('span', {}, h('strong.item-name', {}, line.plugin), `: ${line.text}${line.ok ? '.' : ''}`, last?.undo && line.ok ? h('span.tone-faint', {}, ' (undone)') : null))),
      market.problem ? h('p', {}, icon('circle-alert', 14, 'tone-danger'), market.problem) : null),
    undo,
    h('button.band-dismiss', { type: 'button', id: 'report-dismiss', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => { market.problem = undefined; market.done = undefined; rerender(); } }, icon('x', 12)));
}

/** Counts, Discard and Apply all: shown once anything is chosen. */
function changeBar() {
  const counts = summary(market.draft);
  const parts = [`${plural(counts.plugins, 'plugin')} to change`, counts.installs ? plural(counts.installs, 'install') : '', counts.removals ? plural(counts.removals, 'uninstall') : ''].filter(Boolean);
  return h('div.toolbar', {}, h('span.toolbar-spacer'), h('div.apply', {},
    h('span.apply-count.apply-quiet', { title: 'Nothing runs until Apply all' }, parts.join(' · ')),
    button({ variant: 'ghost', size: 'small', label: 'Discard', id: 'plugins-discard', disabled: !!app.busy, onclick: () => { market.draft.clear(); rerender(); } }),
    button({ variant: 'primary', size: 'small', label: 'Apply all', id: 'plugins-apply', disabled: !!app.busy || !market.view?.canWrite, onclick: () => void applyPluginOps([...market.draft.values()]) })));
}

const activityText: Record<NonNullable<typeof market.activity>, string> = {
  reading: 'Reading marketplaces… Nothing is installed by this.', adding: 'Reading the marketplace… Nothing is installed by this.', refreshing: 'Refreshing the marketplace… Nothing is installed by this.',
  removing: 'Removing from the list…', applying: 'Applying… Each change runs that tool’s own command and can take a few seconds.', undoing: 'Undoing… Each change runs that tool’s own command and can take a few seconds.',
};

export function pluginsPage() {
  const view = market.view;
  if (!view) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, market.activity ? 'Reading marketplaces…' : 'Marketplaces could not be read.')));
  const current = selected(view);
  return h('div.page.plugins-page', {},
    market.draft.size ? changeBar() : null,
    h('div.bands', {},
      view.canWrite ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.reason ?? 'Preview only here.')),
      market.activity && market.activity !== 'reading' ? h('div.band', { role: 'status' }, icon('refresh-cw', 14, 'spin tone-muted'), h('span.band-text', {}, activityText[market.activity])) : null,
      outcomeBand(),
      report()),
    h('div.market-layout', {},
      marketList(view, current?.entry),
      h('div.scroll.market-main', { id: 'plugins-scroll' },
        current
          ? marketPage(view, current.entry, current.index)
          : emptyState('puzzle', 'No marketplaces yet', 'A marketplace is a Git repository or folder that lists plugins. Add one at the left: owner/repo, a Git URL or a folder. Adding reads its list and installs nothing.',
            h('p.empty-aside', {}, 'Marketplaces you added in Claude Code, Copilot CLI or Codex show up here by themselves.')))));
}
