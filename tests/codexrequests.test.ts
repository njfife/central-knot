// Each response's tokens, read from Codex's rollouts (src/sessionrequests.ts readCodexRollout, in main), as worked examples.
// Every rollout here is made up by the test in Codex's own record shapes (as 0.169.1 wrote them, measured 2026-11-24): its
// first record says which thread it is; a turn_context names the turn's model; each response leaves a `token_usage_record`
// (the modern form) and then an `event_msg` `token_count` (the older counter, a running total), or in older files the count alone.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { codexRollouts, readCodexRollout } from '../src/sessionrequests.ts';

/** A made-up home, removed when the tests end. */
const homes: string[] = [];
const newHome = async () => { const home = await realpath(await mkdtemp(join(tmpdir(), 'ck-codexrequeststest-'))); homes.push(home); return home; };
after(() => Promise.all(homes.map(home => rm(home, { recursive: true, force: true }))));

const lines = (records: object[]) => records.map(record => `${JSON.stringify(record)}\n`).join('');
async function put(path: string, records: object[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines(records));
}

const THREAD = '01a20e2c-be50-7391-8319-0e3b60899d84';
/** A rollout's first record: the thread it is, in the folder it ran in, and the provider of its models (null: none saved). */
const meta = (id = THREAD, provider: string | null = 'openai') => ({
  timestamp: '2026-11-24T15:29:03.343Z', type: 'session_meta',
  payload: {
    session_id: id, id, cwd: '/work/app', originator: 'codex_exec', cli_version: '0.169.1', source: 'exec', thread_source: 'user',
    ...(provider ? { model_provider: provider } : {}),
  },
});
/** A child's first record: its own thread, spawned by `parent`, which it names twice, as 0.169.1 writes it. */
const childMeta = (id: string, parent: string) => ({
  timestamp: '2026-11-24T15:29:07.369Z', type: 'session_meta',
  payload: {
    session_id: parent, id, parent_thread_id: parent, cwd: '/work/app', originator: 'codex_exec', cli_version: '0.169.1',
    source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_nickname: 'Tesla' } } }, thread_source: 'subagent', model_provider: 'openai',
  },
});
/** A turn's settings, with the model selected for it. */
const turn = (model: string, at: string) => ({ timestamp: at, type: 'turn_context', payload: { turn_id: `turn-${at}`, cwd: '/work/app', model, summary: 'none' } });
/** Codex's counts of one response (its TokenUsage): `input` with its cached part inside it, `output` with its reasoning inside it. */
const counts = (input: number, cached: number, output: number, reasoning = 0, cacheWrite = 0) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: cacheWrite, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
});
type Counts = ReturnType<typeof counts>;
/** A thread's running total, kept as Codex keeps it: each response's counts added to it. */
const runningTotal = (): Counts => counts(0, 0, 0);
/** The older counter's record: the last response's counts and the thread's running total. */
const counter = (at: string, last: object, total: object) => ({
  timestamp: at, type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: { ...total }, last_token_usage: last, model_context_window: 258400 }, rate_limits: { limit_id: 'codex', plan_type: null } },
});

/** Counts as a version from before cache writes were saved writes them: with none (Codex reads that as 0). */
const noCacheWrites = ({ cache_write_input_tokens: _, ...rest }: Counts) => rest;
/**
 * One response's records, its counts added to `total`: in the modern form its usage record and then its count, as 0.169.1
 * writes them; in the older form its count alone, with no cache writes. A message the model wrote comes first, as in a real rollout.
 */
function respond(total: Counts, response: string, at: string, used: Counts, form: 'modern' | 'older' = 'modern'): object[] {
  for (const kind of Object.keys(total) as (keyof Counts)[]) total[kind] += used[kind];
  const said = { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } };
  const record = {
    timestamp: at, type: 'token_usage_record',
    payload: {
      thread_id: THREAD, turn_id: 'turn-1', session_id: THREAD, root_turn_id: 'turn-1', response_id: response,
      usage: used, turn_token_usage: { ...total }, thread_token_usage: { ...total },
    },
  };
  return form === 'modern' ? [said, record, counter(at, used, total)] : [said, counter(at, noCacheWrites(used), noCacheWrites(total))];
}

