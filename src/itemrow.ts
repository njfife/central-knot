// An item (a skill, an MCP server or an agent) as the item pages draw it, and what each tool's mark says about it; and each
// kind's items in a home as every page reads them (kindSource). Pure: no DOM. A skill's and an MCP server's marks are here
// (cellOf); a library kind's (agents) follow Central Knot's library and are in libraryrow.ts.
import { comparedTools, copiesDiffer } from './syncrules.ts';
import type { LibraryItem, Plan, VersionChange } from './library.ts';
import type { GoneItem, HarnessId, HomeView, LibraryView, Outside, SkillFacts, SwitchProblem, ThroughPlugin } from './types.ts';
export { comparedTools, copiesDiffer };

/** A tool, as a column. */
export type Tool = string;

/** One item's row: each tool's copy as a content id (same id = same bytes), or absent, and what else the row says. */
export interface ItemRow {
  key: string;
  /** Made by Convert to skill from an agent. */
  converted?: { agent: string; origin: string; losses: string[] };
  /** Shown name, with its case. */
  name?: string;
  /** Other copies a tool also reads, for the details. */
  extra?: { tool: Tool; directory: string; summary: string; writable: boolean; same: boolean; outside?: Outside }[];
  description: string;
  copies: Partial<Record<Tool, string>>;
  managed: boolean;
  off: Tool[];
  cannot?: Partial<Record<Tool, string>>;
  /** Tools with no copy of their own that have it through a plugin installed there (each is in `cannot` too). */
  plugin?: Partial<Record<Tool, ThroughPlugin>>;
  /** Copies that differ, left as separate skills on purpose. */
  separate?: boolean;
  /** Why this skill cannot be managed at all. */
  held?: string;
  /** For each tool's copy, what stops every tool from using it, by the tool concerned. */
  blocks?: Partial<Record<Tool, { tool: Tool; reason: string }[]>>;
  /** Tools whose copy was edited since the last sync and waits to spread. */
  edited?: Tool[];
  /** Each tool's main copy's content ID, to tie a choice to what was seen. */
  hashes?: Partial<Record<Tool, string>>;
  /** Where each copy lives, for the details. */
  paths?: Partial<Record<Tool, string>>;
  /** For the compare view: one line per copy that differs. */
  versions?: Partial<Record<Tool, { lines: string; changed: string; text: string; /** When it was last changed. */ at?: string; /** Agents: the prompt. */ prompt?: string }>>;
  /** A library kind: harnesses whose copy can't be seen for sure right now, and why. */
  unseen?: Partial<Record<Tool, string>>;
  /** A library kind, in the library: what the next pass does in each harness (types.ts LibraryFacts plan). */
  plan?: Plan;
  /** A library kind, found in a harness: its copies differ, so the switch asks which one to take in. */
  differs?: boolean;
  /** A library kind, in the library: what each listed version changed (types.ts LibraryFacts versionChanges). */
  versionChanges?: VersionChange[];
  /** Agents: each harness's own settings in its file, by name (its own part). */
  ownFields?: Partial<Record<Tool, string[]>>;
  /** MCP: tools whose copy waits for an explicit write (Claude Code, Write now). */
  waits?: Tool[];
  /** Skills: tools whose copy is disabled with the tool's own switch (it stays there; the tool doesn't load it). */
  disabled?: Tool[];
  /** Skills: why a tool's switch can't be used at all (its settings file, named in `file`). */
  switchProblem?: Partial<Record<Tool, SwitchProblem>>;
  /** Skills: a quiet note that Disable isn't verified on a tool's build (older, or unreadable); the switch is offered anyway. */
  disableNote?: Partial<Record<Tool, string>>;
  /** Skills: whether Central Knot may change each tool's copy (not a link or a shared folder), so Remove can be offered. */
  writable?: Partial<Record<Tool, boolean>>;
  /** Skills: a tool whose copy is another tool's, read in that tool's own folder (OpenCode reads Claude Code's), and whose. */
  reads?: Partial<Record<Tool, Tool>>;
  /** Skills: a tool's copy that is a link in its own folder, or the shared folder's copy: taken over when the person asks. */
  outside?: Partial<Record<Tool, Outside>>;
  /** Skills: a broken link by this name in a tool's own folder, and where it led: a copy written there replaces it. */
  brokenLink?: Partial<Record<Tool, string>>;
  /** Skills, synced: its links or shared copy are back since a take-over removed them. */
  outsideBack?: boolean;
  /** No tool has a copy any more; History can put it back. */
  gone?: GoneItem;
}

