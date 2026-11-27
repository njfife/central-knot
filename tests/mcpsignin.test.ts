// MCP sign-in: each tool's own answer read and put in words (mcpsignin.ts), on what the tools printed for four stand-in servers
// (tests/mcpsignin/: a server that needs nothing, one that needs a sign-in, one that is down and one that never answers, measured
// 2026-11-21 with Claude Code 2.1.330, Codex 0.169.1, Pi 1.6.0 and OpenCode 1.19.6, each in a throwaway home, never signed in;
// a plugin's server beside a direct one of the same name with Claude Code 2.1.330 and Codex 0.171.0; names holding ": " and a
// quote, and OpenCode with no servers, the same way); the page's rows from the view the Library has, those that need him first,
// which cells an answer still holds for as views come, the time a column shows of its own, and the line saying what a check does
// for each mix of tools; and one check run for a home (mcpsigninrun.ts), on stand-in commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { answerFor, askedNow, cannotRun, cellKey, cellNow, cellSays, checkLine, connectedCard, followView, grouped, lastSaid, ownTime, readAnswer, signInArgs, signInCommand, signinRows,
  offersSignin, type SigninCell, type SigninChecks, type SigninRow, type SigninRun } from '../src/mcpsignin.ts';
import { harnessIds } from '../src/harnesses.ts';
import { clockTime } from '../src/model.ts';
import { checkLimit, checkSignin, signinRefusal, startSignin, stopChecks, stopSignin, type SigninAsk, type SigninNow } from '../src/mcpsigninrun.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts, SigninAnswer, SigninEnd } from '../src/types.ts';
import { standIn } from './standin.ts';

const captured = (file: string) => readFileSync(join(import.meta.dirname, 'mcpsignin', file), 'utf8');
/** A server every tool has under its name, Off there or not, its transport not known. */
const server = (name: string, off = false): SigninRow => ({ id: name, name, cells: Object.fromEntries(harnessIds.map(tool => [tool, { name, off }])) });
/** What each named server's cell says in `tool`'s column, after its command printed `stdout`. */
const words = (tool: HarnessId, stdout: string, names: string[]) => {
  const answer = readAnswer(tool, stdout, stdout, names);
  return Object.fromEntries(names.map(name => [name, cellSays(tool, server(name), answer).words]));
};
const four = ['plain', 'oauth', 'down', 'silent'];

