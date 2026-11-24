// Each response's tokens, read from a tool's session history (src/sessionrequests.ts, in main), as worked examples. Every
// session file here is made up by the test in Claude Code's own record shapes (as 2.1.331 wrote them, measured 2026-11-24):
// a response is an `assistant` record with the message's id, model and usage, among records that hold none.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { claudeFiles, readClaudeSession, scanLines } from '../src/sessionrequests.ts';

/** A made-up home, removed when the tests end. */
const homes: string[] = [];
const newHome = async () => { const home = await realpath(await mkdtemp(join(tmpdir(), 'ck-requeststest-'))); homes.push(home); return home; };
after(() => Promise.all(homes.map(home => rm(home, { recursive: true, force: true }))));

const lines = (records: object[]) => records.map(record => `${JSON.stringify(record)}\n`).join('');
/** A file's text, written with its folder. */
async function write(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
const put = (path: string, records: object[]) => write(path, lines(records));

/**
 * Claude Code's usage of one response, its counts in `Tokens`' order: its thinking inside its output; of its cache writes, `hour`
 * written for an hour and the rest for 5 minutes; and the speed and service tier it was served at.
 */
const usage = (input: number, cacheRead: number, cacheWrite: number, output: number, thinking = 0, hour = 0) => ({
  input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output,
  output_tokens_details: { thinking_tokens: thinking },
  cache_creation: { ephemeral_5m_input_tokens: cacheWrite - hour, ephemeral_1h_input_tokens: hour },
  service_tier: 'standard', speed: 'standard',
});
/** A response as Claude Code records it. */
const response = (id: string, at: string, used: object, model = 'claude-opus-5-5') => ({
  type: 'assistant', sessionId: 'one', cwd: '/work/app', isSidechain: false, timestamp: at,
  message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'Done.' }], usage: used },
});
const asked = (at: string) => ({ type: 'user', sessionId: 'one', cwd: '/work/app', timestamp: at, message: { role: 'user', content: 'Go on.' } });

test('A Claude Code session of three responses is three requests, each with its tokens by kind, the model\'s id, and its speed and tier where saved', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await put(file, [
    { type: 'queue-operation', operation: 'enqueue', sessionId: 'one', timestamp: '2026-11-24T15:29:50.000Z' },
    asked('2026-11-24T15:29:51.000Z'),
    { type: 'attachment', sessionId: 'one', cwd: '/work/app', attachment: { type: 'skill_listing' }, timestamp: '2026-11-24T15:29:51.000Z' },
    response('msg_1', '2026-11-24T15:29:59.466Z', usage(301, 81, 13, 41, 5)),
    asked('2026-11-24T15:30:02.000Z'),
    response('msg_2', '2026-11-24T15:30:05.000Z', { ...usage(3, 40_000, 2_000, 900, 120, 500), speed: 'fast' }),
    // As an older version saves it: no one-hour part, no speed, no tier.
    response('msg_3', '2026-11-24T15:30:09.000Z', { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 42_000, output_tokens: 12 },
      'claude-haiku-4-5-20251001'),
  ]);
  const read = await readClaudeSession({ file, session: 'one' });
  assert.deepEqual(read.requests, [
    { tool: 'claude-cli', session: 'one', request: 'msg_1', at: Date.parse('2026-11-24T15:29:59.466Z'), model: 'claude-opus-5-5',
      tokens: { input: 301, cacheRead: 81, cacheWrite: 13, cacheWrite1h: 0, output: 41 }, speed: 'standard', serviceTier: 'standard' },
    { tool: 'claude-cli', session: 'one', request: 'msg_2', at: Date.parse('2026-11-24T15:30:05.000Z'), model: 'claude-opus-5-5',
      tokens: { input: 3, cacheRead: 40_000, cacheWrite: 2_000, cacheWrite1h: 500, output: 900 }, speed: 'fast', serviceTier: 'standard' },
    { tool: 'claude-cli', session: 'one', request: 'msg_3', at: Date.parse('2026-11-24T15:30:09.000Z'), model: 'claude-haiku-4-5-20251001',
      tokens: { input: 0, cacheRead: 42_000, cacheWrite: 0, output: 12 } },
  ], 'thinking is inside output once; cache writes are their total, the one-hour part inside it, not added again');
  assert.equal(read.project, 'app', 'the project is the recorded working folder\'s name');
  assert.equal(read.unread, 0);
});

