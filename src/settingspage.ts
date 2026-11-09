// Settings: Central Knot's own preferences, kept apart from the tools' settings. The main process stores them
// (app-settings.json) and applies them; this page shows them, one full-width row each, and changes one at a time.
import { announce, rereadHistory, rerender } from './app.ts';
import { button, h, icon, toggle, trayName } from './dom.ts';
import type { IconName } from './icons.ts';
import type { AppPreferences, Appearance, HistoryDays, SignInPlace } from './types.ts';

/** The settings as last read from the main process; undefined until the page has loaded them. */
let current: AppPreferences | undefined;

/**
 * A line beneath a row: a note on what its last action did, why it failed, that the system ignored it (attention), or how the
 * system has the setting now (system), with an `action` that takes the person there. `about` is the row's value it describes, as `shownIn`.
 */
interface RowMessage { text: string; tone: 'note' | 'failure' | 'attention' | 'system'; action?: { label: string; run: () => void }; about?: string }
/** What each row's last action said, by row id. */
const messages = new Map<string, RowMessage>();
/** What each row shows of the settings, so a message can say which value it is about. */
const shownBy: Record<string, (settings: AppPreferences) => unknown> = { 'sign-in': settings => settings.signIn, appearance: settings => settings.appearance, history: settings => settings.historyDays };
const shownIn = (row: string, settings: AppPreferences | undefined) => settings && shownBy[row] ? JSON.stringify(shownBy[row](settings)) : undefined;
/** A message about a value its row no longer shows was settled by a newer read (put right in the system, changed from a menu). */
const settled = (row: string, message: RowMessage | undefined) => message?.about !== undefined && message.about !== shownIn(row, current);
/** Each row's newest action, so one that finishes late never sets or clears the message of a newer one. */
const attempts = new Map<string, number>();
let attempted = 0;
/** A shorter History window waiting for its confirming click; the select keeps showing the saved one until then. */
let shortening: HistoryDays | undefined;

/** Answers from main can cross (a save, then a re-read on focus): only the newest request's answer is shown. */
let latest = 0;

/**
 * Shows main's answer unless a newer request has started since, and returns it either way; a rejected answer propagates to the
 * caller. An answer that matches the page leaves it alone: rebuilding it when the window is focused would swallow the click
 * that focused it. A row's message that the answer settles goes with it.
 */
async function showNewest(answer: Promise<AppPreferences>): Promise<AppPreferences> {
  const mine = ++latest;
  const settings = await answer;
  if (mine !== latest || JSON.stringify(settings) === JSON.stringify(current)) return settings;
  current = settings;
  for (const [row, message] of messages) if (settled(row, message)) messages.delete(row);
  rerender();
  return settings;
}

/** Reads the settings for the page: when it opens, and when main says they changed or the window comes back. */
export const loadSettings = () => showNewest(window.centralKnot.getSettings());

/** Opens the page fresh: what the rows said last time (a failure since put right elsewhere, say) belongs to that visit. */
export function openSettings() {
  messages.clear();
  shortening = undefined;
  // An action still running from the last visit keeps its effect (a save still saves) but no longer speaks for its row.
  attempts.clear();
  void loadSettings();
}

/**
 * Runs one row's action (a save, Show log file) and shows its outcome in that row: `work` returns a message to show (or
 * nothing), or throws, and `failure` puts why in plain words. A failure is about the value the row showed when it began (still
 * in effect). Only the row's newest attempt changes the row, and an outcome a newer read has settled says nothing. True when it worked.
 */
