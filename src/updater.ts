// The main process's side of updates (PLT-02; updates.ts has the rules and the words). It reads the release tag this build was
// made from, asks GitHub for a newer release shortly after launch and every few hours, and on the person's click downloads the
// Mac zip and hands it to Squirrel.Mac (Electron's autoUpdater). Squirrel checks that the new app satisfies this app's own code
// signature requirement (the same Developer ID team), unpacks it aside and swaps it in only at the restart, so a failed or
// interrupted update leaves the installed app as it was. Squirrel wants a feed URL that answers with the zip's address; a
// loopback-only server gives that one answer, and the zip itself, for the length of one update.
import { app, autoUpdater, net } from 'electron';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { access, constants, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildWords, checkFailure, newerRelease, releasesApi, tagVersion, tagWords, updateFailure, updatesShown, whyNoUpdate } from './updates.ts';
import type { UpdateRelease, UpdateView } from './types.ts';

/**
 * Test-only inputs, read only when set:
 * - CK_UPDATE_RELEASES: the URL of a releases list to read instead of GitHub's (a local fixture shaped like GitHub's answer).
 * - CK_UPDATE_STUB: a tag. The app acts as an installed copy of that release that can update itself, and the install step
 *   only records the update and quits, for the end-to-end test, which can't replace a real app. It skips the signature check:
 *   a test of the real update never sets it.
 */
const releasesUrl = process.env.CK_UPDATE_RELEASES || releasesApi;
const stub = process.env.CK_UPDATE_STUB;

/** Shortly after launch, then every few hours; a check that failed is tried again sooner. */
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 4 * 60 * 60_000;
const RETRY_MS = 30 * 60_000;
/** A download that receives nothing for this long has stopped. */
const STALLED_MS = 60_000;
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Central-Knot' };

/** An update prepared before a restart, kept in the app settings so the next launch can say how it went. */
export interface PendingUpdate { tag: string; page: string; from: string }

export interface UpdaterHost {
  log(line: string): void;
  /** Tells the page (when there is one) the new state. */
  send(view: UpdateView): void;
  /** A page is open that can say whether something typed is unsaved; without one, a prepared update restarts at once. */
  hasPage(): boolean;
  /** Runs `work` once no write is under way, and holds every later one until it ends (main's queue). */
  queued<T>(work: () => Promise<T>): Promise<T>;
  pending(): PendingUpdate | undefined;
  savePending(pending: PendingUpdate | undefined): Promise<void>;
  /** Marks the app as quitting, so closing its window really closes it; `false` takes that back when the restart didn’t happen. */
  quitting(on: boolean): void;
}

/** The release tag recorded in the app at packaging (scripts/package-mac.mjs); none for a dev or ad hoc build. */
function builtTag(): string | undefined {
  if (stub) return stub;
  try {
    const tag = JSON.parse(readFileSync(join(__dirname, 'build-info.json'), 'utf8')).tag;
    return typeof tag === 'string' && tagVersion(tag) ? tag : undefined;
  } catch { return undefined; }
}

/** The Developer ID team the app bundle is signed by, as codesign reports it; undefined when ad hoc or unsigned. */
const signingTeam = (bundle: string) => new Promise<string | undefined>(done =>
  execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], (_error, _out, err) => done(/^TeamIdentifier=([A-Z0-9]{10})$/m.exec(String(err))?.[1])));

const writable = (path: string) => access(path, constants.W_OK).then(() => true, () => false);

