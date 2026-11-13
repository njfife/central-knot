// Another build of Central Knot on this Mac, on the page: what the last look found (types.ts HomeView otherBuilds, from
// otherbuilds.ts in main), offered where it is decided. Where the build that syncs this home is installed here, Take over
// syncing becomes two choices (takeOverChoices, drawn by matrix.ts otherOwnerBand and pages.ts overviewPage); where another
// build is here and doesn't sync this home, the Overview has a band that can be hidden (otherBuildBands) and Settings a row
// for each one found (settingspage.ts otherBuildsSection, in the words of buildHint and buildAction). A click is
// removeOtherBuild or quitOtherBuild; its result is a band on the page it was made on (app.ts tell), or in Settings that
// section's line.
import { announce, busy, otherOwnerSaid, rerender, setHome, showFile, shownPath, state, takeOverSync, takeOverTitle, tell } from './app.ts';
import { button, closeButton, h, icon } from './dom.ts';
import { readFlag, writeFlag } from './flags.ts';
import type { BuildOutcome, HomeView, OtherBuild } from './types.ts';
import { PRODUCT } from './values.ts';

/** A found build with a bundle in an Applications folder: Remove can take it. */
type Installed = OtherBuild & { installed: string };
const isInstalled = (found: OtherBuild): found is Installed => !!found.installed;

/** The open home's sync owner, where another build syncs it. */
const ownerOf = (home: HomeView) => (home.sync.gate.state === 'stopped' ? home.sync.gate.owner : undefined);
/** Whether a found build is the one that syncs the open home: it is removed only by taking over first. */
export const syncsHere = (home: HomeView, found: OtherBuild) => ownerOf(home)?.build === found.build;

/** Where a found build is and where its copies run, as one clause: "in /Applications, and is running", "running from ~/Downloads/…". */
function whereWords(found: OtherBuild): string {
  const elsewhere = (found.running ?? []).filter(path => path !== found.installed).map(shownPath);
  if (!found.installed) return `running from ${elsewhere.join(' and ')}`;
  const folder = shownPath(found.installed.slice(0, found.installed.lastIndexOf('/')));
  return `in ${folder}${found.running?.includes(found.installed) ? ', and is running' : ''}${elsewhere.length ? `; a copy is running from ${elsewhere.join(' and ')}` : ''}`;
}

/** What Remove does, said before the click: it quits the build and moves it to the Trash, and what stays. */
const removeWords = (name: string) => `Removing ${name} quits it and moves it to the Trash, where it stays until you empty the Trash. Your skills, MCP servers and agents stay: they’re kept in the home, not in the app.`;
/** A build that runs from the Trash most likely started at sign-in, which only the system's own settings turn off. */
const fromTrash = (found: OtherBuild) => (found.running ?? []).some(path => path.includes('/.Trash/'))
  ? ` It runs from the Trash: if it starts at sign-in, turn that off in System Settings › General › Login Items.` : '';

/** Settings' row for a found build: what it is, where it is, that one build syncs a home at a time, and what its action does. */
export function buildHint(home: HomeView, found: OtherBuild): string {
  const where = whereWords(found);
  const one = `Only one build of ${PRODUCT} syncs a home at a time`;
  if (!isInstalled(found)) return `${where.charAt(0).toUpperCase()}${where.slice(1)}, not from an Applications folder. ${one}. Quit asks it to quit; nothing is removed.${fromTrash(found)}`;
  return `Installed ${where}. ${one}${syncsHere(home, found) ? `, and ${found.name} syncs this one, so Central Knot takes over syncing it first` : ''}. ${removeWords(found.name)}`;
}

/** Shows what a click came to, in words: a band on its page, or Settings' line. */
type Show = (outcome: BuildOutcome) => void;

/** Asks main while the page is busy, takes the view it sends back (with the build gone, or still there), and shows the result. */
const ask = (message: string, call: () => Promise<BuildOutcome & { view: HomeView | null }>, show: Show) =>
  busy(message, async () => { const answer = await call(); setHome(answer.view); show(answer); });

/** Removes a found build: quits it and moves it to the Trash (otherbuilds.ts removeClick), taking over syncing first where asked. */
export const removeOtherBuild = (found: Installed, takeOver: boolean, show: Show = tellHere) =>
  ask(`${takeOver ? 'Taking over syncing, then removing' : 'Removing'} ${found.name}…`, () => window.centralKnot.removeOtherBuild(state.home!.home, found.installed, found.build, takeOver), show);
/** Asks every running copy of a found build to quit (otherbuilds.ts quitBuild). */
export const quitOtherBuild = (found: OtherBuild, show: Show = tellHere) => ask(`Asking ${found.name} to quit…`, () => window.centralKnot.quitOtherBuild(found.build), show);

