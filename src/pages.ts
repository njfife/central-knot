import { absentKinds, announce, trayPlace, homeToolNames, practiceNoteOpen, setPracticeNote, homeTools, loadHome, realHomeName, thisMachine, rerender, selectItem, shownPath, showPage, startHome, state, syncNow, type Page } from './app.ts';
import { button, cardGrid, emptyState, h, icon, pathText, section } from './dom.ts';
import { fullToolName, plural, skillCount, toolName } from './model.ts';
import type { HarnessId, HomeView, Skill, Snapshot } from './types.ts';
import { designMode } from './design.ts';
import { absentTools, isPresent } from './presence.ts';
import { brandMark, designOverview, outcomeBand, showFiltered, skillsBrowser } from './matrix.ts';
import { andList, orList } from './words.ts';

// ---------- Overview ----------

const reading = () => h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
/** Nothing of this kind in this home: what was looked for, and somewhere useful to go next. */
/** The preview-only reason without its own "Preview only:" prefix or final stop, to sit inside a sentence. */
export const previewReason = (reason?: string) => (reason ?? 'nothing is written here').replace(/^Preview only:\s*/i, '').replace(/\s*You can look around; nothing is written\.?\s*$/, '').replace(/\.\s*$/, '');

/** Bands an empty page still needs: what the last action did, and why nothing can be written here. */
const emptyBands = () => {
  const done = outcomeBand();
  const access = state.home?.manage.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, `Preview only: ${previewReason(access.reason)}. You can look around; nothing is written.`)) : null;
  return done || preview ? h('div.bands', {}, done, preview) : null;
};
const nothingHere = (glyph: Parameters<typeof emptyState>[0], title: string, body: string, id: string) => h('div.page', {}, emptyBands(), emptyState(glyph, title, body,
  h('div.empty-actions', {},
    button({ variant: 'outline', label: 'See which folders were read', id: `${id}-tools`, onclick: () => showPage('tools') }),
    state.home?.practice && state.home.mode !== 'fixture' ? button({ variant: 'link', label: 'Try the practice copy', id: `${id}-practice`, onclick: () => void loadHome('fixture') }) : null)));
/**
 * An empty page's way forward. `holders` is this home's tools that can hold this kind of item (the kind's own view lists only
 * present tools), so the hint never names a tool that isn't here or couldn't take one; `noun` is the kind ("agents").
 */
function addHint(holders: HarnessId[], noun: string) {
  if (holders.length) return `Add one in ${orList(holders.map(toolName))}, then Refresh, or choose another home at the bottom left.`;
  const here = homeToolNames();
  return here.length ? `${andList(here)} can’t hold ${noun}. Choose another home at the bottom left.` : 'No tools were found in this home. Choose another home at the bottom left.';
}
const noSkills = (id: string) => nothingHere('wand-sparkles', 'No skills here yet', `None of your tools has a skill in this home. ${addHint(homeTools(), 'skills')}`, id);

/**
 * The Overview's first sentence: what Central Knot keeps the same, between this home's tools only (`tools`, ids).
 * `agentTools` are those that also hold agents, so a home with Pi says agents leave it out.
 */
function leadSentence(tools: HarnessId[], agentTools: HarnessId[]) {
  const named = andList(tools.map(toolName));
  if (tools.length < 2) return `Central Knot keeps the skills, MCP servers and agents you choose the same between your tools. ${tools.length ? `Only ${named} is in this home, so there is nothing to keep in step yet.` : 'No tools were found in this home.'}`;
  const without = tools.filter(tool => !agentTools.includes(tool)).map(toolName);
  return without.length ? `Central Knot keeps the skills and MCP servers you choose the same in ${named}; agents in all but ${andList(without)}.` : `Central Knot keeps the skills, MCP servers and agents you choose the same in ${named}.`;
}

/** Shown before any home has been read, or when reading failed. */
function notRead() {
  if (state.busy) return reading();
  return h('div.page', {}, emptyBands(), emptyState('circle-alert', 'Could not read this home', 'Nothing changed.', button({ label: 'Try again', id: 'first-retry', onclick: () => void (state.lastMode ? loadHome(state.lastMode) : startHome()) })));
}


