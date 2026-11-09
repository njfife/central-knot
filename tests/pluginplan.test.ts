import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batches, resultLines, resultSentence, prune, reverse, summary, toggle, toggleMany, queued, type PluginDone, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
import type { HarnessId } from '../src/types.ts';

const op = (plugin: string, tool: HarnessId, action: PluginOp['action'] = 'install'): PluginOp => ({ source: 'anthropics/skills', marketName: 'anthropic-agent-skills', plugin, tool, action });

test('Choosing a box queues it, choosing it again takes it back, and another action replaces it', () => {
  const draft: PluginDraft = new Map();
  toggle(draft, op('pdf', 'claude-cli'));
  assert.equal(queued(draft, 'anthropics/skills', 'pdf', 'claude-cli'), 'install');
  toggle(draft, op('pdf', 'claude-cli'));
  assert.equal(queued(draft, 'anthropics/skills', 'pdf', 'claude-cli'), undefined);
  toggle(draft, op('pdf', 'claude-cli'));
  toggle(draft, op('pdf', 'claude-cli', 'remove'));
  assert.equal(queued(draft, 'anthropics/skills', 'pdf', 'claude-cli'), 'remove');
});

test('Install in all queues every tool, and a second click clears them all', () => {
  const draft: PluginDraft = new Map();
  const ops = [op('pdf', 'claude-cli'), op('pdf', 'codex-cli')];
  toggle(draft, ops[0]!);
  toggleMany(draft, ops);
  assert.deepEqual(summary(draft), { plugins: 1, installs: 2, removals: 0, skillsOff: { skills: 0, tools: 0 }, skillsOn: { skills: 0, tools: 0 } });
  toggleMany(draft, ops);
  assert.equal(draft.size, 0);
});

test('Apply all runs each plugin’s installs as one command, then its removals tool by tool', () => {
  const plan = batches([op('pdf', 'claude-cli'), op('docx', 'codex-cli', 'remove'), op('pdf', 'codex-cli'), op('pdf', 'copilot-cli', 'remove')]);
  assert.deepEqual(plan.map(batch => [batch.plugin, batch.action, batch.tools]), [
    ['pdf', 'install', ['claude-cli', 'codex-cli']],
    ['pdf', 'remove', ['copilot-cli']],
    ['docx', 'remove', ['codex-cli']],
  ]);
});

test('Undo reverses only what really changed, and the report names each plugin once per marketplace', () => {
  const done: PluginDone[] = [
    { ...op('pdf', 'claude-cli'), report: { tool: 'claude-cli', outcome: 'installed', message: 'Installed.', runs: [], changed: true } },
    { ...op('pdf', 'codex-cli'), report: { tool: 'codex-cli', outcome: 'failed', message: 'It stopped with exit code 1.', runs: [] } },
    { ...op('docx', 'copilot-cli', 'remove'), report: { tool: 'copilot-cli', outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true } },
    // Already installed before this run (the view was stale): Undo must not remove what the person already had.
    { ...op('pdf', 'claude-cli'), source: 'other/market', report: { tool: 'claude-cli', outcome: 'installed', message: 'Already installed in Claude Code.', runs: [] } },
  ];
  assert.deepEqual(reverse(done).map(entry => [entry.plugin, entry.tool, entry.action]), [['docx', 'copilot-cli', 'install'], ['pdf', 'claude-cli', 'remove']], 'last first');
  assert.deepEqual(resultLines(done), [
    { source: 'anthropics/skills', plugin: 'pdf', ok: true, text: 'installed in Claude Code', short: 'installed in Claude Code' },
    { source: 'anthropics/skills', plugin: 'pdf', ok: false, text: 'Codex: It stopped with exit code 1.', short: 'Codex: It stopped with exit code 1.' },
    { source: 'anthropics/skills', plugin: 'docx', ok: true, text: 'uninstalled from Copilot CLI', short: 'uninstalled from Copilot CLI' },
    { source: 'other/market', plugin: 'pdf', ok: true, text: 'already in Claude Code', short: 'already in Claude Code' },
  ]);
});

