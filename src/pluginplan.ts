// Plugins: the steps one click runs, their order, their words and their way back: for the Plugins page's clicks
// (pluginstate.ts applyPluginOps), a plugin's one switch (marketplaces.ts turn), the item lists' switches (app.ts) and the
// automatic updates (pluginupdates.ts). What a switch owes each tool is pluginrecord.ts's. Also the item lists' scratch for one
// click (PluginDraft). Pure functions over plain data, so a run can be read, tested and changed without the page or the engine.
import { partWords, toolSaid } from './pluginstatus.ts';
import type { ItemState } from './pluginlibrary.ts';
import type { PluginEntry } from './pluginrecord.ts';
import type { ActionReport, HarnessId, PartRef, PluginActionResult } from './types.ts';
import { andList, byToolOrder, toolNames as names } from './words.ts';

/**
 * Install, update or uninstall a plugin, turn one of its skills (ENB-06: skill-off, skill-on) or one of its MCP servers or
 * agents (part-off, part-on) off or back on, or turn the whole plugin off or back on in the tool's own settings (plugin-off,
 * plugin-on), in one tool. The Plugins page's clicks run update and a skill's switch; a plugin's switch runs install, plugin-on
 * and plugin-off; `remove` is only the Undo of a fresh install (uninstalling a cached copy, or turning a live Copilot CLI copy
 * off in marketplaces.ts undoTurn). The four items actions (isItems) are a plugin's items in Pi, OpenCode and Antigravity (pluginlibrary.ts).
 */
export type PluginAction = 'install' | 'update' | 'remove' | 'skill-off' | 'skill-on' | 'part-off' | 'part-on' | 'plugin-off' | 'plugin-on'
  | 'install-items' | 'remove-items' | 'update-items' | 'items-back';
/** A run on a plugin's items in Pi, OpenCode and Antigravity (pluginlibrary.ts), which an Undo reverses by their states (items-back), never by an opposite step. */
export const isItems = (action: PluginAction) => action === 'install-items' || action === 'remove-items' || action === 'update-items' || action === 'items-back';
/** One tool's change for one plugin from one marketplace. */
export interface PluginOp {
  /** The marketplace as added (its address). */
  source: string;
  /** The name its catalog gives it, as the tools write plugin@marketName. */
  marketName: string;
  plugin: string;
  tool: HarnessId;
  action: PluginAction;
  /** The skill a skill-off or skill-on switches, by its name. */
  skill?: string;
  /** The MCP server or agent a part-off or part-on switches, by its name in the plugin. */
  part?: PartRef;
  /**
   * On a plugin-on: chosen so that single items of a plugin that is off came on, its other items held off (pluginswitch.ts),
   * not by a click on something that takes the whole plugin. Once those items are all off again the choice has no reason left.
   */
  forItems?: true;
  /** On a `remove` op: undoing a fresh install of Copilot CLI's live copy turns it off, kept installed, rather than uninstalling it (plugins.ts install, marketplaces.ts undoTurn). */
  keptOff?: true;
  /** For items-back: each item as it was before the switch (pluginlibrary.ts ItemState). */
  items?: ItemState[];
}
/** One line of a run's result: a plugin and what happened to it ("installed in Codex"), or one tool's failure. */
export interface ResultLine {
  source: string;
  plugin: string;
  /** Set on a skill switch's line: its text starts with the skill's name. */
  skill?: string;
  /** Set on an MCP server's or agent's switch's line: its text starts with what it is and its name. */
  part?: PartRef;
  ok: boolean;
  text: string;
  /** The same with three or more tools counted, not named ("installed in 3 tools"), for a narrow place; a skill's tools are always named. */
  short: string;
}
/** What one op did, as its tool reported it. */
export interface PluginDone extends PluginOp { report: ActionReport }

/** One click's choices while the item lists work them out (pluginswitch.ts), keyed by marketplace source, plugin and tool. Nothing here has run. */
export type PluginDraft = Map<string, PluginOp>;

