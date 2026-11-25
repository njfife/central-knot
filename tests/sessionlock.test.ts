// Session store lock (src/sessionlock.ts) and sweep exclusion (src/sessionsweep.ts), as worked examples.
process.env.TZ ||= 'America/New_York';

import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SESSION_LOCK_FILE, sessionLockPath, withSessionStoreLock } from '../src/sessionlock.ts';
import { readSessionRecord, sessionsDirectory } from '../src/sessionrecord.ts';
import { readClaudeSession } from '../src/sessionrequests.ts';
import { sweepSessions, type SweepResult } from '../src/sessionsweep.ts';
import { storeDirectory, type ShareContext } from '../src/share.ts';
import { makeWritableTree } from './fslock.ts';

const WORKER = fileURLToPath(new URL('./sessionlock-worker.ts', import.meta.url));
const NOW = Date.UTC(2026, 10, 24, 16, 0, 0);

const tempRoots: string[] = [];
const liveChildren = new Set<ChildProcess>();

const makeTemp = async (prefix = 'ck-sessionlock-') => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
};

after(async () => {
  for (const child of liveChildren) {
    if (child.pid !== undefined) {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  }
  await Promise.all([...liveChildren].map(child => new Promise<void>(resolve => child.once('exit', () => resolve()))));
  for (const dir of tempRoots) {
    await makeWritableTree(dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

const makeContext = async (overrides: Partial<ShareContext> = {}): Promise<ShareContext> => {
  const root = await makeTemp();
  return {
    home: join(root, 'home'),
    mode: 'custom',
    read: async () => [],
    build: 'test-build',
    settingsPath: join(root, 'settings.json'),
    realHome: join(root, 'real'),
    now: () => NOW,
    ...overrides,
  };
};

const lines = (records: object[]) => records.map(record => `${JSON.stringify(record)}\n`).join('');
async function put(path: string, records: object[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines(records));
}

const claudeResp = (id: string, at: string, input: number, output: number) => ({
  type: 'assistant',
  sessionId: 'active',
  cwd: join('work', 'app'),
  isSidechain: false,
  timestamp: at,
  message: {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: 'Done.' }],
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

const pathExists = (path: string) => stat(path).then(() => true, () => false);

type WorkerMessage = Record<string, unknown>;
interface WorkerExit { code: number | null; signal: NodeJS.Signals | null; messages: WorkerMessage[]; stderr: string }

function spawnWorker(args: string[]) {
  const child = fork(WORKER, args, { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  liveChildren.add(child);
  const messages: WorkerMessage[] = [];
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  child.on('message', value => {
    if (typeof value === 'object' && value !== null) messages.push(value as WorkerMessage);
  });
  const timer = setTimeout(() => {
    if (child.pid !== undefined) {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  }, 15_000);
  const done = new Promise<WorkerExit>(resolve => {
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      resolve({ code, signal, messages, stderr });
    });
  });
  const wait = (key: string): Promise<WorkerMessage> => {
    const existing = messages.find(m => key in m);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const onMessage = (value: unknown) => {
        if (typeof value === 'object' && value !== null && key in value) {
          cleanup();
          resolve(value as WorkerMessage);
        }
      };
      const onExit = () => {
        cleanup();
        reject(new Error(`Worker exited before ${key}: ${stderr}`));
      };
      const cleanup = () => {
        child.off('message', onMessage);
        child.off('exit', onExit);
      };
      child.on('message', onMessage);
      child.on('exit', onExit);
    });
  };
  const gateOrExit = (): Promise<{ kind: 'gate' } | { kind: 'done'; exit: WorkerExit }> => {
    if (messages.some(m => 'gate' in m)) return Promise.resolve({ kind: 'gate' });
    return new Promise(resolve => {
      const onMessage = (value: unknown) => {
        if (typeof value === 'object' && value !== null && 'gate' in value) {
          child.off('message', onMessage);
          resolve({ kind: 'gate' });
        }
      };
      child.on('message', onMessage);
      void done.then(exit => {
        child.off('message', onMessage);
        resolve({ kind: 'done', exit });
      });
    });
  };
  return { child, done, wait, gateOrExit, send: (cmd: string) => child.send(cmd) };
}

test('4(a). Two processes sweeping one home: second answers busy and writes nothing; first finishes and next sweep takes the appended request', async () => {
  const ctx = await makeContext();
  const file = join(ctx.home, '.claude', 'projects', '-work-app', 'active.jsonl');
  await put(file, [claudeResp('msg_initial', '2026-11-24T15:00:00.000Z', 100, 20)]);

  const a = spawnWorker(['sweep', ctx.home, 'open:2026-11.json', String(NOW)]);
  await a.wait('ready');
  a.send('go');
  await a.wait('gate');

  await appendFile(file, lines([claudeResp('msg_appended', '2026-11-24T15:01:00.000Z', 200, 40)]));

  const b = spawnWorker(['sweep', ctx.home, 'rename:positions.json', String(NOW)]);
  await b.wait('ready');
  b.send('go');

  let bHitGate = false;
  let aDone: Promise<WorkerExit> | undefined;
  const bFirst = await b.gateOrExit();
  if (bFirst.kind === 'gate') {
    bHitGate = true;
    a.send('release');
    aDone = a.done;
    await aDone;
    b.send('release');
  }

  const bExit = await b.done;
  if (!aDone) {
    a.send('release');
    aDone = a.done;
  }
  const aExit = await aDone;

  const aResult = aExit.messages.find(m => 'result' in m)?.result as SweepResult | undefined;
  const bResult = bExit.messages.find(m => 'result' in m)?.result as SweepResult | undefined;

  const next = await sweepSessions(ctx);
  const kept = await readSessionRecord(ctx.home, ['2026-11']);
  const requests = Object.keys(kept.months['2026-11']?.sessions[0]?.requests ?? {}).sort();

  assert.deepEqual(
    requests,
    ['msg_appended', 'msg_initial'],
    `record must hold both requests (bHitGate=${bHitGate}, bSkipped=${bResult?.skipped}, bWrote=${bResult?.wrote}, nextTaken=${next.taken.requests})`,
  );
  assert.equal(bHitGate, false, 'process B must not reach positions.json while A holds the store');
  assert.equal(bExit.code, 0, bExit.stderr);
  assert.equal(bResult?.skipped, 'busy');
  assert.equal(bResult?.wrote, false);
  assert.deepEqual(bResult?.taken, { requests: 0, sessions: 0 });
  assert.equal(aExit.code, 0, aExit.stderr);
  assert.equal(aResult?.wrote, true);
  assert.deepEqual(aResult?.taken, { requests: 1, sessions: 1 });
  assert.equal(next.wrote, true);
  assert.deepEqual(next.taken, { requests: 1, sessions: 1 });

  const idle = await sweepSessions(ctx);
  assert.equal(idle.wrote, false);
  assert.deepEqual(idle.taken, { requests: 0, sessions: 0 });
});

test('4(b). A lock holder killed by pid releases the OS lock; the next sweep runs cleanly and leaves no journal sidecar', async () => {
  const ctx = await makeContext();
  const file = join(ctx.home, '.claude', 'projects', '-work-app', 'after-crash.jsonl');
  await put(file, [claudeResp('msg_after_kill', '2026-11-24T15:00:00.000Z', 150, 30)]);

  const holder = spawnWorker(['hold', ctx.home]);
  await holder.wait('locked');

  // While the child is alive holding the lock, another sweep skips as busy without reading or writing.
  const whileHeld = await sweepSessions(ctx);
  assert.equal(whileHeld.skipped, 'busy');
  assert.equal(whileHeld.wrote, false);
  assert.deepEqual(await readdir(sessionsDirectory(ctx.home)), [SESSION_LOCK_FILE], 'no sidecar journal file during lock');

  // Kill the holder by pid and await exit without requiring a POSIX signal status (Windows reports non-zero exit code).
  assert.ok(holder.child.pid !== undefined);
  process.kill(holder.child.pid, 'SIGKILL');
  const exit = await holder.done;
  assert.ok(exit.code !== 0 || exit.signal !== null, 'killed holder exited abnormally');
  assert.deepEqual(await readdir(sessionsDirectory(ctx.home)), [SESSION_LOCK_FILE], 'no sidecar journal left after crash');

  const recovered = await sweepSessions(ctx);
  assert.equal(recovered.skipped, undefined);
  assert.equal(recovered.refused, undefined);
  assert.equal(recovered.wrote, true);
  assert.deepEqual(recovered.taken, { requests: 1, sessions: 1 });
  const kept = await readSessionRecord(ctx.home, ['2026-11']);
  assert.ok(kept.months['2026-11']?.sessions[0]?.requests['msg_after_kill']);
});

test('4(c). In one process: concurrent sweep (direct or via linked path) answers busy; lock releases after completion and after error', async () => {
  const ctx = await makeContext();
  const file = join(ctx.home, '.claude', 'projects', '-work-app', 'in-proc.jsonl');
  await put(file, [claudeResp('msg_one', '2026-11-24T15:00:00.000Z', 100, 10)]);

  const aliasHome = join(dirname(ctx.home), 'home-alias');
  await mkdir(ctx.home, { recursive: true });
  await symlink(ctx.home, aliasHome, 'junction');

  let entered!: () => void;
  let release!: () => void;
  const inFirst = new Promise<void>(resolve => { entered = resolve; });
  const holdFirst = new Promise<void>(resolve => { release = resolve; });

  const first = sweepSessions(ctx, {
    deps: {
      readClaude: async (of, from) => {
        const res = await readClaudeSession(of, from);
        entered();
        await holdFirst;
        return res;
      },
    },
  });

  await inFirst;
  let secondListed = 0;
  const second = await sweepSessions(ctx, {
    deps: {
      listClaude: async () => { secondListed++; return { files: [], unread: false }; },
      listCodex: async () => { secondListed++; return { files: [], unread: false }; },
    },
  });
  assert.equal(second.skipped, 'busy');
  assert.equal(second.wrote, false);
  assert.equal(secondListed, 0, 'busy sweep returns before listing');

  // Same canonical home reached via a symlink alias is also busy in-process.
  const viaAlias = await sweepSessions({ ...ctx, home: aliasHome });
  assert.equal(viaAlias.skipped, 'busy');
  assert.equal(viaAlias.wrote, false);

  release();
  const firstResult = await first;
  assert.equal(firstResult.wrote, true);
  assert.deepEqual(firstResult.taken, { requests: 1, sessions: 1 });

  // Re-entrant lock acquisition on the same home returns busy rather than deadlocking, and thrown errors release the lock.
  await assert.rejects(
    withSessionStoreLock(ctx, async () => {
      const nested = await withSessionStoreLock(ctx, async () => 'unreachable');
      assert.equal(nested.status, 'busy');
      throw new Error('boom');
    }),
    /boom/,
  );

  const afterError = await withSessionStoreLock(ctx, async () => 'acquired');
  assert.deepEqual(afterError, { status: 'ok', value: 'acquired' });
});

test('4(d). Homes that cannot be written and symlinked or damaged store paths create no folder or lock file', async () => {
  // All writeAccess refusal inputs (no chmod): held build, real writes off, relative real override, custom reaching realHome.
  const refusedCases: { name: string; make: () => Promise<ShareContext> }[] = [
    { name: 'held build', make: () => makeContext({ held: 'Another build holds this computer.' }) },
    { name: 'real-home writes disabled', make: () => makeContext({ mode: 'actual', allowActualWrites: false }) },
    {
      name: 'relative real override',
      make: () => makeContext({ mode: 'actual', allowActualWrites: true, overrides: { 'claude-cli': 'relative/claude' } }),
    },
    {
      name: 'custom home reaching realHome',
      make: async () => {
        const root = await makeTemp();
        const real = join(root, 'real');
        await mkdir(real, { recursive: true });
        return {
          home: real,
          mode: 'custom',
          read: async () => [],
          build: 'test-build',
          settingsPath: join(root, 'settings.json'),
          realHome: real,
          now: () => NOW,
        };
      },
    },
  ];

  for (const c of refusedCases) {
    const ctx = await c.make();
    const res = await sweepSessions(ctx);
    assert.equal(res.wrote, false, `${c.name}: wrote is false`);
    assert.equal(res.skipped, undefined, `${c.name}: not skipped as busy`);
    assert.ok(res.refused && res.refused.length > 0, `${c.name}: refused states why`);
    assert.equal(await pathExists(sessionsDirectory(ctx.home)), false, `${c.name}: no sessions folder created`);
    assert.equal(await pathExists(sessionLockPath(ctx.home)), false, `${c.name}: no lock file created`);
  }

  // Symlinked `.central-knot` store folder: refused before mkdir, outside target stays empty.
  const storeLinkCtx = await makeContext();
  const outsideStore = await makeTemp('ck-outside-store-');
  await mkdir(storeLinkCtx.home, { recursive: true });
  await symlink(outsideStore, storeDirectory(storeLinkCtx.home), 'junction');
  const storeLinkRes = await sweepSessions(storeLinkCtx);
  assert.equal(storeLinkRes.wrote, false);
  assert.equal(storeLinkRes.skipped, undefined);
  assert.ok(storeLinkRes.refused);
  assert.equal(storeLinkRes.held.some(h => h.file === '.central-knot' && h.kind === 'link'), true);
  assert.deepEqual(await readdir(outsideStore), [], 'nothing created inside symlinked .central-knot');

  // Symlinked `sessions` folder: refused before opening SQLite, outside target stays empty.
  const sessLinkCtx = await makeContext();
  const outsideSess = await makeTemp('ck-outside-sessions-');
  await mkdir(storeDirectory(sessLinkCtx.home), { recursive: true });
  await symlink(outsideSess, sessionsDirectory(sessLinkCtx.home), 'junction');
  const sessLinkRes = await sweepSessions(sessLinkCtx);
  assert.equal(sessLinkRes.wrote, false);
  assert.ok(sessLinkRes.refused);
  assert.equal(sessLinkRes.held.some(h => h.file === 'sessions' && h.kind === 'link'), true);
  assert.deepEqual(await readdir(outsideSess), [], 'nothing created inside symlinked sessions folder');

  // Symlinked `lock.sqlite` entry: refused without opening SQLite.
  const lockLinkCtx = await makeContext();
  const outsideLock = await makeTemp('ck-outside-lock-');
  await mkdir(sessionsDirectory(lockLinkCtx.home), { recursive: true });
  await symlink(outsideLock, sessionLockPath(lockLinkCtx.home), 'junction');
  const lockLinkRes = await sweepSessions(lockLinkCtx);
  assert.equal(lockLinkRes.wrote, false);
  assert.ok(lockLinkRes.refused);
  assert.equal(lockLinkRes.held.some(h => h.file === SESSION_LOCK_FILE && h.kind === 'link'), true);

  // `.central-knot` or `sessions` is a regular file (not a folder): refused as not-a-file, no lock created.
  const storeFileCtx = await makeContext();
  await mkdir(storeFileCtx.home, { recursive: true });
  await writeFile(storeDirectory(storeFileCtx.home), 'not a dir');
  const storeFileRes = await sweepSessions(storeFileCtx);
  assert.equal(storeFileRes.wrote, false);
  assert.equal(storeFileRes.skipped, undefined);
  assert.equal(storeFileRes.held.some(h => h.file === '.central-knot' && h.kind === 'not-a-file'), true);

  const sessFileCtx = await makeContext();
  await mkdir(storeDirectory(sessFileCtx.home), { recursive: true });
  await writeFile(sessionsDirectory(sessFileCtx.home), 'not a dir');
  const sessFileRes = await sweepSessions(sessFileCtx);
  assert.equal(sessFileRes.wrote, false);
  assert.equal(sessFileRes.skipped, undefined);
  assert.equal(sessFileRes.held.some(h => h.file === 'sessions' && h.kind === 'not-a-file'), true);

  // `lock.sqlite` is a folder (not a regular file): refused as not-a-file, not busy.
  const lockDirCtx = await makeContext();
  await mkdir(sessionLockPath(lockDirCtx.home), { recursive: true });
  const lockDirRes = await sweepSessions(lockDirCtx);
  assert.equal(lockDirRes.wrote, false);
  assert.equal(lockDirRes.skipped, undefined);
  assert.equal(lockDirRes.held.some(h => h.file === SESSION_LOCK_FILE && h.kind === 'not-a-file'), true);

  // `lock.sqlite` holds non-SQLite garbage: refused as damaged, never misreported as busy.
  const damagedLockCtx = await makeContext();
  await mkdir(sessionsDirectory(damagedLockCtx.home), { recursive: true });
  await writeFile(sessionLockPath(damagedLockCtx.home), 'not a sqlite database');
  const damagedRes = await sweepSessions(damagedLockCtx);
  assert.equal(damagedRes.wrote, false);
  assert.equal(damagedRes.skipped, undefined);
  assert.ok(damagedRes.refused);
  assert.equal(damagedRes.held.some(h => h.file === SESSION_LOCK_FILE && h.kind === 'damaged'), true);

  // Pre-aborted signal and notBefore return before touching disk: no sessions folder, no lock file.
  const abortedCtx = await makeContext();
  const controller = new AbortController();
  controller.abort();
  const aborted = await sweepSessions(abortedCtx, { signal: controller.signal });
  assert.equal(aborted.stopped, true);
  assert.equal(await pathExists(sessionsDirectory(abortedCtx.home)), false);

  const notBeforeCtx = await makeContext();
  const notBefore = await sweepSessions(notBeforeCtx, { notBefore: NOW + 1_000 });
  assert.equal(notBefore.skipped, 'not-before');
  assert.equal(await pathExists(sessionsDirectory(notBeforeCtx.home)), false);
});
