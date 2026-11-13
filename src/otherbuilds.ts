// Another build of Central Knot on this Mac (the preview beside the alpha, or the other way round): found at each look, and
// removed or quit only on a click. Nothing about it is stored, and nothing here runs by itself.
// - The look (lookForBuilds): the bundles in the two Applications folders (platform.ts macPlaces) whose folder name starts with
//   the product's name and whose Info.plist names a known build (knownBuilds) other than this one; and the copies of those
//   builds that are running, by bundle id, wherever they run from (runningCopies: the one meaning of "running" here, also
//   what the take-over band says of the build that syncs a home).
// - Remove (removeClick, then removeBuild): only another build's bundle in an Applications folder, checked at the click; every
//   running copy is asked to quit first, and the bundle goes to the Trash. Quit (quitBuild) only asks. Each says in plain
//   words what came of it.
// Elsewhere: main.ts runs the look with each view (HomeView otherBuilds) and answers builds:remove and builds:quit, with one
// line in the log for each; the page draws it all in otherbuildview.ts (the Overview's band, the two take-over choices that
// matrix.ts otherOwnerBand and pages.ts overviewPage show) and settingspage.ts otherBuildsSection. The shapes are
// types.ts OtherBuild and BuildOutcome. Tests stand in for the Mac with tests/macstandins.ts.
import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { MacPlaces } from './platform.ts';
import { errorCode, syncGate, takeOverSync, type ShareContext } from './share.ts';
import type { BuildOutcome, OtherBuild } from './types.ts';
import { lineApp, type BuildApp } from './updates.ts';
import { PRODUCT } from './values.ts';

/** What a look or a click goes by: this build, the builds that count, and where this Mac's apps are. */
export interface BuildsContext {
  /** This app's bundle id: a bundle with it is never another build. */
  own: string;
  /** This app's own bundle, never removed; unset in a run from the source. */
  ownBundle?: string;
  known: BuildApp[];
  places: MacPlaces;
  /** Moves a bundle to the Trash: Electron's shell.trashItem, or intoFolder(places.trash) where a test names its own. */
  trash: (bundle: string) => Promise<void>;
  /** The account's home, for showing a path inside it as ~. */
  home: string;
  /** How long the copies asked to quit are waited for (QUIT_WAIT_MS unless a test says). */
  quitWaitMs?: number;
}

/** How long Remove and Quit wait for a build asked to quit: a few seconds, enough for an idle app. */
export const QUIT_WAIT_MS = 5_000;

/**
 * The builds of Central Knot a look counts: the standard app, the alpha, and the build the open home's record names as its owner
 * (a custom build, say). No other id is special.
 */
export function knownBuilds(owner?: { build: string; name: string }): BuildApp[] {
  const builds = [lineApp('preview'), lineApp('alpha')];
  return owner && !builds.some(build => build.bundleId === owner.build) ? [...builds, { bundleId: owner.build, name: owner.name }] : builds;
}

/** Moves a bundle into a folder of a test's own instead of the account's Trash (platform.ts macPlaces trash), keeping its name where it is free. */
export const intoFolder = (folder: string) => async (bundle: string) => {
  await mkdir(folder, { recursive: true });
  const target = join(folder, basename(bundle));
  await rename(bundle, (await lstat(target).catch(() => undefined)) ? join(folder, `${Date.now()} ${basename(bundle)}`) : target);
};

/** A path as the words show it: inside the account's home, from ~. */
const shown = (context: BuildsContext, path: string) => (path.startsWith(`${context.home}/`) ? `~${path.slice(context.home.length)}` : path);

const PLIST_ID = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/;
/** A bundle's id, from its Info.plist as an app's own (XML) one has it; undefined where there is none to read. */
const bundleIdOf = async (bundle: string) => (await readFile(join(bundle, 'Contents/Info.plist'), 'utf8').catch(() => '')).match(PLIST_ID)?.[1]?.trim();

/** The known build a bundle is, if it is a folder of its own (not a link) whose Info.plist names one (this build's own too). */
async function buildOf(context: BuildsContext, bundle: string): Promise<BuildApp | undefined> {
  if (!(await lstat(bundle).catch(() => undefined))?.isDirectory()) return undefined;
  const id = await bundleIdOf(bundle);
  return context.known.find(build => build.bundleId === id);
}

/** Every bundle of a known build at the top of the Applications folders; undefined where a folder that is there can't be read. */
async function installedBuilds(context: BuildsContext): Promise<{ build: BuildApp; bundle: string }[] | undefined> {
  const found: { build: BuildApp; bundle: string }[] = [];
  for (const folder of context.places.applications) {
    let names: string[];
    try { names = await readdir(folder); } catch (error) { if (errorCode(error) === 'ENOENT') continue; return undefined; }
    for (const name of names.filter(name => name.startsWith(PRODUCT) && name.endsWith('.app')).sort()) {
      const build = await buildOf(context, join(folder, name));
      if (build) found.push({ build, bundle: join(folder, name) });
    }
  }
  return found;
}

