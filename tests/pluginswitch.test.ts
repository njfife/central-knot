import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batches, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
import { cantSwitch, click, clickWords, pendingWords, prune, standing, wholeWords, type PluginItemAt } from '../src/pluginswitch.ts';
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
  assert.equal(pendingWords(draft, item(codex, 'mcp', 'issues')), 'Turned off on Apply all.');
  click(draft, item(codex, 'skill', 'one'));
  click(draft, item(codex, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off mcp issues']);
});

test('an item that is off with its own switch comes back on with it', () => {
  const draft: PluginDraft = new Map();
  const copilot = installed('copilot-cli', { skillsOff: ['one'], serversOff: ['wiki'] });
  assert.deepEqual([standing(draft, item(copilot, 'skill', 'one')).now, standing(draft, item(copilot, 'mcp', 'wiki')).now, standing(draft, item(copilot, 'mcp', 'issues')).now], [false, false, true]);
  assert.equal(clickWords(draft, item(copilot, 'mcp', 'wiki')), 'Click to turn it on in Copilot CLI on Apply all.');
  click(draft, item(copilot, 'skill', 'one'));
  click(draft, item(copilot, 'mcp', 'wiki'));
  assert.deepEqual(chosen(draft), ['copilot-cli skill-on one', 'copilot-cli part-on mcp wiki']);
});

test('turning on one item of a plugin that is off as a whole turns the plugin on with its other switchable items off, and off again puts it all back', () => {
  const draft: PluginDraft = new Map();
  const codex = installed('codex-cli', { off: true, skillsOff: ['two'] });
  const one = item(codex, 'skill', 'one');
  assert.equal(clickWords(draft, one), 'The whole plugin full is off in Codex. Click to turn it on there on Apply all with only this skill on.');
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
  assert.equal(clickWords(draft, item(claude, 'mcp', 'issues')), 'The whole plugin full is off in Claude Code. Click to turn it on there on Apply all with only this MCP server on; its 2 skills come on too.');
  click(draft, item(claude, 'mcp', 'issues'));
  assert.deepEqual(chosen(draft), ['claude-cli part-off mcp wiki', 'claude-cli part-off agent helper', 'claude-cli plugin-on']);
  assert.deepEqual(wholeWords(draft), [], 'a plugin that comes on for one item is said by that item');
});

test('an item with no switch of its own flips the whole plugin, and its words name what goes with it', () => {
  const draft: PluginDraft = new Map();
  const claude = installed('claude-cli');
  const skill = item(claude, 'skill', 'one');
  assert.equal(clickWords(draft, skill), 'Claude Code has no switch for one skill of a plugin. Click to turn the whole plugin full off in Claude Code on Apply all, with its 1 skill, 2 MCP servers and 1 agent.');
  click(draft, skill);
  assert.deepEqual(chosen(draft), ['claude-cli plugin-off']);
  assert.equal(pendingWords(draft, skill), 'Turned off on Apply all, with the whole plugin (4 other items).');
  assert.deepEqual(wholeWords(draft), ['the whole plugin full off in Claude Code'], 'the change bar names the plugin that goes');
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

test('an item says why it can’t be switched: no record of the marketplace, skill rules in a form not edited, a skill held off by a bare name', () => {
  assert.match(cantSwitch(item(installed('codex-cli', { source: undefined }), 'mcp', 'issues')) ?? '', /couldn’t be read, so it can’t be switched here\.$/);
  assert.equal(cantSwitch(item(installed('codex-cli', { switchesHeld: 'Inline.' }), 'skill', 'one')), 'Inline.');
  assert.equal(cantSwitch(item(installed('codex-cli', { switchesHeld: 'Inline.' }), 'mcp', 'issues')), undefined, 'a server’s switch is another table');
  assert.equal(cantSwitch(item(installed('copilot-cli', { skillsOff: ['one'], skillsHeld: { one: 'Every skill named one is off.' } }), 'skill', 'one')), 'Every skill named one is off.');
  assert.equal(cantSwitch(item(installed('claude-cli'), 'skill', 'one')), undefined);
});

test('choices that mean nothing after a read are dropped: already so, or the plugin is gone from that tool', () => {
  const draft: PluginDraft = new Map();
  const op = (more: Partial<PluginOp>): PluginOp => ({ source: '/m', marketName: 'team', plugin: 'full', tool: 'codex-cli', action: 'skill-off', ...more });
  const keys = ['a', 'b', 'c', 'd', 'e'];
  [op({ skill: 'one' }), op({ part: { kind: 'mcp', name: 'issues' }, action: 'part-off' }), op({ part: { kind: 'mcp', name: 'wiki' }, action: 'part-off' }), op({ action: 'plugin-off' }), op({ tool: 'copilot-cli', skill: 'one' })].forEach((entry, index) => draft.set(keys[index]!, entry));
  // Codex now has `one` and `issues` off; Copilot CLI no longer has the plugin.
  prune(draft, [installed('codex-cli', { skillsOff: ['one'], serversOff: ['issues'] })]);
  assert.deepEqual([...draft.keys()], ['c', 'd']);
});
