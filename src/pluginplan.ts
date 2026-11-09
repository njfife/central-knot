// Plugins: what the person has chosen but not applied yet, and what Apply all and its Undo run.
// Pure functions over plain data, so the plan can be read, tested and changed without the page or the engine.
import { cantUninstall, installed, partsOf, partsOffer, unavailable } from './pluginstatus.ts';
import type { ActionReport, HarnessId, PluginActionResult, PluginsView } from './types.ts';
import { andList, byToolOrder, toolNames as names } from './words.ts';

/**
 * install, remove: the plugin itself, through the tool's own command. install-parts: its parts as separate items in a tool that
 * can't take the plugin (installed, or brought up to date); remove-parts: those parts out again; undo-parts: an Undo of a
 * parts run (`run`), which only Undo makes.
 */
export type PluginAction = 'install' | 'remove' | 'install-parts' | 'remove-parts' | 'undo-parts';
/** The parts engine's mode for a parts action (installing also brings parts up to date); undefined for the plugin itself. */
const PARTS_MODES: Partial<Record<PluginAction, 'install' | 'remove' | 'undo'>> = { 'install-parts': 'install', 'remove-parts': 'remove', 'undo-parts': 'undo' };
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
  /** For undo-parts: the parts run it reverses. */
  run?: string;
}
/** One line of a run's result: a plugin and what happened to it ("installed in Codex"), or one tool's failure. */
export interface ResultLine {
  source: string;
  plugin: string;
  ok: boolean;
  text: string;
  /** The same with three or more tools counted, not named ("installed in 3 tools"), for a narrow place. */
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
const opKey = (op: Pick<PluginOp, 'source' | 'plugin' | 'tool'>) => `${pluginKey(op.source, op.plugin)}\u0000${op.tool}`;
/** Whether a plugin key (or a key made from one) belongs to this marketplace. */
export const forSource = (key: string, source: string) => key.startsWith(`${source}\u0000`);

export const queued = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId) => draft.get(opKey({ source, plugin, tool }))?.action;

/** Takes one change out of the draft, once it has run. */
export const clear = (draft: PluginDraft, op: Pick<PluginOp, 'source' | 'plugin' | 'tool'>) => { draft.delete(opKey(op)); };

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
 * listed, an install the tool can't take now (pluginstatus.unavailable) or already has, and an uninstall of something
 * no longer installed or that can't be uninstalled now (pluginstatus.cantUninstall).
 */
export function prune(draft: PluginDraft, view: PluginsView | undefined): void {
  for (const [key, op] of draft) {
    const entry = view?.marketplaces.find(candidate => candidate.source === op.source);
    const listed = !!entry?.plugins.some(plugin => plugin.name === op.plugin);
    // A marketplace whose catalog now gives another name is another plugin@name to the tools: the choice no longer means it.
    const parts = entry && partsOf(entry, op.plugin, op.tool);
    const stale = !view || !entry || !listed || entry.name !== op.marketName || (op.action === 'install'
      ? !!unavailable(view, entry, op.plugin, op.tool) || installed(entry, op.plugin, op.tool)
      : op.action === 'remove' ? !installed(entry, op.plugin, op.tool) || !!cantUninstall(view, entry, op.plugin, op.tool)
      : op.action === 'install-parts' ? !view.canWrite || !partsOffer(view, entry, op.plugin, op.tool) || (!!parts && !parts.changed)
      : op.action === 'remove-parts' ? !parts || !view.canWrite : true);
    if (stale) draft.delete(key);
  }
}

/** Counts for the change bar. `isUpdate`: whether a parts install is an update (that tool has the plugin's parts already). */
export function summary(draft: PluginDraft, isUpdate: (op: PluginOp) => boolean = () => false) {
  const ops = [...draft.values()];
  const count = (action: PluginAction) => ops.filter(op => op.action === action).length;
  const partsUpdates = ops.filter(op => op.action === 'install-parts' && isUpdate(op)).length;
  return { plugins: new Set(ops.map(op => pluginKey(op.source, op.plugin))).size, installs: count('install'), removals: count('remove'),
    partsInstalls: count('install-parts') - partsUpdates, partsUpdates, partsRemovals: count('remove-parts') };
}

/** Runs in a fixed, readable order: per plugin, installs first (one command per tool set), then removals and parts tool by tool. */
export function batches(ops: PluginOp[]): { source: string; marketName: string; plugin: string; action: PluginAction; tools: HarnessId[]; run?: string }[] {
  const out: ReturnType<typeof batches> = [];
  const plugins = [...new Map(ops.map(op => [pluginKey(op.source, op.plugin), op])).values()];
  for (const first of plugins) {
    const mine = ops.filter(op => op.source === first.source && op.plugin === first.plugin);
    const installs = mine.filter(op => op.action === 'install').map(op => op.tool);
    if (installs.length) out.push({ source: first.source, marketName: first.marketName, plugin: first.plugin, action: 'install', tools: installs });
    for (const op of mine.filter(candidate => candidate.action !== 'install')) out.push({ source: op.source, marketName: op.marketName, plugin: op.plugin, action: op.action, tools: [op.tool], ...(op.run ? { run: op.run } : {}) });
  }
  return out;
}

/**
 * The way back: only what this run really changed, reversed, last first (a later step may have taken what an earlier one
 * freed, such as a skill name, so it is undone first). "Already installed", failures and unknowns are left alone.
 */
