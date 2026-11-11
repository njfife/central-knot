import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyChanges, manageView } from '../src/manage.ts';
import { gateRefusal, readRecord, saveRecord, storeDirectory, syncGate, takeOverSync, writeAccess, type ShareContext } from '../src/share.ts';
import type { HarnessId, HistoryDays, Snapshot } from '../src/types.ts';
import { DAY_MS } from '../src/model.ts';
import { harnesses } from '../src/harnesses.ts';

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

test('The view reports each tool’s copy; neither it nor a catch-up pass with nothing managed writes anything', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'only-claude');
    await skill(box.home, CLAUDE, 'twin'); await skill(box.home, COPILOT, 'twin');
    await skill(box.home, CLAUDE, 'plain', 'No frontmatter.\n');
    await skill(box.home, COPILOT, 'cafe', text('café'));
    const view = await manageView(ctx(box));
    assert.deepEqual(view.tools, both);
    const only = view.skills.find(item => item.key === 'only-claude')!;
    assert.ok(only.copies['claude-cli'] && !only.copies['copilot-cli']);
    assert.equal(only.managed, false);
    assert.equal(only.copies['claude-cli']!.summary, 'Body.');
    const twin = view.skills.find(item => item.key === 'twin')!;
    assert.equal(twin.copies['claude-cli']!.hash, twin.copies['copilot-cli']!.hash);
    assert.match(view.skills.find(item => item.key === 'plain')!.cannot['copilot-cli']!, /frontmatter/);
    assert.match(view.skills.find(item => item.key === 'cafe')!.cannot['copilot-cli'] ?? '', /will not load/, 'a copy its own tool refuses counts as none');
    assert.equal((await applyChanges(ctx(box), [])).harnessWrites, 0);
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

test('Catch-up: a tool newly turned on gets its copy; a deleted copy is a deletion, not something to bring back', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'kept');
    await skill(box.home, CLAUDE, 'dropped');
    await skill(box.home, CLAUDE, 'solo');
    await applyChanges(ctx(box), [manage('kept', ['copilot-cli']), manage('dropped'), manage('solo', ['claude-cli'])]);
    assert.equal(await exists(join(box.home, COPILOT, 'kept')), false, 'off for Copilot');
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false, 'a skill whose only copy is in a tool turned off is left alone');
    assert.deepEqual((await facts(box, 'kept')).off, ['copilot-cli']);
    await applyChanges(ctx(box), [manage('kept')]);
    assert.equal(await exists(join(box.home, COPILOT, 'kept/SKILL.md')), true, 'turning Copilot on catches up');
    await rm(join(box.home, COPILOT, 'dropped'), { recursive: true });
    await applyChanges(ctx(box, { settleMs: 0 }), []);
    assert.equal(await exists(join(box.home, COPILOT, 'dropped')), false, 'not brought back');
    assert.equal(await exists(join(box.home, CLAUDE, 'dropped')), false, 'and the deletion spread');
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

test('An interrupted copy leaves nothing half-written, and the next pass completes it', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    const fault = (step: string) => { if (step === 'before-rename') throw new Error('fault: crash'); };
    await assert.rejects(applyChanges(ctx(box, { fault }), [manage('solo')]), /fault/);
    assert.equal(await exists(join(box.home, COPILOT, 'solo')), false);
    await mkdir(join(box.home, '.copilot', '.ck-stage-00000000-0000-4000-8000-000000000001', 'inner'), { recursive: true });
    const next = await applyChanges(ctx(box), []);
    assert.equal(next.harnessWrites, 1);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
    assert.deepEqual(await readdir(join(box.home, '.copilot')), ['skills'], 'a leftover from a killed copy is cleared');
  } finally { await box.cleanup(); }
});

test('A different copy Copilot reads in the shared .agents folder is shown, never written unless the person asks for it to be taken over, and counts as a copy that differs', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'dup', text('dup', 'A'));
    await skill(box.home, COPILOT, 'dup', text('dup', 'A'));
    const shared = await skill(box.home, '.agents/skills', 'dup', text('dup', 'B'));
    const view = await facts(box, 'dup');
    assert.equal(view.extra.length, 1);
    assert.equal(view.extra[0].writable, false);
    assert.equal(view.extra[0].outside?.kind, 'shared');
    const result = await applyChanges(ctx(box), [{ ...manage('dup'), use: 'claude-cli' }]);
    assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), text('dup', 'B'), 'without a take-over the shared folder is never changed');
    assert.ok(result.results.some(entry => /\.agents\/skills\/dup\. Central Knot changes it only when you ask/.test(entry.message)), JSON.stringify(result.results));
    assert.equal(result.harnessWrites, 0);
    assert.equal((await facts(box, 'dup')).managed, false, 'a choice that cannot be carried out changes nothing, not even Managed');
    const differ = await applyChanges(ctx(box), [manage('dup')]);
    assert.ok(differ.harnessWrites === 0 && /Copies differ/.test(differ.results[0].message), JSON.stringify(differ.results));
    assert.deepEqual(view.choiceBlocks['claude-cli'], [], 'the page may offer the choice: it sends a take-over with it');
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
    await attempt(JSON.stringify({ ...record, owner: 'someone-else' }), /Another Central Knot build \(someone-else\) syncs this home, so nothing was written or deleted\. Take over syncing/);
    await attempt(JSON.stringify({ ...record, items: { solo: { ...record.items.solo, off: 'claude-cli' } } }), /damaged/);
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
    for (const inside of ['.claude', '.copilot/skills']) await attempt(join(realHome, inside), 'custom');
    for (const name of ['.central-knot', '.agents']) {
      const linkedRoot = await mkdtemp(join(box.base, 'sim-'));
      await mkdir(join(realHome, name), { recursive: true });
      await symlink(join(realHome, name), join(linkedRoot, name));
      await attempt(linkedRoot, 'custom');
    }
  } finally { await box.cleanup(); }
});

test('Write guard: every tool folder, the Claude Code MCP file and the files the app writes count as the real configuration', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const realHome = join(box.base, 'real');
    for (const folder of ['.claude', '.copilot', '.codex/agents', '.pi/agent', 'elsewhere']) await mkdir(join(realHome, folder), { recursive: true });
    await writeFile(join(realHome, '.claude.json'), '{}\n');
    await writeFile(join(realHome, '.claude/CLAUDE.md'), 'Real.\n');
    const allowed = async (links: [string, string][]) => {
      const home = await mkdtemp(join(box.base, 'sim-'));
      for (const [path, target] of links) { await mkdir(join(home, path, '..'), { recursive: true }); await symlink(target, join(home, path)); }
      return (await writeAccess({ home, mode: 'custom', read: read(home), build: 'test', settingsPath: join(box.base, 'settings.json'), realHome })).allowed;
    };
    assert.equal(await allowed([['.codex', join(realHome, '.codex')]]), false);
    assert.equal(await allowed([['.pi', join(realHome, '.pi')]]), false);
    assert.equal(await allowed([['.claude.json', join(realHome, '.claude.json')]]), false);
    assert.equal(await allowed([['.codex/AGENTS.md', join(realHome, '.claude/CLAUDE.md')]]), false);
    assert.equal(await allowed([['.codex/agents', join(realHome, '.codex/agents')]]), false);
    assert.equal(await allowed([['.codex', join(realHome, 'elsewhere')]]), true);
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

test('A copy choice survives a crash part-way and finishes at the next pass', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'pick', text('pick', 'Claude.'));
    await skill(box.home, COPILOT, 'pick', text('pick', 'Copilot.'));
    await skill(box.home, CLAUDE, 'held', text('held', 'Claude.'));
    await skill(box.home, COPILOT, 'held', text('held', 'Copilot.'));
    const fault = (step: string) => { if (step === 'before-replace') throw new Error('fault: crash'); };
    await assert.rejects(applyChanges(ctx(box, { fault }), ['pick', 'held'].map(key => ({ key, managed: true, off: [], use: 'claude-cli' as const }))), /fault/);
    assert.equal(await readFile(join(box.home, COPILOT, 'pick/SKILL.md'), 'utf8'), text('pick', 'Copilot.'), 'not replaced yet');
    await writeFile(join(box.home, CLAUDE, 'held/SKILL.md'), text('held', 'Claude, edited.'));
    const next = await applyChanges(ctx(box), []);
    assert.equal(next.harnessWrites, 1, JSON.stringify(next.results));
    assert.match(next.results.map(result => result.message).join(' '), /changed since/, 'a recorded choice whose copy changed since is held');
    assert.equal(await readFile(join(box.home, COPILOT, 'held/SKILL.md'), 'utf8'), text('held', 'Copilot.'));
    assert.equal(await readFile(join(box.home, COPILOT, 'pick/SKILL.md'), 'utf8'), text('pick', 'Claude.'));
    const record = JSON.parse(await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8'));
    assert.equal(record.items.pick.use, undefined, 'the finished choice leaves the record');
    const chosen = (await readHistory(ctx(box))).find(event => event.kind === 'chosen' && event.key === 'pick');
    assert.equal(chosen?.wasSynced, undefined, 'the crashed pass was the one turning it on: its Undo leaves it not synced');
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
    const overlap = (await manageView(ctx(box, { overrides: { 'copilot-cli': join(box.home, '.claude') } }))).writes;
    assert.ok(overlap['copilot-cli']?.blocked && overlap['claude-cli']?.blocked, 'two tools sharing one folder are both refused');
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

// ---------- Codex as a third tool ----------

const all: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const readAll = (home: string) => () => Promise.all(all.map(harness => discover({ home, mode: 'custom', harness })));

test('With Codex present, a managed skill reaches Codex’s own folder and never the shared one', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.codex'));
    await skill(box.home, CLAUDE, 'solo');
    await skill(box.home, CLAUDE, 'plain', 'No frontmatter.\n');
    const context = ctx(box, { read: readAll(box.home) });
    const view = await manageView(context);
    assert.deepEqual(view.tools, all);
    assert.ok(view.writes['codex-cli']?.to.endsWith('.codex/skills') && !view.writes['codex-cli']?.blocked);
    assert.match(view.skills.find(item => item.key === 'plain')!.cannot['codex-cli'] ?? '', /Codex will not load it/);
    const result = await applyChanges(context, [manage('solo'), manage('plain')]);
    assert.equal(await readFile(join(box.home, '.codex/skills/solo/SKILL.md'), 'utf8'), text('solo'));
    assert.equal(await exists(join(box.home, '.codex/skills/plain')), false);
    assert.equal(await exists(join(box.home, '.agents')), false, 'nothing goes to the shared folder');
    assert.equal(result.results.filter(entry => entry.outcome === 'written').length, 2, JSON.stringify(result.results));
  } finally { await box.cleanup(); }
});

