import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyChanges, manageView } from '../src/manage.ts';
import { storeDirectory, type ShareContext } from '../src/share.ts';
import type { HarnessId, Snapshot } from '../src/types.ts';

const both: HarnessId[] = ['claude-cli', 'copilot-cli'];
const CLAUDE = '.claude/skills', COPILOT = '.copilot/skills';
const noPosix = process.platform === 'win32';
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-manage-')));
  const home = join(base, 'home');
  await mkdir(join(home, '.claude'), { recursive: true });
  await mkdir(join(home, '.copilot'), { recursive: true });
  return { base, home, cleanup: () => { execFileSync('chmod', ['-R', 'u+rwx', base]); return rm(base, { recursive: true, force: true }); } };
}
type Box = Awaited<ReturnType<typeof sandbox>>;
const read = (home: string, mode: Snapshot['mode'] = 'custom') => () => Promise.all(both.map(harness => discover({ home, mode, harness })));
const ctx = (box: Box, extra: Partial<ShareContext> = {}): ShareContext => ({ home: box.home, mode: 'custom', read: read(box.home), build: 'test', settingsPath: join(box.base, 'settings.json'), realHome: join(box.base, 'real'), ...extra });
async function skill(home: string, root: string, folder: string, content = text(folder)) {
  const directory = join(home, root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), content);
  return directory;
}
const exists = (path: string) => lstat(path).then(() => true, () => false);
const facts = async (box: Box, key: string) => (await manageView(ctx(box))).skills.find(item => item.key === key)!;
const manage = (key: string, off: HarnessId[] = []) => ({ key, managed: true, off });

test('The view reports each tool’s copy and writes nothing', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'only-claude');
    await skill(box.home, CLAUDE, 'twin'); await skill(box.home, COPILOT, 'twin');
    await skill(box.home, CLAUDE, 'plain', 'No frontmatter.\n');
    const view = await manageView(ctx(box));
    assert.deepEqual(view.tools, both);
    const only = view.skills.find(item => item.key === 'only-claude')!;
    assert.ok(only.copies['claude-cli'] && !only.copies['copilot-cli']);
    assert.equal(only.managed, false);
    assert.equal(only.copies['claude-cli']!.summary, 'Body.');
    const twin = view.skills.find(item => item.key === 'twin')!;
    assert.equal(twin.copies['claude-cli']!.hash, twin.copies['copilot-cli']!.hash);
    assert.match(view.skills.find(item => item.key === 'plain')!.cannot['copilot-cli']!, /frontmatter/);
    assert.equal(await exists(storeDirectory(box.home)), false);
  } finally { await box.cleanup(); }
});

test('Managing one skill copies it where it is missing; unmanaged skills are left alone', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'chosen');
    await skill(box.home, CLAUDE, 'left-alone');
    const result = await applyChanges(ctx(box), [manage('chosen')]);
    assert.equal(result.harnessWrites, 1, JSON.stringify(result));
    assert.equal(await readFile(join(box.home, COPILOT, 'chosen/SKILL.md'), 'utf8'), text('chosen'));
    assert.equal(await exists(join(box.home, COPILOT, 'left-alone')), false);
    assert.equal((await facts(box, 'chosen')).managed, true);
    assert.equal((await facts(box, 'left-alone')).managed, false);
  } finally { await box.cleanup(); }
});

test('A tool turned off gets no copy, and a copy already there stays', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await skill(box.home, CLAUDE, 'both'); await skill(box.home, COPILOT, 'both');
    const result = await applyChanges(ctx(box), [manage('solo', ['copilot-cli']), manage('both', ['copilot-cli'])]);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
    assert.equal(await exists(join(box.home, COPILOT, 'both/SKILL.md')), true);
    assert.deepEqual((await facts(box, 'solo')).off, ['copilot-cli']);
  } finally { await box.cleanup(); }
});

test('Catch-up: a managed copy that goes missing comes back with no changes; an unmanaged one does not', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'kept');
    await skill(box.home, CLAUDE, 'dropped');
    await applyChanges(ctx(box), [manage('kept'), manage('dropped')]);
    await applyChanges(ctx(box), [{ key: 'dropped', managed: false, off: [] }]);
    await rm(join(box.home, COPILOT, 'kept'), { recursive: true });
    await rm(join(box.home, COPILOT, 'dropped'), { recursive: true });
    const caught = await applyChanges(ctx(box), []);
    assert.equal(caught.harnessWrites, 1);
    assert.equal(await exists(join(box.home, COPILOT, 'kept/SKILL.md')), true);
    assert.equal(await exists(join(box.home, COPILOT, 'dropped')), false);
  } finally { await box.cleanup(); }
});

test('Catch-up with no record writes nothing, not even a record', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    const result = await applyChanges(ctx(box), []);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await exists(storeDirectory(box.home)), false);
  } finally { await box.cleanup(); }
});

