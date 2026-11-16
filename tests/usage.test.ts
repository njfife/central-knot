// Usage read from the tools' session history (src/usage.ts, in main) and what it says of a row (src/usagerow.ts, the page's),
// as worked examples. Every session file here is made up by the test, in each tool's own record shapes: a use is a call (or a
// skill the person typed), and the lists of what was available that every session holds are written in too, to be ignored.
// The reading is made at noon on 16 November 2026; "N days ago" counts back from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readUsage } from '../src/usage.ts';
import { leftToItsRow, noUseSeen, onIn, rowFigure, toolSays, USAGE_DAYS } from '../src/usagerow.ts';
import { newItem, type LibraryItem } from '../src/library.ts';
import type { HarnessId, LibraryFacts, ToolCopy, UsageReading } from '../src/types.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

const newHome = async () => realpath(await mkdtemp(join(tmpdir(), 'ck-usage-')));
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

test('Codex: an MCP call done, a SKILL.md read, an agent spawned and a typed <skill> are uses; world_state is not', async () => {
  const home = await newHome();
  await put(join(home, '.codex/sessions/2026/11/14/rollout-a.jsonl'), [
    { type: 'session_meta', payload: { id: 'a' }, timestamp: daysAgo(2) },
    { type: 'world_state', skills: [{ name: 'listed-only', path: '/h/.codex/skills/listed-only/SKILL.md' }], timestamp: daysAgo(2) },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'McpToolCall', server: 'github', tool: 'search' } }, timestamp: daysAgo(2) },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', cwd: '/h/.agents/skills/notes', parsed_cmd: [
      { type: 'read', name: 'SKILL.md', path: '/h/.codex/skills/release/SKILL.md' }, { type: 'read', name: 'SKILL.md', path: 'SKILL.md' }, { type: 'read', name: 'x.md', path: '/h/x.md' }] } }, timestamp: daysAgo(2) },
    { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', arguments: '{"agent_type":"reviewer"}' }, timestamp: daysAgo(2) },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<skill>\n<name>standup</name>\n<path>/h/s/SKILL.md</path>\n</skill>' }] }, timestamp: daysAgo(2) },
  ]);
  await put(join(home, '.codex/archived_sessions/rollout-b.jsonl'), [
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'McpToolCall', server: 'github' } }, timestamp: daysAgo(12) },
  ]);
  const reading = await readUsage({ home }, NOW);
  assert.deepEqual(usedIn(reading, 'codex-cli'), {
    'mcp:github': [2, daysAgo(2)], 'skill:release': [1, daysAgo(2)], 'skill:notes': [1, daysAgo(2)], 'agent:reviewer': [1, daysAgo(2)], 'skill:standup': [1, daysAgo(2)],
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

test('A home with no session folder: every tool keeps no sessions, has no start and used nothing', async () => {
  const reading = await readUsage({ home: await newHome() }, NOW);
  assert.deepEqual(reading.tools.map(each => [each.tool, each.sessions, each.from, each.used, each.unread]), reading.tools.map(each => [each.tool, 0, undefined, [], undefined]));
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
  const tells = { 'claude-cli': { skill: 'sure', agent: 'sure', mcp: 'sure' }, 'codex-cli': { skill: 'sure', agent: 'seen', mcp: 'sure' }, 'copilot-cli': { skill: 'sure', mcp: 'seen' }, 'pi-cli': { skill: 'sure', mcp: 'sure' }, 'opencode-cli': { skill: 'sure', agent: 'sure' } } as const;
  return { at: daysAgo(0), tookMs: 5, tools: (Object.keys(tells) as HarnessId[]).map(tool => ({ tool, tells: tells[tool], sessions: 10, from: from[tool] ?? daysAgo(90),
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

test('A use of another copy of the same name counts, in any case; two spellings in one session count it once', () => {
  const notes = facts('notes', { 'codex-cli': copy('notes-folder', 'Notes') });
  const reading = readingOf({ 'codex-cli': { 'skill:notes-folder': [1, 2], 'skill:NOTES': [2, 3] } });
  assert.equal(sessionsIn(reading, 'skill', notes, 'codex-cli'), 3);
});

test('Can\'t say, by kind: no record (an agent in Copilot CLI or Pi, a server in OpenCode) or not sure (an agent in Codex, a server in Copilot CLI), whose hits still count', () => {
  const says = (kind: 'agent' | 'mcp', tool: HarnessId, used = {}) => { const got = toolSays(readingOf({ [tool]: used }), kind, facts('reviewer', {}), tool)!; return [got.cantSay, got.sessions]; };
  assert.deepEqual([says('agent', 'copilot-cli'), says('agent', 'pi-cli'), says('mcp', 'opencode-cli'), says('agent', 'codex-cli'), says('agent', 'codex-cli', { 'agent:reviewer': [1] }), says('mcp', 'copilot-cli'), says('agent', 'claude-cli')],
    [['no-record', 0], ['no-record', 0], ['no-record', 0], ['not-sure', 0], ['not-sure', 1], ['not-sure', 0], [undefined, 0]]);
});

test('Can\'t say, by reach: a tool with no session can\'t; one whose history starts 12 days ago can, as far back as it goes', () => {
  const reading = readingOf({}, { 'codex-cli': daysAgo(12) });
  reading.tools.find(each => each.tool === 'pi-cli')!.sessions = 0;
  const notes = facts('notes', { 'codex-cli': copy('notes'), 'pi-cli': copy('notes') });
  assert.deepEqual([toolSays(reading, 'skill', notes, 'codex-cli'), toolSays(reading, 'skill', notes, 'pi-cli')],
    [{ tool: 'codex-cli', sessions: 0, since: daysAgo(12) }, { tool: 'pi-cli', sessions: 0, cantSay: 'no-sessions' }]);
});

test('A row\'s figure: used, with its newest use; no use seen, when a tool that has it on can tell; nothing when none can', () => {
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
  ], [{ used: daysAgo(2) }, { noneSeen: true }, { noneSeen: true }, undefined, undefined]);
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

test('A history shorter than 30 days counts as far back as it goes: Codex since 12 days ago, no use there, is in', () => {
  const row = facts('notes', { 'codex-cli': copy('notes') }), reading = readingOf({}, { 'codex-cli': daysAgo(12) });
  assert.equal(noUseSeen(kept('notes', 40), rowFigure([toolSays(reading, 'skill', row, 'codex-cli')!], onIn(row, ['codex-cli'])), reading.at), 'in');
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
