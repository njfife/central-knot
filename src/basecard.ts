// Base instructions (INS-03, INS-04): one text, written once, that Central Knot keeps in each chosen tool's own instruction file,
// in a marked block after that tool's own instructions. A tool's own text is never rewritten. A copy edited in a tool's file is
// shown, never overwritten by itself: the person uses it as the base or puts the base back. Every save shows each file's change first.
import { applyBaseChange, loadBaseVersion, ownText, rerender, shownPath, startBaseEdit, state, type BaseEdit } from './app.ts';
import { sameBase, splitBase, withBase, withOwn, withoutBase } from './basetext.ts';
import { lineDiff } from './diff.ts';
import { button, checkbox, h, icon, pathText } from './dom.ts';
import { changeCounts, diffView, fileName } from './instructionspage.ts';
import { brandMark } from './matrix.ts';
import { andList, toolNames } from './words.ts';
import { plural } from './model.ts';
import type { HarnessId, InstructionFile } from './types.ts';

const names = toolNames as Record<string, string>;
/** Tool rows whose difference or file change is open. */
const shown = new Set<string>();
const toggle = (key: string) => { if (shown.has(key)) shown.delete(key); else shown.add(key); rerender(); };
const keys = `Esc to cancel · ${navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to review`;
// In the review, Esc goes back to editing; a review that started there (an edited copy, an earlier version) closes.
document.addEventListener('keydown', event => {
  const edit = state.baseEdit;
  if (event.key !== 'Escape' || state.page !== 'instructions' || edit?.stage !== 'review') return;
  event.preventDefault();
  if (edit.source?.kind === 'copy' || edit.source?.kind === 'version') state.baseEdit = undefined; else edit.stage = 'edit';
  rerender();
});
const lineCount = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0);

/** What saving the draft does to one tool's file: the new text, and a sentence saying so. Undefined: the file is not involved. */
function planFor(file: InstructionFile, edit: BaseEdit): { next: string; says: string } | undefined {
  const chosen = edit.tools.includes(file.tool) && !!edit.text.trim();
  const had = !!file.base;
  if (!chosen && !had) return undefined;
  const name = fileName(file.path);
  const copy = splitBase(file.text).copy;
  if (!chosen) {
    const next = withoutBase(file.text);
    return { next, says: splitBase(file.text).own.trim() ? 'The base instructions come out. Its own instructions stay.' : `The base instructions come out of their block and stay as plain text, so ${name} is not left empty.` };
  }
  if (file.base?.state === 'edited' && !sameBase(copy, edit.text) && edit.source?.tool !== file.tool) return { next: file.text, says: `Left as it is: its copy of the base was edited in ${name}. Choose what to do with it on this card after saving.` };
  const adopt = edit.source?.kind === 'own' && edit.source.tool === file.tool;
  const next = withBase(adopt ? withOwn(file.text, '') : file.text, edit.text);
  const own = ownText(file);
  const says = !file.exists ? `${name} is created, holding only the base instructions.`
    : next === file.text ? 'No change: it already has these base instructions.'
    : adopt ? (sameBase(own, edit.text) ? `Its instructions become the base, so ${name} says the same as now, inside the base block.` : `Its instructions become the base, as edited here.`)
    : copy === undefined ? (own.trim() ? `The base instructions go after its ${plural(lineCount(own), 'line')} of its own.` : 'The base instructions are added.')
    : 'Its copy of the base is updated. Its own instructions stay.';
  return { next, says };
}

/** The draft differs from what is saved, or comes from somewhere: saving it does something. */
const draftChanges = (edit: BaseEdit) => edit.text !== (state.base?.text ?? '') || edit.tools.join() !== (state.base?.tools ?? []).join() || !!edit.source;

