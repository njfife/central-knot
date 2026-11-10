import { settingsPage } from './settingspage.ts';
import { designMode, sample } from './design.ts';
import packageInfo from '../package.json' with { type: 'json' };
import { absentKinds, noTools, loadHome, paintStatusMessage, practiceNoteOpen, setPracticeNote, readAgain, realHomeName, startHome, rerender, setRenderer, setSync, showPage, showSkillsTable, state, type Page } from './app.ts';
import { button, fitBars, h, icon, runAfterLayout } from './dom.ts';
import type { IconName } from './icons.ts';
import { kindNouns, type HomeKind } from './presence.ts';
import { agentsPage, mcpPage, overviewPage, skillsPage, toolsPage } from './pages.ts';
import { pluginsPage } from './pluginspage.ts';
import { historyPage } from './historypage.ts';
import { instructionsPage } from './instructionspage.ts';
import type { HomeMode, HomeView, ManageView } from './types.ts';

const region = (id: string) => document.getElementById(id)!;
/** Each page's title, in the header and the sidebar: a kind's page by its kind's title (presence.ts kindNouns). */
const titles: Record<Page, string> = { overview: 'Overview', ...Object.fromEntries(Object.entries(kindNouns).map(([kind, nouns]) => [kind, nouns.title])) as Record<HomeKind, string>, history: 'History', tools: 'Tools', settings: 'Settings' };
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

/** A page's row: its name, how many it holds, and a dot while a change sync made on its own is unseen. */
function navRow(page: Page, label: string, glyph: IconName, count?: number) {
  const current = state.page === page;
  return h('button.nav-row', {
    type: 'button', id: `nav-${page}`, 'aria-current': current ? 'page' : undefined, 'aria-label': label, title: label,
    onclick: () => showPage(page),
  }, icon(glyph), h('span.nav-label', {}, label), count !== undefined && h(`span.nav-count${count === 0 ? '.nav-count-zero' : ''}`, { 'aria-hidden': 'true' }, String(count)),
    // A change sync made on its own shows as a dot on its page until that notice is seen or dismissed there.
    !current && unseen(page) ? h('span.nav-unseen', { title: unseenText(page) }) : null);
}

const anyManaged = () => !!state.home && [...state.home.manage.skills, ...state.home.mcp.servers, ...(state.home.agents?.servers ?? [])].some(fact => fact.managed);
const noticesFor = (page: Page) => !state.home ? [] : page === 'skills' ? state.home.manage.notices : page === 'mcp' ? state.home.mcp.notices : page === 'agents' ? state.home.agents?.notices ?? [] : [];
const unseen = (page: Page) => noticesFor(page).filter(notice => !state.dismissed.has(notice.history || notice.item) && !state.seenNotices.has(notice.history || notice.item)).length;
const unseenText = (page: Page) => { const list = noticesFor(page).filter(notice => !state.dismissed.has(notice.history || notice.item)); return `${list.length} automatic ${list.length === 1 ? 'change' : 'changes'}: ${list.slice(0, 3).map(notice => notice.item).join(', ')}`; };

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
    disabled: !!state.busy, onclick: () => void loadHome(mode),
  }, icon(glyph, 14), h('span.nav-label.home-label', {}, h('span', {}, shown), h('span.home-sub', {}, { fixture: 'sample data, safe to try', actual: 'your real tools', custom: mode === 'custom' && current ? 'click to choose another' : 'a backup or another account' }[mode])));
}

