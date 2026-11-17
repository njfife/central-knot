// Sources: the page where a Git link is given as a source for the library, titled on screen as words.ts pageNames says (in
// the code it stays `sources`; sources.ts, in main, is the engine; the table it follows is library.ts's A SOURCE).
// One field takes the link; Look reads it and shows, item by item, what Add would do and what it won't bring in and why,
// before anything is kept; Add brings each item into Central Knot, Off. Each source has a row: its link, what it brought (On
// or Off), when it was last read, why it couldn't be read if so, Check now and Remove; an item there the library holds deleted
// has its own Add, and one whose version waits (library.ts changedHere) its own Merge, Replace and Keep mine; an item the
// source removed (library.ts REMOVED AT ITS SOURCE, which its kind's view says: types.ts LibraryFacts fromSource) has a line
// with Turn on, its switch on its kind's page. Every line and click carries its item's kind (types.ts SourceName `kind`; ids
// too: source-merge-<id>-skill-<key>), which pluginstatus.ts pageOfPart maps to its page, and whose words (words.ts kindNouns)
// the line says; a sentence about every source names the kinds a source brings (SourcesView `kinds`). Every state a row says
// is the engine's (types.ts SourceNameState, and that fromSource); this page only words it. The field takes any GitHub or
// GitLab link: a plugin's own folder is a source like any other, with what of it doesn't come said (types.ts NotComing); a
// marketplace, or a plugin one lists, is no source: where the engine offers it (SourcePreview `toPlugins`: sources.ts
// handOff), the look's one action is the hand-off button (words.ts toPluginsLabel), the Plugins page's own add (pluginstate.ts
// addMarketplace), run on that page, which tells its outcome. Its own page rather than the Git repo's: that page is Pull and Push of the whole set, two-way
// and in Central Knot's layout, while a source is read only, holds a few items, and its rows grow one per link.
import { announce, applyClick, busy, rerender, showPage, state, type PageKind } from './app.ts';
import { button, closeButton, h, icon } from './dom.ts';
import { asItIs } from './libraryrow.ts';
import { dayAndTime, plural } from './model.ts';
import { linkLabel } from './sourcelink.ts';
import { andList, kindNouns, orList, pageNames, toolsPhrase, toPluginsLabel, turnIt } from './words.ts';
import { outcomeBand } from './matrix.ts';
import { pageOfPart } from './pluginstatus.ts';
import { addMarketplace, market } from './pluginstate.ts';
import type { ItemKind } from './library.ts';
import type { IconName } from './icons.ts';
import type { HarnessId, LibraryFacts, MergeDone, NotComing, SourcedItem, SourceFound, SourceName, SourcePreview, SourceResult, SourceRowClick, SourcesView, SourceView, ToPlugins } from './types.ts';

const api = () => window.centralKnot;
/** A kind's words on this page ("skill", "Skills"), from its page's (words.ts kindNouns). */
const nouns = (kind: ItemKind) => kindNouns[pageOfPart[kind]];
/** The kinds a source brings (the view's: types.ts SourcesView `kinds`), as a sentence names many of them ("skills, agents and MCP servers"). */
const broughtNames = () => andList((sources.view?.kinds ?? []).map(kind => nouns(kind).many));

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

/**
 * After a click that may have changed the library: the home read again, so each kind's page and every count follow, then the
 * band (what the click did, from `said`, with its one action, and Open on the page of the kind where something changed).
 */
async function settle(result: SourceResult, said: Said | undefined) {
  if (result.view) sources.view = result.view;
  sources.problem = result.stopped;
  sources.confirmRemove = undefined;
  const home = await api().refresh();
  if (home) state.home = home;
  if (said && !result.stopped) {
    state.outcome = { page: 'sources', text: said.text, band: true, warn: said.warns, ...(said.note ? { note: said.note } : {}), ...(said.undo ? { undo: said.undo } : {}),
      ...(said.open ? { next: { label: `Open ${kindNouns[said.open].title}`, id: `source-open-${said.open}`, run: () => showPage(said.open!) } } : {}) };
  }
  announce(result.stopped ?? said?.text ?? '', true);
}

