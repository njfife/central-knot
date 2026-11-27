// What the plugin pages say about a plugin and a tool, worked out from the view alone (no DOM): whether a tool can take
// it, whether it is installed there, how many plugins a tool has installed (pluginsInstalled; for one that takes none, takesItemsOnly)
// and how many of a marketplace's are installed (installedFrom), whether it is installed in none (installedNowhere, for Find), and
// a short summary of what it holds.
import type { Components, HarnessId, HomeView, InstallState, InstalledCopy, InstalledPlugin, MarketplaceView, Outcome, PartKind, PartRef, PluginContents, PluginDetail, PluginView, PluginsView, YourName } from './types.ts';
import { groupBy, plural } from './model.ts';
import { SAFE_NAME, compareVersions, isCommitHash } from './values.ts';
import { andList, orList, toolNames as names } from './words.ts';
import { holds, takesPlugins } from './presence.ts';
import type { Owed, PluginEntry, ToolNow } from './pluginrecord.ts';
import { wantedIn } from './library.ts';

/**
 * How many plugins a tool has installed, the one count the Overview's tools table and a tool's card and Plugins tab on Harnesses
 * say: the plugins the tool's own record lists, read with the home (HomeView pluginItems), each once, whatever names a catalog
 * gives it; no marketplace is read for it, so the number is the same wherever the person has been. `unknown` where that record
 * can't be read (HomeView pluginRecordsUnread); none where the tool takes no plugins from a marketplace.
 */
export type PluginsInstalled = { state: 'unsupported' } | { state: 'unknown' } | { state: 'read'; count: number };
export function pluginsInstalled(home: Pick<HomeView, 'pluginItems' | 'pluginRecordsUnread'> | undefined, tool: HarnessId): PluginsInstalled {
  if (!takesPlugins(tool)) return { state: 'unsupported' };
  if (home?.pluginRecordsUnread?.includes(tool)) return { state: 'unknown' };
  return { state: 'read', count: new Set((home?.pluginItems ?? []).filter(install => install.tool === tool).map(install => `${install.plugin}@${install.marketName}`)).size };
}
/** Why a tool's plugins are "—" (`unsupported` above), on the Overview and Harnesses (`who`: its name, or "that tool"): a plugin's page puts the plugin's items there (pluginlibrary.ts). */
export const takesItemsOnly = (who: string) => `${who} takes a plugin’s items, not the plugin`;
/** What such tools take of a plugin, as a sentence names it: its skills, agents and MCP servers, agents said apart where some hold none (presence.ts holds). */
export function takenItems(tools: HarnessId[], none = tools.filter(tool => !holds(tool, 'agent'))) {
  return `its ${andList(['skills', ...(none.length === tools.length ? [] : [`agents${none.length ? ` (not in ${andList(none.map(tool => names[tool]))})` : ''}`]), 'MCP servers'])}`;
}

/**
 * Whether a marketplace's plugin is installed in no tool managed now, so Find may offer its items as ones the person doesn't
 * have (searchdocs.ts catalogDocs): no install of it in the view (HomeView pluginItems: the managed tools' alone, so a tool left
 * out doesn't count), an install turned Off or whose copy can't be read counting; `sameMarket`: whether a tool's spelling of its
 * marketplace's source is this one's. Never claimed while some tool's record of its plugins can't be read, nor over an install
 * whose marketplace that tool doesn't list (it may be this one).
 */
export const installedNowhere = (home: Pick<HomeView, 'pluginItems' | 'pluginRecordsUnread'>, plugin: string, sameMarket: (source: string) => boolean) =>
  !home.pluginRecordsUnread?.length && !(home.pluginItems ?? []).some(install => install.plugin === plugin && (!install.source || sameMarket(install.source)));

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

/** Why a plugin a bundled build's marketplace no longer offers is still listed: a tool here has it installed, and it stays until uninstalled there. */
export const keptReason = (market: string) => `${market} no longer offers this plugin. It stays in the tools that have it until you uninstall it.`;

/**
 * Why this plugin can't be installed from its marketplace at all, if the marketplace is a bundled build's: the build has
 * no files for it, or the marketplace no longer offers it and it is kept only for the tools that have it.
 */
export const whyNotCarried = (entry: MarketplaceView, plugin: string): string | undefined => {
  if (entry.bundled?.kept?.includes(plugin)) return keptReason(entry.bundled.displayName || entry.name);
  const left = entry.bundled?.unpackaged.find(item => item.name === plugin);
  return left && `${notCarried(entry.bundled!.app, left.reason)}${entry.owner ? ` Ask ${entry.owner} if you need it.` : ''}`;
};

/** Why a tool can't take this marketplace's plugins, if it can't: no CLI and no copy in its desktop app, a Codex-only marketplace, Copilot refusing it, or the tool's own add having refused it (refusedBy). */
export function blocked(view: PluginsView, entry: MarketplaceView, tool: HarnessId): string | undefined {
  if (!takesPlugins(tool)) return `${names[tool]} doesn’t take Claude plugins.`;
  const app = view.desktopOnly?.[tool];
  // Plugins install through the tool's own CLI or, with none, the copy its desktop app carries (PLG-04): here, neither is.
  if (!view.clis[tool]) return app ? `Only ${app} was found here, and the copy of ${names[tool]} it carries isn’t there yet (the app adds it once it has run). ${cliMissing(tool)} either.` : noCli(tool);
  if (entry.codexOnly && tool !== 'codex-cli') return entry.codexOnly;
  return (tool === 'copilot-cli' ? entry.copilotRefuses : undefined) ?? entry.refusedBy?.[tool];
}