test('A Codex rollout of three responses is three requests: cached input taken out of input, reasoning not added to output', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-2026-11-24T15-29-03-one.jsonl'), total = runningTotal();
  await put(file, [
    meta(),
    turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'),
    ...respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41, 12)),
    ...respond(total, 'resp_2', '2026-11-24T15:29:06.137Z', counts(5_302, 5_000, 420, 300)),
    ...respond(total, 'resp_3', '2026-11-24T15:29:07.338Z', counts(303, 0, 43, 0, 7)),
  ]);
  const read = await readCodexRollout(file), request = { tool: 'codex-cli', session: THREAD, model: 'gpt-6-astra', provider: 'openai' };
  assert.deepEqual(read.requests, [
    { ...request, request: 'resp_1', at: Date.parse('2026-11-24T15:29:04.762Z'), tokens: { input: 220, cacheRead: 81, cacheWrite: 0, output: 41 } },
    { ...request, request: 'resp_2', at: Date.parse('2026-11-24T15:29:06.137Z'), tokens: { input: 302, cacheRead: 5_000, cacheWrite: 0, output: 420 } },
    { ...request, request: 'resp_3', at: Date.parse('2026-11-24T15:29:07.338Z'), tokens: { input: 303, cacheRead: 0, cacheWrite: 7, output: 43 } },
  ], 'each response once, though its count follows it');
  assert.deepEqual([read.project, read.unread, read.startedOver], ['app', 0, false]);
});

/** Each request's id, model and tokens, in the order read. */
const said = (requests: { request: string; model: string; tokens: object }[]) => requests.map(each => [each.request, each.model, each.tokens]);
/** Tokens in `Tokens`' order, for short. */
const tokens = (input: number, cacheRead: number, output: number) => ({ input, cacheRead, cacheWrite: 0, output });
/** The requests' tokens added up, kind by kind. */
const sum = (requests: { tokens: { input: number; cacheRead: number; cacheWrite: number; output: number } }[]) =>
  requests.reduce((all, { tokens: each }) => tokens(all.input + each.input, all.cacheRead + each.cacheRead, all.output + each.output), tokens(0, 0, 0));
/** A running total as `Tokens`: input without its cached part. */
const asTokens = (total: Counts) => tokens(total.input_tokens - total.cached_input_tokens, total.cached_input_tokens, total.output_tokens);

test('A model changed between the second and third response: the third carries the new id, from that turn on', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal();
  await put(file, [
    meta(),
    turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'),
    ...respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41)),
    ...respond(total, 'resp_2', '2026-11-24T15:29:06.137Z', counts(302, 82, 42)),
    turn('gpt-6.2-sol', '2026-11-24T15:29:09.938Z'),
    ...respond(total, 'resp_3', '2026-11-24T15:29:11.126Z', counts(303, 83, 43)),
  ]);
  const read = await readCodexRollout(file);
  assert.deepEqual(read.requests.map(each => [each.request, each.model]), [['resp_1', 'gpt-6-astra'], ['resp_2', 'gpt-6-astra'], ['resp_3', 'gpt-6.2-sol']]);
  assert.equal(read.state.model, 'gpt-6.2-sol', 'the model in force is left for the next read');
});

