// Select on the Library (the owner, 2026-11-24: "selecting a whole bunch of skills and deleting them"): the one place that keeps
// the mode and its ticks, and says what Delete, Turn on and Turn off of many take, skip as already so, and leave, in their words.
// Nothing is stored: it lives in the page while the window is open.
// - The mode (startSelecting, stopSelecting, selecting): begun by Select on the Library's list; Done, Escape and a bulk action
//   sent end it (matrix.ts), another home where it changes (app.ts accept), and every draw of the page that doesn't draw the
//   Library's list (another page, the Files view, the held screen, an empty Library: afterPageDrawn); its ticks go with it.
// - The ticks, by the id matrix.ts selectId gives a row (its row id, a plugin's own row's apart): a row's (tickRow: with Shift,
//   the run from the last row clicked, in the order on screen) and a heading's (tickHeading, headingState). A tick stays while
//   Find, a chip, From or the kind switch hides its row, and shows again when the row comes back; only the rows listed are
//   counted and acted on (ofListed).
// - Bulk actions: ofListed splits the ticked rows listed into takes, already so, and leaves (with why); Delete's question is kept
//   with the rows it counted and closed once they change under it (ask, askedNow, cancelAsk, toggleWhy); and each action's words
//   (selectedWords, turnLabel, turnedWords, questionWords, cantWords, whyLines, deletedWords, restoreWords).
// Pure: no DOM, nothing of matrix.ts, which draws it (selectControl, selectBar, tickOf, headingTick), gives it the rows it lists
// in their order on screen with why each can't be deleted or turned (matrix.ts cantDelete, cantTurn, alreadyAs), and sends each
// action (matrix.ts deleteTicked, turnTicked → app.ts applyByKind).
import { groupBy, plural } from './model.ts';
import { andList, fewNames } from './words.ts';

/** A row the Library lists, as Select reads it: its id (matrix.ts selectId), its name as the page says it, why the action can't take it (`cant`), and whether it is already as asked (`already`). */
export interface Listed { id: string; name: string; cant?: string; already?: boolean }
/** What a Delete of many counted when its question was asked: the ids of the ticked rows listed it takes, and of those it leaves. */
interface Counted { takes: string[]; leaves: string[] }
interface Mode {
  /** The rows ticked, by id, listed now or not. */
  ticked: Set<string>;
  /** Where a Shift-click's run starts: the last row a click ticked or unticked. */
  from?: string;
  /** A Delete of many's question while it is asked: what it counted. */
  asked?: Counted;
  /** Whether "N can't be deleted" shows its rows' names and reasons, on the bar or the question. */
  whyOpen: boolean;
}
let mode: Mode | undefined;

/** Select clicked: the mode, nothing ticked. */
export const startSelecting = () => { mode = { ticked: new Set(), whyOpen: false }; };
/** Done, Escape, a bulk action sent, another home: no mode, and its ticks go. */
export const stopSelecting = () => { mode = undefined; };
export const selecting = () => !!mode;
/** Whether this draw of the page drew the Library's list (listDrawn, from matrix.ts drawTable), read and let go by afterPageDrawn. */
let listShown = false;
export const listDrawn = () => { listShown = true; };
/** After each draw of the page (renderer.ts renderWindow): a mode its draw didn't show ends, and the next draw starts unmarked. */
export function afterPageDrawn() {
  if (!listShown) mode = undefined;
  listShown = false;
}
export const isTicked = (id: string) => !!mode?.ticked.has(id);

/**
 * A click on a row in the mode, or on its tick: the row ticked, or unticked; with Shift (`run`), every row from the last one
 * clicked to this one ticked, in `order` (the rows listed, in their order on screen, across headings). Where the last one
 * clicked isn't listed now, a Shift-click is a click.
 */
export function tickRow(id: string, order: string[], run: boolean) {
  if (!mode) return;
  const from = run && mode.from ? order.indexOf(mode.from) : -1, to = order.indexOf(id);
  if (from >= 0 && to >= 0) for (const each of order.slice(Math.min(from, to), Math.max(from, to) + 1)) mode.ticked.add(each);
  else if (!mode.ticked.delete(id)) mode.ticked.add(id);
  mode.from = id;
}
/** A heading's tick as it reads (its aria-checked): every row under it (`ids`) ticked, some, or none. */
export function headingState(ids: string[]): 'true' | 'mixed' | 'false' {
  const ticked = ids.filter(isTicked).length;
  return !ticked ? 'false' : ticked === ids.length ? 'true' : 'mixed';
}
/** A heading's tick clicked: every row under it ticked, or, all of them ticked already, none. */
export function tickHeading(ids: string[]) {
  const all = headingState(ids) === 'true';
  for (const id of ids) if (all) mode?.ticked.delete(id); else mode?.ticked.add(id);
}

