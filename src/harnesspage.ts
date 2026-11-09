// Harnesses: one place per tool. The list sums up what each one has; a harness's own page manages its items with the same
// tables, switches and Apply all as the Skills, MCP servers and Agents pages, narrowed to that tool, plus its instruction
// file and its plugins. Nothing here has its own engine: every change goes through the pages it mirrors.
import { announce, loadHome, rerender, shownPath, showPage, state, type HarnessTab } from './app.ts';
import { button, emptyState, h, icon, pathText, section } from './dom.ts';
import { fullToolName, plural } from './model.ts';
import { toolNames } from './words.ts';
import type { HarnessId, HomeView, InstructionFile, McpView, SkillFacts, Snapshot } from './types.ts';
import { brandMark, closeOpenRows, designOverview, outcomeBand, showFiltered } from './matrix.ts';
import { instructionCard } from './instructionspage.ts';
import { browse, market, peekPlugins } from './pluginstate.ts';
import { copyButton } from './pages.ts';
import { realHomeName } from './renderer.ts';

const names = toolNames as Record<HarnessId, string>;
type Kind = 'skills' | 'mcp' | 'agents';
const kindWords: Record<Kind, [string, string]> = { skills: ['skill', 'skills'], mcp: ['MCP server', 'MCP servers'], agents: ['agent', 'agents'] };

/** A backslash separates folders only on Windows; elsewhere it can be part of a skill's name. */
const dirname = (path: string) => path.replace(/^[A-Za-z]:\\/.test(path) ? /[/\\][^/\\]*$/ : /\/[^/]*$/, '');
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** The harnesses this home shows: this computer's home lists every tool, found or not; a folder only the ones it has. */
const listed = (home: HomeView) => home.snapshots.filter(snapshot => home.mode === 'actual' || snapshot.detection !== 'Not found' || snapshot.skills.length > 0);
/** Found: Central Knot reads and writes it, so it has a page. */
const found = (home: HomeView, tool: HarnessId) => home.manage.tools.includes(tool);

const kindView = (home: HomeView, kind: Kind): { tools: HarnessId[]; facts: SkillFacts[] } =>
  kind === 'skills' ? { tools: home.manage.tools, facts: home.manage.skills } : { tools: (kind === 'mcp' ? home.mcp : home.agents as McpView).tools, facts: (kind === 'mcp' ? home.mcp : home.agents).servers };

/** What one tool has of one kind: every item with a copy there, and how many of those are managed. */
function tally(home: HomeView, kind: Kind, tool: HarnessId) {
  const { tools, facts } = kindView(home, kind);
  const here = facts.filter(fact => fact.copies[tool] !== undefined);
  return { supported: tools.includes(tool), total: here.length, managed: here.filter(fact => fact.managed).length };
}

const instructionOf = (tool: HarnessId): InstructionFile | undefined => state.instructions?.find(file => file.tool === tool);
const lineCount = (text: string) => text.replace(/\n$/, '').split('\n').length;

/** Plugins installed in this tool, from every marketplace Central Knot knows. Undefined until the marketplaces are read. */
function pluginsIn(tool: HarnessId) {
  const view = market.view;
  if (!view) return undefined;
  if (!view.tools.includes(tool)) return null;
  return view.marketplaces.flatMap(entry => entry.plugins.filter(plugin => entry.states[plugin.name]?.[tool]?.state === 'installed').map(plugin => ({ entry, plugin })));
}

/** Instruction files and plugins are read quietly, once per home, so the summary fills in without blocking the page. */
let readFor: string | undefined;
function readExtras(home: HomeView) {
  if (readFor === home.home) return;
  readFor = home.home;
  if (!state.instructions) void window.centralKnot.instructions().then(files => { if (state.home?.home === home.home && files) { state.instructions ??= files; rerender(); } }, () => undefined);
  peekPlugins();
}

