// What the plugin pages say about a plugin and a tool, worked out from the view alone (no DOM): whether a tool can take
// it, whether it is installed there, and a short summary of what it holds.
import type { Components, HarnessId, InstallState, MarketplaceView, Outcome, PartItem, PartKind, PartsState, PluginView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { toolNames as names } from './words.ts';

/** Tools that take Claude plugins through their own CLI (capability data, Appendix C). */
export const pluginTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
/**
 * Tools that can take a plugin's parts as separate items (parts.ts) where the plugin itself can't go: Pi always, Codex and
 * Copilot CLI when their plugin route is blocked here. Claude Code always takes the plugin itself.
 */
export const partsTools: HarnessId[] = ['copilot-cli', 'codex-cli', 'pi-cli'];

/** The one way of saying a tool's CLI is missing. */
export const cliMissing = (tool: HarnessId) => `${names[tool]}’s command-line tool wasn’t found`;
/** The same, as the reason nothing can run there. */
export const noCli = (tool: HarnessId) => `${cliMissing(tool)}, so its plugin commands can’t run.`;
/** Why nothing can change in a home that is only previewed. */
export const PREVIEW_ONLY = 'Preview only: nothing can be installed or uninstalled in this home.';
/** Why Central Knot leaves a tool's same-named marketplace alone: it comes from `other`, not from the one on screen. */
export const heldReason = (tool: HarnessId, marketName: string, other: string) => `${names[tool]} has a different marketplace named “${marketName}” (${other}). Central Knot leaves it alone.`;

/** Why a tool can't take this marketplace's plugins, if it can't: no CLI, only a desktop app's copy, or Copilot refusing the marketplace. */
export function blocked(view: PluginsView, entry: MarketplaceView, tool: HarnessId): string | undefined {
  if (!pluginTools.includes(tool)) return `${names[tool]} doesn’t take Claude plugins.`;
  if (!view.clis[tool]) return view.desktopOnly?.includes(tool) ? 'Only ChatGPT desktop was found. Installing there without the Codex CLI is not known yet.' : noCli(tool);
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
  if (entry.plugins.find(candidate => candidate.name === plugin)?.gone) return 'It is no longer in this marketplace.';
  const state = stateOf(entry, plugin, tool);
  if (state.state === 'held') return state.reason;
  return state.state === 'installed' ? undefined : blocked(view, entry, tool);
}

/**
 * Why this plugin can't be uninstalled from this tool here, if it can't (only asked of an installed plugin): the tool
 * holds another marketplace of this name, its CLI is missing, or writing isn't allowed in this home.
 */
export function cantUninstall(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId): string | undefined {
  const state = stateOf(entry, plugin, tool);
  if (state.state === 'held') return state.reason;
  if (!view.canWrite) return PREVIEW_ONLY;
  return view.clis[tool] ? undefined : `${cliMissing(tool)}.`;
}

/** This plugin's parts in a tool, when they were installed there as separate items (parts.ts). */
export const partsOf = (entry: MarketplaceView, plugin: string, tool: HarnessId): PartsState | undefined => entry.parts?.[plugin]?.[tool];

/**
 * Whether a tool is one that would take this plugin's parts, whatever they are: it takes parts, has none of this plugin's
 * yet, and the plugin itself is not installed and can't be installed there (Pi always; Codex or Copilot CLI with their
 * plugin route blocked), the plugin is still listed, and the tool holds no other marketplace of this name.
 */
export function partsEligible(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId): boolean {
  if (!partsTools.includes(tool) || partsOf(entry, plugin, tool) || installed(entry, plugin, tool) || entry.plugins.find(candidate => candidate.name === plugin)?.gone) return false;
  return !!unavailable(view, entry, plugin, tool) && stateOf(entry, plugin, tool).state === 'not-installed';
}

/** Whether a plugin holding these components has a part this tool can take (Pi takes no agents). Unknown counts as yes. */
export const partsFit = (tool: HarnessId, components?: Components) => !components || !!(components.skills || components.mcp || (components.agents && tool !== 'pi-cli'));

/**
 * Whether this plugin's parts can go into this tool as separate items, or are there already (then they can always be
 * updated or removed, even once the plugin could go there itself).
 */
export function partsOffer(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, components?: Components): boolean {
  return (partsTools.includes(tool) && !!partsOf(entry, plugin, tool)) || (partsEligible(view, entry, plugin, tool) && partsFit(tool, components));
}

/**
 * Why a tool takes this plugin's parts rather than the plugin, short, for one sentence about several tools: [one tool,
 * several tools]. "Pi takes no plugins", "Copilot CLI and Codex have no command-line tool here".
 */
export function partsWhy(view: PluginsView, entry: MarketplaceView, tool: HarnessId): [string, string] {
  if (!pluginTools.includes(tool)) return ['takes no plugins', 'take no plugins'];
  if (!view.clis[tool]) return view.desktopOnly?.includes(tool) ? ['is only the desktop app here', 'are only desktop apps here'] : ['command-line tool not found', 'command-line tools not found'];
  // Parts kept in a tool that can take the plugin again (its CLI is back): nothing to explain.
  return tool === 'copilot-cli' && entry.copilotRefuses ? ['refuses this marketplace', 'refuse this marketplace'] : ['', ''];
}

/**
 * The same part, by each kind's own rule: skill folders ignore case (as macOS and Windows do), agents match as the Agents
 * page keys them (NFC, ignoring case), MCP servers are keys in a settings file and match exactly.
 */
export function samePart(first: Pick<PartItem, 'kind' | 'name'>, second: Pick<PartItem, 'kind' | 'name'>): boolean {
  if (first.kind !== second.kind) return false;
  if (first.kind === 'mcp') return first.name === second.name;
  return first.name.normalize('NFC').toLowerCase() === second.name.normalize('NFC').toLowerCase();
}

/** Each kind of part in words: [one, several]. */
export const partWords: Record<PartKind, [string, string]> = { skill: ['skill', 'skills'], mcp: ['MCP server', 'MCP servers'], agent: ['agent', 'agents'] };

/**
 * Where a tool stands with this plugin's parts, for the box, the key and the status line alike: they can go in
 * (`offer`), they are there (`installed`), or they are there and the plugin has changed since (`changed`). Undefined
 * when parts aren't a matter for this tool.
 */
export function partsMark(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, components?: Components): 'offer' | 'installed' | 'changed' | undefined {
  if (!partsOffer(view, entry, plugin, tool, components)) return undefined;
  const parts = partsOf(entry, plugin, tool);
  return parts?.changed ? 'changed' : parts ? 'installed' : 'offer';
}

/** "2 skills · 1 MCP server", from parts as recorded. */
export function partsSummary(items: PartsState['items'], separator = ' · '): string {
  return (['skill', 'mcp', 'agent'] as const).map(kind => { const n = items.filter(item => item.kind === kind).length; return n ? `${n} ${partWords[kind][n > 1 ? 1 : 0]}` : ''; }).filter(Boolean).join(separator);
}

/** "version 1.2", or nothing when the catalog gave none. */
export const versionWord = (version?: string) => (version ? `version ${version}` : '');

/** Tools this plugin can be uninstalled from here: installed there, nothing in the way. */
export const removableTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => installed(entry, plugin, tool) && !cantUninstall(view, entry, plugin, tool));

