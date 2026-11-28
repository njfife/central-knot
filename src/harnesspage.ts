// Harnesses: one place per tool. The list sums up what each one has, with its Manage switch (managecard.ts); a managed
// harness's own page manages its items with the same tables and switches as the Library, with that
// tool first, plus its instruction file and its plugins. A tool left out has its card and switch here, and no other page shows
// it as a tool (History's entries, and the Overview's line under its tools table, still name it). Nothing here has its own
// engine: every change goes through the pages it mirrors, or the switch's toolchoice.ts.
import { noteMove, KINDS, acting, harnessManaged as managed, leaveResults, realHomeName, thisMachine, isKind, loadHome, rerender, shownPath, showPage, state, type HarnessTab, type PageKind } from './app.ts';
import { manageLocked, manageRow } from './managecard.ts';
import { MARK_WORDS, installsIn, marketTitle, pluginsInstalled, takenItems, takesItemsOnly, viewStopped, type InstalledMarketPlugin } from './pluginstatus.ts';
import { inTool, pluginItemCount, rowCount } from './pluginrows.ts';
import { boxDoes, pluginTitle, uninstallControl } from './pluginparts.ts';
import { button, emptyState, h, icon, pathText, section, toggle, type Child } from './dom.ts';
import { fullToolName, plural } from './model.ts';
import { andList, coworkWords, fileName, kindNouns, pageNames, sentence, toolNames as names } from './words.ts';
import { agentsKeptIn, hasCowork, takesPlugins, type AgentTool } from './presence.ts';
import { brandMark } from './brand.ts';
import { shortBuild } from './values.ts';
import type { DesktopApp, HarnessId, HomeView, InstructionFile, Snapshot } from './types.ts';
import { caughtUpBand, resetTablesForHarness, itemsTable, differingIn, emptyList, showFiltered } from './matrix.ts';
import { kindSource } from './itemrow.ts';
import { aboutInstructions, instructionBands, instructionCard, instructionsNotRead } from './instructionspage.ts';
import { browse, clickOn, lineBox, loadPlugins, market, pluginBusy, turnPlugin } from './pluginstate.ts';
import { homeItems, inUseName, pluginLive } from './profileplan.ts';
import { copyButton, fact, kindEmpty, noToolsState, notRead } from './pages.ts';

const TABS: HarnessTab[] = ['skills', 'mcp', 'agents', 'instructions', 'plugins', 'about'];
/** A tab's name: the page of the same name's title, but Plugins for the plugins installed in that tool (their page's is pageNames.plugins). */
const tabLabel = (tab: HarnessTab) => (tab === 'about' ? 'About' : tab === 'plugins' ? 'Plugins' : kindNouns[tab].title);

/** A backslash separates folders only on Windows; elsewhere it can be part of a skill's name. */
const dirname = (path: string) => path.replace(/^[A-Za-z]:\\/.test(path) ? /[/\\][^/\\]*$/ : /\/[^/]*$/, '');

/** What could not be read in this tool's folders (a missing skills folder is not a problem). */
const readProblems = (snapshot: Snapshot) => (snapshot.discovery === 'missing' ? [] : snapshot.issues);

/** The harnesses this home shows: this computer's home lists every tool, found or not; a folder only the ones it has. */
const listed = (home: HomeView) => home.snapshots.filter(snapshot => home.mode === 'actual' || home.sync.present.includes(snapshot.harness));

const supports = (home: HomeView, kind: PageKind, tool: HarnessId) => kindSource(home, kind).tools.includes(tool);
/** Said on the card, the tab's tooltip and the empty tab when Central Knot holds no kind of this in a tool (Antigravity's agents). */
const kindNotUsed = (tool: HarnessId, kind: PageKind) => `${sentence(kindNouns[kind].many)} aren’t handled for ${names[tool]}`;

/**
 * What one tool has of one kind: its total, the synced subtotal (for skills, only copies managed there), and copies that
 * differ and need a choice (the same count as that tool's "Copies differ" chip). `supported`: the tool can hold this kind.
 * A tool's card here and the Overview's tools table count by it.
 */
export function tally(home: HomeView, kind: PageKind, tool: HarnessId) {
  const source = kindSource(home, kind);
  const here = source.facts.filter(item => inTool(item, tool));
  const plugins = pluginItemCount(home, kind, tool);
  const on = here.filter(item => item.on && (kind !== 'skills' ||
    (item.copies[tool] && !item.except.includes(tool) && source.library[item.key]?.applied[tool] !== undefined))).length;
  return { kind, supported: source.tools.includes(tool), total: here.length + plugins, plugins, on, differing: differingIn(source, tool) };
}

