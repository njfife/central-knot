// Sessions page controls, wording and heading/row structure (sessionspage.ts, settingspage.ts, app.ts switchSessionCosts):
// repeat clicks on Start or Stop while a save is pending do nothing and disable the control, announcements fire once only for
// a change made, keep control shares its info card in both states, unpriced-only totals keep counts/date/unread/reason,
// one-hour fallback says higher rate unknown, rows derive agent counts and order cue, aliases move to accessible help, and
// open-row reported figures drop "for this session" while staying excluded from totals.
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

test('keep control says Keep costs for a 7-day view while off, Stop keeping while on, and keeps the same info card in both states', () => {
  const expectedCard = 'Adds a 7-day view here, keeping each session’s project, request times, models, token counts and estimated prices in this home’s Central Knot folder. No message text is kept; stopping collection retains saved figures in that folder and hides the 7-day view.';
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = { state: 'ready', data: undefined, gen: 0 };

  state.home = fakeHome(false, 6);
  const off = sessionsPage(state.home) as unknown as FakeNode;
  const start = findById(off, 'sessions-keep-start')!;
  assert.equal(textOf(start), 'Keep costs for a 7-day view');
  assert.equal(start.attrs['aria-describedby'], 'sessions-keep-info-card');
  assert.ok(findById(off, 'sessions-keep-info'));
  assert.equal(textOf(findById(off, 'sessions-keep-info-card')), expectedCard);

  state.home = fakeHome(true, 7);
  const on = sessionsPage(state.home) as unknown as FakeNode;
  const stop = findById(on, 'sessions-keep-stop')!;
  assert.equal(textOf(stop), 'Stop keeping');
  assert.equal(stop.attrs['aria-describedby'], 'sessions-keep-info-card');
  assert.ok(findById(on, 'sessions-keep-info'), 'Stop keeping keeps the discoverable help mark');
  assert.equal(textOf(findById(on, 'sessions-keep-info-card')), expectedCard);
  assert.match(SESSION_COSTS_KEPT, /stopping collection retains saved figures in that folder and hides the 7-day view\./);
});

test('all-unpriced heading and tool totals preserve session count, returned price dates, unread faults and unpriced reason', () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const unpricedCost = makeCost({
    dollars: undefined, unpriced: 3,
    unpricedBy: { noRow: 2, speedOrTier: [{ which: 'speed', saved: 'fast', requests: 1 }], other: 0 },
  });
  const reading = (ratesDates: string[], unread: boolean): DayRows => ({
    period: { start, end: start + 86_400_000 },
    ratesDates,
    rows: [],
    total: { sessions: 2, tokens: blankTokens, cost: unpricedCost },
    byTool: [{ tool: 'codex-cli', sessions: 2, tokens: blankTokens, cost: unpricedCost, unread }],
    byModel: [],
  });

  state.home = fakeHome(false, 8);
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = { state: 'ready', data: reading(['2026-11-24'], true), gen: 3 };
  const withContext = sessionsPage(state.home) as unknown as FakeNode;
  assert.equal(findById(withContext, 'sessions-total-info'), undefined);
  assert.ok(findById(withContext, 'sessions-unpriced-info'));
  assert.equal(textOf(findById(withContext, 'sessions-unpriced-info-card')),
    '2 sessions. Prices as of Nov 24, 2026. Some of Codex’s session history could not be read. No price known for 2 requests with no matching rate and a fast reply.');
  const toolUnpriced = findNode(findById(withContext, 'sessions-by-tool'), el => hasClass(el, 'sessions-unpriced'))!;
  assert.equal(toolUnpriced.attrs.title,
    '2 sessions. Some of Codex’s session history could not be read. No price known for 2 requests with no matching rate and a fast reply.');

  state.sessions = { state: 'ready', data: reading([], false), gen: 4 };
  const plain = sessionsPage(state.home) as unknown as FakeNode;
  assert.equal(textOf(findById(plain, 'sessions-unpriced-info-card')),
    '2 sessions. No price known for 2 requests with no matching rate and a fast reply.');
  const plainToolUnpriced = findNode(findById(plain, 'sessions-by-tool'), el => hasClass(el, 'sessions-unpriced'))!;
  assert.equal(plainToolUnpriced.attrs.title,
    '2 sessions. No price known for 2 requests with no matching rate and a fast reply.');
});

