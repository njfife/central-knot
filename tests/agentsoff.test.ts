// Off really turns an agent off (step 4 of one switch per item): no tool has a switch for a person's own agent, so Off removes
// each tool's copy, History keeps it whatever its age, and On puts each back exactly. Replayed on real files in temp homes, with
// the next plain pass and the next click checked after each step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentsView, applyAgents, readAgentRecord, restoreAgent } from '../src/agents.ts';
import { pruneHistory, readHistory } from '../src/manage.ts';
import { DAY_MS } from '../src/model.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId, HistoryEvent } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const files = { 'claude-cli': '.claude/agents/reviewer.md', 'copilot-cli': '.copilot/agents/reviewer.agent.md', 'codex-cli': '.codex/agents/reviewer.toml' } as const;
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-agents-off-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/agents', '.copilot/agents', '.codex/agents']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof sandbox>>;
const claudeAgent = (prompt = 'You review code.\nBe brief.\n', extra = '') => `---\nname: reviewer\ndescription: Reviews code\n${extra}---\n\n${prompt}`;
/** Claude Code's own fields: the others receive it one-way. */
const fields = 'tools: Read, Grep\nmodel: opus\n';
const read = (box: Box, tool: keyof typeof files) => readFile(join(box.home, files[tool]), 'utf8').catch(() => undefined);
const everyFile = async (box: Box) => Object.fromEntries(await Promise.all(tools.map(async tool => [tool, await read(box, tool as keyof typeof files)] as const)));
const recordNow = async (box: Box) => { const item = (await readAgentRecord(box.home)).items.reviewer; return item && { ...item, copies: [...item.copies].sort((first, second) => first.tool.localeCompare(second.tool)) }; };
const latest = async (box: Box, kind: HistoryEvent['kind']) => (await readHistory(box.context)).findLast(event => event.kind === kind && event.key === 'agent:reviewer')!;
const at = (box: Box, days: number): ShareContext => ({ ...box.context, now: () => Date.now() + days * DAY_MS });
/** Off as the main switch sends it: each tool's copy removed (no tool has a switch for a person's own agent). */
const off = (managed = true, remove: HarnessId[] = tools) => ({ key: 'reviewer', managed, off: [] as HarnessId[], seenManaged: managed, remove, turnOff: true });

/** A synced agent from Claude Code with fields of its own (one-way to the others), and Codex's copy stopped on an edit there. */
async function syncedOneWay(box: Box) {
  await writeFile(join(box.home, files['claude-cli']), claudeAgent(undefined, fields));
  await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
  await writeFile(join(box.home, files['codex-cli']), (await read(box, 'codex-cli'))!.replace('Be brief.', 'Codex only.'));
  await applyAgents(box.context, tools, []);
  assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['codex-cli']);
}

test('Off removes every copy, History keeps them whatever its age, and On puts each back exactly: the files, the source, the one-way and stopped marks', async () => {
  const box = await sandbox();
  try {
    await syncedOneWay(box);
    const filesBefore = await everyFile(box), recordBefore = await recordNow(box);
    const turned = await applyAgents(box.context, tools, [off()]);
    assert.deepEqual(turned.results.filter(entry => entry.outcome === 'removed').map(entry => entry.harness), tools);
    for (const folder of ['.claude/agents', '.copilot/agents', '.codex/agents']) assert.deepEqual(await readdir(join(box.home, folder)), []);
    const removal = await latest(box, 'removed');
    assert.deepEqual([turned.made, removal.turnedOff, removal.unmanaged, removal.stoppedSync], [[removal.id], true, true, tools]);
    // Its row stays, off, with each tool's copy in History; the next plain pass writes nothing and puts nothing back.
    const view = await agentsView(box.context, tools);
    assert.deepEqual([view.servers, view.gone?.map(item => [item.key, item.gone?.turnedOff, item.removed?.map(entry => entry.tool)])], [[], [['reviewer', true, tools]]]);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    // A year later, past History's days, and after a prune: the row and its way back are still there.
    const later = at(box, 365);
    assert.equal(await pruneHistory(later), 'done');
    assert.deepEqual((await readHistory(later)).map(event => event.id), [removal.id]);
    assert.deepEqual((await agentsView(later, tools)).gone?.map(item => item.key), ['reviewer']);
    const on = await restoreAgent(later, tools, removal.id);
    assert.equal(on.stopped, undefined, JSON.stringify(on));
    assert.deepEqual([await everyFile(box), await recordNow(box)], [filesBefore, recordBefore]);
    assert.deepEqual((await agentsView(later, tools)).servers[0].stopped, ['codex-cli'], 'Codex keeps its edit, stopped');
    const plain = await applyAgents(later, tools, [], { settleMs: 0 });
    assert.deepEqual([plain.writes, plain.results.some(entry => entry.outcome === 'held')], [0, false], JSON.stringify(plain.results));
    // Turned on again, its entry ages like any other.
    assert.equal(await pruneHistory(later), 'done');
    assert.deepEqual(await readHistory(later), []);
    // A source edit still reaches Copilot CLI one-way, and not Codex's edit.
    await writeFile(join(box.home, files['claude-cli']), claudeAgent('Newer.\n', fields));
    await applyAgents(box.context, tools, []);
    assert.deepEqual([/Newer\./.test((await read(box, 'copilot-cli'))!), await read(box, 'codex-cli')], [true, filesBefore['codex-cli']]);
  } finally { await box.cleanup(); }
});

