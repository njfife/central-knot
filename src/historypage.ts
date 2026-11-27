// History: what Central Knot did, by itself (sync) or on a click (a switch, a profile switch, a Pull, …), newest first, with
// Undo or Restore where kept content allows (CON-02, DEL-03), and History's Keep control (settingspage.ts historyWindowControl).
// Skills', MCP servers', agents' and Synchronize everything's entries are worded and decided by historyactions.ts; here are
// profiles', base instructions', Manage switches' and pre-library entries, plus in-place folds for 3+ recorded tool lists (including all tools).
import { DAY_MS, plural, timesApart } from './model.ts';
import { acting, homeTools, noToolManaged, rerender, restoreEvent, shownPath, state, touchedToolsPhrase } from './app.ts';
import { noToolsState } from './pages.ts';
import { andList, toolName, touchedTools } from './words.ts';
import { changeWords, entryTurns, NO_PROFILE, undoOffered, undoWords, wholeCounts } from './profileplan.ts';
import { changePanel, outcomeBand, seeChangeLink } from './matrix.ts';
import { doneWords, entriesNow, entryKind, everythingAction, everythingSentence, keptOver, libraryAction, libraryEntry, librarySentence, versionChoices } from './historyactions.ts';
import { libraryWords } from './libraryrow.ts';
import { button, emptyState, fold, h, icon, rereadBand, type Child } from './dom.ts';
import type { IconName } from './icons.ts';
import { askManage, manageLocked, manageQuestion, manageTool, resumeWords } from './managecard.ts';
import { historyWindowControl } from './settingspage.ts';
import type { HarnessId, HistoryEvent } from './types.ts';

const who = (tool?: string) => (tool ? toolName(tool) : 'Central Knot');
/** Folded tool lists open on History rows (`${event.id}-${index}` across redraws); cleared on page leave or home switch (app.ts). */
const openToolFolds = new Set<string>();
export function forgetHistoryFolds() {
  openToolFolds.clear();
}
type ToolFormat = (touched: string[], inHome: string[]) => string;

/** The skill, MCP server or agent an entry is about, as Central Knot's library holds it now (deleted or not). */
const itemOf = (event: HistoryEvent) => { const entry = libraryEntry(event); return entry && state.home?.[entry.kind].library?.[entry.key]; };
/** A take-over's entry names the copy's path as the page shows paths (from ~, or "…" inside another home). */
const pathsShown = (event: HistoryEvent): HistoryEvent => (event.kind === 'took-over' ? { ...event, losers: event.losers.map(copy => (copy.path ? { ...copy, path: shownPath(copy.path) } : copy)) } : event);
/** Whether the entry is another's Undo: that one's `undoneBy` names it. */
const undid = (event: HistoryEvent) => !!state.history.data?.some(other => other.undoneBy === event.id);

/**
 * What an entry says. A library item's entry says it in the library's words (historyactions.ts); one from before an item was
 * on the library that the library has no words for keeps a general sentence below. `action`: the button profiles' and the base
 * instructions' entries offer (a library item's are libraryButtons).
 */
