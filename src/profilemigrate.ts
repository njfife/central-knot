// The profiles file from before profiles were sets of library items (format 1), moved once to format 2 (profiles.ts). Format 1
// kept, besides each profile's items, `offByProfile` (each tool's own switch a profile switch had turned off: skillswitch.ts,
// mcpswitch.ts) and `active` (the profile last switched to). The move translates those holds and changes nothing else:
//   items         a skill keeps its key; an MCP server named as written is named by its key (profiles.ts readProfileFile);
//                 every agent On now joins every profile, since format 1 named none and the next switch would turn them Off
//   offByProfile  every switch it lists is released, those and no others, whether or not the item's copy is there now:
//                 where it is (a skill's rule, Claude Code's deny and Copilot CLI's list are outside the copy; Codex's,
//                 Pi's and OpenCode's server switch is inside the entry, cleared in the file when the entry is there) with
//                 skillswitch.ts setDisabled, the write skills.ts clearSwitch makes, and mcpswitch.ts withMcpSwitch; or, for
//                 a server whose entry is out of the tool, in the own part Central Knot keeps for it (mcpswitch.ts
//                 ownWithoutSwitch), so On brings it back on. Every other own field stays. An item in the library those
//                 switches hold off in every tool that has it (each tool whose copy it is reads it now) is turned Off; one
//                 that some tool still loads, or that a tool can't be read for, stays as it is. A switch set by hand is not
//                 listed, and stays.
//   active        dropped: which profile is in use is worked out (profileplan.ts inUse)
// Two orders matter. An item is Off on record before its switches are released, and its copies are taken out by a pass after
// that, so a server's entry goes with its own part as released. A server's deny in Claude Code is kept instead while Claude
// Code has its entry and the server is not wanted there afterwards, since that entry goes only at Write to Claude Code and
// would start meanwhile: it is listed, and cleared the first time a pass finds the server wanted in Claude Code (servers.ts
// releaseKeptDenies).
// The steps, in order, each safe to stop after: one History entry saying what it turns Off (profiles.ts profileEvent,
// `migrated`; its Undo turns those items back On), written only when something turns Off; the items Off, and kept own parts
// released, on record; the switches released, and Claude Code's kept ones listed; a pass on the held items that are Off (what
// this run or a stopped one turned Off: an item that stays On is left to the ordinary sync rule, with Sync off too); the old
// file kept as profiles.v1.json; the new one written. Until the last, the file is format 1, and the next pass does what is
// left. homepass.ts homePass, the pass main.ts runs at start and after, runs it first, where a pass may write.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentKind } from './agents.ts';
import { appendHistory } from './history.ts';
import { itemKey, wantedIn, type LibraryItem } from './library.ts';
import { ownText } from './mcp.ts';
import { mcpSwitchPath, ownWithoutSwitch, withMcpSwitch } from './mcpswitch.ts';
import { itemId } from './profileplan.ts';
import { profileEvent, readProfileFile, saveProfiles, whyNotNow } from './profiles.ts';
import { applyServers, serverKind, serversView } from './servers.ts';
import { keepDenies, keepOwn, keptDenies, keptOwn } from './serverstore.ts';
import { storeDirectory, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { rootOf } from './skillfiles.ts';
import { applySkills, skillKind, skillsView } from './skills.ts';
import { setDisabled } from './skillswitch.ts';
import type { HarnessId, LibraryFacts, LibraryView } from './types.ts';
import { record } from './values.ts';

/**
 * One item format 1 held off: its kind and key, its name as format 1 wrote it (the name its switches go by), its row as its
 * page reads it now, and the tools whose switch it lists.
 */
interface Hold { kind: 'skill' | 'mcp'; key: string; name: string; row?: LibraryFacts; listed: HarnessId[] }

/** Whether the tool's own switch has the held item off now, and which tools have it at all (their copy is read now). */
const offIn = (hold: Hold, tool: HarnessId) => (hold.kind === 'skill' ? !!hold.row?.loads?.[tool]?.off : !!hold.row?.switchedOff?.includes(tool));
const hasIt = (hold: Hold) => Object.keys((hold.kind === 'skill' ? hold.row?.loads : hold.row?.copies) ?? {}) as HarnessId[];
/** Off in every tool that has it, by listed switches, with nothing about it unread. */
const heldEverywhere = (hold: Hold) => !!hold.row && !hold.row.unseen && !hold.row.switchProblem && hasIt(hold).length > 0
  && hasIt(hold).every(tool => hold.listed.includes(tool) && offIn(hold, tool));

/** Format 1's holds, each with the row its kind's page reads now (skills by key, servers by their name's key). */
function holdsOf(offByProfile: unknown, skills: LibraryView, servers: LibraryView): Hold[] {
  return Object.entries(record(offByProfile) ?? {}).flatMap(([id, tools]): Hold[] => {
    const listed = (Array.isArray(tools) ? tools : []).filter((tool): tool is HarnessId => typeof tool === 'string');
    const kind = id.startsWith('mcp:') ? 'mcp' as const : id.startsWith('skill:') ? 'skill' as const : undefined;
    if (!kind || !listed.length) return [];
    const name = id.slice(id.indexOf(':') + 1), key = itemKey(name), view = kind === 'skill' ? skills : servers;
    return [{ kind, key, name, row: view.items.find(row => row.key === key), listed }];
  });
}

/** Where a held server's switch in a tool is released: in Claude Code's list kept until it is wanted there, in its file, or in its kept own part. */
type ServerRelease = 'kept' | 'file' | 'own';

/** Moves a format 1 profiles file to format 2 (the header says how). Does nothing for any other file, or where a pass may not write. */
export async function migrateProfiles(context: ShareContext, tools: HarnessId[]): Promise<void> {
  const file = await readProfileFile(context.home);
  if (file.format !== 1 || !file.raw) return;
  if (await whyNotNow(context)) return;
  const [skills, servers, agents] = await Promise.all([skillsView(context, tools), serversView(context, tools), agentKind.open(context)]);
  if (skills.gate.state === 'stopped' || servers.gate.state === 'stopped' || agents.problem) return;
  const holds = holdsOf(file.raw.offByProfile, skills, servers);
  const library = (hold: Hold) => (hold.kind === 'skill' ? skills : servers).library[hold.key];
  const turnOff = holds.filter(hold => heldEverywhere(hold) && library(hold)?.on && !library(hold)?.deleted);
  const serverClears = holds.filter(hold => hold.kind === 'mcp').flatMap(hold => hold.listed.map(tool => ({ hold, tool, at: releaseAt(hold, tool, turnOff.includes(hold), library(hold)) })));
  const active = file.view.profiles.find(profile => profile.id === file.raw!.active)?.name;
  if (turnOff.length) {
    const off = turnOff.map(hold => ({ id: itemId(hold.kind, hold.key), name: library(hold)!.name }));
    await appendHistory(context, [profileEvent(context, active ?? 'Profiles', { ...(active ? { toName: active } : {}), migrated: true, on: [], off })]);
  }
  if (!(await onRecord(context, turnOff, serverClears.filter(clear => clear.at === 'own')))) return;
  await releaseSkills(context, holds.filter(hold => hold.kind === 'skill'), skills);
  await releaseInFiles(context, serverClears.filter(clear => clear.at === 'file'));
  const kept = serverClears.filter(clear => clear.at === 'kept').map(({ hold }) => hold.row!.copies['claude-cli']!.folder);
  if (kept.length) await keepDenies(context.home, [...await keptDenies(context.home), ...kept]);
  const offNow = (kind: Hold['kind']) => ({ only: new Set(holds.filter(hold => hold.kind === kind && (turnOff.includes(hold) || library(hold)?.on === false)).map(hold => hold.key)) });
  await applySkills(context, tools, [], offNow('skill'));
  await applyServers(context, tools, [], offNow('mcp'));
  const agentsOn = Object.values(agents.library.items).filter(item => item.on && !item.deleted).map(item => itemId('agent', item.key));
  await writeDurably(join(storeDirectory(context.home), 'profiles.v1.json'), file.text!);
  await saveProfiles(context.home, file.view.profiles.map(profile => ({ ...profile, items: [...new Set([...profile.items, ...agentsOn])] })));
}

/**
 * Where a held server's switch in one tool is released (ServerRelease): Claude Code's deny, where it is set now, is kept while Claude Code has
 * the server's entry and the server, in the library, is not wanted there once this is done (`off`: turned Off now), so the entry
 * doesn't start before Write takes it out; Codex's, Pi's and OpenCode's switch is in the kept own part where the entry is out of
 * the tool; every other is released in its settings file at once.
 */
function releaseAt(hold: Hold, tool: HarnessId, off: boolean, item: LibraryItem | undefined): ServerRelease {
  if (tool === 'claude-cli') return item && hold.row?.copies[tool] && offIn(hold, tool) && (off || !wantedIn(item, tool)) ? 'kept' : 'file';
  return tool !== 'copilot-cli' && !hold.row?.copies[tool] ? 'own' : 'file';
}

/**
 * On record, before any switch is released: the items turned Off, and each held server's switch released in the own part kept
 * for a tool its entry is out of. False when a record can't be opened (nothing more is done; the next pass tries again).
 */
async function onRecord(context: ShareContext, turnOff: Hold[], own: { hold: Hold; tool: HarnessId }[]): Promise<boolean> {
  for (const kind of [skillKind, serverKind]) {
    const off = turnOff.filter(hold => hold.kind === kind.kind), owned = kind === serverKind ? own : [];
    if (!off.length && !owned.length) continue;
    const { library: saved, problem } = await kind.open(context, true);
    if (problem) return false;
    for (const hold of off) saved.items[hold.key].on = false;
    for (const { hold, tool } of owned) {
      const item = saved.items[hold.key], kept = item && await keptOwn(context, item, tool), cleared = kept && ownWithoutSwitch(tool, kept);
      if (cleared) await keepOwn(context, item, tool, ownText(cleared));
    }
    await kind.save(context.home, saved);
  }
  return true;
}

/**
 * Releases each listed skill switch with skillswitch.ts setDisabled (Claude Code's override put back as it was kept), whether
 * or not the copy is there: a tool's switch goes by the copy's folder, name or path, which a copy that is gone had as the item's
 * name in that tool's folder. A switch that can't be released (its file can't be read or changed meanwhile) is left: from then
 * on it is a tool's own switch, shown with its mark.
 */
async function releaseSkills(context: ShareContext, holds: Hold[], view: LibraryView) {
  for (const hold of holds) for (const tool of hold.listed) {
    const name = view.library[hold.key]?.name ?? hold.row?.name ?? hold.name;
    const target = hold.row?.loads?.[tool] ?? { folder: name, name, skillFile: join(rootOf(context, tool), name, 'SKILL.md') };
    await setDisabled(context, tool, { folder: target.folder, name: target.name, skillFile: target.skillFile }, false).catch(() => undefined);
  }
}

/**
 * Releases each held server's switch kept in a tool's settings file (Claude Code's and Copilot CLI's list, or the entry in
 * Codex's, Pi's or OpenCode's file) with mcpswitch.ts withMcpSwitch, one checked write per file, by the name the entry has there
 * (or format 1's, for a list whose entry is gone). A file that can't be read or changed meanwhile is left as it is.
 */
async function releaseInFiles(context: ShareContext, clears: { hold: Hold; tool: HarnessId }[]) {
  for (const tool of new Set(clears.map(clear => clear.tool))) {
    const names = clears.filter(clear => clear.tool === tool).map(({ hold }) => hold.row?.copies[tool]?.folder ?? hold.name);
    const path = mcpSwitchPath(context, tool);
    try {
      const text = await readFile(path, 'utf8');
      await writeFileChecked(path, names.reduce((now, name) => withMcpSwitch(tool, now, name, false), text), text);
    } catch { /* left as it is */ }
  }
}
