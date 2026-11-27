// Profiles: named sets of items to have on, kept in `.central-knot/profiles.json`, and a switch carried out. The rules (what a
// switch changes, which profile is in use, what its Undo turns back) are profileplan.ts's. A switch is the library's own clicks,
// Turn on and Turn off, made together in one pass per kind (skills.ts applySkills, servers.ts applyServers, agents.ts
// applyAgents), and for a plugin's items each copy's own switch: an installed copy's in its tool (pluginswitch.ts click, run
// through the main process: PluginSide), in Claude Code its whole plugin's with its parts' switches, one run per plugin
// (profileplan.ts wholeRuns), a copy placed in Pi, OpenCode or Antigravity by its library item's On or Off in a pass of its own,
// and any uncovered Copilot CLI `disabledMcpServers` rule cleared on switch or Undo and restored on Undo (`runCopilotRules`);
// all of it told to History in one entry of its own, written first (librarypass.ts PassOptions told) and then left holding only
// the plugin copies and Copilot CLI rules each tool confirmed. Its Undo is each library item's own Turn on or Turn off, each with its own entry, and
// each plugin copy's own switch back (plus any uncovered Copilot CLI rule), all told in one entry of the Undo's own, which marks the switch's entry undone. Nothing per
// tool is kept here but those entries and a profile's own `tools` and `out`, and which profile is in use is never stored. A
// file from before profiles were sets of items (format 1) is read here for the page and moved once by profilemigrate.ts. A
// switch to a profile that holds `tools` or `out` also sets each of its items' keep-outs (profileplan.ts effectiveOut), told in
// its entry (`except`) and put back by its Undo.
//
//   profiles.json   { formatVersion: 3, profiles: [{ id, name, items: ['skill:notes', 'mcp:docs', 'agent:writer'], switchesPluginItems: true }] }
//                   format 4 when some profile holds `tools: ['claude-cli', …]` or `out: { 'skill:notes': ['codex-cli'] }`
//                   a plugin's item as profileplan.ts pluginItemId names it: 'plugin:skill:document-tools@team-tools/pdf'
//                   format 2 files are read as-is with switchesPluginItems false and never rewritten until a profile is saved.
//                   saveProfiles is the one writer, and the format follows the content: 4 only while some profile holds
//                   `tools` or `out`, else 3, so a writer that adds neither (a rename, a delete, profilesNaming, which a
//                   plugin's read runs with no click) never moves a file to 4; and 2 from profilemigrate.ts's format 1 move (a
//                   pass that runs without a click must not write a file the released build refuses). The first save that
//                   moves a file to 4 fills in each profile's `out` from the Library (saveProfile), so none changes meaning.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentKind, applyAgents } from './agents.ts';
import { appendHistory, clock, readHistory, replaceHistory } from './history.ts';
import { itemKey, type ItemKind } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { mcpDisabled, mcpSwitchPath, withMcpSwitch } from './mcpswitch.ts';
import { reverse, succeeded, type PluginDone, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { click } from './pluginswitch.ts';
import { changes, clearsCopilotOff, copilotKeptOnBy, copilotUndo, heldWords, wholeCounts, liveItems, onAfterUndo, outNow, pluginPlan, pluginUndo, retools, switchPlan, toolsChanged, unchanged, undoPlan, wholeRuns, withCopilotOff, type CopilotRule, type CopyTurn, type ExceptTurn, type Libraries, type LiveItem, type PluginLive, type PluginTurn, type Turns, type WholeRun } from './profileplan.ts';
import type { ReloadChange } from './reload.ts';
import { applyServers, serverKind, serversView } from './servers.ts';
import { errorCode, libraryGate, plainError, storeDirectory, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import { recordedIds } from './sourcestore.ts';
import { groupBy } from './model.ts';
import { record, strings } from './values.ts';
import { andList, harnessIds, sameTools, toolNames } from './words.ts';
import type { ApplyResult, Change, DestinationResult, HarnessId, HistoryEvent, LibraryFacts, PassResult, PluginSwitched, Profile, ProfileEdit, ProfileSwitchResult, ProfilesView } from './types.ts';

// ---------- The profiles file ----------

const FORMAT_VERSION = 4;
const profilesPath = (home: string) => join(storeDirectory(home), 'profiles.json');

/** A profile's id for an item as format 1 named it: a skill by its key, as now; an MCP server by its name as written. */
const fromFormat1 = (id: string) => (id.startsWith('mcp:') ? `mcp:${itemKey(id.slice(4))}` : id);

/** The tool ids in a list as stored, others dropped; undefined for no list. */
const toolIds = (raw: unknown) => strings(raw)?.filter((tool): tool is HarnessId => harnessIds.includes(tool as HarnessId));
/** A profile's `out` as stored, each item's tool ids (toolIds); undefined for none. */
const outOf = (raw: unknown) => {
  const map = record(raw);
  return map && Object.fromEntries(Object.entries(map).flatMap(([id, tools]) => { const list = toolIds(tools); return list ? [[id, list]] : []; }));
};
/** Whether a profile holds the fields a format 4 file stores. */
const ownsKeepOuts = (profile: Profile) => !!profile.tools || !!profile.out;

/**
 * The profiles in a profiles file: each with a string id and name, string items, and whether it switches plugin items (false for
 * format 1 and 2, or a format 3 profile missing the field); from format 4, `tools` and `out` where it holds them.
 */
const profilesOf = (raw: unknown, format: number): Profile[] => (Array.isArray(raw) ? raw : [])
  .filter(profile => profile && typeof profile.id === 'string' && typeof profile.name === 'string')
  .map(profile => {
    const tools = format >= 4 ? toolIds(profile.tools) : undefined, out = format >= 4 ? outOf(profile.out) : undefined;
    return { id: profile.id, name: profile.name, items: (strings(profile.items) ?? []).map(id => (format === 1 ? fromFormat1(id) : id)),
      switchesPluginItems: format >= 3 && profile.switchesPluginItems === true, ...(tools ? { tools } : {}), ...(out ? { out } : {}) };
  });

/**
 * The home's profiles as the file has them, with its format: 1 is a file from before profiles were sets of items, read with its
 * items' ids as they are now, which profilemigrate.ts moves to 2; 2 is read as-is with `switchesPluginItems` false and never
 * rewritten until a profile is saved. A file that can't be read, or that a newer Central Knot wrote, is reported and never
 * overwritten: the person's profiles may still be in it.
 */
export async function readProfileFile(home: string): Promise<{ view: ProfilesView; format?: number; raw?: Record<string, unknown>; text?: string }> {
  const path = profilesPath(home);
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    return { view: errorCode(error) === 'ENOENT' ? { profiles: [] } : { profiles: [], problem: `${path} could not be read, so profiles can’t be used here.` } };
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const format = typeof raw.formatVersion === 'number' ? raw.formatVersion : 1;
    if (format > FORMAT_VERSION) return { view: { profiles: [], problem: `${path} was saved by a newer Central Knot, so profiles can’t be used here. Nothing in it was changed.` } };
    return { view: { profiles: profilesOf(raw.profiles, format) }, format, raw, text };
  } catch {
    return { view: { profiles: [], problem: `${path} is not a profiles file Central Knot can read, so profiles can’t be used here. Nothing in it was changed.` } };
  }
}

/** The home's profiles, for the page and the menus, with the plugins the home records (types.ts ProfilesView `plugins`). */
export const readProfiles = async (home: string): Promise<ProfilesView> =>
  ({ ...(await readProfileFile(home)).view, plugins: (await recordedIds(home)).plugins.map(({ id, plugin, marketName, on }) => ({ id, plugin, marketName, on })) });

/**
 * Writes `profiles.json` in `format`: by default as its content needs (4 while a profile holds `tools` or `out`, else 3); format 2
 * from profilemigrate.ts's format 1 move, since a pass that runs without a click must not write a file the released build
 * refuses. Format 2 omits `switchesPluginItems`.
 */
export const saveProfiles = (home: string, profiles: Profile[], format: 2 | 3 | 4 = profiles.some(ownsKeepOuts) ? 4 : 3) => writeDurably(profilesPath(home),
  `${JSON.stringify({ formatVersion: format, profiles: format === 2 ? profiles.map(({ id, name, items }) => ({ id, name, items })) : profiles }, null, 2)}\n`);

/**
 * The home's profiles, ready to change, or why they can't be changed here: a preview-only home, a record that stops every write
 * (the page's whyReadOnly in app.ts says the same), a profiles file that can't be read, or one from before profiles were sets of
 * items, which the next pass moves first (profilemigrate.ts, once nothing waits for Resume). Editing a profile writes Central
 * Knot's own file alone, so a record waiting for Resume does not stop it (share.ts libraryGate `ownFile`).
 */
async function openProfiles(context: ShareContext): Promise<{ profiles: Profile[]; format: number } | { stop: string }> {
  const gate = await libraryGate(context, { ownFile: true });
  if ('refused' in gate) return { stop: gate.refused };
  const { view, format = FORMAT_VERSION } = await readProfileFile(context.home);
  if (view.problem) return { stop: view.problem };
  if (format === 1) return { stop: 'These profiles were made by an earlier Central Knot, and are moved to this one the next time it syncs this home. Nothing was changed.' };
  return { profiles: view.profiles, format };
}

/**
 * Adds a profile, or changes an existing one's name, items, `switchesPluginItems` or `tools`: a field left out keeps what the
 * profile has now, so a rename and a tick sent close together never undo each other. A new profile defaults to
 * `switchesPluginItems: true`; an existing one keeps `false` until opted in with `true` (which drops any `plugin:` ids while
 * keeping all of his own, dormant ones too), and once `true` stays `true`. Names are unique, ignoring case. With `restore`, `id`
 * is a deleted profile's, made again with that id (Undo of Delete) and its saved `switchesPluginItems`, `tools` and `out`.
 * Once a profile holds `tools` or `out`, each without `out` has it filled in from the Library's keep-outs of its ticked items
 * (profileplan.ts outNow), so none changes meaning, and an item newly ticked into one that holds `out` with no entry there
 * takes the Library's; on the save that moves the file to format 4, the others filled in are named (`filled`).
 */
export async function saveProfile(context: ShareContext, input: ProfileEdit): Promise<{ problem?: string; id?: string; filled?: string[] }> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return { problem: opened.stop };
  const existing = input.id ? opened.profiles.find(profile => profile.id === input.id) : undefined;
  if (input.id && !existing && !input.restore) return { problem: 'That profile is gone. Nothing was saved.' };
  const name = (input.name ?? existing?.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { problem: 'A profile needs a name.' };
  if (name.length > 40) return { problem: 'Keep the name to 40 characters or fewer.' };
  if (opened.profiles.some(profile => profile.id !== input.id && profile.name.toLowerCase() === name.toLowerCase())) return { problem: `There is already a profile called “${name}”.` };
  const optingIn = !!existing && !existing.switchesPluginItems && input.switchesPluginItems === true;
  const items = [...new Set((input.items ?? existing?.items ?? []).filter(item => /^(plugin:)?(skill|agent|mcp):./.test(item) && (!optingIn || !item.startsWith('plugin:'))))];
  const switchesPluginItems = existing ? existing.switchesPluginItems || input.switchesPluginItems === true : (input.switchesPluginItems ?? true);
  const id = existing?.id ?? (input.restore ? input.id : undefined) ?? randomUUID();
  const tools = input.tools ? toolIds(input.tools) : existing?.tools, out = input.out ? outOf(input.out) : existing?.out;
  const saved: Profile = { id, name, items, switchesPluginItems, ...(tools ? { tools } : {}), ...(out ? { out } : {}) };
  let profiles = existing ? opened.profiles.map(profile => (profile.id === id ? saved : profile)) : [...opened.profiles, saved];
  const unfilled = profiles.some(ownsKeepOuts) ? profiles.filter(profile => !profile.out) : [];
  const ticked = existing && out ? items.filter(item => !existing.items.includes(item) && !out[item]) : [];
  if (unfilled.length || ticked.length) {
    const read = await readLibraries(context, 'Nothing was saved.');
    if ('stop' in read) return { problem: read.stop };
    const live = liveItems(read.libraries, read.plugins), fill = (profile: Profile) => (unfilled.includes(profile) ? { ...profile, out: outNow(profile, live) } : profile);
    profiles = profiles.map(profile => (profile === saved && ticked.length ? { ...saved, out: { ...out, ...outNow({ items: ticked }, live) } } : fill(profile)));
  }
  await saveProfiles(context.home, profiles);
  const named = opened.format < 4 ? unfilled.filter(profile => profile.id !== id).map(profile => profile.name) : [];
  return { id, ...(named.length ? { filled: named } : {}) };
}

/**
 * The names of the profiles that name any of `ids`; with `to`, each of those ids becomes `to` in them (a plugin's root skill moved
 * by its read: library.ts A PLUGIN, THE MOVE). Profiles that can't be changed here are named by none and left as they are.
 */
export async function profilesNaming(context: ShareContext, ids: string[], to?: string): Promise<string[]> {
  const opened = await openProfiles(context);
  const naming = 'stop' in opened ? [] : opened.profiles.filter(profile => profile.items.some(item => ids.includes(item)));
  const renamed = (item: string) => (ids.includes(item) ? to! : item);
  const moved = (profile: Profile) => ({ ...profile, items: [...new Set(profile.items.map(renamed))],
    ...(profile.out ? { out: Object.fromEntries(Object.entries(profile.out).map(([item, tools]) => [renamed(item), tools])) } : {}) });
  if (to && naming.length && !('stop' in opened)) await saveProfiles(context.home, opened.profiles.map(moved));
  return naming.map(profile => profile.name);
}

/** Deletes a profile's definition. Nothing in the library or the tools changes. */
export async function deleteProfile(context: ShareContext, id: string): Promise<{ problem?: string }> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return { problem: opened.stop };
  await saveProfiles(context.home, opened.profiles.filter(profile => profile.id !== id));
  return {};
}