/** The practice copy explains itself the first times it opens: what it is, that it is safe, and how to move to the real thing. */
function practiceBanner() {
  if (state.home?.mode !== 'fixture' || !practiceNoteOpen()) return null;
  return h('div.intro', { role: 'note' },
    h('div.intro-text', {},
      h('strong', {}, 'This is a practice copy.'),
      h('span', {}, ' Sample skills, MCP servers and agents in a throwaway folder. Nothing here touches your real tools, so try anything.')),
    // The first step stays inside the sandbox; the real home is the quieter second choice.
    button({ variant: 'primary', size: 'small', label: 'Try it: open Skills', id: 'intro-try', onclick: () => showPage('skills') }),
    (() => { const real = button({ variant: 'link', size: 'small', label: `or use ${realHomeName}`, id: 'intro-use-real', onclick: () => void loadHome('actual') }); real.title = 'Only reads your tools; nothing is written there until you click Apply all.'; return real; })(),
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Hide this note', id: 'intro-dismiss', onclick: () => { setPracticeNote(false); rerender(); } }));
}

/** One card per kind: how many, how many are managed, and the one thing that needs attention, if any. */
interface KindFact { managed: boolean; edited?: unknown[]; differs: boolean; copies: Record<string, unknown> }

/**
 * One kind on the Overview: how many there are and how many are managed, then a row with each tool here that holds this
 * kind and its count, and what needs attention, in short words ("1 differs"). The entries wrap whole, never mid-entry.
 * The card opens the kind's page; "differs" is its own link, to the page narrowed to those.
 */
function kindCard(page: 'skills' | 'mcp' | 'agents', title: string, glyph: Parameters<typeof icon>[0], noun: [string, string], facts: KindFact[], holders: HarnessId[], waitsForClaude = 0) {
  const total = facts.length;
  const managed = facts.filter(fact => fact.managed).length;
  const differs = facts.filter(fact => fact.differs).length;
  const edits = facts.filter(fact => fact.managed && fact.edited?.length).length;
  const attention = differs ? { tone: 'tone-warning', glyph: 'diff' as const, text: `${differs} ${differs === 1 ? 'differs' : 'differ'}`, title: `${differs} ${differs === 1 ? 'has' : 'have'} different copies. Show only these.` }
    : edits ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${edits} waiting`, title: `${plural(edits, 'change')} waiting to sync` }
      : waitsForClaude ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${waitsForClaude} for Claude Code`, title: `${waitsForClaude} ${waitsForClaude === 1 ? 'waits' : 'wait'} for Write to Claude Code` }
        : managed ? { tone: 'tone-success', glyph: 'check' as const, text: 'All in sync', title: 'Every managed one is the same in every tool it syncs to' }
          : undefined;
  const tools = holders.map(tool => h('span.kind-tool', { title: `${toolName(tool)} has ${plural(facts.filter(fact => fact.copies[tool] !== undefined).length, noun[0], noun[1])}` },
    brandMark(tool, 12), h('span', {}, toolName(tool)), h('strong.kind-tool-count', {}, String(facts.filter(fact => fact.copies[tool] !== undefined).length))));
  const state = !attention ? null : differs
    ? h(`button.kind-card-state.kind-card-link.${attention.tone}`, { type: 'button', id: `overview-${page}-differ`, title: attention.title, onclick: () => { showFiltered(page, 'attention'); showPage(page); } }, icon(attention.glyph, 13), attention.text)
    : h(`span.kind-card-state.${attention.tone}`, { title: attention.title }, icon(attention.glyph, 13), attention.text);
  return h('div.kind-card', {},
    h('button.kind-card-main', { type: 'button', id: `overview-${page}`, onclick: () => showPage(page) },
      h('span.kind-card-head', {}, icon(glyph, 16), h('strong', {}, title), icon('arrow-right', 14, 'tone-faint')),
      h('span.kind-card-count', {}, total ? `${plural(total, noun[0], noun[1])} · ${managed ? `${managed} managed` : 'none managed'}` : `No ${noun[1]}`)),
    total ? h('div.kind-card-tools', {}, tools, state) : null);
}

/**
 * The lead's next step, only where it can be taken: with two tools or more and something unmanaged, manage it; with one
 * tool there is nothing to keep in step, so it says how a second one joins.
 */
