import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK_EVERY_MS, FIRST_CHECK_MS, FRESH_MS, RESTART_MS, STALLED_MS, updateFlow, type PendingUpdate } from '../src/updateflow.ts';
import { prepareUnfinished } from '../src/updates.ts';
import type { UpdateRelease, UpdateView } from '../src/types.ts';

const RELEASES = 'https://fixture.test/releases';
const zipOf = (tag: string) => `https://fixture.test/download/${tag}/Central-Knot-0.5.0-mac-arm64.zip`;
/** A release as GitHub's API lists it. */
const listed = (tag: string, size = 1000) => ({
  tag_name: tag, draft: false, prerelease: true, html_url: `https://github.com/njfife/central-knot/releases/tag/${tag}`,
  assets: [{ name: 'Central-Knot-0.5.0-mac-arm64.zip', browser_download_url: zipOf(tag), size }],
});
/** A download's answer: `sent` bytes, then the end, or with `open` a connection that stays open and says nothing more. */
const bytes = (sent: number, open = false) => new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array(sent)); if (!open) stream.close(); } }));

/** Lets everything already due run (promises, file writes); the clock moves only when a test moves it. */
const settle = () => new Promise<void>(done => setImmediate(done));
async function until(what: string, met: () => boolean) {
  for (let turn = 0; turn < 5000; turn++) { if (met()) return; await settle(); }
  assert.fail(`never happened: ${what}`);
}

/**
 * An installed preview 6 with a stand-in for everything outside the steps. Tests change what the stand-ins answer: `list` (the
 * releases), `download` (the zip's answer), `prepare` (Squirrel's), `quit` (the restart), `save` (the settings file).
 */
