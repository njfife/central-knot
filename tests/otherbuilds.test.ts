// Another build of Central Knot on this Mac (otherbuilds.ts, one install at a time), worked from made-up bundles and stand-in
// running apps in a temp folder (tests/macstandins.ts): what counts as another build, where it runs, and every way Replace and
// Quit refuse or go ahead. What a held build writes (nothing): tests/held.test.ts.
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';
import { QUIT_WAIT_MS } from '../src/model.ts';
import { intoFolder, lookForBuilds, quitBuild, removeBuild, runsOutside, type BuildsContext } from '../src/otherbuilds.ts';
import { macPlaces } from '../src/platform.ts';
import type { OtherBuild } from '../src/types.ts';
import { ALPHA_BUILD } from '../src/updates.ts';
import { STANDARD_BUILD } from '../src/values.ts';
import { standInApp, standInMac } from './macstandins.ts';

const ALPHA = 'Central Knot Alpha', STANDARD = 'Central Knot', ACME = 'Acme Knot', ACME_BUILD = 'com.centralknot.custom.acme';
const trashWords = (name: string) => `${name} is in the Trash, where it stays until you empty the Trash. Your skills, MCP servers and agents, which of them are kept in step, and History stay: they’re saved in this home, not in an app. ${name}’s own settings folder stays too. If ${name} still starts at sign-in, turn it off in System Settings › General › Login Items.`;

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
  const support = join(base, 'Application Support');
  const context: BuildsContext = { own, places: macPlaces(home, { CK_TEST_APPS: stand.root }), trash: intoFolder(stand.trash), home, quitWaitMs: 1500, settingsFolder: build => join(support, build) };
  const apps: ChildProcess[] = [];
  /** A stand-in app running from `path` as the build `bundleId` (one that quits when asked, `afterMs` later, or not), listed as running. */
  const runs = async (copies: { bundleId: string; path: string; quits: boolean; afterMs?: number }[]) => {
    const started = await Promise.all(copies.map(copy => standInApp(copy.quits, copy.afterMs)));
    apps.push(...started);
    stand.running(copies.map((copy, index) => ({ bundleId: copy.bundleId, path: copy.path, pid: started[index].pid! })));
    return started;
  };
  const trashed = () => (existsSync(stand.trash) ? readdirSync(stand.trash) : []);
  /** The alpha installed in the stand-in /Applications, as the look finds it. */
  const alpha = (): OtherBuild & { installed: string } => ({ build: ALPHA_BUILD, name: ALPHA, installed: stand.bundle(stand.applications, ALPHA, ALPHA_BUILD) });
  return { stand, home, mine, downloads, support, context, apps, runs, trashed, alpha };
}
const alive = (app: ChildProcess) => app.exitCode === null && app.signalCode === null;

// ---------- The look ----------

test('Another build is a bundle at the top of an Applications folder whose Info.plist names a Central Knot id other than this one, by the name it gives', () => aMac(async ({ stand, mine, downloads, context }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const alsoMine = stand.bundle(mine, ALPHA, ALPHA_BUILD);
  const acme = stand.bundle(stand.applications, ACME, ACME_BUILD);
  stand.bundle(stand.applications, 'Central Knot Copy', STANDARD_BUILD);
  stand.bundle(stand.applications, 'Central Knot Helper', 'com.example.helper');
  stand.bundle(join(stand.applications, 'Older'), ALPHA, ALPHA_BUILD);
  stand.bundle(downloads, ALPHA, ALPHA_BUILD);
  symlinkSync(alpha, join(stand.applications, 'Central Knot Link.app'));
  // Found: the alpha in each folder, the person's own first, and a custom build under its own name. Not: a second copy of this
  // build (its own id), an app of another id under the product's name, one a folder down (a stated limit), one in Downloads
  // (it isn't running) and a link to one.
  assert.deepEqual(await lookForBuilds(context), [
    { build: ALPHA_BUILD, name: ALPHA, installed: alsoMine, running: [] },
    { build: ALPHA_BUILD, name: ALPHA, installed: alpha, running: [] },
    { build: ACME_BUILD, name: ACME, installed: acme, running: [] },
  ]);
}));

