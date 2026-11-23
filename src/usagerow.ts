// What a usage reading (types.ts UsageReading, read in main by usage.ts) says of one row in the Library
// pages, and of a home in sum. Pure, for the page: which names in each tool's history are a row's item, by that tool's spelling
// rules (`spelledIn`, a row per tool, as usage.ts readers has); what each tool's history says of it (`toolSays`); the row's one
// figure, its last use and how many sessions used it (`rowFigure`, for an item on its page: `figureFor`); the "No use seen in
// 30 days" chip's rule (`noUseSeen`), with the items its Turn these off leaves to their own row (`leftToItsRow`); each tool's
// sessions in the 30 days and how far back its history goes (`toolHistories`); and a reading in sum, every kind's rows by what
// it says of them, its most used, and each tool's history (`usageSummary`, which the item lists' chip and Used column and the
// Overview read). The 30 days (`USAGE_DAYS`) are here, read by usage.ts too. A use seen
// always counts; only a tool whose records are sure for the kind (types.ts UsageTells) can say that none was seen. Not here:
// reading the history (usage.ts), when it is read (app.ts collectUsage), and the words and drawing (matrix.ts).
import { kindSource } from './itemrow.ts';
import type { ItemKind, LibraryItem } from './library.ts';
import { DAY_MS } from './model.ts';
import { inLibrary } from './libraryrow.ts';
import { partOfPage } from './pluginstatus.ts';
import { agentsKeptIn } from './presence.ts';
import { offIn, pageRows, pluginTools, type PluginRow } from './pluginrows.ts';
import { pluginOf } from './sourcelink.ts';
import type { HarnessId, HomeView, LibraryFacts, ToolUsage, UsageReading } from './types.ts';

/** How many days back a figure counts uses. */
export const USAGE_DAYS = 30;

/** What of a row's item the match reads (types.ts LibraryFacts; a plugin's own row gives the same: pluginRowFacts). */
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
  // Never asked yet: Antigravity's history is not read (usage.ts readers).
  'antigravity-cli': ({ own }) => own,
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
  /** How many of its session files couldn't be read, when some were (cantSay `unread`). */
  skipped?: number;
  /** When its history starts, where that is later than USAGE_DAYS before the reading (startsLate). */
  since?: string;
}

/** At least one session file, or the history as a whole, could not be read. */
export const incompleteHistory = (history: ToolUsage) => !!(history.unread || history.skipped);

/** Why a tool's history can't say an item of this kind wasn't used, if it can't: first that it couldn't all be read, then that it keeps no sessions, whatever it can tell of the kind. */
export const cantSayFor = (history: ToolUsage, kind: ItemKind): CantSay | undefined =>
  incompleteHistory(history) ? 'unread' : !history.sessions ? 'no-sessions' : !history.tells[kind] ? 'no-record' : history.tells[kind] === 'seen' ? 'not-sure' : undefined;

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
  return { tool, sessions: new Set(hits.flatMap(hit => hit.sessions)).size, ...(last ? { last } : {}), ...(cantSay ? { cantSay } : {}),
    ...(history.skipped ? { skipped: history.skipped } : {}), ...(startsLate(reading, history.from) ? { since: history.from } : {}) };
}

/** The tools that have an item on: their own copy, not switched off there by the tool's own switch, or a plugin's, not turned off there. */
export const onIn = (facts: UsageFacts, tools: readonly HarnessId[]) => tools.filter(tool =>
  (facts.copies[tool] && !facts.switchedOff?.includes(tool) && !facts.loads?.[tool]?.switchedOff) || (facts.plugin?.[tool] && !facts.plugin[tool]!.off));

/**
 * A row's one figure: `used`, the newest use where a tool saw one within USAGE_DAYS, and `sessions`, the sessions within
 * USAGE_DAYS that used it, each tool's added up (a session is one tool's); `noneSeen`, none seen, and a tool that has it on can
 * say so, `since` the latest start among those tools where one starts later than USAGE_DAYS ago, so the claim holds for each;
 * undefined, nothing to say (no tool that has it on can tell).
 */
export type RowFigure = { used: string; sessions: number } | { noneSeen: true; since?: string } | undefined;
export function rowFigure(says: readonly ToolSays[], on: readonly HarnessId[]): RowFigure {
  const seen = says.filter(each => each.sessions > 0), telling = says.filter(each => !each.cantSay && on.includes(each.tool));
  if (seen.length) return { used: seen.map(each => each.last!).sort().at(-1)!, sessions: seen.reduce((sum, each) => sum + each.sessions, 0) };
  if (!telling.length) return undefined;
  const since = telling.flatMap(each => (each.since ? [each.since] : [])).sort().at(-1);
  return since ? { noneSeen: true, since } : { noneSeen: true };
}

/** Every tool's figure for one item, in each tool the reading read (a use in a tool not managed here counts too). */
export const allSay = (reading: UsageReading, kind: ItemKind, facts: UsageFacts): ToolSays[] =>
  reading.tools.flatMap(each => toolSays(reading, kind, facts, each.tool) ?? []);
/** An item's figure in the Library: over every tool's, with `tools` (the kind's managed tools) the ones whose "none seen" counts where they have it on. */
export const figureFor = (reading: UsageReading, kind: ItemKind, facts: UsageFacts, tools: readonly HarnessId[]) => rowFigure(allSay(reading, kind, facts), onIn(facts, tools));

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