test('Undo of Off is On, and Undo of On is Off: each a History entry the click made, a second Undo too', async () => {
  const box = await sandbox();
  try {
    await syncedOneWay(box);
    const filesBefore = await everyFile(box), recordBefore = await recordNow(box);
    const turned = await applyAgents(box.context, tools, [off()]);
    const offRecord = await recordNow(box);
    // Undo of Off: the click's own entry, undone.
    const undone = await restoreAgent(box.context, tools, turned.made![0]);
    assert.deepEqual([undone.stopped, await everyFile(box), await recordNow(box)], [undefined, filesBefore, recordBefore]);
    // Its Undo (On's Undo) is Off again, exactly; and a further Undo is On again.
    const again = await restoreAgent(box.context, tools, undone.made![0]);
    assert.equal(again.stopped, undefined, JSON.stringify(again));
    assert.deepEqual([Object.values(await everyFile(box)), await recordNow(box)], [[undefined, undefined, undefined], offRecord]);
    assert.equal((await latest(box, 'removed')).id, again.made![0]);
    assert.deepEqual((await agentsView(box.context, tools)).gone?.map(item => item.gone?.history), [again.made![0]]);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    assert.equal((await restoreAgent(box.context, tools, again.made![0])).stopped, undefined);
    assert.deepEqual([await everyFile(box), await recordNow(box)], [filesBefore, recordBefore]);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
  } finally { await box.cleanup(); }
});

test('After Off everywhere, one tool’s switch puts back that tool’s copy alone; the others stay off, in History, and its Undo takes it out again', async () => {
  const box = await sandbox();
  try {
    await syncedOneWay(box);
    const filesBefore = await everyFile(box);
    const removal = (await applyAgents(box.context, tools, [off()])).made![0];
    const one = await restoreAgent(box.context, tools, removal, 'claude-cli');
    assert.deepEqual([one.stopped, await everyFile(box)], [undefined, { ...filesBefore, 'copilot-cli': undefined, 'codex-cli': undefined }]);
    const record = await recordNow(box);
    assert.deepEqual([record?.state, record?.off, record?.origin], ['shared', ['copilot-cli', 'codex-cli'], 'claude-cli']);
    // The rest of the removal stays open, and so on offer; no pass gives the others a copy.
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].removed, [{ tool: 'copilot-cli', history: removal }, { tool: 'codex-cli', history: removal }]);
    assert.deepEqual((await readHistory(at(box, 365))).find(event => event.id === removal)?.restoredTools, ['claude-cli'], 'still standing, a year on');
    // Its Undo: Claude Code's copy goes again, and the agent is off everywhere as before.
    assert.equal((await restoreAgent(box.context, tools, one.made![0])).stopped, undefined);
    assert.deepEqual([Object.values(await everyFile(box)), (await agentsView(box.context, tools)).gone?.flatMap(item => item.removed?.map(entry => entry.tool))], [[undefined, undefined, undefined], ['claude-cli', 'copilot-cli', 'codex-cli']]);
    // On from the row: every removal still open goes back, each copy as it was.
    for (const id of new Set((await agentsView(box.context, tools)).gone![0].removed!.map(entry => entry.history))) assert.equal((await restoreAgent(box.context, tools, id)).stopped, undefined);
    assert.deepEqual(await everyFile(box), filesBefore);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
  } finally { await box.cleanup(); }
});

