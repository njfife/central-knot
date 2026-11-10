// Checks a bundled build end to end (ORG-01, ORG-03, ORG-07): the documented build command makes a custom build from a
// fixture marketplace, the marketplace's source is then deleted, and the build is opened in a throwaway home. It must open
// under its own name with its own settings folder, list the marketplace it carries with every packed plugin readable, name
// the plugin that couldn't be packed, and keep the same content at a second open.
// Usage: node scripts/bundled-check.mjs [--electron] [--no-sandbox] [--shots dir]
// - By default (a Mac) it packages the build with `scripts/package-mac.mjs` and opens the packaged app.
// - `--electron` stages the same build and opens it as a development run, on any system (under xvfb-run on Linux).
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connect, debugPorts } from './cdp.mjs';
import { stage } from './custom-build.mjs';
import { writeMarket } from './fixture-market.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const shots = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : undefined;
const dev = flag('--electron');
const root = resolve(import.meta.dirname, '..');
const ID = 'ck-bundled-check', NAME = 'Acme Knot';

const failures = [];
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures.push(name);
  console.error(`FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ck-bundled-')));
const HOME = join(scratch, 'home');
// Where the build keeps its settings: beside the standard app's, under its own identity. On a Mac that is the account's own
// Application Support folder whatever HOME says, so the build's folder there is removed before and after.
const appData = process.platform === 'darwin' ? join(userInfo().homedir, 'Library/Application Support') : join(HOME, '.config');
const dataDir = join(appData, ID);
rmSync(dataDir, { recursive: true, force: true });
const launched = new Set();
process.on('exit', () => {
  for (const child of launched) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

// ---------- The build ----------
// The fixture marketplace, with one more plugin that can't be packed: an npm package.
const market = join(scratch, 'market');
writeMarket(market);
const manifestPath = join(market, '.claude-plugin/marketplace.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.plugins.push({ name: 'npm-thing', source: { source: 'npm', package: '@example/npm-thing' }, description: 'Kept as an npm package.' });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const inputs = ['--marketplace', market, '--app-name', NAME, '--app-id', ID, '--app-icon', join(root, 'assets/icon.png'), '--marketplace-name', 'Acme plugins', '--marketplace-logo', join(root, 'assets/tray.svg')];
let command, launchArgs, report;
if (dev) {
  const staged = await stage({ marketplace: market, appName: NAME, appId: ID, appIcon: join(root, 'assets/icon.png'), marketplaceName: 'Acme plugins', marketplaceLogo: join(root, 'assets/tray.svg') }, join(scratch, 'staged'));
  report = staged.report;
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, CK_CUSTOM_BUILD: staged.out } });
  // dist/ goes back to the standard app when the check ends.
  process.on('exit', () => { try { execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'ignore', env: { ...process.env, CK_CUSTOM_BUILD: '' } }); } catch { /* the next build makes it again */ } });
  command = join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim());
  launchArgs = [root, '--as-released'];
} else {
  execFileSync(process.execPath, ['scripts/package-mac.mjs', ...inputs], { cwd: root, stdio: 'inherit', env: { ...process.env, CK_SIGN: '0' } });
  report = readFileSync(join(root, 'release/Acme-Knot-build-report.txt'), 'utf8');
  command = join(root, `release/${NAME}-darwin-arm64/${NAME}.app/Contents/MacOS/${NAME}`);
  launchArgs = [];
  check('the package is the build’s own app, with its own bundle id', execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(root, `release/${NAME}-darwin-arm64/${NAME}.app/Contents/Info.plist`)], { encoding: 'utf8' }).trim() === `com.centralknot.custom.${ID}`);
  check('the package’s download is a zip under the build’s name', readdirSync(join(root, 'release')).some(name => /^Acme-Knot-.*-mac-arm64\.zip$/.test(name)));
}
// What the app writes outside itself keeps the product's name, so this build and the standard app read each other's files.
const mainCode = dev ? readFileSync(join(root, 'dist/main.cjs'), 'utf8') : (await import('@electron/asar')).extractFile(join(root, `release/${NAME}-darwin-arm64/${NAME}.app/Contents/Resources/app.asar`), 'dist/main.cjs').toString();
check('the app’s own words carry the build’s name', mainCode.includes(`Quit ${NAME}`) && !mainCode.includes('Quit Central Knot'));
check('the markers written into instruction files keep the product’s name', mainCode.includes('base instructions: start') && !mainCode.includes(`${NAME} base instructions`) && !mainCode.includes(`${NAME}: update`));
check('report: identity', report.includes(`Identity: ${ID} (com.centralknot.custom.${ID})`), report);
check('report: the plugins kept in the marketplace are packed', ['document-tools 1.2.0', 'issue-tracker 2.0.0', 'release-helper 0.4.1', 'starter-skills'].every(name => /Plugins packed \(\d\): (.*)/.exec(report)?.[1].includes(name)), report);
check('report: the npm plugin is named as not packed', /NOT PACKED \(\d\)[\s\S]*- npm-thing: Its files are kept elsewhere \(npm: @example\/npm-thing\)/.test(report), report);
check('report: no update location and no feed are said', report.includes('App updates: not met.') && report.includes('Content feed: not met.'), report);
// Whether the plugin kept on GitHub was fetched depends on the network: either way it must be accounted for.
const sparkPacked = /Plugins packed \(\d\): .*spark/.test(report);
check('report: the plugin kept on GitHub is packed or named', sparkPacked || /- spark: /.test(report), report);

// The source is gone before the build is ever opened.
rmSync(market, { recursive: true, force: true });

// ---------- The app ----------
mkdirSync(join(HOME, '.local/bin'), { recursive: true });
for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.'], ['codex', 'codex-cli 0.142.3']]) {
  writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
  chmodSync(join(HOME, '.local/bin', name), 0o755);
}
async function launch() {
  const env = { HOME, PATH: '/usr/bin:/bin', TMPDIR: join(scratch, 'tmp') };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  // No data folder is named: the build must choose its own.
  const child = spawn(command, [...launchArgs, '--remote-debugging-port=0', ...(flag('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  launched.add(child);
  child.once('exit', () => launched.delete(child));
  const { port } = await debugPorts(child);
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { /* starting */ } if (!target) await wait(200); }
  if (!target) throw new Error('The app opened no window.');
  const errors = [];
  const page = await connect(target.webSocketDebuggerUrl, data => { if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text); });
  const { send, run } = page;
  await send('Runtime.enable');
  const settle = async () => { await wait(200); await run(`new Promise((done, fail) => { const end = Date.now() + 30000; const c = () => document.body.dataset.ready === 'true' && document.body.dataset.busy !== 'true' ? done(true) : Date.now() > end ? fail(new Error('The page did not settle.')) : setTimeout(c, 50); c(); })`); await wait(150); };
  const until = async (expression, ms = 15000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await run(expression)) return true; return false; };
  const size = async (width, height) => { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await run(`window.dispatchEvent(new Event('resize'))`); await settle(); };
  const click = async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); })()`); await settle(); };
  const shot = async name => { if (!shots) return; mkdirSync(shots, { recursive: true }); const reply = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, `${name}.png`), Buffer.from(reply.result.data, 'base64')); };
  /** Nothing on the page is wider than the window (the page itself never scrolls sideways). */
  const fits = () => run(`document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth`);
  await size(1280, 800);
  return { run, settle, until, size, click, shot, fits, errors, quit: () => { page.close(); child.kill('SIGKILL'); } };
}

