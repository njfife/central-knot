// Regressions from the Astra check of two-way skills (09db120): every displaced revision stays recoverable through crashes and
// partial failures, unreadable is never absent, retries respect resets and scope, and resets put copies back from the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { applyChanges, deleteEverywhere, readHistory } from '../src/manage.ts';
import { readRecord, storeDirectory, type ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const roots = ['.claude/skills', '.copilot/skills', '.codex/skills'];
const name = 'ck-probe';
const body = (text: string) => `---\nname: ${name}\ndescription: Disposable tester skill.\n---\n\n${text}\n`;

async function box(run: (b: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const b = await setup();
  try { await run(b); } finally { execFileSync('chmod', ['-R', 'u+rwx', b.base]); await rm(b.base, { recursive: true, force: true }); }
}
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-recovery-')));
  const home = join(base, 'home');
  let now = Date.now();
  const context: ShareContext = { home, mode: 'custom', build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), now: () => now, settleMs: 2000,
    read: () => Promise.all(tools.map(harness => discover({ home, mode: 'custom', harness }))) };
  const path = (i: number, folder = name) => join(home, roots[i], folder);
  const write = async (i: number, text: string, folder = name) => { await mkdir(path(i, folder), { recursive: true }); await writeFile(join(path(i, folder), 'SKILL.md'), body(text).replace(`name: ${name}`, `name: ${folder}`)); };
  const read = async (i: number) => readFile(join(path(i), 'SKILL.md'), 'utf8').then(text => text.split('\n\n')[1]?.trim() ?? 'PRESENT', () => null);
  const copies = () => Promise.all(tools.map((_, i) => read(i)));
  const state = async () => (await readRecord(home)).record!.items[name];
  const stored = async () => { const dir = join(storeDirectory(home), 'items', name); return Promise.all((await readdir(dir).catch(() => [] as string[])).map(hash => readFile(join(dir, hash, 'SKILL.md'), 'utf8').then(text => text.split('\n\n')[1]?.trim(), () => null))); };
  const pass = (options = {}) => applyChanges(context, [], false, options);
  for (const root of roots) await mkdir(join(home, root), { recursive: true });
  await write(0, 'BASE');
  await applyChanges(context, [{ key: name, managed: true, off: [] }]);
  await pass();
  return { base, home, context, path, write, read, copies, state, stored, pass, tick: (ms: number) => { now += ms; } };
}
const reload = async (tag: string) => (await import(`../src/manage.ts?restart=${tag}`)) as typeof import('../src/manage.ts');

test('A destination edited while it is being replaced keeps that work, and it spreads next', () => box(async b => {
  await b.write(0, 'SOURCE EDIT');
  let injected = false;
  await applyChanges({ ...b.context, fault: step => { if (step === 'before-replace' && !injected) { injected = true; writeFileSync(join(b.path(1), 'SKILL.md'), body('TARGET CONCURRENT WORK')); } } }, []);
  assert.ok(injected);
  assert.equal(await b.read(1), 'TARGET CONCURRENT WORK', 'the concurrent edit is left in place');
  await b.pass();
  const all = [...await b.copies(), ...await b.stored()];
  assert.ok(all.includes('TARGET CONCURRENT WORK') && all.includes('SOURCE EDIT'), JSON.stringify(all));
}));

test('A crash between destinations of a chosen copy never loses a replaced copy', () => box(async b => {
  await b.write(1, 'COPILOT UNIQUE');
  await b.write(2, 'CODEX UNIQUE');
  let count = 0;
  await assert.rejects(applyChanges({ ...b.context, fault: step => { if (step === 'before-replace' && ++count === 2) throw new Error('fault: process died'); } }, [{ key: name, managed: true, off: [], use: 'claude-cli' }]), /fault/);
  const restarted = await reload('chosen');
  await restarted.applyChanges(b.context, []);
  await restarted.applyChanges(b.context, []);
  const stored = await b.stored();
  assert.ok(stored.includes('COPILOT UNIQUE') && stored.includes('CODEX UNIQUE'), JSON.stringify(stored));
  const history = await readHistory(b.context);
  assert.ok(history.some(entry => entry.losers.some(loser => loser.tool === 'copilot-cli')) && history.some(entry => entry.losers.some(loser => loser.tool === 'codex-cli')), 'History names both, so neither is pruned');
}));

test('A crash while settling competing edits never loses an overwritten edit', () => box(async b => {
  await b.write(1, 'COPILOT UNIQUE');
  await b.write(2, 'CODEX UNIQUE');
  await b.write(0, 'CLAUDE UNIQUE');
  let count = 0;
  await assert.rejects(applyChanges({ ...b.context, fault: step => { if (step === 'before-replace' && ++count === 2) throw new Error('fault: process died'); } }, []), /fault/);
  const restarted = await reload('conflict');
  await restarted.applyChanges(b.context, []);
  await restarted.applyChanges(b.context, []);
  const stored = await b.stored();
  for (const text of ['COPILOT UNIQUE', 'CODEX UNIQUE', 'CLAUDE UNIQUE']) assert.ok(stored.includes(text), `${text} kept: ${JSON.stringify(stored)}`);
}));

