// An item (a skill, an MCP server or an agent) as the item pages draw it (ItemRow), and each kind's items in a home as every
// page reads them (kindSource). Pure: no DOM. Every kind is on Central Knot's library: what a row and each tool's mark say is
// libraryrow.ts's, from the kind's view (types.ts LibraryView).
import type { LibraryItem, Plan, VersionChange } from './library.ts';
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
  /** Made by Convert to skill from an agent. */
  converted?: { agent: string; origin: string; losses: string[] };
  /** A library item linked to a source the home records: its link (types.ts LibraryFacts fromSource). */
  fromSource?: { link: string };
  /** Shown name, with its case. */
  name?: string;
  description: string;
  copies: Partial<Record<Tool, string>>;
  /** On (library.ts LibraryItem `on`); false for an item that is Off and for one only found. */
  on: boolean;
  /** The harnesses it is kept out of. */
  except: Tool[];
  cannot?: Partial<Record<Tool, string>>;
  /** Tools with no copy of their own that have it through a plugin installed there (each is in `cannot` too). */
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
  /** A library kind: how a tool has it another way, which copies Take over can make Central Knot's, and (skills, MCP servers) a tool whose own switch has it off, in words. */
  anotherWay?: Partial<Record<Tool, string>>;
  takeOver?: Partial<Record<Tool, { kind: 'link' | 'shared'; path: string }>>;
  switched?: Partial<Record<Tool, string>>;
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
