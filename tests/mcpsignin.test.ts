// MCP sign-in: each tool's own answer read and put in words (mcpsignin.ts), on what the tools printed for four stand-in servers
// (tests/mcpsignin/: a server that needs nothing, one that needs a sign-in, one that is down and one that never answers, measured
// 2026-11-21 with Claude Code 2.1.330, Codex 0.169.1, Pi 1.6.0 and OpenCode 1.19.6, each in a throwaway home, never signed in;
// a plugin's server beside a direct one of the same name with Claude Code 2.1.330 and Codex 0.171.0); the page's rows from the
// view the Library has; and one check run for a home (mcpsigninrun.ts), on stand-in commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cellWords, readAnswer, signInCommand, signinRows, type SigninCell } from '../src/mcpsignin.ts';
import { checkSignin } from '../src/mcpsigninrun.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts, SigninAnswer } from '../src/types.ts';

const captured = (file: string) => readFileSync(join(import.meta.dirname, 'mcpsignin', file), 'utf8');
/** What each named server's cell says in `tool`'s column, after its command printed `stdout`. */
const words = (tool: HarnessId, stdout: string, names: string[]) => {
  const answer = readAnswer(tool, stdout, stdout);
  return Object.fromEntries(names.map(name => [name, cellWords(tool, { name, off: false }, answer)]));
};
const four = ['plain', 'oauth', 'down', 'silent'];

test('Codex’s three statuses become three words: no sign-in needed, needs sign-in, not known to Codex', () => {
  assert.deepEqual(words('codex-cli', captured('codex-list.stdout'), four), {
    plain: 'No sign-in needed', oauth: 'Needs sign-in', down: 'Not known to Codex', silent: 'Not known to Codex',
  });
  // Signed in, as the groundwork of 2026-11-20 saw it (not captured again: no sign-in is made here): o_auth and bearer_token.
  const signedIn = JSON.stringify([{ name: 'a', auth_status: 'o_auth' }, { name: 'b', auth_status: 'bearer_token' }]);
  assert.deepEqual(words('codex-cli', signedIn, ['a', 'b']), { a: 'Signed in', b: 'Signed in' });
});

test('Claude Code’s failure line keeps its reason, and a server that never answers says Claude Code’s own words for it', () => {
  assert.deepEqual(words('claude-cli', captured('claude-list.stdout'), four), {
    plain: 'Connected', oauth: 'Needs sign-in',
    down: 'Couldn’t reach: ECONNREFUSED: Unable to connect. Is the computer able to access the url?',
    silent: 'Couldn’t reach: MCP server "silent" connection timed out after 30000ms',
  });
});

test('Pi’s answer is read though it ended with exit code 1 for its failed servers: the others keep their words', () => {
  assert.deepEqual(words('pi-cli', captured('pi-list.stdout'), four), {
    plain: 'Connected', oauth: 'Needs sign-in', down: 'Couldn’t reach: fetch failed', silent: 'Couldn’t reach: MCP request timed out after 60000ms',
  });
});

test('OpenCode’s text is read line by line, its colours left out, a failed server’s reason from the line under it', () => {
  assert.deepEqual(words('opencode-cli', captured('opencode-list.stdout'), four), {
    plain: 'Connected', oauth: 'Needs sign-in',
    down: 'Couldn’t reach: SSE error: ECONNREFUSED: Unable to connect. Is the computer able to access the url?',
    silent: 'Couldn’t reach: Operation timed out after 30000ms',
  });
});