// ---------- The library, as a switch reads and clicks it ----------

/** Each kind's record (its Kind's `open`) and its pass, as a switch uses them. */
const KINDS: { kind: ItemKind; open: (context: ShareContext) => Promise<{ library: KindLibrary; problem?: string }>; pass: (context: ShareContext, tools: HarnessId[], changes: Change[], options: { only: Set<string>; told?: boolean }) => Promise<PassResult> }[] = [
  { kind: 'skill', open: context => skillKind.open(context), pass: applySkills },
  { kind: 'mcp', open: context => serverKind.open(context), pass: applyServers },
  { kind: 'agent', open: context => agentKind.open(context), pass: applyAgents },
];

/** Each kind's items as its record holds them now, and the plugins the home records (liveItems); or why a record can't be read, and `then` (what was therefore not done). */
export async function readLibraries(context: ShareContext, then = 'Nothing was switched.'): Promise<{ libraries: Libraries; plugins: Set<string> } | { stop: string }> {
  const libraries = {} as Libraries;
  for (const { kind, open } of KINDS) {
    const { library, problem } = await open(context);
    if (problem) return { stop: `${problem} ${then}` };
    libraries[kind] = library.items;
  }
  return { libraries, plugins: new Set((await recordedIds(context.home)).plugins.map(entry => entry.id)) };
}

