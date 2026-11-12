// What a profile switch changes, worked out from what the home has now. Shared by the main process (which carries it out) and the
// page (which shows what is on, and what an Apply would change), so both always agree.
//
// The rules:
// - An item left out of the profile is turned off, with each tool's own switch, in every tool where it is on. Those switches are
//   remembered as turned off by profiles (`offByProfile`).
// - An item in the profile is turned back on only where a profile turned it off. A switch turned off by hand stays off.
// - No profile turns back on everything profiles turned off, and holds nothing.
import { plural } from './model.ts';
import { andList, problemText, toolName } from './words.ts';
import type { HarnessId, HistoryEvent, LibraryView, McpView, Profile, ProfileFlip, ProfilesView, SkillFacts, ToolCopy } from './types.ts';

/** What every screen calls having no profile in use. */
export const NO_PROFILE = 'No profile';

/** The profile in use, if one is. */
export const activeProfile = (view: Pick<ProfilesView, 'profiles' | 'active'>) => view.profiles.find(profile => profile.id === view.active);

/** Whether profiles are in play here: one exists, or a switch still holds something off (the menus and the page show them). */
export const profilesInUse = (view: Pick<ProfilesView, 'profiles' | 'offByProfile'>) => view.profiles.length > 0 || Object.keys(view.offByProfile).length > 0;

/**
 * History as it still stands: a change and the undo that reversed it cancel out, so neither counts any more. A redo (an undo of
 * that undo) reverses something already cancelled, so it stands on its own. `undoing`, the event being undone now, always stands:
 * it is in effect until this undo is done. That matters for Redo: without it, the undo being redone would cancel against the
 * switch it undid, and the redo would not choose that switch's profile again.
 */
export function standing(history: HistoryEvent[], undoing?: HistoryEvent): HistoryEvent[] {
  const kept: HistoryEvent[] = [];
  for (const entry of history) {
    const reversed = entry === undoing ? -1 : kept.findIndex(earlier => earlier.undoneBy === entry.id);
    if (reversed >= 0) kept.splice(reversed, 1); else kept.push(entry);
  }
  return kept;
}

/**
 * Whether a switch `past` flipped was changed again after it, so an Undo of `past` leaves it: by hand (a Disable or Enable on the
 * Skills or MCP servers page, or its Undo: each one is a choice made by hand, even when an Undo cancels the other) or by a later
 * profile switch that still stands. A server's 'switched' event is keyed "mcp:<name>", which is its profile item id already.
 */
export function changedSince(history: HistoryEvent[], past: HistoryEvent): (flip: Pick<ProfileFlip, 'item' | 'tool'>) => boolean {
  const later = history.slice(history.indexOf(past) + 1);
  const at = (item: string, tool: HarnessId) => `${item}|${tool}`;
  const touched = new Set([
    ...later.filter(entry => entry.kind === 'switched').flatMap(entry => (entry.switched ?? []).map(({ tool }) => at(entry.key.startsWith('mcp:') ? entry.key : itemId('skill', entry.key), tool))),
    ...standing(later).filter(entry => entry.kind === 'profile').flatMap(entry => entry.profile?.flips.map(flip => at(flip.item, flip.tool)) ?? []),
  ]);
  return flip => touched.has(at(flip.item, flip.tool));
}

/** Whether a profile event changed which profile is in use: an Apply (the same profile again) did not. */
export const changedProfile = (event: HistoryEvent) => event.kind === 'profile' && !!event.profile && (event.profile.from ?? '') !== (event.profile.to ?? '');

/**
 * Whether `past` chose the profile in use: it is the latest switch still standing that changed which profile is in use. An Apply,
 * or an undo of an older switch, changes switches but not the profile, so it chooses nothing; a switch and its undo cancel out.
 */
export const choseProfileInUse = (history: HistoryEvent[], past: HistoryEvent) => [...standing(history, past)].reverse().find(changedProfile)?.id === past.id;

/**
 * The switch `event` made again, when it is a redo: it undid an undo, so it redoes what that undo reversed. Undefined for a switch
 * or a plain undo.
 */
export function redoneSwitch(history: HistoryEvent[], event: HistoryEvent): HistoryEvent | undefined {
  const undid = history.find(other => other.undoneBy === event.id);
  return undid && history.find(other => other.undoneBy === undid.id);
}

export type ItemKind = 'skill' | 'mcp';
export const itemId = (kind: ItemKind, key: string) => `${kind}:${key}`;
export const itemKind = (id: string): ItemKind => (id.startsWith('mcp:') ? 'mcp' : 'skill');
/** An item's key without its kind: `skill:notes` → `notes`. */
export const itemKeyOf = (id: string) => id.slice(id.indexOf(':') + 1);

/** One skill or MCP server as a profile sees it: which tools have it, and whether each tool's switch has it on. */
export interface SwitchItem {
  id: string;
  kind: ItemKind;
  key: string;
  name: string;
  description: string;
  /** Each tool with a copy, on or off by that tool's switch. */
  tools: Partial<Record<HarnessId, 'on' | 'off'>>;
  /** Tools whose switch can't be used (its settings file can't be read), with why. Their copy counts as on. */
  blocked: Partial<Record<HarnessId, string>>;
  /** For those tools, the settings file that can't be used. */
  blockedFile: Partial<Record<HarnessId, string>>;
}

