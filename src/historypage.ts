// History: what Central Knot did, by itself (sync) or on a click (a switch, a profile switch, a Pull, …), newest first, with
// Undo or Restore where the kept content allows it (CON-02, DEL-03). Skills', MCP servers' and agents' entries are worded, and
// their actions decided, by historyactions.ts; here are profiles' and the base instructions' entries, and the sentences of
// entries from before an item was on the library (which offer only what historyactions.ts finds left to do).
import { DAY_MS, timesApart } from './model.ts';
import { noTools, restoreEvent, showPage, shownPath, state, touchedToolsPhrase } from './app.ts';
import { noToolsState } from './pages.ts';
import { andList, toolName } from './words.ts';
import { changedProfile, flipSummary, NO_PROFILE, redoneSwitch } from './profileplan.ts';
import { changePanel, outcomeBand, seeChangeLink } from './matrix.ts';
import { doneWords, keptOver, libraryAction, libraryEntry, librarySentence, versionChoices } from './historyactions.ts';
import { libraryWords } from './libraryrow.ts';
import { button, emptyState, h, icon, rereadBand } from './dom.ts';
import type { IconName } from './icons.ts';
import type { HistoryEvent } from './types.ts';

const who = (tool?: string) => (tool ? toolName(tool) : 'Central Knot');

/** The skill, MCP server or agent an entry is about, as Central Knot's library holds it now (deleted or not). */
const itemOf = (event: HistoryEvent) => { const entry = libraryEntry(event); return entry && state.home?.[entry.kind].library?.[entry.key]; };
/** A take-over's entry names the copy's path as the page shows paths (from ~, or "…" inside another home). */
const pathsShown = (event: HistoryEvent): HistoryEvent => (event.kind === 'took-over' ? { ...event, losers: event.losers.map(copy => (copy.path ? { ...copy, path: shownPath(copy.path) } : copy)) } : event);
/** A library item's entry in its kind's words (historyactions.ts librarySentence). */
const said = (event: HistoryEvent) => { const entry = libraryEntry(event); return entry && librarySentence(pathsShown(event), libraryWords[entry.kind], state.home?.[entry.kind].tools ?? [], itemOf(event), undid(event)); };
/** Whether the entry is another's Undo: that one's `undoneBy` names it. */
const undid = (event: HistoryEvent) => !!state.history.data?.some(other => other.undoneBy === event.id);

/**
 * What an entry says. A library item's entry says it in the library's words (historyactions.ts); one from before an item was
 * on the library that the library has no words for keeps a general sentence below. `action`: the button profiles' and the base
 * instructions' entries offer (a library item's are libraryButtons).
 */
function describe(event: HistoryEvent): { glyph: IconName; text: string; action?: string } {
  const library = said(event);
  if (library) return library;
  const order = event.orderProved ? '' : ' Order not proved; the fixed tool order decided.';
  // A Pull's edit or deletion of the base instructions: said as the pull, undone or not.
  if (event.base) return pulledBase(event, event.base.list.tools.length ? touchedToolsPhrase(event.base.list.tools) : '');
  if (event.kind === 'profile') return profileSwitch(event);
  // Pull from the git repo, before the library: said as a pull, whichever way sync carried it.
  if (event.via === 'repo' && !event.undoneBy) {
    if (event.kind === 'deleted') return { glyph: 'git-branch', text: 'Removed in the git repo, so Pull deleted it from the tools it synced to.' };
    if (event.kind === 'chosen') return { glyph: 'git-branch', text: `Pulled from the git repo; it replaced the copy in ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}.` };
    if (event.kind === 'edit') return { glyph: 'git-branch', text: `Pulled from the git repo into ${who(event.winner?.tool)}${event.losers.length ? `, then copied to ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}` : ''}.` };
    if (event.kind === 'added') return { glyph: 'git-branch', text: `Pulled from the git repo and added to ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}.` };
  }
  const tools = (list: { tool: string }[]) => touchedToolsPhrase(list.map(entry => entry.tool));
  switch (event.kind) {
    case 'edit': return { glyph: 'pencil-line', text: `Edited in ${who(event.winner?.tool)}, then copied to ${tools(event.losers) || 'the others'}.` };
    case 'conflict': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit won over ${andList(event.losers.filter(loser => loser.hash !== event.previous).map(loser => who(loser.tool)))}’s.${order}` };
    case 'deleted': return { glyph: 'trash-2', text: `Deleted${event.winner ? ` in ${who(event.winner.tool)}` : ''}, then removed from the other tools it synced to.` };
    case 'kept-edit': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit was kept over a deletion in ${tools(event.losers)}.${order}` };
    case 'chosen': return { glyph: 'check', text: `You chose ${who(event.winner?.tool)}’s copy; it replaced ${andList(event.losers.map(loser => who(loser.tool)))}’s.` };
    case 'switched': {
      const turned = (disabled: boolean) => touchedToolsPhrase((event.switched ?? []).filter(entry => entry.disabled === disabled).map(entry => entry.tool));
      const switched = event.switched ?? [];
      const text = [switched.some(entry => entry.disabled) && `turned off in ${turned(true)}`, switched.some(entry => !entry.disabled) && `turned on in ${turned(false)}`].filter(Boolean).join('; ');
      const one = switched.length === 1 ? who(switched[0].tool) : undefined;
      return { glyph: 'circle-off', text: `${text.charAt(0).toUpperCase()}${text.slice(1)}, using ${one ? `${one}’s` : 'each tool’s'} own switch.` };
    }
    case 'removed': return { glyph: 'circle-minus', text: `Removed from ${tools(event.losers)}; Central Knot kept the ${event.losers.length === 1 ? 'copy' : 'copies'}.` };
    // A skill's copies taken over before Central Knot kept versions (Replace with managed copies): past.
    case 'took-over': return { glyph: 'arrow-down-to-line', text: `Took over its copies outside Central Knot${event.undoneBy ? '; this was undone, and they were put back as they were' : ''}.` };
    case 'written': return { glyph: 'pencil-line', text: 'Write to Claude Code replaced Claude Code’s own entry with the synced one; Central Knot kept it.' };
    case 'added': {
      const what = event.rejoined ? 'Syncing it there again' : 'Turning it on';
      return { glyph: 'plus', text: event.undoneBy ? `${what} added copies to ${tools(event.losers)}; they were removed again.` : `${what} added ${event.losers.length === 1 ? 'a copy' : 'copies'} to ${tools(event.losers)}.` };
    }
    case 'restored': return { glyph: 'undo-2', text: `Undid an earlier change; the version from before it was back${event.losers.length ? ` in ${tools(event.losers)}` : ''}.` };
    // Every library item's entry of these kinds has the library's words (historyactions.ts).
    default: return { glyph: 'circle-check', text: 'Changed.' };
  }
}

