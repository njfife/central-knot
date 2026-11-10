// History: what sync did on its own, newest first, with Undo or Restore where the kept content allows it (CON-02, DEL-03).
import { clockTime } from './model.ts';
import { restoreEvent, showPage, state, presentCount } from './app.ts';
import { toolNames } from './words.ts';
import { flipSummary, NO_PROFILE } from './profileplan.ts';
import { changePanel, outcomeBand, seeChangeLink } from './matrix.ts';
import { button, emptyState, h, icon } from './dom.ts';
import type { IconName } from './icons.ts';
import type { HistoryEvent } from './types.ts';

const names = toolNames as Record<string, string>;
const who = (tool?: string) => (tool ? names[tool] ?? tool : 'Central Knot');
const list = (tools: string[]) => {
  const all = [...new Set(tools)].map(who);
  if (all.length > 2 && all.length >= presentCount()) return `all ${all.length} tools`;
  return all.length > 2 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : all.join(' and ');
};

function describe(event: HistoryEvent): { glyph: IconName; text: string; action?: string } {
  const order = event.orderProved ? '' : ' Order not proved; the fixed tool order decided.';
  switch (event.kind) {
    case 'edit': return { glyph: 'pencil-line', text: `Edited in ${who(event.winner?.tool)}, then copied to ${list(event.losers.map(loser => loser.tool)) || 'the others'}.`, action: 'Undo' };
    case 'conflict': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit won over ${list(event.losers.filter(loser => loser.hash !== event.previous).map(loser => loser.tool))}’s.${order}`, action: 'Undo' };
    case 'deleted': return { glyph: 'trash-2', text: `Deleted${event.winner ? ` in ${who(event.winner.tool)}` : ''}, then removed from the other tools it synced to.`, action: 'Restore' };
    case 'kept-edit': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit was kept over a deletion in ${list(event.losers.map(loser => loser.tool))}.${order}` };
    case 'chosen': return { glyph: 'check', text: `You chose ${who(event.winner?.tool)}’s copy; it replaced ${list(event.losers.map(loser => loser.tool))}’s.`, action: 'Undo' };
    case 'switched': {
      const turned = (disabled: boolean) => list((event.switched ?? []).filter(entry => entry.disabled === disabled).map(entry => entry.tool));
      const text = [turned(true) && `disabled in ${turned(true)}`, turned(false) && `enabled in ${turned(false)}`].filter(Boolean).join('; ');
      return { glyph: 'circle-off', text: `${text.charAt(0).toUpperCase()}${text.slice(1)}, with ${(event.switched ?? []).length === 1 ? 'that tool’s' : 'each tool’s'} own switch.`, action: 'Undo' };
    }
    case 'profile': return profileSwitch(event);
    case 'removed': return { glyph: 'trash-2', text: `Removed from ${list(event.losers.map(loser => loser.tool))}; Central Knot kept the ${event.losers.length === 1 ? 'copy' : 'copies'}.`, action: 'Restore' };
    case 'added': return { glyph: 'plus', text: event.undoneBy ? `Apply all started managing it and added copies to ${list(event.losers.map(loser => loser.tool))}; they were removed again.` : `Apply all started managing it and added ${event.losers.length === 1 ? 'a copy' : 'copies'} to ${list(event.losers.map(loser => loser.tool))}.`, action: 'Undo add' };
    case 'restored': {
      // Name the change this undid, so Redo says what comes back.
      const undone = state.history?.find(other => other.undoneBy === event.id);
      const named = (past: HistoryEvent) => ({ edit: `${who(past.winner?.tool)}’s edit`, conflict: `${who(past.winner?.tool)}’s winning edit`, deleted: 'the deletion', 'kept-edit': 'the kept edit', chosen: `your choice of ${who(past.winner?.tool)}’s copy`, restored: 'an undo', added: 'the copies Apply all added', switched: 'the switch', removed: 'the removal', profile: 'the profile switch' } as const)[past.kind];
      const where = event.losers.length ? ` in ${list([...event.losers.map(loser => loser.tool), ...(event.winner ? [event.winner.tool] : [])])}` : '';
      // Undoing an undo is a redo: say what came back, and offer to take it away again.
      if (undone?.kind === 'restored') {
        const first = state.history?.find(other => other.undoneBy === undone.id);
        return { glyph: 'undo-2', text: `Redid ${first ? named(first) : 'the change'}; it is back${where}.`, action: first?.kind === 'deleted' ? 'Restore' : 'Undo edit' };
      }
      if (undone?.kind === 'removed') return { glyph: 'undo-2', text: `Put back${where || ` in ${who(event.winner?.tool)}`} after its removal.` };
      if (undone?.kind === 'deleted') return { glyph: 'undo-2', text: `Restored after its deletion; back${where}.`, action: 'Delete again' };
      return { glyph: 'undo-2', text: `Undid ${undone ? named(undone) : 'a change'}; the earlier version is back${where}.`, action: 'Redo edit' };
    }
  }
}

