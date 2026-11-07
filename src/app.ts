import type { ActionResult, DesktopApi, DestinationResult, HarnessId, HomeMode, HomeView, Preview } from './types.ts';
import { plural } from './model.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

export type Page = 'overview' | 'skills' | 'tools';

export const state = {
  home: undefined as HomeView | undefined,
  preview: undefined as Preview | undefined,
  /** What Overview and Skills show: every present tool, whatever the Share panel has ticked. */
  overview: undefined as Preview | undefined,
  selected: [] as HarnessId[],
  dontShare: [] as string[],
  page: 'overview' as Page,
  find: '',
  /** The skill shown in the item panel and the Skills detail. */
  item: undefined as string | undefined,
  panel: undefined as 'share' | 'item' | undefined,
  results: [] as DestinationResult[],
  stopped: undefined as string | undefined,
  /** Disclosures the person opened or closed, surviving re-renders. */
  disclosures: {} as Record<string, boolean>,
  busy: undefined as string | undefined,
  /** The window chooses the sidebar shape until the person uses the toggle. */
  sidebar: undefined as 'open' | 'rail' | undefined,
};

let render = () => {};
export const setRenderer = (next: () => void) => { render = next; };
export const rerender = () => render();

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
    state.results = [];
    announce(state.home ? `That could not finish. Still on ${state.home.label}. Read again to see where things stand.` : 'Could not read this home. Nothing changed. Try again.');
  }
  state.busy = undefined;
  document.body.dataset.busy = 'false';
  rerender();
  focusById(focused);
  if (document.activeElement === document.body) focusById('panel-title');
}

function accept(view: HomeView) {
  state.home = view;
  state.preview = view.preview;
  state.overview = view.preview;
  state.selected = view.preview.selected;
  state.dontShare = [];
  state.results = [];
  state.stopped = undefined;
  state.item = undefined;
  if (state.panel === 'item') state.panel = undefined;
}

export const loadHome = (mode: HomeMode) => busy('Reading user-wide skills…', async () => {
  const view = await api().selectHome(mode);
  if (view) { accept(view); announce('Read complete. Nothing changed.'); } else announce('');
});

export const readAgain = () => busy('Reading user-wide skills…', async () => {
  const view = await api().refresh();
  if (!view) return;
  state.home = view;
  state.overview = view.preview;
  state.results = [];
  state.stopped = undefined;
  state.preview = await api().preview(state.selected, state.dontShare);
  announce('Read complete. Nothing changed.');
});

const refreshPreview = () => busy('Checking…', async () => {
  state.preview = await api().preview(state.selected, state.dontShare);
  announce('');
});

export function setToolSelected(tool: HarnessId, on: boolean) {
  state.selected = on ? [...state.selected, tool] : state.selected.filter(id => id !== tool);
  void refreshPreview();
}

export function setDontShare(key: string, on: boolean) {
  state.dontShare = on ? [...state.dontShare, key] : state.dontShare.filter(entry => entry !== key);
  void refreshPreview();
}

async function finish(action: ActionResult, done: string) {
  state.results = action.results.filter(result => result.outcome !== 'kept');
  state.stopped = action.stopped;
  state.dontShare = state.dontShare.filter(key => action.preview.items.some(item => item.key === key));
  state.preview = action.preview;
  const view = await api().refresh().catch(() => null);
  if (view) { state.home = view; state.overview = view.preview; }
  // Undo plans without the session's Don't share ticks, so plan once more with them.
  state.preview = await api().preview(state.selected, state.dontShare).catch(() => action.preview);
  announce(action.stopped ?? done);
}

const copies = (count: number) => plural(count, 'copy', 'copies');

function summary(action: ActionResult, done: string, nothing: string): string {
  const failed = action.results.filter(result => result.outcome === 'failed').length;
  const failedText = failed ? `${failed} failed. See What happened.` : '';
  if (action.harnessWrites) return [done, failedText].filter(Boolean).join(' ');
  const held = action.results.filter(result => result.outcome === 'held').length;
  return failedText || (held ? `Nothing was copied. ${held} held. See What happened.` : nothing);
}

export async function startSharing() {
  await busy('Copying…', async () => {
    const action = await api().start(state.selected, state.dontShare, state.preview?.gate.state === 'needs-resume', state.home!.home);
    await finish(action, summary(action, `${copies(action.harnessWrites)} written to disk.`, 'Done. Nothing needed copying.'));
  });
  document.getElementById('panel-body')?.scrollTo(0, 0);
}

export async function undoLast(only?: string) {
  await busy('Undoing…', async () => {
    const action = await api().undo(state.selected, only, state.home!.home);
    await finish(action, summary(action, only ? `${copies(action.harnessWrites)} removed.` : `${copies(action.harnessWrites)} removed. Those skills are now Don’t share.`, 'Nothing was removed. See What happened.'));
  });
  document.getElementById('panel-body')?.scrollTo(0, 0);
}

export function showPage(page: Page) {
  state.page = page;
  state.find = '';
  state.item = undefined;
  state.panel = undefined;
  rerender();
}

export function selectItem(key: string | undefined) {
  state.item = key;
  rerender();
  for (const id of ['detail-scroll', 'panel-body']) document.getElementById(id)?.scrollTo(0, 0);
}

let opener: string | null | undefined;

export function openPanel(kind: 'share' | 'item', key?: string) {
  const wasOpen = !!state.panel;
  if (!wasOpen) {
    opener = document.activeElement?.id;
    state.sidebar = undefined; // The panel needs the room, so the window chooses again.
  }
  state.panel = kind;
  if (key) state.item = key;
  const panel = document.getElementById('panel')!;
  if (!wasOpen) {
    panel.classList.add('entering');
    setTimeout(() => panel.classList.remove('entering'), 200);
  }
  selectItem(state.item);
  if (!wasOpen) focusById('panel-title');
}

export function closePanel() {
  if (!state.panel) return;
  state.panel = undefined;
  state.item = undefined;
  rerender();
  focusById(opener);
}

/** Shorter on screen only: the real home becomes ~, and the throwaway practice folder is elided. Copying gives the full path. */
export const shownPath = (path: string) => {
  const home = state.home;
  if (!home || home.mode === 'custom' || (path !== home.home && !path.startsWith(`${home.home}/`))) return path;
  return `${home.mode === 'actual' ? '~' : '…'}${path.slice(home.home.length)}`;
};

export const disclosureOpen = (id: string, fallback = false) => state.disclosures[id] ?? fallback;
