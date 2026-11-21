// What a running session of each tool needs to pick up a skill, MCP server or agent written or turned on there: one table
// (reloadTable) and one reducer over confirmed changes (reloadAdvice), shared by librarypass.ts, the click routes and the page.
// Facts: judges/facts-signin-reload-2.md §1b. No tool session is stopped, restarted or sent a command.
import { itemKey, type ItemKind } from './library.ts';
import type { PluginDone } from './pluginplan.ts';
import type { DestinationResult, HarnessId } from './types.ts';
import { byToolOrder } from './words.ts';

export interface ReloadStep { readonly text: string; readonly command?: string; readonly rank: number }
export interface ReloadWrite { tool: HarnessId; kind: ItemKind; key?: string }
export interface ReloadAction { tool: HarnessId; command: string }
export interface ReloadAdvice { text: string; actions: ReloadAction[] }

const NONE: ReloadStep = { text: '', rank: 0 };
const PI_SKILL: ReloadStep = { text: 'In Pi, type /reload.', command: '/reload', rank: 2 };
const OPENCODE_RESTART: ReloadStep = { text: 'Restart OpenCode.', rank: 5 };

export const reloadTable: Record<HarnessId, Record<ItemKind, ReloadStep>> = {
  'claude-cli': { skill: NONE, mcp: { text: 'Restart Claude Code (claude --continue keeps the chat).', command: 'claude --continue', rank: 5 }, agent: NONE },
  'copilot-cli': { skill: { text: 'In Copilot CLI, type /skills reload.', command: '/skills reload', rank: 2 }, mcp: NONE, agent: { text: 'In Copilot CLI, start a new session.', rank: 3 } },
  'codex-cli': {
    skill: { text: 'Codex picks it up at the next turn; if not, start a new chat.', rank: 1 },
    mcp: { text: 'In Codex, type /new or restart it.', command: '/new', rank: 4 },
    agent: { text: 'In Codex, start a new session.', rank: 3 },
  },
  // Pi has no native agents: Central Knot keeps one in its skills folder (agents.ts), so it takes Pi's skill line.
  'pi-cli': { skill: PI_SKILL, mcp: PI_SKILL, agent: PI_SKILL },
  'opencode-cli': { skill: OPENCODE_RESTART, mcp: OPENCODE_RESTART, agent: { text: 'In OpenCode, start a new session.', rank: 3 } },
};

export const toItemKind = (kind: 'skills' | 'mcp' | 'agents'): ItemKind => (kind === 'skills' ? 'skill' : kind === 'agents' ? 'agent' : 'mcp');
/** What one tool needs for one kind; empty string when nothing is needed. */
export const reloadLine = (tool: HarnessId, kind: ItemKind): string => reloadTable[tool][kind].text;

/** Confirmed writes or tool-switch enables in a pass's results (never unchanged, failed, held, removed or switched off). */
export const writtenReloads = (results: readonly DestinationResult[], kind?: ItemKind): ReloadWrite[] => results.flatMap(entry => {
  const of = kind ?? (entry.of && toItemKind(entry.of));
  if (!of || !entry.harness || entry.unchanged || entry.switchedOff) return [];
  return entry.outcome === 'written' || (entry.outcome === 'switched' && entry.disabled === false) ? [{ tool: entry.harness, kind: of, key: itemKey(entry.item) }] : [];
});

/** Confirmed plugin-item writes or enables (`wholeKind` only on an item list's click that turned a plugin on for that kind). */
export const pluginReloads = (done: readonly PluginDone[], wholeKind?: ItemKind, wholeKey?: string): ReloadWrite[] => done.flatMap(entry => {
  if (!entry.report.changed || ['held', 'failed', 'not-known'].includes(entry.report.outcome)) return [];
  if (entry.report.reloads?.length) return entry.report.reloads;
  if (entry.action === 'skill-on') return [{ tool: entry.tool, kind: 'skill', key: entry.skill && itemKey(entry.skill) }];
  if (entry.action === 'part-on' && entry.part) return [{ tool: entry.tool, kind: entry.part.kind, key: itemKey(entry.part.name) }];
  return entry.action === 'plugin-on' && wholeKind ? [{ tool: entry.tool, kind: wholeKind, key: wholeKey }] : [];
});

/** One sentence per tool needing an action (strongest rank per tool, in tool order) and the Copy commands they carry. */
export function reloadAdvice(writes: readonly ReloadWrite[]): ReloadAdvice {
  const best = new Map<HarnessId, ReloadStep>();
  for (const { tool, kind } of writes) { const step = reloadTable[tool][kind]; if (step.rank > (best.get(tool)?.rank ?? 0)) best.set(tool, step); }
  const ordered = [...best.entries()].sort(([first], [second]) => byToolOrder(first, second));
  return { text: ordered.map(([, step]) => step.text).join(' '), actions: ordered.flatMap(([tool, step]) => (step.command ? [{ tool, command: step.command }] : [])) };
}

/** Reload sentence for one opened row's tool line, joined to the active click result's confirmed writes by kind, row and tool. */
export const rowReload = (writes: readonly ReloadWrite[] | undefined, kind: ItemKind, key: string, tool: HarnessId): string =>
  writes ? reloadAdvice(writes.filter(write => write.kind === kind && write.key === key && write.tool === tool)).text : '';
