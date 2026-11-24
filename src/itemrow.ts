// An item (a skill, an MCP server or an agent) as the item lists draw it (ItemRow), with its kind, a row's identity on a page
// (rowId), a row named by its kind and key as a click and its result name it (RowKey, NamedRow, sameRow) and the ids of its
// elements (partId), each kind's items in a home as every page reads them (kindSource), the order of the rows under a heading (inOrder; the choice itself is matrix.ts
// orderChoice; a row's last use, usagerow.ts lastUse), and the rows a click pins where they were, on every list that orders
// rows by their state, the Plugins list too (Pinned). Pure: no DOM. Every kind is on Central Knot's library: what a row and each tool's mark say is libraryrow.ts's,
// from the kind's view (types.ts LibraryView).
import { currentIndex, type LibraryItem, type Plan, type VersionChange } from './library.ts';
import { inLibrary } from './libraryrow.ts';
import type { HarnessId, HomeView, LibraryFacts, ThroughPlugin } from './types.ts';
import type { PageKind } from './app.ts';

/** A tool, as a column. */
export type Tool = string;

/**
 * One item's row as the table draws it (matrix.ts fromFacts, from the kind's row, types.ts LibraryFacts): what it adds is each
 * tool's copy as a content id (same id = the same version: for agents and MCP servers, the shared part alone), its path and the
 * lines the compare view quotes.
 */
export interface ItemRow {
  /** Its kind, set where the row is made (matrix.ts fromFacts): a skill and an agent may share a key. */
  kind: PageKind;
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
  /** A skill’s copy in each tool, including one switched off there (types.ts LibraryFacts loads). */
  loads?: LibraryFacts['loads']; alsoLoads?: LibraryFacts['alsoLoads'];
  /** A library kind: how a tool has it another way, in words, which copies Take over can make Central Knot's, and (skills, MCP servers) the tools whose own switch has it off (types.ts LibraryFacts). */
  anotherWay?: Partial<Record<Tool, string>>;
  takeOver?: Partial<Record<Tool, { kind: 'link' | 'shared'; path: string }>>;
  switchedOff?: Tool[];
  /** `pluginOn`: the tools with no copy of their own that have it on through an installed plugin (pluginrows.ts pluginOnIn; libraryrow.ts LibraryRow says it). */
  pluginOn?: Tool[];
  /** The tools an item from a plugin gets only by installing that plugin (pluginrows.ts withPluginOnly; libraryrow.ts LibraryRow says it). */
  getsWithPlugin?: Tool[];
}

/**
 * A row's identity on a page, from its kind and key ("skills-review"): what the page keeps of one row goes by it (the opened row,
 * the flash, the armed Delete, a plugin item's file shown, a pin and a row's time in the order), since a skill and an agent may
 * share a key.
 */
export const rowId = (kind: PageKind, key: string) => `${kind}-${key}`;
/** A row named by its kind and key: what a click, a run, an Undo and a result say they are about (app.ts Click rows, Outcome rows). */
export interface RowKey { kind: PageKind; key: string }
/** A row by kind and key with the name its words give it: what a result says it changed, and its Undo puts back (app.ts Done changed). */
export type NamedRow = RowKey & { name: string };
export const sameRow = (first: RowKey, second: RowKey) => first.kind === second.kind && first.key === second.key;
/**
 * The id of one of a row's elements on the item lists (the Library, a tool's tabs of it under
 * Harnesses, and the Library's Files view): its part, the row's id (rowId, also the row's `data-key`), and what within the
 * row it is of, a tool or a place: "switch-skills-review", "cell-skills-review-claude-cli". The one place these ids are made;
 * the scripts name them the same way (scripts/cdp.mjs rowPart). dom.ts fileBlocks extends an id made here with each block's
 * place ("-0"). Lists that are no rows of the item lists keep ids of their own: Profiles' ticks (by profileplan.ts itemId),
 * Sources' lines, a plugin page's items, the Git repo's rows, the base card, a plugin's Open on a tool's page, and the
 * Instructions page's shown texts (`shown-<key>`, editparts.ts).
 */
export const partId = (part: string, row: string, ...within: (string | number)[]) => [part, row, ...within].join('-');

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

/** The orders the item lists offer: by name (as always, and the default), by last updated, or by last used (usage collected: usagerow.ts lastUse), newest first. */
export type RowOrder = 'name' | 'updated' | 'used';

