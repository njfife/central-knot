// Usage read from the tools' session history (src/usage.ts, in main) and what it says of a row (src/usagerow.ts, the page's),
// as worked examples. Every session file here is made up by the test, in each tool's own record shapes: a use is a call (or a
// skill the person typed), and the lists of what was available that every session holds are written in too, to be ignored.
// The reading is made at noon on 16 November 2026; "N days ago" counts back from it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readers, readUsage } from '../src/usage.ts';
import { leftToItsRow, noUseSeen, onIn, rowFigure, toolHistories, toolSays, usageSummary, USAGE_DAYS } from '../src/usagerow.ts';
import { newItem, type LibraryItem } from '../src/library.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts, ToolCopy, UsageReading } from '../src/types.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

/** A made-up home, removed when the tests end. */
const homes: string[] = [];
const newHome = async () => { const home = await realpath(await mkdtemp(join(tmpdir(), 'ck-usagetest-'))); homes.push(home); return home; };
after(() => Promise.all(homes.map(home => rm(home, { recursive: true, force: true }))));
async function put(path: string, records: object[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n');
}
/** One tool's names in a reading, each `kind:name` with its session count and newest use. */
const usedIn = (reading: UsageReading, tool: HarnessId) =>
  Object.fromEntries(reading.tools.find(each => each.tool === tool)!.used.map(used => [`${used.kind}:${used.name}`, [used.sessions.length, used.last]]));
const historyOf = (reading: UsageReading, tool: HarnessId) => reading.tools.find(each => each.tool === tool)!;

// ---------- Each tool's records ----------

test('Claude Code: a Skill, Agent or mcp__ call and a typed /command are uses, a subagent\'s file is its session\'s, and the listings are not', async () => {
  const home = await newHome(), project = join(home, '.claude/projects/-work-app');
  await put(join(project, 'one.jsonl'), [
    { type: 'user', message: { role: 'user', content: '<command-name>/standup</command-name>\n<command-args></command-args>' }, timestamp: daysAgo(3) },
    // What was available, in every session: never a use.
    { type: 'attachment', attachment: { type: 'skill_listing', content: '- listed-only: a skill' }, timestamp: daysAgo(3) },
    { type: 'api-request-blob', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'listed-only' } }] }, timestamp: daysAgo(3) },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Skill', input: { skill: 'notes' } },
      { type: 'tool_use', name: 'Agent', input: { subagent_type: 'reviewer', description: 'x' } },
      { type: 'tool_use', name: 'mcp__ask-lou__ask', input: {} },
      { type: 'tool_use', name: 'Read', input: { file_path: '/x' } }] }, timestamp: daysAgo(2) },
  ]);
  await put(join(project, 'one/subagents/agent-a1.jsonl'), [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'notes' } }, { type: 'tool_use', name: 'mcp__plugin_tracker_issues__list', input: {} }] }, timestamp: daysAgo(1) },
  ]);
  await put(join(project, 'two.jsonl'), [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Task', input: { subagent_type: 'reviewer' } }] }, timestamp: daysAgo(5) }]);
  const reading = await readUsage({ home }, NOW);
  assert.deepEqual(usedIn(reading, 'claude-cli'), {
    'skill:standup': [1, daysAgo(3)], 'skill:notes': [1, daysAgo(1)], 'agent:reviewer': [2, daysAgo(2)],
    'mcp:ask-lou': [1, daysAgo(2)], 'mcp:plugin_tracker_issues': [1, daysAgo(1)],
  });
  assert.equal(historyOf(reading, 'claude-cli').sessions, 2);
});

