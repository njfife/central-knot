import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copilotProblem, discover, parseSkill } from '../src/discovery.ts';
import { execFileSync } from 'node:child_process';
import { buildPreview, FORMAT_VERSION, start, storeDirectory, undo, type ShareContext } from '../src/share.ts';
import type { HarnessId, Snapshot } from '../src/types.ts';

const both: HarnessId[] = ['claude-cli', 'copilot-cli'];
const CLAUDE = '.claude/skills', COPILOT = '.copilot/skills', AGENTS = '.agents/skills';
const noPosix = process.platform === 'win32';

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-share-')));
  const home = join(base, 'home');
  await mkdir(home);
  return { base, home, settingsPath: join(base, 'settings', 'settings.json'), realHome: join(base, 'real-home'), cleanup: () => { execFileSync('chmod', ['-R', 'u+rwx', base]); return rm(base, { recursive: true, force: true }); } };
}
type Box = Awaited<ReturnType<typeof sandbox>>;

const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: A ${name} skill.\n---\n\n${body}\n`;

async function skill(home: string, root: string, folder: string, content = text(folder)) {
  const directory = join(home, root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), content);
  return directory;
}

const reader = (home: string, mode: Snapshot['mode']) => () => Promise.all(both.map(harness => discover({ home, mode, harness })));

function ctx(box: Box, extra: Partial<ShareContext> = {}): ShareContext {
  return { home: box.home, mode: 'custom', read: reader(box.home, 'custom'), build: 'test-build', settingsPath: box.settingsPath, realHome: box.realHome, ...extra };
}

/** Every path, type, mode, mtime and content hash under a directory. */
async function tree(directory: string, skip: string[] = []): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (skip.includes(entry.name)) continue;
      const path = join(current, entry.name);
      const info = await lstat(path);
      if (entry.isSymbolicLink()) out[path] = `link:${await readlink(path)}`;
      else if (entry.isDirectory()) { out[path] = `dir:${info.mode}`; await visit(path); }
      else out[path] = `file:${info.mode}:${info.mtimeMs}:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
    }
  }
  await visit(directory);
  return out;
}
const exists = (path: string) => lstat(path).then(() => true, () => false);
const state = (preview: { items: { key: string; state: string }[] }, key: string) => preview.items.find(item => item.key === key)?.state;

test('1b.1: the Copilot reader finds its own and shared .agents skills, and no project ones', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'own');
    await skill(box.home, AGENTS, 'shared-root');
    await skill(join(box.home, 'project'), '.github/skills', 'project-only');
    const before = await tree(box.home);
    const snapshot = await discover({ home: box.home, mode: 'custom', harness: 'copilot-cli' });
    assert.deepEqual(snapshot.skills.map(item => item.folder), ['own', 'shared-root']);
    assert.equal(snapshot.detection, 'Config found but app not detected');
    assert.deepEqual(snapshot.skills.map(item => item.rootLabel), ['Copilot skills', 'Shared .agents skills']);
    assert.deepEqual(await tree(box.home), before);
  } finally { await box.cleanup(); }
});

test('1b.1: a same-named skill in both Copilot folders stays two labelled rows', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'dup');
    await skill(box.home, AGENTS, 'dup');
    const snapshot = await discover({ home: box.home, mode: 'custom', harness: 'copilot-cli' });
    assert.equal(snapshot.skills.length, 2);
    assert.equal(new Set(snapshot.skills.map(item => item.id)).size, 2);
    assert.ok(snapshot.skills[1].notes.some(note => note.includes('another')));
  } finally { await box.cleanup(); }
});

test('8a Preview / AT-48: zero writes, with collision diff, identical and copy recognized', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'only-claude');
    await skill(box.home, COPILOT, 'only-copilot');
    await skill(box.home, CLAUDE, 'same');
    await skill(box.home, COPILOT, 'same');
    await skill(box.home, CLAUDE, 'differs', text('differs', 'Claude version.'));
    await skill(box.home, COPILOT, 'differs', text('differs', 'Copilot version.'));
    const before = await tree(box.base);
    const preview = await buildPreview(ctx(box), both, []);
    assert.deepEqual(await tree(box.base), before, 'preview wrote nothing, not even state');
    assert.equal(state(preview, 'only-claude'), 'copy');
    assert.equal(state(preview, 'only-copilot'), 'copy');
    assert.equal(state(preview, 'same'), 'identical');
    const collision = preview.items.find(item => item.key === 'differs')!;
    assert.equal(collision.state, 'collision');
    assert.equal(collision.status, 'Needs a decision');
    assert.match(collision.diff!, /- Claude version\./);
    assert.match(collision.diff!, /\+ Copilot version\./);
    assert.ok(collision.diff!.indexOf('- Claude version.') < collision.diff!.indexOf('+ Copilot version.'));
    assert.equal(preview.gate.state, 'first-setup');
    assert.deepEqual(preview.disclosures[1].writesTo, join(box.home, COPILOT));
  } finally { await box.cleanup(); }
});

