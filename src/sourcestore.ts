// Where a home's sources are kept, inside its `.central-knot/` (what a source is, and what reading one does: sources.ts):
//
//   sources.json                  the record: each source the person added (SourceRecord), in the order added
//   sources/<id>/                 a source's last whole read: its repository one commit deep, swapped in only once whole
//   sources/.look-<token>/        a link looked at and not added yet (sources.ts previewSource), with what it resolved to
//                                 beside it (.look-<token>.json); the next look drops it, Add moves it to sources/<id>/
//   sources/.stage-<uuid>/        a Check now's fetch, until its turn swaps it in
//
// Which items came from a source is the items' own (library.ts LibraryItem `source`, `seen`), never this record's. This module
// only reads and writes what it is given.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NOTHING_CHANGED, errorCode, storeDirectory, writeDurably } from './share.ts';

/** One source, as the home records it (sources.json). */
export interface SourceRecord {
  /** Its own name, which each item linked to it holds (library.ts LibraryItem source). */
  id: string;
  /** The link as the person gave it, which its History entries and the versions it makes name. */
  link: string;
  /** What the link resolves to: the address git fetches; the branch or tag (when the link named none, the default branch as it was at Add); the folder ('' for the root). */
  repository: string; ref: string; folder: string;
  /** The commit last read and its time (the source's time: library.ts A SOURCE), and when it was read. */
  commit: string; commitAt: string; readAt: string;
  addedAt: string;
  /** Why the last Check now couldn't read it, until a read succeeds. */
  problem?: string;
}

const FORMAT_VERSION = 1;
const recordPath = (home: string) => join(storeDirectory(home), 'sources.json');
export const sourcesFolder = (home: string) => join(storeDirectory(home), 'sources');
/** A source's last whole read. */
export const copyOf = (home: string, id: string) => join(sourcesFolder(home), id);
/** A look's copy (sources.ts previewSource); what the link resolved to is beside it, in `<look>.json`. */
export const lookOf = (home: string, token: string) => join(sourcesFolder(home), `.look-${token}`);
/** A Check now's fetch, until its turn. */
export const stageOf = (home: string, id: string) => join(sourcesFolder(home), `.stage-${id}`);

const isRecord = (value: unknown): value is SourceRecord => {
  const source = value as Partial<SourceRecord> | null;
  return !!source && ['id', 'link', 'repository', 'ref', 'folder', 'commit', 'commitAt', 'readAt', 'addedAt'].every(field => typeof source[field as keyof SourceRecord] === 'string')
    && (source.problem === undefined || typeof source.problem === 'string');
};

/** The home's sources: none when nothing is recorded. A record that can't be read, is damaged or is newer is a `problem` that stops every write. */
export async function readSources(home: string): Promise<{ sources: SourceRecord[]; problem?: string }> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? { sources: [] } : { sources: [], problem: `The sources record could not be read. ${NOTHING_CHANGED}` }; }
  try {
    const record = JSON.parse(text) as { formatVersion?: number; sources?: unknown[] } | null;
    if ((record?.formatVersion ?? 0) > FORMAT_VERSION) return { sources: [], problem: `The sources record was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    if (record?.formatVersion === FORMAT_VERSION && Array.isArray(record.sources) && record.sources.every(isRecord)) return { sources: record.sources };
  } catch { /* said below */ }
  return { sources: [], problem: `The sources record is damaged. ${NOTHING_CHANGED}` };
}
export const saveSources = (home: string, sources: SourceRecord[]) => writeDurably(recordPath(home), `${JSON.stringify({ formatVersion: FORMAT_VERSION, sources }, null, 2)}\n`);

/** Each recorded source's link, by its id: the one place an item's `source` is read as linked or not (an id not here is not linked). */
export const sourceLinks = async (home: string) => new Map((await readSources(home)).sources.map(source => [source.id, source.link]));
