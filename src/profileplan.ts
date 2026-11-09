// What a profile switch changes, worked out from what the home has now. Shared by the main process (which carries it out) and the
// page (which shows what is on, and what an Apply would change), so both always agree.
//
// The rules:
// - An item left out of the profile is turned off, with each tool's own switch, in every tool where it is on. Those switches are
//   remembered as held by profiles.
// - An item in the profile is turned back on only where a profile turned it off. A switch turned off by hand stays off.
// - No profile turns back on everything profiles turned off, and holds nothing.
import type { HarnessId, ManageView, McpView, Profile, ProfileFlip, ProfilesView, SkillFacts } from './types.ts';

export type ItemKind = 'skill' | 'mcp';
export const itemId = (kind: ItemKind, key: string) => `${kind}:${key}`;
export const itemKind = (id: string): ItemKind => (id.startsWith('mcp:') ? 'mcp' : 'skill');

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
  held: Record<string, HarnessId[]>;
  /** Switches the plan would flip but can't, with why. */
  blocked: { item: string; name: string; tool: HarnessId; reason: string }[];
}

/** The switches that make the tools match `profile` (undefined: No profile), given what profiles hold off now. */
export function planSwitch(items: SwitchItem[], profile: Pick<Profile, 'items'> | undefined, held: Record<string, HarnessId[]>): SwitchPlan {
  const wanted = profile ? new Set(profile.items) : undefined;
  const flips: ProfileFlip[] = [];
  const blocked: SwitchPlan['blocked'] = [];
  // An item that isn't here right now (an unreadable folder, a tool not found this time) keeps what it holds.
  const next: Record<string, HarnessId[]> = Object.fromEntries(Object.entries(held).filter(([id]) => !items.some(item => item.id === id)));
  for (const item of items) {
    const before = held[item.id] ?? [];
    // A hold in a tool whose switch can't be read now, or that has no copy now, is kept as it is: it can't be checked, and
    // dropping it would make that switch look turned off by hand once the tool reads again.
    const keep: HarnessId[] = before.filter(tool => item.blocked[tool] || !item.tools[tool]);
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
  return { flips, held: next, blocked };
}

/** Each item's tools turned off by hand (off, and not held by a profile). */
export const offByHand = (item: SwitchItem, held: Record<string, HarnessId[]>) => (Object.entries(item.tools) as [HarnessId, 'on' | 'off'][]).filter(([tool, now]) => now === 'off' && !held[item.id]?.includes(tool)).map(([tool]) => tool);

/** `held` with some switches taken over: each item's listed tools are no longer held (an explicit Disable or Enable elsewhere). */
export function releaseHeld(held: Record<string, HarnessId[]>, released: { item: string; tool: HarnessId }[]): Record<string, HarnessId[]> {
  const next = Object.fromEntries(Object.entries(held).map(([id, tools]) => [id, tools.filter(tool => !released.some(entry => entry.item === id && entry.tool === tool))]));
  return Object.fromEntries(Object.entries(next).filter(([, tools]) => tools.length));
}

/** How many items flips turn off and back on. An item flipped in several tools counts once. */
export function flipCounts(flips: ProfileFlip[]): { off: number; on: number } {
  const count = (disabled: boolean) => new Set(flips.filter(flip => flip.disabled === disabled).map(flip => flip.item)).size;
  return { off: count(true), on: count(false) };
}

/** How many items the tools no longer match the profile in use on (or No profile, on what profiles still hold off): 0 when they match. */
export function driftOf(items: SwitchItem[], profiles: Pick<ProfilesView, 'profiles' | 'active' | 'held'>): number {
  return new Set(planSwitch(items, profiles.profiles.find(profile => profile.id === profiles.active), profiles.held).flips.map(flip => flip.item)).size;
}