const instructionOf = (tool: HarnessId): InstructionFile | undefined => state.instructions.data?.find(file => file.tool === tool);

/**
 * Plugins in this tool: `reading` or `failed` while the marketplaces are not read (the last good read is kept and shown), `unsupported`
 * when this tool takes no marketplace plugins (Pi), else what installsIn found.
 */
type PluginsHere = { state: 'reading' } | { state: 'failed' } | { state: 'unsupported' } | ({ state: 'read' } & NonNullable<ReturnType<typeof installsIn>>);
function pluginsIn(tool: HarnessId): PluginsHere {
  const view = market.view;
  if (!view) return market.read.state === 'failed' ? { state: 'failed' } : { state: 'reading' };
  const installs = installsIn(view, tool);
  return installs ? { state: 'read', ...installs } : { state: 'unsupported' };
}

/**
 * How the tool was found, short: a sample or chosen folder is only a folder; on this computer, its CLI (with its version),
 * its desktop app with no CLI, or neither. Both found: both named, since the app is never the CLI.
 */
const detectionLine = (snapshot: Snapshot, home: HomeView) => {
  if (home.mode === 'fixture') return 'Sample folder';
  if (home.mode === 'custom') return 'Folder only';
  const app = snapshot.app ? appLine(snapshot.app) : '';
  if (snapshot.detection === 'Installed') return [snapshot.probe.version || 'Installed', app].filter(Boolean).join('; ');
  if (snapshot.detection === 'App only') return `${app} · no CLI found`;
  // A folder with no tool beside it: the tool is not installed, and its folder (shown under this line) is all that is here.
  if (snapshot.detection === 'Config found but app not detected') return 'Not found · only its folder is here';
  return snapshot.detection;
};
/**
 * A desktop app with its version and the version of what it carries: "Claude desktop 4.16336.0 (Code tab 2.1.317)". A
 * pre-release keeps only its first word: "1.0.102-0.unstable.r41779900948.gf482387" reads "1.0.102-unstable".
 */
const appLine = (app: DesktopApp) => `${app.name}${app.version ? ` ${app.version}` : ''}${app.carriedVersion && app.carriedVersion !== app.version ? ` (${app.carries} ${shortBuild(app.carriedVersion)})` : ''}`;

// ---------- Every harness ----------

type Count = { value: string; note?: string; faint?: boolean };
/** One line of a card's counts: what, how many, and a short note. `faint` for a count that is not there or not known. */
function countRow(label: string, count: Count | null) {
  if (!count) return null;
  const { value, note, faint = false } = count;
  return h('div.harness-count', {}, h('span.harness-count-label', {}, label), h(`span.harness-count-value${faint ? '.tone-faint' : ''}`, {}, value), h('span.harness-count-note', {}, note ?? ''));
}

function kindCount(home: HomeView, { kind, supported, total, plugins, on }: ReturnType<typeof tally>, tool: HarnessId): Count | null {
  if (!supported) return { value: '—', note: kindNotUsed(tool, kind), faint: true };
  // Unread comes before any total, as on the Overview; known zero is omitted.
  if (home[kind]?.unread?.includes(tool)) return { value: '?', note: 'couldn’t be read', faint: true };
  if (!total) return null;
  // A plugin's items are counted and said apart: they are never synced.
  const own = total - plugins;
  const mine = !own ? '' : on === own ? (plugins ? `${own} synced` : '') : !on ? `${own} not synced` : `${on} synced · ${own - on} not synced`;
  return { value: String(total), note: [mine, plugins ? `${plugins} from plugins` : ''].filter(Boolean).join(' · ') };
}

function instructionCount(tool: HarnessId): Count {
  // Files already read stay shown if a later read fails, here as on the Instructions tab.
  if (!state.instructions.data) return state.instructions.state === 'failed' ? { value: '—', note: 'couldn’t be read', faint: true } : { value: '…', faint: true };
  // A file, not a number: its name and length, or that there is none yet.
  const file = instructionOf(tool);
  if (!file) return { value: '—', faint: true };
  if (!file.exists) return { value: '', note: 'no file yet' };
  // Its name alone, so the note keeps to one line on a narrow card; an empty file says so.
  return { value: '', note: file.text.trim() ? fileName(file.path) : `${fileName(file.path)} (empty)` };
}

