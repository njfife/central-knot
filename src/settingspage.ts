// Settings: Central Knot's own preferences, kept apart from the tools' settings. The main process stores them
// (app-settings.json) and applies them; this page shows them, one full-width row each, and changes one at a time.
import { announce, rerender } from './app.ts';
import { button, h, icon } from './dom.ts';
import type { IconName } from './icons.ts';
import type { AppPreferences, Appearance } from './types.ts';

/** The settings as last read from the main process; undefined until the page has loaded them. */
let current: AppPreferences | undefined;
/** Why the last action in a row failed, by row id, shown in that row until it is tried again. */
const failures = new Map<string, string>();
/** Answers from main can cross (a save, then a re-read on focus): only the newest request's answer is shown. */
let latest = 0;

async function show(answer: Promise<AppPreferences>): Promise<void> {
  const mine = ++latest;
  const settings = await answer;
  if (mine !== latest) return;
  current = settings;
  rerender();
}

/** Reads the settings for the page: when it opens, and when main says they changed or the window comes back. */
export const loadSettings = () => show(window.centralKnot.getSettings());

/** The reason without Electron's "Error invoking remote method '…': Error:" wrapping. */
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '');

/** Saves one setting. Nothing changes on screen until main has saved it, so a failed save leaves the saved value showing. */
async function save(row: string, change: () => Promise<AppPreferences>): Promise<boolean> {
  failures.delete(row);
  try { await show(change()); return true; } catch (error) {
    failures.set(row, `Couldn’t save this change: ${reason(error)}`);
    rerender();
    return false;
  }
}

const appearances: { value: Appearance; label: string; glyph: IconName }[] = [
  { value: 'system', label: 'System', glyph: 'monitor' },
  { value: 'light', label: 'Light', glyph: 'sun' },
  { value: 'dark', label: 'Dark', glyph: 'moon' },
];

/** Saves an appearance; the window follows it at once. */
async function chooseAppearance(appearance: Appearance): Promise<void> {
  // Said for screen readers only: the chosen card already shows it.
  if (await save('appearance', () => window.centralKnot.setAppearance(appearance))) announce(`Appearance: ${appearances.find(choice => choice.value === appearance)?.label}.`, true);
}

async function showLog(): Promise<void> {
  failures.delete('log');
  const { failed } = await window.centralKnot.showLog().catch(error => ({ failed: reason(error) }));
  if (failed) failures.set('log', `Couldn’t show the log file: ${failed}`);
  rerender();
}

/** One setting: its name and hint at the left, its control at the right (under them on a narrow page), and why its last change failed. */
function settingRow(id: string, title: string, hint: string, control: HTMLElement): HTMLElement {
  const failure = failures.get(id);
  return h('div.setting-row', { id: `setting-${id}` },
    h('div.setting-text', {},
      h('div.setting-title', { id: `setting-${id}-title` }, title),
      h('p.setting-hint', { id: `setting-${id}-hint` }, hint),
      failure && h('p.setting-failure', { role: 'alert' }, icon('circle-alert', 14), h('span', {}, failure))),
    h('div.setting-control', {}, control));
}

const settingsSection = (id: string, title: string, ...rows: HTMLElement[]) =>
  h('section.settings-section', { 'aria-labelledby': `settings-${id}` }, h('h2.eyebrow', { id: `settings-${id}` }, title), ...rows);

export function settingsPage(): HTMLElement {
  const chosen = current?.appearance;
  return h('div.page', {}, h('div.scroll.settings-scroll', {},
    settingsSection('general', 'General',
      settingRow('appearance', 'Appearance', 'System follows your computer’s light or dark setting.',
        h('div.appearance-choices', { role: 'radiogroup', 'aria-labelledby': 'setting-appearance-title', 'aria-describedby': 'setting-appearance-hint' },
          appearances.map(choice => h(`button.appearance-choice${chosen === choice.value ? '.selected' : ''}`, {
            type: 'button', role: 'radio', id: `appearance-${choice.value}`, 'aria-checked': String(chosen === choice.value),
            disabled: !current, onclick: () => void chooseAppearance(choice.value),
          }, icon(choice.glyph, 20), h('span', {}, choice.label)))))),
    settingsSection('help', 'Help',
      settingRow('log', 'Log file', 'Central Knot’s own log, for reporting a problem. Your tools’ files aren’t here.',
        button({ variant: 'outline', label: 'Show log file', id: 'show-log', onclick: () => void showLog(), attrs: { 'aria-describedby': 'setting-log-hint' } })))));
}
