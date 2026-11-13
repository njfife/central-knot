// Sources: the page where a Git link is given as a source for the library (sources.ts, in main, is the engine; the table it
// follows is library.ts's A SOURCE). One field takes the link; Look reads it and shows, skill by skill, what Add would do and
// what it won't bring in and why, before anything is kept; Add brings each skill into Central Knot, Off. Each source has a row:
// its link, what it brought (On or Off), when it was last read, why it couldn't be read if so, Check now and Remove; a skill
// there the library holds deleted has its own Add. Every state a row says is the engine's (types.ts SourceNameState); this page
// only words it. Its own page rather than the Git repo's: that page is Pull and Push of the whole set, two-way and in Central
// Knot's layout, while a source is read only, holds a few skills, and its rows grow one per link.
import { announce, busy, rerender, showPage, state } from './app.ts';
import { button, closeButton, h, icon } from './dom.ts';
import { dayAndTime, plural } from './model.ts';
import { linkLabel } from './sourcelink.ts';
import { andList } from './words.ts';
import { outcomeBand } from './matrix.ts';
import type { SourceFound, SourceName, SourcePreview, SourceResult, SourcesView, SourceView } from './types.ts';

const api = () => window.centralKnot;

export const sources = {
  /** The sources as last read; undefined until the page first loads them. */
  view: undefined as SourcesView | undefined,
  /** The link being typed. */
  draft: '',
  /** What the last Look found, until Add, Cancel or a new Look. */
  preview: undefined as SourcePreview | undefined,
  /** What stopped the last Add, Check now, Remove or Add on one name, in plain words, until dismissed. */
  problem: undefined as string | undefined,
  /** The source whose Remove is being asked, in place. */
  confirmRemove: undefined as string | undefined,
};

/** Leaving the page or the home: its questions, and (another home) its view and look, belong to it alone. */
export function forgetSourcePrompts(homeChanged = false): void {
  sources.problem = undefined;
  sources.confirmRemove = undefined;
  if (homeChanged) { sources.view = undefined; sources.preview = undefined; sources.draft = ''; }
}

/** Reads the sources (no network: each one's last read), and redraws. */
export async function loadSources(): Promise<void> {
  try { sources.view = (await api().sources()) ?? undefined; }
  catch (error) { sources.problem = `Couldn’t read the sources: ${String(error instanceof Error ? error.message : error)}`; }
  rerender();
}

// ---------- The clicks ----------

/** After a click that may have changed the library: the home read again, so the Skills page and every count follow. */
async function settle(result: SourceResult, said: string | undefined) {
  if (result.view) sources.view = result.view;
  sources.problem = result.stopped;
  sources.confirmRemove = undefined;
  const home = await api().refresh();
  if (home) state.home = home;
  if (said && !result.stopped) state.outcome = { page: 'sources', text: said, band: true, act: { label: 'Open Skills', id: 'source-open-skills', run: () => showPage('skills') } };
  announce(result.stopped ?? said ?? '', true);
}

const look = () => busy('Reading the link…', async () => {
  sources.preview = await api().previewSource(sources.draft, state.home!.home);
  sources.problem = undefined;
  if (!('token' in sources.preview)) announce(sources.preview.refused, true);
});

const add = (token: string, label: string) => busy('Adding the source…', async () => {
  const result = await api().addSource(token, state.home!.home);
  if (!result.stopped) { sources.preview = undefined; sources.draft = ''; }
  await settle(result, `Added ${label}. ${didWords(result)}`);
});

const checkNow = (source: SourceView) => busy(`Checking ${linkLabel(source.link)}…`, async () => {
  const result = await api().checkSource(source.id, state.home!.home);
  await settle(result, `Checked ${linkLabel(source.link)}. ${didWords(result)}`);
});

const bringBack = (source: SourceView, name: SourceName) => busy(`Bringing ${name.name} back…`, async () => {
  const result = await api().bringBackFromSource(source.id, name.key, state.home!.home);
  await settle(result, didWords(result));
});

const remove = (source: SourceView) => busy('Removing the source…', async () => {
  const result = await api().removeSource(source.id, state.home!.home);
  await settle(result, `Removed ${linkLabel(source.link)}. Its skills stay in Central Knot as they are, On or Off, with their versions; they are no longer from it.`);
  if (state.outcome?.page === 'sources') state.outcome.act = undefined;
});

