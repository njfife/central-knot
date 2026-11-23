// A whole plugin's one switch: what the home records of it, and the one table that decides what each managed tool is owed.
//
//   .central-knot/plugins.json   per plugin: `id`, the marketplace as added (`source`, `marketName`), `plugin`, `on` and
//                                `except` (the tools it is kept out of); per home: `tools`, the managed tools that
//                                are not new here (the first read puts every managed tool there but one an install waited
//                                for; the automatic updates add a new tool after their first check for it; a tool managed
//                                again leaves it), and `knows`, the tools it was written knowing (bringForward). Nothing else: what each tool has (installed or not, its version, its own
//                                switches, what its copy holds) is read at each look.
//
// THE TABLE (owedTo), per managed tool, from the plugin's entry and what that tool has now (ToolNow). "Wanted" is On and not
// kept out of the tool. Rows, first match:
//   1. its record can't be read            → nothing: unknown.          Codex's config.toml half-written: Codex owes nothing.
//   2. no entry for the plugin             → nothing (found, or never on). Installed by hand in Codex alone: its row offers Add.
//   3. wanted, has it (whole, items)       → nothing.                    On, in Claude Code: in line there.
//   4. wanted, lacks it, its installer     → install.                    On, Codex lacks it: `codex plugin add`.
//   5. wanted, lacks it, items can go in   → install-items.              On, Pi lacks it: its items On there (pluginlibrary.ts).
//   6. wanted, lacks it, no way in         → held, with why.             On, Copilot CLI refuses the marketplace: said.
//   7. not wanted, lacks it                → nothing.                    Off, nowhere: in line.
//   8. not wanted, has it, can't take out  → held, with why.             Off, Claude Code's copy is the Anthropic Directory's.
//   9. not wanted, has it whole            → uninstall.                  Kept out of Codex, Codex has it: `codex plugin remove`.
//  10. not wanted, has its items           → remove-items.               Off, Pi has its items: they turn Off there.
// An install (rows 4, 5) is also owed to the automatic updates where the tool is not on the home's `tools` (it is new here,
// or managed again): `background`; but not while some tool has the plugin off by its own switch (`offElsewhere`: one turned
// off somewhere is not wanted everywhere, read from the tools at each look). Nothing else is: an uninstall runs only at the
// plugin's own click (its switch, a tool's box unticked), and an install in a tool already on `tools` (one that failed, one
// removed there by hand) waits for its box to be ticked on the plugin's page. "Has it" is installed whole, or (in Pi, OpenCode
// and Antigravity, which have no plugin installer) some item linked to the plugin wanted in that tool (`items`). In Pi, OpenCode and Antigravity a
// plugin whose parts from before the library wait to be moved has none and can't go in (rows 7 and 6: pluginstatus.ts toolNow,
// waitsToMove), so nothing is owed there until partsmigrate.ts has moved them. An item's own `except` decides where it is; the
// entry's only seeds a new item's (pluginlibrary.ts), and a click on one tool changes that tool in each item's `except` alone. A
// tool new here gets the items already On by the library's own rule; the automatic updates' install there only makes the items
// the library lacks.
//
// The first read (firstRecord) makes plugins.json for a home that has none, from what the tools hold now, writing nothing to
// any tool: each plugin some managed tool has is On, kept out of every tool that lacks it while some managed tool lacks it.
// What a click runs of the table's answer is clickRuns (On only installs, Off only uninstalls), beside it.
// A TOOL'S BOX on the plugin's page (marketplaces.ts turnedEntry) changes the entry, then the table answers for that tool alone:
//   On, ticked                → the tool leaves `except` (row 4 or 5 installs).
//   On, unticked              → the tool joins `except` (row 9 or 10 takes it out); where no other tool it is let into has it, the plugin's Off
//                               instead, `except` as it was, so its On brings it back where it last was.
//   Off or no entry, ticked   → On, `except` by the first read's rule (firstEntry), the ticked tool counted as having it.
//   No entry, unticked        → the first read's rule, then as On, unticked.
//   Off, unticked             → the entry as it is (`except` changes only while On): that tool's copy is taken out (row 9 or 10).
// In Pi, OpenCode and Antigravity a tick turns On only what it brings into that tool: an item that comes On is kept out of every other tool
// it wasn't in (pluginlibrary.ts clickOn). A copy that can't be taken out here has its box off (pluginstatus.ts boxOf).
// Who reads what: marketplaces.ts gathers what the tools have (pluginstatus.ts toolNow) and carries out a click (turn, undoTurn); the
// automatic updates carry out the background's installs (pluginupdates.ts); the pages and pluginstatus.ts say the answer.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessIds } from './harnesses.ts';
import { sameSource } from './plugins.ts';
import { NOTHING_CHANGED, errorCode, libraryGate, storeDirectory, writeDurably, type ShareContext } from './share.ts';
import type { Kind, Seen } from './librarypass.ts';
import type { HarnessId, PluginTurn } from './types.ts';
import { onlyAllowed } from './values.ts';
// "Wanted" means what it means for a library item (On, and not kept out of the tool): one rule, library.ts's.
import { wantedIn } from './library.ts';

