// Instructions: each tool's own instruction file, a plain editor (opened by a click on the text or by Edit), a diff before
// saving and earlier versions (INS-01, INS-02), and the other files the tool reads with it, shown only (otherFiles); the page
// puts the Base instructions card (basecard.ts) first, then the tools' cards under a heading (one a row, two on a wide page:
// style.css .ins-tool-cards), and keeps what explains the files (who reads each, the tools' own notes) in one info box at the
// top. On each tool's card, after those files, the hooks and extensions that can add text to its sessions
// (sessionStripView, from sessionhooks.ts), and under them a plugin run made from them while they show its plugin, else above
// the cards (runStrip; the run's own place: pluginstate.ts pluginsResultPlace). A tool's card has its actions in its head at
// every stage, so a long text never hides them (the base card's, too, except while its Draft panel is open: basecard.ts).
// There is no turn-off switch: instruction files are edited, never disabled or emptied by Central Knot (the one deletion is
// an Undo of a base save removing a file that save created, while unchanged).
import { acting, announce, baseDraftTyped, draftFile, draftUnsaved, harnessTabShown, savingOff, loadInstructionVersion, ownText, saveInstructionText, rerender, shownPath, startInstructionEdit, state } from './app.ts';
import { baseCard, baseStrip } from './basecard.ts';
import { changeCounts, diffView, discardConfirm, escapeTo, infoBox, keys, legend, previewBlock, versionsList, type Stage } from './editparts.ts';
import { fileName, lineCount, toolNames } from './words.ts';
import { button, h, icon, infoMark, lockAttrs, pathText, rereadBand } from './dom.ts';
import { noToolsState } from './pages.ts';
import { brandMark, openPlugin, outcomeBand } from './matrix.ts';
import { inlineMarkdown } from './markdown.ts';
import { plural } from './model.ts';
import { canRun, hookCantRunReason, hookRow } from './hooksourceview.ts';
import { HOOK_RUN_WARN, hookStripHelp, hookStripNote, sessionStrip, type SessionGroup, type SessionStrip } from './sessionhooks.ts';
import { listingOf, runTouches } from './pluginstate.ts';
import { runBand } from './pluginspage.ts';
import type { HarnessId, InstalledPlugin, InstructionFile, InstructionPart } from './types.ts';
import { lineDiff } from './diff.ts';
import { keepLineBreaks } from './drafts.ts';
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

