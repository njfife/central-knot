import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batches, describe, reverse, summary, toggle, toggleMany, queued, type PluginDone, type PluginDraft, type PluginOp } from '../src/pluginplan.ts';
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
    { ...op('pdf', 'claude-cli'), report: { tool: 'claude-cli', outcome: 'installed', message: 'Installed.', runs: [] } },
    { ...op('pdf', 'codex-cli'), report: { tool: 'codex-cli', outcome: 'failed', message: 'It stopped with exit code 1.', runs: [] } },
    { ...op('docx', 'copilot-cli', 'remove'), report: { tool: 'copilot-cli', outcome: 'uninstalled', message: 'Uninstalled.', runs: [] } },
  ];
  assert.deepEqual(reverse(done).map(entry => [entry.plugin, entry.tool, entry.action]), [['pdf', 'claude-cli', 'remove'], ['docx', 'copilot-cli', 'install']]);
  assert.deepEqual(describe(done, names), [
    { plugin: 'pdf', ok: true, text: 'installed in Claude Code' },
    { plugin: 'pdf', ok: false, text: 'Codex: It stopped with exit code 1.' },
    { plugin: 'docx', ok: true, text: 'uninstalled from Copilot CLI' },
  ]);
});
