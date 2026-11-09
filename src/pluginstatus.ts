// What the plugin pages say about a plugin and a tool, worked out from the view alone (no DOM): whether a tool can take
// it, whether it is installed there, and a short summary of what it holds.
import type { Components, HarnessId, InstallState, MarketplaceView, Outcome, PluginDetail, PluginView, PluginsView } from './types.ts';
import { groupBy, plural } from './model.ts';
import { andList, toolNames as names } from './words.ts';
import { isCommitHash } from './values.ts';

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

/** Tools this plugin can be uninstalled from here: installed there, nothing in the way. */
export const removableTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => installed(entry, plugin, tool) && !cantUninstall(view, entry, plugin, tool));

/** A marketplace's name for headings and messages: the name it gives itself, or where it comes from until it is read. */
export const marketTitle = (entry: MarketplaceView) => entry.name || entry.sourceLabel;

/** Tools that can still take this plugin: available there and not installed yet. */
export const missingTools = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
  view.tools.filter(tool => !unavailable(view, entry, plugin, tool) && !installed(entry, plugin, tool));

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

/**
 * A version as compared for showing a difference: no leading "v", no build suffix after "+", no commit hash after "-"
 * (Codex names a copy 0.1.13-77c10e110b37). A hash has a letter in it, so a dated pre-release such as 1.2.0-20250101
 * stays as it is. Choosing which cached copy Codex loads is stricter: see compareVersions in plugins.ts.
 */
const releaseOf = (version: string) => version.trim().replace(/^v(?=\d)/i, '').replace(/\+.*$/, '').replace(/-([0-9a-f]+)$/i, (suffix, hash: string) => (isCommitHash(hash) ? '' : suffix));

/**
 * The version the marketplace offers, as Claude Code reads it (plugin.json's, else the entry's). For a plugin in the
 * marketplace's own folder the catalog already read it so, fresh on every view. A plugin kept in another repository has
 * only the entry's until its own files are read. (A plugin shipping a Codex manifest with another version isn't covered.)
 */
export const offeredVersion = (plugin: PluginView, detail: PluginDetail | null | undefined) => (plugin.folder ? plugin.version : detail?.version ?? plugin.version);

/**
 * The offered version to compare tools' versions with: offeredVersion, but for a plugin kept in another repository only
 * once the marketplace's copy of its files was read (until then its version is the entry's, which plugin.json may
 * overrule). Undefined means nothing is compared.
 */
export const versionToCompare = (plugin: PluginView, detail: PluginDetail | null | undefined) =>
  (plugin.folder || detail?.offered ? offeredVersion(plugin, detail) : undefined);

/** The version a tool has installed, when it is installed there and its version is known. */
export function installedVersion(entry: MarketplaceView, plugin: string, tool: HarnessId): string | undefined {
  const status = stateOf(entry, plugin, tool);
  return status.state === 'installed' ? status.version : undefined;
}

/** Whether a tool's installed copy is another version than the marketplace offers. Unknown on either side is not a difference. */
export const versionDiffers = (installed: string | undefined, offered: string | undefined) => !!installed && !!offered && releaseOf(installed) !== releaseOf(offered);

/** The note "Marketplace has 1.2.0" when a tool's installed `version` is another than the one `offered`; else undefined. */
export const marketplaceVersionNote = (version: string | undefined, offered: string | undefined) => (versionDiffers(version, offered) ? `Marketplace has ${offered}` : undefined);

/** Tools whose installed copy is another version than `offered`, with that version. */
export const otherVersions = (view: PluginsView, entry: MarketplaceView, plugin: string, offered: string | undefined) =>
  view.tools.flatMap(tool => { const version = installedVersion(entry, plugin, tool); return versionDiffers(version, offered) ? [{ tool, version: version! }] : []; });

/**
 * The list row's line for tools on another version (see otherVersions), grouped by version: "Claude Code and Codex
 * have 1.9.0, Copilot CLI has 1.8.0". A version never parts from the word before it when the line wraps.
 */
export const otherVersionsLine = (others: { tool: HarnessId; version: string }[]) =>
  [...groupBy(others, other => other.version)].map(([version, group]) => `${andList(group.map(({ tool }) => names[tool]))} ${group.length > 1 ? 'have' : 'has'}\u00a0${version}`).join(', ');

/** A file's text to compare copies by: line endings as LF, since a Windows Git checkout writes CRLF and that is no difference. */
export const comparableText = (text: string) => text.replace(/\r\n/g, '\n');
