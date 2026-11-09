// Base instructions (INS-03, INS-04): one text, written once, that Central Knot keeps in each chosen tool's own instruction file,
// in a marked block after that tool's own instructions. A tool's own text is never rewritten. A copy edited in a tool's file is
// shown, never overwritten by itself: the person uses it as the base or puts the base back. Every save shows each file's change first.
import { applyBaseChange, baseDraftChanged, loadBaseVersion, ownText, rerender, shownPath, startBaseEdit, state, type BaseEdit } from './app.ts';
import { baseWrite, sameBase, splitBase } from './basetext.ts';
import { lineDiff } from './diff.ts';
import { button, checkbox, h, icon, pathText } from './dom.ts';
import { changeCounts, diffView, keys, versionsList } from './instructionspage.ts';
import { brandMark } from './matrix.ts';
import { andList, fileName, toolNames } from './words.ts';
import { plural } from './model.ts';
import type { HarnessId, InstructionFile } from './types.ts';

const names = toolNames as Record<string, string>;
/** Tool rows whose difference or file change is open. */
const shown = new Set<string>();
const toggle = (key: string) => { if (shown.has(key)) shown.delete(key); else shown.add(key); rerender(); };
// In the review, Esc goes back to editing; a review that started there (an edited copy, an earlier version) closes.
document.addEventListener('keydown', event => {
  const edit = state.baseEdit;
  if (event.key !== 'Escape' || state.page !== 'instructions' || edit?.stage !== 'review') return;
  event.preventDefault();
  closeOrBack(edit);
});

/** Leaves the review: back to the editor, or closed when the review started on the card (an edited copy, an earlier version). */
function closeOrBack(edit: BaseEdit) {
  const startedInReview = edit.source && edit.source.kind !== 'own';
  if (startedInReview) state.baseEdit = undefined; else Object.assign(edit, { stage: 'edit', conflict: undefined });
  rerender();
  const from = edit.source?.kind === 'copy' ? `base-adopt-${edit.source.tool}` : edit.source?.kind === 'putBack' ? `base-restore-${edit.source.tool}` : 'base-edit';
  document.getElementById(startedInReview ? from : 'base-text')?.focus();
}
const lineCount = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0);

/** What saving the draft does to one tool's file: the new text, and a sentence saying so. Undefined: the file is not involved. */
function planFor(file: InstructionFile, edit: BaseEdit): { next: string; says: string } | undefined {
  const chosen = edit.tools.includes(file.tool) && !!edit.text.trim();
  // A file is involved when it gets the base now or got it before; a missing file is never created just to take a block out.
  if (!chosen && (!file.base?.chosen || !file.exists)) return undefined;
  const name = fileName(file.path);
  const { own, copy } = splitBase(file.text);
  const ours = edit.source?.tool === file.tool;
  const putBack = edit.source?.kind === 'putBack' && ours;
  const adopt = edit.source?.kind === 'own' && ours;
  const write = baseWrite(file.text, { base: edit.text, chosen, copyIsABase: file.base?.state !== 'edited', ownIsABase: file.base?.ownIsABase, adopt, overwrite: putBack });
  if (write.edited) return { next: file.text, says: chosen ? `Left as it is: its copy of the base was edited in ${name}. Choose what to do with it on this card after saving.` : `Left as it is, block included: its copy of the base was edited in ${name}, so Central Knot doesn’t take it out.` };
  const { next } = write;
  const says = (text: string) => ({ next, says: text });
  if (!chosen) return says(own.trim() ? 'The base instructions come out. Its own instructions stay.' : `The base instructions come out of their block and stay as plain text, so ${name} is not left empty.`);
  if (putBack) return says(`Its edited copy of the base is replaced by the base. The edited text is kept under ${names[file.tool]}’s Earlier versions.`);
  if (!file.exists) return says(`${name} is created, holding only the base instructions.`);
  if (next === file.text) return says('No change: it already has these base instructions.');
  if (copy === undefined && file.base?.ownIsABase) return says('Its text is base instructions, left as plain text when it was taken off the list; it moves back into the base block, so it isn’t repeated.');
  if (adopt) return says(`Its ${plural(lineCount(own), 'line')} move into the base block${sameBase(own, edit.text) ? `, so ${names[file.tool]} reads the same as now` : ', as edited here'}. Nothing is lost: the file as it was stays under Earlier versions.`);
  if (copy === undefined) return says(own.trim() ? `The base instructions go after its ${plural(lineCount(own), 'line')} of its own.` : 'The base instructions are added.');
  return says('Its copy of the base is updated. Its own instructions stay.');
}

