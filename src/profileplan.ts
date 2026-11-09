// What a profile switch changes, worked out from what the home has now. Shared by the main process (which carries it out) and the
// page (which shows what is on, and what an Apply would change), so both always agree.
//
// The rules:
// - An item left out of the profile is turned off, with each tool's own switch, in every tool where it is on. Those switches are
//   remembered as turned off by profiles (`offByProfile`).
// - An item in the profile is turned back on only where a profile turned it off. A switch turned off by hand stays off.
// - No profile turns back on everything profiles turned off, and holds nothing.
import { plural } from './model.ts';
import { andList, toolName } from './words.ts';
import type { HarnessId, HistoryEvent, ManageView, McpView, Profile, ProfileFlip, ProfilesView, SkillFacts } from './types.ts';

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
 * Skills page, or its Undo: each one is a choice made by hand, even when an Undo cancels the other) or by a later profile switch
 * that still stands.
 */
export function changedSince(history: HistoryEvent[], past: HistoryEvent): (flip: Pick<ProfileFlip, 'item' | 'tool'>) => boolean {
  const later = history.slice(history.indexOf(past) + 1);
  const touched = new Set([
    ...later.filter(entry => entry.kind === 'switched').flatMap(entry => (entry.switched ?? []).map(({ tool }) => `${itemId('skill', entry.key)}|${tool}`)),
    ...standing(later).filter(entry => entry.kind === 'profile').flatMap(entry => entry.profile?.flips.map(flip => `${flip.item}|${flip.tool}`) ?? []),
  ]);
  return flip => touched.has(`${flip.item}|${flip.tool}`);
}

/**
 * Whether `past` chose the profile in use: it is the latest switch still standing that changed which profile is in use. An Apply,
 * or an undo of an older switch, changes switches but not the profile, so it chooses nothing; a switch and its undo cancel out.
 */
export const choseProfileInUse = (history: HistoryEvent[], past: HistoryEvent) =>
  [...standing(history, past)].reverse().find(entry => entry.kind === 'profile' && entry.profile && (entry.profile.from ?? '') !== (entry.profile.to ?? ''))?.id === past.id;

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

function toItem(kind: ItemKind, facts: SkillFacts): SwitchItem {
  const tools: SwitchItem['tools'] = {};
  const blocked: SwitchItem['blocked'] = {};
  for (const tool of Object.keys(facts.copies) as HarnessId[]) {
    const problem = facts.switchProblem?.[tool];
    if (problem) blocked[tool] = problem;
    tools[tool] = !problem && facts.disabled?.includes(tool) ? 'off' : 'on';
  }
  return { id: itemId(kind, facts.key), kind, key: facts.key, name: facts.name, description: facts.description, tools, blocked, blockedFile: facts.switchFile ?? {} };
}

/** Every standalone skill and MCP server the home has. A server that belongs to an app (ChatGPT desktop's own) is left out. */
export function switchItems(manage: Pick<ManageView, 'skills'>, mcp: Pick<McpView, 'servers'>): SwitchItem[] {
  return [...manage.skills.map(facts => toItem('skill', facts)), ...mcp.servers.filter(facts => !facts.held).map(facts => toItem('mcp', facts))];
}

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
  // that lets go of everything it can't check, so a hold on something deleted for good doesn't keep profiles in play forever.
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
      keep.push(...before.filter(tool => item.tools[tool] === 'off' && !item.blocked[tool]));
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

/** `offByProfile` with some switches taken over: profiles no longer hold each item's listed tools (an explicit Disable or Enable elsewhere). */
export function releaseHolds(offByProfile: Record<string, HarnessId[]>, released: { item: string; tool: HarnessId }[]): Record<string, HarnessId[]> {
  const next = Object.fromEntries(Object.entries(offByProfile).map(([id, tools]) => [id, tools.filter(tool => !released.some(entry => entry.item === id && entry.tool === tool))]));
  return Object.fromEntries(Object.entries(next).filter(([, tools]) => tools.length));
}

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
