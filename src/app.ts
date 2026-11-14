// The page's state and most pages' actions (MAP.md, "The app's shell and Settings"): the open home's view and each page's own
// state (`state`), the page shown (showPage), what is said after a click (tell, announce) and the busy line (busy); a click on
// an item page sent to its kind's engine (applyClick, through kindPages) and its result kept for the page (lastResult); History's
// actions (restoreEvent); the reads of the home (loadHome, readAgain) and the Sync switch, Sync once and Synchronize everything's
// row; and the Instructions, base instructions and Profiles pages' actions. A sync notice lives across reads here, until its
// page shows it (keepUnshown); on its page, matrix.ts toldNotices keeps or folds it. Not here: drawing (renderer.ts and each
// page's module), the Plugins page's state (pluginstate.ts), the Sources and Git repo pages' (sourcespage.ts, repopage.ts), and
// every rule a page shows (the engines' answers in the view: libraryrow.ts, historyactions.ts, profileplan.ts).
import { forgetRepoPrompts, loadRepo, loadRepoSoon } from './repopage.ts';
import { forgetSourcePrompts, loadSources } from './sourcespage.ts';
import { loadSettings, openSettings } from './settingspage.ts';
import { checkNow } from './updateview.ts';
import { loadPluginUpdates } from './pluginupdateview.ts';
import type { ApplyResult, ProfileEdit, ProfileSwitchResult, BaseApply, BaseResult, BaseUndo, BaseView, Change, DesktopApi, DestinationResult, HarnessId, InstructionFile, HistoryEvent, HistoryDays, HomeMode, HomeView, PassResult, SyncNotice } from './types.ts';
import { anyOn, kindSource } from './itemrow.ts';
import { caughtUpNames, noticeNames, plural, withSetAside } from './model.ts';
import { h } from './dom.ts';
import { readFlag, writeFlag } from './flags.ts';
import { pluginItemCount } from './pluginrows.ts';
import { clickResults, keptBack } from './clickplan.ts';
import { entriesNow, everythingDone, libraryAction, libraryEntry, librarySentence, restorePlan } from './historyactions.ts';
import { libraryWords } from './libraryrow.ts';
import { andList, fileName, kindNames, kindNouns, noToolsSentence, orList, toolList, toolName, toolNames as namedTools, toolsPhrase } from './words.ts';
import { withOwn, withoutBase } from './basetext.ts';
import { machineNames, pagePlatform } from './machine.ts';
import { loadPlugins, resetMarket } from './pluginstate.ts';
import { clear as clearPluginOp, resultLines, resultSentence, reverse, runPlan, strayHolds, succeeded, type PluginOp } from './pluginplan.ts';
import { nextDraft, unsaved, type InstructionDraft } from './drafts.ts';
import { absentKindsIn, heldKinds, type HomeKind } from './presence.ts';
import { pageData, putPageData, readPageData, resetPageData } from './pagedata.ts';
import { turnsWords } from './profileplan.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

/** Every page, in the sidebar's order. */
export const pages = ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'profiles', 'history', 'sources', 'repo', 'settings'] as const;
export type Page = typeof pages[number];

/** This computer's names, and what its platform offers (machine.ts). */
export const machine = machineNames(pagePlatform(navigator.userAgent));
export const { home: realHomeName, machine: thisMachine, tray: trayPlace } = machine;

/** The kinds of item the tables manage. */
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
  /** What the last click on MCP servers, or Write to Claude Code, did. */
  mcpResult: undefined as PassResult | undefined,
  agentsResult: undefined as PassResult | undefined,
  /** What sync and actions did, newest last: read when the History page opens or the home changes (pagedata.ts). */
  history: pageData<HistoryEvent[]>(),
  /** How long History keeps things, for History's intro; read with History's events. */
  historyDays: undefined as HistoryDays | undefined,
  /** What the last click on skills did, shown until the next action or read. */
  skillsResult: undefined as PassResult | undefined,
  /** The Skills page: the table, or one skill's files and contents beside the list. */
  skillsView: 'table' as 'table' | 'files',
  /** Counts moves to another page, so what belongs to one visit (an armed Delete) can tell it has ended. */
  visit: 0,
  /**
   * What the status bar says (announce): the newest message, whether it is for screen readers only, and its place in
   * the order messages were said, so the newest always wins.
   */
  said: { text: '', quiet: false, seq: 0 } as { text: string; quiet: boolean; seq: number; link?: { label: string; run: () => void } },
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
  /** The question of which tool writes a draft of the base is open on its card; `problem`: why the last try gave no draft. */
  draftPick: undefined as { problem?: string } | undefined,
  /** The tool writing a draft of the base right now. */
  drafting: undefined as HarnessId | undefined,
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
  else { announce(outcome.text, !saidInStatusBar(outcome)); outcome.said = state.said.seq; }
  if (outcome?.fade) setTimeout(() => { if (state.outcome !== outcome) return; state.outcome = undefined; rerender(); }, FADE_MS);
}

