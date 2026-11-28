// Sessions page controls, wording and heading/row structure (sessionspage.ts, settingspage.ts, app.ts switchSessionCosts):
// repeat clicks on Start or Stop while a save is pending do nothing and disable the control, announcements fire once only for
// a change made, keep control updates its card opening between off and on without naming "collection", unpriced-only totals name
// the reason without repeating unread history, column cells keep dollar amounts apart from qualifiers, one-hour fallback notes
// the shorter cache or input rate, rows derive nested agent counts with no order cue, aliases use disjoint ids, and open-row
// reported figures drop "for this session".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CostSum, DayRows, PeriodRows, SessionRow } from '../src/sessionrow.ts';
import type { HomeView, SessionCostsView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

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

const { SESSION_COSTS_KEPT } = await import('../src/settingspage.ts');
const { setRenderer, state, switchSessionCosts } = await import('../src/app.ts');
const { sessionsPage } = await import('../src/sessionspage.ts');

const findAll = (node: unknown, match: (el: FakeNode) => boolean): FakeNode[] => {
  if (!node || typeof node !== 'object') return [];
  const el = node as FakeNode;
  return [...(el.tag && match(el) ? [el] : []), ...(el.children ?? []).flatMap(child => findAll(child, match))];
};
const hasClass = (el: FakeNode, name: string) => el.className.split(/\s+/).includes(name);

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

const blankTokens = { input: 1000, cacheRead: 0, cacheWrite: 0, output: 100 };
const makeCost = (more: Partial<CostSum> = {}): CostSum => ({
  dollars: 0.5, unpriced: 0, unpricedBy: { noRow: 0, speedOrTier: [], other: 0 },
  oneHourLow: false, atLeast: false, pricedAs: [], providers: [], ...more,
});
const todayStart = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); };
const makeRow = (session: string, more: Partial<SessionRow> = {}): SessionRow => {
  const start = todayStart(), cost = more.cost ?? makeCost();
  return {
    tool: 'claude-cli', session, project: 'notes', first: start + 1000, last: start + 2000,
    tokens: blankTokens, models: [], cost, withChildren: { tokens: blankTokens, cost }, children: [], ...more,
  };
};
const renderDay = (home: HomeView, data: DayRows | PeriodRows, day: 'today' | 'week' = 'today', gen = 3): FakeNode => {
  state.home = home;
  state.page = 'sessions';
  state.sessionsDay = day;
  state.sessions = { state: 'ready', data, gen };
  return sessionsPage(home) as unknown as FakeNode;
};

test('keep control updates its button and card opening between off and on, sharing SESSION_COSTS_KEPT without naming "collection"', () => {
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = { state: 'ready', data: undefined, gen: 0 };

  const off = sessionsPage(fakeHome(false, 6)) as unknown as FakeNode;
  assert.equal(textOf(findById(off, 'sessions-keep-start')), 'Keep costs for a 7-day view');
  assert.equal(findById(off, 'sessions-keep-start')!.attrs['aria-describedby'], 'sessions-keep-info-card');
  assert.equal(textOf(findById(off, 'sessions-keep-info-card')), `Adds a 7-day view here, keeping ${SESSION_COSTS_KEPT}`);

  const on = sessionsPage(fakeHome(true, 7)) as unknown as FakeNode;
  assert.equal(textOf(findById(on, 'sessions-keep-stop')), 'Stop keeping');
  assert.equal(findById(on, 'sessions-keep-stop')!.attrs['aria-describedby'], 'sessions-keep-info-card');
  assert.ok(findById(on, 'sessions-keep-info'));
  assert.equal(textOf(findById(on, 'sessions-keep-info-card')), `Keeps ${SESSION_COSTS_KEPT}`);
  assert.match(SESSION_COSTS_KEPT, /token counts and costs in this home’s Central Knot folder\./);
  assert.match(SESSION_COSTS_KEPT, /Stop keeping saves nothing more, hides the 7-day view and leaves the saved costs in that folder\./);
  assert.doesNotMatch(SESSION_COSTS_KEPT, /collection|estimated prices|saved figures/i);
});

