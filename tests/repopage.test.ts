// Git repo page (repopage.ts): per-state (?) card words, Check again when up to date (loadRepo(true), disabled while checking
// or read-only, keyboard focus kept), and the not-connected page's sign-in hint under the address field and Managed-set words.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConnectedRepoView, RepoChange, RepoView } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
const api: { repo: (check?: boolean) => Promise<RepoView | null> } = { repo: async () => null };
const { announcement } = installDom(api as unknown as Record<string, unknown>, { byId: id => findById(rendered, id) ?? null });

const { setRenderer, state: app } = await import('../src/app.ts');
const { forgetRepoPrompts, repo, repoPage } = await import('../src/repopage.ts');

const UP_TO_DATE_CARD = 'Nothing to pull or push. Pull and Push show here when the repo or this computer changes.';
const SIGN_IN_NOTE = 'Central Knot uses this computer’s git and the sign-in it already has (HTTPS or SSH). It never asks for or keeps a password or token.';
const MANAGED_NOTE = 'Only your Managed set goes to the repo: skills, MCP servers and agents in Central Knot (On or Off, not from plugins) and base instructions.';
const PULL_FIRST = 'The repo has changes this computer doesn’t have yet. Pull them first, then push.';

const commit = (id: string, subject = 'Update') => ({ id, subject, at: '2026-11-27T10:00:00.000Z' });
const connected = (more: Partial<ConnectedRepoView> = {}): ConnectedRepoView => ({
  connected: true,
  access: { allowed: true },
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
const cardText = (view: ConnectedRepoView, checking = false) => {
  forgetRepoPrompts(true);
  repo.view = view;
  repo.checking = checking;
  return textOf(findById(renderRepo(), 'repo-state-info-card'));
};
const settled = async () => { for (let round = 0; round < 10; round++) await new Promise(done => setImmediate(done)); };

test('not-connected page places the sign-in sentence under Repo address and replaces See what’s Managed with plain words', () => {
  forgetRepoPrompts(true);
  repo.view = { connected: false, access: { allowed: true } };
  repo.layoutOpen = true;
  const page = renderRepo();

  const url = findById(page, 'repo-url');
  assert.equal(url?.attrs['aria-describedby'], 'repo-url-below');
  const below = textOf(findById(page, 'repo-url-below'));
  assert.match(below, /The address you’d give git clone/);
  assert.ok(below.includes(SIGN_IN_NOTE), `expected sign-in sentence under Repo address, got: ${below}`);

  const fold = textOf(findById(page, 'repo-what-goes-where'));
  assert.ok(fold.includes('skills/<folder>/'));
  assert.ok(fold.includes('instructions/base.md'));
  assert.ok(!fold.includes(SIGN_IN_NOTE), 'sign-in sentence must not repeat inside What goes where');
  assert.ok(fold.includes(MANAGED_NOTE), `expected Managed set sentence in What goes where, got: ${fold}`);
  assert.equal(findById(page, 'repo-see-library'), undefined, 'See what’s Managed link should be gone');
});

test('connected state (?) card is worded truthfully for every repo state and never promises absent buttons', () => {
  const cases: [string, string, RegExp, RegExp?][] = [
    ['up to date', cardText(connected()), new RegExp(`^${UP_TO_DATE_CARD.replace('.', '\\.')}$`)],
    ['checking', cardText(connected(), true), /latest commit.*Nothing in your tools or the repo changes/],
    ['held', cardText(connected({ held: 'plugins.json is damaged.' })), /Pull and Push stay paused/],
    ['unreachable', cardText(connected({ problem: 'Could not reach origin.' })), /wait until the repo can be reached/],
    ['pull only', cardText(connected({ incoming: [change()], latest: commit('2222222222222'), pushBlocked: PULL_FIRST })), /Pull brings the repo’s changes.*Nothing moves until you click Pull\./, /\bPush\b/],
    ['push only', cardText(connected({ outgoing: [change()] })), /Push commits this computer’s Managed set.*Nothing moves until you click Push\./, /\bPull\b/],
    ['both, push blocked', cardText(connected({ incoming: [change()], outgoing: [change({ key: 'notes', name: 'notes' })], latest: commit('2222222222222'), pushBlocked: PULL_FIRST })), /Pull brings the repo’s changes.*then Push/],
    ['both, retry with push', cardText(connected({ incoming: [change({ pull: 'again', retry: true, held: 'busy' })], outgoing: [change({ key: 'notes', name: 'notes' })] })), /Pull again retries.*Push sends/],
    ['push only, blocked by newer commit', cardText(connected({ outgoing: [change()], latest: commit('2222222222222'), pushBlocked: PULL_FIRST })), /Pull moves this computer to the repo’s latest commit first, then Push/],
    ['branch gone', cardText(connected({ branchGone: true })), /branch is no longer in the repo.*Push recreates it/],
    ['newer commit only', cardText(connected({ latest: commit('2222222222222'), pushBlocked: PULL_FIRST })), /newer commit.*Pull moves this computer/],
    ['stuck items only', cardText(connected({ incoming: [change({ pull: 'stuck', held: 'Bad front matter.' })] })), /Only items that can’t move differ/],
  ];
  for (const [label, got, want, forbid] of cases) {
    assert.match(got, want, `${label}: ${got}`);
    if (forbid) assert.doesNotMatch(got, forbid, `${label} should not match ${forbid}: ${got}`);
    assert.ok(got !== PULL_FIRST, `${label} should not repeat PULL_FIRST verbatim`);
    const sentences = got.split(/[.!?](?:\s+|$)/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${label} card should be <=2 sentences: ${got}`);
  }
});

test('Check again appears only when up to date, is disabled while checking or read-only, calls loadRepo(true), and keeps keyboard focus', async () => {
  app.page = 'repo';
  app.busy = undefined;
  setRenderer(() => { renderRepo(); });

  // Absent whenever the page is not up to date.
  const hidden: [string, ConnectedRepoView][] = [
    ['incoming change', connected({ incoming: [change()] })],
    ['outgoing change', connected({ outgoing: [change()] })],
    ['branch gone', connected({ branchGone: true })],
    ['newer commit', connected({ latest: commit('2222222222222'), pushBlocked: PULL_FIRST })],
    ['unreachable', connected({ problem: 'Offline.' })],
    ['held', connected({ held: 'Damaged plugins.json.' })],
    ['stuck only', connected({ incoming: [change({ pull: 'stuck', held: 'Bad.' })] })],
  ];
  for (const [label, view] of hidden) {
    forgetRepoPrompts(true);
    repo.view = view;
    assert.equal(findById(renderRepo(), 'repo-check'), undefined, `Check again must not show when ${label}`);
  }

  // Disabled when read-only.
  forgetRepoPrompts(true);
  repo.view = connected({ access: { allowed: false, reason: 'Preview only.' } });
  const roButton = findById(renderRepo(), 'repo-check');
  assert.ok(roButton, 'Check again is shown when up to date in preview');
  assert.equal(roButton.attrs.disabled, '', 'Check again is disabled when read-only');

  // Clicking Check again runs api().repo(true), disables the button while in flight, announces the result, and restores keyboard focus.
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

  checkBtn.onclick!({ detail: 0 });
  await settled();
  assert.deepEqual(calls, [false, true]);
  assert.equal(repo.checking, true);
  assert.equal(findById(rendered, 'repo-check')?.attrs.disabled, '', 'Check again is disabled while checking');

  finishFetch!(connected({ checkedAt: '2026-11-27T10:05:00.000Z' }));
  await settled();
  assert.equal(repo.checking, false);
  assert.equal(announcement.textContent, 'Checked the repo: up to date.');
  assert.equal(findById(rendered, 'repo-check')?.focused, 1, 'keyboard Check again returns focus to #repo-check when still up to date');

  // When Check again discovers a new commit, #repo-check goes away and keyboard focus moves to #repo-state.
  calls.length = 0;
  nextView = connected({ incoming: [change()], latest: commit('2222222222222'), pushBlocked: PULL_FIRST });
  findById(rendered, 'repo-check')!.onclick!({ detail: 0 });
  await settled();
  finishFetch!(nextView);
  await settled();
  assert.equal(findById(rendered, 'repo-check'), undefined, 'Check again disappears once changes are found');
  assert.equal(announcement.textContent, 'Checked the repo: 1 to pull.');
  assert.equal(findById(rendered, 'repo-state')?.focused, 1, 'keyboard Check again moves focus to #repo-state when #repo-check goes away');
});
