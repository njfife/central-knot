// A screenshot tour of the real app on the Practice copy.
// Clicks are sent as pointer clicks (detail 1), as a mouse makes them; keyboard steps use real Tab presses.
// Usage: node scripts/ui-tour.mjs <outDir> [--electron] [--no-sandbox] [--only shell,skills,…] [--full]
// - With no switch it is the light tour (folder `light`): the app opens and each page is opened once, one picture each,
//   in well under a minute. It fails if a page doesn't open or throws. This is the run for every change.
// - `--only a,b` runs the named feature sections: the ones a change touched.
// - `--full` runs every feature section, about 1,700 pictures over about forty minutes on the Mac. For a new release only.
// Features, in the order they run: shell, library (the Library on All and each kind at five sizes), skills, sync, mcp, agents, agents-pi (an agent in Pi, as a skill), plugins, plugin-clicks (switch clicks waiting their turn), plugin-boxes (a tool's box on a plugin's page with three working tools: ticked, kept out, refused), plugin-text (a plugin's instruction files and the hooks that can add text to sessions), profiles, first-setup, sync-everything, plugin-skills, plugin-updates,
// plugin-versions, plugin-items, instructions, sizes (four tools; every page at 860×560 with the sidebar as a rail and
// open, then 1280×800, 1728×1117 and 2560×1440, each in dark and in light), shared-copies, missing (a folder home with only
// Claude Code and Codex, so Copilot CLI and Pi appear nowhere as options), updates, settings, base, scroll, harnesses, manage (a
// tool's Manage switch, each state of the Harnesses list it changes, and the Library’s skills and Overview with tools left out), repo,
// remove-build (one install at a time: the held screen while another build of Central Knot is on this Mac, as made-up
// bundles), sources (a Git link read on a click, made-up repositories standing in for GitHub), source-agents (agents from a
// link, beside a skill), source-servers (MCP servers from a link, reaching Claude Code as every tool), source-plugins
// (a link to a plugin's own folder, a marketplace or a plugin one lists, and Add to Plugin marketplaces), plugin-library
// (a plugin's items in Pi as library items), parts-migration (a plugin's parts an earlier version put into Pi, moved to the
// library at one look), sort (the item pages sorted by last updated) and usage (usage collected from made-up session history:
// the button and its band, each row's figure, an opened row's line per tool, and the "No use seen in 30 days" chip with its band)
// and overview (the Overview on a made-up home of ordinary size: no tool, first setup, collecting and collected, a problem, an
// update to install, and at 1280×800 the states one line changes).
// Each feature gets its own folder with NN-name.png (2x), NN-name.txt (the page's visible text) and tour.md (what each step did).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeClaudeInstall, writeMarket, writeOldParts } from './fixture-market.mjs';
import { serveReleases } from './update-fixture.mjs';
import { connect, DAY, debugPorts, holdQueue, keepFor, mainProcess, mountsGone, openKind, refocus, byId, rowPart, standIn } from './cdp.mjs';
import { standInApp, standInMac } from '../tests/macstandins.ts';
import { packagedApp } from './package-app.mjs';
import { launched, scratchFolder, tempPlaces } from './scratch.ts';

const args = process.argv.slice(2);
const out = resolve(args.find(arg => !arg.startsWith('--')) ?? 'ui-tour');
const flag = name => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
const full = flag('--full');
const root = resolve(import.meta.dirname, '..');
const command = flag('--electron') ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : packagedApp();
const scratch = scratchFolder('ck-tour-');
const HOME = join(scratch, 'home');
mkdirSync(HOME, { recursive: true });
// What stands in for /Applications, the running apps and the Trash in every launch (platform.ts macPlaces): the tour never
// looks at or removes the real ones.
const MAC = standInMac(join(scratch, 'mac'));
// On Linux the file manager is a stand-in that opens nothing.
mkdirSync(join(scratch, 'bin'));
writeFileSync(join(scratch, 'bin/xdg-open'), '#!/bin/sh\nexit 0\n');
chmodSync(join(scratch, 'bin/xdg-open'), 0o755);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

/** What a page threw, in any app this run started. */
const pageErrors = [];
async function launch(more = {}) {
  const env = { HOME, PATH: `${join(scratch, 'bin')}:/usr/bin:/bin`, ...tempPlaces(join(scratch, 'tmp')), CK_PLUGIN_UPDATES_EVERY_MS: 'never', CK_PLUGIN_TEXT: 'never', CK_TEST_APPS: MAC.root, ...more };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  // The app picks its own free debug ports (port 0) and says them, so no other run on this machine can be on them (cdp.mjs
  // debugPorts). A dev run also opens its main process, so the tour can show states only an installed app reaches (see Settings).
  const child = spawn(command, [...(flag('--electron') ? [root, '--inspect=0'] : []), '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'data')}`, '--practice-copy', ...(flag('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  launched.add(child);
  child.once('exit', () => launched.delete(child));
  const { port, inspect } = await debugPorts(child, flag('--electron'));
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { /* starting */ } if (!target) await wait(200); }
  if (!target) throw new Error('The app opened no window.');
  const page = await connect(target.webSocketDebuggerUrl, data => { if (data.method === 'Runtime.exceptionThrown') pageErrors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text); });
  const { send, run } = page;
  await send('Runtime.enable');
  // A page that never settles fails the tour instead of holding it open.
  const settle = async () => { await wait(150); await run(`new Promise((done, fail) => { const end = Date.now() + 30000; const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : Date.now() > end ? fail(new Error('The page did not settle within 30 s.')) : setTimeout(c, 25); c(); })`); await wait(200); };
  const viewport = { width: 1280, height: 800 };
  /** Sizes the page as the window would be: the app's layout follows window.innerWidth and its resize event. */
  const size = async (width, height) => {
    Object.assign(viewport, { width, height });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
    await run(`window.dispatchEvent(new Event('resize'))`);
    await settle();
  };
  await size(1280, 800);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await settle();
  return {
    run, send, settle, size, viewport, inspect,
    main: inspect && (() => mainProcess(inspect)),
    // A pointer click, as a mouse makes it (detail 1): pages tell a keyboard press (detail 0) apart to keep focus in place.
    click: async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); })()`); await settle(); },
    has: selector => run(`!!document.querySelector(${JSON.stringify(selector)})`),
    press: async key => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, Enter: 13 }[key] }); await settle(); },
    theme: async value => { await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }); await settle(); },
    quit: () => { page.close(); child.kill('SIGKILL'); },
  };
}

/**
 * One request from the page slowed or made to fail until `restore`, through the main process's debugger (development
 * runs only, cdp.mjs), so the tour can show a page reading again, or a read that failed. Null in a packaged run.
 */
async function requestHandles(a) {
  if (!a.main) return null;
  const main = await a.main();
  const handlers = 'electron.ipcMain._invokeHandlers';
  return {
    slow: (channel, ms) => main.run(`(() => { const real = ${handlers}.get(${JSON.stringify(channel)}); globalThis.ckAside = real; ${handlers}.set(${JSON.stringify(channel)}, (...args) => new Promise(done => setTimeout(done, ${ms})).then(() => real(...args))); return true; })()`),
    fail: channel => main.run(`(() => { globalThis.ckAside = ${handlers}.get(${JSON.stringify(channel)}); ${handlers}.set(${JSON.stringify(channel)}, () => { throw new Error('Refused for the tour.'); }); return true; })()`),
    restore: channel => main.run(`(() => { ${handlers}.set(${JSON.stringify(channel)}, globalThis.ckAside); delete globalThis.ckAside; return true; })()`),
    close: main.close,
  };
}

let feature = '';
let step = 0;
const begin = name => { feature = name; step = 0; mkdirSync(join(out, name), { recursive: true }); writeFileSync(join(out, name, 'tour.md'), `# ${name}\n\nEach step: what was just done, then the screenshot and visible text with the same number.\n\n`); };
const wanted = name => only ? only.includes(name) : full;
/** Takes a screenshot. `pointer`: where the mouse rests for it (to show a hover); by default out of the way, in the corner. */
async function shot(a, name, caption, pointer = { x: 2, y: a.viewport.height - 2 }) {
  step++;
  const base = `${String(step).padStart(2, '0')}-${name}`;
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });
  await wait(120);
  const reply = await a.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, feature, `${base}.png`), Buffer.from(reply.result.data, 'base64'));
  writeFileSync(join(out, feature, `${base}.txt`), await a.run('document.body.innerText'));
  appendFileSync(join(out, feature, 'tour.md'), `${step}. **${base}**: ${caption}\n`);
}
const waitFor = async (a, expression, ms = 8000) => { for (let spent = 0; spent < ms; spent += 250) { if (await a.run(expression)) return true; await wait(250); } return false; };
const edit = (path, change) => writeFileSync(path, change(readFileSync(path, 'utf8')));
// Types a marketplace source into "Add a marketplace" (opening the box first if needed) and clicks Add.
async function addMarketplace(a, source) {
  // Plugins reads its data when it opens, so the form may not be drawn yet.
  await waitFor(a, `!!document.querySelector('#marketplace-source, #open-add-marketplace')`, 20000);
  if (!(await a.has('#marketplace-source'))) await a.click('#open-add-marketplace');
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(source)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
}

let a = await launch();
let practice = await a.run(`document.querySelector('.status-home').title`);
/**
 * Starts the app again on a clean slate for a section that needs one: new app data, an empty HOME (no stand-in CLIs) and,
 * with the new launch, a new Practice copy. Before any section has run, the first launch is already clean.
 */
async function fresh(more = {}, keepData = false) {
  if (!feature && !Object.keys(more).length) return;
  a.quit();
  await wait(500);
  for (const folder of keepData ? [] : [join(scratch, 'data'), HOME]) rmSync(folder, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
  a = await launch(more);
  practice = await a.run(`document.querySelector('.status-home').title`);
}

// ---------- The library pages' pictures (Skills, Agents) ----------
/** The four window sizes every state of a library page is pictured at. */
const SIZES = [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]];
/** Scrolls what a picture is about into view: its middle (`block` center), or its top where its own scroll margin puts it. */
const show = (selector, block = 'center') => a.run(`document.querySelector('${selector}')?.scrollIntoView({ block: '${block}' })`);
/** One state at every size (and, `light`, once in the light appearance), then back to 1280×800. `at`: what to scroll into view at each size. */
async function atEverySize(name, caption, light = false, at = undefined, block = 'center') {
  for (const [width, height] of SIZES) { await a.size(width, height); if (at) await show(at, block); await shot(a, `${name}-${width}`, `${caption} (${width}×${height})`); }
  await a.size(1280, 800);
  if (at) await show(at, block);
  if (light) { await a.theme('light'); await shot(a, `${name}-light`, `${caption} (light appearance)`); await a.theme('dark'); }
}
/** Where the pointer rests to hover an element, at its middle. */
const middleOf = selector => a.run(`(() => { const box = document.querySelector('${selector}').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; })()`);
/** Keyboard focus on an element, with its focus ring (as a Tab press gives it). */
const focusOn = selector => a.run(`document.querySelector('${selector}')?.focus({ focusVisible: true })`);
const refresh = async () => { await a.click('#header-refresh'); await a.settle(); };
/** Waits until the header's Notices names `name` (its tooltip names the first three it counts): a sync notice reached the page. */
const noticeFor = name => waitFor(a, `(document.querySelector('#notices')?.title ?? '').includes(${JSON.stringify(name)})`, 15000);
/** Opens the header's card of sync notices (Notices), where each notice's actions are; `closeNotices` closes it by its ×. */
const openNotices = async () => { if (!(await a.has('#notices-card'))) { await a.click('#notices'); await a.settle(); } };
const closeNotices = async () => { if (await a.has('#notices-close')) { await a.click('#notices-close'); await a.settle(); } };
/** A row's details, opened or closed whichever way they are now. */
const isOpen = (kind, key) => a.has(`.ov-row[data-key="${rowPart('', kind, key)}"][aria-expanded="true"]`);
const openRow = async (kind, key) => { if (!(await isOpen(kind, key))) { await a.click(byId(rowPart('open', kind, key))); await a.settle(); } };
const closeRow = async (kind, key) => { if (await isOpen(kind, key)) { await a.click(byId(rowPart('open', kind, key))); await a.settle(); } };
/** Waits until the row's switch is on. */
const switchOn = (kind, key) => waitFor(a, `document.querySelector('${byId(rowPart('switch', kind, key))}')?.getAttribute('aria-checked') === 'true'`, 15000);
/** Turns a row on: Add where it is found, its switch where it is off (in Central Knot only); nothing where it is on. */
const turnOnRow = async (kind, key) => {
  const [add, toggle] = [byId(rowPart('add', kind, key)), byId(rowPart('switch', kind, key))];
  if (await a.has(`${add}, ${toggle}:not([aria-checked="true"])`)) await a.click(`${add}, ${toggle}`);
};

// ---------- The light tour: the app opens, and so does each page ----------
if (only ? only.includes('light') : !full) {
  begin('light');
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  for (const name of ['overview', 'harnesses', 'library', 'mcpsignin', 'instructions', 'plugins', 'sources', 'profiles', 'history', 'sessions', 'repo', 'settings']) {
    if (!(await a.has(`#nav-${name}`))) throw new Error(`The sidebar has no ${name} page.`);
    await a.click(`#nav-${name}`);
    if (!(await waitFor(a, `document.querySelector('#nav-${name}')?.getAttribute('aria-current') === 'page'`))) throw new Error(`The ${name} page did not open.`);
    await shot(a, name, `Clicked "${name}" in the sidebar, on the Practice copy at 1280×800.`);
  }
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- First run, homes and navigation ----------
if (wanted('shell')) {
  begin('shell');
  await shot(a, 'first-launch-dark', 'The app as it first opens (dark appearance): the Overview, on the Practice copy, a throwaway set of sample skills, MCP servers and agents.');
  await a.theme('light'); await shot(a, 'first-launch-light', 'The same, in the light appearance.'); await a.theme('dark');
  await openKind(a, 'skills'); await shot(a, 'skills-page', 'Clicked "Skills" in the sidebar: the skills table.');
  await a.click('#nav-harnesses'); await shot(a, 'harnesses-page', 'Clicked "Harnesses": each tool found, with what it has.');
  await a.click('#nav-history'); await shot(a, 'history-empty', 'Clicked "History" before anything happened.');
  await a.click('#nav-overview');
  if (await a.has('#intro-dismiss')) { await a.click('#intro-dismiss'); await shot(a, 'intro-dismissed', 'Dismissed the practice-copy note on the Overview.'); }
  if (await a.has('#sidebar-toggle')) { await a.click('#sidebar-toggle'); await shot(a, 'sidebar-collapsed', 'Clicked the sidebar toggle (top left) to collapse the sidebar.'); await a.click('#sidebar-toggle'); }
  // The tour's "real home" is an empty throwaway folder: with no tool found there (Linux), the sidebar has no Skills.
  await a.click('#home-actual'); if (await a.has('#nav-library')) await openKind(a, 'skills');
  await shot(a, 'this-macs-home', 'Clicked "This Mac\'s home" ("This computer\'s home" off macOS) at the bottom left. (In this tour the "real home" is an empty throwaway folder: only tools installed on this machine are found there.)');
  await a.click('#home-fixture'); await a.click('#nav-overview'); await shot(a, 'back-to-practice', 'Clicked "Practice copy" to go back, then "Overview".');
}

// ---------- The Library ----------
// One page for every kind (STEP-LIB2.md): All and each kind at five sizes, dark and light; at 860×600 the toolbar with Find
// filled, the sidebar a rail and open; a row opened and docked beside the list.
if (wanted('library')) {
  begin('library');
  for (const kind of ['all', 'skills', 'mcp', 'agents']) {
    await openKind(a, kind);
    for (const [width, height] of [[860, 600], [1280, 800], [1316, 822], [1728, 1080], [2560, 1440]]) {
      await a.size(width, height);
      for (const theme of ['dark', 'light']) { await a.theme(theme); await shot(a, `${kind}-${width}-${theme}`, `The Library on ${kind === 'all' ? 'All' : kind}, ${width}×${height}, ${theme}.`); }
    }
  }
  await a.theme('dark');
  await openKind(a, 'all');
  await a.size(860, 600);
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'notes'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shot(a, 'toolbar-860', 'Typed "notes" in Find on All at 860×600: the kind switch keeps its words and counts what Find leaves.');
  await a.click('#sidebar-toggle');
  await shot(a, 'toolbar-860-sidebar-switched', 'Clicked the sidebar toggle: the same toolbar with the sidebar the other way (a rail, or open).');
  await a.click('#sidebar-toggle');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.size(1728, 1080);
  await a.click(`#${rowPart('open', 'skills', 'notes')}`);
  await shot(a, 'docked-1728', 'Opened notes on All at 1728×1080: its details docked beside the list, the list’s kind marks and tool columns beside it.');
  await a.click(`#${rowPart('open', 'skills', 'notes')}`);
  // Made-up homes, each opened as a folder: his counts, then the empty states and a kind not all read.
  const settings = join(scratch, 'data/app-settings.json'), toolsOf = folder => { for (const name of ['.claude', '.claude.json', '.codex', '.copilot']) cpSync(join(root, 'fixtures/home', name), join(folder, name), { recursive: true }); };
  const openFolder = async folder => { a.quit(); await wait(500); writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: folder } })); a = await launch(); };
  const md = (name, kind) => `---\nname: ${name}\ndescription: The ${name} ${kind}, one of many.\n---\n\nBody.\n`;
  const put = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
  // About 150 skills, 9 servers and 47 agents (his counts), a skill and an agent named review, a plugin, and copies that differ.
  const big = join(scratch, 'library-big');
  toolsOf(big);
  for (let n = 1; n <= 146; n++) put(join(big, `.claude/skills/skill-${String(n).padStart(3, '0')}/SKILL.md`), md(`skill-${String(n).padStart(3, '0')}`, 'skill'));
  for (let n = 1; n <= 44; n++) put(join(big, `.claude/agents/agent-${String(n).padStart(2, '0')}.md`), md(`agent-${String(n).padStart(2, '0')}`, 'agent'));
  put(join(big, '.claude/agents/review.md'), md('review', 'agent'));
  const settingsFile = JSON.parse(readFileSync(join(big, '.claude.json'), 'utf8'));
  for (let n = 1; n <= 8; n++) settingsFile.mcpServers[`server-${n}`] = { type: 'http', url: `https://server-${n}.example.test/mcp` };
  writeFileSync(join(big, '.claude.json'), JSON.stringify(settingsFile, null, 2));
  writeClaudeInstall(big, 'ck-test-market', 'issue-tracker', '2.0.0', { 'skills/triage/SKILL.md': md('triage', 'skill') });
  await openFolder(big);
  await a.click('#nav-overview');
  if (await a.has('#setup-yes')) { await a.click('#setup-yes'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); }
  // Ten skills and three agents taken in 40 days ago, and Claude Code's sessions, so the No use seen chip has something to hold.
  a.quit(); await wait(500);
  const past = new Date(Date.now() - 40 * DAY).toISOString();
  for (const [kind, keys] of [['skills', Array.from({ length: 10 }, (_, n) => `skill-${String(n + 1).padStart(3, '0')}`)], ['agents', ['agent-01', 'agent-02', 'agent-03']]]) {
    const file = join(big, `.central-knot/${kind}.json`), kept = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of keys) if (kept.items[key]) kept.items[key].versions = kept.items[key].versions.map(version => ({ ...version, at: past }));
    writeFileSync(file, JSON.stringify(kept, null, 2));
  }
  put(join(big, '.claude/projects/-work/s1.jsonl'), `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'notes' } }] }, timestamp: new Date(Date.now() - DAY).toISOString() })}\n`);
  await openFolder(big);
  await openKind(a, 'all');
  await a.size(1316, 822);
  await waitFor(a, `!!document.querySelector('#chip-unused')`, 20000);
  for (const theme of ['dark', 'light']) { await a.theme(theme); await shot(a, `his-counts-1316-${theme}`, `His counts at 1316×822 (${theme}): about 150 skills, 9 servers and 47 agents on All, the two chips offered (Copies differ, No use seen) and From, the usage button keeping "Update usage".`); }
  await a.theme('dark');
  await a.click('#chip-unused');
  await shot(a, 'his-counts-chip-on-1316', 'No use seen on at 1316×822: the chip that is on keeps its word, the kind switch counts what it leaves.');
  await a.click('#chip-unused');
  await a.run(`document.querySelector('.ov-row[data-key="${rowPart('', 'agents', 'review')}"]')?.scrollIntoView({ block: 'center' })`);
  await shot(a, 'his-counts-same-name-1316', 'The skill review and the agent review on All at 1316×822: each says its kind beside its name.');
  // One skill and nothing else: a segment with none of its kind, and Find leaving nothing.
  const one = join(scratch, 'library-one');
  put(join(one, '.claude/skills/solo/SKILL.md'), md('solo', 'skill'));
  await openFolder(one);
  await a.size(1280, 800);
  await openKind(a, 'mcp');
  await shot(a, 'empty-of-kind', 'A home with one skill, MCP servers chosen: its own empty state, "No MCP servers here yet", under the kind switch.');
  await openKind(a, 'all');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'zzz'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shot(a, 'empty-find', 'Find "zzz" on All: "Nothing matches".');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  // Its MCP record damaged: "?" on MCP servers and All, the stop led by its kind on All and said alone on its own segment.
  put(join(one, '.central-knot/mcp.json'), '{');
  await a.click('#header-refresh');
  await shot(a, 'not-all-read-all', 'The MCP record damaged: "?" after MCP servers’ and All’s counts, the stop led by its kind above the list.');
  await openKind(a, 'mcp');
  await shot(a, 'not-all-read-own-segment', 'MCP servers chosen with its record damaged: its stop above, and "No MCP servers read here".');
  // Nothing of any kind, then with its MCP record damaged too.
  const none = join(scratch, 'library-none');
  mkdirSync(join(none, '.claude'), { recursive: true });
  await openFolder(none);
  await openKind(a, 'all');
  await shot(a, 'empty-nothing', 'A home whose tools hold nothing: "Nothing in the Library yet".');
  put(join(none, '.central-knot/mcp.json'), '{');
  await a.click('#header-refresh');
  await shot(a, 'empty-nothing-not-read', 'The same home with its MCP record damaged: the stop above the empty words, which name MCP servers.');
  await a.size(1280, 800);
  await fresh();
}

// ---------- Skills ----------
// Skills are on Central Knot's library, as agents are (src/library.ts, src/skills.ts): every state of a skill's row, at four sizes.
if (wanted('skills')) {
  begin('skills');
  const folderIn = (tool, key) => join(practice, { claude: '.claude/skills', copilot: '.copilot/skills', codex: '.codex/skills' }[tool], key);
  const putSkill = (tool, key, body) => { mkdirSync(folderIn(tool, key), { recursive: true }); writeFileSync(join(folderIn(tool, key), 'SKILL.md'), `---\nname: ${key}\ndescription: ${body}\n---\n\n${body}\n`); };
  await openKind(a, 'skills');
  await atEverySize('found', 'Clicked "Skills". Every skill is found: a tool has it and Central Knot doesn’t yet, so each row has Add where an On row has its switch; review’s copies differ', true);
  await shot(a, 'found-hover', 'The pointer on notes’s Add: its tooltip says a click adds it to Central Knot and puts it in every tool.', await middleOf(`#${rowPart('add', 'skills', 'notes')}`));
  await openRow('skills', 'notes');
  await atEverySize('found-open', 'Opened notes while it is found: its status, what every tool it is on in gets of a skill (its whole folder), each tool’s line, and Files and contents', true, '.details');
  await closeRow('skills', 'notes');
  // Taken in: written to every tool, its whole folder. Its Undo takes it out again: found once more, the tools it was found in keeping theirs.
  await a.click(`#${rowPart('add', 'skills', 'notes')}`); await switchOn('skills', 'notes');
  await atEverySize('taken-in', 'Clicked notes’s Add: it is in Central Knot now, and on in all 3 tools; the header says so, with Undo', false, '#header');
  await a.click('#outcome-undo'); await a.settle();
  await atEverySize('taken-in-undone', 'Clicked Undo in that strip: the copy Codex got is gone, Claude Code and Copilot CLI keep theirs, and notes is found again', false, '.bands');
  await a.click(`#${rowPart('add', 'skills', 'notes')}`); await switchOn('skills', 'notes');
  // Off: out of every tool, kept in Central Knot.
  await a.click(`#${rowPart('switch', 'skills', 'notes')}`); await a.settle();
  await atEverySize('off', 'Turned notes off: its folder left every tool; its row stays where it was, under Found, drawn Off, "in Central Knot only", until he leaves the list or clicks Refresh; the result offers Undo', true);
  await openRow('skills', 'notes');
  await atEverySize('off-open', 'Opened the Off row: its status, each tool with no copy while it is off, its versions, and Delete from Central Knot with how it differs from Off', true, '.details');
  await a.click(`#${rowPart('switch', 'skills', 'notes')}`); await switchOn('skills', 'notes');
  await closeRow('skills', 'notes');
  // The copy question: review's copies differ.
  await a.click(`#${rowPart('add', 'skills', 'review')}`); await a.settle();
  await atEverySize('copy-question', 'Clicked review’s Add: its copies differ, so the row asks which copy every tool uses, quoting each copy’s first line and saying what choosing it does. Nothing is written yet', true, '.details-differs');
  await a.click(`#${rowPart('use', 'skills', 'review', 'copilot-cli')}`); await switchOn('skills', 'review');
  await openRow('skills', 'review');
  await atEverySize('chosen-versions', 'Clicked "Use this copy" on Copilot CLI’s: review is in Central Knot, on in all 3 tools; opened, its versions list Copilot CLI’s copy (current) and Claude Code’s, kept as a version', true, '.version-row');
  await a.click(`#${rowPart('version-read', 'skills', 'review', '1')}`);
  await waitFor(a, `!!document.querySelector('.version-read')`);
  await atEverySize('version-read', 'Clicked Read on Claude Code’s version: its SKILL.md, what differs from the current version marked', false, '.version-read');
  await a.click(`#${rowPart('version-read', 'skills', 'review', '1')}`);
  await closeRow('skills', 'review');
  // Partial: kept out of one tool by its switch in the opened row.
  for (const key of ['release-notes', 'standup']) { await a.click(`#${rowPart('add', 'skills', key)}`); await switchOn('skills', key); }
  await openRow('skills', 'standup');
  await a.click(`#${rowPart('enable', 'skills', 'standup', 'codex-cli')}`); await a.settle();
  await atEverySize('partial', 'Turned release-notes and standup on, then opened standup and turned it off in Codex alone: its folder left Codex; the row says "in 2 of 3 tools · kept out of Codex" and its switch is drawn partial', true, `.ov-row[data-key="${rowPart('', 'skills', 'standup')}"]`);
  await a.click(`#${rowPart('enable', 'skills', 'standup', 'codex-cli')}`); await a.settle();
  await closeRow('skills', 'standup');
  // A tool's own switch, set in its settings: read, never undone; the opened row can clear it.
  const claudeSettings = join(practice, '.claude/settings.json');
  const settingsBefore = existsSync(claudeSettings) ? readFileSync(claudeSettings, 'utf8') : '{}';
  writeFileSync(claudeSettings, JSON.stringify({ ...JSON.parse(settingsBefore), skillOverrides: { 'release-notes': 'off' } }, null, 2));
  await refresh();
  await openRow('skills', 'release-notes');
  await atEverySize('switched-off', 'Outside the app, Claude Code’s settings turned release-notes off, then Refresh: its folder stays; Claude Code is not counted as on (status line, a partial switch, its own mark); its line says "Switched off" and offers Let Claude Code load it', true, '.details');
  await a.click(`#${rowPart('clear-switch', 'skills', 'release-notes', 'claude-cli')}`); await a.settle();
  await atEverySize('switch-cleared', 'Clicked "Let Claude Code load it": Claude Code loads it again; the strip says so, with Undo (which sets that switch again)', false, '.bands');
  await closeRow('skills', 'release-notes');
  // An edit made in a tool becomes the current version and reaches the others; its notice offers Undo.
  writeFileSync(join(folderIn('codex', 'standup'), 'SKILL.md'), `${readFileSync(join(folderIn('codex', 'standup'), 'SKILL.md'), 'utf8')}\nEdited in Codex.\n`);
  await refresh();
  await noticeFor('standup');
  await atEverySize('edit-notice', 'Outside the app, standup’s SKILL.md was edited in Codex, then Refresh: the header says, as an automatic change, that the edit is the current version now, in Claude Code and Copilot CLI too');
  await openNotices();
  await atEverySize('edit-notice-card', 'Opened Notices: the card, where the notice offers See change, Undo and History');
  await closeNotices();
  // A folder deleted by hand turns the skill off everywhere; Central Knot keeps it, and the notice offers Turn it on.
  rmSync(folderIn('copilot', 'release-notes'), { recursive: true, force: true });
  await refresh(); await wait(2300); await refresh();
  await noticeFor('release-notes');
  await openNotices();
  await atEverySize('deleted-by-hand', 'Outside the app, release-notes’s folder was deleted in Copilot CLI, then Refresh (twice, past the settle window): it is off everywhere, kept in Central Knot; opened, Notices’ card says so and offers Turn it on', true);
  await closeNotices();
  await a.click(`#${rowPart('switch', 'skills', 'release-notes')}`); await switchOn('skills', 'release-notes');
  // Found skills that can't go everywhere: a folder that can't be copied as it is, and a name Copilot CLI won't load.
  putSkill('claude', 'has-link', 'A skill with a link inside.');
  symlinkSync('SKILL.md', join(folderIn('claude', 'has-link'), 'alias'));
  mkdirSync(folderIn('claude', 'plain-notes'), { recursive: true }); writeFileSync(join(folderIn('claude', 'plain-notes'), 'SKILL.md'), 'Notes with no frontmatter, which Copilot CLI and Codex won’t load.\n');
  await refresh();
  await openRow('skills', 'has-link');
  await atEverySize('cannot-copy', 'A skill in Claude Code with a link inside its folder: its row says it can’t be taken in, its Add looks unavailable, and Claude Code’s line says why and what to do (replace the link with the file, then Refresh)', true, '.details');
  await closeRow('skills', 'has-link');
  await openRow('skills', 'plain-notes');
  await atEverySize('cannot-take', 'A skill with no frontmatter in Claude Code, found: the status says it goes nowhere else, Copilot CLI and Codex can’t take it; their marks (their own) and lines say why, in the same words', false, '.details');
  await closeRow('skills', 'plain-notes');
  rmSync(folderIn('claude', 'has-link'), { recursive: true, force: true }); rmSync(folderIn('claude', 'plain-notes'), { recursive: true, force: true });
  await refresh();
  // Another way: a copy in ~/.agents/skills, which Copilot CLI and Codex read; Claude Code gets Central Knot's copy.
  mkdirSync(join(practice, '.agents/skills/shared-notes'), { recursive: true });
  writeFileSync(join(practice, '.agents/skills/shared-notes/SKILL.md'), '---\nname: shared-notes\ndescription: Kept in the shared folder.\n---\n\nKept in the shared folder.\n');
  await refresh();
  await a.click(`#${rowPart('add', 'skills', 'shared-notes')}`); await switchOn('skills', 'shared-notes');
  await openRow('skills', 'shared-notes');
  await atEverySize('another-way', 'A skill in ~/.agents/skills, taken in: the strip says it is on in Claude Code and that Copilot CLI and Codex have it another way; their lines say "Another way" (no switch: nothing of Central Knot’s goes there) and offer Take over…', true, '.details');
  await a.click(`#${rowPart('take-over', 'skills', 'shared-notes', 'copilot-cli')}`);
  await atEverySize('take-over-armed', 'Clicked "Take over…" on Copilot CLI’s line: its armed line says which folder goes, which tools get Central Knot’s copy instead, that other apps won’t find it there, and that it has no Undo', false, '.details');
  await a.click(`#${rowPart('take-over-confirm', 'skills', 'shared-notes', 'copilot-cli')}`); await a.settle();
  await atEverySize('taken-over', 'Clicked "Take over now": the shared copy is gone, Copilot CLI and Codex have Central Knot’s copy; the strip says so and that it has no Undo', false, '.bands');
  await closeRow('skills', 'shared-notes');
  // Delete from Central Knot, armed, then done.
  await openRow('skills', 'shared-notes');
  await a.click(`#${rowPart('delete', 'skills', 'shared-notes')}`);
  await atEverySize('delete-armed', 'Clicked "Delete from Central Knot…": it says what happens, and for how long History can restore it', false, `#${rowPart('delete-note', 'skills', 'shared-notes')}`);
  await a.click(`#${rowPart('delete-confirm', 'skills', 'shared-notes')}`); await a.settle();
  await shot(a, 'deleted', 'Clicked "Delete it now": shared-notes is out of every tool and off the page; History can restore it.');
  // The Files view.
  await openRow('skills', 'standup');
  await a.click(`#${rowPart('files', 'skills', 'standup')}`); await a.settle();
  await atEverySize('files-view', 'Clicked "Files and contents" in standup’s details: the list of skills beside standup’s switch; stacked, its SKILL.md comes first, then each tool’s line and where each copy is ("← Skills" goes back)', true);
  await a.click('#files-back');
  // For History's switch actions (the owner asked what its "Turn on" means): the first skill that is on is kept out of Codex in
  // its opened row, and the second turned off, so History offers "Turn it on in Codex" and "Turn it on".
  const [outOfCodex, turnedOff] = await a.run(`[...document.querySelectorAll('[id^="${rowPart('switch', 'skills', '')}"][aria-checked="true"]')].map(each => each.id.slice(${rowPart('switch', 'skills', '').length}))`);
  await openRow('skills', outOfCodex); await a.click(`#${rowPart('enable', 'skills', outOfCodex, 'codex-cli')}`); await a.settle(); await closeRow('skills', outOfCodex);
  await a.click(`#${rowPart('switch', 'skills', turnedOff)}`); await a.settle();
  // History.
  await a.click('#nav-history'); await a.settle();
  await atEverySize('history', 'Clicked "History": each skill’s entries in words, each with its own Undo, Turn it on, Turn it on in Codex, Restore or Use … copy where one can still be done, all in the actions column', true);
  await openKind(a, 'skills');
  if (existsSync(claudeSettings)) writeFileSync(claudeSettings, settingsBefore);
}

// ---------- Sync, notices and History ----------
if (wanted('sync')) {
  begin('sync');
  await openKind(a, 'skills');
  await turnOnRow('skills', 'standup');
  edit(join(practice, '.codex/skills/standup/SKILL.md'), text => text.replace(/\n*$/, '\nEdited in Codex.\n'));
  await noticeFor('standup');
  await shot(a, 'edit-spread-notice', 'Outside the app, a line was added to standup\'s SKILL.md in Codex. A few seconds later, without clicking anything: the notice, counted by Notices in the header.');
  await a.click('#nav-history'); await shot(a, 'history-with-edit', 'Clicked "History".');
  const undo = await a.run(`document.querySelector('.history-row button[id^="history-"]')?.id ?? ''`);
  if (undo) { await a.click(`#${undo}`); await shot(a, 'history-undone', 'Clicked "Undo" on that edit.'); }
  await openKind(a, 'skills');
  await a.click('#sync-switch'); await shot(a, 'sync-off', 'Turned the Sync switch (status bar, bottom) off.');
  edit(join(practice, '.claude/skills/notes/SKILL.md'), text => text.replace(/\n*$/, '\nEdited with Sync off.\n'));
  await wait(4000); await a.settle(); await shot(a, 'sync-off-pending', 'With Sync off, a line was added to notes in Claude Code. A few seconds later.');
  if (await a.has('#sync-now')) { await a.click('#sync-now'); await shot(a, 'sync-now', 'Clicked "Sync now".'); }
  await a.click('#sync-switch');
  rmSync(join(practice, '.copilot/skills/standup'), { recursive: true, force: true });
  await noticeFor('standup');
  await openNotices();
  await waitFor(a, `[...document.querySelectorAll('#notices-card .sync-notice')].some(e => /deleted/.test(e.textContent))`, 10000);
  await shot(a, 'deletion-notice', 'Sync back on. Outside the app, the standup folder was deleted in Copilot. A few seconds later, Notices opened: the card.');
  const restore = await a.run(`document.querySelector('#notices-card [id^="notice-restore-"]')?.id ?? ''`);
  if (restore) { await a.click(`#${restore}`); await shot(a, 'restored', 'Clicked "Turn it on" in the notice.'); }
  await closeNotices();
}

