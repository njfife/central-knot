// A sync notice about one item (types.ts ItemNotice), for tests that read its winner and losers; a notice of what Synchronize
// everything took in fails the test here, since none of those tests turns the rule on. And what the Caught up band names after
// a pass of the whole home (bandAfter), for tests that read what a pass tells besides its notices.
import assert from 'node:assert/strict';
import { passTells, type HomePass } from '../src/homepass.ts';
import { caughtUpNames } from '../src/model.ts';
import type { HomeView, ItemNotice, SyncNotice } from '../src/types.ts';

export function itemNotice(notice: SyncNotice): ItemNotice {
  assert.notEqual(notice.kind, 'taken-in', 'a notice about one item');
  return notice as ItemNotice;
}

/**
 * What the Caught up band names after one pass of the whole home, from the view main.ts builds next (main.ts syncAndView): the
 * pass's results as homepass.ts passTells gives them, and each kind's notices on its own page.
 */
export function bandAfter(synced: NonNullable<HomePass['synced']>) {
  const told = passTells(synced);
  const view = { sync: { caughtUp: [...told.stopped, ...told.copies] }, skills: { notices: synced.skills?.notices ?? [] },
    mcp: { notices: synced.servers?.notices ?? [] }, agents: { notices: synced.agents?.notices ?? [] } } as unknown as HomeView;
  return caughtUpNames(view);
}
