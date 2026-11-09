// Git repo: the Managed set kept in a git repo (GitHub, GitLab or any git server), with Pull to bring the repo's changes into the
// tools and Push to send this computer's. The page says which repo and commit are in use, when it last pulled and pushed, and
// what differs each way; nothing moves until Pull or Push is clicked.
import { busy, rerender, showPage, state } from './app.ts';
import { button, closeButton, emptyState, h, icon, middle } from './dom.ts';
import type { IconName } from './icons.ts';
import { outcomeBand } from './matrix.ts';
import { plural } from './model.ts';
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

/** Reads the repo's view; `check` then asks the repo for its latest commit, showing the view meanwhile. */
export async function loadRepo(check = false): Promise<void> {
  try { repo.view = (await api().repo(false)) ?? undefined; } catch { repo.view = undefined; }
  rerender();
  if (!check || !repo.view?.connected || !repo.view.access.allowed) return;
  repo.checking = true;
  rerender();
  try { repo.view = (await api().repo(true)) ?? repo.view; } catch { /* the view already shown stands */ }
  repo.checking = false;
  rerender();
}

/** After a write: the page and the home both read again, so every page shows what Pull or Push left on disk. */
async function settle(result: RepoResult, done: string, history = false) {
  repo.view = result.view;
  repo.problem = result.stopped;
  repo.confirmDisconnect = false;
  const home = await api().refresh();
  if (home) state.home = home;
  if (!result.stopped) state.outcome = { page: 'repo', text: done, history };
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
  await settle(result, count ? `Pulled ${plural(count, 'change')} into your tools. Each is in History, with Undo.` : 'Pulled. Nothing in your tools needed to change.', count > 0);
});

const push = () => busy('Pushing to the repo…', async () => {
  const result = await api().pushRepo(state.home!.home);
  await settle(result, result.pushed ? `Pushed as ${result.pushed.id.slice(0, 7)} “${result.pushed.subject}”.` : 'Pushed.');
});

const disconnect = () => busy('Disconnecting…', async () => {
  const result = await api().disconnectRepo(state.home!.home);
  await settle(result, 'Disconnected. Your tools and the repo are as they were.');
});

// ---------- Pieces ----------

const kinds: Record<RepoChange['kind'], { glyph: IconName; label: string }> = {
  skill: { glyph: 'wand-sparkles', label: 'Skill' },
  mcp: { glyph: 'plug', label: 'MCP server' },
  agent: { glyph: 'bot', label: 'Agent' },
  base: { glyph: 'pencil-line', label: 'Instructions' },
};

const when = (iso?: string) => {
  if (!iso) return undefined;
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return `today at ${time}`;
  if (date.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return `yesterday at ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })} at ${time}`;
};

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
  const tone = change.held ? 'tone-warning' : change.alsoHere || change.keptHere ? 'tone-accent' : 'tone-muted';
  return h(`li.repo-row${change.held ? '.repo-row-held' : ''}`, { 'data-key': change.key },
    h('span.repo-row-icon', { title: kind.label }, icon(kind.glyph, 14, 'tone-muted')),
    h('span.repo-row-main', {},
      h('span.repo-row-line', {}, h('strong.repo-row-name', { title: change.name }, change.name), h('span.repo-row-kind', {}, kind.label)),
      note ? h(`span.repo-row-note.${tone}`, {}, change.held ? icon('triangle-alert', 12) : null, note) : null),
    h(`span.repo-row-change.repo-change-${change.change}`, {}, label));
}

function changeList(id: string, title: string, changes: RepoChange[], side: 'in' | 'out', action: HTMLElement | null, empty: string) {
  return h('section.repo-side', { 'aria-labelledby': id },
    h('div.repo-side-head', {}, h('h2.eyebrow', { id }, title, h('span.eyebrow-count', {}, String(changes.length))), action),
    changes.length ? h('ul.repo-list', {}, changes.map(change => changeRow(change, side))) : h('p.repo-empty-side', {}, empty));
}

