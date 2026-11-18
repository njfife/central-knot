// The page's state and most pages' actions (MAP.md, "The app's shell and Settings"): the open home's view and each page's own
// state (`state`), the page shown (showPage), what is said after a click (tell, announce) and when a result goes by itself
// (FADE_MS), the busy line (busy) and whether the page is acting (acting: busy, or a run of clicks: clicklist.ts); a click on an
// item page sent to its kind's engine (carryOut, through kindPages), at once under busy (applyClick), one per kind as one
// (applyByKind) or in its turn in the page's list (queueClick), its result kept for the page (lastResult), a run's said once
// (sayRun), an Undo's kind by kind (undoClick); History's actions (restoreEvent); the reads of
// the home (loadHome, readAgain, readHomeOnce), usage collected when a home opens and on Update (collectUsage), and the Sync
// switch, Sync once and Synchronize everything's row; the rows a click pins where they were (pinnedRows, drawPage); and the
// Instructions, base instructions and Profiles pages' actions.
// A background view set aside while acting joins the next taken view (setHome). A sync notice lives across reads here, until its page shows it (keepUnshown); on its page, matrix.ts toldNotices keeps or folds it. Not here: drawing (renderer.ts and each
// page's module), the Plugins page's state (pluginstate.ts), the Sources and Git repo pages' (sourcespage.ts, repopage.ts), and
// every rule a page shows (the engines' answers in the view: libraryrow.ts, historyactions.ts, profileplan.ts). Two calls go
// into matrix.ts, which imports this module: resultInHeader, and holdOrder, which holds the list on screen as a reading lands.
import { forgetRepoPrompts, loadRepo, loadRepoSoon } from './repopage.ts';
import { forgetSourcePrompts, loadSources } from './sourcespage.ts';
import { loadSettings, openSettings } from './settingspage.ts';
import { checkNow } from './updateview.ts';
import { loadPluginUpdates } from './pluginupdateview.ts';
import type { ApplyResult, ProfileEdit, ProfileSwitchResult, BaseApply, BaseResult, BaseUndo, BaseView, Change, DesktopApi, DestinationResult, HarnessId, InstructionFile, HistoryEvent, HistoryDays, HomeMode, HomeView, PassResult, SyncNotice, UsageReading } from './types.ts';
import { anyOn, kindSource, noPins, pinsOn, rowId, sameRow, type NamedRow, type Pinned, type RowKey } from './itemrow.ts';
import { itemKey } from './library.ts';
import { caughtUpNames, groupBy, noticeNames, plural, withSetAside } from './model.ts';
import { button, h } from './dom.ts';
import { readFlag, writeFlag } from './flags.ts';
import { pluginItemCount } from './pluginrows.ts';
import { clickResults, heldWhole, keptBack } from './clickplan.ts';
import { entriesNow, everythingDone, libraryAction, libraryEntry, librarySentence, restorePlan } from './historyactions.ts';
import { libraryWords } from './libraryrow.ts';
import { andList, fewNames, fileName, kindNames, kindNouns, noToolsSentence, orList, rowNames, rowNouns, saidByKind, toolList, toolName, toolNames as namedTools, toolsPhrase } from './words.ts';
import { withOwn, withoutBase } from './basetext.ts';
import { machineNames, pagePlatform } from './machine.ts';
import { endListNews, fadeRun, loadPlugins, resetMarket } from './pluginstate.ts';
import { resultLines, resultSentence, reverse, runPlan, strayHolds, succeeded, type LastRun, type PluginOp } from './pluginplan.ts';
import { nextDraft, unsaved, type InstructionDraft } from './drafts.ts';
import { absentKindsIn, heldKinds, type HomeKind } from './presence.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';
import { turnsWords } from './profileplan.ts';
import { clickList, drop, endRun, join, runAt, type Run, type Turn } from './clicklist.ts';
import { holdOrder, kindsShown, resultInHeader, noticeLinesOnPage } from './matrix.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

/** Every page, in the sidebar's order. The Library lists every kind of item (matrix.ts libraryTable), its segment `state.libraryKind`. */
export const pages = ['overview', 'harnesses', 'library', 'instructions', 'plugins', 'profiles', 'history', 'sources', 'repo', 'settings'] as const;
export type Page = typeof pages[number];

/** This computer's names, and what its platform offers (machine.ts). */
export const machine = machineNames(pagePlatform(navigator.userAgent));
export const { home: realHomeName, machine: thisMachine, tray: trayPlace } = machine;

/** The kinds of item the tables manage: the Library's segments, and a tool's tabs of them under Harnesses. */
export type PageKind = 'skills' | 'mcp' | 'agents';
export const KINDS: PageKind[] = ['skills', 'mcp', 'agents'];
export const isKind = (tab: string | undefined): tab is PageKind => (KINDS as (string | undefined)[]).includes(tab);
/** What a harness's page shows: one kind of item, its instruction file, its plugins, or where its files are. */
export type HarnessTab = PageKind | 'instructions' | 'plugins' | 'about';
/** Managed: Central Knot reads and writes this harness in this home (presence.ts managedTools), so it has a page. */
export const harnessManaged = (home: HomeView, tool: HarnessId) => home.sync.managed.includes(tool);
/** A harness's page whose tool is no longer managed (uninstalled, or left out) closes, so it doesn't reopen by itself later. */
function forgetLostHarness() { if (state.harness && state.home && !harnessManaged(state.home, state.harness)) state.harness = undefined; }
/** The tab of the harness page on screen, if one is: Harnesses with a harness open that this home still manages. */
export const harnessTabShown = (): HarnessTab | undefined => (state.page === 'harnesses' && state.harness && state.home && harnessManaged(state.home, state.harness) ? state.harnessTab : undefined);
/** The kind whose table is on screen on a harness's page, if one is. */
export const harnessKindShown = (): PageKind | undefined => { const tab = harnessTabShown(); return isKind(tab) ? tab : undefined; };
export interface BaseEdit {
  text: string; hash: string; tools: HarnessId[]; stage: 'edit' | 'review';
  /** Where the draft came from: a tool's own instructions (they move into the base), a tool's edited copy (to use as the base),
   *  the base going back into one tool whose copy was edited, the base written again where it is missing or older, an earlier
   *  version, or a draft one of the person's tools wrote from every tool's instructions. */
  source?: { kind: 'own' | 'copy' | 'putBack' | 'update' | 'version' | 'draft'; tool?: HarnessId };
  /** A draft a tool wrote (`source.kind` 'draft', `source.tool` wrote it): each sorted tool's own text as the draft left it, which
   *  replaces that tool's own text on saving, and the hash of each file the draft was written from. */
  own?: Partial<Record<HarnessId, string>>;
  read?: Partial<Record<HarnessId, string>>;
  /** The hash of the base that draft was written from. */
  readBase?: string;
  confirmDiscard?: boolean; fullDiff?: boolean;
  /** Why the review is shown again: the base or a file changed since it was last shown. */
  conflict?: string;
  /** The ticks before "Stop sharing with every tool…" emptied them, put back if the person goes back to editing. */
  ticksBeforeStop?: HarnessId[];
}

/**
 * The panel that sets up a draft of the base, while it is open under the base's text (basecard.ts draftPanel): the tool that
 * will write it, the model typed for that tool ('' for its own default; choosing another tool clears it), the prompt it will be
 * sent as main last read it (when the panel opened, or when a Start or a dropped draft found the files changed), and why the
 * last try gave no draft. Nothing of it is stored.
 */
export interface DraftPick { tool: HarnessId; model: string; prompt: string; problem?: string }

/** The text a tool's editor works on: its own instructions, without the base block when it gets the base. */
export const ownText = (file: InstructionFile) => (file.base ? file.base.own : file.text);

export const state = {
  home: undefined as HomeView | undefined,
  page: 'overview' as Page,
  /** The home last asked for, so Try again retries that one. */
  lastMode: undefined as HomeMode | undefined,
  find: '',
  /** The skill shown in the Library's Files view. */
  item: undefined as string | undefined,
  busy: undefined as string | undefined,
  /** What the last click on MCP servers did. */
  mcpResult: undefined as PassResult | undefined,
  agentsResult: undefined as PassResult | undefined,
  /** What sync and actions did, newest last: read when the History page opens or the home changes (pagedata.ts). */
  history: pageData<HistoryEvent[]>(),
  /** How long History keeps things, for History's intro; read with History's events. */
  historyDays: undefined as HistoryDays | undefined,
  /** What the last click on skills did, shown until the next action or read. */
  skillsResult: undefined as PassResult | undefined,
  /** The Library: its list, or one skill's files and contents beside a list of the skills (its Files view). */
  skillsView: 'table' as 'table' | 'files',
  /**
   * The Library's segment: every kind, or one (its kind switch, matrix.ts kindSwitch). All at launch; kept while the window is
   * open, across pages and homes, never stored; one with no segment in the open home is shown as All (matrix.ts segmentKinds).
   */
  libraryKind: 'all' as PageKind | 'all',
  /** Counts moves to another page, so what belongs to one visit (an armed Delete) can tell it has ended. */
  visit: 0,
  /**
   * What the status bar says (announce): the newest message, whether it is for screen readers only, and its place in
   * the order messages were said, so the newest always wins.
   */
  said: { text: '', quiet: false, seq: 0 } as { text: string; quiet: boolean; seq: number; link?: { label: string; run: () => void } },
  /** What the last action did, said on the page it happened on until the next action or page (Outcome). */
  outcome: undefined as Outcome | undefined,
  /** The result whose problem lines are shown whole (Show all: matrix.ts problemLines): an item list's outcome, kept result or first background problem; Plugins' run or problem. */
  shownWhole: undefined as Outcome | PassResult | DestinationResult | LastRun | string | undefined,
  /** What the tools' session history shows was used (usage.ts), for this home: collected when it opens and on Update usage statistics (collectUsage). */
  usage: pageData<UsageReading>(),
  /** Whether the usage band shows above an item list's list (matrix.ts usageBand): opened by Update usage statistics and by a reading that fails, closed by its close button and when a home opens. */
  usageBand: false,
  /** Each tool's instruction file: read when the Instructions page opens or the home changes (pagedata.ts). */
  instructions: pageData<InstructionFile[]>(),
  /** The one instruction file being edited (InstructionDraft). */
  instructionEdit: undefined as InstructionDraft | undefined,
  /** The base instructions and which tools get them, read with the instruction files. */
  base: undefined as BaseView | undefined,
  /** The base being edited: its text and tools so far, the hash it was opened at, and where the draft came from. */
  baseEdit: undefined as BaseEdit | undefined,
  /** The panel that sets up a draft of the base, while it is open (DraftPick). */
  draftPick: undefined as DraftPick | undefined,
  /** The tool writing a draft of the base right now. */
  drafting: undefined as HarnessId | undefined,
  /** Sync notices the person has dismissed, by History event or item, and a background pass's problems (matrix.ts listResult). */
  dismissed: new Set<string>(),
  // The page whose Apply result (and its Undo) stepped aside for a sync notice: the notice says where the Undo went.
  undoMoved: undefined as { page: Page; notices: string[]; label: string; items: string[] } | undefined,
  /** Sync notices already shown on their page, so the sidebar dot clears once seen. */
  seenNotices: new Set<string>(),
  /** Whether the content is wide enough to dock an open row's details beside its table; set by the renderer's layout. */
  wide: false,
  /** The harness whose page is open on Harnesses; none shows every harness. */
  harness: undefined as HarnessId | undefined,
  harnessTab: 'skills' as HarnessTab,
  /** The window chooses the sidebar shape until the person uses the toggle, which holds until the window crosses the rail breakpoint. */
  sidebar: undefined as 'open' | 'rail' | undefined,
  /** The rows a click pins where they were, on the list on screen (pinnedRows). */
  pinned: noPins(),
};

/**
 * The rows pinned on the list on screen (itemrow.ts Pinned): the list asks for them each time it is drawn, by its own name; a
 * click on a row's own switch pins that row (itemrow.ts pin), and a usage reading as it lands pins the rows it could move
 * (matrix.ts holdOrder). Only a draw lets them go: one that asks for another list or for none (another page, tab, view or
 * plugin's page, another Sort or chip: drawPage); and Refresh (readAgain) and Put in order (unpin, from matrix.ts rowsHeld).
 * Find keeps them. Asked for outside a draw (a click, a reading landing), they are the ones kept when the name is the list on
 * screen's, else a set kept nowhere, so a pin there is lost. In memory only. `Group`: what the list groups its rows by
 * (matrix.ts its headings, pluginstate.ts a plugin's place).
 */
let drawing = false, asked = false;
export const pinnedRows = <Group extends string | number>(list: string): Pinned<Group> => {
  if (drawing) { asked = true; state.pinned = pinsOn(state.pinned, list); }
  return (state.pinned.list === list ? state.pinned : noPins()) as Pinned<Group>;
};
/** Draws the page (renderer.ts render): a draw that asked for no pinned rows lets them go. */
export function drawPage(draw: () => void) { drawing = true; asked = false; try { draw(); } finally { drawing = false; } if (!asked) unpin(); }
/** Every pinned row is let go: each takes its own place in the order again. */
export const unpin = () => { state.pinned = noPins(); };

let render = () => {};
export const setRenderer = (next: () => void) => { render = next; };
/** Re-renders and puts focus back on the control that had it, found by id. */
export const rerender = () => {
  const focused = document.activeElement?.id;
  render();
  if (focused && document.activeElement?.id !== focused) document.getElementById(focused)?.focus({ preventScroll: true });
};