function editView(files: InstructionFile[], edit: BaseEdit) {
  const empty = !edit.text.trim();
  const reviewable = () => draftChanges(edit) && !(empty && !state.base?.tools.length);
  const hint = () => (reviewable() ? keys : empty ? 'Write the base instructions to review them.' : 'Make a change to review it.');
  const area = h('textarea.ins-text', { id: 'base-text', spellcheck: 'false', 'aria-label': 'Edit the base instructions',
    placeholder: 'Write what every tool should know, in Markdown. For example:\n# How I like to work\n- Explain changes before making them',
    oninput: (event: Event) => {
      edit.text = (event.target as HTMLTextAreaElement).value; edit.confirmDiscard = false;
      // Said as you type, without redrawing the editor.
      const review = document.getElementById('base-review') as HTMLButtonElement | null;
      if (review) review.disabled = !reviewable();
      const line = document.getElementById('base-hint');
      if (line) line.textContent = hint();
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); document.getElementById('base-cancel')?.click(); }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && reviewable()) { event.preventDefault(); edit.stage = 'review'; rerender(); }
    } }) as HTMLTextAreaElement;
  area.value = edit.text;
  area.rows = Math.min(30, Math.max(6, lineCount(edit.text) + 3));
  const from = edit.source?.tool ? files.find(file => file.tool === edit.source!.tool) : undefined;
  return h('div.ins-editor', {},
    from && edit.source?.kind === 'own' ? h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, `Started from ${names[from.tool]}’s ${fileName(from.path)}. Its instructions move into the base, so the file keeps saying the same.`)) : null,
    area,
    h('fieldset.base-tools', {}, h('legend', {}, 'Add them after the own instructions of'),
      files.map(file => checkbox({ id: `base-tool-${file.tool}`, checked: edit.tools.includes(file.tool), onchange: checked => {
        edit.tools = files.map(entry => entry.tool).filter(tool => tool === file.tool ? checked : edit.tools.includes(tool));
        edit.confirmDiscard = false; rerender();
      } }, brandMark(file.tool, 14), h('span', {}, names[file.tool]), h('span.base-file', {}, fileName(file.path), file.exists ? '' : ' (created)')))),
    edit.confirmDiscard
      ? h('div.ins-actions.ins-confirm', { role: 'group', 'aria-label': 'Discard changes?' }, h('span.ins-confirm-text', {}, 'Discard your changes to the base instructions?'),
        button({ variant: 'outline', size: 'small', label: 'Discard', id: 'base-discard', onclick: () => { state.baseEdit = undefined; rerender(); } }),
        button({ variant: 'ghost', size: 'small', label: 'Keep editing', id: 'base-keep', onclick: () => { edit.confirmDiscard = false; rerender(); document.getElementById('base-text')?.focus(); } }))
      : h('div.ins-actions', {},
        button({ variant: 'primary', size: 'small', label: 'Review changes', id: 'base-review', disabled: !reviewable(), onclick: () => { edit.stage = 'review'; rerender(); document.getElementById('base-save')?.focus(); } }),
        button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'base-cancel', onclick: () => { if (draftChanges(edit)) edit.confirmDiscard = true; else state.baseEdit = undefined; rerender(); } }),
        h('span.ins-locked', { id: 'base-hint' }, hint())));
}

