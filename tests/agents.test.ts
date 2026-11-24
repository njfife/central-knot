// Agents on the library, as worked examples on real files in a temp home (src/agents.ts; the model is src/library.ts).
// One agent, "reviewer", in Claude Code, Copilot CLI and Codex; every click is sent as the Library sends it
// (tests/agentclicks.ts). In order: the harnesses' formats, Off and On, edits and deletions by hand, copies that can't be
// seen, found agents, versions, Delete, and what a crash or a damaged record leaves. Agents are the pass's worked kind, so its
// own rules (src/librarypass.ts: the folder guards, the settle window, the gate, the order of steps) are exampled here.
import { test } from 'node:test';
import { bandAfter, itemNotice } from './notices.ts';
import assert from 'node:assert/strict';
import fs, { mkdir, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { lockSkip, withLock } from './fslock.ts';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentText, readAgents } from '../src/agentfiles.ts';
import { agentVersion, agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { rowClicks, harnessIs, placeOf, libraryWords, sentences } from '../src/libraryrow.ts';
import { clickResults } from '../src/clickplan.ts';
import { librarySentence } from '../src/historyactions.ts';
import { listed, originWords } from '../src/library.ts';
import { readHistory } from '../src/history.ts';
import { setSyncEverything } from '../src/everything.ts';
import { homePass, passTells } from '../src/homepass.ts';
import { forgetMissing } from '../src/librarypass.ts';
import { readRecord, syncGate, type ShareContext } from '../src/share.ts';
import { readTomlTables } from '../src/textedit.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { HarnessId, PassResult } from '../src/types.ts';
import { choose, claudeAgent, claudeOwn, codexAgent, deleteIt, fileOf, filesOf, historyActions, historyOf, itemOf, keepOut, makeCurrent, pass, readOf, sandbox, seen, tools, trial, turnOff, turnOn, undo, write, type Box, type Tool } from './agentclicks.ts';

const { harnessLine, noticeWords, said } = sentences(libraryWords.agents);
const inBox = (name: string, body: (box: Box) => Promise<void>, options: { skip?: boolean | string } = {}) => test(name, options, async () => { const box = await sandbox(); try { await body(box); } finally { await box.cleanup(); } });
/** An agent written in Claude Code, taken into Central Knot and applied to every harness. */
async function on(box: Box, text = claudeAgent()) { await write(box, 'claude-cli', text); assert.notEqual(await turnOn(box), 'choose'); }
/** Each version of the agent as the opened row lists it (library.ts listed): its prompt's last line and where it came from, the current one first. */
async function versions(box: Box) {
  const item = (await itemOf(box))!;
  const lastLine = async (hash: string) => (await agentVersion(box.context, 'reviewer', hash))!.prompt.trim().split('\n').at(-1);
  return Promise.all(listed(item).map(async (version, index) => `${await lastLine(version.hash)} (${originWords(version.from)})${index === 0 && version.hash === item.hash ? ' *' : ''}`));
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

inBox('A description of several lines is written as a block indented under its key, so every tool reads it back as it was', async box => {
  const description = 'Use this agent when a change needs a review.\n\nExamples: a pull request.';
  await on(box, claudeAgent().replace('description: Reviews code', `description: ${JSON.stringify(description)}`));
  assert.match((await readOf(box, 'copilot-cli'))!, /^---\nname: reviewer\ndescription: \|-\n {2}Use this agent when a change needs a review\.\n\n {2}Examples: a pull request\.\n---\n/);
  for (const tool of tools as Tool[]) assert.equal((await readAgents(box.context, tool)).entries[0]?.agent.description, description, tool);
  assert.equal((await pass(box)).writes, 0);
});

test('What is written for a description reads back as exactly that description, whatever its trailing newlines: the first pass makes no version nobody made, and the second writes nothing', async () => {
  // Claude Code's front matter in each layout a person writes, and Codex's own form, each taken in and spread to the others, Pi too.
  const claude = (description: string) => `---\nname: reviewer\n${description}---\n\nYou review code.\n`;
  const shapes: [string, Tool, string][] = [
    ['a | block, a blank line, a field', 'claude-cli', claude('description: |\n  Use this agent when code changes.\n\n  Examples: a PR.\n\ntools: Read\n')],
    ['a | block, a blank line, the end', 'claude-cli', claude('description: |\n  Use this agent when code changes.\n\n  Examples: a PR.\n\n')],
    ['a > block, a blank line, a field', 'claude-cli', claude('description: >\n  Use this agent\n  when code changes.\n\ntools: Read\n')],
    ['a |- block, a blank line, a field', 'claude-cli', claude('description: |-\n  Use this agent.\n  Second.\n\ntools: Read\n')],
    ['a |+ block, a field', 'claude-cli', claude('description: |+\n  Kept.\n\ntools: Read\n')],
    ['a |+ block, two blank lines, a field', 'claude-cli', claude('description: |+\n  Kept.\n\n\ntools: Read\n')],
    ['a quoted \\n\\n, a blank line, a field', 'claude-cli', claude('description: "Use this.\\n\\nExamples: a PR."\n\ntools: Read\n')],
    ['a | block, a comment after', 'claude-cli', claude('description: |\n  Use this.\n  Second.\n# a comment\ntools: Read\n')],
    ['a quoted \\n\\n\\n, a field', 'claude-cli', claude('description: "Three\\n\\n\\n"\ntools: Read\n')],
    ['Codex, ending in a blank line', 'codex-cli', 'name = "reviewer"\ndescription = """\nUse this agent.\n\n"""\ndeveloper_instructions = """\nYou review code.\n"""\n'],
    ['Codex, ending in two blank lines', 'codex-cli', 'name = "reviewer"\ndescription = """\nUse this agent.\n\n\n"""\ndeveloper_instructions = """\nYou review code.\n"""\n'],
  ];
  for (const [shape, tool, text] of shapes) {
    const box = await sandbox(true);
    try {
      await write(box, tool, text);
      await turnOn(box);
      const first = await pass(box);
      assert.deepEqual([(await itemOf(box))!.versions.length, first.notices ?? []], [1, []], `${shape}: the first pass made a version nobody made`);
      assert.equal((await pass(box)).writes, 0, `${shape}: the second pass writes`);
      assert.equal(await readOf(box, tool), text, `${shape}: the person’s own file changed`);
    } finally { await box.cleanup(); }
  }
  // Written over a quoted value that only contains `|+`: the blank line after it is the person's separator, and stays.
  assert.equal(agentText('claude-cli', { name: 'reviewer', description: 'Plain', prompt: 'You review code.\n' }, claude('description: "Run: |+ mode"\n\ntools: Read\n')), claude('description: Plain\n\ntools: Read\n'));
  // Written over a file that has one: an edit in Pi to a description ending in blank lines reaches Claude Code's file, where
  // the blank line the person left before `tools` would otherwise join that value; then an edit back to one line takes the
  // block's blank lines with it.
  const box = await sandbox(true);
  try {
    await on(box, claude('description: Reviews code\n\ntools: Read\n'));
    for (const description of ['Reviews code.\n\n\n', 'Reviews code.']) {
      await write(box, 'pi-cli', (await readOf(box, 'pi-cli'))!.replace(/description:[\s\S]*?(?=---\n)/, `description: ${JSON.stringify(description)}\n`));
      await pass(box);
      assert.deepEqual([(await readAgents(box.context, 'claude-cli')).entries[0]?.agent.description, (await pass(box)).writes], [description, 0], JSON.stringify(description));
      assert.match((await readOf(box, 'claude-cli'))!, /\ntools: Read\n---\n/);
    }
  } finally { await box.cleanup(); }
});

inBox('The Library reads an agent as On or Off, with the tools it is kept out of', async box => {
  await on(box);
  await keepOut(box, 'codex-cli');
  assert.deepEqual([(await seen(box)).fact?.on, (await seen(box)).fact?.except], [true, ['codex-cli']]);
  await turnOff(box);
  assert.deepEqual([(await seen(box)).fact?.on, (await seen(box)).fact?.except], [false, ['codex-cli']]);
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

inBox('A description line in Claude Code’s front matter that ends in --- is not the end of it: nothing of the front matter reaches Codex’s prompt', async box => {
  await writeFile(join(box.home, '.claude/agents/rev.md'), '---\nname: rev\ndescription: Reviews code ---\nmodel: sonnet\n---\n\nBody\n');
  await applyAgents(box.context, box.tools, [{ key: 'rev', on: true, except: [] }]);
  const toml = await readFile(join(box.home, '.codex/agents/rev.toml'), 'utf8').catch(() => '');
  assert.ok(!/model: sonnet/.test(toml), `Claude Code's front matter leaked into the prompt:\n${toml}`);
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
  assert.deepEqual([placeOf(item), fact?.on, fact?.description, Object.keys(fact?.copies ?? {})], ['off', false, 'Reviews code', []]);
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
  await chooseTools(box.context, 'claude-cli', false);
  const { row, item } = await seen(box);
  assert.equal((await applyAgents(box.context, without, [{ key: row.key, on: false, except: item!.except, seenOn: true }])).writes, 2);
  assert.deepEqual(await filesOf(box), { 'claude-cli': claudeAgent(), 'copilot-cli': undefined, 'codex-cli': undefined }, 'the harness left out keeps its copy');
  assert.equal((await applyAgents(box.context, without, [{ key: row.key, on: true, except: [], seenOn: false }])).writes, 2);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
});

inBox('A harness managed again: the library wins, and the copy it held is a version first', async box => {
  await on(box);
  await chooseTools(box.context, 'codex-cli', false);
  await edit(box, 'codex-cli', 'Edit away.');
  await chooseTools(box.context, 'codex-cli', true);
  assert.equal((await pass(box)).writes, 1);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  assert.deepEqual(await versions(box), ['Be brief. (found in Claude Code) *', 'Edit away. (was in Codex)']);
});

inBox('An Off agent is in no tool, also after a tool comes back: turned off while one was uninstalled or left out, its copy there goes once it is back', async box => {
  for (const leftOut of [false, true]) {
    await on(box);
    const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
    if (leftOut) await chooseTools(box.context, 'codex-cli', false); else await applyAgents(box.context, without, []);
    const { row, item } = await seen({ ...box, tools: without });
    await applyAgents(box.context, without, [rowClicks.off(row, item)]);
    assert.ok(await readOf(box, 'codex-cli'), 'a tool not managed is not touched');
    if (leftOut) await chooseTools(box.context, 'codex-cli', true);
    await pass(box);
    assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined }, leftOut ? 'left out' : 'uninstalled');
    assert.equal((await marks(box))['codex-cli'], 'none');
    await turnOn(box);
  }
});

inBox('A tool managed again, with a click’s pass on another agent first: the agents that pass left alone are written there afresh, never read as deleted by hand', async box => {
  // helper and reviewer, On in all three tools.
  await writeFile(join(box.home, '.claude/agents/helper.md'), claudeAgent('You help.\n').replace('name: reviewer', 'name: helper'));
  await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: [] }]);
  await on(box);
  for (const leftOut of [false, true]) {
    const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
    if (leftOut) await chooseTools(box.context, 'codex-cli', false); else await applyAgents(box.context, without, []);
    // reviewer's Codex copy goes while Codex is out.
    await rm(fileOf(box, 'codex-cli'));
    if (leftOut) await chooseTools(box.context, 'codex-cli', true);
    // Codex is back. With Automatic sync off, a click on helper runs a pass about helper alone; then the next full pass.
    await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: ['copilot-cli'] }], { only: new Set(['helper']) });
    const done = await pass(box);
    assert.deepEqual([done.notices, (await itemOf(box))!.on, !!(await readOf(box, 'codex-cli'))], [[], true, true], leftOut ? 'left out' : 'uninstalled');
    await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: [] }]);
  }
});

