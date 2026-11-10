// Memory: what Claude Code and Codex keep of what they learn, shown as it is. Nothing on this page writes.
import { noTools, rerender, showFile, showPage, shownPath, state } from './app.ts';
import { previewBlock } from './editparts.ts';
import { dayAndTime, nearDay, plural } from './model.ts';
import { noToolsState } from './pages.ts';
import { brandMark } from './brand.ts';
import { button, emptyState, h, icon, pathText, rereadBand } from './dom.ts';
import type { CodexMemory, MemoryNote, MemoryProject, MemoryView } from './types.ts';

/** Projects and memories opened, by path: kept while the app runs. */
const opened = new Set<string>();
const toggle = (key: string) => { if (opened.has(key)) opened.delete(key); else opened.add(key); rerender(); };

const COPILOT = 'Copilot keeps its memory on GitHub, where Central Knot can’t read it.';
const CODEX_NONE = 'Codex has no memory on this computer yet. Codex keeps memory only once it is turned on in Codex’s own settings.';

/** What Claude Code filed a memory as, in plain words. */
const kinds: Record<string, string> = { user: 'About you', feedback: 'How you work', project: 'Project', reference: 'Reference' };

const onDay = (iso: string) => nearDay(iso) ?? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/** A row that opens and closes what is under it. */
const opener = (id: string, open: boolean, label: string, onclick: () => void, ...body: (Node | string | null)[]) =>
  h('button.memory-toggle', { type: 'button', id, 'aria-expanded': String(open), title: `${open ? 'Hide' : 'Show'} ${label}`, onclick }, icon(open ? 'chevron-down' : 'chevron-right', 13, 'tone-faint'), h('span.memory-row', {}, ...body));

function noteRow(note: MemoryNote, id: string) {
  const open = opened.has(note.path);
  const kind = note.kind ? kinds[note.kind] ?? note.kind : undefined;
  if (note.unreadable) return h('li.memory-note', {}, h('div.memory-toggle.memory-unreadable', {}, icon('circle-alert', 13, 'tone-muted'), h('span.memory-row', {}, h('strong.memory-title', {}, note.title), h('span.memory-what', {}, 'This file could not be read.'))));
  return h(`li.memory-note${open ? '.open' : ''}`, {},
    opener(id, open, note.title, () => toggle(note.path),
      h('strong.memory-title', {}, note.title), kind ? h('span.memory-kind', {}, kind) : null,
      note.description ? h('span.memory-what', { title: note.description }, note.description) : null),
    open ? h('div.memory-text', {}, h('pre.ins-preview', { tabindex: '0', 'aria-label': note.title, id: `${id}-text` }, note.text.replace(/^\s*\n/, '').trimEnd()),
      h('p.memory-meta', {}, pathText(shownPath(note.path), note.path), h('span', {}, `Written ${dayAndTime(note.at)}`))) : null);
}

function projectRow(project: MemoryProject, index: number) {
  const open = opened.has(project.folder);
  const count = project.notes.filter(note => !note.index).length;
  const id = `memory-project-${index}`;
  return h(`li.memory-project${open ? '.open' : ''}`, {},
    opener(id, open, `the memories of ${project.label}`, () => toggle(project.folder),
      h('code.memory-label', { title: project.folder }, project.label),
      h('span.memory-count', {}, `${count ? plural(count, 'memory', 'memories') : 'Its index only'} · newest ${onDay(project.newest)}`)),
    open ? h('div.memory-open', {},
      h('ul.memory-notes', {}, project.notes.map((note, at) => noteRow(note, `${id}-note-${at}`))),
      h('p.memory-meta', {}, pathText(shownPath(project.folder), project.folder),
        button({ variant: 'link', size: 'micro', label: 'Show in folder', id: `${id}-show`, onclick: () => showFile(project.folder) }))) : null);
}

const toolHead = (tool: 'claude-cli' | 'codex-cli', name: string, ...rest: (Node | null)[]) => h('header.ins-head', {}, brandMark(tool, 18), h('h2.tool-title', {}, name), ...rest);

function claudeCard(projects: MemoryProject[]) {
  return h('article.card.ins-card.memory-card', { 'aria-label': 'Claude Code memory' },
    toolHead('claude-cli', 'Claude Code'),
    h('p.ins-readers', {}, 'Claude Code keeps what it learns per project. What it reads in every project is CLAUDE.md, on the ',
      h('button.inline-link', { type: 'button', id: 'memory-go-instructions', onclick: () => showPage('instructions') }, 'Instructions'), ' page.'),
    projects.length ? h('ul.memory-projects', {}, projects.map(projectRow)) : h('p.ins-empty', {}, 'No project has any memories yet.'));
}

function codexCard(codex: CodexMemory) {
  const summary = codex.summary;
  return h('article.card.ins-card.memory-card', { 'aria-label': 'Codex memory' },
    toolHead('codex-cli', 'Codex', summary ? pathText(shownPath(summary.path), summary.path) : null),
    summary ? [h('p.ins-readers', {}, `Codex’s memory summary, which every Codex session gets. Codex last rewrote it ${dayAndTime(summary.at)}.`),
      h('div.ins-body', {}, previewBlock(summary.text, 'memory-codex', 'Codex memory summary', 'memory-codex-more'))]
      : h('p.ins-empty', {}, CODEX_NONE));
}

/** Said when no tool here has any memory: what each tool here does, so the empty page is not a puzzle. */
function nothingKept(view: MemoryView) {
  const lines = [view.claude ? 'Claude Code saves what it learns in a project as you work with it there.' : '', view.codex ? CODEX_NONE : '', view.copilot ? COPILOT : ''].filter(Boolean);
  return emptyState('brain', 'No memory here yet', lines.length ? lines.join(' ') : 'None of your tools here keeps a memory of its own.');
}

export function memoryPage() {
  // From Memory's own read (pagedata.ts): what it found, else that it is reading or could not read.
  const view = state.memory.data;
  if (!view) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, state.memory.state === 'failed' ? 'Memory could not be read.' : 'Reading memory…')));
  if (noTools()) return h('div.page', {}, noToolsState('memory-choose-home'));
  const reread = rereadBand(state.memory);
  const bands = reread ? h('div.bands', {}, reread) : null;
  if (!view.claude?.length && !view.codex?.summary) return h('div.page', {}, bands, nothingKept(view));
  return h('div.page', {}, bands,
    h('div.scroll.cards-scroll', { id: 'memory-scroll' },
      view.claude ? claudeCard(view.claude) : null,
      view.codex ? codexCard(view.codex) : null,
      view.copilot ? h('p.tools-note', {}, icon('info', 14, 'tone-muted'), COPILOT) : null));
}
