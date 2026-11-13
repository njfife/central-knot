// Synchronize everything, the home's standing rule (library.ts FOUND; librarypass.ts takeInByRule), as worked examples on real
// files in a temp home with skills, agents and MCP servers in Claude Code, Copilot CLI and Codex. Each background pass here is
// main.ts's (`background`, every kind in turn), which is the only pass the rule runs in. In order: off, and switched on; what it
// never brings back; copies that are not whole or not the person's; what it never fights or repeats; Automatic sync off; a
// profile in use; and the agent row that offered an Add that did nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentsView, applyAgents } from '../src/agents.ts';
import { readHistory } from '../src/history.ts';
import { libraryAction, librarySentence } from '../src/historyactions.ts';
import { libraryWords, rowClicks, sentences, statusLine } from '../src/libraryrow.ts';
import { inUse, liveItems } from '../src/profileplan.ts';
import { readLibraries, readProfiles, saveProfile, switchProfile } from '../src/profiles.ts';
import { applyServers, serversView } from '../src/servers.ts';
import { partsRecordPath, readRecord, readTree, saveRecord, setSyncEverything, syncGate, type ShareContext } from '../src/share.ts';
import { applySkills, restoreSkill, skillKind, skillsView, takeOver } from '../src/skills.ts';
import { convertAgentToSkill } from '../src/agentskill.ts';
import { setDisabled } from '../src/skillswitch.ts';
import type { Change, HarnessId, LibraryFacts, LibraryView, PassResult } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const skillRoot = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills' } as Record<HarnessId, string>;
const agentFile = (tool: HarnessId, name: string) => ({ 'claude-cli': `.claude/agents/${name}.md`, 'copilot-cli': `.copilot/agents/${name}.agent.md`, 'codex-cli': `.codex/agents/${name}.toml` } as Record<HarnessId, string>)[tool];
const mcpFile = { 'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml' } as Record<HarnessId, string>;

