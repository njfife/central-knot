import { absentKinds, announce, noTools, homeToolNames, practiceNoteOpen, setPracticeNote, homeTools, loadHome, realHomeName, type Kind, thisMachine, rerender, selectItem, shownPath, showFile, showPage, startHome, state, syncNow, type Page } from './app.ts';
import { afterLayout, button, cardGrid, emptyState, fileBlocks, h, icon, pathText, section } from './dom.ts';
import { fullToolName, plural, skillCount, toolName } from './model.ts';
import type { HarnessId, HomeView, Skill, Snapshot } from './types.ts';
import { designMode } from './design.ts';
import { absentTools, heldKinds, isPresent } from './presence.ts';
import { brandMark, designOverview, outcomeBand, showFiltered, skillsBrowser, wrappingPath } from './matrix.ts';
import { andList, kindNames, kindNouns, noToolsSentence, orList } from './words.ts';
import { pluginItemCount } from './pluginrows.ts';

// ---------- Overview ----------

const reading = () => h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
/** The preview-only reason without its own "Preview only:" prefix or final stop, to sit inside a sentence. */
export const previewReason = (reason?: string) => (reason ?? 'nothing is written here').replace(/^Preview only:\s*/i, '').replace(/\s*You can look around; nothing is written\.?\s*$/, '').replace(/\.\s*$/, '');

/** Bands an empty page still needs: what the last action did, and why nothing can be written here. */
const emptyBands = () => {
  const done = outcomeBand();
  const access = state.home?.manage.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, `Preview only: ${previewReason(access.reason)}. You can look around; nothing is written.`)) : null;
  return done || preview ? h('div.bands', {}, done, preview) : null;
};
/** Opens another home: a folder chosen now (the Practice copy and this computer's home are in the sidebar too). */
const chooseHomeButton = (id: string) => button({ variant: 'outline', icon: 'folder-open', label: 'Choose another home…', id, onclick: () => void loadHome('custom') });

/**
 * A home with no tools, wherever it shows: one sentence, `more` if a page has more to say, and the way to another home,
 * at the top left, as the Overview's lead sits.
 */
const noToolsLead = (id: string, more?: string) => [h('p.overview-lead', {}, noToolsSentence, more ? ` ${more}` : ''), h('div.overview-actions', {}, chooseHomeButton(id))];

/** A page with nothing to show in a home with no tools: the same lead and action as the Overview's, in its place. */
export const noToolsState = (id: string, more?: string) => h('div.scroll.overview-scroll.no-tools', { id: `${id}-scroll` }, noToolsLead(id, more));

/** An empty page: what is missing and the way forward. In a home with no tools at all, that is another home. */
const nothingHere = (glyph: Parameters<typeof emptyState>[0], title: string, body: string, id: string) => {
  if (noTools()) return h('div.page', {}, emptyBands(), noToolsState(`${id}-choose-home`));
  return h('div.page', {}, emptyBands(), emptyState(glyph, title, body,
    h('div.empty-actions', {},
      button({ variant: 'outline', label: 'See which folders were read', id: `${id}-tools`, onclick: () => showPage('harnesses') }),
      state.home?.practice && state.home.mode !== 'fixture' ? button({ variant: 'link', label: 'Try the practice copy', id: `${id}-practice`, onclick: () => void loadHome('fixture') }) : null)));
};
/**
 * An empty page's way forward. `holders` is this home's tools that can hold this kind of item (the kind's own view lists only
 * present tools), so the hint never names a tool that isn't here or couldn't take one; `noun` is the kind ("agents").
 */
function addHint(holders: HarnessId[], noun: string) {
  if (holders.length) return `Add one in ${orList(holders.map(toolName))}, then Refresh.`;
  // No tool here holds this kind: a Pi-only home whose Pi Agents tab's Open Agents leads to the Agents page.
  return `${andList(homeToolNames())} can’t hold ${noun}.`;
}
/** What each kind's page says when no tool in this home has one: also used on a harness's page for that kind. */
export function kindEmpty(kind: Kind): { glyph: Parameters<typeof emptyState>[0]; title: string; body: string } {
  const holders = kind === 'skills' ? homeTools() : state.home?.[kind].tools ?? [];
  return { glyph: ({ skills: 'wand-sparkles', mcp: 'plug', agents: 'bot' } as const)[kind], title: `No ${kindNouns[kind].many} here yet`, body: `None of your tools has ${kindNouns[kind].a} in this home. ${addHint(holders, kindNouns[kind].many)}` };
}
const emptyKindPage = (kind: Kind, id: string) => { const empty = kindEmpty(kind); return nothingHere(empty.glyph, empty.title, empty.body, id); };
const noSkills = (id: string) => emptyKindPage('skills', id);

