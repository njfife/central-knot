// Harnesses: one place per tool. The list sums up what each one has; a harness's own page manages its items with the same
// tables, switches and Apply all as the Skills, MCP servers and Agents pages, narrowed to that tool, plus its instruction
// file and its plugins. Nothing here has its own engine: every change goes through the pages it mirrors.
import { KINDS, dropActionResults, instructionReadState, isKind, loadHome, readInstructionsQuietly, rerender, shownPath, showPage, state, type HarnessTab } from './app.ts';
import { installsIn, type MarketPlugin } from './pluginstatus.ts';
import { pluginTitle } from './pluginparts.ts';
import { button, emptyState, h, icon, pathText, section } from './dom.ts';
import { caughtUpNames, fileName, fullToolName, plural } from './model.ts';
import { toolNames as names } from './words.ts';
import type { HarnessId, HomeView, InstructionFile, SkillFacts, Snapshot } from './types.ts';
import type { Kind } from './app.ts';
import { brandMark, caughtUpBand, closeOpenRows, designOverview, differingIn, emptyKind, kindNoun, outcomeBand, showFiltered } from './matrix.ts';
import { instructionBands, instructionCard, instructionsNotRead } from './instructionspage.ts';
import { browse, market, peekPlugins, peekState } from './pluginstate.ts';
import { copyButton, fact, kindEmpty } from './pages.ts';
import { realHomeName, titles } from './renderer.ts';

const TABS: HarnessTab[] = ['skills', 'mcp', 'agents', 'instructions', 'plugins', 'about'];
/** A tab's name: the page of the same name's title. Looked up when drawn: renderer.ts, which holds the titles, imports this module. */
const tabLabel = (tab: HarnessTab) => (tab === 'about' ? 'About' : titles[tab]);

/** A backslash separates folders only on Windows; elsewhere it can be part of a skill's name. */
const dirname = (path: string) => path.replace(/^[A-Za-z]:\\/.test(path) ? /[/\\][^/\\]*$/ : /\/[^/]*$/, '');

/** What could not be read in this tool's folders (a missing skills folder is not a problem). */
const readProblems = (snapshot: Snapshot) => (snapshot.discovery === 'missing' ? [] : snapshot.issues);

/** The harnesses this home shows: this computer's home lists every tool, found or not; a folder only the ones it has. */
const listed = (home: HomeView) => home.snapshots.filter(snapshot => home.mode === 'actual' || found(home, snapshot.harness));
/** Found: Central Knot reads and writes it, so it has a page. */
function found(home: HomeView, tool: HarnessId) { return home.manage.tools.includes(tool); }

/** One kind's facts across tools, and which tools can hold that kind at all (Pi has no agents). */
function kindView(home: HomeView, kind: Kind): { tools: HarnessId[]; facts: SkillFacts[]; waiting: string[] } {
  if (kind === 'skills') return { tools: home.manage.tools, facts: home.manage.skills, waiting: [] };
  const view = kind === 'mcp' ? home.mcp : home.agents;
  return { tools: view.tools, facts: view.servers, waiting: view.claudePending };
}
const supports = (home: HomeView, kind: Kind, tool: HarnessId) => kindView(home, kind).tools.includes(tool);

/**
 * What one tool has of one kind: every item with a copy there, how many of those are managed, and how many have copies that
 * differ and need a choice (the same count as that tool's "Copies differ" chip). `supported`: the tool can hold this kind.
 */
function tally(home: HomeView, kind: Kind, tool: HarnessId) {
  const { tools, facts, waiting } = kindView(home, kind);
  const here = facts.filter(item => item.copies[tool] !== undefined);
  return { kind, supported: tools.includes(tool), total: here.length, managed: here.filter(item => item.managed).length, differing: differingIn(facts, tools, tool, waiting) };
}

const instructionOf = (tool: HarnessId): InstructionFile | undefined => state.instructions?.find(file => file.tool === tool);

/**
 * Plugins in this tool: `reading` or `failed` while the marketplaces are not read (the last good read is kept and shown), `unsupported`
 * when this tool takes no marketplace plugins (Pi), else what installsIn found.
 */
type PluginsHere = { state: 'reading' } | { state: 'failed' } | { state: 'unsupported' } | ({ state: 'read' } & NonNullable<ReturnType<typeof installsIn>>);
function pluginsIn(tool: HarnessId): PluginsHere {
  const view = market.view;
  if (!view) return peekState() === 'failed' ? { state: 'failed' } : { state: 'reading' };
  const installs = installsIn(view, tool);
  return installs ? { state: 'read', ...installs } : { state: 'unsupported' };
}