test('It is the same from every side: the alpha finds the standard app, and a custom build finds both', () => aMac(async ({ stand, context }) => {
  const standard = stand.bundle(stand.applications, STANDARD, STANDARD_BUILD);
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  assert.deepEqual(await lookForBuilds(context), [{ build: STANDARD_BUILD, name: STANDARD, installed: standard, running: [] }]);
  assert.deepEqual((await lookForBuilds({ ...context, own: ACME_BUILD }))?.map(found => found.installed), [alpha, standard]);
}, ALPHA_BUILD));

test('A running build is found by its bundle id wherever it runs from; one with no bundle in an Applications folder is found running, for Quit', () => aMac(async ({ stand, downloads, context, runs }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  const translocated = join(downloads, 'AppTranslocation/d/Central Knot Alpha.app');
  await runs([{ bundleId: ALPHA_BUILD, path: alpha, quits: true }, { bundleId: ALPHA_BUILD, path: translocated, quits: true }]);
  assert.deepEqual(await lookForBuilds(context), [{ build: ALPHA_BUILD, name: ALPHA, installed: alpha, running: [alpha, translocated] }]);
  // Removed from the folder and started again from the Trash (at the next sign-in, say): found running, from there, by the name its bundle gives.
  rmSync(alpha, { recursive: true });
  const fromTrash = stand.bundle(join(context.home, '.Trash'), ALPHA, ALPHA_BUILD);
  await runs([{ bundleId: ALPHA_BUILD, path: fromTrash, quits: true }]);
  assert.deepEqual(await lookForBuilds(context), [{ build: ALPHA_BUILD, name: ALPHA, running: [fromTrash] }]);
}));

test('A name with “&” reads as written, and the look says whether each build’s settings folder is there (what can be kept when the home’s record passes from it)', () => aMac(async ({ stand, support, context }) => {
  const smith = stand.bundle(stand.applications, 'Smith & Co Knot', 'com.centralknot.custom.smith');
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  mkdirSync(join(support, ALPHA_BUILD), { recursive: true });
  assert.deepEqual(await lookForBuilds(context), [
    { build: ALPHA_BUILD, name: ALPHA, installed: alpha, running: [], settingsFound: true },
    { build: 'com.centralknot.custom.smith', name: 'Smith & Co Knot', installed: smith, running: [] },
  ]);
}));

test('A custom build running from elsewhere is found only where the open home’s record names it, the one other id looked for running, and says the record names it', () => aMac(async ({ stand, downloads, context, runs }) => {
  const acme = stand.bundle(downloads, ACME, ACME_BUILD);
  await runs([{ bundleId: ACME_BUILD, path: acme, quits: true }]);
  assert.deepEqual(await lookForBuilds(context), []);
  assert.deepEqual(await lookForBuilds(context, ACME_BUILD), [{ build: ACME_BUILD, name: ACME, running: [acme], ownsRecord: true }]);
  assert.deepEqual(await lookForBuilds(context, STANDARD_BUILD), [], 'this build’s own id, named by the record, is not another build');
}));

test('Where whether a build runs can’t be told, the look leaves `running` unset; where an Applications folder can’t be read there is no answer', { skip: process.getuid?.() === 0 }, () => aMac(async ({ stand, mine, context }) => {
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  rmSync(mine, { recursive: true });
  const blind = { ...context, places: { ...context.places, lsappinfo: join(stand.root, 'no-such-program') } };
  assert.deepEqual(await lookForBuilds(blind), [{ build: ALPHA_BUILD, name: ALPHA, installed: alpha }], 'a missing ~/Applications is no matter');
  chmodSync(stand.applications, 0o000);
  try { assert.equal(await lookForBuilds(context), undefined); } finally { chmodSync(stand.applications, 0o755); }
}));

// ---------- Replace ----------