/** A program's output, or undefined when it can't be run or fails. */
const output = (program: string, args: string[]) =>
  new Promise<string | undefined>(done => execFile(program, args, { timeout: 5_000 }, (error, out) => done(error ? undefined : String(out))));

/**
 * Every running copy of a build, by its bundle id, with its process and the bundle it runs from, as macOS lists running apps
 * (places.lsappinfo: `find` gives each copy, `info` its pid and bundle). Undefined when that can't be told. A copy that is gone
 * between the two asks is left out.
 */
export async function runningCopies(lsappinfo: string, build: string): Promise<{ pid: number; bundle: string }[] | undefined> {
  const found = await output(lsappinfo, ['find', `bundleid=${build}`]);
  if (found === undefined) return undefined;
  const copies: { pid: number; bundle: string }[] = [];
  for (const asn of found.match(/ASN:0x[0-9a-f]+-0x[0-9a-f]+/gi) ?? []) {
    const info = await output(lsappinfo, ['info', '-only', 'pid', '-only', 'bundlepath', asn]) ?? '';
    const pid = Number(/"pid"\s*=\s*(\d+)/.exec(info)?.[1]), bundle = /"LSBundlePath"\s*=\s*"([^"]*)"/.exec(info)?.[1];
    if (pid && bundle) copies.push({ pid, bundle });
  }
  return copies;
}

/** Whether any copy of a build is running (runningCopies); undefined when that can't be told. */
export async function isRunning(context: BuildsContext, build: string): Promise<boolean | undefined> {
  const copies = await runningCopies(context.places.lsappinfo, build);
  return copies === undefined ? undefined : copies.length > 0;
}

/**
 * Another build of Central Knot on this Mac: each of its bundles in an Applications folder, with where its copies run, and a
 * build none of whose bundles is there but which is running, from wherever it runs. Undefined where an Applications folder that
 * is there can't be read: a page then says nothing rather than that nothing is there.
 */
export async function lookForBuilds(context: BuildsContext): Promise<OtherBuild[] | undefined> {
  const bundles = await installedBuilds(context);
  if (!bundles) return undefined;
  const found: OtherBuild[] = [];
  for (const build of context.known.filter(known => known.bundleId !== context.own)) {
    const running = (await runningCopies(context.places.lsappinfo, build.bundleId))?.map(copy => copy.bundle);
    const installed = bundles.filter(each => each.build.bundleId === build.bundleId);
    for (const each of installed) found.push({ build: build.bundleId, name: build.name, installed: each.bundle, ...(running ? { running } : {}) });
    if (!installed.length && running?.length) found.push({ build: build.bundleId, name: build.name, running });
  }
  return found;
}

/**
 * Asks every running copy of a build to quit, with the signal Central Knot takes as Quit (no AppleScript, so macOS asks no
 * permission), then asks again, by bundle id, until none runs or the wait is over. 'unknown': whether it runs can't be told.
 */
async function quitCopies(context: BuildsContext, build: string): Promise<'none' | 'quit' | 'still' | 'unknown'> {
  const copies = await runningCopies(context.places.lsappinfo, build);
  if (!copies) return 'unknown';
  if (!copies.length) return 'none';
  for (const copy of copies) { try { process.kill(copy.pid, 'SIGTERM'); } catch { /* it quit meanwhile */ } }
  const until = Date.now() + (context.quitWaitMs ?? QUIT_WAIT_MS);
  for (;;) {
    await delay(250);
    const left = await runningCopies(context.places.lsappinfo, build);
    if (left && !left.length) return 'quit';
    if (Date.now() >= until) return left ? 'still' : 'unknown';
  }
}

/** The same folder or bundle, links followed. */
const samePlace = async (first: string, second: string) =>
  (await realpath(first).catch(() => resolve(first))) === (await realpath(second).catch(() => resolve(second)));

/** Where it starts at sign-in: each build adds itself at its first open, and one build can't turn another's entry off. */
const signInWords = (name: string) => `If ${name} still starts at sign-in, turn it off in System Settings › General › Login Items.`;

const notABuild = (context: BuildsContext, bundle: string) => `${shown(context, bundle)} isn’t another build of ${PRODUCT} in an Applications folder, so nothing was removed.`;