test('Off in one tool removes its copy there only: sync never puts it back nor spreads the removal, an edit reaches the others, and its own switch puts it back', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, files['claude-cli']), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const codexBefore = (await read(box, 'codex-cli'))!.replace('description = "Reviews code"\n', 'description = "Reviews code"\nmodel = "gpt"\n');
    await writeFile(join(box.home, files['codex-cli']), codexBefore);
    await applyAgents(box.context, tools, []);
    const turned = await applyAgents(box.context, tools, [off(true, ['codex-cli'])]);
    assert.deepEqual([turned.writes, await read(box, 'codex-cli'), (await recordNow(box))?.state, (await recordNow(box))?.off], [1, undefined, 'shared', ['codex-cli']]);
    // Not put back, not spread as a deletion; an edit reaches Copilot CLI and not Codex.
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    await writeFile(join(box.home, files['claude-cli']), claudeAgent('Edited in Claude Code.\n'));
    const spread = await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.deepEqual([spread.writes, /Edited in Claude Code/.test((await read(box, 'copilot-cli'))!), await read(box, 'codex-cli')], [1, true, undefined]);
    const view = await agentsView(box.context, tools);
    assert.deepEqual([view.servers[0].managed, view.servers[0].removed], [true, [{ tool: 'codex-cli', history: turned.made![0] }]]);
    // Its switch: Codex's own file back (its own model line too), then the next pass catches it up, as a copy only behind.
    const back = await restoreAgent(box.context, tools, view.servers[0].removed![0].history, 'codex-cli');
    assert.deepEqual([back.stopped, await read(box, 'codex-cli'), (await recordNow(box))?.off], [undefined, codexBefore, []]);
    const caught = await applyAgents(box.context, tools, [], { settleMs: 0 });
    const codexNow = (await read(box, 'codex-cli'))!;
    assert.deepEqual([caught.writes, /Edited in Claude Code/.test(codexNow), codexNow.includes('model = "gpt"'), (await readHistory(box.context)).some(event => event.kind === 'edit' && event.losers.some(loser => loser.tool === 'codex-cli'))], [1, true, true, false]);
    assert.deepEqual([(await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, (await agentsView(box.context, tools)).servers[0].removed], [0, undefined]);
    // Undo of that switch: Codex's copy goes again, as it was put back.
    const putBack = await latest(box, 'restored');
    assert.equal(putBack.turnedOff, undefined, 'the removal was put back whole');
  } finally { await box.cleanup(); }
});

test('Off removes the last copy: a copy that turns up again by hand is left alone, said as such, and On puts the rest back, asking for a choice where it differs', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, files['claude-cli']), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const turned = await applyAgents(box.context, tools, [off()]);
    const removal = turned.made![0];
    // Codex's own reviewer turns up by hand. No pass touches it, nor gives the others a copy.
    const own = 'name = "reviewer"\ndescription = "Reviews code"\ndeveloper_instructions = """\nCodex’s own.\n"""\n';
    await writeFile(join(box.home, files['codex-cli']), own);
    for (let pass = 0; pass < 2; pass++) assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    assert.deepEqual([await read(box, 'claude-cli'), await read(box, 'copilot-cli'), await read(box, 'codex-cli')], [undefined, undefined, own]);
    const view = await agentsView(box.context, tools);
    assert.deepEqual([view.gone, view.servers[0].managed, view.servers[0].removed?.map(entry => entry.tool), Object.keys(view.servers[0].copies)], [[], false, tools, ['codex-cli']]);
    // A stale page that still showed it on changes nothing.
    assert.equal((await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, remove: ['codex-cli'], turnOff: true }])).results[0].unchanged, true);
    // On: the others back as they were; Codex keeps its own, which is new input.
    const back = await restoreAgent(box.context, tools, removal);
    assert.deepEqual([back.stopped, back.results.map(entry => [entry.harness, entry.outcome])], [undefined, [['claude-cli', 'written'], ['copilot-cli', 'written'], ['codex-cli', 'stayed']]]);
    assert.equal(await read(box, 'codex-cli'), own);
    assert.ok((await readHistory(box.context)).find(event => event.id === removal)?.undoneBy, 'the removal is done');
    // Synced again with Codex's copy different: the pass holds for a choice and writes nothing.
    const held = await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.deepEqual([held.writes, held.results.some(entry => entry.differs)], [0, true]);
    assert.equal(await read(box, 'codex-cli'), own);
  } finally { await box.cleanup(); }
});

