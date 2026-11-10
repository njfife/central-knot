import { forgetRepoPrompts, loadRepo, loadRepoSoon } from './repopage.ts';
import { loadSettings, openSettings } from './settingspage.ts';
import type { ApplyResult, ProfileEdit, ProfileFlip, ProfileSwitchResult, BaseApply, BaseResult, BaseUndo, BaseView, Change, DesktopApi, DestinationResult, HarnessId, InstructionFile, HistoryEvent, HistoryDays, HomeMode, HomeView, McpResult, ClaudeWrite, SyncNotice } from './types.ts';
import { caughtUpNames, plural, withSetAside } from './model.ts';
import { h } from './dom.ts';
import { keptEditFlag, readFlag, writeFlag } from './flags.ts';
import { andList, fileName, kindNames, kindNouns, noToolsSentence, orList, sentence, toolList, toolName, toolNames as namedTools, toolsPhrase } from './words.ts';
import { withOwn, withoutBase } from './basetext.ts';
import { machineNames, pagePlatform } from './machine.ts';
import { loadPlugins, resetMarket } from './pluginstate.ts';
import { nextDraft, unsaved, type InstructionDraft } from './drafts.ts';
import { absentKindsIn, heldKinds, type HomeKind } from './presence.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';
import { activeProfile, flipSummary, NO_PROFILE, redoneSwitch } from './profileplan.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

/** Every page, in the sidebar's order. */
export const pages = ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'profiles', 'history', 'repo', 'settings'] as const;
export type Page = typeof pages[number];

/** This computer's names, and what its platform offers (machine.ts). */
export const machine = machineNames(pagePlatform(navigator.userAgent));
export const { home: realHomeName, machine: thisMachine, tray: trayPlace } = machine;

/** The kinds of item the tables manage. */
export type Kind = 'skills' | 'mcp' | 'agents';
export const KINDS: Kind[] = ['skills', 'mcp', 'agents'];
export const isKind = (tab: string | undefined): tab is Kind => (KINDS as (string | undefined)[]).includes(tab);
/** What a harness's page shows: one kind of item, its instruction file, its plugins, or where its files are. */
export type HarnessTab = Kind | 'instructions' | 'plugins' | 'about';
/** Found: Central Knot reads and writes this harness in this home, so it has a page. */
export const harnessFound = (home: HomeView, tool: HarnessId) => home.manage.tools.includes(tool);
/** A harness's page whose tool a new read no longer finds closes, so it doesn't reopen by itself if a later read finds it again. */
function forgetLostHarness() { if (state.harness && state.home && !harnessFound(state.home, state.harness)) state.harness = undefined; }
/** The tab of the harness page on screen, if one is: Harnesses with a harness open that this home still finds. */
export const harnessTabShown = (): HarnessTab | undefined => (state.page === 'harnesses' && state.harness && state.home && harnessFound(state.home, state.harness) ? state.harnessTab : undefined);
/** The kind whose table is on screen on a harness's page, if one is. */
export const harnessKindShown = (): Kind | undefined => { const tab = harnessTabShown(); return isKind(tab) ? tab : undefined; };
export interface BaseEdit {
  text: string; hash: string; tools: HarnessId[]; stage: 'edit' | 'review';
  /** Where the draft came from: a tool's own instructions (they move into the base), a tool's edited copy (to use as the base),
   *  the base going back into one tool whose copy was edited, the base written again where it is missing or older, or an earlier version. */
  source?: { kind: 'own' | 'copy' | 'putBack' | 'update' | 'version'; tool?: HarnessId };
  confirmDiscard?: boolean; fullDiff?: boolean;
  /** Why the review is shown again: the base or a file changed since it was last shown. */
  conflict?: string;
  /** The ticks before "Stop sharing with every tool…" emptied them, put back if the person goes back to editing. */
  ticksBeforeStop?: HarnessId[];
}

/** The text a tool's editor works on: its own instructions, without the base block when it gets the base. */
export const ownText = (file: InstructionFile) => (file.base ? file.base.own : file.text);

export const state = {
  home: undefined as HomeView | undefined,
  page: 'overview' as Page,
  /** The home last asked for, so Try again retries that one. */
  lastMode: undefined as HomeMode | undefined,
  find: '',
  /** The skill shown in the Skills detail. */
  item: undefined as string | undefined,
  busy: undefined as string | undefined,
  /** What the last MCP Apply all or Write now did. */
  mcpResult: undefined as McpResult | undefined,
  agentsResult: undefined as McpResult | undefined,
  /** What sync and actions did, newest last: read when the History page opens or the home changes (pagedata.ts). */
  history: pageData<HistoryEvent[]>(),
  /** How long History keeps things, for History's intro; read with History's events. */
  historyDays: undefined as HistoryDays | undefined,
  /** What the last Apply all did, shown until the next action or read. */
  applied: undefined as ApplyResult | undefined,
  /** The Skills page: the table, or one skill's files and contents beside the list. */
  skillsView: 'table' as 'table' | 'files',
  /** Counts moves to another page, so what belongs to one visit (an armed Delete everywhere) can tell it has ended. */
  visit: 0,
  /**
   * What the status bar says (announce): the newest message, whether it is for screen readers only, and its place in
   * the order messages were said, so the newest always wins.
   */
  said: { text: '', quiet: false, seq: 0 },
  /** What the last action did, said on the page it happened on until the next action or page (Outcome). */
  outcome: undefined as Outcome | undefined,
  /** Each tool's instruction file: read when the Instructions page opens or the home changes (pagedata.ts). */
  instructions: pageData<InstructionFile[]>(),
  /** The one instruction file being edited (InstructionDraft). */
  instructionEdit: undefined as InstructionDraft | undefined,
  /** The base instructions and which tools get them, read with the instruction files. */
  base: undefined as BaseView | undefined,
  /** The base being edited: its text and tools so far, the hash it was opened at, and where the draft came from. */
  baseEdit: undefined as BaseEdit | undefined,
  /** Sync notices the person has dismissed, by History event or item. */
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
};

let render = () => {};
export const setRenderer = (next: () => void) => { render = next; };
/** Re-renders and puts focus back on the control that had it, found by id. */
export const rerender = () => {
  const focused = document.activeElement?.id;
  render();
  if (focused && document.activeElement?.id !== focused) document.getElementById(focused)?.focus();
};

/** The practice copy's note on the Overview, shown until the person hides it (kept per viewer, in this window's storage). */
const PRACTICE_NOTE = 'ck-practice-banner-dismissed';
export const practiceNoteOpen = (): boolean => !readFlag(PRACTICE_NOTE);
export const setPracticeNote = (open: boolean): void => writeFlag(PRACTICE_NOTE, !open);

