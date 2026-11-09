// Instructions: each tool's own instruction file, with who reads it, a plain editor, a diff before saving and earlier versions
// (INS-01, INS-02). There is no turn-off switch: instruction files are edited, never disabled, deleted or emptied by Central Knot.
import { loadInstructionVersion, saveInstructionText, rerender, shownPath, startInstructionEdit, state } from './app.ts';
import { button, emptyState, h, icon, pathText } from './dom.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import type { InstructionFile } from './types.ts';

const names: Record<string, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A line diff, small and exact: unchanged, removed and added lines in order (longest common subsequence). */
export function lineDiff(before: string, after: string): { kind: 'same' | 'removed' | 'added'; text: string }[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n');
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const out: { kind: 'same' | 'removed' | 'added'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) out.push({ kind: 'removed', text: a[i++] });
    else out.push({ kind: 'added', text: b[j++] });
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) out.push({ kind: 'added', text: b[j++] });
  return out;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const ago = (at: string) => {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};

function editor(file: InstructionFile) {
  const edit = state.instructionEdit!;
  const name = fileName(file.path);
  if (edit.stage === 'review') {
    const diff = lineDiff(file.text, edit.text);
    const added = diff.filter(line => line.kind === 'added').length;
    const removed = diff.filter(line => line.kind === 'removed').length;
    const changed = added + removed;
    const counts = [added ? `${plural(added, 'line')} added` : '', removed ? `${plural(removed, 'line')} removed` : ''].filter(Boolean).join(', ');
    const title = !changed ? 'Nothing changed.'
      : edit.restoring ? `Review going back to the earlier version of ${name}: ${counts}.`
      : `Review before saving ${name}: ${counts}.`;
    const empties = changed && file.text.trim() && !edit.text.trim();
    return h('div.ins-editor', {},
      h('p.ins-review-title', {}, title),
      empties ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `This leaves ${name} empty. ${names[file.tool]} will start sessions with no instructions from it.`)) : null,
      h('pre.ins-diff', { tabindex: '0', 'aria-label': 'Changes' }, diff.map(line => h(`span.ins-line.ins-${line.kind}`, {},
        h('span.ins-mark', { 'aria-hidden': 'true' }, line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''),
        h('span.ins-code', {}, `${line.text}\n`)))),
      h('div.ins-actions', { id: `ins-actions-${file.tool}` },
        button({ variant: 'primary', size: 'small', label: file.exists ? `Save ${name}` : `Create ${name}`, id: `ins-save-${file.tool}`, disabled: !!state.busy || !changed, onclick: () => void saveInstructionText(file, edit.text) }),
        button({ variant: 'ghost', size: 'small', label: edit.restoring ? 'Cancel' : 'Back to editing', id: `ins-back-${file.tool}`, onclick: () => { if (edit.restoring) state.instructionEdit = undefined; else edit.stage = 'edit'; rerender(); } })));
  }
  const area = h('textarea.ins-text', { id: `ins-text-${file.tool}`, spellcheck: 'false', 'aria-label': `Edit ${name}`,
    placeholder: `Write what ${names[file.tool]} should always know, in Markdown. For example:\n# How I like to work\n- Explain changes before making them`,
    oninput: (event: Event) => { edit.text = (event.target as HTMLTextAreaElement).value; edit.confirmDiscard = false; } }) as HTMLTextAreaElement;
  area.value = edit.text;
  if (!file.text) area.classList.add('ins-text-new');
  const dirty = () => edit.text !== file.text;
  const actions = edit.confirmDiscard
    ? h('div.ins-actions.ins-confirm', { id: `ins-actions-${file.tool}`, role: 'group', 'aria-label': 'Discard changes?' },
      h('span.ins-confirm-text', {}, `Discard your changes to ${name}?`),
      button({ variant: 'outline', size: 'small', label: 'Discard', id: `ins-discard-${file.tool}`, onclick: () => { state.instructionEdit = undefined; rerender(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Keep editing', id: `ins-keep-${file.tool}`, onclick: () => { edit.confirmDiscard = false; rerender(); document.getElementById(`ins-text-${file.tool}`)?.focus(); } }))
    : h('div.ins-actions', { id: `ins-actions-${file.tool}` },
      button({ variant: 'primary', size: 'small', label: file.exists ? 'Review changes' : 'Review new file', id: `ins-review-${file.tool}`, onclick: () => { edit.stage = 'review'; rerender(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: `ins-cancel-${file.tool}`, onclick: () => { if (dirty()) edit.confirmDiscard = true; else state.instructionEdit = undefined; rerender(); } }));
  return h('div.ins-editor', {},
    file.exists ? null : h('p.ins-empty', {}, `New file: saving creates ${name} here.`),
    area, actions);
}

function card(file: InstructionFile) {
  const editing = state.instructionEdit?.tool === file.tool;
  const other = state.instructionEdit && !editing ? state.instructions?.find(entry => entry.tool === state.instructionEdit!.tool) : undefined;
  const lockedWhy = other ? `Finish or cancel the ${fileName(other.path)} edit first.` : undefined;
  const preview = file.text.replace(/\n$/, '').split('\n');
  return h('article.card.ins-card', { 'aria-label': `${names[file.tool]} instructions` },
    h('header.ins-head', {}, brandMark(file.tool, 18), h('h2.tool-title', {}, names[file.tool]), pathText(shownPath(file.path), file.path),
      file.exists ? null : h('span.ins-missing', {}, 'No file yet'),
      editing && state.instructionEdit!.text !== file.text ? h('span.ins-missing.ins-draft', {}, 'Unsaved changes') : null),
    h('p.ins-readers', {}, file.readers),
    file.notes.map(note => h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, note))),
    editing ? editor(file)
      : h('div.ins-body', {},
        file.exists && file.text.trim() ? h('pre.ins-preview', { tabindex: '0', 'aria-label': `${fileName(file.path)} contents` }, preview.slice(0, 14).join('\n') + (preview.length > 14 ? `\n… ${preview.length - 14} more lines` : ''))
          : h('p.ins-empty', {}, file.exists ? 'The file is empty.' : `Saving creates ${fileName(file.path)} here.`),
        h('div.ins-actions', {},
          button({ variant: 'outline', size: 'small', label: file.exists ? 'Edit' : 'Write instructions', id: `ins-edit-${file.tool}`, disabled: !!state.busy || !!state.instructionEdit, attrs: lockedWhy ? { title: lockedWhy, 'aria-description': lockedWhy } : undefined, onclick: () => startInstructionEdit(file) }),
          lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null)),
    file.versions.length ? h('details.ins-versions', {}, h('summary', {}, icon('chevron-right', 12, 'tone-faint'), `Earlier versions (${file.versions.length})`),
      h('ul.plain-list', {}, file.versions.slice(0, 20).map(version => h('li.ins-version', {},
        h('span', {}, 'Replaced by a save · ', new Date(version.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), h('span.tone-faint', {}, ` (${ago(version.at)})`)),
        button({ variant: 'link', size: 'micro', label: 'Review going back to this', id: `ins-load-${file.tool}-${version.id}`, disabled: !!state.busy || !!state.instructionEdit, attrs: state.instructionEdit ? { title: editing ? 'Finish or cancel this edit first.' : lockedWhy } : undefined, onclick: () => void loadInstructionVersion(file, version.id) }))))) : null);
}

export function instructionsPage() {
  const files = state.instructions;
  if (!files) return h('div.page', {}, h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading instruction files…' : 'Instruction files could not be read.')));
  const done = outcomeBand();
  const access = state.home?.manage.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, 'Preview only: you can read these files here, but saving is off in this home.')) : null;
  return h('div.page', {}, done || preview ? h('div.bands', {}, done, preview) : null,
    h('div.scroll.cards-scroll', { id: 'instructions-scroll' },
      h('p.tools-note', {}, icon('info', 14, 'tone-muted'), 'Each tool reads its own instruction file when a session starts, so a change takes effect in new sessions. Edit them here: you review the change before saving, and each save keeps the version it replaces. Instruction files are not synced between tools; automatic sync leaves them alone.'),
      files.length ? files.map(card) : emptyState('pencil-line', 'No tools found', 'No tool folders were found in this home.')));
}