/** What a tool that takes no marketplace plugins (Pi) says about them: on its card, its tab's tooltip and its Plugins tab. */
const pluginsNotHandled = (tool: HarnessId) => `Central Knot doesn’t move ${names[tool]}’s plugins`;

/** Header Refresh on Harnesses: instruction files and installs are read again along with the home. */
export function refreshHarnessExtras() { readInstructionsQuietly(true); peekPlugins(true); }

/** How the tool was found, short: a sample or chosen folder is only a folder; on this computer, installed (with its version) or not. */
const detectionLine = (snapshot: Snapshot, home: HomeView) => {
  if (home.mode === 'fixture') return 'Sample folder';
  if (home.mode === 'custom') return 'Folder only';
  if (snapshot.detection === 'Installed') return `Installed${snapshot.probe.version ? ` · ${snapshot.probe.version}` : ''}`;
  return snapshot.probe.detail.startsWith('ChatGPT desktop') ? 'ChatGPT desktop’s Codex' : snapshot.detection;
};

// ---------- Every harness ----------

type Count = { value: string; note?: string; faint?: boolean };
/** One line of a card's counts: what, how many, and a short note. `faint` for a count that is not there or not known. */
function countRow(label: string, { value, note, faint = false }: Count) {
  return h('div.harness-count', {}, h('span.harness-count-label', {}, label), h(`span.harness-count-value${faint ? '.tone-faint' : ''}`, {}, value), h('span.harness-count-note', {}, note ?? ''));
}

function kindCount({ kind, supported, total, managed }: ReturnType<typeof tally>, tool: HarnessId): Count {
  if (!supported) return { value: '—', note: `${names[tool]} doesn’t use ${kindNoun[kind][1]}`, faint: true };
  if (!total) return { value: '0', note: 'none yet', faint: true };
  return { value: String(total), note: managed === total ? 'all managed' : !managed ? 'none managed' : `${managed} managed · ${total - managed} unmanaged` };
}

function instructionCount(tool: HarnessId): Count {
  // Files already read stay shown if a later read fails, here as on the Instructions tab.
  if (!state.instructions) return instructionReadState() === 'failed' ? { value: '—', note: 'couldn’t be read', faint: true } : { value: '…', faint: true };
  // A file, not a number: its name and length, or that there is none yet.
  const file = instructionOf(tool);
  if (!file) return { value: '—', faint: true };
  if (!file.exists) return { value: '', note: 'no file yet' };
  // Its name alone, so the note keeps to one line on a narrow card; an empty file says so.
  return { value: '', note: file.text.trim() ? fileName(file.path) : `${fileName(file.path)} (empty)` };
}

function pluginCount(tool: HarnessId): Count {
  const plugins = pluginsIn(tool);
  if (plugins.state === 'reading') return { value: '…', faint: true };
  if (plugins.state === 'failed') return { value: '—', note: 'couldn’t be read', faint: true };
  if (plugins.state === 'unsupported') return { value: '—', note: pluginsNotHandled(tool), faint: true };
  const unsure = plugins.unknown.length + plugins.unreadable.length > 0;
  return { value: String(plugins.installed.length), note: [plugins.installed.length ? 'installed' : 'none installed', unsure ? 'some not known' : ''].filter(Boolean).join(' · '), faint: !plugins.installed.length };
}

/** What needs a look on a card, each a link: differing copies (to that kind's tab, showing only those) and read problems (to About). */
function attentionLinks(snapshot: Snapshot, kinds: ReturnType<typeof tally>[]) {
  const tool = snapshot.harness;
  const issues = readProblems(snapshot);
  const link = (id: string, glyph: 'diff' | 'triangle-alert', text: string, open: () => void) =>
    h('button.harness-card-attention', { type: 'button', id, disabled: !!state.busy, onclick: open }, icon(glyph, 13), text, icon('arrow-right', 12));
  const links = [
    ...kinds.filter(({ differing }) => differing).map(({ kind, differing }) => link(`harness-${tool}-differ-${kind}`, 'diff', `${differing} ${kindNoun[kind][differing === 1 ? 0 : 1]} with different copies`,
      () => { goHarness(tool, kind); showFiltered(kind, 'attention'); rerender(); })),
    ...(issues.length ? [link(`harness-${tool}-problems`, 'triangle-alert', plural(issues.length, 'read problem'), () => goHarness(tool, 'about'))] : []),
  ];
  return links.length ? h('div.harness-card-links', {}, links) : null;
}

