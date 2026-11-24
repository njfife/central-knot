// The other files each tool reads with its own instruction file, as the Instructions page lists them under its card
// (instructionparts.ts), and that none of them is ever written: a save, the base and its Undo change only the tool's own file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyBase, baseView, instructionsView, saveInstruction, undoBase } from '../src/instructions.ts';
import { PART_TEXT_LIMIT } from '../src/instructionparts.ts';
import { sha256, type ShareContext } from '../src/share.ts';
import type { HarnessId, InstructionPart } from '../src/types.ts';
import { lockSkip, withLock } from './fslock.ts';
import { slashPath } from './wincompat.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-parts-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex', '.pi/agent', '.config/opencode']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const snapshots = () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness })));
  const write = async (path: string, text: string | Buffer) => { await mkdir(dirname(join(home, path)), { recursive: true }); await writeFile(join(home, path), text); };
  /** The parts as the page's view reads them (main's `instructions:view`). */
  const partsOf = async (tool: HarnessId) => (await instructionsView(context, await snapshots(), true)).find(file => file.tool === tool)!.parts!;
  /**
   * Each part as its line on the card reads: where it is in the home, how the tool comes to read it, the files it is read for
   * when only some, then its text, why it is not shown, or (⚠) what to mend; last, whose own file it is when another tool's.
   */
  const said = async (tool: HarnessId) => (await partsOf(tool)).map((part: InstructionPart) => [
    part.path.startsWith(home) ? slashPath(relative(home, part.path)) : part.path, part.from, part.only && `for ${part.only}`,
    'text' in part ? part.text : 'notShown' in part ? part.notShown : `⚠ ${part.problem}`, part.ownedBy && `${part.ownedBy}’s own`,
  ].filter(Boolean).join(' · '));
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

test('Claude Code reads imports four hops from CLAUDE.md: the fifth is named, not read, and what it imports is not listed', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '@l1.md\n');
    for (let level = 1; level <= 6; level++) await box.write(`.claude/l${level}.md`, level < 6 ? `Level ${level}.\n@l${level + 1}.md\n` : 'Level 6.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/l1.md · imported by CLAUDE.md, line 1 · Level 1.\n@l2.md\n',
      '.claude/l2.md · imported by l1.md, line 2 · Level 2.\n@l3.md\n',
      '.claude/l3.md · imported by l2.md, line 2 · Level 3.\n@l4.md\n',
      '.claude/l4.md · imported by l3.md, line 2 · Level 4.\n@l5.md\n',
      '.claude/l5.md · imported by l4.md, line 2 · past four hops of imports, so Claude Code doesn’t read it',
    ]);
  } finally { await box.cleanup(); }
});

test('Claude Code’s limit is of a route: a file past it on one route and imported within it on another is read and followed', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '@l1.md\n@l5.md\n');
    for (let level = 1; level <= 4; level++) await box.write(`.claude/l${level}.md`, `Level ${level}.\n@l${level + 1}.md\n`);
    await box.write('.claude/l5.md', 'Imported directly too.\n@child.md\n');
    await box.write('.claude/child.md', 'Child.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/l1.md · imported by CLAUDE.md, line 1 · Level 1.\n@l2.md\n',
      '.claude/l2.md · imported by l1.md, line 2 · Level 2.\n@l3.md\n',
      '.claude/l3.md · imported by l2.md, line 2 · Level 3.\n@l4.md\n',
      '.claude/l4.md · imported by l3.md, line 2 · Level 4.\n@l5.md\n',
      '.claude/l5.md · imported by CLAUDE.md, line 2 · Imported directly too.\n@child.md\n',
      '.claude/child.md · imported by l5.md, line 2 · Child.\n',
    ]);
  } finally { await box.cleanup(); }
});

