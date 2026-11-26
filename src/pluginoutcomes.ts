// What each kind of plugin component does in each tool (capability data, Appendix D, tested versions), which hook events can
// add text to sessions and what each tool takes of them (and the line a plugin's page puts over them: sessionHooksAbout), and
// the counts a plugin's contents give. Pure, so both the main process and the pages can use it.
// An outcome's text may set code in backticks (the page draws it in monospace); what a tool's line shows of it, up to its
// colon (pluginstatus.ts limitNote), holds none.
// A plugin's instruction files have no row: no tool reads them (the plugin's page says so once).
import { pluginTools } from './presence.ts';
import type { Components, DeclaredHook, HarnessId, Outcome, PluginContents } from './types.ts';
import { toolList, toolNames } from './words.ts';

const START = 'when a session starts', PROMPT = 'when you send a prompt';
/**
 * Each tool's hook events that can add text to its sessions, by the names it reads, with when each runs in words: Claude Code's
 * and Codex's start-of-session and prompt hooks; Copilot CLI's start-of-session hooks in either spelling (it ignores what a
 * prompt hook prints). Capability data, Appendix D; https://docs.github.com/en/copilot/reference/hooks-reference.
 */
const TEXT_EVENTS: Partial<Record<HarnessId, Record<string, string>>> = {
  'claude-cli': { SessionStart: START, UserPromptSubmit: PROMPT },
  'copilot-cli': { sessionStart: START, SessionStart: START },
  'codex-cli': { SessionStart: START, UserPromptSubmit: PROMPT },
};
/** Copilot CLI's prompt events: it runs such a hook and takes nothing it prints (capability data, Appendix D). */
const COPILOT_PROMPTS = ['userPromptSubmitted', 'UserPromptSubmit'];
/** When a hook runs, if it is of a kind the tool is known to run (Appendix D): one of its TEXT_EVENTS, or Copilot CLI's prompt hook. */
const knownToRun = (tool: HarnessId, hook: DeclaredHook) => TEXT_EVENTS[tool]?.[hook.event] ?? (tool === 'copilot-cli' && COPILOT_PROMPTS.includes(hook.event) ? PROMPT : undefined);
/** Whether `event` can add text to `tool`'s sessions (the one table addsText and hooksourceview.ts canRun check). */
export const isTextEvent = (tool: HarnessId, event: string) => Object.hasOwn(TEXT_EVENTS[tool] ?? {}, event);
/** Whether a hook can add text to the tool's sessions: one of its events, and a program it starts. What it adds is known only when it runs. */
export const addsText = (tool: HarnessId, hook: DeclaredHook) => !!hook.launch && isTextEvent(tool, hook.event);
/** Copilot CLI runs a prompt hook and takes nothing it prints: its note says so where such a hook has no row. */
export const ignoresText = (tool: HarnessId, hook: DeclaredHook) => tool === 'copilot-cli' && !!hook.launch && COPILOT_PROMPTS.includes(hook.event);
/** When a tool's hooks that can add text run, in words: "when a session starts or when you send a prompt". */
export const textEventsWords = (tool: HarnessId) => [...new Set(Object.values(TEXT_EVENTS[tool] ?? {}))].join(' or ');
/** A start-of-session matcher's values, as Claude Code and Codex match it against how the session started (startup first). */
const STARTS: Record<string, string> = { startup: START, resume: 'when a session resumes', clear: 'when a session is cleared', compact: 'after the conversation is compacted', fork: 'when a session is forked' };

/** First start-of-session source matching `matcher` (startup first), or undefined when none matches; shared by hookrun.ts. */
export function pickStartSource(tool: HarnessId, matcher?: string): string | undefined {
  if (tool === 'copilot-cli' || !matcher || matcher === '*') return 'startup';
  const names = Object.keys(STARTS);
  try {
    const pattern = new RegExp(matcher);
    return names.find(source => pattern.test(source));
  } catch {
    return names.find(source => source === matcher);
  }
}
/**
 * When a hook that can add text runs, as declared: its event's words, narrowed by a start-of-session hook's matcher in Claude
 * Code and Codex (in their words where each value is one of theirs, as written otherwise). A prompt hook's matcher is
 * ignored there, and Copilot CLI's start-of-session hooks take none (https://code.claude.com/docs/en/hooks, https://learn.chatgpt.com/docs/hooks).
 */
export function whenItRuns(tool: HarnessId, hook: DeclaredHook): string {
  const words = TEXT_EVENTS[tool]?.[hook.event] ?? '';
  if (words !== START || tool === 'copilot-cli' || !hook.matcher || hook.matcher === '*') return words;
  const each = hook.matcher.split('|').map(source => STARTS[source]);
  return each.every(Boolean) ? each.join(' or ') : `${START} (matcher “${hook.matcher}”)`;
}

/**
 * What a tool takes of such a hook, where it differs from Claude Code (which runs each and takes what it prints): one sentence,
 * starting with the tool's name, so it reads both after the outcome table's colon (below) and on its own on the tool's card
 * on the Instructions page (sessionhooks.ts sessionStrip). Codex runs a hook only once trusted in its /hooks, a project's trust
 * aside (https://learn.chatgpt.com/docs/hooks); Copilot CLI takes only JSON (capability data, Appendix D).
 */
export function sessionTextNote(tool: HarnessId): string | undefined {
  if (tool === 'codex-cli') return 'Codex runs a hook only after you trust it in `/hooks`';
  if (tool === 'copilot-cli') return 'Copilot CLI uses only what a start-of-session hook prints as top-level `additionalContext`, not Claude Code’s `hookSpecificOutput` form; it ignores what prompt hooks print';
  return undefined;
}