/** A tool's plugins on its card (pluginstatus.ts pluginsInstalled, the Overview's count too). */
function pluginCount(tool: HarnessId): Count | null {
  const plugins = pluginsInstalled(state.home, tool);
  if (plugins.state === 'unsupported') return { value: '—', note: takesItemsOnly(names[tool]), faint: true };
  if (plugins.state === 'unknown') return { value: '?', note: 'its record couldn’t be read', faint: true };
  return plugins.count ? { value: String(plugins.count), note: 'installed' } : null;
}

/** What needs a look on a card, each a link: differing copies (to that kind's tab, showing only those) and read problems (to About). */
function attentionLinks(snapshot: Snapshot, kinds: ReturnType<typeof tally>[]) {
  const tool = snapshot.harness;
  const issues = readProblems(snapshot);
  const link = (id: string, glyph: 'diff' | 'triangle-alert', text: string, open: () => void) =>
    h('button.harness-card-attention', { type: 'button', id, disabled: !!state.busy, onclick: open }, icon(glyph, 13), text, icon('arrow-right', 12));
  const links = [
    ...kinds.filter(({ differing }) => differing).map(({ kind, differing }) => link(`harness-${tool}-differ-${kind}`, 'diff', `${differing} ${(differing === 1 ? kindNouns[kind].one : kindNouns[kind].many)} with different copies`,
      () => goHarness(tool, kind, { showOnly: kind }))),
    ...(issues.length ? [link(`harness-${tool}-problems`, 'triangle-alert', plural(issues.length, 'read problem'), () => goHarness(tool, 'about'))] : []),
  ];
  return links.length ? h('div.harness-card-links', {}, links) : null;
}

/**
 * One harness on the list. A managed tool's heading opens its page, and its card shows its counts and Manage switch;
 * a tool left out has its name, how it was found, its switch and its folder, and does not open; a tool not found has nothing
 * to count, so its card is its name, how to fix that, and its folder, and does not open.
 */
function summaryCard(snapshot: Snapshot, home: HomeView, showManageInfo = false) {
  const tool = snapshot.harness;
  const here = managed(home, tool), installed = home.sync.present.includes(tool);
  const title = [brandMark(tool, 18), h('strong.harness-card-name', {}, names[tool])];
  // While an action runs, its result belongs to the harness it started on: the heading waits.
  const head = here
    ? h('button.harness-card-head', { type: 'button', id: `harness-${tool}`, disabled: !!state.busy, 'aria-label': `${names[tool]}. Open its page.`, onclick: () => goHarness(tool) },
      ...title, icon('arrow-right', 14))
    : h('span.harness-card-head', {}, ...title);
  // On this computer each card says how its tool was found; a sample or chosen folder is said once, in the note above.
  const status = home.mode === 'actual' ? h(`span.harness-card-status${installed ? '' : '.tone-faint'}`, {}, detectionLine(snapshot, home)) : null;
  const path = h('span.harness-card-path', { title: snapshot.root }, h('span.mono', {}, shownPath(snapshot.root)));
  if (installed && !here) return h('div.card.harness-card.harness-card-out', { id: `harness-${tool}`, 'aria-label': `${names[tool]}: not managed` },
    h('div.harness-card-main', {}, head, status, h('span.harness-card-next', {}, `Left out: Central Knot writes nothing in ${names[tool]}. Its switch asks before managing it again.`)), manageRow(home, tool), path);
  if (!here) return h('div.card.harness-card.harness-card-missing', { id: `harness-${tool}`, 'aria-label': `${names[tool]}: not found` },
    // When no tool at all was found, the note above already says to install one; each card need not repeat it.
    h('div.harness-card-main', {}, head, status, home.sync.present.length ? h('span.harness-card-next', {}, `Install ${names[tool]}, then Refresh.`) : null), path);
  const kinds = KINDS.map(kind => tally(home, kind, tool));
  const kindRows = kinds.map(entry => countRow(tabLabel(entry.kind), kindCount(home, entry, tool))).filter((row): row is HTMLElement => !!row);
  const extraRows = [countRow(tabLabel('instructions'), instructionCount(tool)), countRow(tabLabel('plugins'), pluginCount(tool)),
    // Cowork comes with Claude desktop and is no tool here: it uses the Claude account's plugins, said once on Claude Code's card.
    tool === 'claude-cli' && hasCowork(home.snapshots) ? countRow('Cowork', { value: '—', note: coworkWords.card, faint: true }) : null]
    .filter((row): row is HTMLElement => !!row);
  const groups = [kindRows, extraRows].filter(rows => rows.length);
  // Two groups (the three kinds, then its file and plugins), which sit side by side on a wide card.
  const body = [head, status, groups.length ? h('span.harness-counts', {}, groups.map(rows => h('span.harness-count-group', {}, rows))) : null];
  return h('div.card.harness-card', {},
    h('div.harness-card-main', {}, body),
    attentionLinks(snapshot, kinds), manageRow(home, tool, showManageInfo), path);
}

