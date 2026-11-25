// The session costs record (src/sessionrecord.ts), as worked examples.
// TZ is fixed before any Date runs so local month boundaries are deterministic.
process.env.TZ = 'America/New_York';

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs, { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledRates, priceCredits, priceRequest, type PriceResult, type RatesTable } from '../src/rates.ts';
import type { Request } from '../src/sessionrequests.ts';
import type { ShareContext } from '../src/share.ts';
import {
  emptyPositions,
  monthOf,
  previousMonth,
  readSessionRecord,
  sessionsDirectory,
  upsertSessionRecord,
  withSessionRecordTurn,
  type SessionMonth,
  type WriteInput,
} from '../src/sessionrecord.ts';
import { lockSkip, makeWritableTree, withLock } from './fslock.ts';
import { slashPath } from './wincompat.ts';

const tempRoots: string[] = [];
const makeTemp = async (prefix = 'ck-sessionrecord-') => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
};
after(async () => {
  for (const dir of tempRoots) {
    await makeWritableTree(dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

const localTime = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

const makeContext = async (overrides: Partial<ShareContext> = {}): Promise<ShareContext> => {
  const root = await makeTemp();
  return {
    home: join(root, 'home'),
    mode: 'custom',
    read: async () => [],
    build: 'test-build',
    settingsPath: join(root, 'settings.json'),
    realHome: join(root, 'real'),
    ...overrides,
  };
};

const makeRates = (date: string, claudeIn: number, claudeOut: number, gptIn = 1.25, gptOut = 10): RatesTable => ({
  format: 1,
  date,
  built: date,
  source: { name: 'test', url: 'https://example.test', revision: 'r1', license: 'MIT', notice: '' },
  providers: [
    {
      id: 'anthropic',
      models: [
        { id: 'claude-fable-5', match: { equals: 'claude-fable-5' }, prices: { input: claudeIn, cacheRead: 0.3, cacheWrite: 3.75, output: claudeOut } },
        { id: 'claude-opus-5', match: { starts_with: 'claude-opus-5' }, prices: { input: claudeIn * 2, cacheRead: 0.5, cacheWrite: 6, output: claudeOut * 2 } },
      ],
    },
    {
      id: 'openai',
      models: [{ id: 'gpt-5', match: { equals: 'gpt-5' }, prices: { input: gptIn, cacheRead: 0.125, output: gptOut } }],
    },
  ],
});

const RATES_V1 = makeRates('2026-10-01', 3, 15);
const RATES_V2 = makeRates('2026-11-15', 6, 30, 2.5, 20);

const claudeReq = (session: string, request: string, at: number, extra: Partial<Request> = {}): Request => ({
  tool: 'claude-cli',
  session,
  request,
  at,
  model: 'claude-fable-5',
  tokens: { input: 1000, cacheRead: 2000, cacheWrite: 500, output: 250 },
  ...extra,
});

const codexReq = (session: string, request: string, at: number, extra: Partial<Request> = {}): Request => ({
  tool: 'codex-cli',
  session,
  request,
  at,
  model: 'gpt-5',
  provider: 'openai',
  tokens: { input: 800, cacheRead: 1000, cacheWrite: 0, output: 150 },
  ...extra,
});

const emptySource = (readMonths: string[]) => ({ readMonths, months: {} as Record<string, SessionMonth>, held: [] });

/** Helper for tests that read named months and commit a prepared `WriteInput` inside one turn. */
const writeInTurn = (ctx: ShareContext, readMonths: readonly string[], input: WriteInput) =>
  withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    await read(readMonths);
    return write(ctx, input);
  });

test('Round trip: two sessions upserted, written inside a turn, and read back identically', async () => {
  const ctx = await makeContext();
  const r1 = claudeReq('s-claude', 'msg-1', localTime(2026, 11, 10), {
    tokens: { input: 1000, cacheRead: 2000, cacheWrite: 500, cacheWrite1h: 200, output: 250 },
  });
  const r2 = codexReq('s-codex', 'resp-1', localTime(2026, 11, 12));
  const r3 = claudeReq('s-claude', 'msg-unpriced', localTime(2026, 11, 10, 12, 5), { speed: 'turbo', serviceTier: 'batch' });
  const positions = {
    ...emptyPositions(),
    sweptAt: localTime(2026, 11, 12, 13),
    files: [{
      tool: 'codex-cli' as const, dev: '42', ino: '9007199254740993', offset: 512,
      before: '0123456789abcdef', size: 512, mtimeMs: localTime(2026, 11, 12, 12),
      codex: { session: 's-codex', model: 'gpt-5', lastTotal: { input: 10, cacheRead: 0, cacheWrite: 0, output: 5 }, recordedSince: true },
    }],
  };

  const up = await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const initial = await read(['2026-11']);
    const next = upsertSessionRecord(initial, [
      {
        tool: 'claude-cli', session: 's-claude', project: 'alpha', unread: 0,
        requests: [{ request: r1, price: priceRequest(r1, RATES_V1) }, { request: r3, price: priceRequest(r3, RATES_V1) }],
      },
      {
        tool: 'codex-cli', session: 's-codex', parent: 's-root', project: 'beta', unread: 2,
        requests: [{ request: r2, price: priceRequest(r2, RATES_V1) }],
      },
    ]);
    assert.deepEqual(next.changed, ['2026-11']);
    assert.deepEqual(next.notTaken, []);
    assert.deepEqual(initial.months, {}, 'upsert does not mutate input');
    const res = await write(ctx, { months: next.months, changed: next.changed, positions, currentMonth: '2026-11' });
    assert.deepEqual(res, { written: true, held: [] });
    return next;
  });

  const readBack = await readSessionRecord(ctx.home, ['2026-11']);
  assert.deepEqual(readBack.readMonths, ['2026-11']);
  assert.deepEqual(readBack.held, []);
  assert.deepEqual(readBack.months, up.months);
  assert.deepEqual(readBack.positions, positions);
  const month = readBack.months['2026-11']!;
  const rec1 = month.sessions.find(s => s.session === 's-claude')!.requests['msg-1']!;
  const p1 = month.pricings[rec1.pricing]!;
  assert.equal(p1.priced, true);
  assert.equal(p1.basis, 'list');
  assert.equal(p1.ratesDate, '2026-10-01');
  assert.equal(p1.atLeast, true);
  assert.deepEqual(p1.matched, { provider: 'anthropic', model: 'claude-fable-5', by: 'exact', providerFrom: 'tool' });
  const rec3 = month.sessions.find(s => s.session === 's-claude')!.requests['msg-unpriced']!;
  assert.equal(rec3.dollars, undefined);
  assert.equal(rec3.speed, 'turbo');
  assert.equal(rec3.serviceTier, 'batch');
  assert.equal(month.pricings[rec3.pricing]!.priced, false);
});

