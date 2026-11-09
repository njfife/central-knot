import { loadSettings } from './settingspage.ts';
import type { ApplyResult, BaseApply, BaseResult, BaseUndo, BaseView, Change, DesktopApi, DestinationResult, HarnessId, InstructionFile, HistoryEvent, HomeMode, HomeView, McpResult, ClaudeWrite } from './types.ts';
import { withOwn } from './basetext.ts';
import { plural } from './model.ts';
import { andList, fileName, toolName, toolNames as namedTools } from './words.ts';
import { loadPlugins, resetMarket } from './pluginstate.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

export type Page = 'overview' | 'skills' | 'mcp' | 'agents' | 'instructions' | 'plugins' | 'history' | 'tools' | 'settings';

export interface BaseEdit {
  text: string; hash: string; tools: HarnessId[]; stage: 'edit' | 'review';
  /** Where the draft came from: a tool's own instructions (they move into the base), a tool's edited copy (to use as the base),
   *  the base going back into one tool whose copy was edited, the base written again where it is missing or older, or an earlier version. */
  source?: { kind: 'own' | 'copy' | 'putBack' | 'update' | 'version'; tool?: HarnessId };
  confirmDiscard?: boolean; fullDiff?: boolean;
  /** Why the review is shown again: the base or a file changed since it was last shown. */
  conflict?: string;
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
  /** What sync did on its own, newest last, read when the History page opens. */
  history: undefined as HistoryEvent[] | undefined,
  /** What the last Apply all did, shown until the next action or read. */
  applied: undefined as ApplyResult | undefined,
  /** The Skills page: the table, or one skill's files and contents beside the list. */
  skillsView: 'table' as 'table' | 'files',
  /** What the last action did, shown as a band on the page it happened on until the next action or page. */
  outcome: undefined as { page: Page; text: string; note?: string; item?: string; items?: string[]; carry?: boolean; history?: boolean; undo?: { id: string; label: string }; act?: { label: string; id: string; run: () => void; title?: string } } | undefined,
  /** Each tool's instruction file, read when the Instructions page opens. */
  instructions: undefined as InstructionFile[] | undefined,
  /** The one file being edited: its text so far, the hash it was opened at, and whether the diff is showing. */
  instructionEdit: undefined as { tool: HarnessId; text: string; hash: string; stage: 'edit' | 'review'; restoring?: boolean; confirmDiscard?: boolean; conflict?: boolean; fullDiff?: boolean } | undefined,
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

export function announce(text: string, quiet = false) {
  const region = document.getElementById('announcement')!;
  region.textContent = text;
  // A quiet announcement is for screen readers only: the page already shows the same thing.
  region.dataset.quiet = quiet ? 'true' : '';
}

const focusById = (id?: string | null) => (id ? document.getElementById(id) : null)?.focus();


/** Where focus goes when the running work ends, when its result replaced the control that started it (a review opening). */
let focusAfterBusy: string | undefined;

/** One piece of work at a time: every mutating control is disabled while it runs. */
export async function busy(message: string, work: () => Promise<void>) {
  const focused = document.activeElement?.id;
  state.outcome = undefined;
  state.undoMoved = undefined;
  state.busy = message;
  document.body.dataset.busy = 'true';
  announce(message);
  rerender();
  try { await work(); }
  catch {
    announce(state.home ? `That could not finish. Still on ${state.home.label}. Click Refresh to see where things stand.` : 'Could not read this home. Nothing changed. Try again.');
  }
  state.busy = undefined;
  document.body.dataset.busy = 'false';
  rerender();
  focusById(document.getElementById(focusAfterBusy ?? '') ? focusAfterBusy : focused);
  focusAfterBusy = undefined;
}

function accept(view: HomeView) {
  state.home = view;
  state.applied = undefined;
  state.item = undefined;
  state.instructionEdit = undefined;
  state.baseEdit = undefined;
  resetMarket();
  if (state.page === 'plugins') void loadPlugins();
}

/** Sends the Overview's pending changes, then reads the home again so the page shows what is on disk. */
/** A row to flash on its next draw (set by Undo and Restore; the matrix reads it). */
export const flashRequests = new Set<string>();
const flashRow = (item: string) => { if (item) flashRequests.add(item.toLowerCase()); };

const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* said again next time */ } };

/** After the first Apply all on a page, its tip has done its job. */
const retireTip = (kind: 'skills' | 'mcp' | 'agents') => { try { localStorage.setItem(`ck-help-dismissed-${kind}`, '1'); } catch { /* shows again */ } };

