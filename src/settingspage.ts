// Settings: Central Knot's own preferences, kept apart from the tools' settings. The main process stores them
// (app-settings.json) and applies them; this page shows them, one full-width row each, and changes one at a time. History's
// time control (historyWindowControl, openHistoryWindow) is shared with historypage.ts. Under "This
// home" sit two per-home switches: Synchronize everything, kept in the home's sync record (share.ts SyncRecord syncEverything)
// and switched through app.ts switchSyncEverything, and Keep session costs, kept per canonical home in app-settings.json
// (sessionkeep.ts). Help's Log row also shows Central Knot's own log under it (Show log: its
// last lines, read by main.ts readLog, never stored); the log is written by main.ts log. A settings file that couldn't be read at
// launch is said in a note at the top (keptNote) until it is closed, and first on the Overview (overview.ts needsYou).
import { acting, announce, keepingBusy, loadHistory, machine, rerender, switchSessionCosts, switchSyncEverything, showPage, state, whyReadOnly } from './app.ts';
import { outcomeBand } from './matrix.ts';
import { button, h, icon, infoCardId, infoMark, toggle } from './dom.ts';
import type { IconName } from './icons.ts';
import { DAY_MS, defaultHistoryDays, historyDayChoices } from './model.ts';
import { openWalkthrough } from './firstsetup.ts';
import { whatYesDoes, takenOutEarlier } from './setupcounts.ts';
import { plural } from './model.ts';
import type { AppPreferences, Appearance, HistoryDays, HistoryPrune, HistoryWindowSaved, LogTail, PluginTextView, SignInPlace } from './types.ts';
import { libraryWords, sentences } from './libraryrow.ts';
import { buildWords, releasesPage, tagWords, updateStatus } from './updates.ts';
import { checkNow, settingUpdateButton, unsavedWork, updates } from './updateview.ts';
import { checkPluginsNow, checkedWords, pluginUpdates } from './pluginupdateview.ts';
import { pageNames } from './words.ts';

/** The settings as last read from the main process; undefined until the page has loaded them. */
let current: AppPreferences | undefined;

/**
 * A line beneath a row: a note on what its last action did (note: where it went; info: what is still to come), why it failed,
 * that the system ignored it (attention), or how the system has the setting now (system), with an `action` that takes the
 * person there; that the row's change is still under way (progress), or what it did that can't be seen in the row (done).
 * `detail` follows the text in the hint's colour. `about` is the row's value it describes, as `shownIn`.
 */
interface RowMessage { text: string; detail?: string; tone: 'note' | 'info' | 'failure' | 'attention' | 'system' | 'progress' | 'done'; action?: { label: string; run: () => void }; about?: string }
/** What each row's last action said, by row id. */
const messages = new Map<string, RowMessage>();
/** What each row shows of the settings, so a message can say which value it is about. */
const shownBy: Record<string, (settings: AppPreferences) => unknown> = { 'sign-in': settings => settings.signIn, appearance: settings => settings.appearance, history: settings => settings.historyDays, 'plugin-updates': settings => settings.pluginUpdates, 'plugin-text': settings => settings.pluginText, 'session-costs': () => `${state.home?.home ?? ''}:${!!state.home?.sessionCosts?.on}` };
const shownIn = (row: string, settings: AppPreferences | undefined) => settings && shownBy[row] ? JSON.stringify(shownBy[row](settings)) : undefined;
/** A message about a value its row no longer shows was settled by a newer read (put right in the system, changed from a menu). */
const settled = (row: string, message: RowMessage | undefined) => message?.about !== undefined && message.about !== shownIn(row, current);
/** Notes on something finished: one row acting clears the others', so the page says one thing at a time. A failure, or the system's answer, stays until put right. */
const finishedTones: RowMessage['tone'][] = ['note', 'info', 'done'];
function quietOtherRows(row: string) {
  let cleared = false;
  for (const [other, message] of messages) if (other !== row && finishedTones.includes(message.tone)) { messages.delete(other); cleared = true; }
  if (cleared) rerender();
}
/** Each row's newest action, so one that finishes late never sets or clears the message of a newer one. */
const attempts = new Map<string, number>();
let attempted = 0;
/** A shorter History window waiting for its confirming click; the select keeps showing the saved one until then. */
let shortening: HistoryDays | undefined;
/** A window change main is still carrying out (it may wait for a sync pass): until it's done the row can't start another. */
let updatingHistory = false;

/**
 * Answers from main can cross (a save, then the re-read main asks for after saving; a re-read when the window is focused while
 * a save waits in main's queue). Each answer gets a rank, and one ranked below the newest shown is never shown over it:
 * 1. A read's answer ranks by when it was asked.
 * 2. A save's answer ranks by when it arrived: main answers a save only after everything queued before it, so it is newer
 *    than any read answered while it waited.
 */
let ranked = 0;
let shownRank = 0;

/**
 * Shows settings from main unless a newer answer is already showing. A row's message is weighed against what the page shows,
 * so the page must not lag behind the save it reports on. Settings that match the page leave it alone: rebuilding it when the
 * window is focused would swallow the click that focused it. A row's message that the settings settle goes with it.
 */