const a = await launch();
check('the window and the sidebar carry the build’s name', await a.run(`document.title + '|' + document.querySelector('.wordmark').textContent`) === `${NAME}|${NAME}`);
check('the sidebar shows the build’s own mark', await a.run(`document.querySelector('.brand .logo').getAttribute('src')`) === 'logo.png');
const marketFolder = join(dataDir, 'bundled/marketplace');
check('its settings are in a folder of its own', existsSync(join(dataDir, 'bundled/release.json')) && existsSync(join(marketFolder, '.claude-plugin/marketplace.json')), dataDir);
if (process.platform !== 'darwin') check('the standard app’s settings folder was not made', !existsSync(join(appData, 'central-knot')));
check('the unpacked marketplace has no fetch folder', !existsSync(join(marketFolder, '.git')));

await a.click('#nav-plugins');
check('Plugins lists the carried marketplace', await a.until(`!!document.querySelector('.market-item')`));
await a.settle();
check('it is first, under the name the build gave it, marked Built in', await a.run(`document.querySelector('.market-item .market-item-name').textContent + '|' + document.querySelector('.market-item .market-item-meta').textContent`).then(text => /^Acme plugins\|Built in · 6 plugins/.test(text)));
check('it shows the picture the build gave it', await a.run(`(() => { const logo = document.querySelector('.market-item .market-logo'); return !!logo && logo.getAttribute('src') === 'bundle/marketplace-logo.svg' && logo.naturalWidth > 0; })()`));
check('the title says it comes with the app', await a.run(`document.querySelector('.market-title-line').textContent`).then(text => text.includes(`Comes with ${NAME}`)), await a.run(`document.querySelector('.market-title-line').textContent`));
const rows = await a.run(`[...document.querySelectorAll('.plugin-row')].map(row => row.dataset.plugin)`);
check('every listed plugin has a row', JSON.stringify(rows) === JSON.stringify(['document-tools', 'issue-tracker', 'npm-thing', 'release-helper', 'spark', 'starter-skills']), rows);
check('a packed plugin says what it holds, read with the source gone', await a.run(`document.querySelector('[data-plugin="document-tools"] .plugin-row-holds')?.textContent`) === '2 skills');
check('the plugin that couldn’t be packed can’t be chosen, and says why', await a.run(`(() => { const box = document.querySelector('[data-plugin="npm-thing"] .ov-cell button, [data-plugin="npm-thing"] .ov-cell [title]'); return (box?.getAttribute('title') ?? '') + '|' + (box?.getAttribute('aria-label') ?? ''); })()`).then(text => text.includes('This build doesn’t carry its files')), await a.run(`document.querySelector('[data-plugin="npm-thing"]').outerHTML.slice(0, 900)`));
check('nor are its parts offered in any tool', await a.run(`document.querySelectorAll('[data-plugin="npm-thing"] .cell-parts-offer').length`) === 0);
check('the Plugins page fits at 1280', await a.fits());
await a.shot('plugins-1280');