test('Unmanaging keeps every copy and stops future syncing', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await applyChanges(ctx(box), [manage('solo')]);
    await applyChanges(ctx(box), [{ key: 'solo', managed: false, off: [] }]);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
    await writeFile(join(box.home, CLAUDE, 'solo/SKILL.md'), text('solo', 'Edited.'));
    assert.equal((await applyChanges(ctx(box), [])).harnessWrites, 0);
    assert.equal(await readFile(join(box.home, COPILOT, 'solo/SKILL.md'), 'utf8'), text('solo'));
  } finally { await box.cleanup(); }
});

test('Copies differ: nothing is written until a copy is chosen; the chosen copy replaces the other, which is kept in the store', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'clash', text('clash', 'Claude version.'));
    await skill(box.home, COPILOT, 'clash', text('clash', 'Copilot version.'));
    const held = await applyChanges(ctx(box), [manage('clash')]);
    assert.equal(held.harnessWrites, 0);
    assert.match(held.results[0].message, /Choose which copy/);
    assert.equal(await readFile(join(box.home, CLAUDE, 'clash/SKILL.md'), 'utf8'), text('clash', 'Claude version.'));
    const chosen = await applyChanges(ctx(box), [{ ...manage('clash'), use: 'copilot-cli' }]);
    assert.equal(chosen.harnessWrites, 1, JSON.stringify(chosen));
    assert.equal(await readFile(join(box.home, CLAUDE, 'clash/SKILL.md'), 'utf8'), text('clash', 'Copilot version.'));
    const revisions = await readdir(join(storeDirectory(box.home), 'items/clash'));
    const kept = await Promise.all(revisions.map(revision => readFile(join(storeDirectory(box.home), 'items/clash', revision, 'SKILL.md'), 'utf8')));
    assert.ok(kept.includes(text('clash', 'Claude version.')), 'the replaced copy is recoverable');
    assert.equal((await facts(box, 'clash')).copies['claude-cli']!.hash, (await facts(box, 'clash')).copies['copilot-cli']!.hash);
    assert.deepEqual((await readdir(join(box.home, '.claude'))).filter(name => name.startsWith('.ck-')), []);
  } finally { await box.cleanup(); }
});

test('Keep both leaves the skill unmanaged and writes nothing', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'clash', text('clash', 'A'));
    await skill(box.home, COPILOT, 'clash', text('clash', 'B'));
    const result = await applyChanges(ctx(box), [{ ...manage('clash'), use: 'separate' }]);
    assert.equal(result.harnessWrites, 0);
    assert.equal((await facts(box, 'clash')).managed, false);
  } finally { await box.cleanup(); }
});

test('Replacing a read-only copy works and leaves nothing parked', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'clash', text('clash', 'A'));
    const target = await skill(box.home, COPILOT, 'clash', text('clash', 'B'));
    await mkdir(join(target, 'refs')); await writeFile(join(target, 'refs/x.md'), 'x'); await chmod(join(target, 'refs'), 0o555);
    const result = await applyChanges(ctx(box), [{ ...manage('clash'), use: 'claude-cli' }]);
    assert.equal(result.harnessWrites, 1, JSON.stringify(result));
    assert.equal(await readFile(join(box.home, COPILOT, 'clash/SKILL.md'), 'utf8'), text('clash', 'A'));
    assert.deepEqual((await readdir(join(box.home, '.copilot'))).sort(), ['skills']);
  } finally { await box.cleanup(); }
});

test('A held skill and an unloadable target are never written', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const linked = await skill(box.home, CLAUDE, 'has-link');
    await symlink('SKILL.md', join(linked, 'alias'));
    await skill(box.home, CLAUDE, 'plain', 'No frontmatter.\n');
    const result = await applyChanges(ctx(box), [manage('has-link'), manage('plain')]);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'has-link')), false);
    assert.equal(await exists(join(box.home, COPILOT, 'plain')), false);
    assert.equal((await facts(box, 'has-link')).held !== undefined, true);
  } finally { await box.cleanup(); }
});

test('An unreadable skill is held, and the rest still syncs', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    const locked = await skill(box.home, CLAUDE, 'locked');
    await writeFile(join(locked, 'x.md'), 'x'); await chmod(join(locked, 'x.md'), 0o000);
    await skill(box.home, CLAUDE, 'good');
    const result = await applyChanges(ctx(box), [manage('locked'), manage('good')]);
    assert.equal(result.harnessWrites, 1);
    assert.match((await facts(box, 'locked')).held!, /could not be read/);
  } finally { await box.cleanup(); }
});

test('Differing copies inside one tool count as copies that differ', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'dup', text('dup', 'A'));
    await skill(box.home, '.agents/skills', 'dup', text('dup', 'B'));
    const result = await applyChanges(ctx(box), [manage('dup')]);
    assert.equal(result.harnessWrites, 0);
    assert.match(result.results[0].message, /Copies differ/);
  } finally { await box.cleanup(); }
});

