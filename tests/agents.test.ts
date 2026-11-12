// Agents on the library, as worked examples on real files in a temp home (src/agents.ts; the model is src/library.ts).
// One agent, "reviewer", in Claude Code, Copilot CLI and Codex; every click is sent as the Agents page sends it
// (tests/agentclicks.ts). In order: the harnesses' formats, Off and On, edits and deletions by hand, copies that can't be
// seen, found agents, versions, Delete, and what a crash or a damaged record leaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentText, readAgents } from '../src/agentfiles.ts';
import { agentVersion, agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { convertAgentToSkill } from '../src/agentskill.ts';
import { harnessIs, placeOf } from '../src/agentrow.ts';
import { currentIndex, sourceWords } from '../src/library.ts';
import { readHistory } from '../src/manage.ts';
import { readRecord, syncGate, type ShareContext } from '../src/share.ts';
import { readTomlTables } from '../src/textedit.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { HarnessId } from '../src/types.ts';
import { choose, claudeAgent, claudeOwn, codexAgent, deleteIt, fileOf, filesOf, historyActions, historyOf, itemOf, keepOut, makeCurrent, pass, readOf, sandbox, seen, tools, turnOff, turnOn, undo, write, type Box, type Tool } from './agentclicks.ts';

const inBox = (name: string, body: (box: Box) => Promise<void>, options: { skip?: boolean } = {}) => test(name, options, async () => { const box = await sandbox(); try { await body(box); } finally { await box.cleanup(); } });
/** An agent written in Claude Code, taken into Central Knot and applied to every harness. */
async function on(box: Box, text = claudeAgent()) { await write(box, 'claude-cli', text); assert.notEqual(await turnOn(box), 'choose'); }
/** Each version of the agent as the opened row lists it: its prompt's last line and where it came from, newest first. */
async function versions(box: Box) {
  const item = (await itemOf(box))!;
  const lastLine = async (hash: string) => (await agentVersion(box.context, 'reviewer', hash))!.prompt.trim().split('\n').at(-1);
  return Promise.all(item.versions.map(async (version, index) => `${await lastLine(version.hash)} (${sourceWords(version.from)})${index === currentIndex(item) ? ' *' : ''}`));
}
/** A hand edit: the file's last prompt line replaced. `seconds`: saved that long after now, where a test compares edit times. */
async function edit(box: Box, tool: Tool, line: string, seconds?: number) {
  await write(box, tool, (await readOf(box, tool))!.replace(/Be \w+\.|Edit \w+\./, line));
  if (seconds !== undefined) await utimes(fileOf(box, tool), new Date(), new Date(Date.now() + seconds * 1000));
}
const marks = async (box: Box) => { const { row, item } = await seen(box); return Object.fromEntries(tools.map(tool => [tool, harnessIs(row, item, tool)])); };

// ---------- Formats ----------

inBox('A Claude Code agent taken in reaches Copilot CLI and Codex in their own formats; an edit in Codex comes back to both', async box => {
  await on(box);
  assert.equal(await readOf(box, 'copilot-cli'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\nBe brief.\n');
  const root = readTomlTables((await readOf(box, 'codex-cli'))!)[0].entries;
  assert.equal(root.find(entry => entry.key === 'developer_instructions')?.value, 'You review code.\nBe brief.\n');
  await edit(box, 'codex-cli', 'Be thorough.');
  assert.equal((await pass(box)).writes, 2);
  assert.match((await readOf(box, 'claude-cli'))!, /Be thorough\./);
  assert.match((await readOf(box, 'copilot-cli'))!, /Be thorough\./);
});

inBox('Writing a version changes only the name, description and prompt: a harness’s own fields, comments and tables stay', async box => {
  await write(box, 'codex-cli', codexAgent('You review code.\nBe quick.\n'));
  await write(box, 'claude-cli', claudeAgent());
  await choose(box, 'claude-cli');
  await edit(box, 'claude-cli', 'Say "hi" with a \\ and """quotes"""\ttab.');
  await pass(box);
  const codex = (await readOf(box, 'codex-cli'))!;
  assert.ok(codex.startsWith('# mine\nname = "reviewer"\ndescription = "Reviews code"\nmodel = "gpt-6"\n'), codex);
  assert.ok(codex.endsWith('\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\n'), codex);
  assert.equal((await readAgents(box.context, 'codex-cli')).entries[0].agent.prompt, 'You review code.\nSay "hi" with a \\ and """quotes"""\ttab.\n');
  const claude = '---\n# keep me\nname: reviewer\ndescription: Reviews code\nhooks: {PreToolUse: [{matcher: Bash}]}\n---\n\nold\n';
  assert.equal(agentText('claude-cli', { name: 'reviewer', description: 'Reviews code', prompt: 'x' }, claude), '---\n# keep me\nname: reviewer\ndescription: Reviews code\nhooks: {PreToolUse: [{matcher: Bash}]}\n---\n\nx');
});

inBox('A Copilot CLI copy with quoted "name" and "description" keys stays readable after an update', async box => {
  await write(box, 'copilot-cli', '---\n"name": reviewer\n"description": Reviews code\n---\n\nYou review code.\nBe brief.\n');
  await on(box);
  await edit(box, 'claude-cli', 'Edit one.');
  await pass(box);
  const copilot = await readAgents(box.context, 'copilot-cli');
  assert.equal(copilot.unreadable.size, 0, copilot.problems.join('; '));
  assert.equal(copilot.entries[0]?.agent.prompt.trim().split('\n').at(-1), 'Edit one.');
});

inBox('A harness with no agents folder yet gets the agent', async box => {
  await rm(join(box.home, '.codex/agents'), { recursive: true });
  await on(box);
  assert.match((await readOf(box, 'codex-cli'))!, /You review code/);
});

// ---------- Off and On ----------

inBox('Off removes the agent from every harness and keeps it in Central Knot; On writes every file back byte for byte', async box => {
  await write(box, 'codex-cli', codexAgent());
  // Claude Code's file as a person wrote it: a quoted description and a comment, which a rewrite would not reproduce.
  await on(box, claudeAgent(undefined, claudeOwn).replace('description: Reviews code', '# mine\ndescription: "Reviews code"'));
  const before = await filesOf(box);
  assert.deepEqual(Object.values(before).map(text => text !== undefined), [true, true, true]);
  const off = await turnOff(box);
  assert.equal(off.writes, 3, JSON.stringify(off.results));
  assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined });
  // In Central Knot only: it still has a row, Off, with its description from the library.
  const { fact, item } = await seen(box);
  assert.deepEqual([placeOf(item), fact?.managed, fact?.description, Object.keys(fact?.copies ?? {})], ['off', false, 'Reviews code', []]);
  assert.equal((await pass(box)).writes, 0, 'an Off agent stays out');
  await turnOn(box);
  assert.deepEqual(await filesOf(box), before);
  assert.equal((await pass(box)).writes, 0);
});

inBox('Off then On after an edit elsewhere: the shared part moves on in every file, and each harness’s own part stays', async box => {
  await write(box, 'codex-cli', codexAgent());
  await on(box, claudeAgent(undefined, claudeOwn));
  await edit(box, 'copilot-cli', 'Be exact.');
  await pass(box);
  const before = await filesOf(box);
  assert.match(before['claude-cli']!, /^---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\nmodel: opus\n---\n\nYou review code\.\nBe exact\.\n$/);
  assert.match(before['codex-cli']!, /^# mine\n[\s\S]*model = "gpt-6"\n[\s\S]*Be exact\.[\s\S]*\[mcp_servers\.docs\]/);
  await turnOff(box);
  await turnOn(box);
  assert.deepEqual(await filesOf(box), before, 'byte for byte, own parts included');
  // Off, an earlier version made current while it is off, On: each file takes the earlier prompt and keeps its own part.
  await turnOff(box);
  await makeCurrent(box, (await itemOf(box))!.versions.at(-1)!.hash);
  await turnOn(box);
  const after = await filesOf(box);
  assert.match(after['claude-cli']!, /tools: Read, Grep\nmodel: opus\n---\n\nYou review code\.\nBe brief\.\n$/);
  assert.match(after['codex-cli']!, /^# mine\n[\s\S]*model = "gpt-6"\n[\s\S]*Be brief\.[\s\S]*\[mcp_servers\.docs\]/);
});

inBox('A harness’s own switch keeps the agent out of that harness alone, and puts the same file back', async box => {
  await write(box, 'codex-cli', codexAgent());
  await on(box);
  const codex = await readOf(box, 'codex-cli');
  await keepOut(box, 'codex-cli');
  assert.deepEqual([(await itemOf(box))!.except, (await filesOf(box))['codex-cli'], (await marks(box))['codex-cli']], [['codex-cli'], undefined, 'kept-out']);
  assert.equal((await pass(box)).writes, 0);
  // An edit elsewhere doesn't reach a harness it is kept out of.
  await edit(box, 'claude-cli', 'Be exact.');
  await pass(box);
  assert.equal(await readOf(box, 'codex-cli'), undefined);
  await keepOut(box, 'codex-cli', false);
  assert.equal(await readOf(box, 'codex-cli'), codex!.replace('Be brief.', 'Be exact.'));
});

inBox('An agent whose first harness is no longer managed still turns Off and On in the others', async box => {
  await on(box);
  const without: HarnessId[] = ['copilot-cli', 'codex-cli'];
  await chooseTools(box.context, without);
  const { row, item } = await seen(box);
  assert.equal((await applyAgents(box.context, without, [{ key: row.key, managed: false, off: item!.except, seenManaged: true }])).writes, 2);
  assert.deepEqual(await filesOf(box), { 'claude-cli': claudeAgent(), 'copilot-cli': undefined, 'codex-cli': undefined }, 'the harness left out keeps its copy');
  assert.equal((await applyAgents(box.context, without, [{ key: row.key, managed: true, off: [], seenManaged: false }])).writes, 2);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
});

inBox('A harness managed again: the library wins, and the copy it held is a version first', async box => {
  await on(box);
  await chooseTools(box.context, ['claude-cli', 'copilot-cli']);
  await edit(box, 'codex-cli', 'Edit away.');
  await chooseTools(box.context, tools);
  assert.equal((await pass(box)).writes, 1);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  assert.deepEqual(await versions(box), ['Edit away. (was in Codex)', 'Be brief. (found in Claude Code) *']);
});

// ---------- Edits and deletions by hand ----------

inBox('An edit in a harness becomes the current version, from that harness, and reaches the others; its Undo makes the earlier one current', async box => {
  await on(box);
  await edit(box, 'codex-cli', 'Be exact.');
  const spread = await pass(box);
  assert.deepEqual(spread.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['edit', 'codex-cli', ['claude-cli', 'copilot-cli']]]);
  assert.deepEqual(await versions(box), ['Be exact. (edited in Codex) *', 'Be brief. (found in Claude Code)']);
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['on: Turn off', 'edit: Undo']);
  await actions[1].run();
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  assert.deepEqual(await versions(box), ['Be brief. (made current again) *', 'Be exact. (edited in Codex)', 'Be brief. (found in Claude Code)']);
  assert.equal((await pass(box)).writes, 0);
});

inBox('Two edits: the latest wins, the other is a version, and History can make it current', async box => {
  await on(box);
  await edit(box, 'claude-cli', 'Edit one.', 5);
  await edit(box, 'codex-cli', 'Edit two.', 9);
  const settled = await pass(box);
  assert.deepEqual(settled.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['conflict', 'codex-cli', ['claude-cli']]]);
  assert.match((await readOf(box, 'claude-cli'))!, /Edit two\./);
  assert.deepEqual(await versions(box), ['Edit two. (edited in Codex) *', 'Edit one. (edited in Claude Code)', 'Be brief. (found in Claude Code)']);
  const use = (await historyActions(box)).find(action => action.label === 'Use claude-cli’s')!;
  await use.run();
  assert.match((await readOf(box, 'copilot-cli'))!, /Edit one\./);
});