test('OWN-03: tools already reading one physical folder need no copy', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const real = await skill(box.home, AGENTS, 'linked');
    await mkdir(join(box.home, CLAUDE), { recursive: true });
    await symlink(real, join(box.home, CLAUDE, 'linked'));
    const before = await tree(box.home);
    const context = ctx(box);
    assert.equal(state(await buildPreview(context, both, []), 'linked'), 'already-shared');
    const result = await start(context, both, []);
    assert.equal(result.harnessWrites, 0);
    assert.deepEqual(await tree(box.home, ['.central-knot']), before);
    assert.equal(await readlink(join(box.home, CLAUDE, 'linked')), real, 'the link stays a link');
  } finally { await box.cleanup(); }
});

test('8a First copy: a skill with an internal link is held; no link is created or followed', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const directory = await skill(box.home, CLAUDE, 'has-link');
    await writeFile(join(box.base, 'outside.txt'), 'outside');
    await symlink(join(box.base, 'outside.txt'), join(directory, 'asset'));
    const before = await tree(box.home);
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 0);
    assert.equal(result.results[0].outcome, 'held');
    assert.match(result.results[0].message, /link \(asset\)/);
    assert.deepEqual(await tree(box.home, ['.central-knot']), before);
    assert.equal(await exists(join(box.home, COPILOT)), false);
  } finally { await box.cleanup(); }
});

test('8a First copy: Review versus unrelated review is a same-name match with zero target writes', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'Review', text('Review', 'One.'));
    await skill(box.home, COPILOT, 'review', text('review', 'Two.'));
    const before = await tree(box.home);
    const result = await start(ctx(box), both, []);
    assert.equal(state(result.preview, 'review'), 'collision');
    assert.equal(result.harnessWrites, 0);
    assert.deepEqual(await tree(box.home, ['.central-knot']), before);
  } finally { await box.cleanup(); }
});

test('AT-07 parts: bytes and modes copied, .git not, sources untouched, and a repeat writes nothing', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const source = await skill(box.home, CLAUDE, 'rich', text('rich', 'Values stay as they are: token=abc123'));
    await mkdir(join(source, 'scripts'));
    await writeFile(join(source, 'scripts/run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
    await chmod(join(source, 'scripts/run.sh'), 0o755);
    await writeFile(join(source, 'asset.bin'), Buffer.from([0, 1, 2, 255, 254]));
    await mkdir(join(source, 'empty'));
    await mkdir(join(source, '.git'));
    await writeFile(join(source, '.git/HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(box.home, '.claude/unrelated.json'), '{ "keep":   "these bytes" }\n');
    const beforeSource = await tree(join(box.home, '.claude'));
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 1);
    const copy = join(box.home, COPILOT, 'rich');
    assert.equal(await readFile(join(copy, 'SKILL.md'), 'utf8'), await readFile(join(source, 'SKILL.md'), 'utf8'));
    assert.deepEqual(await readFile(join(copy, 'asset.bin')), Buffer.from([0, 1, 2, 255, 254]));
    assert.equal((await stat(join(copy, 'scripts/run.sh'))).mode & 0o777, 0o755);
    assert.equal(await exists(join(copy, '.git')), false, 'nested .git is not copied');
    assert.equal(await exists(join(copy, 'empty')), true);
    assert.deepEqual(await tree(join(box.home, '.claude')), beforeSource, 'source and unrelated bytes unchanged');
    assert.match(result.results[0].message, /Copilot CLI/);
    assert.match(result.results[0].message, /new session/);
    const imported = join(storeDirectory(box.home), 'items', 'rich');
    const [revision] = await readdir(imported);
    assert.equal(await exists(join(imported, revision, '.git')), false);
    assert.equal((await stat(join(imported, revision, 'scripts/run.sh'))).mode & 0o777, 0o755);
    assert.equal(state(result.preview, 'rich'), 'identical');
    assert.equal(result.preview.items[0].status, 'Written');

    const beforeRepeat = await tree(box.base);
    const repeat = await start(ctx(box), both, []);
    assert.equal(repeat.harnessWrites, 0);
    assert.deepEqual(await tree(box.base), beforeRepeat, 'a repeat changes no byte anywhere');
  } finally { await box.cleanup(); }
});

test('AT-48: a collision writes nothing while unrelated skills still copy; identical is taken over', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'clash', text('clash', 'A'));
    const clashB = await skill(box.home, COPILOT, 'clash', text('clash', 'B'));
    await skill(box.home, CLAUDE, 'twin');
    const twin = await skill(box.home, COPILOT, 'twin');
    await skill(box.home, COPILOT, 'unrelated');
    const before = await readFile(join(clashB, 'SKILL.md'), 'utf8');
    const twinBefore = await tree(twin);
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 1);
    assert.equal(await readFile(join(clashB, 'SKILL.md'), 'utf8'), before);
    assert.equal(await readFile(join(box.home, CLAUDE, 'clash/SKILL.md'), 'utf8'), text('clash', 'A'));
    assert.equal(await exists(join(box.home, CLAUDE, 'unrelated/SKILL.md')), true);
    assert.deepEqual(await tree(twin), twinBefore);
    assert.equal(await exists(join(storeDirectory(box.home), 'items/clash')), false, 'a collision imports nothing');
  } finally { await box.cleanup(); }
});

