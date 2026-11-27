// A tool's Manage switch, on its card on the Harnesses list, and what both it and History's Manage entries (historypage.ts
// managingRow) share: the switch (with one Managed (?) card on the first managed tool); the question before a tool left out is
// managed again, read when it is asked (askManage) and shown where it was asked (manageQuestion, worded by joiningWords); the click
// (manageTool); and the band after a click (doneWords). The engine is toolchoice.ts: chooseTools turns it, and what turning a
// left-out tool on would do there is its whatJoiningDoes, which main reads for the question (main.ts `tools:joining`, a look
// and no pass) and again for the click, which turns nothing and asks again where that changed. The band says what the pass
// after the click did there, from its results (main.ts `tools:manage`, `did`). The cards themselves are harnesspage.ts's.
import { acting, busy, clickResumes, focusWhenDone, putHistory, rerender, setHome, state, tell } from './app.ts';
import { button, h, infoMark, toggle } from './dom.ts';
import { plural } from './model.ts';
import { loadPlugins, market } from './pluginstate.ts';
import { pageOfPart } from './pluginstatus.ts';
import { wantedIn } from './library.ts';
import { pluginUpdates } from './pluginupdateview.ts';
import type { DestinationResult, HarnessId, HomeView, JoinCounts } from './types.ts';
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
 * managed, whose switch asks first, in the card (askManage). Every switch keeps its tool-named accessible label even when
 * locked; the lock's reason comes from toggle's whyOff (title and aria-description), with no card or question.
 */
export function manageRow(home: HomeView, tool: HarnessId, showInfo = false): HTMLElement {
  const on = home.sync.managed.includes(tool), why = manageLocked(home), name = names[tool];
  const label = on ? `Manage ${name}: on. Click to leave ${name} out: Central Knot then writes nothing there until you turn it on again. Its copies stay, and every item stays as it is.`
    : `Manage ${name}: off. Click to see what managing it does there, then confirm.`;
  const mark = on && !why && showInfo ? infoMark('manage-info', 'Managed', MANAGE_INFO) : null;
  return h('div.harness-manage', {},
    h('span.harness-manage-head', mark ? { 'data-info-block': true } : {},
      toggle({ on, label, id: `manage-${tool}`, disabled: why ?? acting(), onchange: next => void (next ? askManage(tool, CARD) : manageTool(tool, false, home.home)) }),
      h('span.harness-manage-label', {}, on ? 'Managed' : 'Not managed'),
      mark),
    on ? null : manageQuestion(home, tool, CARD));
}

/** Said behind Managed (?) on the first managed card. */
const MANAGE_INFO = 'Turning a tool off keeps its copies. Central Knot stops writing to it until you turn it on again.';
/** With Automatic sync off, what brings a tool turned on into line (a click's pass is about its own item: librarypass.ts PassOptions only). */
const SYNC_OFF = 'With Automatic sync off, Sync once brings it into line; a click on an item brings that item.';
/** In a home that waits for Resume, what a Manage click also does (its question and History's Leave it out again say it). */
export const resumeWords = (home: HomeView) => (home.sync.gate.state === 'needs-resume' ? ` ${home.sync.gate.reason} This click resumes sync.` : '');

/** Where a question is asked: a tool's Harnesses card; anything else is the id of the History entry it was asked on. */
const CARD = 'card';
type Question = { tool: HarnessId; home: string; at: string; read?: { counts: JoinCounts } | { failed: string }; changed?: true };
/**
 * The one Manage question open: for `tool` in `home`, asked `at` its card or a History entry, with what main read (`read`,
 * absent while it reads), `changed` once a click found that differed. Page-local: cleared on leaving the page or the home
 * (app.ts) and by any Manage click.
 */