function nextStep(home: HomeView, nothingManaged: boolean): string {
  if (!home.manage.skills.length && !home.mcp.servers.length && !home.agents?.servers.length) return ' Nothing found in this home yet.';
  if (homeTools().length === 1) return ' When a second tool is installed, or its folder appears here, Central Knot finds it on its own; then manage what you want the same in both.';
  return nothingManaged && home.manage.access.allowed ? ' Open one below, turn on Managed for what you want to sync, then click Apply all.' : '';
}

export function overviewPage() {
  if (designMode) return designOverview();
  const home = state.home;
  if (!home) return notRead();
  const differs = (fact: { managed: boolean; copies: Record<string, unknown>; separate?: boolean; off: string[] }) => !fact.separate && new Set(Object.entries(fact.copies).filter(([tool]) => !fact.off.includes(tool)).map(([, copy]) => (copy as { hash: string }).hash)).size > 1;
  const pick = (list: typeof home.manage.skills): KindFact[] => list.map(fact => ({ managed: fact.managed, edited: fact.edited, differs: !fact.managed && differs(fact), copies: fact.copies }));
  // Kinds no tool here can hold have no card (app.ts absentKinds); they are named once, below.
  const absent = absentKinds();
  const absentNames = absent.map(kind => (kind === 'mcp' ? 'MCP servers' : kind));
  const nothingManaged = ![...home.manage.skills, ...home.mcp.servers, ...(home.agents?.servers ?? [])].some(fact => fact.managed);
  const done = outcomeBand();
  return h('div.page', {},
    done ? h('div.bands', {}, done) : null,
    h('div.scroll.overview-scroll', { id: 'overview-scroll' },
      practiceBanner(),
      h('p.overview-lead', {}, leadSentence(homeTools(), home.agents.tools),
        // The next step only where it can be taken: something to manage, and a home that can be written.
        nextStep(home, nothingManaged)),
      h('div.kind-cards', {},
        kindCard('skills', 'Skills', 'wand-sparkles', ['skill', 'skills'], pick(home.manage.skills), homeTools()),
        absent.includes('mcp') ? null : kindCard('mcp', 'MCP servers', 'plug', ['server', 'servers'], pick(home.mcp.servers), home.mcp.tools, home.mcp.claudePending.length),
        absent.includes('agents') ? null : kindCard('agents', 'Agents', 'bot', ['agent', 'agents'], pick(home.agents?.servers ?? []), home.agents.tools)),
      h('div.overview-more', {},
        absent.length ? h('p.overview-line', { id: 'overview-absent' }, icon('info', 14, 'tone-muted'), `No tool here holds ${orList(absentNames)}.`) : null,
        !home.manage.access.allowed ? h('p.overview-line', {}, icon('lock', 14, 'tone-warning'), `Automatic sync is paused. Preview only: ${previewReason(home.manage.access.reason)}.`)
        // Green only once something syncs; before that, sync is on and waiting, in the status bar's grey.
        : home.syncOn && nothingManaged ? null : h('p.overview-line', {}, icon(home.syncOn ? 'refresh-cw' : 'circle-minus', 14, home.syncOn ? (nothingManaged ? 'tone-muted' : 'tone-success') : 'tone-warning'),
          ...(home.syncOn ? [nothingManaged ? 'Automatic sync is on. Once something is managed, edits spread between tools in seconds, with Undo.' : 'Automatic sync is on: edits spread between tools in seconds, with a notice and Undo.']
            : ['Automatic sync is off: edits wait until you turn it on or ', button({ variant: 'link', size: 'micro', label: 'Sync once', id: 'overview-sync-now', onclick: () => void syncNow() }), '.'])),
        nothingManaged && home.manage.access.allowed && h('p.overview-line', {}, icon('info', 14, 'tone-muted'), `Closing the window keeps Central Knot running in ${trayPlace}. Turn sync off${navigator.userAgent.includes('Linux') ? '' : ', set it to start at sign-in,'} or quit from there.`),
        h('p.overview-line', {}, icon('history', 14, 'tone-muted'), 'Every change Central Knot makes is kept in ', button({ variant: 'link', size: 'micro', label: 'History', id: 'overview-history', onclick: () => showPage('history') }), ', with Undo.'),
        // The two pages the cards don't cover, named once so a newcomer knows what they are.
        // Plugins only where a tool here installs them.
        h('p.overview-line', {}, icon('info', 14, 'tone-muted'), 'Also here: ', button({ variant: 'link', size: 'micro', label: 'Instructions', id: 'overview-instructions', onclick: () => showPage('instructions') }), ' (each tool’s own instruction file)',
          ...(!absent.includes('plugins') ? [' and ', button({ variant: 'link', size: 'micro', label: 'Plugins', id: 'overview-plugins', onclick: () => showPage('plugins') }), ' (install from a marketplace)'] : []), '.'))));
}

