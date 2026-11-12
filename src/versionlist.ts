// The versions of one item, in its opened row: newest first, each with when it was made and where it came from, the
// current one marked, a way to read each, and Make current on every other. Central Knot keeps every version until the item
// is deleted (library.ts), so a long list folds to its newest few with one line that shows the rest.
// It draws what it is given and calls back on a click: matrix.ts keeps which list is unfolded and which version is being
// read, and sends Make current as the item's click.
import { button, h, icon } from './dom.ts';
import { currentIndex, sourceWords, type LibraryItem, type Version } from './library.ts';
import { dayAndTime } from './model.ts';

/** How many versions a folded list shows. */
export const FOLDED_VERSIONS = 4;

/** A version's content as read from the library: its text, `'reading'` while it is fetched, or null when it is no longer kept. */
export type VersionText = { description: string; prompt: string } | 'reading' | null;

export interface VersionListView {
  item: LibraryItem;
  canWrite: boolean;
  /** Whether the whole list shows (else its newest FOLDED_VERSIONS). */
  unfolded: boolean;
  /** The version being read (its place in the list), and its text. */
  reading?: { index: number; text: VersionText };
  onUnfold(): void;
  onRead(index: number): void;
  onMakeCurrent(version: Version): void;
}

function versionRow(view: VersionListView, version: Version, index: number) {
  const { item } = view, id = `${item.key}-${index}`;
  const current = index === currentIndex(item), same = !current && version.hash === item.hash;
  const read = view.reading?.index === index ? view.reading.text : undefined;
  const actions = h('span.version-actions', {},
    button({ variant: 'link', size: 'small', label: read === undefined ? 'Read' : 'Hide', id: `version-read-${id}`, name: `${read === undefined ? 'Read' : 'Hide'} the version ${sourceWords(version.from)}, ${dayAndTime(version.at)}`, onclick: () => view.onRead(index) }),
    current || same ? null : Object.assign(button({ variant: 'link', size: 'small', label: 'Make current', id: `version-current-${id}`, disabled: !view.canWrite, onclick: () => view.onMakeCurrent(version) }),
      { title: `Make this the current version of ${item.name}${item.on ? ', in every harness it is on in' : ''}. Undo makes today’s current again.` }));
  return h(`li.version-row${current ? '.version-row-current' : ''}`, { 'data-version': version.hash },
    h('span.version-when', { title: new Date(version.at).toLocaleString() }, dayAndTime(version.at)),
    h('span.version-from', {}, sourceWords(version.from), current ? h('span.version-current', {}, icon('check', 12), 'Current') : same ? h('span.version-same', {}, 'same as current') : null),
    actions,
    read === undefined ? null : h('div.version-text', { id: `version-text-${id}` }, read === 'reading' ? 'Reading…' : read === null ? 'This version is no longer in Central Knot’s store.'
      : [read.description ? h('p.version-text-about', {}, read.description) : null, h('pre.version-text-prompt', {}, read.prompt)]));
}

export function versionList(view: VersionListView): HTMLElement {
  const { item } = view, all = item.versions;
  const shown = view.unfolded ? all : all.slice(0, FOLDED_VERSIONS);
  const rest = all.length - shown.length;
  return h('div.versions', { role: 'group', 'aria-label': `Versions of ${item.name}` },
    h('p.versions-title', {}, h('strong', {}, 'Versions'), h('span.versions-count', {}, String(all.length)),
      h('span.versions-note', {}, 'Central Knot keeps every version until the agent is deleted.')),
    h('ul.version-rows', {}, shown.map((version, index) => versionRow(view, version, index))),
    rest > 0 ? button({ variant: 'link', size: 'small', label: `Show ${rest} earlier ${rest === 1 ? 'version' : 'versions'}`, id: `versions-all-${item.key}`, onclick: view.onUnfold }) : null);
}
