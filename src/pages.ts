// The Skills, MCP servers and Agents pages around the tables matrix.ts draws (skillsPage, mcpPage, agentsPage), with their
// empty states (kindEmpty), and the empty states every page shares (noToolsLead, noToolsState, notRead). Every other page has a
// module of its own (overview.ts, harnesspage.ts, historypage.ts, profilespage.ts,
// sourcespage.ts, repopage.ts, pluginspage.ts, instructionspage.ts, settingspage.ts); which page draws is renderer.ts
// renderPage, and the page's state and actions are app.ts's.
import { acting, announce, noToolManaged, noToolManagedSentence, homeToolNames, homeTools, loadHome, type PageKind, selectItem, shownPath, showFile, showPage, startHome, state } from './app.ts';
import { button, emptyState, fileBlocks, h, icon, section } from './dom.ts';
import { toolName } from './model.ts';
import type { HarnessId, HomeView, Skill } from './types.ts';
import { brandMark, itemsTable, outcomeBand, resultInHeader, skillsBrowser, wrappingPath } from './matrix.ts';
import { andList, kindNouns, noToolsSentence, orList } from './words.ts';
import { rowCount } from './pluginrows.ts';

const reading = () => h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
/** The preview-only reason without its own "Preview only:" prefix or final stop, to sit inside a sentence. */
export const previewReason = (reason?: string) => (reason ?? 'nothing is written here').replace(/^Preview only:\s*/i, '').replace(/\s*You can look around; nothing is written\.?\s*$/, '').replace(/\.\s*$/, '');

/** Bands an empty page still needs: what the last action did (in the header on a list page), and why nothing can be written here. */
const emptyBands = () => {
  const done = state.home && resultInHeader() ? null : outcomeBand();
  const access = state.home?.sync.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, `Preview only: ${previewReason(access.reason)}. You can look around; nothing is written.`)) : null;
  return done || preview ? h('div.bands', {}, done, preview) : null;
};
/** Opens another home: a folder chosen now (the Practice copy and this computer's home are in the sidebar too). */
const chooseHomeButton = (id: string) => button({ variant: 'outline', icon: 'folder-open', label: 'Choose another home…', id, disabled: acting(), onclick: () => void loadHome('custom') });

/**
 * A home with no tool managed, wherever it shows: one sentence (none installed, or every one left out: app.ts
 * noToolManagedSentence), `more` if a page has more to say, and the way on, at the top left, as the Overview's lead sits:
 * another home (`<page>-choose-home`), or Harnesses, where each tool's Manage switch is (`<page>-open-harnesses`).
 */
export const noToolsLead = (page: string, more?: string) => {
  const leftOut = !!state.home?.sync.present.length;
  return [h('p.overview-lead', {}, state.home ? noToolManagedSentence(state.home) : noToolsSentence, more ? ` ${more}` : ''),
    h('div.overview-actions', {}, leftOut ? button({ variant: 'outline', icon: 'boxes', label: 'Open Harnesses', id: `${page}-open-harnesses`, onclick: () => showPage('harnesses') }) : chooseHomeButton(`${page}-choose-home`))];
};

/** A page with nothing to show in a home with no tool managed: the same lead and action as the Overview's, in its place. */
export const noToolsState = (page: string, more?: string) => h('div.scroll.overview-scroll.no-tools', { id: `${page}-no-tools-scroll` }, noToolsLead(page, more));

/** An empty page: what is missing and the way forward. In a home with no tool managed, that is another home or Harnesses. */
const nothingHere = (glyph: Parameters<typeof emptyState>[0], title: string, body: string, id: string) => {
  if (noToolManaged()) return h('div.page', {}, emptyBands(), noToolsState(id));
  return h('div.page', {}, emptyBands(), emptyState(glyph, title, body,
    h('div.empty-actions', {},
      button({ variant: 'outline', label: 'See which folders were read', id: `${id}-tools`, onclick: () => showPage('harnesses') }),
      state.home?.practice && state.home.mode !== 'fixture' ? button({ variant: 'link', label: 'Try the practice copy', id: `${id}-practice`, disabled: acting(), onclick: () => void loadHome('fixture') }) : null)));
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
export function kindEmpty(kind: PageKind): { glyph: Parameters<typeof emptyState>[0]; title: string; body: string } {
  const holders = state.home?.[kind].tools ?? [];
  // A tool left out may well have some: only the managed ones are said to have none.
  const whose = homeTools().length < (state.home?.sync.present.length ?? 0) ? 'the tools Central Knot manages' : 'your tools';
  return { glyph: ({ skills: 'wand-sparkles', mcp: 'plug', agents: 'bot' } as const)[kind], title: `No ${kindNouns[kind].many} here yet`, body: `None of ${whose} has ${kindNouns[kind].a} in this home. ${addHint(holders, kindNouns[kind].many)}` };
}
const emptyKindPage = (kind: PageKind, id: string) => { const empty = kindEmpty(kind); return nothingHere(empty.glyph, empty.title, empty.body, id); };
const noSkills = (id: string) => emptyKindPage('skills', id);

/** Shown before any home has been read, or when reading failed. */
export function notRead() {
  if (state.busy) return reading();
  return h('div.page', {}, emptyBands(), emptyState('circle-alert', 'Could not read this home', 'Nothing changed.', button({ label: 'Try again', id: 'first-retry', onclick: () => void (state.lastMode ? loadHome(state.lastMode) : startHome()) })));
}


// ---------- MCP servers ----------

export function mcpPage() {
  if (!state.home) return notRead();
  if (!rowCount(state.home, 'mcp')) return emptyKindPage('mcp', 'mcp-empty');
  return itemsTable('mcp');
}

// ---------- Agents ----------

export function agentsPage() {
  if (!state.home) return notRead();
  if (!rowCount(state.home, 'agents')) return emptyKindPage('agents', 'agents-empty');
  return itemsTable('agents');
}

// ---------- Skills ----------

/** One term and value in a facts list (dl.facts). */
export const fact = (term: string, value: Node | string) => [h('dt', {}, term), h('dd', {}, value)];

interface Found { tool: HarnessId; skill: Skill }

/** Every copy of one skill that the tools Central Knot manages here read, from what discovery found. */
const copiesOf = (home: HomeView, key: string): Found[] => home.snapshots.filter(snapshot => home.sync.managed.includes(snapshot.harness)).flatMap(snapshot => snapshot.skills
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
  if (!home) return notRead();
  if (!rowCount(home, 'skills')) return noSkills('empty-read');
  // The table is the Skills page; "Files" opens one skill's files and contents beside the list.
  if (state.skillsView !== 'files') return itemsTable('skills');
  return skillsBrowser(key => {
    if (!home) return { where: [], contents: [] };
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