test('SYN-08: Don\'t share holds; nothing copied, nothing imported, and it stays held at the next Start', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'private');
    await skill(box.home, CLAUDE, 'public');
    const result = await start(ctx(box), both, ['private']);
    assert.equal(await exists(join(box.home, COPILOT, 'private')), false);
    assert.equal(await exists(join(box.home, COPILOT, 'public')), true);
    assert.equal(await exists(join(storeDirectory(box.home), 'items/private')), false);
    assert.equal(state(result.preview, 'private'), 'dont-share');
    const again = await start(ctx(box), both, []);
    assert.equal(again.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'private')), false);
  } finally { await box.cleanup(); }
});

test('AT-27: a target that will not load is skipped by name; others continue; known losses are named', async () => {
  const box = await sandbox();
  try {
    const plain = 'No frontmatter here.\n';
    await skill(box.home, CLAUDE, 'plain', plain);
    await skill(box.home, COPILOT, 'copilot-plain', plain);
    await skill(box.home, COPILOT, 'no-description', '---\nname: no-description\n---\nBody\n');
    await skill(box.home, CLAUDE, 'scoped', '---\nname: scoped\ndescription: x\npaths: ["src/**"]\nuser-invocable: false\ndisable-model-invocation: true\n---\nBody\n');
    const preview = await buildPreview(ctx(box), both, []);
    const plainItem = preview.items.find(item => item.key === 'plain')!;
    assert.equal(plainItem.status, 'Not available here');
    assert.match(plainItem.reason, /no YAML frontmatter/);
    assert.equal(state(preview, 'copilot-plain'), 'copy', 'Claude Code has no such limit, so that direction still copies');
    const scoped = preview.items.find(item => item.key === 'scoped')!;
    assert.equal(scoped.targets[0].limits.length, 3);
    const result = await start(ctx(box), both, []);
    assert.equal(await exists(join(box.home, COPILOT, 'plain')), false);
    assert.equal(await readFile(join(box.home, CLAUDE, 'no-description/SKILL.md'), 'utf8'), '---\nname: no-description\n---\nBody\n');
    assert.equal(await readFile(join(box.home, COPILOT, 'scoped/SKILL.md'), 'utf8'), await readFile(join(box.home, CLAUDE, 'scoped/SKILL.md'), 'utf8'));
    assert.equal(result.preview.items.find(item => item.key === 'scoped')!.status, 'With limits');
  } finally { await box.cleanup(); }
});

test('AT-34 skill parts: one selected harness imports with no harness byte changed; the other stays unread', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const real = await skill(box.home, 'elsewhere', 'linked');
    await mkdir(join(box.home, CLAUDE), { recursive: true });
    await symlink(real, join(box.home, CLAUDE, 'linked'));
    await skill(box.home, COPILOT, 'not-selected');
    const before = await tree(box.home);
    const result = await start(ctx(box), ['claude-cli'], []);
    assert.equal(result.harnessWrites, 0);
    assert.deepEqual(await tree(box.home, ['.central-knot']), before);
    assert.equal(await exists(join(storeDirectory(box.home), 'items/linked')), true);
    assert.equal(await exists(join(storeDirectory(box.home), 'items/not-selected')), false);
    assert.equal((await lstat(join(box.home, CLAUDE, 'linked'))).isSymbolicLink(), true);
  } finally { await box.cleanup(); }
});

test('First writes: an interrupted write leaves no partial skill, and a retry completes it', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    let insideDuringWrite: string[] = ['not checked'];
    const check = () => readdirSync(join(box.home, COPILOT));
    const fault = (step: string) => { if (step === 'before-rename') { insideDuringWrite = check(); throw new Error('fault: crash before rename'); } };
    await assert.rejects(start(ctx(box, { fault }), both, []), /fault:/);
    assert.deepEqual(insideDuringWrite, [], 'a tool loading this folder never sees a half-written copy');
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
    assert.deepEqual(await readdir(join(box.home, '.copilot')), ['skills'], 'no stage left behind');
    await mkdir(join(box.home, '.copilot', '.ck-stage-from-a-real-crash', 'half'), { recursive: true });
    const retry = await start(ctx(box), both, []);
    assert.equal(retry.harnessWrites, 1);
    assert.deepEqual(await readdir(join(box.home, COPILOT)), ['solo']);
    assert.deepEqual(await readdir(join(box.home, '.copilot')), ['skills'], 'a stale stage is cleared');
  } finally { await box.cleanup(); }
});

test('First writes: a crash after the rename leaves a copy that later Undo can still remove', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    const fault = (step: string) => { if (step === 'after-rename') throw new Error('fault: crash after rename'); };
    await assert.rejects(start(ctx(box, { fault }), both, []), /fault:/);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
    const repeat = await start(ctx(box), both, []);
    assert.equal(repeat.harnessWrites, 0);
    const undone = await undo(ctx(box), both);
    assert.equal(undone.harnessWrites, 1);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
  } finally { await box.cleanup(); }
});

