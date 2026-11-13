// Plugin updates that arrive by themselves (PLG-09). Every few hours, with or without a window, Central Knot reads the
// marketplaces again and runs what Update all would choose on the Plugins page, through each tool's own command: the same
// route as the button, so a plugin turned off stays off, one a tool no longer has is not put back, and one its marketplace
// dropped is left as it is. What it did is kept for the page's note and the Settings row; a failed update is tried again,
// less often each time. The steps are here, without Electron; main.ts gives them the app's parts (AutoUpdateHost).
import { resultLines, runPlan, succeeded, type PlanApi, type PluginDone, type PluginOp } from './pluginplan.ts';
import type { HarnessId, PluginUpdateLine, PluginUpdatesView } from './types.ts';
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
  /**
   * Selections that wait. `seenTools`: the tools plugins go into that this home has had; it only grows, so a tool that
   * is missed by one read and found by the next is not new. `waiting`: for a tool first seen since, the plugins every
   * other tool had at that moment and it lacked, each until it is in (or no longer due, or tried WAITING_TRIES times).
   */
  seenTools?: HarnessId[];
  waiting?: Waiting[];
}
/** A plugin waiting to go into a tool that is new here: the install, how often it was tried and when last. */
export type Waiting = PluginOp & { tries: number; at: number };
/** A waiting install that keeps failing (a tool not signed in yet, say) is given up after this many tries; its box on Plugins still installs it. */
export const WAITING_TRIES = 3;

