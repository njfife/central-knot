import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyBase, baseView, instructionsView, saveInstruction, undoBase } from '../src/instructions.ts';
import { splitBase, withBase, withOwn, withoutBase } from '../src/basetext.ts';
import type { ShareContext } from '../src/share.ts';
import type { BaseApply, HarnessId } from '../src/types.ts';

test('The base block goes after a file’s own text (ending it with a line break), is replaced in place, and comes out leaving the own text', () => {
  const own = '# Mine\n- Keep this exactly.';
  const added = withBase(own, 'Shared one.\n');
  assert.equal(splitBase(added).own, own + '\n');
  assert.equal(splitBase(added).copy, 'Shared one.\n');
  // Text someone put after the block stays after it when the base changes.
  const later = `${added}Tail of my own.\n`;
  const changed = withBase(later, 'Shared two.\n');
  assert.ok(changed.startsWith(own) && changed.endsWith('Tail of my own.\n') && changed.includes('Shared two.') && !changed.includes('Shared one.'));
  assert.equal(withoutBase(changed), `${own}\nTail of my own.\n`);
  // Own text edited in the editor: the block stays as it is, after it.
  assert.equal(splitBase(withOwn(added, 'New own.\n')).copy, 'Shared one.\n');
  // A file holding only the base is never emptied when the base comes out, and a start with no end runs to the end of the file.
  assert.equal(withoutBase(withBase('', 'Only shared.\n')), 'Only shared.\n');
  assert.deepEqual(splitBase('Mine.\n<!-- Central Knot base instructions: start -->\nhalf'), { own: 'Mine.\n', copy: 'half' });
});

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
async function sandbox(present: HarnessId[] = tools) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-base-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex', ...(present.includes('pi-cli') ? ['.pi/agent'] : [])]) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const snapshots = () => Promise.all(present.map(harness => discover({ home, mode: 'custom', harness })));
  // What the review would have shown: every file with the hash it holds now.
  const seen = async () => Object.fromEntries((await instructionsView(context, await snapshots())).map(file => [file.tool, { path: file.path, hash: file.hash }]));
  /** Saves `text` as the base for `chosen`, as reviewed just now. */
  const set = async (text: string, chosen: HarnessId[], more: Partial<BaseApply> = {}) => applyBase(context, await snapshots(), { text, expected: (await baseView(context)).hash, seen: await seen(), tools: chosen, ...more });
  const file = (path: string) => join(home, path);
  /** How a tool's file holds the base now. */
  const state = async (tool: HarnessId) => (await instructionsView(context, await snapshots())).find(entry => entry.tool === tool)!.base!.state;
  return { home, context, snapshots, seen, set, file, state, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Starting from one tool’s instructions shares them; a change after the review stops the save; Undo puts every file back', async () => {
  const box = await sandbox();
  const claude = box.file('.claude/CLAUDE.md'), codex = box.file('.codex/AGENTS.md'), copilot = box.file('.copilot/copilot-instructions.md');
  try {
    await writeFile(claude, 'Be brief.\n');
    await writeFile(codex, 'Codex only.\n');
    const first = await box.set('Be brief.\n', tools, { adopt: 'claude-cli' });
    assert.deepEqual(first.left, []);
    assert.equal(splitBase(await readFile(claude, 'utf8')).own, '');
    assert.equal(splitBase(await readFile(codex, 'utf8')).own, 'Codex only.\n');
    assert.equal(splitBase(await readFile(copilot, 'utf8')).copy, 'Be brief.\n');

    // A tool file changed after the review stops the save before anything is written.
    const stale = await box.seen();
    const before = await readFile(claude, 'utf8');
    await writeFile(claude, `${before}Typed after the review.\n`);
    const stopped = await applyBase(box.context, await box.snapshots(), { text: 'Other.\n', expected: (await baseView(box.context)).hash, seen: stale, tools });
    assert.ok(stopped.changed && !(await readFile(codex, 'utf8')).includes('Other.') && (await baseView(box.context)).text === 'Be brief.\n');
    await writeFile(claude, before);

    // base.md edited outside Central Knot: a save reviewed before that writes nothing, and an Undo of an older save is refused.
    const baseFile = box.file('.central-knot/instructions/base.md');
    const reviewedHash = (await baseView(box.context)).hash;
    await writeFile(baseFile, 'Edited in base.md.\n');
    assert.ok((await applyBase(box.context, await box.snapshots(), { text: 'Other.\n', expected: reviewedHash, seen: await box.seen(), tools })).changed);
    assert.equal((await undoBase(box.context, await box.snapshots(), first.undo!)).written.length, 0);
    assert.equal(await readFile(baseFile, 'utf8'), 'Edited in base.md.\n');
    await writeFile(baseFile, 'Be brief.\n');

    // Undo: every file back byte for byte, the file the save created gone, no tool on the list.
    await undoBase(box.context, await box.snapshots(), first.undo!);
    assert.equal(await readFile(claude, 'utf8'), 'Be brief.\n');
    assert.equal(await readFile(codex, 'utf8'), 'Codex only.\n');
    await assert.rejects(stat(copilot));
    assert.deepEqual((await baseView(box.context)).tools, []);
  } finally { await box.cleanup(); }
});

