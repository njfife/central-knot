// Plugins (titled on screen as words.ts pageNames says; `plugins` in the code): browse marketplaces, and turn each plugin on
// or off with its one switch (pluginrecord.ts).
// The list of marketplaces sits at the left; the chosen one shows its plugins or its README, and a plugin opens its own page
// (pluginpage.ts). A switch's click waits its turn in the page's list (pluginstate.ts turnPlugin), its row saying how it stands;
// Update, Update all and the switches under a plugin's What it holds act at once (pluginstate.ts applyPluginOps). Each tool's
// mark only says what it has.
import { acting, noteMove, noToolManaged, rerender, saidInStatusBar, showPage, state as app } from './app.ts';
import { noToolsState } from './pages.ts';
import { button, closeButton, emptyState, h, icon, rereadBand, whyOff, withToolCount } from './dom.ts';
import { brandMark } from './brand.ts';
import { clockTime, plural } from './model.ts';
import { pluginPage } from './pluginpage.ts';
import { clickNote, dotted, libraryLink, markOf, pluginSwitch, pluginTitle, readme, markCell, updateButton, updateOps, versionNote } from './pluginparts.ts';
import { pluginKey, resultParts, resultSentence, shortOf, type PluginOp, type ResultLine } from './pluginplan.ts';
import { FIND_FROM, blocked, categoriesOf, copyStale, installed, marketTitle, noLongerOffered, offeredVersion, otherVersions, otherVersionsLine, summaryOf, versionToCompare, whyNotCarried, type ToolMark } from './pluginstatus.ts';
import { ACTIVITIES, addCarriedTo, addMarketplace, applyPluginOps, checkCarriedFeed, browse, clearNotice, closeRun, current, declineMarketplace, forgetMarketplace, lastLines, market, openLink, pickMarketplaceFolder, shownDetail, shownPlugins, undoLabel, undoLast, undoOps } from './pluginstate.ts';
import { takesPlugins } from './presence.ts';
import { listResult, problemLines, wholeToggle } from './matrix.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { pluginUpdateNotes } from './pluginupdateview.ts';
import type { MarketplaceView, PluginView, PluginsView } from './types.ts';
import { andList, byToolOrder, notAllThrough, orList, pageNames, toolName, toolNames as names } from './words.ts';

/** "9:20 AM" today, else "Nov 8". */
const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? clockTime(iso) : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