/** What a click did, from the pass's own answers (types.ts PassResult sourced), in a sentence or two. */
export function didWords(result: Pick<SourceResult, 'sourced'>): string {
  const named = (...answers: string[]) => (result.sourced ?? []).filter(entry => answers.includes(entry.answer)).map(entry => entry.name);
  const are = (names: string[]) => (names.length === 1 ? 'is' : 'are');
  const made = named('make'), linked = named('link'), updated = named('update'), kept = named('keep'), dropped = named('drop'), left = named('differs', 'another', 'deleted');
  const said = [
    made.length ? `${andList(made)} ${are(made)} in Central Knot, Off: turn ${made.length === 1 ? 'it' : 'them'} on on Skills.` : '',
    linked.length ? `${andList(linked)} ${are(linked)} in Central Knot already, the same, and ${linked.length === 1 ? 'is' : 'are'} now from it.` : '',
    updated.length ? `${andList(updated)}: the source’s version is current now.` : '',
    kept.length ? `${andList(kept)}: your version is later and stays current; the source’s is kept as a version.` : '',
    dropped.length ? `${andList(dropped)}: the source no longer has ${dropped.length === 1 ? 'it' : 'them'}, so ${dropped.length === 1 ? 'it is' : 'they are'} off and no longer from it.` : '',
    left.length ? `Not brought in: ${andList(left)} (${left.length === 1 ? 'its row says' : 'their rows say'} why).` : '',
  ].filter(Boolean);
  return said.length ? said.join(' ') : 'Nothing changed: the source is as it was last read.';
}

// ---------- Words ----------

/** What one skill at a source is to the library, as its line says it (the engine's state: types.ts SourceNameState). */
function stateWords(name: SourceName, preview: boolean): { text: string; warns?: boolean } {
  const called = name.name ?? name.key;
  switch (name.state) {
    case 'in': return { text: name.on ? 'In Central Knot, On' : 'In Central Knot, Off' };
    case 'make': return { text: preview ? 'Comes in, Off: in no tool until you turn it on' : 'Comes in, Off, at the next Check now' };
    case 'link': return { text: `Already in Central Knot, the same: ${preview ? 'Add links it to this source' : 'linked at the next Check now'}` };
    case 'differs': return { text: `Not brought in: Central Knot already has a different ${called}`, warns: true };
    case 'another': return { text: `Not brought in: Central Knot has ${called} from ${name.why ? linkLabel(name.why) : 'another source'}`, warns: true };
    case 'deleted': return { text: `Not brought in: deleted from Central Knot.${preview ? ' Once the source is added, Add on its row brings it back, or Restore in History.' : ''}`, warns: true };
    case 'unusable': return { text: `Can’t be used: ${name.why}`, warns: true };
  }
}

/** Where a read is: its branch, its folder and its commit, said short. */
const whereWords = (found: SourceFound) => [`Branch ${found.ref}`, found.folder ? `folder ${found.folder}` : 'its root folder',
  found.commit ? `commit ${found.commit.slice(0, 7)}${found.commitAt ? ` of ${dayAndTime(found.commitAt)}` : ''}` : ''].filter(Boolean).join(' · ');

/** A skill's files, the first few by path; every one in the tooltip. */
const FILES_SHOWN = 10;
function filesLine(name: SourceName) {
  if (!name.files.length) return null;
  const shown = name.files.slice(0, FILES_SHOWN), more = name.files.length - shown.length;
  return h('span.source-files', { title: name.files.join('\n') }, h('span.source-files-count', {}, `${plural(name.files.length, 'file')}:`), ' ',
    ...shown.flatMap((file, index) => [index ? ', ' : '', h('span.mono', {}, file)]), more ? `, and ${more} more…` : '');
}

// ---------- Pieces ----------