/** The practice copy's note on the Overview, shown until the person hides it (kept per viewer, in this window's storage). */
const PRACTICE_NOTE = 'ck-practice-banner-dismissed';
export const practiceNoteOpen = (): boolean => !readFlag(PRACTICE_NOTE);
export const setPracticeNote = (open: boolean): void => writeFlag(PRACTICE_NOTE, !open);

/**
 * Says something in the status bar, kept in state (state.said) so a redraw paints the same thing. The newest message is
 * the one shown. A quiet announcement is for screen readers only: the page already shows the same thing (a band).
 */
export function announce(text: string, quiet = false, link?: { label: string; run: () => void }) {
  state.said = { text, quiet, seq: state.said.seq + 1, link };
  paintStatusMessage();
}

/**
 * Sets what the last action did (or clears it, saying `otherwise`), and says it. A result with nothing to offer (no
 * button, Undo or History link) is said in the status bar; one with a band is heard by screen readers, since the band
 * already shows it.
 */
export function tell(outcome: Outcome | undefined, otherwise = ''): void {
  state.outcome = outcome;
  if (!outcome) announce(otherwise);
  else { announce(spoken(outcome), !saidInStatusBar(outcome)); outcome.said = state.said.seq; }
  fadeLater();
}

/** A result as the status bar and screen readers say it: its sentence, then its reasons. */
const spoken = (outcome: Outcome) => [outcome.text, ...outcome.reasons ?? []].join(' ');

/**
 * How long a result stays once the page stops acting, when it goes by itself: in a list page's header (matrix.ts resultInHeader),
 * one with no problem line, whose Undo stays in History (Plugins' run too, whose Undo goes with it: pluginstate.ts fadeRun); on
 * another page, an Undo's confirmation (Outcome fade).
 */
export const FADE_MS = 8000;
let fading: ReturnType<typeof setTimeout> | undefined;
/** The result's time starts again from now; none runs while the page acts, whose end starts it (afterActing). */
function fadeLater(): void {
  clearTimeout(fading);
  if (!acting()) fading = setTimeout(fadeNow, FADE_MS);
}
/** The pointer or the focus is in the header's result: it stays while they are, and its time starts again once they leave. */
const heldInHeader = () => !!document.querySelector('.header-result:hover, .header-result:focus-within');
function fadeNow(): void {
  if (acting()) return;
  if (heldInHeader()) { fading = setTimeout(() => (heldInHeader() ? fadeNow() : fadeLater()), 250); return; }
  const outcome = state.outcome;
  if (outcome?.fade || (outcome && resultInHeader() && !outcome.warn && !outcome.reasons?.length)) state.outcome = undefined;
  fadeRun();
  rerender();
}

/** Paints the status bar's message from state.said, keeping its whole text as its tooltip. */
export function paintStatusMessage() {
  const region = document.getElementById('announcement')!;
  const told = state.said;
  // The first sentence, then the rest, so a narrow bar can drop the rest whole rather than cut a word (style.css).
  if (region.dataset.text !== told.text) {
    region.dataset.text = told.text;
    const [, first, rest] = /^(.+?[.!?])(\s.+)?$/s.exec(told.text) ?? [told.text, told.text, ''];
    region.replaceChildren(...(told.text ? [h('span.said-first', {}, first), rest ? h('span.said-rest', {}, ` ${rest.trim()}`) : null].filter((part): part is HTMLElement => !!part) : []));
  }
  region.title = told.text;
  // A link that belongs to the message (the release notes after an update) goes with it.
  const link = document.getElementById('said-link');
  if (link) { link.hidden = !told.link || told.quiet; link.textContent = told.link?.label ?? ''; link.onclick = told.link?.run ?? null; }
  // Only a message that repeats what the page shows (announced quiet) is for screen readers alone. A result the page didn't
  // draw (no band on this page, or held back) is shown here after all: the drawn result is marked data-outcome.
  const quiet = told.quiet && !(state.outcome && told.text === spoken(state.outcome) && !document.querySelector('[data-outcome]'));
  region.classList.toggle('visually-hidden', quiet);
  // A narrow status bar shows a small mark instead of a message cut to a stub; its tooltip has the message (style.css).
  const mark = document.getElementById('message-mark');
  if (mark) { mark.title = told.text; mark.hidden = !told.text || quiet; }
}

/**
 * Takes a new view, including the view set aside for this home. `say` gets the view as taken, before it replaces the one on screen.
 * Fresh notices in a background view are “Sync changed” news. A held notice is said when the action ends.
 * When its tools changed (one appeared or went away), or there was no home before, the
 * page follows: a page whose kind is no longer here gives way to the Overview, saying why, and a page with its own data
 * reads it again (unless `reload` is false: the caller reads it itself).
 */
export function setHome(view: HomeView | null | undefined, { reload = true, say, background = false }: {
  reload?: boolean; say?: (view: HomeView) => void; background?: boolean;
} = {}): void {
  if (!view) return;
  const held = setAside?.home === view.home ? setAside : undefined;
  view = withSetAside(held, view);
  setAside = undefined;
  say?.(view);
  const news = background ? view : held;
  if (news) takeBackgroundNews(news);
  const before = state.home ? homeTools().join() : undefined;
  state.home = keepUnshown(state.home, view);
  if (news && !acting()) sayBackgroundNews();
  // A closed background problem stays closed while reads report it, and is forgotten once one doesn't (matrix.ts listResult).
  for (const key of state.dismissed) if (key.startsWith('problem:') && !view.sync.caughtUp.some(entry => problemKey(entry) === key)) state.dismissed.delete(key);
  // A record taken over at this view's look (types.ts HomeView tookOver), after whatever the read itself said.
  if (view.tookOver) announce(view.tookOver);
  forgetLostHarness();
  if (before !== undefined && homeTools().join() === before) return;
  leaveAbsentPage();
  if (reload) void loadPageData(state.page, { readId: view.readId });
}

/** Where focus goes when the running work ends, when its result replaced the control that started it (a review opening, Add's switch, the row an Undo undid). */
let focusAfterBusy: string | undefined;
/** Sets focusAfterBusy from another page's action (the Plugins page's Undo). */
export const focusWhenDone = (id: string) => { focusAfterBusy = id; };

/**
 * Why the page is acting, while it is: work under busy (its line), or clicks in the page's list (clicklist.ts). Meanwhile no
 * route opens another home, a background refresh waits, and the writes to the home are off, each saying why (dom.ts button and
 * toggle take the reason as `disabled`): Refresh, Automatic sync, Turn these off, Resume, an opened row's controls, History's
 * actions, Profiles, the sources page (words.ts pageNames), Instructions, the Git repo, a tool's Manage switch, first setup's
 * choices, Settings' Synchronize everything, the Plugins page's other actions and the other-build screen. A row's switch or Add
 * (the item lists and Plugins) joins the list instead; Settings' own switches, which write the app's settings, stay on.
 * showActing marks body[data-busy] for the end-to-end checks and says held news when acting ends, before the finished draw.
 */
export const acting = (): string | undefined => state.busy || (clickList.running ? 'Waits until the switches clicked are done.' : undefined);
/** Marks whether the page is acting and, at its end, says any news held for this draw. */
export const showActing = () => {
  document.body.dataset.busy = String(!!acting());
  if (!acting()) sayBackgroundNews();
};
/** What follows any acting once it ends: a background refresh asked for meanwhile runs, the Git repo's count is read again (no fetch), and the result's time to go starts. */
export function afterActing() {
  if (!acting() && menuSyncHome) void syncNow(menuSyncHome);
  drainOwedRefresh();
  if (state.home) loadRepoSoon();
  fadeLater();
}

/** What the page says when work stopped half way: the page may no longer show what is true. */
const couldNotFinish = () => (state.home ? `That could not finish. Still on ${state.home.label}. Click Refresh to see where things stand.` : 'Could not read this home. Nothing changed. Try again.');

/**
 * One piece of work at a time: every mutating control is disabled while it runs. Its "Reading…" message gives way, when
 * the work said nothing of its own, to what the status bar said before. A background refresh that arrived meanwhile runs
 * once it is done. `work` is given the page it was started on: a result it tells belongs there, wherever the page is once it is
 * done (matrix.ts outcomeShown shows a result on its own page alone), the one way a result's place is taken at the click.
 */
export async function busy(message: string, work: (page: Page) => Promise<void>) {
  const focused = document.activeElement?.id, page = state.page;
  const before = state.said;
  // Any other action, an Undo too, ends the run of clicks (clicklist.ts).
  endRun();
  state.outcome = undefined;
  state.undoMoved = undefined;
  state.busy = message;
  showActing();
  announce(message);
  const working = state.said.seq;
  rerender();
  try { await work(page); }
  catch { announce(couldNotFinish()); }
  // When the work said nothing since its "Reading…", what was said before comes back.
  if (state.said.seq === working) announce(before.text, before.quiet, before.link);
  state.busy = undefined;
  showActing();
  rerender();
  // Back on the control that had it without scrolling to it; a control the work put in its place is scrolled to.
  const next = [focusAfterBusy, focused].map(id => (id ? document.getElementById(id) : null)).find(Boolean);
  next?.focus({ preventScroll: next.id === focused });
  focusAfterBusy = undefined;
  // Any change may change what differs from the git repo.
  afterActing();
}

/**
 * Opens a home (a switch, or the first at launch), where setHome only takes a newer view of the same one. Everything
 * read or chosen for the home before is let go: its pages' data (each starts over at reading; the open page's is read for
 * this home at once, the others as they open), the marketplace choices and the open skill. An unsaved Instructions draft is kept: the Instructions page
 * offers to copy or discard it.
 */
function accept(view: HomeView): HomeView {
  state.home = undefined;
  state.skillsResult = undefined;
  state.item = undefined;
  // A harness page belongs to the home it was opened in.
  state.harness = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  // The base and its editor belong to the home they were read in.
  state.base = undefined;
  state.baseEdit = undefined;
  state.draftPick = undefined;
  resetPageData(state.instructions);
  resetPageData(state.history);
  resetPageData(state.usage);
  state.usageBand = false;
  drop(turn => turn.state === 'waiting');
  endRun();
  resetMarket();
  // The note of what plugin updates did by themselves is about one home.
  void loadPluginUpdates();
  setHome(view, { reload: false });
  void loadPageData(state.page, { readId: view.readId });
  // Usage is collected for every home it opens, in the background (collectUsage).
  void collectUsage();
  // The sidebar counts what waits each way for the repo, so it is read with the home (no fetch: that waits for the page).
  if (state.page !== 'repo') void loadRepo(false);
  // The sidebar counts the sources too (their last reads: no network).
  if (state.page !== 'sources') void loadSources();
  return state.home!;
}

/** Whether the window has shown: false only after a start at sign-in with no window (main.ts startedHidden, the page's `start`), until it first shows. */
let windowShown = new URLSearchParams(globalThis.location?.search).get('start') !== 'hidden';
api().onWindowShown(() => { if (windowShown) return; windowShown = true; void collectUsage(); });

/**
 * Collects usage: main's usage:read reads the tools' own session history on this computer, and nothing leaves it. By itself
 * when a home opens (accept; after a start with no window, once the window first shows), and on Update usage statistics
 * (`asked`), whose click opens the band (state.usageBand), as a reading that fails does. Not `busy`: it changes nothing, so the
 * page stays usable meanwhile. An answer for a home switched meanwhile is dropped (accept resets the slot). A reading that lands
 * moves no row: once its answer is known to be kept, the list on screen is held where it is (matrix.ts holdOrder), then the slot takes it.
 */
export async function collectUsage({ asked = false } = {}) {
  const home = state.home?.home;
  if (!home) return;
  if (!asked && !windowShown) return;
  if (asked) state.usageBand = true;
  const reading = readPageData(state.usage, () => api().readUsage(home), holdOrder);
  rerender();
  const landed = await reading;
  if (landed === 'failed') state.usageBand = true;
  if (landed !== 'dropped') rerender();
}

/**
 * The rows to flash on their next draw, by row id (itemrow.ts rowId), each with the time its ask lapses: a click's, an Undo's or
 * a Restore's waits for the row's next draw whenever it comes (flashRow); a notice's lapses after 3 s (askFlash, from matrix.ts
 * syncNotice). matrix.ts takeFlash reads it.
 */
export const flashRequests = new Map<string, number>();
/** The row flashes on its next draw. */
const flashRow = (row: RowKey) => { if (row.key) flashRequests.set(rowId(row.kind, row.key), Infinity); };
/** Asks for row `id` to flash on a draw before `until`: an ask already there that has not lapsed stays; a lapsed one gives way. */
export const askFlash = (id: string, until: number) => { if (!((flashRequests.get(id) ?? 0) > Date.now())) flashRequests.set(id, until); };

// ---------- One switch per item ----------

/**
 * One click on an item list: the changes it makes, the item names it concerns, and what the result says it did. A click is one
 * kind's: `kind` is the engine its changes are sent to, and each of `rows` is of it, both made from the same row(s) where it
 * names any (Turn these off makes one click per kind: matrix.ts turnTheseOff); `items` names its `rows`, in their order.
 */