// ---------- MCP servers ----------

export function mcpPage() {
  if (!state.home) return notRead();
  if (!state.home.mcp.servers.length) return nothingHere('plug', 'No MCP servers here yet', `None of your tools has an MCP server in this home. ${addHint(state.home.mcp.tools, 'MCP servers')}`, 'mcp-empty');
  return designOverview('mcp');
}

// ---------- Agents ----------

export function agentsPage() {
  if (!state.home) return notRead();
  if (!state.home.agents?.servers.length) return nothingHere('bot', 'No agents here yet', `None of your tools has an agent in this home. ${addHint(state.home.agents.tools, 'agents')}`, 'agents-empty');
  return designOverview('agents');
}

// ---------- Skills ----------

const fact = (term: string, value: Node | string) => [h('dt', {}, term), h('dd', {}, value)];

interface Found { tool: HarnessId; skill: Skill }

/** Every copy of one skill that this home's tools read (presence.ts), from what discovery found. */
const copiesOf = (home: HomeView, key: string): Found[] => home.snapshots.filter(isPresent).flatMap(snapshot => snapshot.skills
  .filter(skill => skill.folder.normalize('NFC').toLowerCase() === key)
  .map(skill => ({ tool: snapshot.harness, skill })));

const extraFacts = ({ skill }: Found) => skill.realDirectory !== skill.directory || skill.metadataKeys.length > 0;

function fileCard(key: string, { tool, skill }: Found, index: number) {
  return h('div.card.path-card', {},
    h('div.path-top', {}, pathText(shownPath(skill.directory), skill.directory), copyButton(skill.directory, `path for ${toolName(tool)}`, `copy-${key}-${index}`)),
    h('div.path-tags', {}, h('span.tag', {}, toolName(tool)), h('span.tag-note', {}, skill.rootLabel)),
    h('dl.facts.facts-compact', {},
      ...(skill.realDirectory !== skill.directory ? fact('Real folder', pathText(shownPath(skill.realDirectory), skill.realDirectory)) : []),
      ...(skill.metadataKeys.length ? fact('Fields of note', skill.metadataKeys.join(', ')) : [])));
}

/** One block per distinct content, named by the copies that hold it. */
function contents(key: string, copies: Found[]) {
  const distinct = new Map<string, Found[]>();
  for (const copy of copies) distinct.set(copy.skill.content, [...(distinct.get(copy.skill.content) ?? []), copy]);
  return [...distinct].map(([content, holders], index) => {
    const who = holders.map(holder => `${toolName(holder.tool)} (${holder.skill.rootLabel})`).join(', ');
    return h('div.content-block', {},
      distinct.size > 1 && h('p.content-owner', {}, who),
      h('pre.content.mono', { tabindex: '0', id: `content-${key}-${index}`, 'aria-label': `Skill contents, ${who}` }, content));
  });
}

export function skillsPage() {
  const home = state.home;
  if (!designMode && !home) return notRead();
  if (!designMode && !home!.manage.skills.length) return noSkills('empty-read');
  // The table is the Skills page; "Files" opens one skill's files and contents beside the list.
  if (state.skillsView !== 'files') return designOverview('skills');
  return skillsBrowser(key => {
    if (!home || designMode) return { where: [], contents: [] };
    const copies = copiesOf(home, key);
    const notes = [...new Set(copies.flatMap(copy => copy.skill.notes))];
    return {
      // A copy's real folder and fields of note fold under "Where each copy is", so the contents come first.
      where: copies.some(extraFacts) ? [h('div.stack.where-cards', {}, copies.filter(extraFacts).map((copy, index) => fileCard(key, copy, index)))] : [],
      contents: [
        notes.length > 0 && section('Notes', notes.map(note => h('p', {}, note))),
        h('section.section', {}, h('h3.eyebrow.eyebrow-file', {}, 'SKILL.md'), contents(key, copies)),
      ],
    };
  }, selectItem);
}

