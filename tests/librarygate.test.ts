// The gate for library writes (src/share.ts libraryGate), on real folders in a temp home. First its own table: each state a
// home can be in, against each way of asking (only asking, `start`, `resume`, `ownFile`): what it answers, and what it made,
// remembered or lifted (a record an earlier build wrote, to this build's format); and on which platforms a real home lets writes in at all. Then the clicks that write before their own pass runs
// (a skill's Take over, a tool's own switch cleared and its Undo), in a home waiting for Resume (refused, unless the click is
// a Resume, which the gate remembers before anything is written); and clicks refused for a reason of their own, which make
// no record and resume no home. The pass's own gate: tests/agents.test.ts; a tool's Manage switch: tests/managetool.test.ts;
// Synchronize everything: tests/firstsetup.test.ts; a profile switch: tests/profiles.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withLock } from './fslock.ts';

import { NO_PLUGINS, saveProfile, switchProfile } from '../src/profiles.ts';
import { libraryGate, newRecord, remember, saveRecord, syncGate, type Entering, type ShareContext } from '../src/share.ts';
import { writesRealHome } from '../src/machine.ts';
import { applySkills, clearSwitch, restoreSkill, takeOver } from '../src/skills.ts';
import { chooseTools } from '../src/toolchoice.ts';
import { isDisabled, readSwitchFile, setDisabled } from '../src/skillswitch.ts';

import { bytes, folderOf, historyOf, put, sandbox, skillText, tools, turnOff, turnOn, type Box } from './skillclicks.ts';

/** This app forgets the home: its settings file goes and the record stays, intact (share.ts syncGate `needs-resume`). */
async function forget(box: Box) {
  await rm(box.context.settingsPath);
  assert.equal((await syncGate(box.context)).state, 'needs-resume');
}
const inBox = (name: string, body: (box: Box) => Promise<void>, options?: { skip?: boolean | string }) => test(name, options ?? {}, async () => { const box = await sandbox(); try { await body(box); } finally { await box.cleanup(); } });

// ---------- The gate's own table ----------

type HomeState = 'no record' | 'ready' | 'waiting for Resume' | 'a record that can’t be read' | 'a home that can’t be written';
/**
 * A home in `state`, made with share.ts's own steps (the record saved, this app remembering it or not); `format`: the record as
 * a build that wrote that format left it (2: one that knows five tools; 1: from before the library), else this build's own.
 */
async function homeIn(box: Box, state: HomeState, format?: 1 | 2): Promise<ShareContext> {
  const record = join(box.home, '.central-knot/sync.json');
  if (state === 'ready' || state === 'waiting for Resume') await saveRecord(box.home, { ...newRecord(box.context), ...(format ? { formatVersion: format } : {}) });
  if (state === 'ready') await remember(box.context, JSON.parse(await readFile(record, 'utf8')).generation);
  if (state === 'a record that can’t be read') { await mkdir(join(box.home, '.central-knot'), { recursive: true }); await writeFile(record, '{ damaged'); }
  return state === 'a home that can’t be written' ? { ...box.context, mode: 'actual', realHome: box.home, allowActualWrites: false } : box.context;
}
/**
 * What the gate answers a home in `state` asked this way, in a fresh home: refused (and why, the record left byte for byte), or
 * let in, and what it made, remembered or lifted.
 */
async function answer(state: HomeState, asked: Entering, format?: 1 | 2): Promise<string> {
  const box = await sandbox();
  try {
    const context = await homeIn(box, state, format), text = () => readFile(join(box.home, '.central-knot/sync.json'), 'utf8').catch(() => undefined);
    const known = () => readFile(box.context.settingsPath, 'utf8').then(text => !!JSON.parse(text).homes?.[box.home], () => false);
    const [before, knewIt] = [await text(), await known()];
    const gate = await libraryGate(context, asked), after = await text();
    if ('refused' in gate) { assert.equal(after, before, 'a refusal leaves the record as it was'); return `refused: ${gate.refused}`; }
    const lifted = before && after && JSON.parse(before).formatVersion !== JSON.parse(after).formatVersion && `lifted to format ${JSON.parse(after).formatVersion}`;
    return ['let in', gate.record && 'with its record', !before && after && 'record made', !knewIt && await known() && 'remembered', lifted].filter(Boolean).join(', ');
  } finally { await box.cleanup(); }
}
const ways: [string, Entering][] = [['only asked', {}], ['start', { start: true }], ['resume', { resume: true }], ['ownFile', { ownFile: true }]];
const row = async (state: HomeState, format?: 1 | 2) => Object.fromEntries(await Promise.all(ways.map(async ([way, asked]) => [way, await answer(state, asked, format)] as const)));
const refusedEveryWay = (said: Record<string, string>, why: RegExp) => { for (const [way, text] of Object.entries(said)) assert.match(text, why, way); };

