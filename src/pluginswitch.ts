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
/**
 * Why an item's own switch can't be written in that tool, if it can't: Codex sets the plugin's MCP servers, or its skill
 * rules, in a form not edited here; the skill is held off by a switch that isn't this plugin's own; or Copilot CLI's
 * command line can't take the skill's name.
 */
const switchHeld = (install: InstalledPlugin, part: Part): string | undefined => (part.kind === 'mcp' ? install.serversHeld?.[part.name]
  : part.kind === 'skill' ? install.switchesHeld ?? install.skillsHeld?.[part.name] ?? noSwitchReason(install.tool, undefined, part.name) : undefined);
/** The plugin's items in that tool whose own switch can be written: those are held off when the plugin comes on for one item. */
const switchable = (install: InstalledPlugin): Part[] => install.items.filter(entry => hasOwnSwitch(install.tool, entry.kind) && !switchHeld(install, entry));
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

/** Why Copilot CLI's whole-plugin switch isn't offered for a plugin it loads live from a folder. */
export const LIVE_PLUGIN = 'Copilot CLI loads this plugin live from a folder, where turning it off is the same as uninstalling it. Uninstall it on the plugin’s page instead.';

/**
 * Why this item can't be switched here, if it can't: its own switch can't be written (switchHeld), or the whole plugin
 * would go, in Copilot CLI, where it is loaded live from a folder. (A plugin whose marketplace the tool no longer lists is switched all the same: the tool
 * still loads it, and has no other marketplace of that name to mistake it for.)
 */
export function cantSwitch(item: PluginItemAt): string | undefined {
  if (!ownSwitch(item)) return item.tool === 'copilot-cli' && item.install.live ? LIVE_PLUGIN : undefined;
  return switchHeld(item.install, item);
}

/**
 * Turns the item on or off in its tool on Apply all, or takes that choice back:
 * - an item with its own switch flips that switch; where the whole plugin is off, the plugin goes on with the switch of
 *   every other item that has one turned off, so only this one comes on; turning that one off again, with nothing of the
 *   plugin left to come on, puts it all back as it was;
 * - anything else flips the whole plugin there, with everything it brings.
 * Worked out as where things stand after Apply all (the whole plugin, and each item with a switch of its own), which the
 * draft is then made to say: a choice is kept only where that differs from how the tool has it now.
 */
export function click(draft: PluginDraft, item: PluginItemAt): void {
  const at = where(item);
  const install = item.install;
  const parts = switchable(install);
  const mine = parts.find(part => samePart(part, item));
  let wholeOff = wholeOffAfter(draft, item);
  const partOff = new Map(parts.map(part => [part, itemOffAfter(draft, item, part)]));
  if (standing(draft, item).on) {
    if (mine) partOff.set(mine, true); else wholeOff = true;
    // A plugin that would come on with nothing of it on (every item off again by its own switch) stays off, as it is.
    // Where something of it has no switch there (its skills in Claude Code), that still comes on, and the plugin with it.
    const offAfter = (entry: Part) => { const part = parts.find(candidate => samePart(candidate, entry)); return part ? !!partOff.get(part) : hasOwnSwitch(install.tool, entry.kind) && itemOffNow(install, entry); };
    if (install.off && install.items.every(offAfter)) wholeOff = true;
  } else {
    // A plugin that is off now comes on for this item alone: its other items that have a switch are held off.
    if (wholeOff && install.off && mine) for (const part of parts) partOff.set(part, true);
    wholeOff = false;
    if (mine) partOff.set(mine, false);
  }
  // While the plugin stays off as it is, no item's own switch shows or matters: none is left chosen unseen.
  if (wholeOff && install.off) for (const part of parts) partOff.set(part, itemOffNow(install, part));
  const put = (op: PluginOp, differs: boolean) => { if (differs) choose(draft, op); else clear(draft, op); };
  put({ ...at, action: wholeOff ? 'plugin-off' : 'plugin-on' }, wholeOff !== !!install.off);
  for (const [part, off] of partOff) {
    put(part.kind === 'skill' ? { ...at, skill: part.name, action: off ? 'skill-off' : 'skill-on' } : { ...at, part: { kind: part.kind, name: part.name }, action: off ? 'part-off' : 'part-on' }, off !== itemOffNow(install, part));
  }
}

/**
 * Drops choices that mean nothing now, so none is counted or run unseen: the plugin is no longer installed in that tool,
 * or the plugin, the skill, the MCP server or the agent already is as chosen there (and with a plugin that already is on,
 * the items that were to be left off when it came on).
 */
