// On Windows a file another program has open for a moment (an antivirus scan of a file just written; Claude Code's own
// .claude.json) can't be renamed over (EPERM) or moved away (EBUSY), and a folder can't be moved while a file in it is so held.
// Each step of a write tries again for about a second (share.ts retryWhileHeld) and never writes over a save made while it
// waits; a refusal that stays is said in words (share.ts plainError). The worked examples run on Windows on real files, held
// two ways: open in this process, as Node opens a file (a rename over it is refused), or open in a PowerShell child that lets
// it be read and written but not moved (moving it, or its folder, is refused); each is let go 300 ms after the first refusal
// is seen. A save landing between two tries, and a refusal of one call, are stood in for by replacing fs's own function. The
// helper's own rule and the words, which name the platform they stand for, are checked first, everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs, { chmod, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { editEntry, readTool, type NeutralServer } from '../src/mcp.ts';
import {
  errorCode, placeCopy, plainError, readTree, recoverParked, removeFileChecked, retryWhileHeld, writeDurably, writeFileChecked, type ShareContext,
} from '../src/share.ts';
import { recoverFolders, removeFolder, swapFolder } from '../src/skillfiles.ts';
import { within } from './within.ts';

const windowsOnly = process.platform !== 'win32'
  && 'only Windows refuses a rename or a move of a file another program has open; on macOS and Linux each step is called once (the checks naming the platform, and the file operations the unit suite records: tests/spawnlog.mjs)';
const HELD = 'Windows couldn’t change this file or folder. Check whether it’s in use or read-only and whether you have permission, then try again.';
const docs: NeutralServer = { transport: 'stdio', command: 'npx', args: ['-y', 'docs'] };
type Step = 'rename' | 'link' | 'unlink';
type Call = (...args: unknown[]) => Promise<unknown>;

/** A made-up home: Claude Code's settings file with no server, a skill in Claude Code's skills folder, and a tool's file in a folder of its own. */
async function home() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-heldfile-'))), home = join(base, 'home');
  const skill = join(home, '.claude', 'skills', 'review'), folder = join(base, 'tool');
  await mkdir(skill, { recursive: true });
  await mkdir(folder);
  await writeFile(join(skill, 'SKILL.md'), '---\nname: review\ndescription: Reviews.\n---\nBefore.\n');
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const file = join(home, '.claude.json'), before = `${JSON.stringify({ numStartups: 1, mcpServers: {} }, null, 2)}\n`;
  await writeFile(file, before);
  const tool = join(folder, 'config.toml');
  await writeFile(tool, 'before\n');
  const servers = async () => (await readTool(context, 'claude-cli')).entries.map(entry => entry.name);
  const listed = async (path: string) => (await readdir(path)).sort();
  return { base, home, context, file, before, skill, folder, tool, servers, listed, cleanup: () => rm(base, { recursive: true, force: true }) };
}

/** Another program holding `path` open as Node itself opens a file, letting it be moved: a rename over it is refused. */
async function holdOpen(path: string) {
  const handle = await open(path, 'r');
  return () => handle.close();
}

/** Another program (a PowerShell child) holding `path` open for reading and writing but not for moving: moving it, or its folder, is refused. */
async function holdUnmovable(path: string) {
  const script = '$f = [IO.File]::Open($env:CK_HOLD, "Open", "ReadWrite", "ReadWrite"); try { [Console]::Out.WriteLine("ready"); [Console]::Out.Flush(); [void][Console]::In.ReadLine() } finally { $f.Dispose() }';
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, CK_HOLD: path }, stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise(done => child.once('exit', done));
  await within(`PowerShell holding ${basename(path)}`, new Promise<void>((ready, fail) => {
    child.stdout.on('data', chunk => { if (String(chunk).includes('ready')) ready(); });
    child.once('error', fail);
    child.once('exit', code => fail(new Error(`PowerShell ended (${code}) before holding the file`)));
  }));
  return async () => { child.stdin.end('\n'); await exited; };
}

