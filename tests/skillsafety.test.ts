// Skills' safety on real folders: what a pass refuses and writes nothing for (a damaged, missing, foreign or newer record; a
// home that reaches the person's real configuration; another build's home), and what a skill's folder is (bytes and modes,
// no nested .git, no Finder or editor leftovers; odd names as keys). The skills kind is src/skills.ts; these hold for every
// kind, through src/share.ts's gates (syncGate, writeAccess, takeOverSync), and are shown here on skills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { libraryGate, managedNow, readRecord, saveRecord, storeDirectory, syncGate, takeOverSync, writeAccess, type ShareContext } from '../src/share.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import type { Change, HarnessId, Snapshot } from '../src/types.ts';
import { lineApp, releaseLine } from '../src/updates.ts';

const both: HarnessId[] = ['claude-cli', 'copilot-cli'];
const CLAUDE = '.claude/skills', COPILOT = '.copilot/skills';
const noPosix = process.platform === 'win32';
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-skillsafety-')));
  const home = join(base, 'home');
  await mkdir(join(home, '.claude'), { recursive: true });
  await mkdir(join(home, '.copilot'), { recursive: true });
  return { base, home, cleanup: () => { execFileSync('chmod', ['-R', 'u+rwx', base]); return rm(base, { recursive: true, force: true }); } };
}
type Box = Awaited<ReturnType<typeof sandbox>>;
const read = (home: string, mode: Snapshot['mode'] = 'custom') => () => Promise.all(both.map(harness => discover({ home, mode, harness })));
const ctx = (box: Box, extra: Partial<ShareContext> = {}): ShareContext => ({ home: box.home, mode: 'custom', read: read(box.home), build: 'test', settingsPath: join(box.base, 'settings.json'), realHome: join(box.base, 'real'), settleMs: 0, ...extra });
async function skill(home: string, root: string, folder: string, content = text(folder)) {
  const directory = join(home, root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), content);
  return directory;
}
const exists = (path: string) => lstat(path).then(() => true, () => false);
/** A pass of the skills kind on the tools this context finds in its home, with the page's clicks. */
const apply = async (context: ShareContext, changes: Change[] = [], resume = false) => applySkills(context, await managedNow(context, await context.read()), changes, { resume });
const view = async (context: ShareContext) => skillsView(context, await managedNow(context, await context.read()));
const facts = async (box: Box, key: string) => (await view(ctx(box))).items.find(item => item.key === key)!;
const manage = (key: string) => ({ key, managed: true, off: [] as HarnessId[] });

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
    const result = await apply(ctx(box), [manage('rich')]);
    assert.equal(result.writes, 1);
    const copy = join(box.home, COPILOT, 'rich');
    assert.equal(await readFile(join(copy, 'SKILL.md'), 'utf8'), await readFile(join(source, 'SKILL.md'), 'utf8'));
    assert.deepEqual(await readFile(join(copy, 'asset.bin')), Buffer.from([0, 1, 2, 255, 254]));
    assert.equal((await stat(join(copy, 'scripts/run.sh'))).mode & 0o777, 0o755);
    assert.equal(await exists(join(copy, '.git')), false, 'nested .git is not copied');
    assert.equal(await exists(join(copy, 'empty')), true);
    assert.deepEqual(await snapshotTree(join(box.home, '.claude')), beforeSource, 'source and unrelated bytes unchanged');
    // The pass after a first write notes the skills folder it made (librarypass.ts keepFolders); from then on nothing changes.
    await apply(ctx(box), []);
    const beforeRepeat = await snapshotTree(box.base);
    const repeat = await apply(ctx(box), []);
    assert.equal(repeat.writes, 0);
    assert.deepEqual(await snapshotTree(box.base), beforeRepeat, 'a repeat changes no byte anywhere');
  } finally { await box.cleanup(); }
});

test('A skill with an internal link can’t be seen for sure: it is not taken in, and no link is created or followed', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const directory = await skill(box.home, CLAUDE, 'has-link');
    await writeFile(join(box.base, 'outside.txt'), 'outside');
    await symlink(join(box.base, 'outside.txt'), join(directory, 'asset'));
    assert.match((await facts(box, 'has-link'))?.unseen?.['claude-cli'] ?? '', /can’t be copied as it is/, 'its row says why');
    assert.match((await apply(ctx(box), [manage('has-link')])).results[0]?.message ?? '', /No tool has a copy of it to take in/);
    const result = await apply(ctx(box), [manage('has-link')]);
    assert.equal(result.writes, 0);
    assert.equal(await exists(join(box.home, COPILOT, 'has-link')), false);
  } finally { await box.cleanup(); }
});