test('A copy edited in a tool’s file stays until the person chooses, also after using it as the base and undoing that', async () => {
  const box = await sandbox();
  const claude = box.file('.claude/CLAUDE.md'), codex = box.file('.codex/AGENTS.md');
  try {
    await writeFile(codex, 'Codex only.\n');
    await box.set('Be brief.\n', tools);
    await writeFile(codex, (await readFile(codex, 'utf8')).replace('Be brief.', 'Be very brief.'));
    assert.equal(await box.state('codex-cli'), 'edited');
    const second = await box.set('Be brief.\nCite files.\n', tools);
    assert.deepEqual(second.left, [{ tool: 'codex-cli', why: 'edited' }]);
    assert.match(await readFile(codex, 'utf8'), /Be very brief\./);
    assert.match(await readFile(claude, 'utf8'), /Cite files\./);

    // Put the base back in Codex, then undo that: Codex's edited copy returns exactly.
    const editedCodex = await readFile(codex, 'utf8');
    const putBack = await box.set('Be brief.\nCite files.\n', tools, { overwrite: ['codex-cli'] });
    assert.equal(splitBase(await readFile(codex, 'utf8')).copy, 'Be brief.\nCite files.\n');
    await undoBase(box.context, await box.snapshots(), putBack.undo!);
    assert.equal(await readFile(codex, 'utf8'), editedCodex);

    // Use Codex's copy as the base, then undo that: the copy is still Codex's own edit, and the next save leaves it alone.
    const adopted = await box.set(splitBase(editedCodex).copy!, tools);
    assert.match(await readFile(claude, 'utf8'), /Be very brief\./);
    await undoBase(box.context, await box.snapshots(), adopted.undo!);
    assert.equal(await box.state('codex-cli'), 'edited');
    assert.deepEqual((await box.set('Be brief.\nCite files.\nAnd more.\n', tools)).left, [{ tool: 'codex-cli', why: 'edited' }]);
    assert.equal(await readFile(codex, 'utf8'), editedCodex);
  } finally { await box.cleanup(); }
});

