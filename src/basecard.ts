// Base instructions (INS-03, INS-04): one text, written once, that Central Knot keeps in each chosen tool's own instruction file,
// in a marked block after that tool's own instructions. A tool's own text is never rewritten. A copy edited in a tool's file is
// shown, never overwritten by itself: the person uses it as the base or puts the base back. Every save shows each file's change first.
// One of the person's own tools can write the first draft (INS-06): it sorts every tool's instructions into the base and what
// stays only in each tool's file, and the draft is reviewed and saved like any other base change, each file's own text included.
import { applyBaseChange, closeDraftPick, draftBaseWith, draftStale, draftable, openDraftPick, savingOff, startTakeOut, stopDraft, baseDraftTyped, baseSaveDoesSomething, loadBaseVersion, ownText, rerender, showPage, toolDraftTyped, shownPath, startBaseEdit, state, type BaseEdit } from './app.ts';
import { baseAction, draftedOwn, fileWithBase, linesNotCarried, readersOfFile, sameBase, splitBase } from './basetext.ts';
import { lineDiff } from './diff.ts';
import { button, checkbox, h, icon, lockAttrs as lockAttrsFor, pathText } from './dom.ts';
import { changeCounts, diffView, discardConfirm, escapeTo, keepCaret, keys, legend, previewBlock, versionsList } from './editparts.ts';
import { brandMark } from './matrix.ts';
import { fileName, lineCount, toolList, toolNames } from './words.ts';
import { plural } from './model.ts';
import type { HarnessId, InstructionFile } from './types.ts';

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

/** The base card's own button, where focus rests once its editor closes. */
const restingFocus = () => (state.base?.text.trim() ? 'base-edit' : 'base-write');
/** The draft started as a review on the card (an edited copy, putting the base back, an update, an earlier version). One a tool
 *  wrote opens as a review too, but it is the person's to change: going back from it opens the editor. */
const startedInReview = (edit: BaseEdit) => !!edit.source && edit.source.kind !== 'own' && edit.source.kind !== 'draft';
/** The tool that wrote the draft under review, by name; undefined for any other draft. */
const draftedBy = (edit: BaseEdit) => (edit.source?.kind === 'draft' && edit.source.tool ? toolNames[edit.source.tool] : undefined);

/** Leaves the review: back to the editor, or closed when the review started on the card (an edited copy, an earlier version). */
function closeOrBack(edit: BaseEdit) {
  const closes = startedInReview(edit);
  // Back from "Stop sharing": the ticks as they were before it.
  if (edit.ticksBeforeStop) Object.assign(edit, { tools: edit.ticksBeforeStop, ticksBeforeStop: undefined });
  if (closes) state.baseEdit = undefined; else Object.assign(edit, { stage: 'edit', conflict: undefined, confirmDiscard: false });
  rerender();
  const kind = edit.source?.kind;
  const from = kind === 'copy' ? `base-usecopy-${edit.source!.tool}` : kind === 'putBack' ? `base-restore-${edit.source!.tool}` : kind === 'update' ? 'base-update' : 'base-edit';
  document.getElementById(closes ? from : 'base-text')?.focus();
}

/** The adopt / put-back part of the save request this draft makes (the review previews with the same request). */
const requestOf = (edit: BaseEdit) => ({ adopt: edit.source?.kind === 'own' ? edit.source.tool : undefined, overwrite: edit.source?.kind === 'putBack' && edit.source.tool ? [edit.source.tool] : undefined });

/** Tools reading one physical file (linked dotfiles) are one destination: shown once, under the first of them. */
const isFirstReader = (file: InstructionFile, files: InstructionFile[]) => !files.slice(0, files.indexOf(file)).some(other => file.sameFile.includes(other.tool));
const readers = (file: InstructionFile) => readersOfFile(file.tool, file.sameFile);
const readerNames = (file: InstructionFile) => toolList(readers(file));