test('all-unpriced heading and tool totals state why, keep count and price dates, and do not repeat unread history', () => {
  const start = todayStart();
  const reading = (unpricedBy: CostSum['unpricedBy'], unpriced: number, ratesDates: string[], unread: boolean): DayRows => {
    const cost = makeCost({ dollars: undefined, unpriced, unpricedBy });
    return {
      period: { start, end: start + 86_400_000 }, ratesDates, rows: [],
      total: { sessions: 2, tokens: blankTokens, cost },
      byTool: [{ tool: 'codex-cli', sessions: 2, tokens: blankTokens, cost, unread }], byModel: [],
    };
  };
  const noRowPage = renderDay(fakeHome(false, 8), reading({ noRow: 2, speedOrTier: [], other: 0 }, 2, ['2026-11-24'], true));
  assert.equal(findById(noRowPage, 'sessions-total-info'), undefined);
  assert.equal(textOf(findById(noRowPage, 'sessions-unpriced-info-card')), '2 sessions. Prices as of Nov 24, 2026. No matching rate in Central Knot’s price list.');
  assert.equal(findNode(findById(noRowPage, 'sessions-by-tool'), el => hasClass(el, 'sessions-unpriced'))!.attrs.title, '2 sessions. No matching rate in Central Knot’s price list.');

  const mixedPage = renderDay(fakeHome(false, 8), reading({ noRow: 2, speedOrTier: [{ which: 'speed', saved: 'fast', requests: 1 }], other: 0 }, 3, [], false), 'today', 4);
  assert.equal(textOf(findById(mixedPage, 'sessions-unpriced-info-card')), '2 sessions. No price known for 2 requests with no matching rate and a fast reply.');
});

test('column cells keep dollar amounts separate from qualifiers with one hover on "or more", mixed models show N unpriced, and no order cue renders', () => {
  const start = todayStart();
  const lowMixed = makeCost({
    dollars: 0.42, unpriced: 1, unpricedBy: { noRow: 1, speedOrTier: [], other: 0 },
    oneHourLow: true, atLeast: true, providers: [{ provider: 'anthropic', from: 'tool' }],
  });
  const unpricedOnly = makeCost({ dollars: undefined, unpriced: 1, unpricedBy: { noRow: 1, speedOrTier: [], other: 0 } });
  const row = makeRow('beta', { cost: lowMixed, models: [{ model: 'claude-2', tokens: blankTokens, cost: lowMixed }, { model: 'codex-auto-review', tokens: blankTokens, cost: unpricedOnly }] });
  const page = renderDay(fakeHome(true, 9), {
    period: { start: start - 6 * 86_400_000, end: start + 86_400_000 }, ratesDates: ['2026-11-24'],
    total: { sessions: 2, tokens: blankTokens, cost: lowMixed },
    byTool: [{ tool: 'claude-cli', sessions: 2, tokens: blankTokens, cost: lowMixed, unread: false }], byModel: row.models,
    days: [
      { period: { start, end: start + 86_400_000 }, total: { sessions: 1, tokens: blankTokens, cost: lowMixed }, rows: [row] },
      { period: { start: start - 86_400_000, end: start }, total: { sessions: 1, tokens: blankTokens, cost: lowMixed }, rows: [row] },
    ],
  }, 'week', 5);
  const expectedOneHour = 'One-hour cache writes are priced at the shorter cache or input rate; higher rate unknown.';
  const expectedNoRate = 'No matching rate in Central Knot’s price list.';
  assert.equal(findNode(page, el => hasClass(el, 'sessions-order')), undefined);
  assert.match(textOf(findById(page, 'sessions-total-info-card')), new RegExp(expectedOneHour));
  assert.equal(textOf(findNode(page, el => hasClass(el, 'sessions-aside'))), expectedOneHour);

  const dayCost = findNode(findNode(page, el => hasClass(el, 'sessions-day')), el => hasClass(el, 'sessions-cost'))!;
  assert.equal(textOf(findNode(dayCost, el => hasClass(el, 'sessions-estimate'))), '≈ $0.42');
  assert.equal(findNode(dayCost, el => hasClass(el, 'sessions-estimate'))!.attrs.title, undefined);
  assert.equal(findNode(dayCost, el => hasClass(el, 'sessions-more'))!.attrs.title, expectedOneHour);
  assert.equal(textOf(findNode(dayCost, el => hasClass(el, 'sessions-cost-note'))), 'or more 1 request unpriced');

  const rowCost = findNode(findNode(page, el => hasClass(el, 'sessions-row')), el => hasClass(el, 'sessions-cost'))!;
  assert.equal(textOf(findNode(rowCost, el => hasClass(el, 'sessions-estimate'))), '≈ $0.42');
  assert.equal(findNode(rowCost, el => hasClass(el, 'sessions-estimate'))!.attrs.title, undefined);
  assert.equal(findNode(rowCost, el => hasClass(el, 'sessions-more'))!.attrs.title, expectedOneHour);
  assert.equal(textOf(findNode(rowCost, el => hasClass(el, 'sessions-cost-note'))), 'or more 1 unpriced');

  const modelLines = findAll(findById(page, 'sessions-by-model'), el => hasClass(el, 'sessions-line') && !hasClass(el, 'sessions-line-head'));
  assert.equal(textOf(findNode(modelLines[0]!, el => hasClass(el, 'sessions-amount'))), '≈ $0.42');
  assert.equal(findNode(modelLines[0]!, el => hasClass(el, 'sessions-amount'))!.attrs.title, undefined);
  assert.equal(findNode(modelLines[0]!, el => hasClass(el, 'sessions-more'))!.attrs.title, expectedOneHour);
  assert.equal(findNode(modelLines[0]!, el => hasClass(el, 'sessions-unpriced'))!.attrs.title, expectedNoRate);
  assert.equal(textOf(findNode(modelLines[0]!, el => hasClass(el, 'sessions-cost-note'))), 'or more 1 unpriced');
  assert.equal(textOf(findNode(modelLines[1]!, el => hasClass(el, 'sessions-unpriced'))), 'no price known');
});

