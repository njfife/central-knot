// Each response's tokens, read from a tool's session history (src/sessionrequests.ts, in main), as worked examples. Every
// session file here is made up by the test in Claude Code's own record shapes (as 2.1.331 wrote them, measured 2026-11-24):
// a response is an `assistant` record with the message's id, model and usage, among records that hold none.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { appendFile, chmod, copyFile, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, truncate, utimes, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { changedSince, claudeFiles, readClaudeSession, scanLines } from '../src/sessionrequests.ts';
import { winLockSkip } from './fslock.ts';

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

test('A file whose bytes before where the last read ended were changed in place (the same file, no shorter) is read from its start, and says so', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await put(file, [1, 2].map(n => response(`msg_${n}`, `2026-11-24T15:30:0${n}.000Z`, usage(n, 1_000, 0, n * 10))));
  const first = await readClaudeSession({ file, session: 'one' });
  await appendFile(file, lines([response('msg_3', '2026-11-24T15:30:03.000Z', usage(3, 1_000, 0, 30))]));
  const second = await readClaudeSession({ file, session: 'one' }, first.position);
  assert.deepEqual([outputs(second.requests), second.startedOver], [[['msg_3', 30]], false], 'only appended to: it goes on');
  const handle = await open(file, 'r+');
  try {
    await handle.write('msg_9', (await readFile(file)).indexOf('msg_1'));
  } finally { await handle.close(); }
  await appendFile(file, lines([response('msg_4', '2026-11-24T15:30:04.000Z', usage(4, 1_000, 0, 40))]));
  const third = await readClaudeSession({ file, session: 'one' }, second.position);
  assert.equal(third.position.ino, second.position.ino, 'the same file, longer');
  assert.deepEqual([outputs(third.requests), third.startedOver], [[['msg_9', 10], ['msg_2', 20], ['msg_3', 30], ['msg_4', 40]], true]);
});

/** Response `n` (1 to 9): its id `msg_<n>`, its output `n` tens. */
const reply = (n: number) => response(`msg_${n}`, `2026-11-24T15:30:0${n}.000Z`, usage(n, 1_000, 0, n * 10));

test('A read of an empty file ends at its start, where what came before is nothing (the SHA-256 of no bytes); lines added after are read on from there', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await write(file, '');
  const empty = await readClaudeSession({ file, session: 'one' });
  assert.deepEqual([empty.position.offset, empty.position.before], [0, 'e3b0c44298fc1c14']);
  await appendFile(file, lines([reply(1)]));
  const added = await readClaudeSession({ file, session: 'one' }, empty.position);
  assert.deepEqual([outputs(added.requests), added.startedOver], [[['msg_1', 10]], false]);
});

test('A file moved is the same file, read on; a copy, a file cut short and written longer, and a file smaller than it was are each read from their start', async () => {
  const home = await newHome(), project = join(home, '.claude/projects/-work-app'), file = join(project, 'one.jsonl');
  await put(file, [reply(1), reply(2)]);
  const first = await readClaudeSession({ file, session: 'one' });
  const moved = join(project, 'moved.jsonl'), copied = join(project, 'copied.jsonl');
  await rename(file, moved);
  await appendFile(moved, lines([reply(3)]));
  const afterMove = await readClaudeSession({ file: moved, session: 'one' }, first.position);
  assert.deepEqual([outputs(afterMove.requests), afterMove.startedOver], [[['msg_3', 30]], false], 'moved: the same file');
  await copyFile(moved, copied);
  const copy = await readClaudeSession({ file: copied, session: 'one' }, afterMove.position);
  assert.deepEqual([copy.requests.length, copy.startedOver], [3, true], 'copied: the same bytes, another file');
  await writeFile(moved, lines([4, 5, 6, 7].map(reply)));
  const rewritten = await readClaudeSession({ file: moved, session: 'one' }, afterMove.position);
  assert.deepEqual([outputs(rewritten.requests), rewritten.startedOver], [[['msg_4', 40], ['msg_5', 50], ['msg_6', 60], ['msg_7', 70]], true],
    'cut short and written longer: the same file, no smaller, but the bytes before differ');
  await appendFile(moved, '{"type":"assistant"');
  const unended = await readClaudeSession({ file: moved, session: 'one' }, rewritten.position);
  assert.deepEqual([unended.requests, unended.startedOver, unended.position.offset], [[], false, rewritten.position.offset], 'a line not yet ended');
  await truncate(moved, unended.position.offset);
  const smaller = await readClaudeSession({ file: moved, session: 'one' }, unended.position);
  assert.deepEqual([smaller.requests.length, smaller.startedOver], [4, true], 'smaller than it was, though not than where the read ended');
});