function showNewest(settings: AppPreferences | null | undefined, rank: number) {
  if (!settings || rank < shownRank) return;
  shownRank = rank;
  const daysChanged = current !== undefined && current.historyDays !== settings.historyDays;
  if (state.historyDays !== settings.historyDays) state.historyDays = settings.historyDays;
  if (JSON.stringify(settings) === JSON.stringify(current)) return;
  current = settings;
  for (const [row, message] of messages) if (settled(row, message)) messages.delete(row);
  if (daysChanged && state.page === 'history') void loadHistory();
  rerender();
}

/** Shared label for the History retention selector on both History and Settings. */
const HISTORY_KEEP_LABEL = 'Keep history for';

/** Reads the settings for the page: when it opens, and when main says they changed or the window comes back. */
export async function loadSettings() {
  const rank = ++ranked;
  const settings = await window.centralKnot.getSettings();
  showNewest(settings, rank);
  return settings;
}

/** Opens History's own time control fresh: clears its last visit's outcome and open warning, keeping an in-flight save's attempt. */
export function openHistoryWindow() {
  messages.delete('history');
  shortening = undefined;
  if (!updatingHistory) attempts.delete('history');
}

/** Opens the page fresh: what the rows said last time (a failure since put right elsewhere, say) belongs to that visit. */
export function openSettings() {
  messages.clear();
  shortening = undefined;
  logAsked++;
  shownLog = undefined;
  // An action still running from the last visit keeps its effect (a save still saves) but no longer speaks for its row, except
  // a History window change still under way: its outcome (removed, or couldn't be) is only ever said in that control.
  const updating = attempts.get('history');
  attempts.clear();
  if (updatingHistory && updating !== undefined) attempts.set('history', updating);
  void loadSettings();
}

/**
 * Runs one row's action (a save, a read of the log, Open log folder) and shows its outcome in that row: `work` returns a
 * message to show (or nothing), or throws, and `failure` puts why in plain words. A failure is about the value the row
 * showed when it began (still in effect). Only the row's newest attempt changes the row, and an outcome a newer read has
 * settled says nothing. It first clears the other rows' finished notes, so the page says one thing at a time. True when it
 * worked.
 */
async function act(row: string, work: () => Promise<RowMessage | undefined>, failure: (error: string) => string): Promise<boolean> {
  const mine = ++attempted;
  attempts.set(row, mine);
  quietOtherRows(row);
  const before = shownIn(row, current);
  let message: RowMessage | undefined;
  try { message = await work(); } catch (error) { message = { text: failure(String(error)), tone: 'failure', about: before }; }
  const worked = message?.tone !== 'failure';
  if (settled(row, message)) message = undefined;
  if (attempts.get(row) === mine && JSON.stringify(message) !== JSON.stringify(messages.get(row))) {
    if (message) messages.set(row, message); else messages.delete(row);
    rerender();
  }
  return worked;
}

/** The usual reasons a file can't be written, in plain words, with what to do about each. */
const writeProblems: [RegExp, string, string][] = [
  [/\b(EACCES|EPERM)\b/, 'Central Knot can’t write its settings file.', 'Check the file’s permissions, then try again.'],
  [/\bEROFS\b/, 'Central Knot’s settings are on a disk that can’t be written to.', 'Make it writable, then try again.'],
  [/\bENOSPC\b/, 'The disk is full.', 'Free up some space, then try again.'],
];

/**
 * A failed save in plain words: why (for the usual reasons), what is still in effect, and what to do. The error itself
 * stays out of the sentence; main has logged it, which the last resort points to.
 */
export function saveFailure(error: string, kept: string): string {
  const [, why, next] = writeProblems.find(([code]) => code.test(error)) ?? [, '', 'Try again. If it keeps failing, the log file says why.'];
  return [why ? `Couldn’t save: ${why}` : 'Couldn’t save this change.', kept, next].filter(Boolean).join(' ');
}

/** The settings in main's answer to a save: most saves answer with them alone, a History window change with what it pruned too. */
const savedIn = (answer: AppPreferences | HistoryWindowSaved) => 'settings' in answer ? answer.settings : answer;

/**
 * Saves one setting. Nothing changes on screen until main has saved it, so a failed save leaves the saved value showing.
 * `afterwards` says anything main's answer needs said in the row.
 */
const save = <Answer extends AppPreferences | HistoryWindowSaved>(row: string, change: () => Promise<Answer>, kept: string, afterwards = (_answer: Answer): RowMessage | undefined => undefined) =>
  act(row, async () => {
    const answer = await change();
    showNewest(savedIn(answer), ++ranked);
    return afterwards(answer);
  }, error => saveFailure(error, kept));

/** Opens the system's own place for it (main says which, in the system's words); where that fails, says the way there. */
const openSignInPlace = ({ open, unopened }: SignInPlace) => ({ label: open, run: () => void window.centralKnot.openSignInSettings().catch(() => announce(unopened)) });

/** Turns starting at sign-in on or off. The row then shows the system's answer, which has the last word. */
async function chooseSignIn(on: boolean): Promise<void> {
  const kept = current ? `Start at sign-in is still ${current.signIn.on ? 'on' : 'off'}.` : '';
  // A reason the system gives (off in Login Items, say) already shows in the row; a change it ignored without one is said here.
  await save('sign-in', () => window.centralKnot.setStartAtSignIn(on), kept, saved => {
    const { signIn } = saved;
    if (signIn.on === on || signIn.reason || !signIn.place) return undefined;
    return { text: signIn.place.unchanged, tone: 'attention', action: openSignInPlace(signIn.place), about: shownIn('sign-in', saved) };
  });
}