// ---------- MCP servers ----------
// MCP servers are on Central Knot's library, as skills and agents are (src/servers.ts): every new state of a server's row, at
// four sizes. Claude Code's settings file is written in the same pass as every tool's.
if (wanted('mcp')) {
  begin('mcp');
  const settings = { claude: join(practice, '.claude.json'), copilot: join(practice, '.copilot/mcp-config.json'), codex: join(practice, '.codex/config.toml'), copilotSwitches: join(practice, '.copilot/settings.json') };
  // A server that belongs to an app (ChatGPT desktop's own): seen, never taken in.
  edit(settings.codex, text => `${text}\n[mcp_servers.node_repl]\ncommand = "/Applications/ChatGPT.app/Contents/Resources/node"\nargs = ["repl"]\n`);
  await openKind(a, 'mcp'); await refresh();
  await atEverySize('found', 'Clicked "MCP servers". Every server is found: docs in Claude Code, files in Copilot CLI and Codex, each with Add; node_repl belongs to ChatGPT desktop, so its Add is unavailable and its tag says it can’t be taken in', true);
  await openRow('mcp', 'node_repl');
  await atEverySize('cannot-take-in', 'Opened node_repl: "Not in Central Knot · it can’t be taken in now (see below)", and Codex’s line says why: ChatGPT desktop keeps this server for itself', false, '.details');
  await closeRow('mcp', 'node_repl');
  await openRow('mcp', 'files');
  await atEverySize('found-open', 'Opened files while found: what every tool shares of a server and what stays each tool’s own, each tool’s line with its settings file, and Add', true, '.details');
  await closeRow('mcp', 'files');
  // Taken in: every tool gets it at once, Claude Code too.
  await a.click(`#${rowPart('add', 'mcp', 'docs')}`); await switchOn('mcp', 'docs');
  await a.click(`#${rowPart('add', 'mcp', 'files')}`); await switchOn('mcp', 'files');
  await atEverySize('taken-in', 'Clicked Add on docs, then on files: files is in Central Knot, on in all 3 tools, Claude Code too; the result says so, and no band asks for a later step', true);
  await shot(a, 'claude-hover', 'The pointer on files’s Claude Code mark: its tooltip says Claude Code has the current version.', await middleOf(`#${rowPart('cell', 'mcp', 'files', 'claude-cli')}`));
  await openRow('mcp', 'files');
  await atEverySize('taken-in-open', 'Opened files: every tool’s line, Claude Code’s too, has the current version and its switch says On; Codex’s own setting named after its line', false, '.details');
  await closeRow('mcp', 'files');
  // Off: out of every tool at once, Claude Code too. Then Delete from Central Knot.
  await a.click(`#${rowPart('switch', 'mcp', 'files')}`); await a.settle();
  await atEverySize('off', 'Turned files off: it left every tool at once, Claude Code too; its row stays where it was, drawn Off, until he leaves the list or clicks Refresh', true);
  await openRow('mcp', 'files');
  await atEverySize('off-open', 'Opened the Off row: "Off · in Central Knot only."; each tool’s line says it has no copy while it is off', false, '.details');
  await a.click(`#${rowPart('delete', 'mcp', 'files')}`); await a.click(`#${rowPart('delete-confirm', 'mcp', 'files')}`); await a.settle();
  await atEverySize('deleted', 'Then Delete from Central Knot: files leaves the page; History can restore it', true);
  // A tool's own switch, set in its settings: read, never written; its line says Central Knot leaves it as it is.
  const switchesBefore = existsSync(settings.copilotSwitches) ? readFileSync(settings.copilotSwitches, 'utf8') : '{}';
  writeFileSync(settings.copilotSwitches, JSON.stringify({ ...JSON.parse(switchesBefore), disabledMcpServers: ['docs'] }, null, 2));
  await refresh();
  await openRow('mcp', 'docs');
  await atEverySize('switched-off', 'Outside the app, Copilot CLI’s settings turned docs off, then Refresh: its own mark, a partial switch, "switched off in Copilot CLI"; its line says Central Knot leaves that switch as it is, so it stays off after Off and On; "Switched off" in place of its switch', true, '.details');
  writeFileSync(settings.copilotSwitches, switchesBefore); await refresh();
  // Kept out of one tool by its switch in the opened row.
  await openRow('mcp', 'docs');
  await a.click(`#${rowPart('enable', 'mcp', 'docs', 'codex-cli')}`); await a.settle();
  await atEverySize('kept-out', 'Turned docs off in Codex alone, in its opened row: its entry left Codex; the row says "in 2 of 3 tools · kept out of Codex" and its switch is drawn partial', true, `.ov-row[data-key="${rowPart('', 'mcp', 'docs')}"]`);
  await a.click(`#${rowPart('enable', 'mcp', 'docs', 'codex-cli')}`); await a.settle();
  await closeRow('mcp', 'docs');
  // An edit made in a tool becomes the current version; its versions list says where each came from, and Read shows one.
  edit(settings.codex, text => text.replace('url = "https://docs.example.test/mcp"', 'url = "https://docs.example.test/mcp/v2"'));
  await refresh();
  await noticeFor('docs');
  await atEverySize('edit-notice', 'Outside the app, docs’s URL was edited in Codex, then Refresh: the header says, as an automatic change, that the edit is the current version, in Copilot CLI and Claude Code too');
  await openNotices();
  await atEverySize('edit-notice-card', 'Opened Notices: the card, where the notice offers Undo and History');
  await closeNotices();
  await openRow('mcp', 'docs');
  await atEverySize('versions', 'Opened docs: its versions, edited in Codex (current) and found in Claude Code, each with what changed ("URL changed")', true, '.version-row');
  await a.click(`#${rowPart('version-read', 'mcp', 'docs', '1')}`);
  await waitFor(a, `!!document.querySelector('.version-read')`);
  await atEverySize('version-read', 'Clicked Read on the version found in Claude Code: what it runs, part by part, what differs from the current version marked', false, '.version-read');
  await a.click(`#${rowPart('version-read', 'mcp', 'docs', '1')}`);
  await closeRow('mcp', 'docs');
  // What `codex mcp remove docs` leaves: docs turns off, its entry leaving every tool; Central Knot keeps it, and the notice offers Turn it on.
  edit(settings.codex, text => text.replace(/\n?\[mcp_servers\.docs\][^[]*/, '\n'));
  await refresh(); await wait(2300); await refresh();
  await noticeFor('docs');
  await openNotices();
  await atEverySize('deleted-by-hand', 'Outside the app, docs was removed from Codex’s settings (as `codex mcp remove docs` does), then Refresh past the settle window: it is off and taken out of Copilot CLI and Claude Code, kept in Central Knot; opened, Notices’ card says so and offers Turn it on', true);
  const restore = await a.run(`document.querySelector('#notices-card [id^="notice-restore-"]')?.id ?? ''`);
  if (restore) { await a.click(`#${restore}`); await a.settle(); }
  await closeNotices();
  // A server a tool can't hold (SSE, in Codex), and a server whose copies differ (the copy question).
  edit(settings.claude, text => { const config = JSON.parse(text); config.mcpServers.live = { type: 'sse', url: 'https://live.example.test/sse' }; return JSON.stringify(config, null, 2); });
  edit(settings.copilot, text => { const config = JSON.parse(text); config.mcpServers.search = { type: 'local', command: 'search-mcp', args: ['--index', 'copilot'], tools: ['*'] }; return JSON.stringify(config, null, 2); });
  edit(settings.codex, text => `${text}\n[mcp_servers.search]\ncommand = "search-mcp"\nargs = ["--index", "codex", "--fast"]\n`);
  await refresh();
  await a.click(`#${rowPart('add', 'mcp', 'live')}`); await switchOn('mcp', 'live');
  await openRow('mcp', 'live');
  await atEverySize('cannot-hold', 'Added live, an SSE server from Claude Code: Copilot CLI has it now; Codex can’t take it (its own mark, "Codex has no SSE transport."), and the status says so', false, '.details');
  await closeRow('mcp', 'live');
  await a.click(`#${rowPart('add', 'mcp', 'search')}`); await a.settle();
  await atEverySize('copy-question', 'Clicked search’s Add: Copilot CLI’s and Codex’s entries differ, so the row asks which one every tool uses, each row quoting its own command with the words only it has marked, and what choosing does in each tool', true, '.details-differs');
  await a.click(`#${rowPart('use', 'mcp', 'search', 'copilot-cli')}`); await switchOn('mcp', 'search');
  await atEverySize('chosen', 'Clicked "Use this copy" on Copilot CLI’s: search is in Central Knot, on in all 3 tools; Codex’s entry is kept as a version', false, '.bands');
  await a.click('#nav-history');
  await atEverySize('history', 'History: each server’s entries in the library’s words, with what each still offers (Turn it on, Restore, Undo, Use Codex’s copy)', true);
}

// ---------- Agents ----------
// Central Knot holds each agent itself, with its versions (src/library.ts). Every state of an agent's row, at four sizes.
if (wanted('agents')) {
  begin('agents');
  const agentsFolder = { claude: '.claude/agents', copilot: '.copilot/agents', codex: '.codex/agents' };
  const reviewer = tool => join(practice, { claude: '.claude/agents/code-reviewer.md', copilot: '.copilot/agents/code-reviewer.agent.md', codex: '.codex/agents/code-reviewer.toml' }[tool]);
  const claudeFile = (name, description, prompt) => writeFileSync(join(practice, agentsFolder.claude, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${prompt}`);
  /** Marks a file as saved `seconds` from now, so "latest" can tell edits made in the same second apart. */
  const savedIn = (path, seconds) => { const when = new Date(Date.now() + seconds * 1000); utimesSync(path, when, when); };

  await openKind(a, 'agents');
  await atEverySize('agents-found', 'Clicked "Agents". Both agents are found: a tool has them and Central Knot doesn’t yet, so each row has Add where an On row has its switch; the section line says what Add does');
  await shot(a, 'agents-found-hover', 'The pointer on code-reviewer’s Add: the row lights up; Add’s tooltip says a click adds it to Central Knot and puts it in every tool.', await middleOf(`#${rowPart('add', 'agents', 'code-reviewer')}`));
  await focusOn(`#${rowPart('add', 'agents', 'code-reviewer')}`);
  await shot(a, 'agents-found-focus', 'Keyboard focus on code-reviewer’s Add: its focus ring.');
  await a.run('document.activeElement?.blur()');
  await openRow('agents', 'code-reviewer');
  await atEverySize('agents-found-open', 'Opened code-reviewer while it is found: its status says where it is and what Add does; its whole description shows; each tool says what it has', true);
  await closeRow('agents', 'code-reviewer');
  for (const key of ['code-reviewer', 'release-notes']) { await a.click(`#${rowPart('add', 'agents', key)}`); await switchOn('agents', key); }
  await shot(a, 'agents-on', 'Clicked both Adds: each agent is taken into Central Knot and on in all 3 tools. The result says so.');

  // Off: out of every harness, kept in Central Knot. On puts each file back.
  await a.click(`#${rowPart('switch', 'agents', 'code-reviewer')}`); await a.settle();
  await atEverySize('agents-off', 'Turned code-reviewer off: it left every tool; its row stays where it was, drawn Off, "in Central Knot only", with its description, until he leaves the list or clicks Refresh; the result offers Undo', true);
  await openRow('agents', 'code-reviewer');
  await atEverySize('agents-off-open', 'Opened the Off row: its status, its whole description, each tool with no copy while it is off, its versions, and Delete from Central Knot as a quiet button with how it differs from Off', true);
  await a.click(`#${rowPart('switch', 'agents', 'code-reviewer')}`); await switchOn('agents', 'code-reviewer');
  await shot(a, 'agents-on-again', 'Clicked its switch again: on in all 3 tools, each file as it was.');

  // The opened row of an agent that is On: each harness's line and switch, what stays its own, and one version.
  await openRow('agents', 'code-reviewer');
  await atEverySize('agents-open', 'Opened code-reviewer, on: its whole description at the top; each tool has the current version and its own switch; Claude Code’s line names the settings that stay in its file; one version, its first');

  // Edits made in a harness: each becomes the current version. Several make the versions list long enough to fold.
  edit(reviewer('codex'), text => text.replace('description = "', 'description = "Checks tests too. '));
  await a.click('#header-refresh'); await noticeFor('code-reviewer');
  await openNotices();
  await shot(a, 'agents-edit-notice', 'Outside the app, code-reviewer was edited in Codex, then Refresh was clicked; Notices opened: the notice says the edit is its current version now, in the other tools too, with Undo.');
  await closeNotices();
  for (const [tool, change] of [['claude', text => text.replace(/(description: )/, '$1Names risky changes. ')], ['copilot', text => text.replace('Keep it short.', 'Keep it short. Ask for tests.')],
    ['codex', text => text.replace(/(description = ")/, '$1Keeps comments short. ')], ['claude', text => text.replace(/^(name: )code-reviewer$/m, '$1code-reviewer').replace('Read the change', 'Read the whole change')]]) {
    edit(reviewer(tool), change);
    await refresh(); await wait(1100);
  }
  await openRow('agents', 'code-reviewer');
  await atEverySize('agents-versions-folded', 'Four more edits, in Claude Code, Copilot CLI and Codex: the versions list shows its newest four, the current one first, each with its time (every row in one form), where it was edited and what changed, and one line for the earlier ones');
  await a.click(`#${rowPart('versions-all', 'agents', 'code-reviewer')}`); await a.settle();
  await atEverySize('agents-versions-all', 'Clicked "Show 2 earlier versions": every version, the current one first, then in the order Central Knot took them', true);
  await shot(a, 'agents-version-hover', 'The pointer on the second version’s Make current: a quiet outlined button, apart from Read.', await middleOf(`#${rowPart('version-current', 'agents', 'code-reviewer', '1')}`));
  await focusOn(`#${rowPart('version-current', 'agents', 'code-reviewer', '1')}`);
  await shot(a, 'agents-version-focus', 'Keyboard focus on that Make current: its focus ring.');
  await a.run('document.activeElement?.blur()');
  await a.click(`#${rowPart('version-read', 'agents', 'code-reviewer', '2')}`); await waitFor(a, `/careful code reviewer/.test(document.querySelector('.version-read')?.textContent ?? '')`, 15000);
  await atEverySize('agents-version-read', 'Clicked Read on an earlier version: its description and prompt open under its line, upright, headed by what differs from the current version ("Differs from current in: …"), each difference marked', false, '.version-read');
  await a.click(`#${rowPart('version-read', 'agents', 'code-reviewer', '2')}`); await a.settle();
  await a.click(`#${rowPart('version-current', 'agents', 'code-reviewer', '5')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await atEverySize('agents-made-current', 'Clicked Make current on the first version: it is the new current version, first, "back to:" the version it went back to (folded into its row), written to all 3 tools; the result names it and offers Undo');

  // One harness kept out: the closed row says so too.
  await a.click(`#${rowPart('enable', 'agents', 'code-reviewer', 'codex-cli')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await atEverySize('agents-kept-out', 'Turned Codex’s own switch off: code-reviewer is kept out of Codex (its copy there is gone, its mark struck through, "not in Codex" beside its name) and stays on in the others', true);
  await a.click(`#${rowPart('version-current', 'agents', 'code-reviewer', '1')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await shot(a, 'agents-made-current-kept-out', 'With Codex kept out, clicked Make current on an earlier version: written to Claude Code and Copilot CLI; Codex stays out, and the result names only those two.');
  // Off while kept out of one tool, then On: Codex stays out.
  await a.click(`#${rowPart('switch', 'agents', 'code-reviewer')}`); await a.settle();
  await openRow('agents', 'code-reviewer');
  await shot(a, 'agents-off-kept-out', 'Turned code-reviewer off while it is kept out of Codex: it is in Central Knot only, its versions still offered.');
  await a.click(`#${rowPart('version-current', 'agents', 'code-reviewer', '1')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await shot(a, 'agents-made-current-off', 'While it is off, clicked Make current: the version is current in Central Knot, and no tool is written; the result says so.');
  await a.click(`#${rowPart('switch', 'agents', 'code-reviewer')}`); await switchOn('agents', 'code-reviewer');
  await openRow('agents', 'code-reviewer');
  await shot(a, 'agents-on-kept-out', 'Turned it on again: on in Claude Code and Copilot CLI, still kept out of Codex.');
  await a.click(`#${rowPart('enable', 'agents', 'code-reviewer', 'codex-cli')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);

  // A harness whose edit waits: with Automatic sync off, an edit shows as becoming the current version at the next sync.
  await a.click('#sync-switch'); await a.settle();
  edit(reviewer('copilot'), text => text.replace('description: ', 'description: Edited while sync is off. '));
  await refresh();
  await openRow('agents', 'code-reviewer');
  await atEverySize('agents-edit-waits', 'Turned Automatic sync off, edited code-reviewer in Copilot CLI, clicked Refresh: Copilot CLI’s mark and line say its edit becomes the current version when sync runs; the toolbar counts it');
  await a.click('#sync-switch'); await a.settle(); await refresh();

  // Many versions, unfolded.
  for (let count = 1; count <= 7; count++) { edit(reviewer(['claude', 'copilot', 'codex'][count % 3]), text => text.replace('Keep it short.', `Keep it short (${count}).`).replace(/Keep it short \(\d+\)\./, `Keep it short (${count}).`)); await refresh(); await wait(1100); }
  await openRow('agents', 'code-reviewer');
  if (await a.has(`#${rowPart('versions-all', 'agents', 'code-reviewer')}`)) { await a.click(`#${rowPart('versions-all', 'agents', 'code-reviewer')}`); await a.settle(); }
  await atEverySize('agents-versions-many', 'Seven more edits: every version unfolded, each on one line where there is room, the times reading apart', false, '.versions');
  await closeRow('agents', 'code-reviewer');

  // A harness that can't hold it: a name it can't store.
  writeFileSync(join(practice, '.claude/agents/réviseur.md'), '---\nname: réviseur\ndescription: Relit un changement avant sa fusion.\n---\n\nRelis le changement.\n');
  await refresh();
  await a.click(`#${rowPart('add', 'agents', 'réviseur')}`); await a.settle();
  await openRow('agents', 'réviseur');
  await atEverySize('agents-cannot', 'An agent in Claude Code whose name Copilot CLI and Codex can’t store, turned on: its status says "On in Claude Code only", and each other tool’s line names the character and what to do');
  await closeRow('agents', 'réviseur');

  // A long name and a long prompt.
  const long = 'reviews-database-migrations-before-they-reach-production-and-checks-rollbacks';
  claudeFile(long, 'Reads every migration in a change, checks that each one can be rolled back, that it locks no large table for long, and that the code shipped with it works before and after it runs.',
    Array.from({ length: 40 }, (_, line) => `${line + 1}. Check the migration’s step ${line + 1}: what it changes, what it locks, how long it runs on the largest table, and how it is rolled back.`).join('\n') + '\n');
  await refresh();
  await a.click(`#${rowPart('add', 'agents', long)}`); await switchOn('agents', long);
  await atEverySize('agents-long-name', 'An agent with a long name and description, on: the row shortens the description first, and the name at a word', false, `.ov-row[data-key="${rowPart('', 'agents', long)}"]`);
  await openRow('agents', long);
  await a.click(`#${rowPart('version-read', 'agents', long, '0')}`); await waitFor(a, `!!document.querySelector('.version-read pre')`, 15000);
  await atEverySize('agents-long-read', 'Opened it and clicked "Read current": a 40-line prompt reads in its box, which scrolls, upright', false, '.version-read');
  await closeRow('agents', long);

  // Found copies that differ, in three tools: the copy question, each copy's edit time, the newest marked; the others become versions.
  writeFileSync(join(practice, '.claude/agents/changelog.md'), '---\nname: changelog\ndescription: Keeps the changelog.\n---\n\nKeep the changelog short.\nOne line each.\n');
  writeFileSync(join(practice, '.copilot/agents/changelog.agent.md'), '---\nname: changelog\ndescription: Keeps the changelog.\n---\n\nKeep the changelog short.\nOne line each. Name the author.\n');
  writeFileSync(join(practice, '.codex/agents/changelog.toml'), 'name = "changelog"\ndescription = "Keeps the changelog."\ndeveloper_instructions = """\nKeep the changelog short.\nOne line each. Link the pull request.\n"""\n');
  savedIn(join(practice, '.claude/agents/changelog.md'), -600); savedIn(join(practice, '.copilot/agents/changelog.agent.md'), -120);
  await refresh();
  await a.click(`#${rowPart('add', 'agents', 'changelog')}`); await a.settle();
  await atEverySize('agents-choice', 'A found agent whose copies differ in all three tools, its Add clicked: it asks which copy every tool uses; each copy says when it was edited, the newest is marked and its button is the main one', true);
  await a.click(`#${rowPart('use', 'agents', 'changelog', 'codex-cli')}`); await switchOn('agents', 'changelog');
  await openRow('agents', 'changelog');
  await atEverySize('agents-choice-made', 'Chose Codex’s copy: changelog is in Central Knot with it, on in all 3 tools; the current version is listed first, the other copies after it, each with Make current');

  // Delete from Central Knot, and History's Restore.
  await a.click(`#${rowPart('delete', 'agents', 'changelog')}`); await a.settle();
  await atEverySize('agents-delete-armed', 'Clicked "Delete from Central Knot…": it asks once more, with Cancel beside it, and says History keeps it, with its versions, for 30 days', true, `#${rowPart('delete-note', 'agents', 'changelog')}`);
  await a.click(`#${rowPart('delete-confirm', 'agents', 'changelog')}`); await a.settle();
  await shot(a, 'agents-deleted', 'Clicked "Delete it now": changelog left every tool and this page; the result offers Undo.');
  await a.click('#nav-history'); await a.settle();
  await atEverySize('agents-history', 'History: each click and each edit taken in, in the library’s words, with its action: Restore on the deletion, Undo on the latest change, "Go back before this" on older ones (the full sentence its tooltip), Turn it off or Turn it on on a switch', true);
  await a.run(`[...document.querySelectorAll('.history-row[data-kind="deleted"]')].find(row => row.textContent.includes('changelog'))?.querySelector('.history-actions button')?.click()`);
  await waitFor(a, `/Restored/.test(document.querySelector('#history-scroll')?.textContent ?? '')`, 15000);
  await atEverySize('agents-history-restored', 'Clicked Restore on the deletion: changelog is back in Central Knot and in every tool; the deletion’s row reads Restored');

  // Many agents: On, Off and Found together.
  for (let count = 1; count <= 14; count++) claudeFile(`helper-${String(count).padStart(2, '0')}`, `Helps with task ${count}. Reads the request, plans it, and reports what changed.`, `Do task ${count} carefully.\n`);
  await openKind(a, 'agents'); await refresh();
  await waitFor(a, `!!document.querySelector('#${rowPart('add', 'agents', 'helper-14')}')`, 20000);
  for (let count = 1; count <= 8; count++) { const helper = `helper-${String(count).padStart(2, '0')}`; await a.click(`#${rowPart('add', 'agents', helper)}`); await switchOn('agents', helper); }
  for (const count of [2, 5, 7]) { await a.click(`#${rowPart('switch', 'agents', `helper-0${count}`)}`); await a.settle(); }
  await atEverySize('agents-many', 'Fourteen more agents: some on, three off, six found; the three sections, each with its count and line');
  await a.run(`document.querySelector('.legend')?.scrollIntoView({ block: 'end' })`);
  await shot(a, 'agents-legend', 'The key at the end of the list: "Kept out", "Off: Central Knot keeps it", "Can’t take it" among the marks this page uses.');

  // States added in round 3, after the earlier pictures so their numbers stay. The long name heads its opened panel.
  await openRow('agents', long);
  if (await a.has('.version-read')) { await a.click(`#${rowPart('version-read', 'agents', long, '0')}`); await a.settle(); }
  await atEverySize('agents-long-name-open', 'Opened the agent with the long name: the panel’s header holds it, and the list beside it cuts it before any description goes', false, '.details');
  await closeRow('agents', long);

  // Two copies that differ: the copy question marks the newer one "Newer".
  writeFileSync(join(practice, '.claude/agents/triage.md'), '---\nname: triage\ndescription: Sorts new issues.\n---\n\nLabel each issue.\n');
  writeFileSync(join(practice, '.copilot/agents/triage.agent.md'), '---\nname: triage\ndescription: Sorts new issues.\n---\n\nLabel each issue. Close duplicates.\n');
  savedIn(join(practice, '.claude/agents/triage.md'), -300);
  await refresh();
  await a.click(`#${rowPart('add', 'agents', 'triage')}`); await a.settle(); await show(`#${rowPart('use', 'agents', 'triage', 'claude-cli')}`);
  await shot(a, 'agents-choice-two', 'A found agent whose copies differ in two tools, its Add clicked: the newer copy is marked "Newer" and its button is the main one.');
  await a.click(`#${rowPart('use', 'agents', 'triage', 'copilot-cli')}`); await switchOn('agents', 'triage');

  // Thirty versions: each edit adds a line.
  const steps = count => Array.from({ length: count }, (_, step) => `Step ${step + 1}: say what changed since yesterday.`).join('\n') + '\n';
  claudeFile('standup', 'Writes the daily standup.', steps(1));
  await refresh();
  await a.click(`#${rowPart('add', 'agents', 'standup')}`); await switchOn('agents', 'standup');
  // A second apart, as a person's edits are, so no two read the same time.
  for (let count = 2; count <= 30; count++) { claudeFile('standup', 'Writes the daily standup.', steps(count)); await refresh(); await wait(1000); }
  await openRow('agents', 'standup');
  await shot(a, 'agents-versions-thirty-folded', 'Twenty-nine edits in Claude Code, each adding a line: thirty versions, the newest four shown and one line for the other twenty-six.');
  await a.click(`#${rowPart('versions-all', 'agents', 'standup')}`); await a.settle();
  await atEverySize('agents-versions-thirty', 'Clicked "Show 26 earlier versions": all thirty, one line each, every time in one form', false, '.versions');
  // Read on a version that has words the current one lacks: they are tinted.
  await a.click(`#${rowPart('version-current', 'agents', 'standup', '25')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await a.click(`#${rowPart('version-read', 'agents', 'standup', '1')}`); await waitFor(a, `!!document.querySelector('.version-read .change-added')`, 15000);
  await atEverySize('agents-version-read-adds', 'Made the fifth version current, then clicked Read on the one that was current before: the lines it has and the current one lacks are tinted; the header says what differs', false, '.version-read');
  await a.click(`#${rowPart('version-read', 'agents', 'standup', '1')}`); await a.settle();

  // Undo of a Make current while the agent is kept out of a tool: that tool stays out.
  await a.click(`#${rowPart('enable', 'agents', 'standup', 'codex-cli')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await a.click(`#${rowPart('version-current', 'agents', 'standup', '2')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await a.click('#outcome-undo'); await a.settle(); await show('.details-tool-line');
  await shot(a, 'agents-made-current-kept-out-undone', 'Kept standup out of Codex, clicked Make current on an earlier version, then Undo: the version before is current again in Claude Code and Copilot CLI; Codex stays out.');
  await a.click(`#${rowPart('enable', 'agents', 'standup', 'codex-cli')}`); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);

  // A tool whose agents folder can't be written: its line says so, and the next pass writes it once it can.
  chmodSync(join(practice, agentsFolder.codex), 0o555);
  claudeFile('standup', 'Writes the daily standup.', steps(31));
  await refresh(); await openRow('agents', 'standup');
  await atEverySize('agents-folder-locked', 'Codex’s agents folder made read-only, then standup edited in Claude Code: Copilot CLI gets the edit; Codex’s line says Central Knot can’t write in its agents folder', false, '.details-tool-line');
  chmodSync(join(practice, agentsFolder.codex), 0o755);
  await refresh();
  await closeRow('agents', 'standup');

  // A version pulled from the Git repo, over a copy found here that differs.
  const remote = join(scratch, 'agents-remote.git'), author = join(scratch, 'agents-author');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', ...args], { stdio: 'ignore' });
  mkdirSync(remote, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  execFileSync('git', ['clone', '--quiet', remote, author], { stdio: 'ignore' });
  mkdirSync(join(author, 'agents'), { recursive: true });
  writeFileSync(join(author, 'agents/retro.md'), '---\nname: retro\ndescription: Runs the team retro.\n---\n\nAsk what went well, what didn’t, and what to try next.\n');
  git(author, 'add', '-A'); git(author, 'commit', '--quiet', '-m', 'Retro agent'); git(author, 'push', '--quiet', 'origin', 'HEAD:main');
  claudeFile('retro', 'Runs the team retro.', 'Ask what went well.\n');
  await a.click('#nav-repo'); await a.settle();
  await a.run(`(() => { const input = document.querySelector('#repo-url'); input.value = ${JSON.stringify(remote)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#repo-connect');
  await waitFor(a, `!!document.querySelector('#repo-state') && !/Checking/.test(document.querySelector('#repo-state').textContent)`, 20000); await a.settle();
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  await openKind(a, 'agents'); await a.settle();
  await openRow('agents', 'retro');
  await atEverySize('agents-pulled', 'Connected a Git repo with a retro agent, while Claude Code had a different retro of its own, and clicked Pull: retro is on, pulled from the Git repo; Claude Code’s copy is kept as a version, noted against the pulled one', false, '.versions');
  await closeRow('agents', 'retro');

  // Restore when an agent of that name exists again.
  await openRow('agents', 'triage');
  await a.click(`#${rowPart('delete', 'agents', 'triage')}`); await a.settle();
  await a.click(`#${rowPart('delete-confirm', 'agents', 'triage')}`); await a.settle();
  writeFileSync(join(practice, '.claude/agents/triage.md'), '---\nname: triage\ndescription: Sorts new issues by hand.\n---\n\nA new triage, made after the old one was deleted.\n');
  await refresh();
  await a.click('#nav-history'); await a.settle();
  await shot(a, 'agents-restore-name-taken-history', 'Deleted triage from Central Knot, then a new triage was made in Claude Code: History still offers Restore on the deletion.');
  await a.run(`[...document.querySelectorAll('.history-row[data-kind="deleted"]')].find(row => row.textContent.includes('triage'))?.querySelector('.history-actions button')?.click()`);
  await a.settle();
  await shot(a, 'agents-restore-name-taken', 'Clicked Restore: the old triage is back in Central Knot and every tool; the new copy found in Claude Code is kept as a version first.');
  await openKind(a, 'agents'); await a.settle(); await openRow('agents', 'triage'); await show('.versions');
  await shot(a, 'agents-restore-name-taken-open', 'Opened triage after Restore: its versions, the new copy from Claude Code among them, each with Make current.');

  // No agents at all: a fresh Practice copy with its agents' files removed.
  await fresh();
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  for (const folder of Object.values(agentsFolder)) rmSync(join(practice, folder), { recursive: true, force: true });
  await openKind(a, 'agents'); await refresh();
  await atEverySize('agents-none', 'A Practice copy whose tools have no agents: the Library’s agents says so and what to do');
}

// ---------- An agent in Pi, as a skill ----------
// Pi holds no agents of its own: an agent that is On is a skill there (src/presence.ts agentsKeptIn). Its opened row, Pi held by
// a skill of the agent's name, and Pi's Agents and About tabs on Harnesses, at four sizes.
if (wanted('agents-pi')) {
  begin('agents-pi');
  await fresh();
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  // Pi joins the Practice copy, with a skill of its own named like the release-notes agent.
  mkdirSync(join(practice, '.pi/agent/skills/release-notes'), { recursive: true });
  writeFileSync(join(practice, '.pi/agent/skills/release-notes/SKILL.md'), '---\nname: release-notes\ndescription: Pi’s own skill for release notes.\n---\n\nWrite the release notes.\n');
  await openKind(a, 'agents'); await refresh();
  for (const key of ['code-reviewer', 'release-notes']) { await turnOnRow('agents', key); await switchOn('agents', key); }
  await openRow('agents', 'code-reviewer');
  await atEverySize('agents-pi-open', 'Pi in the home, code-reviewer added: Pi has the current version (a skill, code-reviewer.md in its skills folder) with its own switch, and a note under the tools says once what Pi gets: no isolated context, tool restrictions or model selection, invoked as a skill; deleting the file in Pi turns the agent off everywhere', true, `#${rowPart('as-skill', 'agents', 'code-reviewer')}`);
  await closeRow('agents', 'code-reviewer');
  await openRow('agents', 'release-notes');
  await atEverySize('agents-pi-held', 'release-notes added while Pi has a skill of its own named release-notes: nothing is written in Pi, and Pi’s line says why and how to use the agent there (delete or rename that skill)', true, '.details');
  await closeRow('agents', 'release-notes');
  await a.click('#nav-harnesses'); await a.click('#harness-pi-cli'); await a.click('#harness-tab-agents'); await a.settle();
  await atEverySize('agents-pi-harness', 'Harnesses › Pi › Agents: the same rows with Pi first, code-reviewer current there and release-notes held', true);
  await a.click('#harness-tab-about'); await a.settle();
  await atEverySize('agents-pi-about', 'Harnesses › Pi › About: under Files and folders, Agents says they are in its skills folder, each as a skill');
}

// ---------- Plugins ----------
if (wanted('plugins')) {
  begin('plugins');
  const market = join(scratch, 'market');
  writeMarket(market);
  await a.click('#nav-plugins'); await shot(a, 'plugins-empty', 'Clicked "Plugin marketplaces" before adding a marketplace.');
  await addMarketplace(a, market); await shot(a, 'plugins-added', 'Typed a marketplace folder (a local copy of a team marketplace) into "Add a marketplace" and clicked Add.');
  await a.click('#market-tab-about'); await waitFor(a, `!!document.querySelector('.plugin-readme, .plugin-muted')`); await shot(a, 'plugins-about', 'Clicked the "About" tab.');
  await a.click('#market-tab-plugins');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-group')`); await shot(a, 'plugin-page', 'Clicked the "document-tools" row.');
  if (await a.has('#pswitch-page-0-document-tools:not([disabled])')) { await a.click('#pswitch-page-0-document-tools'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); await shot(a, 'plugins-applied', 'Turned document-tools on with its switch: each tool took it at once, by its own command, or as its parts where it can’t take the plugin.'); }
  await a.click('#plugin-back'); await shot(a, 'plugins-after', 'Clicked the back link to team-tools.');
  await a.click('#popen-0-issue-tracker'); await waitFor(a, `!!document.querySelector('.plugin-group')`); await shot(a, 'plugin-page-mcp', 'Opened "issue-tracker", which runs an MCP server.');
  await a.click('#plugin-back');
  await a.click('#popen-0-spark'); await waitFor(a, `!!document.querySelector('.plugin-group, .plugin-muted:not(:empty)') && !/Reading/.test(document.querySelector('.plugin-page')?.textContent ?? '')`, 60000); await shot(a, 'plugin-page-remote', 'Opened "spark", whose files live in GitHub’s copilot-plugins repository (read from there).');
  if (await a.has('#plugins-undo')) { await a.click('#plugins-undo'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); await shot(a, 'plugins-undone', 'Clicked "Undo" on the result of the switch.'); }
}

// ---------- A plugin's switch clicks waiting their turn ----------
// A folder with Claude Code only. Three plugins' switches clicked in a row while Claude Code's stand-in takes 8 s over
// issue-tracker's install: document-tools ends and is read back, issue-tracker runs, release-helper waits (Claude Code then
// refuses it). Then the ends, each plugin's own page, and an uninstall the stand-in is slow over.
if (wanted('plugin-clicks')) {
  // From fresh data: a marketplace an earlier section added would come first in the list and take these ids.
  await fresh();
  begin('plugin-clicks');
  const folder = join(scratch, 'clicks-home'), market = join(scratch, 'clicks-market'), slow = join(scratch, 'slow');
  mkdirSync(join(folder, '.claude/plugins'), { recursive: true });
  writeMarket(market);
  const versions = JSON.stringify({ 'document-tools': '1.2.0', 'issue-tracker': '2.0.0' }).replaceAll('"', "'");
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  writeFileSync(join(HOME, '.local/bin/claude'), `#!/bin/sh
[ "$1" = "--version" ] && echo "2.1.322 (Claude Code)" && exit 0
case "$*" in
  "plugin marketplace add "*) printf '{"team-tools":{"source":{"source":"directory","path":"${market}"},"installLocation":"${market}"}}' > "$HOME/.claude/plugins/known_marketplaces.json" ;;
  *release-helper*) echo 'Plugin "release-helper" not found in marketplace "team-tools".'; exit 1 ;;
  "plugin install "*|"plugin uninstall "*)
    case "$2 $3" in "install issue-tracker@team-tools"|"uninstall document-tools@team-tools") [ -f '${slow}' ] && sleep 8 ;; esac
    "${process.execPath}" -e "const fs = require('fs'), [verb, id] = process.argv.slice(1), file = process.env.HOME + '/.claude/plugins/installed_plugins.json'; let now = { version: 2, plugins: {} }; try { now = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} if (verb === 'install') now.plugins[id] = [{ scope: 'user', installPath: '${market}/plugins/' + id.split('@')[0], version: ${versions}[id.split('@')[0]] }]; else delete now.plugins[id]; fs.writeFileSync(file, JSON.stringify(now))" "$2" "$3" ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });
  a.quit();
  await wait(500);
  const settings = join(scratch, 'data/app-settings.json');
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: folder } }));
  a = await launch();
  await a.click('#nav-plugins');
  await addMarketplace(a, market);
  // Sized, and themed, without settling: the page acts until the list ends.
  const sizeNow = async (width, height) => { Object.assign(a.viewport, { width, height }); await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.run(`window.dispatchEvent(new Event('resize'))`); await wait(300); };
  const themeNow = async value => { await a.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }); await wait(300); };
  const rowIs = (name, state) => waitFor(a, `document.querySelector('[data-plugin="${name}"] .plugin-click')?.dataset.click === '${state}'`, 15000);
  const pageOf = async name => { await a.run(`document.querySelector('#plugin-back')?.click(); document.querySelector('#popen-0-${name}').click()`); await wait(400); };
  writeFileSync(slow, '');
  await a.run(`['document-tools', 'issue-tracker', 'release-helper'].forEach(name => document.querySelector('#pswitch-0-' + name).click())`);
  await rowIs('document-tools', 'ended'); await rowIs('issue-tracker', 'running');
  for (const [width, height] of SIZES) { await sizeNow(width, height); await shot(a, `running-${width}`, `Clicked three plugins’ switches in a row: document-tools ended and was read back (its switch On and free again, its mark ✓), issue-tracker says Turning on… (Claude Code’s stand-in is slow), release-helper says Waiting to turn on; only those two switches are held (${width}×${height})`); }
  await sizeNow(1280, 800);
  await themeNow('light'); await shot(a, 'running-light', 'The same, light: the held switches beside the free ones.'); await themeNow('dark');
  await pageOf('release-helper');
  await shot(a, 'waiting-page', 'Opened release-helper’s page meanwhile: its panel says Waiting to turn on, and its switch and boxes are held.');
  await a.run(`document.querySelector('#plugin-back').click()`);
  rmSync(slow);
  await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await atEverySize('ended', 'The list ran: each row says its own result in one line, release-helper’s that Claude Code didn’t install it (the problems band says why, whole). The status line says the whole list; there is no Undo, since the last click, release-helper’s, changed nothing', true);
  await pageOf('document-tools'); await a.settle();
  await shot(a, 'ended-page', 'document-tools’ own page after its click: its panel says Installed in Claude Code.');
  await pageOf('release-helper'); await a.settle();
  await shot(a, 'failed-page', 'release-helper’s own page after its click: its panel says why Claude Code refused it, starting with the tool.');
  await a.click('#plugin-back');
  writeFileSync(slow, '');
  await a.run(`document.querySelector('#pswitch-0-document-tools').click()`);
  await rowIs('document-tools', 'running');
  await shot(a, 'uninstalling', 'Turned document-tools off: its row says Turning off… while Claude Code’s stand-in takes its time; the earlier list’s rows are gone, as a new list starts.');
  rmSync(slow);
  await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  // A tool's box on a plugin's page joins the same list: ticked while issue-tracker's install runs, it waits its turn, then runs.
  await a.run(`document.querySelector('#pswitch-0-issue-tracker').click()`);
  await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  writeFileSync(slow, '');
  await a.run(`document.querySelector('#pswitch-0-issue-tracker').click()`);
  await rowIs('issue-tracker', 'running');
  await pageOf('document-tools');
  await a.run(`document.querySelector('#pbox-0-document-tools-claude-cli').click()`);
  const panelIs = state => waitFor(a, `document.querySelector('.plugin-panel .plugin-click')?.dataset.click === '${state}'`, 30000);
  await panelIs('waiting');
  for (const [width, height] of [[1280, 800], [860, 560]]) { await sizeNow(width, height); await shot(a, `box-waiting-${width}`, `At ${width}×${height}: document-tools is Off; ticked Claude Code’s box on its page while issue-tracker’s install runs: the panel says Waiting to turn on in Claude Code, and the box and the switch are held.`); }
  await sizeNow(1280, 800);
  await panelIs('ended'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await shot(a, 'box-ticked', 'Its turn came: document-tools is On in Claude Code, the one tool in this folder, its box ticked, and the panel says Installed in Claude Code.');
  await a.run(`document.querySelector('#pbox-0-document-tools-claude-cli').click()`);
  await panelIs('running');
  for (const [width, height] of [[1280, 800], [860, 560]]) { await sizeNow(width, height); await shot(a, `box-running-${width}`, `At ${width}×${height}: unticked Claude Code’s box: the panel says Turning off in Claude Code… while the stand-in takes its time, and the box shows it working.`); }
  await sizeNow(1280, 800);
  rmSync(slow);
  await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle();
  await shot(a, 'box-unticked', 'It ended: the box is empty, and the panel says Turned off in Claude Code, with Undo.');
  // The sections after this one start from the Practice copy.
  await fresh();
}

// ---------- A tool's box on a plugin's page, with three working tools ----------
// The Practice copy with stand-in CLIs: Claude Code has document-tools (so the first read keeps it out of the others), and Copilot
// CLI's own add refuses the marketplace, as Copilot CLI 1.0.109 refuses the official one.
if (wanted('plugin-boxes')) {
  await fresh();
  begin('plugin-boxes');
  const market = join(scratch, 'boxes-market');
  writeMarket(market);
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const [cli, version] of [['claude', '2.1.322 (Claude Code)'], ['codex', 'codex-cli 0.167.0']]) writeFileSync(join(HOME, '.local/bin', cli), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`, { mode: 0o755 });
  writeFileSync(join(HOME, '.local/bin/copilot'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI 1.0.109." && exit 0\necho 'Invalid marketplace.json: plugins.302.source' >&2\nexit 1\n`, { mode: 0o755 });
  writeClaudeInstall(practice, 'team-tools', 'document-tools', '1.2.0', { 'skills/pdf-reader/SKILL.md': readFileSync(join(market, 'plugins/document-tools/skills/pdf-reader/SKILL.md'), 'utf8') });
  writeFileSync(join(practice, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'team-tools': { source: { source: 'directory', path: market }, installLocation: market } }));
  await refresh();
  await a.click('#nav-plugins');
  await addMarketplace(a, market);
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('#pbox-0-document-tools-copilot-cli')`, 15000);
  await atEverySize('boxes', 'document-tools’ page with three working tools: Claude Code’s box ticked (installed there), Copilot CLI’s and Codex’s empty, each saying “Kept out: tick to put it back” (the first read kept it out of the tools that lacked it)', true, '.plugin-panel', 'start');
  await a.click('#pbox-0-document-tools-copilot-cli'); await waitFor(a, `document.body.dataset.busy !== 'true' && !document.querySelector('.plugin-click[data-click="waiting"], .plugin-click[data-click="running"]')`, 30000); await a.settle();
  await atEverySize('boxes-refused', 'Ticked Copilot CLI’s box: its own add refused the marketplace (“Invalid marketplace.json”), so its box is off and its line says “Copilot CLI refused this marketplace” (the tooltip has its words, and that it isn’t tried again until Refresh); Claude Code’s stays ticked, Codex’s says Kept out', true, '.plugin-panel', 'start');
  await fresh();
}

// ---------- What a plugin carries as instructions, and what can add text to sessions ----------
// The fixture's release-helper holds an AGENTS.md and a start-of-session hook beside a PreToolUse one, and is installed in Claude
// Code; house-notes, added here, holds only a CLAUDE.md; ops-kit, added here, runs scripts from its hooks and an MCP server with
// a long command. Three working tools, so "In each tool" has a line for each.
if (wanted('plugin-text')) {
  await fresh();
  begin('plugin-text');
  const market = join(scratch, 'text-market');
  writeMarket(market);
  mkdirSync(join(market, 'plugins/house-notes'), { recursive: true });
  writeFileSync(join(market, 'plugins/house-notes/CLAUDE.md'), '# House notes\n\nYou have access to the team’s house style through these notes. Prefer short sentences.\n');
  const ops = join(market, 'plugins/ops-kit');
  mkdirSync(join(ops, 'hooks'), { recursive: true }); mkdirSync(join(ops, 'skills/runbook'), { recursive: true });
  writeFileSync(join(ops, 'skills/runbook/SKILL.md'), '---\nname: runbook\ndescription: Finds the runbook for an alert.\n---\n\nLook it up.\n');
  writeFileSync(join(ops, 'hooks/hooks.json'), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"' }, { type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/freshness.sh" --quiet' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'uv', args: ['run', '--directory', '${CLAUDE_PLUGIN_ROOT}/hooks', 'prompt check.py'] }] }],
    PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/format-changed-files.sh"' }] }],
  } }));
  writeFileSync(join(ops, '.mcp.json'), JSON.stringify({ mcpServers: { operations: { command: 'npx', args: ['-y', '@example/operations-mcp-server@2.4.1', '--region', 'eu-west-1', '--config', '${CLAUDE_PLUGIN_ROOT}/config/servers.json', '--log-level', 'info', '--read-only', '--timeout-seconds', '120'] } } }));
  edit(join(market, '.claude-plugin/marketplace.json'), text => { const catalog = JSON.parse(text); catalog.plugins.push({ name: 'house-notes', source: './plugins/house-notes', version: '0.1.0', category: 'productivity', description: 'The team’s house style, as a CLAUDE.md.' }, { name: 'ops-kit', source: './plugins/ops-kit', version: '2.4.1', category: 'development', description: 'Runbooks, a formatter after each edit and an operations MCP server.' }); return JSON.stringify(catalog, null, 2); });
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const [cli, version] of [['claude', '2.1.326 (Claude Code)'], ['codex', 'codex-cli 0.169.1'], ['copilot', 'GitHub Copilot CLI 1.0.113.']]) writeFileSync(join(HOME, '.local/bin', cli), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`, { mode: 0o755 });
  const helper = path => readFileSync(join(market, 'plugins/release-helper', path), 'utf8');
  writeClaudeInstall(practice, 'team-tools', 'release-helper', '0.4.1', Object.fromEntries(['AGENTS.md', 'hooks/hooks.json', 'commands/release-notes.md', 'agents/release-reviewer.md'].map(path => [path, helper(path)])));
  writeFileSync(join(practice, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'team-tools': { source: { source: 'directory', path: market }, installLocation: market } }));
  await refresh();
  await a.click('#nav-plugins');
  await addMarketplace(a, market);
  await a.click('#popen-0-release-helper'); await waitFor(a, `!!document.querySelector('.plugin-outcome-list') && !!document.querySelector('#pfile-0-AGENTS-md')`, 15000);
  await atEverySize('session-hook', 'release-helper’s page: under What it holds, Instruction files (1) lists AGENTS.md under the line that no tool reads it and that the model sees it only when something tells it to read the file; Hooks that can add text to sessions (2) lists SessionStart once per command: an echo of Claude Code’s hookSpecificOutput form, and node with its arguments; Other hooks (1) lists PreToolUse with its command; In each tool follows, its Copilot CLI line saying that form is ignored there', true, '.plugin-columns', 'start');
  await show('.plugin-outcome-list'); await shot(a, 'session-hook-tools', 'The same page scrolled to In each tool: a Session text line per tool, its kind in bold (Claude Code: comes from start-of-session and prompt hooks; Copilot CLI: only a top-level {"additionalContext": …}, Claude Code’s hookSpecificOutput form ignored; Codex: can add it once trusted in /hooks).');
  await a.click('#pfile-0-AGENTS-md'); await show('#pfile-0-AGENTS-md', 'start'); await shot(a, 'instruction-file-open', 'Clicked AGENTS.md: its text as written, the marketplace’s and Claude Code’s copy the same.');
  await a.click('#plugin-back');
  await a.click('#popen-0-house-notes'); await waitFor(a, `!!document.querySelector('#pfile-0-CLAUDE-md')`, 15000);
  await atEverySize('only-claude-md', 'house-notes’ page: it holds only a CLAUDE.md, listed as an instruction file (no longer “Nothing Central Knot recognizes”); above the tool boxes, that installing it does not make your tools read these files, with “instructions” opening the Instructions page; no In each tool, since no tool does anything with it', false, '.plugin-panel', 'start');
  await a.click('#plugin-back');
  await a.click('#popen-0-ops-kit'); await waitFor(a, `!!document.querySelector('.plugin-outcome-list')`, 15000);
  for (const [width, height] of [[1280, 800], [2560, 1440]]) { await a.size(width, height); await show('.plugin-columns', 'start'); await shot(a, `scripts-and-long-command-${width}`, `ops-kit’s page: Hooks that can add text to sessions (3), a row per command: two start-of-session scripts from the plugin’s folder, and a prompt hook run as uv with its arguments (the one with a space in quotes); Other hooks (1), a PostToolUse script; its MCP server a long npx command; each as written and using the row’s width (${width}×${height})`); }
  await a.size(1280, 800);
  await a.click('#plugin-back');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-group')`, 15000);
  await show('.plugin-columns', 'start'); await shot(a, 'nothing-of-the-kind', 'document-tools’ page, which holds no instruction file and no hook: What it holds is its two skills, as before.');
  await fresh();
}

// ---------- Profiles ----------
// Profiles are sets of library items (src/profiles.ts): every state of the Profiles page at four sizes, with the light
// appearance once, on a practice copy whose skills, MCP servers and agents are taken into Central Knot first.
if (wanted('profiles')) {
  begin('profiles');
  // The name field saves and closes on blur, which a window losing focus (macOS) also causes: reopened with Rename then.
  const name = async text => { if (!(await a.has('#profile-name'))) await a.click('#profile-rename'); await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await a.settle(); };
  const openProfile = async text => { await a.run(`[...document.querySelectorAll('.profile-row')].find(row => row.textContent.includes(${JSON.stringify(text)})).click()`); await a.settle(); };
  await a.click('#nav-profiles');
  await atEverySize('empty', 'Clicked "Profiles" in the sidebar before any profile exists', true);
  for (const [page, keys] of [['skills', ['notes', 'standup', 'release-notes']], ['mcp', ['docs', 'files']], ['agents', ['code-reviewer', 'release-notes']]]) {
    await openKind(a, page); await a.settle();
    for (const key of keys) { await turnOnRow(page, key); await switchOn(page, key); }
  }
  await a.click('#nav-profiles');
  await a.click('#profile-new');
  await atEverySize('new-naming', 'Took notes, standup and release-notes, docs and files, and the agents code-reviewer and release-notes into Central Knot, then clicked "New profile": its name field is ready to type in');
  await name('Incident');
  await atEverySize('new-named', 'Typed "Incident" and pressed Enter: nothing is in it yet, so it offers no switch; the band says to tick at least one item, or start from what is on now');
  await a.click('#pf-skill\\:notes'); await a.click('#pf-mcp\\:files');
  await atEverySize('incident-ticked', 'Ticked notes and files: before any switch, each row says what switching to Incident does to it; the header counts it, the line wrapping whole', true);
  await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await atEverySize('incident-switched', 'Clicked "Switch to Incident": the result says what it turned off, with Undo switch; Incident is in use (the list, the header: "2 items on, the other 5 off wherever they can be switched", the status bar)', true);
  await a.click('#profile-new'); await name('Development');
  await a.click('#profile-from-now');
  await a.click('#pf-skill\\:standup'); await a.click('#pf-agent\\:code-reviewer');
  await atEverySize('development-ticked', 'Made "Development", clicked "Start from what’s on now", then ticked standup and code-reviewer: switching turns those two on');
  await a.click('#status-profile');
  await shot(a, 'status-menu', 'Clicked "Incident" in the status bar: the profile menu, a tick on the profile in use, with focus on it.');
  await a.press('ArrowDown'); await shot(a, 'status-menu-keys', 'Pressed the Down arrow key: focus moves to Development (Up, Down, Home and End move; Escape closes).');
  await a.run(`[...document.querySelectorAll('.pf-menu-item')].find(item => item.textContent.includes('Development')).click()`); await a.settle();
  // A scripted click counts as a keyboard choice (focus returns to the status item, ringed); a mouse click leaves no ring.
  await a.run(`document.activeElement?.blur()`);
  await atEverySize('development-in-use', 'Chose "Development" in that menu: Development is in use; the column says what is on now');
  await openKind(a, 'skills'); await a.settle();
  await shot(a, 'skills-with-profile', 'The Library’s skills while Development is in use: each skill is On or Off in Central Knot, as Development has it; nothing marks a profile.');
  await a.click(`#${rowPart('switch', 'skills', 'standup')}`); await a.settle();
  await a.click('#nav-profiles'); await openProfile('Development');
  await atEverySize('after-hand-click', 'On the Library’s skills, turned standup off by hand, then came back: no profile is in use now (the status bar says No profile), and Development says what switching to it would turn back on', true);
  await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await a.click('#profile-new'); await name('On call');
  await a.click('#profile-from-now');
  await atEverySize('two-in-use', 'Switched to Development again, then made "On call" from what is on now: both have the same items, so both are in use, and the status bar names both');
  await a.click('#profile-delete');
  await atEverySize('delete-confirm', 'Clicked Delete on On call: deleting a profile changes no item');
  await a.click('#profile-delete-confirm');
  await atEverySize('deleted', 'Clicked Delete: the result says nothing changed, with Undo; Development is open');
  // Eight profiles: the list column takes more of a narrow window.
  for (const extra of ['Writing', 'Review', 'Support', 'Research', 'Travel', 'Release']) { await a.click('#profile-new'); await name(extra); }
  await openProfile('Development');
  await atEverySize('eight-profiles', 'Made six more profiles (eight in all) and opened Development: stacked at 860×560 the page scrolls as one, every profile and then the open one’s items, with no box scrolling inside');
  await a.size(860, 560);
  await a.run(`document.querySelector('.profiles-split').scrollTop = 10000`); await a.settle();
  await shot(a, 'eight-profiles-860-scrolled', 'At 860×560, the page scrolled to its end: Development’s header, Find and its items, the table’s heading held at the top.');
  await a.run(`document.querySelector('.profiles-split').scrollTop = 0`);
  await a.size(1280, 800);
  await a.run(`(() => { const input = document.querySelector('#profile-find'); input.value = 'zzz'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`); await a.settle();
  await atEverySize('find-nothing', 'Typed "zzz" in Find: nothing matches, and the count says 0 of 7');
  await a.run(`(() => { const input = document.querySelector('#profile-find'); input.value = 'release'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`); await a.settle();
  await atEverySize('find-some', 'Typed "release" in Find: the skill and the agent called release-notes, each under its kind, with a tick for all of them shown');
  await a.click('#profile-find-clear');
  const profilesFile = join(practice, '.central-knot/profiles.json'), kept = readFileSync(profilesFile, 'utf8');
  writeFileSync(profilesFile, '{ not json');
  await refresh();
  await atEverySize('unreadable', 'Outside the app, profiles.json was broken, then Refresh: the page says why profiles can’t be used, changes nothing, and the list is gone with it');
  writeFileSync(profilesFile, kept);
  await refresh();
  await a.click('#nav-history');
  await shot(a, 'history', 'Clicked "History": each switch is one row, naming the profile and what it turned on and off, with Undo switch.');
  await a.run(`document.querySelector('.history-row[data-kind="profile"] .history-actions button')?.click()`); await a.settle();
  await shot(a, 'history-undone', 'Clicked "Undo switch" on the newest switch: the status bar says what it turned back; each item it turned has a row of its own.');
  await a.click('#nav-profiles'); await openProfile('Incident');
  // The narrowest window: a long name's header, renaming, and the status bar shortening it once it is in use.
  await a.size(860, 560);
  await a.click('#profile-rename');
  const longName = 'Incident response and on-call: web apps!';
  if (longName.length !== 40) throw new Error('The long name must be 40 characters.');
  await name(longName);
  await shot(a, 'size-860-long-name', 'At 860×560, renamed Incident to a 40-character name: the header with Switch, Rename and Delete.');
  await a.click('#profile-rename'); await shot(a, 'size-860-renaming', 'Clicked Rename again: the field has the header to itself, with Enter / Esc hints.');
  await a.press('Escape');
  await a.click('#profile-switch'); await a.run(`document.activeElement?.blur()`);
  await shot(a, 'size-860-long-name-in-use', 'Still at 860×560, switched to the profile with the 40-character name: the status bar item shortens it with an ellipsis (the full name is on hover).');
  await a.size(1280, 800);
}

// ---------- First setup: the one question, the walkthrough of copies that differ, and the one Undo (firstsetup.ts) ----------
if (wanted('first-setup')) {
  begin('first-setup');
  await fresh();
  // The Practice copy as a person's home might be: besides its own (review's two copies differ), two skills whose copies differ
  // with dates that tell the latest, and an MCP server whose entries differ (no dates to go by). Every copy saved a while ago,
  // past the settle window.
  const ago = hours => new Date(Date.now() - hours * 3_600_000);
  const put = (root, name, body, hours) => {
    const folder = join(practice, root, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`);
    for (const path of [join(folder, 'SKILL.md'), folder]) utimesSync(path, ago(hours), ago(hours));
  };
  put('.claude/skills', 'deploy', 'Deploy from main after the checks pass.', 50);
  put('.codex/skills', 'deploy', 'Deploy from main after the checks pass, then tag the release.', 2);
  put('.claude/skills', 'triage', 'Label new issues by area and urgency, newest first.', 3);
  put('.copilot/skills', 'triage', 'Label new issues by area.', 30);
  for (const [path, hours] of [['.claude/skills/review', 72], ['.copilot/skills/review', 20]]) for (const at of [join(practice, path, 'SKILL.md'), join(practice, path)]) utimesSync(at, ago(hours), ago(hours));
  edit(join(practice, '.codex/config.toml'), text => `${text}\n[mcp_servers.docs]\nurl = "https://docs.example.test/mcp/v2"\n`);
  for (const path of [join(practice, '.codex/config.toml'), join(practice, '.claude.json'), join(practice, '.copilot/mcp-config.json')]) utimesSync(path, ago(5), ago(5));
  await wait(2500);
  await refresh();
  await a.click('#nav-overview');
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  await atEverySize('question-new-home', 'A new home (the Practice copy, never asked): the Overview’s question, Synchronize everything?, under the lead. Its lines say apart what Yes takes in at once (6 items, and which tools get them) and the 4 more items whose copies differ, which wait with nothing chosen and are asked about one at a time with the latest copy marked where one can be told; and what the one Undo covers (a copy you choose has its own Undo). Under them, No changes nothing. Synchronize everything is the main button, No, I’ll add items myself beside it', true, '#setup-question');
  await a.size(860, 560); await show('#setup-question'); await focusOn('#setup-yes');
  await shot(a, 'question-focus-860', 'Tabbed to Synchronize everything at 860×560: its focus ring');
  await a.run(`document.activeElement?.blur()`); await a.size(1280, 800);
  await a.click('#setup-no');
  await atEverySize('after-no', 'Clicked No, I’ll add items myself: the band says nothing changed, what is on stays on and keeps syncing, found items wait on their page for Add, and Settings can switch it on later; the question is gone, and the lead says to open a card and turn on what you want', true);
  // A home from before this step, with an item already On, whose rule was never answered: the record without its answer.
  await openKind(a, 'skills');
  await turnOnRow('skills', 'notes'); await switchOn('skills', 'notes');
  edit(join(practice, '.central-knot/sync.json'), text => { const record = JSON.parse(text); delete record.syncEverything; return JSON.stringify(record, null, 2); });
  await refresh();
  await a.click('#nav-overview');
  await atEverySize('question-items-on', 'A home from before this step, with notes already On and the rule never answered: asked as a new home is, 5 items to take in now; the skills card counts 1 synced', false, '#setup-question');
  await a.click('#setup-yes');
  await waitFor(a, `!!document.querySelector('#walkthrough')`, 15000);
  await atEverySize('after-yes-walkthrough-first', 'Clicked Synchronize everything: the band says what it took in and what the one Undo covers; the walkthrough opened on Skills at its first item, 1 of 4, deploy, with its copy question as its row asks it, Codex’s copy (the latest) the main button, and beside Skip the line Skip changes no copy', true, '#walkthrough', 'start');
  await a.size(860, 560); await show('#walkthrough', 'start'); await focusOn(`#${rowPart('walk-use', 'skills', 'deploy', 'codex-cli')}`);
  await shot(a, 'walkthrough-focus-860', 'Tabbed to Codex’s copy, the latest, at 860×560: the focus ring is on its Use this copy');
  await a.run(`document.activeElement?.blur()`); await a.size(1280, 800);
  await a.click(`#${rowPart('walk-use', 'skills', 'deploy', 'codex-cli')}`);
  await atEverySize('walkthrough-second', 'Clicked Use this copy on Codex’s copy: the band says deploy is in Central Knot with Codex’s copy, with its own Undo; the walkthrough went on to 2 of 4, review, Copilot CLI’s copy the main button', false, '#walkthrough', 'start');
  await a.click('#walk-skip'); await a.click('#walk-skip');
  await atEverySize('walkthrough-no-dates', 'Clicked Skip twice (review and triage): 4 of 4 is docs, an MCP server, asked in place on All; its entries have no time of their own, so no copy is the main button and the line beside Skip says there are no dates to go by and that Skip changes no copy; Use the latest for the rest is unavailable', true, '#walkthrough', 'start');
  await a.click('#walk-skip');
  await atEverySize('walkthrough-done', 'Clicked Skip on docs, the last: the band says the walkthrough is done and that 3 skipped items still wait for a choice, their copies as they are, review and triage on Skills and docs on MCP servers', false, '#walkthrough', 'start');
  await a.click('#nav-overview');
  await atEverySize('way-back-in', 'Opened the Overview: the line under the lead counts the 3 found items whose copies differ and offers Choose copies, which starts the walkthrough again, every item before it having been skipped', true, '#setup-choosing');
  await a.click('#setup-choose');
  await waitFor(a, `!!document.querySelector('#walkthrough')`, 15000);
  await a.click('#walk-use-latest');
  await atEverySize('after-use-latest', 'Clicked Choose copies (the walkthrough starts again at review, 1 of 3), then Use the latest for the rest: the band says it used the latest copy for 2 items, each with its own Undo in History, and skipped docs, with no dates to go by; the walkthrough says it is done and that docs still waits on MCP servers', true, '#walkthrough', 'start');
  await a.click('#nav-settings');
  await waitFor(a, `!!document.querySelector('#setting-sync-everything')`);
  await atEverySize('settings-promise', 'Opened Settings: Synchronize everything is on; its hint says switching it on is one entry in History, and what the one Undo covers: a copy you choose has its own Undo; its line counts the 1 item that waits, with Choose copies', false, '#setting-sync-everything');
  await a.click('#nav-history');
  await waitFor(a, `!!document.querySelector('.history-row[data-kind="everything"]')`, 15000);
  await atEverySize('history-switch-on', 'Opened History and scrolled to the entry for Synchronize everything switched on, kind Setting: its words say what its Undo covers, and it offers Undo', true, '.history-row[data-kind="everything"]');
  await a.click('.history-row[data-kind="everything"] .history-actions button');
  await waitFor(a, `[...document.querySelectorAll('.history-row[data-kind="everything"]')].some(row => /Restore/.test(row.textContent))`, 15000);
  await atEverySize('after-undo', 'Clicked its Undo: at the top, its entry says it switched the rule off, took 5 items back out of Central Knot, each tool keeping its own copy, and left in deploy, review and triage, whose copies were chosen; it offers Restore. The entries under it are each item’s own Undo, each with Restore', true);
  await a.click('.history-row[data-kind="everything"] .history-actions button');
  await waitFor(a, `[...document.querySelectorAll('.history-row[data-kind="everything"] .history-done')].some(done => /Restored/.test(done.textContent))`, 15000);
  await atEverySize('after-restore', 'Clicked Restore: at the top, an entry for each item restored; the Undo’s entry under them says Restored. The status bar says “Synchronize everything is on again. Restored 5 items; the switch-on’s Undo takes them back.”, cut short at the narrower sizes.', true);
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- One skill of an installed plugin, off and back on (ENB-06) ----------
if (wanted('sync-everything')) {
  begin('sync-everything');
  await fresh();
  await openKind(a, 'skills');
  await atEverySize('skills-found-off', 'Opened Skills on the Practice copy, Synchronize everything off as it is until chosen: the Found heading says Add takes each in', false, '[data-section="found"]');
  await a.click('#nav-settings');
  await waitFor(a, `!!document.querySelector('#setting-sync-everything')`);
  await atEverySize('settings-off', 'Opened Settings: under This home, Synchronize everything is off; its hint says switching it on is one History entry whose Undo takes back all it took in; its line says how many found items turning it on would add now, and how many wait for a choice of copy, with Choose copies', true, '#setting-sync-everything');
  await a.size(860, 560); await show('#setting-sync-everything'); await focusOn('#sync-everything-on');
  await shot(a, 'settings-off-focus-860', 'Tabbed to its switch at 860×560: the focus ring, the row’s words beside it');
  await a.run(`document.activeElement?.blur()`); await a.size(1280, 800);
  // The Practice copy is copied when the app opens: past the settle window, its copies are as ones that have sat in a tool,
  // so the pass right after the switch takes them all at once.
  await wait(2500);
  await a.click('#sync-everything-on');
  await waitFor(a, `document.querySelector('#sync-everything-on')?.getAttribute('aria-checked') === 'true'`, 15000);
  await atEverySize('settings-on', 'Clicked its switch: Synchronize everything is on; under the row, what the pass right after took in, a line per kind with History, and what still waits for a choice of copy', true, '#setting-sync-everything');
  await a.click('#nav-overview');
  await atEverySize('overview-on', 'Opened Overview: its question is gone, now Synchronize everything is on; what still needs you is the one found item whose copies differ, with Choose copies, and the cards count what it took in');
  await openKind(a, 'skills');
  await atEverySize('skills-on', 'Opened Skills: one notice names the skills it took in and the tools it found them in; the Found heading says Synchronize everything leaves these, the opened row saying why, and counts what waits for a choice', true);
  await openRow('skills', 'review');
  await atEverySize('skills-on-review', 'Opened review, left found: its copies differ, so it asks which copy every tool uses, as Add would; the row and its question are one block, its bar the warning colour', false, '.ov-row.open', 'start');
  await closeRow('skills', 'review');
  await openKind(a, 'mcp');
  await atEverySize('mcp-on', 'Opened MCP servers: its notice names the servers it took in and where, and that History can undo each; Claude Code has them too', true);
  await openKind(a, 'agents');
  await atEverySize('agents-on', 'Opened Agents: its notice names the agents it took in and where they were found');
  await a.click('#nav-history');
  await waitFor(a, `!!document.querySelector('.history-row')`, 15000);
  await atEverySize('history', 'Opened History: the entries in view each say Synchronize everything took the item in and from which tool, each with Undo, docs’s, found in Claude Code, too', true);
  // The skill notes's own row, by its name and kind (release-notes, an agent, has one too).
  const notesRow = `[...document.querySelectorAll('.history-row[data-kind="on"]')].find(row => row.querySelector('.history-what strong')?.textContent === 'notes' && row.querySelector('.history-kind')?.textContent === 'Skill')`;
  await a.run(`${notesRow}.querySelector('.history-actions button').click()`); await a.settle();
  await atEverySize('history-undone', 'Clicked Undo on notes’s entry: the status bar says it is out of Central Knot again, each tool it was found in keeping its own copy', true);
  await openKind(a, 'skills'); await refresh();
  await openRow('skills', 'notes');
  await atEverySize('skills-undone-found', 'Opened Skills after a pass: notes is found again and stays so; its line says it was deleted from Central Knot, so it will not be added by itself again, and that Add, or Restore in History, brings it back; the Found heading grows with its note', true, '.details');
  await closeRow('skills', 'notes');
  await a.click('#nav-settings');
  await a.click('#sync-everything-on');
  await waitFor(a, `document.querySelector('#sync-everything-on')?.getAttribute('aria-checked') === 'false'`, 15000);
  await atEverySize('settings-off-again', 'Clicked its switch again: off; its line says what turning it on would add now (notes, undone, would not be)', false, '#setting-sync-everything');
}

if (wanted('plugin-skills')) {
  await fresh();
  begin('plugin-skills');
  const market = join(scratch, 'market');
  if (!existsSync(market)) writeMarket(market);
  // document-tools as each tool records it installed: Claude Code's installed_plugins.json, Codex's config.toml and plugin
  // cache, Copilot CLI's config.json. Each has team-tools in its own list of marketplaces (Claude Code's known_marketplaces.json,
  // Copilot CLI's settings.json), so the plugins record's first read finds it in all three. A stand-in `copilot` keeps its skill
  // switch in settings.json as the real one does, beside that list.
  const copyTo = folder => { for (const name of ['pdf-reader', 'spreadsheet']) { mkdirSync(join(folder, 'skills', name), { recursive: true }); writeFileSync(join(folder, 'skills', name, 'SKILL.md'), readFileSync(join(market, 'plugins/document-tools/skills', name, 'SKILL.md'))); } return folder; };
  const claudeCopy = copyTo(join(practice, '.claude/plugins/cache/ck-tools/document-tools/1.2.0'));
  writeFileSync(join(practice, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'document-tools@team-tools': [{ scope: 'user', installPath: claudeCopy, version: '1.2.0' }] } }));
  const known = JSON.stringify({ 'team-tools': { source: { source: 'git', url: market } } });
  writeFileSync(join(practice, '.claude/plugins/known_marketplaces.json'), known);
  copyTo(join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0'));
  edit(join(practice, '.codex/config.toml'), text => `${text}\n[marketplaces.team-tools]\nsource = ${JSON.stringify(market)}\n\n[plugins."document-tools@team-tools"]\nenabled = true\n`);
  const copilotCopy = copyTo(join(practice, '.copilot/installed-plugins/team-tools/document-tools'));
  mkdirSync(join(practice, '.copilot'), { recursive: true });
  writeFileSync(join(practice, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'document-tools', marketplace: 'team-tools', version: '1.2.0', cache_path: copilotCopy }] }));
  const copilotSettings = disabledSkills => JSON.stringify({ extraKnownMarketplaces: JSON.parse(known), disabledSkills });
  writeFileSync(join(practice, '.copilot/settings.json'), copilotSettings([]));
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  // Codex's switch is its config.toml, so its CLI is only asked its version (the switch is offered from a tested build).
  writeFileSync(join(HOME, '.local/bin/codex'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "codex-cli 0.167.0" && exit 0\nexit 9\n`, { mode: 0o755 });
  writeFileSync(join(HOME, '.local/bin/copilot'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI 1.0.108." && exit 0\nS="$HOME/.copilot/settings.json"\ncase "$1 $2" in\n  "skill disable") printf '{"extraKnownMarketplaces":${known},"disabledSkills":["%s"]}' "$3" > "$S" ;;\n  "skill enable") printf '${copilotSettings([])}' > "$S" ;;\n  *) exit 9 ;;\nesac\n`, { mode: 0o755 });
  // The switches' result goes by itself 8 s after the clicks, its Undo with it (app.ts FADE_MS), but stays while the pointer
  // is on it. The pictures between the clicks and Undo take longer than that, so for each of them the pointer rests on its words.
  const onResult = () => middleOf('#plugins-result .toolbar-result-text');
  // A resize moves the result from under the pointer, so the pointer is put back on it at once. Twice: at 2560×1440, larger than
  // a laptop's screen, the first move after a resize lands elsewhere (measured on a 1728×1117 Mac), and the result then went
  // whenever its 8 s came round in that moment.
  const restOnResult = async () => { for (let move = 0; move < 2; move++) { await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await onResult()) }); await wait(60); } };
  const sizeHeld = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 2000 ? 1 : 2, mobile: false }); await restOnResult(); await a.settle(); };
  const at860 = async (name, caption, held = false) => {
    if (held) await sizeHeld(860, 560); else { await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle(); }
    await a.run(`document.querySelector('.plugin-skills')?.scrollIntoView({ block: 'start' })`); await wait(150);
    await shot(a, name, caption, held ? await onResult() : undefined);
    if (held) await sizeHeld(1280, 800); else { await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle(); }
  };
  await a.click('#nav-plugins');
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  if (!(await a.has('#popen-0-issue-tracker'))) await addMarketplace(a, market);
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#pcell-0-document-tools-codex-cli[data-state="installed"]')`, 15000);
  await shot(a, 'plugins-installed', 'document-tools is installed in Claude Code, Copilot CLI and Codex (by each tool’s own record). Clicked Refresh on team-tools.');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-skills')`);
  await shot(a, 'skills-switches', 'Opened document-tools. Its skills each have a switch in Copilot CLI and Codex; Claude Code has no switch for one skill of a plugin.');
  const flip = async id => { await a.click(id); await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle(); };
  await flip('#pskill-0-document-tools-pdf-reader-codex-cli');
  await flip('#pskill-0-document-tools-pdf-reader-copilot-cli');
  await shot(a, 'skill-off', 'Clicked pdf-reader’s switch under Codex, then under Copilot CLI: each acted at once. Codex’s config.toml now names document-tools:pdf-reader with enabled = false, and Copilot CLI ran `copilot skill disable document-tools:pdf-reader`. The header has the last click’s result, with its Undo; from here to Undo the pointer rests on the result, which keeps it.', await onResult());
  await a.run(`document.querySelector('#pskill-0-document-tools-pdf-reader-codex-cli').focus({ focusVisible: true })`);
  await shot(a, 'skill-focus', 'Moved keyboard focus to pdf-reader’s Codex switch (as Tab would): the focus ring.', await onResult());
  await a.theme('light'); await shot(a, 'skill-focus-light', 'The same, in the light appearance.', await onResult()); await a.theme('dark');
  await a.run(`document.activeElement?.blur()`);
  await at860('skill-off-860-skills', 'The same at 860×560, scrolled to the skills.', true);
  await a.theme('light'); await shot(a, 'skill-off-light', 'The same, in the light appearance.', await onResult()); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) {
    await sizeHeld(width, height);
    await shot(a, `skill-off-${width}`, `The same page at ${width}×${height}.`, await onResult());
    await restOnResult(); await a.theme('light'); await shot(a, `skill-off-${width}-light`, `The same at ${width}×${height}, light.`, await onResult()); await a.theme('dark');
  }
  await sizeHeld(1280, 800);
  await flip('#plugins-undo');
  await shot(a, 'skill-undone', 'Clicked Undo: pdf-reader is on again in Copilot CLI, the last click’s tool; Codex’s click came before, so it is still off there.');
  await flip('#pskill-0-document-tools-pdf-reader-codex-cli');
  writeFileSync(join(practice, '.copilot/settings.json'), copilotSettings(['spreadsheet']));
  await a.click('#plugin-back'); await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#pcell-0-document-tools-copilot-cli')`, 15000); await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-skills')`);
  await shot(a, 'skill-held', 'Turned every skill named “spreadsheet” off in Copilot CLI outside Central Knot (`copilot skill disable spreadsheet`), then reopened the page: it shows off there, locked, and can’t be turned on for this plugin alone (its row says why).');
  await at860('skill-held-860', 'The held state at 860×560, scrolled to the skills.');
  await a.theme('light'); await at860('skill-held-860-light', 'The held state at 860×560, light.'); await a.theme('dark');
}

// ---------- Plugin updates that arrive by themselves ----------
if (wanted('plugin-updates')) {
  await fresh();
  begin('plugin-updates');
  const market = join(scratch, 'market-auto');
  writeMarket(market);
  const skillOf = (plugin, name) => readFileSync(join(market, 'plugins', plugin, 'skills', name, 'SKILL.md'), 'utf8');
  // Claude Code has issue-tracker 1.9.0 and document-tools 1.1.0, both behind the marketplace, and release-helper, which the
  // marketplace has since dropped. It added the marketplace itself.
  writeClaudeInstall(practice, 'team-tools', 'issue-tracker', '1.9.0', { 'skills/triage/SKILL.md': skillOf('issue-tracker', 'triage') });
  writeClaudeInstall(practice, 'team-tools', 'document-tools', '1.1.0', { 'skills/pdf-reader/SKILL.md': skillOf('document-tools', 'pdf-reader'), 'skills/spreadsheet/SKILL.md': skillOf('document-tools', 'spreadsheet') });
  writeClaudeInstall(practice, 'team-tools', 'release-helper', '0.4.1', { 'commands/release-notes.md': readFileSync(join(market, 'plugins/release-helper/commands/release-notes.md'), 'utf8') });
  writeFileSync(join(practice, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'team-tools': { source: { source: 'git', url: market } } }));
  edit(join(market, '.claude-plugin/marketplace.json'), text => { const catalog = JSON.parse(text); catalog.plugins = catalog.plugins.filter(plugin => plugin.name !== 'release-helper'); return JSON.stringify(catalog, null, 2); });
  // A stand-in Claude Code: its update moves issue-tracker's record on to 2.0.0, and fails for document-tools as the real one does when it can't.
  const record = join(practice, '.claude/plugins/installed_plugins.json');
  const moved = JSON.parse(readFileSync(record, 'utf8'));
  const newCopy = join(practice, '.claude/plugins/cache/team-tools/issue-tracker/2.0.0');
  moved.plugins['issue-tracker@team-tools'] = [{ scope: 'user', installPath: newCopy, version: '2.0.0' }];
  writeFileSync(join(scratch, 'record-after.json'), JSON.stringify(moved, null, 2));
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  writeFileSync(join(HOME, '.local/bin/claude'), `#!/bin/sh
[ "$1" = "--version" ] && echo "2.1.322 (Claude Code)" && exit 0
case "$*" in
  "plugin update issue-tracker@team-tools --scope user") mkdir -p '${newCopy}/skills/triage' && cp '${join(market, 'plugins/issue-tracker/skills/triage/SKILL.md')}' '${newCopy}/skills/triage/' && cp '${join(scratch, 'record-after.json')}' '${record}' ;;
  "plugin update document-tools@team-tools --scope user") echo "Failed to update document-tools: its cache folder is in use by another Claude Code session."; exit 1 ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });
  const sizes = [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]];
  const atSizes = async (name, caption) => {
    for (const [width, height] of sizes) {
      await a.size(width, height);
      await a.theme('dark'); await shot(a, `${name}-${width}-dark`, `${caption} At ${width}×${height}, dark.`);
      await a.theme('light'); await shot(a, `${name}-${width}-light`, 'The same, light.');
    }
    await a.size(1280, 800); await a.theme('dark');
  };
  await a.click('#nav-plugins');
  await addMarketplace(a, market);
  await waitFor(a, `!!document.querySelector('[data-plugin="issue-tracker"]')`, 20000); await a.settle();
  await shot(a, 'plugins-before', 'Plugins, before any check. Claude Code has issue-tracker 1.9.0 and document-tools 1.1.0, both behind the marketplace, and release-helper, which the marketplace no longer lists: it stays, marked "No longer offered".');
  await a.click('#nav-settings');
  await waitFor(a, `!!document.querySelector('#plugin-updates-on')`);
  await shot(a, 'settings-before', 'Settings, before any check: "Update plugins automatically" is on, and says the first check comes soon.');
  await a.click('#check-plugin-updates');
  await waitFor(a, `/Last checked/.test(document.querySelector('#setting-plugin-updates')?.textContent ?? '')`, 60000); await a.settle();
  await atSizes('settings-checked', 'Clicked "Check now" (what the schedule does by itself every four hours): one update was made, one couldn’t be.');
  await a.click('#setting-plugin-updates-notice-action');
  await waitFor(a, `!!document.querySelector('#plugin-updates-updated')`, 20000); await a.settle();
  await atSizes('plugins-note', 'Clicked "See Plugin marketplaces": the note says issue-tracker was updated to 2.0.0 in Claude Code, and that document-tools couldn’t be, in Claude Code’s own words. Being the first such note, it says once that plugins now update by themselves and that Settings turns that off.');
  await a.click('#popen-0-release-helper'); await waitFor(a, `!!document.querySelector('.plugin-page')`); await a.settle();
  await shot(a, 'plugin-no-longer-offered', 'Opened release-helper, which the marketplace dropped: its page says so, shows what Claude Code still holds, and can still uninstall it.');
  await a.size(860, 560); await shot(a, 'plugin-no-longer-offered-860', 'The same at 860×560.'); await a.size(1280, 800);
  await a.click('#plugin-back');
  await a.click('#plugin-updates-updated-close'); await a.settle();
  await shot(a, 'note-updated-closed', 'Closed the "Updated automatically" note: what couldn’t be updated stays until it is closed or the update goes through, by itself or with Update on this page.');
  await a.click('#plugin-updates-failed-close'); await a.settle();
  await shot(a, 'note-closed', 'Closed that one too.');
  await a.click('#nav-settings');
  await a.click('#sync-switch'); await waitFor(a, `/Paused/.test(document.querySelector('#setting-plugin-updates')?.textContent ?? '')`); await a.settle();
  await shot(a, 'settings-paused', 'Turned Automatic sync off in the status bar: plugin updates pause with it, and the row says so. Check now still works.');
  await a.size(860, 560); await shot(a, 'settings-paused-860', 'The same at 860×560.'); await a.size(1280, 800);
  await a.click('#sync-switch'); await waitFor(a, `!/Paused/.test(document.querySelector('#setting-plugin-updates')?.textContent ?? '')`); await a.settle();
  await a.click('#plugin-updates-on'); await waitFor(a, `document.querySelector('#plugin-updates-on')?.getAttribute('aria-checked') === 'false'`); await a.settle();
  await shot(a, 'settings-off', 'Turned "Update plugins automatically" off: plugins are updated only with Update on the Plugin marketplaces page.');
}

// ---------- Plugin versions and skill text ----------
if (wanted('plugin-versions')) {
  await fresh();
  begin('plugin-versions');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  const market = join(scratch, 'market');
  if (!existsSync(market)) writeMarket(market);
  // Claude Code has document-tools 1.1.0, whose pdf-reader skill was worded differently; Codex has the marketplace's 1.2.0.
  writeClaudeInstall(practice, 'team-tools', 'document-tools', '1.1.0', {
    'skills/pdf-reader/SKILL.md': '---\nname: pdf-reader\ndescription: "Reads PDF files and pulls out text."\n---\n\nOpen the PDF and copy out its text.\n',
    'skills/spreadsheet/SKILL.md': readFileSync(join(market, 'plugins/document-tools/skills/spreadsheet/SKILL.md'), 'utf8'),
  });
  cpSync(join(market, 'plugins/document-tools'), join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0'), { recursive: true });
  // Both Claude Code and Codex have issue-tracker 1.9.0 (the marketplace offers 2.0.0): two tools named on one list row.
  writeClaudeInstall(practice, 'team-tools', 'issue-tracker', '1.9.0', { 'skills/triage/SKILL.md': readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8') });
  cpSync(join(market, 'plugins/issue-tracker'), join(practice, '.codex/plugins/cache/team-tools/issue-tracker/1.9.0'), { recursive: true });
  edit(join(practice, '.codex/config.toml'), text => `${text.replace(/\n*$/, '\n')}\n[plugins."document-tools@team-tools"]\nenabled = true\n\n[plugins."issue-tracker@team-tools"]\nenabled = true\n`);
  await a.click('#nav-plugins');
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  // Added already by the plugins feature: read again, so the installs written above show.
  if (await a.has('[data-plugin="document-tools"]')) { await a.click('#header-refresh'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); }
  else await addMarketplace(a, market);
  await shot(a, 'list-versions', 'The team-tools marketplace (a local folder). Claude Code has document-tools 1.1.0; Codex has 1.2.0, the version the marketplace offers. Both have issue-tracker 1.9.0 where the marketplace offers 2.0.0. Copilot CLI isn\'t installed on this machine.');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('#pfile-0-skills-pdf-reader')`);
  await shot(a, 'plugin-versions', 'Clicked the "document-tools" row.');
  await a.click('#pfile-0-skills-pdf-reader');
  await shot(a, 'skill-open', 'Clicked "pdf-reader" under Skills: its SKILL.md. Claude Code\'s copy (1.1.0) differs from the marketplace\'s and Codex\'s (1.2.0), so each text shows, named.');
  await a.run(`document.querySelector('.plugin-file').scrollIntoView({ block: 'center' })`); await a.settle();
  await shot(a, 'skill-open-scrolled', 'Scrolled down to the opened SKILL.md.');
  await a.click('#pfile-0-skills-spreadsheet');
  await a.run(`document.querySelector('#pfile-0-skills-spreadsheet').scrollIntoView({ block: 'center' })`); await a.settle();
  await shot(a, 'skill-same-everywhere', 'Also opened "spreadsheet", whose text is the same in every copy: one block, named as such.');
  await a.click('#pfile-0-skills-spreadsheet');
  await a.run(`document.querySelector('#pfile-0-skills-spreadsheet').focus()`);
  await shot(a, 'keyboard-focus', 'Closed "spreadsheet" again; the keyboard focus is on its name.');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await size(width, height);
    await a.run(`document.querySelector('.plugin-page')?.closest('.scroll')?.scrollTo(0, 0)`);
    await a.theme('dark'); await shot(a, `plugin-${width}-dark`, `document-tools with pdf-reader open, at ${width}×${height}, dark.`);
    await a.theme('light'); await shot(a, `plugin-${width}-light`, `The same, light.`);
    if (width === 860 || width === 2560) { await a.run(`document.querySelector('.plugin-file').scrollIntoView({ block: 'center' })`); await a.settle(); await shot(a, `plugin-${width}-file-light`, `At ${width}×${height}, scrolled to the opened SKILL.md.`); await a.theme('dark'); }
  }
  await a.theme('dark');
  await a.click('#plugin-back');
  await size(860, 560); await a.run(`document.querySelector('[data-plugin="issue-tracker"]').scrollIntoView({ block: 'center' })`); await a.settle();
  await shot(a, 'list-860', 'Back to the marketplace list at 860×560, scrolled to issue-tracker, which two tools have at another version.');
  await a.theme('light'); await shot(a, 'list-860-light', 'The same, light.'); await a.theme('dark');
  await size(2560, 1440); await a.theme('light'); await shot(a, 'list-2560-light', 'The marketplace list at 2560×1440, light.');
  // Update: each row behind offers it for every tool behind, and the marketplace for all of them; a click runs at once.
  await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await a.run(`document.querySelector('#plugins-scroll')?.scrollTo(0, 0)`); await a.settle();
    await shot(a, `update-offered-${width}`, `At ${width}×${height}: document-tools and issue-tracker are behind in some tools, so their rows offer Update, and the marketplace "Update all".`);
  }
  // Update all, with stand-ins for Claude Code and Codex that take six seconds and then refuse: the band while it runs, then the failures.
  const stubs = [['claude', '2.1.322 (Claude Code)'], ['codex', 'codex-cli 0.167.0']].map(([name, version]) => ({ file: join(HOME, '.local/bin', name), version }));
  const kept = stubs.map(({ file }) => (existsSync(file) ? readFileSync(file) : undefined));
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const { file, version } of stubs) writeFileSync(file, `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nsleep 6\necho "The plugin cache is in use by another session."\nexit 1\n`, { mode: 0o755 });
  await size(1280, 800); await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('[id^="market-update-all-"]')`, 30000); await a.settle();
  await a.run(`document.querySelector('[id^="market-update-all-"]').click()`); await waitFor(a, `!!document.querySelector('.cell-working')`, 15000);
  await shot(a, 'update-all-running', 'Clicked "Update all": every update it names runs in one run. The band says each change runs that tool’s own command and that an update can take a minute or more; the marks of the step under way spin.');
  await size(860, 560); await shot(a, 'update-all-running-860', 'The same at 860×560.');
  await waitFor(a, `document.body.dataset.busy !== 'true'`, 90000); await a.settle();
  await shot(a, 'update-all-failed-860', 'The run ended. The stand-ins refused, so each failure is in the problem band with its plugin named, and nothing is offered to undo.');
  for (const [width, height] of [[1280, 800], [1728, 1117], [2560, 1440]]) { await size(width, height); await shot(a, `update-all-failed-${width}`, `The same at ${width}×${height}.`); }
  stubs.forEach(({ file }, at) => (kept[at] ? writeFileSync(file, kept[at]) : rmSync(file, { force: true })));
  if (await a.has('.plugin-problems .band-dismiss')) await a.click('.plugin-problems .band-dismiss');
  // Codex's copy of document-tools changes by hand at the marketplace's version (1.2.0): its page says so and offers Update.
  edit(join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0/skills/spreadsheet/SKILL.md'), text => `${text}\nAlso sort every sheet by its first column.\n`);
  await a.click('#header-refresh'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000);
  // Refresh forgot every plugin's files; the list reads the installed ones again by itself, with no page opened.
  await waitFor(a, `/Codex differs from the marketplace’s copy/.test(document.querySelector('[data-plugin="document-tools"] .plugin-row-warning')?.textContent ?? '')`, 15000);
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await a.run(`document.querySelector('[data-plugin="document-tools"]').scrollIntoView({ block: 'center' })`); await a.settle();
    await shot(a, `list-copy-differs-${width}`, `At ${width}×${height}, after Refresh and with no plugin page opened: the document-tools row says Codex's copy differs from the marketplace's (read in the background once the list was drawn) and offers Update.`);
  }
  await a.click('#popen-0-document-tools'); await waitFor(a, `/differs from the marketplace’s copy/.test(document.querySelector('.plugin-panel')?.textContent ?? '')`, 15000);
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await a.run(`document.querySelector('.plugin-page')?.closest('.scroll')?.scrollTo(0, 0)`); await a.settle();
    await shot(a, `copy-differs-${width}`, `At ${width}×${height}: Codex's document-tools is 1.2.0, the marketplace's version, but its spreadsheet skill was changed by hand: "Installed · 1.2.0 · differs from the marketplace’s copy", and Update is offered for Codex (with Claude Code, which is behind).`);
  }
  await a.click('#plugin-back');
  await size(1280, 800); await a.theme('dark');
}

// ---------- What plugins installed whole bring, on Skills, MCP servers and Agents ----------
if (wanted('plugin-items')) {
  await fresh();
  begin('plugin-items');
  const market = join(scratch, 'items-market');
  writeMarket(market);
  const copyOf = (plugin, folder) => { cpSync(join(market, 'plugins', plugin), folder, { recursive: true }); return folder; };
  // As each tool records them: document-tools and release-helper in Claude Code (its marketplace added there), document-tools
  // in Copilot CLI with pdf-reader switched off, issue-tracker in Codex turned off (its marketplace added nowhere), and in Pi a
  // skill triage the same as issue-tracker's.
  const installs = Object.fromEntries(['document-tools', 'release-helper'].map(plugin => [`${plugin}@team-tools`, [{ scope: 'user', installPath: copyOf(plugin, join(practice, `.claude/plugins/cache/team-tools/${plugin}/1.0.0`)), version: plugin === 'document-tools' ? '1.2.0' : '0.4.1' }]]));
  writeFileSync(join(practice, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: installs }));
  writeFileSync(join(practice, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'team-tools': { source: { source: 'github', repo: 'example/team-tools' }, installLocation: market } }));
  const copilotCopy = copyOf('document-tools', join(practice, '.copilot/installed-plugins/team-tools/document-tools'));
  writeFileSync(join(practice, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'document-tools', marketplace: 'team-tools', version: '1.2.0', cache_path: copilotCopy, enabled: true }] }));
  writeFileSync(join(practice, '.copilot/settings.json'), JSON.stringify({ disabledSkills: ['document-tools:pdf-reader'] }));
  copyOf('issue-tracker', join(practice, '.codex/plugins/cache/team-tools/issue-tracker/2.0.0'));
  // document-tools in Codex too, with pdf-reader switched off there.
  copyOf('document-tools', join(practice, '.codex/plugins/cache/team-tools/document-tools/1.2.0'));
  edit(join(practice, '.codex/config.toml'), text => `${text}\n[plugins."issue-tracker@team-tools"]\nenabled = false\n\n[plugins."document-tools@team-tools"]\nenabled = true\n\n[[skills.config]]\nname = "document-tools:pdf-reader"\nenabled = false\n`);
  // Codex's switch is its config.toml (its CLI is only asked its version); Copilot CLI's is its own command, a stand-in here
  // that keeps pdf-reader off.
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  writeFileSync(join(HOME, '.local/bin/codex'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "codex-cli 0.167.0" && exit 0\nexit 9\n`, { mode: 0o755 });
  writeFileSync(join(HOME, '.local/bin/copilot'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI 1.0.108." && exit 0\nS="$HOME/.copilot/settings.json"\ncase "$1 $2" in\n  "skill disable") printf '{"disabledSkills":["document-tools:pdf-reader","%s"]}' "$3" > "$S" ;;\n  "skill enable") printf '{"disabledSkills":["document-tools:pdf-reader"]}' > "$S" ;;\n  *) exit 9 ;;\nesac\n`, { mode: 0o755 });
  // Claude Code's switch for a whole plugin is its own command: a stand-in that turns document-tools off and back on.
  const claudeSettings = join(practice, '.claude/settings.json'), claudeSettingsAt = existsSync(claudeSettings) ? readFileSync(claudeSettings, 'utf8') : '{}';
  writeFileSync(join(HOME, '.local/bin/claude'), `#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.322 (Claude Code)" && exit 0\ncase "$*" in\n  "plugin disable document-tools@team-tools --scope user") printf '{"enabledPlugins":{"document-tools@team-tools":false}}' > "${claudeSettings}" ;;\n  "plugin enable document-tools@team-tools --scope user") printf '%s' '${claudeSettingsAt}' > "${claudeSettings}" ;;\n  *) exit 9 ;;\nesac\n`, { mode: 0o755 });
  mkdirSync(join(practice, '.pi/agent/skills/triage'), { recursive: true });
  cpSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), join(practice, '.pi/agent/skills/triage/SKILL.md'));
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  const toPlugins = async () => { await a.run(`document.querySelector('.ov-section-plugins')?.scrollIntoView({ block: 'center' })`); await wait(150); };
  await openKind(a, 'skills'); await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('.ov-section-plugins')`, 15000);
  await shot(a, 'skills', 'Skills: the plugins’ skills are rows under “Only through a plugin” (From: Any plugin lists every row from a plugin, triage too), each marked “from <plugin>”, with its switch and a mark in each tool that has it (pdf-reader off in Copilot CLI and Codex, issue-tracker’s whole plugin off in Codex); triage is one row with the copy in Pi.');
  await a.theme('light'); await shot(a, 'skills-light', 'The same, light.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await toPlugins();
    await shot(a, `skills-${width}`, `Skills at ${width}×${height}, scrolled to the plugin rows.`);
    await a.theme('light'); await shot(a, `skills-${width}-light`, `The same at ${width}×${height}, light.`); await a.theme('dark');
  }
  await size(1280, 800);
  await a.click(`${byId(rowPart('open', 'skills', 'document-tools@team-tools/pdf-reader'))}`);
  await shot(a, 'skill-open', 'Opened pdf-reader: it opens with where it is on (“On in Claude Code · off in Copilot CLI and Codex · from the plugin document-tools”), then where it is handled (a link to document-tools’ page; the switches below turn it on or off in each tool), and each tool’s line with its switch.');
  await a.click(`${byId(rowPart('pfile', 'skills', 'document-tools@team-tools/pdf-reader'))}`); await waitFor(a, `!!document.querySelector('.details-plugin .plugin-file')`, 15000);
  await shot(a, 'skill-open-file', 'Clicked “Show its SKILL.md”, under the tools’ lines: the file opens right under the link, in its own scrolling box no taller than 40% of the window, and each tool’s switch stays in view above it.');
  await a.theme('light'); await shot(a, 'skill-open-light', 'The same, light.'); await a.theme('dark');
  await size(860, 560); await shot(a, 'skill-open-860', 'The open row at 860×560: the tools’ lines and their switches, then its SKILL.md under the link.');
  await a.theme('light'); await shot(a, 'skill-open-860-light', 'The same at 860×560, light.'); await a.theme('dark');
  await size(1728, 1117); await shot(a, 'skill-open-1728', 'The open row at 1728×1117.'); await size(1280, 800);
  // The row's own switch turns it off in every tool that has it. Copilot CLI and Codex have it off already, and Claude Code has
  // no switch for one skill of a plugin, so there it turns the whole plugin off, as the switch's name and tooltip say first.
  const pdfSwitch = `${byId(rowPart('switch', 'skills', 'document-tools@team-tools/pdf-reader'))}`;
  await shot(a, 'main-switch-before', `Before the row's switch is clicked (pdf-reader open, on in Claude Code only): its name and tooltip say “${await a.run(`document.querySelector('${pdfSwitch}').getAttribute('aria-label')`)}”`);
  await a.click(pdfSwitch); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
  await shot(a, 'main-switch-whole', 'Clicked pdf-reader’s own switch: the whole plugin document-tools is off in Claude Code, with Claude Code’s own command, and the band says pdf-reader is off there and names what went with it, with one Undo and no second button.');
  await size(860, 560); await shot(a, 'main-switch-whole-860', 'The same at 860×560.'); await size(1280, 800);
  await a.click('#outcome-undo-plugin'); await a.settle();
  await shot(a, 'main-switch-whole-undone', 'Clicked Undo: document-tools is on in Claude Code again.');
  await a.click(`${byId(rowPart('open', 'skills', 'document-tools@team-tools/pdf-reader'))}`);
  // spreadsheet is on in all three: its switch turns it off in Copilot CLI and Codex with their own switches and the whole
  // plugin in Claude Code, and its one Undo turns them all back on.
  await a.click(`${byId(rowPart('switch', 'skills', 'document-tools@team-tools/spreadsheet'))}`); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
  await shot(a, 'main-switch-changed', 'Clicked spreadsheet’s own switch: off in Copilot CLI and Codex at once, each with its own switch, and in Claude Code, which has no switch for one skill of a plugin, with the whole plugin document-tools; the band names what went with it, with Undo.');
  await size(860, 560); await a.click('#sidebar-toggle');
  await shot(a, 'main-switch-changed-860-sidebar', 'The same at 860×560 with the sidebar open: the sentence keeps the width, Undo beside or under it.');
  await a.click('#sidebar-toggle'); await size(1280, 800);
  await a.click('#outcome-undo-plugin'); await a.settle();
  await shot(a, 'main-switch-changed-undone', 'Clicked Undo: “Undone: spreadsheet is back on in Claude Code, Copilot CLI and Codex.”');
  if (await a.has(`#${rowPart('open', 'skills', 'triage')}`)) {
    await a.click(`#${rowPart('open', 'skills', 'triage')}`); await shot(a, 'copy-and-plugin', 'Opened triage: the copy in Pi and the plugin installed in Codex share the row, its SKILL.md being the same; Codex’s line has its switch.');
    // Each tool's switch for the item is in its opened row, and applies at once. issue-tracker is off in Codex: its switch
    // turns the plugin on there for triage alone.
    if (await a.has(`#${rowPart('enable', 'skills', 'triage', 'codex-cli')}`)) {
      await a.click(`#${rowPart('enable', 'skills', 'triage', 'codex-cli')}`); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin, .bands .band')`, 15000);
      await shot(a, 'switch-applied', 'Clicked triage’s Codex switch in its opened row (the whole plugin issue-tracker was off there): it is on in Codex at once. The band leads with the skill clicked (“triage is on in Codex. Its plugin issue-tracker was turned on there, with its MCP server issues left off.”), with Undo.');
      await a.theme('light'); await shot(a, 'switch-applied-light', 'The same, light.'); await a.theme('dark');
      await size(860, 560); await shot(a, 'switch-applied-860', 'The same at 860×560.'); await size(1280, 800);
      if (await a.has('#outcome-undo-plugin')) { await a.click('#outcome-undo-plugin'); await a.settle(); await shot(a, 'switch-undone', 'Clicked Undo: issue-tracker is off in Codex again, as it was; the confirmation fades by itself.'); }
    }
  }
  await openKind(a, 'mcp'); await waitFor(a, `!!document.querySelector('.ov-section-plugins, [data-key^="${rowPart('', 'mcp', 'issue-tracker@')}"]')`);
  await shot(a, 'mcp', 'MCP servers: issue-tracker’s issues server, installed in Codex with the plugin turned off.');
  await a.theme('light'); await shot(a, 'mcp-light', 'The same, light.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await size(width, height); await toPlugins();
    await shot(a, `mcp-${width}`, `MCP servers at ${width}×${height}.`);
    await a.theme('light'); await shot(a, `mcp-${width}-light`, `The same at ${width}×${height}, light.`); await a.theme('dark');
  }
  await size(1280, 800);
  if (await a.has(`${byId(rowPart('open', 'mcp', 'issue-tracker@team-tools/issues'))}`)) { await a.click(`${byId(rowPart('open', 'mcp', 'issue-tracker@team-tools/issues'))}`); await shot(a, 'mcp-open', 'Opened issues: its marketplace is added nowhere, so it says how Codex itself handles it; its switch is there all the same.'); }
  // One MCP server of a plugin has a switch of its own in every tool that takes plugins: its opened row's switch writes it at
  // once, and Undo takes it back.
  if (await a.has(`${byId(rowPart('open', 'mcp', 'issue-tracker@team-tools/issues'))}`)) {
    if (!(await a.has(`${byId(rowPart('enable', 'mcp', 'issue-tracker@team-tools/issues', 'codex-cli'))}`))) await a.click(`${byId(rowPart('open', 'mcp', 'issue-tracker@team-tools/issues'))}`);
    await a.click(`${byId(rowPart('enable', 'mcp', 'issue-tracker@team-tools/issues', 'codex-cli'))}`); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin, .bands .band')`, 15000);
    await shot(a, 'mcp-switch-applied', 'Clicked issues’ Codex switch in its opened row, where the whole plugin was off: it is on in Codex at once. The result leads with the server clicked (“issues is on in Codex. Its plugin issue-tracker was turned on there, with its skill triage left off.”), with Undo.');
    await size(1728, 1117); await shot(a, 'mcp-switch-applied-1728', 'The same at 1728×1117.'); await size(1280, 800);
    if (await a.has('#outcome-undo-plugin')) { await a.click('#outcome-undo-plugin'); await a.settle(); await shot(a, 'mcp-switch-undone', 'Clicked Undo: the plugin is off in Codex again, as it was.'); }
  }
  // The row's own switch does the same in every tool with a switch for one server: here, Codex.
  if (await a.has(`${byId(rowPart('switch', 'mcp', 'issue-tracker@team-tools/issues'))}`)) {
    await a.click(`${byId(rowPart('switch', 'mcp', 'issue-tracker@team-tools/issues'))}`); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
    await shot(a, 'mcp-main-switch', 'Clicked the issues row’s own switch: it is on in Codex, the one tool that has it, with its plugin turned on there for it alone; with Undo.');
    await a.click('#outcome-undo-plugin'); await a.settle();
  }
  await openKind(a, 'agents'); await toPlugins(); await shot(a, 'agents', 'Agents: release-helper’s release-reviewer in Claude Code, under “Only through a plugin · installed with their plugin · switched here like any other”.');
  if (await a.has(`${byId(rowPart('open', 'agents', 'release-helper@team-tools/release-reviewer'))}`)) {
    await a.click(`${byId(rowPart('open', 'agents', 'release-helper@team-tools/release-reviewer'))}`);
    await shot(a, 'agent-open', 'Opened release-reviewer: it opens with where it is on (“On in Claude Code · from the plugin release-helper”), where it is handled, and Claude Code’s line with its switch for this one agent.');
    await a.click(`${byId(rowPart('switch', 'agents', 'release-helper@team-tools/release-reviewer'))}`); await waitFor(a, `!!document.querySelector('#outcome-undo-plugin')`, 15000);
    await shot(a, 'agent-main-switch', 'Clicked release-reviewer’s own switch: off in Claude Code at once, with Claude Code’s switch for one agent (the rest of release-helper stays on); the key says “Off there”; with Undo.');
    await a.click('#outcome-undo-plugin'); await a.settle();
    await shot(a, 'agent-main-switch-undone', 'Clicked Undo: release-reviewer is on in Claude Code again.');
  }
  await a.click('#nav-overview'); await shot(a, 'overview', 'Overview: each card counts the plugins’ items apart (“from plugins”).');
  await a.click('#nav-harnesses'); await shot(a, 'harnesses', 'Harnesses: each card’s counts say how many come from plugins.');
  await a.click('#harness-copilot-cli'); await a.click('#harness-tab-skills'); await toPlugins();
  await shot(a, 'harness-skills', 'Copilot CLI’s page, Skills tab: its plugin rows, those it has.');
}

// ---------- Instructions ----------
/** A pointer click on the shown text `selector` at the start of `words` (with its point, which places the editor's caret). */
async function clickText(a, selector, words) {
  const point = await a.run(`(() => {
    const pre = document.querySelector(${JSON.stringify(selector)}), node = pre.firstChild, at = node.textContent.indexOf(${JSON.stringify(words)});
    const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
    const page = pre.closest('.scroll'), view = page.getBoundingClientRect(), line = range.getBoundingClientRect();
    if (line.top < view.top || line.bottom > view.bottom) page.scrollTop += line.top - view.top - view.height / 2;
    const box = range.getBoundingClientRect();
    return { x: box.left + 1, y: box.top + box.height / 2 };
  })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await a.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  await a.settle();
}
/** The Instructions page at the four sizes (dark, and light at 1280×800), from its top. */
async function instructionsAtSizes(tag, caption) {
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await a.size(width, height); await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
    await shot(a, `${tag}-${width}`, `${caption} At ${width}×${height}.`);
  }
  await a.size(1280, 800); await a.theme('light'); await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await shot(a, `${tag}-light`, `${caption} At 1280×800, light.`); await a.theme('dark');
}
if (wanted('instructions')) {
  // Its own home, so a full tour draws what `--only instructions` draws: plugin-items, before it, leaves Pi in the home.
  await fresh();
  begin('instructions');
  await a.click('#nav-instructions');
  await waitFor(a, `!!document.querySelector('#ins-edit-claude-cli')`);
  await shot(a, 'instructions-start', 'Clicked "Instructions" in the sidebar: "How these files are read" at the top, the Base instructions card, then "Each tool’s own instructions". The practice copy has CLAUDE.md and AGENTS.md; Copilot CLI has no file yet.');
  await a.click('#ins-about summary'); await shot(a, 'instructions-about', 'Clicked "How these files are read": how the files are read and saved, the base, and who reads each file with its tool’s own notes.');
  await a.click('#ins-about summary');
  await clickText(a, '[aria-label="Claude Code instructions"] pre.ins-preview', 'Prefer small'); await shot(a, 'instructions-editing', 'Clicked "Prefer small commits" in Claude Code\'s text: its editor opens with the caret there, Review changes and Cancel in the card\'s head.');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value = area.value.replace('Prefer small commits', 'Prefer small, focused commits') + '- Never push without asking.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli'); await shot(a, 'instructions-review', 'Changed one line, added another, and clicked Review changes: Save is in the card\'s head.');
  await a.click('#ins-save-claude-cli'); await wait(400); await shot(a, 'instructions-saved', 'Clicked Save.');
  await a.click('#ins-edit-copilot-cli'); await shot(a, 'instructions-new-file', 'Clicked "Add instructions for Copilot CLI", which has no file yet.');
  await a.size(1240, 800);
  await a.run(`(() => { const area = document.querySelector('#ins-text-copilot-cli'); area.value = '# How I work\\n- Explain the plan first.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shot(a, 'instructions-1240-saved-unsaved', 'At 1240×800: Claude Code\'s card says Saved with Undo save, Copilot CLI\'s says Unsaved changes, and Codex\'s card is plain.');
  await a.click('#ins-review-copilot-cli'); await shot(a, 'instructions-review-1240', 'At 1240×800: wrote a first draft for Copilot CLI and clicked Review new file.');
  await a.click('#ins-review-discard-copilot-cli'); await shot(a, 'instructions-discard-confirm-1240', 'Clicked Discard changes: the question takes the place of the card\'s actions, in its head.');
  await a.click('#ins-review-discard-yes-copilot-cli');
  await a.size(1280, 800);
  await a.click('#ins-edit-copilot-cli');
  // A draft whose tool leaves the home: kept, and offered to copy or discard.
  await a.run(`(() => { const area = document.querySelector('#ins-text-copilot-cli'); area.value = '# How I work\\n- Explain the plan first.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  renameSync(join(practice, '.copilot'), join(practice, '.copilot-away'));
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#ins-orphan')`);
  await shot(a, 'instructions-orphan-draft', 'Typed a draft for Copilot CLI, then moved Copilot CLI\'s folder away outside the app and clicked Refresh: the card is gone, and the draft is offered to copy or discard.');
  await a.click('#ins-orphan-discard');
  await instructionsAtSizes('two-tools', 'Two tools (Claude Code and Codex): one card a row, two a row once the cards area is 1936 px wide (2560).');
  // Five tools, Pi's file long: one card a row at every size, each text at a reading measure.
  renameSync(join(practice, '.copilot-away'), join(practice, '.copilot'));
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  mkdirSync(join(practice, '.config/opencode'), { recursive: true });
  writeFileSync(join(practice, '.pi/agent/AGENTS.md'), `## Driving GUI apps\n\n${Array.from({ length: 95 }, (_, line) => `- Step ${line + 1}: use the narrowest tool that reaches the outcome, and say which one was used and why it was the narrowest.`).join('\n')}\n`);
  writeFileSync(join(practice, '.config/opencode/AGENTS.md'), '# OpenCode\n- Keep sessions short.\n');
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#ins-edit-pi-cli')`, 15000);
  await instructionsAtSizes('five-tools', 'Five tools, Pi\'s file 97 lines long: one card a row, two a row once the cards area is 1936 px wide (2560).');
  // A click deep in a long text at the smallest window: the caret's line is under the card's head, with its actions.
  await a.size(860, 600);
  await a.click('#ins-more-pi-cli');
  await clickText(a, '[aria-label="Pi instructions"] pre.ins-preview', '- Step 80:');
  await shot(a, 'instructions-860-long-click', 'At 860×600: clicked "Show all 97 lines" on Pi\'s card, scrolled down and clicked "- Step 80": the editor opens with the caret on that line, under the card\'s head with Review changes and Cancel.');
  await a.click('#ins-cancel-pi-cli');
  await a.size(1280, 800);
  // The same card on a tool's Instructions tab under Harnesses.
  await a.click('#nav-harnesses'); await a.click('#harness-pi-cli'); await a.click('#harness-tab-instructions');
  await waitFor(a, `!!document.querySelector('#ins-edit-pi-cli')`);
  await a.click('#ins-about summary');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) { await a.size(width, height); await shot(a, `harness-tab-${width}`, `Pi's Instructions tab under Harnesses, "How these files are read" opened, at ${width}×${height}.`); }
  await a.click('#ins-about summary');
  await a.size(1280, 800);
  for (const folder of ['.pi', '.config/opencode']) rmSync(join(practice, folder), { recursive: true, force: true });
  await a.click('#nav-instructions'); await a.click('#header-refresh');
}

// ---------- Window sizes: every page from the window's minimum to a large display, full screen ----------
/** Adds the fixture marketplace once, so the Plugins pages have something to show. */
async function ensureMarket() {
  await a.click('#nav-plugins');
  await waitFor(a, `!!document.querySelector('.market-list, #marketplace-source')`);
  if (await a.has('#plugin-back')) await a.click('#plugin-back');
  if (await a.has('.market-list')) return;
  const market = join(scratch, 'market');
  if (!existsSync(market)) writeMarket(market);
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
  await waitFor(a, `!!document.querySelector('.market-list')`, 30000);
}

/** One shot of each page at the current size; `tag` names the size in the file names. */
async function everyPage(tag) {
  const at = `at ${a.viewport.width}×${a.viewport.height}`;
  await a.click('#nav-overview'); await shot(a, `${tag}-overview`, `The Overview ${at}.`);
  await openKind(a, 'skills'); await shot(a, `${tag}-skills`, `Skills ${at}.`);
  // notes, when there: a skill whose copies agree, so its details offer Files and contents.
  const first = await a.run(`(document.querySelector('#${rowPart('open', 'skills', 'notes')}') ?? document.querySelector('.ov-row[data-key] .row-open'))?.id ?? ''`);
  if (first) {
    if (!(await a.has('.ov-row.open, .dock'))) await a.click(`#${first}`);
    if (!(await waitFor(a, `!!document.querySelector('.ov-row.open, .dock')`))) throw new Error(`The skill's details did not open ${at}.`);
    await shot(a, `${tag}-skills-details`, `Opened notes's details ${at} (beside the table from 1200px of content).`);
    const files = await a.run(`document.querySelector('[id^="files-"]')?.id ?? ''`);
    if (files) {
      await a.click(`#${files}`); await shot(a, `${tag}-skills-files`, `Clicked "Files and contents": the list and one skill's files ${at}.`);
      // Where each copy is: open from the start in a wide pane, in its column beside the file; stacked, below the file.
      if (await a.has('.details-paths:not([open]) summary')) { await a.click('.details-paths:not([open]) summary'); await shot(a, `${tag}-skills-files-where`, `Clicked "Where each copy is", below the file, ${at}: then Delete from Central Knot….`); }
      else if (await a.has('.details-paths[open]')) { await a.run(`document.querySelector('.details-paths').scrollIntoView({ block: 'nearest' })`); await shot(a, `${tag}-skills-files-where`, `"Where each copy is" is open from the start ${at}: the skill's details in their column at the right, the status first and Delete everywhere… last.`); }
      const toggle = await a.run(`document.querySelector('[id^="detail-switch-"]')?.id ?? ''`);
      if (toggle) { await a.click(`#${toggle}`); await shot(a, `${tag}-skills-files-switched`, `Turned its switch in the Files view: it applies at once; the result and Undo are in the header ${at}.`); if (await a.has('#outcome-undo')) await a.click('#outcome-undo'); }
      await a.click('#files-back');
    }
    if (await a.has('.ov-row.open')) await a.click(`#${first}`);
  }
  // draft's copies differ: its switch opens the copy question under its row, and a second click closes it.
  if (await a.has(`#${rowPart('add', 'skills', 'draft')}`)) {
    await a.click(`#${rowPart('add', 'skills', 'draft')}`); await shot(a, `${tag}-skills-choice`, `Clicked draft's Add: its copies differ, so the copy question opens under its row ${at}.`);
    if (await a.has(`#${rowPart('use', 'skills', 'draft', 'copilot-cli')}`)) await a.click(`#${rowPart('add', 'skills', 'draft')}`);
  }
  const on = await a.run(`document.querySelector('.ov-row[data-key] .switch[aria-checked="true"]:not([disabled])')?.id ?? ''`);
  if (on) { await a.click(`#${on}`); await shot(a, `${tag}-skills-switched-off`, `Turned one skill off: its result and Undo ${at}.`); if (await a.has('#outcome-undo')) await a.click('#outcome-undo'); }
  await openKind(a, 'mcp'); await shot(a, `${tag}-mcp`, `MCP servers ${at}: nothing is synced there yet, and a server whose copies differ is marked “Copies differ”.`);
  const server = await a.run(`document.querySelector('.ov-row[data-key] .row-open')?.id ?? ''`);
  if (server) {
    if (!(await a.has('.ov-row.open, .dock'))) await a.click(`#${server}`);
    if (await waitFor(a, `!!document.querySelector('.ov-row.open, .dock')`)) await shot(a, `${tag}-mcp-details`, `Opened the first MCP server's details ${at} (docked beside the table from 1200px of content).`);
    if (await a.has('.ov-row.open')) await a.click(`#${server}`);
  }
  await openKind(a, 'agents'); await shot(a, `${tag}-agents`, `Agents ${at}.`);
  const agent = await a.run(`document.querySelector('.ov-row[data-key] .row-open')?.id ?? ''`);
  if (agent) {
    // An earlier step may have left the row open: a click would close it, so it is clicked only while closed.
    if (!(await a.has('.ov-row.open, .dock'))) await a.click(`#${agent}`);
    if (!(await waitFor(a, `!!document.querySelector('.ov-row.open, .dock')`))) throw new Error(`The agent's details did not open ${at}.`);
    await shot(a, `${tag}-agents-details`, `Opened the first agent's details ${at} (beside the table from 1200px of content).`);
    await a.click(`#${agent}`);
  }
  await a.click('#nav-instructions'); await waitFor(a, `!!document.querySelector('.ins-card, .empty')`); await shot(a, `${tag}-instructions`, `Instructions ${at}.`);
  await ensureMarket(); await shot(a, `${tag}-plugins`, `Plugins, the marketplace's list ${at}.`);
  if (await a.has('[id^="popen-0-"]')) {
    await a.click('[id^="popen-0-"]'); await waitFor(a, `!!document.querySelector('.plugin-group, .plugin-muted')`);
    await shot(a, `${tag}-plugin-page`, `A plugin's page ${at}.`); await a.click('#plugin-back');
  }
  await a.click('#nav-history');
  // The pointer over the second row, so its full-width hover shows.
  const hovered = await a.run(`(() => { const row = document.querySelectorAll('.history-row')[1]?.getBoundingClientRect(); return row ? [row.left + row.width / 2, row.top + row.height / 2] : null; })()`);
  const pointer = hovered ? { x: hovered[0], y: hovered[1] } : undefined;
  if (pointer) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });
  const isHovered = hovered && await waitFor(a, `!!document.querySelectorAll('.history-row')[1]?.matches(':hover')`, 2000);
  await shot(a, `${tag}-history`, `History ${at}${isHovered ? ', the pointer over the second row (its hover tint shows)' : ''}.`, pointer);
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await a.click('#nav-harnesses'); await shot(a, `${tag}-harnesses`, `Harnesses ${at}.`);
  await a.click('#nav-settings'); await shot(a, `${tag}-settings`, `Settings ${at}.`);
}

