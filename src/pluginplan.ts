// Plugins: what the person has chosen but not applied yet, and what Apply all and its Undo run.
// Pure functions over plain data, so the plan can be read, tested and changed without the page or the engine.
import type { ActionReport, HarnessId } from './types.ts';

export type PluginAction = 'install' | 'remove';
/** One tool's change for one plugin from one marketplace. */
export interface PluginOp { source: string; market: string; plugin: string; tool: HarnessId; action: PluginAction }
/** What one op did, as its tool reported it. */
export interface PluginDone extends PluginOp { report: ActionReport }

/** Chosen changes, keyed by marketplace source, plugin and tool. Nothing here has run. */
export type PluginDraft = Map<string, PluginOp>;

const keyOf = (op: Pick<PluginOp, 'source' | 'plugin' | 'tool'>) => `${op.source}\u0000${op.plugin}\u0000${op.tool}`;

/** Takes one change out of the draft, once it has run. */
export const clear = (draft: PluginDraft, op: Pick<PluginOp, 'source' | 'plugin' | 'tool'>) => { draft.delete(keyOf(op)); };

export const queued = (draft: PluginDraft, source: string, plugin: string, tool: HarnessId) => draft.get(keyOf({ source, plugin, tool }))?.action;

/** Choosing the same change again takes it back; a different one replaces it. */
export function toggle(draft: PluginDraft, op: PluginOp): void {
  const key = keyOf(op);
  if (draft.get(key)?.action === op.action) draft.delete(key);
  else draft.set(key, op);
}

/** Queues or clears one action for several tools at once: all queued already means take them all back. */
export function toggleMany(draft: PluginDraft, ops: PluginOp[]): void {
  const all = ops.length > 0 && ops.every(op => draft.get(keyOf(op))?.action === op.action);
  for (const op of ops) { if (all) draft.delete(keyOf(op)); else draft.set(keyOf(op), op); }
}

/** Counts for the change bar. */
export function summary(draft: PluginDraft) {
  const ops = [...draft.values()];
  return { plugins: new Set(ops.map(op => `${op.source}\u0000${op.plugin}`)).size, installs: ops.filter(op => op.action === 'install').length, removals: ops.filter(op => op.action === 'remove').length };
}

/** Runs in a fixed, readable order: per plugin, installs first (one command per tool set), then removals tool by tool. */
export function batches(ops: PluginOp[]): { source: string; market: string; plugin: string; action: PluginAction; tools: HarnessId[] }[] {
  const out: ReturnType<typeof batches> = [];
  const plugins = [...new Map(ops.map(op => [`${op.source}\u0000${op.plugin}`, op])).values()];
  for (const first of plugins) {
    const mine = ops.filter(op => op.source === first.source && op.plugin === first.plugin);
    const installs = mine.filter(op => op.action === 'install').map(op => op.tool);
    if (installs.length) out.push({ source: first.source, market: first.market, plugin: first.plugin, action: 'install', tools: installs });
    for (const op of mine.filter(candidate => candidate.action === 'remove')) out.push({ source: op.source, market: op.market, plugin: op.plugin, action: 'remove', tools: [op.tool] });
  }
  return out;
}

/** The way back: what really changed, reversed. Anything that failed or isn't known is left alone. */
export const reverse = (done: PluginDone[]): PluginOp[] => done
  .filter(entry => (entry.action === 'install' && entry.report.outcome === 'installed') || (entry.action === 'remove' && entry.report.outcome === 'uninstalled'))
  .map(({ report: _report, ...op }) => ({ ...op, action: op.action === 'install' ? 'remove' : 'install' }));

/** One line per plugin and outcome, e.g. "document-skills: installed in Claude Code and Codex". */
export function describe(done: PluginDone[], names: Record<HarnessId, string>): { plugin: string; ok: boolean; text: string }[] {
  const list = (tools: HarnessId[]) => { const shown = tools.map(tool => names[tool]); return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown.join(''); };
  const lines: { plugin: string; ok: boolean; text: string }[] = [];
  for (const plugin of [...new Set(done.map(entry => entry.plugin))]) {
    const mine = done.filter(entry => entry.plugin === plugin);
    const installed = mine.filter(entry => entry.report.outcome === 'installed').map(entry => entry.tool);
    const removed = mine.filter(entry => entry.report.outcome === 'uninstalled').map(entry => entry.tool);
    const parts = [installed.length ? `installed in ${list(installed)}` : '', removed.length ? `uninstalled from ${list(removed)}` : ''].filter(Boolean);
    if (parts.length) lines.push({ plugin, ok: true, text: parts.join('; ') });
    for (const entry of mine.filter(candidate => !['installed', 'uninstalled'].includes(candidate.report.outcome))) lines.push({ plugin, ok: false, text: `${names[entry.tool]}: ${entry.report.message}` });
  }
  return lines;
}
