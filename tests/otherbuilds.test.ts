// Another build of Central Knot on this Mac (otherbuilds.ts), worked from made-up bundles and stand-in running apps in a temp
// folder (tests/macstandins.ts): what counts as another build, where it runs, and every way Remove refuses or goes ahead.
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';
import { intoFolder, knownBuilds, lookForBuilds, quitBuild, removeBuild, removeClick, type BuildsContext } from '../src/otherbuilds.ts';
import { macPlaces } from '../src/platform.ts';
import { readRecord, type ShareContext } from '../src/share.ts';
import { ALPHA_BUILD, type BuildApp } from '../src/updates.ts';
import { STANDARD_BUILD } from '../src/values.ts';
import { standInApp, standInMac } from './macstandins.ts';

const ALPHA = 'Central Knot Alpha', STANDARD = 'Central Knot';
const TRASH_WORDS = `${ALPHA} is in the Trash, where it stays until you empty the Trash. Your skills, MCP servers and agents, and Central Knot’s record of them, stay where they are: they’re kept in the home, not in the app. ${ALPHA}’s own settings folder stays too. If ${ALPHA} still starts at sign-in, turn it off in System Settings › General › Login Items.`;

/**
 * A Mac made up in a temp folder: the standard app runs (unless `own` says another build), the stand-ins hold the apps, and
 * the account's home has an Applications folder of its own. Every stand-in app started is killed at the end.
 */
async function aMac(work: (mac: ReturnType<typeof made>) => Promise<void>, own = STANDARD_BUILD) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ck-builds-')));
  const mac = made(base, own);
  try { await work(mac); } finally { for (const app of mac.apps) app.kill('SIGKILL'); rmSync(base, { recursive: true, force: true }); }
}
function made(base: string, own: string) {
  const stand = standInMac(join(base, 'mac'));
  const home = join(base, 'home'), mine = join(home, 'Applications'), downloads = join(home, 'Downloads');
  mkdirSync(mine, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  const context: BuildsContext = { own, known: knownBuilds(), places: macPlaces(home, { CK_TEST_APPS: stand.root }), trash: intoFolder(stand.trash), home, quitWaitMs: 1500 };
  const apps: ChildProcess[] = [];
  /** A stand-in app running from `path` as the build `bundleId` (one that quits when asked, or not), listed as running. */
  const runs = async (copies: { bundleId: string; path: string; quits: boolean }[]) => {
    const started = await Promise.all(copies.map(copy => standInApp(copy.quits)));
    apps.push(...started);
    stand.running(copies.map((copy, index) => ({ bundleId: copy.bundleId, path: copy.path, pid: started[index].pid! })));
    return started;
  };
  const trashed = () => (existsSync(stand.trash) ? readdirSync(stand.trash) : []);
  return { stand, home, mine, downloads, context, apps, runs, trashed };
}
const alive = (app: ChildProcess) => app.exitCode === null && app.signalCode === null;

test('Another build is a bundle at the top of an Applications folder, named for the product, whose Info.plist names a known build other than this one', () => aMac(async ({ stand, mine, downloads, context }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const alsoMine = stand.bundle(mine, ALPHA, ALPHA_BUILD);
  stand.bundle(stand.applications, STANDARD, STANDARD_BUILD);
  stand.bundle(stand.applications, 'Central Knot Helper', 'com.example.helper');
  stand.bundle(stand.applications, 'Notes', ALPHA_BUILD);
  stand.bundle(join(stand.applications, 'Older'), ALPHA, ALPHA_BUILD);
  stand.bundle(downloads, ALPHA, ALPHA_BUILD);
  symlinkSync(alpha, join(stand.applications, 'Central Knot Link.app'));
  // Found: the alpha in each folder, the person's own first. Not: this build itself, an app of another id under the product's
  // name, the alpha under another name, one a folder down, one in Downloads (it isn't running) and a link to one.
  assert.deepEqual(await lookForBuilds(context), [
    { build: ALPHA_BUILD, name: ALPHA, installed: alsoMine, running: [] },
    { build: ALPHA_BUILD, name: ALPHA, installed: alpha, running: [] },
  ]);
}));

test('It is the same from either side: the alpha finds the standard app; a custom build, even one a home’s record names, is not offered', () => aMac(async ({ stand, context }) => {
  const standard = stand.bundle(stand.applications, STANDARD, STANDARD_BUILD);
  stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  stand.bundle(stand.applications, 'Central Knot for Acme', 'com.centralknot.custom.acme');
  assert.deepEqual(await lookForBuilds(context), [{ build: STANDARD_BUILD, name: STANDARD, installed: standard, running: [] }]);
}, ALPHA_BUILD));

test('A running build is found by its bundle id wherever it runs from; one with no bundle in an Applications folder is found running, for Quit', () => aMac(async ({ stand, downloads, context, runs }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const translocated = join(downloads, 'AppTranslocation/d/Central Knot Alpha.app');
  await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: true }, { bundleId: ALPHA_BUILD, path: translocated, quits: true }]);
  assert.deepEqual(await lookForBuilds(context), [{ build: ALPHA_BUILD, name: ALPHA, installed: alpha, running: [alpha, translocated] }]);
  // Removed from the folder and started again from the Trash (at the next sign-in, say): found running, from there.
  rmSync(alpha, { recursive: true });
  const fromTrash = join(context.home, '.Trash/Central Knot Alpha.app');
  await runs([{ bundleId: ALPHA_BUILD, path: fromTrash, quits: true }]);
  assert.deepEqual(await lookForBuilds(context), [{ build: ALPHA_BUILD, name: ALPHA, running: [fromTrash] }]);
}));

