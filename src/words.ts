// Words shared by pages: each tool's display name, and "a, b and c" lists.
import type { HarnessId } from './types.ts';

export const toolNames: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };

/** A tool's display name from an id that may come from a file or a report (an unknown id is shown as it is). */
export const toolName = (tool: string) => (toolNames as Record<string, string>)[tool] ?? tool;

/** Joins items as a sentence does, with `word` before the last: "a", "a and b", "a, b and c". */
const joined = (items: string[], word: 'and' | 'or') => (items.length > 2 ? `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}` : items.join(` ${word} `));

/** "a", "a and b", "a, b and c". */
export const andList = (items: string[]) => joined(items, 'and');

/** "a", "a or b", "a, b or c": for choices, such as where something can be added. */
export const orList = (items: string[]) => joined(items, 'or');


/**
 * The tools an action touched, as a sentence names them: "all 3 tools" when they are exactly the home's tools and there
 * are more than two, else their names ("Claude Code and Codex"). Takes ids, so it compares which tools, not how many:
 * an event from before a tool was added or removed is named tool by tool.
 */
export function toolsPhrase(touched: string[], inHome: string[]): string {
  const tools = [...new Set(touched)];
  const everyOne = tools.length > 2 && tools.length === inHome.length && inHome.every(tool => tools.includes(tool));
  return everyOne ? `all ${tools.length} tools` : andList(tools.map(toolName));
}