/** The state in one line: up to date, what waits each way, or that the repo couldn't be reached. */
function summary(view: Extract<RepoView, { connected: true }>): { glyph: IconName; tone: string; text: string } {
  if (repo.checking) return { glyph: 'refresh-cw', tone: 'tone-muted spin', text: 'Checking the repo…' };
  if (view.problem) return { glyph: 'circle-alert', tone: 'tone-danger', text: 'Couldn’t reach the repo' };
  const incoming = view.incoming.filter(change => !change.held).length;
  const outgoing = view.outgoing.filter(change => !change.held).length;
  if (!incoming && !outgoing) return { glyph: 'circle-check', tone: 'tone-success', text: 'Up to date with the repo' };
  return { glyph: 'git-branch', tone: 'tone-accent', text: [incoming ? `${incoming} to pull` : '', outgoing ? `${outgoing} to push` : ''].filter(Boolean).join(' · ') };
}

function connectedPage(view: Extract<RepoView, { connected: true }>) {
  const state0 = summary(view);
  const pullable = view.incoming.filter(change => !change.held).length;
  const pushable = view.outgoing.filter(change => !change.held).length;
  const locked = !!state.busy || !view.access.allowed;
  const pullButton = view.incoming.length ? button({ variant: pullable ? 'primary' : 'outline', size: 'small', icon: 'arrow-down-to-line', label: pullable ? `Pull ${pullable}` : 'Pull', id: 'repo-pull', disabled: locked || repo.checking || !view.latest,
    attrs: { title: 'Bring the repo’s changes into your tools. Each one goes into History, with Undo.' }, onclick: () => void pull() }) : null;
  const pushButton = pushable ? button({ variant: view.pushBlocked ? 'outline' : 'primary', size: 'small', icon: 'arrow-up-from-line', label: `Push ${pushable}`, id: 'repo-push', disabled: locked || repo.checking || !!view.pushBlocked,
    attrs: { title: view.pushBlocked ?? `Commit the Managed set as it is here to ${view.branch} and push it.` }, onclick: () => void push() }) : null;
  const latestDiffers = view.latest && view.latest.id !== view.base?.id;
  return h('div.page.repo-page', {},
    h('div.toolbar.repo-toolbar', {},
      h(`span.repo-state`, { id: 'repo-state', role: 'status' }, icon(state0.glyph, 14, state0.tone), h('span', {}, state0.text)),
      h('span.toolbar-spacer'),
      button({ variant: 'ghost', size: 'small', icon: 'unplug', label: 'Disconnect…', id: 'repo-disconnect', disabled: locked || repo.confirmDisconnect, onclick: () => { repo.confirmDisconnect = true; rerender(); document.getElementById('repo-disconnect-confirm')?.focus(); } })),
    h('div.bands', {},
      view.access.allowed ? null : h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, view.access.reason)),
      repo.confirmDisconnect ? h('div.band.repo-confirm', { role: 'alert' }, icon('unplug', 14, 'tone-muted'),
        h('span.band-text', {}, 'Disconnect from this repo? Your tools and the repo stay as they are; Central Knot forgets its copy and what it last pulled.'),
        button({ variant: 'outline', size: 'small', label: 'Disconnect', id: 'repo-disconnect-confirm', disabled: !!state.busy, onclick: () => void disconnect() }),
        button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'repo-disconnect-cancel', onclick: () => { repo.confirmDisconnect = false; rerender(); } })) : null,
      problemBand(view.problem && !repo.problem ? `Couldn’t reach the repo when checking${view.checkedAt ? ` ${when(view.checkedAt)}` : ''}: ${view.problem}` : undefined),
      outcomeBand()),
    h('div.scroll.repo-scroll', { id: 'repo-scroll' },
      h('section.repo-where', { 'aria-label': 'Repo' },
        h('div.repo-address', {}, icon('git-branch', 16, 'tone-muted'), middle(view.url, 24, 'mono repo-url'), h('span.repo-branch', { title: 'Branch' }, view.branch)),
        h('dl.facts.repo-facts', {},
          h('dt', {}, 'In use here'), h('dd', {}, view.base ? commitText(view.base) : h('span.tone-muted', {}, 'Nothing pulled or pushed yet')),
          h('dt', {}, 'Repo’s latest'), h('dd', {}, !view.latest ? h('span.tone-muted', {}, 'The repo is empty') : latestDiffers ? h('span.repo-latest', {}, commitText(view.latest), h('span.repo-new', {}, 'not pulled yet')) : h('span.tone-muted', {}, 'The same commit')),
          h('dt', {}, 'Last pulled'), h('dd', {}, when(view.pulledAt) ?? h('span.tone-muted', {}, 'Never')),
          h('dt', {}, 'Last pushed'), h('dd', {}, when(view.pushedAt) ?? h('span.tone-muted', {}, 'Never')),
          h('dt', {}, 'Last checked'), h('dd', {}, repo.checking ? h('span.tone-muted', {}, 'Checking now…') : when(view.checkedAt) ?? h('span.tone-muted', {}, 'Not yet')))),
      h('div.repo-sides', {},
        changeList('repo-incoming', 'From the repo', view.incoming, 'in', pullButton, view.latest ? 'Nothing new in the repo.' : 'The repo is empty. Push to put your Managed set in it.'),
        changeList('repo-outgoing', 'From this computer', view.outgoing, 'out', pushButton, 'Nothing here that the repo doesn’t have.')),
      view.pushBlocked && pushable ? h('p.repo-aside', {}, icon('info', 12, 'tone-muted'), view.pushBlocked) : null,
      h('p.repo-aside', {}, 'Pull and Push use this computer’s git and the sign-in it already has. Only Managed skills, MCP servers and agents go to the repo; other files there stay as they are.')));
}

