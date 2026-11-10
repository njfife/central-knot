// What Central Knot has sent from a memory and where: `memory/sent.json` in the home's store. It holds marks only, so a
// missing, unreadable or damaged record reads as empty and the next send writes it anew.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, storeDirectory, writeDurably } from './share.ts';
import type { MemorySent, MemoryTool, SentEntry } from './types.ts';

export const sentPath = (home: string) => join(storeDirectory(home), 'memory', 'sent.json');

const isEntry = (entry: unknown): entry is SentEntry => {
  const { source, to, hash, at, note } = (entry ?? {}) as Record<string, unknown>;
  return typeof source === 'string' && typeof to === 'string' && typeof hash === 'string' && typeof at === 'string' && (note === undefined || typeof note === 'string');
};

/** The record's entries; none when it is missing, unreadable or damaged. */
export async function readSent(home: string): Promise<SentEntry[]> {
  try {
    const record = JSON.parse(await readFile(sentPath(home), 'utf8')) as { formatVersion?: unknown; sent?: unknown };
    return record.formatVersion === 1 && Array.isArray(record.sent) ? record.sent.filter(isEntry) : [];
  } catch { return []; }
}

/** The entries with `added` in: one per source and destination, the newer replacing the older. */
export function withSent(entries: SentEntry[], added: SentEntry[]): SentEntry[] {
  const key = (entry: SentEntry) => `${entry.to}\0${entry.source}`;
  const replaced = new Set(added.map(key));
  return [...entries.filter(entry => !replaced.has(key(entry))), ...added];
}

/** Writes the record with `added` in, dropping entries whose source file is gone. */
export async function saveSent(home: string, added: SentEntry[]): Promise<void> {
  const all = withSent(await readSent(home), added);
  const kept = (await Promise.all(all.map(async entry => ((await exists(entry.source)) ? entry : undefined)))).filter((entry): entry is SentEntry => !!entry);
  await writeDurably(sentPath(home), `${JSON.stringify({ formatVersion: 1, sent: kept }, null, 2)}\n`);
}

/** A memory's marks: where it was sent and when, and whether its text has changed since. A renamed file has none. */
export const sentMarks = (entries: SentEntry[], path: string, hash: string): MemorySent[] =>
  entries.filter(entry => entry.source === path).map(entry => ({ to: entry.to as MemoryTool, at: entry.at, changed: entry.hash !== hash }));
