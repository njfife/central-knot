// The Sessions page's 7 days read from the kept record (src/sessionday.ts readKeptPeriod, keptReading; src/sessionrow.ts
// dayByDay), as worked examples on records made by the record's own writer in made-up homes.
// TZ is fixed west of UTC before any Date runs, so a late evening on a month's last day lies in the next UTC month's file.
process.env.TZ = 'America/New_York';

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledRates, priceRequest } from '../src/rates.ts';
import { keptReading, readKeptPeriod, type Period } from '../src/sessionday.ts';
import { emptyPositions, monthOf, readSessionRecord, sessionsDirectory, upsertSessionRecord, withSessionRecordTurn, type SessionMonth } from '../src/sessionrecord.ts';
import type { Request } from '../src/sessionrequests.ts';
import { dayByDay, sessionRows } from '../src/sessionrow.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
const newContext = async (): Promise<ShareContext> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ck-sessionkept-')));
  roots.push(root);
  return { home: join(root, 'home'), mode: 'custom', read: async () => [], build: 'test-build', settingsPath: join(root, 'settings.json'), realHome: join(root, 'real') };
};

/** A local time in 2026 (America/New_York). */
const local = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
/** The 7 days ending on local `month`/`day`: their eight local midnights, oldest first, as the page cuts them. */
const weekTo = (month: number, day: number) => Array.from({ length: 8 }, (_, index) => new Date(2026, month - 1, day - 6 + index).getTime());
const periodOf = (bounds: number[]): Period => ({ start: bounds[0]!, end: bounds.at(-1)! });
const BOTH: HarnessId[] = ['claude-cli', 'codex-cli'];
const MONTHS = ['2026-11', '2026-12'];