/**
 * What a switch and its Undo need from the main process for a plugin's items: each item every tool has, read now (profileplan.ts
 * pluginLive), and a run of plugin steps through each tool's own switch (pluginplan.ts runPlan, with marketplaces.ts setSkill and
 * setPart).
 */
export interface PluginSide { live: () => Promise<PluginLive[]>; run: (ops: PluginOp[]) => Promise<PluginDone[]> }
/** A home read with no plugins' items, for a caller whose home has none (tests of the library's part alone). */
export const NO_PLUGINS: PluginSide = { live: async () => [], run: async () => [] };

/** The copies a plugin plan turns (pluginPlan `on` and `off`), each toward its own tool's direction. */
const copiesTurned = (plan: PluginTurn[], live: PluginLive[]): CopyTurn[] => plan.flatMap(turn => {
  const item = live.find(each => each.id === turn.id)!, at = (tool: HarnessId, on: boolean) => ({ item, copy: item.copies.find(copy => copy.tool === tool)!, on });
  return [...turn.on.map(tool => at(tool, true)), ...turn.off.map(tool => at(tool, false)), ...(turn.along ?? []).map(tool => ({ ...at(tool, true), along: true as const }))];
});
/** A plan's held copies (pluginPlan `held`), as a result says them: the item, its tool and why. */
const heldResults = (plan: PluginTurn[], live: PluginLive[]): DestinationResult[] => plan.flatMap(turn => turn.held.map(({ tool, why }) => {
  const name = live.find(each => each.id === turn.id)!.name;
  return { item: name, harness: tool, outcome: 'held' as const, message: `${name}: ${why}` };
}));
/** A copy turned, as History keeps it. */
const switched = ({ item, copy, on, along }: CopyTurn): PluginSwitched => ({ id: item.id, name: item.name, tool: copy.tool, on, ...(along ? { along } : {}) });
/** A placed copy's library item, by its kind and key, which one click turns in every tool it is in. */
const placedKey = ({ item, copy }: CopyTurn) => ('libraryKey' in copy.target ? `${item.kind}:${copy.target.libraryKey}` : undefined);

