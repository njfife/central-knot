// The gate for library writes (src/share.ts libraryGate), on real folders in a temp home: the three clicks that write before
// their own pass runs (a skill's Take over, a tool's own switch cleared, Convert to a skill), in a home waiting for Resume
// (refused, unless the click is a Resume, which the gate remembers before anything is written) and in another build's home
// (refused, and nothing written). The pass's own gate: tests/agents.test.ts; a tool's Manage switch: tests/managetool.test.ts;
// Synchronize everything: tests/firstsetup.test.ts; a profile switch: tests/profiles.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertAgentToSkill } from '../src/agentskill.ts';
import { discover } from '../src/discovery.ts';
import { syncGate, type ShareContext } from '../src/share.ts';
import { clearSwitch, takeOver } from '../src/skills.ts';
import { readConverted } from '../src/skillstore.ts';
import { isDisabled, readSwitchFile, setDisabled } from '../src/skillswitch.ts';
import type { HarnessId } from '../src/types.ts';
import { bytes, folderOf, historyOf, put, sandbox, skillText, tools, turnOn, type Box } from './skillclicks.ts';

/** This app forgets the home: its settings file goes and the record stays, intact (share.ts syncGate `needs-resume`). */
async function forget(box: Box) {
  await rm(box.context.settingsPath);
  assert.equal((await syncGate(box.context)).state, 'needs-resume');
}
/** The same home as another build sees it: the record names this one as its owner. */
const otherBuild = (box: Box): ShareContext => ({ ...box.context, build: 'com.example.other', settingsPath: join(box.base, 'other.json') });
const inBox = (name: string, body: (box: Box) => Promise<void>) => test(name, async () => { const box = await sandbox(); try { await body(box); } finally { await box.cleanup(); } });

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
