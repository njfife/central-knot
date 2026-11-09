// Plugins: browse marketplaces, choose which plugins go to which tools, then Apply all.
// The list of marketplaces sits at the left; the chosen one shows its plugins or its README, and a plugin opens its own page
// (pluginpage.ts). Boxes only choose changes; Apply all runs them (pluginstate.ts, pluginplan.ts).
import { rerender, showPage, state as app } from './app.ts';
import { button, emptyState, h, icon } from './dom.ts';
import { brandMark } from './brand.ts';
import { plural } from './model.ts';
import { pluginPage } from './pluginpage.ts';
import { dotted, pluginTitle, readme, toolBox } from './pluginparts.ts';
import { describe, pluginKey, queued, resultParts, resultSentence, succeeded, summary } from './pluginplan.ts';
import { cliMissing, stateOf, summaryOf, unavailable } from './pluginstatus.ts';
import { addMarketplace, applyPluginOps, browse, clearNotice, current, forgetMarketplace, market, openLink, pickMarketplaceFolder, refreshMarketplace, undoOps } from './pluginstate.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import type { MarketplaceView, PluginView, PluginsView } from './types.ts';
import { andList, toolNames as names } from './words.ts';

const when = (iso: string) => new Date(iso).toDateString() === new Date().toDateString() ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const titleOf = (entry: MarketplaceView) => entry.name || entry.sourceLabel;

