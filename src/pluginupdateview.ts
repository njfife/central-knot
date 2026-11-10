// Plugin updates that arrive by themselves, on the page (pluginupdates.ts does the work): the note on the Plugins page of
// what was updated and what couldn't be, what the Settings row says of the last check, and Check now.
import { announce, rerender, showPage, state as app } from './app.ts';
import { closeButton, h, icon } from './dom.ts';
import { dayAndTime, plural } from './model.ts';
import { browse, loadPlugins, market } from './pluginstate.ts';
import type { PluginUpdateLine, PluginUpdatesView } from './types.ts';
import { andList } from './words.ts';

/** Automatic plugin updates as main last told them (undefined until read); `asked`: a Check now is under way; `all`: the note shows every line. */
export const pluginUpdates = { view: undefined as PluginUpdatesView | undefined, asked: false, all: { updated: false, failed: false } };

/** The note shows this many lines of each kind until "Show all". */
const LINES_SHOWN = 4;

const at = (time: number) => dayAndTime(new Date(time).toISOString());

/** "every four hours", from the time between checks. */
export function everyWords(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  const words = ['', 'hour', 'two hours', 'three hours', 'four hours', 'five hours', 'six hours'];
  return hours === 24 ? 'once a day' : hours >= 1 ? `every ${words[hours] ?? `${hours} hours`}` : 'every few moments';
}

/**
 * What the last check came to, for the Settings row: when, how many updates it made and how many are failing, the
 * marketplaces it couldn't read, or why it did nothing. `note`: the Plugins page has more to read about it.
 */
export function checkedWords(view: PluginUpdatesView | undefined): { text: string; tone: 'info' | 'attention' | 'progress'; note?: boolean } | undefined {
  if (!view?.on) return undefined;
  if (view.checking) return { text: 'Checking your marketplaces…', tone: 'progress' };
  const checked = view.checked;
  if (!checked) return { text: 'Not checked yet in this home. The first check comes soon after Central Knot opens.', tone: 'info' };
  if (checked.stopped) return { text: `Last checked ${at(checked.at)}. Nothing was updated: ${checked.stopped}`, tone: 'attention' };
  const unread = checked.unread.length ? ` ${andList(checked.unread)} couldn’t be read, so ${checked.unread.length > 1 ? 'their' : 'its'} plugins weren’t checked.` : '';
  const did = [checked.updated ? `${plural(checked.updated, 'update')} made` : '', checked.failed ? `${plural(checked.failed, 'update')} couldn’t be made` : ''].filter(Boolean).join(', ');
  return { text: `Last checked ${at(checked.at)}. ${did ? `${did.charAt(0).toUpperCase()}${did.slice(1)}.` : 'Nothing needed updating.'}${unread}`, tone: checked.failed || unread ? 'attention' : 'info', note: !!(view.updated.length || view.failed.length) };
}

/** Takes main's view. News (something was updated, or an update failed) is said in the status bar, and the Plugins page reads its tools again. */
function take(view: PluginUpdatesView, news = false) {
  pluginUpdates.view = view;
  if (news) {
    const latest = (lines: PluginUpdateLine[]) => [...new Set(lines.filter(line => line.at === view.checked?.at && !line.warn).map(line => line.plugin))];
    const updated = latest(view.updated), failed = latest(view.failed);
    const said = [updated.length ? `Updated automatically: ${andList(updated)}.` : '', failed.length ? `Couldn’t update ${andList(failed)} automatically.` : ''].filter(Boolean).join(' ');
    // On Plugins the note itself says it; elsewhere the status bar does, with the way there.
    if (said) announce(said, app.page === 'plugins', app.page === 'plugins' ? undefined : { label: 'See Plugins', run: () => showPage('plugins') });
    if (market.view && !app.busy) void loadPlugins();
  }
  if (app.page === 'plugins' || app.page === 'settings') rerender();
}

/** Main tells the page when a check begins and ends; the page asks once when it opens, and again with each home. */
export function followPluginUpdates() {
  window.centralKnot.onPluginUpdatesChanged(take);
  void loadPluginUpdates();
}
export const loadPluginUpdates = () => window.centralKnot.pluginUpdates().then(view => take(view), () => undefined);

/** Check now (Settings): checks the marketplaces and updates what is behind, then says what it came to. */
export async function checkPluginsNow() {
  if (pluginUpdates.asked) return;
  pluginUpdates.asked = true;
  rerender();
  announce('Checking your marketplaces…', true);
  try {
    take(await window.centralKnot.checkPluginUpdates());
    announce(checkedWords(pluginUpdates.view)?.text ?? '', true);
  } catch { announce('Couldn’t check your marketplaces. Try again; the log file says why.'); }
  finally {
    pluginUpdates.asked = false;
    rerender();
    // The button was disabled under the focus; it takes it back unless the person has moved on.
    if (document.activeElement === document.body) document.getElementById('check-plugin-updates')?.focus();
  }
}

async function closeNote(what: 'updated' | 'failed') {
  pluginUpdates.all[what] = false;
  try { take(await window.centralKnot.closePluginUpdates(what)); } catch { announce('Couldn’t close the note. Try again.'); }
}

/** One group of the note: what it is about, then a line per plugin (its name opens its page), and the way to close it. */
function noteBand(what: 'updated' | 'failed', lines: PluginUpdateLine[], lead: string): HTMLElement | null {
  if (!lines.length) return null;
  // The newest check first; within one check, the order the updates ran in.
  const newest = [...lines].sort((first, second) => second.at - first.at);
  const shown = pluginUpdates.all[what] ? newest : newest.slice(0, LINES_SHOWN);
  const open = (line: PluginUpdateLine) => browse({ source: line.source, plugin: line.plugin, tab: 'plugins', find: '', category: undefined });
  return h(`div.band.plugin-auto-note${what === 'failed' ? '.plugin-problems' : ''}`, { role: 'status', id: `plugin-updates-${what}` },
    what === 'failed' ? icon('triangle-alert', 14, 'tone-warning') : icon('refresh-cw', 14, 'tone-success'),
    h('span.band-text.band-lines', {},
      // One line reads on from what it is about; several are listed under it.
      shown.length > 1 ? h('span.plugin-auto-lead', {}, lead) : null,
      shown.map((line, index) => h('span', {},
        shown.length > 1 ? null : [h('span.plugin-auto-lead', {}, lead), ' '],
        h('button.result-link', { type: 'button', id: `plugin-updates-${what}-${index}`, title: `Open ${line.plugin}`, onclick: () => open(line) }, line.plugin), `: ${line.text}`, h('span.plugin-auto-when', {}, ` · ${at(line.at)}`))),
      newest.length > shown.length ? h('button.text-action', { type: 'button', id: `plugin-updates-${what}-all`, onclick: () => { pluginUpdates.all[what] = true; rerender(); } }, `Show all ${newest.length}`) : null),
    closeButton(() => void closeNote(what), { id: `plugin-updates-${what}-close`, label: 'Close this note' }));
}

/** The note on the Plugins page: what automatic updates did since it was last closed, and what they couldn't do. */
export function pluginUpdateNotes(): (HTMLElement | null)[] {
  const view = pluginUpdates.view;
  if (!view) return [];
  return [
    noteBand('updated', view.updated, 'Updated automatically.'),
    noteBand('failed', view.failed, view.on ? 'Couldn’t update automatically; Central Knot tries again later.' : 'Couldn’t update automatically.'),
  ];
}
