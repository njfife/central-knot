import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { managedNow } from '../src/share.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { absentKindsIn, absentTools, heldKinds, managedTools, noteTools, presentTools } from '../src/presence.ts';
import { readRecord, saveRecord, type ShareContext } from '../src/share.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { Change, HarnessId, Snapshot } from '../src/types.ts';

const text = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`;
const exists = (path: string) => lstat(path).then(() => true, () => false);

/** A throwaway home with the given skills (`folder` relative to home → skill names), read by every tool through discover(). */
async function home(skills: Record<string, string[]>, folders: string[] = []) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-present-')));
  const path = join(base, 'home');
  for (const folder of folders) await mkdir(join(path, folder), { recursive: true });
  for (const [root, names] of Object.entries(skills)) for (const name of names) {
    await mkdir(join(path, root, name), { recursive: true });
    await writeFile(join(path, root, name, 'SKILL.md'), text(name));
  }
  const read = () => Promise.all(harnessIds.map(harness => discover({ home: path, mode: 'custom', harness })));
  const context: ShareContext = { home: path, mode: 'custom', read, build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const settled = { ...context, settleMs: 0 };
  /** A pass of the skills kind on the tools present (and managed) here now, as the app runs one. */
  const apply = async (changes: Change[] = []) => applySkills(settled, await managedNow(settled, await read()), changes);
  const view = async () => skillsView(context, await managedNow(context, await read()));
  return { path, read, context, apply, view, cleanup: () => { execFileSync('chmod', ['-R', 'u+rwx', base]); return rm(base, { recursive: true, force: true }); } };
}

test('a tool is present when its own folder exists; the others are missing', async () => {
  // Claude Code has a skill; Codex has only its (empty) configuration folder; Copilot CLI, Pi and OpenCode have nothing.
  const box = await home({ '.claude/skills': ['brief'] }, ['.codex']);
  try {
    const snapshots = await box.read();
    assert.deepEqual(presentTools(snapshots), ['claude-cli', 'codex-cli']);
    assert.deepEqual(absentTools(snapshots), ['copilot-cli', 'pi-cli', 'opencode-cli']);
  } finally { await box.cleanup(); }
});

test('skills in the shared .agents folder make no tool present, and the home simply has nothing to manage', async () => {
  const box = await home({ '.agents/skills': ['shared-only'] });
  try {
    const snapshots = await box.read();
    // Copilot CLI, Codex and Pi all read ~/.agents/skills, yet none of them is installed or has a folder here.
    assert.ok(snapshots.some(snapshot => snapshot.skills.length > 0));
    assert.deepEqual(presentTools(snapshots), []);
    const view = await box.view();
    assert.deepEqual([view.tools, view.items.length], [[], 0]);
  } finally { await box.cleanup(); }
});

test('Apply writes only to present tools, never creating a folder for a missing one', async () => {
  const box = await home({ '.claude/skills': ['brief'], '.agents/skills': ['shared'] }, ['.codex']);
  try {
    const result = await box.apply([{ key: 'brief', managed: true, off: [] }]);
    assert.equal(result.stopped, undefined);
    assert.ok(await exists(join(box.path, '.codex/skills/brief/SKILL.md')));
    assert.deepEqual([await exists(join(box.path, '.copilot')), await exists(join(box.path, '.pi'))], [false, false]);
    assert.equal(await exists(join(box.path, '.agents/skills/brief')), false);
  } finally { await box.cleanup(); }
});

test('a tool that appears gets the skills that are on; when it disappears again, nothing reads as a deletion', async () => {
  const box = await home({ '.claude/skills': ['brief'] });
  try {
    await box.apply([{ key: 'brief', managed: true, off: [] }]);
    // Codex's folder appears: a read finds the tool, and the next pass brings it the skill.
    await mkdir(join(box.path, '.codex'), { recursive: true });
    assert.deepEqual((await box.view()).tools, ['claude-cli', 'codex-cli']);
    await box.apply();
    assert.ok(await exists(join(box.path, '.codex/skills/brief/SKILL.md')));
    // The whole folder goes again: Codex is no longer in the home, so its copy's absence is no deletion.
    await rm(join(box.path, '.codex'), { recursive: true, force: true });
    assert.deepEqual((await box.view()).tools, ['claude-cli']);
    const pass = await box.apply();
    assert.deepEqual(pass.notices ?? [], []);
    assert.ok(await exists(join(box.path, '.claude/skills/brief/SKILL.md')), 'Claude Code keeps its copy');
    assert.equal((await box.view()).library.brief.on, true);
  } finally { await box.cleanup(); }
});

test('a present tool the record leaves out is not managed: no row shows it, and no pass writes to it', async () => {
  const box = await home({ '.claude/skills': ['brief'] }, ['.codex']);
  try {
    const snapshots = await box.read();
    assert.deepEqual(managedTools(snapshots), ['claude-cli', 'codex-cli'], 'a record that names no tools manages every present one');
    assert.deepEqual(managedTools(snapshots, ['codex-cli', 'pi-cli']), ['codex-cli'], 'only present tools, in discovery order');
    assert.deepEqual(managedTools(snapshots, []), [], 'an empty list manages none');
    await box.apply([{ key: 'brief', managed: true, off: [] }]);
    // Codex is left out from now on: a new skill turned on in Claude Code goes nowhere else, and Codex's own copy is left as it is.
    assert.deepEqual(await chooseTools(box.context, ['claude-cli']), {});
    await mkdir(join(box.path, '.claude/skills/later'), { recursive: true });
    await writeFile(join(box.path, '.claude/skills/later/SKILL.md'), text('later'));
    await writeFile(join(box.path, '.codex/skills/brief/SKILL.md'), text('brief edited in Codex'));
    const view = await box.view();
    assert.deepEqual(view.tools, ['claude-cli']);
    assert.equal(view.items.find(skill => skill.key === 'brief')?.copies['codex-cli'], undefined);
    await box.apply([{ key: 'later', managed: true, off: [] }]);
    assert.equal(await exists(join(box.path, '.codex/skills/later')), false);
    assert.equal(await readFile(join(box.path, '.claude/skills/brief/SKILL.md'), 'utf8'), text('brief'), 'an edit in a tool left out does not spread');
  } finally { await box.cleanup(); }
});

test('a record whose list names an unknown tool reads as damaged', async () => {
  const box = await home({ '.claude/skills': ['brief'] });
  try {
    await chooseTools(box.context, ['claude-cli']);
    const { record } = await readRecord(box.path);
    await saveRecord(box.path, { ...record!, tools: ['nope' as HarnessId] });
    assert.match((await readRecord(box.path)).problem ?? '', /damaged/);
  } finally { await box.cleanup(); }
});

test('a tool managed again: what was deleted there meanwhile does not spread, and the library wins over what was edited there, kept as a version', async () => {
  const box = await home({ '.claude/skills': ['gone', 'edited'] }, ['.codex']);
  try {
    await box.apply([{ key: 'gone', managed: true, off: [] }, { key: 'edited', managed: true, off: [] }]);
    await chooseTools(box.context, ['claude-cli']);
    await rm(join(box.path, '.codex/skills/gone'), { recursive: true });
    await writeFile(join(box.path, '.codex/skills/edited/SKILL.md'), text('edited in Codex while left out'));
    await box.apply();
    await writeFile(join(box.path, '.claude/skills/edited/SKILL.md'), text('edited later in Claude Code'));
    await box.apply();
    await chooseTools(box.context, ['claude-cli', 'codex-cli']);
    await box.apply();
    assert.ok(await exists(join(box.path, '.claude/skills/gone/SKILL.md')), 'the deletion in Codex did not spread');
    assert.equal(await readFile(join(box.path, '.codex/skills/gone/SKILL.md'), 'utf8'), text('gone'), 'Codex gets the copy back');
    assert.equal(await readFile(join(box.path, '.claude/skills/edited/SKILL.md'), 'utf8'), text('edited later in Claude Code'), 'the old edit in Codex did not win');
    assert.equal(await readFile(join(box.path, '.codex/skills/edited/SKILL.md'), 'utf8'), text('edited later in Claude Code'), 'the library wins in Codex');
    assert.ok((await box.view()).library.edited.versions.some(version => version.from.how === 'was-in' && version.from.harness === 'codex-cli'), "Codex's edit is kept as a version");
  } finally { await box.cleanup(); }
});

test('with Claude Code left out by the tool choice, OpenCode has the skill another way while Claude Code’s folder holds it, and Claude Code’s folder is left alone', async () => {
  const box = await home({ '.claude/skills': ['brief'] }, ['.config/opencode']);
  try {
    await box.apply([{ key: 'brief', managed: true, off: [] }]);
    await chooseTools(box.context, ['opencode-cli']);
    await box.apply();
    assert.equal(await exists(join(box.path, '.config/opencode/skills/brief')), false, 'OpenCode reads the copy in ~/.claude/skills: no second one');
    assert.match((await box.view()).items.find(item => item.key === 'brief')!.anotherWay?.['opencode-cli'] ?? '', /also reads a copy at .*\.claude\/skills, which is not Central Knot’s/);
    // Gone from Claude Code's folder too: OpenCode then gets the skill of its own.
    await rm(join(box.path, '.claude/skills/brief'), { recursive: true });
    await box.apply();
    assert.equal(await readFile(join(box.path, '.config/opencode/skills/brief/SKILL.md'), 'utf8'), text('brief'));
  } finally { await box.cleanup(); }
});

test('a kind no tool in the home can hold is absent; a home with no tools holds none', () => {
  const view = (tools: HarnessId[], mcp: HarnessId[], agents: HarnessId[]) => ({ skills: { tools }, mcp: { tools: mcp }, agents: { tools: agents } });
  assert.deepEqual(absentKindsIn(view(['pi-cli'], ['pi-cli'], [])), ['agents', 'plugins']);
  assert.deepEqual(absentKindsIn(view(['pi-cli', 'claude-cli'], ['pi-cli', 'claude-cli'], ['claude-cli'])), []);
  assert.deepEqual(absentKindsIn(view(['codex-cli'], [], ['codex-cli'])), ['mcp']);
  assert.deepEqual(absentKindsIn(view([], [], [])), ['skills', 'mcp', 'agents', 'instructions', 'plugins']);
  assert.deepEqual(heldKinds(view(['pi-cli'], ['pi-cli'], [])), ['skills', 'mcp']);
  assert.deepEqual(heldKinds(view([], [], [])), []);
});

test('the tools count as changed only while the same home stays open', () => {
  const tools = (...present: HarnessId[]) => harnessIds.map(harness => ({ harness, detection: present.includes(harness) ? 'Detected' : 'Not found' }) as Snapshot);
  const opened = noteTools({ home: '', tools: '' }, '/a', tools('claude-cli'));
  assert.equal(opened.changed, false, 'a home just opened is only noted');
  assert.equal(noteTools(opened.noted, '/a', tools('claude-cli')).changed, false);
  const added = noteTools(opened.noted, '/a', tools('claude-cli', 'codex-cli'));
  assert.deepEqual([added.changed, added.noted.tools], [true, 'claude-cli,codex-cli']);
  assert.equal(noteTools(added.noted, '/b', tools('claude-cli')).changed, false, 'another home is a switch, not a change');
});
