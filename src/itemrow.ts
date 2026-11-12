// An item (a skill, an MCP server or an agent) as the item pages draw it, and what each tool's mark says about it; and each
// kind's items in a home as every page reads them (kindSource). Pure: no DOM. An MCP server's marks are here (cellOf); a
// library kind's (skills, agents) follow Central Knot's library and are in libraryrow.ts.
import { comparedTools, copiesDiffer } from './syncrules.ts';
import type { LibraryItem, Plan, VersionChange } from './library.ts';
import type { GoneItem, HarnessId, HomeView, LibraryFacts, LibraryView, ProfilesView, SkillFacts, SwitchProblem, ThroughPlugin } from './types.ts';
import { toolName } from './words.ts';
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
  versions?: Partial<Record<Tool, { lines: string; changed: string; text: string; /** When it was last changed. */ at?: string; /** A library kind: its body (types.ts ToolCopy). */ body?: string }>>;
  /** A library kind: harnesses whose copy can't be seen for sure right now, and why. */
  unseen?: Partial<Record<Tool, string>>;
  /** A library kind, in the library: what the next pass does in each harness (types.ts LibraryFacts plan). */
  plan?: Plan;
  /** A library kind, found in a harness: its copies differ, so the switch asks which one to take in. */
  differs?: boolean;
  /** A library kind, in the library: what each listed version changed (types.ts LibraryFacts versionChanges). */
  versionChanges?: VersionChange[];
  /** A library kind: the names in each harness's own part of its copy (types.ts ToolCopy ownPart). */
  ownPart?: Partial<Record<Tool, string[]>>;
  /** MCP: tools whose copy waits for an explicit write (Claude Code, Write now). */
  waits?: Tool[];
  /** Skills: tools whose copy is disabled with the tool's own switch (it stays there; the tool doesn't load it). */
  disabled?: Tool[];
  /** Skills: why a tool's switch can't be used at all (its settings file, named in `file`). */
  switchProblem?: Partial<Record<Tool, SwitchProblem>>;
  /** No tool has a copy any more; History can put it back. */
  gone?: GoneItem;
  /** A library kind: how a tool has it another way, which copies Take over can make Central Knot's, and (skills) a tool whose own switch has it off, in words. */
  anotherWay?: Partial<Record<Tool, string>>;
  takeOver?: Partial<Record<Tool, { kind: 'link' | 'shared'; path: string }>>;
  switched?: Partial<Record<Tool, string>>;
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
 * the rows the MCP engine still gives (SkillFacts): there, On is `managed` and the harnesses it is kept out of are `off`,
 * and it has no choice blocks.
 */
export function kindSource(home: Pick<HomeView, 'skills' | 'mcp' | 'agents'> & { profiles?: HomeView['profiles'] }, which: 'skills' | 'mcp' | 'agents'): KindSource {
  const view = libraryView(home, which);
  if (view) return { tools: view.tools, facts: libraryRows(view, home.profiles), waiting: [], gone: [], library: view.library };
  return { tools: home.mcp.tools, facts: home.mcp.servers, waiting: home.mcp.claudePending, gone: home.mcp.gone ?? [] };
}
/**
 * A library kind's view in a home (types.ts HomeView keeps it under the page's name for the kind); undefined for MCP servers,
 * still on their own engine. kindSource and the page's bands (matrix.ts listView) read a kind's view here.
 */
export const libraryView = (home: Pick<HomeView, 'skills' | 'agents'>, which: 'skills' | 'mcp' | 'agents'): LibraryView | undefined =>
  (which === 'mcp' ? undefined : home[which]);
/**
 * A library view's rows as SkillFacts, made once per view read, so a page that caches by them redraws only on a new read.
 * A tool whose own switch turns a skill off (`loads`, `off`) is said as its mark says it: by a profile, naming the profile in
 * use, where profiles hold that switch (`profiles`), else in that tool's own settings.
 */
const rowsOf = new WeakMap<LibraryView, SkillFacts[]>();
function libraryRows(view: LibraryView, profiles?: ProfilesView): SkillFacts[] {
  const active = profiles?.profiles.find(profile => profile.id === profiles.active)?.name;
  const switchedOff = (key: string, loads: LibraryFacts['loads']) => Object.fromEntries(Object.entries(loads ?? {}).filter(([, at]) => at?.off).map(([tool]) =>
    [tool, profiles?.offByProfile[`skill:${key}`]?.includes(tool as HarnessId) ? `switched off in ${toolName(tool)} by ${active ? `the profile ${active}` : 'a profile'}` : `switched off in ${toolName(tool)}’s own settings`]));
  const made = rowsOf.get(view) ?? view.items.map(({ on, except, loads, ...facts }): SkillFacts => {
    const switched = switchedOff(facts.key, loads);
    return { ...facts, managed: on, off: except, choiceBlocks: facts.choiceBlocks ?? {}, ...(Object.keys(switched).length ? { switched } : {}) };
  });
  rowsOf.set(view, made);
  return made;
}
/** Whether anything in the home is managed: a skill or MCP server synced, or an item On in the library. */
export const anyManaged = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents'>) =>
  (['skills', 'mcp', 'agents'] as const).some(which => kindSource(home, which).facts.some(fact => fact.managed));