test('Taking a tool off takes the block out, keeps own text and edited copies, and adding it again never repeats the base', async () => {
  const box = await sandbox();
  const claude = box.file('.claude/CLAUDE.md'), codex = box.file('.codex/AGENTS.md'), copilot = box.file('.copilot/copilot-instructions.md');
  try {
    await writeFile(codex, 'Codex only.\n');
    await writeFile(claude, 'Claude only.\n');
    await box.set('Be brief.\n', tools);
    await box.set('Shared.\n', tools);
    // Copilot's file deleted meanwhile is not created again; Codex's edited copy stays; Claude keeps its own text.
    await rm(copilot);
    await writeFile(codex, (await readFile(codex, 'utf8')).replace('Shared.', 'Shared, mine.'));
    const off = await box.set('Shared.\n', ['claude-cli']);
    assert.ok((await readFile(claude, 'utf8')).startsWith('Claude only.\n\n<!--'));
    assert.match(await readFile(codex, 'utf8'), /Shared, mine\./);
    assert.deepEqual(off.left, [{ tool: 'codex-cli', why: 'edited' }]);
    await assert.rejects(stat(copilot));

    // A file that held only the base keeps it as plain text when taken off; added again (even after a failed write), that text
    // goes back into the block instead of being repeated.
    await box.set('Shared.\n', ['claude-cli', 'copilot-cli']);
    await box.set('Shared.\n', ['claude-cli']);
    assert.equal(await readFile(copilot, 'utf8'), 'Shared.\n');
    // (A read-only folder doesn't stop root, so this step only runs as an ordinary user.)
    if (process.getuid?.() !== 0) {
      await chmod(box.file('.copilot'), 0o555);
      const blocked = await box.set('Shared.\n', ['claude-cli', 'copilot-cli']);
      await chmod(box.file('.copilot'), 0o755);
      assert.ok(blocked.left.some(entry => entry.tool === 'copilot-cli' && entry.why === 'failed'));
      // Taken off again before the retry (nothing to change in the file): the record of the plain text stays.
      await box.set('Shared.\n', ['claude-cli']);
      assert.equal(await readFile(copilot, 'utf8'), 'Shared.\n');
    }
    await box.set('Shared.\n', ['claude-cli', 'copilot-cli']);
    await box.set('Shared, now.\n', ['claude-cli', 'copilot-cli']);
    assert.deepEqual(splitBase(await readFile(copilot, 'utf8')), { own: '', copy: 'Shared, now.\n' });

    // Text that merely matches an earlier base is the tool's own: a new base goes after it.
    await writeFile(claude, 'Be brief.\n');
    await box.set('Use tabs.\n', ['claude-cli', 'copilot-cli']);
    assert.ok((await readFile(claude, 'utf8')).startsWith('Be brief.\n\n<!--'));
  } finally { await box.cleanup(); }
});

test('Tools reading one linked file are one destination: chosen together and written once', async () => {
  const box = await sandbox();
  const claude = box.file('.claude/CLAUDE.md'), codex = box.file('.codex/AGENTS.md');
  try {
    await writeFile(claude, 'Mine.\n');
    await symlink(claude, codex);
    assert.deepEqual((await instructionsView(box.context, await box.snapshots())).find(file => file.tool === 'codex-cli')!.sameFile, ['claude-cli']);
    // Started from Codex's AGENTS.md (the second reader): the text moves into the block once, not repeated.
    const saved = await box.set('Mine.\n', ['claude-cli', 'codex-cli'], { adopt: 'codex-cli' });
    assert.deepEqual([saved.written.length, saved.left], [1, []]);
    assert.deepEqual(splitBase(await readFile(claude, 'utf8')), { own: '', copy: 'Mine.\n' });
    // Unticking one of them leaves the file with the base, since the other still reads it; a base edit writes it once.
    await box.set('Shared.\n', ['codex-cli']);
    const edited = await box.set('Shared, again.\n', ['codex-cli']);
    assert.deepEqual([edited.written.length, edited.left], [1, []]);
    assert.deepEqual(splitBase(await readFile(claude, 'utf8')), { own: '', copy: 'Shared, again.\n' });
  } finally { await box.cleanup(); }
});