test('An answer in a shape the reader doesn’t know says so for every server, with the first line the tool printed', () => {
  const unreadable = readAnswer('pi-cli', '', 'Error: unknown command "mcp"\nRun pi --help.');
  assert.deepEqual(unreadable, { unreadable: 'Error: unknown command "mcp"' });
  assert.equal(cellWords('pi-cli', { name: 'plain', off: false }, unreadable), 'Couldn’t read Pi’s answer');
  assert.deepEqual(readAnswer('codex-cli', '{"servers": []}', '{"servers": []}'), { unreadable: '{"servers": []}' });
  assert.deepEqual(readAnswer('codex-cli', JSON.stringify([{ name: 'a', auth_status: 'a_new_state' }]), ''), { unreadable: '[{"name":"a","auth_status":"a_new_state"}]' });
  assert.deepEqual(readAnswer('opencode-cli', 'Usage: opencode mcp list', 'Usage: opencode mcp list'), { unreadable: 'Usage: opencode mcp list' });
  assert.deepEqual(readAnswer('pi-cli', JSON.stringify({ servers: [{ name: 'a', state: 'starting' }] }), ''), { unreadable: '{"servers":[{"name":"a","state":"starting"}]}' });
  // A server Pi has switched off is left out, whatever it says of it: the others are still read.
  assert.deepEqual(readAnswer('pi-cli', JSON.stringify({ servers: [{ name: 'a', enabled: false, state: 'disabled' }, { name: 'b', enabled: true, state: 'connected' }] }), ''), { servers: { b: { is: 'connected' } } });
  assert.deepEqual(readAnswer('claude-cli', 'Something else entirely', 'Something else entirely'), { unreadable: 'Something else entirely' });
  // Claude Code with no servers at all says so, and that is an answer: every server is then one it doesn't report.
  assert.deepEqual(readAnswer('claude-cli', 'No MCP servers configured. Use `claude mcp add` to add a server.\n', ''), { servers: {} });
});

test('A cell says what its tool’s answer says of it, and only that: not checked, not reported, switched off, the column’s failure', () => {
  const answer = readAnswer('claude-cli', captured('claude-list.stdout'), '');
  const cell = (name: string, off = false): SigninCell => ({ name, off });
  assert.equal(cellWords('claude-cli', cell('plain'), undefined), 'Not checked');
  assert.equal(cellWords('claude-cli', cell('elsewhere'), answer), 'Not reported by Claude Code');
  assert.equal(cellWords('claude-cli', { off: false }, answer), 'Not reported by Claude Code');
  // Switched off with the tool's own switch: said so, never matched against the answer.
  assert.equal(cellWords('claude-cli', cell('oauth', true), answer), 'Off in Claude Code');
  assert.equal(cellWords('codex-cli', cell('plain'), { failed: 'missing' }), 'Codex isn’t installed');
  assert.equal(cellWords('codex-cli', cell('plain'), { failed: 'timeout' }), 'Didn’t answer in 70 s');
  // A name that is also one of an object's own members is a server like any other.
  assert.equal(cellWords('claude-cli', cell('constructor'), answer), 'Not reported by Claude Code');
});

test('The tool’s own sign-in command, with the server as that tool names it', () => {
  assert.equal(signInCommand('claude-cli', 'plugin:tracker:issues'), 'claude mcp login plugin:tracker:issues');
  assert.equal(signInCommand('codex-cli', 'oauth'), 'codex mcp login oauth');
  assert.equal(signInCommand('pi-cli', 'oauth'), 'pi mcp login oauth');
  assert.equal(signInCommand('opencode-cli', 'my server'), 'opencode mcp auth "my server"');
});

// ---------- The rows, from the view the Library has ----------

const fact = (name: string, copies: Partial<Record<HarnessId, string>>, more: Partial<LibraryFacts> = {}): LibraryFacts => ({
  key: name.toLowerCase(), name, description: '', on: true, except: [], cannot: {}, edited: [],
  copies: Object.fromEntries(Object.entries(copies).map(([tool, folder]) => [tool, { folder }])) as LibraryFacts['copies'], ...more,
});
const install = (tool: HarnessId, more: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  tool, plugin: 'tracker', marketName: 'probe-market', listed: true, items: [{ kind: 'mcp', name: 'issues', description: '', runs: 'http://127.0.0.1:47312/mcp' }], ...more,
});
const view = (tools: HarnessId[], items: LibraryFacts[], pluginItems: InstalledPlugin[] = []) => {
  const empty = { tools, items: [], library: {} };
  return { mcp: { tools, items, library: {} }, skills: empty, agents: empty, pluginItems } as unknown as HomeView;
};