const missing: Count = { value: '—', faint: true };

/** One harness on the list: the whole card opens its page; a tool that was not found says so and does not open. */
function summaryCard(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const kinds = KINDS.map(kind => tally(home, kind, tool));
  const body = [
    h('span.harness-card-head', {}, brandMark(tool, 18), h('strong.harness-card-name', {}, names[tool]), found(home, tool) ? icon('arrow-right', 14, 'tone-faint') : null),
    // On this computer each card says how its tool was found; a sample or chosen folder is said once, in the note above.
    home.mode === 'actual' ? h(`span.harness-card-status${snapshot.detection === 'Not found' ? '.tone-faint' : ''}`, {}, detectionLine(snapshot, home)) : null,
    // Two groups (the three kinds, then its file and plugins), which sit side by side on a wide card. A tool not found on this
    // computer has nothing to count: its rows are plain dashes, and its card says so.
    h('span.harness-counts', {},
      h('span.harness-count-group', {}, kinds.map(entry => countRow(tabLabel(entry.kind), found(home, tool) ? kindCount(entry, tool) : missing))),
      h('span.harness-count-group', {}, countRow(tabLabel('instructions'), found(home, tool) ? instructionCount(tool) : missing), countRow(tabLabel('plugins'), found(home, tool) ? pluginCount(tool) : missing))),
  ];
  const path = h('span.harness-card-path', { title: snapshot.root }, h('span.mono', {}, shownPath(snapshot.root)));
  if (!found(home, tool)) return h('div.card.harness-card.harness-card-missing', { id: `harness-${tool}`, 'aria-label': `${names[tool]}: not found` },
    // When no tool at all was found, the note above already says to install one; each card need not repeat it.
    h('div.harness-card-main', {}, body, home.manage.tools.length ? h('span.harness-card-next', {}, `Install ${names[tool]}, then Refresh.`) : null), path);
  // While an action runs, its result belongs to the harness it started on: the cards wait.
  return h('div.card.harness-card', {},
    h('button.harness-card-main', { type: 'button', id: `harness-${tool}`, disabled: !!state.busy, 'aria-label': `${names[tool]}: ${detectionLine(snapshot, home)}. Open its page.`, onclick: () => goHarness(tool) }, body),
    attentionLinks(snapshot, kinds), path);
}

/**
 * The one way to move within Harnesses: to a harness's page (on `tab` if given, else the tab last used) or, with no harness,
 * back to the list. The last action's result and what the last page showed stay behind; another harness starts with its
 * tables closed and Copies differ filters off.
 */
/** `fromKeyboard`: going back to the list shows the focus ring on the card only when the way back was taken from the keyboard. */
export function goHarness(tool: HarnessId | undefined, tab?: HarnessTab, fromKeyboard = true) {
  const from = state.harness;
  if (tool !== from) closeOpenRows();
  state.harness = tool;
  if (tab) state.harnessTab = tab;
  // A home switch's result (and its Go back) survives one move, as it does across pages.
  const carried = state.outcome?.carry ? { ...state.outcome, carry: false } : undefined;
  dropActionResults();
  state.outcome = carried;
  rerender();
  if (tool) document.getElementById('harness-body')?.scrollTo(0, 0);
  else if (from) document.getElementById(`harness-${from}`)?.focus({ focusVisible: fromKeyboard } as FocusOptions);
}

function everyHarness(home: HomeView) {
  const done = outcomeBand();
  // What the read's catch-up copied is news here too, not only on the Skills tables.
  const caught = caughtUpBand(home.manage, caughtUpNames(home.manage, new Set(home.manage.notices.map(notice => notice.item))));
  return h('div.page', {}, done || caught ? h('div.bands', {}, done, caught) : null,
    h('div.scroll.harness-scroll', { id: 'harnesses-scroll' },
      h('p.tools-note', {}, icon('info', 14, 'tone-muted'),
        h('span', {}, home.manage.tools.length ? 'Each AI coding tool and what it has. Open one to manage its skills, MCP servers, agents, instructions and plugins.'
          : 'None of the AI coding tools Central Knot knows was found here. Install one, then Refresh.',
          home.mode === 'actual' ? null : [home.mode === 'fixture' ? ' Practice copy: installed apps aren’t checked; ' : ' A folder: installed apps aren’t checked; ',
            button({ variant: 'link', size: 'micro', label: realHomeName, id: 'tools-open-real', onclick: () => void loadHome('actual') }), ' shows their versions.'])),
      h('div.harness-cards', { 'data-count': String(listed(home).length) }, listed(home).map(snapshot => summaryCard(snapshot, home)))));
}

