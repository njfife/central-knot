// The other files each tool reads with its own instruction file, as the Instructions page lists them under its card
// (instructionparts.ts), and that none of them is ever written: a save, the base and its Undo change only the tool's own file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyBase, baseView, instructionsView, saveInstruction, undoBase } from '../src/instructions.ts';
import { PART_FILE_LIMIT } from '../src/catalogdetail.ts';
import { sha256, type ShareContext } from '../src/share.ts';
import type { HarnessId, InstructionPart } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-parts-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex', '.pi/agent', '.config/opencode']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const snapshots = () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness })));
  const write = async (path: string, text: string | Buffer) => { await mkdir(dirname(join(home, path)), { recursive: true }); await writeFile(join(home, path), text); };
  const partsOf = async (tool: HarnessId) => (await instructionsView(context, await snapshots())).find(file => file.tool === tool)!.parts;
  /** Each part as its line on the card reads: where it is in the home, how the tool comes to read it, its text or why there is none. */
  const said = async (tool: HarnessId) => (await partsOf(tool)).map((part: InstructionPart) =>
    `${part.path.startsWith(home) ? relative(home, part.path) : part.path} · ${part.from} · ${'text' in part ? part.text : part.notShown}`);
  return { home, context, snapshots, write, partsOf, said, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Claude Code: each @ import, resolved against the file that holds it, is followed down; a file comes once, so a loop ends', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '# Mine\nSee @a.md for more.\n');
    await box.write('.claude/a.md', 'A.\n@sub/b.md\n');
    await box.write('.claude/sub/b.md', 'B.\n@c.md\n');
    await box.write('.claude/sub/c.md', 'C, beside b.md.\n@../a.md @../CLAUDE.md\n');
    await box.write('.claude/c.md', 'Not this one: b.md’s import is beside b.md.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/a.md · imported by CLAUDE.md, line 2 · A.\n@sub/b.md\n',
      '.claude/sub/b.md · imported by a.md, line 2 · B.\n@c.md\n',
      '.claude/sub/c.md · imported by b.md, line 2 · C, beside b.md.\n@../a.md @../CLAUDE.md\n',
    ]);
  } finally { await box.cleanup(); }
});

test('Claude Code follows imports five levels down: the sixth is named, not read', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '@l1.md\n');
    for (let level = 1; level <= 6; level++) await box.write(`.claude/l${level}.md`, level < 6 ? `Level ${level}.\n@l${level + 1}.md\n` : 'Level 6.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/l1.md · imported by CLAUDE.md, line 1 · Level 1.\n@l2.md\n',
      '.claude/l2.md · imported by l1.md, line 2 · Level 2.\n@l3.md\n',
      '.claude/l3.md · imported by l2.md, line 2 · Level 3.\n@l4.md\n',
      '.claude/l4.md · imported by l3.md, line 2 · Level 4.\n@l5.md\n',
      '.claude/l5.md · imported by l4.md, line 2 · Level 5.\n@l6.md\n',
      '.claude/l6.md · imported by l5.md, line 2 · past five levels of imports, so Claude Code doesn’t read it',
    ]);
  } finally { await box.cleanup(); }
});

test('Claude Code finds imports as it does: none in code, inside a word or a bare #; "\\ " is a space, a #… is cut, a full stop kept; ~/ is the home', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', 'Write to me@example.com.\nNot `see @in-code.md` either.\n```\n@in-fence.md\n```\n@gone.md\n@~/notes/home.md\nSee @home.md.\nAsk @#team, then read @my\\ notes.md#intro.\n');
    for (const name of ['in-code.md', 'in-fence.md', 'example.com.', 'home.md']) await box.write(`.claude/${name}`, 'Never listed.\n');
    await box.write('notes/home.md', 'From the home.\n');
    await box.write('.claude/my notes.md', 'Spaced.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/gone.md · imported by CLAUDE.md, line 6 · missing',
      'notes/home.md · imported by CLAUDE.md, line 7 · From the home.\n',
      '.claude/home.md. · imported by CLAUDE.md, line 8 · missing',
      '.claude/my notes.md · imported by CLAUDE.md, line 9 · Spaced.\n',
    ]);
  } finally { await box.cleanup(); }
});

test('Claude Code: after the imports, its rules by name; a rule with paths is named last, with them, and its text is not shown', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '@a.md\n');
    await box.write('.claude/a.md', 'A.\n');
    await box.write('.claude/rules/mine.md', 'Always.\n');
    await box.write('.claude/rules/api.md', '---\npaths:\n  - "src/**/*.ts"\n  - "lib/**/*.ts"\n---\nTypes.\n');
    await box.write('.claude/rules/b.md', 'B rule.\n');
    await box.write('.claude/rules/notes.txt', 'Not a rule: not Markdown.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/a.md · imported by CLAUDE.md, line 1 · A.\n',
      '.claude/rules/b.md · a rule · B rule.\n',
      '.claude/rules/mine.md · a rule · Always.\n',
      '.claude/rules/api.md · a rule · only for files matching src/**/*.ts, lib/**/*.ts',
    ]);
  } finally { await box.cleanup(); }
});

test('Copilot CLI: its instructions files for every file are shown whole, front matter and all; a scoped one is named with its scope', async () => {
  const box = await sandbox();
  try {
    await box.write('.copilot/instructions/all.instructions.md', '---\napplyTo: "**"\n---\nEverywhere.\n');
    await box.write('.copilot/instructions/plain.instructions.md', 'No front matter.\n');
    await box.write('.copilot/instructions/code.instructions.md', '---\napplyTo: "src/**/*.ts"\n---\nTypes.\n');
    await box.write('.copilot/instructions/readme.md', 'Not an instructions file.\n');
    assert.deepEqual(await box.said('copilot-cli'), [
      '.copilot/instructions/all.instructions.md · an instructions file · ---\napplyTo: "**"\n---\nEverywhere.\n',
      '.copilot/instructions/plain.instructions.md · an instructions file · No front matter.\n',
      '.copilot/instructions/code.instructions.md · an instructions file · only for files matching src/**/*.ts',
    ]);
  } finally { await box.cleanup(); }
});

