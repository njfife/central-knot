// The page's entry: the window's frame around the page (the sidebar, the header, the status bar and the Sync switch), which page
// draws (renderPage: while another build holds this one, the held screen of otherbuildview.ts instead of every page, with the
// sidebar's update control kept), and drawing again on a change. On a list page the last result and the sync notices are in the
// header's own 48px, each whole only in the card that hangs from it (resultHere says the rule). A redraw keeps what is selected, the scroll places and the
// focus (render), Back and Forward put back a visit's scroll places (places.ts), and a press on a control it replaces still counts
// (dom.ts keepClicksAcrossRedraws). A redraw replaces a text field, its Undo and an input method's word in progress with it, so the
// result's time to go with nothing to clear (app.ts fadeNow) and a Git repo read that brings what is shown (repopage.ts loadRepo)
// draw nothing, and the window's focus draws again except while an editor's text area has it (its listener, below). The page's
// state and actions are app.ts's; each page is drawn by its own module (pages.ts and the *page.ts modules, matrix.ts for the item tables).
import { settingsPage } from './settingspage.ts';
import packageInfo from '../package.json' with { type: 'json' };
import { absentKinds, acting, drawPage, keepingFocus, noToolManaged, noToolManagedSentence, loadHome, paintStatusMessage, readAgain, realHomeName, startHome, rerender, setRenderer, setSync, showPage, state, type Page } from './app.ts';
import { afterLayout, button, closeInfoCard, fitBars, h, icon, keepClicksAcrossRedraws, keepSelection, runAfterLayout, syncInfoCard, whyOff } from './dom.ts';
import { afterPageDrawn } from './selection.ts';
import type { IconName } from './icons.ts';
import { heldKinds, type HomeKind } from './presence.ts';
import { kindNouns, pageNames } from './words.ts';
import { rowCount } from './pluginrows.ts';
import { libraryPage, notRead } from './pages.ts';
import { overviewPage } from './overview.ts';
import { harnessesPage, harnessTitle } from './harnesspage.ts';
import { pluginsPage, pluginsResult } from './pluginspage.ts';
import { pluginsResultPlace } from './pluginstate.ts';
import { afterPluginPageDrawn } from './pluginpage.ts';
import { backFromFiles, headerNotices, listResult, noticeKindsShown, resultInHeader, unseenNotices } from './matrix.ts';
import { historyPage } from './historypage.ts';
import { mcpSigninPage } from './mcpsigninpage.ts';
import { sessionsPage } from './sessionspage.ts';
import { instructionsPage } from './instructionspage.ts';
import { repo, repoPage, waitingCounts, waitingWords } from './repopage.ts';
import { sources, sourcesPage } from './sourcespage.ts';
import { profilesPage, profileStatus } from './profilespage.ts';
import type { HomeMode, HomeView, SyncNotice, SyncView } from './types.ts';
import { noticeNames, plural } from './model.ts';
import { anyOn } from './itemrow.ts';
import { followUpdates, sidebarEnd, statusEnd } from './updateview.ts';
import { followPluginUpdates } from './pluginupdateview.ts';
import { forgetHeldResult, heldBy, heldScreen } from './otherbuildview.ts';
import { fullPlace, listenForTravel, offsetsNow, putBack, recordDraw, restoring } from './places.ts';
import { placeKey } from './visits.ts';

const region = (id: string) => document.getElementById(id)!;
/** Each page's title, in the header and the sidebar: Instructions' and the plugins' page by their kind's title (words.ts kindNouns). */
const titles: Record<Page, string> = { overview: 'Overview', library: 'Library', mcpsignin: 'MCP sign-in', instructions: kindNouns.instructions.title, plugins: kindNouns.plugins.title, profiles: 'Profiles', history: 'History', sessions: 'Sessions', sources: pageNames.sources, repo: 'Git repo', harnesses: 'Harnesses', settings: 'Settings' };
/** Below this window width the sidebar folds to its icon rail, unless the person chose a shape with the toggle. */
const RAIL_BELOW = 968;
/** From this content width (laptop full screen and up), an open row's details dock beside its table instead of under the row. */
const DOCK_FROM = 1200;

/**
 * The window decides the frame: the sidebar or its rail, and whether the content is wide enough to dock details (state.wide).
 * Inside the content area, style.css adapts to the content's own width (narrow tables, stacked two-pane pages) and
 * fitBars shortens a bar only when it overflows, so a resize redraws only when one of these two changes.
 */