export const reverse = (done: PluginDone[]): PluginOp[] => done
  .filter(entry => entry.report.changed && (!isParts(entry.action) || entry.report.partsRun))
  .map(({ report, ...op }): PluginOp => (isParts(op.action) ? { ...op, action: 'undo-parts', run: report.partsRun } : { ...op, action: op.action === 'install' ? 'remove' : 'install' }))
  .reverse();

/** A tool did what was asked (installed or uninstalled), whether this run changed it or it already was. */
export const succeeded = (report: ActionReport) => report.outcome === 'installed' || report.outcome === 'uninstalled';

/**
 * One line per plugin and outcome, e.g. "document-tools: installed in Claude Code and Codex". What a tool already had
 * is said as such ("already in Codex"), never as a change this run made. For an Undo, the verbs say what came back:
 * "removed from" for an install reversed, "put back in" for an uninstall reversed.
 */
export function resultLines(done: PluginDone[], undo = false): ResultLine[] {
  const lines: ResultLine[] = [];
  const verbs = undo ? { installed: 'put back in', uninstalled: 'removed from' } : { installed: 'installed in', uninstalled: 'uninstalled from' };
  for (const key of new Set(done.map(entry => pluginKey(entry.source, entry.plugin)))) {
    const mine = done.filter(entry => pluginKey(entry.source, entry.plugin) === key);
    const { plugin, source } = mine[0]!;
    // Tools in the page's column order, so "Codex and Pi" never reads "Pi and Codex" the next time.
    const tools = (outcome: ActionReport['outcome'], changed: boolean, parts = false, updated = false) => mine
      // An unchanged result is one group whatever kind of run it was: only a change tells an update from an install.
      .filter(entry => entry.report.outcome === outcome && !!entry.report.changed === changed && isParts(entry.action) === parts && (!changed || !!entry.report.partsUpdated === updated))
      .sort((first, second) => byToolOrder(first.tool, second.tool)).map(entry => names[entry.tool]);
    const groups: [string[], string][] = [[tools('installed', true), verbs.installed], [tools('uninstalled', true), verbs.uninstalled], [tools('installed', false), 'already in'], [tools('uninstalled', false), 'wasn’t installed in'],
      [tools('installed', true, true), undo ? 'parts put back in' : 'parts installed in'], [tools('installed', true, true, true), 'parts updated in'], [tools('uninstalled', true, true), 'parts removed from'], ...(undo ? [[[...tools('installed', false, true), ...tools('uninstalled', false, true)], 'nothing left to undo in'] as [string[], string]]
        : [[tools('installed', false, true), 'parts already up to date in'], [tools('uninstalled', false, true), 'had no parts in']] as [string[], string][])];
    const said = (counted: boolean) => groups.filter(([list]) => list.length).map(([list, verb]) => `${verb} ${counted && list.length > 2 ? `${list.length} tools` : andList(list)}`).join('; ');
    if (said(false)) lines.push({ source, plugin, ok: true, text: said(false), short: said(true) });
    for (const entry of mine.filter(candidate => !succeeded(candidate.report))) {
      const text = `${names[entry.tool]}: ${entry.report.message}`;
      lines.push({ source, plugin, ok: false, text, short: text });
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
export interface LastRun { done: PluginDone[]; undo: boolean; home: string; rest?: PluginOp[]; /** Its problem lines were read and closed; what it did (and its Undo) stays. */ problemsClosed?: boolean }

/** After a run: what ran leaves the draft (what wasn't reached stays chosen), and the run is recorded for the toolbar and its Undo. */
export function recordRun(draft: PluginDraft, ops: PluginOp[], done: PluginDone[], undo: boolean, home: string): LastRun {
  for (const entry of done) clear(draft, entry);
  return { done, undo, home, rest: undo ? notUndone(ops, done) : undefined };
}

/** The two calls a run needs, as the page's API gives them (tests pass their own). */
export interface PlanApi {
  install(source: string, marketName: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstall(source: string, marketName: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
  parts?(source: string, marketName: string, plugin: string, tool: HarnessId, mode: 'install' | 'remove' | 'undo', run: string | undefined, home: string): Promise<PluginActionResult>;
}

/**
 * Runs the ops in batches() order and returns what each tool did. A step whose call throws fails for its tools and the run
 * goes on. A refusal for the whole home (it changed, or writing isn't allowed) stops the run; that step and the rest are
 * not recorded, so they stay chosen.
 */
export async function runPlan(ops: PluginOp[], api: PlanApi, home: string, onStep: (step: ReturnType<typeof batches>[number]) => void = () => {}): Promise<{ done: PluginDone[]; stopped?: string }> {
  const done: PluginDone[] = [];
  for (const step of batches(ops)) {
    onStep(step);
    let result: PluginActionResult;
    try {
      const mode = partsMode(step.action);
      result = step.action === 'install' ? await api.install(step.source, step.marketName, step.plugin, step.tools, home)
        : step.action === 'remove' ? await api.uninstall(step.source, step.marketName, step.plugin, step.tools[0]!, home)
        : api.parts && mode ? await api.parts(step.source, step.marketName, step.plugin, step.tools[0]!, mode, step.run, home) : { reports: failedFor(step.tools, 'Parts can’t be installed here.') };
    } catch { result = { reports: failedFor(step.tools, 'It stopped unexpectedly. Refresh to see where it stands.') }; }
    if (result.stopped) return { done, stopped: result.stopped };
    for (const report of result.reports) done.push({ source: step.source, marketName: step.marketName, plugin: step.plugin, tool: report.tool, action: step.action, ...(step.run ? { run: step.run } : {}), report });
  }
  return { done };
}
