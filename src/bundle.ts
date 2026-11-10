// A custom build and the marketplace it carries (ORG-01, ORG-03, ORG-07). A custom build is the same app with a small file
// beside its code (custom-build.json) naming its own identity and branding. A bundled build also carries one release of a
// marketplace: a manifest (release.json) and one archive holding the whole marketplace, every plugin's files included, so the
// person browsing and installing needs no access to where it came from. At open the app unpacks the release into its own
// data folder, at a path that stays the same from release to release: that folder is the marketplace the tools are given.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCatalog } from './plugins.ts';
import { writeDurably } from './share.ts';
import { SAFE_NAME, record, text } from './values.ts';

/** The standard app's identity: the system's name for it, and the name a sync record gives its owner. */
export const STANDARD_BUILD = 'com.centralknot.firstlook';

export const CUSTOM_FILE = 'custom-build.json';
export const RELEASE_FILE = 'release.json';
/** The folder, beside the app's code and in a staged custom build, that holds the carried release and the marketplace's logo. */
export const CARRIED_FOLDER = 'bundle';

/**
 * What makes a build a custom one. `id` names its settings folder and `bundleId` is the system's name for the app, so it
 * installs beside the standard app and never shares its settings; `name` is what it calls itself. `marketplace` is set for a
 * bundled build: how the carried marketplace is shown here (its name for the tools is always the catalog's own).
 */
export interface CustomBuild {
  id: string;
  name: string;
  bundleId: string;
  marketplace?: { displayName?: string; /** A picture's file name in the carried folder. */ logo?: string };
}

/** An identity is letters, digits, dot and dash: it becomes a folder name and part of a bundle id. */
export const BUILD_ID = /^[a-z0-9][a-z0-9.-]{0,62}$/;
/** A logo's file name as the build writes it: no folders, a picture the page can show. */
const LOGO_FILE = /^[\w-]+\.(png|svg|jpg|jpeg|webp)$/;

/** custom-build.json as an object, or undefined for anything that isn't one (then the build is the standard app). */
export function customBuild(value: unknown): CustomBuild | undefined {
  const read = record(value);
  if (!read || !BUILD_ID.test(text(read.id)) || !text(read.name).trim() || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,150}$/.test(text(read.bundleId))) return undefined;
  const market = record(read.marketplace);
  const logo = text(market?.logo);
  return { id: text(read.id), name: text(read.name).trim(), bundleId: text(read.bundleId),
    ...(market ? { marketplace: { ...(text(market.displayName).trim() ? { displayName: text(market.displayName).trim() } : {}), ...(LOGO_FILE.test(logo) ? { logo } : {}) } } : {}) };
}

const readJson = async (path: string): Promise<unknown> => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; } };

/** The custom build described in `folder` (the app's code folder, or a staged build), if it holds one. */
export const readCustomBuild = async (folder: string) => customBuild(await readJson(join(folder, CUSTOM_FILE)));
/** The same, read at once: the app needs its identity before it does anything else. */
export function readCustomBuildSync(folder: string): CustomBuild | undefined {
  try { return customBuild(JSON.parse(readFileSync(join(folder, CUSTOM_FILE), 'utf8'))); } catch { return undefined; }
}

/** The product's own name, written so that a custom build's renaming of the app (scripts/build.mjs) leaves it as it is. */
const PRODUCT = ['Central', 'Knot'].join(' ');

/**
 * What a custom build says about itself in Settings: what it is, that it doesn't update itself, and where its marketplace's
 * content comes from. Neither an update location nor a content feed can be configured yet, and the app says so rather
 * than leaving it unsaid (ORG-06).
 */
export function aboutBuild(build: CustomBuild, version: string, market?: { name: string; release: string }): string[] {
  return [
    build.name === PRODUCT ? `This is a custom build of ${PRODUCT} ${version} (${build.id}).` : `${build.name} is a custom build of ${PRODUCT} ${version}.`,
    'It has its own settings, apart from the standard app’s, and it doesn’t update itself: it has no update location.',
    ...(market ? [`It carries the marketplace ${market.name}, as of ${market.release}. That changes only with a new build: it has no content feed.`] : []),
  ];
}