const appearances: { value: Appearance; label: string; glyph: IconName }[] = [
  { value: 'system', label: 'System', glyph: 'monitor' },
  { value: 'light', label: 'Light', glyph: 'sun' },
  { value: 'dark', label: 'Dark', glyph: 'moon' },
];
const appearanceLabel = (value: Appearance) => appearances.find(choice => choice.value === value)?.label;

/** Saves an appearance; the window follows it at once. */
async function chooseAppearance(appearance: Appearance): Promise<void> {
  const kept = current ? `${appearanceLabel(current.appearance)} is still in use.` : '';
  // Said for screen readers only: the chosen card already shows it.
  if (await save('appearance', () => window.centralKnot.setAppearance(appearance), kept)) announce(`Appearance: ${appearanceLabel(appearance)}.`, true);
}

/** The cards are one radio group: one Tab stop (the chosen card), arrow keys move to the next card and choose it. */
function moveAppearance(event: KeyboardEvent) {
  const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
  if (!step) return;
  event.preventDefault();
  const at = appearances.findIndex(choice => (event.target as HTMLElement).id === `appearance-${choice.value}`);
  const next = appearances[(at + step + appearances.length) % appearances.length].value;
  document.getElementById(`appearance-${next}`)?.focus();
  void chooseAppearance(next);
}

/** A longer window saves at once. A shorter one removes History for good, so the row asks first, and says so once. (The select works only once `current` is known.) */
function chooseHistoryDays(days: HistoryDays) {
  if (!current || updatingHistory) return;
  if (days >= current.historyDays) { void saveHistoryDays(days); return; }
  shortening = days;
  // What the row said last was about an earlier choice; the question replaces it, and is the one thing the page says now.
  messages.delete('history');
  quietOtherRows('history');
  rerender();
  document.getElementById('setting-history-question')?.scrollIntoView({ block: 'nearest' });
  announce(shortenQuestion(days), true);
}

/** Where a window of `days` starts, as of now, in the person's own date and time format (for post-save notes). */
const removedBefore = (days: HistoryDays) => new Date(Date.now() - days * DAY_MS).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortenQuestion = (days: HistoryDays) =>
  `In every home, History entries older than ${days} days will be removed and can’t be restored.`;

/**
 * What a shorter window did to older History, as main reports it. Only 'done' says anything was removed (with a check); the
 * window is saved in every case, and History already shows only what it covers.
 */
const pruneNotes: Record<HistoryPrune, (before: string) => Pick<RowMessage, 'text' | 'detail' | 'tone'>> = {
  done: before => ({ text: `Saved. History before ${before} was removed.`, tone: 'done' }),
  // This build doesn't sync the home now (preview only, held, waiting for Resume, no record yet): History already shows only the
  // window, and nothing is removed until this build next records a change there, if it ever does.
  later: before => ({ text: `Saved. History before ${before} no longer shows, and Central Knot removes it the next time it records a change in this home.`, tone: 'info' }),
  'no-home': () => ({ text: 'Saved.', tone: 'info' }),
  failed: before => ({ text: `Saved, but History before ${before} couldn’t be removed.`, detail: 'Central Knot will try again the next time this home records a change. The log file says why.', tone: 'failure' }),
};

/**
 * Saves the window. Main may first wait for a sync pass, so meanwhile the row says it is updating and can't start another
 * change (the other rows still can). After a shorter window it says what became of the older History; main reports nothing
 * pruned for a longer window, or for a request a newer one overtook in its queue.
 */
async function saveHistoryDays(days: HistoryDays) {
  if (updatingHistory) return;
  const kept = current ? `History is still kept for ${current.historyDays} days.` : '';
  const before = removedBefore(days);
  shortening = undefined;
  updatingHistory = true;
  rerender();
  announce('Updating History…', true);
  try {
    await save('history', () => window.centralKnot.setHistoryDays(days), kept,
      ({ settings, pruned }) => pruned && { ...pruneNotes[pruned](before), about: shownIn('history', settings) });
  } finally {
    updatingHistory = false;
    rerender();
    // The select was disabled under the focus; it takes it back unless the person has moved on to another row.
    if (document.activeElement === document.body) document.getElementById('history-days')?.focus();
  }
}

/** Closes the row's question, writing nothing; the select, where it started, takes the focus back. */
function closeShortening() {
  shortening = undefined;
  rerender();
  document.getElementById('history-days')?.focus();
}
const cancelOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && shortening) { event.preventDefault(); closeShortening(); } };

/** The row's question before a shorter window removes anything: age limit, that it can't be undone, and effect in any other home. */
function shortenConfirmation(days: HistoryDays): HTMLElement {
  return h('div.setting-confirm', { id: 'setting-history-question', role: 'group', 'aria-labelledby': 'history-shorten-text', onkeydown: cancelOnEscape },
    h('div.setting-confirm-body', {},
      icon('circle-alert', 16, 'tone-danger'),
      h('p.setting-confirm-text', { id: 'history-shorten-text' }, shortenQuestion(days))),
    h('div.setting-confirm-actions', {},
      button({ variant: 'danger', size: 'small', label: `Shorten to ${days} days`, id: 'history-shorten', onclick: () => void saveHistoryDays(days) }),
      // Says what it keeps: the saved window, which the select still shows.
      button({ variant: 'outline', size: 'small', label: `Keep ${current!.historyDays} days`, id: 'history-shorten-cancel', onclick: closeShortening })));
}

