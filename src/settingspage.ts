// Settings: Central Knot's own preferences, kept apart from the tools' settings. The main process stores them
// (app-settings.json) and applies them; this page shows and changes them: how the app looks, and the two switches the
// menus also carry (Automatic sync and Start at sign-in), each changed through the same path as there.
import { announce, rerender, setSync, state } from './app.ts';
import { cardGrid, h, icon, toggle } from './dom.ts';
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

/** Turns Start at sign-in on or off, as the menu bar's item does. */
async function chooseSignIn(on: boolean): Promise<void> {
  current = await window.centralKnot.setStartAtSignIn(on);
  announce(on ? 'Central Knot starts at sign-in.' : 'Central Knot no longer starts at sign-in.', true);
  rerender();
}

/** One group of settings: a title, a line on what it does, and its control. */
const group = (id: string, title: string, hint: string, ...control: (Node | null)[]) =>
  h('section.card.settings-card', { 'aria-labelledby': id }, h('h2', { id }, title), h('p.settings-hint', {}, hint), ...control);

/** A switch with its name beside it, and a quiet reason when it can't be changed here. */
const switchRow = (control: HTMLElement, label: string, why?: string) =>
  h('div.settings-switch', {}, control, h('span.settings-switch-label', {}, label), why ? h('span.settings-why', {}, why) : null);

export function settingsPage(): HTMLElement {
  const chosen = current?.appearance;
  const home = state.home;
  const signIn = current?.signIn;
  const syncWhy = !home ? 'Open a home first.' : home.manage.access.allowed ? undefined : 'Paused: this home is preview only.';
  return h('div.page', {}, h('div.scroll.settings-scroll', {}, cardGrid([
    group('settings-appearance', 'Appearance', 'System follows your computer’s light or dark setting.',
      h('div.appearance-choices', { role: 'radiogroup', 'aria-labelledby': 'settings-appearance' },
        appearances.map(choice => h(`button.appearance-choice${chosen === choice.value ? '.selected' : ''}`, {
          type: 'button', role: 'radio', id: `appearance-${choice.value}`, 'aria-checked': String(chosen === choice.value),
          disabled: !current, onclick: () => void chooseAppearance(choice.value),
        }, icon(choice.glyph, 20), h('span', {}, choice.label))))),
    // The same switch as the status bar's and the menu's: an edit to a managed item spreads on its own, window closed or not.
    group('settings-sync', 'Automatic sync', 'When it is on, an edit to a managed skill, MCP server or agent spreads to the other tools on its own, even with this window closed. The status bar and the menu bar have the same switch.',
      switchRow(toggle(!!home?.syncOn && !syncWhy, 'Automatic sync', on => void setSync(on), !!syncWhy || !!state.busy, 'settings-sync-switch'), home?.syncOn && !syncWhy ? 'On' : 'Off', syncWhy)),
    signIn?.offered ? group('settings-sign-in', 'Start at sign-in', 'Opens Central Knot in the menu bar when you sign in, so automatic sync keeps running. The menu bar has the same switch.',
      switchRow(toggle(signIn.on, 'Start at sign-in', on => void chooseSignIn(on), !signIn.available, 'settings-sign-in-switch'), signIn.on ? 'On' : 'Off',
        signIn.available ? undefined : 'Only an installed Central Knot can start at sign-in (on a Mac, from Applications).')) : null,
  ].filter((card): card is HTMLElement => !!card))));
}