/**
 * One release of a bundle's content. `sequence` orders releases (a later one is higher; a commit names a release but can't
 * order it). `from` says in words what was packed. `plugins` are the ones whose files are in the archive; `unpackaged` are
 * listed by the marketplace but could not be packed, each with the reason.
 */
export interface BundleRelease {
  format: 1;
  /** The marketplace's own name, as its marketplace.json gives it. */
  marketplace: string;
  sequence: number;
  madeAt: string;
  from: string;
  /** The archive's file name beside the manifest, its size in bytes and its SHA-256. */
  archive: string;
  size: number;
  sha256: string;
  plugins: { name: string; version?: string }[];
  unpackaged: { name: string; reason: string }[];
}

/** A release manifest as an object, or undefined for one this version can't use. */
export function bundleRelease(value: unknown): BundleRelease | undefined {
  const read = record(value);
  if (!read || read.format !== 1 || !SAFE_NAME.test(text(read.marketplace)) || typeof read.sequence !== 'number' || !Number.isSafeInteger(read.sequence) || read.sequence < 0) return undefined;
  if (!/^[\w.-]+$/.test(text(read.archive)) || !/^[0-9a-f]{64}$/.test(text(read.sha256)) || typeof read.size !== 'number' || !(read.size > 0)) return undefined;
  const list = (items: unknown) => (Array.isArray(items) ? items : []).map(record).filter((item): item is Record<string, unknown> => !!item && !!text(item.name));
  return { format: 1, marketplace: text(read.marketplace), sequence: read.sequence, madeAt: text(read.madeAt), from: text(read.from), archive: text(read.archive), size: read.size, sha256: text(read.sha256),
    plugins: list(read.plugins).map(item => ({ name: text(item.name), ...(text(item.version) ? { version: text(item.version) } : {}) })),
    unpackaged: list(read.unpackaged).map(item => ({ name: text(item.name), reason: text(item.reason) })) };
}

export const readRelease = async (path: string) => bundleRelease(await readJson(path));

/** A release in words: "November 10, 2026 (GitHub: acme/plugins at 1a2b3c4d5e)". */
export function releaseLabel(release: Pick<BundleRelease, 'madeAt' | 'from'>): string {
  const made = new Date(release.madeAt);
  const date = Number.isNaN(made.getTime()) ? '' : made.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return [date, release.from ? (date ? `(${release.from})` : release.from) : ''].filter(Boolean).join(' ');
}

// ---------- On this computer ----------

/** Where a build keeps its bundle, inside its own data folder: the marketplace as unpacked, and the manifest of what it holds. */
const bundleRoot = (dataDir: string) => join(dataDir, 'bundled');
/** The marketplace folder the tools are given. Its path never changes; a new release replaces what is in it. */
export const bundledMarketplace = (dataDir: string) => join(bundleRoot(dataDir), 'marketplace');
const previousFolder = (dataDir: string) => join(bundleRoot(dataDir), 'previous');
const exists = (path: string) => stat(path).then(() => true, () => false);

/** The bundle in use on this computer: its marketplace folder and the release it holds. */
export interface ActiveBundle { folder: string; release: BundleRelease }

/**
 * The bundle in use, if one is. A marketplace folder moved aside by a swap that never finished (the app was stopped between
 * its two steps) is put back first, so the last working content is what is found.
 */
export async function activeBundle(dataDir: string): Promise<ActiveBundle | undefined> {
  const folder = bundledMarketplace(dataDir);
  if (!(await exists(folder)) && (await exists(previousFolder(dataDir)))) await rename(previousFolder(dataDir), folder).catch(() => undefined);
  const release = await readRelease(join(bundleRoot(dataDir), RELEASE_FILE));
  return release && (await exists(folder)) ? { folder, release } : undefined;
}