test('The real home stays preview-only unless allowed, and damaged state stops writes', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    const refused = await applyChanges(ctx(box, { mode: 'actual', realHome: box.home }), [manage('solo')]);
    assert.match(refused.stopped ?? '', /Preview only/);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
    await applyChanges(ctx(box), [manage('solo')]);
    await writeFile(join(storeDirectory(box.home), 'sync.json'), '{ damaged');
    await rm(join(box.home, COPILOT, 'solo'), { recursive: true });
    const stopped = await applyChanges(ctx(box), []);
    assert.match(stopped.stopped ?? '', /damaged/);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
  } finally { await box.cleanup(); }
});

test('An interrupted copy leaves nothing half-written, and the next pass completes it', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    const fault = (step: string) => { if (step === 'before-rename') throw new Error('fault: crash'); };
    await assert.rejects(applyChanges(ctx(box, { fault }), [manage('solo')]), /fault/);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
    const next = await applyChanges(ctx(box), []);
    assert.equal(next.harnessWrites, 1);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
  } finally { await box.cleanup(); }
});

test('A different copy Copilot reads in the shared .agents folder is shown, never written, and reported', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'dup', text('dup', 'A'));
    await skill(box.home, COPILOT, 'dup', text('dup', 'A'));
    const shared = await skill(box.home, '.agents/skills', 'dup', text('dup', 'B'));
    const view = await facts(box, 'dup');
    assert.equal(view.extra.length, 1);
    assert.equal(view.extra[0].writable, false);
    const result = await applyChanges(ctx(box), [{ ...manage('dup'), use: 'claude-cli' }]);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('dup', 'B'), 'the shared folder is never changed');
    assert.ok(result.results.some(entry => /\.agents\/skills\/dup, which Central Knot does not change/.test(entry.message)), JSON.stringify(result.results));
    assert.equal(result.harnessWrites, 0);
    assert.equal((await facts(box, 'dup')).managed, false, 'a choice that cannot be carried out changes nothing, not even Managed');
    assert.deepEqual(view.choiceBlocks['claude-cli']?.map(block => block.tool), ['copilot-cli'], 'the page is told before anyone chooses');
  } finally { await box.cleanup(); }
});

test('Choosing a copy never writes through a link, and leaves what it points to alone', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'lk', text('lk', 'Claude'));
    const real = await skill(box.base, 'dotfiles', 'lk', text('lk', 'Dotfiles'));
    await mkdir(join(real, 'sub')); await chmod(join(real, 'sub'), 0o500); await chmod(real, 0o555);
    await mkdir(join(box.home, COPILOT), { recursive: true });
    await symlink(real, join(box.home, COPILOT, 'lk'));
    const result = await applyChanges(ctx(box), [{ ...manage('lk'), use: 'claude-cli' }]);
    assert.equal(result.harnessWrites, 0, JSON.stringify(result));
    assert.equal((await lstat(join(box.home, COPILOT, 'lk'))).isSymbolicLink(), true);
    assert.equal(await readlink(join(box.home, COPILOT, 'lk')), real);
    assert.equal((await stat(real)).mode & 0o777, 0o555);
    assert.equal((await stat(join(real, 'sub'))).mode & 0o777, 0o500);
    assert.equal(await readFile(join(real, 'SKILL.md'), 'utf8'), text('lk', 'Dotfiles'));
  } finally { await box.cleanup(); }
});

test('A chosen copy that disappears before Apply all stops that skill, writing nothing', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'clash', text('clash', 'Copilot'));
    const result = await applyChanges(ctx(box), [{ ...manage('clash'), use: 'claude-cli' }]);
    assert.equal(result.harnessWrites, 0);
    assert.match(result.results[0].message, /you chose in Claude Code is gone/);
    assert.equal(await exists(join(box.home, CLAUDE, 'clash')), false);
  } finally { await box.cleanup(); }
});

test('A copy the tool itself refuses counts as one it cannot load', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, COPILOT, 'cafe', text('café'));
    assert.match((await facts(box, 'cafe')).cannot['copilot-cli'] ?? '', /will not load/);
  } finally { await box.cleanup(); }
});

test('A managed skill whose only copy is in a tool turned off is left alone', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    const result = await applyChanges(ctx(box), [manage('solo', ['claude-cli'])]);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
  } finally { await box.cleanup(); }
});

// ---------- Guarantees carried over from the first copy engine ----------