/**
 * The Overview's first sentence: what Central Knot keeps the same, between this home's tools only, naming only the kinds
 * a tool here can hold. A kind only some of them hold says which ("agents in all but Pi").
 */
function leadSentence(home: HomeView): string {
  const tools = homeTools();
  if (noTools()) return noToolsSentence;
  const named = andList(tools.map(toolName));
  const holdersOf = { skills: tools, mcp: home.mcp.tools, agents: home.agents.tools };
  const held = heldKinds(home).map(kind => [kindNouns[kind].many, holdersOf[kind]] as const);
  if (tools.length === 1) return `Central Knot keeps the ${andList(held.map(([kind]) => kind))} you choose the same between your tools. Only ${named} is in this home, so there is nothing to keep in step yet.`;
  const everywhere = held.filter(([, holders]) => holders.length === tools.length).map(([kind]) => kind);
  const some = held.filter(([, holders]) => holders.length < tools.length).map(([kind, holders]) => {
    const without = tools.filter(tool => !holders.includes(tool));
    return holders.length >= without.length ? `${kind} in all but ${andList(without.map(toolName))}` : `${kind} in ${andList(holders.map(toolName))}`;
  });
  return `Central Knot keeps the ${andList(everywhere)} you choose the same in ${named}${some.map(part => `; ${part}`).join('')}.`;
}

/** Shown before any home has been read, or when reading failed. */
export function notRead() {
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

/** What a kind card needs from one item: whether it is managed, has edits waiting or differs, and which tools hold a copy. */
interface KindFact { managed: boolean; edited?: unknown[]; differs: boolean; copies: Record<string, unknown> }

/**
 * One kind on the Overview: how many there are and how many are managed, then what needs attention in short words
 * ("1 differs"), on one summary line; under it, each tool here that holds this kind with its count, the entries wrapping
 * whole. The card opens the kind's page; "differs" is its own link, to the page narrowed to those.
 */
function kindCard(page: 'skills' | 'mcp' | 'agents', glyph: Parameters<typeof icon>[0], facts: KindFact[], holders: HarnessId[], waitsForClaude = 0) {
  const { title, short: noun } = kindNouns[page];
  // A plugin's items count with the rest, said apart: nothing here manages them.
  const fromPlugins = !designMode && state.home ? pluginItemCount(state.home, page) : 0;
  const total = facts.length + fromPlugins;
  const managed = facts.filter(fact => fact.managed).length;
  const differs = facts.filter(fact => fact.differs).length;
  const edits = facts.filter(fact => fact.managed && fact.edited?.length).length;
  const attention = differs ? { tone: 'tone-warning', glyph: 'diff' as const, text: `${differs} ${differs === 1 ? 'differs' : 'differ'}`, title: `${differs} ${differs === 1 ? 'has' : 'have'} different copies. Show only these.` }
    : edits ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${edits} waiting`, title: `${plural(edits, 'change')} waiting to sync` }
      : waitsForClaude ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${waitsForClaude} for Claude Code`, title: `${waitsForClaude} ${waitsForClaude === 1 ? 'waits' : 'wait'} for Write to Claude Code` }
        : managed ? { tone: 'tone-success', glyph: 'check' as const, text: 'All in sync', title: 'Every managed one is the same in every tool it syncs to' }
          : undefined;
  const status = !attention ? null : differs
    ? h(`button.kind-card-state.kind-card-link.${attention.tone}`, { type: 'button', id: `overview-${page}-differ`, title: attention.title, onclick: () => { showFiltered(page, 'attention'); showPage(page); } }, icon(attention.glyph, 13), attention.text)
    : h(`span.kind-card-state.${attention.tone}`, { title: attention.title }, icon(attention.glyph, 13), attention.text);
  const countFor = (tool: HarnessId) => facts.filter(fact => fact.copies[tool] !== undefined).length + (fromPlugins || state.home?.pluginItems?.length ? pluginItemCount(state.home!, page, tool) : 0);
  const tools = holders.map(tool => {
    const count = countFor(tool);
    return h('span.kind-tool', {}, brandMark(tool, 12), h('span', {}, toolName(tool)), h('strong.kind-tool-count', {}, String(count)));
  });
  // The heading is the card's one button; its click area stretches over the whole card (style.css), under the differs link.
  return h('div.kind-card', {},
    h('button.kind-card-main', { type: 'button', id: `overview-${page}`, onclick: () => showPage(page) },
      h('span.kind-card-head', {}, icon(glyph, 16), h('strong', {}, title), icon('arrow-right', 14, 'tone-faint'))),
    h('div.kind-card-summary', {}, h('span', {}, total ? `${plural(total, noun[0], noun[1])} · ${managed ? `${managed} managed` : 'none managed'}${fromPlugins ? ` · ${fromPlugins} from plugins` : ''}` : `No ${noun[1]}`),
      // The "·" goes with the status; a narrow card puts the status on a line of its own, without it (markWrappedStatus).
      status ? h('span.kind-card-status', {}, h('span.kind-card-dot', { 'aria-hidden': 'true' }, '·'), status) : null),
    total ? h('div.kind-card-tools', {}, tools) : null);
}