test('Codex: an MCP call done, a SKILL.md read (parsed, or named in any command form), an agent spawned and a typed <skill> are uses; world_state is not', async () => {
  const home = await newHome();
  await put(join(home, '.codex/sessions/2026/11/14/rollout-a.jsonl'), [
    { type: 'session_meta', payload: { id: 'a' }, timestamp: daysAgo(2) },
    { type: 'world_state', skills: [{ name: 'listed-only', path: '/h/.codex/skills/listed-only/SKILL.md' }], timestamp: daysAgo(2) },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'McpToolCall', server: 'github', tool: 'search' } }, timestamp: daysAgo(2) },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', cwd: '/h/.agents/skills/notes', parsed_cmd: [
      { type: 'read', name: 'SKILL.md', path: '/h/.codex/skills/release/SKILL.md' }, { type: 'read', name: 'SKILL.md', path: 'SKILL.md' }, { type: 'read', name: 'x.md', path: '/h/x.md' }] } }, timestamp: daysAgo(2) },
    { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', arguments: '{"agent_type":"reviewer"}' }, timestamp: daysAgo(2) },
    // The same read through Codex's other command forms, which its parser leaves unparsed: named in the command's own text.
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: "const text = await read('/h/.codex/skills/digest/SKILL.md');" }, timestamp: daysAgo(3) },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"sed -n 1,40p /h/.agents/skills/triage/SKILL.md"}' }, timestamp: daysAgo(3) },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: 'nl -ba /h/s/lint/SKILL.md | head', parsed_cmd: [{ type: 'unknown', cmd: 'nl' }] } }, timestamp: daysAgo(3) },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<skill>\n<name>standup</name>\n<path>/h/s/SKILL.md</path>\n</skill>' }] }, timestamp: daysAgo(2) },
  ]);
  await put(join(home, '.codex/archived_sessions/rollout-b.jsonl'), [
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'McpToolCall', server: 'github' } }, timestamp: daysAgo(12) },
  ]);
  const reading = await readUsage({ home }, NOW);
  assert.deepEqual(usedIn(reading, 'codex-cli'), {
    'mcp:github': [2, daysAgo(2)], 'skill:release': [1, daysAgo(2)], 'skill:notes': [1, daysAgo(2)], 'agent:reviewer': [1, daysAgo(2)], 'skill:standup': [1, daysAgo(2)],
    'skill:digest': [1, daysAgo(3)], 'skill:triage': [1, daysAgo(3)], 'skill:lint': [1, daysAgo(3)],
  });
  assert.equal(historyOf(reading, 'codex-cli').from, daysAgo(12), 'its history starts at its oldest session');
});

test('Copilot CLI: skill.invoked and a tool call naming its MCP server are uses; the session\'s list of skills is not', async () => {
  const home = await newHome();
  await put(join(home, '.copilot/session-state/s1/events.jsonl'), [
    { type: 'session.start', data: { skills: [{ name: 'listed-only' }] }, timestamp: daysAgo(4) },
    { type: 'mcp.server_status', data: { mcpServerName: 'listed-server', status: 'connected' }, timestamp: daysAgo(4) },
    { type: 'skill.invoked', data: { name: 'triage', pluginName: 'tracker', trigger: 'agent-invoked' }, timestamp: daysAgo(4) },
    { type: 'tool.execution_start', data: { toolName: 'github-search', mcpServerName: 'github' }, timestamp: daysAgo(4) },
  ]);
  assert.deepEqual(usedIn(await readUsage({ home }, NOW), 'copilot-cli'), { 'skill:triage': [1, daysAgo(4)], 'mcp:github': [1, daysAgo(4)] });
});

test('Pi: a read of SKILL.md, an mcp__ call and a typed /skill: are uses; the system message\'s skills are not', async () => {
  const home = await newHome();
  await put(join(home, '.pi/agent/sessions/--work-app--/2026-11-10_a.jsonl'), [
    { type: 'session', cwd: '/work/app', timestamp: daysAgo(6) },
    { type: 'message', message: { role: 'system', content: '<available_skills><skill name="listed-only"></skill></available_skills>' }, timestamp: daysAgo(6) },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '<skill name="standup" location="/h/.pi/agent/skills/standup/SKILL.md">' }] }, timestamp: daysAgo(6) },
    { type: 'message', message: { role: 'assistant', content: [
      { type: 'toolCall', name: 'read', arguments: { path: '/h/.pi/agent/skills/notes/SKILL.md' } },
      { type: 'toolCall', name: 'mcp__ask_lou__ask', arguments: {} },
      { type: 'toolCall', name: 'bash', arguments: { command: 'cat SKILL.md' } }] }, timestamp: daysAgo(6) },
  ]);
  assert.deepEqual(usedIn(await readUsage({ home }, NOW), 'pi-cli'), { 'skill:standup': [1, daysAgo(6)], 'skill:notes': [1, daysAgo(6)], 'mcp:ask_lou': [1, daysAgo(6)] });
});

