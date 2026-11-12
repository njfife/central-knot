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

test('a pre-release tag names its line exactly, or packaging stops: a mistyped alpha is never packaged as a preview', () => {
  assert.throws(() => releaseTag({ named: 'v0.6.0-alpha1' }), { message: 'v0.6.0-alpha1 names no release line. A pre-release is tagged v<version>-alpha.<n> (an alpha) or v<version>-preview.<n> (a preview), as v0.6.0-alpha.1 or v0.6.0-preview.1.' });
  for (const tag of ['v0.6.0-Alpha.1', 'v0.6.0-a.1', 'v0.6.0-alpha', 'v0.6.0-alpha-2', 'v1.0.0-rc.1']) {
    assert.throws(() => releaseTag({ named: tag }), { message: new RegExp(`^${tag.replace(/\./g, '\\.')} names no release line\\.`) }, tag);
    assert.throws(() => releaseTag({ tags: [tag] }), /names no release line/, `${tag} as the commit’s own tag`);
  }
  for (const tag of ['v0.6.0-alpha.1', 'v0.5.0-preview.9', 'v0.5.0']) assert.equal(releaseTag({ named: tag }), tag);
});