function applyLayout(): { rail: boolean; wide: boolean } {
  const rail = state.sidebar ? state.sidebar === 'rail' : window.innerWidth < RAIL_BELOW;
  document.body.classList.toggle('rail', rail);
  const wide = document.getElementById('main')!.clientWidth >= DOCK_FROM;
  state.wide = wide;
  return { rail, wide };
}

/** A page's row: its name, how many it holds, and a dot while a change sync made on its own is unseen. `countTitle` says the
 * count in words (the tooltip and screen readers); `quiet` greys it (the Git repo's counts while unreachable). */
function navRow(page: Page, label: string, glyph: IconName, count?: number | string, countTitle?: string, quiet = false) {
  const current = state.page === page, news = unseen(page);
  return h('button.nav-row', {
    type: 'button', id: `nav-${page}`, 'aria-current': current ? 'page' : undefined, 'aria-label': countTitle ? `${label}: ${countTitle}` : label, title: label,
    onclick: () => showPage(page),
  }, icon(glyph), h('span.nav-label', {}, label), count !== undefined && h(`span.nav-count${count === 0 || quiet ? '.nav-count-zero' : ''}`, { 'aria-hidden': 'true', title: countTitle }, String(count)),
    // A change sync made on its own shows as a dot on its page until that notice is seen (matrix.ts noticeUnseen).
    news.length ? h('span.nav-unseen', { title: unseenText(news) }) : null);
}

const anythingOn = () => !!state.home && anyOn(state.home);
/** The Library's automatic changes not seen yet (matrix.ts unseenNotices); on the open Library, of the kinds whose notices the header doesn't show (its Notices control marks those). */
const unseen = (page: Page) => {
  if (!state.home || page !== 'library') return [];
  const told = state.page === 'library' ? noticeKindsShown() : [];
  return heldKinds(state.home).filter(kind => !told.includes(kind)).flatMap(unseenNotices);
};
/** The dot's tooltip: how many changes it counts, and the first three names. */
const unseenText = (list: SyncNotice[]) => `${list.length} automatic ${list.length === 1 ? 'change' : 'changes'}: ${list.flatMap(noticeNames).slice(0, 3).join(', ')}`;

const homeHelp: Record<HomeMode, string> = {
  fixture: 'Practice copy: sample skills, MCP servers and agents in a throwaway folder. Nothing here touches your real tools.',
  custom: 'Another folder: a home folder that contains .claude, .copilot or .codex, such as a backup or another account. Central Knot writes only inside it.',
  actual: `${realHomeName}: your real tools. Changes you apply here write to their folders.`,
};

function homeRow(mode: HomeMode, label: string, glyph: IconName) {
  const current = state.home?.mode === mode;
  // A chosen folder shows its own name; choosing again picks another.
  const shown = mode === 'custom' && current && state.home ? `${state.home.home.split('/').filter(Boolean).pop() ?? 'Folder'} (folder)` : label;
  return h('button.home-row', {
    type: 'button', id: `home-${mode}`, 'data-home': mode, 'aria-current': current ? 'true' : undefined, 'aria-label': `Home: ${shown}`, title: mode === 'custom' && current ? `Home: ${state.home!.home}\nClick to choose another folder.` : `Home: ${homeHelp[mode]}`,
    disabled: !!acting(), ...whyOff(acting()), onclick: () => void loadHome(mode),
  }, icon(glyph, 14), h('span.nav-label.home-label', {}, h('span', {}, shown), h('span.home-sub', {}, { fixture: 'sample data, safe to try', actual: 'your real tools', custom: mode === 'custom' && current ? 'click to choose another' : 'a backup or another account' }[mode])));
}

