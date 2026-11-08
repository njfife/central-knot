import { announce, loadHome, readAgain, selectItem, shownPath, showPage, state } from './app.ts';
import { button, emptyState, h, icon, pathText, section } from './dom.ts';
import { fullToolName, plural, skillCount, toolMonogram, toolName } from './model.ts';
import type { HarnessId, HomeView, Skill, Snapshot } from './types.ts';
import { designMode } from './design.ts';
import { designOverview, skillsBrowser } from './matrix.ts';

// ---------- Overview ----------

const reading = () => h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
const noSkills = (id: string) => h('div.page', {}, emptyState('wand-sparkles', 'No skills here yet', 'Neither tool has a user-wide skill in this home. Choose another home at the bottom left, or read this one again.', button({ icon: 'refresh-cw', label: 'Read again', id, onclick: () => void readAgain() })));

/** Shown before any home has been read, or when reading failed. */
function notRead() {
  if (state.busy) return reading();
  return h('div.page', {}, emptyState('circle-alert', 'Could not read this home', 'Nothing changed.', button({ label: 'Try again', id: 'first-retry', onclick: () => void loadHome('fixture') })));
}

export function overviewPage() {
  if (designMode) return designOverview();
  if (!state.home) return notRead();
  if (!state.home.manage.skills.length) return noSkills('empty-read-again');
  return designOverview();
}

// ---------- MCP servers ----------

export function mcpPage() {
  if (!state.home) return notRead();
  if (!state.home.mcp.servers.length) return h('div.page', {}, emptyState('plug', 'No MCP servers yet', 'None of your tools has a user-wide MCP server in this home. Add one in a tool, then read again.', button({ icon: 'refresh-cw', label: 'Read again', id: 'mcp-read-again', onclick: () => void readAgain() })));
  return designOverview('mcp');
}

// ---------- Agents ----------

export function agentsPage() {
  if (!state.home) return notRead();
  if (!state.home.agents?.servers.length) return h('div.page', {}, emptyState('bot', 'No agents yet', 'None of your tools has a user-wide agent in this home. Add one in Claude Code, Copilot or Codex, then read again.', button({ icon: 'refresh-cw', label: 'Read again', id: 'agents-read-again', onclick: () => void readAgain() })));
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

export function copyButton(text: string, what: string, id: string) {
  const glyphButton = button({
    variant: 'ghost', size: 'micro', icon: 'copy', name: `Copy ${what}`, id,
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

function toolCard(snapshot: Snapshot, home: HomeView) {
  const disclosed = home.manage.writes[snapshot.harness];
  const roots = new Map(snapshot.skills.map(skill => [dirname(skill.directory), skill.rootLabel]));
  const issues = snapshot.discovery === 'missing' ? [] : snapshot.issues;
  const path = (value: string) => pathText(shownPath(value), value);
  return h('article.card.tool-card', { 'aria-label': fullToolName(snapshot) },
    h('header.tool-head', {},
      h('span.monogram', { 'aria-hidden': 'true' }, toolMonogram(snapshot.harness)),
      h('h2.tool-title', {}, fullToolName(snapshot)),
      pathText(shownPath(snapshot.root), snapshot.root),
      copyButton(snapshot.root, `folder for ${fullToolName(snapshot)}`, `copy-root-${snapshot.harness}`)),
    h('div.tool-body', {},
      h('div.tool-column', {},
        section('Detection', h('dl.facts', {},
          ...fact('Status', snapshot.detection),
          ...fact('Version', snapshot.probe.version ?? snapshot.probe.detail),
          ...(snapshot.probe.detail.startsWith('ChatGPT desktop') ? fact('Found as', 'ChatGPT desktop’s own Codex; no Codex CLI found') : []))),
        section('Folders', h('dl.facts', {},
          ...fact('Config folder', path(snapshot.root)),
          ...[...roots].flatMap(([root, label]) => fact(label, path(root))),
          ...(disclosed ? fact('New copies go to', disclosed.blocked ? h('span', {}, h('span.tone-warning', {}, 'Nowhere. '), disclosed.blocked) : path(disclosed.to)) : [])))),
      h('div.tool-column', {},
        section('What it has',
          snapshot.skills.length
            ? h('div.link-row', {}, button({ variant: 'link', size: 'micro', label: `${plural(skillCount(snapshot), 'skill')} in Overview`, id: `tool-overview-${snapshot.harness}`, onclick: () => showPage('overview') }))
            : h('p', {}, discoveryLine(snapshot))),
        disclosed && disclosed.alsoReadBy.length > 0 && section('Others that read its folder', h('p', {}, disclosed.alsoReadBy.join(', '))),
        issues.length > 0 && section('Read problems', h('ul.plain-list', { role: 'status' }, issues.map(issue => h('li', {}, issue)))))));
}

export function toolsPage() {
  const { home } = state;
  if (!home) return h('div.page');
  return h('div.page', {}, h('div.scroll.cards-scroll', { id: 'tools-scroll' }, home.snapshots.map(snapshot => toolCard(snapshot, home))));
}
