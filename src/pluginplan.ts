// Plugins: what the person has chosen but not applied yet, and what Apply all and its Undo run.
// Pure functions over plain data, so the plan can be read, tested and changed without the page or the engine.
import { PREVIEW_ONLY, cantSwitchSkill, cantUninstall, installed, partWords, partsOf, partsOffer, partsPickable, samePart, skillOff, stateOf, unavailable } from './pluginstatus.ts';
import type { ActionReport, HarnessId, MarketplaceView, PartPlan, PartRef, PartsPick, PluginActionResult, PluginsView } from './types.ts';
import { andList, byToolOrder, toolNames as names } from './words.ts';

/**
 * Install, update or uninstall a plugin, or turn one of its skills off or back on (ENB-06), in one tool. install-parts: its parts
 * as separate items in a tool that can't take the plugin (installed, or brought up to date); remove-parts: those parts out
 * again; pick-parts: single parts of it put in or taken out there (`pick`); undo-parts: an Undo of a parts run (`run`),
 * which only Undo makes.
 */
export type PluginAction = 'install' | 'update' | 'remove' | 'skill-off' | 'skill-on' | 'install-parts' | 'remove-parts' | 'pick-parts' | 'undo-parts';
/** The parts engine's mode for a parts action (installing also brings parts up to date; a pick installs only the parts it names); undefined for any other action. */
const PARTS_MODES: Partial<Record<PluginAction, 'install' | 'remove' | 'undo'>> = { 'install-parts': 'install', 'remove-parts': 'remove', 'pick-parts': 'install', 'undo-parts': 'undo' };
export const partsMode = (action: PluginAction) => PARTS_MODES[action];
export const isParts = (action: PluginAction) => partsMode(action) !== undefined;
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
  /** For undo-parts: the parts run it reverses. */
  run?: string;
  /** For pick-parts: the single parts to put in and to take out. */
  pick?: PartsPick;
}
/** One line of a run's result: a plugin and what happened to it ("installed in Codex"), or one tool's failure. */
export interface ResultLine {
  source: string;
  plugin: string;
  /** Set on a skill switch's line: its text starts with the skill's name. */
  skill?: string;
  ok: boolean;
  text: string;
  /** The same with three or more tools counted, not named ("installed in 3 tools"), for a narrow place; a skill's tools are always named. */
  short: string;
}
/** What one op did, as its tool reported it. */
export interface PluginDone extends PluginOp { report: ActionReport }

/** Chosen changes, keyed by marketplace source, plugin and tool. Nothing here has run. */
export type PluginDraft = Map<string, PluginOp>;

/** A failure for each tool of a step that could not run at all, so the report says so and Undo leaves it alone. */
export const failedFor = (tools: HarnessId[], message: string): ActionReport[] => tools.map(tool => ({ tool, outcome: 'failed', message, runs: [] }));

/** One plugin in one marketplace: two marketplaces may both offer a plugin with the same name. */
export const pluginKey = (source: string, plugin: string) => `${source}\u0000${plugin}`;
/** A plugin's own change in a tool, each of its skills' switches there, and the single parts picked for it there are separate choices. */
const opKey = (op: Pick<PluginOp, 'source' | 'plugin' | 'tool' | 'skill'> & { action?: PluginAction }) => `${pluginKey(op.source, op.plugin)}\u0000${op.tool}\u0000${op.action === 'pick-parts' ? PICK_SLOT : op.skill ?? ''}`;
/** A pick's place among a tool's choices: no skill has this name. */
const PICK_SLOT = '\u0001parts';
/** Whether a plugin key (or a key made from one) belongs to this marketplace. */
export const forSource = (key: string, source: string) => key.startsWith(`${source}\u0000`);

/** The install or uninstall chosen for a plugin in a tool, or with `skill`, that skill's switch chosen there. */
export const queued = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId, skill?: string) => draft.get(opKey({ source, plugin, tool, skill }))?.action;

/** Takes one change out of the draft, once it has run. */
export const clear = (draft: PluginDraft, op: Pick<PluginOp, 'source' | 'plugin' | 'tool' | 'skill'> & { action?: PluginAction }) => { draft.delete(opKey(op)); };

