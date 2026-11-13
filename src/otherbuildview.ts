// Another build of Central Knot on this Mac, on the page: what the last look found (types.ts HomeView otherBuilds, from
// otherbuilds.ts in main), offered where it is decided. Where the build that syncs this home is installed here, Take over
// syncing becomes two choices (takeOverChoices, drawn by matrix.ts otherOwnerBand, pages.ts overviewPage and Settings' row);
// where another build is here and doesn't sync this home, the Overview has a band with Remove and Keep both (otherBuildBands)
// and Settings a row for each one found (settingspage.ts otherBuildsSection, in the words of buildHint and buildActions).
// Before any click the words say which app goes, which copies stay, and what else stays (removeWords). A click is
// removeOtherBuild or quitOtherBuild; its result is a band on the page it was made on (app.ts tell), or in Settings that
// section's line.
import { announce, busy, otherOwnerSaid, ownerSyncs, rerender, setHome, showFile, shownPath, state, takeOverSync, takeOverTitle, tell } from './app.ts';
import { button, closeButton, h, icon } from './dom.ts';
import { readFlag, writeFlag } from './flags.ts';
import { syncOwner } from './model.ts';
import type { BuildOutcome, HomeView, OtherBuild } from './types.ts';
import { PRODUCT } from './values.ts';

/** A found build with a bundle in an Applications folder: Remove can take it. */
type Installed = OtherBuild & { installed: string };
const isInstalled = (found: OtherBuild): found is Installed => !!found.installed;

/** Whether a found build is the one that syncs the open home: it is removed only by taking over first. */
export const syncsHere = (home: HomeView, found: OtherBuild) => syncOwner(home.sync.gate)?.build === found.build;

const folderOf = (bundle: string) => shownPath(bundle.slice(0, bundle.lastIndexOf('/')));
/** Where a found build is, as one clause: "in /Applications, and is running", or "running from ~/Downloads/…". */
const whereWords = (found: OtherBuild) => (found.installed ? `in ${folderOf(found.installed)}${found.running?.includes(found.installed) ? ', and is running' : ''}`
  : `running from ${(found.running ?? []).map(shownPath).join(' and ')}`);

/** What stays when a build is removed: said before the click, as the result says it after. */
const staysWords = (name: string) => `Your skills, MCP servers and agents, ${PRODUCT}’s record of them and History stay, and so does ${name}’s own settings folder.`;

/**
 * What Remove does, said before the click: which bundle goes to the Trash and that every running copy quits first, which other
 * copies stay (one running from somewhere else, another installed one), and what else stays.
 */
function removeWords(home: HomeView, found: Installed): string {
  const elsewhere = (found.running ?? []).filter(path => path !== found.installed);
  const others = (home.otherBuilds ?? []).flatMap(each => (each.build === found.build && each.installed && each.installed !== found.installed && !elsewhere.includes(each.installed) ? [each.installed] : []));
  return [
    `Removing quits every running copy of ${found.name}, then moves ${shownPath(found.installed)} to the Trash, where it stays until you empty the Trash.`,
    ...elsewhere.map(path => `The copy running from ${shownPath(path)} quits too, but stays where it is.`),
    ...others.map(path => `The copy at ${shownPath(path)} stays installed.`),
    staysWords(found.name),
  ].join(' ');
}

/** A build that runs from the Trash most likely started at sign-in, which only the system's own settings turn off. */
const fromTrash = (found: OtherBuild) => (found.running ?? []).some(path => path.includes('/.Trash/'))
  ? ` It runs from the Trash: if it starts at sign-in, turn that off in System Settings › General › Login Items.` : '';