const look = () => busy('Reading the link…', async () => {
  sources.preview = await api().previewSource(sources.draft, state.home!.home);
  sources.problem = undefined;
  if (!('token' in sources.preview)) announce(sources.preview.refused, true);
});

const add = (token: string, label: string) => busy('Adding the source…', async () => {
  const result = await api().addSource(token, state.home!.home);
  if (!result.stopped) { sources.preview = undefined; sources.draft = ''; }
  const said = whatItDid(result, label);
  await settle(result, { ...said, text: `Added ${label}. ${said.text}` });
});

/**
 * The hand-off button (words.ts toPluginsLabel): the Plugins page opens, then runs its own add with the hand-off's address
 * (pluginstate.ts addMarketplace), whose outcome or problem it tells there. The look and the field clear only when it worked; when it didn't, the link stays here.
 */
async function toPlugins(address: string) {
  showPage('plugins');
  await addMarketplace(address);
  if (!market.problem) { sources.preview = undefined; sources.draft = ''; }
}

const checkNow = (source: SourceView) => busy(`Checking ${linkLabel(source.link)}…`, async () => {
  const result = await api().checkSource(source.id, state.home!.home);
  await settle(result, whatItDid(result, linkLabel(source.link)));
});

/** What the page says while each click on a name's line runs. */
const running: Record<SourceRowClick, (called: string) => string> = {
  bringBack: called => `Bringing ${called} back…`, replace: called => `Replacing ${called}…`, merge: called => `Merging ${called}…`, keep: called => `Keeping ${called} as it is…`,
};
/** A click on one name's line (sources.ts rowClick), in its kind. A Replace's band says that name has the source's version. */
const onLine = (source: SourceView, name: SourceName, click: SourceRowClick) => busy(running[click](name.name ?? name.key), async () => {
  const result = await api().rowClick(source.id, name.kind, name.key, click, state.home!.home);
  await settle(result, whatItDid(result, linkLabel(source.link), click === 'replace' ? { kind: name.kind, name: name.name ?? name.key } : undefined));
});

/** Turn on, on the line of an item its source removed: the same click as its switch on its kind's page, On (the revert: library.ts REMOVED AT ITS SOURCE). */
const turnOn = (fact: LibraryFacts, page: PageKind) => {
  const homeTools = state.home?.sync.managed ?? [];
  return applyClick({ kind: page, items: [fact.name], changes: [{ ...asItIs(fact.key, state.home?.[page].library[fact.key]), on: true, seenOn: false }],
    said: (_notIn, wrote) => `${fact.name} is on${wrote.length ? ` in ${toolsPhrase(wrote, homeTools)}` : ''}.` });
};

/** What Remove keeps, said before it and after it. */
const removeWords = () => `Its ${broughtNames()} stay in Central Knot as they are, On or Off, with their versions; they are no longer from it.`;

const remove = (source: SourceView) => busy('Removing the source…', async () => {
  const result = await api().removeSource(source.id, state.home!.home);
  await settle(result, { text: `Removed ${linkLabel(source.link)}. ${removeWords()}`, warns: false });
});

/**
 * A click's band: its sentences, whether it took an item out of tools (a warning, not a tick), History's note, its one action,
 * and the page it offers to open (`open`: that of the first kind where something changed).
 */
interface Said { text: string; warns: boolean; note?: string; undo?: { id: string; label: string }; open?: PageKind }

/**
 * What a source's click did, from what its passes did (types.ts SourcedItem: each item's kind and answer, the History entry that
 * says it, whether it is On, what a Merge did, and the tools it was written to or taken out of), and the kinds it wasn't read
 * whole for. An item its source dropped leads, with Turn on, and it, a read not whole or a Merge that changed nothing is a
 * warning; else the one update or merge has Undo. Open goes to the page of the first that changed. `replaced`: the item a click on Replace asked for, by kind and name, whose
 * update says so.
 */
