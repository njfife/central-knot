// One MCP sign-in check, in main (MAP.md, "MCP sign-in"): a tool's own list command (mcpsignin.ts listCommand), run once on a
// click for the home on screen, and its answer read (mcpsignin.ts readAnswer). The binary is this computer's own CLI, never a
// desktop app's copy (discovery.ts findCli). It runs from an empty folder made for the run and removed after it, in a process
// group of its own, stopped whole at the limit (plugins.ts run). Only this computer's own home is given the tools' folder
// variables (its overrides, as main.ts overrideFor reads them); any other home is given none of them, so checking a Practice copy
// or another folder never reads this computer's own tool files. Central Knot writes nothing and keeps nothing; the tools' own
// commands write their own logs and caches in their own folders.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCli } from './discovery.ts';
import { harnessIds, harnesses } from './harnesses.ts';
import { CHECK_LIMIT_MS, listCommand, readAnswer } from './mcpsignin.ts';
import { pathBeside } from './platform.ts';
import { run } from './plugins.ts';
import type { HarnessId, SigninAnswer } from './types.ts';

/** Where a check runs: the home on screen, whether it is this computer's own, and where this computer's tools are looked for. */
export interface CheckWhere { home: string; actual: boolean; toolsHome: string; searchPath: string }

/** The variables that move a tool's files away from HOME: none of them reaches a check of a home other than this computer's. */
const MOVES_FILES = [...harnessIds.map(tool => harnesses[tool].configEnv), 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'];

/** One tool's check: its answer, or undefined for a tool with no command that reports (Copilot CLI), which runs nothing. */
export async function checkSignin(where: CheckWhere, tool: HarnessId, limitMs = CHECK_LIMIT_MS): Promise<SigninAnswer | undefined> {
  const args = listCommand[tool];
  if (!args) return undefined;
  const binary = await findCli(tool, where.toolsHome, where.searchPath);
  if (!binary) return { failed: 'missing' };
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: where.home, USERPROFILE: where.home, PATH: pathBeside(binary) };
  if (!where.actual) for (const name of MOVES_FILES) delete env[name];
  const folder = await mkdtemp(join(tmpdir(), 'ck-mcp-signin-'));
  try {
    const result = await run(binary, args, { cwd: folder, env, timeoutMs: limitMs, group: true });
    return result.code === 'timeout' || result.code === 'missing' ? { failed: result.code } : readAnswer(tool, result.stdout.toString('utf8'), result.output);
  } finally { await rm(folder, { recursive: true, force: true }); }
}