/** The add box: open with no marketplaces yet, otherwise one "Add marketplace" button that opens it. */
function addBox(first: boolean) {
  if (!first && !market.addOpen) {
    return h('div.market-add', {}, button({ variant: 'ghost', size: 'small', icon: 'plus', label: 'Add marketplace', id: 'open-add-marketplace', disabled: !!app.busy,
      onclick: () => { market.addOpen = true; rerender(); requestAnimationFrame(() => document.getElementById('marketplace-source')?.focus()); } }));
  }
  const add = () => { if (market.draftSource.trim()) void addMarketplace(market.draftSource.trim()); };
  const input = h('input.market-add-input', { id: 'marketplace-source', type: 'text', placeholder: 'owner/repo, Git URL or folder', 'aria-label': 'Marketplace to add', spellcheck: 'false', value: market.draftSource,
    oninput: (event: Event) => { market.draftSource = (event.target as HTMLInputElement).value; const go = document.getElementById('add-marketplace') as HTMLButtonElement | null; if (go) go.disabled = !!app.busy || !market.draftSource.trim(); },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') add(); if (event.key === 'Escape' && !first) { market.addOpen = false; rerender(); } } });
  const close = first ? null : h('button.band-dismiss', { type: 'button', id: 'close-add-marketplace', 'aria-label': 'Close', title: 'Close', onclick: () => { market.addOpen = false; market.draftSource = ''; rerender(); } }, icon('x', 12));
  return h(`div.market-add.market-add-open${first ? '.market-add-first' : ''}`, {},
    h('div.market-add-head', {}, h('label.market-add-label', { for: 'marketplace-source' }, 'Add a marketplace'), close),
    input,
    h('div.market-add-actions', {},
      button({ variant: 'primary', size: 'small', label: 'Add', id: 'add-marketplace', disabled: !!app.busy || !market.draftSource.trim(), onclick: add }),
      button({ variant: 'outline', size: 'small', icon: 'folder-plus', label: 'Folder…', name: 'Choose a marketplace folder', id: 'pick-marketplace-folder', disabled: !!app.busy, onclick: () => void pickMarketplaceFolder().then(folder => { if (folder) void addMarketplace(folder); }) })));
}

/** Every marketplace, with how many plugins it lists, installed and chosen; the add box below. */
function marketList(view: PluginsView, shown?: MarketplaceView) {
  const item = (entry: MarketplaceView) => {
    const count = (test: (plugin: PluginView) => boolean) => entry.plugins.filter(test).length;
    const installedCount = count(plugin => view.tools.some(tool => stateOf(entry, plugin.name, tool).state === 'installed'));
    const chosen = count(plugin => view.tools.some(tool => queued(market.draft, entry.source, plugin.name, tool)));
    const meta = entry.problem && !entry.plugins.length ? 'Couldn’t be read' : [plural(entry.plugins.length, 'plugin'), installedCount ? `${installedCount} installed` : '', chosen ? `${chosen} chosen` : ''].filter(Boolean).join(' · ');
    return h('li', {}, h(`button.market-item${entry === shown ? '.selected' : ''}`, { type: 'button', 'aria-current': entry === shown ? 'true' : undefined, onclick: () => browse({ source: entry.source, plugin: undefined, tab: 'plugins', find: '', category: undefined }) },
      h('span.market-item-name', {}, titleOf(entry)), h('span.market-item-meta', {}, meta)));
  };
  return h('nav.market-list', { 'aria-label': 'Marketplaces' },
    view.marketplaces.length ? [h('h2.market-list-title', {}, 'Marketplaces'), h('ul', {}, view.marketplaces.map(item))] : null,
    addBox(!view.marketplaces.length));
}

/** One row per plugin: what it is and holds, and a box per tool. The row opens the plugin's page. */
function pluginRow(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView) {
  // A plugin kept elsewhere says what it holds once its files have been read; while reading, that; else where it lives.
  const read = market.details.get(pluginKey(entry.source, plugin.name));
  const readContents = read?.reading ? 'Reading what it holds…' : read?.value && !read.value.problem ? summaryOf(componentsFrom(read.value)) : '';
  const holds = plugin.components ? summaryOf(plugin.components) : readContents || (plugin.from ? `From ${plugin.from.label}` : '');
  const open = () => browse({ plugin: plugin.name });
  return h('div.ov-row.plugin-row', { role: 'row', 'data-plugin': plugin.name, onclick: open },
    h('div.ov-name.plugin-row-name', { role: 'cell' },
      h('button.plugin-row-open', { type: 'button', id: `popen-${marketIndex}-${plugin.name}`, 'aria-label': `Open ${pluginTitle(plugin)}`, onclick: (event: Event) => { event.stopPropagation(); open(); } },
        // The category pill is left out while that category is the filter: every row would say the same.
        h('span.plugin-row-title', {}, pluginTitle(plugin)), plugin.category && !market.nav.category ? h('span.plugin-chip', {}, plugin.category) : null),
      plugin.description ? h('span.plugin-row-about', { title: plugin.description }, plugin.description) : null,
      holds ? h('span.plugin-row-holds', {}, holds) : null),
    view.tools.map(tool => toolBox(view, entry, plugin, tool, marketIndex)),
    h('div.ov-cell.plugin-row-go', { role: 'cell', 'aria-hidden': 'true' }, icon('chevron-right', 14, 'tone-faint')));
}

/** Words to match: name, description, category and keywords. */
const matches = (plugin: PluginView, find: string) => !find || [plugin.name, plugin.displayName, plugin.description, plugin.category, ...(plugin.keywords ?? [])].some(text => text?.toLowerCase().includes(find.toLowerCase()));

function findBox(entry: MarketplaceView) {
  return h('input.market-find', { id: 'plugin-find', type: 'search', placeholder: `Find in ${plural(entry.plugins.length, 'plugin')}`, 'aria-label': 'Find plugins', value: market.nav.find,
    oninput: (event: Event) => {
      market.nav = { ...market.nav, find: (event.target as HTMLInputElement).value };
      rerender();
      // The redraw makes a new box; the caret goes back to where the person was typing.
      const box = document.getElementById('plugin-find') as HTMLInputElement | null;
      box?.setSelectionRange(box.value.length, box.value.length);
    } });
}

function categoryChips(entry: MarketplaceView, categories: string[]) {
  const count = (category?: string) => (category ? entry.plugins.filter(plugin => plugin.category === category).length : entry.plugins.length);
  return h('div.market-chips', { role: 'group', 'aria-label': 'Category' }, [undefined, ...categories].map(category =>
    h(`button.market-chip${market.nav.category === category ? '.selected' : ''}`, { type: 'button', 'aria-pressed': String(market.nav.category === category), onclick: () => browse({ category }) },
      category ?? 'All', h('span.market-chip-count', {}, String(count(category))))));
}

const categoriesOf = (entry: MarketplaceView) => [...new Set(entry.plugins.map(plugin => plugin.category).filter((category): category is string => !!category))].sort();

/** The find box (for more than 8 plugins) and category chips (for more than one category), shown in the toolbar. */
function filters(entry: MarketplaceView): HTMLElement | null {
  const categories = categoriesOf(entry);
  const parts = [entry.plugins.length > 8 ? findBox(entry) : null, categories.length > 1 ? categoryChips(entry, categories) : null].filter(Boolean) as HTMLElement[];
  return parts.length ? h('div.market-filter', {}, parts) : null;
}

function pluginsTab(view: PluginsView, entry: MarketplaceView, marketIndex: number) {
  const shown = entry.plugins.filter(plugin => matches(plugin, market.nav.find) && (!market.nav.category || plugin.category === market.nav.category));
  const someCan = view.canWrite && view.tools.some(tool => view.clis[tool]);
  const cannot = view.tools.filter(tool => !view.clis[tool]);
  const refusal = view.tools.includes('copilot-cli') && view.clis['copilot-cli'] ? entry.copilotRefuses : undefined;
  const head = h('div.ov-row.ov-head', { role: 'row' }, h('div.ov-name', { role: 'columnheader' }, someCan ? 'Click a tool’s box to choose it; nothing runs until Apply all.' : 'Plugin'),
    view.tools.map(tool => h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool]))), h('div.ov-cell.plugin-row-go', { role: 'columnheader' }));
  return [
    refusal ? h('p.market-hint', {}, icon('circle-alert', 13, 'tone-warning'), h('span', {}, `Copilot CLI can’t take this marketplace: ${refusal}`)) : null,
    cannot.length && someCan ? h('p.market-hint', {}, icon('circle-alert', 13, 'tone-warning'), h('span', {}, `${andList(cannot.map(cliMissing))}, so it can’t install there. `,
      button({ variant: 'link', size: 'micro', label: 'See Tools', id: `market-tools-${marketIndex}`, onclick: () => showPage('tools') }))) : null,
    shown.length
      ? withTools(view, h('div.ov.plugin-table', { role: 'table', 'aria-label': `Plugins in ${entry.name}` }, head, shown.map(plugin => pluginRow(view, entry, marketIndex, plugin))))
      : h('p.market-empty', {}, entry.plugins.length ? 'No plugin matches.' : entry.problem ? '' : 'This marketplace lists no plugins.'),
    shown.length ? legend(view, entry) : null,
  ];
}