/** The single parts picked for a plugin in a tool, if any. */
export const pickOf = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId): PartsPick | undefined => draft.get(opKey({ source, plugin, tool, action: 'pick-parts' }))?.pick;

/**
 * Sets what is picked for a plugin in a tool (`at` names them). An empty pick is no choice. A pick and the whole plugin
 * are two ways of having it in a tool, so choosing parts takes back an install chosen there.
 */
export function setPick(draft: PluginDraft, at: Pick<PluginOp, 'source' | 'marketName' | 'plugin' | 'tool'>, pick: PartsPick): void {
  const op: PluginOp = { ...at, action: 'pick-parts', pick };
  if (!pick.on.length && !pick.off.length) { draft.delete(opKey(op)); return; }
  draft.set(opKey(op), op);
  if (queued(draft, at.source, at.plugin, at.tool) === 'install') draft.delete(opKey(at));
}

/**
 * A pick after a click on one part's switch: a part already in the pick is taken back out of it (the click undoes the
 * choice); any other is chosen to go in (`on`) or to come out, away from where it stands now.
 */
export function flipPick(pick: PartsPick | undefined, part: PartRef, on: boolean): PartsPick {
  const without = (refs: PartRef[] = []) => refs.filter(ref => !samePart(ref, part));
  const chosen = [...(pick?.on ?? []), ...(pick?.off ?? [])].some(ref => samePart(ref, part));
  return { on: [...without(pick?.on), ...(on && !chosen ? [part] : [])], off: [...without(pick?.off), ...(!on && !chosen ? [part] : [])] };
}

/** Chooses one change. The whole plugin, or all its parts out, takes back single parts picked there; an install or update of its parts keeps them, as its exceptions. */
function choose(draft: PluginDraft, op: PluginOp): void {
  draft.set(opKey(op), op);
  if (op.action === 'install' || op.action === 'remove-parts') draft.delete(opKey({ ...op, action: 'pick-parts' }));
}

/** Takes one chosen change back. Single parts picked beside an install or update of a tool's parts are that run's exceptions, and go with it. */
function takeBack(draft: PluginDraft, op: PluginOp): void {
  draft.delete(opKey(op));
  if (op.action === 'install-parts') draft.delete(opKey({ ...op, action: 'pick-parts' }));
}

/** Choosing the same change again takes it back; a different one replaces it. */
export function toggle(draft: PluginDraft, op: PluginOp): void {
  if (draft.get(opKey(op))?.action === op.action) takeBack(draft, op);
  else choose(draft, op);
}

/** Whether every one of these ops is already chosen, exactly as given. */
export const allQueued = (draft: PluginDraft, ops: PluginOp[]) => ops.length > 0 && ops.every(op => draft.get(opKey(op))?.action === op.action);

/** Queues or clears one action for several tools at once: all queued already means take them all back. */
export function toggleMany(draft: PluginDraft, ops: PluginOp[]): void {
  const all = allQueued(draft, ops);
  for (const op of ops) { if (all) takeBack(draft, op); else choose(draft, op); }
}

/**
 * Drops choices that no longer mean anything, so none is counted or run unseen: a plugin or marketplace no longer
 * listed, an install the tool can't take now (pluginstatus.unavailable) or already has, an uninstall of something
 * no longer installed or that can't be uninstalled now (pluginstatus.cantUninstall), an update of one no longer installed,
 * loaded live from its folder or that can't be changed now (as for an uninstall), and a skill switch where the plugin
 * isn't installed, the tool can't switch it (pluginstatus.cantSwitchSkill), or it already is as chosen. Parts go stale where
 * they can't go in now or are there and up to date, and their removal where none are there. A pick loses the parts to
 * take out that are no longer there (see narrowed), and goes once it names none.
 */