/**
 * Says something in the status bar, kept in state (state.said) so a redraw paints the same thing. The newest message is
 * the one shown. A quiet announcement is for screen readers only: the page already shows the same thing (a band).
 */
export function announce(text: string, quiet = false) {
  state.said = { text, quiet, seq: state.said.seq + 1 };
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
  else { announce(outcome.text, !saidInStatusBar(outcome)); outcome.said = state.said.seq; }
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
  // Only a message that repeats what the page shows (announced quiet) is for screen readers alone. A result the page didn't
  // draw (no band on this page, or held back) is shown here after all: the drawn result is marked data-outcome.
  const quiet = told.quiet && !(state.outcome && told.text === state.outcome.text && !document.querySelector('[data-outcome]'));
  region.classList.toggle('visually-hidden', quiet);
  // A narrow status bar shows a small mark instead of a message cut to a stub; its tooltip has the message (style.css).
  const mark = document.getElementById('message-mark');
  if (mark) { mark.title = told.text; mark.hidden = !told.text || quiet; }
}

const focusById = (id?: string | null) => (id ? document.getElementById(id) : null)?.focus();

/**
 * Takes a new view of the home. When its tools changed (one appeared or went away), or there was no home before, the
 * page follows: a page whose kind is no longer here gives way to the Overview, saying why, and a page with its own data
 * reads it again (unless `reload` is false: the caller reads it itself).
 */
export function setHome(view: HomeView | null | undefined, { reload = true } = {}): void {
  if (!view) return;
  const before = state.home ? homeTools().join() : undefined;
  state.home = view;
  forgetLostHarness();
  if (before !== undefined && homeTools().join() === before) return;
  leaveAbsentPage();
  if (reload) void loadPageData(state.page, { readId: view.readId });
}

/** Where focus goes when the running work ends, when its result replaced the control that started it (a review opening). */
let focusAfterBusy: string | undefined;

/**
 * One piece of work at a time: every mutating control is disabled while it runs. Its "Reading…" message gives way, when
 * the work said nothing of its own, to what the status bar said before. A background refresh that arrived meanwhile runs
 * once it is done.
 */
export async function busy(message: string, work: () => Promise<void>) {
  const focused = document.activeElement?.id;
  const before = state.said;
  state.outcome = undefined;
  state.undoMoved = undefined;
  state.busy = message;
  document.body.dataset.busy = 'true';
  announce(message);
  const working = state.said.seq;
  rerender();
  try { await work(); }
  catch {
    announce(state.home ? `That could not finish. Still on ${state.home.label}. Click Refresh to see where things stand.` : 'Could not read this home. Nothing changed. Try again.');
  }
  // When the work said nothing since its "Reading…", what was said before comes back.
  if (state.said.seq === working) announce(before.text, before.quiet);
  state.busy = undefined;
  document.body.dataset.busy = 'false';
  rerender();
  focusById(document.getElementById(focusAfterBusy ?? '') ? focusAfterBusy : focused);
  focusAfterBusy = undefined;
  drainOwedRefresh();
  // Any change may change what differs from the git repo: its page and sidebar count read again (no fetch).
  if (state.home) loadRepoSoon();
}

/**
 * Opens a home (a switch, or the first at launch), where setHome only takes a newer view of the same one. Everything
 * read or chosen for the home before is let go: its pages' data (each starts over at reading; the open page's is read for
 * this home at once, the others as they open), the marketplace choices and the open skill. An unsaved Instructions draft is kept: the Instructions page
 * offers to copy or discard it.
 */
function accept(view: HomeView) {
  state.home = undefined;
  state.applied = undefined;
  state.item = undefined;
  // A harness page belongs to the home it was opened in.
  state.harness = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  // The base and its editor belong to the home they were read in.
  state.base = undefined;
  state.baseEdit = undefined;
  resetPageData(state.instructions);
  resetPageData(state.history);
  resetMarket();
  setHome(view, { reload: false });
  void loadPageData(state.page, { readId: view.readId });
  // The sidebar counts what waits each way for the repo, so it is read with the home (no fetch: that waits for the page).
  if (state.page !== 'repo') void loadRepo(false);
}

/** A row to flash on its next draw (set by Undo and Restore; the matrix reads it). */
export const flashRequests = new Set<string>();
const flashRow = (item: string) => { if (item) flashRequests.add(item.toLowerCase()); };

/** After the first Apply all on a page, its tip has done its job. */
const retireTip = (kind: Kind) => writeFlag(`ck-help-dismissed-${kind}`);

