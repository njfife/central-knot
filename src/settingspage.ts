// Settings: Central Knot's own preferences, kept apart from the tools' settings. The main process stores them
// (app-settings.json) and applies them; this page shows them, one full-width row each, and changes one at a time.
import { announce, rerender } from './app.ts';
import { button, h, icon } from './dom.ts';
import type { IconName } from './icons.ts';
import type { AppPreferences, Appearance } from './types.ts';

/** The settings as last read from the main process; undefined until the page has loaded them. */
let current: AppPreferences | undefined;
/** What each row's last action said, by row id: why it failed, or a note on what it did. */
const messages = new Map<string, { text: string; failed: boolean }>();
/** Each row's newest action, so one that finishes late never sets or clears the message of a newer one. */
const attempts = new Map<string, number>();
let attempted = 0;

/** Answers from main can cross (a save, then a re-read on focus): only the newest request's answer is shown. */
let latest = 0;

/**
 * Shows main's answer unless a newer request has started since; a rejected answer propagates to the caller. An answer that
 * matches the page leaves it alone: rebuilding it when the window is focused would swallow the click that focused it.
 */
async function showNewest(answer: Promise<AppPreferences>): Promise<void> {
  const mine = ++latest;
  const settings = await answer;
  if (mine !== latest || JSON.stringify(settings) === JSON.stringify(current)) return;
  current = settings;
  rerender();
}

/** Reads the settings for the page: when it opens, and when main says they changed or the window comes back. */
export const loadSettings = () => showNewest(window.centralKnot.getSettings());

/** Opens the page fresh: what the rows said last time (a failure since put right elsewhere, say) belongs to that visit. */
export function openSettings() {
  messages.clear();
  // An action still running from the last visit keeps its effect (a save still saves) but no longer speaks for its row.
  attempts.clear();
  void loadSettings();
}

/**
 * Runs one row's action (a save, Show log file) and shows its outcome in that row: `work` returns a note to show (or nothing),
 * or throws, and `failure` puts why in plain words. Only the row's newest attempt changes the row. True when it worked.
 */
async function act(row: string, work: () => Promise<string | undefined>, failure: (error: string) => string): Promise<boolean> {
  const mine = ++attempted;
  attempts.set(row, mine);
  let message: { text: string; failed: boolean } | undefined;
  try {
    const note = await work();
    if (note) message = { text: note, failed: false };
  } catch (error) { message = { text: failure(String(error)), failed: true }; }
  if (attempts.get(row) === mine && JSON.stringify(message) !== JSON.stringify(messages.get(row))) {
    if (message) messages.set(row, message); else messages.delete(row);
    rerender();
  }
  return !message?.failed;
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

/** Saves one setting. Nothing changes on screen until main has saved it, so a failed save leaves the saved value showing. */
const save = (row: string, change: () => Promise<AppPreferences>, kept: string) =>
  act(row, async () => { await showNewest(change()); return undefined; }, error => saveFailure(error, kept));

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

/** Shows the log in the file manager. Where it could only open the folder, the row says so and names the file to look for. */
const showLog = () => act('log', async () => {
  const shown = await window.centralKnot.showLog();
  if (shown.selected) return undefined;
  return shown.logged ? 'Opened the log’s folder. The file is central-knot.log.' : 'Opened the log’s folder. Nothing has been logged yet.';
}, () => 'Couldn’t open the log’s folder. Try again.');

/**
 * One setting: its name and hint at the left, its control at the right (under them on a narrow page), and what its last
 * action said on a line of its own beneath both, so the control never moves when a message comes or goes.
 */
function settingRow(id: string, title: string, hint: string, control: HTMLElement): HTMLElement {
  const message = messages.get(id);
  return h('div.setting-row', { id: `setting-${id}` },
    h('div.setting-text', {},
      h('div.setting-title', { id: `setting-${id}-title` }, title),
      h('p.setting-hint', { id: `setting-${id}-hint` }, hint)),
    h('div.setting-control', {}, control),
    message && (message.failed
      ? h('p.setting-message.setting-failure', { role: 'alert' }, icon('circle-alert', 14), h('span', {}, message.text))
      : h('p.setting-message.setting-note', { role: 'status' }, icon('folder-open', 14), h('span', {}, message.text))));
}

const settingsSection = (id: string, title: string, ...rows: HTMLElement[]) =>
  h('section.settings-section', { 'aria-labelledby': `settings-${id}` }, h('h2.eyebrow', { id: `settings-${id}` }, title), ...rows);

export function settingsPage(): HTMLElement {
  const chosen = current?.appearance;
  return h('div.page', {}, h('div.scroll.settings-scroll', {},
    settingsSection('general', 'General',
      settingRow('appearance', 'Appearance', 'System follows your computer’s light or dark setting.',
        // Until the settings arrive, no card is chosen; the cards look as usual (not dimmed) and System holds the Tab stop.
        h('div.appearance-choices', { role: 'radiogroup', 'aria-labelledby': 'setting-appearance-title', 'aria-describedby': 'setting-appearance-hint', 'aria-busy': String(!current), onkeydown: moveAppearance },
          appearances.map(choice => h(`button.appearance-choice${chosen === choice.value ? '.selected' : ''}`, {
            type: 'button', role: 'radio', id: `appearance-${choice.value}`, 'aria-checked': String(chosen === choice.value),
            tabindex: (chosen ?? 'system') === choice.value ? '0' : '-1', onclick: () => void chooseAppearance(choice.value),
          }, icon(choice.glyph, 20), h('span', {}, choice.label)))))),
    settingsSection('help', 'Help',
      settingRow('log', 'Log file', 'Central Knot’s own log, for reporting a problem. Your tools’ files aren’t here.',
        button({ variant: 'outline', label: 'Show log file', id: 'show-log', onclick: () => void showLog(), attrs: { 'aria-describedby': 'setting-log-hint' } })))));
}
