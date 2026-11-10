// Updates on the page (updates.ts has the rules and words, updater.ts does the work): the status bar's version, which becomes
// the Update button when a newer release is ready to install, and what the Settings row needs. Restarting is held, with the
// reason on the button, while something typed isn't saved.
import { announce, baseDraftTyped, rerender, toolDraftTyped } from './app.ts';
import { h, icon } from './dom.ts';
import { changesWaiting } from './matrix.ts';
import { market } from './pluginstate.ts';
import { buildWords, tagWords, updateButton } from './updates.ts';
import { plural } from './model.ts';
import type { UpdateView } from './types.ts';

/** The update state as main last told it; undefined until read. */
export const updates = { view: undefined as UpdateView | undefined, checking: false, restarting: false };
/** The update this launch came from has been said once in the status bar. */
let saidUpdated = false;

/** Why restarting now would lose something typed or chosen, or nothing. Read when it matters: typing doesn't redraw the page. */
export function unsavedWork(): string | undefined {
  if (toolDraftTyped()) return 'Your instructions draft isn’t saved, and restarting now loses it.';
  if (baseDraftTyped()) return 'Your base instructions draft isn’t saved, and restarting now loses it.';
  const waiting = changesWaiting() + market.draft.size;
  if (waiting) return `${plural(waiting, 'change')} ${waiting === 1 ? 'waits' : 'wait'} for Apply all, and restarting now loses ${waiting === 1 ? 'it' : 'them'}.`;
  return undefined;
}

function restart() {
  updates.restarting = true;
  rerender();
  void window.centralKnot.restartToUpdate().catch(() => { updates.restarting = false; announce('Couldn’t restart. Quit Central Knot and open it again to finish the update.'); rerender(); });
}
const openPage = (url: string) => void window.centralKnot.openExternal(url).catch(() => announce('Couldn’t open the release page.'));

/**
 * Takes a new state from main. Download progress repaints only the words that show it; anything else redraws. When the update
 * is ready the app restarts into it, unless something is unsaved: then the button asks, and the status bar says why.
 */
export function takeUpdates(view: UpdateView) {
  const before = updates.view;
  updates.view = view;
  if (view.updated && !saidUpdated) {
    saidUpdated = true;
    announce(`Central Knot is now on ${tagWords(view.updated.tag)}.`, false, { label: 'Release notes', run: () => openPage(view.updated!.page) });
  }
  if (view.failed && view.failed !== before?.failed) announce(view.failed);
  if (view.step === 'ready' && before?.step !== 'ready') {
    const held = unsavedWork();
    if (held) announce(`The update is ready. ${held}`);
    else restart();
  }
  if (before?.step === 'downloading' && view.step === 'downloading') { paintProgress(); return; }
  rerender();
}

export const loadUpdates = async () => takeUpdates(await window.centralKnot.updates());

/** Asks main to check now (Settings and the app menu). */
export async function checkNow() {
  updates.checking = true;
  rerender();
  try { takeUpdates(await window.centralKnot.checkForUpdates()); } finally { updates.checking = false; rerender(); }
}

/** Starts the update: main downloads and prepares it and reports each step. */
export const startUpdate = () => void window.centralKnot.installUpdate().then(takeUpdates, () => announce('Couldn’t start the update. Try again.'));

/** What the Update button says now, with the reason restarting is held, if it is. */
export const buttonNow = (view = updates.view) => (view ? updateButton(view, { held: view.step === 'ready' ? unsavedWork() : undefined, restarting: updates.restarting }) : undefined);

/** The Update button, in the status bar or the Settings row. A held restart restarts on click: the person has chosen. */
export function updateControl(id: string, variant: 'status' | 'setting') {
  const shown = buttonNow();
  if (!shown) return null;
  const run = updates.view?.step === 'ready' ? restart : startUpdate;
  return h(`button${variant === 'status' ? '.status-update' : '.btn.primary.small'}`, { type: 'button', id, title: shown.title, disabled: shown.busy, 'aria-busy': String(shown.busy), onclick: run },
    variant === 'status' ? icon(shown.busy ? 'clock' : 'circle-arrow-down', 14) : null, h('span.btn-label', {}, shown.label));
}

/** Download progress, painted in place so a redraw never interrupts typing elsewhere on the page. */
function paintProgress() {
  const shown = buttonNow();
  for (const id of ['update-button', 'setting-update']) {
    const button = document.getElementById(id);
    if (!button || !shown) continue;
    button.title = shown.title;
    button.querySelector('.btn-label')!.textContent = shown.label;
  }
  const line = document.querySelector('#setting-updates-notice .setting-message-text');
  if (line && updates.view?.progress !== undefined) line.textContent = `Downloading ${tagWords(updates.view.available!.tag)}… ${Math.floor(updates.view.progress * 100)}%`;
}

/** The status bar's end: "Central Knot 0.5.0 preview 4", or the Update button when this copy can install a newer release. */
export function statusEnd(version: string): Node[] {
  const view = updates.view;
  const button = updateControl('update-button', 'status');
  if (button) return [button];
  return [h('span.status-name', {}, 'Central Knot'), document.createTextNode(' '), h('span', { id: 'status-version' }, view ? buildWords(view) : version)];
}

/** Main tells the page each step of a check or an update; the page asks once when it opens. */
export function followUpdates() {
  window.centralKnot.onUpdatesChanged(takeUpdates);
  void loadUpdates();
}