let question: Question | undefined;
export const forgetManageQuestion = () => { question = undefined; };
/** A part of a question by id (on a card `manage-<tool>-<part>`, on History `history-manage-<part>-<entry>`), and what opened it. */
const partId = (open: Question, part: 'text' | 'cancel' | 'confirm') => (open.at === CARD ? `manage-${open.tool}-${part}` : `history-manage-${part}-${open.at}`);
const openerId = (open: Question) => (open.at === CARD ? `manage-${open.tool}` : `history-${open.at}`);
/** Draws `open` as the question, its Cancel focused. */
const show = (open: Question) => { question = open; rerender(); document.getElementById(partId(open, 'cancel'))?.focus(); };

/**
 * Asks before `tool` is managed again, `at` its card or a History entry: the question opens at once, saying it reads, then says
 * what managing it does there as main reads it now, with the marketplaces read for the plugins it would get. No answer is no
 * forecast: it says so, and offers no Manage.
 */
export async function askManage(tool: HarnessId, at: string) {
  const home = state.home;
  if (!home || manageLocked(home)) return;
  const open: Question = { tool, home: home.home, at };
  show(open);
  const read = await window.centralKnot.whatJoiningDoes(tool, home.home).catch(() => null);
  await loadPlugins(false, home.readId);
  if (question !== open) return;
  show({ ...open, read: read ?? { failed: `Couldn’t read what managing ${names[tool]} would do. Nothing was changed.` } });
}

/** Cancel, or Escape while one is open: the question closes, and the focus goes back to what opened it. */
function closeQuestion() {
  const open = question;
  if (!open) return;
  question = undefined;
  rerender();
  document.getElementById(openerId(open))?.focus();
}
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !question) return;
    event.preventDefault();
    closeQuestion();
  });
}

/** The open question's band where it was asked (`at`), while `tool` is still left out in `home` and its switch can turn; else nothing. */
export function manageQuestion(home: HomeView, tool: HarnessId, at: string): HTMLElement | null {
  const open = question, read = open?.read;
  if (!open || open.tool !== tool || open.at !== at || open.home !== home.home || manageLocked(home) || home.sync.managed.includes(tool)) return null;
  const text = !read ? `Reading ${names[tool]}…` : 'failed' in read ? read.failed : joiningWords(home, tool, read.counts);
  return h('div.band.manage-question', { role: 'group', 'aria-labelledby': partId(open, 'text') },
    h('span.band-text', { id: partId(open, 'text') }, open.changed ? h('strong', {}, 'Changed since it was read. ') : null, text),
    h('span.manage-question-actions', {},
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: partId(open, 'cancel'), onclick: closeQuestion }),
      read && 'counts' in read ? button({ variant: 'primary', size: 'small', label: `Manage ${names[tool]}`, id: partId(open, 'confirm'),
        disabled: acting(), onclick: () => void manageTool(tool, true, open.home, { counts: read.counts, at }) }) : null));
}

/**
 * What managing `tool` again does there, as its question says (types.ts JoinCounts, read when asked): the one item it changes
 * by name, or what is kept before what is written; a kind it can't tell is unknown, never no change; then the plugins it gets,
 * Sync once with Automatic sync off, and the Resume the click makes.
 */
