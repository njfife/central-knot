// Git repo: the Managed set kept in a git repo (GitHub, GitLab or any git server), with Pull to bring the repo's changes into the
// tools and Push to send this computer's. The page says which repo and commit are in use, when it last pulled and pushed, and
// what differs each way; nothing moves until Pull or Push is clicked.
import { acting, announce, busy, FADE_MS, rerender, setHome, setSync, showPage, state, tell } from './app.ts';
import { button, closeButton, emptyState, fold, h, icon, infoCardId, infoMark } from './dom.ts';
import type { IconName } from './icons.ts';
import { outcomeBand } from './matrix.ts';
import { dayAndTime, plural } from './model.ts';
import { andList, toolName } from './words.ts';
import type { ConnectedRepoView, RepoChange, RepoCommit, RepoResult, RepoView } from './types.ts';

const api = () => window.centralKnot;

export const repo = {
  /** The repo as last read; undefined until the page first loads it. */
  view: undefined as RepoView | undefined,
  /** Asking the repo for its latest commit (a fetch), which can take a moment on a slow network. */
  checking: false,
  draftUrl: '',
  draftBranch: '',
  /** What stopped the last Connect, Pull, Push or Disconnect, in plain words. */
  problem: undefined as string | undefined,
  /** Which field the last failed Connect points at. */
  problemField: 'url' as 'url' | 'branch',
  /** Disconnect asks once, in place. */
  confirmDisconnect: false,
  /** Whether the unconnected page's "What goes where" fold is open on this visit. */
  layoutOpen: false,
  /** Whether an explicit Check again just found nothing new; clears after FADE_MS. */
  checkedNote: false,
};

let checkedTimer: ReturnType<typeof setTimeout> | undefined;
function clearCheckedNote(): void {
  clearTimeout(checkedTimer);
  checkedTimer = undefined;
  repo.checkedNote = false;
}
function showCheckedNote(): void {
  clearTimeout(checkedTimer);
  repo.checkedNote = true;
  checkedTimer = setTimeout(() => {
    checkedTimer = undefined;
    if (!repo.checkedNote) return;
    repo.checkedNote = false;
    rerender();
  }, FADE_MS);
  (checkedTimer as { unref?: () => void }).unref?.();
}

/**
 * Leaving the page or the home: what the last Connect, Pull, Push or Disconnect said, and an open question or fold, belong to it alone.
 * `homeChanged`: the view was the other home's too, so it goes, and the next read starts afresh.
 */
export function forgetRepoPrompts(homeChanged = false): void {
  repo.problem = undefined;
  repo.confirmDisconnect = false;
  repo.layoutOpen = false;
  clearCheckedNote();
  showQuietNote = false;
  focusAfterCheck = false;
  if (!homeChanged) return;
  repo.view = undefined;
  lastReadFailure = undefined;
  checkPending = false;
}

/** Each load's turn: an older load that finishes late never overwrites a newer one, or ends its "Checking…". */
let loads = 0;

/** After a change elsewhere: read again soon, once, rather than on every action and sync notice (it rewrites the clone to compare). */
let soon: ReturnType<typeof setTimeout> | undefined;
export function loadRepoSoon(): void {
  clearTimeout(soon);
  soon = setTimeout(() => void loadRepo(), 1500);
}

/** The check (fetch) in flight, if any: a load that overtakes it waits for this one rather than starting another. */
let inFlight: Promise<RepoView | null> | undefined;
/** Whether any load since the last check asked for one: whichever load ends up newest does it, so an overtaken load's ask isn't lost. */
let wantCheck = false;
/** A fetch ended while another read overtook it: the winning read announces it and shows any quiet note once it draws. */
let checkPending = false;
/** An explicit Check again asked for an in-sight note if the repo is still up to date. */
let showQuietNote = false;
/** A keyboard press of Check again awaits the winning read so focus lands only once the button is enabled (or on #repo-state). */
let focusAfterCheck = false;

/** An error from the main process in plain words (Electron prefixes the method it came through). */
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** What the last failed read said, so a good read clears only that. */
let lastReadFailure: string | undefined;
/** What a read can change of what this page and the sidebar's count show, as one value to compare (loadRepo). */
const shownNow = () => JSON.stringify([repo.view, repo.problem, repo.checking, repo.checkedNote]);

/** Completes a finished check once the winning read is ready to draw: quiet note, redraw, status-bar announcement and keyboard focus. */
function finishCheck(view: RepoView | undefined, failed: boolean, redraw: () => void): void {
  const announced = checkPending;
  const quiet = showQuietNote;
  const focus = focusAfterCheck;
  checkPending = false;
  showQuietNote = false;
  focusAfterCheck = false;
  const upToDate = !failed && !!view?.connected && repoPhase(view, waitingCounts(view)) === 'up-to-date';
  if (announced && quiet && upToDate && state.page === 'repo') showCheckedNote();
  else if (!upToDate) clearCheckedNote();
  redraw();
  if (announced && !failed && view?.connected && state.page === 'repo') announce(checkedText(view));
  if (focus) (document.getElementById('repo-check') ?? document.getElementById('repo-state'))?.focus();
}

/**
 * Reads the repo's view; `check` then asks the repo for its latest commit (a fetch), showing the view meanwhile. Loads may overlap
 * (page open, Refresh, a change elsewhere): the newest wins (`loads`), a check already running is joined rather than started again
 * (`inFlight`), and a check an overtaken load asked for is done by the newest (`wantCheck`). A failed read keeps the last view and
 * says why (`lastReadFailure`).
 */