/** Replaces fs's own `step`; the returned function restores it. */
function standIn(step: Step, call: (original: Call, ...args: unknown[]) => Promise<unknown>) {
  const original = fs[step] as unknown as Call;
  (fs as unknown as Record<Step, Call>)[step] = (...args) => call(original, ...args);
  syncBuiltinESMExports();
  return () => { (fs as unknown as Record<Step, Call>)[step] = original; syncBuiltinESMExports(); };
}

/** Watches `step` for the first call Windows refuses (EPERM, EBUSY): the moment a hold's 300 ms start. */
function firstRefusal(step: Step) {
  let seen!: () => void;
  const refused = new Promise<void>(done => { seen = done; });
  const restore = standIn(step, async (original, ...args) => {
    try { return await original(...args); } catch (error) { if (['EPERM', 'EBUSY'].includes(errorCode(error))) seen(); throw error; }
  });
  return { refused, restore };
}

/**
 * Runs `write` while a file is held: once a step is refused, `meanwhile` (a save made while the write waits), then 300 ms on,
 * the holder lets go. The write's own outcome comes back once both are over, so nothing is cleaned up while the file is held.
 */
async function whileHeld<T>(write: Promise<T>, refused: Promise<void>, release: () => Promise<void>, meanwhile = async () => {}): Promise<T> {
  const hold = within('a step refused while the file is held', refused).then(meanwhile).then(() => sleep(300)).finally(release);
  const [written, held] = await Promise.allSettled([write, hold]);
  if (written.status === 'rejected') throw written.reason;
  if (held.status === 'rejected') throw held.reason;
  return written.value;
}

/** Refuses the first call of `step` that `matches` its paths with `code`, as Windows refuses a held file, `meanwhile` landing first; `times` such calls in all. */
function refuse(step: Step, code: 'EPERM' | 'EBUSY', matches: (paths: string[]) => boolean, meanwhile = async (_paths: string[]) => {}, times = 1) {
  let left = times;
  return standIn(step, async (original, ...args) => {
    const paths = args.slice(0, step === 'unlink' ? 1 : 2).map(String);
    if (left <= 0 || !matches(paths)) return original(...args);
    left--;
    await meanwhile(paths);
    throw Object.assign(new Error(`${step} refused`), { code });
  });
}
/** A skill folder named like the made-up home's, with a newer SKILL.md. */
async function newerSkill(base: string) {
  const source = join(base, 'source', 'review');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: review\ndescription: Reviews.\n---\nAfter.\n');
  return source;
}
/** The file a write moved aside in `folder`. */
const moved = async (folder: string) => join(folder, (await readdir(folder)).find(name => name.endsWith('.old'))!);

const refusal = (code: string) => Object.assign(new Error(code), { code });

test('off Windows a change is called once and is its own promise: a refusal comes back as it came, and nothing is asked or waited for', async () => {
  for (const platform of ['darwin', 'linux'] as const) {
    let calls = 0, asked = 0;
    const done = Promise.resolve('done'), held = refusal('EPERM'), refused = Promise.reject(held);
    assert.equal(retryWhileHeld(() => done, undefined, platform), done);
    assert.equal(retryWhileHeld(() => { calls++; return refused; }, async () => { asked++; }, platform), refused);
    await assert.rejects(refused, error => error === held);
    assert.deepEqual([calls, asked], [1, 0]);
  }
});

test('on Windows a change refused with EPERM or EBUSY is tried again 100, 200, 300 and 400 ms apart, five tries in all, then the last refusal comes back', async () => {
  const refusals: Error[] = [], at: number[] = [];
  const change = async () => { at.push(Date.now()); refusals.push(refusal(refusals.length % 2 ? 'EBUSY' : 'EPERM')); throw refusals.at(-1); };
  await assert.rejects(retryWhileHeld(change, undefined, 'win32'), error => error === refusals[4]);
  const gaps = at.slice(1).map((time, index) => time - at[index]!);
  assert.equal(refusals.length, 5);
  assert.ok([100, 200, 300, 400].every((wait, index) => gaps[index]! >= wait - 10), `gaps ${gaps.join(', ')} ms`);
  assert.ok(at.at(-1)! - at[0]! < 1500, `gaps ${gaps.join(', ')} ms`);
});

