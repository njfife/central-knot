// Per-home session-cost consent, store-path guards, 15-minute sweep timer, re-entry, and Quit (src/sessionkeep.ts), as worked examples.
process.env.TZ ||= 'America/New_York';

import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { canonicalHome, createSessionKeeper, SWEEP_EVERY_MS, type SessionKeepHost } from '../src/sessionkeep.ts';
import { SESSION_LOCK_FILE, sessionLockPath } from '../src/sessionlock.ts';
import { listSessionMonths, monthOf, readSessionRecord, sessionsDirectory } from '../src/sessionrecord.ts';
import { sweepSessions, type SweepOptions, type SweepResult } from '../src/sessionsweep.ts';
import { writeDurably, type ShareContext } from '../src/share.ts';
import type { SessionCostsView } from '../src/types.ts';
import { record } from '../src/values.ts';
import { lockSkip, withLock } from './fslock.ts';

const NOW = Date.UTC(2026, 10, 25, 14, 0, 0);
const tempRoots: string[] = [];

const makeTemp = async (prefix = 'ck-sessionkeep-') => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
};

after(async () => {
  for (const dir of tempRoots) {
    await rm(dir, { recursive: true, force: true });
  }
});

const pathExists = (path: string) => stat(path).then(() => true, () => false);

const claudeRecord = (session: string, id: string, at: string, input = 10_000, output = 1_000) => ({
  type: 'assistant',
  sessionId: session,
  cwd: join('work', 'app'),
  isSidechain: false,
  timestamp: at,
  message: {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: 'Stand-in reply.' }],
    usage: {
      input_tokens: input,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: output,
      service_tier: 'standard',
      speed: 'standard',
    },
  },
});

const codexRecords = (session: string, id: string, at: string, input = 20_000, output = 2_000) => [
  { timestamp: at, type: 'session_meta', payload: { id: session, session_id: session, cwd: join('work', 'codex'), model_provider: 'openai' } },
  { timestamp: at, type: 'turn_context', payload: { turn_id: `turn-${id}`, cwd: join('work', 'codex'), model: 'gpt-6-astra' } },
  {
    timestamp: at,
    type: 'token_usage_record',
    payload: {
      response_id: id,
      usage: { input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output },
    },
  },
];