/** While `work` runs, `open` from node:fs/promises (the reader's) is `wrapped`, given the real one. */
async function withOpen<T>(wrapped: (real: typeof fs.open) => typeof fs.open, work: () => Promise<T>): Promise<T> {
  const real = fs.open;
  fs.open = wrapped(real);
  syncBuiltinESMExports();
  try {
    return await work();
  } finally {
    fs.open = real;
    syncBuiltinESMExports();
  }
}

test('A device and an inode are kept as strings: an inode above 2^53 is told apart from the one below it, which as numbers are one', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl');
  await put(file, [reply(1)]);
  let ino = 2n ** 53n + 1n;
  const withIno = (real: typeof fs.open): typeof fs.open => async (...args) => {
    const handle = await real(...args), stat = handle.stat.bind(handle);
    handle.stat = (async (options?: { bigint?: boolean }) => Object.assign(await stat(options), { ino })) as typeof handle.stat;
    return handle;
  };
  await withOpen(withIno, async () => {
    const first = await readClaudeSession({ file, session: 'one' });
    assert.equal(first.position.ino, '9007199254740993');
    const again = await readClaudeSession({ file, session: 'one' }, first.position);
    assert.equal(again.startedOver, false, 'the same inode: read on');
    ino = 2n ** 53n;
    const other = await readClaudeSession({ file, session: 'one' }, first.position);
    assert.deepEqual([other.position.ino, other.startedOver], ['9007199254740992', true], 'another inode');
  });
});

test('Whether a file changed since a read is told by its size and time alone, without reading it', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work-app/one.jsonl'), at = new Date('2026-11-24T16:00:00.000Z');
  await put(file, [reply(1)]);
  await utimes(file, at, at);
  const { position } = await readClaudeSession({ file, session: 'one' });
  const changed = async () => changedSince(position, await stat(file, { bigint: true }));
  assert.equal(await changed(), false, 'the same size and time');
  await appendFile(file, ' ');
  await utimes(file, at, at);
  assert.equal(await changed(), true, 'one byte appended, its time set back: its size alone');
  await truncate(file, position.size);
  await utimes(file, at, new Date(at.getTime() + 60_000));
  assert.equal(await changed(), true, 'its time alone moved');
});

test('A line of many megabytes across many chunks is handed on whole and once, in a time that grows with its length, not its square', async t => {
  const home = await newHome(), file = join(home, 'long.jsonl');
  /** The best of three reads of a file holding one line of `bytes`, then a short one. */
  const timeFor = async (bytes: number) => {
    const long = 'x'.repeat(bytes);
    await write(file, `${long}\nshort\n`);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const read: string[] = [], began = performance.now();
      await scanLines(file, undefined, () => text => read.push(text === long ? 'the long line' : text));
      best = Math.min(best, performance.now() - began);
      assert.deepEqual(read, ['the long line', 'short']);
    }
    return best;
  };
  const two = await timeFor(2 * 2 ** 20), sixteen = await timeFor(16 * 2 ** 20);
  t.diagnostic(`a line of 2 MB: ${two.toFixed(1)} ms; of 16 MB: ${sixteen.toFixed(1)} ms (best of three)`);
  assert.ok(sixteen < 24 * two, 'eight times the length, under twenty-four times the time (its square would be sixty-four)');
});

test('The size, the hash and the lines are of the file opened, though another file takes its path before it is read', async () => {
  const home = await newHome(), project = join(home, '.claude/projects/-work-app'), file = join(project, 'one.jsonl');
  const moved = join(project, 'moved.jsonl');
  await put(file, [reply(1), reply(2)]);
  const thenReplace = (real: typeof fs.open): typeof fs.open => async (...args) => {
    const handle = await real(...args);
    await rename(file, moved);
    await put(file, [reply(3)]);
    return handle;
  };
  const read = await withOpen(thenReplace, () => readClaudeSession({ file, session: 'one' }));
  assert.deepEqual(outputs(read.requests), [['msg_1', 10], ['msg_2', 20]], 'the lines of the file opened');
  const opened = await stat(moved, { bigint: true });
  assert.deepEqual([read.position.ino, read.position.size], [String(opened.ino), Number(opened.size)], 'its inode and size');
  const readOn = await readClaudeSession({ file: moved, session: 'one' }, read.position);
  assert.deepEqual([readOn.requests, readOn.startedOver], [[], false], 'its hash: the file opened is read on from where it ended');
});

