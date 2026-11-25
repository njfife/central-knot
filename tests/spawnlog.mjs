// A record of every program a run of the unit tests starts or stops, for proving that a change leaves macOS and Linux
// launching exactly as before: load it before anything else with NODE_OPTIONS=--import=<this file> and CK_SPAWN_LOG=<folder>,
// then compare two such folders (`node tests/spawnlog.mjs compare <before> <after> [<before again>]`). It is test plumbing,
// never shipped; its worked examples are tests/spawnlog.test.ts.
//
// What it records, one JSON line per call, in a file per process (<folder>/<pid>.jsonl, named on its first line by the
// script that process runs, a test file for each of `node --test`'s children):
// - each start through child_process (spawn, execFile and its promisified form, spawnSync, execFileSync, execSync, fork;
//   exec goes through execFile): the function, the program, its arguments, every option given, and the environment the
//   program was given (every name and value: the one passed, else the process's own, which it inherits);
// - each stop: a child's own kill() (the signal), and process.kill (the signal, 0 told apart as a liveness probe, and whether
//   the number named a process group, its sign kept), with the target named by the start that made it, or "another";
// - each chmod by which a test makes a file executable (the mode, and a digest of the file's bytes with its temporary folders
//   named as below): the tests' stand-in tools are made this way, so their place, bytes and mode are compared too.
// What no two runs share is written the same way on every run: the folders mkdtemp made (each process lists the ones it
// makes in <folder>/made.jsonl, so a helper process's records name its test's folders too), the checkout, the home, the
// record folder itself; and, when compared, ids, hashes, times, ports, process numbers and the test runner's slot (never a
// stand-in's digest, and no other path). Each test file's records are compared as a multiset (its tests may start things
// side by side), its liveness probes as a set (how often a wait asks depends on timing).
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..'), home = homedir();
/** The folders mkdtemp made in this process, each with its name written as `<prefix>*`: the one part of a path no two runs share. */
const made = new Map();
/** A path or argument with each folder mkdtemp made, the checkout and the home written the same way on every run. */
export function normal(text) {
  let said = String(text);
  for (const [path, name] of made) said = said.split(path).join(name);
  said = said.split(root).join('<repo>');
  return home.length > 1 ? said.split(home).join('<home>') : said;
}
/**
 * A recorded value with what else no two runs share written the same way: the folders the run's mkdtemp made (`named`, from
 * madeIn), ids, hashes (Git's, and folders named by one), times, ports, a process number in a stand-in's arguments, and the
 * test runner's slot for a file (NODE_TEST_WORKER_ID, which depends on scheduling). A stand-in's digest (`bytes`) is kept
 * as it is.
 */
const stable = (value, key, named) => {
  if (key === 'bytes') return value;
  if (key === 'NODE_TEST_WORKER_ID') return '<worker>';
  if (Array.isArray(value)) return value.map(each => stable(each, undefined, named));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, each]) => [name, stable(each, name, named)]));
  if (typeof value !== 'string') return value;
  return named(value)
    .replace(/0x[0-9a-f]+/g, '0x<n>')
    .replace(/\b1[6-9]\d{8}(\d{3})?\b/g, '<time>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/g, '<hex>')
    .replace(/\d{4}-\d\d-\d\dT\d\d[-:]\d\d[-:]\d\d[-.:]\d{3}Z/g, '<time>')
    .replace(/(127\.0\.0\.1|localhost):\d+/g, '$1:<port>');
};
/**
 * The folders mkdtemp made in one run, by any of its processes (made.jsonl), as a function that writes each one found in a
 * text as `<prefix>*`: mkdtemp adds six characters to its prefix, and they are what no two runs share. Only a folder made so
 * is written so; any other path is kept as it is. A folder made inside another is named whole.
 */