/** The open file's editor, or its review before saving. */
function editor(file: InstructionFile): Stage {
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
    return {
      // While the discard question is open it is the only decision on screen.
      actions: edit.confirmDiscard
        ? h('div.ins-actions', {}, discardConfirm(name, { discard: `ins-review-discard-yes-${file.tool}`, keep: `ins-review-keep-${file.tool}` }, 'Keep reviewing',
          { run: () => { state.instructionEdit = undefined; }, focus: `ins-edit-${file.tool}` }, { run: () => { edit.confirmDiscard = false; }, focus: `ins-save-${file.tool}` }))
        : h('div.ins-actions', {},
          button({ variant: 'primary', size: 'small', label: edit.takeOut ? 'Take the block out' : edit.restoring ? 'Restore this version' : file.exists ? `Save ${name}` : `Create ${name}`, id: `ins-save-${file.tool}`, disabled: acting() || !changed, onclick: () => void saveInstructionText(file, edit.text) }),
          button({ variant: 'ghost', size: 'small', label: edit.restoring ? 'Cancel' : 'Back to editing', id: `ins-back-${file.tool}`, onclick: () => leaveReview(file.tool) }),
          edit.restoring ? null : button({ variant: 'ghost', size: 'small', label: 'Discard changes', id: `ins-review-discard-${file.tool}`, onclick: () => { edit.confirmDiscard = true; rerender(); document.getElementById(`ins-review-keep-${file.tool}`)?.focus(); } })),
      body: [h('div.ins-editor', {},
        h('p.ins-review-title', {}, title),
        edit.takeOut ? h('p.base-explain', {}, `${toolNames[file.tool]}’s own instructions stay; the earlier text is kept under Earlier versions.`)
          : edit.restoring && file.base ? h('p.base-explain', {}, `This restores the whole file, including its base instructions as they were then. The base itself and the other tools’ files stay as they are.`) : null,
        empties ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `This leaves ${name} empty. ${toolNames[file.tool]} will start sessions with no instructions from it.`)) : null,
        edit.conflict ? h('p.ins-note.ins-warn', {}, icon('triangle-alert', 13, 'tone-warning'), h('span', {}, `${name} changed outside Central Knot. Your draft is kept; this review now compares it with the file as it is now.`)) : null,
        legend(`${name} now`, edit.restoring && !edit.takeOut ? 'the earlier version' : 'after saving'),
        diffView(`ins-changes-${file.tool}`, diff, !!edit.fullDiff, () => { edit.fullDiff = true; rerender(); })),
      baseStrip(file, 'Finish or cancel this edit first.')],
    };
  }
  const area = h('textarea.ins-text', { id: `ins-text-${file.tool}`, spellcheck: 'false', 'aria-label': `Edit ${name}`,
    placeholder: file.base ? `Write what only ${toolNames[file.tool]} should know (the base instructions stay after it). For example:\n# Only for ${toolNames[file.tool]}\n- …`
      : `Write what ${toolNames[file.tool]} should always know, in Markdown. For example:\n# How I like to work\n- Explain changes before making them`,
    oninput: (event: Event) => {
      const target = event.target as HTMLTextAreaElement;
      edit.text = keepLineBreaks(edit.from.text, target.value);
      if (edit.confirmDiscard) { edit.confirmDiscard = false; rerender(); return; }
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
    ? h('div.ins-actions', {}, discardConfirm(name, { discard: `ins-discard-${file.tool}`, keep: `ins-keep-${file.tool}` }, 'Keep editing',
      { run: () => { state.instructionEdit = undefined; }, focus: `ins-edit-${file.tool}` }, { run: () => { edit.confirmDiscard = false; }, focus: `ins-text-${file.tool}` }))
    : h('div.ins-actions', {},
      button({ variant: 'primary', size: 'small', label: file.exists ? 'Review changes' : 'Review new file', id: `ins-review-${file.tool}`, disabled: !draftUnsaved(), onclick: () => { edit.stage = 'review'; rerender(); document.getElementById(`ins-save-${file.tool}`)?.focus(); } }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: `ins-cancel-${file.tool}`, onclick: () => { const ask = draftUnsaved(); if (ask) edit.confirmDiscard = true; else state.instructionEdit = undefined; rerender(); document.getElementById(ask ? `ins-keep-${file.tool}` : `ins-edit-${file.tool}`)?.focus(); } }),
      h('span.ins-locked', { id: `ins-hint-${file.tool}` }, draftUnsaved() ? keys : file.exists ? 'Make a change to review it.' : 'Write something to review it.'));
  return { actions, body: [h('div.ins-editor', {},
    file.exists ? null : h('p.ins-empty', {}, `New file: saving creates ${name} here.`),
    file.base ? h('p.base-explain', {}, `${toolNames[file.tool]}’s own instructions. The base instructions stay after them, as they are.`) : null,
    area), baseStrip(file, 'Finish or cancel this edit first.')] };
}

/** This card's last save, shown on the card itself so nothing on the page moves; its Undo stays while other cards are edited. */
const savedHere = (file: InstructionFile) => draftFile() !== file && state.outcome?.page === state.page && state.outcome.tool === file.tool && state.outcome.kind === 'saved';

/** The file holds a copy of the base, so its tool reads base instructions whatever its own text says. */
const holdsBase = (file: InstructionFile) => file.base?.copy !== undefined;

/**
 * A card at rest: its own text, which a click or Enter opens in the editor as Edit does, under the same lock (`lockedWhy`, or else
 * whatever the page is doing: app.ts acting), then the base block it holds; and its one action, with the card's own reason and
 * `goTo` beside it. With no text of its own, the action says whose instructions it adds, and whether they come on top of the base.
 */
function resting(file: InstructionFile, lockedWhy: string | undefined, goTo: Node | null): Stage {
  const own = ownText(file);
  const name = toolNames[file.tool];
  const label = own.trim() ? 'Edit' : holdsBase(file) ? `Add additional instructions for ${name}` : `Add instructions for ${name}`;
  const held = lockedWhy ?? acting();
  return {
    actions: h('div.ins-actions', {},
      button({ variant: 'outline', size: 'small', label, id: `ins-edit-${file.tool}`, disabled: held ?? false, attrs: lockAttrs(held), onclick: () => startInstructionEdit(file) }),
      lockedWhy ? h('span.ins-locked', {}, lockedWhy, goTo ? [' ', goTo] : null) : null),
    body: [h('div.ins-body', {},
      file.exists && own.trim() ? previewBlock(own, file.tool, `${fileName(file.path)} contents`, `ins-more-${file.tool}`, { start: caret => startInstructionEdit(file, caret), locked: held })
        : file.exists && !holdsBase(file) ? h('p.ins-empty', {}, 'The file is empty.') : null,
      baseStrip(file, lockedWhy))],
  };
}

/** The other files whose text is open on their card, by tool and path, across redraws. */
const openParts = new Set<string>();
/** Each part's own number, by tool and path, given when it is first drawn: its controls' ids, distinct for every path. */
const partNumbers = new Map<string, number>();
const numberOf = (key: string) => partNumbers.get(key) ?? partNumbers.set(key, partNumbers.size).size - 1;
/** An opened part longer than this many lines has a second Hide at its end, so its closer is in reach from there too. */
const LONG_PART = 30;

/**
 * The other files a tool reads with its own (instructionparts.ts), after its file and base strip: under "Also read with" the
 * file's name, those read in every session, then those read only for matching files, each in the tool's order.
 */
function otherFiles(file: InstructionFile) {
  if (!file.parts?.length) return null;
  const heading = `Also read with ${fileName(file.path)}`;
  const group = (title: string, parts: InstructionPart[]) => (parts.length ? h('div.ins-parts-group', {}, h('p.ins-parts-sub', {}, title), parts.map(part => partView(file.tool, part))) : null);
  return h('section.ins-parts', { id: `ins-parts-${file.tool}`, 'aria-label': heading },
    h('p.ins-parts-head', {}, icon('link', 13, 'tone-muted'), h('strong', {}, heading)),
    group('In every session', file.parts.filter(part => !part.only)), group('Only for matching files', file.parts.filter(part => part.only)));
}

/**
 * One part: a line with where it comes from, its scope, whose own file it is when another tool's, and its size; or why it isn't
 * shown; or, in the warning tone, why the tool can't read it. Show opens its text below as quoted text (a plugin file's look) and
 * Hide closes it, in place: the card is not redrawn, so an editor open on it keeps its caret. Keyed by its path, not its place.
 */
function partView(tool: HarnessId, part: InstructionPart): HTMLElement {
  const key = `${tool}:${part.path}`, open = openParts.has(key), id = `ins-part-${tool}-${numberOf(key)}`;
  const toggle = () => {
    if (open) openParts.delete(key); else openParts.add(key);
    const next = partView(tool, part);
    view.replaceWith(next);
    next.querySelector<HTMLElement>(`#${id}`)?.focus();
  };
  const press = (pressId: string) => button({ variant: 'link', size: 'micro', label: open ? 'Hide' : 'Show', id: pressId, attrs: { 'aria-expanded': String(open) }, onclick: toggle });
  const shown = 'text' in part ? (part.text ? plural(lineCount(part.text), 'line') : 'empty') : 'notShown' in part ? part.notShown : part.problem;
  const says = [part.from, part.only && `for ${part.only}`, part.ownedBy && `${toolNames[part.ownedBy]}’s own file: edited on its card`, shown];
  const view = h('div.ins-part', { 'data-path': part.path },
    h('div.ins-part-line', {}, pathText(shownPath(part.path), part.path),
      h(`span.ins-part-says${'problem' in part ? '.tone-warning' : ''}`, {}, 'problem' in part ? icon('triangle-alert', 12) : null, says.filter(Boolean).join(' · ')),
      'text' in part ? press(id) : null),
    'text' in part && open ? h('pre.content.mono', { id: `${id}-text`, tabindex: '0', 'aria-label': `${fileName(part.path)} contents` }, part.text.replace(/\n$/, '')) : null,
    'text' in part && open && lineCount(part.text) > LONG_PART ? h('div.ins-part-end', {}, press(`${id}-end`)) : null);
  return view;
}

/**
 * One tool's file: shown on Instructions for every tool, and on that tool's Harnesses page. `titled`: false on a harness's
 * page, where the header already names the tool, so the card leads with the file's path. `goToOther`: where the open
 * draft's own card is on another page (another harness's), a link goes there.
 */
interface HookStripPage {
  marked: boolean;
  anyRunnable: boolean;
}

const stripHasRunnable = (strip?: SessionStrip): boolean =>
  !!strip?.groups.some(group => group.hooks.some(hook => canRun(hook.source)));

export function instructionCard(file: InstructionFile, { titled = true, goToOther, hookInfo }: { titled?: boolean; goToOther?: (tool: HarnessId) => void; hookInfo?: HookStripPage } = {}) {
  const editing = draftFile() === file;
  // An open editor with no changes locks nothing: Edit elsewhere just moves to that file. A changed one asks first.
  const toolDirty = !editing && draftUnsaved();
  const otherDirty = toolDirty || baseDraftTyped();
  const readOnly = savingOff();
  const lockedWhy = readOnly ? 'Saving is off in this home.' : baseDraftTyped() ? 'Finish or cancel the base instructions edit first.'
    : !toolDirty ? undefined : draftFile() ? `Finish or cancel the ${fileName(state.instructionEdit!.from.path)} edit first.` : 'Copy or discard the unsaved draft above first.';
  // Where the edit that locks this card is open on another page (another harness's), a link goes there.
  const open = otherDirty && goToOther ? draftFile() : undefined;
  const goTo = open ? button({ variant: 'link', size: 'micro', label: `Go to ${toolNames[open.tool]}’s file`, id: `ins-go-${open.tool}`, disabled: !!state.busy, onclick: () => goToOther!(open.tool) }) : null;
  const stage = editing ? editor(file) : resting(file, lockedWhy, goTo);
  // Esc anywhere in the card while its editor is open (the text, a button in its head) is Cancel.
  const escape = editing && state.instructionEdit!.stage === 'edit' ? escapeTo(`ins-cancel-${file.tool}`, `ins-keep-${file.tool}`) : undefined;
  return h('article.card.ins-card', { 'aria-label': `${toolNames[file.tool]} instructions`, onkeydown: escape },
    h('header.ins-head', { id: `ins-head-${file.tool}` },
      h('div.ins-title', {}, titled ? [brandMark(file.tool, 18), h('h3.tool-title', {}, toolNames[file.tool])] : null, pathText(shownPath(file.path), file.path),
        file.exists || editing ? null : h('span.ins-missing', {}, 'No file yet'),
        savedHere(file) ? h('span.ins-saved-group', { 'data-outcome': '' }, h('span.ins-missing.ins-saved', {}, 'Saved'),
          state.outcome!.act ? button({ variant: 'link', size: 'micro', label: 'Undo save', id: state.outcome!.act.id, attrs: { title: 'Put back the text this save replaced' }, onclick: () => state.outcome!.act!.run() }) : null) : null,
        editing ? h('span.ins-missing.ins-draft', { id: `ins-draft-${file.tool}`, hidden: !draftUnsaved() }, 'Unsaved changes') : null),
      stage.actions),
    stage.body,
    otherFiles(file),
    sessionStripView(file, hookInfo),
    versionsList(file.versions, { id: version => `ins-load-${file.tool}-${version}`, disabled: !!acting() || readOnly || otherDirty || (editing && draftUnsaved()),
      why: editing ? 'Finish or cancel this edit first.' : lockedWhy, run: version => void loadInstructionVersion(file, version) }));
}

/**
 * The strip on a tool's card after the files read with it (sessionhooks.ts sessionStrip): its heading (with T1.23's mark on
 * the first hooks strip of a page), the standing run warning when any row can run, the tool's note (T2.28 where it applies),
 * then each origin by its mark and name with where it is turned off, what couldn't be read, and each hook beneath it: when
 * it runs, its command, and its Run it / View source controls (hooksourceview.ts).
 */
function sessionStripView(file: InstructionFile, hookInfo?: HookStripPage) {
  const strip = sessionStrip(file.tool, state.home?.pluginItems ?? [], file);
  if (!strip) return null;
  const isHooks = strip.heading === 'Hooks that can add text';
  const hasRunnable = stripHasRunnable(strip);
  const showMark = isHooks && (!hookInfo || !hookInfo.marked);
  if (showMark && hookInfo) hookInfo.marked = true;
  const mark = showMark ? infoMark('session-hooks-info', strip.heading, hookStripHelp(file.tool, hookInfo ? hookInfo.anyRunnable : hasRunnable)) : null;
  const whyNot = isHooks && !hasRunnable && strip.groups.some(group => group.hooks.length) ? hookCantRunReason(file.tool) : undefined;
  const note = hookStripNote(file.tool, strip, hasRunnable);
  const where = ({ plugin, settings, says }: SessionGroup, at: number) => (plugin?.listed
    ? button({ variant: 'link', size: 'micro', label: 'Plugin’s page: turn it off there', id: `session-page-${file.tool}-${at}`, onclick: () => openPlugin({ source: plugin.source, plugin: plugin.plugin, marketplace: plugin.marketName, tool: file.tool }) })
    : settings ? h('span.session-in', {}, 'in ', pathText(shownPath(settings), settings)) : says ? h('span', {}, says) : null);
  const warning = (words: string, path?: string) => h('p.session-warning.tone-warning', {}, icon('triangle-alert', 12), h('span', {}, words, path ? pathText(shownPath(path), path) : null));
  const warnLine = hasRunnable ? h('p.session-run-warn', {}, HOOK_RUN_WARN) : whyNot ? h('p.session-note', {}, whyNot) : null;
  return h('section.session-strip', { id: `session-${file.tool}`, 'aria-label': `${strip.heading}: ${toolNames[file.tool]}` },
    h('div.session-strip-head', mark ? { 'data-info-block': true } : {},
      h('div.session-title-row', {}, h('h4.session-title', {}, strip.heading), mark),
      warnLine),
    note ? h('p.session-note', {}, ...inlineMarkdown(note, () => undefined)) : null,
    strip.groups.length ? h('ul.session-groups', {}, strip.groups.map((group, at) => h('li.session-group', {},
      h('p.session-head', {}, h(`span.origin-mark.${group.mark}`, { 'aria-hidden': 'true' }), h('strong.session-name', {}, group.settings ? `${group.name},` : group.name), where(group, at)),
      group.problem ? warning(group.problem) : null,
      ...group.unread.map(path => (path === group.settings ? warning('Its hooks couldn’t be read.') : warning('Its hooks couldn’t be read: ', path))),
      group.hooks.length ? h('ul.session-hooks', {}, group.hooks.map((hook, row) => hookRow(hook, `hook-source-${state.page}-${file.tool}-${at}-${row}`))) : null))) : null,
    runStrip() === file.tool ? runBand() : null);
}

/**
 * Which tool's strip says the last plugin run made on this page or tab (pluginspage.ts runBand): the one tool its clicks and steps
 * were in, while that tool's card is shown here and its strip still shows the group of the plugin its first click or step acted on.
 * Else the band is above the cards (instructionBands): once that group is gone (an Off takes it away); for a run in more than one
 * tool, which neither strip speaks for; and until the Plugins page's view is read, since the group is matched as listed there
 * (pluginstate.ts listingOf).
 */
function runStrip(): HarnessId | undefined {
  const touched = runTouches(), [first] = touched, tools = new Set(touched.map(each => each.tool));
  const file = first && tools.size === 1 ? state.instructions.data?.find(each => each.tool === first.tool && (state.page === 'instructions' || each.tool === state.harness)) : undefined;
  if (!first || !file) return undefined;
  const ours = (install?: InstalledPlugin) => install?.plugin === first.plugin && listingOf(install.plugin, install.marketName, install.source)?.source === first.source;
  return sessionStrip(file.tool, state.home?.pluginItems ?? [], file)?.groups.some(group => ours(group.plugin)) ? file.tool : undefined;
}

/**
 * What explains the files, behind one info box at the top of the page (and of a harness's Instructions tab, for its one file):
 * how they are read and saved, what the base does (with `base`), and who reads each file, with its tool's own notes.
 */
export function aboutInstructions(files: InstructionFile[], base: boolean): HTMLElement {
  return infoBox('about-instructions', 'ins-about', 'How these files are read',
    h('p', {}, 'Each tool reads its own file when a session starts. Changes are reviewed before saving, and earlier versions are kept on each card. Automatic sync leaves these files alone; base instructions change them only when you save.'),
    base ? h('p', {}, 'Base instructions are kept after each chosen tool’s own instructions, in its file. Saving them updates every chosen file; a copy edited outside Central Knot stays as it is until you choose. Each tool’s own text stays as it is.') : null,
    h('ul.plain-list.info-box-files', {}, files.map(file => h('li', {}, brandMark(file.tool, 14),
      h('div', {}, h('p', {}, h('strong', {}, fileName(file.path)), ` · ${file.readers}`),
        file.notes.map(note => h('p', {}, note)),
        holdsBase(file) && !ownText(file).trim() ? h('p', {}, `No instructions of its own: ${toolNames[file.tool]} reads only the base instructions.`) : null)))));
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
  const items = state.home?.pluginItems ?? [];
  const anyRunnable = files.some(file => stripHasRunnable(sessionStrip(file.tool, items, file)));
  const hookInfo: HookStripPage = { marked: false, anyRunnable };
  return h('div.page', {}, instructionBands(),
    h('div.scroll.cards-scroll', { id: 'instructions-scroll' },
      aboutInstructions(files, !!state.base),
      baseCard(files),
      h('div.ins-section-head', {}, h('h2.ins-section-title', {}, 'Each tool’s own instructions')),
      h('div.ins-tool-cards', {}, files.map(file => instructionCard(file, { hookInfo })))));
}

/** Shown while the files are not here yet: their read is under way, or it failed (Refresh reads again). */
export const instructionsNotRead = (): HTMLElement => h('p.empty', {}, state.instructions.state === 'failed' ? 'Instruction files could not be read.' : 'Reading instruction files…');

/**
 * The bands above instruction cards: a re-read under way, an orphaned draft, the last result (a save's own result sits on its card
 * instead), the last plugin run when its strip no longer shows it (runStrip) and, where saving is off, why.
 */
export function instructionBands(): HTMLElement | null {
  const done = state.outcome?.kind === 'saved' ? null : outcomeBand();
  const run = runStrip() ? null : runBand();
  const access = state.home?.sync.access;
  const preview = access && !access.allowed ? h('div.band', { role: 'status' }, icon('lock', 14, 'tone-warning'), h('span.band-text', {}, 'Preview only: you can read these files here, but saving is off in this home.')) : null;
  const orphan = orphanDraft();
  const reread = rereadBand(state.instructions);
  return done || run || preview || orphan || reread ? h('div.bands', {}, reread, orphan, done, run, preview) : null;
}
