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
/** After a check that reached no Git marketplace (offline, most likely: a laptop just woken) or stopped partway, the next one comes this soon. */
const SOON_MS = 30 * 60_000;
/** Records are kept for this many homes, the most recently checked. */
const HOMES_KEPT = 8;
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

/**
 * An update that failed: which, what the tool said, when it was last tried and how often, and whether the note about it
 * was closed. `manual`: trying again can't help (the tool's own update kept a copy that differs at the same version, and
 * nothing is uninstalled to be reinstalled with nobody watching): it waits for Update on the plugin's page.
 */
interface Failure { key: string; source: string; plugin: string; tool: string; offered?: string; text: string; at: number; tries: number; closed?: boolean; manual?: true }

/** What is kept between checks about one home (plugin-updates.json in Central Knot's data folder holds one of these per home). */
export interface UpdatesRecord {
  home: string;
  checked?: PluginUpdatesView['checked'];
  /** What was updated since the note was last closed, oldest first. */
  updated: PluginUpdateLine[];
  failures: Failure[];
  /** A note of updates was closed here once: it no longer says that plugins update by themselves now. */
  told?: true;
}

/** What a check found to do (marketplaces.pendingUpdates). */
export interface Pending { stopped?: string; ops: DueUpdate[]; unread: string[]; /** The marketplaces that were read, as added. */ read: string[]; offline?: true }

/** What the automatic updates need from the app around them. */
export interface AutoUpdateHost {
  /** The home open now, if one is. */
  home(): string | undefined;
  /** Whether the switch in Settings is on. */
  on(): boolean;
  /** Automatic sync is off: Central Knot then writes nothing to the tools in the background, plugin updates included. A check the person asks for still runs. */
  paused(): boolean;
  /** What is due now: reads every marketplace again; `stopped` when nothing may be changed in this home. */
  pending(home: string): Promise<Pending>;
  /** The calls an update makes, as Apply all makes them (an update without the reinstall route: see plugins.update). */
  api: Required<Pick<PlanApi, 'update' | 'parts'>>;
  /** Every home's record as last saved, if the file is there and can be read. */
  load(): Promise<UpdatesRecord[] | undefined>;
  save(records: UpdatesRecord[]): Promise<void>;
  log(line: string): void;
  /** The view changed. `news`: this check updated something, or else an update failed that the note doesn't already say. */
  changed(view: PluginUpdatesView, news?: 'updated' | 'failed'): void;
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
  /** Each home's record, read from the file once. A note, its failures and the time of the last check are about one home's tools. */
  let records: Map<string, UpdatesRecord> | undefined;
  let running: Promise<PluginUpdatesView> | undefined;
  /** The check under way was asked for (Check now): it tries every failed update. */
  let runningAsked = false;

  async function recordFor(home: string): Promise<UpdatesRecord> {
    records ??= new Map(((await host.load().catch(() => undefined)) ?? []).filter(saved => typeof saved?.home === 'string').map(saved => [saved.home, saved]));
    if (!records.has(home)) records.set(home, { home, updated: [], failures: [] });
    return records.get(home)!;
  }

  const shown = (): PluginUpdatesView => {
    const mine = records?.get(host.home() ?? '');
    return { on: host.on(), paused: host.paused(), checking: !!running, checked: mine?.checked, updated: mine?.updated ?? [],
      failed: (mine?.failures ?? []).filter(failure => !failure.closed).map(({ at, source, plugin, text, manual }) => ({ at, source, plugin, text, ...(manual ? {} : { again: true as const }) })), first: !mine?.told };
  };

  /** The view, with the saved records read if they haven't been yet. */
  async function view(): Promise<PluginUpdatesView> {
    const home = host.home();
    if (home) await recordFor(home);
    return shown();
  }

  /** Saves every home's record, the most recently checked first and no more than HOMES_KEPT of them (a practice copy is a new folder each launch). */
  async function save(news?: 'updated' | 'failed') {
    const open = host.home();
    const kept = [...(records?.values() ?? [])].sort((first, second) => Number(second.home === open) - Number(first.home === open) || (second.checked?.at ?? 0) - (first.checked?.at ?? 0)).slice(0, HOMES_KEPT);
    records = new Map(kept.map(saved => [saved.home, saved]));
    await host.save(kept).catch(error => host.log(`plugin updates: the record couldn’t be saved: ${error instanceof Error ? error.message : String(error)}`));
    host.changed(shown(), news);
  }

  /**
   * One check. Reads what is due, leaves out failed updates still waiting for their next try (`asked`: a check the person
   * asked for tries them all), runs the rest, and keeps what happened. Two checks never run at once: a second waits for the
   * first's answer, and one the person asked for while a scheduled one runs is made after it, so it does try them all.
   */
  function check(asked = false): Promise<PluginUpdatesView> {
    if (running) return asked && !runningAsked ? running.then(() => check(true)) : running;
    runningAsked = asked;
    running = run(asked).finally(() => { running = undefined; }).then(() => { const view = shown(); host.changed(view); return view; });
    return running;
  }