/** The add box: open with no marketplaces yet, otherwise one "Add marketplace" button that opens it. */
function addBox(first: boolean) {
  if (!first && !market.addOpen) {
    return h('div.market-add', {}, button({ variant: 'ghost', size: 'small', icon: 'plus', label: 'Add marketplace', id: 'open-add-marketplace', disabled: acting(),
      onclick: () => { market.addOpen = true; rerender(); requestAnimationFrame(() => document.getElementById('marketplace-source')?.focus()); } }));
  }
  // One add at a time: Enter while one is being read does nothing (the box is disabled then too).
  const add = () => { if (!acting() && market.draftSource.trim()) void addMarketplace(market.draftSource.trim()); };
  const input = h('input.market-add-input', { id: 'marketplace-source', type: 'text', disabled: !!acting(), ...whyOff(acting()), placeholder: 'owner/repo, Git URL or folder', 'aria-label': 'Marketplace to add', spellcheck: 'false', value: market.draftSource,
    oninput: (event: Event) => { market.draftSource = (event.target as HTMLInputElement).value; const go = document.getElementById('add-marketplace') as HTMLButtonElement | null; if (go) go.disabled = !!acting() || !market.draftSource.trim(); },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') add(); if (event.key === 'Escape' && !first) { market.addOpen = false; rerender(); } } });
  const close = first ? null : closeButton(() => { market.addOpen = false; market.draftSource = ''; rerender(); }, { id: 'close-add-marketplace', label: 'Close' });
  return h(`div.market-add.market-add-open${first ? '.market-add-first' : ''}`, {},
    h('div.market-add-head', {}, h('label.market-add-label', { for: 'marketplace-source' }, 'Add a marketplace'), close),
    input,
    h('div.market-add-actions', {},
      button({ variant: 'primary', size: 'small', label: 'Add', id: 'add-marketplace', disabled: acting() || !market.draftSource.trim(), onclick: add }),
      button({ variant: 'outline', size: 'small', icon: 'folder-plus', label: 'Folder…', name: 'Choose a marketplace folder', id: 'pick-marketplace-folder', disabled: acting(), onclick: () => void pickMarketplaceFolder().then(folder => { if (folder) void addMarketplace(folder); }) })));
}

/** Under the open add box: a link that is no marketplace goes on Sources. */
const toSources = () => h('p.market-add-note', {}, `Any other link, to a folder of skills, agents or MCP servers, or to one plugin, goes on `,
  button({ variant: 'link', size: 'micro', label: pageNames.sources, id: 'market-add-to-sources', onclick: () => showPage('sources') }), '.');

/**
 * Marketplaces offered without being looked for (suggested.ts): each named with the tools here it is the default of, an
 * Add button and a way to say no for good. Nothing is fetched or listed until Add. `first`: on the empty page, where they
 * sit under the add box.
 */
function suggestions(view: PluginsView, first = false) {
  const offers = view.suggested ?? [];
  if (!offers.length) return null;
  const id = (source: string) => source.replace(/[^A-Za-z0-9]+/g, '-');
  // Off, like Add, while something else is being read or added: one piece of work on the page at a time.
  const no = (offer: { source: string; name: string }) => {
    const made = closeButton(() => void declineMarketplace(offer.source, offer.name), { id: `suggested-no-${id(offer.source)}`, label: `Don’t suggest ${offer.name}` });
    if (acting()) { made.setAttribute('disabled', ''); made.title = acting()!; }
    return made;
  };
  return h(`div.market-suggested${first ? '.market-suggested-first' : ''}`, { role: 'group', 'aria-label': 'Suggested marketplaces' },
    h('h3.market-suggested-title', {}, 'Suggested'),
    h('ul', {}, offers.map(offer => h('li.market-suggestion', { title: `${offer.source}. Adding it lists its plugins here and installs nothing.` },
      h('span.market-suggestion-text', {}, h('span.market-suggestion-name', {}, offer.name), h('span.market-suggestion-meta', {}, `For ${andList(offer.tools.map(tool => names[tool]))}`)),
      button({ variant: 'outline', size: 'small', label: 'Add', name: `Add ${offer.name}`, id: `suggested-add-${id(offer.source)}`, disabled: acting(), onclick: () => void addMarketplace(offer.source) }),
      no(offer)))));
}

/** The picture a bundled build gave its marketplace, drawn small before its name; nothing for any other marketplace. */
const marketLogo = (entry: MarketplaceView) => (entry.bundled?.logo ? h('img.market-logo', { src: entry.bundled.logo, alt: '', 'aria-hidden': 'true' }) : null);

/** Every marketplace, with how many plugins it lists and how many are installed; the add box below. */
function marketList(view: PluginsView, shown: MarketplaceView) {
  const item = (entry: MarketplaceView) => {
    const count = (test: (plugin: PluginView) => boolean) => entry.plugins.filter(test).length;
    const installedCount = count(plugin => view.tools.some(tool => installed(entry, plugin.name, tool)));
    const meta = entry.problem && !entry.plugins.length ? 'Couldn’t be read' : [entry.bundled ? 'Built in' : '', plural(entry.plugins.length, 'plugin'), installedCount ? `${installedCount} installed` : ''].filter(Boolean).join(' · ');
    return h('li', {}, h(`button.market-item${entry === shown ? '.selected' : ''}`, { type: 'button', title: `${marketTitle(entry)} · ${meta}`, 'aria-current': entry === shown ? 'true' : undefined, onclick: () => browse({ source: entry.source, plugin: undefined, tab: 'plugins', find: '', category: undefined }) },
      h('span.market-item-name', {}, marketLogo(entry), marketTitle(entry)), h('span.market-item-meta', {}, meta)));
  };
  return h('nav.market-list', { id: 'market-list', 'aria-label': 'Marketplaces' },
    h('h2.market-list-title', {}, 'Marketplaces'), h('ul', {}, view.marketplaces.map(item)), suggestions(view), addBox(false), market.addOpen ? toSources() : null);
}

/** One row per plugin: its switch, what it is and holds, and each tool's mark. The row opens the plugin's page. */
function pluginRow(view: PluginsView, entry: MarketplaceView, marketIndex: number, plugin: PluginView) {
  // A plugin kept elsewhere says what it holds once its files have been read; while reading, that; else where it lives.
  const key = pluginKey(entry.source, plugin.name);
  const detail = shownDetail(key);
  const reading = market.details.get(key);
  const readContents = detail === undefined && reading?.reading && !reading.quiet ? 'Reading what it holds…' : detail?.offered ? summaryOf(componentsFrom(detail)) : '';
  const offered = offeredVersion(plugin, detail);
  // A plugin a bundled build doesn't carry says so here, where its boxes can't be chosen; About has the reason.
  // (One it no longer offers, kept for the tools that have it, has the No longer offered mark beside its name instead.)
  const left = entry.bundled?.kept?.includes(plugin.name) ? undefined : whyNotCarried(entry, plugin.name);
  const holds = left ? '' : plugin.components ? summaryOf(plugin.components) : readContents || (plugin.from ? `From ${plugin.from.label}` : '');
  // A tool on another version than the marketplace offers is named on the row, so it shows without opening the plugin.
  const compareTo = versionToCompare(plugin, detail);
  const others = otherVersions(view, entry, plugin.name, compareTo);
  const updates = view.canWrite ? updateOps(view, entry, plugin) : [];
  const differing = view.tools.filter(tool => copyStale(entry, plugin.name, tool, compareTo, detail)).map(tool => names[tool]);
  const behind = [others.length ? otherVersionsLine(others) : '', differing.length ? `${andList(differing)} ${differing.length > 1 ? 'differ' : 'differs'} from the marketplace’s copy` : ''].filter(Boolean).join(', ');
  const open = () => browse({ plugin: plugin.name });
  const library = libraryLink(entry, plugin, `plibrary-${marketIndex}-${plugin.name}`, 'row');
  return h('div.ov-row.plugin-row', { role: 'row', 'data-plugin': plugin.name, onclick: open },
    h('div.ov-managed.plugin-row-switch', { role: 'cell' }, pluginSwitch(view, entry, plugin, `pswitch-${marketIndex}-${plugin.name}`)),
    h('div.ov-name.plugin-row-name', { role: 'cell' },
      h('button.plugin-row-open', { type: 'button', id: `popen-${marketIndex}-${plugin.name}`, 'aria-label': `Open ${pluginTitle(plugin)}`, onclick: (event: Event) => { event.stopPropagation(); open(); } },
        // The category pill is left out while that category is the filter: every row would say the same.
        h('span.plugin-row-title', {}, pluginTitle(plugin)), offered ? h('span.plugin-row-version', { title: 'The version the marketplace offers' }, offered) : null,
        noLongerOffered(entry, plugin) ? h('span.plugin-chip.plugin-chip-gone', {}, 'No longer offered') : null,
        plugin.category && !market.nav.category ? h('span.plugin-chip', {}, plugin.category) : null),
      // The description first, then what it holds: when room runs out the description shortens or steps aside (style.css). While
      // the list's news says how a click on it stands, that note is the row's line instead, in one line: a row with neither
      // still has its line, so a click never changes the row's height and the rows below keep their places.
      clickNote(entry, plugin.name, true) ?? h('span.plugin-row-line', {},
        plugin.description ? h('span.plugin-row-about', { title: plugin.description }, plugin.description) : null,
        plugin.description && (holds || left) ? h('span.plugin-row-sep', { 'aria-hidden': 'true' }, '·') : null,
        holds ? h('span.plugin-row-holds', { title: holds }, holds) : null,
        // The link sits beside the words: a long app name shortens the words, never the link.
        left ? h('span.plugin-row-left', {}, h('span.plugin-row-holds', { title: `Can’t be installed from ${entry.bundled!.app}` }, `Can’t be installed from ${entry.bundled!.app}`), h('span.plugin-row-sep', { 'aria-hidden': 'true' }, '·'),
            h('button.text-action', { type: 'button', id: `pleft-${marketIndex}-${plugin.name}`, onclick: (event: Event) => { event.stopPropagation(); browse({ tab: 'about' }); } }, 'see why')) : null,
        // Its items in the Library, where it has any, last: the words before it shorten, never the link.
        library ? [plugin.description || holds || left ? h('span.plugin-row-sep', { 'aria-hidden': 'true' }, '·') : null, library] : null),
      // A tool on another version or with another copy, on its own line under that, with Update for every tool that is behind.
      behind || updates.length ? h('span.plugin-row-update', {},
        behind ? versionNote(h('span', {}, behind.charAt(0).toUpperCase() + behind.slice(1)), '.plugin-row-warning') : null,
        updates.length ? updateButton(updates, `pupdate-${marketIndex}-${plugin.name}`, { row: true }) : null) : null),
    view.tools.map(tool => markCell(view, entry, plugin, tool, marketIndex, compareTo)),
    h('div.ov-cell.plugin-row-go', { role: 'cell', 'aria-hidden': 'true' }, icon('chevron-right', 14, 'tone-faint')));
}

function findBox(entry: MarketplaceView) {
  return h('input.market-find', { id: 'plugin-find', type: 'search', placeholder: `Find in ${plural(entry.plugins.length, 'plugin')}`, 'aria-label': 'Find plugins', value: market.nav.find,
    // The redraw makes a new box, which keeps the caret where he was typing (dom.ts keepSelection).
    oninput: (event: Event) => browse({ find: (event.target as HTMLInputElement).value }) });
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
  const head = h('div.ov-row.ov-head', { role: 'row' }, h('div.ov-managed', { role: 'columnheader', 'aria-label': 'On or off' }),
    h('div.ov-name.plugin-hint', { role: 'columnheader' }, someCan ? [h('span.hint-long', {}, 'A switch installs or removes it in every tool that takes the plugin; clicks run in turn.'), h('span.hint-short', {}, 'Clicks run in turn.')] : 'Plugin'),
    view.tools.map(tool => h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool]))), h('div.ov-cell.plugin-row-go', { role: 'columnheader' }));
  // With more than one plugin behind, one button runs every update in this marketplace at once, those the filter hides too.
  const behind = view.canWrite ? entry.plugins.filter(plugin => updateOps(view, entry, plugin).length) : [];
  const updateAll = behind.length > 1 ? h('p.market-hint', {}, icon('refresh-cw', 13, 'tone-warning'), h('span', {}, `${behind.length} plugins have an update. `,
    button({ variant: 'link', size: 'micro', id: `market-update-all-${marketIndex}`, label: 'Update all', disabled: acting(), attrs: { title: updateAllTitle(view, entry, behind, shown) },
      onclick: () => void applyPluginOps(behind.flatMap(plugin => updateOps(view, entry, plugin))) }))) : null;
  return [
    reasons.length && someCan ? h('p.market-hint', {}, icon('circle-alert', 13, 'tone-warning'), h('span', {}, `${reasons.join(' ')} `,
      button({ variant: 'link', size: 'micro', label: 'See Harnesses', id: `market-tools-${marketIndex}`, onclick: () => showPage('harnesses') }))) : null,
    view.switchProblem ? h('p.market-hint', {}, icon('circle-alert', 13, 'tone-warning'), h('span', {}, view.switchProblem)) : null,
    updateAll,
    shown.length
      ? withToolCount(h('div.ov.plugin-table', { role: 'table', 'aria-label': `Plugins in ${entry.name}` }, head, shown.map(plugin => pluginRow(view, entry, marketIndex, plugin))), view.tools.length)
      : h('p.market-empty', {}, entry.plugins.length ? 'No plugin matches.' : entry.problem ? '' : 'This marketplace lists no plugins.'),
    shown.length ? legend(view, entry) : null,
  ];
}

