// A tool's Manage switch, on its card on the Harnesses list, and what both it and History's Manage entries (historypage.ts
// managingRow) share: the switch (with one Managed (?) card on the first managed tool); the question before a tool left out is
// managed again (askManage, manageQuestion, joiningWords; a card's single named item opens Central Knot's version under its
// card's row via manageCardFile and filepanel.ts); the click (manageTool); and the band after a click (doneWords). The engine
// is toolchoice.ts: chooseTools turns it, and what turning a left-out tool on would do there is its whatJoiningDoes, read for
// the question (main.ts `tools:joining`, a look and no pass) and again for the click, which turns nothing and asks again where
// that changed. The band says what the pass after the click did (main.ts `tools:manage`, `did`). Cards are harnesspage.ts's.
import { acting, busy, clickResumes, focusWhenDone, putHistory, rerender, setHome, state, tell } from './app.ts';
import { button, h, infoMark, toggle, type Child } from './dom.ts';
import { itemFile, pagePlace, placePanel } from './filepanel.ts';
import { plural } from './model.ts';
import { pageOfPart } from './pluginstatus.ts';
import type { DestinationResult, HarnessId, HomeView, JoinCounts, JoinItem } from './types.ts';
import { andList, kindNames, toolNames as names } from './words.ts';

/**
 * Why no switch can be turned in this home, if so: preview only, or its record stops every write. Said
 * once, in the list's note (harnesspage.ts), and as each disabled switch's tooltip.
 */
export function manageLocked(home: HomeView): string | undefined {
  if (!home.sync.access.allowed) return 'Preview only: nothing is written here, so which tools are managed can’t change.';
  const gate = home.sync.gate;
  if (gate.state === 'stopped') return gate.reason;
  return undefined;
}

/**
 * The switch and its status for an installed tool's card: Managed (with one `(?)` card on the first managed card) or Not
 * managed (with its own `(?)` card explaining why no rows show and that the switch asks first, in the card via askManage).
 * Every switch keeps its tool-named accessible label even when locked; the lock's reason comes from toggle's whyOff (title
 * and aria-description), with no card or question.
 */
export function manageRow(home: HomeView, tool: HarnessId, showInfo = false, fileMark?: HTMLElement): HTMLElement {
  const on = home.sync.managed.includes(tool), why = manageLocked(home), name = names[tool];
  const label = on ? `Manage ${name}: on. Click to leave ${name} out: Central Knot then writes nothing there until you turn it on again. Its copies stay, and every item stays as it is.`
    : `Manage ${name}: off. ${leftOutInfo(name)}`;
  const mark = why ? null : on ? (showInfo ? infoMark('manage-info', 'Managed', MANAGE_INFO) : null)
    : infoMark(`manage-${tool}-info`, `${name} left out`, leftOutInfo(name));
  return h('div.harness-manage', {},
    h('span.harness-manage-head', mark ? { 'data-info-block': true } : {},
      toggle({ on, label, id: `manage-${tool}`, disabled: why ?? acting(), onchange: next => void (next ? askManage(tool, CARD) : manageTool(tool, false, home.home)) }),
      h('span.harness-manage-label', {}, on ? 'Managed' : 'Not managed'),
      mark),
    on ? null : manageQuestion(home, tool, CARD, fileMark));
}

/** Said behind Managed (?) on the first managed card. */
const MANAGE_INFO = 'Turning a tool off keeps its copies. Central Knot stops writing to it until you turn it on again.';
/** Said behind Not managed (?) and on its switch hover for a left-out tool: why no rows are shown, that copies stay, and that the switch asks first. */
const leftOutInfo = (name: string) =>
  `Central Knot doesn’t read or write ${name} while it’s left out, so its copies and every item stay as they are. Its switch asks before managing it again.`;
/** With Automatic sync off, what brings a tool turned on into line (a click's pass is about its own item: librarypass.ts PassOptions only). */
const SYNC_OFF = 'With Automatic sync off, Sync once brings it into line; a click on an item brings that item.';
/** In a home that waits for Resume, what a Manage click also does (its question and History's Leave <tool> out again say it). */
export const resumeWords = (home: HomeView) => (home.sync.gate.state === 'needs-resume' ? ` ${home.sync.gate.reason} This click resumes sync.` : '');