/** An edit to Copilot CLI's MCP settings made outside the app, files being in Central Knot, so the MCP page shows its notice and actions. */
async function editMcpOutside() {
  await openKind(a, 'mcp');
  if (await a.has(`#${rowPart('add', 'mcp', 'files')}`)) { await a.click(`#${rowPart('add', 'mcp', 'files')}`); await a.settle(); }
  edit(join(practice, '.copilot/mcp-config.json'), text => (text.includes('"npx-edited"') ? text.replace('"npx-edited"', '"npx"') : text.replace('"command": "npx"', '"command": "npx-edited"')));
  await noticeFor('files');
}

if (wanted('sizes')) {
  await fresh();
  begin('sizes');
  // Four tools: Pi gets its own folder in the practice copy, so every table has its widest set of columns.
  cpSync(join(practice, '.claude/skills/notes'), join(practice, '.pi/agent/skills/notes'), { recursive: true });
  // A skill whose copies differ, so its copy question can be shown.
  for (const [tool, body] of [['.claude', 'Claude Code’s draft.'], ['.copilot', 'Copilot CLI’s draft.']]) {
    mkdirSync(join(practice, tool, 'skills/draft'), { recursive: true });
    writeFileSync(join(practice, tool, 'skills/draft/SKILL.md'), `---\nname: draft\ndescription: Turn notes into a first draft.\n---\n\n${body}\n`);
  }
  await openKind(a, 'skills'); await a.click('#header-refresh');
  await editMcpOutside();
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await a.size(width, height);
    if (width === 860) {
      // An edit made outside the app while the Overview is open: the rail marks Skills with a dot until it is seen.
      await a.click('#nav-overview');
      edit(join(practice, '.claude/skills/release-notes/SKILL.md'), text => text.replace(/\n*$/, '\nEdited in Claude Code for the rail.\n'));
      if (await waitFor(a, `!!document.querySelector('.nav-unseen')`, 30000)) await shot(a, '860-rail-unseen-dot', 'At 860×560 with the sidebar as a rail: a skill edited outside the app (release-notes, in Claude Code) puts a dot at the Skills icon\'s top right, and the icons stay in one column.');
    }
    await everyPage(`${width}`);
    // Large windows open with the sidebar; folded to its rail, every page has the extra width too.
    if (width >= 1728) { await a.click('#sidebar-toggle'); await everyPage(`${width}-rail`); await a.click('#sidebar-toggle'); }
    // Pi's mark as the window shows it at 100% zoom, on an Overview card and in the table's header.
    if (width === 1280) {
      await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await a.click('#nav-overview'); await shot(a, '1280-overview-1x', 'The Overview at 1280×800 at 100% zoom (one screen pixel per pixel), where the tools\' small marks, Pi\'s among them, are drawn at 12px.');
      await openKind(a, 'skills'); await shot(a, '1280-skills-1x', 'Skills at 100% zoom: each row’s tool marks at its right end, and the key under the table.');
      await a.size(width, height);
    }
    // At the minimum the sidebar folds to its rail; the person can open it, leaving the content about 650px.
    if (width === 860) {
      await a.click('#sidebar-toggle'); await everyPage('860-sidebar-open'); await a.click('#sidebar-toggle');
      // A message in the status bar at the minimum: the facts keep their words, and the message shortens.
      await openKind(a, 'skills');
      // A switch whose result band is dismissed leaves its result in the status bar.
      const box = await a.run(`document.querySelector('.ov-row[data-key] .switch:not([disabled])')?.id ?? ''`);
      if (box) {
        const said = async name => { await a.click(`#${box}`); if (await a.has('#outcome-dismiss')) await a.click('#outcome-dismiss'); await shot(a, name[0], name[1]); await a.click(`#${box}`); if (await a.has('#outcome-dismiss')) await a.click('#outcome-dismiss'); };
        await said(['860-status-message', 'Turned a skill’s switch, then dismissed its result: the status bar says it at 860×560, with the sidebar as a rail.']);
        await a.click('#sidebar-toggle');
        await said(['860-sidebar-open-status-message', 'The same with the sidebar open: with too little room for the message, a mark stands in, the message its tooltip.']);
        await a.click('#sidebar-toggle');
      }
    }
  }
  await a.theme('light');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) { await a.size(width, height); await everyPage(`${width}-light`); }
  await a.theme('dark');
  // Reading again, and a read again that failed: a page keeps what it showed, and says so in a quiet band.
  const main = await requestHandles(a);
  if (main) {
    await a.size(1728, 1117);
    await ensureMarket();
    await main.slow('plugins:view', 4000);
    await a.click('#header-refresh');
    if (await waitFor(a, `!!document.querySelector('.rereading')`, 2000)) await shot(a, '1728-plugins-rereading', 'Clicked Refresh on Plugin marketplaces at 1728×1117: while the marketplaces are read again (slowed here to show it), the last read stays, with a quiet band saying so.');
    await main.restore('plugins:view');
    await waitFor(a, `!document.querySelector('.rereading')`, 8000);
    await a.click('#nav-history');
    await main.fail('history:list');
    await a.click('#nav-history');
    if (await waitFor(a, `!!document.querySelector('.reread-failed')`, 3000)) await shot(a, '1728-history-reread-failed', 'Opened History again while its read was made to fail: the last read stays on screen, and a quiet band says it could not read again.');
    await main.restore('history:list');
    await a.click('#nav-history');
    main.close();
  }
  // A marketplace with a long name and long facts, with a change waiting, at the smallest window.
  await a.size(860, 560);
  await ensureMarket();
  const longMarket = join(scratch, 'market-long');
  writeMarket(longMarket, 'platform-engineering-shared-developer-tools-marketplace', 'The Platform Engineering and Developer Experience Group');
  await a.click('#open-add-marketplace');
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(longMarket)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace'); await waitFor(a, `document.querySelectorAll('.market-item').length > 1`, 30000);
  await shot(a, '860-long-marketplace', 'Added a marketplace with a long name and a long maker\'s name, at 860×560.');
  await a.click('#sidebar-toggle'); await shot(a, '860-sidebar-open-long-marketplace', 'The same with the sidebar open.'); await a.click('#sidebar-toggle');
  await a.size(1280, 800); await shot(a, '1280-long-marketplace', 'The same at 1280×800: the facts that don\'t fit beside the name drop whole.');
  await a.click('#market-tab-about'); await shot(a, '1280-long-marketplace-about', 'Its About tab: every fact, where it comes from, and Remove.');
  if (await a.has('[id^="forget-"]')) await a.click('[id^="forget-"]');
  await a.size(1280, 800);
}

