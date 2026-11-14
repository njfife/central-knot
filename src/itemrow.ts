// An item (a skill, an MCP server or an agent) as the item pages draw it (ItemRow), each kind's items in a home as every
// page reads them (kindSource), and the order of the rows under a heading (inOrder; the choice itself is matrix.ts
// orderChoice). Pure: no DOM. Every kind is on Central Knot's library: what a row and each tool's mark say is libraryrow.ts's,
// from the kind's view (types.ts LibraryView).
import { currentIndex, type LibraryItem, type Plan, type VersionChange } from './library.ts';
import { inLibrary } from './libraryrow.ts';
import type { HarnessId, HomeView, LibraryFacts, ThroughPlugin } from './types.ts';

/** A tool, as a column. */
export type Tool = string;

/**
 * One item's row as the table draws it (matrix.ts fromFacts, from the kind's row, types.ts LibraryFacts): what it adds is each
 * tool's copy as a content id (same id = the same version: for agents and MCP servers, the shared part alone), its path and the
 * lines the compare view quotes.
 */
export interface ItemRow {
  key: string;
  /** A library item from a source the home records: its link, and whether a version waits there, or the next one would, or the source removed it (types.ts LibraryFacts fromSource). */
  fromSource?: LibraryFacts['fromSource'];
  /** Shown name, with its case. */
  name?: string;
  description: string;
  copies: Partial<Record<Tool, string>>;
  /** On (library.ts LibraryItem `on`); false for an item that is Off and for one only found. */
  on: boolean;
  /** The harnesses it is kept out of. */
  except: Tool[];
  cannot?: Partial<Record<Tool, string>>;
  /**
   * Tools with no copy of their own that have it through a plugin installed there. For a skill, `anotherWay` says so too; for an
   * agent or server, `cannot` does where its kind's rule puts the tool there (never while the item is Off or kept out of it).
   */
  plugin?: Partial<Record<Tool, ThroughPlugin>>;
  /** A found skill whose copies differ: for each tool's copy, what stops every tool from using it, by the tool concerned. */
  blocks?: Partial<Record<Tool, { tool: Tool; reason: string }[]>>;
  /** Tools whose copy holds an edit the next pass takes in, or one that gives way to it. */
  edited?: Tool[];
  /** Each tool's main copy's content ID, to tie a choice to what was seen. */
  hashes?: Partial<Record<Tool, string>>;
  /** Where each copy lives, for the details. */
  paths?: Partial<Record<Tool, string>>;
  /** For the compare view: one line per copy that differs. */
  versions?: Partial<Record<Tool, { lines: string; changed: string; text: string; /** When it was last changed. */ at?: string; /** A library kind: its body (types.ts ToolCopy). */ body?: string }>>;
  /** A library kind: harnesses whose copy can't be seen for sure right now, and why. */
  unseen?: Partial<Record<Tool, string>>;
  /** A library kind, in the library: what the next pass does in each harness (types.ts LibraryFacts plan). */
  plan?: Plan;
  /** A library kind, found in a harness: what a click on its Add does, and Synchronize everything (types.ts LibraryFacts takeInAnswers). */
  takeInAnswers?: LibraryFacts['takeInAnswers'];
  /** A library kind, in the library: what each listed version changed (types.ts LibraryFacts versionChanges). */
  versionChanges?: VersionChange[];
  /** A library kind: the names in each harness's own part of its copy (types.ts ToolCopy ownPart). */
  ownPart?: Partial<Record<Tool, string[]>>;
  /** MCP servers: tools whose write or removal waits for Write to Claude Code (types.ts LibraryFacts waits). */
  waits?: Tool[];
  /** A library kind: how a tool has it another way, in words, which copies Take over can make Central Knot's, and (skills, MCP servers) the tools whose own switch has it off (types.ts LibraryFacts). */
  anotherWay?: Partial<Record<Tool, string>>;
  takeOver?: Partial<Record<Tool, { kind: 'link' | 'shared'; path: string }>>;
  switchedOff?: Tool[];
}

// ---------- Each kind in a home, as the pages read it ----------

/** What the pages read of one kind in a home: the tools that can hold it, its rows, and its items as the library holds them, deleted ones too. */
export interface KindSource { tools: HarnessId[]; facts: LibraryFacts[]; library: Record<string, LibraryItem> }

/**
 * One kind in a home, as every page that lists or counts its items reads it: its rows, the tools that can hold it (Pi has no
 * agents), and its items, all as the kind's view (types.ts LibraryView) has them.
 */
export function kindSource(home: Pick<HomeView, 'skills' | 'mcp' | 'agents'>, which: 'skills' | 'mcp' | 'agents'): KindSource {
  const view = home[which];
  return { tools: view.tools, facts: view.items, library: view.library };
}

/** Whether anything in the home is On in the library. */
export const anyOn = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents'>) =>
  (['skills', 'mcp', 'agents'] as const).some(which => kindSource(home, which).facts.some(fact => fact.on));

// ---------- The order of the rows under a heading ----------

/** The two orders the item pages offer: by name (as always, and the default), or by last updated, newest first. */
export type RowOrder = 'name' | 'updated';

/** By name, a leading dot aside (".hidden" sorts with the h's). */
const byName = (first: { key: string }, second: { key: string }) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, ''));

/**
 * When an item was last updated, in ms: its current version's own time (library.ts Version `at`, on the newest entry with the
 * current content), which library.ts setCurrent sets (its comment says when; the migrations from before the library wrote the
 * first ones): a copy taken in keeps its file's time, a source's update its commit's. On, Off, a tool kept out or let in, and a
 * write to a tool set none, so they never change it. An item not in Central Knot (found) has its newest copy's file time
 * instead, where its copies carry one (an MCP entry's don't). Undefined: no time.
 */
export function lastUpdated(row: Pick<ItemRow, 'versions'>, item: LibraryItem | undefined): number | undefined {
  const kept = inLibrary(item), current = kept?.versions[currentIndex(kept)];
  const times = (current ? [current.at] : kept ? [] : Object.values(row.versions ?? {}).map(copy => copy?.at)).map(at => Date.parse(at ?? '')).filter(Number.isFinite);
  return times.length ? Math.max(...times) : undefined;
}

/**
 * The rows under one heading in the chosen order. Last updated: newest first, an item with no time after every one with a
 * time; equal times, or none, go by name, so every look gives the same order. `itemOf`: a row's item as the library holds it.
 */
export function inOrder<Row extends Pick<ItemRow, 'key' | 'versions'>>(rows: readonly Row[], order: RowOrder, itemOf: (row: Row) => LibraryItem | undefined): Row[] {
  const time = new Map(rows.map(row => [row.key, order === 'updated' ? lastUpdated(row, itemOf(row)) ?? -Infinity : 0]));
  return [...rows].sort((first, second) => (time.get(second.key)! - time.get(first.key)!) || byName(first, second));
}
