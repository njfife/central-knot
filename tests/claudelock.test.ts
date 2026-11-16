// Claude Code's settings file is written holding Claude Code's own lock, the folder `.claude.json.lock` beside it, and replaced
// in one rename, never missing (mcp.ts editEntry, takeClaudeLock; share.ts writeFileChecked inPlace), as `claude mcp add` writes
// it. A stand-in for a running Claude Code takes that lock to save, as the real one does; each case is one entry written by
// Central Knot's own write path while it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { editEntry, readTool, type NeutralServer } from '../src/mcp.ts';
import type { ShareContext } from '../src/share.ts';

const docs: NeutralServer = { transport: 'stdio', command: 'npx', args: ['-y', 'docs'] };
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function home() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-claudelock-')));
  const context: ShareContext = { home: base, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const file = join(base, '.claude.json'), lock = `${file}.lock`;
  await writeFile(file, `${JSON.stringify({ numStartups: 1, mcpServers: {} }, null, 2)}\n`);
  const lockThere = () => stat(lock).then(() => true, () => false);
  const servers = async () => (await readTool(context, 'claude-cli')).entries.map(entry => entry.name);
  return { context, file, lock, lockThere, servers, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('a save Claude Code makes holding its lock is waited for: the entry is written after it, and the save is kept', async () => {
  const box = await home();
  try {
    // Claude Code takes its lock, reads the file and saves its own change from what it read, then lets the lock go.
    await mkdir(box.lock);
    const read = JSON.parse(await readFile(box.file, 'utf8'));
    const writing = editEntry(box.context, 'claude-cli', 'docs', undefined, docs);
    await sleep(150);
    assert.deepEqual(JSON.parse(await readFile(box.file, 'utf8')), read, 'nothing is written while Claude Code holds its lock');
    await writeFile(box.file, `${JSON.stringify({ ...read, numStartups: 2 }, null, 2)}\n`);
    await rmdir(box.lock);
    assert.equal(await writing, undefined, 'written once the lock is let go');
    const saved = JSON.parse(await readFile(box.file, 'utf8'));
    assert.equal(saved.numStartups, 2, 'Claude Code’s save stays');
    assert.deepEqual(Object.keys(saved.mcpServers), ['docs'], 'and so does the entry, written after it');
    assert.equal(await box.lockThere(), false);
  } finally { await box.cleanup(); }
});

test('a lock older than 10 seconds is abandoned and taken, as Claude Code takes it', async () => {
  const box = await home();
  try {
    await mkdir(box.lock);
    const tenSecondsAgo = new Date(Date.now() - 11_000);
    await utimes(box.lock, tenSecondsAgo, tenSecondsAgo);
    const started = Date.now();
    assert.equal(await editEntry(box.context, 'claude-cli', 'docs', undefined, docs), undefined);
    assert.ok(Date.now() - started < 1000, 'taken at once, not waited for');
    assert.deepEqual(await box.servers(), ['docs']);
    assert.equal(await box.lockThere(), false, 'and let go after the write');
  } finally { await box.cleanup(); }
});

test('a lock Claude Code keeps for 2 seconds leaves the file as it is, and says so; the lock beside a linked file is under the link’s name', async () => {
  const box = await home();
  try {
    // ~/.claude.json is a link into a dotfiles folder: Claude Code locks the link's own name, not its target's.
    const target = join(box.context.home, 'dotfiles', 'claude.json');
    await mkdir(join(box.context.home, 'dotfiles'));
    await writeFile(target, await readFile(box.file, 'utf8'));
    await rm(box.file);
    await symlink(target, box.file);
    const before = await readFile(target, 'utf8');
    await mkdir(box.lock);
    assert.deepEqual(await editEntry(box.context, 'claude-cli', 'docs', undefined, docs),
      { stopped: 'Claude Code is saving its settings just now. Nothing was written; the next pass tries again.', changed: true });
    assert.equal(await readFile(target, 'utf8'), before, 'the file is untouched');
    assert.equal(await box.lockThere(), true, 'Claude Code’s lock is left to it');
  } finally { await box.cleanup(); }
});

test('the lock is gone after a write and after each kind of write that fails', async () => {
  const box = await home();
  try {
    assert.equal(await editEntry(box.context, 'claude-cli', 'docs', undefined, docs), undefined);
    assert.equal(await box.lockThere(), false, 'after a write');
    // The entry is not what the pass read: nothing is written.
    assert.equal((await editEntry(box.context, 'claude-cli', 'docs', 'another-hash', undefined))?.changed, true);
    assert.equal(await box.lockThere(), false, 'after an entry that changed just now');
    // The file can't be read as JSON: nothing is written.
    await writeFile(box.file, '{ not json');
    assert.match((await editEntry(box.context, 'claude-cli', 'docs', undefined, docs))?.stopped ?? '', /could not be read as JSON/);
    assert.equal(await box.lockThere(), false, 'after a file that could not be read');
  } finally { await box.cleanup(); }
});

test('the file is never missing while it is written: checked where it is, then replaced in one rename, as Claude Code’s own saves do', async () => {
  // Claude Code also reads it outside its lock (at exit, or when the lock stays busy), and writes its older copy if it finds none.
  const box = await home(), original = { rename: fs.rename, link: fs.link }, missing: string[] = [];
  const watch = (step: 'rename' | 'link') => (async (from: string, to: string) => {
    if (!existsSync(box.file)) missing.push(`${step} ${basename(from)}`);
    return original[step](from, to);
  }) as typeof fs.rename;
  fs.rename = watch('rename'); fs.link = watch('link'); syncBuiltinESMExports();
  try { assert.equal(await editEntry(box.context, 'claude-cli', 'docs', undefined, docs), undefined); }
  finally { fs.rename = original.rename; fs.link = original.link; syncBuiltinESMExports(); }
  try {
    assert.deepEqual(missing, [], 'no step of the write found the file gone');
    assert.deepEqual(await box.servers(), ['docs']);
  } finally { await box.cleanup(); }
});

test('a save Claude Code makes without its lock just before the rename is kept: nothing is written, and the next pass tries again', async () => {
  const box = await home(), original = fs.readFile, unlocked = `${JSON.stringify({ numStartups: 9, mcpServers: {} }, null, 2)}\n`;
  let reads = 0;
  // The second read of the file is the write's own check, after the entry was read: Claude Code's exit-time save lands then.
  fs.readFile = (async (path: unknown, ...rest: unknown[]) => {
    if (String(path) === box.file && ++reads === 2) await writeFile(box.file, unlocked);
    return (original as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof fs.readFile; syncBuiltinESMExports();
  let stopped: Awaited<ReturnType<typeof editEntry>>;
  try { stopped = await editEntry(box.context, 'claude-cli', 'docs', undefined, docs); }
  finally { fs.readFile = original; syncBuiltinESMExports(); }
  try {
    assert.equal(stopped?.changed, true);
    assert.equal(await readFile(box.file, 'utf8'), unlocked, 'Claude Code’s save stays as it made it');
  } finally { await box.cleanup(); }
});
