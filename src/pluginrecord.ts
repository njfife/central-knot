// A whole plugin's one switch: what the home records of it, and the one table that decides what each managed tool is owed.
//
//   .central-knot/plugins.json   per plugin: `id`, the marketplace as added (`source`, `marketName`), `plugin`, `on` and
//                                `except` (the tools the person keeps it out of); per home: `tools`, the managed tools that
//                                are not new here (the first read puts every managed tool there but one an install waited
//                                for; the automatic updates add a new tool after their first check for it; a tool managed
//                                again leaves it). Nothing else: what each tool has (installed or not, its version, its own
//                                switches, what its copy holds) is read at each look.
//
// THE TABLE (owedTo), per managed tool, from the plugin's entry and what that tool has now (ToolNow). "Wanted" is On and not
// kept out of the tool. Rows, first match:
//   1. its record can't be read            → nothing: unknown.          Codex's config.toml half-written: Codex owes nothing.
//   2. no entry for the plugin             → nothing (found, or never on). Installed by hand in Codex alone: its row offers Add.
//   3. wanted, has it (whole or parts)     → nothing.                    On, in Claude Code: in line there.
//   4. wanted, lacks it, its installer     → install.                    On, Codex lacks it: `codex plugin add`.
//   5. wanted, lacks it, parts can go in   → install-parts.              On, Pi lacks it: its skills written there.
//   6. wanted, lacks it, no way in         → held, with why.             On, Copilot CLI refuses the marketplace: said.
//   7. not wanted, lacks it                → nothing.                    Off, nowhere: in line.
//   8. not wanted, has it, can't take out  → held, with why.             Off, Claude Code's copy is the Anthropic Directory's.
//   9. not wanted, has it whole            → uninstall.                  Kept out of Codex, Codex has it: `codex plugin remove`.
//  10. not wanted, has its parts           → remove-parts.               Off, Pi has its parts: they are taken out.
// An install (rows 4, 5) is also owed to the automatic updates where the tool is not on the home's `tools` (it is new here,
// or managed again): `background`; but not while some tool has the plugin off by its own switch (`offElsewhere`: one turned
// off somewhere is not wanted everywhere, read from the tools at each look). Nothing else is: an uninstall runs only at the
// plugin's own click (its switch, a tool kept out, Take out there), and an install in a tool already on `tools` (one that
// failed, one removed there by hand) waits for Install there on the plugin's page. "Has it" is installed whole or any parts
// on record, in that tool.
//
// The first read (firstRecord) makes plugins.json for a home that has none, from what the tools hold now, writing nothing to
// any tool: each plugin some managed tool has is On, kept out of every tool that lacks it while some managed tool lacks it.
// What a click runs of the table's answer is clickRuns (On only installs, Off only uninstalls), beside it.
// Who reads what: marketplaces.ts gathers what the tools have (pluginstatus.ts toolNow) and carries out a click (turn, undoTurn); the
// automatic updates carry out the background's installs (pluginupdates.ts); the pages and pluginstatus.ts say the answer.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessIds } from './harnesses.ts';
import { sameSource } from './plugins.ts';
import { NOTHING_CHANGED, errorCode, partsRecordPath, storeDirectory, writeDurably } from './share.ts';
import type { HarnessId, PluginTurn } from './types.ts';
import { onlyAllowed } from './values.ts';
// "Wanted" means what it means for a library item (On, and not kept out of the tool): one rule, library.ts's.
import { wantedIn } from './library.ts';

/** One plugin as the home records it. */
export interface PluginEntry {
  /** Its own name. Nothing reads it in this version; the next one links the plugin's items in Pi and OpenCode to it by this. */
  id: string;
  /** The marketplace as added (its address), and the name its catalog gives it (the tools write plugin@marketName). */
  source: string;
  marketName: string;
  plugin: string;
  on: boolean;
  /** The tools the person keeps it out of. */
  except: HarnessId[];
}
/** plugins.json. */
export interface PluginRecord {
  /** The managed tools that are not new here (the header says who adds and takes away); one not here is owed each On plugin's install by the automatic updates (`background`). */
  tools: HarnessId[];
  plugins: PluginEntry[];
}

