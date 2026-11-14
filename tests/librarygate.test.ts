// The gate for library writes (src/share.ts libraryGate), on real folders in a temp home. First its own table: each state a
// home can be in, against each way of asking (only asking, `start`, `resume`, `ownFile`): what it answers, and what it made or
// remembered. Then the clicks that write before their own pass runs (a skill's Take over, a tool's own switch cleared and its
// Undo, Convert to a skill), in a home waiting for Resume (refused, unless the click is a Resume, which the gate remembers
// before anything is written) and in another build's home (refused, and nothing written); and clicks refused for a reason of
// their own, which make no record and resume no home. The pass's own gate: tests/agents.test.ts; a tool's Manage switch:
// tests/managetool.test.ts; Synchronize everything: tests/firstsetup.test.ts; a profile switch: tests/profiles.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertAgentToSkill } from '../src/agentskill.ts';
import { discover } from '../src/discovery.ts';
import { saveProfile, switchProfile } from '../src/profiles.ts';
import { libraryGate, newRecord, remember, saveRecord, syncGate, type Entering, type ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, restoreSkill, takeOver } from '../src/skills.ts';
import { chooseTools } from '../src/toolchoice.ts';
import { readConverted } from '../src/skillstore.ts';
import { isDisabled, readSwitchFile, setDisabled } from '../src/skillswitch.ts';
import type { HarnessId } from '../src/types.ts';
import { bytes, folderOf, historyOf, put, sandbox, skillText, tools, turnOff, turnOn, type Box } from './skillclicks.ts';

/** This app forgets the home: its settings file goes and the record stays, intact (share.ts syncGate `needs-resume`). */
async function forget(box: Box) {
  await rm(box.context.settingsPath);
  assert.equal((await syncGate(box.context)).state, 'needs-resume');
}
/** The same home as another build sees it: the record names this one as its owner. */
const otherBuild = (box: Box): ShareContext => ({ ...box.context, build: 'com.example.other', settingsPath: join(box.base, 'other.json') });
const inBox = (name: string, body: (box: Box) => Promise<void>) => test(name, async () => { const box = await sandbox(); try { await body(box); } finally { await box.cleanup(); } });

// ---------- The gate's own table ----------

type HomeState = 'no record' | 'ready' | 'waiting for Resume' | 'another build’s' | 'a record that can’t be read' | 'a home that can’t be written';
/** A home in `state`, made with share.ts's own steps (the record saved, this app remembering it or not). */
async function homeIn(box: Box, state: HomeState): Promise<ShareContext> {
  const record = join(box.home, '.central-knot/sync.json');
  if (state === 'ready' || state === 'waiting for Resume') await saveRecord(box.home, newRecord(box.context));
  if (state === 'ready') await remember(box.context, JSON.parse(await readFile(record, 'utf8')).generation);
  if (state === 'another build’s') await saveRecord(box.home, newRecord(otherBuild(box)));
  if (state === 'a record that can’t be read') { await mkdir(join(box.home, '.central-knot'), { recursive: true }); await writeFile(record, '{ damaged'); }
  return state === 'a home that can’t be written' ? { ...box.context, mode: 'actual', realHome: box.home, allowActualWrites: false } : box.context;
}
/** What the gate answers a home in `state` asked this way, in a fresh home: refused (and why), or let in, and what it made or remembered. */
async function answer(state: HomeState, asked: Entering): Promise<string> {
  const box = await sandbox();
  try {
    const context = await homeIn(box, state), recorded = () => readFile(join(box.home, '.central-knot/sync.json'), 'utf8').then(() => true, () => false);
    const known = () => readFile(box.context.settingsPath, 'utf8').then(text => !!JSON.parse(text).homes?.[box.home], () => false);
    const [hadRecord, knewIt] = [await recorded(), await known()];
    const gate = await libraryGate(context, asked);
    if ('refused' in gate) return `refused: ${gate.refused}`;
    return ['let in', gate.record && 'with its record', !hadRecord && await recorded() && 'record made', !knewIt && await known() && 'remembered'].filter(Boolean).join(', ');
  } finally { await box.cleanup(); }
}
const ways: [string, Entering][] = [['only asked', {}], ['start', { start: true }], ['resume', { resume: true }], ['ownFile', { ownFile: true }]];
const row = async (state: HomeState) => Object.fromEntries(await Promise.all(ways.map(async ([way, asked]) => [way, await answer(state, asked)] as const)));
const refusedEveryWay = (said: Record<string, string>, why: RegExp) => { for (const [way, text] of Object.entries(said)) assert.match(text, why, way); };