export async function loadRepo(check = false): Promise<void> {
  clearTimeout(soon);
  const turn = ++loads;
  // A check already in flight is joined, never started again: once it ends, the winning read draws, announces and lands focus.
  const joined = inFlight;
  if (!joined) wantCheck ||= check;
  if (joined) await joined.catch(() => undefined);
  let view: RepoView | undefined;
  let failed: string | undefined;
  try { view = (await api().repo(false)) ?? undefined; } catch (error) { failed = `Couldn’t read the repo’s state: ${errorText(error)}`; }
  if (turn !== loads) return;
  const shown = shownNow();
  // A read that fails keeps the last view on screen and says why, rather than leave a blank page; the next good read takes the
  // reason away (a refused action's reason stays until it is dismissed or the page is left).
  if (failed) { view = repo.view; repo.problem = failed; } else if (repo.problem === lastReadFailure) repo.problem = undefined;
  lastReadFailure = failed;
  check = wantCheck && !joined;
  wantCheck = false;
  repo.view = view;
  const willFetch = check && !!view?.connected && view.access.allowed && !view.held;
  if (!inFlight && !willFetch) repo.checking = false;
  // Drawn only when the read changed what is shown: a redraw that changes nothing would replace a text field he is typing in, and its Undo.
  const redraw = () => { if (shownNow() !== shown) rerender(); };
  if (!willFetch) {
    if (!inFlight && (checkPending || focusAfterCheck || showQuietNote)) {
      finishCheck(view, !!failed, redraw);
    } else {
      if (view?.connected && repoPhase(view, waitingCounts(view)) !== 'up-to-date') clearCheckedNote();
      redraw();
    }
    return;
  }
  clearCheckedNote();
  checkPending = false;
  repo.checking = true;
  rerender();
  inFlight = api().repo(true)
    .then(result => {
      checkPending = true;
      return result;
    })
    .finally(() => {
      inFlight = undefined;
    });
  try { view = (await inFlight) ?? view; } catch { /* the view already shown stands */ }
  // A load that started meanwhile joined this check and its winning read draws, announces and lands focus.
  if (turn !== loads) return;
  repo.view = view;
  repo.checking = false;
  finishCheck(view, false, rerender);
}

/** After a write: the page and the home both read again, so every page shows what Pull or Push left on disk. */
async function settle(result: RepoResult, done: string, note?: string, warn?: boolean, items?: string[]) {
  repo.view = result.view;
  repo.problem = result.stopped;
  repo.confirmDisconnect = false;
  clearCheckedNote();
  setHome(await api().refresh(), { reload: false });
  const moved = !!result.pulled || result.results.some(entry => entry.outcome === 'written' || entry.outcome === 'removed');
  if (result.stopped) announce(result.stopped, true);
  else tell({ page: 'repo', text: done, note, warn, items }, '', { checkProfile: moved });
}

const connect = () => busy('Connecting to the repo…', async () => {
  const result = await api().connectRepo(repo.draftUrl, repo.draftBranch, state.home!.home);
  const view = result.view;
  const waiting = view.connected ? waitingCounts(view).pull : 0;
  await settle(result, `Connected. Nothing changed in your tools${waiting ? `; Pull brings in ${plural(waiting, 'item')} from the repo` : ''}.`);
  if (!result.stopped) { repo.draftUrl = ''; repo.draftBranch = ''; }
  // A failed Connect points at what to fix (the branch, when the branch was refused; else the address), marked until edited.
  else { repo.problemField = result.field ?? 'url'; requestAnimationFrame(() => document.getElementById(`repo-${repo.problemField}`)?.focus()); }
});

const pull = (byKeyboard: boolean) => void pullNow().then(() => { if (byKeyboard) keepFocus('repo-pull'); });
/**
 * What a Pull did, for its band: what came in, what it left (one left is named; ones waiting for Automatic sync were foreseen by
 * their rows, any other is a surprise and warns), and what a tool didn't take. `names` are the items named.
 */
function pullSummary(result: RepoResult): { text: string; note?: string; warn: boolean; names: string[] } {
  const count = result.pulled ?? 0;
  const leftRows = result.view.connected ? result.view.incoming.filter(change => change.retry) : [];
  const surprise = leftRows.some(change => change.sync !== 'waits');
  const lone = leftRows.length === 1 ? leftRows[0] : undefined;
  const base = result.view.connected ? result.view.base : undefined;
  // A Pull that moved no item still moved this computer to the repo's commit: named as Push names its commit.
  const moved = base ? `Moved to ${base.id.slice(0, 7)} “${base.subject}”` : 'Pulled';
  const opening = count ? `Pulled ${plural(count, 'change')} into your tools.`
    : !leftRows.length ? `${moved}. Nothing in your tools needed to change.`
    : surprise ? '' : `${moved};`;
  const leftText = !leftRows.length ? ''
    : !surprise ? (lone ? `${lone.name} still waits for Automatic sync.` : `${leftRows.length} items still wait for Automatic sync.`)
    : lone ? `${lone.name} ${lone.change === 'removed' ? 'wasn’t deleted here yet' : 'didn’t come in yet'}; its row says why.`
    : `${leftRows.length} items didn’t come in yet; their rows say why.`;
  // What a tool didn't take is said, by tool.
  const missed = result.results.filter(entry => entry.harness && (entry.outcome === 'failed' || entry.outcome === 'held'))
    .map(entry => `${entry.item} didn’t reach ${toolName(entry.harness!)} (${entry.message.replace(/\.$/, '')})`);
  const missedText = missed.length ? `${missed.slice(0, 3).join('; ')}${missed.length > 3 ? `; and ${missed.length - 3} more` : ''}.` : '';
  return {
    text: [opening, leftText, missedText].filter(Boolean).join(' '),
    // One wording for the promise, always with History one click away.
    note: count ? `Undo ${count === 1 ? 'it' : `any of the ${count}`} in History.` : undefined,
    warn: surprise, names: lone ? [lone.name] : [],
  };
}

