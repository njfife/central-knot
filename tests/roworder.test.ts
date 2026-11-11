import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byKey, loadedIn, standing } from '../src/roworder.ts';

const tools = ['claude-cli', 'codex-cli', 'copilot-cli'];
const item = (key: string, managed: boolean, copies: string[], disabled: string[] = []) => ({ key, managed, copies: Object.fromEntries(copies.map(tool => [tool, 'hash'])), disabled });

test('items that are on come first, then items some tool has that are not synced, then items that are off, by name within each', () => {
  const list = [
    item('zeta', false, ['claude-cli']),
    item('off-everywhere', false, ['claude-cli', 'codex-cli'], ['claude-cli', 'codex-cli']),
    item('beta', true, ['claude-cli', 'codex-cli']),
    item('.alpha', false, ['codex-cli']),
    item('nowhere', false, []),
    item('half-off', false, ['claude-cli', 'codex-cli'], ['codex-cli']),
    item('alpha', true, ['copilot-cli']),
    item('managed-but-off', true, ['claude-cli'], ['claude-cli']),
  ];
  assert.deepEqual(list.map(entry => standing(entry, tools)), [1, 2, 0, 1, 2, 1, 0, 2]);
  const ordered = [...list].sort((first, second) => standing(first, tools) - standing(second, tools) || byKey(first, second));
  assert.deepEqual(ordered.map(entry => entry.key), ['alpha', 'beta', '.alpha', 'half-off', 'zeta', 'managed-but-off', 'nowhere', 'off-everywhere']);
});

test('a copy only counts in a tool that is shown', () => {
  assert.equal(standing(item('left-behind', false, ['pi']), tools), 2);
  assert.equal(standing(item('left-behind', false, ['pi']), [...tools, 'pi']), 1);
});

test('a plugin’s item that is on counts: a row whose own copies are off stays on while a tool loads it through its plugin', () => {
  const triage = { ...item('triage', true, ['pi'], ['pi']), pluginOn: ['claude-cli'] };
  assert.deepEqual(loadedIn(triage, [...tools, 'pi']), ['claude-cli']);
  assert.equal(standing(triage, [...tools, 'pi']), 0);
  assert.equal(standing({ ...triage, pluginOn: [] }, [...tools, 'pi']), 2, 'the plugin item off too: off');
  // A tool with a copy of its own goes by that copy, whatever a plugin there says.
  assert.equal(standing({ ...item('own', true, ['claude-cli'], ['claude-cli']), pluginOn: ['claude-cli'] }, tools), 2);
});