export interface Click {
  kind: PageKind;
  changes: Change[];
  items: string[];
  /**
   * What was done, as the result's sentence ("notes is on in all 3 tools"); as a function, given the tools where the click's
   * write failed or was held, so it never claims those, and the tools it wrote.
   */
  said: string | ((notIn: HarnessId[], wrote: HarnessId[]) => string);
  /** Said as one of its reasons, a problem line: what the click left as it is, and why ("Still on in Codex: its settings file can’t be read."). */
  also?: string;
  /**
   * The rows it is about, by kind and key, which flash once it or its Undo is done: its row (a plugin's row by its own key,
   * `plugin@marketplace/name`), every row Turn these off takes; none for Resume.
   */
  rows: RowKey[];
  /** An Undo: its result is said for a few seconds, with no Undo of its own. */
  undoing?: boolean;
  /** Its row's own control as the page draws it now (its switch, or Add while the item is found): the focus goes there once the click, or its Undo, is done. */
  focus?: () => string;
  /** A click on many rows at once (Turn these off): once it, or its Undo, is done, every pinned row is let go, so each takes its own group. */
  regroups?: boolean;
  /**
   * Its part in the tools that have the item through a plugin (pluginswitch.ts turnEvery): run once the copies' part went
   * through, never beside a click refused as a whole; or, with no `changes`, all of it (a plugin's own row, a tool's switch for a
   * plugin's item: carryOut). `said`: what that part brought with it, said when it all worked.
   */
  plugins?: { ops: PluginOp[]; said?: string };
  /** A click of its `plugins` part alone, with no change of the person's own (a plugin's own row, a tool's switch for a plugin's
   * item): carryOut runs only those switches (switchesOnly); `undone` is what its Undo says once done ("Undone: triage is back on in Codex."). */
  pluginsOnly?: boolean;
  undone?: string;
}

/** Each kind's own: how its changes are sent, and where its last result is kept. Its items are itemrow.ts kindSource's. */
const kindPages: Record<PageKind, { send: (changes: Change[], resume: boolean, home: string) => Promise<PassResult>; keep: (results: DestinationResult[], notices?: SyncNotice[]) => void }> = {
  skills: { send: (...args) => api().applySkills(...args), keep: (results, notices) => { state.skillsResult = { results, writes: 0, notices }; } },
  mcp: { send: (...args) => api().applyServers(...args), keep: (results, notices) => { state.mcpResult = { results, writes: 0, notices }; } },
  agents: { send: (...args) => api().applyAgents(...args), keep: (results, notices) => { state.agentsResult = { results, writes: 0, notices }; } },
};
/** Each kind's last click's result, as kindPages keeps it: what its problem lines and notices read (matrix.ts listResult, listNotices). */
export const lastResult = (kind: PageKind): PassResult | undefined => ({ skills: state.skillsResult, mcp: state.mcpResult, agents: state.agentsResult })[kind];

/**
 * Whether a click in this home is a Resume: the page shows it waiting for one (share.ts libraryGate `resume`). Sent with the
 * clicks that resume such a home, as Resume itself does: an item list's clicks (first setup's walkthrough's too), a tool's
 * Manage switch, Take over and Clear the switch. History's actions, a profile switch and Synchronize
 * everything's switch send nothing, and are refused there until Resume.
 */
export const clickResumes = (home: HomeView) => home.sync.gate.state === 'needs-resume';
/** Sends one kind's changes for the open home. */
const send = (kind: PageKind, changes: Change[]) => kindPages[kind].send(changes, clickResumes(state.home!), state.home!.home);

/**
 * What one click did, once carried out (carryOut): its result as the page it was made on says it (`outcome`), whether it changed
 * anything, its own results for its kind's problem lines (lastResult; none for a click of `plugins` alone), where the focus goes
 * (its control as now drawn), and what a run's one Undo takes back of it (`undo`: none when it has no Undo).
 */
export interface Done {
  outcome: Outcome;
  did: boolean;
  /** Why it did nothing, where it was refused whole or stopped: its outcome's text then (applyByKind names its kind by it). */
  refused?: string;
  /** The tools its words never claim (carryOut): where its write failed or was held, or its plugins' switch didn't go through. */
  notIn?: HarnessId[];
  /** The rows it changed (carryOut): all of its rows but one whose own change was refused whole (clickplan.ts heldWhole). */
  changed?: NamedRow[];
  kept?: { kind: PageKind; results: DestinationResult[]; notices?: SyncNotice[] };
  focus?: string;
  undo?: Undoable;
  /** What its plugins' part brought with it (pluginswitch.ts alongWords), said in a run's result too. */
  along?: string;
}

/**
 * One click carried out, for the page it was made on: an item's switch, or one tool's control in its details, sent to its
 * kind's engine, the home read again, then its part in the tools that have it through a plugin; or a click of that part alone
 * (switchesOnly). Its result says what was done, or why nothing was. Its one Undo reverses exactly what the click did: the
 * History entries the click itself made (never what sync did alongside), each by its own action (historyactions.ts).
 */
async function carryOut(click: Click, page: Page): Promise<Done> {
  if (click.pluginsOnly) return switchesOnly(click, click.plugins?.ops ?? [], page);
  const names = [...click.items, ...click.changes.map(change => change.key)];
  // Any click is a pass, even with no change (Resume).
  const result = await send(click.kind, click.changes);
  setHome(await api().refresh());
  const { ours, did, refusal, failed, differs, notIn } = clickResults(result.results, names);
  // A refusal is the click's result, or else one of its reasons: said once, not again among the failures.
  const kept = { kind: click.kind, results: ours.filter(entry => entry !== refusal), notices: result.notices };
  if (result.stopped) return { kept, did: false, refused: result.stopped, changed: [], outcome: { page, items: click.items, rows: click.rows, warn: true, band: true, text: result.stopped } };
  const made = result.made ?? [];
  // The plugins' part, once the copies' part went through (a whole-click refusal leaves it unrun).
  const plugged = click.plugins?.ops.length && (did || made.length || !refusal) ? await runSwitches(click.plugins.ops) : undefined;
  if (plugged) setHome(await api().refresh());
  const done = did || made.length > 0 || !!plugged?.done.some(entry => succeeded(entry.report));
  // Said from what happened: a tool whose write failed, copy or plugin switch, is not called on (or off).
  const wrote = [...new Set(ours.filter(entry => entry.outcome === 'written' && entry.harness).map(entry => entry.harness!))];
  const notClaimed = [...notIn, ...(plugged?.failedIn ?? [])], held = new Set(ours.filter(heldWhole).map(entry => entry.item.toLowerCase()));
  const changed = click.rows.map((row, at) => ({ ...row, name: click.items[at] ?? row.key })).filter(row => !held.has(row.name.toLowerCase()));
  const said = typeof click.said === 'string' ? click.said : click.said(notClaimed, wrote);
  const choose = differs ? ' Its copies differ: choose which copy every tool uses.' : '';
  const along = plugged && !switchProblems(plugged) ? click.plugins?.said : undefined;
  const text = done || !refusal ? [said, along].filter(Boolean).join(' ') + choose : refusal.message;
  const back = plugged?.back ?? [];
  const undo = !click.undoing && done && ((made.length && await allUndoable(made)) || back.length) ? { kind: click.kind, made, back } : undefined;
  const warned = failed || !!plugged?.failed.length || !!plugged?.stopped;
  return { kept, did: done, refused: done || !refusal ? undefined : refusal.message, notIn: notClaimed, changed, undo, along, focus: click.focus?.(),
    outcome: { page, items: click.items, rows: click.rows, warn: warned || !!click.also || !!refusal, band: true, fade: click.undoing && !warned,
      text, reasons: [...(done && refusal ? [refusal.message] : []), ...switchReasons(plugged, click.also)], act: undo && { label: 'Undo', id: 'outcome-undo', inHistory: !back.length, title: 'Put back everything this did', run: () => void undoClick({ rows: changed, focus: click.focus, regroups: click.regroups }, [undo]) } } };
}

/**
 * A click of `plugins` alone (a plugin's own row, a tool's switch for a plugin's item in an opened row): each tool's own switch,
 * then the home read again. It did something only where a step went through; its Undo runs what it changed, reversed, and says
 * `undone`.
 */
async function switchesOnly(click: Click, ops: PluginOp[], page: Page): Promise<Done> {
  const ran = await runSwitches(ops, click.undoing);
  setHome(await api().refresh());
  const worked = !ran.failed.length && !ran.stopped, said = typeof click.said === 'string' ? click.said : click.said([], []);
  const text = (worked && said ? [said, click.plugins?.said].filter(Boolean).join(' ') : resultSentence(ran.lines, !!click.undoing)) || `${click.items.length ? `${fewNames(click.items)}: n` : 'N'}othing changed.`;
  const undo = ran.back.length ? { kind: click.kind, made: [], back: ran.back } : undefined;
  const back = { kind: click.kind, items: click.items, rows: click.rows, changes: [], said: click.undone ?? '', undoing: true, pluginsOnly: true, plugins: { ops: ran.back } };
  return { did: ran.done.some(entry => succeeded(entry.report)), along: worked ? click.plugins?.said : undefined, undo,
    outcome: { page, items: click.items, rows: click.rows, text, reasons: switchReasons(ran, click.also), warn: !worked || !!click.also, band: true, fade: click.undoing && worked,
      act: undo && { label: 'Undo', id: 'outcome-undo-plugin', title: 'Turn them back as they were', run: () => void applyClick(back) } } };
}

/** A click applied at once, under busy: one tool's control in an opened row, Delete, Make current, Resume, a copy chosen (Turn these off: applyByKind). */
export const applyClick = (click: Click) => busy(click.undoing ? 'Undoing…' : 'Applying…', async page => sayDone(await carryOut(click, page), click));
/** What a click applied at once did, said in the header (renderer.ts resultHere) or its band, its rows flashed, the focus on its control. */
function sayDone(done: Done, click: Click) {
  if (done.kept) kindPages[done.kept.kind].keep(done.kept.results, done.kept.notices);
  tell(done.outcome);
  focusAfterBusy = done.focus;
  for (const row of click.rows) flashRow(row);
}

/**
 * One click over rows of several kinds (Turn these off: matrix.ts turnTheseOff): `clicks`, one per kind, carried out kind by
 * kind in turn under one busy, each through its kind's engine (carryOut). A kind's click refused whole (its own record stops its
 * writes, say) is skipped, and said as a problem line (words.ts saidByKind); the others go on. Its result belongs to the page it was clicked
 * on (busy). `said`: what was done, given the rows that changed (a row whose own change was refused, a stale one, is none: Done
 * changed) and the tools their words can't claim; with none changed, the refusals are its words. Its result names the rows that
 * changed, and only they flash; one Undo, only when every click that changed something has one, puts them back (undoClick).
 */
export const applyByKind = (clicks: Click[], said: (changed: NamedRow[], notIn: HarnessId[]) => string) => busy('Applying…', async page => {
  const several = new Set(clicks.map(click => click.kind)).size > 1, parts: { click: Click; done: Done }[] = [];
  for (const click of clicks) parts.push({ click, done: await carryOut(click, page) });
  const went = parts.filter(part => !part.done.refused), did = parts.filter(part => part.done.did), changed = parts.flatMap(part => part.done.changed ?? []);
  const stops = saidByKind(parts.flatMap(part => (part.done.refused ? [[part.click.kind, part.done.refused] as [PageKind, string]] : [])), several);
  const undos = did.flatMap(part => (part.done.undo ? [part.done.undo] : [])), regroups = clicks.some(click => click.regroups);
  const undo = did.length && undos.length === did.length ? () => void undoClick({ rows: changed, regroups }, undos) : undefined;
  for (const { done } of parts) if (done.kept) kindPages[done.kept.kind].keep(done.kept.results, done.kept.notices);
  tell({ page, items: rowNames(changed), rows: changed, band: true, warn: parts.some(part => part.done.outcome.warn),
    text: changed.length || !stops.length ? said(changed, went.flatMap(part => part.done.notIn ?? [])) : stops.join(' '),
    reasons: [...(changed.length ? stops : []), ...went.flatMap(part => part.done.outcome.reasons ?? [])],
    act: undo && { label: 'Undo', id: 'outcome-undo', inHistory: undos.every(each => !each.back.length), title: 'Put back everything this did', run: undo } });
  for (const row of changed) flashRow(row);
  if (regroups) unpin();
});

/**
 * An item list's click in the page's list (clicklist.ts): its row's name, the page it was made on (its run's place says which
 * table there: placeNow), whether its row is On now (`isOn`, read from the view), and once carried out, what it did.
 */
interface ItemTurn extends Turn { row: NonNullable<Turn['row']>; name: string; page: Page; isOn: () => boolean | undefined; done?: Done }
const isItemTurn = (turn: Turn): turn is ItemTurn => 'isOn' in turn;
/**
 * Where the page is now, as a run names its place: the page, and on Harnesses the tool whose page is open and the kind its tab
 * shows (each tab has a header of its own). The Library is one place for every kind, whatever its kind switch shows: clicks on a
 * skill, a server and an agent there are one run with one result and one Undo, and the segment changed mid-run changes nothing. A row's click is made on the table on screen, so its place is this when it is made;
 * a press is matched to the control a redraw put in its place only here (renderer.ts, dom.ts keepClicksAcrossRedraws).
 */
export const placeNow = () => (state.page === 'harnesses' ? `harnesses ${state.harness ?? ''} ${harnessKindShown() ?? ''}` : state.page);
const itemTurns = (run: Run) => clickList.turns.filter((turn): turn is ItemTurn => isItemTurn(turn) && turn.run === run);

/**
 * A row's switch or Add on an item list (matrix.ts flip, pluginRowSwitch): its click joins the page's list and is carried out in
 * its turn, worked out then from the view as it is (`make`; none when nothing is left to change), so the page stays live
 * meanwhile. Its row is drawn in the state it asks for at once (clicklist.ts wantedOn). It joins the run on its table's place, or
 * starts one (clicklist.ts runAt); the run's clicks are said as one result (sayRun).
 */