/**
 * Whether a plugin is marked "No longer offered": its marketplace's catalog was read and no longer lists it, while a tool
 * still has it. (A plugin listed only because its marketplace can't be read now is `gone` too, without the mark.)
 */
export const noLongerOffered = (entry: MarketplaceView, plugin: PluginView) => (!!plugin.gone && !!entry.fetchedAt) || !!entry.bundled?.kept?.includes(plugin.name);

/** A plugin's state in one tool, as last read ("not installed" when the tool has no record of it). */
export const stateOf = (entry: MarketplaceView, plugin: string, tool: HarnessId): InstallState => entry.states[plugin]?.[tool] ?? { state: 'not-installed' };
export const installed = (entry: MarketplaceView, plugin: string, tool: HarnessId) => stateOf(entry, plugin, tool).state === 'installed';
/** How many of a marketplace's plugins are installed in one of the page's tools or more: its row in the marketplaces' list and the add's result say it. */
export const installedFrom = (view: PluginsView, entry: MarketplaceView) => entry.plugins.filter(plugin => view.tools.some(tool => installed(entry, plugin.name, tool))).length;

/** A plugin in a marketplace. */
export type MarketPlugin = { entry: MarketplaceView; plugin: PluginView };
/** A marketplace plugin installed in one tool, carrying that tool's recorded version from InstallState.version (if any). */
export type InstalledMarketPlugin = MarketPlugin & { version?: string };
/**
 * What one tool has from every marketplace read: plugins installed there (each carrying that tool's recorded version from
 * InstallState.version, if any), plugins whose state there could not be checked (with why), and marketplaces that could not be
 * read at all, so an incomplete answer never reads as "nothing installed". Null when the tool takes no marketplace plugins (Pi).
 */
export function installsIn(view: PluginsView, tool: HarnessId): { installed: InstalledMarketPlugin[]; unknown: (MarketPlugin & { reason: string })[]; unreadable: string[] } | null {
  if (!view.tools.includes(tool) || !takesPlugins(tool)) return null;
  const each = view.marketplaces.flatMap(entry => entry.plugins.map(plugin => ({ entry, plugin, install: stateOf(entry, plugin.name, tool) })));
  return {
    installed: each.flatMap(({ entry, plugin, install }) => (install.state === 'installed' ? [{ entry, plugin, ...(install.version ? { version: install.version } : {}) }] : [])),
    unknown: each.flatMap(({ entry, plugin, install }) => (install.state === 'not-known' ? [{ entry, plugin, reason: install.reason }] : [])),
    unreadable: view.marketplaces.filter(entry => entry.problem && !entry.plugins.length).map(entry => entry.name),
  };
}

/**
 * Why this plugin can't be installed in this tool, if it can't: the tool holds another marketplace of this name, or the
 * marketplace is blocked there (see blocked). An installed plugin is never unavailable. The table's input (toolNow), the marks and the key use this.
 */
export function unavailable(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId): string | undefined {
  const state = stateOf(entry, plugin, tool);
  if (state.state === 'held') return state.reason;
  if (state.state === 'installed') return undefined;
  // A plugin its marketplace dropped can't go anywhere new; where a tool still has it, it shows as installed and can be turned off (kept installed).
  // One listed only because its marketplace can't be read now (no read time) can't either, for that reason.
  if (entry.plugins.find(candidate => candidate.name === plugin)?.gone) return entry.fetchedAt ? 'It is no longer offered in this marketplace.' : MARKET_UNREAD;
  return whyNotCarried(entry, plugin) ?? blocked(view, entry, tool);
}
/** Why nothing can go in from a marketplace whose catalog can't be read now. */
export const MARKET_UNREAD = 'Its marketplace can’t be read now.';

/**
 * Whether this plugin's parts, written before the library, wait to be moved there (types.ts MarketplaceView waiting). Two places
 * hold such a plugin back in Pi and OpenCode until they are: toolNow (nothing is owed there, so no click and no automatic check
 * writes) and marketplaces.ts withItems (no Its items, so Update and Update all have nothing to bring); toolMark says it.
 */
export const waitsToMove = (entry: MarketplaceView, plugin: string) => !!entry.waiting?.includes(plugin);

/** Why nothing changes in Pi or OpenCode for a plugin whose parts wait to be moved (waitsToMove). */
export const WAITS_TO_MOVE = 'Parts of it from an earlier version wait to be moved to the library, so nothing changes there until they are.';

/**
 * What one managed tool has of a plugin now, and how it could take it in or out, from the view: the table's input
 * (pluginrecord.ts ToolNow). `unknown`: the tool's record of its plugins, or the record of parts from before the library, can't
 * be read now.
 */
