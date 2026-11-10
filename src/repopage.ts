// Git repo: the Managed set kept in a git repo (GitHub, GitLab or any git server), with Pull to bring the repo's changes into the
// tools and Push to send this computer's. The page says which repo and commit are in use, when it last pulled and pushed, and
// what differs each way; nothing moves until Pull or Push is clicked.
import { announce, busy, rerender, showPage, state } from './app.ts';
import { button, closeButton, emptyState, h, icon } from './dom.ts';
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
};

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

/** Reads the repo's view; `check` then asks the repo for its latest commit, showing the view meanwhile. */
export async function loadRepo(check = false): Promise<void> {
  const turn = ++loads;
  wantCheck ||= check;
  // A check already in flight is joined, never started again: once it ends, this load reads the page as it then is.
  const joined = inFlight;
  if (joined) await joined.catch(() => undefined);
  let view: RepoView | undefined;
  try { view = (await api().repo(false)) ?? undefined; } catch { view = undefined; }
  if (turn !== loads) return;
  check = wantCheck && !joined;
  wantCheck = false;
  repo.view = view;
  if (!inFlight) repo.checking = false;
  rerender();
  if (!check || !view?.connected || !view.access.allowed) return;
  repo.checking = true;
  rerender();
  inFlight = api().repo(true).finally(() => { inFlight = undefined; });
  try { view = (await inFlight) ?? view; } catch { /* the view already shown stands */ }
  // A load that started meanwhile joined this check and shows its result, "Checking…" ended.
  if (turn !== loads) return;
  repo.view = view;
  repo.checking = false;
  // What the check found, in the status bar, so it never disagrees with the page.
  if (view?.connected && state.page === 'repo') {
    const { pull: toPull, push: toPush, retry } = waitingCounts(view);
    announce(view.problem ? 'Couldn’t reach the repo.' : toPull || toPush || retry ? `Checked the repo: ${[toPull ? `${toPull} to pull` : '', toPush ? `${toPush} to push` : '', retry ? `${retry} to pull again` : ''].filter(Boolean).join(', ')}.`
      : view.branchGone ? 'Checked the repo: its branch is gone.' : view.pushBlocked ? 'Checked the repo: a newer commit to pull.' : 'Checked the repo: up to date.');
  }
  rerender();
}

