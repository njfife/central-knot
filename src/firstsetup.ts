// First setup, on the page: the one question a home is asked once (synchronize everything, or not), and the walkthrough of the
// found items whose copies differ, one at a time. Nothing about either is stored: the answer is the home's Synchronize everything
// (everything.ts setSyncEverything; absent in the view until it is answered: types.ts SyncView syncEverything), and the
// walkthrough's place lives in this window until it is left. Whether the question is asked, what Yes would do, and which items
// wait for a choice are setupcounts.ts's, pure. The question, and the way back into the walkthrough, have one place: the top of
// the Overview (setupLead, drawn by pages.ts overviewPage). The walkthrough is a band at the top of the item page of the item it
// is at (walkthroughBand, drawn by matrix.ts listNotices), holding that item's copy question as its row shows it (matrix.ts
// copyQuestion), the latest copy preselected (library.ts latestCopy, in the take-in answer). Settings' Synchronize everything row
// counts as the question does and leads in too (settingspage.ts). What Yes does in the engine, and its one Undo in History, are
// everything.ts's.
import { applyClick, busy, noToolManaged, rerender, setHome, showPage, state, syncNow, tell, whyReadOnly, type PageKind } from './app.ts';
import { button, closeButton, h, icon } from './dom.ts';
import { rowClicks } from './libraryrow.ts';
import { copyQuestion } from './matrix.ts';
import { plural } from './model.ts';
import { asksNow, KINDS, waitingForChoice, whatYesDoes, type Waiting } from './setupcounts.ts';
import type { Change, HomeView } from './types.ts';
import { andList, kindNouns, toolName } from './words.ts';

const idOf = (item: Waiting) => `${item.kind}:${item.key}`;

// ---------- The question ----------

/**
 * The Overview's one place for first setup: the question, in a home never asked (Resume first, in one that waits for it); after
 * it, while Synchronize everything is on and found items wait for a choice of copy, the way into the walkthrough. Nothing where no
 * tool is managed (the Overview points to Harnesses instead), or where the home can't be written or another build syncs it.
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
    button({ variant: 'link', size: 'micro', label: walking() ? 'Go on choosing' : 'Choose copies', id: 'setup-choose', onclick: () => (walking() ? goOn() : openWalkthrough()) }));
}

function question(home: HomeView) {
  const yes = whatYesDoes(home);
  const now = yes.takes ? `Synchronize everything takes in the ${plural(yes.takes, 'item')} found in your tools that Central Knot doesn’t keep yet, and puts each in the tools that lack it${yes.to.length ? ` (${andList(yes.to.map(toolName))})` : ''}; what turns up later is taken in too.`
    : 'Nothing found in your tools now is new to Central Knot; Synchronize everything takes in what turns up later.';
  const choosing = yes.choosing ? ` Where copies differ the latest wins: ${plural(yes.choosing, 'item')} ${yes.choosing === 1 ? 'has' : 'have'} copies that differ, and you’re asked about each, one at a time, the latest preselected, or skip one to leave its copies as they are.` : '';
  const claude = yes.waitForClaude ? ` Claude Code gets ${yes.waitForClaude === 1 ? 'the MCP server' : `the ${yes.waitForClaude} MCP servers`} when you click Write to Claude Code.` : '';
  const undo = ` One Undo in History takes it all back${yes.fromClaude ? ', except an MCP server found in Claude Code (its own entry says why)' : ''}.`;
  const later = home.syncOn ? '' : ' Automatic sync is off, so nothing is added until you click Sync once.';
  return h('section.setup-question', { id: 'setup-question', 'aria-labelledby': 'setup-question-title' },
    h('h2.setup-title', { id: 'setup-question-title' }, 'Synchronize everything?'),
    h('p.setup-text', {}, `${now}${choosing}${claude}${undo}${later}`),
    h('div.setup-actions', {},
      button({ variant: 'primary', label: 'Synchronize everything', id: 'setup-yes', disabled: !!state.busy, onclick: () => void answer(true) }),
      button({ variant: 'outline', label: 'No, I’ll add items myself', id: 'setup-no', disabled: !!state.busy, attrs: { title: 'Each item stays found, with its Add; Settings can switch this on later' }, onclick: () => void answer(false) })));
}

/** A home that waits for Resume: Resume comes first (any click resumes, as on the item pages), and the question after it. */
const resumeFirst = (reason: string) => h('p.overview-line', { id: 'setup-resume' }, icon('circle-alert', 14, 'tone-warning'), `${reason} `,
  button({ variant: 'link', size: 'micro', label: 'Resume', id: 'setup-resume-button', disabled: !!state.busy, onclick: () => void applyClick({ kind: 'skills', changes: [], items: [], said: 'Resumed: sync carries on from the record as it is.' }) }),
  ' Then Central Knot asks whether to synchronize everything.');