function madeIn(from) {
  let paths = [];
  try { paths = fs.readFileSync(join(from, 'made.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).path); } catch { /* none made */ }
  const names = new Map();
  const named = text => {
    let said = '', at = 0;
    for (let start = earliest(text, 0); start >= 0; start = earliest(text, at)) {
      // The longest made folder that starts here and ends at a / or at the end of the path.
      let end = start + 1, found;
      while (end <= text.length && !/[\s"'`,;:=]/.test(text[end - 1] ?? '')) {
        if ((end === text.length || text[end] === '/' || /[\s"'`,;:=]/.test(text[end])) && names.has(text.slice(start, end))) found = end;
        end++;
      }
      if (!found) { said += text.slice(at, start + 1); at = start + 1; continue; }
      said += text.slice(at, start) + names.get(text.slice(start, found));
      at = found;
    }
    return said + text.slice(at);
  };
  // Where each made folder can begin: the folders they were made in that were not made themselves (the temporary folders).
  const roots = [];
  const earliest = (text, from) => {
    let first = -1;
    for (const root of roots) { const index = text.indexOf(root, from); if (index >= 0 && (first < 0 || index < first)) first = index; }
    return first;
  };
  for (const path of [...new Set(paths)].sort((x, y) => x.length - y.length)) {
    if (path.lastIndexOf('/') <= 0) continue; // made relative to a working folder: no temporary folder to find it by
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (![...names.keys()].some(made => parent === made || parent.startsWith(`${made}/`)) && !roots.includes(parent)) roots.push(parent);
    names.set(path, `${named(path.slice(0, -6))}*`);
  }
  return named;
}

const folder = process.env.CK_SPAWN_LOG;
if (folder && process.argv[2] !== 'compare') record(folder);

/** An option's value as recorded: text as `normal` writes it, a function or an object of a class by its kind. */
const shown = value => {
  if (typeof value === 'string') return normal(value);
  if (typeof value === 'function') return '<function>';
  if (Array.isArray(value)) return value.map(shown);
  if (value && typeof value === 'object') {
    return Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.entries(value).map(([key, each]) => [key, shown(each)])) : `<${value.constructor?.name ?? 'object'}>`;
  }
  return value;
};

function record(into) {
  const file = join(into, `${process.pid}.jsonl`);
  let opened = false;
  const write = entry => {
    if (!opened) { opened = true; fs.appendFileSync(file, `${JSON.stringify({ process: normal(process.argv.slice(1).join(' ')) })}\n`); }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  };
  const named = new WeakMap(), byPid = new Map();
  /** The environment a start gives its program: the one passed, else this process's own, every name in order, the record folder named. */
  const envOf = options => {
    const env = options?.env ?? process.env;
    return Object.fromEntries(Object.keys(env).sort().map(name => [name, name === 'CK_SPAWN_LOG' ? '<records>' : shown(env[name])]));
  };
  const startOf = (fn, file, args, options) => ({
    start: fn, file: normal(file), args: (args ?? []).map(normal),
    options: Object.fromEntries(Object.keys(options ?? {}).filter(key => key !== 'env').sort().map(key => [key, shown(options[key])])),
    env: envOf(options),
  });
  /** The record of a call with child_process's own arguments (file, [args], [options], ...): its args when given as a list. */
  const entryOf = (fn, file, args, options) => {
    const list = Array.isArray(args) ? args : [];
    const opts = Array.isArray(args) ? options : (args && typeof args === 'object' ? args : undefined);
    return startOf(fn, file, list, opts && typeof opts === 'object' ? opts : undefined);
  };
  const wrap = fn => {
    const original = childProcess[fn];
    const wrapped = function (file, args, options, ...rest) {
      const entry = entryOf(fn, file, args, options);
      write(entry);
      const child = original.call(this, file, args, options, ...rest);
      const id = `${entry.file} ${entry.args.join(' ')}`;
      if (child && typeof child === 'object' && 'pid' in child) { named.set(child, id); if (child.pid) byPid.set(child.pid, id); }
      return child;
    };
    // Node's promisified execFile is its own function (it gives stdout and stderr); kept so, and recorded too.
    if (original[promisify.custom]) wrapped[promisify.custom] = (file, args, options, ...rest) => { write(entryOf(fn, file, args, options)); return original[promisify.custom](file, args, options, ...rest); };
    childProcess[fn] = wrapped;
  };
  for (const fn of ['spawn', 'execFile', 'spawnSync', 'execFileSync', 'execSync', 'fork']) wrap(fn);
  const kill = childProcess.ChildProcess.prototype.kill;
  childProcess.ChildProcess.prototype.kill = function (signal) {
    write({ kill: 'child', target: named.get(this) ?? 'another', signal: signal ?? 'SIGTERM' });
    return kill.call(this, signal);
  };
  const processKill = process.kill;
  process.kill = function (pid, signal) {
    const target = byPid.get(Math.abs(pid)) ?? 'another';
    write({ kill: 'process', target, group: pid < 0, signal: signal ?? 'SIGTERM', ...(signal === 0 ? { probe: true } : {}) });
    return processKill.call(this, pid, signal);
  };
  // Only a test's own chmod that makes a file executable (its stand-ins): the app's own, and a walk's putting back of what a
  // file held, are about content each run writes anew.
  const chmodOf = original => function (path, mode, ...rest) {
    const ours = new Error().stack?.split('\n')[2]?.includes(`${root}/tests/`);
    if (!ours || typeof mode !== 'number' || !(mode & 0o100)) return original.call(this, path, mode, ...rest);
    let bytes = 'unread';
    try { bytes = createHash('sha256').update(normal(fs.readFileSync(path, 'latin1'))).digest('hex').slice(0, 16); } catch { /* a folder */ }
    write({ chmod: normal(path), mode: mode.toString(8), bytes });
    return original.call(this, path, mode, ...rest);
  };
  // Longest first, so a folder made inside another is named whole; and listed for the run (madeIn), for other processes' records.
  const remember = (prefix, path) => {
    made.set(path, `${normal(prefix)}*`);
    const sorted = [...made].sort(([x], [y]) => y.length - x.length);
    made.clear();
    for (const [k, v] of sorted) made.set(k, v);
    fs.appendFileSync(join(into, 'made.jsonl'), `${JSON.stringify({ path })}\n`);
    return path;
  };
  const mkdtempAsync = fs.promises.mkdtemp, mkdtempSync = fs.mkdtempSync;
  fs.promises.mkdtemp = async (prefix, ...rest) => remember(prefix, await mkdtempAsync(prefix, ...rest));
  fs.mkdtempSync = (prefix, ...rest) => remember(prefix, mkdtempSync(prefix, ...rest));
  fs.promises.chmod = chmodOf(fs.promises.chmod);
  fs.chmodSync = chmodOf(fs.chmodSync);
  syncBuiltinESMExports();
}

/** Each process's records, by the test file (or other script) it ran: starts and stops as a multiset, probes as a set. */
function read(from) {
  const files = new Map(), named = madeIn(from);
  for (const name of fs.readdirSync(from).filter(entry => entry.endsWith('.jsonl') && entry !== 'made.jsonl')) {
    const [head, ...lines] = fs.readFileSync(join(from, name), 'utf8').split('\n').filter(Boolean);
    const script = stable(JSON.parse(head).process, undefined, named);
    // Any other process (a test's stand-in or fixture server running Node) by its script alone: its arguments differ from run to run.
    const owner = /\btests\/[\w.-]+\.test\.ts\b/.exec(script)?.[0] ?? script.split(' ')[0];
    const kept = files.get(owner) ?? { records: [], probes: new Set() };
    for (const recorded of lines.map(line => stable(JSON.parse(line), undefined, named))) {
      const line = JSON.stringify(recorded);
      if (recorded.probe) kept.probes.add(line); else kept.records.push(line);
    }
    files.set(owner, kept);
  }
  return files;
}

/** Each script's lines that `first` and `second` hold a different number of times (probes: hold or not). */
function differing(first, second) {
  const count = list => list.reduce((map, line) => map.set(line, (map.get(line) ?? 0) + 1), new Map());
  const [cx, cy] = [count(first.records), count(second.records)];
  const lines = new Map();
  for (const line of new Set([...cx.keys(), ...cy.keys()])) if (cx.get(line) !== cy.get(line)) lines.set(line, `${cx.get(line) ?? 0} → ${cy.get(line) ?? 0}`);
  for (const line of new Set([...first.probes, ...second.probes])) if (first.probes.has(line) !== second.probes.has(line)) lines.set(line, `probe ${first.probes.has(line) ? 'only before' : 'only after'}`);
  return lines;
}

/**
 * Compares two runs script by script. With `again`, a second run of the code `before` ran, a line that also differs between
 * `before` and `again` is timing (a background job stopped a moment sooner), not the change, and is counted apart.
 */
function compare(before, after, again) {
  const [a, b, c] = [read(before), read(after), again ? read(again) : undefined];
  let differences = 0, same = 0, timing = 0, records = 0;
  for (const owner of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const [x, y] = [a.get(owner), b.get(owner)];
    if (!x || !y) { console.log(`${owner}: only in ${x ? before : after} (${(x ?? y).records.length} records)`); differences++; continue; }
    records += x.records.length;
    const noise = c?.get(owner) ? differing(x, c.get(owner)) : new Map();
    const lines = [...differing(x, y)].filter(([line]) => !noise.has(line));
    timing += differing(x, y).size - lines.length;
    if (lines.length) { differences++; console.log(`${owner}: ${lines.length} difference(s)\n${lines.map(([line, how]) => `  ${how}  ${line}`).sort().join('\n')}`); } else same++;
  }
  console.log(`${same} script(s) the same (${records} records before), ${differences} different${again ? `; ${timing} line(s) set aside as timing, as they differ between ${before} and ${again} too` : ''}.`);
  return differences;
}

if (process.argv[2] === 'compare' && basename(process.argv[1] ?? '') === basename(import.meta.filename)) {
  process.exit(compare(process.argv[3], process.argv[4], process.argv[5]) ? 1 : 0);
}