test('on Windows a change refused for another reason comes back at once; one that lands on a later try lands; a check that no longer holds ends the wait with its own error', async () => {
  for (const code of ['ENOENT', 'EACCES', 'EEXIST']) {
    let calls = 0;
    await assert.rejects(retryWhileHeld(async () => { calls++; throw refusal(code); }, undefined, 'win32'), { code });
    assert.equal(calls, 1, code);
  }
  let calls = 0, asked = 0;
  assert.equal(await retryWhileHeld(async () => { if (++calls < 3) throw refusal('EBUSY'); return 'landed'; }, async () => { asked++; }, 'win32'), 'landed');
  assert.deepEqual([calls, asked], [3, 2], 'the check is asked before each further try');
  calls = 0;
  await assert.rejects(retryWhileHeld(async () => { calls++; throw refusal('EPERM'); }, async () => { throw refusal('CK_CHANGED'); }, 'win32'), { code: 'CK_CHANGED' });
  assert.equal(calls, 1, 'no try after the check fails');
});

test('a refusal Windows gives for a file held, read-only or not permitted is said in one sentence there; elsewhere the words are as before', () => {
  assert.equal(plainError(refusal('EPERM'), 'win32'), HELD);
  assert.equal(plainError(refusal('EBUSY'), 'win32'), HELD);
  assert.equal(plainError(refusal('EACCES'), 'win32'), 'Permission was denied.');
  for (const platform of ['darwin', 'linux'] as const) {
    assert.equal(plainError(refusal('EPERM'), platform), 'Permission was denied.');
    assert.equal(plainError(refusal('EACCES'), platform), 'Permission was denied.');
    assert.equal(plainError(refusal('EBUSY'), platform), 'It could not finish.');
  }
});

test('Claude Code’s settings file held open by another program for 300 ms while an MCP entry is written: the entry lands once it is let go, on what was there', { skip: windowsOnly }, async () => {
  const box = await home(), watch = firstRefusal('rename');
  try {
    const release = await holdOpen(box.file);
    const result = await whileHeld(editEntry(box.context, 'claude-cli', 'docs', undefined, docs), watch.refused, release);
    assert.equal(result, undefined, JSON.stringify(result));
    assert.deepEqual(await box.servers(), ['docs']);
    assert.equal(JSON.parse(await readFile(box.file, 'utf8')).numStartups, 1, 'what was there stays');
    assert.deepEqual(await box.listed(box.home), ['.claude', '.claude.json'], 'no temporary file or lock left');
  } finally { watch.restore(); await box.cleanup(); }
});

test('a save the holding program makes while the entry waits is never written over: nothing is written, and it says the file changed just now', { skip: windowsOnly }, async () => {
  const box = await home(), watch = firstRefusal('rename'), saved = `${JSON.stringify({ numStartups: 2, mcpServers: {} }, null, 2)}\n`;
  try {
    const release = await holdOpen(box.file);
    const result = await whileHeld(editEntry(box.context, 'claude-cli', 'docs', undefined, docs), watch.refused, release, () => writeFile(box.file, saved));
    assert.equal(result?.changed, true, JSON.stringify(result));
    assert.equal(await readFile(box.file, 'utf8'), saved);
    assert.deepEqual(await box.listed(box.home), ['.claude', '.claude.json']);
  } finally { watch.restore(); await box.cleanup(); }
});

test('a tool’s file held so it can’t be moved aside, and saved while the write waits: the save stays, and the write says it changed just now', { skip: windowsOnly }, async () => {
  const box = await home(), watch = firstRefusal('rename');
  try {
    const release = await holdUnmovable(box.tool);
    const saved = () => writeFile(box.tool, 'saved meanwhile\n');
    await whileHeld(assert.rejects(writeFileChecked(box.tool, 'written\n', 'before\n'), { code: 'CK_CHANGED' }), watch.refused, release, saved);
    assert.equal(await readFile(box.tool, 'utf8'), 'saved meanwhile\n');
    assert.deepEqual(await box.listed(box.folder), ['config.toml'], 'nothing moved aside or temporary is left');
  } finally { watch.restore(); await box.cleanup(); }
});

