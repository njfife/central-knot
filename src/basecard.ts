// Base instructions (INS-03, INS-04): one text, written once, that Central Knot keeps in each chosen tool's own instruction file,
// in a marked block after that tool's own instructions. A tool's own text is never rewritten. A copy edited in a tool's file is
// shown, never overwritten by itself: the person uses it as the base or puts the base back. Every save shows each file's change first.
import { applyBaseChange, baseDraftChanged, loadBaseVersion, ownText, rerender, shownPath, startBaseEdit, state, type BaseEdit } from './app.ts';
import { baseWrite, sameBase, splitBase } from './basetext.ts';
import { lineDiff } from './diff.ts';
import { button, checkbox, h, icon, pathText } from './dom.ts';
import { changeCounts, diffView, discardConfirm, keys, previewBlock, versionsList } from './instructionspage.ts';
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
/** Says which side of a difference is which, above it. */
const legend = (removed: string, added: string) => h('p.base-legend', {}, h('span.base-legend-removed', {}, `− ${removed}`), h('span.base-legend-added', {}, `+ ${added}`));
const lineCount = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0);

/** What saving the draft does to one tool's file: the new text, and a sentence saying so. Undefined: the file is not involved. */
function planFor(file: InstructionFile, edit: BaseEdit): { next: string; says: string } | undefined {
  const chosen = edit.tools.includes(file.tool) && !!edit.text.trim();
  // A file is involved when it gets the base now or got it before; a missing file is never created just to take a block out.
  if (!chosen && (!file.base?.chosen || !file.exists)) return undefined;
  const name = fileName(file.path);
  const { own, copy } = splitBase(file.text);
  const ours = edit.source?.tool === file.tool;
  const action = ours && edit.source?.kind === 'putBack' ? 'putBack' : ours && edit.source?.kind === 'own' ? 'adopt' : 'save';
  const write = baseWrite(file.text, edit.text, { chosen, held: file.base, action });
  if (write.edited) return { next: file.text, says: chosen ? `Left as it is: its copy of the base was edited in ${name}. Choose what to do with it on this card after saving.` : `Left as it is, block included: its copy of the base was edited in ${name}, so Central Knot doesn’t take it out.` };
  const { next } = write;
  const says = (text: string) => ({ next, says: text });
  if (!chosen) return says(own.trim() ? 'The base instructions come out. Its own instructions stay.' : `The base instructions come out of their block and stay as plain text, so ${name} is not left empty.`);
  if (action === 'putBack') return says(`Its edited copy of the base is replaced by the base. The edited text is kept under ${names[file.tool]}’s Earlier versions.`);
  if (!file.exists) return says(`${name} is created, holding only the base instructions.`);
  if (next === file.text) return says('No change: it already has these base instructions.');
  if (copy === undefined && file.base?.leftPlain) return says('Its plain copy of the base goes back into the base block, so it isn’t there twice.');
  if (action === 'adopt') return says(`Its ${plural(lineCount(own), 'line')} move into the base block${sameBase(own, edit.text) ? `, so ${names[file.tool]} reads the same as now` : ', as edited here'}. Nothing is lost: the file as it was stays under Earlier versions.`);
  if (copy === undefined) return says(own.trim() ? `Added after its own ${plural(lineCount(own), 'line')}.` : 'The base instructions are added.');
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
    h('fieldset.base-tools', {}, h('legend', {}, 'Tools that get them, after each tool’s own instructions. Review changes shows what unticking one does to its file.'),
      files.map(file => checkbox({ id: `base-tool-${file.tool}`, checked: edit.tools.includes(file.tool), onchange: checked => {
        edit.tools = files.map(entry => entry.tool).filter(tool => tool === file.tool ? checked : edit.tools.includes(tool));
        edit.confirmDiscard = false; rerender();
      } }, brandMark(file.tool, 14), h('span', {}, names[file.tool]), h('span.base-file', {}, fileName(file.path), file.exists ? '' : ' (new file)')))),
    edit.confirmDiscard
      ? h('div.ins-actions', {}, discardConfirm('the base instructions', { discard: 'base-discard', keep: 'base-keep' }, 'Keep editing',
        { run: () => { state.baseEdit = undefined; }, focus: state.base?.text.trim() ? 'base-edit' : 'base-write' }, { run: () => { edit.confirmDiscard = false; }, focus: 'base-text' }))
      : h('div.ins-actions', {},
        button({ variant: 'primary', size: 'small', label: 'Review changes', id: 'base-review', disabled: !reviewable(), onclick: () => { edit.stage = 'review'; rerender(); document.getElementById('base-save')?.focus(); } }),
        button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'base-cancel', onclick: () => {
          const ask = draftChanges(edit);
          if (ask) edit.confirmDiscard = true; else state.baseEdit = undefined;
          rerender();
          document.getElementById(ask ? 'base-keep' : state.base?.text.trim() ? 'base-edit' : 'base-write')?.focus();
        } }),
        h('span.ins-locked', { id: 'base-hint' }, hint()),
        state.base?.tools.length ? button({ variant: 'link', size: 'micro', label: 'Take them out of every file…', id: 'base-stop', attrs: { title: 'Review taking the base instructions out of every tool’s file; each tool’s own instructions stay' },
          onclick: () => { Object.assign(edit, { tools: [], stage: 'review', confirmDiscard: false }); rerender(); document.getElementById('base-save')?.focus(); } }) : null));
}