/** The base instructions as a Pull changed them: set for the first time, edited, or deleted; `tools` names the tools that get them. */
function pulledBase(event: HistoryEvent, tools: string): { glyph: IconName; text: string; action: string } {
  if (event.kind === 'deleted') return { glyph: 'git-branch', text: `Deleted in the git repo, so Pull emptied the base instructions${tools ? ` and took them out of ${tools}` : ''}.`, action: 'Undo' };
  const first = !event.base!.text.trim();
  return { glyph: 'git-branch', text: `${first ? 'Added in the git repo, so Pull set' : 'Changed in the git repo, so Pull updated'} the base instructions${tools ? ` in ${tools}` : ''}.`, action: 'Undo' };
}

/** A profile switch: what it switched to, and how many items it turned off and on, where. An undo says what it undid. */
function profileSwitch(event: HistoryEvent): { glyph: IconName; text: string; action: string } {
  const switched = event.profile!;
  // Said as the result of the switch said it.
  const counts = flipSummary(switched.flips) || 'no switch needed changing';
  const undid = state.history.data?.find(other => other.undoneBy === event.id);
  const to = switched.toName ?? NO_PROFILE;
  // A redo undoes an undo: it makes that switch again (named by the switch, not the profile in use), and its own Undo undoes it once more.
  const redid = state.history.data && redoneSwitch(state.history.data, event);
  if (redid) return { glyph: 'sliders-horizontal', text: `Redid the switch to ${redid.profile?.toName ?? NO_PROFILE}: ${counts}.`, action: 'Undo' };
  if (undid?.kind === 'profile') return { glyph: 'undo-2', text: `Undid the switch to ${undid.profile?.toName ?? NO_PROFILE}; back to ${to}: ${counts}.`, action: 'Redo' };
  // Apply to tools: the profile in use, made to match again.
  if (!changedProfile(event)) return { glyph: 'sliders-horizontal', text: `Applied ${to} to tools again: ${counts}.`, action: 'Undo' };
  return { glyph: 'sliders-horizontal', text: `Switched${switched.fromName ? ` from ${switched.fromName}` : ''} to ${to}: ${counts}.`, action: 'Undo' };
}

/** Skills, MCP servers, agents and profile switches share History; each row says which it is. */
const kindOf = (event: HistoryEvent) => (event.kind === 'profile' ? 'Profile' : event.base ? 'Instructions' : event.key.startsWith('mcp:') ? 'MCP server' : event.key.startsWith('agent:') ? 'Agent' : 'Skill');
/** Rows are grouped by day (day headings); each row shows its time, every row in one form (model.ts timesApart). */
const day = (iso: string) => {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) return 'Today';
  if (date.toDateString() === new Date(Date.now() - DAY_MS).toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};
/** What a profile's or the base instructions' Undo will do, said before the click. */
const actionHelp = (event: HistoryEvent) => (event.kind === 'profile' ? `Each switch this changed goes back, where it is still as this left it; ${event.profile?.fromName ?? NO_PROFILE} is in use again if this switch is the one that chose the profile in use`
  : 'Put the base instructions back as they were before this Pull, and in the tools that got them (where their file is unchanged since)');