test('Claude Code’s settings file that stays held: the write gives up after about a second in plain words, the file as it was; once let go, the next try lands', { skip: windowsOnly }, async () => {
  const box = await home();
  try {
    const release = await holdOpen(box.file), started = Date.now();
    let result: Awaited<ReturnType<typeof editEntry>>;
    try { result = await editEntry(box.context, 'claude-cli', 'docs', undefined, docs); } finally { await release(); }
    const took = Date.now() - started;
    assert.equal(result?.stopped, `Could not write Claude Code's settings file. ${HELD}`);
    assert.ok(took >= 990 && took < 2500, `gave up after ${took} ms`);
    assert.equal(await readFile(box.file, 'utf8'), box.before, 'nothing half-written');
    assert.deepEqual(await box.listed(box.home), ['.claude', '.claude.json'], 'no temporary file or lock left');
    assert.equal(await editEntry(box.context, 'claude-cli', 'docs', undefined, docs), undefined);
    assert.deepEqual(await box.servers(), ['docs']);
  } finally { await box.cleanup(); }
});

test('a tool’s file that stays held so it can’t be moved aside: the write gives up in plain words, nothing moved; recovery finds nothing to do; once let go, the next try lands', { skip: windowsOnly }, async () => {
  const box = await home();
  try {
    const release = await holdUnmovable(box.tool);
    let refusal: unknown;
    try { await writeFileChecked(box.tool, 'written\n', 'before\n').catch(error => { refusal = error; }); } finally { await release(); }
    assert.equal(errorCode(refusal), 'EBUSY');
    assert.equal(plainError(refusal), HELD);
    assert.equal(await readFile(box.tool, 'utf8'), 'before\n');
    assert.deepEqual(await box.listed(box.folder), ['config.toml']);
    await recoverParked(box.folder);
    assert.deepEqual(await box.listed(box.folder), ['config.toml']);
    await writeFileChecked(box.tool, 'written\n', 'before\n');
    assert.equal(await readFile(box.tool, 'utf8'), 'written\n');
  } finally { await box.cleanup(); }
});

test('a tool’s file held 300 ms can be written, then held 300 ms again, removed', { skip: windowsOnly }, async () => {
  const box = await home();
  try {
    for (const step of [() => writeFileChecked(box.tool, 'written\n', 'before\n'), () => removeFileChecked(box.tool, 'written\n')]) {
      const watch = firstRefusal('rename'), release = await holdUnmovable(box.tool);
      try { await whileHeld(step(), watch.refused, release); } finally { watch.restore(); }
    }
    assert.deepEqual(await box.listed(box.folder), []);
  } finally { await box.cleanup(); }
});

test('a skill’s folder with its SKILL.md held 300 ms can be written over, then held 300 ms again, removed', { skip: windowsOnly }, async () => {
  const box = await home(), claude = join(box.home, '.claude');
  try {
    const source = await newerSkill(box.base);
    const held = async (step: (expected: string) => Promise<void>) => {
      const expected = (await readTree(box.skill)).hash, watch = firstRefusal('rename'), release = await holdUnmovable(join(box.skill, 'SKILL.md'));
      try { await whileHeld(step(expected), watch.refused, release); } finally { watch.restore(); }
    };
    await held(expected => swapFolder(box.context, source, box.skill, expected));
    assert.match(await readFile(join(box.skill, 'SKILL.md'), 'utf8'), /After\./);
    assert.deepEqual(await box.listed(claude), ['skills'], 'nothing moved aside, staged or noted is left');
    await held(expected => removeFolder(box.context, box.skill, expected));
    assert.deepEqual(await box.listed(join(claude, 'skills')), []);
    assert.deepEqual(await box.listed(claude), ['skills']);
  } finally { await box.cleanup(); }
});