export const applyManage = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const home = state.home!;
  const result = await api().apply(changes, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.applied = result;
  if (!result.stopped) { onDone(); retireTip('skills'); }
  const managed = changes.filter(change => change.managed).length;
  // History holds what Apply all replaced (a chosen copy); new copies are undone by turning Managed off, which leaves them in place.
  const replacedSome = result.results.some(entry => entry.outcome === 'written' && /^Now uses/.test(entry.message));
  // Say what was added and what was replaced, apart: only a replacement is kept in History.
  const order = Object.values(namedTools);
  const writtenTo = (replaced: boolean) => [...new Set(result.results.filter(entry => entry.outcome === 'written' && /^Now uses/.test(entry.message) === replaced).map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const added = writtenTo(false), replacedIn = writtenTo(true);
  const single = managed === 1 ? changes.find(change => change.managed)?.key : undefined;
  const singleName = single ? state.home?.manage.skills.find(skill => skill.key === single)?.name ?? single : undefined;
  // The result matches the bar before it: how many new copies, and of which skills.
  const newCopies = result.results.filter(entry => entry.outcome === 'written' && !/^Now uses/.test(entry.message));
  const newItems = [...new Set(newCopies.map(entry => entry.item))];
  const what = [managed ? (singleName ? `${singleName} managed` : `${plural(managed, 'skill')} managed`) : '', newCopies.length ? `${plural(newCopies.length, 'new copy', 'new copies')} written${!singleName && newItems.length <= 3 ? ` (${newItems.join(', ')})` : ` to ${andList(added)}`}` : '', replacedIn.length ? `replaced ${andList(replacedIn.map(name => `${name}’s copy`))} (kept in History)` : '', !added.length && !replacedIn.length ? 'nothing needed copying' : ''].filter(Boolean).join(' · ');
  // New copies are in History as 'added': one Undo here removes them again (while unchanged) and unmanages those skills.
  // Only when nothing was replaced: undoing a replacement is its own History entry, and a half-undone choice would mislead.
  const recent = result.stopped ? [] : (await api().history()).filter(event => !event.undoneBy && changes.some(change => change.key === event.key) && Date.now() - Date.parse(event.at) < 5 * 60_000);
  const addedNow = replacedSome ? [] : recent.filter(event => event.kind === 'added');
  // A copy choice gets its own inline Undo: each replaced copy back in its own tool, new copies removed, the skill unmanaged.
  const chosenNow = replacedSome ? recent.filter(event => event.kind === 'chosen') : [];
  const firstApply = !readFlag('ck-applied-once');
  writeFlag('ck-applied-once');
  if (!result.stopped) state.outcome = { page: state.page, history: replacedSome && !chosenNow.length, text: `${what}.` + (managed && firstApply ? ' Edits now spread between tools.' : ''), item: singleName, items: newItems,
    act: addedNow.length ? addedUndo(addedNow) : chosenNow.length ? choiceUndo(chosenNow) : undefined };
  const failed = result.results.filter(entry => entry.outcome === 'failed').length;
  const written = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
  announce(result.stopped ?? [result.harnessWrites ? `${plural(result.harnessWrites, 'copy', 'copies')} written${written.length <= 3 ? `: ${written.join(', ')}` : ''}.` : 'Applied. Nothing needed copying.', failed ? `${failed} failed.` : ''].filter(Boolean).join(' '));
});

/** After a read: what was found and where, so a home switch or Refresh says what it did. */
const readSummary = (view: HomeView) => {
  const skills = view.manage.skills.length, servers = view.mcp.servers.length, agents = view.agents?.servers.length ?? 0;
  // "Nothing changed" means nothing was written; a copy that stopped updating is still news, so it is said.
  const stopped = (view.agents?.servers ?? []).filter(server => server.managed && server.stopped?.length).map(server => `${server.name}’s ${server.stopped!.length === 1 ? 'copy in one tool' : 'copies in some tools'}`);
  return `Read ${plural(skills, 'skill')}, ${plural(servers, 'MCP server')} and ${plural(agents, 'agent')} from ${view.label}. ${stopped.length ? '' : 'Nothing changed.'}`;
};

export const loadHome = (mode: HomeMode) => (state.lastMode = mode, busy(`Reading ${mode === 'fixture' ? 'the practice copy' : mode === 'actual' ? 'your real tools' : 'that folder'}…`, async () => {
  const previous = state.home;
  const view = await api().selectHome(mode);
  const nothing = view && !view.manage.skills.length && !view.mcp.servers.length && !view.agents.servers.length;
  // Sync follows the open home: leaving one with managed items stops its syncing, so the band says so and offers the way back.
  const left = previous && view && previous.home !== view.home && [...previous.manage.skills, ...previous.mcp.servers, ...previous.agents.servers].some(fact => fact.managed) ? previous : undefined;
  const leftText = left ? ` ${left.label} is not syncing while another home is open.` : '';
  if (view) { accept(view); state.outcome = { page: state.page, carry: true, text: (nothing ? `Opened ${view.label}.` : `Opened ${view.label}. ${readSummary(view).replace(` from ${view.label}`, '')}`) + leftText,
    act: left && left.mode !== 'custom' ? { label: `Go back to ${left.label}`, id: 'outcome-go-back', run: () => void loadHome(left.mode) } : undefined }; announce(readSummary(view) + leftText, true); } else announce('');
}));

/** At launch: the home last opened (so sync resumes where it was), else this computer's home (dev builds: the practice copy). */
export const startHome = () => busy('Reading skills, MCP servers and agents…', async () => {
  const view = await api().startHome();
  // The first read is said the same way as a home switch: a band, not a passing status line.
  const practiceNote = view?.mode === 'fixture' && (() => { try { return localStorage.getItem('ck-practice-banner-dismissed') !== '1'; } catch { return true; } })();
  if (view) { accept(view); if (!practiceNote) state.outcome = { page: state.page, carry: true, text: `Opened ${view.label}. ${readSummary(view).replace(` from ${view.label}`, '')}` }; announce(readSummary(view), true); } else announce('');
});

export const readAgain = () => busy('Reading skills, MCP servers and agents…', async () => {
  const view = await api().refresh();
  if (!view) return;
  state.home = view;
  state.applied = undefined;
  // Instruction files may have changed outside too; an open draft stays as it is.
  if (state.page === 'instructions') await readInstructions();
  announce(readSummary(view));
});

/** How many tools this home really has: a tool that was not found (Pi, often) never makes "all tools" false. */
export const presentCount = () => state.home ? state.home.snapshots.filter(snapshot => snapshot.detection !== 'Not found' || snapshot.skills.length > 0).length || 3 : 3;

export function showPage(page: Page) {
  if (page === 'plugins' && state.page !== 'plugins') void loadPlugins();
  // A new page starts clean: the last action's message and results belong to the page they happened on.
  // A home-switch result survives one page change, since switching is often followed by a click elsewhere.
  const carried = state.outcome?.carry ? { ...state.outcome, page, carry: false } : undefined;
  if (page !== state.page) { announce(''); state.outcome = carried; state.applied = undefined; state.mcpResult = undefined; state.agentsResult = undefined; state.skillsView = 'table'; }
  if (page === 'history') void loadHistory();
  if (page === 'settings') void loadSettings();
  // An unsaved draft survives a page switch: the save is still checked against the file it was opened from. An editor with
  // nothing typed closes, so coming back shows the page from the top.
  if (state.page === 'instructions' && page !== 'instructions') {
    const tool = state.instructionEdit, file = tool && state.instructions?.find(entry => entry.tool === tool.tool);
    if (tool && file && (tool.restoring || tool.text === ownText(file))) state.instructionEdit = undefined;
    if (state.baseEdit && state.baseEdit.source?.kind !== 'own' && !baseDraftChanged(state.baseEdit)) state.baseEdit = undefined;
  }
  if (page === 'instructions') void loadInstructions();
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
/** Reveals a file in the system file manager; nothing is opened or changed. */
export const showFile = (path: string) => void api().showFile?.(path);

export const shownPath = (path: string) => {
  const home = state.home;
  if (!home || home.mode === 'custom' || (path !== home.home && !path.startsWith(`${home.home}/`))) return path;
  return `${home.mode === 'actual' ? '~' : '…'}${path.slice(home.home.length)}`;
};

// ---------- History ----------

export const loadHistory = () => busy('Reading History…', async () => {
  state.history = await api().history();
  announce('');
});

/** Undo or Restore from History: a new revision that spreads to every tool the skill syncs to. */
export const restoreEvent = (eventId: string, choice?: string) => busy('Restoring…', async () => {
  const home = state.home!;
  const result = await api().restore(eventId, home.manage.gate.state === 'needs-resume', home.home, choice);
  // The notice for an undone event has done its job; its result band says what happened.
  if (!result.stopped) state.dismissed.add(eventId);
  const view = await api().refresh();
  if (view) state.home = view;
  state.history = await api().history();
  state.applied = result;
  const restored = result.results.filter(entry => entry.outcome === 'written');
  const where = [...new Set(restored.map(entry => toolName(entry.harness ?? '') ?? entry.harness ?? ''))].filter(Boolean);
  // The new History event is the one that undid this; offering it inline makes the undo itself undoable here.
  const past = state.history?.find(event => event.id === eventId);
  const undoneBy = past?.undoneBy;
  const everywhere = where.length >= presentCount() ? `all ${where.length} tools` : andList(where);
  const item = restored[0]?.item ?? past?.item ?? '';
  const removedFrom = [...new Set(result.results.filter(entry => entry.outcome === 'removed').map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean);
  if (past?.kind === 'added') {
    const stayed = result.results.filter(entry => entry.outcome === 'held');
    if (!result.stopped) { state.outcome = { page: state.page, item: past.item, text: `Removed the new copies of ${past.item}${removedFrom.length ? ` from ${andList(removedFrom)}` : ''}.${stayed.length ? ` ${stayed.map(entry => entry.message).join(' ')}` : ` ${past.item} is unmanaged again.`}` }; flashRow(past.item); }
    announce(result.stopped ?? state.outcome?.text ?? '', !result.stopped);
    return;
  }
  const text = past?.kind === 'deleted' ? `${item} is back in ${everywhere}.`
    : past?.kind === 'restored' ? `Redone: ${item} is as it was before the undo, in ${everywhere}.`
      : `Undid ${past?.winner ? `${toolName(past.winner.tool) ?? past.winner.tool}’s ${past.kind === 'chosen' ? 'chosen copy' : 'edit'}` : 'the change'} to ${item}. The earlier version is back in ${everywhere}.`;
  const label = past?.kind === 'deleted' ? 'Delete again in all tools' : past?.kind === 'restored' ? 'Undo again' : `Redo edit ${where.length >= presentCount() ? 'in all tools' : `in ${andList(where)}`}`;
  if (!result.stopped && restored.length) state.outcome = { page: state.page, item, history: !undoneBy, undo: undoneBy ? { id: undoneBy, label } : undefined, text };
  // Screen readers hear the same sentence the band shows; the restored row flashes like a synced one.
  if (!result.stopped && restored.length) flashRow(item);
  announce(result.stopped ?? (restored.length ? text : `Restored in ${plural(restored.length, 'tool')}.`), !result.stopped && !!restored.length);
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
  if (view) state.home = view;
  const from = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' }[made.origin ?? 'claude-cli'];
  state.outcome = { page: state.page, item: name, text: applied.stopped ? `Converted ${name} to a Pi skill, but it could not be managed: ${applied.stopped}` : `Converted ${name} to a skill for Pi. ${from} keeps the agent. It syncs to Pi only; turn on other tools for it on the Skills page.` };
  announce(state.outcome.text, true);
});

// ---------- Instructions ----------

const readInstructions = async () => {
  const [files, base] = await Promise.all([api().instructions(), api().instructionBase()]);
  state.instructions = files ?? undefined;
  state.base = base ?? undefined;
};

export const loadInstructions = () => busy('Reading instruction files…', async () => {
  await readInstructions();
  announce('', true);
});

/** A checked save of one file: it must still hold what was opened; the replaced text is kept as an earlier version. */
export const saveInstructionText = (file: InstructionFile, own: string) => busy('Saving…', async () => {
  // A tool that gets the base is edited for its own text; its base block stays as it is in the file.
  // Restoring an earlier version puts the whole file back as it was, base block included.
  const text = file.base && !state.instructionEdit?.restoring ? withOwn(file.text, own) : own;
  const result = await api().saveInstruction(file.tool, text, state.instructionEdit?.hash ?? file.hash, state.home!.home);
  await readInstructions();
  const name = fileName(file.path);
  if (result.stopped) {
    state.outcome = undefined;
    const now = state.instructions?.find(entry => entry.tool === file.tool);
    // Changed outside: the draft stays, now checked against the file as it is, and the review compares with that.
    if (state.instructionEdit && now && now.hash !== state.instructionEdit.hash) { Object.assign(state.instructionEdit, { hash: now.hash, stage: 'review', conflict: true }); announce(`${name} changed outside Central Knot. Your draft is kept; review it against the current file.`); return; }
    announce(result.stopped); if (state.instructionEdit) state.instructionEdit.stage = 'edit'; return;
  }
  state.instructionEdit = undefined;
  // Undo is one click: the replaced text goes back through the same checked save, which keeps this version in turn.
  const saved = state.instructions?.find(entry => entry.tool === file.tool);
  const before = file.exists && result.saved ? file.text : undefined;
  state.outcome = { page: 'instructions', item: name, text: result.saved ? `${file.exists ? 'Saved' : 'Created'} ${name}. ${file.exists ? '' : 'Central Knot never deletes instruction files; edit it here to change it. '}Start a new ${({ 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' } as Record<string, string>)[file.tool]} session to use the change.` : `${name} already said that; nothing was written.`,
    act: before !== undefined && saved ? { label: 'Undo', id: 'outcome-undo-instruction', run: () => void undoInstruction(saved, before) } : undefined };
  announce(state.outcome.text, true);
});

/** Puts back the text a save replaced: a checked save against what was just written. */
const undoInstruction = (file: InstructionFile, before: string) => busy('Undoing the save…', async () => {
  const result = await api().saveInstruction(file.tool, before, file.hash, state.home!.home);
  await readInstructions();
  const name = fileName(file.path);
  if (result.stopped) { state.outcome = undefined; announce(result.stopped); return; }
  state.outcome = { page: 'instructions', item: name, text: `${name} is back as it was before your save. The text you saved is under Earlier versions.` };
  announce(state.outcome.text, true);
});

/** The base draft holds something the base doesn't: different text or a different choice of tools. */
export const baseDraftChanged = (edit: BaseEdit) => edit.text !== (state.base?.text ?? '') || edit.tools.join() !== (state.base?.tools ?? []).join();

/**
 * Whether the open editor (a tool's or the base's) holds typed changes. If so, it is asked about (Discard / Keep editing) and the
 * caller starts nothing: drafts are read live, since typing doesn't redraw the page. A review that only shows a stored version
 * holds nothing typed, so it gives way.
 */
function askAboutOpenDraft(): boolean {
  const tool = state.instructionEdit, file = tool && state.instructions?.find(entry => entry.tool === tool.tool);
  if (tool && file && !tool.restoring && tool.text !== ownText(file)) {
    Object.assign(tool, { confirmDiscard: true, stage: 'edit' });
    rerender(); document.getElementById(`ins-discard-${tool.tool}`)?.focus(); return true;
  }
  const base = state.baseEdit;
  if (base && (!base.source || base.source.kind === 'own') && baseDraftChanged(base)) {
    base.confirmDiscard = true;
    rerender(); document.getElementById(base.stage === 'review' ? 'base-review-discard-yes' : 'base-discard')?.focus(); return true;
  }
  return false;
}

/** Opens one file in the editor; any earlier result band belongs to the last task, not this one. */
export function startInstructionEdit(file: InstructionFile) {
  if (askAboutOpenDraft()) return;
  // A save on another card keeps its Undo there; any other result belongs to the last task.
  if (!(state.outcome && /^Saved /.test(state.outcome.text) && state.outcome.item !== fileName(file.path))) state.outcome = undefined;
  state.baseEdit = undefined;
  state.instructionEdit = { tool: file.tool, text: ownText(file), hash: file.hash, stage: 'edit' };
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
  state.outcome = undefined;
  state.baseEdit = undefined;
  state.instructionEdit = { tool: file.tool, text, hash: file.hash, stage: 'review', restoring: true };
  announce('Review going back to the earlier version, then save to put it back.', true);
});

// ---------- Base instructions ----------

const fileOf = (tool: HarnessId) => state.instructions?.find(file => file.tool === tool);
const fileNames = (tools: HarnessId[]) => andList(tools.map(tool => { const file = fileOf(tool); return file ? fileName(file.path) : namedTools[tool]; }));
const toolNamesOf = (tools: HarnessId[]) => andList(tools.map(tool => namedTools[tool]));

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
  if (!(state.outcome && /^Saved /.test(state.outcome.text))) state.outcome = undefined;
  state.instructionEdit = undefined;
  state.baseEdit = { stage: 'edit', ...draft, hash: state.base?.hash ?? '' };
  rerender();
  document.getElementById(state.baseEdit.stage === 'edit' ? 'base-text' : 'base-save')?.focus();
  document.getElementById('base-card')?.scrollIntoView({ block: 'nearest' });
}

/**
 * Saves the base and its tools, then updates every chosen file (INS-03, INS-04). `done` says what was asked for, in the result.
 * Undo puts the base, its tools and every file it wrote back as they were.
 */
export const applyBaseChange = (request: Omit<BaseApply, 'expected'>, done: (written: string) => string) => busy('Saving the base instructions…', async () => {
  const result = await api().applyBase({ ...request, expected: state.baseEdit?.hash ?? state.base?.hash ?? '' }, state.home!.home);
  await readInstructions();
  if (result.stopped) {
    state.outcome = undefined;
    announce(result.stopped);
    // Changed since the review: the draft stays, now against the base and files as they are, and the review is shown again.
    if (state.baseEdit && result.changed) {
      Object.assign(state.baseEdit, { hash: state.base?.hash ?? '', stage: 'review', conflict: result.stopped });
      // Putting the base back or updating files writes the base as it is: never an older text the base has since moved on from.
      const kind = state.baseEdit.source?.kind;
      if (state.base && (kind === 'putBack' || kind === 'update')) Object.assign(state.baseEdit, { text: state.base.text, tools: state.base.tools });
    }
    return;
  }
  state.baseEdit = undefined;
  const written = result.written.map(entry => entry.tool);
  const sessions = written.length ? ` Start a new ${written.length === 1 ? `${toolNamesOf(written)} session` : 'session in each'} to use ${written.length === 1 ? 'it' : 'them'}.` : '';
  const created = result.written.filter(entry => entry.before === null).map(entry => entry.tool);
  const undoTitle = `Put the base instructions back as they were${written.length ? `, and ${fileNames(written)} as ${written.length === 1 ? 'it was' : 'they were'}` : ''}${created.length ? ` (${fileNames(created)}, which this save created, goes again)` : ''}`;
  state.outcome = { page: 'instructions', text: `${done(written.length ? fileNames(written) : '')}${leftText(result)}${sessions}`,
    act: result.undo ? { label: 'Undo', id: 'outcome-undo-base', title: undoTitle, run: () => void undoBaseChange(result.undo!) } : undefined };
  announce(state.outcome.text, true);
});

const undoBaseChange = (undo: BaseUndo) => busy('Undoing…', async () => {
  // Said for what this undo puts back: the base only if the save changed it (Put back and Update change files alone).
  const baseMoves = undo.text !== state.base?.text || undo.tools.join() !== state.base?.tools.join();
  const result = await api().undoBase(undo, state.home!.home);
  await readInstructions();
  if (result.stopped) { state.outcome = undefined; announce(result.stopped); return; }
  const back = result.written.map(entry => entry.tool);
  const what = baseMoves ? `The base instructions are back as they were${back.length ? `, and so ${back.length === 1 ? 'is' : 'are'} ${fileNames(back)}` : ''}`
    : `${fileNames(back)} ${back.length === 1 ? 'is' : 'are'} back as ${back.length === 1 ? 'it was' : 'they were'}`;
  const shelves = [...(baseMoves ? ['the Base instructions card'] : []), ...back.map(tool => `${namedTools[tool]}’s card`)];
  state.outcome = { page: 'instructions', text: `${what}.${leftText(result, true)} What the undo replaced is under Earlier versions on ${andList(shelves)}.` };
  announce(state.outcome.text, true);
});

/** Loads an earlier base into the editor, at the review: going back is an ordinary save. */
export const loadBaseVersion = (id: string) => askAboutOpenDraft() ? undefined : busy('Reading the earlier version…', async () => {
  focusAfterBusy = 'base-save';
  const text = await api().instructionVersion('base', id);
  if (text === undefined) { announce('That version is no longer kept.'); return; }
  state.outcome = undefined;
  state.instructionEdit = undefined;
  state.baseEdit = { text, hash: state.base?.hash ?? '', tools: state.base?.tools ?? [], stage: 'review', source: { kind: 'version' } };
  announce('Review going back to the earlier base instructions, then save to put them back.', true);
});

/** The Undo an Apply all result offers: it names what it removes, and the tooltip says what stays. */
function addedUndo(addedNow: HistoryEvent[]) {
  const copies = addedNow.reduce((sum, event) => sum + event.losers.length, 0);
  const items = addedNow.length === 1 ? addedNow[0].item : addedNow.length === 2 ? 'both' : `all ${addedNow.length}`;
  return { label: 'Undo Apply all', id: 'outcome-undo-added', title: `Removes the ${copies === 1 ? 'new copy' : `${copies} new copies`} Apply all added (only while unchanged) and stops managing ${items}. Your original copies stay.`, run: () => void undoAdded(addedNow.map(event => event.id)) };
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
  if (view) state.home = view;
  const items = [...new Set((state.history ?? []).filter(event => ids.includes(event.id)).map(event => event.item))];
  state.outcome = stopped ? undefined : { page: state.page, items, text: 'Undone: each replaced copy is back in its own tool, and the skill is unmanaged again, with its copies differing as before.' };
  announce(stopped ?? state.outcome!.text, true);
});

