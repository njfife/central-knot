// Background reads kept in a map: a placeholder while reading, then the value. A read whose placeholder has since been
// replaced or cleared (a Refresh, a home switch) is dropped, so a slow old answer never overwrites a newer one.

/** Something read in the background: still being read, or what came back. */
export type Read<T> = { reading: true } | { reading: false; value: T };

/** For a read whose value is null when it failed: still reading, failed (until it is cleared and read again), or neither. */
export const readState = <T>(read: Read<T | null> | undefined): 'reading' | 'failed' | undefined => (read?.reading ? 'reading' : read && read.value === null ? 'failed' : undefined);

/** Starts `read` for `key` unless the map already has it, and stores the answer only while its own placeholder is there. */
export function readInto<T>(map: Map<string, Read<T>>, key: string, read: () => Promise<T>, onDone: () => void): void {
  if (map.has(key)) return;
  const placeholder: Read<T> = { reading: true };
  map.set(key, placeholder);
  void read().then(value => {
    if (map.get(key) !== placeholder) return;
    map.set(key, { reading: false, value });
    onDone();
  });
}