test('First writes: a linked target root stays a link and is written through; a dangling target is held', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await skill(box.home, CLAUDE, 'blocked');
    const elsewhere = join(box.base, 'elsewhere-skills');
    await mkdir(elsewhere);
    await mkdir(join(box.home, '.copilot'), { recursive: true });
    await symlink(elsewhere, join(box.home, COPILOT));
    await symlink(join(box.base, 'nowhere'), join(elsewhere, 'blocked'));
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 1);
    assert.equal((await lstat(join(box.home, COPILOT))).isSymbolicLink(), true);
    assert.equal(await exists(join(elsewhere, 'solo/SKILL.md')), true);
    assert.equal(await readlink(join(elsewhere, 'blocked')), join(box.base, 'nowhere'));
    assert.equal(state(result.preview, 'blocked'), 'held');
  } finally { await box.cleanup(); }
});

test('OWN-01: a folder without SKILL.md at the destination is never overwritten', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'taken');
    await mkdir(join(box.home, COPILOT, 'taken'), { recursive: true });
    await writeFile(join(box.home, COPILOT, 'taken/notes.txt'), 'mine');
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await readFile(join(box.home, COPILOT, 'taken/notes.txt'), 'utf8'), 'mine');
    assert.equal(state(result.preview, 'taken'), 'held');
  } finally { await box.cleanup(); }
});

test('Undo: removes only unchanged copies it created; everything else stays, and nothing recopies', async () => {
  const box = await sandbox();
  try {
    const sourceA = await skill(box.home, CLAUDE, 'copied');
    await skill(box.home, CLAUDE, 'edited-later');
    await skill(box.home, CLAUDE, 'twin');
    const twin = await skill(box.home, COPILOT, 'twin');
    await start(ctx(box), both, []);
    await writeFile(join(box.home, COPILOT, 'edited-later/SKILL.md'), text('edited-later', 'Edited by hand.'));
    const before = await tree(sourceA);
    const undone = await undo(ctx(box), both);
    assert.equal(undone.harnessWrites, 1);
    assert.equal(await exists(join(box.home, COPILOT, 'copied')), false);
    assert.deepEqual(await tree(sourceA), before, 'the source stays');
    assert.equal(await exists(join(box.home, COPILOT, 'edited-later/SKILL.md')), true, 'a changed copy stays');
    assert.ok(undone.results.some(result => result.item === 'edited-later' && result.outcome === 'stayed' && /Changed/.test(result.message)));
    assert.equal(await exists(join(twin, 'SKILL.md')), true, 'a taken-over copy stays');
    assert.deepEqual(undone.results.filter(result => result.item === 'twin'), [], 'a whole-Start Undo leaves a skill it did not copy alone');
    assert.equal(undone.preview.items.find(item => item.key === 'twin')!.status, 'Written');
    assert.equal(await exists(join(storeDirectory(box.home), 'items/copied')), true, 'imported bytes stay');
    const preview = undone.preview;
    assert.equal(state(preview, 'copied'), 'dont-share');
    assert.equal(preview.items.find(item => item.key === 'copied')!.locked, true);
    assert.equal(preview.canUndo, false);
    const beforeRepeat = await tree(box.home);
    const repeat = await start(ctx(box), both, []);
    assert.equal(repeat.harnessWrites, 0, 'a second Start after Undo does not recopy');
    assert.deepEqual(await tree(box.home), beforeRepeat);
  } finally { await box.cleanup(); }
});

test('Undo: a copy someone added .git or a link to stays', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'adopted');
    await skill(box.home, CLAUDE, 'linked-up');
    await start(ctx(box), both, []);
    await mkdir(join(box.home, COPILOT, 'adopted/.git'));
    await writeFile(join(box.home, COPILOT, 'adopted/.git/HEAD'), 'mine');
    await symlink('SKILL.md', join(box.home, COPILOT, 'linked-up/alias'));
    const undone = await undo(ctx(box), both);
    assert.equal(undone.harnessWrites, 0);
    assert.equal(await readFile(join(box.home, COPILOT, 'adopted/.git/HEAD'), 'utf8'), 'mine');
    assert.equal(await exists(join(box.home, COPILOT, 'linked-up/alias')), true);
  } finally { await box.cleanup(); }
});

test('Undo per item on a skill it did not copy keeps every copy and says so', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'twin');
    const twin = await skill(box.home, COPILOT, 'twin');
    await start(ctx(box), both, []);
    const undone = await undo(ctx(box), both, 'twin');
    assert.equal(undone.harnessWrites, 0);
    assert.equal(await exists(join(twin, 'SKILL.md')), true);
    assert.deepEqual(undone.results.map(result => result.outcome), ['stayed']);
  } finally { await box.cleanup(); }
});

test('A Start interrupted by a crash and retried is one Start for Undo', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'first');
    await skill(box.home, CLAUDE, 'second');
    let crashes = 0;
    const fault = (step: string) => { if (step === 'after-rename' && crashes++ === 0) throw new Error('fault: crash after rename'); };
    await assert.rejects(start(ctx(box, { fault }), both, []), /fault:/);
    const retry = await start(ctx(box), both, []);
    assert.equal(retry.harnessWrites, 1);
    assert.equal(retry.preview.canUndo, true);
    const undone = await undo(ctx(box), both);
    assert.equal(undone.harnessWrites, 2, 'both copies go, though two runs made them');
    const repeat = await start(ctx(box), both, []);
    assert.equal(repeat.harnessWrites, 0);
    const record = JSON.parse(await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8'));
    assert.equal(record.activeStartId, undefined, 'finished Starts leave no marker');
  } finally { await box.cleanup(); }
});