inBox('A tool managed again, with a click on another agent first: an Off agent whose copy went meanwhile turns On, and stays On', async box => {
  await writeFile(join(box.home, '.claude/agents/helper.md'), claudeAgent('You help.\n').replace('name: reviewer', 'name: helper'));
  await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: [] }]);
  await on(box);
  for (const leftOut of [false, true]) {
    const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
    if (leftOut) await chooseTools(box.context, 'codex-cli', false); else await applyAgents(box.context, without, []);
    // reviewer is turned Off while Codex is out, and its Codex copy goes meanwhile.
    const away = await seen({ ...box, tools: without });
    await applyAgents(box.context, without, [rowClicks.off(away.row, away.item)]);
    await rm(fileOf(box, 'codex-cli'));
    if (leftOut) await chooseTools(box.context, 'codex-cli', true);
    // Codex is back. With Automatic sync off, a click on helper runs a pass about helper alone; then reviewer is turned On.
    await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: ['copilot-cli'] }], { only: new Set(['helper']) });
    const back = await seen(box);
    const done = await applyAgents(box.context, tools, [rowClicks.on(back.row, back.item)], { only: new Set(['reviewer']) });
    assert.deepEqual([done.notices, (await itemOf(box))!.on], [[], true], leftOut ? 'left out' : 'uninstalled');
    assert.deepEqual(Object.values(await filesOf(box)).map(text => /Be brief\./.test(text ?? '')), [true, true, true]);
    await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: [] }]);
  }
});

for (const kept of ['Off', 'kept out of it'] as const) {
  inBox(`A tool managed again with another file of the name of an agent that is ${kept}: it is kept as a version, the current one stays, and the file goes`, async box => {
    await on(box);
    const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
    await chooseTools(box.context, 'codex-cli', false);
    const { row, item } = await seen({ ...box, tools: without });
    const click = kept === 'Off' ? rowClicks.off(row, item) : rowClicks.inHarness(row, item!, 'codex-cli', true);
    await applyAgents(box.context, without, [click]);
    // Codex, out of Central Knot's hands meanwhile, gets a hand-made agent of the same name.
    await write(box, 'codex-cli', codexAgent('Someone else entirely.\n'));
    await chooseTools(box.context, 'codex-cli', true);
    assert.deepEqual((await pass(box)).notices, []);
    assert.equal(await readOf(box, 'codex-cli'), undefined);
    const record = (await agentsView(box.context, tools)).library!.reviewer;
    assert.deepEqual(record.versions.map(version => [originWords(version.from), version.hash === record.hash]), [['was in Codex', false], ['found in Claude Code', true]]);
    assert.ok(!(await historyOf(box)).some(event => event.kind === 'edit'), 'no edit was taken in');
  });
}

inBox('A tool managed again with another file of the name of an agent deleted from Central Knot: it is a found agent, left alone', async box => {
  await on(box);
  const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
  await chooseTools(box.context, 'codex-cli', false);
  const { row, item } = await seen({ ...box, tools: without });
  await applyAgents(box.context, without, [rowClicks.remove(row, item)]);
  // Codex, out of Central Knot's hands meanwhile, gets a hand-made agent of the same name.
  await write(box, 'codex-cli', codexAgent('Someone else entirely.\n'));
  await chooseTools(box.context, 'codex-cli', true);
  assert.deepEqual((await pass(box)).writes, 0);
  assert.equal(await readOf(box, 'codex-cli'), codexAgent('Someone else entirely.\n'));
  const view = await agentsView(box.context, tools), record = view.library!.reviewer;
  assert.deepEqual([!!record.deleted, record.versions.map(version => originWords(version.from))], [true, ['found in Claude Code']], 'the tombstone gains nothing');
  assert.deepEqual([placeOf(record), view.items.find(agent => agent.key === 'reviewer')?.copies['codex-cli'] !== undefined], ['found', true]);
  // The copy Central Knot put there, left as it was, is still its own to remove.
  await rm(fileOf(box, 'codex-cli'));
  await on(box);
  await chooseTools(box.context, 'codex-cli', false);
  const again = await seen({ ...box, tools: without });
  await applyAgents(box.context, without, [rowClicks.remove(again.row, again.item)]);
  await chooseTools(box.context, 'codex-cli', true);
  await pass(box);
  assert.equal(await readOf(box, 'codex-cli'), undefined);
});

for (const state of ['Off', 'On, with a click on another agent first'] as const) {
  inBox(`A tool managed again before its agents folder is there (${state}): the folder that appears later with another file of the agent’s name is the tool coming back`, async box => {
    await writeFile(join(box.home, '.claude/agents/helper.md'), claudeAgent('You help.\n').replace('name: reviewer', 'name: helper'));
    await on(box);
    const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
    await chooseTools(box.context, 'codex-cli', false);
    const away = await seen({ ...box, tools: without });
    if (state === 'Off') await applyAgents(box.context, without, [rowClicks.off(away.row, away.item)]);
    await rm(join(box.home, '.codex/agents'), { recursive: true });
    await chooseTools(box.context, 'codex-cli', true);
    // The first pass after Codex is back, with no agents folder there: a plain one, or (Sync off) a click on helper alone.
    if (state === 'Off') await pass(box);
    else await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: ['codex-cli'] }], { only: new Set(['helper']) });
    await mkdir(join(box.home, '.codex/agents'));
    await write(box, 'codex-cli', codexAgent('Someone else entirely.\n'));
    assert.deepEqual((await pass(box)).notices, []);
    assert.deepEqual(await versions(box), ['Be brief. (found in Claude Code) *', 'Someone else entirely. (was in Codex)']);
    assert.equal(await readOf(box, 'codex-cli'), state === 'Off' ? undefined : codexAgent());
    assert.match((await readOf(box, 'claude-cli')) ?? 'Be brief.', /Be brief\./, 'the hand-made file reached no other tool');
    assert.ok(!(await historyOf(box)).some(event => event.kind === 'edit'), 'no edit was taken in');
  });
}

for (const state of ['On', 'Off', 'On, with a click on another agent first'] as const) {
  inBox(`A tool managed again with a copy edited meanwhile (${state}): the page says it is kept first, and History says it gave way and can make it current`, async box => {
    await writeFile(join(box.home, '.claude/agents/helper.md'), claudeAgent('You help.\n').replace('name: reviewer', 'name: helper'));
    await on(box);
    const codexBefore = await readOf(box, 'codex-cli');
    const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
    await chooseTools(box.context, 'codex-cli', false);
    const away = await seen({ ...box, tools: without });
    if (state === 'Off') await applyAgents(box.context, without, [rowClicks.off(away.row, away.item)]);
    await edit(box, 'codex-cli', 'Edit away.');
    await chooseTools(box.context, 'codex-cli', true);
    const before = await seen(box);
    assert.match(harnessLine(before.row, before.item, 'codex-cli', 'Codex'), /kept as a version/, 'the page says so before the pass');
    if (state === 'On, with a click on another agent first') {
      // With Automatic sync off, a click on helper runs a pass about helper alone: reviewer's copy is kept and told already.
      await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: ['copilot-cli'] }], { only: new Set(['helper']) });
      assert.match((await readOf(box, 'codex-cli'))!, /Edit away\./, 'not written over by a pass about helper');
    }
    await pass(box);
    assert.equal(await readOf(box, 'codex-cli'), state === 'Off' ? undefined : codexBefore);
    const kept = (await historyOf(box)).filter(event => event.kind === 'kept-edit');
    assert.deepEqual(kept.map(event => [event.cause, event.losers.map(loser => loser.tool)]), [['tool-back', ['codex-cli']]]);
    assert.equal(librarySentence(kept[0], libraryWords.agents, tools)?.text, 'Codex’s copy changed while Central Knot didn’t manage Codex; it gave way to the current version and is kept as a version.');
    const use = (await historyActions(box)).find(action => action.event.id === kept[0].id && action.label === 'Use codex-cli’s');
    assert.ok(use, 'History offers that copy back');
    await use.run();
    assert.equal((await versions(box))[0].startsWith('Edit away. (made current again)'), true);
  });
}

inBox('A tool managed again with a copy gone meanwhile turns nothing Off, whatever the settle window', async box => {
  await on(box);
  await chooseTools(box.context, 'codex-cli', false);
  await rm(fileOf(box, 'codex-cli'));
  await chooseTools(box.context, 'codex-cli', true);
  const waiting = { ...box.context, settleMs: 2000 };
  for (const now of [1000, 9000]) assert.deepEqual((await applyAgents(waiting, tools, [], { now })).notices, []);
  assert.equal((await itemOf(box))!.on, true);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
});

inBox('Off clicked while a tool’s agents folder has been gone past the settle window: its copy goes when the folder comes back', async box => {
  await on(box);
  await rename(join(box.home, '.codex/agents'), join(box.home, '.codex/agents-away'));
  const waiting = { ...box.context, settleMs: 2000 }, far = Date.now() + 1e9;
  await applyAgents(waiting, tools, [], { now: far });
  const { row, item } = await seen(box);
  await applyAgents(waiting, tools, [rowClicks.off(row, item)], { now: far + 5000 });
  await rename(join(box.home, '.codex/agents-away'), join(box.home, '.codex/agents'));
  await pass(box);
  assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined });
});

inBox('A harness uninstalled changes nothing: its copy deleted meanwhile, installed again, it gets the agent back and nothing turns Off', async box => {
  await on(box);
  const without: HarnessId[] = ['claude-cli', 'copilot-cli'];
  // Uninstalled (not left out by the tool choice): passes run without it.
  assert.equal((await applyAgents(box.context, without, [])).writes, 0);
  await rm(fileOf(box, 'codex-cli'));
  const back = await pass(box);
  assert.deepEqual([back.writes, (await itemOf(box))!.on, back.notices], [1, true, []]);
  assert.match((await readOf(box, 'copilot-cli'))!, /Be brief/);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
});

inBox('A harness installed later gets an On agent from the pass of the whole home, and the Caught up band names the agent and that harness alone, once; an edit spread is its notice’s to tell', async box => {
  // Codex uninstalled while reviewer is turned on: the click writes it into Copilot CLI.
  box.tools = ['claude-cli', 'copilot-cli'];
  await on(box);
  // Codex is installed again: the next pass writes reviewer there by itself, and the band names Codex alone.
  box.tools = [...tools];
  const wholeHome = async () => (await homePass(box.context, box.tools, true)).synced!;
  assert.deepEqual(bandAfter(await wholeHome()), { items: ['reviewer'], tools: ['codex-cli'] });
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
  // A pass with nothing to write tells nothing: the next view has no band.
  assert.deepEqual(bandAfter(await wholeHome()), { items: [], tools: [] });
  // An edit in Claude Code spreads: the Library's notice says so, so the band leaves reviewer out.
  await edit(box, 'claude-cli', 'Be thorough.');
  const edited = await wholeHome();
  assert.deepEqual([edited.agents?.notices?.map(itemNotice).map(notice => notice.kind), edited.agents?.writes], [['edit'], 2]);
  assert.deepEqual(bandAfter(edited), { items: [], tools: [] });
});

// ---------- Edits and deletions by hand ----------

inBox('An edit in a harness becomes the current version, from that harness, and reaches the others; its Undo makes the earlier one current', async box => {
  await on(box);
  await edit(box, 'codex-cli', 'Be exact.');
  const spread = await pass(box);
  assert.deepEqual(spread.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner, notice.losers]), [['edit', 'codex-cli', ['claude-cli', 'copilot-cli']]]);
  assert.deepEqual(await versions(box), ['Be exact. (edited in Codex) *', 'Be brief. (found in Claude Code)']);
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['on: Turn it off', 'edit: Undo']);
  await actions[1].run();
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  // The list has each content once: the found entry is folded into the one made current again, which names it ("back to:").
  assert.deepEqual(await versions(box), ['Be brief. (made current again) *', 'Be exact. (edited in Codex)']);
  assert.equal((await itemOf(box))!.versions.length, 3);
  // Each says what it changed from the version current before it.
  assert.deepEqual((await seen(box)).fact?.versionChanges, [{ changed: ['prompt'] }, { changed: ['prompt'] }]);
  // A write keeps what it wrote as that tool's own part: the next pass changes nothing, not even the record.
  const record = () => readFile(join(box.home, '.central-knot/agents.json'), 'utf8');
  const was = await record();
  assert.deepEqual([(await pass(box)).writes, await record()], [0, was]);
});

