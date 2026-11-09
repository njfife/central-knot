// What the plugin pages say about a plugin and a tool, worked out from the view alone (no DOM): whether a tool can take
// it, whether it is installed there, and a short summary of what it holds.
import type { Components, HarnessId, InstallState, MarketplaceView, Outcome, PluginsView } from './types.ts';
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

/**
 * Why this plugin can't be installed in this tool, if it can't: the tool holds another marketplace of this name, or the
 * marketplace is blocked there (see blocked). An installed plugin is never unavailable. Every box, panel and key uses this.
 */
export function unavailable(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId): string | undefined {
  const state = stateOf(entry, plugin, tool);
  if (state.state === 'held') return state.reason;
  return state.state === 'installed' ? undefined : blocked(view, entry, tool);
}

/** Tools that can still take this plugin: available there and not installed yet. */
export const missingTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => !unavailable(view, entry, plugin, tool) && !installed(entry, plugin, tool));

const limitWords: Record<Outcome['result'], string> = { works: '', limited: 'limited', ignored: 'ignored', fails: 'won’t work', unknown: 'not confirmed' };
/** The parts that won't fully work in a tool, short: "MCP servers won’t work", "Agents ignored +1". Empty when all work. */
export function limitNote(limits: Outcome[]): string {
  const first = limits.find(outcome => outcome.result !== 'works');
  if (!first) return '';
  const more = limits.filter(outcome => outcome.result !== 'works').length - 1;
  return `${first.component} ${limitWords[first.result]}${more ? ` +${more}` : ''}`;
}

/** "3 skills · 1 MCP server", from a plugin's counts. */
export function summaryOf(parts: Components): string {
  return [parts.skills && plural(parts.skills, 'skill'), parts.commands && plural(parts.commands, 'command'), parts.agents && plural(parts.agents, 'agent'),
    parts.hooks && 'hooks', parts.mcp && plural(parts.mcp, 'MCP server'), parts.bin && 'a bin/ folder'].filter(Boolean).join(' · ');
}
