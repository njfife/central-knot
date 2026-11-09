// Plugins: what the person has chosen but not applied yet, and what Apply all and its Undo run.
// Pure functions over plain data, so the plan can be read, tested and changed without the page or the engine.
import type { ActionReport, HarnessId, PluginActionResult, PluginsView } from './types.ts';

export type PluginAction = 'install' | 'remove';
/** One tool's change for one plugin from one marketplace. */
export interface PluginOp { source: string; market: string; plugin: string; tool: HarnessId; action: PluginAction }
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
 * listed, a tool whose CLI is gone or that holds another marketplace of this name, an install already in place, and an
 * uninstall of something no longer installed.
 */
export function prune(draft: PluginDraft, view: PluginsView | undefined): void {
  for (const [key, op] of draft) {
    const entry = view?.marketplaces.find(candidate => candidate.source === op.source);
    const state = entry?.plugins.some(plugin => plugin.name === op.plugin) ? entry.states[op.plugin]?.[op.tool]?.state ?? 'not-installed' : undefined;
    const stale = !state || !view?.clis[op.tool] || state === 'held' || (op.action === 'install' && state === 'installed') || (op.action === 'remove' && state !== 'installed');
    if (stale) draft.delete(key);
  }
}

/** Counts for the change bar. */
export function summary(draft: PluginDraft) {
  const ops = [...draft.values()];
  return { plugins: new Set(ops.map(op => pluginKey(op.source, op.plugin))).size, installs: ops.filter(op => op.action === 'install').length, removals: ops.filter(op => op.action === 'remove').length };
}

/** Runs in a fixed, readable order: per plugin, installs first (one command per tool set), then removals tool by tool. */
export function batches(ops: PluginOp[]): { source: string; market: string; plugin: string; action: PluginAction; tools: HarnessId[] }[] {
  const out: ReturnType<typeof batches> = [];
  const plugins = [...new Map(ops.map(op => [pluginKey(op.source, op.plugin), op])).values()];
  for (const first of plugins) {
    const mine = ops.filter(op => op.source === first.source && op.plugin === first.plugin);
    const installs = mine.filter(op => op.action === 'install').map(op => op.tool);
    if (installs.length) out.push({ source: first.source, market: first.market, plugin: first.plugin, action: 'install', tools: installs });
    for (const op of mine.filter(candidate => candidate.action === 'remove')) out.push({ source: op.source, market: op.market, plugin: op.plugin, action: 'remove', tools: [op.tool] });
  }
  return out;
}

/** The way back: only what this run really changed, reversed. "Already installed", failures and unknowns are left alone. */
export const reverse = (done: PluginDone[]): PluginOp[] => done
  .filter(entry => entry.report.changed)
  .map(({ report: _report, ...op }) => ({ ...op, action: op.action === 'install' ? 'remove' : 'install' }));

/** A tool did what was asked (installed or uninstalled), whether this run changed it or it already was. */
export const succeeded = (report: ActionReport) => report.outcome === 'installed' || report.outcome === 'uninstalled';

/**
 * One line per plugin and outcome, e.g. "document-tools: installed in Claude Code and Codex". What a tool already had
 * is said as such ("already in Codex"), never as a change this run made. For an Undo, the verbs say what came back:
 * "removed from" for an install reversed, "put back in" for an uninstall reversed.
 */
export function describe(done: PluginDone[], names: Record<HarnessId, string>, andList: (items: string[]) => string, undo = false): { plugin: string; ok: boolean; text: string }[] {
  const lines: { plugin: string; ok: boolean; text: string }[] = [];
  const verbs = undo ? { installed: 'put back in', uninstalled: 'removed from' } : { installed: 'installed in', uninstalled: 'uninstalled from' };
  for (const key of new Set(done.map(entry => pluginKey(entry.source, entry.plugin)))) {
    const mine = done.filter(entry => pluginKey(entry.source, entry.plugin) === key);
    const plugin = mine[0]!.plugin;
    const tools = (outcome: ActionReport['outcome'], changed: boolean) => mine.filter(entry => entry.report.outcome === outcome && !!entry.report.changed === changed).map(entry => names[entry.tool]);
    const phrase = (list: string[], text: string) => (list.length ? `${text} ${andList(list)}` : '');
    const parts = [phrase(tools('installed', true), verbs.installed), phrase(tools('uninstalled', true), verbs.uninstalled), phrase(tools('installed', false), 'already in'), phrase(tools('uninstalled', false), 'wasn’t installed in')].filter(Boolean);
    if (parts.length) lines.push({ plugin, ok: true, text: parts.join('; ') });
    for (const entry of mine.filter(candidate => !succeeded(candidate.report))) lines.push({ plugin, ok: false, text: `${names[entry.tool]}: ${entry.report.message}` });
  }
  return lines;
}

/** The successful lines as one sentence: "document-tools: installed in Codex." or, for an Undo, "Undone: document-tools removed from Codex." */
export function resultSentence(lines: ReturnType<typeof describe>, undo: boolean): string {
  const ok = lines.filter(line => line.ok);
  return undo ? `Undone: ${ok.map(line => `${line.plugin} ${line.text}`).join('; ')}.` : `${ok.map(line => `${line.plugin}: ${line.text}`).join('; ')}.`;
}

/** What an Undo did not get to: ops it was given that did not come back changed (stopped before them, or failed). */
export const notUndone = (ops: PluginOp[], done: PluginDone[]): PluginOp[] => ops.filter(op => !done.some(entry => entry.report.changed && opKey(entry) === opKey(op)));

/** The two calls a run needs, as the page's API gives them (tests pass their own). */
export interface PlanApi {
  install(source: string, plugin: string, tools: HarnessId[], home: string): Promise<PluginActionResult>;
  uninstall(source: string, market: string, plugin: string, tool: HarnessId, home: string): Promise<PluginActionResult>;
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
      result = step.action === 'install'
        ? await api.install(step.source, step.plugin, step.tools, home)
        : await api.uninstall(step.source, step.market, step.plugin, step.tools[0]!, home);
    } catch { result = { reports: failedFor(step.tools, 'It stopped unexpectedly. Refresh to see where it stands.') }; }
    if (result.stopped) return { done, stopped: result.stopped };
    for (const report of result.reports) done.push({ source: step.source, market: step.market, plugin: step.plugin, tool: report.tool, action: step.action, report });
  }
  return { done };
}