test('Where whether a build runs can’t be told, the look leaves `running` unset; where an Applications folder can’t be read there is no look', { skip: process.getuid?.() === 0 }, () => aMac(async ({ stand, mine, context }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  rmSync(mine, { recursive: true });
  const blind = { ...context, places: { ...context.places, lsappinfo: join(stand.root, 'no-such-program') } };
  assert.deepEqual(await lookForBuilds(blind), [{ build: ALPHA_BUILD, name: ALPHA, installed: alpha }], 'a missing ~/Applications is no matter');
  chmodSync(stand.applications, 0o000);
  try { assert.equal(await lookForBuilds(context), undefined); } finally { chmodSync(stand.applications, 0o755); }
}));

test('Remove refuses, in plain words and changing nothing, anything but another build’s bundle in an Applications folder', () => aMac(async ({ stand, mine, downloads, context, trashed }) => {
  const own = stand.bundle(stand.applications, STANDARD, STANDARD_BUILD);
  const self = { ...context, ownBundle: own };
  const inDownloads = stand.bundle(downloads, ALPHA, ALPHA_BUILD);
  const helper = stand.bundle(stand.applications, 'Central Knot Helper', 'com.example.helper');
  const replaced = stand.bundle(mine, ALPHA, ALPHA_BUILD);
  writeFileSync(join(replaced, 'Contents/Info.plist'), readFileSync(join(helper, 'Contents/Info.plist')));
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  symlinkSync(alpha, join(stand.applications, 'Central Knot Link.app'));
  const cases: [string, string, string, string][] = [
    ['in Downloads', inDownloads, ALPHA_BUILD, `~/Downloads/Central Knot Alpha.app isn’t another build of Central Knot in an Applications folder, so nothing was removed.`],
    ['this app itself', own, ALPHA_BUILD, `${own} is this app itself, so nothing was removed.`],
    ['this build’s id', alpha, STANDARD_BUILD, `${alpha} isn’t another build of Central Knot in an Applications folder, so nothing was removed.`],
    ['an id that is no build', helper, 'com.example.helper', `${helper} isn’t another build of Central Knot in an Applications folder, so nothing was removed.`],
    ['an app under the product’s name with another id', helper, ALPHA_BUILD, `${helper} isn’t ${ALPHA}, so nothing was removed. It may have been replaced since Central Knot looked.`],
    ['replaced since the look', replaced, ALPHA_BUILD, `~/Applications/Central Knot Alpha.app isn’t ${ALPHA}, so nothing was removed. It may have been replaced since Central Knot looked.`],
    ['a link to one', join(stand.applications, 'Central Knot Link.app'), ALPHA_BUILD, `${join(stand.applications, 'Central Knot Link.app')} isn’t ${ALPHA}, so nothing was removed. It may have been replaced since Central Knot looked.`],
    ['gone since the look', join(stand.applications, 'Central Knot Gone.app'), ALPHA_BUILD, `${join(stand.applications, 'Central Knot Gone.app')} isn’t there any more, so nothing was removed.`],
  ];
  for (const [what, path, build, said] of cases) assert.deepEqual(await removeBuild(self, path, build), { said, done: false }, what);
  assert.ok([inDownloads, helper, replaced, alpha, own].every(path => existsSync(join(path, 'Contents/Info.plist'))), 'every bundle is where it was');
  assert.deepEqual(trashed(), []);
}));

