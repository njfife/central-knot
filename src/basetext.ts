// Base instructions inside a tool's own instruction file: one marked block, after that tool's own text.
// Everything outside the block is the tool's own text and is never rewritten here; only the block is added, replaced or taken out.
// (Adding a block after own text that has no final line break gives it one, so the block starts on its own line; and when a tool's
// own text is saved from its editor, own text someone put after the block moves before it.)
import type { BaseHeld, HarnessId } from './types.ts';

const START = '<!-- Central Knot base instructions: start (shared by your tools; edit them in Central Knot) -->';
const END = '<!-- Central Knot base instructions: end -->';
const isMarker = (line: string, which: 'start' | 'end') => line.trimStart().startsWith(`<!-- Central Knot base instructions: ${which}`);

/** Base text as a block holds it: ending in a line break. */
export const blockText = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);
const markedBlock = (base: string) => `${START}\n${blockText(base)}${END}\n`;

interface Located { before: string; copy: string; after: string }

/** Finds the block. A start marker with no end marker runs to the end of the file, so its text is never taken for the tool's own. */
function locate(text: string): Located | undefined {
  let offset = 0, start = -1, copyStart = 0;
  for (const line of text.split('\n')) {
    const next = offset + line.length + 1;
    if (start < 0 && isMarker(line, 'start')) { start = offset; copyStart = Math.min(next, text.length); }
    else if (start >= 0 && isMarker(line, 'end')) return { before: text.slice(0, start), copy: text.slice(copyStart, offset), after: text.slice(Math.min(next, text.length)) };
    offset = next;
  }
  return start < 0 ? undefined : { before: text.slice(0, start), copy: text.slice(copyStart), after: '' };
}

/** A file's own text and, if it has one, its copy of the base. */
export function splitBase(text: string): { own: string; copy?: string } {
  const found = locate(text);
  if (!found) return { own: text };
  // The blank line put before the block when it was added belongs to neither side.
  const before = found.before.endsWith('\n\n') ? found.before.slice(0, -1) : found.before;
  return { own: before + found.after, copy: found.copy };
}

/** Base text as compared: as a block holds it, with Windows line breaks read as plain ones (an editor re-saving a file with CRLF
 *  changes nothing anyone wrote). */
export const comparableBase = (text: string) => blockText(text.replace(/\r\n/g, '\n'));
/** Whether a file's copy says the same as this base (a missing final line break or CRLF line breaks don't count). */
export const sameBase = (copy: string | undefined, base: string) => copy !== undefined && comparableBase(copy) === comparableBase(base);

/** The file with this base in it: an existing block is replaced where it stands; otherwise the block goes after the own text. */
export function withBase(text: string, base: string): string {
  if (!base.trim()) return withoutBase(text);
  const found = locate(text);
  if (found) return found.before + markedBlock(base) + found.after;
  return text.trim() ? `${blockText(text)}\n${markedBlock(base)}` : markedBlock(base);
}

/** The file with its own text replaced and its block (if any) kept as it is, after the own text. */
export function withOwn(text: string, own: string): string {
  const found = locate(text);
  if (!found) return own;
  return own.trim() ? `${blockText(own)}\n${markedBlock(found.copy)}` : markedBlock(found.copy);
}

/** The file without the block. If nothing of its own would be left, the base text stays as plain text, so the file is never emptied. */
export function withoutBase(text: string): string {
  const { own, copy } = splitBase(text);
  if (copy === undefined) return text;
  return own.trim() ? own : blockText(copy);
}

/**
 * What one tool's file becomes when `base` is saved (a plan, not a write): the block added or replaced (`chosen`), or taken out (not chosen). `held`
 * is how the file holds the base now. A copy edited in the file is left as it is (`edited`), chosen or not, unless the action is
 * 'putBack'. 'adopt': this file's own text became the base, so it moves into the block; plain base text Central Knot left in the
 * file (`held.leftPlain`) moves back the same way, so it is never repeated. `own`: a draft sorted this file's own text into the
 * base and what stays only here, so its own text becomes that (a chosen file only: one not chosen keeps its own text). The
 * renderer previews with this and the main process writes with it, so the review shows what is written. `held` is judged
 * against the base as stored now, not `base`.
 */
export function fileWithBase(text: string, base: string, { chosen, held, action = 'save', own }: { chosen: boolean; held?: BaseHeld; action?: 'save' | 'adopt' | 'putBack'; own?: string }): { next: string } | { left: 'edited' } {
  const { copy } = splitBase(text);
  if (held?.state === 'edited' && !sameBase(copy, base) && action !== 'putBack') return { left: 'edited' };
  if (!chosen || !base.trim()) return { next: withoutBase(text) };
  // A draft's own text for this file is what it keeps. Otherwise, text that is (or was) the base moves into the block: what
  // the file had outside the block becomes nothing of its own.
  const ownAfter = own !== undefined ? own : action === 'adopt' || held?.leftPlain ? '' : undefined;
  return { next: withBase(ownAfter === undefined ? text : withOwn(text, ownAfter), base) };
}

/** A draft's own text for the file `readers` read: the one given for any of them. */
export const draftedOwn = (readers: HarnessId[], own: Partial<Record<HarnessId, string>> | undefined) => readers.map(reader => own?.[reader]).find(text => text !== undefined);

/** Every tool reading one physical file: the tool it is listed under, then the others linked to the same file. */
export const readersOfFile = (tool: HarnessId, sameFile: HarnessId[]) => [tool, ...sameFile];

/** What a save does to one physical file read by `readers`: its own text moves into the base ('adopt': the base started from it),
 *  its edited copy is replaced ('putBack'), or the base is simply saved there. */
export function baseAction(readers: HarnessId[], { adopt, overwrite }: { adopt?: HarnessId; overwrite?: HarnessId[] }): 'save' | 'adopt' | 'putBack' {
  if (adopt && readers.includes(adopt)) return 'adopt';
  return overwrite?.some(tool => readers.includes(tool)) ? 'putBack' : 'save';
}

/**
 * The lines of a file's own text that a draft carries nowhere word for word: neither in the base nor in what it kept for that
 * file. The tool that wrote the draft reworded them, merged them or left them out; a review shows them. Blank lines and
 * headings don't count: a heading says nothing by itself, and sorting moves lines under other headings.
 */
export function linesNotCarried(before: string, base: string, own: string): string[] {
  const carried = new Set(`${base}\n${own}`.split('\n').map(line => line.trim()));
  return before.split('\n').map(line => line.trim()).filter(line => line && !/^#{1,6}\s/.test(line) && !carried.has(line));
}
