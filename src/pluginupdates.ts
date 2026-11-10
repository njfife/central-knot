// Plugin updates that arrive by themselves (PLG-09). Every few hours, with or without a window, Central Knot reads the
// marketplaces again and runs what Update all would choose on the Plugins page, through each tool's own command: the same
// route as the button, so a plugin turned off stays off, one a tool no longer has is not put back, and one its marketplace
// dropped is left as it is. What it did is kept for the page's note and the Settings row; a failed update is tried again,
// less often each time. The steps are here, without Electron; main.ts gives them the app's parts (AutoUpdateHost).
import { resultLines, runPlan, succeeded, type PlanApi, type PluginDone, type PluginOp } from './pluginplan.ts';
import type { PluginUpdateLine, PluginUpdatesView } from './types.ts';
import { toolNames as names } from './words.ts';

/** How often the marketplaces are checked: the app's own update rhythm. A plugin release is never urgent, and each check fetches every Git marketplace again. */
export const CHECK_EVERY_MS = 4 * 60 * 60_000;
/** After a check that reached no Git marketplace (offline, most likely: a laptop just woken), the next one comes this soon. */
const OFFLINE_RETRY_MS = 30 * 60_000;
/**
 * Whether plugins are updated automatically before the person has chosen in Settings. On: these are plugins the person
 * installed, from marketplaces they chose, updated by each tool's own command; the note and the log say what changed.
 */
export const PLUGIN_UPDATES_DEFAULT = true;
/** A failed update is tried again at the next check, then after two, four… checks' time, and at least once a day. */
const RETRY_CAP_MS = 24 * 60 * 60_000;
/** The note keeps this many lines of what was updated; older ones stay in the log. */
const NOTE_LINES = 40;

/** An update that is due: the op Update all would choose, with the version the marketplace offers. */
export type DueUpdate = PluginOp & { offered?: string };

/** An update that failed: which, what the tool said, when it was last tried and how often, and whether the note about it was closed. */
interface Failure { key: string; source: string; plugin: string; tool: string; offered?: string; text: string; at: number; tries: number; closed?: boolean }

/** What is kept between checks (plugin-updates.json in Central Knot's data folder), about one home. */
export interface UpdatesRecord {
  home: string;
  checked?: PluginUpdatesView['checked'];
  /** What was updated since the note was last closed, oldest first. */
  updated: PluginUpdateLine[];
  failures: Failure[];
  /** A note of updates was closed here once: it no longer says that plugins update by themselves now. */
  told?: true;
}

/** What the automatic updates need from the app around them. */
export interface AutoUpdateHost {
  /** The home open now, if one is. */
  home(): string | undefined;
  /** Whether the switch in Settings is on. */
  on(): boolean;
  /** Automatic sync is off: Central Knot then writes nothing to the tools in the background, plugin updates included. A check the person asks for still runs. */
  paused(): boolean;
  /** What is due now (marketplaces.pendingUpdates): reads every marketplace again; `stopped` when nothing may be changed in this home. */
  pending(home: string): Promise<{ stopped?: string; ops: DueUpdate[]; unread: string[]; offline?: true }>;
  /** The calls an update makes, as Apply all makes them (an update without the reinstall route: see plugins.update). */
  api: Required<Pick<PlanApi, 'update' | 'parts'>>;
  /** The record as last saved, if there is one that can be read. */
  load(): Promise<UpdatesRecord | undefined>;
  save(record: UpdatesRecord): Promise<void>;
  log(line: string): void;
  /** The view changed. `news`: this check updated something, or an update failed that the note doesn't already say. */
  changed(view: PluginUpdatesView, news: boolean): void;
  now(): number;
  /** The time between checks (CHECK_EVERY_MS, shorter in tests). */
  every: number;
}

const keyOf = (op: Pick<PluginOp, 'source' | 'plugin' | 'tool'>) => `${op.source}\u0000${op.plugin}\u0000${op.tool}`;

/** How long after its last try a failed update waits: one check's time, doubled with each try, up to a day. */
export const retryAfter = (tries: number, every: number) => Math.min(RETRY_CAP_MS, every * 2 ** Math.max(0, tries - 1));