export const applyManage = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const home = state.home!;
  const started = Date.now();
  const result = await api().apply(changes, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  setHome(view);
  state.applied = result;
  if (!result.stopped) { onDone(); retireTip('skills'); }
  const managed = changes.filter(change => change.managed).length;
  // History holds what Apply all replaced; new copies are undone by turning Managed off, which leaves them in place.
  const names = new Set(changes.map(change => state.home?.manage.skills.find(skill => skill.key === change.key)?.name ?? change.key));
  const ours = result.results.filter(entry => names.has(entry.item));
  const replacedSome = ours.some(entry => entry.replaced);
  // Say what was added and what was replaced, apart: only a replacement is kept in History.
  const order = Object.values(namedTools);
  // The tools whose results match, by name, in the page's tool order.
  const toolsWhere = (match: (entry: DestinationResult) => boolean) => [...new Set(ours.filter(match).map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const writtenTo = (replaced: boolean) => toolsWhere(entry => entry.outcome === 'written' && !entry.caughtUp && !!entry.replaced === replaced);
  const added = writtenTo(false), replacedIn = writtenTo(true);
  const single = managed === 1 ? changes.find(change => change.managed)?.key : undefined;
  const singleName = single ? state.home?.manage.skills.find(skill => skill.key === single)?.name ?? single : undefined;
  // The result matches the bar before it: how many new copies, and of which skills.
  const newCopies = ours.filter(entry => entry.outcome === 'written' && !entry.replaced && !entry.caughtUp);
  const newItems = [...new Set(newCopies.map(entry => entry.item))];
  // Disable, Enable and Remove, per tool, said after the copies.
  const disabledIn = toolsWhere(entry => entry.outcome === 'switched' && entry.disabled === true), enabledIn = toolsWhere(entry => entry.outcome === 'switched' && entry.disabled === false), removedFrom = toolsWhere(entry => entry.outcome === 'removed');
  const touched = [...new Set(ours.filter(entry => entry.outcome === 'switched' || entry.outcome === 'removed').map(entry => entry.item))];
  const parts = [
    managed ? (singleName ? `${singleName} managed` : `${plural(managed, 'skill')} managed`) : '',
    newCopies.length ? `${plural(newCopies.length, 'new copy', 'new copies')} written${!singleName && newItems.length <= 3 ? ` (${newItems.join(', ')})` : ` to ${andList(added)}`}` : '',
    replacedIn.length ? `replaced ${andList(replacedIn.map(name => `${name}’s copy`))} (kept in History)` : '',
  ].filter(Boolean);
  const switches = [disabledIn.length ? `disabled in ${andList(disabledIn)}` : '', enabledIn.length ? `enabled in ${andList(enabledIn)}` : '', removedFrom.length ? `removed from ${andList(removedFrom)} (kept in History)` : ''].filter(Boolean);
  // One skill's switches with nothing else to say name the skill once, at the front: "notes disabled in Codex · removed from …".
  if (switches.length && !parts.length && touched.length === 1) switches[0] = `${touched[0]} ${switches[0]}`;
  const what = [...parts, ...switches].join(' · ') || 'nothing needed copying';
  // New copies are in History as 'added': one Undo here removes them again (while unchanged) and unmanages those skills.
  // Only when nothing was replaced: undoing a replacement is its own History entry, and a half-undone choice would mislead.
  // Only this Apply all's own History entries (from the moment it started): an earlier batch is undone from History, never here.
  const recent = result.stopped ? [] : (await api().history()).events.filter(event => !event.undoneBy && changes.some(change => change.key === event.key) && Date.parse(event.at) >= started - 1000);
  // Only a run that wrote new copies offers to undo them: an earlier Apply all's copies are undone from History.
  const addedNow = replacedSome || !newCopies.length ? [] : recent.filter(event => event.kind === 'added');
  // A copy choice gets its own inline Undo: each replaced copy back in its own tool, new copies removed, the skill unmanaged.
  const chosenNow = replacedSome ? recent.filter(event => event.kind === 'chosen') : [];
  // A lone Disable, Enable or Remove gets its own Undo here; more than one is undone from History.
  const switchedNow = recent.filter(event => event.kind === 'switched' || event.kind === 'removed');
  const switchUndo = switchedNow.length === 1 && !addedNow.length && !chosenNow.length
    ? { label: switchedNow[0].kind === 'removed' ? 'Restore' : 'Undo', id: 'outcome-undo-switch', title: switchedNow[0].kind === 'removed' ? 'Put the removed copy back' : 'Flip it back', run: () => void restoreEvent(switchedNow[0].id) } : undefined;
  const firstApply = !readFlag('ck-applied-once');
  writeFlag('ck-applied-once');
  const failed = result.results.filter(entry => entry.outcome === 'failed').length;
  tell(result.stopped ? undefined : { page: state.page, history: replacedSome && !chosenNow.length, text: `${what}.` + (managed && firstApply ? ' Edits now spread between tools.' : '') + (failed ? ` ${failed} failed.` : ''), item: singleName, items: newItems,
    act: addedNow.length ? addedUndo(addedNow, switchedNow) : chosenNow.length ? choiceUndo(chosenNow) : switchUndo }, result.stopped);
});

/**
 * What a read found, naming only the kinds a tool in that home can hold ("Read 1 skill and 0 MCP servers from pi-only."),
 * or that it found no tools at all. `from` names the home, for the status bar. "Nothing changed" means nothing was
 * written; a copy that stopped updating is still news, so then it isn't said.
 */
function readFound(view: HomeView, from?: string): string {
  if (!view.manage.tools.length) return noToolsSentence;
  const found = { skills: view.manage.skills.length, mcp: view.mcp.servers.length, agents: view.agents.servers.length };
  const counts = heldKinds(view).map(kind => plural(found[kind], kindNouns[kind].one, kindNouns[kind].many));
  const stopped = view.agents.servers.some(server => server.managed && server.stopped?.length);
  // A catch-up that copied something has its own Caught up band (tables and the Harnesses list), so it is not "Nothing changed".
  const caught = caughtUpNames(view.manage, new Set(view.manage.notices.map(notice => notice.item))).length > 0;
  return `Read ${andList(counts)}${from ? ` from ${from}` : ''}.${stopped || caught ? '' : ' Nothing changed.'}`;
}

/** A home just opened, as its band says it: an empty one (no tools, or nothing in them) says only that it opened; the page says the rest. */
const openedText = (view: HomeView) => (!view.manage.skills.length && !view.mcp.servers.length && !view.agents.servers.length ? `Opened ${view.label}.` : `Opened ${view.label}. ${readFound(view)}`);

/** A read said in the status bar: what it found, and in which home. */
const readSummary = (view: HomeView) => readFound(view, view.label);

/**
 * The kinds the open home's tools can hold, as a sentence names them: "skills, MCP servers and agents", or, for `one` of
 * them, "skill, MCP server or agent". Empty in a home with no tools (noTools).
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
  if (view && view.home !== previous?.home) forgetRepoPrompts(true);
  // Sync follows the open home: leaving one with managed items stops its syncing, so the band says so and offers the way back.
  const left = previous && view && previous.home !== view.home && [...previous.manage.skills, ...previous.mcp.servers, ...previous.agents.servers].some(fact => fact.managed) ? previous : undefined;
  const leftText = left ? ` ${left.label} is not syncing while another home is open.` : '';
  if (!view) { announce(''); return; }
  accept(view);
  tell({ page: state.page, carry: true, text: openedText(view) + leftText,
    act: left && left.mode !== 'custom' ? { label: `Go back to ${left.label}`, id: 'outcome-go-back', run: () => void loadHome(left.mode) } : undefined });
}));

/** At launch: the home last opened (so sync resumes where it was), else this computer's home (dev builds: the practice copy). */
export const startHome = () => busy('Reading skills, MCP servers and agents…', async () => {
  const view = await api().startHome();
  // The first read is said the same way as a home switch: a band, not a passing status line.
  const practiceNote = view?.mode === 'fixture' && practiceNoteOpen();
  if (!view) { announce(''); return; }
  accept(view);
  if (practiceNote) announce(readSummary(view), true);
  else tell({ page: state.page, carry: true, text: openedText(view) });
});

/** Refresh: reads the home again, then the open page's own data (marketplaces anew), so all it shows is from this read. */
export async function readAgain() {
  let read = false;
  await busy(noTools() ? 'Reading…' : `Reading ${heldKindNames()}…`, async () => {
    const view = await api().refresh();
    if (!view) return;
    state.applied = undefined;
    // Said first, so a page that leaves (setHome) adds its reason after what was read.
    announce(readSummary(view));
    setHome(view, { reload: false });
    read = true;
  });
  // Only a new read goes on to the page's own data: after a failure its message stays, and the page keeps what it showed.
  if (read) await loadPageData(state.page, { fresh: true, readId: state.home?.readId });
}

/** Why the open home can't be written now, if so: preview only, or another Central Knot build owns its sync. */
export const whyReadOnly = (home: HomeView) => (!home.manage.access.allowed ? home.manage.access.reason : home.manage.gate.state === 'stopped' ? home.manage.gate.reason : undefined);

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

/** The open home's tools, as the main process decided them from the same read (presence.ts): page wording names only these. */
export const homeTools = (): HarnessId[] => state.home?.manage.tools ?? [];

/** The kinds no tool in the open home can hold (presence.ts absentKindsIn); none before a home is read. */
export const absentKinds = (): HomeKind[] => (state.home ? absentKindsIn(state.home) : []);

/** The open home has no tools at all: every page says so, and offers another home. False before a home is read. */
export const noTools = (): boolean => !!state.home && !homeTools().length;

/** The open home's tools by name, for sentences: "Claude Code and Codex". */
export const homeToolNames = (): string[] => homeTools().map(toolName);

/** The tools an action touched (ids), as a sentence names them in the open home: "all 3 tools" or their names. */
export const touchedToolsPhrase = (touched: string[]): string => toolsPhrase(touched, homeTools());

/**
 * Lets go of what the last action showed (its result, Apply results, the spoken line): for moving to another place.
 * A home switch's result survives one move, since switching is often followed by a click elsewhere; `page` is where it lands.
 */
export function leaveResults(page = state.page) {
  const carried = state.outcome?.carry ? { ...state.outcome, page, carry: false } : undefined;
  state.applied = undefined; state.mcpResult = undefined; state.agentsResult = undefined;
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
  if (page !== state.page) { state.skillsView = 'table'; state.visit += 1; forgetRepoPrompts(); }
  if (leavingHarness) state.harness = undefined;
  // Settings opens fresh (what its rows said last visit belongs to that visit); every other page reads its own data.
  state.page = page;
  if (page === 'settings') openSettings();
  else if (!stays) void loadPageData(page);
  state.find = '';
  state.item = undefined;
  rerender();
}

/** Leaves the Skills page's Files and contents view for the table (its Table button, or Escape). */
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

/** A restored copy keeps its tool's switch as it was: said when that leaves it disabled, so it doesn't seem not to load for no reason. */
function stillDisabled(key: string, restored: DestinationResult[]) {
  const disabled = state.home?.manage.skills.find(skill => skill.key === key)?.disabled ?? [];
  const tools = [...new Set(restored.map(entry => entry.harness).filter((tool): tool is HarnessId => !!tool && disabled.includes(tool)))];
  return tools.length ? `It is still disabled in ${andList(tools.map(tool => toolName(tool)))}.` : '';
}

/** Undo or Restore from History: a new revision that spreads to every tool the skill syncs to. */
export const restoreEvent = (eventId: string, choice?: string) => busy('Restoring…', async () => {
  const home = state.home!;
  const result = await api().restore(eventId, home.manage.gate.state === 'needs-resume', home.home, choice);
  // The notice for an undone event has done its job; its result band says what happened.
  if (!result.stopped) state.dismissed.add(eventId);
  const view = await api().refresh();
  setHome(view);
  await putHistory();
  const restored = result.results.filter(entry => entry.outcome === 'written');
  const where = [...new Set(restored.map(entry => entry.harness ?? ''))].filter(Boolean);
  // The new History event is the one that undid this; offering it inline makes the undo itself undoable here.
  const past = state.history.data?.find(event => event.id === eventId);
  const undoneBy = past?.undoneBy;
  // An Undo of a profile switch lists what it couldn't change in its own band, so the Skills page's problems band gets only a stop.
  state.applied = past?.kind === 'profile' && !result.stopped ? undefined : result;
  if (past?.kind === 'profile') {
    if (result.stopped) tell(undefined, result.stopped); else undoOutcome(result, undoneBy);
    return;
  }
  const everywhere = touchedToolsPhrase(where);
  // A Pull's edit or deletion of the base instructions: its Undo has no event of its own to offer again.
  if (past?.base) {
    tell(result.stopped ? undefined : { page: state.page, item: past.item, text: result.results.map(entry => entry.message).join(' ') }, result.stopped);
    return;
  }
  const item = restored[0]?.item ?? past?.item ?? '';
  const removedFrom = [...new Set(result.results.filter(entry => entry.outcome === 'removed').map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean);
  if (past?.kind === 'added') {
    const stayed = result.results.filter(entry => entry.outcome === 'held');
    tell(result.stopped ? undefined : { page: state.page, item: past.item, text: `Removed the new copies of ${past.item}${removedFrom.length ? ` from ${andList(removedFrom)}` : ''}.${stayed.length ? ` ${stayed.map(entry => entry.message).join(' ')}` : ` ${past.item} is unmanaged again.`}` }, result.stopped);
    if (!result.stopped) flashRow(past.item);
    return;
  }
  if (past?.kind === 'switched' || past?.kind === 'removed') {
    // Every tool's result is said, including one that was already as wanted ("has it back already") or still waits.
    const text = past.kind === 'removed'
      ? [where.length ? `${past.item} is back in ${andList(where.map(tool => toolName(tool)))}.` : '', ...result.results.filter(entry => entry.outcome !== 'written').map(entry => entry.message), stillDisabled(past.key, restored)].filter(Boolean).join(' ')
      : result.results.map(entry => `${past.item}: ${entry.message}`).join(' ');
    // "Undo again" only for a switch Undo that recorded what it flipped.
    const again = past.kind === 'switched' && undoneBy && state.history.data?.some(event => event.id === undoneBy) ? { id: undoneBy, label: 'Undo again' } : undefined;
    tell(result.stopped ? undefined : { page: state.page, item: past.item, text, undo: again }, result.stopped);
    if (!result.stopped) flashRow(past.item);
    return;
  }
  const text = past?.kind === 'deleted' ? `${item} is back in ${everywhere}.`
    : past?.kind === 'restored' ? `Redone: ${item} is as it was before the undo, in ${everywhere}.`
      : `Undid ${past?.winner ? `${toolName(past.winner.tool) ?? past.winner.tool}’s ${past.kind === 'chosen' ? 'chosen copy' : 'edit'}` : 'the change'} to ${item}. The earlier version is back in ${everywhere}.`;
  const label = past?.kind === 'deleted' ? `Delete again in ${everywhere}` : past?.kind === 'restored' ? 'Undo again' : `Redo edit in ${everywhere}`;
  const done = !result.stopped && restored.length > 0;
  tell(done ? { page: state.page, item, history: !undoneBy, undo: undoneBy ? { id: undoneBy, label } : undefined, text } : undefined, result.stopped ?? `Restored in ${plural(0, 'tool')}.`);
  // The restored row flashes like a synced one.
  if (done) flashRow(item);
});

// ---------- Convert to skill ----------

/** Converts an agent to a Pi skill, then manages that skill for Pi only: never the agent's own tool, and other tools only if chosen later. */
export const convertAgent = (key: string, name: string) => busy('Converting…', async () => {
  const home = state.home!;
  const made = await api().convertAgent(key, home.home);
  if (made.stopped || !made.skill) { announce(made.stopped ?? 'Nothing was converted.'); return; }
  const others = home.manage.tools.filter(tool => tool !== 'pi-cli');
  const applied = await api().apply([{ key: made.skill, managed: true, off: others }], home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  setHome(view);
  const from = toolName(made.origin ?? 'claude-cli');
  tell({ page: state.page, item: name, text: applied.stopped ? `Converted ${name} to a Pi skill, but it could not be managed: ${applied.stopped}` : `Converted ${name} to a skill for Pi. ${from} keeps the agent. It syncs to Pi only; turn on other tools for it on the Skills page.` });
});

// ---------- Results ----------

/** What an action did: its sentence, the items it names, and what it offers next (its own button, Undo, or History). */
export interface Outcome {
  page: Page;
  text: string;
  /** Something was left undone: a warning icon, not a tick. */
  warn?: boolean;
  note?: string;
  item?: string;
  items?: string[];
  /** Said again on the next page opened (a home just opened). */
  carry?: boolean;
  /** An instruction file saved (of `tool`): its card says so, with its Undo (instructionspage.ts). */
  kind?: 'saved';
  tool?: HarnessId;
  history?: boolean;
  undo?: { id: string; label: string };
  act?: { label: string; id: string; run: () => void; title?: string };
  /** When it was said (state.said.seq): a result newer than a table's pending changes still shows there. */
  said?: number;
}

/**
 * Whether a result is said in the status bar rather than as a band: it offers nothing to do (no button, Undo or History
 * link), so it needs no room of its own.
 */
export const saidInStatusBar = (outcome: Outcome): boolean => !(outcome.act || outcome.undo || outcome.history || outcome.note);

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

/** Opens one file in the editor; any earlier result band belongs to the last task, not this one. */
export function startInstructionEdit(file: InstructionFile) {
  if (askAboutOpenDraft()) return;
  // A save on another card keeps its Undo there; any other result belongs to the last task.
  if (!(state.outcome?.kind === 'saved' && state.outcome.tool !== file.tool)) state.outcome = undefined;
  if (!openDraft(file, ownText(file), 'edit')) { rerender(); return; }
  state.baseEdit = undefined;
  rerender();
  const area = document.getElementById(`ins-text-${file.tool}`) as HTMLTextAreaElement | null;
  area?.focus();
  document.getElementById(`ins-actions-${file.tool}`)?.scrollIntoView({ block: 'nearest' });
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
 *  earlier version, putting the base back, an update) holds none. */
export const baseDraftTyped = () => { const edit = state.baseEdit; return !!edit && (!edit.source || edit.source.kind === 'own') && differsFromBase(edit); };
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

/** This home only shows its files: saving is off (a preview-only home or another build syncing). */
export const savingOff = () => !!state.home && !state.home.manage.access.allowed;

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
  const one = edited.length === 1;
  return [edited.length ? ` ${fileNames(edited)} ${one ? 'was' : 'were'} left as ${one ? 'it is' : 'they are'}: ${undoing ? 'changed there since the save' : `${one ? 'its' : 'their'} copy of the base was edited there`}.` : '',
    failed.length ? ` ${fileNames(failed)} could not be written; nothing in ${failed.length === 1 ? 'it' : 'them'} changed.` : '',
    result.problem ? ` ${result.problem}` : ''].join('');
}

/** Opens the base in its editor; a clean tool editor closes, since only one thing is edited at a time. */
export function startBaseEdit(draft: Omit<BaseEdit, 'hash' | 'stage'> & { stage?: BaseEdit['stage'] }) {
  if (askAboutOpenDraft()) return;
  if (state.outcome?.kind !== 'saved') state.outcome = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  state.baseEdit = { stage: 'edit', ...draft, hash: state.base?.hash ?? '' };
  rerender();
  document.getElementById(state.baseEdit.stage === 'edit' ? 'base-text' : 'base-save')?.focus();
  document.getElementById('base-card')?.scrollIntoView({ block: 'nearest' });
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

/**
 * The Undo an Apply all result offers: it names what it removes, and the tooltip says what stays. `alongside`: Disable, Enable or
 * Remove from the same Apply all, undone first, while the copies they act on are still there.
 */
function addedUndo(addedNow: HistoryEvent[], alongside: HistoryEvent[] = []) {
  const copies = addedNow.reduce((sum, event) => sum + event.losers.length, 0);
  const items = addedNow.length === 1 ? addedNow[0].item : addedNow.length === 2 ? 'both' : `all ${addedNow.length}`;
  return { label: 'Undo Apply all', id: 'outcome-undo-added', title: `Removes the ${copies === 1 ? 'new copy' : `${copies} new copies`} Apply all added (only while unchanged) and stops managing ${items}. Your original copies stay.`, run: () => void undoAdded([...alongside, ...addedNow].map(event => event.id)) };
}

/** The Undo a copy choice offers: it names the copies it puts back. */
function choiceUndo(chosenNow: HistoryEvent[]) {
  const back = [...new Set(chosenNow.flatMap(event => event.losers.map(loser => toolName(loser.tool))))];
  return { label: 'Undo choice', id: 'outcome-undo-choice',
    title: `Puts ${back.length === 1 ? `${back[0]}’s copy` : 'each replaced copy'} back, removes copies this choice added, and stops managing it again. Nothing is undone if a copy changed since.`,
    run: () => void undoChoices(chosenNow.map(event => event.id)) };
}

const undoChoices = (ids: string[]) => busy('Undoing the choice…', async () => {
  const home = state.home!;
  let stopped: string | undefined;
  for (const id of ids) {
    const result = await api().restore(id, home.manage.gate.state === 'needs-resume', home.home, 'narrow');
    if (result.stopped) { stopped = result.stopped; break; }
  }
  const view = await api().refresh();
  setHome(view);
  const items = [...new Set((state.history.data ?? []).filter(event => ids.includes(event.id)).map(event => event.item))];
  tell(stopped ? undefined : { page: state.page, items, text: 'Undone: each replaced copy is back in its own tool, and the skill is unmanaged again, with its copies differing as before.' }, stopped);
});

/** Undo of Apply all's new copies, for every skill it made Managed: each goes back to unmanaged, its new copies removed. */
export const undoAdded = (ids: string[]) => busy('Undoing Apply all…', async () => {
  const home = state.home!;
  // The run's own switches and removals ride along (undone first); only the 'added' events unmanage anything.
  const kinds = new Map((await api().history()).events.map(event => [event.id, event.kind]));
  const results: DestinationResult[] = [];
  const alongside: DestinationResult[] = [];
  let stopped: string | undefined;
  for (const id of ids) {
    const result = await api().restore(id, home.manage.gate.state === 'needs-resume', home.home);
    if (result.stopped) { stopped = result.stopped; break; }
    (kinds.get(id) === 'added' ? results : alongside).push(...result.results);
  }
  const view = await api().refresh();
  setHome(view);
  await putHistory();
  const removed = results.filter(entry => entry.outcome === 'removed').length;
  const stayed = results.filter(entry => entry.outcome === 'held');
  const items = [...new Set(results.map(entry => entry.item))];
  const also = alongside.filter(entry => entry.outcome === 'switched' || entry.outcome === 'written').map(entry => `${entry.item}: ${entry.outcome === 'written' ? `back in ${toolName(entry.harness ?? '')}` : entry.message.replace(/\.$/, '')}.`);
  tell(stopped ? undefined : { page: state.page, items, text: `Undone: removed ${plural(removed, 'new copy', 'new copies')}; ${andList(items)} ${items.length === 1 ? 'is' : 'are'} unmanaged again.${also.length ? ` ${also.join(' ')}` : ''}${stayed.length ? ` ${stayed.map(entry => entry.message).join(' ')}` : ''}` }, stopped);
  for (const item of items) flashRow(item);
});

/** Delete everywhere: offered when an edit was kept over a deletion with order unknown. */
export const deleteEverywhereKey = (key: string) => busy('Deleting everywhere…', async () => {
  const home = state.home!;
  const result = await api().deleteEverywhere(key, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  setHome(view);
  state.applied = result;
  announce(result.stopped ?? `Deleted from ${plural(result.harnessWrites, 'tool')}. Restore it from History.`);
});

// ---------- Sync switch and background changes ----------

export const setSync = (on: boolean) => busy(on ? 'Turning Sync on…' : 'Turning Sync off…', async () => {
  const view = await api().setSync(on);
  setHome(view);
  announce(on ? 'Automatic sync on.' : 'Automatic sync off.', true);
});

export const syncNow = () => busy('Syncing…', async () => {
  const view = await api().syncNow(state.home!.home);
  setHome(view);
  announce('Synced once. Automatic sync stays off.', true);
});

/** A background read is running, or one arrived while the page was busy and runs when it is done (busy). */
let refreshing = false;
let refreshOwed = false;
/** A background view that arrived while an action ran: its notices and caught-up results go into the next one (withSetAside). */
let setAside: HomeView | undefined;
// The Settings… menu item (and any later page the main process asks for) opens that page.
const isPage = (page: string): page is Page => (pages as readonly string[]).includes(page);
api().onNavigate(page => { if (isPage(page)) showPage(page); });
// Settings changed by a menu, a dialog or the system: main says so after every save and whenever the window comes back, and an
// open Settings page reads them again, so it never shows (or writes back) a value that is no longer the saved one.
api().onSettingsChanged(() => { if (state.page === 'settings') void loadSettings(); });

// A background pass may change what differs from the git repo too: its page and sidebar count read again soon (no fetch).
api().onSyncChanged(() => { loadRepoSoon(); void backgroundRefresh(); });

/** Each page's sync notices in a view: what changed on its own, with its History event. */
const noticesByPage = (view: HomeView): [Page, SyncNotice[]][] => [['skills', view.manage.notices], ['mcp', view.mcp.notices], ['agents', view.agents.notices]];

/**
 * A background pass changed something: read again quietly, keeping drafts. In the middle of an action it waits, and runs
 * when the action is done, so a change (a tool appearing, say) is never lost; an action that starts while the read is on
 * its way goes first, and the read runs again after it. What the status bar says stays, unless the view brings a notice
 * the page didn't have: then that is the news.
 */
async function backgroundRefresh() {
  if (!state.home) return;
  if (state.busy || refreshing) { refreshOwed = true; return; }
  refreshing = true;
  try {
    const read = await api().refresh();
    const view = read ? withSetAside(setAside, read) : undefined;
    if (state.busy) { refreshOwed = true; if (view) setAside = view; return; }
    if (!view) return;
    setAside = undefined;
    const known = new Set(state.home ? noticesByPage(state.home).flatMap(([, notices]) => notices.map(notice => notice.history)) : []);
    const fresh = noticesByPage(view).map(([page, notices]) => [page, notices.filter(notice => !known.has(notice.history))] as const).filter(([, notices]) => notices.length);
    if (fresh.length) {
      // A new sync notice is the news: the earlier result steps aside, and its Undo stays in History. Two Undo buttons for
      // different events, one above the other, is the one thing here that would mislead; the notice says where it went.
      const outcome = state.outcome;
      if (outcome?.act) state.undoMoved = { page: outcome.page, label: outcome.act.label, items: outcome.items ?? (outcome.item ? [outcome.item] : []), notices: noticesByPage(view).flatMap(([, notices]) => notices.map(notice => notice.history || notice.item)) };
      state.outcome = undefined;
      const items = [...new Set(fresh.flatMap(([, notices]) => notices.map(notice => notice.item)))];
      // On the page whose notice says it, screen readers hear it; elsewhere the status bar says it, beside the sidebar's dot.
      announce(`Sync changed ${andList(items)}.`, fresh.some(([page]) => page === state.page));
    }
    // A tool appeared or went away: the page leaves a kind no longer here and reads its own data again (setHome).
    setHome(view);
    rerender();
  } finally {
    refreshing = false;
    drainOwedRefresh();
  }
}

/** A background refresh asked for while busy or while another ran: run it now, once, if nothing is running. */
function drainOwedRefresh() {
  if (!refreshOwed || state.busy || refreshing) return;
  refreshOwed = false;
  void backgroundRefresh();
}

// ---------- MCP servers ----------

export const applyMcpChanges = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  // Read before applying: only a server this Apply all made Managed is said as now managed, and only its own History entries get an Undo here.
  const wasManaged = new Set((state.home?.mcp.servers ?? []).filter(server => server.managed).map(server => server.key));
  const started = Date.now();
  const result = await api().applyMcp(changes, state.home!.manage.gate.state === 'needs-resume', state.home!.home);
  const view = await api().refresh();
  setHome(view);
  state.mcpResult = result;
  if (!result.stopped) { onDone(); retireTip('mcp'); }
  if (!result.stopped) {
    const to = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean);
    const managed = changes.filter(change => change.managed && !wasManaged.has(change.key)).length;
    // The write band right below says what waits for Claude Code; the result names what was written, and where.
    const copied = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
    const matched = changes.filter(change => change.managed && !copied.includes(change.key)).map(change => change.key);
    // New entries are in History as 'added': one Undo removes them again (while unchanged) and unmanages those servers.
    const recent = (await api().history()).events.filter(event => !event.undoneBy && changes.some(change => `mcp:${change.key}` === event.key) && Date.parse(event.at) >= started - 1000);
    const addedNow = recent.filter(event => event.kind === 'added');
    const replacedAny = result.results.some(entry => entry.replaced);
    const undoable = addedNow.length > 0 && !replacedAny;
    const done = managed ? `${plural(managed, 'server')} now managed` : 'Applied';
    const wrote = copied.length ? `${andList(copied)} copied to ${andList(to)}` : 'Nothing needed writing';
    const already = matched.length && copied.length ? `; ${andList(matched)} ${matched.length === 1 ? 'was' : 'were'} already in ${andList(to)}` : '';
    const takeBack = undoable ? '' : ' To take a new copy back out of a tool, turn off that tool’s box and Apply all, then delete it there.';
    // Disable and Enable, per tool, said after the copies; alone, they are the whole result ("hindsight enabled in Copilot CLI.").
    const flipped = result.results.filter(entry => entry.outcome === 'switched');
    const flippedIn = (disabled: boolean) => [...new Set(flipped.filter(entry => entry.disabled === disabled).map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean);
    const switches = [flippedIn(true).length ? `disabled in ${andList(flippedIn(true))}` : '', flippedIn(false).length ? `enabled in ${andList(flippedIn(false))}` : ''].filter(Boolean).join(' · ');
    const touched = [...new Set(flipped.map(entry => entry.item))];
    const onlySwitches = !!switches && !managed && !copied.length;
    const switched = !switches ? '' : `${touched.length === 1 ? `${touched[0]} ${switches}` : switches.replace(/^./, first => first.toUpperCase())}, from ${flippedIn(true).concat(flippedIn(false)).length === 1 ? 'its' : 'their'} next session.`;
    // A lone Disable or Enable gets its own Undo here; more than one is undone from History.
    const switchedNow = recent.filter(event => event.kind === 'switched');
    const switchUndo = switchedNow.length === 1 && !undoable ? { label: 'Undo', id: 'outcome-undo-switch', title: 'Flip it back', run: () => void restoreEvent(switchedNow[0].id) } : undefined;
    tell({ page: state.page, act: undoable ? addedUndo(addedNow) : switchUndo, items: [...copied, ...matched, ...touched],
      text: onlySwitches ? switched : `${done}. ${wrote}${already}.${switched ? ` ${switched}` : ''}${takeBack}` });
  } else tell(undefined, result.stopped);
});

// ---------- Agents ----------

export const applyAgentsChanges = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  // Read before applying: a copy that had stopped and is now replaced is said as resumed, not as newly managed.
  const before = state.home?.agents.servers ?? [];
  const result = await api().applyAgents(changes, state.home!.manage.gate.state === 'needs-resume', state.home!.home);
  const view = await api().refresh();
  setHome(view);
  state.agentsResult = result;
  if (!result.stopped) { onDone(); retireTip('agents'); }
  if (!result.stopped) {
    // One-way agents are said apart: an edit spreads from their source only.
    const managed = changes.filter(change => change.managed).map(change => state.home?.agents.servers.find(server => server.key === change.key)).filter(server => !!server);
    const oneWay = managed.filter(server => Object.keys(server.limits ?? {}).length);
    const nameOf = (server: { name?: string; key: string }) => server.name ?? server.key;
    // New agent files are in History as 'added': one Undo removes them again (while unchanged) and unmanages those agents.
    const addedNow = (await api().history()).events.filter(event => event.kind === 'added' && !event.undoneBy && changes.some(change => `agent:${change.key}` === event.key) && Date.now() - Date.parse(event.at) < 5 * 60_000);
    const replacedAny = result.results.some(entry => entry.replaced);
    const undo = addedNow.length && !replacedAny;
    let outcome: Outcome = { page: state.page, items: managed.map(nameOf), text: `${plural(managed.length, 'agent')} managed · ${result.writes ? `${plural(result.writes, 'file')} written` : 'nothing needed writing'}. Edits now sync on their own${oneWay.length ? `; ${oneWay.map(server => `${nameOf(server)} only from ${server.oneWay ? toolName(server.oneWay.from) : 'its source'}`).join('; ')}` : ''}.${result.writes && !undo ? ' To take a new copy back out of a tool, turn off that tool’s box and Apply all, then delete it there.' : ''}`,
      act: undo ? addedUndo(addedNow) : undefined };
    const resumed = changes.map(change => ({ change, was: before.find(server => server.key === change.key) })).filter(({ change, was }) => change.use && change.use !== 'separate' && was?.managed && was.stopped?.length);
    // A resumed copy receives updates again: an earlier "keep my edit" no longer stands for a later edit.
    for (const { change, was } of resumed) for (const tool of was!.stopped!) writeFlag(keptEditFlag(state.home?.home ?? '', change.key, tool), false);
    if (resumed.length && resumed.length === changes.length && result.writes) {
      // The edit the resume replaced is one click back: its 'chosen' event restores it, and the copy stops again.
      const chosen = (await api().history()).events.filter(event => event.kind === 'chosen' && !event.undoneBy && resumed.some(({ change }) => event.key === `agent:${change.key}`) && Date.now() - Date.parse(event.at) < 5 * 60_000);
      const back = [...new Set(chosen.flatMap(event => event.losers.map(loser => toolName(loser.tool) ?? loser.tool)))];
      outcome = { page: state.page, items: resumed.map(({ was }) => nameOf(was!)),
        text: resumed.map(({ change, was }) => `${andList(was!.stopped!.map(tool => toolName(tool) ?? tool))} ${was!.stopped!.length === 1 ? 'has' : 'have'} ${toolName(change.use!) ?? change.use}’s copy of ${nameOf(was!)} again and receives its updates`).join('; ') + '. The edited copy is in History.',
        act: chosen.length === 1 && back.length ? { label: `Restore ${andList(back)}’s edit`, id: 'outcome-restore-edit', title: `Puts ${andList(back)}’s edited copy back; it stops updating again`, run: () => void restoreEvent(chosen[0]!.id, 'narrow') } : undefined };
    }
    tell(outcome);
  } else tell(undefined, result.stopped);
});