/**
 * The clicks for the placed copies in `copies` of one kind, one for each library item however many of its tools are turned,
 * taken only while it is still the plugin's (Change `forPlugin`: the same pass may let go of a copy edited since). Turned off
 * in some of the tools it is in now and not others (an Undo, after it was let into another tool), it stays On and is kept out
 * of those it is turned off in; else it is turned On or Off, kept out where it is (`libraries`, as read now).
 */
function placedClicks(kind: ItemKind, copies: CopyTurn[], libraries: Libraries): Change[] {
  return [...groupBy(copies.filter(turn => turn.item.kind === kind && placedKey(turn)), turn => placedKey(turn)!).values()].flatMap(turns => {
    const { item, copy, on } = turns[0]!, record = 'libraryKey' in copy.target ? libraries[kind][copy.target.libraryKey] : undefined;
    if (!record?.source) return [];
    const turned = turns.map(turn => turn.copy.tool);
    const stays = !on && item.copies.some(other => 'libraryKey' in other.target && other.on && !other.gone && !turned.includes(other.tool));
    return [stays ? { key: record.key, on: true, except: [...new Set([...record.except, ...turned])], seenOn: true, forPlugin: record.source }
      : { key: record.key, on, except: [...record.except], seenOn: !on, forPlugin: record.source }];
  });
}

/**
 * Turns `turns.on` On and `turns.off` Off, and keeps `turns.except` out where each says (an item it turns On, with those
 * keep-outs), the library's own clicks, one pass per kind (`told`: History has them in the caller's entry); then the placed
 * copies in `copies`, one pass per kind of their own whose entry is always the caller's (placedClicks);
 * then each installed copy by its own switch in its tool (installedCopy), but those in `runs` (a plugin in Claude Code:
 * profileplan.ts wholeRuns): each run's copies together, its parts' switches first and its plugin's only once they went through,
 * every switch it made put back if any failed. Answers what each pass and tool said, the entries the
 * library items' clicks made, what is as asked after, read back: each library item (`done`), each copy whose change its tool
 * confirmed (`copies`: a placed copy by its library item read again and that tool's own result in its pass), and the placed
 * copies whose library item is no longer the plugin's (`letGo`: edited by hand since), and each installed copy its tool found as
 * asked already (`asAsked`), which are neither turned nor failed; and the runs' steps that changed and stay so (`steps`).
 */
