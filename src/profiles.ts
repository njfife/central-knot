// Profiles: named sets of items to have on, kept in `.central-knot/profiles.json`, and a switch carried out. The rules (what a
// switch changes, which profile is in use, what its Undo turns back) are profileplan.ts's. A switch is the library's own clicks,
// Turn on and Turn off, made together in one pass per kind (skills.ts applySkills, servers.ts applyServers, agents.ts
// applyAgents), and for a plugin's items each copy's own switch: an installed copy's in its tool (pluginswitch.ts click, run
// through the main process: PluginSide), a copy placed in Pi or OpenCode by its library item's On or Off in a pass of its own;
// all of it told to History in one entry of its own, written first (librarypass.ts PassOptions told) and then left holding only
// the plugin copies each tool confirmed. Its Undo is each library item's own Turn on or Turn off, each with its own entry, and
// each plugin copy's own switch back, all told in one entry of the Undo's own, which marks the switch's entry undone. Nothing per
// tool is kept here but those entries, and which profile is in use is never stored. A file from before profiles were sets of items (format 1) is read here for the page and moved once by
// profilemigrate.ts.
//
//   profiles.json   { formatVersion: 3, profiles: [{ id, name, items: ['skill:notes', 'mcp:docs', 'agent:writer'], switchesPluginItems: true }] }
//                   a plugin's item as profileplan.ts pluginItemId names it: 'plugin:skill:document-tools@team-tools/pdf'
//                   format 2 files are read as-is with switchesPluginItems false and never rewritten until a profile is saved.
//                   saveProfiles is the one writer: format 3 on a save, format 2 from profilemigrate.ts's format 1 move (a pass
//                   that runs without a click must not write a file the released build refuses).
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentKind, applyAgents } from './agents.ts';
import { appendHistory, clock, readHistory, replaceHistory } from './history.ts';
import { itemKey, type ItemKind } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { succeeded, type PluginDone, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { click } from './pluginswitch.ts';
import { changes, heldWords, liveItems, pluginPlan, pluginUndo, switchPlan, undoPlan, type CopyTurn, type Libraries, type LiveItem, type PluginLive, type PluginTurn, type Turns } from './profileplan.ts';
import { applyServers, serverKind } from './servers.ts';
import { errorCode, libraryGate, storeDirectory, writeDurably, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import { recordedIds } from './sourcestore.ts';
import { groupBy } from './model.ts';
import { strings } from './values.ts';
import { andList, toolNames } from './words.ts';
import type { ApplyResult, Change, DestinationResult, HarnessId, HistoryEvent, PassResult, PluginSwitched, Profile, ProfileEdit, ProfileSwitchResult, ProfilesView } from './types.ts';

// ---------- The profiles file ----------

const FORMAT_VERSION = 3;
const profilesPath = (home: string) => join(storeDirectory(home), 'profiles.json');

/** A profile's id for an item as format 1 named it: a skill by its key, as now; an MCP server by its name as written. */
const fromFormat1 = (id: string) => (id.startsWith('mcp:') ? `mcp:${itemKey(id.slice(4))}` : id);

/** The profiles in a profiles file: each with a string id and name, string items, and whether it switches plugin items (false for format 1 and 2, or a format 3 profile missing the field). */
const profilesOf = (raw: unknown, format: number): Profile[] => (Array.isArray(raw) ? raw : [])
  .filter(profile => profile && typeof profile.id === 'string' && typeof profile.name === 'string')
  .map(profile => ({ id: profile.id, name: profile.name, items: (strings(profile.items) ?? []).map(id => (format === 1 ? fromFormat1(id) : id)),
    switchesPluginItems: format >= 3 && profile.switchesPluginItems === true }));

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
 * Writes `profiles.json` in `format` (format 3 on a save; format 2 from profilemigrate.ts's format 1 move, since a pass that runs
 * without a click must not write a file the released build refuses). Format 2 omits `switchesPluginItems`.
 */
export const saveProfiles = (home: string, profiles: Profile[], format: 2 | 3 = FORMAT_VERSION) => writeDurably(profilesPath(home),
  `${JSON.stringify({ formatVersion: format, profiles: format === 2 ? profiles.map(({ id, name, items }) => ({ id, name, items })) : profiles }, null, 2)}\n`);

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
 * Adds a profile, or changes an existing one's name, items or `switchesPluginItems`: a field left out keeps what the profile has
 * now, so a rename and a tick sent close together never undo each other. A new profile defaults to `switchesPluginItems: true`;
 * an existing one keeps `false` until opted in with `true` (which drops any `plugin:` ids while keeping all of his own, dormant
 * ones too), and once `true` stays `true`. Names are unique, ignoring case. With `restore`, `id` is a deleted profile's, made
 * again with that id (Undo of Delete) and its saved `switchesPluginItems`.
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
  const optingIn = !!existing && !existing.switchesPluginItems && input.switchesPluginItems === true;
  const items = [...new Set((input.items ?? existing?.items ?? []).filter(item => /^(plugin:)?(skill|agent|mcp):./.test(item) && (!optingIn || !item.startsWith('plugin:'))))];
  const switchesPluginItems = existing ? existing.switchesPluginItems || input.switchesPluginItems === true : (input.switchesPluginItems ?? true);
  const id = existing?.id ?? (input.restore ? input.id : undefined) ?? randomUUID();
  const saved: Profile = { id, name, items, switchesPluginItems };
  const profiles = existing ? opened.profiles.map(profile => (profile.id === id ? saved : profile)) : [...opened.profiles, saved];
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
/** A home read with no plugins' items, for a caller whose home has none (tests of the library's part alone). */
export const NO_PLUGINS: PluginSide = { live: async () => [], run: async () => [] };

/** The copies a plugin plan turns (pluginPlan `turn`), each toward what the profile has, and those it turns on to keep his own server on (`release`). */
const copiesTurned = (plan: PluginTurn[], live: PluginLive[]): CopyTurn[] => plan.flatMap(turn => {
  const item = live.find(each => each.id === turn.id)!, at = (tool: HarnessId, on: boolean) => ({ item, copy: item.copies.find(copy => copy.tool === tool)!, on });
  return [...turn.turn.map(tool => at(tool, turn.on)), ...(turn.release ?? []).map(tool => at(tool, true))];
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
 * Turns `turns.on` On and `turns.off` Off, the library's own clicks, one pass per kind (`told`: History has them in the caller's
 * entry); then the placed copies in `copies`, one pass per kind of their own whose entry is always the caller's (placedClicks);
 * then each installed copy by its own switch in its tool (installedCopy). Answers what each pass and tool said, the entries the
 * library items' clicks made, what is as asked after, read back: each library item (`done`), each copy whose change its tool
 * confirmed (`copies`: a placed copy by its library item read again and that tool's own result in its pass), and the placed
 * copies whose library item is no longer the plugin's (`letGo`: edited by hand since), and each installed copy its tool found as
 * asked already (`asAsked`), which are neither turned nor failed.
 */
async function turnTogether(context: ShareContext, tools: HarnessId[], turns: Turns, told: boolean, copies: CopyTurn[], libraries: Libraries, plugins: PluginSide) {
  const results: DestinationResult[] = [], made: string[] = [], placedResults: DestinationResult[] = [];
  for (const { kind, pass } of KINDS) {
    const asked = [...turns.on.filter(item => item.kind === kind).map(item => [item, true] as const), ...turns.off.filter(item => item.kind === kind).map(item => [item, false] as const)];
    const clicks = asked.map(([item, on]): Change => ({ key: item.key, on, except: [...item.except], seenOn: !on }));
    for (const [list, mine, toldHere] of [[clicks, false, told], [placedClicks(kind, copies, libraries), true, true]] as const) {
      if (!list.length) continue;
      const done = await pass(context, tools, list, { only: new Set(list.map(each => each.key)), told: toldHere });
      const names = list.map(click => libraries[kind][click.key]?.name ?? click.key).join(', ');
      results.push(...done.results, ...(done.stopped ? [{ item: names, outcome: 'failed' as const, message: done.stopped }] : []));
      if (mine) placedResults.push(...done.results); else made.push(...(done.made ?? []));
    }
  }
  const confirmed: CopyTurn[] = [], asAsked: CopyTurn[] = [];
  for (const turn of copies.filter(each => !placedKey(each))) {
    const { changed, failed } = await installedCopy(turn, plugins);
    if (failed) results.push(failed); else (changed ? confirmed : asAsked).push(turn);
  }
  const after = await readLibraries(context), records = 'stop' in after ? undefined : after.libraries;
  const now = (item: LiveItem) => records && !records[item.kind][item.key]?.deleted ? records[item.kind][item.key]?.on : undefined;
  const recordOf = ({ item, copy }: CopyTurn) => ('libraryKey' in copy.target ? records?.[item.kind][copy.target.libraryKey] : undefined);
  const letGo = copies.filter(turn => placedKey(turn) && recordOf(turn)?.source !== libraries[turn.item.kind][(turn.copy.target as { libraryKey: string }).libraryKey]?.source);
  const placedDone = (turn: CopyTurn) => {
    const record = recordOf(turn), wanted = !!record?.on && !record.except.includes(turn.copy.tool);
    return wanted === turn.on && !letGo.includes(turn) && !placedResults.some(result => result.item === record?.name && result.harness === turn.copy.tool && (result.outcome === 'failed' || result.outcome === 'held'));
  };
  return { results, made, done: { on: turns.on.filter(item => now(item) === true), off: turns.off.filter(item => now(item) === false) },
    copies: copies.filter(turn => (placedKey(turn) ? placedDone(turn) : confirmed.includes(turn))), letGo, asAsked };
}

/**
 * One installed copy turned by its own switch in its tool, run by the main process: the one step pluginswitch.ts click makes for
 * it, never a whole plugin's, since a copy a plan turns has its plugin on there and a switch of its own that can be written
 * (profileplan.ts installedWay). Answers whether the tool confirmed a change (`changed`; not when it was as asked already), or
 * what went wrong (`failed`).
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

/** A profile entry (types.ts HistoryEvent `profile`): a switch's, its Undo's, or the migration's (profilemigrate.ts). `item`: the profile's name. */
export const profileEvent = (context: ShareContext, item: string, profile: NonNullable<HistoryEvent['profile']>): HistoryEvent =>
  ({ id: randomUUID(), at: new Date(clock(context)).toISOString(), key: SWITCH_KEY, item, kind: 'profile', losers: [], orderProved: true, profile });

/**
 * What a switch or its Undo did, as the page tells it: the items that are now as it asked (`done`, turned On and Off; of
 * `copies`, those `confirmed`) and those that are not (`left`), by name, a plugin's item once however many tools it was turned
 * in (one turned in one tool and not in another is in both lists); and what could not be done in a tool this time.
 */
function outcome(turns: Turns, done: Turns, results: DestinationResult[], copies: CopyTurn[], confirmed: CopyTurn[]) {
  const names = (items: LiveItem[]) => items.map(item => item.name);
  const itemNames = (list: CopyTurn[]) => [...new Map(list.map(turn => [turn.item.id, turn.item.name])).values()];
  const left = [...turns.on, ...turns.off].filter(item => !done.on.includes(item) && !done.off.includes(item));
  return { on: [...names(done.on), ...itemNames(confirmed.filter(turn => turn.on))], off: [...names(done.off), ...itemNames(confirmed.filter(turn => !turn.on))],
    left: [...names(left), ...itemNames(copies.filter(turn => !confirmed.includes(turn)))], results: results.filter(result => result.outcome === 'failed' || result.outcome === 'held') };
}

/**
 * A switch's or an Undo's entry once its passes ran: holding only the plugin copies their tools confirmed (types.ts HistoryEvent
 * profile `plugins`: a write that failed is no part of its Undo), and what its passes changed in a tool's own settings.
 */
async function settleEntry(context: ShareContext, eventId: string, confirmed: CopyTurn[], settingsChanged: string[]) {
  const history = await readHistory(context), entry = history.find(each => each.id === eventId);
  if (!entry?.profile) return;
  if (entry.profile.plugins) entry.profile.plugins = confirmed.map(switched);
  if (settingsChanged.length) entry.settingsChanged = settingsChanged;
  await replaceHistory(context, history);
}

// ---------- Switching, and its Undo ----------

/**
 * Switches to a profile: each library item it names On, every other Off (profileplan.ts switchPlan), and each plugin's item
 * turned, copy by copy, as profileplan.ts pluginPlan says (`plugins`: what the main process gives of them), told to History in
 * one entry written before anything changes. A copy pluginPlan holds is said in the result, and the other tools' are turned all
 * the same. Nothing to turn: no entry, and the gate is not entered (no record made); when something is held, refused with why
 * (profileplan.ts heldWords).
 */
export async function switchProfile(context: ShareContext, tools: HarnessId[], id: string, plugins: PluginSide): Promise<ProfileSwitchResult> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return stopped(opened.stop);
  const profile = opened.profiles.find(each => each.id === id);
  if (!profile) return stopped('That profile is gone. Nothing was switched.');
  const read = await readLibraries(context);
  if ('stop' in read) return stopped(read.stop);
  const turns = switchPlan(profile, liveItems(read.libraries, read.plugins));
  const live = await plugins.live(), plan = pluginPlan(profile, live), copies = copiesTurned(plan, live), held = heldResults(plan, live);
  if (!changes(turns) && !copies.length) return held.length ? stopped(`${heldWords(plan, live).text}. Nothing was switched.`) : { name: profile.name, on: [], off: [], left: [], results: [] };
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stopped(`${gate.refused} Nothing was switched.`);
  const event = profileEvent(context, profile.name, { toName: profile.name, on: named(turns.on), off: named(turns.off), ...(copies.length ? { plugins: copies.map(switched) } : {}) });
  await appendHistory(context, [event]);
  const done = await turnTogether(context, tools, turns, true, copies, read.libraries, plugins);
  // What its passes changed in a tool's own settings (Pi's list: librarypass.ts Kind.follow), said by its entry and its result.
  const settingsChanged = done.results.flatMap(result => (result.settingsChanged ? [result.settingsChanged] : []));
  if (done.copies.length < copies.length || settingsChanged.length) await settleEntry(context, event.id, done.copies, settingsChanged);
  return { name: profile.name, ...outcome(turns, done.done, [...held, ...done.results], copies.filter(turn => !done.asAsked.includes(turn)), done.copies), event: event.id,
    ...(settingsChanged.length ? { settingsChanged } : {}) };
}

/**
 * Undo of a profile entry (a switch's, or the migration's): each library item it turned On that is still On is turned Off, each
 * it turned Off that is still Off is turned On (profileplan.ts undoPlan), by the items' own clicks, each with its own History
 * entry; each plugin copy it turned that is still as it left it goes back by its own switch, all of them told in one entry of
 * the Undo's own, written first (`undoOf`), which counts his items too, and each copy left is named, with why (`switched.since`). The switch's entry is
 * marked undone by the Undo's entry, or where it turned back no plugin copy, by its first library item's. No copies are given
 * back. An entry from before profiles were sets of items, and an Undo's own, have nothing to undo.
 */
export async function undoSwitch(context: ShareContext, tools: HarnessId[], eventId: string, plugins: PluginSide): Promise<ApplyResult> {
  const stop = (why: string): ApplyResult => ({ stopped: why, results: [], harnessWrites: 0 });
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  if (!past?.profile?.on || past.profile.undoOf || past.undoneBy) return stop('That switch has nothing to undo.');
  const read = await readLibraries(context);
  if ('stop' in read) return stop(read.stop);
  const turns = undoPlan(past, liveItems(read.libraries, read.plugins)), { back, left } = pluginUndo(past, await plugins.live());
  if (!changes(turns) && !back.length) return stop('Nothing to undo: each item that switch changed was changed again since.');
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stop(`${gate.refused} Nothing was undone.`);
  const undo = back.length ? profileEvent(context, past.item, { toName: past.profile.toName, undoOf: past.id, on: named(turns.on), off: named(turns.off), plugins: back.map(switched) }) : undefined;
  if (undo) await appendHistory(context, [undo]);
  const { results, made, done, copies, letGo, asAsked } = await turnTogether(context, tools, turns, false, back, read.libraries, plugins);
  if (undo && copies.length < back.length) await settleEntry(context, undo.id, copies, []);
  const by = (undo && copies.length ? undo.id : undefined) ?? made[0];
  if (by) {
    const now = await readHistory(context), entry = now.find(each => each.id === eventId);
    if (entry) { entry.undoneBy = by; await replaceHistory(context, now); }
  }
  const { results: notDone, ...switchedBack } = outcome(turns, done, results, back.filter(turn => !asAsked.includes(turn) && !letGo.includes(turn)), copies);
  // Each copy left, as "pdf-reader in Pi, deleted by hand since"; one let go as his own by the Undo's own pass with its tools together.
  const since = [...left.map(({ copy, why }) => `${copy.name} in ${toolNames[copy.tool]}, ${why}`),
    ...[...groupBy(letGo, turn => turn.item.id).values()].map(list => `${list[0]!.item.name} in ${andList(list.map(turn => toolNames[turn.copy.tool]))}, edited by hand since, so it is your own now`)];
  return { results: notDone, harnessWrites: changes(done) + copies.length, made, switched: { ...switchedBack, ...(since.length ? { since } : {}) } };
}
