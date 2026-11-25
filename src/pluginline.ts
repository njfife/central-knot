// A tool's line on a plugin's item opened in the Library, without the DOM: THE RULE for its control, in one place (lineControl).
// A switch where a click changes only this item in that tool (pluginswitch.ts click, as before); a button that names the act
// where a click does more (Install the plugin, Put its items here, Turn the plugin on or off, Remove the plugin), with a sentence
// that names the plugin and the tool; a sentence alone where nothing can be done. Where the tool has the item, what a click turns
// is pluginswitch.ts's answer (wholeTurn); where the tool lacks the plugin, whether it may go in is the plugin's box on its own
// page (pluginstatus.ts boxOf), asked of the Plugins page's view (pluginstate.ts lineBox): no second set of rules here.
// Elsewhere: the buttons' clicks (Install, Put its items here and Remove: pluginstate.ts turnFromLine, a plugin's turn in main;
// Turn the plugin on or off: matrix.ts switchPluginItem, the item's own switch's click), and their result on the line that acted
// (pluginstate.ts LineResult); the line drawn (matrix.ts pluginLine); which of a library row's lines are a plugin's (matrix.ts
// rowPluginFacts: in a tool that takes plugins and lacks it, and in Pi, OpenCode and Antigravity while the item is Off, where Put its
// items here puts them there again after its Undo); and the others, the library's own (libraryrow.ts hasLine).
import { DIRECTORY, loadsKind, partWords, samePart } from './pluginstatus.ts';
import { cantSwitch, copilotByName, offRemoves, onNow, wholeTurn, type PluginItemAt } from './pluginswitch.ts';
import { holds, takesPlugins } from './presence.ts';
import { andList, toolNames as names } from './words.ts';
import type { Components, HarnessId, InstalledPlugin, PartKind, PartRef } from './types.ts';

/** What a line's button does: install the plugin, put its items in a tool that takes no plugins, uninstall a plugin Copilot CLI loads live, or turn the whole plugin there. */
export type LineAct = 'install' | 'place' | 'remove' | 'plugin-on' | 'plugin-off';
export type LineControl = { control: 'switch' } | { control: 'button'; act: LineAct; label: string; sentence: string } | { control: 'none'; sentence: string };
/** A tool's box on the plugin's page, as pluginstatus.ts boxOf answers it: ticked, and off with why. */
export type LineBox = { ticked: boolean; off?: string };

/** What a tool's line is drawn from: the home's view (`through`, `installed`) and the Plugins page's (`box`, `parts`). */
export interface LineFacts {
  tool: HarnessId;
  kind: PartKind;
  plugin: string;
  marketName: string;
  /** The tool has the item through the plugin as installed there (pluginrows.ts itemThrough, a plugin row's copy). */
  through?: PluginItemAt;
  /** The tool has the plugin installed, but its copy lacks the item. */
  installed?: InstalledPlugin;
  /**
   * The plugin's box for this tool on its page; undefined while the Plugins page's view is read, `unlisted` where no marketplace
   * here lists the plugin, `ambiguous` where more than one of that name does and the row can't tell which it comes from.
   */
  box?: LineBox | 'unlisted' | 'ambiguous';
  /** Names of the plugin's items this tool has of his own, which an install or a placement leaves his (library.ts TAKE; pluginrows.ts yoursIn). */
  yours?: PartRef[];
  /** What its marketplace lists in it, for the counts; undefined where that isn't known. */
  parts?: Components;
}

const LABELS: Record<LineAct, string> = { install: 'Install the plugin', place: 'Put its items here', remove: 'Remove the plugin', 'plugin-on': 'Turn the plugin on', 'plugin-off': 'Turn the plugin off' };
const SWITCH: LineControl = { control: 'switch' };
const button = (act: LineAct, sentence: string): LineControl => ({ control: 'button', act, label: LABELS[act], sentence });
const none = (sentence: string): LineControl => ({ control: 'none', sentence });

/** A tool's line: its control, and what its sentence says. */
export function lineControl(facts: LineFacts): LineControl {
  if (facts.through) return hasIt(facts.through, facts);
  if (facts.installed) return none(lacksIt(facts.installed, facts.kind));
  return takesPlugins(facts.tool) ? install(facts) : place(facts);
}

/** Why a tool that has the plugin installed has no copy of this item: its files unread, Codex and an agent, or another version. */
export function lacksIt(install: InstalledPlugin, kind: PartKind): string {
  const tool = names[install.tool];
  if (install.problem) return `${tool} has ${install.plugin} installed, but its files couldn’t be read.`;
  if (!loadsKind(install.tool, kind)) return `${tool} has ${install.plugin} installed, but Codex doesn’t load a plugin’s agents.`;
  return `${tool} has ${install.plugin} installed, but its copy doesn’t have this ${partWords[kind][0]}.`;
}

const unlisted = (marketName: string) => `its marketplace “${marketName}” isn’t added in Central Knot or in any tool here`;
/** Whether the plugin brings anything in its tool besides this item: another item, or hooks. */
const bringsMore = (item: PluginItemAt) => item.install.items.some(entry => !samePart(entry, item)) || !!item.install.hooks?.length;