test('Undo per item leaves the other copies in place', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'first');
    await skill(box.home, CLAUDE, 'second');
    await start(ctx(box), both, []);
    const undone = await undo(ctx(box), both, 'first');
    assert.equal(undone.harnessWrites, 1);
    assert.equal(await exists(join(box.home, COPILOT, 'first')), false);
    assert.equal(await exists(join(box.home, COPILOT, 'second')), true);
    assert.equal(undone.preview.canUndo, true);
  } finally { await box.cleanup(); }
});

test('8a hold: an edit or lost copy after sharing writes nothing; a later Start neither reverts nor recreates', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'edited');
    await skill(box.home, CLAUDE, 'lost');
    await start(ctx(box), both, []);
    await writeFile(join(box.home, CLAUDE, 'edited/SKILL.md'), text('edited', 'A later edit.'));
    await rm(join(box.home, COPILOT, 'lost'), { recursive: true });
    const before = await tree(box.home, ['.central-knot']);
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 0);
    assert.deepEqual(await tree(box.home, ['.central-knot']), before);
    assert.equal(state(result.preview, 'edited'), 'held');
    assert.equal(state(result.preview, 'lost'), 'held');
    assert.equal(result.preview.items.find(item => item.key === 'lost')!.status, 'Not known yet');
  } finally { await box.cleanup(); }
});

test('Section 3 stops: damage, loss, a different generation, a newer format and another owner write nothing', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await start(ctx(box), both, []);
    await skill(box.home, CLAUDE, 'new-one');
    const path = join(storeDirectory(box.home), 'sync.json');
    const good = await readFile(path, 'utf8');
    const record = JSON.parse(good);
    const attempt = async (bad: string | null, expected: RegExp) => {
      if (bad === null) await rm(path); else await writeFile(path, bad);
      const before = await tree(box.home);
      const result = await start(ctx(box), both, []);
      assert.match(result.stopped ?? '', expected);
      assert.equal(result.harnessWrites, 0);
      assert.deepEqual(await tree(box.home), before);
      const undone = await undo(ctx(box), both);
      assert.equal(undone.harnessWrites, 0);
    };
    await attempt('{ not json', /damaged/);
    await attempt(null, /missing/);
    await attempt(JSON.stringify({ ...record, generation: 'other' }), /not the one/);
    await attempt(JSON.stringify({ ...record, formatVersion: FORMAT_VERSION + 1 }), /newer/);
    await attempt(JSON.stringify({ ...record, owner: 'someone-else' }), /another Central Knot/);
    await writeFile(path, good);
    assert.equal((await start(ctx(box), both, [])).harnessWrites, 1, 'restoring the record then retrying resumes');
  } finally { await box.cleanup(); }
});

test('Section 3 resume: lost settings wait for an explicit resume that keeps the record', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await start(ctx(box), both, []);
    const record = await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8');
    await rm(box.settingsPath);
    await skill(box.home, CLAUDE, 'new-one');
    const blocked = await start(ctx(box), both, []);
    assert.match(blocked.stopped ?? '', /no memory/);
    assert.equal(blocked.harnessWrites, 0);
    const resumed = await start(ctx(box), both, [], true);
    assert.equal(resumed.harnessWrites, 1);
    assert.equal(JSON.parse(await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8')).generation, JSON.parse(record).generation);
  } finally { await box.cleanup(); }
});

test('Write guard: the real home stays read-only however it is reached', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.realHome, CLAUDE, 'real-skill');
    const real = await mkdtemp(join(box.base, 'sim-'));
    const direct = async (home: string, mode: 'actual' | 'custom') => {
      const before = await tree(box.realHome);
      const context: ShareContext = { home, mode, read: reader(home, mode), build: 'test-build', settingsPath: box.settingsPath, realHome: box.realHome };
      const result = await start(context, both, []);
      assert.match(result.stopped ?? '', /Preview only/);
      assert.equal(result.preview.access.allowed, false);
      assert.deepEqual(await tree(box.realHome), before);
    };
    await direct(box.realHome, 'actual');
    await direct(box.realHome, 'custom');
    await direct(box.base, 'custom');
    await symlink(join(box.realHome, '.claude'), join(real, '.claude'));
    await direct(real, 'custom');
    const roots = await mkdtemp(join(box.base, 'sim-'));
    await mkdir(join(roots, '.copilot'));
    await mkdir(join(box.realHome, '.copilot/skills'), { recursive: true });
    await symlink(join(box.realHome, '.copilot/skills'), join(roots, '.copilot/skills'));
    await direct(roots, 'custom');
  } finally { await box.cleanup(); }
});