/** Every path, type, mode, mtime and content hash under a directory. */
async function snapshotTree(directory: string, skip: string[] = []): Promise<Record<string, string>> {
  const { createHash } = await import('node:crypto');
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

test('Bytes and modes are copied, .git is not, the source is untouched, and a repeat writes nothing', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const source = await skill(box.home, CLAUDE, 'rich', text('rich', 'Values stay as they are: token=abc123'));
    await mkdir(join(source, 'scripts'));
    await writeFile(join(source, 'scripts/run.sh'), '#!/bin/sh\necho hi\n');
    await chmod(join(source, 'scripts/run.sh'), 0o755);
    await writeFile(join(source, 'asset.bin'), Buffer.from([0, 1, 2, 255, 254]));
    await mkdir(join(source, 'empty'));
    await mkdir(join(source, '.git'));
    await writeFile(join(source, '.git/HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(box.home, '.claude/unrelated.json'), '{ "keep":   "these bytes" }\n');
    const beforeSource = await snapshotTree(join(box.home, '.claude'));
    const result = await applyChanges(ctx(box), [manage('rich')]);
    assert.equal(result.harnessWrites, 1);
    const copy = join(box.home, COPILOT, 'rich');
    assert.equal(await readFile(join(copy, 'SKILL.md'), 'utf8'), await readFile(join(source, 'SKILL.md'), 'utf8'));
    assert.deepEqual(await readFile(join(copy, 'asset.bin')), Buffer.from([0, 1, 2, 255, 254]));
    assert.equal((await stat(join(copy, 'scripts/run.sh'))).mode & 0o777, 0o755);
    assert.equal(await exists(join(copy, '.git')), false, 'nested .git is not copied');
    assert.equal(await exists(join(copy, 'empty')), true);
    assert.deepEqual(await snapshotTree(join(box.home, '.claude')), beforeSource, 'source and unrelated bytes unchanged');
    const beforeRepeat = await snapshotTree(box.base);
    const repeat = await applyChanges(ctx(box), []);
    assert.equal(repeat.harnessWrites, 0);
    assert.deepEqual(await snapshotTree(box.base), beforeRepeat, 'a repeat changes no byte anywhere');
  } finally { await box.cleanup(); }
});

test('A skill with an internal link is held; no link is created or followed', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const directory = await skill(box.home, CLAUDE, 'has-link');
    await writeFile(join(box.base, 'outside.txt'), 'outside');
    await symlink(join(box.base, 'outside.txt'), join(directory, 'asset'));
    assert.match((await facts(box, 'has-link')).held ?? '', /link \(asset\)/);
    const result = await applyChanges(ctx(box), [manage('has-link')]);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'has-link')), false);
  } finally { await box.cleanup(); }
});

test('A folder without SKILL.md where a copy would go is never overwritten', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'taken');
    await mkdir(join(box.home, COPILOT, 'taken'), { recursive: true });
    await writeFile(join(box.home, COPILOT, 'taken/notes.txt'), 'mine');
    assert.match((await facts(box, 'taken')).cannot['copilot-cli'] ?? '', /not a readable skill/);
    const result = await applyChanges(ctx(box), [manage('taken')]);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await readFile(join(box.home, COPILOT, 'taken/notes.txt'), 'utf8'), 'mine');
  } finally { await box.cleanup(); }
});

test('An unreadable skills folder gets nothing', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await mkdir(join(box.home, COPILOT), { recursive: true });
    await chmod(join(box.home, COPILOT), 0o000);
    const result = await applyChanges(ctx(box), [manage('solo')]);
    await chmod(join(box.home, COPILOT), 0o755);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
  } finally { await box.cleanup(); }
});

test('A stuck leftover stage does not stop later applies, and is cleared', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await mkdir(join(box.home, COPILOT), { recursive: true });
    const stuck = join(box.home, '.copilot', '.ck-stage-00000000-0000-4000-8000-000000000001');
    await mkdir(join(stuck, 'inner'), { recursive: true });
    await writeFile(join(stuck, 'inner/x'), 'x');
    await chmod(join(stuck, 'inner'), 0o555);
    await chmod(stuck, 0o555);
    assert.equal((await applyChanges(ctx(box), [manage('solo')])).harnessWrites, 1);
    assert.deepEqual(await readdir(join(box.home, '.copilot')), ['skills'], 'Central Knot clears its own leftover');
  } finally { await box.cleanup(); }
});

test('.DS_Store is no difference and is not copied', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'twin');
    const twin = await skill(box.home, COPILOT, 'twin');
    await writeFile(join(twin, '.DS_Store'), 'finder');
    const source = await skill(box.home, CLAUDE, 'solo');
    await writeFile(join(source, '.DS_Store'), 'finder');
    const view = await facts(box, 'twin');
    assert.equal(view.copies['claude-cli']!.hash, view.copies['copilot-cli']!.hash);
    await applyChanges(ctx(box), [manage('twin'), manage('solo')]);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/.DS_Store')), false);
    await writeFile(join(box.home, COPILOT, 'solo/.DS_Store'), 'finder again');
    const solo = await facts(box, 'solo');
    assert.equal(solo.copies['claude-cli']!.hash, solo.copies['copilot-cli']!.hash);
  } finally { await box.cleanup(); }
});