export function prune(draft: PluginDraft, view: PluginsView | undefined): void {
  for (const [key, op] of draft) {
    const entry = view?.marketplaces.find(candidate => candidate.source === op.source);
    // A pick keeps only what it would still change.
    if (op.action === 'pick-parts' && entry) op.pick = narrowed(draft, op, partsOf(entry, op.plugin, op.tool)?.items ?? []);
    const listed = !!entry?.plugins.some(plugin => plugin.name === op.plugin);
    // A marketplace whose catalog now gives another name is another plugin@name to the tools: the choice no longer means it.
    const parts = entry && partsOf(entry, op.plugin, op.tool);
    const stale = !view || !entry || !listed || entry.name !== op.marketName || (op.action === 'install'
      ? !!unavailable(view, entry, op.plugin, op.tool) || installed(entry, op.plugin, op.tool)
      : op.action === 'remove' ? !installed(entry, op.plugin, op.tool) || !!cantUninstall(view, entry, op.plugin, op.tool)
      : op.action === 'update' ? !installed(entry, op.plugin, op.tool) || !!cantUninstall(view, entry, op.plugin, op.tool) || !!(stateOf(entry, op.plugin, op.tool) as { live?: boolean }).live
      : op.action === 'install-parts' ? !view.canWrite || !partsOffer(view, entry, op.plugin, op.tool) || (!!parts && !parts.changed)
      : op.action === 'remove-parts' ? !parts || !view.canWrite
      : op.action === 'pick-parts' ? !view.canWrite || !partsPickable(view, entry, op.plugin, op.tool) || !(op.pick!.on.length + op.pick!.off.length)
      : op.action === 'undo-parts' || skillChoiceStale(view, entry, op));
    if (stale) draft.delete(key);
  }
}

/**
 * Whether a skill switch choice means nothing now: the tool can't switch that skill here (pluginstatus.cantSwitchSkill:
 * not installed, no switch, not in the installed copy, held off…) or it already is as chosen.
 */
function skillChoiceStale(view: PluginsView, entry: MarketplaceView, op: PluginOp): boolean {
  if (!op.skill || cantSwitchSkill(view, entry, op.plugin, op.tool, op.skill)) return true;
  return !!skillOff(entry, op.plugin, op.tool, op.skill) === (op.action === 'skill-off');
}

/**
 * A pick without the parts to take out that aren't on the tool's record (`there`); while an install or update of the
 * tool's parts is chosen too, one to take out may be a part that run would add, so it stays. Parts to put in all stay: one
 * on record may have been removed from the tool by hand, which only the run can tell, and putting in one that is there
 * changes nothing.
 */
function narrowed(draft: PluginDraft, op: PluginOp, there: PartRef[]): PartsPick {
  const updating = queued(draft, op.source, op.plugin, op.tool) === 'install-parts';
  const pick = op.pick ?? { on: [], off: [] };
  return { ...pick, off: pick.off.filter(part => updating || there.some(item => samePart(item, part))) };
}

/**
 * Where one part stands in a tool that takes single parts: in there or not (`there`), what Apply all will make of it
 * (`chosen`: from a pick, or from an install, update or removal of all the tool's parts), where its switch points (`on`),
 * and why it can't change. `planned`: the part in the tool's plan, once that is read; `inTool`: the parts the tool has.
 */
export function partStand(draft: PluginDraft, at: Pick<PluginOp, 'source' | 'plugin' | 'tool'>, part: PartRef, { planned, inTool, canWrite }: { planned: PartPlan | undefined; inTool: PartRef[]; canWrite: boolean }) {
  const same = (other: PartRef) => samePart(other, part);
  const there = inTool.some(same);
  const whole = queued(draft, at.source, at.plugin, at.tool);
  const pick = pickOf(draft, at.source, at.plugin, at.tool);
  const chosen = pick?.on.some(same) ? 'on' as const : pick?.off.some(same) ? 'off' as const
    : whole === 'remove-parts' && there ? 'off' as const : whole === 'install-parts' && !there && !!planned && !planned.why && !planned.out ? 'on' as const : undefined;
  // One that is in needs no plan to come out, unless its folder can't be written through (`fixed`).
  const why = chosen ? undefined : !canWrite ? PREVIEW_ONLY : there ? planned?.why ?? planned?.fixed : planned ? planned.why : 'It can’t go in here as a separate item.';
  return { there, chosen, on: chosen ? chosen === 'on' : there, why };
}

/**
 * A click on one part's switch: the part joins, or leaves, what is picked for the tool, away from where its switch points
 * now (beside an install or update of all its parts, the pick is that run's exceptions). A removal of all the tool's
 * parts becomes the same choice part by part, without this one. `planned` and `inTool` as for partStand.
 */
