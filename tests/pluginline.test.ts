// Every state a tool's line can be in on a plugin's item opened in the Library, with its control (pluginline.ts lineControl): a
// switch where a click changes only this item in that tool, a button that names the act where a click does more, a sentence
// alone where nothing can be done. Both kinds of row ask it: an item only through a plugin, and a library item from the plugin
// in a tool that takes plugins. Not asked here (the library's own line, as before): a library item from the plugin in Pi,
// OpenCode or Antigravity, On, kept out, Off ("No copy while it is off."), held, or there another way (libraryrow.ts hasLine).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineControl, type LineFacts } from '../src/pluginline.ts';
import { DIRECTORY, FROM_DIRECTORY } from '../src/pluginstatus.ts';
import type { Components, HarnessId, InstalledPlugin, PartKind } from '../src/types.ts';

/** varo-risk as a tool has it installed: skills `handoff`, `review` and `notes`, MCP server `jira`, agent `lead` (none in Codex, which loads no plugin agents). */
const installed = (tool: HarnessId, more: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  tool, plugin: 'varo-risk', marketName: 'varo', version: '1.10.0', listed: true, source: 'https://example.com/varo.git',
  items: [{ kind: 'skill', name: 'handoff', description: '' }, { kind: 'skill', name: 'review', description: '' }, { kind: 'skill', name: 'notes', description: '' },
    { kind: 'mcp', name: 'jira', description: '' }, ...(tool === 'codex-cli' ? [] : [{ kind: 'agent' as const, name: 'lead', description: '' }])],
  ...more });
/** What the marketplace lists in it: 3 skills, 1 agent, 1 MCP server, hooks and a command. */
const parts: Components = { skills: 3, commands: 1, agents: 1, mcp: 1, mcpRootVariable: false, bin: false, hooks: true, hooksIn: [], startHooksIn: [], promptHooksIn: [], sessionTextHooks: [] };
/** The tool has the item through the plugin. */
const through = (tool: HarnessId, kind: PartKind, name: string, more: Partial<InstalledPlugin> = {}): LineFacts =>
  ({ tool, kind, plugin: 'varo-risk', marketName: 'varo', through: { kind, name, tool, install: installed(tool, more) }, box: { ticked: true }, parts });
/** The tool lacks the plugin: its box on the plugin's page (pluginstatus.ts boxOf) decides. */
const lacks = (tool: HarnessId, kind: PartKind, box: LineFacts['box'], more: Partial<LineFacts> = {}): LineFacts => ({ tool, kind, plugin: 'varo-risk', marketName: 'varo', box, parts, ...more });