test('OpenCode: its database, read from a copy: a skill part, a task part and a session\'s own agent are uses; a text part is not', async () => {
  const home = await newHome(), folder = join(home, '.local/share/opencode');
  await mkdir(folder, { recursive: true });
  const db = new DatabaseSync(join(folder, 'opencode.db'));
  db.exec('CREATE TABLE session (id text PRIMARY KEY, agent text, time_created integer NOT NULL); CREATE TABLE part (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, data text NOT NULL)');
  db.prepare('INSERT INTO session VALUES (?, ?, ?)').run('s1', 'planner', NOW - 8 * DAY);
  const part = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)');
  part.run('p1', 's1', NOW - 8 * DAY, JSON.stringify({ type: 'tool', tool: 'skill', state: { input: { name: 'notes' } } }));
  part.run('p2', 's1', NOW - 8 * DAY, JSON.stringify({ type: 'tool', tool: 'task', state: { input: { subagent_type: 'reviewer' } } }));
  part.run('p3', 's1', NOW - 8 * DAY, JSON.stringify({ type: 'text', text: 'the "tool":"skill" named listed-only' }));
  db.exec('PRAGMA journal_mode=WAL');
  db.close();
  const before = await readdir(folder);
  assert.deepEqual(usedIn(await readUsage({ home }, NOW), 'opencode-cli'), { 'agent:planner': [1, daysAgo(8)], 'skill:notes': [1, daysAgo(8)], 'agent:reviewer': [1, daysAgo(8)] });
  assert.deepEqual(await readdir(folder), before, 'nothing is left beside OpenCode\'s database');
});

// ---------- The window, the reach and what can't be read ----------

test('The 30 days at their edge: a use exactly 30 days before the reading counts; one a minute older is only the last use', async () => {
  const home = await newHome(), at = (days: number, minutes = 0) => new Date(NOW - days * DAY - minutes * 60_000).toISOString();
  const call = (name: string, timestamp: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] }, timestamp });
  await put(join(home, '.claude/projects/p/edge.jsonl'), [call('edge', at(USAGE_DAYS))]);
  await put(join(home, '.claude/projects/p/past.jsonl'), [call('past', at(USAGE_DAYS, 1))]);
  assert.deepEqual(usedIn(await readUsage({ home }, NOW), 'claude-cli'), { 'skill:edge': [1, at(USAGE_DAYS)], 'skill:past': [0, at(USAGE_DAYS, 1)] });
});

test('Claude Code\'s history is whole for its cleanup period (30 days, or its settings\' cleanupPeriodDays), and no further back than its oldest session', async () => {
  const call = (days: number) => [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'notes' } }] }, timestamp: daysAgo(days) }];
  const fromWith = async (days: number, settings?: object) => {
    const home = await newHome();
    await put(join(home, '.claude/projects/p/s.jsonl'), call(days));
    if (settings) await writeFile(join(home, '.claude/settings.json'), JSON.stringify(settings));
    return historyOf(await readUsage({ home }, NOW), 'claude-cli').from;
  };
  assert.deepEqual([await fromWith(40), await fromWith(50, { cleanupPeriodDays: 60 }), await fromWith(3)], [daysAgo(30), daysAgo(50), daysAgo(3)]);
});

test('An agent in Pi, kept there as a loose skill file: /skill:<name> typed and <name>.md read are uses of the agent', async () => {
  const home = await newHome();
  await put(join(home, '.pi/agent/sessions/--work-app--/2026-11-14_a.jsonl'), [
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '<skill name="helper" location="/h/.pi/agent/skills/helper.md">' }] }, timestamp: daysAgo(2) },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: { path: '/h/.pi/agent/skills/helper.md' } }] }, timestamp: daysAgo(1) },
  ]);
  const says = toolSays(await readUsage({ home }, NOW), 'agent', facts('helper', { 'pi-cli': copy('helper.md') }), 'pi-cli')!;
  assert.deepEqual([says.sessions, says.last, says.cantSay], [1, daysAgo(1), undefined]);
});

