// Profiles: named sets of items to have on, kept in `.central-knot/profiles.json`, and a switch carried out. The rules (what a
// switch changes, which profile is in use, what its Undo turns back) are profileplan.ts's. A switch is the library's own clicks,
// Turn on and Turn off, made together in one pass per kind (skills.ts applySkills, servers.ts applyServers, agents.ts
// applyAgents), and for a plugin's items each copy's own switch: an installed copy's in its tool (pluginswitch.ts click, run
// through the main process: PluginSide), a copy placed in Pi or OpenCode by its library item's On or Off in the same pass; all of
// it told to History in one entry of its own, written first (librarypass.ts PassOptions told) and then left holding only the
// plugin copies each tool confirmed. Its Undo is each library item's own Turn on or Turn off, each with its own entry, and each
// plugin copy's own switch back, with none. Nothing per tool is kept here but that entry, and which profile is in use is never
// stored. A file from before profiles were sets of items (format 1) is read here for the page and moved once by
// profilemigrate.ts.
//
//   profiles.json   { formatVersion: 2, profiles: [{ id, name, items: ['skill:notes', 'mcp:docs', 'agent:writer'] }] }
//                   a plugin's item as profileplan.ts pluginItemId names it: 'plugin:skill:document-tools@team-tools/pdf'
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentKind, applyAgents } from './agents.ts';
import { appendHistory, clock, readHistory, replaceHistory } from './history.ts';
import { itemKey, type ItemKind } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { succeeded, type PluginDone, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { click } from './pluginswitch.ts';
import { changes, liveItems, pluginPlan, pluginUndo, switchPlan, undoPlan, type CopyTurn, type Libraries, type LiveItem, type PluginLive, type PluginTurn, type Turns } from './profileplan.ts';
import { applyServers, serverKind } from './servers.ts';
import { errorCode, libraryGate, storeDirectory, writeDurably, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import { recordedIds } from './sourcestore.ts';
import { strings } from './values.ts';
import { toolNames } from './words.ts';
import type { ApplyResult, Change, DestinationResult, HarnessId, HistoryEvent, PassResult, PluginSwitched, Profile, ProfileEdit, ProfileSwitchResult, ProfilesView } from './types.ts';

// ---------- The profiles file ----------

const FORMAT_VERSION = 2;
export const profilesPath = (home: string) => join(storeDirectory(home), 'profiles.json');

/** A profile's id for an item as format 1 named it: a skill by its key, as now; an MCP server by its name as written. */
const fromFormat1 = (id: string) => (id.startsWith('mcp:') ? `mcp:${itemKey(id.slice(4))}` : id);

/** The profiles in a profiles file: each with a string id and name; items kept only as strings. */
const profilesOf = (raw: unknown, format: number): Profile[] => (Array.isArray(raw) ? raw : [])
  .filter(profile => profile && typeof profile.id === 'string' && typeof profile.name === 'string')
  .map(profile => ({ id: profile.id, name: profile.name, items: (strings(profile.items) ?? []).map(id => (format === 1 ? fromFormat1(id) : id)) }));

/**
 * The home's profiles as the file has them, with its format: 1 is a file from before profiles were sets of items, read with
 * its items' ids as they are now, which profilemigrate.ts moves to 2. A file that can't be read, or that a newer Central Knot
 * wrote, is reported and never overwritten: the person's profiles may still be in it.
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

/** Writes the profiles as format 2. */
export const saveProfiles = (home: string, profiles: Profile[]) =>
  writeDurably(profilesPath(home), `${JSON.stringify({ formatVersion: FORMAT_VERSION, profiles }, null, 2)}\n`);

/**
 * The home's profiles, ready to change, or why they can't be changed here: a preview-only home, a record that stops every write
 * (the page's whyReadOnly in app.ts says the same), a profiles file that can't be read, or one from before profiles were sets of
 * items, which the next pass moves first (profilemigrate.ts, once nothing waits for Resume). Editing a profile writes Central
 * Knot's own file alone, so a record waiting for Resume does not stop it (share.ts libraryGate `ownFile`).
 */
async function openProfiles(context: ShareContext): Promise<{ profiles: Profile[] } | { stop: string }> {
  const gate = await libraryGate(context, { ownFile: true });
  if ('refused' in gate) return { stop: gate.refused };
  const { view, format } = await readProfileFile(context.home);
  if (view.problem) return { stop: view.problem };
  if (format === 1) return { stop: 'These profiles were made by an earlier Central Knot, and are moved to this one the next time it syncs this home. Nothing was changed.' };
  return { profiles: view.profiles };
}

/**
 * Adds a profile, or changes an existing one's name or items: a field left out keeps what the profile has now, so a rename and a
 * tick sent close together never undo each other. Names are unique, ignoring case. With `restore`, `id` is a deleted profile's,
 * made again with that id (Undo of Delete).
 */
export async function saveProfile(context: ShareContext, input: ProfileEdit): Promise<{ problem?: string; id?: string }> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return { problem: opened.stop };
  const existing = input.id ? opened.profiles.find(profile => profile.id === input.id) : undefined;
  if (input.id && !existing && !input.restore) return { problem: 'That profile is gone. Nothing was saved.' };
  const name = (input.name ?? existing?.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { problem: 'A profile needs a name.' };
  if (name.length > 40) return { problem: 'Keep the name to 40 characters or fewer.' };
  if (opened.profiles.some(profile => profile.id !== input.id && profile.name.toLowerCase() === name.toLowerCase())) return { problem: `There is already a profile called “${name}”.` };
  const items = [...new Set((input.items ?? existing?.items ?? []).filter(item => /^(plugin:)?(skill|agent|mcp):./.test(item)))];
  const id = existing?.id ?? (input.restore ? input.id : undefined) ?? randomUUID();
  const profiles = existing ? opened.profiles.map(profile => (profile.id === id ? { id, name, items } : profile)) : [...opened.profiles, { id, name, items }];
  await saveProfiles(context.home, profiles);
  return { id };
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

/** Each kind's items as its record holds them now, and the plugins the home records (liveItems); or why a record can't be read (then nothing is switched). */
export async function readLibraries(context: ShareContext): Promise<{ libraries: Libraries; plugins: Set<string> } | { stop: string }> {
  const libraries = {} as Libraries;
  for (const { kind, open } of KINDS) {
    const { library, problem } = await open(context);
    if (problem) return { stop: `${problem} Nothing was switched.` };
    libraries[kind] = library.items;
  }
  return { libraries, plugins: new Set((await recordedIds(context.home)).plugins.map(entry => entry.id)) };
}

/** The live library items now, for the menus (main.ts), which have no page view to read them from; none when a record can't be read. */
export async function liveNow(context: ShareContext): Promise<LiveItem[]> {
  const read = await readLibraries(context);
  return 'stop' in read ? [] : liveItems(read.libraries, read.plugins);
}

/**
 * What a switch and its Undo need from the main process for a plugin's items: each item every tool has, read now (profileplan.ts
 * pluginLive), and a run of plugin steps through each tool's own switch (pluginplan.ts runPlan, with marketplaces.ts setSkill and
 * setPart).
 */
export interface PluginSide { live: () => Promise<PluginLive[]>; run: (ops: PluginOp[]) => Promise<PluginDone[]> }
/** A home read with no plugins' items: what a switch meets when its caller gives none. */
const NO_PLUGINS: PluginSide = { live: async () => [], run: async () => [] };

/** The copies a plugin plan turns (pluginPlan `turn`), each toward what the profile has. */
const copiesTurned = (plan: PluginTurn[], live: PluginLive[]): CopyTurn[] => plan.flatMap(turn => {
  const item = live.find(each => each.id === turn.id)!;
  return turn.turn.map(tool => ({ item, copy: item.copies.find(copy => copy.tool === tool)!, on: turn.on }));
});
/** A plan's held copies (pluginPlan `held`), as a result says them: the item, its tool and why. */
const heldResults = (plan: PluginTurn[], live: PluginLive[]): DestinationResult[] => plan.flatMap(turn => turn.held.map(({ tool, why }) => {
  const name = live.find(each => each.id === turn.id)!.name;
  return { item: name, harness: tool, outcome: 'held' as const, message: `${name}: ${why}` };
}));
/** A copy turned, as History keeps it. */
const switched = ({ item, copy, on }: CopyTurn): PluginSwitched => ({ id: item.id, name: item.name, tool: copy.tool, on });
/** A placed copy's library item, by its kind and key, which one click turns in every tool it is in. */
const placedKey = ({ item, copy }: CopyTurn) => ('libraryKey' in copy.target ? `${item.kind}:${copy.target.libraryKey}` : undefined);

/**
 * Turns `turns.on` On and `turns.off` Off: the library's own clicks (each item On or Off, kept out of the tools it is kept out
 * of), with each placed copy's library item in `copies` turned once however many tools it is in, taken only while it is still
 * the plugin's (Change `forPlugin`: the same pass may let go of a copy edited since) and kept out where it is (from `libraries`,
 * as read now); one pass per kind, on those items
 * alone. `told`: History has them in the caller's entry. Then each installed copy in `copies` by its own switch in its tool
 * (installedCopy). Answers what each pass and tool said, the entries the clicks made, and what is as asked after, read back:
 * each library item, and each copy whose write was confirmed (`copies`: a tool's own read after its write, plugins.ts setSkill
 * and setPart; a placed copy's library item read again), and each copy found as asked already (`asAsked`: turned since the plan
 * was read), which is neither. The same pass can turn an item Off again (its copy in a tool was deleted
 * by hand while a removal waited there), which History then says in an entry of its own.
 */
async function turnTogether(context: ShareContext, tools: HarnessId[], turns: Turns, told: boolean, copies: CopyTurn[] = [], libraries?: Libraries, plugins = NO_PLUGINS) {
  const results: DestinationResult[] = [], made: string[] = [], placedAsAsked = new Set<string>();
  const placed = [...new Map(copies.flatMap(turn => { const key = placedKey(turn); return key ? [[key, turn] as const] : []; })).values()];
  for (const { kind, pass } of KINDS) {
    const asked = [...turns.on.filter(item => item.kind === kind).map(item => [item, true] as const), ...turns.off.filter(item => item.kind === kind).map(item => [item, false] as const)];
    const clicks = asked.map(([item, on]): Change => ({ key: item.key, on, except: [...item.except], seenOn: !on })), names = asked.map(([item]) => item.name);
    for (const { item, copy, on } of placed.filter(turn => turn.item.kind === kind)) {
      const record = 'libraryKey' in copy.target ? libraries?.[kind][copy.target.libraryKey] : undefined;
      if (record?.on === on) placedAsAsked.add(placedKey({ item, copy, on })!);
      else if (record?.source) { clicks.push({ key: record.key, on, except: [...record.except], seenOn: !on, forPlugin: record.source }); names.push(item.name); }
    }
    if (!clicks.length) continue;
    const done = await pass(context, tools, clicks, { only: new Set(clicks.map(each => each.key)), told });
    results.push(...done.results, ...(done.stopped ? [{ item: names.join(', '), outcome: 'failed' as const, message: done.stopped }] : []));
    made.push(...(done.made ?? []));
  }
  const confirmed: CopyTurn[] = [], asAsked: CopyTurn[] = [];
  for (const turn of copies.filter(each => !placedKey(each))) {
    const { changed, failed } = await installedCopy(turn, plugins);
    if (failed) results.push(failed); else (changed ? confirmed : asAsked).push(turn);
  }
  const after = await readLibraries(context), records = 'stop' in after ? undefined : after.libraries;
  const now = (item: LiveItem) => records && !records[item.kind][item.key]?.deleted ? records[item.kind][item.key]?.on : undefined;
  const placedNow = ({ item, copy, on }: CopyTurn) => 'libraryKey' in copy.target && records?.[item.kind][copy.target.libraryKey]?.on === on;
  return { results, made, done: { on: turns.on.filter(item => now(item) === true), off: turns.off.filter(item => now(item) === false) },
    copies: copies.filter(turn => (placedKey(turn) ? !placedAsAsked.has(placedKey(turn)!) && placedNow(turn) : confirmed.includes(turn))),
    asAsked: [...asAsked, ...copies.filter(turn => placedAsAsked.has(placedKey(turn) ?? ''))] };
}

/**
 * One installed copy turned by its own switch in its tool, run by the main process: the one step pluginswitch.ts click makes for
 * it, never a whole plugin's, since a copy a plan turns has its plugin on there and a switch of its own that can be written
 * (profileplan.ts installedWay). Answers whether the tool confirmed a change (`changed`; not when it was as asked already, turned
 * since the plan was read), or what went wrong (`failed`).
 */
async function installedCopy({ item, copy, on }: CopyTurn, plugins: PluginSide): Promise<{ changed: boolean; failed?: DestinationResult }> {
  const draft: PluginDraft = new Map();
  if ('install' in copy.target) click(draft, copy.target);
  const report = (await plugins.run([...draft.values()]))[0]?.report;
  if (report && succeeded(report)) return { changed: !!report.changed };
  return { changed: false, failed: { item: item.name, harness: copy.tool, outcome: report?.outcome === 'held' ? 'held' : 'failed', message: `${item.name}: ${report?.message ?? `It was not turned ${on ? 'on' : 'off'} in ${toolNames[copy.tool]}.`}` } };
}

/** History keys every profile entry with this. */
const SWITCH_KEY = 'profiles:switch';
const named = (items: LiveItem[]) => items.map(({ id, name }) => ({ id, name }));
const stopped = (why: string): ProfileSwitchResult => ({ stopped: why, on: [], off: [], left: [], results: [] });

/** A profile entry (types.ts HistoryEvent `profile`): a switch's, or the migration's (profilemigrate.ts). `item`: the profile's name. */
export const profileEvent = (context: ShareContext, item: string, profile: NonNullable<HistoryEvent['profile']>): HistoryEvent =>
  ({ id: randomUUID(), at: new Date(clock(context)).toISOString(), key: SWITCH_KEY, item, kind: 'profile', losers: [], orderProved: true, profile });

/**
 * What a switch or its Undo did, as the page tells it: the items that are now as it asked (`done`, turned On and Off; of
 * `copies`, those `confirmed`) and those that are not (`left`), by name, a plugin's item once however many tools it was turned
 * in (one turned in one tool and not in another is in both lists); and what could not be done in a tool this time.
 */
function outcome(turns: Turns, done: Turns, results: DestinationResult[], copies: CopyTurn[] = [], confirmed: CopyTurn[] = []) {
  const names = (items: LiveItem[]) => items.map(item => item.name);
  const itemNames = (list: CopyTurn[]) => [...new Map(list.map(turn => [turn.item.id, turn.item.name])).values()];
  const left = [...turns.on, ...turns.off].filter(item => !done.on.includes(item) && !done.off.includes(item));
  return { on: [...names(done.on), ...itemNames(confirmed.filter(turn => turn.on))], off: [...names(done.off), ...itemNames(confirmed.filter(turn => !turn.on))],
    left: [...names(left), ...itemNames(copies.filter(turn => !confirmed.includes(turn)))], results: results.filter(result => result.outcome === 'failed' || result.outcome === 'held') };
}

/** A switch's entry left holding only the plugin copies their tools confirmed (types.ts HistoryEvent profile `plugins`): a write that failed is no part of its Undo. */
async function keepConfirmed(context: ShareContext, eventId: string, confirmed: CopyTurn[]) {
  const history = await readHistory(context), entry = history.find(each => each.id === eventId);
  if (!entry?.profile) return;
  entry.profile.plugins = confirmed.map(switched);
  await replaceHistory(context, history);
}

// ---------- Switching, and its Undo ----------

/**
 * Switches to a profile: each library item it names On, every other Off (profileplan.ts switchPlan), and each plugin's item
 * turned, copy by copy, as profileplan.ts pluginPlan says (`plugins`: what the main process gives of them; with none, a switch
 * meets none), told to History in one entry written before anything changes. A copy pluginPlan holds is said in the result,
 * and the other tools' are turned all the same. Nothing to turn: no entry, and the gate is not entered (no record made).
 */
export async function switchProfile(context: ShareContext, tools: HarnessId[], id: string, plugins = NO_PLUGINS): Promise<ProfileSwitchResult> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return stopped(opened.stop);
  const profile = opened.profiles.find(each => each.id === id);
  if (!profile) return stopped('That profile is gone. Nothing was switched.');
  const read = await readLibraries(context);
  if ('stop' in read) return stopped(read.stop);
  const turns = switchPlan(profile, liveItems(read.libraries, read.plugins));
  const live = await plugins.live(), plan = pluginPlan(profile, live), copies = copiesTurned(plan, live), held = heldResults(plan, live);
  if (!changes(turns) && !copies.length) return { name: profile.name, on: [], off: [], left: [], results: held };
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stopped(`${gate.refused} Nothing was switched.`);
  const event = profileEvent(context, profile.name, { toName: profile.name, on: named(turns.on), off: named(turns.off), ...(copies.length ? { plugins: copies.map(switched) } : {}) });
  await appendHistory(context, [event]);
  const done = await turnTogether(context, tools, turns, true, copies, read.libraries, plugins);
  if (done.copies.length < copies.length) await keepConfirmed(context, event.id, done.copies);
  return { name: profile.name, ...outcome(turns, done.done, [...held, ...done.results], copies.filter(turn => !done.asAsked.includes(turn)), done.copies), event: event.id };
}

/**
 * Undo of a profile entry (a switch's, or the migration's): each library item it turned On that is still On is turned Off, each
 * it turned Off that is still Off is turned On (profileplan.ts undoPlan), by the items' own clicks, each with its own History
 * entry; each plugin copy it turned that is still as it left it and still the plugin's goes back by its own switch, with no
 * entry, and each other is said (`switched.since`: profileplan.ts pluginUndo). The profile entry is marked undone once a library
 * item's click made an entry. No copies are given back. An entry from before profiles were sets of items has nothing to undo.
 */
export async function undoSwitch(context: ShareContext, tools: HarnessId[], eventId: string, plugins = NO_PLUGINS): Promise<ApplyResult> {
  const stop = (why: string): ApplyResult => ({ stopped: why, results: [], harnessWrites: 0 });
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  if (!past?.profile?.on || past.undoneBy) return stop('That switch has nothing to undo.');
  const read = await readLibraries(context);
  if ('stop' in read) return stop(read.stop);
  const turns = undoPlan(past, liveItems(read.libraries, read.plugins)), { back, left: since } = pluginUndo(past, await plugins.live());
  if (!changes(turns) && !back.length) return stop('Nothing to undo: each item that switch changed was changed again since.');
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stop(`${gate.refused} Nothing was undone.`);
  const { results, made, done, copies, asAsked } = await turnTogether(context, tools, turns, false, back, read.libraries, plugins);
  if (made.length) {
    const now = await readHistory(context), entry = now.find(each => each.id === eventId);
    if (entry) { entry.undoneBy = made[0]; await replaceHistory(context, now); }
  }
  const { results: notDone, ...switchedBack } = outcome(turns, done, results, back.filter(turn => !asAsked.includes(turn)), copies);
  const changedSince = since.map(copy => `${copy.name} in ${toolNames[copy.tool]}`);
  return { results: notDone, harnessWrites: changes(done) + copies.length, made, switched: { ...switchedBack, ...(changedSince.length ? { since: changedSince } : {}) } };
}
