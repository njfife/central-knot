// Profiles: named sets of library items (skills, MCP servers and agents) to have On, kept in `.central-knot/profiles.json`,
// and a switch carried out. The rules (what a switch changes, which profile is in use, what its Undo turns back) are
// profileplan.ts's. A switch is nothing but the library's own clicks, Turn on and Turn off, made together in one pass per kind
// (skills.ts applySkills, servers.ts applyServers, agents.ts applyAgents) and told to History in one entry of its own, written
// first (librarypass.ts PassOptions told). Its Undo is each item's own Turn on or Turn off, each with its own entry. Nothing
// per tool is kept here, and which profile is in use is never stored. A file from before profiles were sets of items
// (format 1) is read here for the page and moved once by profilemigrate.ts.
//
//   profiles.json   { formatVersion: 2, profiles: [{ id, name, items: ['skill:notes', 'mcp:docs', 'agent:writer'] }] }
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentKind, applyAgents } from './agents.ts';
import { appendHistory, clock, readHistory, replaceHistory } from './history.ts';
import { itemKey, type ItemKind } from './library.ts';
import type { KindLibrary } from './librarypass.ts';
import { changes, liveItems, switchPlan, undoPlan, type Libraries, type LiveItem, type Turns } from './profileplan.ts';
import { applyServers, serverKind } from './servers.ts';
import { errorCode, libraryGate, storeDirectory, writeDurably, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import { strings } from './values.ts';
import type { ApplyResult, Change, DestinationResult, HarnessId, HistoryEvent, PassResult, Profile, ProfileEdit, ProfileSwitchResult, ProfilesView } from './types.ts';

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

/** The home's profiles, for the page and the menus. */
export const readProfiles = async (home: string): Promise<ProfilesView> => (await readProfileFile(home)).view;

/** Writes the profiles as format 2. */
export const saveProfiles = (home: string, profiles: Profile[]) =>
  writeDurably(profilesPath(home), `${JSON.stringify({ formatVersion: FORMAT_VERSION, profiles }, null, 2)}\n`);

/**
 * The home's profiles, ready to change, or why they can't be changed here: a preview-only home, another build owning sync (the
 * page's whyReadOnly in app.ts says the same), a profiles file that can't be read, or one from before profiles were sets of
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
  const items = [...new Set((input.items ?? existing?.items ?? []).filter(item => /^(skill|agent|mcp):./.test(item)))];
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

/** Each kind's items as its record holds them now, or why one can't be read (then nothing is switched). */
export async function readLibraries(context: ShareContext): Promise<{ libraries: Libraries } | { stop: string }> {
  const libraries = {} as Libraries;
  for (const { kind, open } of KINDS) {
    const { library, problem } = await open(context);
    if (problem) return { stop: `${problem} Nothing was switched.` };
    libraries[kind] = library.items;
  }
  return { libraries };
}

/** The live library items now, for the menus (main.ts), which have no page view to read them from; none when a record can't be read. */
export async function liveNow(context: ShareContext): Promise<LiveItem[]> {
  const read = await readLibraries(context);
  return 'stop' in read ? [] : liveItems(read.libraries);
}

/**
 * Turns `turns.on` On and `turns.off` Off: the library's own clicks (each item On or Off, kept out of the tools it is kept out
 * of), one pass per kind, on those items alone. `told`: History has them in the caller's entry. Answers what each pass said,
 * the entries the clicks made, and what each item is after, read back: the same pass can turn an item Off again (its copy in
 * a tool was deleted by hand while a removal waited there), which History then says in an entry of its own.
 */
async function turnTogether(context: ShareContext, tools: HarnessId[], turns: Turns, told: boolean) {
  const results: DestinationResult[] = [], made: string[] = [];
  for (const { kind, pass } of KINDS) {
    const asked = [...turns.on.filter(item => item.kind === kind).map(item => [item, true] as const), ...turns.off.filter(item => item.kind === kind).map(item => [item, false] as const)];
    if (!asked.length) continue;
    const clicks = asked.map(([item, on]): Change => ({ key: item.key, managed: on, off: [...item.except], seenManaged: !on }));
    const done = await pass(context, tools, clicks, { only: new Set(asked.map(([item]) => item.key)), told });
    results.push(...done.results, ...(done.stopped ? [{ item: asked.map(([item]) => item.name).join(', '), outcome: 'failed' as const, message: done.stopped }] : []));
    made.push(...(done.made ?? []));
  }
  const after = await liveNow(context), now = (item: LiveItem) => after.find(each => each.id === item.id)?.on;
  return { results, made, done: { on: turns.on.filter(item => now(item) === true), off: turns.off.filter(item => now(item) === false) } };
}

/** History keys every profile entry with this. */
const SWITCH_KEY = 'profiles:switch';
const named = (items: LiveItem[]) => items.map(({ id, name }) => ({ id, name }));
const stopped = (why: string): ProfileSwitchResult => ({ stopped: why, on: [], off: [], left: [], waits: [], results: [] });

/** A profile entry (types.ts HistoryEvent `profile`): a switch's, or the migration's (profilemigrate.ts). `item`: the profile's name. */
export const profileEvent = (context: ShareContext, item: string, profile: NonNullable<HistoryEvent['profile']>): HistoryEvent =>
  ({ id: randomUUID(), at: new Date(clock(context)).toISOString(), key: SWITCH_KEY, item, kind: 'profile', losers: [], orderProved: true, profile });

/**
 * What a switch or its Undo did, as the page tells it: the items that are now as it asked (`done`, turned On and Off) and those
 * that are not (`left`), by name; the MCP servers whose Claude Code part waits for Write to Claude Code, by key; and what could
 * not be done in a tool this time (the next pass tries again).
 */
function outcome(turns: Turns, done: Turns, results: DestinationResult[]) {
  const waits = [...new Set(results.filter(result => result.waits && result.harness === 'claude-cli').map(result => itemKey(result.item)))];
  const names = (items: LiveItem[]) => items.map(item => item.name);
  const left = [...turns.on, ...turns.off].filter(item => !done.on.includes(item) && !done.off.includes(item));
  return { on: names(done.on), off: names(done.off), left: names(left), waits, results: results.filter(result => result.outcome === 'failed' || (result.outcome === 'held' && !result.waits)) };
}

// ---------- Switching, and its Undo ----------

/**
 * Switches to a profile: each item it names On, every other library item Off (profileplan.ts switchPlan), told to History in one
 * entry written before anything changes. Nothing to change: no entry, and the gate is not entered (no record made).
 */
export async function switchProfile(context: ShareContext, tools: HarnessId[], id: string): Promise<ProfileSwitchResult> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return stopped(opened.stop);
  const profile = opened.profiles.find(each => each.id === id);
  if (!profile) return stopped('That profile is gone. Nothing was switched.');
  const read = await readLibraries(context);
  if ('stop' in read) return stopped(read.stop);
  const turns = switchPlan(profile, liveItems(read.libraries));
  if (!changes(turns)) return { name: profile.name, on: [], off: [], left: [], waits: [], results: [] };
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stopped(`${gate.refused} Nothing was switched.`);
  const event = profileEvent(context, profile.name, { toName: profile.name, on: named(turns.on), off: named(turns.off) });
  await appendHistory(context, [event]);
  const { results, done } = await turnTogether(context, tools, turns, true);
  return { name: profile.name, ...outcome(turns, done, results), event: event.id };
}