test('Claude Code finds imports as it does: none in code, inside a word or a bare #; "\\ " is a space, a #… is cut, a full stop kept; ~/ is the home', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', 'Write to me@example.com.\nNot `see @in-code.md` either.\n```\n@in-fence.md\n```\n@gone.md\n@~/notes/home.md\nSee @home.md.\nAsk @#team, then read @my\\ notes.md#intro.\n@folder\n');
    for (const name of ['in-code.md', 'in-fence.md', 'example.com.', 'home.md', 'folder/inside.md']) await box.write(`.claude/${name}`, 'Never listed.\n');
    await box.write('notes/home.md', 'From the home.\n');
    await box.write('.claude/my notes.md', 'Spaced.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/gone.md · imported by CLAUDE.md, line 6 · ⚠ missing',
      'notes/home.md · imported by CLAUDE.md, line 7 · From the home.\n',
      '.claude/home.md. · imported by CLAUDE.md, line 8 · ⚠ missing',
      '.claude/my notes.md · imported by CLAUDE.md, line 9 · Spaced.\n',
      '.claude/folder · imported by CLAUDE.md, line 10 · ⚠ not a file',
    ]);
  } finally { await box.cleanup(); }
});

test('Claude Code skips an import in an HTML comment, on one line or over several', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '<!-- @old.md -->\n@first.md\n<!--\n@older.md\n-->\nKept: @kept.md <!-- @aside.md -->\n');
    for (const name of ['old.md', 'first.md', 'older.md', 'kept.md', 'aside.md']) await box.write(`.claude/${name}`, `${name}\n`);
    assert.deepEqual(await box.said('claude-cli'), ['.claude/first.md · imported by CLAUDE.md, line 2 · first.md\n', '.claude/kept.md · imported by CLAUDE.md, line 6 · kept.md\n']);
  } finally { await box.cleanup(); }
});

test('Claude Code skips an import in code as Markdown has it: a span holding a backtick, a fence holding a shorter one, tildes and backticks inside each other', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', [
      'Example: `` See @in-span.md with a literal ` in the span ``.',
      '````markdown', '```', '@in-four.md', '```', '````',
      '```markdown', '~~~', '@in-tilde.md', '~~~', '```',
      '~~~', '```', '@in-backtick.md', '```', '~~~',
      'After the code: @after.md',
    ].join('\n'));
    for (const name of ['in-span.md', 'in-four.md', 'in-tilde.md', 'in-backtick.md', 'after.md']) await box.write(`.claude/${name}`, `${name}\n`);
    assert.deepEqual(await box.said('claude-cli'), ['.claude/after.md · imported by CLAUDE.md, line 17 · after.md\n']);
  } finally { await box.cleanup(); }
});

test('Claude Code’s rules: every .md under rules/, sub-folders too, each followed by its imports; one also imported shows once; one with paths last, for them', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '@a.md\n@rules/one.md\n');
    await box.write('.claude/a.md', 'A.\n');
    await box.write('.claude/rules/one.md', 'Imported, and a rule.\n');
    await box.write('.claude/rules/mine.md', 'Always.\n@../checklist.md\n');
    await box.write('.claude/checklist.md', 'Check.\n');
    await box.write('.claude/rules/backend/nested.md', 'Nested.\n');
    await box.write('.claude/rules/api.md', '---\npaths:\n  - "src/**/*.ts"\n  - "lib/**/*.ts"\n---\nTypes.\n@../never.md\n');
    await box.write('.claude/never.md', 'Read with api.md, only for those files.\n');
    await box.write('.claude/rules/notes.txt', 'Not a rule: not Markdown.\n');
    assert.deepEqual(await box.said('claude-cli'), [
      '.claude/a.md · imported by CLAUDE.md, line 1 · A.\n',
      '.claude/rules/one.md · imported by CLAUDE.md, line 2 · Imported, and a rule.\n',
      '.claude/rules/backend/nested.md · a rule · Nested.\n',
      '.claude/rules/mine.md · a rule · Always.\n@../checklist.md\n',
      '.claude/checklist.md · imported by mine.md, line 2 · Check.\n',
      '.claude/rules/api.md · a rule · for src/**/*.ts, lib/**/*.ts · ---\npaths:\n  - "src/**/*.ts"\n  - "lib/**/*.ts"\n---\nTypes.\n@../never.md\n',
    ]);
  } finally { await box.cleanup(); }
});