export function clickPart(draft: PluginDraft, at: Pick<PluginOp, 'source' | 'marketName' | 'plugin' | 'tool'>, part: PartRef, { planned, inTool }: { planned: PartPlan | undefined; inTool: PartRef[] }): void {
  const stand = partStand(draft, at, part, { planned, inTool, canWrite: true });
  if (queued(draft, at.source, at.plugin, at.tool) !== 'remove-parts') { setPick(draft, at, flipPick(pickOf(draft, at.source, at.plugin, at.tool), part, !stand.on)); return; }
  clear(draft, at);
  setPick(draft, at, { on: stand.there ? [] : [part], off: inTool.filter(other => !samePart(other, part)).map(({ kind, name }) => ({ kind, name })) });
}

/** The skill switches chosen for one plugin, optionally only in one tool or for one skill. */
export const skillChoices = (draft: PluginDraft, source: string, plugin: string, { tool, skill }: { tool?: HarnessId; skill?: string } = {}) =>
  [...draft.values()].filter(op => op.skill && op.source === source && op.plugin === plugin && (!tool || op.tool === tool) && (!skill || op.skill === skill));

/**
 * Counts for the change bar: plugins to install or uninstall and how many of each, and for skill switches how many
 * skills (each counted once, however many tools) and in how many tools, tools to install, update or remove parts in, and
 * single parts to put in or take out (each counted per tool).
 * `isUpdate`: whether a parts install is an update (that tool has the plugin's parts already).
 */
export function summary(draft: PluginDraft, isUpdate: (op: PluginOp) => boolean = () => false) {
  const ops = [...draft.values()];
  const count = (action: PluginAction) => ops.filter(op => op.action === action).length;
  const switches = (action: PluginAction) => {
    const mine = ops.filter(op => op.action === action);
    return { skills: new Set(mine.map(op => `${pluginKey(op.source, op.plugin)}\u0000${op.skill}`)).size, tools: new Set(mine.map(op => op.tool)).size };
  };
  // Plugins changed as a whole in some tool; a skill's switch and single parts are counted on their own.
  const plugins = new Set(ops.filter(op => !op.skill && op.action !== 'pick-parts').map(op => pluginKey(op.source, op.plugin))).size;
  const partsUpdates = ops.filter(op => op.action === 'install-parts' && isUpdate(op)).length;
  const picked = (which: 'on' | 'off') => ops.reduce((sum, op) => sum + (op.pick?.[which].length ?? 0), 0);
  return { plugins, installs: count('install'), updates: count('update'), removals: count('remove'), skillsOff: switches('skill-off'), skillsOn: switches('skill-on'),
    partsInstalls: count('install-parts') - partsUpdates, partsUpdates, partsRemovals: count('remove-parts'), partsOn: picked('on'), partsOff: picked('off') };
}

/** One step of a run: one tool command, apart from an install or update, which runs for every tool chosen at once. */
export interface Step { source: string; marketName: string; plugin: string; action: PluginAction; tools: HarnessId[]; skill?: string; run?: string; pick?: PartsPick }

/**
 * Runs in a fixed, readable order: per plugin, installs first, then updates (each one command per tool set), then skill switches, then
 * removals, tool by tool, then parts, tool by tool. Single parts picked in a tool whose parts are also installed or
 * updated are one step: that install or update with the pick as its exceptions (`pick.rest`).
 */
export function batches(ops: PluginOp[]): Step[] {
  const out: Step[] = [];
  const plugins = [...new Map(ops.map(op => [pluginKey(op.source, op.plugin), op])).values()];
  const one = (op: PluginOp): Step => ({ source: op.source, marketName: op.marketName, plugin: op.plugin, action: op.action, tools: [op.tool], ...(op.skill ? { skill: op.skill } : {}), ...(op.run ? { run: op.run } : {}), ...(op.pick ? { pick: op.pick } : {}) });
  for (const first of plugins) {
    const mine = ops.filter(op => op.source === first.source && op.plugin === first.plugin);
    for (const action of ['install', 'update'] as const) {
      const tools = mine.filter(op => op.action === action).map(op => op.tool);
      if (tools.length) out.push({ source: first.source, marketName: first.marketName, plugin: first.plugin, action, tools });
    }
    out.push(...mine.filter(op => op.action === 'skill-off' || op.action === 'skill-on').map(one), ...mine.filter(op => op.action === 'remove').map(one),
      ...mine.filter(op => isParts(op.action)).flatMap(op => {
        const pick = mine.find(other => other.action === 'pick-parts' && other.tool === op.tool);
        if (op.action === 'pick-parts') return [{ ...one(op), pick: { ...op.pick!, rest: mine.some(other => other.action === 'install-parts' && other.tool === op.tool) } }];
        return op.action === 'install-parts' && pick ? [] : [one(op)];
      }));
  }
  return out;
}

