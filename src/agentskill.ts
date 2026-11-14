// Convert to skill (AGT-02): a one-time snapshot of an agent as an ordinary skill, for Pi, which has no native agents.
// It is no part of syncing agents (agents.ts): the skill is written to Pi's own skills folder (no root the agent's tool
// reads, AGT-03), where it came from is recorded so it is never placed back in that tool, and skill edits never write to
// any agent. The caller then takes it into Central Knot's library, On in Pi alone (skills.ts says where a converted skill
// came from, and never gives it to the agent's own tool by itself).
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isAgentTool, readAgents, safeName, type AgentEntry } from './agentfiles.ts';
import { harnesses, writeRoot } from './harnesses.ts';
import { readConverted, recordConverted } from './skillstore.ts';
import { agentTools } from './presence.ts';
import { itemKey, libraryGate, writeFileChecked, type ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';

/** What an agent has that a skill never does (AGT-02): said on the converted skill, never "agent installed". */
export const conversionLosses = ['its own isolated context', 'tool restrictions', 'model selection', 'being picked as an agent (it is invoked as a skill)'];

/** The agent's copy with the most of it: Claude Code's first, as the fullest format, among the tools here. */
async function fullestCopy(context: ShareContext, tools: HarnessId[], key: string): Promise<AgentEntry | undefined> {
  for (const tool of agentTools.filter(tool => tools.includes(tool) && isAgentTool(tool))) {
    const entry = (await readAgents(context, tool)).entries.find(candidate => candidate.key === itemKey(key));
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Converts one agent: its fullest copy written as Pi's skill, and where it came from recorded. Refused where a click may not
 * write (share.ts libraryGate); `resume`: the click is a Resume, so the pass that takes the skill in after it is not refused.
 */
export async function convertAgentToSkill(context: ShareContext, tools: HarnessId[], key: string, resume = false): Promise<{ stopped?: string; skill?: string; origin?: HarnessId }> {
  const gate = await libraryGate(context, { start: true, resume });
  if ('refused' in gate) return { stopped: gate.refused };
  if (!tools.includes('pi-cli')) return { stopped: 'Pi is not in this home, so there is nowhere to convert to.' };
  const entry = await fullestCopy(context, tools, key);
  if (!entry) return { stopped: 'That agent is not there any more.' };
  const { name, agent } = entry, skill = name.toLowerCase();
  if (!agent.description.trim()) return { stopped: `Pi skips a skill with no description, and “${name}” has none. Add one to the agent first.` };
  if (!safeName(name)) return { stopped: 'This agent’s name can’t be a folder name.' };
  const folder = join(writeRoot(harnesses['pi-cli'], context.home, context.overrides?.['pi-cli']), name);
  try { await stat(folder); return { stopped: `Pi already has a skill named “${name}”. Nothing was written.` }; } catch { /* free */ }
  if ((await readConverted(context.home))[skill]) return { stopped: `“${name}” was converted before.` };
  const front = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(agent.description)}\n---\n\n`;
  await mkdir(folder, { recursive: true });
  await writeFileChecked(join(folder, 'SKILL.md'), `${front}${agent.prompt.replace(/^\s+/, '')}${agent.prompt.endsWith('\n') ? '' : '\n'}`, undefined);
  const losses = [...conversionLosses, ...Object.keys(agent.fields).map(field => `“${field}”`)];
  await recordConverted(context.home, skill, { agent: name, origin: entry.tool, at: new Date().toISOString(), losses });
  return { skill, origin: entry.tool };
}
