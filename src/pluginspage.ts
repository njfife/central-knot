// Plugins: browse marketplaces, choose which plugins go to which tools, then Apply all.
// The list of marketplaces sits at the left; the chosen one shows its plugins or its README, and a plugin opens its own page
// (pluginpage.ts). Boxes only choose changes; Apply all runs them (pluginstate.ts, pluginplan.ts).
import { announce, noTools, rerender, showPage, state as app } from './app.ts';
import { noToolsState } from './pages.ts';
import { button, closeButton, emptyState, h, icon, pendingCount, rereadBand, withToolCount } from './dom.ts';
import { brandMark } from './brand.ts';
import { clockTime, plural } from './model.ts';
import { pluginPage } from './pluginpage.ts';
import { componentsOf, dotted, pluginTitle, readme, toolBox, updateButton, updateOps, versionNote } from './pluginparts.ts';
import { allQueued, resultLines, pickOf, pluginKey, queued, resultParts, resultSentence, summary, toggleMany, type ResultLine } from './pluginplan.ts';
import { FIND_FROM, blocked, categoriesOf, copyStale, installed, marketTitle, noLongerOffered, offeredVersion, otherVersions, otherVersionsLine, partsMark, partsOf, partsOffer, stateOf, summaryOf, unavailable, updateTools, versionToCompare } from './pluginstatus.ts';
import { ACTIVITIES, addMarketplace, applyPluginOps, browse, clearNotice, current, dismissProblems, forgetMarketplace, market, openLink, pickMarketplaceFolder, shownDetail, shownPlugins, undoOps } from './pluginstate.ts';
import { takesPlugins } from './presence.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { pluginUpdateNotes } from './pluginupdateview.ts';
import type { MarketplaceView, PluginView, PluginsView } from './types.ts';
import { andList, orList, toolName, toolNames as names } from './words.ts';

/** "9:20 AM" today, else "Nov 8". */
const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? clockTime(iso) : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