inBox('A copy deleted by hand turns the agent Off everywhere, once it has stayed missing for the settle window', async box => {
  await on(box);
  await rm(fileOf(box, 'copilot-cli'));
  const waiting = { ...box.context, settleMs: 2000 };
  const first = await applyAgents(waiting, tools, [], { now: 1000 });
  assert.deepEqual([first.writes, first.settling, (await itemOf(box))!.on], [0, true, true], 'inside the window nothing happens');
  const second = await applyAgents(waiting, tools, [], { now: 3500 });
  assert.deepEqual(second.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['deleted', 'copilot-cli', ['claude-cli', 'codex-cli']]]);
  assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined });
  assert.equal(placeOf(await itemOf(box)), 'off');
  // Central Knot keeps it: History's entry turns it on again, every file as it was.
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['off: Turn on']);
  await actions[0].run();
  assert.equal(await readOf(box, 'copilot-cli'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\nBe brief.\n');
});

inBox('A copy put back inside the settle window was a save, not a deletion', async box => {
  await on(box);
  const text = await readOf(box, 'codex-cli');
  await rm(fileOf(box, 'codex-cli'));
  const waiting = { ...box.context, settleMs: 2000 };
  await applyAgents(waiting, tools, [], { now: 1000 });
  await write(box, 'codex-cli', text!);
  assert.equal((await applyAgents(waiting, tools, [], { now: 5000 })).writes, 0);
  assert.equal((await itemOf(box))!.on, true);
});

