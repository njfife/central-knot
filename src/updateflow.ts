// An update's steps in the main process (PLT-02; updates.ts has the rules and the words): checking shortly after launch and
// every few hours, and on the person's click downloading the Mac zip, handing it over to be prepared and restarting into it.
// Nothing here is Electron's: updater.ts gives it the app's own parts (the network, Squirrel.Mac, the quit), and the tests
// give it stand-ins, so every turn these steps can take is tested without an app.
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildWords, checkFailure, newerRelease, prepareUnfinished, tagWords, updateFailure } from './updates.ts';
import type { UpdateRelease, UpdateView } from './types.ts';

/** Shortly after launch, then every few hours; a check that failed is tried again sooner. */
export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 4 * 60 * 60_000;
export const RETRY_MS = 30 * 60_000;
/** A download that receives nothing for this long has stopped. */
export const STALLED_MS = 60_000;
/** An app that hasn't quit this long after the restart was asked for isn't going to. */
export const RESTART_MS = 60_000;
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

/** The parts of an update that belong to the computer: Electron's in the app (updater.ts), stand-ins in the tests. */
export interface UpdateSystem {
  /** Whether updates show at all here, this build's version, and the release tag it was made from (none: it never checks). */
  shown: boolean;
  version: string;
  tag?: string;
  /** The releases list to read: GitHub's. */
  releasesUrl: string;
  fetch(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<Response>;
  /** Why this copy can't replace itself, or nothing when it can. */
  reason(): Promise<UpdateView['reason']>;
  /** The folder a download's own folder is made in. */
  temp(): string;
  /**
   * Hands the zip to Squirrel and waits until it has checked and unpacked it: from then on it is installed at the next quit.
   * Rejects when Squirrel refuses it. Rejects with `unfinished: true` when the wait only ran out: Squirrel can't be told to
   * stop, so it may still finish, and then says so through `onLate`.
   */
  prepare(release: UpdateRelease, zip: string): Promise<void>;
  /** Squirrel's answer when no `prepare` is waiting for it any more: finished (no error), or refused. */
  onLate(heard: (error?: Error) => void): void;
  /** Quits the app so the prepared update is installed and opened. */
  quitAndInstall(): void;
}

export function updateFlow(host: UpdaterHost, system: UpdateSystem) {
  const { tag } = system;
  const view: UpdateView = { shown: system.shown, version: system.version, tag, checking: false };
  const tell = () => host.send(structuredClone(view));
  const said = (error: unknown) => (error instanceof Error ? error.message : String(error));
  let timer: NodeJS.Timeout | undefined;

  /** Whether this copy can check at all: a release build, on a system with releases. */
  const checks = () => view.shown && !!view.tag && view.reason?.key !== 'dev' && view.reason?.key !== 'untagged';
  const later = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void check(), ms); };

  /** Reads the releases and answers with the newest this build would update to, if any. */
  async function newest(): Promise<UpdateRelease | undefined> {
    const response = await system.fetch(system.releasesUrl, { headers, signal: AbortSignal.timeout(30_000) });
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
        host.log(`update check: ${said(error)}`);
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

  /**
   * Downloads the zip into its own new folder, reporting progress; fails unless every byte the release lists arrived. A
   * download that goes quiet is ended here, on the stream itself, whether or not the connection ever notices.
   */
  async function download(release: UpdateRelease, folder: string): Promise<string> {
    const file = join(folder, 'update.zip');
    const stalled = new AbortController();
    let quiet = setTimeout(() => stalled.abort(), STALLED_MS);
    let received = 0, told = 0;
    try {
      const response = await system.fetch(release.zip, { headers: { 'User-Agent': headers['User-Agent'] }, signal: stalled.signal });
      if (!response.ok || !response.body) throw new Error(`download answered ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          clearTimeout(quiet);
          quiet = setTimeout(() => stalled.abort(), STALLED_MS);
          received += chunk.length;
          view.progress = Math.min(1, received / release.size);
          if (view.progress - told >= 0.01) { told = view.progress; tell(); }
          yield chunk;
        }
      }, createWriteStream(file), { signal: stalled.signal });
    } finally { clearTimeout(quiet); }
    if (received !== release.size) throw new Error(`download ended at ${received} of ${release.size} bytes`);
    return file;
  }

  /**
   * The release Squirrel was last handed and hasn't refused. Its record for the next launch is saved before the hand-over,
   * because from then on Squirrel may install it at any quit, whatever this session went on to say.
   */
  let handed: UpdateRelease | undefined;

  /** Squirrel refused what it was handed: nothing will be installed, so the next launch is owed nothing. */
  async function forget() {
    handed = undefined;
    await host.savePending(undefined).catch(error => host.log(`update: clearing the record: ${said(error)}`));
  }

  // Squirrel's answer after the wait for it ran out. Finished: the update is ready after all, and is offered as any other.
  // While another update is under way, that one's own wait hears Squirrel instead.
  system.onLate(error => {
    if (!handed || view.step) return;
    if (error) { void forget(); return; }
    host.log(`update: ${handed.tag} was prepared after the wait for it ended`);
    Object.assign(view, { available: handed, step: 'ready', progress: undefined, failed: undefined });
    tell();
    if (!host.hasPage()) void restart();
  });

  /** Downloads and prepares the newer release, then restarts into it unless the page holds it for something unsaved. */
  async function install(): Promise<void> {
    if (!view.available || view.reason || view.step) return;
    Object.assign(view, { step: 'downloading', progress: 0, failed: undefined });
    tell();
    await checkRun;
    // The release is read again at the click: its zip may have been replaced, or the release withdrawn, since the last check.
    // When that read fails (offline), the download itself says so.
    try { view.available = await newest(); } catch (error) { host.log(`update: reading the release again: ${said(error)}`); }
    const release = view.available;
    if (!release) {
      Object.assign(view, { step: undefined, progress: undefined, failed: 'That release is no longer offered. Central Knot wasn’t changed.' });
      tell();
      return;
    }
    let stage: 'download' | 'install' = 'download';
    let folder: string | undefined;
    let recorded = false;
    try {
      folder = await mkdtemp(join(system.temp(), 'central-knot-update-'));
      const zip = await download(release, folder);
      stage = 'install';
      view.step = 'installing';
      tell();
      await host.savePending({ tag: release.tag, page: release.page, from: view.tag! });
      recorded = true;
      handed = release;
      await system.prepare(release, zip);
      // Squirrel now applies it at the next quit, whichever way the app quits: the next launch says how it went.
      view.step = 'ready';
      tell();
      if (!host.hasPage()) await restart();
    } catch (error) {
      host.log(`update ${stage}: ${said(error)}`);
      // A wait that only ran out keeps the record: Squirrel may still install the update at a quit.
      const unfinished = recorded && (error as { unfinished?: boolean }).unfinished === true;
      if (recorded && !unfinished) await forget();
      Object.assign(view, { step: undefined, progress: undefined, failed: unfinished ? prepareUnfinished : updateFailure(stage, String(error)) });
      tell();
    } finally {
      if (folder) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Restarts into the prepared update once no write is under way, and holds every later write while the app quits. */
  async function restart(): Promise<void> {
    if (view.step !== 'ready') return;
    await host.queued(async () => {
      host.quitting(true);
      try {
        system.quitAndInstall();
        await new Promise(done => setTimeout(done, RESTART_MS));
        host.log('update: the app did not quit for the update within a minute');
      } catch (error) { host.log(`update: asking for the restart: ${said(error)}`); }
      // Still here: the restart didn't happen. The app goes back to running as before, and the update stays ready.
      host.quitting(false);
      view.failed = 'Couldn’t restart for the update. Quit Central Knot and open it again to finish it.';
      tell();
    });
  }

  /** Reads what decides whether this copy can update itself, says how the last update went, and starts checking. */
  async function start() {
    view.reason = await system.reason();
    const pending = host.pending();
    if (pending) {
      if (pending.tag === tag) view.updated = { tag: pending.tag, page: pending.page };
      else view.failed = `The update to ${tagWords(pending.tag)} didn’t finish. Central Knot ${buildWords(view)} is still in use. Try again from the Update button.`;
      // Said once: a record that can't be cleared is said again at the next launch, which is all it costs.
      await host.savePending(undefined).catch(error => host.log(`update: clearing the record: ${said(error)}`));
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