/** One skill at a source: its name (with its folder there where that differs), what it is to the library, its files, and its own Add. */
function nameRow(name: SourceName, preview: boolean, action?: HTMLElement | null) {
  // Named by its SKILL.md: where its folder (or, at the root, its repository) is called something else, both are said.
  const said = stateWords(name, preview);
  const where = name.folderName === name.name ? '' : name.folder ? `in the folder ${name.folder}` : `the repository ${name.folderName}`;
  return h('li.source-name', { 'data-key': name.key, 'data-state': name.state },
    h('span.source-name-icon', {}, icon(said.warns ? 'triangle-alert' : name.state === 'in' && name.on ? 'circle-check' : 'wand-sparkles', 14, said.warns ? 'tone-warning' : 'tone-muted')),
    h('span.source-name-main', {},
      h('span.source-name-line', {}, h('strong.source-name-text', {}, name.name ?? name.folder), where ? h('span.source-name-where.tone-muted', {}, where) : null),
      h('span.source-name-state', {}, said.text, action ? [' ', action] : null),
      filesLine(name)));
}

/** What else is there that this version doesn't read. */
const laterLines = (found: SourceFound) => (found.later.length
  ? h('p.source-later', {}, icon('info', 12, 'tone-muted'), h('span', {}, `Not read in this version: ${found.later.join('; ')}.`)) : null);

/** The look's panel: where it read, what Add does with each skill, and Add, or why it can't be added. */
function previewPanel(preview: SourcePreview) {
  const cancel = button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'source-cancel', disabled: !!state.busy, onclick: () => { sources.preview = undefined; rerender(); } });
  if (!('token' in preview)) return h('div.source-preview', { id: 'source-preview', role: 'region', 'aria-label': 'What the link holds' },
    h('p.source-refused', {}, icon('circle-alert', 14, 'tone-danger'), h('span', {}, preview.refused)), h('div.source-preview-actions', {}, cancel));
  const label = linkLabel(preview.link), coming = preview.names.filter(name => name.state === 'make' || name.state === 'link');
  const allowed = !preview.refused && !!state.home?.sync.access.allowed;
  const addLabel = coming.length ? `Add ${plural(coming.length, 'skill')}` : 'Add the source';
  return h('div.source-preview', { id: 'source-preview', role: 'region', 'aria-label': `What ${label} holds` },
    h('div.source-preview-head', {}, h('strong.source-link', { title: preview.link }, label), h('span.source-where.tone-muted', {}, whereWords(preview))),
    preview.refused ? h('p.source-refused', {}, icon('circle-alert', 14, 'tone-danger'), h('span', {}, preview.refused)) : null,
    preview.names.length ? h('ul.source-names', {}, preview.names.map(name => nameRow(name, true))) : null,
    laterLines(preview),
    h('div.source-preview-actions', {},
      preview.refused ? null : button({ variant: 'primary', size: 'small', icon: 'plus', label: addLabel, id: 'source-add', disabled: !allowed || !!state.busy, onclick: () => void add(preview.token, label) }),
      cancel,
      preview.refused ? null : h('span.source-note', {}, 'What comes in is Off: in Central Knot, in no tool, until you turn it on. Nothing is ever written to the source.')));
}