const pullNow = () => busy('Pulling from the repo…', async () => {
  const result = await api().pullRepo(state.home!.home);
  const said = pullSummary(result);
  await settle(result, said.text, said.note, said.warn, said.names);
});

const push = (byKeyboard: boolean) => void pushNow().then(() => { if (byKeyboard) keepFocus('repo-push'); });
const pushNow = () => busy('Pushing to the repo…', async () => {
  const result = await api().pushRepo(state.home!.home);
  await settle(result, result.pushed ? `Pushed as ${result.pushed.id.slice(0, 7)} “${result.pushed.subject}”.` : 'Pushed.');
});

/** Leaves the Disconnect question; focus goes back to the button that asked it. */
function cancelDisconnect() {
  repo.confirmDisconnect = false;
  rerender();
  document.getElementById('repo-disconnect')?.focus();
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && repo.confirmDisconnect) cancelDisconnect(); });

/** After Pull or Push: if its button went away (nothing left to move), focus moves to the page's state line. */
const keepFocus = (id: string) => { if (!document.getElementById(id)) document.getElementById('repo-state')?.focus(); };
/** After Check again: clears any old note and lets the winning read show the new quiet note and land keyboard focus. */
const checkAgain = (byKeyboard: boolean) => {
  clearCheckedNote();
  showQuietNote = true;
  focusAfterCheck ||= byKeyboard;
  void loadRepo(true);
};

const disconnect = () => busy('Disconnecting…', async () => {
  // The address stays in the form, so connecting again is one click.
  const last = repo.view?.connected ? { url: repo.view.url, branch: repo.view.branch } : undefined;
  const result = await api().disconnectRepo(state.home!.home);
  if (last && !result.stopped) repo.draftUrl = last.url;
  await settle(result, 'Disconnected. Your tools and the repo are as they were.');
});

// ---------- Pieces ----------

/** Each kind's icon, its label on a row, and how a sentence names one ("A skill named …"). */
const kinds: Record<RepoChange['kind'], { glyph: IconName; label: string; a: string }> = {
  skill: { glyph: 'wand-sparkles', label: 'Skill', a: 'A skill' },
  mcp: { glyph: 'plug', label: 'MCP server', a: 'An MCP server' },
  agent: { glyph: 'bot', label: 'Agent', a: 'An agent' },
  base: { glyph: 'pencil-line', label: 'Instructions', a: 'Base instructions' },
};

const when = (iso?: string) => (iso ? dayAndTime(iso) : undefined);

/** A commit as people read it in a git client: short id, subject, when (real spaces between, so it reads and copies as one line). */
const commitText = (commit: RepoCommit) => h('span.repo-commit', { title: `${commit.id}\n${commit.subject}` },
  h('span.mono.repo-sha', {}, commit.id.slice(0, 7)), commit.subject ? [' ', h('span.repo-subject', {}, commit.subject)] : null,
  commit.at ? [' ', h('span.tone-muted.repo-when', {}, when(commit.at))] : null);

/** What Pull does with an incoming row now, as the main process decided it (classify): the page never works it out again. */
type PullState = NonNullable<RepoChange['pull']>;
const pullState = (change: RepoChange): PullState => change.pull ?? 'moves';

/** A row's note: what Pull or Push will do with it, or why it can't; `warns` when the reader should look twice. */
function rowNote(change: RepoChange, side: 'in' | 'out'): { text: string | HTMLElement; warns: boolean; act?: HTMLElement } | undefined {
  // What can't happen leads in warning colour; the why follows in the note's soft ink, as one wrapping sentence.
  const lead = (first: string, rest: string) => ({ text: h('span', {}, h('span.tone-warning', {}, first), ` ${rest}`), warns: true });
  const plain = (text: string, warns = false) => ({ text, warns });
  if (side === 'out') {
    if (change.held) return lead('Stays out of the repo.', change.held);
    if (change.keptHere) return plain('Removed in the repo but changed here, so it stays, and Push puts it back.');
    return change.change === 'removed' ? plain('Deleted here or no longer Managed. Push removes it from the repo.') : undefined;
  }
  const state = pullState(change);
  // Left by the last Pull: a deletion isn't "coming in", so it says what didn't happen.
  const notYet = change.change === 'removed' ? 'Not deleted here yet.' : 'Didn’t come in yet.';
  // Before Pull, the note under the list says what turning sync on does (with its button); after, the row carries the button.
  if (state === 'waits') return change.retry ? { ...lead(notYet, 'It waits for Automatic sync: turn it on, then Pull again.'), act: syncOnButton(`repo-sync-on-${change.key}`) }
    : lead('Waits for Automatic sync.', 'History can restore it once it is deleted.');
  // Waited for sync at the last Pull, and sync is on now: only the click is left.
  if (change.sync === 'ready') return plain('Automatic sync is on now: Pull again deletes it from your tools. History can restore it.');
  if (state === 'again') return lead(notYet, change.held!);
  if (state === 'stuck') return lead('Can’t come in.', `${change.held} Push leaves it in the repo as it is.`);
  if (change.alsoHere === 'removed') return plain('Removed here, or no longer Managed, but changed in the repo, so Pull brings it back.', true);
  if (change.alsoHere === 'unmanaged') return plain(`${kinds[change.kind].a} named ${change.name} is already in your tools, not Managed. Pull replaces it; yours stays in History.`, true);
  if (change.alsoHere) return plain('Changed here too. Pull uses the repo’s version; yours stays in History.', true);
  if (change.change === 'removed' && change.kind === 'base') return plain('Pull empties the base instructions and takes them out of the tools that get them. History can undo it.');
  return change.change === 'removed' ? plain('Pull deletes it from your tools. History can restore it.') : undefined;
}