/**
 * Update all's tooltip, before the click: each plugin with the tools it updates in (counted past five), the plugins the filter
 * hides, those whose differing copy it replaces, and that an update can't be undone.
 */
function updateAllTitle(view: PluginsView, entry: MarketplaceView, behind: PluginView[], shown: PluginView[]): string {
  const opsOf = (plugin: PluginView) => updateOps(view, entry, plugin);
  const tools = (ops: PluginOp[]) => andList([...new Set(ops.map(op => op.tool))].map(tool => names[tool]));
  const runs = behind.length > 5 ? `${plural(behind.length, 'plugin')} in ${tools(behind.flatMap(opsOf))}` : andList(behind.map(plugin => `${plugin.name} in ${tools(opsOf(plugin))}`));
  const hidden = behind.filter(plugin => !shown.includes(plugin)).length;
  const differs = (plugin: PluginView) => {
    const detail = shownDetail(pluginKey(entry.source, plugin.name));
    return view.tools.some(tool => copyStale(entry, plugin.name, tool, versionToCompare(plugin, detail), detail));
  };
  const replaced = behind.filter(differs).map(plugin => plugin.name);
  return [`Updates ${runs}.`, hidden ? `${plural(hidden, 'of them is', 'of them are')} hidden by the filter.` : '',
    replaced.length ? `It replaces the copies that differ from the marketplace’s: ${replaced.length > 5 ? plural(replaced.length, 'plugin') : andList(replaced)}.` : '',
    'Runs now. An update can’t be undone.'].filter(Boolean).join(' ');
}

