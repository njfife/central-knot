// The versions of one item, in its opened row: the current one first, then the others in the order Central Knot took them
// (library.ts listed), each with when it was made, where it came from and what it changed; a way to read each, which marks
// what differs from the current version; and Make current on every other. Central Knot keeps every version (library.ts),
// so a long list folds to its newest few with one line that shows the rest. Its words are agentrow.ts's.
// It draws what it is given and calls back on a click: matrix.ts keeps which list is unfolded and which version is being
// read, and sends Make current as the item's click.
import type { VersionChange } from './agentfiles.ts';
import { foldVersions, madeAt, madeFrom, versionChange, versionTimes } from './agentrow.ts';
import { wordDiff } from './diff.ts';
import { button, h, icon, type Child } from './dom.ts';
import { listed, sourceWords, type LibraryItem, type Version } from './library.ts';
import { dayAndTime } from './model.ts';

/** A version's content as read from the library: its text, `'reading'` while it is fetched, or null when it is no longer kept. */
export type VersionText = { description: string; prompt: string } | 'reading' | null;

export interface VersionListView {
  item: LibraryItem;
  canWrite: boolean;
  /** Whether the whole list shows (else its newest few: agentrow.ts foldVersions). */
  unfolded: boolean;
  /** What each listed version changed from the one taken before it (types.ts SkillFacts versionChanges). */
  changes?: VersionChange[];
  /** The version being read (its place in the list), its text, and the current version's, against which what differs is marked. */
  reading?: { index: number; text: VersionText; current: VersionText };
  now: number;
  onUnfold(): void;
  onRead(index: number): void;
  onMakeCurrent(version: Version): void;
}

function versionRow(view: VersionListView, version: Version, index: number, when: string) {
  const { item } = view, id = `${item.key}-${index}`;
  // The list starts with the current version (library.ts listed); an older entry with the same content says so.
  const current = index === 0 && version.hash === item.hash, same = !current && version.hash === item.hash;
  const read = view.reading?.index === index ? view.reading : undefined;
  const which = `the version ${sourceWords(version.from)}, ${dayAndTime(version.at)}`;
  const readLabel = read ? 'Hide' : current ? 'Read current' : 'Read';
  const readIt = button({ variant: 'link', size: 'small', label: readLabel, id: `version-read-${id}`, name: `${read ? 'Hide' : 'Read'} ${which}`, onclick: () => view.onRead(index) });
  const makeCurrent = current || same ? null
    : button({ variant: 'outline', size: 'micro', label: 'Make current', id: `version-current-${id}`, name: `Make ${which} current`, disabled: !view.canWrite,
      onclick: () => view.onMakeCurrent(version) });
  const everywhere = item.on ? ', in every tool it is on in' : '';
  if (makeCurrent) makeCurrent.title = `Make this the current version of ${item.name}${everywhere}. Undo makes today’s current again.`;
  const mark = current ? h('span.version-current', {}, icon('check', 12), 'Current') : same ? h('span.version-same', {}, 'same as current') : null;
  // A version made current again names the one it was made from.
  const source = version.from.how === 'made-current' ? madeFrom(item, version) : undefined;
  const note = versionChange(view.changes?.[index]);
  return h(`li.version-row${current ? '.version-row-current' : ''}`, { 'data-version': version.hash },
    h('span.version-when', { title: new Date(version.at).toLocaleString() }, when),
    h('span.version-from', {}, h('span', {}, sourceWords(version.from), source ? ` · from ${sourceWords(source.from)}, ${madeAt(source)}` : ''),
      note ? h('span.version-note', {}, note) : null, mark),
    h('span.version-actions', {}, readIt, makeCurrent),
    read ? h('div.version-read', { id: `version-read-text-${id}` }, versionText(read.text, current ? undefined : read.current)) : null);
}

/** `text` against `current`: its own words tinted as the copy question tints them, the current one's it lacks struck through. */
function againstCurrent(current: string, text: string): Child[] {
  // Spaces read as they are; a line break only the current version has is left out, so the lines are this version's.
  const space = (part: { kind: string; text: string }) => (part.kind === 'removed' ? (part.text.includes('\n') ? null : ' ') : part.text);
  return wordDiff(current, text).map(part => (part.kind === 'same' ? part.text : !part.text.trim() ? space(part)
    : h(part.kind === 'added' ? 'span.change-added' : 'span.change-gone', {}, part.text)));
}

/** A version being read: its description and prompt, with what differs from the current version marked; or what stands in for them. */
function versionText(read: VersionText, current: VersionText | undefined) {
  if (read === 'reading') return 'Reading…';
  if (read === null) return 'This version is no longer in Central Knot’s store.';
  const against = current && current !== 'reading' ? current : undefined;
  const words = (field: 'description' | 'prompt') => (against ? againstCurrent(against[field], read[field]) : [read[field]]);
  return [
    against ? h('p.version-read-legend', {}, 'Against the current version: tinted, only in this one; struck through, only in the current one.') : null,
    read.description ? h('p.version-read-about', {}, ...words('description')) : null,
    h('pre.version-read-prompt', {}, ...words('prompt'))];
}

export function versionList(view: VersionListView): HTMLElement {
  const { item } = view, all = listed(item);
  const { shown, rest } = foldVersions(all, view.unfolded);
  const times = versionTimes(shown, view.now);
  const more = `Show ${rest} earlier ${rest === 1 ? 'version' : 'versions'}`;
  const unfold = rest > 0 ? button({ variant: 'link', size: 'small', label: more, id: `versions-all-${item.key}`, onclick: view.onUnfold }) : null;
  return h('div.versions', { role: 'group', 'aria-label': `Versions of ${item.name}` },
    h('p.versions-title', {}, h('strong', {}, 'Versions'), h('span.versions-count', {}, String(all.length)),
      h('span.versions-note', {}, 'Central Knot keeps every version.')),
    h('ul.version-rows', {}, shown.map((version, index) => versionRow(view, version, index, times[index]))),
    unfold);
}
