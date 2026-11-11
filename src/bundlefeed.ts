// A bundled build's content feed (ORG-05, D-35): the address of a folder that holds release.json and the archive it names,
// published with scripts/publish-bundle.mjs. The app reads the manifest, and when it describes a newer release of the
// marketplace it carries, downloads the archive and puts it in use as the build's own release is (bundle.ts): checked
// against the manifest, unpacked aside, swapped in. Anything short of that leaves the plugins in use as they are and says
// why. Plain files over http or https, with no sign-in of the app's own: who can reach the address is the publisher's affair.
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { activateRelease, activeBundle, bundleRelease, releaseDate, type ActiveBundle, type BundleRelease } from './bundle.ts';
import { compareVersions } from './values.ts';

/**
 * What one look at the feed came to: nothing newer, a newer release now in use, one held for a newer app, or that it
 * couldn't be read or used. `message` is for whoever uses the app; `detail` is the exact reason, for the log and whoever
 * publishes.
 */
export interface FeedCheck { outcome: 'current' | 'updated' | 'held' | 'failed'; message: string; detail?: string; /** The bundle in use afterwards. */ active?: ActiveBundle }

export interface FeedHost {
  /** The feed's address, ending in a slash (bundle.ts feedAddress). */
  feed: string;
  dataDir: string;
  /** This app's version, for a release that names the oldest app it works with. */
  appVersion: string;
  fetch(url: string, init?: { signal?: AbortSignal }): Promise<Response>;
  /** Plugins a tool on this computer has installed from the marketplace: one a new release no longer packs is carried over. */
  keep(marketplace: string): Promise<string[]>;
  /** Runs the swap in the app's queue, so it never lands in the middle of an install or a sync pass. */
  turn<T>(work: () => Promise<T>): Promise<T>;
}

/** A download with no bytes for this long is given up. */
const STALLED_MS = 60_000;

/** A request the feed answered with something other than the file: its status. */
class Answered extends Error { status: number; constructor(status: number) { super(`the feed answered ${status}`); this.status = status; } }
/** The archive ran past the size its manifest lists. */
class TooLong extends Error {}
/** Why a request failed, in words: what the feed answered, or that it couldn't be reached. */
const whyNot = (error: unknown) => (error instanceof Answered ? (error.status === 404 ? 'nothing is published at their address (the server answered 404)' : `the server they are published on answered ${error.status}`) : error instanceof TooLong ? 'its archive is longer than its manifest says' : 'the server they are published on couldn’t be reached');

/** An error's own words, for the log. */
const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The archive (by its SHA-256) of a release that was downloaded and couldn't be put in use, with what was said of it. While
 * the feed still names that archive it is not downloaded again: every look would fetch it whole and fail the same way. A
 * new publish, or the app starting again, clears it.
 */
let unusable: { sha256: string; check: FeedCheck } | undefined;

/** Downloads the release's archive into `file`: exactly the bytes its manifest lists, or it fails. */
async function download(host: FeedHost, release: BundleRelease, file: string): Promise<void> {
  const stalled = new AbortController();
  let quiet = setTimeout(() => stalled.abort(), STALLED_MS);
  let received = 0;
  try {
    const response = await host.fetch(new URL(release.archive, host.feed).href, { signal: stalled.signal });
    if (!response.ok || !response.body) throw new Answered(response.status);
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        clearTimeout(quiet);
        quiet = setTimeout(() => stalled.abort(), STALLED_MS);
        received += chunk.length;
        // More than the manifest lists is not this release's archive: stop reading it.
        if (received > release.size) throw new TooLong();
        yield chunk;
      }
    // The same signal ends the copy itself, whatever the request does with it: a download gone quiet never holds a look open.
    }, createWriteStream(file), { signal: stalled.signal });
  } finally { clearTimeout(quiet); }
}

/**
 * Looks at the feed once. A newer release of the same marketplace that this app can use is downloaded and put in use;
 * `held` is one that names a newer app than this, tried again after the app is updated. Nothing here throws: every way it
 * can go wrong is a `failed` with words for the page and the log, and the plugins in use stay as they are.
 */
export async function checkFeed(host: FeedHost): Promise<FeedCheck> {
  const active = await activeBundle(host.dataDir);
  const stays = 'The ones here stay in use, and the app tries again by itself';
  const failed = (message: string, detail?: string): FeedCheck => ({ outcome: 'failed', message, ...(detail ? { detail } : {}), active });
  let release: BundleRelease | undefined;
  try {
    const response = await host.fetch(new URL('release.json', host.feed).href, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Answered(response.status);
    release = bundleRelease(await response.json().catch(() => undefined));
  } catch (error) { return failed(`Couldn’t check for newer plugins: ${whyNot(error)}. ${stays}.`, said(error)); }
  if (!release) return failed(`Couldn’t check for newer plugins: what is published isn’t something this app can read. ${stays}.`, 'release.json at the feed is not a release manifest');
  // (With nothing in use, because the build's own release never unpacked, whatever its feed publishes is taken.)
  if (active && release.marketplace !== active.release.marketplace) return failed(`What is published now is another marketplace (“${release.marketplace}”), so it was not used. The ones here stay in use.`);
  if (active && release.sequence <= active.release.sequence) return { outcome: 'current', message: 'No newer plugins are published.', active };
  // With the time when it is the same day as the plugins in use, so the two can be told apart.
  const date = releaseDate(release, !!active && releaseDate(active.release) === releaseDate(release));
  if (release.minApp && compareVersions(host.appVersion, release.minApp) < 0) return { outcome: 'held', message: `Newer plugins${date ? ` (${date})` : ''} are published, but they need this app at ${release.minApp} or newer. They arrive once the app is updated.`, active };
  if (unusable?.sha256 === release.sha256) return { ...unusable.check, active };
  const folder = join(host.dataDir, 'bundled'), file = join(folder, `download-${randomUUID()}.tgz`);
  try {
    await mkdir(folder, { recursive: true });
    // A download the app was quit in the middle of goes first (one look runs at a time, so it is nobody's).
    for (const name of await readdir(folder)) if (name.startsWith('download-')) await rm(join(folder, name), { force: true });
    // Said plainly to whoever uses the app; the exact reason goes to the log, for whoever publishes.
    const newer = `Newer plugins${date ? ` (${date})` : ''} are published, but`, again = stays;
    try { await download(host, release, file); } catch (error) { return failed(`${newer} they couldn’t be downloaded: ${whyNot(error)}. ${again}.`, said(error)); }
    const use = release;
    const { problem } = await host.turn(async () => activateRelease(host.dataDir, use, file, await host.keep(use.marketplace)));
    if (problem) {
      unusable = { sha256: release.sha256, check: failed(`${newer} they didn’t arrive whole, so they weren’t used. ${again}.`, problem) };
      return unusable.check;
    }
    return { outcome: 'updated', message: `Now has the plugins published${date ? ` on ${date}` : ''}.`, active: await activeBundle(host.dataDir) };
  } finally { await rm(file, { force: true }); }
}