test('Frozen price: same model and tokens with a newer rates table keep the first price and report no changed month; absent vs zero cacheWrite1h differ', () => {
  const r = claudeReq('s1', 'msg-1', localTime(2026, 11, 5));
  const firstPrice = priceRequest(r, RATES_V1);
  const secondPrice = priceRequest(r, RATES_V2);
  assert.ok(firstPrice.priced && secondPrice.priced && firstPrice.dollars !== secondPrice.dollars);

  const up1 = upsertSessionRecord(emptySource(['2026-11']), [{ tool: 'claude-cli', session: 's1', requests: [{ request: r, price: firstPrice }] }]);
  const beforeSnap = structuredClone(up1.months);
  const up2 = upsertSessionRecord({ readMonths: ['2026-11'], months: up1.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: r, price: secondPrice }] },
  ]);
  assert.deepEqual(up2.changed, []);
  assert.deepEqual(up2.months, beforeSnap);
  assert.equal(up2.months['2026-11']!.sessions[0]!.requests['msg-1']!.dollars, firstPrice.dollars);

  const withZero1h = claudeReq('s1', 'msg-1', localTime(2026, 11, 5, 12, 1), {
    tokens: { input: 1000, cacheRead: 2000, cacheWrite: 500, cacheWrite1h: 0, output: 250 },
  });
  const up3 = upsertSessionRecord({ readMonths: ['2026-11'], months: up2.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: withZero1h, price: priceRequest(withZero1h, RATES_V2) }] },
  ]);
  assert.deepEqual(up3.changed, ['2026-11']);
  const rec = up3.months['2026-11']!.sessions[0]!.requests['msg-1']!;
  assert.equal(rec.tokens.cacheWrite1h, 0);
  assert.equal(rec.dollars, secondPrice.dollars);
  assert.equal(rec.at, r.at);
});

test('Partial reading made whole: more tokens reprice with the new table while keeping first at and month', () => {
  const firstAt = localTime(2026, 11, 8, 9, 0);
  const partial = claudeReq('s1', 'msg-part', firstAt, { tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 10 } });
  const whole = claudeReq('s1', 'msg-part', localTime(2026, 11, 8, 9, 2), { tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 400 } });

  const up1 = upsertSessionRecord(emptySource(['2026-11']), [{ tool: 'claude-cli', session: 's1', requests: [{ request: partial, price: priceRequest(partial, RATES_V1) }] }]);
  const wholePrice = priceRequest(whole, RATES_V2);
  const up2 = upsertSessionRecord({ readMonths: ['2026-11'], months: up1.months, held: [] }, [{ tool: 'claude-cli', session: 's1', requests: [{ request: whole, price: wholePrice }] }]);

  assert.deepEqual(up2.changed, ['2026-11']);
  const rec = up2.months['2026-11']!.sessions[0]!.requests['msg-part']!;
  assert.equal(rec.at, firstAt);
  assert.deepEqual(rec.tokens, whole.tokens);
  assert.ok(wholePrice.priced);
  assert.equal(rec.dollars, wholePrice.dollars);
  const entry = up2.months['2026-11']!.pricings[rec.pricing]!;
  assert.equal(entry.priced && entry.basis === 'list' && entry.ratesDate, '2026-11-15');
});

test('Month before: Oct 31 request updated on Nov 1 stays in Oct; a key in an unread older month cannot be seen and is treated as new', () => {
  assert.equal(previousMonth('2026-01'), '2025-12');
  const octAt = localTime(2026, 10, 31, 23, 55);
  const novAt = localTime(2026, 11, 1, 0, 5);
  const first = claudeReq('s1', 'msg-midnight', octAt, { tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 20 } });
  const second = claudeReq('s1', 'msg-midnight', novAt, { tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 300 } });

  const up1 = upsertSessionRecord(emptySource(['2026-10', '2026-11']), [{ tool: 'claude-cli', session: 's1', requests: [{ request: first, price: priceRequest(first, RATES_V1) }] }]);
  assert.deepEqual(up1.changed, ['2026-10']);

  const up2 = upsertSessionRecord({ readMonths: ['2026-10', '2026-11'], months: up1.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: second, price: priceRequest(second, RATES_V2) }] },
  ]);
  assert.deepEqual(up2.changed, ['2026-10']);
  assert.equal(up2.months['2026-11'], undefined, 'not duplicated into November');
  const rec = up2.months['2026-10']!.sessions[0]!.requests['msg-midnight']!;
  assert.equal(rec.at, octAt);
  assert.equal(rec.tokens.output, 300);

  // Two months later, reading only Dec + Jan (not Oct): the Oct key cannot be seen and is treated as new in Jan.
  const janAt = localTime(2027, 1, 2, 10, 0);
  const farLater = claudeReq('s1', 'msg-midnight', janAt, { tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 300 } });
  const up3 = upsertSessionRecord(emptySource(['2026-12', '2027-01']), [
    { tool: 'claude-cli', session: 's1', requests: [{ request: farLater, price: priceRequest(farLater, RATES_V2) }] },
  ]);
  assert.deepEqual(up3.changed, ['2027-01']);
  assert.ok(up3.months['2027-01']!.sessions[0]!.requests['msg-midnight']);

  // When Oct IS among the read months, the key IS found in Oct and not duplicated into Jan.
  const up4 = upsertSessionRecord({ readMonths: ['2026-10', '2026-12', '2027-01'], months: up2.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: farLater, price: priceRequest(farLater, RATES_V2) }] },
  ]);
  assert.deepEqual(up4.changed, []);
  assert.equal(up4.months['2027-01'], undefined);
});

test('One id in two sessions of one tool stays under the first session; same id in another tool is a separate receipt', () => {
  const at = localTime(2026, 11, 10);
  const cA = claudeReq('sess-a', 'shared-id', at, { tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 50 } });
  const cB = claudeReq('sess-b', 'shared-id', at + 1000, { tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 200 } });
  const xB = codexReq('codex-1', 'shared-id', at + 2000);

  const up1 = upsertSessionRecord(emptySource(['2026-11']), [
    { tool: 'claude-cli', session: 'sess-a', project: 'orig', requests: [{ request: cA, price: priceRequest(cA, RATES_V1) }] },
  ]);
  const up2 = upsertSessionRecord({ readMonths: ['2026-11'], months: up1.months, held: [] }, [
    { tool: 'claude-cli', session: 'sess-b', project: 'copied', requests: [{ request: cB, price: priceRequest(cB, RATES_V2) }] },
    { tool: 'codex-cli', session: 'codex-1', project: 'other', requests: [{ request: xB, price: priceRequest(xB, RATES_V2) }] },
  ]);

  const sessions = up2.months['2026-11']!.sessions;
  assert.equal(sessions.filter(s => s.tool === 'claude-cli').length, 1);
  const claudeSess = sessions.find(s => s.tool === 'claude-cli')!;
  assert.equal(claudeSess.session, 'sess-a');
  assert.equal(claudeSess.project, 'orig', 'copied session does not overwrite first session metadata');
  assert.equal(claudeSess.requests['shared-id']!.tokens.output, 200);
  assert.equal(claudeSess.requests['shared-id']!.at, at);

  const codexSess = sessions.find(s => s.tool === 'codex-cli')!;
  assert.equal(codexSess.session, 'codex-1');
  assert.ok(codexSess.requests['shared-id']);
});

test('Held newer (formatVersion: 2) and held damaged (non-JSON): reported held, upsert takes none, write preserves exact bytes', async () => {
  for (const [kind, raw] of [['newer', '{"formatVersion":2,"extra":"future"}\n'], ['damaged', '{not valid json']] as const) {
    const ctx = await makeContext();
    const dir = sessionsDirectory(ctx.home);
    const file = join(dir, '2026-10.json');
    await mkdir(dir, { recursive: true });
    await writeFile(file, raw, 'utf8');
    const beforeBytes = await readFile(file);

    const read = await readSessionRecord(ctx.home, ['2026-10', '2026-11']);
    assert.equal(read.months['2026-10'], undefined);
    assert.equal(read.held.length, 1);
    assert.equal(read.held[0]!.file, '2026-10.json');
    assert.equal(read.held[0]!.kind, kind);

    const r = claudeReq('s1', 'msg-oct', localTime(2026, 10, 15));
    const up = upsertSessionRecord(read, [{ tool: 'claude-cli', session: 's1', requests: [{ request: r, price: priceRequest(r, RATES_V1) }] }]);
    assert.deepEqual(up.changed, []);
    assert.equal(up.months['2026-10'], undefined);
    assert.equal(up.notTaken.length, 1);
    assert.equal(up.notTaken[0]!.reason, 'held');
    assert.equal(up.notTaken[0]!.month, '2026-10');

    const direct = await writeInTurn(ctx, ['2026-10', '2026-11'], {
      months: { '2026-10': { formatVersion: 1, month: '2026-10', pricings: [], sessions: [] } },
      changed: ['2026-10'], positions: emptyPositions(), currentMonth: '2026-11',
    });
    assert.equal(direct.written, false);
    assert.equal(direct.held[0]!.file, '2026-10.json');
    assert.deepEqual(await readFile(file), beforeBytes);
  }
});

