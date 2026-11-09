// Settings: Central Knot's own preferences, kept apart from the tools' settings. The main process stores them
// (app-settings.json) and applies them; this page shows and changes them. For now, one: how the app looks.
import { announce, rerender } from './app.ts';
import { h, icon } from './dom.ts';
import type { IconName } from './icons.ts';
import type { AppPreferences, Appearance } from './types.ts';

/** The settings as last read from the main process; undefined until the page has loaded them. */
let current: AppPreferences | undefined;

/** Reads the settings for the page. */
export async function loadSettings(): Promise<void> {
  current = await window.centralKnot.getSettings();
  rerender();
}

const appearances: { value: Appearance; label: string; glyph: IconName }[] = [
  { value: 'system', label: 'System', glyph: 'monitor' },
  { value: 'light', label: 'Light', glyph: 'sun' },
  { value: 'dark', label: 'Dark', glyph: 'moon' },
];

/** Saves an appearance; the window follows it at once. */
async function chooseAppearance(appearance: Appearance): Promise<void> {
  current = await window.centralKnot.setAppearance(appearance);
  // Said for screen readers only: the chosen card already shows it.
  announce(`Appearance: ${appearances.find(choice => choice.value === appearance)?.label}.`, true);
  rerender();
}

export function settingsPage(): HTMLElement {
  const chosen = current?.appearance;
  return h('div.page', {}, h('div.scroll.settings-scroll', {},
    h('section.settings-section', { 'aria-labelledby': 'settings-appearance' },
      h('h2', { id: 'settings-appearance' }, 'Appearance'),
      h('p.settings-hint', {}, 'System follows your computer’s light or dark setting.'),
      h('div.appearance-choices', { role: 'radiogroup', 'aria-labelledby': 'settings-appearance' },
        appearances.map(choice => h(`button.appearance-choice${chosen === choice.value ? '.selected' : ''}`, {
          type: 'button', role: 'radio', id: `appearance-${choice.value}`, 'aria-checked': String(chosen === choice.value),
          disabled: !current, onclick: () => void chooseAppearance(choice.value),
        }, icon(choice.glyph, 20), h('span', {}, choice.label)))))));
}
