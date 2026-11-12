// The one place the tools Central Knot manages in a home change (presence.ts managedTools reads the choice).
import { forgetAgentFolders } from './agents.ts';
import { forgetMcpCopies } from './mcp.ts';
import { gateRefusal, newRecord, readRecord, remember, saveRecord, syncGate, writeAccess, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/**
 * Makes `tools` the ones Central Knot manages in this home. Every record forgets its copies in the tools left out, so a tool
 * managed again later starts as one with copies of its own: an edit or a deletion made there meanwhile is never spread, whether
 * or not a pass ran while it was out. Run between passes, like any other write to the records.
 * (For agents: its folder is let go, so when the tool is managed again the library wins there, a copy that differs is kept
 * as a version first, and a copy of an agent that is Off is removed: agents.ts guardFolders.)
 */
export async function chooseTools(context: ShareContext, tools: HarnessId[]): Promise<{ stopped?: string }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  const gate = await syncGate(context);
  const refused = gateRefusal(gate);
  if (refused) return { stopped: refused };
  // The MCP and agent records forget first: if a write here fails, the list is unchanged and nothing is half left out.
  await forgetMcpCopies(context.home, tools);
  await forgetAgentFolders(context, tools);
  const record = (await readRecord(context.home)).record ?? newRecord(context);
  record.tools = [...tools];
  for (const item of Object.values(record.items)) item.copies = item.copies.filter(copy => tools.includes(copy.harness));
  await saveRecord(context.home, record);
  if (gate.state === 'first-setup') await remember(context, record.generation);
  return {};
}
