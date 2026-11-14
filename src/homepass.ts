// One pass over the open home, in the order main.ts runs it at start and at every look after (main.ts pass, the one caller in
// the app; tests/upgrade.test.ts runs it over homes older versions made):
//   1. a profiles file from before profiles were sets of library items is moved, with Sync on or off (profilemigrate.ts);
//   2. where this build syncs the home and the pass may write (Sync on, or Sync once), skills, MCP servers and agents are
//      brought into line, in that order, each on its own: one that crashes is told as a failure and the next still runs.
//      This is the pass of the whole home, the one in which Synchronize everything takes found items in
//      (librarypass.ts PassOptions background).
// What such a pass tells the page is decided here too, for every kind alike (passTells): main.ts keeps it until the page reads.
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

/** Each kind's pass as a failure of it is named on the page ("MCP sync: …"), whether it crashed or stopped part-way. */
const passNames = { skills: 'Skills sync', servers: 'MCP sync', agents: 'Agents sync' } as const;

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
  // The pass of the whole home: the home's standing rule, Synchronize everything, takes found items in here and nowhere else.
  const whole = { background: true } as const;
  const skills = await applySkills(context, managed, [], whole).catch(crashed(passNames.skills));
  const servers = await applyServers(context, managed, [], whole).catch(crashed(passNames.servers));
  const agents = await applyAgents(context, managed, [], whole).catch(crashed(passNames.agents));
  return { ...failure, synced: { skills, servers, agents, crashes } };
}

/**
 * What the page is told of one pass of the whole home, every kind alike (main.ts keeps it for the next view: types.ts SyncView
 * caughtUp). `copies`: each copy the pass wrote or removed (the Harnesses page's Caught up band names those written:
 * model.ts caughtUpNames) and each that failed. `stopped`: each kind whose pass crashed or stopped part-way, and why
 * (with `copies`' failures, the problems band). A write left for Write to Claude Code, or for a choice of copy, is not told
 * here: its row says it waits.
 */
export function passTells(synced: NonNullable<HomePass['synced']>): { copies: DestinationResult[]; stopped: DestinationResult[] } {
  const kinds = [[passNames.skills, synced.skills], [passNames.servers, synced.servers], [passNames.agents, synced.agents]] as const;
  const told = (result: DestinationResult) => result.outcome === 'written' || result.outcome === 'removed' || result.outcome === 'failed';
  return {
    copies: kinds.flatMap(([, done]) => (done?.results ?? []).filter(told)),
    stopped: [...synced.crashes, ...kinds.flatMap(([item, done]) => (done?.stopped ? [{ item, outcome: 'failed' as const, message: done.stopped }] : []))],
  };
}
