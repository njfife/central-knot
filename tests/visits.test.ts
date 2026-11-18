// The Back list on its own: visits, branching, and a destination that no longer exists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyVisits, travel, visit, type Place } from '../src/visits.ts';

test('a redraw keeps Forward, a visit replaces it, and a lost tool leaves one stop at its parent', () => {
  const page: Place = { page: 'overview' }, list: Place = { page: 'harnesses' };
  const tab: Place = { ...list, tool: 'codex-cli', tab: 'skills' }, settings: Place = { page: 'settings' };
  const keep = (p: Place) => p;
  const seen = [page, list, tab, settings].reduce(visit, emptyVisits());
  const back = travel(seen, -1, keep);
  assert.equal(visit(back, { ...tab }), back);
  assert.deepEqual(travel(back, 1, keep), seen);
  assert.deepEqual(visit(back, page), { entries: [page, list, tab, page], cursor: 3 });
  const gone = travel(seen, -1, p => p.tool ? list : p);
  assert.deepEqual(gone, { entries: [page, list, settings], cursor: 1 });
  const start = travel(gone, -1, keep);
  assert.equal(travel(start, -1, keep), start);
});