const detectionLine = (snapshot: Snapshot, home: HomeView) => home.mode === 'fixture' ? 'Sample folder'
  : home.mode === 'custom' ? 'Folder only'
    : snapshot.detection === 'Installed' ? `Installed${snapshot.probe.version ? ` · ${snapshot.probe.version}` : ''}`
      : snapshot.probe.detail.startsWith('ChatGPT desktop') ? 'ChatGPT desktop’s Codex' : snapshot.detection;

// ---------- Every harness ----------

function countRow(label: string, value: string, note?: string, tone = '') {
  return h('div.harness-count', {}, h('span.harness-count-label', {}, label), h(`span.harness-count-value${tone}`, {}, value), h('span.harness-count-note', { title: note }, note ?? ''));
}

function summaryCard(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const open = found(home, tool);
  const kinds = (['skills', 'mcp', 'agents'] as const).map(kind => ({ kind, ...tally(home, kind, tool) }));
  const file = instructionOf(tool);
  const plugins = pluginsIn(tool);
  const issues = snapshot.discovery === 'missing' ? [] : snapshot.issues;
  // Unmanaged items whose copies differ, by kind: each line opens this harness's table showing only those.
  const differing = kinds.map(({ kind }) => ({ kind, count: kindView(home, kind).facts.filter(fact => fact.copies[tool] && !fact.managed && !fact.separate && new Set(Object.values(fact.copies).map(copy => copy!.hash)).size > 1).length })).filter(({ count }) => count);
  const managedNote = (total: number, managed: number) => !total ? undefined : managed === total ? 'all managed' : !managed ? 'none managed' : `${managed} managed · ${total - managed} unmanaged`;
  const body = [
    h('span.harness-card-head', {}, brandMark(tool, 18), h('strong.harness-card-name', {}, names[tool]), open ? icon('arrow-right', 14, 'tone-faint') : null),
    h(`span.harness-card-status${snapshot.detection === 'Not found' && home.mode === 'actual' ? '.tone-faint' : ''}`, {}, detectionLine(snapshot, home)),
    h('span.harness-counts', {},
      kinds.map(({ kind, supported, total, managed }) => countRow(kindWords[kind][1].replace(/^./, first => first.toUpperCase()), supported ? String(total) : '—', supported ? managedNote(total, managed) : `${names[tool]} has none of its own`, supported ? '' : '.tone-faint')),
      countRow('Instructions', !file ? '…' : file.exists ? '1' : '0', !file ? undefined : file.exists ? [fileName(file.path), file.text.trim() ? plural(lineCount(file.text), 'line') : 'empty'].join(' · ') : 'no file yet', file?.exists ? '' : '.tone-faint'),
      countRow('Plugins', plugins === undefined ? '…' : plugins === null ? '—' : String(plugins.length), plugins === null ? 'not handled here' : plugins?.length ? 'installed' : undefined, plugins ? '' : '.tone-faint')),
  ];
  const path = h('span.harness-card-path', { title: snapshot.root }, h('span.mono', {}, shownPath(snapshot.root)));
  const attention = [
    ...differing.map(({ kind, count }) => h('button.harness-card-attention', { type: 'button', id: `harness-${tool}-differ-${kind}`, title: 'Show only these',
      onclick: () => { showFiltered(kind, 'attention'); openHarness(tool, kind); } }, icon('diff', 13), `${count} ${kindWords[kind][count === 1 ? 0 : 1]} with different copies`, icon('arrow-right', 12))),
    issues.length ? h('button.harness-card-attention', { type: 'button', id: `harness-${tool}-problems`, onclick: () => openHarness(tool, 'about') }, icon('triangle-alert', 13), plural(issues.length, 'read problem'), icon('arrow-right', 12)) : null,
  ];
  // A tool that was not found has nothing to manage: its card says so and does not open.
  return open
    ? h('div.card.harness-card', {}, h('button.harness-card-main', { type: 'button', id: `harness-${tool}`, 'aria-label': `${names[tool]}: ${detectionLine(snapshot, home)}. Open its page.`, onclick: () => openHarness(tool) }, body),
      attention.some(Boolean) ? h('div.harness-card-links', {}, attention) : null, path)
    : h('div.card.harness-card.harness-card-missing', { id: `harness-${tool}`, 'aria-label': `${names[tool]}: not found` }, h('div.harness-card-main', {}, body,
      h('span.harness-card-next', {}, `Install ${names[tool]}, then Refresh.`)), path);
}

