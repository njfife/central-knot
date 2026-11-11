// The Skills, MCP servers and Agents pages' switch for an item a tool has through an installed plugin: the item's own
// switch where the tool has one (a skill in Copilot CLI or Codex, ENB-06; an MCP server in Claude Code, Copilot CLI or
// Codex and an agent in Claude Code, partswitch.ts), else the whole plugin's. A click is a choice for Apply all, kept in the page's own plugin
// draft (pluginplan), so it runs, reports and undoes like the Plugins page's.
// Pure functions over plain data; the page draws and applies.
import { choose, clear, queued, queuedPart, queuedWhole, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { NO_SKILL_SWITCH, hasPartSwitch, noSwitchReason, partWords, samePart } from './pluginstatus.ts';
import { plural } from './model.ts';
import { andList, toolNames as names } from './words.ts';
import type { HarnessId, InstalledPlugin, PartKind, PluginItem } from './types.ts';

/** One item in one tool, through the plugin as that tool has it installed. `name`: the item's own name in the plugin. */
export interface PluginItemAt { kind: PartKind; name: string; tool: HarnessId; install: InstalledPlugin }
type Part = Pick<PluginItem, 'kind' | 'name'>;

/**
 * Whether the tool turns one item of this kind on and off by itself: a skill where the tool has a switch for one skill of a
 * plugin (not Claude Code), an MCP server in every tool that takes plugins, an agent in Claude Code.
 */
export const hasOwnSwitch = (tool: HarnessId, kind: PartKind) => (kind === 'skill' ? !NO_SKILL_SWITCH[tool] : hasPartSwitch(tool, kind));
export const ownSwitch = (item: PluginItemAt) => hasOwnSwitch(item.tool, item.kind);

const where = (item: PluginItemAt) => ({ source: item.install.source ?? '', marketName: item.install.marketName, plugin: item.install.plugin, tool: item.tool });
/** The plugin's items in that tool that have a switch of their own. */
const switchable = (install: InstalledPlugin): Part[] => install.items.filter(entry => hasOwnSwitch(install.tool, entry.kind));
/** Whether the tool has this one item's own switch off now. */
const itemOffNow = (install: InstalledPlugin, part: Part) => !!{ skill: install.skillsOff, mcp: install.serversOff, agent: install.agentsOff }[part.kind]?.some(name => samePart(part, { kind: part.kind, name }));

/** Whether the whole plugin is off in the item's tool after Apply all. */
const wholeOffAfter = (draft: PluginDraft, item: PluginItemAt) => {
  const chosen = queuedWhole(draft, where(item).source, item.install.plugin, item.tool);
  return chosen ? chosen === 'plugin-off' : !!item.install.off;
};
/** Whether one item of the plugin has its own switch off in the item's tool after Apply all. */
const itemOffAfter = (draft: PluginDraft, item: PluginItemAt, part: Part) => {
  const { source, plugin, tool } = where(item);
  const chosen = part.kind === 'skill' ? queued(draft, source, plugin, tool, part.name) : queuedPart(draft, source, plugin, tool, part);
  return chosen ? chosen === 'skill-off' || chosen === 'part-off' : itemOffNow(item.install, part);
};

/** Where the item stands in its tool: on now, and on after Apply all. */
export function standing(draft: PluginDraft, item: PluginItemAt): { now: boolean; on: boolean } {
  const own = ownSwitch(item);
  return {
    now: !item.install.off && !(own && itemOffNow(item.install, item)),
    on: !wholeOffAfter(draft, item) && !(own && itemOffAfter(draft, item, item)),
  };
}

/**
 * Why this item can't be switched here, if it can't: the tool's skill switches are in a form not edited here, the skill is
 * held off by a switch that isn't this plugin's own, or Copilot CLI's command line can't take the skill's name. (A plugin
 * whose marketplace the tool no longer lists is switched all the same: the tool still loads it, and has no other
 * marketplace of that name to mistake it for.)
 */
export function cantSwitch(item: PluginItemAt): string | undefined {
  if (item.kind !== 'skill' || !ownSwitch(item)) return undefined;
  return item.install.switchesHeld ?? item.install.skillsHeld?.[item.name] ?? noSwitchReason(item.tool, undefined, item.name);
}

/**
 * Turns the item on or off in its tool on Apply all, or takes that choice back:
 * - an item with its own switch flips that switch; where the whole plugin is off, the plugin goes on with the switch of
 *   every other item that has one turned off, so only this one comes on; turning that one off again puts it all back as it was;
 * - anything else flips the whole plugin there, with everything it brings.
 */
export function click(draft: PluginDraft, item: PluginItemAt): void {
  const at = where(item);
  const install = item.install;
  const others = ownSwitch(item) ? switchable(install).filter(part => !samePart(part, item)) : [];
  const setItem = (part: Part, off: boolean) => {
    const op: PluginOp = part.kind === 'skill' ? { ...at, skill: part.name, action: off ? 'skill-off' : 'skill-on' } : { ...at, part: { kind: part.kind, name: part.name }, action: off ? 'part-off' : 'part-on' };
    if (off === itemOffNow(install, part)) clear(draft, op); else choose(draft, op);
  };
  const setWhole = (off: boolean) => {
    const op: PluginOp = { ...at, action: off ? 'plugin-off' : 'plugin-on' };
    if (off === !!install.off) clear(draft, op); else choose(draft, op);
  };
  if (standing(draft, item).on) {
    if (!ownSwitch(item)) { setWhole(true); return; }
    setItem(item, true);
    // A plugin turned on only for items that are now all off again goes back as it was, with each item's switch.
    if (install.off && !wholeOffAfter(draft, item) && others.every(part => itemOffAfter(draft, item, part))) {
      setWhole(true);
      for (const part of [...others, item]) setItem(part, itemOffNow(install, part));
    }
    return;
  }
  if (wholeOffAfter(draft, item)) {
    setWhole(false);
    // A plugin that is off now comes on for this item alone; one only chosen to go off just stays on, as it is.
    if (install.off) for (const part of others) if (!itemOffAfter(draft, item, part)) setItem(part, true);
  }
  if (ownSwitch(item) && itemOffAfter(draft, item, item)) setItem(item, false);
}

/**
 * Drops choices that mean nothing now, so none is counted or run unseen: the plugin is no longer installed in that tool,
 * or the plugin, the skill, the MCP server or the agent already is as chosen there.
 */
export function prune(draft: PluginDraft, installs: InstalledPlugin[]): void {
  for (const [key, op] of draft) {
    const install = installs.find(entry => entry.tool === op.tool && entry.plugin === op.plugin && entry.marketName === op.marketName);
    const part: Part | undefined = op.part ?? (op.skill ? { kind: 'skill', name: op.skill } : undefined);
    const off = op.action === 'plugin-off' || op.action === 'skill-off' || op.action === 'part-off';
    if (!install || (part ? itemOffNow(install, part) : !!install.off) === off) draft.delete(key);
  }
}

/** A list of the plugin's items by kind, in words: "2 skills and 1 MCP server", or ''. */
const counted = (items: Part[]) => andList((['skill', 'mcp', 'agent'] as PartKind[]).flatMap(kind => {
  const n = items.filter(entry => entry.kind === kind).length;
  return n ? [n === 1 ? `1 ${partWords[kind][0]}` : `${n} ${partWords[kind][1]}`] : [];
}));

/** What a click on the item's box does, as the sentence after its state ("Click to turn it off in Codex on Apply all."). */
export function clickWords(draft: PluginDraft, item: PluginItemAt): string {
  const tool = names[item.tool];
  const plugin = item.install.plugin;
  const { now, on } = standing(draft, item);
  if (on !== now) return `${on ? 'Turned on' : 'Turned off'} in ${tool} on Apply all. Click to leave it ${now ? 'on' : 'off'}.`;
  const rest = item.install.items.filter(entry => !samePart(entry, item));
  if (on && ownSwitch(item)) return `Click to turn it off in ${tool} on Apply all.`;
  if (on) return `${item.kind === 'skill' ? `${tool} has no switch for one skill of a plugin. ` : item.kind === 'agent' ? `${tool} has no switch for one agent of a plugin. ` : ''}Click to turn the whole plugin ${plugin} off in ${tool} on Apply all${rest.length ? `, with its ${counted(rest)}` : ''}.`;
  if (!wholeOffAfter(draft, item)) return `Click to turn it on in ${tool} on Apply all.`;
  if (ownSwitch(item)) {
    // What comes on beside this item: whatever the plugin brings that has no switch of its own there.
    const brought = rest.filter(entry => !hasOwnSwitch(item.tool, entry.kind));
    return `The whole plugin ${plugin} is off in ${tool}. Click to turn it on there on Apply all with only this ${partWords[item.kind][0]} on${brought.length ? `; its ${counted(brought)} ${brought.length === 1 ? 'comes' : 'come'} on too` : ''}.`;
  }
  return `The whole plugin ${plugin} is off in ${tool}. Click to turn it on there on Apply all${rest.length ? `, with its ${counted(rest)}` : ''}.`;
}

/** The item's switch in words, for the line beside it: what Apply all will do, or '' when nothing waits. */
export function pendingWords(draft: PluginDraft, item: PluginItemAt): string {
  const { now, on } = standing(draft, item);
  if (on === now) return '';
  const whole = queuedWhole(draft, where(item).source, item.install.plugin, item.tool);
  const others = whole && !ownSwitch(item) ? item.install.items.filter(entry => !samePart(entry, item)) : [];
  return `${on ? 'Turned on' : 'Turned off'} on Apply all${others.length ? `, with the whole plugin (${plural(others.length, 'other item')})` : ''}.`;
}

/**
 * The whole plugins a draft turns off or on, in words for the change bar ("the whole plugin full off in Claude Code"),
 * so a click on one item's box that takes the whole plugin with it is said before Apply all. A plugin that comes on for
 * single items, its others held off, is left out: its items say it.
 */
export function wholeWords(draft: PluginDraft): string[] {
  const ops = [...draft.values()];
  const held = (whole: PluginOp) => ops.some(op => op.source === whole.source && op.plugin === whole.plugin && op.tool === whole.tool && (op.action === 'skill-off' || op.action === 'part-off'));
  return ops.filter(op => op.action === 'plugin-off' || (op.action === 'plugin-on' && !held(op))).map(op => `the whole plugin ${op.plugin} ${op.action === 'plugin-off' ? 'off' : 'on'} in ${names[op.tool]}`);
}
