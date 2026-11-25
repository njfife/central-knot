// The session sweep (src/sessionsweep.ts), as worked examples on made-up session files in made-up homes.
// Defaults TZ away from UTC when unset so UTC-month handling is exercised independently of the host time zone.
process.env.TZ ||= 'America/New_York';

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { appendFile, copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SESSION_TOOLS } from '../src/presence.ts';
import { bundledRates, priceRequest, type RatesTable } from '../src/rates.ts';
import { keptReading, readSessionPeriod, type Period } from '../src/sessionday.ts';
import {
  emptyPositions,
  monthOf,
  readSessionRecord,
  sessionsDirectory,
  withSessionRecordTurn,
} from '../src/sessionrecord.ts';
import { readClaudeSession, readCodexRollout } from '../src/sessionrequests.ts';
import { sessionRows } from '../src/sessionrow.ts';
import { sweepSessions } from '../src/sessionsweep.ts';
import type { ShareContext } from '../src/share.ts';
import { lockSkip, makeWritableTree, withLock } from './fslock.ts';
import { slashPath } from './wincompat.ts';

const tempRoots: string[] = [];
const makeTemp = async (prefix = 'ck-sessionsweep-') => {
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

const makeContext = async (overrides: Partial<ShareContext> = {}): Promise<ShareContext> => {
  const root = await makeTemp();
  return {
    home: join(root, 'home'),
    mode: 'custom',
    read: async () => [],
    build: 'test-build',
    settingsPath: join(root, 'settings.json'),
    realHome: join(root, 'real'),
    now: () => Date.UTC(2026, 10, 24, 16, 0, 0),
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
        {
          id: 'claude-opus-5-5',
          match: { equals: 'claude-opus-5-5' },
          prices: { input: claudeIn, cacheRead: 0.5, cacheWrite: 6, cacheWrite1h: 10, output: claudeOut },
        },
        {
          id: 'claude-haiku-4-5-20251001',
          match: { equals: 'claude-haiku-4-5-20251001' },
          prices: { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 },
        },
      ],
    },
    {
      id: 'openai',
      models: [
        {
          id: 'gpt-5',
          match: { equals: 'gpt-5' },
          prices: { input: gptIn, cacheRead: 0.125, output: gptOut },
        },
      ],
    },
  ],
});

const RATES_V1 = makeRates('2026-10-01', 5, 25, 1.25, 10);
const RATES_V2 = makeRates('2026-11-15', 10, 50, 2.5, 20);

const lines = (records: object[]) => records.map(record => `${JSON.stringify(record)}\n`).join('');
async function put(path: string, records: object[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines(records));
}

const claudeUsage = (input: number, cacheRead: number, cacheWrite: number, output: number, hour = 0) => ({
  input_tokens: input,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
  output_tokens: output,
  cache_creation: { ephemeral_5m_input_tokens: cacheWrite - hour, ephemeral_1h_input_tokens: hour },
  service_tier: 'standard',
  speed: 'standard',
});

const claudeResp = (
  id: string,
  at: string | number,
  used: object,
  model = 'claude-opus-5-5',
  cwd = join('work', 'app'),
) => ({
  type: 'assistant',
  sessionId: 'one',
  cwd,
  isSidechain: false,
  timestamp: at,
  message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'Done.' }], usage: used },
});

const claudeCost = (usd: number, unknown = false) => ({
  type: 'cost-state',
  sessionId: 'one',
  totalCostUSD: usd,
  modelUsage: {},
  hasUnknownModelCost: unknown,
});

const claudeUser = (at: string, cwd = join('work', 'app')) => ({
  type: 'user',
  sessionId: 'one',
  cwd,
  timestamp: at,
  message: { role: 'user', content: 'Go on.' },
});

const codexMeta = (id: string, cwd = join('work', 'codex-app'), parent?: string) => ({
  timestamp: '2026-11-24T15:29:03.000Z',
  type: 'session_meta',
  payload: {
    session_id: parent ?? id,
    id,
    ...(parent ? { parent_thread_id: parent } : {}),
    cwd,
    model_provider: 'openai',
  },
});

const codexTurn = (model: string, at: string, cwd = join('work', 'codex-app')) => ({
  timestamp: at,
  type: 'turn_context',
  payload: { turn_id: `turn-${at}`, cwd, model, summary: 'none' },
});

const codexUsage = (id: string, at: string, input: number, cached: number, output: number) => ({
  timestamp: at,
  type: 'token_usage_record',
  payload: {
    response_id: id,
    usage: {
      input_tokens: input,
      cached_input_tokens: cached,
      cache_write_input_tokens: 0,
      output_tokens: output,
      reasoning_output_tokens: 0,
      total_tokens: input + output,
    },
  },
});

const codexCounter = (at: string, input: number, cached: number, output: number) => ({
  timestamp: at,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: 0,
        total_tokens: input + output,
      },
      last_token_usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: 0,
        total_tokens: input + output,
      },
    },
  },
});

test('1. First sweep: two Claude Code sessions (one with an agent) and one Codex rollout land once with prices and positions', async () => {
  const ctx = await makeContext();
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  await put(join(project, 'sess-1.jsonl'), [
    claudeResp('msg_1', '2026-11-24T15:00:00.000Z', claudeUsage(1000, 2000, 500, 200, 100)),
    claudeCost(0.0125, false),
  ]);
  await put(join(project, 'sess-1', 'subagents', 'agent-a1.jsonl'), [
    {
      ...claudeResp('msg_agent', '2026-11-24T15:01:00.000Z', claudeUsage(500, 1000, 0, 100), 'claude-haiku-4-5-20251001'),
      isSidechain: true,
    },
  ]);
  await put(join(project, 'sess-2.jsonl'), [
    claudeResp('msg_2', '2026-11-24T15:05:00.000Z', claudeUsage(400, 0, 0, 50), 'claude-opus-5-5', join('work', 'other')),
    claudeCost(0.05, true),
  ]);
  const codexFile = join(ctx.home, '.codex', 'sessions', '2026', '11', '24', 'rollout-one.jsonl');
  await put(codexFile, [
    codexMeta('thread-1'),
    codexTurn('gpt-5', '2026-11-24T15:10:00.000Z'),
    codexUsage('resp_1', '2026-11-24T15:10:05.000Z', 1200, 400, 150),
  ]);

  const result = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal(result.wrote, true);
  assert.equal(result.stopped, false);
  assert.deepEqual(result.held, []);
  assert.deepEqual(result.taken, { requests: 4, sessions: 4 });
  assert.equal(result.byTool['claude-cli'].requests, 3);
  assert.equal(result.byTool['claude-cli'].sessions, 3);
  assert.equal(result.byTool['codex-cli'].requests, 1);
  assert.equal(result.byTool['codex-cli'].sessions, 1);

  const record = await readSessionRecord(ctx.home, ['2026-11']);
  assert.deepEqual(record.held, []);
  assert.equal(record.positions.files.length, 4);
  assert.equal(record.positions.sweptAt, Date.UTC(2026, 10, 24, 16, 0, 0));

  const month = record.months['2026-11']!;
  const s1 = month.sessions.find(s => s.tool === 'claude-cli' && s.session === 'sess-1')!;
  const agent = month.sessions.find(s => s.tool === 'claude-cli' && s.session === 'agent-a1')!;
  const s2 = month.sessions.find(s => s.tool === 'claude-cli' && s.session === 'sess-2')!;
  const codex = month.sessions.find(s => s.tool === 'codex-cli' && s.session === 'thread-1')!;

  assert.equal(s1.project, 'app');
  assert.equal(s1.reported, undefined, 'sweep keeps no reported figure');
  assert.equal(agent.parent, 'sess-1');
  assert.equal(agent.project, 'app');
  assert.equal(s2.project, 'other');
  assert.equal(s2.reported, undefined, 'sweep keeps no reported figure');
  assert.equal(codex.project, 'codex-app');

  const expectedP1 = priceRequest({
    tool: 'claude-cli',
    at: Date.parse('2026-11-24T15:00:00.000Z'),
    model: 'claude-opus-5-5',
    tokens: { input: 1000, cacheRead: 2000, cacheWrite: 500, cacheWrite1h: 100, output: 200 },
    speed: 'standard',
    serviceTier: 'standard',
  }, RATES_V1);
  assert.ok(expectedP1.priced);
  assert.equal(s1.requests['msg_1']!.dollars, expectedP1.dollars);

  const expectedCodex = priceRequest({
    tool: 'codex-cli',
    at: Date.parse('2026-11-24T15:10:05.000Z'),
    model: 'gpt-5',
    provider: 'openai',
    tokens: { input: 800, cacheRead: 400, cacheWrite: 0, output: 150 },
  }, RATES_V1);
  assert.ok(expectedCodex.priced);
  assert.equal(codex.requests['resp_1']!.dollars, expectedCodex.dollars);
});