test('A session file that can\'t be read is skipped and counted as such; the rest are read, and one gone since the listing is simply skipped', { skip: process.getuid?.() === 0 }, async () => {
  const home = await newHome(), project = join(home, '.claude/projects/-work');
  const call = (name: string) => [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] }, timestamp: daysAgo(2) }];
  await put(join(project, 'ok.jsonl'), call('alpha'));
  await put(join(project, 'locked.jsonl'), call('beta'));
  await chmod(join(project, 'locked.jsonl'), 0o000);
  await symlink(join(project, 'nowhere.jsonl'), join(project, 'gone.jsonl'));
  const reading = await readUsage({ home }, NOW), history = historyOf(reading, 'claude-cli');
  await chmod(join(project, 'locked.jsonl'), 0o644);
  const says = toolSays(reading, 'skill', facts('gamma', {}), 'claude-cli')!;
  assert.deepEqual([history.sessions, history.skipped, history.unread, Object.keys(usedIn(reading, 'claude-cli')), says.cantSay, says.skipped],
    [1, 1, undefined, ['skill:alpha'], 'unread', 1]);
});

test('A record dated after the reading (a wrong clock) is dated by its file\'s time instead', async () => {
  const home = await newHome(), file = join(home, '.claude/projects/-work/later.jsonl');
  await put(file, [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'later' } }] }, timestamp: daysAgo(-400) }]);
  await utimes(file, new Date(NOW - 3 * DAY), new Date(NOW - 3 * DAY));
  assert.deepEqual(usedIn(await readUsage({ home }, NOW), 'claude-cli'), { 'skill:later': [1, daysAgo(3)] });
});

test('A tool\'s sessions in the 30 days: those that started within them, out of all it keeps, by each session\'s first record', async () => {
  const home = await newHome(), started = (days: number) => [{ type: 'user', message: { content: 'hello' }, timestamp: daysAgo(days) }, { type: 'user', message: { content: 'later' }, timestamp: daysAgo(1) }];
  for (const [name, days] of [['a', 2], ['b', USAGE_DAYS], ['c', USAGE_DAYS + 1]] as const) await put(join(home, `.claude/projects/p/${name}.jsonl`), started(days));
  const claude = historyOf(await readUsage({ home }, NOW), 'claude-cli');
  assert.deepEqual([claude.sessions, claude.recent], [3, 2]);
});

test('A home with no session folder: every tool keeps no sessions, has no start and used nothing', async () => {
  const reading = await readUsage({ home: await newHome() }, NOW);
  assert.deepEqual(reading.tools.map(each => [each.tool, each.sessions, each.recent, each.from, each.used, each.unread]), reading.tools.map(each => [each.tool, 0, 0, undefined, [], undefined]));
});

test('A tool whose sessions can\'t be read says so (unread), and the other tools are read as usual', async () => {
  const home = await newHome();
  await mkdir(join(home, '.local/share/opencode'), { recursive: true });
  await writeFile(join(home, '.local/share/opencode/opencode.db'), 'not a database');
  await put(join(home, '.copilot/session-state/s1/events.jsonl'), [{ type: 'skill.invoked', data: { name: 'notes' }, timestamp: daysAgo(1) }]);
  const reading = await readUsage({ home }, NOW);
  assert.deepEqual([historyOf(reading, 'opencode-cli').unread, usedIn(reading, 'copilot-cli')], [true, { 'skill:notes': [1, daysAgo(1)] }]);
});

test('Each tool\'s folder follows its own variable: a moved Codex folder is read, the default one is not', async () => {
  const home = await newHome(), moved = join(home, 'elsewhere/codex');
  const mcp = (server: string) => ({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'McpToolCall', server } }, timestamp: daysAgo(1) });
  await put(join(moved, 'sessions/2026/11/15/rollout-a.jsonl'), [mcp('moved')]);
  await put(join(home, '.codex/sessions/2026/11/15/rollout-b.jsonl'), [mcp('default')]);
  assert.deepEqual(usedIn(await readUsage({ home, overrides: { 'codex-cli': moved } }, NOW), 'codex-cli'), { 'mcp:moved': [1, daysAgo(1)] });
});

// ---------- What a reading says of a row (usagerow.ts) ----------

