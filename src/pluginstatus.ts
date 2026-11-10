// What the plugin pages say about a plugin and a tool, worked out from the view alone (no DOM): whether a tool can take
// it, whether it is installed there, and a short summary of what it holds.
import type { Components, HarnessId, HomeView, InstallState, InstalledCopy, MarketplaceView, Outcome, PartItem, PartKind, PartsPick, PartsState, PluginContents, PluginDetail, PluginView, PluginsView } from './types.ts';
import { groupBy, plural } from './model.ts';
import { SAFE_NAME, compareVersions, isCommitHash } from './values.ts';
import { andList, toolNames as names } from './words.ts';
import { takesPlugins } from './presence.ts';

/**
 * Tools that can take a plugin's parts as separate items (parts.ts) where the plugin itself can't go: Pi always, Codex and
 * Copilot CLI when their plugin route is blocked here, Claude Code only with no plugin route at all (its desktop app alone, before its Code tab is there).
 */
export const partsTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];

/** The one way of saying a tool's CLI is missing. */
export const cliMissing = (tool: HarnessId) => `${names[tool]}’s command-line tool wasn’t found`;
/** The same, as the reason nothing can run there. */
export const noCli = (tool: HarnessId) => `${cliMissing(tool)}, so its plugin commands can’t run.`;
/** Why nothing can change in a home that is only previewed. */
export const PREVIEW_ONLY = 'Preview only: nothing can be changed in this home.';
/** Why Central Knot leaves a tool's same-named marketplace alone: it comes from `other`, not from the one on screen. */
export const heldReason = (tool: HarnessId, marketName: string, other: string) => `${names[tool]} has a different marketplace named “${marketName}” (${other}). Central Knot leaves it alone.`;

/** Why a plugin a bundled build's marketplace lists can't be installed from it: the build carries no files for it (`reason`: why it couldn't be packed). */
export const notCarried = (app: string, reason: string) => `${app} doesn’t include this plugin’s files, so it can’t be installed from here. ${reason}`;

/** Why this plugin can't be installed from its marketplace at all, if the marketplace is a bundled build's and the build has no files for it. */
export const whyNotCarried = (entry: MarketplaceView, plugin: string) => { const left = entry.bundled?.unpackaged.find(item => item.name === plugin); return left && `${notCarried(entry.bundled!.app, left.reason)}${entry.owner ? ` Ask ${entry.owner} if you need it.` : ''}`; };

/** Why a tool can't take this marketplace's plugins, if it can't: no CLI and no copy in its desktop app, a Codex-only marketplace, or Copilot refusing it. */
export function blocked(view: PluginsView, entry: MarketplaceView, tool: HarnessId): string | undefined {
  if (!takesPlugins(tool)) return `${names[tool]} doesn’t take Claude plugins.`;
  const app = view.desktopOnly?.[tool];
  // Plugins install through the tool's own CLI or, with none, the copy its desktop app carries (PLG-04): here, neither is.
  if (!view.clis[tool]) return app ? `Only ${app} was found here, and the copy of ${names[tool]} it carries isn’t there yet (the app adds it once it has run). ${cliMissing(tool)} either.` : noCli(tool);
  if (entry.codexOnly && tool !== 'codex-cli') return entry.codexOnly;
  return tool === 'copilot-cli' ? entry.copilotRefuses : undefined;
}

/**
 * Whether a plugin is marked "No longer offered": its marketplace's catalog was read and no longer lists it, while a tool
 * still has it or its parts. (A plugin listed only because its marketplace can't be read now is `gone` too, without the mark.)
 */
export const noLongerOffered = (entry: MarketplaceView, plugin: PluginView) => !!plugin.gone && !!entry.fetchedAt;

/** A plugin's state in one tool, as last read ("not installed" when the tool has no record of it). */
export const stateOf = (entry: MarketplaceView, plugin: string, tool: HarnessId): InstallState => entry.states[plugin]?.[tool] ?? { state: 'not-installed' };
export const installed = (entry: MarketplaceView, plugin: string, tool: HarnessId) => stateOf(entry, plugin, tool).state === 'installed';

/** A plugin in a marketplace. */
export type MarketPlugin = { entry: MarketplaceView; plugin: PluginView };
/**
 * What one tool has from every marketplace read: plugins installed there, plugins whose state there could not be checked
 * (with why), and marketplaces that could not be read at all, so an incomplete answer never reads as "nothing installed".
 * Null when the tool takes no marketplace plugins (Pi).
 */