export function prune(draft: PluginDraft, installs: InstalledPlugin[]): void {
  const sameWhere = (first: PluginOp, second: PluginOp) => first.source === second.source && first.plugin === second.plugin && first.tool === second.tool;
  for (const [key, op] of draft) {
    const install = installs.find(entry => entry.tool === op.tool && entry.plugin === op.plugin && entry.marketName === op.marketName);
    const part: Part | undefined = op.part ?? (op.skill ? { kind: 'skill', name: op.skill } : undefined);
    const off = op.action === 'plugin-off' || op.action === 'skill-off' || op.action === 'part-off';
    if (install && (part ? itemOffNow(install, part) : !!install.off) !== off) continue;
    draft.delete(key);
    // A plugin that was to come on, and already is: the items chosen to be left off with it go too, since they may be
    // ones nobody clicked (held off so that one item came on alone).
    if (op.action === 'plugin-on') for (const [other, held] of draft) if (sameWhere(held, op) && (held.action === 'skill-off' || held.action === 'part-off')) draft.delete(other);
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
  // What else of the plugin is on there now: what its own switch already keeps off neither goes with it nor comes back with it.
  const rest = item.install.items.filter(entry => !samePart(entry, item) && !(hasOwnSwitch(item.tool, entry.kind) && itemOffNow(item.install, entry)));
  // Copilot CLI's switch for a server goes by its bare name, whoever's server it is.
  const byName = (way: string) => (item.kind === 'mcp' && item.tool === 'copilot-cli' ? ` Copilot CLI goes by the name, so any other server named “${item.name}” there goes ${way} too.` : '');
  if (on && ownSwitch(item)) return `Click to turn it off in ${tool} on Apply all.${byName('off')}`;
  if (on) return `${tool} has no switch for one ${partWords[item.kind][0]} of a plugin. Click to turn the whole plugin ${plugin} off in ${tool} on Apply all${rest.length ? `, with its ${counted(rest)}` : ''}.`;
  if (!wholeOffAfter(draft, item)) return `Click to turn it on in ${tool} on Apply all.${byName('on')}`;
  if (ownSwitch(item)) {
    // What comes on beside this item: whatever the plugin brings that can't be held off there (no switch of its own, or
    // one that can't be written), and isn't off by its own switch already.
    const held = switchable(item.install);
    const brought = rest.filter(entry => !held.some(part => samePart(part, entry)));
    return `Click to turn the plugin ${plugin} on in ${tool} on Apply all with only this ${partWords[item.kind][0]} on${brought.length ? `; its ${counted(brought)} ${brought.length === 1 ? 'comes' : 'come'} on too` : ''}.`;
  }
  return `Click to turn the whole plugin ${plugin} on in ${tool} on Apply all${rest.length ? `, with its ${counted(rest)}` : ''}.`;
}

/**
 * The item's switch in words, for the line beside it: what Apply all will do; or, with nothing waiting, that its switch is
 * the whole plugin's where the tool has none for one item; or ''.
 */
export function pendingWords(draft: PluginDraft, item: PluginItemAt): string {
  const { now, on } = standing(draft, item);
  if (on === now) return ownSwitch(item) || cantSwitch(item) ? '' : `${names[item.tool]} has no switch for one ${partWords[item.kind][0]} of a plugin, so this switch turns the whole plugin ${on ? 'off' : 'on'} there.`;
  const whole = queuedWhole(draft, where(item).source, item.install.plugin, item.tool);
  const rest = item.install.items.filter(entry => !samePart(entry, item) && !(hasOwnSwitch(item.tool, entry.kind) && itemOffNow(item.install, entry)));
  if (whole && !ownSwitch(item)) return `Apply all turns it ${on ? 'on' : 'off'}${rest.length ? `, with the whole plugin (${plural(rest.length, 'other item')})` : ''}.`;
  if (!(on && whole === 'plugin-on')) return `Apply all turns it ${on ? 'on' : 'off'}.`;
  // One item turned on in a plugin that is off: the plugin comes on, its other items' switches are written off, and
  // whatever of it can't be held off comes on too.
  const leftOff = rest.filter(entry => { const part = switchable(item.install).find(candidate => samePart(candidate, entry)); return !!part && itemOffAfter(draft, item, part); });
  const brought = rest.filter(entry => !switchable(item.install).some(part => samePart(part, entry)));
  return `Apply all turns it on: the plugin ${item.install.plugin} comes on${leftOff.length ? ` with its ${counted(leftOff)} left off` : ''}${brought.length ? `; its ${counted(brought)} ${brought.length === 1 ? 'comes' : 'come'} on too` : ''}.`;
}

/**
 * The plugins a draft turns off or on as a whole, in words for the change bar ("the whole plugin full off in Claude
 * Code"), so a click on one item's box that takes the plugin with it is said before Apply all. A plugin that comes on
 * with items of its own left off says how many ("the plugin full on in Codex with 2 items left off").
 */
export function wholeWords(draft: PluginDraft): string[] {
  const ops = [...draft.values()];
  const leftOff = (whole: PluginOp) => ops.filter(op => op.source === whole.source && op.plugin === whole.plugin && op.tool === whole.tool && (op.action === 'skill-off' || op.action === 'part-off')).length;
  return ops.filter(op => op.action === 'plugin-off' || op.action === 'plugin-on').map(op => {
    const held = op.action === 'plugin-on' ? leftOff(op) : 0;
    return held ? `the plugin ${op.plugin} on in ${names[op.tool]} with ${plural(held, 'item')} left off` : `the whole plugin ${op.plugin} ${op.action === 'plugin-off' ? 'off' : 'on'} in ${names[op.tool]}`;
  });
}