function installed(t: TestContext, { tag = 'v0.5.0-preview.6', untagged = false, pending = undefined as PendingUpdate | undefined, page = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const temp = mkdtempSync(join(tmpdir(), 'ck-updateflow-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const world = {
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
    send: view => { world.view = view; },
    hasPage: () => world.page,
    queued: work => work(),
    pending: () => world.pending,
    savePending: async next => { await world.save(next); world.pending = next; world.saves.push(next?.tag); },
    quitting: on => { world.quitting = on; },
  }, {
    shown: true, version: '0.5.0', tag: untagged ? undefined : tag, releasesUrl: RELEASES,
    fetch: async (url, { signal }) => {
      if (url !== RELEASES) return world.download(signal);
      world.reads += 1;
      await world.held;
      return new Response(JSON.stringify(world.list), { status: world.status });
    },
    reason: async () => undefined,
    temp: () => temp,
    prepare: async (release, zip) => { world.prepared.push({ tag: release.tag, bytes: statSync(zip).size }); await world.prepare(release, zip); },
    onLate: heard => { world.late = heard; },
    quitAndInstall: () => { world.quits += 1; world.quit(); },
  });
  return { world, flow };
}

/** After the launch's own check: preview 7 is offered. */
async function offered(t: TestContext, options?: Parameters<typeof installed>[1]) {
  const app = installed(t, options);
  await app.flow.view();
  app.world.tick(FIRST_CHECK_MS);
  await until('the first check', () => !!app.world.view?.checked && !app.world.view.checking);
  return app;
}
const step = (world: { view?: UpdateView }) => world.view?.step;

test('the first check runs shortly after launch, and then every quarter of an hour', async t => {
  const { world, flow } = installed(t);
  await flow.view();
  assert.equal(world.reads, 0, 'nothing is asked at the launch itself');
  world.tick(FIRST_CHECK_MS);
  await until('the first check', () => !!world.view?.checked && !world.view.checking);
  assert.equal(world.view?.available?.tag, 'v0.5.0-preview.7');
  world.tick(CHECK_EVERY_MS);
  await until('the next check', () => world.reads === 2);
});

test('a check that failed is said, and tried again at the next turn', async t => {
  const { world, flow } = installed(t);
  world.status = 503;
  await flow.view();
  world.tick(FIRST_CHECK_MS);
  await until('the first check', () => !!world.view?.checked);
  assert.match(world.view!.checked!.failed!, /GitHub answered 503/);
  world.status = 200;
  world.tick(CHECK_EVERY_MS);
  await until('the retry', () => world.view?.available?.tag === 'v0.5.0-preview.7');
  assert.equal(world.view!.checked!.failed, undefined);
});

test('coming back to the window checks again once the last check is five minutes old, and never before the first', async t => {
  const { world, flow } = installed(t);
  await flow.checkIfStale();
  assert.equal(world.reads, 0, 'before the launch’s own check, coming back asks nothing: that check is already due');
  world.tick(FIRST_CHECK_MS);
  await until('the first check', () => world.reads === 1 && !world.view?.checking);
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
  await settle();
  assert.equal(world.reads, 2);
  world.tick(1000);
  await until('the clock’s next check', () => world.reads === 3);
});

test('a build that wasn’t made from a release never checks', async t => {
  const { world, flow } = installed(t, { untagged: true });
  await flow.check();
  world.tick(CHECK_EVERY_MS);
  await settle();
  assert.equal(world.reads, 0);
});

test('one click downloads, records the update for the next launch, prepares it and leaves the restart to the page', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await until('ready', () => step(world) === 'ready');
  assert.deepEqual(world.prepared, [{ tag: 'v0.5.0-preview.7', bytes: 1000 }]);
  assert.deepEqual(world.pending, { tag: 'v0.5.0-preview.7', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.7', from: 'v0.5.0-preview.6' });
  assert.equal(world.quits, 0, 'a page is open: it restarts, or holds the restart for something unsaved');
  await until('the download’s folder removed', () => readdirSync(world.temp).length === 0);
});

test('with no page open a prepared update restarts at once', async t => {
  const { world, flow } = await offered(t, { page: false });
  await flow.install();
  await until('the restart', () => world.quits === 1);
  assert.equal(world.quitting, true);
});

test('the release is read again at the click: a replaced zip downloads at its new size', async t => {
  const { world, flow } = await offered(t);
  world.list = [listed('v0.5.0-preview.7', 2000)];
  world.download = () => bytes(2000);
  await flow.install();
  await until('ready', () => step(world) === 'ready');
  assert.deepEqual(world.prepared, [{ tag: 'v0.5.0-preview.7', bytes: 2000 }]);
});

test('a release withdrawn since the check is said, and nothing is downloaded', async t => {
  const { world, flow } = await offered(t);
  world.list = [];
  let downloads = 0;
  world.download = () => { downloads += 1; return bytes(1000); };
  await flow.install();
  await until('the answer', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'That release is no longer offered. Central Knot wasn’t changed.');
  assert.deepEqual([step(world), world.view!.available, downloads], [undefined, undefined, 0]);
});

test('a download that ends early is refused, and the update can be started again', async t => {
  const { world, flow } = await offered(t);
  world.download = () => bytes(400);
  await flow.install();
  await until('the failure', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'The download didn’t finish. Central Knot wasn’t changed. Try again.');
  assert.deepEqual([step(world), world.prepared, world.saves], [undefined, [], []], 'nothing was handed over or recorded');
  world.download = () => bytes(1000);
  await flow.install();
  await until('ready', () => step(world) === 'ready');
});

test('a download that goes quiet with the connection still open ends, and the update can be started again', async t => {
  const { world, flow } = await offered(t);
  // The connection never notices: what ends the download is the updater's own clock.
  world.download = () => bytes(500, true);
  await flow.install();
  await until('half arrived', () => world.view?.progress === 0.5);
  world.tick(STALLED_MS - 1);
  await settle();
  assert.equal(step(world), 'downloading');
  world.tick(1);
  await until('the failure', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'The download didn’t finish. Central Knot wasn’t changed. Try again.');
  assert.equal(step(world), undefined);
  await until('the download’s folder removed', () => readdirSync(world.temp).length === 0);
  world.download = () => bytes(1000);
  await flow.install();
  await until('ready', () => step(world) === 'ready');
});

test('a download that never answers ends too', async t => {
  const { world, flow } = await offered(t);
  let asked = false;
  world.download = signal => new Promise<Response>((_done, fail) => { asked = true; signal.addEventListener('abort', () => fail(new Error('aborted'))); });
  await flow.install();
  await until('the request', () => asked);
  world.tick(STALLED_MS);
  await until('the failure', () => !!world.view?.failed);
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
      await until('part arrived', () => world.view?.progress === 0.4);
      const before = world.reads;
      if (asked === 'clock') world.tick(1000); else await flow.check();
      await settle();
      assert.equal(world.reads, before, 'nothing is read during an update');
      end();
      await until('the failure', () => !!world.view?.failed);
      world.tick(CHECK_EVERY_MS);
      await until('the next check', () => world.reads === before + 1);
      await until('its answer', () => !world.view?.checking);
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
  await until('the check under way', () => world.view?.checking === true);
  const clicked = await flow.install();
  assert.equal(clicked.step, 'downloading', 'the click is taken at once');
  await settle();
  assert.equal(world.prepared.length, 0);
  world.held = undefined;
  answer();
  await checking;
  await until('ready', () => step(world) === 'ready');
});

test('a second click while an update is under way starts nothing more', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await flow.install();
  await until('ready', () => step(world) === 'ready');
  await flow.install();
  await settle();
  assert.equal(world.prepared.length, 1);
});

test('a restart that doesn’t happen is undone and said, and can be asked for again', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await until('ready', () => step(world) === 'ready');
  const restarting = flow.restart();
  await until('the quit asked for', () => world.quits === 1);
  assert.equal(world.quitting, true);
  world.tick(RESTART_MS);
  await restarting;
  assert.equal(world.quitting, false, 'closing the window hides it again');
  assert.equal(world.view!.failed, 'Couldn’t restart for the update. Quit Central Knot and open it again to finish it.');
  assert.equal(step(world), 'ready', 'the update stays ready');
  void flow.restart();
  await until('asked again', () => world.quits === 2);
});