/** How long an Undo's confirmation stays in its band. */
const FADE_MS = 5000;

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
  state.home = keepUnshown(state.home, view);
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
  if (state.said.seq === working) announce(before.text, before.quiet, before.link);
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
  resetMarket();
  // The note of what plugin updates did by themselves is about one home.
  void loadPluginUpdates();
  setHome(view, { reload: false });
  void loadPageData(state.page, { readId: view.readId });
  // The sidebar counts what waits each way for the repo, so it is read with the home (no fetch: that waits for the page).
  if (state.page !== 'repo') void loadRepo(false);
  // The sidebar counts the sources too (their last reads: no network).
  if (state.page !== 'sources') void loadSources();
}

/** A row to flash on its next draw (set by Undo and Restore; the matrix reads it). */
export const flashRequests = new Set<string>();
const flashRow = (item: string) => { if (item) flashRequests.add(item.toLowerCase()); };

// ---------- One switch per item ----------

/** One click on an item page: the changes it makes, the item names it concerns, and what the result says it did. */
export interface Click {
  kind: PageKind;
  changes: Change[];
  items: string[];
  /**
   * What was done, as the result's sentence ("notes is on in all 3 tools"); as a function, given the tools where the click's
   * write failed or was held, so it never claims those, and the tools it wrote.
   */
  said: string | ((notIn: HarnessId[], wrote: HarnessId[]) => string);
  /** Said after it, as a warning: what the click left as it is, and why ("Still on in Codex: its settings file can’t be read."). */
  also?: string;
  /** Said after it, as a plain note: what is still to come, or left as it should be ("Claude Code gets it when you click Write to Claude Code."). */
  note?: string;
  /** An Undo: its result is said for a few seconds, with no Undo of its own. */
  undoing?: boolean;
  /**
   * Its part in the tools that have the item through a plugin (pluginswitch.ts turnEvery): run once the copies' part went
   * through, never beside a click refused as a whole. `said`: what that part brought with it, said when it all worked.
   */
  plugins?: { ops: PluginOp[]; draft: Map<string, PluginOp>; said?: string };
  /** Offered beside the Undo: the next step the result names (the whole plugin's switch where one item has none). */
  next?: Outcome['next'];
}

/** Each item page's own: how its changes are sent, and where its last result is kept. Its items are itemrow.ts kindSource's. */
const kindPages: Record<PageKind, { send: (changes: Change[], resume: boolean, home: string) => Promise<PassResult>; keep: (results: DestinationResult[], notices?: SyncNotice[]) => void }> = {
  skills: { send: (...args) => api().applySkills(...args), keep: (results, notices) => { state.skillsResult = { results, writes: 0, notices }; } },
  mcp: { send: (...args) => api().applyServers(...args), keep: (results, notices) => { state.mcpResult = { results, writes: 0, notices }; } },
  agents: { send: (...args) => api().applyAgents(...args), keep: (results, notices) => { state.agentsResult = { results, writes: 0, notices }; } },
};
/** Each item page's last click's result, as kindPages keeps it: what the page's bands and notices read. */
export const lastResult = (kind: PageKind): PassResult | undefined => ({ skills: state.skillsResult, mcp: state.mcpResult, agents: state.agentsResult })[kind];

/**
 * Whether a click in this home is a Resume: the page shows it waiting for one (share.ts libraryGate `resume`). Sent with the
 * clicks that resume such a home, as Resume itself does: an item page's clicks (first setup's walkthrough's too), a tool's
 * Manage switch, Take over, Clear the switch and Convert to a skill. History's actions, a profile switch and Synchronize
 * everything's switch send nothing, and are refused there until Resume.
 */
export const clickResumes = (home: HomeView) => home.sync.gate.state === 'needs-resume';
/** Sends one kind's changes for the open home. */
const send = (kind: PageKind, changes: Change[]) => kindPages[kind].send(changes, clickResumes(state.home!), state.home!.home);

