// A tool that came under management by itself (arrivals.ts), one worked example for each line of the rule, on real files: a
// home with Claude Code and Copilot CLI (a chosen folder: a tool is there by its folder), notes in Claude Code and On. Each pass
// runs as main.ts pass runs it: the tools seen before (seeded where none are kept), the pass, then what it saw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { withLock } from './fslock.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { byHand, observe, passStarts, seenBefore, seenIn, type ToolsSeen } from '../src/arrivals.ts';
import { homePass } from '../src/homepass.ts';
import { readHistory } from '../src/history.ts';
import { managedNow, type ShareContext } from '../src/share.ts';
import { applySkills } from '../src/skills.ts';
import { applyAgents } from '../src/agents.ts';
import { chooseTools } from '../src/toolchoice.ts';
import { appContext } from './upgrade/start.ts';
import type { DestinationResult, HarnessId, PassResult } from '../src/types.ts';

async function box() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-arrivals-')));
  const home = join(base, 'home');
  await mkdir(join(home, '.claude/skills/notes'), { recursive: true });
  await mkdir(join(home, '.copilot/skills'), { recursive: true });
  await writeFile(join(home, '.claude/skills/notes/SKILL.md'), '---\nname: notes\ndescription: Notes.\n---\n\nTake notes.\n');
  const context: ShareContext = { ...appContext(home, join(base, 'data')), settleMs: 0 };
  /** One pass of the whole home, as main.ts runs it with the app open since the first; `kept` what the settings held for the home. */
  const pass = async (kept: ToolsSeen | undefined, writes = true) => {
    const managed = await managedNow(context, await context.read()), since = passStarts(home), before = await seenBefore(kept, context, managed);
    return observe(context, before, managed, since, (await homePass({ ...context, reads: new Map() }, managed, writes)).synced);
  };
  /** notes turned On by its Add, which makes the home's record. */
  const turnOn = async () => assert.equal((await applySkills(context, await managedNow(context, await context.read()), [{ key: 'notes', on: true, except: [] }])).stopped, undefined);
  const codex = (installed: boolean) => (installed ? mkdir(join(home, '.codex/skills'), { recursive: true }) : rm(join(home, '.codex'), { recursive: true }));
  const inCodex = () => readFile(join(home, '.codex/skills/notes/SKILL.md'), 'utf8').then(() => true, () => false);
  return { home, context, pass, turnOn, codex, inCodex, cleanup: () => rm(base, { recursive: true, force: true }) };
}

/** An arrival as the line reads it: the tool and its count. */
const said = (seen: ToolsSeen) => seen.arrived.map(({ tool, copied }) => (copied === undefined ? { tool } : { tool, copied }));
/** History's "Copied to Codex" entries: each copy a pass with no click behind it put in Codex. */
const copiedTo = async (b: { context: ShareContext }) => (await readHistory(b.context)).filter(event => event.cause === 'in-line' && event.only === 'codex-cli');

test('A first setup says nothing; a tool installed later has arrived, with the items copied there, and stays said until closed', async () => {
  const b = await box();
  try {
    const first = await b.pass(undefined);
    assert.deepEqual(first, { managed: ['claude-cli', 'copilot-cli'], arrived: [] }, 'seeded from what is managed: the records name no tool yet');
    await b.turnOn();
    const settled = await b.pass(first);
    // Codex installed, and Copilot CLI's skills folder made again meanwhile: notes goes into both; Codex's copy alone is its arrival's.
    await b.codex(true);
    await rm(join(b.home, '.copilot/skills'), { recursive: true });
    await mkdir(join(b.home, '.copilot/skills'));
    const seen = await b.pass(settled), inCopilot = await readFile(join(b.home, '.copilot/skills/notes/SKILL.md'), 'utf8').then(() => true, () => false);
    assert.deepEqual([seen.managed, said(seen), await b.inCodex(), inCopilot], [['claude-cli', 'copilot-cli', 'codex-cli'], [{ tool: 'codex-cli', copied: 1 }], true, true]);
    assert.deepEqual(await b.pass(seen), seen, 'the next pass says nothing more and keeps the line');
  } finally { await b.cleanup(); }
});

test('A tool that arrives with a copy of its own that differs counts it as written over, not copied', async () => {
  const b = await box();
  try {
    await b.turnOn();
    const before = await b.pass(undefined);
    await b.codex(true);
    await mkdir(join(b.home, '.codex/skills/notes'));
    await writeFile(join(b.home, '.codex/skills/notes/SKILL.md'), '---\nname: notes\ndescription: Notes.\n---\n\nCodex’s own notes.\n');
    assert.deepEqual(said(await b.pass(before)), [{ tool: 'codex-cli', copied: 0 }]);
  } finally { await b.cleanup(); }
});

test('With Automatic sync off the arrival is kept with nothing copied; sync on again copies, and the count is what has been copied since', async () => {
  const b = await box();
  try {
    await b.turnOn();
    const before = await b.pass(undefined);
    await b.codex(true);
    const off = await b.pass(before, false);
    assert.deepEqual([said(off), await b.inCodex()], [[{ tool: 'codex-cli' }], false]);
    assert.deepEqual([said(await b.pass(off)), await b.inCodex()], [[{ tool: 'codex-cli', copied: 1 }], true]);
  } finally { await b.cleanup(); }
});