/** A marketplace's name for headings and messages: the name it gives itself, or where it comes from until it is read. */
export const marketTitle = (entry: MarketplaceView) => entry.name || entry.sourceLabel;

/** Tools that can still take this plugin: available there and not installed yet. */
export const missingTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => !unavailable(view, entry, plugin, tool) && !installed(entry, plugin, tool) && !partsOf(entry, plugin, tool));

/**
 * The parts that won't fully work in a tool, short, in the words "In each tool" uses up to its colon: "MCP servers may
 * not start", "Agents are ignored +1". A limit with no colon says only "limited". Empty when all work.
 */
export function limitNote(limits: Outcome[]): string {
  const notWorking = limits.filter(outcome => outcome.result !== 'works');
  const first = notWorking[0];
  if (!first) return '';
  const effect = first.text.includes(':') ? first.text.slice(0, first.text.indexOf(':')) : 'limited';
  return `${first.component} ${effect}${notWorking.length > 1 ? ` +${notWorking.length - 1}` : ''}`;
}

/** "3 skills · 1 MCP server", from a plugin's counts. */
export function summaryOf(parts: Components): string {
  return [parts.skills && plural(parts.skills, 'skill'), parts.commands && plural(parts.commands, 'command'), parts.agents && plural(parts.agents, 'agent'),
    parts.hooks && 'hooks', parts.mcp && plural(parts.mcp, 'MCP server'), parts.bin && 'a bin/ folder'].filter(Boolean).join(' · ');
}

/** A find box is offered past this many plugins; with fewer, the list is short enough to scan. */
export const FIND_FROM = 8;
/** A marketplace's categories, sorted; chips are offered when there are two or more. */
export const categoriesOf = (entry: MarketplaceView) => [...new Set(entry.plugins.map(plugin => plugin.category).filter((category): category is string => !!category))].sort();

/** Whether a plugin matches what was typed in the find box: its name, display name, description, category or keywords. */
export const matches = (plugin: PluginView, find: string) => !find || [plugin.name, plugin.displayName, plugin.description, plugin.category, ...(plugin.keywords ?? [])].some(text => text?.toLowerCase().includes(find.toLowerCase()));
