// First setup, on the page: the one question a home is asked once (synchronize everything, or not), and the walkthrough of the
// found items whose copies differ, one at a time. Nothing about either is stored: the answer is the home's Synchronize everything
// (everything.ts setSyncEverything; absent in the view until it is answered: types.ts SyncView syncEverything), and the
// walkthrough's place lives in this window until it is left. Whether the question is asked, what Yes would do, and which items
// wait for a choice are setupcounts.ts's, pure. The question, and the way back into the walkthrough, have one place: the top of
// the Overview (setupLead, first of what needs you: overview.ts needsYou). The walkthrough is one band at the top of the Library
// (walkthroughBand, drawn by matrix.ts listBands), bound to the item it is at by kind and key, holding that item's copy question
// as its row shows it (matrix.ts copyQuestion, which listBands hands it), the latest copy preselected (library.ts latestCopy, in
// the take-in answer); each step shows that item's row (matrix.ts showRow). Both answers' results stay on the Overview: Yes's
// with the switch-on's Undo (app.ts everythingUndo, as Settings' switch offers it), No's with the way to switch it on there
// (app.ts switchSyncEverything). The found items whose copies differ are each kind's line under the question while it asks
// (overview.ts needsYou). Settings' Synchronize everything row counts as the question does and leads in too (settingspage.ts).
// What Yes does in the engine, and its one Undo, are everything.ts's.
import { acting, applyClick, busy, clickResumes, everythingUndo, noToolManaged, rerender, runSwitches, setHome, state, switchReasons, switchSyncEverything, syncNow, tell, tellWritten, whyReadOnly, type PageKind } from './app.ts';
import { pluginReloads, reloadsFor } from './reload.ts';
import { button, closeButton, h, icon, infoMark } from './dom.ts';
import { anyOn } from './itemrow.ts';
import { rowClicks } from './libraryrow.ts';
import { plural, tookInCount } from './model.ts';
import { oneUndoCovers } from './historyactions.ts';
import { asksNow, KINDS, setupKinds, latestDone, waitingForChoice, walkId, walkPlace, wayBackIn, whatYesDoes, type Waiting } from './setupcounts.ts';
import { turnEvery } from './pluginswitch.ts';
import type { Change, HomeView, PassResult } from './types.ts';
import { showRow, throughItemsFor } from './matrix.ts';
import { andList, kindNouns, rowNames } from './words.ts';


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

/** What the question's (?) says: where Yes puts each item, and what its one Undo covers (historyactions.ts oneUndoCovers). */
const YES_INFO = `Each item goes to the tools that lack it and can take it; ones whose copies differ wait for your choice. ${oneUndoCovers}`;

/**
 * The question, one line counted as the pass counts (setupcounts.ts whatYesDoes), and under it only what is true of this home: the
 * found kinds whose record stops them, and Automatic sync off. No's words are its hover; what is on is said to stay on only where
 * something is. The found items whose copies differ are said under it by each kind's line (overview.ts needsYou).
 */
function question(home: HomeView) {
  const { takes } = whatYesDoes(home), ready = setupKinds(home), { managed, present } = home.sync;
  const foundIn = KINDS.filter(kind => home[kind].items.some(item => item.takeInAnswers));
  const stopped = foundIn.filter(kind => !ready.includes(kind)).map(kind => kindNouns[kind].many);
  const tools = managed.length < present.length ? `the ${plural(managed.length, 'tool')} Central Knot manages` : 'every tool';
  const ask = takes ? `Add the ${plural(takes, 'item')} found in your tools to ${tools}, and new ones as they turn up?`
    : `${foundIn.length ? 'Nothing found is ready to add' : 'Nothing new in your tools now'}. Add new items to ${tools} as they turn up?`;
  const waits = stopped.length ? `Found ${andList(stopped)} wait until their record can be used.` : '';
  const later = home.syncOn ? '' : 'Automatic sync is off: nothing is added until Sync once.';
  const no = `Leaves it off: ${anyOn(home) ? 'what is on stays on, and ' : ''}each found item waits in the Library for Add.`;
  return h('section.setup-question', { id: 'setup-question', 'aria-labelledby': 'setup-question-title' },
    h('h2.setup-title', {}, h('span', { id: 'setup-question-title' }, ask), ' ', infoMark('setup-question-info', 'Synchronize everything', YES_INFO)),
    ...[waits, later].filter(Boolean).map(line => h('p.setup-text', {}, line)),
    h('div.setup-actions', {},
      button({ variant: 'primary', label: 'Synchronize everything', id: 'setup-yes', disabled: acting(), onclick: () => void answer(true) }),
      button({ variant: 'outline', label: 'No, I’ll add items myself', id: 'setup-no', disabled: acting(), attrs: { title: no, 'aria-description': no },
        onclick: () => void answer(false) })));
}