function reviewView(files: InstructionFile[], edit: BaseEdit) {
  const before = state.base?.text ?? '';
  const diff = lineDiff(before, edit.text);
  const { text: counts } = changeCounts(diff);
  const plans = files.map(file => ({ file, plan: planFor(file, edit) })).filter(entry => entry.plan);
  const writes = plans.filter(entry => entry.plan!.next !== entry.file.text);
  const from = edit.source?.tool ? names[edit.source.tool] : '';
  const title = edit.source?.kind === 'version' ? `Going back to earlier base instructions: ${counts || 'the same text'}.`
    : edit.source?.kind === 'copy' ? `Using ${from}’s edited copy as the base instructions: ${counts}.`
    : !before.trim() ? `Review the base instructions: ${plural(lineCount(edit.text), 'line')}.`
    : edit.text === before ? 'Review: the base instructions stay the same; the tools that get them change.'
    : `Review the base instructions: ${counts}.`;
  const save = writes.length ? `Save and update ${writes.length === 1 ? fileName(writes[0].file.path) : `${writes.length} files`}` : 'Save';
  return h('div.ins-editor', {},
    h('p.ins-review-title', {}, title),
    edit.text === before ? null : diffView(diff, !!edit.fullDiff, () => { edit.fullDiff = true; rerender(); }, 'Changes to the base instructions'),
    plans.length ? h('h3.base-subhead', {}, 'Each file') : h('p.ins-empty', {}, 'No tool is chosen, so no file changes. The base instructions are kept here for later.'),
    h('ul.plain-list.base-plan', {}, plans.map(({ file, plan }) => {
      const key = `plan-${file.tool}`;
      const changes = plan!.next !== file.text;
      const shadow = !file.exists ? file.notes.find(note => /^This folder has a CLAUDE\.md/.test(note)) : undefined;
      return h('li.base-plan-row', {},
        h('div.base-plan-line', {}, brandMark(file.tool, 14), h('strong', {}, names[file.tool]), h('span.base-file', {}, fileName(file.path)), h('span.base-plan-says', {}, plan!.says),
          changes ? button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide the file' : 'Show the file', id: `base-${key}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) }) : null),
        shadow ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, shadow)) : null,
        changes && shown.has(key) ? diffView(lineDiff(file.text, plan!.next), shown.has(`${key}-all`), () => { shown.add(`${key}-all`); rerender(); }, `Changes to ${fileName(file.path)}`) : null);
    })),
    h('div.ins-actions', {},
      button({ variant: 'primary', size: 'small', label: save, id: 'base-save', disabled: !!state.busy, onclick: () => void applyBaseChange(
        { text: edit.text, tools: edit.text.trim() ? edit.tools : [], adopt: edit.source?.kind === 'own' ? edit.source.tool : undefined },
        written => (edit.source?.kind === 'version' ? 'The earlier base instructions are back' : 'Base instructions saved') + (written ? `, and ${written} ${written.includes(' and ') ? 'are' : 'is'} updated.` : '.')) }),
      button({ variant: 'ghost', size: 'small', label: 'Back to editing', id: 'base-back', onclick: () => { edit.stage = 'edit'; rerender(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Discard changes', id: 'base-review-discard', onclick: () => { state.baseEdit = undefined; rerender(); } })));
}

/** One chosen tool on the resting card: whether its file has the base as it is now, and the choice when it was edited there. */
function toolRow(file: InstructionFile, locked: boolean) {
  const base = file.base!;
  const name = fileName(file.path);
  const key = `copy-${file.tool}`;
  const status = base.state === 'same' ? h('span.base-state', {}, icon('check', 13, 'tone-success'), 'Up to date')
    : base.state === 'edited' ? h('span.base-state.base-edited', {}, icon('triangle-alert', 13, 'tone-warning'), `Edited in ${name}`)
    : h('span.base-state', {}, icon('circle-dashed', 13, 'tone-muted'), base.state === 'older' ? 'Has an older version' : file.exists ? 'Not in the file yet' : 'No file yet');
  return h('li.base-tool', {},
    h('div.base-tool-line', {}, brandMark(file.tool, 14), h('strong', {}, names[file.tool]), h('span.base-file', {}, name), status),
    base.state !== 'edited' ? null : h('div.base-choice', {},
      h('p.ins-empty', {}, `Someone changed the base text inside ${name}. Nothing was overwritten. Keep that change for every tool, or put the base back in ${name}; either can be undone.`),
      shown.has(key) ? diffView(lineDiff(state.base!.text, base.copy ?? ''), true, () => {}, `${name}’s copy compared with the base`) : null,
      h('div.ins-actions', {},
        button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide the difference' : 'See the difference', id: `base-diff-${file.tool}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) }),
        button({ variant: 'outline', size: 'small', label: 'Use it as the base', id: `base-adopt-${file.tool}`, disabled: locked, attrs: { title: `Review making ${name}’s copy the base for every tool` },
          onclick: () => startBaseEdit({ text: base.copy ?? '', tools: state.base!.tools, stage: 'review', source: { kind: 'copy', tool: file.tool } }) }),
        button({ variant: 'outline', size: 'small', label: `Put the base back in ${name}`, id: `base-restore-${file.tool}`, disabled: locked, attrs: { title: `The edited text is kept under ${names[file.tool]}’s Earlier versions` },
          onclick: () => void applyBaseChange({ text: state.base!.text, tools: state.base!.tools, overwrite: [file.tool] }, () => `Put the base instructions back in ${name}. The edited copy is under ${names[file.tool]}’s Earlier versions.`) }))));
}

/** The card above the tools: write the base once; each chosen tool's file gets it after its own instructions. */
export function baseCard(files: InstructionFile[]) {
  const base = state.base;
  if (!base) return null;
  const edit = state.baseEdit;
  const readOnly = !!state.home && !state.home.manage.access.allowed;
  const toolEdit = state.instructionEdit;
  const toolFile = toolEdit && files.find(file => file.tool === toolEdit.tool);
  const toolDirty = !!toolFile && toolEdit!.text !== ownText(toolFile);
  const lockedWhy = readOnly ? 'Saving is off in this home.' : toolDirty ? `Finish or cancel the ${fileName(toolFile!.path)} edit first.` : undefined;
  const locked = !!state.busy || !!lockedWhy;
  const lockAttrs = lockedWhy ? { title: lockedWhy, 'aria-description': lockedWhy } : undefined;
  const chosen = files.filter(file => file.base);
  const behind = chosen.filter(file => file.base!.state === 'older' || file.base!.state === 'missing');
  const others = files.filter(file => !file.base);
  const preview = base.text.replace(/\n$/, '').split('\n');
  const hasBase = !!base.text.trim();
  const starts = files.filter(file => ownText(file).trim());

  const head = h('header.ins-head', {}, icon('layers', 18, 'tone-muted'), h('h2.tool-title', {}, 'Base instructions'),
    hasBase || edit ? pathText(shownPath(base.path), base.path) : null,
    !edit && hasBase ? h('span.ins-missing', {}, chosen.length ? `In ${plural(chosen.length, 'tool')}` : 'In no tool') : null);

  let body: (Node | null)[];
  if (edit) body = [edit.stage === 'review' ? reviewView(files, edit) : editView(files, edit)];
  else if (!hasBase) {
    body = [
      h('p.ins-readers', {}, 'Write instructions once, and Central Knot adds them to the file of every tool you choose, after that tool’s own instructions. Each tool’s own instructions stay as they are.'),
      h('div.ins-actions.base-start', {},
        button({ variant: 'outline', size: 'small', label: 'Write base instructions', id: 'base-write', disabled: locked, attrs: lockAttrs, onclick: () => startBaseEdit({ text: '', tools: files.map(file => file.tool) }) }),
        starts.length ? h('span.ins-locked', {}, 'or start from') : null,
        starts.map(file => button({ variant: 'ghost', size: 'small', label: `${names[file.tool]}’s ${fileName(file.path)}`, id: `base-from-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Its instructions become the base; ${fileName(file.path)} keeps saying the same` },
          onclick: () => startBaseEdit({ text: ownText(file), tools: files.map(entry => entry.tool), source: { kind: 'own', tool: file.tool } }) })),
        lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null),
    ];
  } else {
    body = [
      h('p.ins-readers', {}, chosen.length ? 'Kept after the own instructions in each file below. Edit them here once and every file follows; each tool’s own text stays as it is.' : 'Kept here, but no tool gets them. Edit to choose tools.'),
      chosen.length ? h('ul.plain-list.base-tool-list', {}, chosen.map(file => toolRow(file, locked))) : null,
      others.length && chosen.length ? h('p.ins-empty', {}, `Not added to ${andList(others.map(file => names[file.tool]))}.`) : null,
      h('pre.ins-preview', { tabindex: '0', 'aria-label': 'Base instructions' }, shown.has('base-all') ? preview.join('\n') : preview.slice(0, 14).join('\n')),
      preview.length > 14 ? button({ variant: 'link', size: 'micro', label: shown.has('base-all') ? 'Show less' : `Show all ${preview.length} lines`, id: 'base-more', onclick: () => toggle('base-all') }) : null,
      h('div.ins-actions', {},
        button({ variant: 'outline', size: 'small', label: 'Edit', id: 'base-edit', disabled: locked, attrs: lockAttrs, onclick: () => startBaseEdit({ text: base.text, tools: base.tools }) }),
        behind.length ? button({ variant: 'outline', size: 'small', label: `Update ${behind.length === 1 ? fileName(behind[0].path) : `${behind.length} files`}`, id: 'base-update', disabled: locked, attrs: lockAttrs ?? { title: 'Write the base instructions as they are now into these files' },
          onclick: () => void applyBaseChange({ text: base.text, tools: base.tools }, written => (written ? `Updated ${written} with the base instructions.` : 'Nothing needed updating.')) }) : null,
        lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null),
    ];
  }
  const versions = !edit && base.versions.length ? h('details.ins-versions', {}, h('summary', {}, icon('chevron-right', 12, 'tone-faint'), `Earlier versions (${base.versions.length})`),
    h('ul.plain-list', {}, base.versions.slice(0, 20).map(version => h('li.ins-version', {},
      h('span', {}, new Date(version.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), h('span.tone-faint', {}, ` · ${version.firstLine || 'empty'} · ${version.differs ? `${version.differs} ${version.differs === 1 ? 'line differs' : 'lines differ'} from now` : 'same as now'}`)),
      button({ variant: 'link', size: 'micro', label: 'Restore…', id: `base-load-${version.id}`, disabled: locked, attrs: lockAttrs, onclick: () => void loadBaseVersion(version.id) }))))) : null;
  return h('article.card.ins-card.base-card', { id: 'base-card', 'aria-label': 'Base instructions' }, head, ...body, versions);
}

/** On a tool's card, below its own instructions: the base block it holds, kept apart and shown on request. */
export function baseStrip(file: InstructionFile) {
  const base = file.base;
  if (!base || base.copy === undefined) return null;
  const key = `strip-${file.tool}`;
  const lines = lineCount(base.copy);
  const said = base.state === 'same' ? 'the same in every chosen tool' : base.state === 'edited' ? 'edited in this file; see Base instructions above' : 'an older version; see Base instructions above';
  return h('div.base-strip', {},
    h('div.base-strip-line', {}, icon('layers', 13, 'tone-muted'), h('span', {}, h('strong', {}, 'Then the base instructions'), ` · ${plural(lines, 'line')}, ${said}`),
      button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide' : 'Show', id: `ins-base-${file.tool}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) })),
    shown.has(key) ? h('pre.ins-preview.base-copy', { tabindex: '0', 'aria-label': `Base instructions in ${fileName(file.path)}` }, base.copy.replace(/\n$/, '')) : null);
}
