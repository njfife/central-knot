// The Skills, MCP servers and Agents pages' switch for an item a tool has through an installed plugin: the item's own
// switch where the tool has one (a skill in Copilot CLI or Codex, ENB-06; an MCP server in Claude Code, Copilot CLI or
// Codex and an agent in Claude Code, partswitch.ts), else the whole plugin's. A click applies at once: it is worked out as
// the plugin choices it needs (pluginplan), which run, report and undo like the Plugins page's.
// Pure functions over plain data; the page draws and applies.
import { choose, clear, queued, queuedPart, queuedWhole, wholeChoice, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { NO_SKILL_SWITCH, hasPartSwitch, noSwitchReason, partWords, samePart } from './pluginstatus.ts';
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

/** Whether the whole plugin is off in the item's tool once the draft runs. */
const wholeOffAfter = (draft: PluginDraft, item: PluginItemAt) => {
  const chosen = queuedWhole(draft, where(item).source, item.install.plugin, item.tool);
  return chosen ? chosen === 'plugin-off' : !!item.install.off;
};
/** Whether one item of the plugin has its own switch off in the item's tool once the draft runs. */
const itemOffAfter = (draft: PluginDraft, item: PluginItemAt, part: Part) => {
  const { source, plugin, tool } = where(item);
  const chosen = part.kind === 'skill' ? queued(draft, source, plugin, tool, part.name) : queuedPart(draft, source, plugin, tool, part);
  return chosen ? chosen === 'skill-off' || chosen === 'part-off' : itemOffNow(item.install, part);
};

/** Where the item stands in its tool: on now, and on once the draft runs. */
export function standing(draft: PluginDraft, item: PluginItemAt): { now: boolean; on: boolean } {
  return { now: onNow(item), on: !wholeOffAfter(draft, item) && !(ownSwitch(item) && itemOffAfter(draft, item, item)) };
}

/** Whether the item is on in its tool now: the plugin is on there, and its own switch (where it has one) hasn't turned it off. */
export const onNow = (item: PluginItemAt) => !item.install.off && !(ownSwitch(item) && itemOffNow(item.install, item));

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
 * The plugin choices that turn the item on or off in its tool, added to `draft` (or, clicked again before they run, taken back).
 * Each click changes the clicked item:
 * - an item with its own switch flips that switch. Where the whole plugin is off, the plugin goes on for it, with the
 *   switch of every other item that has one turned off, so only this one comes on (and whatever of the plugin has no
 *   switch there). Once the items it came on for are all off again, the plugin stays off and it is all back as it was;
 * - anything else flips the whole plugin there, with everything it brings.
 * Worked out as where things stand once it runs (the whole plugin, and each item with a switch of its own), which the
 * draft is then made to say: a choice is kept only where that differs from how the tool has it now.
 */
export function click(draft: PluginDraft, item: PluginItemAt): void {
  const at = where(item);
  const install = item.install;
  const parts = switchable(install);
  const mine = parts.find(part => samePart(part, item));
  let wholeOff = wholeOffAfter(draft, item);
  // Whether the plugin is chosen to come on for single items (see PluginOp.forItems), not as a whole.
  let forItems = !!wholeChoice(draft, at.source, install.plugin, item.tool)?.forItems;
  const partOff = new Map(parts.map(part => [part, itemOffAfter(draft, item, part)]));
  if (standing(draft, item).on) {
    if (mine) partOff.set(mine, true); else wholeOff = true;
    // Nothing left that the plugin would come on for: the items it was chosen for are all off again, or everything it
    // brings is. It stays off, as it is.
    const offAfter = (entry: Part) => { const part = parts.find(candidate => samePart(candidate, entry)); return part ? !!partOff.get(part) : hasOwnSwitch(install.tool, entry.kind) && itemOffNow(install, entry); };
    if (install.off && ((forItems && parts.every(part => partOff.get(part))) || install.items.every(offAfter))) wholeOff = true;
  } else {
    // A plugin that is off now comes on for this item alone: its other items that have a switch are held off.
    if (wholeOff && install.off) { forItems = !!mine; if (mine) for (const part of parts) partOff.set(part, true); }
    wholeOff = false;
    if (mine) partOff.set(mine, false);
  }
  // While the plugin is off once it runs, no item's own switch shows or matters: none is left chosen unseen.
  if (wholeOff) for (const part of parts) partOff.set(part, itemOffNow(install, part));
  const put = (op: PluginOp, differs: boolean) => { if (differs) choose(draft, op); else clear(draft, op); };
  put({ ...at, action: wholeOff ? 'plugin-off' : 'plugin-on', ...(forItems && !wholeOff ? { forItems: true as const } : {}) }, wholeOff !== !!install.off);
  for (const [part, off] of partOff) {
    put(part.kind === 'skill' ? { ...at, skill: part.name, action: off ? 'skill-off' : 'skill-on' } : { ...at, part: { kind: part.kind, name: part.name }, action: off ? 'part-off' : 'part-on' }, off !== itemOffNow(install, part));
  }
}

/**
 * A main switch's part for one item in every tool that has it through a plugin, toward `on`: each turns with that tool's own
 * switch for one item (click; `turned`). A tool with no such switch (a skill in Claude Code) is left as it is and said plainly
 * (`whole`, `limit`): the main switch never turns a whole plugin off; that is the tool's own switch. One whose switch can't be
 * written is left too, and said as a problem (`left`). `leftIn`: every tool left.
 */
export function turnEvery(items: PluginItemAt[], on: boolean): { draft: PluginDraft; ops: PluginOp[]; turned: PluginItemAt[]; whole: PluginItemAt[]; limit?: string; left?: string; leftIn: HarnessId[] } {
  const draft: PluginDraft = new Map();
  const turned: PluginItemAt[] = [];
  const whole: PluginItemAt[] = [];
  const left: string[] = [];
  for (const item of items.filter(entry => standing(draft, entry).now !== on)) {
    const held = cantSwitch(item);
    if (!held && ownSwitch(item)) { click(draft, item); turned.push(item); continue; }
    if (held) left.push(`Still ${on ? 'off' : 'on'} in ${names[item.tool]}: ${held}`); else whole.push(item);
  }
  const limit = whole.map(item => `Still ${on ? 'off' : 'on'} in ${names[item.tool]}: it has no switch for one ${partWords[item.kind][0]} of a plugin, only one for the whole plugin, ${item.install.plugin}.`).join(' ');
  const leftIn = items.filter(item => !turned.includes(item) && onNow(item) !== on).map(item => item.tool);
  return { draft, ops: [...draft.values()], turned, whole, limit: limit || undefined, left: left.join(' ') || undefined, leftIn };
}

/** One of a plugin's items by name, as a result says it: a skill's own name, or "MCP server issues". */
const named = (op: PluginOp) => (op.part ? `${partWords[op.part.kind][0]} ${op.part.name}` : op.skill!);

/**
 * What a click's choices (`ops`, all run) brought with one item in its tool, after the item's own sentence: "Its plugin
 * issue-tracker was turned on there, with triage left off.", "Its whole plugin document-tools was turned off there, with its 2
 * other skills."; '' where only the item's own switch turned. `there`: said in place of the tool's name.
 */
export function alongWords(item: PluginItemAt, ops: PluginOp[], there = false): string {
  const whole = ops.find(op => op.tool === item.tool && op.plugin === item.install.plugin && (op.action === 'plugin-on' || op.action === 'plugin-off'));
  if (!whole) return '';
  const where = there ? 'there' : `in ${names[item.tool]}`;
  if (whole.forItems) {
    const leftOff = ops.filter(op => op.tool === whole.tool && op.plugin === whole.plugin && (op.action === 'skill-off' || op.action === 'part-off')).map(named);
    return `Its plugin ${item.install.plugin} was turned on ${where}${leftOff.length ? `, with ${andList(leftOff)} left off` : ''}.`;
  }
  const rest = item.install.items.filter(entry => !samePart(entry, item) && !(hasOwnSwitch(item.tool, entry.kind) && itemOffNow(item.install, entry)));
  return `Its whole plugin ${item.install.plugin} was turned ${whole.action === 'plugin-on' ? 'on' : 'off'} ${where}${rest.length ? `, with its ${counted(rest, item.kind)}` : ''}.`;
}

/** A click on one item's switch in its tool, said once its choices (`ops`) all ran: the item first ("issues is on in Codex."), then what came with it. */
export const itemSaid = (item: PluginItemAt, on: boolean, ops: PluginOp[]) => [`${item.name} is ${on ? 'on' : 'off'} in ${names[item.tool]}.`, alongWords(item, ops, true)].filter(Boolean).join(' ');

/** A list of the plugin's items by kind, in words: "2 skills and 1 MCP server", or ''. `beside`: the kind of the item they are counted beside, said as "1 other MCP server". */
const counted = (items: Part[], beside?: PartKind) => andList((['skill', 'mcp', 'agent'] as PartKind[]).flatMap(kind => {
  const n = items.filter(entry => entry.kind === kind).length;
  return n ? [`${n} ${kind === beside ? 'other ' : ''}${partWords[kind][n === 1 ? 0 : 1]}`] : [];
}));

/** What a click on the item's switch does, as the sentence after its state ("Click to turn it off in Codex."). */
export function clickWords(item: PluginItemAt): string {
  const tool = names[item.tool];
  const plugin = item.install.plugin;
  const on = onNow(item);
  // What else of the plugin is on there now: what its own switch already keeps off neither goes with it nor comes back with it.
  const rest = item.install.items.filter(entry => !samePart(entry, item) && !(hasOwnSwitch(item.tool, entry.kind) && itemOffNow(item.install, entry)));
  // Copilot CLI's switch for a server goes by its bare name, whoever's server it is.
  const byName = (way: string) => (item.kind === 'mcp' && item.tool === 'copilot-cli' ? ` Copilot CLI goes by the name, so any other server named “${item.name}” there goes ${way} too.` : '');
  if (on && ownSwitch(item)) return `Click to turn it off in ${tool}.${byName('off')}`;
  if (on) return `${tool} has no switch for one ${partWords[item.kind][0]} of a plugin. Click to turn the whole plugin ${plugin} off in ${tool}${rest.length ? `, with its ${counted(rest)}` : ''}.`;
  if (!item.install.off) return `Click to turn it on in ${tool}.${byName('on')}`;
  if (ownSwitch(item)) {
    // What comes on beside this item: whatever the plugin brings that can't be held off there (no switch of its own, or
    // one that can't be written), and isn't off by its own switch already.
    const held = switchable(item.install);
    const brought = rest.filter(entry => !held.some(part => samePart(part, entry)));
    return `Click to turn the plugin ${plugin} on in ${tool} with only this ${partWords[item.kind][0]} on${brought.length ? `; its ${counted(brought, item.kind)} ${brought.length === 1 ? 'comes' : 'come'} on too` : ''}.`;
  }
  return `Click to turn the whole plugin ${plugin} on in ${tool}${rest.length ? `, with its ${counted(rest)}` : ''}.`;
}

/** The line beside the item's switch where the tool has none for one item: that its switch is the whole plugin's there; else ''. */
export function switchWords(item: PluginItemAt): string {
  if (ownSwitch(item) || cantSwitch(item)) return '';
  return `${names[item.tool]} has no switch for one ${partWords[item.kind][0]} of a plugin, so this switch turns the whole plugin ${onNow(item) ? 'off' : 'on'} there.`;
}