test('one-hour cache fallback says higher rate unknown in heading, tool hover, row hover and open-row note', () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const lowCost = makeCost({ dollars: 0.42, oneHourLow: true, atLeast: true, providers: [{ provider: 'anthropic', from: 'tool' }] });
  const row: SessionRow = {
    tool: 'claude-cli', session: 'beta', project: 'notes', first: start + 1000, last: start + 2000,
    tokens: blankTokens, models: [{ model: 'claude-2', tokens: blankTokens, cost: lowCost }],
    cost: lowCost, withChildren: { tokens: blankTokens, cost: lowCost }, children: [],
  };
  state.home = fakeHome(false, 9);
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = {
    state: 'ready', gen: 5,
    data: {
      period: { start, end: start + 86_400_000 }, ratesDates: ['2026-11-24'], rows: [row],
      total: { sessions: 1, tokens: blankTokens, cost: lowCost },
      byTool: [{ tool: 'claude-cli', sessions: 1, tokens: blankTokens, cost: lowCost, unread: false }],
      byModel: row.models,
    },
  };
  const page = sessionsPage(state.home) as unknown as FakeNode;
  const expected = 'One-hour cache writes are priced at the shorter cache’s rate; higher rate unknown.';
  assert.match(textOf(findById(page, 'sessions-total-info-card')), new RegExp(expected));
  const toolEst = findNode(findById(page, 'sessions-by-tool'), el => hasClass(el, 'sessions-estimate'))!;
  assert.match(toolEst.attrs.title ?? '', new RegExp(expected));
  const rowEst = findNode(findNode(page, el => hasClass(el, 'sessions-row')), el => hasClass(el, 'sessions-estimate'))!;
  assert.equal(rowEst.attrs.title, expected);
  const aside = findNode(page, el => hasClass(el, 'sessions-aside'))!;
  assert.equal(textOf(aside), expected);
  assert.doesNotMatch(textOf(page), /they cost more/);
});

