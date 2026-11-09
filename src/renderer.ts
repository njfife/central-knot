import { settingsPage } from './settingspage.ts';
import { designMode, sample } from './design.ts';
import packageInfo from '../package.json' with { type: 'json' };
import { loadHome, readAgain, realHomeName, startHome, rerender, setRenderer, setSync, showPage, showSkillsTable, state, type Page } from './app.ts';
import { button, fitBars, h, icon } from './dom.ts';
import type { IconName } from './icons.ts';
import { agentsPage, mcpPage, overviewPage, skillsPage, toolsPage } from './pages.ts';
import { pluginsPage } from './pluginspage.ts';
import { historyPage } from './historypage.ts';
import { instructionsPage } from './instructionspage.ts';
import type { HomeMode, ManageView } from './types.ts';

const region = (id: string) => document.getElementById(id)!;
const titles: Record<Page, string> = { overview: 'Overview', skills: 'Skills', mcp: 'MCP servers', agents: 'Agents', instructions: 'Instructions', plugins: 'Plugins', history: 'History', tools: 'Tools', settings: 'Settings' };
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

function navRow(page: Page, label: string, glyph: IconName, count?: number) {
  const current = state.page === page;
  return h('button.nav-row', {
    type: 'button', id: `nav-${page}`, 'aria-current': current ? 'page' : undefined, 'aria-label': label, title: label,
    onclick: () => showPage(page),
  }, icon(glyph), h('span.nav-label', {}, label), count !== undefined && h(`span.nav-count${count === 0 ? '.nav-count-zero' : ''}`, { 'aria-hidden': 'true' }, String(count)),
    // A change sync made on its own shows as a dot on its page until that notice is seen or dismissed there.
    !current && unseen(page) ? h('span.nav-unseen', { title: unseenText(page) }) : null);
}

const practiceNoteOpen = () => { try { return localStorage.getItem('ck-practice-banner-dismissed') !== '1'; } catch { return true; } };
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
  region('nav').replaceChildren(
    navRow('overview', 'Overview', 'layout-grid'),
    navRow('skills', 'Skills', 'wand-sparkles', designMode ? sample.length : state.home?.manage.skills.length),
    navRow('mcp', 'MCP servers', 'plug', designMode ? undefined : state.home?.mcp.servers.length),
    navRow('agents', 'Agents', 'bot', designMode ? undefined : state.home?.agents?.servers.length),
    navRow('instructions', 'Instructions', 'pencil-line'),
    navRow('plugins', 'Plugins', 'puzzle'),
    h('div.nav-divider', { role: 'separator' }),
    navRow('history', 'History', 'history'),
    navRow('tools', 'Tools', 'boxes'),
    navRow('settings', 'Settings', 'settings'),
  );
  // This computer's home first: it is where a released app works. Only dev builds have the Practice copy.
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
      onclick: () => { try { localStorage.removeItem('ck-practice-banner-dismissed'); } catch { /* shows anyway */ } showPage('overview'); } }, icon('flask-conical', 12), 'Practice copy') : ''),
    // The same Refresh on every page: it reads the home again, then the page's own data (on Plugins, every marketplace).
    h('div.header-end', {}, button({ icon: 'refresh-cw', label: 'Refresh', name: state.page === 'plugins' ? 'Read this home and every marketplace again' : 'Read this home again', id: 'header-refresh', disabled: !!state.busy || !state.home,
      onclick: () => void readAgain() })),
  );
}

function renderPage() {
  region('page').replaceChildren(state.page === 'overview' ? overviewPage() : state.page === 'skills' ? skillsPage() : state.page === 'mcp' ? mcpPage() : state.page === 'agents' ? agentsPage() : state.page === 'plugins' ? pluginsPage() : state.page === 'history' ? historyPage() : state.page === 'instructions' ? instructionsPage() : state.page === 'settings' ? settingsPage() : toolsPage());
}

