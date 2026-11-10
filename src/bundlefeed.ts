// A bundled build's content feed (ORG-05, D-35): the address of a folder that holds release.json and the archive it names,
// published with scripts/publish-bundle.mjs. The app reads the manifest, and when it describes a newer release of the
// marketplace it carries, downloads the archive and puts it in use as the build's own release is (bundle.ts): checked
// against the manifest, unpacked aside, swapped in. Anything short of that leaves the plugins in use as they are and says
// why. Plain files over http or https, with no sign-in of the app's own: who can reach the address is the publisher's affair.
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { activateRelease, activeBundle, bundleRelease, releaseDate, type ActiveBundle, type BundleRelease } from './bundle.ts';
import { compareVersions } from './values.ts';

/** What one look at the feed came to: nothing newer, a newer release now in use, one held for a newer app, or why it couldn't be read or used. */
export interface FeedCheck { outcome: 'current' | 'updated' | 'held' | 'failed'; message: string; /** The bundle in use afterwards. */ active?: ActiveBundle }

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
const whyNot = (error: unknown) => (error instanceof Answered ? `the feed answered ${error.status}` : error instanceof TooLong ? 'its archive is longer than its manifest says' : 'the feed couldn’t be reached');

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
    }, createWriteStream(file));
  } finally { clearTimeout(quiet); }
}

/**
 * Looks at the feed once. A newer release of the same marketplace that this app can use is downloaded and put in use;
 * `held` is one that names a newer app than this, tried again after the app is updated. Nothing here throws: every way it
 * can go wrong is a `failed` with words for the page and the log, and the plugins in use stay as they are.
 */
export async function checkFeed(host: FeedHost): Promise<FeedCheck> {
  const active = await activeBundle(host.dataDir);
  const failed = (message: string): FeedCheck => ({ outcome: 'failed', message, active });
  let release: BundleRelease | undefined;
  try {
    const response = await host.fetch(new URL('release.json', host.feed).href, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Answered(response.status);
    release = bundleRelease(await response.json().catch(() => undefined));
  } catch (error) { return failed(`Couldn’t check for newer plugins: ${whyNot(error)}.`); }
  if (!release) return failed('Couldn’t check for newer plugins: what is published there isn’t a release this app can read.');
  if (active && release.marketplace !== active.release.marketplace) return failed(`What is published there is another marketplace (“${release.marketplace}”), so it was not used.`);
  if (active && release.sequence <= active.release.sequence) return { outcome: 'current', message: 'No newer plugins are published.', active };
  const date = releaseDate(release);
  if (release.minApp && compareVersions(host.appVersion, release.minApp) < 0) return { outcome: 'held', message: `Newer plugins${date ? ` (${date})` : ''} are published, but they need this app at ${release.minApp} or newer. They arrive once the app is updated.`, active };
  const file = join(host.dataDir, 'bundled', `download-${randomUUID()}.tgz`);
  try {
    await mkdir(join(host.dataDir, 'bundled'), { recursive: true });
    try { await download(host, release, file); } catch (error) { return failed(`Newer plugins${date ? ` (${date})` : ''} are published, but they couldn’t be downloaded: ${whyNot(error)}. The ones here stay in use.`); }
    const use = release;
    const { problem } = await host.turn(async () => activateRelease(host.dataDir, use, file, await host.keep(use.marketplace)));
    if (problem) return failed(`Newer plugins${date ? ` (${date})` : ''} are published, but they couldn’t be used. ${problem} The ones here stay in use.`);
    return { outcome: 'updated', message: `Now has the plugins published${date ? ` on ${date}` : ''}.`, active: await activeBundle(host.dataDir) };
  } finally { await rm(file, { force: true }); }
}
