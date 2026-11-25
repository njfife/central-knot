// On Windows a tool that is stopped is stopped with everything it started, and its run ends only after that, so that the
// folder it worked in can go: launch.ts stopTree, from plugins.ts run (git's runs and the MCP sign-in check go through it)
// and draftbase.ts run. Windows only: on macOS and Linux a tool's process group is stopped instead, as tests/draftbase.test.ts
// and tests/mcpsignin.test.ts show. Every stand-in here ends by itself after 60 s, and each test ends what it left by its
// process ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/plugins.ts';
import { draftPrompt, writeDraft, type DraftSources } from '../src/draftbase.ts';
import { standIn } from './standin.ts';

const skip = process.platform === 'win32' ? false
  : 'a tool’s tree is stopped with taskkill on Windows only; on macOS and Linux its process group is, as tests/draftbase.test.ts and tests/mcpsignin.test.ts show';

/**
 * One level of a stand-in's tree: it writes its process id to the file it is given, starts the next level while there are
 * levels below it (detached, so that only a walk of the tree reaches it), and ends by itself after 60 s. Required by a
 * stand-in, it is the top level, and `ready` runs once every level below it has written its id too.
 */
const TREE = `const fs = require('fs'), { spawn } = require('child_process');
const written = pids => fs.readFileSync(pids, 'utf8').split('\\n').filter(Boolean).length;
function level(pids, below, ready) {
  fs.appendFileSync(pids, process.pid + '\\n');
  if (below > 0) spawn(process.execPath, [__filename, pids, String(below - 1)], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => {}, 60_000);
  if (ready) { const wait = setInterval(() => { if (written(pids) > below) { clearInterval(wait); ready(); } }, 20); }
}
if (require.main === module) level(process.argv[2], Number(process.argv[3]));
module.exports = level;
`;

const isRunning = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ready: () => Promise<boolean> | boolean, tries = 250) => { for (let count = 0; count < tries && !(await ready()); count++) await new Promise(done => setTimeout(done, 20)); };

/** A test's own folder, and in it a stand-in for a tool whose tree is three processes deep. */
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-stoptree-')));
  const pids = join(base, 'pids.txt'), tree = join(base, 'tree.cjs');
  await writeFile(tree, TREE);
  const written = async () => (await readFile(pids, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(Number);
  return {
    base,
    /** The stand-in: it starts a child that starts a grandchild, each writing its process id; once all three are up it runs `then`. */
    tool: (name: string, then = '') => standIn(join(base, name), '#!/bin/sh\n', `require(${JSON.stringify(tree)})(${JSON.stringify(pids)}, 2, () => { ${then} });`),
    /** Waits for the tool, its child and its grandchild to be up, and gives their process ids. */
    up: async () => { await until(async () => (await written()).length === 3); const up = await written(); assert.equal(up.length, 3, 'the tool, its child and its grandchild are up'); return up; },
    /** None of the three is running now (the moment a stopped process takes to end allowed). */
    gone: async () => { const up = await written(); await until(() => !up.some(isRunning), 50); assert.deepEqual(up.filter(isRunning), [], 'none of the tree is left running'); },
    end: async () => {
      for (const pid of await written()) { try { process.kill(pid); } catch { /* already ended */ } }
      await rm(base, { recursive: true, force: true, maxRetries: 10 });
    },
  };
}

/** How each run is stopped: at its time limit, by its signal (Cancel, or Quit), or for saying too much. */
const STOPS = { timeout: 'at its time limit', signal: 'by its signal', output: 'for saying too much' } as const;
type Stop = keyof typeof STOPS;

for (const how of Object.keys(STOPS) as Stop[]) {
  test(`A command stopped ${STOPS[how]} ends with its child and grandchild before its run does, and the folder it ran in can go`, { skip, timeout: 20_000 }, async () => {
    const box = await sandbox();
    try {
      const folder = join(box.base, 'work');
      await mkdir(folder);
      const tool = await box.tool('tool', how === 'output' ? 'process.stdout.write("x".repeat(2000));' : '');
      const stop = new AbortController();
      const ran = run(tool, [], { cwd: folder, timeoutMs: how === 'timeout' ? 3000 : 0, signal: stop.signal, maxBytes: 1000 });
      await box.up();
      if (how === 'signal') stop.abort();
      assert.equal((await ran).code, how === 'output' ? 1 : 'timeout');
      await box.gone();
      await rm(folder, { recursive: true });
    } finally { await box.end(); }
  });
}

/** What a draft is written from here: one tool's file with instructions of its own. */
const SOURCES: DraftSources = { base: '', baseHash: '', files: [{ tool: 'claude-cli', path: join(tmpdir(), 'CLAUDE.md'), hash: 'h', own: 'Be brief.\n' }] };

for (const how of Object.keys(STOPS) as Stop[]) {
  test(`A draft’s tool stopped ${STOPS[how]} ends with its child and grandchild before the draft does, and the draft’s folder goes`, { skip, timeout: 20_000 }, async () => {
    const box = await sandbox();
    // writeDraft makes its folder in os.tmpdir(), which on Windows follows TEMP and TMP: here, a folder of this test's own.
    const temp = join(box.base, 'temp'), shared = { TEMP: process.env.TEMP, TMP: process.env.TMP };
    await mkdir(temp);
    Object.assign(process.env, { TEMP: temp, TMP: temp });
    try {
      const tool = await box.tool('pi', how === 'output' ? `process.stdout.write("x".repeat(${4 * 1024 * 1024 + 1}));` : '');
      const stop = new AbortController();
      const draft = writeDraft(SOURCES, 'pi-cli', tool, { shown: draftPrompt(SOURCES), timeoutMs: how === 'timeout' ? 3000 : 60_000, signal: stop.signal });
      await box.up();
      if (how === 'signal') stop.abort();
      assert.deepEqual(await draft, how === 'signal' ? { cancelled: true } : { stopped: 'Pi did not finish a draft in time, so it was stopped. Nothing was changed.' });
      await box.gone();
      assert.deepEqual(await readdir(temp), [], 'the draft’s folder is gone');
    } finally {
      for (const [key, value] of Object.entries(shared)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      await box.end();
    }
  });
}
