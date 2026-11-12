// Checks the alpha (src/updates.ts lineApp) as packaged, beside the standard app the Mac run packaged just before it. The
// documented command packages it from an alpha tag. It must be its own app: its name on the bundle, the window and the disk
// image, its own bundle id, downloads and settings folder, and release/ must then hold its two downloads and no other. Opened
// side by side with the standard app on one throwaway home, it must be offered only a newer alpha while the standard app is
// offered only a newer preview, and the two must name each other through Take over syncing, both ways. Nothing is
// published. Both apps run in the throwaway home: HOME, and CFFIXED_USER_HOME so that their settings folders are inside it too.
// Usage (a Mac, after `npm run package:mac`): node scripts/alpha-check.mjs
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connect, debugPorts } from './cdp.mjs';
import { serveReleases } from './update-fixture.mjs';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { applyChanges } from '../src/manage.ts';
import { readRecord } from '../src/share.ts';
import { ALPHA_BUILD, lineApp, macDownload } from '../src/updates.ts';
import { STANDARD_BUILD } from '../src/values.ts';

if (process.platform !== 'darwin') throw new Error('The alpha check packages and opens Mac apps: run it on a Mac.');
process.chdir(resolve(import.meta.dirname, '..'));
const TAG = 'v0.6.0-alpha.98';
const ALPHA = lineApp('alpha').name, STANDARD = lineApp('preview').name;
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const failures = [];
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures.push(name);
  console.error(`FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ck-alpha-')));
const HOME = join(scratch, 'home');
const appData = join(HOME, 'Library/Application Support');
const launched = new Set();
process.on('exit', () => {
  for (const child of launched) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  rmSync(scratch, { recursive: true, force: true });
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

// ---------- The package ----------
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const standardApp = join('release', `${STANDARD}-darwin-arm64`, `${STANDARD}.app`);
const standardDownloads = ['zip', 'dmg'].map(kind => macDownload(STANDARD, version, kind));
if (!existsSync(standardApp) || !standardDownloads.every(file => existsSync(join('release', file)))) throw new Error('Package the standard app first (npm run package:mac).');
// A mistyped alpha tag is refused in plain words before anything is built, never packaged as the standard app.
const mistyped = spawnSync(process.execPath, ['scripts/package-mac.mjs'], { encoding: 'utf8', env: { ...process.env, CK_RELEASE_TAG: 'v0.6.0-alpha1', CK_SIGN: '0' } });
check('a mistyped alpha tag stops packaging, saying so', mistyped.status === 2 && mistyped.stderr.trim() === 'v0.6.0-alpha1 names no release line. A pre-release is tagged v<version>-alpha.<n> (an alpha) or v<version>-preview.<n> (a preview), as v0.6.0-alpha.1 or v0.6.0-preview.1.', [mistyped.status, mistyped.stderr]);
check('and leaves the standard downloads where they were', standardDownloads.every(file => existsSync(join('release', file))));
const began = Date.now();
const said = execFileSync(process.execPath, ['scripts/package-mac.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CK_RELEASE_TAG: TAG, CK_SIGN: '0' } });
process.stdout.write(said);
console.log(`The alpha was packaged in ${Math.round((Date.now() - began) / 1000)} s.`);

const bundle = join('release', `${ALPHA}-darwin-arm64`, `${ALPHA}.app`);
const plist = key => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const identity = ['CFBundleName', 'CFBundleDisplayName', 'CFBundleExecutable', 'CFBundleIdentifier'].map(plist);
check('the bundle is the alpha’s own app: its name, and its own bundle id', identity.join('|') === 'Central Knot Alpha|Central Knot Alpha|Central Knot Alpha|com.centralknot.alpha', identity);
// Inside the package: the code calls the app by the alpha's name everywhere (the menu bar icon's menu among it), and the tag is recorded.
const packed = file => extractFile(join(bundle, 'Contents/Resources/app.asar'), file).toString('utf8');
const main = packed('dist/main.cjs');
check('the menu bar icon’s menu names the alpha', main.includes('Open Central Knot Alpha') && main.includes('Quit Central Knot Alpha'));
check('no plain “Central Knot” is left in its code', ![main, packed('dist/renderer.js'), packed('dist/index.html')].some(code => /Central Knot(?! Alpha)/.test(code)));
check('the release tag is recorded in it', JSON.parse(packed('dist/build-info.json')).tag === TAG);
const zip = join('release', `Central-Knot-Alpha-${version}-mac-arm64.zip`), dmg = join('release', `Central-Knot-Alpha-${version}-mac-arm64.dmg`);
check('its downloads are named for it', existsSync(zip) && existsSync(dmg), [zip, dmg]);
check('its zip holds the alpha app', execFileSync('/usr/bin/zipinfo', ['-1', zip], { encoding: 'utf8' }).split('\n')[0] === 'Central Knot Alpha.app/');
// What its release carries: release/ holds the alpha's two downloads and no other (the standard app's are removed, and named).
const left = readdirSync('release').filter(file => /-mac-arm64\.(?:zip|dmg)$/.test(file)).sort();
check('release/ then holds the alpha’s two downloads and no other', left.join() === `Central-Knot-Alpha-${version}-mac-arm64.dmg,Central-Knot-Alpha-${version}-mac-arm64.zip`, left);
const removedLine = said.split('\n').find(line => line.startsWith('Removed from release/, as not this package\'s: ')) ?? '';
check('and packaging names the standard downloads it removed, and what to upload', standardDownloads.every(file => removedLine.includes(file)) && said.includes(`Upload exactly these: ${dmg} ${zip}`), said.split('\n').filter(line => /Removed|Upload/.test(line)));
const mount = join(scratch, 'volume');
execFileSync('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount], { stdio: 'ignore' });
try {
  const volume = /<key>VolumeName<\/key>\s*<string>([^<]*)<\/string>/.exec(execFileSync('/usr/sbin/diskutil', ['info', '-plist', mount], { encoding: 'utf8' }))?.[1];
  check('the disk image’s volume is named for the alpha', volume === 'Central Knot Alpha', volume);
  check('it holds the alpha app beside the Applications shortcut', existsSync(join(mount, 'Central Knot Alpha.app')) && readlinkSync(join(mount, 'Applications')) === '/Applications');
  check('its window is the alpha’s own layout', hash(join(mount, '.DS_Store')) === hash('assets/dmg/Central-Knot-Alpha/DS_Store'));
} finally { execFileSync('/usr/bin/hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' }); }

// ---------- The two apps on one home ----------
// A skill in Claude Code's folder, and a stand-in for its CLI so the tool counts as installed.
mkdirSync(join(HOME, '.claude/skills/notes'), { recursive: true });
writeFileSync(join(HOME, '.claude/skills/notes/SKILL.md'), '---\nname: notes\ndescription: Takes notes.\n---\n\nTake notes.\n');
mkdirSync(join(HOME, '.local/bin'), { recursive: true });
writeFileSync(join(HOME, '.local/bin/claude'), '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.309 (Claude Code)" && exit 0\nexit 9\n');
chmodSync(join(HOME, '.local/bin/claude'), 0o755);
// The standard app manages the skill first, with its own code and its own settings file there: the home is its to sync.
const standardSettings = join(appData, 'central-knot', 'sharing-settings.json');
mkdirSync(join(appData, 'central-knot'), { recursive: true });
const standard = { home: HOME, mode: 'custom', read: () => Promise.all(harnessIds.map(harness => discover({ home: HOME, mode: 'custom', harness }))), build: STANDARD_BUILD, buildName: STANDARD, settingsPath: standardSettings, realHome: join(scratch, 'elsewhere') };
const managed = await applyChanges(standard, [{ key: 'notes', managed: true, off: [] }], false);
check('the standard app syncs the home first', !managed.stopped && (await readRecord(HOME)).record?.owner === STANDARD_BUILD, managed.stopped);

// Each app's releases hold a newer release of the other line, which it must pass over.
const alphaAsset = macDownload(ALPHA, version, 'zip');
// Each listed under its own app's zip name; only names and sizes are read (nothing is downloaded), so one file serves for all.
const forAlpha = await serveReleases([{ tag: 'v0.7.0-preview.1', zip }, { tag: 'v0.6.0-alpha.99', zip, asset: alphaAsset }, { tag: 'v0.6.0-alpha.97', zip, asset: alphaAsset }]);
const forStandard = await serveReleases([{ tag: 'v0.6.0-alpha.99', zip, asset: alphaAsset }, { tag: 'v0.5.0-preview.99', zip }]);

async function launch(name, env) {
  const exe = join('release', `${name}-darwin-arm64`, `${name}.app`, 'Contents/MacOS', name);
  mkdirSync(join(scratch, 'tmp'), { recursive: true });
  // No data folder is named: each app must choose its own.
  const child = spawn(exe, ['--remote-debugging-port=0'], { env: { HOME, CFFIXED_USER_HOME: HOME, PATH: '/usr/bin:/bin', TMPDIR: join(scratch, 'tmp'), ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  launched.add(child);
  const { port } = await debugPorts(child);
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { /* starting */ } if (!target) await wait(200); }
  if (!target) throw new Error(`${name} opened no window.`);
  const errors = [];
  const page = await connect(target.webSocketDebuggerUrl, data => { if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text); });
  await page.send('Runtime.enable');
  const ready = () => page.run(`new Promise((done, fail) => { const end = Date.now() + 30000; const c = () => document.body.dataset.ready === 'true' && document.body.dataset.busy !== 'true' ? done(true) : Date.now() > end ? fail(new Error('The page did not settle.')) : setTimeout(c, 50); c(); })`);
  await ready();
  const until = async (expression, ms = 20000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(150)) if (await page.run(expression)) return true; return false; };
  const text = selector => page.run(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? ''`);
  const click = async selector => { await page.run(`document.querySelector(${JSON.stringify(selector)}).click()`); await wait(200); await ready(); };
  const control = () => page.run(`(b => b && { look: b.dataset.look, name: b.getAttribute('aria-label') })(document.getElementById('update-control'))`);
  return { run: page.run, ready, until, text, click, control, errors };
}