test('Odd valid names sync and are remembered: constructor, __proto__ and long non-Latin folders', async () => {
  const box = await sandbox();
  try {
    const long = 'あ'.repeat(60);
    const names = ['constructor', '__proto__', long, '🎉'.repeat(30)];
    for (const name of names) await skill(box.home, CLAUDE, name, text('ok-name'));
    const result = await applyChanges(ctx(box), names.map(name => manage(name)));
    assert.equal(result.harnessWrites, 4, JSON.stringify(result.results));
    for (const name of names) assert.equal(await exists(join(box.home, COPILOT, name, 'SKILL.md')), true, name);
    for (const name of names) assert.equal((await facts(box, name)).managed, true, `${name} is remembered as managed`);
    await applyChanges(ctx(box), [{ key: '__proto__', managed: false, off: [] }]);
    assert.equal((await facts(box, '__proto__')).managed, false);
    assert.equal((await facts(box, 'constructor')).managed, true);
  } finally { await box.cleanup(); }
});

test('Every stop writes nothing: damaged, missing, another generation, a newer format and another owner', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await applyChanges(ctx(box), [manage('solo')]);
    await skill(box.home, CLAUDE, 'new-one');
    const path = join(storeDirectory(box.home), 'sync.json');
    const good = await readFile(path, 'utf8');
    const record = JSON.parse(good);
    const attempt = async (bad: string | null, expected: RegExp) => {
      if (bad === null) await rm(path); else await writeFile(path, bad);
      const before = await snapshotTree(box.home);
      const result = await applyChanges(ctx(box), [manage('new-one')]);
      assert.match(result.stopped ?? '', expected);
      assert.equal(result.harnessWrites, 0);
      assert.deepEqual(await snapshotTree(box.home), before);
    };
    await attempt('{ not json', /damaged/);
    await attempt(null, /missing/);
    await attempt(JSON.stringify({ ...record, generation: 'other' }), /not the one/);
    await attempt(JSON.stringify({ ...record, formatVersion: record.formatVersion + 1 }), /newer/);
    await attempt(JSON.stringify({ ...record, owner: 'someone-else' }), /another Central Knot/);
    await writeFile(path, good);
    assert.equal((await applyChanges(ctx(box), [manage('new-one')])).harnessWrites, 1, 'restoring the record then retrying works');
  } finally { await box.cleanup(); }
});

test('Lost settings wait for an explicit resume that keeps the record', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await applyChanges(ctx(box), [manage('solo')]);
    const record = await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8');
    await rm(join(box.base, 'settings.json'));
    await skill(box.home, CLAUDE, 'new-one');
    assert.equal((await manageView(ctx(box))).gate.state, 'needs-resume');
    const blocked = await applyChanges(ctx(box), [manage('new-one')]);
    assert.match(blocked.stopped ?? '', /no memory/);
    assert.equal(blocked.harnessWrites, 0);
    const resumed = await applyChanges(ctx(box), [manage('new-one')], true);
    assert.equal(resumed.harnessWrites, 1);
    assert.equal(JSON.parse(await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8')).generation, JSON.parse(record).generation);
  } finally { await box.cleanup(); }
});

test('Write guard: the real home stays read-only however it is reached', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const realHome = join(box.base, 'real');
    await skill(realHome, CLAUDE, 'real-skill');
    await mkdir(join(realHome, '.copilot/skills'), { recursive: true });
    const attempt = async (home: string, mode: 'actual' | 'custom') => {
      const before = await snapshotTree(realHome);
      const context: ShareContext = { home, mode, read: read(home, mode), build: 'test', settingsPath: join(box.base, 'settings.json'), realHome };
      assert.equal((await manageView(context)).access.allowed, false);
      const result = await applyChanges(context, [manage('real-skill')]);
      assert.match(result.stopped ?? '', /Preview only/);
      assert.deepEqual(await snapshotTree(realHome), before);
    };
    await attempt(realHome, 'actual');
    await attempt(realHome, 'custom');
    await attempt(box.base, 'custom');
    const linked = await mkdtemp(join(box.base, 'sim-'));
    await symlink(join(realHome, '.claude'), join(linked, '.claude'));
    await attempt(linked, 'custom');
    const roots = await mkdtemp(join(box.base, 'sim-'));
    await mkdir(join(roots, '.copilot'));
    await symlink(join(realHome, '.copilot/skills'), join(roots, '.copilot/skills'));
    await attempt(roots, 'custom');
  } finally { await box.cleanup(); }
});