test('2. Nothing new: second sweep reads no file past stat and touches no file in sessions', async () => {
  const ctx = await makeContext();
  await put(join(ctx.home, '.claude', 'projects', '-work-app', 'one.jsonl'), [
    claudeResp('msg_1', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 20)),
  ]);
  await put(join(ctx.home, '.codex', 'sessions', '2026', '11', '24', 'rollout-one.jsonl'), [
    codexMeta('thread-1'),
    codexTurn('gpt-5', '2026-11-24T15:01:00.000Z'),
    codexUsage('resp_1', '2026-11-24T15:01:05.000Z', 500, 100, 50),
  ]);
  assert.equal((await sweepSessions(ctx, { rates: RATES_V1 })).wrote, true);

  const dir = sessionsDirectory(ctx.home);
  const names = (await readdir(dir)).sort();
  const snapBefore = await Promise.all(names.map(async name => {
    const file = join(dir, name);
    const info = await stat(file, { bigint: true });
    return { name, mtimeNs: info.mtimeNs, bytes: await readFile(file) };
  }));

  let reads = 0;
  const second = await sweepSessions(
    { ...ctx, now: () => Date.UTC(2026, 10, 24, 17, 0, 0) },
    {
      rates: RATES_V1,
      deps: {
        readClaude: async (...args) => { reads++; return readClaudeSession(...args); },
        readCodex: async (...args) => { reads++; return readCodexRollout(...args); },
      },
    },
  );
  assert.equal(reads, 0, 'nothing read past stat');
  assert.equal(second.wrote, false);
  assert.deepEqual(second.taken, { requests: 0, sessions: 0 });

  assert.deepEqual((await readdir(dir)).sort(), names);
  for (const before of snapBefore) {
    const file = join(dir, before.name);
    const info = await stat(file, { bigint: true });
    assert.equal(info.mtimeNs, before.mtimeNs, `${before.name} mtime untouched`);
    assert.deepEqual(await readFile(file), before.bytes, `${before.name} bytes untouched`);
  }
});

test('3. A file that grew: only that file is read from its position; partial request becomes whole and new request lands', async () => {
  const ctx = await makeContext();
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  const file1 = join(project, 'grow.jsonl');
  const file2 = join(project, 'still.jsonl');
  await put(file1, [claudeResp('msg_part', '2026-11-24T15:00:00.000Z', claudeUsage(500, 0, 0, 10))]);
  await put(file2, [claudeResp('msg_still', '2026-11-24T15:00:10.000Z', claudeUsage(300, 0, 0, 30))]);
  assert.equal((await sweepSessions(ctx, { rates: RATES_V1 })).taken.requests, 2);

  await appendFile(file1, lines([
    claudeResp('msg_part', '2026-11-24T15:00:05.000Z', claudeUsage(500, 0, 0, 400)),
    claudeResp('msg_new', '2026-11-24T15:01:00.000Z', claudeUsage(200, 1000, 0, 80)),
  ]));

  const readPaths: string[] = [];
  const usedOffsets: (number | undefined)[] = [];
  const second = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => {
        readPaths.push(slashPath(of.file));
        usedOffsets.push(from?.offset);
        return readClaudeSession(of, from);
      },
    },
  });
  assert.deepEqual(readPaths, [slashPath(file1)], 'only the grown file was read');
  assert.ok(usedOffsets[0] !== undefined && usedOffsets[0] > 0, 'read resumed from saved offset');
  assert.equal(second.wrote, true);
  assert.deepEqual(second.taken, { requests: 2, sessions: 1 });

  const rec = await readSessionRecord(ctx.home, ['2026-11']);
  const s = rec.months['2026-11']!.sessions.find(x => x.session === 'grow')!;
  assert.deepEqual(Object.keys(s.requests).sort(), ['msg_new', 'msg_part']);
  assert.equal(s.requests['msg_part']!.tokens.output, 400);
  assert.equal(s.requests['msg_part']!.at, Date.parse('2026-11-24T15:00:00.000Z'), 'kept original timestamp');
});

test('4. Parity with the Sessions page: identical rows and sums for disjoint sessions, and page less repeats for resumed sessions', async () => {
  const period: Period = {
    start: new Date(2026, 10, 24, 0, 0, 0, 0).getTime(),
    end: new Date(2026, 10, 25, 0, 0, 0, 0).getTime(),
  };
  const atLocal = (hours: number, mins = 0, secs = 0) => new Date(period.start + ((hours * 60 + mins) * 60 + secs) * 1000).toISOString();
  const periodMonths = [...new Set([monthOf(period.start), monthOf(period.end - 1)])];
  const ctx = await makeContext({ now: () => period.start + 16 * 3_600_000 });
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  await put(join(project, 'root.jsonl'), [
    claudeResp('msg_r1', atLocal(10, 0), claudeUsage(1000, 2000, 500, 250, 100), 'claude-haiku-4-5-20251001'),
  ]);
  await put(join(project, 'root', 'subagents', 'agent-1.jsonl'), [
    {
      ...claudeResp('msg_c1', atLocal(10, 5), claudeUsage(400, 100, 0, 90), 'claude-haiku-4-5-20251001'),
      isSidechain: true,
    },
  ]);
  await put(join(ctx.home, '.codex', 'sessions', '2026', '11', '24', 'rollout-a.jsonl'), [
    codexMeta('thread-a'),
    codexTurn('gpt-5', atLocal(10, 10)),
    codexUsage('resp_a1', atLocal(10, 10, 5), 1000, 200, 120),
  ]);

  await sweepSessions(ctx);
  const kept = await readSessionRecord(ctx.home, periodMonths);
  const pageReading = await readSessionPeriod({ home: ctx.home }, period, [...SESSION_TOOLS]);
  const pageRows = sessionRows(pageReading);
  const recordRows = sessionRows(keptReading(kept, period, SESSION_TOOLS));
  assert.deepEqual(recordRows, pageRows, 'disjoint sessions produce identical rows and sums');

  // Add a resumed Claude session repeating `msg_r1` and adding a new request `msg_r2`.
  await put(join(project, 'resumed.jsonl'), [
    claudeResp('msg_r1', atLocal(10, 0), claudeUsage(1000, 2000, 500, 250, 100), 'claude-haiku-4-5-20251001'),
    claudeResp('msg_r2', atLocal(11, 0), claudeUsage(600, 0, 0, 100), 'claude-haiku-4-5-20251001'),
  ]);
  await sweepSessions(ctx);
  const keptAfter = await readSessionRecord(ctx.home, periodMonths);
  const pageAfter = sessionRows(await readSessionPeriod({ home: ctx.home }, period, [...SESSION_TOOLS]));
  const recordAfter = sessionRows(keptReading(keptAfter, period, SESSION_TOOLS));

  const repeatedPrice = priceRequest({
    tool: 'claude-cli',
    at: Date.parse(atLocal(10, 0)),
    model: 'claude-haiku-4-5-20251001',
    tokens: { input: 1000, cacheRead: 2000, cacheWrite: 500, cacheWrite1h: 100, output: 250 },
    speed: 'standard',
    serviceTier: 'standard',
  }, bundledRates);
  assert.ok(repeatedPrice.priced);
  assert.equal(pageAfter.total.tokens.input - recordAfter.total.tokens.input, 1000, 'repeat msg_r1 input excluded once');
  assert.equal(pageAfter.total.tokens.output - recordAfter.total.tokens.output, 250, 'repeat msg_r1 output excluded once');
  assert.ok(
    Math.abs((pageAfter.total.cost.dollars! - recordAfter.total.cost.dollars!) - repeatedPrice.dollars) < 1e-12,
    'record sum equals page sum less repeated key msg_r1',
  );
});