/**
 * One click, applied at once: an item's switch, or one tool's control in its details. The result says what was done, or why
 * nothing was, in the band at the top of the page. Its one Undo reverses exactly what the click did: the History entries the
 * click itself made (never what sync did alongside), each by its own action (historyactions.ts). A write that waits for Write
 * to Claude Code is not said as done: its tool is among those the click didn't reach, and a note says it waits.
 */
export const applyClick = (click: Click) => busy('Applying…', async () => {
  const names = [...click.items, ...click.changes.map(change => change.key)];
  // Any click is a pass, even with no change (Resume).
  const result = await send(click.kind, click.changes);
  setHome(await api().refresh());
  const { ours, did, refusal, failed, differs, notIn } = clickResults(result.results, names);
  // A refusal is the click's result, said in its own band, not again among the failures.
  kindPages[click.kind].keep(ours.filter(entry => entry !== refusal), result.notices);
  if (result.stopped) { tell({ page: state.page, items: click.items, warn: true, band: true, text: result.stopped }); return; }
  const made = result.made ?? [];
  // The plugins' part, once the copies' part went through (a whole-click refusal leaves it unrun).
  const plugged = click.plugins?.ops.length && (did || made.length || !refusal) ? await runSwitches(click.plugins.ops, click.plugins.draft) : undefined;
  if (plugged) setHome(await api().refresh());
  const done = did || made.length > 0 || !!plugged?.done.length;
  // Said from what happened: a tool whose write failed, copy or plugin switch, is not called on (or off); nor one whose write waits.
  const wrote = [...new Set(ours.filter(entry => entry.outcome === 'written' && entry.harness).map(entry => entry.harness!))];
  const waited = [...new Set(ours.filter(entry => entry.waits && entry.harness).map(entry => entry.harness!))];
  const waits = waited.length ? `${andList(waited.map(tool => toolName(tool)))} ${waited.length === 1 ? 'waits' : 'wait'} for Write to Claude Code.` : '';
  const said = typeof click.said === 'string' ? click.said : click.said([...notIn, ...waited, ...(plugged?.failedIn ?? [])], wrote);
  const choose = differs ? ' Its copies differ: choose which copy every tool uses.' : '';
  const plugText = !plugged ? '' : plugged.failed.length || plugged.stopped ? switchProblems(plugged) : click.plugins?.said ?? '';
  // A hold that came after the change is said beside what was done, not dropped.
  const text = done || !refusal ? [said, plugText, click.also, [click.note, waits].filter(Boolean).join(' '), refusal?.message].filter(Boolean).join(' ') + choose : refusal.message;
  const switchedBack = plugged?.back ?? [];
  const undo = click.undoing || !done ? undefined : (made.length && await allUndoable(made)) || switchedBack.length ? () => void undoClick(click, made, switchedBack) : undefined;
  const warned = failed || !!plugged?.failed.length || !!plugged?.stopped;
  tell({ page: state.page, items: click.items, warn: warned || !!click.also || !!refusal, band: true, fade: click.undoing && !warned, next: done || !refusal ? click.next : undefined,
    text, act: undo ? { label: 'Undo', id: 'outcome-undo', title: 'Put back everything this did', run: undo } : undefined });
  for (const item of click.items) flashRow(item);
});

/**
 * Whether each History entry a click made still offers its own action, so the click's Undo can run them all: an Add that would
 * give Claude Code its MCP entry back offers none (historyactions.ts givesBackLater).
 */
async function allUndoable(made: string[]) {
  const events = (await api().history()).events.filter(event => made.includes(event.id));
  const about = entriesNow(state.home!);
  return events.every(event => !libraryEntry(event) || !!libraryAction(event, about(event).item, about(event).now));
}

/** Undo of one click: each History entry it made goes back, newest first, by its own action (historyactions.ts). */
const undoClick = (click: Click, made: string[], switchedBack: PluginOp[] = []) => busy('Undoing…', async () => {
  const home = state.home!;
  // The plugin items' switches go back first: other tools than the copies', so the rest is undone whatever they do.
  const unswitched = switchedBack.length ? await runSwitches(switchedBack, new Map(), true) : undefined;
  const events = (await api().history()).events.filter(event => made.includes(event.id)).sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  const results: DestinationResult[] = [];
  let stopped: string | undefined;
  for (const event of events) {
    const result = await api().restore(event.id, home.home);
    if (result.stopped) { stopped = result.stopped; break; }
    results.push(...result.results);
  }
  setHome(await api().refresh());
  await putHistory();
  kindPages[click.kind].keep(results, []);
  const failed = [...results.filter(keptBack).map(entry => entry.message), ...(unswitched ? [switchProblems(unswitched)].filter(Boolean) : [])];
  const what = click.items.length === 1 ? click.items[0] : andList(click.items);
  const lead = failed.length ? `Not all of ${what} could be put back.` : `Undone: ${what} ${click.items.length === 1 ? 'is' : 'are'} as before.`;
  tell({ page: state.page, items: click.items, warn: !!stopped || failed.length > 0, band: true, fade: !stopped && !failed.length,
    text: stopped ? `Not all of it could be undone: ${stopped}` : [lead, ...failed].join(' ') });
  for (const item of click.items) flashRow(item);
});