function describe(event: HistoryEvent, formatTools: ToolFormat): { glyph: IconName; text: string; action?: string } {
  const entry = libraryEntry(event);
  const library = entry && librarySentence(pathsShown(event), libraryWords[entry.kind], state.home?.[entry.kind].tools ?? [], itemOf(event), undid(event), { row: true, tools: formatTools });
  if (library) return library;
  const phrase = (touched: string[]) => formatTools(touched, homeTools());
  const order = event.orderProved ? '' : ' Order not proved; the fixed tool order decided.';
  // A Pull's edit or deletion of the base instructions: said as the pull, undone or not.
  if (event.base) return pulledBase(event, event.base.list.tools.length ? phrase(event.base.list.tools) : '');
  if (event.kind === 'profile') return profileSwitch(event);
  if (event.kind === 'managing' && event.managing) return managingWords(event.managing);
  if (event.kind === 'everything') return { ...everythingSentence(event), action: everythingOffer(event)?.label };
  // Pull from the git repo, before the library: said as a pull, whichever way sync carried it.
  if (event.via === 'repo' && !event.undoneBy) {
    if (event.kind === 'deleted') return { glyph: 'git-branch', text: 'Removed in the git repo, so Pull deleted it from the tools it synced to.' };
    if (event.kind === 'chosen') return { glyph: 'git-branch', text: `Pulled from the git repo; it replaced the copy in ${phrase(event.losers.map(loser => loser.tool))}.` };
    if (event.kind === 'edit') return { glyph: 'git-branch', text: `Pulled from the git repo into ${who(event.winner?.tool)}${event.losers.length ? `, then copied to ${phrase(event.losers.map(loser => loser.tool))}` : ''}.` };
    if (event.kind === 'added') return { glyph: 'git-branch', text: `Pulled from the git repo and added to ${phrase(event.losers.map(loser => loser.tool))}.` };
  }
  const tools = (list: { tool: string }[]) => phrase(list.map(entry => entry.tool));
  switch (event.kind) {
    case 'edit': return { glyph: 'pencil-line', text: `Edited in ${who(event.winner?.tool)}, then copied to ${tools(event.losers) || 'the others'}.` };
    case 'conflict': {
      const lost = [...new Set(event.losers.filter(loser => loser.hash !== event.previous).map(loser => loser.tool))];
      const over = lost.length > 2 ? `edits in ${phrase(lost)}` : `${lost.length ? phrase(lost) : 'another'}’s`;
      return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit won over ${over}.${order}` };
    }
    case 'deleted': return { glyph: 'trash-2', text: `Deleted${event.winner ? ` in ${who(event.winner.tool)}` : ''}, then removed from the other tools it synced to.` };
    case 'kept-edit': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit was kept over a deletion in ${tools(event.losers)}.${order}` };
    case 'chosen': return { glyph: 'check', text: `You chose ${who(event.winner?.tool)}’s copy; it replaced ${andList(event.losers.map(loser => who(loser.tool)))}’s.` };
    case 'switched': {
      const turned = (disabled: boolean) => phrase((event.switched ?? []).filter(entry => entry.disabled === disabled).map(entry => entry.tool));
      const switched = event.switched ?? [];
      const text = [switched.some(entry => entry.disabled) && `turned off in ${turned(true)}`, switched.some(entry => !entry.disabled) && `turned on in ${turned(false)}`].filter(Boolean).join('; ');
      const one = switched.length === 1 ? who(switched[0].tool) : undefined;
      return { glyph: 'circle-off', text: `${text.charAt(0).toUpperCase()}${text.slice(1)}, using ${one ? `${one}’s` : 'each tool’s'} own switch.` };
    }
    case 'removed': return { glyph: 'circle-minus', text: `Removed from ${tools(event.losers)}; Central Knot kept the ${event.losers.length === 1 ? 'copy' : 'copies'}.` };
    // A skill's copies taken over before Central Knot kept versions (Replace with managed copies): past.
    case 'took-over': return { glyph: 'arrow-down-to-line', text: `Took over its copies outside Central Knot${event.undoneBy ? '; this was undone, and they were put back as they were' : ''}.` };
    case 'written': return { glyph: 'pencil-line', text: 'Central Knot replaced Claude Code’s own entry with the synced one, and kept it.' };
    case 'added': {
      const what = event.rejoined ? 'Syncing it there again' : 'Turning it on';
      return { glyph: 'plus', text: event.undoneBy ? `${what} added copies to ${tools(event.losers)}; they were removed again.` : `${what} added ${event.losers.length === 1 ? 'a copy' : 'copies'} to ${tools(event.losers)}.` };
    }
    case 'restored': return { glyph: 'undo-2', text: `Undid an earlier change; the version from before it was back${event.losers.length ? ` in ${tools(event.losers)}` : ''}.` };
    // Every library item's entry of these kinds has the library's words (historyactions.ts).
    default: return { glyph: 'circle-check', text: 'Changed.' };
  }
}

