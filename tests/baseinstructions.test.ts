import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyBase, baseView, instructionsView, undoBase } from '../src/instructions.ts';
import { splitBase, withBase, withOwn, withoutBase } from '../src/basetext.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

test('The base block goes after a file’s own text, is replaced in place, and comes out leaving the own text byte for byte', () => {
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
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-base-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const snapshots = () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness })));
  return { home, context, snapshots, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Starting from one tool’s instructions shares them with the others; an edit in a tool’s copy is kept until the person chooses; Undo puts every file back', async () => {
  const box = await sandbox();
  const claude = join(box.home, '.claude/CLAUDE.md'), codex = join(box.home, '.codex/AGENTS.md'), copilot = join(box.home, '.copilot/copilot-instructions.md');
  try {
    await writeFile(claude, 'Be brief.\n');
    await writeFile(codex, 'Codex only.\n');
    const first = await applyBase(box.context, await box.snapshots(), { text: 'Be brief.\n', expected: (await baseView(box.context)).hash, tools, adopt: 'claude-cli' });
    assert.deepEqual(first.left, []);
    assert.equal(splitBase(await readFile(claude, 'utf8')).own, '');
    assert.equal(splitBase(await readFile(codex, 'utf8')).own, 'Codex only.\n');
    assert.equal(splitBase(await readFile(copilot, 'utf8')).copy, 'Be brief.\n');

    // An edit inside Codex's copy: the next base edit leaves Codex alone and says so.
    await writeFile(codex, (await readFile(codex, 'utf8')).replace('Be brief.', 'Be very brief.'));
    let files = await instructionsView(box.context, await box.snapshots());
    assert.equal(files.find(file => file.tool === 'codex-cli')!.base!.state, 'edited');
    const second = await applyBase(box.context, await box.snapshots(), { text: 'Be brief.\nCite files.\n', expected: (await baseView(box.context)).hash, tools });
    assert.deepEqual(second.left, [{ tool: 'codex-cli', why: 'edited' }]);
    assert.match(await readFile(codex, 'utf8'), /Be very brief\./);
    assert.match(await readFile(claude, 'utf8'), /Cite files\./);

    // Put the base back in Codex, then undo that: Codex's edited copy returns exactly.
    const editedCodex = await readFile(codex, 'utf8');
    const putBack = await applyBase(box.context, await box.snapshots(), { text: 'Be brief.\nCite files.\n', expected: (await baseView(box.context)).hash, tools, overwrite: ['codex-cli'] });
    assert.equal(splitBase(await readFile(codex, 'utf8')).copy, 'Be brief.\nCite files.\n');
    await undoBase(box.context, await box.snapshots(), putBack.undo!);
    assert.equal(await readFile(codex, 'utf8'), editedCodex);

    // Undo of the first apply: the base is empty again and the file it created goes; Claude is back byte for byte, and Codex,
    // changed since, is left as it is and reported.
    await undoBase(box.context, await box.snapshots(), second.undo!);
    const undone = await undoBase(box.context, await box.snapshots(), first.undo!);
    assert.equal(await readFile(claude, 'utf8'), 'Be brief.\n');
    assert.equal(await readFile(codex, 'utf8'), editedCodex);
    assert.deepEqual(undone.left, [{ tool: 'codex-cli', why: 'edited' }]);
    await assert.rejects(stat(copilot));
    assert.deepEqual((await baseView(box.context)).tools, []);

    // Taking a tool off the list takes its block out and leaves its own text.
    await writeFile(codex, 'Codex only.\n');
    await applyBase(box.context, await box.snapshots(), { text: 'Shared.\n', expected: (await baseView(box.context)).hash, tools: ['claude-cli', 'codex-cli'] });
    await applyBase(box.context, await box.snapshots(), { text: 'Shared.\n', expected: (await baseView(box.context)).hash, tools: ['claude-cli'] });
    assert.equal(await readFile(codex, 'utf8'), 'Codex only.\n');
    files = await instructionsView(box.context, await box.snapshots());
    assert.equal(files.find(file => file.tool === 'codex-cli')!.base, undefined);
    assert.equal(files.find(file => file.tool === 'claude-cli')!.base!.state, 'same');
  } finally { await box.cleanup(); }
});
