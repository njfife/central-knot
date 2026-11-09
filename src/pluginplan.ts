// Plugins: what the person has chosen but not applied yet, and what Apply all and its Undo run.
// Pure functions over plain data, so the plan can be read, tested and changed without the page or the engine.
import { cantSwitchSkill, cantUninstall, installed, skillOff, unavailable } from './pluginstatus.ts';
import type { ActionReport, HarnessId, PluginActionResult, PluginsView } from './types.ts';
import { andList, toolNames as names } from './words.ts';

/** Install or uninstall a plugin, or turn one of its skills off or back on (ENB-06), in one tool. */
export type PluginAction = 'install' | 'remove' | 'skill-off' | 'skill-on';
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
}
/** One line of a run's result: a plugin and what happened to it ("installed in Codex"), or one tool's failure. */
export interface ResultLine {
  source: string;
  plugin: string;
  ok: boolean;
  text: string;
  /** The same said shorter for a narrow place: three or more tools (two for a skill) counted, not named ("installed in 3 tools"). */
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
/** A plugin's own change in a tool and each of its skills' switches there are separate choices. */
const opKey = (op: Pick<PluginOp, 'source' | 'plugin' | 'tool' | 'skill'>) => `${pluginKey(op.source, op.plugin)}\u0000${op.tool}\u0000${op.skill ?? ''}`;
/** Whether a plugin key (or a key made from one) belongs to this marketplace. */
export const forSource = (key: string, source: string) => key.startsWith(`${source}\u0000`);

/** The install or uninstall chosen for a plugin in a tool, or with `skill`, that skill's switch chosen there. */
export const queued = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId, skill?: string) => draft.get(opKey({ source, plugin, tool, skill }))?.action;

/** Takes one change out of the draft, once it has run. */
export const clear = (draft: PluginDraft, op: Pick<PluginOp, 'source' | 'plugin' | 'tool' | 'skill'>) => { draft.delete(opKey(op)); };

/** Choosing the same change again takes it back; a different one replaces it. */
export function toggle(draft: PluginDraft, op: PluginOp): void {
  const key = opKey(op);
  if (draft.get(key)?.action === op.action) draft.delete(key);
  else draft.set(key, op);
}

/** Whether every one of these ops is already chosen, exactly as given. */
export const allQueued = (draft: PluginDraft, ops: PluginOp[]) => ops.length > 0 && ops.every(op => draft.get(opKey(op))?.action === op.action);

/** Queues or clears one action for several tools at once: all queued already means take them all back. */
export function toggleMany(draft: PluginDraft, ops: PluginOp[]): void {
  const all = allQueued(draft, ops);
  for (const op of ops) { if (all) draft.delete(opKey(op)); else draft.set(opKey(op), op); }
}

/**
 * Drops choices that no longer mean anything, so none is counted or run unseen: a plugin or marketplace no longer
 * listed, an install the tool can't take now (pluginstatus.unavailable) or already has, an uninstall of something
 * no longer installed or that can't be uninstalled now (pluginstatus.cantUninstall), and a skill switch where the plugin
 * isn't installed, the tool can't switch it (pluginstatus.cantSwitchSkill), or it already is as chosen.
 */
export function prune(draft: PluginDraft, view: PluginsView | undefined): void {
  for (const [key, op] of draft) {
    const entry = view?.marketplaces.find(candidate => candidate.source === op.source);
    const listed = !!entry?.plugins.some(plugin => plugin.name === op.plugin);
    // A marketplace whose catalog now gives another name is another plugin@name to the tools: the choice no longer means it.
    const off = (skill: string) => skillOff(entry!, op.plugin, op.tool, skill);
    const stale = !view || !entry || !listed || entry.name !== op.marketName || (op.action === 'install'
      ? !!unavailable(view, entry, op.plugin, op.tool) || installed(entry, op.plugin, op.tool)
      : op.action === 'remove' ? !installed(entry, op.plugin, op.tool) || !!cantUninstall(view, entry, op.plugin, op.tool)
      : !op.skill || !installed(entry, op.plugin, op.tool) || !!cantSwitchSkill(view, op.tool, op.skill) || (op.action === 'skill-off' ? !!off(op.skill) : !off(op.skill) || !!off(op.skill)?.held));
    if (stale) draft.delete(key);
  }
}