test('rows derive nested agent counts (+2 agents / +1 agent) and open-row reported figure drops "for this session"', () => {
  const start = todayStart(), cost = makeCost({ dollars: 0.25 });
  const grand = makeRow('grand', { parent: 'child', cost });
  const child = makeRow('child', { parent: 'parent', cost, children: [grand] });
  const parent = makeRow('parent', { cost, reported: 4.31, children: [child] });
  const page = renderDay(fakeHome(false, 10), {
    period: { start, end: start + 86_400_000 }, ratesDates: ['2026-11-24'], rows: [parent],
    total: { sessions: 1, tokens: blankTokens, cost },
    byTool: [{ tool: 'claude-cli', sessions: 1, tokens: blankTokens, cost, unread: false }], byModel: [],
  }, 'today', 6);
  const rowOf = (id: string) => findNode(page, el => hasClass(el, 'sessions-row') && el.attrs['data-session'] === id)!;
  const agentsOf = (id: string) => findNode(findNode(rowOf(id), el => el.tag === 'summary')!, el => hasClass(el, 'sessions-agents'));
  assert.equal(textOf(agentsOf('parent')), '+2 agents');
  assert.equal(textOf(agentsOf('child')), '+1 agent');
  assert.equal(agentsOf('grand'), undefined);
  assert.deepEqual(findAll(rowOf('parent'), el => hasClass(el, 'sessions-aside')).map(textOf), ['Claude Code’s own figure: $4.31. Not in the totals.']);
});

test('alias help marks use unambiguous joints and never collide across hyphen boundaries or with -card ids', () => {
  const start = todayStart();
  const aliased = (model: string, as: string) => ({ model, tokens: blankTokens, cost: makeCost({ dollars: 0.25, pricedAs: [{ model, as }] }) });
  const [m1, m2, m3, m4] = [aliased('b-c', 'target-1'), aliased('c', 'target-2'), aliased('claude-2-a', 'claude-2'), aliased('claude-2-a-card', 'claude-2-card')];
  const page = renderDay(fakeHome(false, 11), {
    period: { start, end: start + 86_400_000 }, ratesDates: ['2026-11-24'],
    rows: [makeRow('a', { models: [m1, m3, m4] }), makeRow('a-b', { models: [m2] })],
    total: { sessions: 2, tokens: blankTokens, cost: makeCost() },
    byTool: [{ tool: 'claude-cli', sessions: 2, tokens: blankTokens, cost: makeCost(), unread: false }],
    byModel: [m1, m2, m3, m4],
  }, 'today', 7);
  const marks = findAll(page, el => hasClass(el, 'info-mark') && (el.attrs.id ?? '').startsWith('sessions-alias-'));
  assert.equal(marks.length, 8);
  assert.equal(new Set(marks.flatMap(el => [el.attrs.id!, `${el.attrs.id!}-card`])).size, 16, 'every alias mark id and -card id is pairwise distinct');
  for (const mark of marks) assert.match(textOf(findById(page, `${mark.attrs.id}-card`)), /^Priced as .+\.$/);
});
