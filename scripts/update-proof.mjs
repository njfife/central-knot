// Proves the real update on a Mac with real signed builds, in throwaway folders: no release is published and the real home and
// app data are never used. Squirrel restarts the updated app through macOS with no arguments, so each test build carries its
// throwaway HOME, data folder, debug port and releases fixture in its Info.plist (CK_TEST_ENVIRONMENT, scripts/package-mac.mjs).
//
//   node scripts/update-proof.mjs --env                  prints CK_TEST_ENVIRONMENT for packaging the test builds
//   node scripts/update-proof.mjs <older.zip> <older tag> <newer.zip> <newer tag> <ad hoc.zip> <ad hoc tag>
//
// Older and newer: Developer ID signed (CK_NOTARIZE=0 is enough), made with CK_RELEASE_TAG set to their tags. The ad hoc one
// (CK_SIGN=0) has the newest tag. All three of one release line, so one app: three previews (Central Knot) or three alphas
// (v0.6.0-alpha.98…; Central Knot Alpha), the app's name read from the older zip. The older one is installed in
// <root>/home/Applications, standing in for /Applications. Then:
// an interrupted download and the ad hoc zip are both refused with the installed app unchanged; the newer one installs with one
// click, the app restarts by itself into it, and its settings and data folder are still there.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connect } from './cdp.mjs';
import { serveReleases } from './update-fixture.mjs';
import { macDownload } from '../src/updates.ts';

const root = process.env.CK_PROOF_ROOT || '/private/tmp/ck-update-proof';
const FIXTURE_PORT = 9471, DEBUG_PORT = 9472;
const environment = { CK_TEST_HOME: join(root, 'home'), CK_TEST_USER_DATA: join(root, 'data'), CK_TEST_DEBUG_PORT: String(DEBUG_PORT), CK_UPDATE_RELEASES: `http://127.0.0.1:${FIXTURE_PORT}/releases` };
if (process.argv[2] === '--env') { console.log(JSON.stringify(environment)); process.exit(0); }
const [olderZip, olderTag, newerZip, newerTag, adhocZip, adhocTag] = process.argv.slice(2);
if (!adhocTag) throw new Error('Usage: node scripts/update-proof.mjs <older.zip> <older tag> <newer.zip> <newer tag> <ad hoc.zip> <ad hoc tag>');

