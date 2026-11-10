// Sending memories into a tool's own memory. Codex: one new note per memory in its notes inbox, which Codex takes in by
// itself the next time it updates its memory, in its own words. Nothing is overwritten and nothing is edited on the way.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { memoryView } from './memory.ts';
import { saveSent } from './memorysent.ts';
import { errorCode, plainError, writeAccess, type ShareContext } from './share.ts';
import type { MemoryNote, MemoryPick, MemorySendResult, MemoryTool, SentEntry, Snapshot } from './types.ts';

export const CHANGED = 'It changed since you looked. Refresh and look again.';

/** Codex's notes inbox inside its memory folder. */
export const notesFolder = (memoryFolder: string) => join(memoryFolder, 'extensions', 'ad_hoc', 'notes');

/** A title as Codex's note names want it: lowercase letters, digits and single dashes, starting with a letter or digit. */
export const noteSlug = (title: string) => title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'memory';

/** `2026-11-10T20-31-05-small-pull-requests.md` in UTC, Codex's own pattern; `n` above 0 adds `-2`, `-3`… for a clash. */
export const noteName = (title: string, at: Date, n = 0) => `${at.toISOString().slice(0, 19).replace(/:/g, '-')}-${noteSlug(title)}${n ? `-${n + 1}` : ''}.md`;

/** The note's text: who carried it over and from where, then the memory's title and text. LF line ends, one final newline. */
export const noteText = (origin: string, title: string, text: string) =>
  `Remember this. Central Knot carried it over from ${origin} because the user asked.\n\n# ${title}\n\n${text.trim()}\n`;

/** Writes one new note, never over a file already there: a clash takes the next suffix. Returns its file name. */
async function writeNote(folder: string, note: MemoryNote, at: Date): Promise<string> {
  for (let n = 0; ; n++) {
    const name = noteName(note.title, at, n);
    try { await writeFile(join(folder, name), noteText(note.origin, note.title, note.text), { flag: 'wx' }); return name; }
    catch (error) { if (errorCode(error) !== 'EEXIST' || n > 998) throw error; }
  }
}

/**
 * Sends the picked memories, in order, into `tool`'s memory. Each is read again and sent only when its text still has the
 * hash the page showed. The first failure stops the run; what was written stays and is recorded, destination first.
 */
export async function sendMemories(context: ShareContext, snapshots: Snapshot[], tool: MemoryTool, picks: MemoryPick[], now = () => new Date()): Promise<MemorySendResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, sent: [], failed: [] };
  const view = await memoryView(context.home, snapshots);
  if (tool !== 'codex-cli' || !view.codex) return { stopped: 'Codex isn’t in this home. Nothing was sent.', sent: [], failed: [] };
  if (!view.codex.on) return { stopped: 'Codex’s memory is off on this computer. Nothing was sent.', sent: [], failed: [] };
  const notes = new Map((view.claude ?? []).flatMap(project => project.notes).map(note => [note.path, note]));
  const folder = notesFolder(view.codex.folder);
  const result: MemorySendResult = { sent: [], failed: [] };
  const recorded: SentEntry[] = [];
  let stopped = false;
  for (const pick of picks) {
    const note = notes.get(pick.path);
    const title = note?.title ?? pick.path.split(/[\\/]/).pop() ?? pick.path;
    if (stopped) { result.failed.push({ path: pick.path, title, why: 'Not tried after that.' }); continue; }
    if (pick.path === view.codex.summary?.path) { result.failed.push({ path: pick.path, title: 'Codex’s memory summary', why: 'Codex already has it.' }); continue; }
    if (!note || note.unreadable || note.hash !== pick.hash) { result.failed.push({ path: pick.path, title, why: CHANGED }); continue; }
    const at = now();
    try {
      await mkdir(folder, { recursive: true });
      const name = await writeNote(folder, note, at);
      result.sent.push(note.path);
      recorded.push({ source: note.path, to: tool, hash: note.hash, at: at.toISOString(), note: name });
    } catch (error) {
      result.failed.push({ path: pick.path, title, why: plainError(error) });
      stopped = true;
    }
  }
  if (recorded.length) await saveSent(context.home, recorded).catch(error => { result.unrecorded = plainError(error); });
  return result;
}