test('Held gate: current month held or positions.json held stops the entire write and leaves stray temps untouched', async () => {
  for (const culprit of ['2026-11.json', 'positions.json'] as const) {
    const ctx = await makeContext();
    const dir = sessionsDirectory(ctx.home);
    await mkdir(dir, { recursive: true });
    const heldFile = join(dir, culprit);
    const heldBytes = Buffer.from('{"formatVersion":2}\n');
    await writeFile(heldFile, heldBytes);
    const stray = join(dir, `2026-10.json.${randomUUID()}.tmp`);
    await writeFile(stray, 'partial');

    const octReq = claudeReq('s1', 'msg-oct', localTime(2026, 10, 20));
    const up = upsertSessionRecord(emptySource(['2026-10', '2026-11']), [
      { tool: 'claude-cli', session: 's1', requests: [{ request: octReq, price: priceRequest(octReq, RATES_V1) }] },
    ]);
    const res = await writeInTurn(ctx, ['2026-10', '2026-11'], {
      months: up.months, changed: up.changed, positions: { ...emptyPositions(), sweptAt: 1234 }, currentMonth: '2026-11',
    });
    assert.equal(res.written, false);
    assert.ok(res.refused?.includes(culprit));
    assert.ok(res.held.some(h => h.file === culprit && h.kind === 'newer'));
    assert.deepEqual(await readFile(heldFile), heldBytes);
    assert.equal(await stat(stray).then(() => true, () => false), true, 'stray temp not removed when write is refused');
    assert.equal(await stat(join(dir, '2026-10.json')).then(() => true, () => false), false, 'changed month not written');
  }
});

test('Stray temporary files are never read and are removed by the next write', async () => {
  const ctx = await makeContext();
  const dir = sessionsDirectory(ctx.home);
  await mkdir(dir, { recursive: true });
  const strayMonth = `2026-11.json.${randomUUID()}.tmp`;
  const strayPos = `positions.json.${randomUUID()}.tmp`;
  await writeFile(join(dir, strayMonth), '{broken');
  await writeFile(join(dir, strayPos), '{broken');
  await writeFile(join(dir, 'keep-note.txt'), 'not a temp');

  const r = claudeReq('s1', 'msg-1', localTime(2026, 11, 5));
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const state = await read(['2026-11']);
    assert.deepEqual(state.held, []);
    assert.deepEqual(state.months, {});
    const up = upsertSessionRecord(state, [{ tool: 'claude-cli', session: 's1', requests: [{ request: r, price: priceRequest(r, RATES_V1) }] }]);
    const res = await write(ctx, { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' });
    assert.equal(res.written, true);
  });

  const names = (await readdir(dir)).sort();
  assert.deepEqual(names, ['2026-11.json', 'keep-note.txt', 'positions.json']);
});

test('Interrupted write replayed: injected failure on second rename keeps old positions; replay converges with uninterrupted run', async () => {
  const ctx = await makeContext();
  const cleanCtx = await makeContext();
  const oldPos = { ...emptyPositions(), sweptAt: 100 };
  const newPos = { ...emptyPositions(), sweptAt: 200 };

  assert.equal((await writeInTurn(ctx, ['2026-10', '2026-11'], { months: {}, changed: [], positions: oldPos, currentMonth: '2026-11' })).written, true);

  const rOct = claudeReq('s1', 'msg-oct', localTime(2026, 10, 25));
  const rNov = claudeReq('s1', 'msg-nov', localTime(2026, 11, 2));
  const updates = [{
    tool: 'claude-cli' as const, session: 's1', project: 'proj',
    requests: [{ request: rOct, price: priceRequest(rOct, RATES_V1) }, { request: rNov, price: priceRequest(rNov, RATES_V1) }],
  }];

  await withSessionRecordTurn(cleanCtx.home, async ({ read, write }) => {
    const baseUp = upsertSessionRecord(await read(['2026-10', '2026-11']), updates);
    assert.equal((await write(cleanCtx, { months: baseUp.months, changed: baseUp.changed, positions: newPos, currentMonth: '2026-11' })).written, true);
  });
  const expected = await readSessionRecord(cleanCtx.home, ['2026-10', '2026-11']);

  const originalRename = fs.rename;
  let renames = 0;
  try {
    fs.rename = async (source, destination) => {
      renames++;
      if (renames === 2) throw Object.assign(new Error('injected crash'), { code: 'EIO' });
      return originalRename(source, destination);
    };
    syncBuiltinESMExports();
    await assert.rejects(
      withSessionRecordTurn(ctx.home, async ({ read, write }) => {
        const up = upsertSessionRecord(await read(['2026-10', '2026-11']), updates);
        assert.deepEqual(up.changed, ['2026-10', '2026-11']);
        return write(ctx, { months: up.months, changed: up.changed, positions: newPos, currentMonth: '2026-11' });
      }),
      { code: 'EIO' },
    );
  } finally {
    fs.rename = originalRename;
    syncBuiltinESMExports();
  }

  const mid = await readSessionRecord(ctx.home, ['2026-10', '2026-11']);
  assert.ok(mid.months['2026-10']);
  assert.equal(mid.months['2026-11'], undefined);
  assert.deepEqual(mid.positions, oldPos);

  const replayUpdates = [{
    tool: 'claude-cli' as const, session: 's1', project: 'proj',
    requests: [{ request: rOct, price: priceRequest(rOct, RATES_V2) }, { request: rNov, price: priceRequest(rNov, RATES_V1) }],
  }];
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const replayUp = upsertSessionRecord(await read(['2026-10', '2026-11']), replayUpdates);
    assert.deepEqual(replayUp.changed, ['2026-11']);
    assert.equal((await write(ctx, { months: replayUp.months, changed: replayUp.changed, positions: newPos, currentMonth: '2026-11' })).written, true);
  });

  const final = await readSessionRecord(ctx.home, ['2026-10', '2026-11']);
  assert.deepEqual(final, expected);
});

