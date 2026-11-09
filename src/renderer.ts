import { designMode, sample } from './design.ts';
import packageInfo from '../package.json' with { type: 'json' };
import { loadHome, loadPlugins, readAgain, startHome, rerender, selectItem, setRenderer, setSync, showPage, state, type Page } from './app.ts';
import { button, h, icon } from './dom.ts';
import type { IconName } from './icons.ts';
import { agentsPage, mcpPage, overviewPage, skillsPage, toolsPage } from './pages.ts';
import { pluginsPage } from './pluginspage.ts';
import { historyPage } from './historypage.ts';
import { instructionsPage } from './instructionspage.ts';
import type { HomeMode, ManageView } from './types.ts';

const region = (id: string) => document.getElementById(id)!;
/** The real home is named for the machine it is on. */
export const realHomeName = navigator.userAgent.includes('Mac') ? 'This Mac’s home' : 'This computer’s home';
const titles: Record<Page, string> = { overview: 'Overview', skills: 'Skills', mcp: 'MCP servers', agents: 'Agents', instructions: 'Instructions', plugins: 'Plugins', history: 'History', tools: 'Tools' };
const MATRIX_MINIMUM = 760;

/** Window width decides the frame: rail or sidebar, one pane or two. */
function applyLayout() {
  const width = window.innerWidth;
  const rail = state.sidebar ? state.sidebar === 'rail' : width < MATRIX_MINIMUM + 208;
  const contentWidth = width - (rail ? 56 : 208);
  const classes = document.body.classList;
  classes.toggle('rail', rail);
  classes.toggle('one-pane', contentWidth < 960);
  classes.toggle('page-skills', state.page === 'skills');
  return { rail, shape: [...classes].filter(name => ['rail', 'one-pane'].includes(name)).join() };
}

function navRow(page: Page, label: string, glyph: IconName, count?: number) {
  const current = state.page === page;
  return h('button.nav-row', {
    type: 'button', id: `nav-${page}`, 'aria-current': current ? 'page' : undefined, 'aria-label': label, title: label,
    onclick: () => showPage(page),
  }, icon(glyph), h('span.nav-label', {}, label), count !== undefined && h('span.nav-count', { 'aria-hidden': 'true' }, String(count)),
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
    navRow('history', 'History', 'history'),
    navRow('tools', 'Tools', 'boxes'),
  );
  region('homes').replaceChildren(
    h('p.homes-title', {}, 'Home'),
    homeRow('fixture', 'Practice copy', 'flask-conical'),
    homeRow('custom', 'Another folder…', 'folder-open'),
    homeRow('actual', realHomeName, 'laptop'),
  );
}

function renderHeader(rail: boolean) {
  region('header').replaceChildren(
    button({
      variant: 'ghost', icon: 'panel-left', name: rail ? 'Expand the sidebar' : 'Collapse the sidebar', id: 'sidebar-toggle',
      onclick: () => { state.sidebar = rail ? 'open' : 'rail'; rerender(); },
    }),
    // While the practice copy is open, the title says so on every page; clicking brings the practice note back.
    // The tag reopens the practice note, so it is hidden while that note is open on the Overview.
    h('h1.page-title', {}, titles[state.page], state.home?.mode === 'fixture' && !(state.page === 'overview' && practiceNoteOpen()) ? h('button.title-tag', { type: 'button', id: 'practice-tag', title: 'What is the practice copy? Click to show the note again.',
      onclick: () => { try { localStorage.removeItem('ck-practice-banner-dismissed'); } catch { /* shows anyway */ } showPage('overview'); } }, icon('flask-conical', 12), 'Practice copy') : ''),
    h('div.header-end', {}, button({ icon: 'refresh-cw', label: state.page === 'plugins' ? 'Refresh all' : 'Refresh', name: state.page === 'plugins' ? 'Read this home and every marketplace again' : 'Read this home again', id: 'header-refresh', disabled: !!state.busy || !state.home,
      onclick: () => void readAgain().then(() => { if (state.page === 'plugins') void loadPlugins(); }) })),
  );
}

function renderPage() {
  document.body.classList.remove('has-item');
  region('page').replaceChildren(state.page === 'overview' ? overviewPage() : state.page === 'skills' ? skillsPage() : state.page === 'mcp' ? mcpPage() : state.page === 'agents' ? agentsPage() : state.page === 'plugins' ? pluginsPage() : state.page === 'history' ? historyPage() : state.page === 'instructions' ? instructionsPage() : toolsPage());
}