test('A skill in the shared .agents folder counts as a copy for both Copilot and Codex', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.codex'), { recursive: true });
    await skill(box.home, '.agents/skills', 'both', text('both', 'Shared.'));
    await skill(box.home, CLAUDE, 'both', text('both', 'Claude.'));
    const context = ctx(box, { read: readAll(box.home) });
    const facts3 = (await manageView(context)).skills.find(item => item.key === 'both')!;
    assert.ok(facts3.copies['copilot-cli'] && facts3.copies['codex-cli']);
    assert.equal(facts3.copies['codex-cli']!.outside?.kind, 'shared');
    assert.deepEqual(facts3.choiceBlocks['claude-cli'], [], 'the shared copy is taken over with the choice, so it blocks nothing');
  } finally { await box.cleanup(); }
});

// ---------- Two-way sync (8b) ----------

import { appendHistory, deleteEverywhere, pruneHistory, readHistory, restoreFromHistory } from '../src/manage.ts';
import { inverseChanges, offPlan, stillOn } from '../src/clickplan.ts';

const fast = (box: Box, extra: Partial<ShareContext> = {}) => ctx(box, { settleMs: 0, ...extra });
async function managedPair(box: Box, name = 'pair', body = 'Original.') {
  await skill(box.home, CLAUDE, name, text(name, body));
  await applyChanges(fast(box), [manage(name)]);
  assert.equal(await readFile(join(box.home, COPILOT, name, 'SKILL.md'), 'utf8'), text(name, body));
}

test('An edit in one tool spreads to the others, and the old copy is kept in History', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edited in Claude.'));
    const result = await applyChanges(fast(box), []);
    assert.equal(await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), text('pair', 'Edited in Claude.'));
    assert.deepEqual(result.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['edit', 'claude-cli', ['copilot-cli']]]);
    // Managing it first told the copy Apply all added; the edit is the event after.
    const event = (await readHistory(ctx(box))).find(entry => entry.kind !== 'added')!;
    assert.equal(event.kind, 'edit');
    assert.ok(event.previous && await exists(join(storeDirectory(box.home), 'items/pair', event.previous)), 'the old version is in the store');
    const before = await readFile(join(storeDirectory(box.home), 'history.json'), 'utf8');
    assert.equal((await applyChanges(fast(box), [])).harnessWrites, 0);
    assert.equal(await readFile(join(storeDirectory(box.home), 'history.json'), 'utf8'), before, 'a quiet pass adds nothing to History');
    assert.equal((await facts(box, 'pair')).copies['copilot-cli']!.hash, (await facts(box, 'pair')).copies['claude-cli']!.hash);
  } finally { await box.cleanup(); }
});

test('Apply all that spreads an edit and adds a new copy marks only the spread as a replacement', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edited in Claude.'));
    await skill(box.home, CLAUDE, 'fresh');
    const result = await applyChanges(fast(box), [manage('fresh')]);
    assert.deepEqual(result.results.filter(entry => entry.outcome === 'written').map(entry => [entry.item, entry.harness, entry.replaced]).sort(),
      [['fresh', 'copilot-cli', undefined], ['pair', 'copilot-cli', true]]);
  } finally { await box.cleanup(); }
});

test('Competing edits with unknown order: the fixed tool order decides, says so, and Undo applies the losing side', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Claude edit.'));
    await writeFile(join(box.home, COPILOT, 'pair/SKILL.md'), text('pair', 'Copilot edit.'));
    const result = await applyChanges(fast(box), []);
    assert.deepEqual(result.notices?.map(notice => [notice.kind, notice.winner, notice.orderProved]), [['conflict', 'copilot-cli', false]]);
    assert.equal(await readFile(join(box.home, CLAUDE, 'pair/SKILL.md'), 'utf8'), text('pair', 'Copilot edit.'));
    const undo = await restoreFromHistory(fast(box), result.notices![0].history);
    assert.equal(undo.stopped, undefined);
    for (const root of [CLAUDE, COPILOT]) assert.equal(await readFile(join(box.home, root, 'pair/SKILL.md'), 'utf8'), text('pair', 'Claude edit.'), `${root} has the losing side back`);
    assert.equal((await applyChanges(fast(box), [])).harnessWrites, 0, 'and it is the new baseline');
  } finally { await box.cleanup(); }
});

test('A deletion spreads, is never undone by catch-up, and Restore brings it back everywhere', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await rm(join(box.home, CLAUDE, 'pair'), { recursive: true });
    const result = await applyChanges(fast(box), []);
    assert.deepEqual(result.notices?.map(notice => [notice.kind, notice.winner]), [['deleted', 'claude-cli']]);
    assert.equal(await exists(join(box.home, COPILOT, 'pair')), false);
    assert.equal((await applyChanges(fast(box), [])).harnessWrites, 0, 'nothing comes back');
    const restored = await restoreFromHistory(fast(box), result.notices![0].history);
    assert.equal(restored.stopped, undefined, JSON.stringify(restored));
    for (const root of [CLAUDE, COPILOT]) assert.equal(await readFile(join(box.home, root, 'pair/SKILL.md'), 'utf8'), text('pair', 'Original.'));
    assert.equal((await facts(box, 'pair')).managed, true);
  } finally { await box.cleanup(); }
});

test('An edit racing a deletion with unknown order is kept, the deleted copy returns, and Delete everywhere removes it all', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await rm(join(box.home, CLAUDE, 'pair'), { recursive: true });
    await writeFile(join(box.home, COPILOT, 'pair/SKILL.md'), text('pair', 'Copilot kept editing.'));
    const result = await applyChanges(fast(box), []);
    assert.deepEqual(result.notices?.map(notice => [notice.kind, notice.winner, notice.orderProved]), [['kept-edit', 'copilot-cli', false]]);
    assert.equal(await readFile(join(box.home, CLAUDE, 'pair/SKILL.md'), 'utf8'), text('pair', 'Copilot kept editing.'));
    const removed = await deleteEverywhere(fast(box), 'pair');
    assert.equal(removed.harnessWrites, 2, JSON.stringify(removed));
    assert.equal(await exists(join(box.home, CLAUDE, 'pair')) || await exists(join(box.home, COPILOT, 'pair')), false);
    assert.equal((await applyChanges(fast(box), [])).harnessWrites, 0, 'and it stays gone');
  } finally { await box.cleanup(); }
});

test('Syncing to a tool again writes its copy as one Undo takes back: the copy goes, the tool is left out again, and it stays synced', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'pair', text('pair'));
    await applyChanges(fast(box), [manage('pair', ['copilot-cli'])]);
    await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true }]);
    assert.equal(await exists(join(box.home, COPILOT, 'pair/SKILL.md')), true);
    const added = (await readHistory(ctx(box))).findLast(entry => entry.kind === 'added')!;
    assert.deepEqual([added.rejoined, added.losers.map(loser => loser.tool)], [true, ['copilot-cli']]);
    assert.equal((await restoreFromHistory(fast(box), added.id)).stopped, undefined);
    assert.equal(await exists(join(box.home, COPILOT, 'pair')), false);
    const after = await facts(box, 'pair');
    assert.deepEqual([after.managed, after.off], [true, ['copilot-cli']]);
    assert.equal((await applyChanges(fast(box), [])).harnessWrites, 0, 'and the next pass leaves Copilot CLI out');
  } finally { await box.cleanup(); }
});

test('A click is told only the History entries it made: an edit sync spread in the same pass is not one, so its Undo leaves the edit', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edited in Claude.'));
    const off = await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, disable: ['copilot-cli'] }]);
    const history = await readHistory(ctx(box));
    const edit = history.find(event => event.kind === 'edit')!;
    assert.deepEqual([off.made?.map(id => history.find(event => event.id === id)?.kind), off.made?.includes(edit.id)], [['switched'], false]);
    for (const id of off.made!) assert.equal((await restoreFromHistory(fast(box), id)).stopped, undefined);
    for (const root of [CLAUDE, COPILOT]) assert.equal(await readFile(join(box.home, root, 'pair/SKILL.md'), 'utf8'), text('pair', 'Edited in Claude.'), `${root} keeps the edit`);
    assert.deepEqual((await facts(box, 'pair')).disabled ?? [], []);
  } finally { await box.cleanup(); }
});

test('A click that changes only the record (copies already the same everywhere) makes no History entry; the change that puts the record back undoes it', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'pair', text('pair'));
    await skill(box.home, COPILOT, 'pair', text('pair'));
    const on = await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: false }]);
    assert.deepEqual([on.made, on.harnessWrites, (await facts(box, 'pair')).managed], [[], 0, true]);
    const back = inverseChanges(['pair'], new Map([['pair', { managed: false, off: [] }]]), new Map([['pair', { managed: true, off: [] }]]));
    const undone = await applyChanges(fast(box), back);
    assert.deepEqual([undone.harnessWrites, (await facts(box, 'pair')).managed, (await readHistory(ctx(box))).length], [0, false, 0]);
  } finally { await box.cleanup(); }
});

