// A tool's line on a plugin's item opened in the Library, without the DOM: THE RULE for its control, in one place (lineControl).
// A switch where a click changes only this item in that tool (pluginswitch.ts click, as before); a button that names the act
// where a click does more (Install the plugin, Put its items here, Turn the plugin on or off, Remove the plugin), with a sentence
// that names the plugin and the tool; a sentence alone where nothing can be done. Where the tool has the item, what a click turns
// is pluginswitch.ts's answer (wholeTurn); where the tool lacks the plugin, whether it may go in is the plugin's box on its own
// page (pluginstatus.ts boxOf), asked of the Plugins page's view (pluginstate.ts lineBox): no second set of rules here.
// Elsewhere: the buttons' clicks (Install, Put its items here and Remove: pluginstate.ts turnFromLine, a plugin's turn in main;
// Turn the plugin on or off: matrix.ts switchPluginItem, the item's own switch's click), the line drawn (matrix.ts pluginLine),
// which of a library row's lines are a plugin's (matrix.ts rowPluginFacts), and the others, the library's own (libraryrow.ts hasLine):
// a library item from a plugin in Pi, OpenCode and Antigravity, and one kept out of a tool that lacks the plugin.
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
  /** Names of the plugin's items this tool has of his own, which a placement leaves his (library.ts TAKE; pluginrows.ts placedIn). */
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
  // The switch: a click that turns this item alone, one that can't be written (said beside it), a plugin that is this item
  // alone, and a skill in Claude Code, which turns the whole plugin as before (taking it apart is a later step).
  const whole = wholeTurn(item);
  if (!whole || cantSwitch(item) || !bringsMore(item) || (item.tool === 'claude-cli' && item.kind === 'skill')) return SWITCH;
  const byName = item.kind === 'mcp' && item.tool === 'copilot-cli' && !onNow(item) ? ` ${copilotByName(item.name, true)}` : '';
  return button(onNow(item) ? 'plugin-off' : 'plugin-on', `Turns ${whole}.${byName}`);
}

function install({ tool, kind, plugin, marketName, box, parts }: LineFacts): LineControl {
  const where = names[tool];
  // Installing the plugin there wouldn't give this item: Codex loads no plugin's agents.
  if (!loadsKind(tool, kind)) return none(`${where} doesn’t load a plugin’s ${partWords[kind][1]}.`);
  if (box === 'unlisted') return none(`Not installed in ${where}. ${marketName === DIRECTORY ? 'It comes from the Anthropic Directory, which only Claude Code installs from.' : `${capital(unlisted(marketName))}, so it can’t be installed from here.`}`);
  if (box === 'ambiguous') return none(`Not installed in ${where}. ${twoNamed(marketName, plugin)}, so which one to install it from can’t be told here.`);
  if (box?.off) return none(box.off);
  if (!box || box.ticked) return none(`Not installed in ${where}.`);
  // Claude Code loads each part its marketplace entry lists, as the catalog counts them. Copilot CLI reads a skills folder the
  // entry names in place of the plugin's own, and Codex its own manifest, neither of which the count follows: not counted.
  const counts = parts && tool === 'claude-cli' ? countOf(parts, () => true) : undefined;
  return button('install', `Installs ${plugin} in ${where}${counts?.words ? `, with its ${counts.words} on` : ''}.`);
}

function place({ tool, plugin, marketName, box, parts, yours = [] }: LineFacts): LineControl {
  const where = names[tool];
  if (box === 'unlisted') return none(`${where} takes no plugins, and ${unlisted(marketName)}, so its items can’t be put there.`);
  if (box === 'ambiguous') return none(`${where} takes no plugins, and ${twoNamed(marketName, plugin).replace(/^M/, 'm')}, so which one to put its items from can’t be told here.`);
  if (box?.off) return none(box.off);
  if (!box) return none(`${where} takes no plugins.`);
  // Ticked: the plugin's other items are there, and a tick can't bring this one (its line on the plugin's page has why).
  if (box.ticked) return none(`${plugin}’s other items are in ${where}, following the plugin; this one isn’t.`);
  const counts = parts && countOf(parts, kind => holds(tool, kind), yours);
  const mine = yours.length ? ` ${yoursStay(yours)}` : '';
  if (!counts?.words) return button('place', `Puts the items of ${plugin} that ${where} can hold into ${where}, following the plugin.${mine}`);
  const cannot = [parts!.hooks ? 'hooks' : '', parts!.commands ? 'commands' : ''].filter(Boolean);
  return button('place', `${plugin}’s ${counts.words} ${counts.total === 1 ? 'goes' : 'go'} into ${where}, following the plugin.${mine}${cannot.length ? ` ${capital(andList(cannot))} can’t.` : ''}`);
}

/** That his own of the plugin's names stay his: "Your own triage stays as it is." The line before a placement and its result say it. */
export const yoursStay = (yours: PartRef[]) => `Your own ${andList(yours.map(part => part.name))} ${yours.length === 1 ? 'stays as it is' : 'stay as they are'}.`;
const twoNamed = (marketName: string, plugin: string) => `More than one marketplace here named “${marketName}” lists ${plugin}`;

/** The plugin's skills, agents and MCP servers its marketplace lists, of the kinds `keep` keeps, but `less`, in words ("3 skills and 1 MCP server"), and how many. */
function countOf(parts: Components, keep: (kind: PartKind) => boolean, less: PartRef[] = []): { words: string; total: number } {
  const listed = (kind: PartKind) => ({ skill: parts.skills, agent: parts.agents, mcp: parts.mcp })[kind] - less.filter(part => part.kind === kind).length;
  const counts = (['skill', 'agent', 'mcp'] as const).filter(keep).map(kind => [kind, listed(kind)] as const).filter(([, count]) => count > 0);
  return { words: andList(counts.map(([kind, count]) => `${count} ${partWords[kind][count === 1 ? 0 : 1]}`)), total: counts.reduce((sum, [, count]) => sum + count, 0) };
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
