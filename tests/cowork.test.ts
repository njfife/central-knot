import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasCowork } from '../src/presence.ts';
import type { Snapshot } from '../src/types.ts';

const snapshot = (more: Partial<Snapshot>): Snapshot => ({ harness: 'claude-cli', harnessName: 'Claude Code', surface: 'CLI', mode: 'actual', label: 'This Mac', root: '/home/.claude',
  detection: 'Installed', probe: { state: 'ok', version: '2.1.321', detail: '' }, discovery: 'empty', skills: [], issues: [], ...more });
const claudeDesktop = { name: 'Claude desktop', version: '5.1231.0', carries: 'Code tab', carriedVersion: '2.1.321' };

test('Cowork is here exactly where Claude desktop was found; another tool’s desktop app, or a home that wasn’t searched, says nothing', () => {
  assert.equal(hasCowork([snapshot({})]), false, 'Claude Code’s CLI alone');
  assert.equal(hasCowork([snapshot({ app: claudeDesktop })]), true, 'the CLI and Claude desktop');
  assert.equal(hasCowork([snapshot({ detection: 'App only', probe: { state: 'missing', detail: '' }, app: claudeDesktop })]), true, 'Claude desktop alone');
  assert.equal(hasCowork([snapshot({ harness: 'codex-cli', harnessName: 'Codex', app: { name: 'ChatGPT desktop', carries: 'Codex' } })]), false, 'ChatGPT desktop is not Claude’s');
  // A chosen folder or the Practice copy: apps are never looked for there, so nothing is known and nothing is said.
  assert.equal(hasCowork([snapshot({ mode: 'custom', detection: 'Config found but app not detected', probe: { state: 'not-run', detail: '' } })]), false);
});
