import { test, type TestContext } from 'node:test';
import { EventEmitter, once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK_EVERY_MS, FIRST_CHECK_MS, FRESH_MS, RESTART_MS, STALLED_MS, updateFlow, type PendingUpdate } from '../src/updateflow.ts';
import { prepareUnfinished } from '../src/updates.ts';
import type { UpdateRelease, UpdateView } from '../src/types.ts';
import { within } from './within.ts';

const RELEASES = 'https://fixture.test/releases';
const zipOf = (tag: string) => `https://fixture.test/download/${tag}/Central-Knot-0.5.0-mac-arm64.zip`;
/** A release as GitHub's API lists it. */
const listed = (tag: string, size = 1000) => ({
  tag_name: tag, draft: false, prerelease: true, html_url: `https://github.com/njfife/central-knot/releases/tag/${tag}`,
  assets: [{ name: 'Central-Knot-0.5.0-mac-arm64.zip', browser_download_url: zipOf(tag), size }],
});
/** A download's answer: `sent` bytes, then the end, or with `open` a connection that stays open and says nothing more. */
const bytes = (sent: number, open = false) => new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array(sent)); if (!open) stream.close(); } }));

/** install() returns at the click. Its final action, after deciding whether to restart, removes the zip's folder. */
async function folderRemoved(temp: string) {
  const watcher = watch(temp);
  try {
    await within('the download’s folder removed', (async () => {
      while (readdirSync(temp).length) await once(watcher, 'change');
    })());
  } finally { watcher.close(); }
}

/**
 * An installed preview 6 with a stand-in for everything outside the steps. Tests change what the stand-ins answer: `list` (the
 * releases), `download` (the zip's answer), `prepare` (Squirrel's), `quit` (the restart), `save` (the settings file).
 */
