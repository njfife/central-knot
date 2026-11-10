import { loadSettings, openSettings } from './settingspage.ts';
import type { ApplyResult, Change, DesktopApi, DestinationResult, HarnessId, InstructionFile, HistoryEvent, HistoryDays, HomeMode, HomeView, McpResult, ClaudeWrite, SyncNotice } from './types.ts';
import { plural } from './model.ts';
import { h } from './dom.ts';
import { keptEditFlag, readFlag, writeFlag } from './flags.ts';
import { andList, noToolsSentence, orList, toolName, toolNames as namedTools, toolsPhrase } from './words.ts';
import { machineNames, pagePlatform } from './machine.ts';
import { loadPlugins, resetMarket } from './pluginstate.ts';
import { nextDraft, unsaved, type InstructionDraft } from './drafts.ts';
import { absentKindsIn, heldKinds, kindNames, kindNouns, type HomeKind } from './presence.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

/** Every page, in the sidebar's order. */
export const pages = ['overview', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'history', 'tools', 'settings'] as const;
export type Page = typeof pages[number];

/** This computer's names, and what its platform offers (machine.ts). */
export const machine = machineNames(pagePlatform(navigator.userAgent));
export const { home: realHomeName, machine: thisMachine, tray: trayPlace } = machine;

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
  /** Sync notices the person has dismissed, by History event or item. */
  dismissed: new Set<string>(),
  // The page whose Apply result (and its Undo) stepped aside for a sync notice: the notice says where the Undo went.
  undoMoved: undefined as { page: Page; notices: string[]; label: string; items: string[] } | undefined,
  /** Sync notices already shown on their page, so the sidebar dot clears once seen. */
  seenNotices: new Set<string>(),
  /** Whether the content is wide enough to dock an open row's details beside its table; set by the renderer's layout. */
  wide: false,
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
  else announce(outcome.text, !saidInStatusBar(outcome));
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
  // Only a message that repeats what the page shows (announced quiet) is for screen readers alone.
  region.classList.toggle('visually-hidden', told.quiet);
  // A narrow status bar shows a small mark instead of a message cut to a stub; its tooltip has the message (style.css).
  const mark = document.getElementById('message-mark');
  if (mark) { mark.title = told.text; mark.hidden = !told.text || told.quiet; }
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
  if (before !== undefined && homeTools().join() === before) return;
  leaveAbsentPage();
  if (reload) void loadPageData(state.page);
}

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
  focusById(focused);
  drainOwedRefresh();
}

/**
 * Opens a home (a switch, or the first at launch), where setHome only takes a newer view of the same one. Everything
 * read or chosen for the home before is let go: its pages' data (each starts over at reading, and is read for this home
 * at once), the marketplace choices and the open skill. An unsaved Instructions draft is kept: the Instructions page
 * offers to copy or discard it.
 */
function accept(view: HomeView) {
  state.home = undefined;
  state.applied = undefined;
  state.item = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  resetPageData(state.instructions);
  resetPageData(state.history);
  resetMarket();
  setHome(view, { reload: false });
  void loadInstructions();
  void loadHistory();
  if (!absentKinds().includes('plugins')) void loadPlugins(false, view.readId);
  if (state.page === 'settings') void loadSettings();
}

/** A row to flash on its next draw (set by Undo and Restore; the matrix reads it). */
export const flashRequests = new Set<string>();
const flashRow = (item: string) => { if (item) flashRequests.add(item.toLowerCase()); };

/** After the first Apply all on a page, its tip has done its job. */
const retireTip = (kind: 'skills' | 'mcp' | 'agents') => writeFlag(`ck-help-dismissed-${kind}`);

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
  return `Read ${andList(counts)}${from ? ` from ${from}` : ''}.${stopped ? '' : ' Nothing changed.'}`;
}

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