test('Off of an agent that isn’t synced removes each tool’s own copy, and On puts each back as it was, still not synced', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, files['claude-cli']), claudeAgent('Claude’s.\n'));
    const own = 'name = "reviewer"\ndescription = "Reviews code"\ndeveloper_instructions = """\nCodex’s own.\n"""\n';
    await writeFile(join(box.home, files['codex-cli']), own);
    const filesBefore = await everyFile(box);
    const turned = await applyAgents(box.context, tools, [off(false, ['claude-cli', 'codex-cli'])]);
    assert.deepEqual([turned.writes, Object.values(await everyFile(box)), (await latest(box, 'removed')).unmanaged], [2, [undefined, undefined, undefined], undefined]);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    assert.equal((await restoreAgent(box.context, tools, turned.made![0])).stopped, undefined);
    assert.deepEqual([await everyFile(box), (await agentsView(box.context, tools)).servers[0].managed], [filesBefore, false]);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
  } finally { await box.cleanup(); }
});

test('Delete everywhere is the only real delete: no row stays, History restores it exactly, and an Off row it deletes ages out as History does', async () => {
  const box = await sandbox();
  try {
    await syncedOneWay(box);
    const filesBefore = await everyFile(box), recordBefore = await recordNow(box);
    const deleted = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, remove: tools, everywhere: true }]);
    const deletion = await latest(box, 'deleted');
    assert.deepEqual([deleted.made, deletion.everywhere, Object.values(await everyFile(box))], [[deletion.id], true, [undefined, undefined, undefined]]);
    const view = await agentsView(box.context, tools);
    assert.deepEqual([view.servers, view.gone], [[], []]);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    // Restore puts each copy back exactly, its record too; its Undo deletes it again.
    const restored = await restoreAgent(box.context, tools, deletion.id);
    assert.deepEqual([restored.stopped, await everyFile(box), await recordNow(box)], [undefined, filesBefore, recordBefore]);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    const again = await restoreAgent(box.context, tools, restored.made![0]);
    assert.deepEqual([again.stopped, Object.values(await everyFile(box)), (await agentsView(box.context, tools)).gone], [undefined, [undefined, undefined, undefined], []]);
    // Off, then Delete everywhere on its Off row: the row goes, its Undo brings it back, and once deleted it ages out.
    await restoreAgent(box.context, tools, again.made![0]);
    const turned = await applyAgents(box.context, tools, [off()]);
    const dropped = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: tools, seenManaged: false, remove: [], everywhere: true }]);
    assert.deepEqual([dropped.made?.length, (await agentsView(box.context, tools)).gone], [1, []]);
    // The Off it ended can't be turned on from History any more: the deletion's Restore is the way back.
    assert.match((await restoreAgent(box.context, tools, turned.made![0])).stopped ?? '', /was deleted since/);
    assert.equal((await everyFile(box))['claude-cli'], undefined);
    assert.equal((await restoreAgent(box.context, tools, dropped.made![0])).stopped, undefined);
    assert.deepEqual((await agentsView(box.context, tools)).gone?.map(item => item.gone?.history), [turned.made![0]]);
    const later = at(box, 365);
    assert.deepEqual((await agentsView(later, tools)).gone?.map(item => item.key), ['reviewer'], 'Off stands again');
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: tools, seenManaged: false, remove: [], everywhere: true }]);
    assert.equal(await pruneHistory(later), 'done');
    assert.deepEqual([await readHistory(later), (await agentsView(later, tools)).gone], [[], []]);
  } finally { await box.cleanup(); }
});