test('Real home: written only when chosen and allowed; a relative override and an absent tool get nothing', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.realHome, CLAUDE, 'real-skill');
    const context: ShareContext = { home: box.realHome, mode: 'actual', read: reader(box.realHome, 'actual'), build: 'test-build', settingsPath: box.settingsPath, realHome: box.realHome, allowActualWrites: true };
    const before = await tree(box.realHome);
    const relative = await start({ ...context, overrides: { 'copilot-cli': 'relative-root' } }, both, []);
    assert.match(relative.stopped ?? '', /COPILOT_HOME is not an absolute path/);
    assert.deepEqual(await tree(box.realHome), before);
    const absent = await start(context, both, []);
    assert.equal(absent.harnessWrites, 0, 'Copilot is not detected in this home');
    assert.match(absent.results[0].message + absent.preview.items[0].reason, /not found on this machine/);
    assert.equal(await exists(join(box.realHome, COPILOT)), false);
    await mkdir(join(box.realHome, '.copilot'));
    const written = await start(context, both, []);
    assert.equal(written.harnessWrites, 1);
    assert.equal(await exists(join(box.realHome, COPILOT, 'real-skill/SKILL.md')), true);
    assert.equal((await undo(context, both)).harnessWrites, 1);
    assert.equal(await exists(join(box.realHome, COPILOT, 'real-skill')), false);
  } finally { await box.cleanup(); }
});

test('First writes: an unreadable destination root gets nothing', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await mkdir(join(box.home, COPILOT), { recursive: true });
    await chmod(join(box.home, COPILOT), 0o000);
    const result = await start(ctx(box), both, []);
    await chmod(join(box.home, COPILOT), 0o755);
    assert.equal(result.harnessWrites, 0);
    assert.match(result.preview.items[0].reason, /could not be read/);
  } finally { await box.cleanup(); }
});

test('Dot-folders: Claude Code loads them and Copilot CLI does not, so that copy is skipped by name', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, '.hidden-skill');
    await skill(box.home, COPILOT, '.ignored-by-copilot');
    const [claude, copilot] = await reader(box.home, 'custom')();
    assert.deepEqual(claude.skills.map(item => item.folder), ['.hidden-skill']);
    assert.deepEqual(copilot.skills.map(item => item.folder), []);
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 0);
    assert.match(result.preview.items[0].reason, /folder starting with a dot/);
    assert.equal(await exists(join(box.home, COPILOT, '.hidden-skill')), false);
  } finally { await box.cleanup(); }
});

test('Undo never parks a copy inside a folder a tool loads', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await start(ctx(box), both, []);
    await undo(ctx(box), both);
    assert.deepEqual(await readdir(join(box.home, COPILOT)), []);
    assert.deepEqual(await readdir(join(box.home, '.copilot')), ['skills']);
  } finally { await box.cleanup(); }
});

test('A skill with an unreadable file is held, and the others still copy', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'good');
    const locked = await skill(box.home, CLAUDE, 'locked');
    await writeFile(join(locked, 'ref.md'), 'private');
    await chmod(join(locked, 'ref.md'), 0o000);
    const result = await start(ctx(box), both, []);
    await chmod(join(locked, 'ref.md'), 0o644);
    assert.equal(result.harnessWrites, 1);
    assert.equal(state(result.preview, 'locked'), 'held');
    assert.match(result.preview.items.find(item => item.key === 'locked')!.reason, /could not be read/);
    assert.equal(await exists(join(box.home, COPILOT, 'good/SKILL.md')), true);
    assert.equal(await exists(join(box.home, COPILOT, 'locked')), false);
  } finally { await box.cleanup(); }
});

test('A very large differing file does not stop the plan', async () => {
  const box = await sandbox();
  try {
    const first = await skill(box.home, CLAUDE, 'large');
    const second = await skill(box.home, COPILOT, 'large');
    await writeFile(join(first, 'data.txt'), 'a'.repeat(3 * 1024 * 1024));
    await writeFile(join(second, 'data.txt'), 'b'.repeat(3 * 1024 * 1024));
    const preview = await buildPreview(ctx(box), both, []);
    assert.equal(state(preview, 'large'), 'collision');
    assert.match(preview.items[0].diff!, /too large to compare/);
  } finally { await box.cleanup(); }
});

test('Read-only folders: Start copies them, and Undo removes them while leaving others alone', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    const sub = await skill(box.home, CLAUDE, 'sub-locked');
    await mkdir(join(sub, 'refs'));
    await writeFile(join(sub, 'refs/a.md'), 'a');
    await chmod(join(sub, 'refs'), 0o555);
    const top = await skill(box.home, CLAUDE, 'top-locked');
    await chmod(top, 0o555);
    await skill(box.home, CLAUDE, 'plain');
    const started = await start(ctx(box), both, []);
    assert.equal(started.harnessWrites, 3, JSON.stringify(started.results));
    assert.equal((await stat(join(box.home, COPILOT, 'top-locked'))).mode & 0o777, 0o555);
    assert.equal((await stat(join(box.home, COPILOT, 'sub-locked/refs'))).mode & 0o777, 0o555);
    const undone = await undo(ctx(box), both);
    assert.equal(undone.harnessWrites, 3, JSON.stringify(undone.results));
    assert.deepEqual(await readdir(join(box.home, COPILOT)), []);
    assert.deepEqual(await readdir(join(box.home, '.copilot')), ['skills'], 'nothing parked behind');
    await chmod(top, 0o755); await chmod(join(sub, 'refs'), 0o755);
  } finally { await box.cleanup(); }
});