/** The order by name (a leading dot aside), and one name by kind: skill, server, agent (the Library's mixed list; its plugin rows too). */
export const byName = (first: { key: string; kind: PageKind }, second: { key: string; kind: PageKind }) =>
  first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, '')) || KIND_ORDER.indexOf(first.kind) - KIND_ORDER.indexOf(second.kind);
const KIND_ORDER: readonly PageKind[] = ['skills', 'mcp', 'agents'];

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

/** A row's time in an order, in ms: when it was last updated or last used; none by name, or where it has no time. */
export const timeIn = <Row extends Pick<ItemRow, 'key' | 'versions'>>(row: Row, order: RowOrder, itemOf: (row: Row) => LibraryItem | undefined, usedAt: (row: Row) => number | undefined = () => undefined) =>
  (order === 'updated' ? lastUpdated(row, itemOf(row)) : order === 'used' ? usedAt(row) : undefined);

/**
 * The rows under one heading in the chosen order. Last updated or last used: newest first, an item with no time after every
 * one with a time; equal times, or none, go by name, and one name by kind (skills, servers, agents: the Library's mixed list), so
 * every look gives the same order. `itemOf`: a row's item as the library
 * holds it; `usedAt`: a row's last use (ms); `pins`: a row pinned on this list goes by the time it had when pinned (Pin). Each
 * row's time is kept by its row id, so a skill and an agent of one name keep their own.
 */
export function inOrder<Row extends Pick<ItemRow, 'kind' | 'key' | 'versions'>>(rows: readonly Row[], order: RowOrder, itemOf: (row: Row) => LibraryItem | undefined, usedAt: (row: Row) => number | undefined = () => undefined, pins?: Pinned<unknown>): Row[] {
  const id = (row: Row) => rowId(row.kind, row.key);
  const time = new Map(rows.map(row => { const pinned = pins?.rows.get(id(row)); return [id(row), (pinned ? pinned.time : timeIn(row, order, itemOf, usedAt)) ?? -Infinity]; }));
  return [...rows].sort((first, second) => (time.get(id(second))! - time.get(id(first))!) || byName(first, second));
}

// ---------- Rows pinned where they were ----------

/**
 * One row pinned on a list, whose own switch (or Add) was clicked there: the group it was drawn in before its first click
 * there, and its time in the list's order then (timeIn), so it keeps its place among its neighbours too (Add gives a found
 * item a time). A click never moves a row: it stays where it was, drawn in its new state, while the person works down the list.
 * Nor does a usage reading that lands: on a list that goes by last used, every row is pinned where it is first (matrix.ts holdOrder).
 * On the Library while its Find has text, every row drawn is pinned, with no time, in the order drawn: the order the rows were
 * pinned in is their order there (matrix.ts holdFound, foundOrder).
 */
export interface Pin<Group> { group: Group; time?: number }
/**
 * The rows pinned on one list, by the id its rows have there: an item list's row id (rowId), a plugin's name on Plugins. `list`:
 * which list, as its page names it: where it is, its Sort and its chip (never Find). Every page that orders rows by their state
 * reads it: the item tables (matrix.ts itemsTable), the Skills Files view's list (matrix.ts skillsBrowser) and the Plugins list
 * (pluginstate.ts shownPlugins). The one kept, and when it is let go: app.ts pinnedRows.
 */
export interface Pinned<Group = string | number> { list: string; rows: Map<string, Pin<Group>> }
export const noPins = <Group = string | number>(): Pinned<Group> => ({ list: '', rows: new Map() });
/** The rows pinned on `list`: these, or none when they were pinned on another list, which lets those go. */
export const pinsOn = <Group>(pins: Pinned<Group>, list: string): Pinned<Group> => (pins.list === list ? pins : { list, rows: new Map() });
/** A click on a row's own switch: it keeps the group it is drawn in now and its time, unless an earlier click on this list pinned it. */
export function pin<Group>(pins: Pinned<Group>, id: string, group: Group, time?: number): void { if (!pins.rows.has(id)) pins.rows.set(id, { group, time }); }
/** The group a row is drawn in: the one it is pinned in, else its own. A row new to the list is pinned nowhere, so it goes where its own group puts it. */
export const placeIn = <Group>(pins: Pinned<Group>, id: string, own: Group): Group => (pins.rows.get(id)?.group ?? own);