inBox('Two edits: the latest wins, the other is a version, and History can make it current', async box => {
  await on(box);
  await edit(box, 'claude-cli', 'Edit one.', 5);
  await edit(box, 'codex-cli', 'Edit two.', 9);
  const settled = await pass(box);
  assert.deepEqual(settled.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner, notice.losers]), [['conflict', 'codex-cli', ['claude-cli']]]);
  assert.match((await readOf(box, 'claude-cli'))!, /Edit two\./);
  assert.deepEqual(await versions(box), ['Edit two. (edited in Codex) *', 'Edit one. (edited in Claude Code)', 'Be brief. (found in Claude Code)']);
  const use = (await historyActions(box)).find(action => action.label === 'Use claude-cli’s')!;
  await use.run();
  assert.match((await readOf(box, 'copilot-cli'))!, /Edit one\./);
});

inBox('Two edits meet: the winner’s note is against the version current before both; the loser, never current, is compared with the winner that took its place', async box => {
  await on(box);
  await write(box, 'claude-cli', (await readOf(box, 'claude-cli'))!.replace('Reviews code', 'Reviews diffs'));
  await utimes(fileOf(box, 'claude-cli'), new Date(), new Date(Date.now() + 5000));
  await edit(box, 'codex-cli', 'Be thorough.', 9);
  await pass(box);
  assert.deepEqual(await versions(box), ['Be thorough. (edited in Codex) *', 'Be brief. (edited in Claude Code)', 'Be brief. (found in Claude Code)']);
  // Codex's edit changed only the prompt of the version current before both; Claude Code's description edit was never current.
  assert.deepEqual((await seen(box)).fact?.versionChanges, [{ changed: ['prompt'] }, { differs: ['description', 'prompt'] }, 'first']);
  // Use this version on the loser, then a new edit: the loser was current once, so the new edit's note is against it.
  await makeCurrent(box, (await itemOf(box))!.versions[1].hash);
  await edit(box, 'copilot-cli', 'Be kind.', 15);
  await pass(box);
  assert.deepEqual((await versions(box)).slice(0, 2), ['Be kind. (edited in Copilot CLI) *', 'Be brief. (made current again)']);
  assert.deepEqual((await seen(box)).fact?.versionChanges, [{ changed: ['prompt'] }, { changed: ['description', 'prompt'] }, { changed: ['prompt'] }, 'first']);
});

inBox('A copy deleted by hand turns the agent Off everywhere, once it has stayed missing for the settle window', async box => {
  await on(box);
  await rm(fileOf(box, 'copilot-cli'));
  const waiting = { ...box.context, settleMs: 2000 };
  const first = await applyAgents(waiting, tools, [], { now: 1000 });
  assert.deepEqual([first.writes, first.settling, (await itemOf(box))!.on], [0, true, true], 'inside the window nothing happens');
  const second = await applyAgents(waiting, tools, [], { now: 3500 });
  assert.deepEqual(second.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner, notice.losers]), [['deleted-by-hand', 'copilot-cli', ['claude-cli', 'codex-cli']]]);
  assert.deepEqual((await historyOf(box)).map(event => event.cause).at(-1), 'deleted-by-hand');
  assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined });
  assert.equal(placeOf(await itemOf(box)), 'off');
  // Central Knot keeps it: History's entry turns it on again, every file as it was.
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['off: Turn it on']);
  await actions[0].run();
  assert.equal(await readOf(box, 'copilot-cli'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\nBe brief.\n');
});

inBox('History’s Turn it on after a copy was deleted by hand gives that tool back its own settings as they were last seen, narrowed ones included', async box => {
  await on(box, claudeAgent(undefined, claudeOwn));
  await turnOff(box);
  await turnOn(box);
  // Claude Code's own settings narrowed by hand since; then its file deleted by hand, which turns the agent off everywhere.
  const narrowed = claudeAgent(undefined, 'tools: Read\nmodel: opus\n');
  await write(box, 'claude-cli', narrowed);
  await pass(box);
  await rm(fileOf(box, 'claude-cli'));
  await pass(box);
  assert.equal(placeOf(await itemOf(box)), 'off');
  await (await historyActions(box)).find(action => action.label === 'Turn it on')!.run();
  assert.equal(await readOf(box, 'claude-cli'), narrowed);
});