inBox('An edit in one harness and a deletion in another: the edit is the current version, and the agent turns Off', async box => {
  await on(box);
  await edit(box, 'claude-cli', 'Be exact.');
  await rm(fileOf(box, 'codex-cli'));
  await pass(box);
  assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined });
  assert.deepEqual(await versions(box), ['Be exact. (edited in Claude Code) *', 'Be brief. (found in Claude Code)']);
  await turnOn(box);
  assert.match((await readOf(box, 'codex-cli'))!, /Be exact\./);
});

// ---------- A copy that can't be seen is never a copy that is gone ----------

const unseeable: [string, (box: Box) => Promise<unknown>, (box: Box) => Promise<unknown>][] = [
  ['an unreadable file', box => chmod(fileOf(box, 'codex-cli'), 0o000), box => chmod(fileOf(box, 'codex-cli'), 0o644)],
  ['a half-written save', box => write(box, 'codex-cli', 'name = "reviewer"\n'), async () => undefined],
  ['a file that is no agent', box => write(box, 'claude-cli', 'no frontmatter yet'), async () => undefined],
  ['its agents folder away', box => rename(join(box.home, '.codex/agents'), join(box.home, '.codex/agents-away')), async box => { await rm(join(box.home, '.codex/agents'), { recursive: true, force: true }); await rename(join(box.home, '.codex/agents-away'), join(box.home, '.codex/agents')); }],
  ['its agents folder made again, empty', async box => { await rm(join(box.home, '.codex/agents'), { recursive: true }); await mkdir(join(box.home, '.codex/agents')); }, async () => undefined],
];
for (const [what, hide, show] of unseeable) {
  inBox(`A copy that can’t be seen (${what}) turns nothing Off and removes nothing`, async box => {
    await on(box);
    await pass(box);
    const others = async () => { const now = await filesOf(box); return [now['copilot-cli'] !== undefined, (await itemOf(box))!.on]; };
    await hide(box);
    try {
      for (const now of [1000, 9000]) { const done = await applyAgents(box.context, tools, [], { now }); assert.equal(done.results.filter(entry => entry.outcome === 'removed').length, 0, JSON.stringify(done.results)); }
      assert.deepEqual(await others(), [true, true]);
    } finally { await show(box); }
  }, { skip: what === 'an unreadable file' && process.getuid?.() === 0 });
}