async function writeLines(path: string, items: object[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${items.map(item => JSON.stringify(item)).join('\n')}\n`);
}

function makeFakeClock(start = NOW) {
  let time = start;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => time,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, fn });
      return () => { timers.delete(id); };
    },
    pendingCount: () => timers.size,
    async advance(ms: number) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, entry] = due;
        timers.delete(id);
        time = entry.at;
        entry.fn();
        await new Promise(resolve => setImmediate(resolve));
      }
      time = target;
    },
  };
}

interface Harness {
  root: string;
  settingsFile: string;
  clock: ReturnType<typeof makeFakeClock>;
  views: SessionCostsView[];
  logs: string[];
  current: { context: ShareContext };
  settings: Record<string, unknown>;
  saveError?: Error;
  keeper: ReturnType<typeof createSessionKeeper>;
  openHome: (home: string, overrides?: Partial<ShareContext>) => Promise<string>;
  waitIdle: () => Promise<void>;
  readSavedSettings: () => Promise<Record<string, unknown> | undefined>;
}

async function makeHarness(options: {
  sweep?: SessionKeepHost['sweep'];
  everyMs?: number;
  initialSettings?: Record<string, unknown>;
} = {}): Promise<Harness> {
  const root = await makeTemp();
  const realHome = join(root, 'real');
  const settingsFile = join(root, 'app-settings.json');
  const sharingFile = join(root, 'sharing-settings.json');
  await mkdir(realHome, { recursive: true });
  const clock = makeFakeClock(NOW);
  const views: SessionCostsView[] = [];
  const logs: string[] = [];
  let settings: Record<string, unknown> = options.initialSettings ? structuredClone(options.initialSettings) : {};
  if (options.initialSettings) {
    await writeDurably(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  }
  let writes: Promise<unknown> = Promise.resolve();
  let saveError: Error | undefined;
  let activeSweeps = 0;
  const idleWaiters: (() => void)[] = [];
  const notifyIdle = () => {
    if (activeSweeps === 0) idleWaiters.splice(0).forEach(done => done());
  };

  const makeContext = (home: string, overrides: Partial<ShareContext> = {}): ShareContext => ({
    home,
    mode: 'custom',
    read: async () => [],
    build: 'test-build',
    settingsPath: sharingFile,
    realHome,
    now: clock.now,
    ...overrides,
  });

  const current = { context: makeContext(join(root, 'unused')) };
  const baseSweep = options.sweep ?? sweepSessions;

  const keeper = createSessionKeeper({
    context: () => current.context,
    isKept: key => record(settings.keepSessionCosts)?.[key] === true,
    saveConsent: (key, on) => {
      const write = writes.then(async () => {
        if (saveError) throw saveError;
        const next = {
          ...settings,
          keepSessionCosts: { ...(record(settings.keepSessionCosts) ?? {}), [key]: on },
        };
        await writeDurably(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
        settings = next;
      });
      writes = write.catch(() => undefined);
      return write;
    },
    changed: view => views.push(view),
    log: line => logs.push(line),
    sweep: async (ctx, opts) => {
      activeSweeps++;
      try {
        return await baseSweep(ctx, opts);
      } finally {
        activeSweeps--;
        notifyIdle();
      }
    },
    everyMs: options.everyMs ?? SWEEP_EVERY_MS,
    schedule: clock.schedule,
  });

  const harness: Harness = {
    root,
    settingsFile,
    clock,
    views,
    logs,
    current,
    get settings() { return settings; },
    set saveError(err: Error | undefined) { saveError = err; },
    get saveError() { return saveError; },
    keeper,
    async openHome(home, overrides = {}) {
      await mkdir(home, { recursive: true });
      const key = await canonicalHome(home);
      current.context = makeContext(home, overrides);
      keeper.homeOpened(home, key);
      return key;
    },
    async waitIdle() {
      for (let round = 0; round < 5; round++) {
        if (activeSweeps > 0) await new Promise<void>(resolve => idleWaiters.push(resolve));
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    async readSavedSettings() {
      const raw = await readFile(settingsFile, 'utf8').catch(() => undefined);
      return raw ? JSON.parse(raw) as Record<string, unknown> : undefined;
    },
  };
  return harness;
}

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('Check 1: nothing is created or written before the click; clicking keeps stand-in files and consents only that home', async () => {
  const h = await makeHarness();
  const homeA = join(h.root, 'home-a');
  const homeB = join(h.root, 'home-b');
  const at = new Date(NOW - 60_000).toISOString();
  await writeLines(join(homeA, '.claude/projects/-work-app/s1.jsonl'), [claudeRecord('s1', 'm1', at)]);
  await writeLines(join(homeA, '.codex/sessions/2026/11/25/rollout-c1.jsonl'), codexRecords('c1', 'r1', at));
  await writeLines(join(homeB, '.claude/projects/-work-app/s2.jsonl'), [claudeRecord('s2', 'm2', at)]);

  const keyA = await h.openHome(homeA);
  const keyB = await canonicalHome(homeB);
  await h.clock.advance(4 * SWEEP_EVERY_MS);
  await h.waitIdle();

  assert.equal(await pathExists(sessionsDirectory(homeA)), false, 'no sessions folder before the click');
  assert.equal(await pathExists(sessionLockPath(homeA)), false, 'no lock.sqlite before the click');
  assert.equal(await h.readSavedSettings(), undefined, 'no app-settings.json entry before the click');
  assert.equal(h.keeper.view(homeA).on, false);
  assert.equal(h.keeper.view(homeA).collecting, false);

  // Pre-existing receipts on disk are never taken as consent.
  const homeC = join(h.root, 'home-c');
  await mkdir(sessionsDirectory(homeC), { recursive: true });
  await writeFile(join(sessionsDirectory(homeC), '2026-11.json'), JSON.stringify({ formatVersion: 1, month: '2026-11', pricings: [], sessions: [] }));
  await h.openHome(homeC);
  await h.clock.advance(4 * SWEEP_EVERY_MS);
  await h.waitIdle();
  assert.equal(h.keeper.view(homeC).on, false, 'receipts on disk do not establish consent');
  assert.equal(await pathExists(sessionLockPath(homeC)), false, 'no sweep ran on unconsented home with receipts');

  // Reopen Home A and click Start keeping session costs.
  await h.openHome(homeA);
  const reply = await h.keeper.setKeep(homeA, true);
  assert.equal(reply.refused, undefined);
  assert.equal(reply.on, true);
  await h.waitIdle();

  const saved = await h.readSavedSettings();
  const keptMap = record(saved?.keepSessionCosts);
  assert.equal(keptMap?.[keyA], true, 'consent saved on for canonical Home A');
  assert.equal(Object.hasOwn(keptMap ?? {}, keyB), false, 'no consent entry for untouched Home B');

  // Opening Home A through a symlink resolves to the same canonical consent key.
  const aliasA = join(h.root, 'home-a-link');
  await symlink(homeA, aliasA);
  await h.openHome(aliasA);
  assert.equal(h.keeper.view(aliasA).on, true, 'symlinked path shares canonical consent key');
  await h.waitIdle();

  // Turning off an untouched home writes no default Off into app-settings.json.
  await h.openHome(homeB);
  await h.keeper.setKeep(homeB, false);
  const savedAfterOff = await h.readSavedSettings();
  assert.equal(Object.hasOwn(record(savedAfterOff?.keepSessionCosts) ?? {}, keyB), false, 'never writes default Off for untouched home');

  const months = await listSessionMonths(homeA);
  assert.deepEqual(months, [monthOf(NOW - 60_000)]);
  const rec = await readSessionRecord(homeA, months);
  const keys = rec.months[months[0]!]!.sessions.flatMap(s => Object.keys(s.requests).map(r => `${s.tool}:${r}`)).sort();
  assert.deepEqual(keys, ['claude-cli:m1', 'codex-cli:r1'], 'kept record holds both stand-in tools’ requests');
  assert.equal(h.keeper.view(homeA).collecting, false);
  assert.equal(await pathExists(sessionsDirectory(homeB)), false, 'Home B untouched');
});

test('Check 2: turning off stops future ticks, leaves the record untouched, and puts the button state back', async () => {
  const h = await makeHarness();
  const home = join(h.root, 'home-switch');
  const file = join(home, '.claude/projects/-work-app/s1.jsonl');
  const at1 = new Date(NOW - 120_000).toISOString();
  await writeLines(file, [claudeRecord('s1', 'm1', at1)]);

  await h.openHome(home);
  await h.keeper.setKeep(home, true);
  await h.waitIdle();
  assert.equal(h.keeper.view(home).on, true);

  const month = monthOf(NOW - 120_000);
  const monthPath = join(sessionsDirectory(home), `${month}.json`);
  const beforeBytes = await readFile(monthPath, 'utf8');

  const off = await h.keeper.setKeep(home, false);
  assert.equal(off.on, false);
  assert.equal(off.collecting, false);

  // Append a new request and advance two ticks: nothing sweeps and the record is untouched.
  const at2 = new Date(NOW - 60_000).toISOString();
  await appendFile(file, `${JSON.stringify(claudeRecord('s1', 'm2', at2))}\n`);
  await h.clock.advance(2 * SWEEP_EVERY_MS);
  await h.waitIdle();

  assert.equal(await readFile(monthPath, 'utf8'), beforeBytes, 'record unchanged after turning off');
  assert.equal(h.keeper.view(home).on, false, 'button state back on Sessions page');
});

test('Check 3: timer sweeps after opening and every 15 minutes, skips ticks while running, and stops on home switch', async () => {
  const calls: { home: string; signal: AbortSignal }[] = [];
  let gate: ReturnType<typeof deferred<void>> | undefined;
  const h = await makeHarness({
    sweep: async (ctx, opts) => {
      calls.push({ home: ctx.home, signal: opts.signal! });
      if (gate) await gate.promise;
      return sweepSessions(ctx, opts);
    },
  });

  const homeA = join(h.root, 'timer-a');
  const homeB = join(h.root, 'timer-b');
  const homeC = join(h.root, 'timer-c');
  await mkdir(homeA, { recursive: true });
  await mkdir(homeB, { recursive: true });
  await mkdir(homeC, { recursive: true });

  // Enable consent on Home A and Home C; leave Home B unconsented.
  await h.openHome(homeA);
  await h.keeper.setKeep(homeA, true);
  await h.waitIdle();
  await h.openHome(homeC);
  await h.keeper.setKeep(homeC, true);
  await h.waitIdle();
  calls.length = 0;

  // Reopen Home A: sweep runs after opening.
  await h.openHome(homeA);
  await h.waitIdle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.home, homeA);

  // 15 minutes later: second sweep starts, held open; another 15 minutes skips the tick while running.
  gate = deferred<void>();
  await h.clock.advance(SWEEP_EVERY_MS);
  assert.equal(calls.length, 2);
  await h.clock.advance(SWEEP_EVERY_MS);
  assert.equal(calls.length, 2, 'tick skipped while a sweep is running');

  // Switch to unconsented Home B while sweep #2 runs: stop signal raised on #2, no sweep for B.
  await h.openHome(homeB);
  assert.equal(calls[1]!.signal.aborted, true, 'home switch raises abort on old sweep');
  gate.resolve();
  gate = undefined;
  await h.waitIdle();
  await h.clock.advance(2 * SWEEP_EVERY_MS);
  await h.waitIdle();
  assert.equal(calls.length, 2, 'no sweep for unconsented Home B');

  // Switch to consented Home C: next sweep is Home C's own.
  await h.openHome(homeC);
  await h.waitIdle();
  assert.equal(calls.length, 3);
  assert.equal(calls[2]!.home, homeC);
});

test('Check 4: rapid re-entry (off/on twice, and A→B→A) finishes one sweep for the current home and drops stale answers', async () => {
  const started: { home: string; signal: AbortSignal; done: ReturnType<typeof deferred<SweepResult>> }[] = [];
  const h = await makeHarness({
    sweep: async (ctx, opts) => {
      const done = deferred<SweepResult>();
      started.push({ home: ctx.home, signal: opts.signal!, done });
      return done.promise;
    },
  });
  const okResult = (sweptAt = NOW): SweepResult => ({
    taken: { requests: 1, sessions: 1 },
    byTool: {
      'claude-cli': { requests: 1, sessions: 1, unreadListing: false, unreadableFiles: 0, unreadLines: 0 },
      'codex-cli': { requests: 0, sessions: 0, unreadListing: false, unreadableFiles: 0, unreadLines: 0 },
    },
    notTaken: { held: 0, notRead: 0, never: 0 },
    held: [],
    stopped: false,
    wrote: true,
    sweptAt,
  });

  const homeA = join(h.root, 'reentry-a');
  const homeB = join(h.root, 'reentry-b');
  await h.openHome(homeA);
  await h.keeper.setKeep(homeA, true);
  assert.equal(started.length, 1);

  // Off and on twice while sweep #1 is still in its batch.
  await h.keeper.setKeep(homeA, false);
  await h.keeper.setKeep(homeA, true);
  await h.keeper.setKeep(homeA, false);
  await h.keeper.setKeep(homeA, true);
  assert.equal(started[0]!.signal.aborted, true);
  assert.equal(started.length, 1, 'no overlapping sweep starts while old batch runs');

  // Old sweep resolves with a stale refusal: must be dropped and trigger exactly one fresh run.
  const viewsBefore = h.views.length;
  started[0]!.done.resolve({ ...okResult(), refused: 'stale refusal', stopped: true, wrote: false });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.length, 2, 'exactly one replacement sweep started after old batch ended');
  assert.equal(h.views.slice(viewsBefore).some(v => v.refused === 'stale refusal'), false, 'stale answer dropped');

  // Now switch A → B → A while sweep #2 is in flight.
  await h.openHome(homeB);
  await h.openHome(homeA);
  assert.equal(started[1]!.signal.aborted, true);
  assert.equal(started.length, 2, 'still waiting for sweep #2 batch before restarting');

  const viewsBefore2 = h.views.length;
  started[1]!.done.resolve({ ...okResult(), refused: 'stale A->B->A refusal', stopped: true, wrote: false });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.length, 3, 'one fresh sweep runs for Home A');
  assert.equal(started[2]!.home, homeA);
  assert.equal(h.views.slice(viewsBefore2).some(v => v.refused !== undefined), false, 'stale answer dropped');

  started[2]!.done.resolve(okResult());
  await h.waitIdle();
  assert.deepEqual(h.keeper.view(homeA), { home: homeA, on: true, collecting: false, seq: h.keeper.view(homeA).seq });

  // Stale refusal arriving after turning off (no pending restart) is also dropped.
  await h.clock.advance(SWEEP_EVERY_MS);
  assert.equal(started.length, 4);
  await h.keeper.setKeep(homeA, false);
  const viewsAfterOff = h.views.length;
  started[3]!.done.resolve({ ...okResult(), refused: 'stale after off', stopped: true, wrote: false });
  await h.waitIdle();
  assert.equal(h.keeper.view(homeA).refused, undefined, 'stale refusal after off does not leak onto view');
  assert.equal(h.views.length, viewsAfterOff, 'no stale view published after off');
});

test('Check 5: a click while the timer’s sweep runs joins it with one Collecting… and one result', async () => {
  const runs: ReturnType<typeof deferred<void>>[] = [];
  const h = await makeHarness({
    sweep: async (ctx, opts) => {
      const gate = deferred<void>();
      runs.push(gate);
      await gate.promise;
      return sweepSessions(ctx, opts);
    },
  });
  const home = join(h.root, 'join-home');
  await h.openHome(home);
  await h.keeper.setKeep(home, true);
  runs[0]!.resolve();
  await h.waitIdle();

  // Timer starts sweep #2.
  h.views.length = 0;
  await h.clock.advance(SWEEP_EVERY_MS);
  assert.equal(runs.length, 2);
  assert.equal(h.keeper.view(home).collecting, true);

  // Click while sweep #2 is running: joins without starting a third sweep or duplicating Collecting…
  const reply = await h.keeper.setKeep(home, true);
  assert.equal(reply.refused, undefined);
  assert.equal(reply.collecting, true);
  assert.equal(runs.length, 2, 'joined active sweep instead of starting another');

  runs[1]!.resolve();
  await h.waitIdle();
  assert.deepEqual(
    h.views.map(v => v.collecting),
    [true, false],
    'one Collecting… transition and one finished result',
  );
});

test('Check 6: a settings save that fails leaves consent off, sweeps nothing, and reports why', async () => {
  let swept = 0;
  const h = await makeHarness({
    sweep: async (ctx, opts) => {
      swept++;
      return sweepSessions(ctx, opts);
    },
  });
  const home = join(h.root, 'save-fail');
  await h.openHome(home);
  h.saveError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });

  await assert.rejects(() => h.keeper.setKeep(home, true), /EACCES/);
  assert.equal(h.keeper.view(home).on, false);
  assert.equal(h.keeper.view(home).collecting, false);
  assert.equal(swept, 0, 'nothing swept when settings save failed');
  assert.equal(await pathExists(sessionsDirectory(home)), false);
  assert.equal(await h.readSavedSettings(), undefined);
});

test('Check 7: an unwritable home or bad store path refuses in the record’s own words and leaves consent off', async () => {
  const h = await makeHarness();

  // (a) Real home with writes disabled (writeAccess refusal).
  const realHome = join(h.root, 'readonly-real');
  await h.openHome(realHome, { mode: 'actual', allowActualWrites: false });
  const r1 = await h.keeper.setKeep(realHome, true);
  assert.match(r1.refused ?? '', /Preview only:/);
  assert.equal(h.keeper.view(realHome).on, false);
  assert.equal(await pathExists(sessionsDirectory(realHome)), false);
  assert.equal(await h.readSavedSettings(), undefined);

  // (b) Held build.
  const heldHome = join(h.root, 'held-home');
  const heldMsg = 'Central Knot Alpha is also installed on this Mac.';
  await h.openHome(heldHome, { held: heldMsg });
  const r2 = await h.keeper.setKeep(heldHome, true);
  assert.equal(r2.refused, heldMsg);
  assert.equal(h.keeper.view(heldHome).on, false);
  assert.equal(await pathExists(sessionsDirectory(heldHome)), false);

  // (c) Symlinked sessions folder (checked via sessionlock.ts without creating anything).
  const linkHome = join(h.root, 'link-home');
  const outside = join(h.root, 'outside');
  await mkdir(outside, { recursive: true });
  await mkdir(join(linkHome, '.central-knot'), { recursive: true });
  await symlink(outside, sessionsDirectory(linkHome));
  await h.openHome(linkHome);
  const r3 = await h.keeper.setKeep(linkHome, true);
  assert.equal(r3.refused, 'The sessions folder is a link.');
  assert.equal(h.keeper.view(linkHome).on, false);
  assert.equal(await pathExists(join(outside, SESSION_LOCK_FILE)), false);

  // (d) Non-empty lock.sqlite (checked via sessionlock.ts).
  const badLockHome = join(h.root, 'bad-lock-home');
  await mkdir(sessionsDirectory(badLockHome), { recursive: true });
  await writeFile(sessionLockPath(badLockHome), 'not-empty');
  await h.openHome(badLockHome);
  const r4 = await h.keeper.setKeep(badLockHome, true);
  assert.equal(r4.refused, 'lock.sqlite is not empty. Remove it to clear the lock.');
  assert.equal(h.keeper.view(badLockHome).on, false);

  // (e) Request for a home that is not open on screen.
  const r5 = await h.keeper.setKeep(join(h.root, 'not-open'), true);
  assert.match(r5.refused ?? '', /not the one open/i);
  assert.equal(await h.readSavedSettings(), undefined);

  // (f) Read-only .central-knot folder: refused before saving consent.
  if (!lockSkip) {
    const roHome = join(h.root, 'readonly-store');
    await mkdir(join(roHome, '.central-knot'), { recursive: true });
    await h.openHome(roHome);
    await withLock(join(roHome, '.central-knot'), 'dir-readonly', async () => {
      const r6 = await h.keeper.setKeep(roHome, true);
      assert.equal(r6.refused, 'The sessions folder could not be created.');
      assert.equal(h.keeper.view(roHome).on, false);
      assert.equal(await h.readSavedSettings(), undefined);
    });
  }
});

test('Check 8: Quit during a blocked sweep raises abort immediately and adds no wait', async () => {
  const blocked = deferred<void>();
  let seenSignal: AbortSignal | undefined;
  const h = await makeHarness({
    sweep: async (_ctx, opts: SweepOptions) => {
      seenSignal = opts.signal;
      await blocked.promise;
      return {
        taken: { requests: 0, sessions: 0 },
        byTool: {
          'claude-cli': { requests: 0, sessions: 0, unreadListing: false, unreadableFiles: 0, unreadLines: 0 },
          'codex-cli': { requests: 0, sessions: 0, unreadListing: false, unreadableFiles: 0, unreadLines: 0 },
        },
        notTaken: { held: 0, notRead: 0, never: 0 },
        held: [],
        stopped: true,
        wrote: false,
        sweptAt: NOW,
      };
    },
  });
  const home = join(h.root, 'quit-home');
  await h.openHome(home);
  await h.keeper.setKeep(home, true);
  assert.ok(seenSignal, 'sweep started');
  assert.equal(seenSignal.aborted, false);

  const startedAt = Date.now();
  h.keeper.quit();
  const elapsed = Date.now() - startedAt;

  assert.equal(seenSignal.aborted, true, 'Quit raises stop on running sweep');
  assert.equal(h.clock.pendingCount(), 0, 'Quit clears the scheduled timer');
  assert.ok(elapsed < 50, `Quit returned synchronously without waiting (${elapsed}ms)`);

  // Release the blocked batch after quit: no views published, no restart.
  const viewsAtQuit = h.views.length;
  blocked.resolve();
  await h.waitIdle();
  assert.equal(h.views.length, viewsAtQuit, 'no answer published after Quit');
});

test('Check 9: sweeps continue on schedule independently of Automatic sync', async () => {
  const h = await makeHarness();
  const home = join(h.root, 'sync-off-home');
  const file = join(home, '.claude/projects/-work-app/s1.jsonl');
  await writeLines(file, [claudeRecord('s1', 'm1', new Date(NOW - 120_000).toISOString())]);

  // Keeper takes no syncOn flag at all: turning Automatic sync off never pauses sweeps.
  await h.openHome(home);
  await h.keeper.setKeep(home, true);
  await h.waitIdle();

  await appendFile(file, `${JSON.stringify(claudeRecord('s1', 'm2', new Date(NOW - 30_000).toISOString()))}\n`);
  await h.clock.advance(SWEEP_EVERY_MS);
  await h.waitIdle();

  const month = monthOf(NOW - 120_000);
  const rec = await readSessionRecord(home, [month]);
  const ids = Object.keys(rec.months[month]!.sessions[0]!.requests).sort();
  assert.deepEqual(ids, ['m1', 'm2']);
});

test('Fix 1 (slow home switch): timer and Start never check or sweep an unconsented home whose context swapped before homeOpened', async () => {
  for (const trigger of ['timer', 'Start'] as const) {
    const h = await makeHarness();
    const a = join(h.root, 'a');
    const b = join(h.root, 'b');
    const at = new Date(NOW - 60_000).toISOString();
    await writeLines(join(a, '.claude/projects/-work-a/a.jsonl'), [claudeRecord('a', 'a-id', at)]);
    await writeLines(join(b, '.claude/projects/-work-b/b.jsonl'), [claudeRecord('b', 'b-id', at, 40_000, 3000)]);
    await h.openHome(a);
    if (trigger === 'timer') {
      await h.keeper.setKeep(a, true);
      await h.waitIdle();
    }
    await h.clock.advance(SWEEP_EVERY_MS - 1);
    assert.equal(await pathExists(sessionsDirectory(b)), false);
    const delay = deferred();
    // main.ts assigns current before awaiting the opening read, then calls homeOpened later.
    const switching = (async () => {
      h.current.context = { ...h.current.context, home: b };
      await delay.promise;
      return h.keeper.homeOpened(b, await canonicalHome(b));
    })();
    try {
      if (trigger === 'timer') {
        await h.clock.advance(1);
      } else {
        const reply = await h.keeper.setKeep(a, true);
        assert.match(reply.refused ?? '', /not the one open/i, 'Start during a slow switch refuses without checking B');
        assert.equal(await h.readSavedSettings(), undefined, 'Start during a slow switch saves no consent');
      }
      await h.waitIdle();
      assert.equal(await pathExists(sessionsDirectory(b)), false, `${trigger}: unconsented destination B gets no sessions folder`);
      assert.equal(await pathExists(sessionLockPath(b)), false, `${trigger}: unconsented destination B gets no lock.sqlite`);
    } finally {
      delay.resolve();
      await switching;
      h.keeper.quit();
    }
    assert.equal(h.keeper.view(b).on, false);
    assert.equal(h.keeper.view(b).collecting, false);
    assert.equal(await pathExists(sessionsDirectory(b)), false, `${trigger}: B stays untouched after homeOpened finishes`);
  }
});

test('Fix 2 (monotonic keeper sequence): a sweep completion view outranks an earlier collecting snapshot', async () => {
  const gate = deferred<void>();
  const h = await makeHarness({
    sweep: async (ctx, opts) => {
      await gate.promise;
      return sweepSessions(ctx, opts);
    },
  });
  const home = join(h.root, 'seq-home');
  await h.openHome(home);
  await h.keeper.setKeep(home, true);
  const during = h.keeper.view(home);
  assert.equal(during.collecting, true);
  gate.resolve();
  await h.waitIdle();
  const after = h.keeper.view(home);
  assert.equal(after.collecting, false);
  assert.ok(typeof during.seq === 'number' && typeof after.seq === 'number' && after.seq > during.seq,
    `completion seq (${after.seq}) must exceed earlier collecting snapshot seq (${during.seq})`);
});

test('A sweep the Sessions page asks for: started for the open home that keeps, the one under way joined, none for another home or one that does not keep', async () => {
  const calls: string[] = [];
  let gate: ReturnType<typeof deferred<void>> | undefined;
  const h = await makeHarness({
    sweep: async (ctx, opts) => {
      calls.push(ctx.home);
      if (gate) await gate.promise;
      return sweepSessions(ctx, opts);
    },
  });
  const home = join(h.root, 'home-ask');
  await writeLines(join(home, '.claude/projects/-work-app/s1.jsonl'), [claudeRecord('s1', 'm1', new Date(NOW - 60_000).toISOString())]);
  await h.openHome(home);
  await h.keeper.setKeep(home, true);
  await h.waitIdle();
  calls.length = 0;
  gate = deferred();
  h.keeper.sweepNow(home);
  const asked = h.keeper.view(home);
  assert.deepEqual([asked.collecting, calls.length], [true, 1], 'a sweep starts');
  h.keeper.sweepNow(home);
  assert.deepEqual([h.keeper.view(home).collecting, h.keeper.view(home).seq, calls.length], [true, asked.seq, 1], 'asked again while it runs: joined, not started twice');
  gate.resolve();
  gate = undefined;
  await h.waitIdle();
  const ended = h.views.at(-1)!;
  assert.deepEqual([ended.collecting, ended.seq! > asked.seq!], [false, true], 'its end is news on a later seq');
  h.keeper.sweepNow(join(h.root, 'home-other'));
  assert.deepEqual([h.keeper.view(home).collecting, calls.length], [false, 1], 'another home than the open one: no sweep');
  await h.keeper.setKeep(home, false);
  h.keeper.sweepNow(home);
  assert.deepEqual([h.keeper.view(home).collecting, calls.length], [false, 1], 'a home that does not keep: no sweep');
});

async function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

test('canonicalHome folds capitals on macOS, preserves them on Linux, and misses a raw realpath entry on macOS', async () => {
  const root = await makeTemp();
  const mixedHome = join(root, 'KeepCostsMac', 'HomeA');
  await mkdir(mixedHome, { recursive: true });
  const real = await realpath(mixedHome);
  assert.notEqual(real, real.toLowerCase(), 'fixture path contains capitals');

  const macKey = await withPlatform('darwin', () => canonicalHome(mixedHome));
  const linuxKey = await withPlatform('linux', () => canonicalHome(mixedHome));
  assert.equal(macKey, real.toLowerCase(), 'macOS consent key folds capitals');
  assert.notEqual(macKey, real, 'macOS consent key differs from raw realpath when path has capitals');
  assert.equal(linuxKey, real, 'Linux consent key preserves capitals');

  const rawSeeded = await makeHarness({ initialSettings: { keepSessionCosts: { [real]: true } } });
  rawSeeded.current.context = { ...rawSeeded.current.context, home: mixedHome };
  assert.equal(rawSeeded.keeper.homeOpened(mixedHome, macKey).on, false, 'pre-seeding raw realpath misses consent on macOS');
});