/** What one managed tool has of a plugin now, and how it could take it in or out (marketplaces.ts toolsNow reads it). */
export interface ToolNow {
  /** Installed whole, its parts on record, neither, or its record can't be read now. */
  has: 'whole' | 'parts' | 'none' | 'unknown';
  /** How it would go in: the tool's own installer, as parts, or why it can't (pluginstatus.ts says it). */
  route: 'whole' | 'parts' | { cannot: string };
  /** Why its copy can't be taken out here, if it can't (pluginstatus.ts cantUninstall). */
  stuck?: string;
}
/** The table's answer for one tool. */
export interface Owed {
  wanted: boolean;
  has: ToolNow['has'];
  /** It could take the plugin: by its installer or as parts (a tool that can't is never what makes a plugin partial). */
  takes: boolean;
  /** What brings the tool into line; none when it is in line, held (`held`) or unknown. */
  act?: 'install' | 'install-parts' | 'uninstall' | 'remove-parts';
  /** Why it can't be brought into line here. */
  held?: string;
  /** The install is the automatic updates' to make too: the tool is not on the home's `tools`. */
  background?: true;
  /** The tool is not on `tools`, but some tool has the plugin off by its own switch, so its install is a click's only. */
  offElsewhere?: true;
}

/**
 * One listed plugin's switch as the page gets it (types.ts MarketplaceView switches): its entry as recorded (none: never
 * recorded, so the plugin is found where a tool has it) and the table's answer for each managed tool.
 */
export interface PluginSwitch { entry?: Pick<PluginEntry, 'on' | 'except'>; tools: Partial<Record<HarnessId, Owed>> }


/** THE TABLE (the header's rows), for one tool. `seen`: the home's `tools`; `offSomewhere`: some tool has the plugin off by its own switch. */
export function owedTo(entry: Pick<PluginEntry, 'on' | 'except'> | undefined, tool: HarnessId, now: ToolNow, seen: readonly HarnessId[], offSomewhere = false): Owed {
  const is = { wanted: !!entry && wantedIn(entry, tool), has: now.has, takes: typeof now.route !== 'object' };
  if (is.has === 'unknown' || !entry) return is;
  if (is.wanted) {
    if (is.has !== 'none') return is;
    if (typeof now.route === 'object') return { ...is, held: now.route.cannot };
    const owes = { ...is, act: now.route === 'whole' ? 'install' as const : 'install-parts' as const };
    if (seen.includes(tool)) return owes;
    return offSomewhere ? { ...owes, offElsewhere: true } : { ...owes, background: true };
  }
  if (is.has === 'none') return is;
  if (is.has === 'whole') return now.stuck ? { ...is, held: now.stuck } : { ...is, act: 'uninstall' };
  return { ...is, act: 'remove-parts' };
}

/** Which way a click on a plugin goes: On, Add and Let in put it in; Off and Keep out take it out; Install there and Take out there bring one tool into line either way. */
export const clickGoes = (what: PluginTurn): 'in' | 'out' | 'any' => (what === 'on' || what === 'add' || what === 'let-in' ? 'in' : what === 'fix' ? 'any' : 'out');
/** What a click runs in one tool: what the table owes there, only where it goes the click's way (On never uninstalls, Off never installs). */
export function clickRuns(what: PluginTurn, owed: Owed): Owed['act'] {
  const goes = clickGoes(what), inward = owed.act === 'install' || owed.act === 'install-parts';
  return owed.act && (goes === 'any' || inward === (goes === 'in')) ? owed.act : undefined;
}
/** Why a click can do nothing in one tool, as the table holds it, where that hold is the click's way. */
export const clickHeld = (what: PluginTurn, owed: Owed) => (owed.held && (clickGoes(what) === 'any' || owed.wanted === (clickGoes(what) === 'in')) ? owed.held : undefined);

/** A plugin of the home's record by its marketplace (one address however it is spelt) and name. */
export const entryOf = (record: PluginRecord | undefined, source: string, plugin: string) =>
  record?.plugins.find(entry => entry.plugin === plugin && sameSource(entry.source, source));

/** A new entry for a plugin, On everywhere or Off. */
export const newEntry = (source: string, marketName: string, plugin: string, on: boolean): PluginEntry => ({ id: randomUUID(), source, marketName, plugin, on, except: [] });