/**
 * The one way to move within Harnesses: to a harness's page (on `tab` if given, else the tab last used) or, with no harness,
 * back to the list. The last action's result and what the last page showed stay behind; another harness starts with its
 * tables closed and Copies differ filters off. `showOnly`: open that kind's tab showing only items whose copies differ.
 * `fromKeyboard`: going back to the list from the keyboard puts focus (and its ring) on the harness's heading; a mouse return leaves it alone.
 */
export function goHarness(tool: HarnessId | undefined, tab?: HarnessTab, { fromKeyboard = true, showOnly }: { fromKeyboard?: boolean; showOnly?: PageKind } = {}) {
  noteMove();
  const from = state.harness;
  if (tool !== from) resetTablesForHarness();
  state.harness = tool;
  if (tab) state.harnessTab = tab;
  if (showOnly && tool) showFiltered(showOnly, 'attention', tool);
  // A home switch's result (and its Go back) survives one move, as it does across pages.
  leaveResults();
  rerender();
  if (tool) document.getElementById('harness-body')?.scrollTo(0, 0);
  else if (from && fromKeyboard) document.getElementById(`harness-${from}`)?.focus();
}

/**
 * Apps found on this computer that run the tools or read their files without being a tool Central Knot manages (T3 Code,
 * VS Code): each named once, with its version and what it means for what is set up here. Nothing when none is installed.
 */
function otherApps(home: HomeView) {
  const apps = home.otherApps ?? [];
  if (!apps.length) return null;
  return h('section.other-apps', { id: 'other-apps', 'aria-label': `Also on ${thisMachine}` },
    h('h2.other-apps-title', {}, `Also on ${thisMachine}`),
    h('ul', {}, apps.map(app => h('li.other-app', {}, h('strong.other-app-name', {}, app.name, app.version ? h('span.other-app-version', {}, ` ${shortBuild(app.version)}`) : null), h('span.other-app-says', {}, app.says)))));
}

function everyHarness(home: HomeView) {
  const cards = listed(home);
  // What the passes since the last read copied where it was missing, every kind's: news on this list.
  const caught = caughtUpBand(home);
  // A home with no tools says so as every page does, with another home to choose; on this computer, which tools were looked for.
  // (A home whose tools are all left out lists them, each with its switch.)
  if (!home.sync.present.length) {
    const looked = home.mode === 'actual' ? `Not found on ${thisMachine}: ${andList(home.snapshots.map(snapshot => names[snapshot.harness]))}. Central Knot looks for them again each time it reads this home.` : undefined;
    return h('div.page', {}, noToolsState('harnesses', looked));
  }
  const locked = manageLocked(home);
  const notes: Child[][] = [
    // Where no Manage switch can be turned, said once here (each disabled switch's tooltip says it too).
    ...(locked ? [[locked]] : []),
    ...(home.mode === 'actual' ? [] : [[home.mode === 'fixture' ? 'Practice copy: installed apps aren’t checked; ' : 'A folder: installed apps aren’t checked; ',
      button({ variant: 'link', size: 'micro', label: realHomeName, id: 'tools-open-real', disabled: acting(), onclick: () => void loadHome('actual') }), ' shows their versions.']]),
    // A profile switches items in every tool at once, so the one in use is said once here, as Profiles names it.
    ...(home.profiles.profiles.length ? [['Profile in use: ', button({ variant: 'link', size: 'micro', label: inUseName(home.profiles.profiles, homeItems(home), pluginLive(home)), id: 'harnesses-profile', onclick: () => showPage('profiles') }), '.']] : []),
  ];
  const firstManaged = cards.find(snapshot => managed(home, snapshot.harness))?.harness;
  return h('div.page', {}, caught ? h('div.bands', {}, caught) : null,
    h('div.scroll.harness-scroll', { id: 'harnesses-scroll' },
      notes.length ? h('p.tools-note', {}, icon('info', 14, 'tone-muted'), h('span', {}, notes.flatMap((part, index) => (index ? [' ', ...part] : part)))) : null,
      h('div.harness-cards', { 'data-count': String(cards.length) }, cards.map(snapshot => summaryCard(snapshot, home, snapshot.harness === firstManaged))),
      otherApps(home)));
}

