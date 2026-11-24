// One MCP sign-in check, in main (MAP.md, "MCP sign-in"): a tool's own list command (mcpsignin.ts listCommand), run once on a
// click for the home on screen, and its answer read of the servers asked about (mcpsignin.ts readAnswer). The binary is this
// computer's own command line, never a desktop app's copy (discovery.ts findCli). It runs from an empty folder made for the run and
// removed after it, in a process group of its own, stopped whole at the limit or when Central Knot quits (stopChecks, from main.ts's
// before-quit). This computer's own home is checked with the app's environment, its tools' overrides included (as main.ts
// overrideFor reads them); any other home with an environment made for it (ownEnv), so none of the tools' own variables reaches
// it. Central Knot writes nothing and keeps nothing; the tools' own commands write their own logs and caches in their own folders.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCli } from './discovery.ts';
import { CHECK_LIMIT_MS, listCommand, readAnswer } from './mcpsignin.ts';
import { pathBeside } from './platform.ts';
import { homeVariables } from './launch.ts';
import { run } from './plugins.ts';
import type { HarnessId, SigninAnswer } from './types.ts';

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
/** A check's limit: a shorter one asked for (an end-to-end run's), else CHECK_LIMIT_MS; never longer, and never none. */
export const checkLimit = (asked: number) => (asked > 0 && asked < CHECK_LIMIT_MS ? asked : CHECK_LIMIT_MS);

/**
 * One tool's check of the servers named `names` (as that tool names them): its answer; undefined for a tool with no command that
 * reports (Copilot CLI) and once Quit has begun, which run nothing. It is under way, and Quit stops it, from its first step.
 */
export async function checkSignin(where: CheckWhere, tool: HarnessId, names: string[], limitMs = CHECK_LIMIT_MS): Promise<SigninAnswer | undefined> {
  const args = listCommand[tool];
  if (!args || quitting) return undefined;
  const stop = new AbortController(), check = runCheck(where, tool, args, names, checkLimit(limitMs), stop.signal);
  underWay.set(stop, check.catch(() => undefined));
  try { return await check; } finally { underWay.delete(stop); }
}

async function runCheck(where: CheckWhere, tool: HarnessId, args: string[], names: string[], limitMs: number, signal: AbortSignal): Promise<SigninAnswer | undefined> {
  const binary = await findCli(tool, where.toolsHome, where.searchPath);
  if (signal.aborted) return undefined;
  if (!binary) return { failed: 'missing' };
  const folder = await mkdtemp(join(tmpdir(), 'ck-mcp-signin-'));
  const env = where.actual ? { ...process.env, HOME: where.home, PATH: pathBeside(binary) } : ownEnv(where.home, binary);
  try {
    const result = await run(binary, args, { cwd: folder, env, timeoutMs: limitMs, group: true, signal });
    return result.code === 'timeout' || result.code === 'missing' ? { failed: result.code } : readAnswer(tool, result.stdout.toString('utf8'), result.output, names);
  } finally { await rm(folder, { recursive: true, force: true }); }
}
