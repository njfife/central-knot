// The page's one list of clicks, carried out one at a time in the order clicked: a row's switch or Add on the item lists
// (app.ts queueClick), a plugin's switch or tool's box on Plugins (pluginstate.ts turnPlugin) and a tool's line's Install, Put its
// items here or Remove in the Library (pluginstate.ts turnFromLine, a run of its own: its result is the Library header's) join it,
// each a Turn. While
// clicks wait or run, the page acts (app.ts acting): the writes it names are off and say why, the page stays live (it scrolls,
// rows open, switches take clicks), and the background refresh waits: the home is read once when a run gives way to another run
// or the list empties and anything owes it a read (app.ts readHomeOnce). A run of clicks, said once with one Undo, is decided here for both routes (runAt): a click
// joins the run on its place while that run still has a click waiting or running, or within FADE_MS after its last click ended,
// unless something ended it (endRun: its result's ×, its Undo or any other action, another home; another page or tool's page
// once the list's clicks are carried out: app.ts leaveResults).
// Here: the list, the runs, a click's place in them, taking a waiting click back, and the state a row's switch is drawn in
// meanwhile (wantedOn). Each route keeps its own work, its row while its click waits (the item lists draw the new state; Plugins
// say "Waiting to…": pluginparts.ts clickNote) and its result with its Undo (app.ts sayRun; pluginstate.ts market.lastRun).
import { afterActing, FADE_MS, homeReadOwed, readHomeOnce, rerender, showActing, type PageKind, type ProfilesBefore } from './app.ts';
import type { RowKey } from './itemrow.ts';

/**
 * A run of clicks: its place (an item list, or a tool's tab of one kind under Harnesses: app.ts placeNow; or Plugins),
 * when its last click ended (0 before one has), and the profiles in use when its first click starts to be carried out
 * (app.ts queueClick, pluginstate.ts runClick). Its clicks are the turns that name it.
 */
export interface Run { place: string; lastAt: number; before?: ProfilesBefore }

/** One click in the list: waiting its turn, running (its work, through main, and the read after it), or ended. */
export interface Turn {
  state: 'waiting' | 'running' | 'ended';
  /** Its work, done in its turn. Each route says its own failures; a click whose work throws ends all the same. */
  work: () => Promise<void>;
  run: Run;
  /** An item list's row (its kind and key) and the state its switch asks for, which the row is drawn in until the click ends. */
  row?: RowKey & { on: boolean };
  /** Called after its run's home read, before a different run starts or when the list empties (Plugins: its run's clicks said once). */
  ended?: () => void;
}

export const clickList = { turns: [] as Turn[], running: false };
/** The run still taking clicks, on the place last clicked; none once ended. */
let open: Run | undefined;

const unended = (run: Run) => clickList.turns.filter(turn => turn.run === run && turn.state !== 'ended');

/**
 * The run a click made now on `place` joins: the open one there, while a click of it waits or runs or for FADE_MS after its
 * last click ended; else a new one, and the clicks of earlier runs there that have ended leave the list. A run with no click
 * yet is new (the route clears what the last one said: pluginstate.ts turnPlugin).
 */
export function runAt(place: string): Run {
  if (open?.place === place && (unended(open).length || Date.now() - open.lastAt < FADE_MS)) return open;
  drop(turn => turn.state === 'ended' && turn.run.place === place);
  return (open = { place, lastAt: 0 });
}

/** The open run ends; its clicks still waiting or running go on as a run of their own, which says only them. */
export function endRun(): void {
  const left = open ? unended(open) : [];
  open = left.length ? { place: open!.place, lastAt: 0 } : undefined;
  for (const turn of left) turn.run = open!;
}

/** A click joins the list, which starts running if it was not. */
export function join(turn: Turn): void {
  clickList.turns.push(turn);
  if (!clickList.running) void runList();
}

/** These clicks leave the list: a run's ended clicks once a new run starts on their place, or what another home leaves behind. */
export function drop(which: (turn: Turn) => boolean): void { clickList.turns = clickList.turns.filter(turn => !which(turn)); }

/** The latest unended click on an item list's row, if one is there. */
const latestOn = (kind: PageKind, key: string) => clickList.turns.findLast(turn => turn.state !== 'ended' && turn.row?.kind === kind && turn.row.key === key);

/** The state a row's switch is drawn in: the one its latest unended click asks for; undefined when none is (the view's, then). */
export const wantedOn = (kind: PageKind, key: string): boolean | undefined => latestOn(kind, key)?.row?.on;

/** A second click on a row whose latest click still waits takes that click back, and nothing is run; one running is not. */
export function takeBack(kind: PageKind, key: string): boolean {
  const turn = latestOn(kind, key);
  if (turn?.state !== 'waiting') return false;
  drop(other => other === turn);
  return true;
}

async function runList(): Promise<void> {
  clickList.running = true;
  showActing();
  const ran: Turn[] = [];
  for (;;) {
    const next = clickList.turns.find(turn => turn.state === 'waiting');
    // Before another run writes, finish the earlier run's home read and end callback against the home it left.
    if (next && (!ran.length || ran.at(-1)!.run === next.run)) {
      // Not drawn: a row looks the same while its click waits and while it runs (Plugins' runClick draws its own row's words).
      next.state = 'running';
      ran.push(next);
      await next.work().catch(() => undefined);
      next.state = 'ended';
      next.run.lastAt = Date.now();
      rerender();
    } else if (homeReadOwed()) await readHomeOnce();
    else if (next) {
      for (const said of new Set(ran.splice(0).map(turn => turn.ended))) said?.();
      rerender();
    } else break;
  }
  clickList.running = false;
  for (const said of new Set(ran.map(turn => turn.ended))) said?.();
  showActing();
  rerender();
  afterActing();
}