/** A click's result as a band on the page it was made on, with Show in Finder where macOS kept the bundle where it was. */
function tellHere(outcome: BuildOutcome) {
  const finder = outcome.show;
  tell({ page: state.page, text: outcome.said, band: true, warn: !outcome.done, ...(finder ? { act: { label: 'Show in Finder', id: 'other-build-show', run: () => showFile(finder) } } : {}) });
}

/**
 * The one action a found build offers (Settings' row, the Overview's band): Remove where it is installed (taking over first
 * where it syncs this home), Quit where it only runs from somewhere else. `show`: where its result goes.
 */
export function buildAction(home: HomeView, found: OtherBuild, id: string, show: Show = tellHere): HTMLElement {
  const disabled = !!state.busy;
  if (!isInstalled(found)) return button({ variant: 'outline', size: 'small', label: `Quit ${found.name}`, id, disabled, onclick: () => void quitOtherBuild(found, show), attrs: { title: `Asks ${found.name} to quit. Nothing is removed.` } });
  const takeOver = syncsHere(home, found);
  return button({ variant: 'outline', size: 'small', label: `${takeOver ? 'Take over and remove' : 'Remove'} ${found.name}`, id, disabled: disabled || (takeOver && !home.sync.access.allowed),
    onclick: () => void removeOtherBuild(found, takeOver, show), attrs: { title: `${takeOver ? `Central Knot syncs this home from now on. ` : ''}${removeWords(found.name)}` } });
}

/** An id made from a build id or a path, for the page's elements. */
export const slug = (text: string) => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hiddenFlag = (build: string) => `ck-other-build-hidden-${build}`;

/**
 * The Overview's band for each other build found here that doesn't sync this home (one per build, its first bundle), until
 * hidden: Settings keeps its row while it is found.
 */
export function otherBuildBands(home: HomeView): HTMLElement[] {
  const shown = new Set<string>();
  return (home.otherBuilds ?? []).filter(found => !syncsHere(home, found) && !readFlag(hiddenFlag(found.build)) && !shown.has(found.build) && shown.add(found.build)).map(found => {
    const id = slug(found.build);
    const words = isInstalled(found) ? `${found.name} is installed here too, ${whereWords(found)}. Only one build of ${PRODUCT} syncs a home at a time. ${removeWords(found.name)}`
      : `${found.name} is ${whereWords(found)}. Only one build of ${PRODUCT} syncs a home at a time.${fromTrash(found)}`;
    return h('div.band.band-two', { role: 'status', id: `other-build-${id}` }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, words),
      h('span.band-actions', {}, buildAction(home, found, `other-build-action-${id}`)),
      closeButton(() => { writeFlag(hiddenFlag(found.build)); rerender(); }, { id: `other-build-hide-${id}`, label: 'Hide this note', title: `Hide this note. Settings still lists ${found.name} while it is here.` }));
  });
}

/**
 * Take over syncing, where another build syncs this home: one button as before, or, where that build is installed here, two
 * choices that each say what they do: take over and remove it, or take over and keep both (it stays installed, stopped
 * here). `said`: the sentence that goes with them. `ids`: the take-over button's and the remove choice's.
 */
export function takeOverChoices(home: HomeView, look: { variant: 'outline' | 'link'; size: 'small' | 'micro' }, ids: { take: string; remove: string }, disabled: boolean): { said: string; buttons: HTMLElement[] } {
  const owner = ownerOf(home)!;
  const bundle = home.otherBuilds?.filter(isInstalled).find(found => found.build === owner.build);
  const take = button({ ...look, label: bundle ? 'Take over, keep both' : 'Take over syncing', id: ids.take, disabled, onclick: () => void takeOverSync(),
    attrs: { title: `${takeOverTitle(owner)}${bundle ? ` ${owner.name} stays installed.` : ''}` } });
  if (!bundle) return { said: otherOwnerSaid(owner), buttons: [take] };
  const remove = button({ ...look, label: `Take over and remove ${owner.name}`, id: ids.remove, disabled, onclick: () => void removeOtherBuild(bundle, true),
    attrs: { title: `Central Knot syncs this home from now on. ${removeWords(owner.name)}` } });
  return { said: `${otherOwnerSaid(owner)} ${owner.name} is installed here too: remove it to the Trash as you take over, or keep both.`, buttons: [remove, take] };
}

/** Settings' line for a click's result, where its row may be gone with the build. */
export const rowMessage = (outcome: BuildOutcome) => {
  announce(outcome.said, true);
  const finder = outcome.show;
  return { text: outcome.said, tone: outcome.done ? 'done' as const : 'failure' as const, ...(finder ? { action: { label: 'Show in Finder', run: () => showFile(finder) } } : {}) };
};