test('Remove asks a running build to quit, waits for it, then moves its bundle to the Trash', () => aMac(async ({ stand, context, runs, trashed }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: true }]);
  assert.deepEqual(await removeBuild(context, alpha, ALPHA_BUILD), { said: TRASH_WORDS, done: true });
  await wait(50);
  assert.equal(app.signalCode ?? app.exitCode, 0, 'it quit when asked');
  assert.ok(!existsSync(alpha));
  assert.deepEqual(trashed(), ['Central Knot Alpha.app']);
  // The next look finds nothing; the app put back from the Trash is found again.
  assert.deepEqual(await lookForBuilds(context), []);
  stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  assert.equal((await lookForBuilds(context))?.length, 1);
}));

test('A build still running after the wait (its window asking about unsaved work) is not removed', () => aMac(async ({ stand, context, runs, trashed }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: false }]);
  assert.deepEqual(await removeBuild(context, alpha, ALPHA_BUILD), { said: `${ALPHA} is still running, so nothing was removed: it may be asking about unsaved work. Quit it yourself, then try again.`, done: false });
  assert.ok(alive(app) && existsSync(alpha));
  assert.deepEqual(trashed(), []);
}));

test('Every running copy is asked to quit, wherever it runs from, and nothing is removed while any runs', () => aMac(async ({ stand, downloads, context, runs }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const [installed, copy] = await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: false }, { bundleId: ALPHA_BUILD, path: join(downloads, 'Central Knot Alpha.app'), quits: true }]);
  assert.equal((await removeBuild(context, alpha, ALPHA_BUILD)).done, false);
  assert.ok(!alive(copy), 'the copy in Downloads was asked too, and quit');
  assert.ok(alive(installed) && existsSync(alpha), 'the installed copy still runs, so the bundle stays');
}));

test('Where the Trash refuses, nothing else is tried: the bundle stays, and the words say so with the bundle to show in Finder', () => aMac(async ({ stand, context, runs }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const refusing = { ...context, trash: async () => { throw new Error('The operation couldn’t be completed.'); } };
  const rest = `so it is still in ${stand.applications}. Nothing else was tried: move it to the Trash in Finder, or ask whoever manages this Mac.`;
  assert.deepEqual(await removeBuild(refusing, alpha, ALPHA_BUILD), { said: `macOS didn’t let Central Knot move ${ALPHA} to the Trash, ${rest}`, done: false, show: alpha });
  await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: true }]);
  assert.equal((await removeBuild(refusing, alpha, ALPHA_BUILD)).said, `${ALPHA} has quit, but macOS didn’t let Central Knot move it to the Trash, ${rest}`);
  assert.ok(existsSync(alpha));
}));

test('Where whether it runs can’t be told, nothing is removed', () => aMac(async ({ stand, context }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const blind = { ...context, places: { ...context.places, lsappinfo: join(stand.root, 'no-such-program') } };
  assert.deepEqual(await removeBuild(blind, alpha, ALPHA_BUILD), { said: `Central Knot couldn’t tell whether ${ALPHA} is running, so nothing was removed. Quit ${ALPHA}, then try again.`, done: false });
  assert.ok(existsSync(alpha));
}));