function joiningWords(home: HomeView, tool: HarnessId, counts: JoinCounts): string {
  const { written, kept, removed, found, takenIn, changing, unread } = counts;
  const changes = changing.length === 1 && kept <= 1 ? [oneChange(changing[0]!, counts)] : [
    kept ? `saves ${plural(kept, 'copy there that differs', 'copies there that differ')} as ${kept === 1 ? 'a version' : 'versions'}` : '',
    written ? `writes Central Knot’s version of ${plural(written, 'item')} there` : '',
    removed ? (removed === 1 ? 'removes 1 copy of an item that is off' : `removes ${removed} copies of items that are off`) : '',
  ].filter(Boolean);
  const besides = [takenIn ? `takes in ${takenIn} of its items by Synchronize everything` : '', found ? `shows ${found} of its items under Found in the Library` : ''].filter(Boolean);
  const unknown = unread.length ? `its ${andList(unread.map(kind => kindNames[pageOfPart[kind]]))} couldn’t be read, so what it does to them isn’t known` : '';
  const said = [changes.length || unknown ? listed(changes) : 'changes no item there', listed(besides), unknown].filter(Boolean).join('; ');
  // A tool managed again gets each plugin that is on and not kept out of it, while the automatic updates run by themselves
  // (pluginrecord.ts, pluginupdates.ts): said only where such a plugin is listed, as the marketplaces were read for the question.
  const bring = !!market.view?.marketplaces.some(entry => Object.values(entry.switches ?? {}).some(sw => !!sw.entry && wantedIn(sw.entry, tool)));
  const auto = pluginUpdates.view?.on && !pluginUpdates.view.paused;
  const also = bring && auto ? ' It also gets each plugin that is on and not kept out of it.' : '';
  return `Managing ${names[tool]}: ${said}.${also}${home.syncOn ? '' : ` ${SYNC_OFF}`}${resumeWords(home)}`;
}
const listed = (clauses: string[]) => (clauses.length < 2 ? clauses.join('') : `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}`);
/** What it does to the one item it changes there, by the name its plan gave (JoinCounts changing), with one copy saved at most. */
function oneChange(name: string, { written, kept, removed }: JoinCounts) {
  const saving = kept ? `, saving the copy${written ? ' there' : ''} as a version first` : '';
  if (written) return `writes Central Knot’s version of ${name} there${saving}`;
  if (removed) return `removes ${name} there, which is off${saving}`;
  return `saves the copy of ${name} there as a version`;
}

/**
 * The Manage click, shared by Harnesses and History: chooseTools in main's queue, then the home (and History, when open) read
 * again, with the result shown on the page clicked. `asked`: for On, what its question showed and where; where main counts
 * otherwise now, nothing is turned and the question asks again there with main's counts.
 */
export const manageTool = (tool: HarnessId, on: boolean, expectedHome: string, asked?: { counts: JoinCounts; at: string }) =>
  busy(on ? `Managing ${names[tool]}…` : `Leaving ${names[tool]} out…`, async page => {
  const home = state.home!;
  question = undefined;
  const done = await window.centralKnot.manageTool(tool, on, clickResumes(home), expectedHome, asked?.counts);
  if (done.changed && asked) {
    question = { tool, home: expectedHome, at: asked.at, read: { counts: done.changed }, changed: true };
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

/** The band after a click: for On, what the pass did in the tool, from its results (`did`), not what its question counted before. */
export function doneWords(tool: HarnessId, on: boolean, syncOn: boolean, did: readonly DestinationResult[]): { text: string; note?: string; warn?: boolean } {
  const name = names[tool];
  if (!on) return { text: `${name} is left out: Central Knot writes nothing there now. Its copies stay as they are, and every item stays as it is.` };
  if (!syncOn) return { text: `Central Knot manages ${name} now. ${SYNC_OFF}` };
  const count = (outcome: DestinationResult['outcome']) => did.filter(result => result.outcome === outcome).length;
  const written = count('written'), over = did.filter(result => result.outcome === 'written' && result.replaced).length;
  const removed = count('removed'), left = count('held') + count('failed');
  const clauses = [
    written ? `Central Knot’s version written there for ${plural(written, 'item')}${over ? ` (${over === written ? (over === 1 ? 'over its copy' : 'over their copies') : `${over} over a copy`} there, which a version keeps)` : ''}` : '',
    removed ? (removed === 1 ? '1 copy of an item that is off removed' : `${removed} copies of items that are off removed`) : '',
    left ? `${plural(left, 'item')} not changed there this time (its row says why)` : '',
  ].filter(Boolean);
  if (!clauses.length) return { text: `Central Knot manages ${name} now. No item there needed changing.` };
  return { text: `Central Knot manages ${name} now: ${listed(clauses)}.`, note: 'Each change there is in History.', warn: left > 0 };
}
