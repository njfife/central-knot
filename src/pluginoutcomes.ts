// What each kind of plugin component does in each tool (capability data, Appendix D, tested versions), and the counts a
// plugin's contents give. Pure, so both the main process and the plugin page can use it.
import type { Components, HarnessId, Outcome, PluginContents } from './types.ts';

/** The counts a row shows, from a plugin's read contents. */
export const componentsFrom = (contents: PluginContents): Components => ({
  skills: contents.skills.length, commands: contents.commands.length, agents: contents.agents.length, hooks: contents.hooks.length > 0,
  mcp: contents.mcpServers.length, mcpRootVariable: contents.mcpUsesPluginRoot, bin: contents.bin, skillNames: contents.skills.map(skill => skill.name),
});

/** What each component does on each tool (capability data, Appendix D, tested versions). Tools without plugins get []. */
export function outcomes(tool: HarnessId, components: Components): Outcome[] {
  if (tool !== 'claude-cli' && tool !== 'copilot-cli' && tool !== 'codex-cli') return [];
  const list: Outcome[] = [];
  const add = (present: boolean | number, component: string, result: Outcome['result'], text: string, names?: Outcome['names']) => { if (present) list.push({ component, result, text, ...(names ? { names } : {}) }); };
  if (tool === 'claude-cli') {
    add(components.skills, 'Skills', 'works', 'keep their names');
    add(components.commands, 'Commands', 'works', 'work as they are');
    add(components.agents, 'Agents', 'works', 'work as they are');
    add(components.hooks, 'Hooks', 'works', 'run; a hook that fails does not stop the install');
    add(components.mcp, 'MCP servers', 'works', 'run unchanged');
  } else if (tool === 'copilot-cli') {
    add(components.skills, 'Skills', 'works', 'keep their names');
    add(components.commands, 'Commands', 'limited', 'become skills');
    add(components.agents, 'Agents', 'works', 'get the plugin’s name in front, e.g.', 'agent');
    add(components.hooks, 'Hooks', 'limited', 'start-of-session hooks run; others may not');
    add(components.mcp, 'MCP servers', 'works', 'run unchanged');
  } else if (tool === 'codex-cli') {
    add(components.skills, 'Skills', 'works', 'get the plugin’s name in front, e.g.', 'skill');
    add(components.commands, 'Commands', 'limited', 'are turned into skills when installed');
    add(components.agents, 'Agents', 'ignored', 'are ignored: copied, never offered');
    add(components.hooks, 'Hooks', 'limited', 'start-of-session hooks run after you approve them in Codex; others may not');
    add(components.mcp, 'MCP servers', components.mcpRootVariable ? 'fails' : 'unknown', components.mcpRootVariable ? 'won’t start: Codex does not fill in ${CLAUDE_PLUGIN_ROOT}' : 'may not start: not confirmed in Codex');
  }
  if (components.bin) list.push({ component: 'Top-level bin/', result: tool === 'claude-cli' ? 'works' : 'unknown', text: tool === 'claude-cli' ? 'is added to the path' : 'may not be on the path: not confirmed here' });
  return list;
}