export function queueClick(row: ItemTurn['row'], name: string, make: () => Click | undefined, isOn: ItemTurn['isOn']): void {
  const turn: ItemTurn = { state: 'waiting', row, name, page: state.page, isOn, run: runAt(placeNow()), work: async () => {
    const click = make();
    // Nothing left to change in its turn (the click before it took its whole plugin with it, say): as asked already.
    if (!click) turn.done = { did: false, outcome: { page: turn.page, items: [name], rows: [row], text: `${name}: nothing left to change.` } };
    else turn.done = await carryOut(click, turn.page).catch((): Done => ({ did: false, outcome: { page: turn.page, items: [name], rows: [row], warn: true, band: true, text: `${name}: ${couldNotFinish()}` } }));
    sayRun(turn);
  } };
  join(turn);
  rerender();
}

/**
 * After each click of a run, the run said as one result where it was made (one click alone: its own result), its row flashed,
 * and its control as now drawn (Add gives way to the switch) given back the focus a redraw lost; while another place is open,
 * only the status bar says it.
 */
function sayRun(turn: ItemTurn) {
  const done = turn.done!, turns = itemTurns(turn.run);
  const outcome = turns.length === 1 ? done.outcome : runOutcome(turns);
  if (placeNow() !== turn.run.place) { announce(spoken(outcome)); return; }
  // Each kind's results are its own: its problem lines come from the run's clicks of that kind.
  const kind = done.kept?.kind;
  if (done.kept) kindPages[done.kept.kind].keep(turns.flatMap(each => (each.done?.kept && each.done.kept.kind === kind ? each.done.kept.results : [])), done.kept.notices);
  tell(outcome);
  flashRow(turn.row);
  if (done.focus && document.activeElement === document.body) document.getElementById(done.focus)?.focus({ preventScroll: true });
}

/**
 * A run's clicks, said once: its rows by how they are now ("3 skills are off: a, b and c"; of several kinds, "3 items are off:
 * review (skill), review (agent) and github", words.ts rowNouns and rowNames; a row clicked twice once, by its kind and key, and
 * one with nothing left to change counted as asked), how many clicks are still to go, and what came with each; what each could
 * not do as problem lines (one refused or failed whole: its own sentence and reasons); one Undo for the clicks that did
 * something, when each has one (undoClick: every History entry and plugin switch they made, newest first).
 */
function runOutcome(turns: ItemTurn[]): Outcome {
  const ended = turns.filter(turn => turn.done), did = ended.filter(turn => turn.done!.did), toGo = turns.length - ended.length;
  const asked = ended.filter(turn => turn.done!.did || !turn.done!.outcome.warn), nouns = rowNouns(turns.map(turn => turn.row.kind));
  const rows = asked.filter(turn => asked.findLast(other => sameRow(other.row, turn.row)) === turn);
  // A kind is named where a row of another kind in the run has the same name.
  const named = (turn: ItemTurn): NamedRow => ({ kind: turn.row.kind, key: turn.row.key, name: turn.name }), among = turns.map(named);
  const said = [false, true].map(on => rowNames(rows.filter(turn => (turn.isOn() ?? turn.row.on) === on).map(named), among))
    .map((names, on) => (names.length ? `${plural(names.length, nouns.one, nouns.many)} ${names.length === 1 ? 'is' : 'are'} ${on ? 'on' : 'off'}: ${fewNames(names)}` : '')).filter(Boolean).join('; ');
  const along = did.flatMap(turn => (turn.done!.along ? [`${rowNames([named(turn)], among)[0]}: ${turn.done!.along.replace(/^./, first => first.toLowerCase())}`] : []));
  const undos = did.flatMap(turn => (turn.done!.undo ? [turn.done!.undo] : [])).reverse();
  const undo = did.length && undos.length === did.length ? () => void undoClick({ rows: did.map(named) }, undos) : undefined;
  return { page: turns[0]!.page, items: rowNames(among), rows: turns.map(turn => turn.row), band: true, warn: ended.some(turn => turn.done!.outcome.warn),
    reasons: ended.flatMap(turn => (asked.includes(turn) ? [] : [turn.done!.outcome.text]).concat(turn.done!.outcome.reasons ?? [])),
    text: [`${said || 'Nothing changed'}${toGo ? `; ${toGo} to go` : ''}.`, ...along].join(' '), act: undo && { label: 'Undo', id: 'outcome-undo', inHistory: undos.every(each => !each.back.length), title: 'Put back everything these clicks did', run: undo } };
}

/** Whether each History entry a click made still offers its own action, so the click's Undo can run them all. */
async function allUndoable(made: string[]) {
  const events = (await api().history()).events.filter(event => made.includes(event.id));
  const about = entriesNow(state.home!);
  return events.every(event => !libraryEntry(event) || !!libraryAction(event, about(event).item, about(event).now));
}

/** What an Undo puts back: the rows its clicks changed (named in its result and flashed once it is done), where the focus goes, and whether every pinned row is let go. */
interface UndoOf { rows: NamedRow[]; focus?: () => string; regroups?: boolean }
/** What one click can take back (Done undo): its kind, the History entries it made, and the plugin switches that turn its plugins' part back. */
interface Undoable { kind: PageKind; made: string[]; back: PluginOp[] }

/**
 * Undo of one click, or of several as one (a run, Turn these off): their plugin items' switches first, then every History entry
 * they made, newest first, each by its own action (historyactions.ts). An entry History no longer holds, or one whose Undo is
 * stopped (its kind's record, say), is said once as a problem line (words.ts saidByKind: led by its kind where the Undo spans several), and
 * the later entries of a stopped kind are left; the other kinds' still go back, and the result names them. Each kind's last result
 * becomes what its own entries' Undo did.
 */
const undoClick = (about: UndoOf, parts: Undoable[]) => busy('Undoing…', async page => {
  const home = state.home!, several = new Set(parts.map(part => part.kind)).size > 1;
  // The plugin items' switches go back first: other tools than the copies', so the rest is undone whatever they do.
  const switchedBack = parts.flatMap(part => part.back);
  const unswitched = switchedBack.length ? await runSwitches(switchedBack, true) : undefined;
  const kindOfEntry = new Map(parts.flatMap(part => part.made.map(id => [id, part.kind] as const)));
  const events = (await api().history()).events.filter(event => kindOfEntry.has(event.id)).sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  const gone = [...kindOfEntry].filter(([id]) => !events.some(event => event.id === id));
  const results = new Map(parts.map(part => [part.kind, [] as DestinationResult[]])), stops = new Map<PageKind, string>();
  for (const event of events) {
    const kind = kindOfEntry.get(event.id)!;
    if (stops.has(kind)) continue;
    const result = await api().restore(event.id, home.home);
    if (result.stopped) stops.set(kind, result.stopped); else results.get(kind)!.push(...result.results);
  }
  setHome(await api().refresh());
  focusAfterBusy = about.focus?.();
  await putHistory();
  for (const [kind, kept] of results) kindPages[kind].keep(kept, []);
  const missing = [...groupBy(gone, ([, kind]) => kind)].map(([kind, of]): [PageKind, string] =>
    [kind, `${plural(of.length, 'History entry', 'History entries')} it was to put back ${of.length === 1 ? 'is' : 'are'} no longer in History.`]);
  const reasons = [...saidByKind([...stops, ...missing], several), ...switchReasons(unswitched)], undone = !reasons.length && ![...results.values()].flat().some(keptBack);
  // What did go back, where some of it didn't: the rows of the kinds whose entries all went back as they were, and whose plugin
  // switches, if they had any to turn back, all went back too.
  const short = new Set([...stops.keys(), ...gone.map(([, kind]) => kind)]), names = (rows: NamedRow[]) => [...new Set(rowNames(rows, about.rows))];
  const switchesShort = new Set(unswitched && switchProblems(unswitched) ? parts.filter(part => part.back.length).map(part => part.kind) : []);
  const all = names(about.rows), asBefore = names(about.rows.filter(row => !short.has(row.kind) && !switchesShort.has(row.kind) && !results.get(row.kind)?.some(keptBack)));
  const are = (list: string[]) => `${fewNames(list)} ${list.length === 1 ? 'is' : 'are'} as before`;
  tell({ page, items: all, rows: about.rows, warn: !undone, band: true, fade: undone, reasons,
    text: undone ? `Undone: ${are(all)}.` : short.size ? `Not all of it could be undone${several && asBefore.length ? `; ${are(asBefore)}` : ''}.` : `Not all of ${fewNames(all)} could be put back.` });
  for (const row of about.rows) flashRow(row);
  if (about.regroups) unpin();
});

/** What a run of plugin switches couldn't do, in words ("issue-tracker: couldn’t turn it on in Codex."), or ''. */
const switchProblems = (ran: Awaited<ReturnType<typeof runSwitches>>) => [ran.stopped, ...ran.failed.map(line => `${line.plugin}: ${line.text.replace(/\.$/, '')}.`)].filter(Boolean).join(' ');
/** A click's reasons (Outcome) from its plugin switches' run: what it couldn't do, then `also`, what the click left as it is. */
const switchReasons = (ran: Awaited<ReturnType<typeof runSwitches>> | undefined, also?: string) => [ran ? switchProblems(ran) : '', also ?? ''].filter(Boolean);
/** The key under which a background pass's problem the person closed is remembered (state.dismissed). */
export const problemKey = (entry: DestinationResult) => `problem:${entry.of ?? ''}:${entry.item}:${entry.harness ?? ''}:${entry.message}`;

/**
 * Runs plugin switch choices (pluginswitch.ts) with each tool's own switch. A plugin that failed to come on leaves no item
 * switched off for it: those written before it are put back. Returns what ran, in lines, the tools where something didn't,
 * and the choices that turn it all back.
 */
async function runSwitches(ops: PluginOp[], undo = false) {
  // A plugin changes here as it does on its own page: the Plugins list's rows from before are no longer true (pluginstate.ts).
  endListNews();
  const home = state.home!.home;
  const plan = { install: api().installPlugin, uninstall: api().uninstallPlugin, setSkill: api().setPluginSkill, setPart: api().setPluginPart, setWhole: api().setPluginOn };
  const result = await runPlan(ops, plan, home);
  const strays = strayHolds(result.done);
  const putBack = strays.length ? (await runPlan(reverse(strays), plan, home)).done : [];
  const restored = strays.filter(stray => putBack.some(back => back.tool === stray.tool && back.plugin === stray.plugin && back.skill === stray.skill && back.part?.kind === stray.part?.kind && back.part?.name === stray.part?.name && succeeded(back.report)));
  const done = result.done.filter(entry => !restored.includes(entry));
  const lines = resultLines(done, undo);
  const ran = (op: PluginOp) => done.some(entry => entry.tool === op.tool && entry.plugin === op.plugin && succeeded(entry.report));
  const failedIn = [...new Set([...done.filter(entry => !succeeded(entry.report)).map(entry => entry.tool), ...ops.filter(op => !ran(op)).map(op => op.tool)])];
  return { done, lines, failed: lines.filter(line => !line.ok), failedIn, back: undo ? [] : reverse(done), stopped: result.stopped };
}

/**
 * What a read found, naming only the kinds a tool in that home can hold ("Read 1 skill and 0 MCP servers from pi-only."),
 * or that it found no tools at all. `from` names the home, for the status bar. "Nothing changed" means nothing was written.
 */
function readFound(view: HomeView, from?: string): string {
  if (!view.sync.managed.length) return noToolManagedSentence(view);
  // A plugin's items count as the pages list them.
  const found = { skills: view.skills.items.length + pluginItemCount(view, 'skills'), mcp: view.mcp.items.length + pluginItemCount(view, 'mcp'), agents: view.agents.items.length + pluginItemCount(view, 'agents') };
  const counts = heldKinds(view).map(kind => plural(found[kind], kindNouns[kind].one, kindNouns[kind].many));
  // A catch-up that copied something has its own Caught up band, and what sync did on its own (an edit spread, a deletion)
  // its notice: either is a change, so neither read says "Nothing changed".
  const caught = caughtUpNames(view).items.length > 0;
  const told = [view.skills.notices, view.mcp.notices, view.agents.notices].some(notices => notices.length > 0);
  return `Read ${andList(counts)}${from ? ` from ${from}` : ''}.${caught || told ? '' : ' Nothing changed.'}`;
}

/**
 * A home just opened, as its band says it: first a record taken over at its look (HomeView tookOver), so the band doesn't hide
 * it; an empty home (no tools, or nothing in them) says only that it opened; the page says the rest.
 */
const openedText = (view: HomeView) => [view.tookOver,
  !view.skills.items.length && !view.mcp.items.length && !view.agents.items.length ? `Opened ${view.label}.` : `Opened ${view.label}. ${readFound(view)}`].filter(Boolean).join(' ');

/** A read said in the status bar: what it found, and in which home. */
const readSummary = (view: HomeView) => readFound(view, view.label);

/**
 * The kinds the open home's tools can hold, as a sentence names them: "skills, MCP servers and agents", or, for `one` of
 * them, "skill, MCP server or agent". Empty in a home with no tool managed (noToolManaged).
 */
export function heldKindNames(count: 'all' | 'one' = 'all'): string {
  const held = state.home ? heldKinds(state.home) : [];
  return count === 'one' ? orList(held.map(kind => kindNouns[kind].one)) : andList(held.map(kind => kindNouns[kind].many));
}

/**
 * Opens another home: every switch (the sidebar's homes, Choose another home…, Go back to …) comes through here. A typed
 * base instructions draft belongs to the open home, so it is asked about first on the Instructions page, and nothing
 * switches. (A tool's draft is kept across the switch: the Instructions page offers to copy or discard it.)
 */