async function act(row: string, work: () => Promise<RowMessage | undefined>, failure: (error: string) => string): Promise<boolean> {
  const mine = ++attempted;
  attempts.set(row, mine);
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
function saveFailure(error: string, kept: string): string {
  const [, why, next] = writeProblems.find(([code]) => code.test(error)) ?? [, '', 'Try again. If it keeps failing, the log file says why.'];
  return [why ? `Couldn’t save: ${why}` : 'Couldn’t save this change.', kept, next].filter(Boolean).join(' ');
}

/**
 * Saves one setting. Nothing changes on screen until main has saved it, so a failed save leaves the saved value showing.
 * `afterwards` says anything the saved settings need said in the row.
 */
const save = (row: string, change: () => Promise<AppPreferences>, kept: string, afterwards = (_saved: AppPreferences): RowMessage | undefined => undefined) =>
  act(row, async () => afterwards(await showNewest(change())), error => saveFailure(error, kept));

/** What starting at sign-in does. A reason it can't be changed here takes this line's place. */
const signInHint = `Opens hidden in the ${trayName} when you sign in, so sync keeps running without the window.`;
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

const historyChoices: HistoryDays[] = [7, 30, 90];

/** A longer window saves at once. A shorter one removes History for good, so the row asks first. (The select works only once `current` is known.) */
function chooseHistoryDays(days: HistoryDays) {
  if (days >= current!.historyDays) { void keepHistoryFor(days); return; }
  shortening = days;
  // What the row said last was about an earlier choice; the question replaces it.
  messages.delete('history');
  rerender();
}

/** Saves the window. A shorter one has main take the open home's History down to it, so History is read again after. */
async function keepHistoryFor(days: HistoryDays) {
  const kept = current ? `History is still kept for ${current.historyDays} days.` : '';
  closeShortening();
  if (await save('history', () => window.centralKnot.setHistoryDays(days), kept)) await rereadHistory();
}

/** Closes the row's question; the select, where it started, takes the focus back. */
function closeShortening() {
  shortening = undefined;
  rerender();
  document.getElementById('history-days')?.focus();
}

/** The row's question before a shorter window removes anything: from when, that it can't be undone, and that other homes follow later. */
function shortenConfirmation(days: HistoryDays): HTMLElement {
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return h('div.notice.notice-danger.setting-confirm', { id: 'setting-history-notice', role: 'group', 'aria-labelledby': 'history-shorten-text' },
    icon('circle-alert', 16, 'tone-danger'),
    h('p.setting-confirm-text', { id: 'history-shorten-text', role: 'alert' }, `History from before ${from} will be removed and can’t be restored. Other homes apply this the next time they write History.`),
    h('div.setting-confirm-actions', {},
      button({ variant: 'danger', size: 'small', label: `Shorten to ${days} days`, id: 'history-shorten', onclick: () => void keepHistoryFor(days) }),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'history-shorten-cancel', onclick: closeShortening })));
}

/** Shows the log in the file manager. Where it could only open the folder, the row says so and names the file to look for. */
const showLog = () => act('log', async () => {
  const shown = await window.centralKnot.showLog();
  if (shown.selected) return undefined;
  return { text: shown.logged ? 'Opened the log’s folder. The file is central-knot.log.' : 'Opened the log’s folder. Nothing has been logged yet.', tone: 'note' };
}, () => 'Couldn’t open the log’s folder. Try again.');

const messageLook: Record<RowMessage['tone'], { glyph: IconName; role: 'status' | 'alert' }> = {
  note: { glyph: 'folder-open', role: 'status' }, failure: { glyph: 'circle-alert', role: 'alert' },
  attention: { glyph: 'info', role: 'status' }, system: { glyph: 'info', role: 'status' },
};
/**
 * One line beneath a row, its action after the text. `id` (from the row) also names the action, so focus on it survives a
 * redraw. `announce` false for a line that describes the row's state rather than news to announce.
 */
function messageLine({ text, tone, action }: RowMessage, { id, announce = true }: { id: string; announce?: boolean }): HTMLElement {
  const { glyph, role } = messageLook[tone];
  return h(`p.setting-message.setting-${tone}`, { id, role: announce ? role : undefined }, icon(glyph, 14),
    h('span.setting-message-body', {}, h('span.setting-message-text', {}, text),
      action && h('button.text-action', { type: 'button', id: `${id}-action`, onclick: action.run }, action.label)));
}

/**
 * One setting: its name and hint at the left, its control at the right (under them on a narrow page), and beneath both, on
 * lines of their own so the control never moves when they come or go: what its last action said, and `notice`, what needs
 * the person about its current state, or a question the row is asking.
 */