/** A library entry's buttons (historyactions.ts): its own action, and one "Use <harness>’s copy" for each copy that gave way. */
function libraryButtons(event: HistoryEvent) {
  const entry = libraryEntry(event)!, item = itemOf(event);
  // A skill's own switches as the page last read them, so an action that would change nothing there is not offered.
  const loads = entry.kind === 'skills' ? state.home?.skills.items.find(row => row.key === entry.key)?.loads : undefined;
  const own = libraryAction(event, item, undefined, loads);
  const link = (label: string, help: string, id: string, version?: string) => {
    const control = button({ variant: 'link', size: 'small', label, name: `${label} (${event.item}): ${help}`, id, disabled: !!state.busy, onclick: () => void restoreEvent(event.id, version) });
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

/** A profile's or the base instructions' Undo (or Redo), naming what it undoes: "Undo switch", or "Undo in Claude Code and Codex". */
function actions(event: HistoryEvent, action?: string) {
  if (!action) return h('span');
  // A base no tool gets is undone in Central Knot alone, so its Undo names no tools.
  const scope = event.base?.list.tools.length ? `in ${touchedToolsPhrase(event.base.list.tools)}` : '';
  const label = event.kind === 'profile' ? `${action} switch` : `${action} ${scope}`.trim();
  const control = button({ variant: 'link', size: 'small', label, name: `${label} ${event.item}: ${actionHelp(event)}`, id: `history-${event.id}`, disabled: !!state.busy, onclick: () => void restoreEvent(event.id) });
  control.title = actionHelp(event);
  return control;
}

/** How long History keeps things, with the way to change it. */
const keptFor = () => state.historyDays
  ? [` Kept for ${state.historyDays} days. `, h('span.keep-together', {}, 'Change in ', h('button.inline-link', { type: 'button', id: 'history-intro-settings', onclick: () => showPage('settings') }, 'Settings'), '.')]
  : [];

export function historyPage() {
  // From History's own read (pagedata.ts): what it found, else that it is reading or could not read.
  const events = state.history.data;
  if (!events) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.history.state === 'failed' ? 'History could not be read.' : 'Reading History…')));
  if (!events.length && noTools()) return h('div.page', {}, noToolsState('history-choose-home'));
  if (!events.length) return h('div.page', {}, state.outcome?.page === 'history' ? h('div.bands', {}, outcomeBand()) : null, emptyState('history', 'No changes yet', 'When sync copies an edit, or turning something on adds or replaces a copy, it shows up here with Undo. Turn a skill on to begin.', button({ variant: 'outline', label: 'Start in Skills', id: 'history-go-skills', onclick: () => showPage('skills') })));
  const ordered = [...events].reverse(), times = timesApart(ordered.map(event => event.at));
  const reread = rereadBand(state.history);
  // A refused Undo made here is a warning band, as on the other pages; other results here are in the status bar.
  const refused = state.outcome?.page === 'history' && state.outcome.warn ? outcomeBand(false) : null;
  return h('div.page', {}, reread || refused ? h('div.bands', {}, reread, refused) : null, h('div.scroll', { id: 'history-scroll' }, h('p.history-intro', {}, `What sync, your switches, Pull and profile switches changed in your tools, newest first. Undo puts the earlier version back; Restore brings back what was deleted or removed.`, ...keptFor()), h('ul.history-list', {}, ordered.flatMap((event, index) => {
    const about = describe(event);
    const heading = index === 0 || day(ordered[index - 1].at) !== day(event.at) ? h('li.history-day', { role: 'presentation' }, day(event.at)) : null;
    // The newest row, made by a click just now, gets the same brief highlight the tables use.
    const fresh = index === 0 && Date.now() - Date.parse(event.at) < 8000;
    return [heading, h(`li.history-row${event.undoneBy ? '.history-undone' : ''}${fresh ? '.row-flash' : ''}`, { 'data-kind': event.kind },
      h('span.history-when', { title: new Date(event.at).toLocaleString() }, times[index]),
      // What changed, then what happened in the flexible column (its text capped at the reading measure); the actions keep a
      // steady column at the right, the same on every row. Narrow, what happened takes a line of its own beneath (style.css).
      h('span.history-what', {}, icon(about.glyph, 14, 'tone-muted'), h('span.history-kind', {}, kindOf(event)), h('strong', { title: event.item }, event.item)),
      h('span.history-about', {}, about.text),
      event.undoneBy ? h('span.history-actions', {}, h('span.history-done', {}, libraryEntry(event) ? doneWords(event) : event.kind === 'removed' ? 'Restored' : 'Undone'))
        : h('span.history-actions', {},
          !event.base && (event.kind === 'edit' || event.kind === 'conflict') ? seeChangeLink(event.id, event.key, true) : null,
          libraryEntry(event) ? libraryButtons(event) : actions(event, about.action)),
      changePanel(event.id))];
  }))));
}