/** Where a question is asked: a tool's Harnesses card; anything else is the id of the History entry it was asked on. */
const CARD = 'card';
/** What main read for a question (DesktopApi whatJoiningDoes): what managing the tool does there and whether plugins follow. */
type Forecast = { counts: JoinCounts; plugins: boolean };
type Question = { tool: HarnessId; home: string; at: string; read?: Forecast | { failed: string }; changed?: true };
/**
 * The one Manage question open: for `tool` in `home`, asked `at` its card or a History entry, with what main read (`read`,
 * absent while it reads), `changed` once a click found that differed. Page-local: cleared on leaving the page or the home
 * (app.ts) and by any Manage click.
 */
let question: Question | undefined;
export const forgetManageQuestion = () => { question = undefined; };
/** Harnesses as a file panel's place (filepanel.ts pagePlace), called on every Harnesses draw so placePanel forgets closed marks. */
const manageFiles = pagePlace('harnesses');
export function manageCardFile(home?: HomeView): { tool?: HarnessId; mark?: HTMLElement; panel?: HTMLElement } {
  const one = home && question?.at === CARD && question.home === home.home && !manageLocked(home) && home.sync.present.includes(question.tool)
    && !home.sync.managed.includes(question.tool) && question.read && 'counts' in question.read ? namedItem(question.read.counts) : undefined;
  const mark = one ? itemFile(manageFiles, pageOfPart[one.kind], one.key) : undefined;
  const file = placePanel(manageFiles, [mark]);
  return mark ? { tool: question!.tool, mark: mark.mark, panel: file && file.mark === mark ? file.panel : undefined } : {};
}
/** A part of a question by id (on a card `manage-<tool>-<part>`, on History `history-manage-<part>-<entry>`), and what opened it. */
const partId = (open: Question, part: 'text' | 'cancel' | 'confirm' | 'close' | 'retry') => (open.at === CARD ? `manage-${open.tool}-${part}` : `history-manage-${part}-${open.at}`);
const openerId = (open: Question) => (open.at === CARD ? `manage-${open.tool}` : `history-${open.at}`);
/** Draws `open` as the question, its Cancel focused (Close, where the read failed). */
const show = (open: Question) => {
  question = open;
  rerender();
  document.getElementById(partId(open, open.read && 'failed' in open.read ? 'close' : 'cancel'))?.focus();
};

/**
 * Asks before `tool` is managed again, `at` its card or a History entry: the question opens at once, saying it reads, then says
 * what managing it does there as main reads it now, nothing saved or fetched for it. No answer is no forecast: it says so, and
 * offers no Manage.
 */
export async function askManage(tool: HarnessId, at: string) {
  const home = state.home;
  if (!home || manageLocked(home)) return;
  const open: Question = { tool, home: home.home, at };
  show(open);
  const read = await window.centralKnot.whatJoiningDoes(tool, home.home).catch(() => null);
  if (question !== open) return;
  show({ ...open, read: read ?? { failed: `Couldn’t read what managing ${names[tool]} would do. Nothing was changed.` } });
}

/** Cancel or Close, or Escape while one is open: the question closes, and the focus goes back to what opened it. */
function closeQuestion() {
  const open = question;
  if (!open) return;
  question = undefined;
  rerender();
  document.getElementById(openerId(open))?.focus();
}
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !question || (state.page === 'harnesses' && manageFiles.view.openFile)) return;
    event.preventDefault();
    closeQuestion();
  });
}

/**
 * The open question's band where it was asked (`at`), while `tool` is still left out in `home` and its switch can turn; else
 * nothing. On History it names the tool first (a card is the tool's own); a read that failed offers Close and Try again.
 */