export function whatItDid(result: Pick<SourceResult, 'sourced' | 'notWhole'>, label: string, replaced?: { kind: ItemKind; name: string }): Said {
  const homeTools = state.home?.sync.managed ?? [];
  const isReplaced = (entry: { kind: ItemKind; name: string }) => entry.kind === replaced?.kind && entry.name === replaced.name;
  const of = (...answers: string[]) => (result.sourced ?? []).filter(entry => answers.includes(entry.answer));
  const names = (entries: { name: string }[]) => andList(entries.map(entry => entry.name));
  const are = (entries: unknown[]) => (entries.length === 1 ? 'is' : 'are');
  const dropped = of('drop'), updated = of('update'), made = of('make'), linked = of('link'), left = of('differs', 'another', 'deleted'), kept = of('keep');
  const waiting = of('wait').filter(entry => !entry.merge), merges = (result.sourced ?? []).filter(entry => entry.merge), mergedIn = merges.filter(entry => entry.merge === 'merged');
  const unmerged = merges.filter(entry => entry.merge !== 'merged' && entry.merge !== 'had');
  const choices = 'Merge puts the source’s changes into yours if they don’t clash, Replace takes the source’s, and Keep mine keeps yours';
  const said = [
    ...dropped.map(entry => `${entry.name} is no longer at ${label}: it was turned off${entry.removed.length ? ` and taken out of ${toolsPhrase(entry.removed, homeTools)}` : ''}; Central Knot keeps it.`),
    ...updated.map(entry => {
      const now = !entry.on ? ', kept Off' : entry.written.length ? `, now in ${toolsPhrase(entry.written, homeTools)}` : '';
      return (isReplaced(entry) ? `${entry.name} has the source’s version${now}; the one it had is kept as a version.` : `${entry.name} was updated from its source${now}.`);
    }),
    waiting.length ? `${names(waiting)} changed at the source; yours ${waiting.length === 1 ? 'stays current, since it was' : 'stay current, since they were'} changed here or a tool’s copy can’t be read just now: on ${waiting.length === 1 ? 'its row' : 'each one’s row'}, ${choices}.` : '',
    ...merges.map(entry => mergeWords(entry.kind, entry.name, entry.merge!, entry.written, homeTools)),
    ...kept.map(({ name }) => `${name} stays as you have it, and the source’s version no longer waits: it is kept as a version, and the source’s next change is compared with it.`),
    made.length ? `${names(made)} ${are(made)} in Central Knot, Off: turn ${made.length === 1 ? 'it' : 'them'} on in ${andList([...new Set(made.map(entry => nouns(entry.kind).title))])}.` : '',
    linked.length ? `${names(linked)} ${are(linked)} in Central Knot already, the same, and ${linked.length === 1 ? 'is' : 'are'} now from it.` : '',
    left.length ? `Not brought in: ${names(left)} (${left.length === 1 ? 'its row says' : 'their rows say'} why).` : '',
    result.notWhole ? `Not all of ${label} could be read (its row says why), so the source turned no ${orList(result.notWhole.map(kind => nouns(kind).one))} off.` : '',
  ].filter(Boolean);
  const turnOn = dropped.length === 1 && dropped[0].history ? { id: dropped[0].history, label: `Turn ${dropped[0].name} on` } : undefined;
  // Merge's result exactly yours is Keep mine's outcome, with its entry (librarypass.ts keepMine).
  const keptAll = [...kept, ...merges.filter(entry => entry.merge === 'had')];
  const changed = [...updated, ...mergedIn], one = changed.length + keptAll.length === 1 ? [...changed, ...keptAll][0] : undefined;
  const undoLabel = (entry: NonNullable<typeof one>) =>
    (entry.answer === 'keep' ? 'Undo keep mine' : entry.merge ? 'Undo the merge' : isReplaced(entry) ? 'Undo the replace' : 'Undo the update');
  const undo = !turnOn && one?.history ? { id: one.history, label: undoLabel(one) } : undefined;
  const opens = [...dropped, ...changed, ...made, ...linked][0];
  return {
    text: said.length ? said.join(' ') : `Checked ${label}: nothing came in from it.`, warns: dropped.length > 0 || !!result.notWhole || unmerged.length > 0,
    ...(changed.length + keptAll.length ? { note: `See each change, or undo it, in History.` } : {}), ...(turnOn ?? undo ? { undo: turnOn ?? undo } : {}),
    // Open the page where something changed: not for a read that only says what can't be read, or what waits.
    ...(opens ? { open: pageOfPart[opens.kind] } : {}),
  };
}

