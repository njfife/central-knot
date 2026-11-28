import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { atMostEvery, caughtUpNames, holdingBuild, oneTurn, plural, timeAgo, timeOrDate, timesApart } from '../src/model.ts';

test('plural words read naturally', () => {
  assert.equal(plural(1, 'copy', 'copies'), '1 copy');
  assert.equal(plural(3, 'copy', 'copies'), '3 copies');
  assert.equal(plural(0, 'skill'), '0 skills');
});

test('The Caught up band names each item written once, of any kind, with the tools it went to, a skill and an agent of one name apart; an item a notice tells on its own kind, and a write that waits, are left out', () => {
  const caughtUp = [
    { item: 'review', harness: 'codex-cli', outcome: 'written', of: 'skills' },
    { item: 'review', harness: 'pi-cli', outcome: 'written', of: 'skills' },
    { item: 'docs', harness: 'pi-cli', outcome: 'written', of: 'mcp' },
    { item: 'docs', harness: 'claude-cli', outcome: 'held', waits: true, of: 'mcp' },
    { item: 'reviewer', harness: 'codex-cli', outcome: 'written', of: 'agents' },
    { item: 'review', harness: 'codex-cli', outcome: 'written', of: 'agents' },
    { item: 'notes', harness: 'codex-cli', outcome: 'removed', of: 'skills' },
  ];
  const told = (item: string) => [{ kind: 'edit', item }];
  const view = (notices: { skills?: object[]; mcp?: object[]; agents?: object[] }) =>
    ({ sync: { caughtUp }, skills: { notices: notices.skills ?? [] }, mcp: { notices: notices.mcp ?? [] }, agents: { notices: notices.agents ?? [] } }) as unknown as Parameters<typeof caughtUpNames>[0];
  // The skill review and the agent review are two items, each named with its kind, as a run's words name them (words.ts rowNames).
  assert.deepEqual(caughtUpNames(view({})), { items: ['review (skill)', 'docs', 'reviewer', 'review (agent)'], tools: ['codex-cli', 'pi-cli'] });
  // reviewer's edit is told by an agents notice, docs's by an MCP servers one: neither is named again.
  assert.deepEqual(caughtUpNames(view({ agents: told('reviewer'), mcp: told('docs') })), { items: ['review (skill)', 'review (agent)'], tools: ['codex-cli', 'pi-cli'] });
  // A skills notice for review tells the skill only: the agent review is still named, now on its own.
  assert.deepEqual(caughtUpNames(view({ skills: told('review') })), { items: ['docs', 'reviewer', 'review'], tools: ['pi-cli', 'codex-cli'] });
});

test('Every row of a list says its time in one form: how long ago while that tells them apart, else the clock, to the second where two would match', () => {
  const ten = new Date(); ten.setHours(10, 0, 5, 0);
  const plus = (seconds: number) => new Date(ten.getTime() + seconds * 1000).toISOString(), now = ten.getTime() + 3600_000;
  // All today and apart: how long ago.
  assert.deepEqual(timesApart([plus(3540), plus(60), plus(3590)], now), ['1 min ago', '59 min ago', 'just now']);
  // 10:00:05 and 9:50:05 would both read "1 h ago", and 10:00:05 and 10:00:40 both "10:00": every row to the second.
  const close = timesApart([plus(0), plus(35), plus(-600)], now);
  assert.ok(close.every(time => /\d:\d\d:\d\d/.test(time)), close.join(' | '));
  assert.notEqual(close[0], close[1]);
  // A row from yesterday: the clock for every row; the versions list (withDay) names that day, History (under day headings) does not.
  const yesterday = new Date(ten.getTime() - 86_400_000 - 3600_000).toISOString();
  const [todayRow, dayRow] = timesApart([plus(0), yesterday], now, true);
  assert.ok(/^\d+:\d\d\D/.test(todayRow) && !/\d:\d\d:\d\d/.test(todayRow), todayRow);
  assert.match(dayRow, /^yesterday at \d+:\d\d\D/);
  assert.doesNotMatch(timesApart([plus(0), yesterday], now)[1], /yesterday/);
});