interface Kept {
  session: string; request: string; at: number;
  tool?: 'claude-cli' | 'codex-cli'; parent?: string; model?: string; ratesDate?: string; unread?: number;
}
/** Keeps requests as a sweep does, by the record's own writer, in one turn that reads `months` (every month they fall in, by default). */
async function keep(ctx: ShareContext, requests: Kept[], months = [...new Set(requests.map(each => monthOf(each.at)))]) {
  const updates = requests.map(({ session, request, at, tool = 'claude-cli', parent, model, ratesDate = bundledRates.date, unread }) => {
    const saved = model ?? (tool === 'claude-cli' ? 'claude-fable-5' : 'gpt-6-astra');
    const req: Request = { tool, session, ...(parent ? { parent } : {}), request, at, model: saved, tokens: { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 1_000 } };
    return { tool, session, ...(parent ? { parent } : {}), project: 'app', ...(unread ? { unread } : {}), requests: [{ request: req, price: priceRequest(req, { ...bundledRates, date: ratesDate }) }] };
  });
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const next = upsertSessionRecord(await read(months), updates);
    const written = await write(ctx, { months: next.months, changed: next.changed, positions: emptyPositions() });
    assert.equal(written.written, true, written.refused ?? 'written');
  });
}
const close = (actual: number, expected: number, what: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} against ${expected}`);

test('Days by local time over months by UTC: a session on two days is a row under each, its parts in two months’ files one row', async () => {
  const ctx = await newContext();
  const evening = local(11, 30, 18), late = local(11, 30, 23, 30), early = local(12, 1, 0, 30);
  assert.deepEqual([monthOf(evening), monthOf(late), monthOf(early)], ['2026-11', '2026-12', '2026-12'], 'late on 30 November is in December’s file');
  await keep(ctx, [{ session: 's1', request: 'a', at: evening }, { session: 's1', request: 'b', at: late }, { session: 's1', request: 'c', at: early }]);
  const bounds = weekTo(12, 2);
  const week = dayByDay(await readKeptPeriod(ctx.home, periodOf(bounds), BOTH), bounds);
  assert.deepEqual(week.days.map(day => [day.period.start, day.rows.map(row => [row.session, row.first, row.last])]),
    [[local(12, 1, 0), [['s1', early, early]]], [local(11, 30, 0), [['s1', evening, late]]]], 'newest day first; 30 November’s row holds both files’ parts');
  assert.equal('rows' in week, false, 'the period sends no rows of its own');
  assert.equal(week.total.sessions, 1, 'the period counts the session once');
  assert.equal(week.days.reduce((count, day) => count + day.total.sessions, 0), 2, 'its days count it under each');
  assert.deepEqual(week.total.tokens, { input: 30_000, cacheRead: 0, cacheWrite: 0, output: 3_000 });
  close(week.total.cost.dollars!, week.days.reduce((sum, day) => sum + day.total.cost.dollars!, 0), 'the period’s dollars are its days’');
});

test('A request kept again in a later month counts once, on the day of its first time; one first kept before the period is not in it', async () => {
  const ctx = await newContext();
  const before = local(11, 25, 22), first = local(11, 30, 18);
  // Each turn reads one month only, so the key kept in the other month is not seen and is kept again.
  await keep(ctx, [{ session: 's1', request: 'x', at: before }, { session: 's1', request: 'y', at: first }], ['2026-11']);
  await keep(ctx, [{ session: 's1', request: 'x', at: local(12, 1, 2) }, { session: 's1', request: 'y', at: local(12, 1, 1) }], ['2026-12']);
  const record = await readSessionRecord(ctx.home, MONTHS);
  assert.deepEqual(MONTHS.map(month => record.months[month]!.sessions.flatMap(s => Object.keys(s.requests)).sort()), [['x', 'y'], ['x', 'y']], 'each kept in both months');
  const bounds = weekTo(12, 2);
  const week = dayByDay(keptReading(record, periodOf(bounds), BOTH), bounds);
  assert.deepEqual(week.days.map(day => [day.period.start, day.rows.map(row => [row.first, row.last])]), [[local(11, 30, 0), [[first, first]]]]);
  assert.equal(week.total.tokens.input, 10_000, 'y once; x, first kept on 25 November, not in the period');
});

test('Only present tools are read; a tool is unread where a month read keeps unread lines of it, and every tool where a month is held', async () => {
  const ctx = await newContext();
  await keep(ctx, [{ session: 'c1', request: 'r1', at: local(11, 28), tool: 'codex-cli' }, { session: 's1', request: 'a', at: local(11, 28), unread: 2 },
    { session: 's2', request: 'b', at: local(12, 2) }]);
  const period = periodOf(weekTo(12, 2));
  const said = (reading: ReturnType<typeof keptReading>) => reading.tools.map(tool => [tool.tool, tool.unread, tool.sessions.map(s => s.session)]);
  const record = await readSessionRecord(ctx.home, MONTHS);
  assert.deepEqual(said(keptReading(record, period, BOTH)), [['claude-cli', true, ['s1', 's2']], ['codex-cli', false, ['c1']]]);
  assert.deepEqual(said(keptReading(record, period, ['claude-cli', 'copilot-cli'])), [['claude-cli', true, ['s1', 's2']]], 'Codex not present: not read; Copilot CLI is not a session tool');
  await writeFile(join(sessionsDirectory(ctx.home), '2026-12.json'), '{ not json');
  const held = keptReading(await readSessionRecord(ctx.home, MONTHS), period, BOTH);
  assert.deepEqual(said(held), [['claude-cli', true, ['s1']], ['codex-cli', true, ['c1']]], 'December held: every tool unread, November still read');
  assert.equal(sessionRows(held).total.cost.atLeast, true, 'the sum a lower bound');
});

test('Prices as kept: each list date the receipts were priced on, once, oldest first; none for a day with no list price', async () => {
  const ctx = await newContext();
  await keep(ctx, [{ session: 's1', request: 'a', at: local(11, 29), ratesDate: '2026-10-01' }, { session: 's1', request: 'b', at: local(11, 30), ratesDate: '2026-11-15' },
    { session: 's1', request: 'c', at: local(11, 30, 13), ratesDate: '2026-10-01' }, { session: 's2', request: 'd', at: local(12, 1), model: 'a-model-no-list-has' }]);
  const record = await readSessionRecord(ctx.home, MONTHS);
  const priced = record.months['2026-11']!.sessions[0]!.requests['b']!;
  const bounds = weekTo(12, 2);
  const week = dayByDay(keptReading(record, periodOf(bounds), BOTH), bounds);
  assert.deepEqual([week.ratesDates, ...week.days.map(day => day.ratesDates)], [['2026-10-01', '2026-11-15'], [], ['2026-10-01', '2026-11-15'], ['2026-10-01']]);
  const kept = week.days[1]!.rows[0]!.models[0]!.cost.dollars!;
  close(kept, priced.dollars! + record.months['2026-11']!.sessions[0]!.requests['c']!.dollars!, 'the dollars each receipt was kept with, not priced again');
  assert.equal(week.days[0]!.total.cost.unpriced, 1);
});

test('Each day of 7 days says what the same kept requests say read for that day alone', async () => {
  const ctx = await newContext();
  await keep(ctx, [
    { session: 'p', request: 'p1', at: local(11, 27, 9) }, { session: 'kid', parent: 'p', request: 'k1', at: local(11, 27, 9, 5) },
    { session: 'p', request: 'p2', at: local(11, 30, 23, 50) }, { session: 'p', request: 'p3', at: local(12, 1, 0, 10) },
    { session: 'c1', request: 'r1', at: local(11, 29), tool: 'codex-cli' }, { session: 'c1', request: 'r2', at: local(12, 2, 8), tool: 'codex-cli' },
    { session: 'q', request: 'q1', at: local(12, 2, 9), model: 'a-model-no-list-has' },
  ]);
  const record = await readSessionRecord(ctx.home, MONTHS);
  const bounds = weekTo(12, 2);
  const week = dayByDay(keptReading(record, periodOf(bounds), BOTH), bounds);
  const alone = bounds.slice(0, -1).map((start, index) => sessionRows(keptReading(record, { start, end: bounds[index + 1]! }, BOTH)));
  assert.deepEqual(week.days, alone.filter(day => day.rows.length).reverse());
  assert.deepEqual(week.days.map(day => day.rows.map(row => [row.session, row.children.map(child => child.session)])),
    [[['q', []], ['c1', []]], [['p', []]], [['p', []]], [['c1', []]], [['p', ['kid']]]], 'an agent’s session set in its parent’s on their day');
});

test('A heavy week: 7 days across the end of two months of 160,000 requests in 4,000 sessions each, read and made into days within a bound', async () => {
  const ctx = await newContext();
  const pricing = { priced: true, basis: 'list', ratesDate: bundledRates.date, matched: { provider: 'anthropic', model: 'claude-fable-5', by: 'exact', providerFrom: 'tool' } } as const;
  /** A heavy month as a sweep would keep it: 4,000 sessions of 40 requests, evenly over the month. */
  const heavy = (month: string, from: number, days: number): SessionMonth => ({
    formatVersion: 1, month, pricings: [pricing], sessions: Array.from({ length: 4000 }, (_, s) => ({
      tool: s % 3 ? 'claude-cli' : 'codex-cli', session: `${month}-session-${String(s).padStart(5, '0')}-abcd-ef01-2345`, project: `project-${s % 10}`, unread: 0,
      requests: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`msg_01${month}xyz${String(s * 40 + i).padStart(7, '0')}abcdefgh`, {
        at: from + Math.floor((s * 40 + i) * days * 86_400_000 / 160_000), model: 'claude-fable-5',
        tokens: { input: 500 + i, cacheRead: 12_000, cacheWrite: 1_000, output: 150 }, dollars: 0.0123, pricing: 0,
      }])),
    })),
  });
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    await read(['2026-10', '2026-11']);
    const months = { '2026-10': heavy('2026-10', Date.UTC(2026, 9, 1), 31), '2026-11': heavy('2026-11', Date.UTC(2026, 10, 1), 30) };
    assert.equal((await write(ctx, { months, changed: ['2026-10', '2026-11'], positions: emptyPositions() })).written, true);
  });
  const bounds = weekTo(11, 3);
  let longest = 0;
  let last = performance.now();
  const lag = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last - 5);
    last = now;
  }, 5);
  let peak = process.memoryUsage().heapUsed;
  const heap = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 1);
  const started = performance.now();
  const reading = await readKeptPeriod(ctx.home, periodOf(bounds), BOTH);
  const week = dayByDay(reading, bounds);
  const took = performance.now() - started;
  clearInterval(lag);
  clearInterval(heap);
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  const bytes = Buffer.byteLength(JSON.stringify(week));
  const requests = reading.tools.flatMap(tool => tool.sessions).reduce((count, s) => count + s.requests.length, 0);
  console.log(`7 days over two heavy months: ${requests} requests in ${week.total.sessions} sessions read and made into days in ${Math.round(took)} ms`
    + ` (longest stall ${Math.round(longest)} ms, heap at most ${Math.round(peak / 1e6)} MB), ${bytes} bytes to the page`);
  assert.ok(requests > 35_000 && week.days.length === 7, `a heavy week across both months: ${requests} requests, ${week.days.length} days`);
  assert.ok(took < 4000, `read and made into days in ${Math.round(took)} ms`);
  assert.ok(bytes < 4_000_000, `${bytes} bytes to the page`);
});