test('Off with a broken switch file turns it off in every other tool and leaves that one on, saying why', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, '.copilot/settings.json'), '{ not json');
    const pair = await facts(box, 'pair');
    const plan = offPlan(pair, both, 'skills', true);
    assert.deepEqual(plan, { disable: ['claude-cli'], held: ['copilot-cli'], remove: [], stays: [] });
    assert.match(stillOn(pair, plan.held, tool => tool, problem => problem.reason) ?? '', /^Still on in copilot-cli: \S/);
    const off = await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, disable: plan.disable as HarnessId[] }]);
    assert.deepEqual(off.results.filter(entry => entry.outcome === 'switched').map(entry => entry.harness), ['claude-cli']);
    assert.deepEqual((await facts(box, 'pair')).disabled, ['claude-cli']);
    assert.equal(await readFile(join(box.home, '.copilot/settings.json'), 'utf8'), '{ not json', 'the broken file is left as it is');
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice on a synced skill puts it back as before the choice: the tool’s own copy waits for a choice again, on every pass and on Sync here', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await applyChanges(fast(box), [{ ...manage('pair', ['copilot-cli']), seenManaged: true }]);
    await writeFile(join(box.home, COPILOT, 'pair/SKILL.md'), text('pair', 'Copilot’s own.'));
    // Synced to Copilot CLI again (Sync here): its own copy differs, so it waits for a choice.
    const differs = (result: { results: { outcome: string; differs?: true }[] }) => result.results.some(entry => entry.outcome === 'held' && entry.differs);
    const rejoin = await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true }]);
    assert.ok(differs(rejoin), JSON.stringify(rejoin.results));
    const chose = await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, use: 'claude-cli', useHash: (await facts(box, 'pair')).copies['claude-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.equal(chosen.wasSynced, true);
    assert.equal(await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), text('pair', 'Original.'));
    const undone = await restoreFromHistory(fast(box), chosen.id, false, { narrow: true });
    assert.deepEqual(undone.results.map(entry => [entry.harness, entry.outcome, entry.message]), [['copilot-cli', 'written', `Its own copy is back. ${harnesses['copilot-cli'].nextStep}`]]);
    const after = await facts(box, 'pair');
    assert.deepEqual([await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), after.managed, after.off], [text('pair', 'Copilot’s own.'), true, []]);
    // As before the choice, on every pass: its copy (in the store now, the choice kept it) is never caught up over.
    for (const pass of [1, 2]) {
      const next = await applyChanges(fast(box), []);
      assert.deepEqual([next.harnessWrites, differs(next)], [0, true], `pass ${pass}`);
    }
    // The Sync here click's own Undo leaves it out again; Sync here then asks again.
    await applyChanges(fast(box), inverseChanges(['pair'], new Map([['pair', { managed: true, off: ['copilot-cli'] }]]), new Map([['pair', { managed: true, off: [] }]])));
    const again = await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true }]);
    assert.deepEqual([again.harnessWrites, differs(again), await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8')], [0, true, text('pair', 'Copilot’s own.')]);
    // Chosen this time: the choice goes through and the record lets the note go.
    await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, use: 'copilot-cli', useHash: (await facts(box, 'pair')).copies['copilot-cli']!.hash }]);
    assert.equal(await readFile(join(box.home, CLAUDE, 'pair/SKILL.md'), 'utf8'), text('pair', 'Copilot’s own.'));
    assert.equal((await readRecord(box.home)).record?.items.pair.keptOwn, undefined);
  } finally { await box.cleanup(); }
});

test('Removed from one tool and then the other: the Off row puts back both removals, the latest first', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, remove: ['copilot-cli'] }]);
    await applyChanges(fast(box), [{ ...manage('pair', ['copilot-cli']), seenManaged: true, remove: ['claude-cli'] }]);
    const removals = (await readHistory(ctx(box))).filter(event => event.kind === 'removed');
    const [gone] = (await manageView(ctx(box))).gone ?? [];
    assert.deepEqual([gone?.gone?.history, gone?.gone?.also], [removals[1].id, [removals[0].id]]);
    for (const id of [gone!.gone!.history, ...gone!.gone!.also!]) assert.equal((await restoreFromHistory(fast(box), id)).stopped, undefined);
    assert.deepEqual([await readFile(join(box.home, CLAUDE, 'pair/SKILL.md'), 'utf8'), await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8')], [text('pair', 'Original.'), text('pair', 'Original.')]);
    const back = await facts(box, 'pair');
    assert.deepEqual([back.managed, back.off, (await manageView(ctx(box))).gone], [true, [], []]);
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice on a skill that was synced once, and isn’t now, leaves it not synced: the choice says whether it was', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    // Not synced any more (a record-only change, as an Undo of On sends).
    await applyChanges(fast(box), [{ key: 'pair', managed: false, off: [], seenManaged: true }]);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edited in Claude.'));
    const chose = await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: false, use: 'claude-cli', useHash: (await facts(box, 'pair')).copies['claude-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.equal(chosen.wasSynced, undefined);
    assert.equal((await restoreFromHistory(fast(box), chosen.id, false, { narrow: true })).stopped, undefined);
    const after = await facts(box, 'pair');
    assert.deepEqual([after.managed, await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8')], [false, text('pair', 'Original.')]);
  } finally { await box.cleanup(); }
});

test('A skill whose last copies were removed stays on offer, off, while History keeps the removal; a deleted one leaves no row', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, remove: ['claude-cli', 'copilot-cli'] }]);
    const gone = (await manageView(ctx(box))).gone ?? [];
    assert.deepEqual(gone.map(item => [item.key, item.name, item.managed, Object.keys(item.copies).length, item.gone?.turnedOff]), [['pair', 'pair', false, 0, undefined]]);
    assert.equal((await restoreFromHistory(fast(box), gone[0].gone!.history)).stopped, undefined);
    assert.equal(await exists(join(box.home, COPILOT, 'pair/SKILL.md')), true);
    assert.deepEqual((await manageView(ctx(box))).gone, []);
    // Delete everywhere is a deletion: History keeps it, and the page has no row for it.
    await deleteEverywhere(fast(box), 'pair');
    assert.deepEqual((await manageView(ctx(box))).gone, []);
    // A removal by hand lasts History's days: once History lets it go, the skill goes from the list too.
    await restoreFromHistory(fast(box), (await readHistory(ctx(box))).findLast(event => event.kind === 'deleted')!.id);
    await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, remove: ['claude-cli', 'copilot-cli'] }]);
    assert.equal(((await manageView(ctx(box))).gone ?? []).length, 1);
    assert.deepEqual((await manageView(fast(box, { now: () => Date.now() + 400 * DAY_MS }))).gone, []);
    // One that turned it off (a tool with no switch) stands whatever its age, until it is turned on again or deleted.
    await restoreFromHistory(fast(box), (await readHistory(ctx(box))).findLast(event => event.kind === 'removed')!.id);
    await applyChanges(fast(box), [{ ...manage('pair'), seenManaged: true, remove: ['claude-cli', 'copilot-cli'], turnOff: true }]);
    const later = fast(box, { now: () => Date.now() + 400 * DAY_MS });
    assert.deepEqual(((await manageView(later)).gone ?? []).map(item => [item.key, item.gone?.turnedOff, item.heldOff?.map(entry => entry.tool)]), [['pair', true, ['claude-cli', 'copilot-cli']]]);
  } finally { await box.cleanup(); }
});

test('A copy removed while its tool was off is caught up when the tool is turned back on, never spread as a deletion', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await applyChanges(fast(box), [manage('pair', ['copilot-cli'])]);
    await rm(join(box.home, COPILOT, 'pair'), { recursive: true });
    await applyChanges(fast(box), [manage('pair')]);
    assert.equal(await exists(join(box.home, COPILOT, 'pair/SKILL.md')), true, 'caught up');
    assert.equal(await exists(join(box.home, CLAUDE, 'pair/SKILL.md')), true, 'not deleted');
    await applyChanges(fast(box), [{ key: 'pair', managed: false, off: [] }]);
    await rm(join(box.home, COPILOT, 'pair'), { recursive: true });
    await applyChanges(fast(box), [manage('pair')]);
    assert.equal(await exists(join(box.home, CLAUDE, 'pair/SKILL.md')), true, 'a copy removed while unmanaged is no deletion either');
  } finally { await box.cleanup(); }
});

// ---------- Sync off: observing, proved order, scoped Apply all (SYN-03, CON-04) ----------

test('Sync off: a pass only observes, the page shows the edit as pending, and turning Sync on spreads it', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edited while off.'));
    const observed = await applyChanges(fast(box), [], false, { observeOnly: true });
    assert.equal(observed.harnessWrites, 0);
    assert.equal(await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), text('pair', 'Original.'));
    assert.deepEqual((await facts(box, 'pair')).edited, ['claude-cli']);
    await applyChanges(fast(box), []);
    assert.equal(await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), text('pair', 'Edited while off.'));
    assert.equal((await facts(box, 'pair')).edited, undefined);
  } finally { await box.cleanup(); }
});

test('Proved order beats the tie-break: an edit seen while the other copy was still unchanged is the older one', async () => {
  const box = await sandbox();
  try {
    let now = 1000;
    const timed = (extra: Partial<ShareContext> = {}) => fast(box, { now: () => now, ...extra });
    await managedPair(box);
    // Copilot edits first and is seen at t=2000 while Claude is still at the baseline; Claude edits later.
    await writeFile(join(box.home, COPILOT, 'pair/SKILL.md'), text('pair', 'Copilot, earlier.'));
    now = 2000; await applyChanges(timed(), [], false, { observeOnly: true });
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Claude, later.'));
    now = 3000; const result = await applyChanges(timed(), []);
    assert.deepEqual(result.notices?.map(notice => [notice.kind, notice.winner, notice.orderProved]), [['conflict', 'claude-cli', true]], 'the tie-break alone would have picked Copilot');
    assert.equal(await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), text('pair', 'Claude, later.'));
  } finally { await box.cleanup(); }
});

test('With Sync off, Apply all writes only the skills it shows', async () => {
  const box = await sandbox();
  try {
    await managedPair(box, 'old');
    await writeFile(join(box.home, CLAUDE, 'old/SKILL.md'), text('old', 'Pending edit.'));
    await skill(box.home, CLAUDE, 'fresh');
    const result = await applyChanges(fast(box), [manage('fresh')], false, { only: new Set(['fresh']) });
    assert.equal(await exists(join(box.home, COPILOT, 'fresh/SKILL.md')), true, 'what Apply all shows is written');
    assert.equal(await readFile(join(box.home, COPILOT, 'old/SKILL.md'), 'utf8'), text('old', 'Original.'), 'the pending edit waits for Sync');
    assert.equal(result.notices?.length ?? 0, 0);
  } finally { await box.cleanup(); }
});

// ---------- Two-way break-it round (13 findings) ----------