/**
 * After layout: a kind card's status that wrapped onto a line of its own drops its "·", which only separates it from
 * the counts on the same line (style.css .kind-card-status.wrapped). Run after layout (dom.ts afterLayout).
 */
function markWrappedStatus(): void {
  for (const status of document.querySelectorAll<HTMLElement>('.kind-card-status')) {
    status.classList.remove('wrapped');
    const counts = status.previousElementSibling as HTMLElement | null;
    status.classList.toggle('wrapped', !!counts && status.offsetTop > counts.offsetTop + counts.offsetHeight / 2);
  }
}

afterLayout(markWrappedStatus);

/**
 * After layout: the tool counts sit on one line when every card has room for them; otherwise every card lays them out
 * the same way, in two columns, or one per line when two don't fit (style.css .kind-card-tools[data-layout]).
 */
function settleToolCounts(): void {
  const lists = [...document.querySelectorAll<HTMLElement>('.kind-card-tools')];
  const set = (layout: string) => { for (const list of lists) list.dataset.layout = layout; };
  const wraps = (list: HTMLElement) => { const first = list.firstElementChild as HTMLElement | null, last = list.lastElementChild as HTMLElement | null; return !!first && !!last && last.offsetTop > first.offsetTop + first.offsetHeight / 2; };
  set('line');
  if (!lists.some(wraps)) return;
  set('columns');
  if (lists.some(list => list.scrollWidth > list.clientWidth)) set('stack');
}

afterLayout(settleToolCounts);

/**
 * The lead's next step, only where it can be taken: with two tools or more and something unmanaged, manage it; with one
 * tool there is nothing to keep in step, so it says how a second one joins.
 */
function nextStep(home: HomeView, nothingManaged: boolean): string {
  if (noTools()) return '';
  if (!home.manage.skills.length && !home.mcp.servers.length && !home.agents.servers.length) return ' Nothing found in this home yet.';
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
  const empty = noTools();
  const nothingManaged = ![...home.manage.skills, ...home.mcp.servers, ...home.agents.servers].some(fact => fact.managed);
  const done = outcomeBand();
  return h('div.page', {},
    done ? h('div.bands', {}, done) : null,
    h('div.scroll.overview-scroll', { id: 'overview-scroll' },
      practiceBanner(),
      // A home with no tools has nothing to count: the way forward is another home.
      empty ? noToolsLead('overview-choose-home') : h('p.overview-lead', {}, leadSentence(home),
        // The next step only where it can be taken: something to manage, and a home that can be written.
        nextStep(home, nothingManaged)),
      empty ? null : h('div.kind-cards', { 'data-count': String(heldKinds(home).length) },
        kindCard('skills', 'wand-sparkles', pick(home.manage.skills), homeTools()),
        absent.includes('mcp') ? null : kindCard('mcp', 'plug', pick(home.mcp.servers), home.mcp.tools, home.mcp.claudePending.length),
        absent.includes('agents') ? null : kindCard('agents', 'bot', pick(home.agents.servers), home.agents.tools)),
      h('div.overview-more', {},
        absent.length && !empty ? h('p.overview-line', { id: 'overview-absent' }, icon('info', 14, 'tone-muted'), `No tool here holds ${orList(absent.map(kind => kindNames[kind]))}.`) : null,
        !home.manage.access.allowed ? h('p.overview-line', {}, icon('lock', 14, 'tone-warning'), `Automatic sync is paused. Preview only: ${previewReason(home.manage.access.reason)}.`)
        // Green only once something syncs; before that, sync is on and waiting, in the status bar's grey.
        : home.syncOn && nothingManaged ? null : h('p.overview-line', {}, icon(home.syncOn ? 'refresh-cw' : 'circle-minus', 14, home.syncOn ? (nothingManaged ? 'tone-muted' : 'tone-success') : 'tone-warning'),
          ...(home.syncOn ? [nothingManaged ? 'Automatic sync is on. Once something is managed, edits spread between tools in seconds, with Undo.' : 'Automatic sync is on: edits spread between tools in seconds, with a notice and Undo.']
            : ['Automatic sync is off: edits wait until you turn it on or ', button({ variant: 'link', size: 'micro', label: 'Sync once', id: 'overview-sync-now', onclick: () => void syncNow() }), '.'])),
        h('p.overview-line', {}, icon('history', 14, 'tone-muted'), 'Every change Central Knot makes is kept in ', button({ variant: 'link', size: 'micro', label: 'History', id: 'overview-history', onclick: () => showPage('history') }), ', with Undo.'),
        // The two pages the cards don't cover, named once so a newcomer knows what they are; Plugins only where a tool here
        // installs them, and neither in a home with no tools.
        empty ? null : h('p.overview-line', {}, icon('info', 14, 'tone-muted'), 'Also here: ', button({ variant: 'link', size: 'micro', label: 'Instructions', id: 'overview-instructions', onclick: () => showPage('instructions') }), ' (each tool’s own instruction file)',
          ...(!absent.includes('plugins') ? [' and ', button({ variant: 'link', size: 'micro', label: 'Plugins', id: 'overview-plugins', onclick: () => showPage('plugins') }), ' (install from a marketplace)'] : []), '.'))));
}