async function turnTogether(context: ShareContext, tools: HarnessId[], turns: Turns, told: boolean, copies: CopyTurn[], libraries: Libraries, plugins: PluginSide, runs: WholeRun[]) {
  const results: DestinationResult[] = [], made: string[] = [], placedResults: { kind: ItemKind; result: DestinationResult }[] = [], reloads: ReloadChange[] = [];
  const keptTo = new Map(turns.except.map(turn => [turn.item, turn.to]));
  for (const { kind, pass } of KINDS) {
    const asked = [...turns.on.filter(item => item.kind === kind).map(item => [item, true] as const), ...turns.off.filter(item => item.kind === kind).map(item => [item, false] as const),
      ...toolsChanged(turns).filter(turn => turn.item.kind === kind).map(turn => [turn.item, turn.item.on] as const)];
    const clicks = asked.map(([item, on]): Change => ({ key: item.key, on, except: [...keptTo.get(item) ?? item.except], seenOn: item.on }));
    for (const [list, mine, toldHere] of [[clicks, false, told], [placedClicks(kind, copies, libraries), true, true]] as const) {
      if (!list.length) continue;
      const done = await pass(context, tools, list, { only: new Set(list.map(each => each.key)), told: toldHere });
      const names = list.map(click => libraries[kind][click.key]?.name ?? click.key).join(', ');
      results.push(...done.results, ...(done.stopped ? [{ item: names, outcome: 'failed' as const, message: done.stopped }] : []));
      reloads.push(...done.reloads);
      if (mine) placedResults.push(...done.results.map(result => ({ kind, result }))); else made.push(...(done.made ?? []));
    }
  }
  const confirmed: CopyTurn[] = [], asAsked: CopyTurn[] = [], copilotDone = new Set<string>(), steps: PluginOp[] = [], inRuns = new Set(runs.flatMap(run => run.copies));
  for (const run of runs) {
    if (!run.ops.length) { asAsked.push(...run.copies); continue; }
    // The parts' own switches first, the plugin's only once they all went through.
    const parts = await plugins.run(run.ops.filter(op => op.part)), whole = run.ops.filter(op => !op.part), { plugin, tool } = run.ops[0]!;
    const done = [...parts, ...(parts.length === run.ops.length - whole.length && parts.every(each => succeeded(each.report)) ? await plugins.run(whole) : [])];
    const failed = done.filter(each => !succeeded(each.report));
    if (failed.length || done.length < run.ops.length) {
      // Every switch it made is put back; one that can't be is said, and kept in History for the Undo.
      const back = await plugins.run(reverse(done)), stuck = back.filter(each => !succeeded(each.report));
      const sameSlot = (one: PluginOp, other: PluginOp) => one.part?.kind === other.part?.kind && one.part?.name === other.part?.name;
      for (const { report: _report, ...op } of done.filter(each => each.report.changed && stuck.some(other => sameSlot(each, other)))) steps.push(op);
      const said = [...failed, ...stuck].map(({ report }) => report);
      results.push(...(said.length ? said : [{ outcome: 'failed', message: 'It stopped before it was through.' }]).map(report => ({ item: plugin, harness: tool,
        outcome: report.outcome === 'held' ? 'held' as const : 'failed' as const, message: `${plugin}: ${report.message}` })));
    } else if (done.some(each => each.report.changed)) {
      confirmed.push(...run.copies);
      for (const { report, ...op } of done.filter(each => each.report.changed)) { steps.push(op); reloads.push(...report.reloads ?? []); }
    } else asAsked.push(...run.copies);
  }
  for (const turn of copies.filter(each => !placedKey(each) && !inRuns.has(each))) {
    // Two plugins sharing an exact MCP server name in Copilot CLI share one switch: once the first confirmed it, the second did too.
    const shared = turn.item.kind === 'mcp' && turn.copy.tool === 'copilot-cli' ? `${turn.item.name}\u0000${turn.on}` : undefined;
    if (shared && copilotDone.has(shared)) { confirmed.push(turn); continue; }
    const { changed, failed, reloads: stepReloads } = await installedCopy(turn, plugins);
    if (failed) results.push(failed);
    else { (changed ? confirmed : asAsked).push(turn); if (changed && shared) copilotDone.add(shared); if (changed) reloads.push(...stepReloads); }
  }
  const after = await readLibraries(context), records = 'stop' in after ? undefined : after.libraries;
  const now = (item: LiveItem) => records && !records[item.kind][item.key]?.deleted ? records[item.kind][item.key]?.on : undefined;
  const keptAsAsked = ({ item, to }: ExceptTurn) => now(item) === (turns.on.includes(item) || (item.on && !turns.off.includes(item))) && sameTools(records![item.kind][item.key]!.except, to);
  const recordOf = ({ item, copy }: CopyTurn) => ('libraryKey' in copy.target ? records?.[item.kind][copy.target.libraryKey] : undefined);
  const letGo = copies.filter(turn => placedKey(turn) && recordOf(turn)?.source !== libraries[turn.item.kind][(turn.copy.target as { libraryKey: string }).libraryKey]?.source);
  const placedDone = (turn: CopyTurn) => {
    const record = recordOf(turn), wanted = !!record?.on && !record.except.includes(turn.copy.tool);
    // Its own result is in its kind's pass: a plugin's skill and server may share a name in one tool.
    return wanted === turn.on && !letGo.includes(turn) && !placedResults.some(({ kind, result }) => kind === turn.item.kind && result.item === record?.name
      && result.harness === turn.copy.tool && (result.outcome === 'failed' || result.outcome === 'held'));
  };
  return { results, made, reloads, done: { on: turns.on.filter(item => now(item) === true), off: turns.off.filter(item => now(item) === false), except: turns.except.filter(keptAsAsked) },
    copies: copies.filter(turn => (placedKey(turn) ? placedDone(turn) : confirmed.includes(turn))), letGo, asAsked, steps };
}

/**
 * One installed copy turned by its own switch in its tool, run by the main process: the one step pluginswitch.ts click makes for
 * it, never a whole plugin's, since a copy a plan turns outside Claude Code (whose go in runs: profileplan.ts wholeRuns) has its
 * plugin on there and a switch of its own that can be written (profileplan.ts installedWay). Answers whether the tool confirmed a
 * change (`changed`; not when it was as asked already), or what went wrong (`failed`).
 */
