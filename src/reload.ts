// What a running session of each tool needs to pick up a skill, MCP server or agent written or turned on there: one table
// keyed by tool, kind and way in (CLI, desktop app, or both: reloadTable, reloadStep), one chronological settler
// (settleReloads) and one reducer (reloadAdvice). Every place that says reload words asks this table.
// Travel: every writing engine returns required `reloads: ReloadChange[]` (librarypass.ts, skills.ts, everything.ts,
// profiles.ts, homepass.ts, sources.ts, pluginlibrary.ts, plugins.ts via destinationReloads and pluginReloads); every writing
// page route passes those changes through app.ts `withReloads` / `tellWritten` (or pluginstate.ts `runReloads`), which settles
// on/off changes with `settleReloads` and sets `Outcome.reloads` only when `hasReloadAdvice` holds. Omitting `reloads` is a type error.
// Facts: ck-one-switch-plan/judges/groundwork-reload.md and facts-signin-reload-2.md §1b. No tool session is stopped, restarted or sent a command.
import { itemKey, type ItemKind } from './library.ts';
import { succeeded, type PluginDone } from './pluginplan.ts';
import type { DestinationResult, HarnessId, Snapshot } from './types.ts';
import { byToolOrder } from './words.ts';

export type ToolWay = 'cli' | 'app' | 'both';
export type ToolWays = Partial<Record<HarnessId, ToolWay>>;
export interface ReloadChip { readonly chip: string; readonly command?: string; readonly title: string }
export interface ReloadStep { readonly text: string; readonly command?: string; readonly chip?: string; readonly title?: string; readonly more?: readonly ReloadChip[]; readonly rank: number }
/** One confirmed change in order: `on: true` advises, a later `on: false` for the same slot cancels it. */
export interface ReloadChange { tool: HarnessId; kind: ItemKind; key?: string; on: boolean; plugin?: string }
export interface ReloadItem { tool: HarnessId; text: string; command?: string; chip?: string; title?: string; more?: ReloadChip[] }
export interface ReloadAdvice { text: string; items: ReloadItem[] }
type WaySteps = Record<ToolWay, ReloadStep>;
type ToolSteps = Record<ItemKind, WaySteps> & { plugin?: WaySteps };

const NONE: ReloadStep = { text: '', rank: 0 };
const same = (step: ReloadStep): WaySteps => ({ cli: step, app: step, both: step });
const restartApp = (chipName: string, phrase = chipName, rank = 5): ReloadStep => ({ text: `Restart ${phrase}.`, chip: `${chipName}: restart`, rank });
const appMore = (chipName: string, phrase = chipName): ReloadChip => ({ chip: `${chipName}: restart`, title: `Restart ${phrase}.` });
const typeCmd = (where: string, command: string, chipName = where, title = `Type this in your ${chipName} session.`): ReloadStep =>
  ({ text: `In ${where}, type ${command}.`, command, chip: `${chipName}: ${command}`, title, rank: 2 });
const newSession = (where: string, chipName = where, rank = 3): ReloadStep => ({ text: `In ${where}, start a new session.`, chip: `${chipName}: new session`, rank });
const orRestartApp = (cli: ReloadStep, chipName: string, phrase = chipName, rank = cli.rank): ReloadStep =>
  ({ ...cli, text: `${cli.text.slice(0, -1)}, or restart ${phrase}.`, title: cli.title ?? cli.text, more: [...(cli.more ?? []), appMore(chipName, phrase)], rank });
const restartWays = (name: string, command: string, app: string, title = `Quit ${name}, then run this in a terminal: it keeps the chat.`): WaySteps => ({
  cli: { text: `Restart ${name} (${command} keeps the chat).`, command, chip: `${name}: ${command}`, title, rank: 5 },
  app: restartApp(app),
  both: { text: `Restart ${name} (${command} keeps the chat) or ${app}.`, command, chip: `${name}: ${command}`, title, more: [appMore(app)], rank: 5 },
});

const COPILOT_APP = restartApp('GitHub Copilot app', 'the GitHub Copilot app');
const CODEX_RESUME: ReloadChip = { chip: 'codex resume --last', command: 'codex resume --last', title: 'Quit Codex, then run this in a terminal: it keeps the chat.' };
const CODEX_MCP_CLI: ReloadStep = {
  text: 'In Codex, type /new, or restart it (codex resume --last keeps the chat).',
  command: '/new', chip: 'Codex: /new', title: 'Type this in your Codex session.', more: [CODEX_RESUME], rank: 4,
};
const PI_CLI = typeCmd('Pi', '/reload');
const PI_ALL: WaySteps = { cli: PI_CLI, app: restartApp('pi-gui'), both: orRestartApp(PI_CLI, 'pi-gui') };
const OPENCODE_RESTART = restartWays('OpenCode', 'opencode --continue', 'OpenCode desktop');

