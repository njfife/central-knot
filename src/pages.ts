import { announce, loadHome, rerender, selectItem, shownPath, showPage, state, syncNow } from './app.ts';
import { button, emptyState, h, icon, pathText, section } from './dom.ts';
import { plural, toolName } from './model.ts';
import type { HarnessId, HomeView, Skill } from './types.ts';
import { designMode } from './design.ts';
import { realHomeName } from './renderer.ts';
import { brandMark, designOverview, outcomeBand, showFiltered, skillsBrowser } from './matrix.ts';
import type { Kind } from './app.ts';

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
    button({ variant: 'outline', label: 'See which folders were read', id: `${id}-tools`, onclick: () => showPage('harnesses') }),
    state.home?.practice && state.home.mode !== 'fixture' ? button({ variant: 'link', label: 'Try the practice copy', id: `${id}-practice`, onclick: () => void loadHome('fixture') }) : null)));
/** What each kind's page says when no tool in this home has one: also used on a harness's page for that kind. */
export const kindEmpty: Record<Kind, { glyph: Parameters<typeof emptyState>[0]; title: string; body: string }> = {
  skills: { glyph: 'wand-sparkles', title: 'No skills here yet', body: 'None of your tools has a skill in this home. Add one in Claude Code, Copilot CLI or Codex, then Refresh, or choose another home at the bottom left.' },
  mcp: { glyph: 'plug', title: 'No MCP servers here yet', body: 'None of your tools has an MCP server in this home. Add one in Claude Code, Copilot CLI or Codex, then Refresh, or choose another home at the bottom left.' },
  agents: { glyph: 'bot', title: 'No agents here yet', body: 'None of your tools has an agent in this home. Add one in Claude Code, Copilot CLI or Codex, then Refresh, or choose another home at the bottom left.' },
};
const emptyKindPage = (which: Kind, id: string) => nothingHere(kindEmpty[which].glyph, kindEmpty[which].title, kindEmpty[which].body, id);
const noSkills = (id: string) => emptyKindPage('skills', id);

/** Shown before any home has been read, or when reading failed. */
function notRead() {
  if (state.busy) return reading();
  return h('div.page', {}, emptyBands(), emptyState('circle-alert', 'Could not read this home', 'Nothing changed.', button({ label: 'Try again', id: 'first-retry', onclick: () => void loadHome(state.lastMode ?? 'fixture') })));
}

const remembered = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const remember = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* per-viewer convenience only */ } };

/** The practice copy explains itself the first times it opens: what it is, that it is safe, and how to move to the real thing. */
function practiceBanner() {
  if (state.home?.mode !== 'fixture' || remembered('ck-practice-banner-dismissed')) return null;
  return h('div.intro', { role: 'note' },
    h('div.intro-text', {},
      h('strong', {}, 'This is a practice copy.'),
      h('span', {}, ' Sample skills, MCP servers and agents in a throwaway folder. Nothing here touches your real tools, so try anything.')),
    // The first step stays inside the sandbox; the real home is the quieter second choice.
    button({ variant: 'primary', size: 'small', label: 'Try it: open Skills', id: 'intro-try', onclick: () => showPage('skills') }),
    (() => { const real = button({ variant: 'link', size: 'small', label: `or use ${realHomeName}`, id: 'intro-use-real', onclick: () => void loadHome('actual') }); real.title = 'Only reads your tools; nothing is written there until you click Apply all.'; return real; })(),
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Hide this note', id: 'intro-dismiss', onclick: () => { remember('ck-practice-banner-dismissed'); rerender(); } }));
}

/** One card per kind: how many, how many are managed, and the one thing that needs attention, if any. */
function kindCard(page: 'skills' | 'mcp' | 'agents', title: string, glyph: Parameters<typeof icon>[0], noun: [string, string], facts: { managed: boolean; edited?: unknown[]; waits?: boolean; differs: boolean }[], waitsForClaude = 0) {
  const total = facts.length;
  const managed = facts.filter(fact => fact.managed).length;
  const differs = facts.filter(fact => fact.differs).length;
  const edits = facts.filter(fact => fact.managed && fact.edited?.length).length;
  const attention = differs ? { tone: 'tone-warning', glyph: 'diff' as const, text: `${differs} ${differs === 1 ? 'has' : 'have'} different copies` }
    : edits ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${edits} ${edits === 1 ? 'change' : 'changes'} waiting` }
      : waitsForClaude ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${waitsForClaude} ${waitsForClaude === 1 ? 'waits' : 'wait'} for Claude Code` }
        : managed ? { tone: 'tone-success', glyph: 'check' as const, text: 'All managed ones in sync' }
          : undefined;
  // The card opens the whole page; a "different copies" line is its own link, to the page narrowed to them.
  return h('div.kind-card', {},
    h('button.kind-card-main', { type: 'button', id: `overview-${page}`, onclick: () => showPage(page) },
      h('span.kind-card-head', {}, icon(glyph, 16), h('strong', {}, title), icon('arrow-right', 14, 'tone-faint')),
      h('span.kind-card-count', {}, total ? `${plural(total, noun[0], noun[1])} · ${managed ? `${managed} managed` : 'none managed yet'}` : `No ${noun[1]}`)),
    !attention ? null : differs
      ? h(`button.kind-card-state.kind-card-link.${attention.tone}`, { type: 'button', id: `overview-${page}-differ`, title: 'Show only these', onclick: () => { showFiltered(page, 'attention'); showPage(page); } }, icon(attention.glyph, 13), attention.text, icon('arrow-right', 12))
      : h(`span.kind-card-state.${attention.tone}`, {}, icon(attention.glyph, 13), attention.text));
}