inBox('A clock that went back restarts the settle window: it never holds a deletion open', async box => {
  await on(box);
  await rm(fileOf(box, 'copilot-cli'));
  const far = Date.now() + 1e9;
  assert.equal((await applyAgents({ ...box.context, settleMs: 2000 }, tools, [], { now: far })).settling, true);
  // The clock is back where it was: the window starts again from now, and with none to wait the deletion counts.
  await applyAgents(box.context, tools, []);
  assert.equal(placeOf(await itemOf(box)), 'off');
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

inBox('A copy Central Knot has just written, deleted by hand at once, still gets the whole settle window before the agent turns Off', async box => {
  await on(box);
  const waiting = { ...box.context, settleMs: 2000 };
  // Codex's copy goes missing (the window starts for it), then its folder is made again: the next pass writes the copy afresh.
  await rm(fileOf(box, 'codex-cli'));
  await applyAgents(waiting, tools, [], { now: 1000 });
  await rm(join(box.home, '.codex/agents'), { recursive: true });
  await mkdir(join(box.home, '.codex/agents'));
  assert.equal((await applyAgents(waiting, tools, [], { now: 1500 })).writes, 1);
  // Deleted by hand right after: the window starts again from now, not from when the copy first went missing.
  await rm(fileOf(box, 'codex-cli'));
  const inside = await applyAgents(waiting, tools, [], { now: 3100 });
  assert.deepEqual([inside.settling, (await itemOf(box))!.on], [true, true]);
  await applyAgents(waiting, tools, [], { now: 5200 });
  assert.equal((await itemOf(box))!.on, false);
});

inBox('A file seen again in part ends its absence: back half-written at the reread, later away again for a moment, it turns nothing Off', async box => {
  await on(box);
  const text = (await readOf(box, 'codex-cli'))!, waiting = { ...box.context, settleMs: 2000 };
  await rm(fileOf(box, 'codex-cli'));
  assert.equal((await applyAgents(waiting, tools, [], { now: 1000 })).settling, true);
  await write(box, 'codex-cli', 'name = "reviewer"\n');
  await applyAgents(waiting, tools, [], { now: 3500 });
  await write(box, 'codex-cli', text);
  await rm(fileOf(box, 'codex-cli'));
  const brief = await applyAgents(waiting, tools, [], { now: 300_000 });
  assert.deepEqual([brief.settling, (await itemOf(box))!.on], [true, true]);
  await write(box, 'codex-cli', text);
  await applyAgents(waiting, tools, [], { now: 303_000 });
  assert.deepEqual([(await itemOf(box))!.on, (await filesOf(box))['copilot-cli'] !== undefined], [true, true]);
});

inBox('A copy found under its name in another case ends the absence its name in the first case began', async box => {
  await on(box);
  const text = (await readOf(box, 'codex-cli'))!, waiting = { ...box.context, settleMs: 2000 }, renamed = join(box.home, '.codex/agents/Reviewer.toml');
  await rm(fileOf(box, 'codex-cli'));
  assert.equal((await applyAgents(waiting, tools, [], { now: 1000 })).settling, true);
  await writeFile(renamed, text);
  await applyAgents(waiting, tools, [], { now: 1500 });
  await rm(renamed);
  const brief = await applyAgents(waiting, tools, [], { now: 300_000 });
  assert.deepEqual([brief.settling, (await itemOf(box))!.on], [true, true]);
});

inBox('Another home taken forgets when each copy went missing: a copy that came and went while that home was open gets a whole window here', async box => {
  await on(box);
  const text = (await readOf(box, 'codex-cli'))!, waiting = { ...box.context, settleMs: 2000 };
  await rm(fileOf(box, 'codex-cli'));
  assert.equal((await applyAgents(waiting, tools, [], { now: 1000 })).settling, true);
  forgetMissing();
  await write(box, 'codex-cli', text);
  await rm(fileOf(box, 'codex-cli'));
  // This home opened again: the window starts at its first pass, and a deletion that stays still turns the agent Off.
  const back = await applyAgents(waiting, tools, [], { now: 300_000 });
  assert.deepEqual([back.settling, (await itemOf(box))!.on], [true, true]);
  await applyAgents(waiting, tools, [], { now: 302_500 });
  assert.equal((await itemOf(box))!.on, false);
});

inBox('A look at a folder that fails for another reason than “not there” establishes nothing: no window starts or runs on it, and a real absence after it gets the whole window', async box => {
  await on(box);
  // As in this computer's own home: a folder opened as home that can't be looked into is preview only (share.ts writeAccess).
  const waiting: ShareContext = { ...box.context, mode: 'actual', realHome: box.home, allowActualWrites: true, settleMs: 2000 };
  const codex = join(box.home, '.codex'), agents = join(codex, 'agents');
  // Codex's agents folder can't be looked at (no permission on the folder above it): it is not away, so no window starts.
  await withLock(codex, 'dir-unreadable', async () => {
    assert.equal((await applyAgents(waiting, tools, [], { now: 1000 })).settling, false);
  });
  await rm(agents, { recursive: true });
  const away = await applyAgents(waiting, tools, [], { now: 3500 });
  assert.deepEqual([away.settling, away.writes], [true, 0], 'really away now: its window starts now');
  await withLock(codex, 'dir-unreadable', () => applyAgents(waiting, tools, [], { now: 4000 }));
  const again = await applyAgents(waiting, tools, [], { now: 6000 });
  assert.deepEqual([again.settling, again.writes], [true, 0], 'a failed look in between ages nothing: the window starts again');
  assert.equal((await applyAgents(waiting, tools, [], { now: 8500 })).writes, 1, 'past it, the folder is written afresh');
}, { skip: lockSkip });

inBox('A folder that can’t be listed for a while ages no copy’s absence: once it can be, a copy deleted by hand gets the whole window', async box => {
  await on(box);
  const waiting = { ...box.context, settleMs: 2000 }, agents = join(box.home, '.codex/agents');
  await rm(fileOf(box, 'codex-cli'));
  assert.equal((await applyAgents(waiting, tools, [], { now: 1000 })).settling, true);
  await withLock(agents, 'dir-unreadable', () => applyAgents(waiting, tools, [], { now: 2000 }));
  const listed = await applyAgents(waiting, tools, [], { now: 3500 });
  assert.deepEqual([listed.settling, (await itemOf(box))!.on], [true, true]);
  await applyAgents(waiting, tools, [], { now: 6000 });
  assert.equal((await itemOf(box))!.on, false, 'a deletion that stays still turns the agent Off');
}, { skip: lockSkip });

/** Runs `pass` with the guard's look at Codex's agents folder failing as a denied permission would, after the agents were read; `meanwhile` lands at that moment. */
async function guardLookFails<T>(box: Box, meanwhile: () => Promise<unknown>, pass: () => Promise<T>): Promise<T> {
  const original = fs.stat, folder = join(box.home, '.codex/agents');
  let failed = false;
  fs.stat = (async (...args: Parameters<typeof fs.stat>) => {
    if (failed || String(args[0]) !== folder || !new Error().stack?.includes('guardFolders')) return original(...args);
    failed = true;
    await meanwhile();
    throw Object.assign(new Error(`EACCES: permission denied, stat '${folder}'`), { code: 'EACCES' });
  }) as typeof fs.stat; syncBuiltinESMExports();
  try { return await pass(); } finally { fs.stat = original; syncBuiltinESMExports(); }
}

inBox('A look at its folder that fails holds that tool for the pass: a copy a save keeps moving away, back as that look fails, turns nothing Off', async box => {
  await on(box);
  const text = (await readOf(box, 'codex-cli'))!, waiting = { ...box.context, settleMs: 2000 }, aside = join(box.base, 'saving');
  await rename(fileOf(box, 'codex-cli'), aside);
  assert.equal((await applyAgents(waiting, tools, [], { now: 4000 })).settling, true);
  await rename(aside, fileOf(box, 'codex-cli'));
  // The next save: the pass reads the copy away, and it is back as the look at its folder fails.
  await rename(fileOf(box, 'codex-cli'), aside);
  const held = await guardLookFails(box, () => rename(aside, fileOf(box, 'codex-cli')), () => applyAgents(waiting, tools, [], { now: 6600 }));
  assert.deepEqual([held.writes, (await itemOf(box))!.on, await readOf(box, 'codex-cli'), Object.values(await filesOf(box)).every(Boolean)], [0, true, text, true]);
});

inBox('A look at its folder that fails starts no window there, and the folder counts as back after being away: a copy a save moves away is written again', async box => {
  await on(box);
  const text = (await readOf(box, 'codex-cli'))!, waiting = { ...box.context, settleMs: 2000 }, aside = join(box.base, 'saving');
  await rename(fileOf(box, 'codex-cli'), aside);
  const held = await guardLookFails(box, () => rename(aside, fileOf(box, 'codex-cli')), () => applyAgents(waiting, tools, [], { now: 4000 }));
  assert.equal(held.settling, false, 'no window starts on a look that failed');
  await rename(fileOf(box, 'codex-cli'), aside);
  const back = await applyAgents(waiting, tools, [], { now: 6600 });
  assert.deepEqual([back.writes, (await itemOf(box))!.on, await readOf(box, 'codex-cli')], [1, true, text]);
  // The save lands over it: nothing more to do.
  await rename(aside, fileOf(box, 'codex-cli'));
  assert.deepEqual([(await applyAgents(waiting, tools, [], { now: 7000 })).writes, Object.values(await filesOf(box)).every(Boolean)], [0, true]);
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

const unseeable: [string, (box: Box) => Promise<() => Promise<unknown>>][] = [
  ['an unreadable file', async box => { const { lockPath } = await import('./fslock.ts'); return lockPath(fileOf(box, 'codex-cli'), 'file-unreadable'); }],
  ['a half-written save', async box => { await write(box, 'codex-cli', 'name = "reviewer"\n'); return async () => undefined; }],
  ['a file that is no agent', async box => { await write(box, 'claude-cli', 'no frontmatter yet'); return async () => undefined; }],
  ['its agents folder away', async box => { await rename(join(box.home, '.codex/agents'), join(box.home, '.codex/agents-away')); return async () => { await rm(join(box.home, '.codex/agents'), { recursive: true, force: true }); await rename(join(box.home, '.codex/agents-away'), join(box.home, '.codex/agents')); }; }],
  ['its agents folder made again, empty', async box => { await rm(join(box.home, '.codex/agents'), { recursive: true }); await mkdir(join(box.home, '.codex/agents')); return async () => undefined; }],
];
for (const [what, hide] of unseeable) {
  inBox(`A copy that can’t be seen (${what}) turns nothing Off and removes nothing`, async box => {
    await on(box);
    await pass(box);
    const others = async () => { const now = await filesOf(box); return [now['copilot-cli'] !== undefined, (await itemOf(box))!.on]; };
    const show = await hide(box);
    try {
      for (const now of [1000, 9000]) { const done = await applyAgents(box.context, tools, [], { now }); assert.equal(done.results.filter(entry => entry.outcome === 'removed').length, 0, JSON.stringify(done.results)); }
      assert.deepEqual(await others(), [true, true]);
    } finally { await show(); }
  }, { skip: what === 'an unreadable file' && lockSkip });
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
  // Codex's own part (its keys and table) comes back with it: the library keeps each tool's file as last seen.
  assert.equal(await readOf(box, 'codex-cli'), codexAgent());
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
  await applyAgents(box.context, tools, [{ key: 'writer', on: true, except: [] }]);
  await pass(box);
  await rm(join(box.home, '.codex/agents'), { recursive: true });
  await mkdir(join(box.home, '.codex/agents'));
  // Sync off: a click on reviewer concerns reviewer alone.
  const { row, item } = await seen(box);
  await applyAgents(box.context, tools, [{ key: row.key, on: true, except: ['copilot-cli'], seenOn: !!item?.on }], { only: new Set(['reviewer']) });
  assert.deepEqual([await readOf(box, 'codex-cli') !== undefined, await readFile(join(box.home, '.codex/agents/writer.toml'), 'utf8').catch(() => undefined)], [true, undefined]);
  for (const now of [1000, 9000]) await applyAgents(box.context, tools, [], { now });
  const view = await agentsView(box.context, tools);
  assert.equal(view.library!.writer.on, true, 'writer was not deleted by hand: its folder was made again');
  assert.match(await readFile(join(box.home, '.codex/agents/writer.toml'), 'utf8'), /You write docs/);
});

inBox('A harness that can’t hold the agent (its name is no file name there) is passed over: no copy, no result, and its mark says why', async box => {
  await writeFile(join(box.home, '.claude/agents/réviseur.md'), '---\nname: réviseur\ndescription: Relit\n---\n\nRelis.\n');
  const taken = await applyAgents(box.context, tools, [{ key: 'réviseur', on: true, except: [], seenOn: false }]);
  assert.deepEqual([taken.writes, taken.results], [0, []]);
  assert.deepEqual(await readdir(join(box.home, '.copilot/agents')), []);
  const fact = (await agentsView(box.context, tools)).items.find(agent => agent.key === 'réviseur')!;
  const why = (tool: string) => `${tool} can’t store this name (é). Rename it in Claude Code to use it there.`;
  assert.deepEqual([fact.on, fact.cannot], [true, { 'copilot-cli': why('Copilot CLI'), 'codex-cli': why('Codex') }]);
  assert.equal((await pass(box)).writes, 0);
});

inBox('An Off agent is in no tool, so no tool is named as one that can’t take it: its lines say it has no copy there', async box => {
  await writeFile(join(box.home, '.claude/agents/réviseur.md'), '---\nname: réviseur\ndescription: Relit\n---\n\nRelis.\n');
  await applyAgents(box.context, tools, [{ key: 'réviseur', on: true, except: [], seenOn: false }]);
  await applyAgents(box.context, tools, [{ key: 'réviseur', on: false, except: [], seenOn: true }]);
  const view = await agentsView(box.context, tools), fact = view.items.find(agent => agent.key === 'réviseur')!;
  assert.deepEqual([fact.on, fact.cannot], [false, {}]);
  assert.deepEqual(tools.map(tool => harnessIs(fact, view.library!['réviseur'], tool)), ['none', 'none', 'none']);
});

// ---------- Pi: an agent as a skill ----------
// Pi holds no agents of its own: an agent is a loose `<name>.md` in its skills folder, the Markdown Claude Code's file has (presence.ts
// agentsKeptIn, agentfiles.ts). Pi is then one more harness of the agents kind: every rule above holds there as anywhere.

const inPiBox = (name: string, body: (box: Box) => Promise<void>, options: { skip?: boolean | string } = {}) => test(name, options, async () => { const box = await sandbox(true); try { await body(box); } finally { await box.cleanup(); } });
const piSkills = (box: Box) => join(box.home, '.pi/agent/skills');
/** A skill folder of the person's own, in a skills folder (Pi's own, or ~/.agents/skills). */
async function skillFolder(root: string, name: string) {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: A skill of the person’s own.\n---\n\nDo it.\n`);
}
const piLine = async (box: Box) => { const { row, item } = await seen(box); return [harnessIs(row, item, 'pi-cli'), harnessLine(row, item, 'pi-cli', 'Pi')]; };

inPiBox('An agent that is On is in Pi as <name>.md in its skills folder, the Markdown Claude Code’s file has; Pi has a line like any tool, and a second pass writes nothing', async box => {
  await on(box);
  assert.equal(await readOf(box, 'pi-cli'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\nBe brief.\n');
  const { row, item } = await seen(box);
  assert.deepEqual([(await agentsView(box.context, box.tools)).tools.includes('pi-cli'), harnessIs(row, item, 'pi-cli')], [true, 'current']);
  assert.equal((await pass(box)).writes, 0);
});

inPiBox('The first pass after the update, Pi new to agents, writes every agent that is On into Pi once, and none that is Off; the second writes nothing', async box => {
  // The build before this one: Pi held no agents, so its passes ran over the other three.
  const before: HarnessId[] = [...tools];
  await write(box, 'claude-cli', claudeAgent());
  await writeFile(join(box.home, '.claude/agents/helper.md'), claudeAgent('You help.\n').replace('name: reviewer', 'name: helper'));
  await writeFile(join(box.home, '.claude/agents/quiet.md'), claudeAgent('Hush.\n').replace('name: reviewer', 'name: quiet'));
  await applyAgents(box.context, before, ['reviewer', 'helper', 'quiet'].map(key => ({ key, on: true, except: [], seenOn: false })));
  await applyAgents(box.context, before, [{ key: 'quiet', on: false, except: [], seenOn: true }]);
  const first = await pass(box);
  assert.deepEqual(first.results.filter(entry => entry.harness === 'pi-cli').map(entry => [entry.item, entry.outcome]).sort(), [['helper', 'written'], ['reviewer', 'written']]);
  assert.deepEqual((await readdir(piSkills(box))).sort(), ['helper.md', 'reviewer.md']);
  assert.equal((await pass(box)).writes, 0);
});

inPiBox('Pi’s own skills are never read as agents: a skill folder, loose files with and without front matter, and one named like an agent deleted with nothing applied in Pi', async box => {
  // "gone": taken in and deleted while Pi was not managed, so nothing of it was ever applied in Pi.
  await writeFile(join(box.home, '.claude/agents/gone.md'), claudeAgent('Gone.\n').replace('name: reviewer', 'name: gone'));
  await applyAgents(box.context, tools, [{ key: 'gone', on: true, except: [], seenOn: false }]);
  await applyAgents(box.context, tools, [{ key: 'gone', on: true, except: [], seenOn: true, deleted: true }]);
  await skillFolder(piSkills(box), 'notes');
  const own = {
    'loose.md': '---\nname: loose\ndescription: A loose skill.\n---\n\nLoose.\n', 'plain.md': 'No front matter at all.\n', 'broken.md': '---\nname: [broken\n---\n',
    'gone.md': claudeAgent('Mine.\n').replace('name: reviewer', 'name: gone'), 'constructor.md': '---\nname: constructor\ndescription: Named like a key every object has.\n---\n\nBuild.\n',
  };
  for (const [file, text] of Object.entries(own)) await writeFile(join(piSkills(box), file), text);
  for (let count = 0; count < 2; count++) assert.deepEqual([(await pass(box)).writes, (await pass(box)).results], [0, []]);
  const view = await agentsView(box.context, box.tools);
  assert.deepEqual([view.items.map(item => item.key), view.problems], [[], []]);
  for (const [file, text] of Object.entries(own)) assert.equal(await readFile(join(piSkills(box), file), 'utf8'), text);
});

inPiBox('A skill of the agent’s name holds Pi, in Pi’s skills folder or in ~/.agents/skills: nothing is written there and its line says how to use it; once that skill is gone, the next pass writes it', async box => {
  const held = 'Pi has a skill named “reviewer” and loads only one skill of a name. Delete or rename that skill to use this agent in Pi.';
  for (const root of [piSkills(box), join(box.home, '.agents/skills')]) {
    await skillFolder(root, 'reviewer');
    await on(box);
    assert.deepEqual([await readOf(box, 'pi-cli'), await piLine(box), (await pass(box)).writes], [undefined, ['cannot', held], 0], root);
    await rm(join(root, 'reviewer'), { recursive: true });
    assert.equal((await pass(box)).writes, 1, root);
    assert.ok(await readOf(box, 'pi-cli'));
    await turnOff(box);
  }
  // A skill of that name that comes after the agent's file: nothing is removed, and the agent stays current there.
  await turnOn(box);
  await skillFolder(piSkills(box), 'reviewer');
  assert.deepEqual([(await pass(box)).writes, !!(await readOf(box, 'pi-cli')), (await piLine(box))[0]], [0, true, 'current']);
});

inPiBox('Off then On, and Pi’s own switch off then on, give Pi’s file back byte for byte, a field added by hand in Pi included; no other tool gets that field', async box => {
  await on(box);
  await write(box, 'pi-cli', (await readOf(box, 'pi-cli'))!.replace('description: Reviews code\n', 'description: Reviews code\ndisable-model-invocation: true\n'));
  assert.equal((await pass(box)).writes, 0, 'a field of Pi’s own is no edit of the agent');
  const mine = (await readOf(box, 'pi-cli'))!;
  await turnOff(box);
  assert.equal(await readOf(box, 'pi-cli'), undefined);
  await turnOn(box);
  assert.equal(await readOf(box, 'pi-cli'), mine);
  await keepOut(box, 'pi-cli');
  assert.equal(await readOf(box, 'pi-cli'), undefined);
  await keepOut(box, 'pi-cli', false);
  assert.equal(await readOf(box, 'pi-cli'), mine);
  assert.ok(Object.values(await filesOf(box)).every(text => text === mine || !text!.includes('disable-model-invocation')));
});

inPiBox('An edit to Pi’s file, its description and prompt, reaches every other tool as a version edited in Pi', async box => {
  await on(box);
  await write(box, 'pi-cli', (await readOf(box, 'pi-cli'))!.replace('description: Reviews code', 'description: Reviews code closely').replace('Be brief.', 'Be exact.'));
  assert.equal((await pass(box)).writes, 3);
  for (const tool of tools as Tool[]) assert.match((await readOf(box, tool))!, /Reviews code closely[\s\S]*Be exact\./, tool);
  assert.deepEqual(await versions(box), ['Be exact. (edited in Pi) *', 'Be brief. (found in Claude Code)']);
});

inPiBox('An agent named with capitals and a space is in Pi under that very name, and two passes write nothing: no rename is read back', async box => {
  await writeFile(join(box.home, '.claude/agents/Code Reviewer.md'), claudeAgent().replace('name: reviewer', 'name: Code Reviewer'));
  await applyAgents(box.context, box.tools, [{ key: 'code reviewer', on: true, except: [], seenOn: false }]);
  assert.match(await readFile(join(piSkills(box), 'Code Reviewer.md'), 'utf8'), /^---\nname: Code Reviewer\n/);
  assert.deepEqual([(await pass(box)).writes, (await pass(box)).writes, await readdir(piSkills(box))], [0, 0, ['Code Reviewer.md']]);
});

inPiBox('A copy in Pi that can’t be seen is no copy gone: broken front matter, or Pi’s skills folder away inside the settle window, turns nothing Off and removes nothing', async box => {
  await on(box);
  const text = (await readOf(box, 'pi-cli'))!, others = await filesOf(box);
  await write(box, 'pi-cli', '---\nname: rev');
  const done = await pass(box);
  assert.deepEqual([done.writes, (await itemOf(box))!.on, (await piLine(box))[0]], [0, true, 'unseen']);
  await write(box, 'pi-cli', text);
  await rename(piSkills(box), `${piSkills(box)}-away`);
  const waiting = { ...box.context, settleMs: 2000 };
  for (const now of [1000, 2500]) assert.deepEqual([(await applyAgents(waiting, box.tools, [], { now })).writes, (await itemOf(box))!.on], [0, true]);
  await rename(`${piSkills(box)}-away`, piSkills(box));
  assert.deepEqual([await filesOf(box), (await pass(box)).writes], [others, 0]);
});

inPiBox('Pi’s file deleted by hand while the agent is On turns it Off in every tool, as in any tool; History turns it on again, Pi’s file as it was', async box => {
  await on(box);
  const text = await readOf(box, 'pi-cli');
  await rm(fileOf(box, 'pi-cli'));
  await pass(box);
  assert.deepEqual([placeOf(await itemOf(box)), Object.values(await filesOf(box))], ['off', [undefined, undefined, undefined, undefined]]);
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['off: Turn it on']);
  await actions[0].run();
  assert.equal(await readOf(box, 'pi-cli'), text);
});

inPiBox('Every sentence that names Pi’s folder for an agent calls it its skills folder: one that can’t be written, and one that is away', async box => {
  await on(box);
  await withLock(piSkills(box), 'dir-readonly', async () => {
    await edit(box, 'claude-cli', 'Be exact.');
    await pass(box);
    assert.deepEqual(await piLine(box), ['cannot', 'Pi’s skills folder can’t be written, so Central Knot can’t change the agent there. Once the folder’s permissions let it, Pi catches up when sync runs.']);
  });
  await pass(box);
  await rename(piSkills(box), `${piSkills(box)}-away`);
  await turnOff(box);
  assert.deepEqual(await piLine(box), ['unseen', 'Pi’s skills folder isn’t there. Its copy is removed once it is back.']);
}, { skip: lockSkip });

inPiBox('A loose file in Pi named like an agent that Central Knot never applied there is the person’s own skill: whether the agent is turned On, taken in by Add, or met on the first pass after the update, Pi is held and the file stays as it was', async box => {
  const mine = '---\nname: reviewer\ndescription: My own Pi skill\n---\n\nMine.\n';
  const held = 'Pi has a skill named “reviewer” and loads only one skill of a name. Delete or rename that skill to use this agent in Pi.';
  const stays = async (when: string, home = box) => {
    assert.deepEqual([await readOf(home, 'pi-cli'), await piLine(home)], [mine, ['cannot', held]], when);
    assert.deepEqual([(await pass(home)).writes, await readOf(home, 'pi-cli'), (await itemOf(home))!.versions.length], [0, mine, 1], `${when}, the next pass`);
  };
  // Taken in by Add while Pi has the file: the click says nothing untrue about Pi, and Pi's line says why.
  await write(box, 'claude-cli', claudeAgent());
  await write(box, 'pi-cli', mine);
  const add = await applyAgents(box.context, box.tools, [{ key: 'reviewer', on: true, except: [], seenOn: false }]);
  assert.deepEqual(add.results.filter(entry => entry.harness === 'pi-cli'), []);
  await stays('after Add');
  // Turned Off, then On again.
  await turnOff(box);
  await turnOn(box);
  await stays('after Off and On');
  // The first pass after the update, in a home of its own: Pi new to agents, the agent On in the others.
  const updated = await sandbox(true);
  try {
    await write(updated, 'claude-cli', claudeAgent());
    await write(updated, 'pi-cli', mine);
    await applyAgents(updated.context, [...tools], [{ key: 'reviewer', on: true, except: [], seenOn: false }]);
    await pass(updated);
    await stays('after the update’s first pass', updated);
  } finally { await updated.cleanup(); }
  // Renamed, his skill no longer holds Pi: the next pass writes the agent there.
  await rename(fileOf(box, 'pi-cli'), join(piSkills(box), 'my-reviewer.md'));
  assert.equal((await pass(box)).writes, 1);
  assert.deepEqual([await readOf(box, 'pi-cli'), await readFile(join(piSkills(box), 'my-reviewer.md'), 'utf8')], [claudeAgent(), mine]);
});

inPiBox('A skill an earlier version made for Pi from the agent (Convert to skill, now gone) holds the agent in Pi; that skill stays as it was, still only in Pi', async box => {
  const { applySkills, skillsView } = await import('../src/skills.ts');
  // As that click left it: the skill folder in Pi, taken into Central Knot On in Pi alone, and its record beside the others.
  await skillFolder(piSkills(box), 'reviewer');
  const skill = await readFile(join(piSkills(box), 'reviewer/SKILL.md'), 'utf8');
  await applySkills(box.context, box.tools, [{ key: 'reviewer', on: true, except: [...tools] }]);
  await writeFile(join(box.home, '.central-knot/converted.json'), '{"reviewer":{"agent":"reviewer","origin":"claude-cli","at":"2026-11-01T00:00:00.000Z","losses":[]}}\n');
  await on(box);
  assert.deepEqual([await readOf(box, 'pi-cli'), (await piLine(box))[0]], [undefined, 'cannot']);
  await applySkills(box.context, box.tools, [], { background: true });
  const row = (await skillsView(box.context, box.tools)).items.find(item => item.key === 'reviewer')!;
  assert.deepEqual([await readFile(join(piSkills(box), 'reviewer/SKILL.md'), 'utf8'), Object.keys(row.copies)], [skill, ['pi-cli']]);
});

inBox('A tool whose agents folder can’t be written says why on its line, pass after pass, instead of promising the agent; once it can be, it gets it', async box => {
  await on(box);
  const folder = join(box.home, '.copilot/agents');
  await withLock(folder, 'dir-readonly', async () => {
    await edit(box, 'claude-cli', 'Be exact.');
    // The edit's notice and History name only the tool it reached.
    const told = itemNotice((await pass(box)).notices![0]);
    assert.equal(noticeWords(told).text, 'reviewer was edited in Claude Code; that is its current version now, in Codex too.');
    assert.deepEqual((await historyOf(box)).at(-1)!.losers.map(loser => loser.tool), ['codex-cli']);
    await pass(box);
    const { row, item } = await seen(box);
    assert.equal(harnessIs(row, item, 'copilot-cli'), 'cannot');
    assert.equal(harnessLine(row, item, 'copilot-cli', 'Copilot CLI'),
      'Copilot CLI’s agents folder can’t be written, so Central Knot can’t change the agent there. Once the folder’s permissions let it, Copilot CLI catches up when sync runs.');
  });
  assert.equal((await pass(box)).writes, 1);
  assert.match((await readOf(box, 'copilot-cli'))!, /Be exact\./);
  // Deleted from Central Knot while the folder can't be written: the row says its copy there goes once it can be.
  await withLock(folder, 'dir-readonly', async () => {
    await deleteIt(box);
    const { row } = await seen(box);
    assert.match(harnessLine(row, undefined, 'copilot-cli', 'Copilot CLI'), /^Central Knot removes this copy once it can write in Copilot CLI’s agents folder\.$/);
  });
  await pass(box);
  assert.equal(await readOf(box, 'copilot-cli'), undefined);
  await (await historyActions(box)).find(action => action.label === 'Restore')!.run();
  // With no copy there either, nothing is tried pass after pass: its line says why, and no pass reports a failed write.
  await rm(fileOf(box, 'copilot-cli'));
  await withLock(folder, 'dir-readonly', async () => {
    await keepOut(box, 'copilot-cli');
    await keepOut(box, 'copilot-cli', false);
    const tried = await pass(box);
    assert.deepEqual([tried.results.filter(entry => entry.harness === 'copilot-cli'), (await marks(box))['copilot-cli']], [[], 'cannot']);
  });
}, { skip: lockSkip });

inBox('Clicking Add, On, or a harness’s switch with a locked agents folder names that harness and says why, and says nothing on later passes', async box => {
  const codexAgents = join(box.home, '.codex/agents');
  const lockedWhy = 'Codex’s agents folder can’t be written, so Central Knot can’t change the agent there. Once the folder’s permissions let it, Codex catches up when sync runs.';
  await write(box, 'claude-cli', claudeAgent());
  await withLock(codexAgents, 'dir-readonly', async () => {
    const added = await turnOn(box);
    assert.ok(added !== 'choose');
    const addRes = clickResults(added.results, ['reviewer']);
    assert.deepEqual([addRes.notIn, addRes.failed], [['codex-cli'], true]);
    assert.deepEqual(addRes.ours.filter(entry => entry.harness === 'codex-cli'), [{ item: 'reviewer', harness: 'codex-cli', outcome: 'held', message: lockedWhy }]);
    assert.equal(said.takenIn('reviewer', tools.filter(tool => !addRes.notIn.includes(tool)), tools), 'reviewer is in Central Knot now, and on in Claude Code and Copilot CLI.');
    assert.deepEqual((await pass(box)).results, []);
    await turnOff(box);
    const onAgain = await turnOn(box);
    assert.ok(onAgain !== 'choose');
    assert.deepEqual(clickResults(onAgain.results, ['reviewer']).notIn, ['codex-cli']);
    await keepOut(box, 'codex-cli', true);
    const back = await keepOut(box, 'codex-cli', false);
    const backRes = clickResults(back.results, ['reviewer']);
    assert.deepEqual([backRes.notIn, backRes.failed], [['codex-cli'], true]);
    assert.equal(said.inHarness('reviewer', 'codex-cli', false, backRes.notIn.includes('codex-cli')), 'reviewer couldn’t be put in Codex.');
    assert.deepEqual((await pass(box)).results, []);
  });
  assert.equal((await pass(box)).writes, 1);
  assert.ok(await readOf(box, 'codex-cli'));
  assert.deepEqual((await pass(box)).results, []);
}, { skip: lockSkip });

// ---------- Found agents ----------

inBox('An agent a harness has that Central Knot doesn’t is found: never written by itself; its switch takes it in everywhere', async box => {
  await write(box, 'claude-cli', claudeAgent());
  await write(box, 'claude-cli', claudeAgent());
  await writeFile(join(box.home, '.claude/agents/broken.md'), 'no frontmatter');
  await writeFile(join(box.home, '.codex/agents/bad.toml'), 'name = ');
  const view = await agentsView(box.context, tools);
  assert.deepEqual([view.items.map(agent => agent.key), view.problems.length], [['reviewer'], 2], 'unreadable files are reported, not offered');
  assert.deepEqual([placeOf(await itemOf(box)), await marks(box)], ['found', { 'claude-cli': 'own-copy', 'copilot-cli': 'none', 'codex-cli': 'none' }]);
  assert.equal((await pass(box)).writes, 0);
  assert.deepEqual(await readdir(join(box.home, '.copilot/agents')), []);
  const taken = await turnOn(box);
  // Taking in offers an Undo: its History entry, which takes the agent out again and leaves Claude Code's file (tests/undo.test.ts).
  assert.deepEqual(taken !== 'choose' && [taken.writes, taken.made?.length], [2, 1]);
  assert.deepEqual([placeOf(await itemOf(box)), await versions(box)], ['on', ['Be brief. (found in Claude Code) *']]);
});

inBox('Found copies that differ: the switch asks; the chosen copy is taken in, and the others become versions', async box => {
  await write(box, 'claude-cli', claudeAgent());
  await write(box, 'codex-cli', codexAgent('You review code.\nBe quick.\n'));
  await utimes(fileOf(box, 'codex-cli'), new Date(), new Date(Date.now() + 5000));
  assert.equal(await turnOn(box), 'choose');
  const unanswered = await applyAgents(box.context, tools, [{ key: 'reviewer', on: true, except: [], seenOn: false }]);
  assert.deepEqual(unanswered.results.map(entry => [entry.outcome, entry.differs]), [['held', true]]);
  assert.equal(await itemOf(box), undefined, 'nothing is taken in without an answer');
  // A choice made on a page read before the chosen copy changed is refused.
  const { row } = await seen(box);
  await write(box, 'codex-cli', codexAgent('You review code.\nBe late.\n'));
  const stale = await applyAgents(box.context, tools, [{ key: 'reviewer', on: true, except: [], seenOn: false, use: 'codex-cli', useHash: row.hashes!['codex-cli'] }]);
  assert.deepEqual([stale.results.map(entry => [entry.outcome, entry.chooseAgain]), await itemOf(box)], [[['held', true]], undefined]);
  await write(box, 'codex-cli', codexAgent('You review code.\nBe quick.\n'));
  await utimes(fileOf(box, 'codex-cli'), new Date(), new Date(Date.now() + 5000));
  await choose(box, 'codex-cli');
  assert.match((await readOf(box, 'claude-cli'))!, /Be quick\./);
  assert.deepEqual(await versions(box), ['Be quick. (chosen from Codex) *', 'Be brief. (was in Claude Code)']);
  // Taken in together: the chosen copy is no "first version", and the other says what it differs in from the chosen one.
  assert.deepEqual((await seen(box)).fact?.versionChanges, ['none', { differs: ['prompt'] }]);
  // A library item never waits for a choice, and History can make the other copy's version current.
  const actions = await historyActions(box);
  assert.deepEqual(actions.map(action => `${action.event.kind}: ${action.label}`), ['chosen: Undo', 'chosen: Use claude-cli’s']);
  await actions[1].run();
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  // The choice's entry stays open: what it offers is whatever would still change something (now nothing), and the version
  // made current has its own Undo.
  assert.equal((await historyOf(box)).find(event => event.kind === 'chosen')!.undoneBy, undefined);
  assert.deepEqual((await historyActions(box)).map(action => `${action.event.kind}: ${action.label}`), ['current: Undo']);
});

/** Claude Code with the plugin review-kit (from the marketplace team) installed, which brings an agent “reviewer” written as `text`. */
async function claudePluginWith(box: Box, text: string) {
  const copy = join(box.home, '.claude/plugins/cache/team/review-kit/1.0.0');
  await mkdir(join(copy, '.claude-plugin'), { recursive: true });
  await mkdir(join(copy, 'agents'), { recursive: true });
  await writeFile(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'review-kit', version: '1.0.0' }));
  await writeFile(join(copy, 'agents/reviewer.md'), text);
  await writeFile(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'review-kit@team': [{ scope: 'user', installPath: copy, version: '1.0.0' }] } }));
}

inBox('A found agent taken in by Synchronize everything where Claude Code has the same agent through a plugin: no file of it goes in Claude Code’s agents folder, and its row says Claude Code has it through the plugin', async box => {
  await write(box, 'copilot-cli', claudeAgent());
  await claudePluginWith(box, claudeAgent());
  await setSyncEverything(box.context, true);
  await pass(box);
  assert.deepEqual([placeOf(await itemOf(box)), await readOf(box, 'claude-cli'), await readOf(box, 'codex-cli') !== undefined], ['on', undefined, true]);
  assert.deepEqual((await seen(box)).fact?.plugin, { 'claude-cli': { plugin: 'review-kit', marketplace: 'team', version: '1.0.0', name: 'reviewer' } });
  assert.equal((await pass(box)).writes, 0);
});

inBox('A found agent taken in by Synchronize everything where Claude Code’s plugin brings another agent of that name: Claude Code gets the agent’s file beside the plugin’s, as a tool without it does', async box => {
  await write(box, 'copilot-cli', claudeAgent());
  await claudePluginWith(box, claudeAgent('You review code.\nBe thorough.\n'));
  await setSyncEverything(box.context, true);
  await pass(box);
  assert.deepEqual([placeOf(await itemOf(box)), await readOf(box, 'claude-cli'), (await seen(box)).fact?.plugin], ['on', claudeAgent(), undefined]);
  assert.equal((await pass(box)).writes, 0);
});

inBox('A found agent taken in where Claude Code has it through a plugin and a file of its own with that content: the take-in puts the file on record as Central Knot’s (a stop here leaves it so), and the next pass removes it, so Claude Code has it through the plugin alone', async box => {
  await write(box, 'copilot-cli', claudeAgent());
  await write(box, 'claude-cli', claudeAgent());
  await claudePluginWith(box, claudeAgent());
  await setSyncEverything(box.context, true);
  await pass(box);
  const item = (await itemOf(box))!;
  assert.deepEqual([await readOf(box, 'claude-cli'), item.applied['claude-cli']], [claudeAgent(), item.hash]);
  await pass(box);
  assert.deepEqual([await readOf(box, 'claude-cli'), Object.keys((await seen(box)).fact?.plugin ?? {})], [undefined, ['claude-cli']]);
  assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.agents, tools)?.text, 'Off in Claude Code, so its file there was removed when sync reached it. Central Knot keeps it.');
  assert.equal((await pass(box)).writes, 0);
});

/** Copilot CLI's agent and the plugin's in Claude Code are one content; Claude Code's own file of it is another. Copilot CLI's is chosen. */
async function chosenBesidePlugin(box: Box) {
  await write(box, 'copilot-cli', claudeAgent());
  await write(box, 'claude-cli', claudeAgent('You review code.\nMine.\n'));
  await claudePluginWith(box, claudeAgent());
  await choose(box, 'copilot-cli');
}

inBox('Copilot CLI’s copy chosen where Claude Code has that content through a plugin and another file of its own: Claude Code’s file is kept as a version, as History says, and the next pass removes it', async box => {
  await chosenBesidePlugin(box);
  const chosen = (await historyOf(box)).find(event => event.kind === 'chosen')!;
  assert.equal(librarySentence(chosen, libraryWords.agents, tools)?.text, 'You chose Copilot CLI’s copy; Claude Code’s is kept as a version.');
  assert.deepEqual(await versions(box), ['Be brief. (chosen from Copilot CLI) *', 'Mine. (was in Claude Code)']);
  assert.deepEqual((await historyActions(box)).map(action => action.label), ['Undo', 'Use claude-cli’s']);
  assert.equal(await readOf(box, 'claude-cli'), claudeAgent('You review code.\nMine.\n'), 'nothing is written there');
  await pass(box);
  assert.deepEqual([await readOf(box, 'claude-cli'), Object.keys((await seen(box)).fact?.plugin ?? {})], [undefined, ['claude-cli']]);
  assert.equal((await pass(box)).writes, 0);
});

inBox('Copilot CLI’s copy chosen there, then its Undo before the next pass: Claude Code’s own file stays where it was, as it was, and is its own again', async box => {
  await chosenBesidePlugin(box);
  await (await historyActions(box)).find(action => action.label === 'Undo')!.run();
  assert.deepEqual([await readOf(box, 'claude-cli'), await readOf(box, 'copilot-cli'), await readOf(box, 'codex-cli')], [claudeAgent('You review code.\nMine.\n'), claudeAgent(), undefined]);
  assert.equal((await pass(box)).writes, 0);
  assert.equal(await readOf(box, 'claude-cli'), claudeAgent('You review code.\nMine.\n'));
});

// ---------- Versions ----------

inBox('Make current on an earlier version is a new version, applied like any other; every version is kept', async box => {
  await on(box);
  for (const line of ['Edit one.', 'Edit two.', 'Edit three.']) { await edit(box, 'claude-cli', line); await pass(box); }
  const first = (await itemOf(box))!.versions.at(-1)!.hash;
  const made = await makeCurrent(box, first);
  assert.equal(made.writes, 3);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  // Five entries, four contents: the list folds the found one into the one made current again.
  assert.deepEqual([(await itemOf(box))!.versions.length, (await versions(box)).length], [5, 4]);
  assert.deepEqual((await versions(box))[0], 'Be brief. (made current again) *');
  assert.match((await makeCurrent(box, first)).results[0].message, /at that version already/);
  // Its Undo, from the result or from History, makes the one before current again.
  await undo(box, made);
  assert.match((await readOf(box, 'codex-cli'))!, /Edit three\./);
  assert.equal((await pass(box)).writes, 0);
});

inBox('An edit no pass took in, written over by Make current, has its History line, and History can make it current', async box => {
  await on(box);
  await edit(box, 'claude-cli', 'Edit one.');
  await pass(box);
  // Automatic sync off: an edit in Codex no pass sees, then Make current of the first version on the page.
  await edit(box, 'codex-cli', 'Edit unseen.');
  const first = (await itemOf(box))!.versions.at(-1)!.hash;
  const { row, item } = await seen(box);
  await applyAgents(box.context, tools, [rowClicks.makeCurrent(row, item, first)], { only: new Set(['reviewer']) });
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  const kept = (await historyOf(box)).at(-1)!;
  assert.deepEqual([kept.kind, kept.losers.map(loser => loser.tool)], ['kept-edit', ['codex-cli']]);
  const use = (await historyActions(box)).find(action => action.event.id === kept.id)!;
  assert.equal(use.label, 'Use codex-cli’s');
  await use.run();
  assert.match((await readOf(box, 'claude-cli'))!, /Edit unseen\./);
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
  // Back as the take-in left it: that entry's Undo (take it out again, each tool keeping its own copy) is offered again.
  assert.deepEqual((await historyActions(box)).map(action => action.label), ['Undo']);
  // Restore over a newer agent of that name, made in Claude Code since: it is kept as a version, and the result says so.
  await deleteIt(box);
  await write(box, 'claude-cli', claudeAgent('You review code.\nA new reviewer.\n'));
  await (await historyActions(box)).find(action => action.label === 'Restore')!.run();
  assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.agents, tools)?.text,
    'Restored to Central Knot and put back in all 3 tools. Your newer reviewer from Claude Code is kept as a version.');
  assert.ok((await versions(box)).includes('A new reviewer. (was in Claude Code)'));
});

inBox('A found copy taken in over a deleted agent of that name is the same agent again: its earlier versions come back with it', async box => {
  await on(box);
  await edit(box, 'claude-cli', 'Edit one.');
  await pass(box);
  await deleteIt(box);
  await write(box, 'codex-cli', codexAgent('You review code.\nBe late.\n'));
  assert.notEqual(await turnOn(box), 'choose');
  assert.deepEqual(await versions(box), ['Be late. (found in Codex) *', 'Edit one. (edited in Claude Code)', 'Be brief. (found in Claude Code)']);
});

// ---------- A removal never takes content the library doesn't have ----------

inBox('Off with Automatic sync off, after an edit no pass has seen: the edit becomes the current version before its file goes, and On brings it back everywhere', async box => {
  await on(box);
  await edit(box, 'codex-cli', 'Edit unseen.');
  // Sync off: the click's pass concerns this agent alone, and no pass ran since the edit.
  const { row, item } = await seen(box);
  const off = await applyAgents(box.context, tools, [{ key: row.key, on: false, except: item!.except, seenOn: true }], { only: new Set(['reviewer']) });
  assert.equal(off.writes, 3);
  assert.deepEqual(await versions(box), ['Edit unseen. (edited in Codex) *', 'Be brief. (found in Claude Code)']);
  await turnOn(box);
  assert.deepEqual(Object.values(await filesOf(box)).map(text => /Edit unseen\./.test(text ?? '')), [true, true, true]);
});

inBox('A harness kept out with an edit no pass has seen: the edit becomes the current version and reaches the others; its copy goes', async box => {
  await on(box);
  await edit(box, 'codex-cli', 'Edit unseen.');
  const { row, item } = await seen(box);
  await applyAgents(box.context, tools, [{ key: row.key, on: true, except: ['codex-cli'], seenOn: true }], { only: new Set(['reviewer']) });
  assert.deepEqual([await readOf(box, 'codex-cli'), (await versions(box))[0]], [undefined, 'Edit unseen. (edited in Codex) *']);
  assert.match((await readOf(box, 'claude-cli'))!, /Edit unseen\./);
  await keepOut(box, 'codex-cli', false);
  assert.match((await readOf(box, 'codex-cli'))!, /Edit unseen\./);
});

inBox('An edit saved between the read and the removal stays where it is, and becomes the current version before the next pass removes it', async box => {
  await on(box);
  let saved = false;
  const racing: ShareContext = { ...box.context, fault: step => { if (step === 'before-remove' && !saved) { saved = true; writeFileSync(fileOf(box, 'claude-cli'), claudeAgent('You review code.\nEdit late.\n')); } } };
  const off = await turnOff(box, racing);
  assert.match(off.results.find(entry => entry.harness === 'claude-cli')!.message, /changed just now/);
  assert.match((await readOf(box, 'claude-cli'))!, /Edit late\./, 'the save is not lost');
  // History names the tools it was taken out of, not Claude Code, where it stays.
  assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.agents, tools)?.text, 'Turned off: removed from Copilot CLI and Codex. Central Knot keeps it.');
  await pass(box);
  assert.deepEqual([await readOf(box, 'claude-cli'), await versions(box)], [undefined, ['Edit late. (edited in Claude Code) *', 'Be brief. (found in Claude Code)']]);
});

inBox('Turned On over Codex’s own file, which changes just as it is written: History doesn’t name Codex as written; the next pass writes it and says so; the On’s Undo, before and after, undoes exactly what was written', async box => {
  await on(box);
  await turnOff(box);
  await write(box, 'codex-cli', codexAgent('You review code.\nMine.\n'));
  let saved = false;
  const racing: ShareContext = { ...box.context, fault: step => { if (step === 'before-rename' && !saved) { saved = true; writeFileSync(fileOf(box, 'codex-cli'), codexAgent('You review code.\nMine, saved again.\n')); } } };
  const turned = await turnOn(box, racing) as PassResult;
  assert.deepEqual(turned.results.map(entry => [entry.harness, entry.outcome]), [['claude-cli', 'written'], ['copilot-cli', 'written'], ['codex-cli', 'held']]);
  const entry = (await historyOf(box)).at(-1)!;
  // The copy the click took over stays on record for its Undo; only the tools written are named as written.
  assert.deepEqual([entry.kind, entry.losers.map(loser => loser.tool), entry.tookFrom?.map(copy => copy.tool)], ['on', ['claude-cli', 'copilot-cli'], ['codex-cli']]);
  assert.equal(librarySentence(entry, libraryWords.agents, tools)?.text, 'Turned on: put in Claude Code and Copilot CLI.');
  // Its Undo before the write happens: Codex's file, never written, stays as it is.
  await trial(box, async () => {
    await (await historyActions(box)).find(action => action.event.id === entry.id && action.label === 'Undo')!.run();
    assert.deepEqual(await filesOf(box), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': codexAgent('You review code.\nMine, saved again.\n') });
  });
  // The next pass keeps what Codex saved and writes over it, and History says so.
  await pass(box);
  assert.match((await readOf(box, 'codex-cli'))!, /Be brief\./);
  const later = (await historyOf(box)).at(-1)!;
  assert.deepEqual([later.kind, later.cause, later.losers.map(loser => loser.tool)], ['kept-edit', 'own-copy', ['codex-cli']]);
  // Its Undo after: Codex's own file as the click found it comes back; what Codex saved meanwhile is a version.
  await (await historyActions(box)).find(action => action.event.id === entry.id && action.label === 'Undo')!.run();
  assert.deepEqual([await readOf(box, 'claude-cli'), await readOf(box, 'copilot-cli')], [undefined, undefined]);
  assert.match((await readOf(box, 'codex-cli'))!, /Mine\.\n/);
  assert.ok((await versions(box)).includes('Mine, saved again. (was in Codex)'));
});

inBox('A removal held twice: the pass that holds it again adds no entry naming it; the pass that removes it says so, once', async box => {
  await on(box);
  /** A context whose first removal finds Claude Code's file saved again just before it. */
  const savedAgain = (prompt: string): ShareContext => { let saved = false; return { ...box.context, fault: step => { if (step === 'before-remove' && !saved) { saved = true; writeFileSync(fileOf(box, 'claude-cli'), claudeAgent(prompt)); } } }; };
  await turnOff(box, savedAgain('You review code.\nEdit late.\n'));
  const told = (await historyOf(box)).length;
  await pass(box, savedAgain('You review code.\nEdit later.\n'));
  assert.deepEqual((await historyOf(box)).slice(told).map(event => [event.kind, event.cause]), [['edit', undefined]], 'the edit taken in, and no in-line Off');
  await pass(box);
  assert.equal(await readOf(box, 'claude-cli'), undefined);
  const removed = (await historyOf(box)).filter(event => event.cause === 'in-line');
  assert.deepEqual(removed.map(event => [event.kind, event.losers.map(loser => loser.tool)]), [['off', ['claude-cli']]]);
});

inBox('Kept out of Codex, then let back in, each time as a file is saved there just then: History says neither that its copy was removed nor that it is back', async box => {
  await on(box);
  /** A context whose first step `at` finds a file saved in Codex just before it. */
  const savedThen = (at: 'before-remove' | 'before-rename', prompt: string): ShareContext => { let saved = false; return { ...box.context, fault: step => { if (step === at && !saved) { saved = true; writeFileSync(fileOf(box, 'codex-cli'), codexAgent(prompt)); } } }; };
  await keepOut(box, 'codex-cli', true, savedThen('before-remove', 'You review code.\nEdit late.\n'));
  assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.agents, tools)?.text, 'Kept out of Codex. Central Knot keeps it.');
  await pass(box); // the edit saved there is taken in, and Codex's copy goes
  assert.equal(await readOf(box, 'codex-cli'), undefined);
  await keepOut(box, 'codex-cli', false, savedThen('before-rename', 'You review code.\nMine.\n'));
  assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.agents, tools)?.text, 'Turned on in Codex.');
  assert.match((await readOf(box, 'codex-cli'))!, /Mine\./, 'the file saved there stays');
});

inBox('An Undo whose own file to give back changes just as it is given back: History doesn’t say Codex has its own file back', async box => {
  await on(box);
  await turnOff(box);
  await write(box, 'codex-cli', codexAgent('You review code.\nMine.\n'));
  const turned = await turnOn(box) as PassResult;
  let saved = false;
  const racing: ShareContext = { ...box.context, fault: step => { if (step === 'before-rename' && !saved) { saved = true; writeFileSync(fileOf(box, 'codex-cli'), codexAgent('You review code.\nSaved just then.\n')); } } };
  await undo(box, turned, racing);
  const entry = (await historyOf(box)).at(-1)!;
  assert.deepEqual([entry.kind, entry.gaveBack], ['off', undefined]);
  assert.equal(librarySentence(entry, libraryWords.agents, tools)?.text, 'Turned off: removed from Claude Code and Copilot CLI. Central Knot keeps it.');
  assert.match((await readOf(box, 'codex-cli'))!, /Saved just then\./, 'what Codex saved stays');
});

inBox('Turned on while Codex is left out: History names the tools it was put in, never Codex', async box => {
  await on(box);
  await turnOff(box);
  box.tools = ['claude-cli', 'copilot-cli'];
  await turnOn(box);
  assert.equal(librarySentence((await historyOf(box)).at(-1)!, libraryWords.agents, tools)?.text, 'Turned on: put in Claude Code and Copilot CLI.');
});

inBox('A removal that finds the copy changed since it was read waits for the next look: its result is held, not failed', async box => {
  await on(box);
  const racing: ShareContext = { ...box.context, fault: step => { if (step === 'before-remove') writeFileSync(fileOf(box, 'codex-cli'), codexAgent('You review code.\nEdit late.\n')); } };
  const off = await turnOff(box, racing);
  assert.deepEqual(off.results.filter(entry => entry.harness === 'codex-cli').map(entry => entry.outcome), ['held']);
});

inBox('An edit saved in another tool between the pass’s last read and the write that replaces its file is never lost: it stays on disk or is kept as a version', async box => {
  await on(box, claudeAgent('BASE\n'));
  await write(box, 'claude-cli', claudeAgent('UPSTREAM\n'));
  // The concurrent save lands where the write now happens: after the old file is moved aside, before the new one is linked in.
  const original = fs.link; let injected = false;
  fs.link = async (from, to) => {
    if (String(to) === fileOf(box, 'copilot-cli') && !injected) { injected = true; await write(box, 'copilot-cli', claudeAgent('CONCURRENT UNIQUE\n')); }
    return original(from, to);
  }; syncBuiltinESMExports();
  try { await pass(box); } finally { fs.link = original; syncBuiltinESMExports(); }
  assert.ok(injected);
  const kept = join(box.home, '.central-knot/items/agents');
  const stored = await Promise.all((await readdir(kept, { recursive: true })).map(path => readFile(join(kept, path), 'utf8').catch(() => '')));
  assert.ok([await readOf(box, 'copilot-cli'), ...stored].some(text => text?.includes('CONCURRENT UNIQUE')), 'the concurrent edit is on disk or kept');
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
  // And On writes each harness's own file back, with the edit that was taken in on the way out.
  await turnOn(box);
  const withEdit = (text: string | undefined) => text!.replace('Be brief.', 'Edit unseen.');
  assert.deepEqual([(await filesOf(box))['claude-cli'], (await filesOf(box))['codex-cli']], [withEdit(before['claude-cli']), withEdit(before['codex-cli'])]);
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

inBox('A crash before a file changes leaves the click in History (it is told before the record is saved): a Delete can still be restored, an Off turned on, an edit undone', async box => {
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
  assert.equal((await offered()).at(-1), 'off: Turn it on');
  await pass(box);
  await (await historyActions(box)).find(action => action.label === 'Turn it on')!.run();
  await edit(box, 'codex-cli', 'Edit one.');
  await assert.rejects(pass(box, crashAt(box, 'before-rename')), /crash at before-rename/);
  assert.equal((await offered()).at(-1), 'edit: Undo');
});

inBox('A file a crash left moved aside, mid-removal, is put back before the pass reads: it is never a copy deleted by hand', async box => {
  await on(box);
  const parked = join(box.home, '.codex/agents/.reviewer.toml.ck-00000000-0000-4000-8000-000000000000.old');
  await rename(fileOf(box, 'codex-cli'), parked);
  const done = await pass(box);
  assert.deepEqual([done.notices, (await itemOf(box))!.on, await readOf(box, 'codex-cli') !== undefined], [[], true, true]);
});

inBox('A removal Central Knot carried out is on record at once: after a crash, History’s Turn it on (or Restore) writes every copy back and nothing reads as deleted by hand', async box => {
  await on(box, claudeAgent(undefined, claudeOwn));
  const before = await filesOf(box);
  // Off stops after its first removal; with Automatic sync off, On is the next pass, inside a settle window.
  await assert.rejects(turnOff(box, crashAt(box, 'before-remove', 2)), /crash at before-remove/);
  const waiting = { ...box.context, settleMs: 2000 };
  const { row, item } = await seen(box, waiting);
  await applyAgents(waiting, tools, [rowClicks.on(row, item)], { only: new Set(['reviewer']) });
  await applyAgents(waiting, tools, [], { now: Date.now() + 5000 });
  assert.deepEqual([await filesOf(box), (await itemOf(box))!.on], [before, true]);
  // The same after Delete, with Restore at once.
  await assert.rejects(deleteIt(box, crashAt(box, 'before-remove', 2)), /crash at before-remove/);
  await (await historyActions(box)).find(action => action.label === 'Restore')!.run();
  await applyAgents(waiting, tools, [], { now: Date.now() + 5000 });
  assert.deepEqual([await filesOf(box), (await itemOf(box))!.on], [before, true]);
});

inBox('A deleted agent can always be restored: a Delete whose pass saved another agent’s edit first, then crashed, gets its History entry at the next pass', async box => {
  // "helper" comes first in the record, with an edit in Copilot CLI that no pass has taken in yet.
  const helper = (prompt: string) => claudeAgent(prompt).replace('name: reviewer', 'name: helper');
  await writeFile(join(box.home, '.claude/agents/helper.md'), helper('You help.\n'));
  await applyAgents(box.context, tools, [{ key: 'helper', on: true, except: [] }]);
  await on(box, claudeAgent(undefined, claudeOwn));
  const before = await filesOf(box);
  await writeFile(join(box.home, '.copilot/agents/helper.agent.md'), (await readFile(join(box.home, '.copilot/agents/helper.agent.md'), 'utf8')).replace('You help.', 'You help a lot.'));
  // Delete reviewer: the click's pass carries out helper's edit first, which saves the record (reviewer deleted with it), and
  // dies writing helper's edit, before reviewer's own entry is told.
  await assert.rejects(deleteIt(box, crashAt(box, 'before-rename')), /crash at before-rename/);
  assert.deepEqual((await historyOf(box)).map(event => event.kind), ['on'], 'the crash left no deletion entry');
  // The next pass finds the deleted agent with no deletion entry, and writes one: Restore is offered and puts every file back.
  await pass(box);
  assert.deepEqual((await historyActions(box)).map(action => `${action.event.kind}: ${action.label}`), ['deleted: Restore']);
  await (await historyActions(box)).find(action => action.label === 'Restore')!.run();
  assert.deepEqual(await filesOf(box), before);
  // Once it is told, nothing is written twice. (The copies that pass removed have an entry of their own, `in-line`, with no Restore.)
  await pass(box);
  assert.equal((await historyOf(box)).filter(event => event.kind === 'deleted' && event.cause !== 'in-line').length, 1);
});

test('An agent whose name only its own tool can hold (it starts with “_”) goes back where it was found: On, Off and On again leave that tool its file, and no other tool is given one', async () => {
  const box = await sandbox();
  try {
    const file = join(box.home, '.claude/agents/_helper.md'), text = '---\nname: _helper\ndescription: Does things\n---\n\nYou do.\n';
    await writeFile(file, text);
    const row = async () => {
      const view = await agentsView(box.context, box.tools), fact = view.items.find(entry => entry.key === '_helper');
      const hashes = Object.fromEntries(Object.entries(fact?.copies ?? {}).map(([tool, copy]) => [tool, copy!.hash]));
      return { item: view.library._helper, row: { key: '_helper', name: fact?.name, hashes, plan: fact?.plan, cannot: fact?.cannot, unseen: fact?.unseen, takeInAnswers: fact?.takeInAnswers } };
    };
    const click = async (which: 'on' | 'off') => { const { row: facts, item } = await row(); return applyAgents(box.context, box.tools, [rowClicks[which](facts, item)]); };
    const there = async () => [await readFile(file, 'utf8').catch(() => undefined), await readFile(join(box.home, '.copilot/agents/_helper.agent.md'), 'utf8').catch(() => undefined), await readFile(join(box.home, '.codex/agents/_helper.toml'), 'utf8').catch(() => undefined)];
    assert.equal((await click('on')).stopped, undefined);
    assert.deepEqual(await there(), [text, undefined, undefined], 'On: it stays where it was found; the others can’t hold that name');
    await click('off');
    assert.deepEqual(await there(), [undefined, undefined, undefined], 'Off takes its one copy out');
    await click('on');
    assert.deepEqual([await there(), (await row()).item?.on], [[text, undefined, undefined], true], 'On again: the tool that held it gets its file back, byte for byte');
  } finally { await box.cleanup(); }
});

test('A name that is not one file’s name (a path in it) is written nowhere, also where the tool has an own part on record: a Pull of such an agent leaves every folder as it was', async () => {
  const box = await sandbox();
  try {
    const listing = async () => (await readdir(box.home, { recursive: true })).filter(path => !path.includes('.central-knot')).sort();
    const before = await listing();
    const text = '---\nname: ../../escaped\ndescription: d\n---\n\nP.\n';
    // An own part on record for a tool that never held the file, as Pull's pass leaves one for Claude Code. (Pull itself names an
    // agent by its repo file, which gitrepo.ts checks; this is the pass's own guard, asked directly.)
    await applyAgents(box.context, box.tools, [], { only: new Set(['helper']), pulled: new Map([['helper', { name: '../../escaped', agent: { name: '../../escaped', description: 'd', prompt: 'P.\n' }, claudeFile: text }]]) });
    await applyAgents(box.context, box.tools, [], { background: true });
    assert.deepEqual(await listing(), before, 'no file anywhere, inside the agents folders or outside them');
  } finally { await box.cleanup(); }
});

test('A pulled agent is named by its file in the repo, as a found one is by its file: front matter that names it otherwise makes no second agent', async () => {
  const box = await sandbox();
  try {
    // The repo holds agents/reviewer.md whose front matter says `name: code-reviewer`.
    const text = '---\nname: code-reviewer\ndescription: Reviews code\n---\n\nYou review code.\n';
    await applyAgents(box.context, box.tools, [], { only: new Set(['reviewer']), pulled: new Map([['reviewer', { name: 'reviewer', agent: { name: 'code-reviewer', description: 'Reviews code', prompt: 'You review code.\n' }, claudeFile: text }]]) });
    await applyAgents(box.context, box.tools, [], { background: true });
    await applyAgents(box.context, box.tools, [], { background: true });
    const view = await agentsView(box.context, box.tools);
    assert.deepEqual([view.items.map(item => item.key), view.library.reviewer?.on, (await readdir(join(box.home, '.claude/agents'))).sort()], [['reviewer'], true, ['reviewer.md']]);
  } finally { await box.cleanup(); }
});

inBox('Two edits, and a crash before the record is saved: after a restart, History names the edit that gave way, so it can be made current', async box => {
  await on(box, claudeAgent('BASE\n'));
  await write(box, 'claude-cli', claudeAgent('CLAUDE LOSER\n'));
  await write(box, 'copilot-cli', claudeAgent('COPILOT WINNER\n'));
  // The later edit wins: Copilot CLI's file is saved after Claude Code's.
  await utimes(fileOf(box, 'copilot-cli'), new Date(), new Date(Date.now() + 5000));
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (String(to) === join(box.home, '.central-knot/agents.json')) throw new Error('crash before the record is saved');
    return original(from, to);
  }; syncBuiltinESMExports();
  try { await assert.rejects(pass(box), /crash before the record is saved/); } finally { fs.rename = original; syncBuiltinESMExports(); }
  // A fresh copy of the module, as after a restart (nothing it kept in memory).
  const fresh = '../src/agents.ts?restart=1';
  const restarted = await import(fresh) as typeof import('../src/agents.ts');
  await restarted.applyAgents(box.context, box.tools, []);
  assert.ok((await historyOf(box)).some(event => event.losers.some(loser => loser.tool === 'claude-cli')), 'the edit that gave way has its History entry');
});

inBox('A process that dies during an agent’s Undo leaves it in every tool: the Undo was told before any file changed, and the next pass finishes it', async box => {
  await on(box, claudeAgent('BASE\n'));
  await write(box, 'claude-cli', claudeAgent('EDIT\n')); await pass(box);
  const event = (await historyOf(box)).find(entry => entry.kind === 'edit')!;
  const script = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {restoreAgent} from './src/agents.ts';
    const original=fs.link;fs.link=async(from,to)=>{if(String(to)===process.env.CK_TARGET)process.exit(73);return original(from,to);};syncBuiltinESMExports();
    const c=JSON.parse(process.env.CK_CONTEXT);c.read=async()=>[];await restoreAgent(c,['claude-cli','copilot-cli','codex-cli'],process.env.CK_EVENT);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, CK_TARGET: fileOf(box, 'claude-cli'), CK_CONTEXT: JSON.stringify(box.context), CK_EVENT: event.id }, encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  await applyAgents(box.context, box.tools, []);
  // The Undo was recorded (the earlier version made current) before any file changed, so the next pass finishes it.
  assert.equal((await readAgents(box.context, 'copilot-cli')).entries[0]?.agent.prompt.trim(), 'BASE');
  assert.equal((await readAgents(box.context, 'claude-cli')).entries[0]?.agent.prompt.trim(), 'BASE');
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
    assert.match((await applyAgents(box.context, tools, [{ key: 'reviewer', on: false, except: [] }])).stopped ?? '', reason);
    assert.match((await restoreAgent(box.context, tools, turnedOn.id)).stopped ?? '', reason);
    const view = await agentsView(box.context, tools);
    assert.deepEqual(view.items.map(agent => agent.key), ['reviewer'], 'the page still reads');
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

inBox('A damaged agents record stops the agents’ part of the pass of the whole home: the page is told why, under Agents sync', async box => {
  await on(box);
  await writeFile(join(box.home, '.central-knot/agents.json'), '{"formatVersion": 3, "items": {');
  const told = passTells((await homePass(box.context, box.tools, true)).synced!);
  assert.deepEqual(told.stopped.map(stop => [stop.item, stop.outcome]), [['Agents sync', 'failed']]);
  assert.match(told.stopped[0].message, /^The agents record is damaged\./);
});

inBox('With an intact record this app has no memory of, a click stops until an explicit Resume, which keeps the record and remembers it', async box => {
  await on(box);
  const generation = (await readRecord(box.home)).record!.generation;
  await rm(join(box.base, 'settings.json'));
  assert.equal((await syncGate(box.context)).state, 'needs-resume');
  const blocked = await turnOff(box);
  assert.deepEqual([/no memory/.test(blocked.stopped ?? ''), blocked.writes], [true, 0]);
  const { row, item } = await seen(box);
  const resumed = await applyAgents(box.context, tools, [{ key: row.key, on: false, except: item!.except }], { resume: true });
  assert.deepEqual([resumed.stopped, resumed.writes], [undefined, 3]);
  assert.equal((await readRecord(box.home)).record!.generation, generation);
  assert.equal((await syncGate(box.context)).state, 'ready');
});

inBox('A choice of copy sent for an agent already in Central Knot is refused in words, and nothing changes', async box => {
  await on(box);
  const done = await applyAgents(box.context, tools, [{ key: 'reviewer', on: true, except: [], seenOn: true, use: 'codex-cli', useHash: 'x' }]);
  assert.deepEqual([done.writes, done.results.map(entry => /in Central Knot already, so there is no copy to choose/.test(entry.message))], [0, [true]]);
});

inBox('A page read before the agent changed is refused, and nothing is written', async box => {
  await on(box);
  const stale = await applyAgents(box.context, tools, [{ key: 'reviewer', on: true, except: [], seenOn: false }]);
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