test('Codex’s three statuses become three words: no sign-in needed, needs sign-in, can’t tell', () => {
  assert.deepEqual(words('codex-cli', captured('codex-list.stdout'), four), {
    plain: 'No sign-in needed', oauth: 'Needs sign-in', down: 'Codex can’t tell if it needs a sign-in', silent: 'Codex can’t tell if it needs a sign-in',
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

test('Claude Code’s line is its server’s by the longest name it starts with: foo and “foo: bar” each keep their own', () => {
  assert.deepEqual(words('claude-cli', captured('claude-colon-names.stdout'), ['foo', 'foo: bar', 'O\'Reilly', 'with space']), {
    foo: 'Connected', 'foo: bar': 'Needs sign-in', 'O\'Reilly': 'Needs sign-in', 'with space': 'Needs sign-in',
  });
  assert.deepEqual(words('opencode-cli', captured('opencode-colon-names.stdout'), ['foo', 'foo: bar', 'with space']), {
    foo: 'Not reported by OpenCode', 'foo: bar': 'Needs sign-in', 'with space': 'Needs sign-in',
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
  // With no servers it says so, and that is a whole answer.
  assert.deepEqual(readAnswer('opencode-cli', captured('opencode-empty.stdout'), '', ['plain']), { servers: {} });
});

test('What a reader could not read is never made into a status: a state it doesn’t know is that server’s unread line', () => {
  const claude = readAnswer('claude-cli', 'Checking MCP server health…\n\nplain: http://127.0.0.1:1/mcp (HTTP) - ⏳ Pending approval\noauth: http://127.0.0.1:2/mcp (HTTP) - ✔ Connected\n', '', ['plain', 'oauth']);
  assert.deepEqual(['plain', 'oauth'].map(name => cellSays('claude-cli', server(name), claude)), [{ words: 'Couldn’t read Claude Code’s answer', line: 'plain: http://127.0.0.1:1/mcp (HTTP) - ⏳ Pending approval', heed: true }, { words: 'Connected' }]);
  const openCode = readAnswer('opencode-cli', '┌  MCP Servers\n│\n●  ○ plain needs client registration\n│      http://127.0.0.1:1/mcp\n│\n└  1 server(s)\n', '', ['plain']);
  assert.deepEqual(cellSays('opencode-cli', server('plain'), openCode), { words: 'Couldn’t read OpenCode’s answer', line: '●  ○ plain needs client registration', heed: true });
  // OpenCode's heading and then an error is no list: the whole answer is unread, its first line kept for every cell.
  const cut = readAnswer('opencode-cli', '\u001b[0m┌  MCP Servers\n│\n\u001b[91mError: Unexpected end of JSON input\u001b[0m\n', '', ['plain']);
  assert.deepEqual(cellSays('opencode-cli', server('plain'), cut), { words: 'Couldn’t read OpenCode’s answer', line: 'Error: Unexpected end of JSON input', heed: true });
  // Claude Code's heading is no listing either: followed by an error, or by lines naming none of the servers asked about, it is unread.
  assert.deepEqual(readAnswer('claude-cli', 'Checking MCP server health…\n\nError: Failed to read the configuration\n', '', ['plain']), { unreadable: 'Error: Failed to read the configuration' });
  assert.deepEqual(readAnswer('claude-cli', 'Checking MCP server health…\n\nplain → reachable\n', '', ['plain']), { unreadable: 'plain → reachable' });
  // A server named like an object's own member is a server like any other.
  assert.equal(cellSays('codex-cli', server('__proto__'), readAnswer('codex-cli', JSON.stringify([{ name: '__proto__', auth_status: 'unsupported' }]), '')).words, 'No sign-in needed');
});

test('An answer in a shape the reader doesn’t know says so for every server, with the first line the tool printed', () => {
  const unreadable = readAnswer('pi-cli', '', 'Error: unknown command "mcp"\nRun pi --help.');
  assert.deepEqual(unreadable, { unreadable: 'Error: unknown command "mcp"' });
  assert.deepEqual(cellSays('pi-cli', server('plain'), unreadable), { words: 'Couldn’t read Pi’s answer', line: 'Error: unknown command "mcp"', heed: true });
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
  const answer = readAnswer('claude-cli', captured('claude-list.stdout'), '', four);
  assert.deepEqual(cellSays('claude-cli', server('plain'), undefined), { words: 'Not checked', tone: 'muted' });
  assert.equal(cellSays('claude-cli', server('elsewhere'), answer).words, 'Not reported by Claude Code');
  assert.equal(cellSays('claude-cli', { id: 'unnamed', name: 'unnamed', cells: { 'claude-cli': { off: false } } }, answer).words, 'Not reported by Claude Code');
  // A name that is also a member every object has is a server like any other.
  assert.equal(cellSays('claude-cli', server('constructor'), answer).words, 'Not reported by Claude Code');
  // Switched off with the tool's own switch: said so, never matched against the answer.
  assert.deepEqual(cellSays('claude-cli', server('oauth', true), answer), { words: 'Off in Claude Code', tone: 'muted' });
  assert.equal(cellSays('codex-cli', server('plain'), { failed: 'missing' }).words, 'No Codex command line here');
  assert.equal(cellSays('codex-cli', server('plain'), { failed: 'timeout' }).words, 'Didn’t answer in 70 s');
  // Needs sign-in offers the tool's own command; it and every fault above need him (heed), the good answers and Not checked don't.
  assert.deepEqual(cellSays('claude-cli', server('oauth'), answer), { words: 'Needs sign-in', tone: 'warning', command: 'claude mcp login oauth', heed: true });
  assert.deepEqual([cellSays('codex-cli', server('plain'), { failed: 'missing' }).heed, cellSays('claude-cli', server('elsewhere'), answer).heed, cellSays('claude-cli', server('plain'), answer).heed], [true, true, undefined]);
  assert.deepEqual(cellSays('copilot-cli', server('github', true), undefined), { words: 'Off in Copilot CLI', tone: 'muted' });
  // Connected's card names only the columns whose Connected can't tell a sign-in from none needed.
  assert.equal(connectedCard(['codex-cli', 'pi-cli']), 'The server answered. Pi doesn’t say whether it needed a sign-in.');
  assert.equal(connectedCard(['claude-cli', 'copilot-cli', 'pi-cli', 'opencode-cli']), 'The server answered. Claude Code, Pi and OpenCode don’t say whether it needed a sign-in.');
});

/** A row named `name` whose copy runs by `transport` in each of `tools`, switched off there or not. */
const row = (name: string, transport: SigninRow['transport'], tools: HarnessId[], off = false): SigninRow => ({ id: name, name, transport, cells: Object.fromEntries(tools.map(tool => [tool, { name, off }])) });

test('A session-only tool’s cell is a mark: its hover says where that tool’s sign-in shows, or that the server is a local one', () => {
  const tools: HarnessId[] = ['copilot-cli', 'antigravity-cli'];
  assert.deepEqual(tools.map(tool => cellSays(tool, row('github', 'http', tools), undefined)), [
    { words: '•', tone: 'muted', title: 'In Copilot CLI. Sign in inside a session: /mcp auth github' },
    // Antigravity has no command known for its sign-in: none is named.
    { words: '•', tone: 'muted', title: 'In Antigravity. Sign-in shows only inside a session.' },
  ]);
  assert.deepEqual(tools.map(tool => cellSays(tool, row('notes', 'stdio', tools), undefined).title), ['In Copilot CLI. Local server.', 'In Antigravity. Local server.']);
});

test('What a check does is said before it is pressed, each part only where it is true, for every mix of tools', () => {
  const all: HarnessId[] = ['claude-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
  const mixed = [row('docs', 'http', all), row('notes', 'stdio', all)];
  // OpenCode's version decides what it leaves: 1.x adds $schema, 2.x leaves its service running; either, where it isn't known.
  assert.equal(checkLine(mixed, all, '1.19.6'), 'Check starts local servers in Claude Code, Pi and OpenCode; OpenCode adds $schema to its config files.');
  assert.equal(checkLine(mixed, all, '2.2.5'), 'Check starts local servers in Claude Code, Pi and OpenCode; OpenCode leaves a service running.');
  assert.equal(checkLine(mixed, all, undefined), 'Check starts local servers in Claude Code, Pi and OpenCode; OpenCode may leave a service running or add $schema to its config files (its version isn’t known).');
  // Codex starts no local server; a tool is named for one only where it has one, or one whose transport isn't known.
  assert.equal(checkLine([row('docs', 'http', ['codex-cli', 'pi-cli']), row('tickets', 'stdio', ['pi-cli'])], ['codex-cli', 'pi-cli'], undefined), 'Check starts local servers in Pi.');
  assert.equal(checkLine([row('docs', 'http', ['claude-cli']), row('odd', undefined, ['claude-cli'])], ['claude-cli'], undefined), 'Check starts local servers in Claude Code.');
  // No local server in any checked column: it contacts the remote ones, in each column that has one.
  assert.equal(checkLine([row('docs', 'http', ['codex-cli'])], ['codex-cli'], undefined), 'Check contacts remote servers in Codex.');
  assert.equal(checkLine([row('docs', 'sse', ['claude-cli', 'codex-cli'])], ['claude-cli', 'codex-cli'], undefined), 'Check contacts remote servers in Claude Code and Codex.');
  assert.equal(checkLine([row('docs', 'http', ['opencode-cli'])], ['opencode-cli'], '1.19.6'), 'Check contacts remote servers in OpenCode; OpenCode adds $schema to its config files.');
  // A server switched off in a tool is neither started nor contacted there: the tool is named by its other servers alone.
  assert.equal(checkLine([row('notes', 'stdio', ['claude-cli'], true), row('docs', 'http', ['claude-cli'])], ['claude-cli'], undefined), 'Check contacts remote servers in Claude Code.');
  // OpenCode's clause stands wherever OpenCode is checked, its only server off too: its command writes or starts that as it runs.
  assert.equal(checkLine([row('notes', 'stdio', ['opencode-cli'], true)], ['opencode-cli'], '1.19.6'), 'OpenCode adds $schema to its config files.');
  // Only session-only tools, or a check that would start and contact nothing: no line.
  assert.equal(checkLine([row('docs', 'http', ['copilot-cli', 'antigravity-cli'])], [], undefined), undefined);
  assert.equal(checkLine([row('notes', 'stdio', ['codex-cli'])], ['codex-cli'], undefined), undefined);
});

test('A column shows its own time before a whole Check all, and after one only where its minute or day differs', () => {
  const at = (iso: string) => ({ at: iso, answer: { servers: {} }, asked: [] });
  const checks: SigninChecks = { home: '/h', columns: { 'claude-cli': at('2026-11-21T10:00:05Z'), 'pi-cli': at('2026-11-21T10:00:50Z'), 'codex-cli': at('2026-11-21T10:02:00Z'), 'opencode-cli': at('2026-11-22T10:00:10Z') } };
  assert.equal(ownTime(checks, 'claude-cli'), '2026-11-21T10:00:05Z');
  checks.all = '2026-11-21T10:00:59Z';
  assert.deepEqual((['claude-cli', 'pi-cli', 'codex-cli', 'opencode-cli', 'copilot-cli'] as HarnessId[]).map(tool => ownTime(checks, tool)), [undefined, undefined, '2026-11-21T10:02:00Z', '2026-11-22T10:00:10Z', undefined]);
});

test('The rows that need him come first, each group in the order given: a sign-in to make, or a check that went wrong', () => {
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli'];
  const home = view(tools, ['calendar', 'docs', 'notes', 'oauth', 'plain'].map(name => fact(name, { 'claude-cli': name, 'copilot-cli': name })));
  const rows = signinRows(home);
  const answer = readAnswer('claude-cli', ['calendar: x - ✔ Connected', 'docs: x - ✘ Failed to connect — refused', 'oauth: x - ! Needs authentication', 'plain: x - ✔ Connected'].join('\n'), '', rows.map(each => each.name));
  const checks: SigninChecks = { home: '/h', columns: { 'claude-cli': { at: '2026-11-21T10:00:00Z', answer, asked: [] } } };
  // Before the answer holds for any cell, nothing needs him: the order is the one given.
  assert.deepEqual(grouped(rows, checks).map(each => each.name), ['calendar', 'docs', 'notes', 'oauth', 'plain']);
  checks.columns['claude-cli']!.asked = askedNow(home, 'claude-cli');
  // docs couldn't be reached, notes isn't reported, oauth needs a sign-in; Copilot CLI's marks need nothing.
  assert.deepEqual(grouped(rows, checks).map(each => each.name), ['docs', 'notes', 'oauth', 'calendar', 'plain']);
});

const windows = process.platform === 'win32';
const posixShellSkip = windows && 'POSIX /bin/sh quoting check; covered on macOS and Linux (Windows PowerShell quoting is step 18 under Later).';

test('The tool’s own sign-in command, with the server as one literal argument a shell accepts', async t => {
  assert.equal(signInCommand('claude-cli', 'plugin:tracker:issues'), 'claude mcp login plugin:tracker:issues');
  assert.equal(signInCommand('codex-cli', 'oauth'), 'codex mcp login -- oauth');
  assert.equal(signInCommand('pi-cli', 'team.docs_v2@corp/one-two'), 'pi mcp login team.docs_v2@corp/one-two');
  assert.equal(signInCommand('opencode-cli', 'my server'), 'opencode mcp auth \'my server\'');
  await t.test('POSIX /bin/sh round-trips every quoted server name', { skip: posixShellSkip }, () => {
    for (const name of ['O\'Reilly', 'my server', '$(touch x)', 'a"b\'c', '']) {
      const said = spawnSync('/bin/sh', ['-c', `set -- ${signInCommand('claude-cli', name)}; printf '%s|%s' "$#" "$4"`], { encoding: 'utf8' });
      assert.equal(said.stdout, `4|${name}`, name);
    }
  });
});

// ---------- A sign-in started on a click: its cell ----------

/** The checks of '/h' with Codex's answer that `names` need a sign-in, holding for `rows`, and the sign-ins started there. */
const needing = (rows: SigninRow[], signins: SigninRun[] = []): SigninChecks => ({ home: '/h', signins, columns: { 'codex-cli': {
  at: '2026-11-27T10:00:00Z', answer: { servers: Object.fromEntries(rows.map(each => [each.name, { is: 'needs-sign-in' }])) }, asked: rows.map(each => cellKey(each, each.cells['codex-cli']!)) } } });

test('The command a Sign in runs and the one its Copy gives are one table’s: the arguments as given, the command with the name one shell word', () => {
  assert.deepEqual(signInArgs('codex-cli', 'team\'s docs'), ['mcp', 'login', '--', 'team\'s docs']);
  assert.equal(signInCommand('codex-cli', 'team\'s docs'), 'codex mcp login -- \'team\'\\\'\'s docs\'');
  assert.equal(signInArgs('copilot-cli', 'github'), undefined);
});

test('Where Codex says a sign-in is needed its cell offers Sign in, on this computer’s home and not on Windows; elsewhere, and in every other tool, Copy', () => {
  assert.deepEqual([offersSignin('codex-cli', true, 'linux'), offersSignin('codex-cli', true, 'darwin'), offersSignin('codex-cli', true, 'win32'), offersSignin('codex-cli', false, 'linux'),
    offersSignin('pi-cli', true, 'linux'), offersSignin('claude-cli', true, 'linux')], [true, true, false, false, false, false]);
  const oauth = server('oauth'), checks = needing([oauth]);
  assert.deepEqual(cellNow(checks, 'codex-cli', oauth, true), { words: 'Needs sign-in', tone: 'warning', act: { label: 'Sign in', runs: 'codex mcp login -- oauth' }, heed: true });
  assert.deepEqual(cellNow(checks, 'codex-cli', oauth, false), { words: 'Needs sign-in', tone: 'warning', command: 'codex mcp login -- oauth', heed: true });
  // Only a cell that needs a sign-in has one: an answer that needs nothing offers nothing.
  assert.deepEqual(cellNow({ ...checks, columns: {} }, 'codex-cli', oauth, true), { words: 'Not checked', tone: 'muted' });
});

test('A sign-in’s cell: Stop while it waits, Signed in with its time, and on any other end what happened, in amber, Try again and the command to copy', () => {
  const oauth = server('oauth'), copy = cellKey(oauth, oauth.cells['codex-cli']!), at = '2026-11-27T10:05:00Z';
  const says = (end?: SigninEnd) => cellNow(needing([oauth], [{ tool: 'codex-cli', row: 'oauth', copy, ...(end ? { at, end } : {}) }]), 'codex-cli', oauth, true);
  const again = { tone: 'warning', command: 'codex mcp login -- oauth', act: { label: 'Try again', runs: 'codex mcp login -- oauth' }, heed: true };
  assert.deepEqual(says(), { words: 'Finish in your browser…', act: { label: 'Stop' }, heed: true });
  assert.deepEqual(says({ signedIn: true }), { words: `Signed in ${clockTime(at)}` });
  // What Codex said last is the cell's hover, not a line under it.
  assert.deepEqual(says({ unfinished: 'Error: the server refused the sign-in' }), { words: 'Sign-in didn’t finish', title: 'Error: the server refused the sign-in', ...again });
  assert.deepEqual(says({ failed: 'timeout' }), { words: 'Not finished in 3 minutes', ...again });
  assert.deepEqual(says({ failed: 'stopped' }), { words: 'Stopped', ...again });
  assert.deepEqual(says({ failed: 'missing' }), { words: 'No Codex command line here', ...again });
  assert.deepEqual(says({ notStarted: 'Another sign-in is running' }), { words: 'Another sign-in is running', ...again });
  // An end kept for another copy of the server isn't this cell's: it says the column's answer. One under way is the row's, with
  // its Stop, whatever became of the copy meanwhile.
  const moved = { ...oauth, cells: { 'codex-cli': { name: 'oauth', copy: 'other#2', off: false } } };
  assert.equal(cellNow(needing([moved], [{ tool: 'codex-cli', row: 'oauth', copy, at, end: { signedIn: true } }]), 'codex-cli', moved, true).words, 'Needs sign-in');
  assert.deepEqual(cellNow(needing([moved], [{ tool: 'codex-cli', row: 'oauth', copy }]), 'codex-cli', moved, true), { words: 'Finish in your browser…', act: { label: 'Stop' }, heed: true });
  // A Check of the column begun after it ended says what Codex answers then; one begun before it ended doesn't.
  const checked = (began: string) => ({ ...needing([oauth], [{ tool: 'codex-cli', row: 'oauth', copy, at, end: { signedIn: true } }]), columns: { 'codex-cli': { ...needing([oauth]).columns['codex-cli']!, began } } });
  assert.deepEqual([cellNow(checked('2026-11-27T10:06:00Z'), 'codex-cli', oauth, true).words, cellNow(checked('2026-11-27T10:04:00Z'), 'codex-cli', oauth, true).words], ['Needs sign-in', `Signed in ${clockTime(at)}`]);
  // Signed in needs nothing more of him: its row isn't put first; one that didn't finish is.
  const plain = server('plain');
  assert.deepEqual(grouped([plain, oauth], needing([plain, oauth], [{ tool: 'codex-cli', row: 'oauth', copy, at, end: { signedIn: true } }])).map(each => each.name), ['plain', 'oauth']);
  assert.deepEqual(grouped([plain, oauth], { ...needing([oauth], [{ tool: 'codex-cli', row: 'oauth', copy, at, end: { failed: 'stopped' } }]) }).map(each => each.name), ['oauth', 'plain']);
  // One that waits stands with the rows that need him too, as one that offers Sign in does.
  assert.deepEqual(grouped([plain, oauth], { home: '/h', columns: {}, signins: [{ tool: 'codex-cli', row: 'oauth', copy }] }).map(each => each.name), ['oauth', 'plain']);
  assert.deepEqual(grouped([plain, oauth], needing([oauth])).map(each => each.name), ['oauth', 'plain']);
});

test('What Codex said last is text: its colours and every other control character left out, cut past 200 characters', () => {
  assert.equal(lastSaid('Opening the browser\n\x1b[31mError:\x1b[0m the server\x07 refused\x00 it\n\n'), 'Error: the server refused it');
  assert.equal(lastSaid(`Error: ${'word '.repeat(60)}`).length <= 201, true);
});

test('What a sign-in ended with is kept for its copy alone: dropped at a view where that copy is changed, gone or Off; one under way is kept', () => {
  const home = (hash: string, off = false) => view(['codex-cli'], [fact('oauth', { 'codex-cli': 'oauth' }, { copies: { 'codex-cli': { folder: 'oauth', hash } } as LibraryFacts['copies'], ...(off ? { switchedOff: ['codex-cli'] as HarnessId[] } : {}) })]);
  const [before] = signinRows(home('oauth#1')), copy = cellKey(before, before.cells['codex-cli']!);
  const ended = (): SigninRun => ({ tool: 'codex-cli', row: 'oauth', copy, at: '2026-11-27T10:05:00Z', end: { signedIn: true } });
  for (const [what, now, kept] of [['unchanged', home('oauth#1'), 1], ['another copy', home('oauth#2'), 0], ['Off', home('oauth#1', true), 0], ['gone', view(['codex-cli'], []), 0]] as const) {
    const checks: SigninChecks = { home: '/h', columns: {}, signins: [ended(), { tool: 'codex-cli', row: 'oauth', copy }] };
    followView(checks, now);
    assert.deepEqual(checks.signins!.map(run => !!run.end), [...(kept ? [true] : []), false], what);
  }
  // One under way at a view without its copy on (Off; gone, then back), that then ends: its end is never shown.
  for (const [what, between] of [['Off', [home('oauth#1', true)]], ['gone and back', [view(['codex-cli'], []), home('oauth#1')]]] as const) {
    const run: SigninRun = { tool: 'codex-cli', row: 'oauth', copy }, checks: SigninChecks = { home: '/h', columns: {}, signins: [run] };
    for (const each of between) followView(checks, each);
    Object.assign(run, { at: '2026-11-27T10:05:00Z', end: { signedIn: true } });
    const [now] = signinRows(between.at(-1)!);
    assert.equal(cellNow(checks, 'codex-cli', now, true).words, what === 'Off' ? 'Off in Codex' : 'Not checked', what);
  }
});

test('Main starts a sign-in only for the home open, a managed tool it starts sign-ins for, and the very copy the page showed', () => {
  const oauth = server('oauth'), copy = cellKey(oauth, oauth.cells['codex-cli']!);
  const ask: SigninAsk = { home: '/h', tool: 'codex-cli', row: 'oauth', copy };
  const now: SigninNow = { where: { home: '/h', actual: true, toolsHome: '/h', searchPath: '' }, writable: true, managed: ['codex-cli', 'pi-cli'], rows: [oauth] };
  const where = (more: Partial<SigninNow['where']>) => ({ where: { ...now.where, ...more } });
  const cases: [string, Partial<SigninAsk>, Partial<SigninNow>, string, string | undefined][] = [
    ['the server as the page showed it', {}, {}, 'linux', undefined],
    ['another home open', { home: '/other' }, {}, 'linux', 'Another home is open'],
    ['the Practice copy or another folder', {}, where({ actual: false }), 'linux', 'Central Knot doesn’t start Codex’s sign-in here'],
    ['Windows', {}, {}, 'win32', 'Central Knot doesn’t start Codex’s sign-in here'],
    ['a tool whose sign-in it doesn’t start', { tool: 'pi-cli', copy: cellKey(oauth, oauth.cells['pi-cli']!) }, {}, 'linux', 'Central Knot doesn’t start Pi’s sign-in here'],
    ['a tool not managed', {}, { managed: ['pi-cli'] }, 'linux', 'Codex isn’t managed here'],
    ['a home Central Knot may only preview', {}, { writable: false }, 'linux', 'Central Knot doesn’t start Codex’s sign-in here'],
    ['the server gone', {}, { rows: [] }, 'linux', 'Changed since the page showed it'],
    ['the server switched off there', {}, { rows: [server('oauth', true)] }, 'linux', 'Changed since the page showed it'],
    ['another copy of it now', {}, { rows: [{ ...oauth, cells: { 'codex-cli': { name: 'oauth', copy: 'oauth#2', off: false } } }] }, 'linux', 'Changed since the page showed it'],
    ['a copy the tool’s list doesn’t name', {}, { rows: [{ ...oauth, cells: { 'codex-cli': { off: false } } }] }, 'linux', 'Changed since the page showed it'],
  ];
  for (const [what, asked, has, platform, refused] of cases) assert.equal(signinRefusal({ ...ask, ...asked }, { ...now, ...has }, platform), refused, what);
});

// ---------- The rows, from the view the Library has ----------

const fact = (name: string, copies: Partial<Record<HarnessId, string>>, more: Partial<LibraryFacts> = {}): LibraryFacts => ({
  key: name.toLowerCase(), name, description: '', on: true, except: [], cannot: {}, edited: [],
  copies: Object.fromEntries(Object.entries(copies).map(([tool, folder]) => [tool, { folder, hash: `${folder}#1` }])) as LibraryFacts['copies'], ...more,
});
const install = (tool: HarnessId, more: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  tool, plugin: 'tracker', marketName: 'probe-market', version: '1.0.0', listed: true, items: [{ kind: 'mcp', name: 'issues', description: '', runs: 'http://127.0.0.1:47312/mcp' }], ...more,
});
const view = (tools: HarnessId[], items: LibraryFacts[], pluginItems: InstalledPlugin[] = []) => {
  const empty = { tools, items: [], library: {} };
  return { mcp: { tools, items, library: {} }, skills: empty, agents: empty, pluginItems, snapshots: [] } as unknown as HomeView;
};
/** A row's cells by what they name and whether they are off (`copy`, what each copy is, aside). */
const named = (cells: Partial<Record<HarnessId, SigninCell>>) => Object.fromEntries(Object.entries(cells).map(([tool, { name, off }]) => [tool, name === undefined ? { off } : { name, off }]));

test('A plugin’s server in Claude Code beside a direct server of the same bare name: two rows, each with its own status', () => {
  const home = view(['claude-cli', 'codex-cli'], [fact('issues', { 'claude-cli': 'issues', 'codex-cli': 'issues' })], [install('claude-cli'), install('codex-cli')]);
  const rows = signinRows(home);
  assert.deepEqual(rows.map(row => [row.name, row.plugin, named(row.cells)]), [
    ['issues', undefined, { 'claude-cli': { name: 'issues', off: false }, 'codex-cli': { name: 'issues', off: false } }],
    // Claude Code names a plugin's server plugin:<plugin>:<server>; Codex's list doesn't name a plugin's server at all.
    ['issues', 'tracker', { 'claude-cli': { name: 'plugin:tracker:issues', off: false }, 'codex-cli': { off: false } }],
  ]);
  const claude = readAnswer('claude-cli', captured('claude-plugin-list.stdout'), '', ['issues', 'plugin:tracker:issues']);
  assert.deepEqual(rows.map(row => cellSays('claude-cli', row, claude).words), ['Connected', 'Needs sign-in']);
  // Codex reports only the direct server: the plugin's row isn't given the direct one's status.
  const codex = readAnswer('codex-cli', JSON.stringify([{ name: 'issues', enabled: true, auth_status: 'unsupported' }]), '');
  assert.deepEqual(rows.map(row => cellSays('codex-cli', row, codex).words), ['No sign-in needed', 'Not reported by Codex']);
});

test('A row runs as its Library row or its plugin’s copy says, and isn’t said to where neither does', () => {
  const home = view(['claude-cli'], [fact('notes', { 'claude-cli': 'notes' }, { transport: 'stdio' }), fact('odd', { 'claude-cli': 'odd' })],
    [install('claude-cli', { items: [{ kind: 'mcp', name: 'issues', description: '', runs: 'http://127.0.0.1:47312/mcp', transport: 'http' }, { kind: 'mcp', name: 'broken', description: '', runs: '' }] })]);
  assert.deepEqual(signinRows(home).map(each => [each.name, each.transport]), [['broken', undefined], ['issues', 'http'], ['notes', 'stdio'], ['odd', undefined]]);
});

test('A tool whose check can’t run on this computer: its last check found no command line, or, before one, its probe found none', () => {
  const home = { snapshots: [{ harness: 'claude-cli', probe: { state: 'missing' } }, { harness: 'pi-cli', probe: { state: 'ok', version: '1.6.0' } }] } as unknown as HomeView;
  const checks: SigninChecks = { home: '/h', columns: {} };
  assert.deepEqual([cannotRun(checks, home, 'claude-cli'), cannotRun(checks, home, 'pi-cli')], [true, false]);
  // A check's answer is the later word: Claude Code's command found since, Pi's gone.
  checks.columns['claude-cli'] = { at: '2026-11-21T10:00:00Z', answer: { servers: {} }, asked: [] };
  checks.columns['pi-cli'] = { at: '2026-11-21T10:00:00Z', answer: { failed: 'missing' }, asked: [] };
  assert.deepEqual([cannotRun(checks, home, 'claude-cli'), cannotRun(checks, home, 'pi-cli')], [false, true]);  // Pi installed since, and a Refresh: the view's probe finds it, which is newer than the check; its old answer goes.
  const after = { snapshots: [{ harness: 'pi-cli', probe: { state: 'ok', version: '1.6.0' } }], mcp: { tools: [], items: [] } } as unknown as HomeView;
  followView(checks, after);
  assert.deepEqual([cannotRun(checks, after, 'pi-cli'), checks.columns['pi-cli']], [false, undefined]);
  // A view whose probe still finds no Pi, or that ran no probe (another folder's home), keeps the check's word.
  checks.columns['pi-cli'] = { at: '2026-11-21T10:00:00Z', answer: { failed: 'missing' }, asked: [] };
  followView(checks, { ...after, snapshots: [{ harness: 'pi-cli', probe: { state: 'not-run' } }] } as unknown as HomeView);
  assert.equal(cannotRun(checks, after, 'pi-cli'), true);
});

test('Rows are the servers some managed tool has; a tool’s own switch and a plugin turned off are its Off marks', () => {
  const home = view(['claude-cli', 'codex-cli', 'pi-cli'], [
    fact('notes', { 'claude-cli': 'notes', 'pi-cli': 'notes' }, { switchedOff: ['pi-cli'] }),
    // Off in Central Knot and in no tool: no cell, so no row.
    fact('kept', {}, { on: false }),
    // Had in Codex only through the plugin, and turned off there: its own row's cell, Off.
    fact('docs', { 'claude-cli': 'Docs' }, { plugin: { 'codex-cli': { plugin: 'tracker', marketplace: 'probe-market', off: true } } }),
  ], [install('claude-cli', { off: true })]);
  assert.deepEqual(signinRows(home).map(row => [row.name, named(row.cells)]), [
    ['docs', { 'claude-cli': { name: 'Docs', off: false }, 'codex-cli': { off: true } }],
    ['issues', { 'claude-cli': { name: 'plugin:tracker:issues', off: true } }],
    ['notes', { 'claude-cli': { name: 'notes', off: false }, 'pi-cli': { name: 'notes', off: true } }],
  ]);
});

test('An answer holds only for the copies it was asked about: one changed, gone or Off at any view since says Not checked', () => {
  const tools: HarnessId[] = ['claude-cli'];
  /** The home with plain's copy as `plain`, solo there or not, the plugin at `version`, and paused switched off in Claude Code or not. */
  const home = (plain: string, solo: boolean, version: string, paused: boolean) => view(tools, [
    fact('keep', { 'claude-cli': 'keep' }), fact('paused', { 'claude-cli': 'paused' }, paused ? { switchedOff: ['claude-cli'] } : {}),
    fact('plain', { 'claude-cli': 'plain' }, { copies: { 'claude-cli': { folder: 'plain', hash: plain } } as LibraryFacts['copies'] }),
    ...(solo ? [fact('solo', { 'claude-cli': 'solo' })] : []),
  ], [install('claude-cli', { version })]);
  const names = ['keep', 'paused', 'plain', 'solo', 'plugin:tracker:issues'];
  const answer = readAnswer('claude-cli', ['Checking MCP server health…', '', ...names.map(name => `${name}: http://127.0.0.1:1/mcp (HTTP) - ✔ Connected`)].join('\n'), '', names);
  const before = home('plain#1', true, '1.0.0', false);
  const said = (checks: SigninChecks, now: HomeView) => Object.fromEntries(signinRows(now).map(row => [`${row.name}${row.plugin ? ' (plugin)' : ''}`, cellSays('claude-cli', row, answerFor(checks, 'claude-cli', row)).words]));
  const checks: SigninChecks = { home: '/h', columns: { 'claude-cli': { at: '2026-11-21T10:00:00Z', answer, asked: askedNow(before, 'claude-cli') } } };
  assert.deepEqual(said(checks, before), { 'issues (plugin)': 'Connected', keep: 'Connected', paused: 'Connected', plain: 'Connected', solo: 'Connected' });
  // One view in between: plain's address changed (another copy), solo gone, the plugin updated, paused switched off. Then all as before.
  followView(checks, home('plain#2', false, '1.1.0', true));
  followView(checks, before);
  assert.deepEqual(said(checks, before), { 'issues (plugin)': 'Not checked', keep: 'Connected', paused: 'Not checked', plain: 'Not checked', solo: 'Not checked' });
  // A check under way is followed the same way: what changed while it ran is not given its answer.
  const running: SigninChecks = { home: '/h', columns: {}, checking: { tool: 'claude-cli', asked: askedNow(before, 'claude-cli') } };
  followView(running, home('plain#2', true, '1.0.0', false));
  running.columns['claude-cli'] = { at: '2026-11-21T10:01:00Z', answer, asked: running.checking!.asked };
  assert.deepEqual(said(running, before), { 'issues (plugin)': 'Connected', keep: 'Connected', paused: 'Connected', plain: 'Not checked', solo: 'Connected' });
});

test('A copy is its shared content and that tool’s own part: one tool’s own setting changed says Not checked in that tool only', () => {
  const tools: HarnessId[] = ['claude-cli', 'opencode-cli'];
  const home = (openCodeOwn: string) => view(tools, [fact('team', {}, { copies: {
    'claude-cli': { folder: 'team', hash: 'shared#1', ownHash: 'claude-own#1' }, 'opencode-cli': { folder: 'team', hash: 'shared#1', ownHash: openCodeOwn },
  } as LibraryFacts['copies'] })]);
  const before = home('opencode-own#1'), after = home('opencode-own#2');
  const checks: SigninChecks = { home: '/h', columns: {
    'claude-cli': { at: '2026-11-21T10:00:00Z', answer: readAnswer('claude-cli', 'team: http://127.0.0.1:1/mcp (HTTP) - ✔ Connected', '', ['team']), asked: askedNow(before, 'claude-cli') },
    'opencode-cli': { at: '2026-11-21T10:00:00Z', answer: readAnswer('opencode-cli', '┌  MCP Servers\n│\n●  ✓ team connected\n│\n└  1 server(s)', '', ['team']), asked: askedNow(before, 'opencode-cli') },
  } };
  // Only OpenCode's own part of the copy changed (its sign-in setting, say): OpenCode's answer is the old copy's; Claude Code's stands.
  followView(checks, after);
  const [row] = signinRows(after);
  assert.deepEqual(tools.map(tool => cellSays(tool, row, answerFor(checks, tool, row)).words), ['Connected', 'Not checked']);
});

// ---------- One check, run for a home ----------

const BINARIES = 'claude,codex,copilot,pi,opencode';
async function standIns() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-mcp-signin-test-')));
  const home = join(base, 'home'), tools = join(base, 'tools'), calls = join(base, 'calls.log');
  await mkdir(join(home, '.central-knot'), { recursive: true });
  await writeFile(join(home, '.central-knot/sync.json'), '{}\n');
  await mkdir(join(tools, '.local/bin'), { recursive: true });
  /**
   * A stand-in for `binary` in this computer's own tools: it records where it ran, how full that folder was, HOME and one tool
   * variable, then runs `body` (shell), or on Windows `js` (Node: tests/standin.ts).
   */
  const put = (binary: string, body: string, js: string, folder = join(tools, '.local/bin')) => standIn(join(folder, binary),
    `#!/bin/sh\necho "$(pwd)|$(ls -A | wc -l | tr -d ' ')|$HOME|\${CLAUDE_CONFIG_DIR-none}|$*" >> ${calls}\n${body}\n`,
    `const fs = require("fs"); fs.appendFileSync(${JSON.stringify(calls)}, [fs.realpathSync.native(process.cwd()), fs.readdirSync(".").length, process.env.HOME, process.env.CLAUDE_CONFIG_DIR ?? "none", process.argv.slice(1).join(" ")].join("|") + "\\n");\n${js}`);
  const calledWith = async () => (await readFile(calls, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => line.split('|'));
  const where = (actual = true, searchPath = '') => ({ home, actual, toolsHome: tools, searchPath });
  const before = process.env.CK_TEST_HOME_ONLY;
  process.env.CK_TEST_HOME_ONLY = BINARIES;
  return { base, home, tools, put, calledWith, where, done: async () => { process.env.CK_TEST_HOME_ONLY = before; await rm(base, { recursive: true, force: true }); } };
}
/**
 * The Windows stand-ins' words for `cat <file>`, and for `sleep 300 & echo $! > <pidFile>; wait`: a child left waiting, its number
 * written down (60 s there, so that one a failed test leaves can't hold the hosted run).
 */
const printOut = (file: string) => `process.stdout.write(fs.readFileSync(${JSON.stringify(join(import.meta.dirname, 'mcpsignin', file))}));`;
const leaveChild = (pidFile: string) => `fs.writeFileSync(${JSON.stringify(pidFile)}, String(require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" }).pid));`;
const isRunning = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ready: () => Promise<boolean>) => { for (let tries = 0; tries < 250 && !(await ready()); tries++) await new Promise(done => setTimeout(done, 20)); };

test('Check runs the tool’s command once, from an empty folder that is gone after, for the home on screen, writing nothing of Central Knot’s', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    await sandbox.put('codex', `cat ${join(import.meta.dirname, 'mcpsignin/codex-list.stdout')}`, printOut('codex-list.stdout'));
    const kept = await readdir(join(sandbox.home, '.central-knot'));
    const answer: SigninAnswer | undefined = await checkSignin(sandbox.where(), 'codex-cli', []);
    assert.equal(cellSays('codex-cli', server('oauth'), answer).words, 'Needs sign-in');
    const calls = await sandbox.calledWith();
    assert.equal(calls.length, 1);
    const [[folder, entries, home, , args]] = calls;
    assert.deepEqual([entries, home, args], ['0', sandbox.home, 'mcp list --json']);
    assert.ok(folder.startsWith(await realpath(tmpdir())) && folder !== sandbox.home, folder);
    await assert.rejects(readdir(folder), { code: 'ENOENT' });
    assert.deepEqual(await readdir(join(sandbox.home, '.central-knot')), kept);
    // Pi ends with exit code 1 when a server failed: its answer is read all the same.
    await sandbox.put('pi', `cat ${join(import.meta.dirname, 'mcpsignin/pi-list.stdout')}\nexit 1`, `${printOut('pi-list.stdout')} process.exitCode = 1;`);
    assert.equal(cellSays('pi-cli', server('plain'), await checkSignin(sandbox.where(), 'pi-cli', [])).words, 'Connected');
  } finally { await sandbox.done(); }
});

test('A command that never answers is stopped at the limit with the processes it started, and says it didn’t answer', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const pidFile = join(sandbox.base, 'child.pid');
    await sandbox.put('pi', `sleep 300 &\necho $! > ${pidFile}\nwait`, leaveChild(pidFile));
    const from = Date.now();
    const answer = await checkSignin(sandbox.where(), 'pi-cli', [], 400);
    assert.deepEqual(answer, { failed: 'timeout' });
    assert.ok(Date.now() - from < 5000, `stopped after ${Date.now() - from} ms`);
    const child = Number(await readFile(pidFile, 'utf8'));
    await until(async () => !isRunning(child));
    assert.equal(isRunning(child), false, 'the command’s own child was stopped with it');
  } finally { await sandbox.done(); }
});

test('A check’s limit can only be shortened: a longer one, none, zero or a negative one is the 70 s', () => {
  assert.deepEqual([4000, 100_000, Number.NaN, 0, -5].map(checkLimit), [4000, 70_000, 70_000, 70_000, 70_000]);
});

test('A tool with no command line here says so, Copilot CLI is never run, and only this computer’s home is given the tools’ folder variables', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  const before = process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.deepEqual(await checkSignin(sandbox.where(), 'opencode-cli', []), { failed: 'missing' });
    await sandbox.put('copilot', 'echo "{}"', 'process.stdout.write("{}\\n");');
    assert.equal(await checkSignin(sandbox.where(), 'copilot-cli', []), undefined);
    assert.deepEqual(await sandbox.calledWith(), []);
    process.env.CLAUDE_CONFIG_DIR = join(sandbox.base, 'moved-claude');
    await sandbox.put('claude', `cat ${join(import.meta.dirname, 'mcpsignin/claude-list.stdout')}`, printOut('claude-list.stdout'));
    await checkSignin(sandbox.where(true), 'claude-cli', []);
    await checkSignin(sandbox.where(false), 'claude-cli', []);
    // This computer's home: its override, as every run there has it. A Practice copy or another folder: none, so the tool reads that home's files.
    assert.deepEqual((await sandbox.calledWith()).map(call => [call[2], call[3]]), [[sandbox.home, join(sandbox.base, 'moved-claude')], [sandbox.home, 'none']]);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    await sandbox.done();
  }
});