// ---------- One harness ----------

/** The tabs, each kind with its count. While an action runs they stay put, so its result lands on the tab it was started from. */
function tabs(home: HomeView, tool: HarnessId) {
  // A count, a dash where the tool doesn't use that kind (as on its card), or nothing (Instructions, About, still reading).
  // Kinds count copies here and elsewhere directly: tabs redraw on every Find keystroke, so no differing-copies work here.
  const count = (tab: HarnessTab): { shown: number | '—'; elsewhere: number } | undefined => {
    if (tab === 'plugins') { const plugins = pluginsInstalled(state.home, tool); return plugins.state === 'unknown' ? undefined : { shown: plugins.state === 'read' ? plugins.count : '—', elsewhere: 0 }; }
    if (!isKind(tab)) return undefined;
    if (!supports(home, tab, tool)) return { shown: '—', elsewhere: 0 };
    const facts = kindSource(home, tab).facts;
    const here = facts.filter(item => inTool(item, tool)).length;
    return { shown: here + pluginItemCount(home, tab, tool), elsewhere: facts.length - here };
  };
  return h('div.harness-tabs', { role: 'tablist', 'aria-label': `${names[tool]}` },
    TABS.map(tab => {
      const counted = count(tab);
      // A kind this tool cannot hold shows no count and a quieter tab; its tooltip and its page say why.
      return h(`button.harness-tab${state.harnessTab === tab ? '.selected' : ''}${counted?.shown === '—' ? '.harness-tab-none' : ''}`, {
        type: 'button', role: 'tab', id: `harness-tab-${tab}`, 'aria-selected': String(state.harnessTab === tab), disabled: !!state.busy && state.harnessTab !== tab,
        title: !counted ? undefined : counted.shown === '—' ? (isKind(tab) ? kindNotUsed(tool, tab) : takesItemsOnly(names[tool])) : `${counted.shown} in ${names[tool]}${counted.elsewhere ? ` · ${counted.elsewhere} only in other tools` : ''}`,
        onclick: () => goHarness(tool, tab),
      }, tabLabel(tab), counted && counted.shown !== '—' && counted.shown > 0 ? h('span.harness-tab-count', {}, String(counted.shown)) : null);
    }));
}

/** Moves between managed harnesses without going back to the list. */
function switcher(home: HomeView, tool: HarnessId) {
  const others = home.sync.managed;
  if (others.length < 2) return null;
  return h('div.harness-switch', { role: 'group', 'aria-label': 'Other harnesses' }, others.map(other => h(`button.harness-switch-item${other === tool ? '.selected' : ''}`, {
    type: 'button', id: `harness-switch-${other}`, 'aria-pressed': String(other === tool), title: names[other], disabled: !!state.busy && other !== tool,
    onclick: () => { if (other !== tool) goHarness(other); },
  }, brandMark(other, 14), h('span.harness-switch-name', {}, names[other]))));
}

/** A kind the tool has no place for: said in place of its table. */
function unsupported(kind: PageKind, tool: HarnessId) {
  return h('div.page', {}, emptyState('plug', kindNotUsed(tool, kind), `Central Knot can’t read or write ${kindNouns[kind].many} for ${names[tool]}.`));
}

function kindTab(home: HomeView, kind: PageKind, tool: HarnessId) {
  if (!supports(home, kind, tool)) return unsupported(kind, tool);
  if (rowCount(home, kind)) return itemsTable(kind, tool);
  // Nothing of this kind anywhere: the kind's own empty state, under the table's bands, so a file that could not be read still says why.
  const empty = kindEmpty(kind);
  return emptyList(emptyState(empty.glyph, empty.title, empty.body), { kind, tool });
}

