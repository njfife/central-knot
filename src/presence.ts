// Which tools are in a home. Every page offers and names only these, and sync writes only to these, so the rule lives
// here, once, for the main process and the page alike.
import type { HarnessId, Snapshot } from './types.ts';

/**
 * A tool is in this home when it really exists there: its app or CLI was detected, or its own configuration folder was
 * found (discovery marks both by leaving `detection` other than 'Not found'). Skills in a folder several tools share,
 * such as ~/.agents/skills, never count: they would make every tool that reads that folder look installed.
 */
export const isPresent = (snapshot: Snapshot): boolean => snapshot.detection !== 'Not found';

/** The tools in this home, in discovery order: the columns, boxes, menus and sentences every page draws from. */
export const presentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(isPresent).map(snapshot => snapshot.harness);

/** The tools last noted in the open home, and that home, so a change is acted on once. */
export interface NotedTools { home: string; tools: string }

/**
 * Notes which tools are in `home`. `changed` only when they differ from those noted while that same home stayed open: a home
 * just opened is only noted, since opening it starts watching and the page reads it anyway.
 */
export function noteTools(last: NotedTools, home: string, snapshots: Snapshot[]): { noted: NotedTools; changed: boolean } {
  const noted = { home, tools: presentTools(snapshots).join() };
  return { noted, changed: home === last.home && noted.tools !== last.tools };
}

/** The tools that install plugins: every tool but Pi, which has none. */
export type PluginTool = Exclude<HarnessId, 'pi-cli'>;
export const pluginTools: PluginTool[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

/** Whether a tool (or a value from the page) is one that installs plugins. */
export const takesPlugins = (tool: unknown): tool is PluginTool => pluginTools.some(entry => entry === tool);

/** A kind of item a home's tools hold, each with its own page. Every tool holds skills and an instruction file. */
export type HomeKind = 'skills' | 'mcp' | 'agents' | 'instructions' | 'plugins';

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

/** What a home's view says about its tools: all of them, and those that hold MCP servers and agents. */
interface ToolsHeld { manage: { tools: HarnessId[] }; mcp: { tools: HarnessId[] }; agents: { tools: HarnessId[] } }

/**
 * The kinds no tool in this home can hold: pages and wording leave them out, since what doesn't exist here shouldn't show
 * as an option. A home with no tools at all holds none of them.
 */
export function absentKindsIn(view: ToolsHeld): HomeKind[] {
  if (!view.manage.tools.length) return ['skills', 'mcp', 'agents', 'instructions', 'plugins'];
  const absent: HomeKind[] = [];
  if (!view.mcp.tools.length) absent.push('mcp');
  if (!view.agents.tools.length) absent.push('agents');
  if (!view.manage.tools.some(takesPlugins)) absent.push('plugins');
  return absent;
}

/** The kinds a home's tools hold that sync keeps the same (skills, MCP servers, agents), in that order. */
export const heldKinds = (view: ToolsHeld): ('skills' | 'mcp' | 'agents')[] => (['skills', 'mcp', 'agents'] as const).filter(kind => !absentKindsIn(view).includes(kind));

/** The tools looked for and not found here, in discovery order: only the Tools page names them, as information. */
export const absentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(snapshot => !isPresent(snapshot)).map(snapshot => snapshot.harness);
