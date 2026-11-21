// What a running session of each tool needs to pick up a skill, MCP server or agent written or turned on there: one table
// (reloadTable), one chronological settler (settleReloads) and one reducer (reloadAdvice).
// Travel: every writing engine returns required `reloads: ReloadChange[]` (librarypass.ts, skills.ts, everything.ts,
// profiles.ts, homepass.ts, sources.ts, pluginlibrary.ts, plugins.ts via destinationReloads and pluginReloads); every writing
// page route passes those changes through app.ts `withReloads` / `tellWritten` (or pluginstate.ts `runReloads`), which settles
// on/off changes with `settleReloads` and sets `Outcome.reloads` only when `hasReloadAdvice` holds. Omitting `reloads` is a type error.
// Facts: ck-one-switch-plan/judges/facts-signin-reload-2.md §1b (plan folder). No tool session is stopped, restarted or sent a command.
import { itemKey, type ItemKind } from './library.ts';
import { succeeded, type PluginDone } from './pluginplan.ts';
import type { DestinationResult, HarnessId } from './types.ts';
import { byToolOrder } from './words.ts';

export interface ReloadStep { readonly text: string; readonly command?: string; readonly chip?: string; readonly title?: string; readonly rank: number }
/** One confirmed change in order: `on: true` advises, a later `on: false` for the same slot cancels it. */
export interface ReloadChange { tool: HarnessId; kind: ItemKind; key?: string; on: boolean; plugin?: string }
export interface ReloadItem { tool: HarnessId; text: string; command?: string; chip?: string; title?: string }
export interface ReloadAdvice { text: string; items: ReloadItem[] }

const NONE: ReloadStep = { text: '', rank: 0 };
const PI_SKILL: ReloadStep = { text: 'In Pi, type /reload.', command: '/reload', chip: 'Pi: /reload', title: 'Type this in your Pi session.', rank: 2 };
const OPENCODE_RESTART: ReloadStep = { text: 'Restart OpenCode.', chip: 'OpenCode: restart', rank: 5 };

export const reloadTable: Record<HarnessId, Record<ItemKind, ReloadStep>> = {
  'claude-cli': { skill: NONE, agent: NONE, mcp: { text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', chip: 'Claude Code: claude --continue', title: 'Quit Claude Code, then run this in a terminal: it keeps the chat.', rank: 5 } },
  'copilot-cli': { skill: { text: 'In Copilot CLI, type /skills reload.', command: '/skills reload', chip: 'Copilot CLI: /skills reload', title: 'Type this in your Copilot CLI session.', rank: 2 }, mcp: NONE, agent: { text: 'In Copilot CLI, start a new session.', chip: 'Copilot CLI: new session', rank: 3 } },
  'codex-cli': { skill: { text: 'Codex picks it up at the next turn; if not, start a new chat.', rank: 1 }, mcp: { text: 'In Codex, type /new or restart it.', command: '/new', chip: 'Codex: /new', title: 'Type this in your Codex session, or restart Codex.', rank: 4 }, agent: { text: 'In Codex, start a new session.', chip: 'Codex: new session', rank: 3 } },
  // Pi has no native agents: Central Knot keeps one in its skills folder (agents.ts), so it takes Pi's skill line.
  'pi-cli': { skill: PI_SKILL, mcp: PI_SKILL, agent: PI_SKILL },
  'opencode-cli': { skill: OPENCODE_RESTART, mcp: OPENCODE_RESTART, agent: { text: 'In OpenCode, start a new session.', chip: 'OpenCode: new session', rank: 3 } },
};

export const toItemKind = (kind: 'skills' | 'mcp' | 'agents'): ItemKind => (kind === 'skills' ? 'skill' : kind === 'agents' ? 'agent' : 'mcp');
export const reloadLine = (tool: HarnessId, kind: ItemKind): string => reloadTable[tool][kind].text;

/** Confirmed changes in a pass's results: additions/enables (`on: true`, never switched off) and removals/disables (`on: false`). */
export const destinationReloads = (results: readonly DestinationResult[], kind?: ItemKind): ReloadChange[] => results.flatMap(entry => {
  const of = kind ?? (entry.of && toItemKind(entry.of));
  if (!of || !entry.harness || entry.unchanged) return [];
  const key = itemKey(entry.item);
  if (entry.outcome === 'written' && !entry.switchedOff) return [{ tool: entry.harness, kind: of, key, on: true }];
  if (entry.outcome === 'switched') return [{ tool: entry.harness, kind: of, key, on: entry.disabled === false }];
  return entry.outcome === 'removed' ? [{ tool: entry.harness, kind: of, key, on: false }] : [];
});

export const reloadsFor = (changes: readonly ReloadChange[], keys: ReadonlySet<string>): ReloadChange[] =>
  changes.filter(change => change.key !== undefined && keys.has(change.key));

/** Reduces chronological changes so the last confirmed change per (tool, kind, plugin, key) decides what stands. */
export function settleReloads(changes: readonly ReloadChange[]): ReloadChange[] {
  const live = new Map<string, ReloadChange>();
  for (const { tool, kind, key, on, plugin } of changes) {
    const slot = `${tool}\0${kind}\0${plugin ?? ''}\0${key ?? ''}`;
    if (on) live.set(slot, { tool, kind, on: true, ...(key ? { key } : {}), ...(plugin ? { plugin } : {}) }); else live.delete(slot);
  }
  return [...live.values()];
}

export const pluginReloads = (done: readonly PluginDone[]): ReloadChange[] => done.flatMap(entry =>
  (!entry.report.changed || !succeeded(entry.report) ? [] : entry.report.reloads ?? []));

/** One entry per tool needing an action (strongest rank per tool, in tool order) with its sentence, chip and Copy command. */
export function reloadAdvice(writes: readonly ReloadChange[]): ReloadAdvice {
  const best = new Map<HarnessId, ReloadStep>();
  for (const { tool, kind } of writes) { const step = reloadTable[tool][kind]; if (step.rank > (best.get(tool)?.rank ?? 0)) best.set(tool, step); }
  const items = [...best.entries()].sort(([first], [second]) => byToolOrder(first, second)).map(([tool, step]): ReloadItem =>
    ({ tool, text: step.text, ...(step.command ? { command: step.command } : {}), ...(step.chip ? { chip: step.chip, title: step.title ?? step.text } : {}) }));
  return { text: items.map(item => item.text).join(' '), items };
}

export const hasReloadAdvice = (writes: readonly ReloadChange[] | undefined): boolean => !!writes?.length && reloadAdvice(writes).items.length > 0;
export const rowReload = (writes: readonly ReloadChange[] | undefined, kind: ItemKind, key: string, tool: HarnessId, plugin?: string): string =>
  writes ? reloadAdvice(writes.filter(write => write.kind === kind && write.key === key && write.tool === tool && (plugin ? write.plugin === plugin : !write.plugin))).text : '';
