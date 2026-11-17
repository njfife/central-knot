// What a usage reading (types.ts UsageReading, read in main by usage.ts) says of one row on the Skills, MCP servers and Agents
// pages. Pure, for the page: which names in each tool's history are a row's item, by that tool's spelling rules (`spelledIn`,
// a row per tool, as usage.ts readers has); what each tool's history says of it (`toolSays`); and the row's one figure
// (`rowFigure`); and the "No use seen in 30 days" filter's rule (`noUseSeen`), with the items its Turn these off leaves to
// their own row (`leftToItsRow`). The 30 days (`USAGE_DAYS`) are here, read by usage.ts too. A use seen always counts; only a
// tool whose records are sure for the kind (types.ts UsageTells) can say that none was seen. Not here: reading the history
// (usage.ts) and the words and drawing (matrix.ts).
import type { ItemKind, LibraryItem } from './library.ts';
import { DAY_MS } from './model.ts';
import { agentsKeptIn } from './presence.ts';
import { pluginOf } from './sourcelink.ts';
import type { HarnessId, LibraryFacts, ToolUsage, UsageReading } from './types.ts';

/** How many days back a figure counts uses. */
export const USAGE_DAYS = 30;

/** What of a row's item the match reads (types.ts LibraryFacts; a From plugins row gives the same: matrix.ts pluginUsageFacts). */
export type UsageFacts = Pick<LibraryFacts, 'key' | 'name' | 'copies' | 'plugin' | 'switchedOff' | 'loads'>;
/** The names one item goes by in one tool: its own (its key and name, and that tool's copy's folder and name), and the plugin it comes through there. */
interface ItemNames { own: string[]; plugin?: { plugin: string; name: string } }

/** Claude Code's spelling of an MCP server in a tool's name: every character but letters, digits, `_` and `-` as `_`. */
export const claudeServer = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');
/** Pi's: every character but letters, digits and `_` as `_` (its older sessions kept the name as it was). */
export const piServer = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * Each tool's spelling rules: the names in its history that are this item, for a kind. Every tool knows an item by its own
 * names, so a use of another copy of the same name counts. Claude Code calls a plugin's skill or agent `plugin:name` and its
 * server `plugin_<plugin>_<server>`, every server name rewritten (claudeServer); Pi rewrites a server's name too (piServer);
 * Copilot CLI names a plugin's skill by the skill's own name.
 */
export const spelledIn: Record<HarnessId, (names: ItemNames, kind: ItemKind) => string[]> = {
  'claude-cli': ({ own, plugin }, kind) => (kind === 'mcp'
    ? [...own.map(claudeServer), ...(plugin ? [`plugin_${claudeServer(plugin.plugin)}_${claudeServer(plugin.name)}`] : [])]
    : [...own, ...(plugin ? [`${plugin.plugin}:${plugin.name}`] : [])]),
  'codex-cli': ({ own }) => own,
  'copilot-cli': ({ own, plugin }) => [...own, ...(plugin ? [plugin.name] : [])],
  'pi-cli': ({ own }, kind) => (kind === 'mcp' ? [...own, ...own.map(piServer)] : own),
  'opencode-cli': ({ own }) => own,
};

/** The names a tool's own copy goes by: its folder and name, each also without a file's `.md` (Pi keeps an agent as `<name>.md`). */
const copyNames = (facts: UsageFacts, tool: HarnessId) =>
  [facts.copies[tool]?.folder, facts.copies[tool]?.name].flatMap(name => (name ? [name, name.replace(/\.md$/i, '')] : []));

/** A row's names in one tool (spelledIn's input). */
function namesOf(facts: UsageFacts, tool: HarnessId): ItemNames {
  const through = facts.plugin?.[tool];
  return { own: [facts.key, facts.name, ...copyNames(facts, tool)], ...(through ? { plugin: { plugin: through.plugin, name: through.name ?? facts.name } } : {}) };
}

/** Why a tool can't say that an item was not used: no record of its kind, a record a use may not leave, no session kept, or sessions that couldn't all be read. */
export type CantSay = 'no-record' | 'not-sure' | 'no-sessions' | 'unread';

/** What one tool's history says of one item. */
export interface ToolSays {
  tool: HarnessId;
  /** The sessions within USAGE_DAYS that used it. */
  sessions: number;
  /** Its newest use there, at any time. */
  last?: string;
  /** Set when no use seen there does not mean none. */
  cantSay?: CantSay;
  /** When its history starts, where that is later than USAGE_DAYS before the reading (startsLate). */
  since?: string;
}

/** Why a tool's history can't say an item of this kind wasn't used, if it can't. */
export const cantSayFor = (history: ToolUsage, kind: ItemKind): CantSay | undefined =>
  history.unread || history.skipped ? 'unread' : !history.tells[kind] ? 'no-record' : history.tells[kind] === 'seen' ? 'not-sure' : !history.sessions ? 'no-sessions' : undefined;