function settingRow(id: string, title: string, hint: string, control: HTMLElement, notice?: RowMessage | HTMLElement): HTMLElement {
  const message = messages.get(id);
  return h('div.setting-row', { id: `setting-${id}` },
    h('div.setting-text', {},
      h('div.setting-title', { id: `setting-${id}-title` }, title),
      h('p.setting-hint', { id: `setting-${id}-hint` }, hint)),
    h('div.setting-control', {}, control),
    message && messageLine(message, { id: `setting-${id}-message` }),
    notice instanceof HTMLElement ? notice : notice && messageLine(notice, { id: `setting-${id}-notice`, announce: false }));
}

const settingsSection = (id: string, title: string, ...rows: HTMLElement[]) =>
  h('section.settings-section', { 'aria-labelledby': `settings-${id}` }, h('h2.eyebrow', { id: `settings-${id}` }, title), ...rows);

export function settingsPage(): HTMLElement {
  const chosen = current?.appearance;
  const signIn = current?.signIn;
  // Why it can't be changed here replaces the hint; why the system has it off (it can be changed) shows beneath, with the way to fix it.
  const cannot = signIn?.available ? undefined : signIn?.reason?.text;
  const systemSays: RowMessage | undefined = signIn?.reason && signIn.place ? { text: signIn.reason.text, tone: 'system', action: openSignInPlace(signIn.place) } : undefined;
  return h('div.page', {}, h('div.scroll.settings-scroll', {},
    settingsSection('general', 'General',
      settingRow('sign-in', 'Start at sign-in', cannot ?? signInHint,
        // Off and unchangeable until main has said, so a click never acts on a guess. No tooltip: the row's title already says it.
        toggle({ on: !!signIn?.on, label: 'Start at sign-in', onchange: on => void chooseSignIn(on), disabled: !signIn?.available, id: 'start-at-sign-in',
          attrs: { 'aria-describedby': systemSays ? 'setting-sign-in-hint setting-sign-in-notice' : 'setting-sign-in-hint', title: null } }),
        systemSays),
      settingRow('appearance', 'Appearance', 'System follows your computer’s light or dark setting.',
        // Until the settings arrive, no card is chosen; the cards look as usual (not dimmed) and System holds the Tab stop.
        h('div.appearance-choices', { role: 'radiogroup', 'aria-labelledby': 'setting-appearance-title', 'aria-describedby': 'setting-appearance-hint', 'aria-busy': String(!current), onkeydown: moveAppearance },
          appearances.map(choice => h(`button.appearance-choice${chosen === choice.value ? '.selected' : ''}`, {
            type: 'button', role: 'radio', id: `appearance-${choice.value}`, 'aria-checked': String(chosen === choice.value),
            tabindex: (chosen ?? 'system') === choice.value ? '0' : '-1', onclick: () => void chooseAppearance(choice.value),
          }, icon(choice.glyph, 20), h('span', {}, choice.label)))))),
    settingsSection('history', 'History',
      settingRow('history', 'Keep history for', 'Changes and deleted items stay in History, ready to restore, for this long.',
        // Unchangeable until main has said, so a shorter choice is never mistaken for a longer one.
        h('span.select', {},
          h('select', { id: 'history-days', 'aria-labelledby': 'setting-history-title', 'aria-describedby': 'setting-history-hint', disabled: !current,
            onchange: (event: Event) => chooseHistoryDays(Number((event.target as HTMLSelectElement).value) as HistoryDays) },
          historyChoices.map(days => h('option', { value: String(days), selected: days === (current?.historyDays ?? 30) }, `${days} days`))),
          icon('chevrons-up-down', 14)),
        shortening ? shortenConfirmation(shortening) : undefined)),
    settingsSection('help', 'Help',
      settingRow('log', 'Log file', 'Central Knot’s own log, for reporting a problem. Your tools’ files aren’t here.',
        button({ variant: 'outline', label: 'Show log file', id: 'show-log', onclick: () => void showLog(), attrs: { 'aria-describedby': 'setting-log-hint' } })))));
}