/** Write now: Claude Code's entries, once the person has quit Claude Code (MCP-02). */
export const writeClaudeNow = (names: string[]) => { const earlier = state.outcome?.page === state.page ? state.outcome?.act?.label : undefined; return busy('Writing to Claude Code…', async () => {
  const result = await api().writeClaude(names, state.home!.home);
  const view = await api().refresh();
  setHome(view);
  state.mcpResult = result;
  const written = result.claudeWritten ?? [];
  tell(result.stopped ? undefined : { page: state.page, item: names.length === 1 ? names[0] : undefined, items: names, text: state.home?.mode === 'fixture' ? `${names.join(', ')} written to the practice copy of Claude Code’s settings.` : `${names.join(', ')} written to Claude Code. Start Claude Code again to use ${names.length === 1 ? 'it' : 'them'}.`,
    // The result this replaces offered its own Undo: say where it went, so the way back from the bigger step is not lost.
    note: earlier && earlier !== 'Undo write' ? `${earlier} is in History.` : undefined,
    act: written.length ? { label: 'Undo write', id: 'outcome-undo-write', title: `Puts back what Claude Code had before (${written.map(write => `${write.name}: ${write.before ? 'its earlier entry' : 'removed'}`).join(', ')}). Quit Claude Code first.`, run: () => void unwriteClaudeNow(written) } : undefined }, result.stopped);
}); };