export function toolNow(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, components: Components | undefined, unknown: boolean): ToolNow {
  if (!takesPlugins(tool) && waitsToMove(entry, plugin)) return { has: 'none', route: { cannot: WAITS_TO_MOVE } };
  const state = stateOf(entry, plugin, tool);
  const whole = state.state === 'installed' || state.state === 'not-known';
  const why = unavailable(view, entry, plugin, tool);
  // A tool with no installer (Pi) is held back only by what it can't hold of the plugin, unless the plugin can go nowhere new at all.
  const elsewhere = takesPlugins(tool) || why !== blocked(view, entry, tool) ? why : undefined;
  const items = !takesPlugins(tool) && (!components || !!(components.skills || (components.agents && holds(tool, 'agent')) || (components.mcp && holds(tool, 'mcp'))));
  // Read, and every name it has is his own, another source's, removed or unreadable, or (On) none a tick can bring in: why.
  const notIn = entry.items?.[plugin]?.notIn?.[tool];
  const brings = (entry.items?.[plugin]?.lines.some(line => line.state !== 'not-brought' && line.state !== 'removed') ?? true) && (notIn?.tickHelps ?? true);
  const route: ToolNow['route'] = takesPlugins(tool) && !why ? 'whole'
    : items && !elsewhere && brings ? 'items'
    : { cannot: elsewhere ?? (items ? whyNoneIn(entry, plugin, tool).join(' ') || `${names[tool]} gets none of its items: Its items, below, says why each isn’t brought in.` : notInWhy(tool, plugin, [], components && andList(summaryOf(components).split(' · ').filter(Boolean)))[0]!) };
  // What is installed whole is known from the tool's own record; items only once the record of parts from before is read.
  if (unknown && !(whole && takesPlugins(tool))) return { has: 'unknown', route };
  const kept = state.state === 'installed' && state.off ? { off: true as const } : {};
  return { has: whole ? 'whole' : itemsIn(entry, plugin, tool) ? 'items' : 'none', route, ...(whole ? { stuck: cantUninstall(view, entry, plugin, tool), ...kept } : {}) };
}

/**
 * Why no plugin's switch can be used before the plugins record is first made: what some tool has can't be read now (its own
 * record of its plugins, or the parts record). The first read waits for a whole read, and tries again at the next look.
 */
export const firstReadWaits = (tools: HarnessId[], partsKnown: boolean) =>
  `${andList([...tools.map(tool => `${names[tool]}’s record of its plugins`), ...(partsKnown ? [] : ['the record of plugins’ parts'])])} can’t be read now, so no plugin can be switched yet. Central Knot reads again at the next look.`;

/** Why what a tool has of its plugins can't be known now: its own record of them can't be read. */
export const recordUnread = (tool: HarnessId) => `${names[tool]}’s record of its plugins can’t be read now, so nothing is changed there.`;

/**
 * A plugin's place among its marketplace's: 0 when every tool that can take it has it, 1 when some tool has it, 2 when no
 * tool has it. Having it means installed whole and not kept off (pluginrecord.ts row 9); a tool that can't take the plugin doesn't hold it back from 0.
 */
export function pluginPlace(view: PluginsView, entry: MarketplaceView, plugin: string): 0 | 1 | 2 {
  const has = (tool: HarnessId) => { const state = stateOf(entry, plugin, tool); return state.state === 'installed' && !keptOff(entry.switches?.[plugin]?.entry, tool, state.off); };
  if (!view.tools.some(has)) return 2;
  return view.tools.every(tool => has(tool) || !!unavailable(view, entry, plugin, tool)) ? 0 : 1;
}

/**
 * Why this plugin can't be uninstalled from this tool here, if it can't (only asked of an installed plugin): the tool
 * holds another marketplace of this name, its files can't be read (so whether its own switch would keep it isn't known: it is
 * left as it is), its CLI is missing, or writing isn't allowed in this home.
 */
export function cantUninstall(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId): string | undefined {
  const state = stateOf(entry, plugin, tool);
  if (state.state === 'held') return state.reason;
  if (state.state === 'not-known') return `${state.reason.replace(/\.$/, '')}: left as it is.`;
  if (state.state === 'installed' && state.directory) return FROM_DIRECTORY;
  if (!view.canWrite) return PREVIEW_ONLY;
  return view.clis[tool] ? undefined : `${cliMissing(tool)}.`;
}

/** The marketplace name Claude Code records a plugin from the Anthropic Directory under. It is in no marketplace list. */
export const DIRECTORY = 'anthropic-plugin-directory';
/** Why Central Knot leaves Claude Code's copy from the Anthropic Directory to Claude Code. */
export const FROM_DIRECTORY = 'Claude Code has its copy from the Anthropic Directory: update or uninstall it in Claude Code (/plugin).';

/** Whether the tool has the plugin's items: "has it" for Pi, OpenCode and Antigravity, as pluginlibrary.ts onIn counted it for the view. */
export const itemsIn = (entry: MarketplaceView, plugin: string, tool: HarnessId) => !!entry.items?.[plugin]?.on[tool];
/** Whether every one of a plugin's items is on in a tool, as it loads them, or the same as his: the tool's box is ticked in full. */
export const itemsAllIn = (entry: MarketplaceView, plugin: string, tool: HarnessId) => { const items = entry.items?.[plugin];
  return !!items && (items.on[tool] ?? 0) - (items.keptOut?.[tool] ?? 0) >= (items.of[tool] ?? 0); };
/** "2 of its 3 items are on", in one tool (`where`: " there"), as the tool loads them: those its own settings keep out said apart. */
export const itemsOnWords = (entry: MarketplaceView, plugin: string, tool: HarnessId, where = '') => {
  const items = entry.items?.[plugin], out = items?.keptOut?.[tool] ?? 0, on = (items?.on[tool] ?? 0) - out;
  return `${on} of its ${items?.of[tool] ?? 0} items ${on === 1 ? 'is' : 'are'} on${where}${out ? ` (${names[tool]}’s own settings keep ${out} out)` : ''}`;
};

/**
 * The same part, by each kind's own rule: skill folders ignore case (as macOS and Windows do), agents match as the Agents
 * page keys them (NFC, ignoring case), MCP servers are keys in a settings file and match exactly.
 */
export function samePart(first: PartRef, second: PartRef): boolean {
  if (first.kind !== second.kind) return false;
  if (first.kind === 'mcp') return first.name === second.name;
  return first.name.normalize('NFC').toLowerCase() === second.name.normalize('NFC').toLowerCase();
}

