// The editing pieces the Instructions page's tool cards and its Base instructions card share: diffs with a legend, change
// counts, previews, earlier-version lists, the discard question and the keyboard hint.
import { rerender } from './app.ts';
import { lineDiff, folded } from './diff.ts';
import { button, h, icon } from './dom.ts';
import { plural } from './model.ts';
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
const ago = (at: string) => {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};

/** The editors' keyboard hint, once there is something to review. */
export const keys = `Esc to cancel · ${navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to review`;

/** Esc inside an editor clicks its Cancel button (`cancelId`), wherever focus is in it. */
export const escapeTo = (cancelId: string) => (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  const cancel = document.getElementById(cancelId);
  if (!cancel) return;
  event.preventDefault(); cancel.click();
};

/** Redraws, then puts focus and the caret back in the text box `id` at `at`. */
export const keepCaret = (id: string, at: number, redraw: () => void) => {
  redraw();
  const area = document.getElementById(id) as HTMLTextAreaElement | null;
  area?.focus(); area?.setSelectionRange(at, at);
};

/** "Discard your changes to X?" with Discard and Keep: each drops or keeps the draft, redraws, then focuses the given control. */
export function discardConfirm(what: string, ids: { discard: string; keep: string }, keepLabel: string, discard: { run: () => void; focus: string }, keep: { run: () => void; focus: string }) {
  const then = (step: { run: () => void; focus: string }) => () => { step.run(); rerender(); document.getElementById(step.focus)?.focus(); };
  return h('span.ins-confirm', { role: 'group', 'aria-label': 'Discard changes?' }, h('span.ins-confirm-text', {}, `Discard your changes to ${what}?`),
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

/** A line diff with changed words tinted, long unchanged runs folded until `showAll`. */
export function diffView(diff: { kind: 'same' | 'added' | 'removed'; text: string }[], full: boolean, showAll: () => void, label = 'Changes') {
  return h('pre.ins-diff', { tabindex: '0', 'aria-label': label }, folded(diff, full).map(line => line.kind === 'fold'
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

/** Cards whose whole file is shown, for reading without editing. */
const open = new Set<string>();

/** A text shown 14 lines at a time, with "Show all N lines" / "Show less" (remembered by `key`). */
export function previewBlock(text: string, key: string, label: string, moreId: string) {
  const lines = linesOf(text);
  const all = open.has(key);
  return [h('pre.ins-preview', { tabindex: '0', 'aria-label': label }, (all ? lines : lines.slice(0, 14)).join('\n')),
    lines.length > 14 ? button({ variant: 'link', size: 'micro', label: all ? 'Show less' : `Show all ${lines.length} lines`, id: moreId, onclick: () => { if (all) open.delete(key); else open.add(key); rerender(); } }) : null];
}
