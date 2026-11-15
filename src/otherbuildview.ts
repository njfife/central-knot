// One install at a time, on the page: while the last look found another build of Central Knot on this Mac (heldBy: model.ts
// holdingBuild over types.ts HomeView otherBuilds, found by otherbuilds.ts in main), the window shows this one screen in place of
// the pages (renderer.ts). First which build and where, what is going on and what the buttons do (offer), and the buttons:
// Replace (Quit X for a build that only runs) and Quit; then what stays, what becomes of the other build's settings
// (settingsWords), what the offer does step by step, and how to keep the other build instead. A copy of this app outside an
// Applications folder (HomeView runsOutside) offers Replace nowhere, and from the Trash only Quit. A click is replaceOtherBuild or
// quitOtherBuild (main.ts builds:replace and builds:quit); what it came to is said under the buttons while a build still holds
// this one, the same or the next (with Show in Finder where macOS kept the bundle), and once the look finds none, in a band on
// the page that comes back (app.ts tell). What is written while held, the menus and the login item are main.ts's (heldReason).
import { announce, busy, setHome, showFile, shownPath, state, tell } from './app.ts';
import { button, h, icon } from './dom.ts';
import { holdingBuild, holdsUntil, QUIT_WAIT_MS, syncOwner } from './model.ts';
import type { BuildOutcome, HomeView, OtherBuild } from './types.ts';
import { PRODUCT } from './values.ts';

/** The build that holds this one, where one does: the pages give way to heldScreen. */
export const heldBy = (home: HomeView | undefined) => (home ? holdingBuild(home.otherBuilds) : undefined);

const folderOf = (bundle: string) => shownPath(bundle.slice(0, bundle.lastIndexOf('/')));
/** Where a found build is, as one clause: "installed in /Applications, and is running", or "running from ~/Downloads/…, …". */
const whereWords = (found: OtherBuild) => (found.installed ? `installed in ${folderOf(found.installed)}${found.running?.includes(found.installed) ? ', and is running' : ''}`
  : `running from ${(found.running ?? []).map(shownPath).join(' and ')}, not from an Applications folder`);

/** What the last click on this screen came to, while a build still holds this one (the same one, or the next): said under the buttons. */
let said: BuildOutcome | undefined;
/** A view that isn't held drops it (renderer.ts renderPage), so a held screen later in the session never shows an old result. */
export const forgetHeldResult = () => { said = undefined; };

/**
 * What this copy offers for the build that holds it: Replace only from an Applications folder (HomeView runsOutside unset),
 * Quit X for a build that only runs (from anywhere but the Trash), and Quit itself always. `lead`: what the buttons do, said
 * first; `how`: what the offer does step by step, or why this copy offers no more than Quit.
 */
function offer(home: HomeView, other: OtherBuild): { act?: 'replace' | 'quit'; lead: string; how: string } {
  const outside = home.runsOutside, name = other.name, wait = `${QUIT_WAIT_MS / 1000} seconds`;
  const nothing = `Only one build of ${PRODUCT} works at a time, so Central Knot changes nothing in this home or your tools ${holdsUntil(other)}`;
  if (outside?.includes('/.Trash/')) {
    return { lead: `${nothing}, and this copy can’t replace ${name}: quit it.`,
      how: 'This copy of Central Knot runs from the Trash. If it starts at sign-in, turn that off in System Settings › General › Login Items.' };
  }
  // Its path isn't said: a copy opened from Downloads runs from a temporary system folder (App Translocation).
  if (outside && other.installed) {
    return { lead: `${nothing}, and this copy can’t replace ${name}: quit it.`,
      how: `This copy isn’t running from an Applications folder: to replace ${name}, quit it, move it to Applications and open it again from there.` };
  }
  if (!other.installed) {
    return { act: 'quit', lead: `${nothing}: Quit ${name} closes it and Central Knot carries on, and Quit Central Knot closes this app instead.`,
      how: `Quit ${name} asks every running copy of it to quit and waits up to ${wait}; nothing is removed.` };
  }
  return { act: 'replace', lead: `${nothing}: Replace moves ${name} to the Trash and Central Knot carries on, and Quit Central Knot closes this app and leaves both installed.`,
    how: `Replace asks every running copy of ${name} to quit and waits up to ${wait}, then moves ${shownPath(other.installed)} to the Trash, `
      + `where it stays until you empty the Trash. ${name}’s own settings folder stays.` };
}

