import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAdd } from '../src/addplan.ts';
import type { SampleSkill } from '../src/design.ts';

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
const skill = (key: string, copies: Record<string, string>, extra: Partial<SampleSkill> = {}): SampleSkill => ({ key, description: '', copies, managed: false, off: [], ...extra });
const keys = (list: { key: string }[]) => list.map(item => item.key);

test('Adding Copilot to Claude Code tells new, same, different and synced apart', () => {
  const plan = planAdd([
    skill('fresh', { 'copilot-cli': 'a' }),
    skill('same', { 'copilot-cli': 'b', 'claude-cli': 'b' }),
    skill('clash', { 'copilot-cli': 'c', 'claude-cli': 'c2' }),
    skill('synced', { 'copilot-cli': 'd', 'claude-cli': 'd' }, { managed: true }),
    skill('claude-only', { 'claude-cli': 'e' }),
  ], 'copilot-cli', 'claude-cli', tools);
  assert.deepEqual(keys(plan.fresh), ['fresh']);
  assert.deepEqual(keys(plan.same), ['same']);
  assert.deepEqual(plan.differ.map(entry => [entry.skill.key, entry.replaced, entry.here]), [['clash', ['claude-cli'], true]]);
  assert.deepEqual(keys(plan.synced), ['synced']);
  assert.equal(plan.skip.length + plan.blocked.length + plan.resume.length, 0, 'a skill the source lacks is not counted');
});

test('A pair already syncing one copy stays synced, even when a third tool differs', () => {
  const plan = planAdd([skill('wizard', { 'claude-cli': 'e', 'copilot-cli': 'e2', 'codex-cli': 'e' }, { managed: true })], 'claude-cli', 'codex-cli', tools);
  assert.deepEqual(keys(plan.synced), ['wizard'], 'adding Claude to Codex must not replace Copilot’s copy as a side effect');
  assert.equal(plan.differ.length, 0);
});

test('A conflict only in another tool is different, and says it is not the target’s copy', () => {
  const plan = planAdd([skill('review', { 'copilot-cli': 'j2', 'claude-cli': 'j' })], 'copilot-cli', 'codex-cli', tools);
  assert.deepEqual(plan.differ.map(entry => [entry.skill.key, entry.replaced, entry.here]), [['review', ['claude-cli'], false]]);
});

test('A managed skill with syncing turned off is its own group, not "same"', () => {
  const plan = planAdd([
    skill('off-target', { 'copilot-cli': 'a', 'claude-cli': 'a' }, { managed: true, off: ['claude-cli'] }),
    skill('off-source', { 'copilot-cli': 'b' }, { managed: true, off: ['copilot-cli'] }),
  ], 'copilot-cli', 'claude-cli', tools);
  assert.deepEqual(keys(plan.resume), ['off-target', 'off-source']);
  assert.equal(plan.same.length + plan.fresh.length, 0);
});

test('Blocked conflicts, held skills, unloadable tools and kept-separate skills are not offered', () => {
  const plan = planAdd([
    skill('blocked', { 'copilot-cli': 'a', 'claude-cli': 'a2' }, { blocks: { 'copilot-cli': [{ tool: 'claude-cli', reason: 'Claude Code also reads a different copy elsewhere.' }] } }),
    skill('held', { 'copilot-cli': 'b' }, { held: 'It contains a link.' }),
    skill('dot', { 'copilot-cli': 'c' }, { cannot: { 'claude-cli': 'Not loadable.' } }),
    skill('separate', { 'copilot-cli': 'd', 'claude-cli': 'd2' }, { separate: true }),
  ], 'copilot-cli', 'claude-cli', tools);
  assert.deepEqual(plan.blocked.map(entry => entry.skill.key), ['blocked']);
  assert.match(plan.blocked[0].reason, /different copy elsewhere/);
  assert.deepEqual(plan.skip.map(entry => entry.skill.key), ['held', 'dot', 'separate']);
  assert.equal(plan.differ.length, 0);
});

test('A block on a tool the skill would not sync to does not count', () => {
  const plan = planAdd([skill('x', { 'copilot-cli': 'a', 'claude-cli': 'a2' }, { off: ['codex-cli'], blocks: { 'copilot-cli': [{ tool: 'codex-cli', reason: 'irrelevant' }] } })], 'copilot-cli', 'claude-cli', tools);
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.differ.length, 1);
});