test('5. Moved file continues from its position with nothing twice; copied file is read whole with nothing twice', async () => {
  const ctx = await makeContext();
  const live = join(ctx.home, '.codex', 'sessions', '2026', '11', '24', 'rollout-move.jsonl');
  await put(live, [
    codexMeta('thread-move'),
    codexTurn('gpt-5', '2026-11-24T15:00:00.000Z'),
    codexUsage('resp_1', '2026-11-24T15:00:05.000Z', 1000, 200, 100),
  ]);
  await sweepSessions(ctx, { rates: RATES_V1 });

  // Move rollout to archived_sessions (same inode) and append a second response.
  const archived = join(ctx.home, '.codex', 'archived_sessions', 'rollout-move.jsonl');
  await mkdir(dirname(archived), { recursive: true });
  await rename(live, archived);
  await appendFile(archived, lines([codexUsage('resp_2', '2026-11-24T15:05:00.000Z', 600, 100, 80)]));

  let startedOverAfterMove: boolean | undefined;
  let readCountAfterMove = 0;
  const moveRes = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readCodex: async (file, from) => {
        const res = await readCodexRollout(file, from);
        startedOverAfterMove = res.startedOver;
        readCountAfterMove = res.requests.length;
        return res;
      },
    },
  });
  assert.equal(startedOverAfterMove, false, 'moved rollout resumed from saved position and Codex state');
  assert.equal(readCountAfterMove, 1, 'only the appended response was read');
  assert.deepEqual(moveRes.taken, { requests: 1, sessions: 1 });
  const afterMove = await readSessionRecord(ctx.home, ['2026-11']);
  assert.equal(afterMove.positions.files.length, 1);
  assert.deepEqual(Object.keys(afterMove.months['2026-11']!.sessions[0]!.requests).sort(), ['resp_1', 'resp_2']);

  // Copy archived rollout to a second path (new inode): read whole, nothing counted twice, both positions saved.
  const copied = join(ctx.home, '.codex', 'archived_sessions', 'rollout-copy.jsonl');
  await copyFile(archived, copied);
  let copyReadRequests = 0;
  const copyRes = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readCodex: async (file, from) => {
        const res = await readCodexRollout(file, from);
        copyReadRequests += res.requests.length;
        return res;
      },
    },
  });
  assert.equal(copyReadRequests, 2, 'copy read whole');
  assert.equal(copyRes.wrote, true, 'copy position saved');
  assert.deepEqual(copyRes.taken, { requests: 0, sessions: 0 }, 'nothing counted twice');
  const afterCopy = await readSessionRecord(ctx.home, ['2026-11']);
  assert.equal(afterCopy.positions.files.length, 2);
  assert.deepEqual(Object.keys(afterCopy.months['2026-11']!.sessions[0]!.requests).sort(), ['resp_1', 'resp_2']);
});

test('6. Inode reused (injected matching dev/ino with differing before) and file cut short and rewritten are read whole; old receipts stay', async () => {
  const ctx = await makeContext();
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  const file1 = join(project, 'old.jsonl');
  await put(file1, [claudeResp('msg_old', '2026-11-24T15:00:00.000Z', claudeUsage(500, 0, 0, 50))]);
  await sweepSessions(ctx, { rates: RATES_V1 });
  const firstPos = (await readSessionRecord(ctx.home, ['2026-11'])).positions.files[0]!;

  // Remove file1 and create a longer file2, then inject a position with file2's real dev/ino and file1's mismatched `before`.
  await rm(file1);
  const file2 = join(project, 'reused.jsonl');
  await put(file2, [
    claudeResp('msg_new_1', '2026-11-24T15:10:00.000Z', claudeUsage(600, 0, 0, 60)),
    claudeResp('msg_new_2', '2026-11-24T15:11:00.000Z', claudeUsage(700, 0, 0, 70)),
  ]);
  const st2 = await stat(file2, { bigint: true });
  assert.ok(Number(st2.size) > firstPos.size);
  await withSessionRecordTurn(ctx.home, async ({ read, write }) => {
    const cur = await read(['2026-11']);
    const injected = {
      ...cur.positions,
      files: [{ ...firstPos, dev: String(st2.dev), ino: String(st2.ino) }],
    };
    assert.equal((await write(ctx, { months: cur.months, changed: [], positions: injected, currentMonth: '2026-11' })).written, true);
  });

  let sawStartedOver = false;
  const reuseRes = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => {
        const res = await readClaudeSession(of, from);
        if (of.session === 'reused') sawStartedOver = res.startedOver;
        return res;
      },
    },
  });
  assert.equal(sawStartedOver, true, 'differing `before` triggered start-over');
  assert.deepEqual(reuseRes.taken, { requests: 2, sessions: 1 });

  // Truncate and rewrite file2 shorter in place with a fresh request: read whole, old receipts stay.
  await writeFile(file2, lines([claudeResp('msg_short', '2026-11-24T15:20:00.000Z', claudeUsage(200, 0, 0, 20))]));
  let sawTruncatedStartOver = false;
  await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => {
        const res = await readClaudeSession(of, from);
        sawTruncatedStartOver = res.startedOver;
        return res;
      },
    },
  });
  assert.equal(sawTruncatedStartOver, true);
  const rec = await readSessionRecord(ctx.home, ['2026-11']);
  const oldSess = rec.months['2026-11']!.sessions.find(s => s.session === 'old')!;
  const reusedSess = rec.months['2026-11']!.sessions.find(s => s.session === 'reused')!;
  assert.deepEqual(Object.keys(oldSess.requests), ['msg_old']);
  assert.deepEqual(Object.keys(reusedSess.requests).sort(), ['msg_new_1', 'msg_new_2', 'msg_short']);
});

test('7. A held older month keeps its file at its old position while sibling files advance; next sweep retries it', async () => {
  const ctx = await makeContext();
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  const fileHeld = join(project, 'held-session.jsonl');
  const fileOk = join(project, 'ok-session.jsonl');
  const codexHeld = join(ctx.home, '.codex', 'sessions', '2026', '11', '24', 'rollout-held.jsonl');

  // Seed initial clean sweep so every file has a saved position (and Codex state).
  await put(fileHeld, [claudeResp('msg_init_h', '2026-11-05T12:00:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await put(fileOk, [claudeResp('msg_init_o', '2026-11-05T12:00:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await put(codexHeld, [
    codexMeta('thread-h'),
    codexTurn('gpt-5', '2026-11-05T12:00:00.000Z'),
    codexUsage('resp_init_h', '2026-11-05T12:00:05.000Z', 100, 0, 10),
  ]);
  await sweepSessions(ctx, { rates: RATES_V1 });
  const beforePos = (await readSessionRecord(ctx.home, ['2026-11'])).positions.files;
  const heldIno = String((await stat(fileHeld, { bigint: true })).ino);
  const okIno = String((await stat(fileOk, { bigint: true })).ino);
  const oldHeldPos = beforePos.find(p => p.ino === heldIno)!;
  const oldCodexPos = beforePos.find(p => p.tool === 'codex-cli')!;

  // Hold 2026-10.json (newer formatVersion), then append an Oct + Nov request to fileHeld, an Oct request to codexHeld, and a Nov request to fileOk.
  const octPath = join(sessionsDirectory(ctx.home), '2026-10.json');
  const heldRaw = '{"formatVersion":2}\n';
  await writeFile(octPath, heldRaw);
  await appendFile(fileHeld, lines([
    claudeResp('msg_oct_blocked', '2026-10-20T12:00:00.000Z', claudeUsage(200, 0, 0, 20)),
    claudeResp('msg_nov_taken', '2026-11-20T12:00:00.000Z', claudeUsage(300, 0, 0, 30)),
  ]));
  await appendFile(codexHeld, lines([codexUsage('resp_oct_blocked', '2026-10-21T12:00:00.000Z', 200, 0, 20)]));
  await appendFile(fileOk, lines([claudeResp('msg_ok_2', '2026-11-21T12:00:00.000Z', claudeUsage(400, 0, 0, 40))]));

  const heldRes = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal(heldRes.wrote, true);
  assert.equal(heldRes.refused, undefined);
  assert.equal(heldRes.notTaken.held, 2);
  assert.equal(heldRes.held.some(h => h.file === '2026-10.json' && h.kind === 'newer'), true);
  assert.equal(heldRes.taken.requests, 2, 'msg_nov_taken and msg_ok_2 both landed');
  assert.equal(await readFile(octPath, 'utf8'), heldRaw, 'held month untouched');

  const mid = await readSessionRecord(ctx.home, ['2026-11']);
  const midHeldPos = mid.positions.files.find(p => p.ino === oldHeldPos.ino)!;
  const midCodexPos = mid.positions.files.find(p => p.tool === 'codex-cli')!;
  const midOkPos = mid.positions.files.find(p => p.ino === okIno)!;
  assert.deepEqual(midHeldPos, oldHeldPos, 'held-month file kept its old position');
  assert.deepEqual(midCodexPos, oldCodexPos, 'held-month Codex file kept its old position and CodexState');
  assert.ok(midOkPos.offset > oldHeldPos.offset, 'unaffected file advanced');

  // Remove the held file; next sweep retries only the held files and takes both October requests without duplicating November.
  await rm(octPath);
  const retriedPaths: string[] = [];
  const retryRes = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => { retriedPaths.push(slashPath(of.file)); return readClaudeSession(of, from); },
      readCodex: async (file, from) => { retriedPaths.push(slashPath(file)); return readCodexRollout(file, from); },
    },
  });
  assert.deepEqual(retriedPaths.sort(), [slashPath(fileHeld), slashPath(codexHeld)].sort(), 'fileOk not reread');
  assert.equal(retryRes.notTaken.held, 0);
  assert.equal(retryRes.taken.requests, 2);
  const after = await readSessionRecord(ctx.home, ['2026-10', '2026-11']);
  assert.ok(after.months['2026-10']!.sessions.find(s => s.session === 'held-session')!.requests['msg_oct_blocked']);
  assert.ok(after.months['2026-10']!.sessions.find(s => s.session === 'thread-h')!.requests['resp_oct_blocked']);
});

