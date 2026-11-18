// Back and Forward in this window: the destination drawn, its visits, and the existing page actions that reopen it.
// app.ts placeNow is narrower: it names the table where an action's result belongs.
import { absentKinds, harnessManaged, harnessTabShown, takeMove, machine, noToolManaged, rerender, showPage, showSkillsTable, state } from './app.ts';
import { goHarness } from './harnesspage.ts';
import { openFiles } from './matrix.ts';
import { heldBy } from './otherbuildview.ts';
import { browse, current, listedMarket, market } from './pluginstate.ts';
import { emptyVisits, placeKey, recordPlace, travel, type Place } from './visits.ts';

export function fullPlace(): Place {
  const { page, harness, skillsView, item } = state;
  const tab = harnessTabShown();
  if (tab) return { page, tool: harness, tab };
  if (page === 'plugins') {
    const entry = current()?.entry;
    if (entry || !market.view) {
      const plugin = market.nav.plugin;
      return { page, source: entry?.source ?? market.nav.source, marketName: entry ? undefined : market.nav.marketName, marketTab: plugin ? 'plugins' : market.nav.tab, plugin };
    }
  }
  // Library moves Files here, in available and in goToPlace; its kind switch stays outside the place.
  if (page === 'skills' && skillsView === 'files' && state.home?.skills.items.length && item) return { page, skill: item };
  return { page };
}

let visits = emptyVisits(), home: string | undefined;
export let restoring = false;
export function recordDraw() {
  if (!state.home) return;
  if (home !== state.home.home) { visits = emptyVisits(); home = state.home.home; }
  // A link can draw twice in one click. Record the destination at the end of that turn.
  queueMicrotask(() => {
    const moved = takeMove();
    if (!heldBy(state.home)) visits = recordPlace(visits, fullPlace(), moved);
  });
}

function available(p: Place): Place {
  const home = state.home!;
  if (absentKinds().some(kind => kind === p.page) || (p.page === 'profiles' && noToolManaged())) return { page: 'overview' };
  if (p.tool && !harnessManaged(home, p.tool)) return { page: p.page };
  if (p.skill && !home.skills.items.some(fact => fact.key === p.skill)) return { page: p.page };
  if (p.page === 'plugins' && market.view) {
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
  if (p.page === 'plugins') {
    return browse({ source: p.source, marketName: p.marketName, tab: p.marketTab ?? 'plugins', plugin: p.plugin });
  }
  if (state.page !== p.page) showPage(p.page);
  if (p.page === 'harnesses') {
    if (p.tool !== state.harness || (p.tool && p.tab !== state.harnessTab)) goHarness(p.tool, p.tab);
  } else if (p.skill) openFiles(p.skill);
  else if (state.skillsView === 'files') showSkillsTable();
}

function move(step: number) {
  if (!state.home || heldBy(state.home)) return;
  const next = travel(visits, step, available);
  if (next === visits) return;
  const p = next.entries[next.cursor]!;
  if (state.busy && p.page === 'harnesses' && (state.harness !== p.tool || (p.tool && state.harnessTab !== p.tab))) return;
  visits = next;
  if (placeKey(fullPlace()) === placeKey(p)) { move(step); return; }
  restoring = true;
  try { goToPlace(p); } finally { takeMove(); restoring = false; rerender(); }
}

export function listenForTravel() {
  for (const type of ['mouseup', 'auxclick'] as const) document.addEventListener(type, event => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (type === 'mouseup') move(event.button === 3 ? -1 : 1);
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey || (event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.matches('input:not([type]), input[type=text], input[type=search], textarea, select')))) return;
    const mac = machine.modifierKey === '⌘';
    if (event.metaKey !== mac || event.altKey === mac) return;
    if (!mac && event.target instanceof Element && event.target.closest('[role=radiogroup], [role=radio], [role=slider], input[type=radio], input[type=range]')) return;
    const step = event.key === (mac ? '[' : 'ArrowLeft') ? -1 : event.key === (mac ? ']' : 'ArrowRight') ? 1 : 0;
    if (step) { event.preventDefault(); move(step); }
  });
  window.centralKnot.onNavigate(command => {
    if (command === 'browser-backward' || command === 'browser-forward') move(command === 'browser-backward' ? -1 : 1);
  });
}