/** Changes waiting to be pulled or pushed, once a repo is connected: a git client's count, shown only when there is one. */
function repoRow() {
  const view = repo.view;
  if (!view?.connected) return navRow('repo', 'Git repo', 'git-branch');
  const counts = waitingCounts(view);
  const { pull, push, retry } = counts;
  // A newer commit that changes nothing here still waits to be pulled: a bare arrow.
  const newer = !pull && !retry && !!view.pushBlocked;
  // Directions, not an item count: ↓ to pull (or pull again), ↑ to push.
  const shown = [pull + retry ? `↓${pull + retry}` : newer ? '↓' : '', push ? `↑${push}` : ''].filter(Boolean).join(' ');
  const blocked = view.held ? 'Pull and Push are held' : view.problem ? 'Couldn’t reach the repo' : '';
  const words = waitingWords(counts);
  const said = [blocked, words.pull, words.retry, newer ? 'A newer commit to pull' : '', words.push].filter(Boolean).join(' · ');
  // While the repo can't be reached or is held, the counts are last seen: quiet, as on the page.
  return navRow('repo', 'Git repo', 'git-branch', shown || undefined, said || undefined, !!blocked);
}

function renderSidebar() {
  const home = state.home;
  // Held: no page and no other home to go to, only the update control.
  if (heldBy(home)) { region('nav').replaceChildren(); region('homes').replaceChildren(); region('sidebar-end').replaceChildren(...sidebarEnd()); return; }
  // A kind no tool here can hold has no row (app.ts absentKinds).
  const absent = absentKinds();
  const row = (page: Extract<HomeKind, Page>, glyph: IconName) => (absent.includes(page) ? null : navRow(page, titles[page], glyph));
  // The Library's total: every row of the kinds a tool here can hold, a plugin's items included, whatever its filters say.
  const held = home ? heldKinds(home) : [];
  region('nav').replaceChildren(...[
    navRow('overview', titles.overview, 'layout-grid'),
    navRow('harnesses', titles.harnesses, 'boxes'),
    home && !held.length ? null : navRow('library', titles.library, 'layers', home ? held.reduce((sum, kind) => sum + rowCount(home, kind), 0) : undefined),
    // Each MCP server's sign-in in each tool, as the tools' own commands say it, where a tool here can hold MCP servers.
    absent.includes('mcp') ? null : navRow('mcpsignin', titles.mcpsignin, 'plug'),
    row('instructions', 'pencil-line'),
    row('plugins', 'puzzle'),
    // Where items come from, beside the plugins' page: how many links are added, once there is one.
    navRow('sources', titles.sources, 'link-2', sources.view?.sources.length || undefined, sources.view?.sources.length ? plural(sources.view.sources.length, 'source') : undefined),
    // Profiles switch skills and MCP servers, so like the kinds' rows it needs a tool to switch them in.
    !noToolManaged() ? navRow('profiles', titles.profiles, 'sliders-horizontal') : null,
    !noToolManaged() ? h('div.nav-divider', { role: 'separator' }) : null,
    navRow('history', titles.history, 'history'),
    // Each day's sessions and what their tokens would cost, read from the tools' own history (sessionspage.ts).
    navRow('sessions', titles.sessions, 'clock'),
    repoRow(),
    navRow('settings', titles.settings, 'settings'),
  ].filter((entry): entry is HTMLElement => !!entry));
  // The homes: the Practice copy where this build offers it (dev builds and tests; a released build doesn't), then this
  // computer's home, then a folder.
  region('homes').replaceChildren(...[
    h('p.homes-title', {}, 'Home'),
    state.home?.practice ? homeRow('fixture', 'Practice copy', 'flask-conical') : null,
    homeRow('actual', realHomeName, 'laptop'),
    homeRow('custom', 'Another folder…', 'folder-open'),
  ].filter((row): row is HTMLElement => !!row));
  // Its end, at the bottom left: the update control (updateview.ts), where there are releases.
  region('sidebar-end').replaceChildren(...sidebarEnd());
}

function renderHeader(rail: boolean) {
  const { items, drawer } = resultHere();
  const header = region('header');
  header.replaceChildren(
    button({
      variant: 'ghost', icon: 'panel-left', name: rail ? 'Expand the sidebar' : 'Collapse the sidebar', id: 'sidebar-toggle',
      onclick: () => { state.sidebar = rail ? 'open' : 'rail'; rerender(); },
    }),
    h('h1.page-title', {}, heldBy(state.home) ? 'One build at a time' : (state.page === 'harnesses' && harnessTitle()) || titles[state.page]),
    ...items,
    // The same Refresh on every page: it reads the home again, then the page's own data (on Plugins, every marketplace).
    h('div.header-end', {}, button({ icon: 'refresh-cw', label: 'Refresh', name: state.page === 'plugins' ? 'Read this home and every marketplace again, and put the rows back in order' : 'Read this home again, and put the rows back in order', id: 'header-refresh', disabled: acting() ?? !state.home,
      onclick: () => void readAgain() })),
  );
  if (header.nextElementSibling?.classList.contains('result-drawer')) header.nextElementSibling.remove();
  if (drawer) header.after(drawer);
}

