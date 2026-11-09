// Words shared by pages: each tool's display name, and "a, b and c" lists.
import type { HarnessId } from './types.ts';

export const toolNames: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };

/** Sorts tool ids into the order the app lists tools everywhere (columns, notes, results). */
const TOOL_ORDER = Object.keys(toolNames);
export const byToolOrder = (first: HarnessId, second: HarnessId) => TOOL_ORDER.indexOf(first) - TOOL_ORDER.indexOf(second);

/** A tool's display name from an id that may come from a file or a report (an unknown id is shown as it is). */
export const toolName = (tool: string) => (toolNames as Record<string, string>)[tool] ?? tool;

/** "a", "a and b", "a, b and c". */
export const andList = (items: string[]) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));

