import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickResults } from '../src/clickplan.ts';
import type { DestinationResult } from '../src/types.ts';

test('A click reads only its own results out of the pass: another skill held or failing is not its warning, and copies that differ are no failure', () => {
  const results: DestinationResult[] = [
    { item: 'foo', outcome: 'held', message: 'It contains a link.' },
    { item: 'baz', harness: 'codex-cli', outcome: 'failed', message: 'Could not copy.' },
    { item: 'Bar', outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' },
  ];
  assert.deepEqual(clickResults(results, ['bar']), { ours: [results[2]], did: false, refusal: undefined, failed: false, notIn: [], differs: true });
  const refused = clickResults([...results, { item: 'bar', outcome: 'held', message: 'bar changed since the page was read. Nothing was changed; read again.' }], ['bar']);
  assert.deepEqual([refused.refusal?.message, refused.failed], ['bar changed since the page was read. Nothing was changed; read again.', true]);
  // A write that failed in one tool: done elsewhere, and that tool named, so the result never calls it on there.
  const partly = clickResults([{ item: 'bar', harness: 'codex-cli', outcome: 'switched', disabled: true, message: '' }, { item: 'bar', harness: 'pi-cli', outcome: 'failed', message: 'Could not write.' }, ...results], ['bar']);
  assert.deepEqual([partly.did, partly.failed, partly.notIn], [true, true, ['pi-cli']]);
  // Claude Code waiting for its own Write step is how it should be: no failure, and not a tool the click failed in.
  const waiting = clickResults([{ item: 'bar', harness: 'codex-cli', outcome: 'written', message: '' }, { item: 'bar', harness: 'claude-cli', outcome: 'held', waits: true, message: 'Close Claude, then use Write now.' }], ['bar']);
  assert.deepEqual([waiting.did, waiting.failed, waiting.notIn], [true, false, []]);
});
