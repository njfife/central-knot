// The page's state and most pages' actions (MAP.md, "The app's shell and Settings"): the open home's view and each page's own
// state (`state`), the page shown (showPage), what is said after a click (tell, announce; profileEndedLine, via profilesBefore and
// profileplan.ts endedProfiles, gives `Everyday · changed` (profileplan.ts profileNow) or words.ts profileLeftUse when an act ended every profile in use, called by withProfileEnded and pluginstate.ts) and when a result goes by itself
// (FADE_MS), the busy line (busy) and whether the page is acting (acting: busy, or a run of clicks: clicklist.ts); a click on an
// item list sent to its kind's engine (carryOut, through kindPages), at once under busy (applyClick), one per kind as one
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
import { forgetHistoryFolds } from './historypage.ts';
import { forgetManageQuestion } from './managecard.ts';
import { loadSettings, openHistoryWindow, openSettings } from './settingspage.ts';
import { checkNow } from './updateview.ts';
import { loadPluginUpdates } from './pluginupdateview.ts';
import type { Reason, ApplyResult, Profile, ProfileEdit, ProfileSwitchResult, BaseApply, BaseResult, BaseUndo, BaseView, Change, DesktopApi, DestinationResult, HarnessId, InstructionFile, HistoryEvent, HistoryDays, HomeMode, HomeView, PassResult, SessionCostsView, SyncNotice, TakenInNotice, UsageReading } from './types.ts';
import { anyOn, kindSource, noPins, pinsOn, rowId, sameRow, type NamedRow, type Pinned, type RowKey } from './itemrow.ts';
import { itemKey, wantedIn } from './library.ts';
import { caughtUpNames, groupBy, noticeNames, plural, withSetAside } from './model.ts';
import { button, h } from './dom.ts';
import { readFlag, writeFlag } from './flags.ts';
import { pluginItemCount } from './pluginrows.ts';
import { clickResults, heldWhole, keptBack } from './clickplan.ts';
import { entriesNow, everythingAction, everythingDone, everythingPlan, libraryAction, libraryEntry, librarySentence, oneUndoCovers, restorePlan } from './historyactions.ts';
import { asksWhichCopy, copiesDiffer, libraryWords, placeOf, stillReadWords } from './libraryrow.ts';
import { andList, changedName, countedAs, fewNames, fileName, kindNames, kindNouns, noToolsSentence, notAllThrough, orList, profileLeftUse, rowNames, rowNouns, saidByKind, toolList, toolName, toolNames as namedTools, toolsPhrase } from './words.ts';
import { withOwn, withoutBase } from './basetext.ts';
import { machineNames, pagePlatform, shownFromHome } from './machine.ts';
import { closeRun, endListNews, fadeRun, forgetResults, loadPlugins, overRun, resetMarket, retire, stillOnFromProfiles } from './pluginstate.ts';
import { pruneHookSources, resetHookSources } from './hooksourceview.ts';
import { resultLines, resultSentence, reverse, runPlan, strayHolds, succeeded, type LastRun, type PluginDone, type PluginOp } from './pluginplan.ts';
import type { PluginEntry } from './pluginrecord.ts';
import { nextDraft, unsaved, type InstructionDraft } from './drafts.ts';
import { absentKindsIn, heldKinds, type HomeKind } from './presence.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';
import { changeWords, endedProfiles, filledWords, leftLoadingAfter, profileNowIn, stillLoadAfter, undoOffered, wholeCounts, wholeSaid } from './profileplan.ts';
import { hasReloadAdvice, pluginReloads, reloadAdvice, reloadsFor, settleReloads, waysFrom, type ReloadChange } from './reload.ts';
import { clickList, drop, endRun, join, runAt, type Run, type Turn } from './clicklist.ts';
import { followView, type SigninChecks } from './mcpsignin.ts';
import { keeperNews, loadSessions, windowBack, type SessionsDay } from './sessionspage.ts';
import type { DayRows, PeriodRows } from './sessionrow.ts';
import { DIFFERS_REASON, selecting, stopSelecting } from './selection.ts';
import { takesPlugins } from './presence.ts';
import { pluginOf } from './sourcelink.ts';
import { findInHome, holdOrder, keptNoticeList, noticeArrived, noticesKept, noticeUnseen, resultInHeader, rowByKey, supersedes, usageNotCollected } from './matrix.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

/** Every page, in the sidebar's order. The Library lists every kind of item (matrix.ts libraryTable), its segment `state.libraryKind`. */
export const pages = ['overview', 'harnesses', 'library', 'mcpsignin', 'instructions', 'plugins', 'profiles', 'history', 'sessions', 'sources', 'repo', 'settings'] as const;
export type Page = typeof pages[number];

const platform = pagePlatform(navigator.userAgent);
/** This computer's names, and what its platform offers (machine.ts). */
export const machine = machineNames(platform);
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
  /** How long History keeps things, as Settings saves it: History and the Deletes say it; read with History's events, at launch and at each settings change (readHistoryDays). */
  historyDays: undefined as HistoryDays | undefined,
  /** What the last click on skills did, shown until the next action or read. */
  skillsResult: undefined as PassResult | undefined,
  /** The Library: its list, or one skill's files and contents beside a list of the skills (its Files view). */
  libraryView: 'list' as 'list' | 'files',
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
  said: { text: '', quiet: false, seq: 0 } as { text: string; quiet: boolean; seq: number; link?: { label: string; run: () => void }; notices?: string[]; shown?: string },
  /** What the last action did, said on the page it happened on until the next action or page (Outcome). */
  outcome: undefined as Outcome | undefined,
  /**
   * The card hanging from the header, one at a time (renderer.ts resultHere): a result shown whole (Show all: matrix.ts
   * wholeToggle), an item list's outcome, kept result or first background problem, Plugins' run or problem; or the sync notices
   * (matrix.ts noticesCard), named by the list and place they are of (`noticesOf`) with how many had arrived when it opened
   * (`upTo`). Folded by renderer.ts foldResult, and let go when what it shows is no longer drawn (renderer.ts resultHere); a newer
   * result is another object, so it shows folded.
   */
  shownWhole: undefined as Outcome | PassResult | DestinationResult | LastRun | string | { noticesOf: string; upTo: number } | undefined,
  /** What the tools' session history shows was used (usage.ts), for this home: collected when it opens and on Update usage statistics (collectUsage). */
  usage: pageData<UsageReading>(),
  /** Whether the usage band shows above the Library's list (matrix.ts usageBand): opened by Update usage statistics, closed by its close button and when a home opens. */
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
  /** Sync notices seen, and when: drawn in the header's lines or its open card while the window had the focus (matrix.ts markSeen). */
  seenNotices: new Map<string, number>(),
  /** Whether the content is wide enough to dock an open row's details beside its table; set by the renderer's layout. */
  wide: false,
  /** The harness whose page is open on Harnesses; none shows every harness. */
  harness: undefined as HarnessId | undefined,
  harnessTab: 'skills' as HarnessTab,
  /** The window chooses the sidebar shape until the person uses the toggle, which holds until the window crosses the rail breakpoint. */
  sidebar: undefined as 'open' | 'rail' | undefined,
  /** The rows a click pins where they were, on the list on screen (pinnedRows). */
  pinned: noPins(),
  /** MCP sign-in: what each column's last Check said in the open home (mcpsigninpage.ts), made again when a home opens; never stored. */
  mcpSignin: { home: '', columns: {} } as SigninChecks,
  /** The Sessions page's period (sessionspage.ts): read when the page opens, on Refresh and on a choice of period (loadSessions); never stored. */
  sessions: pageData<DayRows | PeriodRows>(),
  /** Which period the Sessions page reads: Today at launch, kept while the window is open, across pages and homes (7 days only where kept). */
  sessionsDay: 'today' as SessionsDay,
  /** Inline refusal or save failure from the Sessions page's keeping control; cleared when keeping changes cleanly or home changes. */
  keepProblem: undefined as string | undefined,
};

/**
 * The rows pinned on the list on screen (itemrow.ts Pinned): the list asks for them each time it is drawn, by its own name; a
 * click on a row's own switch pins that row (itemrow.ts pin), a usage reading as it lands pins the rows it could move
 * (matrix.ts holdOrder), and MCP sign-in pins each row as it is first drawn (mcpsigninpage.ts inPlace). A draw lets them go that asks for another list or for none (another page, tab, view or plugin's
 * page, another Sort or chip: drawPage); so do Refresh (readAgain), Put in order (unpin, from matrix.ts rowsHeld) and a new text
 * in the Library's Find (matrix.ts newFind). A tool's tab's Find keeps them. Asked for outside a draw (a click, a reading
 * landing), they are the ones kept when the name is the list on screen's, else a set kept nowhere, so a pin there is lost. In
 * memory only. `Group`: what the list groups its rows by (matrix.ts its headings, pluginstate.ts a plugin's place).
 */
let drawing = false, asked = false;
export const pinnedRows = <Group extends string | number>(list: string): Pinned<Group> => {
  if (drawing) { asked = true; state.pinned = pinsOn(state.pinned, list); }
  return (state.pinned.list === list ? state.pinned : noPins()) as Pinned<Group>;
};
/** Draws the page (renderer.ts render): a draw that asked for no pinned rows lets them go. */
export function drawPage(draw: () => void) { drawing = true; asked = false; try { draw(); } finally { drawing = false; } pruneHookSources(); if (!asked) unpin(); }
/** Every pinned row is let go: each takes its own place in the order again. */
export const unpin = () => { state.pinned = noPins(); };

let render = () => {};
export const setRenderer = (next: () => void) => { render = next; };
/** Draws, then puts focus back on the control that had it, found by id and without scrolling to it: a control drawn again is a new element. */
export const keepingFocus = (draw: () => void) => {
  const focused = document.activeElement?.id;
  draw();
  if (focused && document.activeElement?.id !== focused) document.getElementById(focused)?.focus({ preventScroll: true });
};
/** Re-renders (renderer.ts render, which keeps the focus where it was). */
export const rerender = () => render();

/** The practice copy's note on the Overview, shown until the person hides it (kept per viewer, in this window's storage). */
const PRACTICE_NOTE = 'ck-practice-banner-dismissed';
export const practiceNoteOpen = (): boolean => !readFlag(PRACTICE_NOTE);
export const setPracticeNote = (open: boolean): void => writeFlag(PRACTICE_NOTE, !open);

/**
 * Says something in the status bar, kept in state (state.said) so a redraw paints the same thing. The newest message is
 * the one shown. A quiet announcement is for screen readers only: the page already shows the same thing (a band), or, for
 * one about sync notices (`notices`), will once each is seen (paintStatusMessage). When `shown` is given (pluginstate.ts
 * sayResult, where the Library line already draws the ended-profile sentence), it must be a prefix of `text`: the bar
 * shows and tooltips `shown`, while the rest of `text` stays visually hidden so screen readers still hear the whole string.
 */
export function announce(text: string, quiet = false, link?: { label: string; run: () => void }, notices?: string[], shown?: string) {
  state.said = { text, quiet, seq: state.said.seq + 1, link, notices, shown };
  paintStatusMessage();
}

/** Profiles in use before an act began, with its home, so tell and pluginstate can say when the act ended all of them. */
export interface ProfilesBefore { home: string; profiles: Profile[] }
let actBefore: ProfilesBefore | undefined;
/** Snapshots the open home and the profiles in use in it before an act starts (busy, queueClick, pluginstate.ts). */
export function profilesBefore(): ProfilesBefore | undefined {
  return state.home ? { home: state.home.home, profiles: profileNowIn(state.home).inUse } : undefined;
}
/**
 * When every profile in `before` (defaults to busy's `actBefore` when omitted/undefined) stopped being in use in `after` (same
 * home): `Everyday · changed` where `after` names the one last switched to so (profileplan.ts profileNow), else profileLeftUse;
 * undefined when none ended.
 */