export function installsIn(view: PluginsView, tool: HarnessId): { installed: MarketPlugin[]; unknown: (MarketPlugin & { reason: string })[]; unreadable: string[] } | null {
  if (!view.tools.includes(tool) || !takesPlugins(tool)) return null;
  const each = view.marketplaces.flatMap(entry => entry.plugins.map(plugin => ({ entry, plugin, install: stateOf(entry, plugin.name, tool) })));
  return {
    installed: each.filter(({ install }) => install.state === 'installed').map(({ entry, plugin }) => ({ entry, plugin })),
    unknown: each.flatMap(({ entry, plugin, install }) => (install.state === 'not-known' ? [{ entry, plugin, reason: install.reason }] : [])),
    unreadable: view.marketplaces.filter(entry => entry.problem && !entry.plugins.length).map(entry => entry.name),
  };
}

/**
 * Why this plugin can't be installed in this tool, if it can't: the tool holds another marketplace of this name, or the
 * marketplace is blocked there (see blocked). An installed plugin is never unavailable. Every box, panel and key uses this.
 */
export function unavailable(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId): string | undefined {
  const state = stateOf(entry, plugin, tool);
  if (state.state === 'held') return state.reason;
  if (state.state === 'installed') return undefined;
  // A plugin its marketplace dropped can't go anywhere new; where a tool still has it, it shows as installed and can be uninstalled.
  if (entry.plugins.find(candidate => candidate.name === plugin)?.gone) return 'It is no longer offered in this marketplace.';
  return whyNotCarried(entry, plugin) ?? blocked(view, entry, tool);
}

/**
 * A plugin's place among its marketplace's: 0 when every tool that can take it has it, 1 when some tool has it, 2 when no
 * tool has it. Having it means installed whole or as parts; a tool that can't take the plugin doesn't hold it back from 0.
 */
export function pluginPlace(view: PluginsView, entry: MarketplaceView, plugin: string): 0 | 1 | 2 {
  const has = (tool: HarnessId) => installed(entry, plugin, tool) || !!partsOf(entry, plugin, tool);
  if (!view.tools.some(has)) return 2;
  return view.tools.every(tool => has(tool) || !!unavailable(view, entry, plugin, tool)) ? 0 : 1;
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
  if (!partsTools.includes(tool) || (tool === 'claude-cli' && view.clis[tool]) || partsOf(entry, plugin, tool) || installed(entry, plugin, tool) || entry.plugins.find(candidate => candidate.name === plugin)?.gone) return false;
  return !!unavailable(view, entry, plugin, tool) && stateOf(entry, plugin, tool).state === 'not-installed';
}

/**
 * Whether single parts of this plugin can be chosen for this tool: it takes parts, and has some of this plugin's already,
 * or can't take the plugin itself, or (Claude Code) could but has no switch for one skill of a plugin, so a few of its
 * skills as separate items is the only way to have some there and not others. Where the plugin itself is installed, only
 * while parts of it are on record there too (they can still come out).
 */
export function partsPickable(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId): boolean {
  if (!partsTools.includes(tool) || !view.tools.includes(tool)) return false;
  if (partsOf(entry, plugin, tool)) return true;
  if (stateOf(entry, plugin, tool).state !== 'not-installed' || entry.plugins.find(candidate => candidate.name === plugin)?.gone) return false;
  return !!unavailable(view, entry, plugin, tool) || !!NO_SKILL_SWITCH[tool];
}

/** Whether a plugin holding these components has a part this tool can take (Pi takes no agents, Claude Code no MCP servers as parts). Unknown counts as yes. */
export const partsFit = (tool: HarnessId, components?: Components) => !components || !!(components.skills || (components.mcp && tool !== 'claude-cli') || (components.agents && tool !== 'pi-cli'));

/**
 * Whether this plugin's parts can go into this tool as separate items, or are there already (then they can always be
 * updated or removed, even once the plugin could go there itself).
 */
export function partsOffer(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, components?: Components): boolean {
  // A plugin the build carries no files for has no parts to give either.
  return (partsTools.includes(tool) && !!partsOf(entry, plugin, tool)) || (!whyNotCarried(entry, plugin) && partsEligible(view, entry, plugin, tool) && partsFit(tool, components));
}