test('OpenCode: the files its config’s instructions list names, in order; a pattern, a relative path and a web address are named as written', async () => {
  const box = await sandbox();
  try {
    await box.write('docs/extra.md', 'Extra.\n');
    await box.write('docs/home.md', 'Home.\n');
    const list = [join(box.home, 'docs/extra.md'), '~/docs/home.md', 'rules.md', join(box.home, 'docs/*.md'), 'https://example.com/rules.md'];
    await box.write('.config/opencode/opencode.jsonc', `{\n  // mine\n  "instructions": ${JSON.stringify(list)},\n}\n`);
    assert.deepEqual(await box.said('opencode-cli'), [
      'docs/extra.md · named in opencode.jsonc · Extra.\n',
      'docs/home.md · named in opencode.jsonc · Home.\n',
      'rules.md · named in opencode.jsonc · a relative path: looked for from the folder a session starts in, as OpenCode resolves it',
      'docs/*.md · named in opencode.jsonc · a pattern: matched as OpenCode resolves it, not here',
      'https://example.com/rules.md · named in opencode.jsonc · a web address: OpenCode fetches it, Central Knot doesn’t',
    ]);
  } finally { await box.cleanup(); }
});

test('A file at the size the app reads is shown; one byte past it, or with a zero byte in it, is said instead', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/rules/at-limit.md', 'a'.repeat(PART_FILE_LIMIT));
    await box.write('.claude/rules/past-limit.md', 'a'.repeat(PART_FILE_LIMIT + 1));
    await box.write('.claude/rules/picture.md', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    assert.deepEqual((await box.partsOf('claude-cli')).map(part => 'text' in part ? part.text.length : part.notShown),
      [PART_FILE_LIMIT, 'larger than 4 MB, so not shown here', 'not text']);
  } finally { await box.cleanup(); }
});

test('Codex and Pi read nothing more at the home’s level; the old hints are gone where the files are listed', async () => {
  const box = await sandbox();
  try {
    await box.write('.codex/AGENTS.md', 'See @notes.md.\n');
    await box.write('.codex/notes.md', 'Codex doesn’t import.\n');
    await box.write('.pi/agent/AGENTS.md', '@notes.md\n');
    await box.write('.claude/CLAUDE.md', '@notes.md\n');
    await box.write('.copilot/instructions/all.instructions.md', 'All.\n');
    const files = await instructionsView(box.context, await box.snapshots());
    assert.deepEqual(files.filter(file => file.tool === 'codex-cli' || file.tool === 'pi-cli').map(file => file.parts), [[], []]);
    assert.deepEqual(files.flatMap(file => file.notes).filter(note => /@|instructions\//.test(note)), []);
  } finally { await box.cleanup(); }
});

test('A file another file brings in is shown, never written: a save, the base and its Undo change only the tools’ own files', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', 'Mine.\n@a.md\n');
    await box.write('.claude/a.md', 'A.\n');
    await box.write('.claude/rules/mine.md', 'Always.\n');
    await box.write('.copilot/instructions/all.instructions.md', 'All.\n');
    await box.write('docs/extra.md', 'Extra.\n');
    await box.write('.config/opencode/opencode.json', JSON.stringify({ instructions: [join(box.home, 'docs/extra.md')] }));
    const brought = ['.claude/a.md', '.claude/rules/mine.md', '.copilot/instructions/all.instructions.md', 'docs/extra.md'];
    const hashes = () => Promise.all(brought.map(async path => sha256(await readFile(join(box.home, path), 'utf8'))));
    const before = await hashes();
    const files = await instructionsView(box.context, await box.snapshots());
    assert.deepEqual(files.flatMap(file => file.parts).map(part => relative(box.home, part.path)), brought, 'each is listed');
    const claude = files.find(file => file.tool === 'claude-cli')!;
    assert.equal((await saveInstruction(box.context, await box.snapshots(), 'claude-cli', 'Mine, edited.\n@a.md\n', claude.hash)).saved, true);
    const seen = Object.fromEntries((await instructionsView(box.context, await box.snapshots())).map(file => [file.tool, { path: file.path, hash: file.hash }]));
    const applied = await applyBase(box.context, await box.snapshots(), { text: 'Shared.\n', expected: (await baseView(box.context)).hash, seen, tools });
    assert.deepEqual(applied.written.map(file => relative(box.home, file.path)).sort(),
      ['.claude/CLAUDE.md', '.codex/AGENTS.md', '.config/opencode/AGENTS.md', '.copilot/copilot-instructions.md', '.pi/agent/AGENTS.md'], 'the base goes to each tool’s own file');
    assert.deepEqual(await hashes(), before, 'after a save and the base');
    assert.equal((await undoBase(box.context, await box.snapshots(), applied.undo!)).written.length, 5);
    assert.deepEqual(await hashes(), before, 'after its Undo');
    // The earlier versions kept are of CLAUDE.md only: Restore can put back nothing else.
    const kept = join(box.home, '.central-knot/instructions/claude-cli');
    assert.deepEqual((await Promise.all((await readdir(kept)).map(name => readFile(join(kept, name), 'utf8')))).every(text => text.startsWith('Mine')), true);
  } finally { await box.cleanup(); }
});
