// History: the log of what changed in a home, kept in `.central-knot/history.json`, newest last. Its writers: the library's
// pass for skills, MCP servers and agents, and skills.ts's Clear the switch (and its Undo) and Take over; profiles.ts and
// profilemigrate.ts; everything.ts; toolchoice.ts; gitrepo.ts (Pull, the base instructions' included). What an entry says and
// offers is each kind's own (historyactions.ts for the library's kinds and Synchronize everything, historypage.ts for the
// rest). History's days (Settings) are its only retention rule, applied on every read and by pruneHistory (main.ts, when the
// days are shortened); after a write, a deleted skill's versions older than those days go too (skillstore.ts pruneDeleted), so
// nothing History can no longer restore is kept for it.
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { DAY_MS, defaultHistoryDays } from './model.ts';
import { errorCode, readRecord, storeDirectory, syncsHere, writeAccess, writeDurably, type ShareContext } from './share.ts';
import { pruneDeleted } from './skillstore.ts';
import type { HistoryEvent, HistoryPrune } from './types.ts';

/** Now, as this home's context tells it (tests set it). */
export const clock = (context: ShareContext) => context.now?.() ?? Date.now();

const historyPath = (home: string) => join(storeDirectory(home), 'history.json');

/** The oldest moment History keeps: the days chosen in Settings back from now. */
export const historyCutoff = (context: ShareContext) => clock(context) - (context.historyDays ?? defaultHistoryDays) * DAY_MS;

/**
 * History, newest last, without entries older than its days. Applying the days on every read means that once they shorten,
 * no home's History offers what it can no longer restore. Unreadable History reads as empty; sync never depends on it.
 */
export async function readHistory(context: ShareContext): Promise<HistoryEvent[]> {
  let events: HistoryEvent[];
  try { const parsed = JSON.parse(await readFile(historyPath(context.home), 'utf8')); events = Array.isArray(parsed?.events) ? parsed.events : []; } catch { return []; }
  const cutoff = historyCutoff(context);
  return events.filter(entry => Date.parse(entry.at) >= cutoff);
}

/** Writes History as given (for marking an entry done alongside a new one). */
export const replaceHistory = (context: ShareContext, events: HistoryEvent[]) => saveHistory(context, events);

/** Adds entries to History. */
export async function appendHistory(context: ShareContext, events: HistoryEvent[]) {
  if (events.length) await saveHistory(context, [...await readHistory(context), ...events]);
}

/** Writes History. History that can't be read, or is not History, is moved aside, never overwritten: it may be recoverable by hand. */
async function writeHistory(home: string, events: HistoryEvent[]) {
  let sound = true;
  try { sound = Array.isArray(JSON.parse(await readFile(historyPath(home), 'utf8'))?.events); } catch (error) { sound = errorCode(error) === 'ENOENT'; }
  if (!sound) await rename(historyPath(home), join(storeDirectory(home), `history.unreadable-${Date.now()}.json`)).catch(() => undefined);
  await writeDurably(historyPath(home), `${JSON.stringify({ events }, null, 2)}\n`);
}

/** Every History write goes through here; in a home this build syncs and may write, a deleted skill's old versions go after it. */
async function saveHistory(context: ShareContext, events: HistoryEvent[]) {
  await writeHistory(context.home, events);
  if (await syncsHere(context)) await pruneDeleted(context, historyCutoff(context));
}

/**
 * Applies a shortened window to this home at once (Settings): History loses what is now older, and a deleted skill's versions
 * that only it kept go. Only in a home this build syncs and may write ('done'). Elsewhere the next History write there applies
 * it: this build's once it syncs the home ('later'), or, in a preview-only home or one another build syncs, that copy's ('elsewhere').
 */
export async function pruneHistory(context: ShareContext): Promise<Exclude<HistoryPrune, 'no-home' | 'failed'>> {
  if (!(await syncsHere(context))) {
    const { record } = await readRecord(context.home);
    return (await writeAccess(context)).allowed && (!record || record.owner === context.build) ? 'later' : 'elsewhere';
  }
  await saveHistory(context, await readHistory(context));
  return 'done';
}
