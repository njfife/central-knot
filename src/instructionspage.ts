// Instructions: each tool's own instruction file, with who reads it, a plain editor, a diff before saving and earlier versions
// (INS-01, INS-02). There is no turn-off switch: instruction files are edited, never disabled or emptied by Central Knot (the one
// deletion is an Undo of a base save removing a file that save created, while unchanged).
import { baseDraftTyped, savingOff, loadInstructionVersion, ownText, toolDraftTyped, saveInstructionText, rerender, shownPath, startInstructionEdit, state } from './app.ts';
import { baseCard, baseStrip } from './basecard.ts';
import { changeCounts, diffView, discardConfirm, keys, legend, previewBlock, versionsList } from './editparts.ts';
import { fileName, lineCount, toolNames } from './words.ts';
import { button, emptyState, h, icon, lockAttrs, pathText } from './dom.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import type { InstructionFile } from './types.ts';
import { lineDiff } from './diff.ts';
export { lineDiff } from './diff.ts';


/** Leaves a tool's review: back to its editor (focus in the text), or, for an earlier version, closed (focus on its Edit). */
function leaveReview(tool: string) {
  const edit = state.instructionEdit;
  if (!edit) return;
  if (edit.wholeFile) state.instructionEdit = undefined; else edit.stage = 'edit';
  rerender();
  document.getElementById(edit.wholeFile ? `ins-edit-${tool}` : `ins-text-${tool}`)?.focus();
}

// In the review, Esc goes back to editing.
document.addEventListener('keydown', event => {
  const edit = state.instructionEdit;
  if (event.key !== 'Escape' || state.page !== 'instructions' || edit?.stage !== 'review') return;
  event.preventDefault();
  leaveReview(edit.tool);
});