export const loadHome = (mode: HomeMode) => (baseDraftTyped() ? askBeforeLeaving() : openHome(mode));
function askBeforeLeaving(): Promise<void> {
  if (state.page !== 'instructions') showPage('instructions');
  askAboutBaseDraft();
  announce('Save or discard your base instructions draft before opening another home.');
  return Promise.resolve();
}
const openHome = (mode: HomeMode) => (state.lastMode = mode, busy(`Reading ${mode === 'fixture' ? 'the practice copy' : mode === 'actual' ? 'your real tools' : 'that folder'}…`, async () => {
  const previous = state.home;
  const view = await api().selectHome(mode);
  if (view && view.home !== previous?.home) { forgetRepoPrompts(true); forgetSourcePrompts(true); }
  // Sync follows the open home: leaving one with items On stops its syncing, so the band says so and offers the way back.
  const left = previous && view && previous.home !== view.home && anyOn(previous) ? previous : undefined;
  const leftText = left ? ` ${left.label} is not syncing while another home is open.` : '';
  if (!view) { announce(''); return; }
  const taken = accept(view);
  tell({ page: state.page, carry: true, text: openedText(taken) + leftText,
    act: left && left.mode !== 'custom' ? { label: `Go back to ${left.label}`, id: 'outcome-go-back', run: () => void loadHome(left.mode), whyOff: acting } : undefined });
}));

/** At launch: the home last opened (so sync resumes where it was), else this computer's home (dev builds: the practice copy). */
export const startHome = () => busy('Reading skills, MCP servers and agents…', async () => {
  const view = await api().startHome();
  // The first read is said the same way as a home switch: a band, not a passing status line.
  const practiceNote = view?.mode === 'fixture' && practiceNoteOpen();
  if (!view) { announce(''); return; }
  const taken = accept(view);
  if (practiceNote) announce(readSummary(taken), true);
  else tell({ page: state.page, carry: true, text: openedText(taken) });
});

/** Refresh: reads the home again, then the open page's own data (marketplaces anew), so all it shows is from this read. */
export async function readAgain() {
  let read = false;
  unpin();
  // What a list of plugin clicks said is not restated over a home read again.
  endListNews();
  await busy(noToolManaged() ? 'Reading…' : `Reading ${heldKindNames()}…`, async () => {
    const view = await api().refresh(true);
    if (!view) return;
    state.skillsResult = undefined;
    // Said first, so a page that leaves (setHome) adds its reason after what was read.
    setHome(view, { reload: false, say: taken => announce(readSummary(taken)) });
    read = true;
  });
  // Only a new read goes on to the page's own data: after a failure its message stays, and the page keeps what it showed.
  if (read) await loadPageData(state.page, { fresh: true, readId: state.home?.readId });
}

/** Why the open home can't be written now, if so: preview only (or held by another build), or its record stops every write. */
export const whyReadOnly = (home: HomeView) => (!home.sync.access.allowed ? home.sync.access.reason : home.sync.gate.state === 'stopped' ? home.sync.gate.reason : undefined);
/**
 * Why one kind's items can't be written now, if so, as every control of a row of that kind asks it: the home's reason, or that
 * kind's own record stopping its writes alone (its view's gate is the home's, or its record's stop: types.ts LibraryView gate).
 */
export const whyKindReadOnly = (home: HomeView, kind: PageKind) => whyReadOnly(home) ?? (home[kind].gate.state === 'stopped' ? home[kind].gate.reason : undefined);

/**
 * Reads what a page shows beyond the home itself: History, Settings, Instructions or Plugins, into its slot
 * (pagedata.ts), never as an action: the page says it is reading, and anything else can go on meanwhile. `fresh` reads
 * each marketplace anew.
 */
function loadPageData(page: Page, { fresh = false, readId }: { fresh?: boolean; readId?: number } = {}): Promise<void> {
  if (page === 'history') return loadHistory();
  if (page === 'settings') return loadSettings().then(() => undefined);
  if (page === 'instructions') return loadInstructions(readId);
  // Harnesses sums up each tool's instruction file and installs, as Instructions and Plugins read them. It only counts installs,
  // so its Refresh reads the tools again without fetching every marketplace anew (Plugins' Refresh does that).
  if (page === 'harnesses') return Promise.all([loadInstructions(readId), absentKinds().includes('plugins') ? undefined : loadPlugins(false, readId)]).then(() => undefined);
  if (page === 'plugins') return loadPlugins(fresh, readId);
  if (page === 'repo') return loadRepo(true);
  if (page === 'sources') return loadSources();
  return Promise.resolve();
}

/** When the open page's kind is no longer in this home (its last tool went), the Overview opens instead. */
function leaveAbsentPage() {
  const gone = absentKinds().find(kind => kind === state.page);
  if (!gone) return;
  // What the status bar said (a Refresh's summary, say) stays, with the reason the page moved.
  const said = state.said.text;
  showPage('overview');
  announce(`${said ? `${said} ` : ''}No tool here holds ${kindNames[gone]} now.`);
}

/** The tools Central Knot manages in the open home, as the main process decided them from the same read (presence.ts): every page but Harnesses names only these. */
export const homeTools = (): HarnessId[] => state.home?.sync.managed ?? [];

/** The kinds no tool in the open home can hold (presence.ts absentKindsIn); none before a home is read. */
export const absentKinds = (): HomeKind[] => (state.home ? absentKindsIn(state.home) : []);

/**
 * The open home has no tool Central Knot manages: none is installed, or every one is left out. Every page but Harnesses says
 * which (noToolManagedSentence) and offers the way on (pages.ts noToolsState). False before a home is read.
 */
export const noToolManaged = (): boolean => !!state.home && !homeTools().length;

/** Why a home has no tool managed, in one sentence: none installed, or the ones installed all left out (Harnesses' switches). */
export const noToolManagedSentence = (view: HomeView): string => (view.sync.present.length
  ? `Central Knot manages none of the tools here: ${toolList(view.sync.present)} ${view.sync.present.length === 1 ? 'is' : 'are'} left out.` : noToolsSentence);

/** The tools installed in the open home whose Manage switch is off: pages that say where an item is say "no tool Central Knot manages" while there are any. */
export const leftOutTools = (): HarnessId[] => (state.home ? state.home.sync.present.filter(tool => !state.home!.sync.managed.includes(tool)) : []);

/** The open home's tools by name, for sentences: "Claude Code and Codex". */
export const homeToolNames = (): string[] => homeTools().map(toolName);

/** The tools an action touched (ids), as a sentence names them in the open home: "all 3 tools" or their names. */
export const touchedToolsPhrase = (touched: string[]): string => toolsPhrase(touched, homeTools());

/** × on a result: it goes, and with it what its click could not do (the item lists' last click's problems). */
export function closeResult() { endRun(); state.outcome = undefined; state.skillsResult = state.mcpResult = state.agentsResult = undefined; rerender(); }

/**
 * Lets go of what the last action showed (its result, Apply results, the spoken line): for moving to another place.
 * A home switch's result survives one move, since switching is often followed by a click elsewhere; `page` is where it lands.
 */
export function leaveResults(page = state.page) {
  // Another page, or another tool's page, ends the run of clicks (clicklist.ts).
  endRun();
  const carried = state.outcome?.carry ? { ...state.outcome, page, carry: false } : undefined;
  state.skillsResult = undefined; state.mcpResult = undefined; state.agentsResult = undefined;
  tell(carried);
}

export function showPage(page: Page) {
  // Plugins keep what they read while the person stays on them; every other page reads its data each time it opens.
  const stays = page === 'plugins' && state.page === 'plugins';
  // The sidebar's Harnesses opens the list of every harness, except while an action runs: its result belongs to the harness it
  // started on. Leaving a harness's page this way drops that page's result, as its own back arrow does.
  const leavingHarness = page === 'harnesses' && !state.busy && !!state.harness;
  // A new page starts clean: the last action's message and results belong to the page they happened on.
  if (page !== state.page || leavingHarness) leaveResults(page);
  if (page !== state.page) { state.skillsView = 'table'; state.visit += 1; forgetRepoPrompts(); forgetSourcePrompts(); }
  if (leavingHarness) state.harness = undefined;
  // Settings opens fresh (what its rows said last visit belongs to that visit); every other page reads its own data.
  state.page = page;
  if (page === 'settings') openSettings();
  else if (!stays) void loadPageData(page);
  state.find = '';
  state.item = undefined;
  rerender();
}

/** Leaves the Library's Files view for its list (its Back button, or Escape: matrix.ts backFromFiles, which puts its scroll back). */
export function showSkillsTable() {
  state.skillsView = 'table';
  state.item = undefined;
  rerender();
}

export function selectItem(key: string | undefined) {
  state.item = key;
  rerender();
  document.getElementById('detail-scroll')?.scrollTo(0, 0);
}

/** Reveals a file in the system file manager; nothing is opened or changed. */
export const showFile = (path: string) => void api().showFile?.(path);

/**
 * A path as the page shows it, shorter on screen only: inside the real home it starts at ~, inside the practice copy or a
 * chosen folder at "…". Copying and tooltips give the full path.
 */
export const shownPath = (path: string) => {
  const home = state.home;
  if (!home || (path !== home.home && !path.startsWith(`${home.home}/`))) return path;
  return `${home.mode === 'actual' ? '~' : '…'}${path.slice(home.home.length)}`;
};

// ---------- History ----------

/** Reads History (its events, and the window they cover, read together) into its slot; the page redraws once the answer is the newest. */
export const loadHistory = async (): Promise<void> => {
  let days: HistoryDays | undefined;
  const reading = readPageData(state.history, async () => { const list = await api().history(); days = list.days; return list.events; });
  rerender();
  const result = await reading;
  if (result === 'dropped') return;
  if (result === 'ready') state.historyDays = days;
  rerender();
};

/** History as an action read it, after what it changed: its events and window, the newest. */
async function putHistory() {
  const { events, days } = await api().history();
  putPageData(state.history, events);
  state.historyDays = days;
}

/** A History entry's action: Undo, Restore, or one of its choices; what it did is said in the band, with its own way back. */
export const restoreEvent = (eventId: string, choice?: string) => busy('Restoring…', async page => {
  const home = state.home!;
  // A Restore of Synchronize everything's Undo: whether it switches the rule on again, as its plan says before the click (the
  // one place that decides it: historyactions.ts restorePlan), for the words after it.
  const clicked = state.history.data?.find(event => event.id === eventId);
  const switchesOn = !!clicked?.everything?.undo && !!state.history.data && restorePlan(clicked, state.history.data, entriesNow(home)).switchOn;
  const result = await api().restore(eventId, home.home, choice);
  // The notice for an undone event has done its job; its result band says what happened.
  if (!result.stopped) state.dismissed.add(eventId);
  const view = await api().refresh();
  setHome(view);
  await putHistory();
  // A source's band offers its click's Undo (sourcespage.ts whatItDid): its rows say what waits there now.
  if (state.page === 'sources') await loadSources();
  const restored = result.results.filter(entry => entry.outcome === 'written');
  const where = [...new Set(restored.map(entry => entry.harness ?? ''))].filter(Boolean);
  const past = state.history.data?.find(event => event.id === eventId);
  // An Undo of a profile switch lists what it couldn't change in its own band, so the page's problems band gets only a stop.
  // Synchronize everything's covers every kind: its band says what it couldn't do (sayEverything), no page's problems band.
  if ((past?.kind !== 'profile' && past?.kind !== 'everything') || result.stopped) kindPages[(past && libraryEntry(past)?.kind) || 'agents'].keep(result.results, result.notices);
  if (past?.kind === 'profile') {
    // Each item it turned back has its own History entry, with its own action: the band offers no Undo of the Undo.
    if (result.stopped || !result.switched) tell(undefined, result.stopped); else turnedOutcome(page, 'Undone', result.switched, result.results);
    return;
  }
  const everywhere = touchedToolsPhrase(where);
  // A Pull's edit or deletion of the base instructions: its Undo has no event of its own to offer again.
  if (past?.base) {
    tell(result.stopped ? undefined : { page, item: past.item, text: result.results.map(entry => entry.message).join(' ') }, result.stopped);
    return;
  }
  if (past && libraryEntry(past)) { sayLibraryAction(page, past, result); return; }
  if (past?.kind === 'everything') { sayEverything(page, past, result, switchesOn); return; }
  // A Pull's change to an agent's Claude Code settings alone (gitrepo.ts undoSettingsChange): the one entry with an Undo of its own,
  // an agent's (its row flashes on Agents).
  const item = restored[0]?.item ?? past?.item ?? '', row = { kind: 'agents' as const, key: itemKey(item) };
  const done = !result.stopped && restored.length > 0;
  tell(done ? { page, item, rows: [row], history: true, text: `Undid the change to ${item}. The earlier version is back in ${everywhere}.` } : undefined, result.stopped ?? `Restored in ${plural(0, 'tool')}.`);
  if (done) flashRow(row);
});

/**
 * After a History action on a library item, a skill, an MCP server or an agent (historyactions.ts): what it did, in the words of the entry
 * it made, with that entry's own action as the way back. A refusal is said on the page, where the action was clicked.
 */
function sayLibraryAction(page: Page, past: HistoryEvent, result: ApplyResult) {
  const entry = libraryEntry(past)!, rows = [entry];
  if (result.stopped) { tell({ page, item: past.item, rows, text: result.stopped, warn: true, history: true }); return; }
  const view = state.home?.[entry.kind];
  const made = state.history.data?.find(event => event.id === past.undoneBy);
  const item = view?.library[entry.key];
  const said = made && librarySentence(made, libraryWords[entry.kind], view?.tools ?? [], item, true)?.text;
  const back = made && libraryAction(made, item, entriesNow(state.home!)(made).now);
  const notDone = result.results.filter(keptBack).map(entry => entry.message);
  const text = [`${past.item}: ${said ? said.replace(/^./, first => first.toLowerCase()) : 'done.'}`, ...notDone].join(' ');
  tell({ page, item: past.item, rows, warn: notDone.length > 0, text, undo: back && made ? { id: made.id, label: back.label } : undefined });
  flashRow(entry);
}