test('a skill’s folder that stays held: the write gives up in plain words, the copy as it was with nothing moved aside or staged; recovery leaves it so', { skip: windowsOnly }, async () => {
  const box = await home(), claude = join(box.home, '.claude');
  try {
    const source = await newerSkill(box.base), expected = (await readTree(box.skill)).hash, release = await holdUnmovable(join(box.skill, 'SKILL.md'));
    let refusal: unknown;
    try { await swapFolder(box.context, source, box.skill, expected).catch(error => { refusal = error; }); } finally { await release(); }
    assert.equal(plainError(refusal), HELD, `refused with ${errorCode(refusal)}`);
    assert.match(await readFile(join(box.skill, 'SKILL.md'), 'utf8'), /Before\./);
    // The note written before the move stays: recovery reads notes only beside a folder moved aside (the report's "Seen, not done").
    const leftBeside = async () => (await box.listed(claude)).map(name => name.replace(/[0-9a-f-]{36}/, '<id>'));
    assert.deepEqual(await leftBeside(), ['.ck-parked-<id>.json', 'skills']);
    await recoverFolders(box.context, 'claude-cli');
    assert.deepEqual(await leftBeside(), ['.ck-parked-<id>.json', 'skills']);
    assert.match(await readFile(join(box.skill, 'SKILL.md'), 'utf8'), /Before\./);
  } finally { await box.cleanup(); }
});

test('Central Knot’s own record held open by another program for 300 ms: it is written once let go', { skip: windowsOnly }, async () => {
  const box = await home(), record = join(box.home, '.central-knot', 'history.json'), watch = firstRefusal('rename');
  try {
    await mkdir(join(box.home, '.central-knot'));
    await writeFile(record, '{"events":[]}\n');
    const release = await holdOpen(record);
    await whileHeld(writeDurably(record, '{"events":[1]}\n'), watch.refused, release);
    assert.equal(await readFile(record, 'utf8'), '{"events":[1]}\n');
    assert.deepEqual(await box.listed(join(box.home, '.central-knot')), ['history.json']);
  } finally { watch.restore(); await box.cleanup(); }
});

test('a read-only settings file: refused for about a second, then the same plain words, nothing changed and nothing left beside it', { skip: windowsOnly }, async () => {
  const box = await home();
  // Node's chmod on Windows sets or clears the file's read-only attribute, which is what is measured here (no folder is locked).
  await chmod(box.file, 0o444);
  try {
    const started = Date.now(), result = await editEntry(box.context, 'claude-cli', 'docs', undefined, docs), took = Date.now() - started;
    assert.equal(result?.stopped, `Could not write Claude Code's settings file. ${HELD}`);
    assert.ok(took >= 990 && took < 2500, `gave up after ${took} ms`);
    assert.equal(await readFile(box.file, 'utf8'), box.before);
    assert.deepEqual(await box.listed(box.home), ['.claude', '.claude.json']);
  } finally { await chmod(box.file, 0o666); await box.cleanup(); }
});

test('a link refused once, and a save landing in the emptied place meanwhile: the save stays, and the file as read is kept beside it as a backup', { skip: windowsOnly }, async () => {
  const box = await home();
  const restore = refuse('link', 'EBUSY', ([, to]) => to === box.tool, () => writeFile(box.tool, 'saved meanwhile\n'));
  try { await assert.rejects(writeFileChecked(box.tool, 'written\n', 'before\n'), { code: 'CK_CHANGED' }); } finally { restore(); }
  try {
    assert.equal(await readFile(box.tool, 'utf8'), 'saved meanwhile\n');
    const [file, backup, ...rest] = await box.listed(box.folder);
    assert.deepEqual([file, rest], ['config.toml', []]);
    assert.match(backup ?? '', /^config\.toml\.central-knot-.+\.bak$/);
    assert.equal(await readFile(join(box.folder, backup!), 'utf8'), 'before\n');
  } finally { await box.cleanup(); }
});

