// Profiles: named sets of skills and MCP servers to have on, switched in one step (feedback item 10, 2026-11-09).
// A switch uses each tool's own off-switch (skillswitch.ts for skills, mcpswitch.ts for MCP servers), so nothing is moved,
// removed or deleted, and Managed keeps syncing content underneath: a server or skill that is off still gets edits. The plan is
// profileplan.ts; this file keeps the profiles and carries a plan out, one write per settings file, then one History entry.
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessIds } from './harnesses.ts';
import { appendHistory, clock, manageView, readHistory, replaceHistory } from './manage.ts';
import { mcpView } from './mcp.ts';
import { mcpDisabled, mcpSwitchPath, withMcpSwitch } from './mcpswitch.ts';
import { changedSince, choseProfileInUse, driftOf, itemId, itemKeyOf, itemKind, NO_PROFILE, planSwitch, releaseHolds, offAfterFlips, offAfterFailures, holdsOnWhatIsHere, switchItems, type SwitchItem } from './profileplan.ts';
import { errorCode, itemKey, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { keepOverrides, readKeptOverrides, switchedText, switchPath, switchState, type SwitchTarget } from './skillswitch.ts';
import { onlyAllowed, record, strings } from './values.ts';
import { toolName } from './words.ts';
import type { DestinationResult, HarnessId, HistoryEvent, Profile, ProfileEdit, ProfileFlip, ProfileSwitchResult, ProfilesView } from './types.ts';

// ---------- The profiles file ----------

interface ProfilesFile { formatVersion: 1; profiles: Profile[]; active?: string; offByProfile: Record<string, HarnessId[]> }
const profilesPath = (home: string) => join(storeDirectory(home), 'profiles.json');

/** The profiles in a profiles file: each with a string id and name; items kept only as strings. */
const profilesOf = (raw: unknown): Profile[] => (Array.isArray(raw) ? raw : [])
  .filter(profile => profile && typeof profile.id === 'string' && typeof profile.name === 'string')
  .map(profile => ({ id: profile.id, name: profile.name, items: strings(profile.items) ?? [] }));

/** What profiles hold off, per item, as the file says: tools Central Knot doesn't know are dropped, and so is an item left with none. */
const holdsOf = (raw: unknown): Record<string, HarnessId[]> => Object.fromEntries(Object.entries(record(raw) ?? {})
  .map(([id, tools]) => [id, onlyAllowed(tools, harnessIds)] as const)
  .filter(([, tools]) => tools.length));

/** The home's profiles. A file that can't be read is reported, never overwritten: the person's profiles may still be in it. */
export async function readProfiles(home: string): Promise<ProfilesView> {
  let text: string;
  try { text = await readFile(profilesPath(home), 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { profiles: [], offByProfile: {} } : { profiles: [], offByProfile: {}, problem: `${profilesPath(home)} could not be read, so profiles can’t be used here.` };
  }
  try {
    const parsed = JSON.parse(text) as Partial<ProfilesFile>;
    // Written by a newer Central Knot: read as it is, it could lose what that version keeps, so it is left alone.
    if (typeof parsed.formatVersion === 'number' && parsed.formatVersion > 1) return { profiles: [], offByProfile: {}, problem: `${profilesPath(home)} was saved by a newer Central Knot, so profiles can’t be used here. Nothing in it was changed.` };
    const profiles = profilesOf(parsed.profiles);
    const offByProfile = holdsOf(parsed.offByProfile);
    const active = profiles.some(profile => profile.id === parsed.active) ? parsed.active : undefined;
    return { profiles, offByProfile, ...(active ? { active } : {}) };
  } catch {
    return { profiles: [], offByProfile: {}, problem: `${profilesPath(home)} is not a profiles file Central Knot can read, so profiles can’t be used here. Nothing in it was changed.` };
  }
}

async function saveProfiles(home: string, view: ProfilesView) {
  const file: ProfilesFile = { formatVersion: 1, profiles: view.profiles, ...(view.active ? { active: view.active } : {}), offByProfile: view.offByProfile };
  await writeDurably(profilesPath(home), `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * The home's profiles, ready to change, or why they can't be changed here: a preview-only home, another build owning sync (the
 * page's whyReadOnly in app.ts says the same), or a profiles file that can't be read. Profiles change only Central Knot's file and
 * each tool's switches, never the sync record, so a record waiting for Resume does not stop them.
 */
async function openProfiles(context: ShareContext): Promise<{ view: ProfilesView } | { stop: string }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stop: access.reason };
  const gate = await syncGate(context);
  if (gate.state === 'stopped') return { stop: gate.reason };
  const view = await readProfiles(context.home);
  return view.problem ? { stop: view.problem } : { view };
}

/**
 * Adds a profile, or changes an existing one's name or items: a field left out keeps what the profile has now, so a rename and a
 * tick sent close together never undo each other. Names are unique, ignoring case. With `restore`, `id` is a deleted profile's,
 * made again with that id (Undo of Delete), so History's switches still name it.
 */
export async function saveProfile(context: ShareContext, input: ProfileEdit): Promise<{ problem?: string; id?: string }> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return { problem: opened.stop };
  const view = opened.view;
  const existing = input.id ? view.profiles.find(profile => profile.id === input.id) : undefined;
  if (input.id && !existing && !input.restore) return { problem: 'That profile is gone. Nothing was saved.' };
  const name = (input.name ?? existing?.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { problem: 'A profile needs a name.' };
  if (name.length > 40) return { problem: 'Keep the name to 40 characters or fewer.' };
  if (view.profiles.some(profile => profile.id !== input.id && profile.name.toLowerCase() === name.toLowerCase())) return { problem: `There is already a profile called “${name}”.` };
  const items = [...new Set((input.items ?? existing?.items ?? []).filter(item => /^(skill|mcp):./.test(item)))];
  const id = existing?.id ?? (input.restore ? input.id : undefined) ?? randomUUID();
  view.profiles = existing ? view.profiles.map(profile => (profile.id === id ? { id, name, items } : profile)) : [...view.profiles, { id, name, items }];
  await saveProfiles(context.home, view);
  return { id };
}

/** Deletes a profile's definition. Its switches stay as they are; the active profile can't be deleted (switch away first). */
export async function deleteProfile(context: ShareContext, id: string): Promise<{ problem?: string }> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return { problem: opened.stop };
  const view = opened.view;
  if (view.active === id) return { problem: 'That profile is in use. Switch to another profile, or to No profile, first.' };
  view.profiles = view.profiles.filter(profile => profile.id !== id);
  await saveProfiles(context.home, view);
  return {};
}

/**
 * The skill switches an explicit Disable, Enable or their Undo flipped (outcome 'switched' in `results`, for one of `changes`'
 * skills), as profile items: profiles stop holding these, since the person set them by hand. A skill's result names it by its
 * folder (manage.ts), whose itemKey is the change's key.
 */
export function switchedByHand(changes: { key: string }[], results: DestinationResult[]): { item: string; tool: HarnessId }[] {
  return results.filter(result => result.outcome === 'switched' && result.harness && changes.some(change => change.key === itemKey(result.item)))
    .map(result => ({ item: itemId('skill', itemKey(result.item)), tool: result.harness! }));
}

/** Lets go of profile holds on switches the person has since set by hand. Changes nothing when there are none or profiles can't be read. */
export async function releaseProfileHolds(context: ShareContext, released: { item: string; tool: HarnessId }[]) {
  if (!released.length) return;
  const view = await readProfiles(context.home);
  if (view.problem) return;
  const offByProfile = releaseHolds(view.offByProfile, released);
  if (JSON.stringify(offByProfile) !== JSON.stringify(view.offByProfile)) await saveProfiles(context.home, { ...view, offByProfile });
}

// ---------- Flipping switches ----------

/** How each tool's skill switch names its copy of a skill: the folder, the name the tool reads, and the copy's SKILL.md. */
function skillTarget(manage: Awaited<ReturnType<typeof manageView>>, key: string, tool: HarnessId): SwitchTarget | undefined {
  const copy = manage.skills.find(skill => skill.key === key)?.copies[tool];
  return copy && { folder: copy.folder, name: copy.name ?? copy.folder, skillFile: join(copy.directory, 'SKILL.md') };
}

/** What a switch reads once: each skill's copies (to name one for its switch), and every item with its switches now. */
interface HomeRead { manage: Awaited<ReturnType<typeof manageView>>; items: SwitchItem[] }
async function readHome(context: ShareContext): Promise<HomeRead> {
  const manage = await manageView(context);
  const mcp = await mcpView(context, manage.tools);
  return { manage, items: switchItems(manage, mcp) };
}

/** Every tool's switch files' modification times, as one string: when it is unchanged, no switch was turned in a tool's settings. */
export async function switchFilesStamp(context: ShareContext): Promise<string> {
  const files = [...new Set(harnessIds.flatMap(tool => [switchPath(context, tool), mcpSwitchPath(context, tool)]))];
  return (await Promise.all(files.map(file => stat(file).then(info => `${file}:${info.mtimeMs}`, () => `${file}:-`)))).join('|');
}

/** How many items the tools no longer match the profile in use on, with every item and the profiles, read fresh (for the menus when the page hasn't read). */
export async function driftNow(context: ShareContext): Promise<{ drift: number; items: SwitchItem[]; profiles: ProfilesView }> {
  const profiles = await readProfiles(context.home);
  const { items } = await readHome(context);
  return { drift: profiles.problem ? 0 : driftOf(items, profiles), items, profiles };
}

/**
 * One flip's switch: the file it lives in, how to read whether the item is off there, and how to set it in that file's text.
 * Skills use the tool's skill switch (named by the copy: folder, name, path), MCP servers the tool's MCP switch (by name).
 * A Claude Code skill turned off notes the override it replaced in `overrides` (kept by flipAll, as a Skills page Disable keeps
 * it), and one turned on puts back the value `kept` for it.
 */
interface Switch { file: string; isOff(text: string): boolean; set(text: string): string }
function switchOf(context: ShareContext, home: HomeRead, flip: ProfileFlip, kept: Record<string, string>, overrides: Map<ProfileFlip, [string, string | undefined]>): Switch {
  const key = itemKeyOf(flip.item);
  if (itemKind(flip.item) === 'mcp') return { file: mcpSwitchPath(context, flip.tool), isOff: text => mcpDisabled(flip.tool, text, key), set: text => withMcpSwitch(flip.tool, text, key, flip.disabled) };
  const target = skillTarget(home.manage, key, flip.tool);
  // A tool with no copy now fails this one flip when it is made (editText reports it), not here: throwing here would stop flipAll
  // before the other flips.
  const missing = () => { throw new Error(`${toolName(flip.tool)} has no copy of it now.`); };
  const set = (text: string, at: SwitchTarget) => {
    const switched = switchedText(context, flip.tool, text, at, flip.disabled, flip.disabled ? undefined : kept[at.folder]);
    if (flip.tool === 'claude-cli' && switched.text !== text) overrides.set(flip, [at.folder, flip.disabled ? switched.previous : undefined]);
    return switched.text;
  };
  return { file: switchPath(context, flip.tool), isOff: text => (target ? switchState(context, flip.tool, text, target) : missing()), set: text => (target ? set(text, target) : missing()) };
}

/** One file's text with every flip of `group` made in it; a flip that can't be made there is in `failed` with why. */
function editText(text: string, group: [ProfileFlip, Switch][]) {
  const failed = new Map<ProfileFlip, string>();
  for (const [flip, at] of group) {
    try { text = at.set(text); } catch (error) { failed.set(flip, error instanceof Error ? error.message : String(error)); }
  }
  return { text, failed };
}

/**
 * Writes one file's flips with a single checked write: only over the text read, so a save made meanwhile is never lost. A file
 * the tool saved just then is read again once and the flips are redone on what it holds. Returns the flips that couldn't be made.
 */
async function writeFlips(file: string, group: [ProfileFlip, Switch][]): Promise<Map<ProfileFlip, string>> {
  for (let attempt = 0; ; attempt++) {
    let original: string | undefined;
    try { original = await readFile(file, 'utf8'); } catch (error) { if (errorCode(error) !== 'ENOENT') return new Map(group.map(([flip]) => [flip, `${file} could not be read.`])); }
    const { text, failed } = editText(original ?? '', group);
    if (text === (original ?? '')) return failed;
    try { await writeFileChecked(file, text, original); return failed; }
    catch (error) {
      if ((errorCode(error) === 'CK_CHANGED' || errorCode(error) === 'CK_OCCUPIED') && attempt === 0) continue;
      const why = errorCode(error) === 'CK_CHANGED' ? `${file} kept changing, so it was left as it is.` : `Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`;
      for (const [flip] of group) if (!failed.has(flip)) failed.set(flip, why);
      return failed;
    }
  }
}

/** Why a flip didn't take, read back from its file as the tool will see it; undefined when it did. */
function whyNotTaken(flip: ProfileFlip, at: Switch, after: string | undefined): string | undefined {
  if (after === undefined) return `${at.file} could not be read back.`;
  try { return at.isOff(after) === flip.disabled ? undefined : `${toolName(flip.tool)}’s settings did not take the change.`; }
  catch { return `${at.file} could not be read back.`; }
}

/**
 * Makes the flips, one checked write per settings file (Claude Code's and Copilot's settings.json hold skill and MCP switches
 * together; Codex's config.toml too), then confirms each by reading its file back: what the tool will see, not what was meant.
 */
async function flipAll(context: ShareContext, home: HomeRead, flips: ProfileFlip[]): Promise<{ done: ProfileFlip[]; results: DestinationResult[] }> {
  const results: DestinationResult[] = [];
  const done: ProfileFlip[] = [];
  const groups = new Map<string, [ProfileFlip, Switch][]>();
  const kept = await readKeptOverrides(context);
  const overrides = new Map<ProfileFlip, [string, string | undefined]>();
  for (const flip of flips) { const at = switchOf(context, home, flip, kept, overrides); groups.set(at.file, [...(groups.get(at.file) ?? []), [flip, at]]); }
  for (const [file, group] of groups) {
    const failed = await writeFlips(file, group);
    let after: string | undefined;
    try { after = await readFile(file, 'utf8'); } catch { /* every flip below fails: what the tool sees can't be confirmed */ }
    for (const [flip, at] of group) {
      const reason = failed.get(flip) ?? whyNotTaken(flip, at, after);
      if (reason) { results.push({ item: flip.name, harness: flip.tool, outcome: 'failed', message: `Could not turn it ${flip.disabled ? 'off' : 'on'} in ${toolName(flip.tool)}: ${reason}` }); continue; }
      done.push(flip);
      results.push({ item: flip.name, harness: flip.tool, outcome: 'switched', message: `${flip.disabled ? 'Off' : 'On'} in ${toolName(flip.tool)} from its next session.` });
    }
  }
  const changes = done.filter(flip => overrides.has(flip)).map(flip => overrides.get(flip)!);
  if (changes.length) await keepOverrides(context, Object.fromEntries(changes));
  return { done, results };
}

/** History keys every profile switch with this; Undo finds switches by their kind, 'profile'. */
const SWITCH_KEY = 'profiles:switch';

/** A switch or undo that didn't start, and why. */
const stopped = (why: string): ProfileSwitchResult => ({ stopped: why, results: [], flips: [] });

/** The History entry for a switch: the profile in use before and after (by id and name), and every switch it flipped. */
function switchEvent(context: ShareContext, profiles: ProfilesView, before: string | undefined, flips: ProfileFlip[]): HistoryEvent {
  const name = (id?: string) => profiles.profiles.find(profile => profile.id === id)?.name;
  const after = profiles.active;
  return { id: randomUUID(), at: new Date(clock(context)).toISOString(), key: SWITCH_KEY, item: name(after) ?? NO_PROFILE, kind: 'profile', losers: [], orderProved: true,
    profile: { ...(before ? { from: before, fromName: name(before) } : {}), ...(after ? { to: after, toName: name(after) } : {}), flips } };
}

// ---------- Switching, and its Undo ----------

/** Switches to a profile (null: No profile). One History entry names every switch it flipped, so Undo puts each one back. */
export async function switchProfile(context: ShareContext, id: string | null): Promise<ProfileSwitchResult> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return stopped(opened.stop);
  const profiles = opened.view;
  const target = id === null ? undefined : profiles.profiles.find(profile => profile.id === id);
  if (id !== null && !target) return stopped('That profile is gone. Nothing was switched.');
  const home = await readHome(context);
  const plan = planSwitch(home.items, target, profiles.offByProfile);
  const { done, results } = await flipAll(context, home, plan.flips);
  results.push(...plan.blocked.map(entry => ({ item: entry.name, harness: entry.tool, outcome: 'held' as const, message: entry.reason })));
  const before = profiles.active;
  profiles.active = target?.id;
  profiles.offByProfile = offAfterFailures(plan.offByProfile, plan.flips.filter(flip => !done.includes(flip)));
  await saveProfiles(context.home, profiles);
  const name = target?.name ?? NO_PROFILE;
  const again = before === profiles.active;
  if (!done.length && again) return { name, again, results, flips: done };
  const event = switchEvent(context, profiles, before, done);
  await appendHistory(context, [event]);
  return { name, again, results, flips: done, event: event.id };
}

/**
 * What an Undo of `past` puts back: each switch it flipped that is still as it left it (`back`, reversed). The rest stay as they
 * are, each with why in `results`: changed again since (by hand or a later switch), a tool whose file can't be read, or already
 * back (turned back in the tool, or the copy is gone). A switch it turned off that is on again now is in `foundOn`: profiles no
 * longer hold it.
 */
function whatGoesBack(history: HistoryEvent[], past: HistoryEvent, items: SwitchItem[]) {
  const back: ProfileFlip[] = [];
  const foundOn: ProfileFlip[] = [];
  const results: DestinationResult[] = [];
  const changedAgain = changedSince(history, past);
  for (const flip of past.profile?.flips ?? []) {
    const tool = toolName(flip.tool);
    const item = items.find(entry => entry.id === flip.item);
    const now = item?.tools[flip.tool];
    if (changedAgain(flip)) results.push({ item: flip.name, harness: flip.tool, outcome: 'stayed', message: `Changed again in ${tool} since, so it stays as it is.` });
    else if (item?.blocked[flip.tool]) results.push({ item: flip.name, harness: flip.tool, outcome: 'held', message: item.blocked[flip.tool]! });
    else if (now === (flip.disabled ? 'off' : 'on')) back.push({ ...flip, disabled: !flip.disabled });
    else {
      if (flip.disabled && now === 'on') foundOn.push(flip);
      results.push({ item: flip.name, harness: flip.tool, outcome: 'stayed', message: now ? `Already ${now} in ${tool}.` : `${tool} has no copy of it now.` });
    }
  }
  return { back, foundOn, results };
}

/**
 * Undo of a profile switch: each switch it flipped goes back, where it is still as the switch left it, and what profiles hold
 * changes by just those flips (later switches keep theirs). The profile before it is in use again only while this switch is still
 * the one that chose the profile in use. The undo is itself a switch in History, so its own Undo redoes it.
 */
export async function undoProfileSwitch(context: ShareContext, eventId: string): Promise<ProfileSwitchResult> {
  const opened = await openProfiles(context);
  if ('stop' in opened) return stopped(opened.stop);
  const profiles = opened.view;
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  if (!past?.profile) return stopped('That switch can’t be undone.');
  if (past.undoneBy) return stopped('That switch was already undone.');
  // Undoing this switch would make the profile before it the one in use again: if that profile was deleted since, the tools would
  // be put back to match a profile that no longer exists.
  const chose = choseProfileInUse(history, past);
  const from = past.profile.from;
  if (chose && from && !profiles.profiles.some(profile => profile.id === from)) return stopped(`${past.profile.fromName ?? 'The profile before it'} was deleted since, so this switch can’t be undone. Switch to another profile, or to No profile, instead.`);
  const home = await readHome(context);
  const { back, foundOn, results } = whatGoesBack(history, past, home.items);
  const { done, results: flipped } = await flipAll(context, home, back);
  results.push(...flipped);
  const before = profiles.active;
  if (chose) profiles.active = from;
  // Nothing went back, the profile in use is the same, and something couldn't change: nothing is saved, History included, so the
  // Undo can be tried again once that is fixed.
  const couldNot = results.find(result => result.outcome === 'failed' || result.outcome === 'held');
  if (!done.length && before === profiles.active && couldNot) return { stopped: `Nothing was undone: ${couldNot.message}`, results, flips: [] };
  const holds = releaseHolds(offAfterFlips(profiles.offByProfile, done), foundOn);
  // Back to No profile: holds on what is gone let go, as a switch to No profile would, so none is left that nothing could clear.
  profiles.offByProfile = profiles.active ? holds : holdsOnWhatIsHere(holds, home.items);
  await saveProfiles(context.home, profiles);
  const undo = switchEvent(context, profiles, before, done);
  past.undoneBy = undo.id;
  await replaceHistory(context, [...history, undo]);
  return { results, flips: done, event: undo.id };
}