test('Real home: written only when allowed; a relative override stops it and an absent tool gets nothing', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const realHome = join(box.base, 'real');
    await skill(realHome, CLAUDE, 'real-skill');
    const context: ShareContext = { home: realHome, mode: 'actual', read: read(realHome, 'actual'), build: 'test', settingsPath: join(box.base, 'settings.json'), realHome, allowActualWrites: true };
    const before = await snapshotTree(realHome);
    const relative = await applyChanges({ ...context, overrides: { 'copilot-cli': 'relative-root' } }, [manage('real-skill')]);
    assert.match(relative.stopped ?? '', /COPILOT_HOME is not an absolute path/);
    assert.deepEqual(await snapshotTree(realHome), before);
    assert.deepEqual((await manageView(context)).tools, ['claude-cli'], 'Copilot is not detected in this home, so it is no column');
    const absent = await applyChanges(context, [manage('real-skill')]);
    assert.equal(absent.harnessWrites, 0);
    assert.equal(await exists(join(realHome, COPILOT)), false);
    await mkdir(join(realHome, '.copilot'));
    const written = await applyChanges(context, []);
    assert.equal(written.harnessWrites, 1, 'once Copilot is there, the managed skill catches up');
    assert.equal(await exists(join(realHome, COPILOT, 'real-skill/SKILL.md')), true);
  } finally { await box.cleanup(); }
});

test('Practice fixture: the bundled home shows each kind of skill', async () => {
  const fixture = join(import.meta.dirname, '../fixtures/home');
  const context: ShareContext = { home: fixture, mode: 'fixture', read: read(fixture, 'fixture'), build: 'test', settingsPath: join(tmpdir(), 'ck-unused-settings.json'), realHome: join(tmpdir(), 'ck-unused-home') };
  const view = await manageView(context);
  const shape = view.skills.map(item => {
    const hashes = new Set(Object.values(item.copies).map(copy => copy!.hash));
    return `${item.key}:${Object.keys(item.copies).length}${hashes.size > 1 ? ':differs' : ''}`;
  });
  assert.deepEqual(shape, ['notes:2', 'release-notes:1', 'review:2:differs', 'standup:1']);
  assert.ok(view.writes['copilot-cli']?.to.endsWith('.copilot/skills'));
});

// ---------- Break-it round 3 ----------

test('A skills folder that is a link to the shared .agents folder is never written through', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const agents = join(box.home, '.agents/skills');
    await skill(box.home, '.agents/skills', 'gamma', text('gamma', 'Shared.'));
    await symlink(agents, join(box.home, COPILOT));
    await skill(box.home, CLAUDE, 'mine');
    await skill(box.home, CLAUDE, 'gamma', text('gamma', 'Claude.'));
    const view = await manageView(ctx(box));
    assert.match(view.writes['copilot-cli']?.blocked ?? '', /link/);
    assert.match(view.skills.find(item => item.key === 'mine')!.cannot['copilot-cli'] ?? '', /link/);
    const before = await readdir(agents);
    const result = await applyChanges(ctx(box), [manage('mine'), { key: 'gamma', managed: true, off: [], use: 'claude-cli' }]);
    assert.equal(result.harnessWrites, 0, JSON.stringify(result.results));
    assert.deepEqual(await readdir(agents), before, 'nothing new in .agents');
    assert.equal(await readFile(join(agents, 'gamma/SKILL.md'), 'utf8'), text('gamma', 'Shared.'), 'the shared copy is unchanged');
  } finally { await box.cleanup(); }
});

test('Claude Code’s skills folder linked to .agents is not written through either', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const agents = join(box.home, '.agents/skills');
    await skill(box.home, '.agents/skills', 'shared', text('shared', 'Agents.'));
    await symlink(agents, join(box.home, CLAUDE));
    await skill(box.home, COPILOT, 'shared', text('shared', 'Copilot.'));
    const result = await applyChanges(ctx(box), [{ key: 'shared', managed: true, off: [], use: 'copilot-cli' }]);
    assert.equal(result.harnessWrites, 0, JSON.stringify(result.results));
    assert.equal(await readFile(join(agents, 'shared/SKILL.md'), 'utf8'), text('shared', 'Agents.'));
  } finally { await box.cleanup(); }
});

test('A copy choice survives a crash part-way and finishes at the next pass', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'pick', text('pick', 'Claude.'));
    await skill(box.home, COPILOT, 'pick', text('pick', 'Copilot.'));
    const fault = (step: string) => { if (step === 'before-replace') throw new Error('fault: crash'); };
    await assert.rejects(applyChanges(ctx(box, { fault }), [{ key: 'pick', managed: true, off: [], use: 'claude-cli' }]), /fault/);
    assert.equal(await readFile(join(box.home, COPILOT, 'pick/SKILL.md'), 'utf8'), text('pick', 'Copilot.'), 'not replaced yet');
    const next = await applyChanges(ctx(box), []);
    assert.equal(next.harnessWrites, 1, JSON.stringify(next.results));
    assert.equal(await readFile(join(box.home, COPILOT, 'pick/SKILL.md'), 'utf8'), text('pick', 'Claude.'));
    const record = JSON.parse(await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8'));
    assert.equal(record.items.pick.use, undefined, 'the finished choice leaves the record');
  } finally { await box.cleanup(); }
});

