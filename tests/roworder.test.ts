import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byKey, standing } from '../src/roworder.ts';

const tools = ['claude-cli', 'codex-cli', 'copilot-cli'];
const item = (key: string, managed: boolean, copies: string[], disabled: string[] = []) => ({ key, managed, copies: Object.fromEntries(copies.map(tool => [tool, 'hash'])), disabled });

test('managed items come first, then items some tool uses, then items no tool uses, by name within each', () => {
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
