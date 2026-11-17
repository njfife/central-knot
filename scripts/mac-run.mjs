// The Mac run: every check of a change, as `.github/workflows/mac.yml` runs it after `npm ci`, in the order `phases` gives
// with its reasons. Each part's output prints as one block when the part ends (folded when it passed), then a table of every
// part's result and time, and one line for each part that failed, quoting what failed. Exit code: 0 when every part passed;
// 1 when a part failed (the parts it kept from running are "not run"); 130 when the run was stopped by a signal, which each
// running part is sent too. What each part checks and prints is its own script's; this file owns the order, how a part's
// end is read, and the table.
// Usage (a Mac, in a checkout after npm ci): node scripts/mac-run.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * What runs, beside what, and why. A phase ends when all its lanes have ended, and only then does the next begin; a phase's
 * lanes run side by side; a lane runs its parts one after another; a part is one command, and passes only by exiting 0, not
 * ended by a signal and not sent one. A failed part ends its lane, the other lanes of its phase still finish, and no later
 * phase runs: the parts after it would fail for it, as a red step stops the rest of a workflow.
 */
const phases = [
  [
    // The type check and the unit tests, beside the packaging: tsc reads only src/ and tests/, and the tests write only to
    // their own temp folders and never read dist/ or release/.
    [{ name: 'unit tests', command: 'npm test' }],
    // One after another: each packaging wipes $TMPDIR/electron-packager as it starts and rewrites dist/, and the alpha check
    // needs the standard app's downloads, then removes them (the standard app itself stays in release/ for the e2e run).
    [
      { name: 'package', command: 'npm run package:mac' },
      // The light tour: the packaged app opens and so does each page, one picture each (gh run download <run> -n light-tour).
      // Not beside the e2e run: it opens the app without --disable-backgrounding-occluded-windows, so the e2e windows covering
      // it would hide its page and stall its sizes and pictures, and it would take the focus from theirs.
      { name: 'light tour', command: 'node scripts/ui-tour.mjs light-tour' },
      // A bundled build: the documented build command on a fixture marketplace, then the packaged build opened with the source gone.
      { name: 'bundled check', command: 'node scripts/bundled-check.mjs' },
      // The alpha: packaged from a test alpha tag beside the standard app, then both opened on one throwaway home.
      { name: 'alpha check', command: 'node scripts/alpha-check.mjs' },
    ],
  ],
  // The end-to-end checks against the packaged app, with nothing beside them: four copies of the script at once, each running
  // one group of its flows (scripts/e2e.mjs runGroups).
  [[{ name: 'e2e', command: 'npm run e2e', env: { CK_E2E_GROUPS_AT_ONCE: '4' } }]],
];

const root = resolve(import.meta.dirname, '..');
const started = Date.now();
/** A time as `41s` or `6m31s`. */
const clock = ms => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
};
/** What each part that ran came to: passed, its time, how it ended, and the line that says what failed. */
const ended = new Map();
/** A part's result in words: `passed, 41s`, or `failed, 41s, exit 1` (or `ended by SIGKILL`, or `stopped by SIGTERM`). */
const said = ({ passed, time, how }) => (passed ? `passed, ${time}` : `failed, ${time}, ${how}`);

const running = new Set();
let stoppedBy;
/** Sends a signal to a part's process group: the part and everything it started (each part is its group's leader). */
const toGroup = (child, signal) => { try { process.kill(-child.pid, signal); } catch { /* the group is gone */ } };
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stoppedBy = signal; for (const child of running) { child.stoppedBy = signal; toGroup(child, signal); } });
}

/**
 * A failed part's line: its first FAIL (e2e, the bundled and alpha checks), ✖ (a unit test) or tsc error line; else its first
 * uncaught error; else its last line.
 */
const whatFailed = output => {
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
  const first = pattern => lines.find(line => pattern.test(line));
  return first(/^(?:FAIL |✖ )|error TS\d/) ?? first(/^\w*Error: /) ?? lines.at(-1) ?? '(no output)';
};

/**
 * Runs one part as the leader of a process group of its own, its stdout and stderr kept in the order they came, and prints
 * them as one block when its output closes; whatever is left of its group then is killed. Resolves whether it passed.
 */
const runPart = part => new Promise(done => {
  const from = Date.now();
  console.log(`${part.name}: started at ${clock(from - started)}`);
  const env = { ...process.env, ...part.env };
  const child = spawn(part.command, { cwd: root, env, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  running.add(child);
  child.on('close', (code, signal) => {
    running.delete(child);
    toGroup(child, 'SIGKILL');
    const passed = code === 0 && !signal && !child.stoppedBy;
    const how = child.stoppedBy ? `stopped by ${child.stoppedBy}` : signal ? `ended by ${signal}` : `exit ${code}`;
    const end = { passed, time: clock(Date.now() - from), how, line: passed ? '' : whatFailed(output) };
    ended.set(part, end);
    // A part that passed is folded in the run's log, one that failed is shown open.
    console.log(`${passed ? '::group::' : '── '}${part.name}: ${said(end)}\n${output.trimEnd()}${passed ? '\n::endgroup::' : ''}`);
    done(passed);
  });
});

/** Each phase's time, in the order they ran. */
const phaseTimes = [];
for (const lanes of phases) {
  if (stoppedBy || [...ended.values()].some(end => !end.passed)) break;
  const from = Date.now();
  await Promise.all(lanes.map(async lane => { for (const part of lane) if (stoppedBy || !(await runPart(part))) break; }));
  phaseTimes.push(clock(Date.now() - from));
}

const failed = [...ended].filter(([, end]) => !end.passed);
const outcome = [stoppedBy && `stopped by ${stoppedBy}`, failed.length && `${failed.length} failed`].filter(Boolean).join(', ');
console.log(`\nThe Mac run: ${clock(Date.now() - started)}, ${outcome || 'every part passed'}`);
for (const [number, lanes] of phases.entries()) {
  console.log(`phase ${number + 1}: ${phaseTimes[number] ?? 'not run'}`);
  for (const part of lanes.flat()) console.log(`  ${part.name}: ${ended.has(part) ? said(ended.get(part)) : 'not run'}`);
}
for (const [part, end] of failed) console.log(`::error::FAILED ${part.name} (${end.time}, ${end.how}): ${end.line}`);
process.exitCode = stoppedBy ? 130 : failed.length ? 1 : 0;