test('8 & 19. Stopped after the first of two batches: first batch landed with positions, second stays at old positions; next sweep matches whole sweep', async () => {
  const ctxSplit = await makeContext();
  const ctxWhole = await makeContext();
  const seedHome = async (home: string) => {
    const project = join(home, '.claude', 'projects', '-work-app');
    for (let i = 0; i < 80; i++) {
      const id = String(i).padStart(3, '0');
      await put(join(project, `s-${id}.jsonl`), [
        claudeResp(`msg_init_${id}`, '2026-11-24T12:00:00.000Z', claudeUsage(100, 0, 0, 10)),
      ]);
    }
  };
  await seedHome(ctxSplit.home);
  await seedHome(ctxWhole.home);
  await sweepSessions(ctxSplit, { rates: RATES_V1 });
  await sweepSessions(ctxWhole, { rates: RATES_V1 });
  const oldPositions = (await readSessionRecord(ctxSplit.home, ['2026-11'])).positions.files;
  const oldOffsetByIno = new Map(oldPositions.map(p => [p.ino, p.offset]));

  // Grow all 80 files in both homes.
  for (const home of [ctxSplit.home, ctxWhole.home]) {
    const project = join(home, '.claude', 'projects', '-work-app');
    for (let i = 0; i < 80; i++) {
      const id = String(i).padStart(3, '0');
      await appendFile(
        join(project, `s-${id}.jsonl`),
        lines([claudeResp(`msg_grow_${id}`, '2026-11-24T15:00:00.000Z', claudeUsage(200, 0, 0, 20))]),
      );
    }
  }

  // Whole uninterrupted sweep in ctxWhole.
  await sweepSessions(ctxWhole, { rates: RATES_V1 });

  // Stopped sweep in ctxSplit: abort once batch 1 (64 files) has been read.
  const controller = new AbortController();
  let readInSplit = 0;
  const part1 = await sweepSessions(ctxSplit, {
    rates: RATES_V1,
    signal: controller.signal,
    deps: {
      readClaude: async (of, from) => {
        const res = await readClaudeSession(of, from);
        readInSplit++;
        if (readInSplit === 64) controller.abort();
        return res;
      },
    },
  });
  assert.equal(part1.stopped, true);
  assert.equal(part1.wrote, true);
  assert.deepEqual(part1.taken, { requests: 64, sessions: 64 });

  const mid = await readSessionRecord(ctxSplit.home, ['2026-11']);
  const midSessions = new Map(mid.months['2026-11']!.sessions.map(s => [s.session, s]));
  const midPosByIno = new Map(mid.positions.files.map(p => [p.ino, p.offset]));
  const splitProject = join(ctxSplit.home, '.claude', 'projects', '-work-app');
  for (let i = 0; i < 80; i++) {
    const id = String(i).padStart(3, '0');
    const ino = String((await stat(join(splitProject, `s-${id}.jsonl`), { bigint: true })).ino);
    if (i < 64) {
      assert.ok(midSessions.get(`s-${id}`)!.requests[`msg_grow_${id}`], `batch 1 file ${id} landed`);
      assert.ok(midPosByIno.get(ino)! > oldOffsetByIno.get(ino)!, `batch 1 file ${id} position advanced`);
    } else {
      assert.equal(midSessions.get(`s-${id}`)!.requests[`msg_grow_${id}`], undefined, `batch 2 file ${id} untouched`);
      assert.equal(midPosByIno.get(ino), oldOffsetByIno.get(ino), `batch 2 file ${id} kept old position`);
    }
  }

  // Second sweep finishes only the remaining 16 files and converges with the uninterrupted sweep.
  let readInPart2 = 0;
  const part2 = await sweepSessions(ctxSplit, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => { readInPart2++; return readClaudeSession(of, from); },
    },
  });
  assert.equal(part2.stopped, false);
  assert.equal(readInPart2, 16);
  assert.deepEqual(part2.taken, { requests: 16, sessions: 16 });

  const finalSplit = await readSessionRecord(ctxSplit.home, ['2026-11']);
  const finalWhole = await readSessionRecord(ctxWhole.home, ['2026-11']);
  assert.deepEqual(finalSplit.months, finalWhole.months, 'split sweep converges with uninterrupted sweep');
});

test('9. Interrupted write replayed: landed months keep frozen prices under newer rates; replay converges', async () => {
  // Part A: crash after both months are written and before positions.json, then replay under RATES_V2.
  const ctxA = await makeContext();
  const ctxClean = await makeContext();
  for (const home of [ctxA.home, ctxClean.home]) {
    await put(join(home, '.claude', 'projects', '-work-app', 'span.jsonl'), [
      claudeResp('msg_oct', '2026-10-28T12:00:00.000Z', claudeUsage(1000, 0, 0, 200)),
      claudeResp('msg_nov', '2026-11-05T12:00:00.000Z', claudeUsage(1000, 0, 0, 200)),
    ]);
  }
  await sweepSessions(ctxClean, { rates: RATES_V1 });
  const expectedClean = await readSessionRecord(ctxClean.home, ['2026-10', '2026-11']);

  const originalRename = fs.rename;
  let renames = 0;
  try {
    fs.rename = async (source, destination) => {
      renames++;
      if (renames === 3) throw Object.assign(new Error('crash before positions'), { code: 'EIO' });
      return originalRename(source, destination);
    };
    syncBuiltinESMExports();
    await assert.rejects(sweepSessions(ctxA, { rates: RATES_V1 }), { code: 'EIO' });
  } finally {
    fs.rename = originalRename;
    syncBuiltinESMExports();
  }
  const midA = await readSessionRecord(ctxA.home, ['2026-10', '2026-11']);
  assert.ok(midA.months['2026-10'] && midA.months['2026-11']);
  assert.deepEqual(midA.positions, emptyPositions(), 'positions not yet written');

  const replayA = await sweepSessions(ctxA, { rates: RATES_V2 });
  assert.equal(replayA.wrote, true);
  assert.deepEqual(replayA.taken, { requests: 0, sessions: 0 }, 'both receipts already landed');
  const finalA = await readSessionRecord(ctxA.home, ['2026-10', '2026-11']);
  assert.deepEqual(finalA.months, expectedClean.months, 'landed receipts kept frozen RATES_V1 prices under RATES_V2');
  assert.equal(finalA.positions.files.length, 1);

  // Part B: crash after 2026-10.json is written and before 2026-11.json; replay pins RATES_V2 for unwritten 2026-11 while keeping 2026-10 frozen at RATES_V1.
  const ctxB = await makeContext();
  await put(join(ctxB.home, '.claude', 'projects', '-work-app', 'span.jsonl'), [
    claudeResp('msg_oct', '2026-10-28T12:00:00.000Z', claudeUsage(1000, 0, 0, 200)),
    claudeResp('msg_nov', '2026-11-05T12:00:00.000Z', claudeUsage(1000, 0, 0, 200)),
  ]);
  renames = 0;
  try {
    fs.rename = async (source, destination) => {
      renames++;
      if (renames === 2) throw Object.assign(new Error('crash after first month'), { code: 'EIO' });
      return originalRename(source, destination);
    };
    syncBuiltinESMExports();
    await assert.rejects(sweepSessions(ctxB, { rates: RATES_V1 }), { code: 'EIO' });
  } finally {
    fs.rename = originalRename;
    syncBuiltinESMExports();
  }
  const replayB = await sweepSessions(ctxB, { rates: RATES_V2 });
  assert.deepEqual(replayB.taken, { requests: 1, sessions: 1 });
  const finalB = await readSessionRecord(ctxB.home, ['2026-10', '2026-11']);
  const pV1 = priceRequest({
    tool: 'claude-cli', at: Date.parse('2026-10-28T12:00:00.000Z'), model: 'claude-opus-5-5',
    tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 200 }, speed: 'standard', serviceTier: 'standard',
  }, RATES_V1);
  const pV2 = priceRequest({
    tool: 'claude-cli', at: Date.parse('2026-11-05T12:00:00.000Z'), model: 'claude-opus-5-5',
    tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 200 }, speed: 'standard', serviceTier: 'standard',
  }, RATES_V2);
  assert.ok(pV1.priced && pV2.priced && pV1.dollars !== pV2.dollars);
  assert.equal(finalB.months['2026-10']!.sessions[0]!.requests['msg_oct']!.dollars, pV1.dollars, 'landed Oct receipt unmoved');
  assert.equal(finalB.months['2026-11']!.sessions[0]!.requests['msg_nov']!.dollars, pV2.dollars, 'unwritten Nov receipt uses replay rates');
});