/** One skill's or server's facts as an item: on or off per tool with a copy; a tool whose switch can't be read counts as on, and is blocked. */
function toItem(kind: ItemKind, facts: SkillFacts): SwitchItem {
  const tools: SwitchItem['tools'] = {};
  const blocked: SwitchItem['blocked'] = {};
  const blockedFile: SwitchItem['blockedFile'] = {};
  for (const tool of Object.keys(facts.copies) as HarnessId[]) {
    const problem = facts.switchProblem?.[tool];
    if (problem) { blocked[tool] = problemText(problem); blockedFile[tool] = problem.file; }
    tools[tool] = !problem && facts.disabled?.includes(tool) ? 'off' : 'on';
  }
  return { id: itemId(kind, facts.key), kind, key: facts.key, name: facts.name, description: facts.description, tools, blocked, blockedFile };
}

/**
 * What profiles read of skills, from the Skills page's view (skills.ts skillsView): each skill, in Central Knot or found, with
 * the tools that load it from a folder (its own copy, or one it has another way: types.ts LibraryFacts `loads`) and how each
 * tool's switch names that copy, in the shape profiles were written for (types.ts SkillFacts). A tool that has it through a
 * plugin is the plugin's, and a skill that is Off is in no tool, so neither has a switch here.
 */
export function profileSkills(view: Pick<LibraryView, 'items'>): SkillFacts[] {
  return view.items.map(row => {
    const loads = row.loads ?? {}, tools = Object.keys(loads) as HarnessId[];
    const copies = Object.fromEntries(tools.map(tool => {
      const at = loads[tool]!;
      return [tool, { hash: '', directory: at.skillFile.replace(/[\\/]SKILL\.md$/, ''), rootLabel: '', lines: 0, modified: '', summary: '', writable: true, folder: at.folder, name: at.name } satisfies ToolCopy];
    }));
    return { key: row.key, name: row.name, description: row.description, copies, extra: [], managed: row.on, off: row.except, cannot: {}, choiceBlocks: {},
      disabled: tools.filter(tool => loads[tool]!.off), ...(row.switchProblem ? { switchProblem: row.switchProblem } : {}) };
  });
}

/**
 * Every standalone skill and MCP server the home has (`skills`: profileSkills). A server that belongs to an app (ChatGPT
 * desktop's own) is left out.
 */
export function switchItems(skills: SkillFacts[], mcp: Pick<McpView, 'servers'>): SwitchItem[] {
  return [...skills.map(facts => toItem('skill', facts)), ...mcp.servers.filter(facts => !facts.held).map(facts => toItem('mcp', facts))];
}

/** A profile's items that the home has now (it may name skills or servers since removed): what it would keep on. */
export const presentItems = (profile: Pick<Profile, 'items'>, items: SwitchItem[]) => profile.items.filter(id => items.some(item => item.id === id));

export interface SwitchPlan {
  flips: ProfileFlip[];
  /** What profiles hold off once the flips are made. */
  offByProfile: Record<string, HarnessId[]>;
  /** Switches the plan would flip but can't, with why. */
  blocked: { item: string; name: string; tool: HarnessId; reason: string }[];
}

/** The switches that make the tools match `profile` (undefined: No profile), given what profiles hold off now. */
export function planSwitch(items: SwitchItem[], profile: Pick<Profile, 'items'> | undefined, offByProfile: Record<string, HarnessId[]>): SwitchPlan {
  const wanted = profile ? new Set(profile.items) : undefined;
  const flips: ProfileFlip[] = [];
  const blocked: SwitchPlan['blocked'] = [];
  // An item that isn't here right now (an unreadable folder, a tool not found this time) keeps what it holds, until No profile:
  // that lets go of holds on what isn't here, so a hold on something deleted for good doesn't keep profiles in play forever.
  const next: Record<string, HarnessId[]> = profile ? Object.fromEntries(Object.entries(offByProfile).filter(([id]) => !items.some(item => item.id === id))) : {};
  for (const item of items) {
    const before = offByProfile[item.id] ?? [];
    // A hold in a tool whose switch can't be read now is kept as it is: it can't be checked, and dropping it would make that
    // switch look turned off by hand once the tool reads again. So is one in a tool with no copy now, except under No profile.
    const keep: HarnessId[] = before.filter(tool => item.blocked[tool] || (profile && !item.tools[tool]));
    if (!wanted || wanted.has(item.id)) {
      for (const tool of before) {
        if (item.blocked[tool]) { blocked.push({ item: item.id, name: item.name, tool, reason: item.blocked[tool]! }); continue; }
        if (item.tools[tool] === 'off') flips.push({ item: item.id, name: item.name, tool, disabled: false });
      }
    } else {
      // Off already, by an earlier switch: still held. Off by hand: left alone, and never held.
      keep.push(...before.filter(tool => item.tools[tool] === 'off'));
      for (const [tool, now] of Object.entries(item.tools) as [HarnessId, 'on' | 'off'][]) {
        if (now !== 'on') continue;
        // Can't be read: reported, unless a profile turned it off already (then it is held, as above).
        if (item.blocked[tool]) { if (!before.includes(tool)) blocked.push({ item: item.id, name: item.name, tool, reason: item.blocked[tool]! }); continue; }
        flips.push({ item: item.id, name: item.name, tool, disabled: true });
        keep.push(tool);
      }
    }
    if (keep.length) next[item.id] = keep;
  }
  return { flips, offByProfile: next, blocked };
}