export function profileEndedLine(before: ProfilesBefore | undefined = actBefore, after: HomeView | undefined = state.home): string | undefined {
  if (!before || !after || after.home !== before.home) return undefined;
  const now = profileNowIn(after), ended = endedProfiles(before.profiles, now.inUse);
  if (!ended.length) return undefined;
  return now.changed ? changedName(now.changed.name) : profileLeftUse(ended.map(profile => profile.name));
}
/** Appends profileEndedLine's words when an act in the same home ended every profile that was in use before it. */
function withProfileEnded(outcome: Outcome, { checkProfile = true, before = actBefore }: { checkProfile?: boolean; before?: ProfilesBefore } = {}): Outcome {
  if (!checkProfile || outcome.refused || outcome.profileLine) return outcome;
  const profileLine = profileEndedLine(before);
  return profileLine ? { ...outcome, text: [outcome.text, profileLine].filter(Boolean).join(' '), profileLine } : outcome;
}

/**
 * Sets what the last action did (or clears it, saying `otherwise`), and says it. A result with nothing to offer (no
 * button, Undo or History link) is said in the status bar; one with a band is heard by screen readers, since the band
 * already shows it.
 */
export function tell(outcome: Outcome | undefined, otherwise = '', options?: { checkProfile?: boolean; before?: ProfilesBefore }): void {
  const told = outcome && withProfileEnded(outcome, options);
  state.outcome = told;
  // Said in a plugin run's place (Plugins, Instructions, or a tool's tab of either), the newer result: the run's goes, so this one's ×
  // uncovers nothing older (pluginstate.ts overRun).
  if (overRun(told)) closeRun();
  if (!told) announce(otherwise);
  else { announce(spoken(told), !saidInStatusBar(told)); told.said = state.said.seq; }
  fadeLater();
}

/** How each tool in the open home was found (CLI, desktop app, or both), for reload advice (reload.ts). */
export const toolWays = () => waysFrom(state.home?.snapshots);
/** A result as the status bar and screen readers say it: its sentence, reload advice, then its reasons. */
const spoken = (outcome: Outcome) => [outcome.text, outcome.reloads ? reloadAdvice(outcome.reloads, toolWays()).text : '', ...(outcome.reasons ?? []).map(reason => (typeof reason === 'string' ? reason : reason.join('')))].filter(Boolean).join(' ');
/** One click's own result: where it left something undone it says so first, before its name can take the header's room. */
export const notDoneFirst = (outcome: Outcome): Outcome => (outcome.warn ? { ...outcome, text: `Didn’t go through in every tool: ${outcome.text}` } : outcome);

/**
 * How long a result stays once the page stops acting, when it goes by itself: in a list page's header (matrix.ts resultInHeader),
 * one with no problem line that doesn't stay (Outcome stays), whose Undo stays in History (Plugins' run too, whose Undo goes with it: pluginstate.ts fadeRun); on
 * another page, an Undo's confirmation (Outcome fade).
 */
export const FADE_MS = 8000;
let fading: ReturnType<typeof setTimeout> | undefined;
export const windowVisible = () => windowShown && !document.hidden;
/** The result's time starts again from now; none runs while the page acts (afterActing) or while the window is hidden. */
function fadeLater(): void {
  clearTimeout(fading);
  if (!acting() && windowVisible()) fading = setTimeout(fadeNow, FADE_MS);
}
/** The pointer or the focus is in the header's result, or it is open as a card: it stays while so, and its time starts again after. */
const heldInHeader = () => !!document.querySelector('.header-result:hover, .header-result:focus-within, .result-whole');
function fadeNow(): void {
  if (acting() || !windowVisible()) return;
  if (heldInHeader()) { fading = setTimeout(() => (heldInHeader() ? fadeNow() : fadeLater()), 250); return; }
  const outcome = state.outcome;
  if (outcome?.fade || (outcome && resultInHeader() && !outcome.warn && !outcome.reasons?.length && !outcome.stays)) state.outcome = undefined;
  // Drawn only when a result went: a redraw that changes nothing would replace a text field he is typing in, and its Undo.
  if ((resultInHeader() && fadeRun()) || state.outcome !== outcome) rerender();
}

/** Paints the status bar's message from state.said (`shown` when given, else `text`, with that visible string as its tooltip and any spoken suffix visually hidden). */
export function paintStatusMessage() {
  const region = document.getElementById('announcement')!;
  const told = state.said;
  // The first sentence, then the rest, so a narrow bar can drop the rest whole rather than cut a word (style.css).
  const shown = told.shown ?? told.text;
  if (region.dataset.text !== told.text || region.title !== shown) {
    region.dataset.text = told.text;
    const [, first, rest] = /^(.+?[.!?])(\s.+)?$/s.exec(shown) ?? [shown, shown, ''];
    const tail = told.shown !== undefined && told.text.startsWith(shown) ? told.text.slice(shown.length) : '';
    const parts = [shown ? h('span.said-first', {}, first) : null, rest ? h('span.said-rest', {}, ` ${rest.trim()}`) : null, tail ? h('span.visually-hidden', {}, tail) : null];
    region.replaceChildren(...parts.filter((part): part is HTMLElement => !!part));
  }
  region.title = shown;
  // A link that belongs to the message (the release notes after an update) goes with it.
  const link = document.getElementById('said-link');
  if (link) { link.hidden = !told.link || told.quiet; link.textContent = told.link?.label ?? ''; link.onclick = told.link?.run ?? null; }
  // Only a message that repeats what the page shows (announced quiet) is for screen readers alone. A result the page didn't
  // draw (no band on this page, or held back) is shown here after all: the drawn result is marked data-outcome. So is news of a
  // sync notice not seen yet (matrix.ts noticeUnseen): one the header only counts, or of a kind not on show.
  const quiet = told.quiet && !(state.outcome && told.text === spoken(state.outcome) && !document.querySelector('[data-outcome]')) && !told.notices?.some(noticeUnseen);
  region.classList.toggle('visually-hidden', quiet);
  // A narrow status bar shows a small mark instead of a message cut to a stub; its tooltip has the message (style.css).
  const mark = document.getElementById('message-mark');
  if (mark) { mark.title = shown; mark.hidden = !shown || quiet; }
}

/**
 * Takes a new view, including the view set aside for this home. `say` gets the view as taken, before it replaces the one on screen.
 * Fresh notices in a background view are “Sync changed” news. A held notice is said when the action ends.
 * When its tools changed (one appeared or went away), or there was no home before, the
 * page follows: a page whose kind is no longer here gives way to the Overview, saying why, and a page with its own data
 * reads it again (unless `reload` is false: the caller reads it itself).
 */
export function setHome(view: HomeView | null | undefined, { reload = true, say, background = false, sayNews = true }: {
  reload?: boolean; say?: (view: HomeView) => void; background?: boolean; sayNews?: boolean;
} = {}): void {
  if (!view) return;
  const held = setAside?.home === view.home ? setAside : undefined;
  view = withSetAside(held, view);
  setAside = undefined;
  say?.(view);
  const news = background ? view : held;
  if (news) takeBackgroundNews(news);
  const before = state.home ? homeTools().join() : undefined;
  // Each notice's place in the order of arrival is given as its view is taken: the newest is the last to arrive, of any kind.
  for (const [, notices] of noticesByKind(view)) for (const notice of notices) noticeArrived(notice.history);
  state.home = keepUnshown(state.home, view);
  // A cell an MCP sign-in check was asked about that this view shows gone, switched off or as another copy is held for no more.
  followView(state.mcpSignin, view);
  if (news && !acting() && sayNews) sayBackgroundNews();
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
  state.busy = message;
  showActing();
  announce(message);
  const working = state.said.seq;
  rerender();
  const previousBefore = actBefore;
  actBefore = profilesBefore();
  try { await work(page); }
  catch { announce(couldNotFinish()); }
  finally { actBefore = previousBefore; }
  // When the work said nothing since its "Reading…", what was said before comes back.
  if (state.said.seq === working) announce(before.text, before.quiet, before.link, before.notices, before.shown);
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
  actBefore = undefined;
  state.home = undefined;
  // The last results, the rows pinned where they were, and Select's mode with its ticks, are the last home's.
  Object.assign(state, { skillsResult: undefined, mcpResult: undefined, agentsResult: undefined, item: undefined });
  unpin();
  stopSelecting();
  // A harness page belongs to the home it was opened in.
  state.harness = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  // The base and its editor belong to the home they were read in.
  state.base = undefined;
  state.baseEdit = undefined;
  state.draftPick = undefined;
  resetPageData(state.instructions);
  resetPageData(state.history);
  forgetHistoryFolds();
  forgetManageQuestion();
  if (state.page === 'history') openHistoryWindow();
  resetPageData(state.usage);
  resetPageData(state.sessions);
  state.keepProblem = undefined;
  state.usageBand = false;
  // What the MCP sign-in checks said is the last home's; one still running there is dropped when it answers.
  state.mcpSignin = { home: view.home, columns: {} };
  drop(turn => turn.state === 'waiting');
  endRun();
  resetMarket();
  resetHookSources();
  // The note of what plugin updates did by themselves is about one home.
  void loadPluginUpdates();
  setHome(view, { reload: false });
  // The Library's Find: the last home's answer let go (matrix.ts findInHome).
  findInHome(view.home);
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
api().onWindowShown(() => { const first = !windowShown; windowShown = true; if (first) void collectUsage(); fadeLater(); });
document.addEventListener('visibilitychange', () => {
  if (!windowVisible()) return clearTimeout(fading);
  fadeLater();
  windowBack();
});

/**
 * Collects usage: main's usage:read reads the tools' own session history on this computer, and nothing leaves it. By itself
 * when a home opens (accept; after a start with no window, once the window first shows), and on Update usage statistics
 * (`asked`), whose click opens the band (state.usageBand); one by itself that fails is said in the status bar, and opens no band
 * that would move the list. Not `busy`: it changes nothing, so the
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
  if (landed === 'failed' && !state.usageBand) announce(usageNotCollected);
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
   * write failed or was held, so it never claims those, the tools it wrote, and the History events the click recorded.
   */
  said: string | ((notIn: HarnessId[], wrote: HarnessId[], recorded?: HistoryEvent[]) => string);
  /** Said as its reasons, a problem line each: what the click left as it is in each tool, and why ("Still on in Codex: its settings file can’t be read."). */
  also?: string[];
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
   * plugin's item: carryOut). `said`: what that part brought with it, said when it all worked. `note`: appended from completed
   * steps in switchesOnly even when another tool's step failed (not on Undo).
   */
  plugins?: { ops: PluginOp[]; turns?: TurnUndo[]; said?: string; note?: (done: PluginDone[]) => string };
  /** A click of its `plugins` part alone, with no change of the person's own (a plugin's own row, a tool's switch for a plugin's
   * item): carryOut runs only those switches (switchesOnly); `undone` is what its Undo says once done ("Undone: triage is back on in Codex."). */
  pluginsOnly?: boolean;
  undone?: string;
  /** On Undo of this single-tool click, say History's own sentence rather than "Undone: X is as before." (matrix.ts flipInHarness, for a plugin page's Use the plugin's). */
  undoSentence?: boolean;
}

/** Each kind's own: how its changes are sent, and where its last result is kept. Its items are itemrow.ts kindSource's. */
const kindPages: Record<PageKind, { send: (changes: Change[], resume: boolean, home: string) => Promise<PassResult>; keep: (results: DestinationResult[], notices?: SyncNotice[]) => void }> = {
  skills: { send: (...args) => api().applySkills(...args), keep: (results, notices) => { state.skillsResult = { results, writes: 0, reloads: [], notices }; } },
  mcp: { send: (...args) => api().applyServers(...args), keep: (results, notices) => { state.mcpResult = { results, writes: 0, reloads: [], notices }; } },
  agents: { send: (...args) => api().applyAgents(...args), keep: (results, notices) => { state.agentsResult = { results, writes: 0, reloads: [], notices }; } },
};
/** Each kind's last click's result, as kindPages keeps it: what its problem lines and notices read (matrix.ts listResult, toldNotices). */
export const lastResult = (kind: PageKind): PassResult | undefined => ({ skills: state.skillsResult, mcp: state.mcpResult, agents: state.agentsResult })[kind];
/**
 * What a new result (a click's, a run's, an Undo's, a Library action's, Sync once's) keeps for the kinds' problem lines: `own`, its own
 * results by kind, and nothing older of any kind, so the header says this result's alone. A kind keeps its notices (matrix.ts
 * toldNotices) unless `own` brings that kind's anew.
 */