const OPPOSITE: Partial<Record<PluginAction, PluginAction>> = { install: 'remove', remove: 'install', 'skill-off': 'skill-on', 'skill-on': 'skill-off' };

/**
 * The way back: only what this run really changed, reversed, last first (so each Codex skill switch is undone onto the
 * file it wrote, and its earlier bytes come back). "Already installed", failures and unknowns are left alone. A
 * parts run is undone by its own record (undo-parts), so a later step that took what an earlier one freed, such as a
 * skill name, is undone first. An update has no way back (the tools keep no earlier copy to return to), so it is left out.
 */
export const reverse = (done: PluginDone[]): PluginOp[] => done
  .filter(entry => entry.report.changed && entry.action !== 'update' && (!isParts(entry.action) || entry.report.partsRun))
  .map(({ report, pick: _picked, ...op }): PluginOp => (isParts(op.action) ? { ...op, action: 'undo-parts', run: report.partsRun } : { ...op, action: OPPOSITE[op.action]! }))
  .reverse();

/** A tool did what was asked (installed, updated, uninstalled, turned a skill off or on), whether this run changed it or it already was. */
export const succeeded = (report: ActionReport) => report.outcome === 'installed' || report.outcome === 'updated' || report.outcome === 'uninstalled' || report.outcome === 'skill-off' || report.outcome === 'skill-on';

/**
 * One line per plugin (or per skill of it) and outcome, e.g. "document-tools: installed in Claude Code and Codex" or
 * "document-tools: pdf-reader turned off in Codex". What a tool already had is said as such ("already in Codex"), never
 * as a change this run made. An update names the version each tool records now and says plainly that it can't be undone.
 * For an Undo, the verbs say what came back: "removed from" for an install reversed, "put back
 * in" for an uninstall reversed, "back on in" for a skill turned off. `after`: for a note read later (an update made with
 * nobody watching), without "which can't be undone", which is said before a click.
 */