function installed(t: TestContext, { tag = 'v0.5.0-preview.6', untagged = false, pending = undefined as PendingUpdate | undefined, page = true, platform = 'darwin', reason = undefined as UpdateView['reason'] } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const temp = mkdtempSync(join(tmpdir(), 'ck-updateflow-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const changes = new EventEmitter();
  const changed = () => changes.emit('change');
  const world = {
    // Check first in case the stand-in has already reported it. Only another report wakes the waiter.
    until: (what: string, met: () => boolean) => within(what, (async () => {
      while (!met()) await once(changes, 'change');
    })()),
    list: [listed('v0.5.0-preview.7')] as unknown[],
    status: 200,
    /** Held while set: a check that hasn't been answered yet. */
    held: undefined as Promise<void> | undefined,
    reads: 0,
    download: (_signal: AbortSignal): Response | Promise<Response> => bytes(1000),
    prepare: async (_release: UpdateRelease, _zip: string): Promise<void> => undefined,
    prepared: [] as { tag: string; bytes: number }[],
    quit: () => undefined as void,
    quits: 0,
    save: async (_pending: PendingUpdate | undefined): Promise<void> => undefined,
    pending,
    saves: [] as (string | undefined)[],
    quitting: false,
    page,
    late: (_error?: Error): void => undefined,
    log: [] as string[],
    view: undefined as UpdateView | undefined,
    temp,
    tick: (ms: number) => t.mock.timers.tick(ms),
  };
  const flow = updateFlow({
    log: line => world.log.push(line),
    send: view => { world.view = view; changed(); },
    hasPage: () => world.page,
    queued: work => work(),
    pending: () => world.pending,
    savePending: async next => { await world.save(next); world.pending = next; world.saves.push(next?.tag); changed(); },
    quitting: on => { world.quitting = on; },
  }, {
    shown: true, platform, version: '0.5.0', tag: untagged ? undefined : tag, releasesUrl: RELEASES,
    fetch: async (url, { signal }) => {
      if (url !== RELEASES) return world.download(signal);
      world.reads += 1;
      changed();
      await world.held;
      return new Response(JSON.stringify(world.list), { status: world.status });
    },
    reason: async () => reason,
    temp: () => temp,
    prepare: async (release, zip) => { world.prepared.push({ tag: release.tag, bytes: statSync(zip).size }); await world.prepare(release, zip); },
    onLate: heard => { world.late = heard; },
    quitAndInstall: () => { world.quits += 1; changed(); world.quit(); },
  });
  return { world, flow };
}

/** After the launch's own check: preview 7 is offered. */
async function offered(t: TestContext, options?: Parameters<typeof installed>[1]) {
  const app = installed(t, options);
  await app.flow.view();
  app.world.tick(FIRST_CHECK_MS);
  await app.world.until('the first check', () => !!app.world.view?.checked && !app.world.view.checking);
  return app;
}
const step = (world: { view?: UpdateView }) => world.view?.step;

test('the first check runs shortly after launch, and then every quarter of an hour', async t => {
  const { world, flow } = installed(t);
  await flow.view();
  assert.equal(world.reads, 0, 'nothing is asked at the launch itself');
  world.tick(FIRST_CHECK_MS);
  await world.until('the first check', () => !!world.view?.checked && !world.view.checking);
  assert.equal(world.view?.available?.tag, 'v0.5.0-preview.7');
  world.tick(CHECK_EVERY_MS);
  await world.until('the next check', () => world.reads === 2);
});

test('a check that failed is said, and tried again at the next turn', async t => {
  const { world, flow } = installed(t);
  world.status = 503;
  await flow.view();
  world.tick(FIRST_CHECK_MS);
  await world.until('the first check', () => !!world.view?.checked);
  assert.match(world.view!.checked!.failed!, /GitHub answered 503/);
  world.status = 200;
  world.tick(CHECK_EVERY_MS);
  await world.until('the retry', () => world.view?.available?.tag === 'v0.5.0-preview.7');
  assert.equal(world.view!.checked!.failed, undefined);
});

test('coming back to the window checks again once the last check is five minutes old, and never before the first', async t => {
  const { world, flow } = installed(t);
  await flow.checkIfStale();
  assert.equal(world.reads, 0, 'before the launch’s own check, coming back asks nothing: that check is already due');
  world.tick(FIRST_CHECK_MS);
  await world.until('the first check', () => world.reads === 1 && !world.view?.checking);
  world.tick(FRESH_MS - 1000);
  await flow.checkIfStale();
  assert.equal(world.reads, 1, 'a check four minutes old is fresh enough');
  // A release published meanwhile shows as soon as the person comes back.
  world.list = [listed('v0.5.0-preview.8'), listed('v0.5.0-preview.7')];
  world.tick(1000);
  await flow.checkIfStale();
  assert.deepEqual([world.reads, world.view?.available?.tag], [2, 'v0.5.0-preview.8']);
  // That check starts the quarter of an hour again: the clock's next check is a full turn later.
  world.tick(CHECK_EVERY_MS - 1000);
  // A due timer enters fetch during tick(), before it waits for an answer.
  assert.equal(world.reads, 2);
  world.tick(1000);
  await world.until('the clock’s next check', () => world.reads === 3);
});

test('on Linux a newer release with an AppImage is offered, and Update downloads nothing: this copy doesn’t install updates itself yet', async t => {
  const linux = { key: 'linux' as const, text: 'This copy of Central Knot doesn’t install updates itself yet.' };
  const { world, flow } = await offered(t, { platform: 'linux', reason: linux });
  const offer = () => world.view?.available;
  assert.equal(offer(), undefined, 'the Mac zip alone is no update here');
  const appImage = { name: 'Central-Knot-0.5.0-linux-x86_64.AppImage', browser_download_url: 'https://fixture.test/download/v0.5.0-preview.7/appimage', size: 1000 };
  world.list = [{ ...listed('v0.5.0-preview.7'), assets: [...listed('v0.5.0-preview.7').assets, appImage] }];
  await flow.check();
  assert.deepEqual([offer()?.tag, offer()?.download, world.view?.reason?.key], ['v0.5.0-preview.7', appImage.browser_download_url, 'linux']);
  let downloads = 0;
  world.download = () => { downloads += 1; return bytes(1000); };
  const after = await flow.install();
  assert.deepEqual([downloads, after.step, world.prepared, world.saves], [0, undefined, [], []]);
});

test('a build that wasn’t made from a release never checks', async t => {
  const { world, flow } = installed(t, { untagged: true });
  await flow.check();
  world.tick(CHECK_EVERY_MS);
  // Both the explicit check and any due timer have decided whether to read.
  assert.equal(world.reads, 0);
});

test('one click downloads, records the update for the next launch, prepares it and leaves the restart to the page', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
  assert.deepEqual(world.prepared, [{ tag: 'v0.5.0-preview.7', bytes: 1000 }]);
  assert.deepEqual(world.pending, { tag: 'v0.5.0-preview.7', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.7', from: 'v0.5.0-preview.6' });
  await folderRemoved(world.temp); // install has passed its restart decision.
  assert.equal(world.quits, 0, 'a page is open: it restarts, or holds the restart for something unsaved');
});

test('with no page open a prepared update restarts at once', async t => {
  const { world, flow } = await offered(t, { page: false });
  const restart = new Promise<void>(resolve => { world.quit = resolve; });
  await flow.install();
  await within('the restart', restart);
  assert.equal(world.quits, 1);
  assert.equal(world.quitting, true);
});

test('the release is read again at the click: a replaced zip downloads at its new size', async t => {
  const { world, flow } = await offered(t);
  world.list = [listed('v0.5.0-preview.7', 2000)];
  world.download = () => bytes(2000);
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
  assert.deepEqual(world.prepared, [{ tag: 'v0.5.0-preview.7', bytes: 2000 }]);
});

test('a release withdrawn since the check is said, and nothing is downloaded', async t => {
  const { world, flow } = await offered(t);
  world.list = [];
  let downloads = 0;
  world.download = () => { downloads += 1; return bytes(1000); };
  await flow.install();
  await world.until('the answer', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'That release is no longer offered. Central Knot wasn’t changed.');
  assert.deepEqual([step(world), world.view!.available, downloads], [undefined, undefined, 0]);
});

test('a download that ends early is refused, and the update can be started again', async t => {
  const { world, flow } = await offered(t);
  world.download = () => bytes(400);
  await flow.install();
  await world.until('the failure', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'The download didn’t finish. Central Knot wasn’t changed. Try again.');
  assert.deepEqual([step(world), world.prepared, world.saves], [undefined, [], []], 'nothing was handed over or recorded');
  world.download = () => bytes(1000);
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
});

test('a download that goes quiet with the connection still open ends, and the update can be started again', async t => {
  const { world, flow } = await offered(t);
  // The connection never notices: what ends the download is the updater's own clock.
  let connection!: AbortSignal;
  world.download = signal => { connection = signal; return bytes(500, true); };
  await flow.install();
  await world.until('half arrived', () => world.view?.progress === 0.5);
  world.tick(STALLED_MS - 1);
  assert.equal(connection.aborted, false, 'tick has fired every stall timer due by now');
  assert.equal(step(world), 'downloading');
  world.tick(1);
  await world.until('the failure', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'The download didn’t finish. Central Knot wasn’t changed. Try again.');
  assert.equal(step(world), undefined);
  await folderRemoved(world.temp);
  world.download = () => bytes(1000);
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
});

test('a download that never answers ends too', async t => {
  const { world, flow } = await offered(t);
  let reportRequest!: () => void;
  const asked = new Promise<void>(resolve => { reportRequest = resolve; });
  world.download = signal => new Promise<Response>((_done, fail) => { reportRequest(); signal.addEventListener('abort', () => fail(new Error('aborted'))); });
  await flow.install();
  await within('the download request', asked);
  world.tick(STALLED_MS);
  await world.until('the failure', () => !!world.view?.failed);
  assert.equal(step(world), undefined);
});

test('checks stay scheduled through a download that fails, whether the clock or Check now asked during it', async t => {
  for (const asked of ['clock', 'check now'] as const) {
    await t.test(asked, async t => {
      const { world, flow } = await offered(t);
      let end = (): void => undefined;
      world.download = () => new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array(400)); end = () => stream.close(); } }));
      // The next check is a second away when the update starts.
      world.tick(CHECK_EVERY_MS - 1000);
      await flow.install();
      await world.until('part arrived', () => world.view?.progress === 0.4);
      const before = world.reads;
      if (asked === 'clock') world.tick(1000); else await flow.check();
      // tick enters check synchronously, and Check now returns its completion.
      assert.equal(world.reads, before, 'nothing is read during an update');
      end();
      await world.until('the failure', () => !!world.view?.failed);
      assert.equal(world.reads, before, 'the download has now finished without an intervening check');
      const lastCheck = world.view!.checked!.at;
      world.tick(CHECK_EVERY_MS);
      await world.until('the next check’s answer', () => !!world.view?.checked && world.view.checked.at > lastCheck);
      assert.equal(world.reads, before + 1);
      assert.equal(world.view!.failed, undefined, 'a check that went through clears the old failure');
      assert.equal(world.view!.available?.tag, 'v0.5.0-preview.7');
    });
  }
});