/** What one tool has of an item, as its mark on the row shows it. */
export type Cell = 'synced' | 'will-sync' | 'differs' | 'present' | 'present-differs' | 'absent' | 'cannot' | 'edited' | 'waiting' | 'write-now';


export function cellOf(skill: ItemRow, tool: Tool): Cell {
  const has = skill.copies[tool] !== undefined;
  if (skill.cannot?.[tool] || (skill.held && !has)) return 'cannot';
  // MCP: Claude Code's copy waits for Write now (MCP-02), whatever the others hold.
  if (skill.managed && !skill.off.includes(tool) && skill.waits?.includes(tool)) return 'write-now';
  if (skill.separate) return has ? 'present' : 'absent';
  const counts = has && !skill.off.includes(tool);
  if (!skill.managed) return has ? (counts && copiesDiffer(skill) ? 'present-differs' : 'present') : 'absent';
  if (skill.off.includes(tool)) return has ? 'present' : 'absent';
  // Nothing can be copied here unless a tool it syncs to has a copy to start from.
  // An edit waiting to spread (Sync off, or settling) is pending, not a choice to make: the edited copy, and the copies that get it.
  if (skill.edited?.length) return skill.edited.includes(tool) ? 'edited' : 'waiting';
  if (!has) return comparedTools(skill).length ? 'will-sync' : 'absent';
  return copiesDiffer(skill) ? 'differs' : 'synced';
}

/** Whether its copies differ and need a choice of which every tool uses (never for an item held as it is). */
export const needsCopyChoice = (skill: ItemRow, toolList: Tool[]) => !skill.held && toolList.some(tool => ['differs', 'present-differs'].includes(cellOf(skill, tool)));

// ---------- Each kind in a home, as the pages read it ----------

/** What the pages read of one kind in a home. `library`: a library kind's items as the library holds them, deleted ones too. */
export interface KindSource { tools: HarnessId[]; facts: SkillFacts[]; waiting: string[]; gone: SkillFacts[]; library?: Record<string, LibraryItem> }

/**
 * One kind in a home, as every page that lists or counts its items reads it: its facts, the tools that can hold it (Pi has
 * no agents), the MCP servers whose Claude Code entries wait for Write now (their cells say so instead of reading as
 * differing copies), and the items History can put back. The one place a library kind's view (types.ts LibraryView) meets
 * the rows the skills and MCP engines still give (SkillFacts): there, On is `managed` and the harnesses it is kept out of
 * are `off`, and it has no copies read elsewhere (`extra`) and no choice blocks.
 */
export function kindSource(home: Pick<HomeView, 'manage' | 'mcp' | 'agents'>, which: 'skills' | 'mcp' | 'agents'): KindSource {
  if (which === 'skills') return { tools: home.manage.tools, facts: home.manage.skills, waiting: [], gone: home.manage.gone ?? [] };
  if (which === 'mcp') return { tools: home.mcp.tools, facts: home.mcp.servers, waiting: home.mcp.claudePending, gone: home.mcp.gone ?? [] };
  const view = home[which];
  return { tools: view.tools, facts: libraryRows(view), waiting: [], gone: [], library: view.library };
}
/** A library view's rows as SkillFacts, made once per view read, so a page that caches by them redraws only on a new read. */
const rowsOf = new WeakMap<LibraryView, SkillFacts[]>();
function libraryRows(view: LibraryView): SkillFacts[] {
  const made = rowsOf.get(view) ?? view.items.map(({ on, except, ...facts }): SkillFacts => ({ ...facts, managed: on, off: except, extra: [], choiceBlocks: {} }));
  rowsOf.set(view, made);
  return made;
}
/** Whether anything in the home is managed: a skill or MCP server synced, or an item On in the library. */
export const anyManaged = (home: Pick<HomeView, 'manage' | 'mcp' | 'agents'>) =>
  (['skills', 'mcp', 'agents'] as const).some(which => kindSource(home, which).facts.some(fact => fact.managed));