/** Opens one harness's page, on `tab` if given (else the tab last used), with its tables closed. */
function openHarness(tool: HarnessId, tab?: HarnessTab) {
  if (state.harness !== tool) closeOpenRows();
  state.harness = tool;
  if (tab) state.harnessTab = tab;
  state.outcome = undefined;
  announce('');
  rerender();
  document.getElementById('harness-body')?.scrollTo(0, 0);
}

function everyHarness(home: HomeView) {
  const done = outcomeBand();
  return h('div.page', {}, done ? h('div.bands', {}, done) : null,
    h('div.scroll.harness-scroll', { id: 'harnesses-scroll' },
      h('p.tools-note', {}, icon('info', 14, 'tone-muted'),
        h('span', {}, 'Each AI coding tool and what it has. Open one to manage its skills, MCP servers, agents, instructions and plugins.',
          home.mode === 'actual' ? null : [home.mode === 'fixture' ? ' This is the practice copy, so installed apps aren’t looked for; ' : ' This is a folder, not this computer, so installed apps aren’t looked for; ',
            button({ variant: 'link', size: 'micro', label: realHomeName, id: 'tools-open-real', onclick: () => void loadHome('actual') }), ' shows them with their versions.'])),
      h('div.harness-cards', {}, listed(home).map(snapshot => summaryCard(snapshot, home)))));
}

// ---------- One harness ----------

const tabLabel: Record<HarnessTab, string> = { skills: 'Skills', mcp: 'MCP servers', agents: 'Agents', instructions: 'Instructions', plugins: 'Plugins', about: 'About' };

function tabs(home: HomeView, tool: HarnessId) {
  const count = (tab: HarnessTab) => tab === 'skills' || tab === 'mcp' || tab === 'agents' ? (tally(home, tab, tool).supported ? tally(home, tab, tool).total : undefined)
    : tab === 'plugins' ? pluginsIn(tool)?.length : undefined;
  return h('div.harness-tabs', { role: 'tablist', 'aria-label': `${names[tool]}` },
    (Object.keys(tabLabel) as HarnessTab[]).map(tab => h(`button.harness-tab${state.harnessTab === tab ? '.selected' : ''}`, {
      type: 'button', role: 'tab', id: `harness-tab-${tab}`, 'aria-selected': String(state.harnessTab === tab),
      onclick: () => { state.harnessTab = tab; state.outcome = undefined; announce(''); rerender(); },
    }, tabLabel[tab], count(tab) === undefined ? null : h('span.harness-tab-count', {}, String(count(tab))))));
}

/** Moves between found harnesses without going back to the list. */
function switcher(home: HomeView, tool: HarnessId) {
  const others = home.manage.tools;
  if (others.length < 2) return null;
  return h('div.harness-switch', { role: 'group', 'aria-label': 'Other harnesses' }, others.map(other => h(`button.harness-switch-item${other === tool ? '.selected' : ''}`, {
    type: 'button', id: `harness-switch-${other}`, 'aria-pressed': String(other === tool), title: names[other],
    onclick: () => { if (other !== tool) openHarness(other); },
  }, brandMark(other, 14), h('span.harness-switch-name', {}, names[other]))));
}

/** A kind the tool has no place for (Pi's agents): what it has instead. */
function unsupported(kind: Kind, tool: HarnessId) {
  const body = kind === 'agents' ? `${names[tool]} has no agents of its own. On the Agents page, Convert to skill turns an agent into a skill that ${names[tool]} can use.`
    : `${names[tool]} has no ${kindWords[kind][1]} Central Knot can read or write.`;
  return h('div.page', {}, emptyState(kind === 'agents' ? 'bot' : 'plug', `No ${kindWords[kind][1]} in ${names[tool]}`, body,
    kind === 'agents' ? button({ variant: 'outline', label: 'Open Agents', id: 'harness-open-agents', onclick: () => showPage('agents') }) : undefined));
}