/** A failure for each tool of a step that could not run at all, so the report says so and Undo leaves it alone. */
export const failedFor = (tools: HarnessId[], message: string): ActionReport[] => tools.map(tool => ({ tool, outcome: 'failed', message, runs: [] }));

/** One plugin in one marketplace: two marketplaces may both offer a plugin with the same name. */
export const pluginKey = (source: string, plugin: string) => `${source}\u0000${plugin}`;
/** What names one choice among a tool's for a plugin: the plugin's own change by nothing, a switch by its skill, MCP server or agent. */
type OpSlot = Pick<PluginOp, 'source' | 'plugin' | 'tool' | 'skill' | 'part'> & { action?: PluginAction };
/** A plugin's own change in a tool, and the switch of each of its skills, MCP servers and agents there, are separate choices. */
const opKey = (op: OpSlot) => `${pluginKey(op.source, op.plugin)}\u0000${op.tool}\u0000${isWhole(op.action) ? WHOLE_SLOT : switchSlot(op)}`;
/** An item's switch's place among a tool's choices: a skill's name, or for an MCP server or agent its kind and name (no skill's name starts so). */
const switchSlot = (op: Pick<PluginOp, 'skill' | 'part'>) => (op.part ? `\u0001${op.part.kind}\u0000${op.part.name}` : op.skill ?? '');
/** The whole plugin's switch's place among a tool's choices: no skill has this name. */
const WHOLE_SLOT = '\u0001whole';
/** Whether an action is the whole plugin's own switch. */
export const isWhole = (action?: PluginAction) => action === 'plugin-on' || action === 'plugin-off';
/** Whether a plugin key (or a key made from one) belongs to this marketplace. */
export const forSource = (key: string, source: string) => key.startsWith(`${source}\u0000`);

/** In an item-page click's draft: the switch chosen for one skill of a plugin in a tool, if one is. */
export const chosenSkill = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId, skill: string) => draft.get(opKey({ source, plugin, tool, skill }))?.action;
/** In an item-page click's draft: the switch chosen for one MCP server or agent of a plugin in a tool, if one is. */
export const chosenPart = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId, part: PartRef) => draft.get(opKey({ source, plugin, tool, part }))?.action;
/** In an item-page click's draft: the whole plugin's switch chosen in a tool, if one is: the choice itself, and its action. */
export const wholeChoice = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId) => draft.get(opKey({ source, plugin, tool, action: 'plugin-on' }));
export const chosenWhole = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId) => wholeChoice(draft, source, plugin, tool)?.action;

/** Takes one choice back out of the draft. */
export const clear = (draft: PluginDraft, op: OpSlot) => { draft.delete(opKey(op)); };

/** Adds one choice to the draft, in place of any other in its place. */
export function choose(draft: PluginDraft, op: PluginOp): void {
  draft.set(opKey(op), op);
}

/** One step of a run: one tool command, apart from an install or update, which runs for every tool chosen at once. */
export interface Step { source: string; marketName: string; plugin: string; action: PluginAction; tools: HarnessId[]; skill?: string; part?: PartRef }

/**
 * Runs in a fixed, readable order: per plugin, installs first, then updates (each one command per tool set), then each
 * item's own switch (a skill's, an MCP server's, an agent's), then the whole plugin's switches (so a plugin turned on for one
 * item has its other items off before it loads), then removals, tool by tool.
 */
export function batches(ops: PluginOp[]): Step[] {
  const out: Step[] = [];
  const plugins = [...new Map(ops.map(op => [pluginKey(op.source, op.plugin), op])).values()];
  const one = (op: PluginOp): Step => ({ source: op.source, marketName: op.marketName, plugin: op.plugin, action: op.action, tools: [op.tool], ...(op.skill ? { skill: op.skill } : {}), ...(op.part ? { part: op.part } : {}) });
  for (const first of plugins) {
    const mine = ops.filter(op => op.source === first.source && op.plugin === first.plugin);
    for (const action of ['install', 'update', 'install-items', 'update-items'] as const) {
      const tools = mine.filter(op => op.action === action).map(op => op.tool);
      if (tools.length) out.push({ source: first.source, marketName: first.marketName, plugin: first.plugin, action, tools });
    }
    out.push(...mine.filter(op => isItemSwitch(op.action)).map(one), ...mine.filter(op => isWhole(op.action)).map(one), ...mine.filter(op => op.action === 'remove').map(one));
  }
  return out;
}