/** About a marketplace: every fact about it (who, where it comes from, when it was read), Remove, then its README. */
function aboutTab(view: PluginsView, entry: MarketplaceView, marketIndex: number) {
  const read = market.readmes.get(entry.source);
  // The move of a waiting plugin's parts reads this marketplace's copy (partsmigrate.ts), which Remove would delete.
  const waits = !!entry.waiting?.length;
  const remove = entry.origins.includes('central-knot') && !entry.bundled ? button({ variant: 'outline', size: 'small', icon: 'circle-minus', label: 'Remove from this list', name: `Remove ${marketTitle(entry)} from this list. Installed plugins stay installed.`, id: `forget-${marketIndex}`, disabled: acting() || waits, onclick: () => void forgetMarketplace(entry.source) }) : null;
  if (remove) remove.title = waits ? 'Parts of its plugins from an earlier version wait to be moved to the library, which reads this marketplace’s copy. It can be removed once they are moved.' : 'Removes it from this list only. Installed plugins stay installed.';
  const source = entry.page ? button({ variant: 'link', size: 'micro', label: entry.sourceLabel, id: `market-page-${marketIndex}`, onclick: () => openLink(entry.page!) }) : h('span', { title: entry.source }, entry.sourceLabel);
  return [
    // In narrow content the description is said here only (style.css), so the plugins get the height on their tab.
    entry.description ? h('p.market-page-about.about-only-narrow', {}, entry.description) : null,
    // A build's own marketplace says which release of it this is; where it "comes from" is the build, already among its facts.
    h('div.market-about-head', {}, h('p.market-page-meta', {}, entry.bundled ? bundledFacts(entry) : dotted([...marketFacts(entry), source])), remove),
    feedNote(entry, marketIndex),
    inToolsNote(view, entry, marketIndex),
    notCarriedNote(entry),
    !read || read.reading ? h('p.plugin-muted', {}, 'Reading…')
      : read.value ? h('div.plugin-readme-body', {}, readme(read.value, entry.name, [entry.description ?? ''])) : h('p.plugin-muted', {}, 'This marketplace has no README.'),
  ];
}

