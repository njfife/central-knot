// One MCP sign-in check, in main (MAP.md, "MCP sign-in"): a tool's own list command (mcpsignin.ts listCommand), run once on a
// click for the home on screen, and its answer read of the servers asked about (mcpsignin.ts readAnswer); and one sign-in, the
// tool's own, started on a click (startSignin, which says its whole course). The binary is this
// computer's own command line, never a desktop app's copy (discovery.ts findCli). It runs from an empty folder made for the run and
// removed after it (one that can't be removed is left and said in the app's log: launch.ts clearRunFolder), in a process group of
// its own (on Windows, its tree: launch.ts stopTree), stopped whole at the limit or when Central Knot quits (stopChecks, from
// main.ts's before-quit), and none starts once Quit has begun. This computer's own home is checked with the app's environment,
// its tools' overrides included (as main.ts overrideFor reads them); any other home with an environment made for it (ownEnv), so
// none of the tools' own variables reaches it. Central Knot writes nothing and keeps nothing; the tools' own commands write their
// own logs, caches and, for a sign-in, what they keep of it, in their own folders or stores; a sign-in's tool opens the
// browser itself, and Central Knot never reads the address it signs in at.
import { mkdtemp } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { findCli } from './discovery.ts';
import { cellKey, CHECK_LIMIT_MS, listCommand, offersSignin, readAnswer, signInArgs, signinEnd, SIGNIN_LIMIT_MS, type SigninRow } from './mcpsignin.ts';
import { pathBeside } from './platform.ts';
import { clearRunFolder, homeVariables } from './launch.ts';
import { run } from './plugins.ts';
import { toolNames } from './words.ts';
import type { HarnessId, SigninAnswer, SigninEnd } from './types.ts';

/** Where a check runs: the home on screen, whether it is this computer's own, and where this computer's tools are looked for. */
export interface CheckWhere { home: string; actual: boolean; toolsHome: string; searchPath: string }

/**
 * What a check of a home other than this computer's runs with: what a command line needs to start (its PATH, the home, the
 * temporary folder, the locale, the terminal type; on Windows the home's other variables too: launch.ts homeVariables) and
 * nothing else. The plugin runs (plugins.ts native) keep the app's whole environment for any home, as git and the network
 * need the person's own settings to fetch.
 */
const KEPT = ['TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM'];
const ownEnv = (home: string, binary: string): NodeJS.ProcessEnv =>
  ({ ...Object.fromEntries(KEPT.flatMap(name => (process.env[name] === undefined ? [] : [[name, process.env[name]]]))), HOME: home, PATH: pathBeside(binary),
    ...homeVariables(home) });

/** The checks under way, each with its stop and its end (the folder removed); and whether Quit has begun, after which none starts. */
const underWay = new Map<AbortController, Promise<unknown>>();
let quitting = false;
/** Quit: no check starts from now on, each under way is stopped, and this answers once each has ended and its folder is gone (a second Quit waits as the first does); undefined when none is under way. */
export const stopChecks = () => { quitting = true; return underWay.size ? Promise.all([...underWay].map(([stop, ended]) => (stop.abort(), ended))) : undefined; };
/** A limit: a shorter one asked for (an end-to-end run's), else `most`; never longer, and never none. */
const shortened = (asked: number, most: number) => (asked > 0 && asked < most ? asked : most);
/** A check's limit: a shorter one asked for, else CHECK_LIMIT_MS. */
export const checkLimit = (asked: number) => shortened(asked, CHECK_LIMIT_MS);

/**
 * One tool's check of the servers named `names` (as that tool names them): its answer; undefined for a tool with no command that
 * reports (Copilot CLI) and once Quit has begun, which run nothing. It is under way, and Quit stops it, from its first step.
 * A folder of its that can't be removed is said to `log`.
 */
export async function checkSignin(where: CheckWhere, tool: HarnessId, names: string[], limitMs = CHECK_LIMIT_MS, log?: (line: string) => void): Promise<SigninAnswer | undefined> {
  const args = listCommand[tool];
  if (!args || quitting) return undefined;
  const stop = new AbortController(), check = runCheck(where, tool, args, names, checkLimit(limitMs), stop.signal, log);
  underWay.set(stop, check.catch(() => undefined));
  try { return await check; } finally { underWay.delete(stop); }
}

async function runCheck(where: CheckWhere, tool: HarnessId, args: string[], names: string[], limitMs: number, signal: AbortSignal, log?: (line: string) => void): Promise<SigninAnswer | undefined> {
  const binary = await findCli(tool, where.toolsHome, where.searchPath);
  if (signal.aborted) return undefined;
  if (!binary) return { failed: 'missing' };
  const result = await runIn(where, binary, args, { timeoutMs: limitMs, signal }, `sign-in check in ${toolNames[tool]}`, log);
  if (!result) return undefined;
  return result.code === 'timeout' || result.code === 'missing' ? { failed: result.code } : readAnswer(tool, result.stdout.toString('utf8'), result.output, names);
}