/** Of the rows listed, in their order: those ticked (counted by the bar), and of them what the action takes, skips as already so, and leaves with a reason. */
export function ofListed(listed: Listed[]) {
  const ticked = listed.filter(row => isTicked(row.id));
  const already = ticked.filter(row => row.already);
  const leaves = ticked.filter(row => !row.already && row.cant);
  return { ticked, takes: ticked.filter(row => !row.already && !row.cant), already, leaves };
}
function counted(listed: Listed[]): Counted {
  const { takes, leaves } = ofListed(listed);
  return { takes: takes.map(row => row.id).sort(), leaves: leaves.map(row => row.id).sort() };
}
const sameCount = (one: Counted, other: Counted) => one.takes.join('\n') === other.takes.join('\n') && one.leaves.join('\n') === other.leaves.join('\n');

/** Delete… clicked: its question, about the ticked rows listed now, as counted now. */
export const ask = (listed: Listed[]) => { if (mode) mode.asked = counted(listed); };
/**
 * Whether the question is asked about `listed` (the rows listed now). Once what it counted changed under it (a row listed or no
 * longer, a row that can be deleted now or no longer: a chip, From, the kind switch, a tick, a pass), it closes: he is never
 * asked about ten and has nine or eleven deleted.
 */
export function askedNow(listed: Listed[]): boolean {
  if (mode?.asked && !sameCount(mode.asked, counted(listed))) mode.asked = undefined;
  return !!mode?.asked;
}
/** Cancel, or Escape: the question closes, the ticks stay. Whether one was asked. */
export function cancelAsk(): boolean {
  const was = !!mode?.asked;
  if (mode) mode.asked = undefined;
  return was;
}
/** "N can't be deleted" clicked, on the bar or the question: its rows' names and reasons shown, or hidden again. */
export const toggleWhy = () => { if (mode) mode.whyOpen = !mode.whyOpen; };
export const whyShown = () => !!mode?.whyOpen;

/** The bar's count: how many rows listed are ticked; none is a blank. */
export const selectedWords = (ticked: number) => (ticked ? `${ticked} selected` : '');
/** The question: what goes, and how it comes back (`days`: History's, as Settings sets them). */
export const questionWords = (takes: number, days: number) => `Delete ${takes} from every tool and Central Knot? History can restore ${takes === 1 ? 'it' : 'them'} for ${days} days.`;
/** The link, on the bar and after the question, that names the rows a Delete of many leaves. */
export const cantWords = (leaves: number) => `${leaves} can’t be deleted`;
/** Each reason an action can't take a row, after the names of its rows: "clash: not in Central Knot". */
export const whyLines = (leaves: Listed[]) => [...groupBy(leaves, row => row.cant!)].map(([why, rows]) => `${andList(rows.map(row => row.name))}: ${why}`);
/** Reason a found row whose copies differ can't be turned on in bulk (shared by matrix.ts cantTurn and app.ts applyByKind). */
export const DIFFERS_REASON = 'its copies differ (its row asks which to use)';
/** A Turn button's label: its own count when it takes fewer than are ticked (`Turn off 3`), plain (`Turn off`) when it takes all or none. */
export const turnLabel = (on: boolean, takes: number, ticked: number) =>
  `Turn ${on ? 'on' : 'off'}${takes && takes < ticked ? ` ${takes}` : ''}`;
/** Counts of ticked rows already in the asked state or left with a reason, said on every Turn result path. */
export function turnTail(on: boolean, already: number, left: number): string {
  const state = on ? 'on' : 'off';
  return [already ? `${already} ${already === 1 ? 'was' : 'were'} already ${state}.` : '', left ? `${left} not turned ${state}.` : ''].filter(Boolean).join(' ');
}
/** The result of Turn on or Turn off of many: the rows changed, how many ticked rows were already so, how many it left, and any tools still reading them another way (`stayed`). */
export function turnedWords(on: boolean, names: string[], nouns: { one: string; many: string }, already: number, left: number, stayed: string[] = []): string {
  return [`Turned ${on ? 'on' : 'off'} ${plural(names.length, nouns.one, nouns.many)}: ${fewNames(names)}.`, turnTail(on, already, left), ...stayed].filter(Boolean).join(' ');
}
/** The result: the rows deleted (`names`, in the kinds' words: words.ts rowNouns), and how many ticked rows it left (`left`). */
export const deletedWords = (names: string[], nouns: { one: string; many: string }, left: number) =>
  `Deleted ${plural(names.length, nouns.one, nouns.many)}: ${fewNames(names)}.${left ? ` ${left} not deleted.` : ''}`;
/** After the result, where it offers no Undo: how what it deleted (`count`) comes back. */
export const restoreWords = (count: number) => `History can restore ${count === 1 ? 'it' : 'them'}.`;
