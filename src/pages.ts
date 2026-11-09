import { announce, loadHome, rerender, selectItem, shownPath, showPage, state, syncNow } from './app.ts';
import { button, emptyState, h, icon, pathText, section } from './dom.ts';
import { fullToolName, plural, skillCount, toolName } from './model.ts';
import type { HarnessId, HomeView, Skill, Snapshot } from './types.ts';
import { designMode } from './design.ts';
import { brandMark, designOverview, skillsBrowser } from './matrix.ts';

// ---------- Overview ----------

const reading = () => h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
/** Nothing of this kind in this home: what was looked for, and somewhere useful to go next. */
const nothingHere = (glyph: Parameters<typeof emptyState>[0], title: string, body: string, id: string) => h('div.page', {}, emptyState(glyph, title, body,
  h('div.empty-actions', {},
    button({ variant: 'outline', label: 'See which folders were read', id: `${id}-tools`, onclick: () => showPage('tools') }),
    state.home?.mode !== 'fixture' ? button({ variant: 'ghost', label: 'Try the practice copy', id: `${id}-practice`, onclick: () => void loadHome('fixture') }) : null)));
const noSkills = (id: string) => nothingHere('wand-sparkles', 'No skills here yet', 'None of your tools has a user-wide skill in this home. Add one in Claude Code, Copilot CLI or Codex, or choose another home at the bottom left.', id);

/** Shown before any home has been read, or when reading failed. */
function notRead() {
  if (state.busy) return reading();
  return h('div.page', {}, emptyState('circle-alert', 'Could not read this home', 'Nothing changed.', button({ label: 'Try again', id: 'first-retry', onclick: () => void loadHome('fixture') })));
}

const remembered = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const remember = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* per-viewer convenience only */ } };