/**
 * After Synchronize everything's one Undo, or that Undo's Restore (everything.ts everythingEntryAction): what it did, in the Undo's
 * entry's words, or what the Restore put back; what it could not do after it, each sentence once. Which it was is the entry clicked:
 * an Undo's entry (`undo`) offers the Restore, a switch-on the Undo. `switchedOn`: the Restore switched the rule on again
 * (restoreEvent, from restorePlan before the click); a switch made in Settings since is not its doing.
 */
function sayEverything(page: Page, past: HistoryEvent, result: ApplyResult, switchedOn: boolean) {
  if (result.stopped) { tell({ page, item: past.item, text: result.stopped, warn: true, history: true }); return; }
  const made = (result.made ?? []).map(id => state.history.data?.find(event => event.id === id));
  const text = everythingDone(past, made, made.filter(event => event?.kind === 'restored').length, switchedOn);
  const notDone = [...new Set(result.results.filter(keptBack).map(entry => entry.message))];
  tell({ page, item: past.item, warn: notDone.length > 0, history: true, text: [text, ...notDone.slice(0, 3)].join(' ') });
}

// ---------- A skill's own two actions ----------

/**
 * A skill's two actions a click on its row can't carry (skills.ts clearSwitch, takeOver): a tool's own switch cleared, or a copy
 * outside Central Knot's taken over. What it did is said in the band, with no Undo there: Take over has none (the band and its
 * History entry say so); a cleared switch's Undo is its History entry's action (skills.ts switchBack).
 */
export const skillAction = (action: 'clear-switch' | 'take-over', key: string, tool: HarnessId, name: string) =>
  busy(action === 'take-over' ? 'Taking it over…' : 'Clearing the switch…', async page => {
    const home = state.home!;
    const result = await (action === 'take-over' ? api().takeOverSkill(key, tool, clickResumes(home), home.home) : api().clearSkillSwitch(key, tool, clickResumes(home), home.home));
    setHome(await api().refresh());
    kindPages.skills.keep(result.results, result.notices);
    const row = { kind: 'skills' as const, key };
    if (result.stopped) { tell({ page, item: name, rows: [row], text: result.stopped, warn: true, band: true }); return; }
    // Letting a tool load it again has an Undo (its History entry's: the switch set again); a take-over has none, and says so.
    const said = `${name}: ${result.results[0]?.message ?? 'done.'}${action === 'take-over' ? ' This has no Undo.' : ''}`;
    const entry = action === 'clear-switch' ? result.made?.[0] : undefined;
    tell({ page, item: name, rows: [row], band: true, text: said,
      act: entry ? { label: 'Undo', id: 'outcome-undo', inHistory: true, title: `Turn ${name} off again in ${toolName(tool)}’s own settings`, run: () => void restoreEvent(entry) } : undefined });
    flashRow(row);
  });

// ---------- Results ----------

/** What an action did: its sentence, the items it names, and what it offers next (its own button, Undo, or History). */
export interface Outcome {
  page: Page;
  /** What happened and where, with no reason in it. */
  text: string;
  /** Why some of it wasn't done: each said once, as a problem line under `text` (matrix.ts listResult). */
  reasons?: string[];
  /** Something was left undone: a warning icon, not a tick. */
  warn?: boolean;
  note?: string;
  /** The names it says, for its words alone (bold in its band, and where its Undo moved to: undoMoved), each with its kind where another kind's has its name (words.ts rowNames): `rows` is whose it is. */
  item?: string;
  items?: string[];
  /** The rows it is about: an open copy question of one of them, or the Files view of another skill, hides it (matrix.ts outcomeShown). */
  rows?: RowKey[];
  /** Said again on the next page opened (a home just opened). */
  carry?: boolean;
  /** A saved instruction goes on its card (instructionspage.ts); a Sync once result makes room for its lines. */
  kind?: 'saved' | 'sync-once';
  tool?: HarnessId;
  history?: boolean;
  /** Shown as a band even with nothing to offer: a click's result, which belongs where the click's Undo would be. */
  band?: boolean;
  /** The band goes after a few seconds: an Undo's confirmation. */
  fade?: boolean;
  undo?: { id: string; label: string };
  act?: {
    label: string; id: string; run: () => void; title?: string;
    /** History offers this entire Undo, including every click in a run. */
    inHistory?: boolean;
    /** Why it is off now, asked at each drawing (a home's Go back while the page acts). */
    whyOff?: () => string | undefined;
  };
  /** A second button after `act`: the next step the result offers (the whole plugin's switch, "Turn its plugins off in Codex"). */
  next?: { label: string; id: string; run: () => void; title?: string };
  /** When it was said (state.said.seq): a result newer than a table's pending changes still shows there. */
  said?: number;
}

/**
 * Whether a result is said in the status bar rather than as a band: it offers nothing to do (no button, Undo or History
 * link), so it needs no room of its own.
 */
export const saidInStatusBar = (outcome: Outcome): boolean => !(outcome.act || outcome.undo || outcome.history || outcome.note || outcome.band);

// ---------- Instructions ----------

/** The open draft holds changes not saved anywhere. */
export const draftUnsaved = (): boolean => unsaved(state.instructionEdit);

/** The file the open draft belongs to, while it is on the page: the same home and the same tool. */
export const draftFile = (): InstructionFile | undefined => {
  const edit = state.instructionEdit;
  return edit && edit.from.home === state.home?.home ? state.instructions.data?.find(file => file.tool === edit.tool) : undefined;
};

/** Every draft that replaces the open one comes through here: one with unsaved changes stays, and the page says why. */
function openDraft(file: InstructionFile, text: string, stage: InstructionDraft['stage'], restoring = false, takeOut = false): boolean {
  // A whole-file draft (an earlier version, a block taken out) starts from the whole file; an edit, from the tool's own text.
  const from = restoring ? file.text : ownText(file);
  const next = nextDraft(state.instructionEdit, { tool: file.tool, from: { home: state.home!.home, path: file.path, text: from }, text, hash: file.hash, stage, restoring, takeOut });
  if (next.refused) announce('Your unsaved instructions draft is still open. Save, copy or discard it first.');
  state.instructionEdit = next.draft;
  return !next.refused;
}

/**
 * Once the files are read, a draft with nothing unsaved follows them: dropped when its file is gone (its tool left the home),
 * and moved on to the file as it is now when it changed outside, so it never offers to put the old text back.
 */
const settleDraft = () => {
  const edit = state.instructionEdit;
  if (!edit || draftUnsaved()) return;
  const file = draftFile();
  if (!file) { state.instructionEdit = undefined; return; }
  if (file.hash === edit.hash) return;
  const text = edit.restoring ? file.text : ownText(file);
  Object.assign(edit, { from: { ...edit.from, path: file.path, text }, text, hash: file.hash });
};

/** Reads each tool's instruction file into its slot; the page redraws once the answer is the newest. */
export const loadInstructions = async (readId?: number): Promise<void> => {
  const reading = readPageData(state.instructions, () => readInstructionsAndBase(readId));
  rerender();
  const result = await reading;
  if (result === 'dropped') return;
  if (result === 'ready') settleDraft();
  rerender();
};

/** The files again after a save, as an action read them. */
const rereadInstructions = async () => { const files = await readInstructionsAndBase(); if (files) { putPageData(state.instructions, files); settleDraft(); } };

/** Each tool's instruction file, with the base read beside it (state.base). */
async function readInstructionsAndBase(readId?: number) {
  const [files, base] = await Promise.all([api().instructions(readId), api().instructionBase()]);
  state.base = base ?? undefined;
  return files;
}

/** A checked save of one file: it must still hold what was opened; the replaced text is kept as an earlier version. */
export const saveInstructionText = (file: InstructionFile, own: string) => busy('Saving…', async () => {
  // The result belongs to the page the save was started on (Instructions, or a harness's Instructions tab).
  const page: Page = state.page === 'harnesses' ? 'harnesses' : 'instructions';
  // A tool that gets the base is edited for its own text; its base block stays as it is in the file. Restoring an earlier version
  // puts the whole file back as it was, base block included; a version put back has its base copy judged again (main process).
  const edit = state.instructionEdit;
  const text = file.base && !edit?.restoring ? withOwn(file.text, own) : own;
  const result = await api().saveInstruction(file.tool, text, edit?.hash ?? file.hash, state.home!.home, !!edit?.restoring && !edit.takeOut);
  await rereadInstructions();
  const name = fileName(file.path);
  if (result.stopped) {
    state.outcome = undefined;
    const now = state.instructions.data?.find(entry => entry.tool === file.tool);
    // Changed outside: the draft stays, now checked against the file as it is, and the review compares with that.
    if (state.instructionEdit && now && now.hash !== state.instructionEdit.hash) {
      Object.assign(state.instructionEdit, { hash: now.hash, stage: 'review', conflict: true });
      // Taking the block out applies to the file as it is now, so its own text changed outside is kept.
      if (state.instructionEdit.takeOut) state.instructionEdit.text = withoutBase(now.text);
      announce(`${name} changed outside Central Knot. Your draft is kept; review it against the current file.`); return;
    }
    announce(result.stopped); if (state.instructionEdit) state.instructionEdit.stage = 'edit'; return;
  }
  state.instructionEdit = undefined;
  // Undo is one click: the replaced text goes back through the same checked save, which keeps this version in turn.
  const saved = state.instructions.data?.find(entry => entry.tool === file.tool);
  const before = file.exists && result.saved ? file.text : undefined;
  tell({ page, item: name, kind: file.exists && result.saved ? 'saved' : undefined, tool: file.tool, text: result.saved ? `${file.exists ? 'Saved' : 'Created'} ${name}. ${file.exists ? '' : 'Central Knot doesn’t delete instruction files you keep; edit it here to change it. '}Start a new ${toolName(file.tool)} session to use the change.${result.problem ? ` ${result.problem}` : ''}` : `${name} already said that; nothing was written.`,
    act: before !== undefined && saved ? { label: 'Undo', id: 'outcome-undo-instruction', run: () => void undoInstruction(saved, before) } : undefined });
});

/** Puts back the text a save replaced: a checked save against what was just written. */
const undoInstruction = (file: InstructionFile, before: string) => busy('Undoing the save…', async () => {
  const page: Page = state.page === 'harnesses' ? 'harnesses' : 'instructions';
  focusAfterBusy = `ins-edit-${file.tool}`;
  // Like putting back a version: the base copy it held is judged again against the base texts Central Knot kept.
  const result = await api().saveInstruction(file.tool, before, file.hash, state.home!.home, true);
  await rereadInstructions();
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  tell(result.stopped ? undefined : { page, item: name, text: `${name} is back as it was before your save. The text you saved is under Earlier versions.` }, result.stopped);
});

/**
 * Focus in an editor once it is drawn (`id`: its text box, or a review's Save), with its card's head (`headId`, where its
 * actions are) and the box in view: when either is out of sight, the page scrolls the head to its top, and the box, sized to the
 * room under the head (editparts.ts), shows whole. With `caret` (where a click on the text landed) the caret goes there, and
 * the box scrolls within itself to show that line.
 */
function focusEditor(id: string, headId: string, caret?: number) {
  const target = document.getElementById(id), head = document.getElementById(headId), page = target?.closest('.scroll')?.getBoundingClientRect();
  if (!target || !head || !page) return;
  target.focus({ preventScroll: true });
  const box = target instanceof HTMLTextAreaElement && caret !== undefined ? target : undefined;
  // How far down the caret's line ends: the height of the text up to it in a one-row box, wrapped lines counted. Measured
  // before the page scrolls, since the box is briefly one row tall.
  let lineEnd = 0;
  if (box) {
    const [text, rows] = [box.value, box.rows];
    Object.assign(box, { value: text.slice(0, caret), rows: 1 });
    lineEnd = box.scrollHeight;
    Object.assign(box, { value: text, rows });
    box.setSelectionRange(caret!, caret!);
  }
  const shows = (element: Element) => { const edges = element.getBoundingClientRect(); return edges.top >= page.top - 1 && edges.bottom <= page.bottom + 1; };
  if (!shows(head) || !shows(target)) head.scrollIntoView({ block: 'start' });
  if (box) box.scrollTop = lineEnd > box.clientHeight ? lineEnd - box.clientHeight / 2 : 0;
}

/** Opens one file in the editor, the caret at `caret` when a click on its text opened it; any earlier result band belongs to
 *  the last task, not this one. */
export function startInstructionEdit(file: InstructionFile, caret?: number) {
  if (askAboutOpenDraft()) return;
  // A save on another card keeps its Undo there; any other result belongs to the last task.
  if (!(state.outcome?.kind === 'saved' && state.outcome.tool !== file.tool)) state.outcome = undefined;
  if (!openDraft(file, ownText(file), 'edit')) { rerender(); return; }
  state.baseEdit = undefined;
  rerender();
  focusEditor(`ins-text-${file.tool}`, `ins-head-${file.tool}`, caret);
}

/** Loads an earlier version into the editor; putting it back is an ordinary save, with its diff first. */
export const loadInstructionVersion = (file: InstructionFile, id: string) => askAboutOpenDraft() ? undefined : busy('Reading the earlier version…', async () => {
  focusAfterBusy = `ins-save-${file.tool}`;
  const text = await api().instructionVersion(file.tool, id);
  if (text === undefined) { announce('That version is no longer kept.'); return; }
  if (!openDraft(file, text, 'review', true)) return;
  state.baseEdit = undefined;
  state.outcome = undefined;
  announce('Review going back to the earlier version, then save to put it back.', true);
});