/** Which page lists each kind of part, and the kind each page lists. */
export const pageOfPart = { skill: 'skills', mcp: 'mcp', agent: 'agents' } as const;
export const partOfPage = { skills: 'skill', mcp: 'mcp', agents: 'agent' } as const;
/** The name Claude Code gives a plugin's MCP server: its denied list (partswitch.ts) and its `mcp list` (mcpsignin.ts) go by it. */
export const claudeServerName = (plugin: string, server: string) => `plugin:${plugin}:${server}`;

/** Each kind of part in words: [one, several]. */
export const partWords: Record<PartKind, [string, string]> = { skill: ['skill', 'skills'], mcp: ['MCP server', 'MCP servers'], agent: ['agent', 'agents'] };

/** "version 1.2", or nothing when the catalog gave none. */
export const versionWord = (version?: string) => (version ? `version ${version}` : '');

/** That a tool has no switch for one item of a plugin of this kind, in the words the plugin's page and the Profiles page both say it in. */
export const noSingleSwitch = (tool: HarnessId, kind: PartKind) => `${names[tool]} has no switch for a single ${partWords[kind][0]} of a plugin`;

/**
 * Tools with no switch for one skill of a plugin, and why (ENB-06). Claude Code's skillOverrides leave plugin skills alone,
 * so only the whole plugin turns off there; a deny rule only fails the call and is not Disable. Codex keeps the switch in
 * config.toml (`[[skills.config]]` by name, which outlives an update) and Copilot CLI behind its own `skill disable`.
 */
export const NO_SKILL_SWITCH: Partial<Record<HarnessId, string>> = {
  'claude-cli': `${noSingleSwitch('claude-cli', 'skill')}: only the whole plugin turns off there.`,
};

/**
 * Whether the tool has a switch, written by partswitch.ts, for one MCP server or one agent of a plugin: a server in every
 * tool that takes plugins, an agent in Claude Code alone (Copilot CLI has none; Codex loads no plugin's agents).
 */
export const hasPartSwitch = (tool: HarnessId, kind: PartKind) => (kind === 'mcp' ? takesPlugins(tool) : kind === 'agent' && tool === 'claude-cli');

/** Whether a tool that takes plugins loads a plugin's items of this kind: each its skills and MCP servers, all but Codex its agents. */
export const loadsKind = (tool: HarnessId, kind: PartKind) => kind !== 'agent' || tool !== 'codex-cli';

/** Why a skill is off that Copilot CLI turned off by its bare name, for every skill so named: not this plugin's own switch. */
export const offByBareName = (skill: string) => `Can’t be turned on here: Copilot CLI has every skill named “${skill}” turned off, not only this plugin’s. To turn them all on: \`copilot skill enable ${skill}\``;
/** Why Codex's skill switches aren't edited: its config.toml writes the list as a value, which a `[[skills.config]]` block can't extend. */
export const INLINE_SKILLS_CONFIG = 'Codex’s config.toml writes skills.config as a value, a form Central Knot doesn’t edit, so its plugin skills can’t be switched here.';
/** Why a skill the marketplace lists can't be switched where the installed copy (an older or newer version) lacks it. */
export const notInCopy = (tool: HarnessId, skill: string) => `The copy ${names[tool]} has installed has no skill named “${skill}”.`;
/** Why Copilot CLI's switch isn't offered for a skill whose name could not go safely on its command line. */
export const UNSAFE_SKILL_NAME = 'Its name has characters Central Knot doesn’t pass to Copilot CLI’s command.';
/** Why a skill can't be switched while its whole plugin is off in that tool (also profileplan.ts). */
export const pluginOff = (plugin: string, tool: HarnessId) => `The whole plugin ${plugin} is off in ${names[tool]}.`;

/**
 * Why one skill of this plugin can't be switched in this tool here, if it can't: the tool has no such switch, the plugin
 * isn't installed there, the whole plugin is off there, its installed copy lacks the skill, its name can't go on Copilot CLI's
 * command line, it is held off by a switch that isn't the plugin's own, Copilot CLI's command is missing, or writing isn't allowed in this home.
 */
export function cantSwitchSkill(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, skill: string): string | undefined {
  const state = stateOf(entry, plugin, tool);
  if (state.state !== 'installed') return NO_SKILL_SWITCH[tool] ?? `It isn’t installed in ${names[tool]}.`;
  if (NO_SKILL_SWITCH[tool]) return NO_SKILL_SWITCH[tool];
  if (state.off) return pluginOff(plugin, tool);
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

/** A marketplace's name for headings and messages: the name it gives itself, or where it comes from until it is read. */
export const marketTitle = (entry: MarketplaceView) => entry.bundled?.displayName || entry.name || entry.sourceLabel;

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
 * its place in the plugin): what marks that tool's copy "differs from the marketplace's copy" and offers Update there. A
 * part only one side has is left out, since each tool reads its copy by its own rules (Codex's manifest, Copilot CLI's
 * skills list). An instruction file is left out too: no tool reads it, so a difference there offers no Update (its own row
 * on the plugin's page still says which copy differs: pluginpage.ts differsNote). The page and the update both ask this.
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
  return state.state === 'installed' && !state.live && !state.directory && !versionDiffers(state.version, offered) && !!detail?.offered && !detail.problem && copyDiffers(detail, detail.installed?.[tool]);
}

/**
 * The plugins whose files the list reads in the background, so copyStale is known without their pages being opened: those
 * some tool has installed, other than as a copy loaded live from a folder marketplace or Claude Code's copy from the
 * Anthropic Directory (never stale).
 */