test('Claude Code’s rules: a linked folder is followed and each real folder read once, so a loop of links ends; one that can’t be read leaves the rest listed', async t => {
  const box = await sandbox();
  try {
    await box.write('.claude/rules/top.md', 'Top.\n');
    await box.write('.claude/rules/sub/inner.md', 'Inner.\n');
    await symlink('..', join(box.home, '.claude/rules/sub/back'));
    await box.write('shared-rules/linked.md', 'Linked.\n');
    await symlink(join(box.home, 'shared-rules'), join(box.home, '.claude/rules/team'));
    const expected = [
      '.claude/rules/sub/inner.md · a rule · Inner.\n',
      '.claude/rules/team/linked.md · a rule · Linked.\n',
      '.claude/rules/top.md · a rule · Top.\n',
    ];
    assert.deepEqual(await box.said('claude-cli'), expected);
    await t.test('an unreadable rules folder leaves the rest listed', { skip: lockSkip }, async () => {
      const locked = join(box.home, '.claude/rules/locked');
      await box.write('.claude/rules/locked/hidden.md', 'Not readable here.\n');
      await withLock(locked, 'dir-unreadable', async () => {
        assert.deepEqual(await box.said('claude-cli'), expected);
      });
    });
  } finally { await box.cleanup(); }
});

test('Copilot CLI: its instructions files for every file are shown whole, front matter and all; a scoped one comes last, with its scope', async () => {
  const box = await sandbox();
  try {
    await box.write('.copilot/instructions/all.instructions.md', '---\napplyTo: "**"\n---\nEverywhere.\n');
    await box.write('.copilot/instructions/plain.instructions.md', 'No front matter.\n');
    await box.write('.copilot/instructions/code.instructions.md', '---\napplyTo: "src/**/*.ts"\n---\nTypes.\n');
    await box.write('.copilot/instructions/readme.md', 'Not an instructions file.\n');
    assert.deepEqual(await box.said('copilot-cli'), [
      '.copilot/instructions/all.instructions.md · an instructions file · ---\napplyTo: "**"\n---\nEverywhere.\n',
      '.copilot/instructions/plain.instructions.md · an instructions file · No front matter.\n',
      '.copilot/instructions/code.instructions.md · an instructions file · for src/**/*.ts · ---\napplyTo: "src/**/*.ts"\n---\nTypes.\n',
    ]);
  } finally { await box.cleanup(); }
});

test('OpenCode: the files its config’s instructions list names, in order, each once; a pattern anywhere in an entry, a relative path and a web address are named as written', async () => {
  const box = await sandbox();
  try {
    await box.write('docs/extra.md', 'Extra.\n');
    await box.write('docs/home.md', 'Home.\n');
    await box.write('rules/main/guidelines.md', 'Guidelines.\n');
    const list = [join(box.home, 'docs/extra.md'), '~/docs/home.md', 'rules.md', join(box.home, 'docs/*.md'), 'https://example.com/rules.md',
      '~/rules/*/guidelines.md', '~/docs/extra.md'];
    await box.write('.config/opencode/opencode.jsonc', `{\n  // mine\n  "instructions": ${JSON.stringify(list)},\n}\n`);
    assert.deepEqual(await box.said('opencode-cli'), [
      'docs/extra.md · named in opencode.jsonc · Extra.\n',
      'docs/home.md · named in opencode.jsonc · Home.\n',
      'rules.md · named in opencode.jsonc · a relative path: looked for from the folder a session starts in, as OpenCode resolves it',
      'docs/*.md · named in opencode.jsonc · a pattern: matched as OpenCode resolves it, not here',
      'https://example.com/rules.md · named in opencode.jsonc · a web address: OpenCode fetches it, Central Knot doesn’t',
      'rules/*/guidelines.md · named in opencode.jsonc · a pattern: matched as OpenCode resolves it, not here',
    ]);
  } finally { await box.cleanup(); }
});

