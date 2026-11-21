// First setup, on the page: the one question a home is asked once (synchronize everything, or not), and the walkthrough of the
// found items whose copies differ, one at a time. Nothing about either is stored: the answer is the home's Synchronize everything
// (everything.ts setSyncEverything; absent in the view until it is answered: types.ts SyncView syncEverything), and the
// walkthrough's place lives in this window until it is left. Whether the question is asked, what Yes would do, and which items
// wait for a choice are setupcounts.ts's, pure. The question, and the way back into the walkthrough, have one place: the top of
// the Overview (setupLead, first of what needs you: overview.ts needsYou). The walkthrough is one band at the top of the Library
// (walkthroughBand, drawn by matrix.ts listBands), bound to the item it is at by kind and key, holding that item's copy question
// as its row shows it (matrix.ts copyQuestion, which listBands hands it), the latest copy preselected (library.ts latestCopy, in
// the take-in answer); each step shows that item's row (matrix.ts showRow). Settings' Synchronize everything row
// counts as the question does and leads in too (settingspage.ts). What Yes does in the engine, and its one Undo in History, are
// everything.ts's.
import { acting, applyClick, busy, clickResumes, noToolManaged, rerender, setHome, showPage, state, syncNow, tell, whyReadOnly, withReloads, type PageKind } from './app.ts';
import { toItemKind, writtenReloads } from './reload.ts';
import { button, closeButton, h, icon } from './dom.ts';
import { rowClicks } from './libraryrow.ts';
import { plural, tookInCount } from './model.ts';
import { oneUndoCovers } from './historyactions.ts';
import { asksNow, KINDS, setupKinds, latestDone, waitingForChoice, walkId, walkPlace, wayBackIn, whatYesDoes, type Waiting } from './setupcounts.ts';
import type { Change, HomeView, PassResult } from './types.ts';
import { showRow } from './matrix.ts';
import { andList, kindNouns, rowNames, toolName } from './words.ts';


// ---------- The question ----------

/**
 * The Overview's one place for first setup: the question, in a home never asked (Resume first, in one that waits for it); after
 * it, while Synchronize everything is on and found items wait for a choice of copy, the way into the walkthrough. Nothing where no
 * tool is managed (the Overview points to Harnesses instead), or where the home can't be written or its record stops every write.
 */
export function setupLead(home: HomeView): HTMLElement | null {
  const asks = asksNow(home), { gate } = home.sync;
  if (asks === 'question') return question(home);
  if (asks === 'resume' && gate.state === 'needs-resume') return resumeFirst(gate.reason);
  if (noToolManaged() || whyReadOnly(home)) return null;
  const choosing = waitingForChoice(home).length;
  if (!home.sync.syncEverything || !choosing) return null;
  return h('p.overview-line', { id: 'setup-choosing' }, icon('diff', 14, 'tone-warning'),
    `${plural(choosing, 'found item')} ${choosing === 1 ? 'has' : 'have'} copies that differ and ${choosing === 1 ? 'waits' : 'wait'} for your choice. `,
    wayBackIn(waitingForChoice(home), walk.passed, walking()) === 'go-on' ? button({ variant: 'link', size: 'micro', label: 'Go on choosing', id: 'setup-choose', onclick: goOn })
      : button({ variant: 'link', size: 'micro', label: 'Choose copies', id: 'setup-choose', onclick: openWalkthrough }));
}

function question(home: HomeView) {
  const yes = whatYesDoes(home), ready = setupKinds(home);
  const stopped = KINDS.filter(kind => !ready.includes(kind) && home[kind].items.some(item => item.takeInAnswers)).map(kind => kindNouns[kind].many);
  const future = ready.length === KINDS.length ? 'what turns up later is taken in too' : 'new items are taken in when their kind’s record allows it';
  const waits = stopped.length ? `Found ${andList(stopped)} wait until their record can be used.` : '';
  // What Yes adds at once, then what waits for a choice (nothing is chosen for anyone), then what Yes leaves to a later step.
  const now = yes.takes ? `Yes takes in now the ${plural(yes.takes, 'item')} found in your tools that Central Knot doesn’t keep yet, and puts each in the tools that lack it${yes.to.length ? ` (${andList(yes.to.map(toolName))})` : ''}; ${future}.`
    : ready.length !== KINDS.length ? 'Yes takes in new items when their kind’s record allows it.'
    : 'Nothing found in your tools now is new to Central Knot; Yes takes in what turns up later.';
  const choosing = yes.choosing ? ` ${plural(yes.choosing, 'more item')} ${yes.choosing === 1 ? 'has' : 'have'} copies that differ and ${yes.choosing === 1 ? 'waits' : 'wait'} for you: nothing is chosen for you. You’re asked about each, one at a time, with the latest copy marked where one can be told, or you skip it and its copies stay as they are.` : '';
  const later = home.syncOn ? '' : ' Automatic sync is off, so nothing is added until you click Sync once.';
  const no = 'No changes nothing: what is already on stays on and keeps syncing, and each found item waits on its page for Add.';
  return h('section.setup-question', { id: 'setup-question', 'aria-labelledby': 'setup-question-title' },
    h('h2.setup-title', { id: 'setup-question-title' }, 'Synchronize everything?'),
    // One fact to a line, so the question reads at a glance: what Yes adds, what waits, the way back, Automatic sync.
    h('div.setup-text', {}, ...[now, waits, choosing, oneUndoCovers, later].map(line => line.trim()).filter(Boolean).map((line, at, lines) => h('p.setup-line', {}, at < lines.length - 1 ? `${line} ` : line))),
    h('p.setup-text', { id: 'setup-no-says' }, no),
    h('div.setup-actions', {},
      button({ variant: 'primary', label: 'Synchronize everything', id: 'setup-yes', disabled: acting(), onclick: () => void answer(true) }),
      button({ variant: 'outline', label: 'No, I’ll add items myself', id: 'setup-no', disabled: acting(), attrs: { title: no, 'aria-describedby': 'setup-no-says' }, onclick: () => void answer(false) })));
}