/** A home that waits for Resume: Resume comes first (any click resumes, as on the item lists), and the question after it. */
const resumeFirst = (reason: string) => h('p.overview-line', { id: 'setup-resume' }, icon('circle-alert', 14, 'tone-warning'), `${reason} `,
  button({ variant: 'link', size: 'micro', label: 'Resume', id: 'setup-resume-button', disabled: acting(), onclick: () => void applyClick({ kind: 'skills', changes: [], items: [], rows: [], said: 'Resumed: sync carries on from the record as it is.' }) }),
  ' Then Central Knot asks whether to synchronize everything.');

/**
 * The answer, refused where the home was answered meanwhile (another window). Its result stays on the Overview, where the line
 * under the question leads into any copies that wait (setupLead): Yes's with the switch-on's Undo (beside Sync once while Automatic
 * sync is off), No's with the way to switch the rule on there.
 */
const answer = (on: boolean) => busy(on ? 'Turning on Synchronize everything…' : 'Leaving it off…', async () => {
  const set = await window.centralKnot.setSyncEverything(on, state.home!.home, true);
  if (set.view) setHome(set.view);
  const home = state.home!;
  if (set.stopped) { tell({ page: 'overview', band: true, warn: true, text: `Nothing changed. ${set.stopped}` }); return; }
  if (!on) {
    tell({ page: 'overview', band: true, text: 'Left off.', act: { label: 'Turn on Synchronize everything', id: 'setup-turn-on', title: YES_INFO, run: () => void switchSyncEverything(true) } });
    return;
  }
  const undo = await everythingUndo(set.event, home.home);
  if (!home.syncOn) {
    tell({ page: 'overview', band: true, text: 'Synchronize everything is on. Automatic sync is off: nothing is added until Sync once.', next: undo,
      act: { label: 'Sync once', id: 'setup-sync-once', title: 'Take in what is found now; Automatic sync stays off', run: () => void syncNow() } });
    return;
  }
  const taken = KINDS.flatMap(kind => home[kind].notices.flatMap(told => (told.kind === 'taken-in' ? told.items : [])));
  tellWritten({ page: 'overview', band: true, text: `Synchronize everything is on: it ${tookInCount(taken.length)}.`, act: undo }, set.reloads);
});

// ---------- The walkthrough ----------

/** The walkthrough's place, in this window only: the home it is open in, and the items passed (a copy chosen, or skipped). */
const walk = { home: undefined as string | undefined, passed: [] as string[] };
const walking = () => !!state.home && walk.home === state.home.home;

/** Where it is in the open home (setupcounts.ts walkPlace). */
const place = (home: HomeView) => walkPlace(waitingForChoice(home), walk.passed);
/** The item the walkthrough asks about now, if it is open: its row doesn't ask again (matrix.ts details). */
export const walkingAt = () => (state.home && walking() ? place(state.home).at : undefined);

/** Opens the walkthrough at its first item, its row shown in the Library (the Overview's line, Settings' count). */
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
  const sent: { kind: PageKind; keys: Set<string>; result: PassResult }[] = [];
  for (const kind of KINDS) {
    const changes: Change[] = dated.filter(item => item.kind === kind).map(item => rowClicks.on({ key: item.key, hashes: { [item.latest!.tool]: item.latest!.hash } }, undefined, item.latest!.tool));
    if (changes.length) sent.push({ kind, keys: new Set(changes.map(change => change.key)), result: await send[kind](changes, clickResumes(home), home.home) });
  }
  setHome(await window.centralKnot.refresh());
  const still = waitingForChoice(state.home!), chosen = dated.filter(item => !still.some(other => walkId(other) === walkId(item)) && state.home?.[item.kind].library[item.key]?.on);
  // Carry the same plugin switches a row's own choice runs (matrix.ts turnOn) for every item taken in.
  const plugins = turnEvery(chosen.flatMap(item => throughItemsFor(item.kind, item.key)), true);
  const plugged = plugins.ops.length ? await runSwitches(plugins.ops) : undefined;
  if (plugged) setHome(await window.centralKnot.refresh());
  walk.passed.push(...undated.map(walkId));
  passChosen(dated);
  const done = latestDone(dated, undated, sent, still), reasons = switchReasons(plugged, plugins.left);
  tellWritten({ page, band: true, history: true, ...done, warn: done.warn || reasons.length > 0, ...(reasons.length ? { reasons } : {}) },
    [...sent.flatMap(({ keys, result }) => reloadsFor(result.reloads, keys)), ...(plugged ? pluginReloads(plugged.done) : [])]);
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