// ---------- MCP servers ----------

export function mcpPage() {
  if (!state.home) return notRead();
  if (!state.home.mcp.servers.length && !pluginItemCount(state.home, 'mcp')) return emptyKindPage('mcp', 'mcp-empty');
  return designOverview('mcp');
}

// ---------- Agents ----------

export function agentsPage() {
  if (!state.home) return notRead();
  if (!state.home.agents.servers.length && !pluginItemCount(state.home, 'agents')) return emptyKindPage('agents', 'agents-empty');
  return designOverview('agents');
}

// ---------- Skills ----------

/** One term and value in a facts list (dl.facts). */
export const fact = (term: string, value: Node | string) => [h('dt', {}, term), h('dd', {}, value)];

interface Found { tool: HarnessId; skill: Skill }

/** Every copy of one skill that this home's tools read (presence.ts), from what discovery found. */
const copiesOf = (home: HomeView, key: string): Found[] => home.snapshots.filter(isPresent).flatMap(snapshot => snapshot.skills
  .filter(skill => skill.folder.normalize('NFC').toLowerCase() === key)
  .map(skill => ({ tool: snapshot.harness, skill })));

/**
 * Whether a copy's real folder says more than its path: not when the link only changes the part above the home (macOS's
 * /var and /private/var), where the line's visible end would repeat the path above it.
 */
const linkedElsewhere = (skill: Skill) => {
  if (skill.realDirectory === skill.directory) return false;
  const shown = shownPath(skill.directory);
  return !/^[~…]\//.test(shown) || !skill.realDirectory.endsWith(shown.slice(1));
};

/**
 * One copy under "Where each copy is", the one place its paths show: its tool, its folder (with Show in folder and Copy),
 * the real folder when a link leads elsewhere, and its fields of note.
 */
function copyEntry(key: string, { tool, skill }: Found, index: number) {
  return h('div.copy-entry', {},
    h('div.copy-entry-head', {}, brandMark(tool, 12), h('span.copy-entry-tool', {}, toolName(tool)),
      h('button.inline-link.copy-entry-show', { type: 'button', title: 'Show this folder in the file manager; nothing is opened or changed', onclick: () => showFile(skill.directory) }, 'Show in folder'),
      copyButton(skill.directory, `path for ${toolName(tool)}`, `copy-${key}-${index}`)),
    h('p.copy-entry-path', {}, wrappingPath(skill.directory)),
    linkedElsewhere(skill) ? h('p.copy-entry-real', {}, h('span.copy-entry-label', {}, 'Real folder'),
      h('span.path-left', { title: skill.realDirectory }, h('span', {}, skill.realDirectory)),
      copyButton(skill.realDirectory, `real folder for ${toolName(tool)}`, `copy-real-${key}-${index}`)) : null,
    skill.metadataKeys.length ? h('p.copy-entry-more', {}, h('span.copy-entry-label', {}, 'Fields of note '), skill.metadataKeys.join(', ')) : null);
}

/** One block per distinct content, named by the copies that hold it. */
const contents = (key: string, copies: Found[]) =>
  fileBlocks(`content-${key}`, 'Skill contents', copies.map(copy => ({ ...copy, text: copy.skill.content })), holders => holders.map(({ tool, skill }) => `${toolName(tool)} (${skill.rootLabel})`).join(', '));

export function skillsPage() {
  const home = state.home;
  if (!designMode && !home) return notRead();
  if (!designMode && !home!.manage.skills.length && !pluginItemCount(home!, 'skills')) return noSkills('empty-read');
  // The table is the Skills page; "Files" opens one skill's files and contents beside the list.
  if (state.skillsView !== 'files') return designOverview('skills');
  return skillsBrowser(key => {
    if (!home || designMode) return { where: [], contents: [] };
    const copies = copiesOf(home, key);
    const notes = [...new Set(copies.flatMap(copy => copy.skill.notes))];
    return {
      // Each copy once, under "Where each copy is" (matrix.ts filesLayout), so the contents come first.
      where: copies.map((copy, index) => copyEntry(key, copy, index)),
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