/** Whether an action is one item's own switch: a skill's, an MCP server's or an agent's. */
const isItemSwitch = (action: PluginAction) => action === 'skill-off' || action === 'skill-on' || action === 'part-off' || action === 'part-on';

const OPPOSITE: Partial<Record<PluginAction, PluginAction>> = { install: 'remove', remove: 'install', 'skill-off': 'skill-on', 'skill-on': 'skill-off', 'part-off': 'part-on', 'part-on': 'part-off', 'plugin-off': 'plugin-on', 'plugin-on': 'plugin-off' };

/**
 * The way back: only what this run really changed, reversed, last first (so each Codex skill switch is undone onto the
 * file it wrote, and its earlier bytes come back). "Already installed", failures and unknowns are left alone. An update has
 * no way back (the tools keep no earlier copy to return to), so it is left out; a plugin's items have theirs (items-back).
 */
export const reverse = (done: PluginDone[]): PluginOp[] => opposites(done
  .filter(entry => entry.report.changed && entry.action !== 'update' && !isItems(entry.action))
  .map(({ report, ...op }) => (op.action === 'install' && op.tool === 'copilot-cli' && report.live ? { ...op, keptOff: true as const } : op)));
/** Steps that changed, each turned the other way, last first: a profile's Undo of the steps History kept (profileplan.ts pluginUndo). */
export const opposites = (ops: PluginOp[]): PluginOp[] => ops.map(op => ({ ...op, action: OPPOSITE[op.action]! })).reverse();

/**
 * What a run left behind that nobody asked for: a plugin was to come on with other items held off, the items' switches
 * were written first (so the plugin never loads with them on) and then the plugin's own switch failed. Those held
 * switches, for the caller to put back.
 */
export const strayHolds = (done: PluginDone[]): PluginDone[] => done.filter(entry => (entry.action === 'skill-off' || entry.action === 'part-off') && entry.report.changed
  && done.some(whole => whole.action === 'plugin-on' && !succeeded(whole.report) && whole.source === entry.source && whole.plugin === entry.plugin && whole.tool === entry.tool));

/** A tool did what was asked (installed, updated, uninstalled, turned a skill, an MCP server, an agent or the plugin off or on), whether this run changed it or it already was. */
export const succeeded = (report: ActionReport) => report.outcome !== 'held' && report.outcome !== 'failed' && report.outcome !== 'not-known';

/**
 * One line per plugin (or per skill of it) and outcome, e.g. "document-tools: installed in Claude Code and Codex" or
 * "document-tools: pdf-reader turned off in Codex". What a tool already had is said as such ("already in Codex"), never
 * as a change this run made. An update names the version each tool records now and says plainly that it can't be undone.
 * For an Undo, the verbs say what came back: "removed from" for an install reversed, "put back
 * in" for an uninstall reversed, "back on in" for a skill turned off. `after`: for a note read later (an update made with
 * nobody watching), without "which can't be undone", which is said before a click.
 */
