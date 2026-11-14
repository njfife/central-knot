// An item (a skill, an MCP server or an agent) as the item pages draw it (ItemRow), and each kind's items in a home as every
// page reads them (kindSource). Pure: no DOM. Every kind is on Central Knot's library: what a row and each tool's mark say is
// libraryrow.ts's, from the kind's view (types.ts LibraryView).
import type { LibraryItem, Plan, VersionChange } from './library.ts';
import type { HarnessId, HomeView, LibraryFacts, LibraryView, SkillFacts, ThroughPlugin } from './types.ts';
import { toolName } from './words.ts';

/** A tool, as a column. */
export type Tool = string;

/** One item's row: each tool's copy as a content id (same id = the same version: for agents and MCP servers, the shared part alone), or absent, and what else the row says. */
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
  managed: boolean;
  off: Tool[];
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
  takeInAnswers?: SkillFacts['takeInAnswers'];
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
export interface KindSource { tools: HarnessId[]; facts: SkillFacts[]; library: Record<string, LibraryItem> }

/**
 * One kind in a home, as every page that lists or counts its items reads it: its rows, the tools that can hold it (Pi has no
 * agents), and its items. The one place a kind's view (types.ts LibraryView) meets the rows the pages draw (SkillFacts):
 * there, On is `managed` and the harnesses it is kept out of are `off`.
 */
export function kindSource(home: Pick<HomeView, 'skills' | 'mcp' | 'agents'>, which: 'skills' | 'mcp' | 'agents'): KindSource {
  const view = home[which];
  return { tools: view.tools, facts: libraryRows(view), library: view.library };
}

/**
 * A library view's rows as SkillFacts, made once per view read, so a page that caches by them redraws only on a new read.
 * A tool whose own switch turns the item off (`switchedOff`) is said as its mark says it: in that tool's own settings.
 */
const rowsOf = new WeakMap<LibraryView, SkillFacts[]>();
function libraryRows(view: LibraryView): SkillFacts[] {
  const switchedOff = (row: LibraryFacts) => Object.fromEntries((row.switchedOff ?? []).map(tool => [tool, `switched off in ${toolName(tool)}’s own settings`]));
  const made = rowsOf.get(view) ?? view.items.map((row): SkillFacts => {
    const { on, except, loads: _loads, switchedOff: _off, switchProblem: _problem, ...facts } = row, switched = switchedOff(row);
    return { ...facts, managed: on, off: except, choiceBlocks: facts.choiceBlocks ?? {}, ...(Object.keys(switched).length ? { switched } : {}) };
  });
  rowsOf.set(view, made);
  return made;
}

/** Whether anything in the home is On in the library. */
export const anyManaged = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents'>) =>
  (['skills', 'mcp', 'agents'] as const).some(which => kindSource(home, which).facts.some(fact => fact.managed));