/** Counts for the change bar. */
export function summary(draft: PluginDraft) {
  const ops = [...draft.values()];
  const count = (action: PluginAction) => ops.filter(op => op.action === action).length;
  return { plugins: new Set(ops.map(op => pluginKey(op.source, op.plugin))).size, installs: count('install'), removals: count('remove'), skillsOff: count('skill-off'), skillsOn: count('skill-on') };
}

/** One step of a run: one tool command, apart from an install, which runs for every tool chosen at once. */
export interface Step { source: string; marketName: string; plugin: string; action: PluginAction; tools: HarnessId[]; skill?: string }

/**
 * Runs in a fixed, readable order: per plugin, installs first (one command per tool set), then skill switches, then
 * removals, tool by tool.
 */
export function batches(ops: PluginOp[]): Step[] {
  const out: Step[] = [];
  const plugins = [...new Map(ops.map(op => [pluginKey(op.source, op.plugin), op])).values()];
  const one = (op: PluginOp): Step => ({ source: op.source, marketName: op.marketName, plugin: op.plugin, action: op.action, tools: [op.tool], ...(op.skill ? { skill: op.skill } : {}) });
  for (const first of plugins) {
    const mine = ops.filter(op => op.source === first.source && op.plugin === first.plugin);
    const installs = mine.filter(op => op.action === 'install').map(op => op.tool);
    if (installs.length) out.push({ source: first.source, marketName: first.marketName, plugin: first.plugin, action: 'install', tools: installs });
    out.push(...mine.filter(op => op.action === 'skill-off' || op.action === 'skill-on').map(one), ...mine.filter(op => op.action === 'remove').map(one));
  }
  return out;
}

const OPPOSITE: Record<PluginAction, PluginAction> = { install: 'remove', remove: 'install', 'skill-off': 'skill-on', 'skill-on': 'skill-off' };

/** The way back: only what this run really changed, reversed. "Already installed", failures and unknowns are left alone. */
export const reverse = (done: PluginDone[]): PluginOp[] => done
  .filter(entry => entry.report.changed)
  .map(({ report: _report, ...op }) => ({ ...op, action: OPPOSITE[op.action] }));

/** A tool did what was asked (installed, uninstalled, turned a skill off or on), whether this run changed it or it already was. */
export const succeeded = (report: ActionReport) => report.outcome === 'installed' || report.outcome === 'uninstalled' || report.outcome === 'skill-off' || report.outcome === 'skill-on';

/**
 * One line per plugin (or per skill of it) and outcome, e.g. "document-tools: installed in Claude Code and Codex" or
 * "document-tools: pdf-reader turned off in Codex". What a tool already had is said as such ("already in Codex"), never
 * as a change this run made. For an Undo, the verbs say what came back: "removed from" for an install reversed, "put back
 * in" for an uninstall reversed, "back on in" for a skill turned off.
 */
export function resultLines(done: PluginDone[], undo = false): ResultLine[] {
  const lines: ResultLine[] = [];
  const lineKey = (entry: PluginDone) => `${pluginKey(entry.source, entry.plugin)}\u0000${entry.skill ?? ''}`;
  for (const key of new Set(done.map(lineKey))) {
    const mine = done.filter(entry => lineKey(entry) === key);
    const { plugin, source, skill } = mine[0]!;
    const tools = (outcome: ActionReport['outcome'], changed: boolean) => mine.filter(entry => entry.report.outcome === outcome && !!entry.report.changed === changed).map(entry => names[entry.tool]);
    // Each group: the tools, what happened there, and the same said shorter for a narrow place.
    const groups: [string[], string, string?][] = skill
      ? [[tools('skill-off', true), undo ? `${skill} off again in` : `${skill} turned off in`, undo ? undefined : `${skill} off in`], [tools('skill-on', true), undo ? `${skill} back on in` : `${skill} turned on in`, undo ? undefined : `${skill} on in`],
        [tools('skill-off', false), `${skill} already off in`], [tools('skill-on', false), `${skill} already on in`]]
      : [[tools('installed', true), undo ? 'put back in' : 'installed in'], [tools('uninstalled', true), undo ? 'removed from' : 'uninstalled from'],
        [tools('installed', false), 'already in'], [tools('uninstalled', false), 'wasn’t installed in']];
    // A skill's line carries its name too, so its short form counts tools from two.
    const countFrom = skill ? 2 : 3;
    const said = (short: boolean) => groups.filter(([list]) => list.length)
      .map(([list, verb, brief]) => `${short ? brief ?? verb : verb} ${short && list.length >= countFrom ? `${list.length} tools` : andList(list)}`).join('; ');
    if (said(false)) lines.push({ source, plugin, ok: true, text: said(false), short: said(true) });
    for (const entry of mine.filter(candidate => !succeeded(candidate.report))) {
      const text = `${names[entry.tool]}${skill ? `, ${skill}` : ''}: ${entry.report.message}`;
      lines.push({ source, plugin, ok: false, text, short: text });
    }
  }
  return lines;
}

