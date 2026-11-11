// History: what sync did on its own, newest first, with Undo or Restore where the kept content allows it (CON-02, DEL-03).
import { clockTime, DAY_MS } from './model.ts';
import { noTools, restoreEvent, showPage, shownPath, state, touchedToolsPhrase } from './app.ts';
import { noToolsState } from './pages.ts';
import { andList, toolName } from './words.ts';
import { tookOverHistory } from './outsidewords.ts';
import { changedProfile, flipSummary, NO_PROFILE, redoneSwitch } from './profileplan.ts';
import { changePanel, outcomeBand, seeChangeLink } from './matrix.ts';
import { button, emptyState, h, icon, rereadBand } from './dom.ts';
import type { IconName } from './icons.ts';
import type { HistoryEvent } from './types.ts';

const who = (tool?: string) => (tool ? toolName(tool) : 'Central Knot');

function describe(event: HistoryEvent): { glyph: IconName; text: string; action?: string } {
  const order = event.orderProved ? '' : ' Order not proved; the fixed tool order decided.';
  // A Pull's edit or deletion of the base instructions: said as the pull, undone or not.
  if (event.base) return pulledBase(event, event.base.list.tools.length ? touchedToolsPhrase(event.base.list.tools) : '');
  // Pull from the git repo: said as a pull, whichever way sync carried it.
  if (event.via === 'repo' && !event.undoneBy) {
    if (event.kind === 'deleted') return { glyph: 'git-branch', text: 'Removed in the git repo, so Pull deleted it from the tools it synced to.', action: 'Restore' };
    if (event.kind === 'chosen') return { glyph: 'git-branch', text: `Pulled from the git repo; it replaced the copy in ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}.`, action: 'Undo' };
    if (event.kind === 'edit') return { glyph: 'git-branch', text: `Pulled from the git repo into ${who(event.winner?.tool)}${event.losers.length ? `, then copied to ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}` : ''}.`, action: 'Undo' };
    if (event.kind === 'added') return { glyph: 'git-branch', text: `Pulled from the git repo and added to ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}.`, action: 'Undo add' };
  }
  switch (event.kind) {
    case 'edit': return { glyph: 'pencil-line', text: `Edited in ${who(event.winner?.tool)}, then copied to ${touchedToolsPhrase(event.losers.map(loser => loser.tool)) || 'the others'}.`, action: 'Undo' };
    case 'conflict': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit won over ${andList(event.losers.filter(loser => loser.hash !== event.previous).map(loser => who(loser.tool)))}’s.${order}`, action: 'Undo' };
    case 'deleted': return { glyph: 'trash-2', text: `Deleted${event.winner ? ` in ${who(event.winner.tool)}` : ''}, then removed from the other tools it synced to.`, action: 'Restore' };
    case 'kept-edit': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit was kept over a deletion in ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}.${order}` };
    case 'chosen': return { glyph: 'check', text: `You chose ${who(event.winner?.tool)}’s copy; it replaced ${andList(event.losers.map(loser => who(loser.tool)))}’s.`, action: 'Undo' };
    case 'switched': {
      const turned = (disabled: boolean) => touchedToolsPhrase((event.switched ?? []).filter(entry => entry.disabled === disabled).map(entry => entry.tool));
      const switched = event.switched ?? [];
      const text = [switched.some(entry => entry.disabled) && `disabled in ${turned(true)}`, switched.some(entry => !entry.disabled) && `enabled in ${turned(false)}`].filter(Boolean).join('; ');
      const one = switched.length === 1 ? who(switched[0].tool) : undefined;
      return { glyph: 'circle-off', text: `${text.charAt(0).toUpperCase()}${text.slice(1)}, using ${one ? `${one}’s` : 'each tool’s'} own switch.`, action: 'Undo' };
    }
    case 'profile': return profileSwitch(event);
    case 'removed': return { glyph: 'circle-minus', text: `Removed from ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}; Central Knot kept the ${event.losers.length === 1 ? 'copy' : 'copies'}.`, action: 'Restore' };
    case 'took-over': return { glyph: 'arrow-down-to-line', text: tookOverText(event, !!event.undoneBy), action: 'Undo' };
    case 'added': return { glyph: 'plus', text: event.undoneBy ? `Apply all started managing it and added copies to ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}; they were removed again.` : `Apply all started managing it and added ${event.losers.length === 1 ? 'a copy' : 'copies'} to ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}.`, action: 'Undo add' };
    case 'restored': {
      // Name the change this undid, so Redo says what comes back.
      const undone = state.history.data?.find(other => other.undoneBy === event.id);
      const named = (past: HistoryEvent) => ({ edit: `${who(past.winner?.tool)}’s edit`, conflict: `${who(past.winner?.tool)}’s winning edit`, deleted: 'the deletion', 'kept-edit': 'the kept edit', chosen: `your choice of ${who(past.winner?.tool)}’s copy`, restored: 'an undo', added: 'the copies Apply all added', switched: 'the switch', removed: 'the removal' , profile: 'the profile switch', 'took-over': 'the take-over' } as const)[past.kind];
      const where = event.losers.length ? ` in ${touchedToolsPhrase([...event.losers.map(loser => loser.tool), ...(event.winner ? [event.winner.tool] : [])])}` : '';
      // Undoing an undo is a redo: say what came back, and offer to take it away again.
      if (undone?.kind === 'restored') {
        const first = state.history.data?.find(other => other.undoneBy === undone.id);
        return { glyph: 'undo-2', text: `Redid ${first ? named(first) : 'the change'}; it is back${where}.`, action: first?.kind === 'deleted' ? 'Restore' : 'Undo edit' };
      }
      if (undone?.kind === 'removed') return { glyph: 'undo-2', text: `Restored${where}.` };
      if (undone?.kind === 'deleted') return { glyph: 'undo-2', text: `Restored after it was deleted${where}.`, action: 'Delete again' };
      return { glyph: 'undo-2', text: `Undid ${undone ? named(undone) : 'a change'}; the earlier version is back${where}.`, action: 'Redo edit' };
    }
  }
}