function renderSidebar() {
  const home = state.home;
  // A kind no tool here can hold has no row (app.ts absentKinds).
  const absent = absentKinds();
  const row = (page: HomeKind, ...rest: [IconName, number?]) => (absent.includes(page) ? null : navRow(page, titles[page], ...rest));
  region('nav').replaceChildren(...[
    navRow('overview', titles.overview, 'layout-grid'),
    row('skills', 'wand-sparkles', designMode ? sample.length : home?.manage.skills.length),
    row('mcp', 'plug', designMode ? undefined : home?.mcp.servers.length),
    row('agents', 'bot', designMode ? undefined : home?.agents?.servers.length),
    row('instructions', 'pencil-line'),
    row('plugins', 'puzzle'),
    !noTools() ? h('div.nav-divider', { role: 'separator' }) : null,
    navRow('history', titles.history, 'history'),
    navRow('tools', titles.tools, 'boxes'),
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
}

function renderHeader(rail: boolean) {
  region('header').replaceChildren(
    button({
      variant: 'ghost', icon: 'panel-left', name: rail ? 'Expand the sidebar' : 'Collapse the sidebar', id: 'sidebar-toggle',
      onclick: () => { state.sidebar = rail ? 'open' : 'rail'; rerender(); },
    }),
    // While the practice copy is open, the title says so on every page; clicking brings the practice note back.
    // The tag reopens the practice note, so it is hidden while that note is open on the Overview.
    h('h1.page-title', {}, titles[state.page], state.home?.mode === 'fixture' && state.page === 'overview' && !practiceNoteOpen() ? h('button.title-tag', { type: 'button', id: 'practice-tag', title: 'What is the practice copy? Click to show the note again.',
      onclick: () => { setPracticeNote(true); showPage('overview'); } }, icon('flask-conical', 12), 'Practice copy') : ''),
    // The same Refresh on every page: it reads the home again, then the page's own data (on Plugins, every marketplace).
    h('div.header-end', {}, button({ icon: 'refresh-cw', label: 'Refresh', name: state.page === 'plugins' ? 'Read this home and every marketplace again' : 'Read this home again', id: 'header-refresh', disabled: !!state.busy || !state.home,
      onclick: () => void readAgain() })),
  );
}

function renderPage() {
  region('page').replaceChildren(state.page === 'overview' ? overviewPage() : state.page === 'skills' ? skillsPage() : state.page === 'mcp' ? mcpPage() : state.page === 'agents' ? agentsPage() : state.page === 'plugins' ? pluginsPage() : state.page === 'history' ? historyPage() : state.page === 'instructions' ? instructionsPage() : state.page === 'settings' ? settingsPage() : toolsPage());
}

/** What the home lets Central Knot write, said in the status bar; `short` stands in when the bar is narrow (style.css). */
function writeFact(manage: ManageView): { glyph: IconName; text: string; short?: string; tone: string } {
  if (manage.gate.state === 'stopped') return { glyph: 'circle-alert', text: 'Writing is stopped', tone: 'tone-danger' };
  if (!manage.access.allowed) return { glyph: 'lock', text: 'Preview only', tone: '' };
  if (state.home?.mode === 'actual') return { glyph: 'pencil-line', text: 'Writes to your real tools', tone: '' };
  if (state.home?.mode === 'fixture') return { glyph: 'pencil-line', text: 'Changes stay here', tone: '' };
  return { glyph: 'pencil-line', text: 'Changes write only inside this folder', short: 'Writes here only', tone: '' };
}

/**
 * The Automatic sync switch, the same one the menus carry. A preview-only home keeps it, disabled and grey, so it is
 * recognisably the same setting. With sync on and nothing managed yet it reads "On · nothing managed"; its tooltip says
 * sync starts once something is.
 */
function syncSwitch(home: HomeView) {
  const label = h('span.sync-label', {}, 'Automatic sync');
  // With no tools there is nothing to sync: the switch is shown, not offered.
  if (!home.manage.tools.length) {
    return h('span.status-item.sync-switch.sync-paused', { id: 'sync-switch', role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', title: 'No tools were found in this home, so there is nothing to sync.' },
      label, h('span.sync-track.idle', { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, 'Nothing to sync'));
  }
  if (!home.manage.access.allowed) {
    return h('span.status-item.sync-switch.sync-paused', { id: 'sync-switch', role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', title: home.manage.access.reason ?? 'Preview only: nothing is written here' },
      label, h('span.sync-track.idle', { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, 'Paused'));
  }
  const idle = home.syncOn && !anyManaged();
  const title = idle ? 'Automatic sync is on: it starts once you manage something. Click to turn it off.'
    : home.syncOn ? 'Automatic sync is on: an edit to a managed item spreads to the other tools on its own, even with this window closed. Click to turn it off.'
    : 'Automatic sync is off: edits wait until you turn it on or use Sync once. Click to turn it on.';
  return h('button.status-item.sync-switch', { type: 'button', id: 'sync-switch', role: 'switch', 'aria-checked': String(home.syncOn), 'aria-label': 'Automatic sync', disabled: !!state.busy, title, onclick: () => void setSync(!home.syncOn) },
    label, h(`span.sync-track${home.syncOn ? '.on' : ''}${idle ? '.idle' : ''}`, { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, !home.syncOn ? 'Off' : idle ? 'On · nothing managed' : 'On'));
}

function renderStatus() {
  const home = state.home;
  const write = home && writeFact(home.manage);
  region('status-facts').replaceChildren(
    home
      ? h('span.status-item.status-home', { title: home.home }, icon(home.mode === 'fixture' ? 'flask-conical' : home.mode === 'actual' ? 'laptop' : 'folder-open', 14), h('span', {}, h('span', { id: 'home-label' }, home.label)))
      : h('span.status-item.status-home', {}, icon('eye', 14), state.busy ? 'Reading…' : 'No home read'),
    write ? h(`span.status-item${write.tone ? `.${write.tone}` : ''}`, { title: write.text }, icon(write.glyph, 14),
      h('span.status-clip.fact-long', {}, write.text), write.short ? h('span.status-clip.fact-short', {}, write.short) : null) : '',
    home ? syncSwitch(home) : '',
  );
  region('status-version').textContent = packageInfo.version;
  paintStatusMessage();
}

const remembered = () => [...document.querySelectorAll<HTMLElement>('.scroll[id]')].map(node => [node.id, node.scrollTop] as const);

function render() {
  const focused = document.activeElement?.id;
  const scrolled = remembered();
  const { rail } = applyLayout();
  renderSidebar();
  renderHeader(rail);
  renderPage();
  // What depends on the drawn widths (columns, wrapped lines) is decided now, before the page is painted (dom.ts afterLayout).
  runAfterLayout();
  renderStatus();
  fitBars();
  for (const [id, top] of scrolled) { const node = document.getElementById(id); if (node) node.scrollTop = top; }
  if (focused) document.getElementById(focused)?.focus();
  if (state.home) document.body.dataset.ready = 'true';
}

setRenderer(render);
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
  // Escape leaves the Files and contents view for the table, except in a text box, where it clears the box (matrix.ts).
  if (event.key === 'Escape' && !typing && state.page === 'skills' && state.skillsView === 'files') showSkillsTable();
});

void startHome();