export const copiesToCompare = (view: PluginsView, entry: MarketplaceView): string[] => entry.plugins
  .filter(plugin => view.tools.some(tool => { const state = stateOf(entry, plugin.name, tool); return state.state === 'installed' && !state.live && !state.directory; }))
  .map(plugin => plugin.name);

/**
 * Whether Update is offered for a tool's installed copy: it is older than the version `offered` (another version than
 * the marketplace's, see versionDiffers, and not a newer one), or the same version with other content (copyStale, once
 * `detail` is read). A copy loaded live from a folder marketplace is always its own, and so is Claude Code's copy from
 * the Anthropic Directory, which Claude Code keeps up to date.
 */
export function outdated(entry: MarketplaceView, plugin: string, tool: HarnessId, offered: string | undefined, detail?: PluginDetail | null): boolean {
  const state = stateOf(entry, plugin, tool);
  if (state.state !== 'installed' || state.live || state.directory) return false;
  return (versionDiffers(state.version, offered) && compareVersions(releaseOf(state.version!), releaseOf(offered!)) < 0) || copyStale(entry, plugin, tool, offered, detail);
}

/**
 * The tools Update brings up to date for one plugin by their own update: those whose installed copy is out of date
 * (`outdated`) and can be changed here (as for an uninstall: not held, a CLI, a home that can be written). Its items in Pi,
 * OpenCode and Antigravity come up to date apart (pluginlibrary.ts itemsView `ready`).
 */
export function updateTools(view: PluginsView, entry: MarketplaceView, plugin: string, offered: string | undefined, detail?: PluginDetail | null): HarnessId[] {
  return view.tools.filter(tool => outdated(entry, plugin, tool, offered, detail) && !cantUninstall(view, entry, plugin, tool));
}

// ---------- A whole plugin's one switch, as the pages say it (the answer is pluginrecord.ts owedTo's, in the view) ----------

/**
 * One managed tool's mark for a plugin, from the table's answer (`owed`) and the tool's copy: installed (`outdated` when an
 * Update is offered), its items on there (`items`: Pi, OpenCode, Antigravity), installed and off by its own switch (`kept-off`:
 * Off, kept installed, recorded or not), installed and on though not wanted (`stays`), not in it though wanted (`waits` for the automatic updates' check; `not-brought`, new here while some tool has it off
 * in its own settings; `missing`), its parts from before the library waiting to be moved (`parts-waiting`: Pi, OpenCode), a
 * tool that can't take it (`cannot`), not in it (`absent`, kept out of it or not), its record unreadable (`unknown`), or
 * listed with its files gone (`not-known`). The plugin's page draws each as its tool's box (boxOf).
 */
export type ToolMark = 'installed' | 'outdated' | 'items' | 'kept-off' | 'stays' | 'waits' | 'not-brought' | 'missing' | 'parts-waiting' | 'cannot' | 'absent' | 'unknown' | 'not-known';

/** Each mark's short words under a tool's box on a plugin's page and on a tool's Plugins tab (the whole sentence is toolMark's). */
export const MARK_WORDS: Record<ToolMark, string> = {
  installed: 'Installed', outdated: 'Installed', items: 'Its items', 'kept-off': 'Off, kept installed', stays: 'Still installed', waits: 'Goes in at the next check', 'not-brought': 'Not brought here: off in a tool’s own settings',
  missing: 'Not in it, though on', 'parts-waiting': 'Waits to be moved', cannot: 'Not available', absent: 'Not installed', unknown: 'Can’t be read now', 'not-known': 'Unknown',
};

/**
 * A copy the plugins record keeps installed and off (pluginrecord.ts row 9): the plugin isn't wanted in that tool, and the tool's own
 * switch has it off (`off`). Distinct from the ToolMark `kept-off` below, which marks any installed copy that is `off`, recorded or not.
 * It is not in use (pluginPlace), the automatic updates leave it (marketplaces.ts pendingUpdates), and profiles and their Undo
 * leave it off (types.ts InstalledPlugin `keptOff`).
 */
export const keptOff = (entry: Pick<PluginEntry, 'on' | 'except'> | undefined, tool: HarnessId, off: boolean | undefined) => !!entry && !!off && !wantedIn(entry, tool);
/** Whether a tool has the plugin in use, as the view's switch reads it: installed whole and on, or its items there. */
export const inUseIn = (entry: MarketplaceView, plugin: string, tool: HarnessId) => {
  const has = entry.switches?.[plugin]?.tools[tool]?.has;
  return (has === 'whole' && !copyOff(entry, plugin, tool)) || has === 'items';
};

/**
 * A tool's mark and the sentence its tooltip and the plugin page's line say. `outdated`: an Update is offered there
 * (pluginstatus.updateTools); `auto`: plugins change by themselves now (the automatic updates on, Automatic sync on), so an
 * install owed to the check is made at its next turn.
 */
