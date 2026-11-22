// The editing pieces the Instructions page's tool cards and its Base instructions card share: a card's stage (Stage), diffs with
// a legend, change counts, previews (a click on one opens its editor), the open editor's box fitted under its card's head
// (fitEditors), earlier-version lists, the discard question, the keyboard hint, and the info box that holds what explains the page.
import { announce, machine, rerender } from './app.ts';
import { lineDiff, folded } from './diff.ts';
import { afterLayout, button, h, icon, offsetIn, pressWasDrag } from './dom.ts';
import { DAY_MS, plural, timeAgo } from './model.ts';
import { linesOf } from './words.ts';
import type { InstructionFile } from './types.ts';

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
const ago = (at: string, now = Date.now()) => {
  const elapsed = now - Date.parse(at);
  return elapsed < DAY_MS ? timeAgo(at, now) : `${Math.floor(elapsed / DAY_MS)} d ago`;
};

/** A card's stage (at rest, editing, reviewing): its one actions row, which goes in the card's head, and what goes under the head. */
export interface Stage { actions: HTMLElement; body: (Node | null)[] }

/** The editors' keyboard hint, once there is something to review. */
export const keys = `Esc to cancel · ${machine.modifierKey}+Enter to review`;

/** Esc inside an editor clicks its Cancel button (`cancelId`) wherever focus is in it; while the discard question is open (no
 *  Cancel shown), it answers Keep editing (`keepId`). */
export const escapeTo = (cancelId: string, keepId: string) => (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  const target = document.getElementById(cancelId) ?? document.getElementById(keepId);
  if (!target) return;
  event.preventDefault(); target.click();
};

/** "Discard your changes to X?" with Discard and Keep: each drops or keeps the draft, redraws, then focuses the given control.
 *  `whole`: what is dropped is a whole thing rather than changes to one ("Discard Codex’s draft?"). */
export function discardConfirm(what: string, ids: { discard: string; keep: string }, keepLabel: string, discard: { run: () => void; focus: string }, keep: { run: () => void; focus: string }, whole = false) {
  const then = (step: { run: () => void; focus: string }) => () => { step.run(); rerender(); document.getElementById(step.focus)?.focus(); };
  return h('span.ins-confirm', { role: 'group', 'aria-label': 'Discard changes?' }, h('span.ins-confirm-text', {}, whole ? `Discard ${what}?` : `Discard your changes to ${what}?`),
    button({ variant: 'outline', size: 'small', label: 'Discard', id: ids.discard, onclick: then(discard) }),
    button({ variant: 'ghost', size: 'small', label: keepLabel, id: ids.keep, onclick: then(keep) }));
}

/** An "Earlier versions (N)" list: each version's date, age and how far it is from now, with Restore… (which opens a review). */
export function versionsList(versions: InstructionFile['versions'], restore: { id: (version: string) => string; disabled: boolean; why?: string; run: (version: string) => void }) {
  return versions.length ? h('details.ins-versions', {}, h('summary', {}, icon('chevron-right', 12, 'tone-faint'), `Earlier versions (${versions.length})`),
    h('ul.plain-list', {}, versions.slice(0, 20).map(version => h('li.ins-version', {},
      h('span', {}, new Date(version.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), h('span.tone-faint', {}, ` (${ago(version.at)}) · ${version.differs ? `${version.differs} ${version.differs === 1 ? 'line differs' : 'lines differ'} from now` : 'same as now'}`)),
      button({ variant: 'link', size: 'micro', label: 'Restore…', id: restore.id(version.id), disabled: restore.disabled, attrs: restore.why ? { title: restore.why } : undefined, onclick: () => restore.run(version.id) }))))) : null;
}

/** Says which side of a difference is which, above it. */
export const legend = (removed: string | undefined, added: string) => h('p.base-legend', {}, removed ? h('span.base-legend-removed', {}, `− ${removed}`) : null, h('span.base-legend-added', {}, `+ ${added}`));

/** A line diff with changed words tinted, long unchanged runs folded until `showAll`; `id` keeps its scroll through a redraw. */
export function diffView(id: string, diff: { kind: 'same' | 'added' | 'removed'; text: string }[], full: boolean, showAll: () => void, label = 'Changes') {
  return h('pre.ins-diff', { id, tabindex: '0', 'aria-label': label }, folded(diff, full).map(line => line.kind === 'fold'
    ? h('button.ins-fold', { type: 'button', onclick: showAll }, `… ${plural(line.count, 'unchanged line')} · show`)
    : h(`span.ins-line.ins-${line.kind}`, {},
      h('span.ins-mark', { 'aria-hidden': 'true' }, line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''),
      h('span.ins-code', {}, ...words(line, diff), '\n'))));
}