/** Who made a marketplace, which tools added it (said only when Central Knot didn't), and when it was read; for the one a build carries, that it comes with the app. */
function marketFacts(entry: MarketplaceView): string[] {
  if (entry.bundled) return [entry.owner ? `By ${entry.owner}` : '', entry.sourceLabel].filter(Boolean);
  const addedBy = entry.origins.includes('central-knot') ? [] : entry.origins.filter(origin => origin !== 'bundle').map(toolName);
  return [entry.owner ? `By ${entry.owner}` : '', addedBy.length ? `Added in ${andList(addedBy)}` : '', entry.fetchedAt ? `Updated ${when(entry.fetchedAt)}` : ''].filter(Boolean);
}

/**
 * A build's feed of newer plugins: that they arrive by themselves and when that was last looked at, or why the last look
 * came to nothing, with a button to look now.
 */
function feedNote(entry: MarketplaceView, marketIndex: number): HTMLElement | null {
  const feed = entry.bundled?.feed;
  if (!feed) return null;
  const trouble = feed.outcome === 'failed' || feed.outcome === 'held';
  const at = feed.checked ? when(feed.checked) : '';
  // Trouble says when it was last tried and, when it didn't mend itself, who to tell; otherwise what "arrive" means for a plugin a tool already has.
  const said = trouble ? `${feed.message!}${at ? ` Last tried ${at}.` : ''}${feed.outcome === 'failed' && entry.owner ? ` If it keeps happening, tell ${entry.owner}.` : ''}`
    : `Newer plugins arrive by themselves. Tools that have one installed pick up the new version when they next start; if a tool can’t, Update shows here.${at ? ` Last checked ${at}.` : ''}`;
  return h('div.market-in-tools', { id: 'market-feed' },
    h('p', {}, trouble ? icon('circle-alert', 13, 'tone-warning') : null, said),
    button({ variant: 'outline', size: 'small', icon: 'refresh-cw', label: 'Check now', name: 'Check now for newer plugins', id: `check-feed-${marketIndex}`, disabled: acting(), onclick: () => void checkCarriedFeed(entry) }));
}

/**
 * A build's own marketplace in each tool's own plugin list: which tools list it (and that the app added it, where it
 * did), and for one that doesn't and could, a button that lists it there. The build adds it to every tool once by itself;
 * the button is for a tool it was since taken out of, or where that didn't work.
 */
function inToolsNote(view: PluginsView, entry: MarketplaceView, marketIndex: number): HTMLElement | null {
  if (!entry.bundled) return null;
  const tools = view.tools.filter(tool => takesPlugins(tool));
  const has = tools.filter(tool => entry.origins.includes(tool));
  // A tool that can't take it (another marketplace under its name, no command-line tool) says why on the Plugins tab.
  const could = view.canWrite ? tools.filter(tool => !has.includes(tool) && !blocked(view, entry, tool) && !Object.values(entry.states).some(states => states[tool]?.state === 'held')) : [];
  if (!has.length && !could.length) return null;
  const listOf = (list: typeof tools) => andList(list.map(tool => names[tool]));
  const where = () => (has.length > 1 ? 'those tools’ own plugin lists' : `${names[has[0]!]}’s own plugin list`);
  // Said as the app's own doing where it was (its own add, or an install from here), and that taking it out in a tool is respected.
  const byApp = has.length > 0 && has.every(tool => entry.bundled!.addedTo?.includes(tool));
  // Which tools don't, said right after which do. (That nothing was installed is said when it is true: in the status bar at the add.)
  const lacks = has.length && could.length ? ` ${listOf(could)} ${could.length > 1 ? 'don’t' : 'doesn’t'} list it.` : '';
  const said = !has.length ? 'None of your tools lists this marketplace yet.'
    : byApp ? `${entry.bundled.app} added this marketplace to ${listOf(has)}, so these plugins also show in ${where()}.${lacks} Remove it in a tool and it stays out.`
      : `${listOf(has)} ${has.length > 1 ? 'list' : 'lists'} this marketplace, so these plugins also show in ${where()}.${lacks}`;
  return h('div.market-in-tools', { id: 'market-listed' },
    h('p', {}, said),
    could.map(tool => button({ variant: 'outline', size: 'small', label: `List in ${names[tool]}`, name: `List ${marketTitle(entry)} in ${names[tool]}’s own plugin list. Nothing is installed.`, id: `add-carried-${marketIndex}-${tool}`, disabled: acting(), onclick: () => void addCarriedTo(entry, tool) })));
}

/**
 * About's line for a build's own marketplace: which release of it this is (what it was made from is its tooltip, for
 * whoever needs to tell releases apart). Who made it and that it comes with the app are on the title line just above, so
 * here they show only where that line is hidden (narrow).
 */
