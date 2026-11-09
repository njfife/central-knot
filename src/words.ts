// Words shared by pages: each tool's display name, and "a, b and c" lists.
import type { HarnessId } from './types.ts';

export const toolNames: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };

/** A tool's display name from an id that may come from a file or a report (an unknown id is shown as it is). */
export const toolName = (tool: string) => (toolNames as Record<string, string>)[tool] ?? tool;

/** The last part of a path, on any OS: `CLAUDE.md` from `…/.claude/CLAUDE.md`. */
export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** "a", "a and b", "a, b and c". */
export const andList = (items: string[]) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));