function hasIt(item: PluginItemAt, { box, marketName }: LineFacts): LineControl {
  const tool = names[item.tool], plugin = item.install.plugin;
  // Copilot CLI's whole-plugin switch for a plugin it loads live from a folder is its uninstall.
  if (offRemoves(item)) {
    const lead = `${tool} loads ${plugin} live from a folder, so turning it off there is removing it.`;
    if (box === 'unlisted') return none(`${lead} ${capital(unlisted(marketName))}, so ${tool}’s own plugin commands remove it.`);
    if (typeof box !== 'object' || !box.ticked || box.off) return none([lead, typeof box === 'object' ? box.off : undefined].filter(Boolean).join(' '));
    return button('remove', `${lead} Uninstalls ${plugin} from ${tool}. Its marketplace folder stays.`);
  }
  // The switch: a click that turns this item alone, one that can't be written (said beside it), and a plugin that is this item alone.
  const whole = wholeTurn(item);
  if (!whole || cantSwitch(item) || !bringsMore(item)) return SWITCH;
  const byName = item.kind === 'mcp' && item.tool === 'copilot-cli' && !onNow(item) ? ` ${copilotByName(item.name, true)}` : '';
  return button(onNow(item) ? 'plugin-off' : 'plugin-on', `Turns ${whole}.${byName}`);
}

function install({ tool, kind, plugin, marketName, box, parts, yours = [] }: LineFacts): LineControl {
  const where = names[tool];
  // Installing the plugin there wouldn't give this item: Codex loads no plugin's agents.
  if (!loadsKind(tool, kind)) return none(`${where} doesn’t load a plugin’s ${partWords[kind][1]}.`);
  if (box === 'unlisted') return none(`Not installed in ${where}. ${marketName === DIRECTORY ? 'It comes from the Anthropic Directory, which only Claude Code installs from.' : `${capital(unlisted(marketName))}, so it can’t be installed from here.`}`);
  if (box === 'ambiguous') return none(`Not installed in ${where}. ${twoNamed(marketName, plugin)}, so which one to install it from can’t be told here.`);
  if (box?.off) return none(box.off);
  if (!box || box.ticked) return none(`Not installed in ${where}.`);
  // Claude Code loads each part its marketplace entry lists, as the catalog counts them. Copilot CLI reads a skills folder the
  // entry names in place of the plugin's own, and Codex its own manifest, neither of which the count follows: not counted.
  const counts = parts && tool === 'claude-cli' ? countOf(parts) : '';
  return button('install', `Installs ${plugin} in ${where}${counts ? `, with its ${counts} on` : ''}.${yours.length ? ` ${yoursStay(yours)}` : ''}`);
}

function place({ tool, plugin, marketName, box, parts, yours = [] }: LineFacts): LineControl {
  const where = names[tool];
  if (box === 'unlisted') return none(`${where} takes no plugins, and ${unlisted(marketName)}, so its items can’t be put there.`);
  if (box === 'ambiguous') return none(`${where} takes no plugins, and ${twoNamed(marketName, plugin).replace(/^M/, 'm')}, so which one to put its items from can’t be told here.`);
  if (box?.off) return none(box.off);
  if (!box) return none(`${where} takes no plugins.`);
  // Ticked: the plugin's other items are there, and a tick can't bring this one (its line on the plugin's page has why).
  if (box.ticked) return none(`${plugin}’s other items are in ${where}, following the plugin; this one isn’t.`);
  // No number is promised: what goes in is counted by the placement itself, in its result (pluginstate.ts runLine). Where a name of
  // his own is there for each of its parts of each kind its marketplace lists, nothing could go in.
  const kinds = (['skill', 'agent', 'mcp'] as const).filter(kind => holds(tool, kind) && (!parts || listed(parts, kind) > 0));
  if (parts && yours.length && kinds.every(kind => yours.filter(part => part.kind === kind).length >= listed(parts, kind))) return none(yoursStay(yours, `, so none of ${plugin}’s items can go into ${where}.`));
  const cannot = [parts?.hooks ? 'hooks' : '', parts?.commands ? 'commands' : ''].filter(Boolean);
  return button('place', [`Puts ${plugin}’s ${andList(kinds.map(kind => partWords[kind][1]))} into ${where}, following the plugin.`, yours.length ? yoursStay(yours) : '',
    cannot.length ? `${capital(andList(cannot))} can’t.` : ''].filter(Boolean).join(' '));
}

/** That his own of the plugin's names stay his: "Your own triage stays as it is." A line's sentence before its act says it. */
export const yoursStay = (yours: PartRef[], then = '.') => `Your own ${andList(yours.map(part => part.name))} ${yours.length === 1 ? 'stays as it is' : 'stay as they are'}${then}`;
const twoNamed = (marketName: string, plugin: string) => `More than one marketplace here named “${marketName}” lists ${plugin}`;

/** How many of a kind its marketplace lists in the plugin. */
const listed = (parts: Components, kind: PartKind) => ({ skill: parts.skills, agent: parts.agents, mcp: parts.mcp })[kind];
/** The plugin's skills, agents and MCP servers its marketplace lists, in words: "3 skills and 1 MCP server". */
const countOf = (parts: Components) => andList((['skill', 'agent', 'mcp'] as const)
  .flatMap(kind => (listed(parts, kind) ? [`${listed(parts, kind)} ${partWords[kind][listed(parts, kind) === 1 ? 0 : 1]}`] : [])));

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