await a.run(`document.querySelector('[data-plugin="document-tools"] .plugin-row-open').click()`);
check('a plugin’s page opens with its skills', await a.until(`document.body.innerText.includes('pdf-reader') && document.body.innerText.includes('spreadsheet')`));
await a.settle();
await a.shot('plugin-1280');
await a.click('#plugin-back');
await a.click('#market-tab-about');
check('About: the release it carries, and no way to remove it', await a.run(`document.querySelector('.market-page-meta').textContent + '|' + !!document.querySelector('[id^="forget-"]')`).then(text => /Comes with Acme Knot\s*·\s*As of .+ \(Folder: market\)\|false$/.test(text)), await a.run(`document.querySelector('.market-page-meta').textContent`));
check('About names the plugin the build doesn’t carry', await a.run(`document.querySelector('.market-not-carried')?.textContent ?? ''`).then(text => text.includes('npm-thing') && text.includes('npm: @example/npm-thing')));
check('About shows the marketplace’s README', await a.until(`document.querySelector('.plugin-readme-body')?.textContent.includes('What is inside')`));
await a.shot('about-1280');
for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) {
  await a.size(width, height);
  check(`About fits at ${width}`, await a.fits());
  await a.click('#market-tab-plugins');
  check(`Plugins fits at ${width}`, await a.fits());
  await a.shot(`plugins-${width}`);
  await a.click('#market-tab-about');
}
await a.size(1280, 800);

await a.click('#nav-settings');
const about = await a.run(`document.querySelector('#setting-build-hint')?.textContent ?? ''`);
check('Settings says what this build is', about.includes(`${NAME} is a custom build of Central Knot`) && about.includes('doesn’t update itself') && about.includes('It carries the marketplace Acme plugins') && about.includes('no content feed'), about);
check('Settings offers no updates from the standard app', await a.run(`!document.querySelector('#setting-updates') && !document.querySelector('#check-updates')`));
await a.shot('settings-1280');
await a.size(860, 560);
check('Settings fits at 860', await a.fits());
await a.shot('settings-860');
check('no page error', a.errors.length === 0, a.errors);
const before = statSync(marketFolder).ino;
a.quit();
await wait(500);

// A second open keeps what is there: the same folder, not unpacked again.
const b = await launch();
await b.click('#nav-plugins');
check('a second open lists it again', await b.until(`document.querySelectorAll('.plugin-row').length === 6`));
check('a second open keeps the unpacked marketplace as it is', statSync(marketFolder).ino === before);
check('no page error at the second open', b.errors.length === 0, b.errors);
b.quit();

console.log(`bundled check (${dev ? 'development run' : 'packaged app'}): ${passes} passed, ${failures.length} failed${sparkPacked ? '' : ' (the plugin kept on GitHub could not be fetched here, and was named)'}`);
process.exit(failures.length ? 1 : 0);