export function resultLines(done: PluginDone[], undo = false, { after = false } = {}): ResultLine[] {
  const lines: ResultLine[] = [];
  const lineKey = (entry: PluginDone) => `${pluginKey(entry.source, entry.plugin)}\u0000${entry.skill ?? ''}`;
  for (const key of new Set(done.map(lineKey))) {
    const mine = done.filter(entry => lineKey(entry) === key);
    const { plugin, source, skill } = mine[0]!;
    // Tools in the page's column order, so "Codex and Pi" never reads "Pi and Codex" the next time. An unchanged parts
    // result is one group whatever kind of run it was: only a change tells an update from an install.
    // A pick of single parts is said as such; with the rest of the tool's parts it is that install or update.
    const picked = (entry: PluginDone) => entry.action === 'pick-parts' && !entry.pick?.rest;
    // A tool where a part was left alone (its note says which) got only some of them.
    const tools = (outcome: ActionReport['outcome'], changed: boolean, { parts = false, updated = false, single = false, some = false } = {}) => mine
      .filter(entry => entry.report.outcome === outcome && !!entry.report.changed === changed && isParts(entry.action) === parts
        && (!parts || !changed || (picked(entry) === single && (single || (!!entry.report.partsUpdated === updated && (undo || !!entry.report.notes?.length === some))))))
      .sort((first, second) => byToolOrder(first.tool, second.tool)).map(entry => names[entry.tool]);
    const partsGroups: Group[] = [
      [tools('installed', true, { parts: true }), undo ? 'parts back as they were in' : 'parts installed in'],
      [tools('installed', true, { parts: true, updated: true }), 'parts updated in'],
      [tools('installed', true, { parts: true, some: true }), 'only some parts installed in'],
      [tools('installed', true, { parts: true, updated: true, some: true }), 'only some parts updated in'],
      ...singleGroups(mine.filter(entry => picked(entry) && entry.report.changed && succeeded(entry.report)).sort((first, second) => byToolOrder(first.tool, second.tool))),
      [tools('uninstalled', true, { parts: true }), 'parts removed from'],
      ...(undo
        ? [[[...tools('installed', false, { parts: true }), ...tools('uninstalled', false, { parts: true })], 'nothing left to undo in'] as [string[], string]]
        : [[tools('installed', false, { parts: true }), 'parts already up to date in'], [tools('uninstalled', false, { parts: true }), 'had no parts in']] as [string[], string][]),
      // A skill that went in where a link led nowhere: said, since something in the person's folder was replaced.
      [mine.filter(entry => isParts(entry.action) && entry.report.replacedLinks?.length).map(entry => names[entry.tool]), 'a broken link replaced in'],
    ];
    const groups: Group[] = skill
      ? [[tools('skill-off', true), undo ? `${skill} off again in` : `${skill} turned off in`], [tools('skill-on', true), undo ? `${skill} back on in` : `${skill} turned on in`],
        [tools('skill-off', false), `${skill} already off in`], [tools('skill-on', false), `${skill} already on in`]]
      : [[tools('installed', true), undo ? 'put back in' : 'installed in'], ...updatedGroups(mine, !after), [tools('updated', false), 'already up to date in'], [tools('uninstalled', true), undo ? 'removed from' : 'uninstalled from'],
        [tools('installed', false), 'already in'], [tools('uninstalled', false), 'wasn’t installed in'], ...partsGroups];
    // A skill switch only ever reaches the few tools that have one, so its tools are always named.
    const said = (counted: boolean) => groups.filter(([list]) => list.length).map(([list, verb, after = '']) => `${verb} ${counted && !skill && list.length > 2 ? `${list.length} tools` : andList(list)}${after}`).join('; ');
    if (said(false)) lines.push({ source, plugin, ...(skill ? { skill } : {}), ok: true, text: said(false), short: said(true) });
    for (const entry of mine.filter(candidate => !succeeded(candidate.report))) {
      const text = `${names[entry.tool]}${skill ? `, ${skill}` : ''}: ${entry.report.message}`;
      lines.push({ source, plugin, ...(skill ? { skill } : {}), ok: false, text, short: text });
    }
    // A part left alone (edited since, or a same-named item already there) needs reading, like a failure.
    for (const entry of mine.filter(candidate => succeeded(candidate.report) && candidate.report.notes?.length)) {
      const text = `${names[entry.tool]}: ${entry.report.notes!.join(' ')}`;
      lines.push({ source, plugin, ok: false, text, short: text });
    }
  }
  return lines;
}

/**
 * Single parts picked, tool by tool, in the parts' own names: "skill triage put into Pi", "MCP server issues taken out of
 * Codex". A run that left a part alone (its note says which) only says its parts changed.
 */
function singleGroups(done: PluginDone[]): Group[] {
  const named = (parts: PartRef[]) => andList(parts.map(part => `${partWords[part.kind][0]} ${part.name}`));
  return done.flatMap((entry): Group[] => (entry.report.notes?.length ? [[[names[entry.tool]], 'parts changed in']]
    : [[entry.pick!.on.length ? [names[entry.tool]] : [], `${named(entry.pick!.on)} put into`], [entry.pick!.off.length ? [names[entry.tool]] : [], `${named(entry.pick!.off)} taken out of`]]));
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
  const changed = mine.filter(entry => entry.report.outcome === 'updated' && entry.report.changed).sort((first, second) => byToolOrder(first.tool, second.tool));
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
 * open, named by its breadcrumb, so its lines leave its name out): "document-tools: installed in Codex." or, for an Undo, "Undone:
 * document-tools removed from Codex." Each plugin is its own piece so the page can link it. Empty when nothing succeeded.
 */