/** "N lines changed, M added, K removed": a removed line followed by an added one is a changed line, as the person sees their edit. */
export function changeCounts(diff: { kind: string }[]) {
  let added = 0, removed = 0, altered = 0;
  for (let index = 0; index < diff.length;) {
    let r = 0, a = 0;
    while (diff[index]?.kind === 'removed') { r++; index++; }
    while (diff[index]?.kind === 'added') { a++; index++; }
    if (!r && !a) { index++; continue; }
    altered += Math.min(r, a); removed += r - Math.min(r, a); added += a - Math.min(r, a);
  }
  return { total: added + removed + altered, text: [altered ? `${plural(altered, 'line')} changed` : '', added ? `${plural(added, 'line')} added` : '', removed ? `${plural(removed, 'line')} removed` : ''].filter(Boolean).join(', ') };
}

/** Texts shown whole, by their key, across redraws (every redraw rebuilds the page). */
const shownWhole = new Set<string>();
/** Info boxes left open, by their key, across redraws (infoBox). */
const openInfo = new Set<string>();

/**
 * How a shown text opens its editor: a plain click on it, with the caret where the click landed, or Enter while it has focus,
 * with the caret at the start. A press that moves off its character before the release is a drag (dom.ts pressWasDrag): it opens
 * nothing and leaves what it selected to be copied. `start` gets the caret's place as an offset into the text as its editor holds it (each line break one
 * character, as a text box keeps them). `locked`: why the editor can't open now, the same reason its Edit button gives (the
 * card's own, or what the page is doing: app.ts acting), said in the status bar on a click.
 */
export interface EditOnClick { start: (caret: number) => void; locked?: string }

/** The offset of the point (x, y) into `pre`'s text as an editor holds it (a \r\n line break is one character there, so a \r
 *  that ends a line, before its \n or where the point stops between the two, isn't counted); its end when the point is past every
 *  character. */
function offsetAt(pre: HTMLElement, x: number, y: number): number {
  const text = pre.textContent ?? '';
  return text.slice(0, offsetIn(pre, x, y) ?? text.length).replace(/\r(?=\n|$)/g, '').length;
}

/**
 * A text shown 14 lines at a time, with "Show all N lines" / "Show less" (remembered by `key`). What is shown is the text's
 * start, so an offset into it is an offset into the text. With `edit`, the text opens its editor (EditOnClick). Its id
 * (`shown-<key>`) is what lets a click, a drag or a selection on it outlast a redraw (dom.ts keepClicksAcrossRedraws, keepSelection).
 */
export function previewBlock(text: string, key: string, label: string, moreId: string, edit?: EditOnClick) {
  const lines = linesOf(text);
  const all = shownWhole.has(key);
  const begin = (caret: number) => {
    if (!edit?.locked) edit?.start(caret);
    else announce(edit.locked);
  };
  const editable = !!edit && !edit.locked;
  return [h(`pre.ins-preview${editable ? '.ins-editable' : ''}`, { id: `shown-${key}`, tabindex: '0', 'aria-label': label, 'aria-description': editable ? 'Click or press Enter to edit' : undefined,
    onclick: edit ? (event: MouseEvent) => { const pre = event.currentTarget as HTMLElement; if (!pressWasDrag(pre)) begin(offsetAt(pre, event.clientX, event.clientY)); } : undefined,
    onkeydown: edit ? (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); begin(0); } } : undefined },
  (all ? lines : lines.slice(0, 14)).join('\n')),
  lines.length > 14 ? button({ variant: 'link', size: 'micro', label: all ? 'Show less' : `Show all ${lines.length} lines`, id: moreId, onclick: () => { if (all) shownWhole.delete(key); else shownWhole.add(key); rerender(); } }) : null];
}

/**
 * Each open editor's text box is no taller than the room under its card's head in the page's scroll area, so the head's
 * actions and the box's end show together; when they don't, opening the editor scrolls the head to the top (app.ts
 * focusEditor). Run after each drawing and each change of width (dom.ts afterLayout); a window made only shorter is fitted at
 * the next drawing.
 */
afterLayout(() => {
  for (const box of document.querySelectorAll<HTMLTextAreaElement>('.ins-card textarea.ins-text:not(.base-own-text)')) {
    const head = box.closest('.ins-card')?.querySelector('.ins-head'), page = box.closest('.scroll');
    if (!head || !page) continue;
    const room = page.clientHeight - (box.getBoundingClientRect().top - head.getBoundingClientRect().top) - 16;
    box.style.maxHeight = `${Math.max(room, 120)}px`;
  }
});

/**
 * One line that opens on a click or Enter to say more (a disclosure, never a hover tooltip), open or shut across redraws by
 * `key`. Holds what explains a page, so the page itself keeps what a person acts on.
 */
export function infoBox(key: string, id: string, label: string, ...body: (Node | null)[]) {
  return h('details.info-box', { id, open: openInfo.has(key), ontoggle: (event: Event) => { if ((event.currentTarget as HTMLDetailsElement).open) openInfo.add(key); else openInfo.delete(key); } },
    h('summary', {}, icon('info', 14, 'tone-muted'), h('span', {}, label), icon('chevron-right', 12, 'tone-faint info-box-chevron')),
    h('div.info-box-body', {}, ...body));
}
