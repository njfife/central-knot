// One pass over the open home, in the order main.ts runs it at start and at every look after (main.ts pass, the one caller in
// the app; tests/upgrade.test.ts runs it over homes older versions made):
//   1. a profiles file from before profiles were sets of library items is moved, with Sync on or off (profilemigrate.ts);
//   2. plugin parts from before the library become items linked to their plugin, with Sync on or off (partsmigrate.ts: it
//      waits for the plugins record, which main.ts asks for first while there are parts, marketplaces.ts beforeParts);
//   3. where this build syncs the home and the pass may write (Sync on, or Sync once), skills, MCP servers and agents are
//      brought into line, in that order, each on its own: one that crashes is told as a failure and the next still runs.
//      This is the pass of the whole home, the one in which Synchronize everything takes found items in
//      (librarypass.ts PassOptions background).
// What such a pass tells the page is decided here too, for every kind alike (passTells): main.ts keeps it until the page reads.
// Sync once reports just its own passes (syncOnceReport), with each kind's results still apart.
// The other three one-time migrations run as each library is opened (skillstore.ts, serverstore.ts, agentstore.ts
// openLibrary): only in memory for a reader such as the pages' views, and written by the first pass that may write.
import { groupBy, noticeNames, plural, tookInCount } from './model.ts';
import { rowNames, toolList, toolName } from './words.ts';
import { libraryWords, sentences } from './libraryrow.ts';
import { agentKind, applyAgents } from './agents.ts';
import { migrateParts, type PluginNow } from './partsmigrate.ts';
import { migrateProfiles } from './profilemigrate.ts';
import { applyServers, serverKind } from './servers.ts';
import { syncsHere, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import type { DestinationResult, HarnessId, PassResult } from './types.ts';

/**
 * What one pass did. `synced`: absent when step 3 did not run (Sync off, or this build doesn't sync the home); a kind's result
 * is absent when it crashed, and the crash is in `crashes`. `profilesFailed`, `partsFailed`: why step 1 or 2 failed, for the log;
 * `partsWait`: why step 2 waits, for the log and the Plugins page (main.ts keeps it: MarketplaceHost partsWait).
 */
export interface HomePass {
  synced?: { skills?: PassResult; servers?: PassResult; agents?: PassResult; crashes: DestinationResult[] };
  profilesFailed?: unknown;
  partsFailed?: unknown;
  partsWait?: string;
}

/** Each kind's pass as a failure of it is named on the page ("MCP sync: …"), whether it crashed or stopped part-way. */
const passNames = { skills: 'Skills sync', servers: 'MCP sync', agents: 'Agents sync' } as const;

/**
 * One pass over the home (the header says what it does). `writes`: Sync is on, or the person asked for this pass. `pluginNow`:
 * how step 2 reads a plugin (marketplaces.ts beforeParts), while there are parts.
 */
export async function homePass(context: ShareContext, managed: HarnessId[], writes: boolean, pluginNow?: PluginNow): Promise<HomePass> {
  let profilesFailed: unknown, partsFailed: unknown;
  await migrateProfiles(context, managed).catch((error: unknown) => { profilesFailed = error ?? 'failed'; });
  const moved = migrateParts(context, managed, [skillKind, agentKind, serverKind], pluginNow);
  const { waits: partsWait } = await moved.catch((error: unknown): { waits?: string } => { partsFailed = error ?? 'failed'; return {}; });
  const failure = { ...(profilesFailed === undefined ? {} : { profilesFailed }), ...(partsFailed === undefined ? {} : { partsFailed }), ...(partsWait ? { partsWait } : {}) };
  if (!(await syncsHere(context)) || !writes) return failure;
  const crashes: DestinationResult[] = [];
  const crashed = (item: string) => (error: unknown) => {
    crashes.push({ item, outcome: 'failed', message: `${item} could not finish: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  };
  // Skills, MCP servers and agents are Central Knot's library (library.ts).
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
 * (with `copies`' failures, the problems band). An item left for a choice of copy is not told here: its row says it waits.
 */
export function passTells(synced: NonNullable<HomePass['synced']>): { copies: DestinationResult[]; stopped: DestinationResult[] } {
  const kinds = [[passNames.skills, synced.skills], [passNames.servers, synced.servers], [passNames.agents, synced.agents]] as const;
  const told = (result: DestinationResult) => result.outcome === 'written' || result.outcome === 'removed' || result.outcome === 'failed';
  return {
    copies: kinds.flatMap(([, done]) => (done?.results ?? []).filter(told)),
    stopped: [...synced.crashes, ...kinds.flatMap(([item, done]) => (done?.stopped ? [{ item, outcome: 'failed' as const, message: done.stopped }] : []))],
  };
}

/** The result of one explicit request. Keep each kind apart and name the tools from the writes themselves.
 * For each tool its last result decides whether a refusal still stands. A deleted-by-hand notice says what turned Off
 * when no copy result already describes the removal. Fold only completed items; keep every outstanding problem. */
export function syncOnceReport(passes: NonNullable<HomePass['synced']>[], stopped?: string) {
  const completed: { text: string; taken: boolean }[] = [], problems = new Set(passes.flatMap(pass => pass.crashes.map(crash => crash.message)));
  if (stopped) problems.add(stopped);
  const kinds = (['skills', 'mcp', 'agents'] as const).map(kind => {
    const key = kind === 'mcp' ? 'servers' : kind;
    const runs = passes.flatMap(pass => pass[key] ?? []);
    for (const run of runs) if (run.stopped) problems.add(run.stopped);
    const results = groupBy([...runs.flatMap(run => run.results), ...(passes.at(-1)?.[key]?.unread ?? [])], result => result.item);
    const notices = runs.flatMap(run => run.notices ?? []);
    return { kind, results, notices, names: new Set([...results.keys(), ...notices.flatMap(noticeNames)]) };
  });
  // An item's kind is named where an item of another kind in the result has its name, as a run's words do (words.ts rowNames).
  const among = kinds.flatMap(({ kind, names }) => [...names].map(name => ({ kind, name })));
  for (const { kind, results, notices, names } of kinds) {
    const say = sentences(libraryWords[kind]);
    for (const name of names) {
      const label = rowNames([{ kind, name }], among)[0]!;
      const copies = results.get(name) ?? [], parts: string[] = [];
      let taken = false, refused = false;
      for (const outcome of ['removed', 'written'] as const) {
        const tools = [...new Set(copies.flatMap(copy => copy.harness && copy.outcome === outcome ? [copy.harness] : []))];
        if (tools.length) parts.push(outcome === 'removed' ? `Removed ${label} from ${toolList(tools)}.` : `Copied ${label} to ${toolList(tools)}.`);
      }
      for (const copy of new Map(copies.map(copy => [copy.harness, copy])).values()) {
        if (copy.outcome !== 'held' && copy.outcome !== 'failed') continue;
        refused = true;
        const action = copy.removal ? 'remove' : 'change', where = copy.removal ? 'from' : 'in';
        parts.push(`Couldn’t ${action} ${label}${copy.harness ? ` ${where} ${toolName(copy.harness)}` : ''}. ${copy.message}`);
      }
      for (const notice of notices) {
        if (notice.kind === 'taken-in' && notice.items.includes(name)) { taken = true; parts.push(`Took in ${label}.`); }
        else if (notice.kind !== 'taken-in' && notice.item === name && (!parts.length || notice.kind !== 'deleted-by-hand')) {
          parts.push(say.noticeWords({ ...notice, item: label }).text);
        }
      }
      if (refused) problems.add(parts.join(' '));
      else if (parts.length) completed.push({ text: parts.join(' '), taken });
    }
  }
  const last = passes.at(-1);
  if (last?.skills?.settling || last?.servers?.settling || last?.agents?.settling) problems.add('Some copies are still settling. Sync again after they finish saving.');
  const folded = completed.length > 3 ? completed.splice(2) : [];
  const taken = folded.filter(item => item.taken).length, changed = folded.length - taken;
  const lines = completed.map(item => item.text);
  if (taken) lines.push(`Sync once ${tookInCount(taken, true)}.`);
  if (changed) lines.push(`Changed ${plural(changed, 'more item')}.`);
  return { text: [...lines, ...problems].join('\n') || 'Nothing to do.', warn: problems.size > 0, history: folded.length > 0 };
}