function keepOwn(own: Done['kept'][]) {
  for (const kind of KINDS) {
    const mine = own.filter(each => each?.kind === kind);
    kindPages[kind].keep(mine.flatMap(each => each!.results), mine.length ? mine.at(-1)!.notices : lastResult(kind)?.notices);
  }
}

/**
 * Whether a click in this home is a Resume: the page shows it waiting for one (share.ts libraryGate `resume`). Sent with the
 * clicks that resume such a home, as Resume itself does: an item list's clicks (first setup's walkthrough's too), a tool's
 * Manage switch, Take over and Clear the switch. History's actions, a profile switch and Synchronize
 * everything's switch send nothing, and are refused there until Resume.
 */
export const clickResumes = (home: HomeView) => home.sync.gate.state === 'needs-resume';
/** Re-reads Plugins when it is on screen; `clearNews` drops stale click-list lines after a library click on Plugins. */
async function refreshPlugins(clearNews = false): Promise<void> {
  if (state.page !== 'plugins') return;
  if (clearNews) endListNews();
  await loadPlugins(false, state.home?.readId);
}
/** Sends one kind's changes for the open home. */
const send = (kind: PageKind, changes: Change[]) => kindPages[kind].send(changes, clickResumes(state.home!), state.home!.home).then(received);
/** A pass's answer, its notices given their place in the order of arrival as it comes (matrix.ts noticeArrived), before the read after it. */
const received = <Result extends { notices?: SyncNotice[] }>(result: Result) => { for (const notice of result.notices ?? []) noticeArrived(notice.history); return result; };

/**
 * What one click did, once carried out (carryOut): its result as the page it was made on says it (`outcome`), whether it changed
 * anything, its own results for its kind's problem lines (lastResult; none for a click of `plugins` alone), where the focus goes
 * (its control as now drawn), and what a run's one Undo takes back of it (`undo`: none when it has no Undo).
 */
export interface Done {
  outcome: Outcome;
  did: boolean;
  /** Confirmed changes in execution order, so multi-click runs settle final state across clicks (reload.ts settleReloads). */
  reloads: ReloadChange[];
  /** Why it did nothing, where it was refused whole or stopped: its outcome's text then (applyByKind names its kind by it). */
  refused?: string;
  /** The rows it changed (carryOut): all of its rows but those refused whole (clickplan.ts heldWhole) or held because their copies differ (`differs`). */
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
  if (result.stopped) return { kept, did: false, reloads: [], refused: result.stopped, changed: [], outcome: { page, items: click.items, rows: click.rows, warn: true, band: true, text: result.stopped } };
  const made = result.made ?? [];
  // An Add held because its copies differ on disk: nothing was added, so say the question alone and leave its plugins' part unrun.
  if (differs && !did && !made.length) return { kept, did: false, reloads: [], changed: [], focus: click.focus?.(),
    outcome: { page, items: click.items, rows: click.rows, warn: failed, band: true, text: copiesDiffer(click.items) } };
  // The plugins' part, once the copies' part went through (a whole-click refusal leaves it unrun).
  const plugged = click.plugins?.ops.length && (did || made.length || !refusal) ? await runSwitches(click.plugins.ops) : undefined;
  if (plugged) setHome(await api().refresh());
  await refreshPlugins(true);
  const done = did || made.length > 0 || !!plugged?.done.some(entry => succeeded(entry.report));
  // Said from what happened: a tool whose write failed, copy or plugin switch, is not called on (or off).
  const wrote = [...new Set(ours.filter(entry => entry.outcome === 'written' && entry.harness).map(entry => entry.harness!))];
  const notClaimed = [...notIn, ...(plugged?.failedIn ?? [])];
  const held = new Set(ours.filter(entry => heldWhole(entry) || (entry.outcome === 'held' && entry.differs)).map(entry => entry.item.toLowerCase()));
  const changed = click.rows.map((row, at) => ({ ...row, name: click.items[at] ?? row.key })).filter(row => !held.has(row.name.toLowerCase()));
  // What the click also changed in a tool's own settings with its copies (Pi's skills list: librarypass.ts Kind.follow) follows.
  const settings = [...new Set(ours.flatMap(entry => (entry.settingsChanged ? [entry.settingsChanged] : [])))];
  const recorded = made.length && (!click.undoing || typeof click.said === 'function')
    ? (await api().history()).events.filter(event => made.includes(event.id)) : [];
  const said = [typeof click.said === 'string' ? click.said : click.said(notClaimed, wrote, recorded), ...settings].join(' ');
  const choose = differs ? ` ${copiesDiffer(click.items)}` : '';
  const along = plugged && !switchProblems(plugged).length ? click.plugins?.said : undefined;
  const text = done || !refusal ? [said, along].filter(Boolean).join(' ') + choose : refusal.message;
  const back = plugged?.back ?? [], turns = plugged?.turns ?? [];
  const undo = !click.undoing && done && ((made.length && allUndoable(recorded)) || back.length || turns.length) ? { kind: click.kind, made, back, ...(turns.length ? { turns } : {}) } : undefined;
  const warned = failed || !!plugged?.failed.length || !!plugged?.stopped;
  const own = click.changes.length ? reloadsFor(result.reloads, new Set(click.changes.map(change => change.key))) : result.reloads;
  const reloads = [...own, ...(plugged ? pluginReloads(plugged.done) : [])];
  return { kept, did: done, reloads, refused: done || !refusal ? undefined : refusal.message, changed, undo, along, focus: click.focus?.(),
    outcome: withReloads({ page, items: click.items, rows: click.rows, warn: warned || !!click.also?.length || !!refusal, band: true, fade: click.undoing && !warned,
      text, reasons: [...(done && refusal ? [refusal.message] : []), ...switchReasons(plugged, click.also)], plugins: [...new Set([...back.map(op => op.plugin), ...turns.map(turn => turn.plugin)])], act: undo && { label: 'Undo', id: 'outcome-undo', title: 'Put back everything this did', run: () => void undoClick({ rows: changed, focus: click.focus, regroups: click.regroups, sentence: click.undoSentence }, [undo]) } }, reloads) };
}

/**
 * A click of `plugins` alone (a plugin's own row, a tool's switch for a plugin's item in an opened row): each tool's own switch,
 * then the home read again. It did something only where a step went through; its Undo runs what it changed, reversed, and says
 * `undone`.
 */
async function switchesOnly(click: Click, ops: PluginOp[], page: Page): Promise<Done> {
  const ran = await runSwitches(ops, click.undoing, click.plugins?.turns);
  setHome(await api().refresh());
  const worked = !ran.failed.length && !ran.stopped, said = typeof click.said === 'string' ? click.said : click.said([], []);
  const base = worked && said ? [said, click.plugins?.said].filter(Boolean).join(' ') : resultSentence(ran.lines, !!click.undoing);
  const text = [base, !click.undoing && base ? click.plugins?.note?.(ran.done) : ''].filter(Boolean).join(' ') || `${click.items.length ? `${fewNames(click.items)}: n` : 'N'}othing changed.`;
  const undo = ran.back.length || ran.turns.length ? { kind: click.kind, made: [], back: ran.back, ...(ran.turns.length ? { turns: ran.turns } : {}) } : undefined;
  const back = { kind: click.kind, items: click.items, rows: click.rows, changes: [], said: click.undone ?? '', undoing: true, pluginsOnly: true, plugins: { ops: ran.back, ...(ran.turns.length ? { turns: ran.turns } : {}) } };
  const reloads = pluginReloads(ran.done);
  return { did: ran.done.some(entry => succeeded(entry.report)), reloads, along: worked ? click.plugins?.said : undefined, undo,
    outcome: withReloads({ page, items: click.items, rows: click.rows, text, reasons: switchReasons(ran, click.also), warn: !worked || !!click.also?.length, band: true, fade: click.undoing && worked,
      plugins: [...new Set([...ran.back.map(op => op.plugin), ...ran.turns.map(turn => turn.plugin)])], act: undo && { label: 'Undo', id: 'outcome-undo-plugin', title: 'Turn them back as they were', run: () => void applyClick(back) } }, reloads) };
}

/** A click applied at once, under busy: one tool's control in an opened row, Delete, Make current, Resume, a copy chosen (Turn these off: applyByKind). */
export const applyClick = (click: Click | (() => Promise<Click | Outcome>)) => busy(typeof click === 'function' || !click.undoing ? 'Applying…' : 'Undoing…', async page => {
  const resolved = typeof click === 'function' ? await click() : click;
  if ('changes' in resolved) sayDone(await carryOut(resolved, page), resolved);
  else tell({ ...resolved, page });
});
/** What a click applied at once did, said in the header (renderer.ts resultHere) or its band, its rows flashed, the focus on its control. */
function sayDone(done: Done, click: Click) {
  keepOwn([done.kept]);
  tell(click.undoing ? done.outcome : notDoneFirst(done.outcome), '', { checkProfile: done.did });
  focusAfterBusy = done.focus;
  for (const row of click.rows) flashRow(row);
}

/**
 * Tools still reading `rows` left Off in the view via an outside copy (libraryrow.ts stillReadWords), kind by kind, named among
 * `among`. Callers: applyByKind passes `through` (only rows that went through), runOutcome every row left Off (partial Offs too).
 */
const stillRead = (rows: NamedRow[], among: NamedRow[]) => [...groupBy(rows, row => row.kind)].flatMap(([kind, list]) => {
  const { library, tools } = kindSource(state.home!, kind);
  return stillReadWords(list.flatMap(each => {
    const row = rowByKey(kind, each.key);
    return row && placeOf(library[each.key]) === 'off' ? [{ name: rowNames([each], among)[0]!, row }] : [];
  }), tools);
});

/**
 * One click over rows of several kinds (Turn these off: matrix.ts turnTheseOff): `clicks`, one per kind, carried out kind by
 * kind in turn under one busy, each through its kind's engine (carryOut). A kind's click refused whole (its own record stops its
 * writes, say) is skipped, and said as a problem line (words.ts saidByKind); the others go on. Its result belongs to the page it was clicked
 * on (busy). `said`: what was done, given the rows that went through in every tool (a row whose own change was refused, a stale
 * one, is no row changed: Done changed) and what tools still read another way of them (stillRead). Its result names the rows
 * that changed, and only they flash; one Undo, only when every click that changed something has one, puts them back (undoClick).
 * `now`: what the rows changed are, where the result counts them instead of naming them ("All 10 are off"); `withoutUndo`: what
 * it adds where it offers no Undo, given how many changed; `stays`: it stays until closed or replaced (Outcome stays); `reasons`:
 * extra problem lines after any failures (rows a bulk Turn skipped, with why); `tail`: counts appended on every path (rows already
 * in the asked state or skipped); `failedRow`: per-row reason line for each row kept back in one or more tools (when given, failed
 * rows are named there instead of counted as `now`).
 */