/** Why a bundle may not be removed as `wanted`, checked at the click: undefined when it is that build's, in an Applications folder. */
async function refusal(context: BuildsContext, bundle: string, wanted: BuildApp): Promise<string | undefined> {
  const where = shown(context, bundle);
  if (!context.places.applications.includes(dirname(bundle)) || !basename(bundle).startsWith(PRODUCT) || !bundle.endsWith('.app')) return notABuild(context, bundle);
  if (context.ownBundle && await samePlace(bundle, context.ownBundle)) return `${where} is this app itself, so nothing was removed.`;
  if (!(await lstat(bundle).catch(() => undefined))) return `${where} isn’t there any more, so nothing was removed.`;
  if ((await buildOf(context, bundle))?.bundleId !== wanted.bundleId) return `${where} isn’t ${wanted.name}, so nothing was removed. It may have been replaced since Central Knot looked.`;
  return undefined;
}

/**
 * Removes another build of Central Knot: refused, in plain words, for anything but another build's bundle in an Applications
 * folder (refusal), checked now and not at the look. Every running copy of it is asked to quit and waited for (quitCopies); if
 * any is still running (it may be asking about unsaved work) nothing is removed. Then the bundle goes to the Trash, and where
 * macOS refuses that nothing else is tried: the words say so, with the bundle to show in Finder.
 */
export async function removeBuild(context: BuildsContext, path: string, build: string): Promise<BuildOutcome> {
  const bundle = resolve(path), wanted = context.known.find(known => known.bundleId === build && known.bundleId !== context.own);
  if (!wanted) return { said: notABuild(context, bundle), done: false };
  const refused = await refusal(context, bundle, wanted);
  if (refused) return { said: refused, done: false };
  const { name } = wanted;
  const quit = await quitCopies(context, build);
  if (quit === 'unknown') return { said: `Central Knot couldn’t tell whether ${name} is running, so nothing was removed. Quit ${name}, then try again.`, done: false };
  if (quit === 'still') return { said: `${name} is still running, so nothing was removed: it may be asking about unsaved work. Quit it yourself, then try again.`, done: false };
  try { await context.trash(bundle); } catch {
    const refused = quit === 'quit' ? `${name} has quit, but macOS didn’t let Central Knot move it to the Trash` : `macOS didn’t let Central Knot move ${name} to the Trash`;
    return { said: `${refused}, so it is still in ${shown(context, dirname(bundle))}. Nothing else was tried: move it to the Trash in Finder, or ask whoever manages this Mac.`, done: false, show: bundle };
  }
  return {
    said: `${name} is in the Trash, where it stays until you empty the Trash. Your skills, MCP servers and agents, and ${PRODUCT}’s record of them, stay where they are: they’re kept in the home, not in the app. ${name}’s own settings folder stays too. ${signInWords(name)}`,
    done: true,
  };
}

/**
 * A click's Remove: with `takeOver`, syncing this home is taken over from the build first (share.ts takeOverSync) and said on its
 * own, and a take-over refused removes nothing; a remove that then fails leaves the take-over done, and says so. Without it, the
 * build that syncs this home is not removed: the home would be left with an owner that is gone.
 */
export async function removeClick(home: ShareContext, context: BuildsContext, path: string, build: string, takeOver: boolean): Promise<BuildOutcome & { took?: string }> {
  const gate = await syncGate(home);
  const name = context.known.find(known => known.bundleId === build)?.name ?? build;
  if (!takeOver && gate.state === 'stopped' && gate.owner?.build === build) return { said: `${name} syncs this home, so it was not removed. Take over syncing first.`, done: false };
  if (!takeOver) return removeBuild(context, path, build);
  const taken = await takeOverSync(home);
  if (taken.stopped) return { said: `Syncing was not taken over, so nothing was removed. ${taken.stopped}`, done: false };
  const removal = await removeBuild(context, path, build);
  return { ...removal, said: `${taken.from ? 'Central Knot now syncs this home. ' : ''}${removal.said}`, ...(taken.from ? { took: taken.from } : {}) };
}

/** Quit: asks every running copy of another build to quit (quitCopies), and says what came of it. Nothing is removed. */
export async function quitBuild(context: BuildsContext, build: string): Promise<BuildOutcome> {
  const wanted = context.known.find(known => known.bundleId === build && known.bundleId !== context.own);
  if (!wanted) return { said: `That isn’t another build of ${PRODUCT}, so nothing was asked to quit.`, done: false };
  const fromTrash = (await runningCopies(context.places.lsappinfo, build))?.some(copy => copy.bundle.includes('/.Trash/'));
  const quit = await quitCopies(context, build);
  const { name } = wanted;
  if (quit === 'none') return { said: `${name} isn’t running.`, done: true };
  if (quit === 'quit') return { said: `${name} has quit.${fromTrash ? ` It ran from the Trash. ${signInWords(name)}` : ''}`, done: true };
  if (quit === 'still') return { said: `${name} is still running: it may be asking about unsaved work. Quit it from its own window or menu.`, done: false };
  return { said: `Central Knot couldn’t tell whether ${name} is running.`, done: false };
}