// ---------- One harness ----------

/** The tabs, each kind with its count. While an action runs they stay put, so its result lands on the tab it was started from. */
function tabs(home: HomeView, tool: HarnessId) {
  // A count, a dash where the tool doesn't use that kind (as on its card), or nothing (Instructions, About, still reading).
  // Kinds count copies here and elsewhere directly: tabs redraw on every Find keystroke, so no differing-copies work here.
  const count = (tab: HarnessTab): { shown: number | '—'; elsewhere: number } | undefined => {
    if (tab === 'plugins') { const plugins = pluginsIn(tool); return plugins.state === 'read' ? { shown: plugins.installed.length, elsewhere: 0 } : plugins.state === 'unsupported' ? { shown: '—', elsewhere: 0 } : undefined; }
    if (!isKind(tab)) return undefined;
    if (!supports(home, tab, tool)) return { shown: '—', elsewhere: 0 };
    const facts = kindView(home, tab).facts;
    const here = facts.filter(item => item.copies[tool] !== undefined).length;
    return { shown: here, elsewhere: facts.length - here };
  };
  return h('div.harness-tabs', { role: 'tablist', 'aria-label': `${names[tool]}` },
    TABS.map(tab => {
      const counted = count(tab);
      // A kind this tool cannot hold shows no count and a quieter tab; its tooltip and its page say why.
      return h(`button.harness-tab${state.harnessTab === tab ? '.selected' : ''}${counted?.shown === '—' ? '.harness-tab-none' : ''}`, {
        type: 'button', role: 'tab', id: `harness-tab-${tab}`, 'aria-selected': String(state.harnessTab === tab), disabled: !!state.busy && state.harnessTab !== tab,
        title: !counted ? undefined : counted.shown === '—' ? (isKind(tab) ? `${names[tool]} doesn’t use ${kindNoun[tab][1]}` : pluginsNotHandled(tool)) : `${counted.shown} in ${names[tool]}${counted.elsewhere ? ` · ${counted.elsewhere} only in other tools` : ''}`,
        onclick: () => goHarness(tool, tab),
      }, tabLabel(tab), counted && counted.shown !== '—' ? h('span.harness-tab-count', {}, String(counted.shown)) : null);
    }));
}

/** Moves between found harnesses without going back to the list. */
function switcher(home: HomeView, tool: HarnessId) {
  const others = home.manage.tools;
  if (others.length < 2) return null;
  return h('div.harness-switch', { role: 'group', 'aria-label': 'Other harnesses' }, others.map(other => h(`button.harness-switch-item${other === tool ? '.selected' : ''}`, {
    type: 'button', id: `harness-switch-${other}`, 'aria-pressed': String(other === tool), title: names[other], disabled: !!state.busy && other !== tool,
    onclick: () => { if (other !== tool) goHarness(other); },
  }, brandMark(other, 14), h('span.harness-switch-name', {}, names[other]))));
}

/** A kind the tool has no place for (Pi's agents): what it has instead. */
function unsupported(kind: Kind, tool: HarnessId) {
  const body = kind === 'agents' ? `On the Agents page, Convert to skill turns an agent into a skill that ${names[tool]} can use.`
    : `Central Knot can’t read or write ${kindNoun[kind][1]} for ${names[tool]}.`;
  return h('div.page', {}, emptyState(kind === 'agents' ? 'bot' : 'plug', `${names[tool]} doesn’t use ${kindNoun[kind][1]}`, body,
    kind === 'agents' ? button({ variant: 'outline', label: 'Open Agents', id: 'harness-open-agents', onclick: () => showPage('agents') }) : undefined));
}

function kindTab(home: HomeView, kind: Kind, tool: HarnessId) {
  if (!supports(home, kind, tool)) return unsupported(kind, tool);
  if (kindView(home, kind).facts.length) return designOverview(kind, tool);
  // Nothing of this kind anywhere: the kind's own empty state, under the table's bands, so a file that could not be read still says why.
  return emptyKind(kind, tool, emptyState(kindEmpty[kind].glyph, kindEmpty[kind].title, kindEmpty[kind].body));
}