export const applyByKind = (clicks: Click[], said: (changed: NamedRow[], stayed: string[]) => string,
  { now = 'off', withoutUndo, stays, reasons: extra = [], tail, failedRow }: {
    now?: 'on' | 'off' | 'deleted'; withoutUndo?: (count: number) => string; stays?: boolean; reasons?: string[];
    tail?: string; failedRow?: (name: string, failedTools: HarnessId[]) => string;
  } = {}) => busy('Applying…', async page => {
  const several = new Set(clicks.map(click => click.kind)).size > 1, parts: { click: Click; done: Done }[] = [];
  for (const click of clicks) parts.push({ click, done: await carryOut(click, page) });
  const went = parts.filter(part => !part.done.refused), did = parts.filter(part => part.done.did), changed = parts.flatMap(part => part.done.changed ?? []);
  const stops = saidByKind(parts.flatMap(part => (part.done.refused ? [[part.click.kind, part.done.refused] as [PageKind, string]] : [])), several);
  const undos = did.flatMap(part => (part.done.undo ? [part.done.undo] : [])).reverse(), regroups = clicks.some(click => click.regroups);
  const undo = did.length && undos.length === did.length ? () => void undoClick({ rows: changed, regroups }, undos) : undefined;
  keepOwn(parts.map(({ done }) => done.kept));
  // Each row that didn't go through in every tool (its kind refused, its own change held, or a tool kept it back) is said first
  // (words.ts notAllThrough), by its kind where another row asked has its name; `said` then names the rows that went through, or
  // `failedRow` names each row's failed tools in `reasons` (else the lead's count covers them), or nothing changed; `tail` follows on every path.
  const asked = parts.flatMap(({ click, done }) => click.rows.map((row, at) => ({ row: { ...row, name: click.items[at] ?? row.key }, done })));
  const isRow = (entry: DestinationResult, row: NamedRow) => entry.item.toLowerCase() === row.name.toLowerCase();
  const differed = asked.filter(({ row, done }) => done.kept?.results.some(entry => entry.outcome === 'held' && entry.differs && isRow(entry, row))).map(({ row }) => row);
  const left = asked.filter(({ row, done }) => done.refused || !done.changed?.some(each => sameRow(each, row))
    || done.kept?.results.some(entry => keptBack(entry) && isRow(entry, row))).map(({ row }) => row);
  const through = changed.filter(row => !left.some(each => sameRow(each, row))), all = asked.map(({ row }) => row);
  const failedReasons = failedRow ? asked.flatMap(({ row, done }) => {
    const failedTools = [...new Set((done.kept?.results ?? []).filter(entry => keptBack(entry) && entry.harness && isRow(entry, row)).map(entry => entry.harness!))];
    return failedTools.length ? [failedRow(rowNames([row], all)[0]!, failedTools)] : [];
  }) : [];
  const lead = left.length ? notAllThrough(rowNames(left, all), asked.length) : '';
  const after = !changed.length ? 'Nothing changed.' : through.length ? said(through, stillRead(through, all)) : failedRow ? '' : `${countedAs(changed.length, asked.length, now)}.`;
  const back = changed.length && !undo ? withoutUndo?.(changed.length) : undefined;
  const diffReasons = differed.map(row => `${rowNames([row], all)[0]}: ${DIFFERS_REASON}`);
  tellWritten({ page, items: rowNames(changed), rows: changed, kinds: [...new Set(clicks.map(click => click.kind))], band: true, warn: parts.some(part => part.done.outcome.warn) || differed.length > 0, stays,
    text: [lead, after, tail, back].filter(Boolean).join(' '), reasons: [...stops, ...went.flatMap(part => part.done.outcome.reasons ?? []), ...failedReasons, ...diffReasons, ...extra],
    act: undo && { label: 'Undo', id: 'outcome-undo', title: 'Put back everything this did', run: undo } }, parts.flatMap(part => part.done.reloads), did.length > 0);
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
 * skill, a server and an agent there are one run with one result and one Undo, and the segment changed mid-run changes nothing. A row's click is made on the table on screen, so its place is this when it is made.
 */
export const placeNow = () => (state.page === 'harnesses' ? `harnesses ${state.harness ?? ''} ${harnessKindShown() ?? ''}` : state.page);
const itemTurns = (run: Run) => clickList.turns.filter((turn): turn is ItemTurn => isItemTurn(turn) && turn.run === run);
/**
 * The ended clicks of a run that still say each row: its last click that went through, and any after it refused whole, which
 * changed nothing, so what the click before left undone still stands.
 */
const stillSaid = (turns: ItemTurn[]) => turns.filter((turn, at) => turn.done && !turns.slice(at + 1).some(later => later.done && !later.done.refused && sameRow(later.row, turn.row)));
/** One click of each row, so a row two of its clicks still say is counted and named once. */
const once = (turns: ItemTurn[]) => turns.filter((turn, at) => turns.findIndex(other => sameRow(other.row, turn.row)) === at);

/**
 * A row's switch or Add on an item list (matrix.ts flip, pluginRowSwitch): its click joins the page's list and is carried out in
 * its turn, worked out then from the view as it is (`make`; none when nothing is left to change), so the page stays live
 * meanwhile. Its row is drawn in the state it asks for at once (clicklist.ts wantedOn). It joins the run on its table's place, or
 * starts one (clicklist.ts runAt); the run's clicks are said as one result (sayRun).
 */
export function queueClick(row: ItemTurn['row'], name: string, make: () => Click | undefined, isOn: ItemTurn['isOn']): void {
  const turn: ItemTurn = { state: 'waiting', row, name, page: state.page, isOn, run: runAt(placeNow()), work: async () => {
    const before = profilesBefore();
    turn.run.before ??= before;
    const click = make();
    // Nothing left to change in its turn (the click before it took its whole plugin with it, say): as asked already.
    if (!click) turn.done = { did: false, reloads: [], outcome: { page: turn.page, items: [name], rows: [row], text: `${name}: nothing left to change.` } };
    else turn.done = await carryOut(click, turn.page).catch((): Done => ({ did: false, reloads: [], refused: `${name}: ${couldNotFinish()}`, outcome: { page: turn.page, items: [name], rows: [row], warn: true, band: true, text: `${name}: ${couldNotFinish()}` } }));
    // If × ended the run while this click was running, the new run it moved to still compares with before this click ran.
    turn.run.before ??= before;
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
  const check = { checkProfile: turns.some(each => each.done?.did), before: turn.run.before };
  const outcome = turns.length === 1 ? notDoneFirst(done.outcome) : runOutcome(turns);
  if (placeNow() !== turn.run.place) { announce(spoken(withProfileEnded(outcome, check))); return; }
  // Its problem lines are its own: the last click of each of the run's rows.
  keepOwn(stillSaid(turns).map(each => each.done!.kept));
  tell(outcome, '', check);
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
  // Each row as its clicks left it (stillSaid): a row they left something undone in is said first (words.ts notAllThrough); the
  // rows that went through are named after it, or, where none did, the lead's rows are counted (words.ts countedAs). A found row
  // that waits for a choice of copy, as the view after it has it, is neither On nor Off: it is said after them.
  const each = stillSaid(turns), left = each.filter(turn => turn.done!.outcome.warn), answered = once(each.filter(turn => asked.includes(turn)));
  const waits = (turn: ItemTurn) => { const now = rowByKey(turn.row.kind, turn.row.key); return !!now && asksWhichCopy(now) && !left.some(other => sameRow(other.row, turn.row)); };
  const rows = answered.filter(turn => !waits(turn)), waiting = answered.filter(waits);
  // A kind is named where a row of another kind in the run has the same name.
  const named = (turn: ItemTurn): NamedRow => ({ kind: turn.row.kind, key: turn.row.key, name: turn.name }), among = turns.map(named);
  const through = rows.filter(turn => !left.some(other => sameRow(other.row, turn.row))), byState = (list: ItemTurn[]) => [false, true].map(on => list.filter(turn => (turn.isOn() ?? turn.row.on) === on));
  // What stayed of every row the run left Off (gone through or not; a row waiting for a choice is neither), as the view after it
  // has it: the tools still reading them another way.
  const stayed = stillRead(byState(once(each).filter(turn => !waits(turn)))[0]!.map(named), among);
  const namedAs = (group: ItemTurn[], on: boolean) => `${plural(group.length, nouns.one, nouns.many)} ${group.length === 1 ? 'is' : 'are'} ${on ? 'on' : 'off'}: ${fewNames(rowNames(group.map(named), among))}`;
  const said = byState(through.length ? through : rows).map((group, on) => (!group.length ? '' : through.length ? namedAs(group, !!on) : countedAs(group.length, once(each).length, on ? 'on' : 'off'))).filter(Boolean).join('; ');
  const along = did.flatMap(turn => (turn.done!.along ? [`${rowNames([named(turn)], among)[0]}: ${turn.done!.along.replace(/^./, first => first.toLowerCase())}`] : []));
  const undos = did.flatMap(turn => (turn.done!.undo ? [turn.done!.undo] : [])).reverse();
  const undo = did.length && undos.length === did.length ? () => void undoClick({ rows: did.map(named) }, undos) : undefined;
  const lead = left.length ? notAllThrough(rowNames(once(left).map(named), among), once(each).length) : '';
  // A click refused whole gives its refusal as a reason; a click that failed is said by its problem lines, never "Nothing changed".
  return withReloads({ page: turns[0]!.page, items: rowNames(among), rows: turns.map(turn => turn.row), band: true, warn: left.length > 0,
    reasons: each.flatMap((turn): Reason[] => [...(turn.done!.refused ? [turn.done!.refused] : []), ...turn.done!.outcome.reasons ?? []]),
    text: [lead, `${said || 'Nothing changed'}${toGo ? `; ${toGo} to go` : ''}.`, ...along, ...stayed, waiting.length ? copiesDiffer(rowNames(waiting.map(named), among)) : ''].filter(Boolean).join(' '),
    act: undo && { label: 'Undo', id: 'outcome-undo', title: 'Put back everything these clicks did', run: undo } }, ended.flatMap(turn => turn.done!.reloads));
}

/** Whether each History entry a click made still offers its own action, so the click's Undo can run them all. */
function allUndoable(events: HistoryEvent[]) {
  const about = entriesNow(state.home!);
  return events.every(event => !libraryEntry(event) || !!libraryAction(event, about(event).item, about(event).now));
}

/** What an Undo puts back: the rows its clicks changed (named in its result and flashed once it is done), where the focus goes, whether every pinned row is let go, and whether a single-tool Undo says History's own sentence. */
interface UndoOf { rows: NamedRow[]; focus?: () => string; regroups?: boolean; sentence?: boolean }
/** What a whole-plugin turn inside runSwitches needs for Undo (marketplaces.ts undoTurn). */
interface TurnUndo { source: string; plugin: string; before: PluginEntry | null; back: PluginOp[] }
/** What one click can take back (Done undo): its kind, the History entries it made, and the plugin switches and whole-plugin turns that turn its plugins' part back. */
interface Undoable { kind: PageKind; made: string[]; back: PluginOp[]; turns?: TurnUndo[] }

/**
 * Undo of one click, or of several as one (a run, Turn these off): their plugin items' switches first, then every History entry
 * they made, newest first, each by its own action (historyactions.ts). An entry History no longer holds, or one whose Undo is
 * stopped (its kind's record, say), is said once as a problem line (words.ts saidByKind: led by its kind where the Undo spans several), and
 * the later entries of a stopped kind are left; the other kinds' still go back, and the result names them. A tool problem from an
 * earlier restore that a later restore of the same item put right, confirmed against the refreshed view, is dropped. Each kind's
 * last result becomes what its own entries' Undo did.
 */
const undoClick = (about: UndoOf, parts: Undoable[]) => busy('Undoing…', async page => {
  const home = state.home!, several = new Set(parts.map(part => part.kind)).size > 1;
  // The plugin items' switches go back first: other tools than the copies', so the rest is undone whatever they do (`parts` arrives newest first).
  const switchedBack = parts.flatMap(part => part.back), turnsBack = parts.flatMap(part => part.turns ?? []);
  const unswitched = switchedBack.length || turnsBack.length ? await runSwitches(switchedBack, true, turnsBack) : undefined;
  const kindOfEntry = new Map(parts.flatMap(part => part.made.map(id => [id, part.kind] as const)));
  // History is stored newest-last (history.ts); reversing first keeps entries written in the same millisecond newest-first.
  const events = (await api().history()).events.filter(event => kindOfEntry.has(event.id)).reverse()
    .sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  const gone = [...kindOfEntry].filter(([id]) => !events.some(event => event.id === id));
  type UndoEntry = { key?: string; entry: DestinationResult; answeredLater?: boolean };
  const raw = new Map(parts.map(part => [part.kind, [] as UndoEntry[]])), restored = new Map(parts.map(part => [part.kind, new Map<string, Set<HarnessId> | null>()])), stops = new Map<PageKind, string>();
  const reloads: ReloadChange[] = unswitched ? pluginReloads(unswitched.done) : [];
  let anyDid = !!unswitched?.done.some(entry => succeeded(entry.report));
  for (const event of events) {
    const kind = kindOfEntry.get(event.id)!;
    if (stops.has(kind)) continue;
    const result = await api().restore(event.id, home.home);
    if (result.stopped) { stops.set(kind, result.stopped); continue; }
    const held = result.results.some(entry => heldWhole(entry) || keptBack(entry));
    if (result.made?.length || result.harnessWrites > 0 || !held) anyDid = true;
    reloads.push(...result.reloads);
    const key = libraryEntry(event)?.key, list = raw.get(kind)!;
    // A later restore of the same item in this Undo answers an earlier tool problem: replaced if that tool failed again,
    // or dropped below once settled. restore runs with `only`, so every result in result.results belongs to this item.
    if (key) {
      const scope = restored.get(kind)!, prev = scope.get(key);
      scope.set(key, !event.only || prev === null ? null : new Set([...(prev ?? []), event.only]));
      const failedNow = new Set(result.results.filter(entry => entry.harness && keptBack(entry)).map(entry => entry.harness!));
      for (let at = list.length - 1; at >= 0; at--) {
        const earlier = list[at]!;
        if (earlier.key !== key || !earlier.entry.harness || !keptBack(earlier.entry)) continue;
        if (failedNow.has(earlier.entry.harness)) list.splice(at, 1); else earlier.answeredLater = true;
      }
    }
    list.push(...result.results.map(entry => ({ key, entry })));
  }
  setHome(await api().refresh());
  await refreshPlugins(true);
  // Settled: managed, readable, and matching what the library now wants (not held or owed a write/removal; nothing applied if deleted).
  const settledIn = (kind: PageKind, key: string, tool: HarnessId) => {
    const view = state.home?.[kind], row = view?.items.find(fact => fact.key === key), item = view?.library[key];
    const live = item && !item.deleted;
    const heldByPlugin = !!row?.fromSource && !!pluginOf(row.fromSource.link) && takesPlugins(tool);
    return !!view?.tools.includes(tool) && !row?.unseen?.[tool]
      && (live ? !(row?.cannot?.[tool] && !row?.plugin?.[tool] && !heldByPlugin) && !row?.plan?.write.includes(tool) && !row?.plan?.remove.includes(tool) : item?.applied[tool] === undefined);
  };
  // One look at the refreshed view, both ways: drop answered problems now settled, and add any wanted or owed tool still unsettled.
  const kept = new Map([...raw].map(([kind, list]) => {
    const entries = list.filter(each => !(each.answeredLater && each.key && each.entry.harness && settledIn(kind, each.key, each.entry.harness)));
    if (!stops.has(kind)) for (const [key, onlyTools] of restored.get(kind)!) {
      const view = state.home?.[kind], row = view?.items.find(fact => fact.key === key), item = view?.library[key];
      const checkTools = view && (onlyTools ? view.tools.filter(each => onlyTools.has(each)) : view.tools);
      if (checkTools && item) for (const tool of checkTools) {
        if (!((!item.deleted && wantedIn(item, tool)) || item.applied[tool] !== undefined) || settledIn(kind, key, tool)) continue;
        if (entries.some(each => each.key === key && each.entry.harness === tool && keptBack(each.entry))) continue;
        entries.push({ key, entry: { item: item.name, harness: tool, outcome: 'held', message: row?.cannot?.[tool] ?? row?.unseen?.[tool] ?? `Could not put ${toolName(tool)}’s copy back yet.` } });
      }
    }
    return [kind, entries] as const;
  }));
  const results = new Map([...kept].map(([kind, list]) => [kind, list.map(each => each.entry)]));
  focusAfterBusy = about.focus?.();
  await putHistory();
  keepOwn([...results].map(([kind, list]) => ({ kind, results: list, notices: [] })));
  const missing = [...groupBy(gone, ([, kind]) => kind)].map(([kind, of]): [PageKind, string] =>
    [kind, `${plural(of.length, 'History entry', 'History entries')} it was to put back ${of.length === 1 ? 'is' : 'are'} no longer in History.`]);
  const reasons = [...saidByKind([...stops, ...missing], several), ...switchReasons(unswitched)], undone = !reasons.length && ![...results.values()].flat().some(keptBack);
  // What did go back, where some of it didn't: the rows of the kinds whose entries all went back as they were, and whose plugin
  // switches, if they had any to turn back, all went back too.
  const short = new Set([...stops.keys(), ...gone.map(([, kind]) => kind)]), names = (rows: NamedRow[]) => [...new Set(rowNames(rows, about.rows))];
  const switchesShort = new Set(unswitched && switchProblems(unswitched).length ? parts.filter(part => part.back.length || part.turns?.length).map(part => part.kind) : []);
  const all = names(about.rows), asBefore = names(about.rows.filter(row => !short.has(row.kind) && !switchesShort.has(row.kind) && !results.get(row.kind)?.some(keptBack)));
  const failed = names(about.rows.filter(row => switchesShort.has(row.kind) || kept.get(row.kind)?.some(each => keptBack(each.entry) && (each.key ? each.key === row.key : each.entry.item.toLowerCase() === row.name.toLowerCase()))));
  const are = (list: string[]) => `${fewNames(list)} ${list.length === 1 ? 'is' : 'are'} as before`;
  const single = about.sentence && undone && !unswitched && events.length === 1 && events[0]!.only ? events[0]! : undefined;
  const singleKind = single && kindOfEntry.get(single.id);
  const singleMade = single && state.history.data?.find(each => each.id === state.history.data?.find(past => past.id === single.id)?.undoneBy);
  const singleView = singleKind ? state.home?.[singleKind] : undefined;
  const singleSaid = singleMade && singleKind && librarySentence(singleMade, libraryWords[singleKind], singleView?.tools ?? [], singleView?.library[libraryEntry(single!)!.key], true)?.text;
  tellWritten({ page, items: all, rows: about.rows, warn: !undone, band: true, fade: undone, reasons,
    text: singleSaid ? `${single!.item}: ${singleSaid.replace(/^./, first => first.toLowerCase())}` : undone ? `Undone: ${are(all)}.` : short.size ? `Not all of it could be undone${several && asBefore.length ? `; ${are(asBefore)}` : ''}.` : `Not all of ${fewNames(failed.length ? failed : all)} could be put back.` }, reloads, anyDid);
  for (const row of about.rows) flashRow(row);
  if (about.regroups) unpin();
});

/** What a run of plugin switches couldn't do, each in its own words ("issue-tracker: couldn’t turn it on in Codex."). */
const switchProblems = (ran: Awaited<ReturnType<typeof runSwitches>>) => [...(ran.stopped ? [ran.stopped] : []), ...ran.failed.map(line => `${line.plugin}: ${line.text.replace(/\.$/, '')}.`)];
/** A click's reasons (Outcome) from its plugin switches' run, one for each failure: what it couldn't do, then `also`, what the click left as it is. */
export const switchReasons = (ran: Awaited<ReturnType<typeof runSwitches>> | undefined, also: string[] = []) => [...(ran ? switchProblems(ran) : []), ...also];
/** The key under which a background pass's problem the person closed is remembered (state.dismissed). */
export const problemKey = (entry: DestinationResult) => `problem:${entry.of ?? ''}:${entry.item}:${entry.harness ?? ''}:${entry.message}`;

/**
 * Runs plugin switch choices (pluginswitch.ts): whole-plugin turns for listed plugins go through `turn` (`plugins:turn`, writing
 * the plugins record and undoing through `undoTurn`), while per-item switches and unlisted plugins use each tool's own switch. A
 * plugin that failed to come on leaves no item switched off for it: those written before it are put back. Returns what ran, in
 * lines, the tools where something didn't, and the choices and turns that turn it all back.
 */
export async function runSwitches(ops: PluginOp[], undo = false, turnsIn: TurnUndo[] = []) {
  // A plugin changes here as it does on its own page: the Plugins list's rows from before are no longer true (pluginstate.ts), and
  // each plugin's earlier results and their Undo go (pluginstate.ts retire).
  endListNews();
  for (const plugin of new Set([...ops.map(op => op.plugin), ...turnsIn.map(turn => turn.plugin)])) retire(plugin);
  const home = state.home!.home;
  const turns: TurnUndo[] = [], turned = new Set<string>();
  const setWhole = async (source: string, marketName: string, plugin: string, tool: HarnessId, on: boolean, at: string) => {
    if (undo || !source) return api().setPluginOn(source, marketName, plugin, tool, on, at);
    const res = await api().turnPlugin(source, plugin, on ? 'let-in' : 'keep-out', tool, at);
    if (res.stopped) return { reports: [], stopped: res.stopped };
    const mine = res.done.filter(step => step.tool === tool), back = res.back ?? [];
    if (back.length) {
      turns.push({ source: back[0]!.source || mine[0]?.source || source, plugin, before: res.before ?? null, back });
      turned.add(`${source}\0${plugin}\0${tool}\0${on ? 'plugin-on' : 'plugin-off'}`);
    }
    const reports = mine.length ? mine.map(step => step.report) : [{ tool, outcome: on ? 'plugin-on' as const : 'plugin-off' as const, message: `Already ${on ? 'on' : 'off'} in ${toolName(tool)}.`, runs: [] }];
    return { reports };
  };
  const plan = { install: api().installPlugin, uninstall: api().uninstallPlugin, setSkill: api().setPluginSkill, setPart: api().setPluginPart, setWhole };
  const undone: PluginDone[] = [];
  let stopped: string | undefined;
  if (undo) {
    for (const turn of turnsIn) {
      const res = await api().undoPluginTurn(turn.source, turn.plugin, turn.before, turn.back, home)
        .catch(() => ({ stopped: 'It stopped unexpectedly. Refresh to see where it stands.', done: [] as PluginDone[] }));
      undone.push(...res.done);
      if (res.stopped) {
        stopped = res.stopped;
        break;
      }
    }
  }
  const result = !stopped && ops.length ? await runPlan(ops, plan, home) : { done: [] as PluginDone[] };
  stopped ??= result.stopped;
  const strays = strayHolds(result.done);
  const putBack = strays.length ? (await runPlan(reverse(strays), plan, home)).done : [];
  const restored = strays.filter(stray => putBack.some(back => back.tool === stray.tool && back.plugin === stray.plugin && back.skill === stray.skill && back.part?.kind === stray.part?.kind && back.part?.name === stray.part?.name && succeeded(back.report)));
  const done = [...undone, ...result.done.filter(entry => !restored.includes(entry))];
  const lines = resultLines(done, undo);
  const ran = (op: PluginOp) => done.some(entry => entry.tool === op.tool && entry.plugin === op.plugin && succeeded(entry.report));
  const failedIn = [...new Set([...done.filter(entry => !succeeded(entry.report)).map(entry => entry.tool), ...ops.filter(op => !ran(op)).map(op => op.tool)])];
  const ownBack = undo ? [] : reverse(done.filter(entry => !turned.has(`${entry.source}\0${entry.plugin}\0${entry.tool}\0${entry.action}`)));
  return { done, lines, failed: lines.filter(line => !line.ok), failedIn, back: ownBack, turns: undo ? [] : [...turns].reverse(), stopped };
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
  // its notice: either is a change, so neither read says "Nothing changed". Nor does a read while a list still keeps an
  // earlier read's notice (matrix.ts noticesKept): side by side, the two would read as a contradiction.
  const caught = caughtUpNames(view).items.length > 0;
  const told = [view.skills.notices, view.mcp.notices, view.agents.notices].some(notices => notices.length > 0);
  return `Read ${andList(counts)}${from ? ` from ${from}` : ''}.${caught || told || noticesKept() ? '' : ' Nothing changed.'}`;
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
  // What a list of plugin clicks said is not restated over a home read again, nor a line's result (pluginstate.ts LineResult).
  endListNews();
  forgetResults();
  resetHookSources();
  await busy(noToolManaged() ? 'Reading…' : `Reading ${heldKindNames()}…`, async () => {
    const view = await api().refresh(true);
    if (!view) return;
    resetHookSources();
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
/** Why writing controls on the Library's list are off while Select's mode is active (selection.ts): none on any other view or page. */
export const selectOff = (): string | undefined => (state.page === 'library' && state.libraryView === 'list' && selecting() ? 'Done ends selecting' : undefined);
/** Why a write other than a row's own switch or Add is off now, if it is: the page acts (acting), Select's mode is on (selectOff), or `stops`. */
export const writeOff = (stops: boolean): string | boolean => acting() ?? selectOff() ?? stops;

/**
 * Reads what a page shows beyond the home itself: History, Settings, Instructions, Sessions or Plugins, into its slot
 * (pagedata.ts), never as an action: the page says it is reading, and anything else can go on meanwhile. `fresh` reads
 * each marketplace anew.
 */
function loadPageData(page: Page, { fresh = false, readId }: { fresh?: boolean; readId?: number } = {}): Promise<void> {
  if (page === 'history') return Promise.all([loadHistory(), loadSettings()]).then(() => undefined);
  if (page === 'settings') return loadSettings().then(() => undefined);
  if (page === 'instructions') return loadInstructions(readId);
  if (page === 'sessions') return loadSessions(readId);
  // Harnesses sums up each tool's instruction file and installs, as Instructions and Plugins read them. It only counts installs,
  // so its Refresh reads the tools again without fetching every marketplace anew (Plugins' Refresh does that).
  if (page === 'harnesses') return Promise.all([loadInstructions(readId), absentKinds().includes('plugins') ? undefined : loadPlugins(false, readId)]).then(() => undefined);
  if (page === 'plugins') return loadPlugins(fresh, readId);
  if (page === 'repo') return loadRepo(true);
  if (page === 'sources') return loadSources();
  return Promise.resolve();
}

/** When the open page's kind is no longer in this home (its last tool went; the Library's, every kind it lists), the Overview opens instead. */
function leaveAbsentPage() {
  // MCP sign-in is about MCP servers, as the Library's MCP segment is.
  const gone = state.page === 'library' ? (state.home && !heldKinds(state.home).length ? KINDS : []) : absentKinds().filter(kind => kind === (state.page === 'mcpsignin' ? 'mcp' : state.page));
  if (!gone.length) return;
  // What the status bar said (a Refresh's summary, say) stays, with the reason the page moved.
  const said = state.said.text;
  showPage('overview', { repair: true });
  announce(`${said ? `${said} ` : ''}No tool here holds ${andList(gone.map(kind => kindNames[kind]))} now.`);
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
  // Another page, or another tool's page, ends the run of clicks (clicklist.ts) once they are carried out. A run still being
  // carried out goes on, whatever page is open meanwhile, and is said whole where its result belongs (sayRun).
  if (!clickList.running) endRun();
  const carried = state.outcome?.carry ? { ...state.outcome, page, carry: false } : undefined;
  state.skillsResult = undefined; state.mcpResult = undefined; state.agentsResult = undefined;
  tell(carried);
}

let moveRequested: 'visit' | 'back' | undefined;
// Functions that move the person mark a visit for the next draw. A read that changes the place leaves it a repair. A page's own
// Back control (matrix.ts backFromFiles, pluginspage.ts's breadcrumb) marks its move `back`, which the moves it makes keep:
// where it lands on the visit before, places.ts goes Back to that visit instead. The controls mark it here rather than call
// places.ts: a page importing places.ts would load the modules places.ts imports before app.ts has finished loading
// (editparts.ts then reads `machine` too early; tests/clicklist.test.ts fails).
export const noteMove = (move: 'visit' | 'back' = 'visit') => { if (moveRequested !== 'back') moveRequested = move; };
export const takeMove = () => { const moved = moveRequested; moveRequested = undefined; return moved; };

export function showPage(page: Page, { repair = false } = {}) {
  if (!repair) noteMove();
  // Plugins keep what they read while the person stays on them; every other page reads its data each time it opens.
  const stays = page === 'plugins' && state.page === 'plugins';
  // The sidebar's Harnesses opens the list of every harness, except while an action runs: its result belongs to the harness it
  // started on. Leaving a harness's page this way drops that page's result, as its own back arrow does.
  const leavingHarness = page === 'harnesses' && !state.busy && !!state.harness;
  // A new page drops the last page’s result (plugin runs stay tied to their own place: pluginstate.ts pluginsResultPlace).
  if (page !== state.page || leavingHarness) leaveResults(page);
  if (page !== state.page) { state.libraryView = 'list'; state.visit += 1; forgetRepoPrompts(); forgetSourcePrompts(); forgetHistoryFolds(); forgetManageQuestion(); }
  if (leavingHarness) state.harness = undefined;
  // Settings opens fresh (what its rows said last visit belongs to that visit); every other page reads its own data.
  state.page = page;
  if (page === 'settings') openSettings();
  else if (!stays) {
    if (page === 'history') openHistoryWindow();
    void loadPageData(page);
  }
  state.find = '';
  state.item = undefined;
  rerender();
}

export const filesSkillAvailable = (home: HomeView, key?: string) => home.skills.items.some(skill => key === undefined || skill.key === key);

/** Leaves the Library's Files view for its list (its Back button, or Escape: matrix.ts backFromFiles). */
export function leaveFiles() {
  noteMove();
  state.libraryView = 'list';
  state.item = undefined;
  rerender();
}

export function selectItem(key: string | undefined) {
  noteMove();
  state.item = key;
  rerender();
  document.getElementById('detail-scroll')?.scrollTo(0, 0);
}

/** Reveals a file in the system file manager; nothing is opened or changed. */
export const showFile = (path: string) => void api().showFile?.(path);

/**
 * A path as the page shows it, shorter on screen only: inside the real home it starts at ~, inside the practice copy or a
 * chosen folder at "…", with `/` separators on every platform. Copying and tooltips give the full path.
 */
export const shownPath = (path: string) => shownFromHome(path, state.home, platform);

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
export async function putHistory() {
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
  const result = received(await api().restore(eventId, home.home, choice));
  const view = await api().refresh();
  await putHistory();
  // Dismiss the notices of what this Undo took back before setHome carries unseen ones on; a multi-item taken-in notice goes only once every item it names is undone.
  if (!result.stopped) {
    const events = state.history.data ?? [];
    const undos = new Set(events.find(event => event.id === result.made?.[0])?.everything?.undo?.itemUndos ?? []);
    const taken = new Set([eventId, ...(undos.size ? events.filter(event => event.undoneBy && undos.has(event.undoneBy)).map(event => event.id) : [])]);
    const allUndone = new Set([...taken, ...events.filter(event => event.undoneBy).map(event => event.id)]);
    const takenIn = [...(state.home ? KINDS.flatMap(kind => state.home![kind].notices) : []), ...keptNoticeList(), ...backgroundNews.map(entry => entry.notice)]
      .filter((notice): notice is TakenInNotice => notice.kind === 'taken-in' && !!notice.histories?.length);
    const stillKept = new Set(takenIn.filter(notice => notice.histories!.some(id => !allUndone.has(id))).map(notice => notice.history));
    for (const id of taken) if (!stillKept.has(id)) state.dismissed.add(id);
    for (const notice of takenIn) if (notice.histories!.some(id => taken.has(id)) && !stillKept.has(notice.history)) state.dismissed.add(notice.history);
  }
  setHome(view);
  // A source's band offers its click's Undo (sourcespage.ts whatItDid): its rows say what waits there now.
  if (state.page === 'sources') await loadSources();
  await refreshPlugins();
  const restored = result.results.filter(entry => entry.outcome === 'written');
  const where = [...new Set(restored.map(entry => entry.harness ?? ''))].filter(Boolean);
  const past = state.history.data?.find(event => event.id === eventId);
  // An Undo of a profile switch lists what it couldn't change in its own band, so the page's problems band gets only a stop.
  // Synchronize everything's covers every kind: its band says what it couldn't do (sayEverything), no page's problems band.
  if ((past?.kind !== 'profile' && past?.kind !== 'everything') || result.stopped) keepOwn([{ kind: (past && libraryEntry(past)?.kind) || 'agents', results: result.results, notices: result.notices }]);
  if (past?.kind === 'profile') {
    // Each item it turned back has its own History entry, with its own action: the band offers no Undo of the Undo.
    if (result.stopped) tell({ page, text: `Undo switch to ${past.profile?.toName ?? past.item}: nothing was undone. ${result.stopped.replace(/ Nothing was undone\.$/, '')}`, warn: true, band: true, history: page !== 'history', refused: true });
    // A plugin a press on Profiles turned on stays on: its Undo is the press's own (pluginstate.ts stillOnFromProfiles).
    // An item it turned off that a tool still loads (his own copy there) is named among what it left.
    else if (result.switched) turnedOutcome(page, 'Undone', { ...result.switched, since: [...result.switched.since ?? [], ...(state.home && past.profile ? leftLoadingAfter(past.profile, state.home) : [])] },
      result.results, result.reloads, { fade: true, kept: stillOnFromProfiles() });
    return;
  }
  const everywhere = touchedToolsPhrase(where);
  // A Pull's edit or deletion of the base instructions: its Undo has no event of its own to offer again.
  if (past?.base) {
    tell(result.stopped ? undefined : { page, item: past.item, text: result.results.map(entry => entry.message).join(' ') }, result.stopped);
    return;
  }
  const did = !result.stopped && (!!result.made?.length || result.harnessWrites > 0);
  if (past && libraryEntry(past)) { sayLibraryAction(page, past, result, did); return; }
  if (past?.kind === 'everything') { sayEverything(page, past, result, switchesOn, did); return; }
  // A Pull's change to an agent's Claude Code settings alone (gitrepo.ts undoSettingsChange): the one entry with an Undo of its own,
  // an agent's (its row flashes in the Library).
  const item = restored[0]?.item ?? past?.item ?? '', row = { kind: 'agents' as const, key: itemKey(item) };
  const done = !result.stopped && restored.length > 0;
  tell(done ? { page, item, rows: [row], history: true, text: `Undid the change to ${item}. The earlier version is back in ${everywhere}.` } : undefined, result.stopped ?? `Restored in ${plural(0, 'tool')}.`);
  if (done) flashRow(row);
});

/**
 * After a History action on a library item, a skill, an MCP server or an agent (historyactions.ts): what it did, in the words of the entry
 * it made, with that entry's own action as the way back. A refusal is said on the page, where the action was clicked.
 */
function sayLibraryAction(page: Page, past: HistoryEvent, result: ApplyResult, did = true) {
  const entry = libraryEntry(past)!, rows = [entry];
  // Refused whole (it waits for the shared skills folder, say: librarypass.ts click), it is said as a stop: nothing was done.
  const refused = result.stopped ?? (result.made?.length ? undefined : result.results.find(heldWhole)?.message);
  if (refused) { tell({ page, item: past.item, rows, text: `${past.item}: ${refused}`, warn: true, history: true, refused: true }); return; }
  const view = state.home?.[entry.kind];
  const made = state.history.data?.find(event => event.id === past.undoneBy);
  const item = view?.library[entry.key];
  const said = made && librarySentence(made, libraryWords[entry.kind], view?.tools ?? [], item, true)?.text;
  const back = made && libraryAction(made, item, entriesNow(state.home!)(made).now);
  const notDone = result.results.filter(keptBack).map(entry => entry.message);
  const text = [`${past.item}: ${said ? said.replace(/^./, first => first.toLowerCase()) : 'done.'}`, ...notDone].filter(Boolean).join(' ');
  tellWritten({ page, item: past.item, rows, warn: notDone.length > 0, text, undo: back && made ? { id: made.id, label: back.label } : undefined }, result.reloads, did);
  flashRow(entry);
}

/**
 * After Synchronize everything's one Undo, or that Undo's Restore (everything.ts everythingEntryAction): what it did, in the Undo's
 * entry's words, or what the Restore put back; what it could not do after it, each sentence once. Which it was is the entry clicked:
 * an Undo's entry (`undo`) offers the Restore, a switch-on the Undo. `switchedOn`: the Restore switched the rule on again
 * (restoreEvent, from restorePlan before the click); a switch made in Settings since is not its doing.
 */
function sayEverything(page: Page, past: HistoryEvent, result: ApplyResult, switchedOn: boolean, did = true) {
  const onSettings = page === 'settings';
  if (result.stopped) { tell({ page, item: past.item, text: result.stopped, warn: true, history: true, refused: true, ...(onSettings ? { settingsBand: true } : {}) }); return; }
  const made = (result.made ?? []).map(id => state.history.data?.find(event => event.id === id));
  const text = everythingDone(past, made, made.filter(event => event?.kind === 'restored').length, switchedOn);
  const notDone = [...new Set(result.results.filter(keptBack).map(entry => entry.message))];
  tellWritten({ page, item: past.item, warn: notDone.length > 0, ...(onSettings ? { band: true, settingsBand: true } : { history: true }), text: [text, ...notDone.slice(0, 3)].filter(Boolean).join(' ') }, result.reloads, did);
}

// ---------- A skill's own two actions ----------

/**
 * A skill's two actions a click on its row can't carry (skills.ts clearSwitch, takeOver): a tool's own switch cleared, or a copy
 * outside Central Knot's taken over. What it did is said in the band, with no Undo there: Take over has none (the band and its
 * History entry say so); a cleared switch's Undo is its History entry's action (skills.ts switchBack).
 */
export const skillAction = (action: 'clear-switch' | 'take-over', key: string, tool: HarnessId, name: string, kind: 'skills' | 'agents' = 'skills') =>
  busy(action === 'take-over' ? 'Taking it over…' : 'Clearing the switch…', async page => {
    const home = state.home!, of = kind === 'agents' ? 'agent' : 'skill';
    const result = received(await (action === 'take-over' ? api().takeOverSkill(key, tool, clickResumes(home), home.home) : api().clearSkillSwitch(key, tool, clickResumes(home), home.home, of)));
    setHome(await api().refresh());
    keepOwn([{ kind, results: result.results, notices: result.notices }]);
    const row = { kind, key };
    if (result.stopped) { tell({ page, item: name, rows: [row], text: result.stopped, warn: true, band: true, refused: true }); return; }
    // Letting a tool load it again has an Undo (its History entry's: the switch set again); a take-over has none, and says so.
    const said = `${name}: ${result.results[0]?.message ?? 'done.'}${action === 'take-over' ? ' This has no Undo.' : ''}`;
    const entry = action === 'clear-switch' ? result.made?.[0] : undefined;
    tellWritten({ page, item: name, rows: [row], band: true, text: said,
      act: entry ? { label: 'Undo', id: 'outcome-undo', title: `Turn ${name} off again in ${toolName(tool)}’s own settings`, run: () => void restoreEvent(entry) } : undefined }, result.reloads);
    flashRow(row);
  });

// ---------- Results ----------

/** What an action did: its sentence, the items it names, and what it offers next (its own button, Undo, or History). */
export interface Outcome {
  page: Page;
  /** What happened and where, with no reason in it. */
  text: string;
  /** Why some of it wasn't done: each said once, as a problem line under `text` (matrix.ts listResult). */
  reasons?: Reason[];
  /** Something was left undone: a warning icon, not a tick. */
  warn?: boolean;
  note?: string;
  /** The names it says, for its words alone (bold in its band), each with its kind where another kind's has its name (words.ts rowNames): `rows` is whose it is. */
  item?: string;
  items?: string[];
  /** The rows it is about: an open copy question of one of them, or the Files view of another skill, hides it (matrix.ts outcomeShown). */
  rows?: RowKey[];
  /** A run over several kinds (Turn these off: applyByKind): its kinds, so each problem line under it is led by its kind (matrix.ts listResult). */
  kinds?: PageKind[];
  /** Said again on the next page opened (a home just opened). */
  carry?: boolean;
  /** A saved instruction goes on its card (instructionspage.ts). */
  kind?: 'saved';
  tool?: HarnessId;
  /** Offers a History link in the band ("History" when `refused`, else "Undo in History") and keeps the result out of the status bar (matrix.ts outcomeBand). */
  history?: boolean;
  /** Nothing was done, its reason the text: History is offered as itself, not as where its Undo is (matrix.ts outcomeBand). */
  refused?: boolean;
  /** Shown as a band even with nothing to offer: a click's result, which belongs where the click's Undo would be; Settings draws a band only for reload advice or `settingsBand` (settingspage.ts). */
  band?: boolean;
  /** Shown as a band on Settings even without reload advice: Synchronize everything's switch-on and its band's Undo (settingspage.ts). */
  settingsBand?: boolean;
  /** Switch-on History entry id whose Undo this Settings band holds, so only covered take-in lines drop History (settingspage.ts). */
  everythingUndo?: string;
  /** Shown as a band on History even without warn, reloads or profileLine: a tool's Manage click (managecard.ts, historypage.ts). */
  historyBand?: boolean;
  /** Appended profileEndedLine words (`Everyday · changed`, or profileLeftUse's sentence) when an act ended every profile in use; keeps the result in a band (saidInStatusBar) and whole on Row 2 (matrix.ts listResult, profileSpan). */
  profileLine?: string;
  /** The band goes after a few seconds: an Undo's confirmation. */
  fade?: boolean;
  /** It stays in the header until closed or replaced, problems or none: a Delete of many's, whose Undo is many History Restores (fadeNow). */
  stays?: boolean;
  /** The plugins whose acts its Undo turns back: an act on one of them, from any page, retires it (pluginstate.ts retire). */
  plugins?: string[];
  undo?: { id: string; label: string };
  act?: {
    label: string; id: string; run: () => void; title?: string;
    /** Why it is off now, asked at each drawing (a home's Go back while the page acts). */
    whyOff?: () => string | undefined;
  };
  /** A second button after `act`: the next step the result offers (the whole plugin's switch, "Turn its plugins off in Codex"). */
  next?: { label: string; id: string; run: () => void; title?: string };
  /** Confirmed writes for reload advice (Copy buttons and the opened row's join: reload.ts). */
  reloads?: ReloadChange[];
  /** When it was said (state.said.seq): a result newer than a table's pending changes still shows there. */
  said?: number;
}

/** Settles chronological reload changes and attaches them only when at least one tool needs a reload action (reload.ts). */
export function withReloads(outcome: Omit<Outcome, 'reloads'>, changes: readonly ReloadChange[]): Outcome {
  const reloads = settleReloads(changes);
  return hasReloadAdvice(reloads, toolWays()) ? { ...outcome, reloads } : outcome;
}
/** The one door for every writing route's result: settles its required reload changes and tells the page. */
export const tellWritten = (outcome: Omit<Outcome, 'reloads'>, changes: readonly ReloadChange[], checkProfile = true): void => tell(withReloads(outcome, changes), '', { checkProfile });

/**
 * Whether a result is said in the status bar rather than as a band: it offers nothing to do (no button, Undo, Copy or History
 * link, and no ended profile), so it needs no room of its own.
 */
export const saidInStatusBar = (outcome: Outcome): boolean => !(outcome.act || outcome.undo || outcome.history || outcome.note || outcome.band || outcome.profileLine || outcome.reloads?.length);

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

/** The Undo's hover on a band after a switch-on: what it does, with no count (a later pass adds more, and the Undo takes those back too). */
const undoEverything = `Switches Synchronize everything off. ${oneUndoCovers('It', false)}`;

/**
 * What Synchronize everything did once switched on, from History: how many items the switch-on entry `event` (everything.ts
 * setSyncEverything's id) added so far (historyactions.ts everythingPlan), and History's own Undo of it (everythingAction). None
 * where the open home is no longer `home`, or History has no such entry.
 */
export async function everythingSwitchedOn(event: string | undefined, home: string): Promise<{ added: number; undo?: Outcome['act'] }> {
  if (!event || state.home?.home !== home) return { added: 0 };
  await putHistory().catch(() => undefined);
  const events = state.history.data, entry = events?.find(each => each.id === event);
  if (!entry || !events || !state.home) return { added: 0 };
  const about = entriesNow(state.home), offer = everythingAction(entry, events, about);
  const undo = offer && { label: offer.label, id: 'outcome-undo', title: undoEverything, run: () => { if (state.home?.home === home) void restoreEvent(event); } };
  return { added: everythingPlan(entry, events, about).added, undo };
}

/**
 * Synchronize everything, the open home's standing rule, on or off: Settings' switch, first setup's Yes (`answering`: refused once
 * the home has an answer, everything.ts setSyncEverything) and the band after its No. Turned on, main's next pass adds what is
 * found now: at once with Automatic sync on, at Sync once (or once it is turned on) with it off. One band says it, on the page
 * clicked on: what it added, or that nothing is added yet (with Sync once), and the switch-on's Undo (everythingSwitchedOn). Answers why
 * not, if it couldn't be set.
 */
export const switchSyncEverything = (on: boolean, answering = false) => busy(on ? 'Turning on Synchronize everything…' : 'Turning off Synchronize everything…', async page => {
  const home = state.home!.home;
  const set = await api().setSyncEverything(on, home, answering);
  if (set.view) setHome(set.view);
  if (set.stopped) {
    announce(`Synchronize everything was not changed. ${set.stopped}`);
    return;
  }
  if (!on) {
    announce('Synchronize everything is off: what turns up in a tool waits for Add.', true);
    return;
  }
  const { added, undo } = await everythingSwitchedOn(set.event, home), syncOn = !!state.home?.syncOn;
  const text = !syncOn ? 'Synchronize everything is on. Nothing added yet: Automatic sync is off.'
    : `Synchronize everything is on${added ? `: it added ${plural(added, 'item')}` : ''}.`;
  const once = { label: 'Sync once', id: 'outcome-sync-once', title: 'Add what is found now; Automatic sync stays off', run: () => void syncNow() };
  tellWritten({ page, band: true, settingsBand: true, ...(undo && set.event ? { everythingUndo: set.event } : {}), text, ...(syncOn ? { act: undo } : { act: once, next: undo }) }, syncOn ? set.reloads : [], !!set.event);
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
    // A new result: no click's reasons from before stay under it.
    keepOwn([]);
    tellWritten({ page, band: true, history: result.history, text: result.text, reasons: result.reasons, warn: result.warn }, result.reloads, result.did !== false);
  });
}
api().onSyncRequest(() => { if (acting()) menuSyncHome = state.home?.home; else void syncNow(); });

/** A background read is running, or one arrived while the page was acting and runs when it is done (afterActing). */
let refreshing = false;
let refreshOwed = false;
/** A background reply that landed while the page acted. The next view of its home takes it in (setHome). */
let setAside: HomeView | undefined;
/** A menu-bar profile switch that arrived while the page acted or refreshed, applied once that ends (drainOwedRefresh). */
let pendingSwitch: ProfileSwitchResult | undefined;
/** An in-flight readHomeOnce call, shared by callers that await the same read (clicklist.ts, matrix.ts showRow). */
let homeRead: Promise<void> | undefined;
/** Whether the home waits to be read (or is being read) for a run of clicks or a plugin's click (oweHomeRead, readHomeOnce). */
export const homeReadOwed = () => refreshOwed || !!homeRead;
/** A plugin's click changed what the item lists show: the home is read once at the run's end (clicklist.ts), not after each click. */
export const oweHomeRead = () => { refreshOwed = true; };
/**
 * The home read again by a Plugins action before it ends (pluginstate.ts readAgain), at a run of clicks' end (clicklist.ts),
 * or by a link to a row not in this read yet (matrix.ts showRow): stands for a background refresh owed meanwhile, and shares
 * an in-flight read so two callers run one IPC.
 */
export function readHomeOnce(): Promise<void> {
  if (homeRead) return homeRead;
  refreshOwed = false;
  const reading = api().refresh().catch(() => null).then(view => {
    if (homeRead === reading) homeRead = undefined;
    setHome(view);
  });
  return (homeRead = reading);
}
// The Settings… menu item (and any later page the main process asks for) opens that page.
const isPage = (page: string): page is Page => (pages as readonly string[]).includes(page);
api().onNavigate(page => {
  // "Check for Updates…" opens Settings on its Updates row and checks from there, so the result is announced and Check now has the focus.
  if (page === 'settings/updates') { showPage('settings'); document.getElementById('setting-updates')?.scrollIntoView({ block: 'nearest' }); void checkNow(true); }
  else if (isPage(page)) showPage(page);
});
// Settings changed by a menu, a dialog or the system: main says so after every save and whenever the window comes back, and an
// open Settings or History page reads them again, so it never shows (or writes back) a value that is no longer the saved one.
api().onSettingsChanged(() => { readHistoryDays(); if (state.page === 'settings' || state.page === 'history') void loadSettings(); });
/** History's days as Settings saved them, read at launch and at each settings change, before any Delete says them; drawn again when they change. */
function readHistoryDays() {
  void api().getSettings().then(settings => {
    if (!settings?.historyDays || state.historyDays === settings.historyDays) return;
    state.historyDays = settings.historyDays;
    rerender();
  }, () => undefined);
}
readHistoryDays();
/** Applies a keeper state to the open home unless a newer `seq` has already landed; forgets stale refusals on clean change. */
function applySessionCosts(next: SessionCostsView): void {
  if (!state.home || next.home !== state.home.home) return;
  if ((state.home.sessionCosts?.seq ?? -1) > (next.seq ?? 0)) return;
  const changed = state.home.sessionCosts?.on !== next.on;
  state.home.sessionCosts = next;
  if (next.on || (changed && !next.refused)) state.keepProblem = undefined;
}
/** Whether a session-cost keeping change (Start, Stop or Settings toggle) is currently being carried out. */
let keepBusy = false;
export const keepingBusy = (): boolean => keepBusy;
/** Turns session-cost keeping on or off for the open home, updating its view and announcing once when it changed. */
export async function switchSessionCosts(on: boolean): Promise<string | undefined> {
  const home = state.home?.home;
  if (!home || keepBusy) return undefined;
  const wasOn = !!state.home?.sessionCosts?.on;
  keepBusy = true;
  rerender();
  try {
    const view = await api().setKeepSessionCosts(home, on);
    if (state.home?.home !== home) return undefined;
    applySessionCosts(view);
    if (view.refused) return view.refused;
    if (view.on !== wasOn) announce(on ? 'Keeping session costs for this home.' : 'Stopped keeping session costs for this home.');
    return undefined;
  } finally {
    keepBusy = false;
    rerender();
  }
}
api().onSessionCostsChanged(next => {
  applySessionCosts(next);
  if (state.home?.sessionCosts === next) keeperNews(next);
  if (state.page === 'sessions' || state.page === 'settings') rerender();
});

// A background pass may change what differs from the git repo too: its page and sidebar count read again soon (no fetch).
// The Sources page reads its view again too: a read by itself (the daily check) changes what each name there is to the library.
function syncFollowUps() { loadRepoSoon(); if (state.page === 'sources') void loadSources(); }
api().onSyncChanged(() => { syncFollowUps(); void backgroundRefresh(); });
api().onSaid(text => announce(text));

/** Each kind's sync notices in a view: what changed on its own, with its History event. */
const noticesByKind = (view: HomeView): [PageKind, SyncNotice[]][] => [['skills', view.skills.notices], ['mcp', view.mcp.notices], ['agents', view.agents.notices]];

/**
 * A sync notice not seen yet (matrix.ts noticeUnseen) stays in the next read of the same home until it is seen, dismissed or
 * folded into History by a newer one: main says each notice once, and a pass's own writes (a settings file it wrote) bring a read
 * with none right after the one that had them, so a page opened a moment later still tells what Synchronize everything, or an
 * edit, did. One the read brings a later save's notice of the same item for is superseded (matrix.ts supersedes): its save is in History.
 * Also keeps the open home's newer `sessionCosts` when an older home read carries a lower `types.ts SessionCostsView.seq` (same rule as `applySessionCosts`).
 */
function keepUnshown(was: HomeView | undefined, view: HomeView): HomeView {
  if (!was || was.home !== view.home) return view;
  const kept = (kind: PageKind) => {
    const now = view[kind].notices, known = new Set(now.map(notice => notice.history));
    const unshown = was[kind].notices.filter(notice => !known.has(notice.history) && noticeUnseen(notice.history) && !now.some(newer => supersedes(newer, notice)));
    return unshown.length ? { ...view[kind], notices: [...unshown, ...now] } : view[kind];
  };
  const sessionCosts = was.sessionCosts && (!view.sessionCosts || (view.sessionCosts.seq ?? 0) < (was.sessionCosts.seq ?? 0)) ? was.sessionCosts : view.sessionCosts;
  return { ...view, skills: kept('skills'), mcp: kept('mcp'), agents: kept('agents'), sessionCosts };
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
    // While Settings holds a switch-on Undo band, keep History current so take-in lines know what Undo still takes back.
    if (state.page === 'settings' && state.outcome?.page === 'settings' && state.outcome.everythingUndo) await putHistory().catch(() => undefined);
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

/** Says fresh background news in the status bar. A result on show keeps the header's lines: the news is counted beside it (matrix.ts headerNotices). */
function sayBackgroundNews() {
  const news = backgroundNews.splice(0).filter(({ notice }) => !state.dismissed.has(notice.history));
  if (!news.length) return;
  // Each item once, its kind named where another kind's news has its name (words.ts rowNames).
  const items = [...new Set(rowNames(news.flatMap(({ kind, notice }) => noticeNames(notice).map(name => ({ kind, name })))))];
  // Heard alone once the header has drawn each notice (seen), shown in the status bar until then (paintStatusMessage).
  announce(`Sync changed ${andList(items)}.`, true, undefined, news.map(({ notice }) => notice.history));
}

/** A background refresh or menu-bar switch asked for while the page acted or while another ran: run it now, once, if nothing is running. */
function drainOwedRefresh() {
  if (acting() || refreshing) return;
  if (pendingSwitch) { const next = pendingSwitch; pendingSwitch = undefined; void applyMenuSwitch(next); return; }
  if (!refreshOwed) return;
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
  /** Pinned row ids while the Profiles page's Changes view is open, so ticking moves no row. */
  changes: undefined as { home: string; profileId: string; on: string[]; off: string[]; retooled: string[] } | undefined,
};

/**
 * What a switch or its Undo did, as its band says it: what it turned On and Off (a switch's, with how many of those still load:
 * `still`, profileplan.ts stillLoadAfter, and each plugin it turned on or off whole in Claude Code: `whole`, profileplan.ts
 * wholeSaid), and what could not change.
 */
function turnedOutcome(page: Page, lead: string, turned: NonNullable<ApplyResult['switched']> & Pick<ProfileSwitchResult, 'settingsChanged'>, results: DestinationResult[], reloads: readonly ReloadChange[],
  { act, fade, still = '', whole = '', kept = '' }: { act?: Outcome['act']; fade?: boolean; still?: string; whole?: string; kept?: string } = {}) {
  const leftSaid = `${turned.left.length ? ` ${andList(turned.left)} ${turned.left.length === 1 ? 'is' : 'are'} not as it asked: History says why.` : ''}${(turned.settingsChanged ?? []).map(said => ` ${said}`).join('')}`;
  // An Undo's plugin copies changed since the switch (profiles.ts undoSwitch), left as they are.
  const sinceSaid = turned.since?.length ? ` Left as ${turned.since.length === 1 ? 'it is' : 'they are'}: ${turned.since.join('; ')}.` : '';
  const notDone = results.length ? ` ${results.slice(0, 2).map(entry => entry.message).join(' ')}${results.length > 2 ? ' …' : ''}` : '';
  const warn = results.length > 0 || turned.left.length > 0 || !!turned.since?.length;
  tellWritten({ page, band: true, fade: !!fade && !warn && !act, text: `${lead}: ${changeWords(turned, turned.plugins ?? { on: 0, off: 0 }, 'did', still) || 'nothing changed'}.${whole}${kept}${leftSaid}${sinceSaid}${notDone}`, warn, act }, reloads, false);
}

/**
 * What a switch did, read back from the view after it already in state.home: how many of the items it turned off still load
 * (profileplan.ts stillLoadAfter), each plugin it turned on or off whole in Claude Code (profileplan.ts wholeSaid), and Undo switch
 * only where History would offer it (profileplan.ts undoOffered).
 */
const switchOutcome = (result: ProfileSwitchResult, page: Page) => turnedOutcome(page, `Switched to ${result.name}`, { ...result, plugins: wholeCounts({ steps: result.profile?.wholeSteps }) }, result.results, result.reloads, {
  still: result.profile && state.home ? stillLoadAfter(result.profile, state.home) : '', whole: result.profile && state.home ? wholeSaid(result.profile, state.home) : '',
  act: result.event && state.home && undoOffered(result, state.home)
    ? { label: 'Undo switch', id: 'outcome-undo', title: 'Turn back each item this switch changed, where it is still as the switch left it', run: () => void restoreEvent(result.event!) } : undefined });

/** Switches to a profile. The band says what changed, with Undo where History offers it; the menu bar follows. */
export const switchToProfile = (id: string) => busy('Switching profile…', async page => {
  const result = await api().switchProfile(id, state.home!.home);
  if (result.view) setHome(result.view);
  if (result.stopped) { announce(result.stopped); return; }
  profileState.changes = undefined;
  switchOutcome(result, page);
  if (state.page === 'history') await putHistory();
});
// A switch from the menu bar: its fresh view and result land together so switchOutcome asks undoOffered against the post-switch home, waiting while busy like backgroundRefresh.
async function applyMenuSwitch(result: ProfileSwitchResult) {
  if (!state.home || (result.view && result.view.home !== state.home.home)) return;
  if (acting() || refreshing) { pendingSwitch = pendingSwitch ? { ...result, ...(pendingSwitch.view && result.view ? { view: withSetAside(pendingSwitch.view, result.view) } : {}), reloads: [...pendingSwitch.reloads, ...result.reloads] } : result; return; }
  refreshing = true;
  try {
    if (result.view) setHome(result.view, { background: true, sayNews: false });
    profileState.changes = undefined;
    switchOutcome(result, state.page);
    sayBackgroundNews();
    // History lists the new switch at once when it is the page open (it reads History only when opened).
    if (state.page === 'history') await putHistory();
    syncFollowUps();
    rerender();
  } finally { refreshing = false; drainOwedRefresh(); }
}
api().onProfileSwitched(result => void applyMenuSwitch(result));

/**
 * Saves a profile: only the fields given change. A new or restored profile opens (a new one with its name field ready to type); an
 * edit leaves the page where it is. Quiet by default; `band` shows `said` visibly on the page it was started on.
 */
export const saveProfileDef = (profile: ProfileEdit, said?: string, band = false) => busy('Saving profile…', async page => {
  const result = await api().saveProfile(profile, state.home!.home);
  if (result.profiles) state.home = { ...state.home!, profiles: result.profiles };
  if (result.problem) { announce(result.problem); return; }
  if (result.id && (!profile.id || profile.restore)) profileState.open = result.id;
  if (result.id && !profile.id) profileState.renaming = result.id;
  // The save that moved the file to profiles that hold their tools (profiles.ts saveProfile): which others it filled in, once.
  if (result.filled) tell({ page, band: true, text: filledWords(result.filled) }, '', { checkProfile: false });
  else if (band && said) tell({ page, band: true, text: said }, '', { checkProfile: false });
  else announce(said ?? 'Profile saved.', true);
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
    act: { label: 'Undo', id: 'outcome-undo-delete-profile', title: `Make ${gone.name} again, with the same items`, run: () => void saveProfileDef({ ...gone, restore: true }, `${gone.name} is back.`) } }, '', { checkProfile: false });
});