test('A home other than this computer’s is checked with an environment made for it: the path, the home, the temporary folder, the locale and the terminal', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  const kept: Record<string, string> = { TMPDIR: sandbox.base, LANG: 'C.UTF-8', LC_ALL: 'C', LC_CTYPE: 'UTF-8', TERM: 'xterm-256color' };
  const extra: Record<string, string> = { OPENCODE_CONFIG: join(sandbox.base, 'real-home/opencode.json'), SOME_TOKEN: 'x' };
  const before = Object.fromEntries([...Object.keys(kept), ...Object.keys(extra)].map(name => [name, process.env[name]]));
  try {
    const seen = join(sandbox.base, 'env.txt');
    await sandbox.put('opencode', `env > ${seen}\ncat ${join(import.meta.dirname, 'mcpsignin/opencode-list.stdout')}`,
      `fs.writeFileSync(${JSON.stringify(seen)}, Object.entries(process.env).map(([name, value]) => name + "=" + value + "\\n").join("")); ${printOut('opencode-list.stdout')}`);
    // What the shell adds by itself (PWD, OLDPWD, SHLVL, _) aside; on Windows, what Windows gives every program it starts
    // whatever it was given (the list libuv keeps), and what cmd.exe and npm's .cmd add (measured on Windows Server 2025).
    const added = windows ? ['COMSPEC', 'LOGONSERVER', 'PATHEXT', 'PROMPT', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'WINDIR'] : ['PWD', 'OLDPWD', 'SHLVL', '_'];
    const readEnv = async () => Object.fromEntries((await readFile(seen, 'utf8')).split('\n').filter(Boolean)
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
      .filter(([name]) => !added.includes(windows ? name.toUpperCase() : name)));
    // On Windows, the variables a tool there finds its home by, each pointing into this home.
    const homeIn = windows ? { APPDATA: join(sandbox.home, 'AppData', 'Roaming'), CODEX_HOME: join(sandbox.home, '.codex'), HOMEDRIVE: sandbox.home.slice(0, 2),
      HOMEPATH: sandbox.home.slice(2), LOCALAPPDATA: join(sandbox.home, 'AppData', 'Local'), USERPROFILE: sandbox.home } : {};
    // Set: the kept variables are passed on with their values, and nothing else from the app's environment reaches another home.
    Object.assign(process.env, extra, kept);
    await checkSignin(sandbox.where(false), 'opencode-cli', []);
    const withKept = await readEnv();
    assert.deepEqual(Object.keys(withKept).sort(), ['HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PATH', 'TERM', 'TMPDIR', ...Object.keys(homeIn)].sort());
    assert.deepEqual(Object.fromEntries(Object.keys(kept).map(name => [name, withKept[name]])), kept);
    assert.deepEqual(Object.fromEntries(Object.keys(homeIn).map(name => [name, withKept[name]])), homeIn);
    // Unset: absent from the environment, not passed on empty.
    for (const name of Object.keys(kept)) delete process.env[name];
    await checkSignin(sandbox.where(false), 'opencode-cli', []);
    assert.deepEqual(Object.keys(await readEnv()).sort(), ['HOME', 'PATH', ...Object.keys(homeIn)].sort());
    // This computer's own home: the app's environment, an override of the tool's own included.
    await checkSignin(sandbox.where(true), 'opencode-cli', []);
    assert.ok((await readFile(seen, 'utf8')).split('\n').includes(`OPENCODE_CONFIG=${extra.OPENCODE_CONFIG}`));
  } finally {
    for (const [name, value] of Object.entries(before)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await sandbox.done();
  }
});