/** The add box: open with no marketplaces yet, otherwise one "Add marketplace" button that opens it. */
function addBox(first: boolean) {
  if (!first && !market.addOpen) {
    return h('div.market-add', {}, button({ variant: 'ghost', size: 'small', icon: 'plus', label: 'Add marketplace', id: 'open-add-marketplace', disabled: !!app.busy,
      onclick: () => { market.addOpen = true; rerender(); requestAnimationFrame(() => document.getElementById('marketplace-source')?.focus()); } }));
  }
  // One add at a time: Enter while one is being read does nothing (the box is disabled then too).
  const add = () => { if (!app.busy && market.draftSource.trim()) void addMarketplace(market.draftSource.trim()); };
  const input = h('input.market-add-input', { id: 'marketplace-source', type: 'text', disabled: !!app.busy, placeholder: 'owner/repo, Git URL or folder', 'aria-label': 'Marketplace to add', spellcheck: 'false', value: market.draftSource,
    oninput: (event: Event) => { market.draftSource = (event.target as HTMLInputElement).value; const go = document.getElementById('add-marketplace') as HTMLButtonElement | null; if (go) go.disabled = !!app.busy || !market.draftSource.trim(); },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') add(); if (event.key === 'Escape' && !first) { market.addOpen = false; rerender(); } } });
  const close = first ? null : closeButton(() => { market.addOpen = false; market.draftSource = ''; rerender(); }, { id: 'close-add-marketplace', label: 'Close' });
  return h(`div.market-add.market-add-open${first ? '.market-add-first' : ''}`, {},
    h('div.market-add-head', {}, h('label.market-add-label', { for: 'marketplace-source' }, 'Add a marketplace'), close),
    input,
    h('div.market-add-actions', {},
      button({ variant: 'primary', size: 'small', label: 'Add', id: 'add-marketplace', disabled: !!app.busy || !market.draftSource.trim(), onclick: add }),
      button({ variant: 'outline', size: 'small', icon: 'folder-plus', label: 'Folder…', name: 'Choose a marketplace folder', id: 'pick-marketplace-folder', disabled: !!app.busy, onclick: () => void pickMarketplaceFolder().then(folder => { if (folder) void addMarketplace(folder); }) })));
}

/** Every marketplace, with how many plugins it lists, installed and chosen; the add box below. */
function marketList(view: PluginsView, shown: MarketplaceView) {
  const item = (entry: MarketplaceView) => {
    const count = (test: (plugin: PluginView) => boolean) => entry.plugins.filter(test).length;
    const installedCount = count(plugin => view.tools.some(tool => installed(entry, plugin.name, tool)));
    const partsCount = count(plugin => view.tools.some(tool => !!partsOf(entry, plugin.name, tool)));
    const chosen = count(plugin => view.tools.some(tool => queued(market.draft, entry.source, plugin.name, tool)));
    const meta = entry.problem && !entry.plugins.length ? 'Couldn’t be read' : [plural(entry.plugins.length, 'plugin'), installedCount ? `${installedCount} installed` : '', partsCount ? `${partsCount} with parts` : '', chosen ? `${chosen} chosen` : ''].filter(Boolean).join(' · ');
    return h('li', {}, h(`button.market-item${entry === shown ? '.selected' : ''}`, { type: 'button', title: `${marketTitle(entry)} · ${meta}`, 'aria-current': entry === shown ? 'true' : undefined, onclick: () => browse({ source: entry.source, plugin: undefined, tab: 'plugins', find: '', category: undefined }) },
      h('span.market-item-name', {}, marketTitle(entry)), h('span.market-item-meta', {}, meta)));
  };
  return h('nav.market-list', { 'aria-label': 'Marketplaces' },
    h('h2.market-list-title', {}, 'Marketplaces'), h('ul', {}, view.marketplaces.map(item)), addBox(false));
}

/** One row per plugin: what it is and holds, and a box per tool. The row opens the plugin's page. */
function pluginRow(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView) {
  // A plugin kept elsewhere says what it holds once its files have been read; while reading, that; else where it lives.
  const key = pluginKey(entry.source, plugin.name);
  const detail = shownDetail(key);
  const reading = market.details.get(key);
  const readContents = detail === undefined && reading?.reading && !reading.quiet ? 'Reading what it holds…' : detail?.offered ? summaryOf(componentsFrom(detail)) : '';
  const offered = offeredVersion(plugin, detail);
  const holds = plugin.components ? summaryOf(plugin.components) : readContents || (plugin.from ? `From ${plugin.from.label}` : '');
  // A tool on another version than the marketplace offers is named on the row, so it shows without opening the plugin.
  const compareTo = versionToCompare(plugin, detail);
  const others = otherVersions(view, entry, plugin.name, compareTo);
  const updates = view.canWrite ? updateOps(view, entry, plugin) : [];
  const partsBehind = [...new Set(updates.filter(op => op.action === 'install-parts').map(op => names[op.tool]))];
  const differing = view.tools.filter(tool => copyStale(entry, plugin.name, tool, compareTo, detail)).map(tool => names[tool]);
  const behind = [others.length ? otherVersionsLine(others) : '', differing.length ? `${andList(differing)} ${differing.length > 1 ? 'differ' : 'differs'} from the marketplace’s copy` : '',
    partsBehind.length ? `parts out of date in ${andList(partsBehind)}` : ''].filter(Boolean).join(', ');
  const open = () => browse({ plugin: plugin.name });
  return h('div.ov-row.plugin-row', { role: 'row', 'data-plugin': plugin.name, onclick: open },
    h('div.ov-name.plugin-row-name', { role: 'cell' },
      h('button.plugin-row-open', { type: 'button', id: `popen-${marketIndex}-${plugin.name}`, 'aria-label': `Open ${pluginTitle(plugin)}`, onclick: (event: Event) => { event.stopPropagation(); open(); } },
        // The category pill is left out while that category is the filter: every row would say the same.
        h('span.plugin-row-title', {}, pluginTitle(plugin)), offered ? h('span.plugin-row-version', { title: 'The version the marketplace offers' }, offered) : null,
        noLongerOffered(entry, plugin) ? h('span.plugin-chip.plugin-chip-gone', {}, 'No longer offered') : null,
        plugin.category && !market.nav.category ? h('span.plugin-chip', {}, plugin.category) : null),
      // The description first, then what it holds: when room runs out the description shortens or steps aside (style.css).
      plugin.description || holds ? h('span.plugin-row-line', {},
        plugin.description ? h('span.plugin-row-about', { title: plugin.description }, plugin.description) : null,
        plugin.description && holds ? h('span.plugin-row-sep', { 'aria-hidden': 'true' }, '·') : null,
        holds ? h('span.plugin-row-holds', { title: holds }, holds) : null) : null,
      // A tool on another version or with another copy, on its own line under that, with Update for every tool that is behind.
      behind || updates.length ? h('span.plugin-row-update', {},
        behind ? versionNote(h('span', {}, behind.charAt(0).toUpperCase() + behind.slice(1)), '.plugin-row-warning') : null,
        updates.length ? updateButton(updates, `pupdate-${marketIndex}-${plugin.name}`, { row: true }) : null) : null),
    view.tools.map(tool => toolBox(view, entry, plugin, tool, marketIndex, compareTo)),
    h('div.ov-cell.plugin-row-go', { role: 'cell', 'aria-hidden': 'true' }, icon('chevron-right', 14, 'tone-faint')));
}

function findBox(entry: MarketplaceView) {
  return h('input.market-find', { id: 'plugin-find', type: 'search', placeholder: `Find in ${plural(entry.plugins.length, 'plugin')}`, 'aria-label': 'Find plugins', value: market.nav.find,
    oninput: (event: Event) => {
      browse({ find: (event.target as HTMLInputElement).value });
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

/** The find box (for more than 8 plugins) and category chips (for more than one category), above the plugin table. */
function filters(entry: MarketplaceView): HTMLElement | null {
  const categories = categoriesOf(entry);
  const parts = [entry.plugins.length > FIND_FROM ? findBox(entry) : null, categories.length > 1 ? categoryChips(entry, categories) : null].filter(Boolean) as HTMLElement[];
  return parts.length ? h('div.market-filter', {}, parts) : null;
}

function pluginsTab(view: PluginsView, entry: MarketplaceView, marketIndex: number) {
  const shown = shownPlugins(entry);
  // One hint line per tool that can't take this marketplace, in the words its boxes use (pluginstatus.blocked).
  // A tool that takes no plugins at all (Pi) explains itself in its own boxes and the key: it is no hint here.
  const pluginColumns = view.tools.filter(tool => takesPlugins(tool));
  // Tools whose CLI is missing share one sentence; any other reason is said as it is.
  const noCli = pluginColumns.filter(tool => !view.clis[tool] && !view.desktopOnly?.[tool]);
  const reasons = [noCli.length > 1 ? `${andList(noCli.map(tool => names[tool]))}: command-line tools not found, so plugins can’t be installed there.` : '',
    ...pluginColumns.filter(tool => noCli.length < 2 || !noCli.includes(tool)).map(tool => blocked(view, entry, tool) ?? '')].filter(Boolean);
  const someCan = view.canWrite && (pluginColumns.some(tool => !blocked(view, entry, tool)) || view.tools.length > pluginColumns.length);
  // The hint heads the name column, wrapping within it when the column is narrow.
  const head = h('div.ov-row.ov-head', { role: 'row' }, h('div.ov-name.plugin-hint', { role: 'columnheader' }, someCan ? [h('span.hint-long', {}, 'Click a box; nothing runs until Apply all.'), h('span.hint-short', {}, 'Nothing runs until Apply all.'), h('span.hint-plain', {}, 'Plugin')] : 'Plugin'),
    view.tools.map(tool => h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool]))), h('div.ov-cell.plugin-row-go', { role: 'columnheader' }));
  // Where a box offers a plugin's parts, the hint says so above the rows, where the choice is made.
  const partsColumns = view.tools.filter(tool => shown.some(plugin => partsOffer(view, entry, plugin.name, tool, componentsOf(entry, plugin)) && !partsOf(entry, plugin.name, tool)));
  const partsHint = partsColumns.length ? `A hatched box with a plus (${andList(partsColumns.map(tool => names[tool]))}) installs the plugin’s parts instead, as separate items.` : '';
  // With more than one plugin behind, one button chooses every update in this marketplace.
  const behind = view.canWrite ? entry.plugins.filter(plugin => updateOps(view, entry, plugin).length) : [];
  const allUpdates = behind.flatMap(plugin => updateOps(view, entry, plugin));
  const updateAll = behind.length > 1 ? h('p.market-hint', {}, icon('refresh-cw', 13, 'tone-warning'), h('span', {}, `${behind.length} plugins have an update. `,
    button({ variant: 'link', size: 'micro', id: `market-update-all-${marketIndex}`, label: allQueued(market.draft, allUpdates) ? 'Don’t update them' : 'Update all', onclick: () => { toggleMany(market.draft, allUpdates); clearNotice(); rerender(); } }))) : null;
  return [
    reasons.length && someCan ? h('p.market-hint', {}, icon('circle-alert', 13, 'tone-warning'), h('span', {}, `${[...reasons, partsHint].filter(Boolean).join(' ')} `,
      button({ variant: 'link', size: 'micro', label: 'See Harnesses', id: `market-tools-${marketIndex}`, onclick: () => showPage('harnesses') })))
      : partsHint && view.canWrite ? h('p.market-hint', {}, icon('info', 13, 'tone-muted'), h('span', {}, partsHint)) : null,
    updateAll,
    shown.length
      ? withToolCount(h('div.ov.plugin-table', { role: 'table', 'aria-label': `Plugins in ${entry.name}` }, head, shown.map(plugin => pluginRow(view, entry, marketIndex, plugin))), view.tools.length)
      : h('p.market-empty', {}, entry.plugins.length ? 'No plugin matches.' : entry.problem ? '' : 'This marketplace lists no plugins.'),
    shown.length ? legend(view, entry) : null,
  ];
}

/** About a marketplace: every fact about it (who, where it comes from, when it was read), Remove, then its README. */
function aboutTab(entry: MarketplaceView, marketIndex: number) {
  const read = market.readmes.get(entry.source);
  // Parts are removed together from their plugin's page, so a marketplace stays listed while any of its plugins' parts are in a tool.
  const holdsParts = Object.keys(entry.parts ?? {}).length > 0;
  const remove = entry.origins.includes('central-knot') ? button({ variant: 'outline', size: 'small', icon: 'circle-minus', label: 'Remove from this list', name: `Remove ${marketTitle(entry)} from this list. Installed plugins stay installed.`, id: `forget-${marketIndex}`, disabled: !!app.busy || holdsParts, onclick: () => void forgetMarketplace(entry.source) }) : null;
  if (remove) remove.title = holdsParts ? 'Some of its plugins’ parts are in your tools. Remove those parts first; they are removed together from each plugin’s page.' : 'Removes it from this list only. Installed plugins stay installed.';
  const source = entry.page ? button({ variant: 'link', size: 'micro', label: entry.sourceLabel, id: `market-page-${marketIndex}`, onclick: () => openLink(entry.page!) }) : h('span', { title: entry.source }, entry.sourceLabel);
  return [
    // In narrow content the description is said here only (style.css), so the plugins get the height on their tab.
    entry.description ? h('p.market-page-about.about-only-narrow', {}, entry.description) : null,
    h('div.market-about-head', {}, h('p.market-page-meta', {}, dotted([...marketFacts(entry), source])), remove),
    !read || read.reading ? h('p.plugin-muted', {}, 'Reading…')
      : read.value ? h('div.plugin-readme-body', {}, readme(read.value, entry.name, [entry.description ?? ''])) : h('p.plugin-muted', {}, 'This marketplace has no README.'),
  ];
}

/** Who made a marketplace, which tools added it (said only when Central Knot didn't), and when it was read. */
function marketFacts(entry: MarketplaceView): string[] {
  const addedBy = entry.origins.includes('central-knot') ? [] : entry.origins.map(toolName);
  return [entry.owner ? `By ${entry.owner}` : '', addedBy.length ? `Added in ${andList(addedBy)}` : '', entry.fetchedAt ? `Updated ${when(entry.fetchedAt)}` : ''].filter(Boolean);
}

function marketPage(view: PluginsView, entry: MarketplaceView, marketIndex: number) {
  const plugin = openPlugin(entry);
  if (plugin) return pluginPage(view, entry, marketIndex, plugin);
  // Compact, so the plugins themselves get the height: its name and facts are on the toolbar's row (titleLine), every fact
  // and Remove under About, the filters on the tab row. The header's Refresh fetches every marketplace again.
  return h('section.market-page', { 'aria-label': marketTitle(entry) },
    entry.description ? h('p.market-page-about', { title: entry.description }, entry.description) : null,
    entry.problem ? h('div.band', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, entry.problem, entry.stale && entry.fetchedAt ? ` Showing the copy from ${when(entry.fetchedAt)}.` : '')) : null,
    h('div.market-tabs', {},
      h('div.market-tablist', { role: 'tablist' },
        (['plugins', 'about'] as const).map(tab => h(`button.market-tab${market.nav.tab === tab ? '.selected' : ''}`, { type: 'button', role: 'tab', id: `market-tab-${tab}`, 'aria-selected': String(market.nav.tab === tab), onclick: () => browse({ tab }) },
          tab === 'plugins' ? 'Plugins' : 'About'))),
      market.nav.tab === 'about' ? null : filters(entry)),
    market.nav.tab === 'about' ? aboutTab(entry, marketIndex) : pluginsTab(view, entry, marketIndex));
}

/**
 * What the boxes mean, only for marks on screen that need saying: a plus and a check explain themselves, so the key names
 * only "unknown", "not available" and what Apply all will do.
 */
function legend(view: PluginsView, entry: MarketplaceView) {
  const markOf = (plugin: PluginView, tool: Parameters<typeof unavailable>[3]) => {
    const mark = partsMark(view, entry, plugin.name, tool, componentsOf(entry, plugin));
    if (mark) return ({ changed: 'parts-changed', installed: 'parts', offer: 'parts-offer' } as const)[mark];
    const detail = shownDetail(pluginKey(entry.source, plugin.name));
    if (updateTools(view, entry, plugin.name, versionToCompare(plugin, detail), undefined, detail).plugin.includes(tool)) return 'outdated';
    return unavailable(view, entry, plugin.name, tool) ? 'cannot' : stateOf(entry, plugin.name, tool).state;
  };
  const marks = new Set(entry.plugins.flatMap(plugin => view.tools.map(tool => markOf(plugin, tool))));
  const chosen = new Set(entry.plugins.flatMap(plugin => view.tools.flatMap(tool => [queued(market.draft, entry.source, plugin.name, tool), pickOf(market.draft, entry.source, plugin.name, tool) ? 'pick-parts' as const : undefined])).filter(Boolean));
  const unknown = marks.has('not-known');
  const cannot = marks.has('cannot');
  const parts = (['parts-offer', 'parts', 'parts-changed'] as const).filter(mark => marks.has(mark));
  const behind = marks.has('outdated') || marks.has('parts-changed');
  if (!unknown && !cannot && !parts.length && !behind && !chosen.size) return null;
  const item = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  return h('div.legend.plugin-legend', { 'aria-label': 'Key' },
    unknown ? item('Unknown: the tool didn’t confirm the install', h('span.legend-cell.cell-differs', {}, icon('circle-question-mark', 11))) : null,
    cannot ? item('Not available there', h('span.legend-cell.cell-cannot', {})) : null,
    marks.has('parts-offer') ? item('Install its parts instead', h('span.legend-cell.cell-parts-offer', {}, icon('plus', 9))) : null,
    marks.has('parts') ? item('Parts installed', h('span.legend-cell.cell-synced.cell-on', {}, icon('blocks', 10))) : null,
    // A plugin and its parts out of date are one idea: the same box, the same words.
    behind ? item('Out of date: click to update', h('span.legend-cell.cell-differs.cell-on', {}, icon('refresh-cw', 10))) : null,
    chosen.size ? h('span.legend-group', {}, h('span.legend-lead', {}, 'On Apply all:'),
      chosen.has('install') ? item('installed', h('span.legend-cell.cell-pending.cell-chosen.cell-on', {}, icon('check', 10))) : null,
      chosen.has('install-parts') ? item('parts installed', h('span.legend-cell.cell-pending.cell-chosen.cell-on', {}, icon('blocks', 10))) : null,
      chosen.has('pick-parts') && !chosen.has('install-parts') ? item('single parts changed', h('span.legend-cell.cell-pending.cell-chosen.cell-on', {}, icon('blocks', 10))) : null,
      chosen.has('update') ? item('updated', h('span.legend-cell.cell-pending.cell-chosen.cell-on', {}, icon('refresh-cw', 10))) : null,
      chosen.has('remove') ? item('uninstalled', h('span.legend-cell.cell-pending.cell-pending-remove', {}, icon('x', 10))) : null,
      chosen.has('remove-parts') ? item('parts removed', h('span.legend-cell.cell-pending.cell-pending-remove', {}, icon('x', 10))) : null) : null);
}

/** The way back from the last run, as a button: "Undo", or "Undo the rest" after an Undo that didn't finish. */
function undoButton(): HTMLElement | null {
  const back = undoOps();
  if (!back.length) return null;
  const undo = button({ variant: 'outline', size: 'small', label: market.lastRun?.undo ? 'Undo the rest' : 'Undo', id: 'plugins-undo', disabled: !!app.busy, onclick: () => void applyPluginOps(back, true) });
  undo.title = 'Reverses what changed, through each tool’s own command or switch: uninstalls what was installed, reinstalls what was uninstalled and turns each skill back as it was.';
  return undo;
}

const dismiss = (onclick: () => void, id?: string) => closeButton(() => { onclick(); rerender(); }, { id });

/**
 * The toolbar's right side: what is chosen (with Discard and Apply all), or else what just happened (each plugin named a
 * link to its page, with Undo), or else the last notice ("… added"). Shown in place, so nothing on the page moves.
 */
function toolbarRight(lines: ResultLine[]): HTMLElement | null {
  // Parts chosen where some are already there are an update; elsewhere an install.
  const counts = summary(market.draft, op => { const entry = market.view?.marketplaces.find(candidate => candidate.source === op.source); return !!entry && !!partsOf(entry, op.plugin, op.tool); });
  if (market.draft.size) {
    // "1 skill to turn off in 2 tools": a skill is counted once, however many tools it changes in.
    const switches = ({ skills, tools }: { skills: number; tools: number }, verb: string) => (skills ? `${plural(skills, 'skill')} to turn ${verb}${tools > 1 ? ` in ${tools} tools` : ''}` : '');
    const pending = [counts.plugins ? plural(counts.plugins, 'change') : '', counts.installs ? plural(counts.installs, 'install') : '', counts.updates ? plural(counts.updates, 'update') : '', counts.removals ? plural(counts.removals, 'uninstall') : '',
      counts.partsInstalls ? `install parts in ${plural(counts.partsInstalls, 'tool')}` : '', counts.partsUpdates ? `update parts in ${plural(counts.partsUpdates, 'tool')}` : '', counts.partsRemovals ? `remove parts from ${plural(counts.partsRemovals, 'tool')}` : '',
      counts.partsOn ? `${plural(counts.partsOn, 'part')} to add` : '', counts.partsOff ? `${plural(counts.partsOff, 'part')} to take out` : '',
      switches(counts.skillsOff, 'off'), switches(counts.skillsOn, 'on')].filter(Boolean).join(' · ');
    return h('div.apply', {},
      // Narrow, the toolbar has nothing else at its left: the hint the table's header gives up sits there (style.css).
      h('span.apply-hint', {}, 'Nothing runs until Apply all.'),
      pendingCount(pending, plural(market.draft.size, 'change')),
      button({ variant: 'ghost', size: 'small', label: 'Discard', name: 'Discard these changes', id: 'plugins-discard', disabled: !!app.busy, onclick: () => { market.draft.clear(); announce('Changes discarded. Nothing was installed or removed.'); rerender(); } }),
      button({ variant: 'primary', size: 'small', label: 'Apply all', id: 'plugins-apply', disabled: !!app.busy || !market.view?.canWrite, attrs: { title: `${pending}. Nothing runs until Apply all.` }, onclick: () => void applyPluginOps([...market.draft.values()]) }));
  }
  // A result is said here only while it offers something to do (Undo, or its own button); one that only tells is in the
  // status bar (app.ts saidInStatusBar).
  const last = market.lastRun;
  const back = undoButton();
  const open = current()?.entry;
  const parts = last ? resultParts(lines, last.undo, { short: true, here: open && market.nav.plugin ? { plugin: market.nav.plugin, source: open.source } : undefined }) : [];
  if (last && parts.length && back) {
    const link = (part: { plugin: string; source: string }, at: number) =>
      h('button.result-link', { type: 'button', id: `result-plugin-${at}`, title: `Open ${part.plugin}`, onclick: () => browse({ source: part.source, plugin: part.plugin, tab: 'plugins' }) }, part.plugin);
    // On another plugin's page the result is only named, so it never reads as being about the plugin on screen; an
    // Undo still says it was undone.
    // Once the tools were read again (Refresh) the run is only named, so its sentence never contradicts what the page now shows.
    const elsewhere = last.reread || (market.nav.plugin && !lines.some(line => line.plugin === market.nav.plugin));
    // Each plugin the run changed, once, whether or not the sentence names it (it leaves out the plugin on screen).
    const changed = [...new Map(lines.filter(line => line.ok).map(line => [pluginKey(line.source, line.plugin), { plugin: line.plugin, source: line.source }])).values()];
    const sentence = elsewhere
      ? [last.undo ? 'Undone: ' : 'Last change: ', ...changed.flatMap((part, at) => [at ? ', ' : '', link(part, at)])]
      : parts.map((part, at) => (typeof part === 'string' ? part : link(part, at)));
    return h('div.toolbar-result', { role: 'status', id: 'plugins-result' }, icon('check', 14, 'tone-success'),
      h('span.toolbar-result-text', { title: resultSentence(lines, last.undo) }, sentence), back, dismiss(() => { market.lastRun = undefined; }, 'report-dismiss'));
  }
  // An Undo that undid nothing still offers its way back here, whether or not its failures are still shown.
  if (last && back) return h('div.toolbar-result', { role: 'status', id: 'plugins-result' }, h('span.toolbar-result-text', {}, 'Not everything was undone.'), back, dismiss(() => { market.lastRun = undefined; }, 'report-dismiss'));
  const outcome = app.outcome?.page === 'plugins' && app.outcome.act ? app.outcome : undefined;
  if (!outcome?.act) return null;
  const action = button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, disabled: !!app.busy, onclick: () => outcome.act!.run() });
  return h('div.toolbar-result', { role: 'status', id: 'plugins-result', 'data-outcome': '' }, icon('check', 14, 'tone-success'), h('span.toolbar-result-text', { title: outcome.text }, outcome.text), action, dismiss(clearNotice, 'report-dismiss'));
}