const copy = (folder: string, name = folder): ToolCopy => ({ hash: 'h', directory: `/h/${folder}`, rootLabel: '', lines: 1, modified: daysAgo(40), summary: '', writable: true, folder, name });
const facts = (key: string, copies: Partial<Record<HarnessId, ToolCopy>>, more: Partial<LibraryFacts> = {}): LibraryFacts =>
  ({ key, name: key, description: '', copies, on: true, except: [], cannot: {}, edited: [], ...more });
/** A reading of every tool, made by hand: `used` per tool, as `kind:name` with the session numbers that used it, and when each history starts. */
function readingOf(used: Partial<Record<HarnessId, Record<string, number[]>>>, from: Partial<Record<HarnessId, string>> = {}): UsageReading {
  return { at: daysAgo(0), tools: (Object.keys(readers) as HarnessId[]).map(tool => ({ tool, tells: readers[tool].tells, sessions: 10, recent: 4, from: from[tool] ?? daysAgo(90),
    used: Object.entries(used[tool] ?? {}).map(([id, sessions]) => ({ kind: id.split(':')[0] as 'skill', name: id.slice(id.indexOf(':') + 1), sessions, last: daysAgo(sessions.length ? 2 : 45) })) })) };
}
const sessionsIn = (reading: UsageReading, kind: 'skill' | 'agent' | 'mcp', row: LibraryFacts, tool: HarnessId) => toolSays(reading, kind, row, tool)!.sessions;

test('Each tool\'s spelling: Claude Code\'s plugin:skill and plugin_<plugin>_<server>, its rewritten server names, and Pi\'s', () => {
  const triage = facts('triage', {}, { plugin: { 'claude-cli': { plugin: 'tracker', marketplace: 'm' }, 'copilot-cli': { plugin: 'tracker', marketplace: 'm' } } });
  const issues = facts('issues', {}, { plugin: { 'claude-cli': { plugin: 'tracker', marketplace: 'm' } } });
  const askLou = facts('ask.lou', { 'claude-cli': copy('ask.lou'), 'pi-cli': copy('ask.lou') });
  const reading = readingOf({ 'claude-cli': { 'skill:tracker:triage': [1], 'mcp:plugin_tracker_issues': [2], 'mcp:ask_lou': [3] }, 'copilot-cli': { 'skill:triage': [4] }, 'pi-cli': { 'mcp:ask_lou': [5], 'mcp:ask.lou': [6] } });
  assert.deepEqual([sessionsIn(reading, 'skill', triage, 'claude-cli'), sessionsIn(reading, 'mcp', issues, 'claude-cli'), sessionsIn(reading, 'mcp', askLou, 'claude-cli'),
    sessionsIn(reading, 'skill', triage, 'copilot-cli'), sessionsIn(reading, 'mcp', askLou, 'pi-cli')], [1, 1, 1, 1, 2]);
});

test('Across kinds only where a tool keeps one kind as another: a skill and an agent of one name, or a skill and a server, each used alone, count only for their own row', () => {
  const sessionsOf = (used: Record<string, number[]>, kind: 'skill' | 'agent' | 'mcp', name: string) => toolSays(readingOf({ 'claude-cli': used }), kind, facts(name, { 'claude-cli': copy(name) }), 'claude-cli')!.sessions;
  assert.deepEqual([sessionsOf({ 'skill:reviewer': [1] }, 'agent', 'reviewer'), sessionsOf({ 'agent:reviewer': [1] }, 'skill', 'reviewer'), sessionsOf({ 'mcp:github': [1] }, 'skill', 'github'), sessionsOf({ 'skill:github': [1] }, 'mcp', 'github')],
    [0, 0, 0, 0]);
});

test('A use of another copy of the same name counts, in any case; two spellings in one session count it once', () => {
  const notes = facts('notes', { 'codex-cli': copy('notes-folder', 'Notes') });
  const reading = readingOf({ 'codex-cli': { 'skill:notes-folder': [1, 2], 'skill:NOTES': [2, 3] } });
  assert.equal(sessionsIn(reading, 'skill', notes, 'codex-cli'), 3);
});