test('The count is fixed at the end of the first pass that brought the home into line: a copy put there later is in History, not in the line', async () => {
  const b = await box();
  try {
    await b.turnOn();
    const before = await b.pass(undefined);
    await b.codex(true);
    const arrived = await b.pass(before);
    // Codex's skills folder made again (notes copied there again, an entry of its own), and OpenCode arriving in the same pass.
    await rm(join(b.home, '.codex/skills'), { recursive: true });
    await mkdir(join(b.home, '.codex/skills'));
    await mkdir(join(b.home, '.config/opencode'), { recursive: true });
    assert.deepEqual([said(arrived), said(await b.pass(arrived)), (await copiedTo(b)).length],
      [[{ tool: 'codex-cli', copied: 1 }], [{ tool: 'codex-cli', copied: 1 }, { tool: 'opencode-cli', copied: 0 }], 2]);
  } finally { await b.cleanup(); }
});

test('What a click’s own pass put there before the pass that saw the tool arrive is counted as History shows it: an entry of its own counts, the click’s entry doesn’t', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await mkdir(join(b.home, '.claude/skills/todo'), { recursive: true });
    await writeFile(join(b.home, '.claude/skills/todo/SKILL.md'), '---\nname: todo\ndescription: Todo.\n---\n\nDo things.\n');
    const before = await b.pass(undefined);
    await b.codex(true);
    // Turning todo on, Codex there now: its pass puts todo in Codex (the click's entry) and notes (an entry of its own).
    await applySkills(b.context, await managedNow(b.context, await b.context.read()), [{ key: 'todo', on: true, except: [] }]);
    assert.deepEqual([said(await b.pass(before)), (await copiedTo(b)).map(event => event.key)], [[{ tool: 'codex-cli', copied: 1 }], ['notes']]);
  } finally { await b.cleanup(); }
});

test('A pass that didn’t bring the home into line fixes no count: one that may not write, a kind stopped or still settling, a crash', async () => {
  const b = await box();
  try {
    const before: ToolsSeen = { managed: ['claude-cli', 'copilot-cli'], arrived: [] }, managed: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
    const ran: PassResult = { results: [], writes: 0, reloads: [] };
    const synced = (more: Partial<PassResult> = {}, crashes: DestinationResult[] = []) => ({ skills: { ...ran, ...more }, servers: ran, agents: ran, crashes });
    const passes = [undefined, synced({ stopped: 'Stopped.' }), synced({ settling: true }), synced({}, [{ item: 'Skills sync', outcome: 'failed', message: 'Crashed.' }]), synced()];
    assert.deepEqual(await Promise.all(passes.map(async each => said(await observe(b.context, before, managed, '', each)))),
      [[{ tool: 'codex-cli' }], [{ tool: 'codex-cli' }], [{ tool: 'codex-cli' }], [{ tool: 'codex-cli' }], [{ tool: 'codex-cli', copied: 0 }]]);
  } finally { await b.cleanup(); }
});

test('A copy held at the pass that brought the home into line (an agents folder that can’t be written) lands later with its own entry; the line keeps that pass’s count', async () => {
  const b = await box();
  try {
    await mkdir(join(b.home, '.claude/agents'), { recursive: true });
    await writeFile(join(b.home, '.claude/agents/reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nReview code.\n');
    await b.turnOn();
    assert.equal((await applyAgents(b.context, await managedNow(b.context, await b.context.read()), [{ key: 'reviewer', on: true, except: [] }])).stopped, undefined);
    const before = await b.pass(undefined);
    await b.codex(true);
    // On macOS and Linux the folder is made read-only by mkdir's own mode (under the umask); Windows needs the lock helper.
    let part;
    if (process.platform === 'win32') {
      await mkdir(join(b.home, '.codex/agents'));
      part = await withLock(join(b.home, '.codex/agents'), 'dir-readonly', () => b.pass(before));
    } else {
      await mkdir(join(b.home, '.codex/agents'), { mode: 0o555 });
      part = await b.pass(before);
      await chmod(join(b.home, '.codex/agents'), 0o755);
    }
    assert.deepEqual([said(part), said(await b.pass(part)), (await copiedTo(b)).length], [[{ tool: 'codex-cli', copied: 1 }], [{ tool: 'codex-cli', copied: 1 }], 2]);
  } finally { await b.cleanup(); }
});

test('A home the settings keep nothing for is seeded from its records: a tool they name has not arrived, one they don’t has', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await b.pass(undefined);
    assert.deepEqual(await b.pass(undefined), { managed: ['claude-cli', 'copilot-cli'], arrived: [] }, 'as after the last release, which kept nothing');
    await b.codex(true);
    assert.deepEqual(said(await b.pass(undefined)), [{ tool: 'codex-cli', copied: 1 }]);
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
    assert.deepEqual(said(back), [{ tool: 'codex-cli', copied: 1 }]);
    await chooseTools(b.context, 'codex-cli', false);
    const left = await b.pass({ ...back, arrived: [] });
    await chooseTools(b.context, 'codex-cli', true);
    assert.deepEqual((await b.pass(byHand(left, 'codex-cli'))).arrived, [], 'its switch says what it did');
  } finally { await b.cleanup(); }
});

test('What the settings hold for a home is read in this shape only; anything else is seeded again', () => {
  assert.equal(seenIn(undefined), undefined);
  assert.equal(seenIn({ arrived: [] }), undefined);
  assert.deepEqual(seenIn({ managed: ['codex-cli', 'nonesuch', 3], arrived: [{ tool: 'codex-cli', since: 'T', copied: 2 }, { tool: 'nonesuch' }, { tool: 'pi-cli', copied: 'two' }, 'x'] }),
    { managed: ['codex-cli'], arrived: [{ tool: 'codex-cli', since: 'T', copied: 2 }, { tool: 'pi-cli', since: '' }] });
});