/** A review's headline, its Save label, and the result sentence once saved (given the files written), for where the draft came from. */
function reviewWords(edit: BaseEdit, { counts, writesText, writes, putBackFile, from }: { counts: string; writesText: string; writes: number; putBackFile: string; from: string }) {
  const before = state.base?.text ?? '';
  const saved = (lead: string) => (written: string) => `${lead}${written ? ` in ${written}` : ''}.`;
  const kind = edit.source?.kind;
  if (kind === 'putBack') return { title: `Put the base instructions back in ${putBackFile}.`, save: `Put the base back in ${putBackFile}`,
    // Said only when it was written; otherwise the note after it says why not.
    done: (written: string) => (written ? `The base instructions are back in ${putBackFile}. The edited copy is under ${from}’s Earlier versions.` : `${putBackFile} was not changed.`) };
  if (kind === 'update') return { title: `Write the base instructions into ${writesText}.`, save: `Update ${writesText}`, done: (written: string) => `Updated ${written || 'nothing'} with the base instructions.` };
  const save = writes ? `Save and update ${writesText}` : 'Save';
  if (kind === 'version') return { title: `Going back to earlier base instructions: ${counts || 'the same text'}.`, save, done: saved('The earlier base instructions are back') };
  if (kind === 'copy') return { title: `Using ${from}’s edited copy as the base instructions: ${counts}.`, save, done: saved('Base instructions saved') };
  const title = !before.trim() ? `Review the base instructions: ${plural(lineCount(edit.text), 'line')}.`
    : !edit.tools.length && state.base?.tools.length ? 'Take the base instructions out of every file. Each tool’s own instructions stay, and the base is kept here for later.'
    : edit.text === before ? 'Review: the base instructions stay the same; the tools that get them change.'
    : `Review the base instructions: ${counts}.`;
  return { title, save, done: saved('Base instructions saved') };
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
  const putBackFile = kind === 'putBack' ? fileName(plans[0]?.file.path ?? '') : '';
  const { title, save, done } = reviewWords(edit, { counts, writesText, writes: writes.length, putBackFile, from });
  const startedInReview = kind && kind !== 'own';
  return h('div.ins-editor', {},
    h('p.ins-review-title', {}, title),
    edit.conflict ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `${edit.conflict.replace(/ Review again\.$/, '')} This review now shows things as they are.`)) : null,
    edit.text === before ? null : [legend(before.trim() ? 'the base now' : 'nothing yet', 'the base after saving'), diffView(diff, !!edit.fullDiff, () => { edit.fullDiff = true; rerender(); }, 'Changes to the base instructions')],
    plans.length > 1 || (plans.length && edit.text !== before) ? h('h3.base-subhead', {}, 'Each file') : plans.length ? null : h('p.ins-empty', {}, 'No tool is chosen, so no file changes. The base instructions are kept here for later.'),
    h('ul.plain-list.base-plan', {}, plans.map(({ file, plan }) => {
      const key = `plan-${file.tool}`;
      const changes = plan!.next !== file.text;
      const shadow = !file.exists ? file.notes.find(note => /^This folder has a CLAUDE\.md/.test(note)) : undefined;
      return h('li.base-plan-row', {},
        h('div.base-plan-line', {}, brandMark(file.tool, 14), h('strong', {}, names[file.tool]), h('span.base-file', {}, fileName(file.path)), h('span.base-plan-says', {}, plan!.says),
          changes ? button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide the file' : 'Show the file', id: `base-${key}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) }) : null),
        shadow ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, shadow)) : null,
        changes && shown.has(key) ? [legend(`${fileName(file.path)} now`, 'after saving'), diffView(lineDiff(file.text, plan!.next), shown.has(`${key}-all`), () => { shown.add(`${key}-all`); rerender(); }, `Changes to ${fileName(file.path)}`)] : null);
    })),
    h('div.ins-actions', {},
      button({ variant: 'primary', size: 'small', label: save, id: 'base-save', disabled: !!state.busy, onclick: () => void applyBaseChange(
        { text: edit.text, tools: edit.text.trim() ? edit.tools : [], seen: Object.fromEntries(plans.map(({ file }) => [file.tool, { path: file.path, hash: file.hash }])),
          adopt: kind === 'own' ? edit.source!.tool : undefined, overwrite: putBackFile ? [edit.source!.tool!] : undefined }, done) }),
      startedInReview
        ? button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'base-back', onclick: () => closeOrBack(edit) })
        : [button({ variant: 'ghost', size: 'small', label: 'Back to editing', id: 'base-back', onclick: () => closeOrBack(edit) }),
          edit.confirmDiscard
            ? discardConfirm('the base instructions', { discard: 'base-review-discard-yes', keep: 'base-review-keep' }, 'Keep reviewing',
              { run: () => { state.baseEdit = undefined; }, focus: state.base?.text.trim() ? 'base-edit' : 'base-write' }, { run: () => { edit.confirmDiscard = false; }, focus: 'base-save' })
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
      h('p.base-explain', {}, `Its copy of the base was changed outside Central Knot, so ${name} was left as it is.`),
      h('p.base-explain', {}, `Either choice below shows the change first, keeps the replaced text under Earlier versions, and can be undone.`),
      shown.has(key) ? [legend('the base', `${name}’s copy`),
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
  const edited = chosen.filter(file => file.base!.state === 'edited');
  const hasBase = !!base.text.trim();
  const starts = files.filter(file => ownText(file).trim());

  const head = h('header.ins-head', {}, icon('layers', 18, 'tone-muted'), h('h2.tool-title', {}, 'Base instructions'),
    hasBase || edit ? pathText(shownPath(base.path), base.path) : null,
    !edit && hasBase ? h(`span.ins-missing${edited.length ? '.base-pill-warn' : ''}`, {}, (chosen.length ? `In ${plural(chosen.length, 'tool')}` : 'In no tool') + (edited.length ? ` · ${plural(edited.length, 'edited copy', 'edited copies')}` : '')) : null);

  let body: (Node | null)[];
  if (edit) body = [edit.stage === 'review' ? reviewView(files, edit) : editView(files, edit)];
  else if (!hasBase) {
    body = [
      h('p.ins-readers', {}, 'Write instructions once, and Central Knot adds them to the file of every tool you choose, after that tool’s own instructions. Each tool’s own instructions stay as they are.'),
      h('div.ins-actions.base-start', {},
        button({ variant: 'outline', size: 'small', label: 'Write base instructions', id: 'base-write', disabled: locked, attrs: lockAttrs, onclick: () => startBaseEdit({ text: '', tools: files.map(file => file.tool) }) }),
        starts.length ? h('span.ins-locked', {}, 'or start from one tool’s instructions (they move into the base):') : null,
        starts.map(file => button({ variant: 'outline', size: 'small', label: `${names[file.tool]}’s ${fileName(file.path)}`, id: `base-from-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Its instructions move into the base, and the tools you choose get them too` },
          onclick: () => startBaseEdit({ text: ownText(file), tools: files.map(entry => entry.tool), source: { kind: 'own', tool: file.tool } }) })),
        lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null),
    ];
  } else {
    body = [
      h('p.ins-readers', {}, !chosen.length ? 'Kept here, but no tool gets them. Choose tools with Edit text or tools.'
        : `Kept after each tool’s own instructions, in the files below. Saving here updates every chosen file${edited.length ? '; a copy edited outside Central Knot stays as it is until you choose' : ''}. Each tool’s own text stays as it is.`),
      // Wide windows put the tools beside the text; narrow ones stack them.
      h('div.base-columns', {},
        h('div.base-column', {},
          chosen.length ? h('ul.plain-list.base-tool-list', {}, chosen.map(file => toolRow(file, locked, lockAttrs))) : null,
          others.length && chosen.length ? h('p.ins-empty', {}, `Not added to ${andList(others.map(file => names[file.tool]))}.`) : null),
        h('div.base-column', {},
          edited.length ? h('p.base-subhead', {}, 'The base instructions') : null,
          previewBlock(base.text, 'base', 'Base instructions', 'base-more'))),
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