// The standard app first, so the alpha finds it open.
const plain = await launch(STANDARD, { CK_UPDATE_STUB: 'v0.5.0-preview.98', CK_UPDATE_RELEASES: forStandard.releasesUrl });
const alpha = await launch(ALPHA, { CK_UPDATE_RELEASES: forAlpha.releasesUrl });
check('the two apps run side by side', await plain.run('document.body.dataset.ready') === 'true' && await alpha.run('document.body.dataset.ready') === 'true');
check('the window and the sidebar carry the alpha’s name', await alpha.run(`document.title + '|' + document.querySelector('.wordmark').textContent`) === 'Central Knot Alpha|Central Knot Alpha');
check('the status bar names the alpha and its version', await alpha.text('#status-end') === 'Central Knot Alpha 0.6.0 alpha 98', await alpha.text('#status-end'));
check('the alpha reports the tag it was packaged from', (await alpha.run('window.centralKnot.updates()')).tag === TAG);
check('the standard app keeps its own name', await plain.run(`document.title + '|' + document.querySelector('.wordmark').textContent`) === 'Central Knot|Central Knot');

// Updates stay inside a line. The alpha is signed ad hoc, so it shows a newer alpha without installing it.
for (const app of [alpha, plain]) await app.run('window.centralKnot.checkForUpdates()');
check('the alpha is offered the newer alpha, never the newer preview', await alpha.until(`document.getElementById('update-control')?.dataset.look === 'elsewhere'`) && (await alpha.control()).name === '0.6.0 alpha 99 is available. Open Settings', await alpha.control());
check('the standard app is offered the newer preview, never the newer alpha', await plain.until(`document.getElementById('update-control')?.dataset.look === 'available'`) && (await plain.control()).name === 'Update to 0.5.0 preview 99', await plain.control());