function bundledFacts(entry: MarketplaceView) {
  const release = entry.bundled?.release ? h('span', { title: entry.bundled.from ? `Made from ${entry.bundled.from}` : undefined }, `Plugins as of ${entry.bundled.release}`) : null;
  return [h('span.market-fact-narrow', {}, dotted(marketFacts(entry)), release ? h('span.meta-dot', { 'aria-hidden': 'true' }, '·') : null), release];
}

/** The plugins a build's marketplace lists but the build carries no files for, each with why, so "not available" has its reason in one place. */
function notCarriedNote(entry: MarketplaceView): HTMLElement | null {
  // One that is kept for the tools that have it is said on its own row, as no longer offered.
  const left = (entry.bundled?.unpackaged ?? []).filter(item => !entry.bundled?.kept?.includes(item.name));
  if (!left.length) return null;
  return h('div.market-not-carried', { role: 'note' },
    h('p', {}, icon('circle-alert', 13, 'tone-warning'), h('span', {}, `${left.length === 1 ? 'One plugin listed here isn’t' : `${left.length} plugins listed here aren’t`} included in ${entry.bundled!.app}, so ${left.length === 1 ? 'it' : 'they'} can’t be installed from here.${entry.owner ? ` Ask ${entry.owner} if you need ${left.length === 1 ? 'it' : 'one'}.` : ''}`)),
    h('ul', {}, left.map(item => h('li', {}, h('strong', {}, item.name), `: ${item.reason}`))));
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
    market.nav.tab === 'about' ? aboutTab(view, entry, marketIndex) : pluginsTab(view, entry, marketIndex));
}

/**
 * What the marks mean, only for marks on screen that need saying: a check, nothing and a striped one explain themselves with
 * their tooltips, so the key names the rest.
 */
function legend(view: PluginsView, entry: MarketplaceView) {
  const marks = new Set<ToolMark>(entry.plugins.flatMap(plugin => view.tools.map(tool => markOf(view, entry, plugin, tool, versionToCompare(plugin, shownDetail(pluginKey(entry.source, plugin.name)))).mark)));
  const keyed: [ToolMark[], string, string, Parameters<typeof icon>[0]][] = [
    [['outdated'], 'Out of date: Update on its row', 'cell-differs.cell-on', 'refresh-cw'],
    [['waits'], 'Goes in at the next automatic check', 'cell-waiting', 'clock'],
    [['parts-waiting'], 'Waits to be moved: parts from an earlier version', 'cell-waiting', 'clock'],
    [['not-brought'], 'Not brought by itself: off in a tool’s own settings', 'cell-not-brought', 'circle-off'],
    [['missing'], 'Not in that tool, though on: tick it on its page', 'cell-differs', 'circle-alert'],
    [['stays'], 'Still there, though off or kept out', 'cell-differs.cell-on', 'circle-alert'],
    [['unknown', 'not-known'], 'Unknown: its record can’t be read', 'cell-differs', 'circle-question-mark'],
  ];
  const shown = keyed.filter(([which]) => which.some(mark => marks.has(mark)));
  if (!shown.length && !marks.has('cannot')) return null;
  const item = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  return h('div.legend.plugin-legend', { 'aria-label': 'Key' },
    shown.map(([, label, look, glyph]) => item(label, h(`span.legend-cell.${look}`, {}, icon(glyph, 10)))),
    marks.has('cannot') ? item('Can’t go there', h('span.legend-cell.cell-cannot', {})) : null);
}

/** The way back from the last run, as a button labelled by undoLabel. */
function undoButton(): HTMLElement | null {
  const back = undoOps();
  if (!back.length) return null;
  const undo = button({ variant: 'outline', size: 'small', label: undoLabel(), id: 'plugins-undo', disabled: acting(), onclick: undoLast });
  undo.title = acting() ?? undoTitle(back);
  return undo;
}

/** What each kind of step an Undo runs does, in Undo's tooltip, before the tools it runs in. */
const UNDO_WORDS: [PluginOp['action'][], string][] = [[['remove'], 'uninstalls it from'], [['install'], 'reinstalls it in'],
  [['skill-on', 'skill-off', 'part-on', 'part-off', 'plugin-on', 'plugin-off'], 'turns each switch back as it was in']];

/** Undo's tooltip, from what it will run (`back`): what it reverses where, that an update in the same run stays, and what a switch's Undo can't put back. */
function undoTitle(back: PluginOp[]): string {
  const where = (actions: PluginOp['action'][]) => andList([...new Set(back.filter(op => actions.includes(op.action)).map(op => op.tool))].sort(byToolOrder).map(tool => names[tool]));
  const does = UNDO_WORDS.filter(([actions]) => where(actions)).map(([actions, verb]) => `${verb} ${where(actions)}`);
  const updated = !market.lastRun?.undo && market.lastRun?.done.some(entry => entry.action === 'update' && entry.report.changed);
  // A switch's Undo names its plugin: several plugins' clicks may have run since the page was last read.
  const plugin = !market.lastRun?.undo && market.lastRun?.turn ? ` for ${market.lastRun.turn.plugin}` : '';
  const said = [`Reverses what changed${plugin}, through each tool’s own command or switch: ${andList(does)}.`, updated ? 'The update itself stays: it can’t be undone.' : ''];
  return [...said, ...(market.lastRun?.turn?.limits ?? [])].filter(Boolean).join(' ');
}