test('A rollout read in three goes: the thread and the model from the first read govern a response in the second, and its count in the third is not one again', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal();
  await put(file, [meta(), turn('gpt-6-astra', '2026-11-24T15:29:03.502Z')]);
  const first = await readCodexRollout(file);
  assert.deepEqual([first.requests, first.state], [[], { session: THREAD, provider: 'openai', model: 'gpt-6-astra' }]);
  const [message, record, count] = respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41));
  await appendFile(file, lines([message, record]));
  const second = await readCodexRollout(file, first);
  assert.deepEqual(second.requests, [
    { tool: 'codex-cli', session: THREAD, request: 'resp_1', at: Date.parse('2026-11-24T15:29:04.762Z'), model: 'gpt-6-astra', provider: 'openai', tokens: tokens(220, 81, 41) },
  ]);
  assert.equal(second.project, undefined, 'no record in these lines states the working folder');
  await appendFile(file, lines([count, ...respond(total, 'resp_2', '2026-11-24T15:29:06.137Z', counts(302, 82, 42))]));
  const third = await readCodexRollout(file, second);
  assert.deepEqual(said(third.requests), [['resp_2', 'gpt-6-astra', tokens(220, 82, 42)]], 'resp_1\'s count, in this read, follows its usage record in the last');
  const firstState = { session: THREAD, provider: 'openai', model: 'gpt-6-astra' };
  assert.deepEqual([first.state, second.startedOver, third.startedOver], [firstState, false, false], 'a state handed in is left as it was');
});

test('The provider saved with the thread goes on each of its requests, a later read\'s too; a rollout that saved none gives none', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal();
  // A provider of the person's own, serving a model whose id OpenAI's could have: a price for it must not be OpenAI's.
  await put(file, [meta(THREAD, 'azure'), turn('gpt-6-astra', '2026-11-24T15:29:03.502Z')]);
  const first = await readCodexRollout(file);
  await appendFile(file, lines(respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41))));
  const second = await readCodexRollout(file, first);
  assert.deepEqual(second.requests.map(each => [each.request, each.model, each.provider]), [['resp_1', 'gpt-6-astra', 'azure']]);
  const unsaid = join(home, '.codex/sessions/2026/11/24/rollout-two.jsonl');
  await put(unsaid, [meta(THREAD, null), turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'), ...respond(runningTotal(), 'resp_2', '2026-11-24T15:29:04.762Z', counts(1, 0, 1))]);
  assert.deepEqual((await readCodexRollout(unsaid)).requests.map(each => [each.request, 'provider' in each]), [['resp_2', false]]);
});

test('Two responses recorded the modern way and then one count covering both: both stand, and the count adds nothing', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal();
  const [firstSaid, firstRecord] = respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41));
  const [secondSaid, secondRecord, bothCounted] = respond(total, 'resp_2', '2026-11-24T15:29:06.137Z', counts(302, 82, 42));
  await put(file, [meta(), turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'), firstSaid, firstRecord, secondSaid, secondRecord, bothCounted]);
  const read = await readCodexRollout(file);
  assert.deepEqual(said(read.requests), [['resp_1', 'gpt-6-astra', tokens(220, 81, 41)], ['resp_2', 'gpt-6-astra', tokens(220, 82, 42)]]);
  assert.deepEqual([sum(read.requests), read.state.lastTotal], [asTokens(total), asTokens(total)], 'the count moved the baseline past both');
});

test('A rollout begun by an older Codex and resumed by a newer: each response once, and the sums are the file\'s final running total', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal();
  await put(file, [
    meta(),
    turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'),
    ...respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41), 'older'),
    ...respond(total, 'resp_2', '2026-11-24T15:29:06.137Z', counts(1_302, 1_000, 42), 'older'),
    ...respond(total, 'resp_3', '2026-11-24T15:29:07.338Z', counts(2_303, 2_000, 43)),
    ...respond(total, 'resp_4', '2026-11-24T15:29:08.558Z', counts(3_304, 3_000, 44)),
  ]);
  const read = await readCodexRollout(file);
  assert.deepEqual(said(read.requests), [
    ['2026-11-24T15:29:04.762Z 342', 'gpt-6-astra', tokens(220, 81, 41)],
    ['2026-11-24T15:29:06.137Z 1686', 'gpt-6-astra', tokens(302, 1_000, 42)],
    ['resp_3', 'gpt-6-astra', tokens(303, 2_000, 43)],
    ['resp_4', 'gpt-6-astra', tokens(304, 3_000, 44)],
  ], 'an older count\'s id is its time and running total; a newer response\'s is its own');
  assert.deepEqual(sum(read.requests), asTokens(total));
  assert.deepEqual(read.state.lastTotal, asTokens(total), 'every count moves the baseline, a recorded response\'s too');
});