const home = environment.CK_TEST_HOME;
/** The app the zips hold, by its name: "Central Knot", or "Central Knot Alpha" for an alpha's. */
const appName = execFileSync('/usr/bin/zipinfo', ['-1', olderZip], { encoding: 'utf8' }).split('\n')[0].replace(/\.app\/.*$/, '');
const app = join(home, `Applications/${appName}.app`);
const exe = join(app, `Contents/MacOS/${appName}`);
/** The zip's name in the releases list: the one this app's updater looks for (an alpha's is Central-Knot-Alpha-…). */
const asset = macDownload(appName, '0.5.0', 'zip');
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'pass' : 'FAIL'} ${name}${ok || detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`); if (!ok) failures++; };

/** Every file in the bundle with its bytes' hash: unchanged means not one byte of the installed app moved. */
function tree(directory) {
  const out = {};
  const visit = current => { for (const name of readdirSync(current).sort()) {
    const path = join(current, name), info = lstatSync(path), key = relative(directory, path);
    if (info.isSymbolicLink()) out[key] = `link:${readlinkSync(path)}`;
    else if (info.isDirectory()) visit(path);
    else out[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
  } };
  visit(directory);
  return createHash('sha256').update(JSON.stringify(out)).digest('hex');
}
const running = () => { try { return execFileSync('/usr/bin/pgrep', ['-f', exe], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number); } catch { return []; } };
const stopAll = async () => { for (const pid of running()) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } } for (let i = 0; i < 50 && running().length; i++) await wait(200); for (const pid of running()) process.kill(pid, 'SIGKILL'); };

/** Attaches to whichever copy holds the debug port (the one this script started, or the one macOS restarted). */
async function attach(timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const [target] = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).filter(entry => entry.type === 'page');
      if (target) {
        const page = await connect(target.webSocketDebuggerUrl);
        await page.run(`new Promise(done => { const c = () => document.body.dataset.ready === 'true' ? done() : setTimeout(c, 50); c(); })`);
        return page;
      }
    } catch { /* not up yet */ }
    await wait(250);
  }
  throw new Error('No app answered on the debug port.');
}
const launch = () => { const child = spawn(exe, [], { env: { ...environment, HOME: home, PATH: '/usr/bin:/bin' }, stdio: 'ignore', detached: true }); child.unref(); return attach(); };
const until = async (page, expression, timeout = 600_000) => page.run(`new Promise((done, fail) => { const end = Date.now() + ${timeout}; const c = () => { const v = (${expression}); v ? done(v) : Date.now() > end ? fail(new Error('timed out: ' + ${JSON.stringify(expression)})) : setTimeout(c, 100); }; c(); })`);
const updatesOf = page => page.run('window.centralKnot.updates()');

await stopAll();
rmSync(root, { recursive: true, force: true });
mkdirSync(join(home, 'Applications'), { recursive: true });
mkdirSync(environment.CK_TEST_USER_DATA, { recursive: true });
execFileSync('/usr/bin/ditto', ['-x', '-k', olderZip, join(home, 'Applications')]);
const installed = tree(app);
/** The Developer ID team a bundle is signed by, as codesign says it ("not set" when ad hoc). */
const codesignTeam = bundle => /TeamIdentifier=(.*)/.exec(spawnSync('/usr/bin/codesign', ['-dv', bundle], { encoding: 'utf8' }).stderr)?.[1];
const team = zip => { const at = join(root, 'look'); execFileSync('/usr/bin/ditto', ['-x', '-k', zip, at]); try { return codesignTeam(join(at, `${appName}.app`)); } finally { rmSync(at, { recursive: true, force: true }); } };
const installedTeam = codesignTeam(app);
console.log(`${appName}: installed ${olderTag} (team ${installedTeam ?? '?'}); newer ${newerTag}; ad hoc ${adhocTag} (team ${team(adhocZip) ?? 'none'})`);

const releases = [];
// The fixture answers on the port the test builds were packaged with.
const served = await serveReleases(releases, FIXTURE_PORT);
const failedText = page => page.run(`new Promise(done => { const c = async () => { const v = await window.centralKnot.updates(); v.failed ? done(v.failed) : setTimeout(c, 200); }; c(); })`);
const words = tag => tag.replace(/^v/, '').replace('-', ' ').replace(/(?<= .*)\./g, ' ');

try {
  // 1. An interrupted download: refused, nothing installed.
  releases.splice(0, releases.length, { tag: newerTag, zip: newerZip, cut: 0.4, asset });
  let page = await launch();
  check('the installed app reports its own tag', (await updatesOf(page)).tag === olderTag, await updatesOf(page));
  await page.run(`window.centralKnot.checkForUpdates()`);
  await until(page, `document.querySelector('#update-control[data-look="available"]')`, 30_000);
  const offered = await page.run(`document.querySelector('#update-control').getAttribute('aria-label')`);
  check('the sidebar’s update control offers the newer release', offered === `Update to ${words(newerTag)}`, offered);
  await page.run(`document.querySelector('#update-control').click()`);
  const cut = await failedText(page);
  check('an interrupted download is refused and says so', /download didn’t finish.*wasn’t changed/.test(cut), cut);
  page.close(); await stopAll();
  check('after the interrupted download the installed app is unchanged', tree(app) === installed);

  // 1b. A download that goes quiet with the connection left open: the app ends it itself after a minute, and offers it again.
  releases.splice(0, releases.length, { tag: newerTag, zip: newerZip, stall: 0.3, asset });
  page = await launch();
  await page.run(`window.centralKnot.checkForUpdates()`);
  await until(page, `document.querySelector('#update-control[data-look="available"]')`, 30_000);
  await page.run(`document.querySelector('#update-control').click()`);
  const began = Date.now();
  const quiet = await failedText(page);
  check('a download that goes quiet is ended and says so', /download didn’t finish.*wasn’t changed/.test(quiet) && Date.now() - began > 55_000, [quiet, Date.now() - began]);
  check('and the control offers the update again', await page.run(`(b => !b.disabled && b.getAttribute('aria-label'))(document.querySelector('#update-control'))`) === `Try the update to ${words(newerTag)} again`);
  page.close(); await stopAll();
  check('after the quiet download the installed app is unchanged', tree(app) === installed);

  // 2. A newer zip signed by another identity (ad hoc): Squirrel refuses it.
  releases.splice(0, releases.length, { tag: adhocTag, zip: adhocZip, asset });
  page = await launch();
  await page.run(`window.centralKnot.checkForUpdates()`);
  await until(page, `document.querySelector('#update-control[data-look="available"]')`, 30_000);
  await page.run(`document.querySelector('#update-control').click()`);
  const foreign = await failedText(page);
  check('a zip signed by another identity is refused and says so', /isn’t signed by Central Knot’s developer.*wasn’t changed/.test(foreign), foreign);
  page.close(); await stopAll();
  check('after the refused zip the installed app is unchanged', tree(app) === installed);

  // 3. The real update: the newer release shows by itself, with no check asked for; one click downloads it and the app restarts
  // by itself into the newer build; settings and data stay.
  releases.splice(0, releases.length, { tag: newerTag, zip: newerZip, bytesPerSecond: 40_000_000, asset });
  const opened = Date.now();
  page = await launch();
  await page.run(`window.centralKnot.setAppearance('dark')`);
  writeFileSync(join(environment.CK_TEST_USER_DATA, 'marker.txt'), 'kept');
  const settingsBefore = JSON.parse(readFileSync(join(environment.CK_TEST_USER_DATA, 'app-settings.json'), 'utf8'));
  const oldPids = running();
  await until(page, `document.querySelector('#update-control[data-look="available"]')`, 60_000);
  check(`the sidebar offers the newer release by itself, ${Math.round((Date.now() - opened) / 1000)} s after launch`, await page.run(`document.querySelector('#update-control').getAttribute('aria-label')`) === `Update to ${words(newerTag)}`);
  await page.run(`window.ckLabels = []; new MutationObserver(() => { const b = document.querySelector('#update-control'); if (b && window.ckLabels.at(-1) !== b.textContent.trim()) window.ckLabels.push(b.textContent.trim()); }).observe(document.getElementById('sidebar-end'), { subtree: true, childList: true, characterData: true }); document.querySelector('#update-control').click(); true`);
  // Read until the old copy quits for the update (its page then stops answering).
  let labels = [];
  for (let i = 0; i < 3000 && oldPids.some(pid => running().includes(pid)); i++) {
    labels = await Promise.race([page.run('window.ckLabels'), wait(1000).then(() => labels)]).catch(() => labels);
    await wait(100);
  }
  console.log(`the control said: ${labels.join(' → ')}`);
  check('the control showed download progress', labels.some(label => /^Downloading… \d+%$/.test(label)) && labels.includes('Preparing update…'), labels);
  page.close();
  for (let i = 0; i < 300 && oldPids.some(pid => running().includes(pid)); i++) await wait(200);
  check('the old copy quit for the update', !oldPids.some(pid => running().includes(pid)));
  page = await attach(120_000);
  const after = await updatesOf(page);
  check('macOS restarted the app by itself, and it is the newer build', after.tag === newerTag && !oldPids.includes(running()[0]), { tag: after.tag, pids: running() });
  check('the restarted copy uses the throwaway home, not the real one', (await page.run(`document.querySelector('.status-home').title`)) === home, await page.run(`document.querySelector('.status-home').title`));
  check('it says once that it is on the new version, with the release notes', /is now on/.test(await page.run(`document.getElementById('announcement').textContent`)) && await page.run(`!document.getElementById('said-link').hidden`), await page.run(`document.getElementById('announcement').textContent`));
  check('the restarted copy is signed by the same team', !!installedTeam && codesignTeam(app) === installedTeam, codesignTeam(app));
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const settingsAfter = JSON.parse(readFileSync(join(environment.CK_TEST_USER_DATA, 'app-settings.json'), 'utf8'));
  check('settings survive the update', settingsAfter.appearance === 'dark' && settingsAfter.appearance === settingsBefore.appearance && !settingsAfter.update, settingsAfter);
  check('the data folder survives the update', readFileSync(join(environment.CK_TEST_USER_DATA, 'marker.txt'), 'utf8') === 'kept');
  check('the installed app changed', tree(app) !== installed);
  page.close();
} finally {
  await stopAll();
  await served.close();
}
console.log(failures ? `update proof: ${failures} failed` : 'update proof: all passed');
process.exit(failures ? 1 : 0);