/** The History retention select shared by Settings and History; disabled until settings load and while saving. */
const historySelect = (labelId: string): HTMLElement => h('span.select', {},
  h('select', { id: 'history-days', 'aria-labelledby': labelId, 'aria-describedby': updatingHistory ? 'setting-history-notice' : undefined, disabled: !current || updatingHistory,
    onchange: (event: Event) => chooseHistoryDays(Number((event.target as HTMLSelectElement).value) as HistoryDays), onkeydown: cancelOnEscape },
  historyDayChoices.map(days => h('option', { value: String(days), selected: days === (current?.historyDays ?? state.historyDays ?? defaultHistoryDays) }, `${days} days`))),
  icon('chevrons-up-down', 14));
const historyNotice = (): RowMessage | undefined => (updatingHistory ? { text: 'Updating History…', tone: 'progress' } : undefined);

/** History's own time control ("Keep history for [30 days ▾]"), sharing Settings' label, choices, warning, save and outcomes. */
export function historyWindowControl(): HTMLElement {
  const message = messages.get('history');
  const notice = historyNotice();
  return h('div.history-keep', { id: 'history-keep' },
    h('div.history-keep-row', {}, h('label.history-keep-label', { id: 'history-keep-label', for: 'history-days' }, HISTORY_KEEP_LABEL), historySelect('history-keep-label')),
    message && messageLine(message, { id: 'setting-history-message' }),
    notice && messageLine(notice, { id: 'setting-history-notice', announce: true }),
    shortening && shortenConfirmation(shortening));
}

/** Opens the log's folder in the file manager. Where the log could not be selected there, the row names the file to look for. */
const openLogFolder = () => act('log', async () => {
  const opened = await window.centralKnot.openLogFolder();
  if (opened.selected) return undefined;
  return { text: opened.logged ? 'Opened the log’s folder. The file is central-knot.log.' : 'Opened the log’s folder. Nothing has been logged yet.', tone: 'note' };
}, () => 'Couldn’t open the log’s folder. Try again.');

/**
 * The log shown under its row, from Show log until Hide log or the page is opened afresh: how many of its last lines were
 * asked for, and main's answer. Never stored. Show log asks for LOG_LINES, and each "Show earlier lines" for LOG_LINES more.
 */
let shownLog: { count: number; tail: LogTail } | undefined;
const LOG_LINES = 200;
/** The newest read or Hide log, so a read that answers late never shows the log again or over a newer read. */
let logAsked = 0;

/**
 * Shows the log's last `count` lines under its row, as main reads them (main.ts readLog). `toNewest` (Show log, Refresh log)
 * then scrolls the page just far enough to bring the newest line into view, with the page's own margin under it; earlier
 * lines keep the place, so they come in under their button (and its focus goes to the lines once it is gone). A read that
 * fails hides the block, and the row says so.
 */
async function showLog(count: number, toNewest: boolean) {
  const mine = ++logAsked;
  await act('log', async () => {
    const tail = await window.centralKnot.readLog(count).catch(error => { if (mine === logAsked) shownLog = undefined; throw error; });
    if (mine !== logAsked) return undefined;
    const onEarlier = document.activeElement?.id === 'log-earlier';
    shownLog = { count, tail };
    rerender();
    if (onEarlier && !tail.earlier) document.getElementById('log-text')?.focus({ preventScroll: true });
    const page = document.getElementById('settings-scroll'), end = document.getElementById('log-end');
    if (toNewest && page && end) {
      const below = end.getBoundingClientRect().bottom + parseFloat(getComputedStyle(page).paddingBottom) - page.getBoundingClientRect().bottom;
      if (below > 0) page.scrollTop += below;
    }
    return undefined;
  }, () => 'Couldn’t read the log. Try again, or open its folder.');
}
/** Hide log: the lines go, and a read still under way no longer shows them. From the foot, the focus goes to the row's Show log. */
function hideLog() {
  const fromFoot = document.activeElement?.id === 'log-foot-show-log';
  logAsked++;
  shownLog = undefined;
  rerender();
  if (fromFoot) document.getElementById('show-log')?.focus();
}

/**
 * The log's buttons, built here for both places they show: its row (Show log or Hide log, Open log folder), and, while the log
 * is shown, the foot of its lines, where the page lands after a read (Refresh log first). The foot's ids start `log-foot-`.
 */
function logButtons(at: 'row' | 'foot'): HTMLElement {
  const shown = shownLog, id = (name: string) => (at === 'row' ? name : `log-foot-${name}`);
  return h('div.setting-actions', {},
    at === 'foot' && shown ? button({ variant: 'outline', icon: 'refresh-cw', label: 'Refresh log', id: 'log-refresh', onclick: () => void showLog(shown.count, true) }) : null,
    button({ variant: 'outline', label: shown ? 'Hide log' : 'Show log', id: id('show-log'), onclick: () => (shown ? hideLog() : void showLog(LOG_LINES, true)),
      attrs: { 'aria-expanded': String(!!shown), 'aria-controls': shown ? 'setting-log-lines' : undefined, 'aria-describedby': infoCardId('setting-log-info') } }),
    button({ variant: 'outline', label: 'Open log folder', id: id('open-log-folder'), onclick: () => void openLogFolder(), attrs: { 'aria-describedby': infoCardId('setting-log-info') } }));
}