/** What a click on Merge did to one item (types.ts MergeDone), said after it: `into`, the tools the merged version was written to. */
function mergeWords(kind: ItemKind, name: string, merge: MergeDone, into: HarnessId[], homeTools: string[]): string {
  if (merge === 'merged') return `${name} now has your changes and the source’s, merged${into.length ? `, in ${toolsPhrase(into, homeTools)}` : ''}; the version it had is kept.`;
  if (merge === 'had') return `${name} already had the source’s changes, so Merge changed nothing in it; the source’s version no longer waits.`;
  if (merge === 'unsettled') return `Merge left ${name} as it was, since a tool’s copy of it can’t be read just now (a save still landing, or a copy that can’t be read as it is). Merge can run once that copy can be read; on ${nouns(kind).title}, its row says which tool and why.`;
  if ('conflicts' in merge) {
    return `Merge left ${name} as it was: ${andList(merge.conflicts)} changed both here and at the source, in ways that can’t be merged.`
      + ' Replace takes the source’s version and keeps yours as a version; or make the source’s change in yours by hand, then Keep mine.'
      + ' Until then, yours stays current and the update keeps waiting.';
  }
  return `Merge couldn’t run, so ${name} is as it was: ${merge.couldNot}`;
}

// ---------- Words ----------

/**
 * What one item at a source, or one item linked to it, is to the library, as its line says it: the source's table's own answer
 * (types.ts SourceNameState), in a look (`preview`: what Add does) or on a source's row (what the next Check now does).
 */
function stateWords(name: SourceName, preview: boolean): { text: string; warns?: boolean } {
  const called = name.name ?? name.key, next = preview ? 'Add' : 'the next Check now';
  switch (name.state) {
    case 'nothing': case 'same': return { text: name.on ? 'In Central Knot, On' : 'In Central Knot, Off' };
    case 'make': return { text: preview ? 'Comes in, Off: in no tool until you turn it on' : 'Comes in, Off, at the next Check now' };
    case 'link': return { text: `Already in Central Knot, the same: ${next} links it to this source` };
    case 'update': return { text: preview ? 'Came from this link before and is unchanged: Add links it again, and the source’s version becomes current' : `Changed at the source: ${next} makes that the current version` };
    // The type check needs `merge`, `keep` and `let-go` here: SourceNameState holds every SourceAnswer, and the first two are a
    // click's own and the third a plugin's (library.ts A PLUGIN), never a Git source's row.
    case 'wait': case 'merge': case 'keep': case 'let-go': return { warns: true, text: 'Changed at the source. Yours stays current until you merge, replace or keep it,'
      + ' since it was changed here or a tool’s copy can’t be read just now. Merge puts the source’s changes into yours if they don’t clash;'
      + ' Replace takes the source’s and keeps yours as a version; Keep mine keeps yours current, and the source’s as a version, so it no longer waits.' };
    case 'drop': return { text: `No longer at the source: ${next} turns it off`, warns: true };
    case 'differs': return { text: `Not brought in: Central Knot already has a different ${called}. To take this one instead, delete yours from Central Knot on ${nouns(name.kind).title} (that also takes it out of every tool it is on in), then ${preview ? 'once the source is added, Add on its row' : 'Add on this row'}.`, warns: true };
    case 'another': return { text: `Not brought in: Central Knot has ${called} from ${name.why ? linkLabel(name.why) : 'another source'}`, warns: true };
    case 'deleted': return { text: `Not brought in: deleted from Central Knot.${preview ? ' Once the source is added, Add on its row brings it back, or Restore in History.' : ''}`, warns: true };
    case 'unreadable': return { text: `Can’t be read: ${name.why}. ${preview ? 'Add can’t bring it in.' : `Until it can, this source turns no ${nouns(name.kind).one} off.`}`, warns: true };
    // Left out at the source, it changes nothing here: an item Central Knot has of that name stays as it is.
    case 'leftOut': return { warns: true, text: name.on === undefined ? `Not brought in: ${name.why}.`
      : `In Central Knot, ${name.on ? 'On' : 'Off'}, as it was: what the source has now is not brought in, since ${name.why}.` };
  }
}

