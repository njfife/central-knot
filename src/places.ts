// Back and Forward in this window: the destination drawn, its visits, and the existing page actions that reopen it.
// app.ts placeNow is narrower: it names the table where an action's result belongs.
import { absentKinds, harnessManaged, isKind, machine, noToolManaged, rerender, showPage, showSkillsTable, state } from './app.ts';
import { goHarness, supports } from './harnesspage.ts';
import { openFiles } from './matrix.ts';
import { heldBy } from './otherbuildview.ts';
import { browse, current, market } from './pluginstate.ts';
import { emptyVisits, placeKey, travel, visit, type Place } from './visits.ts';

export function fullPlace(): Place {
  const { page, harness, harnessTab, skillsView, item } = state;
  if (page === 'harnesses' && harness) return { page, tool: harness, tab: harnessTab };
  if (page === 'plugins') {
    const entry = current()?.entry;
    if (entry || !market.view) {
      const plugin = market.nav.plugin;
      return { page, source: entry?.source ?? market.nav.source, marketTab: plugin ? 'plugins' : market.nav.tab, plugin };
    }
  }
  if (page === 'skills' && skillsView === 'files' && item) return { page, skill: item };
  return { page };
}

let visits = emptyVisits(), home: string | undefined;
let readingMarket = false;
export let restoring = false;
export function recordDraw() {
  if (!state.home) return;
  if (home !== state.home.home) { visits = emptyVisits(); readingMarket = false; home = state.home.home; }
  // A link can draw twice in one click. Record the destination at the end of that turn.
  queueMicrotask(() => {
    if (heldBy(state.home)) return;
    const place = fullPlace();
    // The first marketplace read gives the pending destination its canonical source.
    if (readingMarket && place.page === 'plugins') visits.entries[visits.cursor] = place;
    else {
      const here = visits.entries[visits.cursor];
      if (here?.page === place.page && placeKey(here) !== placeKey(place) && placeKey(available(here)) === placeKey(place)) {
        visits = travel(visits, 0, available); // A read repaired this entry. Keep Forward.
      } else visits = visit(visits, place);
    }
    readingMarket = place.page === 'plugins' && !market.view && market.read.state === 'reading';
  });
}

function available(p: Place): Place {
  const home = state.home!;
  if (absentKinds().some(kind => kind === p.page) || (p.page === 'profiles' && noToolManaged())) return { page: 'overview' };
  if (p.tool && !harnessManaged(home, p.tool)) return { page: p.page };
  if (p.tool && isKind(p.tab) && !supports(home, p.tab, p.tool)) return { ...p, tab: 'about' };
  if (p.skill && !home.skills.items.some(fact => fact.key === p.skill)) return { page: p.page };
  if (p.page === 'plugins' && market.view) {
    const list = market.view.marketplaces, entry = list.find(each => each.source === p.source);
    if (!entry || (p.plugin && !entry.plugins.some(each => each.name === p.plugin))) {
      const parent = entry ?? list[0];
      return parent ? { page: p.page, source: parent.source, marketTab: 'plugins' } : { page: p.page };
    }
  }
  return p;
}

function goToPlace(p: Place) {
  if (state.page !== p.page) showPage(p.page);
  if (p.page === 'harnesses') {
    if (p.tool !== state.harness || (p.tool && p.tab !== state.harnessTab)) goHarness(p.tool, p.tab);
  } else if (p.page === 'plugins') browse({ source: p.source, marketName: undefined, tab: p.marketTab ?? 'plugins', plugin: p.plugin });
  else if (p.skill) openFiles(p.skill);
  else if (state.skillsView === 'files') showSkillsTable();
}

function move(step: number) {
  if (!state.home || heldBy(state.home)) return;
  const next = travel(visits, step, available);
  if (next === visits) return;
  const p = next.entries[next.cursor]!;
  if (state.busy && p.page === 'harnesses' && (state.harness !== p.tool || (p.tool && state.harnessTab !== p.tab))) return;
  visits = next;
  readingMarket = false;
  restoring = true;
  try { goToPlace(p); } finally { restoring = false; rerender(); }
}

export function listenForTravel() {
  for (const type of ['mouseup', 'auxclick'] as const) document.addEventListener(type, event => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (type === 'mouseup') move(event.button === 3 ? -1 : 1);
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.shiftKey || (event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.matches('input:not([type]), input[type=text], input[type=search], textarea, select')))) return;
    const mac = machine.modifierKey === '⌘';
    if (event.metaKey !== mac || event.altKey === mac) return;
    const step = event.key === (mac ? '[' : 'ArrowLeft') ? -1 : event.key === (mac ? ']' : 'ArrowRight') ? 1 : 0;
    if (step) { event.preventDefault(); move(step); }
  });
  window.centralKnot.onNavigate(command => {
    if (command === 'browser-backward' || command === 'browser-forward') move(command === 'browser-backward' ? -1 : 1);
  });
}