test('sessions is a link (junction with absolute target): held for both read and write, nothing written through it', async () => {
  const ctx = await makeContext();
  const outside = await makeTemp('ck-outside-');
  await writeFile(join(outside, '2026-11.json'), JSON.stringify({ formatVersion: 1, month: '2026-11', pricings: [], sessions: [] }));
  await mkdir(join(ctx.home, '.central-knot'), { recursive: true });
  await symlink(outside, sessionsDirectory(ctx.home), 'junction');

  const read = await readSessionRecord(ctx.home, ['2026-11']);
  assert.deepEqual(read.months, {});
  assert.equal(read.held.length, 1);
  assert.equal(read.held[0]!.file, 'sessions');
  assert.equal(read.held[0]!.kind, 'link');

  const r = claudeReq('s1', 'msg-1', localTime(2026, 11, 5));
  const up = upsertSessionRecord(emptySource(['2026-11']), [{ tool: 'claude-cli', session: 's1', requests: [{ request: r, price: priceRequest(r, RATES_V1) }] }]);
  const res = await writeInTurn(ctx, ['2026-11'], { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' });
  assert.equal(res.written, false);
  assert.equal(res.held[0]!.file, 'sessions');
  assert.equal(res.held[0]!.kind, 'link');
  assert.deepEqual(await readdir(outside), ['2026-11.json'], 'nothing written into link target');
});

test('Nothing before a write: reading a home with no sessions folder returns empty and creates nothing', async () => {
  const ctx = await makeContext();
  await mkdir(ctx.home, { recursive: true });
  const before = await readdir(ctx.home);

  const read = await readSessionRecord(ctx.home, ['2026-10', '2026-11']);
  assert.deepEqual(read, { readMonths: ['2026-10', '2026-11'], months: {}, positions: emptyPositions(), held: [] });
  assert.deepEqual(await readdir(ctx.home), before);
  assert.equal(slashPath(sessionsDirectory(ctx.home)).endsWith('/.central-knot/sessions'), true);
});

test('Tool-reported figure and session metadata: replaced when supplied, preserved when omitted, reported absent from receipts', () => {
  const r = claudeReq('s1', 'msg-1', localTime(2026, 11, 5));
  const priced = { request: r, price: priceRequest(r, RATES_V1) };

  const up1 = upsertSessionRecord(emptySource(['2026-11']), [
    { tool: 'claude-cli', session: 's1', parent: 'p1', project: 'proj-a', unread: 1, reported: { dollars: 0.42, complete: false }, requests: [priced] },
  ]);
  const s1 = up1.months['2026-11']!.sessions[0]!;
  assert.deepEqual(s1.reported, { dollars: 0.42, complete: false });
  assert.equal(s1.parent, 'p1');
  assert.equal(s1.project, 'proj-a');
  assert.equal(s1.unread, 1);
  assert.equal('reported' in s1.requests['msg-1']!, false);
  assert.notEqual(s1.requests['msg-1']!.dollars, 0.42);

  // Omitting optional facts preserves kept values and does not mark changed.
  const up2 = upsertSessionRecord({ readMonths: ['2026-11'], months: up1.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [priced] },
  ]);
  assert.deepEqual(up2.changed, []);
  assert.deepEqual(up2.months['2026-11']!.sessions[0]!.reported, { dollars: 0.42, complete: false });

  // Supplying newer parent, project, unread and reported (even with empty requests) replaces them and marks changed.
  const up3 = upsertSessionRecord({ readMonths: ['2026-11'], months: up2.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', parent: 'p2', project: 'proj-b', unread: 4, reported: { dollars: 0.89, complete: true }, requests: [] },
  ]);
  assert.deepEqual(up3.changed, ['2026-11']);
  const updated = up3.months['2026-11']!.sessions[0]!;
  assert.equal(updated.parent, 'p2');
  assert.equal(updated.project, 'proj-b');
  assert.equal(updated.unread, 4);
  assert.deepEqual(updated.reported, { dollars: 0.89, complete: true });
});

test('Size on disk: 10,000 realistic distinct receipts written as compact JSON fit under 2.5 MB and round-trip cleanly', async () => {
  const ctx = await makeContext();
  const baseAt = localTime(2026, 11, 1, 8, 0);
  const updates: Parameters<typeof upsertSessionRecord>[1][number][] = [];
  const models = ['claude-fable-5', 'claude-opus-5', 'gpt-5'] as const;
  for (let s = 0; s < 250; s++) {
    const isCodex = s % 3 === 0;
    const tool = isCodex ? 'codex-cli' as const : 'claude-cli' as const;
    const session = isCodex ? `019b7b00-0000-7000-8000-${String(s).padStart(12, '0')}` : `session-${String(s).padStart(4, '0')}-abcd-ef01`;
    const requests: { request: Request; price: PriceResult }[] = [];
    for (let i = 0; i < 40; i++) {
      const idx = s * 40 + i;
      const model = isCodex ? 'gpt-5' : models[i % 2]!;
      const req: Request = {
        tool, session, request: isCodex ? `resp_01abc${String(idx).padStart(6, '0')}` : `msg_01xyz${String(idx).padStart(6, '0')}`,
        at: baseAt + idx * 1000, model, ...(isCodex ? { provider: 'openai' } : {}),
        tokens: { input: 500 + (idx % 4000), cacheRead: 12000 + (idx % 80000), cacheWrite: isCodex ? 0 : 1000 + (idx % 3000), output: 150 + (idx % 900) },
      };
      requests.push({ request: req, price: priceRequest(req, bundledRates) });
    }
    updates.push({ tool, session, project: `project-${s % 10}`, unread: 0, requests });
  }
  const up = await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const next = upsertSessionRecord(await read(['2026-11']), updates);
    assert.deepEqual(next.changed, ['2026-11']);
    const written = await write(ctx, { months: next.months, changed: next.changed, positions: emptyPositions(), currentMonth: '2026-11' });
    assert.equal(written.written, true);
    return next;
  });

  const monthPath = join(sessionsDirectory(ctx.home), '2026-11.json');
  const bytes = (await stat(monthPath)).size;
  const t0 = performance.now();
  const readBack = await readSessionRecord(ctx.home, ['2026-11']);
  const readMs = performance.now() - t0;

  const count = readBack.months['2026-11']!.sessions.reduce((n, s) => n + Object.keys(s.requests).length, 0);
  console.log(`Compact month (10,000 receipts): ${bytes} bytes (${(bytes / (1024 * 1024)).toFixed(2)} MB), read back in ${readMs.toFixed(1)} ms`);
  assert.equal(count, 10_000);
  assert.ok(readBack.months['2026-11']!.pricings.length <= 5, 'pricings are interned once per distinct PricingEntry');
  assert.deepEqual(readBack.months, up.months);
  assert.ok(bytes < 2.5 * 1024 * 1024, `expected < 2.5 MB, got ${bytes} bytes`);
});

