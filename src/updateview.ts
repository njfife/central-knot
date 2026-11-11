// Updates on the page (updates.ts has the rules and the words, updateflow.ts and updater.ts do the work in main):
// - the sidebar's update control at the bottom left (sidebarEnd), always there: the quiet circular arrows (Check now), which
//   become the Update button that stands out when a newer release is found, with the download, the held restart and the
//   failures on it;
// - the status bar's end (statusEnd): the build's name and version, nothing more;
// - what Settings' Updates row needs: its Update button (settingUpdateButton) and Check now (checkNow).
// Restarting is held while something typed isn't saved or changes wait for Apply all: the control then opens Settings, whose
// Updates row says what restarting would lose beside its own Restart button.
import { announce, baseDraftTyped, rerender, showPage, state, toolDraftTyped } from './app.ts';
import { h, icon } from './dom.ts';
import { changesWaiting } from './matrix.ts';
import { market } from './pluginstate.ts';
import { buildWords, restartWaits, tagWords, updateButton, updateIndicator, updateStatus } from './updates.ts';
import { plural } from './model.ts';
import type { UpdateView } from './types.ts';

/** The update state as main last told it (undefined until read); a check or a restart the page asked for and awaits. */
export const updates = { view: undefined as UpdateView | undefined, checking: false, restarting: false };
/** The update this launch came from has been said once in the status bar. */
let saidUpdated = false;
/**
 * The update control that had the focus when it was pressed (the sidebar's, or Settings' Update or Check now). It is disabled
 * while it works, which drops the focus; it takes the focus back when it can be pressed again (a check ended, a held restart, a
 * failure), unless the person has moved on meanwhile.
 */
let focusBack: string | undefined;
const updateButtons = ['update-control', 'setting-update', 'check-updates'];
function keepFocus() {
  const id = document.activeElement?.id;
  focusBack = id && updateButtons.includes(id) ? id : undefined;
}
function returnFocus() {
  if (!focusBack || buttonNow()?.busy) return;
  // In Settings, Check now stands in for an Update button that is gone (the release was withdrawn).
  const target = document.getElementById(focusBack) ?? (focusBack === 'setting-update' ? document.getElementById('check-updates') : null);
  // Still disabled (a check that hasn't ended): asked again once it has.
  if (target instanceof HTMLButtonElement && target.disabled) return;
  focusBack = undefined;
  if (document.activeElement === document.body) target?.focus();
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
/** Settings, scrolled to its Updates row: where a copy that can't update itself, or doesn't check, says why. */
function openUpdatesRow() {
  showPage('settings');
  document.getElementById('setting-updates')?.scrollIntoView({ block: 'nearest' });
}

/**
 * Takes a new state from main. Download progress repaints only what shows it; anything else redraws. When the update is
 * ready the app restarts into it, unless something is unsaved: then the control asks, and the status bar says why. A newer
 * release found by a check, the person's or the clock's, is told to screen readers: the control's new look says it to the eye.
 */
export function takeUpdates(view: UpdateView) {
  const before = updates.view;
  updates.view = view;
  if (view.updated && !saidUpdated) {
    saidUpdated = true;
    announce(`Central Knot is now on ${tagWords(view.updated.tag)}.`, false, { label: 'Release notes', run: () => openPage(view.updated!.page) });
  }
  if (view.available && view.available.tag !== before?.available?.tag) {
    const news = document.getElementById('update-news');
    if (news) news.textContent = `Central Knot ${tagWords(view.available.tag)} is available.`;
  }
  if (view.failed && view.failed !== before?.failed) { announce(view.failed); updates.restarting = false; }
  if (view.step === 'ready' && before?.step !== 'ready') {
    const held = unsavedWork();
    // What would be lost comes first: the status bar drops a message's later sentences when they don't fit.
    if (held) announce(`${held} The update is ready when you are.`);
    else restart();
  }
  if (before?.step === 'downloading' && view.step === 'downloading') { paintProgress(); return; }
  // A check that started, or ended finding nothing new, changes only the sidebar's control: it alone is drawn again, so a check
  // every quarter of an hour never redraws the page under someone typing. Settings' row says the check, so there the page is.
  if (before && sameOffer(before, view) && state.page !== 'settings') paintSidebarEnd();
  else rerender();
  returnFocus();
}
/** Nothing but the check's own state differs between two views. */
const sameOffer = (a: UpdateView, b: UpdateView) =>
  a.available?.tag === b.available?.tag && a.available?.zip === b.available?.zip && a.step === b.step && a.failed === b.failed
  && a.reason?.key === b.reason?.key && a.updated?.tag === b.updated?.tag && a.checked?.failed === b.checked?.failed;

export const loadUpdates = async () => takeUpdates(await window.centralKnot.updates());

/**
 * Asks main to check now: the sidebar control, Settings' Check now, or "Check for Updates…" in the app menu (`fromMenu`, which
 * opens Settings first). What the check found is said in the status bar, and on Settings, whose row shows it, to screen readers
 * alone. The control pressed is disabled while the check runs; it takes the focus back unless the person has moved on, and
 * from the menu Check now takes it in any case.
 */
export async function checkNow(fromMenu = false) {
  keepFocus();
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
    if (fromMenu) document.getElementById('check-updates')?.focus();
    else returnFocus();
  }
  // A build that never checks says why instead.
  const said = found && (updateStatus(found)?.text ?? found.reason?.text);
  if (said) announce(said, state.page === 'settings');
}