test('A stuck leftover does not stop later Starts', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    const stuck = join(box.home, '.copilot', '.ck-stage-stuck');
    await mkdir(join(stuck, 'inner'), { recursive: true });
    await writeFile(join(stuck, 'inner/x'), 'x');
    await chmod(join(stuck, 'inner'), 0o555);
    await chmod(stuck, 0o555);
    assert.equal((await start(ctx(box), both, [])).harnessWrites, 1);
    assert.deepEqual(await readdir(join(box.home, '.copilot')), ['skills'], 'CK can clear its own leftover');
  } finally { await box.cleanup(); }
});

test('Undo: a record it cannot save stops it before anything is removed', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await start(ctx(box), both, []);
    await chmod(storeDirectory(box.home), 0o555);
    const undone = await undo(ctx(box), both);
    await chmod(storeDirectory(box.home), 0o755);
    assert.equal(undone.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
    assert.match(undone.results[0].message, /could not be saved/);
    assert.equal(undone.preview.canUndo, true);
  } finally { await box.cleanup(); }
});

test('Undo never deletes a folder that appeared at the destination during a failed copy', async () => {
  const box = await sandbox();
  try {
    const source = await skill(box.home, CLAUDE, 'solo');
    const fault = (step: string) => { if (step === 'before-rename') mkdirSync(join(box.home, COPILOT, 'solo'), { recursive: true }), writeFileSync(join(box.home, COPILOT, 'solo/SKILL.md'), readFileSync(join(source, 'SKILL.md'))); };
    const first = await start(ctx(box, { fault }), both, []);
    assert.equal(first.harnessWrites, 0);
    assert.equal(first.results[0].outcome, 'failed');
    assert.match(first.results[0].message, /appeared at the destination/);
    await start(ctx(box), both, []);
    const undone = await undo(ctx(box), both, 'solo');
    assert.equal(undone.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true, 'never created by Start, so it stays');
  } finally { await box.cleanup(); }
});

test('Undo keeps a copy whose source is gone, so the last copy is never removed', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await start(ctx(box), both, []);
    await rm(join(box.home, CLAUDE, 'solo'), { recursive: true });
    const undone = await undo(ctx(box), both);
    assert.equal(undone.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
    assert.match(undone.results[0].message, /source is gone/);
  } finally { await box.cleanup(); }
});

test('SKL-02: Copilot CLI refusals measured on 1.0.107 are skipped by name, and what it loads is not', () => {
  const named = (name: string, description = 'x') => `---\nname: ${name}\ndescription: ${description}\n---\nb\n`;
  for (const name of ['ok-name', 'a.b', 'a_b', 'a:b', 'a b', 'ABC', '1abc', 'a'.repeat(64)]) assert.equal(copilotProblem(named(name.includes(':') ? `"${name}"` : name), 'f'), undefined, name);
  for (const name of ['名前', 'café', '"a/b"', '"100%done"', '_lead', '.lead', '-dash', 'a'.repeat(65), '123', 'true']) assert.ok(copilotProblem(named(name), 'f'), name);
  assert.ok(copilotProblem(named('ok', 'd'.repeat(1025)), 'f'));
  assert.equal(copilotProblem(named('ok', 'd'.repeat(1024)), 'f'), undefined);
  assert.ok(copilotProblem('---\ndescription: x\n---\nb\n', '名前'), 'no name uses the folder');
  for (const text of ['\uFEFF---\nname: bom\ndescription: x\n---\nb\n', '--- \nname: trail\ndescription: x\n---\nb\n', '---\r\nname: crlf\r\ndescription: x\r\n---\r\nb\r\n', '---\n---\nb\n']) {
    assert.equal(parseSkill(text, 'folder').hasFrontmatter, true, JSON.stringify(text));
    assert.equal(copilotProblem(text, 'folder'), undefined, JSON.stringify(text));
  }
});

test('SKL-02: a refused name is not written, and is reported as unavailable', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'jp', text('名前'));
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 0);
    assert.equal(result.preview.items[0].status, 'Not available here');
    assert.match(result.preview.items[0].reason, /will not load it/);
  } finally { await box.cleanup(); }
});

test('A Start with one tool ticked leaves collisions and status honest once both are ticked', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'clash', text('clash', 'A'));
    await skill(box.home, COPILOT, 'clash', text('clash', 'B'));
    await skill(box.home, CLAUDE, 'solo');
    const one = await start(ctx(box), ['claude-cli'], []);
    assert.equal(one.harnessWrites, 0);
    assert.equal(one.preview.items.find(item => item.key === 'solo')!.status, 'Not shared', 'nothing reached a second tool');
    const preview = await buildPreview(ctx(box), both, []);
    assert.equal(state(preview, 'clash'), 'collision');
    assert.match(preview.items.find(item => item.key === 'clash')!.diff!, /\+ B/);
    assert.equal(state(preview, 'solo'), 'copy');
    const after = await start(ctx(box), both, []);
    assert.equal(after.harnessWrites, 1);
    assert.equal(await readFile(join(box.home, COPILOT, 'clash/SKILL.md'), 'utf8'), text('clash', 'B'));
  } finally { await box.cleanup(); }
});