const tar = (args: string[], env?: NodeJS.ProcessEnv) => new Promise<string | undefined>(done =>
  execFile(process.platform === 'darwin' ? '/usr/bin/tar' : 'tar', args, { env: { ...process.env, ...env }, maxBuffer: 4 * 1024 * 1024 }, (error, _out, said) => done(error ? String(said).trim().split('\n').slice(-2).join(' ') || error.message : undefined)));

/** A file's size and SHA-256. */
export async function fileDigest(path: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest('hex') };
}

/** Packs `folder` into the archive at `path`, files only (no Mac extended attributes), with their modes and links as they are. */
export const packArchive = (folder: string, path: string) => tar(['-czf', path, '-C', folder, '.'], { COPYFILE_DISABLE: '1' });

/**
 * Puts a release in use: its archive (at `archive`, read as any file is, so one inside the app's own package works) is copied
 * into the data folder and checked against the manifest's size and SHA-256, unpacked aside, read as a marketplace, and only
 * then swapped into the marketplace folder. Anything short of that returns the problem and leaves what was in use untouched.
 */
export async function activateRelease(dataDir: string, release: BundleRelease, archive: string): Promise<{ problem?: string }> {
  const root = bundleRoot(dataDir);
  const stage = join(root, `incoming-${randomUUID()}`);
  const failed = async (problem: string) => { await rm(stage, { recursive: true, force: true }); return { problem }; };
  try {
    await mkdir(join(stage, 'marketplace'), { recursive: true });
    const copy = join(stage, 'content.tgz');
    await copyFile(archive, copy);
    const { size, sha256 } = await fileDigest(copy);
    if (size !== release.size || sha256 !== release.sha256) return failed('Its archive is not the one its manifest describes (another size or checksum), so it was not used.');
    const unpacked = await tar(['-xzf', copy, '-C', join(stage, 'marketplace')]);
    if (unpacked) return failed(`Its archive could not be unpacked: ${unpacked}`);
    const catalog = await parseCatalog(join(stage, 'marketplace'), join(stage, 'marketplace'), 'folder', { counts: false });
    if (catalog.problem) return failed(`Its archive doesn’t hold a marketplace that can be read: ${catalog.problem}`);
    if (catalog.name !== release.marketplace) return failed(`Its archive holds the marketplace “${catalog.name}”, not “${release.marketplace}”, so it was not used.`);
    // The swap: the folder in use steps aside, the new one takes its path, then the manifest says what is there. A stop
    // between the first two steps is mended at the next open (activeBundle); one before the manifest is written leaves the
    // new content under the old manifest, which the next open replaces again from the same release.
    const live = bundledMarketplace(dataDir), previous = previousFolder(dataDir);
    await rm(previous, { recursive: true, force: true });
    if (await exists(live)) await rename(live, previous);
    await rename(join(stage, 'marketplace'), live);
    await writeDurably(join(root, RELEASE_FILE), `${JSON.stringify(release, null, 2)}\n`);
    await rm(previous, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
    return {};
  } catch (error) { return failed(`It could not be put in place: ${error instanceof Error ? error.message : String(error)}`); }
}

/**
 * The bundle a bundled build opens with. The release it carries (`carried`: the folder holding its release.json and archive)
 * is put in use when nothing is yet, or when it is newer than what is, or names another marketplace. Content already in use
 * that is as new or newer stays: an app update never takes a bundle's content back (ORG-05). `problem` says why the carried
 * release could not be used; whatever was in use before is still returned.
 */
export async function openBundle(dataDir: string, carried: string): Promise<{ active?: ActiveBundle; problem?: string }> {
  const active = await activeBundle(dataDir);
  const release = await readRelease(join(carried, RELEASE_FILE));
  if (!release) return { active, problem: 'The marketplace this build carries has no manifest that can be read.' };
  if (active && active.release.marketplace === release.marketplace && active.release.sequence >= release.sequence) return { active };
  const { problem } = await activateRelease(dataDir, release, join(carried, release.archive));
  return problem ? { active, problem: `The marketplace this build carries could not be unpacked. ${problem}` } : { active: await activeBundle(dataDir) };
}