function editor(file: InstructionFile) {
  const edit = state.instructionEdit!;
  const name = fileName(file.path);
  // With the base, the editor holds this tool's own text; the base block stays as it is. Restoring compares whole files.
  const original = edit.wholeFile ? file.text : ownText(file);
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
      : edit.wholeFile ? `Going back to an earlier version of ${name}: ${counts}.`
      : `Review before saving ${name}: ${counts}.`;
    const empties = changed && original.trim() && !edit.text.trim() && !file.base?.copy?.trim();
    return h('div.ins-editor', {},
      h('p.ins-review-title', {}, title),
      edit.takeOut ? h('p.base-explain', {}, `${toolNames[file.tool]}’s own instructions stay; the earlier text is kept under Earlier versions.`)
        : edit.wholeFile && file.base ? h('p.base-explain', {}, `This restores the whole file, including its base instructions as they were then. The base itself and the other tools’ files stay as they are.`) : null,
      empties ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `This leaves ${name} empty. ${toolNames[file.tool]} will start sessions with no instructions from it.`)) : null,
      edit.conflict ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `${name} changed outside Central Knot. Your draft is kept; this review now compares it with the file as it is now.`)) : null,
      legend(`${name} now`, edit.wholeFile && !edit.takeOut ? 'the earlier version' : 'after saving'),
      diffView(diff, !!edit.fullDiff, () => { edit.fullDiff = true; rerender(); }),
      h('div.ins-actions', { id: `ins-actions-${file.tool}` },
        button({ variant: 'primary', size: 'small', label: edit.takeOut ? 'Take the block out' : edit.wholeFile ? 'Restore this version' : file.exists ? `Save ${name}` : `Create ${name}`, id: `ins-save-${file.tool}`, disabled: !!state.busy || !changed, onclick: () => void saveInstructionText(file, edit.text) }),
        button({ variant: 'ghost', size: 'small', label: edit.wholeFile ? 'Cancel' : 'Back to editing', id: `ins-back-${file.tool}`, onclick: () => leaveReview(file.tool) }),
        edit.wholeFile ? null : edit.confirmDiscard
          ? discardConfirm(name, { discard: `ins-review-discard-yes-${file.tool}`, keep: `ins-review-keep-${file.tool}` }, 'Keep reviewing',
            { run: () => { state.instructionEdit = undefined; }, focus: `ins-edit-${file.tool}` }, { run: () => { edit.confirmDiscard = false; }, focus: `ins-save-${file.tool}` })
          : button({ variant: 'ghost', size: 'small', label: 'Discard changes', id: `ins-review-discard-${file.tool}`, onclick: () => { edit.confirmDiscard = true; rerender(); document.getElementById(`ins-review-keep-${file.tool}`)?.focus(); } })));
  }
  const area = h('textarea.ins-text', { id: `ins-text-${file.tool}`, spellcheck: 'false', 'aria-label': `Edit ${name}`,
    placeholder: `Write what ${toolNames[file.tool]} should always know, in Markdown. For example:\n# How I like to work\n- Explain changes before making them`,
    oninput: (event: Event) => {
      edit.text = (event.target as HTMLTextAreaElement).value; edit.confirmDiscard = false;
      // Said as you type, without redrawing the editor: the pill and Review follow whether the text differs.
      const changed = edit.text !== original;
      const review = document.getElementById(`ins-review-${file.tool}`) as HTMLButtonElement | null;
      if (review) review.disabled = !changed;
      document.getElementById(`ins-draft-${file.tool}`)?.toggleAttribute('hidden', !changed);
      const hint = document.getElementById(`ins-hint-${file.tool}`);
      if (hint) hint.textContent = changed ? keys : file.exists ? 'Make a change to review it.' : 'Write something to review it.';
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); document.getElementById(`ins-cancel-${file.tool}`)?.click(); }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && edit.text !== original) { event.preventDefault(); edit.stage = 'review'; rerender(); document.getElementById(`ins-save-${file.tool}`)?.focus(); }
    } }) as HTMLTextAreaElement;
  area.value = edit.text;
  area.rows = edit.text ? Math.min(30, Math.max(8, lineCount(edit.text) + 3)) : 6;
  if (!original) area.classList.add('ins-text-new');
  const dirty = () => edit.text !== original;
  const actions = edit.confirmDiscard
    ? h('div.ins-actions', { id: `ins-actions-${file.tool}` }, discardConfirm(name, { discard: `ins-discard-${file.tool}`, keep: `ins-keep-${file.tool}` }, 'Keep editing',
      { run: () => { state.instructionEdit = undefined; }, focus: `ins-edit-${file.tool}` }, { run: () => { edit.confirmDiscard = false; }, focus: `ins-text-${file.tool}` }))
    : h('div.ins-actions', { id: `ins-actions-${file.tool}` },
      button({ variant: 'primary', size: 'small', label: file.exists ? 'Review changes' : 'Review new file', id: `ins-review-${file.tool}`, disabled: !dirty(), onclick: () => { edit.stage = 'review'; rerender(); document.getElementById(`ins-save-${file.tool}`)?.focus(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: `ins-cancel-${file.tool}`, onclick: () => { const ask = dirty(); if (ask) edit.confirmDiscard = true; else state.instructionEdit = undefined; rerender(); document.getElementById(ask ? `ins-keep-${file.tool}` : `ins-edit-${file.tool}`)?.focus(); } }),
      h('span.ins-locked', { id: `ins-hint-${file.tool}` }, dirty() ? keys : file.exists ? 'Make a change to review it.' : 'Write something to review it.'));
  return h('div.ins-editor', {},
    file.exists ? null : h('p.ins-empty', {}, `New file: saving creates ${name} here.`),
    file.base ? h('p.base-explain', {}, `${toolNames[file.tool]}’s own instructions. The base instructions stay after them, as they are.`) : null,
    area, actions);
}

/** This card's last save, shown on the card itself so nothing on the page moves; its Undo stays while other cards are edited. */
const savedHere = (file: InstructionFile) => state.instructionEdit?.tool !== file.tool && state.outcome?.page === 'instructions' && state.outcome.tool === file.tool && state.outcome.kind === 'tool-save';

function card(file: InstructionFile) {
  const editing = state.instructionEdit?.tool === file.tool;
  const other = state.instructionEdit && !editing ? state.instructions?.find(entry => entry.tool === state.instructionEdit!.tool) : undefined;
  // An open editor with no changes locks nothing: Edit elsewhere just moves to that file. A changed one asks first.
  const otherDirty = (!!other && toolDraftTyped()) || baseDraftTyped();
  const readOnly = savingOff();
  const lockedWhy = readOnly ? 'Saving is off in this home.' : baseDraftTyped() ? 'Finish or cancel the base instructions edit first.' : otherDirty ? `Finish or cancel the ${fileName(other!.path)} edit first.` : undefined;
  const own = ownText(file);
  return h('article.card.ins-card', { 'aria-label': `${toolNames[file.tool]} instructions` },
    h('header.ins-head', {}, brandMark(file.tool, 18), h('h2.tool-title', {}, toolNames[file.tool]), pathText(shownPath(file.path), file.path),
      file.exists || editing ? null : h('span.ins-missing', {}, 'No file yet'),
      savedHere(file) ? h('span.ins-saved-group', {}, h('span.ins-missing.ins-saved', {}, 'Saved'),
        state.outcome!.act ? button({ variant: 'link', size: 'micro', label: 'Undo save', id: state.outcome!.act.id, attrs: { title: 'Put back the text this save replaced' }, onclick: () => state.outcome!.act!.run() }) : null) : null,
      editing ? h('span.ins-missing.ins-draft', { id: `ins-draft-${file.tool}`, hidden: state.instructionEdit!.text === own }, 'Unsaved changes') : null),
    h('p.ins-readers', {}, file.readers),
    file.notes.map(note => h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, note))),
    editing ? [editor(file), baseStrip(file, lockedWhy)]
      : h('div.ins-body', {},
        file.exists && own.trim() ? previewBlock(own, file.tool, `${fileName(file.path)} contents`, `ins-more-${file.tool}`)
          : file.base?.copy !== undefined ? h('p.base-explain', {}, `No instructions of its own: ${toolNames[file.tool]} reads only the base instructions below.`)
          : file.exists ? h('p.ins-empty', {}, 'The file is empty.') : null,
        baseStrip(file, lockedWhy),
        h('div.ins-actions', {},
          button({ variant: 'outline', size: 'small', label: !file.exists ? 'Write instructions' : own.trim() || !file.base ? 'Edit' : 'Write its own instructions', id: `ins-edit-${file.tool}`, disabled: !!state.busy || readOnly || otherDirty || (editing && !!state.instructionEdit), attrs: lockAttrs(lockedWhy), onclick: () => startInstructionEdit(file) }),
          lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null)),
    versionsList(file.versions, { id: version => `ins-load-${file.tool}-${version}`, disabled: !!state.busy || readOnly || otherDirty || (editing && toolDraftTyped()),
      why: editing ? 'Finish or cancel this edit first.' : lockedWhy, run: version => void loadInstructionVersion(file, version) }));
}

export function instructionsPage() {
  const files = state.instructions;
  if (!files) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading instruction files…' : 'Instruction files could not be read.')));
  const done = state.outcome?.kind === 'tool-save' ? null : outcomeBand();
  const access = state.home?.manage.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, 'Preview only: you can read these files here, but saving is off in this home.')) : null;
  return h('div.page', {}, done || preview ? h('div.bands', {}, done, preview) : null,
    h('div.scroll.cards-scroll.ins-scroll', { id: 'instructions-scroll' },
      h('p.tools-note', {}, icon('info', 14, 'tone-muted'), 'Each tool reads its own file when a session starts. Changes are reviewed before saving, and earlier versions are kept on each card. Automatic sync leaves these files alone; base instructions change them only when you save.'),
      files.length ? [baseCard(files), ...files.map(card)] : emptyState('pencil-line', 'No tools found', 'No tool folders were found in this home.')));
}