export function toolMark(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, owed: Owed | undefined, { outdated = false, auto = false, stale = false } = {}): { mark: ToolMark; words: string } {
  const name = names[tool], state = stateOf(entry, plugin, tool);
  const recorded = !!entry.switches?.[plugin]?.entry;
  if (!owed || owed.has === 'unknown') return { mark: 'unknown', words: recordUnread(tool) };
  if (!takesPlugins(tool) && waitsToMove(entry, plugin)) return { mark: 'parts-waiting', words: waitingWords(view, entry, plugin, [tool]) };
  const kept = entry.switches?.[plugin]?.entry?.except.includes(tool);
  // Installed though the person doesn't want it there: said with what takes it out, or why nothing can here (a copy that can't be
  // read has said why already).
  const heldWhy = owed.held && state.state !== 'not-known' ? `; ${owed.held}` : '.';
  const unwanted = recorded && !owed.wanted ? ` ${kept ? `It is kept out of ${name}` : 'The plugin is off'}${heldWhy}` : '';
  if (state.state === 'not-known') return { mark: 'not-known', words: `${state.reason}${unwanted}` };
  if (state.state === 'installed') {
    // ToolMark `kept-off` is any copy that is `off`, recorded or not (unlike `keptOff` above, which requires the record to keep the tool out).
    if (state.off) return { mark: 'kept-off', words: `Off in ${name}: still installed${state.version ? ` at ${state.version}` : ''}, with its data and settings.` };
    const version = state.version ? ` ${state.version}` : '';
    const how = [state.live ? 'loaded live from the marketplace folder' : '', state.directory ? 'from the Anthropic Directory' : '', stale ? 'which differs from the marketplace’s copy' : ''].filter(Boolean).join(', ');
    const words = `${name}: installed${version}${how ? `, ${how}` : ''}.`;
    if (unwanted) return { mark: 'stays', words: `${words}${unwanted}` };
    return { mark: outdated ? 'outdated' : 'installed', words: outdated ? `${words} An update is offered: Update on its row.` : words };
  }
  if (owed.has === 'items') {
    const ready = entry.items?.[plugin]?.ready ? ' An update is ready: Update.' : '';
    const words = `${name}: ${itemsOnWords(entry, plugin, tool, ' there')}, as items of Central Knot’s that follow the plugin.${ready}`;
    return unwanted ? { mark: 'stays', words: `${words}${unwanted}` } : { mark: 'items', words };
  }
  if (owed.wanted && owed.held) return { mark: 'cannot', words: toolSaid(tool, owed.held) };
  if (owed.wanted && owed.act) {
    const [what, goes] = owed.act === 'install' ? ['it', 'goes'] : ['its items', 'go'];
    const when = auto ? 'at the next automatic check' : 'once plugins update by themselves again (Settings, and Automatic sync)';
    if (owed.background) return { mark: 'waits', words: `Not in ${name} yet: ${what} ${goes} in ${when}.` };
    const offIn = view.tools.filter(other => { const there = stateOf(entry, plugin, other); return there.state === 'installed' && !!there.off; }).map(other => names[other]);
    if (owed.offElsewhere) return { mark: 'not-brought', words: `Not in ${name}: the plugin is off in ${andList(offIn)}’s own settings, so it isn’t brought to a tool new here by itself.` };
    return { mark: 'missing', words: [`Not in ${name}, though the plugin is on.`, ...whyNoneIn(entry, plugin, tool)].join(' ') };
  }
  // A tool that can't take it says why, kept out of it or not.
  const why = unavailable(view, entry, plugin, tool);
  if (why && !owed.takes) return { mark: 'cannot', words: toolSaid(tool, why) };
  return { mark: 'absent', words: kept ? `Not installed in ${name}, and kept out of it: nothing puts it there by itself.` : `Not installed in ${name}.` };
}

/**
 * What a waiting plugin (waitsToMove) says of `tools` (Pi, OpenCode): its line's tooltip, and the hint on its page. Its parts wait
 * to be moved, why (the last pass's reason, PluginsView partsWait), and what its Off does there once they are moved
 * (partsmigrate.ts: the item is On as the entry is, and a copy edited there stays as it is).
 */
export function waitingWords(view: PluginsView, entry: MarketplaceView, plugin: string, tools: HarnessId[]): string {
  const recorded = entry.switches?.[plugin]?.entry, where = andList(tools.map(tool => names[tool]));
  const then = recorded && !recorded.on ? `The plugin is off, so they turn off in ${where} when they are moved, apart from any you edited there, which stay as they are.`
    : `Turning the plugin off reaches ${where} when they are moved.`;
  return [`${where}: ${WAITS_TO_MOVE.charAt(0).toLowerCase()}${WAITS_TO_MOVE.slice(1)}`, view.partsWait, then].filter(Boolean).join(' ');
}

/** Whether a tool has the plugin installed whole and turned off by its own switch. */
export const copyOff = (entry: MarketplaceView, plugin: string, tool: HarnessId) => {
  const state = stateOf(entry, plugin, tool);
  return state.state === 'installed' && !!state.off;
};

/** The tools here where an On plugin is off: kept out of a tool that takes it, or installed and off by its own switch. */
const offHere = (view: PluginsView, entry: MarketplaceView, plugin: string) => {
  const sw = entry.switches?.[plugin];
  return sw?.entry?.on ? view.tools.filter(tool => (sw.entry!.except.includes(tool) && !!sw.tools[tool]?.takes) || copyOff(entry, plugin, tool)) : [];
};

/** Whether a plugin's switch shows partial: On, and off in some tool here (offHere). */
export const switchPartial = (view: PluginsView, entry: MarketplaceView, plugin: string) => offHere(view, entry, plugin).length > 0;

/** The tools a plugin with no entry is installed in whole and on: it is found there, and its row offers Add. */
export const foundIn = (view: PluginsView, entry: MarketplaceView, plugin: string) => {
  const sw = entry.switches?.[plugin];
  return sw && !sw.entry ? view.tools.filter(tool => sw.tools[tool]?.has === 'whole' && !copyOff(entry, plugin, tool)) : [];
};