/** Undo of Apply all's new copies, for every skill it made Managed: each goes back to unmanaged, its new copies removed. */
export const undoAdded = (ids: string[]) => busy('Undoing Apply all…', async () => {
  const home = state.home!;
  const results: DestinationResult[] = [];
  let stopped: string | undefined;
  for (const id of ids) {
    const result = await api().restore(id, home.manage.gate.state === 'needs-resume', home.home);
    if (result.stopped) { stopped = result.stopped; break; }
    results.push(...result.results);
  }
  const view = await api().refresh();
  if (view) state.home = view;
  state.history = await api().history();
  const removed = results.filter(entry => entry.outcome === 'removed').length;
  const stayed = results.filter(entry => entry.outcome === 'held');
  const items = [...new Set(results.map(entry => entry.item))];
  if (!stopped) state.outcome = { page: state.page, items, text: `Undone: removed ${plural(removed, 'new copy', 'new copies')}; ${andList(items)} ${items.length === 1 ? 'is' : 'are'} unmanaged again.${stayed.length ? ` ${stayed.map(entry => entry.message).join(' ')}` : ''}` };
  for (const item of items) flashRow(item);
  announce(stopped ?? state.outcome?.text ?? '', !stopped);
});

/** Delete everywhere: offered when an edit was kept over a deletion with order unknown. */
export const deleteEverywhereKey = (key: string) => busy('Deleting everywhere…', async () => {
  const home = state.home!;
  const result = await api().deleteEverywhere(key, home.manage.gate.state === 'needs-resume', home.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.applied = result;
  announce(result.stopped ?? `Deleted from ${plural(result.harnessWrites, 'tool')}. Restore it from History.`);
});

// ---------- Sync switch and background changes ----------

export const setSync = (on: boolean) => busy(on ? 'Turning Sync on…' : 'Turning Sync off…', async () => {
  const view = await api().setSync(on);
  if (view) state.home = view;
  announce(on ? 'Automatic sync on.' : 'Automatic sync off.', true);
});

export const syncNow = () => busy('Syncing…', async () => {
  const view = await api().syncNow(state.home!.home);
  if (view) state.home = view;
  announce('Synced once. Automatic sync stays off.', true);
});

/** A background pass changed something: read again quietly, keeping drafts, unless the person is in the middle of an action. */
let refreshing = false;
// The Settings… menu item (and any later page the main process asks for) opens that page.
const pages: Page[] = ['overview', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'history', 'tools', 'settings'];
api().onNavigate(page => { if (pages.includes(page as Page)) showPage(page as Page); });

api().onSyncChanged(async () => {
  if (state.busy || refreshing || !state.home) return;
  refreshing = true;
  // Something happened on its own: its notice tells it, so an earlier action's message no longer stands beside it.
  // A result that still offers its Undo stays: the notice appears beside it, and Undo only removes copies that are unchanged.
  try {
    const view = await api().refresh();
    if (view) {
      state.home = view; announce('');
      const outcome = state.outcome;
      if (!outcome?.act) state.outcome = undefined;
      // A sync notice is now the news: the earlier result steps aside, and its Undo stays in History. Two Undo buttons for
      // different events, one above the other, is the one thing here that would mislead.
      else if ([...view.manage.notices, ...view.mcp.notices, ...view.agents.notices].length) {
        // Tied to the notices that pushed it aside: the line goes with them, and never outlives a later Apply.
        state.undoMoved = { page: outcome.page, label: outcome.act.label, items: outcome.items ?? (outcome.item ? [outcome.item] : []), notices: [...view.manage.notices, ...view.mcp.notices, ...view.agents.notices].map(notice => notice.history || notice.item) };
        state.outcome = undefined;
      }
      rerender();
    }
  } finally { refreshing = false; }
});

// ---------- MCP servers ----------

export const applyMcpChanges = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  const result = await api().applyMcp(changes, state.home!.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.mcpResult = result;
  if (!result.stopped) { onDone(); retireTip('mcp'); }
  if (!result.stopped) {
    const to = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean);
    const managed = changes.filter(change => change.managed).length;
    // The write band right below says what waits for Claude Code; the result names what was written, and where.
    const copied = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
    const matched = changes.filter(change => change.managed && !copied.includes(change.key)).map(change => change.key);
    // New entries are in History as 'added': one Undo removes them again (while unchanged) and unmanages those servers.
    const addedNow = (await api().history()).filter(event => event.kind === 'added' && !event.undoneBy && changes.some(change => `mcp:${change.key}` === event.key) && Date.now() - Date.parse(event.at) < 5 * 60_000);
    const replacedAny = result.results.some(entry => entry.outcome === 'written' && /^Now has/.test(entry.message));
    const undoable = addedNow.length > 0 && !replacedAny;
    state.outcome = { page: state.page, act: undoable ? addedUndo(addedNow) : undefined, items: [...copied, ...changes.filter(change => change.managed && !copied.includes(change.key)).map(change => change.key)], text: `${managed ? `${plural(managed, 'server')} now managed` : 'Applied'}. ${copied.length ? `${andList(copied)} copied to ${andList(to)}` : 'Nothing needed writing'}${matched.length && copied.length ? `; ${andList(matched)} ${matched.length === 1 ? 'was' : 'were'} already in ${andList(to)}` : ''}.${undoable ? '' : ' To take a new copy back out of a tool, turn off that tool’s box and Apply all, then delete it there.'}` };
  }
  announce(result.stopped ?? (result.writes ? 'Applied.' : 'Applied. Nothing needed writing.'), !result.stopped);
});

