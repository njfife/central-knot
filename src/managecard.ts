// A tool's Manage switch, on its card on the Harnesses list: the switch, the line beside it that says what a click will do there
// before it is made, and the band after it. The engine is toolchoice.ts: chooseTools turns it, and what turning a left-out tool on
// would do there is counted by its whatJoiningDoes, which reaches the page in the view (types.ts SyncView joining). The band says
// what the pass after the click did there, from its results (main.ts `tools:manage`, `did`). The cards themselves, the left-out
// one included, are harnesspage.ts's.
import { busy, setHome, state, tell } from './app.ts';
import { h, toggle } from './dom.ts';
import { plural } from './model.ts';
import { market } from './pluginstate.ts';
import { installsIn } from './pluginstatus.ts';
import { pluginUpdates } from './pluginupdateview.ts';
import type { DestinationResult, HarnessId, HomeView } from './types.ts';
import { toolNames as names } from './words.ts';

/**
 * Why no switch can be turned in this home, if so: preview only, another build syncs it, or its record stops every write. Said
 * once, in the list's note (harnesspage.ts), and as each disabled switch's tooltip.
 */
export function manageLocked(home: HomeView): string | undefined {
  if (!home.sync.access.allowed) return 'Preview only: nothing is written here, so which tools are managed can’t change.';
  const gate = home.sync.gate;
  if (gate.state === 'stopped') return gate.owner ? `${gate.owner.name} syncs this home, so which tools it manages can’t change from here. Take over syncing first.` : gate.reason;
  return undefined;
}

/**
 * The switch and its line, for an installed tool's card. Where no switch can be turned (manageLocked), it is disabled with the
 * reason as its tooltip, and the line is left out: the list's note says the reason once.
 */
export function manageRow(home: HomeView, tool: HarnessId): HTMLElement {
  const on = home.sync.managed.includes(tool), why = manageLocked(home), name = names[tool];
  const label = on ? `Manage ${name}: on. Click to leave ${name} out: Central Knot then writes nothing there until you turn it on again. Its copies stay, and every item stays as it is.`
    : `Manage ${name}: off. Click to have Central Knot manage it.`;
  return h('div.harness-manage', {},
    h('span.harness-manage-head', {},
      toggle({ on, label: why ?? label, id: `manage-${tool}`, disabled: !!why || !!state.busy, onchange: next => void manageTool(tool, next),
        attrs: why ? {} : { 'aria-describedby': `manage-${tool}-line` } }),
      h('span.harness-manage-label', {}, on ? 'Managed' : 'Not managed')),
    why ? null : h('span.harness-manage-line', { id: `manage-${tool}-line` }, on ? offLine(name) : onLine(home, tool)));
}

/** Said beside the switch of a managed tool, before a click turns it off (the switch's tooltip says the rest). */
const offLine = (name: string) => `Off leaves ${name} as it is: its copies stay, and every item stays as it is.`;
/** With Automatic sync off, what brings a tool turned on into line (a click's pass is about its own item: librarypass.ts PassOptions only). */
const SYNC_OFF = 'With Automatic sync off, Sync once brings it into line; a click on an item brings that item.';

/**
 * Said beside the switch of a tool left out, before a click turns it on: what the pass then does there, counted from the same
 * look (types.ts JoinCounts). What would change in the tool comes first, said as Central Knot's version replacing the tool's.
 */
function onLine(home: HomeView, tool: HarnessId): string {
  const { written, kept, removed, waits, found, takenIn } = home.sync.joining[tool] ?? { written: 0, kept: 0, removed: 0, waits: 0, found: 0, takenIn: 0 };
  const changes = [
    written ? `Central Knot’s version written there for ${plural(written, 'item')}` : '',
    kept ? `${plural(kept, 'copy there that differs', 'copies there that differ')} kept as ${kept === 1 ? 'a version' : 'versions'} first` : '',
    removed ? (removed === 1 ? '1 copy of an item that is off removed' : `${removed} copies of items that are off removed`) : '',
    waits ? `${plural(waits, 'MCP server change')} left for Write to Claude Code` : '',
  ].filter(Boolean);
  const besides = [takenIn ? `${plural(takenIn, 'found item')} taken in by Synchronize everything` : '', found ? `${plural(found, 'found item')} shown under Found` : ''].filter(Boolean);
  const then = `On: ${changes.length ? listed(changes) : `nothing in ${names[tool]} would change`}${besides.length ? `; ${listed(besides)}` : ''}.`;
  // A tool new to the plugin updates gets what the other managed tools have, while they run by themselves (pluginupdates.ts):
  // said only where another managed tool has a plugin to bring, as the marketplaces were last read.
  const bring = !!market.view && home.sync.managed.some(other => other !== tool && !!installsIn(market.view!, other)?.installed.length);
  const auto = pluginUpdates.view?.on && !pluginUpdates.view.paused;
  const also = bring && auto ? ' It also gets the plugins your other tools have, and its instruction file is back on Instructions.' : ' Its instruction file is back on Instructions.';
  return `${then}${also}${home.syncOn ? '' : ` ${SYNC_OFF}`}`;
}
const listed = (clauses: string[]) => (clauses.length < 2 ? clauses.join('') : `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}`);

/** The switch's click: chooseTools in main's queue, then the home as read after it; the band says what that pass did there. */
const manageTool = (tool: HarnessId, on: boolean) => busy(on ? `Managing ${names[tool]}…` : `Leaving ${names[tool]} out…`, async () => {
  const home = state.home!;
  const done = await window.centralKnot.manageTool(tool, on, home.sync.gate.state === 'needs-resume', home.home);
  if (done.view) setHome(done.view);
  if (done.stopped) { tell({ page: 'harnesses', band: true, warn: true, text: `Nothing changed: ${done.stopped}` }); return; }
  tell({ page: 'harnesses', band: true, ...doneWords(tool, on, home.syncOn, done.did) });
});

/** The band after a click: for On, what the pass did in the tool, from its results (`did`), not what the line counted before. */
export function doneWords(tool: HarnessId, on: boolean, syncOn: boolean, did: readonly DestinationResult[]): { text: string; note?: string; warn?: boolean } {
  const name = names[tool];
  if (!on) return { text: `${name} is left out: Central Knot writes nothing there now. Its copies stay as they are, and every item stays as it is.` };
  if (!syncOn) return { text: `Central Knot manages ${name} now. ${SYNC_OFF}` };
  const count = (outcome: DestinationResult['outcome']) => did.filter(result => result.outcome === outcome && !result.waits).length;
  const written = count('written'), over = did.filter(result => result.outcome === 'written' && result.replaced).length;
  const removed = count('removed'), waits = did.filter(result => result.waits).length, left = count('held') + count('failed');
  const clauses = [
    written ? `Central Knot’s version written there for ${plural(written, 'item')}${over ? ` (${over === written ? (over === 1 ? 'over its copy' : 'over their copies') : `${over} over a copy`} there, which a version keeps)` : ''}` : '',
    removed ? (removed === 1 ? '1 copy of an item that is off removed' : `${removed} copies of items that are off removed`) : '',
    waits ? `${plural(waits, 'MCP server change')} left for Write to Claude Code` : '',
    left ? `${plural(left, 'item')} not changed there this time (its row says why)` : '',
  ].filter(Boolean);
  if (!clauses.length) return { text: `Central Knot manages ${name} now. Nothing there needed changing.` };
  return { text: `Central Knot manages ${name} now: ${listed(clauses)}.`, note: 'Each change there is in History.', warn: left > 0 };
}