/** This tool's instruction file, with the same card, bands and editor as the Instructions page. */
function instructionsTab(tool: HarnessId) {
  const file = instructionOf(tool);
  const body = !state.instructions ? instructionsNotRead()
    : !file ? h('p.empty', {}, `${names[tool]} has no instruction file Central Knot reads.`)
      : [h('p.tools-note', {}, icon('info', 14, 'tone-muted'), 'Changes are reviewed before saving, and earlier versions are kept. ',
        button({ variant: 'link', size: 'micro', label: 'Every tool’s file', id: 'harness-all-instructions', onclick: () => showPage('instructions') })), instructionCard(file, { titled: false })];
  return h('div.page', {}, instructionBands(), h('div.scroll.harness-scroll', { id: 'harness-body' }, body));
}

/** One installed plugin: its name, version and marketplace, and Open, which shows it on the Plugins page. */
function pluginRow({ entry, plugin }: MarketPlugin) {
  return h('div.harness-plugin', { role: 'listitem' },
    h('div.harness-plugin-text', {},
      h('strong', {}, pluginTitle(plugin), plugin.version ? h('span.harness-plugin-version', {}, ` ${plugin.version}`) : null),
      h('span.harness-plugin-note', {}, [entry.name, plugin.description].filter(Boolean).join(' · '))),
    button({ variant: 'ghost', size: 'small', label: 'Open', name: `Open ${pluginTitle(plugin)} in Plugins`, id: `harness-plugin-${entry.name}-${plugin.name}`,
      onclick: () => { showPage('plugins'); browse({ source: entry.source, plugin: plugin.name, tab: 'plugins', find: '', category: undefined }); } }));
}

function pluginsTab(tool: HarnessId) {
  const plugins = pluginsIn(tool);
  const page = (...body: (Node | null)[]) => h('div.page', {}, h('div.scroll.harness-scroll', { id: 'harness-body' }, body));
  if (plugins.state === 'reading') return page(h('p.empty', {}, 'Reading marketplaces…'));
  if (plugins.state === 'failed') return page(emptyState('circle-alert', 'Marketplaces could not be read', 'Nothing changed.', button({ label: 'Try again', id: 'harness-plugins-retry', onclick: () => peekPlugins(true) })));
  if (plugins.state === 'unsupported') return page(emptyState('puzzle', pluginsNotHandled(tool), `Central Knot installs marketplace plugins into Claude Code, Copilot CLI and Codex. ${names[tool]}’s own packages stay as they are.`));
  // What could not be checked is said, so the list is never taken for everything installed.
  const unsure = [...plugins.unknown.map(({ plugin, reason }) => `${pluginTitle(plugin)}: ${reason}`), ...plugins.unreadable.map(name => `${name} could not be read.`)];
  const unsureNote = unsure.length ? h('p.tools-note', { role: 'status' }, icon('circle-alert', 14, 'tone-warning'), h('span', {}, `Not known for ${plural(unsure.length, 'plugin')}: ${unsure.join(' ')} `,
    button({ variant: 'link', size: 'micro', label: 'Open Plugins', id: 'harness-plugins-unsure', onclick: () => showPage('plugins') }))) : null;
  if (!plugins.installed.length) return page(unsureNote, emptyState('puzzle', `No plugins in ${names[tool]}`, `None of the plugins in your marketplaces is installed in ${names[tool]}.`,
    button({ variant: 'outline', label: 'Browse plugins', id: 'harness-browse-plugins', onclick: () => showPage('plugins') })));
  return page(h('p.tools-note', {}, icon('info', 14, 'tone-muted'), `Installed in ${names[tool]} from your marketplaces. Open one to uninstall it, or to install it in another tool.`),
    unsureNote, h('div.harness-plugins', { role: 'list' }, plugins.installed.map(pluginRow)));
}