test('Can\'t say, by kind, as the readers\' table has it: no record (an agent in Copilot CLI, a server in OpenCode) or not sure (an agent or a skill in Codex, a server in Copilot CLI), whose hits still count', () => {
  const says = (kind: 'skill' | 'agent' | 'mcp', tool: HarnessId, used = {}) => { const got = toolSays(readingOf({ [tool]: used }), kind, facts('reviewer', {}), tool)!; return [got.cantSay, got.sessions]; };
  assert.deepEqual([says('agent', 'copilot-cli'), says('mcp', 'opencode-cli'), says('agent', 'codex-cli'), says('agent', 'codex-cli', { 'agent:reviewer': [1] }), says('skill', 'codex-cli'), says('mcp', 'copilot-cli'), says('agent', 'claude-cli'), says('agent', 'pi-cli')],
    [['no-record', 0], ['no-record', 0], ['not-sure', 0], ['not-sure', 1], ['not-sure', 0], ['not-sure', 0], [undefined, 0], [undefined, 0]]);
});

test('Can\'t say, by reach: a tool with no session can\'t; one whose history starts 12 days ago can, as far back as it goes', () => {
  const reading = readingOf({}, { 'pi-cli': daysAgo(12) });
  reading.tools.find(each => each.tool === 'claude-cli')!.sessions = 0;
  const notes = facts('notes', { 'pi-cli': copy('notes'), 'claude-cli': copy('notes') });
  assert.deepEqual([toolSays(reading, 'skill', notes, 'pi-cli'), toolSays(reading, 'skill', notes, 'claude-cli')],
    [{ tool: 'pi-cli', sessions: 0, since: daysAgo(12) }, { tool: 'claude-cli', sessions: 0, cantSay: 'no-sessions' }]);
});

test('A row\'s figure: used, with its newest use and its sessions; no use seen, when a tool that has it on can tell; nothing when none can', () => {
  const figure = (row: LibraryFacts, used: Partial<Record<HarnessId, Record<string, number[]>>>, tools: HarnessId[]) =>
    rowFigure(tools.flatMap(tool => toolSays(readingOf(used), 'agent', row, tool) ?? []), onIn(row, tools));
  const inClaude = facts('reviewer', { 'claude-cli': copy('reviewer') }), inCopilot = facts('reviewer', { 'copilot-cli': copy('reviewer') });
  const switchedOff = facts('reviewer', { 'claude-cli': copy('reviewer') }, { switchedOff: ['claude-cli'] });
  assert.deepEqual([
    figure(inClaude, { 'codex-cli': { 'agent:reviewer': [1] } }, ['claude-cli', 'codex-cli']),
    figure(inClaude, {}, ['claude-cli', 'codex-cli']),
    figure(inClaude, { 'claude-cli': { 'agent:reviewer': [] } }, ['claude-cli']),
    figure(inCopilot, {}, ['claude-cli', 'copilot-cli']),
    figure(switchedOff, {}, ['claude-cli']),
  ], [{ used: daysAgo(2), sessions: 1 }, { noneSeen: true }, { noneSeen: true }, undefined, undefined]);
});

test('A skill used in 3 sessions in two tools: the row says 3 sessions, each tool its own count; a use older than 30 days adds no session', () => {
  const notes = facts('notes', { 'claude-cli': copy('notes'), 'codex-cli': copy('notes') });
  const reading = readingOf({ 'claude-cli': { 'skill:notes': [1, 2] }, 'codex-cli': { 'skill:notes': [7] }, 'pi-cli': { 'skill:notes': [] } });
  const says = reading.tools.flatMap(each => toolSays(reading, 'skill', notes, each.tool) ?? []);
  assert.deepEqual([rowFigure(says, onIn(notes, ['claude-cli', 'codex-cli'])), says.filter(each => each.sessions).map(each => [each.tool, each.sessions])],
    [{ used: daysAgo(2), sessions: 3 }, [['claude-cli', 2], ['codex-cli', 1]]]);
});

// ---------- "No use seen in 30 days" (usagerow.ts noUseSeen): a row for each line of the rule ----------

/** An item in the library, On or Off, whose oldest version is `days` old. */
const kept = (key: string, days: number, more: Partial<LibraryItem> = {}): LibraryItem =>
  ({ ...newItem(key, key), on: true, hash: 'h', versions: [{ hash: 'h', at: daysAgo(days), from: { how: 'found', harness: 'claude-cli' } }], ...more });
