// The Library page around the table matrix.ts draws (libraryPage), with a skill's Files view and its empty states (libraryEmpty,
// kindEmpty); and what every page shares when it has nothing to show: a home not read (notRead), a home with no
// tool managed (noToolsLead, noToolsState), and preview only's reason inside a sentence (previewReason). Every other page has a
// module of its own (overview.ts, harnesspage.ts, historypage.ts, profilespage.ts, sourcespage.ts, repopage.ts, pluginspage.ts,
// instructionspage.ts, settingspage.ts); which page draws is renderer.ts renderPage, and the page's state and actions are app.ts's.
import { acting, announce, noToolManaged, noToolManagedSentence, homeToolNames, homeTools, loadHome, type PageKind, selectItem, shownPath, showFile, showPage, startHome, state } from './app.ts';
import { button, emptyState, fileBlocks, h, icon, section } from './dom.ts';
import { toolName } from './model.ts';
import type { HarnessId, HomeView, Skill } from './types.ts';
import { brandMark, kindGlyph, libraryTable, notAllRead, outcomeBand, resultInHeader, skillsBrowser, wrappingPath } from './matrix.ts';
import { heldKinds } from './presence.ts';
import { andList, kindNouns, noToolsSentence, orList } from './words.ts';
import { rowCount } from './pluginrows.ts';
import { partId, rowId } from './itemrow.ts';

// ---------- What every page shares when it has nothing to show ----------

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

type Empty = { glyph: Parameters<typeof emptyState>[0]; title: string; body: string };
/** What is missing and the way forward: which folders were read (Harnesses), and the practice copy. */
const emptyWithActions = ({ glyph, title, body }: Empty, id: string) => emptyState(glyph, title, body,
  h('div.empty-actions', {},
    button({ variant: 'outline', label: 'See which folders were read', id: `${id}-tools`, onclick: () => showPage('harnesses') }),
    state.home?.practice && state.home.mode !== 'fixture' ? button({ variant: 'link', label: 'Try the practice copy', id: `${id}-practice`, disabled: acting(), onclick: () => void loadHome('fixture') }) : null));
/** An empty page. In a home with no tool managed, the way forward is another home or Harnesses. */
const nothingHere = (empty: Empty, id: string) => h('div.page', {}, emptyBands(), noToolManaged() ? noToolsState(id) : emptyWithActions(empty, id));
/**
 * An empty page's way forward. `holders` is this home's tools that can hold this kind of item (the kind's own view lists only
 * present tools), so the hint never names a tool that isn't here or couldn't take one; `noun` is the kind ("agents").
 */
function addHint(holders: HarnessId[], noun: string) {
  if (holders.length) return `Add one in ${orList(holders.map(toolName))}, then Refresh.`;
  // No tool here holds this kind: a Pi-only home whose Pi Agents tab's Open Agents leads to the Library.
  return `${andList(homeToolNames())} can’t hold ${noun}.`;
}
/** A tool left out may well have some: only the managed ones are said to have none. */
const whose = () => (homeTools().length < (state.home?.sync.present.length ?? 0) ? 'the tools Central Knot manages' : 'your tools');
/** Where a kind's own record or a tool's file of it couldn't be read (the kind switch's "?": matrix.ts notAllRead), so "none" isn't known. */
const unread = (kind: PageKind) => !!state.home && notAllRead(state.home, kind);
/** What the Library says when no tool in this home has one of a kind: under its segment, and on a harness's tab for that kind. */
export function kindEmpty(kind: PageKind): Empty {
  const { many, a, title } = kindNouns[kind], hint = addHint(state.home?.[kind].tools ?? [], many);
  const glyph = kindGlyph[kind];
  return unread(kind) ? { glyph, title: `No ${many} read here`, body: `${title} couldn’t all be read here, so there may be some. ${hint}` }
    : { glyph, title: `No ${many} here yet`, body: `None of ${whose()} has ${a} in this home. ${hint}` };
}
/** The Library with nothing of any kind: no tool managed, nothing read of any kind, or some of it couldn't be read. */
function libraryEmpty(kinds: PageKind[]): Empty {
  const hint = addHint([...new Set(kinds.flatMap(kind => state.home?.[kind].tools ?? []))], 'any of them');
  return kinds.some(unread) ? { glyph: 'layers', title: 'Nothing read here', body: `Some of this home couldn’t be read, so there may be items. ${hint}` }
    : { glyph: 'layers', title: 'Nothing in the Library yet', body: `None of ${whose()} has a skill, MCP server or agent in this home. ${hint}` };
}
/** Shown before any home has been read, or when reading failed. */
export function notRead() {
  if (state.busy) return reading();
  return h('div.page', {}, emptyBands(), emptyState('circle-alert', 'Could not read this home', 'Nothing changed.', button({ label: 'Try again', id: 'first-retry', onclick: () => void (state.lastMode ? loadHome(state.lastMode) : startHome()) })));
}


// ---------- The Library ----------

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
      copyButton(skill.directory, `path for ${toolName(tool)}`, partId('copy', rowId('skills', key), index))),
    h('p.copy-entry-path', {}, wrappingPath(skill.directory)),
    linkedElsewhere(skill) ? h('p.copy-entry-real', {}, h('span.copy-entry-label', {}, 'Real folder'),
      h('span.path-left', { title: skill.realDirectory }, h('span', {}, skill.realDirectory)),
      copyButton(skill.realDirectory, `real folder for ${toolName(tool)}`, partId('copy-real', rowId('skills', key), index))) : null,
    skill.metadataKeys.length ? h('p.copy-entry-more', {}, h('span.copy-entry-label', {}, 'Fields of note '), skill.metadataKeys.join(', ')) : null);
}

/** One block per distinct content, named by the copies that hold it. */
const contents = (key: string, copies: Found[]) =>
  fileBlocks(partId('content', rowId('skills', key)), 'Skill contents', copies.map(copy => ({ ...copy, text: copy.skill.content })), holders => holders.map(({ tool, skill }) => `${toolName(tool)} (${skill.rootLabel})`).join(', '));

/**
 * The Library: every skill, MCP server and agent this home's tools can hold, in one list under the kind switch (matrix.ts
 * libraryTable, which says a segment's own kind has none: kindEmpty), or a skill's files and contents beside the list ("Files").
 */
export function libraryPage() {
  const home = state.home;
  if (!home) return notRead();
  const kinds = heldKinds(home);
  if (noToolManaged() || !kinds.some(kind => rowCount(home, kind))) return nothingHere(libraryEmpty(kinds), 'library-empty');
  if (state.skillsView !== 'files') return libraryTable(kind => emptyWithActions(kindEmpty(kind), `${kind}-empty`));
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
