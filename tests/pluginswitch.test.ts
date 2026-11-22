import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batches, resultLines, strayHolds, type PluginDone, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
import { LIVE_PLUGIN, alongWords, cantSwitch, click, clickWords, copilotByName, itemSaid, onNow, standing, switchWords, turnEvery, wholeWords, type PluginItemAt } from '../src/pluginswitch.ts';
import { statusLine } from '../src/libraryrow.ts';
import { newItem } from '../src/library.ts';
import { owedTo } from '../src/pluginrecord.ts';
import { toolMark } from '../src/pluginstatus.ts';
import type { HarnessId, InstalledPlugin, MarketplaceView, PartKind, PluginsView } from '../src/types.ts';

/** The plugin `full` as a tool has it: skills `one` and `two`, MCP servers `issues` and `wiki`, agent `helper`. */
const installed = (tool: HarnessId, more: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  tool, plugin: 'full', marketName: 'team', version: '1.0.0', listed: true, source: '/m',
  items: [{ kind: 'skill', name: 'one', description: '' }, { kind: 'skill', name: 'two', description: '' }, { kind: 'mcp', name: 'issues', description: '' }, { kind: 'mcp', name: 'wiki', description: '' },
    ...(tool === 'codex-cli' ? [] : [{ kind: 'agent' as const, name: 'helper', description: '' }])],
  ...more });
const item = (install: InstalledPlugin, kind: PartKind, name: string): PluginItemAt => ({ kind, name, tool: install.tool, install });
/** What the draft holds, as "tool action item", in the order a run takes it. */
const chosen = (draft: PluginDraft) => batches([...draft.values()]).map(step => `${step.tools[0]} ${step.action}${step.skill ? ` ${step.skill}` : ''}${step.part ? ` ${step.part.kind} ${step.part.name}` : ''}`);

