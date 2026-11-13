// Instructions: each tool's own instruction file, with who reads it, a plain editor, a diff before saving and earlier versions
// (INS-01, INS-02). There is no turn-off switch: instruction files are edited, never disabled or emptied by Central Knot (the one
// deletion is an Undo of a base save removing a file that save created, while unchanged).
import { announce, baseDraftTyped, draftFile, draftUnsaved, harnessTabShown, savingOff, loadInstructionVersion, ownText, saveInstructionText, rerender, shownPath, startInstructionEdit, state } from './app.ts';
import { baseCard, baseStrip } from './basecard.ts';
import { changeCounts, diffView, discardConfirm, escapeTo, keepCaret, keys, legend, previewBlock, versionsList } from './editparts.ts';
import { fileName, lineCount, toolNames } from './words.ts';
import { button, cardGrid, h, icon, lockAttrs, pathText, rereadBand } from './dom.ts';
import { noToolsState } from './pages.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import type { HarnessId, InstructionFile } from './types.ts';
import { lineDiff } from './diff.ts';
export { lineDiff } from './diff.ts';


/** Leaves a tool's review: back to its editor (focus in the text), or, for an earlier version, closed (focus on its Edit). */
function leaveReview(tool: string) {
  const edit = state.instructionEdit;
  if (!edit) return;
  if (edit.restoring) state.instructionEdit = undefined; else Object.assign(edit, { stage: 'edit', confirmDiscard: false });
  rerender();
  document.getElementById(edit.restoring ? `ins-edit-${tool}` : `ins-text-${tool}`)?.focus();
}

// In the review, Esc goes back to editing.
document.addEventListener('keydown', event => {
  const edit = state.instructionEdit;
  // Only where the editor is on screen: Instructions, or a harness's Instructions tab.
  const shown = state.page === 'instructions' || (harnessTabShown() === 'instructions' && edit?.tool === state.harness);
  if (event.key !== 'Escape' || !shown || edit?.stage !== 'review') return;
  event.preventDefault();
  leaveReview(edit.tool);
});