/** What a plugin's switch says it is and what a click does, for its label and tooltip. */
export function switchWords(view: PluginsView, entry: MarketplaceView, plugin: string): string {
  const sw = entry.switches?.[plugin];
  if (sw?.entry?.on) {
    const out = offHere(view, entry, plugin);
    const off = out.filter(tool => copyOff(entry, plugin, tool));
    const kept = out.filter(tool => !copyOff(entry, plugin, tool));
    const parts = [off.length ? `off in ${andList(off.map(tool => names[tool]))}` : '', kept.length ? `kept out of ${andList(kept.map(tool => names[tool]))}` : ''].filter(Boolean);
    return `${plugin}: on${parts.length ? `, ${parts.join(', ')}` : ''}. Click to turn it off in each tool here that Central Knot can turn it off in, kept installed where the tool can keep it; Undo turns it on again.`;
  }
  return `${plugin}: off. Click to turn it on: it goes into every tool here that takes it${sw?.entry?.except.length ? ' and that it isn’t kept out of' : ''}, and the result says where it went; Undo takes out what it put in and turns off what it turned on.`;
}

/** Add's words for a plugin found in some tools with no entry here. */
export const addWords = (plugin: string, tools: HarnessId[]) =>
  `${plugin} is in ${andList(tools.map(tool => names[tool]))}, installed outside Central Knot. Add turns it on here: it goes into every other tool here that takes it, and Undo takes it out again.`;

/** Why one of a plugin's items is not on in a tool (OUT), or a reason of its own: it couldn't be read, or the tool can't hold it. */
export type ItemOut = keyof typeof OUT | { cannot: string };
/** "a skill", "an agent", or several: "MCP servers". */
const kindWords = (kind: PartKind, several: boolean) => (several ? partWords[kind][1] : `${kind === 'skill' ? 'a' : 'an'} ${partWords[kind][0]}`);
/** What each reason says of `list` (its names; `several`), one plain sentence with the way to have the plugin's there instead. */
const OUT = {
  own: (list: string, several: boolean, kind: PartKind, tool: string) => `${list}: ${tool} has ${kindWords(kind, several)} of its own by that name, never written over; turn ${several ? 'each' : 'it'} on in ${tool} on its row to put the plugin’s there, keeping ${tool}’s as a version.`,
  shared: (list: string, several: boolean, _kind: PartKind, tool: string) => `${list}: ${tool} reads yours from the shared skills folder, which Central Knot never writes. Take ${several ? 'each' : 'it'} over on ${several ? 'their Library rows' : 'its Library row'} to use the plugin’s.`,
  kept: (list: string, several: boolean, _kind: PartKind, tool: string) => `${list} ${several ? 'are' : 'is'} kept out of ${tool}: tick to let ${several ? 'them' : 'it'} in, unless ${tool} has its own by that name.`,
  off: (list: string, several: boolean) => `${list} ${several ? 'were' : 'was'} turned off on ${several ? 'their rows' : 'its row'}: tick to turn ${several ? 'them' : 'it'} on.`,
  deleted: (list: string, several: boolean) => `${list} ${several ? 'were' : 'was'} deleted here: tick to bring ${several ? 'them' : 'it'} back.`,
  yours: (list: string, several: boolean, kind: PartKind) => `${list}: you keep your own ${partWords[kind][several ? 1 : 0]} by ${several ? 'those names' : 'that name'}, not the plugin’s.`,
  another: (list: string, several: boolean, kind: PartKind) => `${list}: another source has ${kindWords(kind, several)} by that name here; delete ${several ? 'them' : 'it'} on ${several ? 'their rows' : 'its row'} to take the plugin’s.`,
};

/**
 * Why a plugin's items are not on in a tool with no installer, one plain sentence per reason (`outs`: each item's, from
 * pluginlibrary.ts outsIn; those alike together, a long list of names cut), which the page says under that tool's box (`notIn`)
 * and the run's report after its lead; or, with no item at all, that the plugin brings nothing such a tool takes (`brings`: what it does).
 */
export function notInWhy(tool: HarnessId, plugin: string, outs: { name: string; kind: PartKind; out: ItemOut }[], brings?: string): string[] {
  const where = names[tool];
  const kinds = orList((['skill', 'agent', 'mcp'] as const).filter(kind => holds(tool, kind)).map(kind => (kind === 'mcp' ? 'MCP server' : kind)));
  if (!outs.length) return [`${plugin} has no ${kinds}, which is all ${where} takes of a plugin: what it brings${brings ? ` (${brings})` : ''} stays with the tools that take plugins.`];
  return [...groupBy(outs, ({ out, kind }) => (typeof out === 'string' ? `${out} ${kind}` : out.cannot)).values()].map(group => {
    const list = group.map(each => each.name), { out, kind } = group[0]!, named = andList(list.length > 4 ? [...list.slice(0, 3), `${list.length - 3} more`] : list);
    return typeof out === 'string' ? OUT[out](named, list.length > 1, kind, where) : `${named}: ${out.cannot}`;
  });
}

/**
 * One name of his under a tool's box (types.ts PluginItemsView yours): the same as the plugin's; his through the shared skills
 * folder; or OUT's `yours` for it alone, then why the plugin's can't land there (`held`) or, offered, Use the plugin's beside it.
 */
