// Updates on the page (updates.ts has the rules and words, updater.ts does the work): the status bar's version, which becomes
// the Update button when a newer release is ready to install, and what the Settings row needs. Restarting is held, with the
// reason on the button, while something typed isn't saved.
import { announce, baseDraftTyped, rerender, showPage, toolDraftTyped } from './app.ts';
import { h, icon } from './dom.ts';
import { changesWaiting } from './matrix.ts';
import { market } from './pluginstate.ts';
import { buildWords, restartWaits, tagWords, updateButton, updateStatus } from './updates.ts';
import { plural } from './model.ts';
import type { UpdateView } from './types.ts';

/** The update state as main last told it; undefined until read. */
export const updates = { view: undefined as UpdateView | undefined, checking: false, restarting: false };
/** The update this launch came from has been said once in the status bar. */
let saidUpdated = false;
/**
 * The update button that had the focus when it was pressed. It is disabled while it works, which drops the focus; it takes
 * the focus back when it can be pressed again (a held restart, a failure), unless the person has moved on meanwhile.
 */
let focusBack: string | undefined;
const updateButtons = ['update-button', 'setting-update'];
function keepFocus() {
  const id = document.activeElement?.id;
  focusBack = id && updateButtons.includes(id) ? id : undefined;
}
function returnFocus() {
  if (!focusBack || buttonNow()?.busy) return;
  const id = focusBack;
  focusBack = undefined;
  // In Settings, Check now stands in for an Update button that is gone (the release was withdrawn).
  if (document.activeElement === document.body) (document.getElementById(id) ?? (id === 'setting-update' ? document.getElementById('check-updates') : null))?.focus();
}

/** Why restarting now would lose something typed or chosen, or nothing. Read when it matters: typing doesn't redraw the page. */
export function unsavedWork(): string | undefined {
  if (toolDraftTyped()) return 'Restarting now loses your unsaved instructions draft.';
  if (baseDraftTyped()) return 'Restarting now loses your unsaved base instructions draft.';
  const waiting = changesWaiting() + market.draft.size;
  if (waiting) return `Restarting now loses ${plural(waiting, 'change')} waiting for Apply all.`;
  return undefined;
}

function restart() {
  keepFocus();
  updates.restarting = true;
  rerender();
  void window.centralKnot.restartToUpdate().catch(() => { updates.restarting = false; announce('Couldn’t restart. Quit Central Knot and open it again to finish the update.'); rerender(); returnFocus(); });
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
  if (view.failed && view.failed !== before?.failed) { announce(view.failed); updates.restarting = false; }
  if (view.step === 'ready' && before?.step !== 'ready') {
    const held = unsavedWork();
    // What would be lost comes first: the status bar drops a message's later sentences when they don't fit.
    if (held) announce(`${held} The update is ready when you are.`);
    else restart();
  }
  if (before?.step === 'downloading' && view.step === 'downloading') { paintProgress(); return; }
  rerender();
  returnFocus();
}

export const loadUpdates = async () => takeUpdates(await window.centralKnot.updates());

/**
 * Asks main to check now (Settings, and "Check for Updates…" in the app menu: `fromMenu`). The row shows what the check
 * found, so a screen reader is told it without the status bar repeating it. Check now is disabled under the focus while the
 * check runs; it takes the focus back unless the person has moved on, and from the menu it takes it in any case.
 */
export async function checkNow(fromMenu = false) {
  updates.checking = true;
  rerender();
  announce('Checking for updates…', true);
  let found: UpdateView | undefined;
  try {
    found = await window.centralKnot.checkForUpdates();
    takeUpdates(found);
  } catch { announce('Couldn’t check for updates. Try again.'); }
  finally {
    updates.checking = false;
    rerender();
    if (fromMenu || document.activeElement === document.body) document.getElementById('check-updates')?.focus();
  }
  // A build that never checks says why instead.
  const said = found && (updateStatus(found)?.text ?? found.reason?.text);
  if (said) announce(said, true);
}

/** Starts the update: main downloads and prepares it and reports each step. */
export function startUpdate() {
  keepFocus();
  const next = updates.view?.available;
  // Said at the click, for anyone who can't see the button's tooltip: the app is going to restart, or to wait for something unsaved.
  if (next) announce(`Downloading ${tagWords(next.tag)}. ${unsavedWork() ? restartWaits : 'Central Knot restarts when it’s ready.'}`);
  void window.centralKnot.installUpdate().then(takeUpdates, () => { announce('Couldn’t start the update. Try again.'); returnFocus(); });
}

/** What the Update button says now, with the reason restarting is held, if it is. */
export const buttonNow = (view = updates.view) => (view ? updateButton(view, { held: view.step ? unsavedWork() : undefined, restarting: updates.restarting }) : undefined);

/** The Update button, in the status bar or the Settings row. A held restart restarts on click: the person has chosen. */
export function updateControl(id: string, variant: 'status' | 'setting') {
  const shown = buttonNow();
  if (!shown) return null;
  const run = updates.view?.step === 'ready' ? restart : startUpdate;
  return h(`button${variant === 'status' ? '.status-update' : '.btn.primary.default'}`, { type: 'button', id, title: shown.title, disabled: shown.busy, 'aria-busy': String(shown.busy), onclick: run },
    variant === 'status' ? icon(shown.busy ? 'clock' : shown.held ? 'triangle-alert' : 'circle-arrow-down', 14, shown.held ? 'tone-warning' : '') : null,
    // A narrow status bar shows the short label (style.css); the tooltip has it all.
    h('span.btn-label', {}, variant === 'status' && shown.short ? [h('span.update-long', {}, shown.label), h('span.update-short', {}, shown.short)] : shown.label));
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
  // A newer release this copy can't install itself: said here too, and Settings says why and links the release.
  if (view?.shown && view.available && view.reason) {
    const words = tagWords(view.available.tag);
    return [h('button.status-update', { type: 'button', id: 'update-available', title: `${words} is available. ${view.reason.text} Open Settings for the release page.`,
      onclick: () => { showPage('settings'); document.getElementById('setting-updates')?.scrollIntoView({ block: 'nearest' }); } },
      icon('circle-arrow-down', 14), h('span.btn-label', {}, h('span.update-long', {}, 'Update available'), h('span.update-short', {}, 'Update')))];
  }
  return [h('span.status-name', {}, 'Central Knot '), h('span', { id: 'status-version' }, view ? buildWords(view) : version)];
}

/** Main tells the page each step of a check or an update; the page asks once when it opens. */
export function followUpdates() {
  window.centralKnot.onUpdatesChanged(takeUpdates);
  void loadUpdates();
}