const CODEX = '.codex/skills';
const readAll3 = (home: string) => () => Promise.all((['claude-cli', 'copilot-cli', 'codex-cli'] as HarnessId[]).map(harness => discover({ home, mode: 'custom', harness })));
const three = (box: Box, extra: Partial<ShareContext> = {}) => fast(box, { read: readAll3(box.home), ...extra });
async function managedThree(box: Box, name = 'foo') {
  await mkdir(join(box.home, '.codex'), { recursive: true });
  await skill(box.home, CLAUDE, name, text(name, 'Original.'));
  await applyChanges(three(box), [manage(name.toLowerCase())]);
  for (const root of [COPILOT, CODEX]) assert.equal(await exists(join(box.home, root, name, 'SKILL.md')), true);
}

test('Undo of a copy choice takes out only the copies its own pass added: not those a later click added', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    // Codex's copy removed (left out of sync); Copilot CLI's left out, edited, and synced again: its copy differs.
    await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true, remove: ['codex-cli'] }]);
    await applyChanges(three(box), [{ ...manage('foo', ['codex-cli', 'copilot-cli']), seenManaged: true }]);
    await writeFile(join(box.home, COPILOT, 'foo/SKILL.md'), text('foo', 'Copilot’s own.'));
    await applyChanges(three(box), [{ ...manage('foo', ['codex-cli']), seenManaged: true }]);
    // The choice adds nothing (Codex is left out); then Sync here gives Codex a copy again, a moment later.
    const chose = await applyChanges(three(box), [{ ...manage('foo', ['codex-cli']), seenManaged: true, use: 'claude-cli', useHash: (await facts(box, 'foo')).copies['claude-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.equal(chosen.addedId, undefined, 'its pass added no copy');
    await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true }]);
    assert.equal(await exists(join(box.home, CODEX, 'foo/SKILL.md')), true);
    assert.equal((await restoreFromHistory(three(box), chosen.id, false, { narrow: true })).stopped, undefined);
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'Copilot’s own.'), 'the replaced copy is back');
    assert.equal(await exists(join(box.home, CODEX, 'foo/SKILL.md')), true, 'the copy Sync here added stays');
  } finally { await box.cleanup(); }
});

test('Undo of a choice that took two left-out tools back in leaves both out again with their own copies, and catches neither up', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await applyChanges(three(box), [{ ...manage('foo', ['codex-cli', 'copilot-cli']), seenManaged: true }]);
    await writeFile(join(box.home, COPILOT, 'foo/SKILL.md'), text('foo', 'Copilot’s own.'));
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex’s own.'));
    // Sync here on Codex waits for a choice; the choice turns it on everywhere, taking Copilot CLI in too.
    await applyChanges(three(box), [{ ...manage('foo', ['copilot-cli']), seenManaged: true }]);
    const before = new Map([['foo', { managed: true, off: ['copilot-cli'] }]]);
    const chose = await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true, use: 'claude-cli', useHash: (await facts(box, 'foo')).copies['claude-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.deepEqual(chosen.losers.map(loser => loser.tool).sort(), ['codex-cli', 'copilot-cli']);
    // The click's Undo: the choice in its own tools, then the record as before the click.
    assert.equal((await restoreFromHistory(three(box), chosen.id, false, { narrow: true })).stopped, undefined);
    const view = (await manageView(three(box))).skills.find(item => item.key === 'foo')!;
    const back = await applyChanges(three(box), inverseChanges(['foo'], before, new Map([['foo', { managed: view.managed, off: view.off }]])));
    assert.equal(back.harnessWrites, 0, JSON.stringify(back.results));
    assert.ok(back.results.some(entry => entry.item === 'foo' && entry.differs), 'Codex waits for a choice, as before the click');
    assert.deepEqual([await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8')], [text('foo', 'Copilot’s own.'), text('foo', 'Codex’s own.')]);
    assert.deepEqual((await facts(box, 'foo')).off, ['copilot-cli']);
    assert.equal((await applyChanges(three(box), [])).harnessWrites, 0);
  } finally { await box.cleanup(); }
});

test('Undo of choosing a left-out tool’s own copy puts the synced copies back on record as synced: an edit after it is one edit, not a conflict', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await applyChanges(three(box), [{ ...manage('foo', ['codex-cli']), seenManaged: true }]);
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex’s own.'));
    await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true }]);
    const chose = await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true, use: 'codex-cli', useHash: (await manageView(three(box))).skills.find(item => item.key === 'foo')!.copies['codex-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.equal((await restoreFromHistory(three(box), chosen.id, false, { narrow: true })).stopped, undefined);
    assert.equal(await readFile(join(box.home, CLAUDE, 'foo/SKILL.md'), 'utf8'), text('foo', 'Original.'));
    // Codex's own copy, the one that was chosen, waits for a choice again: no pass catches it up, even after it is edited and the edit taken back.
    const waits = async (when: string) => {
      const pass = await applyChanges(three(box), []);
      assert.deepEqual([pass.harnessWrites, pass.results.some(entry => entry.outcome === 'held' && entry.differs), await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8')], [0, true, text('foo', 'Codex’s own.')], when);
    };
    await waits('after the Undo');
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex’s own, edited.'));
    await applyChanges(three(box), []);
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex’s own.'));
    await waits('after an edit there was taken back');
    // An edit in Claude Code, then Codex out again, as before Sync here: the edit reaches Copilot CLI as an edit.
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Edited in Claude.'));
    const edit = await applyChanges(three(box), [{ ...manage('foo', ['codex-cli']), seenManaged: true }]);
    assert.deepEqual(edit.notices?.map(notice => notice.kind), ['edit'], JSON.stringify(edit.notices));
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'Edited in Claude.'));
    assert.equal(await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8'), text('foo', 'Codex’s own.'));
    // Deleted everywhere, the skill keeps no note: turned on again later, it starts clean.
    assert.notEqual((await readRecord(box.home)).record?.items.foo.keptOwn, undefined);
    await deleteEverywhere(three(box), 'foo');
    assert.equal((await readRecord(box.home)).record?.items.foo.keptOwn, undefined);
  } finally { await box.cleanup(); }
});

test('An Undo of a choice that can’t put a copy back or take an added one out stops part-way, and History’s Undo finishes both on a skill no longer synced', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.codex'), { recursive: true });
    await skill(box.home, CLAUDE, 'foo', text('foo', 'Claude’s.'));
    await skill(box.home, COPILOT, 'foo', text('foo', 'Copilot’s.'));
    // Turned on choosing Claude Code's copy: Copilot CLI's is replaced, Codex is given one.
    const chose = await applyChanges(three(box), [{ ...manage('foo'), seenManaged: false, use: 'claude-cli', useHash: (await facts(box, 'foo')).copies['claude-cli']!.hash }]);
    const history = await readHistory(ctx(box));
    const chosen = history.find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.ok(chosen.addedId && history.some(event => event.id === chosen.addedId));
    await chmod(join(box.home, COPILOT), 0o555); await chmod(join(box.home, CODEX), 0o555);
    const once = await restoreFromHistory(three(box), chosen.id, false, { narrow: true });
    assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]).sort(), [['codex-cli', 'failed'], ['copilot-cli', 'failed']]);
    const open = (await readHistory(ctx(box))).filter(event => [chosen.id, chosen.addedId].includes(event.id));
    assert.deepEqual(open.map(event => [event.kind, event.undoneBy, event.restoredTools]).sort(), [['added', undefined, undefined], ['chosen', undefined, []]]);
    assert.equal((await facts(box, 'foo')).managed, false, 'not synced, as before the choice');
    await chmod(join(box.home, COPILOT), 0o755); await chmod(join(box.home, CODEX), 0o755);
    const finished = await restoreFromHistory(three(box), chosen.id, false, { narrow: true });
    assert.equal(finished.stopped, undefined, JSON.stringify(finished));
    assert.deepEqual([await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), await exists(join(box.home, CODEX, 'foo'))], [text('foo', 'Copilot’s.'), false]);
    assert.ok((await readHistory(ctx(box))).filter(event => [chosen.id, chosen.addedId].includes(event.id)).every(event => event.undoneBy));
    assert.equal((await applyChanges(three(box), [])).harnessWrites, 0);
  } finally { await box.cleanup(); }
});
test('Finish undo of a choice leaves a skill no longer synced since as it is: only the copy still to go back goes back (probe F1)', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await applyChanges(three(box), [{ ...manage('foo', ['codex-cli']), seenManaged: true }]);
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex’s own.'));
    await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true }]);
    const chose = await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true, use: 'claude-cli', useHash: (await facts(box, 'foo')).copies['claude-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    await chmod(join(box.home, CODEX), 0o555);
    const once = await restoreFromHistory(three(box), chosen.id, false, { narrow: true });
    await chmod(join(box.home, CODEX), 0o755);
    assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]), [['codex-cli', 'failed']]);
    await applyChanges(three(box), [{ ...manage('foo'), managed: false, seenManaged: true }]);
    const finished = await restoreFromHistory(three(box), chosen.id, false, { narrow: true });
    assert.equal(finished.stopped, undefined, JSON.stringify(finished));
    assert.equal(await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8'), text('foo', 'Codex’s own.'));
    assert.equal((await facts(box, 'foo')).managed, false, 'still not synced');
    assert.equal((await applyChanges(three(box), [])).harnessWrites, 0);
  } finally { await box.cleanup(); }
});
const settleAndPass = async (box: Box, extra: Partial<ShareContext> = {}) => { await applyChanges(three(box, extra), []); return applyChanges(three(box, extra), []); };

test('1: renaming a skill folder by case only is the same skill, never a deletion', async () => {
  const box = await sandbox();
  try {
    await managedThree(box, 'Foo');
    await rename(join(box.home, CLAUDE, 'Foo'), join(box.home, CLAUDE, 'foo'));
    const result = await settleAndPass(box);
    assert.equal(result.harnessWrites, 0, JSON.stringify(result.results));
    for (const root of [COPILOT, CODEX]) assert.ok((await readdir(join(box.home, root))).some(entry => entry.toLowerCase() === 'foo'), root);
    assert.ok((await readdir(join(box.home, CLAUDE))).includes('foo'));
  } finally { await box.cleanup(); }
});