/** Where a read is: its branch, its folder and its commit, said short. */
const whereWords = (found: SourceFound) => [`Branch ${found.ref}`, found.folder ? `folder ${found.folder}` : 'its root folder',
  found.commit ? `commit ${found.commit.slice(0, 7)}${found.commitAt ? ` of ${dayAndTime(found.commitAt)}` : ''}` : ''].filter(Boolean).join(' · ');

/** What of a plugin's own folder doesn't come (types.ts NotComing), as a sentence; none when it has none of those. */
function notComingWords(left: NotComing | undefined): string | undefined {
  const parts = !left ? [] : [left.commands ? `its ${plural(left.commands, 'command')}` : '', left.hooks ? 'its hooks' : '',
    left.lspServers ? `its ${plural(left.lspServers, 'LSP server')}` : '', left.bin ? 'its bin folder' : ''].filter(Boolean);
  return parts.length ? `Not brought in: ${andList(parts)}. Central Knot installs plugins only from a marketplace, on the ${pageNames.plugins} page: to have the whole plugin, add a marketplace that lists it there.` : undefined;
}

/** An item's files, the first few by path; every one in the tooltip. */
const FILES_SHOWN = 10;
function filesLine(files: string[]) {
  if (!files.length) return null;
  const shown = files.slice(0, FILES_SHOWN), more = files.length - shown.length;
  return h('span.source-files', { title: files.join('\n') }, h('span.source-files-count', {}, `${plural(files.length, 'file')}:`), ' ',
    ...shown.flatMap((file, index) => [index ? ', ' : '', h('span.mono', {}, file)]), more ? `, and ${more} more…` : '');
}
/** Where an item sits at the source: at the root of its repository, or in its folder. */
const whereAt = ({ folder, folderName }: NonNullable<SourceName['there']>) => (folder ? `in the folder ${folder}` : `at the root of ${folderName}`);

// ---------- Pieces ----------

/** One item at a source: its name, its kind and where it sits there, what it is to the library, its files, and its own Add. */
function nameRow(name: SourceName, preview: boolean, action?: HTMLElement | null) {
  const said = stateWords(name, preview);
  return h('li.source-name', { 'data-key': name.key, 'data-kind': name.kind, 'data-state': name.state },
    h('span.source-name-icon', {}, icon(said.warns ? 'triangle-alert' : name.state === 'nothing' && name.on ? 'circle-check' : 'wand-sparkles', 14, said.warns ? 'tone-warning' : 'tone-muted')),
    h('span.source-name-main', {},
      h('span.source-name-line', {}, h('strong.source-name-text', {}, name.name ?? name.there?.folderName ?? name.key),
        h('span.source-name-where.tone-muted', {}, `${nouns(name.kind).one}, ${name.there ? whereAt(name.there) : 'not in its last read'}`)),
      h('span.source-name-state', {}, said.text, action ? [' ', action] : null),
      filesLine(name.there?.files ?? [])));
}