function renderPage() {
  document.body.classList.toggle('page-harnesses', state.page === 'harnesses');
  const held = heldBy(state.home);
  if (held) { region('page').replaceChildren(heldScreen(state.home!, held)); return; }
  forgetHeldResult();
  region('page').replaceChildren(state.page === 'overview' ? overviewPage() : state.page === 'library' ? libraryPage() : state.page === 'mcpsignin' ? mcpSigninPage() : state.page === 'plugins' ? pluginsPage() : state.page === 'profiles' ? profilesPage() : state.page === 'history' ? historyPage() : state.page === 'sessions' ? (state.home ? sessionsPage(state.home) : notRead()) : state.page === 'repo' ? repoPage() : state.page === 'sources' ? sourcesPage() : state.page === 'instructions' ? instructionsPage() : state.page === 'settings' ? settingsPage() : harnessesPage());
}

/** What the home lets Central Knot write, said in the status bar; `short` stands in when the bar is narrow (style.css). */
function writeFact(sync: SyncView): { glyph: IconName; text: string; short?: string; tone: string } {
  if (heldBy(state.home)) return { glyph: 'lock', text: 'Paused: another build is here', short: 'Paused', tone: 'tone-warning' };
  if (sync.gate.state === 'stopped') return { glyph: 'circle-alert', text: 'Writing is stopped', tone: 'tone-danger' };
  if (!sync.access.allowed) return { glyph: 'lock', text: 'Preview only', tone: '' };
  if (state.home?.mode === 'actual') return { glyph: 'pencil-line', text: 'Writes to your real tools', short: 'Real tools', tone: '' };
  if (state.home?.mode === 'fixture') return { glyph: 'pencil-line', text: 'Changes stay here', short: 'Stays here', tone: '' };
  return { glyph: 'pencil-line', text: 'Changes write only inside this folder', short: 'Writes here only', tone: '' };
}

/**
 * The Automatic sync switch, the same one the menus carry. A preview-only home keeps it, disabled and grey, so it is
 * recognisably the same setting. With sync on and nothing synced yet it reads "On · nothing synced"; its tooltip says
 * sync starts once something is.
 */