/** Saving this base draft would change the base: other text or tools than saved. Blank text with no saved base is nothing yet. */
const differsFromBase = (edit: BaseEdit) => {
  const saved = state.base?.text ?? '';
  if (!edit.text.trim() && !saved.trim()) return false;
  const tools = new Set(state.base?.tools ?? []);
  return edit.text !== saved || edit.tools.length !== tools.size || edit.tools.some(tool => !tools.has(tool));
};
/** Saving this base draft does something: it differs from the base, or it starts somewhere (a tool's text, a copy, a version). */
export const baseSaveDoesSomething = (edit: BaseEdit) => differsFromBase(edit) || !!edit.source;
/** The open base editor holds work someone typed or chose. A review that only shows something stored (an edited copy, an
 *  earlier version, putting the base back, an update) holds none; a draft a tool wrote took minutes to get, so it always counts. */
export const baseDraftTyped = () => { const edit = state.baseEdit; return !!edit && (edit.source?.kind === 'draft' || ((!edit.source || edit.source.kind === 'own') && differsFromBase(edit))); };
/** The open tool editor holds typed changes to that tool's own text (a stored version under review holds none). */
export const toolDraftTyped = () => !!state.instructionEdit && !state.instructionEdit.restoring && draftUnsaved();

/**
 * Whether the open editor (a tool's or the base's) holds typed changes. If so, it is asked about (Discard / Keep editing) and the
 * caller starts nothing: drafts are read live, since typing doesn't redraw the page.
 */
function askAboutOpenDraft(): boolean {
  const tool = state.instructionEdit;
  if (tool && draftFile() && toolDraftTyped()) {
    Object.assign(tool, { confirmDiscard: true, stage: 'edit' });
    rerender(); document.getElementById(`ins-keep-${tool.tool}`)?.focus(); return true;
  }
  return askAboutBaseDraft();
}
/** The same question for the base editor alone. */
function askAboutBaseDraft(): boolean {
  const base = state.baseEdit;
  if (!base || !baseDraftTyped()) return false;
  base.confirmDiscard = true;
  rerender(); document.getElementById(base.stage === 'review' ? 'base-review-keep' : 'base-keep')?.focus(); return true;
}

/** This home only shows its files: saving is off (writeAccess refuses it: preview only, or held by another build). */
export const savingOff = () => !!state.home && !state.home.sync.access.allowed;

/** Reviews taking a base block out of a tool's file (a tool no longer on the list); saving it is an ordinary checked save. */
export function startTakeOut(file: InstructionFile) {
  if (askAboutOpenDraft()) return;
  if (!openDraft(file, withoutBase(file.text), 'review', true, true)) { rerender(); return; }
  state.outcome = undefined;
  state.baseEdit = undefined;
  rerender();
  document.getElementById(`ins-save-${file.tool}`)?.focus();
}

// ---------- Base instructions ----------

const fileOf = (tool: HarnessId) => state.instructions.data?.find(file => file.tool === tool);
/** The files of these tools by name; a name two tools share (Codex's and Pi's AGENTS.md) says whose it is. */
const fileNames = (tools: HarnessId[]) => {
  const name = (tool: HarnessId) => { const file = fileOf(tool); return file ? fileName(file.path) : namedTools[tool]; };
  const shared = (tool: HarnessId) => (state.instructions.data ?? []).some(file => file.tool !== tool && fileName(file.path) === name(tool));
  return andList(tools.map(tool => (shared(tool) ? `${namedTools[tool]}’s ${name(tool)}` : name(tool))));
};

/** What an apply or undo left alone, said after what it did: for an apply, a copy of the base edited there; for an undo, a file
 *  changed since the save. */
function leftText(result: BaseResult, undoing = false) {
  const edited = result.left.filter(entry => entry.why === 'edited').map(entry => entry.tool);
  const failed = result.left.filter(entry => entry.why === 'failed').map(entry => entry.tool);
  const out = result.left.filter(entry => entry.why === 'left-out').map(entry => entry.tool);
  const one = edited.length === 1;
  return [edited.length ? ` ${fileNames(edited)} ${one ? 'was' : 'were'} left as ${one ? 'it is' : 'they are'}: ${undoing ? 'changed there since the save' : `${one ? 'its' : 'their'} copy of the base was edited there`}.` : '',
    failed.length ? ` ${fileNames(failed)} could not be written; nothing in ${failed.length === 1 ? 'it' : 'them'} changed.` : '',
    out.length ? ` ${fileNames(out)} ${out.length === 1 ? 'was' : 'were'} left as ${out.length === 1 ? 'it is' : 'they are'}: a tool left out of Central Knot here reads ${out.length === 1 ? 'it' : 'them'}.` : '',
    result.problem ? ` ${result.problem}` : ''].join('');
}

/** Opens the base in its editor (the caret at `caret` when a click on its text opened it); a clean tool editor closes, since
 *  only one thing is edited at a time. */
export function startBaseEdit(draft: Omit<BaseEdit, 'hash' | 'stage'> & { stage?: BaseEdit['stage'] }, caret?: number) {
  if (askAboutOpenDraft()) return;
  if (state.outcome?.kind !== 'saved') state.outcome = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  state.draftPick = undefined;
  state.baseEdit = { stage: 'edit', ...draft, hash: state.base?.hash ?? '' };
  rerender();
  focusEditor(state.baseEdit.stage === 'edit' ? 'base-text' : 'base-save', 'base-head', caret);
}

/**
 * After a save stopped because the base or a file changed since the review: the draft is shown again as a review against things
 * as they are now. A draft that only carries something stored follows it: putting the base back or updating writes the base as it
 * is now, using an edited copy uses that copy as it is now (no longer edited there: nothing left to choose, so it closes), and a
 * draft started from a tool's text and not edited since follows that text (`ownBefore`: the text it started from).
 */
function resyncDraft(edit: BaseEdit, why: string, ownBefore: string | undefined) {
  Object.assign(edit, { hash: state.base?.hash ?? '', stage: 'review', conflict: why });
  const { kind, tool } = edit.source ?? {};
  // Started from a tool's own text and not changed since: it follows that text as it is now (a line added outside is kept).
  const file = tool && fileOf(tool);
  if (kind === 'own' && file && edit.text === ownBefore) edit.text = ownText(file);
  if (state.base && (kind === 'putBack' || kind === 'update')) Object.assign(edit, { text: state.base.text, tools: state.base.tools });
  if (kind === 'copy') {
    const held = tool && fileOf(tool)?.base;
    if (held?.state === 'edited' && held.copy?.trim()) edit.text = held.copy; else state.baseEdit = undefined;
  }
}

/**
 * Saves the base and its tools, then updates every chosen file (INS-03, INS-04). `done` says what was asked for, in the result.
 * Undo puts the base, its tools and every file it wrote back as they were.
 */
export const applyBaseChange = (request: Omit<BaseApply, 'expected'>, done: (written: string) => string) => busy('Saving the base instructions…', async () => {
  focusAfterBusy = 'outcome-undo-base';
  const source = state.baseEdit?.source;
  const ownBefore = source?.kind === 'own' && source.tool ? ownText(fileOf(source.tool)!) : undefined;
  const result = await api().applyBase({ ...request, expected: state.baseEdit?.hash ?? state.base?.hash ?? '' }, state.home!.home);
  await rereadInstructions();
  if (result.stopped) {
    tell(undefined, result.stopped);
    // Changed since the review: the draft stays, now against the base and files as they are, and the review is shown again.
    if (state.baseEdit && result.changed) resyncDraft(state.baseEdit, result.stopped, ownBefore);
    return;
  }
  state.baseEdit = undefined;
  // Back to the card's rows, which now show each file's state; focus goes to the result's Undo.
  document.getElementById('instructions-scroll')?.scrollTo({ top: 0 });
  const written = result.written.map(entry => entry.tool);
  const sessions = written.length ? ` Start a new ${written.length === 1 ? `${toolList(written)} session` : 'session in each'} for this to take effect.` : '';
  const created = result.written.filter(entry => entry.before === null).map(entry => entry.tool);
  const undoTitle = `Put the base instructions back as they were${written.length ? `, and ${fileNames(written)} as ${written.length === 1 ? 'it was' : 'they were'}` : ''}${created.length ? ` (${fileNames(created)}, which this save created, goes again)` : ''}`;
  tell({ page: 'instructions', text: `${done(written.length ? fileNames(written) : '')}${leftText(result)}${sessions}`,
    act: result.undo ? { label: 'Undo', id: 'outcome-undo-base', title: undoTitle, run: () => void undoBaseChange(result.undo!) } : undefined });
});

const undoBaseChange = (undo: BaseUndo) => busy('Undoing…', async () => {
  // Said for what this undo puts back: the base only if the save changed it (Put back and Update change files alone).
  const baseMoves = undo.text !== state.base?.text || undo.list.tools.join() !== state.base?.tools.join();
  const result = await api().undoBase(undo, state.home!.home);
  await rereadInstructions();
  // Focus rests on the base card's own button: Edit, or Write when the undo emptied the base.
  focusAfterBusy = state.base?.text.trim() ? 'base-edit' : 'base-write';
  if (result.stopped) { tell(undefined, result.stopped); return; }
  const back = result.written.map(entry => entry.tool);
  if (!baseMoves && !back.length) { tell({ page: 'instructions', text: `Nothing was undone.${leftText(result, true)}` }); return; }
  const what = baseMoves ? `The base instructions are back as they were${back.length ? `, and so ${back.length === 1 ? 'is' : 'are'} ${fileNames(back)}` : ''}`
    : `${fileNames(back)} ${back.length === 1 ? 'is' : 'are'} back as ${back.length === 1 ? 'it was' : 'they were'}`;
  const shelves = [...(baseMoves ? ['the Base instructions card'] : []), ...back.map(tool => `${namedTools[tool]}’s card`)];
  tell({ page: 'instructions', text: `${what}.${leftText(result, true)} What the undo replaced is under Earlier versions on ${andList(shelves)}.` });
});

/** Loads an earlier base into the editor, at the review: going back is an ordinary save. */
export const loadBaseVersion = (id: string) => askAboutOpenDraft() ? undefined : busy('Reading the earlier version…', async () => {
  focusAfterBusy = 'base-save';
  const text = await api().instructionVersion('base', id);
  if (text === undefined) { announce('That version is no longer kept.'); return; }
  state.outcome = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  state.baseEdit = { text, hash: state.base?.hash ?? '', tools: state.base?.tools ?? [], stage: 'review', source: { kind: 'version' } };
  announce('Review going back to the earlier base instructions, then save to put them back.', true);
});

// ---------- A draft of the base, written by one of the person's tools (INS-06) ----------

/** The files a tool's draft sorts: those with instructions of their own whose copy of the base wasn't edited there (the same
 *  ones draftbase.ts gives the tool). */
export const draftable = () => (state.instructions.data ?? []).filter(file => ownText(file).trim() && file.base?.state !== 'edited');

/** What a draft was written from that holds something else now (files by tool, and the base itself): the draft knows nothing
 *  of what changed there, so saving it would lose that. */
export const draftStale = (edit: BaseEdit) => ({
  files: (state.instructions.data ?? []).filter(file => edit.read?.[file.tool] !== undefined && edit.read[file.tool] !== file.hash),
  base: edit.readBase !== undefined && edit.readBase !== (state.base?.hash ?? ''),
});

/** Opens the panel that sets up a draft, with the prompt main would send now; nothing runs yet. An editor holding typed work is
 *  asked about first. */
export function openDraftPick() {
  if (askAboutOpenDraft()) return;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  state.baseEdit = undefined;
  void busy('Reading the instruction files…', async () => {
    const now = await api().draftPrompt(state.home!.home);
    if ('stopped' in now) { announce(now.stopped); return; }
    state.draftPick = { tool: state.base!.drafters[0], model: '', prompt: now.prompt };
  }).then(() => {
    // Focus on Start, placed at the window's foot every time: above it the panel, and over the panel the base's text, still there.
    const start = document.getElementById('base-draft-start');
    start?.focus({ preventScroll: true });
    start?.scrollIntoView({ block: 'end' });
  });
}
export function closeDraftPick() {
  state.draftPick = undefined;
  rerender();
  document.getElementById('base-draft')?.focus();
}

/**
 * Has the panel's tool write a draft of the base from every tool's instructions, on the model typed, sent the prompt the panel
 * shows; then opens the draft as a review: saving it there sets the base and updates each file in one step. Nothing is written
 * before that. Anything short of a draft leaves the panel as it was, saying why: a failure in the tool's own words, so another
 * tool or model can be tried, or (the files changed since the prompt was shown) the prompt as it would be sent now.
 */