test('2: a deletion leaves a different same-named copy that was never synced', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'foo', text('foo', 'Original.'));
    await applyChanges(fast(box), [manage('foo')]);
    await skill(box.home, CODEX, 'foo', text('foo', 'Codex own.'));
    await rm(join(box.home, CLAUDE, 'foo'), { recursive: true });
    await settleAndPass(box);
    assert.equal(await exists(join(box.home, COPILOT, 'foo')), false, 'the synced copy goes');
    assert.equal(await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8'), text('foo', 'Codex own.'), 'the unrelated one stays');
  } finally { await box.cleanup(); }
});

test('3: a read-only copy in .agents never reverts an edit made elsewhere', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'foo', text('foo', 'Original.'));
    await skill(box.home, '.agents/skills', 'foo', text('foo', 'Original.'));
    await applyChanges(fast(box), [manage('foo')]);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'CLAUDE EDIT'));
    await applyChanges(fast(box), []);
    await applyChanges(fast(box), []);
    assert.equal(await readFile(join(box.home, CLAUDE, 'foo/SKILL.md'), 'utf8'), text('foo', 'CLAUDE EDIT'), 'the edit stays');
    assert.equal(await readFile(join(box.home, '.agents/skills/foo/SKILL.md'), 'utf8'), text('foo', 'Original.'), '.agents is never written');
    assert.equal(await exists(join(box.home, COPILOT, 'foo')), false, 'Copilot reads it from .agents, so nothing is copied into its own folder');
  } finally { await box.cleanup(); }
});

test('4: a moved CODEX_HOME lets go of the old copies, nothing is deleted elsewhere, and switching back syncs again', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    const moved = join(box.base, 'other-codex');
    await mkdir(join(moved, 'skills'), { recursive: true });
    await rm(join(box.home, CODEX, 'foo'), { recursive: true });
    await settleAndPass(box, { overrides: { 'codex-cli': moved } });
    for (const root of [CLAUDE, COPILOT]) assert.equal(await exists(join(box.home, root, 'foo/SKILL.md')), true, root);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Edit.'));
    await applyChanges(three(box), []);
    for (const root of [COPILOT, CODEX]) assert.equal(await readFile(join(box.home, root, 'foo/SKILL.md'), 'utf8'), text('foo', 'Edit.'), `${root} syncs after switching back`);
  } finally { await box.cleanup(); }
});

test('6: Restore never overwrites a new skill with the old name; Undo runs once; Restore brings back the newest content; a Restore can be undone', async () => {
  const box = await sandbox();
  try {
    await managedPair(box, 'foo');
    await rm(join(box.home, CLAUDE, 'foo'), { recursive: true });
    const deleted = await applyChanges(fast(box), []);
    await skill(box.home, CLAUDE, 'foo', text('foo', 'New, unrelated work.'));
    const refused = await restoreFromHistory(fast(box), deleted.notices![0].history);
    assert.match(refused.stopped ?? '', /different “foo”/);
    assert.equal(await readFile(join(box.home, CLAUDE, 'foo/SKILL.md'), 'utf8'), text('foo', 'New, unrelated work.'));
    await applyChanges(fast(box), [manage('foo')]);
    assert.match((await restoreFromHistory(fast(box), deleted.notices![0].history)).stopped ?? '', /managed again/);
    for (const root of [CLAUDE, COPILOT]) assert.equal(await readFile(join(box.home, root, 'foo/SKILL.md'), 'utf8'), text('foo', 'New, unrelated work.'));

    await managedPair(box, 'bar');
    await writeFile(join(box.home, CLAUDE, 'bar/SKILL.md'), text('bar', 'Edit one.'));
    const edited = await applyChanges(fast(box), []);
    assert.equal((await restoreFromHistory(fast(box), edited.notices![0].history)).stopped, undefined);
    await writeFile(join(box.home, COPILOT, 'bar/SKILL.md'), text('bar', 'Later work.'));
    await applyChanges(fast(box), []);
    assert.match((await restoreFromHistory(fast(box), edited.notices![0].history)).stopped ?? '', /already undone/);
    assert.equal(await readFile(join(box.home, CLAUDE, 'bar/SKILL.md'), 'utf8'), text('bar', 'Later work.'), 'later work survives a second Undo');
    const restored = (await readHistory(ctx(box))).find(entry => entry.kind === 'restored')!;
    assert.equal((await restoreFromHistory(fast(box), restored.id)).stopped, undefined, 'a Restore can be undone');

    await managedPair(box, 'baz');
    // A clock of its own that runs from now, so the deletion is inside History's window when Restore reads it.
    const start = Date.now();
    let now = start;
    const timed = () => fast(box, { now: () => now });
    // Claude's edit is seen a second in while Copilot is at the baseline; Copilot's copy is deleted after that, so the deletion is newer.
    await writeFile(join(box.home, CLAUDE, 'baz/SKILL.md'), text('baz', 'Edited while off.'));
    now = start + 1000; await applyChanges(timed(), [], false, { observeOnly: true });
    await rm(join(box.home, COPILOT, 'baz'), { recursive: true });
    now = start + 2000; await applyChanges(timed(), [], false, { observeOnly: true });
    now = start + 3000; const gone = await applyChanges(timed(), []);
    const deletedNotice = gone.notices?.find(notice => notice.item === 'baz');
    assert.equal(deletedNotice?.kind, 'deleted', JSON.stringify(gone.notices));
    assert.equal(await exists(join(box.home, CLAUDE, 'baz')), false);
    const back = await restoreFromHistory(fast(box), deletedNotice!.history);
    assert.equal(back.stopped, undefined, JSON.stringify(back));
    assert.equal(await readFile(join(box.home, CLAUDE, 'baz/SKILL.md'), 'utf8'), text('baz', 'Edited while off.'), 'Restore brings back the edit, not the older copy');
  } finally { await box.cleanup(); }
});

test('9: a change made from a page read before a deletion spread is refused', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'foo');
    await applyChanges(fast(box), [manage('foo', ['copilot-cli'])]);
    await skill(box.home, COPILOT, 'foo', text('foo', 'Copilot own.'));
    await rm(join(box.home, CLAUDE, 'foo'), { recursive: true });
    await applyChanges(fast(box), []);
    const stale = await applyChanges(fast(box), [{ key: 'foo', managed: true, off: [], seenManaged: true }]);
    assert.match(stale.results[0]?.message ?? '', /changed since the page was read/);
    assert.equal(stale.results[0]?.unchanged, true, 'said as a refusal that changed nothing');
    assert.equal(await exists(join(box.home, CLAUDE, 'foo')), false, 'not revived');
  } finally { await box.cleanup(); }
});

test('10: nothing is decided while any copy is still settling', async () => {
  const box = await sandbox();
  try {
    let now = 1000;
    await managedThree(box);
    await rm(join(box.home, COPILOT, 'foo'), { recursive: true });
    await applyChanges(three(box, { now: () => now, settleMs: 2000 }), []);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Edit.'));
    now = 3500;
    await rm(join(box.home, CODEX, 'foo'), { recursive: true });
    const waiting = await applyChanges(three(box, { now: () => now, settleMs: 2000 }), []);
    assert.equal(waiting.harnessWrites, 0);
    assert.equal(waiting.settling, true);
    assert.equal(await exists(join(box.home, CODEX, 'foo')), false, 'not recreated while settling');
    now = 6000;
    const decided = await applyChanges(three(box, { now: () => now, settleMs: 2000 }), []);
    assert.deepEqual(decided.notices?.map(notice => [notice.kind, [...notice.losers].sort()]), [['kept-edit', ['codex-cli', 'copilot-cli']]], 'both deletions named');
  } finally { await box.cleanup(); }
});

test('12: a conflict notice names only the tools that competed', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Claude.'));
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex.'));
    const result = await applyChanges(three(box), []);
    assert.deepEqual(result.notices?.map(notice => [notice.kind, notice.losers]), [['conflict', ['codex-cli']]]);
  } finally { await box.cleanup(); }
});

test('13: a crash in the middle of a replace is finished at the next pass, never read as a deletion', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edited.'));
    const fault = (step: string) => { if (step === 'mid-replace') throw new Error('fault: crash'); };
    await assert.rejects(applyChanges(fast(box, { fault }), []), /fault/);
    assert.equal(await exists(join(box.home, COPILOT, 'pair')), false, 'the crash left the copy parked');
    const next = await settleAndPass(box);
    assert.equal(next.notices?.some(notice => notice.kind === 'kept-edit' || notice.kind === 'deleted'), false, JSON.stringify(next.notices));
    assert.equal(await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), text('pair', 'Edited.'));
  } finally { await box.cleanup(); }
});

// ---------- Two-way re-check round ----------

test('R1: a crash in the middle of an Undo is never read as a deletion', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Edit.'));
    const edited = await applyChanges(three(box), []);
    const fault = (step: string) => { if (step === 'mid-replace') throw new Error('fault: crash'); };
    await assert.rejects(restoreFromHistory(three(box, { fault }), edited.notices![0].history), /fault/);
    const next = await settleAndPass(box);
    assert.equal(next.notices?.some(notice => notice.kind === 'deleted' || notice.kind === 'kept-edit'), false, JSON.stringify(next.notices));
    for (const root of [CLAUDE, COPILOT, CODEX]) assert.equal(await exists(join(box.home, root, 'foo/SKILL.md')), true, root);
  } finally { await box.cleanup(); }
});

test('R3: Delete everywhere leaves a never-synced copy, and Restore brings back the synced skill, not that copy', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'foo', text('foo', 'Synced.'));
    await mkdir(join(box.home, '.codex'), { recursive: true });
    await applyChanges(three(box), [manage('foo', ['codex-cli'])]);
    await skill(box.home, CODEX, 'foo', text('foo', 'Codex own.'));
    await applyChanges(three(box), [manage('foo')]);
    await deleteEverywhere(three(box), 'foo');
    assert.equal(await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8'), text('foo', 'Codex own.'));
    await rm(join(box.home, CODEX, 'foo'), { recursive: true });
    const deleted = (await readHistory(ctx(box))).find(entry => entry.kind === 'deleted')!;
    await restoreFromHistory(three(box), deleted.id);
    assert.equal(await readFile(join(box.home, CLAUDE, 'foo/SKILL.md'), 'utf8'), text('foo', 'Synced.'));
  } finally { await box.cleanup(); }
});