function aboutTab(entry: MarketplaceView) {
  const read = market.readmes.get(entry.source);
  if (!read || read.reading) return h('p.plugin-muted', {}, 'Reading…');
  return read.value ? h('div.plugin-readme-body', {}, readme(read.value, entry.name, [entry.description ?? ''])) : h('p.plugin-muted', {}, 'This marketplace has no README.');
}

function marketPage(view: PluginsView, entry: MarketplaceView, marketIndex: number) {
  const plugin = openPlugin(entry);
  if (plugin) return pluginPage(view, entry, marketIndex, plugin);
  const remove = button({ variant: 'ghost', size: 'small', icon: 'circle-minus', label: 'Remove', name: `Remove ${titleOf(entry)} from this list. Installed plugins stay installed.`, id: `forget-${marketIndex}`, disabled: !!app.busy, onclick: () => void forgetMarketplace(entry.source) });
  remove.title = 'Removes it from this list only. Installed plugins stay installed.';
  // Where it was added is worth saying only when a tool added it; added here is the usual case, and installs register it too.
  const addedBy = entry.origins.includes('central-knot') ? [] : entry.origins.map(origin => names[origin as keyof typeof names]);
  const source = entry.page ? button({ variant: 'link', size: 'micro', label: entry.sourceLabel, id: `market-page-${marketIndex}`, onclick: () => openLink(entry.page!) }) : h('span', { title: entry.source }, entry.sourceLabel);
  const meta = dotted([entry.owner ? `By ${entry.owner}` : '', addedBy.length ? `Added in ${andList(addedBy)}` : '', entry.fetchedAt ? `Updated ${when(entry.fetchedAt)}` : '', source].filter(Boolean) as (string | HTMLElement)[]);
  return h('section.market-page', { 'aria-label': titleOf(entry) },
    h('header.market-page-head', {},
      h('div.market-page-title', {}, h('h2', {}, titleOf(entry)),
        h('div.market-page-actions', {},
          button({ variant: 'ghost', size: 'small', icon: 'refresh-cw', label: 'Refresh', id: `refresh-${marketIndex}`, disabled: !!app.busy, onclick: () => void refreshMarketplace(entry.source) }),
          entry.origins.includes('central-knot') ? remove : null)),
      entry.description ? h('p.market-page-about', {}, entry.description) : null,
      h('p.market-page-meta', {}, meta)),
    entry.problem ? h('div.band', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, entry.problem, entry.stale && entry.fetchedAt ? ` Showing the copy from ${when(entry.fetchedAt)}.` : '')) : null,
    h('div.market-tabs', { role: 'tablist' },
      (['plugins', 'about'] as const).map(tab => h(`button.market-tab${market.nav.tab === tab ? '.selected' : ''}`, { type: 'button', role: 'tab', id: `market-tab-${tab}`, 'aria-selected': String(market.nav.tab === tab), onclick: () => browse({ tab }) },
        tab === 'plugins' ? 'Plugins' : 'About'))),
    market.nav.tab === 'about' ? aboutTab(entry) : pluginsTab(view, entry, marketIndex));
}