// ---------- A home with only some tools ----------
// Copilot CLI's column, its header menu entry, its Plugins box and its Instructions card, shown first in the practice copy
// and then gone in a folder that holds only Claude Code's and Codex's folders. A folder home looks for no installed apps,
// so this holds on any machine. The app starts again with that folder remembered, as choosing one opens a system dialog.
/** The views where a tool can appear as an option, each shot once; `tag` says which home. */
async function toolViews(tag, home) {
  await openKind(a, 'skills');
  const head = await a.run(`document.querySelector('.tool-head-button')?.id ?? ''`);
  if (head) { await a.click(`#${head}`); await shot(a, `${tag}-skills-menu`, `${home}: Skills, with the first tool's menu open (it offers each other tool).`); await a.click(`#${head}`); }
  await ensureMarket(); await shot(a, `${tag}-plugins`, `${home}: Plugins, one box per tool.`);
  await a.click('#nav-instructions'); await waitFor(a, `!!document.querySelector('.ins-card, .empty')`); await shot(a, `${tag}-instructions`, `${home}: Instructions, one card per tool.`);
  await a.click('#nav-harnesses'); await shot(a, `${tag}-harnesses`, `${home}: Harnesses.`);
}

// ---------- Skills kept by the `npx skills` installer: the shared ~/.agents/skills folder and links to it ----------
// A folder home whose skill lives in .agents/skills with a link to it from Copilot CLI's folder (Pi reads the shared folder
// itself). Each state at 860×560, 1280×800, 1728×1117 and 2560×1440; the main ones in light and dark.
if (wanted('shared-copies')) {
  begin('shared-copies');
  const folder = join(scratch, 'shared-copies');
  const cli = (path, version) => { mkdirSync(join(folder, path, '..'), { recursive: true }); writeFileSync(join(folder, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(folder, path), 0o755); };
  cli('.local/bin/claude', '2.1.309 (Claude Code)'); cli('.local/bin/copilot', 'GitHub Copilot CLI 1.0.107.'); cli('.pi/agent/bin/pi', 'pi 1.5.0');
  const skillAt = (dir, name, body) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`); };
  const [claude, copilot, pi, agents] = ['.claude/skills', '.copilot/skills', '.pi/agent/skills', '.agents/skills'].map(path => join(folder, path));
  for (const dir of [claude, copilot, pi]) mkdirSync(dir, { recursive: true });
  skillAt(claude, 'release-notes', 'Draft release notes from merged changes.');
  const name = 'opus-sol-loop';
  const install = () => { rmSync(join(agents, name), { recursive: true, force: true }); rmSync(join(copilot, name), { recursive: true, force: true }); skillAt(agents, name, 'Loop two models over a plan until they agree.'); symlinkSync(`../../.agents/skills/${name}`, join(copilot, name)); };
  install();
  const settings = join(scratch, 'data/app-settings.json');
  const openFolder = async path => {
    a.quit(); await wait(500);
    writeFileSync(settings, JSON.stringify({ ...JSON.parse(existsSync(settings) ? readFileSync(settings, 'utf8') : '{}'), home: { mode: 'custom', path } }));
    a = await launch();
    await openKind(a, 'skills');
  };
  await openFolder(folder);
  const sizes = [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]];
  /**
   * One state at every size (and in light too when `both`), scrolled as a person would see it: the skill's row at the top of the
   * table, below its sticky headings (the row's scroll margin, as the app scrolls it on opening), then `into` only as far as
   * it takes to show it.
   */
  const everySize = async (tag, caption, into, both = false, key = name) => {
    for (const theme of both ? ['dark', 'light'] : ['dark']) {
      await a.theme(theme);
      for (const [width, height] of sizes) {
        await a.size(width, height);
        if (into) await a.run(`(() => { document.querySelector(${JSON.stringify(`.ov-row[data-key="${rowPart('', 'skills', key)}"]`)})?.scrollIntoView({ block: 'start' }); document.querySelector(${JSON.stringify(into)})?.scrollIntoView({ block: 'nearest' }); })()`);
        await shot(a, `${tag}-${theme}-${width}`, `${caption} (${theme}, ${width}×${height})`);
      }
    }
    await a.theme('dark'); await a.size(1280, 800);
  };
  const open = () => openRow('skills', name);
  await open();
  await everySize('unmanaged', `Opened ${name}, found: the real folder is in ~/.agents/skills, Copilot CLI's skills folder has a link to it, Pi reads the shared folder. Its status says Copilot CLI and Pi have it another way and that Add puts it in Claude Code; each tool's line says how it gets it; no Delete, as it isn't in Central Knot.`, '.details', true);
  const turnOn = async () => { await turnOnRow('skills', name); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000); };
  await turnOn();
  await everySize('turned-on', 'Clicked its Add: it is in Central Knot and on in Claude Code; Copilot CLI and Pi keep the shared copy, their lines saying “Another way” with Take over…; the band says so, with Undo.', '.bands', true);
  await a.click('#outcome-undo'); await a.settle();
  await everySize('undone', 'Clicked Undo in that band: it says opus-sol-loop is as before: found again, the link and the shared copy untouched.', '.bands');
  // Taken in again; Take over… on a line removes the shared copy and gives each tool that read it Central Knot's copy.
  await turnOn(); await open();
  await a.click(`#${rowPart('take-over', 'skills', name, 'copilot-cli')}`);
  await everySize('take-over-armed', 'Clicked “Take over…” on Copilot CLI’s line: the armed line says which copy goes, which tools get Central Knot’s copy instead, that other apps won’t find it there, and that it has no Undo.', `#${rowPart('take-over-note', 'skills', name, 'copilot-cli')}`, true);
  await a.click(`#${rowPart('take-over-confirm', 'skills', name, 'copilot-cli')}`); await a.settle();
  await open();
  await everySize('taken-over', 'Clicked “Take over now”: the shared copy is gone and Copilot CLI and Pi have Central Knot’s copy; the band says so, and that it has no Undo.', '.bands', true);
  await a.click(`#${rowPart('delete', 'skills', name)}`);
  await everySize('delete-armed', 'Clicked “Delete from Central Knot…”: it says what happens, and for how long History can restore it.', `#${rowPart('delete-note', 'skills', name)}`);
  await a.click(`#${rowPart('delete-confirm', 'skills', name)}`); await a.settle();
  await everySize('deleted', 'Clicked “Delete it now”: opus-sol-loop is out of every tool and off the page; the band says so.', '.bands');
  // Layout 4: Copilot CLI's whole skills folder is a link to the shared folder, so the copy there is the only one it can have.
  const linked = join(scratch, 'shared-root');
  for (const [path, version] of [['.local/bin/claude', '2.1.309 (Claude Code)'], ['.local/bin/copilot', 'GitHub Copilot CLI 1.0.107.'], ['.pi/agent/bin/pi', 'pi 1.5.0']]) { mkdirSync(join(linked, path, '..'), { recursive: true }); writeFileSync(join(linked, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(linked, path), 0o755); }
  mkdirSync(join(linked, '.claude/skills'), { recursive: true }); mkdirSync(join(linked, '.pi/agent/skills'), { recursive: true }); mkdirSync(join(linked, '.copilot'), { recursive: true });
  skillAt(join(linked, '.agents/skills'), 'gamma', 'A skill the installer keeps in the shared folder.');
  symlinkSync('../.agents/skills', join(linked, '.copilot/skills'));
  await openFolder(linked);
  await openRow('skills', 'gamma');
  await everySize('linked-skills-folder', 'A folder whose Copilot CLI skills folder is itself a link to ~/.agents/skills: opened gamma, found. Its status and each tool’s line say how each tool gets it; no action is offered that could not work.', '.details', true, 'gamma');
  await turnOnRow('skills', 'gamma'); await waitFor(a, `!!document.querySelector('#outcome-undo')`, 15000);
  await openRow('skills', 'gamma');
  await everySize('linked-skills-folder-managed', 'Added gamma there: Claude Code has Central Knot’s copy, Copilot CLI and Pi keep the shared copy, their lines saying “Another way”.', '.details', true, 'gamma');
  await a.click(`#${rowPart('delete', 'skills', 'gamma')}`);
  await a.click(`#${rowPart('delete-confirm', 'skills', 'gamma')}`); await a.settle();
  await everySize('linked-skills-folder-deleted', 'Clicked “Delete from Central Knot…”, then “Delete it now” there: gamma is out of Central Knot; the band says so.', '.bands', false, 'gamma');
  if (await a.has('#outcome-undo')) { await a.click('#outcome-undo'); await a.settle(); await everySize('linked-skills-folder-restored', 'Clicked Undo in that band: gamma is back in Central Knot, on in Claude Code, Copilot CLI and Pi keeping the shared copy.', '.bands', false, 'gamma'); }
}

if (wanted('missing')) {
  begin('missing');
  await a.click('#home-fixture');
  await toolViews('before', 'The practice copy, with every tool');
  // This Mac's home looks for installed apps too: a tool installed here still counts; one that isn't (Pi) is named on Harnesses.
  for (const name of ['.claude', '.claude.json', '.codex']) cpSync(join(root, 'fixtures/home', name), join(HOME, name), { recursive: true });
  await a.click('#home-actual'); await a.click('#nav-harnesses');
  await shot(a, 'this-mac-harnesses', 'This Mac\'s home with only Claude Code\'s and Codex\'s folders: a tool installed on this machine still counts; a tool not found is named once, at the end.');
  await a.size(2560, 1440); await shot(a, 'this-mac-harnesses-2560', 'The same at 2560×1440: as many columns as cards.'); await a.size(1280, 800);
  const folder = join(scratch, 'two-tools');
  for (const name of ['.claude', '.claude.json', '.codex']) cpSync(join(root, 'fixtures/home', name), join(folder, name), { recursive: true });
  a.quit();
  await wait(500);
  const settings = join(scratch, 'data/app-settings.json');
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: folder } }));
  a = await launch();
  await toolViews('after', 'A folder with only Claude Code and Codex');
  await a.click('#nav-overview'); await shot(a, 'after-overview', 'The same folder\'s Overview: its first sentence names only the two tools.');
  await a.size(2560, 1440);
  await a.click('#nav-harnesses'); await shot(a, 'after-2560-harnesses', 'The same folder\'s Harnesses at 2560×1440: two cards, two columns.');
  await a.click('#nav-instructions'); await waitFor(a, `!!document.querySelector('.ins-card, .empty')`); await shot(a, 'after-2560-instructions', 'Its Instructions at 2560×1440: the two tools\' cards side by side.');
  await a.size(1280, 800);
  await a.size(860, 560);
  await openKind(a, 'skills'); await shot(a, 'after-860-skills', 'The same folder\'s Skills at 860×560.');
  await a.size(1280, 800);
  // A folder whose only tool is Pi, which takes no plugins: the Plugins page says so instead of drawing an empty table.
  const piOnly = join(scratch, 'pi-only');
  cpSync(join(root, 'fixtures/home/.claude/skills/notes'), join(piOnly, '.pi/agent/skills/notes'), { recursive: true });
  a.quit();
  await wait(500);
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: piOnly } }));
  a = await launch();
  await a.click('#nav-overview'); await shot(a, 'pi-only-overview', 'A folder whose only tool is Pi: the sidebar and the Overview leave out Plugins, which Pi can\'t hold, and the Overview names it once; Pi takes agents as skills.');
  await a.click('#nav-harnesses'); await shot(a, 'pi-only-harnesses', 'The same folder\'s Harnesses: Pi\'s card, plugins the one kind it can\'t hold.');
  await a.size(2560, 1440); await a.click('#nav-overview'); await shot(a, 'pi-only-2560-overview', 'The Pi-only Overview at 2560×1440: two kind cards in two columns.'); await a.size(1280, 800);
  // A folder with no tools at all: every page stays, each saying so.
  const empty = join(scratch, 'no-tools');
  mkdirSync(empty, { recursive: true });
  a.quit();
  await wait(500);
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), home: { mode: 'custom', path: empty } }));
  a = await launch();
  await a.click('#nav-overview'); await shot(a, 'no-tools-overview', 'A folder with no tools at all: the sidebar keeps Overview, History, Harnesses and Settings, and the Overview says no tools were found, with Choose another home….');
  await a.click('#nav-harnesses'); await shot(a, 'no-tools-harnesses', 'Its Harnesses page: the same sentence and action, in the same place.');
  await a.click('#nav-history'); await waitFor(a, `!!document.querySelector('#history-choose-home, .history-row')`); await shot(a, 'no-tools-history', 'Its History page: the same sentence and action, in the same place.');
  await a.size(860, 560); await a.click('#nav-overview'); await shot(a, 'no-tools-860-overview', 'The Overview at 860×560.');
  await a.click('#nav-harnesses'); await shot(a, 'no-tools-860-harnesses', 'Its Harnesses page at 860×560.');
  await a.size(1280, 800);
}