/** Each request's id and output tokens, in the order read. */
const outputs = (requests: { request: string; tokens: { output: number } }[]) => requests.map(each => [each.request, each.tokens.output]);

test('A record longer than one chunk of the file is read whole, and an empty file is nothing', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await write(file, '');
  assert.deepEqual((await readClaudeSession({ file, session: 'one' })).requests, []);
  const long = response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10));
  long.message.content = [{ type: 'text', text: 'Résumé ✓ '.repeat(20_000) }];
  await put(file, [{ ...long, cwd: '/work/café' }, response('msg_2', '2026-11-24T15:30:05.000Z', usage(1, 2_000, 0, 20))]);
  const read = await readClaudeSession({ file, session: 'one' });
  assert.deepEqual([outputs(read.requests), read.project, read.unread], [[['msg_1', 10], ['msg_2', 20]], 'café', 0]);
});

test('A character split across two chunks of the file is read whole: each line\'s text is as written', async () => {
  const home = await newHome(), file = join(home, 'one.jsonl');
  // One byte, then two-byte characters: a chunk's end, at an even byte, falls inside one of them.
  const long = `a${'é'.repeat(40_000)}`, written = [long, 'après', long];
  await write(file, written.map(text => `${text}\n`).join(''));
  const read: string[] = [];
  await scanLines(file, undefined, () => text => read.push(text));
  assert.deepEqual(read, written);
});

test('A response recorded twice, first in part and then whole, is one request with the whole one\'s tokens', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await put(file, [
    response('msg_1', '2026-11-24T15:30:00.000Z', usage(4, 2_000, 100, 1)),
    { type: 'attachment', sessionId: 'one', attachment: { type: 'hook_success' }, timestamp: '2026-11-24T15:30:01.000Z' },
    response('msg_1', '2026-11-24T15:30:02.000Z', usage(4, 2_000, 100, 380, 60)),
    response('msg_2', '2026-11-24T15:30:05.000Z', usage(1, 2_100, 0, 25)),
  ]);
  const read = await readClaudeSession({ file, session: 'one' });
  assert.deepEqual(outputs(read.requests), [['msg_1', 380], ['msg_2', 25]]);
});

test('A response recorded in part in one read and whole in the next comes in both reads, by one id: the later replaces the earlier', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await put(file, [response('msg_1', '2026-11-24T15:30:00.000Z', usage(4, 2_000, 100, 1))]);
  const first = await readClaudeSession({ file, session: 'one' });
  await appendFile(file, lines([response('msg_1', '2026-11-24T15:30:02.000Z', usage(4, 2_000, 100, 380, 60))]));
  const second = await readClaudeSession({ file, session: 'one' }, first.position);
  assert.deepEqual([outputs(first.requests), outputs(second.requests)], [[['msg_1', 1]], [['msg_1', 380]]]);
});