/** What went wrong in the last run, or why a marketplace couldn't be added: a band, because it needs reading. */
function problemBand(lines: ResultLine[]) {
  const failures = market.lastRun?.problemsClosed ? [] : lines.filter(line => !line.ok);
  if (!market.problem && !failures.length) return null;
  return h('div.band.plugin-problems', { role: 'alert' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text.band-lines', {}, failures.map(line => h('span', {}, h('strong.item-name', {}, line.plugin), `: ${line.text}`)), market.problem ? h('span', {}, market.problem) : null),
    dismiss(dismissProblems));
}

/** The plugin whose page is open in this marketplace, if one is. */
const openPlugin = (entry: MarketplaceView) => (market.nav.plugin ? entry.plugins.find(candidate => candidate.name === market.nav.plugin) : undefined);

/**
 * The toolbar over the marketplace pane (beside the list of marketplaces, which runs the full height): where the person is
 * inside a plugin (← team-tools › document-tools) at the left, toolbarRight at the right. It shows only when it has one of
 * them, so an empty strip never stands above the marketplace; with no marketplaces it spans the page.
 */
function toolbar(shown: { entry: MarketplaceView; index: number } | undefined, lines: ResultLine[]) {
  const right = toolbarRight(lines);
  if (!shown) return right ? h('div.toolbar.plugins-toolbar.fit-bar', {}, h('span.toolbar-spacer'), right) : null;
  const plugin = openPlugin(shown.entry);
  const left = plugin
    ? h('nav.market-crumbs', { 'aria-label': 'You are here' },
      h('button.crumb-link', { type: 'button', id: 'plugin-back', onclick: () => browse({ plugin: undefined }) }, icon('arrow-left', 13), marketTitle(shown.entry)),
      icon('chevron-right', 12, 'tone-faint'), h('span.crumb-here', {}, pluginTitle(plugin)))
    : titleLine(shown.entry);
  // In narrow content the marketplace strip already names it, so a toolbar with only the name isn't drawn (style.css).
  return h(`div.toolbar.plugins-toolbar.fit-bar${!plugin && !right ? '.toolbar-title-only' : ''}`, {}, left, h('span.toolbar-spacer'), right);
}

/**
 * The marketplace's name, then who made it and when it was read: the left of the toolbar's row on its page, so a result
 * at the right shares the row instead of taking a band of its own. The facts drop whole, the last first, and only then
 * does the name shorten (style.css); About has them all, with where it comes from.
 */
function titleLine(entry: MarketplaceView) {
  const name = marketTitle(entry);
  return h('div.market-title-line', {}, h('h2', { title: name }, name), marketFacts(entry).map(fact => h('span.market-fact', {}, fact)));
}

/** Public marketplaces to try from the empty page; a click adds one (adding installs nothing). */
const EXAMPLES = ['anthropics/skills', 'github/copilot-plugins'];


export function pluginsPage() {
  const view = market.view;
  // From the marketplaces' own read (pagedata.ts): what it found, else that it is reading or could not read.
  if (!view) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, market.read.state === 'failed' ? 'Marketplaces could not be read.' : 'Reading marketplaces…')));
  // A home with no tools: another home is the way forward.
  if (noTools()) return h('div.page', {}, noToolsState('plugins-choose-home'));
  // Tools, but none that takes plugins (only Pi): the sidebar hides Plugins then, so this is a marketplace read that saw a plugin tool go before the home's read did.
  if (!view.tools.length) return h('div.page', {}, emptyState('puzzle', 'No tool in this home can install plugins', 'None of the tools found here takes plugins. Once one is installed, Central Knot finds it on its own, or at once with Refresh at the top.',
    button({ variant: 'outline', label: 'See Harnesses', id: 'plugins-no-tools', onclick: () => showPage('harnesses') })));
  const shown = current();
  const lines = market.lastRun ? resultLines(market.lastRun.done, market.lastRun.undo) : [];
  // With no marketplaces, adding one is the only thing to do: its box sits in the middle of the page, with examples.
  const empty = emptyState('puzzle', 'No marketplaces yet', 'A marketplace is a Git repository or folder that lists plugins. Adding one installs nothing.',
    h('div.market-empty-add', {},
      addBox(true),
      h('div.market-examples', {}, h('span', {}, 'Or try one:'), EXAMPLES.map(example => h('button.market-example', { type: 'button', disabled: !!app.busy, onclick: () => void addMarketplace(example) }, example))),
      h('p.empty-aside', {}, `Marketplaces you added in ${orList(view.tools.map(tool => names[tool]))} show up here by themselves.`)));
  return h('div.page.plugins-page', {},
    shown ? null : toolbar(undefined, lines),
    h('div.bands', {},
      view.canWrite ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.reason ?? 'Preview only here.')),
      market.activity ? h('div.band', { role: 'status' }, icon('refresh-cw', 14, 'spin tone-muted'), h('span.band-text', {}, ACTIVITIES[market.activity].band))
        // Reading the marketplaces again (Git can take seconds) while the last read stays on screen, or that it failed.
        : rereadBand(market.read, 'Reading marketplaces… Nothing is installed by this.'),
      problemBand(lines)),
    // The note of what was updated by itself scrolls with the page, so however long it is, the list is never squeezed.
    shown
      ? h('div.market-layout', {}, marketList(view, shown.entry),
        h('div.market-pane', {}, toolbar(shown, lines), h('div.scroll.market-main', { id: 'plugins-scroll' }, pluginUpdateNotes(), marketPage(view, shown.entry, shown.index))))
      : h('div.scroll.market-main', { id: 'plugins-scroll' }, pluginUpdateNotes(), empty));
}