test('R4: removing the shared .agents folder is unreachable, not a deletion', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'foo', text('foo', 'Same.'));
    await skill(box.home, '.agents/skills', 'foo', text('foo', 'Same.'));
    await skill(box.home, COPILOT, 'other');
    await applyChanges(fast(box), [manage('foo')]);
    await rm(join(box.home, '.agents'), { recursive: true });
    await applyChanges(fast(box), []); await applyChanges(fast(box), []);
    assert.equal(await exists(join(box.home, CLAUDE, 'foo/SKILL.md')), true);
  } finally { await box.cleanup(); }
});

test('R7: a copy that fell behind catches up once it can be written, marked apart from new copies, and edits there spread again', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await chmod(join(box.home, CODEX), 0o555); await chmod(join(box.home, CODEX, 'foo'), 0o555);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Edit one.'));
    await applyChanges(three(box), []);
    const count = (await readHistory(ctx(box))).length;
    await applyChanges(three(box), []);
    assert.equal((await readHistory(ctx(box))).length, count, 'a failed copy adds no History when retried');
    await chmod(join(box.home, CODEX), 0o755); await chmod(join(box.home, CODEX, 'foo'), 0o755);
    // Apply all that manages a new skill meanwhile marks the catch-up apart from the new copies.
    await skill(box.home, CLAUDE, 'fresh');
    const caught = await applyChanges(three(box), [manage('fresh')]);
    assert.deepEqual(caught.results.filter(entry => entry.outcome === 'written').map(entry => [entry.item, entry.harness, entry.replaced, entry.caughtUp]).sort(),
      [['foo', 'codex-cli', undefined, true], ['fresh', 'codex-cli', undefined, undefined], ['fresh', 'copilot-cli', undefined, undefined]]);
    assert.ok((await readHistory(ctx(box))).some(entry => entry.kind === 'added' && entry.key === 'fresh'));
    assert.equal(await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8'), text('foo', 'Edit one.'), 'caught up');
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex edit.'));
    await applyChanges(three(box), []);
    assert.equal(await readFile(join(box.home, CLAUDE, 'foo/SKILL.md'), 'utf8'), text('foo', 'Codex edit.'), 'and it spreads again');
  } finally { await box.cleanup(); }
});

test('R8: a reset folder is put back even with one managed skill; R9: deliberately deleting the last two skills spreads', async () => {
  const box = await sandbox();
  try {
    await managedThree(box, 'solo');
    await rename(join(box.home, CODEX), join(box.home, '.codex/skills-old'));
    await mkdir(join(box.home, CODEX));
    const reset = await applyChanges(three(box), []);
    assert.equal(await exists(join(box.home, CODEX, 'solo/SKILL.md')), true, 'put back');
    assert.deepEqual([reset.notices?.[0]?.kind, reset.notices?.[0]?.winner], ['reset', 'codex-cli']);
    await skill(box.home, CLAUDE, 'two');
    await applyChanges(three(box), [manage('two')]);
    for (const name of ['solo', 'two']) await rm(join(box.home, CLAUDE, name), { recursive: true });
    await settleAndPass(box);
    for (const name of ['solo', 'two']) assert.equal(await exists(join(box.home, COPILOT, name)), false, `${name} deletion spread`);
  } finally { await box.cleanup(); }
});

test('R10: with Sync off, Apply all does not carry a pending deletion along', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await rm(join(box.home, CLAUDE, 'foo'), { recursive: true });
    await applyChanges(three(box), [], false, { observeOnly: true });
    const result = await applyChanges(three(box), [manage('foo', ['codex-cli'])], false, { only: new Set(['foo']) });
    assert.match(result.results.map(entry => entry.message).join(' '), /waiting for sync/);
    assert.equal(await exists(join(box.home, COPILOT, 'foo/SKILL.md')), true);
    // The record did change (Codex is left out now), so this hold is no refusal that changed nothing: the click keeps its Undo.
    assert.deepEqual([result.results.some(entry => entry.unchanged), (await readRecord(box.home)).record?.items.foo.off], [false, ['codex-cli']]);
  } finally { await box.cleanup(); }
});

test('A tool whose skills folder was away during a deletion has its copy removed when the folder returns (DEL-02)', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await rename(join(box.home, CODEX), join(box.base, 'codex-away'));
    await rm(join(box.home, CLAUDE, 'foo'), { recursive: true });
    await settleAndPass(box);
    assert.equal(await exists(join(box.home, COPILOT, 'foo')), false);
    await rename(join(box.base, 'codex-away'), join(box.home, CODEX));
    await settleAndPass(box);
    assert.deepEqual(await readdir(join(box.home, CODEX)), []);
  } finally { await box.cleanup(); }
});

test('A copy kept in a tool switched off does not end a removal another tool still owes', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await applyChanges(three(box), [manage('foo', ['copilot-cli'])]);
    await chmod(join(box.home, CODEX), 0o555);
    await rm(join(box.home, CLAUDE, 'foo'), { recursive: true });
    const failed = await applyChanges(three(box), []);
    assert.deepEqual(failed.results.map(result => [result.harness, result.outcome]), [['codex-cli', 'failed']]);
    await chmod(join(box.home, CODEX), 0o755);
    await applyChanges(three(box), []);
    assert.equal(await exists(join(box.home, COPILOT, 'foo/SKILL.md')), true, 'the switched-off copy stays');
    assert.deepEqual(await readdir(join(box.home, CODEX)), []);
  } finally { await box.cleanup(); }
});

test('Delete everywhere removes the copy of a tool whose skills folder was away when that folder returns (DEL-02)', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await rename(join(box.home, CODEX), join(box.base, 'codex-away'));
    await deleteEverywhere(three(box), 'foo');
    await rename(join(box.base, 'codex-away'), join(box.home, CODEX));
    await settleAndPass(box);
    assert.deepEqual(await readdir(join(box.home, CODEX)), []);
  } finally { await box.cleanup(); }
});

for (const how of ['spread', 'Delete everywhere'] as const) {
  test(`An owed removal (${how}) leaves a folder Codex no longer uses alone`, async () => {
    const box = await sandbox();
    try {
      await managedThree(box);
      await rename(join(box.home, CODEX), join(box.base, 'codex-away'));
      if (how === 'spread') { await rm(join(box.home, CLAUDE, 'foo'), { recursive: true }); await settleAndPass(box); }
      else await deleteEverywhere(three(box), 'foo');
      const moved = join(box.base, 'other-codex');
      await mkdir(join(moved, 'skills'), { recursive: true });
      await settleAndPass(box, { overrides: { 'codex-cli': moved } });
      await rename(join(box.base, 'codex-away'), join(box.home, CODEX));
      await settleAndPass(box, { overrides: { 'codex-cli': moved } });
      assert.equal(await exists(join(box.home, CODEX, 'foo/SKILL.md')), true);
    } finally { await box.cleanup(); }
  });
}

test('R11: a linked skill folder is followed when its source is edited', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const source = join(box.base, 'dotfiles/foo');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), text('foo', 'Original.'));
    await mkdir(join(box.home, CLAUDE), { recursive: true });
    await symlink(source, join(box.home, CLAUDE, 'foo'));
    await applyChanges(fast(box), [manage('foo')]);
    await writeFile(join(box.home, COPILOT, 'foo/SKILL.md'), text('foo', 'Copilot edit.'));
    await applyChanges(fast(box), []);
    await writeFile(join(source, 'SKILL.md'), text('foo', 'Edited at the source.'));
    await applyChanges(fast(box), []);
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'Edited at the source.'));
  } finally { await box.cleanup(); }
});

test('R12: a History file of the wrong shape is moved aside; R13: History keeps the chosen days with no event cap, and any History write frees an expired deletion’s content, which still stops its stale replica', async () => {
  const box = await sandbox();
  try {
    const start = Date.now(), later = start + 40 * DAY_MS;
    let now = start;
    const timed = (historyDays?: HistoryDays) => fast(box, { now: () => now, historyDays });
    assert.equal(await pruneHistory(timed(7)), 'later', 'a home this build doesn’t sync yet takes a shorter window at its first History write');
    await managedPair(box);
    await managedPair(box, 'gone');
    await writeFile(join(storeDirectory(box.home), 'history.json'), '{"events":{"not":"a list"}}');
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'One.'));
    await applyChanges(timed(), []);
    assert.ok((await readdir(storeDirectory(box.home))).some(entry => entry.startsWith('history.unreadable-')), 'a History file of the wrong shape is moved aside');
    // Deleted everywhere today while Copilot's copy can't be removed: that copy is the stale replica the deletion still owes.
    // (Only where a read-only folder stops its owner: not on Windows, nor as root.)
    const canBlock = !noPosix && process.getuid?.() !== 0;
    if (canBlock) await chmod(join(box.home, COPILOT), 0o555);
    await deleteEverywhere(timed(), 'gone');
    // Forty days on: events 5, 20 and 60 days old, and more than the old cap of 1,000 from yesterday.
    now = later;
    const aged = (days: number, key: string) => ({ id: key, at: new Date(later - days * DAY_MS).toISOString(), key, item: key, kind: 'edit', losers: [], orderProved: true });
    const file = join(storeDirectory(box.home), 'history.json');
    const seeded = [...JSON.parse(await readFile(file, 'utf8')).events, aged(60, 'sixty'), aged(20, 'twenty'), aged(5, 'five'), ...Array.from({ length: 1001 }, (_, index) => aged(1, `filler-${index}`))];
    await writeFile(file, JSON.stringify({ events: seeded }));
    const kept = async (historyDays: HistoryDays) => (await readHistory(timed(historyDays))).filter(entry => ['sixty', 'twenty', 'five'].includes(entry.key) || entry.kind === 'deleted').map(entry => entry.key);
    const storeOf = async (key: string) => readdir(join(storeDirectory(box.home), 'items', key)).catch(() => [] as string[]);

    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Two.'));
    await applyChanges(timed(90), []);
    assert.deepEqual(await kept(90), ['gone', 'sixty', 'twenty', 'five'], '90 days keeps the 60-day event across a sync pass');
    assert.ok((await readHistory(timed(90))).length > 1001, 'no event cap');
    assert.notDeepEqual(await storeOf('gone'), [], 'a deletion inside the window keeps its content');

    // A home shortened elsewhere follows at its next History write of any kind: here an MCP server's change, with no skill event.
    await appendHistory(timed(30), [{ id: 'mcp-now', at: new Date(later).toISOString(), key: 'mcp:server', item: 'server', kind: 'edit', losers: [], orderProved: true }]);
    assert.deepEqual(await kept(30), ['twenty', 'five']);
    assert.deepEqual(await storeOf('gone'), [], 'the expired deletion’s content is freed');
    const { record } = await readRecord(box.home);
    assert.ok(record!.items.gone.deleted, 'the deletion record stays');
    assert.ok((await storeOf('pair')).includes(record!.items.pair.hash), 'the current revision stays');

    assert.equal(await pruneHistory(timed(7)), 'done', 'a home this build syncs is pruned at once');
    assert.deepEqual(await kept(7), ['five']);
    assert.ok(JSON.parse(await readFile(file, 'utf8')).events.every((entry: { key: string }) => !['sixty', 'twenty'].includes(entry.key)), 'History’s file was rewritten, not just read shorter');

    if (canBlock) {
      await chmod(join(box.home, COPILOT), 0o755);
      await applyChanges(timed(7), []);
      assert.deepEqual([await exists(join(box.home, COPILOT, 'gone')), await exists(join(box.home, CLAUDE, 'gone'))], [false, false], 'the stale replica is removed, never spread back');
    }
  } finally { await box.cleanup(); }
});