test('How long ago floors minutes and hours at each boundary', () => {
  const now = new Date(2026, 10, 22, 12, 0, 0, 0).getTime();
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  assert.deepEqual(
    [30, 59, 60, 90, 59 * 60, 60 * 60, 119 * 60].map(seconds => timeAgo(ago(seconds), now)),
    ['just now', 'just now', '1 min ago', '1 min ago', '59 min ago', '1 h ago', '1 h ago'],
  );
});

test('A kept time says its clock time on the day it was kept, and its date on any day after', () => {
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  const before = new Date(today);
  before.setDate(today.getDate() - 1);
  assert.match(timeOrDate(today.toISOString()), /^\d+:\d\d\D/);
  assert.equal(timeOrDate(before.toISOString()), before.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  assert.doesNotMatch(timeOrDate(before.toISOString()), /\d:\d\d/);
});

test('What holds this build, one install at a time: nothing is written before the first look answers, then the first other build found holds it; none found, or whether one is here can’t be told, holds nothing', () => {
  const alpha = { build: 'com.centralknot.alpha', name: 'Central Knot Alpha', installed: '/Applications/Central Knot Alpha.app' };
  const acme = { build: 'com.centralknot.custom.acme', name: 'Acme Knot', running: ['/Users/me/Downloads/Acme Knot.app'] };
  assert.equal(holdingBuild('unlooked'), 'unlooked', 'before the first look answers: held');
  assert.equal(holdingBuild([alpha, acme]), alpha);
  assert.equal(holdingBuild([]), undefined, 'none found');
  assert.equal(holdingBuild(undefined), undefined, 'can’t be told (an Applications folder that can’t be read): not held');
});

test('At most once every few seconds: the first call runs at once, a burst after it runs once at the end of that time, and a call after a quiet spell runs at once again', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  try {
    const runs: number[] = [];
    const call = atMostEvery(5_000, () => runs.push(Date.now()));
    const at = (ms: number) => mock.timers.tick(ms - Date.now());
    call();
    for (const ms of [1_000, 2_000, 4_900]) { at(ms); call(); }
    at(5_000);
    assert.deepEqual(runs, [0, 5_000], 'three calls within the five seconds: one run, at their end');
    at(9_000); call();
    at(10_000);
    assert.deepEqual(runs, [0, 5_000, 10_000], 'a call while the last run’s five seconds last waits for their end');
    at(30_000); call();
    assert.deepEqual(runs, [0, 5_000, 10_000, 30_000], 'after a quiet spell, at once');
    at(40_000);
    assert.deepEqual(runs, [0, 5_000, 10_000, 30_000], 'nothing owed, nothing run');
  } finally { mock.timers.reset(); }
});

test('One turn waiting in the queue stands for every ask made meanwhile; an ask once it has begun queues one more (main.ts: the background pass)', async () => {
  // A queue like main.ts's, held at first as a long pass holds it.
  let release!: () => void, queue: Promise<unknown> = new Promise<void>(done => { release = done; });
  const queued = (work: () => Promise<void>) => { const next = queue.then(work); queue = next.catch(() => undefined); return next; };
  const drained = async () => { for (let last = queue; ; last = queue) { await last; if (last === queue) return; } };
  let runs = 0, askWhileRunning = false;
  const ask = oneTurn(queued, async () => { runs++; if (askWhileRunning) { askWhileRunning = false; ask(); } });
  ask(); ask(); ask();
  release(); await drained();
  assert.equal(runs, 1, 'three asks while one turn waits: one run');
  askWhileRunning = true; ask(); await drained();
  assert.equal(runs, 3, 'an ask while its work runs: one more run after it');
  ask(); await drained();
  assert.equal(runs, 4, 'and once nothing waits, an ask runs again');
});