async function sandbox(settleMs = 0) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-sync-everything-')));
  const home = join(base, 'home');
  for (const folder of [...Object.values(skillRoot), '.claude/agents', '.copilot/agents', '.codex/agents']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof sandbox>>;

const skill = (name: string, body = 'Take notes.') => `---\nname: ${name}\ndescription: ${name} things.\n---\n\n${body}\n`;
async function putSkill(box: Box, tool: HarnessId, name: string, body?: string) {
  await mkdir(join(box.home, skillRoot[tool], name), { recursive: true });
  await writeFile(join(box.home, skillRoot[tool], name, 'SKILL.md'), skill(name, body));
}
const skillIn = (box: Box, tool: HarnessId, name: string) => readFile(join(box.home, skillRoot[tool], name, 'SKILL.md'), 'utf8').catch(() => undefined);
const agent = (tool: HarnessId, name: string, prompt = 'You help.') => (tool === 'codex-cli'
  ? `name = "${name}"\ndescription = "Helps"\ndeveloper_instructions = """\n${prompt}\n"""\n` : `---\nname: ${name}\ndescription: Helps\n---\n\n${prompt}\n`);
const putAgent = (box: Box, tool: HarnessId, name: string, prompt?: string) => writeFile(join(box.home, agentFile(tool, name)), agent(tool, name, prompt));
/** Each tool's MCP settings file, its servers as given (Codex's as TOML tables). */
async function putServers(box: Box, tool: HarnessId, servers: Record<string, { command: string; args?: string[] }>) {
  const toml = Object.entries(servers).map(([name, server]) => `[mcp_servers.${name}]\ncommand = "${server.command}"\nargs = ${JSON.stringify(server.args ?? [])}\n`).join('\n');
  await writeFile(join(box.home, mcpFile[tool]), tool === 'codex-cli' ? toml : `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}
const serverNames = async (box: Box, tool: HarnessId) => {
  const text = await readFile(join(box.home, mcpFile[tool]), 'utf8').catch(() => '');
  return tool === 'codex-cli' ? [...text.matchAll(/^\[mcp_servers\.([^\].]+)\]$/gm)].map(match => match[1]) : Object.keys(JSON.parse(text || '{}').mcpServers ?? {});
};

/** main.ts's pass of the whole home, every kind in turn (the background pass, or Sync once). */
async function background(box: Box, options: { now?: number; settleMs?: number } = {}, managed = tools) {
  const whole = { background: true, ...options } as const;
  return { skills: await applySkills(box.context, managed, [], whole), mcp: await applyServers(box.context, managed, [], whole), agents: await applyAgents(box.context, managed, [], whole) };
}
const wrote = (passes: Record<string, PassResult>) => Object.values(passes).reduce((sum, done) => sum + done.writes, 0);
const noticesOf = (passes: Record<string, PassResult>) => Object.values(passes).flatMap(done => done.notices ?? []);
const views = async (box: Box) => ({ skills: await skillsView(box.context, tools), mcp: await serversView(box.context, tools), agents: await agentsView(box.context, tools) });
const rowOf = (view: LibraryView, key: string) => view.items.find(item => item.key === key);
const placeIn = (view: LibraryView, key: string) => { const item = view.library[key]; return !item || item.deleted ? 'found' : item.on ? 'on' : 'off'; };
/** A row's click as the page sends it (libraryrow.ts rowClicks), from the row as the view gives it. */
const pageRow = (fact: LibraryFacts) => ({ key: fact.key, name: fact.name, hashes: Object.fromEntries(Object.entries(fact.copies).map(([tool, copy]) => [tool, copy!.hash])), plan: fact.plan, takeInAnswers: fact.takeInAnswers });
const add = (view: LibraryView, key: string): Change => rowClicks.on(pageRow(rowOf(view, key)!), view.library[key]?.deleted ? view.library[key] : undefined);
const entriesOf = async (box: Box, key: string) => (await readHistory(box.context)).filter(event => event.key === key);
const turnOn = async (box: Box) => assert.deepEqual(await setSyncEverything(box.context, true), {});

// ---------- Off, and switched on ----------

test('Synchronize everything is off where it was never chosen: a found skill waits for Add whatever the background pass does', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await applySkills(box.context, tools, [add((await views(box)).skills, 'notes')], { only: new Set(['notes']) });
    await putSkill(box, 'claude-cli', 'tidy');
    for (let run = 0; run < 3; run++) assert.equal(wrote(await background(box)), 0);
    const view = (await views(box)).skills, rule = rowOf(view, 'tidy')?.takeInAnswers?.rule;
    assert.deepEqual([placeIn(view, 'tidy'), (await readRecord(box.home)).record?.syncEverything], ['found', undefined]);
    assert.ok(rule && 'take' in rule && rule.take.harness === 'claude-cli', 'what it would do, which Settings counts while it is off');
  } finally { await box.cleanup(); }
});

test('Switched on in a home with found items: each it may take is taken in and On everywhere, with an Add’s History entry naming the rule and where it was found, and one notice per pass', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await putSkill(box, 'claude-cli', 'tidy');
    // Copies that differ: left found, with the row's question.
    await putSkill(box, 'claude-cli', 'review', 'Review gently.');
    await putSkill(box, 'codex-cli', 'review', 'Review hard.');
    // Deleted from Central Knot earlier, its copy put back by hand in Codex since: left found, for good.
    await putSkill(box, 'claude-cli', 'old');
    await applySkills(box.context, tools, [add((await views(box)).skills, 'old')]);
    await applySkills(box.context, tools, [{ key: 'old', managed: true, off: [], seenManaged: true, deleted: true }]);
    await putSkill(box, 'codex-cli', 'old', 'Put back by hand.');
    await putAgent(box, 'copilot-cli', 'helper');
    // A server found only in Claude Code, and one found only in Codex.
    await putServers(box, 'claude-cli', { docs: { command: 'npx', args: ['-y', 'docs'] } });
    await putServers(box, 'codex-cli', { files: { command: 'files-mcp' } });
    const claudeBefore = await readFile(join(box.home, mcpFile['claude-cli']), 'utf8');
    const before = await views(box);
    assert.deepEqual([before.skills, before.mcp, before.agents].flatMap(view => view.items.filter(item => item.takeInAnswers && 'take' in item.takeInAnswers.rule).map(item => item.key)), ['notes', 'tidy', 'docs', 'files', 'helper'], 'what Settings counts while it is off');
    await turnOn(box);
    assert.equal((await readRecord(box.home)).record?.syncEverything, true);
    const done = await background(box);
    const after = await views(box);
    assert.deepEqual(['notes', 'review', 'old'].map(key => placeIn(after.skills, key)), ['on', 'found', 'found']);
    assert.deepEqual(await Promise.all(tools.map(tool => skillIn(box, tool, 'notes'))), [skill('notes'), skill('notes'), skill('notes')]);
    const old = rowOf(after.skills, 'old')!.takeInAnswers!;
    assert.deepEqual([rowOf(after.skills, 'review')?.takeInAnswers?.rule, 'take' in old.click, old.rule], [{ wait: 'choice' }, true, { leave: 'deleted' }]);
    assert.deepEqual(['helper'].map(key => placeIn(after.agents, key)), ['on']);
    assert.deepEqual([placeIn(after.mcp, 'docs'), placeIn(after.mcp, 'files')], ['on', 'on']);
    // docs: its other tools are written, Claude Code's copy counts as applied and its file is untouched.
    assert.deepEqual([await serverNames(box, 'copilot-cli'), await serverNames(box, 'codex-cli'), after.mcp.library.docs.applied['claude-cli'] !== undefined], [['docs', 'files'], ['files', 'docs'], true]);
    // files: Claude Code's part waits for Write to Claude Code, said on its row (one band for every row that waits).
    assert.deepEqual([rowOf(after.mcp, 'files')?.waits, rowOf(after.mcp, 'docs')?.waits], [['claude-cli'], undefined]);
    assert.equal(await readFile(join(box.home, mcpFile['claude-cli']), 'utf8'), claudeBefore);
    // History: each an Add's entry, by the rule, from where it was found; said so.
    const notes = (await entriesOf(box, 'notes')).at(-1)!;
    assert.deepEqual([notes.kind, notes.cause, notes.winner?.tool], ['on', 'sync-everything', 'claude-cli']);
    assert.equal(librarySentence(notes, libraryWords.skills, tools)?.text, 'Found in Claude Code and taken into Central Knot by Synchronize everything; put in Copilot CLI and Codex.');
    assert.equal(libraryAction(notes, after.skills.library.notes)?.label, 'Undo');
    // Its existing limits too: docs's Undo would give Claude Code's copy back to its MCP file, which waits for Write, so it is
    // not offered; files's is, since Claude Code had none.
    const docs = (await entriesOf(box, 'mcp:docs')).at(-1)!, files = (await entriesOf(box, 'mcp:files')).at(-1)!;
    assert.deepEqual([docs.cause, libraryAction(docs, after.mcp.library.docs), libraryAction(files, after.mcp.library.files)?.label], ['sync-everything', undefined, 'Undo']);
    // And it is said: the notice names the exception, and docs's entry says why it has no Undo and what to do instead.
    const mcpNotice = done.mcp.notices!.find(notice => notice.kind === 'taken-in')!;
    assert.equal(mcpNotice.kind === 'taken-in' && sentences(libraryWords.mcp).takenInWords(mcpNotice, 'mcp'),
      'Synchronize everything took in 2 MCP servers, found in Claude Code and Codex: docs and files. History can undo each, except any found in Claude Code (its entry says why).');
    assert.match(librarySentence(docs, libraryWords.mcp, tools)?.text ?? '', /It has no Undo: an Undo would hand Claude Code’s own entry back, and Claude Code’s MCP settings are written only by Write to Claude Code\. Turn it off instead/);
    assert.doesNotMatch(librarySentence(files, libraryWords.mcp, tools)?.text ?? '', /no Undo/);
    // One notice per pass of a kind: how many, by name, and where they were found. None for a key it left.
    assert.deepEqual(noticesOf(done).map(notice => notice.kind === 'taken-in' ? [notice.items, notice.from] : notice.kind), [[['notes', 'tidy'], ['claude-cli']], [['docs', 'files'], ['claude-cli', 'codex-cli']], [['helper'], ['copilot-cli']]], 'each tool named once');
    // A click's Undo never undoes what the rule took in: none of it is a click's.
    assert.deepEqual(Object.values(done).flatMap(pass => pass.made ?? []), []);
    // The next pass writes nothing and says nothing.
    const again = await background(box);
    assert.deepEqual([wrote(again), noticesOf(again)], [0, []]);
  } finally { await box.cleanup(); }
});

test('Switching it on in a home with no sync record makes the record, as the first click does; where a pass may not write it is refused and nothing is written', async () => {
  const box = await sandbox();
  try {
    assert.equal((await syncGate(box.context)).state, 'first-setup');
    await turnOn(box);
    assert.deepEqual([(await readRecord(box.home)).record?.syncEverything, (await syncGate(box.context)).state], [true, 'ready']);
    const record = (await readRecord(box.home)).record!;
    await writeFile(join(box.home, '.central-knot/sync.json'), JSON.stringify({ ...record, syncEverything: 'yes' }));
    assert.equal((await readRecord(box.home)).problem, 'The sync record is damaged.', 'the setting is true or false, nothing else');
    await saveRecord(box.home, { ...record, owner: 'another-build', ownerName: 'Central Knot Alpha' }, true);
    const refused = await setSyncEverything(box.context, false);
    assert.match(refused.stopped ?? '', /Central Knot Alpha syncs this home/);
    assert.equal((await readRecord(box.home)).record?.syncEverything, true);
  } finally { await box.cleanup(); }
});

// ---------- What it never brings back ----------

test('Undo of what the rule took in takes it out again for good: each tool keeps its own copy, and no pass takes it back; Add still does', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await turnOn(box);
    await background(box);
    const entry = (await entriesOf(box, 'notes')).at(-1)!;
    await restoreSkill(box.context, tools, entry.id);
    assert.deepEqual(await Promise.all(tools.map(tool => skillIn(box, tool, 'notes'))), [skill('notes'), undefined, undefined]);
    for (let run = 0; run < 10; run++) assert.equal(wrote(await background(box)), 0, `pass ${run + 1}`);
    const view = (await views(box)).skills;
    assert.deepEqual([placeIn(view, 'notes'), rowOf(view, 'notes')?.takeInAnswers?.rule], ['found', { leave: 'deleted' }]);
    assert.match(statusLine(pageRow(rowOf(view, 'notes')!), view.library.notes, tools, true), /It was deleted from Central Knot, so it will not be added by itself again\. Add, or Restore in History, brings it back\.$/);
    await applySkills(box.context, tools, [add(view, 'notes')]);
    assert.equal(placeIn((await views(box)).skills, 'notes'), 'on');
  } finally { await box.cleanup(); }
});

test('Deleted from Central Knot, then its copy put back by hand: never taken in again; an Off item whose copy is put back by hand is no found item at all', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await putAgent(box, 'claude-cli', 'helper');
    await turnOn(box);
    await background(box);
    await applySkills(box.context, tools, [{ key: 'notes', managed: true, off: [], seenManaged: true, deleted: true }]);
    await applyAgents(box.context, tools, [{ key: 'helper', managed: false, off: [], seenManaged: true }]);
    await putSkill(box, 'codex-cli', 'notes', 'Put back by hand.');
    await putAgent(box, 'copilot-cli', 'helper', 'Put back by hand.');
    for (let run = 0; run < 10; run++) assert.equal(wrote(await background(box)), 0, `pass ${run + 1}`);
    const view = await views(box);
    assert.deepEqual([placeIn(view.skills, 'notes'), placeIn(view.agents, 'helper'), rowOf(view.agents, 'helper')?.takeInAnswers], ['found', 'off', undefined]);
    assert.deepEqual([await skillIn(box, 'codex-cli', 'notes'), await readFile(join(box.home, agentFile('copilot-cli', 'helper')), 'utf8')], [skill('notes', 'Put back by hand.'), agent('copilot-cli', 'helper', 'Put back by hand.')]);
  } finally { await box.cleanup(); }
});

// ---------- Not whole, or not the person's ----------

test('A skill saved in two goes: the first, inside the settle window, is left for the next pass; the second, after the take-in, flows in as a hand edit', async () => {
  const box = await sandbox(2000);
  try {
    await turnOn(box);
    await putSkill(box, 'claude-cli', 'notes');
    const at = new Date('2026-11-13T10:00:00Z'), first = at.getTime();
    for (const path of ['SKILL.md', '']) await utimes(join(box.home, skillRoot['claude-cli'], 'notes', path), at, at);
    const early = await background(box, { now: first + 500 });
    assert.deepEqual([early.skills.settling, placeIn((await views(box)).skills, 'notes'), noticesOf(early)], [true, 'found', []]);
    await background(box, { now: first + 2500 });
    assert.equal(placeIn((await views(box)).skills, 'notes'), 'on');
    await writeFile(join(box.home, skillRoot['claude-cli'], 'notes', 'run.sh'), 'echo notes\n');
    const edit = await background(box, { now: Date.now() + 5000 });
    assert.deepEqual([await readFile(join(box.home, skillRoot['codex-cli'], 'notes', 'run.sh'), 'utf8'), noticesOf(edit).map(notice => notice.kind)], ['echo notes\n', ['edit']]);
  } finally { await box.cleanup(); }
});

test('A copy that can’t be read, and an MCP entry in a form Central Knot doesn’t edit, are left quietly; so is a tool Central Knot doesn’t manage', async () => {
  const box = await sandbox();
  try {
    // A folder that can't be copied as it is (a link inside) is a row with no Add; one with a file it can't read is no row.
    await putSkill(box, 'claude-cli', 'linked');
    await symlink('/etc/hosts', join(box.home, skillRoot['claude-cli'], 'linked', 'hosts'));
    await putSkill(box, 'claude-cli', 'locked');
    await writeFile(join(box.home, skillRoot['claude-cli'], 'locked', 'private.txt'), 'x');
    await chmod(join(box.home, skillRoot['claude-cli'], 'locked', 'private.txt'), 0o000);
    await writeFile(join(box.home, mcpFile['claude-cli']), `${JSON.stringify({ mcpServers: { odd: 42 } }, null, 2)}\n`);
    await mkdir(join(box.home, '.pi/agent/skills/elsewhere'), { recursive: true });
    await writeFile(join(box.home, '.pi/agent/skills/elsewhere/SKILL.md'), skill('elsewhere'));
    await turnOn(box);
    const done = await background(box);
    const view = await views(box);
    assert.deepEqual([wrote(done), noticesOf(done), Object.keys(view.skills.library), Object.keys(view.mcp.library), rowOf(view.skills, 'locked'), rowOf(view.skills, 'elsewhere')], [0, [], [], [], undefined, undefined]);
    assert.deepEqual([rowOf(view.skills, 'linked')?.takeInAnswers, rowOf(view.mcp, 'odd')?.takeInAnswers], [{ click: { leave: 'no-copy' }, rule: { leave: 'no-copy' } }, { click: { leave: 'no-copy' }, rule: { leave: 'no-copy' } }]);
  } finally { await box.cleanup(); }
});

test('A plugin’s parts are left found, each row keeping its Add; Add on one takes in that part alone', async () => {
  const box = await sandbox();
  try {
    for (const name of ['alpha', 'beta', 'taken-out', 'own']) await putSkill(box, 'codex-cli', name);
    await putAgent(box, 'codex-cli', 'kit-agent');
    // A part the person took out of Codex since (`removed`), whose name a skill of their own has now; and an agent part whose
    // name a skill of the person's own shares: neither skill is the plugin's.
    const items = [{ kind: 'skill', name: 'alpha', hash: '' }, { kind: 'skill', name: 'beta', hash: '' }, { kind: 'agent', name: 'kit-agent', hash: '' },
      { kind: 'skill', name: 'taken-out', hash: '', removed: true }, { kind: 'agent', name: 'own', hash: '' }];
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    await writeFile(partsRecordPath(box.home), JSON.stringify({ installs: [{ source: 'example/market', marketName: 'market', plugin: 'kit', tool: 'codex-cli', at: '2026-11-13T09:00:00Z', digest: 'd', items }] }));
    await turnOn(box);
    await background(box);
    let view = await views(box);
    assert.deepEqual([placeIn(view.skills, 'taken-out'), placeIn(view.skills, 'own')], ['on', 'on'], 'a part taken out, and another kind’s part, are no skill’s part');
    assert.deepEqual([rowOf(view.skills, 'alpha')?.takeInAnswers?.rule, rowOf(view.agents, 'kit-agent')?.takeInAnswers?.rule, 'take' in rowOf(view.skills, 'alpha')!.takeInAnswers!.click], [{ leave: 'part' }, { leave: 'part' }, true]);
    await applySkills(box.context, tools, [add(view.skills, 'alpha')]);
    await background(box);
    view = await views(box);
    assert.deepEqual([placeIn(view.skills, 'alpha'), placeIn(view.skills, 'beta'), placeIn(view.agents, 'kit-agent')], ['on', 'found', 'found']);
  } finally { await box.cleanup(); }
});

// ---------- Never fights a click or another route, never repeats ----------

test('Two tools gain the same new name in one pass: one take-in where the contents are the same, a wait for a choice where they differ', async () => {
  const box = await sandbox();
  try {
    await turnOn(box);
    await putSkill(box, 'claude-cli', 'same');
    await putSkill(box, 'codex-cli', 'same');
    await putAgent(box, 'claude-cli', 'split', 'One way.');
    await putAgent(box, 'codex-cli', 'split', 'Another way.');
    const done = await background(box);
    const view = await views(box);
    assert.deepEqual([placeIn(view.skills, 'same'), (await entriesOf(box, 'same')).length, Object.keys(view.skills.library.same.applied).sort()], ['on', 1, [...tools].sort()]);
    assert.deepEqual([placeIn(view.agents, 'split'), rowOf(view.agents, 'split')?.takeInAnswers?.rule], ['found', { wait: 'choice' }]);
    assert.deepEqual(noticesOf(done).map(notice => notice.kind === 'taken-in' ? [notice.items, notice.from] : notice.kind), [[['same'], ['claude-cli', 'codex-cli']]]);
  } finally { await box.cleanup(); }
});

test('Add clicked from a read made before the background pass took the item in is refused, and Pull and the rule on one key make one item', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await putSkill(box, 'codex-cli', 'pulled', 'Found here.');
    await turnOn(box);
    const read = (await views(box)).skills;
    await background(box);
    const late = await applySkills(box.context, tools, [add(read, 'notes')]);
    assert.deepEqual([late.results.map(result => result.message), (await entriesOf(box, 'notes')).length], [['notes changed since the page was read. Nothing was changed; read again.'], 1]);
    // Pull brings what the rule took in: the repo's content becomes its current version; one item.
    const pulled = join(box.base, 'repo-notes');
    await mkdir(pulled, { recursive: true });
    await writeFile(join(pulled, 'SKILL.md'), skill('notes', 'From the repo.'));
    await applySkills(box.context, tools, [], { only: new Set(['notes']), pulled: new Map([['notes', { name: 'notes', folder: pulled, hash: (await readTree(pulled)).hash }]]) });
    await background(box);
    assert.deepEqual([await skillIn(box, 'copilot-cli', 'notes'), (await entriesOf(box, 'notes')).map(event => [event.kind, event.cause])], [skill('notes', 'From the repo.'), [['on', 'sync-everything'], ['edit', 'pulled']]]);
  } finally { await box.cleanup(); }
});

// ---------- Automatic sync off ----------

test('With Automatic sync off the rule takes nothing until Sync once: a click on one row’s Add takes in that row alone', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await putSkill(box, 'claude-cli', 'tidy');
    await turnOn(box);
    // No background pass runs with Automatic sync off; a click's pass is limited to its own items (main.ts `only`).
    await applySkills(box.context, tools, [add((await views(box)).skills, 'notes')], { only: new Set(['notes']) });
    let view = (await views(box)).skills;
    assert.deepEqual([placeIn(view, 'notes'), placeIn(view, 'tidy')], ['on', 'found']);
    // Sync once is main.ts's pass of the whole home.
    await background(box);
    view = (await views(box)).skills;
    assert.equal(placeIn(view, 'tidy'), 'on');
  } finally { await box.cleanup(); }
});

// ---------- A profile in use ----------

test('A profile in use when the rule takes an item in: its name drops, nothing else changes, and the next switch turns the new item Off, which stays in Central Knot', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await applySkills(box.context, tools, [add((await views(box)).skills, 'notes')]);
    const { id } = await saveProfile(box.context, { name: 'Work', items: ['skill:notes'] });
    const live = async () => { const read = await readLibraries(box.context); return 'libraries' in read ? liveItems(read.libraries) : []; };
    assert.deepEqual(inUse((await readProfiles(box.home)).profiles, await live()).map(profile => profile.name), ['Work']);
    await putSkill(box, 'codex-cli', 'tidy');
    await turnOn(box);
    await background(box);
    assert.deepEqual([inUse((await readProfiles(box.home)).profiles, await live()), placeIn((await views(box)).skills, 'notes')], [[], 'on']);
    await switchProfile(box.context, tools, id!);
    const view = (await views(box)).skills;
    assert.deepEqual([placeIn(view, 'tidy'), placeIn(view, 'notes'), await skillIn(box, 'codex-cli', 'tidy')], ['off', 'on', undefined]);
  } finally { await box.cleanup(); }
});

// ---------- The Add that did nothing ----------

test('An agent whose only copy is two files differing by case gets no Add, and the rule leaves it', async t => {
  const box = await sandbox();
  try {
    await putAgent(box, 'claude-cli', 'reviewer');
    await writeFile(join(box.home, '.claude/agents/Reviewer.md'), agent('claude-cli', 'Reviewer', 'Other.'));
    // Only a case-sensitive disk keeps two such files; macOS's usual one keeps one, which is an ordinary copy.
    if ((await readdir(join(box.home, '.claude/agents'))).length < 2) { t.skip('this disk keeps one file for names that differ only by case'); return; }
    await turnOn(box);
    assert.equal(wrote(await background(box)), 0);
    const view = (await views(box)).agents;
    assert.deepEqual(rowOf(view, 'reviewer')?.takeInAnswers, { click: { leave: 'no-copy' }, rule: { leave: 'no-copy' } });
    assert.equal(statusLine(pageRow(rowOf(view, 'reviewer')!), undefined, tools), 'Not in Central Knot · it can’t be taken in now (see below).');
  } finally { await box.cleanup(); }
});

// ---------- What the rule leaves to a click, and how it keeps its word ----------

test('A skill Convert to a Pi skill made is left found by the rule, so it never spreads to the tools that hold the agent; Add still takes it', async () => {
  const box = await sandbox(), four: HarnessId[] = [...tools, 'pi-cli'];
  try {
    await mkdir(join(box.home, '.pi/agent/skills'), { recursive: true });
    await putAgent(box, 'claude-cli', 'helper');
    await turnOn(box);
    await background(box, {}, four);
    assert.equal((await convertAgentToSkill(box.context, four, 'helper')).stopped, undefined);
    await background(box, {}, four);
    const view = await skillsView(box.context, four);
    assert.deepEqual([placeIn(view, 'helper'), rowOf(view, 'helper')?.takeInAnswers?.rule, await skillIn(box, 'codex-cli', 'helper'), await skillIn(box, 'copilot-cli', 'helper')],
      ['found', { leave: 'converted' }, undefined, undefined]);
    await applySkills(box.context, four, [add(view, 'helper')]);
    assert.equal(placeIn(await skillsView(box.context, four), 'helper'), 'on');
  } finally { await box.cleanup(); }
});

test('A server, or a skill, that every tool holding it has switched off in its own settings is left found by the rule, never spread switched on; Add still takes it', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, mcpFile['codex-cli']), '[mcp_servers.quiet]\ncommand = "npx"\nargs = ["quiet"]\nenabled = false\n');
    await putSkill(box, 'copilot-cli', 'hushed');
    await setDisabled(box.context, 'copilot-cli', { folder: 'hushed', name: 'hushed', skillFile: join(box.home, skillRoot['copilot-cli'], 'hushed', 'SKILL.md') }, true);
    await turnOn(box);
    assert.equal(wrote(await background(box)), 0);
    let view = await views(box);
    assert.deepEqual([rowOf(view.mcp, 'quiet')?.takeInAnswers?.rule, rowOf(view.skills, 'hushed')?.takeInAnswers?.rule, await serverNames(box, 'copilot-cli')],
      [{ leave: 'switched-off' }, { leave: 'switched-off' }, []]);
    await applyServers(box.context, tools, [add(view.mcp, 'quiet')]);
    view = await views(box);
    assert.equal(placeIn(view.mcp, 'quiet'), 'on');
  } finally { await box.cleanup(); }
});

test('A skill saved again while the rule keeps another costs that other nothing: it is taken in with its entry, and the changed one waits for the next pass', async () => {
  const box = await sandbox();
  try {
    for (const name of ['alpha', 'beta']) await putSkill(box, 'claude-cli', name, 'Original.');
    await turnOn(box);
    const store = skillKind.store;
    let saved = false;
    skillKind.store = async (...args) => {
      if (args[1].key === 'beta' && !saved) { saved = true; await putSkill(box, 'claude-cli', 'beta', 'Saved during the pass.'); }
      return store(...args);
    };
    let first: Awaited<ReturnType<typeof background>>;
    try { first = await background(box); } finally { skillKind.store = store; }
    const entries = async (key: string) => (await entriesOf(box, key)).filter(event => event.cause === 'sync-everything').length;
    assert.deepEqual([first.skills.stopped, placeIn((await views(box)).skills, 'alpha'), placeIn((await views(box)).skills, 'beta'), await entries('alpha')], [undefined, 'on', 'found', 1]);
    await background(box);
    assert.deepEqual([placeIn((await views(box)).skills, 'beta'), await entries('beta'), await skillIn(box, 'codex-cli', 'beta')], ['on', 1, skill('beta', 'Saved during the pass.')]);
  } finally { await box.cleanup(); }
});

test('A store that fails for another reason while the rule keeps a skill is not waited out: the pass says it could not finish', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'alpha', 'Original.');
    await turnOn(box);
    const store = skillKind.store;
    skillKind.store = async () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); };
    let done: PassResult | undefined; try { done = await applySkills(box.context, tools, [], { background: true }); } finally { skillKind.store = store; }
    assert.match(done?.stopped ?? '', /could not finish/, 'not left settling, to be tried again every few seconds without a word');
  } finally { await box.cleanup(); }
});

test('A take-in’s Undo is not offered once the place it was found in no longer holds that copy (Take over replaced it): it offers Turn off instead', async () => {
  const box = await sandbox();
  try {
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skill('notes', 'Original.'));
    await turnOn(box);
    await background(box);
    const taken = (await entriesOf(box, 'notes')).find(event => event.cause === 'sync-everything')!;
    assert.equal(libraryAction(taken, (await views(box)).skills.library.notes)?.label, 'Undo', 'while the shared copy is where it was found');
    assert.equal((await takeOver(box.context, tools, 'notes', 'codex-cli')).stopped, undefined);
    assert.equal(libraryAction(taken, (await views(box)).skills.library.notes)?.label, 'Turn off');
  } finally { await box.cleanup(); }
});

test('A pass of the whole home says which found items it left, so a new one the rule leaves waiting reaches an open page', async () => {
  const box = await sandbox();
  try {
    await turnOn(box);
    assert.deepEqual((await background(box)).skills.found, []);
    await putSkill(box, 'claude-cli', 'review', 'Review gently.');
    await putSkill(box, 'codex-cli', 'review', 'Review hard.');
    const done = await background(box);
    assert.deepEqual([done.skills.writes, done.skills.found], [0, ['review']]);
  } finally { await box.cleanup(); }
});

test('A skill only in ~/.agents/skills is taken in from there: the tools that read it have it that way, the others get Central Knot’s copy, and that folder is not written', async () => {
  const box = await sandbox();
  try {
    const shared = join(box.home, '.agents/skills/notes');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'SKILL.md'), skill('notes', 'Shared.'));
    await turnOn(box);
    await background(box);
    assert.deepEqual([placeIn((await views(box)).skills, 'notes'), await readFile(join(shared, 'SKILL.md'), 'utf8'), await skillIn(box, 'claude-cli', 'notes'), await skillIn(box, 'copilot-cli', 'notes'), await skillIn(box, 'codex-cli', 'notes')],
      ['on', skill('notes', 'Shared.'), skill('notes', 'Shared.'), undefined, undefined]);
  } finally { await box.cleanup(); }
});

test('A click’s pass with Automatic sync on (no `only`) takes in the clicked item and runs no rule; the background pass after takes in the rest', async () => {
  const box = await sandbox();
  try {
    await putSkill(box, 'claude-cli', 'notes');
    await putSkill(box, 'claude-cli', 'tidy');
    await turnOn(box);
    await applySkills(box.context, tools, [add((await views(box)).skills, 'notes')]);
    const view = (await views(box)).skills;
    assert.deepEqual([placeIn(view, 'notes'), placeIn(view, 'tidy')], ['on', 'found']);
    await background(box);
    assert.equal(placeIn((await views(box)).skills, 'tidy'), 'on');
  } finally { await box.cleanup(); }
});