export function copyButton(text: string, what: string, id: string, label?: string) {
  const glyphButton = button({
    variant: 'ghost', size: 'micro', icon: 'copy', name: `Copy ${what}`, id, label,
    onclick: () => void navigator.clipboard.writeText(text).then(() => {
      glyphButton.firstElementChild!.replaceWith(icon('copy-check', 14));
      announce(`Copied ${what}.`);
      setTimeout(() => glyphButton.firstElementChild?.replaceWith(icon('copy', 14)), 1500);
    }, () => announce('Could not copy. Select the text instead.')),
  });
  return glyphButton;
}


// ---------- Tools ----------

/** A backslash separates folders only on Windows; elsewhere it can be part of a skill's name. */
const dirname = (path: string) => path.replace(/^[A-Za-z]:\\/.test(path) ? /[/\\][^/\\]*$/ : /\/[^/]*$/, '');

const discoveryLine = (snapshot: Snapshot) => ({
  ready: plural(skillCount(snapshot), 'skill'),
  empty: 'No standalone skills in this user-wide folder.',
  missing: 'No skills folder found.',
  restricted: 'Discovery needs attention. See the reason below.',
  failed: 'Discovery needs attention. See the reason below.',
})[snapshot.discovery];

const count = (list: { copies: Record<string, unknown> }[] | undefined, tool: HarnessId) => (list ?? []).filter(fact => fact.copies[tool] !== undefined).length;

/** What a tool's card says it has, one link per kind it can hold: its skills, then MCP servers and agents if it holds them. */
function holdings(snapshot: Snapshot, home: HomeView, holdsMcp: boolean, holdsAgents: boolean): (Node | string)[] {
  const link = (count: number, noun: string, page: Page) => count
    ? button({ variant: 'link', size: 'micro', label: plural(count, noun), id: `tool-${page}-${snapshot.harness}`, onclick: () => showPage(page) })
    : h('span.link-quiet', {}, plural(0, noun));
  const skills = snapshot.skills.length || snapshot.discovery === 'empty' || snapshot.discovery === 'missing' ? link(skillCount(snapshot), 'skill', 'skills') : h('span', {}, discoveryLine(snapshot));
  const parts = [skills, holdsMcp ? link(count(home.mcp.servers, snapshot.harness), 'MCP server', 'mcp') : null, holdsAgents ? link(count(home.agents.servers, snapshot.harness), 'agent', 'agents') : null];
  return parts.filter((part): part is HTMLElement => !!part).flatMap((part, index) => (index ? [h('span.tone-faint', {}, ' · '), part] : [part]));
}