const unwriteClaudeNow = (written: ClaudeWrite[]) => busy('Undoing the write…', async () => {
  const result = await api().unwriteClaude(written, state.home!.home);
  const view = await api().refresh();
  setHome(view);
  const names = written.map(write => write.name);
  tell(result.stopped ? undefined : { page: state.page, items: names, text: `Undone: Claude Code has what it had before. ${names.join(', ')} ${names.length === 1 ? 'waits' : 'wait'} for Write to Claude Code again.` }, result.stopped);
});

// ---------- Profiles ----------

/**
 * What a switch or its undo did not change, said once after the result: switches that could not change (a failure, a tool that
 * can't be switched), and, for an undo, switches left as they are because they changed since.
 */
const notChangedNote = (results: DestinationResult[]) => {
  const failed = results.filter(couldNotChange);
  const items = (list: DestinationResult[]) => new Set(list.map(entry => entry.item)).size;
  const stayed = items(results.filter(entry => entry.outcome === 'stayed'));
  return (failed.length ? ` ${plural(items(failed), 'item')} could not change: ${failed.slice(0, 2).map(entry => entry.message).join(' ')}${failed.length > 2 ? ' …' : ''}` : '')
    + (stayed ? ` ${plural(stayed, 'item')} changed since, so ${stayed === 1 ? 'it was' : 'they were'} left as ${stayed === 1 ? 'it is' : 'they are'}.` : '');
};
/** A switch that failed, or whose tool can't be read: it stayed as it was. */
const couldNotChange = (entry: DestinationResult) => entry.outcome === 'failed' || entry.outcome === 'held';
/** What flips changed, in words; with none, whether nothing needed it (`nothing`) or the switches it needed couldn't change. */
const changedWords = (result: { flips?: ProfileFlip[]; results: DestinationResult[] }, nothing: string) =>
  flipSummary(result.flips ?? []) || (result.results.some(couldNotChange) ? 'no switch changed' : nothing);

