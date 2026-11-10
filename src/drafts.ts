// An Instructions draft and the one rule for replacing it. Kept apart from the page so the rule can be tested on its own.
import type { HarnessId } from './types.ts';

/**
 * The one instruction file being edited: the text so far, and `from`, the file as it was opened (its home, path and
 * text), kept apart from the page's list of files so the draft is still known if that file's tool leaves the home.
 * `hash` is what a save checks the file against; it moves on when the file changed outside and the draft is kept.
 */
export interface InstructionDraft {
  tool: HarnessId;
  from: { home: string; path: string; text: string };
  text: string;
  hash: string;
  stage: 'edit' | 'review';
  restoring?: boolean;
  confirmDiscard?: boolean;
  conflict?: boolean;
  fullDiff?: boolean;
}

/** A draft holds changes not saved anywhere. */
export const unsaved = (draft: InstructionDraft | undefined): boolean => !!draft && draft.text !== draft.from.text;

/** The draft to have open when `next` is asked for: `next`, unless the open one holds unsaved changes, which then stays. */
export const nextDraft = (open: InstructionDraft | undefined, next: InstructionDraft): { draft: InstructionDraft | undefined; refused: boolean } =>
  (unsaved(open) ? { draft: open, refused: true } : { draft: next, refused: false });
