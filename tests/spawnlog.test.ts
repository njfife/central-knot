// The recorder of every program the unit tests start or stop (tests/spawnlog.mjs), as worked examples: what it keeps of a
// start (the environment the program was given, every option, and a stand-in's bytes), and that its comparison tells two
// runs apart by any one of them. It proves macOS and Linux unchanged, so it is run there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const skip = process.platform === 'win32' && 'the recorder proves macOS and Linux unchanged (its stand-ins are made executable by chmod); it is run there';
const recorder = join(import.meta.dirname, 'spawnlog.mjs');
const standin = pathToFileURL(join(import.meta.dirname, 'standin.ts')).href;
interface Run { script?: string; env?: Record<string, string>; options?: Record<string, unknown> }

/**
 * One run under the recorder, in a folder of its own: a fresh Node makes a stand-in (`script`, its shell text) in a temporary
 * folder and starts it with `env` and `options`. Gives back the folder its records went to; `made` lists the run folders.
 */
async function run(made: string[], { script = '#!/bin/sh\nexit 0\n', env = { PROBE: 'one' }, options = { windowsHide: true } }: Run = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'ck-spawnlog-run-'));
  made.push(folder);
  await mkdir(join(folder, 'records'));
  await writeFile(join(folder, 'run.mjs'), `
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standIn } from ${JSON.stringify(standin)};
const folder = mkdtempSync(join(tmpdir(), 'ck-spawnlog-tool-'));
const tool = await standIn(join(folder, 'tool'), ${JSON.stringify(script)}, '');
spawnSync(tool, ['--version'], { env: { PATH: process.env.PATH, ...${JSON.stringify(env)} }, ...${JSON.stringify(options)} });
rmSync(folder, { recursive: true, force: true });
`);
  const ran = spawnSync(process.execPath, ['--import', recorder, join(folder, 'run.mjs')], { env: { ...process.env, CK_SPAWN_LOG: join(folder, 'records') }, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return join(folder, 'records');
}
const records = async (folder: string) => (await Promise.all((await readdir(folder)).map(file => readFile(join(folder, file), 'utf8'))))
  .flatMap(text => text.split('\n').filter(Boolean).slice(1).map(line => JSON.parse(line)));
/** What the comparison says of two record folders: whether it found them the same, and its words. */
const compared = (before: string, after: string) => {
  const said = spawnSync(process.execPath, [recorder, 'compare', before, after], { encoding: 'utf8' });
  return { same: said.status === 0, words: said.stdout };
};

test('A start is recorded with the environment the program was given and every option, and a stand-in with a digest of its bytes', { skip }, async () => {
  const made: string[] = [];
  try {
    const all = await records(await run(made, { options: { windowsHide: false, argv0: 'probe', timeout: 5000 } }));
    const start = all.find(record => record.start === 'spawnSync');
    assert.equal(start?.env?.PROBE, 'one');
    assert.deepEqual([start?.options?.windowsHide, start?.options?.argv0, start?.options?.timeout], [false, 'probe', 5000]);
    assert.match(all.find(record => record.chmod)?.bytes ?? '', /^[0-9a-f]{16}$/);
  } finally { for (const folder of made) await rm(folder, { recursive: true, force: true }); }
});

test('Two runs differing only by one environment variable, one option or one byte of a stand-in compare as different; the same run twice, as the same', { skip }, async () => {
  const made: string[] = [];
  try {
    const first = await run(made), again = await run(made);
    assert.ok(compared(first, again).same, compared(first, again).words);
    for (const [name, changed] of [['variable', { env: { PROBE: 'two' } }], ['option', { options: { windowsHide: false } }], ['byte', { script: '#!/bin/sh\nexit 1\n' }]] as const) {
      const other = await run(made, changed);
      assert.equal(compared(first, other).same, false, `${name}: ${compared(first, other).words}`);
    }
  } finally { for (const folder of made) await rm(folder, { recursive: true, force: true }); }
});