function writeFact(manage: ManageView): { glyph: IconName; text: string; tone: string } {
  if (manage.gate.state === 'stopped') return { glyph: 'circle-alert', text: 'Writing is stopped', tone: 'tone-danger' };
  if (!manage.access.allowed) return { glyph: 'lock', text: 'Preview only', tone: '' };
  if (state.home?.mode === 'actual') return { glyph: 'pencil-line', text: 'Writes to your real tools', tone: '' };
  return { glyph: 'pencil-line', text: state.home?.mode === 'fixture' ? 'Changes stay here' : 'Changes write only inside this folder', tone: '' };
}

function renderStatus() {
  const write = state.home && writeFact(state.home.manage);
  region('status-facts').replaceChildren(
    state.home
      ? h('span.status-item.status-home', { title: state.home.home }, icon(state.home.mode === 'fixture' ? 'flask-conical' : state.home.mode === 'actual' ? 'laptop' : 'folder-open', 14), h('span', {}, h('span', { id: 'home-label' }, state.home.label)))
      : h('span.status-item.status-home', {}, icon('eye', 14), state.busy ? 'Reading…' : 'No home read'),
    write ? h(`span.status-item${write.tone ? `.${write.tone}` : ''}`, { title: write.text }, icon(write.glyph, 14), h('span.status-clip', {}, write.text)) : '',
    // Preview only keeps the same switch, disabled and grey, so the setting is recognisably the same one. With sync on
    // and nothing managed yet, the grey switch says Waiting; its tooltip says what it waits for.
    state.home && !state.home.manage.access.allowed ? h('span.status-item.sync-switch.sync-paused', { id: 'sync-switch', role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', title: state.home.manage.access.reason ?? 'Preview only: nothing is written here' }, h('span.sync-label', {}, 'Automatic sync'), h('span.sync-track.idle', { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, 'Paused'))
    : state.home ? h('button.status-item.sync-switch', { type: 'button', id: 'sync-switch', role: 'switch', 'aria-checked': String(state.home.syncOn), 'aria-label': 'Automatic sync', disabled: !!state.busy,
      title: state.home.syncOn && !anyManaged() ? 'Automatic sync is on: it starts once you manage something. Click to turn it off.' : state.home.syncOn ? 'Automatic sync is on: an edit to a managed item spreads to the other tools on its own, even with this window closed. Click to turn it off.' : 'Automatic sync is off: edits wait until you turn it on or use Sync once. Click to turn it on.',
      onclick: () => void setSync(!state.home!.syncOn) }, h('span.sync-label', {}, 'Automatic sync'), h(`span.sync-track${state.home.syncOn ? '.on' : ''}${state.home.syncOn && !anyManaged() ? '.idle' : ''}`, { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, state.home.syncOn ? (anyManaged() ? 'On' : 'Waiting') : 'Off')) : '',
  );
  region('status-version').textContent = packageInfo.version;
  // The result band already says what just happened; the status bar does not say it twice.
  const said = document.getElementById('announcement');
  said?.classList.toggle('visually-hidden', (!!state.outcome && state.outcome.page === state.page) || said.dataset.quiet === 'true');
}

const remembered = () => [...document.querySelectorAll<HTMLElement>('.scroll[id]')].map(node => [node.id, node.scrollTop] as const);

function render() {
  const focused = document.activeElement?.id;
  const scrolled = remembered();
  const { rail } = applyLayout();
  renderSidebar();
  renderHeader(rail);
  renderPage();
  renderStatus();
  fitBars();
  for (const [id, top] of scrolled) { const node = document.getElementById(id); if (node) node.scrollTop = top; }
  if (focused) document.getElementById(focused)?.focus();
  if (state.home) document.body.dataset.ready = 'true';
}

setRenderer(render);

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
new ResizeObserver(fitBars).observe(document.getElementById('main')!);
void document.fonts.ready.then(fitBars);

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