export const startDraft = () => {
  // One thing is edited at a time: typed work in a tool's editor is asked about first, and a clean one closes.
  if (askAboutOpenDraft()) return;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  const pick = state.draftPick!;
  const tool = pick.tool;
  state.drafting = tool;
  pick.problem = undefined;
  return busy(`${namedTools[tool]} is writing a draft of the base instructions…`, async () => {
    try {
      const result = await api().draftBase(tool, state.home!.home, pick.model, pick.prompt);
      await rereadInstructions();
      // A failure is read where it is said; after Stop, focus is back on Start.
      const none = (why: string, problem = true) => { if (problem) pick.problem = why; focusAfterBusy = problem ? 'base-draft-problem' : 'base-draft-start'; announce(why); };
      if (result.promptNow !== undefined) {
        pick.prompt = result.promptNow;
        none('The instruction files changed after this prompt was shown, so nothing was sent. The prompt below is as it would be sent now: Start sends it.');
        return;
      }
      const draft = result.draft;
      if (!draft) { none(result.cancelled ? 'Stopped. No draft was written, and nothing was changed.' : result.stopped ?? 'No draft was written.', !result.cancelled); return; }
      // Written from the files as they were when it started: saving it over one that changed since would lose what is new there.
      const files = state.instructions.data ?? [];
      const changed = files.filter(file => draft.read[file.tool] !== undefined && draft.read[file.tool] !== file.hash).map(file => file.tool);
      const base = state.base;
      if (changed.length || draft.baseHash !== (base?.hash ?? '')) {
        // The prompt below is read again, so the next Start sends the files as they are now.
        const now = await api().draftPrompt(state.home!.home);
        if ('prompt' in now) pick.prompt = now.prompt;
        none(`${changed.length ? `${fileNames(changed)} changed` : 'The base instructions changed'} while the draft was being written, so the draft was dropped. Nothing was changed. ${'prompt' in now ? 'The prompt below is as it would be sent now: Start sends it.' : now.stopped}`);
        return;
      }
      // Every tool gets a first base, as when one is written by hand; a later draft keeps the list and adds the tools it sorted.
      const sorted = Object.keys(draft.own);
      const absent = (base?.tools ?? []).filter(listed => !files.some(file => file.tool === listed));
      const tools = base?.text.trim() ? [...absent, ...files.map(file => file.tool).filter(each => base.tools.includes(each) || sorted.includes(each))] : files.map(file => file.tool);
      state.draftPick = undefined;
      state.baseEdit = { text: draft.base, hash: base?.hash ?? '', tools, stage: 'review', source: { kind: 'draft', tool }, own: draft.own, read: draft.read, readBase: draft.baseHash };
      focusAfterBusy = 'base-save';
      announce(`${namedTools[tool]} wrote a draft. Review it, then save to update the files.`, true);
    } finally { state.drafting = undefined; }
    // Focus is on Save, at the foot of the review; the page shows the draft from its top, where reading it starts.
  }).then(() => { if (state.baseEdit?.source?.kind === 'draft') document.getElementById('base-card')?.scrollIntoView({ block: 'start' }); });
};

/** Stops the draft being written; its request then answers that it was cancelled. */
export const stopDraft = () => void api().cancelDraft();

// ---------- Sync switch and background changes ----------

export const setSync = (on: boolean) => busy(on ? 'Turning Sync on…' : 'Turning Sync off…', async () => {
  const view = await api().setSync(on);
  setHome(view);
  announce(on ? 'Automatic sync on.' : 'Automatic sync off.', true);
});

/**
 * Synchronize everything, the open home's standing rule, on or off from Settings (everything.ts setSyncEverything; first setup's
 * question is firstsetup.ts's). Turned on, main's next pass takes in what is found now: at once with Automatic sync on, at Sync
 * once with it off. Answers why not, if it couldn't be set.
 */
export const switchSyncEverything = (on: boolean) => busy(on ? 'Turning on Synchronize everything…' : 'Turning off Synchronize everything…', async () => {
  const set = await api().setSyncEverything(on, state.home!.home);
  if (set.view) setHome(set.view);
  if (set.stopped) { announce(`Synchronize everything was not changed. ${set.stopped}`); return; }
  announce(!on ? 'Synchronize everything is off: what turns up in a tool waits for Add.' : state.home?.syncOn ? 'Synchronize everything is on.' : 'Synchronize everything is on. It takes items in at Sync once, or when Automatic sync is on.', true);
});

let menuSyncHome: string | undefined;
export async function syncNow(home = state.home?.home) {
  if (acting() || !home) return;
  menuSyncHome = undefined;
  if (home !== state.home?.home) { announce('The open home changed before Sync once could run.'); return; }
  await busy('Syncing…', async page => {
    const result = await api().syncNow(home).finally(() => { menuSyncHome = undefined; });
    if (!result) return;
    setHome(result.view);
    tell({ page, kind: 'sync-once', band: true, history: result.history, text: result.text, warn: result.warn });
  });
}
api().onSyncRequest(() => { if (acting()) menuSyncHome = state.home?.home; else void syncNow(); });

/** A background read is running, or one arrived while the page was acting and runs when it is done (afterActing). */
let refreshing = false;
let refreshOwed = false;
/** A background reply that landed while the page acted. The next view of its home takes it in (setHome). */
let setAside: HomeView | undefined;
/** Whether the home waits to be read once the page's run of clicks is done: a background refresh asked for meanwhile, or a plugin's click (oweHomeRead). */
export const homeReadOwed = () => refreshOwed;
/** A plugin's click changed what the item lists show: the home is read once at the run's end (clicklist.ts), not after each click. */
export const oweHomeRead = () => { refreshOwed = true; };
/**
 * The home read again by a Plugins action before it ends (pluginstate.ts readAgain), or at a run of clicks' end (clicklist.ts):
 * it stands for a background refresh owed meanwhile, so the home is read once.
 */
export async function readHomeOnce(): Promise<void> {
  refreshOwed = false;
  setHome(await api().refresh().catch(() => null));
}
// The Settings… menu item (and any later page the main process asks for) opens that page.
const isPage = (page: string): page is Page => (pages as readonly string[]).includes(page);
api().onNavigate(page => {
  // "Check for Updates…" opens Settings on its Updates row and checks from there, so the result is announced and Check now has the focus.
  if (page === 'settings/updates') { showPage('settings'); document.getElementById('setting-updates')?.scrollIntoView({ block: 'nearest' }); void checkNow(true); }
  else if (isPage(page)) showPage(page);
});
// Settings changed by a menu, a dialog or the system: main says so after every save and whenever the window comes back, and an
// open Settings page reads them again, so it never shows (or writes back) a value that is no longer the saved one.
api().onSettingsChanged(() => { if (state.page === 'settings') void loadSettings(); });

// A background pass may change what differs from the git repo too: its page and sidebar count read again soon (no fetch).
// The Sources page reads its view again too: a read by itself (the daily check) changes what each name there is to the library.
api().onSyncChanged(() => { loadRepoSoon(); void backgroundRefresh(); if (state.page === 'sources') void loadSources(); });
api().onSaid(text => announce(text));

/** Each kind's sync notices in a view: what changed on its own, with its History event. */
const noticesByKind = (view: HomeView): [PageKind, SyncNotice[]][] => [['skills', view.skills.notices], ['mcp', view.mcp.notices], ['agents', view.agents.notices]];

/**
 * A sync notice its page hasn't shown yet (state.seenNotices) stays in the next read of the same home until it is shown or
 * dismissed: main says each notice once, and a pass's own writes (a settings file it wrote) bring a read with none right
 * after the one that had them, so a page opened a moment later still tells what Synchronize everything, or an edit, did.
 */
function keepUnshown(was: HomeView | undefined, view: HomeView): HomeView {
  if (!was || was.home !== view.home) return view;
  const kept = (kind: PageKind) => {
    const now = view[kind].notices, known = new Set(now.map(notice => notice.history));
    const unshown = was[kind].notices.filter(notice => !known.has(notice.history) && !state.seenNotices.has(notice.history) && !state.dismissed.has(notice.history));
    return unshown.length ? { ...view[kind], notices: [...unshown, ...now] } : view[kind];
  };
  return { ...view, skills: kept('skills'), mcp: kept('mcp'), agents: kept('agents') };
}

/**
 * A background pass changed something: read again quietly, keeping drafts. While the page acts (acting) it waits, and runs
 * when that ends, so a change (a tool appearing, say) is never lost; an action that starts while the read is on its way goes
 * first, and the read runs again after it. What the status bar says stays, unless the view brings a notice
 * the page didn't have: then that is the news.
 */
async function backgroundRefresh() {
  if (!state.home) return;
  if (acting() || refreshing) { refreshOwed = true; return; }
  refreshing = true;
  try {
    const view = await api().refresh();
    if (acting()) {
      refreshOwed = true;
      if (view) setAside = withSetAside(setAside, view);
      return;
    }
    if (!view) return;
    // A tool appeared or went away: the page leaves a kind no longer here and reads its own data again (setHome).
    setHome(view, { background: true });
    rerender();
  } finally {
    refreshing = false;
    drainOwedRefresh();
  }
}

/** Fresh background notices already taken. An action finishes saying its own result before the status bar announces these. */
const backgroundNews: { kind: PageKind; notice: SyncNotice }[] = [];
function takeBackgroundNews(view: HomeView) {
  const known = new Set(state.home ? noticesByKind(state.home).flatMap(([, notices]) => notices.map(notice => notice.history)) : []);
  for (const [kind, notices] of noticesByKind(view)) {
    for (const notice of notices) if (!known.has(notice.history)) backgroundNews.push({ kind, notice });
  }
}

/** Says fresh background news. A result gives way only beside a notice that can point to its Undo in History. */
function sayBackgroundNews() {
  const news = backgroundNews.splice(0).filter(({ notice }) => !state.dismissed.has(notice.history));
  if (!news.length) return;
  const outcome = state.outcome;
  const undo = outcome?.act?.inHistory ? outcome.act : outcome?.undo;
  if (undo && outcome) {
    const notices = noticeLinesOnPage(news, outcome);
    if (notices.length) {
      state.undoMoved = { page: outcome.page, label: undo.label, items: outcome.items ?? (outcome.item ? [outcome.item] : []), notices };
      state.outcome = undefined;
    }
  }
  // Each item once, its kind named where another kind's news has its name (words.ts rowNames).
  const items = [...new Set(rowNames(news.flatMap(({ kind, notice }) => noticeNames(notice).map(name => ({ kind, name })))))];
  // Quiet where the table on screen shows the news (its kinds' notices) already.
  announce(`Sync changed ${andList(items)}.`, news.some(({ kind }) => kindsShown().includes(kind)));
}

/** A background refresh asked for while the page acted or while another ran: run it now, once, if nothing is running. */
function drainOwedRefresh() {
  if (!refreshOwed || acting() || refreshing) return;
  refreshOwed = false;
  void backgroundRefresh();
}

// ---------- Profiles ----------

/** The Profiles page's state: which profile is open, and what it is doing with it. */
export const profileState = {
  /** The profile open, by id; unset shows the first one in use, else the first. */
  open: undefined as string | undefined,
  /** The profile whose Delete is asking to be confirmed. */
  confirmDelete: undefined as string | undefined,
  /** The profile whose name is being edited. */
  renaming: undefined as string | undefined,
  /** The name as typed while renaming, kept across redraws. */
  draft: undefined as string | undefined,
};

/** What a switch or its Undo did, as its band says it: what it turned On and Off, and what could not change. */
function turnedOutcome(page: Page, lead: string, turned: Pick<ProfileSwitchResult, 'on' | 'off' | 'left'>, results: DestinationResult[], act?: Outcome['act']) {
  const leftSaid = turned.left.length ? ` ${andList(turned.left)} ${turned.left.length === 1 ? 'is' : 'are'} not as it asked: History says why.` : '';
  const notDone = results.length ? ` ${results.slice(0, 2).map(entry => entry.message).join(' ')}${results.length > 2 ? ' …' : ''}` : '';
  tell({ page, text: `${lead}: ${turnsWords(turned, 'did') || 'nothing changed'}.${leftSaid}${notDone}`, warn: results.length > 0 || turned.left.length > 0, act });
}

/** What a switch did, with Undo switch (from the page or, next time the window shows, the menu bar). */
const switchOutcome = (result: ProfileSwitchResult, page: Page) => turnedOutcome(page, `Switched to ${result.name}`, result, result.results,
  result.event ? { label: 'Undo switch', id: 'outcome-undo', inHistory: true, title: 'Turn back each item this switch changed, where it is still as the switch left it', run: () => void restoreEvent(result.event!) } : undefined);

/** Switches to a profile. The band says what changed, with Undo; the menu bar follows. */
export const switchToProfile = (id: string) => busy('Switching profile…', async page => {
  const result = await api().switchProfile(id, state.home!.home);
  if (result.view) setHome(result.view);
  if (result.stopped) { announce(result.stopped); return; }
  switchOutcome(result, page);
  if (state.page === 'history') await putHistory();
});
// A switch from the menu bar: its result and Undo are on the page the next time the window shows.
api().onProfileSwitched(async result => {
  switchOutcome(result, state.page);
  // History lists the new switch at once when it is the page open (it reads History only when opened).
  if (state.page === 'history') await putHistory();
  rerender();
});

/**
 * Saves a profile: only the fields given change. A new or restored profile opens (a new one with its name field ready to type); an
 * edit leaves the page where it is.
 */
export const saveProfileDef = (profile: ProfileEdit, said?: string) => busy('Saving profile…', async () => {
  const result = await api().saveProfile(profile, state.home!.home);
  if (result.profiles) state.home = { ...state.home!, profiles: result.profiles };
  if (result.problem) { announce(result.problem); return; }
  if (result.id && (!profile.id || profile.restore)) profileState.open = result.id;
  if (result.id && !profile.id) profileState.renaming = result.id;
  announce(said ?? 'Profile saved.', true);
});

/** Deletes a profile's definition; one click on Undo saves it again. */
export const deleteProfileDef = (id: string) => busy('Deleting profile…', async () => {
  const gone = state.home!.profiles.profiles.find(profile => profile.id === id);
  const result = await api().deleteProfile(id, state.home!.home);
  if (result.profiles) state.home = { ...state.home!, profiles: result.profiles };
  profileState.confirmDelete = undefined;
  if (result.problem || !gone) { announce(result.problem ?? 'That profile is gone.'); return; }
  profileState.open = undefined;
  tell({ page: 'profiles', item: gone.name, text: `Deleted the profile ${gone.name}. No item changed.`,
    act: { label: 'Undo', id: 'outcome-undo-delete-profile', title: `Make ${gone.name} again, with the same items`, run: () => void saveProfileDef({ ...gone, restore: true }, `${gone.name} is back.`) } });
});
