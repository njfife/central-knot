// Sequences of clicks on one agent, replayed as the page and History send them (agentclicks.ts) on real files in temp homes: Off,
// On, a tool's own switch, copy choices, Delete everywhere and History's actions, with copies made by hand in between. Each
// test is one sequence that once went wrong one click or one pass later than the tests before it looked, so each asserts the
// next plain pass and the next click too. Three rules run through them (historyrules.ts):
// - Rule A: a tool a standing Off holds gets no copy but that Off's own, put back;
// - Rule B: an entry's action stands only while no later Off, deletion, put-back or copy choice changed what it acts on;
// - a copy an Off kept is never left with no way back (Use the kept copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyAgents, forgetAgentCopies, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/manage.ts';
import { age, choose, claudeAgent, codexOwn, deleteEverywhere, factOf, fields, files, filesOf, historyActions, historyOf, managing, pass, prune, readOf, recordOf, sandbox, synced, toolOff, toolOn, tools, turnOff, turnOn, undo, write, type Box, type Clicked } from './agentclicks.ts';
import type { HarnessId, McpResult } from '../src/types.ts';

const offered = async (box: Box) => (await historyActions(box)).filter(action => action.event.kind !== 'added').map(action => `${action.label} (${action.event.kind}${action.event.putBackFrom ? `/${action.event.putBackFrom}` : ''})`);
const entryOf = async (box: Box, id: string) => (await readHistory(box.context)).find(event => event.id === id)!;
const heldIn = async (box: Box) => ((await factOf(box))?.heldOff ?? []).map(entry => entry.tool).sort();
const asRoot = process.getuid?.() === 0;
/** The agents the files hold, each as its name, description and prompt: one when every tool has the same agent. */
const agentHashes = (files: Record<string, string | undefined>) => new Set(Object.values(files).map(text => text?.replace(/\s+/g, ' ').match(/(You review code\..*?)("""|$)/)?.[1].trim()));

test('An earlier On’s Turn off again is not offered after a later Off, and the row’s On puts back the newer copy that Off kept', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await toolOff(box, 'claude-cli');
    await write(box, 'claude-cli', claudeAgent('Made again by hand, newer.\n'));
    await pass(box);
    const own = (await toolOn(box, 'claude-cli'))!;
    await turnOff(box);
    assert.deepEqual(await offered(box), ['Turn on in all 3 tools (removed)']);
    const stale = await restoreAgent(box.context, tools, own.made[0]);
    assert.match(stale.stopped ?? '', /turned off since, so that no longer applies/);
    await turnOn(box);
    assert.match((await readOf(box, 'claude-cli'))!, /newer/);
    assert.equal((await pass(box)).writes, 0);
  } finally { await box.cleanup(); }
});

test('Restore of an older Delete everywhere waits while a newer agent of that name is off, and never writes over it', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const deleted = (await deleteEverywhere(box))!;
    await write(box, 'copilot-cli', claudeAgent('A new reviewer, made later.\n'));
    await pass(box);
    await turnOff(box);
    const before = await filesOf(box);
    assert.equal((await restoreAgent(box.context, tools, deleted.made[0])).stopped, 'reviewer is off in Copilot CLI now. Turn it on there first.');
    assert.deepEqual(await filesOf(box), before);
    // On first: the new agent back (and synced); the old deletion's Restore then refuses to mix the two, and keeps its entry.
    await turnOn(box);
    const now = await filesOf(box);
    assert.match(now['copilot-cli']!, /made later/);
    assert.equal((await restoreAgent(box.context, tools, deleted.made[0])).stopped, '“reviewer” is managed again with other content. Restoring the old one would replace it; delete or rename the new one first.');
    assert.deepEqual([await filesOf(box), (await pass(box)).writes, (await historyActions(box)).some(action => action.event.id === deleted.made[0])], [now, 0, true]);
  } finally { await box.cleanup(); }
});

test('A copy choice on a row with a tool off puts that copy back first, so the choice replaces it and its Undo gives it back', async () => {
  const box = await sandbox();
  try {
    await write(box, 'claude-cli', claudeAgent('Claude’s.\n'));
    await write(box, 'copilot-cli', claudeAgent('Copilot’s.\n'));
    await write(box, 'codex-cli', codexOwn());
    await pass(box);
    await toolOff(box, 'codex-cli');
    const before = await filesOf(box), rowBefore = await heldIn(box);
    const chose = (await choose(box, 'claude-cli'))!;
    assert.deepEqual([/Claude’s/.test((await readOf(box, 'codex-cli'))!), await heldIn(box), (await pass(box)).writes], [true, [], 0]);
    const choice = (await historyOf(box)).find(event => event.kind === 'chosen')!;
    assert.deepEqual(choice.losers.map(loser => loser.tool).sort(), ['codex-cli', 'copilot-cli']);
    // The click's Undo: Codex's own copy back from the choice, then off there again, as before the click.
    await undo(box, chose);
    assert.deepEqual([await filesOf(box), await heldIn(box), (await pass(box)).writes], [before, rowBefore, 0]);
  } finally { await box.cleanup(); }
});

test('Off, On, Off: the first On’s Turn off again is not offered, and asked for anyway it says why and does nothing', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    const on = (await turnOn(box))!;
    await turnOff(box);
    assert.deepEqual(await offered(box), ['Turn on in all 3 tools (removed)']);
    const history = JSON.stringify(await readHistory(box.context));
    assert.match((await restoreAgent(box.context, tools, on.made[0])).stopped ?? '', /turned off since/);
    assert.equal(JSON.stringify(await readHistory(box.context)), history);
  } finally { await box.cleanup(); }
});

test('Undo of Delete everywhere on an Off row leaves every tool off as before; one tool’s switch then gives the others nothing', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    const record = await recordOf(box), row = await factOf(box);
    const deleted = (await deleteEverywhere(box))!;
    await undo(box, deleted);
    assert.deepEqual([await recordOf(box), (await factOf(box))?.heldOff], [record, row?.heldOff]);
    await toolOn(box, 'codex-cli');
    const next = await pass(box);
    assert.deepEqual([next.writes, Object.keys((await factOf(box))!.copies), await heldIn(box)], [0, ['codex-cli'], ['claude-cli', 'copilot-cli']]);
  } finally { await box.cleanup(); }
});

test('Undo of an On whose copies were all edited by hand since takes nothing out, writes no entry and keeps its Undo', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn());
    await pass(box);
    const on = (await turnOn(box))!;
    await write(box, 'claude-cli', claudeAgent('Edited by hand in Claude Code.\n'));
    await write(box, 'copilot-cli', claudeAgent('Edited by hand in Copilot.\n'));
    const history = JSON.stringify(await readHistory(box.context)), files = await filesOf(box);
    const put = (await historyOf(box)).find(event => event.kind === 'restored' && on.made.includes(event.id))!;
    const answer = await restoreAgent(box.context, tools, put.id);
    assert.match(answer.stopped ?? '', /changed since, so it stays/);
    assert.deepEqual([JSON.stringify(await readHistory(box.context)), await filesOf(box), await offered(box)], [history, files, ['Turn off again in Claude Code and Copilot CLI (restored/off)', 'Use the kept copy in Codex (restored/off)']]);
  } finally { await box.cleanup(); }
});

test('An Off that stopped part-way (a folder read-only), then Off again: each tool’s kept copy goes back, the oldest Off’s first', { skip: asRoot }, async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const before = await filesOf(box);
    await chmod(join(box.home, '.claude/agents'), 0o555);
    const first = (await turnOff(box))!;
    await chmod(join(box.home, '.claude/agents'), 0o755);
    await turnOff(box);
    assert.equal((await restoreAgent(box.context, tools, first.made[0])).stopped, undefined);
    assert.equal((await pass(box)).writes, 0);
    await turnOn(box);
    assert.deepEqual([await filesOf(box), (await pass(box)).writes], [before, 0]);
  } finally { await chmod(join(box.home, '.claude/agents'), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('A copy that turned up turns the agent on there with its own switch: not synced, nothing asked, and its Undo has it turned up again', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn());
    await pass(box);
    const before = await filesOf(box), heldBefore = await heldIn(box);
    const own = (await toolOn(box, 'codex-cli'))!;
    const fact = (await factOf(box))!;
    const next = await pass(box);
    assert.deepEqual([fact.managed, Object.keys(fact.copies), await heldIn(box), next.writes, next.results], [false, ['codex-cli'], ['claude-cli', 'copilot-cli'], 0, []]);
    await undo(box, own);
    assert.deepEqual([await filesOf(box), await heldIn(box), (await pass(box)).writes], [before, heldBefore, 0]);
  } finally { await box.cleanup(); }
});

test('Off in one tool, then everywhere, then that tool’s switch: synced, the others off; their On catches them up to its edit without a choice', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await toolOff(box, 'codex-cli');
    await turnOff(box);
    await toolOn(box, 'codex-cli');
    const fact = (await factOf(box))!;
    assert.deepEqual([fact.managed, [...fact.off].sort(), await heldIn(box)], [true, ['claude-cli', 'copilot-cli'], ['claude-cli', 'copilot-cli']]);
    await write(box, 'codex-cli', codexOwn('Edited in Codex while the others were off.'));
    assert.equal((await pass(box)).writes, 0);
    const on = (await turnOn(box))!;
    assert.equal(on.choose, undefined);
    const now = await filesOf(box);
    assert.deepEqual([/while the others were off/.test(now['claude-cli']!), /while the others were off/.test(now['copilot-cli']!), (await pass(box)).writes], [true, true, 0]);
    // The versions they had are the edit's to put back.
    assert.ok((await historyOf(box)).some(event => event.kind === 'edit'));
  } finally { await box.cleanup(); }
});

test('An On that stopped part-way leaves that tool off, sync gives it nothing, and the next On puts back its own kept file', { skip: asRoot }, async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const before = await filesOf(box);
    await turnOff(box);
    await chmod(join(box.home, '.copilot/agents'), 0o555);
    await turnOn(box);
    await chmod(join(box.home, '.copilot/agents'), 0o755);
    assert.deepEqual([await heldIn(box), (await pass(box)).writes, await readOf(box, 'copilot-cli')], [['copilot-cli'], 0, undefined]);
    await turnOn(box);
    assert.deepEqual([await filesOf(box), (await pass(box)).writes], [before, 0]);
  } finally { await chmod(join(box.home, '.copilot/agents'), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('An On’s Turn off again waits while a later Off stands, and stands again once that Off is turned on', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    const on = (await turnOn(box))!;
    const later = (await turnOff(box))!;
    assert.match((await restoreAgent(box.context, tools, on.made[0])).stopped ?? '', /turned off since/);
    await restoreAgent(box.context, tools, later.made[0]);
    assert.deepEqual(await offered(box), ['Turn off again in all 3 tools (restored/off)', 'Turn off again in all 3 tools (restored/off)']);
    assert.equal((await restoreAgent(box.context, tools, on.made[0])).stopped, undefined);
    assert.deepEqual([Object.values(await filesOf(box)), (await pass(box)).writes], [[undefined, undefined, undefined], 0]);
  } finally { await box.cleanup(); }
});

test('A Restore’s Delete again is not offered after a later Delete everywhere, and asked for anyway it changes nothing', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const first = (await deleteEverywhere(box))!;
    const restored = await restoreAgent(box.context, tools, first.made[0]);
    await pass(box);
    await deleteEverywhere(box);
    const history = JSON.stringify(await readHistory(box.context));
    assert.match((await restoreAgent(box.context, tools, restored.made![0])).stopped ?? '', /deleted since/);
    assert.equal(JSON.stringify(await readHistory(box.context)), history);
  } finally { await box.cleanup(); }
});

test('A one-way receiver’s Off is turned on from History only after its source: History’s Turn on says so', async () => {
  const box = await sandbox();
  try {
    await synced(box, claudeAgent(undefined, fields));
    const before = await filesOf(box);
    const receiver = (await toolOff(box, 'copilot-cli'))!;
    await turnOff(box);
    const files = await filesOf(box);
    assert.equal((await restoreAgent(box.context, tools, receiver.made[0])).stopped, 'Turn on Claude Code’s copy first: it is the source.');
    assert.deepEqual(await filesOf(box), files);
    await turnOn(box);
    assert.deepEqual([await filesOf(box), (await pass(box)).writes], [before, 0]);
  } finally { await box.cleanup(); }
});

test('After a copy choice, an earlier On’s Turn off again is not offered; the choice’s Undo gives Codex its own copy back', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    const own = codexOwn();
    await write(box, 'codex-cli', own);
    await pass(box);
    const on = (await turnOn(box))!;
    assert.equal(on.choose, undefined);
    const chose = (await choose(box, 'claude-cli'))!;
    const put = (await historyOf(box)).find(event => event.kind === 'restored' && on.made.includes(event.id))!;
    assert.match((await restoreAgent(box.context, tools, put.id)).stopped ?? '', /chosen since/);
    await undo(box, chose);
    assert.deepEqual([await readOf(box, 'codex-cli'), (await pass(box)).writes], [own, 0]);
  } finally { await box.cleanup(); }
});

test('Off, Delete everywhere, its Undo, then On: the deletion’s Delete again is not offered, and nothing is marked deleted', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    const deleted = (await deleteEverywhere(box))!;
    const undone = await undo(box, deleted);
    await turnOn(box);
    assert.match((await restoreAgent(box.context, tools, undone[0].made![0])).stopped ?? '', /turned on since/);
    const record = (await recordOf(box))!;
    assert.deepEqual([record.state, record.deleted, Object.values(await filesOf(box)).every(Boolean), (await pass(box)).writes], ['shared', undefined, true, 0]);
  } finally { await box.cleanup(); }
});

test('The long sequence one click further: after On and a choice, Delete again is refused and Codex keeps the chosen copy', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn());
    await pass(box);
    const deleted = (await deleteEverywhere(box))!;
    const undone = await undo(box, deleted);
    await turnOn(box);
    await choose(box, 'claude-cli');
    const files = await filesOf(box);
    assert.match((await restoreAgent(box.context, tools, undone[0].made![0])).stopped ?? '', /since, so that no longer applies/);
    assert.deepEqual([await filesOf(box), (await recordOf(box))?.deleted, (await pass(box)).writes], [files, undefined, 0]);
    void files;
  } finally { await box.cleanup(); }
});

test('An agent file that is a link stays a link through Off and On, and an edit where it points still spreads', async () => {
  const box = await sandbox();
  try {
    const dotfiles = join(box.base, 'dotfiles', 'reviewer.md');
    await mkdir(dirname(dotfiles), { recursive: true });
    await writeFile(dotfiles, claudeAgent());
    await symlink(dotfiles, join(box.home, files['claude-cli']));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }], { settleMs: 0 });
    await turnOff(box);
    assert.equal(await readFile(dotfiles, 'utf8'), claudeAgent(), 'what the link points to stays');
    await turnOn(box);
    assert.equal((await lstat(join(box.home, files['claude-cli']))).isSymbolicLink(), true);
    await writeFile(dotfiles, claudeAgent('Edited in the dotfiles.\n'));
    assert.deepEqual([(await pass(box)).writes, /Edited in the dotfiles/.test((await readOf(box, 'copilot-cli'))!)], [2, true]);
  } finally { await box.cleanup(); }
});

test('A copy that turned up differing only in that tool’s own fields is said to be its own, not “It has it already”, and its Undo holds it again', async () => {
  const box = await sandbox();
  try {
    // Codex's own field: its copy keeps `model = "gpt"` while the agent syncs two-way.
    await synced(box);
    const codex = (await readOf(box, 'codex-cli'))!;
    await write(box, 'codex-cli', codex.replace('description = "Reviews code"\n', 'description = "Reviews code"\nmodel = "gpt"\n'));
    await pass(box);
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codex.replace('description = "Reviews code"\n', 'description = "Reviews code"\nmodel = "mini"\n'));
    const own = (await toolOn(box, 'codex-cli'))!;
    assert.deepEqual(own.results.map(entry => entry.message), ['It has its own “reviewer” now, which turned up since. That copy stays; the one kept when you turned it off is in History.']);
    await undo(box, own);
    assert.deepEqual([await heldIn(box), /mini/.test((await readOf(box, 'codex-cli'))!)], [['codex-cli'], true]);
    // The row's On: the copy that turned up stays, and History still names the one Off took out (gpt).
    await turnOn(box);
    assert.ok((await historyOf(box)).some(event => event.keptAside?.some(loser => loser.tool === 'codex-cli')));
  } finally { await box.cleanup(); }
});

test('Delete everywhere marks the agent deleted only once no tool holds a copy: a page read before it is told so', { skip: asRoot }, async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const stale = (await factOf(box))!;
    await chmod(join(box.home, '.codex/agents'), 0o555);
    await deleteEverywhere(box);
    await chmod(join(box.home, '.codex/agents'), 0o755);
    assert.deepEqual([(await recordOf(box))?.deleted, await readOf(box, 'codex-cli') !== undefined], [undefined, true]);
    await deleteEverywhere(box);
    assert.ok((await recordOf(box))?.deleted);
    // A new reviewer made by hand, and a click from a page read before the deletion: told why nothing changed.
    await write(box, 'claude-cli', claudeAgent('A new one.\n'));
    const late = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: stale.managed, off: [], seenManaged: stale.managed }], { settleMs: 0 });
    assert.match(late.results[0]?.message ?? '', /changed since the page was read \(it was deleted\)/);
  } finally { await chmod(join(box.home, '.codex/agents'), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('Rule A: a change sent while a tool is off (its off naming that tool, as the row reads it) never leaves that tool out once it is turned on', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await toolOff(box, 'codex-cli');
    const fact = (await factOf(box))!;
    assert.deepEqual(fact.off, ['codex-cli']);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: fact.off, seenManaged: true }], { settleMs: 0 });
    assert.deepEqual((await recordOf(box))?.off, []);
    await toolOn(box, 'codex-cli');
    await write(box, 'claude-cli', claudeAgent('Edited after Codex was back.\n'));
    await pass(box);
    assert.match((await readOf(box, 'codex-cli'))!, /Edited after Codex was back/);
  } finally { await box.cleanup(); }
});

test('Rule B: an On that went part-way (a folder read-only) and was finished later pairs with its Off, so an earlier choice keeps its Undo', { skip: asRoot }, async () => {
  const box = await sandbox();
  try {
    // Not synced yet, Codex's copy its own: the choice replaces it.
    const own = codexOwn();
    await write(box, 'claude-cli', claudeAgent());
    await write(box, 'copilot-cli', claudeAgent());
    await write(box, 'codex-cli', own);
    await pass(box);
    await choose(box, 'claude-cli');
    const choice = (await historyOf(box)).findLast(event => event.kind === 'chosen')!;
    assert.deepEqual(choice.losers.map(loser => loser.tool), ['codex-cli']);
    await turnOff(box);
    await chmod(join(box.home, '.claude/agents'), 0o555);
    await turnOn(box);
    await chmod(join(box.home, '.claude/agents'), 0o755);
    await turnOn(box);
    assert.deepEqual([await heldIn(box), (await offered(box)).some(label => label.startsWith('Undo choice'))], [[], true]);
    assert.equal((await restoreAgent(box.context, tools, choice.id, { narrow: true })).stopped, undefined);
    assert.equal(await readOf(box, 'codex-cli'), own);
  } finally { await chmod(join(box.home, '.claude/agents'), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('A one-way receiver turned off after its source was already off goes back alone: the Undo of that click is exact', { skip: asRoot }, async () => {
  const box = await sandbox();
  try {
    await synced(box, claudeAgent(undefined, fields));
    await chmod(join(box.home, '.copilot/agents'), 0o555);
    await turnOff(box);
    await chmod(join(box.home, '.copilot/agents'), 0o755);
    const before = await filesOf(box);
    assert.notEqual(before['copilot-cli'], undefined, 'Copilot CLI’s copy stayed');
    const receiver = (await toolOff(box, 'copilot-cli'))!;
    const undone = await undo(box, receiver);
    assert.deepEqual([undone.map(result => result.stopped), await filesOf(box)], [[undefined], before]);
  } finally { await chmod(join(box.home, '.copilot/agents'), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('A copy made by hand in a one-way source’s tool while it was off never becomes the synced copy: On puts the receivers back and asks', async () => {
  const box = await sandbox();
  try {
    await synced(box, claudeAgent(undefined, fields));
    const before = await filesOf(box);
    await turnOff(box);
    await write(box, 'claude-cli', claudeAgent('Made by hand while it was off.\n', fields));
    await turnOn(box);
    const next = await pass(box);
    const now = await filesOf(box);
    assert.deepEqual([now['copilot-cli'], now['codex-cli'], next.writes, next.results.some(entry => entry.differs)], [before['copilot-cli'], before['codex-cli'], 0, true]);
  } finally { await box.cleanup(); }
});

test('Restore of Delete everywhere never mixes in another agent of that name made since in a tool, synced or not', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const deleted = (await deleteEverywhere(box))!;
    await write(box, 'copilot-cli', claudeAgent('A new reviewer, not synced.\n'));
    await pass(box);
    const files = await filesOf(box);
    assert.equal((await restoreAgent(box.context, tools, deleted.made[0])).stopped, 'A different “reviewer” agent is in Copilot CLI now. Remove or rename it, then restore.');
    assert.deepEqual(await filesOf(box), files);
  } finally { await box.cleanup(); }
});

test('An action already undone, asked for from a page read before, says so', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    const on = (await turnOn(box))!;
    const put = on.made[0];
    assert.equal((await restoreAgent(box.context, tools, put)).stopped, undefined);
    assert.equal((await restoreAgent(box.context, tools, put)).stopped, 'That change was already undone.');
  } finally { await box.cleanup(); }
});

test('Rule B: a copy that turned up and was turned on with its own switch stays that tool’s own: an older Off of that tool doesn’t hold it again', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Made by hand while off.'));
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Made by hand again.'));
    await toolOn(box, 'codex-cli');
    assert.deepEqual([await heldIn(box), /again/.test((await readOf(box, 'codex-cli'))!)], [[], true]);
  } finally { await box.cleanup(); }
});

test('Rule B: an On’s Turn off again ends with a later copy choice, even one of other tools: its Undo would make the agent not synced again under the choice', async () => {
  const box = await sandbox();
  try {
    // Not synced: Claude Code and Codex the same, Copilot CLI its own.
    await write(box, 'claude-cli', claudeAgent());
    await write(box, 'copilot-cli', claudeAgent('Copilot’s own.\n'));
    await write(box, 'codex-cli', codexOwn('You review code.\nBe brief.'));
    await pass(box);
    await toolOff(box, 'codex-cli');
    const on = (await toolOn(box, 'codex-cli'))!;
    await choose(box, 'claude-cli');
    const choice = (await historyOf(box)).findLast(event => event.kind === 'chosen')!;
    assert.deepEqual(choice.losers.map(loser => loser.tool), ['copilot-cli']);
    assert.match((await restoreAgent(box.context, tools, on.made[0])).stopped ?? '', /chosen since/);
    assert.equal((await recordOf(box))?.state, 'shared');
  } finally { await box.cleanup(); }
});

test('An older edit’s Undo waits while a tool’s own copy waits for a choice: it writes over nothing, and goes through once the copy is chosen', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await write(box, 'claude-cli', claudeAgent('You review code.\nEdited before the Off.\n'));
    await pass(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const hand = await readOf(box, 'codex-cli');
    // On keeps Codex's own copy and asks which copy every tool uses.
    assert.match((await turnOn(box))!.results.map(entry => entry.message).join(' '), /That copy stays/);
    const undoEdit = async () => (await historyActions(box)).find(action => action.label === 'Undo edit in all tools')!;
    const before = await filesOf(box);
    assert.equal((await (await undoEdit()).run()).stopped, 'reviewer’s copies differ. Choose which copy every tool uses first.');
    assert.deepEqual([await filesOf(box), (await pass(box)).writes], [before, 0]);
    // The next click, the choice the row asks for: Codex's copy goes to History with the choice's Undo, and the edit's Undo then goes through.
    await choose(box, 'claude-cli');
    assert.equal((await (await undoEdit()).run()).stopped, undefined);
    assert.match((await readOf(box, 'codex-cli'))!, /Be brief/);
    // One click further: the choice's own Undo still gives Codex the copy made by hand, and the pass after it asks again.
    await (await historyActions(box)).find(action => action.label.startsWith('Undo choice'))!.run();
    assert.deepEqual([await readOf(box, 'codex-cli'), (await pass(box)).writes], [hand, 0]);
  } finally { await box.cleanup(); }
});

test('An older edit’s Undo waits the same way after Sync here on a copy changed by hand in a tool that was left out', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await write(box, 'claude-cli', claudeAgent('You review code.\nEdited first.\n'));
    await pass(box);
    const edit = (await historyOf(box)).find(event => event.kind === 'edit')!;
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }], { settleMs: 0 });
    await write(box, 'codex-cli', codexOwn('Codex’s own, by hand.'));
    const hand = await readOf(box, 'codex-cli');
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }], { settleMs: 0 });
    assert.equal((await restoreAgent(box.context, tools, edit.id)).stopped, 'reviewer’s copies differ. Choose which copy every tool uses first.');
    assert.deepEqual([await readOf(box, 'codex-cli'), (await pass(box)).writes], [hand, 0]);
    await choose(box, 'codex-cli');
    assert.equal((await restoreAgent(box.context, tools, edit.id)).stopped, undefined);
  } finally { await box.cleanup(); }
});

test('A copy Off kept stays reachable after On keeps a hand-made copy in its place: Use the kept copy puts it back, before the copy choice and after it, and what it replaces has its own Undo', async () => {
  const box = await sandbox();
  try {
    // A one-way agent: Claude Code's file holds its own settings, which no other copy has.
    await synced(box, claudeAgent(undefined, fields));
    const keptFile = await readOf(box, 'claude-cli');
    await turnOff(box);
    await write(box, 'claude-cli', claudeAgent('Made by hand while it was off.\n', 'model: haiku\n'));
    const hand = await readOf(box, 'claude-cli');
    const on = (await turnOn(box))!;
    const found = on.results.find(entry => entry.harness === 'claude-cli')!;
    assert.deepEqual([found.outcome, found.turnedUp, /That copy stays; the one kept when you turned it off is in History\.$/.test(found.message)], ['stayed', true, true]);
    const useKept = async () => (await historyActions(box)).find(action => action.label === 'Use the kept copy in Claude Code');
    const undoUse = async () => (await historyActions(box)).find(action => action.label === 'Undo in Claude Code');
    // Before the choice: the kept file goes back whole, the hand-made one goes to History, and its Undo brings that back.
    assert.equal((await (await useKept())!.run()).stopped, undefined);
    assert.deepEqual([await readOf(box, 'claude-cli'), await useKept(), (await pass(box)).writes, (await pass(box)).writes], [keptFile, undefined, 0, 0]);
    assert.equal((await (await undoUse())!.run()).stopped, undefined);
    assert.deepEqual([await readOf(box, 'claude-cli'), (await pass(box)).writes], [hand, 0]);
    // The choice the row asks for, either answer: the kept copy is still offered after it.
    await choose(box, 'copilot-cli');
    const chosen = await readOf(box, 'claude-cli');
    assert.match(chosen!, /model: haiku[\s\S]*Be brief/, 'Claude Code’s hand-made file took the chosen prompt and kept its own settings');
    assert.equal((await (await useKept())!.run()).stopped, undefined);
    assert.deepEqual([await readOf(box, 'claude-cli'), (await pass(box)).writes, (await factOf(box))?.managed], [keptFile, 0, true]);
    // One click further: what it replaced comes back with its Undo, and the kept copy is offered again.
    await (await undoUse())!.run();
    assert.deepEqual([await readOf(box, 'claude-cli'), !!(await useKept()), (await pass(box)).writes], [chosen, true, 0]);
  } finally { await box.cleanup(); }
});

test('Two files of one tool with the same name, description and prompt but other settings are both kept: each Off’s own file goes back', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await write(box, 'codex-cli', (await readOf(box, 'codex-cli'))!.replace('name = "reviewer"', 'name = "reviewer"\nmodel = "gpt-5"\nsandbox_mode = "read-only"'));
    await pass(box);
    const withSettings = await readOf(box, 'codex-cli');
    await turnOff(box);
    // Made again by hand without its settings; On keeps that copy, and the next Off keeps it too.
    await write(box, 'codex-cli', codexOwn('You review code.\nBe brief.'));
    await turnOn(box);
    await turnOff(box);
    await turnOn(box);
    assert.equal(await readOf(box, 'codex-cli'), codexOwn('You review code.\nBe brief.'));
    const useKept = (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!;
    assert.equal((await useKept.run()).stopped, undefined);
    assert.equal(await readOf(box, 'codex-cli'), withSettings);
  } finally { await box.cleanup(); }
});

test('Off in the source’s tool changes nothing for the copies still on: they sync two-way as before, and On finds the source as it was', async () => {
  const box = await sandbox();
  try {
    // Two-way from Copilot CLI, whose copy has no settings of its own; Claude Code's has, which are only its own.
    await write(box, 'copilot-cli', claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }], { settleMs: 0 });
    await write(box, 'claude-cli', claudeAgent(undefined, fields));
    await pass(box);
    const before = await recordOf(box);
    assert.deepEqual([before?.origin, (await factOf(box))?.oneWay], ['copilot-cli', undefined]);
    const off = (await toolOff(box, 'copilot-cli'))!;
    assert.deepEqual([(await recordOf(box))?.origin, (await factOf(box))?.oneWay], ['copilot-cli', undefined], 'Claude Code doesn’t become the source of a one-way agent');
    // An edit in Codex while Copilot CLI is off still reaches Claude Code.
    await write(box, 'codex-cli', (await readOf(box, 'codex-cli'))!.replace('Be brief.', 'Edited in Codex.'));
    await pass(box);
    assert.match((await readOf(box, 'claude-cli'))!, /Edited in Codex/);
    await undo(box, off);
    await pass(box);
    const after = await recordOf(box);
    assert.deepEqual([after?.origin, after?.copies.filter(copy => copy.oneWay || copy.stopped), /Edited in Codex/.test((await readOf(box, 'copilot-cli'))!)], ['copilot-cli', [], true]);
  } finally { await box.cleanup(); }
});

test('Undo of On leaves out again a tool that was left out before it, though On’s own pass had taken it back in and asked for a choice', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    // Codex is left out of sync and has no copy; then Off, and a copy made by hand in Codex.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }], { settleMs: 0 });
    await rm(join(box.home, files['codex-cli']));
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const before = { record: await recordOf(box), files: await filesOf(box) };
    assert.deepEqual(before.record?.off, ['codex-cli']);
    const on = (await turnOn(box))!;
    assert.deepEqual([(await recordOf(box))?.off, on.results.some(entry => entry.differs)], [[], true], 'On syncs to every tool again, and Codex’s own copy waits for a choice');
    await undo(box, on);
    const after = await recordOf(box);
    assert.deepEqual([after?.off, after?.state, await filesOf(box), (await pass(box)).writes], [['codex-cli'], before.record?.state, before.files, 0]);
    // The next click, On again, asks as before.
    assert.equal((await turnOn(box))!.results.some(entry => entry.differs), true);
  } finally { await box.cleanup(); }
});

test('Two choices that replaced copies in different tools are undone in either order: the older one first leaves the newer its Undo', async () => {
  const box = await sandbox();
  try {
    // Not synced, each tool with its own copy; two choices in a row.
    await write(box, 'claude-cli', claudeAgent());
    await write(box, 'copilot-cli', claudeAgent('Copilot’s own.\n'));
    await write(box, 'codex-cli', codexOwn('You review code.\nBe brief.'));
    const start = await filesOf(box);
    await choose(box, 'claude-cli');
    const edited = codexOwn('Edited in Codex since.');
    await write(box, 'codex-cli', edited);
    await choose(box, 'copilot-cli');
    const [older, newer] = (await historyOf(box)).filter(event => event.kind === 'chosen');
    // The first replaced Copilot CLI's copy, the second Codex's: neither reached the other's tool.
    assert.deepEqual(await offered(box), ['Undo choice in Copilot CLI (chosen)', 'Undo choice in Codex (chosen)']);
    assert.equal((await restoreAgent(box.context, tools, older.id)).stopped, undefined);
    assert.deepEqual([await readOf(box, 'copilot-cli'), (await recordOf(box))?.state, await offered(box)], [start['copilot-cli'], 'dont-share', ['Undo choice in Codex (chosen)']]);
    assert.equal((await restoreAgent(box.context, tools, newer.id)).stopped, undefined);
    assert.deepEqual([await filesOf(box), (await recordOf(box))?.state, (await pass(box)).writes, await offered(box)], [{ ...start, 'codex-cli': edited }, 'dont-share', 0, []]);
  } finally { await box.cleanup(); }
});

test('A copy choice keeps its Undo for a tool nothing changed since, whatever was clicked in other tools: the copy it replaced there still comes back', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    // Codex gets a copy of its own (off, made by hand, on), and the first choice replaces it.
    const own = codexOwn('Made by hand in Codex.');
    await toolOff(box, 'codex-cli'); await write(box, 'codex-cli', own); await toolOn(box, 'codex-cli');
    await choose(box, 'claude-cli');
    // Then in Claude Code alone: off, a copy by hand, on, and a second choice replaces that; off, by hand and on once more.
    await toolOff(box, 'claude-cli'); await write(box, 'claude-cli', claudeAgent('First by hand.\n')); await toolOn(box, 'claude-cli');
    await choose(box, 'copilot-cli');
    const second = claudeAgent('Second by hand.\n');
    await toolOff(box, 'claude-cli'); await write(box, 'claude-cli', second); await toolOn(box, 'claude-cli');
    // The second choice's Undo ended in Claude Code, its one tool. The first's stands in Codex, which nothing reached since.
    assert.deepEqual((await offered(box)).filter(label => label.includes('choice')), ['Undo choice in Codex (chosen)']);
    const untouched = await readOf(box, 'copilot-cli');
    await (await historyActions(box)).find(action => action.label === 'Undo choice in Codex')!.run();
    // Codex has its own copy back. Claude Code's copy made by hand stays off the record: no pass takes it up as the synced copy.
    assert.deepEqual([await filesOf(box), (await pass(box)).writes], [{ 'claude-cli': second, 'copilot-cli': untouched, 'codex-cli': own }, 0]);
    // The next click: a choice of copy settles all three.
    await choose(box, 'copilot-cli');
    const now = await filesOf(box);
    assert.deepEqual([agentHashes(now).size, (await pass(box)).writes], [1, 0]);
  } finally { await box.cleanup(); }
});

test('A choice’s Undo in one tool leaves a tool that a later On left its own copy as it is: off the record, never read as an edit that spreads', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    // An edit made in Codex that no pass has seen; the choice replaces it.
    const edit = codexOwn('Edited in Codex, not synced yet.');
    await write(box, 'codex-cli', edit);
    await choose(box, 'claude-cli');
    // Later, in Claude Code alone: off, a copy made by hand, on. That copy is Claude Code's own, waiting for a choice.
    const own = claudeAgent('Made by hand in Claude Code.\n');
    await toolOff(box, 'claude-cli'); await write(box, 'claude-cli', own); await toolOn(box, 'claude-cli');
    const untouched = await readOf(box, 'copilot-cli');
    await (await historyActions(box)).find(action => action.label === 'Undo choice in Codex')!.run();
    // Codex's edit is back and waits as before the choice; Claude Code's own copy is not on record, so the pass asks and writes nothing.
    const next = await pass(box);
    assert.deepEqual([await filesOf(box), next.writes, next.results.map(entry => entry.message), (await recordOf(box))?.copies.map(copy => copy.tool).sort()],
      [{ 'claude-cli': own, 'copilot-cli': untouched, 'codex-cli': edit }, 0, ['Copies differ. Choose which copy to use.'], ['codex-cli', 'copilot-cli']]);
  } finally { await box.cleanup(); }
});

test('A choice that replaced two tools’ copies is undone in the one nothing changed since: its own copy comes back, and the other keeps the copy made there later', async () => {
  const box = await sandbox();
  try {
    const copilotOwn = claudeAgent('Copilot’s own before the choice.\n'), made = codexOwn('Made in Codex later.');
    await write(box, 'claude-cli', claudeAgent());
    await write(box, 'copilot-cli', copilotOwn);
    await write(box, 'codex-cli', codexOwn('Codex’s own before the choice.'));
    await choose(box, 'claude-cli');
    await toolOff(box, 'codex-cli'); await write(box, 'codex-cli', made); await toolOn(box, 'codex-cli');
    // Codex keeps a copy made since, so the choice's Undo ended there; nothing touched Copilot CLI.
    assert.deepEqual((await offered(box)).filter(label => label.includes('choice')), ['Undo choice in Copilot CLI (chosen)']);
    await (await historyActions(box)).find(action => action.label === 'Undo choice in Copilot CLI')!.run();
    // As before the choice in Copilot CLI: its own copy, and the agent not synced. Codex keeps what it has, and no pass writes.
    assert.deepEqual([await readOf(box, 'copilot-cli'), await readOf(box, 'codex-cli'), (await recordOf(box))?.state, (await pass(box)).writes], [copilotOwn, made, 'dont-share', 0]);
    // The choice's row says what ended the rest of it; the next click, On, asks which copy every tool uses.
    assert.deepEqual([(await offered(box)).filter(label => label.includes('choice')), (await turnOn(box))?.choose], [[], true]);
  } finally { await box.cleanup(); }
});

test('A choice’s Undo records no copy for a tool an Off holds, though a copy made by hand is there: that copy stays the tool’s own', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await write(box, 'codex-cli', (await readOf(box, 'codex-cli'))!.replace('Be brief.', 'Codex’s edit.'));
    await choose(box, 'claude-cli');
    await toolOff(box, 'copilot-cli');
    await write(box, 'copilot-cli', claudeAgent('Made by hand in Copilot while it was off.\n'));
    const hand = await readOf(box, 'copilot-cli');
    const undoChoice = (await historyActions(box)).find(action => action.label.startsWith('Undo choice'))!;
    assert.equal((await undoChoice.run()).stopped, undefined);
    assert.deepEqual([(await recordOf(box))?.copies.map(copy => copy.tool).sort(), await heldIn(box)], [['claude-cli', 'codex-cli'], ['copilot-cli']]);
    // The next pass spreads Codex's edit, back as before the choice, to Claude Code only.
    await pass(box);
    assert.deepEqual([await readOf(box, 'copilot-cli'), await heldIn(box), /Codex’s edit/.test((await readOf(box, 'claude-cli'))!), (await pass(box)).writes], [hand, ['copilot-cli'], true, 0]);
  } finally { await box.cleanup(); }
});

test('An On that only found a tool’s own copy is undone without removing anything: an Off holds that tool again with the kept copy, which On puts back once the own copy is gone', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const keptFile = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const hand = await readOf(box, 'codex-cli');
    const on = (await toolOn(box, 'codex-cli'))!;
    assert.deepEqual(await offered(box), ['Undo turn on in Codex (restored/off)', 'Use the kept copy in Codex (restored/off)']);
    const undone = await restoreAgent(box.context, tools, on.made[0]);
    assert.deepEqual(undone.results.map(entry => [entry.harness, entry.outcome, entry.message]), [['codex-cli', 'stayed', 'Its own copy is left alone again.']]);
    const again = (await historyOf(box)).at(-1)!;
    assert.deepEqual([again.kind, again.losers, again.keptAside?.map(copy => copy.tool), await readOf(box, 'codex-cli'), await heldIn(box), (await pass(box)).writes], ['removed', [], ['codex-cli'], hand, ['codex-cli'], 0]);
    // The own copy removed by hand: the row's On now puts the kept one back.
    await rm(join(box.home, files['codex-cli']));
    await turnOn(box);
    assert.deepEqual([await readOf(box, 'codex-cli'), (await pass(box)).writes], [keptFile, 0]);
  } finally { await box.cleanup(); }
});

test('History’s Turn on of an older Off puts back only the tools it still holds: one a later Off took over stays off, with that Off’s own copy', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const hand = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    const older = (await historyActions(box)).find(action => action.label === 'Turn on in Claude Code and Copilot CLI')!;
    assert.equal((await older.run()).stopped, undefined);
    assert.deepEqual([await readOf(box, 'codex-cli'), await heldIn(box)], [undefined, ['codex-cli']]);
    await toolOn(box, 'codex-cli');
    assert.equal(await readOf(box, 'codex-cli'), hand);
  } finally { await box.cleanup(); }
});

test('History’s Turn on puts a one-way agent’s source back first, whatever its place among the tools, so no receiving copy is left waiting for it', async () => {
  const box = await sandbox();
  try {
    // The source is Codex, last among the tools: its file holds a setting of its own.
    await write(box, 'codex-cli', codexOwn('You review code.').replace('name = "reviewer"', 'name = "reviewer"\nmodel = "gpt-5"'));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }], { settleMs: 0 });
    assert.equal((await factOf(box))?.oneWay?.from, 'codex-cli');
    const before = await filesOf(box);
    await turnOff(box);
    const turnOnAll = (await historyActions(box)).find(action => action.label === 'Turn on in all 3 tools')!;
    assert.deepEqual((await turnOnAll.run()).results.map(entry => entry.outcome), ['written', 'written', 'written']);
    assert.deepEqual([await filesOf(box), await heldIn(box), (await pass(box)).writes], [before, [], 0]);
  } finally { await box.cleanup(); }
});

test('History keeps every later entry of an agent beside an Off it keeps past its days: a newer Off that took a tool over still puts its own copy back', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const hand = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    await age(box, 91);
    await prune(box.context);
    assert.deepEqual((await historyOf(box)).filter(event => event.turnedOff).map(event => event.losers.map(loser => loser.tool)), [tools, ['codex-cli']]);
    await turnOn(box);
    assert.equal(await readOf(box, 'codex-cli'), hand);
  } finally { await box.cleanup(); }
});

test('Use the kept copy that can’t write its folder changes nothing and stays offered; it waits while an Off holds that tool', { skip: asRoot }, async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const keptFile = await readOf(box, 'codex-cli');
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const on = (await turnOn(box))!;
    const useKept = async () => (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex');
    const before = { files: await filesOf(box), history: JSON.stringify(await historyOf(box)) };
    await chmod(dirname(join(box.home, files['codex-cli'])), 0o555);
    const blocked = await (await useKept())!.run();
    await chmod(dirname(join(box.home, files['codex-cli'])), 0o755);
    assert.match(blocked.stopped ?? '', /^Could not put it back in Codex: its agents folder can’t be written\.$/);
    assert.deepEqual([await filesOf(box), JSON.stringify(await historyOf(box)), !!(await useKept())], [before.files, before.history, true]);
    // While an Off holds Codex it is not offered, and asked for anyway (a page read before) it says to turn it on first.
    await toolOff(box, 'codex-cli');
    assert.equal(await useKept(), undefined);
    assert.equal((await restoreAgent(box.context, tools, on.made[0], { keptIn: 'codex-cli' })).stopped, 'reviewer is off in Codex now. Turn it on there first.');
    await toolOn(box, 'codex-cli');
    assert.equal((await (await useKept())!.run()).stopped, undefined);
    assert.deepEqual([await readOf(box, 'codex-cli'), (await pass(box)).writes], [keptFile, 0]);
  } finally { await chmod(dirname(join(box.home, files['codex-cli'])), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('Two copies made by hand in a tool while it was off, each turned off in turn: every kept copy still has a way back, the oldest too', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await write(box, 'codex-cli', (await readOf(box, 'codex-cli'))!.replace('name = "reviewer"', 'name = "reviewer"\nmodel = "gpt-5"'));
    await pass(box);
    const first = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Second, made by hand.'));
    const second = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Third, made by hand.'));
    const third = await readOf(box, 'codex-cli');
    // Codex's own switch turns it on with the third copy; History keeps the second and the first.
    await toolOn(box, 'codex-cli');
    assert.deepEqual([await readOf(box, 'codex-cli'), await heldIn(box)], [third, []]);
    const useKept = async () => (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!;
    // Each click gives the next kept copy not in place; what it replaces has its own Undo.
    await (await useKept()).run();
    assert.equal(await readOf(box, 'codex-cli'), second);
    await (await useKept()).run();
    assert.equal(await readOf(box, 'codex-cli'), first);
    await (await useKept()).run();
    assert.equal(await readOf(box, 'codex-cli'), second);
    const undoUse = (await historyActions(box)).filter(action => action.label === 'Undo in Codex');
    assert.equal(undoUse.length, 1, 'only the latest use has its Undo: the earlier ones ended with it');
    await undoUse[0].run();
    assert.deepEqual([await readOf(box, 'codex-cli'), (await pass(box)).writes, (await pass(box)).writes], [first, 0, 0]);
  } finally { await box.cleanup(); }
});

test('An Off that holds two kept copies for one tool puts the newer back and leaves the older in History, still offered', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const first = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Second, made by hand.'));
    const second = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Third, made by hand.'));
    // Turned on with the third copy, and that undone: one Off holds Codex again, with both kept copies and nothing removed.
    await toolOn(box, 'codex-cli');
    await (await historyActions(box)).find(action => action.label === 'Undo turn on in Codex')!.run();
    const off = (await historyOf(box)).at(-1)!;
    assert.deepEqual([off.losers, off.keptAside?.map(copy => copy.tool)], [[], ['codex-cli', 'codex-cli']]);
    // The third copy removed by hand: On puts the second back, and the first is offered.
    await rm(join(box.home, files['codex-cli']));
    await turnOn(box);
    assert.equal(await readOf(box, 'codex-cli'), second);
    await (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!.run();
    assert.deepEqual([await readOf(box, 'codex-cli'), (await pass(box)).writes], [first, 0]);
  } finally { await box.cleanup(); }
});

test('History’s Turn on of an older Off whose tool a later Off took over leaves it open for that tool: once the later Off is turned on, its own kept copy is still offered', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const first = await readOf(box, 'codex-cli');
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Second, made by hand.'));
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Third, made by hand.'));
    // The older Off puts back what it still holds, and is not spent: Codex's first copy is still its to give.
    await (await historyActions(box)).find(action => action.label === 'Turn on in Claude Code and Copilot CLI')!.run();
    const older = (await historyOf(box)).find(event => event.turnedOff)!;
    assert.deepEqual([older.undoneBy, older.restoredTools], [undefined, ['claude-cli', 'copilot-cli']]);
    await toolOn(box, 'codex-cli');
    const useKept = async () => (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!;
    await (await useKept()).run();
    await (await useKept()).run();
    assert.deepEqual([await readOf(box, 'codex-cli'), (await historyOf(box)).find(event => event.id === older.id)?.undoneBy !== undefined], [first, true]);
  } finally { await box.cleanup(); }
});

test('Delete everywhere that leaves one tool’s copy (its folder read-only) leaves that copy its tool’s own, off the record', { skip: asRoot }, async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await chmod(dirname(join(box.home, files['copilot-cli'])), 0o555);
    await deleteEverywhere(box);
    await chmod(dirname(join(box.home, files['copilot-cli'])), 0o755);
    const record = await recordOf(box);
    assert.deepEqual([record?.state, record?.copies, Object.keys((await factOf(box))!.copies)], ['dont-share', [], ['copilot-cli']]);
  } finally { await chmod(dirname(join(box.home, files['copilot-cli'])), 0o755).catch(() => undefined); await box.cleanup(); }
});

test('Undo of Use the kept copy needs only its own entry: it still goes through after History’s days dropped the On that offered it', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const hand = await readOf(box, 'codex-cli');
    await turnOn(box);
    await age(box, 29);
    await (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!.run();
    // History's days pass for the Off and for the On that offered the kept copy; the use of it is newer, and stays.
    await age(box, 2);
    assert.deepEqual((await historyOf(box)).map(event => event.kind), ['chosen']);
    assert.equal((await (await historyActions(box)).find(action => action.label === 'Undo in Codex')!.run()).stopped, undefined);
    assert.equal(await readOf(box, 'codex-cli'), hand);
  } finally { await box.cleanup(); }
});


test('The kept copy never becomes the synced copy by itself: where it differs from what is synced it waits for a choice, and a hand edit since keeps it from its Undo', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    await turnOn(box);
    // Every tool takes Codex's hand-made copy; then the kept one goes back in Codex, and differs from what is synced.
    await choose(box, 'codex-cli');
    await (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!.run();
    const waits = await pass(box);
    assert.deepEqual([waits.writes, waits.results.some(entry => entry.differs), /Made by hand/.test((await readOf(box, 'claude-cli'))!)], [0, true, true]);
    // Changed by hand since, the copy there is the person's to keep: the Undo of the use writes nothing over it.
    await write(box, 'codex-cli', codexOwn('Edited again by hand.'));
    const undoUse = (await historyActions(box)).find(action => action.label === 'Undo in Codex')!;
    assert.equal((await undoUse.run()).stopped, 'Codex’s copy of reviewer changed since, so nothing was undone here.');
  } finally { await box.cleanup(); }
});

test('Where the tool already holds the kept copy, byte for byte, Use the kept copy says so once and is offered no more', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const keptFile = await readOf(box, 'codex-cli');
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    await turnOn(box);
    // Every tool takes Claude Code's copy: Codex's file is then what the kept copy was.
    await choose(box, 'claude-cli');
    assert.equal(await readOf(box, 'codex-cli'), keptFile);
    const useKept = async () => (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex');
    const already = await (await useKept())!.run();
    assert.deepEqual([already.stopped, already.results.map(entry => entry.message), await useKept()], [undefined, ['Codex has that copy already.'], undefined]);
  } finally { await box.cleanup(); }
});

test('The row’s On also turns on an older Off left waiting for a tool: no copy stays turned up under it, and its kept copy is offered', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const first = await readOf(box, 'codex-cli');
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Second, made by hand.'));
    const second = await readOf(box, 'codex-cli');
    await toolOff(box, 'codex-cli');
    // The older Off turned on for the tools it still holds; Codex is the newer Off's.
    await (await historyActions(box)).find(action => action.label === 'Turn on in Claude Code and Copilot CLI')!.run();
    assert.deepEqual(((await factOf(box))?.heldOff ?? []).map(entry => [entry.tool, entry.older?.length]), [['codex-cli', 1]]);
    // One click: the newer Off's copy goes back, and the older Off, finding it there, is done with Codex too.
    await turnOn(box);
    assert.deepEqual([await heldIn(box), await readOf(box, 'codex-cli')], [[], second]);
    await (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!.run();
    assert.equal(await readOf(box, 'codex-cli'), first);
  } finally { await box.cleanup(); }
});

test('An Off put back part-way, finished by a tool’s own switch, and that undone: an older Off still holds the tool whose own copy it left alone', { skip: asRoot }, async () => {
  const box = await sandbox();
  const copilotFolder = dirname(join(box.home, files['copilot-cli']));
  try {
    await synced(box);
    await turnOff(box);
    const own = claudeAgent('Made by hand while it was off.\n');
    await write(box, 'claude-cli', own);
    // On, then its Undo with Copilot CLI's folder read-only: Codex is off again, and Claude Code's own copy is left alone again.
    const on = (await turnOn(box))!;
    await chmod(copilotFolder, 0o555);
    await undo(box, on);
    await chmod(copilotFolder, 0o755);
    // Off takes Claude Code's own copy and Copilot CLI's; its Undo puts only Claude Code's back.
    const off = (await turnOff(box))!;
    await chmod(copilotFolder, 0o555);
    await undo(box, off);
    await chmod(copilotFolder, 0o755);
    const before = [await filesOf(box), await heldIn(box)];
    assert.deepEqual(before[1], ['claude-cli', 'codex-cli', 'copilot-cli']);
    // Copilot CLI's own switch finishes that Off; its Undo is that tool off again, and nothing else.
    await undo(box, (await toolOn(box, 'copilot-cli'))!);
    assert.deepEqual([await filesOf(box), await heldIn(box), (await pass(box)).writes], [...before, 0]);
    // The next click: On puts Copilot CLI's and Codex's copies back, and Claude Code keeps its own.
    await turnOn(box);
    assert.deepEqual([Object.values(await filesOf(box)).every(text => text !== undefined), await readOf(box, 'claude-cli'), await heldIn(box)], [true, own, []]);
  } finally { await chmod(copilotFolder, 0o755).catch(() => undefined); await box.cleanup(); }
});

test('Restore of a Delete everywhere brings back the Off it ended: where the agent is on again in that Off’s tool, its copy there goes off the record and is left alone', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const original = (await readOf(box, 'claude-cli'))!;
    await toolOff(box, 'codex-cli');
    await deleteEverywhere(box);
    // The same agent made again by hand and turned on: synced to all three, Codex too.
    await write(box, 'claude-cli', original);
    await turnOn(box);
    assert.deepEqual([(await recordOf(box))?.copies.length, await heldIn(box)], [3, []]);
    const everywhere = await filesOf(box);
    await (await historyActions(box)).find(action => action.label.startsWith('Restore in'))!.run();
    // Codex is off again, as before the deletion. Its copy stays where it is, off the record, and no pass touches it.
    assert.deepEqual([await heldIn(box), (await recordOf(box))?.copies.map(copy => copy.tool).sort(), (await pass(box)).writes, await filesOf(box)], [['codex-cli'], ['claude-cli', 'copilot-cli'], 0, everywhere]);
    // The next click: On finds Codex's copy and takes it up again.
    await turnOn(box);
    assert.deepEqual([await heldIn(box), (await pass(box)).writes, (await recordOf(box))?.copies.length, await filesOf(box)], [[], 0, 3, everywhere]);
  } finally { await box.cleanup(); }
});

test('Undo of Use the kept copy gives the copy it puts back its edit time again, so “Edited most recently” stays on the same copy', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    await toolOff(box, 'codex-cli');
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    const edited = new Date('2026-10-01T12:00:00.000Z');
    await utimes(join(box.home, files['codex-cli']), edited, edited);
    await toolOn(box, 'codex-cli');
    await (await historyActions(box)).find(action => action.label === 'Use the kept copy in Codex')!.run();
    await (await historyActions(box)).find(action => action.label === 'Undo in Codex')!.run();
    assert.deepEqual([/Made by hand/.test((await readOf(box, 'codex-cli'))!), (await stat(join(box.home, files['codex-cli']))).mtime], [true, edited]);
  } finally { await box.cleanup(); }
});

test('Restore of a Delete everywhere made on an Off row is refused while a tool holds another agent of that name, made since: the Off it brings back never mixes the two', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const before = await filesOf(box);
    await turnOff(box);
    await deleteEverywhere(box);
    const made = codexOwn('Another reviewer, made after the deletion.');
    await write(box, 'codex-cli', made);
    await pass(box);
    const restore = (await historyActions(box)).find(action => action.label === 'Restore')!;
    assert.equal((await restore.run()).stopped, 'A different “reviewer” agent is in Codex now. Remove or rename it, then restore.');
    // Nothing changed: the new agent is Codex's own, no Off row came back, and the pass writes nothing.
    assert.deepEqual([await filesOf(box), await heldIn(box), (await pass(box)).writes], [{ 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': made }, [], 0]);
    // The next click: with the new one out of the way, Restore brings the Off row back, and On each copy.
    await rm(join(box.home, files['codex-cli']));
    assert.equal((await restore.run()).stopped, undefined);
    await turnOn(box);
    assert.deepEqual([await filesOf(box), (await pass(box)).writes], [before, 0]);
  } finally { await box.cleanup(); }
});

test('Turn off again on an On that made the agent synced leaves it not synced with no copy on record: a later edit in a tool that stayed on asks, and never spreads', async () => {
  const box = await sandbox();
  try {
    await synced(box);
    const original = (await readOf(box, 'claude-cli'))!;
    await turnOff(box);
    // Claude Code gets the same agent again by hand, turned on there as its own; the row's On then puts the other two back.
    await write(box, 'claude-cli', original);
    await toolOn(box, 'claude-cli');
    await turnOn(box);
    assert.deepEqual([(await recordOf(box))?.state, (await pass(box)).writes, (await recordOf(box))?.copies.length], ['shared', 0, 3]);
    await (await historyActions(box)).find(action => action.label === 'Turn off again in Copilot CLI and Codex')!.run();
    assert.deepEqual([(await recordOf(box))?.state, (await recordOf(box))?.copies, await heldIn(box)], ['dont-share', [], ['codex-cli', 'copilot-cli']]);
    // The next click: an edit by hand in Claude Code, then On. Its copy was never the synced one again, so the pass asks.
    const edited = original.replace('Be brief.', 'Edited while the others were off.');
    await write(box, 'claude-cli', edited);
    await turnOn(box);
    const next = await pass(box);
    assert.deepEqual([next.writes, next.results.map(entry => entry.message), await readOf(box, 'claude-cli'), /Be brief\./.test((await readOf(box, 'copilot-cli'))!)], [0, ['Copies differ. Choose which copy to use.'], edited, true]);
  } finally { await box.cleanup(); }
});

test('A kept copy still on offer doesn’t go at the click that finishes its Off after History’s days: the Off’s rows stay for History’s days from that click', { skip: asRoot }, async () => {
  const box = await sandbox();
  const context = { ...box.context, historyDays: 7 as const };
  try {
    await synced(box);
    const kept = await readOf(box, 'codex-cli');
    await turnOff(box);
    await write(box, 'codex-cli', codexOwn('Made by hand while it was off.'));
    // On goes part-way (Copilot CLI's folder can't be written): the Off stays open, and the On's row offers Codex's kept copy.
    await chmod(dirname(join(box.home, files['copilot-cli'])), 0o555);
    await turnOn(box, context);
    await chmod(dirname(join(box.home, files['copilot-cli'])), 0o755);
    await age(box, 31);
    await prune(context);
    const labels = async () => (await historyActions(box, context)).map(action => action.label);
    assert.ok((await labels()).includes('Use the kept copy in Codex'));
    // The click that finishes the Off, long after History's days.
    await turnOn(box, context);
    await prune(context);
    assert.deepEqual([await heldIn(box), (await labels()).includes('Use the kept copy in Codex')], [[], true]);
    await (await historyActions(box, context)).find(action => action.label === 'Use the kept copy in Codex')!.run();
    assert.equal(await readOf(box, 'codex-cli'), kept);
    // History's days after that click, the Off and its rows go.
    await age(box, 8);
    await prune(context);
    assert.deepEqual((await historyOf(box, context)).filter(event => event.turnedOff || event.putBackFrom), []);
  } finally { await chmod(dirname(join(box.home, files['copilot-cli'])), 0o755).catch(() => undefined); await box.cleanup(); }
});

// A one-way agent (Claude Code's, with fields of its own) that is off, once Claude Code is no longer a tool Central Knot manages
// here. Its kept copy can't go back, and the copies that received it one-way must not wait for it for good: each way of turning
// the agent on gives Copilot CLI and Codex their copies back as ordinary copies, which sync with each other from then on.
const withoutClaude: HarnessId[] = ['copilot-cli', 'codex-cli'];
const claudeStays = 'Claude Code isn’t one of the tools Central Knot manages here now, so its copy stays in History.';
const said = (answer: Clicked | McpResult | undefined) => [answer?.stopped, ...(answer?.results ?? []).map(entry => entry.message)];
const sourceGone: [string, (box: Box) => Promise<unknown>][] = [
  ['is not installed any more', async () => undefined],
  ['was left out by the tool choice', box => forgetAgentCopies(box.home, withoutClaude)],
];
const restore = async (box: Box) => (await historyActions(box)).find(action => action.label.startsWith('Restore'))!.run();
/** Each way the agent's copies are taken out and put back: [its name, the click that takes them out, the clicks that put them back, whether the answer names Claude Code's copy]. */
const turnedOnBy: [string, (box: Box) => Promise<unknown>, (box: Box) => Promise<Clicked | McpResult | undefined>, boolean][] = [
  ['the row’s On', turnOff, box => turnOn(box), true],
  ['each tool’s own switch', turnOff, async box => { await toolOn(box, 'codex-cli'); return toolOn(box, 'copilot-cli'); }, false],
  ['History’s Turn on', turnOff, async box => (await historyActions(box)).find(action => action.label.startsWith('Turn on in'))!.run(), true],
  ['Delete everywhere on its Off row, Restore, then the row’s On', turnOff, async box => { await deleteEverywhere(box); await restore(box); return turnOn(box); }, true],
  ['Restore, after Delete everywhere took its copies', deleteEverywhere, restore, true],
];
for (const [gone, leave] of sourceGone) for (const [route, takeOut, turnItOn, saysClaudeStays] of turnedOnBy) {
  test(`A one-way agent whose source’s tool ${gone} while it was off comes back with ${route}: the receiving copies as ordinary copies that sync with each other`, async () => {
    const box = await sandbox();
    try {
      await synced(box, claudeAgent(undefined, fields));
      const before = await filesOf(box);
      await takeOut(box);
      await leave(box);
      await managing(withoutClaude, async () => {
        // No tool's switch waits for a source that can't come back.
        assert.deepEqual(((await factOf(box))?.heldOff ?? []).flatMap(entry => entry.source ?? []), []);
        const answer = await turnItOn(box);
        assert.deepEqual(await filesOf(box), { 'copilot-cli': before['copilot-cli'], 'codex-cli': before['codex-cli'] });
        if (saysClaudeStays) assert.ok(said(answer).includes(claudeStays), said(answer).join(' | '));
        // The next pass: quiet, a source picked among the two, neither one-way.
        const next = await pass(box);
        assert.deepEqual([next.writes, next.results.filter(entry => entry.outcome === 'held').map(entry => entry.message)], [0, []]);
        const record = (await recordOf(box))!;
        assert.deepEqual([record.state, withoutClaude.includes(record.origin!), record.copies.map(copy => [copy.tool, !!copy.oneWay]).sort()], ['shared', true, [['codex-cli', false], ['copilot-cli', false]]]);
        // An edit in one reaches the other, both ways.
        await write(box, 'codex-cli', before['codex-cli']!.replace('Be brief.', 'Edited in Codex.'));
        await pass(box);
        assert.match((await readOf(box, 'copilot-cli'))!, /Edited in Codex\./);
        await write(box, 'copilot-cli', (await readOf(box, 'copilot-cli'))!.replace('Edited in Codex.', 'Edited in Copilot CLI.'));
        await pass(box);
        assert.match((await readOf(box, 'codex-cli'))!, /Edited in Copilot CLI\./);
        // The next click: Off and On again give both back, and the pass after is quiet.
        const now = await filesOf(box);
        await turnOff(box);
        await turnOn(box);
        assert.deepEqual([await filesOf(box), (await pass(box)).writes], [now, 0]);
      });
    } finally { await box.cleanup(); }
  });
}