/** The field and Look. */
function addForm(allowed: boolean) {
  const ready = () => !state.busy && allowed && !!sources.draft.trim();
  const go = () => { if (ready()) void look(); };
  return h('section.source-add', { 'aria-labelledby': 'source-add-title' },
    h('h2.eyebrow', { id: 'source-add-title' }, 'Add skills from a link'),
    h('div.source-field', {},
      h('label.market-add-label', { for: 'source-link' }, 'GitHub or GitLab link'),
      h('div.source-field-row', {},
        h('input.market-add-input', { id: 'source-link', type: 'text', placeholder: 'https://github.com/owner/repo/tree/main/skills/name', value: sources.draft, spellcheck: 'false', autocomplete: 'off',
          disabled: !!state.busy || !allowed, 'aria-describedby': 'source-link-below',
          oninput: (event: Event) => { sources.draft = (event.target as HTMLInputElement).value; const control = document.getElementById('source-look') as HTMLButtonElement | null; if (control) control.disabled = !ready(); },
          onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') go(); } }),
        button({ variant: 'outline', size: 'small', icon: 'search', label: 'Look', id: 'source-look', disabled: !ready(), onclick: go })),
      h('span.repo-field-below', { id: 'source-link-below' }, 'A repository, a branch, or a folder in one. owner/repo, or an address you would give git clone, works too. Central Knot uses this computer’s git and its sign-in.')),
    sources.preview ? previewPanel(sources.preview) : null);
}

/** One source's row: its link and where it reads, why its last check failed, each skill there, Check now and Remove. */
function sourceRow(source: SourceView) {
  const label = linkLabel(source.link), locked = !!state.busy || !state.home?.sync.access.allowed;
  const asking = sources.confirmRemove === source.id;
  const read = source.readAt ? `read ${dayAndTime(source.readAt)}` : '';
  const actions = asking ? null : h('span.source-actions', {},
    button({ variant: 'outline', size: 'small', icon: 'refresh-cw', label: 'Check now', id: `source-check-${source.id}`, disabled: locked, attrs: { title: `Read ${label} again: what changed there comes into Central Knot, On or Off as each skill is` }, onclick: () => void checkNow(source) }),
    button({ variant: 'ghost', size: 'small', label: 'Remove…', id: `source-remove-${source.id}`, disabled: locked, onclick: () => { sources.confirmRemove = source.id; rerender(); document.getElementById(`source-remove-cancel-${source.id}`)?.focus(); } }));
  const bringBackButton = (name: SourceName) => (name.state === 'deleted' && !source.copyGone ? button({ variant: 'link', size: 'micro', label: 'Add', id: `source-bring-${source.id}-${name.key}`, disabled: locked,
    attrs: { title: `Bring ${name.name ?? name.key} back into Central Knot, Off, at this source’s version; its earlier versions come back with it` }, onclick: () => void bringBack(source, name) }) : null);
  return h('li.source-row', { id: `source-${source.id}`, 'data-source': source.id },
    h('div.source-row-head', {},
      h('span.source-row-title', {}, icon('link-2', 16, 'tone-muted'), h('strong.source-link', { title: source.link }, label)),
      actions),
    h('span.source-where.tone-muted', {}, [whereWords(source), read].filter(Boolean).join(' · ')),
    asking ? h('div.band.source-confirm', { role: 'alert' }, h('span.band-text', {}, 'Remove this source? Its skills stay in Central Knot as they are, On or Off, with their versions; they are no longer from it.'),
      button({ variant: 'outline', size: 'small', label: 'Remove', id: `source-remove-confirm-${source.id}`, disabled: !!state.busy, onclick: () => void remove(source) }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: `source-remove-cancel-${source.id}`, onclick: () => { sources.confirmRemove = undefined; rerender(); } })) : null,
    source.problem ? h('p.source-refused', {}, icon('circle-alert', 14, 'tone-danger'), h('span', {}, `Couldn’t read it at the last check: ${source.problem} What came from it stays as it is.`)) : null,
    source.copyGone ? h('p.source-later', {}, icon('info', 12, 'tone-muted'), h('span', {}, 'Its last read isn’t kept here any more. Check now reads it again.')) : null,
    source.names.length ? h('ul.source-names', {}, source.names.map(name => nameRow(name, false, bringBackButton(name)))) : null,
    laterLines(source));
}

/** What stopped the last click, until dismissed. */
const problemBand = () => (sources.problem ? h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', {}, sources.problem),
  closeButton(() => { sources.problem = undefined; rerender(); }, { id: 'source-problem-dismiss' })) : null);

export function sourcesPage(): HTMLElement {
  const view = sources.view;
  if (!view) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
  const allowed = view.access.allowed;
  return h('div.page.sources-page', {},
    h('div.bands', {}, allowed ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.access.reason)),
      view.problem ? h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', {}, view.problem)) : null,
      problemBand(), outcomeBand()),
    h('div.scroll.sources-scroll', { id: 'sources-scroll' },
      addForm(allowed),
      view.sources.length ? h('section.source-list', { 'aria-labelledby': 'source-list-title' },
        h('h2.eyebrow', { id: 'source-list-title' }, `Sources · ${view.sources.length}`),
        h('ul.source-rows', {}, view.sources.map(sourceRow)))
        : h('p.source-empty', {}, h('strong', {}, 'No sources yet. '), 'A source is a GitHub or GitLab link that skills are read from. Each skill there comes into Central Knot Off, and Check now reads the link again for what changed there. Central Knot never writes to a source.'),
      h('p.repo-aside', {}, 'Only skills come from a link in this version; agents, MCP servers and plugins from a link come later.')));
}
