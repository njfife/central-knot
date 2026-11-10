// A page's own data (Instructions, History, Plugins), read apart from the home itself: one slot per kind, which says
// where its read is. The pages render from the slot alone: the data once read, "Reading…" while there is none yet, and
// "could not be read" only after a read really failed.
//
// Each read bumps its slot's generation, and its reply is kept only while no newer read or put of the same kind has
// started. Nothing else drops a reply: an action running meanwhile (busy) leaves the page's read alone.

export type PageDataState = 'reading' | 'ready' | 'failed';
export interface PageData<T> { state: PageDataState; data?: T; gen: number }

/** A slot with nothing read yet: its page says "Reading…" until its first read answers. */
export const pageData = <T>(): PageData<T> => ({ state: 'reading', gen: 0 });

/**
 * Reads into the slot: 'ready' with the data kept, 'failed' with what was there before kept (the page shows that, or
 * says nothing could be read), or 'dropped' when a newer read or put of this kind started meanwhile. A fetch that answers
 * null found nothing to read, which counts as a failure.
 */
export async function readPageData<T>(slot: PageData<T>, fetch: () => Promise<T | null | undefined>): Promise<'ready' | 'failed' | 'dropped'> {
  const gen = ++slot.gen;
  slot.state = 'reading';
  let value: T | null | undefined;
  try { value = await fetch(); } catch { value = undefined; }
  if (gen !== slot.gen) return 'dropped';
  if (value === null || value === undefined) { slot.state = 'failed'; return 'failed'; }
  slot.data = value;
  slot.state = 'ready';
  return 'ready';
}

/** Data an action read itself, after what it changed: the newest, so a read still on its way is dropped. */
export function putPageData<T>(slot: PageData<T>, data: T): void {
  slot.gen++;
  slot.data = data;
  slot.state = 'ready';
}

/** A new home: what was read belonged to the old one. The slot starts over at reading, and replies on their way are dropped. */
export function resetPageData<T>(slot: PageData<T>): void {
  slot.gen++;
  slot.data = undefined;
  slot.state = 'reading';
}