/** The answer, refused where the home was answered meanwhile (another window). Yes opens the walkthrough where an item waits. */
const answer = (on: boolean) => busy(on ? 'Turning on Synchronize everything…' : 'Leaving it off…', async () => {
  const set = await window.centralKnot.setSyncEverything(on, state.home!.home, true);
  if (set.view) setHome(set.view);
  const home = state.home!;
  if (set.stopped) { tell({ page: 'overview', band: true, warn: true, text: `Nothing changed. ${set.stopped}` }); return; }
  if (!on) { tell({ page: 'overview', band: true, text: 'Left off: what Central Knot finds in your tools waits on its page for Add. Settings › This home can switch on Synchronize everything later.' }); return; }
  if (!home.syncOn) {
    tell({ page: 'overview', band: true, text: 'Synchronize everything is on. Automatic sync is off, so nothing is added until you click Sync once.',
      act: { label: 'Sync once', id: 'setup-sync-once', title: 'Take in what is found now; Automatic sync stays off', run: () => void syncNow().then(walkIfWaiting) } });
    return;
  }
  const taken = KINDS.flatMap(kind => home[kind].notices.flatMap(told => (told.kind === 'taken-in' ? told.items : [])));
  const waiting = waitingForChoice(home).length;
  tell({ page: 'overview', band: true, carry: true, history: true, text: `Synchronize everything is on: it took in ${plural(taken.length, 'item')}${waiting ? `, and ${plural(waiting, 'item')} with copies that differ ${waiting === 1 ? 'waits' : 'wait'} for your choice` : ''}. One Undo in History takes it back.` });
  walkIfWaiting();
});
const walkIfWaiting = () => { if (state.home && waitingForChoice(state.home).length) openWalkthrough(); };

// ---------- The walkthrough ----------

/** The walkthrough's place, in this window only: the home it is open in, and the items passed (a copy chosen, or skipped). */
const walk = { home: undefined as string | undefined, passed: [] as string[] };
const walking = () => !!state.home && walk.home === state.home.home;

/** Where it is: the item it is at (the first that waits and was not passed), the items left, and its place ("2 of 7"). */
function place(home: HomeView) {
  const left = waitingForChoice(home).filter(item => !walk.passed.includes(idOf(item)));
  return { at: left[0], left, number: walk.passed.length + 1, of: walk.passed.length + left.length };
}

/** Opens the walkthrough at its first item, on that item's page (Yes, Settings' count, the Overview's line). */
export function openWalkthrough() {
  const home = state.home;
  if (!home) return;
  Object.assign(walk, { home: home.home, passed: [] });
  if (!place(home).at) { Object.assign(walk, { home: undefined }); tell({ page: state.page, text: 'No found item waits for a choice of copy now.' }); rerender(); return; }
  goOn();
}
/** To the page of the item it is at. */
const goOn = () => { const at = state.home && place(state.home).at; if (at) showPage(at.kind); };
/** Left at any moment: what is left stays found, each with its row's question. */
const leave = () => { Object.assign(walk, { home: undefined, passed: [] }); rerender(); };
/** Passes each of these that no longer waits (its copy chosen); one refused meanwhile (a copy changed since) is asked again. */
const passChosen = (items: Waiting[]) => {
  const still = new Set(waitingForChoice(state.home!).map(idOf));
  walk.passed.push(...items.map(idOf).filter(id => !still.has(id)));
  rerender();
};
const skip = (item: Waiting) => { walk.passed.push(idOf(item)); rerender(); };

/**
 * "Use the latest for the rest": for each item left with a latest copy, the click its question's main button sends (`use`, as
 * seen: `useHash`), each with its own History entry and Undo; those with no dates to go by are skipped, and said.
 */