inBox('A folder made again gets its agents back; a harness no longer managed is left as it is', async box => {
  await on(box);
  await pass(box);
  await rm(join(box.home, '.codex/agents'), { recursive: true });
  await mkdir(join(box.home, '.codex/agents'));
  assert.equal((await pass(box)).writes, 1);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
  // Not managed any more (uninstalled, or left out by the tool choice): its copy can go without anything turning Off.
  await rm(fileOf(box, 'codex-cli'));
  for (const now of [1000, 9000]) assert.equal((await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [], { now })).writes, 0);
  assert.equal((await itemOf(box))!.on, true);
});

inBox('A harness’s agents folder removed by hand is written afresh once the settle window has passed, and its mark says so meanwhile', async box => {
  await write(box, 'codex-cli', codexAgent());
  await on(box);
  await pass(box);
  await rm(join(box.home, '.codex/agents'), { recursive: true });
  // The page reads what the pass will do: the folder's agent is written again, never "deleted… turns off everywhere".
  assert.equal((await marks(box))['codex-cli'], 'gets-it');
  const waiting = { ...box.context, settleMs: 2000 };
  const first = await applyAgents(waiting, tools, [], { now: 1000 });
  assert.deepEqual([first.writes, first.settling, await readOf(box, 'codex-cli')], [0, true, undefined], 'inside the window nothing happens there');
  const second = await applyAgents(waiting, tools, [], { now: 3500 });
  assert.deepEqual([second.writes, (await itemOf(box))!.on, (await marks(box))['codex-cli']], [1, true, 'current']);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
  // An Off agent's removal owed there waits for the folder: it is not forgotten.
  await turnOff(box, { ...box.context, fault: at => { if (at === 'before-remove') throw new Error('crash'); } }).catch(() => undefined);
  await rename(join(box.home, '.codex/agents'), join(box.home, '.codex/agents-away'));
  for (const now of [5000, 9000]) await applyAgents(waiting, tools, [], { now });
  await rename(join(box.home, '.codex/agents-away'), join(box.home, '.codex/agents'));
  await pass(box);
  assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined });
});

inBox('A harness whose folder is somewhere else now (its config root moved) is written afresh there; nothing turns Off', async box => {
  await on(box);
  await pass(box);
  const moved: ShareContext = { ...box.context, overrides: { 'codex-cli': join(box.base, 'codex-elsewhere') } };
  for (const now of [1000, 9000]) await applyAgents(moved, tools, [], { now });
  assert.equal((await itemOf(box))!.on, true);
  assert.match(await readFile(join(box.base, 'codex-elsewhere/agents/reviewer.toml'), 'utf8'), /Be brief/);
  assert.ok(await readOf(box, 'copilot-cli'));
});