export function resultLines(ran: PluginDone[], undo = false, { after = false } = {}): ResultLine[] {
  const lines: ResultLine[] = [];
  // A plugin that came on with other items held off (one item turned on in a plugin that was off, pluginswitch.ts) is one
  // line, "turned on in Codex with triage left off", not a line more for each item held.
  const itemSaid = (entry: PluginDone) => (entry.part ? `${partWords[entry.part.kind][0]} ${entry.part.name}` : entry.skill!);
  // (Its Undo is the same the other way round: the plugin is off again, and the items' own switches going back say nothing more.)
  const heldWith = (whole: PluginDone) => (whole.action !== (undo ? 'plugin-off' : 'plugin-on') || !whole.report.changed ? []
    : ran.filter(entry => entry.source === whole.source && entry.plugin === whole.plugin && entry.tool === whole.tool && entry.report.changed
      && (undo ? entry.action === 'skill-on' || entry.action === 'part-on' : entry.action === 'skill-off' || entry.action === 'part-off')));
  const folded = new Set(ran.flatMap(heldWith));
  const done = ran.filter(entry => !folded.has(entry));
  const lineKey = (entry: PluginDone) => `${pluginKey(entry.source, entry.plugin)}\u0000${switchSlot(entry)}`;
  for (const key of new Set(done.map(lineKey))) {
    const mine = done.filter(entry => lineKey(entry) === key);
    const { plugin, source, skill, part } = mine[0]!;
    // A switch's line starts with the item it switched: the skill's name, or "MCP server" or "agent" and its name.
    const item = part ? `${partWords[part.kind][0]} ${part.name}` : skill;
    const named = { ...(skill ? { skill } : {}), ...(part ? { part } : {}) };
    // Tools in the page's column order, so "Codex and Pi" never reads "Pi and Codex" the next time.
    const tools = (outcome: ActionReport['outcome'], changed: boolean) => mine
      .filter(entry => entry.report.outcome === outcome && !!entry.report.changed === changed && !isItems(entry.action))
      .sort((first, second) => byToolOrder(first.tool, second.tool)).map(entry => names[entry.tool]);
    const [off, on] = part ? ['part-off', 'part-on'] as const : ['skill-off', 'skill-on'] as const;
    const onWith = undo ? [] : mine.filter(entry => heldWith(entry).length);
    // A plugin's items in Pi, OpenCode and Antigravity (pluginlibrary.ts): what each tool has of them now, said apart from installs.
    const itemRuns = (outcome: ActionReport['outcome'], changed: boolean) => mine.filter(entry => isItems(entry.action) && entry.report.outcome === outcome && !!entry.report.changed === changed)
      .sort((first, second) => byToolOrder(first.tool, second.tool));
    const items = (outcome: ActionReport['outcome'], changed: boolean) => itemRuns(outcome, changed).map(entry => names[entry.tool]);
    // What putting its items in or taking them out also changed in a tool's own settings (pluginlibrary.ts reportIn's notes) follows.
    const noted = (outcome: ActionReport['outcome']) => itemRuns(outcome, true).flatMap(entry => entry.report.notes ?? []).map(note => `; ${note.replace(/\.$/, '')}`).join('');
    const itemGroups: Group[] = [[items('installed', true), undo ? 'its items as they were in' : 'its items put in', noted('installed')], [items('uninstalled', true), undo ? 'its items as they were, out of' : 'its items taken out of', noted('uninstalled')],
      [items('updated', true), 'its items updated in', noted('updated')], [items('installed', false), 'its items already in'], [items('uninstalled', false), 'its items already out of'], [items('updated', false), 'its items already up to date in']];
    const turnedOff = mine.filter(entry => entry.action === 'remove' && entry.report.outcome === 'plugin-off' && !!entry.report.changed)
      .sort((first, second) => byToolOrder(first.tool, second.tool)).map(entry => names[entry.tool]);
    const offAgain = tools('plugin-off', true).filter(tool => !turnedOff.includes(tool));
    const groups: Group[] = item
      ? [[tools(off, true), undo ? `${item} off again in` : `${item} turned off in`], [tools(on, true), undo ? `${item} back on in` : `${item} turned on in`],
        [tools(off, false), `${item} already off in`], [tools(on, false), `${item} already on in`]]
      : [[tools('installed', true), undo ? 'put back in' : 'installed in'], ...updatedGroups(mine, !after), [tools('updated', false), 'already up to date in'], [tools('uninstalled', true), undo ? 'removed from' : 'uninstalled from'],
        [tools('installed', false), 'already in'], [tools('uninstalled', false), 'wasn’t installed in'],
        [offAgain, undo ? 'off again in' : 'turned off in'], [turnedOff, 'turned off in'], [tools('plugin-on', true).filter(tool => !onWith.some(entry => names[entry.tool] === tool)), undo ? 'back on in' : 'turned on in'],
        // Past three, the items left off are counted, not named.
        ...onWith.map((entry): Group => { const held = heldWith(entry); return [[names[entry.tool]], 'turned on in', ` with ${held.length > 3 ? `${held.length} items` : andList(held.map(itemSaid))} left off`]; }),
        [tools('plugin-off', false), 'already off in'], [tools('plugin-on', false), 'already on in'], ...itemGroups];
    // An item's switch only ever reaches the few tools that have one, so its tools are always named.
    const said = (counted: boolean) => groups.filter(([list]) => list.length).map(([list, verb, after = '']) => `${verb} ${counted && !item && list.length > 2 ? `${list.length} tools` : andList(list)}${after}`).join('; ');
    if (said(false)) lines.push({ source, plugin, ...named, ok: true, text: said(false), short: said(true) });
    for (const entry of mine.filter(candidate => !succeeded(candidate.report))) {
      const text = item ? `${names[entry.tool]}, ${item}: ${entry.report.message}` : toolSaid(entry.tool, entry.report.message);
      lines.push({ source, plugin, ...named, ok: false, text, short: text });
    }
    // A note on a step that worked (an update that couldn't turn a server off again, plugins.ts) needs reading, like a failure.
    for (const entry of mine.filter(candidate => succeeded(candidate.report) && candidate.report.notes?.length && !isItems(candidate.action))) {
      const text = `${names[entry.tool]}: ${entry.report.notes!.join(' ')}`;
      lines.push({ source, plugin, ok: false, text, short: text });
    }
  }
  return lines;
}