/** Settings' row for a found build: what it is, where it is, that one build syncs a home at a time, and what its action does. */
export function buildHint(home: HomeView, found: OtherBuild): string {
  const one = `Only one build of ${PRODUCT} syncs a home at a time`, where = whereWords(found);
  if (!isInstalled(found)) return `${where.charAt(0).toUpperCase()}${where.slice(1)}, not from an Applications folder. ${one}. Quit asks it to quit; nothing is removed.${fromTrash(found)}`;
  const owner = syncOwner(home.sync.gate);
  const syncing = owner && syncsHere(home, found) ? `. ${found.name} ${ownerSyncs(owner)}, so removing it takes over syncing first` : '';
  return `Installed ${where}. ${one}${syncing}. ${removeWords(home, found)}`;
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
 * What a found build offers (Settings' row, the Overview's band): Remove where it is installed, or where it syncs this home
 * the two take-over choices; Quit where it only runs from somewhere else. `show`: where the result goes.
 */
export function buildActions(home: HomeView, found: OtherBuild, id: string, show: Show = tellHere): HTMLElement[] {
  const disabled = !!state.busy;
  if (!isInstalled(found)) return [button({ variant: 'outline', size: 'small', label: `Quit ${found.name}`, id, disabled, onclick: () => void quitOtherBuild(found, show), attrs: { title: `Asks ${found.name} to quit. Nothing is removed.` } })];
  if (syncsHere(home, found)) return takeOverChoices(home, { variant: 'outline', size: 'small' }, { take: `${id}-keep`, remove: id }, disabled || !home.sync.access.allowed, show).buttons;
  return [button({ variant: 'outline', size: 'small', label: `Remove ${found.name}`, id, disabled, onclick: () => void removeOtherBuild(found, false, show), attrs: { title: removeWords(home, found) } })];
}

/** An id made from a build id or a path, for the page's elements. */
export const slug = (text: string) => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hiddenFlag = (build: string) => `ck-other-build-hidden-${build}`;

/**
 * The Overview's band for each other build found here that doesn't sync this home (one per build, its first bundle): Remove,
 * and Keep both, which hides the band (the flag); Settings keeps its row while the build is found. A build only running from
 * somewhere else has Quit and a close button instead.
 */
export function otherBuildBands(home: HomeView): HTMLElement[] {
  const shown = new Set<string>();
  return (home.otherBuilds ?? []).filter(found => !syncsHere(home, found) && !readFlag(hiddenFlag(found.build)) && !shown.has(found.build) && shown.add(found.build)).map(found => {
    const id = slug(found.build), hide = () => { writeFlag(hiddenFlag(found.build)); rerender(); };
    const words = isInstalled(found) ? `${found.name} is installed here too, ${whereWords(found)}. Only one build of ${PRODUCT} syncs a home at a time. ${removeWords(home, found)}`
      : `${found.name} is ${whereWords(found)}. Only one build of ${PRODUCT} syncs a home at a time.${fromTrash(found)}`;
    const keep = isInstalled(found) ? button({ variant: 'outline', size: 'small', label: 'Keep both', id: `other-build-hide-${id}`, onclick: hide,
      attrs: { title: `Hides this note: both stay installed, and one syncs a home at a time. Settings still lists ${found.name}.` } }) : null;
    return h('div.band.band-two', { role: 'status', id: `other-build-${id}` }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, words),
      h('span.band-actions', {}, ...buildActions(home, found, `other-build-action-${id}`), keep),
      keep ? null : closeButton(hide, { id: `other-build-hide-${id}`, label: 'Hide this note', title: `Hide this note. Settings still lists ${found.name} while it is here.` }));
  });
}

/**
 * Take over syncing, where another build syncs this home: one button as before, or, where that build is installed here, two
 * choices that each say what they do: take over and remove it, or take over and keep both (it stays installed, stopped
 * here). `said`: the sentence that goes with them. `ids`: the take-over button's and the remove choice's. `show`: where a
 * removal's result goes.
 */
export function takeOverChoices(home: HomeView, look: { variant: 'outline' | 'link'; size: 'small' | 'micro' }, ids: { take: string; remove: string }, disabled: boolean, show: Show = tellHere): { said: string; buttons: HTMLElement[] } {
  const owner = syncOwner(home.sync.gate)!;
  const bundle = home.otherBuilds?.filter(isInstalled).find(found => found.build === owner.build);
  const take = button({ ...look, label: bundle ? 'Take over, keep both' : 'Take over syncing', id: ids.take, disabled, onclick: () => void takeOverSync(),
    attrs: { title: `${takeOverTitle(owner)}${bundle ? ` ${owner.name} stays installed.` : ''}` } });
  if (!bundle) return { said: otherOwnerSaid(owner), buttons: [take] };
  const remove = button({ ...look, label: `Take over and remove ${owner.name}`, id: ids.remove, disabled, onclick: () => void removeOtherBuild(bundle, true, show),
    attrs: { title: `Central Knot syncs this home from now on. ${removeWords(home, bundle)}` } });
  return { said: `${otherOwnerSaid(owner)} ${owner.name} is installed here too: take over and remove it, or take over and keep both. ${removeWords(home, bundle)}`, buttons: [remove, take] };
}

/** Settings' line for a click's result, where its row may be gone with the build. */
export const rowMessage = (outcome: BuildOutcome) => {
  announce(outcome.said, true);
  const finder = outcome.show;
  return { text: outcome.said, tone: outcome.done ? 'done' as const : 'failure' as const, ...(finder ? { action: { label: 'Show in Finder', run: () => showFile(finder) } } : {}) };
};