/** What saving the draft does to one destination's file: the new text, and a sentence saying so. Undefined: not involved. */
function planFor(file: InstructionFile, edit: BaseEdit): { next: string; says: string; /** In a tool's draft: the own text the file keeps, shown under its row. */ keeps?: string } | undefined {
  const chosen = readers(file).some(tool => edit.tools.includes(tool)) && !!edit.text.trim();
  // Involved when it gets the base now, or (not chosen) when it got it before or still holds a block it can lose; a missing file
  // is never created to take a block out.
  const canLoseBlock = file.exists && (file.base?.chosen || file.base?.copy !== undefined);
  if (!chosen && !canLoseBlock) return undefined;
  const name = fileName(file.path);
  const { own, copy } = splitBase(file.text);
  const action = baseAction(readers(file), requestOf(edit));
  // A draft a tool wrote also says what stays only in this file: that becomes its own text.
  const drafted = chosen ? draftedOwn(readers(file), edit.own) : undefined;
  const planned = fileWithBase(file.text, edit.text, { chosen, held: file.base, action, own: drafted });
  if ('left' in planned) return { next: file.text, says: chosen ? `Left as it is: its copy of the base was edited in ${name}. Choose what to do with it on this card after saving.` : `Left as it is, block included: its copy of the base was edited in ${name}, so Central Knot doesn’t take it out.` };
  const { next } = planned;
  const says = (text: string) => ({ next, says: text });
  if (next === file.text) return says(chosen ? 'No change: it already has these base instructions.' : 'No change: the base isn’t in this file.');
  if (!chosen) return says(own.trim() ? 'Stops getting base updates: the base instructions come out, and its own instructions stay.'
    : `Stops getting base updates. The text stays in ${name} as ${readerNames(file)}’s own instructions, since the file would otherwise be empty; delete it on its card if you don’t want it.`);
  if (action === 'putBack') return says(`Its edited copy of the base is replaced by the base. The edited text is kept under ${toolNames[file.tool]}’s Earlier versions.`);
  if (!file.exists) return says(`${name} is created, holding only the base instructions.`);
  // A draft's row shows the lines the file keeps, so the sentence only counts them.
  if (drafted !== undefined) return { next, keeps: drafted, says: drafted.trim() ? `Its own instructions become ${plural(lineCount(drafted), 'line')}, then the base:` : `No instructions of its own: ${name} will hold only the base.` };
  if (copy === undefined && file.base?.leftPlain) return says('Its plain copy of the base goes back into the base block, so it isn’t there twice.');
  if (action === 'adopt') return says(sameBase(own, edit.text) ? `Its ${plural(lineCount(own), 'line')} move into the base block, so ${toolNames[file.tool]} reads the same as now. The file as it was stays under Earlier versions.`
    : lineDiff(own, edit.text).some(line => line.kind === 'removed')
      ? `${name} will hold only the base: its ${plural(lineCount(own), 'line')} move into it with your edits, so lines you took out of the draft leave the file. The file as it was stays under Earlier versions.`
      : `Its ${plural(lineCount(own), 'line')} move into the base block, with what you added. The file as it was stays under Earlier versions.`);
  // Its own text already says what the base says (as when the base started from another tool with the same file): it stays, so
  // the tool reads it twice until that own text is removed on its card.
  if (copy === undefined && own.trim() && sameBase(own, edit.text)) return says(`Added after its own ${plural(lineCount(own), 'line')}, which already say the same, so ${toolNames[file.tool]} reads them twice. Remove its own copy on its card after saving if you don’t want that.`);
  if (copy === undefined) return says(own.trim() ? `Added after its own ${plural(lineCount(own), 'line')}.` : 'The base instructions are added.');
  return says(own.trim() ? 'Its copy of the base is updated. Its own instructions stay.' : 'Its copy of the base is updated.');
}