test('a click on Update during a check waits for the check, then updates', async t => {
  const { world, flow } = await offered(t);
  let answer = (): void => undefined;
  world.held = new Promise(done => { answer = done; });
  const checking = flow.check();
  await world.until('the check under way', () => world.view?.checking === true);
  const clicked = await flow.install();
  assert.equal(clicked.step, 'downloading', 'the click is taken at once');
  // The click has returned while the check still holds its answer. Even the install’s release read must wait.
  assert.equal(world.reads, 2);
  assert.equal(world.prepared.length, 0);
  world.held = undefined;
  answer();
  await checking;
  await world.until('ready', () => step(world) === 'ready');
});

test('a second click while an update is under way starts nothing more', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
  await flow.install();
  // Each click has made its start decision. Only the accepted click read the release again.
  assert.equal(world.reads, 2);
  assert.equal(world.prepared.length, 1);
});

test('a restart that doesn’t happen is undone and said, and can be asked for again', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
  const restarting = flow.restart();
  await world.until('the quit asked for', () => world.quits === 1);
  assert.equal(world.quitting, true);
  world.tick(RESTART_MS);
  await restarting;
  assert.equal(world.quitting, false, 'closing the window hides it again');
  assert.equal(world.view!.failed, 'Couldn’t restart for the update. Quit Central Knot and open it again to finish it.');
  assert.equal(step(world), 'ready', 'the update stays ready');
  void flow.restart();
  await world.until('asked again', () => world.quits === 2);
});