  async function run(asked: boolean): Promise<void> {
    const home = host.home();
    if (!home) return;
    // This home's record, held through the whole check: a home switched meanwhile never gets this check's results, and never loses them.
    const mine = await recordFor(home);
    host.changed(shown());
    const at = host.now();
    let due: Pending;
    try { due = await host.pending(home); } catch (error) {
      host.log(`plugin updates: the marketplaces couldn’t be read: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      due = { stopped: 'The marketplaces couldn’t be read. The log file says why.', ops: [], unread: [], read: [] };
    }
    // The home was switched while the marketplaces were read: what is due was worked out for the other one.
    if (host.home() !== home) return;
    if (due.stopped) {
      host.log(`plugin updates: not checked: ${due.stopped}`);
      mine.checked = { at, updated: 0, failed: mine.failures.length, unread: [], stopped: due.stopped };
      await save();
      return;
    }
    // A failure whose update is no longer due is settled (updated by hand, uninstalled, the marketplace moved back): but
    // only where its marketplace was read just now. One that couldn't be read says nothing about its plugins.
    mine.failures = mine.failures.filter(failure => !due.read.includes(failure.source) || due.ops.some(op => keyOf(op) === failure.key));
    const waits = (op: DueUpdate) => {
      const failure = mine.failures.find(known => known.key === keyOf(op));
      return !!failure && failure.offered === op.offered && (!!failure.manual || (!asked && at < failure.at + retryAfter(failure.tries, host.every)));
    };
    const ops = due.ops.filter(op => !waits(op));
    host.log(`plugin updates: checked${due.unread.length ? ` (couldn’t read ${due.unread.join(', ')})` : ''}: ${due.ops.length} due${due.ops.length > ops.length ? `, ${due.ops.length - ops.length} waiting` : ''}`);
    const { done, stopped } = ops.length ? await runPlan(ops, api, home) : { done: [] as PluginDone[], stopped: undefined };
    if (stopped) host.log(`plugin updates: stopped: ${stopped}`);
    const news = keep(mine, ops, done, at);
    mine.checked = { at, updated: done.filter(entry => succeeded(entry.report) && entry.report.changed).length, failed: mine.failures.length, unread: due.unread, ...(due.offline ? { offline: true as const } : {}), ...(stopped ? { stopped } : {}) };
    await save(news);
  }

  /** Keeps what a check's updates came to: the note's lines for what changed, and each failure with its count of tries. Says what is news. */
  function keep(mine: UpdatesRecord, ops: DueUpdate[], done: PluginDone[], at: number): 'updated' | 'failed' | undefined {
    const changed = done.filter(entry => succeeded(entry.report) && (entry.report.changed || entry.report.notes?.length));
    // The words Apply all uses, one line per plugin, without its warning before the click (Settings says an update can't be
    // undone); a part left alone (edited since, say) is a line of its own to read.
    const lines = resultLines(changed).map(line => ({ at, source: line.source, plugin: line.plugin, text: line.text.replace(', which can’t be undone', ''), ...(line.ok ? {} : { warn: true as const }) }));
    mine.updated = [...mine.updated, ...lines].slice(-NOTE_LINES);
    let failedNew = false;
    for (const entry of done) {
      const key = keyOf(entry);
      const before = mine.failures.find(failure => failure.key === key);
      mine.failures = mine.failures.filter(failure => failure.key !== key);
      if (succeeded(entry.report)) continue;
      const offered = ops.find(op => keyOf(op) === key)?.offered;
      // The tool's own words usually name it; where they don't, its name goes first.
      const text = entry.report.message.includes(names[entry.tool]) ? entry.report.message : `${names[entry.tool]}: ${entry.report.message}`;
      // A note the person closed stays closed while the same update fails for the same reason.
      const closed = !!before?.closed && before.text === text && before.offered === offered;
      if (!closed) failedNew = true;
      mine.failures.push({ key, source: entry.source, plugin: entry.plugin, tool: entry.tool, ...(offered ? { offered } : {}), text, at, tries: (before && before.offered === offered ? before.tries : 0) + 1, ...(closed ? { closed } : {}), ...(entry.report.kept ? { manual: true as const } : {}) });
    }
    return lines.length ? 'updated' : failedNew ? 'failed' : undefined;
  }

  /**
   * The schedule's turn (main calls it every few minutes, so a computer that slept through a check's time checks soon after
   * it wakes): a check, when the switch is on, Automatic sync is too, and the last check in this home is long enough ago.
   * One that reached no Git marketplace, or stopped partway, is made again sooner.
   */
  async function tick(): Promise<void> {
    const home = host.home();
    if (!host.on() || host.paused() || running || !home) return;
    const last = (await recordFor(home)).checked;
    if (last && host.now() - last.at < (last.offline || last.stopped ? Math.min(host.every, SOON_MS) : host.every)) return;
    await check();
  }

  /**
   * The person changed a plugin in these tools on its page, and it worked (an update, an uninstall): what failed there
   * before is settled now, not at the next check.
   */
  async function settled(source: string, plugin: string, tools: string[]): Promise<void> {
    const home = host.home();
    if (!home) return;
    const mine = await recordFor(home);
    const left = mine.failures.filter(failure => !(failure.source === source && failure.plugin === plugin && tools.includes(failure.tool)));
    if (left.length === mine.failures.length) return;
    mine.failures = left;
    if (mine.checked) mine.checked = { ...mine.checked, failed: left.length };
    await save();
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

  return { view, check, tick, close, settled };
}
