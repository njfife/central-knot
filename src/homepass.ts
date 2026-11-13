// One pass over the open home, in the order main.ts runs it at start and at every look after (main.ts pass, the one caller in
// the app; tests/upgrade.test.ts runs it over homes older versions made):
//   1. a profiles file from before profiles were sets of library items is moved, with Sync on or off (profilemigrate.ts);
//   2. where this build syncs the home and the pass may write (Sync on, or Sync once), skills, MCP servers and agents are
//      brought into line, in that order, each on its own: one that crashes is told as a failure and the next still runs.
// The other three one-time migrations run as each library is opened (skillstore.ts, serverstore.ts, agentstore.ts
// openLibrary): only in memory for a reader such as the pages' views, and written by the first pass that may write.
import { applyAgents } from './agents.ts';
import { migrateProfiles } from './profilemigrate.ts';
import { applyServers } from './servers.ts';
import { syncsHere, type ShareContext } from './share.ts';
import { applySkills } from './skills.ts';
import type { DestinationResult, HarnessId, PassResult } from './types.ts';

/**
 * What one pass did. `synced`: absent when step 2 did not run (Sync off, or this build doesn't sync the home); a kind's result
 * is absent when it crashed, and the crash is in `crashes`. `profilesFailed`: why step 1 failed, for the log.
 */
export interface HomePass {
  synced?: { skills?: PassResult; servers?: PassResult; agents?: PassResult; crashes: DestinationResult[] };
  profilesFailed?: unknown;
}

/** One pass over the home (the header says what it does). `writes`: Sync is on, or the person asked for this pass. */
export async function homePass(context: ShareContext, managed: HarnessId[], writes: boolean): Promise<HomePass> {
  let profilesFailed: unknown;
  await migrateProfiles(context, managed).catch((error: unknown) => { profilesFailed = error ?? 'failed'; });
  const failure = profilesFailed === undefined ? {} : { profilesFailed };
  if (!(await syncsHere(context)) || !writes) return failure;
  const crashes: DestinationResult[] = [];
  const crashed = (item: string) => (error: unknown) => {
    crashes.push({ item, outcome: 'failed', message: `${item} could not finish: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  };
  // Skills, MCP servers and agents are Central Knot's library (library.ts); Claude Code's MCP settings wait for Write to Claude Code.
  const skills = await applySkills(context, managed, []).catch(crashed('Skills sync'));
  const servers = await applyServers(context, managed, []).catch(crashed('MCP sync'));
  const agents = await applyAgents(context, managed, []).catch(crashed('Agents sync'));
  return { ...failure, synced: { skills, servers, agents, crashes } };
}
