// The Mac run: every check of a change, as `.github/workflows/mac.yml` runs it after `npm ci`, in the order `phases` gives
// with its reasons. Each part's output prints as one block when it has closed (folded when the part passed), then a table of
// every part's result and time, and one line for each part that failed, quoting what failed when its output says. Exit code:
// 0 when every part passed; 1 when a part failed (the parts it kept from running are "not run"); 130 when the run was stopped
// by a signal, which each running part is sent too (one that has not ended STOP_GRACE_MS later is killed). However the run
// ends, but by SIGKILL, each part still running is killed with its process group. What each part checks and prints is its own
// script's; this file owns the order, how a part's end is read, and the table.
// Usage (a Mac, in a checkout after npm ci): node scripts/mac-run.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * What runs, beside what, and why. A phase ends when all its lanes have ended, and only then does the next begin; a phase's
 * lanes run side by side; a lane runs its parts one after another; a part is one command, and passes only by exiting 0, not
 * ended by a signal (one the run sent a stop to before it ended is "stopped"). A failed part ends its lane, the other lanes
 * of its phase still finish, and no later phase runs: the parts after it would fail for it, as a red step stops the rest of a
 * workflow.
 */
const phases = [
  [
    // The type check and the unit tests, beside the packaging: neither reads dist/ or release/, and the tests write only to
    // their own temp folders.
    [{ name: 'unit tests', command: 'npm test' }],
    // One after another: each packaging wipes $TMPDIR/electron-packager as it starts and rewrites dist/, and the alpha check
    // needs the standard app's downloads, then removes them (the standard app itself stays in release/ for the e2e run).
    [
      { name: 'package', command: 'npm run package:mac' },
      // The light tour, right after the packaging as it opens the packaged app: each page once, one picture each (gh run
      // download <run> -n light-tour). Not beside the e2e run: it opens the app without
      // --disable-backgrounding-occluded-windows, so the e2e windows covering it would hide its page and stall its sizes and
      // pictures, and it would take the focus from theirs.
      { name: 'light tour', command: 'node scripts/ui-tour.mjs light-tour' },
      // A bundled build: the documented build command on a fixture marketplace, then the packaged build opened with the source gone.
      { name: 'bundled check', command: 'node scripts/bundled-check.mjs' },
      // The alpha: packaged from a test alpha tag beside the standard app, then both opened on one throwaway home.
      { name: 'alpha check', command: 'node scripts/alpha-check.mjs' },
    ],
  ],
  // The end-to-end checks against the packaged app, with nothing beside them: four copies of the script at once (or as many as
  // CK_E2E_GROUPS_AT_ONCE says, which only mac-hosted.yml sets), each running one group of its flows (scripts/e2e.mjs runGroups).
  [[{ name: 'e2e', command: 'npm run e2e', env: { CK_E2E_GROUPS_AT_ONCE: process.env.CK_E2E_GROUPS_AT_ONCE || '4' } }]],
];

const root = resolve(import.meta.dirname, '..');
const started = Date.now();
/** How long a part has to end after the run passes a stop on to it, before what is left of it is killed. */
const STOP_GRACE_MS = 5000;
/** A time as `41s` or `6m31s`. */
const clock = ms => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
};
/**
 * What each part that ran came to: `passed`; `failed`, with how it ended (`exit 1`, `ended by SIGKILL`, `could not start: …`)
 * and the line that says what failed if its output has one; or `stopped` by the run's stop before it ended.
 */
const results = new Map();
/** A part's result in words: `passed, 41s`, `failed, 41s, exit 1` or `stopped, 41s, by SIGTERM`. */
const said = ({ result, time, how }) => `${result}, ${time}${result === 'passed' ? '' : `, ${how}`}`;

const running = new Set();
let stoppedBy;
/** Sends a signal to a part's process group: the part and what it started (each part is its group's leader). */
const toGroup = (child, signal) => { try { process.kill(-child.pid, signal); } catch { /* the group is gone */ } };
// A stop goes to each part that has not ended (one that has keeps its own result), and what is left of one STOP_GRACE_MS
// later is killed.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stoppedBy ??= signal;
    for (const child of running) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.stoppedBy ??= signal;
      toGroup(child, signal);
      child.grace ??= setTimeout(() => toGroup(child, 'SIGKILL'), STOP_GRACE_MS);
    }
  });
}
// However the run itself ends (but by SIGKILL), each part still running is killed with its group; and if the run's own
// output closes (the reader of its pipe gone), the run ends there.
process.on('exit', () => { for (const child of running) toGroup(child, 'SIGKILL'); });
process.stdout.on('error', () => process.exit(1));