test('a restart that can’t even be asked for is undone at once', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
  world.quit = () => { throw new Error('no'); };
  await flow.restart();
  assert.deepEqual([world.quitting, step(world)], [false, 'ready']);
  assert.match(world.view!.failed!, /^Couldn’t restart for the update\./);
});

test('an update Squirrel refuses is said, and nothing is owed to the next launch', async t => {
  const { world, flow } = await offered(t);
  world.prepare = async () => { throw new Error('Code signature at URL did not pass validation'); };
  await flow.install();
  await world.until('the failure', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'The download isn’t signed by Central Knot’s developer, so it wasn’t installed. Central Knot wasn’t changed.');
  assert.deepEqual([step(world), world.pending, world.saves], [undefined, undefined, ['v0.5.0-preview.7', undefined]]);
});

test('when the record for the next launch can’t be saved, nothing is handed to Squirrel', async t => {
  const { world, flow } = await offered(t);
  world.save = async () => { throw new Error('ENOSPC'); };
  await flow.install();
  await world.until('the failure', () => !!world.view?.failed);
  assert.match(world.view!.failed!, /^The update couldn’t be prepared\. Central Knot wasn’t changed\./);
  assert.deepEqual([step(world), world.prepared], [undefined, []]);
});

/** The wait for Squirrel ran out: the app says so, and keeps the record, since Squirrel may still install at a quit. */
async function waitRanOut(t: TestContext, options?: Parameters<typeof installed>[1]) {
  const app = await offered(t, options);
  app.world.prepare = async () => { throw Object.assign(new Error('preparing took longer than 10 minutes'), { unfinished: true }); };
  await app.flow.install();
  await app.world.until('the wait running out', () => !!app.world.view?.failed);
  assert.equal(app.world.view!.failed, prepareUnfinished);
  assert.equal(step(app.world), undefined);
  assert.equal(app.world.pending?.tag, 'v0.5.0-preview.7', 'the next launch can still say how it went');
  return app;
}