/**
 * The log under its row: a button for earlier lines (or that this is its start), the lines as they are in the file, and its
 * foot (`log-end`, which a read brings into view): that the times are UTC, as the file has them, and the log's buttons.
 */
function logBlock({ count, tail: { lines, earlier } }: NonNullable<typeof shownLog>): HTMLElement {
  const foot = h('div.setting-log-foot', { id: 'log-end' }, lines.length ? h('p.setting-log-note', {}, 'Times are in UTC, as the file has them.') : null, logButtons('foot'));
  if (!lines.length) return h('div.setting-log', { id: 'setting-log-lines' }, h('p.setting-log-note', {}, 'Nothing has been logged yet.'), foot);
  return h('div.setting-log', { id: 'setting-log-lines' },
    earlier
      ? button({ variant: 'link', size: 'small', label: `Show ${plural(Math.min(earlier, LOG_LINES), 'earlier line')}`, id: 'log-earlier', onclick: () => void showLog(count + LOG_LINES, false) })
      : h('p.setting-log-note', {}, 'This is the start of the log.'),
    h('pre.setting-log-text', { id: 'log-text', tabindex: '0', 'aria-label': 'Central Knot’s log' }, lines.join('\n')),
    foot);
}

const messageLook: Record<RowMessage['tone'], { glyph: IconName; role: 'status' | 'alert' }> = {
  note: { glyph: 'folder-open', role: 'status' }, info: { glyph: 'info', role: 'status' }, failure: { glyph: 'circle-alert', role: 'alert' },
  attention: { glyph: 'info', role: 'status' }, system: { glyph: 'info', role: 'status' }, progress: { glyph: 'clock', role: 'status' }, done: { glyph: 'check', role: 'status' },
};
/**
 * One line beneath a row, its action after the text. `id` (from the row) also names the action, so focus on it survives a
 * redraw. `announce` false for a line that describes the row's state rather than news to announce.
 */
function messageLine({ text, detail, tone, action }: RowMessage, { id, announce = true }: { id: string; announce?: boolean }): HTMLElement {
  const { glyph, role } = messageLook[tone];
  return h(`p.setting-message.setting-${tone}`, { id, role: announce ? role : undefined }, icon(glyph, 14),
    h('span.setting-message-body', {}, h('span.setting-message-text', {}, text, detail && [' ', h('span.setting-message-detail', {}, detail)]),
      action && h('button.text-action', { type: 'button', id: `${id}-action`, onclick: action.run }, action.label)));
}

/**
 * One setting: its name (with an optional info mark after it) and optional hint at the left, its control at the right (under
 * them on a narrow page), and beneath both, on lines of their own so the control never moves when they come or go: what its
 * last action said, `notice`, what needs the person about its current state, and `below`, what else the row shows under them:
 * a question it asks before it acts, or what its setting just did.
 */
function settingRow(id: string, title: string, hint: string | undefined, control: HTMLElement, notice?: RowMessage, below?: HTMLElement, info?: string): HTMLElement {
  const message = messages.get(id);
  return h('div.setting-row', { id: `setting-${id}` },
    h('div.setting-text', { 'data-info-block': true },
      h('div.setting-title', {}, h('span', { id: `setting-${id}-title` }, title), info ? infoMark(`setting-${id}-info`, title, info) : null),
      hint ? h('p.setting-hint', { id: `setting-${id}-hint` }, hint) : null),
    h('div.setting-control', {}, control),
    message && messageLine(message, { id: `setting-${id}-message` }),
    notice && messageLine(notice, { id: `setting-${id}-notice`, announce: notice.tone === 'progress' }),
    below);
}

/**
 * Updates: the build in use, Check now and the Update button, what the last check or update found, and why this copy can't
 * update itself, with the release page instead. Not shown where there are no releases (only Macs and Linux have them).
 */
function updatesRow(): HTMLElement | null {
  const view = updates.view;
  if (!view?.shown) return null;
  const checks = !!view.tag && view.reason?.key !== 'dev' && view.reason?.key !== 'untagged';
  const hint = `This is Central Knot ${buildWords(view)}.`;
  // A restart held for unsaved work says so here too, not only on the button.
  const held = view.step === 'ready' && view.available ? unsavedWork() : undefined;
  const shown = updates.checking && !view.step ? { ...view, checking: true, failed: undefined } : view;
  const { page: about, ...status } = (held ? { text: `${tagWords(view.available!.tag)} is ready. ${held}`, tone: 'info' as const, page: view.available!.page } : updateStatus(shown)) ?? {};
  const page = view.available?.page;
  const notice: RowMessage | undefined = 'text' in status ? { ...status, action: about && !view.reason ? { label: status.tone === 'failure' ? 'Open the release page' : 'Release notes', run: () => void window.centralKnot.openExternal(about) } : undefined } : undefined;
  const why = view.reason && messageLine({ text: view.reason.text, tone: 'attention', action: { label: page ? `Open ${tagWords(view.available!.tag)}’s page` : 'Open the releases page', run: () => void window.centralKnot.openExternal(page ?? releasesPage) } },
    { id: 'setting-updates-reason', announce: false });
  const described = ['setting-updates-hint', notice && 'setting-updates-notice', why && 'setting-updates-reason'].filter(Boolean).join(' ');
  return settingRow('updates', 'Updates', hint,
    h('div.setting-actions', {},
      settingUpdateButton(),
      checks ? button({ variant: 'outline', label: 'Check now', name: 'Check now for updates', id: 'check-updates', disabled: updates.checking || view.checking || !!view.step, onclick: () => void checkNow(), attrs: { 'aria-describedby': described } }) : null),
    notice, why || undefined);
}

