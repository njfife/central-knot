// Git repo page (repopage.ts): per-state (?) card matching drawn buttons, Check again when up to date (in-sight quiet note
// fading after FADE_MS, joined-check announcement and focus), and the not-connected address hover and sign-in/Managed-set words.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConnectedRepoView, RepoChange, RepoView } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
const api: { repo: (check?: boolean) => Promise<RepoView | null> } = { repo: async () => null };
const { announcement } = installDom(api as unknown as Record<string, unknown>, { byId: id => findById(rendered, id) ?? null });

const { FADE_MS, setRenderer, state: app } = await import('../src/app.ts');
const { forgetRepoPrompts, loadRepo, repo, repoPage } = await import('../src/repopage.ts');

const UP_TO_DATE_CARD = 'Nothing to pull or push. Check again asks the repo for new commits now.';
const BRANCH_GONE_CARD = 'That branch is no longer in the repo. Push puts this computer’s saved commit back as the branch.';
const URL_INFO_CARD = 'The address you’d give git clone. SSH works too: git@gitlab.com:you/agent-config.git';
const SIGN_IN_NOTE = 'Uses this computer’s git sign-in (HTTPS or SSH); never asks for a password or token.';
const MANAGED_NOTE = 'Only your Managed set goes to the repo: skills, MCP servers and agents in Central Knot (On or Off, not from plugins) and base instructions.';
const PULL_FIRST = 'The repo has changes this computer doesn’t have yet. Pull them first, then push.';

const commit = (id: string, subject = 'Update') => ({ id, subject, at: '2026-11-27T10:00:00.000Z' });
const connected = (more: Partial<ConnectedRepoView> = {}): ConnectedRepoView => ({
  connected: true,
  access: { allowed: true, reason: '' },
  url: '/tmp/example.git',
  branch: 'main',
  base: commit('1111111111111'),
  latest: commit('1111111111111'),
  checkedAt: '2026-11-27T10:00:00.000Z',
  incoming: [],
  outgoing: [],
  ...more,
});
const change = (more: Partial<RepoChange> = {}): RepoChange => ({
  key: 'review', kind: 'skill', name: 'review', change: 'changed', pull: 'moves', ...more,
});

const renderRepo = () => {
  rendered = repoPage() as unknown as FakeNode;
  return rendered;
};
const settled = async () => { for (let round = 0; round < 10; round++) await new Promise(done => setImmediate(done)); };

test('not-connected page keeps sign-in under Repo address, moves clone/SSH into its (?) card, trims Connect note, and replaces See what’s Managed', () => {
  forgetRepoPrompts(true);
  repo.view = { connected: false, access: { allowed: true, reason: '' } };
  repo.layoutOpen = true;
  const page = renderRepo();

  const url = findById(page, 'repo-url');
  assert.equal(url?.attrs['aria-describedby'], 'repo-url-below repo-url-info-card');
  assert.equal(textOf(findById(page, 'repo-url-below')), SIGN_IN_NOTE);
  assert.equal(textOf(findById(page, 'repo-url-info-card')), URL_INFO_CARD);
  assert.equal(findById(page, 'repo-connect')?.attrs.title, 'Connecting changes nothing in your tools. You choose when to Pull or Push.');
  assert.equal(textOf(page.querySelector('.repo-connect-note')), 'Connecting changes nothing in your tools.');

  const fold = textOf(findById(page, 'repo-what-goes-where'));
  assert.ok(fold.includes('skills/<folder>/'));
  assert.ok(fold.includes('instructions/base.md'));
  assert.ok(!fold.includes(SIGN_IN_NOTE), 'sign-in sentence must not repeat inside What goes where');
  assert.ok(fold.includes(MANAGED_NOTE), `expected Managed set sentence in What goes where, got: ${fold}`);
  assert.equal(findById(page, 'repo-see-library'), undefined, 'See what’s Managed link should be gone');
});

