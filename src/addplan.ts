// What adding one tool's skills to another would do, skill by skill. Pure: the page draws it, the tests check it.
import type { SampleSkill, Tool } from './design.ts';
import { comparedTools, copiesDiffer } from './syncrules.ts';

export interface AddPlan {
  /** Unmanaged; the target has no copy: one is copied in. */
  fresh: SampleSkill[];
  /** Unmanaged; the target already has the same copy: adding only makes it managed. Nothing is copied. */
  same: SampleSkill[];
  /** Managed, but syncing to the target (or from the source) is turned off: adding turns it back on. */
  resume: SampleSkill[];
  /**
   * Copies differ once it syncs: adding means every tool uses the source's copy. `replaced` names the tools whose copies give way;
   * `here` is true when the target's own copy differs, false when only another tool's does.
   */
  differ: { skill: SampleSkill; replaced: Tool[]; here: boolean }[];
  /** Differing copies where the source's copy cannot be used everywhere it would sync. */
  blocked: { skill: SampleSkill; reason: string }[];
  /** Managed and syncing between the two already, with the same copy: nothing to do here. */
  synced: SampleSkill[];
  /** Cannot go there at all. */
  skip: { skill: SampleSkill; reason: string }[];
}

/** The tools Apply all would write for a skill, as the engine counts them: syncing and able to load it. */
export const syncingTools = (skill: SampleSkill, tools: Tool[]) => tools.filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool]);
/** Managed, with both tools on: the source's copy then counts. */
export const withBoth = (skill: SampleSkill, from: Tool, to: Tool): SampleSkill => ({ ...skill, managed: true, separate: false, off: skill.off.filter(tool => tool !== from && tool !== to) });
/**
 * As withBoth, but a skill not managed yet syncs between these two tools only (every other one in `tools` is turned off), so
 * adding to one harness from its own page never writes to a third. A managed skill keeps the tools it already syncs to.
 */
export const withOnlyBoth = (skill: SampleSkill, from: Tool, to: Tool, tools: Tool[]): SampleSkill =>
  skill.managed ? withBoth(skill, from, to) : { ...withBoth(skill, from, to), off: tools.filter(tool => tool !== from && tool !== to) };

/** Sorts one tool's skills by what adding them to another would do. `list` is the page as it will be after Apply all. `onlyBoth`: see withOnlyBoth. */
export function planAdd(list: SampleSkill[], from: Tool, to: Tool, tools: Tool[], { onlyBoth = false } = {}): AddPlan {
  const plan: AddPlan = { fresh: [], same: [], resume: [], differ: [], blocked: [], synced: [], skip: [] };
  for (const skill of list) {
    if (skill.copies[from] === undefined) continue;
    const skip = skill.held ? `Can’t be managed: ${skill.held}` : skill.cannot?.[to] ?? skill.cannot?.[from] ?? (skill.separate ? 'You chose to keep its differing copies as they are.' : undefined);
    if (skip) { plan.skip.push({ skill, reason: skip }); continue; }
    const bothOn = skill.managed && !skill.off.includes(from) && !skill.off.includes(to);
    // Already syncing between these two with one copy: nothing to add here, whatever a third tool holds.
    if (bothOn && (skill.copies[to] === skill.copies[from] || !copiesDiffer(skill))) { plan.synced.push(skill); continue; }
    const next = onlyBoth ? withOnlyBoth(skill, from, to, tools) : withBoth(skill, from, to);
    if (!copiesDiffer(next)) { (skill.managed ? plan.resume : skill.copies[to] === undefined ? plan.fresh : plan.same).push(skill); continue; }
    // The same rule Apply all uses: a block counts for a tool the skill would sync to.
    const block = skill.blocks?.[from]?.find(entry => syncingTools(next, tools).includes(entry.tool));
    if (block) { plan.blocked.push({ skill, reason: block.reason }); continue; }
    plan.differ.push({
      skill,
      replaced: comparedTools(next).filter(tool => next.copies[tool] !== next.copies[from]),
      here: next.copies[to] !== undefined && next.copies[to] !== next.copies[from],
    });
  }
  return plan;
}