/**
 * Undo of a profile entry (a switch's, or the migration's): each item it turned On that is still On is turned Off, each it
 * turned Off that is still Off is turned On (profileplan.ts undoPlan), by the items' own clicks, each with its own History
 * entry; the profile entry is then marked undone. No copies are given back. An entry from before profiles were sets of items
 * has nothing to undo.
 */
export async function undoSwitch(context: ShareContext, tools: HarnessId[], eventId: string): Promise<ApplyResult> {
  const stop = (why: string): ApplyResult => ({ stopped: why, results: [], harnessWrites: 0 });
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  if (!past?.profile?.on || past.undoneBy) return stop('That switch has nothing to undo.');
  const read = await readLibraries(context);
  if ('stop' in read) return stop(read.stop);
  const turns = undoPlan(past, liveItems(read.libraries));
  if (!changes(turns)) return stop('Nothing to undo: each item that switch changed was changed again since.');
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stop(`${gate.refused} Nothing was undone.`);
  const { results, made, done } = await turnTogether(context, tools, turns, false);
  if (made.length) {
    const now = await readHistory(context), entry = now.find(each => each.id === eventId);
    if (entry) { entry.undoneBy = made[0]; await replaceHistory(context, now); }
  }
  const { results: notDone, ...switched } = outcome(turns, done, results);
  return { results: notDone, harnessWrites: changes(done), made, switched };
}