test('Only a command line outside an app bundle is run: a link into one is passed over for the next', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const bundled = await sandbox.put('codex', 'echo bundle', 'process.stdout.write("bundle\\n");', join(sandbox.base, 'ChatGPT.app/Contents/Resources/codex-cli/bin'));
    await symlink(bundled, join(sandbox.tools, '.local/bin', basename(bundled)));
    await sandbox.put('codex', `cat ${join(import.meta.dirname, 'mcpsignin/codex-list.stdout')}`, printOut('codex-list.stdout'), join(sandbox.tools, 'later-bin'));
    const answer = await checkSignin(sandbox.where(true, join(sandbox.tools, 'later-bin')), 'codex-cli', []);
    assert.equal(cellSays('codex-cli', server('plain'), answer).words, 'No sign-in needed');
    assert.equal((await sandbox.calledWith()).length, 1);
  } finally { await sandbox.done(); }
});

// ---------- One sign-in, run for this computer's home ----------

const noSignInHere = windows && 'Central Knot starts no sign-in on Windows (mcpsignin.ts offersSignin): the cell keeps its Copy there.';
const TEAM = 'team\'s docs';
/**
 * A stand-in Codex whose `mcp login` writes its arguments one a line; takes an argument that begins with a dash before `--` as
 * an option, as Codex's parser does (any: it prints its usage and ends with exit 0); opens the browser as Codex does (webbrowser
 * 1.2.4: each word of $BROWSER, the address last, else xdg-open, spawned as its child with nothing on its input or output); then
 * by `mode`: says it signed in (exit 0); says why it didn't (exit 1); or waits for the browser with a helper that ignores TERM
 * and listens on a port (its port and process written down), noting a TERM and ending on it, or (`deaf`) ignoring that too.
 * Beside it, a stand-in xdg-open starts a long-lived "browser" in its own process group as xdg-open does (no new session),
 * writes its process down and ends.
 */
