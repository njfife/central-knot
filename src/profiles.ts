// Profiles: named sets of skills and MCP servers to have on, switched in one step (feedback item 10, 2026-11-09).
// A switch uses each tool's own off-switch (skillswitch.ts for skills, mcpswitch.ts for MCP servers), so nothing is moved,
// removed or deleted, and Managed keeps syncing content underneath: a server or skill that is off still gets edits. The plan is
// profileplan.ts; this file keeps the profiles and carries a plan out, one write per settings file, then one History entry.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnesses } from './harnesses.ts';
import { appendHistory, manageView, readHistory, replaceHistory } from './manage.ts';
import { mcpView } from './mcp.ts';
import { mcpDisabled, mcpSwitchPath, withMcpSwitch } from './mcpswitch.ts';
import { itemId, itemKind, planSwitch, releaseHeld, switchItems, type SwitchItem } from './profileplan.ts';
import { errorCode, itemKey, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { switchPath, switchState, withSwitch, type SwitchTarget } from './skillswitch.ts';
import type { DestinationResult, HarnessId, HistoryEvent, Profile, ProfileFlip, ProfileSwitchResult, ProfilesView, Snapshot } from './types.ts';

// ---------- The profiles file ----------

interface ProfilesFile { formatVersion: 1; profiles: Profile[]; active?: string; held: Record<string, HarnessId[]> }
const profilesPath = (home: string) => join(storeDirectory(home), 'profiles.json');
const harnessIds = Object.keys(harnesses) as HarnessId[];

/** The home's profiles. A file that can't be read is reported, never overwritten: the person's profiles may still be in it. */
export async function readProfiles(home: string): Promise<ProfilesView> {
  let text: string;
  try { text = await readFile(profilesPath(home), 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { profiles: [], held: {} } : { profiles: [], held: {}, problem: `${profilesPath(home)} could not be read, so profiles can’t be used here.` };
  }
  try {
    const parsed = JSON.parse(text) as Partial<ProfilesFile>;
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
    const profiles = (Array.isArray(parsed.profiles) ? parsed.profiles : []).filter(profile => profile && typeof profile.id === 'string' && typeof profile.name === 'string').map(profile => ({ id: profile.id, name: profile.name, items: strings(profile.items) }));
    const held = Object.fromEntries(Object.entries(parsed.held && typeof parsed.held === 'object' ? parsed.held : {}).map(([id, tools]) => [id, strings(tools).filter((tool): tool is HarnessId => harnessIds.includes(tool as HarnessId))]).filter(([, tools]) => tools.length));
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

/** Profiles change Central Knot's own file only; still, a home that is preview-only gets nothing written. */
async function writable(context: ShareContext): Promise<string | undefined> {
  const access = await writeAccess(context);
  if (!access.allowed) return access.reason;
  const gate = await syncGate(context);
  return gate.state === 'stopped' ? gate.reason : undefined;
}

/** Adds a profile, or changes one's name or items. Names are unique, ignoring case. */
/** `restore`: `id` is a deleted profile's, made again as it was (Undo of Delete), so History's switches still name it. */
export async function saveProfile(context: ShareContext, input: { id?: string; name: string; items: string[]; restore?: boolean }): Promise<{ problem?: string; id?: string }> {
  const stop = await writable(context);
  if (stop) return { problem: stop };
  const view = await readProfiles(context.home);
  if (view.problem) return { problem: view.problem };
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { problem: 'A profile needs a name.' };
  if (name.length > 40) return { problem: 'Keep the name to 40 characters or fewer.' };
  if (view.profiles.some(profile => profile.id !== input.id && profile.name.toLowerCase() === name.toLowerCase())) return { problem: `There is already a profile called “${name}”.` };
  const items = [...new Set(input.items.filter(item => /^(skill|mcp):./.test(item)))];
  const existing = input.id ? view.profiles.find(profile => profile.id === input.id) : undefined;
  if (input.id && !existing && !input.restore) return { problem: 'That profile is gone. Nothing was saved.' };
  const id = existing?.id ?? randomUUID();
  view.profiles = existing ? view.profiles.map(profile => (profile.id === id ? { id, name, items } : profile)) : [...view.profiles, { id, name, items }];
  await saveProfiles(context.home, view);
  return { id };
}

/** Deletes a profile's definition. Its switches stay as they are; the active profile can't be deleted (switch away first). */
export async function deleteProfile(context: ShareContext, id: string): Promise<{ problem?: string }> {
  const stop = await writable(context);
  if (stop) return { problem: stop };
  const view = await readProfiles(context.home);
  if (view.problem) return { problem: view.problem };
  if (view.active === id) return { problem: 'That profile is in use. Switch to another profile, or to No profile, first.' };
  view.profiles = view.profiles.filter(profile => profile.id !== id);
  await saveProfiles(context.home, view);
  return {};
}

/**
 * The skill switches an explicit Disable, Enable or their Undo flipped (outcome 'switched' in `results`, for one of `changes`'
 * skills), as profile items: profiles stop holding these, since the person set them by hand.
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
function skillTarget(snapshots: Snapshot[], manage: Awaited<ReturnType<typeof manageView>>, key: string, tool: HarnessId): SwitchTarget | undefined {
  const copy = manage.skills.find(skill => skill.key === key)?.copies[tool];
  if (!copy) return undefined;
  const skill = snapshots.find(snapshot => snapshot.harness === tool)?.skills.find(entry => entry.directory === copy.directory);
  return { folder: copy.folder, name: skill?.name ?? copy.folder, skillFile: join(copy.directory, 'SKILL.md') };
}

interface Read { snapshots: Snapshot[]; manage: Awaited<ReturnType<typeof manageView>>; items: SwitchItem[] }
async function readHome(context: ShareContext): Promise<Read> {
  const snapshots = await context.read();
  const manage = await manageView(context);
  const mcp = await mcpView(context, manage.tools);
  return { snapshots, manage, items: switchItems(manage, mcp) };
}

/**
 * Makes the flips, one checked write per settings file (Claude Code's and Copilot's settings.json hold skill and MCP switches
 * together; Codex's config.toml too). A file saved meanwhile is read again once; each flip is confirmed by reading the file back.
 */
async function flipAll(context: ShareContext, home: Read, flips: ProfileFlip[]): Promise<{ done: ProfileFlip[]; results: DestinationResult[] }> {
  const path = (flip: ProfileFlip) => (itemKind(flip.item) === 'mcp' ? mcpSwitchPath(context, flip.tool) : switchPath(context, flip.tool));
  const key = (flip: ProfileFlip) => flip.item.slice(flip.item.indexOf(':') + 1);
  const results: DestinationResult[] = [];
  const done: ProfileFlip[] = [];
  const state = (flip: ProfileFlip, text: string, target?: SwitchTarget) => (itemKind(flip.item) === 'mcp' ? mcpDisabled(flip.tool, text, key(flip)) : switchState(context, flip.tool, text, target!));
  const groups = new Map<string, ProfileFlip[]>();
  for (const flip of flips) groups.set(path(flip), [...(groups.get(path(flip)) ?? []), flip]);
  for (const [file, group] of groups) {
    const targets = new Map(group.map(flip => [flip, itemKind(flip.item) === 'skill' ? skillTarget(home.snapshots, home.manage, key(flip), flip.tool) : undefined]));
    let failed = new Map<ProfileFlip, string>();
    for (let attempt = 0; attempt < 2; attempt++) {
      failed = new Map();
      let original: string | undefined;
      try { original = await readFile(file, 'utf8'); } catch (error) { if (errorCode(error) !== 'ENOENT') { for (const flip of group) failed.set(flip, `${file} could not be read.`); break; } }
      let text = original ?? '';
      for (const flip of group) {
        try {
          if (itemKind(flip.item) === 'mcp') text = withMcpSwitch(flip.tool, text, key(flip), flip.disabled);
          else { const target = targets.get(flip); if (!target) throw new Error(`${harnesses[flip.tool].name} has no copy of it now.`); text = withSwitch(context, flip.tool, text, target, flip.disabled); }
        } catch (error) { failed.set(flip, error instanceof Error ? error.message : String(error)); }
      }
      if (text === (original ?? '')) break;
      try { await writeFileChecked(file, text, original); break; }
      catch (error) {
        // Saved by the tool just now: read it again once and redo the edits on what it holds.
        if ((errorCode(error) === 'CK_CHANGED' || errorCode(error) === 'CK_OCCUPIED') && attempt === 0) continue;
        for (const flip of group) if (!failed.has(flip)) failed.set(flip, errorCode(error) === 'CK_CHANGED' ? `${file} kept changing, so it was left as it is.` : `Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    // Confirmed by reading back: what the tool will see, not what was meant.
    let after = '';
    try { after = await readFile(file, 'utf8'); } catch { /* every flip below then fails its check */ }
    for (const flip of group) {
      let reason = failed.get(flip);
      if (!reason) { try { if (state(flip, after, targets.get(flip)) !== flip.disabled) reason = `${harnesses[flip.tool].name}’s settings did not take the change.`; } catch { reason = `${file} could not be read back.`; } }
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

/** History keys every profile switch with this; Undo finds switches by their kind, 'profile'. */
const SWITCH_KEY = 'profiles:switch';

// ---------- Switching, and its Undo ----------

/** Switches to a profile (null: No profile). One History entry names every switch it flipped, so Undo puts each one back. */
export async function switchProfile(context: ShareContext, id: string | null): Promise<ProfileSwitchResult> {
  const stop = await writable(context);
  if (stop) return { stopped: stop, results: [], flips: [] };
  const profiles = await readProfiles(context.home);
  if (profiles.problem) return { stopped: profiles.problem, results: [], flips: [] };
  const target = id === null ? undefined : profiles.profiles.find(profile => profile.id === id);
  if (id !== null && !target) return { stopped: 'That profile is gone. Nothing was switched.', results: [], flips: [] };
  const home = await readHome(context);
  const plan = planSwitch(home.items, target, profiles.held);
  const { done, results } = await flipAll(context, home, plan.flips);
  results.push(...plan.blocked.map(entry => ({ item: entry.name, harness: entry.tool, outcome: 'held' as const, message: entry.reason })));
  const before = profiles.active;
  profiles.active = target?.id;
  // The plan's holds assume every flip was made. One that failed left its switch as it was: a failed turn-off isn't held, and a
  // failed turn-on is still held, which is the plan's holds with that flip turned around.
  const failed = plan.flips.filter(flip => !done.includes(flip));
  profiles.held = heldAfterFlips(plan.held, failed.map(flip => ({ ...flip, disabled: !flip.disabled })));
  await saveProfiles(context.home, profiles);
  if (!done.length && before === profiles.active) return { results, flips: done };
  const fromName = profiles.profiles.find(profile => profile.id === before)?.name;
  const event: HistoryEvent = { id: randomUUID(), at: new Date(context.now?.() ?? Date.now()).toISOString(), key: SWITCH_KEY, item: target?.name ?? 'No profile', kind: 'profile', losers: [], orderProved: true,
    profile: { ...(before ? { from: before, fromName } : {}), ...(target ? { to: target.id, toName: target.name } : {}), flips: done } };
  await appendHistory(context, [event]);
  return { results, flips: done, event: event.id };
}

/**
 * Undo of a profile switch: each switch it flipped goes back, where it is still as the switch left it, and what profiles hold
 * changes by just those flips (later switches keep theirs). The profile before it is in use again only while this switch is still
 * the one that chose the profile in use. The undo is itself a switch in History, so its own Undo redoes it.
 */
export async function undoProfileSwitch(context: ShareContext, eventId: string): Promise<ProfileSwitchResult> {
  const stop = await writable(context);
  if (stop) return { stopped: stop, results: [], flips: [] };
  const history = await readHistory(context.home);
  const past = history.find(entry => entry.id === eventId);
  if (!past?.profile) return { stopped: 'That switch can’t be undone.', results: [], flips: [] };
  if (past.undoneBy) return { stopped: 'That switch was already undone.', results: [], flips: [] };
  const profiles = await readProfiles(context.home);
  if (profiles.problem) return { stopped: profiles.problem, results: [], flips: [] };
  const home = await readHome(context);
  const results: DestinationResult[] = [];
  const back: ProfileFlip[] = [];
  for (const flip of past.profile.flips) {
    const now = home.items.find(item => item.id === flip.item)?.tools[flip.tool];
    // Changed since (turned back by hand, or the copy is gone): left as it is now.
    if (now !== (flip.disabled ? 'off' : 'on')) { results.push({ item: flip.name, harness: flip.tool, outcome: 'stayed', message: now ? `Already ${now} in ${harnesses[flip.tool].name}.` : `${harnesses[flip.tool].name} has no copy of it now.` }); continue; }
    back.push({ ...flip, disabled: !flip.disabled });
  }
  const { done, results: flipped } = await flipAll(context, home, back);
  results.push(...flipped);
  const governs = profiles.active === past.profile.to;
  const before = profiles.active;
  if (governs) profiles.active = past.profile.from && profiles.profiles.some(profile => profile.id === past.profile!.from) ? past.profile.from : undefined;
  profiles.held = heldAfterFlips(profiles.held, done);
  await saveProfiles(context.home, profiles);
  const name = (id?: string) => profiles.profiles.find(profile => profile.id === id)?.name;
  const undo: HistoryEvent = { id: randomUUID(), at: new Date(context.now?.() ?? Date.now()).toISOString(), key: SWITCH_KEY, item: name(profiles.active) ?? 'No profile', kind: 'profile', losers: [], orderProved: true,
    profile: { ...(before ? { from: before, fromName: name(before) } : {}), ...(profiles.active ? { to: profiles.active, toName: name(profiles.active) } : {}), flips: done } };
  past.undoneBy = undo.id;
  await replaceHistory(context, [...history, undo]);
  return { results, flips: done, event: undo.id };
}
