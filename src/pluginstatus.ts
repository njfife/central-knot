// What the plugin pages say about a plugin and a tool, worked out from the view alone (no DOM): whether a tool can take
// it, whether it is installed there, and a short summary of what it holds.
import type { Components, HarnessId, InstallState, MarketplaceView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { toolNames as names } from './words.ts';

/** The one way of saying a tool's CLI is missing. */
export const cliMissing = (tool: HarnessId) => `${names[tool]}’s command-line tool wasn’t found`;

/** Why a tool can't take this marketplace's plugins, if it can't: no CLI, only a desktop app's copy, or Copilot refusing the marketplace. */
export function blocked(view: PluginsView, entry: MarketplaceView, tool: HarnessId): string | undefined {
  if (!view.clis[tool]) return view.desktopOnly?.includes(tool) ? 'Only ChatGPT desktop was found. Installing there without the Codex CLI is not known yet.' : `${cliMissing(tool)}, so its plugin commands can’t run.`;
  return tool === 'copilot-cli' ? entry.copilotRefuses : undefined;
}

/** A plugin's state in one tool, as last read ("not installed" when the tool has no record of it). */
export const stateOf = (entry: MarketplaceView, plugin: string, tool: HarnessId): InstallState => entry.states[plugin]?.[tool] ?? { state: 'not-installed' };
export const installed = (entry: MarketplaceView, plugin: string, tool: HarnessId) => stateOf(entry, plugin, tool).state === 'installed';

/** Tools that can still take this plugin: found, allowed, not holding another marketplace of this name, not installed yet. */
export const missingTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => !blocked(view, entry, tool) && ['not-installed', 'not-known'].includes(stateOf(entry, plugin, tool).state));

/** "3 skills · 1 MCP server", from a plugin's counts. */
export function summaryOf(parts: Components): string {
  return [parts.skills && plural(parts.skills, 'skill'), parts.commands && plural(parts.commands, 'command'), parts.agents && plural(parts.agents, 'agent'),
    parts.hooks && 'hooks', parts.mcp && plural(parts.mcp, 'MCP server'), parts.bin && 'a bin/ folder'].filter(Boolean).join(' · ');
}