test('connected state (?) card matches the buttons actually drawn in every state, and Check again appears only when up to date', () => {
  const cases: { label: string; view: ConnectedRepoView; checking?: boolean; want: RegExp }[] = [
    { label: 'up to date', view: connected(), want: new RegExp(`^${UP_TO_DATE_CARD.replaceAll('.', '\\.')}$`) },
    { label: 'checking from up to date', view: connected(), checking: true, want: /^Asking the repo for its latest commit\. Nothing in your tools or the repo changes\.$/ },
    { label: 'checking with incoming', view: connected({ incoming: [change()], latest: commit('2222222222222'), pushBlocked: PULL_FIRST }), checking: true, want: /Nothing in your tools or the repo changes\./ },
    { label: 'held', view: connected({ held: 'plugins.json is damaged.' }), want: /Pull and Push stay paused/ },
    { label: 'unreachable', view: connected({ problem: 'Could not reach origin.' }), want: /wait until the repo can be reached/ },
    { label: 'pull only', view: connected({ incoming: [change()], latest: commit('2222222222222'), pushBlocked: PULL_FIRST }), want: /Pull brings the repo’s changes.*Nothing moves until you click Pull\./ },
    { label: 'retry only', view: connected({ incoming: [change({ pull: 'again', retry: true, held: 'busy' })] }), want: /Pull again retries.*Nothing moves until you click Pull again\./ },
    { label: 'push only', view: connected({ outgoing: [change()] }), want: /Push commits this computer’s Managed set.*Nothing moves until you click Push\./ },
    { label: 'push with branch gone', view: connected({ outgoing: [change()], branchGone: true }), want: /branch is no longer in the repo\. Push commits this computer’s Managed set/ },
    { label: 'both, push blocked', view: connected({ incoming: [change()], outgoing: [change({ key: 'notes', name: 'notes' })], latest: commit('2222222222222'), pushBlocked: PULL_FIRST }), want: /Pull brings the repo’s changes.*then Push/ },
    { label: 'both, retry with push', view: connected({ incoming: [change({ pull: 'again', retry: true, held: 'busy' })], outgoing: [change({ key: 'notes', name: 'notes' })] }), want: /Pull again retries.*Push sends/ },
    { label: 'both, retry with push and branch gone', view: connected({ incoming: [change({ pull: 'again', retry: true, held: 'busy' })], outgoing: [change({ key: 'notes', name: 'notes' })], branchGone: true }), want: /Pull again retries.*Push commits.*puts the branch back/ },
    { label: 'both, unfinished pull with branch gone and nothing to send', view: connected({ incoming: [change({ pull: 'again', retry: true, held: 'busy' })], branchGone: true }), want: /Pull again retries.*Push puts this computer’s saved commit back as the branch\./ },
    { label: 'push only, blocked by newer commit', view: connected({ outgoing: [change()], latest: commit('2222222222222'), pushBlocked: PULL_FIRST }), want: /Pull moves this computer to the repo’s latest commit first, then Push/ },
    { label: 'branch gone, nothing to send', view: connected({ branchGone: true }), want: new RegExp(`^${BRANCH_GONE_CARD.replaceAll('.', '\\.')}$`) },
    { label: 'newer commit only', view: connected({ latest: commit('2222222222222'), pushBlocked: PULL_FIRST }), want: /^The repo has a newer commit\. Pull moves this computer to it\.$/ },
    { label: 'stuck items only', view: connected({ incoming: [change({ pull: 'stuck', held: 'Bad front matter.' })] }), want: /Only items that can’t move differ/ },
  ];
  for (const { label, view, checking = false, want } of cases) {
    forgetRepoPrompts(true);
    repo.view = view;
    repo.checking = checking;
    const page = renderRepo();
    const card = textOf(findById(page, 'repo-state-info-card'));
    const pullBtn = findById(page, 'repo-pull');
    const pushBtn = findById(page, 'repo-push');
    const checkBtn = findById(page, 'repo-check');
    assert.match(card, want, `${label}: ${card}`);

    const upToDate = !view.held && !view.problem && !view.branchGone && !view.pushBlocked && !view.incoming.length && !view.outgoing.length;
    assert.equal(Boolean(checkBtn), upToDate, `${label}: Check again visibility`);

    if (view.branchGone && !view.held && !view.problem) {
      assert.ok(!textOf(page.querySelector('.repo-facts')).includes('Push puts it back'), `${label}: Repo’s latest row states only the fact`);
    }
    // Card against drawn buttons: never promise an absent Pull, Push or Check again, and name every offered one.
    if (checking) {
      assert.doesNotMatch(card, /\b(Pull|Push|Check again)\b/, `${label}: checking card promises a button: ${card}`);
    } else if (!view.held && !view.problem) {
      assert.equal(/\bPull\b/.test(card), Boolean(pullBtn), `${label}: Pull mention vs button (${card})`);
      assert.equal(/\bPush\b/.test(card), Boolean(pushBtn), `${label}: Push mention vs button (${card})`);
      assert.equal(/\bCheck again\b/.test(card), Boolean(checkBtn), `${label}: Check again mention vs button (${card})`);
    }
  }
});