test('A file read in two goes, cut in the middle of a line: the cut line is read whole in the second go, and once', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  const cut = lines([response('msg_3', '2026-11-24T15:30:09.000Z', usage(2, 3_000, 0, 30))]);
  const whole = lines([response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10)), response('msg_2', '2026-11-24T15:30:05.000Z', usage(1, 2_000, 0, 20))]);
  await write(file, whole + cut.slice(0, 40));
  const first = await readClaudeSession({ file, session: 'one' });
  assert.deepEqual(outputs(first.requests), [['msg_1', 10], ['msg_2', 20]]);
  assert.equal(first.unread, 0, 'the cut line is left for the next read, not passed over');
  assert.equal(first.startedOver, false, 'a first read has nothing to start over from');
  await appendFile(file, cut.slice(40) + lines([response('msg_4', '2026-11-24T15:30:12.000Z', usage(1, 3_100, 0, 40))]));
  const second = await readClaudeSession({ file, session: 'one' }, first.position);
  assert.deepEqual(outputs(second.requests), [['msg_3', 30], ['msg_4', 40]]);
  assert.deepEqual([second.unread, second.startedOver], [0, false]);
  const idle = await readClaudeSession({ file, session: 'one' }, second.position);
  assert.deepEqual([idle.requests, idle.position, idle.startedOver], [[], second.position, false], 'nothing appended since: nothing read');
});

test('A file written again shorter in place is read from its start, and says so: none of its old requests comes back', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await put(file, [1, 2, 3].map(n => response(`msg_${n}`, `2026-11-24T15:30:0${n}.000Z`, usage(n, 1_000, 0, n * 10))));
  const before = await readClaudeSession({ file, session: 'one' });
  await writeFile(file, lines([response('msg_9', '2026-11-24T16:00:00.000Z', usage(9, 900, 0, 90))]));
  const again = await readClaudeSession({ file, session: 'one' }, before.position);
  assert.equal(again.position.ino, before.position.ino, 'the same file, shorter');
  assert.deepEqual([outputs(again.requests), again.startedOver], [[['msg_9', 90]], true]);
  await writeFile(file, '');
  const emptied = await readClaudeSession({ file, session: 'one' }, again.position);
  assert.deepEqual([emptied.requests, emptied.startedOver], [[], true], 'emptied: started over, with no line to hand over');
});

test('A file replaced by another, longer than where the last read ended, is read from its start, and says so', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await put(file, [response('msg_1', '2026-11-24T15:30:00.000Z', usage(1, 1_000, 0, 10))]);
  const before = await readClaudeSession({ file, session: 'one' });
  await put(`${file}.new`, [2, 3, 4].map(n => response(`msg_${n}`, `2026-11-24T16:00:0${n}.000Z`, usage(n, 1_000, 0, n * 10))));
  await rename(`${file}.new`, file);
  const again = await readClaudeSession({ file, session: 'one' }, before.position);
  assert.notEqual(again.position.ino, before.position.ino, 'another file now');
  assert.deepEqual([outputs(again.requests), again.startedOver], [[['msg_2', 20], ['msg_3', 30], ['msg_4', 40]], true]);
});

test('A parent and its child\'s file are two sessions, the child naming its parent, and each request is read once', async () => {
  const home = await newHome(), project = join(home, '.claude/projects/-work-app');
  assert.equal(await claudeFiles({ home }), undefined, 'no projects folder: no files');
  await put(join(project, 'one.jsonl'), [
    response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10)), response('msg_3', '2026-11-24T15:31:00.000Z', usage(1, 1_200, 0, 30)),
  ]);
  await put(join(project, 'one/subagents/agent-a1.jsonl'), [
    { ...response('msg_2', '2026-11-24T15:30:30.000Z', usage(7, 0, 400, 20), 'claude-haiku-4-5-20251001'), isSidechain: true, agentId: 'a1' },
  ]);
  await writeFile(join(project, 'one/subagents/agent-a1.meta.json'), '{"agentType":"reviewer"}');
  const files = (await claudeFiles({ home }))!.sort((a, b) => a.session.localeCompare(b.session));
  assert.deepEqual(files, [
    { file: join(project, 'one/subagents/agent-a1.jsonl'), session: 'agent-a1', parent: 'one' },
    { file: join(project, 'one.jsonl'), session: 'one' },
  ]);
  const requests = (await Promise.all(files.map(each => readClaudeSession(each)))).flatMap(read => read.requests);
  assert.deepEqual(requests.map(each => [each.request, each.session, each.parent]), [['msg_2', 'agent-a1', 'one'], ['msg_1', 'one', undefined], ['msg_3', 'one', undefined]]);
});