/** The base editor: its text, the tools that get it, and Review / Cancel (with a discard question for a typed draft). */
function editView(files: InstructionFile[], edit: BaseEdit) {
  // Read as the person types: the editor isn't redrawn on each key.
  const empty = () => !edit.text.trim();
  const reviewable = () => baseSaveDoesSomething(edit);
  const hint = () => (reviewable() ? keys : empty() ? 'Write the base instructions to review them.' : 'Make a change to review it.');
  const area = h('textarea.ins-text', { id: 'base-text', spellcheck: 'false', 'aria-label': 'Edit the base instructions',
    placeholder: 'Write what every tool should know, in Markdown. For example:\n# How I like to work\n- Explain changes before making them',
    oninput: (event: Event) => {
      const target = event.target as HTMLTextAreaElement;
      edit.text = target.value;
      // Typing answers an open discard question with "keep editing": it goes, and the caret stays where it was.
      if (edit.confirmDiscard) { edit.confirmDiscard = false; keepCaret('base-text', target.selectionStart, rerender); return; }
      // Said as you type, without redrawing the editor.
      const review = document.getElementById('base-review') as HTMLButtonElement | null;
      if (review) review.disabled = !reviewable();
      const line = document.getElementById('base-hint');
      if (line) line.textContent = hint();
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && reviewable()) { event.preventDefault(); edit.stage = 'review'; rerender(); document.getElementById('base-save')?.focus(); }
    } }) as HTMLTextAreaElement;
  area.value = edit.text;
  area.rows = Math.min(30, Math.max(6, lineCount(edit.text) + 3));
  const from = edit.source?.tool ? files.find(file => file.tool === edit.source!.tool) : undefined;
  // Esc anywhere in the editor (the text, a tool box, a button) is Cancel.
  return h('div.ins-editor', { onkeydown: escapeTo('base-cancel', 'base-keep') },
    from && edit.source?.kind === 'own' ? h('p.ins-note', {}, icon('info', 13, 'tone-muted'), h('span', {}, `${fileName(from.path)}’s instructions move into the base: ${toolNames[from.tool]} still reads them, now from the base block, and the tools you choose get them too. A line meant only for ${toolNames[from.tool]} can go back into its own instructions after saving.`)) : null,
    draftedBy(edit) ? h('p.ins-note', {}, icon('wand-sparkles', 13, 'tone-muted'), h('span', {}, `${draftedBy(edit)}’s draft. Change anything, then Review changes.`)) : null,
    staleNote(edit),
    draftedBy(edit) ? h('h3.base-subhead', {}, 'The base, for every tool') : null,
    area,
    draftedOwnEditors(files, edit),
    h('fieldset.base-tools', {}, h('legend', {}, 'Tools that get the base, after their own instructions'),
      files.filter(file => isFirstReader(file, files)).map(file => checkbox({ id: `base-tool-${file.tool}`, checked: edit.tools.includes(file.tool), onchange: checked => {
        // One file read by several tools is ticked or unticked for all of them.
        const group = readers(file);
        // Listed tools not found in this home right now stay listed.
        const absent = edit.tools.filter(tool => !files.some(entry => entry.tool === tool));
        edit.tools = [...absent, ...files.map(entry => entry.tool).filter(tool => group.includes(tool) ? checked : edit.tools.includes(tool))];
        edit.confirmDiscard = false; rerender();
      } }, ...readers(file).map(tool => brandMark(tool, 14)), h('span', {}, readerNames(file)), h('span.base-file', {}, fileName(file.path), file.sameFile.length ? ' (one file)' : '', file.exists ? '' : ' (new file)')))),
    edit.confirmDiscard
      ? h('div.ins-actions', {}, discardConfirm(draftedBy(edit) ? `${draftedBy(edit)}’s draft` : 'the base instructions', { discard: 'base-discard', keep: 'base-keep' }, 'Keep editing',
        { run: () => { state.baseEdit = undefined; }, focus: restingFocus() }, { run: () => { edit.confirmDiscard = false; }, focus: 'base-text' }, !!draftedBy(edit)))
      : h('div.ins-actions', {},
        button({ variant: 'primary', size: 'small', label: 'Review changes', id: 'base-review', disabled: !reviewable(), onclick: () => { edit.stage = 'review'; rerender(); document.getElementById('base-save')?.focus(); } }),
        button({ variant: 'ghost', size: 'small', label: draftedBy(edit) ? 'Discard the draft' : 'Cancel', id: 'base-cancel', onclick: () => {
          const ask = baseDraftTyped();
          if (ask) edit.confirmDiscard = true; else state.baseEdit = undefined;
          rerender();
          document.getElementById(ask ? 'base-keep' : restingFocus())?.focus();
        } }),
        h('span.ins-locked', { id: 'base-hint' }, hint()),
        state.base?.tools.length && !draftedBy(edit) ? button({ variant: 'link', size: 'micro', label: 'Stop sharing with every tool…', id: 'base-stop', attrs: { title: 'Review what stopping does to each tool’s file; each tool’s own instructions stay' },
          onclick: () => { Object.assign(edit, { ticksBeforeStop: edit.tools, tools: [], stage: 'review', confirmDiscard: false }); rerender(); document.getElementById('base-save')?.focus(); } }) : null));
}