/** Turns automatic plugin updates on or off. Turned on, main checks at once if the last check is long enough ago. */
async function choosePluginUpdates(on: boolean): Promise<void> {
  const kept = current ? `Plugins are still ${current.pluginUpdates ? 'updated automatically' : 'updated only when you choose Update'}.` : '';
  if (await save('plugin-updates', () => window.centralKnot.setPluginUpdates(on), kept)) announce(on ? 'Plugins are updated automatically from now on.' : 'Plugins are updated only when you choose Update.', true);
}

/**
 * Plugins: whether they are updated automatically, that updates can't be undone, Check now, and what the last check came to
 * (the note on the Plugins page says which plugins).
 */
function pluginUpdatesRow(): HTMLElement {
  const on = !!current?.pluginUpdates;
  const view = pluginUpdates.view;
  const checked = on ? checkedWords(pluginUpdates.asked && view ? { ...view, checking: true } : view) : undefined;
  const notice: RowMessage | undefined = checked && { text: checked.text, tone: checked.tone, action: checked.note ? { label: `See ${pageNames.plugins}`, run: () => showPage('plugins') } : undefined };
  const described = [infoCardId('setting-plugin-updates-info'), 'setting-plugin-updates-hint', notice && 'setting-plugin-updates-notice'].filter(Boolean).join(' ');
  return settingRow('plugin-updates', 'Update plugins automatically', 'Updates can’t be undone.',
    h('div.setting-actions', {},
      on ? button({ variant: 'outline', label: 'Check now', name: 'Check now for plugin updates', id: 'check-plugin-updates', disabled: !view || view.checking || pluginUpdates.asked, onclick: () => void checkPluginsNow(), attrs: { 'aria-describedby': described } }) : null,
      // Unchangeable until main has said, so a click never acts on a guess.
      toggle({ on, label: 'Update plugins automatically', onchange: chosen => void choosePluginUpdates(chosen), disabled: !current, id: 'plugin-updates-on',
        attrs: { 'aria-describedby': described, title: null } })),
    notice, undefined, 'Every four hours, window closed too. A plugin you turned off stays off.');
}

/** How much of what plugins hold is read (plugintext.ts), as main last said; undefined until asked. */
let textRead: PluginTextView | undefined;
const isReadingText = (view: PluginTextView | undefined) => !!(view?.of && current?.pluginText && view.reading && view.read < view.of);
/**
 * A new count from main: its words change in place, so a click on the page is never lost to a redraw; the page is drawn again
 * only when the download-estimate hint, the count line, or its reading state comes or goes.
 */
function showTextRead(view: PluginTextView) {
  textRead = view;
  const nextHint = textHint(view);
  const hint = document.getElementById('setting-plugin-text-hint');
  const notice = document.getElementById('setting-plugin-text-notice');
  const line = notice?.querySelector('.setting-message-text');
  if (!!hint === !!nextHint && !view.of && !notice) return;
  if (!!hint === !!nextHint && notice && line && view.of && notice.classList.contains('setting-progress') === isReadingText(view)) {
    if (hint && nextHint) hint.textContent = nextHint;
    line.textContent = textCoverage(view, !!current?.pluginText);
  } else if (state.page === 'settings') rerender();
}
window.centralKnot.onPluginTextChanged(showTextRead);

/** Turns the reading of what plugins hold on or off; turned off, what was read is kept. */
async function choosePluginText(on: boolean): Promise<void> {
  const kept = current ? `What plugins hold is still ${current.pluginText ? 'read' : 'not read'}.` : '';
  if (await save('plugin-text', () => window.centralKnot.setPluginText(on), kept)) announce(on ? 'Central Knot reads what plugins hold from now on.' : 'Central Knot no longer reads what plugins hold. What it read is kept.', true);
}
/** The first download, estimated: about 0.1 MB a plugin kept outside its marketplace (measured 2026-11-19: 26 to 29 MB on the wire for 277). */
const firstSize = (plugins: number) => { const mb = plugins * 0.1; return mb < 1 ? 'under 1 MB' : `about ${mb < 10 ? Math.round(mb) : Math.round(mb / 5) * 5} MB`; };
const textHint = (view: PluginTextView | undefined) => (view?.elsewhere
  ? `${view.elsewhere === 1 ? 'The one plugin outside its marketplace is' : `The ${view.elsewhere} outside their marketplace are`} downloaded once (${firstSize(view.elsewhere)}), then only changes, or daily if on a branch.`
  : undefined);
/** The count: while it reads, when it is done (and how many couldn't be read), and while it is off. */
const textCoverage = (view: PluginTextView, on: boolean) => {
  const counted = `${view.read} of ${plural(view.of, 'plugin')}`, left = view.of - view.read;
  if (!on) return `Off. What was read from ${counted} is kept.`;
  if (view.reading && left) return `Reading: ${counted}.`;
  return `Read ${counted}.${left ? ` ${left} couldn’t be read; Central Knot tries again later.` : ''}`;
};

