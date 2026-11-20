// Back and Forward in this window: the destination drawn, its visits, the existing page actions that reopen it, and each visit's
// scroll place, put back once Back or Forward has drawn it. renderer.ts copies each scrolling area's offset by its id across every
// draw, to whichever page draws that id next, moves included; a move to a page that starts at its top resets the area itself
// (pluginstate.ts browse, harnesspage.ts goHarness, app.ts selectItem).
// app.ts placeNow is narrower: it names the table where an action's result belongs.
import { absentKinds, filesSkillAvailable, harnessManaged, harnessTabShown, leaveFiles, takeMove, machine, noToolManaged, rerender, showPage, state } from './app.ts';
import { goHarness } from './harnesspage.ts';
import { openFiles } from './matrix.ts';
import { heldBy } from './otherbuildview.ts';
import { heldKinds } from './presence.ts';
import { browse, current, listedMarket, market } from './pluginstate.ts';
import { emptyVisits, placeKey, recordPlace, travel, type Place } from './visits.ts';

/**
 * The place drawn: the page; under Harnesses the tool and its tab; on the plugins' page the marketplace, its tab and a plugin's
 * page; on the Library a skill's Files view. The Library's kind switch is not part of a place: changing the segment is no visit.
 */
export function fullPlace(): Place {
  const { page, harness, libraryView, item } = state;
  const tab = harnessTabShown();
  if (tab) return { page, tool: harness, tab };
  if (page === 'plugins') {
    const { source, marketName, tab, plugin } = market.nav;
    const entry = marketName ? undefined : current()?.entry;
    if (entry || marketName || !market.view) return { page, source: entry?.source ?? source, marketName, marketTab: plugin ? 'plugins' : tab, plugin };
  }
  if (page === 'library' && libraryView === 'files' && state.home && item && filesSkillAvailable(state.home, item)) return { page, skill: item };
  return { page };
}

let visits = emptyVisits(), home: string | undefined;
export let restoring = false;
/** The scroll place on screen as this turn's first draw began: a move this turn leaves it with the visit it leaves. */
let leaving: Offsets | undefined;
/**
 * Each draw: the place drawn, recorded at the end of the turn (a link can draw twice in one click) as a new visit after a move,
 * as Back to the visit before after a page's own Back control (stepsBackTo), else as a repair of this one. `scrolled`: the draw's
 * offsets as it began.
 */
export function recordDraw(scrolled: Offsets) {
  if (!state.home) return;
  if (home !== state.home.home) { visits = emptyVisits(); home = state.home.home; puttingBack = undefined; }
  const onScreen = placeOnScreen(scrolled);
  if (leaving) return;
  leaving = onScreen;
  queueMicrotask(() => {
    const moved = takeMove(), from = visits.entries[visits.cursor], left = leaving!;
    leaving = undefined;
    if (heldBy(state.home)) return;
    const place = fullPlace(), back = moved === 'back' ? stepsBackTo(place) : 0;
    visits = back ? travel(visits, back, available) : recordPlace(visits, place, !!moved);
    if (!moved || !from || visits.entries[visits.cursor] === from) return;
    leftAt.set(from, left);
    putBackPlaceOf(back ? visits.entries[visits.cursor] : undefined);
    putBack();
  });
}

/** Each scrolling area's offset, by its id: the areas a redraw keeps where they were (`.scroll[id]`, renderer.ts renderWindow). */
export type Offsets = Map<string, number>;
export const offsetsNow = (): Offsets => new Map([...document.querySelectorAll<HTMLElement>('.scroll[id]')].map(node => [node.id, node.scrollTop]));
/** Each visit's scroll place as the person left it, by its entry: an entry the list drops takes its place with it. */
const leftAt = new WeakMap<Place, Offsets>();
/**
 * The visit Back or Forward opened, while its place is put back after each draw: the offsets `wanted`, and where the last draw left
 * each area (`drawn`: as far as it went, while its page was still filling). Let go on a move (recordDraw), and area by area once
 * something else (the person, a glide) moves one (placeOnScreen, at each draw and each Back or Forward).
 */
let puttingBack: { visit: Place; wanted: Offsets; drawn: Offsets } | undefined;

/** Puts back the place `visit` was left at, after each draw from now until it is let go (putBack); with none, lets go. */
const putBackPlaceOf = (visit?: Place) => { puttingBack = visit && { visit, wanted: new Map(leftAt.get(visit)), drawn: new Map() }; };

/**
 * Lets go of each area being put back that something else moved since the last draw (its offset `now` is not where putBack left
 * it), then gives the scroll place on screen: the offsets `now`, an area still being put back at the offset wanted.
 */