async function installedCopy({ item, copy, on }: CopyTurn, plugins: PluginSide): Promise<{ changed: boolean; failed?: DestinationResult; reloads: ReloadChange[] }> {
  const draft: PluginDraft = new Map();
  if ('install' in copy.target) click(draft, copy.target);
  const report = (await plugins.run([...draft.values()]))[0]?.report;
  if (report && succeeded(report)) return { changed: !!report.changed, reloads: report.changed ? report.reloads ?? [] : [] };
  return { changed: false, reloads: [], failed: { item: item.name, harness: copy.tool, outcome: report?.outcome === 'held' ? 'held' : 'failed', message: `${item.name}: ${report?.message ?? `It was not turned ${on ? 'on' : 'off'} in ${toolNames[copy.tool]}.`}` } };
}

/** History keys every profile entry with this. */
const SWITCH_KEY = 'profiles:switch';
const named = (items: LiveItem[]) => items.map(({ id, name }) => ({ id, name }));
const stopped = (why: string): ProfileSwitchResult => ({ stopped: why, on: [], off: [], left: [], results: [], reloads: [] });

/** A profile entry (types.ts HistoryEvent `profile`): a switch's, its Undo's, or the migration's (profilemigrate.ts). `item`: the profile's name. */
export const profileEvent = (context: ShareContext, item: string, profile: NonNullable<HistoryEvent['profile']>): HistoryEvent =>
  ({ id: randomUUID(), at: new Date(clock(context)).toISOString(), key: SWITCH_KEY, item, kind: 'profile', losers: [], orderProved: true, profile });

/**
 * What a switch or its Undo did, as the page tells it: the items that are now as it asked (`done`, turned On and Off, and `tools`,
 * those whose tools alone it changed; of `copies`, those `confirmed`) and those that are not (`left`), by name, a plugin's item
 * once however many tools it was turned in (one turned in one tool and not in another is in both lists); and what could not be
 * done in a tool this time.
 */
function outcome(turns: Turns, done: Turns, results: DestinationResult[], copies: CopyTurn[], confirmed: CopyTurn[]) {
  const names = (items: LiveItem[]) => items.map(item => item.name);
  const itemNames = (list: CopyTurn[]) => [...new Map(list.filter(turn => !turn.along).map(turn => [turn.item.id, turn.item.name])).values()];
  const notDone = (item: LiveItem) => (turns.on.includes(item) && !done.on.includes(item)) || (turns.off.includes(item) && !done.off.includes(item))
    || turns.except.some(turn => turn.item === item && !done.except.includes(turn));
  const left = [...new Set([...turns.on, ...turns.off, ...turns.except.map(turn => turn.item)])].filter(notDone), retooled = retools(toolsChanged(done));
  return { on: [...names(done.on), ...itemNames(confirmed.filter(turn => turn.on))], off: [...names(done.off), ...itemNames(confirmed.filter(turn => !turn.on))],
    ...(retooled.length ? { retooled } : {}), left: [...names(left), ...itemNames(copies.filter(turn => !confirmed.includes(turn)))],
    results: results.filter(result => result.outcome === 'failed' || result.outcome === 'held') };
}

const orphanClearedNote = (rule: CopilotRule) => `Copilot CLI’s off-switch for “${rule.server}” was cleared, so yours is on there.`;

/** Attaches uncovered Copilot CLI `disabledMcpServers` blocks (`profileplan.ts withCopilotOff`) to `items` and returns Copilot CLI's server rows. */
async function withCopilot(context: ShareContext, tools: HarnessId[], items: LiveItem[], live: readonly PluginLive[]) {
  if (!tools.includes('copilot-cli')) return { items, rows: [] as LibraryFacts[] };
  const { items: rows } = await serversView(context, ['copilot-cli']);
  return { items: withCopilotOff(items, rows, live), rows };
}

/** Sets or clears exact server names in Copilot CLI's `disabledMcpServers`, confirmed by reading the file back. */
async function runCopilotRules(context: ShareContext, rules: CopilotRule[], disabled: boolean) {
  const confirmed: CopilotRule[] = [], results: DestinationResult[] = [], left: string[] = [], path = mcpSwitchPath(context, 'copilot-cli');
  const fail = (rule: CopilotRule, why: string) => { results.push({ item: rule.name, harness: 'copilot-cli', outcome: 'failed', message: `${rule.server}: ${why}` }); left.push(rule.name); };
  for (const rule of rules) {
    let before: string | null, after: string;
    try {
      before = await readFile(path, 'utf8').catch(error => { if (errorCode(error) === 'ENOENT') return null; throw error; });
      if (mcpDisabled('copilot-cli', before ?? '', rule.server) === disabled) continue;
      after = withMcpSwitch('copilot-cli', before ?? '', rule.server, disabled);
    } catch { fail(rule, 'Copilot CLI’s settings.json couldn’t be read, so it was left as it is.'); continue; }
    try { await writeFileChecked(path, after, before ?? undefined); }
    catch (error) { fail(rule, errorCode(error) === 'CK_CHANGED' ? 'Copilot CLI’s settings.json changed just then, so it was left as it is. Try again.' : `Copilot CLI’s settings.json couldn’t be written. ${plainError(error)}`); continue; }
    const now = await readFile(path, 'utf8').catch(() => null);
    if (now !== null && mcpDisabled('copilot-cli', now, rule.server) === disabled) confirmed.push(rule);
    else fail(rule, `Still ${disabled ? 'on' : 'off'} in Copilot CLI: its settings.json did not take the change.`);
  }
  return { confirmed, results, left };
}

