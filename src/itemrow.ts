// An item (a skill, an MCP server or an agent) as the item pages draw it, and what each tool's mark says about it. Pure: no DOM.
import { comparedTools, copiesDiffer } from './syncrules.ts';
import type { GoneItem, Outside, SwitchProblem, ThroughPlugin } from './types.ts';
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
  /** Agents: the With limits label for each tool that lacks some of the origin's fields. */
  limits?: Partial<Record<Tool, string>>;
  oneWay?: { from: Tool; lost: string[] };
  kept?: string[];
  /** Agents: one-way tools edited or deleted there, no longer updated. */
  stopped?: Tool[];
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
  /** Each tool whose copy was removed to turn it off (no switch there), with the History removal that puts it back. */
  heldOff?: { tool: Tool; history: string; source?: Tool }[];
}

const heldTools = (skill: ItemRow) => (skill.heldOff ?? []).map(entry => entry.tool);
/** The tools an Off holds that have no copy: off there, the copy removed and kept in History, which turning it on puts back. */
export const offHeldIn = (skill: ItemRow) => heldTools(skill).filter(tool => skill.copies[tool] === undefined);
/** The tools an Off holds where a copy turned up since (made there by hand): that tool's own, left alone until it is turned on. */
export const turnedUpIn = (skill: ItemRow) => heldTools(skill).filter(tool => skill.copies[tool] !== undefined);
/**
 * The History entries turning it on puts back, each once: those of the Offs holding its tools, the one holding a one-way copy's
 * source first (its receiving copies wait for it); with none held, the removals that left it no copy (`gone`).
 */
export function putBackOrder(skill: ItemRow): string[] {
  const held = skill.heldOff ?? [];
  if (!held.length) return skill.gone ? [skill.gone.history, ...(skill.gone.also ?? [])] : [];
  const sources = new Set(held.flatMap(entry => (entry.source ? [entry.source] : [])));
  return [...new Set([...held].sort((first, second) => Number(sources.has(second.tool)) - Number(sources.has(first.tool))).map(entry => entry.history))];
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