function editor(file: InstructionFile) {
  const edit = state.instructionEdit!;
  const name = fileName(file.path);
  // With the base, the editor holds this tool's own text; the base block stays as it is. Restoring compares whole files.
  const original = edit.restoring ? file.text : ownText(file);
  if (edit.stage === 'review') {
    const diff = lineDiff(original, edit.text);
    const { total, text: counts } = changeCounts(diff);
    // An edit that only adds or removes the final line break is still a change, and says so.
    const onlyBreak = !total && edit.text !== original;
    const changed = total + (onlyBreak ? 1 : 0);
    const title = !changed ? 'Nothing changed.'
      : onlyBreak ? `Review before saving ${name}: the final line break is ${edit.text.endsWith('\n') ? 'added' : 'removed'}.`
      : !file.exists ? `Review before creating ${name}: ${counts}.`
      : edit.takeOut ? `Take the base block out of ${name}: ${counts}.`
      : edit.restoring ? `Going back to an earlier version of ${name}: ${counts}.`
      : `Review before saving ${name}: ${counts}.`;
    const empties = changed && original.trim() && !edit.text.trim() && !file.base?.copy?.trim();
    return h('div.ins-editor', {},
      h('p.ins-review-title', {}, title),
      edit.takeOut ? h('p.base-explain', {}, `${toolNames[file.tool]}’s own instructions stay; the earlier text is kept under Earlier versions.`)
        : edit.restoring && file.base ? h('p.base-explain', {}, `This restores the whole file, including its base instructions as they were then. The base itself and the other tools’ files stay as they are.`) : null,
      empties ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `This leaves ${name} empty. ${toolNames[file.tool]} will start sessions with no instructions from it.`)) : null,
      edit.conflict ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `${name} changed outside Central Knot. Your draft is kept; this review now compares it with the file as it is now.`)) : null,
      legend(`${name} now`, edit.restoring && !edit.takeOut ? 'the earlier version' : 'after saving'),
      diffView(diff, !!edit.fullDiff, () => { edit.fullDiff = true; rerender(); }),
      // While the discard question is open it is the only decision on screen.
      edit.confirmDiscard
        ? h('div.ins-actions', { id: `ins-actions-${file.tool}` }, discardConfirm(name, { discard: `ins-review-discard-yes-${file.tool}`, keep: `ins-review-keep-${file.tool}` }, 'Keep reviewing',
          { run: () => { state.instructionEdit = undefined; }, focus: `ins-edit-${file.tool}` }, { run: () => { edit.confirmDiscard = false; }, focus: `ins-save-${file.tool}` }))
        : h('div.ins-actions', { id: `ins-actions-${file.tool}` },
          button({ variant: 'primary', size: 'small', label: edit.takeOut ? 'Take the block out' : edit.restoring ? 'Restore this version' : file.exists ? `Save ${name}` : `Create ${name}`, id: `ins-save-${file.tool}`, disabled: !!state.busy || !changed, onclick: () => void saveInstructionText(file, edit.text) }),
          button({ variant: 'ghost', size: 'small', label: edit.restoring ? 'Cancel' : 'Back to editing', id: `ins-back-${file.tool}`, onclick: () => leaveReview(file.tool) }),
          edit.restoring ? null : button({ variant: 'ghost', size: 'small', label: 'Discard changes', id: `ins-review-discard-${file.tool}`, onclick: () => { edit.confirmDiscard = true; rerender(); document.getElementById(`ins-review-keep-${file.tool}`)?.focus(); } })));
  }
  const area = h('textarea.ins-text', { id: `ins-text-${file.tool}`, spellcheck: 'false', 'aria-label': `Edit ${name}`,
    placeholder: file.base ? `Write what only ${toolNames[file.tool]} should know (the base instructions stay after it). For example:\n# Only for ${toolNames[file.tool]}\n- …`
      : `Write what ${toolNames[file.tool]} should always know, in Markdown. For example:\n# How I like to work\n- Explain changes before making them`,
    oninput: (event: Event) => {
      const target = event.target as HTMLTextAreaElement;
      edit.text = target.value;
      if (edit.confirmDiscard) { edit.confirmDiscard = false; keepCaret(`ins-text-${file.tool}`, target.selectionStart, rerender); return; }
      // Said as you type, without redrawing the editor: the pill and Review follow whether the text differs.
      const changed = draftUnsaved();
      const review = document.getElementById(`ins-review-${file.tool}`) as HTMLButtonElement | null;
      if (review) review.disabled = !changed;
      document.getElementById(`ins-draft-${file.tool}`)?.toggleAttribute('hidden', !changed);
      const hint = document.getElementById(`ins-hint-${file.tool}`);
      if (hint) hint.textContent = changed ? keys : file.exists ? 'Make a change to review it.' : 'Write something to review it.';
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && draftUnsaved()) { event.preventDefault(); edit.stage = 'review'; rerender(); document.getElementById(`ins-save-${file.tool}`)?.focus(); }
    } }) as HTMLTextAreaElement;
  area.value = edit.text;
  area.rows = edit.text ? Math.min(30, Math.max(8, lineCount(edit.text) + 3)) : 6;
  if (!original) area.classList.add('ins-text-new');
  const actions = edit.confirmDiscard
    ? h('div.ins-actions', { id: `ins-actions-${file.tool}` }, discardConfirm(name, { discard: `ins-discard-${file.tool}`, keep: `ins-keep-${file.tool}` }, 'Keep editing',
      { run: () => { state.instructionEdit = undefined; }, focus: `ins-edit-${file.tool}` }, { run: () => { edit.confirmDiscard = false; }, focus: `ins-text-${file.tool}` }))
    : h('div.ins-actions', { id: `ins-actions-${file.tool}` },
      button({ variant: 'primary', size: 'small', label: file.exists ? 'Review changes' : 'Review new file', id: `ins-review-${file.tool}`, disabled: !draftUnsaved(), onclick: () => { edit.stage = 'review'; rerender(); document.getElementById(`ins-save-${file.tool}`)?.focus(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: `ins-cancel-${file.tool}`, onclick: () => { const ask = draftUnsaved(); if (ask) edit.confirmDiscard = true; else state.instructionEdit = undefined; rerender(); document.getElementById(ask ? `ins-keep-${file.tool}` : `ins-edit-${file.tool}`)?.focus(); } }),
      h('span.ins-locked', { id: `ins-hint-${file.tool}` }, draftUnsaved() ? keys : file.exists ? 'Make a change to review it.' : 'Write something to review it.'));
  return h('div.ins-editor', { onkeydown: escapeTo(`ins-cancel-${file.tool}`, `ins-keep-${file.tool}`) },
    file.exists ? null : h('p.ins-empty', {}, `New file: saving creates ${name} here.`),
    file.base ? h('p.base-explain', {}, `${toolNames[file.tool]}’s own instructions. The base instructions stay after them, as they are.`) : null,
    area, actions);
}

/** This card's last save, shown on the card itself so nothing on the page moves; its Undo stays while other cards are edited. */
const savedHere = (file: InstructionFile) => draftFile() !== file && state.outcome?.page === state.page && state.outcome.tool === file.tool && state.outcome.kind === 'saved';

/**
 * One tool's file: shown on Instructions for every tool, and on that tool's Harnesses page. `titled`: false on a harness's
 * page, where the header already names the tool, so the card leads with the file's path. `goToOther`: where the open
 * draft's own card is on another page (another harness's), a link goes there.
 */
export function instructionCard(file: InstructionFile, { titled = true, goToOther }: { titled?: boolean; goToOther?: (tool: HarnessId) => void } = {}) {
  const editing = draftFile() === file;
  // An open editor with no changes locks nothing: Edit elsewhere just moves to that file. A changed one asks first.
  const toolDirty = !editing && draftUnsaved();
  const otherDirty = toolDirty || baseDraftTyped();
  const readOnly = savingOff();
  const lockedWhy = readOnly ? 'Saving is off in this home.' : baseDraftTyped() ? 'Finish or cancel the base instructions edit first.'
    : !toolDirty ? undefined : draftFile() ? `Finish or cancel the ${fileName(state.instructionEdit!.from.path)} edit first.` : 'Copy or discard the unsaved draft above first.';
  const own = ownText(file);
  return h('article.card.ins-card', { 'aria-label': `${toolNames[file.tool]} instructions` },
    h('header.ins-head', {}, titled ? [brandMark(file.tool, 18), h('h2.tool-title', {}, toolNames[file.tool])] : null, pathText(shownPath(file.path), file.path),
      file.exists || editing ? null : h('span.ins-missing', {}, 'No file yet'),
      savedHere(file) ? h('span.ins-saved-group', { 'data-outcome': '' }, h('span.ins-missing.ins-saved', {}, 'Saved'),
        state.outcome!.act ? button({ variant: 'link', size: 'micro', label: 'Undo save', id: state.outcome!.act.id, attrs: { title: 'Put back the text this save replaced' }, onclick: () => state.outcome!.act!.run() }) : null) : null,
      editing ? h('span.ins-missing.ins-draft', { id: `ins-draft-${file.tool}`, hidden: !draftUnsaved() }, 'Unsaved changes') : null),
    h('p.ins-readers', {}, file.readers),
    file.notes.map(note => h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, note))),
    editing ? [editor(file), baseStrip(file, 'Finish or cancel this edit first.')]
      : h('div.ins-body', {},
        file.exists && own.trim() ? previewBlock(own, file.tool, `${fileName(file.path)} contents`, `ins-more-${file.tool}`)
          : file.base?.copy !== undefined ? h('p.base-explain', {}, `No instructions of its own: ${toolNames[file.tool]} reads only the base instructions below.`)
          : file.exists ? h('p.ins-empty', {}, 'The file is empty.') : null,
        baseStrip(file, lockedWhy),
        h('div.ins-actions', {},
          button({ variant: 'outline', size: 'small', label: !file.exists ? 'Write instructions' : own.trim() || !file.base ? 'Edit' : 'Write its own instructions', id: `ins-edit-${file.tool}`, disabled: !!state.busy || readOnly || otherDirty || editing, attrs: lockAttrs(lockedWhy), onclick: () => startInstructionEdit(file) }),
          lockedWhy ? h('span.ins-locked', {}, lockedWhy,
            otherDirty && goToOther && draftFile() ? [' ', button({ variant: 'link', size: 'micro', label: `Go to ${toolNames[draftFile()!.tool]}’s file`, id: `ins-go-${draftFile()!.tool}`, disabled: !!state.busy, onclick: () => goToOther(draftFile()!.tool) })] : null) : null)),
    versionsList(file.versions, { id: version => `ins-load-${file.tool}-${version}`, disabled: !!state.busy || readOnly || otherDirty || (editing && draftUnsaved()),
      why: editing ? 'Finish or cancel this edit first.' : lockedWhy, run: version => void loadInstructionVersion(file, version) }));
}