test('The older counter read in two goes: no response lost or doubled at the cut; and the file written again shorter is measured afresh', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal();
  await put(file, [
    meta(),
    turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'),
    ...respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41), 'older'),
    ...respond(total, 'resp_2', '2026-11-24T15:29:06.137Z', counts(302, 82, 42), 'older'),
  ]);
  const first = await readCodexRollout(file);
  await appendFile(file, lines([
    ...respond(total, 'resp_3', '2026-11-24T15:29:07.338Z', counts(303, 83, 43), 'older'),
    // The same count again, as Codex repeats one when only its limits changed: nothing added, no request.
    ...respond(total, 'resp_3', '2026-11-24T15:29:07.500Z', counts(0, 0, 0), 'older'),
    ...respond(total, 'resp_4', '2026-11-24T15:29:08.558Z', counts(304, 84, 44), 'older'),
  ]));
  const second = await readCodexRollout(file, first);
  assert.deepEqual([first.requests.length, said(second.requests).map(([, , each]) => each)], [2, [tokens(220, 83, 43), tokens(220, 84, 44)]]);
  assert.deepEqual(sum([...first.requests, ...second.requests]), asTokens(total));
  const shorter = runningTotal();
  await put(file, [meta(), turn('gpt-6-astra', '2026-11-24T16:00:00.000Z'), ...respond(shorter, 'resp_9', '2026-11-24T16:00:01.000Z', counts(5_000, 4_000, 500), 'older')]);
  const again = await readCodexRollout(file, second);
  assert.equal(again.position.ino, second.position.ino, 'the same file, shorter');
  assert.deepEqual([again.startedOver, said(again.requests)], [true, [['2026-11-24T16:00:01.000Z 5500', 'gpt-6-astra', tokens(1_000, 4_000, 500)]]],
    'its count is measured from nothing, not from the old file\'s last total');
});

test('A file replaced by another is read from its start with no state carried: the thread and model are the new file\'s own', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl');
  await put(file, [meta(), turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'), ...respond(runningTotal(), 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41))]);
  const before = await readCodexRollout(file);
  // Another file, holding no thread or model: a carried state would name the old one's.
  const other = runningTotal();
  await put(`${file}.new`, [...respond(other, 'resp_2', '2026-11-24T16:00:00.000Z', counts(1, 0, 1)), ...respond(other, 'resp_3', '2026-11-24T16:00:01.000Z', counts(1, 0, 1))]);
  await rename(`${file}.new`, file);
  const again = await readCodexRollout(file, before);
  assert.deepEqual([again.startedOver, again.requests, again.unread, again.state], [true, [], 2, { recordedSince: false, lastTotal: tokens(2, 0, 2) }]);
});

test('A running total that goes down inside the file (the counter began again) gives no negative request: its count is its whole total', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal(), resumed = runningTotal();
  await put(file, [
    meta(),
    turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'),
    ...respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(3_000, 2_000, 400), 'older'),
    ...respond(total, 'resp_2', '2026-11-24T15:29:06.137Z', counts(3_100, 3_000, 300), 'older'),
    turn('gpt-6-astra', '2026-11-24T17:00:00.000Z'),
    ...respond(resumed, 'resp_3', '2026-11-24T17:00:01.000Z', counts(900, 0, 50), 'older'),
    ...respond(resumed, 'resp_4', '2026-11-24T17:00:02.000Z', counts(1_000, 900, 60), 'older'),
  ]);
  const read = await readCodexRollout(file);
  assert.deepEqual(said(read.requests).map(([, , each]) => each), [tokens(1_000, 2_000, 400), tokens(100, 3_000, 300), tokens(900, 0, 50), tokens(100, 900, 60)]);
  assert.deepEqual(read.state.lastTotal, asTokens(resumed), 'the new count is the baseline from there on');
});