/** The Profiles page's id for No profile, in the list and in `profileState.open`. */
export const NONE = 'none';

/** What the Profiles page is doing with its profiles. */
export const profileState = {
  /** The profile open: a profile's id, or NONE for No profile; unset shows the one in use. */
  open: undefined as string | undefined,
  /** The profile whose Delete is asking to be confirmed. */
  confirmDelete: undefined as string | undefined,
  /** The profile whose name is being edited. */
  renaming: undefined as string | undefined,
  /** The name as typed while renaming, kept across redraws. */
  draft: undefined as string | undefined,
};

/** What a switch did, as the result band says it, with Undo switch (from the page or, next time the window shows, the menu bar). */
function switchOutcome(result: ProfileSwitchResult) {
  const name = result.name ?? NO_PROFILE;
  const said = result.again ? `Applied ${name} to tools again.` : `${name} is the profile now.`;
  const what = changedWords(result, 'nothing needed switching');
  tell({ page: state.page, item: name, text: `${said} ${sentence(what)}${result.flips.length ? '; new sessions use it.' : '.'}${notChangedNote(result.results)}`,
    act: result.event ? { label: 'Undo switch', id: 'outcome-undo', title: 'Switch back: each switch this changed goes back', run: () => void restoreEvent(result.event!) } : undefined });
}

