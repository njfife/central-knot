// What each kind of plugin component does in each tool (capability data, Appendix D, tested versions), which hook events can
// add text to sessions, and the counts a plugin's contents give. Pure, so both the main process and the plugin page can use it.
// An outcome's text may set code in backticks (the page draws it in monospace); what a tool's line shows of it, up to its
// colon (pluginstatus.ts limitNote), holds none.
// A plugin's instruction files have no row: no tool reads them (the plugin's page says so once).
import type { Components, HarnessId, Outcome, PluginContents } from './types.ts';

/**
 * The hook events whose hooks can add text to sessions: start-of-session and prompt hooks, in Claude Code's and Codex's
 * spelling, then Copilot CLI's (capability data, Appendix D). Told by the event alone; what a hook adds is known only when it runs.
 */
const SESSION_TEXT_EVENTS = ['SessionStart', 'UserPromptSubmit', 'sessionStart', 'userPromptSubmitted'];
export const canAddText = (event: string) => SESSION_TEXT_EVENTS.includes(event);

/** What a plugin's read contents come to: the counts its row shows (pluginstatus.ts summaryOf), and what its outcomes need. */
export const componentsFrom = (contents: PluginContents): Components => ({
  skills: contents.skills.length, commands: contents.commands.length, agents: contents.agents.length, hooks: contents.hooks.length > 0,
  mcp: contents.mcpServers.length, mcpRootVariable: contents.mcpUsesPluginRoot, bin: contents.bin, sessionTextHooks: contents.hooks.some(hook => canAddText(hook.event)),
  skillNames: contents.skills.map(skill => skill.name),
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
    add(components.sessionTextHooks, 'Session text', 'works', 'comes from start-of-session and prompt hooks');
    add(components.mcp, 'MCP servers', 'works', 'run unchanged');
  } else if (tool === 'copilot-cli') {
    add(components.skills, 'Skills', 'works', 'keep their names');
    add(components.commands, 'Commands', 'limited', 'become skills');
    add(components.agents, 'Agents', 'works', 'get the plugin’s name in front, e.g.', 'agent');
    add(components.hooks, 'Hooks', 'limited', 'start-of-session hooks run; others may not');
    add(components.sessionTextHooks, 'Session text', 'limited', 'is limited: only a start-of-session hook that prints `{"additionalContext": …}` at the top level adds it; Claude Code’s `hookSpecificOutput` form and prompt hooks’ output are ignored');
    add(components.mcp, 'MCP servers', 'works', 'run unchanged');
  } else if (tool === 'codex-cli') {
    add(components.skills, 'Skills', 'works', 'get the plugin’s name in front, e.g.', 'skill');
    add(components.commands, 'Commands', 'limited', 'are turned into skills when installed');
    add(components.agents, 'Agents', 'ignored', 'are ignored: copied, never offered');
    add(components.hooks, 'Hooks', 'limited', 'start-of-session hooks run after you trust them in Codex; others may not');
    add(components.sessionTextHooks, 'Session text', 'limited', 'waits for trust: these hooks can add it once you trust them in Codex (`/hooks`)');
    add(components.mcp, 'MCP servers', components.mcpRootVariable ? 'fails' : 'unknown', components.mcpRootVariable ? 'won’t start: Codex does not fill in `${CLAUDE_PLUGIN_ROOT}`' : 'may not start: not confirmed in Codex');
  }
  if (components.bin) list.push({ component: 'Top-level bin/', result: tool === 'claude-cli' ? 'works' : 'unknown', text: tool === 'claude-cli' ? 'is added to the path' : 'may not be on the path: not confirmed here' });
  return list;
}
