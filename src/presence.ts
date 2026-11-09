// Which tools are in a home. Every page offers and names only these, and sync writes only to these, so the rule lives
// here, once, for the main process and the page alike.
import type { HarnessId, Snapshot } from './types.ts';

/**
 * A tool is in this home when it really exists there: its app or CLI was detected, or its own configuration folder was
 * found (discovery marks both by leaving `detection` other than 'Not found'). Skills in a folder several tools share,
 * such as ~/.agents/skills, never count: they would make every tool that reads that folder look installed.
 */
export const isPresent = (snapshot: Snapshot): boolean => snapshot.detection !== 'Not found';

/** The tools in this home, in discovery order: the columns, boxes, menus and sentences every page draws from. */
export const presentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(isPresent).map(snapshot => snapshot.harness);

/** The tools that install plugins: every tool but Pi, which has none. */
export type PluginTool = Exclude<HarnessId, 'pi-cli'>;
export const pluginTools: PluginTool[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

/** The tools looked for and not found here, in discovery order: only the Tools page names them, as information. */
export const absentTools = (snapshots: Snapshot[]): HarnessId[] => snapshots.filter(snapshot => !isPresent(snapshot)).map(snapshot => snapshot.harness);
