// History: what sync did on its own, newest first, with Undo or Restore where the kept content allows it (CON-02, DEL-03).
import { clockTime, DAY_MS } from './model.ts';
import { offered, unfinished, type EntryAction } from './historyactions.ts';
import { entryIs, heldCopies } from './historyrules.ts';
import { homeTools, noTools, restoreEvent, showPage, shownPath, state, touchedToolsPhrase, unwriteClaudeNow } from './app.ts';
import { noToolsState } from './pages.ts';
import { andList, toolName } from './words.ts';
import { tookOverHistory } from './outsidewords.ts';
import { changedProfile, flipSummary, NO_PROFILE, redoneSwitch } from './profileplan.ts';
import { changePanel, outcomeBand, seeChangeLink } from './matrix.ts';
import { button, emptyState, h, icon, rereadBand } from './dom.ts';
import { OFF_KEPT } from './settingspage.ts';
import type { IconName } from './icons.ts';
import type { HistoryEvent } from './types.ts';

const who = (tool?: string) => (tool ? toolName(tool) : 'Central Knot');

/**
 * What a row says happened, by what the entry is (historyrules.ts entryIs). Its action, or the state shown in its place, is the
 * action table's (historyactions.ts offered); this is only the sentence.
 */
function describe(event: HistoryEvent): { glyph: IconName; text: string } {
  const events = state.history.data ?? [];
  const order = event.orderProved ? '' : ' Order not proved; the fixed tool order decided.';
  const where = (tools: string[]) => touchedToolsPhrase(tools);
  const losers = event.losers.map(loser => loser.tool);
  const is = entryIs(event, events);
  switch (is) {
    // A Pull's edit or deletion of the base instructions: said as the pull, undone or not.
    case 'pulled-base': return pulledBase(event, event.base!.list.tools.length ? where(event.base!.list.tools) : '');
    // Pull from the git repo: said as a pull, whichever way sync carried it.
    case 'pulled-deletion': return { glyph: 'git-branch', text: 'Removed in the git repo, so Pull deleted it from the tools it synced to.' };
    case 'pulled-choice': return { glyph: 'git-branch', text: `Pulled from the git repo; it replaced the copy in ${where(losers)}.` };
    case 'pulled-edit': return { glyph: 'git-branch', text: `Pulled from the git repo into ${who(event.winner?.tool)}${losers.length ? `, then copied to ${where(losers)}` : ''}.` };
    case 'pulled-add': return { glyph: 'git-branch', text: `Pulled from the git repo and added to ${where(losers)}.` };
    case 'edit': return { glyph: 'pencil-line', text: `Edited in ${who(event.winner?.tool)}, then copied to ${where(losers) || 'the others'}.` };
    case 'conflict': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit won over ${andList(event.losers.filter(loser => loser.hash !== event.previous).map(loser => who(loser.tool)))}’s.${order}` };
    case 'deletion': return { glyph: 'trash-2', text: `Deleted${event.winner ? ` in ${who(event.winner.tool)}` : ''}, then removed from the other tools it synced to.` };
    case 'delete-everywhere': return { glyph: 'trash-2', text: losers.length ? `Deleted everywhere; Central Knot kept the ${losers.length === 1 ? 'copy' : 'copies'}.` : 'Deleted everywhere while it was off. Restore puts it back on its page, off.' };
    case 'kept-edit': return { glyph: 'diff', text: `${who(event.winner?.tool)}’s edit was kept over a deletion in ${where(losers)}.${order}` };
    case 'choice': case 'agent-choice': return { glyph: 'check', text: `You chose ${who(event.winner?.tool)}’s copy; it replaced ${andList(losers.map(who))}’s.` };
    // Its Undo stopped part-way: what went back, and what is still to go, for its Finish undo.
    case 'unfinished-choice': return { glyph: 'check', text: `You chose ${who(event.winner?.tool)}’s copy; it replaced ${andList(losers.map(who))}’s. ${unfinished(event, events, homeTools())}` };
    case 'kept-copy': return { glyph: 'check', text: `You used the copy kept when it was turned off in ${who(event.winner?.tool)}${losers.length ? '; it replaced the copy there, which Central Knot kept' : ', which had no copy'}.` };
    case 'switch': {
      const switched = event.switched ?? [];
      const turned = (disabled: boolean) => where(switched.filter(entry => entry.disabled === disabled).map(entry => entry.tool));
      const text = [switched.some(entry => entry.disabled) && `turned off in ${turned(true)}`, switched.some(entry => !entry.disabled) && `turned on in ${turned(false)}`].filter(Boolean).join('; ');
      const one = switched.length === 1 ? who(switched[0].tool) : undefined;
      return { glyph: 'circle-off', text: `${text.charAt(0).toUpperCase()}${text.slice(1)}, using ${one ? `${one}’s` : 'each tool’s'} own switch.` };
    }
    case 'profile': return profileSwitch(event);
    // Turned off where a tool has no switch: History keeps it until it is turned on again or deleted.
    case 'off': return { glyph: 'circle-off', text: offText(event) };
    case 'removal': return { glyph: 'circle-minus', text: `Removed from ${where(losers)}; Central Knot kept the ${losers.length === 1 ? 'copy' : 'copies'}.` };
    case 'take-over': return { glyph: 'arrow-down-to-line', text: tookOverText(event, !!event.undoneBy) };
    case 'write': return { glyph: 'pencil-line', text: 'Write to Claude Code replaced Claude Code’s own entry with the synced one; Central Knot kept it.' };
    case 'add': {
      const what = event.via === 'repo' ? 'Pull' : event.rejoined ? 'Syncing it there again' : 'Turning it on';
      return { glyph: 'plus', text: event.undoneBy ? `${what} added copies to ${where(losers)}; they were removed again.` : `${what} added ${losers.length === 1 ? 'a copy' : 'copies'} to ${where(losers)}.` };
    }
    case 'on-after-off': case 'delete-everywhere-again': case 'deletion-again': case 'redo': case 'restore-after-removal': case 'undo': return { glyph: 'undo-2', text: restoredText(event, is, events) };
  }
}

/**
 * An Off: where it removed copies, where it only holds a tool again (Turn off again found the tool's own copy there, which
 * stays), and (a mixed item) that a tool has it through a plugin, whose own switch turns it on there.
 */
function offText(event: HistoryEvent): string {
  const removed = event.losers.map(loser => loser.tool), own = (event.turnedUp ?? []).map(copy => copy.tool);
  const held = heldCopies(event).length;
  const kept = `History keeps ${held === 1 ? 'the copy removed from it' : 'the copies removed'} until it is turned on again or deleted.`;
  const back = event.restoredTools?.length ? ` Back on in ${touchedToolsPhrase(event.restoredTools)}.` : '';
  const row = [...(state.home?.agents.servers ?? []), ...(state.home?.agents.gone ?? [])].find(fact => `agent:${fact.key}` === event.key);
  const plugins = Object.keys(row?.plugin ?? {});
  const plugin = event.key.startsWith('agent:') && plugins.length ? ` ${andList(plugins.map(toolName))} ${plugins.length === 1 ? 'has' : 'have'} it through a plugin: its plugin switch there turns it on or off.` : '';
  const leftAlone = own.length ? `${andList(own.map(tool => `${who(tool)}’s`))} own ${own.length === 1 ? 'copy stays there' : 'copies stay there'}, left alone` : '';
  const what = !removed.length ? `Turned off again: ${leftAlone}.`
    : `Turned off: removed from ${touchedToolsPhrase(removed)}, which ${removed.length === 1 ? 'has' : 'have'} no switch for it${leftAlone ? `; ${leftAlone}` : ''}.`;
  return `${what} ${kept}${back}${plugin}`;
}

/** A 'restored' entry, by what it undid: turned on again after an Off, restored after a deletion, a redo, or an earlier version back. */
function restoredText(event: HistoryEvent, is: ReturnType<typeof entryIs>, events: HistoryEvent[]): string {
  const undone = events.find(other => other.undoneBy === event.id);
  const named = (past: HistoryEvent) => ({ edit: `${who(past.winner?.tool)}’s edit`, conflict: `${who(past.winner?.tool)}’s winning edit`, deleted: 'the deletion', 'kept-edit': 'the kept edit', chosen: `your choice of ${who(past.winner?.tool)}’s copy`, restored: 'an undo', added: 'the copies it added', switched: 'the switch', removed: 'the removal', profile: 'the profile switch', 'took-over': 'the take-over', written: 'the write' } as const)[past.kind];
  const where = event.losers.length ? ` in ${touchedToolsPhrase([...event.losers.map(loser => loser.tool), ...(event.winner ? [event.winner.tool] : [])])}` : '';
  switch (is) {
    case 'redo': { const first = events.find(other => other.undoneBy === undone?.id); return `Redid ${first ? named(first) : 'the change'}; it is back${where}.`; }
    case 'on-after-off': {
      const kept = event.turnedUp?.length ? `${event.losers.length ? '; ' : ': '}${touchedToolsPhrase(event.turnedUp.map(loser => loser.tool))} kept the copy that turned up` : '';
      return `Turned on again${event.losers.length ? `: put back${where}` : ''}${kept}.`;
    }
    case 'delete-everywhere-again': case 'deletion-again': return `Restored after it was deleted${where}.`;
    case 'restore-after-removal': return `Restored${where}.`;
    default: return `Undid ${undone ? named(undone) : 'a change'}; the earlier version is back${where}.`;
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
function pulledBase(event: HistoryEvent, tools: string): { glyph: IconName; text: string } {
  if (event.kind === 'deleted') return { glyph: 'git-branch', text: `Deleted in the git repo, so Pull emptied the base instructions${tools ? ` and took them out of ${tools}` : ''}.` };
  const first = !event.base!.text.trim();
  return { glyph: 'git-branch', text: `${first ? 'Added in the git repo, so Pull set' : 'Changed in the git repo, so Pull updated'} the base instructions${tools ? ` in ${tools}` : ''}.` };
}

/** A profile switch: what it switched to, and how many items it turned off and on, where. An undo says what it undid. */
function profileSwitch(event: HistoryEvent): { glyph: IconName; text: string } {
  const switched = event.profile!;
  // Said as the result of the switch said it.
  const counts = flipSummary(switched.flips) || 'no switch needed changing';
  const undid = state.history.data?.find(other => other.undoneBy === event.id);
  const to = switched.toName ?? NO_PROFILE;
  // A redo undoes an undo: it makes that switch again (named by the switch, not the profile in use), and its own Undo undoes it once more.
  const redid = state.history.data && redoneSwitch(state.history.data, event);
  if (redid) return { glyph: 'sliders-horizontal', text: `Redid the switch to ${redid.profile?.toName ?? NO_PROFILE}: ${counts}.` };
  if (undid?.kind === 'profile') return { glyph: 'undo-2', text: `Undid the switch to ${undid.profile?.toName ?? NO_PROFILE}; back to ${to}: ${counts}.` };
  // Apply to tools: the profile in use, made to match again.
  if (!changedProfile(event)) return { glyph: 'sliders-horizontal', text: `Applied ${to} to tools again: ${counts}.` };
  return { glyph: 'sliders-horizontal', text: `Switched${switched.fromName ? ` from ${switched.fromName}` : ''} to ${to}: ${counts}.` };
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
/** One action of a row as its link (the action table's, historyactions.ts); `id`: the row's main action's, or a second one's own. */
function actionLink(event: HistoryEvent, action: EntryAction, id = `history-${event.id}`) {
  const run = () => void (event.kind === 'written' ? unwriteClaudeNow([{ name: event.item, before: event.previous!, after: event.winner!.hash, event: event.id }]) : restoreEvent(event.id, action.how));
  const control = button({ variant: 'link', size: 'small', label: action.label, name: `${action.label} ${event.item}: ${action.help}`, id, disabled: !!state.busy, onclick: run });
  control.title = action.help;
  return control;
}
/** A row's action; with several overwritten edits, one button per edit, so each can be put back. */
function actions(event: HistoryEvent, action: EntryAction | undefined) {
  const options = choices(event);
  if (options.length > 1 || (event.kind === 'kept-edit' && options.length)) {
    return h('span.history-actions', {}, options.map(option => button({ variant: 'outline', size: 'small', label: `Use ${who(option.tool)}’s`, name: `Use ${who(option.tool)}’s edit of ${event.item}`, id: `history-${event.id}-${option.tool}`, disabled: !!state.busy, onclick: () => void restoreEvent(event.id, { use: option.hash }) })));
  }
  return action ? actionLink(event, action) : h('span');
}

/** How long History keeps things, with the way to change it, and what it keeps longer: what Off removed. */
const keptFor = () => state.historyDays
  ? [` Kept for ${state.historyDays} days. ${OFF_KEPT} `, h('span.keep-together', {}, 'Change in ', h('button.inline-link', { type: 'button', id: 'history-intro-settings', onclick: () => showPage('settings') }, 'Settings'), '.')]
  : [];

export function historyPage() {
  // From History's own read (pagedata.ts): what it found, else that it is reading or could not read.
  const events = state.history.data;
  if (!events) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, state.history.state === 'failed' ? 'History could not be read.' : 'Reading History…')));
  if (!events.length && noTools()) return h('div.page', {}, noToolsState('history-choose-home'));
  if (!events.length) return h('div.page', {}, state.outcome?.page === 'history' ? h('div.bands', {}, outcomeBand()) : null, emptyState('history', 'No changes yet', 'When sync copies an edit, or turning something on adds or replaces a copy, it shows up here with Undo. Turn a skill on to begin.', button({ variant: 'outline', label: 'Start in Skills', id: 'history-go-skills', onclick: () => showPage('skills') })));
  const ordered = [...events].reverse();
  const reread = rereadBand(state.history);
  // A refused Undo made here is a warning band, as on the other pages; other results here are in the status bar.
  const refused = state.outcome?.page === 'history' && state.outcome.warn ? outcomeBand(false) : null;
  return h('div.page', {}, reread || refused ? h('div.bands', {}, reread, refused) : null, h('div.scroll', { id: 'history-scroll' }, h('p.history-intro', {}, `What sync, your switches, Pull and profile switches changed in your tools, newest first. Undo puts the earlier version back${ordered.some(event => event.kind === 'removed') ? '; Restore puts a removed copy back' : ''}.`, ...keptFor()), h('ul.history-list', {}, ordered.flatMap((event, index) => {
    const about = describe(event);
    const { action, state: shown, also } = offered(event, events, homeTools());
    // An On's Use the kept copy stands beside whatever the row's own action has become.
    const more = also.map((each, at) => actionLink(event, each, `history-${event.id}-also-${at}`));
    const heading = index === 0 || day(ordered[index - 1].at) !== day(event.at) ? h('li.history-day', { role: 'presentation' }, day(event.at)) : null;
    // The newest row, made by a click just now, gets the same brief highlight the tables use.
    const fresh = index === 0 && Date.now() - Date.parse(event.at) < 8000;
    // A row with nothing left to do (undone, or ended since) is dimmed; its state says why.
    return [heading, h(`li.history-row${action || more.length || choices(event).length ? '' : '.history-undone'}${fresh ? '.row-flash' : ''}`, { 'data-kind': event.kind },
      h('span.history-when', { title: new Date(event.at).toLocaleString() }, time(event.at)),
      // What changed, then what happened in the flexible column (its text capped at the reading measure); the actions keep a
      // steady column at the right, the same on every row. Narrow, what happened takes a line of its own beneath (style.css).
      h('span.history-what', {}, icon(about.glyph, 14, 'tone-muted'), h('span.history-kind', {}, kindOf(event)), h('strong', { title: event.item }, event.item)),
      h('span.history-about', {}, about.text),
      shown ? h('span.history-actions', {}, h('span.history-done', {}, shown), more)
        : h('span.history-actions', {}, !event.base && (event.kind === 'edit' || event.kind === 'conflict') ? seeChangeLink(event.id, event.key, true) : null, actions(event, action), more),
      changePanel(event.id))];
  }))));
}