export function resultParts(lines: ResultLine[], undo: boolean, { short = false, here }: { short?: boolean; here?: { plugin: string; source: string } } = {}): (string | { plugin: string; source: string })[] {
  const ok = lines.filter(line => line.ok);
  if (!ok.length) return [];
  const parts: (string | { plugin: string; source: string })[] = undo ? ['Undone: '] : [];
  ok.forEach((line, at) => {
    const text = short ? line.short : line.text;
    if (at) parts.push('; ');
    // On the plugin's own page its name is already in the breadcrumb: "Installed in Codex." / "pdf-reader turned off in Codex."
    // Only a line that starts the sentence takes a capital, and never a skill's name.
    const opens = !at && !undo && !line.skill;
    if (here?.plugin === line.plugin && here.source === line.source) parts.push(opens ? capitalized(text) : text);
    // "Undone: document-tools removed from Codex" reads on; a skill's line starts with the skill, so the plugin takes a colon.
    else parts.push({ plugin: line.plugin, source: line.source }, `${undo && !line.skill ? ' ' : ': '}${text}`);
  });
  return [...parts, '.'];
}
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** resultParts as plain text, for the screen reader and the tooltip. */
export const resultSentence = (lines: ResultLine[], undo: boolean) => resultParts(lines, undo).map(part => (typeof part === 'string' ? part : part.plugin)).join('');

/**
 * What an Undo did not get to: ops it was given that did not succeed (it stopped before them, or they failed). One that
 * found nothing left to do ("wasn't installed") is done, so "Undo the rest" never offers it again.
 */
export const notUndone = (ops: PluginOp[], done: PluginDone[]): PluginOp[] => ops.filter(op => !done.some(entry => succeeded(entry.report) && opKey(entry) === opKey(op)));

/** The last Apply all (or Undo): each tool's report, whether it was an Undo, in which home, and for an Undo the reversals that didn't succeed. */
export interface LastRun { done: PluginDone[]; undo: boolean; home: string; rest?: PluginOp[]; /** Read again since (Refresh): what the tools have now may differ from what this run says it did. */ reread?: boolean;
  /** Its problem lines were read and closed; what it did (and its Undo) stays. */ problemsClosed?: boolean }

/** After a run: what ran leaves the draft (what wasn't reached stays chosen), and the run is recorded for the toolbar and its Undo. */
export function recordRun(draft: PluginDraft, ops: PluginOp[], done: PluginDone[], undo: boolean, home: string): LastRun {
  // A pick that ran with the rest of the tool's parts was that install or update too.
  for (const entry of done) { clear(draft, entry); if (entry.pick?.rest) clear(draft, { ...entry, action: 'install-parts' }); }
  return { done, undo, home, rest: undo ? notUndone(ops, done) : undefined };
}

/** The calls a run needs, as the page's API gives them (tests pass their own). */
export interface PlanApi {
  install(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstall(source: string, marketName: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
  setSkill(source: string, marketName: string, plugin: string, skill: string, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
  update?(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  parts?(source: string, marketName: string, plugin: string, tool: HarnessId, mode: 'install' | 'remove' | 'undo', run: string | undefined, home: string, pick?: PartsPick): Promise<PluginActionResult>;
}

/**
 * Runs the ops in batches() order and returns what each tool did. A step whose call throws fails for its tools and the run
 * goes on. A refusal for the whole home (it changed, or writing isn't allowed) stops the run; that step and the rest are
 * not recorded, so they stay chosen.
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
        : isParts(step.action) ? (api.parts ? await api.parts(step.source, step.marketName, step.plugin, step.tools[0]!, partsMode(step.action)!, step.run, home, step.pick) : { reports: failedFor(step.tools, 'Parts can’t be installed here.') })
        : step.skill ? await api.setSkill(step.source, step.marketName, step.plugin, step.skill, step.tools[0]!, step.action === 'skill-on', home)
        : { reports: failedFor(step.tools, 'That choice named no skill, so nothing ran.') };
    } catch { result = { reports: failedFor(step.tools, 'It stopped unexpectedly. Refresh to see where it stands.') }; }
    if (result.stopped) return { done, stopped: result.stopped };
    for (const report of result.reports) done.push({ source: step.source, marketName: step.marketName, plugin: step.plugin, tool: report.tool, action: step.action, ...(step.skill ? { skill: step.skill } : {}), ...(step.run ? { run: step.run } : {}), ...(step.pick ? { pick: step.pick } : {}), report });
  }
  return { done };
}