test('The gate in a home with no sync record: lets every write in; only `start` makes the record and remembers it', async () => {
  assert.deepEqual(await row('no record'), { 'only asked': 'let in', start: 'let in, with its record, record made, remembered', resume: 'let in', ownFile: 'let in' });
});
test('The gate in a home this app syncs: lets every write in with its record, and makes nothing', async () => {
  const ready = 'let in, with its record';
  assert.deepEqual(await row('ready'), { 'only asked': ready, start: ready, resume: ready, ownFile: ready });
});
test('The gate in a home waiting for Resume: refuses, unless the click is a Resume (remembered then) or the file is Central Knot’s own (nothing remembered)', async () => {
  const said = await row('waiting for Resume');
  for (const way of ['only asked', 'start']) assert.match(said[way], /^refused: This app has an intact sync record but no memory of it\./, way);
  assert.deepEqual([said.resume, said.ownFile], ['let in, with its record, remembered', 'let in, with its record']);
});
test('The gate in another build’s home, a home whose record can’t be read, and a home that can’t be written: refuses every way, in plain words', async () => {
  refusedEveryWay(await row('another build’s'), /^refused: Another Central Knot build \(com\.example\.other\) syncs this home, so nothing was written or deleted\./);
  refusedEveryWay(await row('a record that can’t be read'), /^refused: The sync record is damaged\. Nothing was written or deleted\./);
  refusedEveryWay(await row('a home that can’t be written'), /^refused: Preview only:/);
});

// ---------- Take over ----------

/** "notes" On in Central Knot, taken in from ~/.agents/skills, which Copilot CLI and Codex read: Take over's case. The shared folder. */
async function sharedCopy(box: Box) {
  const shared = join(box.home, '.agents/skills/notes');
  await mkdir(shared, { recursive: true });
  await writeFile(join(shared, 'SKILL.md'), skillText('In the shared folder.'));
  assert.notEqual(await turnOn(box), 'choose');
  return shared;
}

inBox('Take over in a home waiting for Resume is refused unless the click is a Resume: then the shared copy goes and every tool that read it gets Central Knot’s copy', async box => {
  const shared = await sharedCopy(box);
  await forget(box);
  assert.match((await takeOver(box.context, box.tools, 'notes', 'codex-cli')).stopped ?? '', /no memory of it/);
  assert.ok(await bytes(shared), 'the shared copy stays');
  assert.deepEqual((await historyOf(box)).filter(event => event.kind === 'took-over'), [], 'and no entry says it went');
  const done = await takeOver(box.context, box.tools, 'notes', 'codex-cli', true);
  assert.equal(done.stopped, undefined);
  assert.equal(await bytes(shared), undefined, 'the shared copy is gone');
  for (const tool of tools) assert.equal(await readFile(join(folderOf(box, tool), 'SKILL.md'), 'utf8'), skillText('In the shared folder.'), tool);
  assert.equal((await syncGate(box.context)).state, 'ready', 'the home is resumed');
});

inBox('Take over in another build’s home is refused, and the shared copy stays', async box => {
  const shared = await sharedCopy(box);
  assert.match((await takeOver(otherBuild(box), box.tools, 'notes', 'codex-cli', true)).stopped ?? '', /syncs this home/);
  assert.ok(await bytes(shared));
  assert.deepEqual((await historyOf(box)).filter(event => event.kind === 'took-over'), []);
});

// ---------- A tool's own switch cleared ----------

/** "notes" On in every tool, with Codex's own switch turning it off there. The switch's target. */
async function switchedOff(box: Box) {
  await put(box, 'claude-cli');
  assert.notEqual(await turnOn(box), 'choose');
  const target = { folder: 'notes', name: 'notes', skillFile: join(folderOf(box, 'codex-cli'), 'SKILL.md') };
  await setDisabled(box.context, 'codex-cli', target, true);
  return target;
}
const offInCodex = async (box: Box, target: Awaited<ReturnType<typeof switchedOff>>) => isDisabled(box.context, await readSwitchFile(box.context, 'codex-cli'), target);

inBox('Clearing a tool’s own switch in a home waiting for Resume is refused unless the click is a Resume: then it is cleared and its pass runs', async box => {
  const target = await switchedOff(box);
  await forget(box);
  assert.match((await clearSwitch(box.context, box.tools, 'notes', 'codex-cli')).stopped ?? '', /no memory of it/);
  assert.deepEqual([await offInCodex(box, target), (await historyOf(box)).filter(event => event.kind === 'switched')], [true, []], 'the switch stays, and no entry says it was cleared');
  const cleared = await clearSwitch(box.context, box.tools, 'notes', 'codex-cli', true);
  assert.equal(cleared.stopped, undefined, 'its own pass ran too');
  assert.deepEqual([await offInCodex(box, target), (await syncGate(box.context)).state], [false, 'ready']);
});

inBox('Clearing a tool’s own switch in another build’s home is refused: the switch stays, and History says nothing', async box => {
  const target = await switchedOff(box);
  assert.match((await clearSwitch(otherBuild(box), box.tools, 'notes', 'codex-cli', true)).stopped ?? '', /syncs this home/);
  assert.deepEqual([await offInCodex(box, target), (await historyOf(box)).filter(event => event.kind === 'switched')], [true, []]);
});

// ---------- Convert to a skill ----------