/** Where the tool's files are, how it was found, and which other products read them. */
function aboutTab(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const disclosed = home.manage.writes[tool];
  const roots = new Map(snapshot.skills.map(skill => [dirname(skill.directory), skill.rootLabel]));
  const issues = readProblems(snapshot);
  // Every path can be copied.
  let copies = 0;
  const path = (value: string) => h('span.harness-path', {}, pathText(shownPath(value), value), copyButton(value, 'path', `copy-path-${tool}-${copies++}`));
  const fileFor = (kind: 'mcp' | 'agents') => kindView(home, kind).facts.map(item => item.copies[tool]?.directory).find(Boolean);
  const mcpFile = fileFor('mcp'), agentFile = fileFor('agents');
  const ins = instructionOf(tool);
  return h('div.page', {}, h('div.scroll.harness-scroll', { id: 'harness-body' }, h('div.card.harness-about', {},
    h('div.harness-about-column', {},
      section('This harness', h('dl.facts', {},
        ...fact('Found as', detectionLine(snapshot, home)),
        ...(home.mode === 'actual' && snapshot.detection !== 'Installed' ? fact('Version', snapshot.probe.version ?? snapshot.probe.detail) : []),
        ...fact('Read by', h('span', {}, [fullToolName(snapshot), ...(disclosed?.alsoReadBy ?? [])].join(', '))),
        ...fact('Config folder', path(snapshot.root)))),
      issues.length > 0 && section('Read problems', h('ul.plain-list', { role: 'status' }, issues.map(issue => h('li', {}, issue))))),
    h('div.harness-about-column', {},
      section('Files and folders', h('dl.facts', {},
        ...[...roots].flatMap(([root, label], index) => fact(index === 0 ? 'Skills folder' : label, path(root))),
        ...(!roots.size && disclosed?.to && !disclosed.blocked ? fact('Skills folder', h('span.harness-path', {}, path(disclosed.to), h('span.tone-faint', {}, '(empty; new skills go here)'))) : []),
        ...(disclosed && roots.size && !(disclosed.to && roots.has(disclosed.to)) ? fact('New skills go to', disclosed.blocked ? h('span', {}, h('span.tone-warning', {}, 'Nowhere. '), disclosed.blocked) : path(disclosed.to)) : []),
        ...(supports(home, 'mcp', tool) ? fact('MCP servers file', mcpFile ? path(mcpFile) : h('span.tone-faint', {}, '— (no MCP servers found)')) : []),
        ...(supports(home, 'agents', tool) ? fact('Agents folder', agentFile ? path(dirname(agentFile)) : h('span.tone-faint', {}, '— (no agents found)')) : []),
        ...(ins ? fact('Instructions', h('span.harness-path', {}, path(ins.path), ins.exists ? null : h('span.tone-faint', {}, '(no file yet)'))) : [])))))));
}

function oneHarness(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const tab = state.harnessTab;
  const body = isKind(tab) ? kindTab(home, tab, tool) : tab === 'instructions' ? instructionsTab(tool) : tab === 'plugins' ? pluginsTab(tool) : aboutTab(snapshot, home);
  body.classList.add('harness-tab-body');
  // Tabs without bands of their own (Plugins, About, a kind the tool doesn't use) still show the last result, such as a home switch.
  if (!body.querySelector(':scope > .bands')) { const done = outcomeBand(); if (done) body.prepend(h('div.bands', {}, done)); }
  // The window's header names the harness (harnessTitle); its tabs and the switcher to the others share one row below it.
  return h('div.page.harness-page', {}, h('div.harness-bar', {}, tabs(home, tool), switcher(home, tool)), body);
}

/** The harness whose page is open, if it is still in this home and found. */
const openSnapshot = (home: HomeView): Snapshot | undefined =>
  state.harness && found(home, state.harness) ? home.snapshots.find(entry => entry.harness === state.harness) : undefined;

/** The header title on a harness's page: "Harnesses" as the way back, then the harness and how it was found. Undefined on the list. */
export function harnessTitle(): (Node | null)[] | undefined {
  const snapshot = state.home && openSnapshot(state.home);
  if (!snapshot || !state.home) return undefined;
  const tool = snapshot.harness;
  return [
    h('button.crumb-link.title-crumb', { type: 'button', id: 'harness-back', title: 'Back to every harness', disabled: !!state.busy, onclick: (event: MouseEvent) => goHarness(undefined, undefined, event.detail === 0) }, icon('arrow-left', 14), 'Harnesses'),
    h('span.crumb-sep', { 'aria-hidden': 'true' }, '/'),
    brandMark(tool, 16), h('span.title-harness', {}, names[tool]),
    // A sample or chosen folder is said once, on the list's note; the header names installed state on this computer only.
    state.home.mode === 'actual' ? h('span.title-note', { title: snapshot.root }, detectionLine(snapshot, state.home)) : null,
  ];
}

export function harnessesPage() {
  const home = state.home;
  if (!home) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading…' : 'No home read.')));
  // The summary's instruction files and installs, read quietly once per home (each read checks what it already has).
  readInstructionsQuietly();
  peekPlugins();
  // A harness not found in this home (another home without it, or no longer found) falls back to the list; one both homes have stays open.
  const snapshot = openSnapshot(home);
  return snapshot ? oneHarness(snapshot, home) : everyHarness(home);
}
