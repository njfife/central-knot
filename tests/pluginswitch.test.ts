import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batches, resultLines, strayHolds, type PluginDone, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
import { LIVE_PLUGIN, alongWords, cantSwitch, click, clickWords, itemSaid, standing, switchWords, turnEvery, type PluginItemAt } from '../src/pluginswitch.ts';
import type { HarnessId, InstalledPlugin, PartKind } from '../src/types.ts';

/** The plugin `full` as a tool has it: skills `one` and `two`, MCP servers `issues` and `wiki`, agent `helper`. */
const installed = (tool: HarnessId, more: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  tool, plugin: 'full', marketName: 'team', version: '1.0.0', listed: true, source: '/m',
  items: [{ kind: 'skill', name: 'one', description: '' }, { kind: 'skill', name: 'two', description: '' }, { kind: 'mcp', name: 'issues', description: '' }, { kind: 'mcp', name: 'wiki', description: '' },
    ...(tool === 'codex-cli' ? [] : [{ kind: 'agent' as const, name: 'helper', description: '' }])],
  ...more });
const item = (install: InstalledPlugin, kind: PartKind, name: string): PluginItemAt => ({ kind, name, tool: install.tool, install });
/** What the draft holds, as "tool action item", in the order Apply all runs it. */
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

test('a main switch turns one item in every tool with a switch for it, and never a whole plugin', () => {
  const claude = installed('claude-cli'), codex = installed('codex-cli'), copilot = installed('copilot-cli', { skillsOff: ['one'] });
  const off = turnEvery([item(claude, 'skill', 'one'), item(codex, 'skill', 'one'), item(copilot, 'skill', 'one')], false);
  // Claude Code has no switch for one skill of a plugin: it is left on and said; Copilot CLI has it off already.
  assert.deepEqual(chosen(off.draft), ['codex-cli skill-off one']);
  assert.deepEqual([off.leftIn, off.whole.map(entry => entry.tool), off.turned.map(entry => entry.tool)], [['claude-cli'], ['claude-cli'], ['codex-cli']]);
  assert.deepEqual([off.limit, off.left], ['Still on in Claude Code: it has no switch for one skill of a plugin, only one for the whole plugin, full.', undefined]);
  // On again: where the whole plugin is off, it comes on for this item alone, its other switchable items held off.
  const codexOff = installed('codex-cli', { off: true });
  const on = turnEvery([item(codexOff, 'mcp', 'issues'), item(copilot, 'skill', 'one')], true);
  assert.deepEqual(chosen(on.draft), ['codex-cli skill-off one', 'codex-cli skill-off two', 'codex-cli part-off mcp wiki', 'copilot-cli skill-on one', 'codex-cli plugin-on']);
  assert.equal(on.left, undefined);
  // Said item first, then what came with it.
  assert.equal(itemSaid(item(codexOff, 'mcp', 'issues'), true, on.ops), 'issues is on in Codex. Its plugin full was turned on there, with its skill one, skill two and MCP server wiki left off.');
  assert.equal(alongWords(item(copilot, 'skill', 'one'), on.ops), '', 'only its own switch turned');
  const whole: PluginDraft = new Map();
  click(whole, item(claude, 'skill', 'one'));
  assert.equal(itemSaid(item(claude, 'skill', 'one'), false, [...whole.values()]), 'one is off in Claude Code. Its whole plugin full was turned off there, with its 1 other skill, 2 MCP servers and 1 agent.');
  // One item beside it is named.
  const pair = installed('claude-cli', { items: [{ kind: 'skill', name: 'pdf', description: '' }, { kind: 'skill', name: 'spreadsheet', description: '' }] });
  const both: PluginDraft = new Map();
  click(both, item(pair, 'skill', 'pdf'));
  assert.equal(itemSaid(item(pair, 'skill', 'pdf'), false, [...both.values()]), 'pdf is off in Claude Code. Its whole plugin full was turned off there, with its other skill, spreadsheet.');
});

test('a main switch never falls back to the whole plugin where the item’s own switch can’t be written', () => {
  // Codex's skill rules for this plugin are written in a form not edited here: its own switch can't be used.
  const held = installed('codex-cli', { switchesHeld: 'Codex’s skills.config is written inline.' });
  const off = turnEvery([item(held, 'skill', 'one')], false);
  assert.deepEqual([chosen(off.draft), off.whole, off.limit, off.leftIn], [[], [], undefined, ['codex-cli']]);
  assert.equal(off.left, 'Still on in Codex: Codex’s skills.config is written inline.');
});