export function autoUpdates(host: AutoUpdateHost) {
  // Only updates run by themselves: nothing here installs, uninstalls or switches a skill.
  const never = async () => ({ stopped: 'Only updates run by themselves.', reports: [] });
  const api: PlanApi = { install: never, uninstall: never, setSkill: never, ...host.api };
  let record: UpdatesRecord | undefined;
  let running: Promise<PluginUpdatesView> | undefined;

  /** The record for the open home: the saved one when it is about this home, else a new one (a note is about one home's tools). */
  async function recordFor(home: string): Promise<UpdatesRecord> {
    if (record?.home !== home) {
      const saved = record ?? await host.load().catch(() => undefined);
      record = saved?.home === home ? saved : { home, updated: [], failures: [] };
    }
    return record;
  }

  const shown = (): PluginUpdatesView => {
    const mine = record && record.home === host.home() ? record : undefined;
    return { on: host.on(), paused: host.paused(), checking: !!running, every: host.every, checked: mine?.checked, updated: mine?.updated ?? [],
      failed: (mine?.failures ?? []).filter(failure => !failure.closed).map(({ at, source, plugin, text }) => ({ at, source, plugin, text })), first: !mine?.told };
  };

  /** The view, with the saved record read if it hasn't been yet. */
  async function view(): Promise<PluginUpdatesView> {
    const home = host.home();
    if (home) await recordFor(home);
    return shown();
  }

  async function save(news = false) {
    if (record) await host.save(record).catch(error => host.log(`plugin updates: the record couldn’t be saved: ${error instanceof Error ? error.message : String(error)}`));
    host.changed(shown(), news);
  }

  /**
   * One check. Reads what is due, leaves out failed updates still waiting for their next try (`asked`: a check the person
   * asked for tries them all), runs the rest, and keeps what happened. A failure whose update is no longer due is settled
   * (updated by hand, uninstalled, or the marketplace moved on) and goes. Two checks never run at once: a second waits for
   * the first's answer.
   */
  function check(asked = false): Promise<PluginUpdatesView> {
    running ??= run(asked).finally(() => { running = undefined; }).then(() => { const view = shown(); host.changed(view, false); return view; });
    return running;
  }

  async function run(asked: boolean): Promise<void> {
    const home = host.home();
    if (!home) return;
    const mine = await recordFor(home);
    host.changed(shown(), false);
    const at = host.now();
    let due: Awaited<ReturnType<AutoUpdateHost['pending']>>;
    try { due = await host.pending(home); } catch (error) {
      host.log(`plugin updates: the marketplaces couldn’t be read: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      due = { stopped: 'The marketplaces couldn’t be read. The log file says why.', ops: [], unread: [] };
    }
    // The home was switched while the marketplaces were read: what is due was worked out for the other one.
    if (host.home() !== home) return;
    if (due.stopped) {
      host.log(`plugin updates: not checked: ${due.stopped}`);
      mine.checked = { at, updated: 0, failed: mine.failures.length, unread: [], stopped: due.stopped };
      await save();
      return;
    }
    mine.failures = mine.failures.filter(failure => due.ops.some(op => keyOf(op) === failure.key));
    const waits = (op: DueUpdate) => { const failure = mine.failures.find(known => known.key === keyOf(op)); return !asked && !!failure && failure.offered === op.offered && at < failure.at + retryAfter(failure.tries, host.every); };
    const ops = due.ops.filter(op => !waits(op));
    host.log(`plugin updates: checked${due.unread.length ? ` (couldn’t read ${due.unread.join(', ')})` : ''}: ${due.ops.length} due${due.ops.length > ops.length ? `, ${due.ops.length - ops.length} waiting for a later try` : ''}`);
    const { done, stopped } = ops.length ? await runPlan(ops, api, home) : { done: [] as PluginDone[], stopped: undefined };
    if (stopped) host.log(`plugin updates: stopped: ${stopped}`);
    const news = keep(mine, ops, done, at);
    mine.checked = { at, updated: done.filter(entry => succeeded(entry.report) && entry.report.changed).length, failed: mine.failures.length, unread: due.unread, ...(due.offline ? { offline: true as const } : {}), ...(stopped ? { stopped } : {}) };
    await save(news);
  }

  /** Keeps what a check's updates came to: the note's lines for what changed, and each failure with its count of tries. True when there is news. */
  function keep(mine: UpdatesRecord, ops: DueUpdate[], done: PluginDone[], at: number): boolean {
    const changed = done.filter(entry => succeeded(entry.report) && (entry.report.changed || entry.report.notes?.length));
    // The words Apply all uses, one line per plugin; a part left alone (edited since, say) is a line of its own to read.
    const lines = resultLines(changed).map(line => ({ at, source: line.source, plugin: line.plugin, text: line.text, ...(line.ok ? {} : { warn: true as const }) }));
    mine.updated = [...mine.updated, ...lines].slice(-NOTE_LINES);
    let failedNew = false;
    for (const entry of done) {
      const key = keyOf(entry);
      const before = mine.failures.find(failure => failure.key === key);
      mine.failures = mine.failures.filter(failure => failure.key !== key);
      if (succeeded(entry.report)) continue;
      const offered = ops.find(op => keyOf(op) === key)?.offered;
      const text = `${names[entry.tool]}: ${entry.report.message}`;
      // A note the person closed stays closed while the same update fails for the same reason.
      const closed = !!before?.closed && before.text === text && before.offered === offered;
      if (!closed) failedNew = true;
      mine.failures.push({ key, source: entry.source, plugin: entry.plugin, tool: entry.tool, ...(offered ? { offered } : {}), text, at, tries: (before && before.offered === offered ? before.tries : 0) + 1, ...(closed ? { closed } : {}) });
    }
    return lines.length > 0 || failedNew;
  }

  /**
   * The schedule's turn (main calls it every few minutes, so a computer that slept through a check's time checks soon after
   * it wakes): a check, when the switch is on, Automatic sync is too, and the last check in this home is long enough ago.
   */
  async function tick(): Promise<void> {
    const home = host.home();
    if (!host.on() || host.paused() || running || !home) return;
    const last = (await recordFor(home)).checked;
    if (last && host.now() - last.at < (last.offline ? Math.min(host.every, OFFLINE_RETRY_MS) : host.every)) return;
    await check();
  }

  /** Closes one half of the note: what was updated is no longer listed, or the failures shown now are not shown again while they stay the same. */
  async function close(what: 'updated' | 'failed'): Promise<PluginUpdatesView> {
    const home = host.home();
    if (!home) return shown();
    const mine = await recordFor(home);
    if (what === 'updated') { mine.updated = []; mine.told = true; }
    else for (const failure of mine.failures) failure.closed = true;
    await save();
    return shown();
  }

  return { view, check, tick, close };
}