/** Whether a tool's history starts later than USAGE_DAYS before the reading: it counts as far back as it goes. */
export const startsLate = (reading: Pick<UsageReading, 'at'>, from: string | undefined) => !!from && Date.parse(from) > Date.parse(reading.at) - USAGE_DAYS * DAY_MS;

/** The kind a tool's records give this kind's uses, where it keeps the kind as another: an agent kept in a skills folder (presence.ts agentsKeptIn: Pi) is used as a skill. */
const keptAs = (kind: ItemKind, tool: HarnessId): ItemKind | undefined =>
  (kind === 'agent' && (agentsKeptIn as Partial<Record<HarnessId, string>>)[tool] === 'skills folder' ? 'skill' : undefined);

/**
 * What one tool's history in a reading says of a row's item (none: that tool wasn't read). A use counts by the kind's spelling,
 * or, in a tool that keeps the kind as another (keptAs), a use of that other kind that names the row's own copy there.
 */
export function toolSays(reading: UsageReading, kind: ItemKind, facts: UsageFacts, tool: HarnessId): ToolSays | undefined {
  const history = reading.tools.find(each => each.tool === tool);
  if (!history) return undefined;
  const names = new Set(spelledIn[tool](namesOf(facts, tool), kind).map(name => name.toLowerCase())), copy = new Set(copyNames(facts, tool).map(name => name.toLowerCase()));
  const hits = history.used.filter(used => (used.kind === kind ? names.has(used.name.toLowerCase()) : used.kind === keptAs(kind, tool) && copy.has(used.name.toLowerCase())));
  const last = hits.map(hit => hit.last).sort().at(-1), cantSay = cantSayFor(history, kind);
  return { tool, sessions: new Set(hits.flatMap(hit => hit.sessions)).size, ...(last ? { last } : {}), ...(cantSay ? { cantSay } : {}), ...(startsLate(reading, history.from) ? { since: history.from } : {}) };
}

/** The tools that have an item on: their own copy, not switched off there by the tool's own switch, or a plugin's, not turned off there. */
export const onIn = (facts: UsageFacts, tools: readonly HarnessId[]) => tools.filter(tool =>
  (facts.copies[tool] && !facts.switchedOff?.includes(tool) && !facts.loads?.[tool]?.switchedOff) || (facts.plugin?.[tool] && !facts.plugin[tool]!.off));

/**
 * A row's one figure: `used`, the newest use where a tool saw one within USAGE_DAYS; `noneSeen`, none seen, and a tool that has
 * it on can say so, `since` the earliest start among those tools when every one starts later than USAGE_DAYS ago; undefined,
 * nothing to say (no tool that has it on can tell).
 */
export type RowFigure = { used: string } | { noneSeen: true; since?: string } | undefined;
export function rowFigure(says: readonly ToolSays[], on: readonly HarnessId[]): RowFigure {
  const used = says.filter(each => each.sessions > 0).map(each => each.last!).sort().at(-1), telling = says.filter(each => !each.cantSay && on.includes(each.tool));
  if (used || !telling.length) return used ? { used } : undefined;
  return telling.every(each => each.since) ? { noneSeen: true, since: telling.map(each => each.since!).sort()[0] } : { noneSeen: true };
}

/** An item's newest use in any tool (ms), for the "Last used" order; undefined: none seen. */
export const lastUse = (says: readonly ToolSays[]) => { const last = says.map(each => each.last ?? '').sort().at(-1); return last ? Date.parse(last) : undefined; };

/**
 * Where an item stands for the "No use seen in 30 days" filter (council 1, 2026-11-16): `in` when it is On, no tool saw a use
 * within USAGE_DAYS, a tool that has it on can tell for its kind (rowFigure's `noneSeen`; a history shorter than USAGE_DAYS
 * counts as far back as it goes), and its oldest version is at least USAGE_DAYS older than the reading; `new` when only that
 * age keeps it out; undefined otherwise: Off, deleted or found, a use seen, or no tool that has it on can tell ("can't say").
 */
export function noUseSeen(item: LibraryItem | undefined, figure: RowFigure, readingAt: string): 'in' | 'new' | undefined {
  if (!item?.on || item.deleted || !figure || !('noneSeen' in figure)) return undefined;
  const oldest = Math.min(...item.versions.map(version => Date.parse(version.at)));
  return oldest <= Date.parse(readingAt) - USAGE_DAYS * DAY_MS ? 'in' : 'new';
}

/** Whether Turn these off leaves an item to its own row: a plugin's item (a tool has it through one), or one linked to a plugin. */
export const leftToItsRow = (facts: LibraryFacts) => Object.keys(facts.plugin ?? {}).length > 0 || !!(facts.fromSource && pluginOf(facts.fromSource.link));