// ---------- Third check ----------

const storeHas = async (box: Box, key: string, body: string) => {
  for (const revision of await readdir(join(storeDirectory(box.home), 'items', key)).catch(() => [] as string[])) {
    if ((await readFile(join(storeDirectory(box.home), 'items', key, revision, 'SKILL.md'), 'utf8').catch(() => '')).includes(body)) return true;
  }
  return false;
};

test('T1: a competing edit that loses while a deletion races stays in History and the store', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'CLAUDE WORK'));
    await writeFile(join(box.home, COPILOT, 'foo/SKILL.md'), text('foo', 'COPILOT WORK'));
    await rm(join(box.home, CODEX, 'foo'), { recursive: true });
    await applyChanges(three(box), []);
    assert.ok(await storeHas(box, 'foo', 'CLAUDE WORK'), 'the losing edit is kept');
    const kept = (await readHistory(ctx(box))).find(entry => entry.kind === 'kept-edit')!;
    assert.ok(kept.losers.some(loser => loser.tool === 'claude-cli'), JSON.stringify(kept.losers));
  } finally { await box.cleanup(); }
});

test('T2: Undo of a copy choice from History puts the replaced copy back everywhere', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'foo', text('foo', 'CLAUDE VERSION'));
    await skill(box.home, COPILOT, 'foo', text('foo', 'COPILOT VERSION (unique work)'));
    await applyChanges(fast(box), [{ key: 'foo', managed: true, off: [], use: 'claude-cli' }]);
    const chosen = (await readHistory(ctx(box))).find(entry => entry.kind === 'chosen')!;
    await restoreFromHistory(fast(box), chosen.id);
    assert.equal(await readFile(join(box.home, CLAUDE, 'foo/SKILL.md'), 'utf8'), text('foo', 'COPILOT VERSION (unique work)'), 'and Undo brings it back');
  } finally { await box.cleanup(); }
});

test('T3: a skill removed from every tool becomes a deletion; a later install is new, never deleted or revived', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    for (const root of [CLAUDE, COPILOT, CODEX]) await rm(join(box.home, root, 'foo'), { recursive: true });
    const gone = await applyChanges(three(box), []);
    assert.equal(gone.notices?.[0]?.kind, 'deleted');
    await skill(box.home, CLAUDE, 'foo', text('foo', 'Original.'));
    await settleAndPass(box);
    assert.equal(await exists(join(box.home, CLAUDE, 'foo/SKILL.md')), true, 'the reinstall is not deleted');
    assert.equal(await exists(join(box.home, COPILOT, 'foo')), false, 'nor spread: it is new and unmanaged');
  } finally { await box.cleanup(); }
});

test('T5: an edit saved while the previous one is spreading is not reverted', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edit 1'));
    let saved = false;
    const fault = (step: string) => { if (step === 'before-replace' && !saved) { saved = true; writeFileSync(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edit 2')); } };
    await applyChanges(fast(box, { fault }), []);
    assert.ok(saved, 'the save really happened mid-spread');
    await applyChanges(fast(box), []);
    await applyChanges(fast(box), []);
    assert.equal(await readFile(join(box.home, CLAUDE, 'pair/SKILL.md'), 'utf8'), text('pair', 'Edit 2'), 'the newer edit survives');
    assert.equal(await readFile(join(box.home, COPILOT, 'pair/SKILL.md'), 'utf8'), text('pair', 'Edit 2'));
  } finally { await box.cleanup(); }
});

test('T6: moving a copy into ~/.agents/skills is a move, not a deletion', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await mkdir(join(box.home, '.agents/skills'), { recursive: true });
    await rename(join(box.home, COPILOT, 'foo'), join(box.home, '.agents/skills/foo'));
    await settleAndPass(box);
    assert.equal(await exists(join(box.home, CLAUDE, 'foo/SKILL.md')), true);
  } finally { await box.cleanup(); }
});

test('T9: what an unreadable History mentioned is never pruned', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Claude.'));
    await writeFile(join(box.home, COPILOT, 'pair/SKILL.md'), text('pair', 'Copilot.'));
    await applyChanges(fast(box), []);
    const raw = await readFile(join(storeDirectory(box.home), 'history.json'), 'utf8');
    await writeFile(join(storeDirectory(box.home), 'history.json'), raw.slice(0, -20));
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Later.'));
    await applyChanges(fast(box), []);
    assert.ok((await readdir(storeDirectory(box.home))).some(entry => entry.startsWith('history.unreadable-')), 'moved aside, never overwritten');
    assert.ok(await storeHas(box, 'pair', 'Claude.'), 'the losing side is still there');
  } finally { await box.cleanup(); }
});

test('P8: Undo of an old edit is refused once the skill was deleted', async () => {
  const box = await sandbox();
  try {
    await managedPair(box);
    await writeFile(join(box.home, CLAUDE, 'pair/SKILL.md'), text('pair', 'Edit.'));
    const edited = await applyChanges(fast(box), []);
    await rm(join(box.home, CLAUDE, 'pair'), { recursive: true });
    await applyChanges(fast(box), []);
    assert.match((await restoreFromHistory(fast(box), edited.notices![0].history)).stopped ?? '', /deleted since/);
    assert.equal(await exists(join(box.home, COPILOT, 'pair')), false);
  } finally { await box.cleanup(); }
});

test('T7: a reset first seen by a Sync-off Apply all of another skill is still a reset on the next full pass', async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await skill(box.home, CLAUDE, 'other');
    await rename(join(box.home, CODEX), join(box.home, '.codex/skills-old'));
    await mkdir(join(box.home, CODEX));
    await applyChanges(three(box), [manage('other')], false, { only: new Set(['other']) });
    await settleAndPass(box);
    for (const root of [CLAUDE, COPILOT]) assert.equal(await exists(join(box.home, root, 'foo/SKILL.md')), true, `${root} keeps foo`);
    assert.equal(await exists(join(box.home, CODEX, 'foo/SKILL.md')), true, 'and Codex gets it back');
  } finally { await box.cleanup(); }
});

test('Apply all records the copies it adds; Undo removes them while unchanged and unmanages the skill', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'fresh', text('fresh', 'Mine.'));
    await applyChanges(fast(box), [manage('fresh')]);
    assert.ok(await exists(join(box.home, COPILOT, 'fresh')));
    const added = (await readHistory(ctx(box))).find(event => event.kind === 'added' && event.key === 'fresh')!;
    assert.deepEqual(added.losers.map(loser => loser.tool), ['copilot-cli']);
    const undone = await restoreFromHistory(fast(box), added.id);
    assert.equal(undone.stopped, undefined);
    assert.equal(await exists(join(box.home, COPILOT, 'fresh')), false, 'the added copy is gone');
    assert.equal(await readFile(join(box.home, CLAUDE, 'fresh', 'SKILL.md'), 'utf8'), text('fresh', 'Mine.'), 'the original is untouched');
    assert.equal((await facts(box, 'fresh')).managed, false);
    assert.ok((await readHistory(ctx(box))).find(event => event.id === added.id)!.undoneBy);
    assert.match((await restoreFromHistory(fast(box), added.id)).stopped ?? '', /already undone/);
  } finally { await box.cleanup(); }
});

test('Undo of added copies keeps a copy edited since, and that tool keeps syncing', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'kept', text('kept', 'Mine.'));
    await applyChanges(fast(box), [manage('kept')]);
    const added = (await readHistory(ctx(box))).find(event => event.kind === 'added' && event.key === 'kept')!;
    await writeFile(join(box.home, COPILOT, 'kept', 'SKILL.md'), text('kept', 'Edited in Copilot.'));
    const undone = await restoreFromHistory(fast(box), added.id);
    assert.equal(await readFile(join(box.home, COPILOT, 'kept', 'SKILL.md'), 'utf8'), text('kept', 'Edited in Copilot.'), 'an edited copy stays');
    assert.ok(undone.results.some(entry => entry.outcome === 'held' && /edited since/.test(entry.message)));
  } finally { await box.cleanup(); }
});