async function signinStandIn(sandbox: Awaited<ReturnType<typeof standIns>>, mode: 'accept' | 'refuse' | 'wait' | 'deaf') {
  const [args, port, signals, browsers] = ['args', 'port', 'signals', 'browsers'].map(file => join(sandbox.base, file));
  const helper = `process.on("SIGTERM", () => {}); const s = require("net").createServer().listen(0, "127.0.0.1", () => require("fs").writeFileSync(${JSON.stringify(port)}, s.address().port + " " + process.pid));`;
  // How it takes TERM, from its start; then what it does once the browser is up.
  const trap = { accept: '', refuse: '', wait: `trap 'echo TERM >> ${signals}; exit 143' TERM`, deaf: `trap '' TERM` }[mode];
  const body = { accept: 'echo "Successfully logged in"', refuse: 'echo "Waiting for consent" >&2\nsleep 0.1\necho "Error: the server refused the sign-in"\nexit 1',
    wait: `"${process.execPath}" -e '${helper}' &\nwait`, deaf: `"${process.execPath}" -e '${helper}' &\nwait` }[mode];
  const options = 'for given in "$@"; do [ "$given" = "--" ] && break; case "$given" in -*) echo "Usage: codex mcp login [OPTIONS] <NAME>"; exit 0;; esac; done';
  const browse = 'if [ -n "$BROWSER" ]; then $BROWSER http://127.0.0.1:1/cb </dev/null >/dev/null 2>&1 & else xdg-open http://127.0.0.1:1/cb </dev/null >/dev/null 2>&1 & fi';
  // It goes on once the browser is up, as Codex does when the person has signed in there.
  const browserUp = `while [ ! -s ${browsers} ]; do sleep 0.05; done`;
  await sandbox.put('codex', `printf '%s\\n' "$@" > ${args}\n${trap}\n${options}\n${browse}\n${browserUp}\n${body}`, '');
  await standIn(join(sandbox.tools, '.local/bin/xdg-open'), `#!/bin/sh\n"${process.execPath}" -e 'require("fs").appendFileSync(${JSON.stringify(browsers)}, process.pid + "\\n"); setInterval(() => {}, 1000);' </dev/null >/dev/null 2>&1 &`, '');
  const listening = async () => { await until(async () => !!(await readFile(port, 'utf8').catch(() => ''))); return (await readFile(port, 'utf8')).split(' ').map(Number); };
  /** The "browsers" the stand-in xdg-open started, once one has. */
  const opened = async () => { await until(async () => !!(await readFile(browsers, 'utf8').catch(() => ''))); return (await readFile(browsers, 'utf8')).split('\n').filter(Boolean).map(Number); };
  return { args: async () => (await readFile(args, 'utf8')).split('\n').slice(0, -1), listening, opened, signals: () => readFile(signals, 'utf8').catch(() => '') };
}
/** Ends every stand-in "browser" the stand-in xdg-open in `sandbox` started. */
const closeBrowsers = async (sandbox: Awaited<ReturnType<typeof standIns>>) => {
  for (const pid of (await readFile(join(sandbox.base, 'browsers'), 'utf8').catch(() => '')).split('\n').filter(Boolean)) try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already ended */ }
};
/** What main has now for `rows` (the home open, Codex managed) in the sandbox's home. */
const nowIn = (sandbox: Awaited<ReturnType<typeof standIns>>, rows: SigninRow[]) => async (): Promise<SigninNow> => ({ where: sandbox.where(), writable: true, managed: ['codex-cli'], rows });
const askFor = (sandbox: Awaited<ReturnType<typeof standIns>>, row: SigninRow): SigninAsk => ({ home: sandbox.home, tool: 'codex-cli', row: row.id, copy: cellKey(row, row.cells['codex-cli']!) });
/** Whether something listens on `port` (on 127.0.0.1) still: a new listener there can't be opened. */
const portTaken = (port: number) => new Promise<boolean>(done => { const probe = createServer().once('error', () => done(true)).listen(port, '127.0.0.1', () => probe.close(() => done(false))); });
/** Whether `pid` still runs and `port` is still held, once each has had its moment to go (a killed process ends a moment after its kill). */
const left = async (pid: number, port: number) => { await until(async () => !isRunning(pid) && !(await portTaken(port))); return [isRunning(pid), await portTaken(port)]; };