/**
 * An item this source removed (types.ts LibraryFacts fromSource `removed`), from its kind's page: what it is now, and Turn on,
 * its revert.
 */
function removedRow(fact: LibraryFacts, kind: ItemKind, locked: boolean) {
  const page = pageOfPart[kind];
  const turn = button({ variant: 'link', size: 'micro', label: turnIt(true), id: `source-turn-on-${kind}-${fact.key}`, disabled: locked,
    attrs: { title: `Turn ${fact.name} on in every tool it isn’t kept out of, as its switch on ${kindNouns[page].title} does. Undo turns it off again.` }, onclick: () => void turnOn(fact, page) });
  return h('li.source-name', { 'data-key': fact.key, 'data-kind': kind, 'data-state': 'removed' },
    h('span.source-name-icon', {}, icon('triangle-alert', 14, 'tone-warning')),
    h('span.source-name-main', {},
      h('span.source-name-line', {}, h('strong.source-name-text', {}, fact.name), h('span.source-name-where.tone-muted', {}, `${nouns(kind).one}, not in its last read`)),
      h('span.source-name-state', { title: 'Should this source have it again: unchanged here since, it follows the source again; changed here, it stays as you have it.' },
        'No longer at this source: it is Off, and no longer from it.', ' ', turn)));
}

/** A line of the look's panel or a source's row: its words beside an icon of its tone. */
const sayLine = (name: IconName, tone: string, words: string) => h('p.source-refused', {}, icon(name, 14, tone), h('span', {}, words));

/**
 * The look of a marketplace the Plugins page can add (SourcePreview `toPlugins`): what it is, in the engine's words, what Add to
 * Plugins does, and that action; a source is never made of it.
 */
function handOffPanel(preview: Extract<SourcePreview, { token: string }>, handed: ToPlugins, cancel: HTMLElement) {
  const label = linkLabel(preview.link), folders = preview.holds === 'marketplace'
    ? ` A link to one of its other folders, not a plugin’s (its skills/, say), brings that folder’s ${broughtNames()} here.` : '';
  return h('div.source-preview', { id: 'source-preview', role: 'region', 'aria-label': `What ${label} holds` },
    h('div.source-preview-head', {}, h('strong.source-link', { title: preview.link }, label), h('span.source-where.tone-muted', {}, whereWords(preview))),
    sayLine('puzzle', 'tone-muted', `${preview.refused ?? ''} ${toPluginsLabel} adds ${handed.name} there, with its ${plural(handed.plugins, 'plugin')}, none turned on.${folders}`),
    h('div.source-preview-actions', {},
      button({ variant: 'primary', size: 'small', icon: 'plus', label: toPluginsLabel, id: 'source-to-plugins', disabled: !state.home?.sync.access.allowed || !!state.busy, onclick: () => void toPlugins(handed.address) }),
      cancel,
      h('span.source-note', {}, `Nothing is installed, and nothing is kept on ${pageNames.sources}.`)));
}