test('when the wait for preparing runs out and Squirrel finishes later, the update is ready after all', async t => {
  const { world } = await waitRanOut(t);
  world.late();
  assert.deepEqual([step(world), world.view!.failed, world.view!.available?.tag], ['ready', undefined, 'v0.5.0-preview.7']);
  assert.equal(world.pending?.tag, 'v0.5.0-preview.7');
  assert.equal(world.quits, 0, 'the page restarts, or holds');
});

test('with no page open, an update that finishes late restarts at once', async t => {
  const { world } = await waitRanOut(t, { page: false });
  world.late();
  await world.until('the restart', () => world.quits === 1);
});

test('when the wait runs out and Squirrel then refuses, the record goes: nothing will be installed', async t => {
  const { world } = await waitRanOut(t);
  world.late(new Error('Code signature did not pass validation'));
  await world.until('the record cleared', () => world.pending === undefined);
  assert.equal(step(world), undefined);
});

test('an answer from Squirrel that nothing is waiting for changes nothing', async t => {
  const { world, flow } = await offered(t);
  // Ignoring a late answer returns synchronously. A refusal that was accepted would call save before returning.
  const attemptedSaves: (string | undefined)[] = [];
  world.save = async next => { attemptedSaves.push(next?.tag); };
  world.late();
  world.late(new Error('stray'));
  assert.deepEqual(attemptedSaves, []);
  assert.deepEqual([step(world), world.saves], [undefined, []]);
  await flow.install();
  await world.until('ready', () => step(world) === 'ready');
  world.late(new Error('stray'));
  assert.deepEqual(attemptedSaves, ['v0.5.0-preview.7']);
  assert.deepEqual([step(world), world.pending?.tag], ['ready', 'v0.5.0-preview.7'], 'a ready update keeps its record');
});

test('the launch after an update says it is on the new version, once', async t => {
  const { world, flow } = installed(t, { tag: 'v0.5.0-preview.7', pending: { tag: 'v0.5.0-preview.7', page: 'https://example.test/7', from: 'v0.5.0-preview.6' } });
  const view = await flow.view();
  assert.deepEqual(view.updated, { tag: 'v0.5.0-preview.7', page: 'https://example.test/7' });
  assert.equal(view.failed, undefined);
  assert.equal(world.pending, undefined, 'the record is cleared once read');
});

test('the launch after an update that didn’t take says the old version is still in use', async t => {
  const { world, flow } = installed(t, { pending: { tag: 'v0.5.0-preview.7', page: 'https://example.test/7', from: 'v0.5.0-preview.6' } });
  const view = await flow.view();
  assert.equal(view.failed, 'The update to 0.5.0 preview 7 didn’t finish. Central Knot 0.5.0 preview 6 is still in use.');
  assert.deepEqual([view.updated, world.pending], [undefined, undefined]);
});
