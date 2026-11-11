// Which tools are in a home. Every page offers and names only these, and sync writes only to these, so the rule lives
// here, once, for the main process and the page alike.
import type { HarnessId, Snapshot } from './types.ts';

/**
 * A tool is in this home when it is installed there: its CLI or its desktop app was found. Its configuration folder alone
 * is not the tool: a folder stays behind after an uninstall, and a tool nobody installed here is offered nowhere. Where
 * this computer wasn't searched (a chosen folder or the Practice copy, whose probes never ran), the tool's own folder is
 * all there is to go by. Skills in a folder several tools share, such as ~/.agents/skills, never count: they would make
 * every tool that reads that folder look installed.
 */
export const isPresent = (snapshot: Snapshot): boolean =>
  (snapshot.detection === 'Config found but app not detected' ? snapshot.probe.state === 'not-run' : snapshot.detection !== 'Not found');

/**
 * Whether Cowork is here: it comes with Claude desktop, found on this computer beside Claude Code. Cowork is no tool on
 * any page: the one Cowork session tried had only the account's plugins on offer, and not the one put in Cowork's folder
 * on the computer, though Claude desktop listed it (capability-data section 7), so Central Knot installs nothing there.
 * Where it is here, Claude Code's card and each plugin's page say so once (words.ts, coworkWords).
 */
export const hasCowork = (snapshots: Snapshot[]): boolean => snapshots.some(snapshot => snapshot.harness === 'claude-cli' && !!snapshot.app);

/**
 * The tools installed in this home, in discovery order. Plugins, plugin updates, instructions and noteTools go by these;
 * skills, MCP servers and agents go by managedTools (as does the Tools page, through the skills view, until it can show both).
 */
export const presentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(isPresent).map(snapshot => snapshot.harness);

/**
 * The tools Central Knot manages in this home, in discovery order: the present ones the sync record lists (share.ts
 * chooseTools sets the list). With no list (every record made before the choice existed, and a home with no record yet) it
 * manages every present tool; an empty list manages none. Every item page and every sync pass draws from these, so a present
 * tool left out is neither shown with items nor written.
 */
export const managedTools = (snapshots: Snapshot[], chosen?: readonly HarnessId[]): HarnessId[] => {
  const present = presentTools(snapshots);
  return chosen ? present.filter(tool => chosen.includes(tool)) : present;
};

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

/**
 * The tools that hold each kind besides skills: plugins in Claude Code, Copilot CLI and Codex (Pi and OpenCode take a plugin's
 * parts instead); agents in every tool but Pi; MCP servers in every tool.
 */
export type PluginTool = Exclude<HarnessId, 'pi-cli' | 'opencode-cli'>;
export const pluginTools: PluginTool[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
export type AgentTool = Exclude<HarnessId, 'pi-cli'>;
export const agentTools: AgentTool[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'opencode-cli'];
export const mcpTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];

/** Whether a tool (or a value from the page) is one that installs plugins. */
export const takesPlugins = (tool: unknown): tool is PluginTool => pluginTools.some(entry => entry === tool);

/** A kind of item a home's tools hold, each with its own page. Every tool holds skills and an instruction file. */
export type HomeKind = 'skills' | 'mcp' | 'agents' | 'instructions' | 'plugins';

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
