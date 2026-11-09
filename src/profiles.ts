// Profiles: named sets of skills and MCP servers to have on, switched in one step (feedback item 10, 2026-11-09).
// A switch uses each tool's own off-switch (skillswitch.ts for skills, mcpswitch.ts for MCP servers), so nothing is moved,
// removed or deleted, and Managed keeps syncing content underneath: a server or skill that is off still gets edits. The plan is
// profileplan.ts; this file keeps the profiles and carries a plan out, one write per settings file, then one History entry.
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessIds, harnesses } from './harnesses.ts';
import { appendHistory, manageView, readHistory, replaceHistory } from './manage.ts';
import { mcpView } from './mcp.ts';
import { mcpDisabled, mcpSwitchPath, withMcpSwitch } from './mcpswitch.ts';
import { changedSince, choseProfileInUse, driftOf, itemId, itemKeyOf, itemKind, NO_PROFILE, planSwitch, releaseHeld, switchItems, type SwitchItem } from './profileplan.ts';
import { errorCode, itemKey, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { switchPath, switchState, targetOf, withSwitch, type SwitchTarget } from './skillswitch.ts';
import { strings } from './values.ts';
import type { DestinationResult, HarnessId, HistoryEvent, Profile, ProfileEdit, ProfileFlip, ProfileSwitchResult, ProfilesView } from './types.ts';

// ---------- The profiles file ----------

interface ProfilesFile { formatVersion: 1; profiles: Profile[]; active?: string; held: Record<string, HarnessId[]> }
const profilesPath = (home: string) => join(storeDirectory(home), 'profiles.json');

/** The home's profiles. A file that can't be read is reported, never overwritten: the person's profiles may still be in it. */
export async function readProfiles(home: string): Promise<ProfilesView> {
  let text: string;
  try { text = await readFile(profilesPath(home), 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { profiles: [], held: {} } : { profiles: [], held: {}, problem: `${profilesPath(home)} could not be read, so profiles can’t be used here.` };
  }
  try {
    const parsed = JSON.parse(text) as Partial<ProfilesFile>;
    const profiles = (Array.isArray(parsed.profiles) ? parsed.profiles : []).filter(profile => profile && typeof profile.id === 'string' && typeof profile.name === 'string').map(profile => ({ id: profile.id, name: profile.name, items: strings(profile.items) ?? [] }));
    const held = Object.fromEntries(Object.entries(parsed.held && typeof parsed.held === 'object' ? parsed.held : {}).map(([id, tools]) => [id, (strings(tools) ?? []).filter((tool): tool is HarnessId => harnessIds.includes(tool as HarnessId))]).filter(([, tools]) => tools.length));
    const active = profiles.some(profile => profile.id === parsed.active) ? parsed.active : undefined;
    return { profiles, held, ...(active ? { active } : {}) };
  } catch {
    return { profiles: [], held: {}, problem: `${profilesPath(home)} is not a profiles file Central Knot can read, so profiles can’t be used here. Nothing in it was changed.` };
  }
}

async function saveProfiles(home: string, view: ProfilesView) {
  const file: ProfilesFile = { formatVersion: 1, profiles: view.profiles, ...(view.active ? { active: view.active } : {}), held: view.held };
  await writeDurably(profilesPath(home), `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Why nothing can be written here, if so: a preview-only home, or another build owning sync. Profiles change only Central Knot's
 * file and each tool's switches, never the sync record, so a record waiting for Resume does not stop them.
 */
async function whyReadOnly(context: ShareContext): Promise<string | undefined> {
  const access = await writeAccess(context);
  if (!access.allowed) return access.reason;
  const gate = await syncGate(context);
  return gate.state === 'stopped' ? gate.reason : undefined;
}

/** The home's profiles, ready to change, or why they can't be changed here (preview only, another build syncing, unreadable). */
async function openProfiles(context: ShareContext): Promise<{ view: ProfilesView } | { stop: string }> {
  const stop = await whyReadOnly(context);
  if (stop) return { stop };
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
  const name = (input.name ?? existing?.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { problem: 'A profile needs a name.' };
  if (name.length > 40) return { problem: 'Keep the name to 40 characters or fewer.' };
  if (view.profiles.some(profile => profile.id !== input.id && profile.name.toLowerCase() === name.toLowerCase())) return { problem: `There is already a profile called “${name}”.` };
  const items = [...new Set((input.items ?? existing?.items ?? []).filter(item => /^(skill|mcp):./.test(item)))];
  if (input.id && !existing && !input.restore) return { problem: 'That profile is gone. Nothing was saved.' };
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
  const held = releaseHeld(view.held, released);
  if (JSON.stringify(held) !== JSON.stringify(view.held)) await saveProfiles(context.home, { ...view, held });
}

// ---------- Flipping switches ----------

/** How each tool's skill switch names its copy of a skill: the folder, the name the tool reads, and the copy's SKILL.md. */
function skillTarget(manage: Awaited<ReturnType<typeof manageView>>, key: string, tool: HarnessId): SwitchTarget | undefined {
  const copy = manage.skills.find(skill => skill.key === key)?.copies[tool];
  return copy && targetOf(copy, copy.name ?? copy.folder);
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
  const files = [...new Set((Object.keys(harnesses) as HarnessId[]).flatMap(tool => [switchPath(context, tool), mcpSwitchPath(context, tool)]))];
  return (await Promise.all(files.map(file => stat(file).then(info => `${file}:${info.mtimeMs}`, () => `${file}:-`)))).join('|');
}

/** How many items the tools no longer match the profile in use on, read fresh (for the menu bar after a switch made there). */
export async function driftNow(context: ShareContext): Promise<number> {
  const view = await readProfiles(context.home);
  return view.problem ? 0 : driftOf((await readHome(context)).items, view);
}


/**
 * One flip's switch: the file it lives in, how to read whether the item is off there, and how to set it in that file's text.
 * Skills use the tool's skill switch (named by the copy: folder, name, path), MCP servers the tool's MCP switch (by name).
 */
interface Switch { file: string; isOff(text: string): boolean; set(text: string): string }
function switchOf(context: ShareContext, home: HomeRead, flip: ProfileFlip): Switch {
  const key = itemKeyOf(flip.item);
  if (itemKind(flip.item) === 'mcp') return { file: mcpSwitchPath(context, flip.tool), isOff: text => mcpDisabled(flip.tool, text, key), set: text => withMcpSwitch(flip.tool, text, key, flip.disabled) };
  const target = skillTarget(home.manage, key, flip.tool);
  const missing = () => { throw new Error(`${harnesses[flip.tool].name} has no copy of it now.`); };
  return { file: switchPath(context, flip.tool), isOff: text => (target ? switchState(context, flip.tool, text, target) : missing()), set: text => (target ? withSwitch(context, flip.tool, text, target, flip.disabled) : missing()) };
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
function notTaken(flip: ProfileFlip, at: Switch, after: string | undefined): string | undefined {
  if (after === undefined) return `${at.file} could not be read back.`;
  try { return at.isOff(after) === flip.disabled ? undefined : `${harnesses[flip.tool].name}’s settings did not take the change.`; }
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
  for (const flip of flips) { const at = switchOf(context, home, flip); groups.set(at.file, [...(groups.get(at.file) ?? []), [flip, at]]); }
  for (const [file, group] of groups) {
    const failed = await writeFlips(file, group);
    let after: string | undefined;
    try { after = await readFile(file, 'utf8'); } catch { /* every flip below fails: what the tool sees can't be confirmed */ }
    for (const [flip, at] of group) {
      const reason = failed.get(flip) ?? notTaken(flip, at, after);
      if (reason) { results.push({ item: flip.name, harness: flip.tool, outcome: 'failed', message: `Could not turn it ${flip.disabled ? 'off' : 'on'} in ${harnesses[flip.tool].name}: ${reason}` }); continue; }
      done.push(flip);
      results.push({ item: flip.name, harness: flip.tool, outcome: 'switched', message: `${flip.disabled ? 'Off' : 'On'} in ${harnesses[flip.tool].name} from its next session.` });
    }
  }
  return { done, results };
}

/**
 * `held` changed by the flips that were made: a switch turned off is held from now on, one turned back on is let go. A flip that
 * failed changes nothing, so its switch stays held (or not) as it was.
 */
function heldAfterFlips(held: Record<string, HarnessId[]>, done: ProfileFlip[]): Record<string, HarnessId[]> {
  const next = Object.fromEntries(Object.entries(held).map(([id, tools]) => [id, new Set(tools)]));
  for (const flip of done) {
    const tools = (next[flip.item] ??= new Set());
    if (flip.disabled) tools.add(flip.tool); else tools.delete(flip.tool);
  }
  return Object.fromEntries(Object.entries(next).filter(([, tools]) => tools.size).map(([id, tools]) => [id, [...tools]]));
}

/**
 * The plan's holds, which assume every flip was made, corrected for the flips that failed and left their switch as it was: a
 * failed turn-off isn't held, and a failed turn-on is still held.
 */
export function heldAfterFailures(planned: Record<string, HarnessId[]>, failed: ProfileFlip[]): Record<string, HarnessId[]> {
  return heldAfterFlips(planned, failed.map(flip => ({ ...flip, disabled: !flip.disabled })));
}

/** History keys every profile switch with this; Undo finds switches by their kind, 'profile'. */
const SWITCH_KEY = 'profiles:switch';

/** A switch or undo that didn't start, and why. */
const stopped = (why: string): ProfileSwitchResult => ({ stopped: why, results: [], flips: [] });

/** The History entry for a switch: the profile in use before and after (by id and name), and every switch it flipped. */
function switchEvent(context: ShareContext, profiles: ProfilesView, before: string | undefined, flips: ProfileFlip[]): HistoryEvent {
  const name = (id?: string) => profiles.profiles.find(profile => profile.id === id)?.name;
  const after = profiles.active;
  return { id: randomUUID(), at: new Date(context.now?.() ?? Date.now()).toISOString(), key: SWITCH_KEY, item: name(after) ?? NO_PROFILE, kind: 'profile', losers: [], orderProved: true,
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
  const plan = planSwitch(home.items, target, profiles.held);
  const { done, results } = await flipAll(context, home, plan.flips);
  results.push(...plan.blocked.map(entry => ({ item: entry.name, harness: entry.tool, outcome: 'held' as const, message: entry.reason })));
  const before = profiles.active;
  profiles.active = target?.id;
  profiles.held = heldAfterFailures(plan.held, plan.flips.filter(flip => !done.includes(flip)));
  await saveProfiles(context.home, profiles);
  if (!done.length && before === profiles.active) return { results, flips: done };
  const event = switchEvent(context, profiles, before, done);
  await appendHistory(context, [event]);
  return { results, flips: done, event: event.id };
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
  const history = await readHistory(context.home);
  const past = history.find(entry => entry.id === eventId);
  if (!past?.profile) return stopped('That switch can’t be undone.');
  if (past.undoneBy) return stopped('That switch was already undone.');
  const home = await readHome(context);
  const results: DestinationResult[] = [];
  const back: ProfileFlip[] = [];
  const later = changedSince(history, past);
  for (const flip of past.profile.flips) {
    if (later.has(`${flip.item}|${flip.tool}`)) { results.push({ item: flip.name, harness: flip.tool, outcome: 'stayed', message: `Changed again in ${harnesses[flip.tool].name} since, so it stays as it is.` }); continue; }
    const item = home.items.find(entry => entry.id === flip.item);
    if (item?.blocked[flip.tool]) { results.push({ item: flip.name, harness: flip.tool, outcome: 'held', message: item.blocked[flip.tool]! }); continue; }
    const now = item?.tools[flip.tool];
    // Changed since (turned back by hand, or the copy is gone): left as it is now.
    if (now !== (flip.disabled ? 'off' : 'on')) { results.push({ item: flip.name, harness: flip.tool, outcome: 'stayed', message: now ? `Already ${now} in ${harnesses[flip.tool].name}.` : `${harnesses[flip.tool].name} has no copy of it now.` }); continue; }
    back.push({ ...flip, disabled: !flip.disabled });
  }
  const { done, results: flipped } = await flipAll(context, home, back);
  results.push(...flipped);
  const before = profiles.active;
  if (choseProfileInUse(history, past)) profiles.active = past.profile.from && profiles.profiles.some(profile => profile.id === past.profile!.from) ? past.profile.from : undefined;
  profiles.held = heldAfterFlips(profiles.held, done);
  await saveProfiles(context.home, profiles);
  const undo = switchEvent(context, profiles, before, done);
  past.undoneBy = undo.id;
  await replaceHistory(context, [...history, undo]);
  return { results, flips: done, event: undo.id };
}