/**
 * The successful lines as one sentence, in pieces (`short`: tools counted, for the toolbar): "document-tools: installed in Codex." or, for an Undo, "Undone:
 * document-tools removed from Codex." Each plugin is its own piece so the page can link it. Empty when nothing succeeded.
 */
export function resultParts(lines: ResultLine[], undo: boolean, { short = false } = {}): (string | { plugin: string; source: string })[] {
  const ok = lines.filter(line => line.ok);
  if (!ok.length) return [];
  const parts: (string | { plugin: string; source: string })[] = undo ? ['Undone: '] : [];
  ok.forEach((line, at) => parts.push(...(at ? ['; '] : []), { plugin: line.plugin, source: line.source }, `${undo ? ' ' : ': '}${short ? line.short : line.text}`));
  return [...parts, '.'];
}
/** resultParts as plain text, for the screen reader and the tooltip. */
export const resultSentence = (lines: ResultLine[], undo: boolean) => resultParts(lines, undo).map(part => (typeof part === 'string' ? part : part.plugin)).join('');

/**
 * What an Undo did not get to: ops it was given that did not succeed (it stopped before them, or they failed). One that
 * found nothing left to do ("wasn't installed") is done, so "Undo the rest" never offers it again.
 */
export const notUndone = (ops: PluginOp[], done: PluginDone[]): PluginOp[] => ops.filter(op => !done.some(entry => succeeded(entry.report) && opKey(entry) === opKey(op)));

/** The last Apply all (or Undo): each tool's report, whether it was an Undo, in which home, and for an Undo the reversals that didn't succeed. */
export interface LastRun { done: PluginDone[]; undo: boolean; home: string; rest?: PluginOp[] }

/** After a run: what ran leaves the draft (what wasn't reached stays chosen), and the run is recorded for the toolbar and its Undo. */
export function recordRun(draft: PluginDraft, ops: PluginOp[], done: PluginDone[], undo: boolean, home: string): LastRun {
  for (const entry of done) clear(draft, entry);
  return { done, undo, home, rest: undo ? notUndone(ops, done) : undefined };
}

/** The calls a run needs, as the page's API gives them (tests pass their own). */
export interface PlanApi {
  install(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstall(source: string, marketName: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
  setSkill(source: string, marketName: string, plugin: string, skill: string, tool: HarnessId, on: boolean, home: string): Promise<PluginActionResult>;
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
        : step.action === 'remove' ? await api.uninstall(step.source, step.marketName, step.plugin, step.tools[0]!, home)
        : await api.setSkill(step.source, step.marketName, step.plugin, step.skill!, step.tools[0]!, step.action === 'skill-on', home);
    } catch { result = { reports: failedFor(step.tools, 'It stopped unexpectedly. Refresh to see where it stands.') }; }
    if (result.stopped) return { done, stopped: result.stopped };
    for (const report of result.reports) done.push({ source: step.source, marketName: step.marketName, plugin: step.plugin, tool: report.tool, action: step.action, ...(step.skill ? { skill: step.skill } : {}), report });
  }
  return { done };
}