/** The draft differs from what is saved, or comes from somewhere: saving it does something. */
const draftChanges = (edit: BaseEdit) => baseDraftChanged(edit) || !!edit.source;

function editView(files: InstructionFile[], edit: BaseEdit) {
  // Read as the person types: the editor isn't redrawn on each key.
  const empty = () => !edit.text.trim();
  const reviewable = () => draftChanges(edit) && !(empty() && !state.base?.tools.length);
  const hint = () => (reviewable() ? keys : empty() ? 'Write the base instructions to review them.' : 'Make a change to review it.');
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
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && reviewable()) { event.preventDefault(); edit.stage = 'review'; rerender(); document.getElementById('base-save')?.focus(); }
    } }) as HTMLTextAreaElement;
  area.value = edit.text;
  area.rows = Math.min(30, Math.max(6, lineCount(edit.text) + 3));
  const from = edit.source?.tool ? files.find(file => file.tool === edit.source!.tool) : undefined;
  return h('div.ins-editor', {},
    from && edit.source?.kind === 'own' ? h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, `${fileName(from.path)}’s instructions move into the base: ${names[from.tool]} still reads them, now from the base block, and the tools you choose get them too. A line meant only for ${names[from.tool]} can go back into its own instructions after saving.`)) : null,
    area,
    h('fieldset.base-tools', {}, h('legend', {}, 'Tools that get them, after each tool’s own instructions. Untick a tool to take them out of its file.'),
      files.map(file => checkbox({ id: `base-tool-${file.tool}`, checked: edit.tools.includes(file.tool), onchange: checked => {
        edit.tools = files.map(entry => entry.tool).filter(tool => tool === file.tool ? checked : edit.tools.includes(tool));
        edit.confirmDiscard = false; rerender();
      } }, brandMark(file.tool, 14), h('span', {}, names[file.tool]), h('span.base-file', {}, fileName(file.path), file.exists ? '' : ' (new file)')))),
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
  // Putting the base back concerns one file, and an update only the files it writes; other reviews list each file involved.
  const kind = edit.source?.kind;
  const all = files.filter(file => kind !== 'putBack' || file.tool === edit.source!.tool).map(file => ({ file, plan: planFor(file, edit) })).filter(entry => entry.plan);
  const writes = all.filter(entry => entry.plan!.next !== entry.file.text);
  const plans = kind === 'update' ? writes : all;
  const writesText = writes.length === 1 ? fileName(writes[0].file.path) : `${writes.length} files`;
  const from = edit.source?.tool ? names[edit.source.tool] : '';
  const putBack = edit.source?.kind === 'putBack' ? fileName(plans[0]?.file.path ?? '') : '';
  const title = putBack ? `Put the base instructions back in ${putBack}.`
    : kind === 'update' ? `Write the base instructions into ${writesText}.`
    : edit.source?.kind === 'version' ? `Going back to earlier base instructions: ${counts || 'the same text'}.`
    : edit.source?.kind === 'copy' ? `Using ${from}’s edited copy as the base instructions: ${counts}.`
    : !before.trim() ? `Review the base instructions: ${plural(lineCount(edit.text), 'line')}.`
    : edit.text === before ? 'Review: the base instructions stay the same; the tools that get them change.'
    : `Review the base instructions: ${counts}.`;
  const save = putBack ? `Put the base back in ${putBack}` : kind === 'update' ? `Update ${writesText}` : writes.length ? `Save and update ${writesText}` : 'Save';
  const startedInReview = kind && kind !== 'own';
  return h('div.ins-editor', {},
    h('p.ins-review-title', {}, title),
    edit.conflict ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `${edit.conflict.replace(/ Review again\.$/, '')} This review now shows things as they are.`)) : null,
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
        { text: edit.text, tools: edit.text.trim() ? edit.tools : [], seen: Object.fromEntries(plans.map(({ file }) => [file.tool, file.hash])),
          adopt: edit.source?.kind === 'own' ? edit.source.tool : undefined, overwrite: putBack ? [edit.source!.tool!] : undefined },
        written => putBack ? `The base instructions are back in ${putBack}. The edited copy is under ${from}’s Earlier versions.`
          : kind === 'update' ? `Updated ${written || 'nothing'} with the base instructions.`
          : (edit.source?.kind === 'version' ? 'The earlier base instructions are back' : 'Base instructions saved') + (written ? ` in ${written}.` : '.')) }),
      startedInReview
        ? button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'base-back', onclick: () => closeOrBack(edit) })
        : [button({ variant: 'ghost', size: 'small', label: 'Back to editing', id: 'base-back', onclick: () => closeOrBack(edit) }),
          edit.confirmDiscard
            ? h('span.ins-confirm', {}, h('span.ins-confirm-text', {}, 'Discard your changes to the base instructions?'),
              button({ variant: 'outline', size: 'small', label: 'Discard', id: 'base-review-discard-yes', onclick: () => { state.baseEdit = undefined; rerender(); document.getElementById('base-edit')?.focus(); } }),
              button({ variant: 'ghost', size: 'small', label: 'Keep reviewing', id: 'base-review-keep', onclick: () => { edit.confirmDiscard = false; rerender(); document.getElementById('base-save')?.focus(); } }))
            : button({ variant: 'ghost', size: 'small', label: 'Discard changes', id: 'base-review-discard', onclick: () => { edit.confirmDiscard = true; rerender(); document.getElementById('base-review-discard-yes')?.focus(); } })]));
}