test('Sign in runs the tool’s own `mcp login`, the server’s name one literal argument after `--`, from an empty folder, and nothing else; exit 0 is Signed in', { skip: noSignInHere, timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const fake = await signinStandIn(sandbox, 'accept'), team = server(TEAM);
    assert.deepEqual(await startSignin(askFor(sandbox, team), nowIn(sandbox, [team])), { signedIn: true });
    assert.deepEqual(await fake.args(), ['mcp', 'login', '--', TEAM]);
    const calls = await sandbox.calledWith();
    assert.equal(calls.length, 1, 'no list is run after it');
    assert.deepEqual([calls[0][1], calls[0][2]], ['0', sandbox.home]);
    await assert.rejects(readdir(calls[0][0]), { code: 'ENOENT' });
    // What it said last, by when it came (here its output after its errors), is the cell's when it ends otherwise.
    await signinStandIn(sandbox, 'refuse');
    assert.deepEqual(await startSignin(askFor(sandbox, team), nowIn(sandbox, [team])), { unfinished: 'Error: the server refused the sign-in' });
  } finally { await closeBrowsers(sandbox); await sandbox.done(); }
});

test('A server’s name is never an option: one that begins with a dash comes after `--`, so Codex never takes `--help` and ends with exit 0', { skip: noSignInHere, timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const fake = await signinStandIn(sandbox, 'accept'), help = server('--help');
    await startSignin(askFor(sandbox, help), nowIn(sandbox, [help]));
    assert.deepEqual([await fake.args(), signInCommand('codex-cli', '--help')], [['mcp', 'login', '--', '--help'], 'codex mcp login -- --help']);
  } finally { await closeBrowsers(sandbox); await sandbox.done(); }
});

