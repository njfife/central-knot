// A sync notice about one item (types.ts ItemNotice), for tests that read its winner and losers; a notice of what Synchronize
// everything took in fails the test here, since none of those tests turns the rule on.
import assert from 'node:assert/strict';
import type { ItemNotice, SyncNotice } from '../src/types.ts';

export function itemNotice(notice: SyncNotice): ItemNotice {
  assert.notEqual(notice.kind, 'taken-in', 'a notice about one item');
  return notice as ItemNotice;
}