function placeOnScreen(now: Offsets): Offsets {
  if (!puttingBack) return now;
  const { wanted, drawn } = puttingBack;
  for (const [id, top] of drawn) if (now.has(id) && now.get(id) !== top) { wanted.delete(id); drawn.delete(id); }
  return new Map([...now, ...wanted]);
}

/** After a draw, over the offsets it kept: the visit Back or Forward opened, each area at its offset, or as far as it goes yet. */
export function putBack() {
  if (!puttingBack || placeKey(fullPlace()) !== placeKey(puttingBack.visit)) return;
  for (const [id, top] of puttingBack.wanted) {
    const node = document.getElementById(id);
    if (node) { node.scrollTop = top; puttingBack.drawn.set(id, node.scrollTop); }
  }
}

function available(p: Place): Place {
  const home = state.home!;
  // A page no tool here holds (the Library with no kind held, the plugins' page with no tool that takes plugins), or Profiles with no tool managed.
  const gone = p.page === 'library' ? !heldKinds(home).length : absentKinds().some(kind => kind === p.page);
  if (gone || (p.page === 'profiles' && noToolManaged())) return { page: 'overview' };
  if (p.tool && !harnessManaged(home, p.tool)) return { page: p.page };
  if (p.skill && !filesSkillAvailable(home, p.skill)) return { page: p.page };
  if (p.page === 'plugins' && market.view) {
    if (p.marketName && market.read.state !== 'ready') return p; // Let the fresh catalog resolve the link.
    const entry = listedMarket(p);
    if (!entry || (p.plugin && !entry.plugins.some(each => each.name === p.plugin))) {
      const parent = entry ?? market.view.marketplaces[0];
      return parent ? { page: p.page, source: parent.source, marketTab: 'plugins' } : { page: p.page };
    }
    if (p.marketName) return { ...p, source: entry.source, marketName: undefined };
  }
  return p;
}

function goToPlace(p: Place) {
  if (p.page === 'plugins') return browse({ source: p.source, marketName: p.marketName, tab: p.marketTab ?? 'plugins', plugin: p.plugin });
  if (state.page !== p.page) showPage(p.page);
  if (p.page === 'harnesses') {
    if (p.tool !== state.harness || (p.tool && p.tab !== state.harnessTab)) goHarness(p.tool, p.tab);
  } else if (p.skill) openFiles(p.skill, true);
  else if (state.libraryView === 'files') leaveFiles();
}

/** Back or Forward by `step` visits: the place there opened by the page actions that open it, its scroll place put back (putBack). */
function traverse(step: number) {
  if (!state.home || heldBy(state.home)) return;
  const from = visits.entries[visits.cursor], next = travel(visits, step, available);
  if (next === visits) return;
  const p = next.entries[next.cursor]!;
  if (state.busy && p.page === 'harnesses' && (state.harness !== p.tool || (p.tool && state.harnessTab !== p.tab))) return;
  visits = next;
  if (placeKey(fullPlace()) === placeKey(p)) { traverse(step); return; }
  if (from) leftAt.set(from, placeOnScreen(offsetsNow()));
  putBackPlaceOf(p);
  restoring = true;
  try { goToPlace(p); } finally { takeMove(); restoring = false; rerender(); }
}

/**
 * Where a page's own Back control (the Files view's Back, a plugin's page's breadcrumb: app.ts noteMove) landed, `place`, is the visit
 * the person came from (past other skills' Files or other plugins' pages on the way): the step back to it, negative (-1 for the visit
 * before), as `travel` takes it; else 0, and the move is a visit.
 */
function stepsBackTo(place: Place): number {
  const { entries, cursor } = visits;
  let at = cursor - 1;
  while (at > 0 && entries[at]!.page === entries[cursor]?.page && (entries[at]!.skill || entries[at]!.plugin)) at--;
  return at >= 0 && placeKey(available(entries[at]!)) === placeKey(place) ? at - cursor : 0;
}

export function listenForTravel() {
  for (const type of ['mouseup', 'auxclick'] as const) document.addEventListener(type, event => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (type === 'mouseup') traverse(event.button === 3 ? -1 : 1);
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey || (event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.matches('input:not([type]), input[type=text], input[type=search], textarea, select')))) return;
    const mac = machine.modifierKey === '⌘';
    if (event.metaKey !== mac || event.altKey === mac) return;
    const step = event.key === (mac ? '[' : 'ArrowLeft') ? -1 : event.key === (mac ? ']' : 'ArrowRight') ? 1 : 0;
    if (step) { event.preventDefault(); traverse(step); }
  });
  window.centralKnot.onNavigate(command => {
    if (command === 'browser-backward' || command === 'browser-forward') traverse(command === 'browser-backward' ? -1 : 1);
  });
}