/** This tool's instruction file, with the same card, bands and editor as the Instructions page. */
function instructionsTab(tool: HarnessId) {
  const file = instructionOf(tool);
  const body = !state.instructions.data ? instructionsNotRead()
    : !file ? h('p.empty', {}, `${names[tool]} has no instruction file Central Knot reads.`)
      : [h('div.ins-about-line', {}, aboutInstructions([file], false),
        button({ variant: 'link', size: 'micro', label: 'Every tool’s file', id: 'harness-all-instructions', onclick: () => showPage('instructions') })), instructionCard(file, { titled: false, goToOther: other => goHarness(other, 'instructions') })];
  return h('div.page', {}, instructionBands(), h('div.scroll.harness-scroll', { id: 'harness-body' }, body));
}

/** One installed plugin: its name (with marketplace when ambiguous), recorded version, live click or state line, Uninstall…, quiet Its page, and that tool's switch (pluginstate.ts lineBox). */
function pluginRow({ entry, plugin, version }: InstalledMarketPlugin, tool: HarnessId, showMarket = false) {
  const note = [marketTitle(entry), plugin.description].filter(Boolean).join(' · ');
  const { box, mark, words } = lineBox(plugin.name, entry.name, entry.source, tool);
  const own = typeof box === 'object' ? box : undefined;
  const live = clickOn(entry.source, plugin.name);
  const pending = live && live.state !== 'ended' ? live : undefined;
  const liveText = pending ? (pending.state === 'waiting' ? pending.said.waiting : pending.said.running) : undefined;
  const liveRow = pending && (!pending.tool || pending.tool === tool) ? h('span.plugin-click', { 'data-click': pending.state }, pending.state === 'waiting' ? icon('clock', 12) : icon('refresh-cw', 12, 'spin'), h('span', {}, liveText)) : null;
  const stateText = own ? own.line ?? (mark && (mark === 'kept-off' || mark === 'stays' || own.held) ? MARK_WORDS[mark] : undefined) : undefined;
  const does = own && mark && market.view ? boxDoes(market.view, entry, plugin.name, tool, mark, own.ticked, true) : undefined;
  const disabled = own?.off || liveText || state.busy || pluginBusy(entry.source, plugin.name);
  const pageLink = button({ variant: 'ghost', size: 'small', label: 'Its page', name: `Open ${pluginTitle(plugin)} in ${pageNames.plugins}`, id: `harness-plugin-${entry.name}-${plugin.name}`,
    onclick: () => { showPage('plugins'); browse({ source: entry.source, plugin: plugin.name, tab: 'plugins', find: '', category: undefined, hookTool: tool }); } });
  const control = own ? toggle({ on: own.ticked, label: `${pluginTitle(plugin)} in ${names[tool]}`, disabled, attrs: does ? { title: does, 'aria-description': does } : {},
    id: `harness-plugin-switch-${entry.name}-${plugin.name}`, onchange: () => turnPlugin(entry, plugin.name, own.ticked ? 'keep-out' : 'let-in', tool) }) : null;
  const [uninstall, question] = own ? uninstallControl(entry, plugin, tool, `harness-plugin-uninstall-${entry.name}-${plugin.name}`, own) : [null, null];
  return h('div.harness-plugin', { role: 'listitem', title: note || undefined },
    h('div.harness-plugin-text', {},
      h('strong', {}, pluginTitle(plugin), version ? h('span.harness-plugin-version', {}, ` ${version}`) : null, showMarket ? h('span.harness-plugin-market', {}, ` · ${marketTitle(entry)}`) : null),
      liveRow ?? (stateText ? h('span.harness-plugin-state', { title: words }, stateText) : null)),
    uninstall, pageLink, control, question);
}