function kindTab(home: HomeView, kind: Kind, tool: HarnessId) {
  if (!tally(home, kind, tool).supported) return unsupported(kind, tool);
  if (!kindView(home, kind).facts.length) return h('div.page', {}, emptyState(kind === 'skills' ? 'wand-sparkles' : kind === 'mcp' ? 'plug' : 'bot', `No ${kindWords[kind][1]} yet`,
    `None of your tools has ${kind === 'agents' ? 'an agent' : kind === 'mcp' ? 'an MCP server' : 'a skill'} in this home. Add one in ${names[tool]} or another tool, then Refresh.`));
  return designOverview(kind, tool);
}

function instructionsTab(tool: HarnessId) {
  const file = instructionOf(tool);
  const done = state.outcome && /^Saved /.test(state.outcome.text) ? null : outcomeBand();
  return h('div.page', {}, done ? h('div.bands', {}, done) : null,
    h('div.scroll.harness-scroll', { id: 'harness-body' },
      file ? [h('p.tools-note', {}, icon('info', 14, 'tone-muted'), `${names[tool]} reads this file when a session starts. Changes are reviewed before saving, and earlier versions are kept. `,
        button({ variant: 'link', size: 'micro', label: 'Every tool’s file', id: 'harness-all-instructions', onclick: () => showPage('instructions') })), instructionCard(file)]
        : h('p.empty', {}, state.instructions ? `${names[tool]} has no instruction file Central Knot reads.` : 'Reading the instruction file…')));
}

function pluginsTab(tool: HarnessId) {
  const list = pluginsIn(tool);
  const go = (source: string, plugin?: string) => { showPage('plugins'); browse({ source, plugin, tab: 'plugins', find: '', category: undefined }); };
  const body = list === undefined ? h('p.empty', {}, 'Reading marketplaces…')
    : list === null ? emptyState('puzzle', `${names[tool]} plugins aren’t handled here`, `Central Knot installs marketplace plugins into Claude Code, Copilot CLI and Codex. ${names[tool]}’s own packages stay as they are.`)
      : !list.length ? emptyState('puzzle', `No plugins in ${names[tool]}`, `None of the plugins in your marketplaces is installed in ${names[tool]}.`,
        button({ variant: 'outline', label: 'Browse plugins', id: 'harness-browse-plugins', onclick: () => showPage('plugins') }))
        : [h('p.tools-note', {}, icon('info', 14, 'tone-muted'), `Installed in ${names[tool]} from your marketplaces. Open one to uninstall it, or to install it in another tool.`),
          h('div.harness-plugins', { role: 'list' }, list.map(({ entry, plugin }) => h('div.harness-plugin', { role: 'listitem' },
            h('div.harness-plugin-text', {},
              h('strong', {}, plugin.displayName ?? plugin.name, plugin.version ? h('span.harness-plugin-version', {}, ` ${plugin.version}`) : null),
              h('span.harness-plugin-note', {}, [entry.name, plugin.description].filter(Boolean).join(' · '))),
            button({ variant: 'ghost', size: 'small', label: 'Open', name: `Open ${plugin.displayName ?? plugin.name} in Plugins`, id: `harness-plugin-${entry.name}-${plugin.name}`, onclick: () => go(entry.source, plugin.name) }))))];
  return h('div.page', {}, h('div.scroll.harness-scroll', { id: 'harness-body' }, body));
}

const fact = (term: string, value: Node | string) => [h('dt', {}, term), h('dd', {}, value)];

