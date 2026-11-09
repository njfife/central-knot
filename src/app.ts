import { loadSettings } from './settingspage.ts';
import type { ApplyResult, Change, DesktopApi, DestinationResult, HarnessId, InstructionFile, HistoryEvent, HomeMode, HomeView, McpResult, ClaudeWrite } from './types.ts';
import { plural } from './model.ts';
import { andList, toolName, toolNames as namedTools } from './words.ts';
import { loadPlugins, resetMarket } from './pluginstate.ts';

declare global { interface Window { centralKnot: DesktopApi } }
const api = () => window.centralKnot;

export type Page = 'overview' | 'skills' | 'mcp' | 'agents' | 'instructions' | 'plugins' | 'history' | 'tools' | 'settings';

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
  focusById(focused);
}

function accept(view: HomeView) {
  state.home = view;
  state.applied = undefined;
  state.item = undefined;
  state.instructionEdit = undefined;
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
  const started = Date.now();
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
  // Disable, Enable and Remove, per tool, said after the copies.
  const toolsWhere = (match: (entry: DestinationResult) => boolean) => [...new Set(result.results.filter(match).map(entry => toolName(entry.harness ?? '') ?? ''))].filter(Boolean).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const disabledIn = toolsWhere(entry => entry.outcome === 'switched' && entry.disabled === true), enabledIn = toolsWhere(entry => entry.outcome === 'switched' && entry.disabled === false), removedFrom = toolsWhere(entry => entry.outcome === 'removed');
  const touched = [...new Set(result.results.filter(entry => entry.outcome === 'switched' || entry.outcome === 'removed').map(entry => entry.item))];
  const whose = touched.length === 1 && !singleName ? `${touched[0]} ` : '';
  const what = [managed ? (singleName ? `${singleName} managed` : `${plural(managed, 'skill')} managed`) : '', newCopies.length ? `${plural(newCopies.length, 'new copy', 'new copies')} written${!singleName && newItems.length <= 3 ? ` (${newItems.join(', ')})` : ` to ${andList(added)}`}` : '', replacedIn.length ? `replaced ${andList(replacedIn.map(name => `${name}’s copy`))} (kept in History)` : '',
    disabledIn.length ? `${whose}disabled in ${andList(disabledIn)}` : '', enabledIn.length ? `${disabledIn.length ? '' : whose}enabled in ${andList(enabledIn)}` : '', removedFrom.length ? `${disabledIn.length || enabledIn.length ? '' : whose}removed from ${andList(removedFrom)} (kept in History)` : '',
    !added.length && !replacedIn.length && !touched.length ? 'nothing needed copying' : ''].filter(Boolean).join(' · ');
  // New copies are in History as 'added': one Undo here removes them again (while unchanged) and unmanages those skills.
  // Only when nothing was replaced: undoing a replacement is its own History entry, and a half-undone choice would mislead.
  const recent = result.stopped ? [] : (await api().history()).filter(event => !event.undoneBy && changes.some(change => change.key === event.key) && Date.now() - Date.parse(event.at) < 5 * 60_000);
  // Only a run that wrote new copies offers to undo them: an earlier Apply all's copies are undone from History.
  const addedNow = replacedSome || !newCopies.length ? [] : recent.filter(event => event.kind === 'added');
  // A copy choice gets its own inline Undo: each replaced copy back in its own tool, new copies removed, the skill unmanaged.
  const chosenNow = replacedSome ? recent.filter(event => event.kind === 'chosen') : [];
  // A lone Disable, Enable or Remove gets its own Undo here; more than one is undone from History.
  const switchedNow = recent.filter(event => (event.kind === 'switched' || event.kind === 'removed') && Date.parse(event.at) >= started - 1000);
  const switchUndo = switchedNow.length === 1 && !addedNow.length && !chosenNow.length
    ? { label: switchedNow[0].kind === 'removed' ? 'Restore' : 'Undo', id: 'outcome-undo-switch', title: switchedNow[0].kind === 'removed' ? 'Put the removed copy back' : 'Flip it back', run: () => void restoreEvent(switchedNow[0].id) } : undefined;
  const firstApply = !readFlag('ck-applied-once');
  writeFlag('ck-applied-once');
  if (!result.stopped) state.outcome = { page: state.page, history: replacedSome && !chosenNow.length, text: `${what}.` + (managed && firstApply ? ' Edits now spread between tools.' : ''), item: singleName, items: newItems,
    act: addedNow.length ? addedUndo(addedNow, switchedNow) : chosenNow.length ? choiceUndo(chosenNow) : switchUndo };
  const failed = result.results.filter(entry => entry.outcome === 'failed').length;
  const written = [...new Set(result.results.filter(entry => entry.outcome === 'written').map(entry => entry.item))];
  // Copies written are counted; a run that only disabled, enabled or removed says so in the band's words.
  const copiesWritten = result.results.filter(entry => entry.outcome === 'written').length;
  announce(result.stopped ?? [copiesWritten ? `${plural(copiesWritten, 'copy', 'copies')} written${written.length <= 3 ? `: ${written.join(', ')}` : ''}.` : touched.length ? `${what.charAt(0).toUpperCase()}${what.slice(1)}.` : 'Applied. Nothing needed copying.', failed ? `${failed} failed.` : ''].filter(Boolean).join(' '));
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
  // An unsaved draft survives a page switch: the save is still checked against the file it was opened from.
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
  if (past?.kind === 'switched' || past?.kind === 'removed') {
    const switched = result.results.filter(entry => entry.outcome === 'switched' || entry.outcome === 'written');
    const text = past.kind === 'removed' ? `${past.item} is back in ${andList(where)}.` : switched.map(entry => `${past.item}: ${entry.message}`).join(' ');
    if (!result.stopped) { state.outcome = { page: state.page, item: past.item, text, undo: past.kind === 'switched' && undoneBy ? { id: undoneBy, label: 'Undo again' } : undefined }; flashRow(past.item); }
    announce(result.stopped ?? text, !result.stopped);
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

export const loadInstructions = () => busy('Reading instruction files…', async () => {
  state.instructions = (await api().instructions()) ?? undefined;
  announce('', true);
});

/** A checked save of one file: it must still hold what was opened; the replaced text is kept as an earlier version. */
export const saveInstructionText = (file: InstructionFile, text: string) => busy('Saving…', async () => {
  const result = await api().saveInstruction(file.tool, text, state.instructionEdit?.hash ?? file.hash, state.home!.home);
  state.instructions = (await api().instructions()) ?? state.instructions;
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
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
  state.instructions = (await api().instructions()) ?? state.instructions;
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  if (result.stopped) { state.outcome = undefined; announce(result.stopped); return; }
  state.outcome = { page: 'instructions', item: name, text: `${name} is back as it was before your save. The text you saved is under Earlier versions.` };
  announce(state.outcome.text, true);
});

/** Opens one file in the editor; any earlier result band belongs to the last task, not this one. */
export function startInstructionEdit(file: InstructionFile) {
  // A save on another card keeps its Undo there; any other result belongs to the last task.
  if (!(state.outcome && /^Saved /.test(state.outcome.text) && state.outcome.item !== file.path.split(/[\\/]/).pop())) state.outcome = undefined;
  state.instructionEdit = { tool: file.tool, text: file.text, hash: file.hash, stage: 'edit' };
  rerender();
  const area = document.getElementById(`ins-text-${file.tool}`) as HTMLTextAreaElement | null;
  area?.focus();
  document.getElementById(`ins-actions-${file.tool}`)?.scrollIntoView({ block: 'nearest' });
}

/** Loads an earlier version into the editor; putting it back is an ordinary save, with its diff first. */
export const loadInstructionVersion = (file: InstructionFile, id: string) => busy('Reading the earlier version…', async () => {
  const text = await api().instructionVersion(file.tool, id);
  if (text === undefined) { announce('That version is no longer kept.'); return; }
  state.outcome = undefined;
  state.instructionEdit = { tool: file.tool, text, hash: file.hash, stage: 'review', restoring: true };
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