test('Replace refuses, in plain words and changing nothing, anything but another build’s bundle at the top of an Applications folder', () => aMac(async ({ stand, mine, downloads, context, trashed }) => {
  const own = stand.bundle(stand.applications, STANDARD, STANDARD_BUILD);
  const self = { ...context, ownBundle: own };
  const inDownloads = stand.bundle(downloads, ALPHA, ALPHA_BUILD);
  const helper = stand.bundle(stand.applications, 'Central Knot Helper', 'com.example.helper');
  const replaced = stand.bundle(mine, ALPHA, ALPHA_BUILD);
  writeFileSync(join(replaced, 'Contents/Info.plist'), readFileSync(join(helper, 'Contents/Info.plist')));
  const alpha = stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  symlinkSync(alpha, join(stand.applications, 'Central Knot Link.app'));
  const as = (installed: string, build = ALPHA_BUILD): OtherBuild => ({ build, name: ALPHA, installed });
  const cases: [string, OtherBuild, string][] = [
    ['in Downloads', as(inDownloads), `~/Downloads/Central Knot Alpha.app isn’t another build of Central Knot in an Applications folder, so nothing was removed.`],
    ['this app itself', as(own), `${own} is this app itself, so nothing was removed.`],
    ['this build’s id', as(alpha, STANDARD_BUILD), `${alpha} isn’t another build of Central Knot in an Applications folder, so nothing was removed.`],
    ['an id that is no build', as(helper, 'com.example.helper'), `${helper} isn’t another build of Central Knot in an Applications folder, so nothing was removed.`],
    ['an app under the product’s name with another id', as(helper), `${helper} isn’t ${ALPHA}, so nothing was removed. It may have been replaced since Central Knot looked.`],
    ['replaced since the look', as(replaced), `~/Applications/Central Knot Alpha.app isn’t ${ALPHA}, so nothing was removed. It may have been replaced since Central Knot looked.`],
    ['a link to one', as(join(stand.applications, 'Central Knot Link.app')), `${join(stand.applications, 'Central Knot Link.app')} isn’t ${ALPHA}, so nothing was removed. It may have been replaced since Central Knot looked.`],
    ['gone since the look', as(join(stand.applications, 'Central Knot Gone.app')), `${join(stand.applications, 'Central Knot Gone.app')} isn’t there any more, so nothing was removed.`],
    ['found only running', { build: ALPHA_BUILD, name: ALPHA, running: [inDownloads] }, `${ALPHA} isn’t in an Applications folder, so nothing was removed.`],
  ];
  for (const [what, found, said] of cases) assert.deepEqual(await removeBuild(self, found), { said, done: false }, what);
  assert.ok([inDownloads, helper, replaced, alpha, own].every(path => existsSync(join(path, 'Contents/Info.plist'))), 'every bundle is where it was');
  assert.deepEqual(trashed(), []);
}));

test('Replace only from a copy at the top of an Applications folder: from a disk image or the Trash nothing is quit or removed', () => aMac(async ({ stand, home, context, runs, trashed, alpha }) => {
  const found = alpha();
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: true }]);
  const installedHere = { ...context, ownBundle: join(stand.applications, `${STANDARD}.app`) };
  assert.equal(runsOutside(installedHere), undefined);
  assert.equal(runsOutside(context), undefined, 'a run from the source counts as installed');
  // Where it runs from isn't said: one opened from Downloads runs from a temporary system folder (App Translocation).
  for (const ownBundle of ['/Volumes/Central Knot/Central Knot.app', join(home, '.Trash/Central Knot.app'), '/private/var/folders/x/T/AppTranslocation/1/d/Central Knot.app']) {
    const outside = { ...context, ownBundle };
    assert.equal(runsOutside(outside), ownBundle);
    assert.deepEqual(await removeBuild(outside, found), { said: 'This copy isn’t running from an Applications folder, so nothing was removed. Move it to Applications and open it again from there.', done: false });
  }
  assert.ok(alive(app) && existsSync(found.installed));
  assert.deepEqual(trashed(), []);
}));