test('a skill or an MCP server with its own switch flips that switch alone, and a second click takes the choice back', () => {
  const draft: PluginDraft = new Map();
  const codex = installed('codex-cli');
  click(draft, item(codex, 'skill', 'one'));
  click(draft, item(codex, 'mcp', 'issues'));
  click(draft, item(installed('claude-cli'), 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['codex-cli skill-off one', 'codex-cli part-off mcp issues', 'claude-cli part-off mcp issues']);
  assert.deepEqual(standing(draft, item(codex, 'skill', 'one')), { now: true, on: false });
  assert.deepEqual(standing(draft, item(codex, 'skill', 'two')), { now: true, on: true }, 'its other skill is untouched');
  click(draft, item(codex, 'skill', 'one'));
  click(draft, item(codex, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off mcp issues']);
});

test('an item that is off with its own switch comes back on with it', () => {
  const draft: PluginDraft = new Map();
  const copilot = installed('copilot-cli', { skillsOff: ['one'], serversOff: ['wiki'] });
  assert.deepEqual([standing(draft, item(copilot, 'skill', 'one')).now, standing(draft, item(copilot, 'mcp', 'wiki')).now, standing(draft, item(copilot, 'mcp', 'issues')).now], [false, false, true]);
  assert.equal(clickWords(item(copilot, 'mcp', 'wiki')), 'Click to turn it on in Copilot CLI. Copilot CLI goes by the name, so any other server named “wiki” there goes on too.');
  assert.equal(clickWords(item(copilot, 'skill', 'one')), 'Click to turn it on in Copilot CLI.');
  assert.equal(clickWords(item(copilot, 'mcp', 'issues')), 'Click to turn it off in Copilot CLI. Copilot CLI goes by the name, so any other server named “issues” there goes off too.');
  // The same sentence builder serves the row's result when a server of his own shares the name in Copilot CLI.
  assert.equal(copilotByName('issues', false), 'Copilot CLI goes by the name, so any other server named “issues” there goes off too.');
  assert.equal(copilotByName('issues', false, true), 'Copilot CLI goes by the name, so your own “issues” there goes off too.');
  assert.equal(copilotByName('issues', true, true), 'Copilot CLI goes by the name, so your own “issues” there goes on too (while both are on, Copilot CLI runs the plugin’s).');
  click(draft, item(copilot, 'skill', 'one'));
  click(draft, item(copilot, 'mcp', 'wiki'));
  assert.deepEqual(chosen(draft), ['copilot-cli skill-on one', 'copilot-cli part-on mcp wiki']);
});

test('turning on one item of a plugin that is off as a whole turns the plugin on with its other switchable items off, and off again puts it all back', () => {
  const draft: PluginDraft = new Map();
  const codex = installed('codex-cli', { off: true, skillsOff: ['two'] });
  const one = item(codex, 'skill', 'one');
  assert.equal(clickWords(one), 'Click to turn the plugin full on in Codex with only this skill on.');
  click(draft, one);
  // `two` is off already; the servers are held off, then the plugin comes on.
  assert.deepEqual(chosen(draft), ['codex-cli part-off mcp issues', 'codex-cli part-off mcp wiki', 'codex-cli plugin-on']);
  assert.deepEqual([standing(draft, one).on, standing(draft, item(codex, 'skill', 'two')).on, standing(draft, item(codex, 'mcp', 'issues')).on], [true, false, false]);
  // A second item turned on beside it only drops its own hold.
  click(draft, item(codex, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['codex-cli part-off mcp wiki', 'codex-cli plugin-on']);
  click(draft, item(codex, 'mcp', 'issues'));
  click(draft, one);
  assert.deepEqual(chosen(draft), [], 'everything off again: the plugin stays off, as it was');

  // Claude Code has no switch for one skill, so its skills come on with the plugin, and the words say so.
  const claude = installed('claude-cli', { off: true });
  assert.equal(clickWords(item(claude, 'mcp', 'issues')), 'Click to turn the plugin full on in Claude Code with only this MCP server on; its 2 skills come on too.');
  click(draft, item(claude, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off mcp wiki', 'claude-cli part-off agent helper', 'claude-cli plugin-on']);
  // A skill, which comes on with the plugin, says how much of the plugin comes on with it.
  // A second click on the same box takes it back: the plugin was to come on only for that server, so nothing stays chosen.
  click(draft, item(claude, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), [], 'two clicks on one box leave no change');
  click(draft, item(claude, 'mcp', 'issues'));
  // The same in Codex where one server's switch can't be written: a skill clicked twice leaves nothing chosen.
  const stuck = installed('codex-cli', { off: true, serversHeld: { wiki: 'A form not edited.' } });
  const twice: PluginDraft = new Map();
  click(twice, item(stuck, 'skill', 'one'));
  assert.deepEqual(chosen(twice), ['codex-cli skill-off two', 'codex-cli part-off mcp issues', 'codex-cli plugin-on']);
  click(twice, item(stuck, 'skill', 'one'));
  assert.deepEqual(chosen(twice), []);
  // The plugin chosen to come on whole by a skill's box, then one server kept off: both stay chosen.
  const whole: PluginDraft = new Map();
  click(whole, item(claude, 'skill', 'one'));
  click(whole, item(claude, 'mcp', 'issues'));
  // After the skill's click alone, a server's line names everything that comes on with the plugin, not only its skills.
  const afterSkill: PluginDraft = new Map();
  click(afterSkill, item(claude, 'skill', 'one'));
  assert.deepEqual(chosen(whole), ['claude-cli part-off mcp issues', 'claude-cli plugin-on']);
  // Even with every server and the agent kept off, the plugin still comes on, for its skills: that is what was clicked.
  click(whole, item(claude, 'mcp', 'wiki'));
  click(whole, item(claude, 'agent', 'helper'));
  assert.equal(chosen(whole).at(-1), 'claude-cli plugin-on');
  // And a second click on a kept-off server puts just that server back.
  click(whole, item(claude, 'mcp', 'wiki'));
  assert.deepEqual(chosen(whole), ['claude-cli part-off mcp issues', 'claude-cli part-off agent helper', 'claude-cli plugin-on']);
  assert.equal(clickWords(item(claude, 'skill', 'one')), 'Click to turn the whole plugin full on in Claude Code, with its 1 skill, 2 MCP servers and 1 agent.');
  // An item its own switch keeps off doesn't come on with the plugin, so it isn't counted.
  assert.equal(clickWords(item(installed('claude-cli', { off: true, serversOff: ['wiki'], agentsOff: ['helper'] }), 'skill', 'one')), 'Click to turn the whole plugin full on in Claude Code, with its 1 skill and 1 MCP server.');
  // An item whose own switch can't be written is never held off (its switch would fail, and it would come on unsaid): it
  // is said as coming on with the plugin instead.
  const inlineSkills = installed('codex-cli', { off: true, switchesHeld: 'Inline.' });
  const held: PluginDraft = new Map();
  assert.equal(clickWords(item(inlineSkills, 'mcp', 'issues')), 'Click to turn the plugin full on in Codex with only this MCP server on; its 2 skills come on too.');
  click(held, item(inlineSkills, 'mcp', 'issues'));
  assert.deepEqual(chosen(held), ['codex-cli part-off mcp wiki', 'codex-cli plugin-on']);
  // Held-off items never stay chosen unseen: the plugin taken back to off takes its holds with it.
  const unseen: PluginDraft = new Map();
  click(unseen, item(claude, 'mcp', 'issues'));
  click(unseen, item(claude, 'skill', 'one'));
  assert.deepEqual(chosen(unseen), [], 'a skill’s click turns the whole plugin back off, and nothing is left chosen');
});

test('an item with no switch of its own flips the whole plugin, and its words name what goes with it', () => {
  const draft: PluginDraft = new Map();
  const claude = installed('claude-cli');
  const skill = item(claude, 'skill', 'one');
  assert.equal(clickWords(skill), 'Claude Code has no switch for one skill of a plugin. Click to turn the whole plugin full off in Claude Code, with its 1 skill, 2 MCP servers and 1 agent.');
  // The line beside its switch in the opened row says the same before any click; an item with its own switch says nothing.
  assert.equal(switchWords(skill), 'Claude Code has no switch for one skill of a plugin, so this switch turns the whole plugin off there.');
  assert.equal(switchWords(item(claude, 'mcp', 'issues')), '');
  click(draft, skill);
  assert.deepEqual(chosen(draft), ['claude-cli plugin-off']);
  // What its own switch already keeps off doesn't go off with the plugin, so it isn't counted.
  const partly = item(installed('claude-cli', { serversOff: ['issues', 'wiki'] }), 'skill', 'one');
  assert.equal(clickWords(partly), 'Claude Code has no switch for one skill of a plugin. Click to turn the whole plugin full off in Claude Code, with its 1 skill and 1 agent.');
  const going: PluginDraft = new Map();
  click(going, partly);
  // Every item of the plugin there shows the same change.
  assert.deepEqual(standing(draft, item(claude, 'mcp', 'issues')), { now: true, on: false });
  click(draft, item(claude, 'agent', 'helper'));
  assert.deepEqual(chosen(draft), [], 'a click on another of its items takes the whole plugin’s choice back, and holds nothing off');
  // With the whole plugin chosen to go off, no item's own choice stays behind unseen, and an item already off by its own
  // switch says what a click on it does: the plugin stays on, and it comes on.
  const mixed = installed('claude-cli', { serversOff: ['wiki'] });
  const off: PluginDraft = new Map();
  click(off, item(mixed, 'mcp', 'issues'));
  click(off, item(mixed, 'skill', 'one'));
  assert.deepEqual(chosen(off), ['claude-cli plugin-off'], 'the server’s own choice goes with the plugin’s');
  click(off, item(mixed, 'mcp', 'wiki'));
  assert.deepEqual(chosen(off), ['claude-cli part-on mcp wiki']);
  // An agent has its own switch in Claude Code, and none in Copilot CLI, where it goes with the whole plugin.
  click(draft, item(claude, 'agent', 'helper'));
  click(draft, item(installed('copilot-cli'), 'agent', 'helper'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off agent helper', 'copilot-cli plugin-off']);
  assert.equal(clickWords(item(installed('copilot-cli'), 'agent', 'helper')), 'Copilot CLI has no switch for one agent of a plugin. Click to turn the whole plugin full off in Copilot CLI, with its 2 skills and 2 MCP servers.');
});

test('an item says why it can’t be switched: skill rules in a form not edited, a skill held off by a bare name; a plugin whose marketplace is listed nowhere is switched all the same', () => {
  const unlisted = installed('codex-cli', { source: undefined, listed: false });
  assert.equal(cantSwitch(item(unlisted, 'mcp', 'issues')), undefined);
  const draft: PluginDraft = new Map();
  click(draft, item(unlisted, 'mcp', 'issues'));
  assert.deepEqual([...draft.values()].map(op => [op.source, op.action]), [['', 'part-off']]);
  assert.equal(cantSwitch(item(installed('codex-cli', { switchesHeld: 'Inline.' }), 'skill', 'one')), 'Inline.');
  assert.equal(cantSwitch(item(installed('codex-cli', { switchesHeld: 'Inline.' }), 'mcp', 'issues')), undefined, 'a server’s switch is another table');
  assert.equal(cantSwitch(item(installed('copilot-cli', { skillsOff: ['one'], skillsHeld: { one: 'Every skill named one is off.' } }), 'skill', 'one')), 'Every skill named one is off.');
  assert.equal(cantSwitch(item(installed('claude-cli'), 'skill', 'one')), undefined);
  // Codex's servers written as a value are read and never edited: said before the click, for that server alone.
  const inline = installed('codex-cli', { serversHeld: { issues: 'A form not edited.' } });
  assert.deepEqual([cantSwitch(item(inline, 'mcp', 'issues')), cantSwitch(item(inline, 'mcp', 'wiki'))], ['A form not edited.', undefined]);
  // Copilot CLI's live folder plugin: off there is uninstalled, so the whole-plugin switch (an agent's box) isn't offered; its own switches are.
  const live = installed('copilot-cli', { live: true });
  assert.deepEqual([cantSwitch(item(live, 'agent', 'helper')), cantSwitch(item(live, 'skill', 'one')), cantSwitch(item(live, 'mcp', 'issues'))], [LIVE_PLUGIN, undefined, undefined]);
});

test('a plugin that came on for one item says so in one line, with what was left off', () => {
  const ran = (more: Partial<PluginOp>, outcome: PluginDone['report']['outcome'], changed = true): PluginDone => ({ source: '/m', marketName: 'team', plugin: 'full', tool: 'codex-cli', action: 'plugin-on', ...more, report: { tool: more.tool ?? 'codex-cli', outcome, message: '', runs: [], changed } });
  const done = [ran({ skill: 'two', action: 'skill-off' }, 'skill-off'), ran({ part: { kind: 'mcp', name: 'wiki' }, action: 'part-off' }, 'part-off'), ran({}, 'plugin-on'), ran({ tool: 'claude-cli' }, 'plugin-on')];
  assert.deepEqual(resultLines(done).map(line => line.text), ['turned on in Claude Code; turned on in Codex with two and MCP server wiki left off']);
  // Past three items left off, they are counted.
  const many = [...['a', 'b', 'c', 'd'].map(skill => ran({ skill, action: 'skill-off' }, 'skill-off')), ran({}, 'plugin-on')];
  assert.deepEqual(resultLines(many).map(line => line.text), ['turned on in Codex with 4 items left off']);
  // On its own, each switch is its own line; an Undo says each thing that came back.
  assert.deepEqual(resultLines(done.slice(0, 2)).map(line => line.text), ['two turned off in Codex', 'MCP server wiki turned off in Codex']);
  // Its Undo, as it runs: the plugin off again, then each held item's switch back. One line: the plugin is off again.
  const undone = [ran({ action: 'plugin-off' }, 'plugin-off'), ran({ part: { kind: 'mcp', name: 'wiki' }, action: 'part-on' }, 'part-on'), ran({ skill: 'two', action: 'skill-on' }, 'skill-on')];
  assert.deepEqual(resultLines(undone, true).map(line => line.text), ['off again in Codex']);
});

test('a plugin that failed to come on names the item switches written for it, to be put back', () => {
  const ran = (more: Partial<PluginOp>, outcome: PluginDone['report']['outcome'], changed = true): PluginDone => ({ source: '/m', marketName: 'team', plugin: 'full', tool: 'codex-cli', action: 'plugin-on', ...more, report: { tool: more.tool ?? 'codex-cli', outcome, message: '', runs: [], changed } });
  const held = ran({ part: { kind: 'mcp', name: 'wiki' }, action: 'part-off' }, 'part-off');
  const asked = ran({ tool: 'claude-cli', skill: 'two', action: 'skill-off' }, 'skill-off');
  assert.deepEqual(strayHolds([held, asked, ran({}, 'failed', false)]), [held], 'only the failed plugin’s own, in that tool');
  assert.deepEqual(strayHolds([held, ran({}, 'plugin-on')]), []);
});

/** The plugin as its tool reads it once `ops` ran there: a stand-in for each tool's own switches. */
const ranIn = (install: InstalledPlugin, ops: PluginOp[]): InstalledPlugin => ops.filter(op => op.tool === install.tool).reduce((now, op) => {
  const off = op.action.endsWith('-off'), set = (list: string[] = [], name: string) => (off ? [...list, name] : list.filter(other => other !== name));
  if (op.skill) return { ...now, skillsOff: set(now.skillsOff, op.skill) };
  if (op.part) return op.part.kind === 'mcp' ? { ...now, serversOff: set(now.serversOff, op.part.name) } : { ...now, agentsOff: set(now.agentsOff, op.part.name) };
  return { ...now, off: off || undefined };
}, install);
/** Every item of the plugin in each tool, on or off there: what both pages read. */
const everyItem = (installs: InstalledPlugin[]) => installs.flatMap(install => install.items.map(entry => `${install.tool} ${entry.name} ${onNow(item(install, entry.kind, entry.name)) ? 'on' : 'off'}`));
/** A row's main switch clicked toward `on` for the item `name` of every tool's plugin; the tools as they read it after. */
const mainSwitch = (installs: InstalledPlugin[], name: string, on: boolean) => {
  const turn = turnEvery(installs.map(install => item(install, 'skill', name)), on);
  return { turn, after: installs.map(install => ranIn(install, turn.ops)) };
};
/** The Plugins page's line for a tool that has the plugin `full` installed whole, the plugin On in plugins.json (pluginstatus.ts toolMark). */
const pluginsPageSays = (install: InstalledPlugin) => {
  const entry: MarketplaceView = { source: '/m', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: '/m', plugins: [{ name: 'full', description: '' }],
    states: { full: { [install.tool]: { state: 'installed', path: '/x', version: '1.0.0', ...(install.off ? { off: true } : {}) } } },
    switches: { full: { entry: { on: true, except: [] }, tools: {} } } };
  const view: PluginsView = { home: '/h', tools: [install.tool], clis: { [install.tool]: true }, canWrite: true, marketplaces: [entry] };
  return toolMark(view, entry, 'full', install.tool, owedTo({ on: true, except: [] }, install.tool, { has: 'whole', route: 'whole' }, [install.tool])).words;
};
/** What the Library says of a library item that is Off (Pi and OpenCode hold the plugin's items as the library's), given where a plugin still has it on. */
const offRowSays = (name: string, pluginOn: HarnessId[]) => statusLine({ key: name, name, pluginOn }, { ...newItem(name, name), on: false }, ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']);

test('a main switch turns a plugin’s skill off in every tool that has it, the whole plugin in Claude Code, which has no switch for one skill; On again turns it all back', () => {
  // In all five tools: Claude Code, Copilot CLI and Codex have the plugin installed; Pi and OpenCode hold its skills as library
  // items linked to it, which the same click turns Off as any item (rowClicks.off), so they are not this table's.
  const installs = [installed('claude-cli'), installed('copilot-cli'), installed('codex-cli')];
  const items = installs.map(install => item(install, 'skill', 'one'));
  // Said on the switch before the click: where the whole plugin turns, and that it is everything the plugin brings there.
  assert.equal(wholeWords(items, false), 'In Claude Code, which has no switch for one skill of a plugin, it turns off everything full brings there.');
  const { turn: off, after } = mainSwitch(installs, 'one', false);
  assert.deepEqual(chosen(off.draft), ['copilot-cli skill-off one', 'codex-cli skill-off one', 'claude-cli plugin-off']);
  assert.deepEqual([off.left, off.leftIn], [undefined, []], 'no tool is left with it on');
  // The result names what went with it in Claude Code (matrix.ts mainClick).
  assert.deepEqual(off.turned.map(entry => alongWords(entry, off.ops)).filter(Boolean), ['Its whole plugin full was turned off in Claude Code, with its 1 other skill, 2 MCP servers and 1 agent.']);
  assert.deepEqual(everyItem(after).filter(line => line.endsWith(' on')), ['copilot-cli two on', 'copilot-cli issues on', 'copilot-cli wiki on', 'copilot-cli helper on', 'codex-cli two on', 'codex-cli issues on', 'codex-cli wiki on']);
  // On again, said first; one click puts every tool back.
  assert.equal(wholeWords(after.map(install => item(install, 'skill', 'one')), true), 'In Claude Code, which has no switch for one skill of a plugin, it turns the whole plugin full on there.');
  const { turn: on, after: back } = mainSwitch(after, 'one', true);
  assert.deepEqual(chosen(on.draft), ['copilot-cli skill-on one', 'codex-cli skill-on one', 'claude-cli plugin-on']);
  assert.deepEqual(everyItem(back), everyItem(installs));
});

test('a main switch’s result says the item first, then what came with it: a plugin turned on for it, with what was left off; one other item by name', () => {
  const codexOff = installed('codex-cli', { off: true }), copilot = installed('copilot-cli', { skillsOff: ['one'] });
  const on = turnEvery([item(codexOff, 'mcp', 'issues'), item(copilot, 'skill', 'one')], true);
  assert.deepEqual(chosen(on.draft), ['codex-cli skill-off one', 'codex-cli skill-off two', 'codex-cli part-off mcp wiki', 'copilot-cli skill-on one', 'codex-cli plugin-on']);
  assert.equal(itemSaid(item(codexOff, 'mcp', 'issues'), true, on.ops), 'issues is on in Codex. Its plugin full was turned on there, with its skill one, skill two and MCP server wiki left off.');
  assert.equal(alongWords(item(copilot, 'skill', 'one'), on.ops), '', 'only its own switch turned');
  const pair = installed('claude-cli', { items: [{ kind: 'skill', name: 'pdf', description: '' }, { kind: 'skill', name: 'spreadsheet', description: '' }] });
  const both = turnEvery([item(pair, 'skill', 'pdf')], false);
  assert.equal(itemSaid(item(pair, 'skill', 'pdf'), false, both.ops), 'pdf is off in Claude Code. Its whole plugin full was turned off there, with its other skill, spreadsheet.');
});

test('a main switch turns an agent off in Copilot CLI with its whole plugin, and in Claude Code with the agent’s own switch', () => {
  const agents = [item(installed('claude-cli'), 'agent', 'helper'), item(installed('copilot-cli'), 'agent', 'helper')];
  assert.equal(wholeWords(agents, false), 'In Copilot CLI, which has no switch for one agent of a plugin, it turns off everything full brings there.');
  const off = turnEvery(agents, false);
  assert.deepEqual(chosen(off.draft), ['claude-cli part-off agent helper', 'copilot-cli plugin-off']);
  assert.deepEqual(off.turned.map(entry => alongWords(entry, off.ops)).filter(Boolean), ['Its whole plugin full was turned off in Copilot CLI, with its 2 skills and 2 MCP servers.']);
});

test('the row turned Off: plugins.json still has the plugin On, and Claude Code has it off in its own settings, which both pages say', () => {
  const { after } = mainSwitch([installed('claude-cli'), installed('copilot-cli'), installed('codex-cli')], 'one', false);
  const [claude] = after;
  assert.equal(pluginsPageSays(claude), 'Claude Code: installed 1.0.0, turned off in Claude Code’s own settings.');
  // On Skills, the library row (Pi, OpenCode) is Off with no tool left on: in Central Knot only.
  assert.deepEqual(after.map(install => item(install, 'skill', 'one')).filter(onNow), []);
  assert.equal(offRowSays('one', []), 'Off · in Central Knot only. Turn it on to put it in every tool.');
});

test('the row turned On again turns back on exactly what was on: what a tool’s own switch had off before stays off', () => {
  // Claude Code had the server wiki off by its own switch, Copilot CLI the skill two.
  const before = [installed('claude-cli', { serversOff: ['wiki'] }), installed('copilot-cli', { skillsOff: ['two'] }), installed('codex-cli')];
  const { after } = mainSwitch(before, 'one', false);
  const { after: back } = mainSwitch(after, 'one', true);
  assert.deepEqual(everyItem(back), everyItem(before));
  assert.equal(pluginsPageSays(back[0]), 'Claude Code: installed 1.0.0.');
});

test('skill one Off, skill two Off, one On: the plugin is on again in Claude Code, so two is on there alone, and its row says so', () => {
  let installs = [installed('claude-cli'), installed('copilot-cli'), installed('codex-cli')];
  installs = mainSwitch(installs, 'one', false).after;
  const two = mainSwitch(installs, 'two', false);
  // Claude Code has two off already, with the whole plugin: only Copilot CLI and Codex turn.
  assert.deepEqual(chosen(two.turn.draft), ['copilot-cli skill-off two', 'codex-cli skill-off two']);
  installs = mainSwitch(two.after, 'one', true).after;
  const pluginOn = installs.map(install => item(install, 'skill', 'two')).filter(onNow).map(entry => entry.tool);
  assert.deepEqual(pluginOn, ['claude-cli']);
  // Its library row is Off, and says where it is still on (matrix.ts pluginOnIn); its switch turns it on everywhere else, and
  // says nothing of a whole plugin, which is on already.
  assert.equal(offRowSays('two', pluginOn), 'Off · on in Claude Code only, through its plugin. Turn it on to put it in every tool.');
  assert.equal(wholeWords(installs.map(install => item(install, 'skill', 'two')), true), '');
  assert.equal(pluginsPageSays(installs[0]), 'Claude Code: installed 1.0.0.');
});

test('a main switch never falls back to the whole plugin where the item’s own switch can’t be written, nor where off is uninstalled', () => {
  // Codex's skill rules for this plugin are written in a form not edited here: its own switch can't be used.
  const held = installed('codex-cli', { switchesHeld: 'Codex’s skills.config is written inline.' });
  const off = turnEvery([item(held, 'skill', 'one')], false);
  assert.deepEqual([chosen(off.draft), off.leftIn, off.left], [[], ['codex-cli'], ['Still on in Codex: Codex’s skills.config is written inline.']]);
  // Copilot CLI loads this plugin live from a folder, where turning it off is uninstalling it: its agent is left, and said.
  const live = [item(installed('copilot-cli', { live: true }), 'agent', 'helper')];
  assert.deepEqual([chosen(turnEvery(live, false).draft), turnEvery(live, false).left, wholeWords(live, false)], [[], [`Still on in Copilot CLI: ${LIVE_PLUGIN}`], '']);
  // Held in both: a reason for each tool, never joined.
  assert.deepEqual(turnEvery([item(held, 'skill', 'one'), ...live], false).left, ['Still on in Codex: Codex’s skills.config is written inline.', `Still on in Copilot CLI: ${LIVE_PLUGIN}`]);
});
