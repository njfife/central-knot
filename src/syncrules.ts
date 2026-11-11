// Pure rules about copies, shared by the page and its tests. No DOM, no URL: safe to import anywhere.
import type { ItemRow } from './itemrow.ts';

/** The tools whose copies count: those it syncs to that can load it. A tool turned off, or one that cannot load it, keeps its
 * own copy. A copy waiting for its own write (Claude Code's MCP entry, Write now) does not count either. */
export const comparedTools = (skill: ItemRow) => Object.keys(skill.copies).filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool] && !skill.waits?.includes(tool));
/** Copies differ only between the tools that count, exactly as Apply all sees them. */
export const copiesDiffer = (skill: ItemRow) => new Set(comparedTools(skill).map(tool => skill.copies[tool])).size > 1;