/**
 * The line under a plugin page's "Hooks that can add text to sessions" (pluginpage.ts), for `tools`, the tools its "In each tool"
 * describes: when such hooks run, Codex's wait for trust only where Codex takes text from one of them, then each tool that takes
 * text from none, as its "In each tool" row has no Session text. `sessionTextHooks`: the copy's Components.sessionTextHooks.
 */
export function sessionHooksAbout(sessionTextHooks: HarnessId[], tools: HarnessId[]): string {
  const none = tools.filter(tool => !sessionTextHooks.includes(tool));
  const trust = tools.includes('codex-cli') && !none.includes('codex-cli') ? ' (in Codex, once you trust them)' : '';
  return `These run when a session starts or you send a prompt${trust}; what they add is known only when they run.${none.length ? ` In ${toolList(none)}, none of them adds text.` : ''}`;
}

/**
 * What a plugin's read contents come to: the counts its row shows (pluginstatus.ts summaryOf), and what its outcomes need. A
 * tool's Hooks and Session text lines come from the hooks that tool would run (`hooksByTool`), never from another tool's reading.
 */
export const componentsFrom = (contents: PluginContents): Components => ({
  skills: contents.skills.length, commands: contents.commands.length, agents: contents.agents.length, hooks: contents.hooks.length > 0,
  mcp: contents.mcpServers.length, mcpRootVariable: contents.mcpUsesPluginRoot, bin: contents.bin,
  hooksIn: pluginTools.filter(tool => contents.hooksByTool[tool]?.length),
  startHooksIn: pluginTools.filter(tool => contents.hooksByTool[tool]?.some(hook => knownToRun(tool, hook) === START)),
  promptHooksIn: pluginTools.filter(tool => contents.hooksByTool[tool]?.some(hook => knownToRun(tool, hook) === PROMPT)),
  sessionTextHooks: pluginTools.filter(tool => contents.hooksByTool[tool]?.some(hook => addsText(tool, hook))),
  skillNames: contents.skills.map(skill => skill.name),
});

/** What each component does on each tool (capability data, Appendix D, tested versions). Tools without plugins get []. */
export function outcomes(tool: HarnessId, components: Components): Outcome[] {
  if (tool !== 'claude-cli' && tool !== 'copilot-cli' && tool !== 'codex-cli') return [];
  const list: Outcome[] = [];
  const add = (present: boolean | number, component: string, result: Outcome['result'], text: string, names?: Outcome['names']) => { if (present) list.push({ component, result, text, ...(names ? { names } : {}) }); };
  // Copilot CLI's and Codex's Hooks: the kinds of its hooks known to run there, then how (`how`); a plugin with neither kind is unconfirmed.
  const prompts = components.promptHooksIn.includes(tool);
  const kinds = [components.startHooksIn.includes(tool) ? 'start-of-session' : '', prompts ? 'prompt' : ''].filter(Boolean).join(' and ');
  const hooksLine = (how: string) => add(components.hooksIn.includes(tool), 'Hooks', kinds ? 'limited' : 'unknown',
    kinds ? `${kinds} hooks run${how}; others may not` : `may not run: not confirmed in ${toolNames[tool]}`);
  if (tool === 'claude-cli') {
    add(components.skills, 'Skills', 'works', 'keep their names');
    add(components.commands, 'Commands', 'works', 'work as they are');
    add(components.agents, 'Agents', 'works', 'work as they are');
    add(components.hooksIn.includes(tool), 'Hooks', 'works', 'run; a hook that fails does not stop the install');
    add(components.sessionTextHooks.includes(tool), 'Session text', 'works', 'comes from start-of-session and prompt hooks');
    add(components.mcp, 'MCP servers', 'works', 'run unchanged');
  } else if (tool === 'copilot-cli') {
    add(components.skills, 'Skills', 'works', 'keep their names');
    add(components.commands, 'Commands', 'limited', 'become skills');
    add(components.agents, 'Agents', 'works', 'get the plugin’s name in front, e.g.', 'agent');
    hooksLine(prompts ? ', but what a prompt hook prints is not used' : '');
    add(components.sessionTextHooks.includes(tool), 'Session text', 'limited', `is limited: ${sessionTextNote(tool)}`);
    add(components.mcp, 'MCP servers', 'works', 'run unchanged');
  } else if (tool === 'codex-cli') {
    add(components.skills, 'Skills', 'works', 'get the plugin’s name in front, e.g.', 'skill');
    add(components.commands, 'Commands', 'limited', 'are turned into skills when installed');
    add(components.agents, 'Agents', 'ignored', 'are ignored: copied, never offered');
    hooksLine(' after you trust them in Codex');
    add(components.sessionTextHooks.includes(tool), 'Session text', 'limited', `waits for trust: ${sessionTextNote(tool)}`);
    add(components.mcp, 'MCP servers', components.mcpRootVariable ? 'fails' : 'unknown', components.mcpRootVariable ? 'won’t start: Codex does not fill in `${CLAUDE_PLUGIN_ROOT}`' : 'may not start: not confirmed in Codex');
  }
  if (components.bin) list.push({ component: 'Top-level bin/', result: tool === 'claude-cli' ? 'works' : 'unknown', text: tool === 'claude-cli' ? 'is added to the path' : 'may not be on the path: not confirmed here' });
  return list;
}