const useLatest = (left: Waiting[]) => busy('Choosing the latest copies…', async () => {
  const home = state.home!, dated = left.filter(item => item.latest), undated = left.filter(item => !item.latest);
  const send = { skills: window.centralKnot.applySkills, mcp: window.centralKnot.applyServers, agents: window.centralKnot.applyAgents };
  for (const kind of KINDS) {
    const changes: Change[] = dated.filter(item => item.kind === kind).map(item => rowClicks.on({ key: item.key, hashes: { [item.latest!.tool]: item.latest!.hash } }, undefined, item.latest!.tool));
    if (changes.length) await send[kind](changes, home.sync.gate.state === 'needs-resume', home.home);
  }
  setHome(await window.centralKnot.refresh());
  walk.passed.push(...undated.map(idOf));
  passChosen(dated);
  const asked = dated.filter(item => !walk.passed.includes(idOf(item)));
  const used = dated.length - asked.length, names = (list: Waiting[]) => andList(list.map(item => item.name));
  tell({ page: state.page, band: true, history: true, warn: asked.length > 0, text: [`Used the latest copy for ${plural(used, 'item')}, each with its own Undo in History.`,
    undated.length ? `Skipped ${plural(undated.length, 'item')} with no dates to go by (${names(undated)}): ${undated.length === 1 ? 'it stays' : 'they stay'} found, and ${undated.length === 1 ? 'its row asks' : 'each row asks'} which copy.` : '',
    asked.length ? `${names(asked)} changed meanwhile, so ${asked.length === 1 ? 'it is' : 'they are'} asked again.` : ''].filter(Boolean).join(' ') });
});

/**
 * The walkthrough's band on an item page: where it is, the item's copy question as its row asks it (the latest copy's button the
 * main one; "No dates to go by" where there is none), Skip, Use the latest for the rest, and leave. On another kind's page, the way
 * to the page of the item it is at; once none is left, that it is done.
 */
export function walkthroughBand(kind: PageKind): HTMLElement | null {
  const home = state.home;
  if (!home || !walking()) return null;
  const { at, left, number, of } = place(home);
  const close = closeButton(leave, { id: 'walk-leave', label: 'Leave choosing copies', title: 'Leave: what is left stays found, each with its row’s question' });
  const head = (where: string) => h('span.walk-head', {}, icon('diff', 14, 'tone-warning'), h('strong', {}, 'Choosing copies'), h('span.walk-place', {}, ` · ${where}`));
  const band = (asking: boolean, ...children: (HTMLElement | string | null)[]) => h(`div.band.band-walk${asking ? '.walk-asking' : ''}`, { role: 'region', 'aria-label': 'Choosing copies', id: 'walkthrough' }, ...children);
  if (!at) return band(false, head('done'), h('span.band-text', {}, walk.passed.length ? 'No item left to choose for. Each one skipped stays found, its copies as they are; its row still asks.' : 'No found item waits for a choice of copy now.'), close);
  if (at.kind !== kind) return band(false, head(`${number} of ${of}`), h('span.band-text', {}, `Next: ${at.name}, on ${kindNouns[at.kind].title}.`),
    button({ variant: 'outline', size: 'small', label: `Go on to ${kindNouns[at.kind].title}`, id: 'walk-go-on', onclick: goOn }), close);
  const dated = left.filter(item => item.latest).length;
  const latestTitle = `For each of the ${plural(left.length, 'item')} left, use the copy changed last${dated < left.length ? `; ${left.length - dated} with no dates to go by ${left.length - dated === 1 ? 'is' : 'are'} skipped` : ''}. Each has its own Undo in History.`;
  return band(true, h('div.walk-top', {}, head(`${number} of ${of}`), at.latest ? null : h('span.walk-note', { id: 'walk-no-dates' }, 'No dates to go by: choose one, or skip it.'),
    h('span.band-actions', {},
      button({ variant: 'outline', size: 'small', label: 'Use the latest for the rest', id: 'walk-use-latest', disabled: !dated || !!state.busy, attrs: { title: latestTitle }, onclick: () => void useLatest(left) }),
      button({ variant: 'outline', size: 'small', label: 'Skip', id: 'walk-skip', disabled: !!state.busy, attrs: { title: `Leave ${at.name} found, its copies as they are` }, onclick: () => skip(at) }),
      close)),
    copyQuestion(at.key, () => passChosen([at])));
}