/** Keeps only what actually switched (library items, their keep-outs, confirmed plugin copies, whole steps and orphan clears) plus settings notes; returns the settled payload. */
async function settleEntry(context: ShareContext, eventId: string, turned: Turns, confirmed: CopyTurn[],
  steps: PluginOp[], settingsChanged: string[], copilotCleared?: CopilotRule[]): Promise<HistoryEvent['profile']> {
  const history = await readHistory(context), entry = history.find(each => each.id === eventId);
  if (!entry?.profile) return undefined;
  entry.profile.on = named(turned.on);
  entry.profile.off = named(turned.off);
  if (entry.profile.except) { const kept = retools(turned.except); if (kept.length) entry.profile.except = kept; else delete entry.profile.except; }
  if (entry.profile.plugins) entry.profile.plugins = confirmed.map(switched);
  if (entry.profile.wholeSteps) { if (steps.length) entry.profile.wholeSteps = steps; else delete entry.profile.wholeSteps; }
  if (copilotCleared) { if (copilotCleared.length) entry.profile.copilotCleared = copilotCleared; else delete entry.profile.copilotCleared; }
  if (settingsChanged.length) entry.settingsChanged = settingsChanged;
  await replaceHistory(context, history);
  return entry.profile;
}

const short = (done: Turns, planned: Turns) => done.on.length < planned.on.length || done.off.length < planned.off.length || done.except.length < planned.except.length;

/** Confirmed Copilot CLI off-switches cleared solely because the profile names his own server of that exact name (said in result and History). */
function clearedForHis(profile: Profile, confirmed: CopyTurn[]): string[] {
  const names = [...new Set(confirmed.filter(turn => turn.on && turn.copy.tool === 'copilot-cli' && turn.item.kind === 'mcp'
    && copilotKeptOnBy(profile, turn.item, turn.copy)?.by === 'own').map(turn => turn.item.name))];
  return names.map(name => `Copilot CLI’s off-switch for “${name}” was cleared; there the plugin’s “${name}” runs, not yours (same name).`);
}

// ---------- Switching, and its Undo ----------

/** Switches to a profile: library items (switchPlan) with their keep-outs, orphan Copilot CLI off-switches (`LiveItem.copilotOff`), and plugin copies (pluginPlan). */
export async function switchProfile(context: ShareContext, tools: HarnessId[], id: string, plugins: PluginSide): Promise<ProfileSwitchResult> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return stopped(opened.stop);
  const profile = opened.profiles.find(each => each.id === id);
  if (!profile) return stopped('That profile is gone. Nothing was switched.');
  const read = await readLibraries(context);
  if ('stop' in read) return stopped(read.stop);
  const live = await plugins.live(), { items } = await withCopilot(context, tools, liveItems(read.libraries, read.plugins, tools), live);
  const planned = switchPlan(profile, items), turns: Turns = { on: planned.on.filter(item => !item.on), off: planned.off, except: planned.except };
  const clears: CopilotRule[] = planned.on.filter(item => clearsCopilotOff(profile, item)).map(item => ({ id: item.id, name: item.name, server: item.copilotOff! }));
  const plan = pluginPlan(profile, live), copies = copiesTurned(plan, live), runs = wholeRuns(profile, copies, live), held = heldResults(plan, live);
  if (unchanged(planned) && !copies.length && !runs.length) return held.length ? stopped(`${heldWords(plan, live).text}. Nothing was switched.`) : { name: profile.name, on: [], off: [], left: [], results: [], reloads: [] };
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stopped(`${gate.refused} Nothing was switched.`);
  const steps = runs.flatMap(run => run.ops), kept = retools(turns.except);
  const event = profileEvent(context, profile.name, { toName: profile.name, on: named(turns.on), off: named(turns.off), ...(kept.length ? { except: kept } : {}),
    ...(copies.length ? { plugins: copies.map(switched) } : {}), ...(steps.length ? { wholeSteps: steps } : {}), ...(clears.length ? { copilotCleared: clears } : {}) });
  await appendHistory(context, [event]);
  const done = await turnTogether(context, tools, turns, true, copies, read.libraries, plugins, runs), rules = await runCopilotRules(context, clears, false);
  const settingsChanged = [...done.results.flatMap(result => (result.settingsChanged ? [result.settingsChanged] : [])), ...clearedForHis(profile, done.copies),
    ...rules.confirmed.map(orphanClearedNote)];
  const settled = short(done.done, turns) || done.copies.length < copies.length || done.steps.length < steps.length || rules.confirmed.length < clears.length || settingsChanged.length
    ? await settleEntry(context, event.id, done.done, done.copies, done.steps, settingsChanged, clears.length ? rules.confirmed : undefined)
    : event.profile;
  const out = outcome(turns, done.done, [...held, ...done.results, ...rules.results], copies.filter(turn => !done.asAsked.includes(turn)), done.copies);
  return { name: profile.name, on: [...out.on, ...rules.confirmed.filter(rule => !done.done.on.some(item => item.id === rule.id)).map(rule => rule.name)],
    off: out.off, ...(out.retooled ? { retooled: out.retooled } : {}), left: [...new Set([...out.left, ...rules.left])], results: out.results, event: event.id, profile: settled, ...(settingsChanged.length ? { settingsChanged } : {}), reloads: done.reloads };
}

