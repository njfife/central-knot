// Settings: Central Knot's own preferences, kept apart from the tools' settings. The main process stores them
// (app-settings.json) and applies them; this page shows them, one full-width row each, and changes one at a time.
import { announce, machine, rerender, showPage } from './app.ts';
import { button, h, icon, toggle } from './dom.ts';
import type { IconName } from './icons.ts';
import { DAY_MS, defaultHistoryDays, historyDayChoices } from './model.ts';
import type { AppPreferences, Appearance, HistoryDays, HistoryPrune, HistoryWindowSaved, SignInPlace } from './types.ts';
import { buildWords, releasesPage, tagWords, updateStatus } from './updates.ts';
import { checkNow, unsavedWork, updateControl, updates } from './updateview.ts';
import { checkPluginsNow, checkedWords, everyWords, pluginUpdates } from './pluginupdateview.ts';
import { CHECK_EVERY_MS } from './pluginupdates.ts';

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
const shownBy: Record<string, (settings: AppPreferences) => unknown> = { 'sign-in': settings => settings.signIn, appearance: settings => settings.appearance, history: settings => settings.historyDays, 'plugin-updates': settings => settings.pluginUpdates };
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
function showNewest(settings: AppPreferences, rank: number) {
  if (rank < shownRank) return;
  shownRank = rank;
  if (JSON.stringify(settings) === JSON.stringify(current)) return;
  current = settings;
  for (const [row, message] of messages) if (settled(row, message)) messages.delete(row);
  rerender();
}

/**
 * Reads the settings for the page: when it opens, and when main says they changed or the window comes back. An open shorten
 * question keeps its moment current, changed in place: a redraw here could swallow the click that focused the window.
 */
export async function loadSettings() {
  const rank = ++ranked;
  const settings = await window.centralKnot.getSettings();
  showNewest(settings, rank);
  const question = document.getElementById('history-shorten-text');
  if (shortening && question) question.textContent = shortenQuestion(shortening);
  return settings;
}

/** Opens the page fresh: what the rows said last time (a failure since put right elsewhere, say) belongs to that visit. */
export function openSettings() {
  messages.clear();
  shortening = undefined;
  // An action still running from the last visit keeps its effect (a save still saves) but no longer speaks for its row, except
  // a History window change still under way: its outcome (removed, or couldn't be) is only ever said in that row.
  const updating = attempts.get('history');
  attempts.clear();
  if (updatingHistory && updating !== undefined) attempts.set('history', updating);
  void loadSettings();
}

/**
 * Runs one row's action (a save, Show log file) and shows its outcome in that row: `work` returns a message to show (or
 * nothing), or throws, and `failure` puts why in plain words. A failure is about the value the row showed when it began (still
 * in effect). Only the row's newest attempt changes the row, and an outcome a newer read has settled says nothing. It first clears
 * the other rows' finished notes, so the page says one thing at a time. True when it worked.
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
function saveFailure(error: string, kept: string): string {
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

/** What starting at sign-in does. A reason it can't be changed here takes this line's place. */
const signInHint = `Opens hidden in ${machine.tray} when you sign in, so sync keeps running without the window.`;
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
  if (days >= current!.historyDays) { void saveHistoryDays(days); return; }
  shortening = days;
  // What the row said last was about an earlier choice; the question replaces it, and is the one thing the page says now.
  messages.delete('history');
  quietOtherRows('history');
  rerender();
  document.getElementById('setting-history-question')?.scrollIntoView({ block: 'nearest' });
  announce(shortenQuestion(days), true);
}

/** Where a window of `days` starts, as of now, in the person's own date and time format. */
const removedBefore = (days: HistoryDays) => new Date(Date.now() - days * DAY_MS).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortenQuestion = (days: HistoryDays) =>
  `History before ${removedBefore(days)} will be removed and can’t be restored. Your other homes remove it too the next time they record a change.`;

/**
 * What a shorter window did to older History, as main reports it. Only 'done' says anything was removed (with a check); the
 * window is saved in every case, and History already shows only what it covers.
 */