/**
 * `binary` run with `args` for `where`'s home, from an empty folder made for it and removed after, in a process group of its own;
 * undefined where it was stopped while the folder was made, and so never started. `what` names it in the app's log.
 */
async function runIn(where: CheckWhere, binary: string, args: string[], options: { timeoutMs: number; signal: AbortSignal; graceMs?: number; drainMs?: number; input?: string; inOrder?: boolean; env?: NodeJS.ProcessEnv },
  what: string, log?: (line: string) => void) {
  const folder = await mkdtemp(join(tmpdir(), 'ck-mcp-signin-'));
  const env = { ...(where.actual ? { ...process.env, HOME: where.home, PATH: pathBeside(binary) } : ownEnv(where.home, binary)), ...options.env };
  let leftRunning: boolean | undefined;
  try {
    // Quit came while the folder was made: the tool is not started.
    if (options.signal.aborted) return undefined;
    const result = await run(binary, args, { ...options, cwd: folder, env, group: true });
    leftRunning = result.leftRunning;
    return result;
  } finally { await clearRunFolder(folder, what, leftRunning, log); }
}

// ---------- One sign-in ----------

/** A stopped sign-in's time to end once asked before it is killed; how long its output may stay open after it ends (startSignin). */
const STOP_GRACE_MS = 3000, DRAIN_MS = 1000;
/** What the page asks a sign-in for: the home it was drawn for, the tool, the server's row and the copy the cell showed (mcpsignin.ts cellKey). */
export interface SigninAsk { home: string; tool: HarnessId; row: string; copy: string }
/**
 * What main has when it starts one: where it would run (the home open), whether Central Knot may write it (share.ts writeAccess),
 * the tools managed there, its rows as read now (mcpsignin.ts signinRows), and the port a tool's sign-in for a server of its, by
 * its name there, listens on for the browser's answer, where it is one of its own (mcpsignin.ts callbackPort: OpenCode's).
 */
export interface SigninNow { where: CheckWhere; writable: boolean; managed: HarnessId[]; rows: SigninRow[]; listensOn: (tool: HarnessId, name: string) => number | undefined }
/**
 * Why main starts nothing for `ask`, in the cell's words; none where it may start: the home open is the one asked for; it is this
 * computer's own, one it may write, and a cell of that tool offers Sign in on `platform` (mcpsignin.ts offersSignin); the tool is managed; and
 * the row's cell there is the very copy the page showed, on, and named by the tool.
 */
export function signinRefusal(ask: SigninAsk, now: SigninNow, platform: string = process.platform): string | undefined {
  if (ask.home !== now.where.home) return 'Another home is open';
  if (!offersSignin(ask.tool, now.where.actual && now.writable, platform)) return `Central Knot doesn’t start ${toolNames[ask.tool]}’s sign-in here`;
  if (!now.managed.includes(ask.tool)) return `${toolNames[ask.tool]} isn’t managed here`;
  const row = now.rows.find(each => each.id === ask.row), cell = row?.cells[ask.tool];
  return !row || !cell || cell.off || cell.name === undefined || cellKey(row, cell) !== ask.copy ? 'Changed since the page showed it' : undefined;
}

/** The sign-in under way (startSignin). */
let signing: AbortController | undefined;
/** Stop: the sign-in under way, if one is, is asked to end; its start answers Stopped. */
export const stopSignin = () => signing?.abort();

/**
 * One server's sign-in in its tool, started on a click: the whole course of a run, said here alone. One at a time: a second is
 * refused at once, before anything is looked up. Then `now()` is read and the ask refused (signinRefusal), the command line
 * found, and `now()` read and the ask refused again just before the tool starts; a tool that listens on a port of its own for
 * the browser's answer (SigninNow listensOn) is not started where something answers there already (portAnswers). It runs the
 * tool's own command (mcpsignin.ts signInArgs) as checkSignin runs a check, its input closed; the tool opens the browser
 * itself (Codex's set apart: browserApart). It ends as the tool says (mcpsignin.ts signinEnd). Its limit, Stop (stopSignin),
 * Quit (stopChecks: none starts after) and another home opening (main.ts selectHome) stop it alike: its process group asked
 * to end, then killed after STOP_GRACE_MS, what its leader left killed DRAIN_MS after it ends (plugins.ts run graceMs,
 * drainMs). `limitMs`: a shorter limit than SIGNIN_LIMIT_MS (an end-to-end run's).
 */