test('A parent and a child rollout are two sessions, the child naming its parent; the same rollout archived is the same session', async () => {
  const home = await newHome(), day = join(home, '.codex/sessions/2026/11/24');
  assert.equal(await codexRollouts({ home }), undefined, 'no rollout folder: no files');
  const child = '01a20e2c-cf1b-7f43-9270-20da1042ac75';
  await put(join(day, `rollout-2026-11-24T15-29-03-${THREAD}.jsonl`), [
    meta(), turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'), ...respond(runningTotal(), 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41)),
  ]);
  await put(join(day, `rollout-2026-11-24T15-29-07-${child}.jsonl`), [
    childMeta(child, THREAD), turn('gpt-6-astra-mini', '2026-11-24T15:29:07.380Z'), ...respond(runningTotal(), 'resp_5', '2026-11-24T15:29:08.568Z', counts(305, 85, 45)),
  ]);
  const files = (await codexRollouts({ home }))!.sort();
  const reads = await Promise.all(files.map(file => readCodexRollout(file)));
  assert.deepEqual(reads.flatMap(read => read.requests).map(each => [each.request, each.session, each.parent, each.model]), [
    ['resp_1', THREAD, undefined, 'gpt-6-astra'], ['resp_5', child, THREAD, 'gpt-6-astra-mini'],
  ], 'the child\'s own usage, its own session; the parent\'s holds none of it');
  const archived = join(home, '.codex/archived_sessions', `rollout-2026-11-24T15-29-07-${child}.jsonl`);
  await mkdir(dirname(archived), { recursive: true });
  await rename(files[1], archived);
  assert.deepEqual(await codexRollouts({ home }), [files[0], archived], 'an archived rollout is listed from its new folder');
  const moved = await readCodexRollout(archived);
  assert.deepEqual(moved.requests.map(each => [each.request, each.session, each.parent]), [['resp_5', child, THREAD]], 'the same session and request ids where it is now');
});

test('A line that is not JSON, a response missing a count, and a response before any model are passed over and counted as unread; a count of limits alone is nothing', async () => {
  const home = await newHome(), file = join(home, '.codex/sessions/2026/11/24/rollout-one.jsonl'), total = runningTotal();
  const early = respond(total, 'resp_0', '2026-11-24T15:29:03.400Z', counts(10, 0, 1));
  const noOutput = respond(total, 'resp_2', '2026-11-24T15:29:05.000Z', counts(5, 0, 5)), noOutputUsage = (noOutput[1] as { payload: { usage: Record<string, unknown> } }).payload.usage;
  noOutputUsage.output_tokens = undefined;
  const moreCachedThanInput = respond(total, 'resp_3', '2026-11-24T15:29:05.500Z', counts(5, 9, 5));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, [
    lines([meta(), early[1]]),
    lines([turn('gpt-6-astra', '2026-11-24T15:29:03.502Z'), ...respond(total, 'resp_1', '2026-11-24T15:29:04.762Z', counts(301, 81, 41))]),
    '{"type":"token_usage_record","payload":{"response_id":"resp_9"\n',
    lines([noOutput[1], moreCachedThanInput[1]]),
    lines([{ timestamp: '2026-11-24T15:29:05.900Z', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { limit_id: 'codex', plan_type: 'plus' } } }]),
    lines([...respond(total, 'resp_4', '2026-11-24T15:29:06.000Z', counts(304, 84, 44))]),
  ].join(''));
  const read = await readCodexRollout(file);
  assert.deepEqual(read.requests.map(each => each.request), ['resp_1', 'resp_4']);
  assert.equal(read.unread, 4, 'the response before a model, the cut line, the one with no output, and the one with more cached than input; not the limits alone');
});
