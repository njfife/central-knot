// A test's wait for something its subject does: it goes on the moment that happens, and a generous deadline in real time only
// says that it never happened, naming what was awaited, instead of hanging. Never a guess at how long the subject takes. Both
// helpers use the real setTimeout and clearTimeout, kept when this module loads, so they run even while a test has mocked
// the clock (t.mock.timers, as tests/updateflow.test.ts does).
const realTimeout = setTimeout, clearRealTimeout = clearTimeout;

export async function within<T>(what: string, happens: Promise<T>): Promise<T> {
  let deadline: NodeJS.Timeout | undefined;
  const never = new Promise<never>((_, fail) => { deadline = realTimeout(() => fail(new Error(`never happened: ${what}`)), 30_000); });
  try { return await Promise.race([happens, never]); } finally { clearRealTimeout(deadline); }
}

/** Calls `check` after each `ms` in real time, one at a time, until the returned stop is called. */
export function realBeat(check: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | undefined, stopped = false;
  const arm = () => { timer = realTimeout(() => { if (!stopped) { check(); if (!stopped) arm(); } }, ms); };
  arm();
  return () => { stopped = true; clearRealTimeout(timer); };
}