test('a link refused once while the holding program changes the moved-aside original: the change goes back in place, and the write says it changed just now', { skip: windowsOnly }, async () => {
  const box = await home();
  const restore = refuse('link', 'EBUSY', ([, to]) => to === box.tool, async () => writeFile(await moved(box.folder), 'changed meanwhile\n'));
  try { await assert.rejects(writeFileChecked(box.tool, 'written\n', 'before\n'), { code: 'CK_CHANGED' }); } finally { restore(); }
  try {
    assert.equal(await readFile(box.tool, 'utf8'), 'changed meanwhile\n');
    assert.deepEqual(await box.listed(box.folder), ['config.toml']);
  } finally { await box.cleanup(); }
});

test('the moved-aside original changed while its removal waits: the new file stays, and the change is kept beside it as a backup', { skip: windowsOnly }, async () => {
  const box = await home();
  const restore = refuse('unlink', 'EBUSY', ([path]) => path!.endsWith('.old'), ([path]) => writeFile(path!, 'changed meanwhile\n'));
  try { await writeFileChecked(box.tool, 'written\n', 'before\n'); } finally { restore(); }
  try {
    assert.equal(await readFile(box.tool, 'utf8'), 'written\n');
    const [file, backup, ...rest] = await box.listed(box.folder);
    assert.deepEqual([file, rest], ['config.toml', []]);
    assert.equal(await readFile(join(box.folder, backup ?? 'none'), 'utf8'), 'changed meanwhile\n');
  } finally { await box.cleanup(); }
});

test('a removal that waits on the moved-aside file while it changes: it goes back, and the removal says it changed just now', { skip: windowsOnly }, async () => {
  const box = await home();
  const restore = refuse('unlink', 'EBUSY', ([path]) => path!.endsWith('.old'), ([path]) => writeFile(path!, 'changed meanwhile\n'));
  try { await assert.rejects(removeFileChecked(box.tool, 'before\n'), { code: 'CK_CHANGED' }); } finally { restore(); }
  try {
    assert.equal(await readFile(box.tool, 'utf8'), 'changed meanwhile\n');
    assert.deepEqual(await box.listed(box.folder), ['config.toml']);
  } finally { await box.cleanup(); }
});

for (const there of [true, false]) {
  test(`with no hard links, the rename that replaces them waits too, and stops where a save lands meanwhile (${there ? 'a file there' : 'no file there'})`, { skip: windowsOnly }, async () => {
    const box = await home();
    if (!there) await rm(box.tool);
    const noLinks = refuse('link', 'EPERM', ([from]) => from!.endsWith('.tmp'), undefined, Infinity);
    const restore = refuse('rename', 'EPERM', ([from]) => from!.endsWith('.tmp'), () => writeFile(box.tool, 'saved meanwhile\n'));
    try { await assert.rejects(writeFileChecked(box.tool, 'written\n', there ? 'before\n' : undefined), { code: 'CK_CHANGED' }); } finally { restore(); noLinks(); }
    try {
      assert.equal(await readFile(box.tool, 'utf8'), 'saved meanwhile\n');
      assert.deepEqual(await box.listed(box.folder), ['config.toml']);
    } finally { await box.cleanup(); }
  });
}

test('a skill’s copy whose place fills while its placement waits: what is there stays, and nothing staged is left', { skip: windowsOnly }, async () => {
  const box = await home(), target = join(box.home, '.claude', 'skills', 'fresh');
  const restore = refuse('rename', 'EPERM', ([from, to]) => basename(from!).startsWith('.ck-stage-') && to === target, async () => {
    await mkdir(target);
    await writeFile(join(target, 'SKILL.md'), 'made meanwhile\n');
  });
  try {
    const tree = await readTree(box.skill);
    await assert.rejects(placeCopy(box.context, box.skill, { harness: 'claude-cli', directory: target, limits: [] }, tree), { code: 'CK_EXISTS' });
  } finally { restore(); }
  try {
    assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'made meanwhile\n');
    assert.deepEqual(await box.listed(join(box.home, '.claude')), ['skills']);
  } finally { await box.cleanup(); }
});
