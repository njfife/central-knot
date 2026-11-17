// The page's one list of clicks, carried out one at a time in the order clicked: a row's switch or Add on the item pages
// (app.ts queueClick) and a plugin's switch or tool's box on Plugins (pluginstate.ts turnPlugin) join it. A run lasts from its
// first click until the list is empty; the list keeps that run's clicks until the next run starts. While it runs the page acts
// (app.ts acting): every other write is off and says why, the page stays live (it scrolls, rows open, switches take clicks), and
// the background refresh waits: the home is read once at the run's end when anything owes it a read (app.ts readHomeOnce). Here:
// the list, a click's place in it, taking a waiting click back, and the state a row's switch is drawn in meanwhile (wantedOn).
// Each route keeps its own work, its row while its click waits (the item pages draw the new state; Plugins say "Waiting to…":
// pluginparts.ts clickNote) and its result with its Undo (app.ts sayRun; pluginstate.ts market.lastRun).
import { afterActing, homeReadOwed, readHomeOnce, rerender, showActing, type PageKind } from './app.ts';

/** One click in the list: waiting its turn, running (its work, through main, and the read after it), or ended. */
export interface Turn {
  state: 'waiting' | 'running' | 'ended';
  /** Its work, run in its turn. Each route says its own failures; a click whose work throws ends all the same. */
  run: () => Promise<void>;
  /** An item page's row (its kind and key) and the state its switch asks for, which the row is drawn in until the click ends. */
  row?: { kind: PageKind; key: string; on: boolean };
  /** Said once its run has ended (Plugins: the run's clicks said as a whole). */
  ended?: () => void;
}

export const clickList = { turns: [] as Turn[], running: false };

/** A click joins the list; the first click after a run has ended starts a new run. */
export function join(turn: Turn): void {
  if (clickList.running) { clickList.turns.push(turn); return; }
  clickList.turns = [turn];
  void runList();
}

/** The latest unended click on an item page's row, if one is there. */
const latestOn = (kind: PageKind, key: string) => clickList.turns.findLast(turn => turn.state !== 'ended' && turn.row?.kind === kind && turn.row.key === key);

/** The state a row's switch is drawn in: the one its latest unended click asks for; undefined when none is (the view's, then). */
export const wantedOn = (kind: PageKind, key: string): boolean | undefined => latestOn(kind, key)?.row?.on;

/** A second click on a row whose latest click still waits takes that click back, and nothing is run; one running is not. */
export function takeBack(kind: PageKind, key: string): boolean {
  const turn = latestOn(kind, key);
  if (turn?.state !== 'waiting') return false;
  clickList.turns.splice(clickList.turns.indexOf(turn), 1);
  return true;
}

/** Another home opened: the clicks not yet run are dropped (a route drops the result of one running: pluginstate.ts runClick). */
export function dropWaiting(): void { clickList.turns = clickList.turns.filter(turn => turn.state !== 'waiting'); }

async function runList(): Promise<void> {
  clickList.running = true;
  showActing();
  for (;;) {
    const next = clickList.turns.find(turn => turn.state === 'waiting');
    if (next) {
      next.state = 'running';
      rerender();
      await next.run().catch(() => undefined);
      next.state = 'ended';
      rerender();
    } else if (homeReadOwed()) await readHomeOnce();
    // A click made during that read runs too, and the home is read again after it.
    else break;
  }
  clickList.running = false;
  for (const said of new Set(clickList.turns.map(turn => turn.ended))) said?.();
  showActing();
  rerender();
  afterActing();
}
