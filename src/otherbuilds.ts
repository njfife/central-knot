// Another build of Central Knot on this Mac (one install at a time): found at each look, and replaced or quit only on a click.
// Nothing about it is stored, and nothing here runs by itself. A build is its bundle id: one starting `com.centralknot.` (BUILD_ID:
// the standard app's, the alpha's and every custom build's) other than this build's own.
// - The look (lookForBuilds): the bundles at the top of the two Applications folders (platform.ts macPlaces) that Replace may
//   take (whyNot: a folder of its own whose Info.plist names another build), each by the name its Info.plist gives; and the
//   copies running of those builds, of the standard app and the alpha, and of the build the open home's record names, by
//   bundle id, wherever they run from (runningCopies: the one meaning of "running" here, also what the take-over band says of
//   the build that syncs a home). A bundle in a subfolder of Applications is not looked at.
// - Replace (removeBuild): only from a copy of this build that runs at the top of an Applications folder (runsOutside); the
//   same check at the click and again just before the Trash; every running copy is asked to quit first and waited for. Quit
//   (quitBuild) only asks. Where anything isn't known for sure, nothing is quit or removed. Each says in plain words what came
//   of it.
// Elsewhere: main.ts looks first in each view and holds this build while another is found (heldReason, model.ts holdingBuild:
// share.ts writeAccess refuses), answers builds:replace and builds:quit and then carries on (carryOn: the replaced build's
// settings kept, the home's record taken over); the page draws the held screen (otherbuildview.ts). The shapes are types.ts
// OtherBuild and BuildOutcome. Tests stand in for the Mac with tests/macstandins.ts.
import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { MacPlaces } from './platform.ts';
import { errorCode } from './share.ts';
import type { BuildOutcome, OtherBuild } from './types.ts';
import { ALPHA_BUILD } from './updates.ts';
import { PRODUCT, STANDARD_BUILD } from './values.ts';

/** What a look or a click goes by: this build, and where this Mac's apps are. */
export interface BuildsContext {
  /** This app's bundle id: a bundle with it is never another build. */
  own: string;
  /** This app's own bundle, never removed; unset in a run from the source, which counts as installed. */
  ownBundle?: string;
  places: MacPlaces;
  /** Moves a bundle to the Trash: Electron's shell.trashItem, or intoFolder(places.trash) where a test names its own. */
  trash: (bundle: string) => Promise<void>;
  /** The account's home, for showing a path inside it as ~. */
  home: string;
  /** How long the copies asked to quit are waited for (QUIT_WAIT_MS unless a test says). */
  quitWaitMs?: number;
}

/** A build of Central Knot's bundle id: the standard app's, the alpha's or a custom build's (bundlepack.ts). */
const BUILD_ID = /^com\.centralknot\./;
/** How long Replace and Quit wait for a build asked to quit: longer than the 15 s a build holds its quit for a plugin step under way (main.ts before-quit). */
export const QUIT_WAIT_MS = 20_000;

/** Moves a bundle into a folder of a test's own instead of the account's Trash (platform.ts macPlaces trash), keeping its name where it is free. */
export const intoFolder = (folder: string) => async (bundle: string) => {
  await mkdir(folder, { recursive: true });
  const target = join(folder, basename(bundle));
  await rename(bundle, (await lstat(target).catch(() => undefined)) ? join(folder, `${Date.now()} ${basename(bundle)}`) : target);
};

/** A path as the words show it: inside the account's home, from ~. */
const shown = (context: BuildsContext, path: string) => (path.startsWith(`${context.home}/`) ? `~${path.slice(context.home.length)}` : path);

/** One key's text in an app's (XML) Info.plist. */
const plistValue = (plist: string, key: string) => new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(plist)?.[1]?.trim();
/** A bundle's id and name, from its Info.plist as an app's own (XML) one has them; nothing where there is none to read. */
async function plistOf(bundle: string): Promise<{ id?: string; name?: string }> {
  const plist = await readFile(join(bundle, 'Contents/Info.plist'), 'utf8').catch(() => '');
  return { id: plistValue(plist, 'CFBundleIdentifier'), name: plistValue(plist, 'CFBundleName') };
}

/** Whether an id is another build of Central Knot than this one. */
const isOtherBuild = (context: BuildsContext, id: string | undefined): id is string => !!id && BUILD_ID.test(id) && id !== context.own;

const notABuild = (context: BuildsContext, bundle: string) => `${shown(context, bundle)} isn’t another build of ${PRODUCT} in an Applications folder, so nothing was removed.`;

/**
 * What Replace may take, as `wanted`: a folder of its own (not a link) at the top of an Applications folder, not this app,
 * whose Info.plist names `wanted`'s id. Undefined when it may; else why not, in words. Asked at the look, at the click, and
 * again as the last thing before the Trash, since the bundle may be replaced meanwhile.
 */
