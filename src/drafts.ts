// An Instructions draft, the one rule for replacing it, and the file's own line breaks kept through the editor. Kept apart from
// the page so the rules can be tested on their own.
import { lineDiff } from './diff.ts';
import type { HarnessId } from './types.ts';

/**
 * The one instruction file being edited: the text so far, and `from`, the file as it was opened (its home, path and
 * text: for an edit of a tool that gets the base, its own text only), kept apart from the page's list of files so the draft is still known if that file's tool leaves the home.
 * `hash` is what a save checks the file against; it moves on when the file changed outside and the draft is kept.
 */
export interface InstructionDraft {
  tool: HarnessId;
  from: { home: string; path: string; text: string };
  text: string;
  hash: string;
  stage: 'edit' | 'review';
  /** A whole file to put back: an earlier version, or (`takeOut`) the file without its base block. */
  restoring?: boolean;
  takeOut?: boolean;
  confirmDiscard?: boolean;
  conflict?: boolean;
  fullDiff?: boolean;
}

/** A draft holds changes not saved anywhere. */
export const unsaved = (draft: InstructionDraft | undefined): boolean => !!draft && draft.text !== draft.from.text;

/** The draft to have open when `next` is asked for: `next`, unless the open one holds unsaved changes, which then stays. */
export const nextDraft = (open: InstructionDraft | undefined, next: InstructionDraft): { draft: InstructionDraft | undefined; refused: boolean } =>
  (unsaved(open) ? { draft: open, refused: true } : { draft: next, refused: false });

/**
 * The editor's text (a text box holds each line break as \n) given back the line breaks of `original`, the text it opened: a
 * line still as it was keeps its own break, and a new or changed line takes the break most of the original's lines end with.
 * A text with no \r in it is given back as it is.
 */
export function keepLineBreaks(original: string, edited: string): string {
  if (!original.includes('\r')) return edited;
  const parts = original.split(/(\r\n|\r|\n)/);
  const texts = parts.filter((_, index) => index % 2 === 0), breaks = parts.filter((_, index) => index % 2 === 1);
  const usual = breaks.filter(end => end === '\r\n').length * 2 >= breaks.length ? '\r\n' : '\n';
  // Each edited line that is an original line unchanged, with that line's break.
  const kept: (string | undefined)[] = [];
  let from = 0, to = 0;
  for (const line of lineDiff(texts.join('\n'), edited)) {
    if (line.kind === 'same') kept[to++] = breaks[from++];
    else if (line.kind === 'removed') from++;
    else to++;
  }
  const lines = edited.split('\n');
  return lines.map((line, index) => (index < lines.length - 1 ? line + (kept[index] ?? usual) : line)).join('');
}