/** What happened to one item on the side it comes from, and what Pull or Push will do about it. */
function changeRow(change: RepoChange, side: 'in' | 'out') {
  const kind = kinds[change.kind];
  const label = { added: 'New', changed: 'Changed', removed: 'Removed' }[change.change];
  const note = rowNote(change, side);
  // A row its button won't move is muted, change label and all.
  const quiet = stuckRow(change, side);
  return h(`li.repo-row${quiet ? '.repo-row-held' : ''}`, { 'data-key': change.key },
    h('span.repo-row-icon', { title: kind.label }, icon(kind.glyph, 14, 'tone-muted')),
    h('span.repo-row-main', {},
      // Kind and change stay together, so a long name that wraps carries them as one.
      h('span.repo-row-line', {}, h('strong.repo-row-name', { title: change.name }, change.name), h('span.repo-row-meta', {}, h('span.repo-row-kind', {}, kind.label),
        h(`span.repo-row-change.repo-change-${quiet ? 'held' : change.change}`, {}, label))),
      note ? h('span.repo-row-note.tone-muted', {}, icon(note.warns ? 'triangle-alert' : 'info', 12, note.warns ? 'tone-warning' : ''), h('span', {}, note.text, note.act ? [' ', note.act] : null)) : null));
}

/** An item its button won't move: held for good, or (coming in) waiting for Automatic sync. */
const stuckRow = (change: RepoChange, side: 'in' | 'out') => (side === 'in' ? ['stuck', 'waits'].includes(pullState(change)) : !!change.held);

/** A note under a list's head: why its button can't run, or what it does when it moves none of the rows. */
interface SideNote { id?: string; text: string; warns: boolean; act?: HTMLElement }
/**
 * One direction: its items, the button that moves them (`action`), what of them the button won't move (`stuck`, beside it, in the
 * state line's words), and a note under it.
 */
function changeList({ id, title, changes, side, action, empty, stuck, note }: { id: string; title: string; changes: RepoChange[]; side: 'in' | 'out'; action: HTMLElement | null; empty: string; stuck: string; note?: SideNote }) {
  return h('section.repo-side', { 'aria-labelledby': id },
    // Title, its button, then what it won't move: the button stays put whatever is held. With no button there, the rows just below say it.
    h('div.repo-side-head', {}, h('h2.eyebrow', { id }, title), action, stuck && action ? h('span.repo-stuck-count', {}, stuck) : null),
    note ? h('p.repo-side-note', { id: note.id }, icon(note.warns ? 'triangle-alert' : 'info', 12, note.warns ? 'tone-warning' : ''), h('span', {}, note.text, note.act ? [' ', note.act] : null)) : null,
    // What can't move comes last, so the list reads top-down as what the button does, then what stays.
    changes.length ? h('ul.repo-list', {}, [...changes].sort((first, second) => Number(stuckRow(first, side)) - Number(stuckRow(second, side))).map(change => changeRow(change, side)))
      : h('p.repo-empty-side', {}, empty));
}

/** What waits each way, by what can be done with it: the buttons' counts, and what they won't move. */
export interface Waiting { pull: number; retry: number; syncWaits: number; stuck: number; push: number; cantGo: number }

export function waitingCounts(view: ConnectedRepoView): Waiting {
  const incoming = (wanted: PullState) => view.incoming.filter(change => pullState(change) === wanted).length;
  return { pull: incoming('moves'), retry: incoming('again'), syncWaits: incoming('waits'), stuck: incoming('stuck'),
    push: view.outgoing.filter(change => !change.held).length, cantGo: view.outgoing.filter(change => change.held).length };
}

/**
 * The same counts in words, said alike by the state line, the status bar, the sidebar and the facts: what Pull and Push will move,
 * and what neither will (coming in, then going).
 */
export function waitingWords(counts: Waiting) {
  const said = (count: number, text: string) => (count ? `${count} ${text}` : '');
  const waits = counts.syncWaits === 1 ? 'waits' : 'wait';
  return {
    pull: said(counts.pull, 'to pull'), push: said(counts.push, 'to push'), retry: said(counts.retry, 'to pull again'),
    stuckIn: [said(counts.stuck, 'can’t come in'), said(counts.syncWaits, `${waits} for Automatic sync`)].filter(Boolean).join(', '),
    stuckOut: said(counts.cantGo, 'can’t go'),
  };
}

/** "The same commit", and what of it isn't in your tools, in the state line's words, so the facts stay true. */
function sameCommitText(counts: Waiting): string {
  const words = waitingWords(counts);
  const left = [words.retry, words.stuckIn].filter(Boolean).join(', ');
  return left ? `The same commit. ${left.charAt(0).toUpperCase()}${left.slice(1)}.` : 'The same commit';
}

/** Push's count as the toolbar says it: waiting on Pull when Push can't run yet. */
const pushCountText = (view: ConnectedRepoView, count: number) => (view.pushBlocked ? `${count} to push after Pull` : `${count} to push`);

type RepoPhase = 'held' | 'problem' | 'moving' | 'branch-gone' | 'newer-commit' | 'stuck' | 'up-to-date';