/** One chosen tool on the resting card: whether its file has the base as it is now, and the choice when it was edited there. */
function toolRow(file: InstructionFile, locked: boolean, lockAttrs: Record<string, string> | undefined) {
  const base = file.base!;
  const name = fileName(file.path);
  const key = `copy-${file.tool}`;
  const status = base.state === 'same' ? h('span.base-state', {}, icon('check', 13, 'tone-success'), 'Matches the base')
    : base.state === 'edited' ? h('span.base-state.base-edited', {}, icon('triangle-alert', 13, 'tone-warning'), `Edited in ${name}`)
    : h('span.base-state', {}, icon('circle-dashed', 13, 'tone-muted'), base.state === 'older' ? 'Has an older version' : file.exists ? 'Not in the file yet' : 'No file yet');
  return h('li.base-tool', {},
    h('div.base-tool-line', {}, brandMark(file.tool, 14), h('strong', {}, names[file.tool]), h('span.base-file', {}, name), status),
    base.state !== 'edited' ? null : h('div.base-choice', {},
      h('p.base-explain', {}, `The base instructions inside ${name} were changed outside Central Knot, so ${name} was left as it is. Use its copy as the base for every tool, or put the base back in ${name}. Both show the change first, keep the replaced text and can be undone.`),
      shown.has(key) ? [h('p.base-legend', {}, h('span.base-legend-removed', {}, '− the base'), h('span.base-legend-added', {}, `+ ${name}’s copy`)),
        diffView(lineDiff(state.base!.text, base.copy ?? ''), true, () => {}, `${name}’s copy compared with the base`)] : null,
      h('div.ins-actions', {},
        button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide the difference' : 'See the difference', id: `base-diff-${file.tool}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) }),
        button({ variant: 'outline', size: 'small', label: 'Use it as the base…', id: `base-adopt-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Review making ${name}’s copy the base for every tool` },
          onclick: () => startBaseEdit({ text: base.copy ?? '', tools: state.base!.tools, stage: 'review', source: { kind: 'copy', tool: file.tool } }) }),
        button({ variant: 'outline', size: 'small', label: `Put the base back in ${name}…`, id: `base-restore-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Review replacing ${name}’s edited copy with the base` },
          onclick: () => startBaseEdit({ text: state.base!.text, tools: state.base!.tools, stage: 'review', source: { kind: 'putBack', tool: file.tool } }) }))));
}