/** One plugin as the home records it. */
export interface PluginEntry {
  /** Its own name, which each of its items in the library holds as its source (library.ts A PLUGIN). */
  id: string;
  /** The marketplace as added (its address), and the name its catalog gives it (the tools write plugin@marketName). */
  source: string;
  marketName: string;
  plugin: string;
  on: boolean;
  /** The tools it is kept out of: those whose box he unticked, and those the first read's rule left out (the first read, and a tick on a plugin Off or with no entry: A TOOL'S BOX). */
  except: HarnessId[];
}
/** plugins.json. */
export interface PluginRecord {
  /** The managed tools that are not new here (the header says who adds and takes away); one not here is owed each On plugin's install by the automatic updates (`background`). */
  tools: HarnessId[];
  /** The tools it was written knowing; one written before this field knew five (KNEW_FIVE). bringForward adds the others. */
  knows: HarnessId[];
  plugins: PluginEntry[];
}

/** What one managed tool has of a plugin now, and how it could take it in or out (marketplaces.ts toolsNow reads it). */
export interface ToolNow {
  /** Installed whole, some item linked to it wanted there (Pi, OpenCode, Antigravity), none, or its record can't be read now. */
  has: 'whole' | 'items' | 'none' | 'unknown';
  /** How it would go in: the tool's own installer, as library items, or why it can't (pluginstatus.ts says it). */
  route: 'whole' | 'items' | { cannot: string };
  /** Why its copy can't be taken out here, if it can't (pluginstatus.ts cantUninstall). */
  stuck?: string;
}
/** The table's answer for one tool. */
export interface Owed {
  wanted: boolean;
  has: ToolNow['has'];
  /** It could take the plugin: by its installer or as items (a tool that can't is never what makes a plugin partial). */
  takes: boolean;
  /** What brings the tool into line; none when it is in line, held (`held`) or unknown. */
  act?: 'install' | 'install-items' | 'uninstall' | 'remove-items';
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
    const owes = { ...is, act: now.route === 'whole' ? 'install' as const : 'install-items' as const };
    if (seen.includes(tool)) return owes;
    return offSomewhere ? { ...owes, offElsewhere: true } : { ...owes, background: true };
  }
  if (is.has === 'none') return is;
  if (is.has === 'whole') return now.stuck ? { ...is, held: now.stuck } : { ...is, act: 'uninstall' };
  return { ...is, act: 'remove-items' };
}

/** Which way a click on a plugin goes: On, Add and a tool's box ticked (`let-in`) put it in; Off and a box unticked (`keep-out`) take it out. */
export const clickGoes = (what: PluginTurn): 'in' | 'out' => (what === 'on' || what === 'add' || what === 'let-in' ? 'in' : 'out');
/** What a click runs in one tool: what the table owes there, only where it goes the click's way (On never uninstalls, Off never installs). */
export function clickRuns(what: PluginTurn, owed: Owed): Owed['act'] {
  const inward = owed.act === 'install' || owed.act === 'install-items';
  return owed.act && inward === (clickGoes(what) === 'in') ? owed.act : undefined;
}
/** Why a click can do nothing in one tool, as the table holds it, where that hold is the click's way. */
export const clickHeld = (what: PluginTurn, owed: Owed) => (owed.held && owed.wanted === (clickGoes(what) === 'in') ? owed.held : undefined);