function syncSwitch(home: HomeView) {
  // A narrow status bar calls it "Sync" (style.css): the switch and its state keep their words, and the tooltip names it whole.
  const label = h('span.sync-label', {}, h('span.fact-long', {}, 'Automatic sync'), h('span.fact-short', {}, 'Sync'));
  // With no tool managed there is nothing to sync: the switch is shown, not offered.
  if (!home.sync.managed.length) {
    return h('span.status-item.sync-switch.sync-paused', { id: 'sync-switch', role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', title: `${noToolManagedSentence(home)} So there is nothing to sync.` },
      label, h('span.sync-track.idle', { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, 'Nothing to sync'));
  }
  if (!home.sync.access.allowed) {
    return h('span.status-item.sync-switch.sync-paused', { id: 'sync-switch', role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', title: home.sync.access.reason ?? 'Preview only: nothing is written here' },
      label, h('span.sync-track.idle', { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, 'Paused'));
  }
  const idle = home.syncOn && !anythingOn();
  const title = idle ? `Automatic sync is on: it starts once ${home.sync.syncEverything ? 'something turns up in one of your tools (Synchronize everything takes it in)' : 'you turn something on'}. Click to turn it off.`
    : home.syncOn ? 'Automatic sync is on: an edit to a managed item spreads to the other tools on its own, even with this window closed. Click to turn it off.'
    : 'Automatic sync is off: edits wait until you turn it on or use Sync once. Click to turn it on.';
  return h('button.status-item.sync-switch', { type: 'button', id: 'sync-switch', role: 'switch', 'aria-checked': String(home.syncOn), 'aria-label': 'Automatic sync', disabled: !!acting(), title, onclick: () => void setSync(!home.syncOn) },
    label, h(`span.sync-track${home.syncOn ? '.on' : ''}${idle ? '.idle' : ''}`, { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, !home.syncOn ? 'Off' : idle ? 'On · nothing synced' : 'On'));
}

function renderStatus() {
  const home = state.home;
  const write = home && writeFact(home.sync);
  region('status-facts').replaceChildren(
    home
      ? h('span.status-item.status-home', { title: home.home }, icon(home.mode === 'fixture' ? 'flask-conical' : home.mode === 'actual' ? 'laptop' : 'folder-open', 14), h('span', {}, h('span', { id: 'home-label' }, home.label)))
      : h('span.status-item.status-home', {}, icon('eye', 14), state.busy ? 'Reading…' : 'No home read'),
    write ? h(`span.status-item${write.tone ? `.${write.tone}` : ''}`, { title: write.text }, icon(write.glyph, 14),
      h('span.status-clip.fact-long', {}, write.text), write.short ? h('span.status-clip.fact-short', {}, write.short) : null) : '',
    // The profile in use is always in sight, after the home and where it writes, and one click away from switching.
    (!heldBy(home) && profileStatus()) || '',
    home ? syncSwitch(home) : '',
  );
  region('status-end').replaceChildren(...statusEnd(packageInfo.version));
  paintStatusMessage();
}

/**
 * The header's rule on a list page: what a click did (its result: matrix.ts resultInHeader) and what sync changed by itself (the
 * sync notices: matrix.ts headerNotices) live in the header's own 48px, so neither lies over anything by itself nor moves anything
 * under it, whatever arrives. Its two lines hold the result while there is one on show, however long it stays: with problem lines,
 * its sentence then the first of them, each on one line; without, its sentence in two (style.css .header-result); either cut where
 * it runs past them, with Show all (matrix.ts wholeToggle). With no result, they hold the newest notice, said as an automatic change,
 * its sentence cut where it runs past them, with its × (style.css .header-notice). Beside them, the Notices control counts the
 * notices, marked and filled while one is unseen; a notice arriving while a result is on show is told there alone, the result keeping the
 * lines until it fades, is closed or a newer result takes its place. A card hangs from the header over the page, one at a time
 * (state.shownWhole says which): the result whole, from Show all, or every notice, from Notices or the notice in the lines
 * (matrix.ts noticesCard). A card closes like a menu: on Show less or Notices again, its ×, Escape, or a press that begins outside
 * it (foldResult), and keeps its scroll through a redraw by its id (scrolledNow). A newer result shows folded; a card whose result
 * or notices are no longer drawn, or whose place is left, goes, so none opens again by itself.
 */
function resultHere() {
  let parts: HTMLElement[] = [];
  if (state.home && !heldBy(state.home) && resultInHeader()) {
    const place = pluginsResultPlace();
    parts = place ? pluginsResult() : listResult();
    // On a tool's Plugins tab, fall back to listResult() when no plugin result belongs here (e.g. a carried home-switch outcome).
    if (!parts.length && place && place !== 'plugins') parts = listResult();
  }
  const whole = parts.some(part => part.querySelector('#problems-show-all[aria-expanded="true"]'));
  const notices = state.home && !heldBy(state.home) ? headerNotices(parts.length > 0) : undefined;
  if (!whole && !notices?.card) { state.shownWhole = undefined; state.wholeDrawer = false; }
  const drawerPart = whole && state.wholeDrawer && !notices?.card ? parts.find(part => part.classList.contains('reload-list')) : undefined;
  const headerParts = drawerPart ? parts.filter(part => part !== drawerPart) : parts;
  const cardWhole = whole && !drawerPart;
  const result = headerParts.length ? h(`div.header-result${cardWhole ? '.result-whole' : ''}`, { id: cardWhole ? 'result-whole' : undefined }, headerParts) : null;
  const drawer = drawerPart ? h('div.result-drawer', { id: 'result-whole', role: 'region', 'aria-label': 'Reload steps' }, drawerPart) : null;
  return { items: [notices?.card ? notices.lines : result ?? notices?.lines, notices?.control].filter((part): part is HTMLElement => !!part), drawer };
}
/**
 * Folds the card on screen into the header's two lines, answering whether there was one. The redraw waits, so a click that folds it
 * still does its own work. The notices' card folded from within (a notice's way off the page, Escape) gives the focus back to Notices.
 */
function foldResult(fromWithin = false): boolean {
  const card = document.querySelector('#header .result-whole, .result-drawer');
  if (!card) return false;
  state.shownWhole = undefined;
  state.wholeDrawer = false;
  if (fromWithin && card.id === 'notices-card') document.getElementById('notices')?.focus({ preventScroll: true });
  setTimeout(rerender);
  return true;
}
// A press that began in the card and is let go outside it (a selection dragged out) is no press outside: the card stays. A
// click from the keyboard (detail 0) has no press. In the notices' card, a notice's way off the page (History, its name's link to
// its row) closes it; every other action stays on this page and keeps it. The second click of a double click begun there, or on the
// notice in the lines, which opens the card, does nothing, wherever it lands: the first may have put something else under it (the
// card's top line, or a notice done leaving the list, which grows shorter).
const inCard = (event: Event) => !!(event.target as Element).closest('#header :is(.header-result, .notices-card), .result-drawer');
const leavesCard = (event: Event) => !!(event.target as Element).closest('#notices-card :is([id^="notice-history-"], [id^="notice-open-"])');
let pressedInCard = false, clickedInNotices = false;
document.addEventListener('pointerdown', event => { pressedInCard = inCard(event); }, true);
document.addEventListener('click', event => {
  if (event.detail > 1 && clickedInNotices) { event.stopImmediatePropagation(); event.preventDefault(); return; }
  clickedInNotices = !!(event.target as Element).closest('#notices-card, #header .header-notice');
  if (leavesCard(event)) foldResult(true); else if (!(event.detail && pressedInCard) && !inCard(event)) foldResult();
}, true);
// Escape closes any open info card first, else folds a header card, and does nothing else before any other Escape is heard:
// a find box, or a search field's own clearing, keeps its words.
window.addEventListener('keydown', event => { if (event.key === 'Escape' && (closeInfoCard() || foldResult(true))) { event.stopPropagation(); event.preventDefault(); } }, true);
// Coming back to the window draws it again (a notice drawn while it had no focus is seen now: matrix.ts markSeen; the words of time
// come up to date), except while an editor's text area has the focus: drawn again, it would lose its Undo, and its page draws no notices.
window.addEventListener('focus', () => { if (!document.activeElement?.matches('textarea.ins-text')) rerender(); });

// Laid out, and at each resize: fit reload chips on Row 2 (+N more on overflow) and show Show all on cut or hidden advice.
const cut = (text: Element) => text.scrollWidth > text.clientWidth || text.scrollHeight > text.clientHeight;
function fitReloadChips(header: HTMLElement): boolean {
  const strip = header.querySelector<HTMLElement>('.header-result:not(.result-whole) .result-reloads');
  if (!strip) return false;
  const chips = [...strip.querySelectorAll<HTMLElement>('.result-copies > *')], more = strip.querySelector<HTMLElement>('#outcome-reload-more');
  for (const chip of chips) chip.hidden = false;
  if (more) more.hidden = true;
  if (strip.scrollWidth <= strip.clientWidth + 1) return false;
  for (let hidden = 1; hidden <= chips.length; hidden++) {
    chips[chips.length - hidden]!.hidden = true;
    if (more) { more.textContent = `+${hidden} more`; more.hidden = false; }
    if (strip.scrollWidth <= strip.clientWidth + 1) return true;
  }
  return chips.length > 0;
}
afterLayout(() => {
  const header = region('header'), more = header.querySelector<HTMLElement>('[data-when-cut]');
  const textCut = more ? (more.hidden = true, [...header.querySelectorAll('.problem-text, .problem-text > *, .band-done > .band-text, .toolbar-result-text, .band-profile-name')].some(cut)) : false;
  if (more) {
    more.hidden = !textCut;
    delete more.dataset.adviceOnly;
    if (!fitReloadChips(header) && !textCut && more.hasAttribute('data-has-advice')) {
      if (more.dataset.adviceLabel) { more.textContent = more.dataset.adviceLabel; more.dataset.adviceOnly = ''; }
      more.hidden = false;
      fitReloadChips(header);
      if ([...header.querySelectorAll('.band-done > .band-text, .toolbar-result-text')].some(cut)) { more.textContent = 'Show all'; delete more.dataset.adviceOnly; }
    }
  } else fitReloadChips(header);
});

/** The whole window drawn again, the focus kept on the control that had it (app.ts keepingFocus). */
function render() {
  if (!restoring) keepingFocus(renderWindow);
}

/**
 * The redraw's one rule for scroll places: every element with an id that is scrolled, either way, as the redraw begins (a page's
 * scroll area, a box inside it, the result's card, a text field) is put back where it was when the redraw draws that id again,
 * a text field only when it holds the same text. A box's id names what it shows (an item's copies, a version, a plugin's file, a
 * README as drawn), so other content starts at its top. Back and Forward keep a rule of their own (places.ts), as a visit's place
 * is stored and outlives moves, while a box's lasts only while its content is drawn.
 */
const scrolledNow = () => [...document.querySelectorAll<HTMLElement>('[id]')].filter(node => node.scrollTop || node.scrollLeft)
  .map(node => ({ id: node.id, top: node.scrollTop, left: node.scrollLeft, text: fieldText(node) }));
const fieldText = (node: Element) => (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.value : undefined);

function renderWindow() {
  const visitOffsets = offsetsNow(), kept = scrolledNow();
  const selected = keepSelection();
  const { rail } = applyLayout();
  renderHeader(rail);
  drawPage(renderPage);
  // Select's mode and a plugin page's folds live only while their own page is drawn: a draw without them ends them.
  afterPageDrawn();
  afterPluginPageDrawn();
  // After the header, which marks the notices it draws seen: the sidebar's dot is for those it didn't.
  renderSidebar();
  recordDraw(visitOffsets);
  // What depends on the drawn widths (columns, wrapped lines) is decided now, before the page is painted (dom.ts afterLayout).
  runAfterLayout();
  renderStatus();
  fitBars();
  // What was selected, then the scroll places, each where it was (scrolledNow), and over them the place of a visit Back or Forward
  // opened (places.ts putBack); keepingFocus puts the focus back after, without scrolling to it (dom.ts keepSelection neither
  // focuses nor scrolls).
  selected();
  for (const { id, top, left, text } of kept) {
    const node = document.getElementById(id);
    if (node && fieldText(node) === text) Object.assign(node, { scrollTop: top, scrollLeft: left });
  }
  putBack();
  syncInfoCard(true);
  if (state.home) document.body.dataset.ready = 'true';
}

setRenderer(render);
listenForTravel();
keepClicksAcrossRedraws(() => JSON.stringify([state.home?.home, placeKey(fullPlace())]));
// The status bar's mark for a message too narrow to show (app.ts paintStatusMessage): drawn once.
region('message-mark').replaceChildren(icon('info', 14));

// The width a scroll area's scrollbar takes (0 for overlay scrollbars): padded scroll areas give it back from their
// right padding (style.css --scrollbar), so their content ends where the header's and the tables' do.
const probe = h('div.scroll', {});
document.body.append(probe);
document.documentElement.style.setProperty('--scrollbar', `${probe.offsetWidth - probe.clientWidth}px`);
probe.remove();

let narrowWindow = window.innerWidth < RAIL_BELOW;
window.addEventListener('resize', () => {
  // A toggled shape holds at the size it was chosen; crossing the breakpoint hands the choice back to the window.
  if ((window.innerWidth < RAIL_BELOW) !== narrowWindow) { narrowWindow = !narrowWindow; state.sidebar = undefined; }
  const before = { rail: document.body.classList.contains('rail'), wide: state.wide };
  const { rail, wide } = applyLayout();
  if (rail !== before.rail || wide !== before.wide) render();
});

// Bars refit whenever the content area changes width (a resize, the sidebar's shape) and once the fonts have loaded.
new ResizeObserver(() => { fitBars(); runAfterLayout(); }).observe(document.getElementById('main')!);
void document.fonts.ready.then(() => { fitBars(); runAfterLayout(); });

document.addEventListener('keydown', event => {
  const typing = event.target instanceof HTMLInputElement && event.target.type === 'text';
  if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
    const find = document.getElementById('find') ?? document.getElementById('skills-find');
    if (find) { event.preventDefault(); find.focus(); }
  }
  // Escape leaves the Files and contents view for the table, except in a text box, where it clears the box (matrix.ts); with a
  // card open it only folds it (foldResult, above).
  if (event.key === 'Escape' && !typing && state.page === 'library' && state.libraryView === 'files') backFromFiles();
});

// Updates are followed once the home is open, so what the opening said doesn't cover "now on the new version".
void startHome().then(() => { followUpdates(); followPluginUpdates(); });