// ---------- Agents ----------

export const applyAgentsChanges = (changes: Change[], onDone: () => void) => busy('Applying…', async () => {
  // Read before applying: a copy that had stopped and is now replaced is said as resumed, not as newly managed.
  const before = state.home?.agents?.servers ?? [];
  const result = await api().applyAgents(changes, state.home!.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.agentsResult = result;
  if (!result.stopped) { onDone(); retireTip('agents'); }
  if (!result.stopped) {
    // One-way agents are said apart: an edit spreads from their source only.
    const managed = changes.filter(change => change.managed).map(change => state.home?.agents?.servers.find(server => server.key === change.key)).filter(server => !!server);
    const oneWay = managed.filter(server => Object.keys(server.limits ?? {}).length);
    const twoWay = managed.filter(server => !Object.keys(server.limits ?? {}).length);
    const nameOf = (server: { name?: string; key: string }) => server.name ?? server.key;
    const source = (server: (typeof managed)[number]) => { const match = /^One-way from ([^.]+)\./.exec(Object.values(server.limits ?? {})[0] ?? ''); return match?.[1] ?? 'its source'; };
    // New agent files are in History as 'added': one Undo removes them again (while unchanged) and unmanages those agents.
    const addedNow = (await api().history()).filter(event => event.kind === 'added' && !event.undoneBy && changes.some(change => `agent:${change.key}` === event.key) && Date.now() - Date.parse(event.at) < 5 * 60_000);
    const replacedAny = result.results.some(entry => entry.outcome === 'written' && /^Now has/.test(entry.message));
    const undo = addedNow.length && !replacedAny;
    state.outcome = { page: state.page, items: managed.map(nameOf), text: `${plural(managed.length, 'agent')} managed · ${result.writes ? `${plural(result.writes, 'file')} written` : 'nothing needed writing'}. Edits now sync on their own${oneWay.length ? `; ${oneWay.map(server => `${nameOf(server)} only from ${source(server)}`).join('; ')}` : ''}.${result.writes && !undo ? ' To take a new copy back out of a tool, turn off that tool’s box and Apply all, then delete it there.' : ''}`,
      act: undo ? addedUndo(addedNow) : undefined };
    const resumed = changes.map(change => ({ change, was: before.find(server => server.key === change.key) })).filter(({ change, was }) => change.use && change.use !== 'separate' && was?.managed && was.stopped?.length);
    // A resumed copy receives updates again: an earlier "keep my edit" no longer stands for a later edit.
    for (const { change, was } of resumed) for (const tool of was!.stopped!) { try { localStorage.removeItem(`ck-kept-edit:${state.home?.home ?? ''}:${change.key}:${tool}`); } catch { /* nothing kept */ } }
    if (resumed.length && resumed.length === changes.length && result.writes) {
      // The edit the resume replaced is one click back: its 'chosen' event restores it, and the copy stops again.
      const chosen = (await api().history()).filter(event => event.kind === 'chosen' && !event.undoneBy && resumed.some(({ change }) => event.key === `agent:${change.key}`) && Date.now() - Date.parse(event.at) < 5 * 60_000);
      const back = [...new Set(chosen.flatMap(event => event.losers.map(loser => toolName(loser.tool) ?? loser.tool)))];
      state.outcome = { page: state.page, items: resumed.map(({ was }) => nameOf(was!)),
        text: resumed.map(({ change, was }) => `${andList(was!.stopped!.map(tool => toolName(tool) ?? tool))} ${was!.stopped!.length === 1 ? 'has' : 'have'} ${toolName(change.use!) ?? change.use}’s copy of ${nameOf(was!)} again and receives its updates`).join('; ') + '. The edited copy is in History.',
        act: chosen.length === 1 && back.length ? { label: `Restore ${andList(back)}’s edit`, id: 'outcome-restore-edit', title: `Puts ${andList(back)}’s edited copy back; it stops updating again`, run: () => void restoreEvent(chosen[0]!.id, 'narrow') } : undefined };
    }
  }
  announce(result.stopped ?? (result.writes ? `${plural(result.writes, 'agent file', 'agent files')} written.` : 'Applied. Nothing needed writing.'));
});

/** Write now: Claude Code's entries, once the person has quit Claude Code (MCP-02). */
export const writeClaudeNow = (names: string[]) => { const earlier = state.outcome?.page === state.page ? state.outcome?.act?.label : undefined; return busy('Writing to Claude Code…', async () => {
  const result = await api().writeClaude(names, state.home!.home);
  const view = await api().refresh();
  if (view) state.home = view;
  state.mcpResult = result;
  const written = result.claudeWritten ?? [];
  if (!result.stopped) state.outcome = { page: state.page, item: names.length === 1 ? names[0] : undefined, items: names, text: state.home?.mode === 'fixture' ? `${names.join(', ')} written to the practice copy of Claude Code’s settings.` : `${names.join(', ')} written to Claude Code. Start Claude Code again to use ${names.length === 1 ? 'it' : 'them'}.`,
    // The result this replaces offered its own Undo: say where it went, so the way back from the bigger step is not lost.
    note: earlier && earlier !== 'Undo write' ? `${earlier} is in History.` : undefined,
    act: written.length ? { label: 'Undo write', id: 'outcome-undo-write', title: `Puts back what Claude Code had before (${written.map(write => `${write.name}: ${write.before ? 'its earlier entry' : 'removed'}`).join(', ')}). Quit Claude Code first.`, run: () => void unwriteClaudeNow(written) } : undefined };
  announce(result.stopped ?? `${plural(result.writes, 'server')} written to Claude Code.`);
}); };

const unwriteClaudeNow = (written: ClaudeWrite[]) => busy('Undoing the write…', async () => {
  const result = await api().unwriteClaude(written, state.home!.home);
  const view = await api().refresh();
  if (view) state.home = view;
  const names = written.map(write => write.name);
  state.outcome = result.stopped ? undefined : { page: state.page, items: names, text: `Undone: Claude Code has what it had before. ${names.join(', ')} ${names.length === 1 ? 'waits' : 'wait'} for Write to Claude Code again.` };
  announce(result.stopped ?? state.outcome!.text, true);
});