test('A folder without SKILL.md where a copy would go is never overwritten', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'taken');
    await mkdir(join(box.home, COPILOT, 'taken'), { recursive: true });
    await writeFile(join(box.home, COPILOT, 'taken/notes.txt'), 'mine');
    assert.match((await facts(box, 'taken')).unseen?.['copilot-cli'] ?? '', /has no SKILL\.md/);
    const result = await apply(ctx(box), [manage('taken')]);
    assert.equal(result.writes, 0, 'nothing happens there while it can’t be seen');
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
    await apply(ctx(box), [manage('twin'), manage('solo')]);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/SKILL.md')), true);
    assert.equal(await exists(join(box.home, COPILOT, 'solo/.DS_Store')), false);
    await writeFile(join(box.home, COPILOT, 'solo/.DS_Store'), 'finder again');
    const solo = await facts(box, 'solo');
    assert.equal(solo.copies['claude-cli']!.hash, solo.copies['copilot-cli']!.hash);
  } finally { await box.cleanup(); }
});

test('Editor swap, lock and backup files are no edit, and are never copied', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await apply(ctx(box), [manage('solo')]);
    for (const name of ['.SKILL.md.swp', 'SKILL.md~', '.#SKILL.md', '#SKILL.md#']) await writeFile(join(box.home, CLAUDE, 'solo', name), 'editor');
    const result = await apply(ctx(box), []);
    assert.deepEqual([result.writes, result.notices], [0, []]);
    assert.deepEqual(await readdir(join(box.home, COPILOT, 'solo')), ['SKILL.md']);
  } finally { await box.cleanup(); }
});

test('Odd valid names sync and are remembered: constructor, __proto__ and long non-Latin folders', async () => {
  const box = await sandbox();
  try {
    const long = 'あ'.repeat(60);
    const names = ['constructor', '__proto__', long, '🎉'.repeat(30)];
    for (const name of names) await skill(box.home, CLAUDE, name, text('ok-name'));
    const result = await apply(ctx(box), names.map(name => manage(name)));
    assert.equal(result.writes, 4, JSON.stringify(result.results));
    for (const name of names) assert.equal(await exists(join(box.home, COPILOT, name, 'SKILL.md')), true, name);
    for (const name of names) assert.equal((await facts(box, name)).on, true, `${name} is remembered as managed`);
    await apply(ctx(box), [{ key: '__proto__', managed: false, off: [] }]);
    assert.equal((await facts(box, '__proto__')).on, false);
    assert.equal((await facts(box, 'constructor')).on, true);
  } finally { await box.cleanup(); }
});

test('Every stop writes nothing: damaged, missing, another generation, a newer format and another owner', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await apply(ctx(box), [manage('solo')]);
    await skill(box.home, CLAUDE, 'new-one');
    const path = join(storeDirectory(box.home), 'sync.json');
    const good = await readFile(path, 'utf8');
    const record = JSON.parse(good);
    const attempt = async (bad: string | null, expected: RegExp) => {
      if (bad === null) await rm(path); else await writeFile(path, bad);
      const before = await snapshotTree(box.home);
      const result = await apply(ctx(box), [manage('new-one')]);
      assert.match(result.stopped ?? '', expected);
      assert.equal(result.writes, 0);
      assert.deepEqual(await snapshotTree(box.home), before);
    };
    await attempt('{ not json', /damaged/);
    await attempt(null, /missing/);
    await attempt(JSON.stringify({ ...record, generation: 'other' }), /not the one/);
    await attempt(JSON.stringify({ ...record, formatVersion: record.formatVersion + 1 }), /newer/);
    await attempt(JSON.stringify({ ...record, owner: 'someone-else' }), /Another Central Knot build \(someone-else\) syncs this home, so nothing was written or deleted\. Take over syncing/);
    await writeFile(path, good);
    assert.equal((await apply(ctx(box), [manage('new-one')])).writes, 1, 'restoring the record then retrying works');
  } finally { await box.cleanup(); }
});