export function yourSaid({ name, kind, same, held }: YourName, tool: HarnessId): string {
  if (same) return `${name} is the same as yours, so yours stays.`;
  if (held?.shared) return OUT.shared(name, false, kind, names[tool]);
  return [OUT.yours(name, false, kind), held?.why].filter(Boolean).join(' ');
}
/** Why none of a plugin's items is on in a tool, as its line and box say it: notInWhy's reasons, then each name of his (yourSaid). */
export const whyNoneIn = (entry: MarketplaceView, plugin: string, tool: HarnessId) =>
  [...entry.items?.[plugin]?.notIn?.[tool]?.reasons ?? [], ...(entry.items?.[plugin]?.yours?.[tool] ?? []).map(name => yourSaid(name, tool))];

/** Words a tool's result or line says, starting with the tool's name unless they already do ("Codex: …", never "Codex: Codex’s …"). */
export const toolSaid = (tool: HarnessId, words: string) => (words.startsWith(names[tool]) ? words : `${names[tool]}: ${words}`);

/** The marks a tool's box on the plugin's page shows ticked (the plugin is in that tool), and those it can't act on. */
const TICKED: readonly ToolMark[] = ['installed', 'outdated', 'items', 'stays'], HELD: readonly ToolMark[] = ['cannot', 'unknown', 'not-known', 'parts-waiting'];
/** Why no plugin switch in this view can write (preview-only home, or a problem with the plugins record). */
export const viewStopped = (view: Pick<PluginsView, 'canWrite' | 'reason' | 'switchProblem'>) =>
  !view.canWrite ? view.reason ?? PREVIEW_ONLY : view.switchProblem;

/**
 * A tool's box on the plugin's page (pluginparts.ts toolBox; what a click records: pluginrecord.ts A TOOL'S BOX), from its mark
 * (toolMark): ticked or not; off where it can't act, with why (`off`): its mark held, a copy that can't be changed here
 * (cantUninstall: ticked or off), or a home that can't change; and its line where that says more than the mark (`line`): why it is off, short.
 */
export function boxOf(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, { mark, words }: { mark: ToolMark; words: string }): { ticked: boolean; held?: true; off?: string; line?: string } {
  const name = names[tool], ticked = TICKED.includes(mark), held = HELD.includes(mark), recorded = entry.switches?.[plugin];
  const kept = !!recorded?.entry?.on && recorded.entry.except.includes(tool);
  const stuck = (ticked || mark === 'kept-off') && takesPlugins(tool) && view.canWrite ? cantUninstall(view, entry, plugin, tool) : undefined;
  const off = held ? words : stuck ? `${stuck}${ticked && kept ? ` It is kept out of ${name}: uninstall it in ${name} itself, then tick to put it back.` : ''}` : viewStopped(view);
  const line = !held && !stuck ? undefined
    : takesPlugins(tool) && !view.clis[tool] ? `No ${name} command-line tool here` : entry.refusedBy?.[tool] ? `${name} refused this marketplace`
    : stuck ? (ticked ? 'Can’t be taken out here' : `${MARK_WORDS['kept-off']} · can’t be changed here`) : mark === 'cannot' ? recorded?.tools[tool]?.held ?? unavailable(view, entry, plugin, tool) : undefined;
  return { ticked, ...(held ? { held: true as const } : {}), ...(off ? { off } : {}), ...(line ? { line } : {}) };
}

/**
 * A copy Uninstall… can take out of a tool, and the only one marketplaces.ts turn's `uninstall` takes out: installed whole in a
 * tool that takes plugins, other than Copilot CLI's copy loaded live from a folder, whose Off is already its uninstall.
 */
export const uninstallsWhole = (entry: MarketplaceView, plugin: string, tool: HarnessId) => {
  const state = stateOf(entry, plugin, tool);
  return takesPlugins(tool) && state.state === 'installed' && !(tool === 'copilot-cli' && state.live);
};
/** The marks of a copy installed in a tool, on or off, beside whose box Uninstall… can be. */
const UNINSTALLS: readonly ToolMark[] = ['installed', 'outdated', 'stays', 'kept-off'];
/** Whether a tool's box offers Uninstall… (pluginparts.ts uninstallControl): such a copy, where the box can act (boxOf `off`: stuck, held, or a home that can't change). */
export const offersUninstall = (entry: MarketplaceView, plugin: string, tool: HarnessId, mark: ToolMark, box: { off?: string }) =>
  UNINSTALLS.includes(mark) && !box.off && uninstallsWhole(entry, plugin, tool);

/**
 * Uninstall…'s question in one tool, naming only what is lost there for good, as the tools' own uninstalls were measured to lose
 * it: in Claude Code the options saved for a copy that declares some (its data folder is kept: plugins.ts uninstallArgs), in Codex
 * its servers' switches; then where the marketplace can't give this copy back: another version, a copy that differs, or nothing
 * (`gone`: no longer offered or its marketplace unread, where marketplaces.ts turn gives no Undo).
 */
export function uninstallAsk(title: string, tool: HarnessId, copy: Pick<InstalledPlugin, 'version' | 'options' | 'serversOff'> = {},
  offer: { version?: string; stale?: boolean; gone?: boolean } = {}): string {
  const lost = tool === 'claude-cli' && copy.options ? 'Its saved options there are deleted for good.'
    : tool === 'codex-cli' && copy.serversOff?.length ? 'Its servers’ switches there are reset for good.' : 'Nothing else is lost.';
  const back = offer.gone ? 'It is no longer offered, so it can’t be installed again from here.'
    : versionDiffers(copy.version, offer.version) ? `The marketplace now offers ${offer.version}; ${copy.version} can’t be installed again from here.`
      : offer.stale ? 'Its copy differs from the marketplace’s and can’t be installed again from here.' : '';
  return [`Uninstall ${title} from ${names[tool]}?`, lost, back].filter(Boolean).join(' ');
}