inBox('With Automatic sync off, a click’s pass doesn’t settle a folder reset for the agents it leaves alone: the next full pass still puts their copies back', async box => {
  await on(box);
  await writeFile(join(box.home, '.claude/agents/writer.md'), claudeAgent('You write docs.\n').replace('name: reviewer', 'name: writer'));
  await applyAgents(box.context, tools, [{ key: 'writer', managed: true, off: [] }]);
  await pass(box);
  await rm(join(box.home, '.codex/agents'), { recursive: true });
  await mkdir(join(box.home, '.codex/agents'));
  // Sync off: a click on reviewer concerns reviewer alone.
  const { row, item } = await seen(box);
  await applyAgents(box.context, tools, [{ key: row.key, managed: true, off: ['copilot-cli'], seenManaged: !!item?.on }], { only: new Set(['reviewer']) });
  assert.deepEqual([await readOf(box, 'codex-cli') !== undefined, await readFile(join(box.home, '.codex/agents/writer.toml'), 'utf8').catch(() => undefined)], [true, undefined]);
  for (const now of [1000, 9000]) await applyAgents(box.context, tools, [], { now });
  const view = await agentsView(box.context, tools);
  assert.equal(view.library!.writer.on, true, 'writer was not deleted by hand: its folder was made again');
  assert.match(await readFile(join(box.home, '.codex/agents/writer.toml'), 'utf8'), /You write docs/);
});

inBox('A harness that can’t hold the agent (its name is no file name there) is passed over: no copy, no result, and its mark says why', async box => {
  await writeFile(join(box.home, '.claude/agents/réviseur.md'), '---\nname: réviseur\ndescription: Relit\n---\n\nRelis.\n');
  const taken = await applyAgents(box.context, tools, [{ key: 'réviseur', managed: true, off: [], seenManaged: false }]);
  assert.deepEqual([taken.writes, taken.results], [0, []]);
  assert.deepEqual(await readdir(join(box.home, '.copilot/agents')), []);
  const fact = (await agentsView(box.context, tools)).servers.find(agent => agent.key === 'réviseur')!;
  const why = (tool: string) => `${tool} can’t store this name (é). Rename the agent to use it there.`;
  assert.deepEqual([fact.managed, fact.cannot], [true, { 'copilot-cli': why('Copilot CLI'), 'codex-cli': why('Codex') }]);
  assert.equal((await pass(box)).writes, 0);
});

// ---------- Found agents ----------

inBox('An agent a harness has that Central Knot doesn’t is found: never written by itself; its switch takes it in everywhere', async box => {
  await write(box, 'claude-cli', claudeAgent());
  await write(box, 'claude-cli', claudeAgent());
  await writeFile(join(box.home, '.claude/agents/broken.md'), 'no frontmatter');
  await writeFile(join(box.home, '.codex/agents/bad.toml'), 'name = ');
  const view = await agentsView(box.context, tools);
  assert.deepEqual([view.servers.map(agent => agent.key), view.problems.length], [['reviewer'], 2], 'unreadable files are reported, not offered');
  assert.deepEqual([placeOf(await itemOf(box)), await marks(box)], ['found', { 'claude-cli': 'own-copy', 'copilot-cli': 'none', 'codex-cli': 'none' }]);
  assert.equal((await pass(box)).writes, 0);
  assert.deepEqual(await readdir(join(box.home, '.copilot/agents')), []);
  const taken = await turnOn(box);
  // Taking in has no click that puts things back as they were, so its result offers no Undo (History's entry has Turn off).
  assert.deepEqual(taken !== 'choose' && [taken.writes, taken.made], [2, []]);
  assert.deepEqual([placeOf(await itemOf(box)), await versions(box)], ['on', ['Be brief. (found in Claude Code) *']]);
});

inBox('Found copies that differ: the switch asks; the chosen copy is taken in, and the others become versions', async box => {
  await write(box, 'claude-cli', claudeAgent());
  await write(box, 'codex-cli', codexAgent('You review code.\nBe quick.\n'));
  await utimes(fileOf(box, 'codex-cli'), new Date(), new Date(Date.now() + 5000));
  assert.equal(await turnOn(box), 'choose');
  const unanswered = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false }]);
  assert.deepEqual(unanswered.results.map(entry => [entry.outcome, entry.differs]), [['held', true]]);
  assert.equal(await itemOf(box), undefined, 'nothing is taken in without an answer');
  // A choice made on a page read before the chosen copy changed is refused.
  const { row } = await seen(box);
  await write(box, 'codex-cli', codexAgent('You review code.\nBe late.\n'));
  const stale = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'codex-cli', useHash: row.hashes!['codex-cli'] }]);
  assert.deepEqual([stale.results.map(entry => [entry.outcome, entry.chooseAgain]), await itemOf(box)], [[['held', true]], undefined]);
  await write(box, 'codex-cli', codexAgent('You review code.\nBe quick.\n'));
  await utimes(fileOf(box, 'codex-cli'), new Date(), new Date(Date.now() + 5000));
  await choose(box, 'codex-cli');
  assert.match((await readOf(box, 'claude-cli'))!, /Be quick\./);
  assert.deepEqual(await versions(box), ['Be quick. (chosen from Codex) *', 'Be brief. (was in Claude Code)']);
  // A library item never waits for a choice, and History can make the other copy's version current.
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['chosen: Use claude-cli’s']);
  await actions[0].run();
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  // The choice's entry stays open: what it offers is whatever would still change something (now nothing), and the version
  // made current has its own Undo.
  assert.equal((await historyOf(box)).find(event => event.kind === 'chosen')!.undoneBy, undefined);
  assert.deepEqual((await historyActions(box)).map(action => `${action.event.kind}: ${action.label}`), ['current: Undo']);
});