test('Pi: a managed skill reaches Pi’s own skills folder; one Pi would not load is held with the reason', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    const withPi: HarnessId[] = ['claude-cli', 'pi-cli'];
    const piCtx = ctx(box, { read: () => Promise.all(withPi.map(harness => discover({ home: box.home, mode: 'custom', harness }))) });
    await skill(box.home, CLAUDE, 'good');
    await skill(box.home, CLAUDE, 'bare', '---\nname: bare\n---\n\nNo description.\n');
    await skill(box.home, CLAUDE, 'plain', 'No frontmatter at all.\n');
    const result = await applyChanges(piCtx, [manage('good'), manage('bare'), manage('plain')]);
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/good/SKILL.md'), 'utf8'), text('good'));
    assert.equal(await exists(join(box.home, '.pi/agent/skills/bare')), false);
    assert.ok(result.results.every(entry => !(entry.item === 'bare' && entry.outcome === 'written')));
    const view = await manageView(piCtx);
    assert.match(view.skills.find(item => item.key === 'bare')!.cannot['pi-cli'] ?? '', /Pi will not load it: it has no description text/);
    assert.match(view.skills.find(item => item.key === 'plain')!.cannot['pi-cli'] ?? '', /Pi will not load it: it has no YAML frontmatter/);
  } finally { await box.cleanup(); }
});

test('Undo right after a copy choice puts the replaced copy back in its own tool only, removes added copies and unmanages', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.codex'), { recursive: true });
    await skill(box.home, CLAUDE, 'foo', text('foo', 'CLAUDE VERSION'));
    await skill(box.home, COPILOT, 'foo', text('foo', 'COPILOT VERSION'));
    await applyChanges(three(box), [{ key: 'foo', managed: true, off: [], use: 'claude-cli' }]);
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'CLAUDE VERSION'));
    assert.equal(await exists(join(box.home, CODEX, 'foo/SKILL.md')), true, 'the choice added a Codex copy');
    const chosen = (await readHistory(ctx(box))).find(entry => entry.kind === 'chosen')!;
    const undone = await restoreFromHistory(three(box), chosen.id, false, { narrow: true });
    assert.equal(undone.stopped, undefined, undone.stopped ?? '');
    assert.equal(await readFile(join(box.home, CLAUDE, 'foo/SKILL.md'), 'utf8'), text('foo', 'CLAUDE VERSION'), 'the chosen tool keeps its copy');
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'COPILOT VERSION'), 'the replaced copy is back');
    assert.equal(await exists(join(box.home, CODEX, 'foo')), false, 'the added copy is gone');
    const view = (await manageView(three(box))).skills.find(item => item.key === 'foo')!;
    assert.equal(view.managed, false);
    // A later pass leaves the differing copies alone.
    await applyChanges(three(box), []);
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'COPILOT VERSION'));
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice writes nothing when a copy changed since', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.codex'), { recursive: true });
    await skill(box.home, CLAUDE, 'foo', text('foo', 'CLAUDE VERSION'));
    await skill(box.home, COPILOT, 'foo', text('foo', 'COPILOT VERSION'));
    await applyChanges(three(box), [{ key: 'foo', managed: true, off: [], use: 'claude-cli' }]);
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'EDITED IN CODEX'));
    const chosen = (await readHistory(ctx(box))).find(entry => entry.kind === 'chosen')!;
    const undone = await restoreFromHistory(three(box), chosen.id, false, { narrow: true });
    assert.ok(undone.stopped, 'stopped');
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'CLAUDE VERSION'), 'nothing was written');
    assert.equal(await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8'), text('foo', 'EDITED IN CODEX'));
  } finally { await box.cleanup(); }
});

test('One build syncs a home at a time: the other names the owner, and Take over syncing carries on from the same record', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, '.claude/skills', 'notes');
    // Two builds on one home, each with its own settings.
    const standard = ctx(box, { build: 'com.centralknot.firstlook', buildName: 'Central Knot', settingsPath: join(box.base, 'standard-settings.json') });
    const acme = ctx(box, { build: 'com.centralknot.custom.acme', buildName: 'Acme Knot', settingsPath: join(box.base, 'acme-settings.json') });
    // The standard app manages a skill: the home is its to sync.
    assert.equal((await applyChanges(standard, [manage('notes')])).stopped, undefined);
    assert.equal((await syncGate(standard)).state, 'ready');
    const owned = (await readRecord(box.home)).record!;
    assert.deepEqual([owned.owner, owned.ownerName, Object.keys(owned.items)], ['com.centralknot.firstlook', 'Central Knot', ['notes']]);
    // The custom build finds it owned: it names the owner and writes nothing.
    assert.deepEqual(await syncGate(acme), { state: 'stopped', reason: 'Central Knot syncs this home, so nothing was written or deleted. Take over syncing to have Acme Knot sync it instead.', owner: { build: 'com.centralknot.firstlook', name: 'Central Knot' } });
    const before = await snapshotTree(box.home);
    assert.match((await applyChanges(acme, [manage('notes')])).stopped ?? '', /^Central Knot syncs this home/);
    assert.deepEqual(await snapshotTree(box.home), before);
    // Take over syncing: the same record, generation and items, under the new owner. Nothing is set up again.
    assert.deepEqual(await takeOverSync(acme), { from: 'Central Knot' });
    const taken = (await readRecord(box.home)).record!;
    assert.deepEqual([taken.owner, taken.ownerName, taken.generation], ['com.centralknot.custom.acme', 'Acme Knot', owned.generation]);
    assert.deepEqual(taken.items, owned.items);
    assert.equal((await syncGate(acme)).state, 'ready');
    assert.equal((await manageView(acme)).skills.find(item => item.key === 'notes')?.managed, true);
    // The build that owned it now finds the other one, by name, and stops; taking over again changes nothing for the new owner.
    const stopped = await syncGate(standard);
    assert.ok(stopped.state === 'stopped' && stopped.owner?.name === 'Acme Knot', JSON.stringify(stopped));
    assert.deepEqual(await takeOverSync(acme), {});
    // A pass the standard app had under way when it was taken over stops at its next save: it can't take the home back by finishing.
    const stale = { ...owned, items: { ...owned.items } };
    await assert.rejects(saveRecord(box.home, stale), /^Error: Acme Knot took over syncing this home meanwhile, so this stopped there\.$/);
    assert.equal((await readRecord(box.home)).record!.owner, 'com.centralknot.custom.acme');
    // A home that can't be written is taken over by nobody.
    assert.match((await takeOverSync({ ...standard, mode: 'actual', home: box.home, realHome: box.home, allowActualWrites: false })).stopped ?? '', /^Preview only/);
    // And back again, by the same step.
    assert.deepEqual(await takeOverSync(standard), { from: 'Acme Knot' });
    assert.equal((await syncGate(standard)).state, 'ready');
    // A record made before builds wrote their names: the standard app's identity is known, any other is said as it is.
    const path = join(box.home, '.central-knot/sync.json');
    const { ownerName: _name, ...unnamed } = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify(unnamed));
    assert.match(gateRefusal(await syncGate(acme)) ?? '', /^Central Knot syncs this home/);
    await writeFile(path, JSON.stringify({ ...unnamed, owner: 'com.example.other' }));
    assert.match(gateRefusal(await syncGate(acme)) ?? '', /^Another Central Knot build \(com\.example\.other\) syncs this home/);
    // A record that can't be read is taken over by nobody.
    await writeFile(path, '{ damaged');
    assert.match((await takeOverSync(acme)).stopped ?? '', /^The sync record is damaged\./);
    assert.equal(await readFile(path, 'utf8'), '{ damaged');
  } finally { await box.cleanup(); }
});

test('Undo of a skill’s copy choice gives the copy it puts back its earlier edit time, so the copy edited most recently is the same one as before', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'pair', text('pair', 'Older.'));
    await skill(box.home, COPILOT, 'pair', text('pair', 'Newer.'));
    const earlier = new Date(Date.now() - 3_600_000);
    await utimes(join(box.home, CLAUDE, 'pair/SKILL.md'), earlier, earlier);
    const times = async () => { const copies = (await facts(box, 'pair')).copies; return [copies['claude-cli']!.modified, copies['copilot-cli']!.modified]; };
    const [claudeBefore] = await times();
    // Copilot CLI's newer copy is chosen, then undone: Claude Code's older copy is written back.
    const chose = await applyChanges(fast(box), [{ ...manage('pair'), use: 'copilot-cli', useHash: (await facts(box, 'pair')).copies['copilot-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.equal((await restoreFromHistory(fast(box), chosen.id, false, { narrow: true })).stopped, undefined);
    const [claude, copilot] = await times();
    assert.equal(claude, claudeBefore);
    assert.ok(Date.parse(copilot) > Date.parse(claude), 'Copilot CLI’s is still the one edited most recently');
  } finally { await box.cleanup(); }
});

test('Finish undo of a skill’s choice after the synced content moved on leaves it where it is', { skip: noPosix || process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await managedThree(box);
    await applyChanges(three(box), [{ ...manage('foo', ['codex-cli']), seenManaged: true }]);
    await writeFile(join(box.home, CODEX, 'foo/SKILL.md'), text('foo', 'Codex’s own.'));
    await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true }]);
    const chose = await applyChanges(three(box), [{ ...manage('foo'), seenManaged: true, use: 'claude-cli', useHash: (await facts(box, 'foo')).copies['claude-cli']!.hash }]);
    const chosen = (await readHistory(ctx(box))).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    await chmod(join(box.home, CODEX), 0o555);
    await restoreFromHistory(three(box), chosen.id, false, { narrow: true });
    await chmod(join(box.home, CODEX), 0o755);
    // Codex left out, then an edit in Claude Code spreads.
    await applyChanges(three(box), [{ ...manage('foo', ['codex-cli']), seenManaged: true }]);
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Moved on.'));
    await applyChanges(three(box), []);
    const moved = (await readRecord(box.home)).record!.items.foo.hash;
    assert.equal((await restoreFromHistory(three(box), chosen.id, false, { narrow: true })).stopped, undefined);
    assert.equal(await readFile(join(box.home, CODEX, 'foo/SKILL.md'), 'utf8'), text('foo', 'Codex’s own.'));
    assert.equal((await readRecord(box.home)).record!.items.foo.hash, moved);
    assert.equal((await applyChanges(three(box), [])).harnessWrites, 0);
    // The copies that moved on are still the skill's: an edit in one of them spreads.
    await writeFile(join(box.home, CLAUDE, 'foo/SKILL.md'), text('foo', 'Edited again.'));
    await applyChanges(three(box), []);
    assert.equal(await readFile(join(box.home, COPILOT, 'foo/SKILL.md'), 'utf8'), text('foo', 'Edited again.'));
  } finally { await box.cleanup(); }
});
