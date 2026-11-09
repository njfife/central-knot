// Git repo: the Managed set kept in a git repo (GitHub, GitLab or any git server), with Pull to bring the repo's changes into the
// tools and Push to send this computer's. The page says which repo and commit are in use, when it last pulled and pushed, and
// what differs each way; nothing moves until Pull or Push is clicked.
import { busy, rerender, showPage, state } from './app.ts';
import { button, closeButton, emptyState, h, icon, middle } from './dom.ts';
import type { IconName } from './icons.ts';
import { outcomeBand } from './matrix.ts';
import { dayAndTime, plural } from './model.ts';
import { andList, toolName } from './words.ts';
import type { RepoChange, RepoCommit, RepoResult, RepoView } from './types.ts';

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

/** Reads the repo's view; `check` then asks the repo for its latest commit, showing the view meanwhile. */
/** The check (fetch) in flight, if any: a load that overtakes it waits for this one rather than starting another. */
let inFlight: Promise<RepoView | null> | undefined;

export async function loadRepo(check = false): Promise<void> {
  const turn = ++loads;
  // A check already in flight is joined, never started again: once it ends, this load reads the page as it then is.
  if (inFlight) { check = false; await inFlight.catch(() => undefined); }
  let view: RepoView | undefined;
  try { view = (await api().repo(false)) ?? undefined; } catch { view = undefined; }
  if (turn !== loads) return;
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
  rerender();
}

/** After a write: the page and the home both read again, so every page shows what Pull or Push left on disk. */
async function settle(result: RepoResult, done: string, note?: string) {
  repo.view = result.view;
  repo.problem = result.stopped;
  repo.confirmDisconnect = false;
  const home = await api().refresh();
  if (home) state.home = home;
  if (!result.stopped) state.outcome = { page: 'repo', text: done, note };
}

const connect = () => busy('Connecting to the repo…', async () => {
  const result = await api().connectRepo(repo.draftUrl, repo.draftBranch, state.home!.home);
  const view = result.view;
  const waiting = view.connected ? view.incoming.filter(change => !change.held).length : 0;
  await settle(result, `Connected. Nothing changed in your tools${waiting ? `; Pull brings in ${plural(waiting, 'item')} from the repo` : ''}.`);
  if (!result.stopped) { repo.draftUrl = ''; repo.draftBranch = ''; }
});

const pull = () => busy('Pulling from the repo…', async () => {
  const result = await api().pullRepo(state.home!.home);
  const count = result.pulled ?? 0;
  // Claude Code's MCP settings wait for Write to Claude Code on purpose (the MCP servers page offers it); anything else a tool
  // didn't take is said in the result, by tool.
  const missed = result.results.filter(entry => entry.harness && (entry.outcome === 'failed' || entry.outcome === 'held'))
    .map(entry => `${entry.item} didn’t reach ${toolName(entry.harness!)} (${entry.message.replace(/\.$/, '')})`);
  const waiting = result.waitsForClaude ?? [];
  const text = count ? `Pulled ${plural(count, 'change')} into your tools.` : 'Pulled. Nothing in your tools needed to change.';
  const rest = [missed.length ? `${missed.slice(0, 3).join('; ')}${missed.length > 3 ? `; and ${missed.length - 3} more` : ''}.` : '',
    waiting.length ? `Claude Code doesn’t have ${andList(waiting)} yet: close Claude Code, then click Write to Claude Code on MCP servers.` : ''].filter(Boolean);
  // One wording for the promise, always with History one click away.
  await settle(result, [text, ...rest].join(' '), count ? `Undo ${count === 1 ? 'it' : 'any of them'} in History.` : undefined);
  if (waiting.length && state.outcome) state.outcome.act = { label: 'Open MCP servers', id: 'repo-go-mcp', run: () => showPage('mcp') };
});

const push = () => busy('Pushing to the repo…', async () => {
  const result = await api().pushRepo(state.home!.home);
  await settle(result, result.pushed ? `Pushed as ${result.pushed.id.slice(0, 7)} “${result.pushed.subject}”.` : 'Pushed.');
});