/** A home that waits for Resume: Resume comes first (any click resumes, as on the item lists), and the question after it. */
const resumeFirst = (reason: string) => h('p.overview-line', { id: 'setup-resume' }, icon('circle-alert', 14, 'tone-warning'), `${reason} `,
  button({ variant: 'link', size: 'micro', label: 'Resume', id: 'setup-resume-button', disabled: acting(), onclick: () => void applyClick({ kind: 'skills', changes: [], items: [], rows: [], said: 'Resumed: sync carries on from the record as it is.' }) }),
  ' Then Central Knot asks whether to synchronize everything.');

/** The answer, refused where the home was answered meanwhile (another window). Yes opens the walkthrough where an item waits. */
const answer = (on: boolean) => busy(on ? 'Turning on Synchronize everything…' : 'Leaving it off…', async () => {
  const set = await window.centralKnot.setSyncEverything(on, state.home!.home, true);
  if (set.view) setHome(set.view);
  const home = state.home!;
  if (set.stopped) { tell({ page: 'overview', band: true, warn: true, text: `Nothing changed. ${set.stopped}` }); return; }
  if (!on) { tell({ page: 'overview', band: true, text: 'Left off, and nothing changed: what is already on stays on and keeps syncing, and what Central Knot finds in your tools waits on its page for Add. Settings › This home can switch on Synchronize everything later.' }); return; }
  if (!home.syncOn) {
    tell({ page: 'overview', band: true, text: 'Synchronize everything is on. Automatic sync is off, so nothing is added until you click Sync once.',
      act: { label: 'Sync once', id: 'setup-sync-once', title: 'Take in what is found now; Automatic sync stays off', run: () => void syncNow().then(walkIfWaiting) } });
    return;
  }
  const taken = KINDS.flatMap(kind => home[kind].notices.flatMap(told => (told.kind === 'taken-in' ? told.items : [])));
  const waiting = waitingForChoice(home).length;
  tell(withReloads({ page: 'overview', band: true, carry: true, history: true, text: `Synchronize everything is on: it ${tookInCount(taken.length)}${waiting ? `, and ${plural(waiting, 'item')} with copies that differ ${waiting === 1 ? 'waits' : 'wait'} for your choice` : ''}. ${oneUndoCovers}` }, set.reloads));
  walkIfWaiting();
});
const walkIfWaiting = () => { if (state.home && waitingForChoice(state.home).length) openWalkthrough(); };

// ---------- The walkthrough ----------

/** The walkthrough's place, in this window only: the home it is open in, and the items passed (a copy chosen, or skipped). */
const walk = { home: undefined as string | undefined, passed: [] as string[] };
const walking = () => !!state.home && walk.home === state.home.home;

/** Where it is in the open home (setupcounts.ts walkPlace). */
const place = (home: HomeView) => walkPlace(waitingForChoice(home), walk.passed);
/** The item the walkthrough asks about now, if it is open: its row doesn't ask again (matrix.ts details). */
export const walkingAt = () => (state.home && walking() ? place(state.home).at : undefined);

/** Opens the walkthrough at its first item, its row shown in the Library (Yes, Settings' count, the Overview's line). */
export function openWalkthrough() {
  const home = state.home;
  if (!home) return;
  Object.assign(walk, { home: home.home, passed: [] });
  if (!place(home).at) { Object.assign(walk, { home: undefined }); tell({ page: state.page, text: 'No found item waits for a choice of copy now.' }); rerender(); return; }
  goOn();
}
/** To the item it is at: its row in the Library, open and in view; once none is left, the band says what still waits. */
const goOn = () => { const at = state.home && place(state.home).at; if (at) showRow(at.kind, at.key); else rerender(); };
/** Left at any moment: what is left stays found, each with its row's question. */
const leave = () => { Object.assign(walk, { home: undefined, passed: [] }); rerender(); };
/** Passes each of these that no longer waits (its copy chosen); one refused meanwhile (a copy changed since) is asked again. */
const passChosen = (items: Waiting[]) => {
  const still = new Set(waitingForChoice(state.home!).map(walkId));
  walk.passed.push(...items.map(walkId).filter(id => !still.has(id)));
  goOn();
};
const skip = (item: Waiting) => { walk.passed.push(walkId(item)); goOn(); };