test('The bundle is checked again as the last thing before the Trash: one swapped in while the other app was quitting is not removed', () => aMac(async ({ stand, context, runs, trashed }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: false }]);
  const removing = removeBuild(context, alpha, ALPHA_BUILD);
  // While Remove waits for it to quit, the bundle is replaced by another app's, and then the alpha quits.
  await wait(400);
  rmSync(alpha, { recursive: true });
  stand.bundle(stand.applications, ALPHA, 'com.example.unrelated');
  app.kill('SIGKILL');
  const removal = await removing;
  assert.equal(removal.done, false, removal.said);
  assert.ok(existsSync(join(alpha, 'Contents/Info.plist')), 'the swapped-in app is where it was');
  assert.deepEqual(trashed(), []);
}));

test('A copy listed as running that can’t be asked about means whether it runs isn’t known: nothing is quit or removed', () => aMac(async ({ stand, context, runs }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: true }]);
  // macOS lists the copy, then can't say anything about it.
  const halting = join(stand.root, 'lsappinfo-halting');
  writeFileSync(halting, `#!${process.execPath}\nif (process.argv[2] === 'find') console.log('ASN:0x0-0x${app.pid!.toString(16)}-"stand-in":'); else process.exit(1);\n`, { mode: 0o755 });
  const halted = { ...context, places: { ...context.places, lsappinfo: halting } };
  assert.deepEqual(await removeBuild(halted, alpha, ALPHA_BUILD), { said: `Central Knot couldn’t tell whether ${ALPHA} is running, so nothing was removed. Quit ${ALPHA}, then try again.`, done: false });
  assert.deepEqual(await lookForBuilds(halted), [{ build: ALPHA_BUILD, name: ALPHA, installed: alpha }], 'the look says nothing of it running');
  assert.ok(alive(app) && existsSync(alpha));
}));

test('Only the standard app and the alpha are ever offered: an app a home’s record names as its owner is not found, quit or removed', () => aMac(async ({ stand, home, context: mac, runs }) => {
  let context = mac;
  const other = stand.bundle(stand.applications, 'Central Knot for Acme', 'com.example.other');
  const [app] = await runs([{ bundleId: 'com.example.other', path: other, quits: true }]);
  const synced = homeOwnedBy(home, 'com.example.other', 'Acme Tools');
  // Even handed the home's owner, as this code once was, only the two are known.
  const known = (knownBuilds as (owner?: unknown) => BuildApp[])({ build: 'com.example.other', name: 'Acme Tools' });
  assert.deepEqual(known.map(build => build.bundleId), [STANDARD_BUILD, ALPHA_BUILD]);
  context = { ...context, known };
  assert.deepEqual(await lookForBuilds(context), []);
  assert.equal((await quitBuild(context, 'com.example.other')).done, false);
  assert.equal((await removeClick(synced, context, other, 'com.example.other', true)).done, false);
  assert.ok(alive(app) && existsSync(other));
  assert.equal((await readRecord(synced.home)).record?.owner, 'com.example.other', 'nothing was taken over either');
}));