// ---------- Updates ----------
// A stand-in for GitHub's releases, and the app acting as an installed copy of v0.5.0-preview.4 (CK_UPDATE_STUB): the sidebar's
// update control at the bottom left at each step, open and in the rail at 860×560, 1280×800, 1728×1117 and 2560×1440, and the
// Settings row.
if (wanted('updates')) {
  const zip = join(scratch, 'update.zip');
  writeFileSync(zip, Buffer.alloc(4_000_000, 7));
  const releases = [{ tag: 'v0.5.0-preview.5', zip, bytesPerSecond: 400_000 }];
  const fixture = await serveReleases(releases);
  const as = tag => ({ CK_UPDATE_STUB: tag, CK_UPDATE_RELEASES: fixture.releasesUrl });
  await fresh(as('v0.5.0-preview.4'));
  begin('updates');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.run(`window.dispatchEvent(new Event('resize'))`); await a.settle(); };
  /** The state on screen at each size the UI rule names, with the sidebar as the window chooses it and then the other way. */
  const everySize = async (name, said) => {
    for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
      await size(width, height);
      const rail = await a.run(`document.body.classList.contains('rail')`);
      await shot(a, `${name}-${width}-${rail ? 'rail' : 'open'}`, `${said} At ${width}×${height}, the sidebar ${rail ? 'folded to its rail' : 'open'}.`);
      await a.click('#sidebar-toggle');
      await shot(a, `${name}-${width}-${rail ? 'open' : 'rail'}`, `The same with the sidebar ${rail ? 'open' : 'folded to its rail'}.`);
      await a.click('#sidebar-toggle');
    }
    await size(1280, 800);
  };
  await shot(a, 'check', 'The app as it opens: the sidebar ends in "Check for updates" at the bottom left, its circular arrows quiet; the status bar names the build, "Central Knot 0.5.0 preview 4".');
  await everySize('check', 'Check for updates, before the first check.');
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'available'`, 20000);
  await shot(a, 'available', 'Shortly after launch it checked GitHub by itself: a newer release, so the control stands out as "Update available" (its tooltip and name: "Update to 0.5.0 preview 5").');
  await everySize('available', 'Update available.');
  await a.click('#nav-settings');
  await shot(a, 'settings-available', 'Settings › General › Updates: the build in use and its tag, Update and Check now, and what the last check found, with the release notes.');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `settings-available-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  // An instructions draft typed and not saved holds the restart.
  const typeDraft = async () => { await a.click('#nav-instructions'); const tool = await a.run(`document.querySelector('[id^="ins-edit-"]')?.id.slice('ins-edit-'.length) ?? ''`); await a.click(`#ins-edit-${tool}`); await a.run(`(() => { const area = document.querySelector('#ins-text-${tool}'); area.value += '\\n- Not saved yet.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await a.settle(); };
  await typeDraft();
  await a.click('#update-control');
  await waitFor(a, `/Downloading… [1-9]/.test(document.querySelector('#update-control')?.textContent ?? '')`, 10000);
  await shot(a, 'downloading', 'Typed in an instruction file without saving, then clicked "Update available": the control shows the download, its progress a ring round the arrow.');
  await size(860, 560); await shot(a, 'downloading-860-rail', 'The same at 860×560, in the rail: the ring alone.');
  await a.click('#sidebar-toggle'); await shot(a, 'downloading-860-open', 'The same with the sidebar open.'); await a.click('#sidebar-toggle'); await size(1280, 800);
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'held'`, 30000);
  await shot(a, 'held', 'Downloaded and prepared. An unsaved instructions draft is waiting, so it doesn’t restart by itself: the control is an outlined "Restart to update…" with the warning mark (a click opens Settings, which says what would be lost), and the status bar says why.');
  await everySize('held', 'Restart to update, held for the unsaved draft.');
  await a.click('#nav-settings'); await shot(a, 'settings-held', 'Settings while the update waits for the restart.');
  // The next launch, as the new version: it says so once.
  const settings = join(scratch, 'data', 'app-settings.json');
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), update: { tag: 'v0.5.0-preview.5', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.5', from: 'v0.5.0-preview.4' } }));
  await fresh(as('v0.5.0-preview.5'), true);
  await waitFor(a, `/now on/.test(document.getElementById('announcement').textContent)`, 10000);
  await shot(a, 'updated', 'Opened again as 0.5.0 preview 5: the status bar says once that it is on the new version, with "Release notes".');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `updated-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  await a.click('#nav-settings'); await a.click('#check-updates'); await waitFor(a, `/Up to date/.test(document.getElementById('setting-updates').textContent)`, 10000);
  await shot(a, 'settings-up-to-date', 'Clicked "Check now": up to date.');
  await openKind(a, 'skills'); await a.click('#update-control'); await waitFor(a, `/newest release/.test(document.getElementById('announcement').textContent)`, 10000);
  await shot(a, 'sidebar-up-to-date', 'On Skills, clicked "Check for updates" in the sidebar: the status bar says what it found; the control is the quiet arrows again.');
  await a.click('#nav-settings');
  // A failed check, and a failed download.
  releases.splice(0, 1, { tag: 'v0.5.0-preview.6', zip, cut: 0.3 });
  await a.click('#check-updates'); await waitFor(a, `!!document.querySelector('#setting-update')`, 10000);
  await a.click('#setting-update'); await waitFor(a, `/didn’t finish/.test(document.getElementById('setting-updates').textContent)`, 20000);
  await shot(a, 'settings-download-failed', 'A newer release, and its download was cut off: the row says nothing changed and offers it again, and so does the sidebar ("Try the update again").');
  await size(860, 560); await shot(a, 'settings-download-failed-860', 'The same at 860×560.'); await size(1280, 800);
  await fixture.close();
  await a.click('#check-updates'); await waitFor(a, `/Couldn’t check/.test(document.getElementById('setting-updates').textContent)`, 40000);
  await shot(a, 'settings-check-failed', 'Clicked "Check now" with GitHub unreachable: the row says so; Central Knot tries again later.');
  // A build that can't update itself (here: not made from a release) says why and offers the release page.
  await fresh({}, false);
  await a.click('#nav-settings');
  await shot(a, 'settings-cannot', 'A build not made from a release (a development or local build): the row says why it doesn’t update itself and offers the releases page; on a Mac the sidebar’s control is a faint "Updates" that opens this row.');
  for (const [width, height] of [[860, 560], [1728, 1117]]) { await size(width, height); await shot(a, `settings-cannot-${width}`, `The same at ${width}×${height}.`); }
  await size(1280, 800);
  // The narrowest window with the status bar at its fullest: a profile in use, and sync on with nothing managed yet. In a
  // folder home, which keeps its profile across the restart (the practice copy is made anew at each launch).
  const again = await serveReleases([{ tag: 'v0.5.0-preview.5', zip, bytesPerSecond: 400_000 }]);
  const narrowAs = tag => ({ CK_UPDATE_STUB: tag, CK_UPDATE_RELEASES: again.releasesUrl });
  const narrowSettings = join(scratch, 'data', 'app-settings.json');
  const reopen = async (tag, change) => {
    a.quit(); await wait(500);
    writeFileSync(narrowSettings, JSON.stringify({ ...JSON.parse(readFileSync(narrowSettings, 'utf8')), ...change }));
    a = await launch(narrowAs(tag));
    await size(860, 560);
  };
  await fresh({ CK_UPDATE_RELEASES: again.releasesUrl });
  const folder = join(scratch, 'update-home');
  cpSync(join(root, 'fixtures/home'), folder, { recursive: true });
  await reopen('v0.5.0-preview.4', { home: { mode: 'custom', path: folder } });
  // Nothing is in Central Knot in this fresh home, so the new, empty profile is the one in use: the status bar names it.
  await a.click('#nav-profiles'); await a.click('#profile-new');
  await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = 'Incident'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await a.settle();
  await a.run(`document.activeElement?.blur()`);
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'available'`, 20000);
  await shot(a, 'narrow-update', 'At 860×560 in a folder home with a profile in use ("Incident") and sync on with nothing managed yet, a newer release is found: the rail’s last icon stands out; the status bar keeps the version.');
  await typeDraft();
  await a.click('#update-control');
  await waitFor(a, `/Downloading… [1-9]/.test(document.querySelector('#update-control')?.textContent ?? '')`, 10000);
  await shot(a, 'narrow-downloading', 'Typed in an instruction file without saving, then clicked it: the ring shows the download.');
  await waitFor(a, `document.querySelector('#update-control')?.dataset.look === 'held'`, 30000);
  await shot(a, 'narrow-held', 'Downloaded and prepared; an unsaved instructions draft is waiting, so the control is the outlined "Restart to update…", with the warning mark. The message is only its mark at this width (its words are the mark’s tooltip, and the control’s).');
  await reopen('v0.5.0-preview.5', { update: { tag: 'v0.5.0-preview.5', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.5', from: 'v0.5.0-preview.4' } });
  await waitFor(a, `/now on/.test(document.getElementById('announcement').textContent)`, 10000);
  await shot(a, 'narrow-updated', 'Opened again as 0.5.0 preview 5 at 860×560, the profile still in use: the version alone at the end, and the note that it is on the new version as its mark.');
  await a.click('#nav-settings');
  await shot(a, 'narrow-settings-updated', 'Settings at 860×560 on that launch: the Updates row says it was updated, with the release notes.');
  await size(1280, 800);
  await shot(a, 'settings-updated', 'The same at 1280×800.');
  await again.close();
}

// ---------- Settings ----------
if (wanted('settings')) {
  await fresh();
  begin('settings');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.settle(); };
  await a.click('#nav-settings');
  for (const [width, height] of [[860, 560], [1280, 800], [1728, 1117], [2560, 1440]]) {
    await size(width, height);
    await a.theme('dark'); await shot(a, `settings-${width}-dark`, `Settings at ${width}×${height}, dark. Start at sign-in is off and disabled in this dev build, its reason in the hint’s place.`);
    await a.theme('light'); await shot(a, `settings-${width}-light`, `Settings at ${width}×${height}, light.`);
  }
  await size(860, 560); await a.theme('dark');
  // Keyboard: the chosen card is the group's one Tab stop; the right arrow moves to Light and chooses it, with the focus ring.
  await a.run(`document.querySelector('#appearance-system').focus()`);
  for (const type of ['keyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await a.settle(); await shot(a, 'settings-keyboard', 'Focused the System card (the group\'s Tab stop) and pressed the right arrow: Light is chosen, and the focus ring moved with it.');
  for (const type of ['keyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await a.settle();
  // A save that fails: the settings file is made read-only, then Light is clicked.
  const file = join(scratch, 'data/app-settings.json');
  chmodSync(file, 0o444);
  await a.click('#appearance-light'); await shot(a, 'settings-save-failed-dark', 'Pressed the right arrow again (Dark), then made the settings file read-only and clicked Light: the row says in plain words what happened and what to do, and Dark stays chosen.');
  await a.theme('light'); await shot(a, 'settings-save-failed-light', 'The same, light (the system appearance is light; the app is still set to Dark).');
  chmodSync(file, 0o644);
  // The tour's clicks don't move focus as a real click would: let the keyboard focus go so no card keeps its ring.
  await a.run(`document.activeElement?.blur()`);
  await a.click('#appearance-system');
  // The log. Made longer than a page first, its oldest line a stack trace with no space to break at, so earlier lines and wrapping show.
  const logFile = join(scratch, 'data/central-knot.log');
  const stackLine = `2026-11-17T09:00:00.000Z request sync:apply failed: Error: ENOENT at ${'/very/long/path/without/a/space'.repeat(12)}`;
  writeFileSync(logFile, [stackLine, ...Array.from({ length: 450 }, (_, n) => `2026-11-17T09:00:01.000Z filler line ${n + 1}`)].join('\n') + '\n' + (existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''));
  await a.theme('dark'); await a.click('#show-log');
  for (const [width, height] of [[860, 600], [1280, 800], [1728, 1080], [2560, 1440]]) {
    await size(width, height); await a.run(`window.dispatchEvent(new Event('resize'))`); await a.click('#log-refresh');
    await shot(a, `settings-show-log-${width}`, `Clicked "Show log" at ${width}×${height}: the log's last 200 lines under the Log row, oldest first, the page scrolled so the newest is in view; under them, that the times are UTC and Refresh log, Hide log and Open log folder (the row's own Hide log and Open log folder are far above).`);
  }
  await size(1280, 800); await a.run(`window.dispatchEvent(new Event('resize'))`);
  await a.theme('light'); await a.click('#log-refresh'); await shot(a, 'settings-show-log-light', 'The same at 1280×800, light.'); await a.theme('dark');
  await size(860, 600); await a.run(`window.dispatchEvent(new Event('resize'))`);
  await a.click('#sidebar-toggle'); await shot(a, 'settings-sidebar-open-860', 'At 860×600, the sidebar opened from its rail: every page’s name shows whole, Plugin marketplaces and Library sources too.'); await a.click('#sidebar-toggle');
  await a.run(`document.querySelector('#log-earlier').scrollIntoView({ block: 'start' }); document.querySelector('#settings-scroll').scrollTop -= 120`);
  await shot(a, 'settings-log-earlier', 'Scrolled up to the top of the lines at 860×600: "Show 200 earlier lines" above them.');
  while (await a.has('#log-earlier')) await a.click('#log-earlier');
  await shot(a, 'settings-log-start', 'Clicked it until the log’s start (at 860×600): each click brought its lines in under the button, which stayed where it was; now the line says this is the start of the log, and the first line, a stack trace with no space in it, wraps: nothing is wider than the page.');
  renameSync(logFile, `${logFile}.aside`); await a.click('#log-refresh');
  await shot(a, 'settings-log-empty', 'With no log file yet (moved aside), Refresh log: "Nothing has been logged yet.", with Refresh log, Hide log and Open log folder.');
  renameSync(`${logFile}.aside`, logFile);
  await size(1280, 800); await a.run(`window.dispatchEvent(new Event('resize'))`);
  await a.click('#log-foot-show-log'); await a.click('#open-log-folder');
  await shot(a, 'settings-open-log-folder', 'Hid the log, then clicked "Open log folder". On Linux the app opens the log\'s folder (here a stand-in file manager) and the row says which file to look for. macOS and Windows select the file instead and add no line.');
  await a.theme('light'); await shot(a, 'settings-open-log-folder-light', 'The same, light.'); await a.theme('dark');
  await size(860, 560); await a.run(`window.dispatchEvent(new Event('resize'))`);
  // Keep history for. History is given changes 3, 12 and 25 days old; shortening to 7 days asks first, then History keeps only the newest.
  // Nothing is managed yet, so this home has no sync record: a shorter window is saved, and its History is cut the next time Central Knot records a change there.
  await keepFor(a, 7); await a.click('#history-shorten'); await wait(300); await a.settle();
  await shot(a, 'settings-history-saved-for-later', 'Shortened to 7 days in a home that doesn’t sync yet (nothing managed): the window is saved, and the row says (with the neutral info glyph) that older History no longer shows and goes the next time Central Knot records a change in this home, not that it was removed. The Open log folder note from the step before is gone: one finished note at a time.');
  await keepFor(a, 30);
  // From here the home syncs (everything managed, as in the sync tour), so shortening removes older History at once.
  await openKind(a, 'skills');
  await turnOnRow('skills', 'standup');
  await a.click('#nav-settings');
  mkdirSync(join(practice, '.central-knot'), { recursive: true });
  writeFileSync(join(practice, '.central-knot/history.json'), JSON.stringify({ events: [
    { id: 'tour-25', at: new Date(Date.now() - 25 * DAY).toISOString(), key: 'standup', item: 'standup', kind: 'deleted', winner: { tool: 'copilot-cli', hash: 'a'.repeat(64) }, losers: [], orderProved: true, previous: 'a'.repeat(64) },
    { id: 'tour-12', at: new Date(Date.now() - 12 * DAY).toISOString(), key: 'review', item: 'review', kind: 'chosen', winner: { tool: 'copilot-cli', hash: 'b'.repeat(64) }, losers: [{ tool: 'claude-cli', hash: 'c'.repeat(64) }], orderProved: true },
    { id: 'tour-3', at: new Date(Date.now() - 3 * DAY).toISOString(), key: 'release-notes', item: 'release-notes', kind: 'edit', winner: { tool: 'claude-cli', hash: 'd'.repeat(64) }, losers: [{ tool: 'copilot-cli', hash: 'e'.repeat(64) }], orderProved: true, previous: 'e'.repeat(64) },
  ] }));
  await a.click('#nav-history'); await shot(a, 'history-before-shorten', 'History before the window changes: kept for 30 days (the default), it lists changes from 3, 12 and 25 days ago.');
  await a.click('#nav-settings');
  await a.run(`document.querySelector('#history-days').focus()`);
  await shot(a, 'settings-history-select', 'The Keep history for select, focused (7, 30 or 90 days; 30 by default). Its menu is the system’s own, which a screenshot can’t catch.');
  await keepFor(a, 7);
  await shot(a, 'settings-history-confirm-dark', 'Chose 7 days: a shorter window removes History, so the row asks first, naming the local date and time it will cut from. The select still shows the saved 30 days.');
  await a.theme('light'); await shot(a, 'settings-history-confirm-light', 'The same, light.'); await a.theme('dark');
  // Keyboard focus on each of the question's buttons, both themes: the danger button's ring sits outside its red fill.
  for (const [id, name] of [['history-shorten', 'shorten'], ['history-shorten-cancel', 'keep']]) {
    await a.run(`document.querySelector('#${id}').focus()`);
    await shot(a, `settings-history-focus-${name}-dark`, `Keyboard focus on "${name === 'shorten' ? 'Shorten to 7 days' : 'Keep 30 days'}", dark.`);
    await a.theme('light'); await shot(a, `settings-history-focus-${name}-light`, 'The same, light, on the pale danger notice.'); await a.theme('dark');
  }
  await a.run(`document.activeElement?.blur()`);
  await size(1728, 1117); await shot(a, 'settings-history-confirm-1728', 'The same at 1728×1117: the question is as wide as its words and buttons, not a band across the row.');
  await size(2560, 1440); await shot(a, 'settings-history-confirm-2560', 'The same at 2560×1440: still only as wide as its content.'); await size(860, 560);
  await a.click('#history-shorten-cancel'); await shot(a, 'settings-history-cancelled', 'Clicked "Keep 30 days" (Cancel): the question goes, nothing is saved (still 30 days), and the focus is back on the select.');
  await keepFor(a, 7);
  // Main carries out the change in its turn, after any sync pass: held here so the row's waiting state can be seen.
  const main = a.main && await a.main();
  const held = main && await holdQueue(main, a);
  await a.click('#history-shorten');
  if (held) {
    await shot(a, 'settings-history-updating', 'Clicked "Shorten to 7 days" while main is busy (held, as a long sync pass would): the row says History is updating, and its select takes no other change until main is done.');
    await held.release(); main.close();
  }
  await wait(300); await a.settle();
  await shot(a, 'settings-history-shortened', 'Shortened to 7 days: saved, the select shows it, and the row says (with a check) from when History was removed.');
  await a.theme('light'); await shot(a, 'settings-history-shortened-light', 'The same, light.'); await a.theme('dark');
  await a.click('#nav-history'); await shot(a, 'history-after-shorten', 'History after shortening to 7 days: only the change from 3 days ago is left, and the intro says how long History keeps changes.');
  await a.click('#nav-settings'); await keepFor(a, 30);
  // A shorten whose removal fails (the home's History folder made read-only): the window is saved anyway, and the row says what didn't happen.
  const store = join(practice, '.central-knot');
  chmodSync(store, 0o555);
  await keepFor(a, 7); await a.click('#history-shorten'); await wait(300); await a.settle();
  await shot(a, 'settings-history-prune-failed', 'Shortened to 7 days with the home’s History folder read-only: the window is saved (the select shows 7). The row says in red that the older History couldn’t be removed; what happens next and where to look follow in the hint colour.');
  await a.theme('light'); await shot(a, 'settings-history-prune-failed-light', 'The same, light.'); await a.theme('dark');
  chmodSync(store, 0o755);
  await keepFor(a, 30); await a.run(`document.activeElement?.blur()`);
  // A wide row's hover: pointing at the Log info mark lights the whole row, out to its button.
  await size(1728, 1117);
  const hint = await a.run(`(() => { const box = document.querySelector('#setting-log-info').getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; })()`);
  await shot(a, 'settings-row-hover-1728', 'At 1728×1117, the pointer on the Log info mark: the whole row lights up, tying the text to its button far to the right.', hint);
  await size(860, 560);
  // The narrowest row: no real window reaches it (the window is at least 860 wide and has no zoom), so this emulates a
  // 573-px-wide page (860 at 150% zoom) with the sidebar open, to show the control moving under its text.
  await a.send('Emulation.setDeviceMetricsOverride', { width: 573, height: 373, deviceScaleFactor: 3, mobile: false }); await a.settle();
  const railed = await a.has('.rail');
  if (railed) await a.click('#sidebar-toggle');
  await shot(a, 'settings-narrow-stacked', 'Emulated: a 573×373 page (860×560 at 150% zoom, which the app does not offer) with the sidebar open, so each row is under 512px: the controls sit under their text, left-aligned.');
  await keepFor(a, 7); await a.run(`document.querySelector('#setting-history').scrollIntoView({ block: 'start' })`);
  await shot(a, 'settings-narrow-question', 'The same stacked layout with the shorten question open: its buttons wrap under the words and start at the left, like the select above them.');
  await a.click('#history-shorten-cancel'); await a.run(`document.activeElement?.blur()`);
  if (railed) await a.click('#sidebar-toggle');
  await size(860, 560);
  // Start at sign-in as an installed app on macOS or Windows would show it. This Linux dev run can't register a login item,
  // so main stands in as an installed app with the system's login-item answer (see standIn), and the window is refocused so the
  // page reads it again, as it does when someone comes back from System Settings.
  if (a.main && process.platform === 'linux') {
    // Opened afresh, so the earlier rows' notes are gone.
    await openKind(a, 'skills'); await a.click('#nav-settings');
    const main = await a.main();
    await standIn(main, 'win32');
    const system = async (platform, login) => { await main.run(`(ck.as(${JSON.stringify(platform)}), ck.login = ${JSON.stringify(login)})`); await refocus(main); await a.settle(); };
    const both = async (name, caption) => { await shot(a, `${name}-dark`, caption); await a.theme('light'); await shot(a, `${name}-light`, 'The same, light.'); await a.theme('dark'); };
    const press = async (key, code, keyCode, modifiers = 0) => { for (const type of ['rawKeyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, modifiers }); await a.settle(); };
    await system('win32', { on: true, enabled: true });
    await shot(a, 'settings-sign-in-on', 'Stand-in system: an installed app on Windows, starting at sign-in. The switch is on and the hint says what it does.');
    // Keyboard focus: from the Appearance cards, Shift+Tab goes back to the switch.
    await a.run(`document.querySelector('#appearance-system').focus()`);
    await press('Tab', 'Tab', 9, 8);
    await both('settings-sign-in-focused', `Focused the Appearance cards and pressed Shift+Tab: the switch has the focus ring, outside its track (${await a.run(`document.activeElement.id + (document.activeElement.matches(':focus-visible') ? ', focus-visible' : '')`)}).`);
    await a.run(`document.activeElement?.blur()`);
    await system('win32', { on: true, enabled: false });
    await both('settings-sign-in-turned-off', 'Stand-in system: Windows, turned off in Startup apps (perhaps on purpose). Off; the hint still says what it does, and beneath it a calm grey line says where it was turned off, with Open Startup apps right after the text.');
    // Keyboard focus on the line's action: Tab from the switch goes to it.
    await a.run(`document.querySelector('#start-at-sign-in').focus()`);
    await press('Tab', 'Tab', 9);
    await a.theme('light');
    await shot(a, 'settings-sign-in-action-focused-light', `Light. Focused the switch and pressed Tab: Open Startup apps has the focus ring (${await a.run(`document.activeElement.id + (document.activeElement.matches(':focus-visible') ? ', focus-visible' : '')`)}).`);
    await a.theme('dark');
    await a.run(`document.activeElement?.blur()`);
    await system('win32', { on: false, enabled: true, ignore: true });
    await a.click('#start-at-sign-in');
    await both('settings-sign-in-unchanged', 'Stand-in system: Windows, which ignores the change. Clicked the switch: it stays Off, and the row says in amber that the system didn’t change it, with Open Startup apps.');
    // macOS: the hint names the menu bar once the page knows it runs on a Mac, so it is reloaded as one (main names the Login Items).
    const agent = await a.run('navigator.userAgent');
    const reloadAs = async userAgent => { await a.send('Emulation.setUserAgentOverride', { userAgent }); await a.send('Page.reload'); await wait(1500); await a.settle(); await a.click('#nav-settings'); };
    await system('darwin', { on: true, status: 'requires-approval' });
    await reloadAs(agent.replace(/\(X11;[^)]*\)/, '(Macintosh; Intel Mac OS X 10_15_7)'));
    await both('settings-sign-in-approval', 'Stand-in system: an installed app on macOS whose login item is off in Login Items (waiting for approval, or turned off there on purpose: macOS reports both alike). The switch shows Off, the system’s answer; the hint stays, and beneath it a calm grey line, true either way, with Open Login Items. (With main standing in as an installed app, the sidebar leaves out the Practice copy, as a released app does.)');
    // Back to this Linux dev run: the row is off and disabled again, with its reason.
    await main.run(`ck.restore()`);
    await reloadAs(agent);
    main.close();
  }
  await openKind(a, 'skills'); await shot(a, 'skills-860-unchanged', 'Another page at 860×560 for comparison: Skills, unchanged by the Settings work.');
  await size(1280, 800);
}

// ---------- Base instructions ----------
if (wanted('base')) {
  begin('base');
  await a.click('#nav-instructions');
  await waitFor(a, `!!document.querySelector('#base-card')`);
  await a.run(`(() => { document.activeElement?.blur(); document.querySelector('#instructions-scroll').scrollTop = 0; })()`);
  await shot(a, 'base-start', 'Clicked "Instructions". The Base instructions card is at the top; nothing is set up yet.');
  await a.click('#base-from-claude-cli'); await shot(a, 'base-from-claude', 'Clicked "CLAUDE.md" beside "or start from".');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value += '- Write tests for every bug fix.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-review'); await shot(a, 'base-review', 'Added a line to the draft and clicked "Review changes".');
  await a.click('#base-plan-codex-cli'); await shot(a, 'base-review-file', 'Clicked "Show changes" on the Codex row.');
  await a.click('#base-save'); await wait(400); await shot(a, 'base-saved', 'Clicked "Save and update 3 files".');
  await a.click('#ins-base-codex-cli'); await a.run(`document.querySelector('#ins-base-codex-cli').scrollIntoView({ block: 'center' })`); await shot(a, 'base-strip', 'Scrolled to the Codex card and clicked "Show" on its base instructions strip.');
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value = area.value.replace('Ask before adding a new dependency.', 'Ask before adding any new dependency or service.'); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-review'); await shot(a, 'base-edit-review', 'Clicked "Edit" on the Base instructions card, changed one line, and clicked "Review changes".');
  await a.click('#base-save'); await wait(400); await shot(a, 'base-edit-saved', 'Clicked "Save and update 3 files".');
  edit(join(practice, '.codex/AGENTS.md'), text => text.replace('Run the tests', 'Run the full test suite').replace('- Write tests for every bug fix.', '- Write a test for every bug fix, first.'));
  await a.click('#header-refresh'); await waitFor(a, `!!document.querySelector('#base-restore-codex-cli')`);
  await shot(a, 'base-edited-there', 'Outside the app, edited both Codex’s own text and its copy of the base in AGENTS.md, then clicked Refresh.');
  await a.click('#base-diff-codex-cli'); await shot(a, 'base-edited-diff', 'Clicked "See the difference".');
  await a.click('#base-usecopy-codex-cli'); await shot(a, 'base-usecopy-review', 'Clicked "Use AGENTS.md’s copy as the base…".');
  await a.click('#base-back');
  await a.click('#base-restore-codex-cli'); await shot(a, 'base-put-back-review', 'Cancelled, then clicked "Put the base back in AGENTS.md…" instead.');
  await a.click('#base-save'); await shot(a, 'base-put-back', 'Clicked "Put the base back in AGENTS.md".');
  await a.click('#outcome-undo-base'); await wait(400); await shot(a, 'base-undo', 'Clicked "Undo" on the result.');
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit'); await a.click('#base-tool-copilot-cli'); await a.click('#base-review');
  await shot(a, 'base-untick-review', 'Clicked "Edit text or tools", unticked Copilot CLI, and clicked "Review changes".');
  await a.click('#base-back'); await a.click('#base-cancel'); if (await a.has('#base-discard')) await a.click('#base-discard');
  // Stop sharing with every tool: Codex's hand-edited copy stays, and its card offers taking the block out.
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit'); await a.click('#base-stop');
  await shot(a, 'base-stop-review', 'Clicked "Edit text or tools", then "Stop sharing with every tool…".');
  await a.click('#base-save'); await shot(a, 'base-stopped', 'Clicked the save button.');
  await a.run(`document.querySelector('#ins-base-out-codex-cli')?.scrollIntoView({ block: 'center' })`);
  await shot(a, 'base-stray-block', 'Scrolled to Codex: its edited block stays, with "Take the block out…".');
  await a.click('#ins-base-out-codex-cli'); await shot(a, 'base-take-out-review', 'Clicked "Take the block out…".');
  await a.click('#ins-back-codex-cli');
  // Share it with every tool again for the steps below.
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit');
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli']) await a.click(`#base-tool-${tool}`);
  await a.click('#base-review'); await a.click('#base-save');
  await a.click('#ins-edit-claude-cli'); await shot(a, 'base-own-edit', 'Clicked "Edit" on Claude Code’s card: the editor holds only Claude Code’s own instructions.');
  await a.click('#ins-cancel-claude-cli');
  await a.theme('light'); await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`); await shot(a, 'base-light', 'The same page in the light appearance.'); await a.theme('dark');
  for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 2000 ? 1 : 2, mobile: false }); await a.settle();
    await shot(a, `base-${width}`, `The window at ${width}×${height}.`);
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.run(`document.querySelector('#base-restore-codex-cli')?.scrollIntoView({ block: 'center' })`);
  await shot(a, 'base-860-conflict', 'At 860×560: the edited copy in AGENTS.md with its difference and both choices.');
  await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
  await a.click('#base-edit');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value += '- One more shared line.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-review'); await a.click('#base-review-discard');
  await a.run(`document.querySelector('#base-review-discard-yes').scrollIntoView({ block: 'center' })`);
  await shot(a, 'base-860-review-discard', 'At 860×560: Edit text or tools, added a line, Review changes, then Discard changes (the question is open).');
  await a.click('#base-review-discard-yes');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
}

// ---------- Scrolled pages: sticky headers and toolbars (last: it adds a lot to the practice copy) ----------
if (wanted('scroll')) {
  begin('scroll');
  // Stand-in CLIs (they answer --version and refuse anything else), so the plugin boxes are live and the column header
  // shows its "Click a box…" hint, as on a computer with the tools installed. Nothing is clicked, so nothing runs.
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const [name, version] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.'], ['codex', 'codex-cli 0.142.3']]) {
    writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`);
    chmodSync(join(HOME, '.local/bin', name), 0o755);
  }
  // A marketplace long enough to scroll (35 plugins), and a second one so the header shows "Refresh all".
  const long = join(scratch, 'long-market');
  writeMarket(long, 'long-list');
  edit(join(long, '.claude-plugin/marketplace.json'), text => JSON.stringify({ ...JSON.parse(text), plugins: Array.from({ length: 35 }, (_, index) => ({
    name: `team-plugin-${String(index + 1).padStart(2, '0')}`, source: './plugins/issue-tracker', category: index % 3 ? 'development' : 'productivity',
    description: index % 2 ? 'MCP server for the team tracker, with skills for triage' : 'A longer description that goes on for a while to show how a row with plenty of text wraps or ends with an ellipsis at narrow sizes',
  })) }, null, 2));
  const second = join(scratch, 'second-market');
  writeMarket(second, 'second-list');
  await a.click('#nav-plugins');
  for (const source of [long, second]) await addMarketplace(a, source);
  await a.run(`[...document.querySelectorAll('.market-item')].find(item => /long-list/.test(item.textContent))?.click()`); await a.settle();
  // Enough skills, MCP servers and agents in the practice copy that every table scrolls at every size.
  for (let index = 1; index <= 40; index++) {
    const name = `extra-${String(index).padStart(2, '0')}`;
    for (const tool of index % 2 ? ['.claude'] : ['.claude', '.copilot']) {
      mkdirSync(join(practice, tool, 'skills', name), { recursive: true });
      writeFileSync(join(practice, tool, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: An extra skill so the table scrolls.\n---\n\nFollow the steps.\n`);
    }
    writeFileSync(join(practice, '.claude/agents', `${name}.md`), `---\nname: ${name}\ndescription: An extra agent so the table scrolls.\n---\n\nDo the task.\n`);
  }
  edit(join(practice, '.copilot/mcp-config.json'), text => {
    const config = JSON.parse(text);
    for (let index = 1; index <= 40; index++) config.mcpServers[`extra-${String(index).padStart(2, '0')}`] = { type: 'local', command: 'npx', args: ['-y', `@example/extra-${index}`], tools: ['*'] };
    return JSON.stringify(config, null, 2);
  });
  await a.click('#header-refresh');
  const sizes = [[860, 560, 2], [1280, 800, 2], [1728, 1117, 1], [2560, 1440, 1]];
  // Scrolls the page's main scroller (the tallest one that can scroll) by `by` pixels, so sticky parts are tested over rows.
  // Returns what scrolled and how far its pinned column header sits below the scroller's top (0 when the stack is right).
  const scroll = by => a.run(`(() => {
    const box = [...document.querySelectorAll('#page .scroll')].filter(e => e.scrollHeight > e.clientHeight).sort((x, y) => y.clientHeight - x.clientHeight)[0];
    if (!box) return 'nothing scrolls';
    box.scrollTop = ${by};
    const head = box.querySelector('.ov-head');
    if (!head) return box.id || box.className;
    return (box.id || box.className) + '; column header ' + Math.round(head.getBoundingClientRect().top - box.getBoundingClientRect().top) + 'px below the scroller top';
  })()`);
  for (const page of ['plugins', 'overview', 'library', 'settings']) {
    if (!(await a.has(`#nav-${page}`))) continue;
    await a.click(`#nav-${page}`);
    // On an item page the first row is opened first, so the scroll goes past an opened row: it goes up with the list.
    const first = await a.run(`document.querySelector('.ov-row[data-key] .row-open')?.id ?? ''`);
    if (first) await a.click(`#${first}`);
    for (const [width, height, scale] of sizes) {
      await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
      for (const theme of ['dark', 'light']) {
        await a.theme(theme);
        const what = await scroll(Math.round(height * 0.4)); await wait(100);
        await shot(a, `${page}-${width}-${theme}`, `${page} at ${width}×${height}, ${theme}, ${first ? 'its first row opened, ' : ''}main list scrolled down ${Math.round(height * 0.4)}px (${what}).`);
      }
      await scroll(0);
    }
    if (first) await a.click(`#${first}`);
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await a.theme('dark');
}

// ---------- Harnesses ----------
if (wanted('harnesses')) {
  await fresh();
  begin('harnesses');
  const size = async (width, height) => { await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); await a.run(`window.dispatchEvent(new Event('resize'))`); await a.settle(); };
  const sizes = async (name, caption) => {
    for (const [width, height] of [[860, 560], [1728, 1117], [2560, 1440]]) for (const theme of ['dark', 'light']) { await size(width, height); await a.theme(theme); await shot(a, `${name}-${width}-${theme}`, `${caption} Window ${width}×${height}, ${theme} appearance.`); }
    await a.theme('dark'); await size(1280, 800);
  };
  await a.click('#nav-harnesses'); await waitFor(a, `!/…/.test(document.querySelector('.harness-cards')?.textContent ?? '…')`);
  await shot(a, 'list-dark', 'Clicked "Harnesses" in the sidebar: one card per tool with what it has. Window 1280×800.');
  await a.theme('light'); await shot(a, 'list-light', 'The same, light appearance.'); await a.theme('dark');
  await sizes('list', 'The Harnesses list.');
  if (await a.has('[id^="harness-claude-cli-differ-"]')) { await a.click('[id^="harness-claude-cli-differ-"]'); await shot(a, 'claude-differ-link', 'Clicked "1 skill with different copies" on the Claude Code card: its page, showing only those.'); await a.run(`[...document.querySelectorAll('.chip')].find(chip => chip.textContent.trim() === 'All')?.click()`); await a.settle(); await a.click('#harness-back'); }
  await a.click('#harness-claude-cli'); await shot(a, 'claude-skills', 'Clicked the Claude Code heading: its page, on the Skills tab. Its column comes first; skills only other tools have are under "Not in Claude Code".');
  await sizes('claude-skills', 'Claude Code’s Skills tab.');
  if (await a.has(`#${rowPart('add', 'skills', 'standup')}, #${rowPart('switch', 'skills', 'standup')}:not([aria-checked="true"])`)) { await turnOnRow('skills', 'standup'); await shot(a, 'claude-switched', 'Turned standup on from Claude Code’s page: it is copied to every tool at once.'); }
  await a.click(`#${rowPart('open', 'skills', 'release-notes')}`); await shot(a, 'claude-details', 'Opened release-notes’ details from its row.');
  await a.click('#harness-tab-mcp'); await shot(a, 'claude-mcp', 'Clicked the "MCP servers" tab.');
  await a.click('#harness-tab-agents'); await shot(a, 'claude-agents', 'Clicked the "Agents" tab.');
  await a.click('#harness-tab-instructions'); await waitFor(a, `!!document.querySelector('#ins-edit-claude-cli')`); await shot(a, 'claude-instructions', 'Clicked the "Instructions" tab: Claude Code’s own file, editable here.');
  await sizes('claude-instructions', 'The Instructions tab.');
  await a.click('#ins-edit-claude-cli'); await shot(a, 'claude-instructions-editing', 'Clicked Edit.');
  await size(860, 560); await shot(a, 'claude-instructions-editing-860', 'Editing at 860×560.');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value += '- A line added in the tour, long enough to show how the review wraps a changed line at the smallest window size.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  if (await a.has('#ins-review-claude-cli')) { await a.click('#ins-review-claude-cli'); await shot(a, 'claude-instructions-review-860', 'Added a line and clicked "Review changes" at 860×560: the diff before saving.'); }
  await size(1280, 800);
  // Throw the tour's line away and edit afresh for the next shot.
  for (const id of ['#ins-back-claude-cli', '#ins-cancel-claude-cli', '#ins-discard-claude-cli']) if (await a.has(id)) await a.click(id);
  await a.click('#ins-edit-claude-cli');
  await size(2560, 1440); await shot(a, 'claude-instructions-editing-2560', 'Editing at 2560×1440: the editor keeps a reading measure.'); await size(1280, 800); if (await a.has('#ins-cancel-claude-cli')) await a.click('#ins-cancel-claude-cli');
  // With the Plugins tour in this run, turn document-tools on from team-tools so this tab has something to show.
  if (wanted('plugins')) {
    await ensureMarket(); await waitFor(a, `!!document.querySelector('#popen-0-document-tools')`); await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-group')`);
    if (await a.has('#pswitch-page-0-document-tools[aria-checked="false"]:not([disabled])')) { await a.click('#pswitch-page-0-document-tools'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 60000); await a.settle(); }
    await a.click('#nav-harnesses'); await a.click('#harness-claude-cli');
  }
  await a.click('#harness-tab-plugins'); await waitFor(a, `!/Reading/.test(document.querySelector('#harness-body')?.textContent ?? '')`); await shot(a, 'claude-plugins', 'Clicked the "Plugins" tab: plugins installed in Claude Code, each opening its page on Plugin marketplaces.');
  await a.click('#harness-tab-about'); await shot(a, 'claude-about', 'Clicked the "About" tab: how it was found and where its files are.');
  await sizes('claude-about', 'The About tab.');
  await a.click('#harness-switch-copilot-cli'); await a.click('#harness-tab-skills'); await shot(a, 'copilot-skills', 'Clicked Copilot CLI in the switcher at the top right, then the Skills tab.');
  await a.theme('light'); await shot(a, 'copilot-skills-light', 'The same, light appearance.'); await a.theme('dark');
  // A mouse click (detail 1), as a person makes it; a scripted click() reads as the keyboard.
  await a.run(`document.querySelector('#harness-back').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))`); await a.settle(); await shot(a, 'back', 'Clicked "Harnesses" in the header’s breadcrumb with the mouse.');
  // A fourth harness: Pi, with one skill of its own, so the table has four tool columns.
  const piSkill = join(practice, '.pi/agent/skills/pi-notes');
  mkdirSync(piSkill, { recursive: true });
  writeFileSync(join(piSkill, 'SKILL.md'), '---\nname: pi-notes\ndescription: Notes kept in Pi only.\n---\n\nWrite short notes.\n');
  // And a skill with a long name and a long description, to see how rows fit.
  const longSkill = join(practice, '.claude/skills/summarise-incident-timeline-from-pager-and-chat-logs');
  mkdirSync(longSkill, { recursive: true });
  writeFileSync(join(longSkill, 'SKILL.md'), '---\nname: summarise-incident-timeline-from-pager-and-chat-logs\ndescription: Builds a minute-by-minute incident timeline from pager alerts, chat threads and deploy logs, then drafts the summary section of the postmortem with owners and open questions.\n---\n\nRead the logs.\n');
  await a.click('#header-refresh'); await a.settle();
  await shot(a, 'four-list', 'Added a Pi skills folder with one skill to the practice copy, then clicked Refresh: four harnesses.');
  await a.click('#harness-pi-cli'); await a.click('#harness-tab-skills');
  for (const [width, height] of [[860, 560], [1150, 800], [1280, 800], [1728, 1117]]) { await size(width, height); await shot(a, `pi-skills-${width}`, `Pi's page, Skills tab, with four tool columns. Window ${width}×${height}.`); }
  await size(860, 560);
  const last = await a.run(`[...document.querySelectorAll('.ov-head .tool-head-button')].at(-1)?.id`);
  if (last) { await a.click(`#${last}`); await shot(a, 'last-menu-860', 'Clicked the right-most column header at 860×560: its menu stays inside the window.'); await a.click(`#${last}`); }
  await a.click('#harness-tab-agents'); await shot(a, 'pi-agents-860', 'Pi’s Agents tab: Pi holds none of them yet; the agents the other tools have are under “Not in Pi”, each with Add (in Pi an agent is a skill).');
  await a.click('#harness-tab-skills'); if (!(await a.has(`.ov-row.open[data-key="${rowPart('', 'skills', 'release-notes')}"]`))) await a.click(`#${rowPart('open', 'skills', 'release-notes')}`); await shot(a, 'pi-details-860', 'Opened release-notes on Pi’s page at 860×560: each tool’s own switch in its details.');
  await size(1280, 800);
  // This computer's home (in the tour, an empty throwaway folder on Linux): detection, a Not found card, and its header.
  await a.click('#home-actual'); await a.click('#nav-harnesses'); await shot(a, 'this-computer-list', 'Clicked "This Mac’s home" ("This computer’s home" off macOS) at the bottom left, then Harnesses: each tool with how it was found; tools not found have a card that does not open.');
}

// ---------- A tool's Manage switch (Harnesses cards; toolchoice.ts) ----------
if (wanted('manage')) {
  await fresh();
  begin('manage');
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  // notes and standup On in every tool first, so Codex has copies of Central Knot's to keep, or lose, while it is left out.
  await openKind(a, 'skills');
  for (const key of ['notes', 'standup']) { await turnOnRow('skills', key); await switchOn('skills', key); }
  await a.click('#nav-harnesses'); await waitFor(a, `!/…/.test(document.querySelector('.harness-cards')?.textContent ?? '…')`);
  await atEverySize('all-managed', 'Harnesses with every tool managed: each card has its Manage switch on, and the line under it says what turning it off leaves as it is', true);
  await focusOn('#manage-codex-cli'); await shot(a, 'switch-focus', 'Keyboard focus on Codex’s Manage switch, with its ring.');
  await a.click('#manage-codex-cli');
  await atEverySize('codex-left-out', 'Clicked Codex’s switch: the band says Codex is left out and its copies stay; its card has no counts, and its line says no item in Codex would change on turning it on, and two found items would show under Found', true);
  // While Codex is left out: its copy of notes is edited by hand, and standup is turned off in Central Knot.
  edit(join(practice, '.codex/skills/notes/SKILL.md'), text => text.replace(/\n*$/, '\nEdited in Codex while it was left out.\n'));
  await openKind(a, 'skills'); await a.click(`#${rowPart('switch', 'skills', 'standup')}`); await a.settle();
  await atEverySize('skills-one-left-out', 'Turned standup off on the Library’s skills with Codex left out: no Codex mark on any row; standup’s row and the band say no tool Central Knot manages has it');
  await a.click('#nav-overview');
  await atEverySize('overview-one-left-out', 'The Overview with Codex left out: Your tools has a row for Claude Code and Copilot CLI only, and the line under it says Codex is left out and that its switch is on Harnesses (under the fold at 860×560)');
  await a.click('#nav-harnesses'); await refresh();
  await atEverySize('codex-line-before-on', 'Edited Codex’s notes by hand, then Refresh on Harnesses: Codex’s line counts what turning it on will do there: Central Knot’s version written for one item, one copy that differs kept as a version first, one copy of an item that is off removed, and two found items', true, '#manage-codex-cli');
  await a.click('#manage-codex-cli');
  await atEverySize('codex-on-band', 'Clicked Codex’s switch again: the band says what that pass did in Codex, from its results, and that History has each change', true);
  await a.click('#nav-history'); await waitFor(a, `!!document.querySelector('.history-row')`);
  await shot(a, 'history', 'History: the two flips as Tool entries, each saying it has no Undo and that the switch is the way back; Codex’s edited notes kept as a version, with “Use Codex’s copy”; standup’s folder removed from Codex when sync reached it');
  await a.click('#nav-harnesses');
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli']) await a.click(`#manage-${tool}`);
  await atEverySize('all-left-out', 'Every tool’s switch turned off: each card says it is left out, with its line; the note at the top says Central Knot manages none, how found items come in, and that what it keeps stays kept', true);
  await a.click('#nav-overview');
  await atEverySize('overview-none-managed', 'The Overview with no tool managed: it names the tools left out and points to Harnesses; the sidebar holds only the pages that need no tool', true);
  await a.click('#overview-open-harnesses');
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli']) await a.click(`#manage-${tool}`);
}

// ---------- Git repo ----------
if (wanted('repo')) {
  await fresh();
  begin('repo');
  const sizes = async (name, caption) => {
    for (const [width, height] of [[860, 560], [1100, 720], [1728, 1117], [2560, 1440]]) {
      await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width > 2000 ? 1 : 2, mobile: false });
      await a.settle(); await shot(a, `${name}-${width}`, `${caption} At ${width}×${height}.`);
    }
    await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  };
  const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', ...args], { stdio: 'ignore' });
  // A repo someone already keeps: a README, one skill, one MCP server and one agent of theirs.
  const remote = join(scratch, 'remote', 'agent-config.git');
  const author = join(scratch, 'author');
  mkdirSync(remote, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  execFileSync('git', ['clone', '--quiet', remote, author], { stdio: 'ignore' });
  const put = (path, text) => { mkdirSync(join(author, path, '..'), { recursive: true }); writeFileSync(join(author, path), text); };
  put('README.md', '# Agent setup\n\nKept with Central Knot.\n');
  put('skills/incident/SKILL.md', '---\nname: incident\ndescription: "Runs an incident: timeline, roles, comms."\n---\n\nOpen a timeline first.\n');
  put('mcp/pagerduty.json', JSON.stringify({ type: 'http', url: 'https://mcp.pagerduty.example/mcp' }, null, 2) + '\n');
  put('agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews a change before it ships.\n---\n\nRead the diff twice.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Incident kit'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');

  await openKind(a, 'skills');
  for (const key of await a.run(`[...document.querySelectorAll('.ov-row[data-key]')].filter(row => row.querySelector(':is(.add-item, .switch:not([aria-checked="true"])):not([disabled])') && !row.querySelector('[id^="decide-"]')).map(row => row.dataset.key.slice(${rowPart('', 'skills', '').length}))`)) await turnOnRow('skills', key);
  await a.click('#nav-repo');
  await shot(a, 'repo-start-dark', 'Clicked "Git repo" in the sidebar: nothing connected yet. The page says what goes where and that nothing changes until Pull or Push.');
  await a.theme('light'); await shot(a, 'repo-start-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-start', 'The not-connected page.');
  // A wrong address first: the likeliest first-run failure.
  await a.run(`(() => { const input = document.querySelector('#repo-url'); input.value = ${JSON.stringify(join(scratch, 'remote', 'missing.git'))}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#repo-connect'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 20000); await a.settle();
  await shot(a, 'repo-connect-failed', 'Connected to an address with no repo: the band says why; the address stays in the field to fix.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-connect-failed-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  // The right address with a branch the repo doesn't have: Branch is the field marked and focused.
  await a.run(`(() => { const input = document.querySelector('#repo-url'); input.value = ${JSON.stringify(remote)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.run(`(() => { const input = document.querySelector('#repo-branch'); input.value = ${JSON.stringify('nightly')}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#repo-connect'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 20000); await a.settle();
  await shot(a, 'repo-branch-refused', 'Typed the repo’s address with Branch "nightly", which the repo doesn’t have, and clicked Connect: the band says so, and Branch is marked and focused.');
  await a.run(`(() => { const input = document.querySelector('#repo-branch'); input.value = ${JSON.stringify('')}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shot(a, 'repo-address-typed', 'Typed the repo’s address (a local repo in this tour; an https or ssh address works the same).');
  const tab = async times => { for (let i = 0; i < times; i++) { await a.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await a.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); } await wait(150); };
  await a.run(`document.querySelector('#repo-url').focus()`); await tab(2);
  await shot(a, 'repo-keyboard-connect', 'With the keyboard: from the address field, Tab twice (past Branch) reaches Connect, with its focus ring.');
  await a.click('#repo-connect');
  await waitFor(a, `!!document.querySelector('#repo-state') && !/Checking/.test(document.querySelector('#repo-state').textContent)`, 20000); await a.settle();
  await shot(a, 'repo-connected-dark', 'Clicked "Connect". The repo’s skill, MCP server and agent wait under "From the repo"; this computer’s Managed items wait under "From this computer". Nothing in the tools changed.');
  await a.theme('light'); await shot(a, 'repo-connected-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-connected', 'Connected, with changes both ways.');
  await a.theme('light'); await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-connected-860-light', 'Connected, light, at 860×560.');
  await a.theme('dark'); await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  await shot(a, 'repo-pulled', 'Clicked "Pull 3": the repo’s three items are now in the tools, Managed. Only this computer’s changes remain, ready to push.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-pulled-860', 'The same result at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-push');
  await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-pushed-dark', 'Clicked "Push": committed and pushed. Up to date.');
  await a.theme('light'); await shot(a, 'repo-pushed-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-up-to-date', 'Up to date.');
  // A commit that changes nothing Central Knot moves (the README): not up to date, since Push needs it pulled first.
  run(author, 'pull', '--quiet', 'origin', 'main');
  put('README.md', '# Agent setup\n\nKept with Central Knot. Pull before you push.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'README: pull first'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-newer-commit', 'Someone changed only the repo’s README, then clicked "Refresh": a newer commit to pull, which changes nothing in the tools.');
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  // Someone changes the incident skill in the repo, and the notes skill is edited on this computer.
  run(author, 'pull', '--quiet', 'origin', 'main');
  put('skills/incident/SKILL.md', '---\nname: incident\ndescription: "Runs an incident: timeline, roles, comms."\n---\n\nOpen a timeline first.\nPage the on-call lead.\n');
  rmSync(join(author, 'skills', 'release-notes'), { recursive: true, force: true });
  put('skills/incident-response-runbook-for-the-eu-region/SKILL.md', '---\nname: incident-response-runbook-for-the-eu-region\ndescription: The EU on-call runbook.\n---\n\nFollow the EU rota.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Page the lead'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  edit(join(practice, '.claude/skills/notes/SKILL.md'), text => text.replace(/\n*$/, '\nKeep notes short.\n'));
  await wait(3500);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-both-ways', 'The incident skill changed in the repo, notes was edited here, then clicked "Refresh". Push waits until the repo’s change is pulled.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-both-ways-860', 'The same at 860×560: the lists stack, and why Push waits sits right under its button.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  // A skill whose SKILL.md no tool can read arrives in the repo, and incident is edited here as well as there.
  run(author, 'pull', '--quiet', 'origin', 'main');
  put('skills/broken/SKILL.md', '---\nname: broken\ndescription: Has: an unquoted colon\n---\n\nNever loads.\n');
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Add broken'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  edit(join(practice, '.claude/skills/incident/SKILL.md'), text => text.replace(/\n*$/, '\nWrite the summary within a day.\n'));
  await wait(3500);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-held-and-both', 'A skill no tool can read arrived in the repo, and incident was edited on both sides, then "Refresh": the unreadable one says why it can’t come in, and incident says the repo’s version wins with yours kept in History.');
  await a.theme('light'); await shot(a, 'repo-held-and-both-light', 'The same, light.'); await a.theme('dark');
  await sizes('repo-held-and-both', 'Held and both-changed items.');
  // The repo can't be reached (its folder moved away, as a server that is down or a VPN that is off would look).
  renameSync(remote, `${remote}.away`);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await shot(a, 'repo-unreachable', 'The repo couldn’t be reached when Refresh checked it.');
  await a.theme('light'); await shot(a, 'repo-unreachable-light', 'The same, light.'); await a.theme('dark');
  await a.run(`document.querySelector('#repo-try-again')?.focus()`); await tab(0);
  await shot(a, 'repo-keyboard-try-again', 'Keyboard focus on Try again in the band.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-unreachable-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  renameSync(`${remote}.away`, remote);
  await a.click('#header-refresh');
  await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '') && document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await a.click('#repo-pull');
  await waitFor(a, `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  await shot(a, 'repo-pulled-both', 'The repo is back. Clicked "Pull": incident takes the repo’s version, notes waits to be pushed, and broken stays listed with why.');
  await a.click('#nav-history'); await shot(a, 'repo-history', 'Clicked "History": what Pull brought in, each with Undo.');
  await a.click('#nav-repo'); await waitFor(a, `!/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`, 30000); await a.settle();
  const idle = `document.body.dataset.busy !== 'true' && !/Checking/.test(document.querySelector('#repo-state')?.textContent ?? '')`;
  // Only the item that can't come in is left.
  await a.click('#repo-push'); await waitFor(a, idle, 30000); await a.settle();
  await shot(a, 'repo-held-only', 'Clicked "Push": notes went to the repo. Only broken is left, and it can’t come in.');
  // With Sync off, an agent's deletion from the repo can't finish: Pull leaves it to try again.
  run(author, 'pull', '--quiet', 'origin', 'main');
  rmSync(join(author, 'agents', 'reviewer.md'));
  run(author, 'add', '-A'); run(author, 'commit', '--quiet', '-m', 'Retire the reviewer'); run(author, 'push', '--quiet', 'origin', 'HEAD:main');
  await a.click('#sync-switch'); await a.settle();
  await a.click('#header-refresh'); await waitFor(a, idle, 30000); await a.settle();
  await shot(a, 'repo-sync-off-removal', 'Turned Automatic sync off; the repo deleted the reviewer agent, then "Refresh": the deletion waits for Automatic sync, so nothing is offered to pull but the newer commit.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-sync-off-removal-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false }); await a.settle();
  await shot(a, 'repo-sync-off-removal-2560', 'The same at 2560×1440: the note keeps a reading width.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-pull'); await waitFor(a, idle, 30000); await a.settle();
  await shot(a, 'repo-try-again', 'Clicked "Pull": this computer moved to the newer commit, and the band says reviewer still waits for Automatic sync.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-try-again-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#sync-switch'); await wait(2500); await a.settle();
  await shot(a, 'repo-pull-again-sync-on', 'Turned Automatic sync back on: the row now says to Pull again.');
  await a.click('#repo-disconnect'); await shot(a, 'repo-disconnect-confirm', 'Clicked "Disconnect…": it asks once, saying what stays; focus starts on Cancel.');
  await a.run(`document.querySelector('#repo-disconnect-confirm').focus()`); await tab(0);
  await shot(a, 'repo-keyboard-confirm', 'Keyboard focus on Disconnect, with its ring.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await shot(a, 'repo-disconnect-confirm-860', 'The same at 860×560.');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }); await a.settle();
  await a.click('#repo-disconnect-confirm'); await shot(a, 'repo-disconnected', 'Clicked "Disconnect": back to the start page; the tools are unchanged.');
}

// ---------- One install at a time (otherbuilds.ts, otherbuildview.ts): made-up bundles in the stand-in for /Applications ----------
if (wanted('remove-build')) {
  begin('remove-build');
  await fresh();
  const ALPHA_ID = 'com.centralknot.alpha';
  const installed = join(MAC.applications, 'Central Knot Alpha.app');
  const putBack = () => MAC.bundle(MAC.applications, 'Central Knot Alpha', ALPHA_ID);
  const apps = [];
  /** Stand-in copies of a build running from `paths` (one that quits when asked, or not), listed as running. */
  const running = async (paths, quits = true, id = ALPHA_ID) => { const started = await Promise.all(paths.map(() => standInApp(quits))); apps.push(...started); for (const app of started) launched.add(app); MAC.running(paths.map((path, at) => ({ bundleId: id, pid: started[at].pid, path }))); };
  const idle = `document.body.dataset.busy !== 'true'`;
  const look = async () => { await refresh(); await waitFor(a, idle, 30000); };
  // The alpha synced this home last, and kept History for 90 days there: Replace carries that over.
  mkdirSync(join(practice, '.central-knot'), { recursive: true });
  writeFileSync(join(practice, '.central-knot/sync.json'), `${JSON.stringify({ formatVersion: 2, generation: 'tour-alpha', owner: ALPHA_ID, ownerName: 'Central Knot Alpha' })}\n`);
  mkdirSync(join(scratch, ALPHA_ID), { recursive: true });
  writeFileSync(join(scratch, ALPHA_ID, 'app-settings.json'), JSON.stringify({ historyDays: 90 }));
  putBack();
  await look();
  await atEverySize('held-installed', 'Central Knot Alpha is installed in the Applications folder and syncs this home: the window shows only the held screen: where it is, what is going on and what the buttons do, Replace and Quit, then what stays, which of its choices Replace keeps, what Replace does and how to keep the alpha instead; the sidebar keeps only the update control', true);
  await shot(a, 'held-installed-hover', 'The pointer on "Replace Central Knot Alpha": its hover look (a tooltip doesn’t show in a picture).', await middleOf('#held-replace'));
  await focusOn('#held-replace'); await shot(a, 'held-installed-focus', 'Keyboard focus on "Replace Central Knot Alpha", with its ring.');
  // Refused: macOS won't move it to the Trash (the stand-in's Trash can't be written), then a copy that won't quit.
  mkdirSync(MAC.trash, { recursive: true }); chmodSync(MAC.trash, 0o555);
  await a.click('#held-replace'); await waitFor(a, idle, 30000); await a.settle();
  await atEverySize('held-refused-trash', 'Clicked Replace where macOS refuses to move it to the Trash: still held; under the buttons, that nothing else was tried and to click Refresh once it is moved, with Show in Finder');
  chmodSync(MAC.trash, 0o755);
  await running([installed], false);
  await look(); await a.click('#held-replace'); await waitFor(a, idle, 40000); await a.settle();
  await shot(a, 'held-refused-running', 'Clicked Replace while it won’t quit: after 20 seconds nothing is removed, and the screen says to quit it yourself.');
  for (const app of apps.splice(0)) app.kill('SIGKILL');
  MAC.running([]);
  await look(); await a.click('#held-replace'); await waitFor(a, idle, 30000); await a.settle();
  await atEverySize('replaced', 'Clicked Replace: the pages are back, and the band says first that this build syncs the home now and keeps the alpha’s choices (how many days of History are kept among them), then that the alpha is in the Trash');
  // Running only, from Downloads, then from the Trash (as a sign-in might start it again): Quit it in place of Replace.
  await running([MAC.bundle(join(HOME, 'Downloads'), 'Central Knot Alpha', ALPHA_ID)]);
  await look();
  await atEverySize('held-running-only', 'Running only, from Downloads: the screen says where it runs from and offers Quit Central Knot Alpha in place of Replace');
  await running([MAC.bundle(join(HOME, '.Trash'), 'Central Knot Alpha', ALPHA_ID)]);
  await look();
  await shot(a, 'held-other-from-trash', 'Running only, from the Trash: the same, with where it runs from.');
  await a.click('#held-quit-other'); await waitFor(a, idle, 30000); await a.settle();
  await shot(a, 'quit-other', 'Clicked Quit Central Knot Alpha: it quit, and the pages are back with the band, which says to turn off a sign-in start in Login Items.');
  // A custom build with a long name (60 characters).
  const long = MAC.bundle(MAC.applications, 'Acme Corporation Platform Engineering Knot for Developers 22', 'com.centralknot.custom.acme');
  await look();
  await atEverySize('held-long-name', 'A custom build with a 60-character name: found by its own name, the screen and both buttons fit', true);
  // This copy itself runs from the Trash, then from a disk image: only Quit.
  await fresh({ CK_TEST_OWN_BUNDLE: join(HOME, '.Trash/Central Knot.app') }, true);
  await look();
  await atEverySize('held-self-from-trash', 'This copy runs from the Trash: it can’t replace the other build, so it offers only Quit, and says to turn off a sign-in start');
  await fresh({ CK_TEST_OWN_BUNDLE: '/Volumes/Central Knot/Central Knot.app' }, true);
  await look();
  await shot(a, 'held-self-from-disk-image', 'This copy runs from its disk image: only Quit, and it says, without the path, to move it to Applications and open it again from there.');
  rmSync(long, { recursive: true });
  for (const app of apps.splice(0)) app.kill('SIGKILL');
  MAC.running([]);
  await fresh();
}

// ---------- Sources: a Git link read on a click (sourcespage.ts), with made-up repositories standing in for GitHub ----------
if (wanted('sources')) {
  begin('sources');
  // git's own url.<base>.insteadOf sends https://github.com/<path> to folders here: nothing reaches the network.
  const hosts = join(scratch, 'source-hosts');
  const repo = path => {
    const dir = join(hosts, 'github.com', `${path}.git`);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', dir]);
    return (files, message = 'change') => {
      for (const [file, text] of Object.entries(files)) { if (text === null) rmSync(join(dir, file), { recursive: true, force: true }); else { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); } }
      execFileSync('git', ['-C', dir, '-c', 'user.name=Stephen', '-c', 'user.email=stephen@example.com', '-c', 'commit.gpgsign=false', 'add', '--all']);
      execFileSync('git', ['-C', dir, '-c', 'user.name=Stephen', '-c', 'user.email=stephen@example.com', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message]);
    };
  };
  const skillMd = (name, body) => `---\nname: ${name}\ndescription: Find and remove the patterns that make writing read as machine-made.\n---\n\n${body}\n`;
  const deslop = repo('stephenturner/skill-deslop');
  deslop({ 'SKILL.md': skillMd('deslop', 'Read the text, list what reads as slop, and rewrite it plainly.'), 'references/phrases.md': '# Phrases\n', 'references/structures.md': '# Structures\n', 'references/examples.md': '# Examples\n', 'references/checklist.md': '# Checklist\n', 'README.md': '# skill-deslop\n', 'LICENSE': 'MIT License\n', '.gitignore': '.DS_Store\n' });
  repo('team/kit')({ 'notes/SKILL.md': '---\nname: notes\ndescription: Take notes the team’s way.\n---\n\nThe team’s notes.\n', 'release/SKILL.md': '---\nname: release\ndescription: Cut a release.\n---\n\nCut it.\n', 'agents/writer.md': '---\nname: writer\n---\nWrite.\n' });
  await fresh({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${join(hosts, 'github.com')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/' });
  const busyDone = () => waitFor(a, `document.body.dataset.busy !== 'true'`, 20000);
  const type = text => a.run(`(() => { const input = document.querySelector('#source-link'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const lookAt = async link => { await type(link); await a.click('#source-look'); await busyDone(); await a.settle(); };
  const DESLOP = 'https://github.com/stephenturner/skill-deslop/tree/main';
  await a.click('#nav-sources');
  await atEverySize('empty', 'Clicked Library sources in the sidebar: the link field, whose placeholder and the line under it name the forms a link takes (a SKILL.md’s link and github.com/owner/repo among them), Look, and a line saying what a source is');
  await lookAt(`https://github.com/stephenturner/skill-deslop/blob/main/SKILL.md`);
  await atEverySize('look-file-link', 'Pasted the link to the skill’s own SKILL.md (…/blob/main/SKILL.md) and clicked Look: it reads the folder that holds the file, the repository’s root, on branch main, and offers deslop as the folder link does', false, '#source-preview');
  await lookAt(DESLOP);
  await atEverySize('look', `Pasted the owner’s link, ${DESLOP}, and clicked Look: where it read (branch main, its root folder, the commit), one skill, deslop, named by its SKILL.md, at the root of skill-deslop; it comes in Off; its 8 files listed, SKILL.md and the four references among them. Add 1 skill, Cancel, and the line that what comes in is Off and nothing is written to the source`, true, '#source-preview');
  await a.size(860, 560); await focusOn('#source-add'); await shot(a, 'look-focus-860', 'Tabbed to Add 1 skill at 860×560: its focus ring'); await a.run('document.activeElement?.blur()'); await a.size(1280, 800);
  await a.click('#source-add'); await busyDone(); await a.settle();
  await atEverySize('source-row', 'Clicked Add 1 skill: the band says deslop is in Central Knot and is off, to turn on in the Library, with Open in the Library; the source’s row: its link, branch, folder, commit and when it was read, the line saying what Check now can do in your tools, Check now and Remove…, and deslop, at the root of skill-deslop, In Central Knot, Off', true, '.source-row');
  await openKind(a, 'skills'); await openRow('skills', 'deslop');
  await atEverySize('skill-off', 'On Skills, deslop’s row is Off, in no tool, as any Off item reads; opened, it says it is from github.com/stephenturner/skill-deslop (main), a source, with a link to Sources, and its one version says the same', true, `.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`, 'start');
  await turnOnRow('skills', 'deslop'); await switchOn('skills', 'deslop');
  await atEverySize('skill-on', 'Clicked its switch: deslop is On, and each tool’s line says it has the current version; the opened row still says where it is from', false, `.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`, 'start');
  deslop({ 'SKILL.md': skillMd('deslop', 'Read the text, list what reads as slop, and rewrite it plainly. Keep the author’s voice.') }, 'Keep the voice');
  await a.click('#nav-sources');
  await a.click('.source-row .source-actions button'); await busyDone(); await a.settle();
  await atEverySize('updated', 'Changed deslop at the source and clicked Check now: the band says deslop was updated from its source, now in all 3 tools, with Undo the update, Open Skills, and that each change can be seen or undone in History', true, '.source-row');
  await openKind(a, 'skills'); await openRow('skills', 'deslop');
  await atEverySize('updated-skill', 'On Skills, deslop’s opened row: two versions, the current one from the source, the earlier one too, each saying where it came from', false, `.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`, 'start');
  await a.click('#nav-history');
  await shot(a, 'updated-history', 'History: Updated from github.com/stephenturner/skill-deslop (main); that became the current version, in all 3 tools, with Undo (1280×800)');
  // Edited in Claude Code (Automatic sync takes it in), then changed at the source: the source's version waits.
  const deslopInClaude = join(practice, '.claude/skills/deslop/SKILL.md');
  await openKind(a, 'skills');
  writeFileSync(deslopInClaude, readFileSync(deslopInClaude, 'utf8').replace('Keep the author’s voice.', 'Keep the author’s voice, and their jokes.'));
  await noticeFor('deslop');
  deslop({ 'SKILL.md': skillMd('deslop', 'Read the text, list what reads as slop, and rewrite it plainly. Keep the author’s voice and their dialect.') }, 'Keep the dialect');
  await a.click('#nav-sources');
  await a.click('.source-row .source-actions button'); await busyDone(); await a.settle();
  await atEverySize('waiting', 'deslop was edited in Claude Code, then changed at the source; clicked Check now: the band says deslop changed at the source and yours stays current, since it was changed here or a tool’s copy can’t be read just now, and that on its row Merge puts the source’s changes into yours if they don’t clash, Replace takes the source’s, and Keep mine keeps yours; deslop’s line on the source’s row, under a warning mark, says yours stays current until you merge, replace or keep it, for the same reasons, what Merge, Replace and Keep mine do, and ends with Merge, Replace and Keep mine', true, '.source-row');
  await a.size(860, 560); await show('.source-row'); await focusOn('.source-row button[id^="source-merge-"]'); await shot(a, 'waiting-merge-focus-860', 'Tabbed to Merge on deslop’s line at 860×560: its focus ring, with Replace beside it'); await a.run('document.activeElement?.blur()'); await a.size(1280, 800);
  await openKind(a, 'skills'); await openRow('skills', 'deslop');
  await atEverySize('waiting-skill', 'On Skills, deslop’s row says “update at its source” after its name, under a warning mark; opened, each tool has the current version (the edit made in Claude Code), and the line at the end says the source has a newer version, yours stays current since it was changed here or a tool’s copy of it can’t be read just now, and on Sources Merge puts its changes into yours if they don’t clash, and Replace takes it as it is, either keeping yours as a version, and Keep mine keeps yours current and the source’s as a version, so it no longer waits', true, `.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`, 'start');
  await a.click('#nav-sources');
  // Both changed the same line of SKILL.md: Merge names it and changes nothing.
  await a.click('.source-row button[id^="source-merge-"]'); await busyDone(); await a.settle();
  await atEverySize('merge-clash', 'Clicked Merge on deslop’s line: the edit in Claude Code and the source’s change are to the same line, so the band, under a warning mark, says Merge left deslop as it was, since SKILL.md changed both here and at the source in ways that can’t be merged, and that Replace takes the source’s version and keeps yours as a version, or the source’s change can be made in yours by hand and then Keep mine, and until then yours stays current and the update keeps waiting; no Undo, since nothing changed; deslop’s line still waits, with Merge, Replace and Keep mine', true, '.source-row');
  await a.click('.source-row button[id^="source-keep-"]'); await busyDone(); await a.settle();
  await atEverySize('kept', 'Clicked Keep mine on deslop’s line: the band says deslop stays as you have it, and the source’s version no longer waits: it is kept as a version, and the source’s next change is compared with it, with Undo keep mine and that each change can be seen or undone in History; deslop’s line says In Central Knot, On, with no Merge, Replace or Keep mine', false, '.source-row');
  await a.click('#outcome-undo'); await busyDone(); await a.settle();
  await atEverySize('kept-undone', 'Clicked Undo keep mine: the status bar says deslop: undone: yours stays current; the source’s version is no longer marked as declined or taken, and the source’s row says whether an update waits; deslop’s line waits again, with Merge, Replace and Keep mine', false, '.source-row');
  await a.click('.source-row button[id^="source-replace-"]'); await busyDone(); await a.settle();
  await atEverySize('replaced', 'Clicked Replace on deslop’s line: the band says deslop has the source’s version, now in all 3 tools, and the one it had is kept as a version, with Undo the replace, Open Skills, and that each change can be seen or undone in History; deslop’s line says In Central Knot, On, with no Replace', false, '.source-row');
  // A line added in Claude Code, and the source's description changed: lines apart, so Merge puts them together.
  writeFileSync(deslopInClaude, `${readFileSync(deslopInClaude, 'utf8')}\nSay what you changed, in one line.\n`);
  await openKind(a, 'skills');
  await noticeFor('deslop');
  deslop({ 'SKILL.md': skillMd('deslop', 'Read the text, list what reads as slop, and rewrite it plainly. Keep the author’s voice and their dialect.').replace('Find and remove the patterns', 'Find and take out the patterns') }, 'Reword the description');
  await a.click('#nav-sources');
  await a.click('.source-row .source-actions button'); await busyDone(); await a.settle();
  await a.click('.source-row button[id^="source-merge-"]'); await busyDone(); await a.settle();
  await atEverySize('merged', 'A line was added to deslop in Claude Code, and the source reworded its description; clicked Check now, then Merge on deslop’s line: the band says deslop now has your changes and the source’s, merged, in all 3 tools, and the version it had is kept, with Undo the merge, Open Skills, and that each change can be seen or undone in History; deslop’s line says In Central Knot, On, with no Merge or Replace', true, '.source-row');
  await openKind(a, 'skills'); await openRow('skills', 'deslop');
  await atEverySize('merged-skill', 'On Skills, deslop’s opened row: each tool has the merged version; its newest versions say merged with the source’s version, and from the source; the line at the end says you changed it here, or a tool’s copy of it can’t be read just now, so the source’s next change will wait for you to Merge, Replace or Keep mine on Sources; no tag after its name, since nothing waits', false, `.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`, 'start');
  await a.click('#nav-history');
  await shot(a, 'merged-history', 'History: Merged github.com/stephenturner/skill-deslop (main)’s version into yours; that became the current version, in all 3 tools; the version it had and the source’s are kept, with Undo (1280×800)');
  deslop({ 'SKILL.md': skillMd('unslop', 'Read the text, list what reads as slop, and rewrite it plainly. Keep the author’s voice.') }, 'Rename to unslop');
  await a.click('#nav-sources');
  await a.click('.source-row .source-actions button'); await busyDone(); await a.settle();
  await atEverySize('dropped', 'The skill was renamed unslop at the source; clicked Check now: the band leads, under a warning mark, with deslop no longer at the source, turned off and taken out of all 3 tools, Central Knot keeping it, with Turn deslop on; then unslop in Central Knot, Off; the row lists unslop, and deslop, not in its last read, under a warning mark: no longer at this source, Off, and no longer from it, with Turn it on', true, '.source-row');
  deslop({ 'SKILL.md': '---\nname: [unslop\n---\nBroken.\n' }, 'Break the front matter');
  await a.click('.source-row .source-actions button'); await busyDone(); await a.settle();
  await atEverySize('unreadable', 'Its SKILL.md stopped parsing at the source; clicked Check now: the band, under a warning mark and with no Open Skills, says not all of the source could be read, so the source turned no skill, agent or MCP server off (nothing there can be read), and that its row says why; the row has one line for the skill, unslop, at the root of skill-deslop, saying its SKILL.md can’t be read and why, and that until it can this source turns no skill off; deslop’s line, no longer at this source, with Turn it on, stays as it was', false, '.source-row');
  deslop({ 'SKILL.md': skillMd('unslop', 'Read the text, list what reads as slop, and rewrite it plainly. Keep the author’s voice.') }, 'Mend the front matter');
  await a.click('.source-row .source-actions button'); await busyDone(); await a.settle();
  await openKind(a, 'skills'); await openRow('skills', 'deslop');
  await atEverySize('dropped-skill', 'On Skills, deslop is Off, out of every tool, kept in Central Knot with its versions, and “removed at its source” after its name, under a warning mark; its opened row’s line at the end says the source no longer has it, that it is Off and no longer from that source, to turn it on to use it again, and that should the source have it again, it follows the source if unchanged here and stays as you have it if you changed it; its versions still say where each came from', false, `.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`, 'start');
  await a.click('#nav-history');
  await shot(a, 'dropped-history', 'History: github.com/stephenturner/skill-deslop (main) no longer has it, so it is off and removed from all 3 tools, and no longer from that source, with Turn it on; and unslop brought in, Off, with Turn it on (1280×800)');
  await a.click('#nav-sources');
  await a.size(860, 560); await show('.source-row'); await focusOn('#source-turn-on-skill-deslop'); await shot(a, 'removed-focus-860', 'Tabbed to Turn it on on deslop’s line at 860×560: its focus ring'); await a.run('document.activeElement?.blur()'); await a.size(1280, 800);
  await a.click('#source-turn-on-skill-deslop'); await busyDone(); await a.settle();
  await atEverySize('turned-on', 'Clicked Turn it on on deslop’s line: the band says deslop is on in all 3 tools, with Undo; deslop’s line is gone from the source’s row', false, '.source-row');
  await lookAt('https://github.com/nobody/missing');
  await atEverySize('cannot-read', 'Looked at a link with no repository there (or none this computer can read): why, in plain words, and Cancel', false, '#source-preview');
  await a.click('#source-cancel');
  await openKind(a, 'skills'); await turnOnRow('skills', 'notes'); await switchOn('skills', 'notes');
  await a.click('#nav-sources');
  await lookAt('team/kit');
  await atEverySize('already-has', 'notes is On in Central Knot (the Practice copy’s own), and looked at team/kit: release comes in, Off; notes is not brought in, since Central Knot already has a different notes, and the line says how to take this one instead (deleting yours also takes it out of every tool it is on in); each skill sits in the folder of its name; the agent writer, in the folder agents, comes in Off', true, '#source-preview');
  await a.click('#source-add'); await busyDone(); await a.settle();
  await atEverySize('already-has-row', 'Clicked Add 1 skill and 1 agent: team/kit’s row lists notes, in the folder notes, not brought in, with how to take this one instead (delete yours, which also takes it out of every tool it is on in, then Add on this row), release, In Central Knot, Off, and the agent writer, In Central Knot, Off', false, '.source-row:last-child');
  rmSync(join(hosts, 'github.com/stephenturner'), { recursive: true, force: true });
  await a.click('.source-row .source-actions button'); await busyDone(); await a.settle();
  await atEverySize('check-failed', 'The repository was taken away; clicked Check now: the band says why it couldn’t be read, and the row says it too, under the last read it keeps; what came from it stays as it is', false, '.source-row');
  await a.size(860, 560);
  // By its id: since #197 the row's first ghost button is "Show in the Library", which leaves the page.
  await a.click('.source-row .source-actions [id^="source-remove-"]');
  await shot(a, 'remove-asked-860', 'Clicked Remove… at 860×560: the question in place, that its skills and agents stay in Central Knot as they are, On or Off, with their versions, with Remove and Cancel');
  await a.size(1280, 800);
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- Agents from a link, beside a skill ----------
if (wanted('source-agents')) {
  begin('source-agents');
  // git's own url.<base>.insteadOf sends https://github.com/<path> to folders here: nothing reaches the network.
  const hosts = join(scratch, 'source-agent-hosts'), dir = join(hosts, 'github.com/team/review-kit.git');
  const commit = (files, message = 'change') => {
    for (const [file, text] of Object.entries(files)) { if (text === null) rmSync(join(dir, file), { recursive: true, force: true }); else { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); } }
    for (const step of [['add', '--all'], ['commit', '--quiet', '-m', message]]) execFileSync('git', ['-C', dir, '-c', 'user.name=Team', '-c', 'user.email=team@example.com', '-c', 'commit.gpgsign=false', ...step]);
  };
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', dir]);
  const reviewer = (prompt, description = 'Reviews a change for what a reader would trip on.') => `---\nname: reviewer\ndescription: ${description}\ntools: Read, Grep\n---\n\n${prompt}\n`;
  commit({
    'notes/SKILL.md': '---\nname: notes\ndescription: Take notes the team’s way.\n---\n\nThe team’s notes.\n',
    'agents/reviewer.md': reviewer('Read the change as a newcomer would.\nSay where you were lost.'),
    '.claude/agents/release-notes-writer-for-the-whole-team.md': '---\nname: release-notes-writer-for-the-whole-team\ndescription: Writes the release notes from the merged pull requests, grouped by area, in plain words a user reads.\n---\n\nWrite the release notes.\n',
    'README.md': '# review-kit\n',
  });
  await fresh({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${join(hosts, 'github.com')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/' });
  const busyDone = () => waitFor(a, `document.body.dataset.busy !== 'true'`, 20000);
  const checkNow = async () => { await a.click('#nav-sources'); await a.click('.source-row .source-actions button'); await busyDone(); await a.settle(); };
  await a.click('#nav-sources');
  await a.run(`(() => { const input = document.querySelector('#source-link'); input.value = 'https://github.com/team/review-kit'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await a.click('#source-look'); await busyDone(); await a.settle();
  await atEverySize('look', 'Looked at team/review-kit: one skill, notes, in the folder notes, and two agents, reviewer in the folder agents and release-notes-writer-for-the-whole-team in .claude/agents, each line saying its kind, where it sits and its file; each comes in Off; Add 1 skill and 2 agents', true, '#source-preview');
  await a.click('#source-add'); await busyDone(); await a.settle();
  await atEverySize('source-row', 'Clicked Add 1 skill and 2 agents: the band says notes, reviewer and release-notes-writer-for-the-whole-team are in Central Knot and all 3 are off, to turn on in the Library, with Open in the Library; the source’s row lists the skill and both agents, In Central Knot, Off', true, '.source-row');
  await openKind(a, 'agents'); await openRow('agents', 'reviewer');
  await atEverySize('agent-row-source', 'On Agents, reviewer is Off, in Central Knot only; opened, its version says it came from github.com/team/review-kit, and the line at the end says it is from that source, and that what changes there comes in once a day while Automatic sync is on, and at Check now on Sources, unless you change it here', true, `.ov-row[data-key="${rowPart('', 'agents', 'reviewer')}"]`, 'start');
  await turnOnRow('agents', 'reviewer'); await switchOn('agents', 'reviewer');
  const inClaude = join(practice, '.claude/agents/reviewer.md');
  writeFileSync(inClaude, readFileSync(inClaude, 'utf8').replace('Say where you were lost.', 'Say where you were lost, and why.'));
  await noticeFor('reviewer');
  commit({ 'agents/reviewer.md': reviewer('Read the change as a newcomer would.\nSay where you were lost.', 'Reviews a change for what a newcomer would trip on.') }, 'Reword the description');
  await checkNow();
  await atEverySize('agent-waiting', 'reviewer was turned On, edited in Claude Code, and its description changed at the source; clicked Check now: the band says reviewer changed at the source and yours stays current, and what Merge, Replace and Keep mine do; reviewer’s line, under a warning mark, says the same and ends with Merge, Replace and Keep mine', true, '.source-row');
  await a.click('.source-row button[id^="source-merge-"]'); await busyDone(); await a.settle();
  await atEverySize('agent-merged', 'Clicked Merge on reviewer’s line: its edit (the prompt) and the source’s change (the description) are apart, so the band says reviewer now has your changes and the source’s, merged, in the tools it is on in, with Undo the merge, Open Agents, and History’s note', false, '.source-row');
  commit({ 'agents/reviewer.md': null }, 'Drop reviewer');
  await checkNow();
  await atEverySize('agent-removed', 'reviewer was taken out of the source; clicked Check now: the band leads, under a warning mark, with reviewer no longer at the source, turned off and taken out of the tools, Central Knot keeping it, with Turn reviewer on; the source’s row has reviewer’s line, an agent not in its last read: no longer at this source, Off, and no longer from it, with Turn it on', true, '.source-row');
  await openKind(a, 'agents'); await openRow('agents', 'reviewer');
  await atEverySize('agent-removed-agents', 'On Agents, reviewer is Off, out of every tool, with “removed at its source” after its name; opened, the line at the end says the source no longer has it, that it is Off and no longer from that source, to turn it on to use it again, and what happens should the source have it again', true, `.ov-row[data-key="${rowPart('', 'agents', 'reviewer')}"]`, 'start');
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

if (wanted('source-servers')) {
  begin('source-servers');
  // git's own url.<base>.insteadOf sends https://github.com/<path> to folders here: nothing reaches the network.
  const hosts = join(scratch, 'source-server-hosts'), dir = join(hosts, 'github.com/team/service-kit.git');
  const commit = (files, message = 'change') => {
    for (const [file, text] of Object.entries(files)) { if (text === null) rmSync(join(dir, file), { recursive: true, force: true }); else { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); } }
    for (const step of [['add', '--all'], ['commit', '--quiet', '-m', message]]) execFileSync('git', ['-C', dir, '-c', 'user.name=Team', '-c', 'user.email=team@example.com', '-c', 'commit.gpgsign=false', ...step]);
  };
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', dir]);
  const relay = log => ({ command: 'npx', args: ['-y', '@team/relay-mcp'], env: { RELAY_REGION: 'west', RELAY_LOG: log }, timeout: 30 });
  const servers = (more = {}) => `${JSON.stringify({ mcpServers: { ...more } }, null, 2)}\n`;
  const search = { type: 'http', url: 'https://search.example.com/mcp', headers: { 'X-Team': 'docs' } };
  commit({
    'agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews a change for what a reader would trip on.\n---\n\nRead the change as a newcomer would.\n',
    '.mcp.json': servers({ relay: relay('info'), 'search-index': search, 'team-plugin-helper': { command: '${CLAUDE_PLUGIN_ROOT}/bin/helper' }, 'half-written': { type: 'stdio' } }),
    'README.md': '# service-kit\n',
  });
  await fresh({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${join(hosts, 'github.com')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/' });
  const busyDone = () => waitFor(a, `document.body.dataset.busy !== 'true'`, 20000);
  const checkNow = async () => { await a.click('#nav-sources'); await a.click('.source-row .source-actions button'); await busyDone(); await a.settle(); };
  await a.click('#nav-sources');
  await a.run(`(() => { const input = document.querySelector('#source-link'); input.value = 'https://github.com/team/service-kit'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await a.click('#source-look'); await busyDone(); await a.settle();
  await atEverySize('look', 'Looked at team/service-kit: one agent, reviewer, in the folder agents, and four MCP servers from its .mcp.json at the root: relay and search-index come in Off; team-plugin-helper is not brought in, since it names a plugin’s own folder or settings, which only Claude Code fills in, for a plugin; half-written can’t be read, since it has no command to run; Add 1 agent and 2 MCP servers', true, '#source-preview');
  await a.click('#source-add'); await busyDone(); await a.settle();
  await openKind(a, 'mcp'); await openRow('mcp', 'relay');
  await atEverySize('server-row-source', 'On MCP servers, relay is Off, in Central Knot only; opened, its version says it came from github.com/team/service-kit, and the line at the end says it is from that source, and that what changes there comes in once a day while Automatic sync is on, and at Check now on Sources, unless you change it here', true, `.ov-row[data-key="${rowPart('', 'mcp', 'relay')}"]`, 'start');
  await turnOnRow('mcp', 'relay'); await switchOn('mcp', 'relay');
  commit({ '.mcp.json': servers({ relay: relay('debug'), 'search-index': search, 'team-plugin-helper': { command: '${CLAUDE_PLUGIN_ROOT}/bin/helper' } }) }, 'Log more');
  await checkNow();
  await atEverySize('server-updated', 'relay was turned On, in Claude Code too, then its RELAY_LOG changed at the source (and half-written was taken out there); clicked Check now: the band says relay was updated from its source, now in all 3 tools, with Open MCP servers and Undo the update', true, '.source-row');
  await openKind(a, 'mcp'); await openRow('mcp', 'relay');
  await atEverySize('server-updated-row', 'On MCP servers, relay’s row: on in every tool, Claude Code’s with the update too', false, `.ov-row[data-key="${rowPart('', 'mcp', 'relay')}"]`, 'start');
  const inCopilot = join(practice, '.copilot/mcp-config.json');
  edit(inCopilot, text => { const parsed = JSON.parse(text); parsed.mcpServers.relay.env.RELAY_REGION = 'east'; return JSON.stringify(parsed, null, 2); });
  await noticeFor('relay');
  commit({ '.mcp.json': servers({ relay: relay('warn'), 'search-index': search, 'team-plugin-helper': { command: '${CLAUDE_PLUGIN_ROOT}/bin/helper' } }) }, 'Log less');
  await checkNow();
  await atEverySize('server-waiting', 'relay’s RELAY_REGION was edited in Copilot CLI, and its RELAY_LOG changed at the source; clicked Check now: the band says relay changed at the source and yours stays current, and what Merge, Replace and Keep mine do; relay’s line, under a warning mark, says the same and ends with Merge, Replace and Keep mine', true, '.source-row');
  await a.click('.source-row button[id$="-mcp-relay"][id^="source-merge-"]'); await busyDone(); await a.settle();
  commit({ '.mcp.json': servers({ 'search-index': search, 'team-plugin-helper': { command: '${CLAUDE_PLUGIN_ROOT}/bin/helper' } }) }, 'Drop relay');
  await checkNow();
  await atEverySize('server-removed', 'relay was taken out of the source; clicked Check now: the band leads, under a warning mark, with relay no longer at the source, turned off and taken out of all 3 tools, Central Knot keeping it, with Turn relay on; the source’s row has relay’s line: no longer at this source, Off, no longer from it, with Turn it on', true, '.source-row');
  await openKind(a, 'mcp'); await openRow('mcp', 'relay');
  await atEverySize('server-removed-mcp', 'On MCP servers, relay is Off with “removed at its source” after its name; opened, the line at the end says the source no longer has it, that it is Off and no longer from that source, and what happens should the source have it again', true, `.ov-row[data-key="${rowPart('', 'mcp', 'relay')}"]`, 'start');
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- A link to a plugin or a marketplace (atlink.ts holdsAt, sources.ts handOff), with made-up repositories ----------
if (wanted('source-plugins')) {
  begin('source-plugins');
  const hosts = join(scratch, 'source-plugin-hosts');
  const repo = path => {
    const dir = join(hosts, 'github.com', `${path}.git`);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', dir]);
    const git = (...rest) => execFileSync('git', ['-C', dir, '-c', 'user.name=Team', '-c', 'user.email=team@example.com', '-c', 'commit.gpgsign=false', ...rest]);
    return Object.assign((files, message = 'change') => {
      for (const [file, text] of Object.entries(files)) { if (text === null) rmSync(join(dir, file), { recursive: true, force: true }); else { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); } }
      git('add', '--all'); git('commit', '--quiet', '-m', message);
    }, { git });
  };
  const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\nSteps.\n`;
  repo('acme/incident-response-toolkit')({
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'incident-response-toolkit', skills: ['./playbooks/incident-timeline-builder'], mcpServers: { 'statuspage-incident-publisher': { command: 'npx', args: ['-y', '@acme/statuspage-mcp'] } } }),
    'skills/postmortem-writer-with-five-whys/SKILL.md': skill('postmortem-writer-with-five-whys', 'Write a blameless postmortem, asking why five times.'),
    'playbooks/incident-timeline-builder/SKILL.md': skill('incident-timeline-builder', 'Build an incident’s timeline from chat, alerts and deploys.'),
    'agents/on-call-triage-coordinator.md': '---\nname: on-call-triage-coordinator\ndescription: Triages a page and pulls in the right people.\n---\n\nTriage.\n',
    '.mcp.json': JSON.stringify({ mcpServers: { 'pagerduty-incident-bridge': { command: 'npx', args: ['-y', '@acme/pagerduty-mcp'] }, 'runbook-search': { command: '${CLAUDE_PLUGIN_ROOT}/bin/runbook-search' } } }),
    'commands/declare-incident.md': 'Declare.\n', 'commands/page-secondary.md': 'Page.\n', 'commands/status-update.md': 'Update.\n', 'commands/close-incident.md': 'Close.\n',
    'hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'cat "${CLAUDE_PLUGIN_ROOT}/RUNBOOK.md"' }] }] } }), '.lsp.json': JSON.stringify({ yaml: { command: 'yaml-language-server' } }), 'bin/runbook-search': '#!/bin/sh\n',
  });
  const names = ['release-notes-writer', 'dependency-upgrade-planner', 'flaky-test-hunter', 'api-changelog-auditor', 'terraform-plan-reviewer', 'k8s-manifest-linter', 'oncall-handoff-summarizer', 'sql-migration-checker', 'feature-flag-cleaner', 'accessibility-auditor', 'docs-link-checker', 'security-advisory-reader'];
  const market = repo('acme/engineering-plugins');
  market({ '.claude-plugin/marketplace.json': JSON.stringify({ name: 'acme-engineering-plugins', plugins: names.map(name => ({ name, source: `./plugins/${name}`, description: `The ${name.replaceAll('-', ' ')}.` })) }),
    ...Object.fromEntries(names.flatMap(name => [[`plugins/${name}/.claude-plugin/plugin.json`, JSON.stringify({ name })], [`plugins/${name}/skills/${name}/SKILL.md`, skill(name, `The ${name.replaceAll('-', ' ')}.`)]])) });
  market.git('checkout', '--quiet', '-b', 'release-2026-q4'); market({ 'README.md': 'The release branch.\n' }); market.git('checkout', '--quiet', 'main');
  const handbook = repo('acme/team-handbook');
  handbook({ 'writing-style/SKILL.md': skill('writing-style', 'Write the team’s way.') });
  await fresh({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${join(hosts, 'github.com')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/' });
  const busyDone = () => waitFor(a, `document.body.dataset.busy !== 'true'`, 20000);
  const type = text => a.run(`(() => { const input = document.querySelector('#source-link'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const lookAt = async link => { await type(link); await a.click('#source-look'); await busyDone(); await a.settle(); };
  await a.click('#nav-sources');
  await atEverySize('empty', 'Clicked Library sources: the heading says any GitHub or GitLab link goes here; the line under the field says a plugin’s own folder brings its skills, agents and MCP servers and a marketplace goes to Plugins; the aside says a marketplace’s link is handed to Plugins');
  await lookAt('https://github.com/acme/incident-response-toolkit');
  await atEverySize('look-plugin', 'Looked at a plugin’s own folder: that it holds a plugin, whose skills, agents and MCP servers come in as this source’s, each with its own switch; that its 4 commands, its hooks, its 1 LSP server and its bin folder are not brought in, and what to do to have the whole plugin; two skills (one in a folder its plugin.json names), an agent, a server from .mcp.json and one from plugin.json, coming in Off; the server that runs from the plugin’s folder left out', true, '#source-preview', 'start');
  await a.click('#source-add'); await busyDone(); await a.settle();
  await atEverySize('plugin-row', 'Clicked Add: the band says what came in, Off; the source’s row lists them and says what of the plugin is not brought in', false, '.source-row', 'start');
  await lookAt('https://github.com/acme/engineering-plugins');
  await atEverySize('look-marketplace', 'Looked at a marketplace’s link: what it is (acme-engineering-plugins, with 12 plugins), that it goes on the Plugin marketplaces page where each plugin has its own switch, and Add to Plugin marketplaces adds it with its 12 plugins, none turned on; and that a link to one of its other folders brings that folder’s items here; Add to Plugin marketplaces, Cancel, and that nothing is installed or kept here', true, '#source-preview');
  await a.size(860, 560); await focusOn('#source-to-plugins'); await shot(a, 'look-marketplace-focus-860', 'Tabbed to Add to Plugin marketplaces at 860×560: its focus ring'); await a.run('document.activeElement?.blur()'); await a.size(1280, 800);
  await lookAt('https://github.com/acme/engineering-plugins/tree/release-2026-q4');
  await atEverySize('look-marketplace-branch', 'Looked at the same marketplace on its branch release-2026-q4: refused, with why (the Plugin marketplaces page adds a marketplace from its repository’s default branch, main, at its root) and what to do instead (clone it and add the folder with Folder… on Plugins); no Add to Plugin marketplaces', false, '#source-preview');
  await lookAt('https://github.com/acme/engineering-plugins/tree/main/plugins/release-notes-writer');
  await atEverySize('look-listed', 'Looked at one plugin’s folder in that marketplace: it is the plugin release-notes-writer, which its repository’s marketplace lists, so it goes on Plugin marketplaces with that marketplace, where it has its own switch; Add to Plugin marketplaces for acme-engineering-plugins', false, '#source-preview');
  await lookAt('https://github.com/acme/engineering-plugins');
  await a.click('#source-to-plugins'); await busyDone(); await a.settle();
  await atEverySize('plugins-after', 'Clicked Add to Plugin marketplaces: the Plugin marketplaces page opens on acme-engineering-plugins with its 12 plugins, each with its switch off, and the band says the marketplace was added and nothing was installed', true);
  if (await a.has('#open-add-marketplace')) await a.click('#open-add-marketplace');
  await atEverySize('plugins-add-box', 'Clicked Add marketplace: the box, and under it the line that any other link, to a folder of skills, agents or MCP servers, or to one plugin, goes on Sources, with a link to that page', true, '.market-add-note');
  await a.click('#nav-sources');
  await lookAt('https://github.com/acme/team-handbook');
  await a.click('#source-add'); await busyDone(); await a.settle();
  handbook({ '.claude-plugin/marketplace.json': JSON.stringify({ name: 'team-handbook-plugins', plugins: [] }), 'writing-style/SKILL.md': null }, 'Become a marketplace');
  await a.click('.source-rows > li:last-child .source-actions button'); await busyDone(); await a.settle();
  await atEverySize('row-now-marketplace', 'acme/team-handbook became a marketplace; clicked Check now on its row: under a warning mark, the row says the link now holds a marketplace, which goes on Plugin marketplaces, that this source turns nothing off, and to remove this source, then look at its link again to see how it can go on Plugin marketplaces; writing-style stays as it was', false, '.source-rows > li:last-child', 'start');
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- A plugin's items in Pi as library items (library.ts A PLUGIN, pluginlibrary.ts) ----------
if (wanted('plugin-library')) {
  // CLIs are looked for only in the throwaway home, so the ones this machine has installed don't take the plugin.
  await fresh({ CK_TEST_HOME_ONLY: 'claude,copilot,codex' });
  begin('plugin-library');
  // A home with Pi and no tool's CLI: Claude Code, Copilot CLI and Codex can't take the plugin, and say why on their lines.
  const market = join(scratch, 'library-market');
  writeMarket(market);
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await refresh();
  await a.click('#nav-plugins');
  await addMarketplace(a, market);
  await waitFor(a, `!!document.querySelector('#popen-0-issue-tracker')`, 20000);
  await a.click('#popen-0-issue-tracker'); await waitFor(a, `!!document.querySelector('#pswitch-page-0-issue-tracker')`, 15000);
  await a.click('#pswitch-page-0-issue-tracker'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  // The plugin drops triage and then changes issues; Update between the two: triage is removed by the update, an update of issues is ready.
  rmSync(join(market, 'plugins/issue-tracker/skills/triage'), { recursive: true, force: true });
  await refresh(); await waitFor(a, `!!document.querySelector('#pupdate-0-issue-tracker')`, 15000);
  await a.click('#pupdate-0-issue-tracker'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  await openKind(a, 'skills'); await noticeFor('triage'); await openNotices();
  await atEverySize('dropped-notice', 'Update read issue-tracker, which no longer has triage: on Skills, Notices opened, the notice says triage: the plugin issue-tracker no longer has it, so it is off, Central Knot keeps it, with Turn it on (as your own) and History', true, '.sync-notice[data-kind="dropped"]');
  await a.click('#nav-plugins');
  writeFileSync(join(market, 'plugins/issue-tracker/.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp', '--v2'] } } }));
  await refresh(); await waitFor(a, `/An update is ready/.test(document.querySelector('.plugin-items-section')?.textContent ?? '')`, 15000);
  await atEverySize('items-page', 'issue-tracker turned on in a home with Pi and no tool’s command-line tool: Your tools has Pi’s line, “1 of its 1 items is on” (triage, dropped, is no longer the plugin’s), and Claude Code’s, Copilot CLI’s and Codex’s boxes off, each line saying “No … command-line tool here”; the plugin then dropped triage (Update turned it off) and changed issues: Its items lists MCP server issues, “An update is ready: Update brings it in”, and skill triage, “Removed by the plugin’s update, so it is off. Turning it on keeps it as yours”, with Update at the top', true, '.plugin-items-section');
  await openKind(a, 'mcp'); await openRow('mcp', 'issues');
  // document-tools on too, with a third skill, charts; pdf-reader then edited in Pi (let go as his own) and spreadsheet deleted from Central Knot.
  mkdirSync(join(market, 'plugins/document-tools/skills/charts'), { recursive: true });
  writeFileSync(join(market, 'plugins/document-tools/skills/charts/SKILL.md'), '---\nname: charts\ndescription: Draws a chart from a table.\n---\nDraw it.\n');
  await a.click('#nav-plugins'); await refresh(); if (await a.has('#plugin-back')) await a.click('#plugin-back');
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('#pswitch-page-0-document-tools')`, 15000);
  await a.click('#pswitch-page-0-document-tools'); await waitFor(a, `document.body.dataset.busy !== 'true'`, 30000); await a.settle();
  edit(join(practice, '.pi/agent/skills/pdf-reader/SKILL.md'), text => `${text}\nMy own way of reading PDFs.\n`);
  await refresh(); await openKind(a, 'skills'); await noticeFor('pdf-reader');
  await openRow('skills', 'pdf-reader');
  await atEverySize('let-go-row', 'pdf-reader was edited in Pi: on Skills its row says Pi only, with no “from the plugin”, and its versions keep the plugin’s', true, `.ov-row[data-key="${rowPart('', 'skills', 'pdf-reader')}"]`, 'start');
  await openNotices();
  await atEverySize('let-go-notice', 'Opened Notices: the notice says pdf-reader is your own now, no longer following the plugin document-tools, that it stays in the tools that have it and its row lets it into the others', false, '.sync-notice[data-kind="let-go"]');
  await closeNotices();
  await openRow('skills', 'spreadsheet'); await a.click(`#${rowPart('delete', 'skills', 'spreadsheet')}`); await a.click(`#${rowPart('delete-confirm', 'skills', 'spreadsheet')}`); await a.settle();
  await a.click('#nav-plugins'); await refresh(); await waitFor(a, `/you deleted it/.test(document.querySelector('.plugin-items-section')?.textContent ?? '')`, 15000);
  await atEverySize('own-and-deleted', 'document-tools’ page: Its items lists skill charts (plain: on in Pi), skill pdf-reader “Not brought in: you have your own”, and skill spreadsheet, deleted from Central Knot, “Deleted here: tick to bring it back”', true, '.plugin-items-section');
  // charts deleted too: nothing of document-tools is linked any more, and its page still says why each isn't brought in.
  await openKind(a, 'skills'); await openRow('skills', 'charts'); await a.click(`#${rowPart('delete', 'skills', 'charts')}`); await a.click(`#${rowPart('delete-confirm', 'skills', 'charts')}`); await a.settle();
  await a.click('#nav-plugins'); await refresh(); await waitFor(a, `(document.querySelector('.plugin-items-section')?.textContent.match(/Not brought in/g) ?? []).length === 3`, 15000);
  await show('.plugin-items-section');
  await shot(a, 'none-linked-1280', 'charts deleted too, so no item of document-tools is linked any more: its page still lists all three under Its items (charts and spreadsheet “Deleted here: tick to bring it back”, pdf-reader your own), and Pi’s box is empty, with why under it: a tick brings back the two you deleted (1280×800)');
  await atEverySize('not-in-pi', 'The same page’s Your tools: Claude Code, Copilot CLI and Codex have no CLI here, so their boxes are off and each line says “No … command-line tool here”; Pi’s box is empty, and under it one sentence per reason none of document-tools’ items is on in Pi: charts and spreadsheet were deleted here (tick to bring them back), and pdf-reader is a skill of your own by that name (delete yours on its row to take the plugin’s)', true, '.plugin-panel', 'start');
  await openKind(a, 'mcp'); await openRow('mcp', 'issues');
  await atEverySize('item-row', 'On MCP servers, issues is on in Pi with “from the plugin issue-tracker” after its name; opened, Claude Code’s, Copilot CLI’s and Codex’s lines say it comes only with the plugin, which isn’t installed there, and the line at the end says it is from the plugin issue-tracker, follows it in the tools that take no plugins, and that a change made here makes it yours, with a link to Plugins', true, `.ov-row[data-key="${rowPart('', 'mcp', 'issues')}"]`, 'start');
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- A plugin's parts from an earlier version, moved to the library at one look (partsmigrate.ts) ----------
if (wanted('parts-migration')) {
  await fresh();
  begin('parts-migration');
  const market = join(scratch, 'migration-market');
  writeMarket(market);
  // Before first setup is answered the home has no sync record, so the move waits: document-tools, its parts as alpha 1 left
  // them in Pi, waits there, and its marketplace is listed by the record of its parts.
  mkdirSync(join(practice, '.pi/agent/skills'), { recursive: true });
  await writeOldParts(practice, market, 'team-tools', 'document-tools', 'pi-cli', { skills: { 'pdf-reader': { edited: '\nMy own way of reading PDFs.\n' }, spreadsheet: { removed: true } } });
  await a.click('#nav-plugins'); await refresh();
  await waitFor(a, `!!document.querySelector('#popen-0-document-tools')`, 20000);
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-tool[data-tool="pi-cli"] [data-state="parts-waiting"]')`, 15000);
  await atEverySize('waiting-page', 'Before first setup is answered: document-tools’ parts from alpha 1 wait to be moved, so Pi’s line says “Waits to be moved” with the clock and offers nothing there, and the hint under Your tools says why and what ends it (answer the question on the Overview); the tools with an installer are as for any plugin', true, '.plugin-panel', 'start');
  await a.click('#plugin-back'); await waitFor(a, `!!document.querySelector('.plugin-legend')`, 15000);
  await atEverySize('waiting-row', 'The Plugins list while document-tools waits: its row’s Pi cell has the clock, and the key under the list says “Waits to be moved: parts from an earlier version”', true, '.plugin-legend', 'end');
  await fresh();
  // Pi's skills folder seen once by a pass (as an earlier version's noted it; the sync record first setup's answer makes lets it
  // run), then alpha 1's record of its parts: document-tools' pdf-reader in Pi, edited there since; spreadsheet left out of Pi;
  // issue-tracker's triage and issues in Pi.
  mkdirSync(join(practice, '.pi/agent/skills'), { recursive: true });
  await a.run(`window.centralKnot.setSyncEverything(false, ${JSON.stringify(practice)}, true)`);
  await refresh();
  await writeOldParts(practice, market, 'team-tools', 'document-tools', 'pi-cli', { skills: { 'pdf-reader': { edited: '\nMy own way of reading PDFs.\n' }, spreadsheet: { removed: true } } });
  await writeOldParts(practice, market, 'team-tools', 'issue-tracker', 'pi-cli', { skills: { triage: {} }, servers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp'] } } });
  await a.click('#nav-plugins');
  await addMarketplace(a, market);
  await refresh();
  await waitFor(a, `!!document.querySelector('#popen-0-document-tools')`, 20000);
  await a.click('#popen-0-document-tools'); await waitFor(a, `!!document.querySelector('.plugin-items-section')`, 15000);
  await atEverySize('migrated-page', 'One look after the upgrade: document-tools’ parts are its items. Its items lists skill pdf-reader, edited in Pi, “Not brought in: you have your own”, and skill spreadsheet, left out of Pi, kept out there; Pi’s line counts its items on', true, '.plugin-items-section', 'start');
  await openKind(a, 'skills'); await openRow('skills', 'triage');
  await atEverySize('migrated-row', 'On Skills, triage, a part in Pi before, is an item “from the plugin issue-tracker”, on in Pi, opened: its tools’ lines and the line saying it follows the plugin', true, `.ov-row[data-key="${rowPart('', 'skills', 'triage')}"]`, 'start');
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- Sorted by last updated (matrix.ts orderChoice, itemrow.ts inOrder) ----------
if (wanted('sort')) {
  begin('sort');
  await fresh();
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  // Each skill's copies as last changed some days ago (its folder's and files' newest time: skillfiles.ts folderTime; a copy taken in
  // keeps it as its version's), then standup edited now.
  for (const [key, days] of Object.entries({ notes: 1, 'release-notes': 9, standup: 40, review: 75 })) {
    const then = new Date(Date.now() - days * DAY), folders = ['.claude', '.copilot'].map(root => join(practice, root, 'skills', key)).filter(existsSync);
    for (const path of folders.flatMap(folder => [join(folder, 'SKILL.md'), folder])) utimesSync(path, new Date(), then);
  }
  await refresh();
  await openKind(a, 'skills');
  for (const key of ['notes', 'release-notes', 'standup']) { await turnOnRow('skills', key); await switchOn('skills', key); }
  edit(join(practice, '.claude/skills/standup/SKILL.md'), text => `${text}\nEdited in Claude Code.\n`);
  await refresh();
  await a.run(`(() => { const select = document.querySelector('#item-order'); select.value = 'updated'; select.dispatchEvent(new Event('change')); })()`);
  await a.settle();
  const caption = 'Chose Sort: Last updated. Under each heading the rows go newest first, each saying when: standup, just edited in Claude Code, leads On, then notes (yesterday) and release-notes (9 days ago); review, found, says when its newest copy changed (2 months ago)';
  for (const theme of ['dark', 'light']) {
    await a.theme(theme);
    for (const [width, height] of [[860, 528], ...SIZES.slice(1)]) { await a.size(width, height); await shot(a, `skills-${theme}-${width}`, `${caption} (${width}×${height}, ${theme})`); }
  }
  await a.theme('dark'); await a.size(1440, 900);
  await openRow('skills', 'notes');
  await shot(a, 'skills-docked-1440', 'Opened notes at 1440×900, about the narrowest window that docks a row’s details: beside them the table is at its narrowest, and its rows still say when');
  await a.click(`#${rowPart('files', 'skills', 'notes')}`);
  await shot(a, 'skills-files-1440', 'Clicked Files and contents: the list beside the skill keeps the table’s headings and its order under each, without the times');
  await a.size(1280, 800);
  await openKind(a, 'mcp'); await shot(a, 'mcp', 'MCP servers, sorted the same way (one choice for the three pages): every server is found, and an MCP entry has no time of its own, so none says when and they go by name');
  await openKind(a, 'agents'); await shot(a, 'agents', 'Agents, sorted the same way: every agent is found, each saying when its newest copy changed');
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- Usage collected from the tools' session history (usage.ts, usagerow.ts, app.ts collectUsage) ----------
if (wanted('usage')) {
  begin('usage');
  await fresh();
  if (await a.has('#intro-dismiss')) await a.click('#intro-dismiss');
  // Made-up session history in the Practice copy's tool folders: Claude Code called notes 2 days ago and had review typed 9 days
  // ago; Copilot CLI invoked standup 3 days ago, its history starting 20 days ago; Codex has none. Each skill's copies were saved 40
  // days ago, so each is old enough for the chip.
  const lines = (path, records) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, records.map(record => JSON.stringify(record)).join('\n') + '\n'); };
  const ago = days => new Date(Date.now() - days * DAY).toISOString();
  lines(join(practice, '.claude/projects/-work/s1.jsonl'), [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'notes' } }] }, timestamp: ago(2) }]);
  lines(join(practice, '.claude/projects/-work/s2.jsonl'), [{ type: 'user', message: { content: '<command-name>/review</command-name>' }, timestamp: ago(9) }]);
  lines(join(practice, '.copilot/session-state/c1/events.jsonl'), [{ type: 'session.start', data: {}, timestamp: ago(20) }]);
  lines(join(practice, '.copilot/session-state/c2/events.jsonl'), [{ type: 'skill.invoked', data: { name: 'standup' }, timestamp: ago(3) }]);
  for (const key of ['notes', 'release-notes', 'standup', 'review']) {
    const folders = ['.claude', '.copilot', '.codex'].map(root => join(practice, root, 'skills', key)).filter(existsSync);
    for (const path of folders.flatMap(folder => [join(folder, 'SKILL.md'), folder])) utimesSync(path, new Date(), new Date(Date.now() - 40 * DAY));
  }
  await refresh();
  await openKind(a, 'skills');
  for (const key of ['notes', 'release-notes', 'standup', 'review']) { await turnOnRow('skills', key); await switchOn('skills', key); }
  await shot(a, 'opened-home', 'Skills as the home opened: usage was collected by itself at launch, before this history was written, so beside Update usage statistics it says when and that there are no sessions yet, with no band, and no Used column');
  // Readings held back, so the page can be seen while one runs (a development run only: it reaches main).
  const requests = await requestHandles(a);
  if (requests) {
    // The practice copy opened again: its first reading starts afresh, held back while an opened row is drawn.
    await requests.slow('usage:read', 15000);
    await a.click('#home-fixture');
    await waitFor(a, `document.querySelector('#usage-when')?.textContent === 'Collecting…' && !!document.querySelector('#${rowPart('open', 'skills', 'release-notes')}')`);
    await openRow('skills', 'release-notes');
    await atEverySize('first-reading', 'The home opened again, its first reading running (held back here): the Used column holds its room with empty cells, and the opened row’s lines say Collecting…, so nothing moves when it lands', true, '.details-usage');
    await requests.restore('usage:read');
    await waitFor(a, `/^Collected /.test(document.querySelector('#usage-when')?.textContent ?? '')`, 30000);
    await closeRow('skills', 'release-notes');
  }
  if (requests) await requests.slow('usage:read', 15000);
  await a.click('#collect-usage');
  if (requests) {
    await waitFor(a, `!!document.querySelector('#usage-line')`);
    await atEverySize('collecting', 'Clicked Update usage statistics (the reading held back here): the band says what collecting does, and beside the button, Collecting…', true);
    await requests.restore('usage:read');
  }
  await waitFor(a, `/^Usage statistics collected/.test(document.querySelector('#usage-line .band-text > :not(.band-unshown)')?.textContent ?? '')`, 30000);
  await atEverySize('collected', 'The reading landed: the band, as high as while it collected, says it was collected, with its close button (the time is beside the button); under Sort by Name used rows leave the cell blank (hover keeps both figures), while unused rows say no use seen since the latest date their tools’ history starts (release-notes)', true);
  await a.click('#usage-line-close');
  await atEverySize('closed', 'Closed the band: it takes no room, and when it was collected stays beside the button', true);
  await openRow('skills', 'release-notes');
  await atEverySize('opened', 'Opened release-notes, docked beside the table from 1728: each tool’s line says its figure, a history that starts 20 days ago, or that it keeps no sessions here', false, '.details-usage');
  await closeRow('skills', 'release-notes');
  await a.click('.chip[data-tip="No use seen in 30 days"]');
  await atEverySize('chip', 'Clicked the chip No use seen in 30 days: the rows it holds, and its band: how many and what Turn these off does lead, Turn these off at its end; each tool’s history and what it left out follow, fainter', true);
  // The chip clicked again lets go of it, then Sort by Last used, release-notes (On, with no use until now) used just now, Update: the rows stay where they were, and Put in order is offered beside Sort.
  await a.click('.chip[data-tip="No use seen in 30 days"]');
  await a.run(`(() => { const select = document.querySelector('#item-order'); select.value = 'used'; select.dispatchEvent(new Event('change')); })()`);
  lines(join(practice, '.claude/projects/-work/s3.jsonl'), [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'release-notes' } }] }, timestamp: ago(0) }]);
  await a.click('#collect-usage');
  await waitFor(a, `!!document.querySelector('#put-in-order')`, 15000);
  await a.click('#usage-line-close');
  await atEverySize('held', 'Sort by Last used, release-notes used just now, Update: no row moved when the reading landed (release-notes says just now where it was), and Put in order, beside Sort, is offered', true);
  await a.click('#put-in-order');
  await shot(a, 'put-in-order', 'Clicked Put in order: release-notes goes first under On, and the link goes');
  await openKind(a, 'agents');
  await shot(a, 'agents', 'Agents after the same reading: each agent’s figure, or a faint can’t say where no tool that has it on can tell (release-notes, only in Codex, which keeps no sessions here); no chip, as none is in it');
  if (requests) {
    await openKind(a, 'skills');
    await requests.fail('usage:read');
    await a.click('#collect-usage');
    await waitFor(a, `/couldn’t be collected/.test(document.querySelector('#usage-line .band-text > :not(.band-unshown)')?.textContent ?? '')`);
    await atEverySize('failed', 'A reading that failed: the band says so, and the button offers to collect again; no figure from the reading before stays', true);
    await requests.restore('usage:read');
    requests.close();
  }
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

// ---------- The Overview, the page the app opens on (overview.ts) ----------
// A made-up home of ordinary size in this run's own HOME (this computer's home, so each tool's version shows): five stand-in
// tools, about 110 skills (10 from plugins), 12 MCP servers, 8 agents and session history in three tools. Each state at every
// size and once in light; at 1280×800 also the states that are one line's change.
if (wanted('overview')) {
  const zip = join(scratch, 'update.zip');
  writeFileSync(zip, Buffer.alloc(4_000_000, 7));
  const releases = [];
  const fixture = await serveReleases(releases);
  // Tools are looked for only in this run's HOME, as e2e.mjs does: on a machine with real CLIs installed (a Mac with
  // Homebrew's), "no tool in it" would otherwise find them.
  await fresh({ CK_UPDATE_STUB: 'v0.7.0-alpha.1', CK_UPDATE_RELEASES: fixture.releasesUrl, CK_TEST_HOME_ONLY: 'claude,copilot,codex,pi,opencode,agy' });
  begin('overview');
  const top = () => a.run(`document.getElementById('overview-scroll')?.scrollTo(0, 0)`);
  /** Waits for a state the next pictures show; the run stops if it never comes, so no picture shows the wrong one. */
  const must = async (expression, ms, what) => { if (!(await waitFor(a, expression, ms))) throw new Error(`The Overview's tour waited in vain for ${what}; its usage line said: ${await a.run(`document.querySelector('#overview-usage')?.innerText`)}; the page: ${(await a.run(`document.querySelector('#overview-scroll')?.innerText ?? document.body.innerText`)).slice(0, 400)}`); };
  // No tool, and a record that stops every write: why it can't be written is said too.
  mkdirSync(join(HOME, '.central-knot'), { recursive: true });
  writeFileSync(join(HOME, '.central-knot/sync.json'), '{ damaged');
  await a.click('#home-actual');
  await must(`!!document.querySelector('#overview-choose-home') && !!document.querySelector('#overview-stopped')`, 15000, 'a home with no tool and a damaged record');
  await atEverySize('no-tools', 'This computer’s home with no tool in it, and its record damaged: one sentence and the way on, then why nothing can be written; no cards, usage strip or table', true);
  rmSync(join(HOME, '.central-knot/sync.json'));
  const old = new Date(Date.now() - 40 * DAY), ago = days => new Date(Date.now() - days * DAY).toISOString();
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const [name, version] of [['claude', '2.1.322 (Claude Code)'], ['copilot', '1.0.4'], ['codex', 'codex-cli 0.142.3'], ['pi', '0.68.1'], ['opencode', '1.14.2']]) writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`, { mode: 0o755 });
  const words = ['api', 'audit', 'build', 'cache', 'changelog', 'ci', 'cloud', 'commit', 'config', 'cost', 'data', 'db', 'debug', 'deploy', 'design', 'docs', 'docker', 'edge', 'email', 'error', 'event', 'feature', 'flag', 'git', 'grafana', 'helm', 'incident', 'infra', 'jira', 'k8s', 'lint', 'log', 'merge', 'metric', 'migrate', 'monitor', 'note', 'oncall', 'perf', 'plan', 'pr', 'prompt', 'query', 'release', 'review', 'risk', 'schema', 'search', 'security', 'sql', 'test', 'ticket', 'trace', 'triage'];
  const skillNames = ['check', 'draft', 'summary'].flatMap(verb => words.map(word => `${word}-${verb}`)).slice(0, 99);
  // A long name, shortened in the middle where it is among the most used.
  skillNames.push('kubernetes-deployment-rollout-health-check');
  const roots = { claude: '.claude/skills', copilot: '.copilot/skills', codex: '.codex/skills', pi: '.pi/agent/skills', opencode: '.config/opencode/skills' };
  const putSkill = (root, name, body = `Steps for ${name}.`) => {
    const folder = join(HOME, root, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when you need ${name.replace(/-/g, ' ')}.\n---\n\n${body}\n`);
    for (const path of [join(folder, 'SKILL.md'), folder]) utimesSync(path, old, old);
  };
  skillNames.forEach((name, at) => { putSkill(roots.claude, name); if (at % 2) putSkill(roots.copilot, name); if (at % 5 === 0) putSkill(roots.codex, name); if (at % 3 === 0) putSkill(roots.pi, name); if (at % 7 === 0) putSkill(roots.opencode, name); });
  // One found skill whose copies differ, in Claude Code and Copilot CLI.
  putSkill(roots.claude, 'issue-triage', 'Label new issues by area and urgency.');
  putSkill(roots.copilot, 'issue-triage', 'Label new issues by area.');
  for (const root of Object.values(roots)) mkdirSync(join(HOME, root), { recursive: true });
  const servers = ['github', 'linear', 'sentry', 'postgres', 'grafana', 'slack', 'notion', 'figma', 'datadog', 'kubernetes', 'stripe', 'browser'];
  writeFileSync(join(HOME, '.claude.json'), JSON.stringify({ mcpServers: Object.fromEntries(servers.map(name => [name, { command: 'npx', args: ['-y', `@example/${name}-mcp`] }])) }, null, 2));
  utimesSync(join(HOME, '.claude.json'), old, old);
  mkdirSync(join(HOME, '.claude/agents'), { recursive: true });
  for (const name of ['planner', 'debugger', 'test-writer', 'doc-writer', 'security-reviewer', 'migrator', 'reviewer', 'researcher']) { writeFileSync(join(HOME, '.claude/agents', `${name}.md`), `---\nname: ${name}\ndescription: The ${name} agent.\n---\n\nYou are the ${name}.\n`); utimesSync(join(HOME, '.claude/agents', `${name}.md`), old, old); }
  const pluginSkills = { 'team-git': ['create-mr', 'rebase-help'], 'team-infra': ['helm-alert-audit', 'helm-alert-summary'], 'team-docs': ['publish-html'], 'team-observability': ['query-logs', 'query-traces'], 'team-risk': ['risk-handoff'], 'team-jira': ['jira-sprint', 'jira-search'] };
  for (const [plugin, skills] of Object.entries(pluginSkills)) writeClaudeInstall(HOME, 'team-tools', plugin, '1.2.0', { '.claude-plugin/plugin.json': JSON.stringify({ name: plugin, version: '1.2.0' }), ...Object.fromEntries(skills.map(name => [`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name} from ${plugin}.\n---\n\nSteps.\n`])) });
  // Session history: Claude Code (40 sessions in 25 days, one 45 days ago), Copilot CLI (12 from 18 days ago), Pi (6 from 9 days ago).
  const lines = (path, records) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, records.map(record => JSON.stringify(record)).join('\n') + '\n'); };
  const used = skillNames.filter((_, at) => at % 3 !== 2);
  lines(join(HOME, '.claude/projects/-work/s-old.jsonl'), [{ type: 'user', message: { content: 'hello' }, timestamp: ago(45) }]);
  for (let n = 0; n < 40; n++) {
    const skills = [used[n % used.length], used[(n * 7) % 12], 'jira-check', ...(n % 3 ? [] : ['kubernetes-deployment-rollout-health-check'])], calls = servers.slice(0, 1 + (n % 3));
    lines(join(HOME, `.claude/projects/-work/s${n}.jsonl`), [{ type: 'assistant', message: { content: [...skills.map(skill => ({ type: 'tool_use', name: 'Skill', input: { skill } })), ...calls.map(server => ({ type: 'tool_use', name: `mcp__${server}__call`, input: {} })),
      ...(n % 4 ? [] : [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'planner' } }])] }, timestamp: ago((n * 25) / 40) }]);
  }
  for (let n = 0; n < 12; n++) lines(join(HOME, `.copilot/session-state/c${n}/events.jsonl`), [{ type: 'session.start', data: {}, timestamp: ago(18 - n) }, { type: 'skill.invoked', data: { name: used[(n * 5) % used.length] }, timestamp: ago(18 - n) }]);
  for (let n = 0; n < 6; n++) lines(join(HOME, `.pi/agent/sessions/--w--/p${n}.jsonl`), [{ type: 'message', message: { role: 'user', content: [{ type: 'text', text: `<skill name="${used[n * 3]}">` }] }, timestamp: ago(9 - n) }]);
  await a.click('#home-actual');
  const opened = Date.now();
  await must(`!!document.querySelector('#setup-question') && /Usage collected/.test(document.querySelector('#overview-usage .overview-usage-text:not(.band-unshown)')?.textContent ?? '')`, 180000, 'first setup’s question and a reading');
  console.log(`(the made-up home's first reading landed ${Math.round((Date.now() - opened) / 1000)} s after it opened)`);
  await top();
  await atEverySize('first-setup', 'The same home with its tools in it, opened for the first time: first setup’s question first; the cards count what was found (nothing synced yet) and what the usage reading, collected by itself, says; a row per tool with its version', true);
  await a.click('#setup-no');
  await must(`!!document.querySelector('#overview-skills-differ')`, 30000, 'the line for copies that differ');
  if (await a.has('#outcome-dismiss')) await a.click('#outcome-dismiss');
  await top();
  await shot(a, 'synchronize-everything-off-1280', 'Answered No: the found skill whose copies differ is said once, on a line of its own with Show them (Synchronize everything off) (1280×800)');
  await a.click('#nav-settings');
  await must(`!!document.querySelector('#sync-everything-on')`, 15000, 'Settings’ Synchronize everything');
  await a.click('#sync-everything-on');
  await waitFor(a, `!!document.querySelector('#walkthrough') || !document.querySelector('#sync-everything-on:not([aria-checked="true"])')`, 60000);
  if (await a.has('#walk-leave')) await a.click('#walk-leave');
  await a.click('#nav-overview');
  if (await a.has('#outcome-dismiss')) await a.click('#outcome-dismiss');
  // Opened again, its first reading held back: the cards' usage lines and the sessions column hold their room.
  const requests = await requestHandles(a);
  if (requests) {
    await requests.slow('usage:read', 20000);
    await a.click('#home-actual');
    await must(`/Collecting usage/.test(document.querySelector('#overview-usage .overview-usage-text:not(.band-unshown)')?.textContent ?? '') && !!document.querySelector('.kind-card') && !document.querySelector('#walkthrough')`, 15000, 'the first reading held back');
    await top();
    await atEverySize('collecting', 'Synchronize everything on, the home opened again, its first reading running (held back here): every place a reading fills is drawn at its size, with … where a figure will be', true);
    await requests.restore('usage:read');
  }
  await must(`/Usage collected/.test(document.querySelector('#overview-usage .overview-usage-text:not(.band-unshown)')?.textContent ?? '') && !!document.querySelector('#setup-choosing')`, 30000, 'the reading landed');
  await top();
  await atEverySize('collected', 'The reading landed with nothing moved: each card says how many were used in 30 days, how many the page’s No use seen chip holds (a link to it) and the three most used (links to their rows); each tool’s sessions in 30 days, and where its history starts later', true);
  if (requests) {
    await requests.fail('usage:read');
    await a.click('#overview-collect-usage');
    await must(`!!document.querySelector('.overview-usage-failed')`, 15000, 'a failed reading');
    await top();
    await shot(a, 'reading-failed-1280', 'Clicked Update usage statistics, and the reading failed: the line, boxed, says so with Try again; no figure from the reading before stays (1280×800)');
    await requests.restore('usage:read');
  }
  // Claude Code's and Pi's history gone: Copilot CLI alone says which skills it ran, and no tool here can tell about MCP servers or agents.
  renameSync(join(HOME, '.claude/projects'), join(HOME, '.claude/projects-away'));
  renameSync(join(HOME, '.pi/agent/sessions'), join(HOME, '.pi/agent/sessions-away'));
  await a.click(requests ? '#overview-collect-again' : '#overview-collect-usage');
  await must(`/can’t say/.test(document.querySelector('#overview-mcp-usage')?.textContent ?? '')`, 30000, 'a kind no tool can tell about');
  await top();
  await shot(a, 'cant-say-1280', 'Only Copilot CLI’s history left: it tells which skills ran, so Skills has its figures; no tool here that has them on can tell about MCP servers or agents, so those cards say can’t say (1280×800)');
  renameSync(join(HOME, '.claude/projects-away'), join(HOME, '.claude/projects'));
  renameSync(join(HOME, '.pi/agent/sessions-away'), join(HOME, '.pi/agent/sessions'));
  await a.click('#overview-collect-usage');
  await must(`!/can’t say/.test(document.querySelector('#overview-mcp-usage')?.textContent ?? '') && /Usage collected/.test(document.querySelector('#overview-usage .overview-usage-text:not(.band-unshown)')?.textContent ?? '')`, 30000, 'the history back');
  // A problem waiting: Copilot CLI's MCP file can't be read; and Claude Code's own record of its plugins can't either.
  writeFileSync(join(HOME, '.copilot/mcp-config.json'), '{ "mcpServers": { "github": ');
  const installed = join(HOME, '.claude/plugins/installed_plugins.json'), installedText = readFileSync(installed, 'utf8');
  writeFileSync(installed, '{');
  await refresh();
  await a.click('#nav-overview');
  await top();
  await atEverySize('problem', 'A problem waiting: Copilot CLI’s MCP file couldn’t be read; it comes first, with the way to its page. In the table “?” for Copilot CLI’s MCP servers and for Claude Code’s plugins, whose record couldn’t be read, and the key says what “?” is; MCP servers says nothing of sync', true);
  rmSync(join(HOME, '.copilot/mcp-config.json'));
  writeFileSync(installed, installedText);
  await refresh();
  // An update to install: found by Check for updates, then downloaded from the Overview's own button with a draft typed.
  releases.push({ tag: 'v0.7.1-alpha.1', zip, asset: 'Central-Knot-Alpha-0.7.1-mac-arm64.zip', bytesPerSecond: 400_000 });
  await a.click('#nav-overview');
  await a.click('#update-control');
  await must(`!!document.querySelector('#overview-update')`, 20000, 'an update to install');
  await top();
  await atEverySize('update', 'A newer release found: its line comes first, with What’s new and Update; the sidebar’s control says it too', true);
  await a.click('#nav-instructions');
  await must(`!!document.querySelector('[id^="ins-edit-"]')`, 15000, 'an instruction file to edit');
  const tool = await a.run(`document.querySelector('[id^="ins-edit-"]')?.id.slice('ins-edit-'.length) ?? ''`);
  await a.click(`#ins-edit-${tool}`);
  await a.run(`(() => { const area = document.querySelector('#ins-text-${tool}'); area.value += '\\n- Not saved yet.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await a.settle();
  await a.click('#nav-overview');
  await a.click('#overview-update');
  await must(`/Downloading… [1-9]/.test(document.querySelector('#overview-update')?.textContent ?? '')`, 15000, 'the download under way');
  await top();
  await shot(a, 'downloading-1280', 'With an instructions draft typed and not saved, clicked Update on the Overview: its button says the download’s progress, as the sidebar’s ring does (1280×800)');
  await must(`document.querySelector('#update-control')?.dataset.look === 'held' && !!document.querySelector('#overview-update')`, 40000, 'the held restart');
  await top();
  await shot(a, 'held-1280', 'Downloaded and prepared; the unsaved draft holds the restart: the Overview’s button, like the sidebar’s control, says Restart to update… and opens Settings, which says what would be lost (1280×800)');
  await a.click('#overview-update');
  await must(`!!document.querySelector('#setting-updates')`, 15000, 'Settings’ Updates row');
  await shot(a, 'held-clicked-1280', 'Clicked Restart to update… on the Overview: Settings’ Updates row, which says what restarting would lose, beside its own Restart button (1280×800)');
  if (requests) requests.close();
  await fixture.close();
  if (pageErrors.length) throw new Error(`The page threw: ${pageErrors.join(' | ')}`);
}

a.quit();
// An AppImage's mount goes a moment after its app; the folder goes as the script ends (scratch.ts).
await mountsGone(scratch);
console.log(`tour in ${out}`);