test('Check again runs loadRepo(true), shows an in-sight quiet note that fades after FADE_MS, and lands focus and announcement after a joined check', async t => {
  app.page = 'repo';
  app.busy = undefined;
  setRenderer(() => { renderRepo(); });

  // Disabled when read-only.
  forgetRepoPrompts(true);
  repo.view = connected({ access: { allowed: false, reason: 'Preview only.' } });
  const roButton = findById(renderRepo(), 'repo-check');
  assert.ok(roButton, 'Check again is shown when up to date in preview');
  assert.equal(roButton.attrs.disabled, '', 'Check again is disabled when read-only');

  // Clicking Check again runs api().repo(true), disables the button while in flight, shows the in-sight note, and restores keyboard focus.
  const calls: boolean[] = [];
  let finishFetch: ((view: RepoView) => void) | undefined;
  let nextView: ConnectedRepoView = connected();
  api.repo = async check => {
    calls.push(!!check);
    if (!check) return repo.view ?? nextView;
    return await new Promise<RepoView>(resolve => { finishFetch = resolve; });
  };
  forgetRepoPrompts(true);
  repo.view = connected();
  renderRepo();
  const checkBtn = findById(rendered, 'repo-check');
  assert.ok(checkBtn);
  assert.equal(textOf(checkBtn), 'Check again');
  assert.equal(checkBtn.attrs.disabled, undefined);
  assert.equal(findById(rendered, 'repo-checked-note'), undefined, 'no quiet note before Check again is pressed');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    checkBtn.onclick!({ detail: 0 });
    await settled();
    assert.deepEqual(calls, [false, true]);
    assert.equal(repo.checking, true);
    assert.equal(findById(rendered, 'repo-check')?.attrs.disabled, '', 'Check again is disabled while checking');

    finishFetch!(connected({ checkedAt: '2026-11-27T10:05:00.000Z' }));
    await settled();
    assert.equal(repo.checking, false);
    assert.equal(announcement.textContent, 'Checked the repo: up to date.');
    assert.equal(textOf(findById(rendered, 'repo-checked-note')), 'Checked just now: nothing new.');
    assert.equal(findById(rendered, 'repo-check')?.focused, 1, 'keyboard Check again returns focus to #repo-check when still up to date');

    // Note fades after FADE_MS (matching app.ts).
    t.mock.timers.tick(FADE_MS - 1);
    assert.ok(findById(rendered, 'repo-checked-note'), 'quiet note stays until FADE_MS');
    t.mock.timers.tick(1);
    assert.equal(findById(rendered, 'repo-checked-note'), undefined, 'quiet note clears after FADE_MS');
  } finally {
    t.mock.timers.reset();
  }

  // When Check again discovers a new commit, #repo-check goes away, no quiet note shows, and keyboard focus moves to #repo-state.
  calls.length = 0;
  nextView = connected({ incoming: [change()], latest: commit('2222222222222'), pushBlocked: PULL_FIRST });
  findById(rendered, 'repo-check')!.onclick!({ detail: 0 });
  await settled();
  finishFetch!(nextView);
  await settled();
  assert.equal(findById(rendered, 'repo-check'), undefined, 'Check again disappears once changes are found');
  assert.equal(findById(rendered, 'repo-checked-note'), undefined);
  assert.equal(announcement.textContent, 'Checked the repo: 1 to pull.');
  assert.equal(findById(rendered, 'repo-state')?.focused, 1, 'keyboard Check again moves focus to #repo-state when #repo-check goes away');

  // An overlapping loadRepo(false) joining an in-flight keyboard Check again draws enabled #repo-check, announces, shows the quiet note and lands focus.
  const currentView = connected();
  api.repo = async check => {
    if (!check) return currentView;
    return await new Promise<RepoView>(resolve => { finishFetch = resolve; });
  };
  forgetRepoPrompts(true);
  repo.view = currentView;
  renderRepo();
  announcement.textContent = '';
  findById(rendered, 'repo-check')!.onclick!({ detail: 0 });
  await settled();
  assert.equal(repo.checking, true);
  const joined = loadRepo(false);
  finishFetch!(currentView);
  await joined;
  await settled();
  assert.equal(repo.checking, false);
  assert.equal(findById(rendered, 'repo-check')?.attrs.disabled, undefined);
  assert.equal(findById(rendered, 'repo-check')?.focused, 1, 'keyboard focus lands once the joining read enables #repo-check');
  assert.equal(announcement.textContent, 'Checked the repo: up to date.');
  assert.equal(textOf(findById(rendered, 'repo-checked-note')), 'Checked just now: nothing new.');
  forgetRepoPrompts(true);
});
