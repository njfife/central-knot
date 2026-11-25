// Sessions page controls and heading marks (sessionspage.ts, app.ts switchSessionCosts): repeat clicks on Start or Stop
// while a save is pending do nothing and disable the control, announcements fire once only for a change made, and a priced
// heading total with nothing to explain renders no info mark.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DayRows } from '../src/sessionrow.ts';
import type { HomeView, SessionCostsView } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

const pending: { home: string; on: boolean; resolve: (view: SessionCostsView) => void }[] = [];
let onChanged: ((view: SessionCostsView) => void) | undefined;
let rendered: FakeNode | undefined;

const api = {
  setKeepSessionCosts: (home: string, on: boolean) =>
    new Promise<SessionCostsView>(resolve => pending.push({ home, on, resolve })),
  onSessionCostsChanged: (listener: (view: SessionCostsView) => void) => { onChanged = listener; },
  onNavigate() {},
  onSettingsChanged() {},
  onSyncChanged() {},
  onSaid() {},
  getSettings: async () => null,
};

installDom(api);

await import('../src/settingspage.ts');
const { setRenderer, state, switchSessionCosts } = await import('../src/app.ts');
const { sessionsPage } = await import('../src/sessionspage.ts');

const settled = async () => { for (let i = 0; i < 15; i++) await new Promise(done => setImmediate(done)); };

const fakeHome = (on: boolean, seq = 1): HomeView => ({
  home: '/tmp/fake-sessions-home',
  readId: 1,
  sync: { present: ['claude-cli'] },
  sessionCosts: { home: '/tmp/fake-sessions-home', on, collecting: false, seq },
} as unknown as HomeView);

const redraw = () => { rendered = sessionsPage(state.home!) as unknown as FakeNode; };
setRenderer(redraw);

test('two clicks at once on Stop keeping disable the button while pending, send one request and announce once', async () => {
  pending.length = 0;
  state.home = fakeHome(true, 1);
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = { state: 'ready', data: undefined, gen: 0 };
  redraw();

  const stopBefore = findById(rendered, 'sessions-keep-stop')!;
  assert.ok(stopBefore);
  const seqBefore = state.said.seq;

  // Two clicks at once (simulating a double-click before the save completes, even via the original button reference).
  stopBefore.click();
  const stopWhilePending = findById(rendered, 'sessions-keep-stop');
  assert.equal('disabled' in (stopWhilePending?.attrs ?? {}), true, 'Stop keeping is disabled while saving');
  stopWhilePending?.click();
  stopBefore.onclick?.({ stopPropagation() {} });

  assert.equal(pending.length, 1, 'only one setKeepSessionCosts request is sent');
  assert.equal(pending[0]!.on, false);

  const next: SessionCostsView = { home: state.home.home, on: false, collecting: false, seq: 2 };
  onChanged?.(next);
  pending.shift()!.resolve(next);
  await settled();

  assert.equal(state.home.sessionCosts?.on, false);
  assert.equal(state.said.text, 'Stopped keeping session costs for this home.');
  assert.equal(state.said.quiet, false);
  assert.equal(state.said.seq - seqBefore, 1, 'Stop sentence is announced once');
  const startAfter = findById(rendered, 'sessions-keep-start');
  assert.ok(startAfter);
  assert.equal('disabled' in startAfter.attrs, false, 'Start button is enabled once save ends');
});

test('two clicks at once on Start keeping disable both controls while pending and leave keeping on afterwards', async () => {
  pending.length = 0;
  state.home = fakeHome(false, 2);
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = { state: 'ready', data: undefined, gen: 0 };
  redraw();

  const startBefore = findById(rendered, 'sessions-keep-start')!;
  assert.ok(startBefore);
  const seqBefore = state.said.seq;

  startBefore.click();
  const startWhilePending = findById(rendered, 'sessions-keep-start');
  assert.equal('disabled' in (startWhilePending?.attrs ?? {}), true, 'Start keeping is disabled while saving');
  startWhilePending?.click();

  // Even if keeper news arrives first and swaps Start for Stop before the save promise resolves, Stop stays disabled and ignores clicks.
  const next: SessionCostsView = { home: state.home.home, on: true, collecting: false, seq: 3 };
  onChanged?.(next);
  const stopWhilePending = findById(rendered, 'sessions-keep-stop');
  assert.equal('disabled' in (stopWhilePending?.attrs ?? {}), true, 'Stop keeping stays disabled until Start finishes');
  stopWhilePending?.click();
  stopWhilePending?.onclick?.({ stopPropagation() {} });

  assert.equal(pending.length, 1, 'only one setKeepSessionCosts request is sent');
  assert.equal(pending[0]!.on, true);

  pending.shift()!.resolve(next);
  await settled();

  assert.equal(state.home.sessionCosts?.on, true, 'keeping stays on afterwards');
  assert.equal(state.said.text, 'Keeping session costs for this home.');
  assert.equal(state.said.seq - seqBefore, 1, 'Start sentence is announced once');
});

test('switchSessionCosts announces nothing when no change was made', async () => {
  pending.length = 0;
  state.home = fakeHome(false, 4);
  const seqBefore = state.said.seq;

  const done = switchSessionCosts(false);
  assert.equal(pending.length, 1);
  pending.shift()!.resolve({ home: state.home.home, on: false, collecting: false, seq: 4 });
  await done;

  assert.equal(state.said.seq, seqBefore, 'no announcement when keeping was already off');
});

test('a priced heading total with no price dates, unread faults or one-hour cache writes renders no total info mark', () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const emptyTokens = { input: 1000, cacheRead: 0, cacheWrite: 0, output: 100 };
  const cost = {
    dollars: 0.5,
    unpriced: 0,
    unpricedBy: { noRow: 0, speedOrTier: [], other: 0 },
    oneHourLow: false,
    atLeast: false,
    pricedAs: [],
    providers: [],
  };
  const reading = (ratesDates: string[]): DayRows => ({
    period: { start, end: start + 86_400_000 },
    ratesDates,
    rows: [],
    total: { sessions: 1, tokens: emptyTokens, cost },
    byTool: [{ tool: 'claude-cli', sessions: 1, tokens: emptyTokens, cost, unread: false }],
    byModel: [],
  });

  state.home = fakeHome(false, 5);
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = { state: 'ready', data: reading([]), gen: 1 };
  const withoutDates = sessionsPage(state.home) as unknown as FakeNode;
  assert.match(textOf(withoutDates), /≈ \$0\.50 at API prices/);
  assert.equal(findById(withoutDates, 'sessions-total-info'), undefined, 'no total info mark when nothing to explain');
  assert.equal(findById(withoutDates, 'sessions-unpriced-info'), undefined);

  state.sessions = { state: 'ready', data: reading(['2026-11-24']), gen: 2 };
  const withDate = sessionsPage(state.home) as unknown as FakeNode;
  assert.ok(findById(withDate, 'sessions-total-info'), 'total info mark appears when a price date is supplied');
});