function writeFact(manage: ManageView): { glyph: IconName; text: string; tone: string } {
  if (manage.gate.state === 'stopped') return { glyph: 'circle-alert', text: 'Writing is stopped', tone: 'tone-danger' };
  if (!manage.access.allowed) return { glyph: 'lock', text: 'Preview only', tone: '' };
  if (state.home?.mode === 'actual') return { glyph: 'triangle-alert', text: 'Changes write to your real tools', tone: 'tone-warning' };
  return { glyph: 'pencil-line', text: state.home?.mode === 'fixture' ? 'Changes write only to this practice copy' : 'Changes write only inside this folder', tone: '' };
}

function renderStatus() {
  const write = state.home && writeFact(state.home.manage);
  region('status-facts').replaceChildren(
    state.home
      ? h('span.status-item.status-home', { title: state.home.home }, icon(state.home.mode === 'fixture' ? 'flask-conical' : state.home.mode === 'actual' ? 'laptop' : 'folder-open', 14), h('span', {}, h('span', { id: 'home-label' }, state.home.label)))
      : h('span.status-item.status-home', {}, icon('eye', 14), state.busy ? 'Reading…' : 'No home read'),
    write ? h(`span.status-item${write.tone ? `.${write.tone}` : ''}`, { title: write.text }, icon(write.glyph, 14), h('span.status-clip', {}, write.text)) : '',
    // Preview only keeps the same switch, disabled and grey, so the setting is recognisably the same one.
    state.home && !state.home.manage.access.allowed ? h('span.status-item.sync-switch.sync-paused', { id: 'sync-switch', role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', title: state.home.manage.access.reason ?? 'Preview only: nothing is written here' }, h('span.sync-label', {}, 'Automatic sync'), h('span.sync-track.idle', { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, 'Paused'))
    : state.home ? h('button.status-item.sync-switch', { type: 'button', id: 'sync-switch', role: 'switch', 'aria-checked': String(state.home.syncOn), 'aria-label': 'Automatic sync', disabled: !!state.busy,
      title: state.home.syncOn && !anyManaged() ? 'Automatic sync is on: it starts once you manage something. Click to turn it off.' : state.home.syncOn ? 'Automatic sync is on: an edit to a managed item spreads to the other tools on its own, even with this window closed. Click to turn it off.' : 'Automatic sync is off: edits wait until you turn it on or use Sync now. Click to turn it on.',
      onclick: () => void setSync(!state.home!.syncOn) }, h('span.sync-label', {}, 'Automatic sync'), h(`span.sync-track${state.home.syncOn ? '.on' : ''}${state.home.syncOn && !anyManaged() ? '.idle' : ''}`, { 'aria-hidden': 'true' }, h('span.sync-knob')), h('span.sync-state', {}, state.home.syncOn ? (anyManaged() ? 'On' : 'On · nothing managed yet') : 'Off')) : '',
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
  applyLayout();
  renderStatus();
  for (const [id, top] of scrolled) { const node = document.getElementById(id); if (node) node.scrollTop = top; }
  if (focused) document.getElementById(focused)?.focus();
  if (state.home) document.body.dataset.ready = 'true';
}

setRenderer(render);

// Overlay scrollbars reserve nothing, so scrolled content keeps the last 16 clear itself.
const probe = h('div.scroll', {});
document.body.append(probe);
if (probe.offsetWidth === probe.clientWidth) document.documentElement.style.setProperty('--overlay-gutter', '16px');
probe.remove();

let lastShape = '';
window.addEventListener('resize', () => {
  const { shape } = applyLayout();
  if (shape !== lastShape) render();
  lastShape = shape;
});

document.addEventListener('keydown', event => {
  const typing = event.target instanceof HTMLInputElement && event.target.type === 'text';
  if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
    const find = document.getElementById('find') ?? document.getElementById('skills-find');
    if (find) { event.preventDefault(); find.focus(); }
  }
  if (event.key === 'Escape') {
    if (typing) return; // Escape in a find box clears it; see the Overview.
    if (state.page === 'skills' && document.body.classList.contains('one-pane') && state.item) selectItem(undefined);
  }
});

void startHome();
