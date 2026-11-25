// The recorder of every program the unit tests start or stop (tests/spawnlog.mjs), as worked examples: what it keeps of a
// start (the environment the program was given, every option, and a stand-in's bytes) and of a change to a file (its paths
// and how it ended), and that its comparison tells two runs apart by any one of them, and by any path but a temporary
// folder's random ending. It proves macOS and Linux
// unchanged, so it is run there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const skip = process.platform === 'win32' && 'the recorder proves macOS and Linux unchanged (its stand-ins are made executable by chmod); it is run there';
const recorder = join(import.meta.dirname, 'spawnlog.mjs');
/**
 * What a run does: it makes a stand-in (`script`, its shell text) in a folder of its own (mkdtemp) and starts it with `env`
 * and `options`; with `helper`, it then starts a helper process, recorded too, as a test starts a fixture server: a Node that
 * starts a program in `<that folder>/<helper>/bin`, named there in its environment too.
 */
interface Run { script?: string; env?: Record<string, string>; options?: Record<string, unknown>; helper?: string; moves?: string }
const RUN = `
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standIn } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'standin.ts')).href)};
const { script = '#!/bin/sh\\nexit 0\\n', env = { PROBE: 'one' }, options = { windowsHide: true }, helper, moves } = JSON.parse(process.argv[2]);
const folder = mkdtempSync(join(tmpdir(), 'ck-spawnlog-tool-'));
const tool = await standIn(join(folder, 'tool'), script, '');
spawnSync(tool, ['--version'], { env: { PATH: process.env.PATH, ...env }, ...options });
if (helper) {
  const bin = join(folder, helper, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(folder, 'helper.mjs'), 'import { spawnSync } from "node:child_process"; spawnSync(process.execPath, ["-e", ""], { cwd: '
    + JSON.stringify(bin) + ', env: { PATH: process.env.PATH, TOOL_HOME: ' + JSON.stringify(bin) + ' } });');
  spawnSync(process.execPath, ['--import', ${JSON.stringify(recorder)}, join(folder, 'helper.mjs')]);
}
if (moves) {
  const { rename, unlink, writeFile } = await import('node:fs/promises');
  await writeFile(join(folder, 'a'), 'a');
  await rename(join(folder, 'a'), join(folder, moves));
  await unlink(join(folder, 'gone')).catch(() => undefined);
}
rmSync(folder, { recursive: true, force: true });
`;

/** One example's runs under the recorder: one script, each run with a folder of records of its own. */
async function runner() {
  const folder = await mkdtemp(join(tmpdir(), 'ck-spawnlog-run-'));
  await writeFile(join(folder, 'run.mjs'), RUN);
  let count = 0;
  return {
    async run(asked: Run = {}) {
      const records = join(folder, `records-${count++}`);
      await mkdir(records);
      const ran = spawnSync(process.execPath, ['--import', recorder, join(folder, 'run.mjs'), JSON.stringify(asked)], { env: { ...process.env, CK_SPAWN_LOG: records }, encoding: 'utf8' });
      assert.equal(ran.status, 0, ran.stderr);
      return records;
    },
    done: () => rm(folder, { recursive: true, force: true }),
  };
}
const records = async (folder: string) => (await Promise.all((await readdir(folder)).filter(file => file !== 'made.jsonl').map(file => readFile(join(folder, file), 'utf8'))))
  .flatMap(text => text.split('\n').filter(Boolean).slice(1).map(line => JSON.parse(line)));
/** What the comparison says of two record folders: whether it found them the same, and its words. */
const compared = (before: string, after: string) => {
  const said = spawnSync(process.execPath, [recorder, 'compare', before, after], { encoding: 'utf8' });
  return { same: said.status === 0, words: said.stdout };
};

test('A start is recorded with the environment the program was given and every option, and a stand-in with a digest of its bytes', { skip }, async () => {
  const runs = await runner();
  try {
    const all = await records(await runs.run({ options: { windowsHide: false, argv0: 'probe', timeout: 5000 } }));
    const start = all.find(record => record.start === 'spawnSync');
    assert.equal(start?.env?.PROBE, 'one');
    assert.deepEqual([start?.options?.windowsHide, start?.options?.argv0, start?.options?.timeout], [false, 'probe', 5000]);
    assert.match(all.find(record => record.chmod)?.bytes ?? '', /^[0-9a-f]{16}$/);
  } finally { await runs.done(); }
});

test('Two runs differing only by one environment variable, one option or one byte of a stand-in compare as different; the same run twice, as the same', { skip }, async () => {
  const runs = await runner();
  try {
    const first = await runs.run(), again = await runs.run();
    assert.ok(compared(first, again).same, compared(first, again).words);
    for (const [name, changed] of [['variable', { env: { PROBE: 'two' } }], ['option', { options: { windowsHide: false } }], ['byte', { script: '#!/bin/sh\nexit 1\n' }]] as const) {
      const other = await runs.run(changed);
      assert.equal(compared(first, other).same, false, `${name}: ${compared(first, other).words}`);
    }
  } finally { await runs.done(); }
});

test('A helper process’s paths compare as they are but for a temporary folder’s random ending: tool-stable/bin is not tool-latest/bin, in a working folder or a variable', { skip }, async () => {
  const runs = await runner();
  try {
    // Each run's folder has its own random ending, which the helper, a process of its own, didn't make.
    const stable = await runs.run({ helper: 'tool-stable' }), again = await runs.run({ helper: 'tool-stable' }), latest = await runs.run({ helper: 'tool-latest' });
    assert.ok(compared(stable, again).same, compared(stable, again).words);
    assert.equal(compared(stable, latest).same, false, compared(stable, latest).words);
  } finally { await runs.done(); }
});

test('A change to a file is recorded with its paths and how it ended; two runs that move a file to different names compare as different', { skip }, async () => {
  const runs = await runner();
  try {
    const first = await runs.run({ moves: 'b' }), again = await runs.run({ moves: 'b' }), other = await runs.run({ moves: 'c' });
    const all = await records(first);
    assert.ok(all.some(record => record.rename?.[1]?.endsWith('-tool-*/b')), JSON.stringify(all));
    assert.ok(all.some(record => record.unlink?.[0]?.endsWith('-tool-*/gone') && record.error === 'ENOENT'), JSON.stringify(all));
    assert.ok(compared(first, again).same, compared(first, again).words);
    assert.equal(compared(first, other).same, false, compared(first, other).words);
  } finally { await runs.done(); }
});