test('Replace asks a running build to quit, waits for it, then moves its bundle to the Trash; the next look finds nothing', () => aMac(async ({ stand, context, runs, trashed, alpha }) => {
  const found = alpha();
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: true }]);
  assert.deepEqual(await removeBuild(context, found), { said: trashWords(ALPHA), done: true });
  await wait(50);
  assert.equal(app.signalCode ?? app.exitCode, 0, 'it quit when asked');
  assert.ok(!existsSync(found.installed));
  assert.deepEqual(trashed(), ['Central Knot Alpha.app']);
  assert.deepEqual(await lookForBuilds(context), []);
  stand.bundle(stand.applications, ALPHA, ALPHA_BUILD);
  assert.equal((await lookForBuilds(context))?.length, 1, 'the app put back from the Trash is found again');
}));

test('A custom build is replaced like any other, under its own name', () => aMac(async ({ stand, context, trashed }) => {
  stand.bundle(stand.applications, ACME, ACME_BUILD);
  const [acme] = (await lookForBuilds(context)) ?? [];
  assert.deepEqual(await removeBuild(context, acme), { said: trashWords(ACME), done: true });
  assert.deepEqual(trashed(), ['Acme Knot.app']);
}));

test('A build that finishes something before it quits (a plugin step) is waited for, then replaced; Replace waits longer than a build holds its quit (main.ts before-quit, 15 s)', () => aMac(async ({ context, runs, trashed, alpha }) => {
  assert.ok(QUIT_WAIT_MS > 15_000, String(QUIT_WAIT_MS));
  const found = alpha();
  await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: true, afterMs: 800 }]);
  assert.deepEqual(await removeBuild(context, found), { said: trashWords(ALPHA), done: true });
  assert.deepEqual(trashed(), ['Central Knot Alpha.app']);
}));

test('A build still running after the wait is not removed, and the words say how long it was given', () => aMac(async ({ context, runs, trashed, alpha }) => {
  const found = alpha();
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: false }]);
  assert.deepEqual(await removeBuild(context, found), { said: `${ALPHA} didn’t quit within 2 seconds, so nothing was removed. Quit it yourself, then try again.`, done: false });
  assert.ok(alive(app) && existsSync(found.installed));
  assert.deepEqual(trashed(), []);
}));

test('Every running copy is asked to quit, wherever it runs from, and nothing is removed while any runs', () => aMac(async ({ downloads, context, runs, alpha }) => {
  const found = alpha();
  const [installed, copy] = await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: false }, { bundleId: ALPHA_BUILD, path: join(downloads, 'Central Knot Alpha.app'), quits: true }]);
  assert.equal((await removeBuild(context, found)).done, false);
  assert.ok(!alive(copy), 'the copy in Downloads was asked too, and quit');
  assert.ok(alive(installed) && existsSync(found.installed), 'the installed copy still runs, so the bundle stays');
}));

test('Where the Trash refuses, nothing else is tried: the bundle stays, and the words say so with the bundle to show in Finder', () => aMac(async ({ stand, context, runs, alpha }) => {
  const found = alpha();
  const refusing = { ...context, trash: async () => { throw new Error('The operation couldn’t be completed.'); } };
  const rest = `so it is still in ${stand.applications}. Nothing else was tried: move it to the Trash in Finder (or ask whoever manages this Mac), then click Refresh.`;
  assert.deepEqual(await removeBuild(refusing, found), { said: `macOS didn’t let Central Knot move ${ALPHA} to the Trash, ${rest}`, done: false, show: found.installed });
  await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: true }]);
  assert.equal((await removeBuild(refusing, found)).said, `${ALPHA} has quit, but macOS didn’t let Central Knot move it to the Trash, ${rest}`);
  assert.ok(existsSync(found.installed));
}));

test('Where whether it runs can’t be told, nothing is removed', () => aMac(async ({ stand, context, alpha }) => {
  const found = alpha();
  const blind = { ...context, places: { ...context.places, lsappinfo: join(stand.root, 'no-such-program') } };
  assert.deepEqual(await removeBuild(blind, found), { said: `Central Knot couldn’t tell whether ${ALPHA} is running, so nothing was removed. Quit ${ALPHA}, then try again.`, done: false });
  assert.ok(existsSync(found.installed));
}));