/** Said where a draft a tool wrote is shown, once a file it was written from holds something else: the draft can't be saved. */
function staleNote(edit: BaseEdit) {
  const stale = draftStale(edit);
  if (!stale.length) return null;
  const names = toolList(stale.map(file => file.tool));
  return h('p.ins-note.ins-warn', { id: 'base-draft-stale' }, icon('triangle-alert', 13, 'tone-warning'),
    h('span', {}, `${names}’s ${stale.length === 1 ? 'file' : 'files'} changed after this draft was written, so the draft knows nothing of what is new there and can’t be saved. Discard it and have it written again.`));
}

/** In a draft a tool wrote: what stays only in each tool's file, to change like the base above it. An unticked tool's file
 *  stays as it is, so it has nothing to edit here. */
function draftedOwnEditors(files: InstructionFile[], edit: BaseEdit) {
  const sorted = files.filter(file => isFirstReader(file, files) && draftedOwn(readers(file), edit.own) !== undefined);
  if (!draftedBy(edit) || !sorted.length) return null;
  return h('div.base-own-list', {}, h('h3.base-subhead', {}, 'Each tool’s own instructions'),
    sorted.map(file => {
      const ticked = readers(file).some(tool => edit.tools.includes(tool));
      const key = readers(file).find(tool => edit.own?.[tool] !== undefined)!;
      const label = h('label.base-own-label', { for: `base-own-${file.tool}` }, readers(file).map(tool => brandMark(tool, 14)), h('strong', {}, readerNames(file)), h('span.base-file', {}, fileName(file.path)));
      if (!ticked) return h('div.base-own', {}, label, h('p.base-explain', {}, `Not ticked below, so ${fileName(file.path)} stays as it is.`));
      const area = h('textarea.ins-text.base-own-text', { id: `base-own-${file.tool}`, spellcheck: 'false', placeholder: `Nothing only for ${readerNames(file)}: its file will hold only the base.`,
        oninput: (event: Event) => { edit.own = { ...edit.own, [key]: (event.target as HTMLTextAreaElement).value }; } }) as HTMLTextAreaElement;
      area.value = edit.own![key]!;
      area.rows = Math.min(16, Math.max(3, lineCount(area.value) + 1));
      return h('div.base-own', {}, label, area);
    }));
}

/** A review's headline, its Save label, and the result sentence once saved (given the files written), for where the draft came from. */
function reviewWords(edit: BaseEdit, writes: InstructionFile[], putBackFile: string) {
  const before = state.base?.text ?? '';
  const { text: counts } = changeCounts(lineDiff(before, edit.text));
  const writesText = writes.length === 1 ? fileName(writes[0].path) : `${writes.length} files`;
  const from = edit.source?.tool ? toolNames[edit.source.tool] : '';
  const saved = (lead: string) => (written: string) => `${lead}${written ? ` in ${written}` : ''}.`;
  const kind = edit.source?.kind;
  if (kind === 'putBack') return { title: `Put the base instructions back in ${putBackFile}.`, save: `Put the base back in ${putBackFile}`,
    // Said only when it was written; otherwise the note after it says why not.
    done: (written: string) => (written ? `The base instructions are back in ${putBackFile}. The edited copy is under ${from}’s Earlier versions.` : `${putBackFile} was not changed.`) };
  if (kind === 'update') return { title: `Write the base instructions into ${writesText}.`, save: `Update ${writesText}`, done: (written: string) => `Updated ${written || 'nothing'} with the base instructions.` };
  const save = writes.length ? `Save and update ${writesText}` : 'Save';
  if (kind === 'version') return { title: `Going back to earlier base instructions: ${counts || 'the same text'}.`, save, done: saved('The earlier base instructions are back') };
  if (kind === 'copy') return { title: `Using ${from}’s edited copy as the base instructions: ${counts}.`, save, done: saved('Base instructions saved') };
  if (draftedBy(edit)) return { title: `${draftedBy(edit)}’s draft. Check it, then save.`, save, done: saved('Base instructions saved') };
  if (!edit.tools.length && state.base?.tools.length) return { title: 'Stop sharing the base with every tool. Each file below says what stays in it; the base is kept here for later.',
    save, done: (written: string) => `Stopped sharing the base instructions${written ? `; ${written} no longer ${written.includes(' and ') ? 'get' : 'gets'} them` : ''}. The base is kept here for later.` };
  const title = !before.trim() ? `Review the base instructions: ${plural(lineCount(edit.text), 'line')}.`
    : edit.text === before ? 'Review: the base instructions stay the same; the tools that get them change.'
    : `Review the base instructions: ${counts}.`;
  // Started from a tool's own text: the result says where that text went.
  const source = kind === 'own' ? state.instructions.data?.find(file => file.tool === edit.source!.tool) : undefined;
  return { title, save, done: (written: string) => saved('Base instructions saved')(written) + (source ? ` ${fileName(source.path)}’s instructions are now the base.` : '') };
}

