// A tool's Manage switch (Harnesses): the one place the tools Central Knot manages in a home change (chooseTools), and what
// turning one on would do there (whatJoiningDoes), which its card says before the click. The choice is kept as the tools
// left out (share.ts SyncRecord leftOut) and read by presence.ts managedTools. What a tool that leaves or comes back means for
// each item is the model's (library.ts, "A HARNESS THAT LEAVES" and "A HARNESS MANAGED AGAIN"); main.ts runs the switch in its
// queue and reads the home again after it, which is the pass that brings a tool turned on into line.
import { randomUUID } from 'node:crypto';
import { agentKind } from './agents.ts';
import { harnessIds } from './harnesses.ts';
import { appendHistory } from './history.ts';
import { forgetFolders, joinCounts } from './librarypass.ts';
import { serverKind } from './servers.ts';
import { leftOutNow, libraryGate, saveRecord, type ShareContext } from './share.ts';
import { skillKind } from './skills.ts';
import type { HarnessId, HistoryEvent, JoinCounts } from './types.ts';
import { toolName } from './words.ts';

/**
 * Turns Central Knot's care of one tool on or off. Off: every kind lets go of that tool's folder (an MCP server's: its settings
 * file), so whenever it is managed again the library wins there, whether or not a pass ran meanwhile (librarypass.ts
 * guardFolders); its copies stay as they are and every item stays as it is. On: it is managed again, and the next pass brings it
 * into line. Refused, as a click is, where nothing may be written (preview only, another build's home, a damaged record); in a
 * home that waits for Resume it resumes, as a click does, only when asked (`resume`: the page showed that state). The first act
 * in a home with no record makes the record (Synchronize everything is left unanswered); a switch that is so already makes no record and resumes nothing. One History entry says it; it has no
 * Undo, since the switch is the way back. Run between passes, like any other write to the records.
 */
export async function chooseTools(context: ShareContext, tool: HarnessId, on: boolean, resume = false): Promise<{ stopped?: string }> {
  // A switch that is so already changes nothing, so it enters no gate: no record made, no home resumed.
  if ((await leftOutNow(context)).includes(tool) !== on) return {};
  const gate = await libraryGate(context, { start: true, resume });
  if ('refused' in gate) return { stopped: gate.refused };
  const { record } = gate, leftOut = record.leftOut ?? [];
  const next = on ? leftOut.filter(other => other !== tool) : [...leftOut, tool];
  // The records let go first: if a write here fails, the record is unchanged and nothing is half left out.
  if (!on) {
    const kept = harnessIds.filter(other => !next.includes(other));
    await forgetFolders(serverKind, context, kept);
    await forgetFolders(agentKind, context, kept);
    await forgetFolders(skillKind, context, kept);
  }
  if (next.length) record.leftOut = next; else delete record.leftOut;
  await saveRecord(context.home, record);
  await appendHistory(context, [managingEntry(context, tool, on)]);
  return {};
}

const managingEntry = (context: ShareContext, tool: HarnessId, on: boolean): HistoryEvent => ({
  id: randomUUID(), at: new Date(context.now?.() ?? Date.now()).toISOString(), key: `tool:${tool}`, item: toolName(tool),
  kind: 'managing', managing: { tool, on }, losers: [], orderProved: true,
});

/**
 * What turning `tool`'s Manage switch on would do there now, every kind's counts added up (librarypass.ts joinCounts: the
 * look and plans the pass then makes, with the tool added to `managed`). `rule`: the home's Synchronize everything is on.
 */
export async function whatJoiningDoes(context: ShareContext, managed: readonly HarnessId[], tool: HarnessId, rule: boolean): Promise<JoinCounts> {
  const tools = harnessIds.filter(other => other === tool || managed.includes(other));
  const each = [await joinCounts(skillKind, context, tools, tool, rule), await joinCounts(serverKind, context, tools, tool, rule), await joinCounts(agentKind, context, tools, tool, rule)];
  return { written: sum(each, 'written'), kept: sum(each, 'kept'), removed: sum(each, 'removed'), waits: sum(each, 'waits'), found: sum(each, 'found'), takenIn: sum(each, 'takenIn') };
}
const sum = (each: JoinCounts[], field: keyof JoinCounts) => each.reduce((total, counts) => total + counts[field], 0);
