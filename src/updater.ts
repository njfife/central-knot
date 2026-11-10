// The app's own parts of an update (PLT-02; updateflow.ts has the steps, updates.ts the rules and the words): the release tag
// this build was made from, whether this copy can replace itself, the network, and Squirrel.Mac (Electron's autoUpdater).
// Squirrel checks that the new app satisfies this app's own code signature requirement (the same Developer ID team), unpacks
// it aside and swaps it in only at the restart, so a failed or interrupted update leaves the installed app as it was. Squirrel
// wants a feed URL that answers with the zip's address; a loopback-only server gives that one answer, and the zip itself, for
// the length of one update.
import { app, autoUpdater, net } from 'electron';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { updateFlow, type UpdaterHost } from './updateflow.ts';
import { releasesApi, tagVersion, updatesShown, whyNoUpdate } from './updates.ts';
import type { UpdateRelease } from './types.ts';

export type { PendingUpdate, UpdaterHost } from './updateflow.ts';

/**
 * Test-only inputs, read only when set:
 * - CK_UPDATE_RELEASES: the URL of a releases list to read instead of GitHub's (a local fixture shaped like GitHub's answer).
 * - CK_UPDATE_STUB: a tag. The app acts as an installed copy of that release that can update itself, and the install step
 *   only records the update and quits, for the end-to-end test, which can't replace a real app. It skips the signature check:
 *   a test of the real update never sets it.
 */
const releasesUrl = process.env.CK_UPDATE_RELEASES || releasesApi;
const stub = process.env.CK_UPDATE_STUB;

/** Squirrel is given this long to check and unpack the zip before the wait for it ends. */
const PREPARE_MS = 10 * 60_000;

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
  const shown = updatesShown(process.platform) || !!stub;
  /** A `prepare` is waiting for Squirrel's answer; without one, the answer is a late one (updateflow.ts's `onLate`). */
  let waiting = false;
  let late: (error?: Error) => void = () => undefined;
  // Squirrel reports a failure as an 'error' event; with no listener Node would throw it.
  autoUpdater.on('error', error => { host.log(`update: ${error.message}`); if (!waiting) late(error); });
  autoUpdater.on('update-downloaded', () => { if (!waiting) late(); });

  /** What decides whether this copy can update itself, read once at the start. */
  async function reason() {
    if (!shown || stub) return undefined;
    const exe = app.getPath('exe');
    const bundle = exe.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    const packaged = app.isPackaged && bundle !== exe;
    const team = packaged && tag ? await signingTeam(bundle) : undefined;
    return whyNoUpdate({ platform: process.platform, packaged, tag, bundle, home: homedir(), team,
      writable: packaged && await writable(dirname(bundle)) && await writable(bundle) });
  }

  /**
   * Hands the downloaded zip to Squirrel through a feed on this computer only, under a random path, and waits until it has
   * checked the new app's signature against this one's and unpacked it aside. The feed closes when the wait ends.
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
          waiting = false;
          if (error) fail(error); else done();
        };
        const ready = () => finish();
        const none = () => finish(new Error('the feed offered no update'));
        // Squirrel has no way to be stopped: it may still finish, and then says so as a late answer.
        const limit = setTimeout(() => finish(Object.assign(new Error('preparing took longer than 10 minutes'), { unfinished: true })), PREPARE_MS);
        autoUpdater.on('update-downloaded', ready);
        autoUpdater.on('update-not-available', none);
        autoUpdater.on('error', finish);
        waiting = true;
        try {
          autoUpdater.setFeedURL({ url: `http://127.0.0.1:${port}/${token}/feed` });
          autoUpdater.checkForUpdates();
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
    } finally { server.close(); }
  }

  return updateFlow(host, {
    shown, version: app.getVersion(), tag, releasesUrl,
    fetch: (url, init) => net.fetch(url, init),
    reason, temp: () => app.getPath('temp') || tmpdir(),
    prepare, onLate: heard => { late = heard; },
    quitAndInstall: () => { if (stub) app.quit(); else autoUpdater.quitAndInstall(); },
  });
}