/** What a run of plugin switches couldn't do, in words ("issue-tracker: couldn’t turn it on in Codex."), or ''. */
const switchProblems = (ran: Awaited<ReturnType<typeof runSwitches>>) => [ran.stopped, ...ran.failed.map(line => `${line.plugin}: ${line.text.replace(/\.$/, '')}.`)].filter(Boolean).join(' ');

/**
 * Runs plugin switch choices (pluginswitch.ts) with each tool's own switch. What ran leaves `draft`. A plugin that failed to
 * come on leaves no item switched off for it: those written before it are put back. Returns what ran, in lines, the tools where
 * something didn't, and the choices that turn it all back.
 */
async function runSwitches(ops: PluginOp[], draft: Map<string, PluginOp>, undo = false) {
  const home = state.home!.home;
  const plan = { install: api().installPlugin, uninstall: api().uninstallPlugin, setSkill: api().setPluginSkill, setPart: api().setPluginPart, setWhole: api().setPluginOn };
  const result = await runPlan(ops, plan, home);
  for (const entry of result.done) clearPluginOp(draft, entry);
  const strays = strayHolds(result.done);
  const putBack = strays.length ? (await runPlan(reverse(strays), plan, home)).done : [];
  const restored = strays.filter(stray => putBack.some(back => back.tool === stray.tool && back.plugin === stray.plugin && back.skill === stray.skill && back.part?.kind === stray.part?.kind && back.part?.name === stray.part?.name && succeeded(back.report)));
  const done = result.done.filter(entry => !restored.includes(entry));
  const lines = resultLines(done, undo);
  const ran = (op: PluginOp) => done.some(entry => entry.tool === op.tool && entry.plugin === op.plugin && succeeded(entry.report));
  const failedIn = [...new Set([...done.filter(entry => !succeeded(entry.report)).map(entry => entry.tool), ...ops.filter(op => !ran(op)).map(op => op.tool)])];
  return { done, lines, failed: lines.filter(line => !line.ok), failedIn, back: undo ? [] : reverse(done), stopped: result.stopped };
}

/** A plugin switch click's words: `said` when everything ran (else what ran and what didn't), and `undone` its Undo's. Said
 * after it, what the click left as it is: `also` as a warning (a switch that can't be written), `note` plainly (a tool with no
 * switch for one item). `next`: a second button beside the Undo. */
interface SwitchWords { said?: string; undone?: string; also?: string; note?: string; next?: Outcome['next'] }

/**
 * Turns plugins' items on or off from the Skills, MCP servers and Agents pages (pluginswitch.ts), with each tool's own
 * switch, then reads the home again: a click with nothing of the person's own to change (a tool's switch for a plugin's item,
 * a plugin row's switch). What ran leaves `draft`. The result offers Undo, which runs what this run changed, reversed.
 */
export const applyPluginSwitches = (ops: PluginOp[], draft: Map<string, PluginOp>, words: SwitchWords = {}) => switchPlugins(ops, draft, words, false);

const switchPlugins = (ops: PluginOp[], draft: Map<string, PluginOp>, { said, undone, also, note, next }: SwitchWords, undo: boolean) => busy(undo ? 'Undoing…' : 'Applying…', async () => {
  const ran = await runSwitches(ops, draft, undo);
  setHome(await api().refresh());
  const worked = !ran.failed.length && !ran.stopped;
  const text = [worked && said ? said : ran.stopped ?? resultSentence(ran.lines, undo), worked ? '' : switchProblems({ ...ran, stopped: undefined }), also, note].filter(Boolean).join(' ') || 'Nothing changed.';
  const act = ran.back.length ? { label: 'Undo', id: 'outcome-undo-plugin', title: 'Turn them back as they were', run: () => void switchPlugins(ran.back, new Map(), { said: undone }, true) } : undefined;
  tell({ page: state.page, text, warn: !worked || !!also, band: true, fade: undo && worked, act, next: worked ? next : undefined });
});

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