/** The look's panel: where it read, what Add does with each item, and Add, or why it can't be added. */
function previewPanel(preview: SourcePreview) {
  const cancel = button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'source-cancel', disabled: !!state.busy, onclick: () => { sources.preview = undefined; rerender(); } });
  if (!('token' in preview)) return h('div.source-preview', { id: 'source-preview', role: 'region', 'aria-label': 'What the link holds' },
    sayLine('circle-alert', 'tone-danger', preview.refused), h('div.source-preview-actions', {}, cancel));
  if (preview.toPlugins) return handOffPanel(preview, preview.toPlugins, cancel);
  const label = linkLabel(preview.link), coming = preview.names.filter(name => name.state === 'make' || name.state === 'link');
  const allowed = !preview.refused && !!state.home?.sync.access.allowed;
  const counts = [...new Set(coming.map(name => name.kind))].map(kind => plural(coming.filter(name => name.kind === kind).length, nouns(kind).one, nouns(kind).many));
  const addLabel = coming.length ? `Add ${andList(counts)}` : 'Add the source';
  return h('div.source-preview', { id: 'source-preview', role: 'region', 'aria-label': `What ${label} holds` },
    h('div.source-preview-head', {}, h('strong.source-link', { title: preview.link }, label), h('span.source-where.tone-muted', {}, whereWords(preview))),
    preview.refused ? sayLine('circle-alert', 'tone-danger', preview.refused) : null,
    preview.holds === 'plugin' ? sayLine('puzzle', 'tone-muted', `The link holds a plugin: its ${broughtNames()} come in as this source’s, each with a switch of its own, and follow the link as any source’s do.`) : null,
    notComingWords(preview.notComing) ? sayLine('circle-minus', 'tone-muted', notComingWords(preview.notComing)!) : null,
    preview.names.length ? h('ul.source-names', {}, preview.names.map(name => nameRow(name, true))) : null,
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
    h('h2.eyebrow', { id: 'source-add-title' }, 'Add from a GitHub or GitLab link'),
    h('div.source-field', {},
      h('label.market-add-label', { for: 'source-link' }, 'GitHub or GitLab link'),
      h('div.source-field-row', {},
        h('input.market-add-input', { id: 'source-link', type: 'text', placeholder: 'github.com/owner/repo, or a link to a folder or a file in it', value: sources.draft, spellcheck: 'false', autocomplete: 'off',
          disabled: !!state.busy || !allowed, 'aria-describedby': 'source-link-below',
          oninput: (event: Event) => { sources.draft = (event.target as HTMLInputElement).value; const control = document.getElementById('source-look') as HTMLButtonElement | null; if (control) control.disabled = !ready(); },
          onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') go(); } }),
        button({ variant: 'outline', size: 'small', icon: 'search', label: 'Look', id: 'source-look', disabled: !ready(), onclick: go })),
      h('span.repo-field-below', { id: 'source-link-below' }, `Any link to a repository, a branch, a folder or a file in one; owner/repo, github.com/owner/repo, or an address you would give git clone, works too. A folder brings the ${broughtNames()} in it, a plugin’s own folder too; a marketplace goes to ${pageNames.plugins}. Central Knot uses this computer’s git and its sign-in.`)),
    sources.preview ? previewPanel(sources.preview) : null);
}

/** One source's row: its link and where it reads, why its last check failed, each item there, Check now and Remove. */
function sourceRow(source: SourceView) {
  const label = linkLabel(source.link), locked = !!state.busy || !state.home?.sync.access.allowed;
  const asking = sources.confirmRemove === source.id;
  const read = source.readAt ? `read ${dayAndTime(source.readAt)}` : '';
  const actions = asking ? null : h('span.source-actions', {},
    button({ variant: 'outline', size: 'small', icon: 'refresh-cw', label: 'Check now', id: `source-check-${source.id}`, disabled: locked, attrs: { title: `Read ${label} again: what changed there comes into Central Knot, On or Off as each one is, unless you changed it here` }, onclick: () => void checkNow(source) }),
    button({ variant: 'ghost', size: 'small', label: 'Remove…', id: `source-remove-${source.id}`, disabled: locked, onclick: () => { sources.confirmRemove = source.id; rerender(); document.getElementById(`source-remove-cancel-${source.id}`)?.focus(); } }));
  const called = (name: SourceName) => name.name ?? name.key;
  const idOf = (click: string, name: SourceName) => `source-${click}-${source.id}-${name.kind}-${name.key}`;
  const nameButton = (name: SourceName) => (name.state === 'deleted' ? button({ variant: 'link', size: 'micro', label: 'Add', id: idOf('bring', name), disabled: locked,
    attrs: { title: `Bring ${called(name)} back into Central Knot, Off, at this source’s version; its earlier versions come back with it` }, onclick: () => void onLine(source, name, 'bringBack') })
    : name.state === 'wait' ? h('span.source-name-actions', {},
      button({ variant: 'link', size: 'micro', label: 'Merge', id: idOf('merge', name), disabled: locked,
        attrs: { title: `Put this source’s changes to ${called(name)} into yours, in every tool it is on in; if they clash with yours, nothing changes and what clashes is named. Yours is kept as a version, and Undo puts it back` }, onclick: () => void onLine(source, name, 'merge') }),
      button({ variant: 'link', size: 'micro', label: 'Replace', id: idOf('replace', name), disabled: locked,
        attrs: { title: `Make this source’s version of ${called(name)} current, in every tool it is on in; yours is kept as a version, and Undo puts it back` }, onclick: () => void onLine(source, name, 'replace') }),
      button({ variant: 'link', size: 'micro', label: 'Keep mine', id: idOf('keep', name), disabled: locked,
        attrs: { title: `Keep your ${called(name)} current: this source’s version no longer waits and is kept as a version, and the source’s next change`
          + ' is compared with it. Nothing is written to a tool, and Undo takes it back' }, onclick: () => void onLine(source, name, 'keep') })) : null);
  // Each item this source removed, as its kind's view says it.
  const removed = (Object.entries(pageOfPart) as [ItemKind, PageKind][]).flatMap(([kind, page]) => (state.home?.[page].items ?? [])
    .filter(fact => fact.fromSource?.removed && fact.fromSource.link === source.link).map(fact => ({ fact, kind })));
  return h('li.source-row', { id: `source-${source.id}`, 'data-source': source.id },
    h('div.source-row-head', {},
      h('span.source-row-title', {}, icon('link-2', 16, 'tone-muted'), h('strong.source-link', { title: source.link }, label)),
      actions),
    h('span.source-where.tone-muted', {}, [whereWords(source), read].filter(Boolean).join(' · ')),
    h('span.source-does.tone-muted', {}, `Check now reads the link again, as Central Knot does once a day while Automatic sync is on: ${orList((sources.view?.kinds ?? []).map(kind => nouns(kind).a))} changed there is updated in the tools it is on in, unless you changed it here (then it waits for you); one no longer there is turned off and taken out of them.`),
    asking ? h('div.band.source-confirm', { role: 'alert' }, h('span.band-text', {}, `Remove this source? ${removeWords()}`),
      button({ variant: 'outline', size: 'small', label: 'Remove', id: `source-remove-confirm-${source.id}`, disabled: !!state.busy, onclick: () => void remove(source) }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: `source-remove-cancel-${source.id}`, onclick: () => { sources.confirmRemove = undefined; rerender(); } })) : null,
    source.problem ? h('p.source-refused', {}, icon('circle-alert', 14, 'tone-danger'), h('span', {}, `Couldn’t fetch it at the last check: ${source.problem} What came from it stays as it is; below is its last read.`)) : null,
    source.unread ? sayLine('triangle-alert', 'tone-warning', source.holds === 'marketplace' || source.holds === 'listed'
      ? `${source.unread} This source turns nothing off. Remove this source, then look at its link again, above, to see how it can go on ${pageNames.plugins}.`
      : `${source.unread} Until it can be read, this source turns nothing off.`) : null,
    notComingWords(source.notComing) ? sayLine('circle-minus', 'tone-muted', notComingWords(source.notComing)!) : null,
    source.names.length || removed.length ? h('ul.source-names', {}, source.names.map(name => nameRow(name, false, nameButton(name))), removed.map(({ fact, kind }) => removedRow(fact, kind, locked))) : null);
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
        : h('p.source-empty', {}, h('strong', {}, 'No sources yet. '), `A source is a GitHub or GitLab link that ${broughtNames()} are read from: a folder of them, or a plugin’s own folder. Each one there comes into Central Knot Off, and the link is read again once a day and on Check now for what changed there. Central Knot never writes to a source.`),
      h('p.repo-aside', {}, `A marketplace’s link isn’t a library source: Look offers ${toPluginsLabel} instead, where each of its plugins has its own switch.`)));
}