test('rows derive nested agent counts and order cue, aliases move to accessible help with unique ids, and open-row reported figure drops "for this session"', () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const aliasedCost = makeCost({ dollars: 0.25, pricedAs: [{ model: 'claude-haiku-4-5-20251001', as: 'claude-haiku-4-5' }] });
  const aliasedModel = { model: 'claude-haiku-4-5-20251001', tokens: blankTokens, cost: aliasedCost };
  const grand: SessionRow = {
    tool: 'claude-cli', session: 'grand', parent: 'child', project: 'central-knot', first: start + 3000, last: start + 3000,
    tokens: blankTokens, models: [aliasedModel], cost: aliasedCost, withChildren: { tokens: blankTokens, cost: aliasedCost }, children: [],
  };
  const child: SessionRow = {
    tool: 'claude-cli', session: 'child', parent: 'parent', project: 'central-knot', first: start + 2000, last: start + 2000,
    tokens: blankTokens, models: [aliasedModel], cost: aliasedCost, withChildren: { tokens: blankTokens, cost: aliasedCost }, children: [grand],
  };
  const parent: SessionRow = {
    tool: 'claude-cli', session: 'parent', project: 'central-knot', first: start + 1000, last: start + 4000,
    tokens: blankTokens, models: [aliasedModel], cost: aliasedCost, withChildren: { tokens: blankTokens, cost: aliasedCost },
    reported: 4.31, children: [child],
  };
  const solo: SessionRow = {
    tool: 'codex-cli', session: 'solo', project: 'api-service', first: start + 500, last: start + 500,
    tokens: blankTokens, models: [aliasedModel], cost: aliasedCost, withChildren: { tokens: blankTokens, cost: aliasedCost }, children: [],
  };

  state.home = fakeHome(false, 10);
  state.page = 'sessions';
  state.sessionsDay = 'today';
  state.sessions = {
    state: 'ready', gen: 6,
    data: {
      period: { start, end: start + 86_400_000 }, ratesDates: ['2026-11-24'], rows: [parent, solo],
      total: { sessions: 2, tokens: blankTokens, cost: aliasedCost },
      byTool: [
        { tool: 'claude-cli', sessions: 1, tokens: blankTokens, cost: aliasedCost, unread: false },
        { tool: 'codex-cli', sessions: 1, tokens: blankTokens, cost: aliasedCost, unread: false },
      ],
      byModel: [aliasedModel],
    },
  };
  const page = sessionsPage(state.home) as unknown as FakeNode;
  const order = findNode(page, el => hasClass(el, 'sessions-order'));
  assert.equal(textOf(order), 'Latest activity first');

  const rowOf = (id: string) => findNode(page, el => hasClass(el, 'sessions-row') && el.attrs['data-session'] === id)!;
  const summaryOf = (id: string) => findNode(rowOf(id), el => el.tag === 'summary')!;
  assert.equal(textOf(findNode(summaryOf('parent'), el => hasClass(el, 'sessions-agents'))), '+2 agents');
  assert.equal(textOf(findNode(summaryOf('child'), el => hasClass(el, 'sessions-agents'))), '+1 agent');
  assert.equal(findNode(summaryOf('grand'), el => hasClass(el, 'sessions-agents')), undefined);
  assert.equal(findNode(summaryOf('solo'), el => hasClass(el, 'sessions-agents')), undefined);

  assert.equal(findAll(page, el => hasClass(el, 'sessions-as')).length, 0, 'model alias is no longer printed inline under the model');
  const aliasMarks = findAll(page, el => hasClass(el, 'info-mark') && (el.attrs.id ?? '').startsWith('sessions-alias-'));
  assert.equal(aliasMarks.length, 5, 'parent, child, grand, solo and By model each get an alias help mark');
  assert.equal(new Set(aliasMarks.map(el => el.attrs.id)).size, 5, 'every alias help mark has a unique id');
  for (const mark of aliasMarks) {
    const card = findById(page, `${mark.attrs.id}-card`);
    assert.equal(textOf(card), 'Priced as claude-haiku-4-5.');
  }
  const byModelLine = findNode(findById(page, 'sessions-by-model'), el => el.attrs['data-model'] === 'claude-haiku-4-5-20251001')!;
  const byModelName = findNode(byModelLine, el => hasClass(el, 'sessions-model'))!;
  assert.ok(byModelName.attrs['aria-describedby']?.startsWith('sessions-alias-'));

  const asides = findAll(rowOf('parent'), el => hasClass(el, 'sessions-aside')).map(textOf);
  assert.deepEqual(asides, ['Claude Code’s own figure: $4.31. Not in the totals.']);

  // Single-session day and empty day omit the order cue.
  state.sessions = {
    state: 'ready', gen: 7,
    data: {
      period: { start, end: start + 86_400_000 }, ratesDates: ['2026-11-24'], rows: [solo],
      total: { sessions: 1, tokens: blankTokens, cost: aliasedCost },
      byTool: [{ tool: 'codex-cli', sessions: 1, tokens: blankTokens, cost: aliasedCost, unread: false }],
      byModel: [aliasedModel],
    },
  };
  assert.equal(findNode(sessionsPage(state.home), el => hasClass(el, 'sessions-order')), undefined, 'one session needs no order cue');

  state.sessions = {
    state: 'ready', gen: 8,
    data: {
      period: { start, end: start + 86_400_000 }, ratesDates: [], rows: [],
      total: { sessions: 0, tokens: blankTokens, cost: makeCost({ dollars: undefined }) },
      byTool: [{ tool: 'codex-cli', sessions: 0, tokens: blankTokens, cost: makeCost({ dollars: undefined }), unread: false }],
      byModel: [],
    },
  };
  assert.equal(findNode(sessionsPage(state.home), el => hasClass(el, 'sessions-order')), undefined, 'empty day omits order cue');

  // 7-day view: order cue shown with multiple days, omitted when empty.
  state.home = fakeHome(true, 11);
  state.sessionsDay = 'week';
  const weekData: PeriodRows = {
    period: { start: start - 6 * 86_400_000, end: start + 86_400_000 }, ratesDates: ['2026-11-24'],
    total: { sessions: 2, tokens: blankTokens, cost: aliasedCost },
    byTool: [{ tool: 'codex-cli', sessions: 2, tokens: blankTokens, cost: aliasedCost, unread: false }],
    byModel: [aliasedModel],
    days: [
      { period: { start, end: start + 86_400_000 }, total: { sessions: 1, tokens: blankTokens, cost: aliasedCost }, rows: [solo] },
      { period: { start: start - 86_400_000, end: start }, total: { sessions: 1, tokens: blankTokens, cost: aliasedCost }, rows: [solo] },
    ],
  };
  state.sessions = { state: 'ready', gen: 9, data: weekData };
  assert.equal(textOf(findNode(sessionsPage(state.home), el => hasClass(el, 'sessions-order'))), 'Latest activity first');
  state.sessions = { state: 'ready', gen: 10, data: { ...weekData, total: { sessions: 0, tokens: blankTokens, cost: makeCost({ dollars: undefined }) }, days: [] } };
  assert.equal(findNode(sessionsPage(state.home), el => hasClass(el, 'sessions-order')), undefined, 'empty 7-day view omits order cue');
});