/** A home just opened, as its band says it: an empty one (no tools, or nothing in them) says only that it opened; the page says the rest. */
const openedText = (view: HomeView) => (!view.skills.items.length && !view.mcp.items.length && !view.agents.items.length ? `Opened ${view.label}.` : `Opened ${view.label}. ${readFound(view)}`);

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
  await busy(noToolManaged() ? 'Reading…' : `Reading ${heldKindNames()}…`, async () => {
    const view = await api().refresh();
    if (!view) return;
    state.skillsResult = undefined;
    // Said first, so a page that leaves (setHome) adds its reason after what was read.
    announce(readSummary(view));
    setHome(view, { reload: false });
    read = true;
  });
  // Only a new read goes on to the page's own data: after a failure its message stays, and the page keeps what it showed.
  if (read) await loadPageData(state.page, { fresh: true, readId: state.home?.readId });
}

/** Why the open home can't be written now, if so: preview only, or another Central Knot build owns its sync. */
export const whyReadOnly = (home: HomeView) => (!home.sync.access.allowed ? home.sync.access.reason : home.sync.gate.state === 'stopped' ? home.sync.gate.reason : undefined);

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

/**
 * Lets go of what the last action showed (its result, Apply results, the spoken line): for moving to another place.
 * A home switch's result survives one move, since switching is often followed by a click elsewhere; `page` is where it lands.
 */