const SWITCH = { control: 'switch', sentence: '' } as const;
const cases: [string, LineFacts, ReturnType<typeof lineControl>][] = [
  // The tool has the item through the plugin.
  ['its own switch, the plugin on there: the switch, as before', through('copilot-cli', 'skill', 'handoff'), SWITCH],
  ['its own switch can’t be written (Codex’s inline rules): the switch, drawn off with its reason, as before',
    through('codex-cli', 'skill', 'handoff', { switchesHeld: 'Codex’s config.toml writes skills.config as a value.' }),
    { control: 'switch', sentence: 'Codex’s config.toml writes skills.config as a value.' }],
  ['its own switch, the plugin off there without keptOff: Turn the plugin on as its box ticked (let-in)', { ...through('codex-cli', 'skill', 'handoff', { off: true }), box: { ticked: false } },
    { control: 'button', act: 'let-in', label: 'Turn the plugin on', sentence: 'Off, kept installed', title: 'Turns varo-risk on in Codex.' }],
  ['its own switch, the plugin off there, and it is all the plugin has: Turn the plugin on as its box ticked (let-in)', { ...through('codex-cli', 'skill', 'handoff', { off: true, items: [{ kind: 'skill', name: 'handoff', description: '' }] }), box: { ticked: false } },
    { control: 'button', act: 'let-in', label: 'Turn the plugin on', sentence: 'Off, kept installed', title: 'Turns varo-risk on in Codex.' }],
  ['the plugin kept off there by the plugins record (its box unticked): Turn the plugin on, as its box ticked, never the item’s switch', { ...through('codex-cli', 'skill', 'handoff', { off: true, keptOff: true }), box: { ticked: false } },
    { control: 'button', act: 'let-in', label: 'Turn the plugin on', sentence: 'Off, kept installed', title: 'Turns varo-risk on in Codex.' }],
  ['off there, its box held (a home that can’t be written): why, and no control', { ...through('codex-cli', 'skill', 'handoff', { off: true, keptOff: true }), box: { ticked: false, off: 'Preview only.' } },
    { control: 'none', sentence: 'Preview only.' }],
  ['off there without keptOff, its box held (Anthropic Directory): why, and no control', { ...through('claude-cli', 'skill', 'handoff', { off: true }), box: { ticked: false, off: FROM_DIRECTORY } },
    { control: 'none', sentence: FROM_DIRECTORY }],
  ['Copilot CLI’s MCP server, the plugin off there: Turn the plugin on as its box ticked (let-in)', { ...through('copilot-cli', 'mcp', 'jira', { off: true }), box: { ticked: false } },
    { control: 'button', act: 'let-in', label: 'Turn the plugin on', sentence: 'Off, kept installed', title: 'Turns varo-risk on in Copilot CLI.' }],
  ['a skill in Claude Code, which has no switch for one: Turn the plugin off (keep-out), with what goes with it, as an agent in Copilot CLI', through('claude-cli', 'skill', 'handoff'),
    { control: 'button', act: 'keep-out', label: 'Turn the plugin off', sentence: 'With 2 other skills, 1 MCP server and 1 agent', title: 'Turns the whole plugin varo-risk off in Claude Code, with its 2 other skills, 1 MCP server and 1 agent.' }],
  ['a skill in Claude Code whose installed copy has hooks too: line and hover both name the hooks',
    through('claude-cli', 'skill', 'handoff', { hooks: [{ declaredIn: 'hooks/hooks.json', event: 'SessionStart', at: 1 }] }),
    { control: 'button', act: 'keep-out', label: 'Turn the plugin off', sentence: 'With 2 other skills, 1 MCP server, 1 agent and 1 hook', title: 'Turns the whole plugin varo-risk off in Claude Code, with its 2 other skills, 1 MCP server, 1 agent and 1 hook.' }],
  ['an agent in Copilot CLI, which has no switch for one, the plugin on: Turn the plugin off (keep-out), with what goes with it', through('copilot-cli', 'agent', 'lead'),
    { control: 'button', act: 'keep-out', label: 'Turn the plugin off', sentence: 'With 3 skills and 1 MCP server', title: 'Turns the whole plugin varo-risk off in Copilot CLI, with its 3 skills and 1 MCP server.' }],
  ['an agent in Copilot CLI, the plugin off without keptOff: Turn the plugin on (let-in)', { ...through('copilot-cli', 'agent', 'lead', { off: true }), box: { ticked: false } },
    { control: 'button', act: 'let-in', label: 'Turn the plugin on', sentence: 'Off, kept installed', title: 'Turns varo-risk on in Copilot CLI.' }],
  ['an agent in Copilot CLI that is all the plugin has: the switch, naming whole scope', through('copilot-cli', 'agent', 'lead', { items: [{ kind: 'agent', name: 'lead', description: '' }] }),
    { control: 'switch', sentence: 'Whole plugin' }],
  ['an agent of a plugin Copilot CLI loads live from a folder: Turn the plugin off (keep-out), as any other copy', through('copilot-cli', 'agent', 'lead', { live: true }),
    { control: 'button', act: 'keep-out', label: 'Turn the plugin off', sentence: 'With 3 skills and 1 MCP server', title: 'Turns the whole plugin varo-risk off in Copilot CLI, with its 3 skills and 1 MCP server.' }],
  ['the same, kept off by the plugins record: Turn the plugin on, as its box ticked',
    { ...through('copilot-cli', 'agent', 'lead', { live: true, off: true, keptOff: true }), box: { ticked: false } },
    { control: 'button', act: 'let-in', label: 'Turn the plugin on', sentence: 'Off, kept installed', title: 'Turns varo-risk on in Copilot CLI.' }],
  ['the same, off in Copilot CLI’s own settings without keptOff: Turn the plugin on (let-in)', { ...through('copilot-cli', 'agent', 'lead', { live: true, off: true }), box: { ticked: false } },
    { control: 'button', act: 'let-in', label: 'Turn the plugin on', sentence: 'Off, kept installed', title: 'Turns varo-risk on in Copilot CLI.' }],

  // The tool has the plugin, but its copy lacks this item.
  ['its copy can’t be read', lacks('copilot-cli', 'agent', { ticked: true }, { installed: installed('copilot-cli', { problem: 'unreadable', items: [] }) }),
    { control: 'none', sentence: 'Copilot CLI has varo-risk installed, but its files couldn’t be read.' }],
  ['an agent in Codex, which loads no plugin’s agents', lacks('codex-cli', 'agent', { ticked: true }, { installed: installed('codex-cli') }),
    { control: 'none', sentence: 'Codex has varo-risk installed, but Codex doesn’t load a plugin’s agents.' }],
  ['its copy, another version, lacks it', lacks('claude-cli', 'agent', { ticked: true }, { installed: installed('claude-cli', { items: [] }) }),
    { control: 'none', sentence: 'Claude Code has varo-risk installed, but its copy doesn’t have this agent.' }],

  // A tool that takes plugins lacks it.
  ['its box can be ticked: Install <plugin>, with what Claude Code loads of it, as its marketplace counts it', lacks('claude-cli', 'agent', { ticked: false }),
    { control: 'button', act: 'install', label: 'Install varo-risk', sentence: 'With 3 skills, 1 agent and 1 MCP server', title: 'Installs varo-risk in Claude Code, with its 3 skills, 1 agent and 1 MCP server on.' }],
  ['Claude Code has a name of his own: it stays his, and is named', lacks('claude-cli', 'skill', { ticked: false }, { yours: [{ kind: 'skill', name: 'handoff' }] }),
    { control: 'button', act: 'install', label: 'Install varo-risk', sentence: 'With 3 skills, 1 agent and 1 MCP server. Your own handoff stays as it is.', title: 'Installs varo-risk in Claude Code, with its 3 skills, 1 agent and 1 MCP server on. Your own handoff stays as it is.' }],
  ['Codex reads its own manifest, not read here: no counts, blank line', lacks('codex-cli', 'skill', { ticked: false }),
    { control: 'button', act: 'install', label: 'Install varo-risk', sentence: '', title: 'Installs varo-risk in Codex.' }],
  ['Copilot CLI reads a skills folder its marketplace entry names in place of the plugin’s own, which the count doesn’t follow: no counts, blank line', lacks('copilot-cli', 'agent', { ticked: false }),
    { control: 'button', act: 'install', label: 'Install varo-risk', sentence: '', title: 'Installs varo-risk in Copilot CLI.' }],
  ['what it holds isn’t known (a plugin kept in another repository, not read yet): no counts, blank line', lacks('claude-cli', 'agent', { ticked: false }, { parts: undefined }),
    { control: 'button', act: 'install', label: 'Install varo-risk', sentence: '', title: 'Installs varo-risk in Claude Code.' }],
  ['an agent in Codex, which loads no plugin’s agents: installing the plugin there wouldn’t give it, so no button', lacks('codex-cli', 'agent', { ticked: false }),
    { control: 'none', sentence: 'Codex doesn’t load a plugin’s agents.' }],
  ['two marketplaces here of that name list it, and the row can’t tell which it comes from: no button, and why', lacks('copilot-cli', 'skill', 'ambiguous'),
    { control: 'none', sentence: 'Not installed in Copilot CLI. More than one marketplace here named “varo” lists varo-risk, so which one to install it from can’t be told here.' }],
  ['its box is off with why (another marketplace of that name, no command-line tool, refused, its record unread, a preview): why, and no button',
    lacks('copilot-cli', 'agent', { ticked: false, off: 'Copilot CLI has a different marketplace named “varo” (/other). Central Knot leaves it alone.' }),
    { control: 'none', sentence: 'Copilot CLI has a different marketplace named “varo” (/other). Central Knot leaves it alone.' }],
  ['the plugins’ page is still being read: what it is, and no button yet', lacks('copilot-cli', 'agent', undefined), { control: 'none', sentence: 'Not installed in Copilot CLI.' }],
  ['no marketplace here lists it: no button, and why', lacks('copilot-cli', 'agent', 'unlisted'),
    { control: 'none', sentence: 'Not installed in Copilot CLI. Its marketplace “varo” isn’t added in Central Knot or in any tool here, so it can’t be installed from here.' }],
  ['from the Anthropic Directory: no button, and why', lacks('copilot-cli', 'skill', 'unlisted', { marketName: DIRECTORY }),
    { control: 'none', sentence: 'Not installed in Copilot CLI. It comes from the Anthropic Directory, which only Claude Code installs from.' }],

  // Pi, OpenCode or Antigravity, which take no plugins, lack it (an item only through a plugin).
  ['its box can be ticked: Put its <kinds> here, Will follow <plugin>, full explanation on hover', lacks('pi-cli', 'skill', { ticked: false }),
    { control: 'button', act: 'place', label: 'Put its skills, agents and MCP servers here', sentence: 'Will follow varo-risk', title: 'Puts varo-risk’s skills, agents and MCP servers into Pi, following the plugin. Hooks and commands can’t.' }],
  ['a name Pi has of his own stays his: named after Will follow <plugin>', lacks('pi-cli', 'skill', { ticked: false }, { yours: [{ kind: 'skill', name: 'handoff' }] }),
    { control: 'button', act: 'place', label: 'Put its skills, agents and MCP servers here', sentence: 'Will follow varo-risk. Your own handoff stays as it is.', title: 'Puts varo-risk’s skills, agents and MCP servers into Pi, following the plugin. Your own handoff stays as it is. Hooks and commands can’t.' }],
  ['every name his own, as many as its marketplace lists of each kind: nothing could go in, so no button', lacks('pi-cli', 'skill', { ticked: false }, { yours: [
    { kind: 'skill', name: 'handoff' }, { kind: 'skill', name: 'review' }, { kind: 'skill', name: 'notes' }, { kind: 'agent', name: 'lead' }, { kind: 'mcp', name: 'jira' }] }),
    { control: 'none', sentence: 'Your own handoff, review, notes, lead and jira stay as they are, so none of varo-risk’s items can go into Pi.' }],
  ['a tool that holds no agents: none named on button', lacks('antigravity-cli', 'skill', { ticked: false }, { parts: { ...parts, hooks: false, commands: 0 } }),
    { control: 'button', act: 'place', label: 'Put its skills and MCP servers here', sentence: 'Will follow varo-risk', title: 'Puts varo-risk’s skills and MCP servers into Antigravity, following the plugin.' }],
  ['its other items are there and this one isn’t (placement can’t mend it): said, and no button', lacks('pi-cli', 'skill', { ticked: true }),
    { control: 'none', sentence: 'varo-risk’s other items are in Pi, following the plugin; this one isn’t.' }],
  ['its box is off with why (its parts wait to be moved, nothing it can take, names of his own, its marketplace unread): why, and no button',
    lacks('pi-cli', 'skill', { ticked: false, off: 'Parts of it from an earlier version wait to be moved to the library, so nothing changes there until they are.' }),
    { control: 'none', sentence: 'Parts of it from an earlier version wait to be moved to the library, so nothing changes there until they are.' }],
  ['the plugins’ page is still being read', lacks('pi-cli', 'skill', undefined), { control: 'none', sentence: 'Pi takes no plugins.' }],
  ['no marketplace here lists it', lacks('pi-cli', 'skill', 'unlisted'),
    { control: 'none', sentence: 'Pi takes no plugins, and its marketplace “varo” isn’t added in Central Knot or in any tool here, so its items can’t be put there.' }],
];

for (const [name, facts, expected] of cases) test(`a tool’s line: ${name}`, () => assert.deepEqual(lineControl(facts), expected));

test('no line offers the way to another page to act: no sentence says to go to the plugin’s page', () => {
  for (const [name, facts] of cases) { const said = lineControl(facts); assert.ok(!('sentence' in said) || !/plugin’s page|Plugin marketplaces|Uninstall it on/.test(said.sentence), name); }
});