export const loadHome = (mode: HomeMode) => (state.lastMode = mode, busy(`Reading ${mode === 'fixture' ? 'the practice copy' : mode === 'actual' ? 'your real tools' : 'that folder'}…`, async () => {
  const previous = state.home;
  const view = await api().selectHome(mode);
  const nothing = view && !view.manage.skills.length && !view.mcp.servers.length && !view.agents.servers.length;
  // Sync follows the open home: leaving one with managed items stops its syncing, so the band says so and offers the way back.
  const left = previous && view && previous.home !== view.home && [...previous.manage.skills, ...previous.mcp.servers, ...previous.agents.servers].some(fact => fact.managed) ? previous : undefined;
  const leftText = left ? ` ${left.label} is not syncing while another home is open.` : '';
  if (!view) { announce(''); return; }
  accept(view);
  // An empty home (no tools, or nothing in them) says only that it opened; the page says the rest.
  tell({ page: state.page, carry: true, text: (nothing ? `Opened ${view.label}.` : `Opened ${view.label}. ${readFound(view)}`) + leftText,
    act: left && left.mode !== 'custom' ? { label: `Go back to ${left.label}`, id: 'outcome-go-back', run: () => void loadHome(left.mode) } : undefined });
}));

/** At launch: the home last opened (so sync resumes where it was), else this computer's home (dev builds: the practice copy). */
export const startHome = () => busy('Reading skills, MCP servers and agents…', async () => {
  const view = await api().startHome();
  // The first read is said the same way as a home switch: a band, not a passing status line.
  const practiceNote = view?.mode === 'fixture' && practiceNoteOpen();
  if (!view) { announce(''); return; }
  accept(view);
  const nothing = !view.manage.skills.length && !view.mcp.servers.length && !view.agents.servers.length;
  if (practiceNote) announce(readSummary(view), true);
  else tell({ page: state.page, carry: true, text: nothing ? `Opened ${view.label}.` : `Opened ${view.label}. ${readFound(view)}` });
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

/**
 * Reads what a page shows beyond the home itself: History, Settings, Instructions or Plugins, into its slot
 * (pagedata.ts), never as an action: the page says it is reading, and anything else can go on meanwhile. `fresh` reads
 * each marketplace anew.
 */
function loadPageData(page: Page, { fresh = false, readId }: { fresh?: boolean; readId?: number } = {}): Promise<void> {
  if (page === 'history') return loadHistory();
  if (page === 'settings') return loadSettings().then(() => undefined);
  if (page === 'instructions') return loadInstructions();
  if (page === 'plugins') return loadPlugins(fresh, readId);
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

export function showPage(page: Page) {
  // Plugins keep what they read while the person stays on them; every other page reads its data each time it opens.
  const stays = page === 'plugins' && state.page === 'plugins';
  // A new page starts clean: the last action's message and results belong to the page they happened on.
  // A home-switch result survives one page change, since switching is often followed by a click elsewhere.
  const carried = state.outcome?.carry ? { ...state.outcome, page, carry: false } : undefined;
  if (page !== state.page) {
    state.applied = undefined; state.mcpResult = undefined; state.agentsResult = undefined; state.skillsView = 'table';
    tell(carried);
  }
  // Settings opens fresh (what its rows said last visit belongs to that visit); every other page reads its own data.
  if (page === 'settings') openSettings();
  else if (!stays) void loadPageData(page);
  state.page = page;
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
  state.applied = result;
  const restored = result.results.filter(entry => entry.outcome === 'written');
  const where = [...new Set(restored.map(entry => entry.harness ?? ''))].filter(Boolean);
  // The new History event is the one that undid this; offering it inline makes the undo itself undoable here.
  const past = state.history.data?.find(event => event.id === eventId);
  const undoneBy = past?.undoneBy;
  const everywhere = touchedToolsPhrase(where);
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
      ? [where.length ? `${past.item} is back in ${andList(where)}.` : '', ...result.results.filter(entry => entry.outcome !== 'written').map(entry => entry.message), stillDisabled(past.key, restored)].filter(Boolean).join(' ')
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
  note?: string;
  item?: string;
  items?: string[];
  /** Said again on the next page opened (a home just opened). */
  carry?: boolean;
  /** An instruction file saved: its card says so, with its Undo (instructionspage.ts). */
  kind?: 'saved';
  history?: boolean;
  undo?: { id: string; label: string };
  act?: { label: string; id: string; run: () => void; title?: string };
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
function openDraft(file: InstructionFile, text: string, stage: InstructionDraft['stage'], restoring = false): boolean {
  const next = nextDraft(state.instructionEdit, { tool: file.tool, from: { home: state.home!.home, path: file.path, text: file.text }, text, hash: file.hash, stage, restoring });
  if (next.refused) announce('Your unsaved instructions draft is still open. Save, copy or discard it first.');
  state.instructionEdit = next.draft;
  return !next.refused;
}

/** A draft whose file is gone (its tool left the home) is dropped once the files are read, unless it holds something unsaved. */
const settleDraft = () => { if (state.instructionEdit && !draftFile() && !draftUnsaved()) state.instructionEdit = undefined; };

/** Reads each tool's instruction file into its slot; the page redraws once the answer is the newest. */
export const loadInstructions = async (): Promise<void> => {
  const reading = readPageData(state.instructions, () => api().instructions());
  rerender();
  const result = await reading;
  if (result === 'dropped') return;
  if (result === 'ready') settleDraft();
  rerender();
};

/** The files again after a save, as an action read them. */
const rereadInstructions = async () => { const files = await api().instructions(); if (files) { putPageData(state.instructions, files); settleDraft(); } };

/** A checked save of one file: it must still hold what was opened; the replaced text is kept as an earlier version. */
export const saveInstructionText = (file: InstructionFile, text: string) => busy('Saving…', async () => {
  const result = await api().saveInstruction(file.tool, text, state.instructionEdit?.hash ?? file.hash, state.home!.home);
  await rereadInstructions();
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  if (result.stopped) {
    state.outcome = undefined;
    const now = state.instructions.data?.find(entry => entry.tool === file.tool);
    // Changed outside: the draft stays, now checked against the file as it is, and the review compares with that.
    if (state.instructionEdit && now && now.hash !== state.instructionEdit.hash) { Object.assign(state.instructionEdit, { hash: now.hash, stage: 'review', conflict: true }); announce(`${name} changed outside Central Knot. Your draft is kept; review it against the current file.`); return; }
    announce(result.stopped); if (state.instructionEdit) state.instructionEdit.stage = 'edit'; return;
  }
  state.instructionEdit = undefined;
  // Undo is one click: the replaced text goes back through the same checked save, which keeps this version in turn.
  const saved = state.instructions.data?.find(entry => entry.tool === file.tool);
  const before = file.exists && result.saved ? file.text : undefined;
  tell({ page: 'instructions', item: name, kind: file.exists && result.saved ? 'saved' : undefined, text: result.saved ? `${file.exists ? 'Saved' : 'Created'} ${name}. ${file.exists ? '' : 'Central Knot never deletes instruction files; edit it here to change it. '}Start a new ${toolName(file.tool)} session to use the change.` : `${name} already said that; nothing was written.`,
    act: before !== undefined && saved ? { label: 'Undo', id: 'outcome-undo-instruction', run: () => void undoInstruction(saved, before) } : undefined });
});

/** Puts back the text a save replaced: a checked save against what was just written. */
const undoInstruction = (file: InstructionFile, before: string) => busy('Undoing the save…', async () => {
  const result = await api().saveInstruction(file.tool, before, file.hash, state.home!.home);
  await rereadInstructions();
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  tell(result.stopped ? undefined : { page: 'instructions', item: name, text: `${name} is back as it was before your save. The text you saved is under Earlier versions.` }, result.stopped);
});

/** Opens one file in the editor; any earlier result band belongs to the last task, not this one. */
export function startInstructionEdit(file: InstructionFile) {
  // A save on another card keeps its Undo there; any other result belongs to the last task.
  if (!(state.outcome?.kind === 'saved' && state.outcome.item !== file.path.split(/[\\/]/).pop())) state.outcome = undefined;
  if (!openDraft(file, file.text, 'edit')) { rerender(); return; }
  rerender();
  const area = document.getElementById(`ins-text-${file.tool}`) as HTMLTextAreaElement | null;
  area?.focus();
  document.getElementById(`ins-actions-${file.tool}`)?.scrollIntoView({ block: 'nearest' });
}

/** Loads an earlier version into the editor; putting it back is an ordinary save, with its diff first. */
export const loadInstructionVersion = (file: InstructionFile, id: string) => busy('Reading the earlier version…', async () => {
  const text = await api().instructionVersion(file.tool, id);
  if (text === undefined) { announce('That version is no longer kept.'); return; }
  if (!openDraft(file, text, 'review', true)) return;
  state.outcome = undefined;
  announce('Review going back to the earlier version, then save to put it back.', true);
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
// The Settings… menu item (and any later page the main process asks for) opens that page.
const isPage = (page: string): page is Page => (pages as readonly string[]).includes(page);
api().onNavigate(page => { if (isPage(page)) showPage(page); });
// Settings changed by a menu, a dialog or the system: main says so after every save and whenever the window comes back, and an
// open Settings page reads them again, so it never shows (or writes back) a value that is no longer the saved one.
api().onSettingsChanged(() => { if (state.page === 'settings') void loadSettings(); });

api().onSyncChanged(() => void backgroundRefresh());

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
    const view = await api().refresh();
    if (state.busy) { refreshOwed = true; return; }
    if (!view) return;
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
  const result = await api().applyMcp(changes, state.home!.manage.gate.state === 'needs-resume', state.home!.home);
  const view = await api().refresh();
  setHome(view);
  state.mcpResult = result;
  if (!result.stopped) { onDone(); retireTip('mcp'); }
  if (!result.stopped) {
    const to = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean);
    const managed = changes.filter(change => change.managed).length;
    // The write band right below says what waits for Claude Code; the result names what was written, and where.
    const copied = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
    const matched = changes.filter(change => change.managed && !copied.includes(change.key)).map(change => change.key);
    // New entries are in History as 'added': one Undo removes them again (while unchanged) and unmanages those servers.
    const addedNow = (await api().history()).events.filter(event => event.kind === 'added' && !event.undoneBy && changes.some(change => `mcp:${change.key}` === event.key) && Date.now() - Date.parse(event.at) < 5 * 60_000);
    const replacedAny = result.results.some(entry => entry.replaced);
    const undoable = addedNow.length > 0 && !replacedAny;
    const done = managed ? `${plural(managed, 'server')} now managed` : 'Applied';
    const wrote = copied.length ? `${andList(copied)} copied to ${andList(to)}` : 'Nothing needed writing';
    const already = matched.length && copied.length ? `; ${andList(matched)} ${matched.length === 1 ? 'was' : 'were'} already in ${andList(to)}` : '';
    const takeBack = undoable ? '' : ' To take a new copy back out of a tool, turn off that tool’s box and Apply all, then delete it there.';
    tell({ page: state.page, act: undoable ? addedUndo(addedNow) : undefined, items: [...copied, ...matched], text: `${done}. ${wrote}${already}.${takeBack}` });
  } else tell(undefined, result.stopped);
});

// ---------- Agents ----------

export const applyAgentsChanges = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  // Read before applying: a copy that had stopped and is now replaced is said as resumed, not as newly managed.
  const before = state.home?.agents?.servers ?? [];
  const result = await api().applyAgents(changes, state.home!.manage.gate.state === 'needs-resume', state.home!.home);
  const view = await api().refresh();
  setHome(view);
  state.agentsResult = result;
  if (!result.stopped) { onDone(); retireTip('agents'); }
  if (!result.stopped) {
    // One-way agents are said apart: an edit spreads from their source only.
    const managed = changes.filter(change => change.managed).map(change => state.home?.agents?.servers.find(server => server.key === change.key)).filter(server => !!server);
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
