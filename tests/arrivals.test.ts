// A tool that came under management by itself (arrivals.ts), one worked example for each line of the rule, on real files: a
// home with Claude Code and Copilot CLI (a chosen folder: a tool is there by its folder), notes in Claude Code and On. Each pass
// runs as main.ts pass runs it: the tools seen before (seeded where none are kept), the pass, then what it saw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { byHand, observe, seenBefore, seenIn, type ToolsSeen } from '../src/arrivals.ts';
import { homePass } from '../src/homepass.ts';
import { managedNow, type ShareContext } from '../src/share.ts';
import { applySkills } from '../src/skills.ts';
import { chooseTools } from '../src/toolchoice.ts';
import { appContext } from './upgrade/start.ts';

async function box() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-arrivals-')));
  const home = join(base, 'home');
  await mkdir(join(home, '.claude/skills/notes'), { recursive: true });
  await mkdir(join(home, '.copilot/skills'), { recursive: true });
  await writeFile(join(home, '.claude/skills/notes/SKILL.md'), '---\nname: notes\ndescription: Notes.\n---\n\nTake notes.\n');
  const context: ShareContext = { ...appContext(home, join(base, 'data')), settleMs: 0 };
  /** One pass of the whole home, as main.ts runs it; `kept` what the settings held for the home. */
  const pass = async (kept: ToolsSeen | undefined, writes = true) => {
    const managed = await managedNow(context, await context.read()), before = await seenBefore(kept, context, managed);
    return observe(before, managed, writes, (await homePass({ ...context, reads: new Map() }, managed, writes)).synced);
  };
  /** notes turned On by its Add, which makes the home's record. */
  const turnOn = async () => assert.equal((await applySkills(context, await managedNow(context, await context.read()), [{ key: 'notes', on: true, except: [] }])).stopped, undefined);
  const codex = (installed: boolean) => (installed ? mkdir(join(home, '.codex/skills'), { recursive: true }) : rm(join(home, '.codex'), { recursive: true }));
  const inCodex = () => readFile(join(home, '.codex/skills/notes/SKILL.md'), 'utf8').then(() => true, () => false);
  return { context, pass, turnOn, codex, inCodex, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('A first setup says nothing; a tool installed later has arrived, with the items copied there, and stays said until closed', async () => {
  const b = await box();
  try {
    const first = await b.pass(undefined);
    assert.deepEqual(first, { managed: ['claude-cli', 'copilot-cli'], arrived: [] }, 'seeded from what is managed: the records name no tool yet');
    await b.turnOn();
    await b.codex(true);
    const seen = await b.pass(await b.pass(first));
    assert.deepEqual([seen, await b.inCodex()], [{ managed: ['claude-cli', 'copilot-cli', 'codex-cli'], arrived: [{ tool: 'codex-cli', copied: 1 }] }, true]);
    assert.deepEqual(await b.pass(seen), seen, 'the next pass says nothing more and keeps the line');
  } finally { await b.cleanup(); }
});

test('With Automatic sync off the arrival is kept with nothing copied; sync on again copies, and says nothing more', async () => {
  const b = await box();
  try {
    await b.turnOn();
    const before = await b.pass(undefined);
    await b.codex(true);
    const off = await b.pass(before, false);
    assert.deepEqual([off.arrived, await b.inCodex()], [[{ tool: 'codex-cli' }], false]);
    assert.deepEqual([(await b.pass(off)).arrived, await b.inCodex()], [[{ tool: 'codex-cli' }], true]);
  } finally { await b.cleanup(); }
});

test('A home the settings keep nothing for is seeded from its records: a tool they name has not arrived, one they don’t has', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await b.pass(undefined);
    assert.deepEqual(await b.pass(undefined), { managed: ['claude-cli', 'copilot-cli'], arrived: [] }, 'as after the last release, which kept nothing');
    await b.codex(true);
    assert.deepEqual((await b.pass(undefined)).arrived, [{ tool: 'codex-cli', copied: 1 }]);
  } finally { await b.cleanup(); }
});

test('A tool seen gone and back has arrived again, its line gone meanwhile; one turned off and on by its Manage switch has not', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await b.codex(true);
    const arrived = await b.pass(await b.pass(undefined));
    await b.codex(false);
    const gone = await b.pass(arrived);
    assert.deepEqual(gone, { managed: ['claude-cli', 'copilot-cli'], arrived: [] }, 'no line names a tool Central Knot doesn’t manage');
    await b.codex(true);
    const back = await b.pass(gone);
    assert.deepEqual(back.arrived, [{ tool: 'codex-cli', copied: 1 }]);
    await chooseTools(b.context, 'codex-cli', false);
    const left = await b.pass({ ...back, arrived: [] });
    await chooseTools(b.context, 'codex-cli', true);
    assert.deepEqual((await b.pass(byHand(left, 'codex-cli'))).arrived, [], 'its switch says what it did');
  } finally { await b.cleanup(); }
});

test('What the settings hold for a home is read in this shape only; anything else is seeded again', () => {
  assert.equal(seenIn(undefined), undefined);
  assert.equal(seenIn({ arrived: [] }), undefined);
  assert.deepEqual(seenIn({ managed: ['codex-cli', 'nonesuch', 3], arrived: [{ tool: 'codex-cli', copied: 2 }, { tool: 'nonesuch' }, { tool: 'pi-cli', copied: 'two' }, 'x'] }),
    { managed: ['codex-cli'], arrived: [{ tool: 'codex-cli', copied: 2 }, { tool: 'pi-cli' }] });
});