function toolCard(snapshot: Snapshot, home: HomeView) {
  const holdsMcp = home.mcp.tools.includes(snapshot.harness), holdsAgents = home.agents.tools.includes(snapshot.harness);
  const disclosed = home.manage.writes[snapshot.harness];
  const roots = new Map(snapshot.skills.map(skill => [dirname(skill.directory), skill.rootLabel]));
  const issues = snapshot.discovery === 'missing' ? [] : snapshot.issues;
  const path = (value: string) => pathText(shownPath(value), value);
  return h('article.card.tool-card', { 'aria-label': fullToolName(snapshot) },
    h('header.tool-head', {},
      brandMark(snapshot.harness, 18),
      h('h2.tool-title', {}, toolName(snapshot.harness) ?? fullToolName(snapshot)),
      pathText(shownPath(snapshot.root), snapshot.root),
      copyButton(snapshot.root, `folder for ${fullToolName(snapshot)}`, `copy-root-${snapshot.harness}`, 'Copy folder path')),
    h('div.tool-body', {},
      h('div.tool-column', {},
        // Outside This Mac's home no app is checked (the note above says so), so the card shows only folders.
        home.mode === 'actual' && section('Detection', h('dl.facts', {},
          // Found but its version couldn't be read: one line, with the probe's own words as its tooltip.
          ...(snapshot.detection === 'Version unknown'
            ? fact('Status', h('span', { title: snapshot.probe.detail }, 'Installed · version unknown'))
            : [...fact('Status', snapshot.detection), ...fact('Version', snapshot.probe.version ?? snapshot.probe.detail)]),
          ...(snapshot.probe.detail.startsWith('ChatGPT desktop') ? fact('Found as', 'ChatGPT desktop’s own Codex; no Codex CLI found') : []))),
        section('Files and folders', h('dl.facts', {},
          ...(home.mode === 'actual' ? fact('Config folder', path(snapshot.root)) : []),
          // One label for every tool; a second folder (shared .agents) keeps its own name.
          ...[...roots].flatMap(([root, label], index) => fact(index === 0 ? 'Skills folder' : label, path(root))),
          ...(!roots.size && disclosed?.to && !disclosed.blocked ? fact('Skills folder', h('span', {}, path(disclosed.to), h('span.tone-faint', {}, ' (empty; new skills go here)'))) : []),
          // Where its MCP servers and agents live, read from what was found there; a kind the tool can't hold is left out.
          ...(holdsMcp ? fact('MCP servers file', (() => { const file = home.mcp.servers.map(server => server.copies[snapshot.harness]?.directory).find(Boolean); return file ? path(file) : h('span.tone-faint', {}, '— (no MCP servers found)'); })()) : []),
          ...(holdsAgents ? fact('Agents folder', (() => { const file = home.agents.servers.map(server => server.copies[snapshot.harness]?.directory).find(Boolean); return file ? path(dirname(file)) : h('span.tone-faint', {}, '— (no agents found)'); })()) : []),
          ...(disclosed && roots.size && !(disclosed.to && roots.has(disclosed.to)) ? fact('New skills go to', disclosed.blocked ? h('span', {}, h('span.tone-warning', {}, 'Nowhere. '), disclosed.blocked) : path(disclosed.to)) : [])))),
      h('div.tool-column', {},
        section('What it has', h('div.link-row', {}, holdings(snapshot, home, holdsMcp, holdsAgents))),
        disclosed && disclosed.alsoReadBy.length > 0 && section('Others that read its skills folder', h('p', {}, disclosed.alsoReadBy.join(', '))),
        issues.length > 0 && section('Read problems', h('ul.plain-list', { role: 'status' }, issues.map(issue => h('li', {}, issue)))))));
}

/** On This Mac's home, the tools that were looked for and not found: said once, as information, never as a card to act on. */
function notFoundLine(home: HomeView, absent: HarnessId[]) {
  if (home.mode !== 'actual' || !absent.length) return null;
  return h('p.tools-note', { id: 'tools-not-found' }, icon('circle-dashed', 14, 'tone-muted'), notFoundText(absent));
}

/** The sentence naming the tools This Mac's home looked for and didn't find. */
function notFoundText(absent: HarnessId[]) {
  const missing = absent.map(toolName);
  return `Not found on ${thisMachine}: ${andList(missing)}. Central Knot looks for ${missing.length === 1 ? 'it' : 'them'} again each time it reads this home.`;
}

export function toolsPage() {
  const { home } = state;
  if (!home) return h('div.page');
  const done = outcomeBand();
  const present = home.snapshots.filter(isPresent);
  const absent = absentTools(home.snapshots);
  return h('div.page', {}, done ? h('div.bands', {}, done) : null, h('div.scroll.cards-scroll', { id: 'tools-scroll' },
    home.mode !== 'actual' ? h('p.tools-note', {}, icon('info', 14, 'tone-muted'), home.mode === 'fixture' ? 'This is the practice copy: sample folders, so Central Knot doesn’t look for installed apps here. Open ' : 'This is a folder, not this computer, so Central Knot doesn’t look for installed apps here. Open ',
      button({ variant: 'link', size: 'micro', label: realHomeName, id: 'tools-open-real', onclick: () => void loadHome('actual') }), ' to see your installed tools and versions.') : null,
    present.length ? [cardGrid(present.map(snapshot => toolCard(snapshot, home))), notFoundLine(home, absent)]
      : emptyState('boxes', home.mode === 'actual' ? `No tools found on ${thisMachine}` : 'No tool folders here',
        home.mode === 'actual' ? notFoundText(absent) : `No tool folders were found in ${home.label}. Choose another home at the bottom left.`)));
}