test('A Delete everywhere that fails part-way keeps the unspread edit restorable and finishes later', () => box(async b => {
  await b.write(0, 'UNSPREAD UNIQUE WORK');
  await chmod(join(b.home, roots[1]), 0o555);
  await deleteEverywhere(b.context, name);
  await b.pass();
  b.tick(2500);
  await b.pass();
  assert.ok((await b.stored()).includes('UNSPREAD UNIQUE WORK'));
  const deleted = (await readHistory(b.context)).filter(entry => entry.kind === 'deleted');
  assert.ok(deleted.length >= 1);
  assert.equal((await b.state()).copies.find(copy => copy.harness === 'copilot-cli')?.status, 'removing');
  await chmod(join(b.home, roots[1]), 0o755);
  await b.pass();
  assert.deepEqual(await b.copies(), [null, null, null], 'the leftover goes once it can');
}));

test('An unlistable skills folder, or every one at once, is never a deletion', () => box(async b => {
  await chmod(join(b.home, roots[0]), 0o111);
  await b.pass();
  b.tick(2500);
  await b.pass();
  await chmod(join(b.home, roots[0]), 0o755);
  assert.deepEqual(await b.copies(), ['BASE', 'BASE', 'BASE']);
  assert.equal((await b.state()).state, 'shared');
  for (const root of roots) await chmod(join(b.home, root), 0o111);
  await b.pass();
  b.tick(2500);
  await b.pass();
  for (const root of roots) await chmod(join(b.home, root), 0o755);
  assert.equal((await b.state()).state, 'shared');
  assert.ok(!(await readHistory(b.context)).some(entry => entry.kind === 'deleted'));
}));

test('A SKILL.md broken for a moment holds the skill instead of deleting it elsewhere', () => box(async b => {
  await writeFile(join(b.path(0), 'SKILL.md'), '---\nname: [unfinished\n---\nWORK IN PROGRESS\n');
  await b.pass();
  b.tick(2500);
  const result = await b.pass();
  assert.deepEqual((await b.copies()).slice(1), ['BASE', 'BASE']);
  assert.equal((await b.state()).state, 'shared');
  assert.ok(result.results.some(entry => /could not be read as a skill/.test(entry.message)), JSON.stringify(result.results));
}));

test('Every folder restored from the same older backup catches up to the newest content', () => box(async b => {
  await b.write(0, 'VERSION TWO');
  await b.pass();
  for (let i = 0; i < 3; i++) { await rename(join(b.home, roots[i]), join(b.home, `${roots[i]}-old`)); await b.write(i, 'BASE'); }
  await b.pass();
  assert.deepEqual(await b.copies(), ['VERSION TWO', 'VERSION TWO', 'VERSION TWO']);
}));

async function failedDeletion(b: Awaited<ReturnType<typeof setup>>) {
  await chmod(join(b.home, roots[1]), 0o555);
  await rm(b.path(0), { recursive: true });
  await b.pass();
  b.tick(2500);
  await b.pass();
  assert.equal((await b.state()).copies.find(copy => copy.harness === 'copilot-cli')?.status, 'removing');
  assert.equal(await b.read(2), null, 'the others still go');
}

test('An unfinished deletion never removes a copy installed again in a folder made again', () => box(async b => {
  await failedDeletion(b);
  await chmod(join(b.home, roots[1]), 0o755);
  await rename(join(b.home, roots[1]), join(b.home, `${roots[1]}-old`));
  await b.write(1, 'BASE');
  await b.pass();
  assert.equal(await b.read(1), 'BASE');
}));

test('With Sync off, Apply all for one skill never finishes another skill’s deletion', () => box(async b => {
  await failedDeletion(b);
  await chmod(join(b.home, roots[1]), 0o755);
  await b.write(0, 'OTHER', 'ck-other');
  await applyChanges(b.context, [{ key: 'ck-other', managed: true, off: [] }], false, { only: new Set(['ck-other']) });
  assert.equal(await b.read(1), 'BASE');
}));

test('Every skills folder made again empty puts the skill back from the store', () => box(async b => {
  for (const root of roots) { await rename(join(b.home, root), join(b.home, `${root}-old`)); await mkdir(join(b.home, root)); }
  await b.pass();
  await b.pass();
  b.tick(2500);
  await b.pass();
  assert.equal((await b.state()).state, 'shared');
  assert.deepEqual(await b.copies(), ['BASE', 'BASE', 'BASE']);
}));

// ---------- From the Opus fourth check (09db120) ----------

