// Instructions: each tool's own instruction file, with who reads it, a plain editor, a diff before saving and earlier versions
// (INS-01, INS-02). There is no turn-off switch: instruction files are edited, never disabled, deleted or emptied by Central Knot.
import { announce, machine, draftFile, draftUnsaved, harnessTabShown, loadInstructionVersion, saveInstructionText, rerender, shownPath, startInstructionEdit, state } from './app.ts';
import { toolNames } from './words.ts';
import { fileName, plural } from './model.ts';
import { button, cardGrid, h, icon, pathText, rereadBand } from './dom.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import { noToolsState } from './pages.ts';
import type { HarnessId, InstructionFile } from './types.ts';
import { folded, lineDiff } from './diff.ts';
export { lineDiff } from './diff.ts';

const names = toolNames as Record<string, string>;

/** In a changed line (a removed line next to an added one), the words that differ get a stronger tint. */
function words(line: { kind: string; text: string }, diff: { kind: string; text: string }[]): (string | Node)[] {
  if (line.kind === 'same') return [line.text];
  const index = diff.indexOf(line as never);
  const partner = line.kind === 'removed' ? diff[index + 1] : diff[index - 1];
  if (!partner || partner.kind === line.kind || partner.kind === 'same') return [line.text];
  const mine = line.text.split(/(\s+)/), theirs = partner.text.split(/(\s+)/);
  const parts = line.kind === 'removed' ? lineDiff(mine.join('\n'), theirs.join('\n')) : lineDiff(theirs.join('\n'), mine.join('\n'));
  const keep = line.kind === 'removed' ? 'removed' : 'added';
  return parts.filter(part => part.kind === 'same' || part.kind === keep).map(part => part.kind === 'same' ? part.text : h('span.ins-word', {}, part.text));
}
const ago = (at: string) => {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};

const keys = `Esc to cancel · ${machine.modifierKey}+Enter to review`;

// In the review, Esc goes back to editing.
document.addEventListener('keydown', event => {
  const edit = state.instructionEdit;
  // Only where the editor is on screen: Instructions, or a harness's Instructions tab.
  const shown = state.page === 'instructions' || (harnessTabShown() === 'instructions' && edit?.tool === state.harness);
  if (event.key !== 'Escape' || !shown || edit?.stage !== 'review') return;
  event.preventDefault();
  if (edit.restoring) state.instructionEdit = undefined; else edit.stage = 'edit';
  rerender();
});