/** A result group: its tools, the words before them, and any after. */
type Group = [string[], string, string?];
/**
 * The tools an update changed, by the version each records now ("updated to 2.0.0 in Claude Code and Codex"), and apart
 * from those, the copies that differed at the same version, by how each was brought up to date ("updated to the
 * marketplace's copy of 1.2.0 in Codex", "reinstalled from the marketplace's copy of 1.2.0 in Claude Code"). The last
 * group says it can't be undone.
 */
function updatedGroups(mine: PluginDone[], warn = true): Group[] {
  const changed = mine.filter(entry => entry.report.outcome === 'updated' && entry.report.changed && !isItems(entry.action)).sort((first, second) => byToolOrder(first.tool, second.tool));
  const keyOf = (entry: PluginDone) => `${entry.report.byContent ?? ''}\u0000${entry.report.version ?? ''}`;
  const keys = [...new Set(changed.map(keyOf))];
  const firstPlain = keys.findIndex(key => key.startsWith('\u0000'));
  return keys.map((key, at): Group => {
    const [how, version] = key.split('\u0000') as [string, string];
    const copy = `the marketplace’s copy${version ? ` of ${version}` : ''}`;
    const verb = how === 'reinstall' ? `reinstalled from ${copy} in` : how === 'update' ? `updated to ${copy} in` : `${at === firstPlain ? 'updated ' : ''}${version ? `to ${version} ` : ''}in`;
    return [changed.filter(entry => keyOf(entry) === key).map(entry => names[entry.tool]), verb, warn && at === keys.length - 1 ? ', which can’t be undone' : undefined];
  });
}

/**
 * The successful lines as one sentence, in pieces (`short`: tools counted, for the toolbar; `here`: the plugin whose page is
 * open, named by its breadcrumb, so its lines leave its name out where it is the only plugin named): "document-tools: installed in Codex." or, for an Undo, "Undone:
 * document-tools removed from Codex." Each plugin is its own piece so the page can link it. Empty when nothing succeeded.
 */
