// Words shared by pages: each tool's display name, and "a, b and c" lists.
import type { HomeKind } from './presence.ts';
import type { HarnessId, SwitchProblem } from './types.ts';

export const toolNames: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };

/** Sorts tool ids into the order the app lists tools everywhere (columns, notes, results). */
const TOOL_ORDER = Object.keys(toolNames);
export const byToolOrder = (first: HarnessId, second: HarnessId) => TOOL_ORDER.indexOf(first) - TOOL_ORDER.indexOf(second);

/** A tool's display name from an id that may come from a file or a report (an unknown id is shown as it is). */
export const toolName = (tool: string) => (toolNames as Record<string, string>)[tool] ?? tool;

/** The last part of a path, on any OS: `CLAUDE.md` from `…/.claude/CLAUDE.md`. */
export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A text's lines, without the empty one after a final line break ('' has one empty line). */
export const linesOf = (text: string) => text.replace(/\n$/, '').split('\n');
/** How many lines a text has (0 for none). */
export const lineCount = (text: string) => (text ? linesOf(text).length : 0);

/** Joins items as a sentence does, with `word` before the last: "a", "a and b", "a, b and c". */
const joined = (items: string[], word: 'and' | 'or') => (items.length > 2 ? `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}` : items.join(` ${word} `));

/** The text with its first letter capitalised, to start a sentence. */
export const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** "a", "a and b", "a, b and c". */
export const andList = (items: string[]) => joined(items, 'and');
/** Tools by name, as an and-list: "Claude Code, Copilot CLI and Codex". */
export const toolList = (tools: HarnessId[]) => andList(tools.map(tool => toolNames[tool]));

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

/** The same, starting a label or a sentence: "All 3 tools", "Claude Code and Codex". */
export const capitalToolsPhrase = (touched: string[], inHome: string[]): string => toolsPhrase(touched, inHome).replace(/^./, first => first.toUpperCase());

/** What a home with no tools says, wherever it says it: one sentence (pages.ts noToolsState adds the way forward). */
export const noToolsSentence = 'No tools were found in this home.';

/** A switch problem in words: the file (shown through `show`, say as ~/…) and what is wrong with it. */
export const problemText = (problem: SwitchProblem, show = (path: string) => path) => `${show(problem.file)} ${problem.reason}`;

/**
 * Each kind's words, the one place they are spelled: one of it and many as a sentence names them, the page's title, the
 * short noun a count uses ("2 servers"), and one of it with its article ("an MCP server").
 */
export const kindNouns: Record<HomeKind, { one: string; many: string; title: string; short: [string, string]; a: string }> = {
  skills: { one: 'skill', many: 'skills', title: 'Skills', short: ['skill', 'skills'], a: 'a skill' },
  mcp: { one: 'MCP server', many: 'MCP servers', title: 'MCP servers', short: ['server', 'servers'], a: 'an MCP server' },
  agents: { one: 'agent', many: 'agents', title: 'Agents', short: ['agent', 'agents'], a: 'an agent' },
  instructions: { one: 'instruction file', many: 'instruction files', title: 'Instructions', short: ['file', 'files'], a: 'an instruction file' },
  plugins: { one: 'plugin', many: 'plugins', title: 'Plugins', short: ['plugin', 'plugins'], a: 'a plugin' },
};

/** Each kind as a sentence names it, many of it: "MCP servers". */
export const kindNames = Object.fromEntries(Object.entries(kindNouns).map(([kind, nouns]) => [kind, nouns.many])) as Record<HomeKind, string>;

/** Why a tool gets no copy of a skill it already has through a plugin: said in its box, its row and wherever a copy is refused. */
export const throughPlugin = (tool: HarnessId, given: { plugin: string; version?: string; off?: true }) =>
  `${toolNames[tool]} has this skill through the plugin ${given.plugin}${given.version ? ` (version ${given.version})` : ''}${given.off ? ', turned off there' : ''}, so no separate copy is placed there.`;