test('10. Incomplete listing keeps every position of that tool and flags unreadListing; complete listing drops gone file while keeping receipts', async t => {
  const ctx = await makeContext();
  const projA = join(ctx.home, '.claude', 'projects', '-work-a');
  const projB = join(ctx.home, '.claude', 'projects', '-work-b');
  const fileA = join(projA, 'sess-a.jsonl');
  const fileB = join(projB, 'sess-b.jsonl');
  const codexFile = join(ctx.home, '.codex', 'sessions', '2026', '11', '24', 'rollout-c.jsonl');
  await put(fileA, [claudeResp('msg_a', '2026-11-24T12:00:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await put(fileB, [claudeResp('msg_b', '2026-11-24T12:01:00.000Z', claudeUsage(200, 0, 0, 20))]);
  await put(codexFile, [
    codexMeta('thread-c'),
    codexTurn('gpt-5', '2026-11-24T12:02:00.000Z'),
    codexUsage('resp_c', '2026-11-24T12:02:05.000Z', 300, 0, 30),
  ]);
  await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal((await readSessionRecord(ctx.home, ['2026-11'])).positions.files.length, 3);

  // Inject an incomplete Claude listing missing fileB while Codex's file is removed on disk (complete Codex listing).
  await rm(codexFile);
  const partial = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      listClaude: async () => ({ files: [{ file: fileA, session: 'sess-a' }], unread: true }),
    },
  });
  assert.equal(partial.byTool['claude-cli'].unreadListing, true);
  assert.equal(partial.byTool['codex-cli'].unreadListing, false);
  const afterPartial = await readSessionRecord(ctx.home, ['2026-11']);
  assert.equal(afterPartial.positions.files.filter(f => f.tool === 'claude-cli').length, 2, 'neither Claude position dropped');
  assert.equal(afterPartial.positions.files.filter(f => f.tool === 'codex-cli').length, 0, 'complete Codex listing dropped gone rollout');
  assert.ok(afterPartial.months['2026-11']!.sessions.find(s => s.session === 'thread-c')!.requests['resp_c'], 'Codex receipt stays');

  // Remove fileB and run a complete sweep: fileB's position drops while its receipt stays.
  await rm(fileB);
  const complete = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal(complete.byTool['claude-cli'].unreadListing, false);
  assert.equal(complete.wrote, true);
  const afterComplete = await readSessionRecord(ctx.home, ['2026-11']);
  assert.equal(afterComplete.positions.files.length, 1);
  assert.ok(afterComplete.months['2026-11']!.sessions.find(s => s.session === 'sess-b')!.requests['msg_b'], 'gone file receipt stays');

  await t.test('filesystem unreadable folder via tests/fslock.ts keeps positions and flags unreadListing', { skip: lockSkip }, async () => {
    await put(fileB, [claudeResp('msg_b2', '2026-11-24T12:10:00.000Z', claudeUsage(200, 0, 0, 20))]);
    await sweepSessions(ctx, { rates: RATES_V1 });
    assert.equal((await readSessionRecord(ctx.home, ['2026-11'])).positions.files.length, 2);
    await withLock(projB, 'dir-unreadable', async () => {
      const locked = await sweepSessions(ctx, { rates: RATES_V1 });
      assert.equal(locked.byTool['claude-cli'].unreadListing, true);
      assert.equal((await readSessionRecord(ctx.home, ['2026-11'])).positions.files.length, 2);
    });
  });
});

test('11. Codex older keys on two threads keep two receipts; resumed Claude Code session keeps one receipt per request id', async () => {
  const ctx = await makeContext();
  const codexDir = join(ctx.home, '.codex', 'sessions', '2026', '11', '24');
  await put(join(codexDir, 'rollout-1.jsonl'), [
    codexMeta('thread-1'),
    codexTurn('gpt-5', '2026-11-24T15:00:00.000Z'),
    codexCounter('2026-11-24T15:00:05.000Z', 500, 100, 40),
  ]);
  await put(join(codexDir, 'rollout-2.jsonl'), [
    codexMeta('thread-2'),
    codexTurn('gpt-5', '2026-11-24T15:00:00.000Z'),
    codexCounter('2026-11-24T15:00:05.000Z', 500, 100, 40),
  ]);
  const claudeDir = join(ctx.home, '.claude', 'projects', '-work-app');
  await put(join(claudeDir, 'a-first.jsonl'), [
    claudeResp('msg_1', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10)),
    claudeResp('msg_2', '2026-11-24T15:01:00.000Z', claudeUsage(200, 0, 0, 20)),
  ]);
  await put(join(claudeDir, 'b-resumed.jsonl'), [
    claudeResp('msg_1', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10)),
    claudeResp('msg_2', '2026-11-24T15:01:00.000Z', claudeUsage(200, 0, 0, 20)),
    claudeResp('msg_3', '2026-11-24T15:02:00.000Z', claudeUsage(300, 0, 0, 30)),
  ]);

  const res = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal(res.byTool['codex-cli'].requests, 2);
  assert.equal(res.byTool['claude-cli'].requests, 3);
  const month = (await readSessionRecord(ctx.home, ['2026-11'])).months['2026-11']!;
  const codexReceipts = month.sessions.filter(s => s.tool === 'codex-cli').flatMap(s => Object.keys(s.requests));
  const claudeReceipts = month.sessions.filter(s => s.tool === 'claude-cli').flatMap(s => Object.keys(s.requests));
  assert.equal(codexReceipts.length, 2, 'two Codex threads with identical older time-and-total keep two receipts');
  assert.deepEqual(claudeReceipts.sort(), ['msg_1', 'msg_2', 'msg_3'], 'resumed Claude session repeats kept once');
});

test('12. Requests that can never be kept (empty Claude id, invalid time, injected invalid tokens) are counted and passed', async () => {
  const ctx = await makeContext();
  const file = join(ctx.home, '.claude', 'projects', '-work-app', 'bad-reqs.jsonl');
  await put(file, [
    claudeResp('', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10)),
    claudeResp('msg_future', Date.UTC(10000, 5, 1), claudeUsage(100, 0, 0, 10)),
    claudeResp('msg_good', '2026-11-24T15:01:00.000Z', claudeUsage(200, 0, 0, 20)),
  ]);

  const first = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => {
        const res = await readClaudeSession(of, from);
        res.requests.push({
          tool: 'claude-cli',
          session: of.session,
          request: 'msg_bad_tokens',
          at: Date.parse('2026-11-24T15:02:00.000Z'),
          model: 'claude-opus-5-5',
          tokens: { input: -5, cacheRead: 0, cacheWrite: 0, output: 10 },
        });
        return res;
      },
    },
  });
  assert.equal(first.wrote, true);
  assert.deepEqual(first.taken, { requests: 1, sessions: 1 });
  assert.deepEqual(first.notTaken, { held: 0, notRead: 0, never: 3 });

  let readsOnSecond = 0;
  const second = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => { readsOnSecond++; return readClaudeSession(of, from); },
    },
  });
  assert.equal(readsOnSecond, 0, 'position moved past permanent rejections; file not reread');
  assert.equal(second.wrote, false);
  assert.deepEqual(second.notTaken, { held: 0, notRead: 0, never: 0 });
});

test('13. notBefore: a sweep asked before notBefore does nothing and returns skipped: not-before', async () => {
  const now = Date.UTC(2026, 10, 24, 16, 0, 0);
  const ctx = await makeContext({ now: () => now });
  await put(join(ctx.home, '.claude', 'projects', '-work-app', 'one.jsonl'), [
    claudeResp('msg_1', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10)),
  ]);
  let listed = 0;
  const skipped = await sweepSessions(ctx, {
    rates: RATES_V1,
    notBefore: now + 60_000,
    deps: {
      listClaude: async () => { listed++; return { files: [], unread: false }; },
      listCodex: async () => { listed++; return { files: [], unread: false }; },
    },
  });
  assert.equal(skipped.skipped, 'not-before');
  assert.equal(skipped.wrote, false);
  assert.equal(skipped.stopped, false);
  assert.equal(skipped.sweptAt, now);
  assert.equal(listed, 0, 'did not even list files');
  assert.equal(await stat(sessionsDirectory(ctx.home)).then(() => true, () => false), false, 'created nothing');

  const ran = await sweepSessions({ ...ctx, now: () => now + 60_000 }, { rates: RATES_V1, notBefore: now + 60_000 });
  assert.equal(ran.skipped, undefined);
  assert.equal(ran.wrote, true);
  assert.equal(ran.taken.requests, 1);
});