test('A recorded choice whose copy changed since is held, not applied', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'pick', text('pick', 'Claude.'));
    await skill(box.home, COPILOT, 'pick', text('pick', 'Copilot.'));
    const fault = (step: string) => { if (step === 'before-replace') throw new Error('fault: crash'); };
    await assert.rejects(applyChanges(ctx(box, { fault }), [{ key: 'pick', managed: true, off: [], use: 'claude-cli' }]), /fault/);
    await writeFile(join(box.home, CLAUDE, 'pick/SKILL.md'), text('pick', 'Claude, edited.'));
    const next = await applyChanges(ctx(box), []);
    assert.equal(next.harnessWrites, 0);
    assert.match(next.results.map(result => result.message).join(' '), /changed since/);
    assert.equal(await readFile(join(box.home, COPILOT, 'pick/SKILL.md'), 'utf8'), text('pick', 'Copilot.'));
  } finally { await box.cleanup(); }
});

test('A record with a wrongly shaped off list or copy counts as damaged', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await applyChanges(ctx(box), [manage('solo')]);
    const path = join(storeDirectory(box.home), 'sync.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    for (const bad of [
      { ...record.items.solo, off: 'claude-cli' },
      { ...record.items.solo, copies: [{ ...record.items.solo.copies[0], harness: 'nope' }] },
      { ...record.items.solo, copies: [{ ...record.items.solo.copies[0], status: 7 }] },
    ]) {
      await writeFile(path, JSON.stringify({ ...record, items: { solo: bad } }));
      assert.match((await applyChanges(ctx(box), [])).stopped ?? '', /damaged/);
    }
  } finally { await box.cleanup(); }
});

test('Another folder inside a real configuration folder stays preview-only', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const realHome = join(box.base, 'real');
    for (const name of ['.claude/skills', '.copilot', '.agents/skills']) await mkdir(join(realHome, name), { recursive: true });
    for (const inside of ['.claude', '.claude/skills', '.copilot', '.agents']) {
      const home = join(realHome, inside);
      const context: ShareContext = { home, mode: 'custom', read: read(home), build: 'test', settingsPath: join(box.base, 'settings.json'), realHome };
      assert.equal((await manageView(context)).access.allowed, false, inside);
    }
    const elsewhere = await mkdtemp(join(box.base, 'sim-'));
    assert.equal((await manageView({ ...ctx(box), home: elsewhere, read: read(elsewhere), realHome })).access.allowed, true);
  } finally { await box.cleanup(); }
});

// ---------- Break-it round 3 re-check ----------

test('A skills folder not made yet is still refused when it would land in a shared folder', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'a');
    await mkdir(join(box.home, '.agents'), { recursive: true });
    await rm(join(box.home, '.copilot'), { recursive: true });
    await symlink(join(box.home, '.agents'), join(box.home, '.copilot'));
    const view = await manageView(ctx(box));
    assert.match(view.writes['copilot-cli']?.blocked ?? '', /same folder/);
    const result = await applyChanges(ctx(box), [manage('a')]);
    assert.equal(result.harnessWrites, 0, JSON.stringify(result.results));
    assert.equal(await exists(join(box.home, '.agents/skills/a')), false);
  } finally { await box.cleanup(); }
});

test('Two tools whose skills folders would be one folder are both refused', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'a');
    const context = ctx(box, { overrides: { 'copilot-cli': join(box.home, '.claude') } });
    const view = await manageView(context);
    assert.ok(view.writes['copilot-cli']?.blocked && view.writes['claude-cli']?.blocked, JSON.stringify(view.writes));
    const result = await applyChanges(context, [manage('a')]);
    assert.equal(result.harnessWrites, 0, JSON.stringify(result.results));
  } finally { await box.cleanup(); }
});

test('A copy another tool could not load is not offered, and choosing it anyway changes nothing', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'loose', 'No frontmatter here.\n');
    await skill(box.home, COPILOT, 'loose', text('loose'));
    const view = await facts(box, 'loose');
    assert.match(view.choiceBlocks['claude-cli']?.[0]?.reason ?? '', /could not load/);
    assert.deepEqual(view.choiceBlocks['copilot-cli'], []);
    const result = await applyChanges(ctx(box), [{ key: 'loose', managed: true, off: [], use: 'claude-cli' }]);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await readFile(join(box.home, COPILOT, 'loose/SKILL.md'), 'utf8'), text('loose'), 'Copilot keeps the copy it can load');
    assert.equal((await facts(box, 'loose')).managed, false);
  } finally { await box.cleanup(); }
});

