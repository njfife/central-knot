// Which tools are in a home (presentTools) and which of them Central Knot manages (managedTools): every installed tool but
// the ones whose Manage switch is off (share.ts SyncRecord leftOut, changed only by toolchoice.ts chooseTools). Central Knot
// writes only in managed tools, and every page but Harnesses (a left-out tool's card and switch) shows only those as tools,
// so the rule lives here, once, for the main process and the page alike. Not here: turning the switch (toolchoice.ts), each
// tool's definition (harnesses.ts) and what is read of it in a home (discovery.ts).
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

/** The tools installed in this home, in discovery order: Harnesses has a card for each, with its Manage switch, and noteTools watches them. */
export const presentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(isPresent).map(snapshot => snapshot.harness);

/**
 * The tools Central Knot manages in this home, in discovery order: the installed ones the sync record doesn't leave out.
 * Skills, MCP servers, agents, plugins, plugin updates and instruction files all go by these, in the pass and on the pages,
 * so a tool left out is neither written nor shown anywhere but on its Harnesses card. A tool installed later is managed by
 * itself; one left out stays left out when it is uninstalled and installed again.
 */
export const managedTools = (snapshots: Snapshot[], leftOut: readonly HarnessId[] = []): HarnessId[] => presentTools(snapshots).filter(tool => !leftOut.includes(tool));

/** The tools last noted in the open home, and that home, so a change is acted on once. */
export interface NotedTools { home: string; tools: string }

/**
 * Notes which tools are in `home`. `changed` only when they differ from those noted while that same home stayed open: a home
 * just opened is only noted, since opening it starts watching and the page reads it anyway. `joined`: the tools installed since
 * the last note in that same home (main.ts says which of them Central Knot manages now); kept in memory only, never stored.
 */
export function noteTools(last: NotedTools, home: string, snapshots: Snapshot[]): { noted: NotedTools; changed: boolean; joined: HarnessId[] } {
  const now = presentTools(snapshots), noted = { home, tools: now.join() };
  const before = home === last.home ? last.tools.split(',') : now;
  return { noted, changed: home === last.home && noted.tools !== last.tools, joined: now.filter(tool => !before.includes(tool)) };
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
interface ToolsHeld { skills: { tools: HarnessId[] }; mcp: { tools: HarnessId[] }; agents: { tools: HarnessId[] } }

/**
 * The kinds no tool in this home can hold: pages and wording leave them out, since what doesn't exist here shouldn't show
 * as an option. A home with no tools at all holds none of them.
 */
export function absentKindsIn(view: ToolsHeld): HomeKind[] {
  if (!view.skills.tools.length) return ['skills', 'mcp', 'agents', 'instructions', 'plugins'];
  const absent: HomeKind[] = [];
  if (!view.mcp.tools.length) absent.push('mcp');
  if (!view.agents.tools.length) absent.push('agents');
  if (!view.skills.tools.some(takesPlugins)) absent.push('plugins');
  return absent;
}

/** The kinds a home's tools hold that sync keeps the same (skills, MCP servers, agents), in that order. */
export const heldKinds = (view: ToolsHeld): ('skills' | 'mcp' | 'agents')[] => (['skills', 'mcp', 'agents'] as const).filter(kind => !absentKindsIn(view).includes(kind));