/** Starts the update: main downloads and prepares it and reports each step. */
export function startUpdate() {
  keepFocus();
  const next = updates.view?.available;
  // Said at the click, for anyone who can't see the control's tooltip: the app is going to restart, or to wait for something unsaved.
  if (next) announce(`Downloading ${tagWords(next.tag)}. ${unsavedWork() ? restartWaits : 'Central Knot restarts when it’s ready.'}`);
  void window.centralKnot.installUpdate().then(takeUpdates, () => { announce('Couldn’t start the update. Try again.'); returnFocus(); });
}

/** What the Update button says now, with the reason restarting is held, if it is. */
export const buttonNow = (view = updates.view) => (view ? updateButton(view, { held: view.step ? unsavedWork() : undefined, restarting: updates.restarting }) : undefined);
/** What the sidebar control shows now. */
const indicatorNow = (view = updates.view) => (view ? updateIndicator(view, { held: view.step ? unsavedWork() : undefined, restarting: updates.restarting, checking: updates.checking }) : undefined);

/** Settings' Update button, while there is an update this copy can install. A held restart restarts on click: the person has chosen. */
export function settingUpdateButton() {
  const shown = buttonNow();
  if (!shown) return null;
  return h('button.btn.primary.default', { type: 'button', id: 'setting-update', title: shown.title, disabled: shown.busy, 'aria-busy': String(shown.busy), onclick: updates.view?.step === 'ready' ? restart : startUpdate },
    h('span.btn-label', {}, shown.label));
}

/**
 * The sidebar's end: the update control, or nothing where there are no releases (only Macs have them). In the folded sidebar
 * (the rail) its label is hidden like every row's (style.css) and its name and tooltip say it whole.
 */
export function sidebarEnd(): Node[] {
  const shown = indicatorNow();
  if (!shown) return [];
  // Typing doesn't redraw the page, so a draft typed since the control was drawn is looked for again at the click.
  const restartUnlessHeld = () => (unsavedWork() ? openUpdatesRow() : restart());
  const click = { check: () => void checkNow(), update: startUpdate, restart: restartUnlessHeld, settings: openUpdatesRow }[shown.does];
  const glyph = h(`span.update-glyph${shown.progress !== undefined ? '.with-progress' : ''}`, {}, icon(shown.glyph, 16, shown.look === 'checking' ? 'spin' : shown.glyph === 'triangle-alert' ? 'tone-warning' : ''));
  // The download's progress rings the icon (style.css), set as a property: the page's CSP allows that where a style attribute isn't.
  if (shown.progress !== undefined) glyph.style.setProperty('--progress', String(shown.progress));
  return [h('button.nav-row.update-control', { type: 'button', id: 'update-control', 'data-look': shown.look, 'aria-label': shown.name, title: shown.title, disabled: shown.busy, 'aria-busy': String(shown.busy), onclick: click },
    glyph, h('span.nav-label', {}, shown.label))];
}

/** The sidebar's control drawn again on its own (renderer.ts draws it with the rest of the sidebar on a redraw). */
function paintSidebarEnd() {
  document.getElementById('sidebar-end')?.replaceChildren(...sidebarEnd());
}

/** Download progress, painted in place so a redraw never interrupts typing elsewhere on the page. */
function paintProgress() {
  const control = document.getElementById('update-control');
  const shown = indicatorNow();
  if (control && shown) {
    control.title = shown.title;
    control.setAttribute('aria-label', shown.name);
    control.querySelector('.nav-label')!.textContent = shown.label;
    control.querySelector<HTMLElement>('.update-glyph')!.style.setProperty('--progress', String(shown.progress ?? 0));
  }
  const button = document.getElementById('setting-update');
  const words = buttonNow();
  if (button && words) { button.title = words.title; button.querySelector('.btn-label')!.textContent = words.label; }
  const line = document.querySelector('#setting-updates-notice .setting-message-text');
  if (line && updates.view?.progress !== undefined) line.textContent = `Downloading ${tagWords(updates.view.available!.tag)}… ${Math.floor(updates.view.progress * 100)}%`;
}

/** The status bar's end: the build's name and version, "Central Knot 0.5.0 preview 4". The update itself is the sidebar's. */
export function statusEnd(version: string): Node[] {
  const view = updates.view;
  return [h('span.status-name', {}, 'Central Knot '), h('span', { id: 'status-version' }, view ? buildWords(view) : version)];
}

/** Main tells the page each step of a check or an update; the page asks once when it opens. */
export function followUpdates() {
  window.centralKnot.onUpdatesChanged(takeUpdates);
  void loadUpdates();
}