export function manageQuestion(home: HomeView, tool: HarnessId, at: string, fileMark?: HTMLElement): HTMLElement | null {
  const open = question, read = open?.read, name = names[tool];
  if (!open || open.tool !== tool || open.at !== at || open.home !== home.home || manageLocked(home) || home.sync.managed.includes(tool)) return null;
  const failed = read && 'failed' in read ? read.failed : undefined;
  const text = !read ? `Reading ${name}…` : 'failed' in read ? read.failed : joiningWords(home, tool, read, at !== CARD, fileMark);
  const act = (part: 'cancel' | 'close' | 'retry' | 'confirm', label: string, onclick: () => void) =>
    button({ variant: part === 'confirm' ? 'primary' : 'outline', size: 'small', label, id: partId(open, part), disabled: part === 'confirm' && acting(), onclick });
  return h('div.band.manage-question', { role: 'group', 'aria-labelledby': partId(open, 'text') },
    h('span.band-text', { id: partId(open, 'text') }, open.changed ? h('strong.manage-question-changed', {}, 'Changed since this was read; nothing was written. ') : null,
      at === CARD || !read || failed ? null : h('strong', {}, `Managing ${name}: `), text),
    h('span.manage-question-actions', {}, failed ? [act('close', 'Close', closeQuestion), act('retry', 'Try again', () => void askManage(tool, at))]
      : [act('cancel', 'Cancel', closeQuestion), read && 'counts' in read ? act('confirm', `Manage ${name}`, () => void manageTool(tool, true, open.home, { read, at })) : null]));
}

function namedItem(counts: JoinCounts): JoinItem | undefined {
  const acts = counts.changing.filter(item => item.does !== 'take');
  return acts.length === 1 && acts[0]!.saves <= 1 ? acts[0] : undefined;
}
/**
 * What managing `tool` again does there, as its question says (types.ts JoinCounts, read when asked), in the order it happens:
 * the one item it changes by name, or each kind of change counted (copies saved, then written, then removed); what it takes in
 * and leaves as the tool's own; a kind it can't tell, as unknown, never as no change; the plugins it gets; Sync once with
 * Automatic sync off; and the Resume the click makes. `onHistory`: asked on History, where a saved copy can be restored.
 */
function joiningWords(home: HomeView, tool: HarnessId, { counts, plugins }: Forecast, onHistory: boolean, mark?: HTMLElement): Child[] {
  const n = names[tool], { written, kept, removed, found, takenIn, unread } = counts;
  const restore = (them: boolean) => (onHistory ? `${them ? 'they' : 'it'} can be restored here` : `History can restore ${them ? 'them' : 'it'}`);
  const one = namedItem(counts), any = !!(one || kept || written || removed);
  const rest = [
    !one && kept ? `Saves ${kept} of ${n}’s copies as ${kept === 1 ? 'a version' : 'versions'} (${restore(kept > 1)}).` : '',
    !one && written ? `Writes Central Knot’s version of ${plural(written, 'item')} in ${n}.` : '',
    !one && removed ? `Removes ${n}’s ${removed === 1 ? 'copy of 1 item that is off' : `copies of ${removed} items that are off`}.` : '',
    any || unread.length ? '' : `Changes no item in ${n}.`,
    takenIn ? `Takes ${takenIn} of ${n}’s items into the Library (Synchronize everything is on).` : '',
    // "Other" only after an item named or counted before it.
    found ? `${found}${any || takenIn ? ' other' : ''} ${found === 1 ? 'item stays' : 'items stay'} ${n}’s own: ${found === 1 ? 'it' : 'they'} will show under Found in the Library.` : '',
    unread.length ? `${n}’s ${andList(unread.map(kind => kindNames[pageOfPart[kind]]))} couldn’t be read, so what it does to them isn’t known.` : '',
    plugins ? `${n} also gets each plugin that is on and not kept out of it.` : '', home.syncOn ? '' : SYNC_OFF,
  ].filter(Boolean).join(' ');
  return [...(one ? oneChange(n, one, restore(false), mark) : []), `${one && rest ? ' ' : ''}${rest}${resumeWords(home)}`];
}
/** What it does to the one item it changes in tool `n`, by the name its plan gave (JoinCounts changing), one copy saved at most. */
function oneChange(n: string, { name, does, saves }: JoinItem, restore: string, mark?: HTMLElement): Child[] {
  const save: Child[] = [`Saves ${n}’s copy of ${name}`, mark ?? null, ` as a version (${restore})`];
  if (does === 'write') return saves ? [...save, `, then replaces it in ${n} with Central Knot’s version.`] : [`Writes Central Knot’s ${name}`, mark ?? null, ` in ${n}.`];
  if (does === 'remove') return saves ? [...save, `, then removes it: ${name} is off.`] : [`Removes ${name}`, mark ?? null, ` from ${n}: it is off.`];
  return [...save, '.'];
}

