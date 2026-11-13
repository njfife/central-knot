// A tool's Manage switch, on its card on the Harnesses list: the switch, the line beside it that says what a click will do there
// before it is made, and the band after it. The engine is toolchoice.ts: chooseTools turns it, and what turning a left-out tool on
// would do there is counted by its whatJoiningDoes, which reaches the page in the view (types.ts SyncView joining). The cards
// themselves, the left-out one included, are harnesspage.ts's.
import { busy, setHome, state, tell } from './app.ts';
import { h, toggle } from './dom.ts';
import { plural } from './model.ts';
import { pluginUpdates } from './pluginupdateview.ts';
import type { HarnessId, HomeView, JoinCounts } from './types.ts';
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
  const label = on ? `Manage ${name}: on. Click to leave ${name} out: Central Knot then writes nothing there until you turn it on again. Its copies stay, and every item stays on.`
    : `Manage ${name}: off. Click to have Central Knot manage it.`;
  return h('div.harness-manage', {},
    h('span.harness-manage-head', {},
      toggle({ on, label: why ?? label, id: `manage-${tool}`, disabled: !!why || !!state.busy, onchange: next => void manageTool(tool, next),
        attrs: why ? {} : { 'aria-describedby': `manage-${tool}-line` } }),
      h('span.harness-manage-label', {}, on ? 'Managed' : 'Not managed')),
    why ? null : h('span.harness-manage-line', { id: `manage-${tool}-line` }, on ? offLine(name) : onLine(home, tool)));
}

/** Said beside the switch of a managed tool, before a click turns it off (the switch's tooltip says the rest). */
const offLine = (name: string) => `Off leaves ${name} as it is: its copies stay, and every item stays on.`;

/** Said beside the switch of a tool left out, before a click turns it on: what the pass then does there, as counted from the same look. */
function onLine(home: HomeView, tool: HarnessId): string {
  const counts = home.sync.joining[tool];
  const does = counts ? joinClauses(counts) : [];
  const then = !does.length ? 'On: nothing there needs changing now.' : `On: ${listed(does)}.`;
  // A tool new to the plugin updates gets what the other managed tools have, while they run by themselves (pluginupdates.ts).
  const others = home.sync.managed.some(other => other !== tool), auto = pluginUpdates.view?.on && !pluginUpdates.view.paused;
  const also = others && auto ? ' It also gets the plugins your other tools have, and its instruction file is back on Instructions.' : ' Its instruction file is back on Instructions.';
  const later = home.syncOn ? '' : ' With Automatic sync off, this happens at Sync once or at your next click on any item.';
  return `${then}${also}${later}`;
}

/** What turning a tool on does there, one clause per count that isn't zero, in the order the pass does it; read before the click and after it. */
export function joinClauses({ written, kept, removed, waits, found, takenIn }: JoinCounts): string[] {
  return [
    kept ? `${plural(kept, 'copy', 'copies')} there kept as ${kept === 1 ? 'a version' : 'versions'} first` : '',
    written ? `${plural(written, 'item')} written there` : '',
    removed ? (removed === 1 ? '1 copy of an item that is off removed' : `${removed} copies of items that are off removed`) : '',
    waits ? `${plural(waits, 'MCP server change')} left for Write to Claude Code` : '',
    takenIn ? `${plural(takenIn, 'found item')} taken in by Synchronize everything` : '',
    found ? `${plural(found, 'found item')} shown under Found` : '',
  ].filter(Boolean);
}
const listed = (clauses: string[]) => (clauses.length < 2 ? clauses.join('') : `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}`);

/** The switch's click: chooseTools in main's queue, then the home as read after it; the band says what changed. */
const manageTool = (tool: HarnessId, on: boolean) => busy(on ? `Managing ${names[tool]}…` : `Leaving ${names[tool]} out…`, async () => {
  const home = state.home!;
  // What the line said before the click, which the pass just did (tests/managetool.test.ts holds the two equal).
  const said = home.sync.joining[tool];
  const done = await window.centralKnot.manageTool(tool, on, home.sync.gate.state === 'needs-resume', home.home);
  if (done.view) setHome(done.view);
  if (done.stopped) { tell({ page: 'harnesses', band: true, warn: true, text: `Nothing changed: ${done.stopped}` }); return; }
  tell({ page: 'harnesses', band: true, ...doneWords(tool, on, home.syncOn, said) });
});

/** The band after a click. */
function doneWords(tool: HarnessId, on: boolean, syncOn: boolean, said: JoinCounts | undefined): { text: string; note?: string } {
  const name = names[tool];
  if (!on) return { text: `${name} is left out: Central Knot writes nothing there now. Its copies stay as they are, and every item stays on.` };
  const does = said ? joinClauses(said) : [];
  if (!syncOn) return { text: `Central Knot manages ${name} now. With Automatic sync off, it is brought into line at Sync once or at your next click on any item.` };
  if (!does.length) return { text: `Central Knot manages ${name} now. Nothing there needed changing.` };
  return { text: `Central Knot manages ${name} now: ${listed(does)}.`, note: 'Each change there is in History.' };
}