/** What becomes of the other build's settings: kept where it syncs this home and its settings folder was found (types.ts OtherBuild settingsFound), else not. */
function settingsWords(home: HomeView, other: OtherBuild, verb: string): string {
  const name = other.name;
  if (syncOwner(home.sync.gate)?.build !== other.build) return `${name}’s own settings, and any marketplace added only in it, don’t carry over.`;
  if (!other.settingsFound) {
    return `${name} syncs this home, but its settings folder isn’t on this Mac, so Central Knot will use its own settings, among them how many days of History `
      + `are kept: anything older is dropped at its next change. Any marketplace added only in ${name} doesn’t carry over.`;
  }
  return `${name} syncs this home, so ${verb} keeps its choices here: whether Automatic sync is on, whether plugins update by themselves, how many days of History `
    + `are kept (the longer of the two) and which folder it opens when it starts. Its other settings, and any marketplace added only in it, don’t carry over.`;
}

/** The screen that stands in for every page while `other` holds this build: what is going on and the buttons first, then the detail. */
export function heldScreen(home: HomeView, other: OtherBuild): HTMLElement {
  const { act, lead, how } = offer(home, other), disabled = !!state.busy;
  return h('div.page', {}, h('div.scroll.held-scroll', { id: 'held-scroll' }, h('section.held', { id: 'held', 'aria-labelledby': 'held-title' },
    h('h2.held-title', { id: 'held-title' }, `${other.name} is ${whereWords(other)}`),
    h('p.held-line', {}, lead),
    h('div.held-actions', {},
      act === 'replace' ? button({ variant: 'primary', size: 'small', label: `Replace ${other.name}`, id: 'held-replace', disabled, onclick: () => void replaceOtherBuild(other) })
        : act === 'quit' ? button({ variant: 'primary', size: 'small', label: `Quit ${other.name}`, id: 'held-quit-other', disabled, onclick: () => void quitOtherBuild(other) }) : null,
      button({ variant: act ? 'outline' : 'primary', size: 'small', label: 'Quit Central Knot', id: 'held-quit', disabled, onclick: () => void window.centralKnot.quit() })),
    said ? h('p.held-said', { role: 'status', id: 'held-said' }, icon(said.done ? 'check' : 'triangle-alert', 14, said.done ? 'tone-success' : 'tone-warning'), h('span', {}, `${said.said} `),
      said.show ? button({ variant: 'link', size: 'micro', label: 'Show in Finder', id: 'held-show', onclick: () => showFile(said!.show!) }) : null) : null,
    h('p.held-line', {}, 'Your skills, MCP servers and agents, which of them are kept in step, and History stay whichever build you keep: they’re saved in this home, not in an app.'),
    h('p.held-line', {}, settingsWords(home, other, act === 'quit' ? `Quit ${other.name}` : 'Replace')),
    h('p.held-line', {}, how),
    act ? h('p.held-line', {}, `To keep ${other.name} instead, quit Central Knot and move it to the Trash.`) : null)));
}

/** Asks main while the page is busy and takes the view it sends back: still held, the result is said on this screen; freed, in a band on the page that comes back. */
const ask = (message: string, call: () => Promise<BuildOutcome & { view: HomeView | null }>) => busy(message, async () => {
  const answer = await call();
  setHome(answer.view);
  const outcome = { said: answer.said, done: answer.done, ...(answer.show ? { show: answer.show } : {}) };
  said = heldBy(state.home) ? outcome : undefined;
  if (said) announce(outcome.said, true);
  else tell({ page: state.page, text: outcome.said, band: true, warn: !outcome.done });
});
/** Replace: the build quit and moved to the Trash (otherbuilds.ts removeBuild), then this one carries on (main.ts carryOn). */
export const replaceOtherBuild = (other: OtherBuild) => ask(`Replacing ${other.name}…`, () => window.centralKnot.replaceOtherBuild(other.installed!, other.build));
/** Quit X, for a build that only runs: every running copy asked to quit (otherbuilds.ts quitBuild), then the same. */
export const quitOtherBuild = (other: OtherBuild) => ask(`Asking ${other.name} to quit…`, () => window.centralKnot.quitOtherBuild(other.build));