// ---------- Versions ----------

inBox('Make current on an earlier version is a new version, applied like any other; every version is kept', async box => {
  await on(box);
  for (const line of ['Edit one.', 'Edit two.', 'Edit three.']) { await edit(box, 'claude-cli', line); await pass(box); }
  const first = (await itemOf(box))!.versions.at(-1)!.hash;
  const made = await makeCurrent(box, first);
  assert.equal(made.writes, 3);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  assert.equal((await versions(box)).length, 5);
  assert.deepEqual((await versions(box))[0], 'Be brief. (made current again) *');
  assert.match((await makeCurrent(box, first)).results[0].message, /at that version already/);
  // Its Undo, from the result or from History, makes the one before current again.
  await undo(box, made);
  assert.match((await readOf(box, 'codex-cli'))!, /Edit three\./);
  assert.equal((await pass(box)).writes, 0);
});

// ---------- Delete from Central Knot ----------

inBox('Delete removes the agent from every harness and leaves a tombstone: a stale copy is found, never taken in by itself; History restores it', async box => {
  await write(box, 'codex-cli', codexAgent());
  await on(box, claudeAgent(undefined, claudeOwn));
  const before = await filesOf(box);
  assert.equal((await deleteIt(box)).writes, 3);
  assert.deepEqual([(await seen(box)).fact, !!(await itemOf(box))?.deleted], [undefined, true], 'no row; the library keeps it, deleted');
  // A copy that turns up (a backup restored, another machine's sync) is found, and nothing spreads.
  await write(box, 'copilot-cli', before['copilot-cli']!);
  assert.equal((await pass(box)).writes, 0);
  assert.equal(placeOf(await itemOf(box)), 'found');
  await rm(fileOf(box, 'copilot-cli'));
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['deleted: Restore']);
  await actions[0].run();
  assert.deepEqual(await filesOf(box), before, 'every file as it was');
  assert.deepEqual((await historyActions(box)).map(action => action.label), ['Turn off']);
});

// ---------- A removal never takes content the library doesn't have ----------

inBox('Off with Automatic sync off, after an edit no pass has seen: the edit is a version before its file goes', async box => {
  await on(box);
  await edit(box, 'codex-cli', 'Edit unseen.');
  // Sync off: the click's pass concerns this agent alone, and no pass ran since the edit.
  const { row, item } = await seen(box);
  const off = await applyAgents(box.context, tools, [{ key: row.key, managed: false, off: item!.except, seenManaged: true }], { only: new Set(['reviewer']) });
  assert.equal(off.writes, 3);
  assert.deepEqual(await versions(box), ['Edit unseen. (edited in Codex)', 'Be brief. (found in Claude Code) *']);
});

inBox('An edit saved between the read and the removal stays where it is, and is a version before the next pass removes it', async box => {
  await on(box);
  let saved = false;
  const racing: ShareContext = { ...box.context, fault: step => { if (step === 'before-remove' && !saved) { saved = true; writeFileSync(fileOf(box, 'claude-cli'), claudeAgent('You review code.\nEdit late.\n')); } } };
  const off = await turnOff(box, racing);
  assert.match(off.results.find(entry => entry.harness === 'claude-cli')!.message, /changed just now/);
  assert.match((await readOf(box, 'claude-cli'))!, /Edit late\./, 'the save is not lost');
  await pass(box);
  assert.deepEqual([await readOf(box, 'claude-cli'), await versions(box)], [undefined, ['Edit late. (edited in Claude Code)', 'Be brief. (found in Claude Code) *']]);
});

// ---------- A crash in the middle ----------

const crashAt = (box: Box, step: string, nth = 1): ShareContext => { let seenTimes = 0; return { ...box.context, fault: at => { if (at === step && ++seenTimes === nth) throw new Error(`crash at ${step}`); } }; };
/** Every content any harness held at any point of the test, by its prompt's last line: each must be a version or on disk at the end. */
const lastLines = async (box: Box) => new Set([...Object.values(await filesOf(box)).filter(Boolean).map(text => text!.match(/(Be \w+\.|Edit \w+\.)/)![0]), ...(await versions(box)).map(line => line.split(' (')[0])]);