test('A parent and its child\'s file are two sessions, the child naming its parent, and each request is read once', async t => {
  const home = await newHome(), project = join(home, '.claude/projects/-work-app');
  assert.deepEqual(await claudeFiles({ home }), { files: [], unread: false }, 'no projects folder: no files');
  await put(join(project, 'one.jsonl'), [
    response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10)), response('msg_3', '2026-11-24T15:31:00.000Z', usage(1, 1_200, 0, 30)),
  ]);
  await put(join(project, 'one/subagents/agent-a1.jsonl'), [
    { ...response('msg_2', '2026-11-24T15:30:30.000Z', usage(7, 0, 400, 20), 'claude-haiku-4-5-20251001'), isSidechain: true, agentId: 'a1' },
  ]);
  await writeFile(join(project, 'one/subagents/agent-a1.meta.json'), '{"agentType":"reviewer"}');
  const listed = await claudeFiles({ home });
  assert.equal(listed.unread, false);
  const files = listed.files.sort((a, b) => a.session.localeCompare(b.session));
  assert.deepEqual(files, [
    { file: join(project, 'one/subagents/agent-a1.jsonl'), session: 'agent-a1', parent: 'one' },
    { file: join(project, 'one.jsonl'), session: 'one' },
  ]);
  const requests = (await Promise.all(files.map(each => readClaudeSession(each)))).flatMap(read => read.requests);
  assert.deepEqual(requests.map(each => [each.request, each.session, each.parent]), [['msg_2', 'agent-a1', 'one'], ['msg_1', 'one', undefined], ['msg_3', 'one', undefined]]);

  // An unreadable sibling project folder or nested subagents folder flags unread without hiding readable files.
  if (winLockSkip) {
    await t.test('an unreadable sibling project folder or nested subagents folder flags unread without hiding readable files', { skip: winLockSkip }, () => {});
  } else {
    const blocked = join(home, '.claude/projects/-work-blocked');
    await mkdir(blocked, { recursive: true });
    await chmod(blocked, 0o000);
    const subagents = join(project, 'one/subagents');
    await chmod(subagents, 0o111);
    try {
      const partial = await claudeFiles({ home });
      assert.equal(partial.unread, true);
      assert.deepEqual(partial.unreadSessions, ['one']);
      assert.deepEqual(partial.files, [{ file: join(project, 'one.jsonl'), session: 'one' }]);
    } finally {
      await chmod(subagents, 0o700);
      await chmod(blocked, 0o700);
    }
  }
});

test('The cost record is the tool\'s own running total for the file as last recorded, zero included, said not to be whole where the tool says it leaves a model out; with none, there is none', async () => {
  const home = await newHome(), project = join(home, '.claude/projects/-work-app');
  const cost = (usd: number) => ({ type: 'cost-state', sessionId: 'one', totalCostUSD: usd, modelUsage: {}, hasUnknownModelCost: false });
  const reported = async (name: string, records: object[]) => {
    await put(join(project, name), records);
    return (await readClaudeSession({ file: join(project, name), session: name })).reported;
  };
  const said = response('msg_1', '2026-11-24T15:30:00.000Z', usage(5, 1_000, 10, 10));
  assert.deepEqual(await reported('closed.jsonl', [said, cost(0.0098), said, cost(0.0133)]), { dollars: 0.0133, complete: true },
    'the last one: each is the total so far');
  assert.equal(await reported('older.jsonl', [said]), undefined, 'an older version writes none');
  const leavesOut = { ...cost(0.0133), hasUnknownModelCost: true };
  assert.deepEqual(await reported('unknown.jsonl', [said, cost(0.0098), said, leavesOut]), { dollars: 0.0133, complete: false },
    'the last total leaves a model out: that figure, not whole, and not the earlier one');
  const file = join(project, 'two-goes.jsonl');
  await put(file, [said, cost(0.01)]);
  const positive = await readClaudeSession({ file, session: 'two-goes' });
  await appendFile(file, lines([cost(0)]));
  const zero = await readClaudeSession({ file, session: 'two-goes' }, positive.position);
  await appendFile(file, lines([said]));
  const none = await readClaudeSession({ file, session: 'two-goes' }, zero.position);
  assert.deepEqual([positive.reported, zero.reported, none.reported], [{ dollars: 0.01, complete: true }, { dollars: 0, complete: true }, undefined],
    'a later read says zero; one with no cost record, none');
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
