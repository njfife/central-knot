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
    assert.ok(result.results.some(entry => /folder other tools share/.test(entry.message)), JSON.stringify(result.results));
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