test('Every script that starts the app names its stand-in for this Mac, so none looks at the real Applications folders, Trash or running apps', () => {
  const scripts = join(import.meta.dirname, '../scripts');
  const starting = readdirSync(scripts).filter(name => /\.m?[jt]s$/.test(name)).map(name => [name, readFileSync(join(scripts, name), 'utf8')] as const)
    .filter(([, text]) => /\bspawn\(/.test(text) && /Contents\/MacOS|electron\/path\.txt/.test(text));
  assert.ok(starting.length >= 5, starting.map(([name]) => name).join());
  // Set in the app's environment, not only named in a comment line.
  const sets = (text: string) => /\bCK_TEST_APPS\s*:/.test(text.replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(starting.filter(([, text]) => !sets(text)).map(([name]) => name), []);
});

/** A home whose sync record names the alpha as its owner, and the standard app's context for it. */
const homeOwnedByAlpha = (base: string) => homeOwnedBy(base, ALPHA_BUILD, ALPHA);
/** A home whose sync record names `owner` as its owner, and the standard app's context for it. */
function homeOwnedBy(base: string, owner: string, ownerName: string): ShareContext {
  const home = join(base, 'synced');
  mkdirSync(join(home, '.central-knot'), { recursive: true });
  writeFileSync(join(home, '.central-knot/sync.json'), `${JSON.stringify({ formatVersion: 2, generation: 'g-1', owner, ownerName })}\n`);
  return { home, mode: 'custom', read: async () => [], build: STANDARD_BUILD, buildName: STANDARD, settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
}

test('Take over and remove: syncing is taken over first and said on its own, then the build is quit and in the Trash', () => aMac(async ({ stand, home, context, trashed }) => {
  const synced = homeOwnedByAlpha(home);
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  assert.deepEqual(await removeClick(synced, context, alpha, ALPHA_BUILD, true), { said: `Central Knot now syncs this home. ${TRASH_WORDS}`, done: true, took: ALPHA });
  assert.equal((await readRecord(synced.home)).record?.owner, STANDARD_BUILD);
  assert.deepEqual(trashed(), ['Central Knot Alpha.app']);
}));

test('Remove is never offered on its own for the build that syncs the home: it would leave a home whose owner is gone', () => aMac(async ({ stand, home, context }) => {
  const synced = homeOwnedByAlpha(home);
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  assert.deepEqual(await removeClick(synced, context, alpha, ALPHA_BUILD, false), { said: `${ALPHA} syncs this home, so it was not removed. Take over syncing first.`, done: false });
  assert.equal((await readRecord(synced.home)).record?.owner, ALPHA_BUILD);
  assert.ok(existsSync(alpha));
}));

test('Take over and remove come apart: a take-over refused removes nothing; a Trash that refuses after it leaves the take-over done, and says both', () => aMac(async ({ stand, home, context }) => {
  const synced = homeOwnedByAlpha(home);
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  writeFileSync(join(synced.home, '.central-knot/sync.json'), 'not a record');
  assert.deepEqual(await removeClick(synced, context, alpha, ALPHA_BUILD, true), { said: 'Syncing was not taken over, so nothing was removed. The sync record is damaged. Nothing was written or deleted. Put the record back, then try again.', done: false });
  assert.ok(existsSync(alpha));
  const again = homeOwnedByAlpha(join(home, 'again'));
  const refusing = { ...context, trash: async () => { throw new Error('denied'); } };
  const removal = await removeClick(again, refusing, alpha, ALPHA_BUILD, true);
  assert.ok(removal.said.startsWith(`Central Knot now syncs this home. macOS didn’t let Central Knot move ${ALPHA} to the Trash`), removal.said);
  assert.equal(removal.done, false);
  assert.equal((await readRecord(again.home)).record?.owner, STANDARD_BUILD, 'the take-over stays done');
  assert.ok(existsSync(alpha));
}));

test('Quit asks every copy of a build running from somewhere else, and says what came of it; nothing is removed', () => aMac(async ({ stand, home, context, runs }) => {
  assert.deepEqual(await quitBuild(context, ALPHA_BUILD), { said: `${ALPHA} isn’t running.`, done: true });
  const fromTrash = join(home, '.Trash/Central Knot Alpha.app');
  stand.bundle(join(home, '.Trash'), ALPHA, ALPHA_BUILD);
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: fromTrash, quits: true }]);
  assert.deepEqual(await quitBuild(context, ALPHA_BUILD), { said: `${ALPHA} has quit. It ran from the Trash. If ${ALPHA} still starts at sign-in, turn it off in System Settings › General › Login Items.`, done: true });
  await wait(50);
  assert.ok(!alive(app) && existsSync(fromTrash));
  const [stays] = await runs([{ bundleId: ALPHA_BUILD, path: join(home, 'Downloads/Central Knot Alpha.app'), quits: false }]);
  assert.deepEqual(await quitBuild(context, ALPHA_BUILD), { said: `${ALPHA} is still running: it may be asking about unsaved work. Quit it from its own window or menu.`, done: false });
  assert.ok(alive(stays));
  assert.equal((await quitBuild(context, STANDARD_BUILD)).done, false, 'this build is never asked to quit');
}));
