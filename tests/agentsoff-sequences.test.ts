// The sequences the step-4 judges found one click past the earlier tests (FIX-STEP4-R2: Fable's S1–S4, N1, N2, N4, N5 and
// probe 7; Opus's N1, N2, N5, N8, N11, N12), replayed as the page clicks them (agentclicks.ts) on real files in temp homes, each
// with the next plain pass and the next click. Rule A: a tool a standing Off holds gets no copy but that Off's own, put back.
// Rule B: an entry's action stands only while no later Off, deletion, put-back or copy choice changed what it acts on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyAgents, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/manage.ts';
import { choose, claudeAgent, codexOwn, deleteEverywhere, factOf, fields, files, filesOf, historyActions, historyOf, pass, readOf, recordOf, sandbox, synced, toolOff, toolOn, tools, turnOff, turnOn, undo, write, type Box } from './agentclicks.ts';

const offered = async (box: Box) => (await historyActions(box)).filter(action => action.event.kind !== 'added').map(action => `${action.label} (${action.event.kind}${action.event.putBackFrom ? `/${action.event.putBackFrom}` : ''})`);
const entryOf = async (box: Box, id: string) => (await readHistory(box.context)).find(event => event.id === id)!;
const heldIn = async (box: Box) => ((await factOf(box))?.heldOff ?? []).map(entry => entry.tool).sort();
const asRoot = process.getuid?.() === 0;

test('S1: an earlier On’s Turn off again is not offered after a later Off, and the row’s On puts back the newer copy that Off kept', async () => {
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

test('S2: Restore of an older Delete everywhere waits while a newer agent of that name is off, and never writes over it', async () => {
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

test('S3: a copy choice on a row with a tool off puts that copy back first, so the choice replaces it and its Undo gives it back', async () => {
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

test('S4: Off, On, Off: the first On’s Turn off again is not offered, and asked for anyway it says why and does nothing', async () => {
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

test('N1 (Fable): Undo of Delete everywhere on an Off row leaves every tool off as before; one tool’s switch then gives the others nothing', async () => {
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

test('N2 (Fable): Undo of an On whose copies were all edited by hand since takes nothing out, writes no entry and keeps its Undo', async () => {
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

test('N4 (Fable): an Off that stopped part-way (a folder read-only), then Off again: each tool’s kept copy goes back, the oldest Off’s first', { skip: asRoot }, async () => {
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

test('N5 (Fable): a copy that turned up turns the agent on there with its own switch: not synced, nothing asked, and its Undo has it turned up again', async () => {
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

test('Probe 7: Off in one tool, then everywhere, then that tool’s switch: synced, the others off; their On catches them up to its edit without a choice', async () => {
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

test('Seed 1001: an On that stopped part-way leaves that tool off, sync gives it nothing, and the next On puts back its own kept file', { skip: asRoot }, async () => {
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

test('N1 (Opus): an On’s Turn off again waits while a later Off stands, and stands again once that Off is turned on', async () => {
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

test('N2 (Opus): a Restore’s Delete again is not offered after a later Delete everywhere, and asked for anyway it changes nothing', async () => {
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

test('N5 (Opus): a one-way receiver’s Off is turned on from History only after its source: History’s Turn on says so', async () => {
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

test('N8 (Opus): after a copy choice, an earlier On’s Turn off again is not offered; the choice’s Undo gives Codex its own copy back', async () => {
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

test('N11 (Opus): Off, Delete everywhere, its Undo, then On: the deletion’s Delete again is not offered, and nothing is marked deleted', async () => {
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

test('N12 (Opus): the long sequence one click further: after On and a choice, Delete again is refused and Codex keeps the chosen copy', async () => {
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

test('P1 (Opus): an agent file that is a link stays a link through Off and On, and an edit where it points still spreads', async () => {
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

test('P3 (Opus): a copy that turned up differing only in that tool’s own fields is said to be its own, not “It has it already”, and its Undo holds it again', async () => {
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
    assert.ok((await historyOf(box)).some(event => event.turnedUp?.some(loser => loser.tool === 'codex-cli')));
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
    assert.match(on.results.find(entry => entry.harness === 'claude-cli')!.message, /That copy stays; the one kept when you turned it off is in History\.$/);
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