/** The connected repo's one state, in precedence order, read by the state line, (?) card, status bar and in-sync panel. */
function repoPhase(view: ConnectedRepoView, counts: Waiting): RepoPhase {
  if (view.held) return 'held';
  if (view.problem) return 'problem';
  if (counts.pull || counts.push || counts.retry) return 'moving';
  if (view.branchGone) return 'branch-gone';
  if (view.pushBlocked) return 'newer-commit';
  if (counts.stuck || counts.syncWaits || counts.cantGo) return 'stuck';
  return 'up-to-date';
}

/** What the state line's (?) card says for each state, matching only the buttons shown now. */
function repoStateInfo(view: ConnectedRepoView, counts: Waiting, phase: RepoPhase): string {
  if (repo.checking) return 'Asking the repo for its latest commit. Nothing in your tools or the repo changes.';
  if (phase === 'held') return 'Pull and Push stay paused until the problem below is cleared. Nothing in your tools or the repo moves meanwhile.';
  if (phase === 'problem') return 'Pull and Push wait until the repo can be reached again. Nothing in your tools changes meanwhile.';
  if (phase === 'branch-gone') return 'That branch is no longer in the repo. Push puts this computer’s saved commit back as the branch.';
  if (phase === 'newer-commit') return 'The repo has a newer commit. Pull moves this computer to it.';
  if (phase === 'stuck') return 'Only items that can’t move differ right now. Each row below says what is holding it back.';
  if (phase === 'up-to-date') return 'Nothing to pull or push. Check again asks the repo for new commits now.';
  // phase === 'moving'. From gitrepo.ts classify/stageSides: a row that moves (counts.pull > 0) only exists with a newer commit
  // (view.pushBlocked), while branchGone sets latest === base (so pushBlocked is never set alongside it).
  const pullable = counts.pull > 0 || counts.retry > 0;
  const pushable = counts.push > 0;
  if (pullable && pushable && view.pushBlocked) {
    return 'Pull brings the repo’s changes into your tools first (each with Undo in History), then Push sends this computer’s Managed set.';
  }
  if (pullable && pushable && view.branchGone) {
    return 'Pull again retries what the last Pull couldn’t finish; Push commits this computer’s Managed set and puts the branch back.';
  }
  if (pullable && pushable) return 'Pull again retries what the last Pull couldn’t finish; Push sends this computer’s Managed set.';
  if (pullable && view.branchGone) {
    return 'Pull again retries what the last Pull couldn’t finish; Push puts this computer’s saved commit back as the branch.';
  }
  if (pushable && view.pushBlocked) return 'Pull moves this computer to the repo’s latest commit first, then Push sends this computer’s Managed set.';
  if (counts.pull > 0) return 'Pull brings the repo’s changes into your tools, each with Undo in History. Nothing moves until you click Pull.';
  if (counts.retry > 0) return 'Pull again retries what the last Pull couldn’t finish (with Undo in History). Nothing moves until you click Pull again.';
  if (view.branchGone) return 'That branch is no longer in the repo. Push commits this computer’s Managed set and puts the branch back.';
  return 'Push commits this computer’s Managed set to the repo; other files stay as they are. Nothing moves until you click Push.';
}

/** The state in one line: up to date, what waits each way, or that the repo couldn't be reached. */
function stateLine(view: ConnectedRepoView, counts: Waiting, phase: RepoPhase): HTMLElement {
  const part = (glyph: IconName, tone: string, text: string, muted = false) => h(`span.repo-state-part${muted ? '.tone-muted' : ''}`, {}, icon(glyph, 14, tone), h('span', {}, text));
  const words = waitingWords(counts);
  const stuck = [words.stuckIn, words.stuckOut].filter(Boolean).join(', ');
  // While the repo can't be reached, the counts are what was last seen: said quietly, as neither button can act on them.
  const quiet = phase === 'problem';
  const moving = [counts.pull ? part('arrow-down-to-line', quiet ? 'tone-muted' : 'tone-accent', words.pull, quiet) : null,
    counts.push ? part('arrow-up-from-line', view.pushBlocked || quiet ? 'tone-muted' : 'tone-accent', pushCountText(view, counts.push), !!view.pushBlocked || quiet) : null,
    counts.retry ? part('arrow-down-to-line', quiet ? 'tone-muted' : 'tone-accent', words.retry, quiet) : null];
  const settled = phase === 'branch-gone' ? part('triangle-alert', 'tone-warning', 'The repo’s branch is gone')
    : phase === 'newer-commit' ? part('arrow-down-to-line', 'tone-accent', 'A newer commit to pull')
    : phase === 'stuck' ? part('circle-check', 'tone-muted', 'Nothing else to pull or push', true)
    : part('circle-check', 'tone-success', 'Up to date with the repo');
  const parts = repo.checking ? [part('refresh-cw', 'tone-muted spin', 'Checking the repo…')]
    : phase === 'held' ? [part('circle-alert', 'tone-danger', 'Pull and Push are held')]
    // Unreachable: what can't move is said beside each list; the line keeps to the problem and the counts.
    : phase === 'problem' ? [part('circle-alert', 'tone-danger', 'Couldn’t reach the repo'), ...moving]
    // Nothing moves: what can't leads, in full ink, then the rest. Otherwise it follows the counts, quietly.
    : phase !== 'moving' ? [stuck ? part('triangle-alert', 'tone-warning', stuck) : null, settled]
    : [...moving, stuck ? part('triangle-alert', 'tone-warning', stuck, true) : null];
  // Focusable, so focus has somewhere to land when the button just used goes away (nothing left to pull or push).
  return h('span.repo-state-wrap', { 'data-info-block': true },
    h('span.repo-state', { id: 'repo-state', role: 'status', tabindex: '-1' }, parts),
    infoMark('repo-state-info', 'Git repo', repoStateInfo(view, counts, phase)));
}