const dismiss = (onclick: () => void, id?: string) => closeButton(() => { onclick(); rerender(); }, { id });

/**
 * The page's last result, for the window's header (renderer.ts resultHere), where nothing on the page moves for it: what just
 * happened, with Undo and its × (runLine), then what went wrong (problemBand), with the one × when it stands alone.
 */
export function pluginsResult(): HTMLElement[] {
  // A result told here since the last run (every run clears it: pluginstate.ts turnPlugin, act), with no action of the page's own
  // (Sync once from the menu): said as a list page's result is, with its own reasons (matrix.ts listResult).
  if (app.outcome?.page === 'plugins' && !app.outcome.act && !saidInStatusBar(app.outcome)) return listResult();
  const lines = lastLines(), run = runLine(lines), problems = problemBand(lines, !run);
  // With no problem line, Show all follows the sentence, for one the header's two lines cut (as matrix.ts listResult).
  if (run && !problems) run.querySelector('.toolbar-result-text')!.after(wholeToggle(market.lastRun ?? app.outcome, 0));
  return [run, problems].filter((part): part is HTMLElement => !!part);
}

/** What just happened (each plugin named a link to its page, with Undo), or else the last notice ("… added"). */
function runLine(lines: ResultLine[]): HTMLElement | null {
  // A result is said here only while it offers something to do (Undo, or its own button); one that only tells is in the
  // status bar (app.ts saidInStatusBar).
  const last = market.lastRun;
  const back = undoButton();
  const open = current()?.entry;
  const parts = last ? resultParts(lines, last.undo, { short: true, here: open && market.nav.plugin ? { plugin: market.nav.plugin, source: open.source } : undefined }) : [];
  // A run that left something undone counts it first, Undo or not (its reasons are the problem lines under it), so the cut never hides it.
  const short = last ? shortOf(lines, last.unreached) : { names: [], of: 0 }, failed = short.names;
  if (last && (parts.length || failed.length) && (back || failed.length)) {
    const link = (part: { plugin: string; source: string }, at: number) =>
      h('button.result-link', { type: 'button', id: `result-plugin-${at}`, title: `Open ${part.plugin}`, onclick: () => browse({ source: part.source, plugin: part.plugin, tab: 'plugins' }) }, part.plugin);
    // On another plugin's page the result is only named, so it never reads as being about the plugin on screen; an
    // Undo still says it was undone.
    // Once the tools were read again (Refresh) the run is only named, so its sentence never contradicts what the page now shows.
    const elsewhere = last.reread || (market.nav.plugin && !lines.some(line => line.plugin === market.nav.plugin));
    // Each plugin the run changed, once, whether or not the sentence names it (it leaves out the plugin on screen).
    const changed = [...new Map(lines.filter(line => line.ok).map(line => [pluginKey(line.source, line.plugin), { plugin: line.plugin, source: line.source }])).values()];
    const sentence = elsewhere
      ? [last.undo ? 'Undone: ' : 'Last change: ', ...changed.flatMap((part, at) => [at ? ', ' : '', link(part, at)]), '.']
      : parts.map((part, at) => (typeof part === 'string' ? part : link(part, at)));
    // What a switch's Undo can't put back is said with the result, so the promise beside Undo is the whole of it.
    const limits = !last.undo && last.turn?.limits.length ? ` ${last.turn.limits.join(' ')}` : '';
    const lead = failed.length ? `${notAllThrough(failed, short.of)} ` : '';
    return h('div.toolbar-result', { role: 'status', id: 'plugins-result' }, failed.length ? icon('triangle-alert', 14, 'tone-warning') : icon('check', 14, 'tone-success'),
      h('span.toolbar-result-text', { title: `${lead}${resultSentence(lines, last.undo)}${limits}` }, lead, sentence, limits ? h('span.toolbar-result-more', {}, limits) : null), back, dismiss(closeRun, 'report-dismiss'));
  }
  // An Undo that undid nothing still offers its way back here, whether or not its failures are still shown.
  if (last && back) return h('div.toolbar-result', { role: 'status', id: 'plugins-result' }, h('span.toolbar-result-text', {}, 'Not everything was undone.'), back, dismiss(closeRun, 'report-dismiss'));
  const outcome = app.outcome?.page === 'plugins' && app.outcome.act ? app.outcome : undefined;
  if (!outcome?.act) return null;
  const action = button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, disabled: acting(), onclick: () => outcome.act!.run() });
  return h('div.toolbar-result', { role: 'status', id: 'plugins-result', 'data-outcome': '' }, icon('check', 14, 'tone-success'), h('span.toolbar-result-text', { title: outcome.text }, outcome.text), action, dismiss(clearNotice, 'report-dismiss'));
}

