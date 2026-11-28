// Keeps each hook's last collected output in one bounded JSON file in the app data folder (hook-results.json),
// keyed by hookrun.ts hookRunKey and written atomically via share.ts writeDurably.
// Called only by main.ts hook IPC handlers (hook:run, hook:last, hook:forget); outside Library, Git, profiles and History.
// Bounds: at most MAX_HOOK_RESULTS entries globally (oldest dropped) and MAX_HOOK_RESULT_BYTES per text field;
// stopped and refused runs are skipped (sessionhooks.ts isKeptHookOutcome), writes serialize through one promise chain, and
// unreadable files recover as empty. Nothing here runs hooks, draws pages or drains at Quit.
import { readFile } from 'node:fs/promises';
import { hookRunKey } from './hookrun.ts';
import { isKeptHookOutcome } from './sessionhooks.ts';
import { writeDurably } from './share.ts';
import type { HookRunResult, HookSourceRef } from './types.ts';
import { jsonObject, record } from './values.ts';

export const MAX_HOOK_RESULTS = 50;
export const MAX_HOOK_RESULT_BYTES = 16 * 1024;
export const HOOK_RESULT_CUT_NOTE = '\n\n[Central Knot kept the first 16 KB.]';

function cutText(value: string): string {
  const buf = Buffer.from(value, 'utf8');
  if (buf.length <= MAX_HOOK_RESULT_BYTES) return value;
  let end = MAX_HOOK_RESULT_BYTES;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return `${buf.subarray(0, end).toString('utf8')}${HOOK_RESULT_CUT_NOTE}`;
}

const boundResult = (result: HookRunResult): HookRunResult => ({
  ...result,
  ...(result.added !== undefined ? { added: cutText(result.added) } : {}),
  allPrinted: cutText(result.allPrinted),
  stderr: cutText(result.stderr),
});

function validResult(value: unknown): value is HookRunResult {
  const r = record(value);
  return !!r && isKeptHookOutcome(r.outcome) && (r.added === undefined || typeof r.added === 'string')
    && typeof r.allPrinted === 'string' && typeof r.stderr === 'string' && typeof r.at === 'string'
    && typeof r.cwd === 'string' && typeof r.durationMs === 'number' && typeof r.emptyPrompt === 'boolean';
}

/** Creates the app-data store for hooks' last collected outputs at `path`, serializing writes through one promise chain. */
export function createHookRunStore(path: string) {
  let writes: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<Map<string, HookRunResult>> => {
    const parsed = await readFile(path, 'utf8').then(jsonObject, () => undefined);
    const raw = parsed?.version === 1 ? record(parsed.entries) : undefined;
    return new Map(Object.entries(raw ?? {}).filter((entry): entry is [string, HookRunResult] => validResult(entry[1])));
  };
  const update = (mutate: (entries: Map<string, HookRunResult>) => boolean): Promise<void> => {
    const next = writes.then(async () => {
      const entries = await load();
      if (!mutate(entries)) return;
      await writeDurably(path, `${JSON.stringify({ version: 1, entries: Object.fromEntries(entries) })}\n`);
    });
    writes = next.catch(() => undefined);
    return next;
  };
  return {
    async get(home: string, refs: readonly (HookSourceRef | undefined)[]): Promise<(HookRunResult | null)[]> {
      await writes;
      const entries = await load();
      return refs.map(ref => (ref ? entries.get(hookRunKey(home, ref)) ?? null : null));
    },
    put(home: string, ref: HookSourceRef, result: HookRunResult): Promise<void> {
      if (ref.from === 'marketplace' || !isKeptHookOutcome(result.outcome)) return Promise.resolve();
      return update(entries => {
        const key = hookRunKey(home, ref);
        entries.delete(key);
        entries.set(key, boundResult(result));
        while (entries.size > MAX_HOOK_RESULTS) entries.delete(entries.keys().next().value!);
        return true;
      });
    },
    remove: (home: string, ref: HookSourceRef): Promise<void> => update(entries => entries.delete(hookRunKey(home, ref))),
  };
}