const pruneNotes: Record<HistoryPrune, (before: string) => Pick<RowMessage, 'text' | 'detail' | 'tone'>> = {
  done: before => ({ text: `Saved. History before ${before} was removed.`, tone: 'done' }),
  later: before => ({ text: `Saved. History before ${before} will be removed the next time this home records a change.`, tone: 'info' }),
  // Whichever copy records a change there applies its own window, so this one's date isn't promised.
  elsewhere: () => ({ text: 'Saved. Older History in this home is removed the next time Central Knot records a change in it.', tone: 'info' }),
  'no-home': () => ({ text: 'Saved.', tone: 'info' }),
  failed: before => ({ text: `Saved, but History before ${before} couldn’t be removed.`, detail: 'Central Knot will try again the next time this home records a change. The log file says why.', tone: 'failure' }),
};

/**
 * Saves the window. Main may first wait for a sync pass, so meanwhile the row says it is updating and can't start another
 * change (the other rows still can). After a shorter window it says what became of the older History; main reports nothing
 * pruned for a longer window, or for a request a newer one overtook in its queue.
 */
async function saveHistoryDays(days: HistoryDays) {
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

/** The row's question before a shorter window removes anything: from when, that it can't be undone, and that other homes follow later. */
function shortenConfirmation(days: HistoryDays): HTMLElement {
  return h('div.notice.notice-danger.setting-confirm', { id: 'setting-history-question', role: 'group', 'aria-labelledby': 'history-shorten-text', onkeydown: cancelOnEscape },
    icon('circle-alert', 16, 'tone-danger'),
    h('p.setting-confirm-text', { id: 'history-shorten-text' }, shortenQuestion(days)),
    h('div.setting-confirm-actions', {},
      button({ variant: 'danger', size: 'small', label: `Shorten to ${days} days`, id: 'history-shorten', onclick: () => void saveHistoryDays(days) }),
      // Says what it keeps: the saved window, which the select still shows.
      button({ variant: 'outline', size: 'small', label: `Keep ${current!.historyDays} days`, id: 'history-shorten-cancel', onclick: closeShortening })));
}

/** Shows the log in the file manager. Where it could only open the folder, the row says so and names the file to look for. */
const showLog = () => act('log', async () => {
  const shown = await window.centralKnot.showLog();
  if (shown.selected) return undefined;
  return { text: shown.logged ? 'Opened the log’s folder. The file is central-knot.log.' : 'Opened the log’s folder. Nothing has been logged yet.', tone: 'note' };
}, () => 'Couldn’t open the log’s folder. Try again.');

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
 * One setting: its name and hint at the left, its control at the right (under them on a narrow page), and beneath both, on
 * lines of their own so the control never moves when they come or go: what its last action said, `notice`, what needs the
 * person about its current state, and `question`, one the row is asking before it acts.
 */
function settingRow(id: string, title: string, hint: string, control: HTMLElement, notice?: RowMessage, question?: HTMLElement): HTMLElement {
  const message = messages.get(id);
  return h('div.setting-row', { id: `setting-${id}` },
    h('div.setting-text', {},
      h('div.setting-title', { id: `setting-${id}-title` }, title),
      h('p.setting-hint', { id: `setting-${id}-hint` }, hint)),
    h('div.setting-control', {}, control),
    message && messageLine(message, { id: `setting-${id}-message` }),
    notice && messageLine(notice, { id: `setting-${id}-notice`, announce: false }),
    question);
}

/**
 * Updates: the build in use, Check now and the Update button, what the last check or update found, and why this copy can't
 * update itself, with the release page instead. Not shown where there are no releases (only Macs have them).
 */
function updatesRow(): HTMLElement | null {
  const view = updates.view;
  if (!view?.shown) return null;
  const checks = !!view.tag && view.reason?.key !== 'dev' && view.reason?.key !== 'untagged';
  const hint = `This is Central Knot ${buildWords(view)}.${checks ? ' It checks GitHub for a newer release every few hours.' : ''}`;
  // A restart held for unsaved work says so here too, not only on the button.
  const held = view.step === 'ready' && view.available ? unsavedWork() : undefined;
  const { page: about, ...status } = (held ? { text: `${tagWords(view.available!.tag)} is ready. ${held}`, tone: 'info' as const, page: view.available!.page } : updateStatus(view)) ?? {};
  const page = view.available?.page;
  const notice: RowMessage | undefined = 'text' in status ? { ...status, action: about && !view.reason ? { label: status.tone === 'failure' ? 'Open the release page' : 'Release notes', run: () => void window.centralKnot.openExternal(about) } : undefined } : undefined;
  const why = view.reason && messageLine({ text: view.reason.text, tone: 'attention', action: { label: page ? `Open ${tagWords(view.available!.tag)}’s page` : 'Open the releases page', run: () => void window.centralKnot.openExternal(page ?? releasesPage) } },
    { id: 'setting-updates-reason', announce: false });
  return settingRow('updates', 'Updates', hint,
    h('div.setting-actions', {},
      updateControl('setting-update', 'setting'),
      checks ? button({ variant: 'outline', label: 'Check now', id: 'check-updates', disabled: updates.checking || view.checking || !!view.step, onclick: () => void checkNow(), attrs: { 'aria-describedby': 'setting-updates-hint' } }) : null),
    notice, why || undefined);
}

/** Turns automatic plugin updates on or off. Turned on, main checks at once if the last check is long enough ago. */
async function choosePluginUpdates(on: boolean): Promise<void> {
  const kept = current ? `Plugins are still ${current.pluginUpdates ? 'updated automatically' : 'updated only when you choose Update'}.` : '';
  if (await save('plugin-updates', () => window.centralKnot.setPluginUpdates(on), kept)) announce(on ? 'Plugins are updated automatically from now on.' : 'Plugins are updated only when you choose Update.', true);
}

/**
 * Plugins: whether they are updated automatically, what that does, Check now, and what the last check came to (the note
 * on the Plugins page says which plugins).
 */
function pluginUpdatesRow(): HTMLElement {
  const on = !!current?.pluginUpdates;
  const view = pluginUpdates.view;
  const hint = `Central Knot checks your marketplaces ${everyWords(view?.every ?? CHECK_EVERY_MS)}, with its window closed too, and updates the plugins your tools have, through each tool’s own command. A plugin you turned off stays off. An update can’t be undone.`;
  const checked = on ? checkedWords(pluginUpdates.asked && view ? { ...view, checking: true } : view) : undefined;
  const notice: RowMessage | undefined = checked && { text: checked.text, tone: checked.tone, action: checked.note ? { label: 'See Plugins', run: () => showPage('plugins') } : undefined };
  return settingRow('plugin-updates', 'Update plugins automatically', hint,
    h('div.setting-actions', {},
      on ? button({ variant: 'outline', label: 'Check now', id: 'check-plugin-updates', disabled: !view || view.checking || pluginUpdates.asked, onclick: () => void checkPluginsNow(), attrs: { 'aria-describedby': 'setting-plugin-updates-hint' } }) : null,
      // Unchangeable until main has said, so a click never acts on a guess.
      toggle({ on, label: 'Update plugins automatically', onchange: chosen => void choosePluginUpdates(chosen), disabled: !current, id: 'plugin-updates-on',
        attrs: { 'aria-describedby': notice ? 'setting-plugin-updates-hint setting-plugin-updates-notice' : 'setting-plugin-updates-hint', title: null } })),
    notice);
}

const settingsSection = (id: string, title: string, ...rows: (HTMLElement | null)[]) =>
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
          }, icon(choice.glyph, 20), h('span', {}, choice.label))))),
      updatesRow()),
    settingsSection('plugins', 'Plugins', pluginUpdatesRow()),
    settingsSection('history', 'History',
      settingRow('history', 'Keep history for', 'Changes and deleted items stay in History, ready to restore, for this long.',
        // Unchangeable until main has said, so a shorter choice is never mistaken for a longer one, and while a change is under way.
        h('span.select', {},
          h('select', { id: 'history-days', 'aria-labelledby': 'setting-history-title', 'aria-describedby': 'setting-history-hint', disabled: !current || updatingHistory,
            onchange: (event: Event) => chooseHistoryDays(Number((event.target as HTMLSelectElement).value) as HistoryDays), onkeydown: cancelOnEscape },
          historyDayChoices.map(days => h('option', { value: String(days), selected: days === (current?.historyDays ?? defaultHistoryDays) }, `${days} days`))),
          icon('chevrons-up-down', 14)),
        updatingHistory ? { text: 'Updating History…', tone: 'progress' } : undefined,
        shortening ? shortenConfirmation(shortening) : undefined)),
    settingsSection('help', 'Help',
      settingRow('log', 'Log file', 'Central Knot’s own log, for reporting a problem. Your tools’ files aren’t here.',
        button({ variant: 'outline', label: 'Show log file', id: 'show-log', onclick: () => void showLog(), attrs: { 'aria-describedby': 'setting-log-hint' } })))));
}