/**
 * "Use the latest for the rest": for each item left with a latest copy, the click its question's main button sends (`use`, as
 * seen: `useHash`), each with its own History entry and Undo; those with no dates to go by are skipped, and said.
 */
const useLatest = (left: Waiting[]) => busy('Choosing the latest copies…', async page => {
  const home = state.home!, dated = left.filter(item => item.latest), undated = left.filter(item => !item.latest);
  const send = { skills: window.centralKnot.applySkills, mcp: window.centralKnot.applyServers, agents: window.centralKnot.applyAgents };
  const sent: { kind: PageKind; result: PassResult }[] = [];
  for (const kind of KINDS) {
    const changes: Change[] = dated.filter(item => item.kind === kind).map(item => rowClicks.on({ key: item.key, hashes: { [item.latest!.tool]: item.latest!.hash } }, undefined, item.latest!.tool));
    if (changes.length) sent.push({ kind, result: await send[kind](changes, clickResumes(home), home.home) });
  }
  setHome(await window.centralKnot.refresh());
  walk.passed.push(...undated.map(walkId));
  passChosen(dated);
  tell(withReloads({ page, band: true, history: true, ...latestDone(dated, undated, sent, waitingForChoice(state.home!)) }, sent.flatMap(({ kind, result }) => writtenReloads(result.results, toItemKind(kind)))));
});

/**
 * The walkthrough's band above a table of `kinds`: where it is, the item's copy question as its row asks it (`question`: matrix.ts
 * copyQuestion, which runs `then` once a choice's click is done; the latest copy's button the main one, "No dates to go by" where
 * there is none), Skip (which changes no copy), Use the latest for the rest, and leave. Above a table that doesn't list the
 * item's kind (a segment of another kind, a tool's tab), the way to its row; once none is left, what still waits.
 */
export function walkthroughBand(kinds: PageKind[], question: (kind: PageKind, key: string, then: () => void) => HTMLElement | null): HTMLElement | null {
  const home = state.home;
  if (!home || !walking()) return null;
  const { at, left, number, of } = place(home);
  const close = closeButton(leave, { id: 'walk-leave', label: 'Leave choosing copies', title: 'Leave: what is left stays found, each with its row’s question' });
  const head = (where: string) => h('span.walk-head', {}, icon('diff', 14, 'tone-warning'), h('strong', {}, 'Choosing copies'), h('span.walk-place', {}, ` · ${where}`));
  const band = (asking: boolean, ...children: (HTMLElement | string | null)[]) => h(`div.band.band-walk${asking ? '.walk-asking' : ''}`, { role: 'region', 'aria-label': 'Choosing copies', id: 'walkthrough' }, ...children);
  if (!at) return band(false, head('done'), h('span.band-text', {}, stillWaiting(home)), close);
  if (!kinds.includes(at.kind)) return band(false, head(`${number} of ${of}`), h('span.band-text', {}, `Next: ${at.name} (${kindNouns[at.kind].one}).`),
    button({ variant: 'outline', size: 'small', label: 'Go on', name: `Go on to ${at.name} in the Library`, id: 'walk-go-on', onclick: goOn }), close);
  const dated = left.filter(item => item.latest).length;
  const latestTitle = `For each of the ${plural(left.length, 'item')} left, use the copy changed last${dated < left.length ? `; ${left.length - dated} with no dates to go by ${left.length - dated === 1 ? 'is' : 'are'} skipped` : ''}. Each has its own Undo in History.`;
  const note = `${at.latest ? '' : 'No dates to go by: choose one, or skip it. '}Skip changes no copy.`;
  return band(true, h('div.walk-top', {}, head(`${number} of ${of}`), h('span.walk-note', { id: 'walk-note' }, note),
    h('span.band-actions', {},
      button({ variant: 'outline', size: 'small', label: 'Use the latest for the rest', id: 'walk-use-latest', disabled: !dated || acting(), attrs: { title: latestTitle }, onclick: () => void useLatest(left) }),
      button({ variant: 'outline', size: 'small', label: 'Skip', id: 'walk-skip', disabled: acting(), attrs: { title: `Leave ${at.name} found, its copies as they are`, 'aria-describedby': 'walk-note' }, onclick: () => skip(at) }),
      close)),
    question(at.kind, at.key, () => passChosen([at])));
}

/** Once none is left: which skipped items still wait for a choice (by name, with its kind where two kinds share it), or that none does. */
function stillWaiting(home: HomeView): string {
  const waiting = waitingForChoice(home);
  if (!waiting.length) return walk.passed.length ? 'Every item has a copy chosen.' : 'No found item waits for a choice of copy now.';
  return `${plural(waiting.length, 'skipped item')} still ${waiting.length === 1 ? 'waits' : 'wait'} for a choice, ${waiting.length === 1 ? 'its' : 'their'} copies as they are: ${andList(rowNames(waiting))}. Each row in the Library still asks.`;
}