test('The cost record is the tool\'s own running total for the file as last recorded, zero included; with none, or one that leaves a model out, there is none', async () => {
  const home = await newHome(), project = join(home, '.claude/projects/-work-app');
  const cost = (usd: number) => ({ type: 'cost-state', sessionId: 'one', totalCostUSD: usd, modelUsage: {}, hasUnknownModelCost: false });
  const reported = async (name: string, records: object[]) => {
    await put(join(project, name), records);
    return (await readClaudeSession({ file: join(project, name), session: name })).treeReported;
  };
  const said = response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10));
  assert.equal(await reported('closed.jsonl', [said, cost(0.0098), said, cost(0.0133)]), 0.0133, 'the last one: each is the total so far');
  assert.equal(await reported('older.jsonl', [said]), undefined, 'an older version writes none');
  const leavesOut = { ...cost(0.0133), hasUnknownModelCost: true };
  assert.equal(await reported('unknown.jsonl', [said, cost(0.0098), said, leavesOut]), undefined,
    'the last total leaves a model out: no figure, not the earlier one');
  const file = join(project, 'two-goes.jsonl');
  await put(file, [said, cost(0.01)]);
  const positive = await readClaudeSession({ file, session: 'two-goes' });
  await appendFile(file, lines([cost(0)]));
  const zero = await readClaudeSession({ file, session: 'two-goes' }, positive.position);
  await appendFile(file, lines([said]));
  const none = await readClaudeSession({ file, session: 'two-goes' }, zero.position);
  assert.deepEqual([positive.treeReported, zero.treeReported, none.treeReported], [0.01, 0, undefined], 'a later read says zero; one with no cost record, none');
});

test('A response Claude Code made up itself (model `<synthetic>`: an error or an interrupt, no tokens) is no request, and not unread', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  const madeUp = response('msg_2', '2026-11-24T15:30:05.000Z', { ...usage(0, 0, 0, 0), service_tier: null, speed: null }, '<synthetic>');
  await put(file, [
    response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10)), asked('2026-11-24T15:30:04.000Z'), madeUp,
    asked('2026-11-24T15:30:06.000Z'), response('msg_3', '2026-11-24T15:30:09.000Z', usage(2, 1_100, 0, 30)),
  ]);
  const read = await readClaudeSession({ file, session: 'one' });
  assert.deepEqual([outputs(read.requests), read.unread], [[['msg_1', 10], ['msg_3', 30]], 0], 'nothing is missing: no model answered');
});

test('A line that is not JSON, a record with usage of a kind not known, and a response missing a count are passed over and counted as unread', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  const noOutput = response('msg_4', '2026-11-24T15:30:20.000Z', usage(1, 0, 0, 0));
  delete (noOutput.message.usage as Record<string, unknown>).output_tokens;
  const noCacheRead = response('msg_6', '2026-11-24T15:30:25.000Z', usage(1, 0, 0, 5));
  delete (noCacheRead.message.usage as Record<string, unknown>).cache_read_input_tokens;
  await write(file, [
    lines([response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10))]),
    '{"type":"assistant","message":{"id":"msg_2"\n',
    'null\n',
    lines([
      { ...response('msg_3', '2026-11-24T15:30:10.000Z', usage(5, 1_000, 0, 30)), type: 'assistant-v9' },
      noOutput,
      noCacheRead,
      { type: 'atis-latch', sessionId: 'one', atis: {} },
      response('msg_5', '2026-11-24T15:30:30.000Z', usage(2, 1_100, 0, 50)),
    ]),
  ].join(''));
  const read = await readClaudeSession({ file, session: 'one' });
  assert.deepEqual(outputs(read.requests), [['msg_1', 10], ['msg_5', 50]]);
  assert.equal(read.unread, 5, 'the cut record, null, the unknown kind with usage, and the responses with no output or no cache count; not a record with no usage');
});
