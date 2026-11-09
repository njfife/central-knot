import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAdd, withOnlyBoth } from '../src/addplan.ts';
import type { SampleSkill } from '../src/design.ts';

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
const skill = (key: string, copies: Record<string, string>, extra: Partial<SampleSkill> = {}): SampleSkill => ({ key, description: '', copies, managed: false, off: [], ...extra });
const keys = (list: { key: string }[]) => list.map(item => item.key);

test('Adding Copilot to Claude Code tells new, same, different and synced apart', () => {
  const plan = planAdd([
    skill('fresh', { 'copilot-cli': 'a' }),
    skill('same', { 'copilot-cli': 'b', 'claude-cli': 'b' }),
    skill('clash', { 'copilot-cli': 'c', 'claude-cli': 'c2' }),
    skill('clash-elsewhere', { 'copilot-cli': 'f', 'codex-cli': 'f2' }),
    skill('synced', { 'copilot-cli': 'd', 'claude-cli': 'd' }, { managed: true }),
    skill('synced-third-differs', { 'copilot-cli': 'g', 'claude-cli': 'g', 'codex-cli': 'g2' }, { managed: true }),
    skill('claude-only', { 'claude-cli': 'e' }),
  ], 'copilot-cli', 'claude-cli', tools);
  assert.deepEqual(keys(plan.fresh), ['fresh']);
  assert.deepEqual(keys(plan.same), ['same']);
  assert.deepEqual(plan.differ.map(entry => [entry.skill.key, entry.replaced, entry.here]), [['clash', ['claude-cli'], true], ['clash-elsewhere', ['codex-cli'], false]]);
  assert.deepEqual(keys(plan.synced), ['synced', 'synced-third-differs'], 'a third tool differing must not turn a synced pair into a conflict');
  assert.equal(plan.skip.length + plan.blocked.length + plan.resume.length, 0, 'a skill the source lacks is not counted');
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
    skill('block-off', { 'copilot-cli': 'e', 'claude-cli': 'e2' }, { off: ['codex-cli'], blocks: { 'copilot-cli': [{ tool: 'codex-cli', reason: 'irrelevant' }] } }),
  ], 'copilot-cli', 'claude-cli', tools);
  assert.deepEqual(plan.blocked.map(entry => entry.skill.key), ['blocked']);
  assert.match(plan.blocked[0].reason, /different copy elsewhere/);
  assert.deepEqual(plan.skip.map(entry => entry.skill.key), ['held', 'dot', 'separate']);
  assert.deepEqual(plan.differ.map(entry => entry.skill.key), ['block-off'], 'a block on a tool it would not sync to does not count');
});

test('Adding to one harness from its own page enrols only the two tools named', () => {
  const plan = planAdd([
    skill('fresh', { 'copilot-cli': 'a' }),
    skill('third-differs', { 'copilot-cli': 'b', 'codex-cli': 'b2' }),
    skill('managed', { 'copilot-cli': 'c' }, { managed: true, off: ['claude-cli'] }),
  ], 'copilot-cli', 'claude-cli', tools, { onlyBoth: true });
  assert.deepEqual(keys(plan.fresh), ['fresh', 'third-differs'], 'a third tool is left out, so its different copy is no conflict');
  assert.deepEqual(keys(plan.resume), ['managed']);
  assert.deepEqual(withOnlyBoth(skill('fresh', { 'copilot-cli': 'a' }), 'copilot-cli', 'claude-cli', tools).off, ['codex-cli']);
  assert.deepEqual(withOnlyBoth(skill('managed', {}, { managed: true, off: ['claude-cli', 'codex-cli'] }), 'copilot-cli', 'claude-cli', tools).off, ['codex-cli'], 'a managed skill keeps the tools it syncs to');
});