/** A profile switch: what it switched to, and how many items it turned off and on, where. An undo says what it undid. */
function profileSwitch(event: HistoryEvent): { glyph: IconName; text: string; action: string } {
  const switched = event.profile!;
  // Said as the result of the switch said it.
  const counts = flipSummary(switched.flips) || 'no switch needed changing';
  const undid = state.history?.find(other => other.undoneBy === event.id);
  const to = switched.toName ?? NO_PROFILE;
  // A redo undoes an undo: it makes that switch again, and its own Undo undoes it once more.
  const redid = undid && state.history?.some(other => other.undoneBy === undid.id);
  if (undid?.kind === 'profile' && redid) return { glyph: 'sliders-horizontal', text: `Switched to ${to} again: ${counts}.`, action: 'Undo' };
  if (undid?.kind === 'profile') return { glyph: 'undo-2', text: `Undid the switch to ${undid.profile?.toName ?? NO_PROFILE}; back to ${to}: ${counts}.`, action: 'Redo' };
  // Apply to tools: the profile in use, made to match again.
  if ((switched.from ?? '') === (switched.to ?? '')) return { glyph: 'sliders-horizontal', text: `Applied ${to} to tools again: ${counts}.`, action: 'Undo' };
  return { glyph: 'sliders-horizontal', text: `Switched${switched.fromName ? ` from ${switched.fromName}` : ''} to ${to}: ${counts}.`, action: 'Undo' };
}

/** Skills, MCP servers, agents and profile switches share History; each row says which it is. */
const kindOf = (event: HistoryEvent) => (event.kind === 'profile' ? 'Profile' : event.key.startsWith('mcp:') ? 'MCP server' : event.key.startsWith('agent:') ? 'Agent' : 'Skill');
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
  if (date.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};
/** What an Undo, Redo or Restore button will do, said before the click. */
const actionHelp = (event: HistoryEvent, action: string) => (event.kind === 'profile' ? `Each switch this changed goes back, where it is still as this left it; ${event.profile?.fromName ?? NO_PROFILE} is in use again if this switch is the one that chose the profile in use`
  : event.kind === 'switched' ? (event.switched ?? []).map(entry => `${entry.disabled ? 'Enable' : 'Disable'} it again in ${who(entry.tool)}`).join('; ')
  : event.kind === 'removed' ? `Put the removed copy back in ${list(event.losers.map(loser => loser.tool))}`
  : event.kind === 'added' ? `Remove the copies Apply all added (only while unchanged) and stop managing ${event.item}` : action === 'Restore' ? `Put ${event.item} back in every tool it synced to`
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
  // Only an 'added' undo is narrower: it removes the copies Apply all added, in those tools alone.
  const touched = event.kind === 'added' || event.kind === 'removed' ? [...new Set(event.losers.map(loser => loser.tool))] : event.kind === 'switched' ? (event.switched ?? []).map(entry => entry.tool) : [];
  const scope = !touched.length || touched.length >= presentCount() ? 'in all tools' : `in ${touched.map(who).join(' and ')}`;
  const verb = action === 'Undo' && event.kind === 'edit' ? 'Undo edit' : action === 'Undo' && event.kind === 'chosen' ? 'Undo choice' : action;
  const label = event.kind === 'profile' ? `${action} switch` : ['Undo', 'Undo edit', 'Restore', 'Delete again', 'Redo edit'].includes(action) ? `${verb} ${scope}` : action;
  const control = button({ variant: 'link', size: 'small', label, name: `${label} ${event.item}: ${actionHelp(event, action)}`, id: `history-${event.id}`, disabled: !!state.busy, onclick: () => void restoreEvent(event.id) });
  control.title = actionHelp(event, action);
  return control;
}

export function historyPage() {
  const events = state.history;
  if (!events) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading History…' : 'History could not be read.')));
  if (!events.length) return h('div.page', {}, state.outcome?.page === 'history' ? h('div.bands', {}, outcomeBand()) : null, emptyState('history', 'No changes yet', 'When sync copies an edit, or Apply all adds or replaces a copy, it shows up here with Undo. Turn on Managed for a skill to begin.', button({ variant: 'outline', label: 'Start in Skills', id: 'history-go-skills', onclick: () => showPage('skills') })));
  const ordered = [...events].reverse();
  // The row's own button redoes; the band only confirms.
  // The new top row says what happened (and the announcement reads it out); a band repeating it would say it twice.
  const done = null;
  return h('div.page', {}, done, h('div.scroll', { id: 'history-scroll' }, h('p.history-intro', {}, 'What sync, Apply all and profile switches changed in your tools, newest first. Undo puts the earlier version back.'), h('ul.history-list', {}, ordered.flatMap((event, index) => {
    const about = describe(event);
    const heading = index === 0 || day(ordered[index - 1].at) !== day(event.at) ? h('li.history-day', { role: 'presentation' }, day(event.at)) : null;
    // The newest row, made by a click just now, gets the same brief highlight the tables use.
    const fresh = index === 0 && Date.now() - Date.parse(event.at) < 8000;
    return [heading, h(`li.history-row${event.undoneBy ? '.history-undone' : ''}${fresh ? '.row-flash' : ''}`, { 'data-kind': event.kind },
      h('span.history-when', { title: new Date(event.at).toLocaleString() }, time(event.at)),
      h('span.history-what', {}, icon(about.glyph, 14, 'tone-muted'), h('span.history-kind', {}, kindOf(event)), h('strong', { title: event.item }, event.item), h('span', {}, about.text)),
      event.undoneBy ? h('span.history-done', {}, 'Undone') : h('span.history-actions', {}, event.kind === 'edit' || event.kind === 'conflict' ? seeChangeLink(event.id, event.key, true) : null, actions(event, about.action)),
      changePanel(event.id))];
  }))));
}
