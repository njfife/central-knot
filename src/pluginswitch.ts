// The Skills, MCP servers and Agents pages' switch for an item a tool has through an installed plugin: the item's own
// switch where the tool has one (a skill in Copilot CLI or Codex, ENB-06), else the whole plugin's. A click is a choice for
// Apply all, kept in the page's own plugin draft (pluginplan), so it runs, reports and undoes like the Plugins page's.
// Pure functions over plain data; the page draws and applies.
import { choose, clear, queued, queuedWhole, type PluginDraft, type PluginOp } from './pluginplan.ts';
import { NO_SKILL_SWITCH, noSwitchReason, samePart } from './pluginstatus.ts';
import { andList, toolNames as names } from './words.ts';
import type { HarnessId, InstalledPlugin, PartKind } from './types.ts';

/** One item in one tool, through the plugin as that tool has it installed. `name`: the item's own name in the plugin. */
export interface PluginItemAt { kind: PartKind; name: string; tool: HarnessId; install: InstalledPlugin }

/** Whether the tool turns this one item on and off by itself: a skill, where the tool has a switch for one skill of a plugin. */
export const ownSwitch = (item: PluginItemAt) => item.kind === 'skill' && !NO_SKILL_SWITCH[item.tool];

const where = (item: PluginItemAt) => ({ source: item.install.source ?? '', marketName: item.install.marketName, plugin: item.install.plugin, tool: item.tool });
const skillsOf = (install: InstalledPlugin) => install.items.filter(entry => entry.kind === 'skill').map(entry => entry.name);
const sameSkill = (first: string, second: string) => samePart({ kind: 'skill', name: first }, { kind: 'skill', name: second });
const skillOffNow = (install: InstalledPlugin, skill: string) => !!install.skillsOff?.some(name => sameSkill(name, skill));

/** Whether the whole plugin is off in the item's tool after Apply all. */
const wholeOffAfter = (draft: PluginDraft, item: PluginItemAt) => {
  const chosen = queuedWhole(draft, where(item).source, item.install.plugin, item.tool);
  return chosen ? chosen === 'plugin-off' : !!item.install.off;
};
/** Whether one skill of the plugin has its own switch off in the item's tool after Apply all. */
const skillOffAfter = (draft: PluginDraft, item: PluginItemAt, skill: string) => {
  const chosen = queued(draft, where(item).source, item.install.plugin, item.tool, skill);
  return chosen ? chosen === 'skill-off' : skillOffNow(item.install, skill);
};

/** Where the item stands in its tool: on now, and on after Apply all. */
export function standing(draft: PluginDraft, item: PluginItemAt): { now: boolean; on: boolean } {
  const skill = item.kind === 'skill';
  return {
    now: !item.install.off && !(skill && skillOffNow(item.install, item.name)),
    on: !wholeOffAfter(draft, item) && !(skill && skillOffAfter(draft, item, item.name)),
  };
}

/**
 * Why this item can't be switched here, if it can't: the tool's record of where it has the marketplace from is missing (each
 * switch checks the plugin is still the one from there), or Copilot CLI's command line can't take the skill's name.
 */
export function cantSwitch(item: PluginItemAt): string | undefined {
  if (!item.install.source) return `${names[item.tool]}’s record of where it has the marketplace “${item.install.marketName}” from couldn’t be read, so it can’t be switched here.`;
  return ownSwitch(item) ? noSwitchReason(item.tool, undefined, item.name) : undefined;
}

/**
 * Turns the item on or off in its tool on Apply all, or takes that choice back:
 * - a skill with its own switch flips that switch; where the whole plugin is off, the plugin goes on with its other skills'
 *   switches turned off, so only this one comes on; turning that one off again puts it all back as it was;
 * - anything else flips the whole plugin there, with everything it brings.
 */
export function click(draft: PluginDraft, item: PluginItemAt): void {
  const at = where(item);
  const install = item.install;
  const skills = ownSwitch(item) ? skillsOf(install) : [];
  const setSkill = (skill: string, off: boolean) => {
    const op: PluginOp = { ...at, skill, action: off ? 'skill-off' : 'skill-on' };
    if (off === skillOffNow(install, skill)) clear(draft, op); else choose(draft, op);
  };
  const setWhole = (off: boolean) => {
    const op: PluginOp = { ...at, action: off ? 'plugin-off' : 'plugin-on' };
    if (off === !!install.off) clear(draft, op); else choose(draft, op);
  };
  if (standing(draft, item).on) {
    if (!ownSwitch(item)) { setWhole(true); return; }
    setSkill(item.name, true);
    // A plugin turned on only for skills that are now all off again goes back as it was, with each skill's switch.
    if (install.off && !wholeOffAfter(draft, item) && skills.every(skill => skillOffAfter(draft, item, skill))) {
      setWhole(true);
      for (const skill of skills) clear(draft, { ...at, skill });
    }
    return;
  }
  if (wholeOffAfter(draft, item)) {
    setWhole(false);
    for (const skill of skills) if (!sameSkill(skill, item.name) && !skillOffAfter(draft, item, skill)) setSkill(skill, true);
  }
  if (ownSwitch(item) && skillOffAfter(draft, item, item.name)) setSkill(item.name, false);
}

const kindWord: Record<PartKind, string> = { skill: 'skill', mcp: 'MCP server', agent: 'agent' };
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What else the plugin brings in that tool besides this item, in words ("2 skills and 1 MCP server"), or ''. */
function othersIn(item: PluginItemAt): string {
  const rest = item.install.items.filter(entry => !(entry.kind === item.kind && samePart(entry, { kind: item.kind, name: item.name })));
  const by = (kind: PartKind) => rest.filter(entry => entry.kind === kind).length;
  return andList((['skill', 'mcp', 'agent'] as PartKind[]).filter(kind => by(kind)).map(kind => count(by(kind), kindWord[kind])));
}

/** What a click on the item's box does, as the sentence after its state ("Click to turn it off in Codex on Apply all."). */
export function clickWords(draft: PluginDraft, item: PluginItemAt): string {
  const tool = names[item.tool];
  const { now, on } = standing(draft, item);
  if (on !== now) return `${on ? 'Turned on' : 'Turned off'} in ${tool} on Apply all. Click to leave it ${now ? 'on' : 'off'}.`;
  const others = othersIn(item);
  if (on && ownSwitch(item)) return `Click to turn it off in ${tool} on Apply all.`;
  if (on) return `${item.kind === 'skill' ? `${tool} has no switch for one skill of a plugin. ` : ''}Click to turn the whole plugin ${item.install.plugin} off in ${tool} on Apply all${others ? `, with its ${others}` : ''}.`;
  if (!wholeOffAfter(draft, item)) return `Click to turn it on in ${tool} on Apply all.`;
  if (ownSwitch(item)) {
    const brought = item.install.items.filter(entry => entry.kind !== 'skill').length;
    return `The whole plugin ${item.install.plugin} is off in ${tool}. Click to turn it on there on Apply all with only this skill on${brought ? `; its ${othersIn({ ...item, install: { ...item.install, items: item.install.items.filter(entry => entry.kind !== 'skill') } })} ${brought === 1 ? 'comes' : 'come'} on too` : ''}.`;
  }
  return `The whole plugin ${item.install.plugin} is off in ${tool}. Click to turn it on there on Apply all${others ? `, with its ${others}` : ''}.`;
}