test('writeAccess says no: nothing is removed or written and the reason is returned', async () => {
  const root = await makeTemp();
  const fakeReal = join(root, 'fake-real');
  await mkdir(join(fakeReal, '.central-knot', 'sessions'), { recursive: true });
  const stray = join(fakeReal, '.central-knot', 'sessions', `2026-11.json.${randomUUID()}.tmp`);
  await writeFile(stray, 'leftover');
  const deniedCtx = await makeContext({ home: fakeReal, realHome: fakeReal, mode: 'custom' });

  const r = claudeReq('s1', 'msg-1', localTime(2026, 11, 5));
  const up = upsertSessionRecord(emptySource(['2026-11']), [{ tool: 'claude-cli', session: 's1', requests: [{ request: r, price: priceRequest(r, RATES_V1) }] }]);
  const resA = await writeInTurn(deniedCtx, ['2026-11'], { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' });
  assert.equal(resA.written, false);
  assert.ok(resA.refused && resA.refused.length > 0);
  assert.deepEqual(resA.held, []);
  assert.equal(await stat(stray).then(() => true, () => false), true, 'stray temp untouched');
  assert.equal(await stat(join(fakeReal, '.central-knot', 'sessions', '2026-11.json')).then(() => true, () => false), false);

  const heldCtx = await makeContext({ held: 'Another build holds this computer.' });
  const resB = await writeInTurn(heldCtx, ['2026-11'], { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' });
  assert.equal(resB.written, false);
  assert.equal(resB.refused, 'Another build holds this computer.');
  assert.equal(await stat(sessionsDirectory(heldCtx.home)).then(() => true, () => false), false);
});

test('Malformed v1 shape and non-regular month entry (directory, link): held and left untouched', async () => {
  const ctx = await makeContext();
  const dir = sessionsDirectory(ctx.home);
  const outside = await makeTemp('ck-month-link-');
  await mkdir(dir, { recursive: true });

  const badIdxPath = join(dir, '2026-08.json');
  const badIdxRaw = JSON.stringify({
    formatVersion: 1, month: '2026-08', pricings: [],
    sessions: [{ tool: 'claude-cli', session: 's1', unread: 0, requests: { m1: { at: 1, model: 'm', tokens: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, dollars: 0.1, pricing: 0 } } }],
  });
  await writeFile(badIdxPath, badIdxRaw);

  const badTokPath = join(dir, '2026-09.json');
  const badTokRaw = JSON.stringify({
    formatVersion: 1, month: '2026-09', pricings: [{ priced: true, basis: 'reported' }],
    sessions: [{ tool: 'claude-cli', session: 's1', unread: 0, requests: { m1: { at: 1, model: 'm', tokens: { input: '1', cacheRead: 0, cacheWrite: 0, output: 1 }, dollars: 0.1, pricing: 0 } } }],
  });
  await writeFile(badTokPath, badTokRaw);

  const dirMonthPath = join(dir, '2026-10.json');
  await mkdir(dirMonthPath);
  const linkMonthPath = join(dir, '2026-11.json');
  await symlink(outside, linkMonthPath, 'junction');

  const badPosPath = join(dir, 'positions.json');
  const badPosRaw = JSON.stringify({ formatVersion: 1, sweptAt: 1, files: [{ tool: 'claude-cli', dev: '1', ino: '2', offset: '0', before: '', size: 0, mtimeMs: 1 }] });
  await writeFile(badPosPath, badPosRaw);

  const read = await readSessionRecord(ctx.home, ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(read.months, {});
  assert.deepEqual(read.held.map(h => [h.file, h.kind]), [
    ['2026-08.json', 'damaged'],
    ['2026-09.json', 'damaged'],
    ['2026-10.json', 'not-a-file'],
    ['2026-11.json', 'link'],
    ['positions.json', 'damaged'],
  ]);
  assert.equal(await readFile(badIdxPath, 'utf8'), badIdxRaw);
  assert.equal(await readFile(badTokPath, 'utf8'), badTokRaw);
  assert.equal((await lstat(dirMonthPath)).isDirectory(), true);
  assert.equal((await lstat(linkMonthPath)).isSymbolicLink(), true);
  assert.equal(await readFile(badPosPath, 'utf8'), badPosRaw);
});

test('Same key and tokens with another model: model and price replaced while first time, session and month stay', () => {
  const firstAt = localTime(2026, 10, 31, 23, 50);
  const r1 = claudeReq('s1', 'msg-remodel', firstAt, { model: 'claude-fable-5' });
  const r2 = claudeReq('s1', 'msg-remodel', localTime(2026, 11, 1, 0, 10), { model: 'claude-opus-5-2026' });
  const p1 = priceRequest(r1, RATES_V1), p2 = priceRequest(r2, RATES_V1);
  assert.ok(p1.priced && p2.priced && p1.dollars !== p2.dollars);

  const up1 = upsertSessionRecord(emptySource(['2026-10', '2026-11']), [{ tool: 'claude-cli', session: 's1', requests: [{ request: r1, price: p1 }] }]);
  const up2 = upsertSessionRecord({ readMonths: ['2026-10', '2026-11'], months: up1.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: r2, price: p2 }] },
  ]);

  assert.deepEqual(up2.changed, ['2026-10']);
  assert.equal(up2.months['2026-11'], undefined);
  const rec = up2.months['2026-10']!.sessions[0]!.requests['msg-remodel']!;
  assert.equal(rec.model, 'claude-opus-5-2026');
  assert.equal(rec.dollars, p2.dollars);
  assert.equal(rec.at, firstAt);
  const pe = up2.months['2026-10']!.pricings[rec.pricing]!;
  assert.equal(pe.priced && pe.basis === 'list' && pe.matched.by, 'rule');
});

test('Request for held month returned as not taken while writable months write normally; empty keys and non-finite times refused', async () => {
  const ctx = await makeContext();
  const dir = sessionsDirectory(ctx.home);
  await mkdir(dir, { recursive: true });
  const heldPath = join(dir, '2026-10.json');
  const heldBytes = Buffer.from('{"formatVersion":2}\n');
  await writeFile(heldPath, heldBytes);

  const rOct = claudeReq('s1', 'msg-oct', localTime(2026, 10, 15));
  const rNov = claudeReq('s1', 'msg-nov', localTime(2026, 11, 15));
  const rEmpty = claudeReq('s1', '', localTime(2026, 11, 15));
  const rNaN = claudeReq('s1', 'msg-nan', Number.NaN);
  const rInf = claudeReq('s1', 'msg-inf', Number.POSITIVE_INFINITY);

  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const before = await read(['2026-10', '2026-11']);
    const up = upsertSessionRecord(before, [{
      tool: 'claude-cli', session: 's1',
      requests: [
        { request: rOct, price: priceRequest(rOct, RATES_V1) },
        { request: rNov, price: priceRequest(rNov, RATES_V1) },
        { request: rEmpty, price: priceRequest(rEmpty, RATES_V1) },
        { request: rNaN, price: priceRequest(rNaN, RATES_V1) },
        { request: rInf, price: priceRequest(rInf, RATES_V1) },
      ],
    }]);
    assert.deepEqual(up.changed, ['2026-11']);
    assert.deepEqual(up.notTaken.map(n => [n.request.request.request, n.reason, n.month]), [
      ['msg-oct', 'held', '2026-10'],
      ['', 'empty-key', undefined],
      ['msg-nan', 'invalid-time', undefined],
      ['msg-inf', 'invalid-time', undefined],
    ]);
    const written = await write(ctx, { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' });
    assert.equal(written.written, true);
  });

  assert.deepEqual(await readFile(heldPath), heldBytes);
  const afterRead = await readSessionRecord(ctx.home, ['2026-10', '2026-11']);
  assert.equal(afterRead.held.length, 1);
  assert.deepEqual(Object.keys(afterRead.months['2026-11']!.sessions[0]!.requests), ['msg-nov']);
});

test('Per-home serialization: concurrent turns never overlap, each sees the previous commit, and stale writers after a turn throw', async () => {
  const ctx = await makeContext();
  let active = 0;
  let overlaps = 0;
  const events: string[] = [];
  const seenCounts: number[] = [];
  const r1 = claudeReq('s1', 'msg-1', localTime(2026, 11, 5));
  const r2 = claudeReq('s1', 'msg-2', localTime(2026, 11, 5, 12, 1));
  let leakedWrite!: (context: ShareContext, input: WriteInput) => Promise<unknown>;

  const turn = (tag: string, req: Request, delayMs: number) =>
    withSessionRecordTurn(ctx.home, async ({ read, write }) => {
      leakedWrite = write;
      active++;
      if (active > 1) overlaps++;
      events.push(`${tag}-start`);
      const rec = await read(['2026-11']);
      seenCounts.push(Object.keys(rec.months['2026-11']?.sessions[0]?.requests ?? {}).length);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      const up = upsertSessionRecord(rec, [{ tool: 'claude-cli', session: 's1', requests: [{ request: req, price: priceRequest(req, RATES_V1) }] }]);
      const res = await write(ctx, { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' });
      assert.equal(res.written, true);
      events.push(`${tag}-end`);
      active--;
    });

  await Promise.all([turn('first', r1, 25), turn('second', r2, 10)]);
  assert.equal(overlaps, 0, 'turns never overlap');
  assert.equal(events.length, 4);
  assert.equal(events[0]!.split('-')[0], events[1]!.split('-')[0], 'first entrant finishes before second starts');
  assert.equal(events[2]!.split('-')[0], events[3]!.split('-')[0], 'second entrant completes cleanly');
  assert.notEqual(events[0]!.split('-')[0], events[2]!.split('-')[0]);
  assert.deepEqual(seenCounts, [0, 1], 'second turn sees the receipt committed by the first');

  const final = await readSessionRecord(ctx.home, ['2026-11']);
  assert.deepEqual(Object.keys(final.months['2026-11']!.sessions[0]!.requests).sort(), ['msg-1', 'msg-2']);
  await assert.rejects(
    leakedWrite(ctx, { months: {}, changed: [], positions: emptyPositions(), currentMonth: '2026-11' }),
    /turn has ended/,
  );
});

test('Prototype-property keys (constructor, toString, __proto__) and all PricingEntry variants round-trip safely', async () => {
  const ctx = await makeContext();
  const at = localTime(2026, 11, 6);
  const reqs: { request: Request; price: PriceResult }[] = [
    { request: claudeReq('s1', 'constructor', at), price: priceRequest(claudeReq('s1', 'constructor', at), RATES_V1) },
    { request: claudeReq('s1', 'toString', at + 1), price: { priced: true, dollars: 0.25, basis: 'reported' } },
    { request: claudeReq('s1', '__proto__', at + 2), price: priceCredits(12) },
  ];
  const up1 = await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const next = upsertSessionRecord(await read(['2026-11']), [{ tool: 'claude-cli', session: 's1', requests: reqs }]);
    assert.equal((await write(ctx, { months: next.months, changed: next.changed, positions: emptyPositions(), currentMonth: '2026-11' })).written, true);
    return next;
  });

  const read = await readSessionRecord(ctx.home, ['2026-11']);
  assert.deepEqual(read.held, []);
  assert.deepEqual(read.months, up1.months);
  const up2 = upsertSessionRecord(read, [{ tool: 'claude-cli', session: 's1', requests: reqs }]);
  assert.deepEqual(up2.changed, []);
  assert.equal(Object.getPrototypeOf(up2.months['2026-11']!.sessions[0]!.requests), Object.prototype);
  assert.equal(monthOf(at), '2026-11');
});

test('Unreadable month file is held as damaged and never overwritten', { skip: lockSkip }, async () => {
  const ctx = await makeContext();
  const dir = sessionsDirectory(ctx.home);
  await mkdir(dir, { recursive: true });
  const file = join(dir, '2026-11.json');
  const raw = JSON.stringify({ formatVersion: 1, month: '2026-11', pricings: [], sessions: [] });
  await writeFile(file, raw);

  await withLock(file, 'file-unreadable', async () => {
    const read = await readSessionRecord(ctx.home, ['2026-11']);
    assert.equal(read.held.length, 1);
    assert.equal(read.held[0]!.file, '2026-11.json');
    assert.equal(read.held[0]!.kind, 'damaged');

    const res = await writeInTurn(ctx, ['2026-11'], {
      months: { '2026-11': { formatVersion: 1, month: '2026-11', pricings: [], sessions: [] } },
      changed: ['2026-11'], positions: emptyPositions(), currentMonth: '2026-11',
    });
    assert.equal(res.written, false);
    assert.equal(res.held[0]!.kind, 'damaged');
  });
  assert.equal(await readFile(file, 'utf8'), raw);
});

test('Unread month is never overwritten: requests for unread months return notTaken and write refuses unread changed months', async () => {
  const ctx = await makeContext();
  const septReq = claudeReq('s1', 'old-sept', localTime(2026, 9, 10));
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const seed = upsertSessionRecord(await read(['2026-09']), [
      { tool: 'claude-cli', session: 's1', requests: [{ request: septReq, price: priceRequest(septReq, RATES_V1) }] },
    ]);
    assert.equal((await write(ctx, { months: seed.months, changed: seed.changed, positions: emptyPositions(), currentMonth: '2026-11' })).written, true);
  });
  const septPath = join(sessionsDirectory(ctx.home), '2026-09.json');
  const septBytes = await readFile(septPath);

  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const before = await read(['2026-10', '2026-11']);
    const newSept = claudeReq('s1', 'new-sept', localTime(2026, 9, 20));
    const novReq = claudeReq('s1', 'new-nov', localTime(2026, 11, 5));
    const up = upsertSessionRecord(before, [{
      tool: 'claude-cli', session: 's1',
      requests: [{ request: newSept, price: priceRequest(newSept, RATES_V1) }, { request: novReq, price: priceRequest(novReq, RATES_V1) }],
    }]);
    assert.deepEqual(up.changed, ['2026-11']);
    assert.equal(up.months['2026-09'], undefined);
    assert.deepEqual(up.notTaken.map(n => [n.request.request.request, n.month, n.reason]), [['new-sept', '2026-09', 'not-read']]);
    assert.equal((await write(ctx, { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' })).written, true);

    // Direct attempt to write a month not read in this turn is also refused without touching disk.
    const refused = await write(ctx, {
      months: { '2026-09': { formatVersion: 1, month: '2026-09', pricings: [], sessions: [] } },
      changed: ['2026-09'], positions: emptyPositions(), currentMonth: '2026-11',
    });
    assert.equal(refused.written, false);
    assert.ok(refused.refused?.includes('2026-09.json'));
  });
  assert.deepEqual(await readFile(septPath), septBytes);
});

test('Reverse-order cross-month duplicate keeps one receipt across all read months, not two', () => {
  const novSighting = claudeReq('nov-sess', 'shared', localTime(2026, 11, 1, 0, 5));
  const octSighting = claudeReq('oct-sess', 'shared', localTime(2026, 10, 31, 23, 55), {
    tokens: { input: 1000, cacheRead: 2000, cacheWrite: 500, output: 600 },
  });
  const up = upsertSessionRecord(emptySource(['2026-10', '2026-11']), [
    { tool: 'claude-cli', session: 'nov-sess', requests: [{ request: novSighting, price: priceRequest(novSighting, RATES_V1) }] },
    { tool: 'claude-cli', session: 'oct-sess', requests: [{ request: octSighting, price: priceRequest(octSighting, RATES_V1) }] },
  ]);
  const all = Object.entries(up.months).flatMap(([m, d]) => d.sessions.flatMap(s => Object.entries(s.requests).map(([id, r]) => ({ m, s: s.session, id, r }))));
  assert.equal(all.length, 1);
  assert.equal(all[0]!.m, '2026-11');
  assert.equal(all[0]!.s, 'nov-sess');
  assert.equal(all[0]!.r.tokens.output, 600);
});

test('Held own month defers before any lookup and leaves earlier months unchanged', async () => {
  const ctx = await makeContext();
  const septReq = claudeReq('s1', 'copied', localTime(2026, 9, 15));
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const seed = upsertSessionRecord(await read(['2026-09']), [
      { tool: 'claude-cli', session: 's1', requests: [{ request: septReq, price: priceRequest(septReq, RATES_V1) }] },
    ]);
    assert.equal((await write(ctx, { months: seed.months, changed: seed.changed, positions: emptyPositions(), currentMonth: '2026-11' })).written, true);
  });
  await writeFile(join(sessionsDirectory(ctx.home), '2026-10.json'), '{"formatVersion":2}');

  const read = await readSessionRecord(ctx.home, ['2026-09', '2026-10', '2026-11']);
  const octCopy = claudeReq('s1', 'copied', localTime(2026, 10, 15), { tokens: { input: 1000, cacheRead: 2000, cacheWrite: 500, output: 900 } });
  const novNew = claudeReq('s1', 'fresh-nov', localTime(2026, 11, 15));
  const up = upsertSessionRecord(read, [{
    tool: 'claude-cli', session: 's1',
    requests: [{ request: octCopy, price: priceRequest(octCopy, RATES_V1) }, { request: novNew, price: priceRequest(novNew, RATES_V1) }],
  }]);
  assert.deepEqual(up.changed, ['2026-11']);
  assert.deepEqual(up.notTaken.map(n => [n.request.request.request, n.month, n.reason]), [['copied', '2026-10', 'held']]);
  assert.equal(up.months['2026-09']!.sessions[0]!.requests['copied']!.tokens.output, 250);
});