/**
 * The Manage click, shared by Harnesses and History: chooseTools in main's queue, then the home (and History, when open) read
 * again, with the result shown on the page clicked. `asked`: for On, what its question showed and where. Where main counts
 * otherwise now (or no question was asked), nothing is turned and the question asks there (its card if none) with main's counts.
 */
export const manageTool = (tool: HarnessId, on: boolean, expectedHome: string, asked?: { read: Forecast; at: string }) =>
  busy(on ? `Managing ${names[tool]}…` : `Leaving ${names[tool]} out…`, async page => {
  const home = state.home!;
  question = undefined;
  const done = await window.centralKnot.manageTool(tool, on, clickResumes(home), expectedHome, asked?.read.counts);
  if (done.changed) {
    question = { tool, home: expectedHome, at: asked?.at ?? CARD, read: { counts: done.changed, plugins: asked?.read.plugins ?? false }, changed: true };
    return focusWhenDone(partId(question, 'cancel'));
  }
  if (done.view) setHome(done.view, { reload: state.page !== 'history' });
  if (done.view && state.page === 'history') {
    await putHistory();
    const latest = [...(state.history.data ?? [])].reverse().find(event => event.kind === 'managing' && event.managing?.tool === tool);
    if (latest) focusWhenDone(done.view.sync.present.includes(tool) && done.view.sync.managed.includes(tool) === latest.managing?.on ? `history-${latest.id}` : `history-row-${latest.id}`);
  }
  if (done.stopped) return tell({ page, band: true, historyBand: true, warn: true, text: done.full ? done.stopped : `Nothing changed: ${done.stopped}` });
  const said = doneWords(tool, on, done.view?.syncOn ?? home.syncOn, done.did);
  tell({ page, band: true, historyBand: true, ...said, note: page === 'history' ? undefined : said.note });
});

const listed = (clauses: string[]) => (clauses.length < 2 ? clauses.join('') : `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}`);
/**
 * The band after a click: for On, what the pass did in the tool, from its results (`did`), not what its question counted before;
 * the one item it changed there by name, in its question's words.
 */
export function doneWords(tool: HarnessId, on: boolean, syncOn: boolean, did: readonly DestinationResult[]): { text: string; note?: string; warn?: boolean } {
  const name = names[tool];
  if (!on) return { text: `${name} is left out: Central Knot writes nothing there now. Its copies stay as they are, and every item stays as it is.` };
  if (!syncOn) return { text: `Central Knot manages ${name} now. ${SYNC_OFF}` };
  const count = (outcome: DestinationResult['outcome']) => did.filter(result => result.outcome === outcome).length;
  const written = count('written'), over = did.filter(result => result.outcome === 'written' && result.replaced).length;
  const removed = count('removed'), left = count('held') + count('failed');
  const one = written + removed === 1 && !left ? did.find(result => result.outcome === 'written' || result.outcome === 'removed') : undefined;
  if (one) return { text: `Central Knot manages ${name} now: ${one.outcome === 'removed' ? `${one.item}, which is off, is removed there.`
    : one.replaced ? `${name}’s copy of ${one.item} is saved as a version (History can restore it), and Central Knot’s is written over it.` : `Central Knot’s ${one.item} is written there.`}`, note: 'Each change there is in History.' };
  const clauses = [
    written ? `Central Knot’s version written there for ${plural(written, 'item')}${over ? ` (${over} over ${name}’s ${over === 1 ? 'copy, saved as a version: History can restore it' : 'copies, saved as versions: History can restore them'})` : ''}` : '',
    removed ? (removed === 1 ? '1 copy of an item that is off removed' : `${removed} copies of items that are off removed`) : '',
    left ? `${plural(left, 'item')} not changed there this time (its row says why)` : '',
  ].filter(Boolean);
  if (!clauses.length) return { text: `Central Knot manages ${name} now. No item there needed changing.` };
  return { text: `Central Knot manages ${name} now: ${listed(clauses)}.`, note: 'Each change there is in History.', warn: left > 0 };
}