/** A plugin's own row (pluginrows.ts PluginRow) as the match reads it: its name in the plugin, through the plugin in each tool that has it (off where it is off there). */
export const pluginRowFacts = (row: PluginRow): UsageFacts => ({ key: row.name, name: row.name, copies: {},
  plugin: Object.fromEntries(pluginTools(row).filter(tool => row.copies[tool]).map(tool => [tool, { plugin: row.plugin, marketplace: row.marketName, name: row.name, ...(offIn(row, tool) ? { off: true as const } : {}) }])) });

/**
 * One tool's history in a reading: how many sessions it started within USAGE_DAYS (`recent`), and how far back it goes:
 * USAGE_DAYS or more (`whole`), from its first session when that is later (`from`), no session kept (`none`), or it couldn't be
 * read (`unread`), or only some sessions could be read (`partial`).
 */
export type ToolHistory = { tool: HarnessId; recent: number } & ({ goes: 'whole' | 'none' | 'unread' | 'partial' } | { goes: 'from'; from: string });
/**
 * Each tool's history (ToolHistory), for the tools worth naming: every managed one, any other installed one with sessions, and
 * one not installed only with a use within USAGE_DAYS, a leftover folder being no tool.
 */
export function toolHistories(reading: UsageReading, home: Pick<HomeView, 'sync'>): ToolHistory[] {
  const named = (each: ToolUsage) => home.sync.managed.includes(each.tool) || (each.sessions > 0 && (home.sync.present.includes(each.tool) || each.used.some(used => used.sessions.length)));
  return reading.tools.filter(named).map((history): ToolHistory => {
    const { tool, recent, sessions, from } = history;
    if (incompleteHistory(history)) return { tool, recent, goes: sessions ? 'partial' : 'unread' };
    if (sessions && startsLate(reading, from)) return { tool, recent, goes: 'from', from: from! };
    return { tool, recent, goes: sessions ? 'whole' : 'none' };
  });
}

/** One row of the most used: its key in the Library (a plugin's own row's too: pluginrows.ts PluginRow key), its name, and the sessions within USAGE_DAYS that used it. */
export interface MostUsed { key: string; name: string; sessions: number }
/**
 * What a reading says of one kind's rows. Over every row the page lists (its items, found and Off ones too, and a plugin's own
 * rows): `figured`, how many have a figure in their Used cell (used, or no use seen where a tool that has it on can tell; none:
 * no tool here can tell for this kind, and the page draws no Used column); `used`, the keys of those whose Used cell says used
 * within USAGE_DAYS, and `mostUsed`, the three used in the most sessions (equal ones by name). Over its items that are On and not
 * used: `noUseSeen`, in the "No use seen in 30 days" chip (noUseSeen `in`); `tooNew`, kept out of it by its age alone;
 * `cantSay`, no tool that has it on can tell. And `foundNoneSeen`: found items (in a tool, not in Central Knot) with no use
 * seen, which the chip leaves out too.
 */
export interface KindUsage { figured: number; used: string[]; mostUsed: MostUsed[]; noUseSeen: string[]; tooNew: string[]; cantSay: string[]; foundNoneSeen: string[] }
/** A reading in sum: each kind's rows (KindUsage) and each tool's history (toolHistories). */
export interface UsageSummary { kinds: Record<'skills' | 'mcp' | 'agents', KindUsage>; tools: ToolHistory[] }
/** What a reading says of a home in sum (UsageSummary): what the item lists' rows and chip say, counted, for any page to show. */
export function usageSummary(reading: UsageReading, home: HomeView): UsageSummary {
  const kindUsage = (which: 'skills' | 'mcp' | 'agents'): KindUsage => {
    const { facts, library, tools } = kindSource(home, which), kind = partOfPage[which];
    const sum: KindUsage = { figured: 0, used: [], mostUsed: [], noUseSeen: [], tooNew: [], cantSay: [], foundNoneSeen: [] };
    const used: MostUsed[] = [];
    for (const each of facts) {
      const item = library[each.key], figure = figureFor(reading, kind, each, tools);
      if (figure) sum.figured++;
      if (figure && 'used' in figure) used.push({ key: each.key, name: each.name, sessions: figure.sessions });
      else if (item?.on && !item.deleted) sum[!figure ? 'cantSay' : noUseSeen(item, figure, reading.at) === 'in' ? 'noUseSeen' : 'tooNew'].push(each.key);
      else if (figure && !inLibrary(item)) sum.foundNoneSeen.push(each.key);
    }
    for (const row of pageRows(home, which).rows) {
      const figure = figureFor(reading, kind, pluginRowFacts(row), tools);
      if (figure) sum.figured++;
      if (figure && 'used' in figure) used.push({ key: row.key, name: row.name, sessions: figure.sessions });
    }
    sum.used = used.map(each => each.key);
    sum.mostUsed = [...used].sort((first, second) => second.sessions - first.sessions || first.name.localeCompare(second.name)).slice(0, 3);
    return sum;
  };
  return { kinds: { skills: kindUsage('skills'), mcp: kindUsage('mcp'), agents: kindUsage('agents') }, tools: toolHistories(reading, home) };
}
