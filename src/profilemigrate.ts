// The profiles file from before profiles were sets of library items (format 1), moved once to format 2 (profiles.ts). Format 1
// kept, besides each profile's items, `offByProfile` (each tool's own switch a profile switch had turned off: skillswitch.ts,
// mcpswitch.ts) and `active` (the profile last switched to). The move translates those holds and does nothing else:
//   items         a skill keeps its key; an MCP server named as written is named by its key (profiles.ts readProfileFile);
//                 every agent On now joins every profile, since format 1 named none and the next switch would turn them Off
//   offByProfile  each switch it lists is cleared, those and no others (skillswitch.ts setDisabled, the write skills.ts
//                 clearSwitch makes; mcpswitch.ts withMcpSwitch). An item in the library those switches hold off in every
//                 tool that has it (each tool whose copy it is reads it now) is turned Off; one that some tool still loads,
//                 or that a tool can't be read for, stays as it is. A switch set by hand is not listed, and stays.
//   active        dropped: which profile is in use is worked out (profileplan.ts inUse)
// Two orders matter. An item is Off on record before its switches are cleared, and its copies are taken out by a pass after
// that: where a server's switch is inside its entry (Codex, Pi, OpenCode), that pass keeps the entry's own part as it is with
// the switch cleared, so On brings it back on. A server's switch in Claude Code is kept instead where the server is not wanted
// there afterwards, since its entry goes only at Write to Claude Code and would start meanwhile; it is cleared the first time a
// pass finds the server wanted in Claude Code (servers.ts releaseKeptDenies, from serverstore.ts keptDenies).
// The steps, in order, each safe to stop after: one History entry saying what it turns Off and clears (profiles.ts
// profileEvent, `migrated`; its Undo turns those items back On); the items Off on record; the switches cleared, and Claude
// Code's kept ones listed; a pass on the items the file held; the old file kept as profiles.v1.json; the new one written. Until
// the last, the file is format 1, and the next pass does what is left. main.ts pass runs it first, where a pass may write.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentKind } from './agents.ts';
import { appendHistory } from './history.ts';
import { itemKey, wantedIn } from './library.ts';
import { mcpSwitchPath, withMcpSwitch } from './mcpswitch.ts';
import { itemId } from './profileplan.ts';
import { profileEvent, readProfileFile, saveProfiles, whyNotNow } from './profiles.ts';
import { applyServers, serverKind, serversView } from './servers.ts';
import { keepDenies, keptDenies } from './serverstore.ts';
import { storeDirectory, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { applySkills, skillKind, skillsView } from './skills.ts';
import { setDisabled } from './skillswitch.ts';
import type { HarnessId, LibraryFacts, LibraryView } from './types.ts';
import { record } from './values.ts';

/** One item format 1 held off: its kind and key, its row as its page reads it now, and the tools whose switch it lists. */
interface Hold { kind: 'skill' | 'mcp'; key: string; row?: LibraryFacts; listed: HarnessId[] }

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
    const key = itemKey(id.slice(id.indexOf(':') + 1)), view = kind === 'skill' ? skills : servers;
    return [{ kind, key, row: view.items.find(row => row.key === key), listed }];
  });
}

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
  // Claude Code's switch for a server not wanted there once this is done is kept: its entry goes only at Write to Claude Code.
  const keptInClaude = (hold: Hold) => hold.kind === 'mcp' && !!library(hold) && (turnOff.includes(hold) || !wantedIn(library(hold)!, 'claude-cli'));
  const clears = holds.flatMap(hold => hold.listed.filter(tool => offIn(hold, tool)).map(tool => ({ hold, tool })));
  const kept = clears.filter(({ hold, tool }) => tool === 'claude-cli' && keptInClaude(hold));
  const active = file.view.profiles.find(profile => profile.id === file.raw!.active)?.name;
  if (turnOff.length || clears.length > kept.length) {
    const off = turnOff.map(hold => ({ id: itemId(hold.kind, hold.key), name: library(hold)!.name }));
    await appendHistory(context, [profileEvent(context, active ?? 'Profiles', { ...(active ? { toName: active } : {}), migrated: true, on: [], off, cleared: clears.length - kept.length })]);
  }
  for (const kind of [skillKind, serverKind]) {
    const off = turnOff.filter(hold => hold.kind === kind.kind);
    if (!off.length) continue;
    const { library: saved, problem } = await kind.open(context, true);
    if (problem) return;
    for (const hold of off) saved.items[hold.key].on = false;
    await kind.save(context.home, saved);
  }
  await clearSwitches(context, clears.filter(clear => !kept.includes(clear)));
  if (kept.length) await keepDenies(context.home, [...await keptDenies(context.home), ...kept.map(({ hold }) => hold.row!.copies['claude-cli']!.folder)]);
  const only = (kind: Hold['kind']) => ({ only: new Set(holds.filter(hold => hold.kind === kind).map(hold => hold.key)) });
  await applySkills(context, tools, [], only('skill'));
  await applyServers(context, tools, [], only('mcp'));
  const agentsOn = Object.values(agents.library.items).filter(item => item.on && !item.deleted).map(item => itemId('agent', item.key));
  await writeDurably(join(storeDirectory(context.home), 'profiles.v1.json'), file.text!);
  await saveProfiles(context.home, file.view.profiles.map(profile => ({ ...profile, items: [...new Set([...profile.items, ...agentsOn])] })));
}

/**
 * Clears each switch: a skill's with skillswitch.ts setDisabled (Claude Code's override put back as it was kept), a server's
 * with mcpswitch.ts withMcpSwitch, one checked write per settings file. A switch that can't be cleared (its file can't be read
 * or changed meanwhile) is left as it is: from then on it is a tool's own switch, shown with its mark.
 */
async function clearSwitches(context: ShareContext, clears: { hold: Hold; tool: HarnessId }[]) {
  for (const { hold, tool } of clears.filter(clear => clear.hold.kind === 'skill')) {
    const { folder, name, skillFile } = hold.row!.loads![tool]!;
    await setDisabled(context, tool, { folder, name, skillFile }, false).catch(() => undefined);
  }
  for (const tool of new Set(clears.filter(clear => clear.hold.kind === 'mcp').map(clear => clear.tool))) {
    const names = clears.filter(clear => clear.hold.kind === 'mcp' && clear.tool === tool).map(clear => clear.hold.row!.copies[tool]!.folder);
    const path = mcpSwitchPath(context, tool);
    try {
      const text = await readFile(path, 'utf8');
      await writeFileChecked(path, names.reduce((now, name) => withMcpSwitch(tool, now, name, false), text), text);
    } catch { /* left as it is */ }
  }
}
