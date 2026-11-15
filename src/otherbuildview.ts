// One install at a time, on the page: while the last look found another build of Central Knot on this Mac (heldBy: model.ts
// holdingBuild over types.ts HomeView otherBuilds, found by otherbuilds.ts in main), the window shows this one screen in place of
// the pages (renderer.ts): which build and where, that nothing changes while both are here, what stays and what doesn't carry
// over, with Replace (Quit X for a build that only runs) and Quit. A copy of this app outside an Applications folder (HomeView
// runsOutside) offers Replace nowhere, and from the Trash only Quit. A click is replaceOtherBuild or quitOtherBuild (main.ts
// builds:replace and builds:quit); what it came to is said on this screen while the build is still held (with Show in Finder
// where macOS kept the bundle), and once the look finds none, in a band on the page that comes back (app.ts tell). What is
// written while held, the menus and the login item are main.ts's (heldReason).
import { announce, busy, setHome, showFile, shownPath, state, tell } from './app.ts';
import { button, h, icon } from './dom.ts';
import { holdingBuild, syncOwner } from './model.ts';
import type { BuildOutcome, HomeView, OtherBuild } from './types.ts';
import { PRODUCT } from './values.ts';

/** The build that holds this one, where one does: the pages give way to heldScreen. */
export const heldBy = (home: HomeView | undefined) => (home ? holdingBuild(home.otherBuilds) : undefined);

const folderOf = (bundle: string) => shownPath(bundle.slice(0, bundle.lastIndexOf('/')));
/** Where a found build is, as one clause: "installed in /Applications, and is running", or "running from ~/Downloads/…, …". */
const whereWords = (found: OtherBuild) => (found.installed ? `installed in ${folderOf(found.installed)}${found.running?.includes(found.installed) ? ', and is running' : ''}`
  : `running from ${(found.running ?? []).map(shownPath).join(' and ')}, not from an Applications folder`);

/** What the last click on this screen came to, while a build still holds this one: said under the buttons. */
let said: { build: string; outcome: BuildOutcome } | undefined;

/**
 * What this copy offers for the build that holds it: Replace only from an Applications folder (HomeView runsOutside unset),
 * Quit X for a build that only runs (from anywhere but the Trash), and Quit itself always. `how`: what that does, said before
 * the click.
 */
function offer(home: HomeView, other: OtherBuild): { act?: 'replace' | 'quit'; how: string } {
  const outside = home.runsOutside;
  if (outside?.includes('/.Trash/')) return { how: `This copy of Central Knot runs from the Trash, so it can’t replace ${other.name}: quit it. If it starts at sign-in, turn that off in System Settings › General › Login Items.` };
  if (outside && other.installed) return { how: `This copy runs from ${shownPath(outside)}, not from an Applications folder, so it can’t replace ${other.name}: quit it, move it to Applications and open it from there.` };
  if (!other.installed) return { act: 'quit', how: `Quit ${other.name} asks every running copy of it to quit and waits up to 20 seconds; nothing is removed.` };
  return { act: 'replace', how: `Replace asks every running copy of ${other.name} to quit and waits up to 20 seconds, then moves ${shownPath(other.installed)} to the Trash, where it stays until you empty the Trash. ${other.name}’s own settings folder stays. To keep ${other.name} instead, quit this app and move it to the Trash.` };
}

/** The screen that stands in for every page while `other` holds this build. */
export function heldScreen(home: HomeView, other: OtherBuild): HTMLElement {
  const { act, how } = offer(home, other), verb = act === 'replace' ? 'Replace' : `Quit ${other.name}`;
  const keeps = !!act && syncOwner(home.sync.gate)?.build === other.build;
  const told = said?.build === other.build ? said.outcome : undefined, disabled = !!state.busy;
  return h('div.page', {}, h('div.scroll.held-scroll', { id: 'held-scroll' }, h('section.held', { id: 'held', 'aria-labelledby': 'held-title' },
    h('h2.held-title', { id: 'held-title' }, `${other.name} is ${whereWords(other)}`),
    h('p.held-line', {}, `Only one build of ${PRODUCT} works at a time, so Central Knot changes nothing in this home or your tools ${other.installed ? 'until one of the two is gone' : 'while both are open'}.`),
    h('p.held-line', {}, 'Your skills, MCP servers and agents, the record of them and History stay whichever you keep: they’re kept in this home, not in an app.'),
    h('p.held-line', {}, keeps ? `This home’s record names ${other.name} as the build that syncs it, so ${verb} carries its Automatic sync, plugin updates, History’s days and open home over here. Its other settings, and any marketplace added only in it, don’t carry over.`
      : `${other.name}’s own settings, and any marketplace added only in it, don’t carry over.`),
    h('p.held-line', {}, how),
    h('div.held-actions', {},
      act === 'replace' ? button({ variant: 'primary', size: 'small', label: `Replace ${other.name}`, id: 'held-replace', disabled, onclick: () => void replaceOtherBuild(other) })
        : act === 'quit' ? button({ variant: 'primary', size: 'small', label: `Quit ${other.name}`, id: 'held-quit-other', disabled, onclick: () => void quitOtherBuild(other) }) : null,
      button({ variant: act ? 'outline' : 'primary', size: 'small', label: 'Quit Central Knot', id: 'held-quit', disabled, onclick: () => void window.centralKnot.quit() })),
    told ? h('p.held-said', { role: 'status', id: 'held-said' }, icon(told.done ? 'check' : 'triangle-alert', 14, told.done ? 'tone-success' : 'tone-warning'), h('span', {}, `${told.said} `),
      told.show ? button({ variant: 'link', size: 'micro', label: 'Show in Finder', id: 'held-show', onclick: () => showFile(told.show!) }) : null) : null)));
}

/** Asks main while the page is busy and takes the view it sends back: still held, the result is said on this screen; freed, in a band on the page that comes back. */
const ask = (other: OtherBuild, message: string, call: () => Promise<BuildOutcome & { view: HomeView | null }>) => busy(message, async () => {
  const answer = await call();
  setHome(answer.view);
  const outcome = { said: answer.said, done: answer.done, ...(answer.show ? { show: answer.show } : {}) };
  said = heldBy(state.home) ? { build: other.build, outcome } : undefined;
  if (said) announce(outcome.said, true);
  else tell({ page: state.page, text: outcome.said, band: true, warn: !outcome.done });
});
/** Replace: the build quit and moved to the Trash (otherbuilds.ts removeBuild), then this one carries on (main.ts carryOn). */
export const replaceOtherBuild = (other: OtherBuild) => ask(other, `Replacing ${other.name}…`, () => window.centralKnot.replaceOtherBuild(other.installed!, other.build));
/** Quit X, for a build that only runs: every running copy asked to quit (otherbuilds.ts quitBuild), then the same. */
export const quitOtherBuild = (other: OtherBuild) => ask(other, `Asking ${other.name} to quit…`, () => window.centralKnot.quitOtherBuild(other.build));