export function resultParts(lines: ResultLine[], undo: boolean, { short = false, here }: { short?: boolean; here?: { plugin: string; source: string } } = {}): (string | { plugin: string; source: string })[] {
  const ok = lines.filter(line => line.ok);
  if (!ok.length) return [];
  const parts: (string | { plugin: string; source: string })[] = undo ? ['Undone: '] : [];
  // A sentence that names another plugin too names the open one as well, so each result is said once, by its plugin.
  if (ok.some(line => line.plugin !== here?.plugin || line.source !== here.source)) here = undefined;
  ok.forEach((line, at) => {
    const text = short ? line.short : line.text;
    if (at) parts.push('; ');
    // On the plugin's own page its name is already in the breadcrumb: "Installed in Codex." / "pdf-reader turned off in Codex."
    // Only a line that starts the sentence takes a capital, and never a skill's name.
    const opens = !at && !undo && !line.skill && !line.part;
    if (here?.plugin === line.plugin && here.source === line.source) parts.push(opens ? capitalized(text) : text);
    // "Undone: document-tools removed from Codex" reads on; a skill's line starts with the skill, so the plugin takes a colon.
    else parts.push({ plugin: line.plugin, source: line.source }, `${undo && !line.skill && !line.part ? ' ' : ': '}${text}`);
  });
  return [...parts, '.'];
}
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The plugins a run left undone, counted by marketplace and name, of all it was asked for: a failed line (one that went through
 * in another tool too) and, for a run that stopped, each plugin it never reached (LastRun unreached). What its result says first.
 */
export function shortOf(lines: ResultLine[], unreached: { source: string; plugin: string }[] = []) {
  const byKey = (list: { source: string; plugin: string }[]) => new Map(list.map(line => [pluginKey(line.source, line.plugin), line.plugin]));
  return { names: [...byKey([...lines.filter(line => !line.ok), ...unreached]).values()], of: byKey([...lines, ...unreached]).size };
}

/** The steps of a run that stopped before them: each operation, by plugin and tool, that left no report (LastRun unreached). */
export const unreachedOps = (ops: PluginOp[], done: PluginDone[]) => ops.filter(op => !done.some(entry => opKey(entry) === opKey(op)));

/** resultParts as plain text, for the screen reader and the tooltip. */
export const resultSentence = (lines: ResultLine[], undo: boolean) => resultParts(lines, undo).map(part => (typeof part === 'string' ? part : part.plugin)).join('');

/**
 * What each kind of step an Undo runs does, in Undo's hover, matching resultLines: a live Copilot CLI fresh install's `remove`
 * (`keptOff`) turns it off, kept installed, rather than uninstalling it. Items in Pi, OpenCode and Antigravity (`items-back`)
 * have no words: Central Knot puts them back itself, through no tool's command.
 */
const UNDO_CLAUSES: [(op: PluginOp) => boolean, string, string?][] = [
  [op => op.action === 'remove' && !op.keptOff, 'uninstalls it from'],
  [op => op.action === 'remove' && !!op.keptOff, 'turns it off in', ', kept installed'],
  [op => op.action === 'install', 'reinstalls it in'],
  [op => isItemSwitch(op.action) || isWhole(op.action), 'turns each switch back as it was in'],
];

/** Undo's tooltip, from what it will run (`back`): what it reverses where, and that an update in the same run stays. */
export function undoTitle(back: PluginOp[], { plugin, updated = false }: { plugin?: string; updated?: boolean } = {}): string {
  const where = (match: (op: PluginOp) => boolean) => andList([...new Set(back.filter(match).map(op => op.tool))].sort(byToolOrder).map(tool => names[tool]));
  const does = UNDO_CLAUSES.flatMap(([match, verb, after = '']) => {
    const list = where(match);
    return list ? [`${verb} ${list}${after}`] : [];
  });
  const said = [
    `Reverses what changed${plugin ? ` for ${plugin}` : ''}${does.length ? `, through each tool’s own command or switch: ${andList(does)}` : ''}.`,
    updated ? 'The update itself stays: it can’t be undone.' : '',
  ];
  return said.filter(Boolean).join(' ');
}

/**
 * What an Undo did not get to: ops it was given that did not succeed (it stopped before them, or they failed). One that
 * found nothing left to do ("wasn't installed") is done, so "Undo the rest" never offers it again.
 */
export const notUndone = (ops: PluginOp[], done: PluginDone[]): PluginOp[] => ops.filter(op => !done.some(entry => succeeded(entry.report) && opKey(entry) === opKey(op)));

/** Where a plugin run or problem belongs: Plugins (`'plugins'`), or one tool's Plugins tab under Harnesses. */
export type RunPlace = 'plugins' | HarnessId;