test('Session facts (parent, project, unread, reported) are replaced in every read month that holds the session', () => {
  const octReq = claudeReq('s1', 'msg-oct', localTime(2026, 10, 31, 23, 55));
  const novReq = claudeReq('s1', 'msg-nov', localTime(2026, 11, 1, 0, 5));
  const up1 = upsertSessionRecord(emptySource(['2026-10', '2026-11']), [{
    tool: 'claude-cli', session: 's1', parent: 'p-old', project: 'before', unread: 1, reported: { dollars: 0.5, complete: false },
    requests: [{ request: octReq, price: priceRequest(octReq, RATES_V1) }],
  }]);
  const up2 = upsertSessionRecord({ readMonths: ['2026-10', '2026-11'], months: up1.months, held: [] }, [{
    tool: 'claude-cli', session: 's1', parent: 'p-new', project: 'after', unread: 3, reported: { dollars: 1.25, complete: true },
    requests: [{ request: novReq, price: priceRequest(novReq, RATES_V1) }],
  }]);
  assert.deepEqual(up2.changed, ['2026-10', '2026-11']);
  for (const m of ['2026-10', '2026-11']) {
    const s = up2.months[m]!.sessions[0]!;
    assert.equal(s.parent, 'p-new');
    assert.equal(s.project, 'after');
    assert.equal(s.unread, 3);
    assert.deepEqual(s.reported, { dollars: 1.25, complete: true });
  }
});