/** A take-over, said as what it did to which folder: links replaced by real copies, tools given their own, the shared copy removed. */
function tookOverText(event: HistoryEvent, undone: boolean): string {
  const told = event.tookOver;
  if (!told) return 'Took over its copies outside Central Knot.';
  // The same words as the Skills page (outsidewords.ts), and the folder through the same path-shortening ("~/.agents/skills").
  const text = tookOverHistory(told.links.filter(link => link.placed).map(link => who(link.tool)), told.placed.map(copy => who(copy.tool)), told.shared.length ? shownPath(told.shared[0].path.replace(/\/[^/]+$/, '')) : undefined);
  return `${text}${undone ? '; this was undone, and they are back as they were.' : '. Central Knot kept what it replaced.'}`;
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
/** The overwritten edits a skill conflict or kept edit can put back, one per content (mirrors restorableChoices in manage.ts). */
function choices(event: HistoryEvent) {
  if (event.key.startsWith('mcp:') || (event.kind !== 'conflict' && event.kind !== 'kept-edit')) return [];
  const seen = new Set<string>();
  return event.losers.filter(loser => loser.hash && loser.hash !== event.previous && loser.hash !== event.winner?.hash && !seen.has(loser.hash) && seen.add(loser.hash));
}

/** Rows are grouped by day; each row shows its time, or "Just now". */
const time = (iso: string) => (Date.now() - Date.parse(iso) < 60_000 ? 'just now' : clockTime(iso));
const day = (iso: string) => {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) return 'Today';
  if (date.toDateString() === new Date(Date.now() - DAY_MS).toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};
/** What an Undo, Redo or Restore button will do, said before the click. */
const actionHelp = (event: HistoryEvent, action: string) => (event.kind === 'profile' ? `Each switch this changed goes back, where it is still as this left it; ${event.profile?.fromName ?? NO_PROFILE} is in use again if this switch is the one that chose the profile in use`
  : event.base ? 'Put the base instructions back as they were before this Pull, and in the tools that got them (where their file is unchanged since)'
  : event.kind === 'switched' ? (event.switched ?? []).map(entry => `${entry.disabled ? 'Enable' : 'Disable'} it again in ${who(entry.tool)}`).join('; ')
  : event.kind === 'removed' ? `Put the removed copy back in ${touchedToolsPhrase(event.losers.map(loser => loser.tool))}`
  : event.kind === 'took-over' ? `Put the links and the shared copy back as they were${event.tookOver?.managedNow ? `, remove the copies that Apply all added, and stop managing ${event.item}` : ''} (only while unchanged)`
  : event.kind === 'added' ? `Remove the copies ${event.via === 'repo' ? 'Pull' : 'Apply all'} added (only while unchanged) and stop managing ${event.item}` : action === 'Restore' ? `Put ${event.item} back in every tool it synced to`
  : action === 'Redo edit' || action === 'Delete again' ? 'Undo the undo: put back the version that was replaced'
    : `Put ${event.item} back as it was before this change, in every tool it syncs to (including where it was edited)`);

/** Undo or Restore; with several overwritten edits, one button per edit, so each can be put back. */
function actions(event: HistoryEvent, action?: string) {
  const options = choices(event);
  if (options.length > 1 || (event.kind === 'kept-edit' && options.length)) {
    return h('span.history-actions', {}, options.map(option => button({ variant: 'outline', size: 'small', label: `Use ${who(option.tool)}’s`, name: `Use ${who(option.tool)}’s edit of ${event.item}`, id: `history-${event.id}-${option.tool}`, disabled: !!state.busy, onclick: () => void restoreEvent(event.id, option.hash) })));
  }
  if (!action) return h('span');
  // The scope is the tools the event touched, as the notices say it.
  // Undo and Restore write the earlier version to every tool the item syncs to (restoreFromHistory), so they say "in all tools".
  // Only an 'added' undo is narrower: it removes the copies Apply all (or Pull) added, in those tools alone.
  const touched = event.base ? event.base.list.tools : event.kind === 'added' || event.kind === 'removed' ? [...new Set(event.losers.map(loser => loser.tool))] : event.kind === 'switched' ? (event.switched ?? []).map(entry => entry.tool) : [];
  // A base no tool gets is undone in Central Knot alone, so its Undo names no tools.
  const scope = touched.length ? `in ${touchedToolsPhrase(touched)}` : event.base ? '' : 'in all tools';
  // A switch's Undo says that it is one, and what it does: enable where it was disabled, disable where it was enabled.
  const flips = new Set((event.switched ?? []).map(entry => entry.disabled));
  const verb = action === 'Undo' && event.via === 'repo' ? 'Undo pull' : action === 'Undo' && event.kind === 'edit' ? 'Undo edit' : action === 'Undo' && event.kind === 'chosen' ? 'Undo choice'
    : event.kind === 'switched' && flips.size === 1 ? (flips.has(true) ? 'Undo: enable' : 'Undo: disable') : action;
  const label = event.kind === 'profile' ? `${action} switch` : ['Undo', 'Undo edit', 'Restore', 'Delete again', 'Redo edit'].includes(action) ? `${verb} ${scope}`.trim() : action;
  const control = button({ variant: 'link', size: 'small', label, name: `${label} ${event.item}: ${actionHelp(event, action)}`, id: `history-${event.id}`, disabled: !!state.busy, onclick: () => void restoreEvent(event.id) });
  control.title = actionHelp(event, action);
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
  if (!events.length) return h('div.page', {}, state.outcome?.page === 'history' ? h('div.bands', {}, outcomeBand()) : null, emptyState('history', 'No changes yet', 'When sync copies an edit, or Apply all adds or replaces a copy, it shows up here with Undo. Turn on Managed for a skill to begin.', button({ variant: 'outline', label: 'Start in Skills', id: 'history-go-skills', onclick: () => showPage('skills') })));
  const ordered = [...events].reverse();
  const reread = rereadBand(state.history);
  return h('div.page', {}, reread ? h('div.bands', {}, reread) : null, h('div.scroll', { id: 'history-scroll' }, h('p.history-intro', {}, `What sync, Apply all, Pull and profile switches changed in your tools, newest first. Undo puts the earlier version back${ordered.some(event => event.kind === 'removed') ? '; Restore puts a removed copy back' : ''}.`, ...keptFor()), h('ul.history-list', {}, ordered.flatMap((event, index) => {
    const about = describe(event);
    const heading = index === 0 || day(ordered[index - 1].at) !== day(event.at) ? h('li.history-day', { role: 'presentation' }, day(event.at)) : null;
    // The newest row, made by a click just now, gets the same brief highlight the tables use.
    const fresh = index === 0 && Date.now() - Date.parse(event.at) < 8000;
    return [heading, h(`li.history-row${event.undoneBy ? '.history-undone' : ''}${fresh ? '.row-flash' : ''}`, { 'data-kind': event.kind },
      h('span.history-when', { title: new Date(event.at).toLocaleString() }, time(event.at)),
      // What changed, then what happened in the flexible column (its text capped at the reading measure); the actions keep a
      // steady column at the right, the same on every row. Narrow, what happened takes a line of its own beneath (style.css).
      h('span.history-what', {}, icon(about.glyph, 14, 'tone-muted'), h('span.history-kind', {}, kindOf(event)), h('strong', { title: event.item }, event.item)),
      h('span.history-about', {}, about.text),
      event.undoneBy ? h('span.history-actions', {}, h('span.history-done', {}, event.kind === 'removed' ? 'Restored' : 'Undone'))
        : h('span.history-actions', {}, !event.base && (event.kind === 'edit' || event.kind === 'conflict') ? seeChangeLink(event.id, event.key, true) : null, actions(event, about.action)),
      changePanel(event.id))];
  }))));
}
