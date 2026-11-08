// Pure rules about copies, shared by the page and its tests. No DOM, no URL: safe to import anywhere.
import type { SampleSkill } from './design.ts';

/** The tools whose copies count: those it syncs to that can load it. A tool turned off, or one that cannot load it, keeps its own copy. */
export const comparedTools = (skill: SampleSkill) => Object.keys(skill.copies).filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool]);
/** Copies differ only between the tools that count, exactly as Apply all sees them. */
export const copiesDiffer = (skill: SampleSkill) => new Set(comparedTools(skill).map(tool => skill.copies[tool])).size > 1;