// Two apps, one home: each names the other as the person knows it, both ways.
const band = '#other-owner .band-text';
await alpha.click('#nav-skills');
check('the alpha names the standard app as the one that syncs the home', await alpha.until(`!!document.querySelector('${band}')`) && /^Central Knot (is open and syncs|synced this home last)/.test(await alpha.text(band)), await alpha.text(band));
check('and offers to take over in its own name', await alpha.run(`document.querySelector('#take-over-sync').title`) === 'Central Knot Alpha syncs this home from now on, from where Central Knot left it, and anything waiting is synced straight away. Central Knot stops syncing here until you take over from it again.', await alpha.run(`document.querySelector('#take-over-sync')?.title`));
await alpha.click('#take-over-sync');
check('taking over, the alpha says so and names the way back', await alpha.until(`!document.querySelector('#other-owner')`) && /^Central Knot Alpha now syncs this home( \(automatic sync is off here\))?\. To go back, take over in Central Knot\.$/.test(await alpha.text('#announcement')), await alpha.text('#announcement'));
const taken = (await readRecord(HOME)).record;
check('the record is under the alpha, by its name', taken?.owner === ALPHA_BUILD && taken?.ownerName === 'Central Knot Alpha', taken && { owner: taken.owner, ownerName: taken.ownerName });
check('the alpha keeps its settings in a folder of its own', existsSync(join(appData, ALPHA_BUILD, 'sharing-settings.json')) && readFileSync(join(appData, ALPHA_BUILD, 'sharing-settings.json'), 'utf8').includes(taken?.generation ?? '-'), appData);
// The standard app, open all along, reads the home again (its Refresh, as a person would).
await plain.click('#nav-skills');
await plain.click('#header-refresh');
check('the standard app then names the alpha', await plain.until(`!!document.querySelector('${band}')`) && /^Central Knot Alpha (is open and syncs|synced this home last)/.test(await plain.text(band)), await plain.text(band));
check('and offers to take it back in its own name', await plain.run(`document.querySelector('#take-over-sync').title`) === 'Central Knot syncs this home from now on, from where Central Knot Alpha left it, and anything waiting is synced straight away. Central Knot Alpha stops syncing here until you take over from it again.', await plain.run(`document.querySelector('#take-over-sync')?.title`));
await plain.click('#take-over-sync');
check('taking it back, the standard app names the alpha as the way back', await plain.until(`!document.querySelector('#other-owner')`) && /^Central Knot now syncs this home( \(automatic sync is off here\))?\. To go back, take over in Central Knot Alpha\.$/.test(await plain.text('#announcement')), await plain.text('#announcement'));
check('no page error in either app', alpha.errors.length === 0 && plain.errors.length === 0, [...alpha.errors, ...plain.errors]);

await forAlpha.close();
await forStandard.close();
console.log(`alpha check: ${passes} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