test('Use this copy with one destination read-only still records the replaced copies, with Undo, and does not retry forever', () => box(async b => {
  await b.write(1, 'COPILOT VERSION');
  await b.write(2, 'CODEX VERSION');
  await b.write(0, 'CLAUDE VERSION');
  await chmod(b.path(2), 0o555);
  await chmod(join(b.home, roots[2]), 0o555);
  const result = await applyChanges(b.context, [{ key: name, managed: true, off: [], use: 'copilot-cli' }]);
  assert.ok(result.results.some(entry => entry.harness === 'codex-cli' && entry.outcome === 'failed'), JSON.stringify(result.results));
  assert.equal(await b.read(0), 'COPILOT VERSION');
  const chosen = (await readHistory(b.context)).find(entry => entry.kind === 'chosen');
  assert.ok(chosen?.losers.some(loser => loser.tool === 'claude-cli'), 'History names the replaced Claude copy');
  assert.equal((await b.state()).use, undefined, 'the choice is finished, not retried every pass');
  await b.write(0, 'ANOTHER SKILL', 'ck-other');
  await applyChanges(b.context, [{ key: 'ck-other', managed: true, off: [] }]);
  assert.ok((await b.stored()).includes('CLAUDE VERSION'), 'still kept after another skill writes History');
}));

test('An edit saved just as a deletion spreads is kept, not removed', () => box(async b => {
  await rm(b.path(0), { recursive: true });
  await b.pass();
  b.tick(2500);
  let injected = false;
  await applyChanges({ ...b.context, fault: step => { if (step === 'before-remove' && !injected) { injected = true; writeFileSync(join(b.path(1), 'SKILL.md'), body('SAVED JUST NOW')); } } }, []);
  assert.ok(injected);
  assert.equal(await b.read(1), 'SAVED JUST NOW');
}));

test('A held skill never keeps a folder "reset": a later deletion there still spreads', () => box(async b => {
  await b.write(0, 'OTHER', 'ck-other');
  await applyChanges(b.context, [{ key: 'ck-other', managed: true, off: [] }]);
  await b.pass();
  // ck-probe becomes held in Claude (a link inside), then Claude's skills folder is made again with the same contents.
  const claude = join(b.home, roots[0]);
  await rename(claude, `${claude}-old`);
  await mkdir(claude);
  await b.write(0, 'BASE');
  await b.write(0, 'OTHER', 'ck-other');
  execFileSync('ln', ['-s', '/tmp', join(b.path(0), 'link')]);
  await b.pass();
  await b.pass();
  await rm(join(claude, 'ck-other'), { recursive: true });
  await b.pass();
  b.tick(2500);
  await b.pass();
  assert.equal(await readFile(join(b.home, roots[1], 'ck-other', 'SKILL.md'), 'utf8').catch(() => null), null, 'the deletion spread instead of being put back');
}));

test('Each competing edit that lost can be put back from History', () => box(async b => {
  await b.write(1, 'COPILOT EDIT');
  await b.write(2, 'CODEX EDIT');
  await b.write(0, 'CLAUDE EDIT');
  await b.pass();
  const conflict = (await readHistory(b.context)).find(entry => entry.kind === 'conflict')!;
  assert.ok(conflict);
  const { restorableChoices, restoreFromHistory } = await import('../src/manage.ts');
  const options = restorableChoices(conflict);
  assert.equal(options.length, 2, JSON.stringify(conflict));
  const last = options[1];
  await restoreFromHistory(b.context, conflict.id, false, last.hash);
  const expected = (await b.copies())[0];
  assert.deepEqual(await b.copies(), [expected, expected, expected]);
  assert.ok(['CLAUDE EDIT', 'CODEX EDIT'].includes(expected!), expected!);
}));

test('Editor swap and lock files are not edits', () => box(async b => {
  await writeFile(join(b.path(0), '.SKILL.md.swp'), 'vim swap');
  await writeFile(join(b.path(0), 'SKILL.md~'), 'backup');
  const result = await b.pass();
  assert.equal(result.harnessWrites, 0, JSON.stringify(result.results));
}));

test('An unfinished deletion stops when the skill is put back by hand in another tool', () => box(async b => {
  await failedDeletion(b);
  await chmod(join(b.home, roots[1]), 0o755);
  await b.write(0, 'BASE');
  await b.pass();
  assert.equal(await b.read(1), 'BASE', 'the kept identical copy is not removed');
  assert.equal(await b.read(0), 'BASE');
}));

test('An edit whose spread failed at first is still History, so the version it replaced can be restored after the catch-up', () => box(async b => {
  await b.write(0, 'EDITED');
  await chmod(b.path(1), 0o555);
  await chmod(join(b.home, roots[1]), 0o555);
  await chmod(b.path(2), 0o555);
  await chmod(join(b.home, roots[2]), 0o555);
  await b.pass();
  for (const i of [1, 2]) { await chmod(join(b.home, roots[i]), 0o755); await chmod(b.path(i), 0o755); }
  await b.pass();
  assert.deepEqual(await b.copies(), ['EDITED', 'EDITED', 'EDITED']);
  const edit = (await readHistory(b.context)).find(entry => entry.kind === 'edit');
  assert.ok(edit, 'the edit is in History');
  assert.ok((await b.stored()).includes('BASE'), 'and the version it replaced is kept');
}));
