// History: what sync did on its own, newest first, with Undo or Restore where the kept content allows it (CON-02, DEL-03).
import { restoreEvent, state } from './app.ts';
import { button, emptyState, h, icon } from './dom.ts';
import type { IconName } from './icons.ts';
import type { HistoryEvent } from './types.ts';

const names: Record<string, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };
const who = (tool?: string) => (tool ? names[tool] ?? tool : 'Central Knot');
const list = (tools: string[]) => [...new Set(tools)].map(who).join(' and ');

function describe(event: HistoryEvent): { glyph: IconName; text: string; action?: string } {
  const order = event.orderProved ? '' : ' Order not proved; the fixed tool order decided.';
  switch (event.kind) {
    case 'edit': return { glyph: 'pencil-line', text: `${who(event.winner?.tool)}'s edit spread to ${list(event.losers.map(loser => loser.tool)) || 'the others'}.`, action: 'Undo' };
    case 'conflict': return { glyph: 'diff', text: `${who(event.winner?.tool)}'s edit won over ${list(event.losers.filter(loser => loser.hash !== event.previous).map(loser => loser.tool))}'s.${order}`, action: 'Undo' };
    case 'deleted': return { glyph: 'circle-minus', text: `Deleted${event.winner ? ` in ${who(event.winner.tool)}` : ''}, and removed from every tool it synced to.`, action: 'Restore' };
    case 'kept-edit': return { glyph: 'diff', text: `${who(event.winner?.tool)}'s edit was kept over a deletion in ${list(event.losers.map(loser => loser.tool))}.${order}` };
    case 'restored': return { glyph: 'undo-2', text: 'Restored from History.' };
  }
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function historyPage() {
  const events = state.history;
  if (!events) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.busy ? 'Reading History…' : 'History could not be read.')));
  if (!events.length) return h('div.page', {}, emptyState('history', 'Nothing yet', 'When sync spreads an edit, settles competing edits or spreads a deletion on its own, it shows here, with Undo or Restore.'));
  return h('div.page', {}, h('div.scroll', { id: 'history-scroll' }, h('ul.history-list', {}, [...events].reverse().map(event => {
    const about = describe(event);
    return h('li.history-row', { 'data-kind': event.kind },
      h('span.history-when', {}, when(event.at)),
      h('span.history-what', {}, icon(about.glyph, 14, 'tone-muted'), h('strong', {}, event.item), h('span', {}, about.text)),
      event.undoneBy ? h('span.history-done', {}, 'Undone') : about.action
        ? button({ variant: 'outline', size: 'small', label: about.action, name: `${about.action} ${event.item}`, id: `history-${event.id}`, disabled: !!state.busy, onclick: () => void restoreEvent(event.id) })
        : h('span'));
  }))));
}