export async function startSignin(ask: SigninAsk, now: () => Promise<SigninNow>, limitMs = SIGNIN_LIMIT_MS, log?: (line: string) => void): Promise<SigninEnd> {
  if (signing) return { notStarted: 'Another sign-in is running' };
  if (quitting) return { failed: 'stopped' };
  const stop = signing = new AbortController(), ended = runSignin(ask, now, shortened(limitMs, SIGNIN_LIMIT_MS), stop.signal, log);
  underWay.set(stop, ended.catch(() => undefined));
  try { return await ended; } finally { underWay.delete(stop); signing = undefined; }
}

/** Whether `command` (a path, or a name looked for in `path`) is a program that can be run. */
const runnable = (command: string, path: string) => (command.includes('/') ? [command] : path.split(delimiter).map(folder => join(folder, command)))
  .some(file => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } });
/**
 * Codex opens the browser itself (webbrowser 1.2.4: the first command of $BROWSER found on its path, else the default browser's
 * own command or xdg-open), spawned as its own child in the process group every ending signals: a browser it started so was
 * ended at every ending (measured with stand-ins). On Linux each command of his BROWSER, or else xdg-open, that is found on
 * Codex's `path` goes behind util-linux `setsid`, in his order, so the browser starts in a session of its own and outlives every
 * ending; one not found is left out, so the next is tried; with none found (or no setsid), BROWSER is left as it was and Codex
 * opens its own way. macOS hands the address to the system (`open`): left as it is, not measured here. Pi and OpenCode start
 * their opener detached themselves (Pi 1.7.0 utils/open-browser.js, OpenCode 1.19.6 McpBrowser.open, read in their code): their
 * run is given nothing for it.
 */
function browserApart(path: string): NodeJS.ProcessEnv {
  const found = (process.env.BROWSER || 'xdg-open').split(':').map(entry => entry.trim()).filter(entry => entry && runnable(entry.split(/\s+/)[0]!, path));
  return process.platform === 'linux' && found.length && runnable('setsid', path) ? { BROWSER: found.map(entry => `setsid ${entry}`).join(':') } : {};
}
/** How long main waits to know whether something answers on a sign-in's port: a connection on this computer is answered or refused at once. */
const PROBE_MS = 2000;
/**
 * Whether something answers on 127.0.0.1:`port`, asked at most PROBE_MS and no longer than the run (`signal`). OpenCode 1.19.6
 * asks the same before its sign-in and, answered, takes none of its own, its sign-in then waiting on a callback that goes to that
 * other program (read in its code): its sign-in isn't started then.
 */
const portAnswers = (port: number, signal: AbortSignal) => new Promise<boolean>(done => {
  const probe = connect(port, '127.0.0.1'), bound = setTimeout(() => answered(false), PROBE_MS);
  const answered = (yes: boolean) => { clearTimeout(bound); signal.removeEventListener('abort', gone); probe.destroy(); done(yes); };
  const gone = () => answered(false);
  signal.addEventListener('abort', gone, { once: true });
  probe.once('connect', () => answered(true)).once('error', () => answered(false));
});

async function runSignin(ask: SigninAsk, now: () => Promise<SigninNow>, limitMs: number, signal: AbortSignal, log?: (line: string) => void): Promise<SigninEnd> {
  const first = await now(), refused = signinRefusal(ask, first);
  if (refused) return { notStarted: refused };
  const binary = await findCli(ask.tool, first.where.toolsHome, first.where.searchPath);
  if (!binary) return { failed: 'missing' };
  const last = await now(), changed = signinRefusal(ask, last);
  if (changed) return { notStarted: changed };
  const name = last.rows.find(row => row.id === ask.row)!.cells[ask.tool]!.name!, port = last.listensOn(ask.tool, name);
  if (port !== undefined && await portAnswers(port, signal)) return { portInUse: port };
  const env = ask.tool === 'codex-cli' ? browserApart(pathBeside(binary)) : undefined;
  const result = signal.aborted ? undefined : await runIn(last.where, binary, signInArgs(ask.tool, name)!,
    { timeoutMs: limitMs, signal, graceMs: STOP_GRACE_MS, drainMs: DRAIN_MS, input: '', inOrder: true, env }, `sign-in in ${toolNames[ask.tool]}`, log);
  if (!result || result.reason === 'aborted') return { failed: 'stopped' };
  if (result.reason === 'timeout' || result.code === 'missing') return { failed: result.reason === 'timeout' ? 'timeout' : 'missing' };
  return signinEnd(ask.tool, result.code, result.inOrder ?? result.output, port);
}