const disconnect = () => busy('Disconnecting…', async () => {
  // The address stays in the form, so connecting again is one click.
  const last = repo.view?.connected ? { url: repo.view.url, branch: repo.view.branch } : undefined;
  const result = await api().disconnectRepo(state.home!.home);
  if (last && !result.stopped) { repo.draftUrl = last.url; repo.draftBranch = last.branch; }
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

/** A commit as people read it in a git client: short id, subject, when. */
const commitText = (commit: RepoCommit) => h('span.repo-commit', { title: `${commit.id}\n${commit.subject}` },
  h('span.mono.repo-sha', {}, commit.id.slice(0, 7)), commit.subject ? h('span.repo-subject', {}, commit.subject) : null,
  commit.at ? h('span.tone-muted.repo-when', {}, when(commit.at)) : null);

/** What happened to one item on the side it comes from, and what Pull or Push will do about it. */
function changeRow(change: RepoChange, side: 'in' | 'out') {
  const kind = kinds[change.kind];
  const label = side === 'in'
    ? { added: 'New in the repo', changed: 'Changed in the repo', removed: 'Removed in the repo' }[change.change]
    : { added: 'New here', changed: 'Changed here', removed: 'Removed here' }[change.change];
  const note = change.held ? (side === 'in' ? `Can’t come in: ${change.held}` : `Stays out of the repo: ${change.held}`)
    : change.alsoHere === 'removed' ? 'Removed here, or no longer Managed, but changed in the repo, so Pull brings it back.'
    : change.alsoHere ? `Changed here too. Pull uses the repo’s version; yours stays in History.`
    : change.keptHere ? 'Removed in the repo but changed here, so it stays, and Push puts it back.'
    : side === 'in' && change.change === 'removed' ? 'Pull deletes it from your tools. History can restore it.'
    : side === 'out' && change.change === 'removed' ? 'Deleted here or no longer Managed. Push removes it from the repo.'
    : undefined;
  // Only what can't come in is said in full warning colour; a both-changed note is safe (History keeps yours), so its icon warns, not its words.
  const tone = change.held ? 'tone-warning' : 'tone-muted';
  const noteGlyph: IconName = change.held || change.alsoHere ? 'triangle-alert' : 'info';
  return h(`li.repo-row${change.held ? '.repo-row-held' : ''}`, { 'data-key': change.key },
    h('span.repo-row-icon', { title: kind.label }, icon(kind.glyph, 14, 'tone-muted')),
    h('span.repo-row-main', {},
      h('span.repo-row-line', {}, h('strong.repo-row-name', { title: change.name }, change.name), h('span.repo-row-kind', {}, kind.label),
        h(`span.repo-row-change.repo-change-${change.held ? 'held' : change.change}`, {}, label)),
      note ? h(`span.repo-row-note.${tone}`, {}, icon(noteGlyph, 12, change.alsoHere && !change.held ? 'tone-warning' : ''), note) : null));
}

/** One direction: its items, the button that moves them, and (when that button can't run) why, right under it. */
function changeList(id: string, title: string, changes: RepoChange[], side: 'in' | 'out', action: HTMLElement | null, empty: string, blocked?: string) {
  // The button carries the count of what moves; items that can't move are counted beside the title.
  const stuck = changes.filter(change => change.held && !change.retry).length;
  return h('section.repo-side', { 'aria-labelledby': id },
    // Title, its button, then what can't move: the button stays put whatever is held.
    h('div.repo-side-head', {}, h('h2.eyebrow', { id }, title), action, stuck ? h('span.repo-stuck-count', {}, `${stuck} can’t ${side === 'in' ? 'come in' : 'go'}`) : null),
    blocked ? h('p.repo-side-note', { id: `${id}-blocked` }, icon('triangle-alert', 12, 'tone-warning'), blocked) : null,
    changes.length ? h('ul.repo-list', {}, changes.map(change => changeRow(change, side))) : h('p.repo-empty-side', {}, empty));
}

/** Changes waiting each way, leaving out items that can't move. */
export const waiting = (view: Extract<RepoView, { connected: true }>) => ({ pull: view.incoming.filter(change => !change.held).length, push: view.outgoing.filter(change => !change.held).length });

/** The state in one line: up to date, what waits each way, or that the repo couldn't be reached. */
function summary(view: Extract<RepoView, { connected: true }>): HTMLElement {
  const part = (glyph: IconName, tone: string, text: string) => h('span.repo-state-part', {}, icon(glyph, 14, tone), h('span', {}, text));
  const { pull: incoming, push: outgoing } = waiting(view);
  const stuck = [...view.incoming, ...view.outgoing].filter(change => change.held).length;
  const counts = [incoming ? part('arrow-down-to-line', 'tone-accent', `${incoming} to pull`) : null, outgoing ? part('arrow-up-from-line', 'tone-accent', `${outgoing} to push`) : null];
  const parts = repo.checking ? [part('refresh-cw', 'tone-muted spin', 'Checking the repo…')]
    : view.problem ? [part('circle-alert', 'tone-danger', 'Couldn’t reach the repo'), ...counts]
    : !incoming && !outgoing && stuck ? [part('triangle-alert', 'tone-warning', `Up to date, except ${plural(stuck, 'item')} that can’t move`)]
    : !incoming && !outgoing ? [part('circle-check', 'tone-success', 'Up to date with the repo')]
    : counts;
  return h('span.repo-state', { id: 'repo-state', role: 'status' }, parts);
}

/** While the repo can't be reached: said once, above both lists, and named by both buttons. */
const WAITING_ID = 'repo-waiting';

function connectedPage(view: Extract<RepoView, { connected: true }>) {
  const { pull: pullable, push: pushable } = waiting(view);
  const locked = !!state.busy || !view.access.allowed;
  // While the repo can't be reached, Pull and Push wait for Try again (in the band) rather than fail the same way.
  const moving = locked || repo.checking || !!view.problem;
  // Held items whose fault is in the repo can't be pulled at all; only those the last Pull couldn't finish are worth another try.
  const retryable = view.incoming.filter(change => change.retry).length;
  // A newer commit that changes nothing here still has to be pulled before a push: Pull then just moves to it.
  const pullButton = pullable || retryable || view.pushBlocked ? button({ variant: pullable && !view.problem ? 'primary' : 'outline', size: 'small', icon: 'arrow-down-to-line', label: pullable ? `Pull ${pullable}` : retryable ? 'Try again' : 'Pull', id: 'repo-pull', disabled: moving || !view.latest,
    attrs: view.problem ? { 'aria-describedby': WAITING_ID } : { title: 'Bring the repo’s changes into your tools. Each one goes into History, with Undo.' }, onclick: () => void pull() }) : null;
  // The branch gone from the repo: Push puts it back even with nothing else to send.
  const pushButton = pushable || view.branchGone ? button({ variant: view.pushBlocked || view.problem ? 'outline' : 'primary', size: 'small', icon: 'arrow-up-from-line', label: pushable ? `Push ${pushable}` : 'Push', id: 'repo-push', disabled: moving || !!view.pushBlocked,
    attrs: view.problem ? { 'aria-describedby': WAITING_ID } : view.pushBlocked ? { 'aria-describedby': 'repo-outgoing-blocked' } : { title: `Commit the Managed set as it is here to ${view.branch} and push it.` }, onclick: () => void push() }) : null;
  const latestDiffers = view.latest && view.latest.id !== view.base?.id;
  const inSync = !view.incoming.length && !view.outgoing.length;
  // Each part stays whole when the row wraps, so a narrow window breaks at a dot, never inside a time.
  const checked = repo.checking ? 'checking now…' : `checked ${when(view.checkedAt) ?? 'not yet'}${view.problem ? ' (couldn’t reach it)' : ''}`;
  // Only what has happened: right after Connect that is just the check.
  const parts = [view.pulledAt ? `pulled ${when(view.pulledAt)}` : '', view.pushedAt ? `pushed ${when(view.pushedAt)}` : '', checked].filter(Boolean);
  // Each separator belongs to the part after it, so a wrapped line starts with "·", never ends with one.
  const activity = parts.flatMap((text, index) => [index ? ' ' : '', h('span.repo-activity-part', {}, index ? `· ${text}` : text.charAt(0).toUpperCase() + text.slice(1))]);
  return h('div.page.repo-page', {},
    h('div.toolbar.repo-toolbar', {},
      summary(view),
      h('span.toolbar-spacer'),
      button({ variant: 'ghost', size: 'small', icon: 'unplug', label: 'Disconnect…', id: 'repo-disconnect', disabled: locked || repo.confirmDisconnect, onclick: () => { repo.confirmDisconnect = true; rerender(); document.getElementById('repo-disconnect-confirm')?.focus(); } })),
    h('div.bands', {},
      view.access.allowed ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.access.reason)),
      repo.confirmDisconnect ? h('div.band.repo-confirm', { role: 'alert' }, icon('unplug', 14, 'tone-muted'),
        h('span.band-text', {}, 'Disconnect? Your tools and the repo stay as they are.'),
        button({ variant: 'outline', size: 'small', label: 'Disconnect', id: 'repo-disconnect-confirm', disabled: !!state.busy, onclick: () => void disconnect() }),
        button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'repo-disconnect-cancel', onclick: () => { repo.confirmDisconnect = false; rerender(); } })) : null,
      // When the cause is the address itself, say how to change it (only by connecting again).
      problemBand(view.problem && !repo.problem && !repo.checking ? `${view.problem}${/no repository there/i.test(view.problem) ? ' To use another address, Disconnect and connect again.' : ''}` : undefined),
      outcomeBand()),
    h('div.scroll.repo-scroll', { id: 'repo-scroll' },
      h('section.repo-where', { 'aria-label': 'Repo' },
        h('div.repo-address', {}, icon('git-branch', 16, 'tone-muted'), middle(view.url, 24, 'mono repo-url'), h('span.repo-branch', { title: 'Branch' }, view.branch)),
        h('dl.facts.repo-facts', {},
          h('dt', {}, 'This computer is at'), h('dd', {}, view.base ? commitText(view.base) : h('span.tone-muted', {}, 'Nothing pulled or pushed yet')),
          h('dt', {}, view.problem ? 'Repo, last seen' : 'Repo’s latest'), h('dd', {}, view.branchGone ? h('span.tone-warning', {}, `The repo no longer has the branch ${view.branch}. Push puts it back.`) : !view.latest ? h('span.tone-muted', {}, 'The repo is empty') : latestDiffers ? h('span.repo-latest', {}, commitText(view.latest), h('span.repo-new', {}, 'not pulled yet')) : h('span.tone-muted', {}, 'The same commit')),
          h('dt', {}, 'Activity'), h('dd', {}, h('span.repo-activity', {}, activity)))),
      view.problem ? h('p.repo-stale', { id: WAITING_ID }, icon('info', 12), `What differs is from the last time the repo could be reached${view.latest ? '' : ' (never, so far)'}; Pull and Push wait until it can be reached again.`) : null,
      inSync && view.branchGone ? h('div.repo-in-sync', {}, h('span', {}, `Nothing else differs. Push puts the branch ${view.branch} back in the repo.`), pushButton)
        : inSync && view.pushBlocked ? h('div.repo-in-sync', {}, h('span', {}, 'The repo has a newer commit that changes nothing in your Managed set. Pull to move to it.'), pullButton)
        : inSync ? h('p.repo-in-sync', {}, 'Nothing to pull or push. Changes made in the repo or here show up on this page.')
        : h('div.repo-sides', {},
          changeList('repo-incoming', 'From the repo', view.incoming, 'in', pullButton, view.latest ? 'Nothing new in the repo.' : 'The repo is empty. Push to put your Managed set in it.'),
          changeList('repo-outgoing', 'From this computer', view.outgoing, 'out', pushButton, 'Nothing here that the repo doesn’t have.', pushable && !view.problem ? view.pushBlocked : undefined)),
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
      oninput: (event: Event) => { set((event.target as HTMLInputElement).value); refresh(); }, onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') go(); } }),
    below ? h('span.repo-field-below', { id: `${id}-below` }, below) : null);
  const sshHint = h('span', {}, 'The address you’d give git clone. SSH works too: ', h('span.mono', {}, 'git@gitlab.com:you/agent-config.git'));
  return h('div.repo-connect', {},
    field('repo-url', 'Repo address', 'https://github.com/you/agent-config.git', repo.draftUrl, text => { repo.draftUrl = text; }, undefined, sshHint),
    field('repo-branch', 'Branch', 'The repo’s default branch', repo.draftBranch, text => { repo.draftBranch = text; }, 'optional'),
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