test('Its input is closed: a tool that reads its input to the end goes on to sign in', { skip: noSignInHere, timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    await sandbox.put('codex', `cat > ${join(sandbox.base, 'input')}\necho "Successfully logged in"`, '');
    const oauth = server('oauth');
    assert.deepEqual(await startSignin(askFor(sandbox, oauth), nowIn(sandbox, [oauth]), 2000), { signedIn: true });
  } finally { await sandbox.done(); }
});

test('A sign-in main refuses runs nothing: a server changed since the page showed it, and a second while one runs, refused at once', { skip: noSignInHere, timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const fake = await signinStandIn(sandbox, 'wait'), oauth = server('oauth');
    const changed = { ...oauth, cells: { 'codex-cli': { name: 'oauth', copy: 'oauth#2', off: false } } };
    assert.deepEqual(await startSignin(askFor(sandbox, oauth), nowIn(sandbox, [changed])), { notStarted: 'Changed since the page showed it' });
    assert.deepEqual(await sandbox.calledWith(), []);
    const first = startSignin(askFor(sandbox, oauth), nowIn(sandbox, [oauth]));
    assert.deepEqual(await startSignin(askFor(sandbox, oauth), nowIn(sandbox, [oauth])), { notStarted: 'Another sign-in is running' });
    await fake.listening();
    stopSignin();
    assert.deepEqual(await first, { failed: 'stopped' });
    assert.equal((await sandbox.calledWith()).length, 1);
  } finally { await closeBrowsers(sandbox); await sandbox.done(); }
});