/** Where an agent kept `days` old stands for the filter, with these uses and tools that have it on, in a reading made now. */
function standing(item: LibraryItem, row: LibraryFacts, tools: HarnessId[], used: Partial<Record<HarnessId, Record<string, number[]>>> = {}, from: Partial<Record<HarnessId, string>> = {}) {
  const reading = readingOf(used, from);
  return noUseSeen(item, rowFigure(tools.flatMap(tool => toolSays(reading, 'agent', row, tool) ?? []), onIn(row, tools)), reading.at);
}
const inClaude = facts('reviewer', { 'claude-cli': copy('reviewer') });

test('In: On, no use seen in 30 days, Claude Code (which can tell) has it on, and its oldest version is 40 days old', () => {
  assert.equal(standing(kept('reviewer', 40), inClaude, ['claude-cli', 'copilot-cli']), 'in');
});

test('A history shorter than 30 days counts as far back as it goes: Pi since 12 days ago, no use there, is in, and the row says since when', () => {
  const row = facts('notes', { 'pi-cli': copy('notes') }), reading = readingOf({}, { 'pi-cli': daysAgo(12) });
  const figure = rowFigure([toolSays(reading, 'skill', row, 'pi-cli')!], onIn(row, ['pi-cli']));
  assert.deepEqual([figure, noUseSeen(kept('notes', 40), figure, reading.at)], [{ noneSeen: true, since: daysAgo(12) }, 'in']);
});

test('No tool that has it on can tell (Copilot CLI has no record of an agent, Codex\'s may not show one): can\'t say, never in', () => {
  assert.equal(standing(kept('reviewer', 40), facts('reviewer', { 'copilot-cli': copy('reviewer'), 'codex-cli': copy('reviewer') }), ['claude-cli', 'copilot-cli', 'codex-cli']), undefined);
});

test('A use seen anywhere keeps it out, even one only a reader that may miss uses saw (an agent in Codex)', () => {
  assert.equal(standing(kept('reviewer', 40), inClaude, ['claude-cli', 'codex-cli'], { 'codex-cli': { 'agent:reviewer': [1] } }), undefined);
});

test('Its oldest version at least 30 days old: 30 days exactly is in; a minute younger is new, left out and counted', () => {
  const minuteYounger = kept('reviewer', 30, { versions: [{ hash: 'h', at: new Date(NOW - USAGE_DAYS * DAY + 60_000).toISOString(), from: { how: 'found', harness: 'claude-cli' } }] });
  assert.deepEqual([standing(kept('reviewer', 30), inClaude, ['claude-cli']), standing(minuteYounger, inClaude, ['claude-cli'])], ['in', 'new']);
});

test('Off, deleted or only found: never in', () => {
  assert.deepEqual([standing(kept('reviewer', 40, { on: false }), inClaude, ['claude-cli']), standing(kept('reviewer', 40, { deleted: { at: daysAgo(1) } }), inClaude, ['claude-cli']),
    standing(undefined as unknown as LibraryItem, inClaude, ['claude-cli'])], [undefined, undefined, undefined]);
});

test('Turn these off leaves to its own row a plugin\'s item and one linked to a plugin, not one from a Git link', () => {
  assert.deepEqual([leftToItsRow(facts('triage', {}, { plugin: { 'claude-cli': { plugin: 'tracker', marketplace: 'm' } } })), leftToItsRow(facts('triage', {}, { fromSource: { link: 'plugin:tracker@m' } })),
    leftToItsRow(facts('notes', {}, { fromSource: { link: 'https://github.com/o/r' } })), leftToItsRow(inClaude)], [true, true, false, false]);
});

// ---------- A reading in sum (usagerow.ts toolHistories, usageSummary): what the Overview and the chip's count read ----------

/** A home's view as the summary reads it: one kind's items and its tools, the others empty, the plugins installed, and which tools are managed and installed. */
function homeOf(skills: { facts: LibraryFacts[]; library: Record<string, LibraryItem> }, managed: HarnessId[], present = managed, pluginItems: InstalledPlugin[] = []) {
  const none = { tools: managed, items: [], library: {} };
  return { skills: { tools: managed, items: skills.facts, library: skills.library }, mcp: none, agents: none, sync: { managed, present }, pluginItems } as unknown as HomeView;
}