function reviewView(files: InstructionFile[], edit: BaseEdit) {
  const before = state.base?.text ?? '';
  const diff = lineDiff(before, edit.text);
  // Putting the base back concerns one file, and an update only the files it writes; other reviews list each file involved.
  const kind = edit.source?.kind;
  const all = files.filter(file => isFirstReader(file, files) && (kind !== 'putBack' || file.tool === edit.source!.tool)).map(file => ({ file, plan: planFor(file, edit) })).filter(entry => entry.plan);
  const writes = all.filter(entry => entry.plan!.next !== entry.file.text);
  const plans = kind === 'update' ? writes : all;
  const putBackFile = kind === 'putBack' ? fileName(plans[0]?.file.path ?? '') : '';
  const { title, save, done } = reviewWords(edit, writes.map(entry => entry.file), putBackFile);
  const stale = draftStale(edit).length > 0;
  return h('div.ins-editor', {},
    h('p.ins-review-title', {}, title),
    edit.conflict ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `${edit.conflict} This review now shows things as they are.`)) : null,
    staleNote(edit),
    // A first base has nothing to compare with: it is shown as it is. A changed one shows what changes.
    edit.text === before ? null : before.trim() ? [legend('the base now', 'the base after saving'), diffView(diff, !!edit.fullDiff, () => { edit.fullDiff = true; rerender(); }, 'Changes to the base instructions')]
      : [h('h3.base-subhead', {}, 'The base, for every tool'), ...previewBlock(edit.text, 'base-new', 'The base instructions', 'base-new-more')],
    plans.length > 1 || (plans.length && edit.text !== before) ? h('h3.base-subhead', {}, 'Each file') : plans.length ? null : h('p.ins-empty', {}, 'No tool is chosen, so no file changes. The base instructions are kept here for later.'),
    h('ul.plain-list.base-plan', {}, plans.map(({ file, plan }) => {
      const key = `plan-${file.tool}`;
      const changes = plan!.next !== file.text;
      return h('li.base-plan-row', {},
        h('div.base-plan-line', {}, readers(file).map(tool => brandMark(tool, 14)), h('strong', {}, readerNames(file)), h('span.base-file', {}, fileName(file.path)), h('span.base-plan-says', {}, plan!.says),
          changes ? button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide changes' : 'Show changes', id: `base-${key}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) }) : null),
        changes && shown.has(key) ? [legend(`${fileName(file.path)} now`, 'after saving'), diffView(lineDiff(file.text, plan!.next), shown.has(`${key}-all`), () => { shown.add(`${key}-all`); rerender(); }, `Changes to ${fileName(file.path)}`)] : null,
        plan!.keeps?.trim() ? previewBlock(plan!.keeps, `keeps-${file.tool}`, `What ${fileName(file.path)} keeps of its own`, `base-keeps-more-${file.tool}`) : null,
        changes ? notCarried(file, edit) : null);
    })),
    // While the discard question is open it is the only decision on screen.
    edit.confirmDiscard
      ? h('div.ins-actions', {}, discardConfirm(draftedBy(edit) ? `${draftedBy(edit)}’s draft` : 'the base instructions', { discard: 'base-review-discard-yes', keep: 'base-review-keep' }, 'Keep reviewing',
        { run: () => { state.baseEdit = undefined; }, focus: restingFocus() }, { run: () => { edit.confirmDiscard = false; }, focus: 'base-save' }, !!draftedBy(edit)))
      : h('div.ins-actions', {},
        button({ variant: 'primary', size: 'small', label: save, id: 'base-save', disabled: !!state.busy || stale, attrs: lockAttrsFor(stale ? 'A file changed after this draft was written. Discard it and have it written again.' : undefined), onclick: () => {
          // Exactly the files listed above, as they were when listed: anything else changed since stops the save.
          const seen = Object.fromEntries(plans.map(({ file }) => [file.tool, { path: file.path, hash: file.hash }]));
          void applyBaseChange({ text: edit.text, tools: edit.text.trim() ? edit.tools : [], seen, ...requestOf(edit), ...(draftedBy(edit) ? { own: edit.own } : {}) }, done);
        } }),
        button({ variant: 'ghost', size: 'small', label: startedInReview(edit) ? 'Cancel' : draftedBy(edit) ? 'Edit the draft' : 'Back to editing', id: 'base-back', onclick: () => closeOrBack(edit) }),
        startedInReview(edit) ? null : button({ variant: 'ghost', size: 'small', label: draftedBy(edit) ? 'Discard the draft' : 'Discard changes', id: 'base-review-discard', onclick: () => { edit.confirmDiscard = true; rerender(); document.getElementById('base-review-keep')?.focus(); } })));
}