/** Describes a History row and builds its sentence element, folding 3+ recorded tool lists (including all tools) into in-place folds under the sentence. */
function rowAbout(event: HistoryEvent): { glyph: IconName; action?: string; node: HTMLElement } {
  const groups: { label: string; names: string }[] = [];
  // formatTools splices `\0<group index>\0` markers into the plain sentence so rowAbout can swap each slot for a fold below.
  const formatTools: ToolFormat = (touched, inHome) => {
    const { tools, all, names, fold: label } = touchedTools(touched, inHome);
    const shown = all ? `all ${tools.length} tools` : label;
    return shown ? `\0${groups.push({ label: shown, names }) - 1}\0` : names;
  };
  const described = describe(event, formatTools);
  // What it also changed in a tool's own settings (Pi's skills list: HistoryEvent settingsChanged) follows its words.
  const text = event.settingsChanged ? `${described.text} ${event.settingsChanged.join(' ')}` : described.text;
  if (!text.includes('\0')) return { glyph: described.glyph, action: described.action, node: h('div.history-about', {}, text) };
  const opened: HTMLElement[] = [];
  // Odd slots are `\0<group index>\0` markers from formatTools; even slots are literal text (drop a trailing "." only when a fold ends the row).
  const inline: Child[] = text.split('\0').map((part, slot, parts) => {
    if (slot % 2 === 0) return slot === parts.length - 1 ? part.replace(/^\.$/, '') : part;
    const group = groups[Number(part)]!;
    const key = `${event.id}-${(slot - 1) / 2}`;
    const open = openToolFolds.has(key);
    const namesId = `history-tools-names-${key}`;
    if (open) opened.push(h('div.fold-body.history-tools-names', { id: namesId }, group.names));
    return fold({
      id: `history-tools-${key}`, toggleId: `history-tools-toggle-${key}`, label: group.label, open,
      controls: open ? namesId : undefined,
      onToggle: now => {
        if (now) openToolFolds.add(key);
        else openToolFolds.delete(key);
        rerender();
      },
    });
  });
  return { glyph: described.glyph, action: described.action, node: h('div.history-about', {}, ...inline, ...opened) };
}

/** The base instructions as a Pull changed them: set for the first time, edited, or deleted; `tools` names the tools that get them. */
function pulledBase(event: HistoryEvent, tools: string): { glyph: IconName; text: string; action: string } {
  if (event.kind === 'deleted') return { glyph: 'git-branch', text: `Deleted in the git repo, so Pull emptied the base instructions${tools ? ` and took them out of ${tools}` : ''}.`, action: 'Undo' };
  const first = !event.base!.text.trim();
  return { glyph: 'git-branch', text: `${first ? 'Added in the git repo, so Pull set' : 'Changed in the git repo, so Pull updated'} the base instructions${tools ? ` in ${tools}` : ''}.`, action: 'Undo' };
}

/**
 * A profile entry (profiles.ts): a switch, or the profiles migration (profilemigrate.ts), with the items it turned On and Off, a
 * plugin's item once however many tools it was turned in. Its Undo is offered while an item, or a plugin item's copy, is still as
 * it left it (profileplan.ts undoOffered). One from before profiles were sets of items has neither list, and is past: it offers nothing.
 */
function profileSwitch(event: HistoryEvent): { glyph: IconName; text: string; action?: string } {
  const was = event.profile!, glyph: IconName = 'sliders-horizontal';
  // What it did, items and plugins alike, or "nothing changed" (profileplan.ts changeWords).
  const did = changeWords(entryTurns(was), wholeCounts({ steps: was.wholeSteps }), 'did') || 'nothing changed';
  if (was.undoOf) return { glyph, text: `Undid the switch to ${was.toName}: ${did}.` };
  if (!was.on && !was.off) return { glyph, text: `Switched to ${was.toName ?? NO_PROFILE} with each tool’s own switches, before profiles were sets of items.` };
  const action = state.home && undoOffered(event, state.home) ? 'Undo' : undefined;
  if (was.migrated) {
    const off = was.off ?? [];
    return { glyph, text: `Profiles are sets of items now: ${plural(off.length, 'item')} ${was.toName ?? 'a profile'} held off in every tool ${off.length === 1 ? 'is' : 'are'} off now, and the switches profiles had set in tools are released.`, action };
  }
  return { glyph, text: `Switched to ${was.toName}: ${did}.`, action };
}

/**
 * A tool's Manage switch turned (toolchoice.ts), said as what holds from then on. While the tool is still present in that state,
 * the row offers the reverse act (managingRow, through managecard.ts manageTool); each change sync made keeps its own entry.
 */
const managingWords = ({ tool, on }: NonNullable<HistoryEvent['managing']>): { glyph: IconName; text: string } => (on
  ? { glyph: 'boxes', text: `Central Knot manages ${toolName(tool)} from here on: sync brings it into line, each change with its own entry.` }
  : { glyph: 'boxes', text: `Left out from here on: Central Knot writes nothing in ${toolName(tool)}, and its copies there stay as they are.` });

