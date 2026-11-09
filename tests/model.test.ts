import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plural } from '../src/model.ts';

test('plural words read naturally', () => {
  assert.equal(plural(1, 'copy', 'copies'), '1 copy');
  assert.equal(plural(3, 'copy', 'copies'), '3 copies');
  assert.equal(plural(0, 'skill'), '0 skills');
});