/**
 * A draft with unsaved changes whose file is no longer on the page (its tool left this home, or another home is open):
 * it can't be saved here, so it is offered to copy or to discard, and it stays until one of them.
 */
function orphanDraft() {
  const edit = state.instructionEdit;
  if (!edit || draftFile() || !draftUnsaved()) return null;
  const name = fileName(edit.from.path);
  const why = edit.from.home === state.home?.home ? `${toolNames[edit.tool]} is no longer in this home` : 'it was opened in another home';
  return h('div.band.ins-orphan', { role: 'status', id: 'ins-orphan' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text', {}, `Your unsaved draft of ${name} can’t be saved here: ${why}. Copy it to keep it, or discard it.`),
    button({ variant: 'outline', size: 'small', icon: 'copy', label: 'Copy draft', id: 'ins-orphan-copy',
      onclick: () => void navigator.clipboard.writeText(edit.text).then(() => announce(`Copied your draft of ${name}.`), () => announce('Could not copy the draft.')) }),
    button({ variant: 'ghost', size: 'small', label: 'Discard draft', id: 'ins-orphan-discard', onclick: () => { state.instructionEdit = undefined; rerender(); } }));
}

export function instructionsPage() {
  // From the files' own read (pagedata.ts): what it found, else that it is reading or could not read.
  const files = state.instructions.data;
  if (!files) return h('div.page', {}, h('div.scroll', {}, instructionsNotRead()));
  if (!files.length) return h('div.page', {}, noToolsState('instructions'));
  return h('div.page', {}, instructionBands(),
    h('div.scroll.cards-scroll', { id: 'instructions-scroll' },
      h('p.tools-note', {}, icon('info', 14, 'tone-muted'), 'Each tool reads its own file when a session starts. Changes are reviewed before saving, and earlier versions are kept on each card. Automatic sync leaves these files alone; base instructions change them only when you save.'),
      baseCard(files),
      cardGrid(files.map(file => instructionCard(file)))));
}

/** Shown while the files are not here yet: their read is under way, or it failed (Refresh reads again). */
export const instructionsNotRead = (): HTMLElement => h('p.empty', {}, state.instructions.state === 'failed' ? 'Instruction files could not be read.' : 'Reading instruction files…');

/** The bands above instruction cards: a re-read under way, an orphaned draft, the last result (a save's own result sits on its card instead) and, where saving is off, why. */
export function instructionBands(): HTMLElement | null {
  const done = state.outcome?.kind === 'saved' ? null : outcomeBand();
  const access = state.home?.sync.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, 'Preview only: you can read these files here, but saving is off in this home.')) : null;
  const orphan = orphanDraft();
  const reread = rereadBand(state.instructions);
  return done || preview || orphan || reread ? h('div.bands', {}, reread, orphan, done, preview) : null;
}