test('Pricing entry kinds and CodexState fields are validated on read and bad shapes are held as damaged', async () => {
  const ctx = await makeContext();
  const dir = sessionsDirectory(ctx.home);
  await mkdir(dir, { recursive: true });
  const baseReceipt = { at: localTime(2026, 11, 5), model: 'claude-fable-5', tokens: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, dollars: 0.01, pricing: 0 };
  const badMonths: [string, unknown, boolean][] = [
    ['2026-01', { priced: true, basis: 'list', ratesDate: 17, matched: { provider: 'a', model: 'm', by: 'exact', providerFrom: 'tool' } }, true],
    ['2026-02', { priced: true, basis: 'list', ratesDate: '2026-10-01', matched: {} }, true],
    ['2026-03', { priced: true, basis: 'credits' }, true],
    ['2026-04', { priced: true }, true],
    ['2026-05', { priced: false, reason: 4, detail: [] }, false],
    ['2026-06', { priced: true, basis: 'list', ratesDate: '2026-10-01', matched: { provider: 'a', model: 'm', by: 'guessed', providerFrom: 'tool' } }, true],
    ['2026-07', { priced: true, basis: 'list', ratesDate: '2026-10-01', matched: { provider: 'a', model: 'm', by: 'exact', providerFrom: 'guessed' } }, true],
    ['2026-08', { priced: true, basis: 'list', ratesDate: '2026-10-01', atLeast: false, matched: { provider: 'a', model: 'm', by: 'exact', providerFrom: 'tool' } }, true],
  ];
  for (const [m, entry, priced] of badMonths) {
    const rec = priced ? baseReceipt : { ...baseReceipt, dollars: undefined };
    await writeFile(join(dir, `${m}.json`), JSON.stringify({
      formatVersion: 1, month: m, pricings: [entry],
      sessions: [{ tool: 'claude-cli', session: 's1', unread: 0, requests: { m1: rec } }],
    }));
  }
  const read = await readSessionRecord(ctx.home, badMonths.map(([m]) => m));
  assert.deepEqual(read.months, {});
  assert.deepEqual(read.held.map(h => [h.file, h.kind]), badMonths.map(([m]) => [`${m}.json`, 'damaged']));

  for (const badCodex of [{ lastTotal: 'wrong' }, { recordedSince: 'false' }, { session: 99 }, 'not-an-object']) {
    await writeFile(join(dir, 'positions.json'), JSON.stringify({
      formatVersion: 1, sweptAt: 1,
      files: [{ tool: 'codex-cli', dev: '1', ino: '2', offset: 1, before: 'ab', size: 1, mtimeMs: 1, codex: badCodex }],
    }));
    const posRead = await readSessionRecord(ctx.home, []);
    assert.deepEqual(posRead.held.map(h => [h.file, h.kind]), [['positions.json', 'damaged']]);
  }
});

test('Tokens only grow: partial replay under newer rates leaves a whole receipt frozen', () => {
  const at = localTime(2026, 11, 8, 9, 0);
  const partial = claudeReq('s1', 'msg-grow', at, { tokens: { input: 1000, cacheRead: 200, cacheWrite: 100, cacheWrite1h: 50, output: 10 } });
  const whole = claudeReq('s1', 'msg-grow', at + 1000, { tokens: { input: 1000, cacheRead: 200, cacheWrite: 100, cacheWrite1h: 50, output: 400 } });
  const wholePriceV1 = priceRequest(whole, RATES_V1);
  assert.ok(wholePriceV1.priced);

  const up1 = upsertSessionRecord(emptySource(['2026-11']), [
    { tool: 'claude-cli', session: 's1', requests: [{ request: whole, price: wholePriceV1 }] },
  ]);
  const snap = structuredClone(up1.months);
  // Replaying partial then whole under newer rates must not reprice the already-whole receipt.
  const up2 = upsertSessionRecord({ readMonths: ['2026-11'], months: up1.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: partial, price: priceRequest(partial, RATES_V2) }] },
    { tool: 'claude-cli', session: 's1', requests: [{ request: whole, price: priceRequest(whole, RATES_V2) }] },
  ]);
  assert.deepEqual(up2.changed, []);
  assert.deepEqual(up2.months, snap);
  assert.equal(up2.months['2026-11']!.sessions[0]!.requests['msg-grow']!.dollars, wholePriceV1.dollars);

  // Dropping or shrinking cacheWrite1h also leaves the receipt frozen; growing output reprices.
  const dropped1h = claudeReq('s1', 'msg-grow', at + 2000, { tokens: { input: 1000, cacheRead: 200, cacheWrite: 100, output: 400 } });
  const smaller1h = claudeReq('s1', 'msg-grow', at + 2000, { tokens: { input: 1000, cacheRead: 200, cacheWrite: 100, cacheWrite1h: 30, output: 400 } });
  const up3 = upsertSessionRecord({ readMonths: ['2026-11'], months: up2.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: dropped1h, price: priceRequest(dropped1h, RATES_V2) }, { request: smaller1h, price: priceRequest(smaller1h, RATES_V2) }] },
  ]);
  assert.deepEqual(up3.changed, []);

  const larger = claudeReq('s1', 'msg-grow', at + 3000, { tokens: { input: 1000, cacheRead: 200, cacheWrite: 100, cacheWrite1h: 50, output: 500 } });
  const largerPriceV2 = priceRequest(larger, RATES_V2);
  assert.ok(largerPriceV2.priced);
  const up4 = upsertSessionRecord({ readMonths: ['2026-11'], months: up3.months, held: [] }, [
    { tool: 'claude-cli', session: 's1', requests: [{ request: larger, price: largerPriceV2 }] },
  ]);
  assert.deepEqual(up4.changed, ['2026-11']);
  assert.equal(up4.months['2026-11']!.sessions[0]!.requests['msg-grow']!.dollars, largerPriceV2.dollars);
});

