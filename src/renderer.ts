import packageInfo from '../package.json' with { type: 'json' };
import { closePanel, loadHome, readAgain, rerender, selectItem, setRenderer, showPage, state, type Page } from './app.ts';
import { button, h, icon, middle } from './dom.ts';
import type { IconName } from './icons.ts';
import { buildRows } from './model.ts';
import { itemSections, overviewPage, skillsPage, toolIds, toolsPage } from './pages.ts';
import { sharePanel } from './sharepanel.ts';
import type { HomeMode, Preview } from './types.ts';

const region = (id: string) => document.getElementById(id)!;
const titles: Record<Page, string> = { overview: 'Overview', skills: 'Skills', tools: 'Tools' };
const MATRIX_MINIMUM = 760;

/** Window width decides the frame: rail or sidebar, panel beside or instead of the content, one pane or two. */
function applyLayout() {
  const width = window.innerWidth;
  const panelOpen = !!state.panel;
  const panelWidth = width < 1366 ? 352 : width < 1600 ? 384 : 480;
  const automaticRail = panelOpen ? width - 208 - panelWidth < MATRIX_MINIMUM : width < 968;
  const rail = state.sidebar ? state.sidebar === 'rail' : automaticRail;
  const sideWidth = rail ? 56 : 208;
  const replaces = panelOpen && width - sideWidth - panelWidth < MATRIX_MINIMUM;
  const contentWidth = width - sideWidth - (panelOpen && !replaces ? panelWidth : 0);
  const classes = document.body.classList;
  classes.toggle('rail', rail);
  classes.toggle('panel-open', panelOpen);
  classes.toggle('panel-replaces', replaces);
  classes.toggle('one-pane', contentWidth < 960);
  classes.toggle('page-skills', state.page === 'skills');
  return { rail, shape: [...classes].filter(name => ['rail', 'panel-replaces', 'one-pane'].includes(name)).join() };
}

function navRow(page: Page, label: string, glyph: IconName, count?: number) {
  const current = state.page === page;
  return h('button.nav-row', {
    type: 'button', id: `nav-${page}`, 'aria-current': current ? 'page' : undefined, 'aria-label': label, title: label,
    onclick: () => showPage(page),
  }, icon(glyph), h('span.nav-label', {}, label), count !== undefined && h('span.nav-count', { 'aria-hidden': 'true' }, String(count)));
}

function homeRow(mode: HomeMode, label: string, glyph: IconName) {
  const current = state.home?.mode === mode;
  return h('button.home-row', {
    type: 'button', id: `home-${mode}`, 'data-home': mode, 'aria-current': current ? 'true' : undefined, 'aria-label': label, title: label,
    disabled: !!state.busy, onclick: () => void loadHome(mode),
  }, icon(glyph, 14), h('span.nav-label', {}, label));
}

function renderSidebar() {
  const rows = state.home && state.preview ? buildRows(state.home, state.preview) : [];
  region('nav').replaceChildren(
    navRow('overview', 'Overview', 'layout-grid'),
    navRow('skills', 'Skills', 'wand-sparkles', state.home ? rows.length : undefined),
    navRow('tools', 'Tools', 'boxes'),
  );
  region('homes').replaceChildren(
    h('p.homes-title', {}, 'Home'),
    homeRow('fixture', 'Practice copy', 'flask-conical'),
    homeRow('custom', 'Another folder…', 'folder-open'),
    homeRow('actual', 'This Mac’s home', 'laptop'),
  );
}

function renderHeader(rail: boolean) {
  region('header').replaceChildren(
    button({
      variant: 'ghost', icon: 'panel-left', name: rail ? 'Expand the sidebar' : 'Collapse the sidebar', id: 'sidebar-toggle',
      onclick: () => { state.sidebar = rail ? 'open' : 'rail'; rerender(); },
    }),
    h('h1.page-title', {}, titles[state.page]),
    h('div.header-end', {}, button({ icon: 'refresh-cw', label: 'Read again', id: 'header-refresh', disabled: !!state.busy || !state.home, onclick: () => void readAgain() })),
  );
}

function renderPage() {
  document.body.classList.remove('has-item');
  region('page').replaceChildren(state.page === 'overview' ? overviewPage() : state.page === 'skills' ? skillsPage() : toolsPage());
}

function panelHeader(title: string, subtitle: string, glyph?: IconName) {
  return h('div.pane-header', {},
    h('div.panel-back', {}, button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: titles[state.page], id: 'panel-back', onclick: closePanel })),
    glyph && icon(glyph, 16, 'tone-muted'),
    h('div.pane-title', {}, h('h2', { id: 'panel-title', tabindex: '-1' }, middle(title)), h('p', {}, subtitle)),
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Close', id: 'panel-close', onclick: closePanel }));
}

function renderPanel() {
  const panel = region('panel');
  panel.hidden = !state.panel;
  if (!state.panel || !state.home || !state.preview) { panel.replaceChildren(); return; }
  if (state.panel === 'share') {
    panel.setAttribute('aria-label', 'Share');
    panel.replaceChildren(panelHeader('Share', 'Copy skills between tools'), ...sharePanel());
    return;
  }
  const row = buildRows(state.home, state.preview).find(entry => entry.key === state.item);
  if (!row) { state.panel = undefined; panel.hidden = true; panel.replaceChildren(); return; }
  panel.setAttribute('aria-label', 'Item detail');
  panel.replaceChildren(panelHeader(row.name, 'Skill', 'wand-sparkles'), h('div.scroll.panel-body', { id: 'panel-body', tabindex: '-1' }, itemSections(row, toolIds(state.home))));
}

function writeFact(preview: Preview): { glyph: IconName; text: string; tone: string } {
  if (preview.gate.state === 'stopped') return { glyph: 'circle-alert', text: 'Start is stopped', tone: 'tone-danger' };
  if (!preview.access.allowed) return { glyph: 'lock', text: 'Preview only, Start does not write here', tone: '' };
  if (state.home?.mode === 'actual') return { glyph: 'triangle-alert', text: 'Start writes to your real folders', tone: 'tone-warning' };
  return { glyph: 'pencil-line', text: state.home?.mode === 'fixture' ? 'Start writes only to this copy' : 'Start writes only inside this folder', tone: '' };
}

function renderStatus() {
  const write = state.preview && writeFact(state.preview);
  region('status-facts').replaceChildren(
    state.home
      ? h('span.status-item.status-home', { title: state.home.home }, icon('eye', 14), h('span', {}, 'Reading ', h('span', { id: 'home-label' }, state.home.label)))
      : h('span.status-item.status-home', {}, icon('eye', 14), state.busy ? 'Reading…' : 'No home read'),
    write ? h(`span.status-item${write.tone ? `.${write.tone}` : ''}`, { title: write.text }, icon(write.glyph, 14), h('span.status-clip', {}, write.text)) : '',
  );
  region('status-version').textContent = packageInfo.version;
}

const remembered = () => [...document.querySelectorAll<HTMLElement>('.scroll[id]')].map(node => [node.id, node.scrollTop] as const);

function render() {
  const focused = document.activeElement?.id;
  const scrolled = remembered();
  const { rail } = applyLayout();
  renderSidebar();
  renderHeader(rail);
  renderPage();
  renderPanel();
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
    const find = document.getElementById('find');
    if (find) { event.preventDefault(); find.focus(); }
  }
  if (event.key === 'Escape') {
    if (typing && state.find) { document.getElementById('find-clear')?.click(); return; }
    if (state.panel) closePanel();
    else if (state.page === 'skills' && document.body.classList.contains('one-pane') && state.item) selectItem(undefined);
  }
});

void loadHome('fixture');