test('Each tool\'s history: its sessions in the 30 days, and how far back it goes (30 days or more, from its first session, none or unread), for every managed tool, another installed one with sessions, and one not installed only with a use in 30 days', () => {
  const reading = readingOf({ 'opencode-cli': { 'skill:notes': [1] } }, { 'claude-cli': daysAgo(90), 'pi-cli': daysAgo(12) });
  const tool = (id: HarnessId) => reading.tools.find(each => each.tool === id)!;
  Object.assign(tool('codex-cli'), { sessions: 0, recent: 0 });
  Object.assign(tool('copilot-cli'), { sessions: 0, recent: 0, unread: true });
  tool('pi-cli').recent = 3;
  // Claude Code, Codex and Copilot CLI managed; Pi installed with sessions; OpenCode not installed, with a use in 30 days.
  assert.deepEqual(toolHistories(reading, homeOf({ facts: [], library: {} }, ['claude-cli', 'codex-cli', 'copilot-cli'], ['claude-cli', 'codex-cli', 'copilot-cli', 'pi-cli'])), [
    { tool: 'claude-cli', recent: 4, goes: 'whole' }, { tool: 'codex-cli', recent: 0, goes: 'none' }, { tool: 'copilot-cli', recent: 0, goes: 'unread' },
    { tool: 'pi-cli', recent: 3, goes: 'from', from: daysAgo(12) }, { tool: 'opencode-cli', recent: 4, goes: 'whole' }]);
  // Not installed and no use in 30 days: a leftover folder, not named.
  assert.deepEqual(toolHistories(readingOf({}), homeOf({ facts: [], library: {} }, ['claude-cli'])).map(each => each.tool), ['claude-cli']);
});

test('A reading in sum: the rows used, as the page lists them (Off, found and a plugin\'s own too), its three most used; of the On items not used, no use seen, too new for the chip, can\'t say', () => {
  const inClaude = (key: string) => facts(key, { 'claude-cli': copy(key) }), inCopilot = (key: string) => facts(key, { 'copilot-cli': copy(key) });
  const rows = [inClaude('used'), inClaude('idle'), inClaude('young'), inCopilot('mute'), inClaude('off'), inClaude('gone'), inClaude('found'), inClaude('daily')];
  const library = { used: kept('used', 40), idle: kept('idle', 40), young: kept('young', 5), mute: kept('mute', 40), off: kept('off', 40, { on: false }), gone: kept('gone', 40, { deleted: { at: daysAgo(1) } }), daily: kept('daily', 40) };
  // A plugin's skill in Claude Code, a row of its own on the page; Claude Code calls it tracker:triage.
  const tracker: InstalledPlugin = { tool: 'claude-cli', plugin: 'tracker', marketName: 'm', listed: true, items: [{ kind: 'skill', name: 'triage', description: '' }] };
  const reading = readingOf({ 'claude-cli': { 'skill:used': [1, 2], 'skill:off': [3], 'skill:found': [4], 'skill:daily': [5, 6, 7, 8], 'skill:tracker:triage': [9, 10, 11] } });
  // Copilot CLI records every skill it runs but keeps no sessions here, so it can't say for mute.
  reading.tools.find(each => each.tool === 'copilot-cli')!.sessions = 0;
  const sum = usageSummary(reading, homeOf({ facts: rows, library }, ['claude-cli', 'copilot-cli'], ['claude-cli', 'copilot-cli'], [tracker]));
  assert.deepEqual(sum.kinds.skills, {
    used: ['used', 'off', 'found', 'daily', 'tracker@m/triage'],
    mostUsed: [{ key: 'daily', name: 'daily', sessions: 4 }, { key: 'tracker@m/triage', name: 'triage', sessions: 3 }, { key: 'used', name: 'used', sessions: 2 }],
    noUseSeen: ['idle'], tooNew: ['young'], cantSay: ['mute'] });
  assert.deepEqual([sum.kinds.mcp, sum.tools.map(each => [each.tool, each.goes])], [{ used: [], mostUsed: [], noUseSeen: [], tooNew: [], cantSay: [] }, [['claude-cli', 'whole'], ['copilot-cli', 'none']]]);
});