/** What a check found, for the status bar: the state line's words, so the two never disagree. */
function checkedText(view: ConnectedRepoView): string {
  const counts = waitingCounts(view);
  const phase = repoPhase(view, counts);
  if (phase === 'held' || phase === 'problem') return phase === 'held' ? 'Pull and Push are held.' : 'Couldn’t reach the repo.';
  const words = waitingWords(counts);
  const moving = [words.pull, words.push, words.retry].filter(Boolean).join(', ');
  const stuck = [words.stuckIn, words.stuckOut].filter(Boolean).join(', ');
  if (phase === 'moving') return `Checked the repo: ${[moving, stuck].filter(Boolean).join(', ')}.`;
  const rest = phase === 'branch-gone' ? 'its branch is gone' : phase === 'newer-commit' ? 'a newer commit to pull' : phase === 'stuck' ? 'nothing else to pull or push' : 'up to date';
  return `Checked the repo: ${[stuck, rest].filter(Boolean).join('; ')}.`;
}

/** The note under "From the repo" when Pull moves none of its rows. */
const PULL_NOTE_ID = 'repo-incoming-note';
/** Said of a Pull that moves no row: it only brings this computer to the repo's newer commit. */
const PULL_MOVES_NONE = 'Pull only moves this computer to the repo’s latest commit; the items listed stay as they are.';

/** While the repo can't be reached: said once, above both lists, and named by both buttons. */
const WAITING_ID = 'repo-waiting';

/**
 * Pull: shown when something can come in, an unfinished item can be tried again, or a newer commit changes nothing here (Pull then
 * just moves to it). Items whose fault is in the repo can't be pulled at all.
 */
function pullButton(view: ConnectedRepoView, { pull: pullable, retry: retryable }: Waiting, moving: boolean) {
  if (!pullable && !retryable && !view.pushBlocked) return null;
  const movesRows = pullable + retryable > 0;
  return button({
    // Primary when it moves something, or is the only step (a newer commit); not when every row waits or can't come in.
    variant: !view.problem && (movesRows || !view.incoming.length) ? 'primary' : 'outline', size: 'small', icon: 'arrow-down-to-line', id: 'repo-pull', disabled: moving || !view.latest,
    // Pull also tries again what the last one couldn't finish, so those count too.
    label: pullable ? `Pull ${pullable + retryable}` : retryable ? 'Pull again' : 'Pull',
    // When it moves no row, the note under the list says what it does: the button is described by it.
    attrs: view.problem ? { 'aria-describedby': WAITING_ID } : movesRows ? { title: 'Bring the repo’s changes into your tools. Each one goes into History, with Undo.' } : { title: PULL_MOVES_NONE, 'aria-describedby': PULL_NOTE_ID },
    // A keyboard press (no pointer: detail 0) keeps its place on the page when the button goes away.
    onclick: (event: MouseEvent) => pull(event.detail === 0),
  });
}

/** Push: shown when something here can go, or the branch is gone from the repo (Push puts it back with nothing else to send). */
function pushButton(view: ConnectedRepoView, pushable: number, moving: boolean) {
  if (!pushable && !view.branchGone) return null;
  const describedBy = view.problem ? WAITING_ID : view.pushBlocked ? 'repo-outgoing-blocked' : undefined;
  return button({
    variant: view.pushBlocked || view.problem ? 'outline' : 'primary', size: 'small', icon: 'arrow-up-from-line', id: 'repo-push', disabled: moving || !!view.pushBlocked,
    label: pushable ? `Push ${pushable}` : 'Push',
    attrs: describedBy ? { 'aria-describedby': describedBy } : { title: `Commit the Managed set as it is here to ${view.branch} and push it.` },
    onclick: (event: MouseEvent) => push(event.detail === 0),
  });
}

/** Check again: asks the repo for its latest commit when up to date, the same check as Refresh and Try again. */
const checkButton = (disabled: boolean | string) => button({
  variant: 'outline', size: 'small', icon: 'refresh-cw', label: 'Check again', id: 'repo-check', disabled,
  onclick: (event: MouseEvent) => checkAgain(event.detail === 0),
});