/** What the boxes mean, only for the kinds on screen, and only when there is more than one to tell apart. */
function legend(view: PluginsView, entry: MarketplaceView) {
  const states = new Set(entry.plugins.flatMap(plugin => view.tools.map(tool => (unavailable(view, entry, plugin.name, tool) ? 'cannot' : stateOf(entry, plugin.name, tool).state))));
  const chosen = new Set(entry.plugins.flatMap(plugin => view.tools.map(tool => queued(market.draft, entry.source, plugin.name, tool))).filter(Boolean));
  if (states.size + chosen.size < 2) return null;
  const item = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  return h('div.legend.plugin-legend', { 'aria-label': 'Key' },
    states.has('installed') ? item('Installed', h('span.legend-cell.cell-synced.cell-on', {}, icon('check', 11))) : null,
    states.has('not-installed') ? item('Not installed', h('span.legend-cell.cell-absent', {}, icon('plus', 10))) : null,
    states.has('not-known') ? item('Unknown: the tool didn’t confirm the install', h('span.legend-cell.cell-differs', {}, icon('circle-question-mark', 11))) : null,
    states.has('cannot') ? item('Not available there', h('span.legend-cell.cell-cannot', {})) : null,
    chosen.size ? h('span.legend-lead', {}, 'On Apply all:') : null,
    chosen.has('install') ? item('installed', h('span.legend-cell.cell-pending.cell-chosen.cell-on', {}, icon('check', 10))) : null,
    chosen.has('remove') ? item('uninstalled', h('span.legend-cell.cell-pending.cell-pending-remove', {}, icon('x', 10))) : null);
}

/** Column count through the style object; the page's security policy refuses inline style attributes. */
function withTools(view: PluginsView, table: HTMLElement) {
  table.style.setProperty('--tool-count', String(view.tools.length));
  return table;
}

/** The way back from the last run, as a button: "Undo", or "Undo the rest" after an Undo that didn't finish. */
function undoButton(): HTMLElement | null {
  const back = undoOps();
  if (!back.length) return null;
  const undo = button({ variant: 'outline', size: 'small', label: market.lastRun?.undo ? 'Undo the rest' : 'Undo', id: 'plugins-undo', disabled: !!app.busy, onclick: () => void applyPluginOps(back, true) });
  undo.title = 'Reverses what changed, through each tool’s own command: uninstalls what was installed and reinstalls what was uninstalled.';
  return undo;
}

const dismiss = (onclick: () => void, id?: string) => h('button.band-dismiss', { type: 'button', id, 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => { onclick(); rerender(); } }, icon('x', 12));

/**
 * The toolbar's right side: what is chosen (with Discard and Apply all), or else what just happened (each plugin named a
 * link to its page, with Undo), or else the last notice ("… added"). Shown in place, so nothing on the page moves.
 */
function toolbarRight(): HTMLElement | null {
  const counts = summary(market.draft);
  if (counts.plugins) {
    return h('div.apply', {},
      h('span.apply-count.apply-quiet', { title: 'Nothing runs until Apply all' }, [`${plural(counts.plugins, 'plugin')} to change`, counts.installs ? plural(counts.installs, 'install') : '', counts.removals ? plural(counts.removals, 'uninstall') : ''].filter(Boolean).join(' · ')),
      button({ variant: 'ghost', size: 'small', label: 'Discard', id: 'plugins-discard', disabled: !!app.busy, onclick: () => { market.draft.clear(); rerender(); } }),
      button({ variant: 'primary', size: 'small', label: 'Apply all', id: 'plugins-apply', disabled: !!app.busy || !market.view?.canWrite, onclick: () => void applyPluginOps([...market.draft.values()]) }));
  }
  const last = market.lastRun;
  const lines = last ? describe(last.reports, names, andList, last.undo) : [];
  const parts = last ? resultParts(lines, last.undo) : [];
  if (last && parts.length) {
    const sentence = parts.map((part, at) => (typeof part === 'string' ? part
      : h('button.result-link', { type: 'button', id: `result-plugin-${at}`, title: `Open ${part.plugin}`, onclick: () => browse({ source: part.source, plugin: part.plugin, tab: 'plugins' }) }, part.plugin)));
    return h('div.toolbar-result', { role: 'status', id: 'plugins-result' }, icon('check', 14, 'tone-success'),
      h('span.toolbar-result-text', { title: resultSentence(lines, last.undo) }, sentence), undoButton(), dismiss(() => { market.lastRun = undefined; }, 'report-dismiss'));
  }
  const outcome = app.outcome?.page === 'plugins' ? app.outcome : undefined;
  if (!outcome) return null;
  const action = outcome.act ? button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, disabled: !!app.busy, onclick: () => outcome.act!.run() }) : null;
  return h('div.toolbar-result', { role: 'status', id: 'plugins-result' }, icon('check', 14, 'tone-success'), h('span.toolbar-result-text', { title: outcome.text }, outcome.text), action, dismiss(clearNotice, 'report-dismiss'));
}