test('Choices that no longer mean anything are dropped: no longer listed, already installed, not installed, held, or no CLI', () => {
  const draft: PluginDraft = new Map();
  toggle(draft, op('done', 'claude-cli'));
  toggle(draft, op('gone', 'claude-cli', 'remove'));
  toggle(draft, op('held', 'claude-cli'));
  toggle(draft, op('nocli', 'codex-cli'));
  toggle(draft, op('keep', 'claude-cli'));
  toggle(draft, op('unlisted', 'claude-cli'));
  toggle(draft, { ...op('keep', 'claude-cli'), source: 'removed/market' });
  const plugins = ['done', 'gone', 'held', 'nocli', 'keep'].map(name => ({ name, description: '' }));
  prune(draft, { home: '/h', tools: ['claude-cli', 'codex-cli'], clis: { 'claude-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'anthropic-agent-skills', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins,
    states: { done: { 'claude-cli': { state: 'installed', path: '/p' } }, held: { 'claude-cli': { state: 'held', reason: 'other' } } } }] });
  assert.deepEqual([...draft.values()].map(entry => entry.plugin), ['keep']);
  // A refresh that makes Copilot refuse the whole marketplace drops a Copilot choice, as its box now shows "not available".
  toggle(draft, op('keep', 'copilot-cli'));
  prune(draft, { home: '/h', tools: ['claude-cli', 'copilot-cli'], clis: { 'claude-cli': true, 'copilot-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'anthropic-agent-skills', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins, states: {}, copilotRefuses: 'npm source' }] });
  assert.deepEqual([...draft.values()].map(entry => entry.tool), ['claude-cli']);
  // A marketplace that renamed itself makes plugin@old another plugin: the choice goes.
  prune(draft, { home: '/h', tools: ['claude-cli'], clis: { 'claude-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'renamed', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins, states: {} }] });
  assert.equal(draft.size, 0);
});

test('A run goes on past a step that throws, and a refusal stops it with the rest still chosen', async () => {
  const { runPlan } = await import('../src/pluginplan.ts');
  const ops = [op('pdf', 'claude-cli'), op('docx', 'claude-cli'), op('xlsx', 'claude-cli')];
  const seen: string[] = [];
  const api = {
    install: async (_source: string, _marketName: string, plugin: string, tools: HarnessId[]) => {
      seen.push(plugin);
      if (plugin === 'pdf') throw new Error('IPC gone');
      if (plugin === 'xlsx') return { stopped: 'Writing isn’t allowed here.', reports: [] };
      return { reports: tools.map(tool => ({ tool, outcome: 'installed' as const, message: '', runs: [], changed: true })) };
    },
    uninstall: async () => ({ reports: [] }),
    setSkill: async () => ({ reports: [] }),
  };
  const result = await runPlan(ops, api, '/home');
  assert.deepEqual(seen, ['pdf', 'docx', 'xlsx']);
  assert.deepEqual(result.done.map(entry => [entry.plugin, entry.report.outcome]), [['pdf', 'failed'], ['docx', 'installed']]);
  assert.equal(result.stopped, 'Writing isn’t allowed here.');
});

test('An Undo says what came back, and keeps what it did not get to', async () => {
  const { notUndone, resultParts, resultSentence } = await import('../src/pluginplan.ts');
  const undoOps = [op('pdf', 'claude-cli', 'remove'), op('docx', 'codex-cli', 'install'), op('xlsx', 'claude-cli', 'remove'), op('pptx', 'codex-cli', 'remove')];
  const done: PluginDone[] = [
    { ...undoOps[0]!, report: { tool: 'claude-cli', outcome: 'uninstalled', message: '', runs: [], changed: true } },
    { ...undoOps[1]!, report: { tool: 'codex-cli', outcome: 'installed', message: '', runs: [], changed: true } },
    // Already gone when the Undo reached it: nothing left to do, so "Undo the rest" doesn't offer it again.
    { ...undoOps[3]!, report: { tool: 'codex-cli', outcome: 'uninstalled', message: 'Not installed in Codex.', runs: [] } },
  ];
  assert.equal(resultSentence(resultLines(done.slice(0, 2), true), true), 'Undone: pdf removed from Claude Code; docx put back in Codex.');
  assert.deepEqual(resultParts(resultLines(done.slice(0, 1), true), true), ['Undone: ', { plugin: 'pdf', source: 'anthropics/skills' }, ' removed from Claude Code', '.']);
  assert.deepEqual(notUndone(undoOps, done).map(entry => entry.plugin), ['xlsx']);
  // A run where nothing succeeded has no result sentence (its failures show in the problem band).
  const failed: PluginDone[] = [{ ...undoOps[2]!, report: { tool: 'claude-cli', outcome: 'failed', message: 'x', runs: [] } }];
  assert.equal(resultSentence(resultLines(failed, true), true), '');
});

test('After a run, what ran leaves the draft, the rest stays chosen, and the toolbar counts three or more tools', async () => {
  const { recordRun, resultParts } = await import('../src/pluginplan.ts');
  const draft: PluginDraft = new Map();
  const ops = [op('pdf', 'claude-cli'), op('pdf', 'copilot-cli'), op('pdf', 'codex-cli'), op('docx', 'claude-cli')];
  for (const entry of ops) toggle(draft, entry);
  const done: PluginDone[] = ops.slice(0, 3).map(entry => ({ ...entry, report: { tool: entry.tool, outcome: 'installed', message: '', runs: [], changed: true } }));
  const run = recordRun(draft, ops, done, false, '/h');
  assert.deepEqual([...draft.values()].map(entry => entry.plugin), ['docx'], 'docx was not reached: still chosen');
  assert.deepEqual([run.home, run.undo, run.rest], ['/h', false, undefined]);
  const lines = resultLines(run.done);
  assert.equal(lines[0]!.text, 'installed in Claude Code, Copilot CLI and Codex');
  assert.deepEqual(resultParts(lines, false, { short: true }), [{ plugin: 'pdf', source: 'anthropics/skills' }, ': installed in 3 tools', '.']);
});

test('A skill’s switch is its own choice: it runs between installs and removals, its Undo turns it back, and the report names the skill', () => {
  const off = (tool: HarnessId, skill = 'pdf-reader'): PluginOp => ({ ...op('docs', tool, 'skill-off'), skill });
  const draft: PluginDraft = new Map();
  toggle(draft, op('docs', 'codex-cli', 'remove'));
  toggle(draft, off('codex-cli'));
  toggle(draft, off('codex-cli', 'spreadsheet'));
  assert.equal(queued(draft, 'anthropics/skills', 'docs', 'codex-cli'), 'remove', 'the plugin’s own choice stays');
  assert.equal(queued(draft, 'anthropics/skills', 'docs', 'codex-cli', 'pdf-reader'), 'skill-off');
  toggle(draft, off('codex-cli', 'spreadsheet'));
  toggle(draft, off('copilot-cli'));
  assert.deepEqual(summary(draft), { plugins: 1, installs: 0, removals: 1, skillsOff: { skills: 1, tools: 2 }, skillsOn: { skills: 0, tools: 0 } }, 'one skill in two tools counts once');
  toggle(draft, off('copilot-cli'));
  assert.deepEqual(batches([...draft.values(), op('docs', 'claude-cli')]).map(step => [step.action, step.skill]), [['install', undefined], ['skill-off', 'pdf-reader'], ['remove', undefined]]);
  const done = (tool: HarnessId, outcome: 'skill-off' | 'skill-on', changed?: boolean): PluginDone => ({ ...off(tool), action: outcome, report: { tool, outcome, message: '', runs: [], changed } });
  const run = [done('codex-cli', 'skill-off', true), done('copilot-cli', 'skill-off', true), done('claude-cli', 'skill-off')];
  assert.deepEqual(reverse(run).map(back => [back.tool, back.action, back.skill]), [['copilot-cli', 'skill-on', 'pdf-reader'], ['codex-cli', 'skill-on', 'pdf-reader']], 'last first');
  assert.equal(resultLines(run)[0]!.text, 'pdf-reader turned off in Copilot CLI and Codex; pdf-reader already off in Claude Code');
  assert.equal(resultSentence(resultLines([done('codex-cli', 'skill-on', true)], true), true), 'Undone: docs: pdf-reader back on in Codex.');
});

test('A skill’s switch is dropped once it means nothing: not installed there, already as chosen, held off, a tool with no such switch, or a build it isn’t tested on', () => {
  const draft: PluginDraft = new Map();
  const choose = (tool: HarnessId, skill: string, action: PluginOp['action']) => toggle(draft, { ...op('docs', tool, action), skill });
  choose('codex-cli', 'keep', 'skill-off');
  choose('codex-cli', 'already', 'skill-off');
  choose('codex-cli', 'held', 'skill-on');
  choose('copilot-cli', 'keep', 'skill-off');
  choose('claude-cli', 'keep', 'skill-off');
  choose('copilot-cli', 'old', 'skill-off');
  prune(draft, { home: '/h', tools: ['claude-cli', 'codex-cli', 'copilot-cli'], clis: { 'claude-cli': true, 'codex-cli': true, 'copilot-cli': true }, canWrite: true, versions: { 'codex-cli': '0.167.0', 'copilot-cli': '1.0.99' },
    marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'anthropic-agent-skills', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins: [{ name: 'docs', description: '' }],
      states: { docs: { 'claude-cli': { state: 'installed', path: '/c' }, 'codex-cli': { state: 'installed', path: '/x', skillsOff: [{ skill: 'already' }, { skill: 'held', held: 'every skill named held' }] }, 'copilot-cli': { state: 'installed', path: '/p' } } } }] });
  assert.deepEqual([...draft.values()].map(entry => `${entry.tool} ${entry.skill}`), ['codex-cli keep']);
});