test('.DS_Store is no change: not a collision, not an edit, not copied, and Undo still works', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'twin');
    const twin = await skill(box.home, COPILOT, 'twin');
    await writeFile(join(twin, '.DS_Store'), 'finder');
    const source = await skill(box.home, CLAUDE, 'solo');
    await writeFile(join(source, '.DS_Store'), 'finder');
    const started = await start(ctx(box), both, []);
    assert.equal(state(started.preview, 'twin'), 'identical');
    assert.equal(await exists(join(box.home, COPILOT, 'solo/.DS_Store')), false);
    await writeFile(join(box.home, COPILOT, 'solo/.DS_Store'), 'finder again');
    assert.equal(state(await buildPreview(ctx(box), both, []), 'solo'), 'identical');
    assert.equal((await undo(ctx(box), both, 'solo')).harnessWrites, 1);
  } finally { await box.cleanup(); }
});

test('A difference of only an empty folder says so', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'twin');
    const other = await skill(box.home, COPILOT, 'twin');
    await mkdir(join(other, 'empty'));
    const item = (await buildPreview(ctx(box), both, [])).items[0];
    assert.equal(item.state, 'collision');
    assert.match(item.diff!, /empty\/: folder only in GitHub Copilot/);
  } finally { await box.cleanup(); }
});

test('A difference between two folders of one tool names each folder', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'dup', text('dup', 'A'));
    await skill(box.home, AGENTS, 'dup', text('dup', 'B'));
    const item = (await buildPreview(ctx(box), both, [])).items[0];
    assert.match(item.diff!, /- GitHub Copilot, Copilot skills/);
    assert.match(item.diff!, /\+ GitHub Copilot, Shared \.agents skills/);
  } finally { await box.cleanup(); }
});

test('Odd valid names share: constructor, __proto__ and long non-Latin folders', async () => {
  const box = await sandbox();
  try {
    const long = 'あ'.repeat(60);
    for (const name of ['constructor', '__proto__', long, '🎉'.repeat(30)]) await skill(box.home, CLAUDE, name, text('ok-name'));
    const started = await start(ctx(box), both, []);
    assert.equal(started.harnessWrites, 4, JSON.stringify(started.results));
    for (const name of ['constructor', '__proto__', long]) assert.equal(await exists(join(box.home, COPILOT, name, 'SKILL.md')), true, name);
    const repeat = await start(ctx(box), both, ['constructor']);
    assert.equal(repeat.harnessWrites, 0);
    assert.equal((await undo(ctx(box), both, '__proto__')).harnessWrites, 1);
    assert.equal(await exists(join(box.home, COPILOT, '__proto__')), false);
    assert.equal(state(await buildPreview(ctx(box), both, []), '__proto__'), 'dont-share', 'remembered after reading the record again');
  } finally { await box.cleanup(); }
});

test('Don\'t share on constructor is remembered too', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'constructor');
    await start(ctx(box), both, ['constructor']);
    const preview = await buildPreview(ctx(box), both, []);
    assert.equal(state(preview, 'constructor'), 'dont-share');
    assert.equal(preview.items[0].locked, true);
  } finally { await box.cleanup(); }
});

test('A SKILL.md linked to a pipe is reported and never read', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'good');
    const piped = join(box.home, CLAUDE, 'piped');
    await mkdir(piped);
    execFileSync('mkfifo', [join(box.base, 'pipe')]);
    await symlink(join(box.base, 'pipe'), join(piped, 'SKILL.md'));
    const snapshot = await discover({ home: box.home, mode: 'custom' });
    assert.deepEqual(snapshot.skills.map(item => item.folder), ['good']);
    assert.ok(snapshot.issues.some(issue => issue.includes('not a regular file')));
  } finally { await box.cleanup(); }
});

test('A record with malformed items counts as damaged', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await start(ctx(box), both, []);
    const path = join(storeDirectory(box.home), 'sync.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    for (const items of [[], { x: { state: 'shared' } }, { x: { name: 'x', hash: 'h', state: 'odd', copies: [] } }, { x: { name: 'x', hash: 'h', state: 'shared', copies: [{}] } }]) {
      await writeFile(path, JSON.stringify({ ...record, items }));
      const before = await tree(box.home);
      const result = await start(ctx(box), both, []);
      assert.match(result.stopped ?? '', /damaged/, JSON.stringify(items));
      assert.deepEqual(await tree(box.home), before);
    }
  } finally { await box.cleanup(); }
});

test('Start with nothing to share writes nothing, not even a record', async () => {
  const box = await sandbox();
  try {
    const result = await start(ctx(box), both, []);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await exists(storeDirectory(box.home)), false);
  } finally { await box.cleanup(); }
});

test('Practice fixture: the bundled home produces every kind of plan row', async () => {
  const fixture = join(import.meta.dirname, '../fixtures/home');
  const context: ShareContext = { home: fixture, mode: 'fixture', read: reader(fixture, 'fixture'), build: 'test-build', settingsPath: join(tmpdir(), 'ck-unused-settings.json'), realHome: join(tmpdir(), 'ck-unused-home') };
  const preview = await buildPreview(context, both, []);
  assert.deepEqual(preview.items.map(item => `${item.key}:${item.state}`), ['notes:identical', 'release-notes:copy', 'review:collision', 'standup:copy']);
});