/**
 * What went wrong in the last run, or why a marketplace couldn't be added: a band, because it needs reading. When
 * nothing in the run succeeded, its Undo (if any) is here, since the toolbar has no result to put it beside.
 */
function problemBand() {
  const last = market.lastRun;
  const lines = last ? describe(last.reports, names, andList, last.undo) : [];
  const failures = lines.filter(line => !line.ok);
  if (!market.problem && !failures.length) return null;
  const undo = lines.some(line => line.ok) ? null : undoButton();
  return h('div.band.plugin-problems', { role: 'alert' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text.band-lines', {}, failures.map(line => h('span', {}, h('strong.item-name', {}, line.plugin), `: ${line.text}`)), market.problem ? h('span', {}, market.problem) : null),
    undo,
    dismiss(() => { market.problem = undefined; if (last) market.lastRun = { ...last, reports: last.reports.filter(entry => succeeded(entry.report)) }; }));
}

/** The plugin whose page is open in this marketplace, if one is. */
const openPlugin = (entry: MarketplaceView) => (market.nav.plugin ? entry.plugins.find(candidate => candidate.name === market.nav.plugin) : undefined);

/**
 * The toolbar, always there so the page never jumps: at the left, where the person is inside a plugin (team-tools ›
 * document-tools), or the marketplace's filters; at the right, toolbarRight.
 */
function toolbar(shown?: MarketplaceView) {
  const plugin = shown && openPlugin(shown);
  const left = shown && plugin
    ? h('nav.market-crumbs', { 'aria-label': 'You are here' },
      h('button.crumb-link', { type: 'button', id: 'plugin-back', onclick: () => browse({ plugin: undefined }) }, icon('arrow-left', 13), titleOf(shown)),
      icon('chevron-right', 12, 'tone-faint'), h('span.crumb-here', {}, pluginTitle(plugin)))
    : shown && market.nav.tab === 'plugins' ? filters(shown) : null;
  return h('div.toolbar.plugins-toolbar', {}, left, h('span.toolbar-spacer'), toolbarRight());
}

/** Public marketplaces to try from the empty page; a click adds one (adding installs nothing). */
const EXAMPLES = ['anthropics/skills', 'github/copilot-plugins'];

const activityText: Record<NonNullable<typeof market.activity>, string> = {
  reading: 'Reading marketplaces… Nothing is installed by this.', adding: 'Reading the marketplace… Nothing is installed by this.', refreshing: 'Refreshing the marketplace… Nothing is installed by this.',
  removing: 'Removing from the list…', applying: 'Applying… Each change runs that tool’s own command and can take a few seconds.', undoing: 'Undoing… Each change runs that tool’s own command and can take a few seconds.',
};

export function pluginsPage() {
  const view = market.view;
  if (!view) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, market.activity ? 'Reading marketplaces…' : 'Marketplaces could not be read.')));
  const shown = current();
  return h('div.page.plugins-page', {},
    toolbar(shown?.entry),
    h('div.bands', {},
      view.canWrite ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.reason ?? 'Preview only here.')),
      market.activity && market.activity !== 'reading' ? h('div.band', { role: 'status' }, icon('refresh-cw', 14, 'spin tone-muted'), h('span.band-text', {}, activityText[market.activity])) : null,
      problemBand()),
    h('div.market-layout', {},
      marketList(view, shown?.entry),
      h('div.scroll.market-main', { id: 'plugins-scroll' },
        shown
          ? marketPage(view, shown.entry, shown.index)
          : emptyState('puzzle', 'No marketplaces yet', 'A marketplace is a Git repository or folder that lists plugins. Adding one installs nothing.',
            h('div', {},
              h('div.market-examples', {}, h('span', {}, 'Try one:'), EXAMPLES.map(example => h('button.market-example', { type: 'button', disabled: !!app.busy, onclick: () => void addMarketplace(example) }, example))),
              h('p.empty-aside', {}, 'Marketplaces you added in Claude Code, Copilot CLI or Codex show up here by themselves.'))))));
}