/** Where the tool's files are and how it was found: the facts the old Tools card held. */
function aboutTab(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const disclosed = home.manage.writes[tool];
  const roots = new Map(snapshot.skills.map(skill => [dirname(skill.directory), skill.rootLabel]));
  const issues = snapshot.discovery === 'missing' ? [] : snapshot.issues;
  const path = (value: string) => pathText(shownPath(value), value);
  const fileFor = (kind: 'mcp' | 'agents') => kindView(home, kind).facts.map(item => item.copies[tool]?.directory).find(Boolean);
  const mcpFile = fileFor('mcp'), agentFile = fileFor('agents');
  const ins = instructionOf(tool);
  return h('div.page', {}, h('div.scroll.harness-scroll', { id: 'harness-body' }, h('div.card.harness-about', {},
    h('div.harness-about-column', {},
      section('Detection', h('dl.facts', {},
        ...fact('Status', detectionLine(snapshot, home)),
        ...(home.mode === 'actual' && snapshot.detection !== 'Installed' ? fact('Version', snapshot.probe.version ?? snapshot.probe.detail) : []),
        ...fact('Reads it', h('span', {}, [fullToolName(snapshot), ...(disclosed?.alsoReadBy ?? [])].join(', '))))),
      issues.length > 0 && section('Read problems', h('ul.plain-list', { role: 'status' }, issues.map(issue => h('li', {}, issue))))),
    h('div.harness-about-column', {},
      section('Files and folders', h('dl.facts', {},
        ...fact('Config folder', h('span.harness-path', {}, path(snapshot.root), copyButton(snapshot.root, `folder for ${names[tool]}`, `copy-root-${tool}`))),
        ...[...roots].flatMap(([root, label], index) => fact(index === 0 ? 'Skills folder' : label, path(root))),
        ...(!roots.size && disclosed?.to && !disclosed.blocked ? fact('Skills folder', h('span', {}, path(disclosed.to), h('span.tone-faint', {}, ' (empty; new skills go here)'))) : []),
        ...(disclosed && roots.size && !(disclosed.to && roots.has(disclosed.to)) ? fact('New skills go to', disclosed.blocked ? h('span', {}, h('span.tone-warning', {}, 'Nowhere. '), disclosed.blocked) : path(disclosed.to)) : []),
        ...(tally(home, 'mcp', tool).supported ? fact('MCP servers file', mcpFile ? path(mcpFile) : h('span.tone-faint', {}, '— (no MCP servers found)')) : []),
        ...(tally(home, 'agents', tool).supported ? fact('Agents folder', agentFile ? path(dirname(agentFile)) : h('span.tone-faint', {}, '— (no agents found)')) : []),
        ...(ins ? fact('Instructions', h('span', {}, path(ins.path), ins.exists ? null : h('span.tone-faint', {}, ' (no file yet)'))) : [])))))));
}

function oneHarness(snapshot: Snapshot, home: HomeView) {
  const tool = snapshot.harness;
  const tab = state.harnessTab;
  const body = tab === 'skills' || tab === 'mcp' || tab === 'agents' ? kindTab(home, tab, tool)
    : tab === 'instructions' ? instructionsTab(tool) : tab === 'plugins' ? pluginsTab(tool) : aboutTab(snapshot, home);
  body.classList.add('harness-tab-body');
  return h('div.page.harness-page', {},
    h('div.harness-head', {},
      h('div.harness-crumb', {},
        // The header above already says Harnesses: the way back is the arrow alone.
        button({ variant: 'ghost', size: 'small', icon: 'arrow-left', name: 'Back to every harness', id: 'harness-back', onclick: () => { state.harness = undefined; state.outcome = undefined; announce(''); rerender(); document.getElementById(`harness-${tool}`)?.focus(); } })),
      brandMark(tool, 18),
      h('div.pane-title', {}, h('h2', {}, names[tool]), h('p', {}, detectionLine(snapshot, home), h('span.harness-head-path', {}, ' · ', h('span.mono', { title: snapshot.root }, shownPath(snapshot.root))))),
      switcher(home, tool)),
    tabs(home, tool),
    body);
}

export function harnessesPage() {
  const home = state.home;
  if (!home) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading…' : 'No home read.')));
  readExtras(home);
  // A harness from another home, or one no longer found, falls back to the list.
  const snapshot = state.harness && found(home, state.harness) ? home.snapshots.find(entry => entry.harness === state.harness) : undefined;
  if (!snapshot) state.harness = undefined;
  return snapshot ? oneHarness(snapshot, home) : everyHarness(home);
}

