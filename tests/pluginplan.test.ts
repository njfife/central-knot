import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batches, describe, prune, reverse, summary, toggle, toggleMany, queued, type PluginDone, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
import { andList } from '../src/words.ts';
import type { HarnessId } from '../src/types.ts';

const names = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' } as Record<HarnessId, string>;
const op = (plugin: string, tool: HarnessId, action: PluginOp['action'] = 'install'): PluginOp => ({ source: 'anthropics/skills', market: 'anthropic-agent-skills', plugin, tool, action });

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
  assert.deepEqual(summary(draft), { plugins: 1, installs: 2, removals: 0 });
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

test('Undo reverses only what really changed, and the report names each plugin once', () => {
  const done: PluginDone[] = [
    { ...op('pdf', 'claude-cli'), report: { tool: 'claude-cli', outcome: 'installed', message: 'Installed.', runs: [], changed: true } },
    { ...op('pdf', 'codex-cli'), report: { tool: 'codex-cli', outcome: 'failed', message: 'It stopped with exit code 1.', runs: [] } },
    { ...op('docx', 'copilot-cli', 'remove'), report: { tool: 'copilot-cli', outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true } },
    // Already installed before this run (the view was stale): Undo must not remove what the person already had.
    { ...op('xlsx', 'claude-cli'), report: { tool: 'claude-cli', outcome: 'installed', message: 'Already installed in Claude Code.', runs: [] } },
  ];
  assert.deepEqual(reverse(done).map(entry => [entry.plugin, entry.tool, entry.action]), [['pdf', 'claude-cli', 'remove'], ['docx', 'copilot-cli', 'install']]);
  assert.deepEqual(describe(done, names, andList), [
    { plugin: 'pdf', ok: true, text: 'installed in Claude Code' },
    { plugin: 'pdf', ok: false, text: 'Codex: It stopped with exit code 1.' },
    { plugin: 'docx', ok: true, text: 'uninstalled from Copilot CLI' },
    { plugin: 'xlsx', ok: true, text: 'already in Claude Code' },
  ]);
});

test('Two marketplaces may offer the same plugin name: their reports stay apart', () => {
  const done: PluginDone[] = [
    { ...op('pdf', 'claude-cli'), report: { tool: 'claude-cli', outcome: 'installed', message: '', runs: [], changed: true } },
    { ...op('pdf', 'codex-cli'), source: 'other/market', report: { tool: 'codex-cli', outcome: 'installed', message: '', runs: [], changed: true } },
  ];
  assert.equal(describe(done, names, andList).length, 2);
});

test('Choices for a plugin or marketplace no longer listed are dropped', () => {
  const draft: PluginDraft = new Map();
  toggle(draft, op('pdf', 'claude-cli'));
  toggle(draft, op('gone', 'claude-cli'));
  toggle(draft, { ...op('pdf', 'codex-cli'), source: 'removed/market' });
  prune(draft, { home: '/h', tools: ['claude-cli'], clis: { 'claude-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'anthropic-agent-skills', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins: [{ name: 'pdf', description: '' }], states: {} }] });
  assert.deepEqual([...draft.values()].map(entry => entry.plugin), ['pdf']);
});

test('Choices that no longer mean anything are dropped: already installed, not installed, held, or no CLI', () => {
  const draft: PluginDraft = new Map();
  toggle(draft, op('done', 'claude-cli'));
  toggle(draft, op('gone', 'claude-cli', 'remove'));
  toggle(draft, op('held', 'claude-cli'));
  toggle(draft, op('nocli', 'codex-cli'));
  toggle(draft, op('keep', 'claude-cli'));
  const plugins = ['done', 'gone', 'held', 'nocli', 'keep'].map(name => ({ name, description: '' }));
  prune(draft, { home: '/h', tools: ['claude-cli', 'codex-cli'], clis: { 'claude-cli': true }, canWrite: true, marketplaces: [{ source: 'anthropics/skills', origins: ['central-knot'], name: 'm', kind: 'git', sourceLabel: 'GitHub: anthropics/skills', plugins,
    states: { done: { 'claude-cli': { state: 'installed', path: '/p' } }, held: { 'claude-cli': { state: 'held', reason: 'other' } } } }] });
  assert.deepEqual([...draft.values()].map(entry => entry.plugin), ['keep']);
});

test('A run goes on past a step that throws, and a refusal stops it with the rest still chosen', async () => {
  const { runPlan } = await import('../src/pluginplan.ts');
  const ops = [op('pdf', 'claude-cli'), op('docx', 'claude-cli'), op('xlsx', 'claude-cli')];
  const seen: string[] = [];
  const api = {
    install: async (_source: string, plugin: string, tools: HarnessId[]) => {
      seen.push(plugin);
      if (plugin === 'pdf') throw new Error('IPC gone');
      if (plugin === 'xlsx') return { stopped: 'Writing isn’t allowed here.', reports: [] };
      return { reports: tools.map(tool => ({ tool, outcome: 'installed' as const, message: '', runs: [], changed: true })) };
    },
    uninstall: async () => ({ reports: [] }),
  };
  const result = await runPlan(ops, api, '/home');
  assert.deepEqual(seen, ['pdf', 'docx', 'xlsx']);
  assert.deepEqual(result.done.map(entry => [entry.plugin, entry.report.outcome]), [['pdf', 'failed'], ['docx', 'installed']]);
  assert.equal(result.stopped, 'Writing isn’t allowed here.');
});

test('An Undo says what came back, and keeps what it did not get to', async () => {
  const { notUndone, resultSentence } = await import('../src/pluginplan.ts');
  const undoOps = [op('pdf', 'claude-cli', 'remove'), op('docx', 'codex-cli', 'install'), op('xlsx', 'claude-cli', 'remove')];
  const done: PluginDone[] = [
    { ...undoOps[0]!, report: { tool: 'claude-cli', outcome: 'uninstalled', message: '', runs: [], changed: true } },
    { ...undoOps[1]!, report: { tool: 'codex-cli', outcome: 'installed', message: '', runs: [], changed: true } },
  ];
  assert.equal(resultSentence(describe(done, names, andList, true), true), 'Undone: pdf removed from Claude Code; docx put back in Codex.');
  assert.deepEqual(notUndone(undoOps, done).map(entry => entry.plugin), ['xlsx']);
});
