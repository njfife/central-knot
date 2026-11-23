// One pass over the open home, in the order main.ts runs it at start and at every look after (main.ts pass, the one caller in
// the app; tests/upgrade.test.ts runs it over homes older versions made):
//   1. a profiles file from before profiles were sets of library items is moved, with Sync on or off (profilemigrate.ts);
//   2. plugin parts from before the library become items linked to their plugin, with Sync on or off (partsmigrate.ts: it
//      waits for the plugins record, which main.ts asks for first while there are parts, marketplaces.ts beforeParts);
//   2b. a plugins record written knowing fewer tools than this build keeps its plugins' items out of the others where it
//      keeps them out of some (pluginrecord.ts bringForward), before anything is written in a tool;
//   3. where this build syncs the home and the pass may write (Sync on, or Sync once), skills, MCP servers and agents are
//      brought into line, in that order, each on its own: one that crashes is told as a failure and the next still runs.
//      This is the pass of the whole home, the one in which Synchronize everything takes found items in
//      (librarypass.ts PassOptions background).
// What such a pass tells the page is decided here too, for every kind alike (passTells): main.ts keeps it until the page reads;
// and what a person would see of the home as the pass read it, as one value (pageSees), which main.ts compares with the last
// the page was given (seenChanged).
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
import { sha256, syncsHere, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import { installedCopies, type InstalledCopyOf } from './plugins.ts';
import { loadsKind } from './pluginstatus.ts';
import { bringForward } from './pluginrecord.ts';
import { takesPlugins } from './presence.ts';
import { itemKey } from './library.ts';
import { reloadsFor, type ReloadChange } from './reload.ts';
import type { DestinationResult, HarnessId, PassResult, Reason } from './types.ts';

/**
 * What one pass did. `synced`: absent when step 3 did not run (Sync off, or this build doesn't sync the home); a kind's result
 * is absent when it crashed, and the crash is in `crashes`. `profilesFailed`, `partsFailed`: why step 1 or 2 failed, for the log;
 * `partsWait`: why step 2 waits, for the log and the Plugins page (main.ts keeps it: MarketplaceHost partsWait). `seen`: what
 * a person would see of the home as step 3 read it (pageSees); absent where that isn't known. `seenFailed`: why pageSees threw,
 * for the log. `untouched`: every kind's pass of step 3 left the home as it read it (types.ts PassResult untouched), so a view
 * made right after may be made from those reads (main.ts syncAndView); absent where one wrote, stopped, crashed or didn't run.
 */
export interface HomePass {
  synced?: { skills?: PassResult; servers?: PassResult; agents?: PassResult; crashes: DestinationResult[] };
  untouched?: true;
  seen?: string;
  seenFailed?: unknown;
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
  await bringForward(context, [skillKind, agentKind, serverKind]).catch((error: unknown) => { partsFailed ??= error ?? 'failed'; });
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
  let seenFailed: unknown;
  const synced = { skills, servers, agents, crashes };
  const seen = await pageSees(context, managed, synced).catch((error: unknown) => { seenFailed = error ?? 'failed'; return undefined; });
  const untouched = [skills, servers, agents].every(done => done?.untouched);
  return { ...failure, synced, ...(seen ? { seen } : {}), ...(seenFailed === undefined ? {} : { seenFailed }), ...(untouched ? { untouched: true as const } : {}) };
}

/**
 * What a person would see of the home, from what one pass of the whole home read, as one value (a hash): main.ts tells an open
 * page when a background pass's differs from the last one the page was given (main.ts seenChanged), so an edit, a loss or a gain
 * no pass writes for still reaches the page and its search index. Made from this pass's own reads (`context.reads`, as main.ts
 * pass gives them), nothing read again, and sorted so that no order changes it:
 *   - each found item's copies, by kind and key: the hash of each managed tool's copy (PassResult found; a skill's of its
 *     copyable tree, an agent's of its name, description and prompt, an MCP server's of its neutral fields);
 *   - each plugin a managed tool has installed, as this pass read it (plugins.ts installedCopies, which the skills' read made:
 *     skills.ts readDisk, through plugins.ts throughPlugins), field by field: its name and marketplace, whether the tool has it
 *     off, its copy's state and version, whether it is loaded live from a folder marketplace, which of its skills, MCP servers
 *     and agents the tool has off, and the text of each skill, MCP server and agent of it the page lists. Why a switch is held
 *     comes from a tool's switch file, whose every event tells the page (main.ts startWatching).
 * Left out on purpose: any time, and the folder a plugin is cached in (named for a commit where it has no version); Codex's
 * plugin agents (the page lists none); a plugin's manifest, commands, hooks, instructions and LSP servers, and the marketplace
 * entries a tool added itself (the plugins' own page reads those itself: marketplaces.ts). Not told by it either: a tool's own
 * field that a found agent's or server's hash leaves out (an agent's `model:` or `tools:` line, say), an edit of a library
 * item's copy that leaves its hash as it was, and usage (its own reader). Undefined, never an empty home's value, where
 * a kind's pass didn't reach its look (refused, no record, crashed) or a plugin read threw; a tool's plugin record that can't
 * be read is read as none, as its rows are.
 */
export async function pageSees(context: ShareContext, managed: HarnessId[], synced: NonNullable<HomePass['synced']>): Promise<string | undefined> {
  const kinds = [['skills', synced.skills], ['mcp', synced.servers], ['agents', synced.agents]] as const;
  if (kinds.some(([, done]) => !done?.found)) return undefined;
  const found = kinds.map(([kind, done]) => [kind,
    Object.entries(done!.found!).map(([key, copies]) => [key, Object.entries(copies).sort(byName)] as const).sort(byName)]);
  const reading = { home: context.home, dataDir: '', binaries: {}, overrides: context.overrides, reads: context.reads };
  const named = (parts: { name: string; text?: string; entry?: string }[]) => parts.map(part => [part.name, part.text ?? part.entry] as const).sort(byName);
  const shown = (tool: HarnessId) => ({ plugin, marketplace, off, state, contents, serversOff = [], agentsOff = [] }: InstalledCopyOf) => {
    const installed = state.state === 'installed' ? state : undefined, sorted = (names: string[]) => [...names].sort();
    const parts = contents && [named(contents.skills), named(contents.mcpServers), named(loadsKind(tool, 'agent') ? contents.agents : [])];
    return [`${plugin}@${marketplace}`, { off, state: state.state, version: installed?.version, live: installed?.live,
      skillsOff: sorted((installed?.skillsOff ?? []).map(each => each.skill)), serversOff: sorted(serversOff), agentsOff: sorted(agentsOff), parts }] as const;
  };
  const plugins = await Promise.all(managed.filter(takesPlugins).sort()
    .map(async tool => [tool, (await installedCopies(reading, tool)).map(shown(tool)).sort(byName)]));
  return sha256(JSON.stringify({ found, plugins }));
}
/** Sorts entries by their first part, a name. */
const byName = (one: readonly [string, unknown], other: readonly [string, unknown]) => one[0].localeCompare(other[0]);

/**
 * What the page is told of one pass of the whole home, every kind alike (main.ts keeps it for the next view: types.ts SyncView
 * caughtUp). `copies`: each copy the pass wrote or removed, with its kind (the Harnesses page's Caught up band names those
 * written: model.ts caughtUpNames) and each that failed. `stopped`: each kind whose pass crashed or stopped part-way, and why
 * (with `copies`' failures, the problems band). An item left for a choice of copy is not told here: its row says it waits.
 */
export function passTells(synced: NonNullable<HomePass['synced']>): { copies: DestinationResult[]; stopped: DestinationResult[] } {
  const kinds = [[passNames.skills, synced.skills, 'skills'], [passNames.servers, synced.servers, 'mcp'], [passNames.agents, synced.agents, 'agents']] as const;
  const told = (result: DestinationResult) => result.outcome === 'written' || result.outcome === 'removed' || result.outcome === 'failed';
  return {
    // Each copy with its kind (DestinationResult of), so a skill and an agent of one name are told apart.
    copies: kinds.flatMap(([, done, of]) => (done?.results ?? []).filter(told).map(result => ({ ...result, of }))),
    stopped: [...synced.crashes, ...kinds.flatMap(([item, done]) => (done?.stopped ? [{ item, outcome: 'failed' as const, message: done.stopped }] : []))],
  };
}

/** Confirmed changes made for the items Synchronize everything itself took in during these passes (never unrelated catch-up). */
export const takenInReloads = (passes: NonNullable<HomePass['synced']>[]): ReloadChange[] =>
  passes.flatMap(pass => (['skills', 'servers', 'agents'] as const).flatMap(key => {
    const run = pass[key], taken = new Set((run?.notices ?? []).flatMap(notice => (notice.kind === 'taken-in' ? notice.items.map(itemKey) : [])));
    return run && taken.size ? reloadsFor(run.reloads, taken) : [];
  }));

/** The result of one explicit request. Keep each kind apart and name the tools from the writes themselves.
 * For each tool its last result decides whether a refusal still stands. A deleted-by-hand notice says what turned Off
 * when no copy result already describes the removal. What was done goes in the sentence, folded past three items; each
 * refusal in a tool is a reason of its own, never folded. */
export function syncOnceReport(passes: NonNullable<HomePass['synced']>[], stopped?: string) {
  const completed: { text: string; taken: boolean; refused: boolean }[] = [], refused: Reason[] = [], problems = new Set(passes.flatMap(pass => pass.crashes.map(crash => crash.message)));
  if (stopped) problems.add(stopped);
  const kinds = (['skills', 'mcp', 'agents'] as const).map(kind => {
    const key = kind === 'mcp' ? 'servers' : kind;
    const runs = passes.flatMap(pass => pass[key] ?? []);
    for (const run of runs) if (run.stopped) problems.add(run.stopped);
    const results = groupBy([...runs.flatMap(run => run.results), ...(passes.at(-1)?.[key]?.unread ?? [])], result => result.item);
    const notices = runs.flatMap(run => run.notices ?? []);
    return { kind, results, runs, notices, names: new Set([...results.keys(), ...notices.flatMap(noticeNames)]) };
  });
  // An item's kind is named where an item of another kind in the result has its name, as a run's words do (words.ts rowNames).
  const among = kinds.flatMap(({ kind, names }) => [...names].map(name => ({ kind, name })));
  for (const { kind, results, notices, names } of kinds) {
    const say = sentences(libraryWords[kind]);
    for (const name of names) {
      const label = rowNames([{ kind, name }], among)[0]!;
      // What it did with the item goes in the sentence; each refusal, in a tool, is a reason of its own, in the Library's parts.
      const copies = results.get(name) ?? [], parts: string[] = [], refusals: Reason[] = [];
      let taken = false;
      for (const outcome of ['removed', 'written'] as const) {
        const tools = [...new Set(copies.flatMap(copy => copy.harness && copy.outcome === outcome ? [copy.harness] : []))];
        if (tools.length) parts.push(outcome === 'removed' ? `Removed ${label} from ${toolList(tools)}.` : `Copied ${label} to ${toolList(tools)}.`);
      }
      // What a copy's write or removal also changed in a tool's own settings (Pi's list: librarypass.ts Kind.follow).
      parts.push(...new Set(copies.flatMap(copy => (copy.settingsChanged ? [copy.settingsChanged] : []))));
      for (const copy of new Map(copies.map(copy => [copy.harness, copy])).values()) {
        if (copy.outcome !== 'held' && copy.outcome !== 'failed') continue;
        refusals.push([label, `${copy.harness ? ` (${toolName(copy.harness)})` : ''}: ${copy.message}`]);
      }
      for (const notice of notices) {
        if (notice.kind === 'taken-in' && notice.items.includes(name)) { taken = true; parts.push(`Took in ${label}.`); }
        else if (notice.kind !== 'taken-in' && notice.item === name && ((!parts.length && !refusals.length) || notice.kind !== 'deleted-by-hand')) {
          parts.push(say.noticeWords({ ...notice, item: label }).text);
        }
      }
      refused.push(...refusals);
      if (parts.length) completed.push({ text: parts.join(' '), taken, refused: refusals.length > 0 });
    }
  }
  const last = passes.at(-1);
  if (last?.skills?.settling || last?.servers?.settling || last?.agents?.settling) problems.add('Some copies are still settling. Sync again after they finish saving.');
  // What was done with an item a tool refused stays beside its refusal; the rest folds past three items.
  const folded = completed.length > 3 ? completed.filter((item, at) => at >= 2 && !item.refused) : [];
  const taken = folded.filter(item => item.taken).length, changed = folded.length - taken;
  const lines = completed.filter(item => !folded.includes(item)).map(item => item.text);
  if (taken) lines.push(`Sync once ${tookInCount(taken, true)}.`);
  if (changed) lines.push(`Changed ${plural(changed, 'more item')}.`);
  // What it could not do is its reasons, each a problem line of its own (app.ts Outcome); its sentence says so first.
  const text = [problems.size || refused.length ? 'Not everything was synced.' : '', ...lines].filter(Boolean).join(' ') || 'Nothing to do.';
  const reloads = kinds.flatMap(({ runs }) => runs.flatMap(run => run.reloads));
  return { text, reasons: [...problems, ...refused], warn: problems.size + refused.length > 0, history: folded.length > 0, reloads };
}