/**
 * Under a file a tool's draft sorted: its lines that the draft carries nowhere word for word, neither in the base nor in what
 * it kept for the file. The tool was asked to lose nothing, and this shows where to look in case it did.
 */
function notCarried(file: InstructionFile, edit: BaseEdit) {
  const drafted = readers(file).some(tool => edit.tools.includes(tool)) ? draftedOwn(readers(file), edit.own) : undefined;
  if (drafted === undefined) return null;
  const lines = linesNotCarried(splitBase(file.text).own, edit.text, drafted);
  if (!lines.length) return null;
  const key = `lost-${file.tool}`;
  return [h('p.base-explain.base-not-carried', {}, icon('triangle-alert', 13, 'tone-warning'),
    h('span', {}, lines.length === 1 ? `1 line of ${fileName(file.path)} isn’t in the draft as written. It may be reworded or left out.` : `${lines.length} lines of ${fileName(file.path)} aren’t in the draft as written. They may be reworded or left out.`),
    button({ variant: 'link', size: 'micro', label: `${shown.has(key) ? 'Hide' : 'Show'} ${lines.length === 1 ? 'it' : 'them'}`, id: `base-${key}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) })),
    shown.has(key) ? h('pre.ins-preview', { tabindex: '0', 'aria-label': `Lines of ${fileName(file.path)} not in the draft as written` }, lines.join('\n')) : null];
}

/** The base card while a tool is chosen to write a draft, and while it writes: what it will do, each tool that can, and Stop. */
function draftPickView() {
  const drafters = state.base?.drafters ?? [];
  const by = state.drafting;
  if (by) return h('div.ins-editor', {},
    h('p.ins-review-title.base-writing', { role: 'status' }, icon('refresh-cw', 14, 'spin tone-muted'), `${toolNames[by]} is writing a draft of the base instructions…`),
    h('p.base-explain', {}, 'This can take a minute or two.'),
    h('div.ins-actions', {}, button({ variant: 'outline', size: 'small', label: 'Stop', id: 'base-draft-stop', onclick: stopDraft })));
  const problem = state.draftPick?.problem;
  return h('div.ins-editor', { onkeydown: escapeTo('base-draft-cancel', 'base-draft-cancel') },
    h('p.ins-readers', {}, 'A tool reads your instruction files and splits them: what every tool should get becomes the base, and the rest stays in each tool’s file. You check the draft before anything is saved.'),
    problem ? h('p.ins-note.ins-warn', { id: 'base-draft-problem', role: 'alert', tabindex: '-1' }, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, problem)) : null,
    h('div.ins-actions', { role: 'group', 'aria-label': 'Write the draft with' },
      drafters.map(tool => button({ variant: 'outline', size: 'small', label: `Draft with ${toolNames[tool]}`, id: `base-draft-by-${tool}`, disabled: !!state.busy, onclick: () => void draftBaseWith(tool) })),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'base-draft-cancel', onclick: closeDraftPick })));
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
    h('div.base-tool-line', {}, readers(file).map(tool => brandMark(tool, 14)), h('strong', {}, readerNames(file)), h('span.base-file', {}, name), status),
    base.state !== 'edited' ? null : h('div.base-choice', {},
      h('p.base-explain', {}, `Its copy of the base was changed outside Central Knot, so ${name} was left as it is.`),
      h('p.base-explain', {}, `Either choice below shows the change first, keeps the replaced text under Earlier versions, and can be undone.`),
      shown.has(key) ? [legend('the base', `${name}’s copy`),
        diffView(lineDiff(state.base!.text, base.copy ?? ''), true, () => {}, `${name}’s copy compared with the base`)] : null,
      h('div.ins-actions', {},
        button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide the difference' : 'See the difference', id: `base-diff-${file.tool}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) }),
        // An emptied copy can't be the base (an empty base shares nothing): only putting the base back is offered.
        base.copy?.trim() ? button({ variant: 'outline', size: 'small', label: `Use ${name}’s copy as the base…`, id: `base-usecopy-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Review making ${name}’s copy the base for every tool` },
          onclick: () => startBaseEdit({ text: base.copy ?? '', tools: state.base!.tools, stage: 'review', source: { kind: 'copy', tool: file.tool } }) }) : null,
        button({ variant: 'outline', size: 'small', label: `Put the base back in ${name}…`, id: `base-restore-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Review replacing ${name}’s edited copy with the base` },
          onclick: () => startBaseEdit({ text: state.base!.text, tools: state.base!.tools, stage: 'review', source: { kind: 'putBack', tool: file.tool } }) }))));
}