test('A choice is tied to the copy the person saw: changed or gone since means nothing changes', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'pick', text('pick', 'Claude as seen.'));
    await skill(box.home, COPILOT, 'pick', text('pick', 'Copilot.'));
    const seen = (await facts(box, 'pick')).copies['claude-cli']!.hash;
    await writeFile(join(box.home, CLAUDE, 'pick/SKILL.md'), text('pick', 'Claude edited later.'));
    const changed = await applyChanges(ctx(box), [{ key: 'pick', managed: true, off: [], use: 'claude-cli', useHash: seen }]);
    assert.equal(changed.harnessWrites, 0);
    assert.match(changed.results[0]?.message ?? '', /changed since you chose it/);
    assert.equal(await readFile(join(box.home, COPILOT, 'pick/SKILL.md'), 'utf8'), text('pick', 'Copilot.'));
    assert.equal((await facts(box, 'pick')).managed, false, 'not even Managed changes');
    await rm(join(box.home, COPILOT, 'pick'), { recursive: true });
    const gone = await applyChanges(ctx(box), [{ key: 'pick', managed: true, off: [], use: 'copilot-cli' }]);
    assert.match(gone.results[0]?.message ?? '', /is gone/);
    assert.equal((await facts(box, 'pick')).managed, false);
    assert.equal((await applyChanges(ctx(box), [])).harnessWrites, 0, 'and the next read copies nothing');
  } finally { await box.cleanup(); }
});

test('Another folder whose .central-knot links to the real one stays preview-only', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const realHome = join(box.base, 'real');
    await mkdir(join(realHome, '.central-knot'), { recursive: true });
    await symlink(join(realHome, '.central-knot'), join(box.home, '.central-knot'));
    assert.equal((await manageView(ctx(box, { realHome }))).access.allowed, false);
    await rm(join(box.home, '.central-knot'));
    await mkdir(join(realHome, '.agents'), { recursive: true });
    await symlink(join(realHome, '.agents'), join(box.home, '.agents'));
    assert.equal((await manageView(ctx(box, { realHome }))).access.allowed, false, 'a linked .agents too');
  } finally { await box.cleanup(); }
});

// ---------- Codex as a third tool ----------

const all: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const readAll = (home: string) => () => Promise.all(all.map(harness => discover({ home, mode: 'custom', harness })));

test('With Codex present, a managed skill reaches Codex’s own folder and never the shared one', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.codex/skills/.system/imagegen'), { recursive: true });
    await writeFile(join(box.home, '.codex/skills/.system/imagegen/SKILL.md'), text('imagegen'));
    await skill(box.home, CLAUDE, 'solo');
    await skill(box.home, CLAUDE, 'plain', 'No frontmatter.\n');
    const context = ctx(box, { read: readAll(box.home) });
    const view = await manageView(context);
    assert.deepEqual(view.tools, all);
    assert.ok(view.writes['codex-cli']?.to.endsWith('.codex/skills') && !view.writes['codex-cli']?.blocked);
    assert.ok(!view.skills.some(item => item.key === 'imagegen'), 'Codex’s own .system skills are not offered');
    assert.match(view.skills.find(item => item.key === 'plain')!.cannot['codex-cli'] ?? '', /Codex will not load it/);
    const result = await applyChanges(context, [manage('solo'), manage('plain')]);
    assert.equal(await readFile(join(box.home, '.codex/skills/solo/SKILL.md'), 'utf8'), text('solo'));
    assert.equal(await exists(join(box.home, '.codex/skills/plain')), false);
    assert.equal(await exists(join(box.home, '.agents')), false, 'nothing goes to the shared folder');
    assert.equal(result.results.filter(entry => entry.outcome === 'written').length, 2, JSON.stringify(result.results));
    assert.ok(await exists(join(box.home, '.codex/skills/.system/imagegen/SKILL.md')), 'its .system folder is untouched');
  } finally { await box.cleanup(); }
});

test('A skill in the shared .agents folder counts for both Copilot and Codex and is never written', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.codex'), { recursive: true });
    await skill(box.home, '.agents/skills', 'both', text('both', 'Shared.'));
    await skill(box.home, CLAUDE, 'both', text('both', 'Claude.'));
    const context = ctx(box, { read: readAll(box.home) });
    const facts3 = (await manageView(context)).skills.find(item => item.key === 'both')!;
    assert.ok(facts3.copies['copilot-cli'] && facts3.copies['codex-cli']);
    assert.deepEqual(facts3.choiceBlocks['claude-cli']?.map(block => block.tool).sort(), ['codex-cli', 'copilot-cli']);
    const result = await applyChanges(context, [{ key: 'both', managed: true, off: [], use: 'claude-cli' }]);
    assert.equal(result.harnessWrites, 0);
    assert.equal(await readFile(join(box.home, '.agents/skills/both/SKILL.md'), 'utf8'), text('both', 'Shared.'));
  } finally { await box.cleanup(); }
});