/** The card above the tools: write the base once; each chosen tool's file gets it after its own instructions. */
export function baseCard(files: InstructionFile[]) {
  const base = state.base;
  if (!base) return null;
  const edit = state.baseEdit;
  const readOnly = !!state.home && !state.home.manage.access.allowed;
  const toolEdit = state.instructionEdit;
  const toolFile = toolEdit && files.find(file => file.tool === toolEdit.tool);
  const toolDirty = !!toolFile && !toolEdit!.restoring && toolEdit!.text !== ownText(toolFile);
  const lockedWhy = readOnly ? 'Saving is off in this home.' : toolDirty ? `Finish or cancel the ${fileName(toolFile!.path)} edit first.` : undefined;
  const locked = !!state.busy || !!lockedWhy;
  const lockAttrs = lockedWhy ? { title: lockedWhy, 'aria-description': lockedWhy } : undefined;
  const chosen = files.filter(file => file.base?.chosen);
  const behind = chosen.filter(file => file.base!.state === 'older' || file.base!.state === 'missing');
  const others = files.filter(file => !file.base?.chosen);
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
        starts.length ? h('span.ins-locked', {}, 'or share one tool’s instructions:') : null,
        starts.map(file => button({ variant: 'outline', size: 'small', label: `${names[file.tool]}’s ${fileName(file.path)}`, id: `base-from-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Its instructions move into the base, and the tools you choose get them too` },
          onclick: () => startBaseEdit({ text: ownText(file), tools: files.map(entry => entry.tool), source: { kind: 'own', tool: file.tool } }) })),
        lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null),
    ];
  } else {
    body = [
      h('p.ins-readers', {}, chosen.length ? 'Kept after each tool’s own instructions, in the files below. Edit them here once and every file follows; each tool’s own text stays as it is.' : 'Kept here, but no tool gets them. Choose tools with Edit.'),
      chosen.length ? h('ul.plain-list.base-tool-list', {}, chosen.map(file => toolRow(file, locked, lockAttrs))) : null,
      others.length && chosen.length ? h('p.ins-empty', {}, `Not added to ${andList(others.map(file => names[file.tool]))}.`) : null,
      chosen.some(file => file.base!.state === 'edited') ? h('p.base-subhead', {}, 'The base instructions') : null,
      h('pre.ins-preview', { tabindex: '0', 'aria-label': 'Base instructions' }, shown.has('base-all') ? preview.join('\n') : preview.slice(0, 14).join('\n')),
      preview.length > 14 ? button({ variant: 'link', size: 'micro', label: shown.has('base-all') ? 'Show less' : `Show all ${preview.length} lines`, id: 'base-more', onclick: () => toggle('base-all') }) : null,
      h('div.ins-actions', {},
        button({ variant: 'outline', size: 'small', label: 'Edit text or tools', id: 'base-edit', disabled: locked, attrs: lockAttrs, onclick: () => startBaseEdit({ text: base.text, tools: base.tools }) }),
        behind.length ? button({ variant: 'outline', size: 'small', label: `Update ${behind.length === 1 ? fileName(behind[0].path) : `${behind.length} files`}…`, id: 'base-update', disabled: locked, attrs: lockAttrs ?? { title: 'Review writing the base instructions as they are now into these files' },
          onclick: () => startBaseEdit({ text: base.text, tools: base.tools, stage: 'review', source: { kind: 'update' } }) }) : null,
        lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null),
    ];
  }
  const versions = edit ? null : versionsList(base.versions, { id: version => `base-load-${version}`, disabled: locked, why: lockedWhy, run: version => void loadBaseVersion(version) });
  return h('article.card.ins-card.base-card', { id: 'base-card', 'aria-label': 'Base instructions' }, head, ...body, versions);
}

/** On a tool's card, below its own instructions: the base block it holds, kept apart and shown on request. */
export function baseStrip(file: InstructionFile) {
  const base = file.base;
  if (!base || base.copy === undefined) return null;
  const key = `strip-${file.tool}`;
  const lines = lineCount(base.copy);
  const said = !base.chosen ? 'not on the base list, so Central Knot leaves this block as it is' : base.state === 'same' ? 'matches the base' : base.state === 'edited' ? 'edited in this file; see Base instructions above' : 'an older version; see Base instructions above';
  return h('div.base-strip', {},
    h('div.base-strip-line', {}, icon('layers', 13, 'tone-muted'), h('span', {}, h('strong', {}, 'Then the base instructions'), ` · ${plural(lines, 'line')}, ${said}`),
      button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide' : 'Show', id: `ins-base-${file.tool}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) })),
    shown.has(key) ? h('pre.ins-preview.base-copy', { tabindex: '0', 'aria-label': `Base instructions in ${fileName(file.path)}` }, base.copy.replace(/\n$/, '')) : null);
}