/**
 * What an Undo of a profile switch did, as its band says it, with the Undo of that undo (`undoneBy`, the new History entry). Said
 * from the profiles as they are now: an undo of an older switch puts its switches back but leaves the profile a later switch
 * chose. Undoing an undo redoes the switch, and its own Undo is an undo again.
 */
function undoOutcome(result: ApplyResult, undoneBy: string | undefined) {
  const inUse = (state.home && activeProfile(state.home.profiles)?.name) ?? NO_PROFILE;
  const history = state.history.data ?? [];
  const made = history.find(event => event.id === undoneBy);
  const redo = !!made && !!redoneSwitch(history, made);
  tell({ page: state.page, text: `${redo ? 'Redone' : 'Undone'}: ${changedWords(result, 'nothing needed putting back')}; ${inUse} is the profile in use. New sessions use it.${notChangedNote(result.results)}`,
    act: undoneBy ? { label: redo ? 'Undo switch' : 'Redo switch', id: 'outcome-undo', run: () => void restoreEvent(undoneBy) } : undefined });
}

/** Switches to a profile (null: No profile). The band says what changed, with Undo; the menu bar follows. */
export const switchToProfile = (id: string | null) => busy('Switching profile…', async () => {
  const result = await api().switchProfile(id, state.home!.home);
  if (result.view) setHome(result.view);
  if (result.stopped) { announce(result.stopped); return; }
  switchOutcome(result);
  if (state.page === 'history') await putHistory();
});
// A switch from the menu bar: its result and Undo are on the page the next time the window shows.
api().onProfileSwitched(async result => {
  switchOutcome(result);
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
  tell({ page: 'profiles', item: gone.name, text: `Deleted the profile ${gone.name}. Nothing in your tools changed.`,
    act: { label: 'Undo', id: 'outcome-undo-delete-profile', title: `Make ${gone.name} again, with the same items`, run: () => void saveProfileDef({ ...gone, restore: true }, `${gone.name} is back.`) } });
});