test('A plugin’s server in Claude Code beside a direct server of the same bare name: two rows, each with its own status', () => {
  const home = view(['claude-cli', 'codex-cli'], [fact('issues', { 'claude-cli': 'issues', 'codex-cli': 'issues' })], [install('claude-cli'), install('codex-cli')]);
  const rows = signinRows(home);
  assert.deepEqual(rows.map(row => [row.name, row.plugin, row.cells]), [
    ['issues', undefined, { 'claude-cli': { name: 'issues', off: false }, 'codex-cli': { name: 'issues', off: false } }],
    // Claude Code names a plugin's server plugin:<plugin>:<server>; Codex's list doesn't name a plugin's server at all.
    ['issues', 'tracker', { 'claude-cli': { name: 'plugin:tracker:issues', off: false }, 'codex-cli': { off: false } }],
  ]);
  const claude = readAnswer('claude-cli', captured('claude-plugin-list.stdout'), '');
  assert.deepEqual(rows.map(row => cellWords('claude-cli', row.cells['claude-cli']!, claude)), ['Connected', 'Needs sign-in']);
  // Codex reports only the direct server: the plugin's row isn't given the direct one's status.
  const codex = readAnswer('codex-cli', JSON.stringify([{ name: 'issues', enabled: true, auth_status: 'unsupported' }]), '');
  assert.deepEqual(rows.map(row => cellWords('codex-cli', row.cells['codex-cli']!, codex)), ['No sign-in needed', 'Not reported by Codex']);
});

test('Rows are the servers some managed tool has; a tool’s own switch and a plugin turned off are its Off marks', () => {
  const home = view(['claude-cli', 'codex-cli', 'pi-cli'], [
    fact('notes', { 'claude-cli': 'notes', 'pi-cli': 'notes' }, { switchedOff: ['pi-cli'] }),
    // Off in Central Knot and in no tool: no cell, so no row.
    fact('kept', {}, { on: false }),
    // Had in Codex only through the plugin, and turned off there: its own row's cell, Off.
    fact('docs', { 'claude-cli': 'Docs' }, { plugin: { 'codex-cli': { plugin: 'tracker', marketplace: 'probe-market', off: true } } }),
  ], [install('claude-cli', { off: true })]);
  assert.deepEqual(signinRows(home).map(row => [row.name, row.cells]), [
    ['docs', { 'claude-cli': { name: 'Docs', off: false }, 'codex-cli': { off: true } }],
    ['issues', { 'claude-cli': { name: 'plugin:tracker:issues', off: true } }],
    ['notes', { 'claude-cli': { name: 'notes', off: false }, 'pi-cli': { name: 'notes', off: true } }],
  ]);
});

// ---------- One check, run for a home ----------