function connectedPage(view: ConnectedRepoView) {
  // Counted once, so every place on the page says the same numbers.
  const counts = waitingCounts(view);
  const phase = repoPhase(view, counts);
  const words = waitingWords(counts);
  const locked = !!acting() || !view.access.allowed;
  // While the repo can't be reached or Pull and Push are held, neither button can act.
  const moving = locked || repo.checking || phase === 'problem' || phase === 'held';
  const pullControl = pullButton(view, counts, moving);
  const pushControl = pushButton(view, counts.push, moving);
  // Rows to pull but none Pull will move (each waits or can't come in): Pull only moves this computer to the newer commit.
  const pullMovesNone = !!pullControl && !counts.pull && !counts.retry && view.incoming.length > 0;
  // With sync on first, one Pull would also make the deletions waiting for it: said, to save the second Pull.
  const waitingNames = view.incoming.filter(change => pullState(change) === 'waits').map(change => change.name);
  const movesNoneText = waitingNames.length ? `${PULL_MOVES_NONE} Turn on Automatic sync first, and Pull deletes ${andList(waitingNames)} too.` : PULL_MOVES_NONE;
  // The step it names, where the eye already is.
  const turnSyncOn = waitingNames.length ? syncOnButton('repo-sync-on') : undefined;
  const latestDiffers = view.latest && view.latest.id !== view.base?.id;
  const inSync = !view.incoming.length && !view.outgoing.length;
  const checked = repo.checking ? 'checking now…' : `checked ${when(view.checkedAt) ?? 'not yet'}${view.problem ? ' (couldn’t reach it)' : ''}`;
  // Only what has happened: right after Connect that is just the check.
  const parts = [view.pulledAt ? `pulled ${when(view.pulledAt)}` : '', view.pushedAt ? `pushed ${when(view.pushedAt)}` : '', checked].filter(Boolean);
  // One sentence; each part stays whole and keeps its comma, so a wrapped line breaks after a comma, never inside a time.
  const activity = parts.flatMap((text, index) => [index ? ' ' : '', h('span.repo-activity-part', {}, `${index ? text : text.charAt(0).toUpperCase() + text.slice(1)}${index < parts.length - 1 ? ',' : ''}`)]);
  return h('div.page.repo-page', {},
    h('div.toolbar.repo-toolbar', {},
      stateLine(view, counts, phase),
      h('span.toolbar-spacer'),
      // While the question is open it stands in for this button, so the button steps aside rather than sit there dimmed.
      repo.confirmDisconnect ? null : disconnectButton(locked)),
    h('div.bands', {},
      view.access.allowed ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.access.reason)),
      disconnectQuestion(),
      problemBand(!repo.problem && !repo.checking ? (view.held ?? view.problem) : undefined),
      outcomeBand()),
    h('div.scroll.repo-scroll', { id: 'repo-scroll' },
      h('section.repo-where', { 'aria-label': 'Repo' },
        h('div.repo-address', {}, icon('git-branch', 16, 'tone-muted'), h('span.repo-address-text', {}, h('span.mono.repo-url', {}, view.url), h('span.repo-branch', { title: 'Branch' }, view.branch))),
        h('dl.facts.repo-facts', {},
          h('dt', {}, 'This computer is at'), h('dd', {}, view.base ? commitText(view.base) : h('span.tone-muted', {}, 'Nothing pulled or pushed yet')),
          h('dt', {}, view.problem ? 'Repo, last seen' : 'Repo’s latest'), h('dd', {}, view.branchGone ? h('span.tone-warning', {}, `The repo no longer has the branch ${view.branch}. Push puts it back.`) : !view.latest ? h('span.tone-muted', {}, 'The repo is empty') : latestDiffers ? h('span.repo-latest', {}, commitText(view.latest), h('span.repo-new', {}, 'not pulled yet')) : h('span.tone-muted', {}, sameCommitText(counts))),
          h('dt', {}, 'Activity'), h('dd', {}, h('span.repo-activity', {}, activity)))),
      phase === 'problem' ? h('p.repo-stale', { id: WAITING_ID }, icon('info', 12), `${view.latest ? 'These lists are from the last time the repo was reached' : 'The repo hasn’t been reached yet'}; Pull and Push wait until it can be.`) : null,
      phase === 'held' ? null
        : inSync && phase === 'branch-gone' ? h('div.repo-in-sync', {}, h('span', {}, `Nothing else differs. Push puts the branch ${view.branch} back in the repo.`), pushControl)
        : inSync && phase === 'newer-commit' ? h('div.repo-in-sync', {}, h('span', {}, 'The repo has a newer commit that changes nothing in your Managed set. Pull to move to it.'), pullControl)
        : phase === 'up-to-date' ? h('div.repo-in-sync', {}, checkButton(locked || repo.checking), repo.checkedNote && !repo.checking ? h('span', { id: 'repo-checked-note' }, 'Checked just now: nothing new.') : null)
        : inSync ? null
        : h('div.repo-sides', {},
          // When Pull moves none of the rows, the note under it explains the list, so no count beside it.
          changeList({ id: 'repo-incoming', title: 'From the repo', changes: view.incoming, side: 'in', action: pullControl,
            empty: view.latest ? 'Nothing new in the repo.' : 'The repo is empty. Push to put your Managed set in it.', stuck: pullMovesNone ? '' : words.stuckIn,
            note: pullMovesNone && !view.problem ? { id: PULL_NOTE_ID, text: movesNoneText, warns: false, act: turnSyncOn } : undefined }),
          changeList({ id: 'repo-outgoing', title: 'From this computer', changes: view.outgoing, side: 'out', action: pushControl,
            empty: 'Nothing here that the repo doesn’t have.', stuck: words.stuckOut,
            note: counts.push && !view.problem && view.pushBlocked ? { id: 'repo-outgoing-blocked', text: view.pushBlocked, warns: true } : undefined }))));
}

/** Turns Automatic sync on, beside the words that ask for it (none while it is already on). */
const syncOnButton = (id: string) => (state.home && !state.home.syncOn
  ? button({ variant: 'link', size: 'micro', label: 'Turn sync on', id, disabled: !!acting() || !state.home.sync.access.allowed, onclick: () => void setSync(true) }) : undefined);

/** Disconnect…: asks first, in place (disconnectQuestion), with focus on Cancel. */
const disconnectButton = (disabled: boolean) => button({ variant: 'ghost', size: 'small', icon: 'unplug', label: 'Disconnect…', id: 'repo-disconnect', disabled,
  onclick: () => { repo.confirmDisconnect = true; rerender(); document.getElementById('repo-disconnect-cancel')?.focus(); } });

/** The question Disconnect… asks, while it is open. */
const disconnectQuestion = () => (repo.confirmDisconnect ? h('div.band.repo-confirm', { role: 'alert' }, icon('unplug', 14, 'tone-muted'),
  h('span.band-text', {}, 'Disconnect? Your tools and the repo stay as they are.'),
  button({ variant: 'outline', size: 'small', label: 'Disconnect', id: 'repo-disconnect-confirm', disabled: !!acting(), onclick: () => void disconnect() }),
  button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'repo-disconnect-cancel', onclick: cancelDisconnect })) : null);