/** Plugins: whether what they hold is read, what that downloads when plugins sit elsewhere, and how much is read. */
function pluginTextRow(): HTMLElement {
  if (!textRead) void window.centralKnot.pluginText().then(showTextRead);
  const hint = textHint(textRead);
  const notice: RowMessage | undefined = textRead?.of ? { text: textCoverage(textRead, !!current?.pluginText), tone: isReadingText(textRead) ? 'progress' : 'info' } : undefined;
  const described = [infoCardId('setting-plugin-text-info'), hint && 'setting-plugin-text-hint', notice && 'setting-plugin-text-notice'].filter(Boolean).join(' ');
  return settingRow('plugin-text', 'Read what plugins hold', hint,
    toggle({ on: !!current?.pluginText, label: 'Read what plugins hold', onchange: chosen => void choosePluginText(chosen), disabled: !current, id: 'plugin-text-on',
      attrs: { 'aria-describedby': described, title: null } }),
    notice, undefined, 'Keeps plugin items’ names, descriptions and first lines, so Find can search them.');
}

/** A custom build's own lines about itself (what it is, and that it doesn't update itself), where the standard app has Updates. */
function buildRow(): HTMLElement | null {
  const lines = current?.build;
  return lines?.length ? settingRow('build', 'This build', lines.join(' '), h('span')) : null;
}

/**
 * Synchronize everything, for the open home: what it does (in its card), and, while it is off, how many found items it would
 * add now; either way, how many found items wait for a choice of copy, with the way into first setup's walkthrough of them
 * (firstsetup.ts, which counts both as its question does). Unchangeable where a pass may not write.
 */
function syncEverythingRow(): HTMLElement | null {
  const home = state.home;
  if (!home) return null;
  const on = !!home.sync.syncEverything, cannot = whyReadOnly(home) ?? (home.sync.gate.state === 'needs-resume' ? home.sync.gate.reason : undefined);
  const { takes, choosing } = whatYesDoes(home);
  const waiting = choosing ? `${plural(choosing, 'found item')} ${choosing === 1 ? 'has' : 'have'} copies that differ and ${choosing === 1 ? 'waits' : 'wait'} for your choice of copy.` : '';
  const adds = !on ? (takes ? `Turning it on puts the ${plural(takes, 'item')} found in your tools into every tool now.` : 'Nothing found in your tools now would be added.') : '';
  const later = on && !home.syncOn ? 'Automatic sync is off, so it takes items in at Sync once.' : '';
  // What it leaves for good, said beside what it would add: found items taken out of Central Knot earlier.
  const out = takenOutEarlier(home);
  const takenOut = out === 1 ? '1 found item was taken out of Central Knot earlier and isn’t added by itself again: Add on its row, or Restore in History, brings it back.'
    : out ? `${out} found items were taken out of Central Knot earlier and aren’t added by themselves again: Add on a row, or Restore in History, brings one back.` : '';
  const text = [adds, takenOut, waiting, later].filter(Boolean).join(' ');
  const notice: RowMessage | undefined = text ? { text, tone: 'info', action: choosing && !cannot ? { label: 'Choose copies', run: openWalkthrough } : undefined } : undefined;
  // What it took in, as each page's notice says it (until shown there), with History: Settings says what the switch did.
  const added = (['skills', 'mcp', 'agents'] as const).flatMap(kind => home[kind].notices.flatMap(told => (told.kind === 'taken-in' && !state.dismissed.has(told.history)
    ? [messageLine({ text: sentences(libraryWords[kind]).takenInWords(told), tone: 'done', action: { label: 'History', run: () => showPage('history') } }, { id: `setting-sync-everything-added-${kind}` })] : [])));
  const described = [cannot ? 'setting-sync-everything-hint' : infoCardId('setting-sync-everything-info'), notice && 'setting-sync-everything-notice'].filter(Boolean).join(' ');
  return settingRow('sync-everything', 'Synchronize everything', cannot,
    toggle({ on, label: 'Synchronize everything', onchange: chosen => void switchSyncEverything(chosen), disabled: cannot || acting(), id: 'sync-everything-on',
      attrs: { 'aria-describedby': described, title: null } }),
    notice, added.length ? h('div.setting-added', {}, added) : undefined, 'What turns up in a tool is turned on in every tool. Items whose copies differ wait for your choice.');
}

/** Shared end of the disclosure sentence that each keep-costs info card (Sessions and Settings) begins. */
export const SESSION_COSTS_KEPT = 'each session’s project, request times, models, token counts and estimated prices in this home’s Central Knot folder. No message text is kept; turning it off leaves what was kept.';

/** Turns keeping session costs on or off for the open home (sessionkeep.ts). */
async function chooseSessionCosts(on: boolean): Promise<void> {
  if (keepingBusy()) return;
  const kept = `Session costs are still ${state.home?.sessionCosts?.on ? 'kept' : 'not kept'} in this home.`;
  await act('session-costs', async () => {
    const refused = await switchSessionCosts(on);
    return refused ? { text: refused, tone: 'failure', about: shownIn('session-costs', current) } : undefined;
  }, error => saveFailure(error, kept));
}

