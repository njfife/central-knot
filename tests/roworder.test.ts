import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inDisplayOrder, inUse, pluginsInDisplayOrder, standing } from '../src/roworder.ts';

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
  assert.deepEqual(inDisplayOrder(list, tools).map(entry => entry.key), ['alpha', 'beta', '.alpha', 'half-off', 'zeta', 'managed-but-off', 'nowhere', 'off-everywhere']);
  assert.deepEqual(list.map(entry => standing(entry, tools)), [1, 2, 0, 1, 2, 1, 0, 2]);
});

test('a copy only counts in a tool that is shown', () => {
  assert.equal(inUse(item('left-behind', false, ['pi']), tools), false);
  assert.equal(inUse(item('left-behind', false, ['pi']), [...tools, 'pi']), true);
});

test('plugins every tool has come first, then plugins some tool has, then the rest, each in the order given', () => {
  const holding: Record<string, number> = { a: 0, b: 2, c: 3, d: 0, e: 1, f: 3 };
  assert.deepEqual(pluginsInDisplayOrder(Object.keys(holding), name => holding[name], 3), ['c', 'f', 'b', 'e', 'a', 'd']);
  assert.deepEqual(pluginsInDisplayOrder(['a', 'b'], () => 0, 0), ['a', 'b']);
});
