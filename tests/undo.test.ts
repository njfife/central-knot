// A click's Undo leaves every tool's folder as it was before the click, for both library kinds: the copies the click wrote
// are taken out again, and a copy it took over from a tool (wrote over, or adopted because it was already the same) is that
// tool's own again. Each test clicks as the page does (tests/skillclicks.ts, tests/agentclicks.ts) and undoes the click as
// the strip's Undo does (the History action of each entry the click made).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowClicks } from '../src/libraryrow.ts';
import * as agent from './agentclicks.ts';
import { bytes, choose, everywhere, folderOf, inTool, pass, put, sandbox, seen, send, skillText, turnOn, undo } from './skillclicks.ts';

test('Undo right after taking in a found skill: the copies it made go, the tool it was found in keeps its folder, and the skill is found again', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    const before = await everywhere(box);
    const click = await turnOn(box);
    assert.notEqual(click, 'choose');
    assert.ok((click as Awaited<ReturnType<typeof send>>).made?.length, 'the take-in offers an Undo');
    await undo(box, click as Awaited<ReturnType<typeof send>>);
    assert.deepEqual(await everywhere(box), before);
    const { item } = await seen(box);
    assert.ok(!item || item.deleted, 'found again');
    await pass(box);
    assert.deepEqual(await everywhere(box), before, 'and a later pass leaves it so');
  } finally { await box.cleanup(); }
});

test('Undo of taking in a found skill whose copies differed: each tool has its own copy back, the chosen one and the other', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.') });
    const before = await everywhere(box);
    assert.equal(await turnOn(box), 'choose');
    const click = await choose(box, 'claude-cli');
    await undo(box, click);
    await pass(box);
    assert.deepEqual(await everywhere(box), before);
  } finally { await box.cleanup(); }
});

test('Undo of letting a skill into a tool that held its own copy: that copy is back as it was, and the tool is kept out again', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    await inTool(box, 'codex-cli', true);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Codex’s own.') });
    await pass(box);
    const before = await bytes(folderOf(box, 'codex-cli'));
    const click = await inTool(box, 'codex-cli', false);
    assert.notDeepEqual(await bytes(folderOf(box, 'codex-cli')), before, 'let in, Codex has the current version');
    await undo(box, click);
    await pass(box);
    assert.deepEqual(await bytes(folderOf(box, 'codex-cli')), before);
    assert.deepEqual((await seen(box)).item!.except, ['codex-cli']);
  } finally { await box.cleanup(); }
});

test('Undo of keeping a skill out of Claude Code, where OpenCode has it both ways: OpenCode’s own folder stays', async () => {
  const box = await sandbox(['claude-cli', 'opencode-cli']);
  try {
    await put(box, 'claude-cli');
    await put(box, 'opencode-cli');
    await turnOn(box);
    const before = await everywhere(box);
    const { row, item } = await seen(box);
    const click = await send(box, rowClicks.inHarness(row, item, 'claude-cli', true));
    await undo(box, click);
    await pass(box);
    assert.deepEqual(await everywhere(box), before);
  } finally { await box.cleanup(); }
});

test('Undo of turning an agent on over a different copy made by hand in one tool: that file is back as it was', async () => {
  const box = await agent.sandbox();
  try {
    await agent.write(box, 'claude-cli', agent.claudeAgent());
    await agent.turnOn(box);
    await agent.turnOff(box);
    await agent.write(box, 'codex-cli', agent.codexAgent('Mine, by hand.\n'));
    await agent.pass(box);
    const before = await agent.filesOf(box);
    const { row, item } = await agent.seen(box);
    const click = await agent.applyClick(box, rowClicks.on(row, item));
    await agent.undo(box, click);
    await agent.pass(box);
    assert.deepEqual(await agent.filesOf(box), before);
  } finally { await box.cleanup(); }
});