test('14 (light). Twenty files per tool (40 requests each): first sweep, no-op sweep, and ten grown files take every request once and stay under 1 MB', async () => {
  const ctx = await makeContext();
  const claudeDir = join(ctx.home, '.claude', 'projects', '-work-app');
  const codexDir = join(ctx.home, '.codex', 'sessions', '2026', '11', '24');
  const claudePaths: string[] = [];
  for (let f = 0; f < 20; f++) {
    const cPath = join(claudeDir, `c-${String(f).padStart(2, '0')}.jsonl`);
    claudePaths.push(cPath);
    const cRecs: object[] = [];
    for (let r = 0; r < 40; r++) {
      cRecs.push(claudeResp(`cm-${f}-${r}`, new Date(Date.UTC(2026, 10, 24, 10, f, r)).toISOString(), claudeUsage(200 + r, 1000, 100, 50)));
    }
    await put(cPath, cRecs);
    const xPath = join(codexDir, `rollout-${String(f).padStart(2, '0')}.jsonl`);
    const xRecs: object[] = [codexMeta(`t-${f}`), codexTurn('gpt-5', '2026-11-24T10:00:00.000Z')];
    for (let r = 0; r < 40; r++) {
      xRecs.push(codexUsage(`xr-${f}-${r}`, new Date(Date.UTC(2026, 10, 24, 11, f, r)).toISOString(), 400 + r, 100, 60));
    }
    await put(xPath, xRecs);
  }

  const first = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.deepEqual(first.taken, { requests: 1_600, sessions: 40 });
  const noop = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal(noop.wrote, false);
  assert.deepEqual(noop.taken, { requests: 0, sessions: 0 });

  for (let i = 0; i < 10; i++) {
    await appendFile(claudePaths[i]!, lines([claudeResp(`cm-grow-${i}`, '2026-11-24T15:50:00.000Z', claudeUsage(300, 0, 0, 30))]));
  }
  const grown = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.deepEqual(grown.taken, { requests: 10, sessions: 10 });
  const monthBytes = (await stat(join(sessionsDirectory(ctx.home), '2026-11.json'))).size;
  assert.ok(monthBytes > 0 && monthBytes < 1_000_000);
});

test('15. A file that cannot be opened or stat-ed is counted, keeps its position, and leaves the rest swept', async t => {
  const ctx = await makeContext();
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  const blocked = join(project, 'blocked.jsonl');
  const good = join(project, 'good.jsonl');
  await put(blocked, [claudeResp('msg_b1', '2026-11-24T12:00:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await put(good, [claudeResp('msg_g1', '2026-11-24T12:00:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await sweepSessions(ctx, { rates: RATES_V1 });
  const posBefore = (await readSessionRecord(ctx.home, ['2026-11'])).positions.files;
  const blockedIno = String((await stat(blocked, { bigint: true })).ino);
  const oldBlockedPos = posBefore.find(p => p.ino === blockedIno)!;

  await appendFile(blocked, lines([claudeResp('msg_b2', '2026-11-24T13:00:00.000Z', claudeUsage(100, 0, 0, 10))]));
  await appendFile(good, lines([claudeResp('msg_g2', '2026-11-24T13:00:00.000Z', claudeUsage(200, 0, 0, 20))]));

  const openFail = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => {
        if (of.session === 'blocked') throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return readClaudeSession(of, from);
      },
    },
  });
  assert.equal(openFail.byTool['claude-cli'].unreadableFiles, 1);
  assert.equal(openFail.taken.requests, 1);
  const afterOpenFail = await readSessionRecord(ctx.home, ['2026-11']);
  assert.deepEqual(afterOpenFail.positions.files.find(p => p.ino === blockedIno), oldBlockedPos, 'old position kept on open failure');
  assert.ok(afterOpenFail.months['2026-11']!.sessions.find(s => s.session === 'good')!.requests['msg_g2']);

  // A stat failure leaves unresolved identities, so unseen checkpoints of that tool are preserved too.
  const ghost = join(project, 'ghost.jsonl');
  await put(ghost, [claudeResp('msg_ghost', '2026-11-24T13:05:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal((await readSessionRecord(ctx.home, ['2026-11'])).positions.files.length, 3);
  await rm(ghost);
  const statFail = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      statFile: async path => {
        if (slashPath(path) === slashPath(blocked)) throw Object.assign(new Error('stat denied'), { code: 'EACCES' });
        return stat(path, { bigint: true });
      },
    },
  });
  assert.equal(statFail.byTool['claude-cli'].unreadableFiles, 1);
  assert.equal((await readSessionRecord(ctx.home, ['2026-11'])).positions.files.length, 3, 'unresolved stat preserves unseen checkpoints');

  await t.test('filesystem unreadable file via tests/fslock.ts is counted and keeps its position', { skip: lockSkip }, async () => {
    await sweepSessions(ctx, { rates: RATES_V1 });
    await appendFile(blocked, lines([claudeResp('msg_b3', '2026-11-24T14:00:00.000Z', claudeUsage(100, 0, 0, 10))]));
    const beforeLock = (await readSessionRecord(ctx.home, ['2026-11'])).positions.files.find(p => p.ino === blockedIno)!;
    await withLock(blocked, 'file-unreadable', async () => {
      const res = await sweepSessions(ctx, { rates: RATES_V1 });
      assert.equal(res.byTool['claude-cli'].unreadableFiles, 1);
      assert.deepEqual((await readSessionRecord(ctx.home, ['2026-11'])).positions.files.find(p => p.ino === blockedIno), beforeLock);
    });
  });
});

test('16. A malformed line between two valid lines is counted, passed, and both requests are taken', async () => {
  const ctx = await makeContext();
  const file = join(ctx.home, '.claude', 'projects', '-work-app', 'malformed.jsonl');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, [
    lines([claudeResp('msg_1', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10))]),
    '{"type":"assistant","broken\n',
    lines([claudeResp('msg_2', '2026-11-24T15:01:00.000Z', claudeUsage(200, 0, 0, 20))]),
  ].join(''));

  const res = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.deepEqual(res.taken, { requests: 2, sessions: 1 });
  assert.equal(res.byTool['claude-cli'].unreadLines, 1);
  const kept = (await readSessionRecord(ctx.home, ['2026-11'])).months['2026-11']!.sessions[0]!;
  assert.equal(kept.unread, 1);
  assert.deepEqual(Object.keys(kept.requests).sort(), ['msg_1', 'msg_2']);

  // Appending a clean request preserves the earlier unread count.
  await appendFile(file, lines([claudeResp('msg_3', '2026-11-24T15:02:00.000Z', claudeUsage(300, 0, 0, 30))]));
  const res2 = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal(res2.byTool['claude-cli'].unreadLines, 0);
  const kept2 = (await readSessionRecord(ctx.home, ['2026-11'])).months['2026-11']!.sessions[0]!;
  assert.equal(kept2.unread, 1, 'clean tail does not wipe earlier unread count');
});