/** Each item's tools turned off by hand (off, and not turned off by a profile). */
export const offByHand = (item: SwitchItem, offByProfile: Record<string, HarnessId[]>) => (Object.entries(item.tools) as [HarnessId, 'on' | 'off'][]).filter(([tool, now]) => now === 'off' && !offByProfile[item.id]?.includes(tool)).map(([tool]) => tool);

/**
 * `offByProfile` changed by flips that were made: a switch turned off is held from now on, one turned back on is let go. A flip
 * that failed changes nothing, so its switch stays held (or not) as it was.
 */
export function offAfterFlips(offByProfile: Record<string, HarnessId[]>, done: Pick<ProfileFlip, 'item' | 'tool' | 'disabled'>[]): Record<string, HarnessId[]> {
  const next = Object.fromEntries(Object.entries(offByProfile).map(([id, tools]) => [id, new Set(tools)]));
  for (const flip of done) {
    const tools = (next[flip.item] ??= new Set());
    if (flip.disabled) tools.add(flip.tool); else tools.delete(flip.tool);
  }
  return Object.fromEntries(Object.entries(next).filter(([, tools]) => tools.size).map(([id, tools]) => [id, [...tools]]));
}

/**
 * The plan's holds, which assume every flip was made, corrected for the flips that failed and left their switch as it was: a
 * failed turn-off isn't held, and a failed turn-on is still held. Taking a failed flip back out of the plan is the same as making
 * its opposite, so each one is applied reversed.
 */
export const offAfterFailures = (planned: Record<string, HarnessId[]>, failed: ProfileFlip[]) => offAfterFlips(planned, failed.map(flip => ({ ...flip, disabled: !flip.disabled })));

/** `offByProfile` with some switches taken over (an explicit Disable or Enable, or found on again): profiles no longer hold them. */
export const releaseHolds = (offByProfile: Record<string, HarnessId[]>, released: Pick<ProfileFlip, 'item' | 'tool'>[]) => offAfterFlips(offByProfile, released.map(entry => ({ ...entry, disabled: false })));

/**
 * `offByProfile` without holds on what is gone: an item, or a tool's copy, that the home no longer has lets go (as No profile does).
 * Every other hold stays, including one on a tool whose switch can't be read now.
 */
export const holdsOnWhatIsHere = (offByProfile: Record<string, HarnessId[]>, items: SwitchItem[]) => Object.fromEntries(Object.entries(offByProfile)
  .map(([id, tools]) => { const item = items.find(entry => entry.id === id); return [id, item ? tools.filter(tool => item.tools[tool] || item.blocked[tool]) : []] as const; })
  .filter(([, tools]) => tools.length));

/** How many items flips turn off and back on. An item flipped in several tools counts once. */
export function flipCounts(flips: ProfileFlip[]): { off: number; on: number } {
  const count = (disabled: boolean) => new Set(flips.filter(flip => flip.disabled === disabled).map(flip => flip.item)).size;
  return { off: count(true), on: count(false) };
}

/**
 * Flip counts in words: what a switch will do ('turns 4 items off and turns 1 item back on') or did ('4 items turned off and 1 item
 * turned back on'). '' when there is nothing.
 */
export function flipWords({ off, on }: { off: number; on: number }, tense: 'will' | 'did'): string {
  const said = (count: number, what: string) => (tense === 'will' ? `turns ${plural(count, 'item')} ${what}` : `${plural(count, 'item')} turned ${what}`);
  return [off && said(off, 'off'), on && said(on, 'back on')].filter(Boolean).join(' and ');
}

/** What a switch did, in one phrase the result band and History share: '4 items turned off in Claude Code and Codex'; '' for nothing. */
export function flipSummary(flips: ProfileFlip[]): string {
  const did = flipWords(flipCounts(flips), 'did');
  return did && `${did} in ${andList([...new Set(flips.map(flip => toolName(flip.tool)))])}`;
}

/** How many items the tools no longer match the profile in use on (or No profile, on what profiles still hold off): 0 when they match. */
export function driftOf(items: SwitchItem[], profiles: Pick<ProfilesView, 'profiles' | 'active' | 'offByProfile'>): number {
  return new Set(planSwitch(items, activeProfile(profiles), profiles.offByProfile).flips.map(flip => flip.item)).size;
}