async function whyNot(context: BuildsContext, bundle: string, wanted: OtherBuild): Promise<string | undefined> {
  const where = shown(context, bundle);
  if (!context.places.applications.includes(dirname(bundle)) || !bundle.endsWith('.app') || !isOtherBuild(context, wanted.build)) return notABuild(context, bundle);
  if (context.ownBundle && await samePlace(bundle, context.ownBundle)) return `${where} is this app itself, so nothing was removed.`;
  const found = await lstat(bundle).catch(() => undefined);
  if (!found) return `${where} isn’t there any more, so nothing was removed.`;
  if (!found.isDirectory() || (await plistOf(bundle)).id !== wanted.build) return `${where} isn’t ${wanted.name}, so nothing was removed. It may have been replaced since Central Knot looked.`;
  return undefined;
}

/** Every bundle of another build at the top of the Applications folders (whyNot), by its name; undefined where a folder that is there can't be read. */
async function installedBuilds(context: BuildsContext): Promise<(OtherBuild & { installed: string })[] | undefined> {
  const found: (OtherBuild & { installed: string })[] = [];
  for (const folder of context.places.applications) {
    let names: string[];
    try { names = await readdir(folder); } catch (error) { if (errorCode(error) === 'ENOENT') continue; return undefined; }
    for (const name of names.filter(each => each.endsWith('.app')).sort()) {
      const bundle = join(folder, name), { id, name: shownName } = await plistOf(bundle);
      const build = { build: id ?? '', name: shownName ?? name.slice(0, -'.app'.length), installed: bundle };
      if (isOtherBuild(context, id) && !(await whyNot(context, bundle, build))) found.push(build);
    }
  }
  return found;
}

/** A program's output, or undefined when it can't be run or fails. */
const output = (program: string, args: string[]) =>
  new Promise<string | undefined>(done => execFile(program, args, { timeout: 5_000 }, (error, out) => done(error ? undefined : String(out))));

/**
 * Every running copy of a build, by its bundle id, with its process and the bundle it runs from, as macOS lists running apps
 * (places.lsappinfo: `find` gives each copy, `info` its pid and bundle). Undefined when that can't be told: the list can't be
 * read, it says something no copy can be read from, or a copy it lists can't be asked about (one that quit between the two asks
 * is asked about again at the next look).
 */
export async function runningCopies(lsappinfo: string, build: string): Promise<{ pid: number; bundle: string }[] | undefined> {
  const found = await output(lsappinfo, ['find', `bundleid=${build}`]);
  if (found === undefined) return undefined;
  const listed = found.match(/ASN:0x[0-9a-f]+-0x[0-9a-f]+/gi) ?? [];
  // Something was said and no copy could be read from it: that is not "nothing runs".
  if (!listed.length && found.trim()) return undefined;
  const copies: { pid: number; bundle: string }[] = [];
  for (const asn of listed) {
    const info = await output(lsappinfo, ['info', '-only', 'pid', '-only', 'bundlepath', asn]) ?? '';
    const pid = Number(/"pid"\s*=\s*(\d+)/.exec(info)?.[1]), bundle = /"LSBundlePath"\s*=\s*"([^"]*)"/.exec(info)?.[1];
    if (!pid || !bundle) return undefined;
    copies.push({ pid, bundle });
  }
  return copies;
}

/** Whether any copy of a build is running (runningCopies); undefined when that can't be told. */
export async function isRunning(context: BuildsContext, build: string): Promise<boolean | undefined> {
  const copies = await runningCopies(context.places.lsappinfo, build);
  return copies === undefined ? undefined : copies.length > 0;
}

/**
 * Other builds of Central Knot on this Mac: each bundle in an Applications folder, with where its build's copies run, and a
 * build none of whose bundles is there but which is running, from wherever it runs, by the name its running bundle gives.
 * Running copies are looked for by id: the builds found installed, the standard app, the alpha, and `owner`, the build the open
 * home's record names (a custom build running from elsewhere is found only so). Undefined where an Applications folder that is
 * there can't be read: whether another build is here can't be told then.
 */
export async function lookForBuilds(context: BuildsContext, owner?: string): Promise<OtherBuild[] | undefined> {
  const bundles = await installedBuilds(context);
  if (!bundles) return undefined;
  const ids = [...new Set([...bundles.map(each => each.build), STANDARD_BUILD, ALPHA_BUILD, owner])].filter(id => isOtherBuild(context, id));
  const found: OtherBuild[] = [];
  for (const build of ids) {
    const running = (await runningCopies(context.places.lsappinfo, build))?.map(copy => copy.bundle);
    const installed = bundles.filter(each => each.build === build);
    for (const each of installed) found.push({ ...each, ...(running ? { running } : {}) });
    if (!installed.length && running?.length) found.push({ build, name: (await plistOf(running[0])).name ?? `Another ${PRODUCT} build (${build})`, running });
  }
  return found;
}

