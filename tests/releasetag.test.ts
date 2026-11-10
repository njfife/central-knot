import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseTag } from '../scripts/release-tag.mjs';

const tags = ['v0.5.0-preview.10', 'v0.5.0-preview.9', 'checkpoint-ui-2026-11-09'];

test('a build records the highest version tag on its commit, or the tag it is told', () => {
  assert.equal(releaseTag({ tags }), 'v0.5.0-preview.10');
  assert.equal(releaseTag({ tags: ['checkpoint-ui-2026-11-09'] }), '', 'other tags don’t count');
  assert.equal(releaseTag({}), '');
  assert.equal(releaseTag({ named: 'v0.5.0-preview.98', tags }), 'v0.5.0-preview.98');
  assert.equal(releaseTag({ named: '', tags }), '', 'told to record none');
  assert.throws(() => releaseTag({ named: 'preview-7' }), /isn’t a version tag/);
});

test('a checkout with changes of its own never takes its commit’s tag', () => {
  const changes = [' M src/updater.ts', '?? notes.txt'];
  assert.equal(releaseTag({ tags, changes }), '');
  assert.equal(releaseTag({ named: 'v0.5.0-preview.98', tags, changes }), 'v0.5.0-preview.98', 'a test build is told its tag outright');
});

test('a release needs a tag and a checkout without changes', () => {
  assert.equal(releaseTag({ release: true, tags }), 'v0.5.0-preview.10');
  assert.throws(() => releaseTag({ release: true }), /built from its tag/);
  assert.throws(() => releaseTag({ release: true, tags, changes: [' M src/updater.ts'] }), /changes of its own:\n M src\/updater\.ts/);
  assert.throws(() => releaseTag({ release: true, named: 'v0.5.0-preview.10', tags, changes: ['?? notes.txt'] }), /changes of its own/);
});