/** The Plugins page's last run (a click, a plugin's switch or an Undo): each tool's report, whether it was an Undo, in which home, and for an Undo the reversals that didn't succeed. */
export interface LastRun { done: PluginDone[]; undo: boolean; home: string; /** Where the run was made (default `'plugins'`). */ place?: RunPlace; rest?: PluginOp[]; /** Read again since (Refresh): what the tools have now may differ from what this run says it did. */ reread?: boolean;
  /** The plugins a run that stopped never reached (pluginstate.ts applyPluginOps). */
  unreached?: { source: string; plugin: string }[];
  /** Appended profileLeftUse sentence when the run ended every profile in use (pluginstate.ts, pluginspage.ts). */
  profileLine?: string;
  /**
   * Set when a plugin's switch made the run (marketplaces.ts turn): the plugin's entry before it (null: none) and its Undo as main gave it (`back`).
   */
  turn?: { source: string; plugin: string; before: PluginEntry | null; back: PluginOp[] } }

/** The calls a run needs, as the page's API gives them (tests pass their own). */
export interface PlanApi {
  install(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstall(source: string, marketName: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
  setSkill(source: string, marketName: string, plugin: string, skill: string, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
  setPart?(source: string, marketName: string, plugin: string, part: PartRef, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
  setWhole?(source: string, marketName: string, plugin: string, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
  update?(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  /** A plugin read and its items brought up to date (marketplaces.ts items): Update, or with `bring` a tool new here's install, `tools` then counted as where it is. */
  items?(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string, bring?: boolean): Promise<PluginActionResult>;
}

/**
 * Runs the ops in batches() order and returns what each tool did. A step whose call throws fails for its tools and the run
 * goes on. A refusal for the whole home (it changed, or writing isn't allowed) stops the run; that step and the rest don't
 * run and aren't recorded.
 */
export async function runPlan(ops: PluginOp[], api: PlanApi, home: string, onStep: (step: Step) => void = () => {}): Promise<{ done: PluginDone[]; stopped?: string }> {
  const done: PluginDone[] = [];
  for (const step of batches(ops)) {
    onStep(step);
    let result: PluginActionResult;
    try {
      result = step.action === 'install' ? await api.install(step.source, step.marketName, step.plugin, step.tools, home)
        : step.action === 'update' ? (api.update ? await api.update(step.source, step.marketName, step.plugin, step.tools, home) : { reports: failedFor(step.tools, 'Plugins can’t be updated here.') })
        : step.action === 'remove' ? await api.uninstall(step.source, step.marketName, step.plugin, step.tools[0]!, home)
        : isItems(step.action) ? (api.items ? await api.items(step.source, step.marketName, step.plugin, step.tools, home, step.action === 'install-items') : { reports: failedFor(step.tools, 'Its items can’t be read here.') })
        : isWhole(step.action) ? (api.setWhole ? await api.setWhole(step.source, step.marketName, step.plugin, step.tools[0]!, step.action === 'plugin-on', home) : { reports: failedFor(step.tools, 'Plugins can’t be turned on or off here.') })
        : step.part ? (api.setPart ? await api.setPart(step.source, step.marketName, step.plugin, step.part, step.tools[0]!, step.action === 'part-on', home) : { reports: failedFor(step.tools, 'That can’t be turned on or off here.') })
        : step.skill ? await api.setSkill(step.source, step.marketName, step.plugin, step.skill, step.tools[0]!, step.action === 'skill-on', home)
        : { reports: failedFor(step.tools, 'That choice named no skill, so nothing ran.') };
    } catch { result = { reports: failedFor(step.tools, 'It stopped unexpectedly. Refresh to see where it stands.') }; }
    if (result.stopped) return { done, stopped: result.stopped };
    for (const report of result.reports) done.push({ source: step.source, marketName: step.marketName, plugin: step.plugin, tool: report.tool, action: step.action, ...(step.skill ? { skill: step.skill } : {}), ...(step.part ? { part: step.part } : {}), report });
  }
  return { done };
}