test('Stop asks the tool to end, then ends what it left: its helper that ignores TERM is gone and its port free', { skip: noSignInHere, timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const fake = await signinStandIn(sandbox, 'wait'), oauth = server('oauth');
    const run = startSignin(askFor(sandbox, oauth), nowIn(sandbox, [oauth]));
    const [port, helper] = await fake.listening();
    assert.equal(await portTaken(port), true);
    stopSignin();
    assert.deepEqual(await run, { failed: 'stopped' });
    assert.deepEqual([await fake.signals(), ...await left(helper, port)], ['TERM\n', false, false]);
  } finally { await closeBrowsers(sandbox); await sandbox.done(); }
});

test('No ending reaches the browser Codex opened: it lives on after Signed in, after Stop, and at the limit, where Codex ignored TERM and was ended after the grace', { skip: noSignInHere, timeout: 20_000 }, async () => {
  const lives: [SigninEnd, boolean][] = [];
  for (const [mode, limit] of [['accept', undefined], ['wait', undefined], ['deaf', 300]] as const) {
    const sandbox = await standIns();
    try {
      const fake = await signinStandIn(sandbox, mode), oauth = server('oauth');
      const run = startSignin(askFor(sandbox, oauth), nowIn(sandbox, [oauth]), limit);
      const [browser] = await fake.opened();
      if (mode === 'wait') { await fake.listening(); stopSignin(); }
      const ending = await run;
      await new Promise(done => setTimeout(done, 300));
      lives.push([ending, isRunning(browser)]);
    } finally { await closeBrowsers(sandbox); await sandbox.done(); }
  }
  assert.deepEqual(lives, [[{ signedIn: true }, true], [{ failed: 'stopped' }, true], [{ failed: 'timeout' }, true]]);
});

// Last in this file: Quit closes the door to new checks and sign-ins for the rest of the process, as it does for the app.
test('Quit stops every check and sign-in, the check just clicked too, each second Quit waits for the clean-up, and none starts after', { timeout: 15_000 }, async () => {
  const sandbox = await standIns();
  try {
    const pidFile = join(sandbox.base, 'child.pid');
    await sandbox.put('claude', `sleep 300 &\necho $! > ${pidFile}\nwait`, leaveChild(pidFile));
    const running = checkSignin(sandbox.where(), 'claude-cli', []);
    await until(async () => !!(await readFile(pidFile, 'utf8').catch(() => '')));
    const [[folder]] = await sandbox.calledWith();
    // A sign-in waiting on the browser it opened, its helper ignoring TERM (none is started on Windows: mcpsignin.ts offersSignin).
    const fake = windows ? undefined : await signinStandIn(sandbox, 'wait'), oauth = server('oauth');
    const signing = fake && startSignin(askFor(sandbox, oauth), nowIn(sandbox, [oauth]));
    const [port, helper] = (await fake?.listening()) ?? [];
    const [browser] = (await fake?.opened()) ?? [];
    // Clicked a moment before Quit: still looking for its command line when Quit comes.
    const clicked = checkSignin(sandbox.where(), 'codex-cli', []);
    const from = Date.now(), first = stopChecks(), second = stopChecks();
    assert.ok(first && second, 'both Quits wait');
    await second;
    assert.ok(Date.now() - from < 5000, `stopped after ${Date.now() - from} ms`);
    await assert.rejects(readdir(folder), { code: 'ENOENT' });
    const child = Number(await readFile(pidFile, 'utf8'));
    await until(async () => !isRunning(child));
    assert.equal(isRunning(child), false, 'the command’s own child was stopped');
    assert.equal(await clicked, undefined);
    if (fake) {
      assert.deepEqual([await signing, ...await left(helper!, port!), isRunning(browser!)], [{ failed: 'stopped' }, false, false, true]);
      assert.deepEqual(await startSignin(askFor(sandbox, oauth), nowIn(sandbox, [oauth])), { failed: 'stopped' });
    }
    // Once Quit has begun no check starts: only the first ever ran its command, and the sign-in before Quit its own.
    assert.equal(await checkSignin(sandbox.where(), 'codex-cli', []), undefined);
    assert.deepEqual((await sandbox.calledWith()).map(call => call[4]), ['mcp list', ...(fake ? ['mcp login -- oauth'] : [])]);
    await running;
  } finally { await closeBrowsers(sandbox); await sandbox.done(); }
});
