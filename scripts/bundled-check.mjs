// Checks a bundled build end to end (ORG-01, ORG-03, ORG-07): the documented build command makes a custom build from a
// fixture marketplace, the marketplace's source is then deleted, and the build is opened in a throwaway home. It must open
// under its own name with its own settings folder, list the marketplace it carries with every packed plugin readable, name
// the plugin that couldn't be packed, and keep the same content at a second open.
// Usage: node scripts/bundled-check.mjs [--electron] [--no-sandbox] [--shots dir]
// - By default (a Mac) it packages the build with `scripts/package-mac.mjs` and opens the packaged app.
// - `--electron` stages the same build and opens it as a development run, on any system (under xvfb-run on Linux).
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connect, debugPorts } from './cdp.mjs';
import { stage } from './custom-build.mjs';
import { writeClaudeInstall, writeMarket } from './fixture-market.mjs';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { applyChanges } from '../src/manage.ts';
import { syncGate } from '../src/share.ts';

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
const dataDir = join(appData, `com.centralknot.custom.${ID}`);
rmSync(dataDir, { recursive: true, force: true });
const launched = new Set();
process.on('exit', () => {
  for (const child of launched) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

// ---------- The build ----------
// The fixture marketplace, with one more plugin that can't be packed: an npm package. `change` edits its entries, for a
// later release of it.
const market = join(scratch, 'market');
function writeFixture(change = plugins => plugins) {
  rmSync(market, { recursive: true, force: true });
  writeMarket(market);
  const manifestPath = join(market, '.claude-plugin/marketplace.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.plugins = change([...manifest.plugins, { name: 'npm-thing', source: { source: 'npm', package: '@example/npm-thing' }, description: 'Kept as an npm package.' }]);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
writeFixture();
// The build's feed: a folder served on this computer only. Nothing is published in it yet.
const feedDir = join(scratch, 'feed');
mkdirSync(feedDir);
const feedServer = createServer((request, response) => {
  try { const bytes = readFileSync(join(feedDir, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '').replace(/\.\./g, ''))); response.writeHead(200, { 'Content-Length': bytes.length }); response.end(bytes); }
  catch { response.writeHead(404); response.end('not found'); }
});
await new Promise(done => feedServer.listen(0, '127.0.0.1', done));
const FEED = `http://127.0.0.1:${feedServer.address().port}/`;
/** Publishes the fixture marketplace as it is now into the feed's folder, with the documented command. */
const publish = sequence => execFileSync(process.execPath, ['scripts/publish-bundle.mjs', '--marketplace', market, '--out', feedDir, '--sequence', String(sequence)], { cwd: root, encoding: 'utf8' });
const inputs = ['--feed', FEED, '--marketplace', market, '--app-name', NAME, '--app-id', ID, '--app-icon', join(root, 'assets/icon.png'), '--marketplace-name', 'Acme plugins', '--marketplace-logo', join(root, 'assets/tray.svg')];
let command, launchArgs, report;
if (dev) {
  const staged = await stage({ feed: FEED, marketplace: market, appName: NAME, appId: ID, appIcon: join(root, 'assets/icon.png'), marketplaceName: 'Acme plugins', marketplaceLogo: join(root, 'assets/tray.svg') }, join(scratch, 'staged'));
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
check('report: the npm plugin is named as not packed', /NOT PACKED \(\d\)[\s\S]*- npm-thing: Its files are an npm package \(@example\/npm-thing\), which can’t be packed into the app\./.test(report), report);
check('report: the maker is told what the npm plugin does to Copilot CLI', /Note: Copilot CLI refuses a marketplace with an npm plugin source \(“npm-thing”\)/.test(report), report);
check('report: no update location is said, and where the feed is', report.includes('App updates: not met.') && report.includes(`Content feed: ${FEED} `), report);
// Whether the plugin kept on GitHub was fetched depends on the network: either way it must be accounted for.
const sparkPacked = /Plugins packed \(\d\): .*spark/.test(report);
check('report: the plugin kept on GitHub is packed or named', sparkPacked || /- spark: /.test(report), report);

// The source is gone before the build is ever opened.
rmSync(market, { recursive: true, force: true });

// ---------- The app ----------
// Stand-ins for the tools' CLIs: each answers --version and "plugin marketplace add <folder>", which it records where the real
// tool does (the real commands are exercised by tests/harness). Anything else fails.
mkdirSync(join(HOME, '.local/bin'), { recursive: true });
const marketNameOf = `name=$(sed -n 's/.*"name": *"\\([^"]*\\)".*/\\1/p' "$4/.claude-plugin/marketplace.json" | head -1)`;
const adds = {
  claude: `mkdir -p "$HOME/.claude/plugins"; printf '{"%s":{"source":{"source":"directory","path":"%s"},"installLocation":"%s"}}\\n' "$name" "$4" "$4" > "$HOME/.claude/plugins/known_marketplaces.json"`,
  copilot: `mkdir -p "$HOME/.copilot"; printf '{"extraKnownMarketplaces":{"%s":{"source":{"source":"directory","path":"%s"}}}}\\n' "$name" "$4" > "$HOME/.copilot/settings.json"`,
  codex: `mkdir -p "$HOME/.codex"; printf '[marketplaces.%s]\\nsource = "%s"\\n' "$name" "$4" >> "$HOME/.codex/config.toml"`,
};
for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.'], ['codex', 'codex-cli 0.142.3']]) {
  writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nif [ "$1 $2 $3" = "plugin marketplace add" ]; then ${marketNameOf}; ${adds[name]}; echo "$4" >> "$HOME/added-by-${name}.txt"; exit 0; fi\nexit 9\n`);
  chmodSync(join(HOME, '.local/bin', name), 0o755);
}
const addedBy = name => { try { return readFileSync(join(HOME, `added-by-${name}.txt`), 'utf8').trim().split('\n'); } catch { return []; } };
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

// At the first open the build adds its marketplace to each tool's own list: Claude Code and Codex here. Copilot CLI
// refuses a marketplace that lists an npm plugin, so it is left alone. Nothing is installed.
// (Only where the home can be written: on a Mac. Elsewhere it is preview only, and nothing is added.)
const writes = process.platform === 'darwin';
const waitFor = async (test, ms = 20000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(200)) if (test()) return true; return false; };
if (writes) {
  check('the marketplace was added to Claude Code’s and Codex’s own lists, by their own commands', await waitFor(() => addedBy('claude').length === 1 && addedBy('codex').length === 1), { claude: addedBy('claude'), codex: addedBy('codex') });
  check('each was given the folder in the build’s own data folder', addedBy('claude')[0] === marketFolder && addedBy('codex')[0] === marketFolder, addedBy('claude'));
  check('Copilot CLI, which refuses this marketplace, was not asked', addedBy('copilot').length === 0);
  check('nothing was installed by it', !existsSync(join(HOME, '.claude/plugins/installed_plugins.json')));
  check('the status bar says once that nothing was installed, and where the marketplace is now listed', await a.until(`document.querySelector('#announcement').textContent.startsWith('Nothing was installed: Acme plugins is listed in Claude Code and Codex (see Plugins).')`), await a.run(`document.querySelector('#announcement').textContent`));
  await a.shot('first-open-1280');
  await a.size(860, 560);
  await a.shot('first-open-860');
  await a.size(1280, 800);
} else {
  await wait(1500);
  check('in a home that is preview only, it is added to no tool', ['claude', 'copilot', 'codex'].every(name => addedBy(name).length === 0));
}
await a.click('#nav-plugins');
check('Plugins lists the carried marketplace', await a.until(`!!document.querySelector('.market-item')`));
await a.settle();
check('it is first, under the name the build gave it, marked Built in', await a.run(`document.querySelector('.market-item .market-item-name').textContent + '|' + document.querySelector('.market-item .market-item-meta').textContent`).then(text => /^Acme plugins\|Built in · 6 plugins/.test(text)));
check('it shows the picture the build gave it', await a.run(`(() => { const logo = document.querySelector('.market-item .market-logo'); return !!logo && logo.getAttribute('src') === 'bundle/marketplace-logo.svg' && logo.naturalWidth > 0; })()`));
check('the title says it comes with the app', await a.run(`document.querySelector('.market-title-line').textContent`).then(text => text.includes(`Comes with ${NAME}`)), await a.run(`document.querySelector('.market-title-line').textContent`));
const rows = await a.run(`[...document.querySelectorAll('.plugin-row')].map(row => row.dataset.plugin)`);
check('every listed plugin has a row', JSON.stringify(rows) === JSON.stringify(['document-tools', 'issue-tracker', 'npm-thing', 'release-helper', 'spark', 'starter-skills']), rows);
check('a packed plugin says what it holds, read with the source gone', await a.run(`document.querySelector('[data-plugin="document-tools"] .plugin-row-holds')?.textContent`) === '2 skills');
check('the plugin that couldn’t be packed can’t be chosen, and says why', await a.run(`(() => { const box = document.querySelector('[data-plugin="npm-thing"] .ov-cell button, [data-plugin="npm-thing"] .ov-cell [title]'); return (box?.getAttribute('title') ?? '') + '|' + (box?.getAttribute('aria-label') ?? ''); })()`).then(text => text.includes(`${NAME} doesn’t include this plugin’s files`)), await a.run(`document.querySelector('[data-plugin="npm-thing"]').outerHTML.slice(0, 900)`));
check('its row says it is not in this build, and leads to About', await a.run(`document.querySelector('[data-plugin="npm-thing"] .plugin-row-left')?.textContent`) === `Can’t be installed from ${NAME}·see why`);
check('nor are its parts offered in any tool', await a.run(`document.querySelectorAll('[data-plugin="npm-thing"] .cell-parts-offer').length`) === 0);
check('the Plugins page fits at 1280', await a.fits());
await a.shot('plugins-1280');

// The plugin the build doesn't include, on its own page: the reason is on the page, under each tool.
await a.run(`document.querySelector('[data-plugin="npm-thing"] .plugin-row-open').click()`);
check('its own page says why it can’t be installed', await a.until(`(document.querySelector('#plugin-not-included')?.textContent ?? '').includes('doesn’t include this plugin’s files') && document.querySelector('#plugin-not-included').textContent.includes('Ask Platform team if you need it.') && document.body.innerText.includes('Its files aren’t in ${NAME}')`), await a.run(`document.querySelector('#page').innerText.slice(0, 600)`));
await a.settle();
await a.shot('plugin-not-included-1280');
await a.click('#plugin-back');
await a.run(`document.querySelector('[data-plugin="document-tools"] .plugin-row-open').click()`);
check('a plugin’s page opens with its skills', await a.until(`document.body.innerText.includes('pdf-reader') && document.body.innerText.includes('spreadsheet')`));
await a.settle();
await a.shot('plugin-1280');
await a.click('#plugin-back');
await a.click('#market-tab-about');
check('About: the release it carries, and no way to remove it', await a.run(`document.querySelector('.market-page-meta').textContent + '|' + !!document.querySelector('[id^="forget-"]')`).then(text => /Plugins as of \w+ \d+, \d{4}\|false$/.test(text)), await a.run(`document.querySelector('.market-page-meta').textContent`));
if (writes) check('About says which tools have it in their own list', await a.until(`(document.querySelector('#market-listed p')?.textContent ?? '').startsWith('${NAME} added this marketplace to Claude Code and Codex, so these plugins also show in those tools’ own plugin lists. Remove it in a tool and it stays out.')`), await a.run(`document.querySelector('#market-listed')?.textContent`));
check('and offers no List in button where it is already listed or can’t go', await a.run(`document.querySelectorAll('[id^="add-carried-"]').length`) === 0);
check('About names the plugin the build doesn’t carry', await a.run(`document.querySelector('.market-not-carried')?.textContent ?? ''`).then(text => text.includes(`isn’t included in ${NAME}`) && text.includes('npm-thing') && text.includes('an npm package (@example/npm-thing)') && text.includes('Ask Platform team if you need it.')));
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
check('Settings says what this build is', about.includes(`${NAME} is a custom build of Central Knot`) && about.includes(`${NAME} is a custom build of Central Knot`) && about.includes(`for a newer one, ask whoever gave you ${NAME}`) && about.includes('Its Acme plugins marketplace is as of') && about.includes('newer plugins arrive by themselves'), about);
check('Settings offers no updates from the standard app', await a.run(`!document.querySelector('#setting-updates') && !document.querySelector('#check-updates')`));
await a.shot('settings-1280');
for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) {
  await a.size(width, height);
  check(`Settings fits at ${width}`, await a.fits());
  await a.shot(`settings-${width}`);
}

// ---------- The feed: newer plugins without a new build ----------
await a.size(1280, 800);
await a.click('#nav-plugins');
await a.click('#market-tab-about');
const feedSays = () => a.run(`document.querySelector('#market-feed p')?.textContent ?? ''`);
const checkNow = async () => { await a.click('[id^="check-feed-"]'); await a.until(`document.body.dataset.busy !== 'true'`); await a.settle(); };
check('About has the feed’s line and Check now', await a.until(`!!document.querySelector('[id^="check-feed-"]')`), await feedSays());
// Nothing is published yet.
await checkNow();
check('with nothing published, it says the feed couldn’t be read, and the plugins stay', /^Couldn’t check for newer plugins: nothing is published at their address \(the server answered 404\)\. The ones here stay in use, and the app tries again by itself\. Last tried .+\. If it keeps happening, tell Platform team\.$/.test(await feedSays()), await feedSays());
// Claude Code has starter-skills installed (as its own records say); then release 2 is published: document-tools moves
// on to 1.3.0 and starter-skills is no longer offered.
writeClaudeInstall(HOME, 'team-tools', 'starter-skills', '1.0.0', { 'skills/hello/SKILL.md': '---\nname: hello\ndescription: Says hello.\n---\n' });
writeFixture(plugins => plugins.filter(plugin => plugin.name !== 'starter-skills').map(plugin => (plugin.name === 'document-tools' ? { ...plugin, version: '1.3.0' } : plugin)));
const published = publish(Math.floor(Date.now() / 1000) + 100);
check('publish: the report says what went out', /^Published team-tools: .*\n[\s\S]*Plugins packed \(4\): document-tools 1\.3\.0[\s\S]*NOT PACKED \(1\)/.test(published), published);
rmSync(market, { recursive: true, force: true });
await checkNow();
check('Check now takes the newer plugins, and says so', /^Newer plugins arrive by themselves; a tool that has one installed uses the new one from its next session, or shows Update here\. Last checked /.test(await feedSays()) && await a.run(`document.querySelector('#announcement').textContent`).then(text => text.startsWith('Acme plugins now has the plugins published on ')), [await feedSays(), await a.run(`document.querySelector('#announcement').textContent`)]);
await a.shot('about-feed-1280');
await a.click('#market-tab-plugins');
check('the Plugins tab shows the newer version', await a.until(`document.querySelector('[data-plugin="document-tools"] .plugin-row-version')?.textContent === '1.3.0'`), await a.run(`document.querySelector('[data-plugin="document-tools"]')?.textContent`));
check('a plugin no longer offered stays, since a tool has it installed, and says so', await a.run(`document.querySelector('[data-plugin="starter-skills"] .plugin-row-left')?.textContent`) === 'No longer offered', await a.run(`[...document.querySelectorAll('.plugin-row')].map(row => row.dataset.plugin)`));
check('its files are still in the marketplace folder', existsSync(join(marketFolder, '_kept/starter-skills/skills/hello/SKILL.md')));
check('the Plugins page fits with it', await a.fits());
await a.shot('plugins-feed-1280');
// A broken publish: release 3's archive is cut short on the way up.
writeFixture(plugins => plugins.map(plugin => (plugin.name === 'document-tools' ? { ...plugin, version: '1.4.0' } : plugin)));
publish(Math.floor(Date.now() / 1000) + 200);
rmSync(market, { recursive: true, force: true });
truncateSync(join(feedDir, readdirSync(feedDir).filter(name => name.endsWith('.tgz')).sort().at(-1)), 300);
await a.click('#market-tab-about');
await checkNow();
check('a broken publish is said, with why', /^Newer plugins \(.+\) are published, but they didn’t arrive whole, so they weren’t used\. The ones here stay in use, and the app tries again by itself\. Last tried .+\. If it keeps happening, tell Platform team\.$/.test(await feedSays()), await feedSays());
check('the status bar says it short enough to read whole', await a.run(`document.querySelector('#announcement').textContent`) === 'Newer Acme plugins couldn’t be had. The ones here stay in use.', await a.run(`document.querySelector('#announcement').textContent`));
await a.shot('about-feed-broken-1280');
await a.size(860, 560);
check('About with the feed’s trouble fits at 860', await a.fits());
await a.shot('about-feed-broken-860');
await a.size(1280, 800);
await a.click('#market-tab-plugins');
check('and the last good plugins stay in use', await a.run(`document.querySelector('[data-plugin="document-tools"] .plugin-row-version')?.textContent`) === '1.3.0');
await a.click('#nav-settings');
check('Settings says newer plugins arrive by themselves', await a.run(`document.querySelector('#setting-build-hint')?.textContent ?? ''`).then(text => text.includes('newer plugins arrive by themselves')), await a.run(`document.querySelector('#setting-build-hint')?.textContent`));
check('no page error', a.errors.length === 0, a.errors);
const before = statSync(marketFolder).ino;
a.quit();
await wait(500);

// Between the two opens the standard app manages a skill in this home, as its own code does it: the home is its to sync.
const standard = { home: HOME, mode: 'custom', read: () => Promise.all(harnessIds.map(harness => discover({ home: HOME, mode: 'custom', harness }))), build: 'com.centralknot.firstlook', buildName: 'Central Knot', settingsPath: join(scratch, 'standard-settings.json'), realHome: join(scratch, 'elsewhere') };
mkdirSync(join(HOME, '.claude/skills/notes'), { recursive: true });
writeFileSync(join(HOME, '.claude/skills/notes/SKILL.md'), '---\nname: notes\ndescription: Takes notes.\n---\n\nTake notes.\n');
const managed = await applyChanges(standard, [{ key: 'notes', managed: true, off: [] }], false);
const recordPath = join(HOME, '.central-knot/sync.json');
const record = () => JSON.parse(readFileSync(recordPath, 'utf8'));
check('the standard app syncs this home first', !managed.stopped && record().owner === 'com.centralknot.firstlook' && record().ownerName === 'Central Knot' && !!record().items.notes, managed.stopped ?? record());

// Between the two opens the person takes the marketplace out of Claude Code, in Claude Code.
if (writes) rmSync(join(HOME, '.claude/plugins/known_marketplaces.json'));

// A second open keeps what is there: the same folder, not unpacked again, and what was taken out of a tool stays out.
const b = await launch();
await b.click('#nav-plugins');
check('a second open lists it again, as the feed left it', await b.until(`document.querySelectorAll('.plugin-row').length === 6 && document.querySelector('[data-plugin="document-tools"] .plugin-row-version')?.textContent === '1.3.0'`));
if (writes) {
  await b.click('#market-tab-about');
  check('About offers to add it to Claude Code again', await b.until(`!!document.querySelector('[id^="add-carried-"][id$="claude-cli"]')`), await b.run(`document.querySelector('#market-listed')?.textContent`));
  check('it was not added again by itself', addedBy('claude').length === 1 && addedBy('codex').length === 1, { claude: addedBy('claude'), codex: addedBy('codex') });
  check('and says which tool lists it and which doesn’t', await b.run(`document.querySelector('#market-listed p').textContent`) === `${NAME} added this marketplace to Codex, so these plugins also show in Codex’s own plugin list. Claude Code doesn’t list it. Remove it in a tool and it stays out.`, await b.run(`document.querySelector('#market-listed p').textContent`));
  await b.shot('about-add-1280');
  await b.size(860, 560);
  check('About with its button fits at 860', await b.fits());
  await b.shot('about-add-860');
  await b.size(1280, 800);
  await b.click('[id^="add-carried-"][id$="claude-cli"]');
  check('List in Claude Code adds it, and the page says so', await b.until(`(document.querySelector('#market-listed p')?.textContent ?? '').startsWith('${NAME} added this marketplace to Claude Code and Codex')`) && addedBy('claude').length === 2, await b.run(`document.querySelector('#market-listed')?.textContent`));
  await b.shot('about-listed-1280');
  check('the status bar says what happened', await b.run(`document.querySelector('#announcement').textContent`).then(text => text.startsWith('Nothing was installed: Acme plugins is now listed in Claude Code.')), await b.run(`document.querySelector('#announcement').textContent`));
}
check('a second open keeps the unpacked marketplace as it is', statSync(marketFolder).ino === before);

// ---------- One build syncs a home at a time ----------
await b.click('#nav-skills');
const ownerSays = () => b.run(`document.querySelector('#other-owner .band-text')?.textContent ?? ''`);
// Whether the standard app is open now is asked of macOS for an installed app; a development run can't tell.
check('Skills says the standard app syncs this home', await b.until(`!!document.querySelector('#other-owner')`) && (dev ? await ownerSays() === 'Central Knot syncs this home, so nothing is changed from here.'
  : /^Central Knot (is open and syncs this home, so nothing is changed from here|synced this home last and isn’t open, so nothing is syncing here now)\.$/.test(await ownerSays())), await ownerSays());
check('with Take over syncing beside it', await b.run(`document.querySelector('#take-over-sync')?.textContent`) === 'Take over syncing');
check('Skills fits with it at 1280', await b.fits());
await b.shot('skills-other-owner-1280');
await b.size(860, 560);
check('Skills fits with it at 860', await b.fits());
await b.shot('skills-other-owner-860');
await b.size(1280, 800);
await b.click('#nav-overview');
check('Overview says so too', await b.run(`document.querySelector('#overview-other-owner')?.textContent ?? ''`).then(text => text.startsWith('Central Knot ') && text.endsWith('Take over syncing')) || !writes, await b.run(`document.querySelector('#overview-other-owner')?.textContent`));
await b.shot('overview-other-owner-1280');
if (writes) {
  check('the status bar’s sync switch says whose it is', await b.run(`document.querySelector('#sync-switch .sync-state').textContent`) === 'By Central Knot');
  await b.click('#nav-skills');
  await b.click('#take-over-sync');
  check('Take over syncing: this build syncs the home now, and says so', await b.until(`!document.querySelector('#other-owner')`) && await b.run(`document.querySelector('#announcement').textContent`).then(text => text === `${NAME} now syncs this home, from where Central Knot left it. Central Knot no longer syncs here.`), await b.run(`document.querySelector('#announcement').textContent`));
  const taken = record();
  check('the record is the same one, under the new owner, with what was managed', taken.owner === `com.centralknot.custom.${ID}` && taken.ownerName === NAME && !!taken.items.notes, taken);
  const other = await syncGate(standard);
  check('the standard app then finds this build syncs it, by name', other.state === 'stopped' && other.owner?.name === NAME, other);
  check('the sync switch is this build’s again', await b.run(`document.querySelector('#sync-switch .sync-state').textContent`).then(text => text.startsWith('On')), await b.run(`document.querySelector('#sync-switch').textContent`));
  await b.shot('skills-taken-over-1280');
} else {
  await b.click('#nav-skills');
  check('where the home is preview only, taking over is not offered to act', await b.run(`document.querySelector('#take-over-sync').disabled`) === true);
}
check('no page error at the second open', b.errors.length === 0, b.errors);
b.quit();

console.log(`bundled check (${dev ? 'development run' : 'packaged app'}): ${passes} passed, ${failures.length} failed${sparkPacked ? '' : ' (the plugin kept on GitHub could not be fetched here, and was named)'}`);
feedServer.close();
process.exit(failures.length ? 1 : 0);
