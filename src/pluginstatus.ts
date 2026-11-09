// What the plugin pages say about a plugin and a tool, worked out from the view alone (no DOM): whether a tool can take
// it, whether it is installed there, and a short summary of what it holds.
import type { Components, HarnessId, InstallState, MarketplaceView, Outcome, PluginView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { SAFE_NAME, compareVersions } from './values.ts';
import { toolNames as names } from './words.ts';

/** The one way of saying a tool's CLI is missing. */
export const cliMissing = (tool: HarnessId) => `${names[tool]}’s command-line tool wasn’t found`;
/** The same, as the reason nothing can run there. */
export const noCli = (tool: HarnessId) => `${cliMissing(tool)}, so its plugin commands can’t run.`;
/** Why nothing can change in a home that is only previewed. */
export const PREVIEW_ONLY = 'Preview only: nothing can be changed in this home.';
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

/**
 * Tools with no switch for one skill of a plugin, and why (ENB-06). Claude Code's skillOverrides leave plugin skills alone,
 * so only the whole plugin turns off there; a deny rule only fails the call and is not Disable. Codex keeps the switch in
 * config.toml (`[[skills.config]]` by name, which outlives an update) and Copilot CLI behind its own `skill disable`.
 */
export const NO_SKILL_SWITCH: Partial<Record<HarnessId, string>> = {
  'claude-cli': 'Claude Code has no switch for a single skill of a plugin; to stop one there, uninstall the plugin from Claude Code.',
};

/** Why a skill is off that Copilot CLI turned off by its bare name, for every skill so named: not this plugin's own switch. */
export const offByBareName = (skill: string) => `Copilot CLI has every skill named “${skill}” turned off, not only this plugin’s. To turn them all on: \`copilot skill enable ${skill}\``;
/** Why Codex's skill switches aren't edited: its config.toml writes the list as a value, which a `[[skills.config]]` block can't extend. */
export const INLINE_SKILLS_CONFIG = 'Codex’s config.toml writes skills.config as a value, a form Central Knot doesn’t edit, so its plugin skills can’t be switched here.';
/** Why a skill the marketplace lists can't be switched where the installed copy (an older or newer version) lacks it. */
export const notInCopy = (tool: HarnessId, skill: string) => `The copy ${names[tool]} has installed has no skill named “${skill}”.`;
/** Why Copilot CLI's switch isn't offered for a skill whose name could not go safely on its command line. */
export const UNSAFE_SKILL_NAME = 'Its name has characters Central Knot doesn’t pass to Copilot CLI’s command.';

/**
 * Why one skill of this plugin can't be switched in this tool here, if it can't: the tool has no such switch, the plugin
 * isn't installed there or its installed copy lacks the skill, its name can't go on Copilot CLI's command line, it is held
 * off by a switch that isn't the plugin's own, Copilot CLI's command is missing, or writing isn't allowed in this home.
 */
export function cantSwitchSkill(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, skill: string): string | undefined {
  const state = stateOf(entry, plugin, tool);
  if (state.state !== 'installed') return NO_SKILL_SWITCH[tool] ?? `It isn’t installed in ${names[tool]}.`;
  const off = skillOff(entry, plugin, tool, skill);
  // Only turning one off waits for a tested build; turning one back on is always offered.
  const blocked = noSwitchReason(tool, state.skills, skill) ?? state.switchesHeld ?? off?.held ?? (off ? undefined : untestedBuild(tool, view.versions?.[tool], !!view.clis[tool]));
  if (blocked) return blocked;
  if (!view.canWrite) return PREVIEW_ONLY;
  return tool === 'copilot-cli' && !view.clis[tool] ? `${cliMissing(tool)}.` : undefined;
}

/** The oldest build of each tool its switch for one plugin skill was exercised on (capability data, Appendix B). */
export const SKILL_SWITCH_TESTED_FROM: Partial<Record<HarnessId, string>> = { 'codex-cli': '0.142.3', 'copilot-cli': '1.0.107' };

/**
 * Why turning off one plugin skill isn't offered on this build of a tool (ENB-01: native Disable only where it was
 * verified): its `version` is older than the switch was tested on, or isn't known: not read from its CLI, or no CLI
 * found to ask (`hasCli` false; Codex's switch needs no command, only a known build). Undefined when it may be offered.
 */
export function untestedBuild(tool: HarnessId, version: string | undefined, hasCli: boolean): string | undefined {
  const from = SKILL_SWITCH_TESTED_FROM[tool];
  if (!from) return undefined;
  if (!version && !hasCli) return `${cliMissing(tool)}, so its build can’t be checked and turning off one of its plugin skills isn’t offered.`;
  if (!version) return `${names[tool]}’s version couldn’t be read, so turning off one of its plugin skills isn’t offered (verified from ${from}).`;
  return compareVersions(version, from) < 0 ? `Not verified on this build of ${names[tool]} (${version}): turning off one plugin skill is verified from ${from}.` : undefined;
}

/**
 * Why a tool can't switch this skill of its installed copy (whose skills are `skills`, when read), in any home: it has no
 * such switch, the copy lacks the skill, or the name can't go on Copilot CLI's command line. The page (cantSwitchSkill)
 * and the engine (plugins.setSkill) both ask this.
 */
export function noSwitchReason(tool: HarnessId, skills: string[] | undefined, skill: string): string | undefined {
  if (NO_SKILL_SWITCH[tool]) return NO_SKILL_SWITCH[tool];
  if (skills && !skills.includes(skill)) return notInCopy(tool, skill);
  return tool === 'copilot-cli' && !SAFE_NAME.test(skill) ? UNSAFE_SKILL_NAME : undefined;
}

/** Whether a tool has this skill of an installed plugin turned off, and the switch's own record of it. */
export const skillOff = (entry: MarketplaceView, plugin: string, tool: HarnessId, skill: string) => {
  const state = stateOf(entry, plugin, tool);
  return state.state === 'installed' ? state.skillsOff?.find(off => off.skill === skill) : undefined;
};

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
