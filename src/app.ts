import type { ApplyResult, Change, DesktopApi, HomeMode, HomeView } from './types.ts';
import { plural } from './model.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

export type Page = 'overview' | 'skills' | 'tools';

export const state = {
  home: undefined as HomeView | undefined,
  page: 'overview' as Page,
  find: '',
  /** The skill shown in the Skills detail. */
  item: undefined as string | undefined,
  busy: undefined as string | undefined,
  /** What the last Apply all did, shown until the next action or read. */
  applied: undefined as ApplyResult | undefined,
  /** The window chooses the sidebar shape until the person uses the toggle. */
  sidebar: undefined as 'open' | 'rail' | undefined,
};

let render = () => {};
export const setRenderer = (next: () => void) => { render = next; };
/** Re-renders and puts focus back on the control that had it, found by id. */
export const rerender = () => {
  const focused = document.activeElement?.id;
  render();
  if (focused && document.activeElement?.id !== focused) document.getElementById(focused)?.focus();
};

export function announce(text: string) { document.getElementById('announcement')!.textContent = text; }

const focusById = (id?: string | null) => (id ? document.getElementById(id) : null)?.focus();

/** One piece of work at a time: every mutating control is disabled while it runs. */
async function busy(message: string, work: () => Promise<void>) {
  const focused = document.activeElement?.id;
  state.busy = message;
  document.body.dataset.busy = 'true';
  announce(message);
  rerender();
  try { await work(); }
  catch {
    announce(state.home ? `That could not finish. Still on ${state.home.label}. Read again to see where things stand.` : 'Could not read this home. Nothing changed. Try again.');
  }
  state.busy = undefined;
  document.body.dataset.busy = 'false';
  rerender();
  focusById(focused);
}

function accept(view: HomeView) {
  state.home = view;
  state.applied = undefined;
  state.item = undefined;
}

/** Sends the Overview's pending changes, then reads the home again so the page shows what is on disk. */
export const applyManage = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const home = state.home!;
  const result = await api().apply(changes, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.applied = result;
  if (!result.stopped) onDone();
  const failed = result.results.filter(entry => entry.outcome === 'failed').length;
  const written = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
  announce(result.stopped ?? [result.harnessWrites ? `${plural(result.harnessWrites, 'copy', 'copies')} written${written.length <= 3 ? `: ${written.join(', ')}` : ''}.` : 'Applied. Nothing needed copying.', failed ? `${failed} failed.` : ''].filter(Boolean).join(' '));
});

export const loadHome = (mode: HomeMode) => busy('Reading user-wide skills…', async () => {
  const view = await api().selectHome(mode);
  if (view) { accept(view); announce('Read complete. Nothing changed.'); } else announce('');
});

export const readAgain = () => busy('Reading user-wide skills…', async () => {
  const view = await api().refresh();
  if (!view) return;
  state.home = view;
  state.applied = undefined;
  announce('Read complete. Nothing changed.');
});

export function showPage(page: Page) {
  state.page = page;
  state.find = '';
  state.item = undefined;
  rerender();
}

export function selectItem(key: string | undefined) {
  state.item = key;
  rerender();
  document.getElementById('detail-scroll')?.scrollTo(0, 0);
}

/** Shorter on screen only: the real home becomes ~, and the throwaway practice folder is elided. Copying gives the full path. */
export const shownPath = (path: string) => {
  const home = state.home;
  if (!home || home.mode === 'custom' || (path !== home.home && !path.startsWith(`${home.home}/`))) return path;
  return `${home.mode === 'actual' ? '~' : '…'}${path.slice(home.home.length)}`;
};