inBox('A crash before a removal during Off: after restart the agent is Off, every content is a version, and the next pass finishes', async box => {
  await write(box, 'codex-cli', codexAgent());
  await on(box, claudeAgent(undefined, claudeOwn));
  await edit(box, 'copilot-cli', 'Edit unseen.');
  const before = await filesOf(box);
  await assert.rejects(turnOff(box, crashAt(box, 'before-remove', 2)), /crash at before-remove/);
  assert.deepEqual([...await lastLines(box)].sort(), ['Be brief.', 'Edit unseen.']);
  assert.equal((await itemOf(box))!.on, false, 'the Off was recorded before any file went');
  await pass(box);
  assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined });
  assert.equal((await pass(box)).writes, 0);
  // And On still writes each harness's own file back (the edit that was never taken in is a version, not the current one).
  await turnOn(box);
  assert.deepEqual([(await filesOf(box))['claude-cli'], (await filesOf(box))['codex-cli']], [before['claude-cli'], before['codex-cli']]);
});

inBox('A crash before a write during On, and while an edit is taken in: after restart every content is a version and the next pass settles', async box => {
  await on(box);
  await turnOff(box);
  await assert.rejects(turnOn(box, crashAt(box, 'before-rename', 2)), /crash at before-rename/);
  assert.equal((await itemOf(box))!.on, true);
  assert.ok((await pass(box)).writes > 0);
  assert.deepEqual(Object.values(await filesOf(box)).map(text => /Be brief\./.test(text ?? '')), [true, true, true]);
  // Taking in an edit: it is the current version before any other harness is written.
  await edit(box, 'codex-cli', 'Edit one.');
  await assert.rejects(pass(box, crashAt(box, 'before-rename')), /crash at before-rename/);
  assert.deepEqual(await versions(box), ['Edit one. (edited in Codex) *', 'Be brief. (found in Claude Code)']);
  assert.equal((await pass(box)).writes, 2);
  assert.equal((await pass(box)).writes, 0);
  assert.deepEqual([...await lastLines(box)].sort(), ['Be brief.', 'Edit one.']);
});

inBox('A crash after the record is saved leaves the click in History: a Delete can still be restored, an Off turned on, an edit undone', async box => {
  await write(box, 'codex-cli', codexAgent());
  await on(box, claudeAgent(undefined, claudeOwn));
  const before = await filesOf(box);
  const offered = async () => (await historyActions(box)).map(action => `${action.event.kind}: ${action.label}`);
  await assert.rejects(deleteIt(box, crashAt(box, 'before-remove')), /crash at before-remove/);
  await pass(box);
  assert.deepEqual([await filesOf(box), (await seen(box)).fact], [{ 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined }, undefined]);
  assert.deepEqual(await offered(), ['deleted: Restore']);
  await (await historyActions(box))[0].run();
  assert.deepEqual(await filesOf(box), before, 'Restore puts every file back');
  await assert.rejects(turnOff(box, crashAt(box, 'before-remove')), /crash at before-remove/);
  assert.equal((await offered()).at(-1), 'off: Turn on');
  await pass(box);
  await (await historyActions(box)).find(action => action.label === 'Turn on')!.run();
  await edit(box, 'codex-cli', 'Edit one.');
  await assert.rejects(pass(box, crashAt(box, 'before-rename')), /crash at before-rename/);
  assert.equal((await offered()).at(-1), 'edit: Undo');
});

// ---------- The record, and the things around it ----------

inBox('A damaged, unreadable or newer agents record stops every write and is never rewritten; a missing one is a first run', async box => {
  await on(box);
  const recordFile = join(box.home, '.central-knot/agents.json');
  const good = await readFile(recordFile, 'utf8');
  await edit(box, 'claude-cli', 'Be thorough.');
  const before = await filesOf(box);
  const turnedOn = (await readHistory(box.context)).at(-1)!;
  const bad: [string, RegExp][] = [
    ['{"formatVersion": 3, "items": {', /The agents record is damaged\. Nothing was written or deleted/],
    [JSON.stringify({ formatVersion: 3, items: 'none' }), /The agents record is damaged\./],
    [JSON.stringify({ formatVersion: 3, items: { reviewer: { name: 'reviewer', on: true } } }), /The agents record is damaged\./],
    [JSON.stringify({ formatVersion: 2, items: { reviewer: { name: 'reviewer', state: 'shared', off: [] } } }), /The agents record is damaged\./],
    [JSON.stringify({ items: {} }), /The agents record is damaged\./],
    [JSON.stringify({ ...JSON.parse(good), formatVersion: 4 }), /The agents record was written by a newer Central Knot\. Nothing was written or deleted/],
  ];
  for (const [text, reason] of bad) {
    await writeFile(recordFile, text);
    assert.match((await pass(box)).stopped ?? '', reason);
    assert.match((await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [] }])).stopped ?? '', reason);
    assert.match((await restoreAgent(box.context, tools, turnedOn.id)).stopped ?? '', reason);
    const view = await agentsView(box.context, tools);
    assert.deepEqual(view.servers.map(agent => agent.key), ['reviewer'], 'the page still reads');
    assert.ok(view.gate.state === 'stopped' && reason.test(view.gate.reason));
    assert.equal(await readFile(recordFile, 'utf8'), text, 'the record is left as it is');
    assert.deepEqual(await filesOf(box), before, 'no agent file changed');
  }
  await rm(recordFile);
  await mkdir(recordFile);
  assert.match((await pass(box)).stopped ?? '', /The agents record could not be read\. Nothing was written or deleted/);
  await rm(recordFile, { recursive: true });
  await writeFile(recordFile, good);
  assert.equal((await pass(box)).stopped, undefined);
  assert.match((await readOf(box, 'copilot-cli'))!, /Be thorough\./, 'with the record back, the edit spreads');
});