function pluginsTab(tool: HarnessId) {
  const plugins = pluginsIn(tool);
  const page = (...body: (Node | null)[]) => h('div.page', {}, h('div.scroll.harness-scroll', { id: 'harness-body' }, body));
  if (plugins.state === 'reading') return page(h('p.empty', {}, 'Reading marketplaces…'));
  if (plugins.state === 'failed') return page(emptyState('circle-alert', 'Marketplaces could not be read', 'Nothing changed.', button({ label: 'Try again', id: 'harness-plugins-retry', onclick: () => void loadPlugins(false, state.home?.readId) })));
  if (plugins.state === 'unsupported') {
    // Only the tools that take a plugin whole are named as where plugins install; this one takes a plugin's items.
    const takers = (market.view?.tools ?? []).filter(takesPlugins);
    return page(emptyState('puzzle', takesItemsOnly(names[tool]), `${takers.length ? `Central Knot installs marketplace plugins into ${andList(takers.map(each => names[each]))}. A plugin’s page on ${pageNames.plugins} puts ${takenItems([tool])} in ${names[tool]} as items of Central Knot’s that follow the plugin. ` : ''}${names[tool]}’s own ${tool === 'antigravity-cli' ? 'plugins' : 'packages'} stay as they are.`));
  }
  // What could not be checked is said, so the list is never taken for everything installed.
  const unsure = [...plugins.unknown.map(({ plugin, reason }) => `${pluginTitle(plugin)}: ${reason}`), ...plugins.unreadable.map(name => `${name} could not be read.`)];
  const unsureNote = unsure.length ? h('p.tools-note', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span', {}, `Not known for ${plural(unsure.length, 'plugin')}: ${unsure.join(' ')} `,
    button({ variant: 'link', size: 'micro', label: `Open ${pageNames.plugins}`, id: 'harness-plugins-unsure', onclick: () => showPage('plugins') }))) : null;
  // Counted too (pluginstatus.ts pluginsInstalled), with no page on the Plugins page: those the tool records from a marketplace no tool lists, excluding real installs already shown above (e.g. Anthropic Directory matches).
  const shownIds = new Set(plugins.installed.map(item => item.id));
  const unlisted = (state.home?.pluginItems ?? []).filter(install => install.tool === tool && !install.listed && !shownIds.has(`${install.plugin}@${install.marketName}`));
  const unlistedNote = unlisted.length ? h('p.tools-note', { id: 'harness-plugins-unlisted' }, icon('info', 14, 'tone-muted'),
    `Installed from a marketplace not on ${pageNames.plugins}: ${andList(unlisted.map(install => `${install.plugin} (${install.marketName})`))}.`) : null;
  // Where the tool's own record can't be read, what it has isn't known: never "No plugins".
  const unread = pluginsInstalled(state.home, tool).state === 'unknown' ? h('p.tools-note', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), `What ${names[tool]} has installed isn’t known: its own record of its plugins couldn’t be read.`) : null;
  if (unread && !plugins.installed.length && !unlisted.length) return page(unread, unsureNote);
  if (!plugins.installed.length && !unlisted.length) return page(unsureNote, emptyState('puzzle', `No plugins in ${names[tool]}`, `None of the plugins in your marketplaces is installed in ${names[tool]}.`,
    button({ variant: 'outline', label: 'Browse plugins', id: 'harness-browse-plugins', onclick: () => showPage('plugins') })));
  const stopped = plugins.installed.length && market.view ? viewStopped(market.view) : undefined;
  const stoppedNote = stopped ? h('p.tools-note', { id: 'harness-plugins-stopped' }, icon(market.view?.canWrite ? 'circle-alert' : 'eye', 14, market.view?.canWrite ? 'tone-warning' : 'tone-muted'), stopped) : null;
  const titleCounts = new Map<string, number>();
  for (const { plugin } of plugins.installed) {
    const title = pluginTitle(plugin).toLowerCase();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  return page(unread, unsureNote, unlistedNote, stoppedNote,
    plugins.installed.length ? h('div.harness-plugins', { role: 'list' }, plugins.installed.map(item => pluginRow(item, tool, (titleCounts.get(pluginTitle(item.plugin).toLowerCase()) ?? 0) > 1))) : null);
}

