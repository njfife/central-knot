// The one place the tools Central Knot manages in a home change (presence.ts managedTools reads the choice).
import { forgetAgentFolders } from './agents.ts';
import { forgetServerFolders } from './servers.ts';
import { forgetSkillFolders } from './skills.ts';
import { gateRefusal, newRecord, readRecord, remember, saveRecord, syncGate, writeAccess, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/**
 * Makes `tools` the ones Central Knot manages in this home. Every kind lets go of the folders (an MCP server's: settings
 * files) of the tools left out, so when a tool is managed again the library wins there, whether or not a pass ran while it was
 * out: a copy that differs is kept as a version first, and a copy of an item that is Off is removed (librarypass.ts
 * guardFolders and library.ts managedAgain). Run between passes, like any other write to the records. Each library is opened to
 * write, so a record from before the library is migrated first (skillstore.ts, serverstore.ts).
 */
export async function chooseTools(context: ShareContext, tools: HarnessId[]): Promise<{ stopped?: string }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  const gate = await syncGate(context);
  const refused = gateRefusal(gate);
  if (refused) return { stopped: refused };
  // The records forget first: if a write here fails, the list is unchanged and nothing is half left out.
  await forgetServerFolders(context, tools);
  await forgetAgentFolders(context, tools);
  await forgetSkillFolders(context, tools);
  const record = (await readRecord(context.home)).record ?? newRecord(context);
  record.tools = [...tools];
  await saveRecord(context.home, record);
  if (gate.state === 'first-setup') await remember(context, record.generation);
  return {};
}
