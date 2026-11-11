import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batches, resultLines, strayHolds, type PluginDone, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
import { LIVE_PLUGIN, cantSwitch, click, clickWords, pendingWords, prune, standing, wholeWords, type PluginItemAt } from '../src/pluginswitch.ts';
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
  assert.equal(clickWords(draft, item(codex, 'skill', 'one')), 'Turned off in Codex on Apply all. Click to leave it on.');
  assert.equal(pendingWords(draft, item(codex, 'mcp', 'issues')), 'Apply all turns it off.');
  click(draft, item(codex, 'skill', 'one'));
  click(draft, item(codex, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off mcp issues']);
});

test('an item that is off with its own switch comes back on with it', () => {
  const draft: PluginDraft = new Map();
  const copilot = installed('copilot-cli', { skillsOff: ['one'], serversOff: ['wiki'] });
  assert.deepEqual([standing(draft, item(copilot, 'skill', 'one')).now, standing(draft, item(copilot, 'mcp', 'wiki')).now, standing(draft, item(copilot, 'mcp', 'issues')).now], [false, false, true]);
  assert.equal(clickWords(draft, item(copilot, 'mcp', 'wiki')), 'Click to turn it on in Copilot CLI on Apply all. Copilot CLI goes by the name, so any other server named “wiki” there goes on too.');
  assert.equal(clickWords(draft, item(copilot, 'skill', 'one')), 'Click to turn it on in Copilot CLI on Apply all.');
  assert.equal(clickWords(draft, item(copilot, 'mcp', 'issues')), 'Click to turn it off in Copilot CLI on Apply all. Copilot CLI goes by the name, so any other server named “issues” there goes off too.');
  click(draft, item(copilot, 'skill', 'one'));
  click(draft, item(copilot, 'mcp', 'wiki'));
  assert.deepEqual(chosen(draft), ['copilot-cli skill-on one', 'copilot-cli part-on mcp wiki']);
});

