import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plural, skillCount } from '../src/model.ts';
import type { Skill, Snapshot } from '../src/types.ts';

const skill = (folder: string): Skill => ({
  folder, name: folder, description: '', path: `/h/${folder}/SKILL.md`, directory: `/h/${folder}`, realDirectory: `/h/${folder}`,
  rootLabel: 'root', hasFrontmatter: true, metadataKeys: [], content: '', notes: [], status: 'Not shared',
});

test('a tool counts one skill per folder name, whatever its case or how many folders hold it', () => {
  assert.equal(skillCount({ skills: [skill('Notes'), skill('notes'), skill('review')] } as Snapshot), 2);
});

test('plural words read naturally', () => {
  assert.equal(plural(1, 'copy', 'copies'), '1 copy');
  assert.equal(plural(3, 'copy', 'copies'), '3 copies');
  assert.equal(plural(0, 'skill'), '0 skills');
});
