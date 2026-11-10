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

/** The tools that install plugins: every tool but Pi, which has none. */
export type PluginTool = Exclude<HarnessId, 'pi-cli'>;
export const pluginTools: PluginTool[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

/** Whether a tool (or a value from the page) is one that installs plugins. */
export const takesPlugins = (tool: unknown): tool is PluginTool => pluginTools.some(entry => entry === tool);

/** A kind of item a home's tools hold, each with its own page. Every tool holds skills and an instruction file. */
export type HomeKind = 'skills' | 'mcp' | 'agents' | 'instructions' | 'plugins';

/** Each kind as a sentence names it. */
export const kindNames: Record<HomeKind, string> = { skills: 'skills', mcp: 'MCP servers', agents: 'agents', instructions: 'instruction files', plugins: 'plugins' };

/**
 * The kinds no tool in this home can hold, given its tools and those among them that hold MCP servers, agents and
 * plugins: pages and wording leave them out, since what doesn't exist here shouldn't show as an option. A home with no
 * tools at all holds none of them.
 */
export function absentKinds(tools: HarnessId[], mcpTools: HarnessId[], agentTools: HarnessId[], pluginTools: HarnessId[]): HomeKind[] {
  if (!tools.length) return ['skills', 'mcp', 'agents', 'instructions', 'plugins'];
  const absent: HomeKind[] = [];
  if (!mcpTools.length) absent.push('mcp');
  if (!agentTools.length) absent.push('agents');
  if (!pluginTools.length) absent.push('plugins');
  return absent;
}

/** The tools looked for and not found here, in discovery order: only the Tools page names them, as information. */
export const absentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(snapshot => !isPresent(snapshot)).map(snapshot => snapshot.harness);