inBox('With an intact record this app has no memory of, a click stops until an explicit Resume, which keeps the record and remembers it', async box => {
  await on(box);
  const generation = (await readRecord(box.home)).record!.generation;
  await rm(join(box.base, 'settings.json'));
  assert.equal((await syncGate(box.context)).state, 'needs-resume');
  const blocked = await turnOff(box);
  assert.deepEqual([/no memory/.test(blocked.stopped ?? ''), blocked.writes], [true, 0]);
  const { row, item } = await seen(box);
  const resumed = await applyAgents(box.context, tools, [{ key: row.key, managed: false, off: item!.except }], { resume: true });
  assert.deepEqual([resumed.stopped, resumed.writes], [undefined, 3]);
  assert.equal((await readRecord(box.home)).record!.generation, generation);
  assert.equal((await syncGate(box.context)).state, 'ready');
});

inBox('A page read before the agent changed is refused, and nothing is written', async box => {
  await on(box);
  const stale = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false }]);
  assert.deepEqual(stale.results.map(entry => [entry.outcome, entry.unchanged, /changed since the page was read/.test(entry.message)]), [['held', true, true]]);
  assert.equal(stale.made?.length, 0);
});

inBox('Every click is one History entry, and its Undo is that entry’s own action', async box => {
  await on(box);
  const off = await turnOff(box);
  assert.deepEqual((await historyOf(box)).map(event => [event.kind, event.losers.map(loser => loser.tool)]), [['on', ['copilot-cli', 'codex-cli']], ['off', tools]]);
  await undo(box, off);
  assert.deepEqual([(await itemOf(box))!.on, (await filesOf(box))['codex-cli'] !== undefined], [true, true]);
  const out = await keepOut(box, 'copilot-cli');
  assert.deepEqual((await historyOf(box)).at(-1), { ...(await historyOf(box)).at(-1)!, kind: 'off', only: 'copilot-cli', losers: [{ tool: 'copilot-cli', hash: (await itemOf(box))!.hash }] });
  await undo(box, out);
  assert.deepEqual((await itemOf(box))!.except, []);
  assert.ok(await readOf(box, 'copilot-cli'));
});

test('Convert to skill: an agent becomes a Pi skill once, with where it came from recorded; it is never placed back in the agent’s tool', async () => {
  const box = await sandbox();
  try {
    const { manageView, applyChanges } = await import('../src/manage.ts');
    const { discover } = await import('../src/discovery.ts');
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    await write(box, 'claude-cli', claudeAgent('You review code.\n', 'model: opus\n'));
    const withPi: HarnessId[] = ['claude-cli', 'pi-cli'];
    const context = { ...box.context, read: () => Promise.all(withPi.map(harness => discover({ home: box.home, mode: 'custom', harness }))) };
    assert.equal((await convertAgentToSkill(context, withPi, 'reviewer')).stopped, undefined);
    assert.match(await readFile(join(box.home, '.pi/agent/skills/reviewer/SKILL.md'), 'utf8'), /^---\nname: "reviewer"\ndescription: "Reviews code"\n---\n\nYou review code\.\n$/);
    assert.match((await convertAgentToSkill(context, withPi, 'reviewer')).stopped ?? '', /already has a skill/);
    await applyChanges({ ...context, settleMs: 0 }, [{ key: 'reviewer', managed: true, off: [] }]);
    const facts = (await manageView(context)).skills.find(item => item.key === 'reviewer')!;
    assert.match(facts.cannot['claude-cli'] ?? '', /Converted from Claude Code’s agent/);
    assert.ok(facts.converted?.losses.some(loss => /model/.test(loss)));
    assert.equal(await readOf(box, 'claude-cli'), claudeAgent('You review code.\n', 'model: opus\n'), 'the agent is unchanged');
  } finally { await box.cleanup(); }
});