/** The practice copy explains itself the first times it opens: what it is, that it is safe, and how to move to the real thing. */
function practiceBanner() {
  if (state.home?.mode !== 'fixture' || remembered('ck-practice-banner-dismissed')) return null;
  return h('div.intro', { role: 'note' },
    h('div.intro-text', {},
      h('strong', {}, 'This is a practice copy.'),
      h('span', {}, ' It holds sample skills, MCP servers and agents in a throwaway folder that is removed when you quit. Nothing here touches your real tools, so try anything. When you are ready, use This Mac’s home.')),
    button({ variant: 'outline', size: 'small', label: 'Use This Mac’s home', id: 'intro-use-real', onclick: () => void loadHome('actual') }),
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Hide this note', id: 'intro-dismiss', onclick: () => { remember('ck-practice-banner-dismissed'); rerender(); } }));
}

/** One card per kind: how many, how many are managed, and the one thing that needs attention, if any. */
function kindCard(page: 'skills' | 'mcp' | 'agents', title: string, glyph: Parameters<typeof icon>[0], noun: [string, string], facts: { managed: boolean; edited?: unknown[]; waits?: boolean; differs: boolean }[], waitsForClaude = 0) {
  const total = facts.length;
  const managed = facts.filter(fact => fact.managed).length;
  const differs = facts.filter(fact => fact.differs).length;
  const edits = facts.filter(fact => fact.managed && fact.edited?.length).length;
  const attention = differs ? { tone: 'tone-warning', glyph: 'diff' as const, text: `${differs} ${differs === 1 ? 'has' : 'have'} different copies` }
    : edits ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${edits} ${edits === 1 ? 'edit waits' : 'edits wait'} to spread` }
      : waitsForClaude ? { tone: 'tone-warning', glyph: 'clock' as const, text: `${waitsForClaude} ${waitsForClaude === 1 ? 'waits' : 'wait'} for Claude Code` }
        : managed ? { tone: 'tone-success', glyph: 'check' as const, text: 'All managed ones in sync' }
          : total ? { tone: 'tone-muted', glyph: 'circle' as const, text: 'Nothing managed yet' } : { tone: 'tone-muted', glyph: 'circle' as const, text: 'None in this home' };
  return h('button.kind-card', { type: 'button', id: `overview-${page}`, onclick: () => showPage(page) },
    h('span.kind-card-head', {}, icon(glyph, 16), h('strong', {}, title), icon('arrow-right', 14, 'tone-faint')),
    h('span.kind-card-count', {}, total ? `${plural(total, noun[0], noun[1])} · ${managed} managed` : `No ${noun[1]}`),
    h(`span.kind-card-state.${attention.tone}`, {}, icon(attention.glyph, 13), attention.text));
}

export function overviewPage() {
  if (designMode) return designOverview();
  const home = state.home;
  if (!home) return notRead();
  const differs = (fact: { managed: boolean; copies: Record<string, unknown>; separate?: boolean; off: string[] }) => !fact.separate && new Set(Object.entries(fact.copies).filter(([tool]) => !fact.off.includes(tool)).map(([, copy]) => (copy as { hash: string }).hash)).size > 1;
  const pick = (list: typeof home.manage.skills) => list.map(fact => ({ managed: fact.managed, edited: fact.edited, differs: !fact.managed && differs(fact) }));
  const nothingManaged = ![...home.manage.skills, ...home.mcp.servers, ...(home.agents?.servers ?? [])].some(fact => fact.managed);
  return h('div.page', {},
    h('div.scroll.overview-scroll', { id: 'overview-scroll' },
      practiceBanner(),
      h('p.overview-lead', {}, 'Central Knot keeps the skills, MCP servers and agents you choose the same in Claude Code, Copilot CLI and Codex.',
        nothingManaged ? ' Open one below, turn on Managed for what you want kept the same, then click Apply all.' : ''),
      h('div.kind-cards', {},
        kindCard('skills', 'Skills', 'wand-sparkles', ['skill', 'skills'], pick(home.manage.skills)),
        kindCard('mcp', 'MCP servers', 'plug', ['server', 'servers'], pick(home.mcp.servers), home.mcp.claudePending.length),
        kindCard('agents', 'Agents', 'bot', ['agent', 'agents'], pick(home.agents?.servers ?? []))),
      h('div.overview-more', {},
        h('p.overview-line', {}, icon(home.syncOn ? 'refresh-cw' : 'circle-minus', 14, home.syncOn ? 'tone-success' : 'tone-warning'),
          ...(home.syncOn ? ['Automatic sync is on: once something is managed, an edit in one tool spreads to the others within seconds, with a notice and Undo.']
            : ['Automatic sync is off: edits wait until you turn it on or ', button({ variant: 'link', size: 'micro', label: 'Sync now', id: 'overview-sync-now', onclick: () => void syncNow() }), '.'])),
        h('p.overview-line', {}, icon('laptop', 14, 'tone-muted'), 'Closing this window keeps Central Knot syncing. Quit from the Central Knot menu.'),
        h('p.overview-line', {}, icon('puzzle', 14, 'tone-muted'), 'Plugins are installed through each tool’s own CLI on the ', button({ variant: 'link', size: 'micro', label: 'Plugins page', id: 'overview-plugins', onclick: () => showPage('plugins') }), '.'),
        h('p.overview-line', {}, icon('history', 14, 'tone-muted'), 'Everything sync does on its own is listed in ', button({ variant: 'link', size: 'micro', label: 'History', id: 'overview-history', onclick: () => showPage('history') }), ', with Undo or Restore.'))));
}

// ---------- MCP servers ----------

export function mcpPage() {
  if (!state.home) return notRead();
  if (!state.home.mcp.servers.length) return nothingHere('plug', 'No MCP servers here yet', 'None of your tools has a user-wide MCP server in this home. Add one in a tool, then Refresh.', 'mcp-empty');
  return designOverview('mcp');
}

// ---------- Agents ----------

export function agentsPage() {
  if (!state.home) return notRead();
  if (!state.home.agents?.servers.length) return nothingHere('bot', 'No agents here yet', 'None of your tools has a user-wide agent in this home. Add one in Claude Code, Copilot CLI or Codex, then Refresh.', 'agents-empty');
  return designOverview('agents');
}

// ---------- Skills ----------

const fact = (term: string, value: Node | string) => [h('dt', {}, term), h('dd', {}, value)];

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
      section('Contents', contents(key, copies)),
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

function toolCard(snapshot: Snapshot, home: HomeView) {
  const disclosed = home.manage.writes[snapshot.harness];
  const roots = new Map(snapshot.skills.map(skill => [dirname(skill.directory), skill.rootLabel]));
  const issues = snapshot.discovery === 'missing' ? [] : snapshot.issues;
  const path = (value: string) => pathText(shownPath(value), value);
  return h('article.card.tool-card', { 'aria-label': fullToolName(snapshot) },
    h('header.tool-head', {},
      brandMark(snapshot.harness, 18),
      h('h2.tool-title', {}, toolName(snapshot.harness) ?? fullToolName(snapshot)),
      pathText(shownPath(snapshot.root), snapshot.root),
      copyButton(snapshot.root, `folder for ${fullToolName(snapshot)}`, `copy-root-${snapshot.harness}`, 'Copy path')),
    h('div.tool-body', {},
      h('div.tool-column', {},
        section('Detection', h('dl.facts', {},
          // The practice copy and another folder are folders, not this Mac: no app is looked for there, and that is no fault.
          ...fact('Status', home.mode === 'actual' ? snapshot.detection : home.mode === 'fixture' ? 'Sample folder' : 'Folder only'),
          ...(home.mode === 'actual' ? fact('Version', snapshot.probe.version ?? snapshot.probe.detail) : []),
          ...(snapshot.probe.detail.startsWith('ChatGPT desktop') ? fact('Found as', 'ChatGPT desktop’s own Codex; no Codex CLI found') : []))),
        section('Folders', h('dl.facts', {},
          ...fact('Config folder', path(snapshot.root)),
          ...[...roots].flatMap(([root, label]) => fact(label, path(root))),
          ...(disclosed ? fact('New copies go to', disclosed.blocked ? h('span', {}, h('span.tone-warning', {}, 'Nowhere. '), disclosed.blocked) : path(disclosed.to)) : [])))),
      h('div.tool-column', {},
        section('What it has',
          h('div.link-row', {},
            snapshot.skills.length ? button({ variant: 'link', size: 'micro', label: plural(skillCount(snapshot), 'skill'), id: `tool-overview-${snapshot.harness}`, onclick: () => showPage('skills') })
              : snapshot.discovery === 'empty' || snapshot.discovery === 'missing' ? h('span', { title: discoveryLine(snapshot) }, '0 skills') : h('span', {}, discoveryLine(snapshot)),
            h('span.tone-faint', {}, ' · '),
            button({ variant: 'link', size: 'micro', label: plural(count(home.mcp.servers, snapshot.harness), 'MCP server'), id: `tool-mcp-${snapshot.harness}`, onclick: () => showPage('mcp') }),
            h('span.tone-faint', {}, ' · '),
            button({ variant: 'link', size: 'micro', label: plural(count(home.agents?.servers, snapshot.harness), 'agent'), id: `tool-agents-${snapshot.harness}`, onclick: () => showPage('agents') }))),
        disclosed && disclosed.alsoReadBy.length > 0 && section('Others that read its folder', h('p', {}, disclosed.alsoReadBy.join(', '))),
        issues.length > 0 && section('Read problems', h('ul.plain-list', { role: 'status' }, issues.map(issue => h('li', {}, issue)))))));
}

export function toolsPage() {
  const { home } = state;
  if (!home) return h('div.page');
  return h('div.page', {}, h('div.scroll.cards-scroll', { id: 'tools-scroll' },
    home.mode !== 'actual' ? h('p.tools-note', {}, icon('info', 14, 'tone-muted'), home.mode === 'fixture' ? 'This is the practice copy: sample folders, so no app is checked here. Choose This Mac’s home to see your installed tools and versions.' : 'This is a folder, not this Mac: no app is checked here. Choose This Mac’s home to see your installed tools and versions.') : null,
    home.snapshots.map(snapshot => toolCard(snapshot, home))));
}