test('turning on one item of a plugin that is off as a whole turns the plugin on with its other switchable items off, and off again puts it all back', () => {
  const draft: PluginDraft = new Map();
  const codex = installed('codex-cli', { off: true, skillsOff: ['two'] });
  const one = item(codex, 'skill', 'one');
  assert.equal(clickWords(draft, one), 'Click to turn the plugin full on in Codex on Apply all with only this skill on.');
  click(draft, one);
  // `two` is off already; the servers are held off, then the plugin comes on.
  assert.deepEqual(chosen(draft), ['codex-cli part-off mcp issues', 'codex-cli part-off mcp wiki', 'codex-cli plugin-on']);
  assert.deepEqual([standing(draft, one).on, standing(draft, item(codex, 'skill', 'two')).on, standing(draft, item(codex, 'mcp', 'issues')).on], [true, false, false]);
  assert.equal(pendingWords(draft, one), 'Apply all turns it on: the plugin full comes on with its other items left off.');
  // A second item turned on beside it only drops its own hold.
  click(draft, item(codex, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['codex-cli part-off mcp wiki', 'codex-cli plugin-on']);
  click(draft, item(codex, 'mcp', 'issues'));
  click(draft, one);
  assert.deepEqual(chosen(draft), [], 'everything off again: the plugin stays off, as it was');

  // Claude Code has no switch for one skill, so its skills come on with the plugin, and the words say so.
  const claude = installed('claude-cli', { off: true });
  assert.equal(clickWords(draft, item(claude, 'mcp', 'issues')), 'Click to turn the plugin full on in Claude Code on Apply all with only this MCP server on; its 2 skills come on too.');
  click(draft, item(claude, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off mcp wiki', 'claude-cli part-off agent helper', 'claude-cli plugin-on']);
  assert.deepEqual(wholeWords(draft), ['the plugin full on in Claude Code with 2 items left off'], 'a plugin that comes on for one item says what it leaves off');
  assert.equal(clickWords(new Map(), item(claude, 'skill', 'one')), 'Click to turn the whole plugin full on in Claude Code on Apply all, with its 1 skill, 2 MCP servers and 1 agent.');
  // An item its own switch keeps off doesn't come on with the plugin, so it isn't counted.
  assert.equal(clickWords(new Map(), item(installed('claude-cli', { off: true, serversOff: ['wiki'], agentsOff: ['helper'] }), 'skill', 'one')), 'Click to turn the whole plugin full on in Claude Code on Apply all, with its 1 skill and 1 MCP server.');
  // An item whose own switch can't be written is never held off (its switch would fail, and it would come on unsaid): it
  // is said as coming on with the plugin instead.
  const inlineSkills = installed('codex-cli', { off: true, switchesHeld: 'Inline.' });
  const held: PluginDraft = new Map();
  assert.equal(clickWords(held, item(inlineSkills, 'mcp', 'issues')), 'Click to turn the plugin full on in Codex on Apply all with only this MCP server on; its 2 skills come on too.');
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
  assert.equal(clickWords(draft, skill), 'Claude Code has no switch for one skill of a plugin. Click to turn the whole plugin full off in Claude Code on Apply all, with its 1 skill, 2 MCP servers and 1 agent.');
  click(draft, skill);
  assert.deepEqual(chosen(draft), ['claude-cli plugin-off']);
  assert.equal(pendingWords(draft, skill), 'Apply all turns it off, with the whole plugin (4 other items).');
  assert.deepEqual(wholeWords(draft), ['the whole plugin full off in Claude Code'], 'the change bar names the plugin that goes');
  // What its own switch already keeps off doesn't go off with the plugin, so it isn't counted.
  const partly = item(installed('claude-cli', { serversOff: ['issues', 'wiki'] }), 'skill', 'one');
  assert.equal(clickWords(new Map(), partly), 'Claude Code has no switch for one skill of a plugin. Click to turn the whole plugin full off in Claude Code on Apply all, with its 1 skill and 1 agent.');
  const going: PluginDraft = new Map();
  click(going, partly);
  assert.equal(pendingWords(going, partly), 'Apply all turns it off, with the whole plugin (2 other items).');
  // Every item of the plugin there shows the same change.
  assert.deepEqual(standing(draft, item(claude, 'mcp', 'issues')), { now: true, on: false });
  click(draft, item(claude, 'agent', 'helper'));
  assert.deepEqual(chosen(draft), [], 'a click on another of its items takes the whole plugin’s choice back, and holds nothing off');
  // An agent has its own switch in Claude Code, and none in Copilot CLI, where it goes with the whole plugin.
  click(draft, item(claude, 'agent', 'helper'));
  click(draft, item(installed('copilot-cli'), 'agent', 'helper'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off agent helper', 'copilot-cli plugin-off']);
  assert.equal(clickWords(new Map(), item(installed('copilot-cli'), 'agent', 'helper')), 'Copilot CLI has no switch for one agent of a plugin. Click to turn the whole plugin full off in Copilot CLI on Apply all, with its 2 skills and 2 MCP servers.');
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

test('choices that mean nothing after a read are dropped: already so, or the plugin is gone from that tool', () => {
  const draft: PluginDraft = new Map();
  const op = (more: Partial<PluginOp>): PluginOp => ({ source: '/m', marketName: 'team', plugin: 'full', tool: 'codex-cli', action: 'skill-off', ...more });
  const keys = ['a', 'b', 'c', 'd', 'e'];
  [op({ skill: 'one' }), op({ part: { kind: 'mcp', name: 'issues' }, action: 'part-off' }), op({ part: { kind: 'mcp', name: 'wiki' }, action: 'part-off' }), op({ action: 'plugin-off' }), op({ tool: 'copilot-cli', skill: 'one' })].forEach((entry, index) => draft.set(keys[index]!, entry));
  // Codex now has `one` and `issues` off; Copilot CLI no longer has the plugin.
  prune(draft, [installed('codex-cli', { skillsOff: ['one'], serversOff: ['issues'] })]);
  assert.deepEqual([...draft.keys()], ['c', 'd']);
  // A plugin chosen to come on for one item, then turned on outside the app: the items held off for it go with the choice.
  const alone: PluginDraft = new Map();
  click(alone, item(installed('codex-cli', { off: true }), 'skill', 'one'));
  assert.equal(alone.size, 4);
  prune(alone, [installed('codex-cli')]);
  assert.equal(alone.size, 0);
});

test('a plugin that came on for one item says so in one line, with what was left off', () => {
  const ran = (more: Partial<PluginOp>, outcome: PluginDone['report']['outcome'], changed = true): PluginDone => ({ source: '/m', marketName: 'team', plugin: 'full', tool: 'codex-cli', action: 'plugin-on', ...more, report: { tool: more.tool ?? 'codex-cli', outcome, message: '', runs: [], changed } });
  const done = [ran({ skill: 'two', action: 'skill-off' }, 'skill-off'), ran({ part: { kind: 'mcp', name: 'wiki' }, action: 'part-off' }, 'part-off'), ran({}, 'plugin-on'), ran({ tool: 'claude-cli' }, 'plugin-on')];
  assert.deepEqual(resultLines(done).map(line => line.text), ['turned on in Claude Code; turned on in Codex with two and MCP server wiki left off']);
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