test('The bundle is checked again as the last thing before the Trash: one swapped in while the other app was quitting is not removed', () => aMac(async ({ stand, context, runs, trashed, alpha }) => {
  const found = alpha();
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: false }]);
  const removing = removeBuild(context, found);
  // While Replace waits for it to quit, the bundle is replaced by another app's, and then the alpha quits.
  await wait(400);
  rmSync(found.installed, { recursive: true });
  stand.bundle(stand.applications, ALPHA, 'com.example.unrelated');
  app.kill('SIGKILL');
  const removal = await removing;
  assert.equal(removal.done, false, removal.said);
  assert.ok(existsSync(join(found.installed, 'Contents/Info.plist')), 'the swapped-in app is where it was');
  assert.deepEqual(trashed(), []);
}));

test('A copy listed as running that can’t be asked about means whether it runs isn’t known: nothing is quit or removed', () => aMac(async ({ stand, context, runs, alpha }) => {
  const found = alpha();
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: true }]);
  // macOS lists the copy, then can't say anything about it.
  const halting = join(stand.root, 'lsappinfo-halting');
  writeFileSync(halting, `#!${process.execPath}\nif (process.argv[2] === 'find') console.log('ASN:0x0-0x${app.pid!.toString(16)}-"stand-in":'); else process.exit(1);\n`, { mode: 0o755 });
  const halted = { ...context, places: { ...context.places, lsappinfo: halting } };
  assert.deepEqual(await removeBuild(halted, found), { said: `Central Knot couldn’t tell whether ${ALPHA} is running, so nothing was removed. Quit ${ALPHA}, then try again.`, done: false });
  assert.deepEqual(await lookForBuilds(halted), [{ build: ALPHA_BUILD, name: ALPHA, installed: found.installed }], 'the look says nothing of it running');
  assert.ok(alive(app) && existsSync(found.installed));
}));

test('A list of running apps that says something Central Knot can’t read means whether it runs isn’t known: nothing is quit or removed', () => aMac(async ({ stand, context, runs, alpha }) => {
  const found = alpha();
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: found.installed, quits: true }]);
  // macOS answers with a line in a form this code doesn't know: not "nothing is running".
  const odd = join(stand.root, 'lsappinfo-odd');
  writeFileSync(odd, `#!${process.execPath}\nif (process.argv[2] === 'find') console.log('"Central Knot Alpha" (a form not known here)'); else process.exit(1);\n`, { mode: 0o755 });
  const unclear = { ...context, places: { ...context.places, lsappinfo: odd } };
  assert.deepEqual(await removeBuild(unclear, found), { said: `Central Knot couldn’t tell whether ${ALPHA} is running, so nothing was removed. Quit ${ALPHA}, then try again.`, done: false });
  assert.ok(alive(app) && existsSync(found.installed));
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

// ---------- Quit ----------

test('Quit asks every copy of a build running from somewhere else, and says what came of it; nothing is removed', () => aMac(async ({ stand, home, context, runs }) => {
  const asFound: OtherBuild = { build: ALPHA_BUILD, name: ALPHA, running: [] };
  assert.deepEqual(await quitBuild(context, asFound), { said: `${ALPHA} isn’t running.`, done: true });
  const fromTrash = stand.bundle(join(home, '.Trash'), ALPHA, ALPHA_BUILD);
  const [app] = await runs([{ bundleId: ALPHA_BUILD, path: fromTrash, quits: true }]);
  assert.deepEqual(await quitBuild(context, asFound), { said: `${ALPHA} has quit. It ran from the Trash. If ${ALPHA} still starts at sign-in, turn it off in System Settings › General › Login Items.`, done: true });
  await wait(50);
  assert.ok(!alive(app) && existsSync(fromTrash));
  const [stays] = await runs([{ bundleId: ALPHA_BUILD, path: join(home, 'Downloads/Central Knot Alpha.app'), quits: false }]);
  assert.deepEqual(await quitBuild(context, asFound), { said: `${ALPHA} didn’t quit within 2 seconds. Quit it from its own window or menu.`, done: false });
  assert.ok(alive(stays));
  assert.equal((await quitBuild(context, { build: STANDARD_BUILD, name: STANDARD })).done, false, 'this build is never asked to quit');
}));