test('Lost settings wait for an explicit resume that keeps the record', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, CLAUDE, 'solo');
    await apply(ctx(box), [manage('solo')]);
    const record = await readFile(join(storeDirectory(box.home), 'sync.json'), 'utf8');
    await rm(join(box.base, 'settings.json'));
    await skill(box.home, CLAUDE, 'new-one');
    assert.equal((await syncGate(ctx(box))).state, 'needs-resume');
    const blocked = await apply(ctx(box), [manage('new-one')]);
    assert.match(blocked.stopped ?? '', /no memory/);
    assert.equal(blocked.writes, 0);
    const resumed = await apply(ctx(box), [manage('new-one')], true);
    assert.equal(resumed.writes, 1);
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
      assert.equal((await writeAccess(context)).allowed, false);
      const result = await apply(context, [manage('real-skill')]);
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
    const relative = await apply({ ...context, overrides: { 'copilot-cli': 'relative-root' } }, [manage('real-skill')]);
    assert.match(relative.stopped ?? '', /COPILOT_HOME is not an absolute path/);
    assert.deepEqual(await snapshotTree(realHome), before);
    assert.deepEqual(await managedNow(context, await context.read()), ['claude-cli'], 'Copilot is not detected in this home, so it is no column');
    const absent = await apply(context, [manage('real-skill')]);
    assert.equal(absent.writes, 0);
    assert.equal(await exists(join(realHome, COPILOT)), false);
    await mkdir(join(realHome, '.copilot'));
    const written = await apply(context, []);
    assert.equal(written.writes, 1, 'once Copilot is there, the managed skill catches up');
    assert.equal(await exists(join(realHome, COPILOT, 'real-skill/SKILL.md')), true);
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
    assert.equal((await apply(standard, [manage('notes')])).stopped, undefined);
    assert.equal((await syncGate(standard)).state, 'ready');
    const owned = (await readRecord(box.home)).record!;
    assert.deepEqual([owned.owner, owned.ownerName], ['com.centralknot.firstlook', 'Central Knot']);
    // The custom build finds it owned: it names the owner and writes nothing.
    assert.deepEqual(await syncGate(acme), { state: 'stopped', reason: 'Central Knot syncs this home, so nothing was written or deleted. Take over syncing to have Acme Knot sync it instead.', owner: { build: 'com.centralknot.firstlook', name: 'Central Knot' } });
    const before = await snapshotTree(box.home);
    assert.match((await apply(acme, [manage('notes')])).stopped ?? '', /^Central Knot syncs this home/);
    assert.deepEqual(await snapshotTree(box.home), before);
    // Take over syncing: the same record and generation under the new owner, and the same skills. Nothing is set up again.
    assert.deepEqual(await takeOverSync(acme), { from: 'Central Knot' });
    const taken = (await readRecord(box.home)).record!;
    assert.deepEqual([taken.owner, taken.ownerName, taken.generation], ['com.centralknot.custom.acme', 'Acme Knot', owned.generation]);
    assert.equal((await syncGate(acme)).state, 'ready');
    assert.equal((await view(acme)).items.find(item => item.key === 'notes')?.on, true);
    // The build that owned it now finds the other one, by name, and stops; taking over again changes nothing for the new owner.
    const stopped = await syncGate(standard);
    assert.ok(stopped.state === 'stopped' && stopped.owner?.name === 'Acme Knot', JSON.stringify(stopped));
    assert.deepEqual(await takeOverSync(acme), {});
    // A pass the standard app had under way when it was taken over stops at its next save: it can't take the home back by finishing.
    const stale = { ...owned };
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
    const refusal = async () => { const gate = await libraryGate(acme); return 'refused' in gate ? gate.refused : ''; };
    assert.match(await refusal(), /^Central Knot syncs this home/);
    await writeFile(path, JSON.stringify({ ...unnamed, owner: 'com.example.other' }));
    assert.match(await refusal(), /^Another Central Knot build \(com\.example\.other\) syncs this home/);
    // A record that can't be read is taken over by nobody.
    await writeFile(path, '{ damaged');
    assert.match((await takeOverSync(acme)).stopped ?? '', /^The sync record is damaged\./);
    assert.equal(await readFile(path, 'utf8'), '{ damaged');
  } finally { await box.cleanup(); }
});

test('The preview and the alpha on one home: each names the other as the person knows it, and either can take over', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, '.claude/skills', 'notes');
    // Each app's identity as main.ts takes it from its release tag (updates.ts lineApp), with its own settings.
    const app = (tag: string, settings: string) => { const own = lineApp(releaseLine(tag)); return ctx(box, { build: own.bundleId, buildName: own.name, settingsPath: join(box.base, settings) }); };
    const preview = app('v0.5.0-preview.9', 'preview-settings.json'), alpha = app('v0.6.0-alpha.1', 'alpha-settings.json');
    assert.equal((await apply(preview, [manage('notes')])).stopped, undefined);
    assert.deepEqual(await syncGate(alpha), { state: 'stopped', reason: 'Central Knot syncs this home, so nothing was written or deleted. Take over syncing to have Central Knot Alpha sync it instead.', owner: { build: 'com.centralknot.firstlook', name: 'Central Knot' } });
    assert.deepEqual(await takeOverSync(alpha), { from: 'Central Knot' });
    assert.deepEqual(await syncGate(preview), { state: 'stopped', reason: 'Central Knot Alpha syncs this home, so nothing was written or deleted. Take over syncing to have Central Knot sync it instead.', owner: { build: 'com.centralknot.alpha', name: 'Central Knot Alpha' } });
    assert.deepEqual(await takeOverSync(preview), { from: 'Central Knot Alpha' });
    assert.equal((await syncGate(preview)).state, 'ready');
  } finally { await box.cleanup(); }
});