export function startUpdater(host: UpdaterHost) {
  const tag = builtTag();
  const view: UpdateView = { shown: updatesShown(process.platform) || !!stub, version: app.getVersion(), tag, checking: false };
  const tell = () => host.send(structuredClone(view));
  let timer: NodeJS.Timeout | undefined;
  // Squirrel reports a failure as an 'error' event; with no listener Node would throw it.
  autoUpdater.on('error', error => host.log(`update: ${error.message}`));

  /** Whether this copy can check at all: a release build, on a system with releases. */
  const checks = () => view.shown && !!view.tag && view.reason?.key !== 'dev' && view.reason?.key !== 'untagged';
  const later = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void check(), ms); };

  /** Reads the releases and answers with the newest this build would update to, if any. */
  async function newest(): Promise<UpdateRelease | undefined> {
    const response = await net.fetch(releasesUrl, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const limited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      throw Object.assign(new Error(`releases answered ${response.status}`), { status: response.status, limited });
    }
    return newerRelease(await response.json(), view.tag!);
  }

  /** The check under way, so a click on Update during it waits for it rather than being dropped. */
  let checkRun: Promise<void> | undefined;

  /** Asks for the releases and keeps the newest this build would update to. A failure is recorded, and tried again later. */
  function check(): Promise<void> {
    if (!checks()) return Promise.resolve();
    if (checkRun) return checkRun;
    // During an update nothing is read, but the next check stays scheduled: a download that then fails must not end the checks.
    if (view.step) { later(RETRY_MS); return Promise.resolve(); }
    checkRun = (async () => {
      view.checking = true;
      tell();
      let failed = false;
      try {
        view.available = await newest();
        view.checked = { at: Date.now() };
        // An earlier update's failure is old news once a check has gone through.
        view.failed = undefined;
      } catch (error) {
        failed = true;
        host.log(`update check: ${error instanceof Error ? error.message : String(error)}`);
        const { status, limited } = error as { status?: number; limited?: boolean };
        view.checked = { at: Date.now(), failed: checkFailure({ status, limited }) };
      }
      view.checking = false;
      checkRun = undefined;
      tell();
      later(failed ? RETRY_MS : CHECK_EVERY_MS);
    })();
    return checkRun;
  }

  /** Downloads the zip into its own new folder, reporting progress; fails unless every byte the release lists arrived. */
  async function download(release: UpdateRelease, folder: string): Promise<string> {
    const file = join(folder, 'update.zip');
    const stalled = new AbortController();
    let quiet = setTimeout(() => stalled.abort(), STALLED_MS);
    const response = await net.fetch(release.zip, { headers: { 'User-Agent': headers['User-Agent'] }, signal: stalled.signal });
    if (!response.ok || !response.body) throw new Error(`download answered ${response.status}`);
    let received = 0, told = 0;
    try {
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          clearTimeout(quiet);
          quiet = setTimeout(() => stalled.abort(), STALLED_MS);
          received += chunk.length;
          view.progress = Math.min(1, received / release.size);
          if (view.progress - told >= 0.01) { told = view.progress; tell(); }
          yield chunk;
        }
      }, createWriteStream(file));
    } finally { clearTimeout(quiet); }
    if (received !== release.size) throw new Error(`download ended at ${received} of ${release.size} bytes`);
    return file;
  }

  /**
   * Hands the downloaded zip to Squirrel through a feed on this computer only, under a random path, and waits until it has
   * checked the new app's signature against this one's and unpacked it aside. The feed closes when Squirrel is done.
   */
  async function prepare(release: UpdateRelease, zip: string): Promise<void> {
    if (stub) return;
    const token = randomBytes(16).toString('hex');
    const server = createServer((request, response) => {
      if (request.url === `/${token}/feed`) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ url: `http://127.0.0.1:${port}/${token}/update.zip`, name: release.tag }));
      } else if (request.url === `/${token}/update.zip`) {
        response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': release.size });
        createReadStream(zip).pipe(response);
      } else { response.writeHead(404); response.end(); }
    });
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    const port = (server.address() as { port: number }).port;
    try {
      await new Promise<void>((done, fail) => {
        const finish = (error?: Error) => {
          autoUpdater.off('update-downloaded', ready); autoUpdater.off('update-not-available', none); autoUpdater.off('error', finish);
          clearTimeout(limit);
          if (error) fail(error); else done();
        };
        const ready = () => finish();
        const none = () => finish(new Error('the feed offered no update'));
        const limit = setTimeout(() => finish(new Error('preparing took longer than 10 minutes')), 10 * 60_000);
        autoUpdater.on('update-downloaded', ready);
        autoUpdater.on('update-not-available', none);
        autoUpdater.on('error', finish);
        try {
          autoUpdater.setFeedURL({ url: `http://127.0.0.1:${port}/${token}/feed` });
          autoUpdater.checkForUpdates();
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
    } finally { server.close(); }
  }

  /** Downloads and prepares the newer release, then restarts into it unless the page holds it for something unsaved. */
  async function install(): Promise<void> {
    if (!view.available || view.reason || view.step) return;
    Object.assign(view, { step: 'downloading', progress: 0, failed: undefined });
    tell();
    await checkRun;
    // The release is read again at the click: its zip may have been replaced, or the release withdrawn, since the last check.
    // When that read fails (offline), the download itself says so.
    try { view.available = await newest(); } catch (error) { host.log(`update: reading the release again: ${error instanceof Error ? error.message : String(error)}`); }
    const release = view.available;
    if (!release) {
      Object.assign(view, { step: undefined, progress: undefined, failed: 'That release is no longer offered. Central Knot wasn’t changed.' });
      tell();
      return;
    }
    const folder = await mkdtemp(join(app.getPath('temp') || tmpdir(), 'central-knot-update-'));
    let stage: 'download' | 'install' = 'download';
    try {
      const zip = await download(release, folder);
      stage = 'install';
      view.step = 'installing';
      tell();
      await prepare(release, zip);
      // Squirrel now applies it at the next quit, whichever way the app quits: the next launch says how it went.
      await host.savePending({ tag: release.tag, page: release.page, from: view.tag! });
      view.step = 'ready';
      tell();
      if (!host.hasPage()) await restart();
    } catch (error) {
      host.log(`update ${stage}: ${error instanceof Error ? error.message : String(error)}`);
      Object.assign(view, { step: undefined, progress: undefined, failed: updateFailure(stage, String(error)) });
      tell();
    } finally {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Restarts into the prepared update once no write is under way, and holds every later write while the app quits. */
  async function restart(): Promise<void> {
    if (view.step !== 'ready') return;
    await host.queued(async () => {
      host.quitting(true);
      if (stub) app.quit(); else autoUpdater.quitAndInstall();
      await new Promise(done => setTimeout(done, 60_000));
      // Still here: the restart didn't happen. The app goes back to running as before, and the update stays ready.
      host.quitting(false);
      host.log('update: the app did not quit for the update within a minute');
      view.failed = 'Couldn’t restart for the update. Quit Central Knot and open it again to finish it.';
      tell();
    });
  }

  /** Reads what decides whether this copy can update itself, says how the last update went, and starts checking. */
  async function start() {
    if (view.shown && !stub) {
      const exe = app.getPath('exe');
      const bundle = exe.replace(/\/Contents\/MacOS\/[^/]+$/, '');
      const packaged = app.isPackaged && bundle !== exe;
      const team = packaged && tag ? await signingTeam(bundle) : undefined;
      view.reason = whyNoUpdate({ platform: process.platform, packaged, tag, bundle, home: homedir(), team,
        writable: packaged && await writable(dirname(bundle)) && await writable(bundle) });
    }
    const pending = host.pending();
    if (pending) {
      if (pending.tag === tag) view.updated = { tag: pending.tag, page: pending.page };
      else view.failed = `The update to ${tagWords(pending.tag)} didn’t finish. Central Knot ${buildWords(view)} is still in use.`;
      await host.savePending(undefined);
    }
    tell();
    if (checks()) later(FIRST_CHECK_MS);
  }
  const started = start().catch(error => host.log(`update start: ${String(error)}`));

  return {
    view: async () => { await started; return structuredClone(view); },
    /** On demand: checks now, and answers with what it found. */
    check: async () => { await started; clearTimeout(timer); if (!view.step) view.failed = undefined; await check(); return structuredClone(view); },
    install: async () => { await started; void install(); return structuredClone(view); },
    restart,
  };
}