function editor(file: InstructionFile) {
  const edit = state.instructionEdit!;
  const name = fileName(file.path);
  if (edit.stage === 'review') {
    const diff = lineDiff(file.text, edit.text);
    // A removed line followed by an added one is a changed line, as the person sees their edit.
    let added = 0, removed = 0, altered = 0;
    for (let index = 0; index < diff.length;) {
      let r = 0, a = 0;
      while (diff[index]?.kind === 'removed') { r++; index++; }
      while (diff[index]?.kind === 'added') { a++; index++; }
      if (!r && !a) { index++; continue; }
      altered += Math.min(r, a); removed += r - Math.min(r, a); added += a - Math.min(r, a);
    }
    // An edit that only adds or removes the final line break is still a change, and says so.
    const onlyBreak = !(added + removed + altered) && edit.text !== file.text;
    const changed = added + removed + altered + (onlyBreak ? 1 : 0);
    const counts = [altered ? `${plural(altered, 'line')} changed` : '', added ? `${plural(added, 'line')} added` : '', removed ? `${plural(removed, 'line')} removed` : ''].filter(Boolean).join(', ');
    const title = !changed ? 'Nothing changed.'
      : onlyBreak ? `Review before saving ${name}: the final line break is ${edit.text.endsWith('\n') ? 'added' : 'removed'}.`
      : !file.exists ? `Review before creating ${name}: ${counts}.`
      : edit.restoring ? `Going back to an earlier version of ${name}: ${counts}.`
      : `Review before saving ${name}: ${counts}.`;
    const empties = changed && file.text.trim() && !edit.text.trim();
    return h('div.ins-editor', {},
      h('p.ins-review-title', {}, title),
      empties ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `This leaves ${name} empty. ${names[file.tool]} will start sessions with no instructions from it.`)) : null,
      edit.conflict ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `${name} changed outside Central Knot. Your draft is kept; this review now compares it with the file as it is now.`)) : null,
      h('pre.ins-diff', { tabindex: '0', 'aria-label': 'Changes' }, folded(diff, !!edit.fullDiff).map(line => line.kind === 'fold'
        ? h('button.ins-fold', { type: 'button', onclick: () => { edit.fullDiff = true; rerender(); } }, `… ${plural(line.count, 'unchanged line')} · show`)
        : h(`span.ins-line.ins-${line.kind}`, {},
          h('span.ins-mark', { 'aria-hidden': 'true' }, line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''),
          h('span.ins-code', {}, ...words(line, diff), '\n')))),
      h('div.ins-actions', { id: `ins-actions-${file.tool}` },
        button({ variant: 'primary', size: 'small', label: edit.restoring ? 'Restore this version' : file.exists ? `Save ${name}` : `Create ${name}`, id: `ins-save-${file.tool}`, disabled: !!state.busy || !changed, onclick: () => void saveInstructionText(file, edit.text) }),
        button({ variant: 'ghost', size: 'small', label: edit.restoring ? 'Cancel' : 'Back to editing', id: `ins-back-${file.tool}`, onclick: () => { if (edit.restoring) state.instructionEdit = undefined; else edit.stage = 'edit'; rerender(); } }),
        edit.restoring ? null : edit.confirmDiscard
          ? h('span.ins-confirm', {}, h('span.ins-confirm-text', {}, `Discard your changes to ${name}?`),
            button({ variant: 'outline', size: 'small', label: 'Discard', id: `ins-review-discard-yes-${file.tool}`, onclick: () => { state.instructionEdit = undefined; rerender(); } }),
            button({ variant: 'ghost', size: 'small', label: 'Keep reviewing', id: `ins-review-keep-${file.tool}`, onclick: () => { edit.confirmDiscard = false; rerender(); } }))
          : button({ variant: 'ghost', size: 'small', label: 'Discard changes', id: `ins-review-discard-${file.tool}`, onclick: () => { edit.confirmDiscard = true; rerender(); } })));
  }
  const area = h('textarea.ins-text', { id: `ins-text-${file.tool}`, spellcheck: 'false', 'aria-label': `Edit ${name}`,
    placeholder: `Write what ${names[file.tool]} should always know, in Markdown. For example:\n# How I like to work\n- Explain changes before making them`,
    oninput: (event: Event) => {
      edit.text = (event.target as HTMLTextAreaElement).value; edit.confirmDiscard = false;
      // Said as you type, without redrawing the editor: the pill and Review follow whether the text differs.
      const changed = edit.text !== file.text;
      const review = document.getElementById(`ins-review-${file.tool}`) as HTMLButtonElement | null;
      if (review) review.disabled = !changed;
      document.getElementById(`ins-draft-${file.tool}`)?.toggleAttribute('hidden', !changed);
      const hint = document.getElementById(`ins-hint-${file.tool}`);
      if (hint) hint.textContent = changed ? keys : file.exists ? 'Make a change to review it.' : 'Write something to review it.';
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); document.getElementById(`ins-cancel-${file.tool}`)?.click(); }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && edit.text !== file.text) { event.preventDefault(); edit.stage = 'review'; rerender(); }
    } }) as HTMLTextAreaElement;
  area.value = edit.text;
  area.rows = edit.text ? Math.min(30, Math.max(8, edit.text.split('\n').length + 3)) : 6;
  if (!file.text) area.classList.add('ins-text-new');
  const dirty = () => edit.text !== file.text;
  const actions = edit.confirmDiscard
    ? h('div.ins-actions.ins-confirm', { id: `ins-actions-${file.tool}`, role: 'group', 'aria-label': 'Discard changes?' },
      h('span.ins-confirm-text', {}, `Discard your changes to ${name}?`),
      button({ variant: 'outline', size: 'small', label: 'Discard', id: `ins-discard-${file.tool}`, onclick: () => { state.instructionEdit = undefined; rerender(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Keep editing', id: `ins-keep-${file.tool}`, onclick: () => { edit.confirmDiscard = false; rerender(); document.getElementById(`ins-text-${file.tool}`)?.focus(); } }))
    : h('div.ins-actions', { id: `ins-actions-${file.tool}` },
      button({ variant: 'primary', size: 'small', label: file.exists ? 'Review changes' : 'Review new file', id: `ins-review-${file.tool}`, disabled: !dirty(), onclick: () => { edit.stage = 'review'; rerender(); document.getElementById(`ins-save-${file.tool}`)?.focus(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: `ins-cancel-${file.tool}`, onclick: () => { if (dirty()) edit.confirmDiscard = true; else state.instructionEdit = undefined; rerender(); } }),
      h('span.ins-locked', { id: `ins-hint-${file.tool}` }, dirty() ? keys : file.exists ? 'Make a change to review it.' : 'Write something to review it.'));
  return h('div.ins-editor', {},
    file.exists ? null : h('p.ins-empty', {}, `New file: saving creates ${name} here.`),
    area, actions);
}

/** Cards whose whole file is shown, for reading without editing. */
const open = new Set<string>();

/** This card's last save, shown on the card itself so nothing on the page moves; its Undo stays while other cards are edited. */
const savedHere = (file: InstructionFile) => draftFile() !== file && state.outcome?.page === state.page && state.outcome.item === fileName(file.path) && state.outcome.kind === 'saved';

/**
 * One tool's file: shown on Instructions for every tool, and on that tool's Harnesses page. `titled`: false on a harness's
 * page, where the header already names the tool, so the card leads with the file's path. `goToOther`: where the open
 * draft's own card is on another page (another harness's), a link goes there.
 */
export function instructionCard(file: InstructionFile, { titled = true, goToOther }: { titled?: boolean; goToOther?: (tool: HarnessId) => void } = {}) {
  const editing = draftFile() === file;
  // An open editor with no changes locks nothing: Edit elsewhere just moves to that file. A changed one asks first.
  const otherDirty = !editing && draftUnsaved();
  const readOnly = !!state.home && !state.home.manage.access.allowed;
  const lockedWhy = readOnly ? 'Saving is off in this home.' : !otherDirty ? undefined
    : draftFile() ? `Finish or cancel the ${fileName(state.instructionEdit!.from.path)} edit first.` : 'Copy or discard the unsaved draft above first.';
  const preview = file.text.replace(/\n$/, '').split('\n');
  return h('article.card.ins-card', { 'aria-label': `${names[file.tool]} instructions` },
    h('header.ins-head', {}, titled ? [brandMark(file.tool, 18), h('h2.tool-title', {}, names[file.tool])] : null, pathText(shownPath(file.path), file.path),
      file.exists || editing ? null : h('span.ins-missing', {}, 'No file yet'),
      savedHere(file) ? h('span.ins-saved-group', {}, h('span.ins-missing.ins-saved', {}, 'Saved'),
        state.outcome!.act ? button({ variant: 'link', size: 'micro', label: 'Undo save', id: state.outcome!.act.id, attrs: { title: 'Put back the text this save replaced' }, onclick: () => state.outcome!.act!.run() }) : null) : null,
      editing ? h('span.ins-missing.ins-draft', { id: `ins-draft-${file.tool}`, hidden: state.instructionEdit!.text === file.text }, 'Unsaved changes') : null),
    h('p.ins-readers', {}, file.readers),
    file.notes.map(note => h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, note))),
    editing ? editor(file)
      : h('div.ins-body', {},
        file.exists && file.text.trim() ? [h('pre.ins-preview', { tabindex: '0', 'aria-label': `${fileName(file.path)} contents` }, open.has(file.tool) ? preview.join('\n') : preview.slice(0, 14).join('\n')),
          preview.length > 14 ? button({ variant: 'link', size: 'micro', label: open.has(file.tool) ? 'Show less' : `Show all ${preview.length} lines`, id: `ins-more-${file.tool}`, onclick: () => { if (open.has(file.tool)) open.delete(file.tool); else open.add(file.tool); rerender(); } }) : null]
          : file.exists ? h('p.ins-empty', {}, 'The file is empty.') : null,
        h('div.ins-actions', {},
          button({ variant: 'outline', size: 'small', label: file.exists ? 'Edit' : 'Write instructions', id: `ins-edit-${file.tool}`, disabled: !!state.busy || readOnly || otherDirty || editing, attrs: lockedWhy ? { title: lockedWhy, 'aria-description': lockedWhy } : undefined, onclick: () => {
            const open = state.instructionEdit;
            // Typed since the page was drawn: ask on that editor rather than drop the draft.
            if (open && draftUnsaved() && draftFile()) { open.confirmDiscard = true; open.stage = 'edit'; rerender(); return; }
            startInstructionEdit(file);
          } }),
          lockedWhy ? h('span.ins-locked', {}, lockedWhy,
            otherDirty && goToOther && draftFile() ? [' ', button({ variant: 'link', size: 'micro', label: `Go to ${names[draftFile()!.tool]}’s file`, id: `ins-go-${draftFile()!.tool}`, disabled: !!state.busy, onclick: () => goToOther(draftFile()!.tool) })] : null) : null)),
    file.versions.length ? h('details.ins-versions', {}, h('summary', {}, icon('chevron-right', 12, 'tone-faint'), `Earlier versions (${file.versions.length})`),
      h('ul.plain-list', {}, file.versions.slice(0, 20).map(version => h('li.ins-version', {},
        h('span', {}, new Date(version.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), h('span.tone-faint', {}, ` (${ago(version.at)}) · ${version.differs ? `${version.differs} ${version.differs === 1 ? 'line differs' : 'lines differ'} from now` : 'same as now'}`)),
        button({ variant: 'link', size: 'micro', label: 'Restore…', id: `ins-load-${file.tool}-${version.id}`, disabled: !!state.busy || readOnly || otherDirty || (editing && draftUnsaved()), attrs: lockedWhy || editing ? { title: editing ? 'Finish or cancel this edit first.' : lockedWhy } : undefined, onclick: () => void loadInstructionVersion(file, version.id) }))))) : null);
}

/**
 * A draft with unsaved changes whose file is no longer on the page (its tool left this home, or another home is open):
 * it can't be saved here, so it is offered to copy or to discard, and it stays until one of them.
 */
function orphanDraft() {
  const edit = state.instructionEdit;
  if (!edit || draftFile() || !draftUnsaved()) return null;
  const name = fileName(edit.from.path);
  const why = edit.from.home === state.home?.home ? `${names[edit.tool]} is no longer in this home` : 'it was opened in another home';
  return h('div.band.ins-orphan', { role: 'status', id: 'ins-orphan' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text', {}, `Your unsaved draft of ${name} can’t be saved here: ${why}. Copy it to keep it, or discard it.`),
    button({ variant: 'outline', size: 'small', icon: 'copy', label: 'Copy draft', id: 'ins-orphan-copy',
      onclick: () => void navigator.clipboard.writeText(edit.text).then(() => announce(`Copied your draft of ${name}.`), () => announce('Could not copy the draft.')) }),
    button({ variant: 'ghost', size: 'small', label: 'Discard draft', id: 'ins-orphan-discard', onclick: () => { state.instructionEdit = undefined; rerender(); } }));
}

/** Shown while the files are not here yet: their read is under way, or it failed (Refresh reads again). */
export const instructionsNotRead = (): HTMLElement => h('p.empty', {}, state.instructions.state === 'failed' ? 'Instruction files could not be read.' : 'Reading instruction files…');

/** The bands above instruction cards: a re-read under way, an orphaned draft, the last result (a save's own result sits on its card instead) and, where saving is off, why. */
export function instructionBands(): HTMLElement | null {
  const done = state.outcome?.kind === 'saved' ? null : outcomeBand();
  const access = state.home?.manage.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, 'Preview only: you can read these files here, but saving is off in this home.')) : null;
  const orphan = orphanDraft();
  const reread = rereadBand(state.instructions);
  return done || preview || orphan || reread ? h('div.bands', {}, reread, orphan, done, preview) : null;
}

export function instructionsPage() {
  // From the files' own read (pagedata.ts): what it found, else that it is reading or could not read.
  const files = state.instructions.data;
  if (!files) return h('div.page', {}, h('div.scroll', {}, instructionsNotRead()));
  if (!files.length) return h('div.page', {}, noToolsState('instructions-choose-home'));
  return h('div.page', {}, instructionBands(),
    h('div.scroll.cards-scroll', { id: 'instructions-scroll' },
      h('p.tools-note', {}, icon('info', 14, 'tone-muted'), 'Each tool reads its own file when a session starts. Changes are reviewed before saving, and earlier versions are kept on each card. Automatic sync leaves these files alone.'),
      cardGrid(files.map(file => instructionCard(file)))));
}