inBox('First setup requires write access to the existing store, or to the home that will contain it', async box => {
  const store = join(box.home, '.central-knot');
  for (const folder of [box.home, store]) {
    if (folder === store) await mkdir(store);
    await withLock(folder, 'dir-readonly', async () => {
      assert.equal((await syncGate(box.context)).state, 'stopped');
    });
    assert.deepEqual(await syncGate(box.context), { state: 'first-setup' });
  }
});

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
// A build that knows five tools (0.7.0 alpha 5 and earlier) reads any format above 2 as written by a newer Central Knot and stops
// syncing the home (share.ts FORMAT_VERSION). So whenever the gate lets a write in, asked any way, it lifts such a record first:
// no library write of this build that names a sixth tool is left in a home that build would sync.
test('The gate in a home a build that knows five tools wrote (format 2): letting a write in, asked any way, it lifts the record to format 3 first; a refusal leaves it as it was', async () => {
  const lifted = 'let in, with its record, lifted to format 3';
  assert.deepEqual(await row('ready', 2), { 'only asked': lifted, start: lifted, resume: lifted, ownFile: lifted });
  const said = await row('waiting for Resume', 2);
  for (const way of ['only asked', 'start']) assert.match(said[way], /^refused: This app has an intact sync record but no memory of it\./, way);
  assert.deepEqual([said.resume, said.ownFile], ['let in, with its record, remembered, lifted to format 3', lifted]);
});
test('The gate in a home whose record holds the skills from before the library (format 1): lets writes in and lifts nothing (the skills migration writes format 3)', async () => {
  const ready = 'let in, with its record';
  assert.deepEqual(await row('ready', 1), { 'only asked': ready, start: ready, resume: ready, ownFile: ready });
});
test('The gate in a home whose record can’t be read, and a home that can’t be written: refuses every way, in plain words', async () => {
  refusedEveryWay(await row('a record that can’t be read'), /^refused: The sync record is damaged\. Nothing was written or deleted\./);
  refusedEveryWay(await row('a home that can’t be written'), /^refused: Preview only:/);
});
test('A real home is written on macOS and Linux; on Windows it is preview only, and the gate says so (machine.ts writesRealHome)', async () => {
  const box = await sandbox();
  try {
    const onPlatform = async (platform: string) => {
      const gate = await libraryGate({ ...box.context, mode: 'actual', realHome: box.home, allowActualWrites: writesRealHome(platform) }, {});
      return 'refused' in gate ? `refused: ${gate.refused}` : 'let in';
    };
    assert.deepEqual({ darwin: await onPlatform('darwin'), linux: await onPlatform('linux'), win32: await onPlatform('win32') }, {
      darwin: 'let in', linux: 'let in',
      win32: 'refused: Preview only: writing to real folders works only on macOS and Linux in this version. You can look around; nothing is written.',
    });
  } finally { await box.cleanup(); }
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

inBox('Clearing a tool’s own switch while the skills record is damaged is refused before the switch is touched: it stays, and no entry says it was cleared', async box => {
  const target = await switchedOff(box);
  await writeFile(join(box.home, '.central-knot/skills.json'), '{ damaged');
  assert.match((await clearSwitch(box.context, box.tools, 'notes', 'codex-cli')).stopped ?? '', /The skills record is damaged/);
  assert.deepEqual([await offInCodex(box, target), (await historyOf(box)).filter(event => event.kind === 'switched')], [true, []]);
});

inBox('The Undo of Clearing a tool’s own switch while the skills record is damaged is refused before the switch is set: it stays cleared, and no entry is added', async box => {
  const target = await switchedOff(box);
  assert.equal((await clearSwitch(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
  const cleared = (await historyOf(box)).filter(event => event.kind === 'switched');
  await writeFile(join(box.home, '.central-knot/skills.json'), '{ damaged');
  assert.match((await restoreSkill(box.context, box.tools, cleared.at(-1)!.id)).stopped ?? '', /The skills record is damaged/);
  assert.deepEqual([await offInCodex(box, target), (await historyOf(box)).filter(event => event.kind === 'switched').length], [false, cleared.length]);
});

inBox('The Undo of Clearing a tool’s own switch is refused while the home waits for Resume; after a Resume it sets the switch again', async box => {
  const target = await switchedOff(box);
  assert.equal((await clearSwitch(box.context, box.tools, 'notes', 'codex-cli')).stopped, undefined);
  const cleared = (await historyOf(box)).filter(event => event.kind === 'switched').at(-1)!;
  await forget(box);
  assert.match((await restoreSkill(box.context, box.tools, cleared.id)).stopped ?? '', /no memory of it/);
  assert.equal(await offInCodex(box, target), false, 'refused, the switch stays cleared');
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
    ['a Manage switch that is so already', box => chooseTools(box.context, 'codex-cli', true, true), undefined],
    ['a profile switch that changes nothing', async box => { const { id } = await saveProfile(box.context, { name: 'None' }); return switchProfile(box.context, box.tools, id!, NO_PLUGINS); }, undefined],
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