/** An agent "reviewer" in Claude Code, Pi installed beside it, and a sync record (a skill taken in). The context and its tools. */
async function agentAndPi(box: Box) {
  await put(box, 'claude-cli');
  assert.notEqual(await turnOn(box), 'choose');
  await mkdir(join(box.home, '.claude/agents'), { recursive: true });
  await mkdir(join(box.home, '.pi/agent'), { recursive: true });
  await writeFile(join(box.home, '.claude/agents/reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\n');
  const withPi: HarnessId[] = ['claude-cli', 'pi-cli'];
  return { withPi, context: { ...box.context, read: () => Promise.all(withPi.map(harness => discover({ home: box.home, mode: 'custom', harness }))) } };
}
const piSkill = (box: Box) => bytes(join(box.home, '.pi/agent/skills/reviewer'));

inBox('Convert to a skill in a home waiting for Resume is refused unless the click is a Resume: then Pi has the skill and the home is resumed', async box => {
  const { withPi, context } = await agentAndPi(box);
  await forget(box);
  assert.match((await convertAgentToSkill(context, withPi, 'reviewer')).stopped ?? '', /no memory of it/);
  assert.deepEqual([await piSkill(box), (await readConverted(box.home)).reviewer], [undefined, undefined], 'nothing written, nothing recorded');
  assert.equal((await convertAgentToSkill(context, withPi, 'reviewer', true)).stopped, undefined);
  assert.ok(await piSkill(box));
  assert.equal((await syncGate(box.context)).state, 'ready');
});

inBox('Convert to a skill in another build’s home is refused: Pi gets nothing, and nothing is recorded', async box => {
  const { withPi, context } = await agentAndPi(box);
  assert.match((await convertAgentToSkill({ ...context, ...otherBuild(box), read: context.read }, withPi, 'reviewer', true)).stopped ?? '', /syncs this home/);
  assert.deepEqual([await piSkill(box), (await readConverted(box.home)).reviewer], [undefined, undefined]);
});

inBox('The Undo of Clearing a tool’s own switch is refused in another build’s home and while the home waits for Resume; after a Resume it sets the switch again', async box => {
  const target = await switchedOff(box);
  assert.equal((await clearSwitch(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
  const cleared = (await historyOf(box)).filter(event => event.kind === 'switched').at(-1)!;
  assert.match((await restoreSkill(otherBuild(box), box.tools, cleared.id)).stopped ?? '', /syncs this home/);
  await forget(box);
  assert.match((await restoreSkill(box.context, box.tools, cleared.id)).stopped ?? '', /no memory of it/);
  assert.equal(await offInCodex(box, target), false, 'refused twice, the switch stays cleared');
  assert.equal((await applySkills(box.context, box.tools, [], { resume: true })).stopped, undefined, 'Resume');
  assert.equal((await restoreSkill(box.context, box.tools, cleared.id)).stopped, undefined);
  assert.equal(await offInCodex(box, target), true);
});

// ---------- Clicks refused for a reason of their own ----------

/** Whether the home has a sync record, and what the gate says of it: what a click that did nothing must leave as it was. */
const homeNow = async (box: Box) => [await readFile(join(box.home, '.central-knot/sync.json'), 'utf8').then(() => 'record', () => 'no record'), (await syncGate(box.context)).state];

test('A click refused for a reason of its own, or that changes nothing, makes no record and resumes no home', async () => {
  const clicks: [string, (box: Box) => Promise<{ stopped?: string }>, RegExp | undefined][] = [
    ['Clear the switch, with no switch set', box => clearSwitch(box.context, box.tools, 'notes', 'codex-cli', true), /doesn’t turn notes off any more\. Nothing was changed\./],
    ['Take over, with no copy to take', box => takeOver(box.context, box.tools, 'notes', 'codex-cli', true), /Nothing was changed|Turn it on first/],
    ['Convert, of an agent that is gone', box => convertAgentToSkill(box.context, [...box.tools, 'pi-cli'], 'nobody', true), /That agent is not there any more\./],
    ['a Manage switch that is so already', box => chooseTools(box.context, 'codex-cli', true, true), undefined],
    ['a profile switch that changes nothing', async box => { const { id } = await saveProfile(box.context, { name: 'None' }); return switchProfile(box.context, box.tools, id!); }, undefined],
  ];
  for (const [click, run, says] of clicks) for (const home of ['no record', 'waiting for Resume'] as const) {
    const box = await sandbox();
    try {
      await put(box, 'claude-cli');
      if (home === 'waiting for Resume') { await turnOn(box); await turnOff(box); await rm(box.context.settingsPath); }
      const before = await homeNow(box), done = await run(box);
      if (says) assert.match(done.stopped ?? '', says, `${click}, ${home}`);
      else assert.equal(done.stopped, undefined, `${click}, ${home}`);
      assert.deepEqual(await homeNow(box), before, `${click}, ${home}: the home is as it was`);
    } finally { await box.cleanup(); }
  }
});
