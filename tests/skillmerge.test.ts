// Merge for a skill on real folders (src/skillmerge.ts mergeSkill), with this computer's real git merge-file: what the merged
// folder holds, byte for byte and mode for mode, where both sides changed a file; a conflict; and what is left behind. Which
// side each path takes is library.ts mergeFiles, row by row in tests/library.test.ts; Merge on a source's row, end to end on
// real tools' folders, is in tests/sources.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newItem } from '../src/library.ts';
import { readTree } from '../src/share.ts';
import { mergeSkill } from '../src/skillmerge.ts';
import { readVersion } from '../src/skillstore.ts';
import { sandbox, type Box } from './skillclicks.ts';

/** A skill's folder for one side: each file's text (or bytes) and mode where it isn't the default. */
type Side = Record<string, string | Buffer | { text: string; mode: number }>;
async function folder(box: Box, name: string, files: Side) {
  const dir = join(box.base, name);
  await mkdir(dir, { recursive: true });
  for (const [path, file] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), typeof file === 'string' || Buffer.isBuffer(file) ? file : file.text);
    if (typeof file === 'object' && !Buffer.isBuffer(file)) await chmod(join(dir, path), file.mode);
  }
  return { directory: dir, hash: (await readTree(dir)).hash };
}
/** Merges three sides of a skill in a fresh home; answers what Merge answered, the merged folder's files, how many versions are stored, and what .central-knot/ holds after. */
async function merge(base: Side, yours: Side, theirs: Side) {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    const done = await mergeSkill(box.context, newItem('notes', 'notes'), { base: await folder(box, 'base', base), yours: await folder(box, 'yours', yours), theirs: await folder(box, 'theirs', theirs) });
    const files: Record<string, { text: string; mode: string }> = {};
    if ('merged' in done) {
      for (const path of (await readTree(done.merged.directory)).files.keys()) files[path] = { text: await readFile(join(done.merged.directory, path), 'utf8'), mode: ((await stat(join(done.merged.directory, path))).mode & 0o777).toString(8) };
      assert.deepEqual(await readVersion(box.context, 'notes', done.merged.hash), done.merged, 'the merged version is in the store');
    }
    const stored = (await readdir(join(box.home, '.central-knot/items/skills/notes/versions')).catch(() => [])).length;
    return { done, files, stored, left: (await readdir(join(box.home, '.central-knot'))).filter(name => name.startsWith('merging-')) };
  } finally { await box.cleanup(); }
}
const skill = (description: string, body: string) => `---\nname: notes\ndescription: ${description}\n---\n\n${body}\n`;

test('Both sides changed SKILL.md, in lines apart: the line merge has both, the merged version is stored, and nothing of the merge is left', async () => {
  const { done, files, stored, left } = await merge({ 'SKILL.md': skill('Takes notes.', 'Write them down.') }, { 'SKILL.md': skill('Takes notes.', 'Write them down, my way.') }, { 'SKILL.md': skill('Takes notes, the team’s way.', 'Write them down.') });
  assert.ok('merged' in done);
  assert.equal(files['SKILL.md'].text, skill('Takes notes, the team’s way.', 'Write them down, my way.'));
  assert.deepEqual([stored, left], [1, []]);
});

test('Both sides changed the same line: a conflict naming SKILL.md, nothing stored, and nothing of the merge is left', async () => {
  const { done, stored, left } = await merge({ 'SKILL.md': skill('Takes notes.', 'Write.') }, { 'SKILL.md': skill('Takes notes.', 'Write, mine.') }, { 'SKILL.md': skill('Takes notes.', 'Write, theirs.') });
  assert.deepEqual(done, { conflicts: ['SKILL.md'] });
  assert.deepEqual([stored, left], [0, []]);
});

test('One Merge names every conflicting file: those the folders’ comparison finds (deleted against changed, added differently) and those the line merge finds (lines next to each other, a binary file)', async () => {
  const png = (byte: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, byte, 0, 1, 2, 3]);
  const base = { 'SKILL.md': skill('Takes notes.', 'Write.'), 'adj.md': 'A\nB\nC\nD\n', 'del.md': 'Del.\n', 'img.png': png(1) };
  const { done, stored, left } = await merge(base,
    { 'SKILL.md': skill('Takes notes.', 'Write.'), 'adj.md': 'A\nB mine\nC\nD\n', 'img.png': png(2), 'both.md': 'Mine.\n' },
    { ...base, 'adj.md': 'A\nB\nC theirs\nD\n', 'del.md': 'Del, changed.\n', 'img.png': png(3), 'both.md': 'Theirs.\n' });
  assert.deepEqual(done, { conflicts: ['adj.md', 'both.md', 'del.md', 'img.png'] });
  assert.deepEqual([stored, left], [0, []]);
});

test('A binary file both sides changed is a conflict, though its bytes are far apart', async () => {
  const bytes = (at: number) => { const buffer = Buffer.alloc(4000, 0); buffer[at] = 1; return buffer; };
  const { done } = await merge({ 'SKILL.md': skill('Takes notes.', 'Write.'), 'logo.png': bytes(0) }, { 'SKILL.md': skill('Takes notes.', 'Write.'), 'logo.png': bytes(10) }, { 'SKILL.md': skill('Takes notes.', 'Write.'), 'logo.png': bytes(3990) });
  assert.deepEqual(done, { conflicts: ['logo.png'] });
});

test('Bytes as they are: Windows line endings stay through the line merge, a file with no last newline merges as it is, and one missing its last newline here only is a change that survives', async () => {
  const crlf = (...lines: string[]) => `${lines.join('\r\n')}\r\n`;
  const { done, files } = await merge(
    { 'SKILL.md': crlf('---', 'name: notes', 'description: Takes notes.', '---', '', 'One.', 'Two.', 'Three.'), 'tail.md': 'a\nb\nc\nd\ne', 'end.md': 'last\n' },
    { 'SKILL.md': crlf('---', 'name: notes', 'description: Takes notes.', '---', '', 'One.', 'Two.', 'Three, mine.'), 'tail.md': 'A\nb\nc\nd\ne', 'end.md': 'last' },
    { 'SKILL.md': crlf('---', 'name: notes', 'description: Takes notes, theirs.', '---', '', 'One.', 'Two.', 'Three.'), 'tail.md': 'a\nb\nc\nd\nE', 'end.md': 'last\n' });
  assert.ok('merged' in done);
  assert.equal(files['SKILL.md'].text, crlf('---', 'name: notes', 'description: Takes notes, theirs.', '---', '', 'One.', 'Two.', 'Three, mine.'));
  assert.equal(files['tail.md'].text, 'A\nb\nc\nd\nE');
  assert.equal(files['end.md'].text, 'last', 'the newline removed here stays removed');
});

test('A script made runnable here while the source rewrote it: the merged script has the source’s bytes and stays runnable; a file added here only survives', async () => {
  const base = { 'SKILL.md': skill('Takes notes.', 'Write.'), 'run.sh': { text: '#!/bin/sh\necho one\n', mode: 0o644 } };
  const { done, files } = await merge(base, { ...base, 'run.sh': { text: '#!/bin/sh\necho one\n', mode: 0o755 }, 'mine.md': 'Mine.\n' }, { ...base, 'run.sh': { text: '#!/bin/sh\necho two\n', mode: 0o644 } });
  assert.ok('merged' in done);
  assert.deepEqual([files['run.sh'], files['mine.md']?.text], [{ text: '#!/bin/sh\necho two\n', mode: '755' }, 'Mine.\n']);
});
