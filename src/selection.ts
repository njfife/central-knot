// Select on the Library (the owner, 2026-11-24: "selecting a whole bunch of skills and deleting them"): the one place that keeps
// the mode and its ticks, and says what a Delete of many would take and leave, in its words. Nothing is stored: it lives in the
// page while the window is open.
// - The mode (startSelecting, stopSelecting, selectingIn): begun by Select on the Library's list, in one home on one visit (app.ts
//   state.visit). Done, Escape, a Delete of many sent, the Files view, another page and another home end it, and its ticks go.
// - The ticks, by row id (itemrow.ts rowId): a row's (tickRow: with Shift, the run from the last row clicked, in the order on
//   screen) and a heading's (tickHeading, headingState). A tick stays while Find, a chip, From or the kind switch hides its row,
//   and shows again when the row comes back; only the rows listed are counted and acted on (ofListed).
// - A Delete of many: what it takes and leaves of the ticked rows listed (each row says why it can't be deleted, if it can't),
//   its question, kept with the rows it counted and closed once they change under it (ask, askedNow, cancelAsk, toggleWhy), and
//   its words (selectedWords, deleteLabel, questionWords, cantWords, whyLines, deletedWords).
// Pure: no DOM, nothing of matrix.ts, which draws it (selectControl, selectBar, tickOf, headingTick), gives it the rows it lists
// in their order on screen with why each can't be deleted (matrix.ts cantDelete, which the single Delete in an opened row asks
// too), and sends a Delete of many (matrix.ts deleteTicked → app.ts applyByKind).
import { groupBy, plural } from './model.ts';
import { andList, fewNames } from './words.ts';

/** A row the Library lists, as Select reads it: its row id, its name as the page says it, and why Delete can't take it, if it can't. */
export interface Listed { id: string; name: string; cant?: string }
/** What a Delete of many counted when its question was asked: the ids of the ticked rows listed it takes, and of those it leaves. */
interface Counted { takes: string[]; leaves: string[] }
interface Mode {
  /** The home it began in (types.ts HomeView home) and the visit (app.ts state.visit): in another, there is no mode. */
  home: string;
  visit: number;
  /** The rows ticked, by row id, listed now or not. */
  ticked: Set<string>;
  /** Where a Shift-click's run starts: the last row a click ticked or unticked. */
  from?: string;
  /** A Delete of many's question while it is asked: what it counted. */
  asked?: Counted;
  /** Whether the question's "N can't be deleted" shows its rows' names and reasons. */
  whyOpen: boolean;
}
let mode: Mode | undefined;

/** Select clicked: the mode, nothing ticked, in this home on this visit. */
export const startSelecting = (home: string, visit: number) => { mode = { home, visit, ticked: new Set(), whyOpen: false }; };
/** Done, Escape, a Delete of many sent, or the Files view: no mode, and its ticks go. */
export const stopSelecting = () => { mode = undefined; };
/** Whether the mode is on in this home on this visit; one begun in another home or on another visit ends here. */
export function selectingIn(home: string | undefined, visit: number): boolean {
  if (mode && (mode.home !== home || mode.visit !== visit)) mode = undefined;
  return !!mode;
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

/** Of the rows listed, in their order: those ticked, which the bar counts, and of them what a Delete of many takes and what it leaves. */
export function ofListed(listed: Listed[]) {
  const ticked = listed.filter(row => isTicked(row.id));
  return { ticked, takes: ticked.filter(row => !row.cant), leaves: ticked.filter(row => row.cant) };
}
function counted(listed: Listed[]): Counted {
  const { takes, leaves } = ofListed(listed);
  return { takes: takes.map(row => row.id).sort(), leaves: leaves.map(row => row.id).sort() };
}
const sameCount = (one: Counted, other: Counted) => one.takes.join('\n') === other.takes.join('\n') && one.leaves.join('\n') === other.leaves.join('\n');

/** Delete… clicked: its question, about the ticked rows listed now, as counted now. */
export const ask = (listed: Listed[]) => { if (mode) Object.assign(mode, { asked: counted(listed), whyOpen: false }); };
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
/** "N can't be deleted" clicked: its rows' names and reasons shown, or hidden again. */
export const toggleWhy = () => { if (mode) mode.whyOpen = !mode.whyOpen; };
export const whyShown = () => !!mode?.whyOpen;

/** The bar's count: how many rows listed are ticked; none is a blank. */
export const selectedWords = (ticked: number) => (ticked ? `${ticked} selected` : '');
/** Delete…, with its own number only where it takes fewer than are ticked. */
export const deleteLabel = (takes: number, ticked: number) => (takes && takes < ticked ? `Delete ${takes}…` : 'Delete…');
/** The question: what goes, and how it comes back (`days`: History's, as Settings sets them). */
export const questionWords = (takes: number, days: number) => `Delete ${takes} from every tool and Central Knot? History can restore ${takes === 1 ? 'it' : 'them'} for ${days} days.`;
/** The link after the question that names the rows a Delete of many leaves. */
export const cantWords = (leaves: number) => `${leaves} can’t be deleted`;
/** Each reason a row can't be deleted, after the names of its rows: "clash: not in Central Knot". */
export const whyLines = (leaves: Listed[]) => [...groupBy(leaves, row => row.cant!)].map(([why, rows]) => `${andList(rows.map(row => row.name))}: ${why}`);
/** The result: the rows deleted (`names`, in the kinds' words: words.ts rowNouns), and how many ticked rows it left (`left`). */
export const deletedWords = (names: string[], nouns: { one: string; many: string }, left: number) =>
  `Deleted ${plural(names.length, nouns.one, nouns.many)}: ${fewNames(names)}.${left ? ` ${left} not deleted.` : ''}`;
/** After the result, where it offers no Undo: how what it deleted (`count`) comes back. */
export const restoreWords = (count: number) => `History can restore ${count === 1 ? 'it' : 'them'}.`;