/** A plugin of the home's record by its marketplace (one address however it is spelt) and name. */
export const entryOf = (record: Pick<PluginRecord, 'plugins'> | undefined, source: string, plugin: string) =>
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
    if (!managed.includes(held.tool) || entryOf({ plugins }, held.source, held.plugin)) continue;
    plugins.push(firstEntry(managed, holdings, waited, held));
  }
  return { tools: managed.filter(tool => !waited.some(wait => wait.tool === tool)), knows: [...harnessIds], plugins };
}

/**
 * The entry the first read makes for the plugin `held` names (firstRecord's rule above), from every holding of it. Also the
 * entry the parts' migration makes for a plugin whose parts are only in tools not managed (partsmigrate.ts).
 */
export function firstEntry(managed: HarnessId[], holdings: Holding[], waited: WaitedBefore[], held: Holding): PluginEntry {
  const mine = holdings.filter(other => other.plugin === held.plugin && sameSource(other.source, held.source));
  const has = (tool: HarnessId) => mine.some(other => other.tool === tool);
  const waits = (tool: HarnessId) => waited.some(wait => wait.tool === tool && wait.plugin === held.plugin && sameSource(wait.source, held.source));
  const except = managed.every(has) ? [] : harnessIds.filter(tool => !has(tool) && !waits(tool));
  return { ...newEntry(held.source, held.marketName, held.plugin, true), except };
}

// ---------- A record that knew fewer tools ----------

/** The tools every record written before `knows` knew. */
const KNEW_FIVE: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
/**
 * An `except` from a record that knew only `knows`: what keeps something out of some tool it knew (`keeps`: its own list, or for
 * an item its plugin's entry) keeps it out of every tool it didn't, as the same selection saved now would; kept out of none, it
 * stays wanted everywhere. The plugins' entries are brought forward so as they are read (readPluginRecord).
 */
export const keptOutOfNew = (except: HarnessId[], knows: readonly HarnessId[], keeps = except.length > 0) =>
  (keeps ? [...except, ...harnessIds.filter(tool => !knows.includes(tool) && !except.includes(tool))] : except);

/**
 * A record that knew fewer tools brought forward, once, by the pass before it writes (homepass.ts): each item linked to a plugin
 * (in `kinds`' records, as this module is below them) is kept out where keptOutOfNew says; then the record is saved knowing every
 * tool, last, so a pass stopped before that does the same again.
 */
export async function bringForward(context: ShareContext, kinds: readonly Pick<Kind<unknown, Seen>, 'open' | 'save'>[]) {
  const { record } = await readPluginRecord(context.home), gate = await libraryGate(context);
  if (!record || harnessIds.every(tool => record.knows.includes(tool)) || 'refused' in gate || !gate.record) return;
  const keeps = new Map(record.plugins.map(entry => [entry.id, entry.except.length > 0]));
  for (const kind of kinds) {
    const { library, problem } = await kind.open(context, true), before = JSON.stringify(library);
    if (problem) return;
    for (const item of Object.values(library.items)) if (item.source && keeps.has(item.source)) item.except = keptOutOfNew(item.except, record.knows, keeps.get(item.source) || item.except.length > 0);
    if (JSON.stringify(library) !== before) await kind.save(context.home, library);
  }
  await savePluginRecord(context.home, { ...record, knows: [...harnessIds] });
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
    const read = JSON.parse(text) as { formatVersion?: number; tools?: unknown; knows?: unknown; plugins?: unknown[] } | null;
    if ((read?.formatVersion ?? 0) > FORMAT_VERSION) return { problem: `The plugins record was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    const tools = onlyAllowed(read?.tools, harnessIds), knows = read?.knows === undefined ? KNEW_FIVE : onlyAllowed(read.knows, harnessIds);
    if (read?.formatVersion === FORMAT_VERSION && Array.isArray(read.tools) && tools.length === read.tools.length && Array.isArray(read.plugins) && read.plugins.every(isEntry)) {
      return { record: { tools, knows, plugins: read.plugins.map(entry => ({ ...entry, except: keptOutOfNew(entry.except, knows) })) } };
    }
  } catch { /* said below */ }
  return { problem: `The plugins record is damaged. ${NOTHING_CHANGED}` };
}

export const savePluginRecord = (home: string, record: PluginRecord) =>
  writeDurably(recordPath(home), `${JSON.stringify({ formatVersion: FORMAT_VERSION, tools: record.tools, knows: record.knows, plugins: record.plugins }, null, 2)}\n`);