/** The record with one plugin's entry put in place (or taken out, `entry` undefined). */
export function withEntry(record: PluginRecord, source: string, plugin: string, entry: PluginEntry | undefined): PluginRecord {
  const others = record.plugins.filter(known => !(known.plugin === plugin && sameSource(known.source, source)));
  return { ...record, plugins: entry ? [...others, entry] : others };
}

// ---------- The first read ----------

/** A plugin one tool has: installed whole (its record names the marketplace's source) or its parts on record. */
export interface Holding { tool: HarnessId; source: string; marketName: string; plugin: string }
/** An install that waited for a tool new here in the version before (its automatic updates' `waiting`). */
export interface WaitedBefore { tool: HarnessId; source: string; plugin: string }

/**
 * plugins.json made from what the managed tools hold now (`holdings`), checking no route, so it is the same answer offline.
 * Each plugin some managed tool has is On. While some managed tool lacks it, `except` holds every tool that lacks it (managed
 * or not, installed or not), so a plugin in some tools stays in those tools only; but not a tool an install waited for
 * (`waited`), whose install the automatic updates then make. A tool that can't take it is in `except` too: its pages leave
 * such a tool out of "partial" (pluginstatus.ts). `tools`: the managed tools, but those an install waited for.
 */
export function firstRecord(managed: HarnessId[], holdings: Holding[], waited: WaitedBefore[]): PluginRecord {
  const plugins: PluginEntry[] = [];
  for (const held of holdings) {
    if (!managed.includes(held.tool) || entryOf({ tools: [], plugins }, held.source, held.plugin)) continue;
    const mine = holdings.filter(other => other.plugin === held.plugin && sameSource(other.source, held.source));
    const has = (tool: HarnessId) => mine.some(other => other.tool === tool);
    const waits = (tool: HarnessId) => waited.some(wait => wait.tool === tool && wait.plugin === held.plugin && sameSource(wait.source, held.source));
    const except = managed.every(has) ? [] : harnessIds.filter(tool => !has(tool) && !waits(tool));
    plugins.push({ ...newEntry(held.source, held.marketName, held.plugin, true), except });
  }
  return { tools: managed.filter(tool => !waited.some(wait => wait.tool === tool)), plugins };
}

// ---------- The file ----------

const FORMAT_VERSION = 1;
const recordPath = (home: string) => join(storeDirectory(home), 'plugins.json');

const isEntry = (value: unknown): value is PluginEntry => {
  const entry = value as Partial<PluginEntry> | null;
  return !!entry && ['id', 'source', 'marketName', 'plugin'].every(field => typeof entry[field as keyof PluginEntry] === 'string')
    && typeof entry.on === 'boolean' && Array.isArray(entry.except) && onlyAllowed(entry.except, harnessIds).length === entry.except.length;
};

/** The home's record: none (`record` undefined) when there is no file yet. One that can't be read, is damaged or newer is a `problem` that stops every write. */
export async function readPluginRecord(home: string): Promise<{ record?: PluginRecord; problem?: string }> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: `The plugins record could not be read. ${NOTHING_CHANGED}` }; }
  try {
    const read = JSON.parse(text) as { formatVersion?: number; tools?: unknown; plugins?: unknown[] } | null;
    if ((read?.formatVersion ?? 0) > FORMAT_VERSION) return { problem: `The plugins record was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    const tools = onlyAllowed(read?.tools, harnessIds);
    if (read?.formatVersion === FORMAT_VERSION && Array.isArray(read.tools) && tools.length === read.tools.length && Array.isArray(read.plugins) && read.plugins.every(isEntry)) return { record: { tools, plugins: read.plugins } };
  } catch { /* said below */ }
  return { problem: `The plugins record is damaged. ${NOTHING_CHANGED}` };
}

export const savePluginRecord = (home: string, record: PluginRecord) =>
  writeDurably(recordPath(home), `${JSON.stringify({ formatVersion: FORMAT_VERSION, tools: record.tools, plugins: record.plugins }, null, 2)}\n`);

/** Whether the parts record can be read: absent counts (no parts anywhere); present and not the shape parts.ts writes does not. */
export async function partsReadable(home: string): Promise<boolean> {
  try { return Array.isArray(JSON.parse(await readFile(partsRecordPath(home), 'utf8'))?.installs); }
  catch (error) { return errorCode(error) === 'ENOENT'; }
}
