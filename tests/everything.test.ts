// Synchronize everything (everything.ts setSyncEverything): the switch-on's History entry id comes back only when the rule
// really moves from off (or unanswered) to on, never on a repeat or when switching off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setSyncEverything } from '../src/everything.ts';
import { readHistory } from '../src/history.ts';
import type { ShareContext } from '../src/share.ts';

test('setSyncEverything returns the switch-on History entry id only when switching to on, never on a repeat or off', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-everything-')));
  const home = join(base, 'home');
  await mkdir(home, { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  try {
    const first = await setSyncEverything(context, true);
    const afterFirst = await readHistory(context);
    assert.deepEqual([first.stopped, typeof first.event, afterFirst.length, first.event === afterFirst[0]?.id], [undefined, 'string', 1, true]);

    // Already on (a second window switching it on again): makes no entry and returns no id.
    const repeat = await setSyncEverything(context, true);
    assert.deepEqual([repeat, (await readHistory(context)).length], [{}, 1]);

    // Switching off makes its own switch-off entry, and returns no switch-on id.
    const off = await setSyncEverything(context, false);
    assert.deepEqual([off, (await readHistory(context)).length], [{}, 2]);

    // Switching off -> on again makes a new entry and returns its id.
    const again = await setSyncEverything(context, true);
    const afterAgain = await readHistory(context);
    assert.deepEqual([again.stopped, typeof again.event, afterAgain.length, again.event === afterAgain.at(-1)?.id, again.event !== first.event], [undefined, 'string', 3, true, true]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