/** What went wrong in the last run, or why a marketplace couldn't be added, with the result's × when it stands `alone`. */
function problemBand(lines: ResultLine[], alone: boolean) {
  const failures = lines.filter(line => !line.ok);
  if (!market.problem && !failures.length) return null;
  return h('div.band.plugin-problems', { role: 'alert' }, icon('triangle-alert', 14, 'tone-warning'),
    problemLines([...failures.map(line => [h('strong.item-name', {}, line.plugin), `: ${line.text}`]), ...(market.problem ? [market.problem] : [])], market.lastRun ?? market.problem),
    alone ? dismiss(closeRun, 'report-dismiss') : null);
}

/** The plugin whose page is open in this marketplace, if one is. */
const openPlugin = (entry: MarketplaceView) => (market.nav.plugin ? entry.plugins.find(candidate => candidate.name === market.nav.plugin) : undefined);

/**
 * The toolbar over the marketplace pane (beside the list of marketplaces, which runs the full height): where the person is,
 * the marketplace or inside a plugin (← team-tools › document-tools).
 */
function toolbar(shown: { entry: MarketplaceView; index: number }) {
  const plugin = openPlugin(shown.entry);
  const left = plugin
    ? h('nav.market-crumbs', { 'aria-label': 'You are here' },
      h('button.crumb-link', { type: 'button', id: 'plugin-back', onclick: () => { noteMove('back'); browse({ plugin: undefined }); } }, icon('arrow-left', 13), marketTitle(shown.entry)),
      icon('chevron-right', 12, 'tone-faint'), h('span.crumb-here', {}, pluginTitle(plugin)))
    : titleLine(shown.entry);
  // In narrow content the marketplace strip already names it, so a toolbar with only the name isn't drawn (style.css).
  return h(`div.toolbar.plugins-toolbar.fit-bar${!plugin ? '.toolbar-title-only' : ''}`, {}, left);
}

/**
 * The marketplace's name, then who made it and when it was read: the left of the toolbar's row on its page, so a result
 * at the right shares the row instead of taking a band of its own. The facts drop whole, the last first, and only then
 * does the name shorten (style.css); About has them all, with where it comes from.
 */
function titleLine(entry: MarketplaceView) {
  const name = marketTitle(entry);
  return h('div.market-title-line', {}, h('h2', { title: name }, marketLogo(entry), name), marketFacts(entry).map(fact => h('span.market-fact', {}, fact)));
}

export function pluginsPage() {
  const view = market.view;
  // From the marketplaces' own read (pagedata.ts): what it found, else that it is reading or could not read.
  if (!view) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, market.read.state === 'failed' ? 'Marketplaces could not be read.' : 'Reading marketplaces…')));
  // A home with no tools: another home is the way forward.
  if (noToolManaged()) return h('div.page', {}, noToolsState('plugins'));
  // Tools, but none that takes plugins (only Pi): the sidebar hides Plugins then, so this is a marketplace read that saw a plugin tool go before the home's read did.
  if (!view.tools.length) return h('div.page', {}, emptyState('puzzle', 'No tool in this home can install plugins', 'None of the tools found here takes plugins. Once one is installed, Central Knot finds it on its own, or at once with Refresh at the top.',
    button({ variant: 'outline', label: 'See Harnesses', id: 'plugins-no-tools', onclick: () => showPage('harnesses') })));
  const shown = current();
  // With no marketplaces, adding one is the only thing to do: its box sits in the middle of the page, with examples.
  const empty = emptyState('puzzle', 'No marketplaces yet', 'A marketplace is a Git repository or folder that lists plugins. Adding one installs nothing.',
    h('div.market-empty-add', {},
      addBox(true),
      toSources(),
      suggestions(view, true),
      h('p.empty-aside', {}, `Marketplaces you added in ${orList(view.tools.filter(takesPlugins).map(tool => names[tool]))} show up here by themselves.`)));
  return h('div.page.plugins-page', {},
    h('div.bands', {},
      view.canWrite ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.reason ?? 'Preview only here.')),
      market.activity ? h('div.band', { role: 'status' }, icon('refresh-cw', 14, 'spin tone-muted'), h('span.band-text', {}, ACTIVITIES[market.activity].band))
        // Reading the marketplaces again (Git can take seconds) while the last read stays on screen, or that it failed.
        : rereadBand(market.read, 'Reading marketplaces… Nothing is installed by this.')),
    // The note of what was updated by itself scrolls with the page, so however long it is, the list is never squeezed. It
    // heads a marketplace's list, not a plugin's own page.
    shown
      ? h('div.market-layout', {}, marketList(view, shown.entry),
        h('div.market-pane', {}, toolbar(shown), h('div.scroll.market-main', { id: 'plugins-scroll' }, openPlugin(shown.entry) ? null : pluginUpdateNotes(), marketPage(view, shown.entry, shown.index))))
      : h('div.scroll.market-main', { id: 'plugins-scroll' }, pluginUpdateNotes(), empty));
}
