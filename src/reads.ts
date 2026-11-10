// Background reads kept in a map: a placeholder while reading, then the value. A read whose placeholder has since been
// replaced or cleared (a Refresh, a home switch) is dropped, so a slow old answer never overwrites a newer one.

/** Something read in the background: still being read, or what came back. */
export type Read<T> = { reading: true; quiet?: true } | { reading: false; value: T };

/**
 * Starts `read` for `key` unless the map already has it, and stores the answer only while its own placeholder is there.
 * A `quiet` read is one nothing on screen asked for, so nothing says it is reading.
 */
export function readInto<T>(map: Map<string, Read<T>>, key: string, read: () => Promise<T>, onDone: () => void, quiet = false): void {
  if (map.has(key)) return;
  const placeholder: Read<T> = quiet ? { reading: true, quiet: true } : { reading: true };
  map.set(key, placeholder);
  void read().then(value => {
    if (map.get(key) !== placeholder) return;
    map.set(key, { reading: false, value });
    onDone();
  });
}

/**
 * Quiet reads into the same map, `atOnce` at a time. `set` names what to read now, in order, in place of whatever still
 * waits; a key the map already has (read, or being read) is skipped when its turn comes.
 */
export function readInTurn<T>(map: Map<string, Read<T>>, atOnce: number, onDone: () => void): { set(reads: [key: string, read: () => Promise<T>][]): void } {
  let running = 0;
  let waiting: [string, () => Promise<T>][] = [];
  const next = () => {
    while (running < atOnce && waiting.length) {
      const [key, read] = waiting.shift()!;
      if (map.has(key)) continue;
      running++;
      readInto(map, key, () => read().finally(() => { running--; next(); }), onDone, true);
    }
  };
  return { set(reads) { waiting = [...reads]; next(); } };
}