test('A part’s text is sent to the page up to its own cap, well below what the tool reads; past it, or with a zero byte in it, its size or why is said instead', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/rules/at-limit.md', 'a'.repeat(PART_TEXT_LIMIT));
    await box.write('.claude/rules/past-limit.md', 'a'.repeat(PART_TEXT_LIMIT + 1));
    await box.write('.claude/rules/picture.md', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    await box.write('.claude/rules/very-large.md', 'a'.repeat(5 * 1024 * 1024));
    assert.deepEqual((await box.partsOf('claude-cli')).map(part => 'text' in part ? part.text.length : 'notShown' in part ? part.notShown : part.problem),
      [PART_TEXT_LIMIT, '257 KB, so not shown here', 'not text', '5.0 MB, so not shown here']);
  } finally { await box.cleanup(); }
});

test('A part that is another tool’s own instruction file says whose it is: that tool’s card edits it and the base writes it', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '@~/.codex/AGENTS.md\n');
    await box.write('.codex/AGENTS.md', 'Codex.\n');
    await box.write('.config/opencode/AGENTS.md', 'OpenCode.\n');
    await box.write('.config/opencode/opencode.json', JSON.stringify({ instructions: ['~/.claude/CLAUDE.md'] }));
    assert.deepEqual([...await box.said('claude-cli'), ...await box.said('opencode-cli')], [
      '.codex/AGENTS.md · imported by CLAUDE.md, line 1 · Codex.\n · codex-cli’s own',
      '.claude/CLAUDE.md · named in opencode.json · @~/.codex/AGENTS.md\n · claude-cli’s own',
    ]);
  } finally { await box.cleanup(); }
});

test('Parts are read for the page’s view only: Draft with a tool and the Git repo’s base read the files without them', async () => {
  const box = await sandbox();
  try {
    await box.write('.claude/CLAUDE.md', '@a.md\n');
    await box.write('.claude/a.md', 'A.\n');
    assert.deepEqual((await instructionsView(box.context, await box.snapshots())).map(file => file.parts), tools.map(() => undefined));
    assert.deepEqual((await box.said('claude-cli')).length, 1);
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
    const files = await instructionsView(box.context, await box.snapshots(), true);
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
    const files = await instructionsView(box.context, await box.snapshots(), true);
    assert.deepEqual(files.flatMap(file => file.parts!).map(part => slashPath(relative(box.home, part.path))), brought, 'each is listed');
    const claude = files.find(file => file.tool === 'claude-cli')!;
    assert.equal((await saveInstruction(box.context, await box.snapshots(), 'claude-cli', 'Mine, edited.\n@a.md\n', claude.hash)).saved, true);
    const seen = Object.fromEntries((await instructionsView(box.context, await box.snapshots())).map(file => [file.tool, { path: file.path, hash: file.hash }]));
    const applied = await applyBase(box.context, await box.snapshots(), { text: 'Shared.\n', expected: (await baseView(box.context)).hash, seen, tools });
    assert.deepEqual(applied.written.map(file => slashPath(relative(box.home, file.path))).sort(),
      ['.claude/CLAUDE.md', '.codex/AGENTS.md', '.config/opencode/AGENTS.md', '.copilot/copilot-instructions.md', '.pi/agent/AGENTS.md'], 'the base goes to each tool’s own file');
    assert.deepEqual(await hashes(), before, 'after a save and the base');
    assert.equal((await undoBase(box.context, await box.snapshots(), applied.undo!)).written.length, 5);
    assert.deepEqual(await hashes(), before, 'after its Undo');
    // The earlier versions kept are of CLAUDE.md only, and there are some: Restore can put back nothing else.
    const kept = join(box.home, '.central-knot/instructions/claude-cli');
    const texts = await Promise.all((await readdir(kept)).map(name => readFile(join(kept, name), 'utf8')));
    assert.ok(texts.length > 0 && texts.every(text => text.startsWith('Mine')), JSON.stringify(texts));
  } finally { await box.cleanup(); }
});