test('17. Global holds stop a sweep that has something to take (nothing written, answer says why); an idle sweep does not open the current month', async () => {
  for (const kind of ['current-month', 'positions', 'sessions-link'] as const) {
    const ctx = await makeContext();
    await put(join(ctx.home, '.claude', 'projects', '-work-app', 'one.jsonl'), [
      claudeResp('msg_1', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10)),
    ]);
    const dir = sessionsDirectory(ctx.home);
    let expectedFile: string;
    if (kind === 'sessions-link') {
      const outside = await makeTemp('ck-outside-');
      await mkdir(dirname(dir), { recursive: true });
      await symlink(outside, dir, 'junction');
      expectedFile = 'sessions';
    } else {
      await mkdir(dir, { recursive: true });
      expectedFile = kind === 'current-month' ? '2026-11.json' : 'positions.json';
      await writeFile(join(dir, expectedFile), '{"formatVersion":2}\n');
    }

    const res = await sweepSessions(ctx, { rates: RATES_V1 });
    assert.equal(res.wrote, false, `${kind}: wrote is false`);
    assert.deepEqual(res.taken, { requests: 0, sessions: 0 });
    assert.ok(res.refused && res.refused.length > 0, `${kind}: refused states why`);
    assert.equal(res.held.some(h => h.file === expectedFile), true, `${kind}: held names ${expectedFile}`);
    if (kind !== 'sessions-link') {
      assert.equal(await readFile(join(dir, expectedFile), 'utf8'), '{"formatVersion":2}\n');
      if (kind === 'current-month') {
        assert.equal(await stat(join(dir, 'positions.json')).then(() => true, () => false), false, 'positions not created');
      }
    }
  }

  // An idle sweep reads positions.json, lists and stats without opening the current month (even if it is held).
  const idleCtx = await makeContext();
  const file = join(idleCtx.home, '.claude', 'projects', '-work-app', 'idle.jsonl');
  await put(file, [claudeResp('msg_i1', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await sweepSessions(idleCtx, { rates: RATES_V1 });
  const monthPath = join(sessionsDirectory(idleCtx.home), '2026-11.json');
  await writeFile(monthPath, '{"formatVersion":2}\n');
  const idle = await sweepSessions(idleCtx, { rates: RATES_V1 });
  assert.equal(idle.wrote, false);
  assert.equal(idle.refused, undefined, 'idle sweep never opened the current month');
  assert.deepEqual(idle.held, []);

  // Once the file grows (something to take), the turn reads the current month, reports the hold, and writes nothing.
  await appendFile(file, lines([claudeResp('msg_i2', '2026-11-24T15:05:00.000Z', claudeUsage(100, 0, 0, 10))]));
  const active = await sweepSessions(idleCtx, { rates: RATES_V1 });
  assert.equal(active.wrote, false);
  assert.equal(active.held.some(h => h.file === '2026-11.json'), true);
  assert.ok(active.refused && active.refused.includes('2026-11.json'));
});

test('18. Yielding between batches: a timer set before three batches fires between them (and batchRequests caps a batch at 2,000)', async () => {
  const ctx = await makeContext();
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  // 130 files -> 3 default batches (64 + 64 + 2).
  for (let i = 0; i < 130; i++) {
    await put(join(project, `y-${String(i).padStart(3, '0')}.jsonl`), [
      claudeResp(`ym_${i}`, '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10)),
    ]);
  }
  let readsDone = 0;
  let timerFiredAt = -1;
  const timer = setTimeout(() => { timerFiredAt = readsDone; }, 0);
  const res = await sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      readClaude: async (of, from) => {
        const out = await readClaudeSession(of, from);
        readsDone++;
        return out;
      },
    },
  });
  clearTimeout(timer);
  assert.equal(res.taken.requests, 130);
  assert.ok(timerFiredAt >= 0 && timerFiredAt < 130, `timer fired mid-sweep at read ${timerFiredAt}`);

  // Microtask-only second sweep of the same 130 unchanged files: fails immediately if yieldTurn() between batches is removed.
  const cachedStats = new Map<string, Awaited<ReturnType<typeof stat>>>();
  for (let i = 0; i < 130; i++) {
    const file = join(project, `y-${String(i).padStart(3, '0')}.jsonl`);
    cachedStats.set(file, await stat(file, { bigint: true }));
  }
  const listedFiles = [...cachedStats.keys()].map(file => ({ file, session: 's' }));
  let statsDone = 0;
  let immediateAt = -1;
  const second = sweepSessions(ctx, {
    rates: RATES_V1,
    deps: {
      listClaude: async () => ({ files: listedFiles, unread: false }),
      listCodex: async () => ({ files: [], unread: false }),
      statFile: async file => {
        statsDone++;
        if (statsDone === 1) setImmediate(() => { immediateAt = statsDone; });
        return cachedStats.get(file)! as unknown as import('node:fs').BigIntStats;
      },
    },
  });
  await second;
  assert.equal(immediateAt, 64, 'setImmediate fired cleanly right after the 64-file first batch');

  // Verify the 2,000-request batch threshold yields after the file crossing 2,000 requests (4 * 500 = 2,000, before file 5).
  const ctxReq = await makeContext();
  const reqProj = join(ctxReq.home, '.claude', 'projects', '-work-big');
  for (let f = 0; f < 5; f++) {
    const recs: object[] = [];
    for (let r = 0; r < 500; r++) {
      recs.push(claudeResp(`big_${f}_${r}`, '2026-11-24T15:00:00.000Z', claudeUsage(10, 0, 0, 5)));
    }
    await put(join(reqProj, `big-${f}.jsonl`), recs);
  }
  const controller = new AbortController();
  let filesRead = 0;
  const reqSplit = await sweepSessions(ctxReq, {
    rates: RATES_V1,
    signal: controller.signal,
    deps: {
      readClaude: async (of, from) => {
        const out = await readClaudeSession(of, from);
        filesRead++;
        if (filesRead === 4) controller.abort();
        return out;
      },
    },
  });
  assert.equal(reqSplit.stopped, true);
  assert.equal(filesRead, 4, 'stopped between batch 1 (2,000 requests across 4 files) and batch 2 (file 5)');
  assert.equal(reqSplit.taken.requests, 2_000);
});

test('20. Copy made before original is read, and reverse order: one receipt each time under whichever was read first', async () => {
  // Order A: copy swept first, then original added and swept.
  const ctxCopyFirst = await makeContext();
  const projA = join(ctxCopyFirst.home, '.claude', 'projects', '-work-app');
  await put(join(projA, 'copy.jsonl'), [claudeResp('msg_same', '2026-11-24T15:00:00.000Z', claudeUsage(200, 0, 0, 20))]);
  await sweepSessions(ctxCopyFirst, { rates: RATES_V1 });
  await copyFile(join(projA, 'copy.jsonl'), join(projA, 'orig.jsonl'));
  await sweepSessions(ctxCopyFirst, { rates: RATES_V1 });
  const recA = (await readSessionRecord(ctxCopyFirst.home, ['2026-11'])).months['2026-11']!;
  assert.equal(recA.sessions.length, 1);
  assert.equal(recA.sessions[0]!.session, 'copy');
  assert.deepEqual(Object.keys(recA.sessions[0]!.requests), ['msg_same']);

  // Order B: original swept first, then copy added and swept.
  const ctxOrigFirst = await makeContext();
  const projB = join(ctxOrigFirst.home, '.claude', 'projects', '-work-app');
  await put(join(projB, 'orig.jsonl'), [claudeResp('msg_same', '2026-11-24T15:00:00.000Z', claudeUsage(200, 0, 0, 20))]);
  await sweepSessions(ctxOrigFirst, { rates: RATES_V1 });
  await copyFile(join(projB, 'orig.jsonl'), join(projB, 'copy.jsonl'));
  await sweepSessions(ctxOrigFirst, { rates: RATES_V1 });
  const recB = (await readSessionRecord(ctxOrigFirst.home, ['2026-11'])).months['2026-11']!;
  assert.equal(recB.sessions.length, 1);
  assert.equal(recB.sessions[0]!.session, 'orig');
  assert.deepEqual(Object.keys(recB.sessions[0]!.requests), ['msg_same']);

  // Both present before a single sweep: deterministic path order keeps one receipt under whichever was read first.
  const ctxBoth = await makeContext();
  const projC = join(ctxBoth.home, '.claude', 'projects', '-work-app');
  await put(join(projC, 'a-copy.jsonl'), [claudeResp('msg_both', '2026-11-24T15:00:00.000Z', claudeUsage(200, 0, 0, 20))]);
  await copyFile(join(projC, 'a-copy.jsonl'), join(projC, 'z-orig.jsonl'));
  const bothRes = await sweepSessions(ctxBoth, { rates: RATES_V1 });
  assert.deepEqual(bothRes.taken, { requests: 1, sessions: 1 });
  const recC = (await readSessionRecord(ctxBoth.home, ['2026-11'])).months['2026-11']!;
  assert.equal(recC.sessions.length, 1);
  assert.equal(recC.sessions[0]!.session, 'a-copy');
});

test('21. Request at a month end met first from the later side: one receipt kept in the later month', async () => {
  // Run in January 2027 so neither November nor December is currentMonth: finding December on the November sighting relies on monthsAround.
  const ctx = await makeContext({ now: () => Date.UTC(2027, 0, 15, 1, 0, 0) });
  const project = join(ctx.home, '.claude', 'projects', '-work-app');
  const file = join(project, 'boundary.jsonl');
  await put(file, [claudeResp('msg_edge', '2026-12-01T00:05:00.000Z', claudeUsage(500, 0, 0, 20))]);
  await sweepSessions(ctx, { rates: RATES_V1 });

  // Later sighting carries an earlier timestamp across the UTC month boundary (2026-11-30) with fuller tokens.
  await appendFile(file, lines([claudeResp('msg_edge', '2026-11-30T23:55:00.000Z', claudeUsage(500, 0, 0, 400))]));
  const res = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.deepEqual(res.taken, { requests: 1, sessions: 1 });

  const kept = await readSessionRecord(ctx.home, ['2026-11', '2026-12']);
  assert.equal(kept.months['2026-11'], undefined, 'not duplicated into November');
  const decRec = kept.months['2026-12']!.sessions[0]!.requests['msg_edge']!;
  assert.equal(decRec.at, Date.parse('2026-12-01T00:05:00.000Z'), 'kept first timestamp and month');
  assert.equal(decRec.tokens.output, 400, 'updated with fuller tokens');
});