test('a restart that can’t even be asked for is undone at once', async t => {
  const { world, flow } = await offered(t);
  await flow.install();
  await until('ready', () => step(world) === 'ready');
  world.quit = () => { throw new Error('no'); };
  await flow.restart();
  assert.deepEqual([world.quitting, step(world)], [false, 'ready']);
  assert.match(world.view!.failed!, /^Couldn’t restart for the update\./);
});

test('an update Squirrel refuses is said, and nothing is owed to the next launch', async t => {
  const { world, flow } = await offered(t);
  world.prepare = async () => { throw new Error('Code signature at URL did not pass validation'); };
  await flow.install();
  await until('the failure', () => !!world.view?.failed);
  assert.equal(world.view!.failed, 'The download isn’t signed by Central Knot’s developer, so it wasn’t installed. Central Knot wasn’t changed.');
  assert.deepEqual([step(world), world.pending, world.saves], [undefined, undefined, ['v0.5.0-preview.7', undefined]]);
});

test('when the record for the next launch can’t be saved, nothing is handed to Squirrel', async t => {
  const { world, flow } = await offered(t);
  world.save = async () => { throw new Error('ENOSPC'); };
  await flow.install();
  await until('the failure', () => !!world.view?.failed);
  assert.match(world.view!.failed!, /^The update couldn’t be prepared\. Central Knot wasn’t changed\./);
  assert.deepEqual([step(world), world.prepared], [undefined, []]);
});

/** The wait for Squirrel ran out: the app says so, and keeps the record, since Squirrel may still install at a quit. */
async function waitRanOut(t: TestContext, options?: Parameters<typeof installed>[1]) {
  const app = await offered(t, options);
  app.world.prepare = async () => { throw Object.assign(new Error('preparing took longer than 10 minutes'), { unfinished: true }); };
  await app.flow.install();
  await until('the wait running out', () => !!app.world.view?.failed);
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
  await until('the restart', () => world.quits === 1);
});

test('when the wait runs out and Squirrel then refuses, the record goes: nothing will be installed', async t => {
  const { world } = await waitRanOut(t);
  world.late(new Error('Code signature did not pass validation'));
  await until('the record cleared', () => world.pending === undefined);
  assert.equal(step(world), undefined);
});

test('an answer from Squirrel that nothing is waiting for changes nothing', async t => {
  const { world, flow } = await offered(t);
  world.late();
  world.late(new Error('stray'));
  await settle();
  assert.deepEqual([step(world), world.saves], [undefined, []]);
  await flow.install();
  await until('ready', () => step(world) === 'ready');
  world.late(new Error('stray'));
  await settle();
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
  assert.equal(view.failed, 'The update to 0.5.0 preview 7 didn’t finish. Central Knot 0.5.0 preview 6 is still in use. Try the update again.');
  assert.deepEqual([view.updated, world.pending], [undefined, undefined]);
});
