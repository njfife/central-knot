// What a profile switch changes, worked out from what the home has now. Shared by the main process (which carries it out) and the
// page (which shows what is on, and what an Apply would change), so both always agree.
//
// The rules:
// - An item left out of the profile is turned off, with each tool's own switch, in every tool where it is on. Those switches are
//   remembered as held by profiles.
// - An item in the profile is turned back on only where a profile turned it off. A switch turned off by hand stays off.
// - No profile turns back on everything profiles turned off, and holds nothing.
import type { HarnessId, ManageView, McpView, Profile, ProfileFlip, SkillFacts } from './types.ts';

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
}

function toItem(kind: ItemKind, facts: SkillFacts): SwitchItem {
  const tools: SwitchItem['tools'] = {};
  const blocked: SwitchItem['blocked'] = {};
  for (const tool of Object.keys(facts.copies) as HarnessId[]) {
    const problem = facts.switchProblem?.[tool];
    if (problem) blocked[tool] = problem;
    tools[tool] = !problem && facts.disabled?.includes(tool) ? 'off' : 'on';
  }
  return { id: itemId(kind, facts.key), kind, key: facts.key, name: facts.name, description: facts.description, tools, blocked };
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
    const keep: HarnessId[] = [];
    if (!wanted || wanted.has(item.id)) {
      for (const tool of before) {
        if (item.tools[tool] !== 'off') continue;
        if (item.blocked[tool]) { blocked.push({ item: item.id, name: item.name, tool, reason: item.blocked[tool]! }); keep.push(tool); continue; }
        flips.push({ item: item.id, name: item.name, tool, disabled: false });
      }
    } else {
      // Off already, by an earlier switch: still held. Off by hand: left alone, and never held.
      keep.push(...before.filter(tool => item.tools[tool] === 'off'));
      for (const [tool, now] of Object.entries(item.tools) as [HarnessId, 'on' | 'off'][]) {
        if (now !== 'on') continue;
        if (item.blocked[tool]) { blocked.push({ item: item.id, name: item.name, tool, reason: item.blocked[tool]! }); continue; }
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