function problemBand(text: string | undefined) {
  const shown = repo.problem ?? text;
  if (!shown) return null;
  return h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', {}, shown),
    repo.problem ? closeButton(() => { repo.problem = undefined; rerender(); }, { id: 'repo-problem-dismiss' }) : null);
}

/** The repo's layout, shown before connecting so people can set one up by hand or know what Push will make. */
const layout = () => h('dl.repo-layout', { 'aria-label': 'What goes where in the repo' },
  h('dt.mono', {}, 'skills/<folder>/'), h('dd', {}, 'one folder per skill, byte for byte'),
  h('dt.mono', {}, 'mcp/<name>.json'), h('dd', {}, 'one MCP server, in Claude Code’s shape'),
  h('dt.mono', {}, 'agents/<name>.md'), h('dd', {}, 'one agent, in Claude Code’s format'),
  h('dt.mono', {}, 'instructions/base.md'), h('dd', {}, 'the base instructions'));

function connectForm(allowed: boolean) {
  const ready = () => !state.busy && allowed && !!repo.draftUrl.trim();
  const go = () => { if (ready()) void connect(); };
  const refresh = () => { const control = document.getElementById('repo-connect') as HTMLButtonElement | null; if (control) control.disabled = !ready(); };
  const field = (id: string, label: string, placeholder: string, value: string, set: (text: string) => void, hint?: string) => h('div.repo-field', {},
    h('label.market-add-label', { for: id }, label, hint ? h('span.repo-field-hint', {}, hint) : null),
    h('input.market-add-input', { id, type: 'text', placeholder, value, spellcheck: 'false', autocomplete: 'off', disabled: !!state.busy || !allowed,
      oninput: (event: Event) => { set((event.target as HTMLInputElement).value); refresh(); }, onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') go(); } }));
  return h('div.repo-connect', {},
    field('repo-url', 'Repo address', 'https://github.com/you/agent-config.git or git@gitlab.com:you/agent-config.git', repo.draftUrl, text => { repo.draftUrl = text; }),
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
      'Your Managed skills, MCP servers, agents and base instructions can live in any git repo: GitHub, GitLab or a server of your own. Pull brings the repo’s changes into your tools; Push sends yours.',
      h('div.repo-start', {}, connectForm(view.access.allowed), layout(),
        h('p.empty-aside', {}, 'Central Knot uses this computer’s git and the sign-in it already has (HTTPS or SSH). It never asks for or keeps a password or token.',
          ' ', h('button.inline-link', { type: 'button', id: 'repo-see-skills', onclick: () => showPage('skills') }, 'See what’s Managed'), '.')))));
}