/** The card above the tools: write the base once; each chosen tool's file gets it after its own instructions. */
export function baseCard(files: InstructionFile[]) {
  const base = state.base;
  if (!base) return null;
  const edit = state.baseEdit;
  const readOnly = savingOff();
  // A tool's typed draft locks the base too; one whose tool left this home (no card) waits in the band above to be copied or discarded.
  const toolDraft = toolDraftTyped() ? state.instructionEdit : undefined;
  const lockedWhy = readOnly ? 'Saving is off in this home.' : !toolDraft ? undefined
    : files.some(file => file.tool === toolDraft.tool) ? `Finish or cancel the ${fileName(toolDraft.from.path)} edit first.` : 'Copy or discard the unsaved draft above first.';
  const locked = !!state.busy || !!lockedWhy;
  const lockAttrs = lockAttrsFor(lockedWhy);
  const chosen = files.filter(file => file.base?.chosen && isFirstReader(file, files));
  const behind = chosen.filter(file => file.base!.state === 'older' || file.base!.state === 'missing');
  const others = files.filter(file => !file.base?.chosen);
  const edited = chosen.filter(file => file.base!.state === 'edited');
  const hasBase = !!base.text.trim();
  // A file still holding a block (left there edited) can't start the base: its block would stay beside the moved text.
  const starts = files.filter(file => isFirstReader(file, files) && ownText(file).trim() && file.base?.copy === undefined);

  const head = h('header.ins-head', {}, icon('layers', 18, 'tone-muted'), h('h2.tool-title', {}, 'Base instructions'),
    hasBase || edit ? pathText(shownPath(base.path), base.path) : null,
    !edit && hasBase ? h(`span.ins-missing${edited.length ? '.base-pill-warn' : ''}`, {}, (chosen.length ? `In ${plural(chosen.length, 'tool')}` : 'In no tool') + (edited.length ? ` · ${plural(edited.length, 'edited copy', 'edited copies')}` : '')) : null);

  // A tool can write a draft when one is on this computer and some file has instructions of its own to sort.
  const canDraft = !!base.drafters.length && draftable().length > 0;
  const draftButton = () => (canDraft ? button({ variant: 'outline', size: 'small', icon: 'wand-sparkles', label: 'Draft with a tool…', id: 'base-draft', disabled: locked,
    attrs: lockAttrs ?? { title: 'Have one of your tools sort your files into base instructions and what stays in each file; you review the draft before anything is saved' }, onclick: openDraftPick }) : null);
  let body: (Node | null)[];
  if (edit) body = [edit.stage === 'review' ? reviewView(files, edit) : editView(files, edit)];
  else if (state.draftPick || state.drafting) body = [draftPickView()];
  else if (!hasBase) {
    body = [
      h('p.ins-readers', {}, 'Write instructions once, and Central Knot adds them to the file of every tool you choose, after that tool’s own instructions.'),
      h('div.ins-actions.base-start', {},
        draftButton(),
        button({ variant: 'outline', size: 'small', label: 'Write base instructions', id: 'base-write', disabled: locked, attrs: lockAttrs, onclick: () => startBaseEdit({ text: '', tools: files.map(file => file.tool) }) }),
        starts.length ? h('span.base-explain', {}, 'or start from:') : null,
        starts.map(file => button({ variant: 'outline', size: 'small', label: `${toolNames[file.tool]}’s ${fileName(file.path)}`, id: `base-from-${file.tool}`, disabled: locked, attrs: lockAttrs ?? { title: `Its instructions move into the base, and the tools you choose get them too` },
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
          others.length && chosen.length ? h('p.ins-empty', {}, `Not added to ${toolList(others.map(file => file.tool))}.`) : null),
        h('div.base-column', {},
          edited.length ? h('p.base-subhead', {}, 'The base instructions') : null,
          previewBlock(base.text, 'base', 'Base instructions', 'base-more'))),
      h('div.ins-actions', {},
        button({ variant: 'outline', size: 'small', label: 'Edit text or tools', id: 'base-edit', disabled: locked, attrs: lockAttrs, onclick: () => startBaseEdit({ text: base.text, tools: base.tools }) }),
        behind.length ? button({ variant: 'outline', size: 'small', label: `Update ${behind.length === 1 ? fileName(behind[0].path) : `${behind.length} files`}…`, id: 'base-update', disabled: locked, attrs: lockAttrs ?? { title: 'Review writing the base instructions as they are now into these files' },
          onclick: () => startBaseEdit({ text: base.text, tools: base.tools, stage: 'review', source: { kind: 'update' } }) }) : null,
        draftButton(),
        lockedWhy ? h('span.ins-locked', {}, lockedWhy) : null),
    ];
  }
  const versions = edit || state.draftPick || state.drafting ? null : versionsList(base.versions, { id: version => `base-load-${version}`, disabled: locked, why: lockedWhy, run: version => void loadBaseVersion(version) });
  return h('article.card.ins-card.base-card', { id: 'base-card', 'aria-label': 'Base instructions' }, head, ...body, versions);
}

/** On a tool's card, below its own instructions: the base block it holds, kept apart and shown on request. */
export function baseStrip(file: InstructionFile, lockedWhy?: string) {
  const base = file.base;
  if (!base || base.copy === undefined) return null;
  const key = `strip-${file.tool}`;
  const lines = lineCount(base.copy);
  const said = !base.chosen ? 'not on the base list; left as it is' : base.state === 'same' ? 'matches the base' : base.state === 'edited' ? 'edited in this file' : 'an older version';
  // Edited or behind: the choice is on the Base instructions card, on the row of the first tool reading this file; this goes there.
  const row = (state.instructions.data ?? []).find(entry => entry.tool === file.tool || file.sameFile.includes(entry.tool))?.tool ?? file.tool;
  const goTo = base.chosen && base.state !== 'same' ? (base.state === 'edited' ? `base-diff-${row}` : 'base-update') : undefined;
  // The choice lives on the resting Base instructions card, which an open base editor replaces.
  const goWhy = state.baseEdit ? 'Finish or cancel the base instructions edit first.' : lockedWhy;
  return h('div.base-strip', {},
    h('div.base-strip-line', {}, icon('layers', 13, 'tone-muted'), h('span', {}, h('strong', {}, 'Then the base instructions'), ` · ${plural(lines, 'line')}, ${said}`),
      goTo ? button({ variant: 'link', size: 'micro', label: base.state === 'edited' ? 'Choose what to do…' : 'Update…', id: `ins-base-go-${file.tool}`, disabled: !!goWhy, attrs: lockAttrsFor(goWhy), onclick: () => {
        // On a harness's Instructions tab the Base instructions card isn't on the page: the choice is made on Instructions.
        if (!document.getElementById(goTo)) showPage('instructions');
        const target = document.getElementById(goTo); target?.scrollIntoView({ block: 'center' }); target?.focus();
      } }) : null,
      // Not on the list any more: its block (an edited copy the list change left) can be taken out here, after a review.
      // Hidden under its own open review, so that review is the one decision on screen.
      !base.chosen && !state.instructionEdit?.takeOut ? button({ variant: 'link', size: 'micro', label: 'Take the block out…', id: `ins-base-out-${file.tool}`, disabled: !!state.busy || !!lockedWhy, attrs: lockAttrsFor(lockedWhy), onclick: () => startTakeOut(file) }) : null,
      button({ variant: 'link', size: 'micro', label: shown.has(key) ? 'Hide' : 'Show', id: `ins-base-${file.tool}`, attrs: { 'aria-expanded': String(shown.has(key)) }, onclick: () => toggle(key) })),
    shown.has(key) ? h('pre.ins-preview.base-copy', { tabindex: '0', 'aria-label': `Base instructions in ${fileName(file.path)}` }, base.copy.replace(/\n$/, '')) : null);
}