test('Putting back an earlier version of a tool’s file reads as an older base, not an edit made there', async () => {
  const box = await sandbox();
  const codex = box.file('.codex/AGENTS.md');
  try {
    await writeFile(codex, 'Codex only.\n');
    await box.set('Be brief.\n', tools);
    const older = await readFile(codex, 'utf8');
    await box.set('Be brief.\nCite files.\n', tools);
    const now = await readFile(codex, 'utf8');
    await saveInstruction(box.context, await box.snapshots(), 'codex-cli', older, (await box.seen())['codex-cli']!.hash, true);
    assert.equal(await box.state('codex-cli'), 'older');
    assert.equal((await box.set('Be brief.\nCite files.\n', tools)).left.length, 0);
    assert.equal(await readFile(codex, 'utf8'), now);
    // Saving its own text from its editor keeps the block as it is.
    await saveInstruction(box.context, await box.snapshots(), 'codex-cli', withOwn(now, 'Codex, reworded.\n'), (await box.seen())['codex-cli']!.hash);
    assert.deepEqual([splitBase(await readFile(codex, 'utf8')).own, await box.state('codex-cli')], ['Codex, reworded.\n', 'same']);
    // A version whose copy was edited by hand back then stays protected as an edit when put back.
    const handEdited = (await readFile(codex, 'utf8')).replace('Cite files.', 'Cite every file.');
    await saveInstruction(box.context, await box.snapshots(), 'codex-cli', handEdited, (await box.seen())['codex-cli']!.hash, true);
    assert.equal(await box.state('codex-cli'), 'edited');
  } finally { await box.cleanup(); }
});

test('An Undo that leaves a file changed since alone keeps its record, so its copy still reads as Central Knot’s', async () => {
  const box = await sandbox();
  const codex = box.file('.codex/AGENTS.md');
  try {
    await writeFile(codex, 'Codex only.\n');
    await box.set('Be brief.\n', tools);
    const second = await box.set('Be brief.\nCite files.\n', tools);
    await writeFile(codex, `Codex, edited since.\n${(await readFile(codex, 'utf8')).replace('Codex only.\n', '')}`);
    const undone = await undoBase(box.context, await box.snapshots(), second.undo!);
    assert.deepEqual(undone.left, [{ tool: 'codex-cli', why: 'edited' }]);
    assert.equal(await box.state('codex-cli'), 'older');
  } finally { await box.cleanup(); }
});

test('A file linked after the base was saved counts as chosen for every tool reading it', async () => {
  const box = await sandbox();
  const claude = box.file('.claude/CLAUDE.md'), codex = box.file('.codex/AGENTS.md');
  try {
    await writeFile(claude, 'Mine.\n');
    await box.set('Shared.\n', ['claude-cli']);
    await symlink(claude, codex);
    const codexFile = (await instructionsView(box.context, await box.snapshots())).find(file => file.tool === 'codex-cli')!;
    assert.deepEqual([codexFile.base!.chosen, codexFile.base!.state], [true, 'same']);
  } finally { await box.cleanup(); }
});

test('Pi with only a CLAUDE.md gets the base in that file, so no new AGENTS.md shadows it', async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  try {
    await writeFile(box.file('.pi/agent/CLAUDE.md'), 'Pi own.\n');
    await box.set('Shared.\n', ['pi-cli']);
    await assert.rejects(stat(box.file('.pi/agent/AGENTS.md')));
    assert.deepEqual(splitBase(await readFile(box.file('.pi/agent/CLAUDE.md'), 'utf8')), { own: 'Pi own.\n', copy: 'Shared.\n' });
  } finally { await box.cleanup(); }
});

test('A save and its Undo act on the file the review named: an override that appears is never written or removed', async () => {
  const box = await sandbox();
  const agents = join(box.home, '.codex/AGENTS.md'), override = join(box.home, '.codex/AGENTS.override.md');
  try {
    const save = async () => applyBase(box.context, await box.snapshots(), { text: 'Shared.\n', expected: (await baseView(box.context)).hash, seen: reviewed, tools: ['codex-cli'] });
    // Reviewed, then an override appears with the same text: Codex now reads another file, so nothing is saved.
    await writeFile(agents, 'Mine.\n');
    let reviewed = await box.seen();
    await writeFile(override, 'Mine.\n');
    assert.ok((await save()).changed);
    await rm(override); await rm(agents);
    // Saved (creating AGENTS.md), then an override appears: Undo removes the file it created and leaves the override.
    reviewed = await box.seen();
    const saved = await save();
    await writeFile(override, await readFile(agents, 'utf8'));
    const undone = await undoBase(box.context, await box.snapshots(), saved.undo!);
    assert.deepEqual(undone.left, []);
    await assert.rejects(stat(agents));
    assert.ok((await stat(override)).isFile());
  } finally { await box.cleanup(); }
});