export function overviewPage() {
  if (designMode) return designOverview();
  const home = state.home;
  if (!home) return notRead();
  const differs = (fact: { managed: boolean; copies: Record<string, unknown>; separate?: boolean; off: string[] }) => !fact.separate && new Set(Object.entries(fact.copies).filter(([tool]) => !fact.off.includes(tool)).map(([, copy]) => (copy as { hash: string }).hash)).size > 1;
  const pick = (list: typeof home.manage.skills) => list.map(fact => ({ managed: fact.managed, edited: fact.edited, differs: !fact.managed && differs(fact) }));
  const nothingManaged = ![...home.manage.skills, ...home.mcp.servers, ...(home.agents?.servers ?? [])].some(fact => fact.managed);
  const done = outcomeBand();
  return h('div.page', {},
    done ? h('div.bands', {}, done) : null,
    h('div.scroll.overview-scroll', { id: 'overview-scroll' },
      practiceBanner(),
      h('p.overview-lead', {}, 'Central Knot keeps the skills, MCP servers and agents you choose the same in Claude Code, Copilot CLI and Codex.',
        // The next step only where it can be taken: something to manage, and a home that can be written.
        !home.manage.skills.length && !home.mcp.servers.length && !(home.agents?.servers.length) ? ' Nothing found in this home yet.' : nothingManaged && home.manage.access.allowed ? ' Open one below, turn on Managed for what you want to sync, then click Apply all.' : ''),
      h('div.kind-cards', {},
        kindCard('skills', 'Skills', 'wand-sparkles', ['skill', 'skills'], pick(home.manage.skills)),
        kindCard('mcp', 'MCP servers', 'plug', ['server', 'servers'], pick(home.mcp.servers), home.mcp.claudePending.length),
        kindCard('agents', 'Agents', 'bot', ['agent', 'agents'], pick(home.agents?.servers ?? []))),
      h('div.overview-more', {},
        !home.manage.access.allowed ? h('p.overview-line', {}, icon('lock', 14, 'tone-warning'), `Automatic sync is paused. Preview only: ${previewReason(home.manage.access.reason)}.`)
        // Green only once something syncs; before that, sync is on and waiting, in the status bar's grey.
        : home.syncOn && nothingManaged ? null : h('p.overview-line', {}, icon(home.syncOn ? 'refresh-cw' : 'circle-minus', 14, home.syncOn ? (nothingManaged ? 'tone-muted' : 'tone-success') : 'tone-warning'),
          ...(home.syncOn ? [nothingManaged ? 'Automatic sync is on. Once something is managed, edits spread between tools in seconds, with Undo.' : 'Automatic sync is on: edits spread between tools in seconds, with a notice and Undo.']
            : ['Automatic sync is off: edits wait until you turn it on or ', button({ variant: 'link', size: 'micro', label: 'Sync once', id: 'overview-sync-now', onclick: () => void syncNow() }), '.'])),
        nothingManaged && home.manage.access.allowed && h('p.overview-line', {}, icon('info', 14, 'tone-muted'), `Closing the window keeps Central Knot running in the ${navigator.userAgent.includes('Mac') ? 'menu bar' : 'tray'}. Turn sync off${navigator.userAgent.includes('Linux') ? '' : ', set it to start at sign-in,'} or quit from there.`),
        h('p.overview-line', {}, icon('history', 14, 'tone-muted'), 'Every change Central Knot makes is kept in ', button({ variant: 'link', size: 'micro', label: 'History', id: 'overview-history', onclick: () => showPage('history') }), ', with Undo.'),
        // The two pages the cards don't cover, named once so a newcomer knows what they are.
        h('p.overview-line', {}, icon('info', 14, 'tone-muted'), 'Also here: ', button({ variant: 'link', size: 'micro', label: 'Instructions', id: 'overview-instructions', onclick: () => showPage('instructions') }), ' (each tool’s own instruction file) and ', button({ variant: 'link', size: 'micro', label: 'Plugins', id: 'overview-plugins', onclick: () => showPage('plugins') }), ' (install from a marketplace).'))));
}

// ---------- MCP servers ----------

export function mcpPage() {
  if (!state.home) return notRead();
  if (!state.home.mcp.servers.length) return emptyKindPage('mcp', 'mcp-empty');
  return designOverview('mcp');
}

// ---------- Agents ----------

export function agentsPage() {
  if (!state.home) return notRead();
  if (!state.home.agents?.servers.length) return emptyKindPage('agents', 'agents-empty');
  return designOverview('agents');
}

// ---------- Skills ----------

/** One term and value in a facts list (dl.facts). */
export const fact = (term: string, value: Node | string) => [h('dt', {}, term), h('dd', {}, value)];

interface Found { tool: HarnessId; skill: Skill }

/** Every copy of one skill that the tools read, from what discovery found. */
const copiesOf = (home: HomeView, key: string): Found[] => home.snapshots.flatMap(snapshot => snapshot.skills
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
    if (!home || designMode) return [];
    const copies = copiesOf(home, key);
    const notes = [...new Set(copies.flatMap(copy => copy.skill.notes))];
    return [
      // Each tool's box above already names its folder; a card here only adds what it does not show.
      copies.some(extraFacts) && section('Files', h('div.stack', {}, copies.filter(extraFacts).map((copy, index) => fileCard(key, copy, index)))),
      notes.length > 0 && section('Notes', notes.map(note => h('p', {}, note))),
      h('section.section', {}, h('h3.eyebrow.eyebrow-file', {}, 'SKILL.md'), contents(key, copies)),
    ];
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