/**
 * A Manage entry's reverse button and panel: Leave <tool> out again, acting at once; or Manage <tool>, which asks the card's own
 * question in the row first (managecard.ts askManage, manageQuestion), whose button is Manage <tool> too.
 */
function managingRow(event: HistoryEvent): [HTMLElement | null, HTMLElement | null] {
  const home = state.home, entry = event.managing;
  if (!home || !entry || !home.sync.present.includes(entry.tool) || home.sync.managed.includes(entry.tool) !== entry.on) return [null, null];
  const disabled = manageLocked(home) ?? acting(), name = toolName(entry.tool);
  if (entry.on) {
    const help = `Its copies stay. Central Knot stops writing there.${resumeWords(home)}`;
    return [button({ variant: 'link', size: 'small', label: `Leave ${name} out again`, name: `Leave ${name} out again: ${help}`,
      id: `history-${event.id}`, disabled, attrs: { title: help }, onclick: () => void manageTool(entry.tool, false, home.home) }), null];
  }
  const asking = manageQuestion(home, entry.tool, event.id);
  if (asking) return [null, asking];
  return [button({ variant: 'link', size: 'small', label: `Manage ${name}`, name: `Manage ${name}: asks what that does there first`,
    id: `history-${event.id}`, disabled, onclick: () => void askManage(entry.tool, event.id) }), null];
}

/** What a Synchronize everything entry offers now (historyactions.ts everythingAction), from History and the libraries as the page read them. */
const everythingOffer = (event: HistoryEvent) => (state.home && state.history.data ? everythingAction(event, state.history.data, entriesNow(state.home)) : undefined);

/** Skills, MCP servers, agents, profile switches, tools' Manage switches and Synchronize everything share History; each row says which it is. */
const kindOf = (event: HistoryEvent) => {
  const of = entryKind(event);
  return of ? ({ skill: 'Skill', mcp: 'MCP server', agent: 'Agent' } as const)[of] : event.kind === 'profile' ? 'Profile' : event.kind === 'managing' ? 'Tool' : event.kind === 'everything' ? 'Setting' : 'Instructions';
};
/** Rows are grouped by day (day headings); each row shows its time, every row in one form (model.ts timesApart). */
const day = (iso: string) => {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) return 'Today';
  if (date.toDateString() === new Date(Date.now() - DAY_MS).toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};
/** What a profile's, the base instructions' or Synchronize everything's action will do, said before the click. */
const actionHelp = (event: HistoryEvent) => (event.kind === 'profile'
  ? `Undo: ${undoWords(event, state.home!)}, as each was before this; an item changed since stays as it is`
  : event.kind === 'everything' ? everythingOffer(event)?.help ?? ''
    : 'Put the base instructions back as they were before this Pull, and in the tools that got them (where their file is unchanged since)');

/** A library entry's buttons (historyactions.ts): its own action, and one "Use <harness>’s copy" for each copy that gave way. */
function libraryButtons(event: HistoryEvent) {
  const entry = libraryEntry(event)!, item = itemOf(event);
  // A skill's own switches as the page last read them, so an action that would change nothing there is not offered.
  const loads = entry.kind === 'skills' ? state.home?.skills.items.find(row => row.key === entry.key)?.loads : undefined;
  const own = libraryAction(event, item, entriesNow(state.home!)(event).now, undefined, loads);
  const link = (label: string, help: string, id: string, version?: string) => {
    const control = button({ variant: 'link', size: 'small', label, name: `${label} (${event.item}): ${help}`, id, disabled: acting(), onclick: () => void restoreEvent(event.id, version) });
    control.title = help;
    return control;
  };
  // Restore over an item of that name made since (a found copy that isn't the restored version): it is kept as a version.
  const found = own?.label === 'Restore' ? state.home?.[entry.kind].items.find(row => row.key === entry.key) : undefined;
  const over = Object.entries(found?.copies ?? {}).filter(([, copy]) => copy && copy.hash !== item?.hash).map(([tool]) => tool);
  const help = own && over.length ? `${own.help}. ${keptOver(event.item, over)}` : own?.help;
  return [own ? link(own.label, help!, `history-${event.id}`) : null,
    ...versionChoices(event, item).map(choice => link(`Use ${who(choice.tool)}’s copy`, `Make ${who(choice.tool)}’s version of ${event.item} the current one`, `history-${event.id}-${choice.tool}`, choice.hash))];
}

