// The one place the tools Central Knot manages in a home change (presence.ts managedTools reads the choice).
import { forgetAgentCopies } from './agents.ts';
import { forgetMcpCopies } from './mcp.ts';
import { gateRefusal, newRecord, readRecord, remember, saveRecord, syncGate, writeAccess, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/**
 * Makes `tools` the ones Central Knot manages in this home. Every record forgets its copies in the tools left out, so a tool
 * managed again later starts as one with copies of its own: an edit or a deletion made there meanwhile is never spread, whether
 * or not a pass ran while it was out. Run between passes, like any other write to the records.
 */
export async function chooseTools(context: ShareContext, tools: HarnessId[]): Promise<{ stopped?: string }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  const gate = await syncGate(context);
  const refused = gateRefusal(gate);
  if (refused) return { stopped: refused };
  const record = (await readRecord(context.home)).record ?? newRecord(context);
  record.tools = [...tools];
  for (const item of Object.values(record.items)) item.copies = item.copies.filter(copy => tools.includes(copy.harness));
  await saveRecord(context.home, record);
  if (gate.state === 'first-setup') await remember(context, record.generation);
  await forgetMcpCopies(context.home, tools);
  await forgetAgentCopies(context.home, tools);
  return {};
}