/**
 * Why a tool takes this plugin's parts rather than the plugin, short, for one sentence about several tools: [one tool,
 * several tools]. "Pi takes no plugins", "Copilot CLI and Codex have no command-line tool here".
 */
export function partsWhy(view: PluginsView, entry: MarketplaceView, tool: HarnessId): [string, string] {
  if (!takesPlugins(tool)) return ['takes no plugins', 'take no plugins'];
  if (!view.clis[tool]) return view.desktopOnly?.[tool] ? ['is only the desktop app here', 'are only desktop apps here'] : ['command-line tool not found', 'command-line tools not found'];
  // Parts kept in a tool that can take the plugin again (its CLI is back): nothing to explain.
  return (tool === 'copilot-cli' && entry.copilotRefuses) || (tool !== 'codex-cli' && entry.codexOnly) ? ['refuses this marketplace', 'refuse this marketplace'] : ['', ''];
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

/** Which page lists each kind of part, and the kind each page lists. */
export const pageOfPart = { skill: 'skills', mcp: 'mcp', agent: 'agents' } as const;
export const partOfPage = { skills: 'skill', mcp: 'mcp', agents: 'agent' } as const;

/** Whether the home, as last read, still has this part in the tool: a copy removed by hand since is no longer installed there. */
export function partStillIn(home: Pick<HomeView, 'manage' | 'mcp' | 'agents'>, tool: HarnessId, part: Pick<PartItem, 'kind' | 'name'>): boolean {
  const { tools, facts } = part.kind === 'skill' ? { tools: home.manage.tools, facts: home.manage.skills } : part.kind === 'mcp' ? { tools: home.mcp.tools, facts: home.mcp.servers } : { tools: home.agents.tools, facts: home.agents.servers };
  // A kind the home doesn't read in that tool can't be checked: the part counts as there.
  return !tools.includes(tool) || facts.some(fact => fact.copies[tool] !== undefined && [fact.key, fact.name].some(name => !!name && samePart(part, { kind: part.kind, name })));
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

/** "Will add 2 parts", "Will take out 1 part", "Will add 2 parts, take out 1": what a pick does on Apply all. */
export function pickWords(pick: PartsPick): string {
  const add = pick.on.length ? `add ${plural(pick.on.length, 'part')}` : '';
  const out = pick.off.length ? `take out ${pick.on.length ? pick.off.length : plural(pick.off.length, 'part')}` : '';
  return `Will ${[add, out].filter(Boolean).join(', ')}`;
}

/** "version 1.2", or nothing when the catalog gave none. */
export const versionWord = (version?: string) => (version ? `version ${version}` : '');

/**
 * Tools with no switch for one skill of a plugin, and why (ENB-06). Claude Code's skillOverrides leave plugin skills alone,
 * so only the whole plugin turns off there; a deny rule only fails the call and is not Disable. Codex keeps the switch in
 * config.toml (`[[skills.config]]` by name, which outlives an update) and Copilot CLI behind its own `skill disable`.
 */
export const NO_SKILL_SWITCH: Partial<Record<HarnessId, string>> = {
  'claude-cli': 'Claude Code has no switch for a single skill of a plugin. To have only some of its skills there, uninstall the plugin there, then turn on the ones you want: they go in as separate items.',
};

/** Why a skill is off that Copilot CLI turned off by its bare name, for every skill so named: not this plugin's own switch. */
export const offByBareName = (skill: string) => `Can’t be turned on here: Copilot CLI has every skill named “${skill}” turned off, not only this plugin’s. To turn them all on: \`copilot skill enable ${skill}\``;
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
  const blocked = noSwitchReason(tool, state.skills, skill) ?? state.switchesHeld ?? skillOff(entry, plugin, tool, skill)?.held;
  if (blocked) return blocked;
  if (!view.canWrite) return PREVIEW_ONLY;
  return tool === 'copilot-cli' && !view.clis[tool] ? `${cliMissing(tool)}, and its plugin skill switch is its \`copilot skill\` command, so it can’t run.` : undefined;
}

/** The oldest build of each tool its switch for one plugin skill was exercised on (capability data, Appendix B). */
// Copilot's switch was also exercised on the GitHub Copilot app's own copy, a pre-release of 1.0.102.
export const SKILL_SWITCH_TESTED_FROM: Partial<Record<HarnessId, string>> = { 'codex-cli': '0.142.3', 'copilot-cli': '1.0.102-0' };

/**
 * A quiet note beside a tool's plugin skill switches when its `version` is older than the switch was exercised on, or
 * can't be read. Information only: Disable is best effort, offered on any build, and the switch is read back after.
 */
export function untestedBuild(tool: HarnessId, version: string | undefined): string | undefined {
  const from = SKILL_SWITCH_TESTED_FROM[tool];
  if (!from) return undefined;
  if (!version) return `${names[tool]}’s version couldn’t be read; turning a skill off may not take effect.`;
  return compareVersions(version, from) < 0 ? `Not checked on this version of ${names[tool]} (${version}); turning a skill off may not take effect.` : undefined;
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
export const marketTitle = (entry: MarketplaceView) => entry.bundled?.displayName || entry.name || entry.sourceLabel;

/** Tools that can still take this plugin: available there and not installed yet. */
export const toolsWithoutPlugin = (view: PluginsView, entry: MarketplaceView, plugin: string) =>
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

/**
 * Whether a tool's installed copy has another text than the marketplace's copy in a skill, command or agent both hold (by
 * its place in the plugin): what the plugin page's "differs from the marketplace's copy" says per part. A part only one
 * side has is left out, since each tool reads its copy by its own rules (Codex's manifest, Copilot CLI's skills list).
 * The page and the update both ask this.
 */
export const copyDiffers = (offered: Pick<PluginContents, 'skills' | 'commands' | 'agents'>, copy: InstalledCopy | undefined) => !!copy && (['skills', 'commands', 'agents'] as const)
  .some(kind => offered[kind].some(part => copy[kind].some(other => other.path === part.path && comparableText(other.text) !== comparableText(part.text))));

/**
 * Whether a tool's installed copy is the marketplace's version (or either has none) but differs from the marketplace's
 * copy in content (copyDiffers), so Update is offered there too. Known only once the plugin's files were read (`detail`),
 * with the marketplace's own copy; a copy loaded live from a folder marketplace is the marketplace's own.
 */
export function copyStale(entry: MarketplaceView, plugin: string, tool: HarnessId, offered: string | undefined, detail: PluginDetail | null | undefined): boolean {
  const state = stateOf(entry, plugin, tool);
  return state.state === 'installed' && !state.live && !versionDiffers(state.version, offered) && !!detail?.offered && !detail.problem && copyDiffers(detail, detail.installed?.[tool]);
}

/**
 * The plugins whose files the list reads in the background, so copyStale is known without their pages being opened: those
 * some tool has installed, other than as a copy loaded live from a folder marketplace (never stale).
 */
export const copiesToCompare = (view: PluginsView, entry: MarketplaceView): string[] => entry.plugins
  .filter(plugin => view.tools.some(tool => { const state = stateOf(entry, plugin.name, tool); return state.state === 'installed' && !state.live; }))
  .map(plugin => plugin.name);

/**
 * Whether Update is offered for a tool's installed copy: it is older than the version `offered` (another version than
 * the marketplace's, see versionDiffers, and not a newer one), or the same version with other content (copyStale, once
 * `detail` is read). A copy loaded live from a folder marketplace is always its own.
 */
export function outdated(entry: MarketplaceView, plugin: string, tool: HarnessId, offered: string | undefined, detail?: PluginDetail | null): boolean {
  const state = stateOf(entry, plugin, tool);
  if (state.state !== 'installed' || state.live) return false;
  return (versionDiffers(state.version, offered) && compareVersions(releaseOf(state.version!), releaseOf(offered!)) < 0) || copyStale(entry, plugin, tool, offered, detail);
}

/**
 * The tools Update brings up to date for one plugin: those whose installed copy is out of date (`outdated`) and can be changed
 * here (as for an uninstall: not held, a CLI, a home that can be written), and those holding its parts out of date.
 */
export function updateTools(view: PluginsView, entry: MarketplaceView, plugin: string, offered: string | undefined, components?: Components, detail?: PluginDetail | null): { plugin: HarnessId[]; parts: HarnessId[] } {
  return {
    plugin: view.tools.filter(tool => outdated(entry, plugin, tool, offered, detail) && !cantUninstall(view, entry, plugin, tool)),
    parts: view.canWrite ? view.tools.filter(tool => partsMark(view, entry, plugin, tool, components) === 'changed') : [],
  };
}