/** A profile's or the base instructions' Undo (or Redo), naming what it undoes: "Undo switch", or "Undo pull in Claude Code and Codex". */
function actions(event: HistoryEvent, action?: string) {
  if (!action) return h('span');
  // A base no tool gets is undone in Central Knot alone, so its Undo names no tools.
  const scope = event.base?.list.tools.length ? `in ${touchedToolsPhrase(event.base.list.tools)}` : '';
  // A Pull's Undo says that it undoes the pull.
  const verb = action === 'Undo' && event.via === 'repo' ? 'Undo pull' : action;
  const label = event.kind === 'profile' ? `${action} switch` : `${verb} ${scope}`.trim();
  const control = button({ variant: 'link', size: 'small', label, name: `${label} ${event.item}: ${actionHelp(event)}`, id: `history-${event.id}`, disabled: acting(), onclick: () => void restoreEvent(event.id) });
  control.title = actionHelp(event);
  return control;
}

export function historyPage() {
  // From History's own read (pagedata.ts): what it found, else that it is reading or could not read.
  const events = state.history.data;
  if (!events) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.history.state === 'failed' ? 'History could not be read.' : 'Reading History…')));
  const reread = rereadBand(state.history);
  if (!events.length) {
    const shown = state.outcome?.page === 'history' ? outcomeBand() : null;
    const bands = reread || shown ? h('div.bands', {}, reread, shown) : null;
    if (noToolManaged()) return h('div.page', {}, bands, historyWindowControl(), noToolsState('history'));
    return h('div.page', {}, bands, h('div.scroll.history-empty-scroll', { id: 'history-scroll' }, historyWindowControl(),
      emptyState('history', 'No changes yet', 'Changes by sync and by you appear here, with Undo.')));
  }
  const ordered = [...events].reverse(), times = timesApart(ordered.map(event => event.at));
  // A refused Undo, a Manage click, a Restore with reload advice, or an Undo that ended the profile in use shows in a band; other results here are in the status bar.
  const shown = state.outcome?.page === 'history' && (state.outcome.warn || state.outcome.historyBand || !!state.outcome.reloads?.length || !!state.outcome.profileLine) ? outcomeBand() : null;
  const latestManage = (tool: HarnessId) => ordered.find(other => other.kind === 'managing' && other.managing?.tool === tool)?.id;
  return h('div.page', {}, reread || shown ? h('div.bands', {}, reread, shown) : null, h('div.scroll', { id: 'history-scroll' }, historyWindowControl(), h('ul.history-list', {}, ordered.flatMap((event, index) => {
    const about = rowAbout(event);
    const heading = index === 0 || day(ordered[index - 1].at) !== day(event.at) ? h('li.history-day', { role: 'presentation' }, day(event.at)) : null;
    // The newest row, made by a click just now, gets the same brief highlight the tables use.
    const fresh = index === 0 && Date.now() - Date.parse(event.at) < 8000;
    const managed = event.kind === 'managing' && event.managing && latestManage(event.managing.tool) === event.id ? managingRow(event) : undefined;
    return [heading, h(`li.history-row${event.undoneBy ? '.history-undone' : ''}${fresh ? '.row-flash' : ''}`,
      { 'data-kind': event.kind, id: `history-row-${event.id}`, ...(event.kind === 'managing' ? { tabIndex: -1 } : {}) },
      h('span.history-when', { title: new Date(event.at).toLocaleString() }, times[index]),
      // What changed, then what happened in the flexible column (its text capped at the reading measure); the actions keep a
      // steady column at the right, the same on every row. Narrow, what happened takes a line of its own beneath (style.css).
      h('span.history-what', {}, icon(about.glyph, 14, 'tone-muted'), h('span.history-kind', {}, kindOf(event)), h('strong', { title: event.item }, event.item)),
      about.node,
      event.undoneBy ? h('span.history-actions', {}, h('span.history-done', {}, libraryEntry(event) ? doneWords(event) : event.kind === 'removed' || event.everything?.undo ? 'Restored' : 'Undone'))
        : h('span.history-actions', {},
          !event.base && (event.kind === 'edit' || event.kind === 'conflict') ? seeChangeLink(event.id, libraryEntry(event)?.kind, true) : null,
          libraryEntry(event) ? libraryButtons(event) : managed ? managed[0] : actions(event, about.action)),
      changePanel(event.id),
      managed?.[1] ?? null)];
  }))));
}