export function leaveResults(page = state.page) {
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

/** A History entry's action: Undo, Restore, or one of its choices; what it did is said in the band, with its own way back. */
export const restoreEvent = (eventId: string, choice?: string) => busy('Restoring…', async () => {
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
  const restored = result.results.filter(entry => entry.outcome === 'written');
  const where = [...new Set(restored.map(entry => entry.harness ?? ''))].filter(Boolean);
  const past = state.history.data?.find(event => event.id === eventId);
  // An Undo of a profile switch lists what it couldn't change in its own band, so the page's problems band gets only a stop.
  // Synchronize everything's covers every kind: its band says what it couldn't do (sayEverything), no page's problems band.
  if ((past?.kind !== 'profile' && past?.kind !== 'everything') || result.stopped) kindPages[(past && libraryEntry(past)?.kind) || 'agents'].keep(result.results, result.notices);
  if (past?.kind === 'profile') {
    // Each item it turned back has its own History entry, with its own action: the band offers no Undo of the Undo.
    if (result.stopped || !result.switched) tell(undefined, result.stopped); else turnedOutcome('Undone', result.switched, result.results);
    return;
  }
  const everywhere = touchedToolsPhrase(where);
  // A Pull's edit or deletion of the base instructions: its Undo has no event of its own to offer again.
  if (past?.base) {
    tell(result.stopped ? undefined : { page: state.page, item: past.item, text: result.results.map(entry => entry.message).join(' ') }, result.stopped);
    return;
  }
  if (past && libraryEntry(past)) { sayLibraryAction(past, result); return; }
  if (past?.kind === 'everything') { sayEverything(past, result, switchesOn); return; }
  // A Pull's change to an agent's Claude Code settings alone (gitrepo.ts undoSettingsChange): the one entry with an Undo of its own.
  const item = restored[0]?.item ?? past?.item ?? '';
  const done = !result.stopped && restored.length > 0;
  tell(done ? { page: state.page, item, history: true, text: `Undid the change to ${item}. The earlier version is back in ${everywhere}.` } : undefined, result.stopped ?? `Restored in ${plural(0, 'tool')}.`);
  if (done) flashRow(item);
});

/**
 * After a History action on a library item, a skill, an MCP server or an agent (historyactions.ts): what it did, in the words of the entry
 * it made, with that entry's own action as the way back. A refusal is said on the page, where the action was clicked.
 */
function sayLibraryAction(past: HistoryEvent, result: ApplyResult) {
  if (result.stopped) { tell({ page: state.page, item: past.item, text: result.stopped, warn: true, history: true }); return; }
  const entry = libraryEntry(past)!, view = state.home?.[entry.kind];
  const made = state.history.data?.find(event => event.id === past.undoneBy);
  const item = view?.library[entry.key];
  const said = made && librarySentence(made, libraryWords[entry.kind], view?.tools ?? [], item, true)?.text;
  const back = made && libraryAction(made, item, entriesNow(state.home!)(made).now);
  const notDone = result.results.filter(keptBack).map(entry => entry.message);
  const text = [`${past.item}: ${said ? said.replace(/^./, first => first.toLowerCase()) : 'done.'}`, ...notDone].join(' ');
  tell({ page: state.page, item: past.item, warn: notDone.length > 0, text, undo: back && made ? { id: made.id, label: back.label } : undefined });
  flashRow(past.item);
}

/**
 * After Synchronize everything's one Undo, or that Undo's Restore (everything.ts everythingEntryAction): what it did, in the Undo's
 * entry's words, or what the Restore put back; what it could not do after it, each sentence once. Which it was is the entry clicked:
 * an Undo's entry (`undo`) offers the Restore, a switch-on the Undo. `switchedOn`: the Restore switched the rule on again
 * (restoreEvent, from restorePlan before the click); a switch made in Settings since is not its doing.
 */
function sayEverything(past: HistoryEvent, result: ApplyResult, switchedOn: boolean) {
  if (result.stopped) { tell({ page: state.page, item: past.item, text: result.stopped, warn: true, history: true }); return; }
  const made = (result.made ?? []).map(id => state.history.data?.find(event => event.id === id));
  const text = everythingDone(past, made, made.filter(event => event?.kind === 'restored').length, switchedOn);
  const notDone = [...new Set(result.results.filter(keptBack).map(entry => entry.message))];
  tell({ page: state.page, item: past.item, warn: notDone.length > 0, history: true, text: [text, ...notDone.slice(0, 3)].join(' ') });
}

// ---------- A skill's own two actions ----------

/**
 * A skill's two actions a click on its row can't carry (skills.ts clearSwitch, takeOver): a tool's own switch cleared, or a copy
 * outside Central Knot's taken over. What it did is said in the band, with no Undo there: Take over has none (the band and its
 * History entry say so); a cleared switch's Undo is its History entry's action (skills.ts switchBack).
 */
export const skillAction = (action: 'clear-switch' | 'take-over', key: string, tool: HarnessId, name: string) =>
  busy(action === 'take-over' ? 'Taking it over…' : 'Clearing the switch…', async () => {
    const home = state.home!;
    const result = await (action === 'take-over' ? api().takeOverSkill(key, tool, clickResumes(home), home.home) : api().clearSkillSwitch(key, tool, clickResumes(home), home.home));
    setHome(await api().refresh());
    kindPages.skills.keep(result.results, result.notices);
    if (result.stopped) { tell({ page: state.page, item: name, text: result.stopped, warn: true, band: true }); return; }
    // Letting a tool load it again has an Undo (its History entry's: the switch set again); a take-over has none, and says so.
    const said = `${name}: ${result.results[0]?.message ?? 'done.'}${action === 'take-over' ? ' This has no Undo.' : ''}`;
    const entry = action === 'clear-switch' ? result.made?.[0] : undefined;
    tell({ page: state.page, item: name, band: true, text: said,
      act: entry ? { label: 'Undo', id: 'outcome-undo', title: `Turn ${name} off again in ${toolName(tool)}’s own settings`, run: () => void restoreEvent(entry) } : undefined });
    flashRow(name);
  });

// ---------- Convert to skill ----------

/** Converts an agent to a Pi skill, then takes that skill into Central Knot, On in Pi only: never the agent's own tool by itself. */
export const convertAgent = (key: string, name: string) => busy('Converting…', async () => {
  const home = state.home!;
  const made = await api().convertAgent(key, clickResumes(home), home.home);
  if (made.stopped || !made.skill) { announce(made.stopped ?? 'Nothing was converted.'); return; }
  const others = home.sync.managed.filter(tool => tool !== 'pi-cli');
  const applied = await api().applySkills([{ key: made.skill, on: true, except: others }], clickResumes(home), home.home);
  const view = await api().refresh();
  setHome(view);
  const from = toolName(made.origin ?? 'claude-cli');
  tell({ page: state.page, item: name, text: applied.stopped ? `Converted ${name} to a Pi skill, but it could not be taken into Central Knot: ${applied.stopped}` : `Converted ${name} to a skill for Pi. ${from} keeps the agent.` });
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
  /** Shown as a band even with nothing to offer: a click's result, which belongs where the click's Undo would be. */
  band?: boolean;
  /** The band goes after a few seconds: an Undo's confirmation. */
  fade?: boolean;
  undo?: { id: string; label: string };
  act?: { label: string; id: string; run: () => void; title?: string };
  /** A second button after `act`: the next step the result offers ("Turn document-tools off in Claude Code"). */
  next?: { label: string; id: string; run: () => void; title?: string };
  /** Plain information, nothing done and nothing wrong: the information mark, not a tick. */
  info?: boolean;
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

/** This home only shows its files: saving is off (a preview-only home or another build syncing). */
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

/** Opens the base in its editor; a clean tool editor closes, since only one thing is edited at a time. */
export function startBaseEdit(draft: Omit<BaseEdit, 'hash' | 'stage'> & { stage?: BaseEdit['stage'] }) {
  if (askAboutOpenDraft()) return;
  if (state.outcome?.kind !== 'saved') state.outcome = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  state.draftPick = undefined;
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

/** Opens the question of which tool writes the draft; an editor holding typed work is asked about first. */
export function openDraftPick() {
  if (askAboutOpenDraft()) return;
  if (state.outcome?.kind !== 'saved') state.outcome = undefined;
  if (!draftUnsaved()) state.instructionEdit = undefined;
  state.baseEdit = undefined;
  state.draftPick = {};
  rerender();
  document.getElementById(`base-draft-by-${state.base?.drafters[0]}`)?.focus();
  document.getElementById('base-card')?.scrollIntoView({ block: 'nearest' });
}
export function closeDraftPick() {
  state.draftPick = undefined;
  rerender();
  document.getElementById('base-draft')?.focus();
}

/**
 * Has `tool` write a draft of the base from every tool's instructions, then opens it as a review: saving it there sets the
 * base and updates each file in one step. Nothing is written before that. A failure is said where the tools are chosen, in
 * the tool's own words, so another tool can be tried.
 */
export const draftBaseWith = (tool: HarnessId) => {
  state.drafting = tool;
  state.draftPick = {};
  return busy(`${namedTools[tool]} is writing a draft of the base instructions…`, async () => {
    try {
      const result = await api().draftBase(tool, state.home!.home);
      await rereadInstructions();
      // A failure is read where it is said, so no tool's button looks chosen; after Stop, focus is back on the tool that was stopped.
      const none = (why: string, problem = true) => { if (problem) state.draftPick = { problem: why }; focusAfterBusy = problem ? 'base-draft-problem' : `base-draft-by-${tool}`; announce(why); };
      const draft = result.draft;
      if (!draft) { none(result.cancelled ? 'Stopped. No draft was written, and nothing was changed.' : result.stopped ?? 'No draft was written.', !result.cancelled); return; }
      // Written from the files as they were when it started: saving it over one that changed since would lose what is new there.
      const files = state.instructions.data ?? [];
      const changed = files.filter(file => draft.read[file.tool] !== undefined && draft.read[file.tool] !== file.hash).map(file => file.tool);
      const base = state.base;
      if (changed.length || draft.baseHash !== (base?.hash ?? '')) {
        none(`${changed.length ? `${fileNames(changed)} changed` : 'The base instructions changed'} while the draft was being written, so the draft was dropped. Nothing was changed. Have it written again.`);
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

export const syncNow = () => busy('Syncing…', async () => {
  const view = await api().syncNow(state.home!.home);
  setHome(view);
  announce('Synced once. Automatic sync stays off.', true);
});

/**
 * Another build syncs this home: who, whether it is open now (where that can be told), what that means here, and that
 * taking over loses nothing. Said the same on every page.
 */
export const otherOwnerSaid = (owner: { name: string; running?: boolean }) =>
  `${owner.name} ${ownerSyncs(owner)}, so ${owner.running === false ? 'nothing is syncing here now' : 'skills, MCP servers and agents aren’t changed from here'}. Taking over keeps every managed item and choice.`;
/** What the build that syncs this home is doing, as far as can be told: whether it is open decides which. */
export const ownerSyncs = (owner: { running?: boolean }) => (owner.running === false ? 'synced this home last and isn’t open' : owner.running ? 'is open and syncs this home' : 'syncs this home');
/** What Take over syncing does, for its button's tooltip. */
export const takeOverTitle = (owner: { name: string }) => `Central Knot syncs this home from now on, from where ${owner.name} left it, and anything waiting is synced straight away. ${owner.name} stops syncing here until you take over from it again.`;

/** Take over syncing: Central Knot syncs the home from now on, in place of the build that did; nothing is reset. */
export const takeOverSync = () => busy('Taking over syncing…', async () => {
  const taken = await api().takeOverSync(state.home!.home);
  if (taken.view) setHome(taken.view);
  // Short enough for the status bar to keep its first sentence whole; the second says the way back.
  announce(taken.stopped ? `Syncing was not taken over. ${taken.stopped}` : taken.from ? `Central Knot now syncs this home${taken.view?.syncOn === false ? ' (automatic sync is off here)' : ''}. To go back, take over in ${taken.from}.` : 'Central Knot already syncs this home.');
});

/** A background read is running, or one arrived while the page was busy and runs when it is done (busy). */
let refreshing = false;
let refreshOwed = false;
/** A background view that arrived while an action ran: its notices and caught-up results go into the next one (withSetAside). */
let setAside: HomeView | undefined;
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
api().onSyncChanged(() => { loadRepoSoon(); void backgroundRefresh(); });
api().onSaid(text => announce(text));

/** Each page's sync notices in a view: what changed on its own, with its History event. */
const noticesByPage = (view: HomeView): [Page, SyncNotice[]][] => [['skills', view.skills.notices], ['mcp', view.mcp.notices], ['agents', view.agents.notices]];

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
      if (outcome?.act) state.undoMoved = { page: outcome.page, label: outcome.act.label, items: outcome.items ?? (outcome.item ? [outcome.item] : []), notices: noticesByPage(view).flatMap(([, notices]) => notices.map(notice => notice.history)) };
      state.outcome = undefined;
      const items = [...new Set(fresh.flatMap(([, notices]) => notices.flatMap(noticeNames)))];
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

/**
 * Write to Claude Code, once the person has quit Claude Code: what the servers named owe Claude Code's settings file
 * (servers.ts writeToClaude). Its way back is the library's: Make current an earlier version, then Write again.
 */
export const writeClaudeNow = (keys: string[]) => busy('Writing to Claude Code…', async () => {
  const result = await api().writeClaude(keys, state.home!.home);
  setHome(await api().refresh());
  state.mcpResult = result;
  const names = [...new Set(result.results.filter(entry => entry.harness === 'claude-cli' && (entry.outcome === 'written' || entry.outcome === 'removed')).map(entry => entry.item))];
  const text = !names.length ? 'Nothing was written to Claude Code.' : state.home?.mode === 'fixture' ? `${andList(names)} written to the practice copy of Claude Code’s settings.`
    : `${andList(names)} written to Claude Code. Start Claude Code again to use ${names.length === 1 ? 'it' : 'them'}.`;
  tell(result.stopped ? undefined : { page: state.page, items: names, text }, result.stopped);
});

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

/**
 * What a switch or its Undo did, as its band says it: what it turned On and Off, the MCP servers whose Claude Code part waits
 * for Write to Claude Code (offered as the band's second button: never said done), and what could not change.
 */
function turnedOutcome(lead: string, turned: Pick<ProfileSwitchResult, 'on' | 'off' | 'left' | 'waits'>, results: DestinationResult[], act?: Outcome['act']) {
  const waits = turned.waits.length;
  const waitSaid = waits ? ` ${plural(waits, 'MCP server')} ${waits === 1 ? 'waits' : 'wait'} for Write to Claude Code.` : '';
  const leftSaid = turned.left.length ? ` ${andList(turned.left)} ${turned.left.length === 1 ? 'is' : 'are'} not as it asked: History says why.` : '';
  const notDone = results.length ? ` ${results.slice(0, 2).map(entry => entry.message).join(' ')}${results.length > 2 ? ' …' : ''}` : '';
  tell({ page: state.page, text: `${lead}: ${turnsWords(turned, 'did') || 'nothing changed'}.${waitSaid}${leftSaid}${notDone}`, warn: results.length > 0 || turned.left.length > 0, act,
    next: waits ? { label: 'Write to Claude Code', id: 'outcome-write-claude', title: 'Quit Claude Code first: it rewrites its settings file while open', run: () => void writeClaudeNow(turned.waits) } : undefined });
}

/** What a switch did, with Undo switch (from the page or, next time the window shows, the menu bar). */
const switchOutcome = (result: ProfileSwitchResult) => turnedOutcome(`Switched to ${result.name}`, result, result.results,
  result.event ? { label: 'Undo switch', id: 'outcome-undo', title: 'Turn back each item this switch changed, where it is still as the switch left it', run: () => void restoreEvent(result.event!) } : undefined);

/** Switches to a profile. The band says what changed, with Undo; the menu bar follows. */
export const switchToProfile = (id: string) => busy('Switching profile…', async () => {
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
  tell({ page: 'profiles', item: gone.name, text: `Deleted the profile ${gone.name}. No item changed.`,
    act: { label: 'Undo', id: 'outcome-undo-delete-profile', title: `Make ${gone.name} again, with the same items`, run: () => void saveProfileDef({ ...gone, restore: true }, `${gone.name} is back.`) } });
});