/** After a write: the page and the home both read again, so every page shows what Pull or Push left on disk. */
async function settle(result: RepoResult, done: string, note?: string, warn?: boolean) {
  repo.view = result.view;
  repo.problem = result.stopped;
  repo.confirmDisconnect = false;
  const home = await api().refresh();
  if (home) state.home = home;
  if (!result.stopped) state.outcome = { page: 'repo', text: done, note, warn };
  // The status bar's "…ing" ends with the action: said quietly, since the band above already shows it.
  announce(result.stopped ?? done, true);
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
const pullNow = () => busy('Pulling from the repo…', async () => {
  const result = await api().pullRepo(state.home!.home);
  const count = result.pulled ?? 0;
  // Claude Code's MCP settings wait for Write to Claude Code on purpose (the MCP servers page offers it); anything else a tool
  // didn't take is said in the result, by tool.
  const missed = result.results.filter(entry => entry.harness && (entry.outcome === 'failed' || entry.outcome === 'held'))
    .map(entry => `${entry.item} didn’t reach ${toolName(entry.harness!)} (${entry.message.replace(/\.$/, '')})`);
  const claudeWaits = result.waitsForClaude ?? [];
  // Items Pull couldn't finish are listed below with why; the band says so rather than sound finished.
  const left = result.view.connected ? waitingCounts(result.view).retry : 0;
  const text = count ? `Pulled ${plural(count, 'change')} into your tools.` : left ? '' : 'Pulled. Nothing in your tools needed to change.';
  const rest = [left ? `${plural(left, 'item')} couldn’t come in yet; ${left === 1 ? 'its row says' : 'their rows say'} why.` : '', missed.length ? `${missed.slice(0, 3).join('; ')}${missed.length > 3 ? `; and ${missed.length - 3} more` : ''}.` : '',
    claudeWaits.length ? `To add ${andList(claudeWaits)} to Claude Code, close Claude Code, then click Write to Claude Code on MCP servers.` : ''].filter(Boolean);
  // One wording for the promise, always with History one click away.
  await settle(result, [text, ...rest].filter(Boolean).join(' '), count ? `Undo ${count === 1 ? 'it' : `any of the ${count}`} in History.` : undefined, left > 0);
  if (claudeWaits.length && state.outcome) state.outcome.act = { label: 'Open MCP servers', id: 'repo-go-mcp', run: () => showPage('mcp') };
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

const disconnect = () => busy('Disconnecting…', async () => {
  // The address stays in the form, so connecting again is one click.
  const last = repo.view?.connected ? { url: repo.view.url, branch: repo.view.branch } : undefined;
  const result = await api().disconnectRepo(state.home!.home);
  if (last && !result.stopped) repo.draftUrl = last.url;
  await settle(result, 'Disconnected. Your tools and the repo are as they were.');
});

// ---------- Pieces ----------

const kinds: Record<RepoChange['kind'], { glyph: IconName; label: string }> = {
  skill: { glyph: 'wand-sparkles', label: 'Skill' },
  mcp: { glyph: 'plug', label: 'MCP server' },
  agent: { glyph: 'bot', label: 'Agent' },
  base: { glyph: 'pencil-line', label: 'Instructions' },
};

const when = (iso?: string) => (iso ? dayAndTime(iso) : undefined);

/** A commit as people read it in a git client: short id, subject, when (real spaces between, so it reads and copies as one line). */
const commitText = (commit: RepoCommit) => h('span.repo-commit', { title: `${commit.id}\n${commit.subject}` },
  h('span.mono.repo-sha', {}, commit.id.slice(0, 7)), commit.subject ? [' ', h('span.repo-subject', {}, commit.subject)] : null,
  commit.at ? [' ', h('span.tone-muted.repo-when', {}, when(commit.at))] : null);

/** What happened to one item on the side it comes from, and what Pull or Push will do about it. */
function changeRow(change: RepoChange, side: 'in' | 'out') {
  const kind = kinds[change.kind];
  const label = side === 'in'
    ? { added: 'New in the repo', changed: 'Changed in the repo', removed: 'Removed in the repo' }[change.change]
    : { added: 'New here', changed: 'Changed here', removed: 'Removed here' }[change.change];
  // Held from the repo: Push never touches it there (unless it was only waiting on the last Pull, which Pull retries).
  // Held: what can't happen is said in warning colour; the why, in the note's own soft ink.
  // (One span, so the note's flex row keeps lead and reason as one wrapping sentence.)
  const heldLead = (lead: string, rest: string) => h('span', {}, h('span.tone-warning', {}, lead), ` ${rest}`);
  const syncOn = !!state.home?.syncOn;
  const note = change.held ? (side === 'out' ? heldLead('Stays out of the repo.', change.held)
    // A deletion waiting for Automatic sync is said as things stand now, not as they were at the Pull.
    : change.waitsForSync ? heldLead('Didn’t come in yet.', syncOn ? 'Automatic sync is on now: Pull again.' : 'Its deletion waits for Automatic sync (at the bottom): turn it on, then Pull again.')
    : change.retry ? heldLead('Didn’t come in yet.', change.held) : heldLead('Can’t come in.', `${change.held} Push leaves it in the repo as it is.`))
    : change.alsoHere === 'removed' ? 'Removed here, or no longer Managed, but changed in the repo, so Pull brings it back.'
    : change.alsoHere === 'unmanaged' ? `${/^[aeiou]|^MCP/i.test(kind.label) ? 'An' : 'A'} ${kind.label.replace(/^[A-Z][a-z]/, word => word.toLowerCase())} named ${change.name} is already in your tools, not Managed. Pull replaces it; yours stays in History.`
    : change.alsoHere ? `Changed here too. Pull uses the repo’s version; yours stays in History.`
    : change.keptHere ? 'Removed in the repo but changed here, so it stays, and Push puts it back.'
    // With Automatic sync off, Pull can't spread an MCP server's or agent's deletion (skills have Delete everywhere).
    : side === 'in' && change.change === 'removed' && !syncOn && (change.kind === 'mcp' || change.kind === 'agent') ? 'Automatic sync is off, so Pull leaves it in your tools until sync is on.'
    : side === 'in' && change.change === 'removed' ? 'Pull deletes it from your tools. History can restore it.'
    : side === 'out' && change.change === 'removed' ? 'Deleted here or no longer Managed. Push removes it from the repo.'
    : undefined;
  // The note is in soft ink; a held or both-changed one has a warning icon (a both-changed one is safe: History keeps yours).
  const warns = !!change.held || !!change.alsoHere;
  return h(`li.repo-row${stuckRow(change) ? '.repo-row-held' : ''}`, { 'data-key': change.key },
    h('span.repo-row-icon', { title: kind.label }, icon(kind.glyph, 14, 'tone-muted')),
    h('span.repo-row-main', {},
      // Kind and change stay together, so a long name that wraps carries them as one.
      h('span.repo-row-line', {}, h('strong.repo-row-name', { title: change.name }, change.name), h('span.repo-row-meta', {}, h('span.repo-row-kind', {}, kind.label),
        h(`span.repo-row-change.repo-change-${stuckRow(change) ? 'held' : change.change}`, {}, label))),
      note ? h('span.repo-row-note.tone-muted', {}, icon(warns ? 'triangle-alert' : 'info', 12, warns ? 'tone-warning' : ''), note) : null));
}

/** One direction: its items, the button that moves them, and (when that button can't run) why, right under it. */
/** An item its button won't move: held, and not just waiting to be tried again. */
const stuckRow = (change: RepoChange) => !!change.held && !change.retry;

function changeList(id: string, title: string, changes: RepoChange[], side: 'in' | 'out', action: HTMLElement | null, empty: string, blocked?: string) {
  // The button carries the count of what moves; items that can't move are counted beside the title.
  const stuck = changes.filter(stuckRow).length;
  return h('section.repo-side', { 'aria-labelledby': id },
    // Title, its button, then what can't move: the button stays put whatever is held.
    // With no button there, the rows just below say it.
    h('div.repo-side-head', {}, h('h2.eyebrow', { id }, title), action, stuck && action ? h('span.repo-stuck-count', {}, icon('triangle-alert', 12, 'tone-warning'), `${stuck} can’t ${side === 'in' ? 'come in' : 'go'}`) : null),
    blocked ? h('p.repo-side-note', { id: `${id}-blocked` }, icon('triangle-alert', 12, 'tone-warning'), blocked) : null,
    // What can't move comes last, so the list reads top-down as what the button does, then what stays.
    changes.length ? h('ul.repo-list', {}, [...changes].sort((first, second) => Number(stuckRow(first)) - Number(stuckRow(second))).map(change => changeRow(change, side)))
      : h('p.repo-empty-side', {}, empty));
}

/** Changes waiting each way, leaving out items that can't move; `retry`: items the last Pull couldn't finish, which Pull tries again. */
export const waitingCounts = (view: ConnectedRepoView) => ({ pull: view.incoming.filter(change => !change.held).length, push: view.outgoing.filter(change => !change.held).length,
  retry: view.incoming.filter(change => change.retry).length });

/** "The same commit", and what of it hasn't come in (held, or left by the last Pull), so the facts stay true. */
function sameCommitText(view: ConnectedRepoView): string {
  const missing = view.incoming.filter(change => change.held).length;
  return missing ? `The same commit. ${plural(missing, 'item')} in it ${missing === 1 ? 'hasn’t' : 'haven’t'} come in.` : 'The same commit';
}

/** Push's count as the toolbar and status bar say it: waiting on Pull when Push can't run yet. */
const pushCountText = (view: ConnectedRepoView, count: number) => (view.pushBlocked ? `${count} to push after Pull` : `${count} to push`);

/** Items that can't move, in the same words as their list: "can't come in" from the repo, "can't go" from here. */
function stuckText(view: ConnectedRepoView): string {
  const cantCome = view.incoming.filter(stuckRow).length;
  const cantGo = view.outgoing.filter(stuckRow).length;
  return [cantCome ? `${cantCome} can’t come in` : '', cantGo ? `${cantGo} can’t go` : ''].filter(Boolean).join(', ');
}

/** The state in one line: up to date, what waits each way, or that the repo couldn't be reached. */
function summary(view: ConnectedRepoView): HTMLElement {
  const part = (glyph: IconName, tone: string, text: string, muted = false) => h(`span.repo-state-part${muted ? '.tone-muted' : ''}`, {}, icon(glyph, 14, tone), h('span', {}, text));
  const { pull: incoming, push: outgoing, retry } = waitingCounts(view);
  const stuckNote = stuckText(view);
  // While the repo can't be reached, the counts are what was last seen: said quietly, as neither button can act on them.
  const waiting = !!view.problem;
  const counts = [incoming ? part('arrow-down-to-line', waiting ? 'tone-muted' : 'tone-accent', `${incoming} to pull`, waiting) : null,
    outgoing ? part('arrow-up-from-line', view.pushBlocked || waiting ? 'tone-muted' : 'tone-accent', pushCountText(view, outgoing), !!view.pushBlocked || waiting) : null,
    retry ? part('arrow-down-to-line', waiting ? 'tone-muted' : 'tone-accent', `${retry} to pull again`, waiting) : null,
    stuckNote ? part('triangle-alert', 'tone-warning', stuckNote, true) : null];
  // Up to date only when nothing waits: a newer commit that changes nothing here still has to be pulled before a push.
  const settled = view.branchGone ? part('triangle-alert', 'tone-warning', 'The repo’s branch is gone')
    : view.pushBlocked ? part('arrow-down-to-line', 'tone-accent', 'A newer commit to pull')
    : stuckNote ? part('circle-check', 'tone-success', 'Nothing else to pull or push')
    : part('circle-check', 'tone-success', 'Up to date with the repo');
  const parts = repo.checking ? [part('refresh-cw', 'tone-muted spin', 'Checking the repo…')]
    // Unreachable: what can't move is said beside each list; the line keeps to the problem and the counts.
    : view.problem ? [part('circle-alert', 'tone-danger', 'Couldn’t reach the repo'), ...counts.slice(0, 3)]
    : !incoming && !outgoing && !retry ? [counts[3], settled]
    : counts;
  // Focusable, so focus has somewhere to land when the button just used goes away (nothing left to pull or push).
  return h('span.repo-state', { id: 'repo-state', role: 'status', tabindex: '-1' }, parts);
}

/** While the repo can't be reached: said once, above both lists, and named by both buttons. */
const WAITING_ID = 'repo-waiting';

/**
 * Pull: shown when something can come in, an unfinished item can be tried again, or a newer commit changes nothing here (Pull then
 * just moves to it). Items whose fault is in the repo can't be pulled at all.
 */
function pullButton(view: ConnectedRepoView, pullable: number, moving: boolean) {
  const retryable = view.incoming.filter(change => change.retry).length;
  if (!pullable && !retryable && !view.pushBlocked) return null;
  return button({
    variant: view.problem ? 'outline' : 'primary', size: 'small', icon: 'arrow-down-to-line', id: 'repo-pull', disabled: moving || !view.latest,
    // Pull also tries again what the last one couldn't finish, so those count too.
    label: pullable ? `Pull ${pullable + retryable}` : retryable ? 'Pull again' : 'Pull',
    attrs: view.problem ? { 'aria-describedby': WAITING_ID } : { title: 'Bring the repo’s changes into your tools. Each one goes into History, with Undo.' },
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

function connectedPage(view: ConnectedRepoView) {
  const { pull: pullable, push: pushable } = waitingCounts(view);
  const locked = !!state.busy || !view.access.allowed;
  // While the repo can't be reached, Pull and Push wait for Try again (in the band) rather than fail the same way.
  const moving = locked || repo.checking || !!view.problem;
  const pullControl = pullButton(view, pullable, moving);
  const pushControl = pushButton(view, pushable, moving);
  const latestDiffers = view.latest && view.latest.id !== view.base?.id;
  const inSync = !view.incoming.length && !view.outgoing.length;
  const checked = repo.checking ? 'checking now…' : `checked ${when(view.checkedAt) ?? 'not yet'}${view.problem ? ' (couldn’t reach it)' : ''}`;
  // Only what has happened: right after Connect that is just the check.
  const parts = [view.pulledAt ? `pulled ${when(view.pulledAt)}` : '', view.pushedAt ? `pushed ${when(view.pushedAt)}` : '', checked].filter(Boolean);
  // One sentence; each part stays whole and keeps its comma, so a wrapped line breaks after a comma, never inside a time.
  const activity = parts.flatMap((text, index) => [index ? ' ' : '', h('span.repo-activity-part', {}, `${index ? text : text.charAt(0).toUpperCase() + text.slice(1)}${index < parts.length - 1 ? ',' : ''}`)]);
  return h('div.page.repo-page', {},
    h('div.toolbar.repo-toolbar', {},
      summary(view),
      h('span.toolbar-spacer'),
      // While the question is open it stands in for this button, so the button steps aside rather than sit there dimmed.
      repo.confirmDisconnect ? null : button({ variant: 'ghost', size: 'small', icon: 'unplug', label: 'Disconnect…', id: 'repo-disconnect', disabled: locked, onclick: () => { repo.confirmDisconnect = true; rerender(); document.getElementById('repo-disconnect-confirm')?.focus(); } })),
    h('div.bands', {},
      view.access.allowed ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.access.reason)),
      repo.confirmDisconnect ? h('div.band.repo-confirm', { role: 'alert' }, icon('unplug', 14, 'tone-muted'),
        h('span.band-text', {}, 'Disconnect? Your tools and the repo stay as they are.'),
        button({ variant: 'outline', size: 'small', label: 'Disconnect', id: 'repo-disconnect-confirm', disabled: !!state.busy, onclick: () => void disconnect() }),
        button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'repo-disconnect-cancel', onclick: cancelDisconnect })) : null,
      problemBand(view.problem && !repo.problem && !repo.checking ? view.problem : undefined),
      outcomeBand()),
    h('div.scroll.repo-scroll', { id: 'repo-scroll' },
      h('section.repo-where', { 'aria-label': 'Repo' },
        h('div.repo-address', {}, icon('git-branch', 16, 'tone-muted'), h('span.repo-address-text', {}, h('span.mono.repo-url', {}, view.url), h('span.repo-branch', { title: 'Branch' }, view.branch))),
        h('dl.facts.repo-facts', {},
          h('dt', {}, 'This computer is at'), h('dd', {}, view.base ? commitText(view.base) : h('span.tone-muted', {}, 'Nothing pulled or pushed yet')),
          h('dt', {}, view.problem ? 'Repo, last seen' : 'Repo’s latest'), h('dd', {}, view.branchGone ? h('span.tone-warning', {}, `The repo no longer has the branch ${view.branch}. Push puts it back.`) : !view.latest ? h('span.tone-muted', {}, 'The repo is empty') : latestDiffers ? h('span.repo-latest', {}, commitText(view.latest), h('span.repo-new', {}, 'not pulled yet')) : h('span.tone-muted', {}, sameCommitText(view))),
          h('dt', {}, 'Activity'), h('dd', {}, h('span.repo-activity', {}, activity)))),
      view.problem ? h('p.repo-stale', { id: WAITING_ID }, icon('info', 12), `${view.latest ? 'These lists are from the last time the repo was reached' : 'The repo hasn’t been reached yet'}; Pull and Push wait until it can be.`) : null,
      inSync && view.branchGone ? h('div.repo-in-sync', {}, h('span', {}, `Nothing else differs. Push puts the branch ${view.branch} back in the repo.`), pushControl)
        : inSync && view.pushBlocked ? h('div.repo-in-sync', {}, h('span', {}, 'The repo has a newer commit that changes nothing in your Managed set. Pull to move to it.'), pullControl)
        : inSync ? h('p.repo-in-sync', {}, 'Refresh checks the repo for new commits.')
        : h('div.repo-sides', {},
          changeList('repo-incoming', 'From the repo', view.incoming, 'in', pullControl, view.latest ? 'Nothing new in the repo.' : 'The repo is empty. Push to put your Managed set in it.'),
          changeList('repo-outgoing', 'From this computer', view.outgoing, 'out', pushControl, 'Nothing here that the repo doesn’t have.', pushable && !view.problem ? view.pushBlocked : undefined)),
      h('p.repo-aside', {}, `Only Managed ${carried(view.withBase)} go to the repo; other files there stay as they are.`)));
}

/** What stopped the last action (dismissable), or why the repo couldn't be reached (with Try again). */
function problemBand(unreachable: string | undefined) {
  const shown = repo.problem ?? unreachable;
  if (!shown) return null;
  return h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', {}, shown),
    repo.problem ? closeButton(() => { repo.problem = undefined; rerender(); }, { id: 'repo-problem-dismiss' })
      : button({ variant: 'outline', size: 'small', icon: 'refresh-cw', label: 'Try again', id: 'repo-try-again', disabled: !!state.busy, onclick: () => void loadRepo(true) }));
}

/** What goes to the repo, as words: base instructions only in a build that has them. */
const carried = (withBase: boolean) => (withBase ? 'skills, MCP servers, agents and base instructions' : 'skills, MCP servers and agents');

/** The repo's layout, shown before connecting so people can set one up by hand or know what Push will make. */
const layout = (withBase: boolean) => h('dl.repo-layout', { 'aria-label': 'What goes where in the repo' },
  h('dt.mono', {}, 'skills/<folder>/'), h('dd', {}, 'one folder per skill, byte for byte'),
  h('dt.mono', {}, 'mcp/<name>.json'), h('dd', {}, 'one MCP server, in Claude Code’s shape'),
  h('dt.mono', {}, 'agents/<name>.md'), h('dd', {}, 'one agent, in Claude Code’s format'),
  withBase ? [h('dt.mono', {}, 'instructions/base.md'), h('dd', {}, 'the base instructions')] : null);

function connectForm(allowed: boolean) {
  const ready = () => !state.busy && allowed && !!repo.draftUrl.trim();
  const go = () => { if (ready()) void connect(); };
  const refresh = () => { const control = document.getElementById('repo-connect') as HTMLButtonElement | null; if (control) control.disabled = !ready(); };
  const field = (id: string, label: string, placeholder: string, value: string, set: (text: string) => void, hint?: string, below?: Node) => h('div.repo-field', {},
    h('label.market-add-label', { for: id }, label, hint ? h('span.repo-field-hint', {}, hint) : null),
    h('input.market-add-input', { id, type: 'text', placeholder, value, spellcheck: 'false', autocomplete: 'off', disabled: !!state.busy || !allowed, 'aria-describedby': below ? `${id}-below` : undefined,
      'aria-invalid': repo.problem && id === `repo-${repo.problemField}` ? 'true' : undefined,
      // Typing a new address or branch answers the last failure: its band goes.
      oninput: (event: Event) => { set((event.target as HTMLInputElement).value); if (repo.problem) { repo.problem = undefined; rerender(); } refresh(); }, onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') go(); } }),
    below ? h('span.repo-field-below', { id: `${id}-below` }, below) : null);
  const sshHint = h('span', {}, 'The address you’d give git clone. SSH works too: ', h('span.mono', {}, 'git@gitlab.com:you/agent-config.git'));
  return h('div.repo-connect', {},
    // The address takes the width; the branch, one word, sits beside it when there is room.
    h('div.repo-fields', {},
      field('repo-url', 'Repo address', 'https://github.com/you/agent-config.git', repo.draftUrl, text => { repo.draftUrl = text; }, undefined, sshHint),
      field('repo-branch', 'Branch', 'Default branch', repo.draftBranch, text => { repo.draftBranch = text; }, 'optional')),
    h('div.repo-connect-actions', {}, button({ variant: 'primary', size: 'small', icon: 'git-branch', label: 'Connect', id: 'repo-connect', disabled: !ready(), onclick: go }),
      h('span.repo-connect-note', {}, 'Connecting changes nothing in your tools. You choose when to Pull or Push.')));
}

export function repoPage(): HTMLElement {
  const view = repo.view;
  if (!view) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading…' : 'The repo could not be read.')));
  if (view.connected) return connectedPage(view);
  return h('div.page.repo-page', {},
    h('div.bands', {}, view.access.allowed ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.access.reason)), problemBand(undefined), outcomeBand()),
    h('div.scroll', { id: 'repo-scroll' }, emptyState('git-branch', 'Keep your Managed set in a git repo',
      `Your Managed ${carried(view.withBase)} can live in any git repo: GitHub, GitLab or a server of your own. Pull brings the repo’s changes into your tools; Push sends yours.`,
      h('div.repo-start', {}, connectForm(view.access.allowed),
        h('div.repo-start-side', {}, h('h2.eyebrow', {}, 'What goes where'), layout(view.withBase),
          h('p.empty-aside', {}, 'Central Knot uses this computer’s git and the sign-in it already has (HTTPS or SSH). It never asks for or keeps a password or token.'),
          h('p.empty-aside', {}, 'Only what’s Managed goes to the repo. ', h('button.inline-link', { type: 'button', id: 'repo-see-skills', onclick: () => showPage('skills') }, 'See what’s Managed'), '.'))))));
}