/** Undo of a profile entry: turns back library items (their keep-outs too), plugin copies and uncovered Copilot CLI rules still as left, never re-disabling a name his server uses now, and clears any uncovered rule blocking a server it turns back on. */
export async function undoSwitch(context: ShareContext, tools: HarnessId[], eventId: string, plugins: PluginSide): Promise<ApplyResult> {
  const stop = (why: string): ApplyResult => ({ stopped: why, results: [], harnessWrites: 0, reloads: [] });
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  if (!past?.profile?.on || past.profile.undoOf || past.undoneBy) return stop('That switch has nothing to undo.');
  const read = await readLibraries(context);
  if ('stop' in read) return stop(read.stop);
  const livePlugins = await plugins.live(), { items, rows } = await withCopilot(context, tools, liveItems(read.libraries, read.plugins, tools), livePlugins);
  const turns = undoPlan(past, items), afterOn = onAfterUndo(items, turns), { back, whole, left, keptOff: pluginKept } = pluginUndo(past, livePlugins, afterOn);
  const { back: copilotBack, keptOff: ruleKept } = copilotUndo(past, rows, read.libraries.mcp, afterOn);
  const copilotClear: CopilotRule[] = turns.on.filter(item => item.copilotOff).map(item => ({ id: item.id, name: item.name, server: item.copilotOff! }));
  const keptNotes = [...new Set([...pluginKept, ...ruleKept])].map(name => `Copilot CLI’s off-switch for “${name}” was left off: a server of yours has that name there now.`);
  if (unchanged(turns) && !back.length && !whole.length && !copilotBack.length) return stop(keptNotes.join(' ') || 'Nothing to undo: each item that switch changed was changed again since.');
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stop(`${gate.refused} Nothing was undone.`);
  const kept = retools(turns.except);
  const undo = back.length || whole.length || copilotBack.length || copilotClear.length ? profileEvent(context, past.item, { toName: past.profile.toName, undoOf: past.id, on: named(turns.on), off: named(turns.off), ...(kept.length ? { except: kept } : {}),
    ...(back.length ? { plugins: back.map(switched) } : {}), ...(whole.length ? { wholeSteps: whole.flatMap(run => run.ops) } : {}), ...(copilotBack.length ? { copilotCleared: copilotBack } : {}) }) : undefined;
  if (undo) await appendHistory(context, [undo]);
  const { results, made, reloads, done, copies, letGo, asAsked, steps } = await turnTogether(context, tools, turns, false, back, read.libraries, plugins, whole);
  const rules = await runCopilotRules(context, copilotBack, true), cleared = await runCopilotRules(context, copilotClear, false);
  const undoNotes = [...keptNotes, ...cleared.confirmed.map(orphanClearedNote)];
  const planned = whole.flatMap(run => run.ops).length;
  if (undo && (short(done, turns) || copies.length < back.length || steps.length < planned || rules.confirmed.length < copilotBack.length || undoNotes.length))
    await settleEntry(context, undo.id, done, copies, steps, undoNotes, copilotBack.length ? rules.confirmed : undefined);
  const { results: notDone, ...switchedBack } = outcome(turns, done, [...results, ...rules.results, ...cleared.results], back.filter(turn => !asAsked.includes(turn) && !letGo.includes(turn)), copies);
  // What a tool refused to turn back leaves the switch undoable, for that part, once the refusal clears.
  const by = notDone.length ? undefined : (undo && (copies.length || steps.length || rules.confirmed.length || cleared.confirmed.length) ? undo.id : undefined) ?? made[0];
  if (by) { const now = await readHistory(context), entry = now.find(each => each.id === eventId); if (entry) { entry.undoneBy = by; await replaceHistory(context, now); } }
  const since = [...left.map(({ copy, why }) => `${copy.name} in ${toolNames[copy.tool]}, ${why}`),
    // An item turned Off since is left, as its On and Off are.
    ...(past.profile.except ?? []).filter(was => !turns.except.some(turn => turn.item.id === was.id) && items.some(item => item.id === was.id && item.on))
      .map(was => `${was.name}’s tools, changed since the switch`),
    ...[...groupBy(letGo, turn => turn.item.id).values()].map(list => `${list[0]!.item.name} in ${andList(list.map(turn => toolNames[turn.copy.tool]))}, edited by hand since, so it is your own now`)];
  return { results: notDone, harnessWrites: changes(done) + toolsChanged(done).length + copies.length + rules.confirmed.length + cleared.confirmed.length, made,
    switched: { on: switchedBack.on, off: [...switchedBack.off, ...rules.confirmed.filter(rule => !done.off.some(item => item.id === rule.id)).map(rule => rule.name)], ...(switchedBack.retooled ? { retooled: switchedBack.retooled } : {}),
      left: [...new Set([...switchedBack.left, ...rules.left, ...cleared.left])], ...(since.length ? { since } : {}), ...(undoNotes.length ? { settingsChanged: undoNotes } : {}), ...(steps.length ? { plugins: wholeCounts({ steps }) } : {}) },
    reloads };
}