/** What a check found to do (marketplaces.pendingUpdates). `unread`: the marketplaces that couldn't be read, by name, and `unreadSources`, as added. */
export interface Pending { stopped?: string; ops: DueUpdate[]; unread: string[]; unreadSources: string[]; offline?: true; /** The tools here that plugins go into, and what each would get to have the plugins every other tool has (marketplaces.pendingUpdates). */ tools?: HarnessId[]; joins?: Partial<Record<HarnessId, PluginOp[]>> }

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
  /** The calls an update makes, as Apply all makes them (an update without the reinstall route: see plugins.update), and the install a waiting selection makes. */
  api: Required<Pick<PlanApi, 'update' | 'parts' | 'install'>>;
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
  // Only updates run by themselves, and the installs of selections that wait: nothing here uninstalls or switches a skill.
  const never = async () => ({ stopped: 'Only updates run by themselves.', reports: [] });
  const api: PlanApi = { uninstall: never, setSkill: never, ...host.api };
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

  /** The check under way, if one is (Quit waits for it while a tool's command runs, so its note is saved). */
  const underWay = (): Promise<unknown> | undefined => running;

  /** The view, with the saved records read if they haven't been yet. */
  async function view(): Promise<PluginUpdatesView> {
    const home = host.home();
    if (home) await recordFor(home);
    return shown();
  }

  /**
   * Saves every home's record, the most recently checked first and no more than HOMES_KEPT of them (a practice copy is a
   * new folder each launch). `news` is `about` one home: told only while that home is still the one open.
   */
  async function save(about?: UpdatesRecord, news?: 'updated' | 'failed') {
    const open = host.home();
    const kept = [...(records?.values() ?? [])].sort((first, second) => Number(second.home === open) - Number(first.home === open) || (second.checked?.at ?? 0) - (first.checked?.at ?? 0)).slice(0, HOMES_KEPT);
    records = new Map(kept.map(saved => [saved.home, saved]));
    await host.save(kept).catch(error => host.log(`plugin updates: the record couldn’t be saved: ${error instanceof Error ? error.message : String(error)}`));
    host.changed(shown(), about && about.home === host.home() ? news : undefined);
  }

  /** How many failures the note still shows: the Settings row counts these, so it never points at a note that was closed. */
  const open = (mine: UpdatesRecord) => mine.failures.filter(failure => !failure.closed).length;

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
      due = { stopped: 'The marketplaces couldn’t be read. The log file says why.', ops: [], unread: [], unreadSources: [] };
    }
    // The home was switched while the marketplaces were read: what is due was worked out for the other one.
    if (host.home() !== home) return;
    if (due.stopped) {
      host.log(`plugin updates: not checked: ${due.stopped}`);
      mine.checked = { at, updated: 0, failed: open(mine), unread: [], stopped: due.stopped };
      await save();
      return;
    }
    // A failure whose update is no longer due is settled (updated by hand, uninstalled, the marketplace moved back or was
    // taken off the list): unless its marketplace couldn't be read just now, which says nothing about its plugins.
    mine.failures = mine.failures.filter(failure => due.unreadSources.includes(failure.source) || due.ops.some(op => keyOf(op) === failure.key));
    const waits = (op: DueUpdate) => {
      const failure = mine.failures.find(known => known.key === keyOf(op));
      return !!failure && failure.offered === op.offered && (!!failure.manual || (!asked && at < failure.at + retryAfter(failure.tries, host.every)));
    };
    const ops = due.ops.filter(op => !waits(op));
    host.log(`plugin updates: checked${due.unread.length ? ` (couldn’t read ${due.unread.join(', ')})` : ''}: ${due.ops.length} due${due.ops.length > ops.length ? `, ${due.ops.length - ops.length} waiting` : ''}`);
    const joining = waitingNow(mine, due, at, asked, ops);
    const { done: all, stopped } = ops.length || joining.length ? await runPlan([...ops, ...joining], api, home) : { done: [] as PluginDone[], stopped: undefined };
    if (stopped) host.log(`plugin updates: stopped: ${stopped}`);
    const joined = all.filter(entry => joining.some(op => keyOf(op) === keyOf(entry) && op.action === entry.action));
    const done = all.filter(entry => !joined.includes(entry));
    const arrived = keepJoined(mine, joined, at);
    // Something went in or was updated: that is the news, also when another update failed in the same check.
    const kept = keep(mine, ops, done, at);
    const news = arrived ? 'updated' as const : kept;
    mine.checked = { at, updated: done.filter(entry => succeeded(entry.report) && entry.report.changed).length, failed: open(mine), unread: due.unread, ...(due.offline ? { offline: true as const } : {}), ...(stopped ? { stopped, partway: true as const } : {}) };
    await save(mine, news);
  }

  /**
   * Selections that wait. A tool plugins go into that this home has not had before gets, once, the plugins every other
   * tool has now; the tools here when this first runs are only noted, so nothing is installed for them. What still waits
   * and is still due is returned to be installed now: all of it when the person asked, else what was not tried yet or
   * has waited as long as a failed update would.
   */
  function waitingNow(mine: UpdatesRecord, due: Pending, at: number, asked: boolean, ops: DueUpdate[]): Waiting[] {
    if (!due.tools) return [];
    // Only while plugins change by themselves here. With the switch off or Automatic sync off, a tool first seen is noted
    // and gets nothing, then or later: it may be long in use by the time they are turned on again.
    const auto = host.on() && !host.paused();
    const fresh = mine.seenTools ? due.tools.filter(tool => !mine.seenTools!.includes(tool)) : [];
    mine.seenTools = [...(mine.seenTools ?? due.tools), ...fresh];
    for (const tool of auto ? fresh : []) {
      const gets = due.joins?.[tool] ?? [];
      host.log(`plugin updates: ${names[tool]} is new here: ${gets.length ? `${gets.map(op => op.plugin).join(', ')} wait to go in` : 'nothing waits to go in'}`);
      mine.waiting = [...(mine.waiting ?? []), ...gets.map(op => ({ ...op, tries: 0, at }))];
    }
    // No longer due: put in by hand since, or no longer a plugin every other tool has. Marketplaces that couldn't be read say nothing.
    mine.waiting = (mine.waiting ?? []).filter(wait => due.unreadSources.includes(wait.source) || due.joins?.[wait.tool]?.some(op => keyOf(op) === keyOf(wait)));
    // One this check already updates (parts that are behind) is not also installed.
    return auto ? mine.waiting.filter(wait => !due.unreadSources.includes(wait.source) && !ops.some(op => keyOf(op) === keyOf(wait)) && (asked || !wait.tries || at >= wait.at + retryAfter(wait.tries, host.every))) : [];
  }

  /**
   * Keeps what the waiting installs came to. One that went in leaves the list for good (taken out later, it stays out) and
   * is a line of the note; one that failed is tried again later, quietly, and given up after WAITING_TRIES tries.
   */
  function keepJoined(mine: UpdatesRecord, joined: PluginDone[], at: number): boolean {
    const went = joined.filter(entry => succeeded(entry.report));
    for (const entry of joined) {
      const wait = mine.waiting?.find(known => keyOf(known) === keyOf(entry));
      if (!wait) continue;
      const last = wait.tries + 1 >= WAITING_TRIES;
      if (succeeded(entry.report) || last) mine.waiting = mine.waiting!.filter(known => known !== wait);
      else { wait.tries++; wait.at = at; }
      if (!succeeded(entry.report)) host.log(`plugin updates: ${entry.plugin} did not go into ${names[entry.tool]}${last ? ', and is not tried again' : ''}: ${entry.report.message}`);
    }
    // In the words Apply all uses, with why it happened: nobody clicked this.
    const lines = resultLines(went.filter(entry => entry.report.changed), false, { after: true }).map(line => ({ at, source: line.source, plugin: line.plugin, text: `${line.text.replace(/\.$/, '')} (new here; your other tools have this plugin)`, ...(line.ok ? {} : { warn: true as const }) }));
    mine.updated = [...mine.updated, ...lines].slice(-NOTE_LINES);
    return lines.length > 0;
  }

  /** Keeps what a check's updates came to: the note's lines for what changed, and each failure with its count of tries. Says what is news. */
  function keep(mine: UpdatesRecord, ops: DueUpdate[], done: PluginDone[], at: number): 'updated' | 'failed' | undefined {
    const changed = done.filter(entry => succeeded(entry.report) && (entry.report.changed || entry.report.notes?.length));
    // The words Apply all uses, one line per plugin, as read afterwards (Settings says an update can't be undone); a part
    // left alone (edited since, say) is a line of its own to read.
    const lines = resultLines(changed, false, { after: true }).map(line => ({ at, source: line.source, plugin: line.plugin, text: line.text, ...(line.ok ? {} : { warn: true as const }) }));
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
   * One that reached no Git marketplace, or stopped partway through its updates, is made again sooner. (A home where
   * nothing may be changed is looked at again at the usual time.)
   */
  async function tick(): Promise<void> {
    const home = host.home();
    if (!host.on() || host.paused() || running || !home) return;
    const last = (await recordFor(home)).checked;
    if (last && host.now() - last.at < (last.offline || last.partway ? Math.min(host.every, SOON_MS) : host.every)) return;
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
    if (mine.checked) mine.checked = { ...mine.checked, failed: open(mine) };
    await save();
  }

  /**
   * Closes one half of the note: what was updated is no longer listed, or the failures shown now are not shown again while
   * they stay the same. Either way the person has seen a note, so later ones no longer say that this is new.
   */
  async function close(what: 'updated' | 'failed'): Promise<PluginUpdatesView> {
    const home = host.home();
    if (!home) return shown();
    const mine = await recordFor(home);
    mine.told = true;
    if (what === 'updated') mine.updated = [];
    else for (const failure of mine.failures) failure.closed = true;
    if (mine.checked) mine.checked = { ...mine.checked, failed: open(mine) };
    await save();
    return shown();
  }

  /**
   * The tools plugins go into in the open home (the ones Central Knot manages), each time it is read. One not seen here before is new: with plugins changing
   * by themselves a check is made now, not at the schedule's next turn, and it gets what the others have. Otherwise (the
   * switch off, Automatic sync off, or the first time this runs here) it is only noted, so it is never taken for new later.
   */
  async function present(tools: HarnessId[]): Promise<void> {
    const home = host.home();
    if (!home) return;
    const mine = await recordFor(home);
    const unseen = tools.filter(tool => !mine.seenTools?.includes(tool));
    if (!unseen.length) return;
    if (mine.seenTools && host.on() && !host.paused()) { if (!running) await check(); return; }
    mine.seenTools = [...(mine.seenTools ?? []), ...unseen];
    await save();
  }

  /**
   * A tool whose Manage switch was turned off in the open home (toolchoice.ts): no longer one plugins go into here, so it is
   * no longer noted as seen, and what waited to go into it goes. Turned on again, it is new here and gets what the other
   * tools have, as a tool installed later does (present).
   */
  async function forgetTool(tool: HarnessId): Promise<void> {
    const home = host.home();
    if (!home) return;
    const mine = await recordFor(home);
    if (!mine.seenTools?.includes(tool) && !mine.waiting?.some(wait => wait.tool === tool)) return;
    if (mine.seenTools) mine.seenTools = mine.seenTools.filter(seen => seen !== tool);
    if (mine.waiting) mine.waiting = mine.waiting.filter(wait => wait.tool !== tool);
    await save();
  }

  return { view, check, tick, close, settled, underWay, present, forgetTool };
}
