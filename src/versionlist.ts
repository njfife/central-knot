// The versions of one item, in its opened row: the current one first, then the others in the order Central Knot took them,
// one row per content (library.ts listed), each with when it was made, where it came from and what it changed; a way to
// read each, which marks what differs from the current version; and Make current on every other. Central Knot keeps every
// version (library.ts), so a long list folds to its newest few with one line that shows the rest. Its words are libraryrow.ts's.
// It draws what it is given and calls back on a click: matrix.ts keeps which list is unfolded and which version is being
// read, gets a version's text as the kind gives it (matrix.ts libraryKinds), and sends Make current as the item's click.
import { foldVersions, madeFrom, versionChange, versionChangeHelp, versionSource } from './libraryrow.ts';
import { wordDiff, type Line } from './diff.ts';
import { button, h, icon, type Child } from './dom.ts';
import { listed, sourceWords, type LibraryItem, type Version, type VersionChange } from './library.ts';
import { dayAndTime, timesApart } from './model.ts';

/**
 * One part of a version's content as Read shows it, in the kind's order: a line (left out when empty) or, `block`, a block of
 * text. `name`: the kind's word for it ("prompt"), as "Differs from current in: …" says it.
 */
export interface VersionPart { name: string; text: string; block?: true }
/** A version's content as read from the library: its parts, `'reading'` while it is fetched, or null when it is no longer kept. */
export type VersionText = VersionPart[] | 'reading' | null;

export interface VersionListView {
  item: LibraryItem;
  canWrite: boolean;
  /** Whether the whole list shows (else its newest few: libraryrow.ts foldVersions). */
  unfolded: boolean;
  /** Each listed version's note (types.ts SkillFacts versionChanges). */
  changes?: VersionChange[];
  /** The version being read (its place in the list), its text, and the current version's, against which what differs is marked. */
  reading?: { index: number; text: VersionText; current: VersionText };
  now: number;
  onUnfold(): void;
  onRead(index: number): void;
  onMakeCurrent(version: Version): void;
}

function versionRow(view: VersionListView, version: Version, index: number, when: string, sourceWhen: (source: Version) => string) {
  const { item } = view, id = `${item.key}-${index}`;
  // The list starts with the current version (library.ts listed), and has each content once.
  const current = index === 0 && version.hash === item.hash;
  const read = view.reading?.index === index ? view.reading : undefined;
  const which = `the version ${sourceWords(version.from)}, ${dayAndTime(version.at)}`;
  const readLabel = read ? 'Hide' : current ? 'Read current' : 'Read';
  const readIt = button({ variant: 'link', size: 'small', label: readLabel, id: `version-read-${id}`, name: `${read ? 'Hide' : 'Read'} ${which}`, onclick: () => view.onRead(index) });
  const makeCurrent = current ? null
    : button({ variant: 'outline', size: 'micro', label: 'Make current', id: `version-current-${id}`, name: `Make ${which} current`, disabled: !view.canWrite,
      onclick: () => view.onMakeCurrent(version) });
  const everywhere = item.on ? ', in every tool it is on in' : '';
  if (makeCurrent) makeCurrent.title = `Make this the current version of ${item.name}${everywhere}. Undo makes today’s current again.`;
  const change = view.changes?.[index], note = versionChange(change);
  return h(`li.version-row${current ? '.version-row-current' : ''}`, { 'data-version': version.hash },
    h('span.version-when', { title: new Date(version.at).toLocaleString() }, when),
    h('span.version-from', {}, h('span', {}, versionSource(item, version, sourceWhen)),
      note ? h('span.version-note', { title: versionChangeHelp(change) }, note) : null, current ? h('span.version-current', {}, icon('check', 12), 'Current') : null),
    h('span.version-actions', {}, readIt, makeCurrent),
    read ? h('div.version-read', { id: `version-read-text-${id}` }, versionText(read.text, current ? undefined : read.current)) : null);
}

/**
 * `text` against `current`: its own words tinted as the copy question tints them, the current one's it lacks struck through.
 * Neighbouring marked words are one mark; a line break only the current version has is left out, so the lines are this one's.
 */
function againstCurrent(current: string, text: string): Child[] {
  const parts = wordDiff(current, text).filter(part => !(part.kind === 'removed' && part.text.includes('\n') && !part.text.trim()));
  const runs: Line[] = [];
  parts.forEach((part, index) => {
    const before = parts[index - 1]?.kind, after = parts[index + 1]?.kind;
    // A space joins the mark on both its sides; any other space reads plain, once.
    const kind = part.text.trim() ? part.kind : before === after && before !== 'same' ? before! : 'same';
    const last = runs.at(-1);
    if (last?.kind === 'removed' && kind === 'added') runs.push({ kind: 'same', text: ' ' });
    if (runs.at(-1)?.kind === kind) runs.at(-1)!.text += part.text;
    else runs.push({ kind, text: kind === 'same' && !part.text.trim() && part.kind === 'removed' ? ' ' : part.text });
  });
  return runs.map(run => (run.kind === 'same' ? run.text : h(run.kind === 'added' ? 'span.change-added' : 'span.change-gone', {}, run.text)));
}

/**
 * A version being read: its parts, headed by those that differ from the current version and with those differences marked;
 * or what stands in for them.
 */
function versionText(read: VersionText, current: VersionText | undefined) {
  if (read === 'reading') return 'Reading…';
  if (read === null) return 'This version is no longer in Central Knot’s store.';
  const against = current && current !== 'reading' ? current : undefined;
  const theirs = (part: VersionPart) => against?.find(other => other.name === part.name)?.text ?? '';
  const words = (part: VersionPart) => (against ? againstCurrent(theirs(part), part.text) : [part.text]);
  // Trailing white space aside, as the kind's note compares them (agents.ts changesOf).
  const differ = against ? read.filter(part => theirs(part).trimEnd() !== part.text.trimEnd()).map(part => part.name) : [];
  return [
    against ? h('p.version-read-legend', {}, h('strong', {}, differ.length ? `Differs from current in: ${differ.join(', ')}` : 'Same as current'),
      differ.length ? ' · tinted: only in this one; struck through: only in the current one' : '') : null,
    ...read.map(part => (part.block ? h('pre.version-read-block', {}, ...words(part)) : part.text ? h('p.version-read-line', {}, ...words(part)) : null))];
}

export function versionList(view: VersionListView): HTMLElement {
  const { item } = view, all = listed(item);
  const { shown, rest } = foldVersions(all, view.unfolded);
  // One form for every time the list says: each row's, and the one a version made current again went back to.
  const sources = shown.flatMap(version => (version.from.how === 'made-current' ? madeFrom(item, version) ?? [] : []));
  const said = timesApart([...shown, ...sources].map(version => version.at), view.now, true);
  const times = said.slice(0, shown.length), sourceWhen = (source: Version) => said[shown.length + sources.indexOf(source)];
  const more = `Show ${rest} earlier ${rest === 1 ? 'version' : 'versions'}`;
  const unfold = rest > 0 ? button({ variant: 'link', size: 'small', label: more, id: `versions-all-${item.key}`, onclick: view.onUnfold }) : null;
  return h('div.versions', { role: 'group', 'aria-label': `Versions of ${item.name}` },
    h('p.versions-title', {}, h('strong', {}, 'Versions'), h('span.versions-count', {}, String(all.length)),
      h('span.versions-note', {}, 'Central Knot keeps every version.')),
    h('ul.version-rows', {}, shown.map((version, index) => versionRow(view, version, index, times[index], sourceWhen))),
    unfold);
}