test('Facts-only tail patching, position-only progress, idle unread listing, and writeAccess refusal', async () => {
  // Facts-only tail in November patches unread and continuing project on a session whose requests live only in October.
  const ctx = await makeContext({ now: () => Date.UTC(2026, 9, 31, 23, 50, 0) });
  const file = join(ctx.home, '.claude', 'projects', '-work-app', 'oct-sess.jsonl');
  await put(file, [
    claudeResp('msg_oct', '2026-10-31T23:45:00.000Z', claudeUsage(500, 0, 0, 50)),
    claudeCost(0.01, false),
  ]);
  await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal((await readSessionRecord(ctx.home, ['2026-10'])).months['2026-10']!.sessions[0]!.reported, undefined);

  // In November (currentMonth = 2026-11), append ONLY a malformed line and a continuing user line with a new cwd (project).
  await appendFile(file, `{broken-tail\n${lines([claudeUser('2026-11-15T12:00:00.000Z', join('work', 'renamed'))])}`);
  const novCtx = { ...ctx, now: () => Date.UTC(2026, 10, 15, 12, 0, 0) };
  const tailRes = await sweepSessions(novCtx, { rates: RATES_V1 });
  assert.equal(tailRes.wrote, true);
  assert.equal(tailRes.byTool['claude-cli'].unreadLines, 1);
  const octAfter = (await readSessionRecord(ctx.home, ['2026-10', '2026-11'])).months['2026-10']!.sessions[0]!;
  assert.equal(octAfter.reported, undefined);
  assert.equal(octAfter.unread, 1, 'facts-only tail updated unread in older kept month');
  assert.equal(octAfter.project, 'renamed', 'facts-only tail updated continuing project in older kept month');

  // Position-only progress (non-request user line appended): writes positions so the next sweep does not reread.
  await appendFile(file, lines([claudeUser('2026-11-15T12:01:00.000Z', join('work', 'renamed'))]));
  const posOnly = await sweepSessions(novCtx, { rates: RATES_V1 });
  assert.equal(posOnly.wrote, true);
  assert.deepEqual(posOnly.taken, { requests: 0, sessions: 0 });
  let readsAfterPosOnly = 0;
  const idleAfter = await sweepSessions(novCtx, {
    rates: RATES_V1,
    deps: { readClaude: async (of, from) => { readsAfterPosOnly++; return readClaudeSession(of, from); } },
  });
  assert.equal(readsAfterPosOnly, 0);
  assert.equal(idleAfter.wrote, false);

  // Idle sweep with an unreadable listing still opens no month file (even when current month is held).
  const heldNov = join(sessionsDirectory(ctx.home), '2026-11.json');
  await writeFile(heldNov, '{"formatVersion":2}\n');
  const idleUnread = await sweepSessions(novCtx, {
    rates: RATES_V1,
    deps: {
      listClaude: async () => ({ files: [{ file, session: 'oct-sess' }], unread: true }),
    },
  });
  assert.equal(idleUnread.wrote, false);
  assert.equal(idleUnread.refused, undefined, 'idle sweep with unread listing did not open held current month');
  assert.equal(idleUnread.byTool['claude-cli'].unreadListing, true);
  await rm(heldNov);

  // A bad-line-only file with no kept receipt moves its position, reports unreadLines in the answer, and writes no kept session.
  const orphan = join(ctx.home, '.claude', 'projects', '-work-app', 'orphan-bad.jsonl');
  await writeFile(orphan, '{orphan-broken-line\n');
  const orphanRes = await sweepSessions(novCtx, { rates: RATES_V1 });
  assert.equal(orphanRes.wrote, true);
  assert.equal(orphanRes.byTool['claude-cli'].unreadLines, 1);
  assert.equal((await readSessionRecord(ctx.home, ['2026-11'])).months['2026-11'], undefined);
  const orphanIdle = await sweepSessions(novCtx, { rates: RATES_V1 });
  assert.equal(orphanIdle.wrote, false);
  assert.equal(orphanIdle.byTool['claude-cli'].unreadLines, 0);

  // writeAccess refusal: nothing written, no positions moved, taken stays zero, refused reports the reason.
  const deniedCtx = await makeContext({ held: 'Another build holds this computer.' });
  await put(join(deniedCtx.home, '.claude', 'projects', '-work-app', 'denied.jsonl'), [
    claudeResp('msg_d', '2026-11-24T15:00:00.000Z', claudeUsage(100, 0, 0, 10)),
  ]);
  const denied = await sweepSessions(deniedCtx, { rates: RATES_V1 });
  assert.equal(denied.wrote, false);
  assert.equal(denied.refused, 'Another build holds this computer.');
  assert.deepEqual(denied.taken, { requests: 0, sessions: 0 });
  assert.equal(await stat(sessionsDirectory(deniedCtx.home)).then(() => true, () => false), false);
});

test('A bad line in a held-back file is reported in unreadLines each sweep and added to kept unread only once its position advances', async () => {
  const ctx = await makeContext();
  const file = join(ctx.home, '.claude', 'projects', '-work-app', 'held-bad.jsonl');
  await put(file, [claudeResp('msg_good', '2026-11-24T12:00:00.000Z', claudeUsage(100, 0, 0, 10))]);
  await sweepSessions(ctx, { rates: RATES_V1 });

  const heldMonth = join(sessionsDirectory(ctx.home), '2026-09.json');
  await writeFile(heldMonth, '{"formatVersion":2}\n');
  await appendFile(file, `{bad-tail}\n${lines([
    claudeResp('msg_sept_held', '2026-09-24T12:00:00.000Z', claudeUsage(100, 0, 0, 10)),
    claudeResp('msg_nov_sibling', '2026-11-24T13:00:00.000Z', claudeUsage(150, 0, 0, 15)),
  ])}`);

  for (let retry = 1; retry <= 3; retry++) {
    const res = await sweepSessions(ctx, { rates: RATES_V1 });
    assert.equal(res.byTool['claude-cli'].unreadLines, 1, `retry ${retry} reports the bad line met`);
    const kept = (await readSessionRecord(ctx.home, ['2026-11'])).months['2026-11']!.sessions[0]!;
    assert.equal(kept.unread, 0, `retry ${retry} does not increment kept unread while file is held back`);
    assert.ok(kept.requests['msg_nov_sibling'], 'accepted sibling landed');
  }

  await rm(heldMonth);
  const cleared = await sweepSessions(ctx, { rates: RATES_V1 });
  assert.equal(cleared.byTool['claude-cli'].unreadLines, 1);
  const after = await readSessionRecord(ctx.home, ['2026-09', '2026-11']);
  assert.equal(after.months['2026-09']!.sessions[0]!.unread, 1);
  assert.equal(after.months['2026-11']!.sessions[0]!.unread, 1, 'unread added once when position advances');
});

test('An older Codex rollout rewritten shorter keeps its original receipt tokens and price under the older counter key', async () => {
  const ctx = await makeContext();
  const file = join(ctx.home, '.codex', 'sessions', '2026', '11', '24', 'rollout-legacy.jsonl');
  const firstCount = codexCounter('2026-11-24T12:00:00.000Z', 100, 0, 20);
  const secondCount = codexCounter('2026-11-24T12:00:01.000Z', 200, 0, 40);
  await put(file, [codexMeta('legacy'), codexTurn('gpt-5', '2026-11-24T11:59:59.000Z'), firstCount, secondCount]);
  await sweepSessions(ctx, { rates: RATES_V1 });

  const before = (await readSessionRecord(ctx.home, ['2026-11'])).months['2026-11']!.sessions[0]!;
  const secondKey = 'legacy 2026-11-24T12:00:01.000Z 240';
  assert.deepEqual(before.requests[secondKey]!.tokens, { input: 100, cacheRead: 0, cacheWrite: 0, output: 20 });
  const originalDollars = before.requests[secondKey]!.dollars;

  // Rewrite shorter without the first counter: read from start, secondCount looks like (200, 40) whole, but its kept receipt must stay (100, 20).
  await put(file, [codexMeta('legacy'), codexTurn('gpt-5', '2026-11-24T11:59:59.000Z'), secondCount]);
  await sweepSessions(ctx, { rates: RATES_V1 });
  const after = (await readSessionRecord(ctx.home, ['2026-11'])).months['2026-11']!.sessions[0]!;
  assert.deepEqual(after.requests[secondKey]!.tokens, { input: 100, cacheRead: 0, cacheWrite: 0, output: 20 });
  assert.equal(after.requests[secondKey]!.dollars, originalDollars);
  const totalInput = Object.values(after.requests).reduce((sum, r) => sum + r.tokens.input, 0);
  const totalOutput = Object.values(after.requests).reduce((sum, r) => sum + r.tokens.output, 0);
  assert.deepEqual([totalInput, totalOutput], [200, 40]);
});