const BINARIES = 'claude,codex,copilot,pi,opencode';
async function standIns() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-mcp-signin-test-')));
  const home = join(base, 'home'), tools = join(base, 'tools'), calls = join(base, 'calls.log');
  await mkdir(join(home, '.central-knot'), { recursive: true });
  await writeFile(join(home, '.central-knot/sync.json'), '{}\n');
  await mkdir(join(tools, '.local/bin'), { recursive: true });
  /** A stand-in for `binary` in this computer's own tools: it records where it ran, how full that folder was, HOME and one tool variable, then runs `body`. */
  const put = async (binary: string, body: string) => {
    const path = join(tools, '.local/bin', binary);
    await writeFile(path, `#!/bin/sh\necho "$(pwd)|$(ls -A | wc -l | tr -d ' ')|$HOME|\${CLAUDE_CONFIG_DIR-none}|$*" >> ${calls}\n${body}\n`);
    await chmod(path, 0o755);
  };
  const calledWith = async () => (await readFile(calls, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => line.split('|'));
  const where = (actual = true) => ({ home, actual, toolsHome: tools, searchPath: '' });
  const before = process.env.CK_TEST_HOME_ONLY;
  process.env.CK_TEST_HOME_ONLY = BINARIES;
  return { base, home, put, calledWith, where, done: async () => { process.env.CK_TEST_HOME_ONLY = before; await rm(base, { recursive: true, force: true }); } };
}
const isRunning = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('Check runs the tool’s command once, from an empty folder that is gone after, for the home on screen, writing nothing of Central Knot’s', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    await sandbox.put('codex', `cat ${join(import.meta.dirname, 'mcpsignin/codex-list.stdout')}`);
    const kept = await readdir(join(sandbox.home, '.central-knot'));
    const answer: SigninAnswer | undefined = await checkSignin(sandbox.where(), 'codex-cli');
    assert.equal(cellWords('codex-cli', { name: 'oauth', off: false }, answer), 'Needs sign-in');
    const calls = await sandbox.calledWith();
    assert.equal(calls.length, 1);
    const [[folder, entries, home, , args]] = calls;
    assert.deepEqual([entries, home, args], ['0', sandbox.home, 'mcp list --json']);
    assert.ok(folder.startsWith(tmpdir()) && folder !== sandbox.home, folder);
    await assert.rejects(readdir(folder), { code: 'ENOENT' });
    assert.deepEqual(await readdir(join(sandbox.home, '.central-knot')), kept);
    // Pi ends with exit code 1 when a server failed: its answer is read all the same.
    await sandbox.put('pi', `cat ${join(import.meta.dirname, 'mcpsignin/pi-list.stdout')}\nexit 1`);
    assert.equal(cellWords('pi-cli', { name: 'plain', off: false }, await checkSignin(sandbox.where(), 'pi-cli')), 'Connected');
  } finally { await sandbox.done(); }
});

test('A command that never answers is stopped at the limit with the processes it started, and says it didn’t answer', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const pidFile = join(sandbox.base, 'child.pid');
    await sandbox.put('pi', `sleep 300 &\necho $! > ${pidFile}\nwait`);
    const from = Date.now();
    const answer = await checkSignin(sandbox.where(), 'pi-cli', 400);
    assert.deepEqual(answer, { failed: 'timeout' });
    assert.ok(Date.now() - from < 5000, `stopped after ${Date.now() - from} ms`);
    const child = Number(await readFile(pidFile, 'utf8'));
    for (let tries = 0; tries < 50 && isRunning(child); tries++) await new Promise(done => setTimeout(done, 20));
    assert.equal(isRunning(child), false, 'the command’s own child was stopped with it');
  } finally { await sandbox.done(); }
});

test('A tool with no CLI here isn’t installed, Copilot CLI is never run, and only this computer’s home is given the tools’ folder variables', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  const before = process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.deepEqual(await checkSignin(sandbox.where(), 'opencode-cli'), { failed: 'missing' });
    await sandbox.put('copilot', 'echo "{}"');
    assert.equal(await checkSignin(sandbox.where(), 'copilot-cli'), undefined);
    assert.deepEqual(await sandbox.calledWith(), []);
    process.env.CLAUDE_CONFIG_DIR = join(sandbox.base, 'moved-claude');
    await sandbox.put('claude', `cat ${join(import.meta.dirname, 'mcpsignin/claude-list.stdout')}`);
    await checkSignin(sandbox.where(true), 'claude-cli');
    await checkSignin(sandbox.where(false), 'claude-cli');
    // This computer's home: its override, as every run there has it. A Practice copy or another folder: none, so the tool reads that home's files.
    assert.deepEqual((await sandbox.calledWith()).map(call => [call[2], call[3]]), [[sandbox.home, join(sandbox.base, 'moved-claude')], [sandbox.home, 'none']]);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    await sandbox.done();
  }
});