test('Not taken is never stored, bad reported figures are ignored, and write refuses invalid v1 output before touching disk', async () => {
  const ctx = await makeContext();
  const good = claudeReq('s1', 'msg-good', localTime(2026, 11, 5));
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const seed = upsertSessionRecord(await read(['2026-11']), [{
      tool: 'claude-cli', session: 's1', reported: { dollars: 0.5, complete: false },
      requests: [{ request: good, price: priceRequest(good, RATES_V1) }],
    }]);
    assert.deepEqual(await write(ctx, { months: seed.months, changed: seed.changed, positions: emptyPositions(), currentMonth: '2026-11' }), { written: true, held: [] });
  });
  const monthPath = join(sessionsDirectory(ctx.home), '2026-11.json');
  const goodBytes = await readFile(monthPath);

  const negTok = claudeReq('s1', 'msg-neg', localTime(2026, 11, 6), { tokens: { input: -1, cacheRead: 0, cacheWrite: 0, output: 10 } });
  const nanTok = claudeReq('s1', 'msg-nan-tok', localTime(2026, 11, 6), { tokens: { input: 10, cacheRead: 0, cacheWrite: 0, output: Number.NaN } });
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const before = await read(['2026-11']);
    const up = upsertSessionRecord(before, [
      {
        tool: 'claude-cli', session: 's1', reported: { dollars: -2, complete: true },
        requests: [{ request: negTok, price: priceRequest(negTok, RATES_V1) }, { request: nanTok, price: priceRequest(nanTok, RATES_V1) }],
      },
      { tool: 'claude-cli', session: 's1', reported: { dollars: Number.NaN, complete: true }, requests: [] },
    ]);
    assert.deepEqual(up.notTaken.map(n => [n.request.request.request, n.reason, n.month]), [
      ['msg-neg', 'invalid-tokens', undefined],
      ['msg-nan-tok', 'invalid-tokens', undefined],
    ]);
    assert.deepEqual(up.changed, []);
    assert.deepEqual(Object.keys(up.months['2026-11']!.sessions[0]!.requests), ['msg-good']);
    assert.deepEqual(up.months['2026-11']!.sessions[0]!.reported, { dollars: 0.5, complete: false });
    assert.deepEqual(await write(ctx, { months: up.months, changed: up.changed, positions: emptyPositions(), currentMonth: '2026-11' }), { written: true, held: [] });

    // A zero reported figure is finite and >= 0, so it is accepted.
    const upZero = upsertSessionRecord(before, [{ tool: 'claude-cli', session: 's1', reported: { dollars: 0, complete: true }, requests: [] }]);
    assert.deepEqual(upZero.changed, ['2026-11']);
    assert.deepEqual(upZero.months['2026-11']!.sessions[0]!.reported, { dollars: 0, complete: true });

    // Direct write of a month or positions that the reader would hold is refused before touching disk.
    const badMonth = structuredClone(before.months['2026-11']!);
    badMonth.sessions[0]!.reported = { dollars: -1, complete: true };
    const refusedMonth = await write(ctx, { months: { '2026-11': badMonth }, changed: ['2026-11'], positions: emptyPositions(), currentMonth: '2026-11' });
    assert.equal(refusedMonth.written, false);
    assert.match(refusedMonth.refused ?? '', /2026-11\.json/);
    assert.deepEqual(refusedMonth.held, []);

    const badPos = {
      formatVersion: 1 as const, sweptAt: 1,
      files: [{ tool: 'codex-cli' as const, dev: '1', ino: '2', offset: 1, before: 'ab', size: 1, mtimeMs: 1, codex: { recordedSince: 'false' as unknown as boolean } }],
    };
    const refusedPos = await write(ctx, { months: before.months, changed: [], positions: badPos, currentMonth: '2026-11' });
    assert.equal(refusedPos.written, false);
    assert.match(refusedPos.refused ?? '', /positions\.json/);
    assert.deepEqual(refusedPos.held, []);
  });
  assert.deepEqual(await readFile(monthPath), goodBytes);
  const reread = await readSessionRecord(ctx.home, ['2026-11']);
  assert.deepEqual(reread.held, []);
  assert.deepEqual(Object.keys(reread.months['2026-11']!.sessions[0]!.requests), ['msg-good']);
});

test('Session facts are applied in every read month holding the session even when none of its requests was taken', () => {
  const sepOther = claudeReq('other-sess', 'copied-id', localTime(2026, 9, 10));
  const octOwn = claudeReq('s1', 'oct-id', localTime(2026, 10, 15));
  const novOwn = claudeReq('s1', 'nov-id', localTime(2026, 11, 15));
  const up1 = upsertSessionRecord(emptySource(['2026-09', '2026-10', '2026-11']), [
    { tool: 'claude-cli', session: 'other-sess', requests: [{ request: sepOther, price: priceRequest(sepOther, RATES_V1) }] },
    {
      tool: 'claude-cli', session: 's1', parent: 'p1', project: 'before', unread: 1, reported: { dollars: 1.25, complete: false },
      requests: [{ request: octOwn, price: priceRequest(octOwn, RATES_V1) }, { request: novOwn, price: priceRequest(novOwn, RATES_V1) }],
    },
  ]);

  const copiedSighting = claudeReq('s1', 'copied-id', localTime(2026, 11, 16));
  const up2 = upsertSessionRecord({ readMonths: ['2026-09', '2026-10', '2026-11'], months: up1.months, held: [] }, [{
    tool: 'claude-cli', session: 's1', parent: 'p2', project: 'after', unread: 4, reported: { dollars: 2.0, complete: true },
    requests: [{ request: copiedSighting, price: priceRequest(copiedSighting, RATES_V1) }],
  }]);
  assert.deepEqual(up2.notTaken, []);
  assert.deepEqual(up2.changed, ['2026-10', '2026-11']);
  for (const m of ['2026-10', '2026-11']) {
    const s = up2.months[m]!.sessions.find(x => x.session === 's1')!;
    assert.equal(s.parent, 'p2');
    assert.equal(s.project, 'after');
    assert.equal(s.unread, 4);
    assert.deepEqual(s.reported, { dollars: 2.0, complete: true });
  }
});

test('Out-of-range timestamps and years past 9999 return invalid-time, never not-read', () => {
  const cases = [
    claudeReq('s1', 'overflow-pos', 8640000000000001),
    claudeReq('s1', 'overflow-neg', -8640000000000001),
    claudeReq('s1', 'year-10000', Date.UTC(10000, 5, 1)),
    claudeReq('s1', 'year-neg', Date.UTC(-1, 5, 1)),
  ];
  const up = upsertSessionRecord(emptySource(['2026-11']), [{
    tool: 'claude-cli', session: 's1',
    requests: cases.map(req => ({ request: req, price: priceRequest(req, RATES_V1) })),
  }]);
  assert.deepEqual(up.changed, []);
  assert.deepEqual(up.notTaken.map(n => [n.request.request.request, n.reason, n.month]), [
    ['overflow-pos', 'invalid-time', undefined],
    ['overflow-neg', 'invalid-time', undefined],
    ['year-10000', 'invalid-time', undefined],
    ['year-neg', 'invalid-time', undefined],
  ]);
});