/** Where the tool's files are, how it was found, and which other products read them. */
function aboutTab(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const disclosed = home.sync.writes[tool];
  const roots = new Map(snapshot.skills.map(skill => [dirname(skill.directory), skill.rootLabel]));
  const issues = readProblems(snapshot);
  // Every path can be copied.
  let copies = 0;
  const path = (value: string) => h('span.harness-path', {}, pathText(shownPath(value), value), copyButton(value, 'path', `copy-path-${tool}-${copies++}`));
  const fileFor = (kind: 'mcp' | 'agents') => kindSource(home, kind).facts.map(item => item.copies[tool]?.directory).find(Boolean);
  const mcpFile = fileFor('mcp'), agentFile = fileFor('agents');
  const ins = instructionOf(tool);
  return h('div.page', {}, h('div.scroll.harness-scroll', { id: 'harness-body' }, h('div.card.harness-about', {},
    h('div.harness-about-column', {},
      section('This harness', h('dl.facts', {},
        ...fact('Found as', detectionLine(snapshot, home)),
        ...(home.mode === 'actual' && snapshot.detection !== 'Installed' && snapshot.detection !== 'App only' ? fact('Version', snapshot.probe.version ?? snapshot.probe.detail) : []),
        ...fact('Read by', h('span', {}, [fullToolName(snapshot), ...(disclosed?.alsoReadBy ?? [])].join(', '))),
        ...fact('Config folder', path(snapshot.root)))),
      issues.length > 0 && section('Read problems', h('ul.plain-list', { role: 'status' }, issues.map(issue => h('li', {}, issue))))),
    h('div.harness-about-column', {},
      section('Files and folders', h('dl.facts', {},
        ...[...roots].flatMap(([root, label], index) => fact(index === 0 ? 'Skills folder' : label, path(root))),
        ...(!roots.size && disclosed?.to && !disclosed.blocked ? fact('Skills folder', h('span.harness-path', {}, path(disclosed.to), h('span.tone-faint', {}, '(empty; new skills go here)'))) : []),
        ...(disclosed && roots.size && !(disclosed.to && roots.has(disclosed.to)) ? fact('New skills go to', disclosed.blocked ? h('span', {}, h('span.tone-warning', {}, 'Nowhere. '), disclosed.blocked) : path(disclosed.to)) : []),
        ...(supports(home, 'mcp', tool) ? fact('MCP servers file', mcpFile ? path(mcpFile) : h('span.tone-faint', {}, '— (no MCP servers found)')) : []),
        // Where it keeps agents (presence.ts agentsKeptIn): its agents folder, or (Pi) its skills folder, shown above.
        ...(!supports(home, 'agents', tool) ? [] : agentsKeptIn[tool as AgentTool] === 'skills folder' ? fact('Agents', h('span.tone-faint', {}, 'In its skills folder, each as a skill'))
          : fact('Agents folder', agentFile ? path(dirname(agentFile)) : h('span.tone-faint', {}, '— (no agents found)'))),
        ...(ins ? fact('Instructions', h('span.harness-path', {}, path(ins.path), ins.exists ? null : h('span.tone-faint', {}, '(no file yet)'))) : [])))))));
}

function oneHarness(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const tab = state.harnessTab;
  const body = isKind(tab) ? kindTab(home, tab, tool) : tab === 'instructions' ? instructionsTab(tool) : tab === 'plugins' ? pluginsTab(tool) : aboutTab(snapshot, home);
  body.classList.add('harness-tab-body');
  // The window's header names the harness (harnessTitle); its tabs and the switcher to the others share one row below it.
  return h('div.page.harness-page', {}, h('div.harness-bar', {}, tabs(home, tool), switcher(home, tool)), body);
}

/** The harness whose page is open, if it is still in this home and managed. */
const openSnapshot = (home: HomeView): Snapshot | undefined =>
  state.harness && managed(home, state.harness) ? home.snapshots.find(entry => entry.harness === state.harness) : undefined;

/** The header title on a harness's page: "Harnesses" as the way back, then the harness and how it was found. Undefined on the list. */
export function harnessTitle(): (Node | null)[] | undefined {
  const snapshot = state.home && openSnapshot(state.home);
  if (!snapshot || !state.home) return undefined;
  const tool = snapshot.harness;
  return [
    h('button.crumb-link.title-crumb', { type: 'button', id: 'harness-back', title: 'Back to every harness', disabled: !!state.busy, onclick: (event: MouseEvent) => goHarness(undefined, undefined, { fromKeyboard: event.detail === 0 }) }, icon('arrow-left', 14), 'Harnesses'),
    h('span.crumb-sep', { 'aria-hidden': 'true' }, '/'),
    brandMark(tool, 16), h('span.title-harness', {}, names[tool]),
    // A sample or chosen folder is said once, on the list's note; the header names installed state on this computer only.
    state.home.mode === 'actual' ? h('span.title-note', { title: snapshot.root }, detectionLine(snapshot, state.home)) : null,
  ];
}

export function harnessesPage() {
  const home = state.home;
  if (!home) return notRead();
  // A harness no longer managed (uninstalled, or its switch turned off) falls back to the list (harnessTabShown agrees); a home switch already closed any open harness (accept()).
  const snapshot = openSnapshot(home);
  return snapshot ? oneHarness(snapshot, home) : everyHarness(home);
}
