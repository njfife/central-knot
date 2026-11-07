import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRows, copiesIn, matches, planGroups, planSummary } from '../src/model.ts';
import type { HarnessId, HomeView, PlanItem, Preview, Skill, Snapshot } from '../src/types.ts';

const skill = (folder: string, extra: Partial<Skill> = {}): Skill => ({
  id: folder, folder, name: folder, description: '', path: `/h/${folder}/SKILL.md`, directory: `/h/${folder}`, realDirectory: `/h/${folder}`,
  rootLabel: 'root', hasFrontmatter: true, metadataKeys: [], content: '', notes: [], status: 'Not shared', ...extra,
});
const snapshot = (harness: HarnessId, skills: Skill[]) => ({ harness, skills }) as Snapshot;
const item = (key: string, state: PlanItem['state'], status: string): PlanItem => ({ key, name: key, state, status, reason: '', copies: [], targets: [], locked: false, undoable: false });
const preview = (items: PlanItem[]) => ({ items }) as Preview;
const view = (snapshots: Snapshot[]) => ({ snapshots }) as HomeView;

test('a row joins copies across tools and tools with two copies', () => {
  const home = view([
    snapshot('claude-cli', [skill('Notes')]),
    snapshot('copilot-cli', [skill('notes', { id: 'notes' }), skill('notes', { id: 'notes (other)', rootLabel: 'other' }), skill('standup')]),
  ]);
  const rows = buildRows(home, preview([]));
  assert.deepEqual(rows.map(row => row.key), ['notes', 'standup']);
  assert.equal(copiesIn(rows[0], 'claude-cli').length, 1);
  assert.equal(copiesIn(rows[0], 'copilot-cli').length, 2);
  assert.equal(copiesIn(rows[1], 'claude-cli').length, 0);
});

test('row status comes from the plan, and anything else reads Not shared', () => {
  const home = view([snapshot('claude-cli', [skill('a'), skill('b'), skill('c'), skill('d')])]);
  const rows = buildRows(home, preview([item('a', 'collision', 'Needs a decision'), item('b', 'copy', 'Will copy'), item('c', 'dont-share', 'Don’t share')]));
  assert.deepEqual(rows.map(row => row.status), ['Needs a decision', 'Not shared', 'Not shared', 'Not shared']);
});

test('find matches name, folder and description without case', () => {
  const [row] = buildRows(view([snapshot('claude-cli', [skill('notes', { name: 'Daily Notes', description: 'Writes things down' })])]), preview([]));
  for (const text of ['daily', 'NOTES', 'things', '  notes ', '']) assert.equal(matches(row, text), true, text);
  assert.equal(matches(row, 'zzz'), false);
});

test('the plan groups by status, most urgent first, and summarizes', () => {
  const items = [item('z', 'identical', 'Already identical'), item('b', 'copy', 'Will copy'), item('a', 'copy', 'Will copy'), item('c', 'collision', 'Needs a decision')];
  assert.deepEqual(planGroups(items).map(group => [group.status, group.items.map(entry => entry.key)]), [['Needs a decision', ['c']], ['Will copy', ['a', 'b']], ['Already identical', ['z']]]);
  assert.equal(planSummary(items), '2 to copy · 1 to decide');
  assert.equal(planSummary([item('z', 'identical', 'Already identical')]), '1 in step');
});