/** Where this copy of the app runs from, when that is not the top of an Applications folder (the Trash, a disk image, Downloads): it replaces no build from there. */
export const runsOutside = (context: BuildsContext) => (context.ownBundle && !context.places.applications.includes(dirname(context.ownBundle)) ? context.ownBundle : undefined);

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
/** What a wait that ran out says: a build may take a while to finish what it is doing, but not this long. */
const stillWords = (context: BuildsContext, name: string) => `${name} didn’t quit within ${Math.round((context.quitWaitMs ?? QUIT_WAIT_MS) / 1000)} seconds`;

/** The same folder or bundle, links followed. */
const samePlace = async (first: string, second: string) =>
  (await realpath(first).catch(() => resolve(first))) === (await realpath(second).catch(() => resolve(second)));

/** Where it starts at sign-in: each build adds itself at its first open, and one build can't turn another's entry off. */
const signInWords = (name: string) => `If ${name} still starts at sign-in, turn it off in System Settings › General › Login Items.`;

/**
 * Replace: removes another build of Central Knot. Refused, in plain words, from a copy of this app outside an Applications
 * folder (runsOutside: from a disk image it would leave no build installed), and for anything but another build's bundle at the
 * top of one (whyNot), checked at the click. Every running copy of it is asked to quit and waited for (quitCopies); if any is
 * still running, or whether it runs can't be told, nothing is removed. The bundle is checked again, then goes to the Trash;
 * where macOS refuses that, nothing else is tried: the words say so, with the bundle to show in Finder.
 */
export async function removeBuild(context: BuildsContext, found: OtherBuild): Promise<BuildOutcome> {
  const outside = runsOutside(context), { name } = found;
  if (outside) return { said: `This copy runs from ${shown(context, outside)}, not from an Applications folder, so nothing was removed. Move it to Applications and open it from there first.`, done: false };
  if (!found.installed) return { said: `${name} isn’t in an Applications folder, so nothing was removed.`, done: false };
  const bundle = resolve(found.installed);
  const refused = await whyNot(context, bundle, found);
  if (refused) return { said: refused, done: false };
  const quit = await quitCopies(context, found.build);
  if (quit === 'unknown') return { said: `Central Knot couldn’t tell whether ${name} is running, so nothing was removed. Quit ${name}, then try again.`, done: false };
  if (quit === 'still') return { said: `${stillWords(context, name)}, so nothing was removed. Quit it yourself, then try again.`, done: false };
  const changed = await whyNot(context, bundle, found);
  if (changed) return { said: `${quit === 'quit' ? `${name} has quit. ` : ''}${changed}`, done: false };
  try { await context.trash(bundle); } catch {
    const kept = quit === 'quit' ? `${name} has quit, but macOS didn’t let Central Knot move it to the Trash` : `macOS didn’t let Central Knot move ${name} to the Trash`;
    return { said: `${kept}, so it is still in ${shown(context, dirname(bundle))}. Nothing else was tried: move it to the Trash in Finder, or ask whoever manages this Mac.`, done: false, show: bundle };
  }
  return {
    said: `${name} is in the Trash, where it stays until you empty the Trash. Your skills, MCP servers and agents, and the record of them, stay where they are: they’re kept in the home, not in an app. ${name}’s own settings folder stays too. ${signInWords(name)}`,
    done: true,
  };
}

/** Quit: asks every running copy of another build to quit (quitCopies), and says what came of it. Nothing is removed. */
export async function quitBuild(context: BuildsContext, found: OtherBuild): Promise<BuildOutcome> {
  const { name } = found;
  if (!isOtherBuild(context, found.build)) return { said: `That isn’t another build of ${PRODUCT}, so nothing was asked to quit.`, done: false };
  const fromTrash = (await runningCopies(context.places.lsappinfo, found.build))?.some(copy => copy.bundle.includes('/.Trash/'));
  const quit = await quitCopies(context, found.build);
  if (quit === 'none') return { said: `${name} isn’t running.`, done: true };
  if (quit === 'quit') return { said: `${name} has quit.${fromTrash ? ` It ran from the Trash. ${signInWords(name)}` : ''}`, done: true };
  if (quit === 'still') return { said: `${stillWords(context, name)}. Quit it from its own window or menu.`, done: false };
  return { said: `Central Knot couldn’t tell whether ${name} is running.`, done: false };
}