/**
 * The line in a failed part's output that says what failed: its first FAIL (e2e, the bundled and alpha checks), ✖ (a unit
 * test) or tsc error line; else the error Node printed as the part crashed (the first line after the `^` Node puts under the
 * line that threw); else its first `…Error…: ` line. Undefined when there is none: how the part ended says the rest.
 */
const whatFailed = output => {
  const lines = output.split('\n').map(line => line.trim());
  const first = (pattern, from = 0) => lines.slice(from).find(line => pattern.test(line));
  const caret = lines.findIndex(line => /^\^+$/.test(line));
  return first(/^(?:FAIL |✖ )|error TS\d/) ?? (caret < 0 ? undefined : first(/./, caret + 1)) ?? first(/^\w*Error\b[^:]*: /);
};

/**
 * Runs one part as the leader of a process group of its own. When it exits, whatever is left of its group is killed (in a
 * stop, only once its output has closed or STOP_GRACE_MS has passed, so it can say what it was doing); when its output has
 * closed, its stdout and stderr print as one block, in the order they came. Resolves whether it passed.
 */
const runPart = part => new Promise(done => {
  const from = Date.now();
  console.log(`${part.name}: started at ${clock(from - started)}`);
  let output = '', over = false;
  const end = (result, how) => {
    if (over) return;
    over = true;
    const record = { result, time: clock(Date.now() - from), how, line: result === 'failed' ? whatFailed(output) : undefined };
    results.set(part, record);
    // A part that passed is folded in the run's log; one that did not is shown open.
    const [open, close] = result === 'passed' ? ['::group::', '\n::endgroup::'] : ['── ', ''];
    console.log(`${open}${part.name}: ${said(record)}\n${output.trimEnd()}${close}`);
    done(result === 'passed');
  };
  let child;
  try {
    const env = { ...process.env, ...part.env };
    child = spawn(part.command, { cwd: root, env, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { end('failed', `could not start: ${error.message}`); return; }
  // Each stream is decoded as text, so a character split across two reads stays whole.
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', text => { output += text; });
  running.add(child);
  child.on('error', error => {
    if (child.pid === undefined) { running.delete(child); end('failed', `could not start: ${error.message}`); }
  });
  child.on('exit', () => { if (!child.stoppedBy) toGroup(child, 'SIGKILL'); });
  child.on('close', (code, signal) => {
    running.delete(child);
    clearTimeout(child.grace);
    toGroup(child, 'SIGKILL');
    if (child.stoppedBy) end('stopped', `by ${child.stoppedBy}`);
    else end(code === 0 && !signal ? 'passed' : 'failed', signal ? `ended by ${signal}` : `exit ${code}`);
  });
});

/** Each phase's time, in the order they ran. */
const phaseTimes = [];
for (const lanes of phases) {
  if (stoppedBy || [...results.values()].some(({ result }) => result !== 'passed')) break;
  const from = Date.now();
  await Promise.all(lanes.map(async lane => { for (const part of lane) if (stoppedBy || !(await runPart(part))) break; }));
  phaseTimes.push(clock(Date.now() - from));
}

const count = result => [...results.values()].filter(record => record.result === result).length;
const outcome = [stoppedBy && `stopped by ${stoppedBy}`, ...['failed', 'stopped'].map(result => count(result) && `${count(result)} ${result}`)]
  .filter(Boolean).join(', ');
console.log(`\nThe Mac run: ${clock(Date.now() - started)}, ${outcome || 'every part passed'}`);
for (const [number, lanes] of phases.entries()) {
  console.log(`phase ${number + 1}: ${phaseTimes[number] ?? 'not run'}`);
  for (const part of lanes.flat()) console.log(`  ${part.name}: ${results.has(part) ? said(results.get(part)) : 'not run'}`);
}
for (const [part, { result, time, how, line }] of results) {
  if (result === 'failed') console.log(`::error::FAILED ${part.name} (${time}, ${how})${line ? `: ${line}` : ''}`);
}
process.exitCode = stoppedBy ? 130 : count('failed') ? 1 : 0;