/** Keep session costs, under "This home": one switch, on or off for the open home. */
function sessionCostsRow(): HTMLElement {
  if (settled('session-costs', messages.get('session-costs'))) messages.delete('session-costs');
  const costs = state.home!.sessionCosts;
  const notice: RowMessage | undefined = !messages.has('session-costs') && costs?.refused ? { text: costs.refused, tone: 'failure' } : undefined;
  return settingRow('session-costs', 'Keep session costs', undefined,
    toggle({ on: !!costs?.on, label: 'Keep session costs', onchange: chosen => void chooseSessionCosts(chosen), disabled: keepingBusy(), id: 'keep-session-costs',
      attrs: { 'aria-describedby': notice ? `${infoCardId('setting-session-costs-info')} setting-session-costs-notice` : infoCardId('setting-session-costs-info'), title: null } }),
    notice, undefined, `Keeps ${SESSION_COSTS_KEPT}`);
}

/** What a settings file that couldn't be read at launch led to (types.ts HomeView settingsUnread), said first on the Overview (overview.ts needsYou) and here. */
export const settingsReset = 'Central Knot couldn’t read its settings file, so it started with the defaults.';
/** The note at the top of the page: what happened, where the old file is, and Close, which ends it here and on the Overview. */
function keptNote({ keptAs }: { keptAs?: string }): HTMLElement {
  const close = () => { state.home = { ...state.home!, settingsUnread: undefined }; rerender(); void window.centralKnot.closeSettingsKept(); };
  const where = keptAs ? `The old file is kept as ${keptAs.split(/[\\/]/).pop()}.` : 'The old file is still in place, and no change is saved until it can be moved aside.';
  return h('div.intro', { id: 'settings-kept', role: 'note' },
    h('div.intro-text', {}, `${settingsReset} ${where}`),
    keptAs ? button({ variant: 'outline', size: 'small', label: 'Show in folder', id: 'settings-kept-show', onclick: () => void window.centralKnot.showFile(keptAs) }) : null,
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Close this note', id: 'settings-kept-close', onclick: close }));
}

const settingsSection = (id: string, title: string, ...rows: (HTMLElement | null)[]) =>
  h('section.settings-section', { 'aria-labelledby': `settings-${id}` }, h('h2.eyebrow', { id: `settings-${id}` }, title), ...rows);

export function settingsPage(): HTMLElement {
  const chosen = current?.appearance;
  const signIn = current?.signIn;
  // A reason it can't be changed here stays on the page as the row's hint; what starting at sign-in does lives in its info card.
  // Why the system has it off (it can be changed) shows beneath, with the way to fix it.
  const cannot = signIn?.available ? undefined : signIn?.reason?.text;
  const signInDescribed = cannot ? 'setting-sign-in-hint' : infoCardId('setting-sign-in-info');
  const systemSays: RowMessage | undefined = signIn?.reason && signIn.place ? { text: signIn.reason.text, tone: 'system', action: openSignInPlace(signIn.place) } : undefined;
  const done = state.outcome?.page === 'settings' && (!!state.outcome.reloads?.length || !!state.outcome.settingsBand) ? outcomeBand() : null;
  return h('div.page', {}, done ? h('div.bands', {}, done) : null, h('div.scroll.settings-scroll', { id: 'settings-scroll' },
    state.home?.settingsUnread ? keptNote(state.home.settingsUnread) : null,
    settingsSection('general', 'General',
      settingRow('sign-in', 'Start at sign-in', cannot,
        // Off and unchangeable until main has said, so a click never acts on a guess. No tooltip: the row's title already says it.
        toggle({ on: !!signIn?.on, label: 'Start at sign-in', onchange: on => void chooseSignIn(on), disabled: !signIn?.available, id: 'start-at-sign-in',
          attrs: { 'aria-describedby': systemSays ? `${signInDescribed} setting-sign-in-notice` : signInDescribed, title: null } }),
        systemSays, undefined, `Opens hidden in ${machine.tray} at sign-in, so sync keeps running.`),
      settingRow('appearance', 'Appearance', undefined,
        // Until the settings arrive, no card is chosen; the cards look as usual (not dimmed) and System holds the Tab stop.
        h('div.appearance-choices', { role: 'radiogroup', 'aria-labelledby': 'setting-appearance-title', 'aria-busy': String(!current), onkeydown: moveAppearance },
          appearances.map(choice => h(`button.appearance-choice${chosen === choice.value ? '.selected' : ''}`, {
            type: 'button', role: 'radio', id: `appearance-${choice.value}`, 'aria-checked': String(chosen === choice.value),
            tabindex: (chosen ?? 'system') === choice.value ? '0' : '-1', onclick: () => void chooseAppearance(choice.value),
          }, icon(choice.glyph, 20), h('span', {}, choice.label))))),
      updatesRow(), buildRow()),
    state.home ? settingsSection('home', 'This home', syncEverythingRow(), sessionCostsRow()) : null,
    settingsSection('plugins', 'Plugins', pluginUpdatesRow(), pluginTextRow()),
    settingsSection('history', 'History',
      settingRow('history', HISTORY_KEEP_LABEL, undefined, historySelect('setting-history-title'), historyNotice(), shortening ? shortenConfirmation(shortening) : undefined)),
    // Help stays the last section, so the log's lines lengthen the page's own scroll.
    settingsSection('help', 'Help',
      settingRow('log', 'Log', undefined, logButtons('row'), undefined, undefined, 'Central Knot’s own log, for reporting a problem. Your tools’ files aren’t in it.'),
      shownLog ? logBlock(shownLog) : null)));
}