export const reloadTable: Record<HarnessId, ToolSteps> = {
  'claude-cli': {
    skill: same(NONE), agent: same(NONE),
    // Claude Code plugins load from installed_plugins.json, so plugin skills and agents need /reload-plugins; plugin MCP servers still need a restart (mcp, rank 5).
    plugin: {
      cli: typeCmd('Claude Code', '/reload-plugins'),
      app: {
        text: 'In Claude desktop’s Code tab, type /reload-plugins or start a new session.',
        command: '/reload-plugins', chip: 'Claude desktop: /reload-plugins', title: 'Type this in Claude desktop’s Code tab, or start a new session.', rank: 2,
      },
      both: typeCmd('Claude Code or Claude desktop’s Code tab', '/reload-plugins', 'Claude Code / desktop', 'Type this in Claude Code or Claude desktop’s Code tab.'),
    },
    mcp: restartWays('Claude Code', 'claude --continue', 'Claude desktop'),
  },
  'copilot-cli': {
    skill: {
      cli: typeCmd('Copilot CLI', '/skills reload'),
      app: typeCmd('the GitHub Copilot app', '/skills reload', 'GitHub Copilot app'),
      both: typeCmd('Copilot CLI or the GitHub Copilot app', '/skills reload', 'Copilot CLI / app', 'Type this in Copilot CLI or the GitHub Copilot app.'),
    },
    mcp: { cli: NONE, app: COPILOT_APP, both: { ...COPILOT_APP, text: 'Restart the GitHub Copilot app if it is open.', rank: 4 } },
    agent: { cli: newSession('Copilot CLI'), app: COPILOT_APP, both: orRestartApp(newSession('Copilot CLI'), 'GitHub Copilot app', 'the GitHub Copilot app', 5) },
  },
  'codex-cli': {
    skill: same({ text: 'Codex picks it up at the next turn; if not, start a new chat.', rank: 1 }),
    mcp: {
      cli: CODEX_MCP_CLI,
      app: restartApp('ChatGPT desktop', 'the ChatGPT desktop app', 4),
      both: {
        ...CODEX_MCP_CLI,
        text: 'In Codex, type /new, or restart it (codex resume --last keeps the chat); restart the ChatGPT desktop app if it is open.',
        more: [CODEX_RESUME, appMore('ChatGPT desktop', 'the ChatGPT desktop app')],
      },
    },
    agent: { cli: newSession('Codex'), app: newSession('ChatGPT desktop'), both: newSession('Codex or ChatGPT desktop', 'Codex / ChatGPT desktop') },
  },
  // Pi has no native agents: Central Knot keeps one in its skills folder (agents.ts), so it takes Pi's skill line.
  'pi-cli': { skill: PI_ALL, mcp: PI_ALL, agent: PI_ALL },
  'opencode-cli': {
    skill: OPENCODE_RESTART, mcp: OPENCODE_RESTART,
    agent: { cli: newSession('OpenCode'), app: restartApp('OpenCode desktop'), both: orRestartApp(newSession('OpenCode'), 'OpenCode desktop') },
  },
};

export const toItemKind = (kind: 'skills' | 'mcp' | 'agents'): ItemKind => (kind === 'skills' ? 'skill' : kind === 'agents' ? 'agent' : 'mcp');
/** How a tool is used here from its discovery snapshot: desktop app only, CLI + desktop app, or CLI (default for folders/tests). */
export const toolWay = (snapshot: Pick<Snapshot, 'detection' | 'app'> | undefined): ToolWay =>
  (snapshot?.detection === 'App only' ? 'app' : snapshot?.app ? 'both' : 'cli');
export const waysFrom = (snapshots: readonly Pick<Snapshot, 'harness' | 'detection' | 'app'>[] | undefined): ToolWays =>
  Object.fromEntries((snapshots ?? []).map(snapshot => [snapshot.harness, toolWay(snapshot)]));
export const reloadStep = (tool: HarnessId, kind: ItemKind, way: ToolWay = 'cli', plugin = false): ReloadStep =>
  (plugin && kind !== 'mcp' && reloadTable[tool].plugin ? reloadTable[tool].plugin![way] : reloadTable[tool][kind][way]);
export const reloadLine = (tool: HarnessId, kind: ItemKind, way: ToolWay = 'cli', plugin = false): string =>
  reloadStep(tool, kind, way, plugin).text;

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

/** One entry per tool needing an action (strongest rank per tool, in tool order) with its sentence, chips and Copy commands. */
export function reloadAdvice(writes: readonly ReloadChange[], ways: ToolWays = {}): ReloadAdvice {
  const best = new Map<HarnessId, ReloadStep>();
  for (const { tool, kind, plugin } of writes) {
    const step = reloadStep(tool, kind, ways[tool], !!plugin);
    if (step.rank > (best.get(tool)?.rank ?? 0)) best.set(tool, step);
  }
  const items = [...best.entries()].sort(([first], [second]) => byToolOrder(first, second)).map(([tool, step]): ReloadItem => ({
    tool, text: step.text, ...(step.command ? { command: step.command } : {}),
    ...(step.chip ? { chip: step.chip, title: step.title ?? step.text } : {}),
    ...(step.more ? { more: step.more.map(extra => ({ ...extra })) } : {}),
  }));
  return { text: items.map(item => item.text).join(' '), items };
}

export const hasReloadAdvice = (writes: readonly ReloadChange[] | undefined, ways?: ToolWays): boolean =>
  !!writes?.length && reloadAdvice(writes, ways).items.length > 0;
export const rowReload = (writes: readonly ReloadChange[] | undefined, kind: ItemKind, key: string, tool: HarnessId, plugin?: string, ways?: ToolWays): string =>
  writes ? reloadAdvice(writes.filter(write => write.kind === kind && write.key === key && write.tool === tool && (plugin ? write.plugin === plugin : !write.plugin)), ways).text : '';