/** What stopped the last action (dismissable), or why the repo couldn't be reached (with Try again). */
function problemBand(unreachable: string | undefined) {
  const shown = repo.problem ?? unreachable;
  if (!shown) return null;
  // An action's refusal can be dismissed; a reason to read again (the repo out of reach, or reading failed) offers Try again.
  const refusal = !!repo.problem && repo.problem !== lastReadFailure;
  return h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', {}, shown),
    refusal ? closeButton(() => { repo.problem = undefined; rerender(); }, { id: 'repo-problem-dismiss' })
      : button({ variant: 'outline', size: 'small', icon: 'refresh-cw', label: 'Try again', id: 'repo-try-again', disabled: !!state.busy, onclick: () => void loadRepo(true) }));
}

/** The repo's layout, folded before connecting so people can set one up by hand or know what Push will make. */
const layout = () => h('dl.repo-layout', { 'aria-label': 'What goes where in the repo' },
  h('dt.mono', {}, 'skills/<folder>/'), h('dd', {}, 'one folder per skill, byte for byte'),
  h('dt.mono', {}, 'mcp/<name>.json'), h('dd', {}, 'one MCP server, in Claude Code’s shape'),
  h('dt.mono', {}, 'agents/<name>.md'), h('dd', {}, 'one agent, in Claude Code’s format'),
  h('dt.mono', {}, 'instructions/base.md'), h('dd', {}, 'the base instructions'));

function connectForm(allowed: boolean) {
  const ready = () => !acting() && allowed && !!repo.draftUrl.trim();
  const go = () => { if (ready()) void connect(); };
  const refresh = () => { const control = document.getElementById('repo-connect') as HTMLButtonElement | null; if (control) control.disabled = !ready(); };
  const field = (id: string, label: string, placeholder: string, value: string, set: (text: string) => void, { hint, info, below }: { hint?: string; info?: HTMLElement; below?: string } = {}) => h('div.repo-field', { 'data-info-block': info ? true : undefined },
    h('div.repo-field-head', {}, h('label.market-add-label', { for: id }, label, hint ? h('span.repo-field-hint', {}, hint) : null), info),
    h('input.market-add-input', { id, type: 'text', placeholder, value, spellcheck: 'false', autocomplete: 'off', disabled: !!acting() || !allowed,
      'aria-describedby': [below ? `${id}-below` : '', info ? infoCardId(`${id}-info`) : ''].filter(Boolean).join(' ') || undefined,
      'aria-invalid': repo.problem && id === `repo-${repo.problemField}` ? 'true' : undefined,
      // Typing a new address or branch answers the last failure: its band goes.
      oninput: (event: Event) => { set((event.target as HTMLInputElement).value); if (repo.problem) { repo.problem = undefined; rerender(); } refresh(); }, onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') go(); } }),
    below ? h('span.repo-field-below', { id: `${id}-below` }, below) : null);
  return h('div.repo-connect', {},
    // The address takes the width; the branch, one word, sits beside it when there is room.
    h('div.repo-fields', {},
      field('repo-url', 'Repo address', 'https://github.com/you/agent-config.git', repo.draftUrl, text => { repo.draftUrl = text; }, {
        info: infoMark('repo-url-info', 'Repo address', 'The address you’d give git clone. SSH works too: git@gitlab.com:you/agent-config.git'),
        below: 'Uses this computer’s git sign-in (HTTPS or SSH); never asks for a password or token.',
      }),
      field('repo-branch', 'Branch', 'Default branch', repo.draftBranch, text => { repo.draftBranch = text; }, { hint: 'optional' })),
    h('div.repo-connect-actions', {},
      button({ variant: 'primary', size: 'small', icon: 'git-branch', label: 'Connect', id: 'repo-connect', disabled: !ready(), onclick: go,
        attrs: { title: 'Connecting changes nothing in your tools. You choose when to Pull or Push.' } }),
      h('span.repo-connect-note', {}, 'Connecting changes nothing in your tools.')));
}

export function repoPage(): HTMLElement {
  const view = repo.view;
  // Not read yet: said so. Never read because reading failed: the reason, and Disconnect (which needs no reading) as a way out.
  if (!view && !lastReadFailure) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
  if (!view) return h('div.page.repo-page', {}, h('div.toolbar.repo-toolbar', {}, h('span.toolbar-spacer'), repo.confirmDisconnect ? null : disconnectButton(!!acting())),
    h('div.bands', {}, disconnectQuestion(), problemBand(lastReadFailure)));
  if (view.connected) return connectedPage(view);
  const whatGoesWhere = fold({
    id: 'repo-what-goes-where', toggleId: 'repo-what-goes-where-toggle', label: 'What goes where',
    open: repo.layoutOpen, onToggle: open => { repo.layoutOpen = open; }, bodyClass: 'repo-fold-body',
  },
    layout(),
    h('p.empty-aside', {}, 'Only your Managed set goes to the repo: skills, MCP servers and agents in Central Knot (On or Off, not from plugins) and base instructions.'));
  return h('div.page.repo-page', {},
    h('div.bands', {}, view.access.allowed ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.access.reason)), problemBand(undefined), outcomeBand()),
    h('div.scroll', { id: 'repo-scroll' }, emptyState('git-branch', 'Keep your Managed set in a git repo', undefined,
      h('div.repo-start', {}, connectForm(view.access.allowed), whatGoesWhere))));
}
