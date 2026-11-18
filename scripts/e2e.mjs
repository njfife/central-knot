// Drives the real app end to end over its debug port, in a throwaway HOME, so "This Mac's home" is disposable too.
// Usage: node scripts/e2e.mjs [--electron] [--no-sandbox] [--shots dir] [--crash-rounds n] [--flows openCodeFlow,…]
// `--flows` runs only the named flows, here, on one HOME, for working on one. Without it the run is every flow that can run here
// (crashFlow needs a home the app writes and --crash-rounds above 0: `runs`): this script once per group (`groups`, at the end)
// with that group's `--flows`, CK_E2E_GROUPS_AT_ONCE copies at a time (runGroups).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, closeSync, constants as fsConstants, cpSync, existsSync, openSync, renameSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeClaudeInstall, writeMarket, writeOldParts } from './fixture-market.mjs';
import { serveReleases } from './update-fixture.mjs';
import { packagedApp } from './package-app.mjs';
import { connect, DAY, debugPorts, holdQueue, keepFor, mainProcess, mountsGone, refocus, byId, rowPart, standIn } from './cdp.mjs';
import { standInApp, standInMac } from '../tests/macstandins.ts';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { managedNow } from '../src/share.ts';
import { writesRealHome } from '../src/machine.ts';
import { applySkills } from '../src/skills.ts';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const shots = option('--shots');
const named = option('--flows')?.split(',');
const crashRounds = Number(option('--crash-rounds', 6));
const canWriteRealHome = writesRealHome(process.platform);
const root = resolve(import.meta.dirname, '..');
const command = flag('--electron') ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : packagedApp();

// ---------- Checks ----------
const failures = [];
let passes = 0;
// The flow running now, named on each FAIL line: a grouped run prints its groups' lines together.
let flowRunning = 'seedHome';
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures.push(`[${flowRunning}] ${name}`);
  console.error(`FAIL [${flowRunning}] ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}
const same = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
// A file a poll reads; empty for the moment the app's checked write has it moved aside.
const readNow = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
/** A settings file with its MCP entries in name order: an entry Central Knot puts back goes at the end, so its place is Central Knot's; every other part is compared as it is. */
const entriesSorted = text => {
  if (!text.trimStart().startsWith('{')) { const [head, ...tables] = text.split(/^(?=\[)/m); return [head.trim(), ...tables.map(table => table.trim()).sort()]; }
  const settings = JSON.parse(text);
  return { ...settings, mcpServers: Object.fromEntries(Object.entries(settings.mcpServers ?? {}).sort(([first], [second]) => first.localeCompare(second))) };
};

// ---------- Disposable home ----------
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ck-e2e-')));
const HOME = join(scratch, 'home');
// What stands in for /Applications, the running apps and the Trash in every launch on a Mac (platform.ts macPlaces): no flow
// looks at or removes the real ones. Off a Mac, where there are none, only the flows about another build name stand-ins of
// their own (alphaSyncedHome), as a Mac's: a Linux user's app never looks for another build (main.ts looksForBuilds), and
// every other flow runs as theirs does.
const MAC = standInMac(join(scratch, 'mac'));
const CLAUDE = join(HOME, '.claude/skills'), COPILOT = join(HOME, '.copilot/skills'), AGENTS = join(HOME, '.agents/skills'), CODEX = join(HOME, '.codex/skills');
const text = (name, body = 'Body.', extra = '') => `---\nname: ${name}\ndescription: The ${name} skill.\n${extra}---\n\n${body}\n`;
function skill(base, folder, content = text(folder)) {
  const directory = join(base, folder);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), content);
  return directory;
}
function tree(directory, options = {}) {
  const out = {};
  const visit = current => {
    for (const name of readdirSync(current).sort()) {
      if (name === '.git' && !options.git) continue;
      const path = join(current, name), info = lstatSync(path), key = relative(directory, path);
      if (info.isSymbolicLink()) out[key] = `link:${readlinkSync(path)}`;
      else if (info.isDirectory()) { out[key] = 'dir'; visit(path); }
      else out[key] = `${info.mode & 0o777}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    }
  };
  visit(directory);
  return out;
}
/** Claude Code's, Copilot CLI's and Codex's CLIs in `home`'s ~/.local/bin, stand-ins that answer --version only: the tools a home has. */
function toolClis(home) {
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.'], ['codex', 'codex-cli 0.142.3']]) {
    writeFileSync(join(home, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
    chmodSync(join(home, '.local/bin', name), 0o755);
  }
}
function seedHome() {
  const rich = skill(CLAUDE, 'rich', text('rich', 'Values stay as they are: api_key=abc123'));
  mkdirSync(join(rich, 'scripts'));
  writeFileSync(join(rich, 'scripts/run.sh'), '#!/bin/sh\necho hi\n');
  chmodSync(join(rich, 'scripts/run.sh'), 0o755);
  writeFileSync(join(rich, 'asset.bin'), Buffer.from([0, 1, 2, 254, 255]));
  mkdirSync(join(rich, 'empty-folder'));
  mkdirSync(join(rich, '.git'));
  writeFileSync(join(rich, '.git/HEAD'), 'ref: refs/heads/main\n');
  skill(CLAUDE, '名前-skill', text('名前-skill', '日本語の本文。'));
  skill(CLAUDE, 'scoped', text('scoped', 'Body.', 'paths: ["src/**"]\n'));
  skill(CLAUDE, 'plain', 'No frontmatter at all.\n');
  skill(CLAUDE, 'private-one');
  skill(CLAUDE, '.dot-skill');
  skill(CLAUDE, 'bad-yaml', '---\nname: [unclosed\n---\nBody\n');
  skill(CLAUDE, 'clash', text('clash', 'Claude version.'));
  skill(COPILOT, 'clash', text('clash', 'Copilot version.'));
  skill(CLAUDE, 'twin');
  skill(COPILOT, 'twin');
  skill(COPILOT, 'from-copilot');
  const held = skill(CLAUDE, 'has-link');
  symlinkSync('SKILL.md', join(held, 'alias'));
  const shared = skill(AGENTS, 'linked');
  symlinkSync(shared, join(CLAUDE, 'linked'));
  symlinkSync(join(AGENTS, 'missing'), join(CLAUDE, 'from-copilot'));
  toolClis(HOME);
  writeFileSync(join(HOME, '.claude/unrelated.json'), '{ "keep":   "these bytes" }\n');
  skill(CLAUDE, `very-long-${'n'.repeat(150)}`);
  skill(CLAUDE, 'MixedCase');
  const locked = skill(CLAUDE, 'read-only-inside');
  mkdirSync(join(locked, 'refs'));
  writeFileSync(join(locked, 'refs/a.md'), 'a');
  chmodSync(join(locked, 'refs'), 0o555);
  const hidden = skill(CLAUDE, 'unreadable-file');
  writeFileSync(join(hidden, 'secret-bits.md'), 'x');
  chmodSync(join(hidden, 'secret-bits.md'), 0o000);
}

// ---------- App ----------
// On Linux the file manager the app opens is this stand-in: it notes what it was asked to open.
const fileManagerAsked = join(scratch, 'opened.txt');
if (process.platform === 'linux') {
  mkdirSync(join(scratch, 'bin'));
  writeFileSync(join(scratch, 'bin/xdg-open'), `#!/bin/sh\necho "$*" >> '${fileManagerAsked}'\n`);
  chmodSync(join(scratch, 'bin/xdg-open'), 0o755);
}
let app;
// Every app this run started, and a flow's stand-in running app (standInApp), is closed when the run ends, however it ends: a
// failed or interrupted run must not leave an app holding a debug port that a later run could attach to, or a stand-in for ever.
const launched = new Set();
process.on('exit', () => { for (const child of launched) { try { child.kill('SIGKILL'); } catch { /* already gone */ } } });
// A grouped run's parent passes these on to its copies and waits for them instead (runGroups).
if (named) for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

async function launch(userData = join(scratch, 'data'), extra = [], home = HOME, more = {}) {
  // OpenCode's CLI is looked for only inside the throwaway home, and on a Mac every app in the stand-in for /Applications
  // (CK_TEST_APPS, empty here): a machine that has them installed (the Mac these run on does) would otherwise bring them into
  // every flow that opens "This Mac's home".
  const env = { HOME: home, PATH: `${join(scratch, 'bin')}:/usr/bin:/bin`, TMPDIR: join(scratch, 'tmp'), CK_TEST_HOME_ONLY: 'opencode', CK_PLUGIN_UPDATES_EVERY_MS: 'never', ...(process.platform === 'darwin' ? { CK_TEST_APPS: MAC.root } : {}), ...more };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  // The app picks its own free debug ports (port 0) and says them, so no other run on this machine can be on them (cdp.mjs
  // debugPorts). A dev run also opens its main process to the checks (an installed app doesn't take --inspect). A window that
  // another copy's window covers stays a shown page (Chromium's switch): hidden, it would take no new size from the checks.
  const child = spawn(command, [...(flag('--electron') ? [root, '--inspect=0'] : []), '--remote-debugging-port=0', '--disable-backgrounding-occluded-windows', `--user-data-dir=${userData}`, ...(flag('--no-sandbox') ? ['--no-sandbox'] : []), ...extra], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  launched.add(child);
  child.once('exit', () => launched.delete(child));
  let port, inspect;
  try { ({ port, inspect } = await debugPorts(child, flag('--electron'))); } catch (error) { child.kill('SIGKILL'); throw error; }
  let targets;
  for (let attempt = 0; attempt < 150 && !targets; attempt++) {
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(target => target.type === 'page'); if (!targets.length) targets = undefined; } catch { /* still starting */ }
    if (!targets) await wait(200);
  }
  if (!targets) { child.kill('SIGKILL'); throw new Error('The app opened no window.'); }
  const pageErrors = [];
  const page = await connect(targets[0].webSocketDebuggerUrl, data => {
    if (data.method === 'Runtime.exceptionThrown') pageErrors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') pageErrors.push(data.params.entry.text);
  });
  const { send, run } = page;
  await send('Runtime.enable');
  await send('Log.enable');
  // A page that never settles (a renderer error at start, a read that never ends) fails the run instead of holding it open.
  /** A click on the control `selector` names, then the page settled; `closing`: a row's own switch or Add starts a run of its own. */
  const clickRow = async (selector, closing) => {
    await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); if (${closing} && e.matches('.switch, .add-item') && e.closest('[data-key], [data-plugin]') && !e.closest('.details')) document.querySelector('#outcome-dismiss, #report-dismiss')?.click(); e.click(); })()`);
    await settle();
  };
  const settle = async () => { await wait(120); await run(`new Promise((done, fail) => { const end = Date.now() + 30000; const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.mx,.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : Date.now() > end ? fail(new Error('The page did not settle within 30 s.')) : setTimeout(c, 25); c(); })`); await wait(60); };
  app = {
    child, run, send, settle, pageErrors, debugUrl: targets[0].webSocketDebuggerUrl,
    inspect, main: inspect && (() => mainProcess(inspect)),
    // A row's own switch or Add clicked here is a run of its own: the header's result is closed first, which ends the run on screen
    // (clicklist.ts runAt), so each step reads its own click's result. clickInRun leaves it open, so a click soon after the last
    // one joins its run, as a person's usually does; the checks of runs click that way, by pointer (clickAt) or in the page.
    click: selector => clickRow(selector, true),
    clickInRun: selector => clickRow(selector, false),
    exists: selector => run(`!!document.querySelector(${JSON.stringify(selector)})`),
    text: selector => run(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`),
    all: (selector, field = 'e.textContent') => run(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(e => ${field})`),
    press: async (key, code = key) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, text: type === 'keyDown' && key.length === 1 ? key : undefined }); await settle(); },
    shot: async name => { if (!shots) return; const reply = await send('Page.captureScreenshot', { format: 'png' }); mkdirSync(shots, { recursive: true }); writeFileSync(join(shots, `${name}.png`), Buffer.from(reply.result.data, 'base64')); },
    expand: async () => { await run(`[...document.querySelectorAll('button')].filter(b => /^Show \\d+ skill/.test(b.textContent.trim()) && b.getAttribute('aria-expanded') !== 'true').forEach(b => b.click())`); await settle(); },
    plan: () => run(`Object.fromEntries([...document.querySelectorAll('.plan-card')].map(e => [e.dataset.key, e.dataset.state]))`),
    pages: async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(target => target.type === 'page').length,
    // Waits for the app to be gone, as the next launch on its data folder would hand over to it (main.ts, one at a time) and open
    // nothing: Quit may wait for a plugin update (main.ts before-quit, 15 s at most), and a busy machine is slower still.
    quit: async () => {
      const from = Date.now();
      page.close(); child.kill('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) await new Promise(done => { const limit = setTimeout(done, 30000); child.once('exit', () => { clearTimeout(limit); done(); }); });
      if (Date.now() - from > 5000) console.log(`(an app took ${Math.round((Date.now() - from) / 1000)} s to quit)`);
    },
    crash: () => new Promise(done => { page.close(); child.once('exit', done); child.kill('SIGKILL'); }),
  };
  await settle();
  return app;
}

/**
 * New profile, then its name and Enter, typed in the page as the name field opens: leaving the field saves the name it has
 * (profilespage.ts renameField), and in a grouped run another copy's window can take the focus between two requests.
 */
async function newProfile(a, name) {
  await a.run(`new Promise((done, fail) => {
    const field = new MutationObserver(() => { const input = document.querySelector('#profile-name'); if (!input) return; field.disconnect();
      input.value = ${JSON.stringify(name)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); done(true); });
    field.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { field.disconnect(); fail(new Error('New profile opened no name field within 30 s.')); }, 30000);
    document.querySelector('#profile-new').click();
  })`);
  await a.settle();
}

/**
 * The main process's own debugger, for a development run launched with --inspect=port. A test uses it only to do what a
 * person does outside the window (click an item in the menu bar menu), or to make one request fail.
 */
/** The branch's own handles on main (debugger on `port`): the menu, and one request slowed, failed or answered late. */
async function mainHelpers(port) {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try { [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { /* still starting */ }
    if (!target) await wait(100);
  }
  if (!target) throw new Error('The main process did not open its debug port.');
  const { send, run, close } = await connect(target.webSocketDebuggerUrl);
  const electron = `process.mainModule.require('electron')`;
  return {
    /** Clicks the checkbox item `label` in the live menu bar menu, where it now reads `checked`; returns how many it clicked. */
    clickMenu: async (label, checked) => {
      await send('HeapProfiler.collectGarbage');
      const prototype = await send('Runtime.evaluate', { expression: `${electron}.Menu.prototype` });
      if (!prototype.result?.result?.objectId) throw new Error('No Electron Menu in the main process: the menu test cannot find the menu bar menu.');
      const menus = await send('Runtime.queryObjects', { prototypeObjectId: prototype.result.result.objectId });
      const clicked = await send('Runtime.callFunctionOn', { objectId: menus.result.objects.objectId, arguments: [{ value: label }, { value: checked }], returnByValue: true,
        // Every object with Menu's prototype comes back, not only menus: only a menu has .items.
        functionDeclaration: `function (label, checked) { const items = this.filter(menu => Array.isArray(menu.items)).flatMap(menu => menu.items).filter(item => item.label === label && item.checked === checked); for (const item of items) item.click({}, undefined, undefined); return items.length; }` });
      return clicked.result.result.value;
    },
    /** Makes one request from the page fail until `restore` runs; the real handler stays aside meanwhile. */
    failRequest: channel => run(`(() => { const handlers = ${electron}.ipcMain._invokeHandlers; if (!(handlers instanceof Map)) throw new Error('This Electron has no ipcMain._invokeHandlers: the failed-Refresh test needs another way to make a request fail.'); globalThis.ckAside = handlers.get(${JSON.stringify(channel)}); handlers.set(${JSON.stringify(channel)}, () => { throw new Error('Refused for the test.'); }); return !!globalThis.ckAside; })()`),
    /** Makes one request from the page take `ms` longer until `restore` runs. */
    slowRequest: (channel, ms) => run(`(() => { const handlers = ${electron}.ipcMain._invokeHandlers; if (!(handlers instanceof Map)) throw new Error('This Electron has no ipcMain._invokeHandlers: the busy test needs another way to slow a request.'); const real = handlers.get(${JSON.stringify(channel)}); globalThis.ckAside = real; handlers.set(${JSON.stringify(channel)}, (...args) => new Promise(done => setTimeout(done, ${Number(ms)})).then(() => real(...args))); return true; })()`),
    /** Makes one request's reply reach the page `ms` later (the work itself runs at once), until `restore` runs. */
    slowReply: (channel, ms) => run(`(() => { const handlers = ${electron}.ipcMain._invokeHandlers; const real = handlers.get(${JSON.stringify(channel)}); globalThis.ckAside = real; handlers.set(${JSON.stringify(channel)}, (...args) => Promise.resolve(real(...args)).then(value => new Promise(done => setTimeout(() => done(value), ${Number(ms)})))); return true; })()`),
    /** Holds the first completed discovery reply matching the scenario, with its real view already read from disk. */
    holdRefresh: (matches) => run(`(() => {
      const handlers = ${electron}.ipcMain._invokeHandlers, real = handlers.get('discovery:refresh');
      globalThis.ckRefreshHeld = false;
      handlers.set('discovery:refresh', async (event, asked) => {
        const view = await real(event, asked);
        if (!(${matches})) return view;
        handlers.set('discovery:refresh', real);
        await new Promise(release => { globalThis.ckReleaseRefresh = release; globalThis.ckRefreshHeld = true; });
        return view;
      });
      return true;
    })()`),
    refreshHeld: () => run('globalThis.ckRefreshHeld'),
    releaseRefresh: () => run('globalThis.ckReleaseRefresh()'),
    /** Notes, for each sync:changed the page is sent, whether a `channel` request was under way (`told` reads it), until `restore` runs. */
    noteTells: channel => run(`(() => { const { ipcMain, BrowserWindow } = ${electron}; const contents = BrowserWindow.getAllWindows()[0].webContents, real = ipcMain._invokeHandlers.get(${JSON.stringify(channel)}); let open = 0; globalThis.ckAside = real; globalThis.ckTold = []; contents.send = function (name, ...rest) { if (name === 'sync:changed') globalThis.ckTold.push(open > 0); return Object.getPrototypeOf(contents).send.call(contents, name, ...rest); }; ipcMain._invokeHandlers.set(${JSON.stringify(channel)}, async (...rest) => { open++; try { return await real(...rest); } finally { open--; } }); return true; })()`),
    told: () => run(`(() => { delete ${electron}.BrowserWindow.getAllWindows()[0].webContents.send; return globalThis.ckTold; })()`),
    /** A later watcher or poll must not rescue a dropped notification in the two tests that deliver their own. */
    manualSyncOnly: on => run(`(contents => {
      if (!${on}) { delete contents.send; return; }
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => { if (channel !== 'sync:changed') send(channel, ...args); };
    })(${electron}.BrowserWindow.getAllWindows()[0].webContents)`),
    /** Sends the page a message, as the main process does after a background pass. */
    tellPage: channel => run(`(contents => Object.getPrototypeOf(contents).send.call(contents, ${JSON.stringify(channel)}))(
      ${electron}.BrowserWindow.getAllWindows()[0].webContents)`),
    /** Notes the arguments of each `channel` request (`calls` reads them), until `restore` runs. */
    noteCalls: channel => run(`(() => { const handlers = ${electron}.ipcMain._invokeHandlers, real = handlers.get(${JSON.stringify(channel)}); globalThis.ckAside = real; globalThis.ckCalls = []; handlers.set(${JSON.stringify(channel)}, (event, ...args) => { globalThis.ckCalls.push(args); return real(event, ...args); }); return true; })()`),
    calls: () => run(`globalThis.ckCalls`),
    restore: channel => run(`(() => { ${electron}.ipcMain._invokeHandlers.set(${JSON.stringify(channel)}, globalThis.ckAside); delete globalThis.ckAside; return true; })()`),
    close,
  };
}

// ---------- Flows ----------
/**
 * The keys of rows of `kind`, from their ids: each row's data-key is its row id (cdp.mjs rowPart), the kind's prefix taken off.
 * A row of another kind is a slip in the check (it reads the wrong page), and says so.
 */
const keysOf = (kind, ids) => ids.map(id => {
  if (!id.startsWith(rowPart('', kind, ''))) throw new Error(`${id} is no row of ${kind}`);
  return id.slice(rowPart('', kind, '').length);
});
const rowKeys = async (a, kind) => keysOf(kind, await a.all('.ov-row[data-key]', 'e.dataset.key'));
// A tool's mark on an item's row (a box on a page that still has one per tool): what that tool has.
const cellState = (a, kind, key, tool) => a.run(`document.getElementById(${JSON.stringify(rowPart('cell', kind, key, tool))})?.dataset.state ?? null`);
/** The tools whose mark on an item's row is drawn off: off with the copy kept, or (a library item) a state of that tool's own (held). */
const offMarks = (a, kind, key) => a.all(`.ov-row[data-key=${JSON.stringify(rowPart('', kind, key))}] .tool-mark:is([data-look="off"], [data-look="held"])`, 'e.dataset.tool');
const switchOn = (a, kind, key) => a.run(`document.querySelector('.ov-row[data-key=${JSON.stringify(rowPart('', kind, key))}] .switch')?.getAttribute('aria-checked') === 'true'`);
/** A heading's words as shown: its name, its count and its note, but not a note's hidden room (matrix.ts section). */
const headingSays = (a, role) => a.run(`[...(document.querySelector('.ov-section[data-section="${role}"] .ov-section-label')?.childNodes ?? [])].filter(node => !node.classList?.contains('ov-section-room')).map(node => node.textContent).join('')`);
/** The ids two or more elements on the page share: none on a page drawn right, each row's element ids carrying its row id. */
const sharedIds = a => a.run(`(() => { const ids = [...document.querySelectorAll('[id]')].map(each => each.id); return [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))]; })()`);
/** Each section on an item page of `kind`, in order, with the keys of its rows. */
const sectionsNow = async (a, kind) => (await a.run(`[...document.querySelectorAll('.ov-section[data-section]')].map(head => [head.dataset.section, [...head.parentElement.querySelectorAll('.ov-row[data-key]')].map(row => row.dataset.key)])`))
  .map(([section, ids]) => [section, keysOf(kind, ids)]);
/** Read one tool's Skills counts on its card, tab and Overview row, and the sections on its tab. */
async function skillsOf(a, tool, pictureRow) {
  await a.click(await a.exists('#harness-back') ? '#harness-back' : '#nav-harnesses');
  const card = await a.text(`#harness-${tool} .harness-count-value`); // Skills is the first kind.
  await a.click(`#harness-${tool}`);
  await a.click('#harness-tab-skills');
  const tab = await a.text('#harness-tab-skills .harness-tab-count');
  const sections = Object.fromEntries(await sectionsNow(a, 'skills'));
  if (shots && pictureRow) {
    await sizeTo(a, 1280, 800);
    await a.run(`document.querySelector('.ov-row[data-key="${rowPart('', 'skills', pictureRow)}"]').scrollIntoView({block: 'nearest'})`);
    await a.shot('claude-skills');
  }
  await a.click('#nav-overview');
  const overview = await a.text(`.tools-table tr[data-tool="${tool}"] td`);
  if (shots && pictureRow) {
    await a.run("document.querySelector('.tools-table').scrollIntoView({block: 'end'})");
    await a.shot('tools-overview');
    await a.send('Emulation.clearDeviceMetricsOverride');
  }
  return { sections, counts: [card, tab, overview] };
}

/** Harnesses: one tool's page manages its items with the same engine as the Skills page. */
async function harnessFlow() {
  // A packaged build starts on this computer's home: the switch puts it on the Practice copy, as a dev build starts.
  const a = await launch(join(scratch, 'harness-data'), ['--practice-copy']);
  const practice = await a.run(`document.querySelector('.status-home').title`);
  await a.click('#nav-harnesses');
  const list = await a.text('#harnesses-scroll') ?? '';
  check('Harnesses sums up each tool found', ['Claude Code', 'Copilot CLI', 'Codex'].every(name => list.includes(name)) && list.includes('none synced'), list.slice(0, 400));
  // The card's count and the tab it opens agree; another harness starts with the filter off.
  const cardDiffer = parseInt(await a.text('#harness-claude-cli-differ-skills') ?? '', 10);
  await a.click('#harness-claude-cli-differ-skills');
  same('a card’s different-copies count is the Copies differ count on the tab it opens', [cardDiffer, parseInt(await a.text('.chip-warn .chip-count') ?? '', 10), (await rowKeys(a, 'skills')).length], [1, 1, 1]);
  await a.click('#harness-switch-codex-cli');
  check('the switcher opens another harness with every row, not an empty filter', (await a.text('.title-harness')) === 'Codex' && ((await a.text('.chip-on')) ?? 'All') === 'All' && (await rowKeys(a, 'skills')).length > 0, `${await a.text('#header')} ${await a.text('.chips')}`);
  await a.click('#harness-back');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-skills');
  const firstMark = () => a.run(`document.querySelector('.ov-row[data-key] .tool-mark')?.dataset.tool ?? null`);
  same('a harness’s skills put its own mark first on each row, and have no column heads', [await firstMark(), await a.exists('.ov-head')], ['copilot-cli', false]);
  const away = await a.run(`[...document.querySelectorAll('[role="rowgroup"]')].find(group => group.querySelector('.ov-section-label strong')?.textContent === 'Not in Copilot CLI')?.querySelector('[data-key="${rowPart('', 'skills', 'release-notes')}"]') ? true : false`);
  check('a skill only other tools have is under "Not in Copilot CLI"', away);
  check('a harness’s page has no menus or Add from… to bring items in: a found row’s Add does', !(await a.exists('.tool-menu, #harness-add-from, .tool-head-button')));
  await a.click(`#${rowPart('add', 'skills', 'release-notes')}`);
  await a.shot('harness-switched');
  check('turning it on from a harness’s page copies it to every tool at once', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')) && existsSync(join(practice, '.codex/skills/release-notes/SKILL.md')));
  check('and says so there', await a.exists('#header .band-done'), await a.text('.harness-page'));
  await a.click('#nav-harnesses');
  check('the sidebar’s Harnesses leaves that result behind', !(await a.exists('.band-done')), await a.text('#page'));
  await a.click('#nav-skills');
  check('the Skills page shows the same change and is its usual self: Claude Code first, no "Not in" section', (await switchOn(a, 'skills', 'release-notes')) && (await firstMark()) === 'claude-cli' && !(await a.all('.ov-section-label strong')).some(label => label.startsWith('Not in')), await a.text('#page'));
  await a.click('#nav-harnesses');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-skills');
  await a.click('#nav-overview');
  // While first setup's question is asked it says the copies that differ itself; answered No, a line of their own says them.
  check('while first setup’s question is asked, it alone says the copies that differ', !(await a.exists('#overview-skills-differ')) && /copies that differ/.test(await a.text('#setup-question') ?? ''), await a.text('#overview-needs'));
  await a.click('#setup-no');
  same('answered No, one line says the found skill whose copies differ, by the page’s count', await a.text('#overview-skills-differ-line'), '1 found skill has copies that differ. Show them');
  await a.click('#overview-skills-differ');
  check('after a harness’s Skills tab, the Overview’s Show them still opens Skills narrowed to them', (await a.text('.chip-on') ?? '').startsWith('Copies differ'), await a.text('.chips'));
  await a.click('#nav-harnesses');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-instructions');
  await a.click('#harness-switch-claude-cli');
  // At the smallest window nothing on a harness's page is cut off: every tab, and the instruction file while it is edited
  // (before any save, while the card sizes to its file rather than to the versions list).
  for (const tab of ['skills', 'mcp', 'agents', 'instructions', 'plugins', 'about']) { await a.click(`#harness-tab-${tab}`); await fitsAtMinimum(a, `Claude Code’s ${tab} tab`); }
  await a.click('#harness-tab-instructions');
  await a.click('#ins-edit-claude-cli');
  await fitsAtMinimum(a, 'Claude Code’s instruction file while edited');
  // On a wide window the card sizes to its file at the reading measure, not to its 520px minimum.
  await sizeTo(a, 1728, 1117);
  check('on a wide window the harness’s instruction file is as wide as its reading measure', await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); return area.getBoundingClientRect().width > 700; })()`), await a.run(`document.querySelector('#ins-text-claude-cli')?.getBoundingClientRect().width`));
  await fullSize(a);
  await a.click('#ins-cancel-claude-cli');
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value += '- Saved from its harness page.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli');
  await a.click('#ins-save-claude-cli');
  check('a save on a harness’s Instructions tab writes the file and offers one Undo, on its card', readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Saved from its harness page.') && (await a.run(`document.querySelectorAll('#outcome-undo-instruction').length`)) === 1, await a.text('.harness-page'));
  // Another home: the instruction file shown is that home's, not the practice copy's.
  await a.click('#home-actual');
  await a.click('#nav-harnesses');
  await a.click('#harness-claude-cli');
  await a.click('#harness-tab-instructions');
  check('after a home switch, instructions are that home’s', (await a.text('#harness-body') ?? '').includes('~/.claude/CLAUDE.md'), await a.text('#harness-body'));
  same('no page errors, harnesses', a.pageErrors, []);
  await a.quit();
}

/**
 * A tool's Manage switch on its Harnesses card (toolchoice.ts), in the Practice copy: Codex left out, then managed again, with
 * what the line said before each click, the band after it, Codex's files byte for byte, and what the other pages show
 * meanwhile; then every tool left out.
 */
async function manageFlow() {
  const a = await launch(join(scratch, 'manage-data'), ['--practice-copy']);
  const practice = await a.run(`document.querySelector('.status-home').title`);
  const switches = () => a.all('[id^="manage-"][role="switch"]', 'e.id + ":" + e.getAttribute("aria-checked")');
  // standup on in every tool first, so Codex has a copy of Central Knot's while it is left out.
  await a.click('#nav-skills');
  await a.click(`#${rowPart('add', 'skills', 'standup')}`);
  await a.click('#nav-harnesses');
  same('every installed tool’s card has its Manage switch, on', await switches(), ['manage-claude-cli:true', 'manage-copilot-cli:true', 'manage-codex-cli:true']);
  check('before the click, the line says its copies stay and every item stays as it is', (await a.text('#manage-codex-cli-line')) === 'Off leaves Codex as it is: its copies stay, and every item stays as it is.', await a.text('#manage-codex-cli-line'));
  const codex = () => tree(join(practice, '.codex'));
  const before = codex();
  await a.click('#manage-codex-cli');
  check('the band says Codex is left out and its copies stay', (await a.text('.band-done .band-text') ?? '').startsWith('Codex is left out: Central Knot writes nothing there now.'), await a.text('.band-done'));
  same('turning it off wrote nothing in Codex', codex(), before);
  const card = await a.text('#harness-codex-cli');
  check('its card says it is left out, with its switch, opens nothing, and never says Not found or Install', card.includes('Not managed') && card.includes('Left out') && !/Not found|Install/.test(card) && !(await a.exists('button#harness-codex-cli')), card);
  check('its line says what turning it on would do: no item in Codex would change', (await a.text('#manage-codex-cli-line') ?? '').startsWith('On: no item in Codex would change'), await a.text('#manage-codex-cli-line'));
  await fitsAtMinimum(a, 'Harnesses with a tool left out');
  await a.click('#nav-skills');
  check('the Skills page has no Codex mark', (await a.exists('.tool-mark')) && !(await a.exists('.tool-mark[data-tool="codex-cli"]')));
  await a.click('#nav-overview');
  same('the Overview’s tools table has a row per managed tool, and the line under it says Codex is left out', [await a.all('.tools-table tbody tr', 'e.dataset.tool'), await a.text('#overview-left-out')],
    [['claude-cli', 'copilot-cli'], 'Codex is installed and left out: its switch is on Harnesses.']);
  same('Instructions and Plugins read no Codex', [
    await a.run(`window.centralKnot.instructions().then(files => files.map(file => file.tool))`),
    await a.run(`window.centralKnot.plugins(false).then(view => view?.tools ?? [])`)], [['claude-cli', 'copilot-cli'], ['claude-cli', 'copilot-cli']]);
  await a.click('#nav-history');
  for (let tries = 0; tries < 30 && !(await a.exists('.history-row')); tries++) await wait(100);
  const newest = `document.querySelector('.history-row')`;
  same('History has one entry for the flip, naming the tool, with no Undo', [
    await a.run(`${newest}.querySelector('.history-kind').textContent`), await a.run(`${newest}.querySelector('.history-what strong').textContent`),
    await a.run(`${newest}.querySelector('.history-about').textContent`), await a.run(`${newest}.querySelectorAll('.history-actions button').length`)],
  ['Tool', 'Codex', 'Left out from here on: Central Knot writes nothing in Codex, and its copies there stay as they are. No Undo: its switch on Harnesses is the way back.', 0]);
  await a.click('#nav-harnesses');
  // A hand edit in Codex while it is left out reads no page again (nothing was written), so its line still says nothing would
  // change; the band after the click says what the pass did there.
  const standup = join(practice, '.codex/skills/standup/SKILL.md');
  writeFileSync(standup, `${readFileSync(standup, 'utf8')}\nEdited in Codex while it was left out.\n`);
  await wait(2500);
  await a.click('#manage-codex-cli');
  same('turned on again, the band says what the pass did there, not what the card said before', await a.text('.band-done .band-text'),
    'Central Knot manages Codex now: Central Knot’s version written there for 1 item (over its copy there, which a version keeps). Each change there is in History.');
  same('turning it on put Central Knot’s version back over the hand edit: Codex holds what it held before', codex(), before);
  check('and its card opens its page again', await a.exists('button#harness-codex-cli'));
  // Clicked while main is busy (a held queue standing in for a long pass): the flip waits its turn behind it, the page says it
  // is busy and takes no other switch meanwhile, and the flip lands once the pass is done.
  if (a.main) {
    const main = await a.main();
    const held = await holdQueue(main, a);
    const leftOut = () => JSON.parse(readFileSync(join(practice, '.central-knot/sync.json'), 'utf8')).leftOut ?? [];
    // Not a.click: it waits for the page to be idle.
    await a.run(`document.querySelector('#manage-codex-cli').click()`);
    await wait(300);
    const during = [await a.run(`document.body.dataset.busy`), await a.run(`document.querySelector('#manage-claude-cli').disabled`), leftOut()];
    await held.release();
    same('a switch clicked while a pass runs waits for it, the other switches wait too, and it lands after', [during, leftOut()], [['true', true, []], ['codex-cli']]);
    await a.click('#manage-codex-cli');
    main.close();
  }
  // With Automatic sync off, a tool's line says when it is brought into line, and the band after the click says it again.
  await a.click('#sync-switch');
  await a.click('#manage-codex-cli');
  check('with Automatic sync off, the line before turning it on says Sync once brings it into line, and a click its own item', (await a.text('#manage-codex-cli-line') ?? '').endsWith('With Automatic sync off, Sync once brings it into line; a click on an item brings that item.'), await a.text('#manage-codex-cli-line'));
  await a.click('#manage-codex-cli');
  check('and so does the band after it', (await a.text('.band-done .band-text') ?? '') === 'Central Knot manages Codex now. With Automatic sync off, Sync once brings it into line; a click on an item brings that item.', await a.text('.band-done'));
  await a.click('#sync-switch');
  // Every tool left out: the pages say so and point to Harnesses, not that no tool was found.
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli']) await a.click(`#manage-${tool}`);
  same('with every tool left out, the sidebar holds only the pages that need no tool', await a.all('#nav [id^="nav-"]', 'e.id.slice(4)'), ['overview', 'harnesses', 'sources', 'history', 'repo', 'settings']);
  await a.click('#nav-overview');
  same('its Overview names the tools left out and opens Harnesses', [await a.text('.overview-lead'), await a.exists('#overview-open-harnesses'), await a.exists('#overview-choose-home')],
    ['Central Knot manages none of the tools here: Claude Code, Copilot CLI and Codex are left out.', true, false]);
  same('and the status bar’s switch has nothing to sync', await a.text('#sync-switch .sync-state'), 'Nothing to sync');
  await fitsAtMinimum(a, 'a home with every tool left out');
  await a.click('#overview-open-harnesses');
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli']) await a.click(`#manage-${tool}`);
  same('every tool managed again', await switches(), ['manage-claude-cli:true', 'manage-copilot-cli:true', 'manage-codex-cli:true']);
  same('no page errors, manage', a.pageErrors, []);
  await a.quit();
}

// ---------- Fit: nothing is cut off ----------
// In the page, on both axes: each control (button, switch, input, filter chip, tool label) that the window or a clipping
// ancestor cuts. A control a scroll area can bring into view is reachable there, but that scroll area's own viewport must
// still be visible within every clipping boundary outside it, up to the window. Also each region that scrolls sideways,
// and each bar the app's own fitting (dom.ts fitBars) marks as still too wide.
// Empty when everything fits.
const CUT_OFF = `(() => {
  const out = [];
  const label = node => node.id || node.getAttribute('aria-label') || (node.textContent || '').trim().slice(0, 40) || String(node.className);
  const inside = (box, edge, axis) => axis === 'x' ? box.left >= edge.left - 1 && box.right <= edge.right + 1 : box.top >= edge.top - 1 && box.bottom <= edge.bottom + 1;
  const overflow = (style, axis) => style[axis === 'x' ? 'overflowX' : 'overflowY'];
  const scrolls = (node, style, axis) => ['auto', 'scroll'].includes(overflow(style, axis)) && (axis === 'x' ? node.scrollWidth > node.clientWidth + 1 : node.scrollHeight > node.clientHeight + 1);
  const view = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  for (const node of document.querySelectorAll('button, [role="switch"], input:not(.hidden-input), .chip, .ov-tool-head, .plugin-tool-name')) {
    const own = node.getBoundingClientRect();
    if (own.width < 2 || own.height < 2) continue;
    // What must be visible on each axis: the control itself, until a scroll area can bring it into view; then that area.
    const subject = { x: own, y: own };
    let cut = '';
    for (let up = node.parentElement; up && up !== document.body && !cut; up = up.parentElement) {
      const style = getComputedStyle(up), edge = up.getBoundingClientRect();
      for (const axis of ['x', 'y']) {
        if (cut || overflow(style, axis) === 'visible') continue;
        if (scrolls(up, style, axis)) subject[axis] = edge;
        else if (!inside(subject[axis], edge, axis)) cut = (axis === 'x' ? 'cut sideways by ' : 'cut off below or above by ') + (up.id || up.className);
      }
    }
    for (const axis of ['x', 'y']) if (!cut && !inside(subject[axis], view, axis)) cut = axis === 'x' ? 'off the window' : 'below or above the window';
    if (cut) out.push(cut + ': ' + label(node));
  }
  for (const node of document.querySelectorAll('.scroll, .toolbar, .band, #header, .market-chips')) if (node.scrollWidth > node.clientWidth + 1) out.push('scrolls sideways: ' + (node.id || node.className));
  for (const bar of document.querySelectorAll('.fit-bar[data-overflows]')) out.push('too wide even when fitted: ' + bar.className);
  return out;
})()`;

/**
 * On Plugins, each place a click's result is said in words (a row's or a plugin page's note, pluginparts.ts clickNote; the
 * toolbar's line, pluginspage.ts toolbarRight) that shows less than its words: shortened, or reaching past the box it is in.
 * Empty when every one shows whole. CUT_OFF looks at controls only.
 */
const WORDS_CUT = `[...document.querySelectorAll('.plugin-click, .toolbar-result-text')].flatMap(node => {
  const words = node.matches('.plugin-click') ? node.lastElementChild : node, own = node.getBoundingClientRect(), box = node.parentElement.getBoundingClientRect();
  return own.width && (words.scrollWidth > words.clientWidth + 1 || own.right > box.right + 1) ? [node.textContent.slice(0, 60)] : [];
})`;

/**
 * On Plugin marketplaces, each piece of a plugin's row that doesn't show whole: a piece of its open button (the title, the
 * version, a chip) hidden (no box, or hidden by its visibility or opacity), reaching past the button, with words outside its
 * row's name cell at any edge, or shortened; a version or chip broken over two lines though it fits its open button whole
 * (only a piece wider than the button may break inside itself); the button reaching past its row's name cell; and each tool's
 * heading wider than its column. Empty when every row's name, version and chips show whole (style.css "The plugin table").
 * CUT_OFF looks at the button and the heading's cell, not what is in them.
 */
const ROW_PIECES_CUT = `(() => {
  const within = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
  const words = node => { const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()]; };
  const lines = node => new Set(words(node).map(rect => Math.round(rect.top))).size;
  // A piece's width on one line: its wrapping is off for the moment it is measured.
  const wholeWidth = node => { node.style.whiteSpace = 'nowrap'; const width = node.scrollWidth; node.style.whiteSpace = ''; return width; };
  const shown = node => node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const out = [...document.querySelectorAll('.plugin-table .ov-tool-head')].filter(head => head.scrollWidth > head.clientWidth + 1).map(head => head.textContent + '’s heading is wider than its column');
  for (const row of document.querySelectorAll('.plugin-table .plugin-row')) {
    const name = row.querySelector('.plugin-row-name'), open = name.querySelector('.plugin-row-open');
    const cell = name.getBoundingClientRect(), button = open.getBoundingClientRect();
    if (!within(button, cell)) out.push(row.dataset.plugin + ': its open button reaches past its name cell');
    for (const piece of open.children) {
      const box = piece.getBoundingClientRect(), says = row.dataset.plugin + ': ' + piece.textContent;
      if (box.width < 1 || box.height < 1 || !shown(piece)) out.push(says + ' is hidden');
      else if (!within(box, button)) out.push(says + ' reaches past its open button');
      else if (!words(piece).every(rect => within(rect, cell))) out.push(says + ' has words outside its name cell');
      else if (piece.scrollWidth > piece.clientWidth + 1) out.push(says + ' is shortened');
      else if (!piece.matches('.plugin-row-title') && lines(piece) > 1 && wholeWidth(piece) <= button.width + 1) out.push(says + ' is broken over two lines, though it fits its open button whole');
    }
  }
  return out;
})()`;

/** Sizes the page to width × height, and lets the app hear the resize. A real window that size leaves its page shorter (SMALLEST). */
async function sizeTo(a, width, height) {
  await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await a.run(`window.dispatchEvent(new Event('resize'))`);
  await a.settle();
}
async function fullSize(a) {
  await a.send('Emulation.clearDeviceMetricsOverride');
  await a.run(`window.dispatchEvent(new Event('resize'))`);
  await a.settle();
}

/**
 * One mouse event at the point `at`, as a real mouse sends it: `buttons` 1 while the left button is held, and no button named on a
 * move without it. `modifiers` as the protocol counts them (8: Shift held).
 */
const mouse = (a, type, at, buttons, modifiers = 0) => a.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, modifiers, clickCount: 1 });
/**
 * A pointer click on the shown text `selector`, at the start of `words` in it, as a mouse makes it: with its point, which a
 * click on an instruction text uses to place the editor's caret. The line is scrolled into view first. `whileHeld` runs between
 * the press and the release (as redrawUnder).
 */
async function clickText(a, selector, words, whileHeld) {
  const point = await pointAt(a, selector, words);
  await mouse(a, 'mouseMoved', point, 0);
  await mouse(a, 'mousePressed', point, 1);
  await whileHeld?.();
  await mouse(a, 'mouseReleased', point, 0);
  await a.settle();
}
/** Where the start of `words` is in the shown text `selector`, as a point in the window, its line scrolled into view first. */
function pointAt(a, selector, words) {
  return a.run(`(() => {
    const pre = document.querySelector(${JSON.stringify(selector)}), node = pre.firstChild, at = node.textContent.indexOf(${JSON.stringify(words)});
    const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
    const page = pre.closest('.scroll'), view = page.getBoundingClientRect(), line = range.getBoundingClientRect();
    if (line.top < view.top || line.bottom > view.bottom) page.scrollTop += line.top - view.top - view.height / 2;
    const box = range.getBoundingClientRect();
    return { x: box.left + 1, y: box.top + box.height / 2 };
  })()`);
}
/**
 * A redraw of the whole page that changes nothing (the sidebar's toggle clicked twice), landing in the middle of a gesture as a
 * background pass or a usage reading may. Returns [whether the text `selector` was replaced by it, whether the one now there
 * opens its editor on a click].
 */
async function redrawUnder(a, selector) {
  await a.run(`document.querySelector(${JSON.stringify(selector)}).dataset.before = 'the redraw'`);
  await a.run(`(() => { for (let times = 0; times < 2; times++) document.querySelector('#sidebar-toggle').click(); })()`);
  return a.run(`(() => { const now = document.querySelector(${JSON.stringify(selector)}); return [now.dataset.before !== 'the redraw', now.matches('.ins-editable')]; })()`);
}
/** The open editor's id and where its caret is, as [id, the caret's offset]. */
const caretAt = a => a.run(`[document.activeElement?.id, document.activeElement?.selectionStart]`);
/**
 * Whether the line the focused editor's caret is on shows whole, inside both the editor's box and the page's scroll area. Where
 * the line sits is measured on a copy of the text up to the caret laid out at the box's width, so wrapped lines count.
 */
const caretLineShows = a => a.run(`(() => {
  const area = document.activeElement, style = getComputedStyle(area), page = area.closest('.scroll').getBoundingClientRect(), box = area.getBoundingClientRect();
  const copy = document.createElement('div');
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'overflowWrap', 'wordBreak', 'tabSize', 'fontVariantLigatures', 'fontFeatureSettings', 'paddingLeft', 'paddingRight', 'paddingTop']) copy.style[key] = style[key];
  Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', boxSizing: 'border-box', width: area.clientWidth + 'px', whiteSpace: 'pre-wrap' });
  copy.textContent = area.value.slice(0, area.selectionStart) + '.';
  document.body.append(copy);
  const line = parseFloat(style.lineHeight), top = box.top + area.clientTop + copy.offsetHeight - line - area.scrollTop;
  copy.remove();
  return top >= Math.max(page.top, box.top) - 1 && top + line <= Math.min(page.bottom, box.bottom) + 1;
})()`);

/**
 * The page in the app's smallest window (main.ts minWidth, minHeight: 860×560), as [width, height]: the Mac's title bar, 32 pt
 * in a real window on macOS 26, comes off its height. Every check at the smallest size sizes the page to this.
 */
const SMALLEST = [860, 560 - 32];

/**
 * Each row of the sidebar (a page, a home, the update control) that shows less than its full height: under the edge of a list
 * that scrolls, or of the window. CUT_OFF accepts a row a scroll can bring into view; here none may wait for one. Empty when
 * every row shows whole.
 */
const SIDEBAR_CUT = `[...document.querySelectorAll('#sidebar button')].flatMap(row => {
  const own = row.getBoundingClientRect();
  let top = Math.max(own.top, 0), bottom = Math.min(own.bottom, innerHeight);
  for (let up = row.parentElement; up; up = up.parentElement) {
    if (getComputedStyle(up).overflowY === 'visible') continue;
    const edge = up.getBoundingClientRect();
    top = Math.max(top, edge.top); bottom = Math.min(bottom, edge.bottom);
  }
  return bottom - top < own.height - 1 ? [Math.max(0, Math.round(bottom - top)) + ' of ' + Math.round(own.height) + 'px shows: ' + row.getAttribute('aria-label')] : [];
})`;

/**
 * In the smallest window, first with the sidebar folded to its rail and then open, nothing on this page is cut off, and every
 * row of the sidebar shows whole. `again` puts back what the sidebar toggle's click closes, such as an open menu.
 */
async function fitsAtMinimum(a, where, again = async () => {}) {
  await sizeTo(a, ...SMALLEST); await again();
  same(`nothing cut off at 860×560 with the rail: ${where}`, [...await a.run(CUT_OFF), ...await a.run(SIDEBAR_CUT)], []);
  await a.click('#sidebar-toggle'); await again();
  same(`nothing cut off at 860×560 with the sidebar open: ${where}`, [...await a.run(CUT_OFF), ...await a.run(SIDEBAR_CUT)], []);
  await a.click('#sidebar-toggle');
  await fullSize(a);
}

/**
 * What is wrong with the open copy question's layout (style.css "The copy question"); empty when it is as `shape` says:
 * 'under' (the list under the question), 'beside' (a wide question: the list beside it, the first row's name level with the
 * question) or 'pane' (a narrow question, as in the Files view's pane: each row's name and Use this copy on one line, what it
 * says under both). In every shape:
 *  - the list reaches the right edge of the question's box, less the close button's room when it is beside the question, so
 *    it grows with the window; an agent's copies in full, when open, sit under the list, as wide as it, all beside each
 *    other or all one under the other, each copy's box running to the copy beside it or to the list's edge;
 *  - every row starts what it says where the first row does (a row that can't be chosen too), and Use this copy ends at one edge;
 *  - the close button is over neither the question nor the list, and no row's words spill out.
 * With no copy question open it says so.
 */
const copyQuestionMisfits = shape => `(() => {
  const details = document.querySelector('.details-differs');
  if (!details?.querySelector('.version')) return ['no copy question is open'];
  const out = [], all = selector => [...details.querySelectorAll(selector)], box = node => node.getBoundingClientRect(), near = (one, other) => Math.abs(one - other) <= 1;
  const question = box(all('.compare-title > span')[0]), note = box(all('.compare-note')[0]), list = box(all('.compare-choices')[0]), close = all('.details-close').map(box)[0];
  // The shape is read from the first row that can be chosen; the first row of all is the one level with the question.
  const row = all('.version').find(each => each.querySelector('.version-cta')), who = box(row.querySelector('.version-who')), says = box(row.querySelector('.version-says')), use = box(row.querySelector('.version-cta'));
  const found = list.top < note.bottom ? 'beside' : says.top >= who.bottom ? 'pane' : 'under';
  if (found !== ${JSON.stringify(shape)}) out.push('laid out as ' + found);
  const top = box(all('.version-who')[0]).top;
  if (found === 'beside' && !near(top, question.top)) out.push('the first row’s name is ' + Math.round(top - question.top) + 'px off the question’s line');
  if (found === 'pane' && !(use.top < says.top && use.left >= who.right)) out.push('Use this copy is not on the name’s line');
  const style = getComputedStyle(details), edge = box(details).right - parseFloat(style.paddingRight) - (found === 'beside' ? parseFloat(style.getPropertyValue('--close-room')) : 0);
  if (!near(list.right, edge)) out.push('the list ends ' + Math.round(edge - list.right) + 'px short of its box');
  for (const each of all('.version')) {
    if (!near(box(each.querySelector('.version-says')).left, says.left)) out.push(each.id + ' starts what it says ' + Math.round(box(each.querySelector('.version-says')).left - says.left) + 'px from where the others do');
    if (each.querySelector('.version-cta') && !near(box(each.querySelector('.version-cta')).right, use.right)) out.push(each.id + ' ends Use this copy at another edge');
    if (each.scrollWidth > each.clientWidth + 1) out.push('words spill out of ' + each.id);
  }
  const copies = all('.compare-copies')[0], blocks = all('.compare-copies > .content-block').map(box);
  if (copies && !(near(box(copies).left, list.left) && near(box(copies).right, list.right) && box(copies).top >= list.bottom)) out.push('the copies in full are not under the list, as wide as it');
  if (!blocks.every(block => near(block.top, blocks[0].top)) && !blocks.every(block => near(block.left, blocks[0].left))) out.push('the copies in full sit some beside each other and some under');
  // A copy's bordered box (.content) fills its share of the line (.content-block), and the last share on a line ends where the list does.
  blocks.forEach((block, index) => {
    const endsLine = !blocks.some(other => other.top < block.bottom && other.bottom > block.top && other.left >= block.right);
    const short = (endsLine ? list.right : block.right) - box(all('.compare-copies .content')[index]).right;
    if (!near(short, 0)) out.push('a copy in full stops ' + Math.round(short) + 'px short of ' + (endsLine ? 'the list’s edge' : 'the copy beside it'));
  });
  const meets = (one, other) => one.left < other.right && one.right > other.left && one.top < other.bottom && one.bottom > other.top;
  if (close && (meets(question, close) || meets(list, close))) out.push('the close button is over the question or the list');
  return out;
})()`;

/**
 * The open copy question's rows as the page words them (matrix.ts compareChoices, copywords.ts), one per row: its quote, the
 * words tinted in it (those only this copy has), the line under its name, and what choosing it does or why it can't be chosen.
 * `timed` false leaves the line under the name out, where it goes by when the files happened to be written.
 */
const copyQuestionWords = async (a, timed = true) => (await a.run(`[...document.querySelectorAll('.details-differs .version')].map(row => {
  const said = part => row.querySelector(part)?.textContent ?? '';
  return { quote: said('.version-text'), tinted: [...row.querySelectorAll('.change-added')].map(mark => mark.textContent), under: said('.version-meta'), does: said('.version-effect') };
})`)).map(({ under, ...row }) => (timed ? { ...row, under } : row));

/** In the Files view's two columns: how far the file's column runs past the file's own box, as a misfit; empty when it ends with it. */
const FILE_COLUMN_BLANK = `(() => {
  const column = document.querySelector('.detail-files').getBoundingClientRect(), file = document.querySelector('.detail-files .content').getBoundingClientRect();
  return column.right - file.right > 1 ? ['the file’s column runs ' + Math.round(column.right - file.right) + 'px past the file’s box'] : [];
})()`;

/**
 * The opened row `key` and its details under it as the page draws them (style.css .ov-row.open), each colour named by the
 * page's own token (picked, accent, warning, line). With the pointer on the row: where the pointer is, the row's background
 * and box shadows, then the details'. Then, the pointer off the page and the keyboard's focus on the row's first control:
 * where the focus is, and the row's look again. The focus is let go after.
 */
async function openedRowLook(a, kind, key) {
  const row = `.ov-row.open[data-key="${rowPart('', kind, key)}"]`;
  /** Reads `what` on the page, where `row` is the row and `drawn(element)` its look in token names. */
  const read = what => a.run(`(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const tokens = ['picked', 'accent', 'warning', 'line'].map(name => { probe.style.color = 'var(--' + name + ')'; return [getComputedStyle(probe).color, name]; });
    probe.remove();
    const drawn = element => tokens.reduce((said, [colour, name]) => said.split(colour).join(name), getComputedStyle(element).backgroundColor + ', ' + getComputedStyle(element).boxShadow);
    const row = document.querySelector('${row}');
    return ${what};
  })()`);
  const [x, y] = await a.run(`(() => { const box = document.querySelector('${row}').getBoundingClientRect(); return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)]; })()`);
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const underPointer = await read(`[row.matches(':hover') ? 'pointer on the row' : 'pointer elsewhere', drawn(row), drawn(row.nextElementSibling)]`);
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await a.run(`document.querySelector('${row} button').focus({ focusVisible: true })`);
  const withFocus = await read(`[row.matches(':has(:focus-visible)') ? 'keyboard focus in the row' : 'no keyboard focus in the row', drawn(row)]`);
  await a.run(`document.activeElement?.blur()`);
  return [...underPointer, ...withFocus];
}

/**
 * The copy question of the skill `key`, open under its row: what its rows say (`words`), its shape at each window size, then in
 * the Files view's pane (where Read both copies leads), with nothing cut off. The pane is narrow at 1728×1117; at 2560×1440 the
 * file's column stops at the file's box and the question takes the rest. It ends back on the table at full size, the question
 * still open.
 */
async function copyQuestionFits(a, kind, key, words) {
  same('each row quotes its copy’s first line, in quotation marks, and says what choosing it does', await copyQuestionWords(a, false), words);
  for (const [width, height, shape] of [[...SMALLEST, 'under'], [1280, 800, 'under'], [1728, 1117, 'beside'], [2560, 1440, 'beside']]) {
    await sizeTo(a, width, height);
    same(`at ${width}×${height} the copy question’s list is ${shape} the question, as wide as its box, clear of the close button, nothing cut off`, [...await a.run(copyQuestionMisfits(shape)), ...await a.run(CUT_OFF)], []);
  }
  await a.click(`#${rowPart('diff', kind, key)}`);
  await sizeTo(a, 1728, 1117);
  same('in the Files view’s pane, beside the file, each row has its name and Use this copy on one line and what it says under both', [...await a.run(copyQuestionMisfits('pane')), ...await a.run(CUT_OFF)], []);
  await sizeTo(a, 2560, 1440);
  same('at 2560×1440 the file’s column ends with the file’s box, and the question beside it has the rest: its list under the question', [...await a.run(FILE_COLUMN_BLANK), ...await a.run(copyQuestionMisfits('under')), ...await a.run(CUT_OFF)], []);
  await a.click('#skills-table');
  await fullSize(a);
}

/**
 * Pi holds no agents of its own: with a Pi folder, an agent that is On lands in Pi as a skill, `.pi/agent/skills/<name>.md`;
 * its row has a Pi mark and line, the opened row says once what Pi gets, and Pi's About names where its agents are. The Pi
 * folder is the check's own: it is taken out again.
 */
async function agentInPi(a, practice) {
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.click('#header-refresh');
  const piFile = join(practice, '.pi/agent/skills/code-reviewer.md');
  for (let tries = 0; tries < 30 && !existsSync(piFile); tries++) await wait(100);
  check('an agent that is On lands in Pi as a skill, .pi/agent/skills/<name>.md, its name and description in front matter', existsSync(piFile) && /^---\nname: code-reviewer\ndescription: Reviews a change/.test(readFileSync(piFile, 'utf8')), existsSync(piFile) ? readFileSync(piFile, 'utf8').slice(0, 200) : 'no file');
  for (let tries = 0; tries < 30 && await cellState(a, 'agents', 'code-reviewer', 'pi-cli') !== 'current'; tries++) await wait(100);
  await a.click(`#${rowPart('open', 'agents', 'code-reviewer')}`);
  same('its row has a Pi mark and a Pi line with its switch', [await cellState(a, 'agents', 'code-reviewer', 'pi-cli'), await a.exists(`#${rowPart('enable', 'agents', 'code-reviewer', 'pi-cli')}`)], ['current', true]);
  const note = (await a.text(`#${rowPart('as-skill', 'agents', 'code-reviewer')}`) ?? '').trim();
  check('the opened row says once what Pi gets, and that deleting its file there turns the agent off everywhere',
    /^Pi holds no agents of its own, so there an agent is a skill[\s\S]*no isolated context of its own, tool restrictions and model selection[\s\S]*Deleting that file in Pi turns the agent off in every tool/.test(note), note);
  await a.click(`#${rowPart('open', 'agents', 'code-reviewer')}`);
  await a.click('#nav-harnesses'); await a.click('#harness-pi-cli'); await a.click('#harness-tab-about');
  check('Pi’s About says its agents are in its skills folder, each as a skill', /Agents\s*In its skills folder, each as a skill/.test(await a.text('#harness-body') ?? ''), await a.text('#harness-body'));
  await a.click('#nav-skills');
  await piCaughtUp(a);
  await a.click('#nav-agents');
  rmSync(join(practice, '.pi'), { recursive: true, force: true });
  await a.click('#header-refresh');
}

/**
 * Before a check removes the Pi folder it made: waits, on the Skills page, until every skill whose Codex copy is current has a
 * current copy in Pi. The app brings a tool that joins up to date in a pass of its own, and the page shows Pi's copies current
 * only once that pass has ended and been read; a Pi folder removed before then is made again by that pass's later writes.
 * After 10 s it goes on, and says so.
 */
async function piCaughtUp(a) {
  const behind = () => a.run(`[...document.querySelectorAll('.ov-row[data-key]')].map(row => ['codex-cli', 'pi-cli'].map(tool => row.querySelector('.tool-mark[data-tool="' + tool + '"]')?.dataset.state))
    .filter(([codex, pi]) => codex === 'current' && pi !== 'current').length`);
  for (let tries = 0; tries < 100 && await behind(); tries++) await wait(100);
  const left = await behind();
  if (left) console.log(`(Pi had not caught up after 10 s: ${left} skills current in Codex were not current in Pi; its folder is removed now)`);
}

/**
 * An agent's copy question, three copies of one long line: Claude Code's stops where Copilot CLI's and Codex's each add a
 * sentence of their own, and each was edited on a day of its own.
 *  - Its rows' words: every row quotes the same stretch of the line (so the copy that stops sooner is seen to), a copy's own
 *    words are tinted as one piece, the line under each name gives its size and when it was edited, the latest marked.
 *  - With Read every copy open, the three prompts in full sit under the list, as wide as it, one under the other until all
 *    three fit beside each other (at 2560×1440), never two beside and one under.
 * The agent is the check's own: it is taken out again.
 */
async function agentCopiesUnderTheList(a, practice) {
  const line = 'List what changed for the person using the app, newest first, leaving out refactors and test-only changes unless they change what someone sees. One line each.';
  const prompt = own => `Keep the changelog short.\n${line}${own}\n`;
  const markdown = own => `---\nname: changelog\ndescription: Keeps the changelog.\n---\n\n${prompt(own)}`;
  const files = [
    ['.claude/agents/changelog.md', markdown(''), 9],
    ['.copilot/agents/changelog.agent.md', markdown(' Say who asked.'), 5],
    ['.codex/agents/changelog.toml', `name = "changelog"\ndescription = "Keeps the changelog."\ndeveloper_instructions = """\n${prompt(' Link the pull request.')}"""\n`, 2],
  ];
  for (const [file, content, daysAgo] of files) {
    mkdirSync(join(practice, file, '..'), { recursive: true }); writeFileSync(join(practice, file), content);
    const edited = new Date(Date.now() - daysAgo * 86_400_000); utimesSync(join(practice, file), edited, edited);
  }
  await a.click('#header-refresh');
  await a.click(`#${rowPart('add', 'agents', 'changelog')}`);
  same('an agent’s rows quote one stretch of a long line, each copy’s own words tinted, with when it was edited under its name (all are 3 lines, so no size)', await copyQuestionWords(a), [
    { quote: '“…change what someone sees. One line each.”', tinted: [], does: 'Replaces Copilot CLI’s copy and Codex’s copy.', under: 'edited 9 days ago' },
    { quote: '“…change what someone sees. One line each. Say who asked.”', tinted: ['Say who asked.'], does: 'Replaces Claude Code’s copy and Codex’s copy.', under: 'edited 5 days ago' },
    { quote: '“…change what someone sees. One line each. Link the pull request.”', tinted: ['Link the pull request.'], does: 'Replaces Claude Code’s copy and Copilot CLI’s copy.', under: 'edited 2 days ago · Newest' },
  ]);
  await a.click(`#${rowPart('diff', 'agents', 'changelog')}`);
  check('Read every copy opens each of the three prompts in full', (await a.all('.compare-copies .content', 'e.textContent')).length === 3, await a.text('.details-differs'));
  for (const [width, height, shape, copies] of [[1280, 800, 'under', 'one under the other'], [1728, 1117, 'beside', 'one under the other'], [2560, 1440, 'beside', 'beside each other']]) {
    await sizeTo(a, width, height);
    same(`at ${width}×${height} an agent’s three copies in full are under the list and as wide as it, ${copies}, the list ${shape} the question`,
      [...await a.run(copyQuestionMisfits(shape)), ...await a.run(CUT_OFF), await a.run(`new Set([...document.querySelectorAll('.compare-copies .content')].map(e => Math.round(e.getBoundingClientRect().top))).size`)], [copies === 'beside each other' ? 1 : 3]);
  }
  await fullSize(a);
  await a.click(`#${rowPart('close', 'agents', 'changelog')}`);
  for (const [file] of files) rmSync(join(practice, file), { force: true });
  await a.click('#header-refresh');
  check('the check’s own agent is gone again', !(await rowKeys(a, 'agents')).includes('changelog'), await rowKeys(a, 'agents'));
}

/**
 * A copy that can't be chosen, in a question of three rows: Claude Code's copy of `loose` has no frontmatter, which Copilot CLI
 * will not load. Its row stays in the list, in the others' columns, disabled, with why in place of its quote and no Use this
 * copy. Codex's copy has a first line too long for a row: it is cut after a whole word, with "…" inside the quotation marks.
 * The skill is the check's own: it is taken out again, so the practice home is as it was.
 */
async function blockedCopyKeepsItsRow(a, practice) {
  const folders = { '.claude/skills': 'No frontmatter here.\n', '.copilot/skills': text('loose', 'Copilot CLI’s loose notes.'),
    '.codex/skills': text('loose', 'Codex’s loose notes run on well past what a row has room to quote: every open question, each decision and who made it, and what is still to do before the next release.') };
  for (const [root, content] of Object.entries(folders)) { mkdirSync(join(practice, root, 'loose'), { recursive: true }); writeFileSync(join(practice, root, 'loose/SKILL.md'), content); }
  await a.click('#header-refresh');
  await a.click(`#${rowPart('add', 'skills', 'loose')}`);
  same('a copy another tool will not load keeps its row, disabled, with no Use this copy; the other two have theirs',
    await a.run(`[...document.querySelectorAll('.details-differs .version')].map(row => [row.id, row.disabled, !!row.querySelector('.version-cta')])`),
    [[rowPart('use', 'skills', 'loose', 'claude-cli'), true, false], [rowPart('use', 'skills', 'loose', 'copilot-cli'), false, true], [rowPart('use', 'skills', 'loose', 'codex-cli'), false, true]]);
  same('its row says why it can’t be used, once; a first line too long for its row is cut after a word and says so', await copyQuestionWords(a, false), [
    { quote: '', tinted: [], does: 'Can’t be used: Copilot CLI will not load a skill with no YAML frontmatter.' },
    { quote: '“Copilot CLI’s loose notes.”', tinted: [], does: 'Replaces Claude Code’s copy and Codex’s copy.' },
    { quote: '“Codex’s loose notes run on well past what a row has room to quote: every open question, each decision and who made it, and what is still to…”', tinted: [], does: 'Replaces Claude Code’s copy and Copilot CLI’s copy.' },
  ]);
  for (const [width, height, shape] of [[...SMALLEST, 'under'], [1728, 1117, 'beside']]) {
    await sizeTo(a, width, height);
    same(`at ${width}×${height} the three rows, one of them not to be chosen, share their columns, ${shape} the question`, [...await a.run(copyQuestionMisfits(shape)), ...await a.run(CUT_OFF)], []);
  }
  await fullSize(a);
  await a.click(`#${rowPart('close', 'skills', 'loose')}`);
  for (const root of Object.keys(folders)) rmSync(join(practice, root, 'loose'), { recursive: true, force: true });
  await a.click('#header-refresh');
  check('the check’s own skill is gone again', !(await rowKeys(a, 'skills')).includes('loose'), await rowKeys(a, 'skills'));
}

async function practiceFlow() {
  // A development run also opens the main process's debugger, for the menu bar menu and a failed Refresh.
  const a = await launch(undefined, ['--practice-copy']);
  const main = a.inspect ? await mainHelpers(a.inspect) : undefined;
  same('opens on the practice copy', await a.text('#home-label'), 'Practice copy');
  await wait(1500);
  same('one window at launch (macOS activate never makes a second)', await a.pages(), 1);
  check('the Overview sums up every kind', (await a.exists('#overview-skills')) && (await a.exists('#overview-mcp')) && (await a.exists('#overview-agents')), await a.text('#page'));
  check('the practice copy explains itself', (await a.text('.intro') ?? '').includes('practice copy'), await a.text('#page'));
  await a.click('#nav-overview');
  await a.click('#overview-skills');
  // Skills are on the library: Central Knot holds each skill itself, its whole folder, with its versions; a tool is where a
  // skill is applied. A skill a tool has that Central Knot doesn't yet is found: its row has Add, not a switch, which takes it in.
  same('rows', (await rowKeys(a, 'skills')).sort(), ['notes', 'release-notes', 'review', 'standup']);
  same('nothing is on at first', await Promise.all(['notes', 'release-notes', 'review', 'standup'].map(key => switchOn(a, 'skills', key))), [false, false, false, false]);
  same('every skill is found: under Found, with Add where a switch would be, saying what a click does', [await sectionsNow(a, 'skills'), await a.all('.ov-row[data-key] .add-item', 'e.textContent'), await a.exists('.ov-row[data-key] .switch'), await a.run(`document.querySelector('#${rowPart('add', 'skills', 'notes')}').title`)],
    [[['found', ['notes', 'release-notes', 'review', 'standup']]], ['Add', 'Add', 'Add', 'Add'], false, 'Add notes to Central Knot and put it in every tool']);
  same('a found row’s name starts where an On row’s does: Add is as wide as the switch', await a.run(`document.querySelector('#${rowPart('add', 'skills', 'notes')}').getBoundingClientRect().width`), 32);
  same('no column heads, and no filter chips while All would be alone with Copies differ', [await a.exists('.ov-head'), await a.all('.chip', 'e.dataset.tip')], [false, ['All', 'Copies differ']]);
  same('marks say what each tool has', [await cellState(a, 'skills', 'release-notes', 'claude-cli'), await cellState(a, 'skills', 'release-notes', 'copilot-cli'), await cellState(a, 'skills', 'review', 'copilot-cli')], ['own-copy', 'none', 'own-copy']);
  same('a found row’s only controls are its Add and its chevron: marks and Copies differ are only said', await a.all(`.ov-row[data-key="${rowPart('', 'skills', 'review')}"] button`, 'e.id'), [rowPart('add', 'skills', 'review'), rowPart('open', 'skills', 'review')]);
  check('copies differ is flagged', await a.exists(`#${rowPart('decide', 'skills', 'review')}`));
  await a.shot('practice-overview');
  const practice = await a.run(`document.querySelector('.status-home').title`);
  check('practice home is not the disposable real home', practice !== HOME && existsSync(practice), practice);
  const reviewClaude = readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8');
  const reviewCopilot = readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8');
  /** Opens a row's details (`open` false: closes them), whichever way they are now. */
  const opened = async (key, open = true) => { if ((await a.run(`document.querySelector('#${rowPart('open', 'skills', key)}')?.getAttribute('aria-expanded')`) === 'true') !== open) await a.click(`#${rowPart('open', 'skills', key)}`); };
  /** A skill's folder in each of the three tools, byte for byte (null where there is none). */
  const folders = key => ['claude', 'copilot', 'codex'].map(tool => join(practice, `.${tool}/skills/${key}`)).map(dir => (existsSync(dir) ? tree(dir) : null));

  // The sweep itself: a button in a scroll area that an outer clipping box hides must be reported, not passed as scrollable.
  const fixture = await a.run(`(() => {
    const outer = document.createElement('div'), inner = document.createElement('div'), tall = document.createElement('div'), button = document.createElement('button');
    for (const [node, props] of [[outer, { position: 'fixed', left: '0', top: '0', width: '200px', height: '40px', overflow: 'hidden' }], [inner, { marginTop: '60px', height: '120px', overflow: 'auto' }], [tall, { height: '400px' }]]) Object.assign(node.style, props);
    button.id = 'clip-fixture-button'; button.textContent = 'Hidden';
    tall.append(button); inner.append(tall); outer.append(inner); document.body.append(outer);
    const found = ${CUT_OFF};
    outer.remove();
    return found;
  })()`);
  check('the cut-off sweep reports a scroll area its outer box clips', fixture.some(line => line.endsWith('clip-fixture-button')), fixture);
  await fitsAtMinimum(a, 'Skills');

  // One switch: a found skill's takes it into Central Knot and writes its folder to every tool at once. The pointer is over
  // the list, as it is for a real click; the row stays where it was, under Found, until the list is drawn afresh (Refresh, below).
  const pointerOver = async selector => {
    const at = await a.run(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return box ? [box.left + box.width / 2, box.top + box.height / 2] : null; })()`);
    if (at) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] });
  };
  await pointerOver(`.ov-row[data-key="${rowPart('', 'skills', 'notes')}"]`);
  // The strip's Undo of taking it in leaves every folder as it was before the click: the copies it made go, the tools it was
  // found in keep theirs, and notes is found again. Then it is taken in again for the checks below.
  const notesFound = folders('notes');
  await a.click(`#${rowPart('add', 'skills', 'notes')}`);
  await a.click('#outcome-undo');
  same('Undo of taking a found skill in leaves every folder as before, and it is found again, the focus on its Add as Undo goes', [folders('notes'), await a.exists(`#${rowPart('add', 'skills', 'notes')}`), /^Undone: notes is as before\./.test(await a.text('.band-done') ?? ''), await a.run(`document.activeElement?.id`)], [notesFound, true, true, rowPart('add', 'skills', 'notes')]);
  // Add, then Off on the same row soon after: one run. The header says notes is off, as the run left it, and the run's one Undo
  // takes both back: notes is found again, every folder as before.
  await a.clickInRun(`#${rowPart('add', 'skills', 'notes')}`);
  await a.clickInRun(`#${rowPart('switch', 'skills', 'notes')}`);
  const mixedSaid = await a.text('#header [data-outcome] .band-text');
  await a.click('#outcome-undo');
  same('Add then Off in one run: the header says notes is off, and the run’s Undo leaves notes found, every folder as before',
    [mixedSaid, await a.exists(`#${rowPart('add', 'skills', 'notes')}`), folders('notes'), /^Undone: notes is as before\./.test(await a.text('#header [data-outcome] .band-text') ?? '')], ['1 skill is off: notes.', true, notesFound, true]);
  await pointerOver(`.ov-row[data-key="${rowPart('', 'skills', 'notes')}"]`);
  await a.click(`#${rowPart('add', 'skills', 'notes')}`);
  same('adding a found skill takes it in and writes it to every tool at once, byte for byte', [await switchOn(a, 'skills', 'notes'), folders('notes')[2], folders('notes')[1]], [true, folders('notes')[0], folders('notes')[0]]);
  const statusBarShows = () => a.run(`(() => { const region = document.querySelector('#announcement'); return region.classList.contains('visually-hidden') ? '' : region.dataset.text; })()`);
  check('the result says where it is now, in the strip at the top only', (await a.text('.band-done') ?? '').includes('notes is in Central Knot now, and on in all 3 tools.') && !(await statusBarShows()), [await a.text('.bands'), await statusBarShows()]);
  same('and its row stays where it was, under Found, its switch On, the pointer over the list too: the heading counts the skills still found, and says nothing over a row now On',
    [await sectionsNow(a, 'skills'), await switchOn(a, 'skills', 'notes'), await a.text('.ov-section[data-section="found"] .ov-section-count'), await a.exists('.ov-section[data-section="found"] .ov-section-after:not(.ov-section-room)')], [[['found', ['notes', 'release-notes', 'review', 'standup']]], true, '3', false]);
  await pointerOver('.toolbar');
  // Off takes the folder out of every tool; Central Knot keeps it. Its Undo (On) puts every folder back, byte for byte.
  const notesOn = folders('notes');
  await a.click(`#${rowPart('switch', 'skills', 'notes')}`);
  same('Off takes its folder out of every tool; its row stays, off, in Central Knot only', [folders('notes'), await a.run(`document.querySelector('#${rowPart('switch', 'skills', 'notes')}').getAttribute('aria-checked')`), /in Central Knot only/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'notes')}"]`) ?? '')], [[null, null, null], 'false', true]);
  check('the result says Central Knot keeps it, with Undo', /notes is off: no tool has it\. Central Knot keeps it/.test(await a.text('.band-done') ?? '') && await a.exists('#outcome-undo'), await a.text('.bands'));
  await a.click('#outcome-undo');
  same('Undo puts each folder back, byte for byte', [folders('notes'), await switchOn(a, 'skills', 'notes')], [notesOn, true]);
  check('and says so in the same strip, which goes after a few seconds', /^Undone: notes is as before\./.test(await a.text('.band-done') ?? '') && !(await statusBarShows()), [await a.text('.bands'), await statusBarShows()]);
  for (let tries = 0; tries < 80 && await a.exists('.band-done'); tries++) await wait(100);
  check('…and leaves nothing behind in the status bar', !(await a.exists('.band-done')) && !(await statusBarShows()), [await a.text('.bands'), await statusBarShows()]);
  // A skill already the same in every tool is taken in with nothing written. Delete from Central Knot takes it out of every
  // tool and off the page.
  const sameDirs = ['.claude/skills', '.copilot/skills', '.codex/skills'].map(root => join(practice, root, 'same-everywhere'));
  for (const dir of sameDirs) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'SKILL.md'), text('same-everywhere', 'The same in every tool.')); }
  await a.click('#header-refresh');
  const sameStats = () => sameDirs.map(dir => (existsSync(join(dir, 'SKILL.md')) ? statSync(join(dir, 'SKILL.md')).ino : null));
  const sameBefore = sameStats();
  await a.click(`#${rowPart('add', 'skills', 'same-everywhere')}`);
  same('a skill already the same everywhere is taken in with nothing written', [await switchOn(a, 'skills', 'same-everywhere'), sameStats()], [true, sameBefore]);
  await opened('same-everywhere');
  await a.click(`#${rowPart('delete', 'skills', 'same-everywhere')}`);
  await a.click(`#${rowPart('delete-confirm', 'skills', 'same-everywhere')}`);
  same('Delete from Central Knot takes it out of every tool and off the page', [sameStats(), (await rowKeys(a, 'skills')).includes('same-everywhere')], [[null, null, null], false]);
  // Two Adds, the second soon after the first: one run, said once.
  for (const key of ['release-notes', 'standup']) await a.clickInRun(`#${rowPart('add', 'skills', key)}`);
  same('two Adds in a row are one run, said once', await a.text('#header [data-outcome] .band-text'), '2 skills are on: release-notes and standup.');
  await a.click('#header-refresh');
  same('Refresh regroups the rows: the three are On', (await sectionsNow(a, 'skills'))[0], ['on', ['notes', 'release-notes', 'standup']]);
  same('copies written every way', [existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), existsSync(join(practice, '.claude/skills/standup/SKILL.md')), existsSync(join(practice, '.codex/skills/standup/SKILL.md'))], [true, true, true]);
  same('copy bytes match', tree(join(practice, '.copilot/skills/release-notes')), tree(join(practice, '.claude/skills/release-notes')));
  check('Codex’s own .system skills stay untouched and unlisted', existsSync(join(practice, '.codex/skills/.system/openai-docs/SKILL.md')) && !(await rowKeys(a, 'skills')).includes('openai-docs'));

  await blockedCopyKeepsItsRow(a, practice);
  // Copies differ: Add opens the question and writes nothing; a choice takes the skill in with that copy, and the copy it
  // replaced is kept as a version.
  await a.click(`#${rowPart('add', 'skills', 'review')}`);
  check('Add on a differing row opens the choice instead of taking it in', await a.exists(`#${rowPart('use', 'skills', 'review', 'copilot-cli')}`) && !(await switchOn(a, 'skills', 'review')) && readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') === reviewClaude);
  await a.shot('practice-compare');
  await fitsAtMinimum(a, 'a copy choice open');
  await copyQuestionFits(a, 'skills', 'review', [
    { quote: '“Read the supplied changes. Explain what changed, what to check, and what is still unknown.”', tinted: [], does: 'Replaces Copilot CLI’s copy; adds it to Codex.' },
    { quote: '“Read the pull request. List defects first, then missing tests. Ignore style unless it hides a bug.”', tinted: [], does: 'Replaces Claude Code’s copy; adds it to Codex.' },
  ]);
  same('a row with its copy question open and the question are one block, its bar the warning colour, the row too under the pointer and with the focus in it', await openedRowLook(a, 'skills', 'review'),
    ['pointer on the row', 'picked, warning 3px 0px 0px 0px inset', 'picked, warning 3px 0px 0px 0px inset', 'keyboard focus in the row', 'picked, warning 3px 0px 0px 0px inset']);
  await a.click(`#${rowPart('use', 'skills', 'review', 'copilot-cli')}`);
  same('the chosen copy is used in every tool, and it is on', [readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), readNow(join(practice, '.codex/skills/review/SKILL.md')), await switchOn(a, 'skills', 'review')], [reviewCopilot, reviewCopilot, true]);
  check('the result names the copy chosen and says the others are kept as versions', (await a.text('.band-done') ?? '').includes('review is in Central Knot now, with Copilot CLI’s copy, and on in all 3 tools. The other copies are kept as its versions.'), await a.text('.bands'));
  const reviewVersions = join(practice, '.central-knot/items/skills/review/versions');
  check('the replaced copy is kept in Central Knot’s store', readdirSync(reviewVersions).some(version => readNow(join(reviewVersions, version, 'SKILL.md')) === reviewClaude), readdirSync(reviewVersions));
  check('no longer flagged', !(await a.exists(`#${rowPart('decide', 'skills', 'review')}`)));
  // Make current writes the replaced copy everywhere. Claude Code's skills folder can't be written for a moment: its write
  // waits there, its line says why, and it catches up once the folder can be written.
  await opened('review');
  /** Each version's line as the opened row shows it: where it came from, what it changed, and the current mark. */
  const versionsShown = () => a.all('.version-row', `e.querySelector('.version-from').textContent`);
  same('the opened row lists two versions: the chosen copy, current, then Claude Code’s', [(await versionsShown()).length, /Current$/.test((await versionsShown())[0] ?? ''), /Claude Code/.test((await versionsShown())[1] ?? '')], [2, true, true]);
  const claudeSkills = join(practice, '.claude/skills');
  chmodSync(claudeSkills, 0o555);
  await a.click(`#${rowPart('version-current', 'skills', 'review', '1')}`);
  for (let tries = 0; tries < 30 && readNow(join(practice, '.codex/skills/review/SKILL.md')) !== reviewClaude; tries++) await wait(100);
  same('Make current writes the earlier version everywhere it can; Claude Code’s write waits, and its mark says it can’t take it yet', [readNow(join(practice, '.codex/skills/review/SKILL.md')), readNow(join(practice, '.claude/skills/review/SKILL.md')), await cellState(a, 'skills', 'review', 'claude-cli')], [reviewClaude, reviewCopilot, 'cannot']);
  chmodSync(claudeSkills, 0o755);
  await a.click('#header-refresh');
  same('once the folder can be written, Claude Code catches up', readNow(join(practice, '.claude/skills/review/SKILL.md')), reviewClaude);
  await opened('review', false);

  // A tool's own switch for a skill is left exactly as it is: the folder stays, the tool doesn't load it, its mark is off and
  // its line says so; Clear the switch, in the opened row, clears it.
  const switchFiles = ['.claude/settings.json', '.copilot/settings.json', '.codex/config.toml'].map(file => join(practice, file));
  const readSwitches = () => switchFiles.map(file => (existsSync(file) ? readFileSync(file, 'utf8') : ''));
  const claudeSettingsBefore = readSwitches()[0];
  writeFileSync(switchFiles[0], JSON.stringify({ ...JSON.parse(claudeSettingsBefore || '{}'), skillOverrides: { 'release-notes': 'off' } }, null, 2));
  // No Refresh: the settings file is watched, and the page reads again though the pass wrote nothing.
  for (let tries = 0; tries < 80 && !(await offMarks(a, 'skills', 'release-notes')).length; tries++) await wait(100);
  same('a switch set in Claude Code’s settings reaches the open page, and is read, not undone: the folder stays, the mark is off, the tag says so', [folders('release-notes').every(Boolean), await offMarks(a, 'skills', 'release-notes'), /switched off in Claude Code/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'release-notes')}"]`) ?? ''), await switchOn(a, 'skills', 'release-notes')], [true, ['claude-cli'], true, true]);
  await opened('release-notes');
  check('its line in the opened row says the tool doesn’t load it', /Claude Code doesn’t load it, and Central Knot leaves that switch as it is/.test(await a.text('.details') ?? ''), await a.text('.details'));
  // While the skills record is damaged, Let Claude Code load it is drawn and off, as the row's other controls are (that a click
  // writes nothing then is tests/librarygate.test.ts's).
  const clearSwitch = `#${rowPart('clear-switch', 'skills', 'release-notes', 'claude-cli')}`, skillsRecordHere = join(practice, '.central-knot/skills.json'), skillsRecordGood = readFileSync(skillsRecordHere, 'utf8');
  writeFileSync(skillsRecordHere, '{ damaged');
  await a.click('#header-refresh');
  same('with the skills record damaged, Let Claude Code load it is there and off', await a.run(`document.querySelector(${JSON.stringify(clearSwitch)})?.disabled ?? 'not drawn'`), true);
  writeFileSync(skillsRecordHere, skillsRecordGood);
  await a.click('#header-refresh');
  await a.click(clearSwitch);
  same('Clear the switch clears it in Claude Code’s settings, and the mark is on again', [JSON.parse(readSwitches()[0]).skillOverrides?.['release-notes'], await offMarks(a, 'skills', 'release-notes')], [undefined, []]);
  await opened('release-notes', false);

  // A tool's own switch in the opened row keeps the skill out of that tool alone: partial, which its tag and switch say. Its
  // Undo puts the same folder back.
  const standupOn = folders('standup');
  await opened('standup');
  await a.click(`#${rowPart('enable', 'skills', 'standup', 'codex-cli')}`);
  same('Codex’s switch takes Codex’s folder out, leaves the others, and marks Codex as kept out', [folders('standup').map(Boolean), await cellState(a, 'skills', 'standup', 'codex-cli')], [[true, true, false], 'kept-out']);
  same('the row says where it is, and its switch shows it partial', [/in 2 of 3 tools · kept out of Codex/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'standup')}"]`) ?? ''), await a.exists(`#${rowPart('switch', 'skills', 'standup')}.switch-partial`), await a.run(`document.querySelector('#${rowPart('switch', 'skills', 'standup')}').title`)],
    [true, true, 'standup: on in 2 of 3 tools. Click to take it out of every tool; Central Knot keeps it.']);
  await a.click('#outcome-undo');
  same('its Undo puts Codex’s folder back as it was', folders('standup'), standupOn);
  await opened('standup', false);

  // Profiles: a profile with only notes in it. Before the click the page says what switching turns off; the switch turns every
  // other skill Off (each one's own Off: its folders leave every tool, Central Knot keeps it) in one History step; the profile in
  // use is worked out, so a hand click changes it; and Undo switch puts every folder back.
  const skillsOn = ['notes', 'release-notes', 'standup', 'review'];
  const allFolders = () => Object.fromEntries(skillsOn.map(key => [key, folders(key)]));
  const allOn = allFolders(), gone = [null, null, null];
  await a.click('#nav-profiles');
  await newProfile(a, 'Incident');
  same('an empty profile offers no switch: it would turn everything off', [await a.exists('#profile-switch'), await a.exists('#profile-from-now')], [false, true]);
  await a.click('#pf-skill\\:notes');
  same('ticking only edits the profile', allFolders(), allOn);
  const stateShown = key => a.text(`.pf-row[data-item="skill:${key}"] .pf-state`);
  same('before the click the page says what switching turns off, row by row and in the header', [await stateShown('notes'), await stateShown('standup'), await a.text('.profile-header p')], ['Stays on', 'Turns off', 'Switching turns 3 items off']);
  await a.click('#profile-switch');
  same('the switch takes what Incident leaves out out of every tool, and leaves notes', [folders('standup'), folders('release-notes'), folders('review'), folders('notes')], [gone, gone, gone, allOn.notes]);
  same('the status bar, the list and the header say Incident is in use', [(await a.text('#status-profile'))?.trim(), await a.text('.profile-row.selected .profile-in-use'), await a.text('.profile-header p'), await a.exists('#profile-switch')], ['Incident', 'In use', 'In use · 1 item on, the other 3 off', false]);
  check('the result says what it turned off, with Undo switch', /^Switched to Incident: 3 items turned off\./.test(await a.text('.band-done') ?? '') && await a.exists('#outcome-undo'), await a.text('.bands'));
  await a.click('#outcome-undo');
  same('Undo switch puts every folder back, byte for byte, and no profile is in use', [allFolders(), (await a.text('#status-profile'))?.trim()], [allOn, 'No profile']);
  await a.click('#nav-skills');
  // A switch from the status bar: its result shows on the Skills page with its Undo, and a skill it turned off is under Off.
  const switchFromBar = async name => { await a.click('#status-profile'); await a.run(`[...document.querySelectorAll('.pf-menu-item')].find(item => item.textContent.includes(${JSON.stringify(name)})).click()`); await a.settle(); };
  const statusShown = () => a.run(`(() => { const region = document.querySelector('#announcement'); return region.classList.contains('visually-hidden') ? '' : region.dataset.text; })()`);
  const openRow = async (key, probe) => { if (!(await a.exists(probe))) await a.click(`#${rowPart('open', 'skills', key)}`); };
  await switchFromBar('Incident');
  check('the switch’s result shows on Skills, with Undo switch', /^Switched to Incident/.test(await a.text('.band-done') ?? '') && await a.exists('#outcome-undo'), await a.text('.bands'));
  same('a skill it leaves out is under Off, in Central Knot only', [(await sectionsNow(a, 'skills')).find(([section]) => section === 'off')?.[1], folders('standup')], [['release-notes', 'review', 'standup'], gone]);
  // Turned back on by hand: the profile in use is worked out, so the status bar follows at once.
  await a.click(`#${rowPart('switch', 'skills', 'standup')}`);
  same('after a hand click no profile is in use, and the status bar says so', (await a.text('#status-profile'))?.trim(), 'No profile');
  // On History, the switch's Undo turns back only what is still as the switch left it: standup, turned on since, stays.
  await a.click('#nav-history');
  await a.run(`document.querySelector('.history-row[data-kind="profile"] .history-actions button').click()`); await a.settle();
  check('its Undo from History says what it did, in the status bar', /^Undone: 2 items turned on\./.test(await statusShown() ?? ''), await statusShown());
  same('…and every skill is on again', skillsOn.map(key => folders(key).every(Boolean)), [true, true, true, true]);
  await a.click('#nav-skills');
  // An armed Delete from Central Knot stays on the visit it was clicked on.
  const standupOpen = () => openRow('standup', `#${rowPart('delete', 'skills', 'standup')}, #${rowPart('delete-confirm', 'skills', 'standup')}`);
  await standupOpen(); await a.click(`#${rowPart('delete', 'skills', 'standup')}`);
  await a.click('#nav-overview'); await a.click('#nav-skills'); await standupOpen();
  check('an armed Delete from Central Knot is disarmed by leaving the page', await a.exists(`#${rowPart('delete', 'skills', 'standup')}`) && !(await a.exists(`#${rowPart('delete-confirm', 'skills', 'standup')}`)), await a.all('.delete-armed button'));

  // Two-way: an edit in one tool becomes the current version and reaches the others on the next read, its notice's Undo
  // makes the version before it current again; a deletion turns the skill off everywhere after the settle window, and
  // turning it on puts every folder back.
  const standupPath = tool => join(practice, `.${tool}/skills/standup/SKILL.md`);
  const standupBefore = readFileSync(standupPath('claude'), 'utf8');
  writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited in Claude Code.\n'));
  await a.click('#header-refresh');
  same('an edit spreads to every tool on the next read', [readFileSync(standupPath('copilot'), 'utf8'), readFileSync(standupPath('codex'), 'utf8')].map(text => text.includes('Edited in Claude Code.')), [true, true]);
  check('and says it is the current version now, with Undo', (await a.text('.sync-notices') ?? '').includes('standup was edited in Claude Code; that is its current version now') && await a.exists('[id^="notice-undo-"]'), await a.text('.bands'));
  check('without also calling it a catch-up', !(await a.text('.bands') ?? '').includes('Caught up'), await a.text('.bands'));
  check('and the status bar doesn’t say nothing changed beside it', !/Nothing changed/.test(await a.run(`document.querySelector('#announcement').dataset.text ?? ''`) ?? ''), await a.run(`document.querySelector('#announcement').dataset.text`));
  await a.shot('practice-edit-spread');
  // A click on a row leaves the notice where it is: it goes at its × or at a newer notice, never at a click.
  await a.click(`#${rowPart('switch', 'skills', 'notes')}`); await a.click('#outcome-undo');
  check('a click on a row, and its Undo, leave the notice above the list as it was', (await a.text('.sync-notices') ?? '').includes('standup was edited in Claude Code; that is its current version now') && await switchOn(a, 'skills', 'notes'), await a.text('.bands'));
  await a.run(`document.querySelector('.sync-notice[data-kind="edit"] [id^="notice-undo-"]').click()`);
  await a.settle();
  same('Undo makes the version before it current again, everywhere', [readFileSync(standupPath('claude'), 'utf8'), readFileSync(standupPath('copilot'), 'utf8')], [standupBefore, standupBefore]);
  // Sorted by last updated, the skill just made current again comes first under On, its row saying when, and the choice holds
  // on the Agents page too; sorted by name again, the rows are as before. Nothing else in this run changes the order.
  const onRows = async () => (await sectionsNow(a, 'skills')).find(([role]) => role === 'on')?.[1] ?? [];
  const sortBy = async value => { await a.run(`(() => { const select = document.querySelector('#item-order'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change')); })()`); await a.settle(); };
  const byName = await onRows();
  await sortBy('updated');
  const byUpdated = await onRows(), standupWhen = await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'standup')}"] .ov-when`);
  await fitsAtMinimum(a, 'Skills sorted by last updated, each row saying when');
  await a.click('#nav-agents');
  const onAgents = await a.run(`document.querySelector('#item-order')?.value`);
  await a.click('#nav-skills');
  await sortBy('name');
  same('sorted by last updated, the skill made current again comes first under On, saying when, and so sorted on Agents too; by name again, the rows are as before',
    [byUpdated[0], [...byUpdated].sort(), standupWhen, onAgents, await onRows(), await a.exists('.ov-when')], ['standup', [...byName].sort(), 'just now', 'updated', byName, false]);
  const releaseNotesIn = () => ['claude', 'copilot', 'codex'].map(tool => existsSync(join(practice, `.${tool}/skills/release-notes/SKILL.md`)));
  const releaseNotesOn = folders('release-notes');
  // Read the real folders at the instant the page asks: pausing its listener keeps the background reply from landing
  // between that check and the click. The same probe reads the files at the first Refresh's draw, before its settle.
  const probe = await connect(a.debugUrl, async event => {
    if (event.method !== 'Debugger.paused') return;
    await probe.send('Debugger.evaluateOnCallFrame', { callFrameId: event.params.callFrames[0].callFrameId,
      expression: `window.releaseNotesCopies = ${JSON.stringify(releaseNotesIn())}` });
    await probe.send('Debugger.resume');
  });
  let refreshNotice;
  try {
    await probe.send('Debugger.enable');
    await a.run(`{
      const copies = () => { debugger; return window.releaseNotesCopies; };
      const clickAndRead = read => new Promise((done, fail) => {
        const draw = new MutationObserver(() => {
          if (document.body.dataset.busy === 'true') return;
          draw.disconnect();
          clearTimeout(limit);
          done(read());
        });
        const limit = setTimeout(() => { draw.disconnect(); fail(new Error('Refresh did not finish.')); }, 30000);
        draw.observe(document.body, { attributes: true, attributeFilter: ['data-busy'] });
        document.querySelector('#header-refresh').click();
      });
      window.firstRefreshCopies = () => clickAndRead(copies);
      window.deletionRefresh = new Promise((done, fail) => {
        const limit = setTimeout(() => fail(new Error('The deletion did not trigger a completed Refresh.')), 30000);
        let clicked = false;
        centralKnot.onSyncChanged(() => {
          // With the page paused, an earlier signal still finds a copy. Only the deletion pass removes the two that survived the hand deletion.
          if (clicked || copies().some(Boolean)) return;
          clicked = true;
          clearTimeout(limit);
          done(clickAndRead(() => document.querySelector('.sync-notices')?.textContent ?? null));
        });
      });
      true;
    }`);
    rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
    same('a fresh deletion waits for the settle window: nothing removed or put back yet', await a.run('window.firstRefreshCopies()'), [true, false, true]);
    await a.settle();
    refreshNotice = await a.run('window.deletionRefresh');
  } finally { probe.close(); }
  await a.settle();
  check('Refresh’s own draw offers to turn the deleted skill on', /release-notes was deleted[\s\S]*Turn it on/.test(refreshNotice), refreshNotice);
  same('then the skill turns off everywhere', releaseNotesIn(), [false, false, false]);
  check('with a notice that Central Knot keeps it, offering Turn it on', (await a.text('.sync-notices') ?? '').includes('release-notes was deleted in Copilot CLI, so it is off and was taken out of Claude Code and Codex. Central Knot keeps it') && /Turn it on/.test(await a.text('.sync-notices') ?? ''), await a.text('.bands'));
  check('and the table keeps it under Off, in Central Knot only', ((await sectionsNow(a, 'skills')).find(([role]) => role === 'off')?.[1] ?? []).includes('release-notes') && /in Central Knot only/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'release-notes')}"]`) ?? '') && !(await switchOn(a, 'skills', 'release-notes')), await sectionsNow(a, 'skills'));
  await a.click('#nav-history');
  check('History lists it', (await a.text('#history-scroll') ?? '').includes('release-notes'), await a.text('#history-scroll'));
  await a.shot('practice-history');
  await a.click('#nav-skills');
  await a.click(`#${rowPart('switch', 'skills', 'release-notes')}`);
  same('turning it on puts every folder back as it was', [folders('release-notes'), await switchOn(a, 'skills', 'release-notes')], [releaseNotesOn, true]);
  check('with Undo', await a.exists('#outcome-undo'), await a.text('.bands'));
  await a.click('#outcome-undo');
  same('whose Undo takes it out of every tool again: off, in Central Knot only', [releaseNotesIn(), /in Central Knot only/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'release-notes')}"]`) ?? ''), await switchOn(a, 'skills', 'release-notes')], [[false, false, false], true, false]);
  await a.click(`#${rowPart('switch', 'skills', 'release-notes')}`);
  same('and on again puts it back once more', releaseNotesIn(), [true, true, true]);

  // A damaged record stops every write, and the page says so in its bands; put back, sync carries on.
  const syncRecord = join(practice, '.central-knot/sync.json'), goodRecord = readFileSync(syncRecord, 'utf8');
  writeFileSync(syncRecord, '{ damaged');
  await a.click('#header-refresh');
  const timesSaid = async selector => ((await a.text(selector)) ?? '').split('The sync record is damaged').length - 1;
  same('a damaged record is said in the bands, once, and every switch is off', [await timesSaid('.bands'), await a.run(`(list => list.length > 0 && list.every(item => item.disabled))([...document.querySelectorAll('.ov-row[data-key] :is(.switch, .add-item)')])`)], [1, true]);
  await a.click('#nav-overview');
  same('the Overview says it once too, first of what needs you, as the stop', [await timesSaid('#overview-needs'), await timesSaid('#overview-stopped')], [1, 1]);
  await a.click('#nav-skills');
  writeFileSync(syncRecord, goodRecord);
  await a.click('#header-refresh');
  check('put back, the switches work again', !(await a.run(`document.querySelector('#${rowPart('switch', 'skills', 'notes')}').disabled`)), await a.text('.bands'));
  // A damaged skills record stops skills' writes alone, its reason both the stop and a problem: the Skills page says it once, as
  // the stop; the Overview, whose stop line is the home's record's, once, as Skills' problem with the way there.
  const skillsRecord = join(practice, '.central-knot/skills.json'), goodSkills = readFileSync(skillsRecord, 'utf8');
  writeFileSync(skillsRecord, '{ damaged');
  await a.click('#header-refresh');
  const stopSays = await a.text('.band-danger .band-text') ?? '', saidIn = async selector => ((await a.text(selector)) ?? '').split(stopSays).length - 1;
  same('a damaged skills record: the Skills page says why once, as the stop', [stopSays.length > 0, await saidIn('.bands')], [true, 1]);
  // A row's controls ask their own kind's gate: every skill's switch is off, and on Agents the switches still work.
  const controlsOff = () => a.run(`[...document.querySelectorAll('.ov-row[data-key] :is(.switch, .add-item)')].map(item => item.disabled)`);
  same('and every skill’s switch is off, on a list that has some', await controlsOff().then(off => off.length > 0 && off.every(Boolean)), true);
  await a.click('#nav-agents');
  same('while the agents’ switches work', (await controlsOff()).some(off => !off), true);
  await a.click('#nav-overview');
  same('and the Overview once, as Skills’ problem, with the way to Skills', [await saidIn('#overview-needs'), await a.exists('#overview-stopped'), await a.exists('#overview-skills-problem-0-open')], [1, false, true]);
  await a.click('#nav-skills');
  writeFileSync(skillsRecord, goodSkills);
  await a.click('#header-refresh');
  // The practice copy has no Pi folder, only a skill in the shared .agents folder that Pi (and others) read: that makes no
  // tool present, so Pi is no column, mark or control, and Tools shows no card for it.
  mkdirSync(join(practice, '.agents/skills/shared-only'), { recursive: true });
  writeFileSync(join(practice, '.agents/skills/shared-only/SKILL.md'), text('shared-only'));
  await a.click('#nav-skills');
  await a.click('#header-refresh');
  check('a tool not in this home has no column or mark', !(await a.exists('[data-tool="pi-cli"], #tool-pi-cli')));
  await a.click('#nav-harnesses');
  check('nor a card on Harnesses', !(await a.exists('#harness-pi-cli')) && await a.exists('#harness-codex-cli'));
  // Copilot CLI and Codex do read the shared folder, so its skill is theirs; it goes again before the checks that count skills.
  rmSync(join(practice, '.agents'), { recursive: true, force: true });
  await a.click('#header-refresh');
  // Watching: an edit on disk spreads with no click (an event prompts a read; polling is the fallback).
  await a.click('#nav-skills');
  writeFileSync(standupPath('copilot'), standupBefore.replace(/\n*$/, '\nEdited in Copilot, watched.\n'));
  let watched = false;
  for (let tries = 0; tries < 40 && !watched; tries++) { await wait(250); watched = readNow(standupPath('claude')).includes('watched'); }
  check('a change on disk spreads on its own', watched);
  // The page hears of it once the pass that spread it has told it, and it has read again.
  const heard = async () => (await a.text('.sync-notices') ?? '').includes('standup was edited in Copilot CLI');
  for (let tries = 0; tries < 50 && !(await heard()); tries++) await wait(100);
  check('and the page hears about it without a click', await heard(), await a.text('.bands'));
  // Only a missing event should use the deadline. Check each assertion once, after its prerequisite is observable.
  const waitFor = async (what, observed) => {
    const deadline = performance.now() + 60000;
    while (!(await observed())) {
      if (performance.now() >= deadline) throw new Error(`Never observed ${what}`);
      await wait(50);
    }
  };
  // Deliver the same notification as main and wait until the renderer has received it, even while a read is held.
  if (main) await a.run(`window.ckSyncSignals = 0; centralKnot.onSyncChanged(() => { window.ckSyncSignals++; })`);
  const tellOfChange = async () => {
    const before = await a.run('window.ckSyncSignals');
    await main.tellPage('sync:changed');
    await waitFor('sync:changed in the renderer', async () => await a.run('window.ckSyncSignals') > before);
  };
  // A background read whose reply arrives while an action runs is set aside, but the notice it carried still reaches the page.
  if (main) {
    check('the refresh reply is held', await main.holdRefresh("!asked && view?.skills.notices.some(n => n.item === 'standup' && n.winner === 'codex-cli')"));
    writeFileSync(standupPath('codex'), standupBefore.replace(/\n*$/, '\nEdited in Codex during an action.\n'));
    await tellOfChange();
    await waitFor('the background reply carrying the Codex edit', main.refreshHeld);
    const inspector = await a.main(), held = await holdQueue(inspector, a);
    try {
      await a.run(`document.getElementById('header-refresh').click()`);
      await main.releaseRefresh();
      // A round trip outside the held queue: the background reply reaches the renderer before the
      // action is allowed to finish. Its notice must be there at the action's idle draw.
      await a.run('centralKnot.getSettings().then(() => true)');
    } finally { await held.release(); inspector.close(); }
    const notice = await a.text('.sync-notices');
    check('a notice from a background read set aside for an action is still shown', (notice ?? '').includes('standup was edited in Codex'), notice);
  }
  // A home switch that can't save its settings changes nothing: the page stays on this home, and this home (not the one asked
  // for) is still the one watched, so an edit on disk spreads within seconds, not at the next poll (20 s).
  if (process.platform !== 'win32' && process.getuid() !== 0) {
    const settingsFile = join(scratch, 'data/app-settings.json');
    chmodSync(settingsFile, 0o444);
    await a.click('#home-actual');
    chmodSync(settingsFile, 0o644);
    const said = await a.text('#announcement');
    writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited after a switch that failed.\n'));
    let stillWatched = false;
    for (let tries = 0; tries < 32 && !stillWatched; tries++) { await wait(250); stillWatched = readNow(standupPath('copilot')).includes('switch that failed'); }
    same('a home switch whose settings can’t be saved stays on this home, still watched', [/could not finish\. Still on Practice copy/.test(said ?? ''), await a.text('#home-label'), stillWatched], [true, 'Practice copy', true]);
  }
  // standup turned Off while Copilot CLI's copy can't be removed: once he is on another page and back, the background pass's
  // problem stands alone in the header, and its × closes it.
  await a.click('#nav-overview'); await a.click('#nav-skills');
  const copilotLocked = [standupPath('copilot'), dirname(standupPath('copilot')), dirname(dirname(standupPath('copilot')))];
  const standupSwitch = byId(rowPart('switch', 'skills', 'standup'));
  const problemAfterPass = async key => {
    await a.click(standupSwitch);
    await a.click(byId('nav-overview'));
    // A newly found skill makes the pass tell the page even when its only write failed. The count changes
    // when Overview takes the new view; navigating back to Skills must then show that view's problem.
    const count = async () => parseInt(await a.text(`.kind-card:has(${byId('overview-skills')}) .kind-card-summary`), 10);
    const before = await count(), marker = skill(claudeSkills, key);
    try {
      await waitFor(`Overview to count ${key}`, async () => await count() === before + 1);
      await a.click(byId('nav-skills'));
    } finally { rmSync(marker, { recursive: true }); }
  };
  for (const path of copilotLocked) chmodSync(path, path.endsWith('.md') ? 0o444 : 0o555);
  await problemAfterPass('first-pass');
  const backgroundSaid = await a.text('#header .header-result');
  await a.run(`document.querySelector('#header .band-dismiss')?.click()`); await a.settle();
  same('a background pass’s problem, alone in the header, is closed by its ×', [/standup \(Copilot CLI\)/.test(backgroundSaid ?? ''), await a.exists('#header .header-result')], [true, false]);
  await a.click('#header-refresh');
  same('reported again by the next read, it stays closed', await a.exists('#header .header-result'), false);
  for (const path of copilotLocked) chmodSync(path, path.endsWith('.md') ? 0o644 : 0o755);
  await a.click(standupSwitch);
  // Cleared (standup On again, nothing left to remove), then the same failure later: it is said again.
  for (const path of copilotLocked) chmodSync(path, path.endsWith('.md') ? 0o444 : 0o555);
  await problemAfterPass('repeat-pass');
  same('the same failure, after it cleared, is said again', /standup \(Copilot CLI\)/.test(await a.text('#header .header-result') ?? ''), true);
  for (const path of copilotLocked) chmodSync(path, path.endsWith('.md') ? 0o644 : 0o755);
  await a.click(standupSwitch);
  // Sync off: edits are noted, not spread; the page shows them pending; Sync once spreads them once.
  await a.click('#sync-switch');
  same('Sync turns off', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'false');
  writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited with Sync off.\n'));
  let shownPending = false;
  for (let tries = 0; tries < 40 && !shownPending; tries++) { await wait(250); shownPending = (await cellState(a, 'skills', 'standup', 'claude-cli')) === 'edited'; }
  check('with Sync off the page shows the edit as pending on its own, without Read again', shownPending);
  await a.click('#header-refresh');
  check('with Sync off nothing spreads', !readFileSync(standupPath('copilot'), 'utf8').includes('Sync off'));
  same('the edit shows as waiting to spread, not as a choice', [await cellState(a, 'skills', 'standup', 'claude-cli'), await cellState(a, 'skills', 'standup', 'copilot-cli'), await a.exists(`#${rowPart('decide', 'skills', 'standup')}`)], ['edited', 'gets-it', false]);
  check('and a banner says automatic sync is off', (await a.text('.bands') ?? '').includes('Automatic sync is off'));
  check('and the toolbar counts it', (await a.text('.toolbar-end') ?? '').includes('1 change waiting'), await a.text('.toolbar-end'));
  await a.shot('practice-sync-off');
  await a.click('#sync-now');
  check('Sync now spreads it once', readFileSync(standupPath('copilot'), 'utf8').includes('Sync off'));
  await a.click('#sync-switch');
  same('Sync turns back on', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'true');
  // A deletion in the background spreads, and History brings it back.
  rmSync(join(practice, '.claude/skills/standup'), { recursive: true });
  let spread = false;
  for (let tries = 0; tries < 60 && !spread; tries++) { await wait(250); spread = !existsSync(join(practice, '.copilot/skills/standup')); }
  check('the deletion spreads in the background', spread);
  await a.click('#nav-history');
  const standupDeleted = `[...document.querySelectorAll('.history-row[data-kind="off"]')].find(row => row.textContent.includes('standup'))`;
  // Its Turn it on comes with the page's read after the pass that spread the deletion.
  for (let tries = 0; tries < 50 && !(await a.run(`!!${standupDeleted}?.querySelector('.history-actions button')`)); tries++) await wait(100);
  same('History says the deletion turned it off everywhere, and offers Turn it on', await a.run(`[${standupDeleted}?.querySelector('.history-about')?.textContent, ${standupDeleted}?.querySelector('.history-actions button')?.textContent]`),
    ['Its copy was deleted in Claude Code, so it was turned off and removed from Copilot CLI and Codex. Central Knot keeps it.', 'Turn it on']);
  await a.run(`${standupDeleted}.querySelector('.history-actions button').click()`);
  await a.settle();
  check('Turn it on brings standup back', existsSync(join(practice, '.claude/skills/standup/SKILL.md')) && existsSync(join(practice, '.copilot/skills/standup/SKILL.md')));
  await a.click('#nav-skills');
  await a.click('#nav-skills');
  same('review keeps the version made current, in every tool', ['claude', 'copilot', 'codex'].map(tool => readNow(join(practice, `.${tool}/skills/review/SKILL.md`))), [reviewClaude, reviewClaude, reviewClaude]);
  same('each tool has the current version', [await cellState(a, 'skills', 'release-notes', 'copilot-cli'), await cellState(a, 'skills', 'standup', 'claude-cli'), await cellState(a, 'skills', 'notes', 'claude-cli')], ['current', 'current', 'current']);
  same('on', await switchOn(a, 'skills', 'release-notes'), true);
  await a.shot('practice-applied');

  // Details open under a row.
  await a.click(`#${rowPart('open', 'skills', 'release-notes')}`);
  check('details say it is on in every tool', (await a.text('.details')).includes('On in all 3 tools'), await a.text('.details'));
  await a.click(`#${rowPart('open', 'skills', 'release-notes')}`);

  // With four tools beside an open sidebar the name column is narrowest: a flagged name still fits. The found skill whose
  // copies differ is the check's own: it is taken out again.
  for (const [root, body] of [['.claude/skills', 'Ask a second reviewer.'], ['.copilot/skills', 'Ask someone else to look.']]) skill(join(practice, root), 'second-opinion', text('second-opinion', body));
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.click('#header-refresh');
  check('a Pi folder gives each row a fourth mark', await a.exists(`#${rowPart('cell', 'skills', 'review', 'pi-cli')}`) && await a.exists(`#${rowPart('decide', 'skills', 'second-opinion')}`));
  await fitsAtMinimum(a, 'Skills with four tools');
  await a.click(`#${rowPart('decide', 'skills', 'second-opinion')}`);
  await fitsAtMinimum(a, 'a copy choice with four tools');
  await a.click(`#${rowPart('decide', 'skills', 'second-opinion')}`);
  await piCaughtUp(a);
  rmSync(join(practice, '.pi'), { recursive: true, force: true });
  await a.click('#header-refresh');
  const nameFits = await a.run(`(() => { const cell = document.querySelector('.ov-row[data-key="${rowPart('', 'skills', 'second-opinion')}"] .ov-name'); return cell.scrollWidth <= cell.clientWidth + 1 && cell.getBoundingClientRect().height < 44; })()`);
  check('the name cell does not overflow or wrap', nameFits);
  for (const root of ['.claude/skills', '.copilot/skills']) rmSync(join(practice, root, 'second-opinion'), { recursive: true, force: true });
  await a.click('#header-refresh');

  // Focus stays on the switch after its click redraws the page.
  await a.run(`document.querySelector('#${rowPart('switch', 'skills', 'release-notes')}').focus()`);
  await a.press(' ', 'Space');
  same('focus stays on the switch', [await a.run(`document.activeElement?.id`), await switchOn(a, 'skills', 'release-notes')], [rowPart('switch', 'skills', 'release-notes'), false]);
  await a.press(' ', 'Space');
  same('and it turns back on', await switchOn(a, 'skills', 'release-notes'), true);

  // Skills Files view: every skill in a list, and one skill's files and contents with the same switch and controls as the table.
  await a.click('#nav-skills');
  const tableOrder = await rowKeys(a, 'skills'), tableHeadings = (await sectionsNow(a, 'skills')).filter(([, keys]) => keys.length).map(([section]) => section);
  await a.click(`#${rowPart('open', 'skills', 'standup')}`);
  await a.click(`#${rowPart('files', 'skills', 'standup')}`);
  same('the Skills list has every skill, in the table’s order, under the table’s headings', [keysOf('skills', await a.all('.list-row', 'e.dataset.key')), (await a.all('.list-group', 'e.textContent')).map(word => word.toLowerCase())], [tableOrder, tableHeadings]);
  await a.click(`#${rowPart('list', 'skills', 'standup')}`);
  check('the details show the skill', (await a.text('.pane-title')).includes('standup') && (await a.exists('#detail-scroll .details-paths')), await a.text('.pane-title'));
  check('its folders and contents are shown', (await a.text('#detail-scroll .details-paths')).includes('/.copilot/skills/standup') && (await a.text('#detail-scroll pre.content')).includes('name:'), await a.text('#detail-scroll'));
  // Stacked (this window), the file comes before where each copy is, and nothing to delete sits above the file.
  same('stacked, the file comes first, then each tool’s line, where each copy is and Delete', await a.run(`(() => { const order = [...document.querySelectorAll('#detail-scroll pre.content, #detail-scroll .details-tool, #detail-scroll .details-paths, #detail-scroll [id^="delete-"]')].map(e => e.matches('pre') ? 'file' : e.matches('.details-tool') ? 'lines' : e.matches('.details-paths') ? 'where' : 'delete'); return order.filter((entry, index) => order.indexOf(entry) === index); })()`), ['file', 'lines', 'where', 'delete']);
  // A wide pane (here at 1728) puts the details in a column at the right: where each copy is open from the start, the
  // file's box spanning to meet it.
  await sizeTo(a, 1728, 1117);
  for (let tries = 0; tries < 20 && !(await a.exists('#detail-scroll .files-tail .details-paths[open]')); tries++) await wait(50);
  const filesWide = await a.run(`(() => { const pane = document.querySelector('#detail-scroll').getBoundingClientRect(), file = document.querySelector('#detail-scroll pre.content').getBoundingClientRect(), details = document.querySelector('#detail-scroll .files-tail').getBoundingClientRect(); return { open: !!document.querySelector('#detail-scroll .files-tail .details-paths[open]'), beside: details.left > file.right, gap: Math.round(details.left - file.right), edge: Math.round(pane.right - details.right) }; })()`);
  check('at 1728 the details sit beside the file, open, with the file spanning to them', filesWide.open && filesWide.beside && filesWide.gap <= 40 && filesWide.edge <= 40, JSON.stringify(filesWide));
  await fullSize(a);
  const listOrder = () => a.run(`[...document.querySelectorAll('.list-group, .list-row')].map(each => each.dataset.key || each.textContent)`), listBefore = await listOrder();
  await a.click(`#${rowPart('detail-switch', 'skills', 'standup')}`);
  same('its switch here applies at once, as the table’s does, and its row in the list stays where it was, under the same heading', [await a.run(`document.querySelector('#${rowPart('detail-switch', 'skills', 'standup')}').getAttribute('aria-checked')`), existsSync(standupPath('claude')), await listOrder()], ['false', false, listBefore]);
  await fitsAtMinimum(a, 'the Files view');
  await a.shot('practice-skills');
  await a.press('Escape');
  check('Escape leaves the Files view for the table, which agrees', !(await a.exists('.split')) && await a.exists(`.ov-row[data-key="${rowPart('', 'skills', 'standup')}"]`) && !(await switchOn(a, 'skills', 'standup')));
  await a.click(`#${rowPart('switch', 'skills', 'standup')}`);
  // A later skill chosen in the side-by-side Files view stays in view when the window narrows into the stacked list.
  for (let n = 1; n <= 6; n++) { mkdirSync(join(practice, `.claude/skills/zz-${n}`), { recursive: true }); writeFileSync(join(practice, `.claude/skills/zz-${n}/SKILL.md`), text(`zz-${n}`)); }
  await a.click('#header-refresh');
  if (!(await a.exists(`#${rowPart('files', 'skills', 'standup')}`))) await a.click(`#${rowPart('open', 'skills', 'standup')}`);
  await a.click(`#${rowPart('files', 'skills', 'standup')}`);
  await a.click(`#${rowPart('list', 'skills', 'zz-6')}`);
  await sizeTo(a, ...SMALLEST);
  // The list brings the row into view at the first frame after it is laid out at the new size (matrix.ts revealSelected).
  const rowInView = () => a.run(`(() => { const list = document.querySelector('#skills-list'), row = document.querySelector('#${rowPart('list', 'skills', 'zz-6')}'), head = list.querySelector('.list-head'); const area = list.getBoundingClientRect(), box = row.getBoundingClientRect(); return box.top >= area.top + head.offsetHeight - 1 && box.bottom <= area.top + list.clientHeight + 1; })()`);
  for (let tries = 0; tries < 30 && !(await rowInView()); tries++) await wait(100);
  check('the chosen row stays in view in the stacked list', await rowInView());
  await fullSize(a);
  await a.press('Escape');
  // A scrolled table keeps its place when the window crosses the dock's breakpoint (a redraw), both ways.
  const tableTop = () => a.run(`document.querySelector('#table-skills')?.scrollTop ?? -1`);
  await sizeTo(a, 1280, 560);
  // Partway down, so the same position exists however tall the table's area is at either width.
  await a.run(`(() => { const table = document.querySelector('#table-skills'); table.scrollTop = Math.min(40, table.scrollHeight - table.clientHeight); })()`);
  const scrolled = await tableTop();
  await sizeTo(a, 2560, 560);
  const docked = await tableTop();
  await sizeTo(a, 1280, 560);
  check('a scrolled table keeps its place across the dock breakpoint, both ways', scrolled > 0 && docked === scrolled && await tableTop() === scrolled, { scrolled, docked, back: await tableTop() });
  // An opened row and its details are one block, the row too under the pointer and with the focus in it. Scrolled until
  // the middle of its details is at the table's top, the row has gone up with the list: none of it is in view, nor drawn
  // over the details.
  await opened('zz-1');
  same('an opened row and its details are one block: one background, one accent bar down both, no line under the row, under the pointer and with the focus in it', await openedRowLook(a, 'skills', 'zz-1'),
    ['pointer on the row', 'picked, accent 3px 0px 0px 0px inset', 'picked, accent 3px 0px 0px 0px inset', 'keyboard focus in the row', 'picked, accent 3px 0px 0px 0px inset']);
  same('scrolled past an opened row, nothing of it stays in view', await a.run(`(() => {
    const row = document.querySelector('.ov-row.open[data-key="${rowPart('', 'skills', 'zz-1')}"]'), details = row.nextElementSibling, table = row.closest('.scroll'), area = table.getBoundingClientRect();
    const detailsTop = details.getBoundingClientRect().top - area.top + table.scrollTop;
    table.scrollTop = detailsTop + details.offsetHeight / 2;
    const atTop = document.elementFromPoint(area.left + area.width / 2, area.top + 2);
    return [table.scrollTop >= detailsTop ? 'scrolled past the row' : 'the table can’t scroll past the row', row.getBoundingClientRect().bottom < area.top + 1 && !atTop?.closest('.ov-row') ? 'the row out of view' : 'the row in view'];
  })()`), ['scrolled past the row', 'the row out of view']);
  await opened('zz-1', false);
  await fullSize(a);
  for (let n = 1; n <= 6; n++) rmSync(join(practice, `.claude/skills/zz-${n}`), { recursive: true, force: true });
  await a.click('#header-refresh');
  // A large display docks an open row's details beside the table, and nothing on it is cut off; laptop full screen docks too.
  await sizeTo(a, 2560, 1440);
  if (!(await a.exists(`.ov-row.open[data-key="${rowPart('', 'skills', 'standup')}"]`))) await a.click(`#${rowPart('open', 'skills', 'standup')}`);
  check('at 2560 the details dock beside the table', await a.exists('.ov-page.docked .dock .details') && !(await a.exists('.ov-row + .details')));
  same('nothing cut off at 2560×1440 with details docked', await a.run(CUT_OFF), []);
  await sizeTo(a, 1728, 1117);
  check('at 1728 the details dock too', await a.exists('.dock .details'));
  check('and hold each tool’s own switch', await a.exists(`.dock #${rowPart('enable', 'skills', 'standup', 'codex-cli')}`));
  await a.click('#dock-close');
  await fullSize(a);
  // Open details never repeat an id.
  await a.click(`#${rowPart('open', 'skills', 'review')}`);
  same('no duplicate ids with details open', await a.run(`(() => { const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return ids.filter((id, index) => ids.indexOf(id) !== index); })()`), []);
  await a.click(`#${rowPart('open', 'skills', 'review')}`);
  // Slash finds in the Files view too.
  await a.click(`#${rowPart('open', 'skills', 'review')}`);
  await a.click(`#${rowPart('files', 'skills', 'review')}, #${rowPart('diff', 'skills', 'review')}`);
  await a.run(`document.activeElement?.blur()`);
  await a.press('/', 'Slash');
  same('slash focuses find in the Files view', await a.run(`document.activeElement?.id`), 'skills-find');
  await a.click('#skills-table');

  // Keyboard and find.
  await a.press('/', 'Slash');
  same('slash focuses find', await a.run(`document.activeElement?.id`), 'find');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'stand'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.settle();
  same('find filters', await rowKeys(a, 'skills'), ['standup']);
  await a.press('Escape');
  same('Escape clears find', (await rowKeys(a, 'skills')).length, 4);
  // MCP servers: on Central Knot's library, as skills and agents are. A server a tool has is found: Add takes it in and puts it
  // in every tool by editing only that entry, Claude Code's file too.
  await a.click('#nav-mcp');
  same('MCP servers from every tool, found', [(await rowKeys(a, 'mcp')).sort(), await sectionsNow(a, 'mcp')], [['docs', 'files'], [['found', ['docs', 'files']]]]);
  same('files is in Copilot and Codex, not in Claude Code', [await cellState(a, 'mcp', 'files', 'copilot-cli'), await cellState(a, 'mcp', 'files', 'codex-cli'), await cellState(a, 'mcp', 'files', 'claude-cli')], ['own-copy', 'own-copy', 'none']);
  check('a found server has Add where a switch would be, and no button that waits for a later click', await a.exists(`#${rowPart('add', 'mcp', 'docs')}`) && !(await a.exists(`#${rowPart('switch', 'mcp', 'docs')}`)) && !(await a.exists('#apply, #manage-all')));
  const tomlBefore = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  await a.click(`#${rowPart('add', 'mcp', 'docs')}`);
  // files is added from the keyboard (focus on its Add, as Tab leaves it): the focus goes to its switch, in Add's place. Each row
  // stays where it was, under Found, its switch On, and the heading counts what is still found, with no note over rows now On.
  await a.run(`document.querySelector('#${rowPart('add', 'mcp', 'files')}').focus()`);
  await a.press('Shift');
  await a.click(`#${rowPart('add', 'mcp', 'files')}`);
  same('after a click each row stays where it was, its switch On, from the keyboard too, the focus on files’ switch; Found counts none and says nothing of them',
    [await sectionsNow(a, 'mcp'), await switchOn(a, 'mcp', 'docs'), await switchOn(a, 'mcp', 'files'), await a.run(`document.activeElement?.id`), await headingSays(a, 'found')], [[['found', ['docs', 'files']]], true, true, rowPart('switch', 'mcp', 'files'), 'Found0']);
  check('taking files in says it is on in every tool, Claude Code too, as a plain note, not a warning', /^files is in Central Knot now, and on in all 3 tools\./.test(await a.text('.band-done .band-text') ?? '')
    && !(await a.exists('.band-done .tone-warning')), [await a.text('.bands'), await a.text('.toolbar')]);
  const copilotMcp = JSON.parse(readFileSync(join(practice, '.copilot/mcp-config.json'), 'utf8')).mcpServers;
  same('docs reached Copilot with its header as-is', copilotMcp.docs, { type: 'http', url: 'https://docs.example.test/mcp', headers: { Authorization: 'Bearer practice-token' }, tools: ['*'] });
  const tomlAfter = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  check('docs reached Codex, and config.toml kept its comment and the files table byte for byte', tomlAfter.startsWith(tomlBefore) && tomlAfter.includes('[mcp_servers.docs]') && tomlAfter.includes('url = "https://docs.example.test/mcp"'), tomlAfter);
  const claudeAfter = JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8'));
  same('the same click put files in Claude Code, its other settings kept, its mark current, and no band asks for a step of its own', [claudeAfter.mcpServers.files?.command, claudeAfter.theme, claudeAfter.numStartups, await cellState(a, 'mcp', 'files', 'claude-cli'), /Write to Claude|Quit Claude/.test(await a.text('.bands') ?? '')],
    ['npx', 'dark', 3, 'current', false]);
  await a.shot('practice-mcp');
  await a.click('#header-refresh');
  same('Refresh puts each row under the heading true for it: both On', [await sectionsNow(a, 'mcp'), await a.text('.ov-section[data-section="on"] .ov-section-count')], [[['on', ['docs', 'files']]], '2']);
  // Off: out of every tool, Claude Code's too, and Central Knot keeps it. Undo puts each entry back as it was.
  const mcpFiles = ['.claude.json', '.copilot/mcp-config.json', '.codex/config.toml'].map(file => join(practice, file));
  const mcpBefore = mcpFiles.map(readNow);
  // Turned off with the pointer over the list, its row open: it stays where it was, under On, drawn Off.
  await a.click(`#${rowPart('open', 'mcp', 'files')}`);
  await pointerOver(`#${rowPart('switch', 'mcp', 'files')}`);
  await a.click(`#${rowPart('switch', 'mcp', 'files')}`);
  same('after a click with the pointer over the list too, the row stays under On, its switch Off, and On counts docs alone', [await sectionsNow(a, 'mcp'), await switchOn(a, 'mcp', 'files'), await a.text('.ov-section[data-section="on"] .ov-section-count')], [[['on', ['docs', 'files']]], false, '1']);
  await pointerOver('.toolbar');
  await a.click(`#${rowPart('open', 'mcp', 'files')}`);
  same('Off takes files out of every tool at once, Claude Code’s too', [!!JSON.parse(readNow(mcpFiles[1])).mcpServers.files, readNow(mcpFiles[2]).includes('[mcp_servers.files]'), !!JSON.parse(readNow(mcpFiles[0])).mcpServers.files],
    [false, false, false]);
  await a.click('#outcome-undo');
  same('Undo puts files back in each tool, Claude Code’s too, every file as it was but for the entry’s place', [mcpFiles.map(readNow).map(entriesSorted), await switchOn(a, 'mcp', 'files')], [mcpBefore.map(entriesSorted), true]);
  // A server turned off in one tool, outside Central Knot (as `copilot mcp disable` writes it), is marked so; Central Knot leaves
  // that switch as it is, and its line says so. The opened row keeps a server out of one tool.
  const copilotMcpSwitch = join(practice, '.copilot/settings.json');
  writeFileSync(copilotMcpSwitch, `${JSON.stringify({ ...JSON.parse(readNow(copilotMcpSwitch) || '{}'), disabledMcpServers: ['docs'] }, null, 2)}\n`);
  await a.click('#header-refresh');
  same('a server off in Copilot CLI is marked there', await offMarks(a, 'mcp', 'docs'), ['copilot-cli']);
  await a.click(`#${rowPart('open', 'mcp', 'docs')}`);
  await a.shot('practice-mcp-disabled');
  // The practice copy's tools keep no sessions, so every row would say "can't say": usage, collected as the home opened, draws no column.
  for (let tries = 0; tries < 50 && !/^Collected /.test(await a.text('#usage-when') ?? ''); tries++) await wait(100);
  same('usage collected on a home whose tools keep no sessions: no Used column, and beside the button the time and that there are no sessions yet', [await a.exists('.ov-used'), /^Collected .+ · no sessions yet$/.test(await a.text('#usage-when') ?? '')], [false, true]);
  // Full screen on a 1728×1117 display: the details dock beside the table, and a row's line, its tag and URL here, still shows whole.
  await sizeTo(a, 1728, 1117);
  same('docked at full screen, a row’s line is shortened only when it has no room', await a.all('.ov-row[data-key] .ov-name-about', 'e.scrollWidth <= e.clientWidth'), [true, true]);
  await fullSize(a);
  check('its line says Central Knot leaves that switch as it is', /switched off in Copilot CLI’s own settings: Copilot CLI doesn’t start it\. Central Knot leaves that switch as it is/.test(await a.text('.details') ?? ''), await a.text('.details'));
  const codexBefore = readNow(mcpFiles[2]);
  await a.click(`#${rowPart('enable', 'mcp', 'docs', 'codex-cli')}`);
  same('its Codex switch keeps it out of Codex at once', [readNow(mcpFiles[2]).includes('[mcp_servers.docs]'), /docs is kept out of Codex/.test(await a.text('.band-done') ?? '')], [false, true]);
  await a.click('#outcome-undo');
  same('Undo puts it back in Codex, every table byte for byte', entriesSorted(readNow(mcpFiles[2])), entriesSorted(codexBefore));
  writeFileSync(copilotMcpSwitch, readNow(copilotMcpSwitch).replace(/,?\n\s*"disabledMcpServers": \[\s*"docs"\s*\]/, ''));
  if (await a.exists(`#${rowPart('enable', 'mcp', 'docs', 'codex-cli')}`)) await a.click(`#${rowPart('open', 'mcp', 'docs')}`);
  // An MCP edit spreads within seconds: settings files are watched, not left to the 20 s poll.
  const copilotFile = join(practice, '.copilot/mcp-config.json');
  writeFileSync(copilotFile, readFileSync(copilotFile, 'utf8').replace('"command": "npx"', '"command": "npx-edited"'));
  let mcpSpread = false;
  for (let tries = 0; tries < 24 && !mcpSpread; tries++) { await wait(250); mcpSpread = readNow(join(practice, '.codex/config.toml')).includes('command = "npx-edited"'); }
  check('an MCP edit in Copilot reaches Codex within 6 s', mcpSpread);
  for (let tries = 0; tries < 20 && !(await a.exists('.sync-notice[data-kind="edit"]')); tries++) await wait(250);
  await fitsAtMinimum(a, 'MCP servers with the edit’s notice and its actions');

  // Agents: Central Knot holds each agent itself, with its versions (its library), and a harness is where an agent is applied.
  // An agent a harness has that Central Knot doesn't yet is found: its row's Add takes it in and applies it everywhere.
  await a.click('#nav-agents');
  same('agents from every tool', (await rowKeys(a, 'agents')).sort(), ['code-reviewer', 'release-notes']);
  const switchState = key => a.run(`document.querySelector('#${rowPart('switch', 'agents', key)}').getAttribute('aria-checked')`);
  const agentRow = key => a.text(`.ov-row[data-key="${rowPart('', 'agents', key)}"]`);
  same('an agent only a harness has is found: under Found, with Add, said not to be in Central Knot, and the section says what Add does',
    [await a.text(`#${rowPart('add', 'agents', 'code-reviewer')}`), /^Found\s*2/.test((await a.text('[data-section="found"]') ?? '').trim()), /not in Central Knot/.test(await agentRow('code-reviewer') ?? ''),
      /Add one to keep it in Central Knot and turn it on\./.test(await a.text('[data-section="found"]') ?? '')], ['Add', true, true, true]);
  await a.click(`#${rowPart('add', 'agents', 'code-reviewer')}`);
  // release-notes is added from the keyboard: the rows are shared with Skills and MCP servers, so it stays where it was too.
  await a.run(`document.querySelector('#${rowPart('add', 'agents', 'release-notes')}').focus()`);
  await a.press('Shift');
  await a.clickInRun(`#${rowPart('add', 'agents', 'release-notes')}`);
  same('after a click each agent stays where it was, under Found, from the keyboard too', await sectionsNow(a, 'agents'), [['found', ['code-reviewer', 'release-notes']]]);
  const reviewerFiles = ['.claude/agents/code-reviewer.md', '.copilot/agents/code-reviewer.agent.md', '.codex/agents/code-reviewer.toml'].map(file => join(practice, file));
  const [claudeAgent, , codexAgent] = reviewerFiles;
  const reviewerNow = () => reviewerFiles.map(file => (existsSync(file) ? readFileSync(file, 'utf8') : null));
  const taken = reviewerNow();
  check('code-reviewer reached Copilot with name, description and prompt, without Claude Code’s own fields', taken[1].includes('description: Reviews a change') && taken[1].includes('You are a careful code reviewer.') && !taken[1].includes('tools:') && !taken[1].includes('model:'), taken[1]);
  check('release-notes reached Claude Code from Codex', readFileSync(join(practice, '.claude/agents/release-notes.md'), 'utf8').includes('Group them as Added, Changed and Fixed.'));
  check('code-reviewer reached Codex as TOML', taken[2].includes('developer_instructions = """'));
  same('taken in, they are On, and the two Adds, one soon after the other, are said once', [await switchOn(a, 'agents', 'code-reviewer'), await a.text('#header [data-outcome] .band-text')], [true, '2 agents are on: code-reviewer and release-notes.']);
  // Off takes the agent out of every harness. Central Knot keeps it: its row stays, off, with its description; On (here the
  // result's Undo) writes every harness's file back byte for byte, Claude Code's own fields included.
  await a.click(`#${rowPart('switch', 'agents', 'code-reviewer')}`);
  same('Off takes the agent out of every harness; its row stays where it was, in Central Knot only, with its description',
    [reviewerNow(), await switchState('code-reviewer'), /in Central Knot only/.test(await agentRow('code-reviewer') ?? ''), /Reviews a change/.test(await agentRow('code-reviewer') ?? ''), await sectionsNow(a, 'agents')],
    [[null, null, null], 'false', true, true, [['found', ['code-reviewer', 'release-notes']]]]);
  check('the result says Central Knot keeps it', /code-reviewer is off: no tool has it\. Central Knot keeps it/.test(await a.text('#header') ?? ''), (await a.text('#header') ?? '').slice(0, 300));
  await a.click('#outcome-undo');
  same('Undo turns it on again: every harness’s file is back byte for byte', reviewerNow(), taken);
  await agentCopiesUnderTheList(a, practice);
  await agentInPi(a, practice);
  // The opened row: each harness's line with what stays its own, and the agent's versions.
  await a.click(`#${rowPart('open', 'agents', 'code-reviewer')}`);
  check('the opened row says which settings stay Claude Code’s own', /Its own settings stay in its file: tools and model/.test(await a.text('.details') ?? ''), await a.text('.details'));
  same('and lists its versions, the current one marked, each saying what it changed', await versionsShown(), ['found in Claude Codefirst versionCurrent']);
  check('the opened row shows the whole description, and Delete from Central Knot says how it differs from Off',
    /Reviews a change for correctness and clarity before it is merged\./.test(await a.text('.details-description-whole') ?? '') && /Off keeps it here; Delete removes it from Central Knot\./.test(await a.text('.delete-offer') ?? ''), await a.text('.details'));
  await a.shot('practice-agents');
  // An edit made in a harness becomes the current version and reaches the others: an agent syncs both ways, whatever fields
  // its harnesses keep of their own.
  writeFileSync(codexAgent, taken[2].replace('description = "', 'description = "Edited in Codex. '));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && !readFileSync(claudeAgent, 'utf8').includes('Edited in Codex.'); tries++) await wait(100);
  check('an edit in Codex reaches Claude Code and Copilot CLI, and Claude Code keeps its own fields', reviewerNow().every(text => text.includes('Edited in Codex.')) && readFileSync(claudeAgent, 'utf8').includes('tools:'), readFileSync(claudeAgent, 'utf8'));
  check('its notice says the edit is the current version now, with Undo', /code-reviewer was edited in Codex; that is its current version now/.test(await a.text('main') ?? '') && await a.exists('[id^="notice-undo-"]'), (await a.text('main') ?? '').slice(0, 300));
  same('the versions list has both, the current one first, each saying what it changed', await versionsShown(), ['edited in Codexdescription changedCurrent', 'found in Claude Codefirst version']);
  // Read shows a version, marked against the current one; Make current applies an earlier one everywhere (main.ts passes the
  // click's `version` through).
  await a.click(`#${rowPart('version-read', 'agents', 'code-reviewer', '1')}`);
  for (let tries = 0; tries < 30 && !/You are a careful code reviewer/.test(await a.text('.version-read') ?? ''); tries++) await wait(100);
  check('Read shows the earlier version’s description and prompt under its line', /Reviews a change/.test(await a.text('.version-read-line') ?? '') && /You are a careful code reviewer/.test(await a.text('.version-read') ?? ''), await a.text('.version-read'));
  for (let tries = 0; tries < 30 && !(await a.exists('.version-read .change-gone')); tries++) await wait(100);
  same('and marks what differs from the current version: the words only the current one has are struck through', await a.all('.version-read .change-gone', 'e.textContent'), ['Edited in Codex.']);
  same('Read is headed by what differs from the current version', await a.text('.version-read-legend strong'), 'Differs from current in: description');
  check('the prompt reads upright', await a.run(`getComputedStyle(document.querySelector('.version-read-block')).fontStyle`) === 'normal');
  for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) {
    await sizeTo(a, width, height);
    same(`nothing is cut off at ${width}×${height} with an agent’s row open on its versions, one being read`, await a.run(CUT_OFF), []);
  }
  await fullSize(a);
  await a.click(`#${rowPart('version-current', 'agents', 'code-reviewer', '1')}`);
  for (let tries = 0; tries < 30 && readFileSync(codexAgent, 'utf8').includes('Edited in Codex.'); tries++) await wait(100);
  same('Make current writes the earlier version to every harness, each file as it was', reviewerNow(), taken);
  same('it is the current version, first, naming the one it went back to, into which that one is folded (one row per content)', [(await versionsShown()).length, /^back to: found in Claude Code, .*Current$/.test((await versionsShown())[0])], [2, true]);
  check('the result names the version and offers Undo', /code-reviewer: the version found in Claude Code, .* is current again, in all 3 tools/.test(await a.text('#header') ?? '') && await a.exists('#outcome-undo'), (await a.text('#header') ?? '').slice(0, 300));
  // A harness's own switch keeps the agent out of that harness alone; its Undo puts the same file back.
  await a.click(`#${rowPart('enable', 'agents', 'code-reviewer', 'codex-cli')}`);
  same('Codex’s own switch takes Codex’s copy out, leaves the others, and marks Codex as kept out, on the closed row too',
    [reviewerNow().map(text => text !== null), await cellState(a, 'agents', 'code-reviewer', 'codex-cli'), /kept out of Codex/.test(await agentRow('code-reviewer') ?? '')], [[true, true, false], 'kept-out', true]);
  await a.click('#outcome-undo');
  same('its Undo puts Codex’s file back as it was', reviewerNow(), taken);
  // Delete from Central Knot is the one real delete (main.ts passes the click's `deleted` through): out of every harness and
  // off the page. History restores it, every file as it was.
  const notesFiles = ['.claude/agents/release-notes.md', '.copilot/agents/release-notes.agent.md', '.codex/agents/release-notes.toml'].map(file => join(practice, file));
  const notesBefore = notesFiles.map(file => readFileSync(file, 'utf8'));
  await a.click(`#${rowPart('open', 'agents', 'release-notes')}`);
  await a.click(`#${rowPart('delete', 'agents', 'release-notes')}`);
  check('armed, it says History keeps it, with its versions, for History’s days', /History keeps it, with its versions, for 30 days, and can restore it\./.test(await a.text(`#${rowPart('delete-note', 'agents', 'release-notes')}`) ?? ''), await a.text(`#${rowPart('delete-note', 'agents', 'release-notes')}`));
  await a.click(`#${rowPart('delete-confirm', 'agents', 'release-notes')}`);
  same('Delete from Central Knot takes the agent out of every harness and off the page', [notesFiles.map(file => existsSync(file)), (await rowKeys(a, 'agents')).includes('release-notes')], [[false, false, false], false]);
  await a.click('#nav-history');
  const deletedRow = `[...document.querySelectorAll('.history-row[data-kind="deleted"]')].find(row => row.textContent.includes('release-notes'))`;
  same('History says it was deleted from Central Knot, and offers Restore', await a.run(`[${deletedRow}.querySelector('.history-about').textContent, ${deletedRow}.querySelector('.history-actions button').textContent]`),
    ['Deleted from Central Knot and removed from all 3 tools. History keeps it.', 'Restore']);
  // One more edit, so the Make current entry is no longer the latest: it offers to go back to the version before it.
  await a.click('#nav-agents');
  writeFileSync(codexAgent, taken[2].replace('description = "', 'description = "Edited again. '));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && !readFileSync(claudeAgent, 'utf8').includes('Edited again.'); tries++) await wait(100);
  await a.click('#nav-history');
  const currentRow = `[...document.querySelectorAll('.history-row[data-kind="current"]')].find(row => row.textContent.includes('code-reviewer'))`;
  same('an older Make current offers the short "Go back before this", the full sentence its tooltip', await a.run(`[${currentRow}?.querySelector('.history-actions button')?.textContent, ${currentRow}?.querySelector('.history-actions button')?.title]`),
    ['Go back before this', 'Make the version from before this change current again, in every tool it is on in']);
  const whens = await a.all('.history-when', 'e.textContent');
  check('every History row says its time in one form', whens.every(when => /\d:\d\d/.test(when)) || whens.every(when => /ago$|^just now$/.test(when)), whens);
  await a.run(`${deletedRow}.querySelector('.history-actions button').click()`);
  for (let tries = 0; tries < 30 && !notesFiles.every(file => existsSync(file)); tries++) await wait(100);
  same('Restore puts it back in every harness, each file as it was', notesFiles.map(file => (existsSync(file) ? readFileSync(file, 'utf8') : null)), notesBefore);
  await a.click('#nav-agents');
  same('and it is on its page again, on', [(await rowKeys(a, 'agents')).includes('release-notes'), await switchOn(a, 'agents', 'release-notes')], [true, true]);
  // A tool uninstalled and back (its folder taken away, then put back) is a tool managed again: Central Knot's version wins
  // there. Turned off while Codex was away, code-reviewer keeps its Codex copy there; edited meanwhile, that copy is kept as a
  // version ("was in Codex") and removed once Codex is back, and the current version stays.
  const openReviewer = async () => { if (await a.run(`document.querySelector('#${rowPart('open', 'agents', 'code-reviewer')}')?.getAttribute('aria-expanded')`) !== 'true') await a.click(`#${rowPart('open', 'agents', 'code-reviewer')}`); };
  await openReviewer();
  const reviewerHere = reviewerNow(), currentHere = (await versionsShown())[0];
  renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && await cellState(a, 'agents', 'code-reviewer', 'codex-cli') !== null; tries++) await wait(100);
  await a.click(`#${rowPart('switch', 'agents', 'code-reviewer')}`);
  for (let tries = 0; tries < 30 && existsSync(claudeAgent); tries++) await wait(100);
  const awayCopy = join(practice, '.codex-away/agents/code-reviewer.toml');
  writeFileSync(awayCopy, readFileSync(awayCopy, 'utf8').replace('description = "', 'description = "Edited while away. '));
  renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && existsSync(codexAgent); tries++) await wait(100);
  await openReviewer();
  same('a tool managed again: the Off agent’s copy edited there meanwhile is removed and kept as a version, and the current version stays',
    [reviewerNow(), await switchState('code-reviewer'), (await versionsShown())[0], (await versionsShown()).some(line => /^was in Codex/.test(line))], [[null, null, null], 'false', currentHere, true]);
  await a.click(`#${rowPart('switch', 'agents', 'code-reviewer')}`);
  for (let tries = 0; tries < 30 && !reviewerNow().every(text => text !== null); tries++) await wait(100);
  same('turned on again, every tool has its file back as it was', reviewerNow(), reviewerHere);
  await fitsAtMinimum(a, 'Agents');
  await a.click('#nav-skills');

  // A plugin that brings a skill and an agent both named review: two rows apart (itemrow.ts rowId). The skill's file shown on
  // Skills is not the agent's: on Agents, the agent's row opens with its file unshown, and shows its own. Then the plugin goes.
  // It brings a skill named like your own release-notes too: a row of its own, every element's id carrying its row's id.
  const installedRecord = readNow(join(practice, '.claude/plugins/installed_plugins.json'));
  writeClaudeInstall(practice, 'ck-outside', 'same-names', '0.1.0', {
    'skills/review/SKILL.md': '---\nname: review\ndescription: The skill named review.\n---\n\nThe skill’s steps.\n',
    'skills/release-notes/SKILL.md': '---\nname: release-notes\ndescription: The plugin’s release notes.\n---\n\nSteps.\n',
    'agents/review.md': '---\nname: review\ndescription: The agent named review.\n---\n\nThe agent’s prompt.\n',
  });
  await a.click('#header-refresh');
  const sameName = 'same-names@ck-outside/review', reviewEl = (part, kind) => byId(rowPart(part, kind, sameName)), fileShown = () => a.text('.plugin-file');
  for (let tries = 0; tries < 40 && !(await a.exists(reviewEl('open', 'skills'))); tries++) await wait(100);
  const yours = rowPart('', 'skills', 'release-notes'), theirs = rowPart('', 'skills', 'same-names@ck-outside/release-notes');
  same('a plugin’s skill named like your own release-notes is a row of its own, and no two elements on the page share an id',
    [await a.exists(`.ov-row[data-key="${yours}"]`), await a.exists(`.ov-row[data-key="${theirs}"]`),
      await sharedIds(a)], [true, true, []]);
  await a.click(reviewEl('open', 'skills'));
  await a.click(reviewEl('pfile', 'skills'));
  for (let tries = 0; tries < 40 && !(await fileShown())?.includes('The skill’s steps.'); tries++) await wait(100);
  check('a plugin’s skill named review shows its SKILL.md', (await fileShown())?.includes('The skill’s steps.'), await a.text('.details-plugin'));
  // The plugin updated while the file is shown: Refresh shows the file as installed now.
  writeClaudeInstall(practice, 'ck-outside', 'same-names', '0.2.0', {
    'skills/review/SKILL.md': '---\nname: review\ndescription: The skill named review.\n---\n\nThe skill’s steps, version two.\n',
    'agents/review.md': '---\nname: review\ndescription: The agent named review.\n---\n\nThe agent’s prompt.\n',
  });
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !(await fileShown())?.includes('version two'); tries++) await wait(100);
  check('its plugin updated while the file is shown, Refresh shows the file as installed now', (await fileShown())?.includes('The skill’s steps, version two.'), await fileShown());
  await a.click('#nav-agents');
  for (let tries = 0; tries < 40 && !(await a.exists(reviewEl('open', 'agents'))); tries++) await wait(100);
  await a.click(reviewEl('open', 'agents'));
  same('the agent of the same plugin named review opens with its own file unshown, not the skill’s', [await a.exists('.plugin-file'), await a.text(reviewEl('pfile', 'agents'))], [false, 'Show its agent file']);
  await a.click(reviewEl('pfile', 'agents'));
  for (let tries = 0; tries < 40 && !(await fileShown())?.includes('The agent’s prompt.'); tries++) await wait(100);
  check('and shows its own when asked', (await fileShown())?.includes('The agent’s prompt.') && !(await fileShown())?.includes('The skill’s steps.'), await fileShown());
  if (installedRecord) writeFileSync(join(practice, '.claude/plugins/installed_plugins.json'), installedRecord); else rmSync(join(practice, '.claude/plugins/installed_plugins.json'), { force: true });
  rmSync(join(practice, '.claude/plugins/cache/ck-outside/same-names'), { recursive: true, force: true });
  await a.click('#header-refresh');
  await a.click('#nav-skills');

  // What a plugin installed whole brings shows on Skills and MCP servers with the plugin's mark, before Plugins was ever
  // opened, from a marketplace nothing here has added: Claude Code's own record and copy are enough.
  writeClaudeInstall(practice, 'ck-outside', 'outside-tools', '0.3.0', {
    'skills/outside-skill/SKILL.md': '---\nname: outside-skill\ndescription: Comes with a plugin.\n---\n\nSteps.\n',
    'skills/outside-other/SKILL.md': '---\nname: outside-other\ndescription: Comes with it too.\n---\n\nSteps.\n',
    '.mcp.json': JSON.stringify({ mcpServers: { 'outside-server': { command: 'npx', args: ['-y', 'outside'] } } }),
  });
  await a.click('#header-refresh');
  const outside = 'outside-tools@ck-outside/outside-skill', outsideRow = `.ov-row[data-key="${rowPart('', 'skills', outside)}"]`;
  for (let tries = 0; tries < 40 && !(await a.exists(outsideRow)); tries++) await wait(100);
  same('a plugin’s skill is a row with its mark, filled under Claude Code, empty elsewhere, and a switch that is on',
    [/from outside-tools/.test(await a.text(outsideRow) ?? ''), await cellState(a, 'skills', outside, 'claude-cli'), await cellState(a, 'skills', outside, 'copilot-cli'), await switchOn(a, 'skills', outside), await a.exists('.ov-section-plugins')],
    [true, 'plugin', 'plugin-none', true, true]);
  // Claude Code has no switch for one skill of a plugin, so the row's switch turns the whole plugin there, with Claude Code's
  // own command (a stand-in here): said on the switch before the click, and in the result after it, with one Undo.
  const outsideSettings = readNow(join(practice, '.claude/settings.json')), outsideStub = join(HOME, '.local/bin/claude'), outsideStubBefore = readFileSync(outsideStub, 'utf8');
  writeFileSync(outsideStub, `#!/bin/sh\ncase "$*" in\n  "plugin disable outside-tools@ck-outside --scope user") printf '{"enabledPlugins":{"outside-tools@ck-outside":false}}' > "$HOME/.claude/settings.json" ;;\n  "plugin enable outside-tools@ck-outside --scope user") printf '%s' '${outsideSettings || '{}'}' > "$HOME/.claude/settings.json" ;;\n  *) exit 9 ;;\nesac\n`);
  const outsideOff = () => JSON.parse(readNow(join(practice, '.claude/settings.json')) || '{}').enabledPlugins?.['outside-tools@ck-outside'] === false;
  check('the row’s switch says first that in Claude Code it turns off everything outside-tools brings', (await a.run(`document.querySelector('${outsideRow} .switch').getAttribute('aria-label')`) ?? '')
    .endsWith('In Claude Code, which has no switch for one skill of a plugin, it turns off everything outside-tools brings there.'), await a.run(`document.querySelector('${outsideRow} .switch').getAttribute('aria-label')`));
  await a.click(`${outsideRow} .switch`);
  for (let tries = 0; tries < 60 && !(await a.exists('#outcome-undo-plugin')); tries++) await wait(100);
  check('one click turns the whole plugin off in Claude Code, and the result names what went with it', outsideOff() && !(await switchOn(a, 'skills', outside)) && !(await a.exists('#outcome-whole'))
    && /outside-skill is off in Claude Code\. Its whole plugin outside-tools was turned off in Claude Code, with its 1 other skill and 1 MCP server\./.test(await a.text('#header') ?? ''), [await a.text('#header'), readNow(join(practice, '.claude/settings.json'))]);
  const other = 'outside-tools@ck-outside/outside-other';
  same('and the plugin’s other skill’s row says it is off in Claude Code too', [await cellState(a, 'skills', other, 'claude-cli'), await switchOn(a, 'skills', other)], ['plugin-off', false]);
  // The rows drawn flashing from here on (their class, which a system's reduced motion doesn't take away as it does the animation).
  await a.run(`window.flashedRows = []; window.flashWatch = new MutationObserver(() => { for (const row of document.querySelectorAll('.ov-row.row-flash')) if (!flashedRows.includes(row.dataset.key)) flashedRows.push(row.dataset.key); }); flashWatch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })`);
  await a.click('#outcome-undo-plugin');
  for (let tries = 0; tries < 60 && (outsideOff() || !/Undone: outside-skill/.test(await a.text('#header') ?? '')); tries++) await wait(100);
  check('its Undo flashes the plugin’s row on the page', (await a.run('window.flashedRows')).includes(rowPart('', 'skills', outside)), await a.run('window.flashedRows'));
  await a.run('window.flashWatch.disconnect()');
  check('its one Undo turns the plugin back on there', !outsideOff() && await switchOn(a, 'skills', outside) && /Undone: outside-skill is back on in Claude Code\./.test(await a.text('#header') ?? ''), [await a.text('#header'), readNow(join(practice, '.claude/settings.json'))]);
  // Two of its skills turned off 150 ms apart (clip 04), the second while the first still runs (Claude Code's stand-in takes a
  // second to disable it): the first takes the whole plugin off in Claude Code; the second, worked out in its turn, finds nothing
  // left to change there, so it neither fails nor turns the plugin back on; the run's one Undo puts it back.
  writeFileSync(outsideStub, readFileSync(outsideStub, 'utf8').replace('--scope user") printf', '--scope user") sleep 1; printf'));
  await a.run(`document.querySelector('${outsideRow} .switch').click()`); await wait(150);
  await a.run(`document.querySelector('.ov-row[data-key="${rowPart('', 'skills', other)}"] .switch').click()`);
  await a.settle();
  same('two skills of one plugin turned off 150 ms apart: the plugin is off in Claude Code, neither click fails, and the header says both and what went with the first',
    [outsideOff(), await switchOn(a, 'skills', outside), await switchOn(a, 'skills', other), await a.exists('#header .problem-line'), await a.text('#header [data-outcome] .band-text')],
    [true, false, false, false, '2 skills are off: outside-skill and outside-other. outside-skill: its whole plugin outside-tools was turned off in Claude Code, with its 1 other skill and 1 MCP server.']);
  await a.click('#outcome-undo');
  check('and the run’s one Undo turns the plugin back on there', !outsideOff() && await switchOn(a, 'skills', outside), await a.text('#header'));
  await a.run(`document.querySelector('#outcome-dismiss')?.click()`);
  const rowSwitch = key => `document.querySelector('.ov-row[data-key="${rowPart('', 'skills', key)}"] .switch').click()`, headerText = () => a.text('#header .header-result');
  // A plugin's row clicked again while its first click runs (the stand-in's second): the second click is taken, from the state the
  // row is drawn in, and the row ends as it says.
  await a.run(rowSwitch(outside)); await wait(150); await a.run(rowSwitch(outside));
  await a.settle();
  same('a plugin’s row clicked again while its click runs ends as the second click says: the plugin is on again, and nothing is called on already',
    [outsideOff(), await switchOn(a, 'skills', outside), /already/.test(await headerText() ?? '')], [false, true, false]);
  await a.run(`document.querySelector('#outcome-dismiss')?.click()`);
  // One run: outside-skill Off (its whole plugin off), then, drawn Off once that ended, outside-other On (the plugin on again).
  // Each row is said as the run left it, and the run's one Undo takes the clicks back newest first: the plugin is on, as before.
  await a.run(rowSwitch(outside));
  for (let tries = 0; tries < 60 && await switchOn(a, 'skills', other); tries++) await wait(100);
  await a.run(rowSwitch(other));
  await a.settle();
  const bothOn = /^2 skills are on: outside-skill and outside-other\./.test(await a.text('#header [data-outcome] .band-text') ?? '');
  await a.click('#outcome-undo');
  same('Off then On in one run: both rows said on, as the run left them, and its Undo leaves the plugin on, as before the run', [bothOn, outsideOff(), await switchOn(a, 'skills', outside)], [true, false, true]);
  await a.run(`document.querySelector('#outcome-dismiss')?.click()`);
  // One run where the plugin's click fails (Claude Code refuses to disable it) and release-notes' Off works: the failure is said as
  // one, not counted among those done, and the run's one Undo takes back release-notes.
  writeFileSync(outsideStub, readFileSync(outsideStub, 'utf8').replace('--scope user") sleep 1; printf', '--scope user") echo "Error: refused" >&2; exit 1; printf'));
  const notesOnBefore = await switchOn(a, 'skills', 'release-notes');
  await a.run(rowSwitch(outside)); await wait(150); await a.run(`document.getElementById('${rowPart('switch', 'skills', 'release-notes')}').click()`);
  await a.settle();
  const failedSaid = [await a.text('#header [data-outcome] .band-text'), await a.exists('#outcome-undo'), await switchOn(a, 'skills', outside), await a.exists('#header .problem-line')];
  await a.click('#outcome-undo');
  same('a plugin’s click that fails among others: not counted, said as a problem, and the run keeps its Undo, which turns release-notes back on',
    [notesOnBefore, ...failedSaid, await switchOn(a, 'skills', 'release-notes'), outsideOff()], [true, '1 skill is off: release-notes.', true, true, true, true, false]);
  await a.run(`document.querySelector('#outcome-dismiss')?.click()`);
  writeFileSync(outsideStub, outsideStubBefore);
  if (outsideSettings) writeFileSync(join(practice, '.claude/settings.json'), outsideSettings); else rmSync(join(practice, '.claude/settings.json'), { force: true });
  await a.click(byId(rowPart('open', 'skills', outside)));
  check('its details open with where it is on and which plugin it is from, then where it is handled', /On in Claude Code · from the plugin outside-tools[\s\S]*marketplace “ck-outside”, which isn’t added in Central Knot/.test(await a.text('main') ?? ''), await a.text('main'));
  await a.click('#nav-mcp');
  same('its MCP server too, on the MCP servers page', await cellState(a, 'mcp', 'outside-tools@ck-outside/outside-server', 'claude-cli'), 'plugin');
  rmSync(join(practice, '.claude/plugins'), { recursive: true, force: true });
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && await a.exists(`[data-key="${rowPart('', 'mcp', 'outside-tools@ck-outside/outside-server')}"]`); tries++) await wait(100);
  check('and gone once the plugin is', !(await a.exists(`[data-key="${rowPart('', 'mcp', 'outside-tools@ck-outside/outside-server')}"]`)));
  await a.click('#nav-skills');

  // Plugins: a folder marketplace is browsed (its README, each plugin's contents) and installs are chosen, then applied.
  const market = join(scratch, 'market');
  writeMarket(market, 'ck-test-market');
  // Claude Code has an older issue-tracker (1.9.0, its triage skill worded differently); the marketplace offers 2.0.0.
  writeClaudeInstall(practice, 'ck-test-market', 'issue-tracker', '1.9.0', {
    'skills/triage/SKILL.md': '---\nname: triage\ndescription: Sorts new issues.\n---\n\nThe old steps.\n',
    'skills/old-triage/SKILL.md': '---\nname: old-triage\ndescription: Dropped in 2.0.0.\n---\n',
  });
  await a.click('#nav-plugins');
  // Every plugin click below acts at once: nothing on these pages waits for a later click, so none of these ever shows.
  await a.run(`window.ckWaiting = []; new MutationObserver(() => { for (const e of document.querySelectorAll('#plugins-apply, #plugins-discard, .skill-switch-chosen')) window.ckWaiting.push(e.id || e.className); }).observe(document.body, { subtree: true, childList: true, attributes: true }); true`);
  check('no marketplaces yet', (await a.text('#plugins-scroll')).includes('No marketplaces yet'));
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(market)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
  check('the marketplace is listed and opened, with its plugins', (await a.text('.market-list')).includes('ck-test-market') && await a.exists('[data-plugin="document-tools"]') && (await a.text('.market-title-line')).includes('By Platform team'), await a.text('#plugins-scroll'));
  await a.send('Emulation.setDeviceMetricsOverride', { width: SMALLEST[0], height: SMALLEST[1], deviceScaleFactor: 1, mobile: false });
  // Scrolled just past the header's own place, it stays flush with the scroller's top while the first row passes under it.
  // The scroller is held short for the measurement, so the five-plugin fixture scrolls far enough at any layout.
  const pinned = await a.run(`(() => {
    const box = document.querySelector('#plugins-scroll'), head = document.querySelector('.plugin-table .ov-head'), top = () => box.getBoundingClientRect().top;
    const style = box.style.cssText;
    box.style.flex = 'none'; box.style.height = '160px';
    box.scrollTop = head.getBoundingClientRect().top - top() + 20;
    const gap = Math.round(head.getBoundingClientRect().top - top()), rowUnder = document.querySelector('.plugin-row').getBoundingClientRect().top < head.getBoundingClientRect().bottom;
    box.scrollTop = 0; box.style.cssText = style;
    return { gap, rowUnder };
  })()`);
  same('scrolled at 860×560, the plugin column header pins flush to the top, with no rows showing above it', pinned, { gap: 0, rowUnder: true });
  await a.send('Emulation.clearDeviceMetricsOverride');
  check('a root-level entry counts only the skills it lists', (await a.text('[data-plugin="starter-skills"]')).includes('1 skill'), await a.text('[data-plugin="starter-skills"]'));
  // Read ahead from its own repository when the network allows: what it holds; otherwise where it comes from.
  check('a plugin elsewhere says what it holds, that it is reading it, or where it comes from', /From GitHub: github\/copilot-plugins\/plugins\/spark|Reading what it holds…|\d+ skills?/.test(await a.text('[data-plugin="spark"]')), await a.text('[data-plugin="spark"]'));
  same('every tool column shows, none installed', await a.run(`[...document.querySelectorAll('[data-plugin="document-tools"] .cell-button')].map(cell => cell.dataset.state)`), ['absent', 'absent', 'absent']);
  // A tool that goes away while Plugins is open leaves its column on Refresh, and comes back with its folder.
  const codexKept = join(scratch, 'codex-kept');
  cpSync(join(practice, '.codex'), codexKept, { recursive: true });
  renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && (await a.all('[data-plugin="document-tools"] .cell-button')).length !== 2; tries++) await wait(100);
  same('Refresh on Plugins drops a tool that went away', (await a.all('[data-plugin="document-tools"] .cell-button')).length, 2);
  // It comes back as a new folder while Automatic sync is off, and nothing else changes: no folder being watched sees it,
  // so the background poll alone (no Refresh, no file event) finds the tool, and Plugins follows.
  await a.click('#sync-switch');
  same('Automatic sync is off', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'false');
  // Passes still due from the folder going away (a deletion's settle window) run out first, so only a later pass can find it.
  await wait(5000);
  cpSync(codexKept, join(practice, '.codex'), { recursive: true });
  const polled = Date.now();
  for (let tries = 0; tries < 300 && (await a.all('[data-plugin="document-tools"] .cell-button')).length !== 3; tries++) await wait(100);
  same('with sync off, the background poll brings its column back on Plugins', (await a.all('[data-plugin="document-tools"] .cell-button')).length, 3);
  console.log(`(the poll found Codex after ${Math.round((Date.now() - polled) / 1000)} s)`);
  rmSync(join(practice, '.codex-away'), { recursive: true, force: true });
  await a.click('#sync-switch');
  // A tool change told while the page is busy (here, a Refresh reading the home slowly) is kept, and read once the work is
  // done, with no second Refresh.
  if (main) {
    const columns = async () => (await a.all('[data-plugin="document-tools"] .cell-button')).length;
    await main.manualSyncOnly(true);
    check('the refresh reply is held while the page is busy', await main.holdRefresh('asked'));
    await a.run(`document.getElementById('header-refresh').click()`);
    await waitFor('the Refresh that still includes Codex', main.refreshHeld);
    const busyThen = await a.run(`document.body.dataset.busy`);
    renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
    await tellOfChange();
    await main.releaseRefresh();
    await waitFor('the Plugins read with Codex gone', async () => await columns() === 2);
    same('a tool change told while the page is busy is read once the work is done', [busyThen, await columns()], ['true', 2]);
    renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
    await a.click('#header-refresh');
    for (let tries = 0; tries < 30 && (await columns()) !== 3; tries++) await wait(100);
    // Two tool changes told back to back, on Skills (whose marks are the home's tools): the first read sees Codex gone,
    // and the second change (Codex back) arrives while that read is still on its way. It is owed, and read as soon as the
    // first ends, so the page ends right.
    await a.click('#nav-skills');
    const marks = `[data-key="${rowPart('', 'skills', 'notes')}"] .tool-marks`;
    const heads = () => a.all(`${marks} > [data-tool]`, 'e.dataset.tool');
    const all = (await heads()).length;
    check('the first refresh reply is held', await main.holdRefresh("!asked && !view.sync.present.includes('codex-cli')"));
    renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
    await tellOfChange();
    await waitFor('the first reply with Codex gone', main.refreshHeld);
    renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
    await tellOfChange();
    // Both draws may land between driver reads. Record the marks where they change, in the renderer.
    await a.run(`window.ckMarkCounts = []; window.ckMarks = new MutationObserver(() => {
      const count = document.querySelector(${JSON.stringify(marks)})?.children.length;
      if (window.ckMarkCounts.at(-1) !== count) window.ckMarkCounts.push(count);
    }); window.ckMarks.observe(document.getElementById('page'), { childList: true });`);
    await main.releaseRefresh();
    await waitFor('the two Skills draws', () => a.run(`window.ckMarkCounts.includes(${all - 1}) && window.ckMarkCounts.at(-1) === ${all}`));
    const counts = await a.run(`window.ckMarks.disconnect(); window.ckMarkCounts.slice(window.ckMarkCounts.indexOf(${all - 1}))`);
    same('two tool changes told back to back: the first read shows, then the second', counts, [all - 1, all]);
    await main.manualSyncOnly(false);
    // Nothing is left owed: a later action's result stays. A found skill is visible evidence of a fresh
    // background view, with no sync notice of its own to replace the announcement.
    const quietRead = async key => {
      const marker = skill(claudeSkills, key);
      try {
        await tellOfChange();
        await waitFor(`Skills to show ${key}`, () => a.exists(byId(rowPart('add', 'skills', key))));
      } finally { rmSync(marker, { recursive: true }); }
    };
    await a.click('#header-refresh');
    const result = await a.text('#announcement');
    await quietRead('after-refresh');
    same('and a later result stays said', [await a.text('#announcement'), (await heads()).length], [result, all]);
    check('that result says what was read', /^Read \d/.test(result ?? ''), result);
    // A sync:changed right after an action keeps that action's message: the read it starts brings no new notice.
    await a.click('#nav-skills');
    await a.click(byId(rowPart('switch', 'skills', 'notes')));
    const switched = await a.run(`document.querySelector('#announcement').dataset.text`);
    await quietRead('after-switch');
    same('a sync:changed right after an action keeps its message', [await a.run(`document.querySelector('#announcement').dataset.text`), /^notes is off: no tool has it/.test(switched ?? '')], [switched, true]);
    await a.click('#outcome-undo');
    // A tool that appears is noticed by whichever read sees it first. Opening Plugins before the poll reads the home for
    // its columns, and the page as a whole hears of the new tool: Skills gets its column too, with no Refresh.
    await a.click('#nav-skills');
    renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
    await a.click('#header-refresh');
    for (let tries = 0; tries < 40 && (await heads()).length !== all - 1; tries++) await wait(100);
    const without = (await heads()).length;
    check('the marketplace request is watched', await main.noteTells('plugins:view'));
    renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
    const back = Date.now();
    await a.click('#nav-plugins');
    for (let tries = 0; tries < 50 && (await columns()) !== 3; tries++) await wait(100);
    const pluginColumns = await columns();
    await main.restore('plugins:view');
    same('and plugins:view was the read that told the page', await main.told(), [true]);
    await a.click('#nav-skills');
    for (let tries = 0; tries < 50 && (await heads()).length !== all; tries++) await wait(100);
    same('opening Plugins first: its columns and then Skills follow the tool that came back', [without, pluginColumns, (await heads()).length], [all - 1, 3, all]);
    console.log(`(Skills followed the returned tool after ${Math.round((Date.now() - back) / 100) / 10} s)`);
    // After a home switch, History says it is reading while it reads (never that it couldn't), then shows what it read.
    await a.click('#nav-history');
    check('the History request is slowed', await main.slowRequest('history:list', 1500));
    await a.run(`(document.querySelector('#home-fixture').click(), true)`);
    for (let tries = 0; tries < 40 && await a.run(`document.body.dataset.busy`) === 'true'; tries++) await wait(50);
    const whileReading = await a.text('#page');
    await main.restore('history:list');
    for (let tries = 0; tries < 60 && !(await a.exists('.history-row')); tries++) await wait(100);
    check('after a home switch History says it is reading, then shows its rows', /Reading History…/.test(whileReading ?? '') && !/could not be read/.test(whileReading ?? '') && await a.exists('.history-row'), whileReading);
    // A read again that fails keeps the last read on screen, and says so.
    check('the History request is made to fail', await main.failRequest('history:list'));
    await a.click('#nav-history');
    for (let tries = 0; tries < 30 && !(await a.exists('.reread-failed')); tries++) await wait(100);
    const failedAgain = [await a.exists('.history-row'), await a.text('.reread-failed')];
    await main.restore('history:list');
    same('a failed read again keeps the last read and says so', failedAgain, [true, 'Could not read again; showing the last read.']);
    await a.click('#nav-history');
    for (let tries = 0; tries < 30 && await a.exists('.reread-failed'); tries++) await wait(100);
    check('and a read that works again clears it', !(await a.exists('.reread-failed')));
    // Plugins after Refresh: while the marketplaces are read again, the last read stays with a quiet band saying so.
    await a.click('#nav-plugins');
    for (let tries = 0; tries < 30 && !(await a.exists('[data-plugin="document-tools"]')); tries++) await wait(100);
    check('the marketplace request is slowed', await main.slowRequest('plugins:view', 2000));
    await a.click('#header-refresh');
    const rereading = [await a.exists('.rereading'), await a.exists('[data-plugin="document-tools"]')];
    await main.restore('plugins:view');
    for (let tries = 0; tries < 50 && await a.exists('.rereading'); tries++) await wait(100);
    same('Plugins says it is reading again, keeping what it showed, until the read is done', [...rereading, await a.exists('.rereading')], [true, true, false]);
    // Refresh on Harnesses (which only counts installs) reads the marketplaces as last read; Plugins' own Refresh fetches them anew.
    check('the marketplace request is noted', await main.noteCalls('plugins:view'));
    await a.click('#nav-harnesses');
    for (let tries = 0; tries < 50 && (await main.calls()).length < 1; tries++) await wait(100);
    await a.click('#header-refresh');
    for (let tries = 0; tries < 50 && (await main.calls()).length < 2; tries++) await wait(100);
    const onHarnesses = await main.calls();
    await a.click('#nav-plugins');
    await a.click('#header-refresh');
    for (let tries = 0; tries < 50 && !(await main.calls()).some(([fresh]) => fresh === true); tries++) await wait(100);
    const onPlugins = (await main.calls()).slice(onHarnesses.length);
    await main.restore('plugins:view');
    for (let tries = 0; tries < 50 && (await a.exists('.rereading') || !(await a.exists('[data-plugin="document-tools"]'))); tries++) await wait(100);
    same('Refresh on Harnesses reads the marketplaces as last read; Refresh on Plugins, anew', [onHarnesses.length, onHarnesses.some(([fresh]) => fresh === true), onPlugins.some(([fresh]) => fresh === true)], [2, false, true]);
  }
  // A Refresh that fails says so and stays said: the page's own read does not run after it and clear the message.
  if (main) {
    check('the refresh request is made to fail', await main.failRequest('discovery:refresh'));
    await a.click('#header-refresh');
    const said = await a.text('#announcement');
    await main.restore('discovery:refresh');
    check('a failed Refresh keeps its message, and Plugins what it showed', /could not finish/.test(said ?? '') && await a.exists('[data-plugin="document-tools"]'), said);
  }
  await a.click('#market-tab-about');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-readme-body')); tries++) await wait(100);
  check('About shows the README, with its HTML dropped and its link kept', (await a.text('.plugin-readme-body')).includes('What is inside') && !(await a.text('.plugin-readme-body')).includes('<p') && await a.exists('.plugin-readme-body .md-link'), await a.text('.plugin-readme-body'));
  await a.click('#market-tab-plugins');
  check('a row shows the version offered, and a tool that has another', /2\.0\.0/.test(await a.text('[data-plugin="issue-tracker"] .plugin-row-version')) && /Claude Code has\s1\.9\.0/.test(await a.text('[data-plugin="issue-tracker"] .plugin-version-differs')), await a.text('[data-plugin="issue-tracker"]'));
  await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 30 && !(await a.exists('#pfile-0-skills-triage')); tries++) await wait(100);
  check('the plugin page says which version Claude Code has', /Installed · 1\.9\.0\s*Marketplace has 2\.0\.0/.test(await a.text('.plugin-panel')), await a.text('.plugin-panel'));
  check('a skill only an installed copy has says where it is', (await a.text('#pfile-0-skills-old-triage')).includes('Only in Claude Code (1.9.0)'), await a.text('.plugin-page'));
  check('a closed skill row names the tool whose copy differs', (await a.text('#pfile-0-skills-triage')).includes('Claude Code (1.9.0) differs from the marketplace’s copy'), await a.text('#pfile-0-skills-triage'));
  await a.click('#pfile-0-skills-triage');
  same('a skill opens its SKILL.md as written, one block per version that differs', await a.all('.plugin-file .content-block', '[e.querySelector(".content-owner")?.textContent, e.querySelector("pre").textContent]'),
    [['SKILL.md · Marketplace (2.0.0)', readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8')], ['SKILL.md · Claude Code (1.9.0)', '---\nname: triage\ndescription: Sorts new issues.\n---\n\nThe old steps.\n']]);
  // Update: Claude Code's 1.9.0 is behind, so its box and one button offer the update; the click runs Claude Code's own
  // `plugin update` at once (a stand-in that moves its record to 2.0.0), and the page reads the new version back from that record.
  same('an out-of-date copy offers Update, for every tool behind, saying before the click that it can’t be undone', [await a.run(`document.querySelector('#pbox-0-issue-tracker-claude-cli')?.dataset.state`), await a.text('#pupdate-0-issue-tracker'), await a.run(`document.querySelector('#pupdate-0-issue-tracker').title`)],
    ['outdated', 'Update in Claude Code', 'Updates it in Claude Code now. An update can’t be undone.']);
  const claudeStub = join(HOME, '.local/bin/claude'), stubBefore = readFileSync(claudeStub, 'utf8');
  const newCopy = join(practice, '.claude/plugins/cache/ck-test-market/issue-tracker/2.0.0');
  writeFileSync(claudeStub, `#!/bin/sh\n[ "$*" = "plugin update issue-tracker@ck-test-market --scope user" ] || exit 9\nmkdir -p '${newCopy}/skills/triage' && cp '${join(market, 'plugins/issue-tracker/skills/triage/SKILL.md')}' '${newCopy}/skills/triage/'\nprintf '{"version":2,"plugins":{"issue-tracker@ck-test-market":[{"scope":"user","installPath":"${newCopy}","version":"2.0.0"}]}}' > "$HOME/.claude/plugins/installed_plugins.json"\necho 'Plugin "issue-tracker" updated from 1.9.0 to 2.0.0 for scope user.'\n`);
  await a.click('#pupdate-0-issue-tracker');
  for (let tries = 0; tries < 30 && !/Installed · 2\.0\.0/.test(await a.text('.plugin-panel') ?? ''); tries++) await wait(100);
  check('the click updates it at once, read back from Claude Code’s record, says it can’t be undone, and offers no Undo', /Installed · 2\.0\.0/.test(await a.text('.plugin-panel') ?? '') && !/Marketplace has/.test(await a.text('.plugin-panel') ?? '')
    && /updated to 2\.0\.0 in Claude Code, which can’t be undone/i.test(await a.run(`document.querySelector('#announcement')?.dataset.text ?? ''`)) && !(await a.exists('#plugins-undo')), [await a.text('.plugin-panel'), await a.run(`document.querySelector('#announcement')?.dataset.text`), await a.text('.bands')]);
  // The copy changes at the same version (2.0.0): once read again, the page says so and offers Update. Claude Code's own
  // update keeps its copy ("already at the latest"), so Update uninstalls and installs it again, and compares after.
  const triage = join(newCopy, 'skills/triage/SKILL.md'), record = readFileSync(join(practice, '.claude/plugins/installed_plugins.json'), 'utf8');
  writeFileSync(triage, readFileSync(triage, 'utf8') + '\nA line added by hand.\n');
  writeFileSync(claudeStub, `#!/bin/sh\ncase "$*" in\n  "plugin update issue-tracker@ck-test-market --scope user") echo 'issue-tracker is already at the latest version (2.0.0).' ;;\n  "plugin uninstall issue-tracker@ck-test-market --scope user") printf '{"version":2,"plugins":{}}' > "$HOME/.claude/plugins/installed_plugins.json" ;;\n  "plugin install issue-tracker@ck-test-market --scope user") cp '${join(market, 'plugins/issue-tracker/skills/triage/SKILL.md')}' '${triage}' && printf '%s' '${record}' > "$HOME/.claude/plugins/installed_plugins.json" ;;\n  *) exit 9 ;;\nesac\n`);
  await a.click('#nav-skills');
  await a.click('#nav-plugins');
  if (!(await a.exists('#pfile-0-skills-triage'))) await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 30 && !/differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? ''); tries++) await wait(100);
  same('a copy that differs at the same version says so and offers Update', [/Installed · 2\.0\.0 · differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? ''), await a.run(`document.querySelector('#pbox-0-issue-tracker-claude-cli')?.dataset.state`), await a.text('#pupdate-0-issue-tracker')], [true, 'outdated', 'Update in Claude Code']);
  await a.click('#pupdate-0-issue-tracker');
  for (let tries = 0; tries < 30 && /differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? 'differs from the marketplace’s copy'); tries++) await wait(100);
  check('Update reinstalls it where Claude Code keeps its copy, and the result says so', !/differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? '') && readFileSync(triage, 'utf8') === readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8')
    && /reinstalled from the marketplace’s copy of 2\.0\.0 in Claude Code/i.test(await a.run(`document.querySelector('#announcement')?.dataset.text ?? ''`)), [await a.text('.plugin-panel'), await a.run(`document.querySelector('#announcement')?.dataset.text`)]);
  writeFileSync(claudeStub, stubBefore);
  // Claude Code lets it go outside the app; coming back to Plugins reads the install states, and the copies, again.
  writeFileSync(join(practice, '.claude/plugins/installed_plugins.json'), '{"version":2,"plugins":{}}');
  await a.click('#nav-skills');
  await a.click('#nav-plugins');
  if (!(await a.exists('#pfile-0-skills-triage'))) await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 30 && /1\.9\.0/.test(await a.text('.plugin-page') ?? '1.9.0'); tries++) await wait(100);
  check('a copy a tool no longer has is gone from the page', !/1\.9\.0/.test(await a.text('.plugin-page')) && /not installed/i.test(await a.text('.plugin-panel')), await a.text('.plugin-page'));
  // The marketplace moves issue-tracker on; after Refresh its row offers the new version, not one read before.
  writeFileSync(join(market, '.claude-plugin/marketplace.json'), readFileSync(join(market, '.claude-plugin/marketplace.json'), 'utf8').replace('"version": "2.0.0"', '"version": "2.1.0"'));
  await a.click('#plugin-back');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && !/2\.1\.0/.test(await a.text('[data-plugin="issue-tracker"] .plugin-row-version') ?? ''); tries++) await wait(100);
  check('after Refresh a row offers the marketplace’s new version', (await a.text('[data-plugin="issue-tracker"] .plugin-row-version')) === '2.1.0', await a.text('[data-plugin="issue-tracker"]'));
  await a.click('#popen-0-issue-tracker');
  await a.click('#plugin-back');
  await a.click('#popen-0-release-helper');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-group')); tries++) await wait(100);
  check('a plugin page names what it holds', /release-notes[\s\S]*Drafts release notes/.test(await a.text('.plugin-page')) && (await a.text('.plugin-page')).includes('release-reviewer') && /Other hooks \(1\)\s*PreToolUse\s*echo checked/.test(await a.text('.plugin-page')), await a.text('.plugin-page'));
  // Its AGENTS.md is listed, with the line that no tool reads it, and opens to its text; its start-of-session hooks are a group of
  // their own, a row per command (the second with its arguments), apart from its other hooks; "In each tool" says what reaches
  // each tool's sessions.
  const holds = await a.text('.plugin-page');
  check('a plugin’s instruction file is listed and said to be read by no tool; a hook that can add text to sessions shows what it runs, apart from the rest',
    /Instruction files \(1\)\s*No tool reads a plugin’s own instruction file into a session\. The model sees it only when something tells it to read the file, such as one of the plugin’s skills\.\s*AGENTS\.md/.test(holds)
    && /Hooks that can add text to sessions \(2\)\s*These run when a session starts or you send a prompt \(in Codex, once you trust them\); what they add is known only when they run\.\s*SessionStart\s*echo '\{"hookSpecificOutput"[^]*?SessionStart\s*node \$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/remind\.mjs --days 2/.test(holds)
    && /Other hooks \(1\)\s*PreToolUse\s*echo checked/.test(holds) && /Session text\s*(comes from|is limited|waits for trust)/.test(holds), holds);
  // It holds more than its instruction file, so its panel doesn't say that installing it won't make the tools read its files.
  check('a plugin holding more than instruction files has no line saying installing it won’t make your tools read them', !(await a.exists('#plugin-only-instructions')), await a.text('.plugin-panel'));
  await a.click('#pfile-0-AGENTS-md');
  check('and the instruction file opens to its text, as the marketplace has it', /Instruction file · Marketplace[\s\S]*Notes for whoever works on this plugin/.test(await a.text('.plugin-page')), await a.text('.plugin-page'));
  await a.click('#plugin-back');
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-readme')); tries++) await wait(100);
  check('and shows the plugin’s own README and skill descriptions', (await a.text('.plugin-page')).includes('Two skills for everyday documents') && (await a.text('.plugin-page')).includes('Reads PDF files'), await a.text('.plugin-page'));
  // A description cut at two lines offers Show more; a width change with the page open, and no redraw, measures it again.
  // Narrower than any window here, with the sidebar open, so the description is held to its two lines; then wide enough
  // for it, still below the sidebar's and the dock's breakpoints, so nothing redraws the page.
  const pdfCut = () => a.run(`(() => { const li = [...document.querySelectorAll('.plugin-parts li')].find(li => li.textContent.includes('pdf-reader')); const what = li?.querySelector('.plugin-part-what'); return [li?.classList.contains('clamped') ?? null, what?.clientWidth]; })()`);
  // The description is measured again once it is laid out at the new width: waited for, each way.
  await sizeTo(a, 720, 560); await a.click('#sidebar-toggle');
  for (let tries = 0; tries < 30 && (await pdfCut())[0] !== true; tries++) await wait(100);
  const narrow = await pdfCut();
  await sizeTo(a, 960, 560);
  for (let tries = 0; tries < 30 && (await pdfCut())[0] !== false; tries++) await wait(100);
  const wide = await pdfCut();
  same('Show more follows the description’s width with the same plugin open', [narrow[0], wide[0]], [true, false]);
  if (narrow[0] !== true || wide[0] !== false) console.error('description widths', narrow[1], wide[1]);
  await a.click('#sidebar-toggle'); await fullSize(a);
  // The plugin's switch acts at once: On asks each tool's own installer (stand-ins here whose own add fails, saying nothing of the
  // marketplace: no refusal to keep). Each tool's box is then empty, and a tick tries again.
  await a.click('#pswitch-page-0-document-tools');
  for (let tries = 0; tries < 60 && !(await a.exists('.plugin-problems')); tries++) await wait(100);
  check('a marketplace add that failed is said as it was, in the tool’s words, and not kept as a refusal', /Could not add the marketplace\. It stopped with exit code 9/.test(await a.text('.plugin-problems')), await a.text('.bands'));
  same('and nothing is claimed installed: the switch is on, and each tool’s box is empty, a tick trying again',
    [await a.run(`document.querySelector('#pswitch-page-0-document-tools')?.getAttribute('aria-checked')`), await a.run(`[...document.querySelectorAll('.plugin-tool .cell-box')].map(box => [box.dataset.state, box.getAttribute('aria-checked'), box.disabled])`),
      /^Not in Claude Code, though the plugin is on\. Click to put document-tools in Claude Code\./.test(await a.run(`document.querySelector('#pbox-0-document-tools-claude-cli')?.title`) ?? '')],
    ['true', [['missing', 'false', false], ['missing', 'false', false], ['missing', 'false', false]], true]);
  await a.shot('practice-plugins');
  await fitsAtMinimum(a, 'a plugin page whose install didn’t finish, each tool’s box empty');
  await a.click('#plugin-back');
  await fitsAtMinimum(a, 'the plugin table with its switches, one on and in no tool');
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-readme')); tries++) await wait(100);
  // Plugin parts an earlier version put into Pi become items linked to their plugin at one look (partsmigrate.ts): issue-tracker's
  // skill triage and MCP server issues.
  mkdirSync(join(practice, '.pi/agent/skills'), { recursive: true });
  await writeOldParts(practice, market, 'ck-test-market', 'issue-tracker', 'pi-cli', { skills: { triage: {} }, servers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp'] } } });
  const partsRecord = readFileSync(join(practice, '.central-knot/plugin-parts.json'), 'utf8');
  await a.click('#nav-skills');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && existsSync(join(practice, '.central-knot/plugin-parts.json')); tries++) await wait(100);
  same('after one look the parts record is moved aside, as it was', [existsSync(join(practice, '.central-knot/plugin-parts.json')), readNow(join(practice, '.central-knot/plugin-parts.v1.json'))], [false, partsRecord]);
  check('Skills shows triage from the plugin, in Pi', /from the plugin issue-tracker/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'triage')}"]`) ?? '') && await cellState(a, 'skills', 'triage', 'pi-cli') === 'current', await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'triage')}"]`));
  await a.click('#nav-plugins');
  if (await a.exists('#plugin-back')) await a.click('#plugin-back');
  await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 50 && !/Its items/.test(await a.text('.plugin-page') ?? ''); tries++) await wait(100);
  check('issue-tracker’s page lists its items, recorded by the move', /Its items[\s\S]*skill triage[\s\S]*MCP server issues/.test(await a.text('.plugin-items-section') ?? ''), await a.text('.plugin-page'));
  await a.click('#nav-skills');
  // Claude Code has the plugin itself: on Skills its mark says the skill comes through it (never "No copy" or "Can't load
  // it"), and its row in the details opens the plugin's page, where the plugin itself is handled.
  const installRecord = join(practice, '.claude/plugins/installed_plugins.json');
  const installsBefore = existsSync(installRecord) ? readFileSync(installRecord, 'utf8') : undefined;
  writeClaudeInstall(practice, 'ck-test-market', 'issue-tracker', '9.9.9', { 'skills/triage/SKILL.md': readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8'), '.mcp.json': JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp'] } } }) });
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && (await a.run(`document.querySelector('#${rowPart('cell', 'skills', 'triage', 'claude-cli')}')?.dataset.state`)) !== 'plugin'; tries++) await wait(100);
  same('a tool with the plugin itself has the skill through it', await a.run(`[document.querySelector('#${rowPart('cell', 'skills', 'triage', 'claude-cli')}')?.dataset.state, document.querySelector('#${rowPart('cell', 'skills', 'triage', 'pi-cli')}')?.dataset.state]`), ['plugin', 'current']);
  const throughTitle = await a.run(`document.querySelector('#${rowPart('cell', 'skills', 'triage', 'claude-cli')}')?.title`);
  check('its mark says which plugin, and is drawn on', /^Claude Code has it with the plugin issue-tracker, so no separate copy is placed there\.$/.test(throughTitle ?? '') && await a.exists(`#${rowPart('cell', 'skills', 'triage', 'claude-cli')}[data-look="on"]`), [throughTitle, await a.text('.legend')]);
  await fitsAtMinimum(a, 'a skill a tool has through a plugin');
  await a.shot('skill-through-plugin');
  // Its opened row has the item's switch in Claude Code. Claude Code has none for one skill of a plugin, so it is the whole
  // plugin's there, and both its line and its label say so first (the click runs Claude Code's own command, not run here).
  const pluginSettings = join(practice, '.claude/settings.json');
  const pluginSettingsBefore = existsSync(pluginSettings) ? readFileSync(pluginSettings, 'utf8') : undefined;
  const pluginSettingsNow = () => (existsSync(pluginSettings) ? readFileSync(pluginSettings, 'utf8') : undefined);
  if (!(await a.exists(`#${rowPart('enable', 'skills', 'triage', 'claude-cli')}`))) await a.click(`#${rowPart('open', 'skills', 'triage')}`);
  const triageLine = await a.text(`.details-tool:has(#${rowPart('enable', 'skills', 'triage', 'claude-cli')}) .details-tool-line`) ?? '';
  const triageSwitch = await a.run(`document.querySelector('#${rowPart('enable', 'skills', 'triage', 'claude-cli')}')?.getAttribute('aria-label')`) ?? '';
  check('the opened row’s Claude Code switch says it is the whole plugin’s', /Claude Code has no switch for one skill of a plugin, so this switch turns the whole plugin off there\./.test(triageLine)
    && /Click to turn the whole plugin issue-tracker off in Claude Code, with its 1 MCP server\.$/.test(triageSwitch), [triageLine, triageSwitch]);
  // A click on it applies at once, with Claude Code's own command (a stand-in here): the result leads with the skill clicked,
  // and its Undo turns the plugin back on there.
  const settingsAt = pluginSettingsNow() ?? '{}';
  const issueTrackerStub = `#!/bin/sh\ncase "$*" in\n  "plugin disable issue-tracker@ck-test-market --scope user") printf '{"enabledPlugins":{"issue-tracker@ck-test-market":false}}' > "$HOME/.claude/settings.json" ;;\n  "plugin enable issue-tracker@ck-test-market --scope user") printf '%s' '${settingsAt}' > "$HOME/.claude/settings.json" ;;\n  *) exit 9 ;;\nesac\n`;
  writeFileSync(claudeStub, issueTrackerStub);
  const wholeOff = () => JSON.parse(pluginSettingsNow() ?? '{}').enabledPlugins?.['issue-tracker@ck-test-market'] === false;
  await a.click(`#${rowPart('enable', 'skills', 'triage', 'claude-cli')}`);
  for (let tries = 0; tries < 60 && !(await a.exists('#outcome-undo-plugin')); tries++) await wait(100);
  check('the opened row’s switch applies at once, and its result leads with the skill', wholeOff() && await cellState(a, 'skills', 'triage', 'claude-cli') === 'plugin-off'
    && /triage is off in Claude Code\. Its whole plugin issue-tracker was turned off there, with its MCP server issues\./.test(await a.text('#header') ?? ''), [pluginSettingsNow(), await a.text('#header')]);
  await a.click('#outcome-undo-plugin');
  for (let tries = 0; tries < 60 && (wholeOff() || !/Undone: triage/.test(await a.text('#header') ?? '')); tries++) await wait(100);
  check('its Undo turns the plugin back on there', !wholeOff() && /Undone: triage is back on in Claude Code\./.test(await a.text('#header') ?? ''), [pluginSettingsNow(), await a.text('#header')]);
  writeFileSync(claudeStub, stubBefore);
  // Codex has the plugin too, and a switch for one skill of it: the row's switch takes Pi's copy out, turns Codex's skill off
  // and the whole plugin off in Claude Code (a stand-in for its command) in one click, and its one Undo puts all three back.
  const codexPlugin = join(practice, '.codex/plugins/cache/ck-test-market/issue-tracker/9.9.9'), codexToml = join(practice, '.codex/config.toml');
  const codexTomlBefore = readNow(codexToml);
  mkdirSync(join(codexPlugin, 'skills/triage'), { recursive: true });
  writeFileSync(join(codexPlugin, 'skills/triage/SKILL.md'), readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8'));
  writeFileSync(codexToml, `${codexTomlBefore ?? ''}\n[plugins."issue-tracker@ck-test-market"]\nenabled = true\n`);
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && await cellState(a, 'skills', 'triage', 'codex-cli') !== 'plugin'; tries++) await wait(100);
  // Pi's copy, found, is added to Central Knot first, so the click is the row's Off.
  if (await a.exists(`#${rowPart('add', 'skills', 'triage')}`)) { await a.click(`#${rowPart('add', 'skills', 'triage')}`); for (let tries = 0; tries < 60 && !(await switchOn(a, 'skills', 'triage')); tries++) await wait(100); }
  const piTriage = join(practice, '.pi/agent/skills/triage/SKILL.md');
  writeFileSync(claudeStub, issueTrackerStub);
  await a.click(`.ov-row[data-key="${rowPart('', 'skills', 'triage')}"] .switch`);
  for (let tries = 0; tries < 60 && !(await a.exists('#outcome-undo')); tries++) await wait(100);
  const codexItemOff = () => /name = "issue-tracker:triage"[^[]*enabled = false/.test(readNow(codexToml));
  check('one click takes Pi’s copy out, turns the plugin’s skill off in Codex and the whole plugin off in Claude Code, and says what went with it', codexItemOff() && wholeOff() && !existsSync(piTriage)
    && await cellState(a, 'skills', 'triage', 'codex-cli') === 'plugin-off' && await cellState(a, 'skills', 'triage', 'claude-cli') === 'plugin-off'
    && /^triage is off: no tool has it\..* Its whole plugin issue-tracker was turned off in Claude Code, with its MCP server issues\./.test(await a.text('.band-done .band-text') ?? ''), [await a.text('.bands'), readNow(codexToml)]);
  await a.click('#outcome-undo');
  for (let tries = 0; tries < 60 && (codexItemOff() || wholeOff() || !existsSync(piTriage)); tries++) await wait(100);
  same('its one Undo puts all three back', [codexItemOff(), wholeOff(), existsSync(piTriage), await cellState(a, 'skills', 'triage', 'codex-cli'), await cellState(a, 'skills', 'triage', 'claude-cli'), await switchOn(a, 'skills', 'triage')], [false, false, true, 'plugin', 'plugin', true]);
  writeFileSync(claudeStub, stubBefore);
  // The same Off from a page read before triage was turned off elsewhere is refused as a whole: the plugin's skill in Codex
  // is never switched beside the refusal. On again after, as it was.
  await a.run(`(async () => { const view = await window.centralKnot.refresh(); await window.centralKnot.applySkills([{ key: 'triage', on: false, except: [], seenOn: true }], false, view.home); document.querySelector('.ov-row[data-key="${rowPart('', 'skills', 'triage')}"] .switch').click(); })()`);
  for (let tries = 0; tries < 60 && !/changed since the page was read/.test(await a.text('#header') ?? ''); tries++) await wait(100);
  check('an Off from a stale page is refused, and the plugin’s skill in Codex stays on', !codexItemOff() && /triage changed since the page was read/.test(await a.text('#header') ?? ''), [await a.text('#header'), readNow(codexToml)]);
  await a.run(`(async () => { const view = await window.centralKnot.refresh(); await window.centralKnot.applySkills([{ key: 'triage', on: true, except: [], seenOn: false }], false, view.home); })()`);
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !(await switchOn(a, 'skills', 'triage')); tries++) await wait(100);
  rmSync(join(practice, '.codex/plugins'), { recursive: true, force: true });
  if (codexTomlBefore === undefined) rmSync(codexToml, { force: true }); else writeFileSync(codexToml, codexTomlBefore);
  await a.click('#header-refresh');
  // Its MCP server, moved to the library from its part too, is linked to the plugin, so it has a switch of its own in Claude Code:
  // the opened row's switch turns that one server off at once, by the name Claude Code gives a plugin's server; the row's mark
  // only shows it.
  await a.click('#nav-mcp');
  same('so does its MCP server, on MCP servers, and its mark is no button', await a.run(`[document.querySelector('#${rowPart('cell', 'mcp', 'issues', 'claude-cli')}')?.dataset.state, /has it with the plugin issue-tracker/.test(document.querySelector('#${rowPart('cell', 'mcp', 'issues', 'claude-cli')}')?.title ?? ''), document.querySelector('#${rowPart('cell', 'mcp', 'issues', 'claude-cli')}')?.tagName]`), ['plugin', true, 'SPAN']);
  if (!(await a.exists(`#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}`))) await a.click(`#${rowPart('open', 'mcp', 'issues')}`);
  same('the opened row has its switch in Claude Code, on', [await a.run(`document.querySelector('#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}')?.getAttribute('aria-checked')`), /Click to turn it off in Claude Code\.$/.test(await a.run(`document.querySelector('#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}')?.getAttribute('aria-label')`) ?? '')], ['true', true]);
  // That switch while Claude Code's settings can't be written: the sentence says what happened, and the reason is a problem line.
  for (const [path, mode] of [[pluginSettings, 0o444], [dirname(pluginSettings), 0o555]]) if (existsSync(path)) chmodSync(path, mode);
  await a.click(`#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}`);
  for (let tries = 0; tries < 40 && !(await a.exists('#header [data-outcome]')); tries++) await wait(100);
  const failedSwitch = [await a.text('#header [data-outcome] .band-text'), await a.text('#header .problem-text')];
  for (const [path, mode] of [[pluginSettings, 0o644], [dirname(pluginSettings), 0o755]]) if (existsSync(path)) chmodSync(path, mode);
  same('a plugin item’s switch that fails: its sentence names no reason; the reason is its problem line', [!!failedSwitch[1], !!failedSwitch[1] && (failedSwitch[0] ?? '').includes(failedSwitch[1].split(': ').at(-1))], [true, false]);
  await a.run(`document.querySelector('#outcome-dismiss')?.click()`); await a.settle();
  await a.click(`#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}`);
  for (let tries = 0; tries < 40 && (await cellState(a, 'mcp', 'issues', 'claude-cli')) !== 'plugin-off'; tries++) await wait(100);
  check('a click turns that one server off at once with Claude Code’s own switch, and the page says so, with Undo', JSON.stringify(JSON.parse(pluginSettingsNow() ?? '{}').deniedMcpServers) === '[{"serverName":"plugin:issue-tracker:issues"}]'
    && await cellState(a, 'mcp', 'issues', 'claude-cli') === 'plugin-off' && /issues is off in Claude Code\./.test(await a.text('#header') ?? '') && await a.exists('#outcome-undo-plugin'), [pluginSettingsNow(), await a.text('#header')]);
  await a.click('#nav-skills');
  same('the plugin’s skill is still on there', await cellState(a, 'skills', 'triage', 'claude-cli'), 'plugin');
  await a.click('#nav-mcp');
  if (!(await a.exists(`#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}`))) await a.click(`#${rowPart('open', 'mcp', 'issues')}`);
  same('the opened row shows it off in Claude Code', await a.run(`[document.querySelector('#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}')?.getAttribute('aria-checked'), document.querySelector('#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}')?.closest('.tool-switch')?.textContent]`), ['false', 'Off']);
  await fitsAtMinimum(a, 'a server a tool has through a plugin, opened');
  await a.shot('server-through-plugin-off');
  await a.click(`#${rowPart('enable', 'mcp', 'issues', 'claude-cli')}`);
  for (let tries = 0; tries < 40 && (await cellState(a, 'mcp', 'issues', 'claude-cli')) !== 'plugin'; tries++) await wait(100);
  check('its switch turns it back on: the settings are as they were', (pluginSettingsNow() === pluginSettingsBefore || JSON.parse(pluginSettingsNow() ?? '{}').deniedMcpServers === undefined) && await cellState(a, 'mcp', 'issues', 'claude-cli') === 'plugin', pluginSettingsNow());
  await a.click('#outcome-undo-plugin');
  for (let tries = 0; tries < 40 && (await cellState(a, 'mcp', 'issues', 'claude-cli')) !== 'plugin-off'; tries++) await wait(100);
  same('Undo turns it off again', [await cellState(a, 'mcp', 'issues', 'claude-cli'), JSON.parse(pluginSettingsNow() ?? '{}').deniedMcpServers?.length], ['plugin-off', 1]);
  await a.settle();
  if (pluginSettingsBefore === undefined) rmSync(pluginSettings, { force: true }); else writeFileSync(pluginSettings, pluginSettingsBefore);
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && (await a.run(`document.querySelector('#${rowPart('cell', 'mcp', 'issues', 'claude-cli')}')?.dataset.state`)) !== 'plugin'; tries++) await wait(100);
  if (!(await a.exists(`#${rowPart('enable', 'mcp', 'issues', 'claude-cli', 'page')}`))) await a.click(`#${rowPart('open', 'mcp', 'issues')}`);
  await a.click(`#${rowPart('enable', 'mcp', 'issues', 'claude-cli', 'page')}`);
  for (let tries = 0; tries < 30 && !(await a.exists('#plugin-back')); tries++) await wait(100);
  check('and its opened row leads to the plugin’s page', await a.exists('#plugin-back') && /issue[- ]tracker/i.test(await a.text('.plugin-page h2') ?? ''), await a.text('.plugin-page h2'));
  // triage, moved to the library from its part above: Delete from Central Knot takes Pi's copy out, and leaves the plugin's own
  // skill in Claude Code.
  await a.click('#nav-skills');
  if (await a.run(`document.querySelector('#${rowPart('open', 'skills', 'triage')}')?.getAttribute('aria-expanded')`) !== 'true') await a.click(`#${rowPart('open', 'skills', 'triage')}`);
  await a.click(`#${rowPart('delete', 'skills', 'triage')}`);
  await a.click(`#${rowPart('delete-confirm', 'skills', 'triage')}`);
  same('Delete from Central Knot takes Pi’s copy out, and leaves the plugin’s skill in Claude Code', [existsSync(piTriage), existsSync(join(practice, '.claude/plugins/cache/ck-test-market/issue-tracker/9.9.9/skills/triage/SKILL.md'))], [false, true]);
  if (installsBefore === undefined) rmSync(installRecord); else writeFileSync(installRecord, installsBefore);
  rmSync(join(practice, '.claude/plugins/cache/ck-test-market/issue-tracker/9.9.9'), { recursive: true, force: true });
  await a.click('#header-refresh');
  rmSync(join(practice, '.pi'), { recursive: true, force: true });
  await a.click('#nav-plugins');
  if (!(await a.exists('#plugin-back'))) await a.click('#popen-0-issue-tracker');
  // One skill of an installed plugin, off and back on (ENB-06): Codex's switch is a [[skills.config]] block naming
  // document-tools:pdf-reader in config.toml. Codex has it installed as its record says.
  const codexConfig = join(practice, '.codex/config.toml');
  const codexCopy = join(practice, '.codex/plugins/cache/ck-test-market/document-tools/1.2.0');
  cpSync(join(market, 'plugins/document-tools/skills'), join(codexCopy, 'skills'), { recursive: true });
  const configBefore = `${existsSync(codexConfig) ? readFileSync(codexConfig, 'utf8') : ''}\n[marketplaces.ck-test-market]\nsource = ${JSON.stringify(market)}\n\n[plugins."document-tools@ck-test-market"]\nenabled = true\n`;
  writeFileSync(codexConfig, configBefore);
  await a.click('#plugin-back');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 60 && !(await a.run(`(document.querySelector('[data-plugin="document-tools"]')?.textContent ?? '').includes('Installed') || !!document.querySelector('#pcell-0-document-tools-codex-cli[data-state="installed"]')`)); tries++) await wait(100);
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 60 && !(await a.exists('#pskill-0-document-tools-pdf-reader-codex-cli')); tries++) await wait(100);
  same('an installed plugin’s skills each get a switch in the tool that has it, on', await a.all('.plugin-skills .switch[id^="pskill-"]', 'e.id + "=" + e.getAttribute("aria-checked")'), ['pskill-0-document-tools-pdf-reader-codex-cli=true', 'pskill-0-document-tools-spreadsheet-codex-cli=true']);
  await a.click('#pskill-0-document-tools-pdf-reader-codex-cli');
  check('a click turns it off at once, with Codex’s own switch, by name', readFileSync(codexConfig, 'utf8') === `${configBefore}\n[[skills.config]]\nname = "document-tools:pdf-reader"\nenabled = false\n`, readFileSync(codexConfig, 'utf8'));
  check('and the page shows it off', await a.run(`document.querySelector('#pskill-0-document-tools-pdf-reader-codex-cli').getAttribute('aria-checked')`) === 'false' && /Installed (· [^·]+ )?· 1 skill off/.test(await a.text('.plugin-panel')) && /pdf-reader turned off in Codex/.test(await a.text('#header') ?? ''), await a.text('.plugin-page'));
  // The Skills page shows the same switch in Codex's box for the plugin's skill.
  const pdfRow = 'document-tools@ck-test-market/pdf-reader';
  await a.click('#nav-skills');
  for (let tries = 0; tries < 40 && await cellState(a, 'skills', pdfRow, 'codex-cli') !== 'plugin-off'; tries++) await wait(100);
  same('on the Skills page its Codex box shows it off, the plugin’s other skill on', [await cellState(a, 'skills', pdfRow, 'codex-cli'), await cellState(a, 'skills', 'document-tools@ck-test-market/spreadsheet', 'codex-cli')], ['plugin-off', 'plugin']);
  await a.click('#nav-plugins');
  await a.click('#plugins-undo');
  same('Undo turns it back on: config.toml is as it was', [readFileSync(codexConfig, 'utf8') === configBefore, await a.run(`document.querySelector('#pskill-0-document-tools-pdf-reader-codex-cli').getAttribute('aria-checked')`)], [true, 'true']);
  same('nothing on the plugin pages waited for a later click: no Apply, no Discard, no chosen switch', await a.run('window.ckWaiting'), []);
  writeFileSync(codexConfig, configBefore.slice(0, configBefore.indexOf('\n[marketplaces.ck-test-market]')));
  // document-tools' parts from an earlier version, moved at one look too: pdf-reader, edited in Pi since (Pi's skills folder known
  // first, as an earlier version's pass noted it), is his own now, said once; spreadsheet, left out of Pi, stays out of it.
  mkdirSync(join(practice, '.pi/agent/skills'), { recursive: true });
  await a.click('#header-refresh');
  await writeOldParts(practice, market, 'ck-test-market', 'document-tools', 'pi-cli', { skills: { 'pdf-reader': { edited: '\nMy own way of reading PDFs.\n' }, spreadsheet: { removed: true } } });
  await a.click('#nav-skills');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && !/is your own now/.test(await a.text('.bands') ?? ''); tries++) await wait(100);
  check('pdf-reader, edited in Pi before the move, is his own now, said once', /pdf-reader is your own now/.test(await a.text('.bands') ?? '') && !/from the plugin/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'pdf-reader')}"]`) ?? ''), [await a.text('.bands'), await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'pdf-reader')}"]`)]);
  await a.click('#nav-plugins');
  if (!(await a.exists('#plugin-back'))) await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 50 && !/Its items/.test(await a.text('.plugin-page') ?? ''); tries++) await wait(100);
  const migrated = await a.text('.plugin-items-section') ?? '';
  check('the migrated plugin’s page lists Its items: pdf-reader his own, spreadsheet kept out of Pi', /skill pdf-reader\s*Not brought in: you have your own/.test(migrated) && /skill spreadsheet/.test(migrated), migrated);
  await fitsAtMinimum(a, 'a migrated plugin’s page, with Its items');
  await a.shot('practice-plugin-migrated');
  // Pi joined just above: its folder goes once the pass bringing it up to date has ended, or that pass makes it again and the
  // Plugins table below has a fourth tool's column.
  await a.click('#nav-skills');
  await piCaughtUp(a);
  rmSync(join(practice, '.pi'), { recursive: true, force: true });
  await a.click('#nav-plugins');
  if (!(await a.exists('#plugin-back'))) await a.click('#popen-0-document-tools');
  await a.click('#plugin-back');
  // About has every fact about the marketplace, and Remove.
  await a.click('#market-tab-about');
  check('About names who made the marketplace and where it comes from', /By Platform team[\s\S]*market/.test(await a.text('.market-about-head') ?? ''), await a.text('.market-about-head'));
  await a.click('#forget-0');
  check('Remove forgets it here only', (await a.text('#plugins-scroll')).includes('No marketplaces yet'));
  // A marketplace with a long name and long facts: nothing is cut off at the smallest window, and
  // where the facts don't fit beside the name they drop whole rather than being cut mid-word.
  const longMarket = join(scratch, 'market-long');
  writeMarket(longMarket, 'platform-engineering-shared-developer-tools-marketplace', 'The Platform Engineering and Developer Experience Group');
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(longMarket)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
  await fitsAtMinimum(a, 'a long-named marketplace');
  await sizeTo(a, 1280, 800);
  const factsWhole = `(() => { const line = document.querySelector('.market-title-line'); if (!line) return 'no title line'; const box = line.getBoundingClientRect();
    return [...line.querySelectorAll('.market-fact')].every(fact => { const at = fact.getBoundingClientRect(); return at.top >= box.bottom - 1 || (at.right <= box.right + 1 && at.bottom <= box.bottom + 1); }); })()`;
  same('the long marketplace’s facts show whole or not at all', await a.run(factsWhole), true);
  await fullSize(a);
  await a.click('#market-tab-about');
  await a.click('#forget-0');
  // Instructions (INS-01, INS-02): each tool's own file, a diff before saving, the replaced version kept.
  await a.click('#nav-instructions');
  for (let tries = 0; tries < 40 && !(await a.exists('#ins-edit-claude-cli')); tries++) await wait(100);
  check('Instructions show Claude Code’s CLAUDE.md', (await a.text('#instructions-scroll')).includes('Explain the plan in two or three lines'), await a.text('#instructions-scroll'));
  // What explains the files waits closed in one info box at the top; a click opens it, and it stays open across a redraw.
  check('what explains the files is one closed info box at the top of the page', await a.run(`document.querySelector('#instructions-scroll').firstElementChild.id === 'ins-about' && !document.querySelector('#ins-about').open`));
  await a.click('#ins-about summary');
  check('a click opens it, saying who reads each file', (await a.run(`document.querySelector('#ins-about').open ? document.querySelector('#ins-about').innerText : ''`)).includes('CLAUDE.md · Claude Code reads this in every session'), await a.text('#ins-about'));
  await a.click('#nav-skills'); await a.click('#nav-instructions');
  check('and it stays open when the page is drawn again', await a.run(`document.querySelector('#ins-about')?.open`));
  await a.click('#ins-about summary');
  const order = [...await a.all('#instructions-scroll > *', `e.id || e.querySelector('h2')?.textContent || e.className`), ...await a.all('.ins-tool-cards > *', `e.querySelector('h3').textContent`)];
  same('the base comes first, then a heading over the tools’ own cards', order.slice(0, 7), ['ins-about', 'base-card', 'Each tool’s own instructions', 'ins-tool-cards', 'Claude Code', 'Copilot CLI', 'Codex']);
  check('a tool with no file says so, and its one action names it', (await a.text('#ins-head-copilot-cli')).includes('No file yet') && (await a.text('#ins-edit-copilot-cli')) === 'Add instructions for Copilot CLI', await a.text('#ins-head-copilot-cli'));
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value = area.value + '- Edited in Central Knot.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli');
  check('the change is shown before saving', (await a.text('.ins-diff .ins-added')).includes('- Edited in Central Knot.') && (await a.text('.ins-review-title')).includes('1 line added'), await a.text('.ins-editor'));
  await a.click('#ins-save-claude-cli');
  await wait(400);
  check('Save writes CLAUDE.md', readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Edited in Central Knot.'));
  check('and keeps the version it replaced', (await a.text('#instructions-scroll')).includes('Earlier versions (1)'), await a.text('#instructions-scroll'));
  await a.click('#outcome-undo-instruction');
  for (let tries = 0; tries < 30 && readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Edited in Central Knot.'); tries++) await wait(100);
  check('Undo puts the saved-over text back, keeping the undone save as a version', !readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Edited in Central Knot.') && (await a.text('#instructions-scroll')).includes('Earlier versions (2)'), await a.text('#instructions-scroll'));
  // An unsaved draft asks before it is thrown away.
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value = area.value + 'draft'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-cancel-claude-cli');
  check('Cancel with changes asks first', await a.exists('#ins-discard-claude-cli') && await a.exists('#ins-text-claude-cli'));
  await a.click('#ins-discard-claude-cli');
  check('Discard closes the editor without writing', !(await a.exists('#ins-text-claude-cli')) && !readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('draft'));
  // An untouched draft follows its file when it changes outside, rather than offering to put the old text back.
  await a.click('#ins-edit-claude-cli');
  const claudeMd = readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8');
  writeFileSync(join(practice, '.claude/CLAUDE.md'), claudeMd + '- Edited outside.\n');
  await a.click('#nav-skills');
  await a.click('#nav-instructions');
  for (let tries = 0; tries < 40 && !(await a.run(`document.querySelector('#ins-text-claude-cli')?.value.includes('Edited outside') ?? false`)); tries++) await wait(100);
  same('an untouched draft takes the outside edit and has nothing to review', [await a.run(`document.querySelector('#ins-text-claude-cli')?.value.includes('Edited outside') ?? false`), await a.run(`document.querySelector('#ins-review-claude-cli')?.disabled`)], [true, true]);
  await a.click('#ins-cancel-claude-cli');
  writeFileSync(join(practice, '.claude/CLAUDE.md'), claudeMd);
  await a.click('#nav-skills');
  await a.click('#nav-instructions');
  for (let tries = 0; tries < 40 && (await a.text('#instructions-scroll') ?? '').includes('Edited outside'); tries++) await wait(100);
  // Base instructions (INS-03, INS-04): written once, kept after each chosen tool's own text, an edit there kept for a choice, undone.
  const baseClaude0 = readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8'), baseCodex0 = readFileSync(join(practice, '.codex/AGENTS.md'), 'utf8');
  await a.click('#base-write');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value = '- Shared by every tool.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('typing the first base enables Review at once', await a.run(`!document.querySelector('#base-review').disabled`));
  await a.click('#base-tool-copilot-cli');
  await a.click('#base-review');
  check('the base review says what happens to each chosen file', (await a.text('.base-plan')).includes('CLAUDE.md') && (await a.text('.base-plan')).includes('AGENTS.md') && !(await a.text('.base-plan')).includes('copilot-instructions'), await a.text('#base-card'));
  await a.click('#base-save');
  const baseClaude1 = readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8'), baseCodex1 = readFileSync(join(practice, '.codex/AGENTS.md'), 'utf8');
  check('Save adds the base after each chosen tool’s own text, which is unchanged', baseClaude1.startsWith(baseClaude0) && baseClaude1.includes('- Shared by every tool.') && baseCodex1.startsWith(baseCodex0) && baseCodex1.includes('- Shared by every tool.'), baseClaude1);
  check('an unchosen tool is not written', !existsSync(join(practice, '.copilot/copilot-instructions.md')));
  // A click on the base's text opens its editor as Edit text or tools does, with the caret where the click landed.
  const baseText = '#base-card pre.ins-preview';
  await clickText(a, baseText, 'every tool.');
  same('a click on the base’s text opens its editor, the caret where it landed', await caretAt(a), ['base-text', '- Shared by '.length]);
  check('with its actions in the card’s head', await a.exists('#base-head #base-review') && await a.exists('#base-head #base-cancel'), await a.text('#base-head'));
  await a.press('Escape');
  // A redraw landing between the press and the release (as a background pass or a usage reading may) replaces the text under the
  // button, and the browser then sends no click: the release opens the editor of the text now there, the caret where it was aimed.
  let underPress;
  await clickText(a, baseText, 'every tool.', async () => { underPress = await redrawUnder(a, baseText); });
  same('a click on the base’s text with a redraw between its press and its release: the text was replaced, and its editor opens with the caret where it was aimed',
    [...underPress, ...await caretAt(a)], [true, true, 'base-text', '- Shared by '.length]);
  await a.press('Escape');
  // …on the same page in the same home only: a press on the base's text, then This Mac's home opened before the release, its base
  // the same text (written so here), editable, and the pointer following that same character there: the release opens nothing.
  const otherBase = join(HOME, '.central-knot/instructions/base.md'), hadInstructions = existsSync(dirname(otherBase));
  mkdirSync(dirname(otherBase), { recursive: true });
  writeFileSync(otherBase, '- Shared by every tool.\n');
  const aimed = await pointAt(a, baseText, 'every tool.');
  await mouse(a, 'mouseMoved', aimed, 0); await mouse(a, 'mousePressed', aimed, 1);
  await a.run(`document.querySelector('#home-actual').click()`);
  for (let tries = 0; tries < 50 && (await a.text('#home-label')) === 'Practice copy'; tries++) await wait(100);
  await a.settle();
  underPress = await a.run(`(() => { const text = document.querySelector('${baseText}'); return [document.querySelector('#home-label').textContent !== 'Practice copy', text?.textContent, !!text?.matches('.ins-editable')]; })()`);
  const sameCharacter = await pointAt(a, baseText, 'every tool.');
  await mouse(a, 'mouseMoved', sameCharacter, 1); await mouse(a, 'mouseReleased', sameCharacter, 0);
  await a.settle();
  same('a press on the base’s text, then another home showing the same base text opened before the release, released on that same character: nothing opens there',
    [...underPress, await a.exists('#base-text')], [true, '- Shared by every tool.', true, false]);
  await a.click('#home-fixture');
  for (let tries = 0; tries < 50 && (await a.text('#home-label')) !== 'Practice copy'; tries++) await wait(100);
  rmSync(hadInstructions ? otherBase : dirname(otherBase), { recursive: true, force: true });
  await a.settle();
  // A tool's own instructions edited afterwards, opened by a click on their text: its base block, the base and the other files
  // stay as they are.
  const baseMd1 = readFileSync(join(practice, '.central-knot/instructions/base.md'), 'utf8');
  await clickText(a, '[aria-label="Claude Code instructions"] pre.ins-preview', 'Prefer small commits');
  same('a click on a tool’s own text opens its editor, the caret where it landed', await caretAt(a), ['ins-text-claude-cli', baseClaude0.indexOf('Prefer small commits')]);
  check('with Review changes and Cancel in the card’s head', await a.exists('#ins-head-claude-cli #ins-review-claude-cli') && await a.exists('#ins-head-claude-cli #ins-cancel-claude-cli'), await a.text('#ins-head-claude-cli'));
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value += '- Own line after the base.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli');
  check('and Save in the head too, once it is reviewed', await a.exists('#ins-head-claude-cli #ins-save-claude-cli'), await a.text('#ins-head-claude-cli'));
  await a.click('#ins-save-claude-cli');
  const ownEdited = readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8');
  check('editing a tool’s own text keeps its base block after it, unchanged', ownEdited === baseClaude1.replace('\n\n<!-- Central Knot', '\n- Own line after the base.\n\n<!-- Central Knot') && readFileSync(join(practice, '.codex/AGENTS.md'), 'utf8') === baseCodex1, ownEdited);
  same('and the base itself as it was', readFileSync(join(practice, '.central-knot/instructions/base.md'), 'utf8'), baseMd1);
  await a.click('#outcome-undo-instruction');
  writeFileSync(join(practice, '.codex/AGENTS.md'), baseCodex1.replace('- Shared by every tool.', '- Shared, edited in Codex.'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !(await a.exists('#base-restore-codex-cli')); tries++) await wait(100);
  check('an edit inside Codex’s copy shows, with both choices', await a.exists('#base-usecopy-codex-cli') && await a.exists('#base-restore-codex-cli'), await a.text('#base-card'));
  // On Codex's harness page the strip's "Choose what to do…" goes to that choice on Instructions (its target isn't on a harness tab).
  await a.click('#nav-harnesses'); await a.click('#harness-codex-cli'); await a.click('#harness-tab-instructions');
  await a.click('#ins-base-go-codex-cli');
  check('“Choose what to do…” on a harness’s Instructions tab opens the choice on Instructions', await a.exists('#base-card') && await a.run(`document.activeElement?.id?.startsWith('base-diff-')`), await a.run(`[document.activeElement?.id, !!document.querySelector('#base-card')]`));
  await a.click('#base-usecopy-codex-cli');
  await a.click('#base-save');
  check('Use it as the base spreads Codex’s edit to Claude Code', readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8').includes('- Shared, edited in Codex.'));
  await a.click('#outcome-undo-base');
  check('Undo puts Claude Code back', readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8') === baseClaude1);
  await a.click('#base-edit'); await a.click('#base-stop'); await a.click('#base-back');
  check('going back from "Stop sharing" keeps the ticks', await a.run(`document.querySelector('#base-tool-claude-cli').checked && document.querySelector('#base-tool-codex-cli').checked`));
  await a.run(`document.querySelector('#base-tool-claude-cli').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await a.settle();
  check('Esc on a tool box cancels the untouched base editor', !(await a.exists('#base-text')));
  // A typed base draft belongs to this home: switching home from another page asks first on Instructions, and stays.
  await a.click('#base-edit');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value += '- Not saved.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  // The click on a tool's text and its Edit share one lock. Typing doesn't redraw the page: until something else does (a
  // background pass may), the first click meets the base's typed work as Edit does and asks about it; once the page is drawn
  // again, the card is locked and the click says why. Either way nothing opens and the typed work stays. Kept, a click on the
  // text says why.
  const lockedWhy = 'Finish or cancel the base instructions edit first.';
  // The status line emptied before each click, so what it says after is that click's.
  await a.run(`document.querySelector('#announcement').dataset.text = ''`);
  await clickText(a, '[aria-label="Claude Code instructions"] pre.ins-preview', 'Prefer small commits');
  check('a click on a tool’s text while the base editor holds typed work opens nothing: it asks about the base’s changes as Edit does, or, once the page is drawn again, says why', !(await a.exists('#ins-text-claude-cli')) && (await a.run(`document.querySelector('#base-text').value`)).includes('- Not saved.')
    && (await a.exists('#base-keep') || (await a.run(`document.querySelector('#announcement')?.dataset.text`)) === lockedWhy), [await a.text('#base-card'), await a.run(`document.querySelector('#announcement')?.dataset.text`)]);
  if (await a.exists('#base-keep')) await a.click('#base-keep');
  await a.run(`document.querySelector('#announcement').dataset.text = ''`);
  await clickText(a, '[aria-label="Claude Code instructions"] pre.ins-preview', 'Prefer small commits');
  check('drawn again, the card says why it is locked, and a click on its text says it and opens nothing', !(await a.exists('#ins-text-claude-cli')) && (await a.run(`document.querySelector('#base-text').value`)).includes('- Not saved.')
    && (await a.run(`document.querySelector('#announcement')?.dataset.text`)) === lockedWhy && (await a.text('#ins-head-claude-cli')).includes(lockedWhy), [await a.run(`document.querySelector('#announcement')?.dataset.text`), await a.text('#ins-head-claude-cli')]);
  await a.click('#nav-skills');
  await a.click('#home-actual');
  check('a home switch with a typed base draft asks first and stays', await a.exists('#base-discard') && (await a.run(`document.querySelector('#base-text')?.value`) ?? '').includes('- Not saved.') && await a.run(`document.querySelector('#home-fixture')?.getAttribute('aria-current') === 'true'`), await a.text('.bands'));
  await a.click('#base-discard');
  await a.click('#base-edit');
  await a.click('#base-tool-claude-cli'); await a.click('#base-tool-codex-cli');
  await a.click('#base-review'); await a.click('#base-save');
  const codexAfter = readFileSync(join(practice, '.codex/AGENTS.md'), 'utf8');
  check('Taking every tool off restores Claude Code’s own text and leaves Codex’s hand-edited copy where it is', readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8') === baseClaude0 && codexAfter.startsWith(baseCodex0) && codexAfter.includes('- Shared, edited in Codex.'), codexAfter);
  // The keyboard way in: Enter on a tool's focused text opens its editor, the caret at the start.
  await a.run(`document.querySelector('[aria-label="Codex instructions"] pre.ins-preview').focus()`);
  await a.press('Enter');
  same('Enter on a tool’s focused text opens its editor, the caret at the start', await caretAt(a), ['ins-text-codex-cli', 0]);
  await a.press('Escape');
  // A card's edit, review and discard-confirm rows wrap by its width: nothing spills out.
  await a.click('#ins-edit-copilot-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-copilot-cli'); area.value = '# How I work\\n- Explain the plan first.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const insFits = async state => { for (const width of [1180, 1240, 1320]) { await sizeTo(a, width, 800); same(`nothing cut off in Instructions (${state}) at ${width}×800`, await a.run(CUT_OFF), []); } };
  await insFits('editing');
  await a.click('#ins-review-copilot-cli');
  await insFits('review');
  await a.click('#ins-review-discard-copilot-cli');
  await insFits('discard confirmation');
  await a.shot('instructions-discard-confirm');
  await a.click('#ins-review-discard-yes-copilot-cli');
  await fullSize(a);
  // A draft whose tool leaves the home is kept, offered to copy or discard, and never silently replaced by another edit.
  await a.click('#ins-edit-codex-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-codex-cli'); area.value = area.value + 'Codex draft.'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && !(await a.exists('#ins-orphan')); tries++) await wait(100);
  check('a draft whose tool left the home is offered to copy or discard', await a.exists('#ins-orphan-copy') && /Codex is no longer in this home/.test(await a.text('#ins-orphan') ?? '') && !(await a.exists('#ins-text-codex-cli')), await a.text('#ins-orphan'));
  check('and no other edit can replace it', await a.run(`document.querySelector('#ins-edit-claude-cli').disabled`));
  await a.shot('instructions-orphan-draft');
  await a.click('#ins-orphan-discard');
  check('Discard draft lets it go', !(await a.exists('#ins-orphan')) && !(await a.run(`document.querySelector('#ins-edit-claude-cli').disabled`)));
  renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && !(await a.exists('#ins-edit-codex-cli')); tries++) await wait(100);
  // Settings: the appearance choice changes the page's colour scheme at once, and System is the default.
  await a.click('#nav-settings');
  const dark = () => a.run(`matchMedia('(prefers-color-scheme: dark)').matches`);
  check('Settings shows the three appearances, System chosen', await a.exists('#appearance-system[aria-checked="true"]') && await a.exists('#appearance-light') && await a.exists('#appearance-dark'));
  // The cards are one radio group: the chosen card is the only Tab stop, and arrow keys move on and choose (focus stays put
  // through the save's redraw, so the second press works).
  await a.run(`document.querySelector('#appearance-system').focus()`);
  for (let press = 0; press < 2; press++) { await a.press('ArrowRight', 'ArrowRight'); await wait(200); }
  check('arrow keys choose Dark, which makes the page dark', await dark() === true && await a.exists('#appearance-dark[aria-checked="true"]')
    && await a.run(`document.activeElement.id === 'appearance-dark' && [...document.querySelectorAll('[role="radio"]')].filter(card => card.tabIndex === 0).map(card => card.id).join() === 'appearance-dark'`));
  await a.shot('settings-dark');
  await a.click('#appearance-light');
  await wait(200);
  check('Light makes the page light', await dark() === false);
  await a.shot('settings-light');
  await a.click('#appearance-system');
  check('System can be chosen again', await a.exists('#appearance-system[aria-checked="true"]'));
  same('Settings rows use the page width, each control at the row end, text 16px in as on other pages', await a.run(`(() => {
    const page = document.querySelector('.settings-scroll'), style = getComputedStyle(page), row = document.querySelector('#setting-log'), box = row.getBoundingClientRect();
    return [Math.round(page.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - box.width),
      Math.round(box.right - parseFloat(getComputedStyle(row).paddingRight) - document.querySelector('#open-log-folder').getBoundingClientRect().right),
      Math.round(document.querySelector('#setting-log-title').getBoundingClientRect().left - page.getBoundingClientRect().left)];
  })()`), [0, 0, 16]);
  const appSettings = join(scratch, 'data/app-settings.json');
  const savedSettings = async () => JSON.parse(await readFile(appSettings, 'utf8'));
  // Every writer saves through one chain: saves sent together land in order, the file stays whole, and other fields stay.
  // They bypass the page, so the open page (showing System) can only come to show Light by hearing that main saved it.
  await a.run(`Promise.all(['light', 'system', 'dark', 'system', 'light'].map(choice => window.centralKnot.setAppearance(choice)))`);
  let followed = false;
  for (let tries = 0; tries < 20 && !followed; tries++) { await wait(100); followed = await a.exists('#appearance-light[aria-checked="true"]'); }
  const afterSaves = await savedSettings();
  check('settings saved at once keep the other settings, and the open page follows the last', followed && afterSaves.appearance === 'light' && afterSaves.home?.mode === 'fixture', afterSaves);
  // Fail the final rename of this settings file after the temporary file was written, through the real appearance save.
  if (a.main) {
    const main = await a.main(), before = readFileSync(appSettings);
    try {
      const failure = await main.run(`(async () => {
        const fs = process.mainModule.require('node:fs/promises'), rename = fs.rename;
        fs.rename = async (from, to) => {
          if (to === ${JSON.stringify(appSettings)}) throw new Error('settings rename failed');
          return rename(from, to);
        };
        try {
          return await electron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
            "window.centralKnot.setAppearance('dark').then(() => '', error => error.message)");
        } finally { fs.rename = rename; }
      })()`);
      same('a failed appearance rename keeps the settings bytes and removes its temporary file',
        [failure.includes('settings rename failed'), readFileSync(appSettings).equals(before),
          readdirSync(dirname(appSettings)).filter(name => name.startsWith('app-settings.json.'))], [true, true, []]);
    } finally { main.close(); }
  }
  chmodSync(appSettings, 0o444);
  await a.click('#appearance-dark');
  check('a save that fails says why in plain words in its row, and the saved choice stays', await dark() === false && await a.exists('#appearance-light[aria-checked="true"]')
    && await a.text('#setting-appearance .setting-failure') === 'Couldn’t save: Central Knot can’t write its settings file. Light is still in use. Check the file’s permissions, then try again.', await a.text('#setting-appearance'));
  chmodSync(appSettings, 0o644);
  await a.click('#appearance-system');
  check('the next save clears the failure', !(await a.exists('.setting-failure')) && (await savedSettings()).appearance === 'system');
  // The log: Show log shows its last 200 lines under its row, the page scrolled to the newest, with earlier lines back to its
  // start and Refresh log; Open log folder is a second button.
  const logFile = join(scratch, 'data/central-knot.log'), logAside = `${logFile}.aside`;
  /** The log as the page shows it: its lines, whether the newest is in view, and whether anything is wider than the page. */
  const logShown = () => a.run(`(() => {
    const text = document.querySelector('#log-text'), page = document.querySelector('#settings-scroll');
    if (!text) return null;
    const lines = text.textContent.split('\\n'), view = page.getBoundingClientRect(), end = text.getBoundingClientRect().bottom;
    return { first: lines[0], last: lines.at(-1), count: lines.length, newestInView: end <= view.bottom && end > view.top, scrolled: page.scrollTop > 0,
      wider: page.scrollWidth > page.clientWidth || text.scrollWidth > text.clientWidth };
  })()`);
  renameSync(logFile, logAside);
  await a.click('#show-log');
  same('Show log before anything was logged says so, with Refresh log', [await a.text('#setting-log-lines .setting-log-note'), await a.exists('#log-text'), await a.text('#log-refresh')],
    ['Nothing has been logged yet.', false, 'Refresh log']);
  // A log longer than a page, its oldest line a stack trace with no space to break at, then the app's own lines.
  const stackLine = `2026-11-17T09:00:00.000Z request sync:apply failed: Error: ENOENT at ${'/very/long/path/without/a/space'.repeat(12)}`;
  writeFileSync(logFile, [stackLine, ...Array.from({ length: 450 }, (_, n) => `2026-11-17T09:00:01.000Z filler line ${n + 1}`)].join('\n') + '\n' + readFileSync(logAside, 'utf8'));
  rmSync(logAside);
  const linesOnFile = () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  await a.click('#log-refresh');
  let shown = await logShown();
  same('Refresh log shows the log’s last 200 lines as in the file, scrolled so the newest is in view; Show log is now Hide log, Open log folder a second button',
    [shown?.count, shown?.last, shown?.newestInView, shown?.scrolled, await a.text('#show-log'), await a.text('#open-log-folder'), await a.text('#log-earlier')],
    [200, linesOnFile().at(-1), true, true, 'Hide log', 'Open log folder', 'Show 200 earlier lines']);
  // Where the page lands, the foot: that the times are UTC, and the log's buttons again (the row's are far above), all in view.
  same('the foot of the lines says the times are UTC and has Refresh log, Hide log and Open log folder, in view; the row says Log', await a.run(`(() => {
    const foot = document.querySelector('#log-end'), view = document.querySelector('#settings-scroll').getBoundingClientRect(), box = foot.getBoundingClientRect();
    return [foot.querySelector('.setting-log-note')?.textContent, [...foot.querySelectorAll('button')].map(button => button.textContent), box.top >= view.top && box.bottom <= view.bottom,
      document.querySelector('#setting-log-title').textContent];
  })()`), ['Times are in UTC, as the file has them.', ['Refresh log', 'Hide log', 'Open log folder'], true, 'Log']);
  // A click that logs (Update plugins automatically, turned off), then Refresh log: its line is the newest, in view.
  await a.click('#plugin-updates-on');
  await a.click('#log-refresh');
  shown = await logShown();
  check('a click that logs, then Refresh log: its line is the newest, and in view', shown?.last.endsWith(' plugin updates: turned off') && shown.newestInView, shown);
  await a.click('#plugin-updates-on');
  // Earlier lines, at the smallest window, to the log's start: each click keeps the place (the button stays where it was, the
  // lines it brought under it), the last says exactly how many were left, and the stack trace wraps: nothing is wider than the page.
  await sizeTo(a, ...SMALLEST);
  await a.run(`document.querySelector('#log-earlier').scrollIntoView({ block: 'center' })`);
  const earlierAt = () => a.run(`(document.querySelector('#log-earlier') ?? document.querySelector('#setting-log-lines .setting-log-note')).getBoundingClientRect().top`);
  const labels = [];
  for (let clicks = 0; clicks < 20 && await a.exists('#log-earlier'); clicks++) {
    const before = await earlierAt();
    labels.push(await a.text('#log-earlier'));
    await a.click('#log-earlier');
    const after = await earlierAt();
    check(`Show earlier lines keeps the place (click ${clicks + 1})`, Math.abs(after - before) < 1, { before, after });
  }
  shown = await logShown();
  same('earlier lines go back to the log’s start, which says so; the last button said exactly how many were left',
    [labels.at(-1), await a.text('#setting-log-lines .setting-log-note'), shown?.count, shown?.first], [`Show ${linesOnFile().length - 200 * labels.length} earlier lines`, 'This is the start of the log.', linesOnFile().length, stackLine]);
  same('a long stack-trace line wraps at 860×560: nothing is wider than the page', shown?.wider, false);
  // The log's text can be selected (the page's body can't): a drag over its first line selects some of it.
  const [fromX, fromY] = await a.run(`(() => { const box = document.querySelector('#log-text').getBoundingClientRect(); return [box.left + 14, box.top + 14]; })()`);
  for (const [type, x, buttons] of [['mouseMoved', fromX, 0], ['mousePressed', fromX, 1], ['mouseMoved', fromX + 240, 1], ['mouseReleased', fromX + 240, 0]]) {
    await a.send('Input.dispatchMouseEvent', { type, x, y: fromY, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 });
  }
  const selected = await a.run(`getSelection().toString()`);
  check('a drag over the log selects its text, to copy', selected.length > 10 && stackLine.includes(selected), selected);
  // A redraw (Settings is redrawn whenever the window gains the focus) keeps that selection, and the focus and the scroll place.
  const selectedNow = () => a.run(`[getSelection().toString(), document.activeElement?.id, document.querySelector('#settings-scroll').scrollTop]`);
  const beforeRedraw = await selectedNow(), [logRedrawn] = await redrawUnder(a, '#log-text');
  same('a redraw of Settings keeps the selection in the log’s lines, the focus and the scroll place', [logRedrawn, ...await selectedNow()], [true, ...beforeRedraw]);
  await a.run(`getSelection().removeAllRanges()`);
  await fullSize(a);
  await fitsAtMinimum(a, 'Settings with the whole log shown');
  await a.run(`document.querySelector('#log-foot-show-log').focus()`);
  await a.click('#log-foot-show-log');
  same('Hide log at the foot takes the lines away; the row’s button says Show log again, with the focus', [await a.exists('#setting-log-lines'), await a.text('#show-log'), await a.run(`document.activeElement?.id`)],
    [false, 'Show log', 'show-log']);
  // Open log folder opens the folder the log is in, and says so (macOS and Windows select the file: the Mac check covers that).
  if (process.platform === 'linux') {
    await a.click('#open-log-folder');
    for (let tries = 0; tries < 30 && !existsSync(fileManagerAsked); tries++) await wait(100);
    same('Open log folder opens the log’s folder and names the file', [existsSync(fileManagerAsked) && readFileSync(fileManagerAsked, 'utf8').trim(), await a.text('#setting-log .setting-note')],
      [join(scratch, 'data'), 'Opened the log’s folder. The file is central-knot.log.']);
  }
  // History's action for an entry that is no library item's (here, none at all) reaches no kind's restore (main.ts history:restore).
  same('an entry that is no library item’s is refused in words, and reaches no kind’s restore',
    (await a.run(`window.centralKnot.restore('no-such-entry', ${JSON.stringify(practice)})`)).stopped, 'That History entry has nothing Central Knot can undo. Nothing was changed.');
  // Keep history for: 30 days at first, and History shows only what the window covers. A longer window saves at once; a shorter
  // one asks first (Cancel writes nothing), then removes what is older from this home's History file and from the History page.
  // This home's History also holds the removals made above, so its intro names Restore too.
  const historyFile = join(practice, '.central-knot/history.json');
  writeFileSync(historyFile, JSON.stringify({ events: [...JSON.parse(readFileSync(historyFile, 'utf8')).events, ...[60, 20, 5].map(days =>
    ({ id: `aged-${days}`, at: new Date(Date.now() - days * DAY).toISOString(), key: `aged-${days}`, item: `aged-${days}-days`, kind: 'edit', winner: { tool: 'claude-cli', hash: '0'.repeat(64) }, losers: [], orderProved: true }))] }));
  const agedIn = events => events.map(event => event.key).filter(key => key.startsWith('aged-'));
  const agedOnFile = () => agedIn(JSON.parse(readFileSync(historyFile, 'utf8')).events);
  const agedShown = async () => agedIn((await a.run('window.centralKnot.history()')).events);
  same('History is kept for 30 days at first: it shows what that covers, and reading alone removes nothing',
    [await a.run(`document.querySelector('#history-days').value`), await agedShown(), agedOnFile()], ['30', ['aged-20', 'aged-5'], ['aged-60', 'aged-20', 'aged-5']]);
  await keepFor(a, 90);
  same('a longer window saves at once, with no question, and History shows what it now covers',
    [(await savedSettings()).historyDays, await a.exists('#history-shorten'), await agedShown()], [90, false, ['aged-60', 'aged-20', 'aged-5']]);
  await keepFor(a, 7);
  const question = await a.text('#history-shorten-text') ?? '';
  same('a shorter window asks first, naming from when, and keeps the saved choice until confirmed (which its other button names)',
    [/^History before .+ will be removed and can’t be restored\. Your other homes remove it too the next time they record a change\.$/.test(question), await a.text('#history-shorten'), await a.text('#history-shorten-cancel'), await a.run(`document.querySelector('#history-days').value`), (await savedSettings()).historyDays],
    [true, 'Shorten to 7 days', 'Keep 90 days', '90', 90]);
  await a.shot('settings-history-confirm');
  await a.run(`document.querySelector('#history-days').focus()`);
  for (const type of ['keyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await a.settle();
  const escaped = await a.exists('#history-shorten');
  await keepFor(a, 7);
  await a.click('#history-shorten-cancel');
  same('Escape or Cancel closes the question and writes nothing', [escaped, await a.exists('#history-shorten'), (await savedSettings()).historyDays, agedOnFile(), await a.run(`document.activeElement.id`)], [false, false, 90, ['aged-60', 'aged-20', 'aged-5'], 'history-days']);
  // A window change waits its turn behind whatever main is doing (here a held queue standing in for a long sync pass). Meanwhile
  // the row says so and takes no other change, and other rows still work. Newer requests that arrive meanwhile win: the
  // confirmed shorter window they overtook neither saves nor removes anything, and main reports nothing pruned for it. History
  // opened while they wait shows the window that won with the events it covers, never the window from before.
  if (a.main) {
    const main = await a.main();
    const held = await holdQueue(main, a);
    await keepFor(a, 7);
    await a.click('#history-shorten');
    await a.run(`void (window.ckOvertaken = window.centralKnot.setHistoryDays(7))`);
    await a.run(`void (window.ckNewest = window.centralKnot.setHistoryDays(30).then(saved => (window.ckNewestDone = true, saved)))`);
    await a.click('#appearance-light');
    const during = [await a.run(`document.querySelector('#history-days').disabled`), (await a.text('#setting-history-notice'))?.trim(), await a.exists('#history-shorten'),
      await a.run(`window.ckNewestDone === true`), (await savedSettings()).historyDays, await a.exists('#appearance-light[aria-checked="true"]')];
    // Not a.click: it waits for the page to be idle, and History's read waits behind the held queue.
    await a.run(`document.querySelector('#nav-history').click()`);
    await held.release();
    const [overtaken, newest] = [await a.run('window.ckOvertaken'), await a.run('window.ckNewest')];
    await a.settle();
    const listedMeanwhile = await a.text('#history-scroll') ?? '';
    same('while main is busy the row says it is updating and takes no other change; the newest request wins, the overtaken shorter ones remove nothing, and History opened meanwhile agrees with the window that won',
      [during, (await savedSettings()).historyDays, agedOnFile(), [overtaken.pruned ?? 'none', newest.pruned], listedMeanwhile.includes('aged-20-days'), listedMeanwhile.includes('aged-60-days'), await a.text('.history-intro')],
      [[true, 'Updating History…', false, false, 90, true], 30, ['aged-20', 'aged-5'], ['none', 'done'], true, false, 'What sync, your switches, Pull, sources and profile switches changed, newest first. Undo puts the earlier version back; Restore brings back what was deleted or removed. Kept for 30 days. Change in Settings.']);
    await a.click('#nav-settings');
    same('the row then shows the window that won and takes changes again', [await a.run(`document.querySelector('#history-days').value`), await a.run(`document.querySelector('#history-days').disabled`)], ['30', false]);
    await a.click('#appearance-system');
    main.close();
  }
  // Shorten. Where main can be reached the change is held in its queue, and the window refocused meanwhile, so the page re-reads
  // the settings (still 30 days) before main saves. The re-read main asks for once it has saved can land either side of the
  // save's answer; it is muted here, so the save's answer must stand on its own: it is still the newer one, and the row reports it.
  await keepFor(a, 7);
  const shortenMain = a.main && await a.main();
  const shortenHeld = shortenMain && await holdQueue(shortenMain, a);
  await a.click('#history-shorten');
  if (shortenHeld) {
    await refocus(shortenMain); await a.settle();
    await shortenMain.run(`(contents => { const send = contents.send; globalThis.ckUnmute = () => { contents.send = send; }; contents.send = (channel, ...rest) => channel === 'settings:changed' ? undefined : send.call(contents, channel, ...rest); })(electron.BrowserWindow.getAllWindows()[0].webContents)`);
    await shortenHeld.release();
  }
  for (let tries = 0; tries < 30 && (await savedSettings()).historyDays !== 7; tries++) await wait(100);
  for (let tries = 0; tries < 30 && agedOnFile().length > 1; tries++) await wait(100);
  for (let tries = 0; tries < 30 && !(await a.exists('#setting-history-message')); tries++) await wait(100);
  const removedNote = await a.text('#setting-history-message') ?? '';
  if (shortenHeld) { await shortenMain.run('ckUnmute()'); shortenMain.close(); }
  // Another row acting clears the note: the page says one finished thing at a time.
  await a.click('#appearance-light');
  const noteAfterOtherRow = await a.exists('#setting-history-message');
  await a.click('#appearance-system');
  await a.click('#nav-history');
  const listed = await a.text('#history-scroll') ?? '';
  const intro = await a.text('.history-intro');
  await a.click('#history-intro-settings');
  same('Shorten saves, removes the older History from this home’s file, says from when (even after a re-read while it waited), and History shows only what is left, how long it keeps it, and the way to Settings',
    [(await savedSettings()).historyDays, agedOnFile(), /^Saved\. History before .+ was removed\.$/.test(removedNote), noteAfterOtherRow, listed.includes('aged-5-days'), listed.includes('aged-20-days'), intro, await a.exists('#history-days')],
    [7, ['aged-5'], true, false, true, false, 'What sync, your switches, Pull, sources and profile switches changed, newest first. Undo puts the earlier version back; Restore brings back what was deleted or removed. Kept for 7 days. Change in Settings.', true]);
  // Start at sign-in: only an installed app can register a login item, so here the row is off, can't be changed, and says why
  // in its hint's place: on a Mac, one outside the Applications folder; on Linux, any (signin.ts whyNoSignIn). Main refuses a
  // change too, and nothing about it is saved.
  const signInReason = flag('--electron') ? 'Only the installed app can start at sign-in.' : process.platform === 'darwin' ? 'Move Central Knot to the Applications folder first.' : 'Not available on Linux yet.';
  const refused = await a.run(`window.centralKnot.setStartAtSignIn(true).then(() => 'saved', error => String(error))`);
  same('Start at sign-in that can’t be changed is off and disabled, says why, and main refuses a change', [
    await a.run(`(({ disabled, ariaChecked }) => [ariaChecked, disabled])(document.querySelector('#start-at-sign-in'))`),
    await a.run(`document.getElementById(document.querySelector('#start-at-sign-in').getAttribute('aria-describedby'))?.textContent`),
    refused.includes(signInReason), 'startAtSignIn' in (await savedSettings())], [['false', true], signInReason, true, false]);
  // The installed-app checks below stand in main's platform and login items, which only works where they are Linux's own: elsewhere a
  // stood-in packaged app could reach the real system's login items.
  if (a.main && process.platform === 'linux') {
    // Main stands in as an installed app on Windows (see standIn): its login items keep what they are asked for unless told to
    // ignore it, it keeps every menu it builds from here on, and the system's settings pages and the first-close dialog are stand-ins.
    const main = await a.main();
    await standIn(main, 'win32');
    const until = async (expected, read) => { let seen; for (let tries = 0; tries < 30; tries++) { seen = await read(); if (JSON.stringify(seen) === JSON.stringify(expected)) break; await wait(100); } return seen; };
    // The switch, the row's message and its action.
    const row = () => a.run(`(message => [document.querySelector('#start-at-sign-in').getAttribute('aria-checked'), message?.querySelector('.setting-message-text').textContent ?? null, message?.querySelector('.text-action')?.textContent ?? null])(document.querySelector('#setting-sign-in .setting-message'))`);
    // Coming back to the window: the row can be changed now.
    await refocus(main);
    await until(false, () => a.run(`document.querySelector('#start-at-sign-in').disabled`));
    await a.click('#start-at-sign-in');
    const fromSettings = await until(['true', null, null], row);
    // The menu's item turns it off while Settings is open: the row follows.
    await main.run(`ck.menus.at(-1).find(item => item.label === 'Start at sign-in').click({ checked: false })`);
    const fromMenu = await until(['false', null, null], row);
    // A system that ignores the change: the row says so, with the way to its settings; once it is put right there, coming back clears it.
    const unchanged = ['false', 'Your system didn’t change this.', 'Open Startup apps'];
    await main.run(`ck.login.ignore = true`);
    await a.click('#start-at-sign-in');
    const ignored = await until(unchanged, row);
    // The action keeps the keyboard focus while the page redraws for something else (the appearance changed from elsewhere).
    const action = '#setting-sign-in .setting-message .text-action';
    await a.run(`document.querySelector('${action}').focus()`);
    await a.run(`window.centralKnot.setAppearance('dark')`);
    const redrawn = await until(true, () => a.exists('#appearance-dark[aria-checked="true"]'));
    const focused = await a.run(`document.activeElement.matches('${action}')`);
    await a.run(`window.centralKnot.setAppearance('system')`);
    await a.click(action);
    await main.run(`Object.assign(ck.login, { ignore: false, on: true })`);
    await refocus(main);
    const putRight = await until(['true', null, null], row);
    same('Start at sign-in on an installed Windows app (stand-in system): Settings and the menu change it and the row shows the system’s answer; a change the system ignored is said, its action keeps focus through a redraw, opens Startup apps, and the line clears once put right',
      [fromSettings, fromMenu, ignored, redrawn && focused, putRight, await main.run(`[ck.asked, ck.opened]`)],
      [['true', null, null], ['false', null, null], unchanged, true, ['true', null, null], [[true, false, true], ['ms-settings:startupapps']]]);
    // As an installed app on Linux: coming back to the window reads it again.
    await main.run(`(ck.as('linux'), ck.asked = [])`);
    const saved = (await savedSettings()).startAtSignIn;
    await refocus(main);
    const reread = await until('Not available on Linux yet.', () => a.text('#setting-sign-in-hint'));
    const menuItem = await main.run(`(({ label, visible, enabled, checked }) => ({ label, visible, enabled, checked }))(ck.menus.at(-1).find(item => item.label?.startsWith('Start at sign-in')))`);
    // The first close explains where the app went; on Linux it offers no start at sign-in.
    await main.run(`electron.BrowserWindow.getAllWindows()[0].close()`);
    for (let tries = 0; tries < 20 && !(await savedSettings()).closeExplained; tries++) await wait(100);
    const dialogs = await main.run(`ck.dialogs.map(options => 'checkboxLabel' in options)`);
    // The rest of the run has the real system back: platform, packaging, login items, menus, dialogs and links.
    await main.run(`(ck.restore(), electron.BrowserWindow.getAllWindows()[0].show())`);
    same('an installed app on Linux: the row (read again on focus), the menu (hidden) and the first-close dialog agree it isn’t available; no login-item call, nothing saved',
      [reread, menuItem, dialogs, await main.run(`ck.asked`), (await savedSettings()).startAtSignIn === saved],
      ['Not available on Linux yet.', { label: 'Start at sign-in (not on Linux yet)', visible: false, enabled: false, checked: false }, [false], [], true]);
    main.close();
  }
  await a.click('#nav-skills');
  // Full screen: nothing on the Overview, History or Plugins is cut off at 2560×1440.
  await sizeTo(a, 2560, 1440);
  for (const page of ['overview', 'history', 'plugins']) {
    await a.click(`#nav-${page}`);
    await wait(300);
    same(`nothing cut off at 2560×1440 on ${page}`, await a.run(CUT_OFF), []);
  }
  // The Harnesses cards at full screen: as many columns as its cards, up to four, so four tools sit in one row. (Settings is rows.)
  await a.click('#nav-harnesses');
  for (let tries = 0; tries < 30 && !(await a.exists('.harness-cards')); tries++) await wait(100);
  const harnessRows = await a.run(`(() => { const cards = [...document.querySelectorAll('.harness-cards > *')]; return [cards.length, new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size]; })()`);
  same(`at 2560×1440 the harnesses cards (${harnessRows[0]}) sit in one row`, harnessRows[1], 1);
  // Instructions at full screen: the base across the page, the tools' cards two a row; at 1728 one a row, each card's head
  // ending where its text ends (at about 160 characters).
  await a.click('#nav-instructions');
  for (let tries = 0; tries < 30 && !(await a.exists('.ins-card')); tries++) await wait(100);
  const toolRows = `(() => { const cards = [...document.querySelectorAll('.ins-tool-cards > .ins-card')], text = document.querySelector('.ins-tool-cards .ins-preview').getBoundingClientRect(), title = text && document.querySelector('.ins-tool-cards .ins-title').getBoundingClientRect();
    return { cards: cards.length, rows: new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size, base: document.querySelector('#base-card').getBoundingClientRect().width, card: cards[0].getBoundingClientRect().width, text: Math.round(text.width), titleEnd: Math.round(title.right - text.right) }; })()`;
  const twoUp = await a.run(toolRows);
  check(`at 2560×1440 the base card spans the page and the tools’ cards (${twoUp.cards}) sit two a row`, twoUp.rows === Math.ceil(twoUp.cards / 2) && twoUp.base > 2000 && twoUp.card < 1200, twoUp);
  await sizeTo(a, 1728, 1117);
  const narrower = await a.run(toolRows);
  check(`at 1728×1117 the tools' cards sit one a row, each text at most about 160 characters, the head ending where the text ends`, narrower.rows === narrower.cards && narrower.text <= 1226 && narrower.titleEnd <= 1, narrower);
  await fullSize(a);
  await a.click('#nav-skills');
  same('no page errors, practice', a.pageErrors, []);
  // With no window at all, Central Knot keeps running from the menu bar and sync keeps going (PLT-04). A page-made close
  // destroys the window outright (a real close only hides it), which is the stronger case: background work needs no window.
  // On a Mac the app is in the Dock while it has a window ("Foreground" to the system) and out of it once the window is gone
  // ("UIElement"): it runs from its menu bar icon alone.
  const inDock = () => { const found = spawnSync('lsappinfo', ['find', `pid=${a.child.pid}`], { encoding: 'utf8' }).stdout.trim(); return spawnSync('lsappinfo', ['info', '-only', 'ApplicationType', found], { encoding: 'utf8' }).stdout.trim(); };
  const dockBefore = process.platform === 'darwin' ? inDock() : undefined;
  await a.run(`setTimeout(() => window.close(), 50), true`);
  await wait(800);
  same('with the window gone the app keeps running', a.child.exitCode, null);
  if (process.platform === 'darwin') {
    for (let tries = 0; tries < 20 && !inDock().includes('UIElement'); tries++) await wait(250);
    same('on a Mac the app is in the Dock with its window, and leaves it for the menu bar when the window is gone', [dockBefore, inDock()], ['"ApplicationType"="Foreground"', '"ApplicationType"="UIElement"']);
  }
  const notesToml = join(practice, '.codex/agents/release-notes.toml');
  writeFileSync(notesToml, readFileSync(notesToml, 'utf8').replace('one line each.', 'one line each. Edited with no window.'));
  let spreadClosed = false;
  for (let tries = 0; tries < 80 && !spreadClosed; tries++) { await wait(250); spreadClosed = readNow(join(practice, '.claude/agents/release-notes.md')).includes('Edited with no window.'); }
  check('an agent edit spreads in the background with no window', spreadClosed);
  main?.close();
  await a.quit();
}

/**
 * The base instructions through a git repo, in two homes, as people click it: Push from one, Pull into the other, an edit, and
 * a deletion, said before Pull, carried out by the base's own apply and undone from History (the base and its tools come back).
 */
/**
 * The Plugins list knows, after a fresh launch and with no plugin's page opened, that a tool's copy differs from the
 * marketplace's at the same version: it reads the installed plugins' files in the background once the list is drawn.
 */
async function listDiffersFlow() {
  const home = join(scratch, 'home-list-differs'), data = join(scratch, 'list-differs-data'), market = join(scratch, 'market-list-differs');
  writeMarket(market, 'ck-test-market');
  const marketText = path => readFileSync(join(market, 'plugins', path), 'utf8');
  // Claude Code has three plugins at the marketplace's versions: two edited by hand since, one as the marketplace has it.
  writeClaudeInstall(home, 'ck-test-market', 'issue-tracker', '2.0.0', { 'skills/triage/SKILL.md': `${marketText('issue-tracker/skills/triage/SKILL.md')}\nA line added by hand.\n` });
  writeClaudeInstall(home, 'ck-test-market', 'document-tools', '1.2.0', { 'skills/pdf-reader/SKILL.md': marketText('document-tools/skills/pdf-reader/SKILL.md'), 'skills/spreadsheet/SKILL.md': `${marketText('document-tools/skills/spreadsheet/SKILL.md')}\nMine.\n` });
  writeClaudeInstall(home, 'ck-test-market', 'release-helper', '0.4.1', { 'commands/release-notes.md': marketText('release-helper/commands/release-notes.md'), 'agents/release-reviewer.md': marketText('release-helper/agents/release-reviewer.md') });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  const first = await launch(data);
  same('the marketplace is added', await first.run(`window.centralKnot.addMarketplace(${JSON.stringify(market)}).then(result => result.problem ?? 'added')`), 'added');
  await first.quit();
  const a = await launch(data);
  const row = name => `[data-plugin="${name}"] .plugin-row-warning`;
  const started = Date.now();
  await a.run(`(document.querySelector('#nav-plugins').click(), true)`);
  for (let tries = 0; tries < 200 && !(await a.exists('[data-plugin="issue-tracker"]')); tries++) await wait(10);
  const drawn = Date.now() - started;
  for (let tries = 0; tries < 100 && !(await a.exists(row('document-tools'))); tries++) await wait(50);
  const known = Date.now() - started;
  await a.settle();
  same('after a fresh launch, with no plugin page opened, the list says which copies differ and offers Update', [await a.text(row('issue-tracker')), await a.text(row('document-tools')), await a.exists(row('release-helper')),
    await a.text('#pupdate-0-issue-tracker'), await a.run(`document.querySelector('#pcell-0-issue-tracker-claude-cli')?.dataset.state`), /2 plugins have an update/.test(await a.text('#plugins-scroll') ?? ''), await a.exists('#plugin-back')],
  ['Claude Code differs from the marketplace’s copy', 'Claude Code differs from the marketplace’s copy', false, 'Update in Claude Code', 'outdated', true, false]);
  console.log(`(Plugins list drawn ${drawn} ms after opening it; the differing copies known after ${known} ms)`);
  same('no page errors, list differs', a.pageErrors, []);
  await a.quit();
  // Update all runs both updates in one run, with one result. A newer release of the app, downloading meanwhile, becomes ready
  // during that run and waits: a restart between two of its steps would stop the rest.
  const claudeStub = join(HOME, '.local/bin/claude'), stubBefore = readFileSync(claudeStub, 'utf8'), cache = join(home, '.claude/plugins/cache/ck-test-market');
  writeFileSync(claudeStub, `#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.309 (Claude Code)" && exit 0\ncase "$1 $2 $4 $5" in\n  "plugin update --scope user") sleep 3; name="\${3%@*}"; for copy in '${cache}'/"$name"/*/; do cp -R '${join(market, 'plugins')}'/"$name"/. "$copy"; done ;;\n  *) exit 9 ;;\nesac\n`);
  const zip = join(scratch, 'update-all.zip');
  writeFileSync(zip, Buffer.alloc(3_000_000, 7));
  const fixture = await serveReleases([{ tag: 'v0.5.0-preview.5', zip, bytesPerSecond: 1_000_000 }]);
  const b = await launch(data, [], HOME, { CK_UPDATE_STUB: 'v0.5.0-preview.4', CK_UPDATE_RELEASES: fixture.releasesUrl });
  try {
    const look = () => b.run(`document.getElementById('update-control')?.dataset.look`), busy = () => b.run(`document.body.dataset.busy === 'true'`);
    const behind = async () => await b.exists(row('issue-tracker')) || await b.exists(row('document-tools'));
    await b.run(`(document.querySelector('#nav-plugins').click(), true)`);
    for (let tries = 0; tries < 200 && !(await b.exists(row('issue-tracker')) && await b.exists(row('document-tools')) && await look() === 'available'); tries++) await wait(100);
    same('Update all says before the click what it runs, the copies it replaces, and that it can’t be undone', await b.run(`document.querySelector('#market-update-all-0').title`),
      'Updates document-tools in Claude Code and issue-tracker in Claude Code. It replaces the copies that differ from the marketplace’s: document-tools and issue-tracker. Runs now. An update can’t be undone.');
    // The release downloads in about 3 seconds; each plugin's update takes 3.
    await b.run(`(document.getElementById('update-control').click(), document.getElementById('market-update-all-0').click(), true)`);
    // A restart in the middle (the stand-in's install quits the app) would leave the page unreachable: that is raced, not waited on.
    const quit = new Promise(done => b.child.once('exit', () => done('restarted mid-run')));
    const held = (async () => { for (let tries = 0; tries < 80 && await look() !== 'held'; tries++) await wait(250); return 'waited'; })();
    same('the app’s update, ready during the run, waits for it rather than restarting', await Promise.race([quit, held]), 'waited');
    if (b.child.exitCode === null) {
      same('and the control says why while the run goes on', [await look(), await busy(), /Restarting now stops the plugin changes under way\./.test(await b.run(`document.getElementById('update-control').title`))], ['held', true, true]);
      for (let tries = 0; tries < 150 && (await busy() || await behind()); tries++) await wait(100);
      const said = await b.run(`document.querySelector('#announcement')?.dataset.text ?? ''`);
      check('the run went to its end: both updates in one result, no Undo, no row behind, and the app still running', !(await behind()) && !(await b.exists('#plugins-undo')) && b.child.exitCode === null
        && /document-tools: updated to the marketplace’s copy of 1\.2\.0 in Claude Code.*; issue-tracker: updated to the marketplace’s copy of 2\.0\.0 in Claude Code/.test(said), said);
      same('no page errors, Update all', b.pageErrors, []);
    }
  } finally { writeFileSync(claudeStub, stubBefore); await b.quit(); await fixture.close(); }
}

async function repoBaseFlow() {
  const git = (...rest) => spawnSync('git', rest, { encoding: 'utf8' });
  if (git('--version').status !== 0) { console.log('repo base: skipped, no git on this machine'); return; }
  const remote = join(scratch, 'base-repo.git');
  git('init', '--quiet', '--bare', '--initial-branch=main', remote);
  // Folder homes outside the HOME the app is given (that one counts as real, which Linux never writes).
  const realHome = join(scratch, 'repo-real');
  const homes = { first: join(scratch, 'repo-first'), second: join(scratch, 'repo-second') };
  mkdirSync(realHome, { recursive: true });
  for (const home of Object.values(homes)) { mkdirSync(join(home, '.claude'), { recursive: true }); writeFileSync(join(home, '.claude/CLAUDE.md'), 'My own notes.\n'); }
  const open = async name => {
    const data = join(scratch, `repo-${name}-data`);
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: homes[name] } }));
    return launch(data, [], realHome);
  };
  const api = (a, body) => a.run(`(async () => { const api = window.centralKnot; const home = (await api.refresh()).home; ${body} })()`);
  // As the Instructions page saves it: the base, with Claude Code getting it.
  const setBase = (a, text) => api(a, `const base = await api.instructionBase(); const seen = Object.fromEntries((await api.instructions()).map(file => [file.tool, { path: file.path, hash: file.hash }]));
    const done = await api.applyBase({ text: ${JSON.stringify(text)}, expected: base.hash, tools: ['claude-cli'], seen }, home); return done.stopped ?? 'saved';`);
  const push = a => api(a, `const done = await api.pushRepo(home); return done.stopped ?? 'pushed';`);
  const baseText = name => readNow(join(homes[name], '.central-knot/instructions/base.md'));
  const claudeText = name => readNow(join(homes[name], '.claude/CLAUDE.md'));
  const until = async (test, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await wait(100); } return false; };
  const baseRow = `.repo-row[data-key="instructions:base"]`;
  /** Clicks Pull and waits for its work to reach base.md. */
  const pull = async (a, wanted) => {
    await until(() => a.exists('#repo-pull:not([disabled])'));
    await a.click('#repo-pull');
    if (!(await until(async () => baseText('second') === wanted))) console.error('repo base: Pull said', await a.text('.page'));
  };
  /** Opens the Git repo page (it checks the repo) and waits for the base's row to read `label`; returns the row's text. */
  const rowSays = async (a, label) => {
    await a.click('#nav-overview');
    await a.click('#nav-repo');
    await until(async () => (await a.text(baseRow) ?? '').includes(label));
    return await a.text(baseRow) ?? '';
  };

  const first = await open('first');
  same('the first home saves a base and pushes it', [await setBase(first, 'Be brief.\n'), await api(first, `return (await api.connectRepo(${JSON.stringify(remote)}, '', home)).stopped ?? 'connected';`), await push(first)], ['saved', 'connected', 'pushed']);
  const second = await open('second');
  await setBase(second, 'Be thorough.\n');
  await api(second, `return (await api.connectRepo(${JSON.stringify(remote)}, '', home)).stopped ?? 'connected';`);
  check('the second home’s Git repo page lists the base as coming in', (await rowSays(second, 'in the repo')).includes('Base instructions'), await second.text('#repo-incoming'));
  await pull(second, 'Be brief.\n');
  same('Pull sets the base, and Claude Code, which gets it, has it', [baseText('second'), claudeText('second').includes('Be brief.')], ['Be brief.\n', true]);

  same('an edit in the first home goes out', [await setBase(first, 'Be briefer.\n'), await push(first)], ['saved', 'pushed']);
  check('and shows as changed in the repo', (await rowSays(second, 'Changed in the repo')).includes('Changed in the repo'), await second.text('#repo-incoming'));
  await pull(second, 'Be briefer.\n');
  same('Pull brings the edit in', [baseText('second'), claudeText('second').includes('Be briefer.')], ['Be briefer.\n', true]);
  const undoneSays = (a, words) => a.run(`[...document.querySelectorAll('.history-row.history-undone')].some(row => row.textContent.includes(${JSON.stringify(words)}))`);
  await second.click('#nav-history');
  const edit = await api(second, `return (await api.history()).events.filter(event => event.key === 'instructions:base' && event.kind === 'edit').at(-1)?.id ?? null;`);
  await until(async () => second.exists(`#history-${edit}`));
  check('History has the pulled edit, with an Undo of the pull', edit && (await second.text('.history-list') ?? '').includes('Changed in the git repo, so Pull updated the base instructions in Claude Code.') && await second.text(`#history-${edit}`) === 'Undo pull in Claude Code', await second.text('.history-list'));
  await second.click(`#history-${edit}`);
  await until(async () => baseText('second') === 'Be brief.\n');
  same('its Undo puts the earlier base back, in Claude Code too', [baseText('second'), claudeText('second').includes('Be brief.'), claudeText('second').includes('Be briefer.')], ['Be brief.\n', true, false]);
  check('and the row reads as undone', await until(() => undoneSays(second, 'Pull updated the base instructions')), await second.text('.history-list'));
  // Saved again as the repo has it, so nothing waits to go out before the deletion below.
  same('the repo’s text saved again', await setBase(second, 'Be briefer.\n'), 'saved');

  same('the first home deletes the base and pushes', [await setBase(first, ''), await push(first)], ['saved', 'pushed']);
  const deleting = await rowSays(second, 'Removed in the repo');
  check('before Pull, the page says the base is deleted in the repo and what Pull does', deleting.includes('Removed in the repo') && deleting.includes('Pull empties the base instructions'), deleting);
  await pull(second, '');
  same('Pull empties the base and takes it out of Claude Code, which keeps its own text', [baseText('second'), claudeText('second').includes('Be briefer.'), claudeText('second').includes('My own notes.')], ['', false, true]);
  await second.click('#nav-history');
  const event = await api(second, `return (await api.history()).events.find(event => event.key === 'instructions:base' && event.kind === 'deleted')?.id ?? null;`);
  await until(async () => second.exists(`#history-${event}`));
  check('History has the deletion, with an Undo', event && /Pull emptied the base instructions/.test(await second.text('.history-list') ?? ''), await second.text('.history-list'));
  await second.click(`#history-${event}`);
  same('Undo puts the base back, and Claude Code gets it again', [baseText('second'), claudeText('second').includes('Be briefer.'), await api(second, `return (await api.instructionBase()).tools;`)], ['Be briefer.\n', true, ['claude-cli']]);
  check('and the row reads as undone', await until(() => undoneSays(second, 'Pull emptied the base instructions')), await second.text('.history-list'));
  await second.quit();
  await first.quit();
}

/**
 * Sources (src/sources.ts): the owner's link pasted as it is, https://github.com/stephenturner/skill-deslop/tree/main, with a
 * made-up local repository standing in for GitHub (git's own url.<base>.insteadOf, given to the app's git: nothing reaches the
 * network). Look offers one skill, deslop, with its files; Add puts it in Central Knot, Off, in no tool; its opened row on Skills
 * and its versions say where it is from; On gives every tool all of it, byte for byte; a change there comes in at Check now; edited
 * in a tool, its next change there waits, said on Sources and on its Skills row, and Replace takes it; a rename there turns it Off
 * with an entry in History; a link that is a plugin is refused; the page fits at the smallest window; Remove leaves the skill as
 * it is.
 */
async function sourcesFlow() {
  const git = (cwd, ...rest) => spawnSync('git', ['-C', cwd, '-c', 'user.name=Tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', ...rest], { encoding: 'utf8' });
  if (spawnSync('git', ['--version']).status !== 0) { console.log('sources: skipped, no git on this machine'); return; }
  const hosts = join(scratch, 'source-hosts'), deslop = join(hosts, 'github.com/stephenturner/skill-deslop.git');
  const files = { 'SKILL.md': '---\nname: deslop\ndescription: Removes slop from prose.\n---\n\nRemove slop.\n', 'references/phrases.md': 'Phrases.\n', 'references/structures.md': 'Structures.\n', 'references/examples.md': 'Examples.\n', 'references/checklist.md': 'Checklist.\n', 'README.md': '# skill-deslop\n', 'LICENSE': 'MIT\n', '.gitignore': '.DS_Store\n' };
  const commit = (dir, change) => { for (const [path, text] of Object.entries(change)) { if (text === null) rmSync(join(dir, path), { recursive: true, force: true }); else { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); } } git(dir, 'add', '--all'); git(dir, 'commit', '--quiet', '-m', 'change'); };
  mkdirSync(deslop, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main', deslop]);
  commit(deslop, files);
  const plugin = join(hosts, 'github.com/team/plugin.git');
  mkdirSync(plugin, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main', plugin]);
  commit(plugin, { '.claude-plugin/plugin.json': '{"name":"plugin"}', 'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: PDFs.\n---\nPDFs.\n', 'commands/go.md': 'Go.\n', 'commands/stop.md': 'Stop.\n', 'hooks/hooks.json': '{"hooks":{"PreToolUse":[]}}' });
  const market = join(hosts, 'github.com/team/market.git');
  mkdirSync(market, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main', market]);
  commit(market, { '.claude-plugin/marketplace.json': JSON.stringify({ name: 'acme-tools', plugins: [{ name: 'kit', source: './plugins/kit' }] }), 'plugins/kit/.claude-plugin/plugin.json': '{"name":"kit"}', 'plugins/kit/skills/notes/SKILL.md': '---\nname: notes\ndescription: Notes.\n---\nNotes.\n' });
  const home = join(scratch, 'sources-home'), data = join(scratch, 'sources-data');
  const roots = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills' };
  for (const root of Object.values(roots)) mkdirSync(join(home, root), { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  const a = await launch(data, [], join(scratch, 'sources-real'), { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${join(hosts, 'github.com')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/' });
  const record = () => JSON.parse(readNow(join(home, '.central-knot/skills.json')) || '{"items":{}}').items.deslop;
  const until = async (test, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await wait(100); } return false; };
  const type = async (text) => a.run(`(() => { const input = document.querySelector('#source-link'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

  same('the sidebar names the page Library sources, between Plugins and Profiles', [await a.text('#nav-sources .nav-label'),
    await a.run(`[document.querySelector('#nav-sources').previousElementSibling?.id, document.querySelector('#nav-sources').nextElementSibling?.id]`)], ['Library sources', ['nav-plugins', 'nav-profiles']]);
  // The Plugins page is Plugin marketplaces: its row, just above Library sources, and its title. Every row's name shows whole
  // wherever the sidebar shows names (at the smallest window only once it is opened: its rail shows the marks alone).
  same('the sidebar names the Plugins page Plugin marketplaces', await a.text('#nav-plugins .nav-label'), 'Plugin marketplaces');
  for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) {
    await sizeTo(a, width, height);
    const rail = await a.run(`document.body.classList.contains('rail')`);
    if (rail) await a.click('#sidebar-toggle');
    same(`every sidebar row’s name shows whole at ${width}×${height}${rail ? ', the sidebar opened' : ''}`,
      await a.run(`[...document.querySelectorAll('#nav .nav-label')].filter(label => !label.offsetWidth || label.scrollWidth > label.clientWidth).map(label => label.textContent)`), []);
    if (rail) await a.click('#sidebar-toggle');
  }
  await fullSize(a);
  await a.click('#nav-plugins');
  same('the Plugins page’s title says Plugin marketplaces', await a.text('.page-title'), 'Plugin marketplaces');
  await a.click('#nav-sources');
  same('the page’s title says Library sources, and its last line says a marketplace’s link goes to Plugin marketplaces instead', [await a.text('.page-title'), await a.text('.repo-aside')],
    ['Library sources', 'A marketplace’s link isn’t a library source: Look offers Add to Plugin marketplaces instead, where each of its plugins has its own switch.']);
  check('the Sources page opens empty, with its field', await a.exists('#source-link') && /No sources yet/.test(await a.text('.page') ?? ''), await a.text('.page'));
  await type('https://github.com/stephenturner/skill-deslop/tree/main');
  await a.click('#source-look');
  await until(() => a.exists('#source-preview'));
  const offered = await a.text('.source-name[data-key="deslop"]') ?? '';
  check('Look offers one skill, deslop, at the root of skill-deslop, coming in Off, with the files beside its SKILL.md', (await a.all('#source-preview .source-name', 'e.dataset.key')).join() === 'deslop' && /deslop\s*skill, at the root of skill-deslop/.test(offered) && /Comes in, Off/.test(offered) && /8 files/.test(offered) && /references\/checklist\.md/.test(offered), offered);
  same('a look keeps nothing and writes no tool', [record(), existsSync(join(home, roots['claude-cli'], 'deslop'))], [undefined, false]);
  await a.shot('sources-look');
  await a.click('#source-add');
  await until(() => a.exists('.source-row'));
  check('Add says deslop is in Central Knot, Off', /Added github\.com\/stephenturner\/skill-deslop \(main\)\. deslop is in Central Knot, Off: turn it on in Skills\./.test(await a.text('.band-done .band-text') ?? ''), await a.text('.band-done'));
  same('in Central Knot, Off, in no tool', [record()?.on, Object.values(roots).some(root => existsSync(join(home, root, 'deslop')))], [false, false]);
  check('its row says it is in Central Knot, Off, and says beforehand that Check now can change skills and agents in the tools', /In Central Knot, Off/.test(await a.text('.source-row .source-name[data-key="deslop"]') ?? '')
    && /Check now reads the link again, as Central Knot does once a day while Automatic sync is on: a skill, an agent or an MCP server changed there is updated in the tools it is on in, unless you changed it here \(then it waits for you\); one no longer there is turned off and taken out of them\./.test(await a.text('.source-row') ?? ''), await a.text('.source-row'));
  const id = await a.run(`document.querySelector('.source-row').dataset.source`);

  await a.click('#nav-skills');
  await a.click(`#${rowPart('open', 'skills', 'deslop')}`);
  const opened = await a.text('.details') ?? '';
  check('its opened row on Skills says which source it is from, and its version says so too', /From github\.com\/stephenturner\/skill-deslop \(main\), a source\. What changes there comes in once a day while Automatic sync is on, and at Check now on Library sources, unless you change it here\./.test(opened) && /from github\.com\/stephenturner\/skill-deslop \(main\)/.test(opened), opened);
  await a.click(`#${rowPart('switch', 'skills', 'deslop')}`);
  const asGiven = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text]));
  const inTool = root => Object.fromEntries(Object.keys(files).map(path => [path, readNow(join(home, root, 'deslop', path))]));
  check('turned On, every tool gets SKILL.md and all four reference files, byte for byte', await until(() => Object.values(roots).every(root => JSON.stringify(inTool(root)) === JSON.stringify(asGiven))), Object.values(roots).map(inTool));

  commit(deslop, { 'SKILL.md': files['SKILL.md'].replace('Remove slop.', 'Remove slop, gently.') });
  await a.click('#nav-sources');
  await a.click(`#source-check-${id}`);
  check('Check now brings the change in, and the band says it was updated and where it went, with its Undo', /deslop was updated from its source, now in all 3 tools\./.test(await a.text('.band-done .band-text') ?? '') && await a.exists('#outcome-undo') && await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('gently'))), await a.text('.band-done'));

  // Edited in Claude Code (sync takes it in), then changed at the source: the source's version waits; Replace takes it.
  const inClaude = join(home, roots['claude-cli'], 'deslop/SKILL.md');
  // The page is told of an edit sync took in by a refresh of its own, whose notice would take the place of the next click's
  // band: after each edit in a tool it comes first.
  const toldOfEdit = name => until(async () => (await a.text('#announcement') ?? '').includes(`Sync changed ${name}`));
  writeFileSync(inClaude, readNow(inClaude).replace('gently', 'my way'));
  check('an edit in Claude Code is taken in and reaches every tool', await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('my way'))), Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md'))));
  await toldOfEdit('deslop');
  commit(deslop, { 'SKILL.md': files['SKILL.md'].replace('Remove slop.', 'Remove slop, firmly.') });
  await a.click(`#source-check-${id}`);
  await until(async () => await a.exists(`#source-replace-${id}-skill-deslop`));
  check('Check now leaves the edit current in every tool, says the source’s version waits, and its line offers Merge, Replace and Keep mine', /deslop changed at the source; yours stays current, since it was changed here or a tool’s copy can’t be read just now: on its row, Merge puts the source’s changes into yours if they don’t clash, Replace takes the source’s, and Keep mine keeps yours\./.test(await a.text('.band-done .band-text') ?? '')
    && /Changed at the source\. Yours stays current until you merge, replace or keep it, since it was changed here or a tool’s copy can’t be read just now\./.test(await a.text('.source-row .source-name[data-key="deslop"]') ?? '') && await a.exists(`#source-merge-${id}-skill-deslop`) && await a.exists(`#source-keep-${id}-skill-deslop`)
    && Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('my way')), [await a.text('.band-done'), await a.text('.source-row')]);
  await a.shot('sources-waiting');
  await a.click('#nav-skills');
  const waitingRow = await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`) ?? '';
  if (!(await a.exists('.details'))) await a.click(`#${rowPart('open', 'skills', 'deslop')}`);
  check('its row on Skills says the source has an update, and its opened row says Merge and Replace are on Library sources', /update at its source/.test(waitingRow) && /which has a newer version\. Yours stays current, since it was changed here or a tool’s copy of it can’t be read just now\. On Library sources, Merge puts its changes into yours if they don’t clash, and Replace takes it as it is; either keeps yours as a version\./.test(await a.text('.details') ?? ''), [waitingRow, await a.text('.details')]);
  await a.shot('skills-waiting');
  await a.click('#nav-sources');
  await a.click(`#source-replace-${id}-skill-deslop`);
  check('Replace puts the source’s version in every tool, says the one it had is kept, and offers Undo the replace', await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('firmly')))
    && /deslop has the source’s version, now in all 3 tools; the one it had is kept as a version\./.test(await a.text('.band-done .band-text') ?? '') && (await a.text('#outcome-undo')) === 'Undo the replace'
    && !(await a.exists(`#source-replace-${id}-skill-deslop`)), await a.text('.band-done'));

  // Merge: a line added in Claude Code and the source's new description, lines apart, become one version in every tool.
  writeFileSync(inClaude, `${readNow(inClaude)}Use plain words.\n`);
  check('a line added in Claude Code is taken in and reaches every tool', await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('Use plain words.'))), Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md'))));
  await toldOfEdit('deslop');
  const described = files['SKILL.md'].replace('Remove slop.', 'Remove slop, firmly.').replace('Removes slop from prose.', 'Removes slop from any prose.');
  commit(deslop, { 'SKILL.md': described });
  await a.click(`#source-check-${id}`);
  await until(async () => await a.exists(`#source-merge-${id}-skill-deslop`));
  const versionsBefore = record()?.versions.length;
  await a.click(`#source-merge-${id}-skill-deslop`);
  const bothIn = described.replace(/\n$/, '\nUse plain words.\n');
  check('Merge puts both changes in every tool’s SKILL.md, says so with Undo the merge, and the line no longer waits', await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')) === bothIn))
    && /deslop now has your changes and the source’s, merged, in all 3 tools; the version it had is kept\./.test(await a.text('.band-done .band-text') ?? '') && (await a.text('#outcome-undo')) === 'Undo the merge'
    && !(await a.exists(`#source-merge-${id}-skill-deslop`)) && record()?.versions.length === versionsBefore + 2, [await a.text('.band-done'), Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md')))]);
  await a.shot('sources-merged');
  await a.click('#nav-skills');
  if (!(await a.exists('.details'))) await a.click(`#${rowPart('open', 'skills', 'deslop')}`);
  check('its opened row on Skills says it is still changed here, so the source’s next change will wait for Merge, Replace or Keep mine', /You changed it here, or a tool’s copy of it can’t be read just now, so the source’s next change will wait for you to Merge, Replace or Keep mine on Library sources\./.test(await a.text('.details') ?? ''), await a.text('.details'));
  // A clash: the same line changed in Claude Code and at the source. Merge names the file and changes nothing.
  await a.click('#nav-sources');
  writeFileSync(inClaude, readNow(inClaude).replace('Remove slop, firmly.', 'Remove slop, my way.'));
  check('the clashing edit is taken in and reaches every tool', await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('my way'))), Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md'))));
  await toldOfEdit('deslop');
  commit(deslop, { 'SKILL.md': described.replace('Remove slop, firmly.', 'Remove slop, kindly.') });
  await a.click(`#source-check-${id}`);
  await until(async () => await a.exists(`#source-merge-${id}-skill-deslop`));
  const clashBefore = { versions: record()?.versions.length, seen: record()?.seen, tools: Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md'))) };
  await a.click(`#source-merge-${id}-skill-deslop`);
  check('a Merge that clashes names SKILL.md, as a warning, says Keep mine is the way past a change made by hand, and changes nothing: every tool as it was, no version, the source’s version still waits', await until(async () => /Merge left deslop as it was: SKILL\.md changed both here and at the source, in ways that can’t be merged\. Replace takes the source’s version and keeps yours as a version; or make the source’s change in yours by hand, then Keep mine\. Until then, yours stays current and the update keeps waiting\./.test(await a.text('.band-done .band-text') ?? ''))
    && await a.exists('.band-done svg.tone-warning') && !(await a.exists('#outcome-undo')) && await a.exists(`#source-merge-${id}-skill-deslop`)
    && JSON.stringify({ versions: record()?.versions.length, seen: record()?.seen, tools: Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md'))) }) === JSON.stringify(clashBefore), [await a.text('.band-done'), clashBefore]);
  await a.shot('sources-merge-clash');
  // Keep mine: yours stays in every tool, and the source's version no longer waits; its Undo makes it wait again.
  await a.click(`#source-keep-${id}-skill-deslop`);
  check('Keep mine leaves every tool as it was, keeps the source’s version as a version, says so with Undo keep mine, and the line no longer waits', await until(async () => /deslop stays as you have it, and the source’s version no longer waits: it is kept as a version, and the source’s next change is compared with it\./.test(await a.text('.band-done .band-text') ?? ''))
    && (await a.text('#outcome-undo')) === 'Undo keep mine' && !(await a.exists(`#source-keep-${id}-skill-deslop`)) && record()?.versions.length === clashBefore.versions + 1 && record()?.seen !== clashBefore.seen
    && JSON.stringify(Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md')))) === JSON.stringify(clashBefore.tools), [await a.text('.band-done'), await a.text('.source-row')]);
  await a.shot('sources-kept');
  await a.click('#outcome-undo');
  check('its Undo makes the source’s version wait again, with every tool as it was', await until(async () => await a.exists(`#source-keep-${id}-skill-deslop`)) && record()?.seen === clashBefore.seen
    && JSON.stringify(Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md')))) === JSON.stringify(clashBefore.tools), [await a.text('.band-done'), await a.text('.source-row')]);
  // The source's change made by hand in Claude Code, with a change of its own lines apart: Merge's result is exactly yours,
  // Keep mine's outcome, with its Undo and History's note.
  writeFileSync(inClaude, described.replace('Remove slop, firmly.', 'Remove slop, kindly.').replace('Removes slop from any prose.', 'Removes slop from any prose, my way.'));
  check('the source’s change made by hand is taken in and reaches every tool', await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('any prose, my way.'))), Object.values(roots).map(root => readNow(join(home, root, 'deslop/SKILL.md'))));
  await toldOfEdit('deslop');
  await until(() => a.run(`document.body.dataset.busy !== 'true' && document.querySelector('#source-merge-${id}-skill-deslop')?.disabled === false`));
  await a.click(`#source-merge-${id}-skill-deslop`);
  check('a Merge that finds the source’s change in yours already says so, offers Undo the merge and History’s note, and the line no longer waits', await until(async () => /deslop already had the source’s changes, so Merge changed nothing in it; the source’s version no longer waits\./.test(await a.text('.band-done .band-text') ?? ''))
    && (await a.text('#outcome-undo')) === 'Undo the merge' && await a.exists('#outcome-note-history') && !(await a.exists(`#source-merge-${id}-skill-deslop`)), [await a.text('.band-done'), await a.text('.source-row .source-name[data-key="deslop"]')]);

  commit(deslop, { 'SKILL.md': files['SKILL.md'].replace('name: deslop', 'name: unslop') });
  await a.click(`#source-check-${id}`);
  check('renamed there, Check now turns deslop Off and takes it out of every tool, said first, as a warning, with Turn on; unslop comes in Off', /^deslop is no longer at github\.com\/stephenturner\/skill-deslop \(main\): it was turned off and taken out of all 3 tools; Central Knot keeps it\./.test(await a.text('.band-done .band-text') ?? '')
    && /unslop is in Central Knot, Off/.test(await a.text('.band-done .band-text') ?? '') && await a.exists('.band-done svg.tone-warning') && (await a.text('#outcome-undo')) === 'Turn deslop on'
    && await until(() => Object.values(roots).every(root => !existsSync(join(home, root, 'deslop')))) && record()?.on === false, await a.text('.band-done'));
  await a.click('#nav-history');
  check('History says the source dropped it', await until(async () => /github\.com\/stephenturner\/skill-deslop \(main\) no longer has it, so it is off and removed from all 3 tools/.test(await a.text('.page') ?? '')), await a.text('.page'));
  // The notice that stays: deslop's line on the source's row, and its row on Skills, until it is turned on.
  await a.click('#nav-sources');
  check('the source’s row keeps a line for deslop, removed there, with Turn it on', await until(async () => /No longer at this source: it is Off, and no longer from it\./.test(await a.text('.source-row .source-name[data-key="deslop"][data-state="removed"]') ?? '')) && await a.text('#source-turn-on-skill-deslop') === 'Turn it on', await a.text('.source-row'));
  await a.shot('sources-removed');
  await a.click('#nav-skills');
  if (!(await a.exists('.details'))) await a.click(`#${rowPart('open', 'skills', 'deslop')}`);
  check('its row on Skills says “removed at its source”, and its opened row says it is Off and no longer from that source, and what happens if the source has it again', /removed at its source/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`) ?? '')
    && /github\.com\/stephenturner\/skill-deslop \(main\) no longer has it: it is Off, and no longer from that source\. Turn it on to use it again\. Should github\.com\/stephenturner\/skill-deslop \(main\) have it again, it follows the source if unchanged here, and stays as you have it if you changed it\./.test(await a.text('.details') ?? ''), [await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'deslop')}"]`), await a.text('.details')]);
  await a.shot('skills-removed');
  await a.click('#nav-sources');
  await a.click('#source-turn-on-skill-deslop');
  check('Turn it on puts deslop in every tool, says so with Undo, and its line goes', await until(() => Object.values(roots).every(root => existsSync(join(home, root, 'deslop/SKILL.md'))))
    && await until(async () => /deslop is on in all 3 tools\./.test(await a.text('.band-done .band-text') ?? '')) && await a.exists('#outcome-undo') && !(await a.exists('#source-turn-on-skill-deslop')) && record()?.on === true, [await a.text('.band-done'), await a.text('.source-row')]);
  await a.shot('sources-turned-on');
  // Add on a name the library holds deleted: unslop, deleted from Central Knot on Skills, comes back Off from its line.
  const unslop = () => JSON.parse(readNow(join(home, '.central-knot/skills.json')) || '{"items":{}}').items.unslop;
  await a.click('#nav-skills');
  if (!(await a.exists(`#${rowPart('delete', 'skills', 'unslop')}`))) await a.click(`#${rowPart('open', 'skills', 'unslop')}`);
  await until(() => a.exists(`#${rowPart('delete', 'skills', 'unslop')}`));
  await a.click(`#${rowPart('delete', 'skills', 'unslop')}`);
  await a.click(`#${rowPart('delete-confirm', 'skills', 'unslop')}`);
  check('unslop, deleted from Central Knot on Skills', await until(() => !!unslop()?.deleted), unslop());
  await a.click('#nav-sources');
  check('its line on the source’s row says it is deleted, with Add', await until(async () => await a.exists(`#source-bring-${id}-skill-unslop`)) && /Not brought in: deleted from Central Knot\./.test(await a.text('.source-row .source-name[data-key="unslop"]') ?? ''), await a.text('.source-row'));
  await a.click(`#source-bring-${id}-skill-unslop`);
  check('Add on its line brings unslop back into Central Knot, Off, and says so', await until(async () => /unslop is in Central Knot, Off: turn it on in Skills\./.test(await a.text('.band-done .band-text') ?? ''))
    && !unslop()?.deleted && unslop()?.on === false && !(await a.exists(`#source-bring-${id}-skill-unslop`)), [await a.text('.band-done'), unslop()]);

  // A source with a skill, an agent and an MCP server: the look lists all three, Add brings them in Off, the agent turned On on
  // Agents gets the source's file in Claude Code byte for byte, a change at the source alone updates it (Open Agents), and Merge
  // puts a change made in Claude Code and one made at the source together; the server turned On is in every tool's file at
  // once, Claude Code's with the source's own field, a change at the source reaches every tool (Open MCP servers), and Merge.
  const kit = join(hosts, 'github.com/team/kit.git'), reviewerMd = '---\nname: reviewer\ndescription: Reviews code.\ntools: Read, Grep\n---\n\nYou review code.\nThe middle.\nMore middle.\nBe brief.\n';
  const relayJson = env => `${JSON.stringify({ mcpServers: { relay: { command: 'relay-mcp', env, timeout: 30 } } }, null, 2)}\n`;
  mkdirSync(kit, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main', kit]);
  commit(kit, { 'notes/SKILL.md': '---\nname: notes\ndescription: Takes notes.\n---\n\nTake notes.\n', 'agents/reviewer.md': reviewerMd, '.mcp.json': relayJson({ A: '1', B: '1' }) });
  const agentFile = tool => join(home, { 'claude-cli': '.claude/agents/reviewer.md', 'copilot-cli': '.copilot/agents/reviewer.agent.md', 'codex-cli': '.codex/agents/reviewer.toml' }[tool]);
  const agentRecord = () => JSON.parse(readNow(join(home, '.central-knot/agents.json')) || '{"items":{}}').items.reviewer;
  await a.click('#nav-sources');
  await type('https://github.com/team/kit');
  await a.click('#source-look');
  await until(() => a.exists('#source-preview'));
  const kitLook = await a.text('#source-preview') ?? '';
  check('Look lists the skill, the agent and the server, each with its kind and where it sits, coming in Off, and Add says all three', (await a.all('#source-preview .source-name', 'e.dataset.kind + " " + e.dataset.key')).join() === 'skill notes,agent reviewer,mcp relay'
    && /reviewer\s*agent, in the folder agents/.test(await a.text('#source-preview .source-name[data-kind="agent"]') ?? '') && /1 file: reviewer\.md/.test(await a.text('#source-preview .source-name[data-kind="agent"]') ?? '')
    && /relay\s*MCP server, at the root of kit/.test(await a.text('#source-preview .source-name[data-kind="mcp"]') ?? '') && /1 file: \.mcp\.json/.test(await a.text('#source-preview .source-name[data-kind="mcp"]') ?? '')
    && (await a.text('#source-add'))?.trim() === 'Add 1 skill, 1 agent and 1 MCP server', kitLook);
  await a.shot('sources-look-agent');
  await a.click('#source-add');
  await until(async () => (await a.all('.source-row')).length === 2);
  check('Add says notes, reviewer and relay are in Central Knot, Off, to turn on in Skills, Agents and MCP servers', /notes, reviewer and relay are in Central Knot, Off: turn them on in Skills, Agents and MCP servers\./.test(await a.text('.band-done .band-text') ?? '') && agentRecord()?.on === false, await a.text('.band-done'));
  const kitId = await a.run(`[...document.querySelectorAll('.source-row')].find(row => row.textContent.includes('team/kit')).dataset.source`);
  await a.click('#nav-agents');
  await until(() => a.exists(`#${rowPart('open', 'agents', 'reviewer')}`));
  await a.click(`#${rowPart('open', 'agents', 'reviewer')}`);
  check('its opened row on Agents says which source it is from', /From github\.com\/team\/kit, a source\./.test(await a.text('.details') ?? ''), await a.text('.details'));
  await a.shot('agents-from-source');
  await a.click(`#${rowPart('switch', 'agents', 'reviewer')}`);
  check('turned On, Claude Code gets the source’s file byte for byte, and every tool has the agent', await until(() => readNow(agentFile('claude-cli')) === reviewerMd && ['copilot-cli', 'codex-cli'].every(tool => existsSync(agentFile(tool)))), ['claude-cli', 'copilot-cli', 'codex-cli'].map(tool => readNow(agentFile(tool))));
  await a.click('#nav-sources');
  commit(kit, { 'agents/reviewer.md': reviewerMd.replace('Be brief.', 'Be brief and kind.') });
  await a.click(`#source-check-${kitId}`);
  check('a change at the source updates the agent in every tool, and the band opens Agents', await until(async () => /reviewer was updated from its source, now in all 3 tools\./.test(await a.text('.band-done .band-text') ?? ''))
    && await a.exists('#source-open-agents') && await until(() => ['claude-cli', 'copilot-cli', 'codex-cli'].every(tool => readNow(agentFile(tool)).includes('Be brief and kind.'))), await a.text('.band-done'));
  writeFileSync(agentFile('claude-cli'), readNow(agentFile('claude-cli')).replace('You review code.', 'You review code, mine.'));
  // Agents folders the app made after it opened the home aren't watched (main.ts startWatching watches what is there), so
  // the edit is taken in by the pass the next event elsewhere prompts or by the poll (main.ts POLL_MS, 20 s): waited for.
  check('an edit in Claude Code is taken in and reaches every tool', await until(() => ['copilot-cli', 'codex-cli'].every(tool => readNow(agentFile(tool)).includes('You review code, mine.')), 30000), ['copilot-cli', 'codex-cli'].map(tool => readNow(agentFile(tool))));
  await toldOfEdit('reviewer');
  commit(kit, { 'agents/reviewer.md': reviewerMd.replace('Be brief.', 'Be brief, kind and exact.') });
  await a.click(`#source-check-${kitId}`);
  await until(async () => await a.exists(`#source-merge-${kitId}-agent-reviewer`));
  check('changed both here and at the source, the agent’s line waits with Merge, Replace and Keep mine', await a.exists(`#source-replace-${kitId}-agent-reviewer`) && await a.exists(`#source-keep-${kitId}-agent-reviewer`)
    && /Changed at the source\./.test(await a.text(`.source-row[data-source="${kitId}"] .source-name[data-kind="agent"]`) ?? ''), await a.text(`.source-row[data-source="${kitId}"]`));
  await a.shot('sources-agent-waiting');
  await until(() => a.run(`document.body.dataset.busy !== 'true' && document.querySelector('#source-merge-${kitId}-agent-reviewer')?.disabled === false`));
  await a.click(`#source-merge-${kitId}-agent-reviewer`);
  check('Merge puts both changes in every tool, keeps Claude Code’s own fields, and says so with Undo the merge', await until(async () => /reviewer now has your changes and the source’s, merged, in all 3 tools; the version it had is kept\./.test(await a.text('.band-done .band-text') ?? ''))
    && (await a.text('#outcome-undo')) === 'Undo the merge'
    && await until(() => ['claude-cli', 'copilot-cli', 'codex-cli'].every(tool => /You review code, mine\.[\s\S]*Be brief, kind and exact\./.test(readNow(agentFile(tool))))) && readNow(agentFile('claude-cli')).includes('tools: Read, Grep'), [await a.text('.band-done'), readNow(agentFile('claude-cli'))]);

  const mcpFile = tool => join(home, { 'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml' }[tool]);
  const relayIn = tool => JSON.parse(readNow(mcpFile(tool)) || '{}').mcpServers?.relay;
  await a.click('#nav-mcp');
  await until(() => a.exists(`#${rowPart('switch', 'mcp', 'relay')}`));
  await a.click(`#${rowPart('switch', 'mcp', 'relay')}`);
  check('the source’s server, turned On, is in every tool’s file at once, Claude Code’s with the source’s own field', await until(() => relayIn('copilot-cli')?.command === 'relay-mcp')
    && relayIn('claude-cli')?.timeout === 30 && /relay-mcp/.test(readNow(mcpFile('codex-cli'))), [readNow(mcpFile('copilot-cli')), readNow(mcpFile('claude-cli'))]);
  commit(kit, { '.mcp.json': relayJson({ A: '1', B: '2' }) });
  await a.click('#nav-sources');
  await a.click(`#source-check-${kitId}`);
  check('a change at the source updates every tool, Claude Code too, with Open MCP servers', await until(async () => /relay was updated from its source, now in all 3 tools\./.test(await a.text('.band-done .band-text') ?? ''))
    && await a.exists('#source-open-mcp') && relayIn('copilot-cli')?.env?.B === '2' && relayIn('claude-cli')?.env?.B === '2', [await a.text('.band-done'), readNow(mcpFile('claude-cli'))]);
  await a.shot('sources-server-updated');
  const copilotMcp = JSON.parse(readNow(mcpFile('copilot-cli')));
  copilotMcp.mcpServers.relay.env.A = 'mine';
  writeFileSync(mcpFile('copilot-cli'), JSON.stringify(copilotMcp, null, 2));
  check('an edit in Copilot CLI is taken in and reaches Codex', await until(() => /A = "mine"/.test(readNow(mcpFile('codex-cli')))), readNow(mcpFile('codex-cli')));
  await toldOfEdit('relay');
  commit(kit, { '.mcp.json': relayJson({ A: '1', B: '3' }) });
  await a.click(`#source-check-${kitId}`);
  await until(async () => await a.exists(`#source-merge-${kitId}-mcp-relay`));
  await until(() => a.run(`document.body.dataset.busy !== 'true' && document.querySelector('#source-merge-${kitId}-mcp-relay')?.disabled === false`));
  await a.click(`#source-merge-${kitId}-mcp-relay`);
  check('Merge puts both changes in every tool, Claude Code too, and offers Undo the merge', await until(async () => /relay now has your changes and the source’s, merged, in all 3 tools; the version it had is kept\./.test(await a.text('.band-done .band-text') ?? ''))
    && (await a.text('#outcome-undo')) === 'Undo the merge' && JSON.stringify(relayIn('copilot-cli')?.env) === '{"A":"mine","B":"3"}' && JSON.stringify(relayIn('claude-cli')?.env) === '{"A":"mine","B":"3"}', [await a.text('.band-done'), readNow(mcpFile('copilot-cli'))]);
  // Its entry at the source now runs a file of the repository: left out there, so the server here stays as it was, and its line says so.
  commit(kit, { '.mcp.json': `${JSON.stringify({ mcpServers: { relay: { command: './bin/relay' } } }, null, 2)}\n` });
  await a.click(`#source-check-${kitId}`);
  check('an entry the source now leaves out says the server here stays as it was, On, and it stays in Copilot CLI', await until(async () => /In Central Knot, On, as it was: what the source has now is not brought in, since it runs files from the repository, which aren’t copied\./.test(await a.text(`.source-row[data-source="${kitId}"] .source-name[data-kind="mcp"]`) ?? ''))
    && relayIn('copilot-cli')?.command === 'relay-mcp', [await a.text(`.source-row[data-source="${kitId}"]`), readNow(mcpFile('copilot-cli'))]);

  // A plugin's own folder: Look lists its skill and says what doesn't come; Add brings it in Off; turned On, a tool has it.
  await a.click('#nav-sources');
  await type('https://github.com/team/plugin');
  await a.click('#source-look');
  await until(() => a.exists('#source-preview'));
  const pluginLook = await a.text('#source-preview') ?? '';
  check('a link to a plugin’s own folder lists its skill, says it holds a plugin and that its 2 commands and its hooks are not brought in, and offers Add', (await a.all('#source-preview .source-name', 'e.dataset.key')).join() === 'pdf'
    && /The link holds a plugin: its skills, agents and MCP servers come in as this source’s/.test(pluginLook) && /Not brought in: its 2 commands and its hooks\. Central Knot installs plugins only from a marketplace/.test(pluginLook) && (await a.text('#source-add'))?.trim() === 'Add 1 skill', pluginLook);
  await fitsAtMinimum(a, 'Sources, with a source and a look open');
  await a.click('#source-add');
  await until(async () => /pdf is in Central Knot, Off/.test(await a.text('.band-done .band-text') ?? ''));
  const pdfRecord = () => JSON.parse(readNow(join(home, '.central-knot/skills.json')) || '{"items":{}}').items.pdf;
  check('Add brings pdf in, Off, in no tool, and its row says what doesn’t come', pdfRecord()?.on === false && !existsSync(join(home, roots['claude-cli'], 'pdf'))
    && /Not brought in: its 2 commands and its hooks\./.test(await a.text(`.source-row:has(.source-name[data-key="pdf"])`) ?? ''), [pdfRecord(), await a.text('.page')]);
  await a.click('#nav-skills');
  await until(() => a.exists(`#${rowPart('switch', 'skills', 'pdf')}`));
  await a.click(`#${rowPart('switch', 'skills', 'pdf')}`);
  check('turned On, pdf’s SKILL.md is in Claude Code', await until(() => existsSync(join(home, roots['claude-cli'], 'pdf/SKILL.md'))), readdirSync(join(home, roots['claude-cli'])));

  // A marketplace: Look offers Add to Plugin marketplaces, never Add. While the repository can't be read, Add to Plugin marketplaces opens Plugin marketplaces with
  // that page's words and the link stays; once it can, the marketplace is listed there, nothing is installed, no tool record is made.
  await a.click('#nav-sources');
  await type('https://github.com/team/market');
  await a.click('#source-look');
  await until(() => a.exists('#source-to-plugins'));
  const marketLook = await a.text('#source-preview') ?? '';
  check('a marketplace’s link: Look names it with its plugin count and offers Add to Plugin marketplaces, not Add', /The link holds a marketplace, acme-tools, with 1 plugin/.test(marketLook) && /none turned on/.test(marketLook) && !(await a.exists('#source-add')), marketLook);
  renameSync(market, `${market}.away`);
  await a.click('#source-to-plugins');
  check('the repository unreadable: Add to Plugin marketplaces opens Plugin marketplaces with its words, nothing listed', await until(async () => /No access, or no repository there/.test(await a.text('.plugin-problems') ?? '')) && !(await a.text('.market-list') ?? '').includes('acme-tools'), await a.text('.page'));
  await a.click('#nav-sources');
  check('and the link and its look stay on Sources', await a.run(`document.querySelector('#source-link').value`) === 'https://github.com/team/market' && await a.exists('#source-to-plugins'), await a.text('.page'));
  renameSync(`${market}.away`, market);
  await a.click('#source-to-plugins');
  const pluginsSaid = async () => `${await a.text('.plugins-page') ?? ''} ${await a.run(`document.querySelector('#announcement')?.dataset.text ?? ''`) ?? ''}`;
  check('Add to Plugin marketplaces opens Plugin marketplaces with acme-tools listed and says nothing was installed; no tool record is made', await until(async () => (await a.text('.market-list') ?? '').includes('acme-tools') && /Marketplace added: 1 plugin, nothing installed \(acme-tools\)\./.test(await pluginsSaid()))
    && !existsSync(join(home, '.claude/plugins')) && !existsSync(join(home, '.copilot/config.json')) && !(JSON.parse(readNow(join(home, '.central-knot/plugins.json')) || '{}').plugins ?? []).length,
    [await pluginsSaid(), existsSync(join(home, '.claude/plugins')), readNow(join(home, '.central-knot/plugins.json'))]);
  await a.click('#nav-sources');
  check('and Sources made no source of it: the field is clear, no look is open, no row names it', await a.run(`document.querySelector('#source-link').value`) === '' && !(await a.exists('#source-preview')) && !(await a.text('.source-rows') ?? '').includes('team/market'), await a.text('.page'));
  await type('https://github.com/team/plugin/tree/main/skills');
  await a.click('#source-look');
  await until(() => a.exists('#source-preview'));
  for (const [width, height] of [[1280, 800], [1728, 1117], [2560, 1440]]) { await sizeTo(a, width, height); same(`nothing cut off on Sources at ${width}×${height}`, await a.run(CUT_OFF), []); }
  await fullSize(a);

  await a.click(`#source-remove-${id}`);
  await a.click(`#source-remove-confirm-${id}`);
  check('Remove takes the row away, and deslop stays in Central Knot as it was', await until(async () => !(await a.exists(`#source-${id}`))) && record()?.on === true && !!record()?.versions.length, await a.text('.page'));
  same('no page errors on Sources', a.pageErrors, []);
  await a.quit();
}

/**
 * Updates, with a stand-in for GitHub's releases and the install step stubbed (CK_UPDATE_STUB: the app acts as an installed copy
 * of that release, and "installing" records the update and quits; scripts/update-proof.mjs proves the real install on a Mac).
 * The sidebar's update control, at the bottom left, is the quiet Check for updates until the first check finds a newer release;
 * then it stands out, and one click downloads it with progress; something unsaved holds the restart, and the control says so;
 * the next launch says once that it is on the new version. It fits, open and in the rail, in the smallest window.
 */
async function updateFlow() {
  const zip = join(scratch, 'update.zip');
  writeFileSync(zip, Buffer.alloc(3_000_000, 7));
  const releases = [{ tag: 'v0.5.0-preview.5', zip, bytesPerSecond: 1_000_000 }];
  const fixture = await serveReleases(releases);
  const data = join(scratch, 'update-data');
  const as = tag => ({ CK_UPDATE_STUB: tag, CK_UPDATE_RELEASES: fixture.releasesUrl });
  let a;
  /** The sidebar's update control as the person and a screen reader meet it: its look, its words, its name and its tooltip. */
  const control = () => a.run(`(b => b && { look: b.dataset.look, label: b.textContent.trim(), name: b.getAttribute('aria-label'), title: b.title, disabled: b.disabled })(document.getElementById('update-control'))`);
  const reaches = async (look, tries = 80) => { for (let i = 0; i < tries && (await control())?.look !== look; i++) await wait(250); return (await control())?.look; };
  // Every look the control takes, in order, from the moment this is called (main's steps can pass faster than a poll).
  const watchLooks = () => a.run(`window.ckLooks = []; new MutationObserver(() => { const b = document.getElementById('update-control'); const seen = b && b.dataset.look + ' ' + b.textContent.trim(); if (seen && window.ckLooks.at(-1) !== seen) window.ckLooks.push(seen); }).observe(document.getElementById('sidebar-end'), { subtree: true, childList: true, characterData: true, attributes: true }); true`);
  /** Whatever in the sidebar doesn't fit: its pages scrolling, the control past its edge, or the control's words cut short. */
  const sidebarFit = () => a.run(`(() => {
    const out = [], nav = document.getElementById('nav'), side = document.getElementById('sidebar').getBoundingClientRect();
    if (nav.scrollHeight > nav.clientHeight + 1) out.push('the pages scroll by ' + (nav.scrollHeight - nav.clientHeight) + 'px');
    const control = document.getElementById('update-control'), box = control.getBoundingClientRect(), label = control.querySelector('.nav-label');
    if (box.bottom > side.bottom + 0.5 || box.right > side.right + 0.5 || box.left < side.left - 0.5) out.push('the update control is cut off');
    if (label.getBoundingClientRect().width > 0 && label.scrollWidth > label.clientWidth + 1) out.push('its words are cut: ' + label.textContent);
    return out;
  })()`);
  try {
    a = await launch(data, ['--practice-copy'], HOME, as('v0.5.0-preview.4'));
    same('the status bar names the build by its release', await a.text('#status-end'), 'Central Knot 0.5.0 preview 4');
    same('before the first check the sidebar ends in the quiet Check for updates', [(await control())?.look, (await control())?.label], ['check', 'Check for updates']);
    // The first check runs shortly after launch, on its own.
    same('after the first check the control stands out with the newer release', await reaches('available'), 'available');
    const offer = await control();
    same('it says so, and its name says which release', [offer.label, offer.name, offer.title], ['Update available', 'Update to 0.5.0 preview 5', '0.5.0 preview 5 is available. Click to download it and restart Central Knot. Your settings and data stay as they are.']);
    same('a screen reader is told of the new release', await a.text('#update-news'), 'Central Knot 0.5.0 preview 5 is available.');
    same('the status bar keeps the version', await a.text('#status-end'), 'Central Knot 0.5.0 preview 4');
    // The Overview, where the app opens, says it too: one line, with What's new and a button in Settings' button's words.
    same('the Overview’s line names the release, with What’s new and Update', [(await a.text('#overview-update-line .overview-update-text'))?.trim(), (await a.text('#overview-update'))?.trim()],
      ['Central Knot 0.5.0 preview 5 is available. What’s new', 'Update to 0.5.0 preview 5']);
    await a.click('#nav-settings');
    const row = await a.text('#setting-updates') ?? '';
    check('Settings › Updates names the build and what is available', row.includes('This is Central Knot 0.5.0 preview 4.') && row.includes('0.5.0 preview 5 is available.') && await a.exists('#check-updates') && await a.exists('#setting-update'), row);
    // Check now from the keyboard: the button is disabled under the focus while it checks, and takes the focus back.
    const focused = () => a.run(`document.activeElement?.id ?? ''`);
    const press = id => a.run(`(document.getElementById('${id}').focus(), document.getElementById('${id}').click(), true)`);
    await press('check-updates');
    for (let i = 0; i < 40 && await focused() !== 'check-updates'; i++) await wait(250);
    same('Check now takes the focus back when the check ends', await focused(), 'check-updates');
    same('and a screen reader is told what it found, which the row already shows', [await a.run(`document.getElementById('announcement').dataset.text`), await a.run(`document.getElementById('announcement').classList.contains('visually-hidden')`)], ['0.5.0 preview 5 is available. Updating downloads it and restarts Central Knot.', true]);
    same('the row’s buttons are the size of the page’s other row buttons', await a.run(`['setting-update', 'check-updates', 'show-log', 'open-log-folder'].map(id => document.getElementById(id).getBoundingClientRect().height)`), [32, 32, 32, 32]);
    // Something typed and not saved holds the restart: an instruction file's draft.
    const typeDraft = async () => {
      await a.click('#nav-instructions');
      const tool = await a.run(`document.querySelector('[id^="ins-edit-"]')?.id.slice('ins-edit-'.length) ?? ''`);
      await a.click(`#ins-edit-${tool}`);
      await a.run(`(() => { const area = document.querySelector('#ins-text-${tool}'); area.value += '\\n- Not saved yet.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await a.settle();
    };
    await typeDraft();
    await watchLooks();
    await press('update-control');
    same('the click says it won’t restart by itself, with changes waiting', await a.run(`document.getElementById('announcement').dataset.text`), 'Downloading 0.5.0 preview 5. Restarting now loses your unsaved instructions draft. If that still holds when it’s ready, Central Knot waits for you to restart.');
    same('downloaded and prepared, it waits to restart', await reaches('held'), 'held');
    const looks = await a.run('window.ckLooks');
    check('one click downloads, with progress on the control, then prepares', looks.filter(look => /^working Downloading… \d+%$/.test(look)).length >= 2 && looks.includes('working Preparing update…'), looks);
    same('an unsaved draft holds the restart', (await control()).label, 'Restart to update…');
    same('the control, disabled while it worked, takes the focus back', await focused(), 'update-control');
    await wait(1500);
    check('and the app is still running', a.child.exitCode === null);
    check('the status bar says what restarting loses, first', /^Restarting now loses your unsaved instructions draft\./.test(await a.text('#announcement') ?? ''), await a.text('#announcement'));
    check('so does the control, whose name says it too', /unsaved instructions draft\. Click to open Settings, where you can restart anyway\.$/.test((await control()).title) && /^Restart to update: Restarting now loses your unsaved instructions draft\. Opens Settings$/.test((await control()).name), await control());
    // The Overview's button has the control's own click: held, it says so and opens Settings.
    await a.click('#nav-overview');
    same('on the Overview, its button says Restart to update… too', (await a.text('#overview-update'))?.trim(), 'Restart to update…');
    await a.click('#overview-update');
    check('and its click is the control’s: Settings opens, and the app keeps running', await a.run(`document.querySelector('#nav-settings').getAttribute('aria-current') === 'page'`) && a.child.exitCode === null);
    // A click on the held control never restarts: it opens Settings, which says what restarting loses beside its Restart button.
    await a.click('#update-control');
    check('the held control opens Settings’ Updates row, which says what would be lost, and the app keeps running', await a.run(`document.querySelector('#nav-settings').getAttribute('aria-current') === 'page'`) && /is ready\. Restarting now loses your unsaved instructions draft\./.test(await a.text('#setting-updates') ?? '') && a.child.exitCode === null, await a.text('#setting-updates'));
    same('no page errors while updating', a.pageErrors, []);
    // Restarting there is the person's choice: the app restarts (here: quits, the stub's install).
    const exited = new Promise(done => a.child.once('exit', done));
    // Clicked a moment later, from the page: the app quits at once, so a reply to the click itself might never come.
    await a.run(`(setTimeout(() => document.getElementById('setting-update').click(), 100), true)`);
    check('Restart to update quits for the update', await Promise.race([exited.then(() => true), wait(15000).then(() => false)]));
    const pending = JSON.parse(readFileSync(join(data, 'app-settings.json'), 'utf8')).update;
    same('the update is recorded for the next launch', pending && [pending.tag, pending.from], ['v0.5.0-preview.5', 'v0.5.0-preview.4']);
    // The next launch is the new version: it says so once, with the release notes.
    a = await launch(data, ['--practice-copy'], HOME, as('v0.5.0-preview.5'));
    for (let i = 0; i < 40 && !/now on/.test(await a.text('#announcement') ?? ''); i++) await wait(250);
    same('after the restart it says once that it is on the new version', await a.text('#announcement'), 'Central Knot is now on 0.5.0 preview 5.');
    same('with a link to the release notes', [await a.run(`document.getElementById('said-link').hidden`), await a.text('#said-link')], [false, 'Release notes']);
    same('the status bar names the new build', await a.text('#status-end'), 'Central Knot 0.5.0 preview 5');
    check('the record is cleared once said', !JSON.parse(readFileSync(join(data, 'app-settings.json'), 'utf8')).update);
    // The status bar's note goes at the first page switch; Settings keeps saying it for the whole launch, with the release notes.
    await a.click('#nav-skills');
    same('the note leaves the status bar with the page', await a.run(`document.getElementById('announcement').dataset.text`), '');
    await a.click('#nav-settings');
    const updatedLine = async () => [await a.text('#setting-updates-notice .setting-message-text'), await a.text('#setting-updates-notice-action')];
    check('Settings says the launch came from an update, with the release notes', /^Updated to 0\.5\.0 preview 5(, the newest release)?\.$/.test((await updatedLine())[0] ?? '') && (await updatedLine())[1] === 'Release notes', await updatedLine());
    await a.click('#check-updates');
    for (let i = 0; i < 40 && !/newest release/.test(await a.text('#setting-updates') ?? ''); i++) await wait(250);
    same('Check now: nothing newer, and the note stays', await updatedLine(), ['Updated to 0.5.0 preview 5, the newest release.', 'Release notes']);
    // The sidebar's control checks from any page: the arrows spin while it checks, and the status bar says what it found.
    await a.click('#nav-skills');
    await watchLooks();
    await press('update-control');
    const found = 'Updated to 0.5.0 preview 5, the newest release.';
    for (let i = 0; i < 40 && (await a.run(`document.getElementById('announcement').dataset.text`)) !== found; i++) await wait(100);
    same('clicked on another page, it checks and the status bar says what it found', [await a.run(`document.getElementById('announcement').dataset.text`), await a.run(`document.getElementById('announcement').classList.contains('visually-hidden')`)], [found, false]);
    check('the control showed the check, then went back to the quiet arrows', (await a.run('window.ckLooks')).includes('checking Checking…') && (await control()).look === 'check', await a.run('window.ckLooks'));
    same('its tooltip says it is up to date', (await control()).title, 'Up to date. Click to check now.');
    // It takes the focus back once it can be pressed again, a redraw after the look changes.
    for (let i = 0; i < 40 && await focused() !== 'update-control'; i++) await wait(100);
    same('and it takes the focus back', await focused(), 'update-control');
    await a.quit();
    // An update that didn't take (the old build opens again) says so, in Settings.
    writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(data, 'app-settings.json'), 'utf8')), update: { tag: 'v0.5.0-preview.6', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.6', from: 'v0.5.0-preview.5' } }));
    releases.splice(0, 1, { tag: 'v0.5.0-preview.6', zip, cut: 0.5 });
    a = await launch(data, ['--practice-copy'], HOME, as('v0.5.0-preview.5'));
    await a.click('#nav-settings');
    check('an update that didn’t finish is said in Settings', (await a.text('#setting-updates') ?? '').includes('The update to 0.5.0 preview 6 didn’t finish. Central Knot 0.5.0 preview 5 is still in use.'), await a.text('#setting-updates'));
    // An interrupted download says so and offers the update again.
    await a.click('#check-updates');
    await reaches('available', 40);
    // Started from the sidebar on another page: said in the status bar, and still said in Settings afterwards.
    await a.click('#nav-skills');
    await a.run(`(document.getElementById('update-control').focus(), document.getElementById('update-control').click(), true)`);
    for (let i = 0; i < 80 && !/download didn’t finish/.test(await a.text('#announcement') ?? ''); i++) await wait(250);
    same('an interrupted download is said in the status bar', await a.run(`document.getElementById('announcement').dataset.text`), 'The download didn’t finish. Central Knot wasn’t changed. Try again.');
    same('and the control takes the focus back', await a.run(`document.activeElement?.id ?? ''`), 'update-control');
    const retry = await control();
    same('the control offers it again, saying the last try failed', [retry.look, retry.label, retry.name, retry.title], ['available', 'Try the update again', 'Try the update to 0.5.0 preview 6 again', 'The download didn’t finish. Central Knot wasn’t changed. Try again.']);
    await a.click('#nav-settings');
    check('an interrupted download is still said in Settings, and nothing changed', (await a.text('#setting-updates') ?? '').includes('The download didn’t finish. Central Knot wasn’t changed.') && await a.text('#setting-updates-notice-action') === 'Open the release page', await a.text('#setting-updates'));
    same('and Settings’ button offers it again', (await a.text('#setting-update'))?.trim(), 'Update to 0.5.0 preview 6');
    same('no page errors after updating', a.pageErrors, []);
    await a.quit();
    // The narrowest window with the status bar at its fullest: a folder home named as long as "This Mac’s home", a profile in
    // use with a long name, and sync on with nothing synced yet. Nothing may run into its neighbour, and the sidebar, in the rail
    // and open, fits with its update control in every state.
    const narrowHome = join(scratch, 'this-macs-home'), narrowData = join(scratch, 'update-narrow-data');
    cpSync(join(root, 'fixtures/home'), narrowHome, { recursive: true });
    mkdirSync(narrowData, { recursive: true });
    writeFileSync(join(narrowData, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: narrowHome } }));
    releases.splice(0, 1, { tag: 'v0.5.0-preview.6', zip, bytesPerSecond: 1_000_000 });
    // What in the status bar runs into what follows it, or past the window's edge; empty when everything fits.
    const crowding = () => a.run(`(() => {
      const named = node => node.id || String(node.className);
      const parts = [...document.querySelectorAll('#status-facts > *'), ...['announcement', 'said-link', 'message-mark'].map(id => document.getElementById(id)), document.getElementById('status-end')]
        .filter(node => node && !node.hidden && !node.classList.contains('visually-hidden') && node.getBoundingClientRect().width > 0);
      const found = [];
      parts.forEach((node, at) => {
        const box = node.getBoundingClientRect(), next = parts[at + 1]?.getBoundingClientRect();
        if (next && box.right > next.left + 0.5) found.push(named(node) + ' runs ' + Math.round(box.right - next.left) + 'px into ' + named(parts[at + 1]));
        if (box.right > innerWidth + 0.5) found.push(named(node) + ' runs past the window');
      });
      const facts = document.getElementById('status-facts');
      if (facts.scrollWidth > facts.clientWidth) found.push('the facts need ' + (facts.scrollWidth - facts.clientWidth) + 'px more than they have');
      return found;
    })()`);
    a = await launch(narrowData, [], HOME, as('v0.5.0-preview.5'));
    await a.click('#nav-profiles');
    await newProfile(a, 'Incident response on call');
    // Nothing is in Central Knot in this fresh home, so the empty profile is the one in use: the status bar names it.
    await sizeTo(a, ...SMALLEST);
    /** In the rail, then open: the sidebar fits, and nothing in the status bar runs into its neighbour. */
    const fitsBothWays = async when => {
      same(`at 860×560, in the rail, the sidebar fits and the control is its icon alone: ${when}`, [await a.run(`document.body.classList.contains('rail')`), await sidebarFit(), await a.run(`getComputedStyle(document.querySelector('#update-control .nav-label')).display`)], [true, [], 'none']);
      await a.click('#sidebar-toggle');
      same(`and open, it fits with its words whole: ${when}`, [await a.run(`document.body.classList.contains('rail')`), await sidebarFit()], [false, []]);
      same(`and the status bar fits: ${when}`, await crowding(), []);
      await a.click('#sidebar-toggle');
    };
    same('the narrow bar has the profile in use, idle sync and the version', [(await a.text('#status-profile'))?.trim(), await a.text('#sync-switch .sync-state'), await a.text('#status-version')], ['Incident response on call', 'On · nothing synced', '0.5.0 preview 5']);
    await fitsBothWays('Check for updates');
    await reaches('available');
    await fitsBothWays('Update available');
    await typeDraft();
    await a.click('#update-control');
    for (let i = 0; i < 40 && !/^Downloading… \d+%$/.test((await control()).label); i++) await wait(100);
    same('while downloading, the icon is ringed by the progress', await a.run(`Number(document.querySelector('#update-control .update-glyph.with-progress')?.style.getPropertyValue('--progress')) > 0`), true);
    same('nor while downloading', [await sidebarFit(), await crowding()], [[], []]);
    await reaches('held');
    same('nor with the restart held and its reason as a mark', [await a.run(`getComputedStyle(document.getElementById('message-mark')).display !== 'none'`), await crowding()], [true, []]);
    await fitsBothWays('Restart to update, held');
    await a.quit();
    writeFileSync(join(narrowData, 'app-settings.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(narrowData, 'app-settings.json'), 'utf8')), update: { tag: 'v0.5.0-preview.6', page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.6', from: 'v0.5.0-preview.5' } }));
    a = await launch(narrowData, [], HOME, as('v0.5.0-preview.6'));
    await sizeTo(a, ...SMALLEST);
    for (let i = 0; i < 40 && !/now on/.test(await a.text('#announcement') ?? ''); i++) await wait(250);
    same('nor after the restart, where the note is its mark and the release notes link waits in Settings', [await a.exists('#status-profile'), await a.run(`getComputedStyle(document.getElementById('said-link')).display`), await crowding()], [true, 'none', []]);
    same('no page errors in the narrow window', a.pageErrors, []);
    await a.quit();
    // A build with no release tag never offers updates, and Settings says why (on macOS; elsewhere nothing is shown).
    a = await launch(join(scratch, 'update-untagged'), ['--practice-copy'], HOME, { CK_UPDATE_RELEASES: fixture.releasesUrl });
    await a.click('#nav-settings');
    if (process.platform === 'darwin') check('an untagged or development build says it doesn’t update itself', /(development build|wasn’t made from a release)/.test(await a.text('#setting-updates') ?? ''), await a.text('#setting-updates'));
    else same('off macOS there is no Updates row', await a.exists('#setting-updates'), false);
    // On a Mac its sidebar control is faint and opens Settings, which says why; elsewhere there is none (no releases there).
    same('and its sidebar control never offers an update', (await control())?.look, process.platform === 'darwin' ? 'off' : undefined);
    await a.quit();
  } finally { await fixture.close(); }
}

/**
 * A released build starts on this computer's home and offers no Practice copy, and its main process refuses one. Where the
 * real home is written (machine.ts writesRealHome), its first open of a fresh home asks first setup's question, and Yes takes
 * a skill found in Codex into OpenCode's folder under ~/.config (Codex and OpenCode are the home's only tools: OpenCode reads
 * Claude Code's skills folder, so a skill there gets no copy of its own).
 */
async function releasedStartupFlow() {
  // A development build (--electron) starts as a released one with --as-released; a packaged build needs no switch.
  const asReleased = flag('--electron') ? ['--as-released'] : [];
  const a = await launch(join(scratch, 'released-data'), asReleased);
  const realHome = process.platform === 'darwin' ? 'This Mac’s home' : 'This computer’s home';
  same('a released build opens this computer’s home, never the practice copy', [await a.text('#home-label'), await a.exists('#home-fixture')], [realHome, false]);
  same('and its main process refuses the practice copy', await a.run(`window.centralKnot.selectHome('fixture').then(() => 'opened', () => 'refused')`), 'refused');
  await a.quit();
  if (!canWriteRealHome) return;
  const fresh = join(scratch, 'home-first-open'), handoff = text('handoff', 'Hand it over.');
  for (const [path, version] of [['.local/bin/codex', 'codex-cli 0.142.3'], ['.opencode/bin/opencode', '1.19.5']]) {
    mkdirSync(join(fresh, path, '..'), { recursive: true });
    writeFileSync(join(fresh, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`, { mode: 0o755 });
  }
  skill(join(fresh, '.codex/skills'), 'handoff', handoff);
  const b = await launch(join(scratch, 'first-open-data'), asReleased, fresh, { CK_TEST_HOME_ONLY: 'claude,copilot,codex,pi,opencode' });
  await b.click('#nav-overview');
  check('at its first open of a fresh home, the Overview asks first setup’s question', await b.exists('#setup-yes'), await b.text('.overview-lead'));
  await b.click('#setup-yes');
  for (let tries = 0; tries < 40 && !readNow(join(fresh, '.config/opencode/skills/handoff/SKILL.md')); tries++) await wait(100);
  same('Yes takes the skill found in Codex into OpenCode, byte for byte', readNow(join(fresh, '.config/opencode/skills/handoff/SKILL.md')), handoff);
  same('no page errors, a released build’s first open', b.pageErrors, []);
  await b.quit();
}

/**
 * A home with no tools, then with Pi alone, then with Claude Code too. With no tools every page stays, each saying so; a
 * kind no tool here can hold (plugins with Pi alone, which takes agents as skills) is left out of the sidebar and the
 * Overview, named once; a tool that holds it brings it back.
 */
async function fewToolsFlow() {
  const home = join(scratch, 'home-few');
  mkdirSync(home, { recursive: true });
  const a = await launch(join(scratch, 'few-data'), flag('--electron') ? ['--as-released'] : [], home);
  const pages = () => a.all('#nav [id^="nav-"]', 'e.id.slice(4)');
  // The app also looks for each tool's CLI in system folders that no test home can hide (executableCandidates). On a
  // machine that has one there, no home is without tools, so this flow has nothing to check.
  const installed = await a.run(`window.centralKnot.refresh().then(view => (view?.snapshots ?? []).filter(snapshot => snapshot.detection !== 'Not found').map(snapshot => snapshot.harnessName))`);
  if (installed.length) {
    console.log(`few tools: skipped, this machine has ${installed.join(', ')} installed outside any home`);
    await a.quit();
    return;
  }
  same('a home with no tools shows only the pages that hold no kind', await pages(), ['overview', 'harnesses', 'sources', 'history', 'repo', 'settings']);
  same('its Overview says no tools were found, once, with another home to choose', [await a.text('.overview-lead'), await a.exists('#overview-choose-home')], ['No tools were found in this home.', true]);
  check('its status bar says only that the home opened', /^Opened [^.]+\.$/.test(await a.run(`document.querySelector('#announcement').dataset.text`) ?? ''), await a.run(`document.querySelector('#announcement').dataset.text`));
  same('with nothing to sync, the switch is shown, not offered', await a.run(`[document.querySelector('#sync-switch').getAttribute('aria-disabled'), document.querySelector('#sync-switch .sync-state').textContent]`), ['true', 'Nothing to sync']);
  await fitsAtMinimum(a, 'a home with no tools');
  await a.click('#nav-harnesses');
  const toolsSays = await a.text('.page');
  check('Harnesses says the same sentence, with Choose another home…, and points nowhere on screen', toolsSays.includes('No tools were found in this home.') && await a.exists('#harnesses-choose-home') && !/bottom left/.test(toolsSays) && !(await a.exists('.tools-note')), toolsSays);
  await a.click('#nav-history');
  for (let tries = 0; tries < 30 && !(await a.exists('#history-choose-home')); tries++) await wait(100);
  check('History says the same, in the same place, rather than offering Skills', await a.exists('#history-choose-home') && !(await a.exists('#history-go-skills')), await a.text('.page'));
  await a.click('#nav-overview');
  // On this computer a tool is here when its CLI (or desktop app) is: each stand-in answers --version only.
  const cli = (path, version) => { mkdirSync(join(home, path, '..'), { recursive: true }); writeFileSync(join(home, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(home, path), 0o755); };
  // A folder a tool left behind, with no CLI or app beside it, is not the tool: the home still has no tools.
  mkdirSync(join(home, '.codex/skills/notes'), { recursive: true });
  writeFileSync(join(home, '.codex/skills/notes/SKILL.md'), text('notes'));
  await a.click('#header-refresh');
  same('a tool’s folder alone, with no CLI or app, makes no tool', await pages(), ['overview', 'harnesses', 'sources', 'history', 'repo', 'settings']);
  mkdirSync(join(home, '.pi/agent/skills/notes'), { recursive: true });
  writeFileSync(join(home, '.pi/agent/skills/notes/SKILL.md'), text('notes'));
  cli('.pi/agent/bin/pi', 'pi 1.5.0');
  await a.click('#header-refresh');
  // Codex, whose folder is still here, holds plugins: were it counted, that page would be back.
  same('with Pi alone, Plugins is left out, and Agents stays: Pi takes agents as skills', await pages(), ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'sources', 'profiles', 'history', 'repo', 'settings']);
  check('and the Overview names it once', (await a.text('#overview-absent') ?? '').includes('No tool here holds plugins') && await a.exists('#overview-agents'), await a.text('#overview-absent'));
  await a.click('#nav-skills');
  check('the tool with only a folder has no mark', await a.exists('.tool-mark[data-tool="pi-cli"]') && !(await a.exists('[data-tool="codex-cli"], #tool-codex-cli')));
  await a.click('#nav-harnesses');
  const folderOnly = await a.text('#harness-codex-cli');
  check('Harnesses says its folder is all that is here, and its card opens nothing', folderOnly.includes('Not found · only its folder is here') && folderOnly.includes('Install Codex, then Refresh.') && !(await a.exists('button#harness-codex-cli')), folderOnly);
  await fitsAtMinimum(a, 'Harnesses with a tool that left only its folder');
  await a.shot('folder-only-harness');
  rmSync(join(home, '.codex'), { recursive: true, force: true });
  await a.click('#nav-overview');
  mkdirSync(join(home, '.claude'), { recursive: true });
  cli('.local/bin/claude', '2.1.309 (Claude Code)');
  await a.click('#header-refresh');
  same('a tool that holds plugins brings them back', await pages(), ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'sources', 'profiles', 'history', 'repo', 'settings']);
  await a.click('#nav-harnesses');
  check('Claude Code’s CLI alone says nothing of Cowork', !(await a.text('#harness-claude-cli')).includes('Cowork'), await a.text('#harness-claude-cli'));
  // On Plugins, its only tool goes away (Pi, still here, holds no plugins): the page it was on no longer exists here, so the
  // Overview opens.
  await a.click('#nav-plugins');
  rmSync(join(home, '.claude'), { recursive: true, force: true });
  rmSync(join(home, '.local/bin/claude'));
  await a.click('#header-refresh');
  same('when the open page’s kind leaves the home, the Overview opens', [await a.text('.page-title'), await pages()], ['Overview', ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'sources', 'profiles', 'history', 'repo', 'settings']]);
  const moved = await a.run(`document.querySelector('#announcement').dataset.text`);
  check('and the status bar says what was read and why the page moved', /^Read .*No tool here holds plugins now\.$/.test(moved ?? ''), moved);
  // Claude desktop alone, with no CLI and no .claude folder yet: Claude Code is here, said so with both versions.
  mkdirSync(join(home, 'Applications/Claude.app/Contents'), { recursive: true });
  writeFileSync(join(home, 'Applications/Claude.app/Contents/Info.plist'), '<?xml version="1.0"?>\n<plist><dict><key>CFBundleShortVersionString</key><string>4.16336.0</string></dict></plist>\n');
  mkdirSync(join(home, 'Library/Application Support/Claude/claude-code/2.1.317'), { recursive: true });
  await a.click('#header-refresh');
  check('Claude desktop alone brings Claude Code back, with agents and plugins', (await pages()).includes('plugins'), await pages());
  await a.click('#nav-harnesses');
  const desktopCard = await a.text('#harness-claude-cli');
  check('its card names the app, its version, its Code tab’s version and no CLI', desktopCard.includes('Claude desktop 4.16336.0 (Code tab 2.1.317) · no CLI found'), desktopCard);
  // Cowork comes with Claude desktop and is no tool here: the card says which plugins it uses (capability-data section 7).
  check('with Claude desktop here, the card says Cowork uses the Claude account’s plugins', /Cowork—?uses the plugins in your Claude account/.test(desktopCard), desktopCard);
  await fitsAtMinimum(a, 'Harnesses with Claude desktop and its Cowork line');
  // Once the Code tab's own Claude Code is there, plugins install through it (PLG-04): the box says so, and never calls it the CLI.
  const codeTab = join(home, 'Library/Application Support/Claude/claude-code/2.1.317/e6736b2d954d/claude.app/Contents/MacOS/claude');
  const ranLog = join(scratch, 'code-tab-runs.txt');
  const appMarket = join(scratch, 'app-market');
  mkdirSync(join(codeTab, '..'), { recursive: true });
  writeFileSync(codeTab, [
    '#!/bin/sh', `echo "$*" >> '${ranLog}'`, 'case "$*" in',
    '"--version") echo "2.1.317 (Claude Code)";;',
    `"plugin marketplace add ${appMarket}") mkdir -p "$HOME/.claude/plugins" && echo '{"team-tools":{"source":{"source":"directory","path":"${appMarket}"}}}' > "$HOME/.claude/plugins/known_marketplaces.json";;`,
    `"plugin install document-tools@team-tools --scope user") echo '{"version":2,"plugins":{"document-tools@team-tools":[{"scope":"user","installPath":"${appMarket}/plugins/document-tools","version":"1.2.0"}]}}' > "$HOME/.claude/plugins/installed_plugins.json";;`,
    '*) exit 9;;', 'esac', ''].join('\n'));
  chmodSync(codeTab, 0o755);
  writeMarket(appMarket);
  await a.run(`window.centralKnot.addMarketplace(${JSON.stringify(appMarket)})`);
  await a.click('#nav-plugins');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && !(await a.exists('#popen-0-document-tools')); tries++) await wait(100);
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-tool-via')); tries++) await wait(100);
  const box = await a.text('.plugin-panel');
  for (const [width, height] of [SMALLEST, [1728, 1117]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(300);
    await a.shot(`app-only-plugin-${width}`);
    check(`at ${width}×${height} the app-only plugin box’s route line is not cut off`, await a.run(`(() => { const line = document.querySelector('.plugin-tool-via'); const box = line.getBoundingClientRect(); return box.width > 0 && line.scrollWidth <= line.clientWidth + 1 && box.right <= innerWidth; })()`));
    check(`at ${width}×${height} the line about Cowork is whole, inside the tools panel`, await a.run(`(() => { const note = document.querySelector('#plugin-cowork-note'); if (!note) return false; const box = note.getBoundingClientRect(), panel = note.closest('.plugin-panel').getBoundingClientRect(); return box.width > 0 && note.scrollWidth <= note.clientWidth + 1 && box.right <= panel.right && box.bottom <= panel.bottom; })()`));
  }
  await a.send('Emulation.clearDeviceMetricsOverride');
  check('with only Claude desktop, the plugin box names its route, its Code tab', box.includes('Claude CodeNot installedThrough Claude desktop’s Code tab 2.1.317') && !box.includes('Only Claude desktop'), box);
  check('and says once that Cowork uses the Claude account’s plugins, with no box for it', box.includes('Cowork in Claude desktop uses the plugins in your Claude account, so Central Knot doesn’t install there.') && (await a.all('.plugin-tool-name')).every(name => !name.includes('Cowork')), box);
  same('no page errors, few tools', a.pageErrors, []);
  await a.quit();
  // In the Practice copy (so it writes on every platform: a real home is preview only on Windows) the install runs through
  // that copy and its record counts.
  const p = await launch(join(scratch, 'few-practice-data'), ['--practice-copy'], home);
  const practiceHome = await p.run(`document.querySelector('.status-home').title`);
  await p.run(`window.centralKnot.addMarketplace(${JSON.stringify(appMarket)})`);
  const appInstall = await p.run(`window.centralKnot.installPlugin(${JSON.stringify(appMarket)}, 'team-tools', 'document-tools', ['claude-cli'], ${JSON.stringify(practiceHome)})`);
  same('the install runs the Code tab’s Claude Code with the CLI’s own commands, and its record says installed', [appInstall.reports?.map(report => [report.tool, report.outcome]), readFileSync(ranLog, 'utf8').split('\n').filter(line => line.startsWith('plugin'))],
    [[['claude-cli', 'installed']], [`plugin marketplace add ${appMarket}`, 'plugin install document-tools@team-tools --scope user']]);
  same('no page errors, few tools, practice', p.pageErrors, []);
  await p.quit();
}

/**
 * OpenCode as a tool, beside Claude Code, in a home of its own: its CLI and its desktop app stand in there (the CLI answers
 * nothing but its version), and its skills, MCP servers, agents and instruction file are read from its own folder.
 */
async function openCodeFlow() {
  const home = join(scratch, 'home-opencode');
  const oc = join(home, '.config/opencode');
  const cli = (path, version) => { mkdirSync(join(home, path, '..'), { recursive: true }); writeFileSync(join(home, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(home, path), 0o755); };
  cli('.local/bin/claude', '2.1.309 (Claude Code)');
  cli('.opencode/bin/opencode', '1.19.5');
  mkdirSync(join(home, 'Applications/OpenCode.app/Contents/Resources'), { recursive: true });
  writeFileSync(join(home, 'Applications/OpenCode.app/Contents/Info.plist'), '<?xml version="1.0"?>\n<plist><dict><key>CFBundleShortVersionString</key><string>2.2.5</string></dict></plist>\n');
  writeFileSync(join(home, 'Applications/OpenCode.app/Contents/Resources/opencode-cli.version'), '2.2.5\n');
  skill(join(home, '.claude/skills'), 'notes');
  skill(join(oc, 'skills'), 'oc-only');
  skill(join(home, '.agents/skills'), 'shared');
  const settings = join(oc, 'opencode.json');
  const settingsBefore = '{\n  // mine\n  "model": "a/b",\n  "mcp": {\n    "oc-docs": { "type": "local", "command": ["npx", "-y", "docs"], "environment": { "DOCS_TOKEN": "value-123" }, "enabled": false },\n  },\n}\n';
  writeFileSync(settings, settingsBefore);
  writeFileSync(join(oc, 'AGENTS.md'), 'Be brief.\n');
  mkdirSync(join(oc, 'agents'));
  writeFileSync(join(oc, 'agents/helper.md'), '---\ndescription: Helps.\nmode: subagent\n---\n\nYou help.\n');
  // Every tool is looked for only inside this home, so the flow reads the same on a machine that has some installed.
  const onlyHere = { CK_TEST_HOME_ONLY: 'claude,copilot,codex,pi,opencode' };
  const a = await launch(join(scratch, 'opencode-data'), flag('--electron') ? ['--as-released'] : [], home, onlyHere);
  // With --shots, a page's picture at each window size the app must fit.
  const pictures = async (page, name) => { if (!shots) return; for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) { await sizeTo(page, width, height); await page.shot(`${name}-${width}`); } await fullSize(page); };
  await a.click('#nav-harnesses');
  const card = await a.text('#harness-opencode-cli');
  await pictures(a, 'opencode-harnesses');
  check('OpenCode’s card names its CLI and its desktop app, each with its version, once', card.includes('Installed · 1.19.5; OpenCode desktop 2.2.5') && !card.includes('(OpenCode'), card);
  const pages = await a.all('#nav [id^="nav-"]', 'e.id.slice(4)');
  check('with OpenCode beside Claude Code, Agents and Plugins are pages', pages.includes('agents') && pages.includes('plugins'), pages);
  await a.click('#nav-skills');
  // OpenCode loads Claude Code's skills folder and the shared .agents folder as well as its own (measured on both of its lines).
  same('OpenCode has its own skill, Claude Code’s and the shared folder’s; Claude Code only its own',
    [await cellState(a, 'skills', 'notes', 'opencode-cli'), await cellState(a, 'skills', 'oc-only', 'opencode-cli'), await cellState(a, 'skills', 'shared', 'opencode-cli'), await cellState(a, 'skills', 'notes', 'claude-cli'), await cellState(a, 'skills', 'oc-only', 'claude-cli')],
    ['another-way', 'own-copy', 'another-way', 'own-copy', 'none']);
  await a.click(`#${rowPart('open', 'skills', 'notes')}`);
  check('a skill OpenCode reads in Claude Code’s folder says so: the copy is Claude Code’s', (await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'notes')}"] + *`) ?? '').includes('Not in Central Knot · OpenCode reads Claude Code’s copy, in Claude Code’s skills folder.'), await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'notes')}"] + *`));
  await fitsAtMinimum(a, 'Skills with OpenCode, a skill open');
  await pictures(a, 'opencode-skill-open');
  const view = await a.run('window.centralKnot.refresh()');
  same('its MCP server is read from its settings, off as its settings say', view.mcp.items.map(item => [item.key, item.switchedOff]), [['oc-docs', ['opencode-cli']]]);
  same('its agent is read from its agents folder', view.agents.items.map(item => [item.key, Object.keys(item.copies)]), [['helper', ['opencode-cli']]]);
  await a.click('#nav-mcp'); await a.click(`#${rowPart('open', 'mcp', 'oc-docs')}`); await pictures(a, 'opencode-mcp-open');
  await a.click('#nav-agents'); await pictures(a, 'opencode-agents');
  await a.click('#nav-instructions'); await pictures(a, 'opencode-instructions');
  check('its instruction file is AGENTS.md in its own folder', (await a.text('.page') ?? '').includes('~/.config/opencode/AGENTS.md') && (await a.text('.page') ?? '').includes('Be brief.'), await a.text('.page'));
  await a.click('#nav-plugins');
  check('marketplaces are said to come from the tools that have them, not OpenCode', /Marketplaces you added in Claude Code show up here/.test(await a.text('.page') ?? ''), await a.text('.page'));
  await a.click('#nav-harnesses'); await a.click('#harness-opencode-cli');
  await pictures(a, 'opencode-page-skills');
  await a.click('#harness-tab-plugins');
  await pictures(a, 'opencode-page-plugins');
  check('its Plugins tab says where plugins install and that a plugin’s items can go in', /installs marketplace plugins into Claude Code\. A plugin’s page on Plugin marketplaces puts its skills, agents and MCP servers in OpenCode as items of Central Knot’s that follow the plugin\./.test(await a.text('#harness-body') ?? ''), await a.text('#harness-body'));
  await a.click('#harness-tab-about');
  const about = await a.text('#harness-body');
  check('About names its folders and its settings file', ['~/.config/opencode/skills', '~/.claude/skills', '~/.config/opencode/opencode.json', '~/.config/opencode/agents', '~/.config/opencode/AGENTS.md'].every(path => about.includes(path)), about);
  await fitsAtMinimum(a, 'OpenCode’s page, About');
  await pictures(a, 'opencode-page-about');
  same('no page errors, OpenCode', a.pageErrors, []);
  await a.quit();

  // Writes, in the Practice copy (so they happen on every platform: a real home is preview only on Windows): OpenCode joins it
  // by its folder.
  const p = await launch(join(scratch, 'opencode-practice-data'), ['--practice-copy'], home, onlyHere);
  const practice = await p.run(`document.querySelector('.status-home').title`);
  const mine = join(practice, '.config/opencode');
  skill(join(mine, 'skills'), 'oc-only');
  writeFileSync(join(mine, 'opencode.json'), settingsBefore);
  await p.click('#header-refresh');
  await p.click('#nav-skills');
  check('an OpenCode folder gives OpenCode a mark on each row', await p.exists('.tool-mark[data-tool="opencode-cli"]'));
  same('a Claude Code skill is one OpenCode already reads', await cellState(p, 'skills', 'notes', 'opencode-cli'), 'another-way');
  await p.click(`#${rowPart('add', 'skills', 'oc-only')}`);
  check('adding OpenCode’s own skill copies it to the other tools', readNow(join(practice, '.claude/skills/oc-only/SKILL.md')) === text('oc-only') && readNow(join(practice, '.copilot/skills/oc-only/SKILL.md')) === text('oc-only'), await p.text('.bands'));
  // Turned Off, it leaves the other tools; OpenCode keeps the copy it was found with (left alone as its own while the skill is
  // off). Its tag says OpenCode has it, as OpenCode's mark does, and so does the Off heading once the list is read again (its
  // row stays where it was until then). Undo turns it back on.
  await p.click(`#${rowPart('switch', 'skills', 'oc-only')}`);
  same('Off, OpenCode keeps the copy it was found with, and the result and the tag say so, as its mark does',
    [existsSync(join(practice, '.claude/skills/oc-only')), existsSync(join(mine, 'skills/oc-only/SKILL.md')), await cellState(p, 'skills', 'oc-only', 'opencode-cli'),
      /^oc-only is off, but OpenCode has a copy Central Knot didn’t put there\./.test(await p.text('.band-done') ?? ''), await p.text(`.ov-row[data-key="${rowPart('', 'skills', 'oc-only')}"] .row-tag`)],
    [false, true, 'own-copy', true, 'in Central Knot and OpenCode']);
  await pictures(p, 'opencode-off-own-copy');
  await p.click('#outcome-undo');
  check('Undo turns it back on', await switchOn(p, 'skills', 'oc-only') && readNow(join(practice, '.claude/skills/oc-only/SKILL.md')) === text('oc-only'), await p.text('.bands'));
  await p.click(`#${rowPart('switch', 'skills', 'oc-only')}`); await p.click('#header-refresh');
  same('read again while Off, it is under Off, whose heading says OpenCode has a copy of its own', [(await sectionsNow(p, 'skills')).at(-1)?.[1].includes('oc-only'), (await p.text('.ov-section[data-section="off"] .ov-section-after'))?.replace(/^·\s*/, '')],
    [true, 'in Central Knot; 1 also in OpenCode, a copy Central Knot didn’t put there']);
  await p.click(`#${rowPart('switch', 'skills', 'oc-only')}`);
  // Taken in, notes goes to every tool but OpenCode, which reads Claude Code's copy: OpenCode's line says so, with no switch
  // of Central Knot's (nothing of it goes there), and its settings are untouched.
  await p.click(`#${rowPart('add', 'skills', 'notes')}`);
  same('a skill OpenCode reads in Claude Code’s folder gets no second copy in OpenCode', [existsSync(join(mine, 'skills/notes')), await cellState(p, 'skills', 'notes', 'opencode-cli')], [false, 'another-way']);
  if (await p.run(`document.querySelector('#${rowPart('open', 'skills', 'notes')}')?.getAttribute('aria-expanded')`) !== 'true') await p.click(`#${rowPart('open', 'skills', 'notes')}`);
  same('OpenCode’s line says it reads Claude Code’s copy, has no switch there, and its settings are untouched',
    [/OpenCode reads Claude Code’s copy/.test(await p.text(`.ov-row[data-key="${rowPart('', 'skills', 'notes')}"] + *`) ?? ''), await p.exists(`#${rowPart('enable', 'skills', 'notes', 'opencode-cli')}`), readNow(join(mine, 'opencode.json')) === settingsBefore], [true, false, true]);
  // Its server goes to the other tools in their own forms, values as they are.
  await p.click('#nav-mcp');
  await p.click(`#${rowPart('add', 'mcp', 'oc-docs')}`);
  const inCopilot = JSON.parse(readNow(join(practice, '.copilot/mcp-config.json')) || '{}').mcpServers?.['oc-docs'];
  same('OpenCode’s server reaches Copilot CLI in Copilot’s form', [inCopilot?.command, inCopilot?.args, inCopilot?.env], ['npx', ['-y', 'docs'], { DOCS_TOKEN: 'value-123' }]);
  // OpenCode takes no plugin whole: a plugin's skills, MCP servers and agents go in as library items linked to it, in OpenCode's forms.
  const market = join(scratch, 'opencode-market');
  writeMarket(market);
  await p.run(`window.centralKnot.addMarketplace(${JSON.stringify(market)})`);
  await p.click('#nav-plugins');
  await p.click('#header-refresh');
  const box = plugin => `[id^="pcell-"][id$="-${plugin}-opencode-cli"]`;
  for (let tries = 0; tries < 50 && !(await p.exists(box('issue-tracker'))); tries++) await wait(100);
  same('OpenCode is a column; the plugins, off, are in none of the tools', [await p.run(`document.querySelector('${box('issue-tracker')}')?.dataset.state`), await p.run(`document.querySelector('${box('release-helper')}')?.dataset.state`)], ['absent', 'absent']);
  // Three switches On, in one list: the plugins' items go into OpenCode (Claude Code's installer, a stand-in, refuses, and says so).
  await p.run(`['document-tools', 'issue-tracker', 'release-helper'].forEach(name => document.querySelector('.plugin-row[data-plugin="' + name + '"] .plugin-row-switch .switch').click())`);
  const listRuns = () => p.run(`document.body.dataset.busy === 'true' || [...document.querySelectorAll('.plugin-click')].some(note => note.dataset.click !== 'ended')`);
  for (let tries = 0; tries < 100 && await listRuns(); tries++) await wait(100);
  for (let tries = 0; tries < 50 && (await p.run(`document.querySelector('${box('release-helper')}')?.dataset.state`)) !== 'items'; tries++) await wait(100);
  const withParts = readNow(join(mine, 'opencode.json'));
  check('the plugin’s skill and MCP server are in OpenCode, the server in OpenCode’s form', existsSync(join(mine, 'skills/triage/SKILL.md')) && /"issues": \{\s*"type": "local",\s*"command": \[\s*"npx",\s*"-y",\s*"@example\/issues-mcp"\s*\]\s*\}/.test(withParts) && withParts.includes('// mine'), withParts || await p.text('.bands'));
  const partAgent = readNow(join(mine, 'agents/release-reviewer.md'));
  check('and a plugin’s agent is an OpenCode agent', partAgent.includes('description: Reviews a release branch before it ships.') && partAgent.includes('mode: all') && partAgent.includes('Review it.'), partAgent || await p.text('.bands'));
  await pictures(p, 'opencode-items-four-tools');
  // Each row's words on how its click ended (Claude Code's refusal, then its items in OpenCode) show whole at every size, as does
  // the toolbar's line on the whole list, wrapping where the room runs out.
  same('each row says how its click ended, and the toolbar what the whole list did', [await p.all('.plugin-row .plugin-click', 'e.dataset.click'), /document-tools: .*; issue-tracker: .*; release-helper: /.test(await p.text('#plugins-result') ?? '')], [['ended', 'ended', 'ended'], true]);
  for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) { await sizeTo(p, width, height); same(`a click’s words on Plugins show whole at ${width}×${height}`, await p.run(WORDS_CUT), []); }
  await fullSize(p);
  // document-tools was there for the length of that line: Off again, so what follows has the two plugins it had.
  await p.click('.plugin-row[data-plugin="document-tools"] .plugin-row-switch .switch');
  for (let tries = 0; tries < 100 && await listRuns(); tries++) await wait(100);
  same('document-tools is off again, its items out of OpenCode', [await p.run(`document.querySelector('${box('document-tools')}')?.dataset.state`), existsSync(join(mine, 'skills/pdf-reader'))], ['absent', false]);
  // Five tools is the widest table: nothing is cut off at the smallest window. Pi is installed with Harnesses open, whose
  // Refresh is the one read that finds it (Plugins' own read would find it first and start a second).
  await p.click('#nav-harnesses');
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await p.click('#header-refresh');
  // That read wrote the On items there by itself, the server among them: the Caught up band says so, naming Pi alone (what
  // the clicks above wrote is theirs), once: the next read, which writes nothing, has no band.
  const caught = await p.text('.bands') ?? '';
  check('the Caught up band names the server the read wrote in Pi, and Pi alone', /^Caught up: copied .*oc-docs.* to Pi, because they are on\./.test(caught), caught);
  await pictures(p, 'caught-up-server');
  await p.click('#header-refresh');
  check('and the next read, which writes nothing, has no band', !(await p.text('.bands') ?? '').includes('Caught up'), await p.text('.bands'));
  await p.click('#nav-skills');
  const marksPerRow = () => p.run(`[...(document.querySelector('.ov-row[data-key] .tool-marks')?.children ?? [])].map(mark => mark.dataset.tool)`);
  check('with Pi too, each row has five tool marks', (await marksPerRow()).length === 5, await marksPerRow());
  await pictures(p, 'opencode-five-skills');
  for (const page of ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'profiles']) {
    await p.click(`#nav-${page}`);
    await fitsAtMinimum(p, `${page} with five tools`);
    if (['mcp', 'plugins', 'profiles', 'harnesses', 'overview'].includes(page)) await pictures(p, `opencode-five-${page}`);
  }
  await p.click('#nav-plugins');
  await p.click('[id^="popen-"][id$="-issue-tracker"]');
  for (let tries = 0; tries < 40 && !/Its items/.test(await p.text('.plugin-page') ?? ''); tries++) await wait(100);
  await fitsAtMinimum(p, 'a plugin’s page with five tools');
  await pictures(p, 'opencode-five-plugin-page');
  same('no page errors, OpenCode in the Practice copy', p.pageErrors, []);
  await p.quit();
}

/**
 * Plugin marketplaces with four tools, then five (Pi joins): every row's name, version and chips show whole, in the smallest
 * window with the sidebar folded and open, and at 860×600, 1280×800, 1316×819, 1728×1117 and 2560×1440 with it open (style.css
 * "The plugin table"). The marketplace is this flow's own, registered in Claude Code: a plugin whose name is 45 characters with
 * a run of 25 letters, a long version and a category; one whose version is a build identifier with no break in it, wider than
 * the name's column in a narrow window; and one that Claude Code still has and the marketplace no longer lists.
 */
async function pluginRowsFitFlow() {
  const home = join(scratch, 'home-rows-fit'), market = join(scratch, 'market-rows-fit');
  const long = 'observabilitydashboarding-for-on-call-support', nightly = 'nightly-builds', gone = 'legacy-log-shipper';
  const buildId = '2.4.0+build20261118ab12cd34ef56ab78cd90ef12ab34';
  const file = (root, path, body) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
  const cli = (name, version) => { file(home, `.local/bin/${name}`, `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(home, '.local/bin', name), 0o755); };
  toolClis(home);
  cli('opencode', '1.19.5');
  file(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'rows-fit', owner: { name: 'Platform team' }, plugins: [
    { name: long, source: `./plugins/${long}`, version: '12.10.0-beta.3', category: 'observability', description: 'Dashboards, alerts and traces for the services a team runs, in one place.' },
    { name: nightly, source: `./plugins/${nightly}`, version: buildId, category: 'development', description: 'The latest build of the team’s tools, every night.' },
  ] }));
  for (const plugin of [long, nightly]) file(market, `plugins/${plugin}/skills/dashboards/SKILL.md`, '---\nname: dashboards\ndescription: Builds a dashboard.\n---\n\nBuild it.\n');
  file(home, '.claude/plugins/known_marketplaces.json', JSON.stringify({ 'rows-fit': { source: { source: 'directory', path: market }, installLocation: market } }));
  writeClaudeInstall(home, 'rows-fit', gone, '1.0.0', { 'skills/ship/SKILL.md': '---\nname: ship\ndescription: Ships logs.\n---\n\nShip them.\n' });
  const a = await launch(join(scratch, 'rows-fit-data'), flag('--electron') ? ['--as-released'] : [], home, { CK_TEST_HOME_ONLY: 'claude,copilot,codex,pi,opencode' });
  const pieces = name => a.all(`.plugin-row[data-plugin="${name}"] .plugin-row-open > *`);
  const sidebarOpen = async open => { if (await a.run(`document.body.classList.contains('rail')`) === open) await a.click('#sidebar-toggle'); };
  const titleLines = () => a.run(`(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.plugin-row[data-plugin="${long}"] .plugin-row-title'));
    return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; })()`);
  const theme = value => a.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  const rowsWhole = async tools => {
    for (let tries = 0; tries < 50 && await a.run(`document.querySelector('.plugin-table')?.dataset.tools`) !== String(tools); tries++) await wait(100);
    same(`the table has ${tools} tool columns; each row has its name, version and chips: the one no longer offered says so`,
      [await a.run(`document.querySelector('.plugin-table')?.dataset.tools`), await pieces(long), await pieces(nightly), await pieces(gone)],
      [String(tools), [long, '12.10.0-beta.3', 'observability'], [nightly, buildId, 'development'], [gone, 'No longer offered']]);
    for (const [width, height, open] of [[...SMALLEST, false], [...SMALLEST, true], [860, 600, true], [1280, 800, true], [1316, 819, true], [1728, 1117, true], [2560, 1440, true]]) {
      await sizeTo(a, width, height); await sidebarOpen(open);
      same(`with ${tools} tools at ${width}×${height}, the sidebar ${open ? 'open' : 'folded'}, every plugin’s name, version and chips show whole, nothing cut off`, [...await a.run(ROW_PIECES_CUT), ...await a.run(CUT_OFF)], []);
      if (width === 1280) same(`with ${tools} tools at 1280×800 the 45-character name has room for one line, and takes it`, await titleLines(), 1);
      if (open) await a.shot(`rows-fit-${tools}-tools-${width}x${height}`);
    }
    await theme('dark');
    for (const [width, height] of [SMALLEST, [1316, 819]]) { await sizeTo(a, width, height); await sidebarOpen(true); await a.shot(`rows-fit-${tools}-tools-${width}x${height}-dark`); }
    await theme('light');
    await fullSize(a);
  };
  await theme('light');
  await a.click('#nav-plugins');
  for (let tries = 0; tries < 50 && !(await a.exists(`.plugin-row[data-plugin="${gone}"]`)); tries++) await wait(100);
  await rowsWhole(4);
  // Pi joins at a read of the home, made where it is the one read (as openCodeFlow does: Plugins' own read would start a second).
  cli('pi', '0.70.2');
  await a.click('#nav-harnesses');
  await a.click('#header-refresh');
  await a.click('#nav-plugins');
  await rowsWhole(5);
  same('no page errors, the plugin rows', a.pageErrors, []);
  await a.quit();
}

/**
 * Marketplaces offered without being looked for: each plugin tool's own default, where that tool is here. Nothing is
 * fetched to offer one, so this flow never reaches the network (it never clicks Add).
 */
async function suggestedFlow() {
  const home = join(scratch, 'home-suggested');
  const cli = (path, version) => { mkdirSync(join(home, path, '..'), { recursive: true }); writeFileSync(join(home, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(home, path), 0o755); };
  cli('.local/bin/claude', '2.1.309 (Claude Code)');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const onlyHere = { CK_TEST_HOME_ONLY: 'claude,copilot,codex,pi,opencode' };
  const data = join(scratch, 'suggested-data');
  const a = await launch(data, flag('--electron') ? ['--as-released'] : [], home, onlyHere);
  const pictures = async name => { if (!shots) return; for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) { await sizeTo(a, width, height); await a.shot(`${name}-${width}`); } await fullSize(a); };
  const offered = page => page.all('.market-suggestion', `e.querySelector('.market-suggestion-name').textContent + ' · ' + e.querySelector('.market-suggestion-meta').textContent`);
  await a.click('#nav-plugins');
  same('with Claude Code alone, its own marketplace is suggested, and no other tool’s', await offered(a), ['claude-plugins-official · For Claude Code']);
  check('a suggestion has Add and a way to say no', await a.exists('#suggested-add-anthropics-claude-plugins-official') && await a.exists('#suggested-no-anthropics-claude-plugins-official'));
  await fitsAtMinimum(a, 'the empty Plugins page with a suggestion');
  // Said no to on the empty page: it goes at once, with a note and Undo, and Undo offers it again.
  await a.click('#suggested-no-anthropics-claude-plugins-official');
  same('declined on the empty page, it leaves at once', await offered(a), []);
  check('with a note and Undo', /claude-plugins-official won’t be suggested again\./.test(await a.text('#header') ?? '') && await a.exists('#outcome-suggest-again'), await a.text('.plugins-page'));
  await a.click('#outcome-suggest-again');
  const again = `${await a.text('.plugins-page') ?? ''} ${await a.run(`document.querySelector('#announcement').dataset.text`) ?? ''}`;
  same('Undo offers it again, and says so', [await offered(a), /claude-plugins-official is suggested again\./.test(again), await a.exists('#outcome-suggest-again')], [['claude-plugins-official · For Claude Code'], true, false]);
  await pictures('suggested-empty');
  // Copilot CLI joins the home: its marketplace is offered too.
  cli('.local/bin/copilot', 'GitHub Copilot CLI 1.0.109.');
  mkdirSync(join(home, '.copilot'), { recursive: true });
  await a.click('#header-refresh');
  same('each tool here brings its own', await offered(a), ['claude-plugins-official · For Claude Code', 'copilot-plugins · For Copilot CLI']);
  // With a marketplace on the list, the suggestions sit under it.
  const market = join(scratch, 'suggested-market');
  writeMarket(market);
  await a.run(`window.centralKnot.addMarketplace(${JSON.stringify(market)})`);
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && !(await a.exists('.market-list .market-suggested')); tries++) await wait(100);
  same('beside a marketplace on the list, the suggestions are under the list', await offered(a), ['claude-plugins-official · For Claude Code', 'copilot-plugins · For Copilot CLI']);
  await fitsAtMinimum(a, 'Plugins with a marketplace and two suggestions');
  await pictures('suggested-under-list');
  // Said no to: gone at once, and not offered again after a restart.
  await a.click('#suggested-no-github-copilot-plugins');
  for (let tries = 0; tries < 50 && (await offered(a)).length !== 1; tries++) await wait(100);
  same('a declined suggestion leaves the page', await offered(a), ['claude-plugins-official · For Claude Code']);
  check('with a note that it won’t be suggested again, and Undo', /copilot-plugins won’t be suggested again\./.test(await a.text('#header') ?? '') && await a.exists('#outcome-suggest-again'), await a.text('.plugins-page'));
  await a.click('#outcome-suggest-again');
  for (let tries = 0; tries < 50 && (await offered(a)).length !== 2; tries++) await wait(100);
  same('Undo offers it again', (await offered(a)).length, 2);
  await a.click('#suggested-no-github-copilot-plugins');
  for (let tries = 0; tries < 50 && (await offered(a)).length !== 1; tries++) await wait(100);
  same('no page errors, suggested marketplaces', a.pageErrors, []);
  await a.quit();
  const b = await launch(data, flag('--electron') ? ['--as-released'] : [], home, onlyHere);
  await b.click('#nav-plugins');
  for (let tries = 0; tries < 50 && !(await b.exists('.market-suggestion')); tries++) await wait(100);
  same('and stays declined after a restart', await offered(b), ['claude-plugins-official · For Claude Code']);
  same('no page errors, suggested marketplaces after a restart', b.pageErrors, []);
  await b.quit();
}

/**
 * The other desktop apps: pi-gui counts as Pi's app, and T3 Code and VS Code, which are no tool of their own, are named
 * under the Harnesses cards when they are installed, and nowhere when they are not.
 */
async function otherAppsFlow() {
  const home = join(scratch, 'home-other-apps');
  const cli = (path, version) => { mkdirSync(join(home, path, '..'), { recursive: true }); writeFileSync(join(home, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(home, path), 0o755); };
  const app = (name, version) => { mkdirSync(join(home, 'Applications', name, 'Contents'), { recursive: true }); writeFileSync(join(home, 'Applications', name, 'Contents/Info.plist'), `<?xml version="1.0"?>\n<plist><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`); };
  cli('.local/bin/claude', '2.1.309 (Claude Code)');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const a = await launch(join(scratch, 'other-apps-data'), flag('--electron') ? ['--as-released'] : [], home, { CK_TEST_HOME_ONLY: 'claude,copilot,codex,pi,opencode' });
  await a.click('#nav-harnesses');
  check('with none of them installed, nothing is said about other apps', !(await a.exists('#other-apps')));
  app('T3 Code (Nightly).app', '0.1.9-nightly.20261110.4478');
  app('Visual Studio Code.app', '1.99.0');
  app('pi-gui.app', '0.4.0');
  await a.click('#header-refresh');
  const also = await a.text('#other-apps') ?? '';
  check('T3 Code and VS Code are named under the cards, each with its version (a nightly build’s shortened) and what it means here', /T3 Code 0\.1\.9-nightlyRuns your tools for you\./.test(also) && /VS Code 1\.99\.0Its built-in Copilot lists skills/.test(also), also);
  const pi = await a.text('#harness-pi-cli') ?? '';
  check('pi-gui alone makes Pi a tool here, named as the third-party app it is, with no CLI', pi.includes('pi-gui (third-party) 0.4.0 · no CLI found') && await a.exists('button#harness-pi-cli'), pi);
  await fitsAtMinimum(a, 'Harnesses with other apps named');
  if (shots) for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) { await sizeTo(a, width, height); await a.shot(`other-apps-${width}`); }
  await fullSize(a);
  same('no page errors, other apps', a.pageErrors, []);
  await a.quit();
}

/** Every file under a folder, by its path inside, with a hash of its bytes: what "nothing changed" is checked against. */
const treeOf = dir => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => [relative(dir, join(entry.parentPath, entry.name)), createHash('sha256').update(readFileSync(join(entry.parentPath, entry.name))).digest('hex')]));

/**
 * A home as the alpha left it, opened next by this build: release-notes On in every tool by the alpha's own code, then edited in
 * Claude Code; History holding an entry 60 days old; the alpha's settings (History kept 90 days, Automatic sync off) beside this
 * build's data folder, as every build's are; the alpha installed in a stand-in /Applications. `tag` keeps each one's folders apart.
 * `open` opens it as another folder (this build's saved home), or with `asThisMac` as this Mac's own home (its HOME).
 */
async function alphaSyncedHome(tag) {
  const mac = standInMac(join(scratch, `mac-${tag}`));
  const ALPHA_ID = 'com.centralknot.alpha', alphaPath = join(mac.applications, 'Central Knot Alpha.app');
  const inTrash = () => (existsSync(mac.trash) ? readdirSync(mac.trash) : []);
  const home = join(scratch, `${tag}-home`), data = join(scratch, tag, 'data'), alphaData = join(scratch, tag, ALPHA_ID);
  cpSync(join(root, 'fixtures/home'), home, { recursive: true });
  mkdirSync(alphaData, { recursive: true });
  const asAlpha = { home, mode: 'custom', read: () => Promise.all(harnessIds.map(harness => discover({ home, mode: 'custom', harness }))), build: ALPHA_ID, buildName: 'Central Knot Alpha', settingsPath: join(alphaData, 'sharing-settings.json'), realHome: join(scratch, 'elsewhere'), settleMs: 0 };
  const managed = await applySkills(asAlpha, await managedNow(asAlpha, await asAlpha.read()), [{ key: 'release-notes', on: true, except: [] }]);
  check(`the alpha syncs the home first (${tag})`, !managed.stopped && managed.writes > 0, managed.stopped);
  const notes = tool => join(home, tool, 'skills/release-notes/SKILL.md'), edited = `${readFileSync(notes('.claude'), 'utf8')}\nEdited while another build is here.\n`;
  writeFileSync(notes('.claude'), edited);
  const historyFile = join(home, '.central-knot/history.json');
  writeFileSync(historyFile, JSON.stringify({ events: [...JSON.parse(readFileSync(historyFile, 'utf8')).events,
    { id: 'aged-60', at: new Date(Date.now() - 60 * DAY).toISOString(), key: 'aged-60', item: 'aged-60-days', kind: 'edit', winner: { tool: 'claude-cli', hash: '0'.repeat(64) }, losers: [], orderProved: true }] }));
  writeFileSync(join(alphaData, 'app-settings.json'), JSON.stringify({ historyDays: 90, home: { mode: 'custom', path: home } }));
  writeFileSync(join(alphaData, 'sync-settings.json'), JSON.stringify({ syncOn: false }));
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  mac.bundle(mac.applications, 'Central Knot Alpha', ALPHA_ID);
  const saved = name => { try { return JSON.parse(readFileSync(join(data, name), 'utf8')); } catch { return {}; } };
  const settings = () => [saved('sync-settings.json').syncOn, saved('app-settings.json').historyDays];
  const record = () => JSON.parse(readFileSync(join(home, '.central-knot/sync.json'), 'utf8')), owner = () => record().owner;
  const aged = () => JSON.parse(readFileSync(historyFile, 'utf8')).events.some(event => event.id === 'aged-60');
  const open = (asThisMac = false) => launch(data, [], asThisMac ? home : HOME, { CK_TEST_APPS: mac.root, CK_TEST_OWN_BUNDLE: join(mac.applications, 'Central Knot.app') });
  return { mac, ALPHA_ID, alphaPath, alphaData, inTrash, home, data, notes, edited, historyFile, settings, record, owner, aged, open };
}

/** The tools' own folders in a home (not Central Knot's, nor what the browser engine keeps in a HOME): what "nothing in the tools changed" is checked against. */
const toolFiles = home => Object.fromEntries(['.claude', '.copilot', '.codex', '.agents'].filter(folder => existsSync(join(home, folder))).flatMap(folder => Object.entries(treeOf(join(home, folder))).map(([path, hash]) => [join(folder, path), hash])));

/**
 * The record changes hands at the look, by itself. Freed of the build the record names, however it went (moved to the Trash by
 * hand, then Refresh, or Replace on the screen still showing it), its choices are kept, and History's days are the longer of the
 * two. Freed of another build than the one the record names (two replaced in turn): re-recorded, the home waits for Resume,
 * and only the longer History comes with it. The alpha's settings folder missing: this build's own settings, said so. Another
 * folder whose record names the alpha, gone before this build opened: the same as two replaced in turn, and nothing in its tools
 * written before Resume; remembered here, no Resume, and History isn't trimmed below the longer of the two. A record that can't
 * be written: the page shows, the record stays, and the log says why.
 */
async function freedOtherWaysFlow() {
  for (const how of ['Refresh', 'Replace']) {
    const held = await alphaSyncedHome(`by-hand-${how.toLowerCase()}`), a = await held.open();
    mkdirSync(held.mac.trash, { recursive: true });
    renameSync(held.alphaPath, join(held.mac.trash, 'Central Knot Alpha.app'));
    await a.click(how === 'Refresh' ? '#header-refresh' : '#held-replace');
    same(`the alpha moved to the Trash by hand, then ${how}: this build syncs the home, with the alpha's Automatic sync (off) and History days (90)`, [await a.exists('#held'), held.owner(), held.settings()], [false, 'com.centralknot.firstlook', [false, 90]]);
    await a.run(`window.centralKnot.syncNow(${JSON.stringify(held.home)})`);
    check(`and a History write after it keeps the entry from 60 days ago (${how})`, readFileSync(held.notes('.copilot'), 'utf8') === held.edited && held.aged());
    if (how === 'Refresh') check('Refresh says so in the status bar', (await a.text('#announcement') ?? '').startsWith('Central Knot syncs this home now, and keeps Central Knot Alpha’s choices'), await a.text('#announcement'));
    same(`no page errors, freed by ${how}`, a.pageErrors, []);
    await a.quit();
  }
  // History's days are this build's for every home it opens: a take-over keeps the longer of the two, never a shorter one.
  const longer = await alphaSyncedHome('longer');
  writeFileSync(join(longer.alphaData, 'app-settings.json'), JSON.stringify({ historyDays: 30 }));
  writeFileSync(join(longer.data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: longer.home }, historyDays: 90 }));
  const d = await longer.open();
  mkdirSync(longer.mac.trash, { recursive: true });
  renameSync(longer.alphaPath, join(longer.mac.trash, 'Central Knot Alpha.app'));
  await d.click('#header-refresh');
  same('freed by Refresh, this build at 90 days and the alpha at 30: still 90', [await d.exists('#held'), longer.owner(), longer.settings()], [false, 'com.centralknot.firstlook', [false, 90]]);
  await d.run(`window.centralKnot.syncNow(${JSON.stringify(longer.home)})`);
  check('and a History write after it keeps the entry from 60 days ago', readFileSync(longer.notes('.copilot'), 'utf8') === longer.edited && longer.aged());
  same('no page errors, the longer of the two', d.pageErrors, []);
  await d.quit();
  // Two builds replaced in turn, the record naming the first: the look that frees this build is Zed Knot's, so the alpha's
  // Automatic sync and plugin updates don't come with the record, only History's days, the longer of the two.
  const held = await alphaSyncedHome('two-builds');
  held.mac.bundle(held.mac.applications, 'Zed Knot', 'com.centralknot.custom.zed');
  const a = await held.open();
  same('two builds: the alpha’s screen promises its History days alone, since the look that frees this build will be Zed Knot’s', [(await a.text('#held-title') ?? '').startsWith('Central Knot Alpha'), await a.text('#held > p:nth-of-type(3)')],
    [true, 'Central Knot Alpha syncs this home, but Replace keeps Central Knot’s own choices here: whether Automatic sync is on and whether plugins update by themselves stay as they are, and History is kept for the longer of the two builds’ days. Its other settings, and any marketplace added only in it, don’t carry over.']);
  await a.click('#held-replace');
  same('two builds: after the alpha is replaced, the next screen names Zed Knot and says what came of the alpha', [await a.text('#held-title'), (await a.text('#held-said') ?? '').startsWith('Central Knot Alpha is in the Trash')], [`Zed Knot is installed in ${held.mac.applications}`, true]);
  await a.click('#held-replace');
  same('then Zed Knot: both in the Trash, and the record names this build, with its own Automatic sync and the alpha’s 90 days of History', [held.inTrash().sort(), await a.exists('#held'), held.owner(), held.settings()], [['Central Knot Alpha.app', 'Zed Knot.app'], false, 'com.centralknot.firstlook', [undefined, 90]]);
  check('the band says what came of Zed Knot, and nothing of the alpha’s choices', /^Zed Knot is in the Trash/.test(await a.text('[data-outcome] .band-text') ?? ''), await a.text('[data-outcome] .band-text'));
  await a.click('#nav-skills');
  check('Skills asks Resume: this build has no memory of the record', await a.exists('#resume'), await a.text('.bands'));
  await a.click('#resume');
  check('Resume, with this build’s Automatic sync on, spreads the edit, and the entry from 60 days ago stays', readFileSync(held.notes('.copilot'), 'utf8') === held.edited && held.aged());
  same('no page errors, two builds', a.pageErrors, []);
  await a.quit();
  // The alpha's settings folder isn't there: the screen and the result say this build's own settings stay, and they do.
  const bare = await alphaSyncedHome('no-folder');
  rmSync(bare.alphaData, { recursive: true });
  writeFileSync(join(bare.data, 'sync-settings.json'), JSON.stringify({ syncOn: false }));
  const b = await bare.open();
  same('without the alpha’s settings folder, the screen promises nothing of it: this build’s own settings, History’s days among them', await b.text('#held > p:nth-of-type(3)'),
    'Central Knot Alpha syncs this home, but its settings folder isn’t on this Mac, so Central Knot will use its own settings, among them how many days of History are kept: anything older is dropped at its next change. Any marketplace added only in Central Knot Alpha doesn’t carry over.');
  await b.click('#held-replace');
  check('and the result says the same, with this build’s settings as they were', (await b.text('[data-outcome] .band-text') ?? '').startsWith('Central Knot syncs this home now, with its own settings: Central Knot Alpha’s settings folder wasn’t found') && bare.owner() === 'com.centralknot.firstlook' && JSON.stringify(bare.settings()) === JSON.stringify([false, undefined]), [await b.text('[data-outcome] .band-text'), bare.settings()]);
  same('no page errors, no settings folder', b.pageErrors, []);
  await b.quit();
  // Another folder whose record names the alpha, gone before this build ever opened (Automatic sync off, 90 days, plugin updates
  // off, This Mac's home to open), with this build at On and 30 days: the record is this build's at the first look, by name; of
  // the alpha's choices only History's days come with it; the folder waits for Resume, and nothing in its tools is written before.
  const other = await alphaSyncedHome('other-folder');
  rmSync(other.alphaPath, { recursive: true });
  writeFileSync(join(other.alphaData, 'app-settings.json'), JSON.stringify({ historyDays: 90, pluginUpdates: false, home: { mode: 'actual' } }));
  writeFileSync(join(other.data, 'sync-settings.json'), JSON.stringify({ syncOn: true }));
  const ownSync = readFileSync(join(other.data, 'sync-settings.json'), 'utf8'), ownApp = JSON.parse(readFileSync(join(other.data, 'app-settings.json'), 'utf8'));
  const files = toolFiles(other.home);
  const c = await other.open();
  await c.click('#nav-skills');
  same('opened with the alpha gone: nothing holds this build, and the record names it, by its name', [await c.exists('#held'), other.record().owner, other.record().ownerName], [false, 'com.centralknot.firstlook', 'Central Knot']);
  same('of the alpha’s choices only History’s days are this build’s now (the longer): Automatic sync, plugin updates and the home it opens are as they were',
    [readFileSync(join(other.data, 'sync-settings.json'), 'utf8'), JSON.parse(readFileSync(join(other.data, 'app-settings.json'), 'utf8'))], [ownSync, { ...ownApp, historyDays: 90 }]);
  check('Skills asks Resume, and nothing on the page names the alpha', await c.exists('#resume') && !(await c.run('document.body.innerText')).includes('Central Knot Alpha'), await c.text('.bands'));
  same('nothing in its tools changed before Resume', toolFiles(other.home), files);
  await c.click('#resume');
  check('Resume spreads the edit, and History, written at 90 days, keeps the entry from 60 days ago', readFileSync(other.notes('.copilot'), 'utf8') === other.edited && other.aged());
  same('no page errors, another folder', c.pageErrors, []);
  await c.quit();
  // The same, in a folder this build remembers (it synced it before): no Resume, so the first view's pass writes, at 90 days.
  const known = await alphaSyncedHome('remembered');
  rmSync(known.alphaPath, { recursive: true });
  writeFileSync(join(known.data, 'sharing-settings.json'), JSON.stringify({ homes: { [known.home]: { generation: known.record().generation } } }));
  const e = await known.open();
  await e.click('#nav-skills');
  same('a folder this build remembers, taken over without its choices: no Resume, the first pass spreads the edit, and History at 90 days keeps the entry from 60 days ago',
    [known.owner(), await e.exists('#resume'), readFileSync(known.notes('.copilot'), 'utf8') === known.edited, known.aged(), known.settings()], ['com.centralknot.firstlook', false, true, true, [undefined, 90]]);
  same('no page errors, a folder remembered', e.pageErrors, []);
  await e.quit();
  // A folder this build synced once, set up afresh by the alpha since (a new generation of its record): the take-over lets go of
  // the memory of the older record, so the folder waits for Resume instead of stopping for good, and Resume carries on.
  const afresh = await alphaSyncedHome('set-up-afresh');
  rmSync(afresh.alphaPath, { recursive: true });
  writeFileSync(join(afresh.data, 'sharing-settings.json'), JSON.stringify({ homes: { [afresh.home]: { generation: 'an-older-record-this-build-made' } } }));
  const fresh = await afresh.open();
  await fresh.click('#nav-skills');
  check('a folder this build remembers by an older record: the page offers Resume, not a stop', await fresh.exists('#resume'), await fresh.text('.bands'));
  if (await fresh.exists('#resume')) await fresh.click('#resume');
  check('and Resume spreads the waiting edit', readFileSync(afresh.notes('.copilot'), 'utf8') === afresh.edited);
  same('no page errors, a folder set up afresh', fresh.pageErrors, []);
  await fresh.quit();
  // A record that can't be written (its folder read-only): the page shows as it would have, the record stays, and the log says why.
  const locked = await alphaSyncedHome('read-only');
  rmSync(locked.alphaPath, { recursive: true });
  const store = join(locked.home, '.central-knot'), unchanged = readFileSync(join(store, 'sync.json'), 'utf8');
  chmodSync(store, 0o555);
  const f = await locked.open();
  await f.click('#nav-skills');
  const after = [await f.exists('#nav-skills'), readFileSync(join(store, 'sync.json'), 'utf8') === unchanged, readNow(join(locked.data, 'central-knot.log'))];
  chmodSync(store, 0o755);
  check('a record that can’t be written: the page shows, sync.json is as it was, and the log says why', after[0] && after[1] && after[2].includes('record names com.centralknot.alpha, and it wasn’t taken over:'), after[2].split('\n').filter(line => line.includes('sync:')));
  same('no page errors, a record that can’t be written', f.pageErrors, []);
  await f.quit();
  // A look that can't answer (an Applications folder that can't be read) takes nothing over: whether another build is here isn't known.
  const blind = await alphaSyncedHome('unanswered');
  rmSync(blind.alphaPath, { recursive: true });
  chmodSync(blind.mac.applications, 0o000);
  const g = await blind.open();
  const named = blind.owner();
  chmodSync(blind.mac.applications, 0o755);
  same('a look that can’t answer takes nothing over: the record still names the alpha, and the pages show', [named, await g.exists('#nav-skills'), g.pageErrors], ['com.centralknot.alpha', true, []]);
  await g.quit();
}

/**
 * This Mac's own home whose record names the alpha, gone before this build opened (only where the real home can be written:
 * machine.ts writesRealHome; off a Mac, the alpha's stand-ins stand in for a Mac's). The first look carries the alpha's
 * choices: its Automatic sync off is in force before the first pass, so with an edit waiting no tool file changes, the status
 * bar says so once, and nothing else names the alpha; History's days are the longer of the two; and a build that still
 * remembers the home writes at its first pass with the alpha's days already in force.
 */
async function thisMacTakeOverFlow() {
  if (!canWriteRealHome) return;
  const asThisMac = async (tag, settings) => {
    const held = await alphaSyncedHome(tag);
    rmSync(held.alphaPath, { recursive: true });
    toolClis(held.home);
    writeFileSync(join(held.data, 'app-settings.json'), JSON.stringify({ home: { mode: 'actual' }, ...settings }));
    return held;
  };
  // This build at its default 30 days, the alpha at 90 with Automatic sync off; an edit waits in Claude Code.
  const mine = await asThisMac('this-mac', {}), files = toolFiles(mine.home);
  const a = await mine.open(true);
  same('this Mac’s home at launch: the record names this build by its name, the alpha’s Automatic sync (off) and 90 days are this build’s, and no tool file changed',
    [mine.record().owner, mine.record().ownerName, mine.settings(), JSON.stringify(toolFiles(mine.home)) === JSON.stringify(files)], ['com.centralknot.firstlook', 'Central Knot', [false, 90], true]);
  check('the status bar says so, once', (await a.text('#announcement') ?? '').startsWith('Central Knot syncs this home now, and keeps Central Knot Alpha’s choices') && (await a.run('window.centralKnot.refresh()')).tookOver === undefined, await a.text('#announcement'));
  await a.click('#nav-skills');
  check('no band names the alpha, and nothing asks Resume', !(await a.exists('#resume')) && !(await a.text('.bands') ?? '').includes('Central Knot Alpha'), await a.text('.bands'));
  await a.run(`window.centralKnot.syncNow(${JSON.stringify(mine.home)})`);
  check('Sync once spreads the edit, and History, written at 90 days, keeps the entry from 60 days ago', readFileSync(mine.notes('.copilot'), 'utf8') === mine.edited && mine.aged());
  same('no page errors, this Mac’s home', a.pageErrors, []);
  await a.quit();
  // This build at 90, the alpha at 30: still 90.
  const longer = await asThisMac('this-mac-longer', { historyDays: 90 });
  writeFileSync(join(longer.alphaData, 'app-settings.json'), JSON.stringify({ historyDays: 30 }));
  const b = await longer.open(true);
  same('this Mac’s home, this build at 90 days and the alpha at 30: still 90', [longer.owner(), longer.settings()[1]], ['com.centralknot.firstlook', 90]);
  same('no page errors, this Mac’s home at 90', b.pageErrors, []);
  await b.quit();
  // A build reinstalled that still remembers this Mac's home, at 30 days; the alpha at 90 with Automatic sync on: the first view's
  // pass writes, with the alpha's days already in force.
  const again = await asThisMac('this-mac-remembered', {});
  writeFileSync(join(again.alphaData, 'sync-settings.json'), JSON.stringify({ syncOn: true }));
  writeFileSync(join(again.data, 'sharing-settings.json'), JSON.stringify({ homes: { [again.home]: { generation: again.record().generation } } }));
  const c = await again.open(true);
  same('reinstalled, still remembering this Mac’s home: the first pass spreads the edit, and History, written at the alpha’s 90 days, keeps the entry from 60 days ago',
    [again.owner(), readFileSync(again.notes('.copilot'), 'utf8') === again.edited, again.aged(), again.settings()], ['com.centralknot.firstlook', true, true, [true, 90]]);
  same('no page errors, reinstalled', c.pageErrors, []);
  await c.quit();
  // A record that can't be written, on this Mac's home: History's days are kept first, and the other choices only once the record
  // is taken over, so this build's Automatic sync stays its own.
  const locked = await asThisMac('this-mac-read-only', {}), store = join(locked.home, '.central-knot');
  chmodSync(store, 0o555);
  const d = await locked.open(true);
  const after = [locked.owner(), locked.settings()];
  chmodSync(store, 0o755);
  same('this Mac’s home whose record can’t be written: the record stays, History’s days are the longer, and Automatic sync is this build’s own', after, ['com.centralknot.alpha', [undefined, 90]]);
  same('no page errors, a record that can’t be written here', d.pageErrors, []);
  await d.quit();
}

/**
 * One install at a time (otherbuilds.ts, otherbuildview.ts): a home the alpha synced, with an edit waiting and History older
 * than 30 days, opened while the alpha is installed in the stand-in /Applications. This build is held from the first view
 * (nothing written, before or after the screen shows), then Replace: the alpha in the stand-in Trash, its Automatic sync (off)
 * and History's days (90) kept, the record taken over, the pages back. Then a custom build found and replaced under its own
 * name, a refusal, and Quit on a build running only from Downloads.
 */
async function otherBuildFlow() {
  const { mac, ALPHA_ID, alphaPath, inTrash, home, data, notes, edited, historyFile } = await alphaSyncedHome('builds');
  mac.bundle(mac.applications, 'Central Knot Helper', 'com.example.helper');
  const before = treeOf(home);

  const a = await launch(data, [], HOME, { CK_TEST_APPS: mac.root, CK_TEST_OWN_BUNDLE: join(mac.applications, 'Central Knot.app') });
  const HELD = 'Central Knot Alpha is also installed on this Mac, and only one build of Central Knot works at a time, so Central Knot changes nothing in this home or your tools until one of the two is gone.';
  same('opened while the alpha is installed, the window shows the held screen in place of the pages: which build and where, what is going on and what the buttons do, the buttons, then what stays, what is kept, what Replace does and how to keep the alpha instead', await a.all('#held > *', 'e.textContent'), [
    `Central Knot Alpha is installed in ${mac.applications}`,
    'Only one build of Central Knot works at a time, so Central Knot changes nothing in this home or your tools until one of the two is gone: Replace moves Central Knot Alpha to the Trash and Central Knot carries on, and Quit Central Knot closes this app and leaves both installed.',
    'Replace Central Knot AlphaQuit Central Knot',
    'Your skills, MCP servers and agents, which of them are kept in step, and History stay whichever build you keep: they’re saved in this home, not in an app.',
    'Central Knot Alpha syncs this home, so Replace keeps its choices here: whether Automatic sync is on, whether plugins update by themselves and how many days of History are kept (the longer of the two). Its other settings, and any marketplace added only in it, don’t carry over.',
    `Replace asks every running copy of Central Knot Alpha to quit and waits up to 20 seconds, then moves ${alphaPath} to the Trash, where it stays until you empty the Trash. Central Knot Alpha’s own settings folder stays.`,
    'To keep Central Knot Alpha instead, quit Central Knot and move it to the Trash.',
  ]);
  check('no page, no home and no other build’s name in the sidebar; the header says one build at a time', await a.all('#nav > *, #homes > *').then(rows => rows.length === 0) && await a.text('.page-title') === 'One build at a time' && !(await a.run('document.body.innerText')).includes('Helper'));
  same('the status bar says writing is paused, and the switch why', [await a.text('#status-facts .tone-warning .fact-long'), await a.run(`document.querySelector('#sync-switch').title`)], ['Paused: another build is here', HELD]);
  same('a write the page asks for is refused, in that sentence', (await a.run(`window.centralKnot.setSyncEverything(true, ${JSON.stringify(home)}, true)`)).stopped, HELD);
  await a.click('#header-refresh');
  same('nothing in the home or its tools changed, before or after the screen showed (the look comes before the first pass)', treeOf(home), before);
  await fitsAtMinimum(a, 'the held screen');

  await a.click('#held-replace');
  const said = await a.text('[data-outcome] .band-text') ?? '';
  check('Replace: the alpha is in the stand-in Trash, the held screen is gone and the pages are back', !existsSync(alphaPath) && inTrash().join() === 'Central Knot Alpha.app' && !(await a.exists('#held')) && await a.exists('#nav-skills'), inTrash());
  check('the band says first that this build syncs the home now and keeps the alpha’s choices, then where the alpha went', said.startsWith('Central Knot syncs this home now, and keeps Central Knot Alpha’s choices: whether Automatic sync is on, whether plugins update by themselves and how many days of History are kept (the longer of the two). Central Knot Alpha is in the Trash, where it stays until you empty the Trash.'), said);
  same('the record is this build’s now', JSON.parse(readFileSync(join(home, '.central-knot/sync.json'), 'utf8')).owner, 'com.centralknot.firstlook');
  same('the alpha’s Automatic sync (off) and History’s days (90) are this build’s', [JSON.parse(readFileSync(join(data, 'sync-settings.json'), 'utf8')).syncOn, JSON.parse(readFileSync(join(data, 'app-settings.json'), 'utf8')).historyDays, await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`)], [false, 90, 'false']);
  check('with Automatic sync off, no pass wrote: the edit waits in Claude Code', readFileSync(notes('.claude'), 'utf8') === edited && readFileSync(notes('.copilot'), 'utf8') !== edited);
  await a.click('#overview-sync-now');
  check('Sync once spreads the edit, and History, written with 90 days, keeps the entry from 60 days ago', readFileSync(notes('.copilot'), 'utf8') === edited && JSON.parse(readFileSync(historyFile, 'utf8')).events.some(event => event.id === 'aged-60'));

  // A custom build, found and replaced under its own name; the record is this build's, so nothing is carried over. Found at a
  // view's start, before its pass: Sync once, asked the moment it is installed with an edit waiting, spreads nothing.
  const editedAgain = `${edited}Edited again.\n`;
  writeFileSync(notes('.claude'), editedAgain);
  const acme = mac.bundle(mac.applications, 'Acme Knot', 'com.centralknot.custom.acme');
  await a.run(`window.centralKnot.syncNow(${JSON.stringify(home)})`);
  check('a view looks before its pass: Sync once, asked the moment another build is installed, spreads nothing', readFileSync(notes('.copilot'), 'utf8') === edited);
  await a.click('#header-refresh');
  same('a custom build is found by its own name', await a.text('#held-title'), `Acme Knot is installed in ${mac.applications}`);
  same('and what carries over is only its own business', await a.text('#held > p:nth-of-type(3)'), 'Acme Knot’s own settings, and any marketplace added only in it, don’t carry over.');
  // Refused first: the stand-in Trash can't be written, as macOS refusing to move it. Still held, with the words and Show in Finder.
  mkdirSync(mac.trash, { recursive: true }); chmodSync(mac.trash, 0o555);
  await a.click('#held-replace');
  chmodSync(mac.trash, 0o755);
  check('a refusal leaves the build held, says why, and offers Show in Finder', await a.exists('#held') && (await a.text('#held-said') ?? '').startsWith(`macOS didn’t let Central Knot move Acme Knot to the Trash, so it is still in ${mac.applications}.`) && await a.text('#held-show') === 'Show in Finder', await a.text('#held-said'));
  // Moved to the Trash by hand, as the refusal says, then Refresh: the pages are back.
  renameSync(acme, join(mac.trash, 'Acme Knot.app'));
  await a.click('#header-refresh');
  check('then moved by hand and Refresh: the pages are back', inTrash().includes('Acme Knot.app') && !(await a.exists('#held')), inTrash());

  // A build running only from Downloads: Quit it in place of Replace.
  const stray = await standInApp(true);
  launched.add(stray);
  stray.once('exit', () => launched.delete(stray));
  const downloaded = mac.bundle(join(HOME, 'Downloads'), 'Central Knot Alpha', ALPHA_ID);
  mac.running([{ bundleId: ALPHA_ID, pid: stray.pid, path: downloaded }]);
  await a.click('#header-refresh');
  same('a build running only from Downloads is said so, with Quit in place of Replace, and the old refusal is not under its buttons', [await a.text('#held-title'), await a.text('#held-quit-other'), await a.exists('#held-replace'), await a.exists('#held-said')],
    [`Central Knot Alpha is running from ${downloaded}, not from an Applications folder`, 'Quit Central Knot Alpha', false, false]);
  await a.click('#held-quit-other');
  await wait(100);
  check('Quit: it quit, and the pages are back', (stray.exitCode !== null || stray.signalCode !== null) && !(await a.exists('#held')), { exit: stray.exitCode, signal: stray.signalCode });
  stray.kill('SIGKILL');
  mac.running([]);
  same('no page errors, another build', a.pageErrors, []);
  // The menus and the login item while held, then held and closed: a Linux development run, whose main process the checks can
  // reach and stand in as an installed Mac app with its login items (cdp.mjs standIn).
  if (!a.main || process.platform !== 'linux') { await a.quit(); return; }
  const main = await a.main();
  await standIn(main, 'darwin');
  const heldAgain = async () => { mac.bundle(mac.applications, 'Central Knot Alpha', ALPHA_ID); await a.click('#header-refresh'); };
  const menuItems = () => main.run(`ck.menus.slice(-2).flat().flatMap(item => [item, ...(Array.isArray(item.submenu) ? item.submenu : [])]).filter(item => /sync|sign-in/i.test(item.label ?? '')).map(({ label, enabled, visible }) => ({ label, enabled: enabled !== false, visible: visible !== false }))`);
  await heldAgain();
  const menus = await menuItems();
  check('held, the menus’ Automatic sync, Sync once and sign-in items can’t be used, and none says preview only', menus.length >= 4 && menus.every(item => !item.enabled || !item.visible) && !menus.some(item => /preview only/.test(item.label)) && menus.filter(item => item.label.startsWith('Automatic sync')).every(item => item.label === 'Automatic sync'), menus);
  same('and no login item is added while held', await main.run('ck.asked'), []);
  await a.click('#held-replace');
  same('freed by Replace, the build adds its login item, as at a first open', await main.run('ck.asked'), [true]);
  await heldAgain();
  check('held before the window closes', await a.exists('#held'));
  // The checks' own inspector session would keep a quitting dev run waiting for it, so it is closed once the window is asked to close.
  const exited = new Promise(done => a.child.once('exit', () => done(true)));
  void main.run('electron.BrowserWindow.getAllWindows()[0].close()').catch(() => undefined);
  await wait(300);
  main.close();
  const quit = await Promise.race([exited, wait(8000).then(() => false)]);
  check('held, closing the window quits the app instead of leaving it in the menu bar', quit, readFileSync(join(data, 'central-knot.log'), 'utf8').split('\n').filter(line => /window|quit/.test(line)).slice(-4));
  if (!quit) a.child.kill('SIGKILL');
}

async function realHomeFlow() {
  const before = { rich: tree(join(CLAUDE, 'rich')), unrelated: readFileSync(join(HOME, '.claude/unrelated.json'), 'utf8') };
  const a = await launch();
  await a.click('#home-actual');
  await a.click('#nav-skills');
  same('the disposable HOME is what "this Mac" reads', await a.run(`document.querySelector('.status-home').title`), HOME);
  same('real home is never the machine’s own', HOME.startsWith(scratch), true);
  await a.click('#nav-harnesses');
  const tools = await a.text('#harnesses-scroll');
  check('versions probed', tools.includes('2.1.309') && tools.includes('1.0.107') && tools.includes('0.142.3'), tools.slice(0, 300));
  // Cowork comes with Claude desktop: Claude Code's card says which plugins it uses exactly when that app was found.
  const claudeCard = await a.text('#harness-claude-cli');
  same('Claude Code’s card speaks of Cowork only where Claude desktop is here', /Cowork—?uses the plugins in your Claude account/.test(claudeCard), claudeCard.includes('Claude desktop'));
  await a.click('#harness-codex-cli');
  await a.click('#harness-tab-about');
  const codexAbout = await a.text('#harness-body');
  check('Codex says where new copies go', codexAbout.includes('/.codex/skills'), codexAbout.slice(0, 600));
  const { sections, counts } = await skillsOf(a, 'claude-cli', 'linked');
  check('Claude Code’s broken link does not count as having the Copilot skill', sections.away?.includes('from-copilot'), sections);
  same('Claude Code counts linked under Found on its Skills tab, its card and the Overview',
    [sections.found?.includes('linked'), sections.away?.includes('linked') ?? false, counts],
    [true, false, ['12', '12', '12']]);
  await a.click('#nav-skills');
  const rows = await rowKeys(a, 'skills');
  for (const name of ['rich', '名前-skill', '.dot-skill', 'linked', 'from-copilot', 'has-link']) check(`row for ${name}`, rows.includes(name), rows);
  check('names keep their case', (await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'mixedcase')}"]`)).includes('MixedCase'), await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'mixedcase')}"]`));
  check('malformed skill is no row', !rows.includes('bad-yaml'));
  same('the linked skill is the shared copy, which Claude Code has through its link and Copilot CLI reads: neither is Central Knot’s', [await cellState(a, 'skills', 'linked', 'claude-cli'), await cellState(a, 'skills', 'linked', 'copilot-cli')], ['another-way', 'another-way']);
  same('refused names and dot folders cannot go to Copilot', [await cellState(a, 'skills', '名前-skill', 'copilot-cli'), await cellState(a, 'skills', '.dot-skill', 'copilot-cli'), await cellState(a, 'skills', 'plain', 'copilot-cli')], ['cannot', 'cannot', 'cannot']);
  same('a skill with a link inside can’t be copied as it is: its mark says so, and its Add waits', [await cellState(a, 'skills', 'has-link', 'claude-cli'), await a.run(`document.querySelector('#${rowPart('add', 'skills', 'has-link')}')?.disabled`)], ['unseen', true]);
  await fitsAtMinimum(a, 'Skills in a real home');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  await a.click(byId(rowPart('open', 'skills', `very-long-${'n'.repeat(150)}`)));
  const fits = await a.run(`({ page: document.documentElement.scrollWidth, window: innerWidth })`);
  check('a very long name stays on screen at 960', fits.page <= fits.window, fits);
  await a.send('Emulation.clearDeviceMetricsOverride');
  await a.click(byId(rowPart('open', 'skills', `very-long-${'n'.repeat(150)}`)));
  await a.shot('real-overview');
  if (!canWriteRealHome) {
    same('the switches and Add are off here', await a.run(`[...document.querySelectorAll('.ov-row[data-key] :is(.switch, .add-item)')].every(item => item.disabled)`), true);
    const refused = await a.run(`window.centralKnot.applySkills([{ key: 'rich', on: true, except: [] }], false, document.querySelector('.status-home').title)`);
    same('main process refuses too', refused.writes, 0);
    check('with a reason', /Preview only/.test(refused.stopped ?? ''), refused);
    check('no copy and no store', !existsSync(join(COPILOT, 'rich')) && !existsSync(join(HOME, '.central-knot')));
    // The History window chosen in the practice run survives the restart. Shortening it here, a preview-only home, writes nothing.
    mkdirSync(join(HOME, '.central-knot'));
    const previewHistory = join(HOME, '.central-knot/history.json');
    writeFileSync(previewHistory, JSON.stringify({ events: [{ id: 'aged', at: new Date(Date.now() - 20 * DAY).toISOString(), key: 'aged', item: 'aged', kind: 'edit', losers: [], orderProved: true }] }));
    const before = readFileSync(previewHistory, 'utf8');
    const restarted = (await a.run('window.centralKnot.getSettings()')).historyDays;
    await a.run('window.centralKnot.setHistoryDays(30)');
    await a.click('#nav-settings');
    await keepFor(a, 7);
    await a.click('#history-shorten');
    for (let tries = 0; tries < 30 && !(await a.exists('#setting-history-message')); tries++) await wait(100);
    const previewNote = (await a.text('#setting-history-message') ?? '').trim();
    same('the History window survives a restart; shortening it never writes a preview-only home, whose History still shows only the window, and the row says the older History no longer shows and goes at Central Knot’s next change there, rather than that it was removed',
      [restarted, readFileSync(previewHistory, 'utf8') === before, (await a.run('window.centralKnot.history()')).events.length, (await a.run('window.centralKnot.getSettings()')).historyDays, previewNote.startsWith('Saved. History before ') && previewNote.endsWith(' no longer shows, and Central Knot removes it the next time it records a change in this home.')],
      [7, true, 0, 7, true]);
    await a.run('window.centralKnot.setHistoryDays(30)');
    rmSync(join(HOME, '.central-knot'), { recursive: true });
    await a.quit();
    return;
  }
  unlinkSync(join(CLAUDE, 'from-copilot'));
  await a.click('#header-refresh');
  await a.click(byId(rowPart('add', 'skills', 'linked')));
  await a.click('#nav-harnesses');
  same('taking linked in leaves 12 skills on Claude Code’s card and none synced there',
    [await a.text('#harness-claude-cli .harness-count-value'), await a.text('#harness-claude-cli .harness-count-note')], ['12', 'none synced']);
  if (shots) { await sizeTo(a, 1280, 800); await a.shot('claude-card-linked-on'); await fullSize(a); }
  await a.click('#nav-skills');
  const wrongHome = await a.run(`window.centralKnot.applySkills([{ key: 'rich', on: true, except: [] }], false, '/somewhere/else')`);
  check('an apply for another home is refused', wrongHome.writes === 0 && /not the one open/.test(wrongHome.stopped ?? ''), wrongHome);
  // Every skill turned on, one switch at a time, but private-one and those whose copies differ (each needs its own choice).
  const turnOn = await a.run(`[...document.querySelectorAll('.ov-row[data-key]')].filter(row => row.querySelector(':is(.add-item, .switch:not([aria-checked="true"])):not([disabled])') && !row.querySelector('[id^="decide-"]') && row.dataset.key !== '${rowPart('', 'skills', 'private-one')}').map(row => row.dataset.key)`);
  for (const id of turnOn) await a.click(`.ov-row[data-key=${JSON.stringify(id)}] :is(.add-item, .switch)`);
  same('bytes and modes copied, .git left out', tree(join(COPILOT, 'rich')), before.rich);
  same('exec bit kept', statSync(join(COPILOT, 'rich/scripts/run.sh')).mode & 0o777, 0o755);
  same('Codex gets the same bytes in its own folder', tree(join(CODEX, 'rich')), before.rich);
  check('a dot folder never reaches Codex', !existsSync(join(CODEX, '.dot-skill')));
  // The linked skill, taken in, is written nowhere: Claude Code has it through its link, Copilot CLI and Codex read the shared copy.
  same('turning the linked skill on leaves the link and the shared copy, and puts no copy beside them', [readdirSync(AGENTS).sort(), lstatSync(join(CLAUDE, 'linked')).isSymbolicLink(), existsSync(join(COPILOT, 'linked')), existsSync(join(CODEX, 'linked'))], [['linked'], true, false, false]);
  check('Copilot-only skill reached Claude', existsSync(join(CLAUDE, 'from-copilot/SKILL.md')));
  check('the one switched back off was not copied', !existsSync(join(COPILOT, 'private-one')));
  check('refused name not copied', !existsSync(join(COPILOT, '名前-skill')));
  check('held skill not copied', !existsSync(join(COPILOT, 'has-link')));
  check('a skill with a read-only folder copied', existsSync(join(COPILOT, 'read-only-inside/refs/a.md')));
  check('an unreadable skill not copied', !existsSync(join(COPILOT, 'unreadable-file')));
  same('differing copies untouched', readFileSync(join(COPILOT, 'clash/SKILL.md'), 'utf8'), text('clash', 'Copilot version.'));
  same('nothing staged in a loaded folder', [...readdirSync(COPILOT), ...readdirSync(CLAUDE)].filter(name => name.startsWith('.ck-')), []);
  same('unrelated bytes unchanged', readFileSync(join(HOME, '.claude/unrelated.json'), 'utf8'), before.unrelated);
  check('expected holds do not raise a warning band', !(await a.text('.bands') ?? '').includes('does not load'), await a.text('.bands'));
  same('a skill that can’t be copied as it is stays found, written nowhere', [await switchOn(a, 'skills', 'has-link'), await cellState(a, 'skills', 'has-link', 'copilot-cli')], [false, 'none']);
  await a.shot('real-applied');
  same('no page errors, real home', a.pageErrors, []);
  await a.quit();
  // The next launch opens the home last used, so a start at sign-in syncs it again.
  const again = await launch();
  await again.settle();
  same('a new launch opens the home last used', await again.run(`document.querySelector('.status-home')?.title`), HOME);
  await again.quit();

  const record = join(HOME, '.central-knot/sync.json');
  const good = readFileSync(record, 'utf8');
  writeFileSync(record, '{ damaged');
  let b = await launch();
  await b.click('#home-actual');
  await b.click('#nav-skills');
  check('damaged record is shown', (await b.text('.bands') ?? '').includes('damaged'), await b.text('.bands'));
  same('damaged record keeps every switch and Add off', await b.run(`document.querySelector('#${rowPart('add', 'skills', 'private-one')}').disabled`), true);
  await b.quit();
  writeFileSync(record, good);
  b = await launch(join(scratch, 'other-data'));
  await b.click('#home-actual');
  await b.click('#nav-skills');
  check('lost settings ask to resume', await b.exists('#resume'), await b.text('.bands'));
  await b.click(`#${rowPart('add', 'skills', 'private-one')}`);
  same('Add resumes, keeping the record', JSON.parse(readFileSync(record, 'utf8')).generation, JSON.parse(good).generation);
  check('and applies', existsSync(join(COPILOT, 'private-one/SKILL.md')));
  same('no page errors, stops', b.pageErrors, []);
  await b.quit();
}

/**
 * Skills kept the way the `npx skills` installer keeps them: the real folder in ~/.agents/skills and a link to it in Copilot's own
 * skills folder; Pi reads the shared folder itself. Neither is Central Knot's: turning the skill on takes it in and gives Claude
 * Code a copy, and leaves the link and the shared copy alone, each tool's line saying how it has it. Take over…, an explicit
 * action confirmed first, makes Central Knot's copy theirs: the shared copy goes, and the link that led to it is replaced.
 * Delete from Central Knot never touches a folder that isn't Central Knot's.
 */
async function sharedCopiesFlow() {
  const home = join(scratch, 'home-shared'), data = join(scratch, 'shared-data');
  const cli = (path, version) => { mkdirSync(join(home, path, '..'), { recursive: true }); writeFileSync(join(home, path), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\nexit 9\n`); chmodSync(join(home, path), 0o755); };
  cli('.local/bin/claude', '2.1.309 (Claude Code)');
  cli('.local/bin/copilot', 'GitHub Copilot CLI 1.0.107.');
  cli('.pi/agent/bin/pi', 'pi 1.5.0');
  const [claude, copilot, pi, agents] = ['.claude/skills', '.copilot/skills', '.pi/agent/skills', '.agents/skills'].map(path => join(home, path));
  for (const folder of [claude, copilot, pi]) mkdirSync(folder, { recursive: true });
  const name = 'opus-sol-loop', link = `../../.agents/skills/${name}`;
  const install = () => { skill(agents, name, text(name, 'From the installer.')); symlinkSync(link, join(copilot, name)); };
  install();
  skill(agents, 'shared-only');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  const a = await launch(data);
  await a.click('#nav-skills');
  const row = `.ov-row[data-key="${rowPart('', 'skills', name)}"]`;
  const rowLineOf = tool => a.run(`[...document.querySelectorAll('.details-tool')].find(row => row.querySelector('strong')?.textContent === ${JSON.stringify(tool)})?.querySelector('.details-tool-line')?.textContent?.trim() ?? ''`);
  const opened = async () => { if (await a.run(`document.querySelector('#${rowPart('open', 'skills', name)}')?.getAttribute('aria-expanded')`) !== 'true') await a.click(`#${rowPart('open', 'skills', name)}`); };
  /** Copilot CLI's entry (a link, where it leads), the shared copy, Pi's own folder and Claude Code's, as they are on disk. */
  const onDisk = () => [lstatSync(join(copilot, name), { throwIfNoEntry: false })?.isSymbolicLink() ? `link:${readlinkSync(join(copilot, name))}` : existsSync(join(copilot, name, 'SKILL.md')) ? 'folder' : null,
    existsSync(join(agents, name, 'SKILL.md')), existsSync(join(pi, name, 'SKILL.md')), existsSync(join(claude, name, 'SKILL.md'))];
  check('the installer’s skill is a row, found', (await rowKeys(a, 'skills')).includes(name) && !(await switchOn(a, 'skills', name)), await rowKeys(a, 'skills'));
  await opened();
  same('each tool’s row says how it has the skill, and that it isn’t Central Knot’s', [await rowLineOf('Pi'), await rowLineOf('Copilot CLI')],
    ['Not in Central Knot · Pi also reads a copy at …/.agents/skills, which is not Central Knot’s.', 'Not in Central Knot · Copilot CLI also reads a copy at …/.agents/skills, which is not Central Knot’s.']);
  await a.shot('shared-unmanaged');
  // Add takes it in: Claude Code gets a copy; the link and the shared copy stay as they are.
  await a.click(`${row} .add-item`);
  for (let tries = 0; tries < 40 && !(await switchOn(a, 'skills', name)); tries++) await wait(100);
  same('turning it on takes it in, gives Claude Code a copy, and leaves the link and the shared copy alone', onDisk(), [`link:${link}`, true, false, true]);
  check('the result says where it is on, and which tools have it another way', /opus-sol-loop is in Central Knot now, and on in Claude Code; Copilot CLI and Pi have it another way\./.test(await a.text('#header') ?? ''), await a.text('#header'));
  same('Copilot CLI and Pi are marked as having it another way', [await cellState(a, 'skills', name, 'copilot-cli'), await cellState(a, 'skills', name, 'pi-cli')], ['another-way', 'another-way']);
  await opened();
  check('each of their lines says nothing of Central Knot’s goes there while it does', /Nothing of Central Knot’s goes there while it does\./.test(await rowLineOf('Pi')) && /Nothing of Central Knot’s goes there while it does\./.test(await rowLineOf('Copilot CLI')), [await rowLineOf('Pi'), await rowLineOf('Copilot CLI')]);
  await fitsAtMinimum(a, 'a skill two tools have another way, opened');
  await a.shot('shared-taken-in');
  // Take over the shared copy, once confirmed: it is removed, Pi gets Central Knot's copy in its own folder, and so does
  // Copilot CLI, in place of its link (which led to the shared copy, and so nowhere now).
  await opened();
  const armedTitle = await a.run(`document.querySelector('#${rowPart('take-over', 'skills', name, 'copilot-cli')}')?.title ?? ''`);
  await a.click(`#${rowPart('take-over', 'skills', name, 'copilot-cli')}`);
  check('taking over the shared copy asks first, and says other apps won’t find it there', await a.exists(`#${rowPart('take-over-confirm', 'skills', name, 'copilot-cli')}`) && /Other apps that read that folder won’t find it there/.test(armedTitle ?? ''), [armedTitle, await a.text('.details')]);
  await fitsAtMinimum(a, 'a take-over of the shared copy, asked');
  await a.shot('shared-take-over-armed');
  await a.click(`#${rowPart('take-over-confirm', 'skills', name, 'copilot-cli')}`);
  for (let tries = 0; tries < 40 && (onDisk()[1] || onDisk()[0] !== 'folder'); tries++) await wait(100);
  same('confirmed, the shared copy goes, and Copilot CLI and Pi have Central Knot’s copy', [onDisk(), await cellState(a, 'skills', name, 'copilot-cli'), await cellState(a, 'skills', name, 'pi-cli')], [['folder', false, true, true], 'current', 'current']);
  check('nothing staged is left in the shared folder', !readdirSync(join(home, '.agents')).some(entry => entry.startsWith('.ck-')) && !readdirSync(agents).some(entry => entry.startsWith('.ck-')), readdirSync(agents));
  await a.shot('shared-managed');
  // The installer puts the shared copy and Copilot CLI's link back in place of Central Knot's copies ("came back"): the
  // skill stays on, and those two tools have it another way again; nothing outside is touched.
  rmSync(join(copilot, name), { recursive: true, force: true });
  rmSync(join(pi, name), { recursive: true, force: true });
  install();
  await a.click('#header-refresh');
  await wait(2200);
  await a.click('#header-refresh');
  same('came back: still on, Copilot CLI and Pi have it another way, the link and the shared copy as the installer left them', [await switchOn(a, 'skills', name), await cellState(a, 'skills', name, 'copilot-cli'), await cellState(a, 'skills', name, 'pi-cli'), onDisk()], [true, 'another-way', 'another-way', [`link:${link}`, true, false, true]]);
  await a.shot('shared-came-back');
  // Off takes out Claude Code's copy alone: Copilot CLI and Pi still read the shared copy, and the result says so, as their lines do.
  await a.click(`${row} .switch`);
  for (let tries = 0; tries < 40 && !(await a.text('#header .band-text') ?? '').includes(`${name} is off`); tries++) await wait(100);
  same('Off leaves the installer’s link and shared copy in place', onDisk(), [`link:${link}`, true, false, false]);
  const reads = 'also reads a copy at …/.agents/skills, which is not Central Knot’s.';
  check('turned off, the result names each tool that still reads it, and where, rather than that no tool has it',
    (await a.text('#header') ?? '').includes(`${name} is off. Copilot CLI ${reads} Pi ${reads} Central Knot keeps it`), await a.text('#header'));
  await a.click('#nav-harnesses');
  await a.click('#harness-pi-cli');
  await a.click('#harness-tab-skills');
  await opened();
  const elsewhere = `Pi ${reads} Copilot CLI ${reads}`;
  check('the Off heading names the copies still read', (await headingSays(a, 'off')).includes(elsewhere), await headingSays(a, 'off'));
  same('the Off row names the tools that still have it', await a.text(`${row} .row-tag`), 'in Central Knot, Pi and Copilot CLI');
  check('the Off status says where the tools read it', (await a.text('.details-status') ?? '').includes(elsewhere), await a.text('.details-status'));
  if (shots) { await sizeTo(a, 1280, 800); await a.shot('pi-skills-off'); await fullSize(a); }
  await a.click('#nav-skills');
  await a.click(`${row} .switch`);
  for (let tries = 0; tries < 40 && !(await switchOn(a, 'skills', name)); tries++) await wait(100);
  // Delete from Central Knot removes only Central Knot's copy (Claude Code's); the link and the shared copy stay, and the
  // skill is found again.
  await opened();
  await a.click(`#${rowPart('delete', 'skills', name)}`);
  await a.click(`#${rowPart('delete-confirm', 'skills', name)}`);
  same('Delete from Central Knot removes Claude Code’s copy and leaves the link and the shared copy', onDisk(), [`link:${link}`, true, false, false]);
  check('and the skill is found again, as the installer’s', (await rowKeys(a, 'skills')).includes(name) && !(await switchOn(a, 'skills', name)), await rowKeys(a, 'skills'));
  // With all five tools present, each has both installer skills exactly when it reads the shared folder.
  for (const dir of ['.codex/skills', '.config/opencode/skills']) mkdirSync(join(home, dir), { recursive: true });
  await a.click('#header-refresh');
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']) {
    const { sections, counts } = await skillsOf(a, tool);
    const readsShared = tool !== 'claude-cli';
    same(`${tool} counts shared-only exactly when it reads ~/.agents/skills`,
      [sections.found?.includes('shared-only') ?? false, sections.away?.includes('shared-only') ?? false, counts],
      [readsShared, !readsShared, readsShared ? ['2', '2', '2'] : ['', null, '0']]);
  }
  skill(claude, 'clash', text('clash', 'From Claude Code.'));
  skill(pi, 'clash', text('clash', 'From Pi.'));
  await a.click('#header-refresh');
  await a.click('#nav-harnesses');
  const differ = await a.text('#harness-opencode-cli-differ-skills');
  await a.click('#harness-opencode-cli');
  await a.click('#harness-tab-skills');
  same('OpenCode reads Claude Code’s copy of clash, so its card and Copies differ chip both count it',
    [parseInt(differ ?? '', 10), await a.text('.chip-warn .chip-count')], [1, '1']);
  same('no page errors, shared copies', a.pageErrors, []);
  await a.quit();
}

/**
 * Synchronize everything (Settings › This home), on the page: off where it was never chosen, its row saying what it would add
 * now and what waits for a choice of copy; turned on, the pass right after takes in what it may, says so in one notice per
 * page and in History with Add's Undo, and leaves the rest found, the Found heading and each opened row saying why; that Undo takes
 * it out for good. No page offers an Add all.
 */
async function syncEverythingFlow() {
  const home = join(scratch, 'home-everything'), data = join(scratch, 'everything-data');
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['codex', 'codex-cli 0.142.3']]) {
    writeFileSync(join(home, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
    chmodSync(join(home, '.local/bin', name), 0o755);
  }
  const [claude, codex] = ['.claude/skills', '.codex/skills'].map(path => join(home, path));
  skill(claude, 'notes', text('notes', 'Take notes.'));
  skill(claude, 'review', text('review', 'Review gently.'));
  skill(codex, 'review', text('review', 'Review hard.'));
  // Saved an hour ago, as copies that have sat in a tool do: none is inside the settle window, so the pass right after takes them.
  const anHourAgo = new Date(Date.now() - 3_600_000);
  for (const path of [join(claude, 'notes'), join(claude, 'notes/SKILL.md')]) utimesSync(path, anHourAgo, anHourAgo);
  writeFileSync(join(home, '.codex/config.toml'), '[mcp_servers.files]\ncommand = "files-mcp"\nargs = []\n');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  // A folder home outside the HOME the app is given (that one counts as real, which Linux never writes).
  const real = join(scratch, 'everything-real');
  mkdirSync(real, { recursive: true });
  const a = await launch(data, [], real);
  const foundNote = () => a.text('.ov-section[data-section="found"] .ov-section-after');
  const ruleSays = () => a.text('#setting-sync-everything-notice .setting-message-text');
  const ruleOn = () => a.run(`document.querySelector('#sync-everything-on')?.getAttribute('aria-checked')`);
  const noAddAll = async page => {
    await a.click(`#nav-${page}`);
    check(`no Add all on ${page}: switching Synchronize everything on is the one way to add everything`, !(await a.exists('#apply, #manage-all')) && !(await a.all('button', 'e.textContent.trim()')).some(label => /^Add all/i.test(label)));
  };
  await a.click('#nav-skills');
  check('off where it was never chosen: the Found heading says Add takes each in', /Add one to keep it in Central Knot and turn it on\./.test(await foundNote() ?? ''), await foundNote());
  await a.click('#nav-settings');
  for (let tries = 0; tries < 30 && !(await a.exists('#setting-sync-everything')); tries++) await wait(100);
  same('Settings › This home: Synchronize everything is off, and says how many found items it would add now and how many wait for a choice of copy',
    [await ruleOn(), await ruleSays()], ['false', 'Turning it on adds the 2 items found in your tools now. 1 found item has copies that differ and waits for your choice of copy.']);
  await fitsAtMinimum(a, 'Settings with Synchronize everything off');
  await a.shot('everything-off');
  // Saved just now, as a tool writes a new skill: the pass right after the switch leaves it inside the settle window, and the
  // pass soon after takes it in by itself, whose read keeps the notices no page has shown yet.
  skill(claude, 'fresh', text('fresh', 'Just saved.'));
  await a.click('#sync-everything-on');
  for (let tries = 0; tries < 40 && await ruleOn() !== 'true'; tries++) await wait(100);
  const record = JSON.parse(readFileSync(join(home, '.central-knot/sync.json'), 'utf8'));
  same('turned on, it is kept in the home’s sync record, and the row says what still waits for a choice', [await ruleOn(), record.syncEverything, await ruleSays()], ['true', true, '1 found item has copies that differ and waits for your choice of copy.']);
  same('the pass right after took in what was found: notes is in Codex now, byte for byte', readNow(join(codex, 'notes/SKILL.md')), text('notes', 'Take notes.'));
  same('and Settings says what it took in, a line per kind, each with History', await a.all('.setting-added .setting-message', 'e.textContent'),
    ['Synchronize everything took in 1 skill, found in Claude Code: notes. History can undo it.History', 'Synchronize everything took in 1 MCP server, found in Codex: files. History can undo it.History']);
  for (let tries = 0; tries < 80 && !readNow(join(codex, 'fresh/SKILL.md')); tries++) await wait(100);
  same('a skill saved just before is taken in soon after, with no click, once it has settled', readNow(join(codex, 'fresh/SKILL.md')), text('fresh', 'Just saved.'));
  // The read after that pass reaches the page: the sidebar's dot names both skills' notices, neither shown yet.
  const unseenOnSkills = () => a.run(`document.querySelector('#nav-skills .nav-unseen')?.title ?? ''`);
  for (let tries = 0; tries < 40 && !/fresh/.test(await unseenOnSkills()); tries++) await wait(100);
  same('a notice no page has shown stays until shown: the sidebar names both passes’ notices for Skills', await unseenOnSkills(), '2 automatic changes: notes, fresh');
  await a.shot('everything-on');
  await a.click('#nav-overview');
  same('the Overview’s foot is one sentence, where every change is kept: Automatic sync is the status bar’s to say', (await a.text('#overview-kept'))?.trim(), 'Every change Central Knot makes in your tools is kept in History, with Undo where it can be undone.');
  await a.click('#nav-skills');
  same('on the Skills page notes and fresh are On and review stays found', await sectionsNow(a, 'skills'), [['on', ['fresh', 'notes']], ['found', ['review']]]);
  check('the Found heading says the rule in force: Synchronize everything leaves these, and how many wait for a choice', /Synchronize everything leaves these \(open a row to see why\)\. 1 waits for your choice of copy/.test(await foundNote() ?? ''), await foundNote());
  const notice = '.sync-notice[data-kind="taken-in"] .notice-text';
  same('one notice per pass says how many it took in, where they were found, and their names', await a.all(notice, 'e.textContent.replace(/ · .*$/, "")'),
    ['Synchronize everything took in 1 skill, found in Claude Code: fresh. History can undo it.', 'Synchronize everything took in 1 skill, found in Claude Code: notes. History can undo it.']);
  same('review’s row says why the rule leaves it: its copies differ, and opening it asks which', [await a.text(`#${rowPart('decide', 'skills', 'review')}`), await (async () => { await a.click(`#${rowPart('open', 'skills', 'review')}`); return a.exists('.details-differs'); })()], ['Copies differ', true]);
  await fitsAtMinimum(a, 'Skills with Synchronize everything on');
  await a.shot('everything-skills');
  await a.click('#nav-mcp');
  // Claude Code had no settings file: a background pass writes it afresh once the settle window has passed (the poll: 20 s).
  let claudeFiles;
  for (let tries = 0; tries < 300 && claudeFiles !== 'files-mcp'; tries++) { claudeFiles = JSON.parse(readNow(join(home, '.claude.json')) || '{}').mcpServers?.files?.command; if (claudeFiles !== 'files-mcp') await wait(100); }
  same('on the MCP servers page files, found in Codex, is On, and in Claude Code’s file too', [await sectionsNow(a, 'mcp'), claudeFiles], [[['on', ['files']]], 'files-mcp']);
  check('and its notice, from the pass before the one that took fresh in, is still there to name it and Codex', /^Synchronize everything took in 1 MCP server, found in Codex: files\./.test(await a.text(notice) ?? ''), await a.text('.bands'));
  await a.click('#nav-history');
  for (let tries = 0; tries < 30 && !(await a.exists('.history-row')); tries++) await wait(100);
  // The skill notes's own row, by its name and kind (release-notes, an agent, has one too).
  const takenRow = `[...document.querySelectorAll('.history-row[data-kind="on"]')].find(row => row.querySelector('.history-what strong')?.textContent === 'notes' && row.querySelector('.history-kind')?.textContent === 'Skill')`;
  same('History has Add’s entry for it, saying Synchronize everything took it in and from which tool, with Add’s Undo',
    await a.run(`[${takenRow}.querySelector('.history-about').textContent, ${takenRow}.querySelector('.history-actions button').textContent]`), ['Found in Claude Code and taken into Central Knot by Synchronize everything; put in Codex.', 'Undo']);
  await fitsAtMinimum(a, 'History with what Synchronize everything took in');
  await a.shot('everything-history');
  await a.run(`${takenRow}.querySelector('.history-actions button').click()`); await a.settle();
  same('its Undo takes it out again: Codex’s copy goes, Claude Code keeps its own byte for byte, and the entry says Undone', [existsSync(join(codex, 'notes')), readNow(join(claude, 'notes/SKILL.md')), await a.run(`${takenRow}.querySelector('.history-done')?.textContent`)], [false, text('notes', 'Take notes.'), 'Undone']);
  await a.shot('everything-undone');
  await a.click('#nav-skills');
  await a.click('#header-refresh');
  await a.click('#header-refresh');
  same('and no pass takes it back: it is found, for good', [await sectionsNow(a, 'skills'), existsSync(join(codex, 'notes'))], [[['on', ['fresh']], ['found', ['notes', 'review']]], false]);
  await a.click(`#${rowPart('open', 'skills', 'notes')}`);
  check('its line says why: deleted, so it is not added by itself again; Add or Restore brings it back', /It was deleted from Central Knot, so it will not be added by itself again\. Add, or Restore in History, brings it back\./.test(await a.text('.details-status') ?? ''), await a.text('.details-status'));
  // Two tools gain one new name with different content while Skills is open: the rule leaves it for a choice and writes
  // nothing, and the open page still shows it, with no click.
  skill(claude, 'split', text('split', 'One way.'));
  skill(codex, 'split', text('split', 'Another way.'));
  for (let tries = 0; tries < 80 && !(await rowKeys(a, 'skills')).includes('split'); tries++) await wait(100);
  check('a new item the rule leaves waiting reaches the open page by itself', (await rowKeys(a, 'skills')).includes('split') && await a.exists(`#${rowPart('decide', 'skills', 'split')}`), await rowKeys(a, 'skills'));
  for (const page of ['overview', 'skills', 'mcp', 'harnesses']) await noAddAll(page);
  await a.click('#nav-settings');
  await a.click('#sync-everything-on');
  for (let tries = 0; tries < 40 && await ruleOn() !== 'false'; tries++) await wait(100);
  same('turned off, it says what it would add now: nothing, since what was undone stays out', [await ruleOn(), await ruleSays()], ['false', 'Nothing found in your tools now would be added. 1 found item was taken out of Central Knot earlier and isn’t added by itself again: Add on its row, or Restore in History, brings it back. 2 found items have copies that differ and wait for your choice of copy.']);
  // Saved just before it is switched on again, with nothing else for that pass to write: the pass leaves it inside the settle
  // window, and nothing but the look again soon after (no watch event follows) takes it in before the 20 s poll.
  skill(claude, 'later', text('later', 'Saved just before.'));
  await wait(1700);
  await a.click('#sync-everything-on');
  for (let tries = 0; tries < 60 && !readNow(join(codex, 'later/SKILL.md')); tries++) await wait(100);
  same('a copy the pass left inside the settle window is taken in a moment later, by itself', readNow(join(codex, 'later/SKILL.md')), text('later', 'Saved just before.'));
  same('no page errors, Synchronize everything', a.pageErrors, []);
  await a.quit();
}

/**
 * First setup on the page (firstsetup.ts): a folder home never asked shows the question on the Overview; Yes opens the walkthrough of
 * the copies that differ, at the latest copy; Go on, no dates to go by, leaving half way and the Overview's way back in; the
 * switch-on's one Undo in History and its Restore. Then a second home: Resume first, and No.
 */
async function firstSetupFlow() {
  const homeFor = name => {
    const home = join(scratch, name);
    mkdirSync(join(home, '.local/bin'), { recursive: true });
    for (const [tool, output] of [['claude', '2.1.309 (Claude Code)'], ['codex', 'codex-cli 0.142.3']]) {
      writeFileSync(join(home, '.local/bin', tool), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
      chmodSync(join(home, '.local/bin', tool), 0o755);
    }
    return { home, claude: join(home, '.claude/skills'), codex: join(home, '.codex/skills') };
  };
  const ago = hours => new Date(Date.now() - hours * 3_600_000);
  const saved = (folder, hours) => { for (const path of [join(folder, 'SKILL.md'), folder]) utimesSync(path, ago(hours), ago(hours)); };
  const opened = (home, data) => { mkdirSync(data, { recursive: true }); writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } })); };
  const real = join(scratch, 'setup-real');
  mkdirSync(real, { recursive: true });
  const { home, claude, codex } = homeFor('home-setup');
  saved(skill(claude, 'notes', text('notes', 'Take notes.')), 5);
  saved(skill(claude, 'review', text('review', 'Review gently.')), 48);
  saved(skill(codex, 'review', text('review', 'Review hard.')), 2);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://docs.example.test/mcp' } } }, null, 2)}\n`);
  writeFileSync(join(home, '.codex/config.toml'), '[mcp_servers.docs]\nurl = "https://docs.example.test/mcp/v2"\n\n[mcp_servers.files]\ncommand = "files-mcp"\nargs = []\n');
  for (const path of [join(home, '.claude.json'), join(home, '.codex/config.toml')]) utimesSync(path, ago(5), ago(5));
  const data = join(scratch, 'setup-data');
  opened(home, data);
  const record = () => JSON.parse(readNow(join(home, '.central-knot/sync.json')) || '{}');
  const a = await launch(data, [], real);
  await a.click('#nav-overview');
  const question = await a.text('#setup-question .setup-text') ?? '';
  check('a home never asked shows the question, counted as the pass counts: 2 items it takes in now and the tools that get them, then 2 more that wait with nothing chosen, and what the one Undo covers',
    /^Yes takes in now the 2 items found in your tools .* \(Claude Code and Codex\);/.test(question) && /2 more items have copies that differ and wait for you: nothing is chosen for you\. You’re asked about each, one at a time, with the latest copy marked where one can be told/.test(question)
      && /wait for you: nothing is chosen for you\. .* One Undo in History takes back what it takes in; a copy you choose has its own Undo\.$/.test(question) && !/Write to Claude/.test(question), question);
  same('and says what No leaves', await a.text('#setup-no-says'), 'No changes nothing: what is already on stays on and keeps syncing, and each found item waits on its page for Add.');
  check('the lead no longer says to open a card and turn something on where the question stands', !/Open one below/.test(await a.text('.overview-lead') ?? ''), await a.text('.overview-lead'));
  same('Synchronize everything is the main button', await a.run(`document.querySelector('#setup-yes')?.className.includes('primary')`), true);
  await fitsAtMinimum(a, 'the Overview with first setup’s question');
  await a.shot('setup-question');
  await a.click('#setup-yes');
  for (let tries = 0; tries < 40 && !(await a.exists('#walkthrough')); tries++) await wait(100);
  same('Yes stores the rule on, takes in what it may (notes is in Codex now), and opens the walkthrough on Skills at 1 of 2, review, its latest copy (Codex’s) the main button',
    [record().syncEverything, readNow(join(codex, 'notes/SKILL.md')), await a.text('#walkthrough .walk-place'), await a.exists(`#${rowPart('walk-use', 'skills', 'review', 'codex-cli')} .version-cta-main`), await a.exists(`#${rowPart('walk-use', 'skills', 'review', 'claude-cli')}`), await a.exists(`#${rowPart('walk-use', 'skills', 'review', 'claude-cli')} .version-cta-main`)],
    [true, text('notes', 'Take notes.'), ' · 1 of 2', true, true, false]);
  check('the band after Yes says what it took in and what the one Undo covers', /^Synchronize everything is on: it took in 2 items, and 2 items with copies that differ wait for your choice\. One Undo in History takes back what it takes in; a copy you choose has its own Undo\./.test(await a.text('[data-outcome] .band-text') ?? ''), await a.text('[data-outcome] .band-text'));
  same('beside Skip, the walkthrough says it changes no copy', await a.text('#walk-note'), 'Skip changes no copy.');
  await fitsAtMinimum(a, 'the walkthrough at its first item');
  await a.shot('setup-walkthrough');
  // The row the walkthrough is at, opened too: its copy question and the walkthrough's are drawn at once, their controls apart.
  await a.click(`#${rowPart('open', 'skills', 'review')}`);
  same('with the row the walkthrough is at opened, its question and the walkthrough’s share no id', [await a.exists(`.ov-row.open[data-key="${rowPart('', 'skills', 'review')}"]`), await sharedIds(a)], [true, []]);
  await a.click(`#${rowPart('open', 'skills', 'review')}`);
  await a.click(`#${rowPart('walk-use', 'skills', 'review', 'codex-cli')}`);
  same('a choice is the row’s own click: review is taken in with Codex’s copy, and the walkthrough says the next is on MCP servers',
    [readNow(join(claude, 'review/SKILL.md')), await a.text('#walkthrough .band-text')], [text('review', 'Review hard.'), 'Next: docs, on MCP servers.']);
  await a.click('#walk-go-on');
  same('at docs, 2 of 2: its entries have no dates to go by, nothing is preselected, and Use the latest for the rest can’t be used',
    [await a.text('#walkthrough .walk-place'), await a.text('#walk-note'), await a.exists('#walkthrough .version-cta-main'), await a.run(`document.querySelector('#walk-use-latest').disabled`)], [' · 2 of 2', 'No dates to go by: choose one, or skip it. Skip changes no copy.', false, true]);
  await fitsAtMinimum(a, 'the walkthrough at an item with no dates');
  await a.click('#walk-skip');
  same('skipped, the last: the band says what still waits and where, and docs stays found, its entries as they were',
    [await a.text('#walkthrough .band-text'), (await sectionsNow(a, 'mcp')).find(([place]) => place === 'found')?.[1]], ['1 skipped item still waits for a choice, its copies as they are: docs on MCP servers. Each row still asks.', ['docs']]);
  await a.click('#nav-overview');
  same('the Overview’s line counts what waits and starts choosing again, the last item having been skipped', [await a.text('#setup-choosing'), await a.exists('#setup-question')], ['1 found item has copies that differ and waits for your choice. Choose copies', false]);
  await a.click('#setup-choose');
  same('which opens the walkthrough at docs again', [await a.text('#walkthrough .walk-place'), await a.exists(`#${rowPart('walk-use', 'mcp', 'docs', 'codex-cli')}`)], [' · 1 of 1', true]);
  await a.click('#walk-leave');
  await a.click('#nav-history');
  for (let tries = 0; tries < 30 && !(await a.exists('.history-row[data-kind="everything"]')); tries++) await wait(100);
  const ruleRow = '.history-row[data-kind="everything"]';
  same('History has the switch-on’s one entry, with its Undo', [await a.text(`${ruleRow} .history-about`), await a.text(`${ruleRow} .history-actions button`)],
    ['Switched on: a skill, MCP server or agent that turns up in a tool is taken into Central Knot by itself. Its Undo takes back what it takes in; a copy you choose has its own Undo.', 'Undo']);
  await a.click(`${ruleRow} .history-actions button`);
  for (let tries = 0; tries < 40 && existsSync(join(codex, 'notes')); tries++) await wait(100);
  same('its Undo takes notes back out of Codex, leaves review (chosen, with its own Undo) as it is, and stores the rule off',
    [existsSync(join(codex, 'notes')), readNow(join(claude, 'review/SKILL.md')), record().syncEverything], [false, text('review', 'Review hard.'), false]);
  same('its entry says what it did and offers Restore; the switch-on’s says Undone', [await a.text(`${ruleRow} .history-about`), await a.text(`${ruleRow} .history-actions button`), await a.all(`${ruleRow} .history-done`)],
    ['Undone: switched off, and 2 items it took in are out of Central Knot again, each tool it was found in keeping its own copy. Left in: review (you chose its copy: it has its own Undo).', 'Restore', ['Undone']]);
  await fitsAtMinimum(a, 'History after the one Undo');
  await a.shot('setup-undone');
  await a.click(`${ruleRow} .history-actions button`);
  for (let tries = 0; tries < 40 && !readNow(join(codex, 'notes/SKILL.md')); tries++) await wait(100);
  same('its Restore switches the rule on again and puts notes back', [readNow(join(codex, 'notes/SKILL.md')), record().syncEverything], [text('notes', 'Take notes.'), true]);
  same('the status bar says so, and the switch-on offers its Undo again, which takes back what the Restore put back',
    [await a.run(`document.querySelector('#announcement').dataset.text`), await a.all(`${ruleRow} .history-actions button`), await a.all(`${ruleRow} .history-done`)],
    ['Synchronize everything is on again. Restored 2 items; the switch-on’s Undo takes them back.', ['Undo'], ['Restored']]);
  same('no page errors, first setup', a.pageErrors, []);
  await a.quit();

  // A second home: a record made by a tool's Manage switch, then opened with no memory of it (Resume first); and No, which
  // changes no file.
  const other = homeFor('home-setup-two');
  saved(skill(other.claude, 'tidy', text('tidy', 'Tidy up.')), 5);
  saved(skill(other.codex, 'plan', text('plan', 'Plan ahead.')), 5);
  const first = join(scratch, 'setup-data-two');
  opened(other.home, first);
  const b = await launch(first, [], real);
  await b.click('#nav-harnesses');
  await b.click('#manage-codex-cli'); await b.click('#manage-codex-cli');
  same('a Manage switch makes the record and leaves the question unanswered', ['syncEverything' in JSON.parse(readNow(join(other.home, '.central-knot/sync.json'))), await (async () => { await b.click('#nav-overview'); return b.exists('#setup-question'); })()], [false, true]);
  await b.quit();
  const second = join(scratch, 'setup-data-three');
  opened(other.home, second);
  const c = await launch(second, [], real);
  await c.click('#nav-overview');
  same('a home this app has no memory of: Resume comes first, and the question after it', [await c.exists('#setup-resume'), await c.exists('#setup-question')], [true, false]);
  await c.click('#sync-switch');
  await c.click('#overview-sync-now');
  check('Sync once in a home waiting for Resume shows the gate reason as a warning',
    /Resuming keeps every recorded choice/.test(await c.text('[data-outcome] .band-text')) && await c.exists('[data-outcome] .tone-warning'));
  await c.click('#sync-switch');
  await c.click('#setup-resume-button');
  check('resumed: the question', await c.exists('#setup-question'), await c.text('.overview-scroll'));
  const sync = join(other.home, '.central-knot/sync.json');
  const before = tree(other.home);
  await c.click('#setup-no');
  same('No stores the rule off, changes no file in the tools, and the question goes for good', [JSON.parse(readNow(sync)).syncEverything, Object.fromEntries(Object.entries(tree(other.home)).filter(([path]) => !path.startsWith('.central-knot'))), await c.exists('#setup-question')],
    [false, Object.fromEntries(Object.entries(before).filter(([path]) => !path.startsWith('.central-knot'))), false]);
  check('and says so: nothing changed, what is on stays on, found items wait for Add, Settings is the way to change it', /^Left off, and nothing changed: what is already on stays on and keeps syncing, and what Central Knot finds in your tools waits on its page for Add\./.test(await c.text('[data-outcome] .band-text') ?? ''), await c.text('[data-outcome] .band-text'));
  same('no page errors, first setup in a second home', c.pageErrors, []);
  await c.quit();

  // A third home, with Automatic sync off: Yes says nothing is added until Sync once, and offers it.
  const third = homeFor('home-setup-three');
  mkdirSync(join(third.home, '.copilot/skills'), { recursive: true });
  saved(skill(third.claude, 'notes', text('notes', 'Take notes.')), 5);
  mkdirSync(third.codex, { recursive: true });
  const thirdData = join(scratch, 'setup-data-four');
  opened(third.home, thirdData);
  const d = await launch(thirdData, [], real);
  await d.click('#nav-overview');
  await d.click('#sync-switch');
  check('with Automatic sync off the question says nothing is added until Sync once', /Automatic sync is off, so nothing is added until you click Sync once\.$/.test(await d.text('#setup-question .setup-text') ?? ''), await d.text('#setup-question .setup-text'));
  await d.click('#setup-yes');
  same('Yes with Automatic sync off: the band says nothing is added until Sync once and offers it; nothing is written yet',
    [await d.text('[data-outcome] .band-text'), await d.text('#setup-sync-once'), existsSync(join(third.codex, 'notes'))], ['Synchronize everything is on. Automatic sync is off, so nothing is added until you click Sync once.', 'Sync once', false]);
  await d.click('#setup-sync-once');
  for (let tries = 0; tries < 40 && !readNow(join(third.codex, 'notes/SKILL.md')); tries++) await wait(100);
  same('and its Sync once takes notes in', readNow(join(third.codex, 'notes/SKILL.md')), text('notes', 'Take notes.'));
  const copies = [third.claude, third.codex, join(third.home, '.copilot/skills')].map(folder => join(folder, 'notes'));
  const beforeDeletion = copies.map(folder => tree(folder));
  rmSync(copies[1], { recursive: true });
  await d.click('#header-refresh');
  await sizeTo(d, 1280, 800);
  const inspector = d.inspect && await mainHelpers(d.inspect);
  if (inspector) await inspector.noteCalls('sync:now');
  else console.log('No main-process inspector: skipping the Sync once request count and native menu checks.');
  const clickOnce = "document.querySelector('#overview-sync-now').click()";
  await d.run(`${clickOnce}; ${clickOnce}; true`);
  for (let n = 0; n < 40 && !/still saving its files/i.test(await d.text('#announcement')); n++) await wait(50);
  check('Sync once is disabled while it waits and the status bar explains the wait',
    await d.run("document.querySelector('#overview-sync-now').disabled") && /still saving its files/i.test(await d.text('#announcement')));
  await d.shot('sync-once-waiting');
  await d.run(clickOnce + '; true');
  await d.settle();
  await d.run('window.centralKnot.refresh().then(() => true)');
  if (inspector) {
    same('rapid clicks send one sync request', (await inspector.calls()).length, 1);
    await inspector.restore('sync:now'); inspector.close();
  }
  const removed = copies.every(folder => !existsSync(folder));
  check('one Sync once removes both remaining copies and names notes in its result',
    removed && /Removed notes from Claude Code and Copilot CLI/.test(await d.text('[data-outcome] .band-text')), copies.map(folder => existsSync(folder)));
  await d.shot('sync-once-removed');
  if (removed) {
    await d.click('#overview-sync-now');
    check('the next Sync once reports no further removal', /nothing to do/i.test(await d.text('[data-outcome] .band-text') ?? ''));
    await d.click('#nav-history');
    await d.click('.history-row[data-kind="off"] .history-actions button');
    same('Undo returns every notes folder byte for byte', copies.map(folder => existsSync(folder) && tree(folder)), beforeDeletion);
    await d.click('#sync-switch');
    rmSync(copies[1], { recursive: true });
    // The watch (or its fallback poll) starts the pass, which removes each destination separately.
    for (let tries = 0; tries < 200 && copies.some(existsSync); tries++) await wait(150);
    same('Automatic sync finishes the same hand deletion by itself', copies.map(folder => existsSync(folder)), [false, false, false]);
  }
  await d.click('#nav-overview');
  if ((await d.run("document.querySelector('#sync-switch').getAttribute('aria-checked')")) === 'true') await d.click('#sync-switch');
  saved(skill(third.claude, 'report'), 5);
  const agent = join(third.home, '.claude/agents/report.md'), settings = join(third.home, '.claude.json');
  for (const tool of ['.claude', '.codex', '.copilot']) mkdirSync(join(third.home, tool, 'agents'), { recursive: true });
  writeFileSync(agent, '---\nname: report\ndescription: Write a report.\n---\nReport.\n');
  writeFileSync(settings, JSON.stringify({ mcpServers: { report: { command: 'report' }, locked: { command: 'locked' } } }));
  for (const file of [agent, settings]) utimesSync(file, ago(5), ago(5));
  await d.click('#overview-sync-now');
  rmSync(join(third.codex, 'report'), { recursive: true });
  rmSync(join(third.home, '.codex/agents/report.toml'));
  const copilot = join(third.home, '.copilot/mcp-config.json');
  const dropServer = name => {
    const config = JSON.parse(readNow(copilot));
    delete config.mcpServers[name];
    writeFileSync(copilot, JSON.stringify(config));
  };
  dropServer('report');
  await d.click('#header-refresh');
  await d.click('#nav-skills');
  await d.run("document.querySelector('#sync-now').click(); true");
  check('the list’s Sync once is also off during the click', await d.run("document.querySelector('#sync-now')?.disabled"));
  if (d.inspect) {
    const menu = await mainHelpers(d.inspect);
    try { await menu.clickMenu('Automatic sync', false); } finally { menu.close(); }
  }
  await d.settle();
  const names = await d.text('[data-outcome] .band-text');
  check('same-named removals list each kind with both destinations',
    ['skill', 'agent', 'MCP server'].every(kind => names?.includes(`report (${kind}) from Claude Code and ${kind === 'MCP server' ? 'Codex' : 'Copilot CLI'}`)), names);
  if (d.inspect) {
    for (let n = 0; n < 50 && !await d.exists('#sync-switch[aria-checked="true"]'); n++) await wait(100);
  }
  await d.shot('sync-once-same-names');
  if (d.inspect) await d.click('#sync-switch');
  await d.click('#nav-mcp');
  dropServer('locked');
  for (let n = 1; n <= 8; n++) saved(skill(third.claude, 'guide-' + n), 5);
  await d.click('#header-refresh');
  await sizeTo(d, ...SMALLEST);
  mkdirSync(settings + '.lock');
  try {
    await d.click('#sync-now');
    const words = await d.text('[data-outcome] .band-text');
    check('a held removal names the surviving tool and its lock alongside the removal, with a warning',
      /locked from Codex/.test(words) && /remove locked from Claude Code.*lock/i.test(words) && await d.exists('[data-outcome] .tone-warning')
      && !!JSON.parse(readNow(settings)).mcpServers.locked, words);
    check('a large Sync once shows two successful items, counts the rest and offers their History',
      (words?.match(/Took in guide-/g) ?? []).length === 2 && /took in 6 more items/i.test(words)
      && await d.exists('#outcome-history'), words);
    same('the folded result fits the smallest window and covers no controls below the header', [
      await d.run(CUT_OFF), await d.run("document.querySelector('.header-result').getBoundingClientRect().bottom <= document.querySelector('#page').getBoundingClientRect().top + 1"),
    ], [[], true]);
    await d.shot('sync-once-folded-minimum');
    await d.click('#outcome-history');
    const guides = (await d.all('.history-row[data-kind="on"] .history-what strong')).filter(name => name.startsWith('guide-'));
    same('History lists all eight guides, including the six folded into the count', new Set(guides).size, 8);
  } finally { rmSync(settings + '.lock', { recursive: true }); }
  if (d.inspect) {
    await d.click('#nav-overview');
    const menu = await mainHelpers(d.inspect);
    try {
      await menu.slowReply('discovery:refresh', 800);
      await d.run("document.querySelector('#header-refresh').click(); true");
      await menu.tellPage('sync:request');
      await d.settle();
      check('the menu’s Sync once during Refresh runs after it and reports the remaining removal',
        /Removed locked from Claude Code/.test(await d.text('[data-outcome] .band-text')));
    } finally { await menu.restore('discovery:refresh'); menu.close(); }
  }
  same('no page errors, first setup with Automatic sync off', d.pageErrors, []);
  await d.quit();

  for (const scenario of ['damaged', 'readonly']) {
    const blocked = homeFor('setup-' + scenario), store = join(blocked.home, '.central-knot');
    mkdirSync(blocked.claude, { recursive: true });
    saved(skill(blocked.codex, 'plan'), 5);
    mkdirSync(store);
    if (scenario === 'damaged') {
      writeFileSync(join(store, 'skills.json'), '{');
      writeFileSync(join(store, 'agents.json'), '{');
    }
    else { chmodSync(store, 0o555); chmodSync(blocked.home, 0o555); }
    const data = join(scratch, 'data-' + scenario);
    opened(blocked.home, data);
    const page = await launch(data, [], real);
    try {
      await sizeTo(page, 1280, 800);
      if (scenario === 'damaged') {
        const words = await page.text('#setup-question');
        check('setup says found skills wait for their problem and promises no copy from the damaged kind',
          /Found skills wait/.test(words) && !/agents wait|Yes takes in what turns up later|takes in now the 1 item/.test(words)
          && /damaged[\s\S]*Synchronize everything\?/.test(await page.text('#overview-needs')), words);
      } else {
        check('a read-only store explains the stop before setup and offers no Yes',
          !(await page.exists('#setup-yes')) && /read-only|Permission was denied/i.test(await page.text('#overview-stopped'))
          && !/Open one below and turn on/.test(await page.text('.overview-lead')), await page.text('#overview-needs'));
      }
      await page.shot('setup-' + scenario);
    } finally {
      chmodSync(blocked.home, 0o755); chmodSync(store, 0o755);
      await page.quit();
    }
  }
}

/**
 * Force-kills the app part-way through real copies, then checks nothing half-written is visible to a tool. Each round takes in
 * what the kills before it left found: on the Mac runner all 40 were on record by the last open in each grouped run of
 * 2026-11-17, so opening alone completed them; elsewhere a few may still be found then (7 of 40 once on picoder, with 33 on
 * record), each turned on by its Add.
 */
async function crashFlow() {
  // Its checks are one or two per skill folder in place at each kill, so their count changes from run to run: said apart.
  const before = passes;
  execChmod();
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(COPILOT, { recursive: true });
  // Claude Code and Copilot CLI are here by their CLIs: on the Mac runner, the real ones installed outside any home; elsewhere
  // (no tool installed there) the home's own stand-ins.
  if (process.platform !== 'darwin') toolClis(HOME);
  const expected = {};
  for (let number = 0; number < 40; number++) {
    const directory = skill(CLAUDE, `bulk-${number}`);
    for (let file = 0; file < 60; file++) writeFileSync(join(directory, `file-${file}.txt`), `${number}:${file}\n`.repeat(2000));
    expected[`bulk-${number}`] = tree(directory);
  }
  const record = join(HOME, '.central-knot/skills.json');
  /** How many skills the record has On; -1 while it can't be read (none yet, or caught between two writes). */
  const onRecordNow = () => { try { return Object.values(JSON.parse(readFileSync(record, 'utf8')).items).filter(item => item.on).length; } catch { return -1; } };
  let interrupted = 0;
  for (let round = 0; round < crashRounds; round++) {
    const a = await launch(join(scratch, 'crash-data'));
    await a.click('#home-actual');
  await a.click('#nav-skills');
    // Each skill a click takes in is on record once it is carried out, one after another, so a kill leaves some taken in
    // (opening catches their copies up) and the rest still found: those are taken in again, in one request (no bulk switch on
    // the page), not waited for, so the kill lands while it copies.
    const taking = await a.run(`(() => { const found = [...document.querySelectorAll('.ov-row[data-key^="${rowPart('', 'skills', 'bulk-')}"]')].filter(row => row.querySelector('.add-item')).map(row => ({ key: row.dataset.key.slice(${rowPart('', 'skills', '').length}), on: true, except: [] }));
      if (found.length) window.centralKnot.applySkills(found, false, document.querySelector('.status-home').title); else document.querySelector('#header-refresh').click(); return found.length; })()`);
    // The kill window opens once this round's first skill is on record, so the kill lands in the take-in, however late a busy
    // machine starts it; the first round has no record yet, which counts as none on. A round with nothing left to take in
    // has no take-in to wait for.
    if (taking > 0) for (const before = Math.max(0, onRecordNow()), end = Date.now() + 15000; Date.now() < end && onRecordNow() <= before;) await wait(10);
    await wait(30 + Math.round(round * 700 / Math.max(1, crashRounds - 1)) + randomInt(40));
    await a.crash();
    if (readdirSync(COPILOT).length < 40) interrupted++;
    for (const name of readdirSync(COPILOT)) {
      check(`round ${round}: nothing half-written in a loaded folder (${name})`, !name.startsWith('.'), name);
      if (expected[name]) same(`round ${round}: ${name} is complete or absent`, tree(join(COPILOT, name)), expected[name]);
    }
    if (existsSync(record)) { try { JSON.parse(readFileSync(record, 'utf8')); passes++; } catch { check(`round ${round}: record stays valid`, false); } }
  }
  const onRecord = Math.max(0, onRecordNow());
  // A round killed before its take-in began tests nothing (every folder is merely absent): some skills must be on record.
  check('the kills landed while skills were taken in: some are on record before the last open', onRecord > 0, onRecord);
  const a = await launch(join(scratch, 'crash-data'));
  await a.click('#home-actual');
  await a.click('#nav-skills');
  // Opening catches up every skill on record; the ones a kill left found are turned on, each.
  for (const key of await rowKeys(a, 'skills')) if (key.startsWith('bulk-') && await a.exists(`#${rowPart('add', 'skills', key)}`)) await a.click(`#${rowPart('add', 'skills', key)}`);
  console.log(`crash finish: ${onRecord} of 40 on record before opening, caught up on open; the rest turned on again`);
  same('after crashes, opening again completes every copy', readdirSync(COPILOT).filter(name => name.startsWith('bulk-')).length, 40);
  for (const name of Object.keys(expected)) same(`final ${name} bytes`, tree(join(COPILOT, name)), expected[name]);
  same('stale stages are cleared', readdirSync(join(HOME, '.copilot')).filter(name => name.startsWith('.ck-')), []);
  same('no page errors, crashes', a.pageErrors, []);
  await a.quit();
  check('at least one round really interrupted copying', interrupted > 0, interrupted);
  console.log(`crash rounds: ${crashRounds}, interrupted a copy in ${interrupted}, ${passes - before} checks passed in this flow`);
}

/**
 * A draft of the base instructions written by one of the person's tools (INS-06), as people click it: choose the tool, a tool
 * that fails says why, a slow one is stopped, and a draft is reviewed, changed and saved in one step, then undone. The tools
 * are stand-ins in the HOME the app is given: each notes the prompt it was sent and answers as `mode` says.
 */
async function draftFlow() {
  const realHome = join(scratch, 'draft-real'), home = join(scratch, 'draft-home'), data = join(scratch, 'draft-data');
  const claudeMd = join(home, '.claude/CLAUDE.md'), agentsMd = join(home, '.codex/AGENTS.md'), copilotMd = join(home, '.copilot/copilot-instructions.md');
  for (const folder of ['.claude', '.codex', '.copilot']) mkdirSync(join(home, folder), { recursive: true });
  const claude0 = '# Style\nBe brief.\n\n# Claude\nUse the Task tool.\nDropped by the draft.\n', codex0 = 'Be brief.\nRun codex review before pushing.\n';
  writeFileSync(claudeMd, claude0);
  writeFileSync(agentsMd, codex0);
  mkdirSync(join(realHome, '.local/bin'), { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  // Each stand-in notes its arguments (one a line) whenever it is run for a draft, before anything else: no file, not run.
  const mode = join(realHome, 'draft-mode'), got = join(realHome, 'draft-got'), ran = `${got}.args`;
  const draft = ['<<<CENTRAL KNOT: base>>>', '# Style', 'Be brief.', '<<<CENTRAL KNOT: claude-cli>>>', '# Claude', 'Use the Task tool.', '<<<CENTRAL KNOT: codex-cli>>>', 'Run codex review before pushing.', '<<<CENTRAL KNOT: end>>>'].join('\n');
  const answers = `printf '%s\\n' "$@" > '${ran}'\ncase "$(cat '${mode}')" in\n  fail) echo "Not logged in · Please run /login" >&2; exit 1 ;;\n  slow) cat > /dev/null; sleep 60 ;;\n  late) sleep 2 ;;\nesac\ncat > '${got}'\npwd > '${got}.cwd'\n`;
  const stub = (name, version, answer) => { writeFileSync(join(realHome, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\n${answers}${answer}\n`); chmodSync(join(realHome, '.local/bin', name), 0o755); };
  stub('claude', '2.1.322 (Claude Code)', `[ "$1" = "-p" ] || exit 9\ncat <<'EOF'\n${draft}\nEOF`);
  stub('codex', 'codex-cli 0.167.0', `[ "$1" = "exec" ] || exit 9\nprev=""\nfor arg; do [ "$prev" = "-o" ] && out="$arg"; prev="$arg"; done\necho "working"\ncat > "$out" <<'EOF'\n${draft}\nEOF`);
  writeFileSync(mode, 'fail');

  const a = await launch(data, [], realHome);
  const says = async selector => (await a.text(selector)) ?? '';
  const untilThere = async selector => { for (let tries = 0; tries < 80 && !(await a.exists(selector)); tries++) await wait(100); return a.exists(selector); };
  const typeModel = name => a.run(`(() => { const box = document.querySelector('#base-draft-model'); box.value = ${JSON.stringify(name)}; box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const argsSent = () => readNow(ran).trim().split('\n');
  // In view within a pixel: scroll positions are whole pixels, layout is not.
  const inView = ids => a.run(`(() => { const page = document.querySelector('#instructions-scroll').getBoundingClientRect(); return ${JSON.stringify(ids)}.map(id => { const box = document.getElementById(id)?.getBoundingClientRect(); return !!box && box.top >= page.top - 1 && box.bottom <= page.bottom + 1; }); })()`);
  await a.click('#nav-instructions');
  check('with tools that can write one, the base card offers a draft', await untilThere('#base-draft'), await says('#base-card'));
  // A file with Windows line endings: a click puts the caret where it landed, and an edit keeps every other line's ending.
  const crlf = 'Run codex review before pushing.\r\nline one\r\nline two\r\nTARGET here\r\nlast line\r\n';
  writeFileSync(agentsMd, crlf);
  await a.click('#header-refresh');
  const target = await pointAt(a, '[aria-label="Codex instructions"] pre.ins-preview', 'TARGET');
  // What is under the click's point, said if the check fails.
  const under = await a.run(`(() => { const hit = document.elementFromPoint(${target.x}, ${target.y}), at = document.caretRangeFromPoint(${target.x}, ${target.y}); return { point: ${JSON.stringify(target)}, hit: hit && (hit.id || hit.className || hit.tagName), at: at && [at.startContainer.nodeName, at.startOffset], scroll: document.querySelector('#instructions-scroll').scrollTop }; })()`);
  await clickText(a, '[aria-label="Codex instructions"] pre.ins-preview', 'TARGET');
  // The focused editor's id and the six characters at its caret.
  const atCaret = () => a.run(`(() => { const area = document.activeElement; return [area.id, area.value?.slice(area.selectionStart, area.selectionStart + 6)]; })()`);
  const landed = await atCaret();
  check('in a file with Windows line endings a click puts the caret where it landed', landed[0] === 'ins-text-codex-cli' && landed[1] === 'TARGET', { landed, under });
  // A redraw just after the click (a background pass, the usage reading) draws the editor again: its caret stays where it was.
  const [boxRedrawn] = await redrawUnder(a, '#ins-text-codex-cli');
  same('a redraw just after the click keeps the editor’s caret where the click put it', [boxRedrawn, ...await atCaret()], [true, 'ins-text-codex-cli', 'TARGET']);
  await a.send('Input.insertText', { text: 'NEW ' });
  await a.run(`(() => { const area = document.querySelector('#ins-text-codex-cli'); area.value += 'added line\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-codex-cli');
  same('its review counts the line typed on and the line added, not every line', await says('[aria-label="Codex instructions"] .ins-review-title'), 'Review before saving AGENTS.md: 1 line changed, 1 line added.');
  await a.click('#ins-save-codex-cli');
  same('and the save keeps every other line byte for byte, the new line taking the file’s own ending', readNow(agentsMd), crlf.replace('TARGET', 'NEW TARGET') + 'added line\r\n');
  // A click past a line's end lands at that line's end, not on the next line.
  await pointAt(a, '[aria-label="Codex instructions"] pre.ins-preview', 'line two');
  const pastEnd = await a.run(`(() => { const pre = document.querySelector('[aria-label="Codex instructions"] pre.ins-preview'), node = pre.firstChild, at = node.textContent.indexOf('line two');
    const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 8); const line = range.getBoundingClientRect();
    return { x: Math.min(pre.getBoundingClientRect().right - 16, line.right + 200), y: line.top + line.height / 2 }; })()`);
  await mouse(a, 'mouseMoved', pastEnd, 0); await mouse(a, 'mousePressed', pastEnd, 1); await mouse(a, 'mouseReleased', pastEnd, 0);
  await a.settle();
  same('in that file a click past a line’s end puts the caret at that line’s end', await a.run(`(() => { const area = document.activeElement; return [area.id, area.value.slice(area.selectionStart - 8, area.selectionStart), area.value[area.selectionStart]]; })()`), ['ins-text-codex-cli', 'line two', '\n']);
  await a.press('Escape');
  for (let tries = 0; tries < 30 && await a.exists('#ins-text-codex-cli'); tries++) await wait(100);
  // A redraw landing between the press and the release replaces the text under the button, and the browser then sends no click:
  // the release opens the editor of the text now there, the caret where it was aimed, in that file too.
  const codexText = '[aria-label="Codex instructions"] pre.ins-preview';
  let underPress;
  await clickText(a, codexText, 'TARGET', async () => { underPress = await redrawUnder(a, codexText); });
  same('a click on a tool’s text with a redraw between its press and its release: the text was replaced, and its editor opens with the caret where it was aimed',
    [...underPress, ...await atCaret()], [true, true, 'ins-text-codex-cli', 'TARGET']);
  await a.press('Escape');
  for (let tries = 0; tries < 30 && await a.exists('#ins-text-codex-cli'); tries++) await wait(100);
  // …only while the text now there is the same: a press on TARGET, the file changed and read again before the release (its last
  // line only, so TARGET is where it was), then the release: nothing opens.
  const savedText = readNow(agentsMd);
  await clickText(a, codexText, 'TARGET', async () => {
    writeFileSync(agentsMd, savedText.replace('last line', 'last line, changed'));
    await a.run(`document.querySelector('#header-refresh').click()`);
    await a.settle();
    underPress = await a.run(`(() => { const text = document.querySelector('${codexText}'); return [text.textContent.includes('changed'), text.matches('.ins-editable')]; })()`);
  });
  same('a press on a tool’s text, its text changed before the release: nothing opens', [...underPress, await a.exists('#ins-text-codex-cli')], [true, true, false]);
  writeFileSync(agentsMd, savedText);
  await a.click('#header-refresh');

  // Selecting a card's text keeps the selection, to copy it: a drag opens no editor. A double-click's first click is a plain
  // click, which opens the editor, and its second selects the word there.
  await a.run(`document.querySelector('#ins-head-codex-cli').scrollIntoView({ block: 'start' })`);
  const from = await pointAt(a, codexText, 'line one'), to = await pointAt(a, codexText, 'last line');
  await mouse(a, 'mouseMoved', from, 0); await mouse(a, 'mousePressed', from, 1); await mouse(a, 'mouseMoved', to, 1); await mouse(a, 'mouseReleased', to, 0);
  await a.settle();
  same('a drag across a card’s text selects it and opens no editor', [await a.exists('#ins-text-codex-cli'), (await a.run(`String(getSelection())`)).includes('line two')], [false, true]);
  // Each gesture below starts with no editor open (one a broken build opened is closed, so the next is measured on its own).
  const noEditor = async () => { if (await a.exists('#ins-text-codex-cli')) await a.press('Escape'); for (let tries = 0; tries < 30 && await a.exists('#ins-text-codex-cli'); tries++) await wait(100); };
  // A Shift-click farther along extends that selection, as anywhere: it opens no editor, and the selection reaches the click.
  const farther = await pointAt(a, codexText, 'added line');
  await mouse(a, 'mouseMoved', farther, 0, 8); await mouse(a, 'mousePressed', farther, 1, 8); await mouse(a, 'mouseReleased', farther, 0, 8);
  await a.settle();
  same('a Shift-click farther along a selected text extends the selection and opens no editor',
    [await a.exists('#ins-text-codex-cli'), ...await a.run(`(() => { const chosen = String(getSelection()); return [chosen.startsWith('line one'), chosen.includes('last line')]; })()`)], [false, true, true]);
  await noEditor();
  // A drag backwards from TARGET to line one, then the same drag with a redraw landing halfway (at line two) and carried on past
  // where it was then: it selects what the drag with no redraw selects, backwards, and opens no editor. (Each starts with nothing
  // selected: a press inside a selection drags the selected text instead.)
  await a.run(`getSelection().removeAllRanges()`);
  const fromTarget = await pointAt(a, codexText, 'TARGET'), halfway = await pointAt(a, codexText, 'line two');
  const dragBack = async whileHeld => {
    await mouse(a, 'mouseMoved', fromTarget, 0); await mouse(a, 'mousePressed', fromTarget, 1); await mouse(a, 'mouseMoved', halfway, 1);
    const [replaced] = (await whileHeld?.()) ?? [false];
    await mouse(a, 'mouseMoved', from, 1); await mouse(a, 'mouseReleased', from, 0);
    await a.settle();
    const chosen = await a.run(`(() => { const chosen = getSelection(); return [String(chosen), chosen.anchorOffset > chosen.focusOffset]; })()`);
    await a.run(`getSelection().removeAllRanges()`);
    return [replaced, await a.exists('#ins-text-codex-cli'), ...chosen];
  };
  const plainBack = await dragBack();
  check('a drag backwards across a card’s text selects it backwards', plainBack[2].includes('line two') && plainBack[3], plainBack);
  same('…and the same drag with a redraw halfway, carried on past where it was then: the text was replaced, the same selection, backwards, and no editor',
    await dragBack(() => redrawUnder(a, codexText)), [true, false, plainBack[2], true]);
  // A press that moves off its character and comes back before the release is a drag too (the browser's own rule): nothing opens.
  await mouse(a, 'mouseMoved', fromTarget, 0); await mouse(a, 'mousePressed', fromTarget, 1); await mouse(a, 'mouseMoved', halfway, 1); await mouse(a, 'mouseMoved', fromTarget, 1); await mouse(a, 'mouseReleased', fromTarget, 0);
  await a.settle();
  same('a press that moves off its character and back before the release opens no editor', await a.exists('#ins-text-codex-cli'), false);
  await noEditor();
  // A release on another character of the same text, with no move between, is a drag as well: nothing opens.
  await mouse(a, 'mouseMoved', fromTarget, 0); await mouse(a, 'mousePressed', fromTarget, 1); await mouse(a, 'mouseReleased', halfway, 0);
  await a.settle();
  same('a press released on another character of its text, with no move between, opens no editor', await a.exists('#ins-text-codex-cli'), false);
  await noEditor();
  await a.run(`getSelection().removeAllRanges()`);
  // A drag whose text goes away under it (its file removed and the page read again while the button is held) selects nothing.
  const dragFrom = await pointAt(a, codexText, 'line one'), dragOn = await pointAt(a, codexText, 'line two'), codexNow = readNow(agentsMd);
  await mouse(a, 'mouseMoved', dragFrom, 0); await mouse(a, 'mousePressed', dragFrom, 1); await mouse(a, 'mouseMoved', dragOn, 1);
  rmSync(agentsMd);
  await a.run(`document.querySelector('#header-refresh').click()`);
  await a.settle();
  const textGone = !(await a.exists(codexText)), dragEnd = { x: dragOn.x, y: dragOn.y + 80 };
  await mouse(a, 'mouseMoved', dragEnd, 1); await mouse(a, 'mouseReleased', dragEnd, 0);
  await a.settle();
  same('a drag whose text went away before its release selects nothing', [textGone, await a.run(`String(getSelection())`)], [true, '']);
  writeFileSync(agentsMd, codexNow);
  await a.click('#header-refresh');
  const word = await pointAt(a, codexText, 'last line');
  for (const clickCount of [1, 2]) for (const [type, buttons] of [['mousePressed', 1], ['mouseReleased', 0]]) await a.send('Input.dispatchMouseEvent', { type, x: word.x + 12, y: word.y, button: 'left', buttons, clickCount });
  await a.settle();
  same('a double-click on a word selects it, in the editor its first click opened', await a.run(`(() => { const area = document.activeElement; return [area.id, area.value.slice(area.selectionStart, area.selectionEnd)]; })()`), ['ins-text-codex-cli', 'last']);
  await a.press('Escape');
  writeFileSync(agentsMd, codex0);
  await a.click('#header-refresh'); await a.click('#nav-skills'); await a.click('#nav-instructions');

  await a.shot('draft-entry');
  const page0 = await says('#instructions-scroll');

  // The first click opens a panel and runs nothing: which tool, the model, what it does, and the whole prompt.
  await a.click('#base-draft');
  check('Draft with a tool opens its panel and runs no tool', await untilThere('#base-draft-panel') && !existsSync(ran), await says('#base-card'));
  // Claude Code and Codex have a CLI in the HOME the app is given. Copilot CLI has only its folder in the home on screen, so
  // it is offered only on a machine that has its CLI in a system folder (which no test home can hide).
  const offered = await a.all('#base-draft-panel input[name="draft-tool"]', 'e.id');
  check('each tool with a CLI on this computer is offered by name, the first chosen', offered.includes('base-draft-by-claude-cli') && offered.includes('base-draft-by-codex-cli') && await a.run(`document.querySelector('#base-draft-by-claude-cli').checked`), offered);
  if (!existsSync('/opt/homebrew/bin/copilot') && !existsSync('/usr/local/bin/copilot')) check('and a tool with no CLI is not', !offered.includes('base-draft-by-copilot-cli'), offered);
  check('the panel says which tool’s command line runs, and that nothing changes until the draft is saved', /Central Knot runs Claude Code’s command line once/.test(await says('#base-draft-panel')) && /changes nothing: your files change only when you review the draft and save it/.test(await says('#base-draft-panel')), await says('#base-draft-panel'));
  const shown = await says('#base-draft-prompt');
  check('it shows the whole prompt, each file’s own text in it, and it can be selected', shown.includes(`<<<FILE: claude-cli, Claude Code’s CLAUDE.md>>>\n${claude0}<<<END OF FILE>>>`) && shown.includes(`<<<FILE: codex-cli, Codex’s AGENTS.md>>>\n${codex0}<<<END OF FILE>>>`) && shown.endsWith('<<<CENTRAL KNOT: end>>>\n')
    && (await a.run(`getComputedStyle(document.querySelector('#base-draft-prompt')).userSelect`)) === 'text', shown);
  check('the tools’ texts stay on the page under it, as they were', (await says('[aria-label="Claude Code instructions"] pre.ins-preview')) === claude0.trimEnd() && !(await a.exists('#base-head .ins-actions')), await says('#base-card'));
  await a.shot('draft-panel');
  for (const [width, height] of [[860, 600], [1280, 800], [1728, 1080], [2560, 1440]]) {
    await sizeTo(a, width, height); same(`nothing cut off in the draft panel at ${width}×${height}`, await a.run(CUT_OFF), []); await a.shot(`draft-panel-${width}`);
  }
  await fullSize(a);

  // Cancel: nothing ran, and the page and the files are as they were.
  await a.click('#base-draft-cancel');
  same('Cancel closes the panel, with the page, the files and what ran as they were', [await says('#instructions-scroll'), readNow(claudeMd), readNow(agentsMd), existsSync(copilotMd), existsSync(ran), await a.run(`document.activeElement?.id`)], [page0, claude0, codex0, false, false, 'base-draft']);

  // Opened in the smallest window, the panel shows Start and Cancel, Start holding the focus.
  await sizeTo(a, 860, 600);
  await a.click('#base-draft');
  same('opened at 860×600, the panel’s Start and Cancel are in view, Start focused', [...await inView(['base-draft-start', 'base-draft-cancel']), await a.run(`document.activeElement?.id`)], [true, true, 'base-draft-start']);
  await a.shot('draft-panel-opened-860');
  await a.click('#base-draft-cancel');
  await fullSize(a);

  // A run that fails: said in the tool's words; the panel stays, with the model still typed, and the other tool can be tried.
  await a.click('#base-draft');
  await typeModel('sonnet');
  await a.click('#base-draft-start');
  check('a tool that can’t answer says why in its own words, in the panel', (await says('#base-draft-problem')).includes('Claude Code could not write a draft: “Not logged in · Please run /login”. Nothing was changed.'), await says('#base-card'));
  same('it was run with the model typed', argsSent(), ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--model', 'sonnet']);
  same('and after it, the model is still typed, the other tool can be chosen, and nothing was written', [await a.run(`document.querySelector('#base-draft-model').value`), await a.exists('#base-draft-by-codex-cli'), readNow(claudeMd), readNow(agentsMd), existsSync(copilotMd), existsSync(join(home, '.central-knot/instructions/base.md'))],
    ['sonnet', true, claude0, codex0, false, false]);
  await a.shot('draft-problem');

  // A tool that takes its time: the panel says it is writing, the texts stay in view, and Stop ends it.
  writeFileSync(mode, 'slow');
  await a.click('#base-draft-by-codex-cli');
  same('choosing another tool clears the model typed for the first, so it is never sent to the other', [await a.run(`document.querySelector('#base-draft-model').value`), await a.run(`document.querySelector('#base-draft-model').placeholder`)], ['', 'Codex’s default']);
  await typeModel('gpt-5-codex');
  await a.run(`document.querySelector('#base-draft-start').click()`);
  check('while a tool writes, the panel says so and offers Stop, the texts in view as they were', await untilThere('#base-draft-stop') && /Codex is writing a draft of the base instructions/.test(await says('#base-draft-panel'))
    && (await says('[aria-label="Claude Code instructions"] pre.ins-preview')) === claude0.trimEnd(), await says('#base-card'));
  await a.shot('draft-writing');
  await a.click('#base-draft-stop');
  check('Stop leaves the panel with Codex chosen and the model still typed, nothing said to be wrong', await untilThere('#base-draft-start') && await a.run(`document.querySelector('#base-draft-by-codex-cli').checked && document.querySelector('#base-draft-model').value === 'gpt-5-codex'`) && !(await a.exists('#base-draft-problem')), await says('#base-card'));

  // A draft dropped because a file changed while it was written: the panel shows the prompt as it is now, and Start then runs.
  writeFileSync(mode, 'late');
  await a.click('#base-draft-by-claude-cli');
  await typeModel('');
  rmSync(ran, { force: true });
  await a.run(`document.querySelector('#base-draft-start').click()`);
  // The stand-in notes its arguments as it starts, after the files were read: the change lands while it writes.
  for (let tries = 0; tries < 80 && !existsSync(ran); tries++) await wait(50);
  writeFileSync(claudeMd, `${claude0}Typed while the draft was written.\n`);
  await untilThere('#base-draft-problem');
  check('a file changed while the draft was written: it is dropped, and the panel shows the prompt as it would be sent now', /changed while the draft was being written/.test(await says('#base-draft-problem')) && (await says('#base-draft-prompt')).includes('Typed while the draft was written.'), await says('#base-draft-panel'));
  await a.shot('draft-dropped-new-prompt');
  writeFileSync(mode, 'ok');
  await a.click('#base-draft-start');
  check('and the next Start runs', await untilThere('#base-save') && readNow(got).includes('Typed while the draft was written.'), await says('#base-draft-panel'));
  writeFileSync(claudeMd, claude0);
  await a.click('#base-review-discard'); await a.click('#base-review-discard-yes');
  await a.click('#base-draft'); await a.click('#base-draft-by-codex-cli');

  // A draft: sent the prompt shown, on the model typed; reviewed first, each file's change said, and what it carried nowhere pointed out.
  writeFileSync(mode, 'ok');
  await typeModel('');
  // Start with typed text in a tool's editor asks about it first, as every action that opens an editor does, and runs nothing.
  rmSync(ran, { force: true });
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value += 'Typed, not saved.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-draft-start');
  check('Start with typed text in a tool’s editor asks about that text first, and runs nothing', await a.exists('#ins-keep-claude-cli') && !existsSync(ran) && !(await a.exists('#base-save')), await says('#instructions-scroll'));
  await a.click('#ins-discard-claude-cli');
  // A clean tool editor closes when Start runs: one thing is edited at a time.
  await a.click('#ins-edit-claude-cli');
  await a.click('#base-draft-start');
  check('the draft opens as a review that names who wrote it', await untilThere('#base-save') && (await says('.ins-review-title')) === 'Codex’s draft. Check it, then save.', await says('#base-card'));
  check('and the clean tool editor that was open closed', !(await a.exists('#ins-text-claude-cli')), await says('#instructions-scroll'));
  same('the tool was sent the prompt shown, byte for byte', readNow(got), shown);
  check('with no model when none is typed: the tool’s own default', !argsSent().includes('--model') && argsSent().at(-1) === '-', argsSent());
  check('and ran in a folder of its own, gone afterwards', readNow(`${got}.cwd`).includes('central-knot-draft-') && !existsSync(readNow(`${got}.cwd`).trim()), readNow(`${got}.cwd`));
  const plan = await says('.base-plan');
  same('the review shows the base as it will be', await a.all('#base-card .ins-editor > pre.ins-preview', 'e.textContent'), ['# Style\nBe brief.']);
  check('and says what each file becomes', plan.includes('Its own instructions become 2 lines, then the base:') && plan.includes('Its own instructions become 1 line, then the base:') && plan.includes('copilot-instructions.md is created, holding only the base instructions.'), plan);
  same('with the lines each file keeps in view', await a.all('.base-plan pre.ins-preview', 'e.textContent'), ['# Claude\nUse the Task tool.', 'Run codex review before pushing.']);
  check('a line the draft carried nowhere is pointed out under its file', plan.includes('1 line of CLAUDE.md isn’t in the draft as written. It may be reworded or left out.'), plan);
  await a.click('#base-lost-claude-cli');
  same('and shown on request', (await a.all('.base-plan pre.ins-preview', 'e.textContent'))[1], 'Dropped by the draft.');
  same('nothing is written by reviewing', [readNow(claudeMd), readNow(agentsMd), existsSync(copilotMd)], [claude0, codex0, false]);
  await a.shot('draft-review');
  for (const width of [860, 1180, 1320, 1728]) { await sizeTo(a, width, 800); same(`nothing cut off in a draft’s review at ${width}×800`, await a.run(CUT_OFF), []); }
  await fullSize(a);

  // The draft is the person's to change: the base, and what stays in each file.
  await a.click('#base-back');
  same('Edit the draft opens the base and each file’s own part', [await a.run(`document.querySelector('#base-text').value`), await a.run(`document.querySelector('#base-own-claude-cli').value`), await a.run(`document.querySelector('#base-own-codex-cli').value`)], ['# Style\nBe brief.\n', '# Claude\nUse the Task tool.\n', 'Run codex review before pushing.\n']);
  await a.run(`(() => { const area = document.querySelector('#base-own-claude-cli'); area.value += 'Dropped by the draft.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  for (const width of [860, 1180, 1728]) { await sizeTo(a, width, 800); same(`nothing cut off editing a draft at ${width}×800`, await a.run(CUT_OFF), []); }
  await fullSize(a);
  await a.shot('draft-edit');
  await a.click('#base-cancel');
  check('leaving the editor asks about the draft by name, since it took minutes to get', (await says('#base-card')).includes('Discard Codex’s draft?'), await says('#base-card'));
  await a.click('#base-keep');
  await a.click('#base-review');
  check('a line put back by hand is no longer pointed out', !(await says('.base-plan')).includes('in the draft as written'), await says('.base-plan'));
  await a.click('#base-save');
  const block = '<!-- Central Knot base instructions: start (shared by your tools; edit them in Central Knot) -->\n# Style\nBe brief.\n<!-- Central Knot base instructions: end -->\n';
  same('one Save sets the base and each file: its own part, then the base', [readNow(claudeMd), readNow(agentsMd), readNow(copilotMd), readNow(join(home, '.central-knot/instructions/base.md'))],
    [`# Claude\nUse the Task tool.\nDropped by the draft.\n\n${block}`, `Run codex review before pushing.\n\n${block}`, block, '# Style\nBe brief.\n']);
  check('the result says which files were updated, with Undo', /Base instructions saved in CLAUDE.md, copilot-instructions.md and AGENTS.md/.test(await says('.bands')) && await a.exists('#outcome-undo-base'), await says('.bands'));
  await a.shot('draft-saved');
  await a.click('#outcome-undo-base');
  same('Undo puts every file back as it was', [readNow(claudeMd), readNow(agentsMd), existsSync(copilotMd)], [claude0, codex0, false]);

  // A base again, the draft saved as written, for what follows.
  await a.click('#base-draft'); await a.click('#base-draft-start'); await untilThere('#base-save'); await a.click('#base-save');
  const files1 = [`# Claude\nUse the Task tool.\n\n${block}`, `Run codex review before pushing.\n\n${block}`, block];
  same('a draft saved as written', [readNow(claudeMd), readNow(agentsMd), readNow(copilotMd)], files1);
  // A tool whose file holds only the base: its one action says it adds to them, and starts an editor.
  same('a tool with only the base offers to add instructions of its own, by name', await says('#ins-edit-copilot-cli'), 'Add additional instructions for Copilot CLI');
  same('its strip says the base is all its file holds; after a tool’s own text it comes then', [await says('[aria-label="Copilot CLI instructions"] .base-strip-line strong'), await says('[aria-label="Claude Code instructions"] .base-strip-line strong')], ['Only the base instructions', 'Then the base instructions']);
  await a.click('#ins-edit-copilot-cli');
  same('and a click opens its editor', await caretAt(a), ['ins-text-copilot-cli', 0]);
  await a.press('Escape');

  // With a base: its text stays on screen while a draft is set up, written and stopped; Cancel then leaves the card as it was.
  const card0 = await says('#base-card');
  await sizeTo(a, 1316, 819);
  await a.click('#base-draft');
  same('opened with a base at 1316×819, the panel’s Start is in view and focused', [...await inView(['base-draft-start']), await a.run(`document.activeElement?.id`)], [true, 'base-draft-start']);
  await fullSize(a);
  await typeModel('gpt-5');
  writeFileSync(mode, 'slow');
  await a.run(`document.querySelector('#base-draft-start').click()`);
  await untilThere('#base-draft-stop');
  check('the base’s text stays in view under its head while a tool writes', (await says('#base-card pre.ins-preview')) === '# Style\nBe brief.' && await a.exists('#base-head') && await a.exists('#base-draft-panel'), await says('#base-card'));
  await a.click('#base-draft-stop');
  await untilThere('#base-draft-start');
  same('after Stop the text is in view and the model still typed', [await says('#base-card pre.ins-preview'), await a.run(`document.querySelector('#base-draft-model').value`)], ['# Style\nBe brief.', 'gpt-5']);
  await a.click('#base-draft-cancel');
  same('Cancel leaves the card and the files as they were', [await says('#base-card'), readNow(claudeMd), readNow(agentsMd), readNow(copilotMd)], [card0, ...files1]);
  await a.shot('draft-entry-with-base');

  // Shown is sent: a file that changes after the prompt is shown stops the Start, runs nothing, and the new prompt is shown.
  writeFileSync(mode, 'ok');
  await a.click('#base-draft');
  rmSync(ran, { force: true });
  writeFileSync(claudeMd, `${claude0}Typed after the prompt was shown.\n`);
  await a.click('#base-draft-start');
  check('a file changed after the prompt was shown: nothing runs, and the panel says so', !existsSync(ran) && (await says('#base-draft-problem')).startsWith('The instruction files changed after this prompt was shown, so nothing was sent.'), await says('#base-draft-panel'));
  check('and shows the prompt as it would be sent now', (await says('#base-draft-prompt')).includes('Typed after the prompt was shown.'), await says('#base-draft-prompt'));
  await a.shot('draft-prompt-refused');
  await a.click('#base-draft-start');
  check('Start then sends that prompt', await untilThere('#base-save') && readNow(got).includes('Typed after the prompt was shown.'), readNow(got));
  writeFileSync(claudeMd, claude0);
  await a.click('#base-review-discard'); await a.click('#base-review-discard-yes');

  // A file that changes after the draft was written: the draft knows nothing of it, so it can't be saved.
  await a.click('#base-draft'); await a.click('#base-draft-by-claude-cli'); await a.click('#base-draft-start');
  await untilThere('#base-save');
  writeFileSync(claudeMd, `${claude0}Typed after the draft.\n`);
  await a.click('#header-refresh');
  check('a file changed after the draft was written stops its save, and says so', await untilThere('#base-draft-stale') && await a.run(`document.querySelector('#base-save').disabled`) && /Claude Code’s file changed after this draft was written/.test(await says('#base-draft-stale')), await says('#base-card'));
  await a.click('#base-review-discard'); await a.click('#base-review-discard-yes');
  check('discarding the draft leaves the card as it was', await a.exists('#base-draft') && !(await a.exists('#base-save')) && readNow(claudeMd) === `${claude0}Typed after the draft.\n`, await says('#base-card'));

  // An editor opened on a card low in the window comes into view: its head, then its box.
  await sizeTo(a, 1280, 800);
  await a.run(`(() => { const page = document.querySelector('#instructions-scroll'), head = document.querySelector('#ins-head-codex-cli'); page.scrollTop += head.getBoundingClientRect().bottom - page.getBoundingClientRect().bottom + 2; })()`);
  await a.click('#ins-edit-codex-cli');
  same('an editor opened on a card low in the window shows its head and its box', await inView(['ins-head-codex-cli', 'ins-text-codex-cli']), [true, true]);
  await a.shot('editor-low-in-window');
  await a.press('Escape');
  await fullSize(a);

  // A long text in the smallest window: the card's head, with its actions, stays in view as an edit starts and is reviewed.
  const long = Array.from({ length: 200 }, (_, line) => `- Line ${line + 1} of a long CLAUDE.md, long enough to show how a text that runs for pages is edited.`).join('\n') + '\n';
  writeFileSync(claudeMd, long);
  await a.click('#header-refresh');
  await sizeTo(a, 860, 600);
  await a.run(`document.querySelector('#ins-head-claude-cli').scrollIntoView({ block: 'start' })`);
  same('at 860×600 a 200-line text’s Edit is in view at its card’s head', await inView(['ins-edit-claude-cli']), [true]);
  await a.click('#ins-more-claude-cli');
  await clickText(a, '[aria-label="Claude Code instructions"] pre.ins-preview', '- Line 150 ');
  same('a click on line 150 opens the editor with the caret on it', await caretAt(a), ['ins-text-claude-cli', long.indexOf('- Line 150 ')]);
  same('with Review changes and Cancel in view, and line 150 too, without scrolling the page', [...await inView(['ins-review-claude-cli', 'ins-cancel-claude-cli']), await caretLineShows(a)], [true, true, true]);
  same('and the whole box under its head, its end in view', await inView(['ins-head-claude-cli', 'ins-text-claude-cli']), [true, true]);
  await a.shot('long-text-860-editing');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.setRangeText('Changed: '); area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli');
  same('and Save in view once it is reviewed', await inView(['ins-save-claude-cli']), [true]);
  await a.shot('long-text-860-review');
  await a.click('#ins-review-discard-claude-cli'); await a.click('#ins-review-discard-yes-claude-cli');
  same('discarding leaves the long file as it was', readNow(claudeMd), long);

  // His case (clip 08): a base of 16 lines, and the Draft panel opened at his window's size and smaller. Start sits at the
  // window's foot every time, with the panel's title and the base text's last lines above it: the text is plainly still there.
  const base16 = Array.from({ length: 16 }, (_, line) => `- Base line ${line + 1}: a rule every tool reads.`).join('\n') + '\n';
  await fullSize(a);
  await a.click('#base-edit');
  await a.run(`(() => { const area = document.querySelector('#base-text'); area.value = ${JSON.stringify(base16)}; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#base-review'); await a.click('#base-save');
  const panelPlaced = () => a.run(`(() => {
    const page = document.querySelector('#instructions-scroll').getBoundingClientRect(), pre = document.querySelector('#base-card pre.ins-preview'), style = getComputedStyle(pre);
    const bottom = pre.getBoundingClientRect().bottom - parseFloat(style.paddingBottom), lastLines = { top: bottom - 3 * parseFloat(style.lineHeight), bottom };
    const shows = box => box.top >= page.top - 1 && box.bottom <= page.bottom + 1;
    return [shows(lastLines), shows(document.querySelector('#base-draft-panel h3').getBoundingClientRect()), shows(document.querySelector('#base-draft-start').getBoundingClientRect())];
  })()`);
  for (const [width, height] of [[1316, 819], [1280, 800], [860, 600]]) {
    await sizeTo(a, width, height);
    await a.run(`document.querySelector('#instructions-scroll').scrollTop = 0`);
    await a.click('#base-draft');
    const placed = await panelPlaced();
    if (width > 860) same(`opened at ${width}×${height} with a 16-line base: the base text’s last three lines, the panel’s title and Start are in view`, placed, [true, true, true]);
    else same('opened at 860×600 with a 16-line base: Start is in view', placed[2], true);
    await a.shot(`draft-panel-with-base-${width}`);
    await a.click('#base-draft-cancel');
  }
  await fullSize(a);
  same('no page errors, draft', a.pageErrors, []);
  await a.quit();
}

/**
 * Plugin updates that arrive by themselves, in a folder home with stand-in tools. The schedule runs every two seconds here
 * (CK_PLUGIN_UPDATES_EVERY_MS). With the window closed, the marketplace moves on and drops a plugin: Claude Code's copies are
 * updated through its own command, the plugin turned off there is off afterwards, Codex (which never had them) gets nothing,
 * and the dropped plugin stays, marked. The note and the Settings row say so after a restart; a failure is said and tried
 * again; with the switch off, or Automatic sync off, nothing runs.
 */
/**
 * A plugin's one switch, on the list and on its page (pluginrecord.ts): On puts issue-tracker into Claude Code by its own
 * installer (a stand-in that writes its record as the real one does) and into Pi as its items; Pi's box on its page,
 * unticked, takes it out of Pi alone; Off uninstalls it, and Undo installs it again where it was; a tick on one box of an Off
 * plugin turns it On in that tool alone. Each step reads what the page shows and the files.
 */
async function pluginSwitchFlow() {
  const home = join(scratch, 'home-switch'), data = join(scratch, 'switch-data'), market = join(scratch, 'market-switch'), tools = join(scratch, 'tools-switch');
  writeMarket(market, 'ck-test-market');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.pi/agent'), { recursive: true });
  const copy = join(home, '.claude/plugins/cache/ck-test-market/issue-tracker/2.0.0'), triage = join(market, 'plugins/issue-tracker/skills/triage/SKILL.md');
  mkdirSync(join(tools, '.local/bin'), { recursive: true });
  writeFileSync(join(tools, '.local/bin/claude'), `#!/bin/sh
[ "$1" = "--version" ] && echo "2.1.322 (Claude Code)" && exit 0
echo "$*" >> "$HOME/claude-calls.txt"
case "$*" in
  "plugin marketplace add ${market}") mkdir -p "$HOME/.claude/plugins" && printf '{"ck-test-market":{"source":{"source":"git","url":"${market}"}}}' > "$HOME/.claude/plugins/known_marketplaces.json" ;;
  "plugin install issue-tracker@ck-test-market --scope user") mkdir -p '${copy}/skills/triage' && cp '${triage}' '${copy}/skills/triage/' && printf '{"version":2,"plugins":{"issue-tracker@ck-test-market":[{"scope":"user","installPath":"${copy}","version":"2.0.0"}]}}' > "$HOME/.claude/plugins/installed_plugins.json" ;;
  "plugin uninstall issue-tracker@ck-test-market --scope user") printf '{"version":2,"plugins":{}}' > "$HOME/.claude/plugins/installed_plugins.json" ;;
  "plugin install starter-skills@ck-test-market --scope user") [ -f "$HOME/slow" ] && sleep 3; "${process.execPath}" -e "const fs = require('fs'), file = '$HOME/.claude/plugins/installed_plugins.json', now = JSON.parse(fs.readFileSync(file, 'utf8')); now.plugins['starter-skills@ck-test-market'] = [{ scope: 'user', installPath: '${market}', version: '1.0.0' }]; fs.writeFileSync(file, JSON.stringify(now))" ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home }, closeExplained: true }));
  const calls = () => (existsSync(join(home, 'claude-calls.txt')) ? readFileSync(join(home, 'claude-calls.txt'), 'utf8').trim().split('\n').filter(call => call.startsWith('plugin ')) : []);
  const installed = () => existsSync(join(home, '.claude/plugins/installed_plugins.json')) && !!JSON.parse(readFileSync(join(home, '.claude/plugins/installed_plugins.json'), 'utf8')).plugins['issue-tracker@ck-test-market'];
  const inPi = () => [existsSync(join(home, '.pi/agent/skills/triage/SKILL.md')), (readNow(join(home, '.pi/agent/mcp.json')) ?? '').includes('issues')];
  const entry = (plugin = 'issue-tracker') => JSON.parse(readFileSync(join(home, '.central-knot/plugins.json'), 'utf8')).plugins.find(each => each.plugin === plugin);
  const a = await launch(data, [], tools);
  same('the marketplace is added', await a.run(`window.centralKnot.addMarketplace(${JSON.stringify(market)}).then(result => result.problem ?? 'added')`), 'added');
  await a.click('#nav-plugins');
  for (let tries = 0; tries < 50 && !(await a.exists('#pswitch-0-issue-tracker')); tries++) await wait(100);
  const marks = (plugin = 'issue-tracker') => a.run(`[...document.querySelectorAll('[data-plugin="${plugin}"] .cell-button')].map(cell => cell.dataset.state)`);
  const switchIs = selector => a.run(`(() => { const s = document.querySelector('${selector}'); return s ? s.getAttribute('aria-checked') + (s.classList.contains('switch-partial') ? ' partial' : '') : 'missing'; })()`);
  const done = async () => { for (let tries = 0; tries < 100 && await a.run(`document.body.dataset.busy`) === 'true'; tries++) await wait(100); await a.settle(); };
  const pictures = async name => { if (!shots) return; for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) { await sizeTo(a, width, height); await a.shot(`${name}-${width}`); } await fullSize(a); };
  same('off, it is in no tool: its switch is off and each tool’s mark empty', [await switchIs('#pswitch-0-issue-tracker'), await marks()], ['false', ['absent', 'absent']]);
  // On, from the list: Claude Code by its own command, Pi by its items (library items linked to the plugin), at once.
  await a.click('#pswitch-0-issue-tracker');
  await done();
  same('On installs it in Claude Code with its own command and puts its items in Pi', [calls(), installed(), inPi(), await marks(), await switchIs('#pswitch-0-issue-tracker')],
    [['plugin marketplace add ' + market, 'plugin install issue-tracker@ck-test-market --scope user'], true, [true, true], ['installed', 'items'], 'true']);
  check('the result says what the switch did, with Undo', /issue-tracker: installed in Claude Code; its items put in Pi\./.test(await a.text('#plugins-result') ?? '') && await a.exists('#plugins-undo'), await a.text('#plugins-result'));
  same('the home records it On, kept out of nothing', [entry()?.on, entry()?.except], [true, []]);
  await pictures('plugin-switch-list');
  // The first link to one of its items, before Skills was ever drawn, opens Skills with that row open.
  await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 50 && !(await a.exists('.plugin-items-list [data-key="skill:triage"] button')); tries++) await wait(100);
  await a.click('.plugin-items-list [data-key="skill:triage"] button');
  same('the first link to triage, before Skills was drawn, opens it with triage’s row open', await a.all('.ov-row.open', 'e.dataset.key'), [rowPart('', 'skills', 'triage')]);
  // Its items are rows of the item pages, from the plugin: one row each, Claude Code's copy (the plugin's) folded in.
  await a.click('#nav-skills');
  check('triage is one row on Skills, “from the plugin issue-tracker”, and Claude Code has it with the plugin', /from the plugin issue-tracker/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'triage')}"]`) ?? '')
    && !(await a.exists(`.ov-row[data-key="${rowPart('', 'skills', 'issue-tracker@ck-test-market/triage')}"]`)), await a.text('.page'));
  await a.click('#nav-mcp');
  check('issues is one row on MCP servers, from the plugin too', /from the plugin issue-tracker/.test(await a.text(`.ov-row[data-key="${rowPart('', 'mcp', 'issues')}"]`) ?? ''), await a.text('.page'));
  await a.click('#nav-plugins');
  if (!(await a.exists('.plugin-items-section'))) await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 50 && !/Its items/.test(await a.text('.plugin-page') ?? ''); tries++) await wait(100);
  check('its page lists its items for Pi', /Its items[\s\S]*skill triage[\s\S]*MCP server issues/.test(await a.text('.plugin-items-section') ?? ''), await a.text('.plugin-page'));
  // Changed in Pi, triage is let go: the person's own from then on, said once on Skills; an update of the plugin's issues still follows.
  writeFileSync(join(home, '.pi/agent/skills/triage/SKILL.md'), `${readFileSync(join(home, '.pi/agent/skills/triage/SKILL.md'), 'utf8')}\nMine.\n`);
  await a.click('#header-refresh');
  await a.click('#nav-skills');
  for (let tries = 0; tries < 50 && !/is your own now/.test(await a.text('.bands') ?? ''); tries++) await wait(100);
  check('changed in Pi, triage is his own now, said once', /triage is your own now: you changed it here, so it no longer follows the plugin issue-tracker/.test(await a.text('.bands') ?? '') && !/from the plugin/.test(await a.text(`.ov-row[data-key="${rowPart('', 'skills', 'triage')}"]`) ?? ''), await a.text('.bands'));
  writeFileSync(join(market, 'plugins/issue-tracker/.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp', '--v2'] } } }));
  // Plugins opens again on the page last shown there, issue-tracker's; Refresh reads the marketplace's change.
  await a.click('#nav-plugins');
  if (!(await a.exists('#plugin-back'))) await a.click('#popen-0-issue-tracker');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && !(await a.exists('#pupdate-0-issue-tracker')); tries++) await wait(100);
  check('its page says an update is ready for issues, and that triage is his own', /MCP server issues\s*An update is ready/.test(await a.text('.plugin-items-section') ?? '') && /skill triage\s*Not brought in: you have your own/.test(await a.text('.plugin-items-section') ?? ''), await a.text('.plugin-items-section'));
  await pictures('plugin-items-page');
  await a.click('#pupdate-0-issue-tracker');
  await done();
  same('Update brings issues up to date in Pi, and leaves triage as he has it', [(readNow(join(home, '.pi/agent/mcp.json')) ?? '').includes('--v2'), readFileSync(join(home, '.pi/agent/skills/triage/SKILL.md'), 'utf8').includes('Mine.')], [true, true]);
  await a.click('#plugin-back');
  // A tool's box, on its page: Pi unticked, Pi alone, at once; the switch is then partial, and the automatic updates leave it out.
  await a.click('#popen-0-issue-tracker');
  const box = tool => `#pbox-0-issue-tracker-${tool}`;
  const boxIs = tool => a.run(`(() => { const b = document.querySelector('${box(tool)}'); return b ? [b.getAttribute('aria-checked'), b.disabled, b.dataset.state] : null; })()`);
  for (let tries = 0; tries < 50 && !(await a.exists(box('pi-cli'))); tries++) await wait(100);
  same('each tool’s box is ticked where it is, and says what a click does', [await boxIs('claude-cli'), await boxIs('pi-cli'), /Click to take issue-tracker’s items out of Pi: it stays out until you tick it again\./.test(await a.run(`document.querySelector('${box('pi-cli')}').title`) ?? '')],
    [['true', false, 'installed'], ['true', false, 'items'], true]);
  await a.click(box('pi-cli'));
  await done();
  same('unticked, its items leave Pi alone (not triage, his own now), it is recorded, the row says so, and the switch shows partial', [inPi(), installed(), entry()?.except, await boxIs('pi-cli'), await a.text('.plugin-panel .plugin-click'), await switchIs('#pswitch-page-0-issue-tracker')],
    [[true, false], true, ['pi-cli'], ['false', false, 'absent'], 'Its items taken out of Pi', 'true partial']);
  const checked = calls().length;
  await a.run(`window.centralKnot.checkPluginUpdates().then(() => true)`);
  same('the automatic updates leave Pi out', [inPi(), calls().length, entry()?.except], [[true, false], checked, ['pi-cli']]);
  await pictures('plugin-switch-page');
  await fitsAtMinimum(a, 'a plugin’s page with a tool kept out');
  await a.click('#plugin-back');
  same('the list’s switch is partial too', await switchIs('#pswitch-0-issue-tracker'), 'true partial');
  await pictures('plugin-switch-list-partial');
  await fitsAtMinimum(a, 'the plugin list with a partial switch');
  // Off: out of every tool; the result says what its Undo can't put back.
  await a.click('#pswitch-0-issue-tracker');
  await done();
  same('Off uninstalls it from Claude Code; Pi stays kept out; the record is Off', [installed(), calls().at(-1), entry()?.on, entry()?.except, await marks()], [false, 'plugin uninstall issue-tracker@ck-test-market --scope user', false, ['pi-cli'], ['absent', 'absent']]);
  check('its result says Undo installs the marketplace’s copy as it is now', /uninstalled from Claude Code\..*Undo installs the marketplace’s copy as it is now\./.test(await a.text('#plugins-result') ?? ''), await a.text('#plugins-result'));
  await pictures('plugin-switch-off-result');
  await a.click('#plugins-undo');
  await done();
  same('Undo installs it again where it was, and the record is On, kept out of Pi; the focus is on its switch as Undo goes', [installed(), calls().at(-1), entry()?.on, entry()?.except, await switchIs('#pswitch-0-issue-tracker'), await a.run(`document.activeElement?.id`)], [true, 'plugin install issue-tracker@ck-test-market --scope user', true, ['pi-cli'], 'true partial', 'pswitch-0-issue-tracker']);
  // Taken out of Claude Code with its own command: nothing puts it back by itself; its box is empty, and a tick does.
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), '{"version":2,"plugins":{}}');
  const before = calls().length;
  await a.click('#header-refresh');
  await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 50 && (await boxIs('claude-cli'))?.[2] !== 'missing'; tries++) await wait(100);
  same('a plugin taken out by hand is said, not put back by itself: its box is empty', [calls().length, await boxIs('claude-cli')], [before, ['false', false, 'missing']]);
  await pictures('plugin-switch-missing');
  await a.click(box('claude-cli'));
  await done();
  same('a tick puts it back', [installed(), await boxIs('claude-cli')], [true, ['true', false, 'installed']]);
  // Unticked in Claude Code, the only tool that has it (Pi is kept out): the plugin's Off, kept out of Pi as before, so its On
  // brings it back to Claude Code. Then put back there with its own command: its box is ticked, and unticking takes it out.
  await a.click(box('claude-cli'));
  await done();
  same('unticking the only tool that has it turns the plugin Off, its except as it was', [installed(), entry()?.on, entry()?.except, await switchIs('#pswitch-page-0-issue-tracker')], [false, false, ['pi-cli'], 'false']);
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'issue-tracker@ck-test-market': [{ scope: 'user', installPath: copy, version: '2.0.0' }] } }));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && (await boxIs('claude-cli'))?.[2] !== 'stays'; tries++) await wait(100);
  same('an Off plugin a tool has again keeps a ticked box there', await boxIs('claude-cli'), ['true', false, 'stays']);
  await pictures('plugin-switch-take-out');
  await a.click(box('claude-cli'));
  await done();
  same('unticking takes it out there, and records nothing: the plugin is Off', [installed(), calls().at(-1), entry()?.on, entry()?.except], [false, 'plugin uninstall issue-tracker@ck-test-market --scope user', false, ['pi-cli']]);
  // Off, one box ticked: On in Claude Code alone, every other tool kept out, Pi too.
  await a.click(box('claude-cli'));
  await done();
  same('one tick on an Off plugin turns it On in that tool alone', [installed(), entry()?.on, entry()?.except, inPi(), await boxIs('pi-cli'), await switchIs('#pswitch-page-0-issue-tracker')],
    [true, true, ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'], [true, false], ['false', false, 'absent'], 'true partial']);
  // A plugin installed in Claude Code with its own command and no record here: its row offers Add.
  const helper = join(home, '.claude/plugins/cache/ck-test-market/release-helper/0.4.1');
  mkdirSync(join(helper, 'commands'), { recursive: true });
  writeFileSync(join(helper, 'commands/release-notes.md'), readFileSync(join(market, 'plugins/release-helper/commands/release-notes.md')));
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'release-helper@ck-test-market': [{ scope: 'user', installPath: helper, version: '0.4.1' }] } }));
  await a.click('#plugin-back');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && !(await a.exists('#padd-0-release-helper')); tries++) await wait(100);
  check('a plugin a tool has with no record here offers Add in its switch’s place', await a.exists('#padd-0-release-helper') && /installed outside Central Knot/.test(await a.run(`document.querySelector('#padd-0-release-helper')?.title`) ?? ''), await a.text('[data-plugin="release-helper"]'));
  await pictures('plugin-switch-add');
  await a.click('#popen-0-issue-tracker');
  // An install Claude Code refuses (its stand-in knows only issue-tracker): said in the problem band and on Claude Code's line.
  await a.click('#plugin-back');
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 50 && !(await a.exists('#pswitch-page-0-document-tools')); tries++) await wait(100);
  await a.click('#pswitch-page-0-document-tools');
  await done();
  same('a refused install is said, its box is empty for a tick to try again, and Pi has its items', [/Could not add the marketplace|Not installed/.test(await a.text('.plugin-problems') ?? ''), await a.run(`document.querySelector('.plugin-tool[data-tool="claude-cli"] .cell-box')?.dataset.state`),
    await a.run(`document.querySelector('#pbox-0-document-tools-claude-cli')?.disabled`), existsSync(join(home, '.pi/agent/skills/pdf-reader/SKILL.md'))], [true, 'missing', false, true]);
  await pictures('plugin-switch-failed');
  await fitsAtMinimum(a, 'a plugin’s page with an install that failed');
  // Two plugins clicked in a row without waiting: release-helper's Add, then starter-skills (Claude Code's stand-in takes 3 s over
  // it). The second waits its turn while the first runs, the first is read back as soon as it ends, and Skills stays usable.
  await a.click('#plugin-back');
  // Add, then its Undo: the plugin is found again, and the focus goes to its Add, the control its row has now.
  await a.click('#padd-0-release-helper'); await done();
  await a.click('#plugins-undo'); await done();
  same('the Undo of an Add leaves the focus on the row’s Add again', [await a.exists('#padd-0-release-helper'), await a.run(`document.activeElement?.id`)], [true, 'padd-0-release-helper']);
  writeFileSync(join(home, 'slow'), '');
  await a.run(`document.querySelector('#padd-0-release-helper').click(); document.querySelector('#pswitch-0-starter-skills').click()`);
  const rowSays = name => a.run(`document.querySelector('[data-plugin="${name}"] .plugin-click')?.dataset.click ?? 'nothing'`);
  same('the second click waits its turn while the first runs, and another plugin’s switch stays usable', [await rowSays('release-helper'), await rowSays('starter-skills'), await a.exists('#pswitch-0-issue-tracker:not([disabled]):not([aria-disabled])')], ['running', 'waiting', true]);
  for (let tries = 0; tries < 50 && await rowSays('starter-skills') !== 'running'; tries++) await wait(100);
  same('the first is read back as soon as it ends: its row says so, and its switch is On and free while the second runs', [await rowSays('release-helper'), await switchIs('#pswitch-0-release-helper:not([disabled]):not([aria-disabled])'), await rowSays('starter-skills')], ['ended', 'true', 'running']);
  check('a control the list turns off says why', await a.run(`document.querySelector('#open-add-marketplace')?.title`) === 'Waits until the switches clicked are done.', await a.run(`document.querySelector('#open-add-marketplace')?.outerHTML`));
  await a.run(`document.querySelector('#nav-skills').click()`);
  check('an item page’s switch can be used meanwhile', await a.run(`!!document.querySelector('#${rowPart('switch', 'skills', 'triage')}[aria-checked="true"]:not([disabled])')`), await a.text('.page'));
  await a.run(`document.querySelector('#${rowPart('switch', 'skills', 'triage')}').click()`);
  await done();
  rmSync(join(home, 'slow'));
  const both = JSON.parse(readFileSync(join(home, '.claude/plugins/installed_plugins.json'), 'utf8')).plugins;
  same('both end installed, and the item page’s click ran', [!!both['release-helper@ck-test-market'], !!both['starter-skills@ck-test-market'], entry('release-helper')?.on, entry('starter-skills')?.on,
    existsSync(join(home, '.pi/agent/skills/hello/SKILL.md')), await a.run(`document.querySelector('#${rowPart('switch', 'skills', 'triage')}').getAttribute('aria-checked')`)], [true, true, true, true, true, 'false']);
  await a.click('#nav-plugins');
  same('each row shows its switch On, its marks, and its own result', [await switchIs('#pswitch-0-release-helper'), await switchIs('#pswitch-0-starter-skills'), await marks('release-helper'), await marks('starter-skills'), await rowSays('release-helper'), await rowSays('starter-skills')],
    ['true', 'true', ['installed', 'items'], ['installed', 'items'], 'ended', 'ended']);
  same('no page errors, a plugin’s switch', a.pageErrors, []);
  await a.quit();
}

/**
 * A click never moves a row (itemrow.ts Pinned), on lists long enough to scroll: MCP servers, then Plugins. A switch clicked in
 * the middle leaves the scroll and the next row's place on screen as they were, and a redraw after he scrolls on leaves his
 * scroll alone; five rows clicked one after another, each where it was before the first click, are the five that change; the
 * next visit, a plugin's page and back, and Refresh put every row in its place in the order again.
 */
async function rowsKeepTheirPlacesFlow() {
  const home = join(scratch, 'home-rows'), data = join(scratch, 'rows-data'), market = join(scratch, 'market-rows'), tools = join(scratch, 'tools-rows');
  const numbered = prefix => Array.from({ length: 40 }, (_, at) => `${prefix}-${String(at + 1).padStart(2, '0')}`);
  const servers = numbered('srv'), plugins = numbered('plug'), found = ['fnd-a', 'fnd-b', 'fnd-c', 'fnd-d'], claudeJson = join(home, '.claude.json');
  // Claude Code holds 40 servers and 4 more found there; a folder marketplace lists 40 plugins (plug-08 with no description and nothing in it),
  // and Claude Code's stand-in installs them on files alone, but for plug-07, -13, -14 and -16, whose installs fail with a long reason.
  mkdirSync(join(home, '.claude'), { recursive: true });
  const addServers = (...names) => { const now = existsSync(claudeJson) ? JSON.parse(readFileSync(claudeJson, 'utf8')) : {}; writeFileSync(claudeJson, JSON.stringify({ ...now, mcpServers: { ...now.mcpServers, ...Object.fromEntries(names.map(name => [name, { command: name, args: [] }])) } })); };
  addServers(...servers, ...found);
  // Six agents in Claude Code: a list too short to scroll.
  const agents = ['ag-1', 'ag-2', 'ag-3', 'ag-4', 'ag-5', 'ag-6'];
  for (const agent of agents) { mkdirSync(join(home, '.claude/agents'), { recursive: true }); writeFileSync(join(home, '.claude/agents', `${agent}.md`), `---\nname: ${agent}\ndescription: The ${agent} agent.\n---\n\nPrompt.\n`); }
  for (const plugin of plugins) if (plugin === 'plug-08') mkdirSync(join(market, 'plugins', plugin), { recursive: true }); else skill(join(market, 'plugins', plugin, 'skills'), `${plugin}-skill`);
  mkdirSync(join(market, '.claude-plugin'), { recursive: true });
  writeFileSync(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'rows-market', owner: { name: 'Rows' }, plugins: plugins.map(name => ({ name, source: `./plugins/${name}`, version: '1.0.0', ...(name === 'plug-08' ? {} : { description: `The ${name} plugin.` }) })) }));
  mkdirSync(join(tools, '.local/bin'), { recursive: true });
  writeFileSync(join(tools, '.local/bin/claude'), `#!${process.execPath}
const fs = require('fs'), dir = process.env.HOME + '/.claude/plugins', record = dir + '/installed_plugins.json', [, verb, id] = process.argv.slice(2);
if (process.argv[2] === '--version') { console.log('2.1.322 (Claude Code)'); process.exit(0); }
if (fs.existsSync(process.env.HOME + '/slow')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
while (fs.existsSync(process.env.HOME + '/hold')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
fs.mkdirSync(dir, { recursive: true });
const now = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : { version: 2, plugins: {} };
if (verb === 'marketplace') fs.writeFileSync(dir + '/known_marketplaces.json', JSON.stringify({ 'rows-market': { source: { source: 'git', url: process.argv[5] } } }));
else if (/^plug-(07|13|14|16)@/.test(id ?? '') || fs.existsSync(process.env.HOME + '/fail-' + (id ?? '').split('@')[0])) { console.error('Error: failed to install plugin ' + id + ': the marketplace entry points at a folder whose plugin manifest could not be parsed (unexpected token at line 3, column 14); fix the manifest and try again.'); process.exit(1); }
else if (verb === 'install') now.plugins[id] = [{ scope: 'user', installPath: ${JSON.stringify(market)} + '/plugins/' + id.split('@')[0], version: '1.0.0' }];
else if (verb === 'uninstall') delete now.plugins[id];
else process.exit(9);
fs.writeFileSync(record, JSON.stringify(now));
`, { mode: 0o755 });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home }, closeExplained: true }));
  const a = await launch(data, [], tools);
  await sizeTo(a, 1280, 800);
  // Every server taken in, the last two Off; every third plugin On: through the page's own calls.
  const apply = changes => a.run(`window.centralKnot.applyServers(${JSON.stringify(changes)}, false, ${JSON.stringify(home)}).then(() => true)`);
  await apply(servers.map(key => ({ key, on: true, except: [] })));
  await apply(['srv-39', 'srv-40'].map(key => ({ key, on: false, except: [] })));
  await a.run(`window.centralKnot.applyAgents(${JSON.stringify(agents.map(key => ({ key, on: true, except: [] })))}, false, ${JSON.stringify(home)}).then(() => true)`);
  same('the marketplace is added', await a.run(`window.centralKnot.addMarketplace(${JSON.stringify(market)}).then(result => result.problem ?? 'added')`), 'added');
  const installedFirst = plugins.filter((_, at) => at % 3 === 2);
  for (const plugin of installedFirst) await a.run(`window.centralKnot.turnPlugin(${JSON.stringify(market)}, ${JSON.stringify(plugin)}, 'on', undefined, ${JSON.stringify(home)}).then(() => true)`);
  await a.click('#header-refresh');

  /** A list's scroll and its top on screen (a band above it moves it), and each row's place on screen (px from the window's top), by its `attr` (an item row's data-key, its row id; a plugin's data-plugin). */
  const placesNow = (list, attr) => a.run(`(() => { const list = document.getElementById(${JSON.stringify(list)}); return { scroll: Math.round(list.scrollTop), top: Math.round(list.getBoundingClientRect().top), at: Object.fromEntries([...list.querySelectorAll('[${attr}]')].map(row => [row.getAttribute('${attr}'), Math.round(row.getBoundingClientRect().top)])) }; })()`);
  const putAt = (list, selector, y) => a.run(`(() => { const list = document.getElementById(${JSON.stringify(list)}); list.scrollTop += document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top - list.getBoundingClientRect().top - ${y}; return true; })()`);
  const middleOf = selector => a.run(`(() => { const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)]; })()`);
  /** A pointer's click at a point on screen: the control there takes the focus, as under a real hand. */
  const clickAt = async ([x, y]) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await a.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); };
  const states = rows => a.run(`Object.fromEntries([...document.querySelectorAll(${JSON.stringify(rows)})].map(row => [row.dataset.key ?? row.dataset.plugin, row.querySelector('.switch')?.getAttribute('aria-checked') ?? null]))`);
  const changed = (before, after) => Object.keys(after).filter(key => before[key] !== after[key]);
  const focused = () => a.run(`document.activeElement?.id`);
  const done = async () => { for (let tries = 0; tries < 300 && await a.run(`document.body.dataset.busy`) === 'true'; tries++) await wait(100); await a.settle(); };
  const headerSays = () => a.text('#header [data-outcome] .band-text');
  /** While `hold` is there, Claude Code's stand-in waits before any plugin command: a plugin click stays running, however long. */
  const hold = () => writeFileSync(join(home, 'hold'), ''), letGo = () => rmSync(join(home, 'hold'), { force: true });
  /**
   * Holds the page's run of clicks open, however far apart the clicks after it land: a click on plug-03's skill on Skills, whose
   * command waits (hold), so each click made after it waits its turn behind it. Let go, it fails (the stand-in has no disable)
   * and changes nothing. It ends on MCP servers, the list at its top.
   */
  const holdRun = async () => {
    hold();
    await a.click('#nav-skills');
    await a.run(`document.querySelector('.ov-row[data-key$="/plug-03-skill"] .switch').click()`);
    await a.run(`document.getElementById('nav-mcp').click()`);
    for (let tries = 0; tries < 50 && !(await a.exists(`#${rowPart('switch', 'mcp', 'srv-30')}`)); tries++) await wait(100);
  };
  const letRunGo = async () => { letGo(); await done(); };

  // A list too short to scroll, on a fresh visit: four rows clicked 150 ms apart, each where it was before the first click, are the
  // four that change, each Off in every tool, no row moves, and the header says the four once: clicks made while the run's result is
  // on screen are one run, however far apart they land.
  await a.click('#nav-agents');
  const sixBefore = await placesNow('table-agents', 'data-key'), sixStates = await states('.ov-row[data-key]'), sixPoints = [];
  for (const agent of agents.slice(0, 4)) sixPoints.push(await middleOf(`#${rowPart('switch', 'agents', agent)}`));
  for (const point of sixPoints) { await clickAt(point); await wait(150); }
  await done();
  const sixAfter = await placesNow('table-agents', 'data-key');
  await a.shot('rows-agents-short');
  same('on a list of six, four clicks 150 ms apart change exactly the four rows aimed at, Off in every tool, no row moves, and the header says the four once',
    [changed(sixStates, await states('.ov-row[data-key]')), agents.map(agent => existsSync(join(home, '.claude/agents', `${agent}.md`))), agents.map(agent => sixAfter.at[rowPart('', 'agents', agent)]), await headerSays()],
    [agents.slice(0, 4).map(agent => rowPart('', 'agents', agent)), [false, false, false, false, true, true], agents.map(agent => sixBefore.at[rowPart('', 'agents', agent)]), '4 agents are off: ag-1, ag-2, ag-3 and ag-4.']);
  // The last agent deleted from Central Knot: the page is empty, and the result is said once, in the header.
  for (const agent of agents) for (const id of [`#${rowPart('open', 'agents', agent)}`, `#${rowPart('delete', 'agents', agent)}`, `#${rowPart('delete-confirm', 'agents', agent)}`]) await a.click(id);
  same('the last agent deleted: the page is empty, and its result is said once, in the header', [await a.exists('.ov-row[data-key]'), await a.run(`document.querySelectorAll('[data-outcome]').length`), await a.exists('#header [data-outcome]')], [false, 1, true]);
  await a.click('#nav-mcp');
  const table = 'table-mcp', row = key => `.ov-row[data-key="${rowPart('', 'mcp', key)}"]`;
  // The two Off servers turned On, at the bottom of the list: they stay under Off, which counts none and says nothing of them.
  // Refresh, with the list at its top and that result's band above it, puts them under On.
  await putAt(table, row('srv-40'), 500);
  const offHeading = () => a.run(`Math.round(document.querySelector('.ov-section[data-section="off"]').getBoundingClientRect().height)`), offTall = await offHeading();
  for (const key of ['srv-39', 'srv-40']) { await clickAt(await middleOf(`#${rowPart('switch', 'mcp', key)}`)); await a.settle(); }
  await a.shot('rows-mcp-heading-no-note');
  same('MCP servers: rows turned On stay under Off, which says 0 and has no note, its room kept', [(await sectionsNow(a, 'mcp')).at(-1), await switchOn(a, 'mcp', 'srv-40'), await headingSays(a, 'off'), await offHeading()], [['off', ['srv-39', 'srv-40']], true, 'Off0', offTall]);
  await a.run(`document.getElementById('${table}').scrollTop = 0`);
  await a.click('#header-refresh');
  same('Refresh puts them under On', await sectionsNow(a, 'mcp'), [['on', servers], ['found', found]]);
  // Four rows at the top of a long list, the page's first clicks, 150 ms apart, each clicked where it was before the first: each
  // is drawn Off at once, they are the four that change, Off in every tool, no row moves, the scroll stays, and the header, which
  // keeps its height, says the four once.
  const atTop = ['srv-03', 'srv-04', 'srv-05', 'srv-06'], topPoints = [], topBefore = await placesNow(table, 'data-key'), topStates = await states('.ov-row[data-key]');
  for (const key of atTop) topPoints.push(await middleOf(`#${rowPart('switch', 'mcp', key)}`));
  const resultIn = () => a.run(`document.querySelector('#header [data-outcome]') ? 'header' : document.querySelector('[data-outcome]') ? 'elsewhere' : 'none'`), drawnAtOnce = [];
  // Sample in the renderer, from the idle draw of the fourth click. Screenshots and CDP round trips can take
  // part of the result's eight seconds before the driver even gets to its assertion.
  const fourOff = '4 MCP servers are off: srv-03, srv-04, srv-05 and srv-06.';
  await a.run(`(() => {
    const result = () => document.querySelector('#header [data-outcome] .band-text')?.textContent;
    const ended = new MutationObserver(() => {
      if (document.body.dataset.busy === 'true' || result() !== ${JSON.stringify(fourOff)}) return;
      ended.disconnect();
      setTimeout(() => { window.ckResultAtSevenSeconds = result(); }, 7000);
    });
    ended.observe(document.body, { attributes: true, attributeFilter: ['data-busy'] });
  })()`);
  for (const point of topPoints) { await clickAt(point); drawnAtOnce.push(await a.run(`document.activeElement?.getAttribute('aria-checked')`)); await wait(150); }
  await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await done();
  await a.shot('rows-mcp-top');
  const topAfter = await placesNow(table, 'data-key'), inClaude = () => Object.keys(JSON.parse(readFileSync(claudeJson, 'utf8')).mcpServers ?? {});
  same('at the top of a long list, four rows clicked 150 ms apart are drawn Off at once and are the four that change, Off in every tool; no row moves, the scroll stays, and the header says the four once',
    [drawnAtOnce, changed(topStates, await states('.ov-row[data-key]')), atTop.filter(key => inClaude().includes(key)), ['srv-03', 'srv-08'].map(key => topAfter.at[rowPart('', 'mcp', key)]), topAfter.scroll, await resultIn(), await headerSays()],
    [atTop.map(() => 'false'), atTop.map(key => rowPart('', 'mcp', key)), [], ['srv-03', 'srv-08'].map(key => topBefore.at[rowPart('', 'mcp', key)]), topBefore.scroll, 'header', fourOff]);
  // A result with no problem goes by itself 8 seconds after the run's last click, and no row moves when it goes.
  const headerResult = '#header .header-result', deadline = performance.now() + 30000;
  while (await a.exists(headerResult) && performance.now() < deadline) await wait(100);
  same('the result is still in the header seven seconds after the last click ends', await a.run('window.ckResultAtSevenSeconds'), fourOff);
  same('a result with no problem goes by itself, and every row is where it was, to the pixel',
    [await a.exists(headerResult), await placesNow(table, 'data-key')], [false, topAfter]);
  await a.click('#nav-overview'); await a.click('#nav-mcp');
  // A switch in the middle of the list, the page's first click: its result comes in the header, and the list and its rows stay.
  await putAt(table, row('srv-20'), 300);
  const before = await placesNow(table, 'data-key');
  await a.shot('rows-mcp-before');
  await clickAt(await middleOf(`#${rowPart('switch', 'mcp', 'srv-20')}`)); await a.settle();
  const after = await placesNow(table, 'data-key');
  await a.shot('rows-mcp-after');
  same('a switch clicked in the middle moves nothing: the list, its scroll and the next row’s place on screen are as they were, the row drawn Off under On, the focus on its switch, the result in the header',
    [after.top, after.scroll, after.at[rowPart('', 'mcp', 'srv-21')], after.at[rowPart('', 'mcp', 'srv-20')], await switchOn(a, 'mcp', 'srv-20'), (await sectionsNow(a, 'mcp'))[0][1].includes('srv-20'), await focused(), await resultIn()],
    [before.top, before.scroll, before.at[rowPart('', 'mcp', 'srv-21')], before.at[rowPart('', 'mcp', 'srv-20')], false, true, rowPart('switch', 'mcp', 'srv-20'), 'header']);
  // He scrolls on, past it; a background refresh (a server added to Claude Code's file) draws the page again: his scroll stays,
  // the focus goes back on srv-20's switch without scrolling to it, and the new server goes where the order puts it.
  await a.run(`document.getElementById('${table}').scrollTop += 600`);
  const scrolled = (await placesNow(table, 'data-key')).scroll;
  addServers('new-server');
  for (let tries = 0; tries < 80 && !(await a.exists(row('new-server'))); tries++) await wait(100);
  same('a background refresh after he scrolls on leaves his scroll alone, the focus on that switch, and the new server under Found', [(await placesNow(table, 'data-key')).scroll, await focused(), (await sectionsNow(a, 'mcp')).find(([role]) => role === 'found')?.[1]], [scrolled, rowPart('switch', 'mcp', 'srv-20'), [...found, 'new-server']]);
  // Five rows, one after another, each clicked where it was on screen before the first click.
  await putAt(table, row('srv-22'), 200);
  const five = ['srv-22', 'srv-23', 'srv-24', 'srv-25', 'srv-26'], points = [];
  for (const key of five) points.push(await middleOf(`#${rowPart('switch', 'mcp', key)}`));
  const statesBefore = await states('.ov-row[data-key]');
  for (const point of points) { await clickAt(point); await a.settle(); }
  await a.shot('rows-mcp-five');
  same('five rows clicked one after another, each where it was before the first click, are the five that change', changed(statesBefore, await states('.ov-row[data-key]')), five.map(key => rowPart('', 'mcp', key)));
  // Sorted by Last updated, Add on a found server in the middle of Found: Add gives it a time, and it keeps its place all the same.
  // In the smallest window, where the Found heading's note takes two lines: hidden over a row now On, it keeps its room.
  const sortBy = async value => { await a.run(`(() => { const select = document.querySelector('#item-order'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change')); })()`); await a.settle(); };
  await sortBy('updated');
  await sizeTo(a, ...SMALLEST);
  await putAt(table, row('fnd-b'), 150);
  const foundBefore = await placesNow(table, 'data-key');
  await clickAt(await middleOf(`#${rowPart('add', 'mcp', 'fnd-b')}`)); await a.settle();
  const foundAfter = await placesNow(table, 'data-key');
  same('sorted by Last updated, a found server taken in by its Add keeps its place among its neighbours', [await switchOn(a, 'mcp', 'fnd-b'), [...found, 'new-server'].map(key => foundAfter.at[rowPart('', 'mcp', key)])],
    [true, [...found, 'new-server'].map(key => foundBefore.at[rowPart('', 'mcp', key)])]);
  // So does a server with a time of its own, turned Off.
  await putAt(table, row('srv-10'), 150);
  const timedBefore = await placesNow(table, 'data-key');
  await clickAt(await middleOf(`#${rowPart('switch', 'mcp', 'srv-10')}`)); await a.settle();
  const timedAfter = await placesNow(table, 'data-key');
  same('…and so does a server with a time, turned Off', [await switchOn(a, 'mcp', 'srv-10'), ['srv-10', 'srv-11'].map(key => timedAfter.at[rowPart('', 'mcp', key)])], [false, ['srv-10', 'srv-11'].map(key => timedBefore.at[rowPart('', 'mcp', key)])]);
  await sizeTo(a, 1280, 800);
  await sortBy('name');
  // The next visit, then Refresh, put every row under its own heading.
  const offNow = [...atTop, 'srv-10', 'srv-20', ...five];
  await a.click('#nav-overview'); await a.click('#nav-mcp');
  same('the next visit puts each row under its own heading', await sectionsNow(a, 'mcp'), [['on', ['fnd-b', ...servers.filter(key => !offNow.includes(key))]], ['found', ['fnd-a', 'fnd-c', 'fnd-d', 'new-server']], ['off', offNow]]);
  await clickAt(await middleOf(`#${rowPart('switch', 'mcp', 'srv-02')}`)); await a.settle();
  const pinnedThere = (await sectionsNow(a, 'mcp'))[0][1].includes('srv-02') && !(await switchOn(a, 'mcp', 'srv-02'));
  await a.click('#header-refresh');
  same('a row turned Off stays under On until Refresh, which puts it under Off', [pinnedThere, (await sectionsNow(a, 'mcp')).at(-1)], [true, ['off', ['srv-02', ...offNow].sort()]]);

  // Clicks behind one that still runs (holdRun) wait their turn. Clicked again while its click waits, a row is taken back at once,
  // and nothing is written for it.
  await holdRun();
  await putAt(table, row('srv-30'), 200);
  const [at30, at31] = [await middleOf(`#${rowPart('switch', 'mcp', 'srv-30')}`), await middleOf(`#${rowPart('switch', 'mcp', 'srv-31')}`)], entry31 = () => JSON.stringify(JSON.parse(readFileSync(claudeJson, 'utf8')).mcpServers['srv-31']);
  const was31 = entry31();
  await clickAt(at30); await clickAt(at31);
  const drawnOff = await switchOn(a, 'mcp', 'srv-31');
  await clickAt(at31);
  const drawnBack = await switchOn(a, 'mcp', 'srv-31');
  await letRunGo();
  same('clicked again while its click waits, a row is taken back: drawn as it was at once, and nothing is written for it', [drawnOff, drawnBack, await switchOn(a, 'mcp', 'srv-31'), entry31(), inClaude().includes('srv-30')], [false, true, true, was31, false]);
  // Clicked twice, 150 ms apart: whether the second lands while the first runs or after it, the row ends as the second says, and
  // nothing is refused (the second asks from the state its row was drawn in).
  const at33 = await middleOf(`#${rowPart('switch', 'mcp', 'srv-33')}`);
  await clickAt(at33); await wait(150); await clickAt(at33); await done();
  same('clicked twice, a row ends as the second click says, and nothing is refused, however far apart the clicks land', [await switchOn(a, 'mcp', 'srv-33'), inClaude().includes('srv-33'), await a.exists('#header .problem-line')], [true, true, false]);
  // Three clicks, the second refused in its turn: srv-35 is turned Off behind the page's back (as another window would) before its
  // click runs, so its click, made from the page as it was, is refused. The first and third are done; its row shows what is true.
  // The change behind the page's back waits in main's queue behind the click that holds the run, so it lands before srv-35's turn.
  await holdRun();
  await putAt(table, row('srv-34'), 200);
  const three = ['srv-34', 'srv-35', 'srv-36'], threePoints = [];
  for (const key of three) threePoints.push(await middleOf(`#${rowPart('switch', 'mcp', key)}`));
  for (const point of threePoints) { await clickAt(point); await wait(150); }
  await a.run(`void window.centralKnot.applyServers([{ key: 'srv-35', on: false, except: [] }], false, ${JSON.stringify(home)})`);
  await letRunGo();
  await a.shot('rows-mcp-one-refused');
  same('three clicks where the second is refused: the first and third are done, its row is as it truly is, and the header’s problem line names it',
    [three.map(key => inClaude().includes(key)), await switchOn(a, 'mcp', 'srv-35'), await headerSays(), await a.all('#header .problem-text')], [[false, false, false], false, '2 MCP servers are off: srv-34 and srv-36.', ['srv-35 changed since the page was read. Nothing was changed; read again.']]);
  // The run's one result at the four sizes: it stays (it has a problem line), so it is pictured whole.
  for (const [width, height] of [SMALLEST, [1728, 1117], [2560, 1440], [1280, 800]]) { await sizeTo(a, width, height); await a.shot(`rows-mcp-run-result-${width}`); }
  await wait(9000);
  check('a result with a problem line stays past the 8 seconds', await a.exists('#header .problem-line'));
  await a.run(`document.querySelector('#outcome-dismiss')?.click()`);
  // A run left for another page carries on there; its result is said in the status bar, never in that page's header.
  // Instructions read once first: while a run holds main, the page shows that read (a page keeps its data while it reads again).
  await a.click('#nav-instructions');
  for (let tries = 0; tries < 50 && !(await a.exists('#ins-edit-claude-cli')); tries++) await wait(100);
  await holdRun();
  await putAt(table, row('srv-37'), 200);
  await clickAt(await middleOf(`#${rowPart('switch', 'mcp', 'srv-37')}`));
  // Meanwhile every write is off, saying why, on the pages beside the lists too.
  const offWhy = async (page, selector) => {
    await a.run(`document.getElementById('${page}').click()`);
    for (let tries = 0; tries < 50 && !(await a.exists(selector)); tries++) await wait(100);
    return a.run(`(() => { const control = document.querySelector('${selector}'); return [control?.disabled, control?.title]; })()`);
  };
  same('while clicks run, Settings’ Synchronize everything and Instructions’ Edit are off, and say why', [await offWhy('nav-settings', '#sync-everything-on'), await offWhy('nav-instructions', '#ins-edit-claude-cli')],
    [[true, 'Waits until the switches clicked are done.'], [true, 'Waits until the switches clicked are done.']]);
  await a.run(`document.getElementById('nav-agents').click()`);
  await letRunGo();
  same('a run left for Agents: its result is in the status bar, never in the Agents header', [await a.exists('#header [data-outcome]'), (await a.text('#announcement'))?.startsWith('srv-37 is off')], [false, true]);
  await a.click('#nav-mcp');
  // A press on a switch whose release comes after a redraw replaced it (another switch clicked between) still counts.
  await putAt(table, row('srv-38'), 200);
  const [x38, y38] = await middleOf(`#${rowPart('switch', 'mcp', 'srv-38')}`);
  await a.run(`document.getElementById('${rowPart('switch', 'mcp', 'srv-38')}').dataset.pressed = 'yes'`);
  for (const type of ['mouseMoved', 'mousePressed']) await a.send('Input.dispatchMouseEvent', { type, x: x38, y: y38, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await a.run(`document.getElementById('${rowPart('switch', 'mcp', 'srv-32')}').click()`);
  const redrawn = await a.run(`document.getElementById('${rowPart('switch', 'mcp', 'srv-38')}').dataset.pressed !== 'yes'`);
  await a.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x38, y: y38, button: 'left', clickCount: 1 });
  await done();
  same('a press released after a redraw replaced its switch still counts as its click', [redrawn, await switchOn(a, 'mcp', 'srv-38'), await switchOn(a, 'mcp', 'srv-32')], [true, false, false]);

  // What the header says in the smallest window. An ordinary result fits in the header: Find and Sort are whole under it. The
  // last result closed first, so the click below is a run of its own.
  await a.run(`document.querySelector('#outcome-dismiss')?.click()`);
  await sizeTo(a, ...SMALLEST);
  await a.run(`document.getElementById('${table}').scrollTop = 0`);
  const firstOn = (await sectionsNow(a, 'mcp'))[0][1][0], reaches = selector => a.run(`(() => { const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(), at = document.elementFromPoint(box.left + box.width / 2, box.top + 2); return !!at?.closest(${JSON.stringify(selector)}); })()`);
  await clickAt(await middleOf(`#${rowPart('switch', 'mcp', firstOn)}`)); await a.settle();
  same('an ordinary result fits in the header: the top edges of Find and Sort take their own clicks', [await reaches('.find input'), await reaches('#item-order')], [true, true]);
  // Claude Code's file held by its lock: the result says what happened and where, and the reason once, under it.
  const lock = `${claudeJson}.lock`, header = () => a.text('#header .header-result'), sentence = () => a.text('#header [data-outcome] .band-text'), reasonsIn = async () => ((await header()) ?? '').split('locked').length - 1;
  /** A click on a control of this round's, which may not be there (the check after it then fails). */
  const press = async selector => { await a.run(`document.querySelector(${JSON.stringify(selector)})?.click()`); await done(); };
  mkdirSync(lock); const holdLock = setInterval(() => { const now = new Date(); utimesSync(lock, now, now); }, 1000);
  try {
  const firstRowTop = () => a.run(`Math.round(document.querySelector('#${table} .ov-row[data-key]').getBoundingClientRect().top)`), resultBottom = () => a.run(`Math.round(document.querySelector('#header .header-result').getBoundingClientRect().bottom)`);
  await a.click('#outcome-undo'); await done();
  same('an Undo Claude Code can’t take: the reason once, and the result ends above the first row', [await reasonsIn(), (await resultBottom()) < (await firstRowTop())], [1, true]);
  await putAt(table, row('srv-02'), 200);
  await clickAt(await middleOf(`#${rowPart('switch', 'mcp', 'srv-02')}`)); await done();
  const lineCut = () => a.run(`[...document.querySelectorAll('#header .problem-text')].some(text => text.scrollWidth > text.clientWidth)`);
  const expanded = () => a.run(`document.querySelector('#problems-show-all')?.getAttribute('aria-expanded')`);
  same('a click no tool took: the sentence says so, with no reason; the reason once, cut to its line, with Show all', [await sentence(), await reasonsIn(), await lineCut(), await a.text('#problems-show-all'), await expanded()], ['srv-02 is not on in any tool yet.', 1, true, 'Show all', 'false']);
  await press('#problems-show-all');
  same('Show all: the reason whole, then Show less', [await lineCut(), await a.text('#problems-show-all'), await expanded()], [false, 'Show less', 'true']);
  await press('#outcome-dismiss');
  } finally { clearInterval(holdLock); rmSync(lock, { recursive: true }); }
  await sizeTo(a, 1280, 800);

  await a.click('#nav-plugins');
  for (let tries = 0; tries < 50 && !(await a.exists('#pswitch-0-plug-20')); tries++) await wait(100);
  const list = 'plugins-scroll', order = () => a.all('[data-plugin]', 'e.dataset.plugin');
  // The marketplace's Find keeps its caret where he types: a letter typed in the middle of a word, across the redraw it makes;
  // and in a long query, across another redraw, the caret and the box's sideways scroll stay where they were.
  const findNow = () => a.run(`(() => { const box = document.querySelector('#plugin-find'); return [box.value, box.selectionStart, Math.round(box.scrollLeft)]; })()`);
  await a.run(`(() => { const box = document.querySelector('#plugin-find'); box.focus(); box.value = 'pug'; box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.run(`document.querySelector('#plugin-find').setSelectionRange(1, 1)`);
  await a.send('Input.insertText', { text: 'l' });
  await a.settle();
  same('Plugins’ Find: a letter typed in the middle of a word leaves the caret after it', (await findNow()).slice(0, 2), ['plug', 2]);
  await a.run(`(() => { const box = document.querySelector('#plugin-find'); box.value = 'plug ' + 'a long query that runs past the box '.repeat(6); box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.run(`(() => { const box = document.querySelector('#plugin-find'); box.setSelectionRange(125, 125); box.blur(); box.focus(); })()`);
  const longFind = await findNow(), [findRedrawn] = await redrawUnder(a, '#plugin-find');
  same('…and in a long query a redraw keeps the caret and the sideways scroll', [findRedrawn, longFind[2] > 0, ...await findNow()], [true, true, ...longFind]);
  await a.run(`(() => { const box = document.querySelector('#plugin-find'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); box.blur(); })()`);
  await a.settle();
  // A first click, so the toolbar's result is there before the measured one, as it is when he works down a list.
  await putAt(list, '[data-plugin="plug-01"]', 300);
  await clickAt(await middleOf('#pswitch-0-plug-01')); await done();
  await putAt(list, '[data-plugin="plug-20"]', 300);
  const listed = await order(), next = listed[listed.indexOf('plug-20') + 1], pluginsBefore = await placesNow(list, 'data-plugin');
  await a.shot('rows-plugins-before');
  await clickAt(await middleOf('#pswitch-0-plug-20')); await done();
  const pluginsAfter = await placesNow(list, 'data-plugin');
  await a.shot('rows-plugins-after');
  same('Plugins: a switch clicked in the middle moves nothing: the list, its scroll, the order and the next row’s place are as they were, its switch, On, keeps the focus, and the result is in the header',
    [pluginsAfter.top, pluginsAfter.scroll, await order(), pluginsAfter.at[next], await a.run(`document.querySelector('#pswitch-0-plug-20').getAttribute('aria-checked')`), await focused(), await a.exists('#header #plugins-result')],
    [pluginsBefore.top, pluginsBefore.scroll, listed, pluginsBefore.at[next], 'true', 'pswitch-0-plug-20', true]);
  await a.run(`document.getElementById('${list}').scrollTop += 600`);
  const pluginsScrolled = (await placesNow(list, 'data-plugin')).scroll;
  await a.run(`document.getElementById('${list}').dataset.drawnBefore = 'yes'`);
  addServers('another-server');
  for (let tries = 0; tries < 80 && await a.run(`document.getElementById('${list}')?.dataset.drawnBefore === 'yes'`); tries++) await wait(100);
  same('a redraw after he scrolls on leaves his scroll alone, the focus on that switch', [(await placesNow(list, 'data-plugin')).scroll, await focused()], [pluginsScrolled, 'pswitch-0-plug-20']);
  // While its click runs (held), its switch is off yet keeps the focus. Claude Code's stand-in takes a second from here on.
  await putAt(list, '[data-plugin="plug-22"]', 300);
  writeFileSync(join(home, 'slow'), '');
  hold();
  await clickAt(await middleOf('#pswitch-0-plug-22'));
  same('while its click runs, a plugin’s switch is off and keeps the focus', [await a.run(`document.querySelector('#pswitch-0-plug-22').getAttribute('aria-disabled')`), await focused()], ['true', 'pswitch-0-plug-22']);
  letGo(); await done();
  // Five plugins clicked quickly, one after another, each where it was before the first click: they wait their turn in one
  // list, each row saying how its click stands in place of its line, so no row grows and none below moves. In the table's
  // narrow form (here) and its wide one (1728), where a row's line sits beside its name.
  const fiveQuickly = async from => {
    await putAt(list, `[data-plugin="${from}"]`, 200);
    const five = listed.slice(listed.indexOf(from), listed.indexOf(from) + 5), points = [], before = await states('[data-plugin]');
    for (const name of five) points.push(await middleOf(`#pswitch-0-${name}`));
    for (const point of points) { await clickAt(point); await wait(150); }
    await done();
    return [changed(before, await states('[data-plugin]')), five];
  };
  const fivePlugins = await fiveQuickly('plug-23');
  await a.shot('rows-plugins-five');
  same('five plugins clicked quickly one after another, each where it was before the first click, are the five that change', ...fivePlugins);
  await sizeTo(a, 1728, 1117);
  const fiveWide = await fiveQuickly('plug-31');
  same('…and so in the wide table', ...fiveWide);
  // A press on plug-24's switch, plug-30's switch clicked before the release (the list redrawn: plug-24's switch replaced), then the
  // release: still plug-24's click (judges/ci1-builder-report.md, "For the LIST step"). Both are put back after.
  await putAt(list, '[data-plugin="plug-24"]', 200);
  const pressedBefore = await states('[data-plugin]'), [x24, y24] = await middleOf('#pswitch-0-plug-24');
  await a.run(`document.getElementById('pswitch-0-plug-24').dataset.pressed = 'yes'`);
  for (const type of ['mouseMoved', 'mousePressed']) await a.send('Input.dispatchMouseEvent', { type, x: x24, y: y24, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await a.run(`document.getElementById('pswitch-0-plug-30').click()`);
  const replaced = await a.run(`document.getElementById('pswitch-0-plug-24').dataset.pressed !== 'yes'`);
  await a.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x24, y: y24, button: 'left', clickCount: 1 });
  await done();
  same('a press on a plugin’s switch released after a redraw replaced it still counts: plug-24 and plug-30 both change', [replaced, changed(pressedBefore, await states('[data-plugin]'))], [true, ['plug-24', 'plug-30']]);
  for (const name of ['plug-24', 'plug-30']) await a.run(`document.getElementById('pswitch-0-${name}').click()`);
  await done();
  // A list of four clicks, one failing (a plugin of its own at each size) and one on a plugin with no description (plug-08), at
  // each of the four sizes: every row is as tall while its click waits and runs, and after it ends or fails, as before it.
  const heights = () => a.run(`Object.fromEntries([...document.querySelectorAll('[data-plugin]')].map(row => [row.dataset.plugin, Math.round(row.getBoundingClientRect().height)]))`);
  const tall = [];
  const failing = { 860: 'plug-07', 1280: 'plug-13', 1728: 'plug-14', 2560: 'plug-16' }, clicked = width => [failing[width], 'plug-08', 'plug-10', 'plug-11'];
  for (const [width, height] of [SMALLEST, [1280, 800], [1728, 1117], [2560, 1440]]) {
    await sizeTo(a, width, height);
    await putAt(list, '[data-plugin="plug-07"]', 80);
    // The last size's result closed, so these four are a run of their own, whose rows' notes are theirs alone.
    await a.run(`document.querySelector('#header .band-dismiss')?.click()`);
    const heightsBefore = await heights();
    for (const name of clicked(width)) { await clickAt(await middleOf(`#pswitch-0-${name}`)); await wait(150); }
    const whileWaiting = await heights();
    for (let tries = 0; tries < 40 && !(await a.exists('[data-plugin="plug-08"] .plugin-click[data-click="ended"]')); tries++) await wait(100);
    await a.shot(`rows-plugins-states-${width}`);
    const whileRunning = await heights();
    await done();
    const noted = await a.all('[data-plugin] .plugin-click', 'e.closest("[data-plugin]").dataset.plugin + " " + e.dataset.click');
    tall.push([width, noted, ...[whileWaiting, whileRunning, await heights()].map(now => Object.keys(now).filter(name => now[name] !== heightsBefore[name]))]);
  }
  same('through a list of clicks with one failure, every row keeps its height, at the four sizes', tall, [SMALLEST, [1280], [1728], [2560]].map(([width]) => [width, clicked(width).sort().map(name => `${name} ended`), [], [], []]));
  await sizeTo(a, 1280, 800);
  // The list at its top: the last run's failure closed by its ×, it goes from the header and the rows stay where they are.
  await a.run(`document.getElementById('${list}').scrollTop = 0`);
  const atItsTop = await placesNow(list, 'data-plugin'), bandBefore = await a.exists('.plugin-problems');
  await a.run(`document.querySelector('#header .band-dismiss')?.click()`); await a.settle();
  const afterClose = await placesNow(list, 'data-plugin');
  await clickAt(await middleOf('#pswitch-0-plug-06')); await done();
  const stillAtTop = await placesNow(list, 'data-plugin');
  same('at the top of the list, a failure that goes from the header moves no row, nor does the click after it', [bandBefore, await a.exists('.plugin-problems'), ['plug-06', 'plug-09'].map(name => afterClose.at[name]), ['plug-06', 'plug-09'].map(name => stillAtTop.at[name])],
    [true, false, ['plug-06', 'plug-09'].map(name => atItsTop.at[name]), ['plug-06', 'plug-09'].map(name => atItsTop.at[name])]);
  // Three failing plugins (plug-04, -05, -08) and one that installs (plug-10), in one list (each takes a second): one ×, two
  // reasons and Show all 3; shown, each reason whole; × closes it all.
  const failNow = ['plug-04', 'plug-05', 'plug-08'];
  for (const name of failNow) writeFileSync(join(home, `fail-${name}`), '');
  await putAt(list, '[data-plugin="plug-04"]', 20);
  const fourPoints = []; for (const name of ['plug-04', 'plug-05', 'plug-08', 'plug-10']) fourPoints.push(await middleOf(`#pswitch-0-${name}`));
  for (const point of fourPoints) { await clickAt(point); await wait(150); }
  for (let tries = 0; tries < 150 && await a.exists('.plugin-click:not([data-click="ended"])'); tries++) await wait(100);
  await done();
  for (const name of failNow) rmSync(join(home, `fail-${name}`));
  const plugReasons = () => a.run(`[...document.querySelectorAll('#header .problem-text')].map(text => text.scrollWidth > text.clientWidth ? 'cut' : 'whole')`);
  same('three failing plugins: one ×, two reasons and Show all 3', [await a.run(`document.querySelectorAll('#header .band-dismiss').length`), (await plugReasons()).length, await a.text('#problems-show-all')], [1, 2, 'Show all 3']);
  await press('#problems-show-all');
  same('shown, each reason whole', await plugReasons(), ['whole', 'whole', 'whole']);
  await press('#header .band-dismiss');
  same('× closes it all', await a.exists('#header .header-result'), false);
  rmSync(join(home, 'slow'));
  // A plugin's page and back, then Refresh: the list in its order again, installed first.
  const inOrder = on => [...plugins.filter(name => on.includes(name)), ...plugins.filter(name => !on.includes(name))];
  const installedNow = [...installedFirst.filter(name => name !== 'plug-06'), 'plug-01', 'plug-10', 'plug-20', 'plug-22', ...fivePlugins[1], ...fiveWide[1]];
  await a.click('#popen-0-plug-20'); await a.click('#plugin-back');
  same('back from a plugin’s page, every plugin is in its place in the order', await order(), inOrder(installedNow));
  await putAt(list, '[data-plugin="plug-02"]', 300);
  await clickAt(await middleOf('#pswitch-0-plug-02')); await done();
  const pinnedInList = [(await order()).indexOf('plug-02') === inOrder(installedNow).indexOf('plug-02'), await a.run(`document.querySelector('#pswitch-0-plug-02').getAttribute('aria-checked')`)];
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && (await order()).length !== plugins.length; tries++) await wait(100);
  same('a plugin turned On stays where it was until Refresh, which puts it with the installed ones', [pinnedInList, await order()], [[true, 'true'], inOrder([...installedNow, 'plug-02'])]);
  same('no page errors, rows keep their places', a.pageErrors, []);
  await a.quit();
}

async function pluginUpdatesFlow() {
  const home = join(scratch, 'home-auto'), data = join(scratch, 'auto-data'), market = join(scratch, 'market-auto'), tools = join(scratch, 'tools-auto'), stage = join(scratch, 'stage-auto');
  writeMarket(market, 'ck-test-market');
  const catalogPath = join(market, '.claude-plugin/marketplace.json');
  const publish = (versions, dropped = []) => { const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')); catalog.plugins = catalog.plugins.filter(plugin => !dropped.includes(plugin.name)).map(plugin => ({ ...plugin, ...(versions[plugin.name] ? { version: versions[plugin.name] } : {}) })); writeFileSync(catalogPath, JSON.stringify(catalog, null, 2)); };
  const marketText = path => readFileSync(join(market, 'plugins', path), 'utf8');
  const copies = { 'issue-tracker': { 'skills/triage/SKILL.md': marketText('issue-tracker/skills/triage/SKILL.md') }, 'document-tools': { 'skills/pdf-reader/SKILL.md': marketText('document-tools/skills/pdf-reader/SKILL.md'), 'skills/spreadsheet/SKILL.md': marketText('document-tools/skills/spreadsheet/SKILL.md') }, 'release-helper': { 'commands/release-notes.md': marketText('release-helper/commands/release-notes.md') } };
  // Each record Claude Code's stand-in moves to, written ahead with the copies it names; the last one written is where it starts.
  const recordPath = join(home, '.claude/plugins/installed_plugins.json');
  mkdirSync(stage, { recursive: true });
  for (const [name, issue, docs] of [['docs', '1.9.0', '1.2.0'], ['issue-2.0.0', '2.0.0', '1.2.0'], ['issue-3.0.0', '3.0.0', '1.2.0'], ['issue-4.0.0', '4.0.0', '1.2.0'], ['start', '1.9.0', '1.1.0']]) {
    rmSync(recordPath, { force: true });
    writeClaudeInstall(home, 'ck-test-market', 'issue-tracker', issue, copies['issue-tracker']);
    writeClaudeInstall(home, 'ck-test-market', 'document-tools', docs, copies['document-tools']);
    writeClaudeInstall(home, 'ck-test-market', 'release-helper', '0.4.1', copies['release-helper']);
    writeFileSync(join(stage, `record-${name}.json`), readFileSync(recordPath, 'utf8'));
  }
  // Claude Code added the marketplace itself, and has document-tools turned off. Codex is here too and has none of the plugins.
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'ck-test-market': { source: { source: 'git', url: market } } }));
  const claudeSettings = join(home, '.claude/settings.json');
  writeFileSync(claudeSettings, '{"enabledPlugins":{"document-tools@ck-test-market":false}}');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex/config.toml'), 'model = "gpt-test"\n');
  // The stand-ins: Claude Code's update moves its record on (and, for document-tools, turns the plugin on, as a tool might); Codex notes anything it is asked.
  mkdirSync(join(tools, '.local/bin'), { recursive: true });
  writeFileSync(join(tools, '.local/bin/claude'), `#!/bin/sh
[ "$1" = "--version" ] && echo "2.1.322 (Claude Code)" && exit 0
echo "$*" >> "$HOME/claude-calls.txt"
case "$*" in
  "plugin update document-tools@ck-test-market --scope user") cp '${join(stage, 'record-docs.json')}' "$HOME/.claude/plugins/installed_plugins.json"; printf '{"enabledPlugins":{"document-tools@ck-test-market":true}}' > "$HOME/.claude/settings.json" ;;
  "plugin disable document-tools@ck-test-market --scope user") printf '{"enabledPlugins":{"document-tools@ck-test-market":false}}' > "$HOME/.claude/settings.json" ;;
  "plugin update issue-tracker@ck-test-market --scope user") if [ -f "$HOME/issue-fails" ]; then echo "Failed to update issue-tracker: the download stopped."; exit 1; fi; cp "${stage}/record-issue-$(cat "$HOME/issue-next").json" "$HOME/.claude/plugins/installed_plugins.json" ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(tools, '.local/bin/codex'), '#!/bin/sh\n[ "$1" = "--version" ] && echo "codex-cli 0.167.0" && exit 0\necho "$*" >> "$HOME/codex-calls.txt"\nexit 9\n', { mode: 0o755 });
  writeFileSync(join(home, 'issue-next'), '2.0.0');
  const versions = () => Object.fromEntries(Object.entries(JSON.parse(readFileSync(recordPath, 'utf8')).plugins).map(([id, [entry]]) => [id.split('@')[0], entry.version]));
  const calls = () => (existsSync(join(home, 'claude-calls.txt')) ? readFileSync(join(home, 'claude-calls.txt'), 'utf8').trim().split('\n') : []);
  // The record kept for this home (the file holds one per home).
  const noted = () => { try { return JSON.parse(readFileSync(join(data, 'plugin-updates.json'), 'utf8')).find(record => record.home === home) ?? {}; } catch { return {}; } };
  const until = async (test, ms = 30000) => { for (let spent = 0; spent < ms; spent += 200) { if (await test()) return true; await wait(200); } return false; };
  mkdirSync(data, { recursive: true });
  // The first close's "still running" dialog was answered before.
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home }, closeExplained: true }));
  // To begin with the marketplace offers what Claude Code has: nothing is due.
  publish({ 'issue-tracker': '1.9.0', 'document-tools': '1.1.0' });
  const first = await launch(data, [], tools);
  same('the marketplace is added', await first.run(`window.centralKnot.addMarketplace(${JSON.stringify(market)}).then(result => result.problem ?? 'added')`), 'added');
  await first.quit();

  // 1. The schedule, with the window closed.
  let a = await launch(data, [], tools, { CK_PLUGIN_UPDATES_EVERY_MS: '2000' });
  check('with nothing behind, the first check by itself changes nothing and says so', await until(() => noted().checked?.at) && noted().checked.updated === 0 && calls().length === 0 && versions()['issue-tracker'] === '1.9.0', JSON.stringify(noted()));
  await a.click('#nav-settings');
  for (let tries = 0; tries < 50 && !/Last checked/.test(await a.text('#setting-plugin-updates') ?? ''); tries++) await wait(100);
  check('Settings has the switch, on, and what the last check came to', await a.run(`document.querySelector('#plugin-updates-on')?.getAttribute('aria-checked')`) === 'true' && /Last checked today at .*\. Nothing needed updating\./.test(await a.text('#setting-plugin-updates-notice') ?? '') && await a.exists('#check-plugin-updates'), await a.text('#setting-plugin-updates'));
  // A page-made close destroys the window outright (see the practice flow): from here on this launch has no window at all.
  await a.run(`setTimeout(() => window.close(), 50), true`);
  await wait(800);
  // The marketplace moves both plugins on and drops release-helper.
  publish({ 'issue-tracker': '2.0.0', 'document-tools': '1.2.0' }, ['release-helper']);
  check('with the window closed, the plugins Claude Code has are updated by themselves, through its own command', await until(() => versions()['issue-tracker'] === '2.0.0' && versions()['document-tools'] === '1.2.0' && noted().updated?.length === 2), JSON.stringify([versions(), calls(), noted()]));
  const dock = () => { const found = spawnSync('lsappinfo', ['find', `pid=${a.child.pid}`], { encoding: 'utf8' }).stdout.trim(); return spawnSync('lsappinfo', ['info', '-only', 'ApplicationType', found], { encoding: 'utf8' }).stdout.trim(); };
  same('the app ran on with no window through it (on a Mac, from its menu bar icon alone)', [a.child.exitCode, process.platform === 'darwin' ? dock() : 'no Dock'], [null, process.platform === 'darwin' ? '"ApplicationType"="UIElement"' : 'no Dock']);
  same('the plugin turned off in Claude Code is off again after its update, by Claude Code’s own switch', [JSON.parse(readFileSync(claudeSettings, 'utf8')).enabledPlugins['document-tools@ck-test-market'], calls()],
    [false, ['plugin update document-tools@ck-test-market --scope user', 'plugin disable document-tools@ck-test-market --scope user', 'plugin update issue-tracker@ck-test-market --scope user']]);
  check('Codex, which has neither plugin, is asked for nothing: an update installs nowhere new', !existsSync(join(home, 'codex-calls.txt')));
  check('the plugin the marketplace dropped is kept as it was', versions()['release-helper'] === '0.4.1' && existsSync(join(home, '.claude/plugins/cache/ck-test-market/release-helper/0.4.1/commands/release-notes.md')), JSON.stringify(versions()));
  const logged = readFileSync(join(data, 'central-knot.log'), 'utf8');
  check('the log says what was checked and what each update came to', /plugin updates: checked: 2 due/.test(logged) && /plugins:update \(by itself\) issue-tracker@ck-test-market in claude-cli: updated: Updated to 2\.0\.0\./.test(logged) && /document-tools@ck-test-market in claude-cli: updated: Updated to 1\.2\.0\. It is still off in Claude Code\./.test(logged), logged.split('\n').filter(line => /plugin/.test(line)).join('\n'));
  const before = calls().length;
  await wait(5000);
  check('once up to date, later checks run nothing', calls().length === before && noted().checked.updated === 0, JSON.stringify([calls(), noted().checked]));
  await a.quit();

  // 2. After a restart, the note and the Settings row say what happened; the dropped plugin is marked.
  a = await launch(data, [], tools);
  await a.run(`(document.querySelector('#nav-plugins').click(), true)`);
  for (let tries = 0; tries < 100 && !(await a.exists('#plugin-updates-updated')); tries++) await wait(100);
  await a.settle();
  const note = await a.text('#plugin-updates-updated') ?? '';
  check('the Plugins page keeps a plain note: which plugins, which version, which tool', /Updated automatically\./.test(note) && /document-tools: updated to 1\.2\.0 in Claude Code · today at/.test(note) && /issue-tracker: updated to 2\.0\.0 in Claude Code · today at/.test(note) && !(await a.exists('#plugin-updates-failed')), note);
  check('the first note says once that plugins update by themselves now, and where that is turned off', (await a.text('#plugin-updates-new')) === 'Plugins now update by themselves. Settings turns that off.', note);
  same('the plugins show as up to date, and the dropped one as no longer offered, still installed in Claude Code (and unable to go to Codex, which never had it)',
    [await a.run(`document.querySelector('#pcell-0-issue-tracker-claude-cli')?.dataset.state`), await a.text('[data-plugin="release-helper"] .plugin-chip-gone'), await a.run(`document.querySelector('#pcell-0-release-helper-claude-cli')?.dataset.state`), await a.run(`document.querySelector('#pcell-0-release-helper-codex-cli')?.dataset.state`)],
    ['installed', 'No longer offered', 'installed', 'cannot']);
  await a.click('#plugin-updates-updated-0');
  check('a plugin named in the note opens its page', (await a.text('.crumb-here')) === 'document-tools', await a.text('.plugins-toolbar'));
  await a.click('#plugin-back');
  await a.click('#plugin-updates-updated-close');
  check('closing the note takes it away, and it stays away', !(await a.exists('#plugin-updates-updated')) && noted().updated.length === 0, JSON.stringify(noted()));

  // 3. A failure is said in the tool's own words, in the note and in Settings, and Check now tries it again.
  publish({ 'issue-tracker': '3.0.0' });
  writeFileSync(join(home, 'issue-next'), '3.0.0');
  writeFileSync(join(home, 'issue-fails'), '');
  await a.click('#nav-settings');
  await a.click('#check-plugin-updates');
  for (let tries = 0; tries < 100 && !/couldn’t be made/.test(await a.text('#setting-plugin-updates-notice') ?? ''); tries++) await wait(100);
  check('Check now says what it came to: one update couldn’t be made, with the way to the note', /Last checked today at .*\. 1 update couldn’t be made\./.test(await a.text('#setting-plugin-updates-notice') ?? '') && (await a.text('#setting-plugin-updates-notice-action')) === 'See Plugin marketplaces', await a.text('#setting-plugin-updates'));
  check('Check now takes the focus back once it can be pressed again', await a.run(`document.activeElement?.id`) === 'check-plugin-updates', await a.run(`document.activeElement?.id`));
  await a.click('#setting-plugin-updates-notice-action');
  for (let tries = 0; tries < 50 && !(await a.exists('#plugin-updates-failed')); tries++) await wait(100);
  check('the note says what couldn’t be updated, in the tool’s own words, and that it is tried again', /Couldn’t update automatically\./.test(await a.text('#plugin-updates-failed') ?? '') && /issue-tracker: Still 2\.0\.0 in Claude Code; the marketplace has 3\.0\.0\. Failed to update issue-tracker: the download stopped\. · today at .* · will be tried again/.test(await a.text('#plugin-updates-failed') ?? '')
    && versions()['issue-tracker'] === '2.0.0' && /`claude plugin update issue-tracker@ck-test-market --scope user` failed: Failed to update issue-tracker: the download stopped\./.test(readFileSync(join(data, 'central-knot.log'), 'utf8')), await a.text('#plugin-updates-failed'));

  // 4. The switch: off, nothing runs by itself; on again, the failed update is tried and goes through.
  await a.click('#nav-settings');
  await a.click('#plugin-updates-on');
  for (let tries = 0; tries < 50 && (await a.run(`document.querySelector('#plugin-updates-on')?.getAttribute('aria-checked')`)) !== 'false'; tries++) await wait(100);
  check('the switch turns it off: saved, with no Check now and no status', JSON.parse(readFileSync(join(data, 'app-settings.json'), 'utf8')).pluginUpdates === false && !(await a.exists('#check-plugin-updates')) && !(await a.exists('#setting-plugin-updates-notice')), await a.text('#setting-plugin-updates'));
  same('no page errors, plugin updates', a.pageErrors, []);
  await a.quit();
  rmSync(join(home, 'issue-fails'));
  a = await launch(data, [], tools, { CK_PLUGIN_UPDATES_EVERY_MS: '2000' });
  const whileOff = calls().length;
  await wait(6000);
  check('turned off, the schedule runs nothing, though an update is waiting', calls().length === whileOff && versions()['issue-tracker'] === '2.0.0', JSON.stringify(calls()));
  // Automatic sync off pauses it too: off means nothing is written to the tools in the background.
  await a.run(`window.centralKnot.setSync(false).then(() => true)`);
  await a.click('#nav-settings');
  await a.click('#plugin-updates-on');
  await wait(6000);
  check('turned on with Automatic sync off, it is paused and says so; nothing runs', calls().length === whileOff && versions()['issue-tracker'] === '2.0.0' && /Paused while Automatic sync is off: nothing is updated by itself\. Check now still updates what is behind\./.test(await a.text('#setting-plugin-updates-notice') ?? ''), [calls(), await a.text('#setting-plugin-updates')]);
  await a.run(`window.centralKnot.setSync(true).then(() => true)`);
  check('with Automatic sync on again, the update that failed goes through by itself, and its note goes', await until(() => versions()['issue-tracker'] === '3.0.0' && noted().failures?.length === 0) && noted().updated.some(line => line.plugin === 'issue-tracker' && /updated to 3\.0\.0 in Claude Code/.test(line.text)), JSON.stringify([versions(), noted()]));
  await a.run(`(document.querySelector('#nav-plugins').click(), true)`);
  for (let tries = 0; tries < 100 && !(await a.exists('#plugin-updates-updated')); tries++) await wait(100);
  check('a later note no longer says that this is new', /issue-tracker: updated to 3\.0\.0 in Claude Code/.test(await a.text('#plugin-updates-updated') ?? '') && !(await a.exists('#plugin-updates-new')), await a.text('#plugin-updates-updated'));
  check('the note scrolls with the page, so it never squeezes the list', await a.run(`!!document.querySelector('#plugins-scroll #plugin-updates-updated')`));

  // 5. An update that failed by itself and is then made by hand on the page: its note goes at once, not at the next check.
  publish({ 'issue-tracker': '4.0.0' });
  writeFileSync(join(home, 'issue-next'), '4.0.0');
  writeFileSync(join(home, 'issue-fails'), '');
  check('the next version fails by itself and is said', await until(() => noted().failures?.length === 1) && await until(() => a.exists('#plugin-updates-failed'), 5000), JSON.stringify(noted()));
  // Automatic sync off holds the schedule still, so the update below is the person's own and nothing else's.
  await a.run(`window.centralKnot.setSync(false).then(() => true)`);
  await wait(2500);
  rmSync(join(home, 'issue-fails'));
  for (let tries = 0; tries < 50 && !(await a.exists('#pupdate-0-issue-tracker')); tries++) await wait(100);
  await a.click('#pupdate-0-issue-tracker');
  check('Update on the page makes it, and the failure’s note goes with no check in between', await until(() => versions()['issue-tracker'] === '4.0.0' && noted().failures?.length === 0, 10000) && await until(async () => !(await a.exists('#plugin-updates-failed')), 5000), JSON.stringify([versions(), noted().failures, await a.text('#plugin-updates-failed')]));
  same('no page errors, plugin updates on a schedule', a.pageErrors, []);
  await a.quit();
}

/**
 * The Overview says only what is so (overview.ts). "All in sync" only where nothing of the kind differs, waits or couldn't be read;
 * a copy deleted by hand with Automatic sync off is a change that waits. "?" where a tool's file of a kind, or its own record of its
 * plugins, couldn't be read. One count of plugins on the Overview's table, a tool's Plugins tab and a kind's "From plugins" chip.
 * The lead never says nothing was found above a card that counts something, and why a home can't be written is said with no tool
 * managed too. Made-up homes: Claude Code and Codex stand-ins, and a plugin from a marketplace no tool lists.
 */
async function overviewFlow() {
  const home = join(scratch, 'overview-home'), data = join(scratch, 'overview-data'), real = join(scratch, 'overview-real');
  const standIns = folder => { mkdirSync(join(folder, '.local/bin'), { recursive: true });
    for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['codex', 'codex-cli 0.142.3']]) writeFileSync(join(folder, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`, { mode: 0o755 }); };
  standIns(home);
  const [claude, codex] = [join(home, '.claude/skills'), join(home, '.codex/skills')];
  for (const root of [claude, codex]) skill(root, 'notes');
  skill(codex, 'review');
  // kit, from a marketplace no tool lists, in Claude Code: checks only it brings, and review, which is Codex's own too.
  writeClaudeInstall(home, 'orphan-market', 'kit', '1.0.0', { 'skills/checks/SKILL.md': text('checks'), 'skills/review/SKILL.md': text('review') });
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'docs' } } }));
  writeFileSync(join(home, '.codex/config.toml'), '[mcp_servers.docs]\ncommand = "docs"\n');
  for (const folder of [data, real]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  let a = await launch(data, [], real);
  // Opening the Overview reads nothing beyond the home's view: no marketplace is read, so Central Knot's plugins record isn't started.
  await wait(1500);
  check('opening the Overview reads no marketplace: Central Knot’s plugins record isn’t started', !existsSync(join(home, '.central-knot/plugins.json')), existsSync(join(home, '.central-knot')) ? readdirSync(join(home, '.central-knot')) : []);
  await a.click('#setup-no');
  for (const [page, key] of [['skills', 'notes'], ['skills', 'review'], ['mcp', 'docs']]) { await a.click(`#nav-${page}`); await a.click(`#${rowPart('add', page, key)}`); }
  await a.click('#nav-overview');
  const cardSays = async kind => (await a.text(`.kind-card:has(#overview-${kind}) .kind-card-state`))?.trim() ?? null;
  const claudeRow = () => a.all('.tools-table tr[data-tool="claude-cli"] td', 'e.textContent.trim()');
  same('with every copy in step, each card says All in sync', [await cardSays('skills'), await cardSays('mcp')], ['All in sync', 'All in sync']);
  // One count of plugins: kit is Claude Code's one plugin on the table and on its Plugins tab; the Skills card's "from plugins" is the chip's.
  same('the table counts kit, Claude Code’s one plugin', (await claudeRow())[3], '1');
  check('the Skills card counts from plugins what its page’s From plugins chip holds: checks, and review, which kit brings too', /· 2 from plugins/.test(await a.text('.kind-card:has(#overview-skills) .kind-card-summary') ?? ''), await a.text('.kind-card:has(#overview-skills) .kind-card-summary'));
  await a.click('#overview-skills');
  same('the Skills page’s From plugins chip holds 2', await a.run(`document.querySelector('.chip[data-tip="From plugins"] .chip-count')?.textContent`), '2');
  await a.click('#nav-overview');
  await a.click('#overview-tool-claude-cli');
  await a.click('#harness-tab-plugins');
  for (let tries = 0; tries < 50 && /Reading marketplaces/.test(await a.text('#harness-body') ?? ''); tries++) await wait(100);
  const tab = await a.text('#harness-body') ?? '';
  check('Claude Code’s Plugins tab counts kit too, from a marketplace no tool lists: never “No plugins”', (await a.text('#harness-tab-plugins'))?.includes('1') && !/No plugins in Claude Code/.test(tab) && /kit/.test(tab), [await a.text('#harness-tab-plugins'), tab]);
  // A copy deleted by hand with Automatic sync off: the item turns off when sync runs, a change that waits.
  await a.click('#nav-overview');
  await a.click('#sync-switch');
  rmSync(join(codex, 'notes'), { recursive: true, force: true });
  await a.click('#header-refresh');
  same('a copy deleted by hand, sync off: Skills waits for one change, not All in sync', await cardSays('skills'), '1 change waiting to sync');
  await a.click('#overview-skills');
  same('the Skills page counts the same one change waiting, in its toolbar and in its band', [(await a.text('.apply-state.apply-waiting'))?.trim(), /1 change waiting/.test(await a.text('.band-sync-off') ?? '')], ['1 change waiting', true]);
  await a.click('#nav-overview');
  skill(codex, 'notes');
  await a.click('#header-refresh');
  same('the copy back: All in sync again', await cardSays('skills'), 'All in sync');
  // One copy that can't be read: whether it is in step isn't known.
  chmodSync(join(codex, 'notes/SKILL.md'), 0o000);
  await a.click('#header-refresh');
  const unreadCopy = await cardSays('skills');
  chmodSync(join(codex, 'notes/SKILL.md'), 0o644);
  await a.click('#header-refresh');
  same('one copy that can’t be read: the Skills card says nothing of sync', unreadCopy, null);
  await a.click('#sync-switch');
  // Copies that differ: said once at the top, and the card says no "All in sync".
  skill(claude, 'clash', text('clash', 'Claude Code’s way.'));
  skill(codex, 'clash', text('clash', 'Codex’s way.'));
  await a.click('#header-refresh');
  same('a found skill whose copies differ: its line at the top, and the Skills card says nothing of sync', [await a.exists('#overview-skills-differ-line'), await cardSays('skills')], [true, null]);
  rmSync(join(codex, 'clash'), { recursive: true, force: true });
  // A tool's MCP file that can't be read: its problem at the top, "?" for its MCP servers, and no "All in sync" on MCP servers.
  const claudeJson = readNow(join(home, '.claude.json'));
  writeFileSync(join(home, '.claude.json'), '{ "mcpServers": ');
  await a.click('#header-refresh');
  const unreadMcp = [await a.exists('[id^="overview-mcp-problem-"]'), (await claudeRow())[1], await cardSays('mcp')];
  writeFileSync(join(home, '.claude.json'), claudeJson);
  // Claude Code's own record of its plugins can't be read: "?" for its plugins, and the key says what "?" is.
  const installed = join(home, '.claude/plugins/installed_plugins.json'), installedText = readNow(installed);
  writeFileSync(installed, '{');
  await a.click('#header-refresh');
  const unreadPlugins = [(await claudeRow())[3], ((await a.text('#overview-tools-key')) ?? '').split('?').length - 1];
  await a.click('#overview-tool-claude-cli');
  await a.click('#harness-tab-plugins');
  for (let tries = 0; tries < 50 && /Reading marketplaces/.test(await a.text('#harness-body') ?? ''); tries++) await wait(100);
  const tabUnread = [await a.text('#harness-tab-plugins'), await a.run(`document.querySelector('#harness-tab-plugins')?.title ?? ''`), await a.text('#harness-body')];
  await a.click('#nav-overview');
  writeFileSync(installed, installedText);
  await a.click('#header-refresh');
  same('Claude Code’s MCP file unread: its problem at the top, "?" for its MCP servers, and MCP servers says nothing of sync', unreadMcp, [true, '?', null]);
  same('Claude Code’s plugin record unread: "?" for its plugins, and the key names "?" once', unreadPlugins, ['?', 1]);
  check('and its Plugins tab says what it has isn’t known: no count, no nought in its tooltip, never “No plugins”', tabUnread[0]?.trim() === 'Plugins' && !/\b0\b/.test(tabUnread[1]) && /isn’t known/.test(tabUnread[2] ?? '') && !/No plugins/.test(tabUnread[2] ?? ''), tabUnread);
  same('no page errors, the Overview’s truths', a.pageErrors, []);
  await a.quit();
  // A most used name opens its row on the very first click, before its kind's page was ever drawn in this launch: an own skill, one
  // whose copies differ (its question open), an own MCP server; then, in another home opened meanwhile, a plugin's skill.
  skill(codex, 'clash', text('clash', 'Codex’s way.'));
  const used = (folder, names) => { mkdirSync(join(folder, '.claude/projects/-work'), { recursive: true });
    writeFileSync(join(folder, '.claude/projects/-work/used.jsonl'), JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
      message: { content: names.map(name => (name.startsWith('mcp__') ? { type: 'tool_use', name, input: {} } : { type: 'tool_use', name: 'Skill', input: { skill: name } })) } }) + '\n'); };
  used(home, ['notes', 'clash', 'mcp__docs__start']);
  // This computer's home, opened second: its only item is a plugin's skill, used once.
  standIns(real);
  mkdirSync(join(real, '.claude/skills'), { recursive: true });
  writeClaudeInstall(real, 'solo', 'kit', '1.0.0', { 'skills/one/SKILL.md': text('one') });
  used(real, ['kit:one']);
  a = await launch(data, [], real);
  const openTop = async (kind, name) => {
    const link = `#overview-${kind}-usage .middle[title=${JSON.stringify(name)}]`;
    for (let tries = 0; tries < 100 && !(await a.exists(link)); tries++) await wait(100);
    await a.click(`#${await a.run(`document.querySelector(${JSON.stringify(link)})?.closest('button')?.id`)}`);
    const open = keysOf(kind, await a.all('.ov-row[aria-expanded="true"]', 'e.dataset.key'));
    await a.click('#nav-overview');
    return open;
  };
  same('launched, nothing visited: a most used own skill opens its row on the first click', await openTop('skills', 'notes'), ['notes']);
  same('one whose copies differ opens too, with its copy question', await openTop('skills', 'clash'), ['clash']);
  same('a most used MCP server, its page never drawn either, opens its row', await openTop('mcp', 'docs'), ['docs']);
  const session = join(home, '.claude/projects/-work/used.jsonl');
  const sessionsCell = '.tools-table tr[data-tool="claude-cli"] .tools-sessions';
  const update = byId('overview-collect-usage');
  const updateSessions = async () => {
    await a.click(update);
    for (let tries = 0; tries < 100 && !await a.exists(update); tries++) await wait(50);
    return a.text(sessionsCell);
  };
  const readable = await a.text(sessionsCell);
  check('Claude Code starts with one recent session', /^1(?:\s|$)/.test(readable), readable);
  chmodSync(session, 0);
  same('the only session unreadable: its count is unknown and the table explains why',
    [await updateSessions(), (await a.text(byId('overview-tools-key')))?.includes('?: not known')], ['?', true]);
  await a.click(byId('overview-skills'));
  await a.click(byId(rowPart('open', 'skills', 'notes')));
  const rowUsage = byId(rowPart('usage', 'skills', 'notes', 'claude-cli'));
  check('the skill’s row says why Claude Code can’t tell', /can’t say: 1 session file couldn’t be read/i.test(await a.text(rowUsage)));
  check('the toolbar makes no claim of no sessions', !(await a.text(byId('usage-when')))?.includes('no sessions'));
  if (shots) {
    await sizeTo(a, 1280, 800);
    await a.run(`document.querySelector(${JSON.stringify(rowUsage)}).scrollIntoView({ block: 'center' })`);
    await a.shot('skills-unread-session');
  }
  await a.click(byId('nav-overview'));
  const second = join(dirname(session), 'second.jsonl');
  writeFileSync(second, JSON.stringify({ type: 'user', timestamp: new Date().toISOString() }));
  same('one session readable and another unreadable: the table marks the known count', await updateSessions(), '1 ?');
  check('the key explains the number before the mark', (await a.text(byId('overview-tools-key')))?.includes('A number before the mark is what was counted, and there may be more.'));
  if (shots) {
    await a.run(`document.querySelector('.tools-table').scrollIntoView({ block: 'center' })`);
    await a.shot('overview-unread-session');
    await fullSize(a);
  }
  unlinkSync(second);
  chmodSync(session, 0o600);
  same('restoring access restores the complete sessions cell', await updateSessions(), readable);
  await a.click('#home-actual');
  for (let tries = 0; tries < 100 && !(await a.exists('#overview-skills-usage .middle[title="one"]')); tries++) await wait(100);
  same('another home whose only item is a plugin’s skill: the card counts it, and the lead never says nothing was found',
    [(await a.text('.kind-card:has(#overview-skills) .kind-card-summary'))?.trim(), await a.exists('.overview-lead'), /Nothing found/.test(await a.text('.overview-lead') ?? '')], ['1 skill · none on · 1 from plugins', true, false]);
  same('there, after Skills was drawn in the first home, a most used plugin’s skill opens its row on the first click', await openTop('skills', 'one'), ['kit@solo/one']);
  same('no page errors, the most used links', a.pageErrors, []);
  await a.quit();
  // A home with no tool, whose record stops every write: why it can't be written is said with no tool managed too.
  const stopped = join(scratch, 'overview-stopped'), stoppedData = join(scratch, 'overview-stopped-data');
  mkdirSync(join(stopped, '.central-knot'), { recursive: true });
  writeFileSync(join(stopped, '.central-knot/sync.json'), '{ damaged');
  mkdirSync(stoppedData, { recursive: true });
  writeFileSync(join(stoppedData, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: stopped } }));
  a = await launch(stoppedData, [], real);
  same('no tool and a damaged record: the Overview says no tools were found, and why nothing can be written', [await a.exists('#overview-choose-home'), /damaged/.test(await a.text('#overview-stopped') ?? '')], [true, true]);
  same('no page errors, the Overview with no tool', a.pageErrors, []);
  await a.quit();
}

/**
 * Usage (usage.ts, usagerow.ts, app.ts collectUsage) on a folder home whose tools have made-up session history: collected by
 * itself when the home opens, so each row says its figure without a click, an opened row each tool's, and Sort can put the rows
 * by last used. Update usage statistics collects again, with a band that says what collecting does and closes; a reading that
 * lands moves no row. Three skills were taken in from copies saved 40 days ago, old enough for "No use seen in 30 days"; fresh,
 * saved 2 days ago, is left out as new. The chip lists the two with no use seen, and Turn these off turns them off in one click
 * whose Undo puts every file back. A switch clicked while a reading is held (a named pipe among the session files) is carried out
 * before it lands, so no reading holds a click up: checked by order, not time, as a click and a reading slow each other on a busy machine.
 */
async function usageFlow() {
  const home = join(scratch, 'usage-home'), data = join(scratch, 'usage-data'), ago = days => new Date(Date.now() - days * 86_400_000);
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['codex', 'codex-cli 0.142.3']]) {
    writeFileSync(join(home, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
    chmodSync(join(home, '.local/bin', name), 0o755);
  }
  const [claude, codex] = ['.claude/skills', '.codex/skills'].map(path => join(home, path));
  for (const [name, days] of [['notes', 40], ['standup', 40], ['idle', 40], ['spare', 40], ['fresh', 2]]) { const folder = skill(claude, name); for (const path of [folder, join(folder, 'SKILL.md')]) utimesSync(path, ago(days), ago(days)); }
  const lines = (path, records) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, records.map(record => JSON.stringify(record)).join('\n') + '\n'); };
  const skillCall = (name, days) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] }, timestamp: ago(days).toISOString() });
  // Claude Code: notes called in 13 sessions, the newest 2 days ago; standup typed 40 days ago; a listing that names idle, which is no use.
  lines(join(home, '.claude/projects/-work/s1.jsonl'), [{ type: 'attachment', attachment: { type: 'skill_listing', content: '- idle: x' }, timestamp: ago(2).toISOString() }, skillCall('notes', 2)]);
  for (let session = 2; session <= 13; session++) lines(join(home, `.claude/projects/-work/notes-${session}.jsonl`), [skillCall('notes', 2 + session)]);
  lines(join(home, '.claude/projects/-work/s2.jsonl'), [{ type: 'user', message: { content: '<command-name>/standup</command-name>' }, timestamp: ago(40).toISOString() }]);
  // Copilot CLI, not installed here so not managed: idle invoked 3 days ago, which counts all the same.
  lines(join(home, '.copilot/session-state/c1/events.jsonl'), [{ type: 'skill.invoked', data: { name: 'idle' }, timestamp: ago(3).toISOString() }]);
  // OpenCode, not installed here (no settings folder), with a database left from a year ago: not named among the tools; read all the same.
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(join(home, '.local/share/opencode'), { recursive: true });
  const leftover = new DatabaseSync(join(home, '.local/share/opencode/opencode.db'));
  leftover.exec('CREATE TABLE session (id text PRIMARY KEY, agent text, time_created integer NOT NULL)');
  leftover.exec('CREATE TABLE part (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, data text NOT NULL)');
  leftover.prepare('INSERT INTO session VALUES (?, ?, ?)').run('old', null, ago(365).getTime());
  leftover.close();
  // Codex: its history starts 12 days ago; notes's SKILL.md read 5 days ago.
  lines(join(home, '.codex/sessions/2026/11/01/rollout-a.jsonl'), [{ type: 'session_meta', payload: {}, timestamp: ago(12).toISOString() },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', parsed_cmd: [{ type: 'read', name: 'SKILL.md', path: join(claude, 'notes/SKILL.md') }] } }, timestamp: ago(5).toISOString() }]);
  // A profile of all four, in use once they are On: turning two off ends that, which the chip's band says first.
  mkdirSync(join(home, '.central-knot'), { recursive: true });
  writeFileSync(join(home, '.central-knot/profiles.json'), JSON.stringify({ formatVersion: 2, profiles: [{ id: 'everyday', name: 'Everyday', items: ['skill:fresh', 'skill:idle', 'skill:notes', 'skill:spare', 'skill:standup'] }] }));
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  const real = join(scratch, 'usage-real');
  mkdirSync(real, { recursive: true });
  let a = await launch(data, [], real);
  await a.click('#nav-settings');
  for (let tries = 0; tries < 30 && !(await a.exists('#sync-everything-on')); tries++) await wait(100);
  await a.click('#sync-everything-on');
  await a.click('#nav-skills');
  for (let tries = 0; tries < 50 && (await sectionsNow(a, 'skills'))[0]?.[1]?.length !== 5; tries++) { await wait(100); await a.settle(); }
  same('the five skills are On, taken in by Synchronize everything', await sectionsNow(a, 'skills'), [['on', ['fresh', 'idle', 'notes', 'spare', 'standup']]]);
  // Each skill's figure, by its key (its row's data-key, the kind's prefix taken off).
  const figures = () => a.run(`Object.fromEntries([...document.querySelectorAll('.ov-row[data-key]')].map(row => [row.dataset.key.slice(${rowPart('', 'skills', '').length}), row.querySelector('.ov-used')?.textContent]))`);
  const collected = () => a.run(`/^Collected /.test(document.querySelector('#usage-when')?.textContent ?? '')`);
  for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
  // Collected when the home opened, while the page took the clicks above: no click on the button, and no band.
  same('the home’s first opening collects usage by itself: the time beside Update usage statistics, a figure on each row, no band',
    [await collected(), (await a.text('#collect-usage'))?.trim(), await a.exists('#usage-line'), (await figures()).notes], [true, 'Update usage statistics', false, 'used 2 days ago · 14 sessions']);
  // Copilot CLI left out with its Manage switch: its sessions are still read, and a use there still counts.
  await a.click('#nav-harnesses');
  await a.click('#manage-copilot-cli');
  for (let tries = 0; tries < 50 && (await a.run(`document.querySelector('#manage-copilot-cli')?.getAttribute('aria-checked')`)) !== 'false'; tries++) await wait(100);
  await a.click('#nav-skills');
  await a.click('#collect-usage');
  // The band holds its three sentences in one place, so its height never changes; the one on show is the one not marked unshown.
  const bandText = async () => (await a.text('#usage-line .band-text > :not(.band-unshown)') ?? '');
  for (let tries = 0; tries < 100 && !/^Usage statistics collected/.test(await bandText()); tries++) await wait(100);
  same('Update usage statistics opens the band: what was collected, from where, and that nothing left the computer (the time is beside the button)',
    await bandText(), 'Usage statistics collected from the tools’ own session history on this computer. Nothing left it.');
  same('each row says its figure: used, and in how many sessions (in Copilot CLI too, not managed here), or no use seen in 30 days (a listing is no use, nor a use 40 days ago)', await figures(),
    { fresh: 'no use seen in 30 days', idle: 'used 3 days ago · 1 session', notes: 'used 2 days ago · 14 sessions', spare: 'no use seen in 30 days', standup: 'no use seen in 30 days' });
  await a.click(`#${rowPart('open', 'skills', 'notes')}`);
  same('a skill used in two tools: its opened row says each tool’s count, 13 and 1, which the row adds up to 14',
    await a.all('.details-usage', 'e.textContent.trim()'), ['Used in 13 sessions in the last 30 days, last used 2 days ago.', 'Used in 1 session in the last 30 days, last used 5 days ago.']);
  await a.click(`#${rowPart('open', 'skills', 'notes')}`);
  await a.click(`#${rowPart('open', 'skills', 'standup')}`);
  same('an opened row says each tool’s figure: its last use beyond the 30 days, and that Codex doesn’t always record a skill (can’t say, no number)',
    await a.all('.details-usage', 'e.textContent.trim()'), ['No use seen in the last 30 days; last used 5 weeks ago.', 'Can’t say: it doesn’t always record which skill was used.']);
  await a.click(`#${rowPart('open', 'skills', 'standup')}`);
  await a.click(`#${rowPart('open', 'skills', 'idle')}`);
  same('and a use in a tool not managed here has its own line', (await a.text(`#${rowPart('usage', 'skills', 'idle', 'copilot-cli')}`))?.trim(), 'Copilot CLI, not managed here: used in 1 session in the last 30 days, last used 3 days ago.');
  await a.click(`#${rowPart('open', 'skills', 'idle')}`);
  // Closing the band is a click on the band: the rows move up by its own height and no more, and it stays closed.
  const tops = () => a.run(`[...document.querySelectorAll('.ov-row[data-key]')].map(row => row.getBoundingClientRect().top)`);
  const [beforeClose, bandHeight] = [await tops(), await a.run(`document.querySelector('#usage-line').getBoundingClientRect().height`)];
  await a.click('#usage-line-close');
  const afterClose = await tops();
  same(`closing the band moves every row up by its height (${Math.round(bandHeight)} px) and nothing else`,
    [afterClose.length === beforeClose.length && afterClose.every((top, index) => Math.abs(beforeClose[index] - top - bandHeight) < 0.5), await a.exists('#usage-line')], [true, false]);
  const chooseOrder = async value => { await a.run(`(() => { const select = document.querySelector('#item-order'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change')); })()`); await a.settle(); };
  await chooseOrder('used');
  same('Sort by Last used: the newest use first, then the one used 40 days ago, then those never seen, by name', (await sectionsNow(a, 'skills'))[0][1], ['notes', 'idle', 'standup', 'fresh', 'spare']);
  // spare used just now: the reading that lands moves no row (its cell fills where it is); the next Sort draws the new order.
  lines(join(home, '.claude/projects/-work/s4.jsonl'), [skillCall('spare', 0)]);
  await a.click('#collect-usage');
  for (let tries = 0; tries < 100 && (await figures()).spare !== 'used just now · 1 session'; tries++) await wait(100);
  same('a reading that lands moves no row: spare, used just now, says so where it was; the band opened again by Update',
    [(await sectionsNow(a, 'skills'))[0][1], (await figures()).spare, await a.exists('#usage-line')], [['notes', 'idle', 'standup', 'fresh', 'spare'], 'used just now · 1 session', true]);
  await chooseOrder('name'); await chooseOrder('used');
  same('the next draw that may reorder (Sort chosen again) puts it first', (await sectionsNow(a, 'skills'))[0][1], ['spare', 'notes', 'idle', 'standup', 'fresh']);
  rmSync(join(home, '.claude/projects/-work/s4.jsonl'));
  await a.click('#collect-usage');
  for (let tries = 0; tries < 100 && (await figures()).spare !== 'no use seen in 30 days'; tries++) await wait(100);
  await a.click('#usage-line-close');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && (await sectionsNow(a, 'skills'))[0]?.[1]?.[0] !== 'notes'; tries++) { await wait(100); await a.settle(); }
  same('Refresh lets the held order go', (await sectionsNow(a, 'skills'))[0][1], ['notes', 'idle', 'standup', 'fresh', 'spare']);
  await sizeTo(a, 860, 600);
  same('at 860×600 the button keeps its word, and its icon is not the chip’s', [(await a.run(`document.querySelector('#collect-usage').innerText.trim()`)).split(' ')[0], await a.exists('#collect-usage svg')], ['Update', false]);
  same('the longest figure, "used 13 days ago · 999 sessions", is whole in a figure’s cell', await a.run(`(() => { const cell = document.querySelector('.ov-used'), was = [...cell.childNodes];
    cell.replaceChildren('used 13 days ago', Object.assign(document.createElement('span'), { className: 'ov-used-count', textContent: ' · 999 sessions' }));
    const whole = cell.scrollWidth <= cell.clientWidth + 1; cell.replaceChildren(...was); return whole; })()`), true);
  same('at 860×600 every figure is whole, "used 2 days ago · 14 sessions" too', await a.run(`[...document.querySelectorAll('.ov-used')].filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => cell.textContent)`), []);
  await fullSize(a);
  await fitsAtMinimum(a, 'Skills with usage collected and its figures');
  await a.shot('usage-read');
  // The chip: standup and spare, old enough with no use seen; fresh, 2 days old, left out and counted; idle, used in Copilot CLI, not in it.
  same('after a reading, the chip counts what has no use seen in 30 days, old enough', await a.all('.chip', '[e.dataset.tip, e.querySelector(".chip-count")?.textContent]'), [['All', null], ['No use seen in 30 days', '2']]);
  await a.click('.chip[data-tip="No use seen in 30 days"]');
  same('with the chip on, the table holds standup and spare', await sectionsNow(a, 'skills'), [['on', ['standup', 'spare']]]);
  same('its band leads with how many, what Turn these off does and the profile it ends; then, fainter, that a use elsewhere isn’t seen, how far back each tool’s history goes, what Codex doesn’t always record and the new one left out',
    [await a.text('#unused-band .usage-lead'), (await a.text('#unused-band .usage-more'))?.replace(/ /g, ' ').replace(/from \w+ \d+/g, 'from <day>')],
    ['2 skills with no use seen in the last 30 days. Turn these off: off in every tool; Central Knot keeps them, and Undo turns them all back on. With these off, Everyday stops being the profile in use.',
      'A use on another computer or in a tool not read isn’t seen. Each tool’s history: Claude Code, 30 days or more; Copilot CLI, from <day>; Codex, from <day>. Codex doesn’t always record which skill was used. Left out: 1 skill under 30 days old.']);
  same('Turn these off sits at the band’s end, at 1280 and 2560 alike', await (async () => { const ends = []; for (const [width, height] of [[1280, 800], [2560, 1440]]) { await sizeTo(a, width, height);
    ends.push(await a.run(`Math.round(document.querySelector('#unused-band').getBoundingClientRect().right - document.querySelector('#turn-unused-off').getBoundingClientRect().right)`)); } await fullSize(a); return ends[0] === ends[1]; })(), true);
  await fitsAtMinimum(a, 'Skills with the No use seen chip on and its band');
  await a.shot('usage-chip');
  const filesOf = names => Object.fromEntries(names.flatMap(name => [claude, codex].map(root => [join(root, name), readNow(join(root, name, 'SKILL.md'))])));
  const before = filesOf(['standup', 'spare']);
  await a.click('#turn-unused-off');
  for (let tries = 0; tries < 50 && !(await a.exists('#outcome-undo')); tries++) await wait(100);
  same('Turn these off: one click turns both off, in every tool, and says so with one Undo; the chip, now at 0, is gone', [await a.text('.outcome-text, [data-outcome] .band-text'), Object.values(filesOf(['standup', 'spare'])).every(text => text === ''), await a.exists('.chip[data-tip="No use seen in 30 days"]')],
    ['Turned off 2 skills with no use seen in the last 30 days: spare and standup. Central Knot keeps them, and turning one on puts it back as it was.', true, false]);
  await a.click('#outcome-undo');
  for (let tries = 0; tries < 50 && Object.values(filesOf(['standup', 'spare'])).some(text => text === ''); tries++) await wait(100);
  same('its one Undo puts both back On, every file byte for byte', [filesOf(['standup', 'spare']), (await sectionsNow(a, 'skills'))[0][1]], [before, ['notes', 'idle', 'standup', 'fresh', 'spare']]);
  // With the chip on, rows turned Off by their own switch stay listed where they were, and the chip stays on, until the list is
  // drawn afresh; then All again for what follows.
  const chipNamed = name => a.run(`[...document.querySelectorAll('.chip')].find(chip => chip.dataset.tip === ${JSON.stringify(name)})?.click()`);
  await chipNamed('No use seen in 30 days'); await a.settle();
  await a.click(`#${rowPart('switch', 'skills', 'standup')}`);
  const chipOn = () => a.run(`document.querySelector('.chip-on')?.dataset.tip`);
  const afterOne = [await sectionsNow(a, 'skills'), await chipOn()];
  await a.clickInRun(`#${rowPart('switch', 'skills', 'spare')}`);
  same('spare, clicked soon after standup, joins its run: said once', await a.text('#header [data-outcome] .band-text'), '2 skills are off: standup and spare.');
  await a.shot('usage-chip-pinned');
  same('with the chip on, rows turned Off by their own switch stay listed where they were, and the chip stays on', [afterOne, [await sectionsNow(a, 'skills'), await chipOn()], [await switchOn(a, 'skills', 'standup'), await switchOn(a, 'skills', 'spare')]],
    [[[['on', ['standup', 'spare']]], 'No use seen in 30 days'], [[['on', ['standup', 'spare']]], 'No use seen in 30 days'], [false, false]]);
  for (const key of ['standup', 'spare']) await a.clickInRun(`#${rowPart('switch', 'skills', key)}`);
  same('turned on again in the same run, each row is said as the run left it', await a.text('#header [data-outcome] .band-text'), '2 skills are on: standup and spare.');
  // Turn these off, with standup already pinned on the chip's list: every row takes its own group, and the chip falls back to All.
  await a.click(`#${rowPart('switch', 'skills', 'standup')}`);
  await a.click('#turn-unused-off');
  // With nothing left for a chip to narrow, All is alone and no chip is drawn.
  same('Turn these off lets the pinned rows go: every row under its own heading, and the page back on All', [await sectionsNow(a, 'skills'), (await chipOn()) ?? 'All'], [[['on', ['notes', 'idle', 'fresh']], ['off', ['standup', 'spare']]], 'All']);
  await a.click('#outcome-undo');
  await a.click(`#${rowPart('switch', 'skills', 'standup')}`);
  same('its Undo puts spare back; standup is turned on again by its switch', [await switchOn(a, 'skills', 'standup'), await switchOn(a, 'skills', 'spare'), await chipOn()], [true, true, 'All']);
  // A reading that fails shows nothing from the one before, and opens the band to say so (a dev run only: it reaches main to make the request fail).
  const main = a.inspect ? await mainHelpers(a.inspect) : undefined;
  if (main) {
    await main.failRequest('usage:read');
    await a.click('#collect-usage');
    for (let tries = 0; tries < 50 && !/couldn’t be collected/.test(await bandText()); tries++) await wait(100);
    same('a reading that fails: the band says so, the button offers to collect again, and no figure or chip from the reading before stays',
      [await bandText(), (await a.text('#collect-usage'))?.trim(), await a.exists('.ov-used'), await a.exists('.chip[data-tip="No use seen in 30 days"]')],
      ['Usage statistics couldn’t be collected: the tools’ session history couldn’t be read.', 'Collect usage statistics', false, false]);
    await main.restore('usage:read');
    main.close();
  }
  // A plugin's own row (From plugins) says its figure as any row does, by the same match: Claude Code calls it review-kit:checks.
  writeClaudeInstall(home, 'ck-usage', 'review-kit', '1.0.0', { 'skills/checks/SKILL.md': '---\nname: checks\ndescription: Checks a change.\n---\n\nSteps.\n' });
  lines(join(home, '.claude/projects/-work/s3.jsonl'), [skillCall('review-kit:checks', 4)]);
  const kit = 'review-kit@ck-usage/checks';
  await a.click('#header-refresh');
  for (let tries = 0; tries < 50 && !(await a.exists(`.ov-row[data-key="${rowPart('', 'skills', kit)}"]`)); tries++) await wait(100);
  await a.click('#collect-usage');
  for (let tries = 0; tries < 50 && !(await a.run(`document.querySelector('.ov-row[data-key="${rowPart('', 'skills', kit)}"] .ov-used')?.textContent`)); tries++) await wait(100);
  await a.click(byId(rowPart('open', 'skills', kit)));
  same('a From plugins row says its figure, and its opened row Claude Code’s, by the same match', [await a.run(`document.querySelector('.ov-row[data-key="${rowPart('', 'skills', kit)}"] .ov-used')?.textContent`), (await a.text(`${byId(rowPart('usage', 'skills', kit, 'claude-cli'))}`))?.trim()],
    ['used 4 days ago · 1 session', 'Used in 1 session in the last 30 days, last used 4 days ago.']);
  await a.shot('usage-plugin-row');
  // Sort by Last used, kept from this launch to the next: the reading that comes by itself as the home opens moves no row.
  await chooseOrder('used');
  same('no page errors, usage', a.pageErrors, []);
  await a.quit();
  a = await launch(data, [], real);
  await a.click('#nav-skills');
  for (let tries = 0; tries < 50 && (await sectionsNow(a, 'skills'))[0]?.[1]?.length !== 5; tries++) { await wait(100); await a.settle(); }
  const firstDrawn = await sectionsNow(a, 'skills');
  for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
  same('the next launch keeps Sort by Last used, and the reading that comes by itself moves no row', [await a.run(`document.querySelector('#item-order').value`), await sectionsNow(a, 'skills')], ['used', firstDrawn]);

  // ---------- A reading that lands moves nothing ----------
  // This computer's home (`real`), opened now, has history in five tools and its reading starts afresh. Each reading is held
  // back by a named pipe (below), so the page is looked at while it runs.
  const realSkills = join(real, '.claude/skills');
  mkdirSync(join(real, '.local/bin'), { recursive: true });
  for (const name of ['claude', 'codex']) cpSync(join(home, '.local/bin', name), join(real, '.local/bin', name));
  // Each saved 40 days ago or more, so old enough for the chip; delta's copy saved after bravo's, so Last updated puts it first.
  for (const [name, days] of [['alpha', 40], ['bravo', 44], ['charlie', 42], ['delta', 41], ['echo', 40]]) { const folder = skill(realSkills, name); for (const path of [folder, join(folder, 'SKILL.md')]) utimesSync(path, ago(days), ago(days)); }
  lines(join(real, '.claude/projects/-work/r0.jsonl'), [{ type: 'user', message: { content: 'hello' }, timestamp: ago(45).toISOString() }]);
  lines(join(real, '.claude/projects/-work/r1.jsonl'), [skillCall('alpha', 2)]);
  lines(join(real, '.codex/sessions/2026/11/12/rollout-r.jsonl'), [{ type: 'session_meta', payload: {}, timestamp: ago(5).toISOString() },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', parsed_cmd: [{ type: 'read', name: 'SKILL.md', path: join(realSkills, 'alpha/SKILL.md') }] } }, timestamp: ago(5).toISOString() }]);
  // A Codex session file that can't be read: alpha's Codex line says so beside its figure.
  lines(join(real, '.codex/sessions/2026/11/12/rollout-locked.jsonl'), [{ type: 'session_meta', payload: {}, timestamp: ago(4).toISOString() }]);
  chmodSync(join(real, '.codex/sessions/2026/11/12/rollout-locked.jsonl'), 0o000);
  lines(join(real, '.copilot/session-state/r1/events.jsonl'), [{ type: 'skill.invoked', data: { name: 'echo' }, timestamp: ago(3).toISOString() }]);
  lines(join(real, '.pi/agent/sessions/--w--/r.jsonl'), [{ type: 'message', message: { role: 'user', content: [{ type: 'text', text: '<skill name="echo">' }] }, timestamp: ago(4).toISOString() }]);
  // A named pipe among Claude Code's session files holds each reading back: it waits on the pipe until the check lets it go
  // (`letGo`), so the page is looked at while the reading runs, the same in a packaged app.
  const pipe = join(real, '.claude/projects/-work/held.jsonl');
  spawnSync('mkfifo', [pipe]);
  let writer;
  /** Whether a reading waits on the pipe: opening its other end finds one, and that end is kept open, so the reading keeps waiting. */
  const reading = () => { if (writer === undefined) { try { writer = openSync(pipe, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK); } catch { return false; } } return true; };
  /** Lets the waiting reading go on: the pipe's other end closed, it reads an empty session file. */
  const letGo = async () => { for (let tries = 0; tries < 200 && !reading(); tries++) await wait(25); if (writer !== undefined) closeSync(writer); writer = undefined; };
  {
    const lead = () => a.text('#usage-when');
    await chooseOrder('name');
    await sizeTo(a, 1000, 760);
    await a.click('#home-actual');
    for (let tries = 0; tries < 100 && !(await a.exists(`#${rowPart('open', 'skills', 'alpha')}`)); tries++) await wait(50);
    for (let tries = 0; tries < 100 && !reading(); tries++) await wait(25);
    same('while the first reading of a home runs, the Used column holds its room, its cells empty', [await lead(), await a.run(`[...document.querySelectorAll('.ov-row[data-key]')].map(row => row.querySelector('.ov-used')?.textContent ?? 'no cell')`)],
      ['Collecting…', ['', '', '', '', '']]);
    await a.click(`#${rowPart('open', 'skills', 'alpha')}`);
    const collectingLines = await a.all('.details-usage', 'e.textContent.trim()'), openTops = await tops();
    await letGo();
    for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
    await a.settle();
    same('an opened row (details under it) says Collecting… on each tool’s line while the reading runs, and when the reading lands no row moves',
      [collectingLines.length > 0 && collectingLines.every(line => line === 'Collecting usage statistics…'), await tops()], [true, openTops]);
    same('a tool some of whose session files can’t be read says how many beside its figure', (await a.all('.details-usage', 'e.textContent.trim()')).find(line => /couldn’t be read/.test(line)),
      'Used in 1 session in the last 30 days, last used 5 days ago; 1 session file couldn’t be read.');
    await a.click(`#${rowPart('open', 'skills', 'alpha')}`);
    // Update's band, 900 wide, with five tools' history: the same height while it collects and once the reading lands.
    await sizeTo(a, 900, 760);
    const bandHeight = () => a.run(`document.querySelector('#usage-line')?.getBoundingClientRect().height ?? 0`);
    await a.click('#collect-usage');
    for (let tries = 0; tries < 50 && !(await a.exists('#usage-line')); tries++) await wait(50);
    const [whileHeight, whileTops] = [await bandHeight(), await tops()];
    await letGo();
    for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
    await a.settle();
    same('the band an Update opens keeps its height when the reading lands (five tools, 900 wide), so no row moves', [await bandHeight(), await tops()], [whileHeight, whileTops]);
    await a.click('#usage-line-close');
    // The chip on, Sort by name: charlie, used since, stays where it was when the reading lands; Put in order lets it go.
    await a.click('#nav-settings');
    for (let tries = 0; tries < 30 && !(await a.exists('#sync-everything-on')); tries++) await wait(100);
    await a.click('#sync-everything-on');
    await a.click('#nav-skills');
    for (let tries = 0; tries < 50 && (await sectionsNow(a, 'skills'))[0]?.[1]?.length !== 5; tries++) { await wait(100); await a.settle(); }
    await chipNamed('No use seen in 30 days'); await a.settle();
    same('the chip holds the three On skills with no use seen, and no rows are held', [(await sectionsNow(a, 'skills'))[0]?.[1], await a.exists('#put-in-order')], [['bravo', 'charlie', 'delta'], false]);
    lines(join(real, '.claude/projects/-work/r2.jsonl'), [skillCall('charlie', 0)]);
    await a.click('#collect-usage');
    // Measured once the click's band has opened (its own height is the click's), while the reading waits on the pipe.
    for (let tries = 0; tries < 100 && !reading(); tries++) await wait(25);
    const chipTops = await tops();
    await letGo();
    for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
    await a.settle();
    same('Sort by name, the chip on: charlie, used just now, stays where it was when the reading lands, no row moves, the chip counts what Turn these off would turn off, and Put in order is offered',
      [(await sectionsNow(a, 'skills'))[0][1], await tops(), (await figures()).charlie, await a.all('.chip', '[e.dataset.tip, e.querySelector(".chip-count")?.textContent]'), await a.exists('#put-in-order')],
      [['bravo', 'charlie', 'delta'], chipTops, 'used just now · 1 session', [['All', null], ['No use seen in 30 days', '2']], true]);
    await a.click('#put-in-order');
    same('Put in order lets the held rows go: charlie leaves the chip’s list, and the link goes', [(await sectionsNow(a, 'skills'))[0][1], await a.exists('#put-in-order')], [['bravo', 'delta'], false]);
    await a.click('#usage-line-close');
    // Sort by Last updated, the chip on: an Update lands, and no row moves, with nothing to put in order.
    await chooseOrder('updated');
    const updatedOrder = (await sectionsNow(a, 'skills'))[0][1];
    await a.click('#collect-usage');
    for (let tries = 0; tries < 100 && !reading(); tries++) await wait(25);
    const updatedTops = await tops();
    await letGo();
    for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
    await a.settle();
    same('Sort by Last updated, the chip on: an Update lands and no row moves, with nothing to put in order', [updatedOrder, (await sectionsNow(a, 'skills'))[0][1], await tops(), await a.exists('#put-in-order')],
      [['delta', 'bravo'], ['delta', 'bravo'], updatedTops, false]);
    await a.click('#usage-line-close');
    await chooseOrder('name');
    await chipNamed('All'); await a.settle();
    // bravo's switch, clicked while an Update's reading waits on the pipe, is carried out (Off, said, its copies gone) while the
    // toolbar still says Collecting…; then the reading lands and nothing moves.
    const bravoCopies = () => [realSkills, join(real, '.codex/skills')].map(folder => readNow(join(folder, 'bravo/SKILL.md')));
    const copiesBefore = bravoCopies();
    await a.click('#collect-usage');
    for (let tries = 0; tries < 100 && !reading(); tries++) await wait(25);
    // Not a.click, which waits for the page to be idle; the header's result is closed first, as a.click does for a row's switch.
    await a.run(`(() => { document.querySelector('#outcome-dismiss, #report-dismiss')?.click(); document.querySelector('#${rowPart('switch', 'skills', 'bravo')}').click(); })()`);
    const carriedOut = () => a.run(`document.body.dataset.busy !== 'true' && !!document.querySelector('#header [data-outcome] .band-text')`);
    // Waited for as long as a.click waits for any click (30 s): a click held until the reading lands never comes before letGo.
    for (let tries = 0; tries < 300 && !(await carriedOut()); tries++) await wait(100);
    const whileHeld = [await switchOn(a, 'skills', 'bravo'), await a.text('#header [data-outcome] .band-text'), bravoCopies(), await lead()], heldTops = await tops();
    await letGo();
    for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
    await a.settle();
    same('a switch clicked while a reading is held is carried out before the reading lands: bravo Off, said, its copies gone, the toolbar still collecting; when it lands nothing moves',
      [copiesBefore.every(copy => copy !== ''), whileHeld, [await switchOn(a, 'skills', 'bravo'), bravoCopies(), await tops()]],
      [true, [false, 'bravo is off: no tool has it. Central Knot keeps it, and turning it on puts each folder back as it was.', ['', ''], 'Collecting…'], [false, ['', ''], heldTops]]);
    await a.click('#usage-line-close');
  }
  same('no page errors, usage after a relaunch', a.pageErrors, []);
  await a.quit();

  // ---------- The Overview, the page a launch opens on: its figures land with no click, and nothing on it moves ----------
  // Launched on this computer's home and nothing clicked: its first reading waits on the pipe. The cards, the tools table's rows
  // and its header cells, and the usage line are measured at 1280 and 860 while it runs, then again once it has landed.
  a = await launch(data, [], real);
  for (let tries = 0; tries < 100 && !(await a.exists('.kind-card')); tries++) await wait(50);
  for (let tries = 0; tries < 200 && !reading(); tries++) await wait(25);
  const places = () => a.run(`[...document.querySelectorAll('.kind-card, .tools-table tr, .tools-table thead th, #overview-usage')].map(e => { const box = e.getBoundingClientRect(); return [box.left, box.top, box.width, box.height].map(Math.round).join(' '); })`);
  const usageSaid = async () => (await a.text('#overview-usage .overview-usage-text:not(.band-unshown)'))?.trim();
  const cardLines = () => a.all('#overview-skills-usage > p', 'e.textContent');
  const sessionsSaid = () => a.all('.tools-table td.tools-sessions', 'e.textContent');
  const placesWhile = {}, placesAfter = {};
  for (const [width, height] of [[1280, 800], [860, 600]]) { await sizeTo(a, width, height); placesWhile[width] = await places(); }
  const whileRunning = [await usageSaid(), await cardLines(), [...new Set(await sessionsSaid())]];
  await letGo();
  for (let tries = 0; tries < 100 && !/^Usage collected/.test(await usageSaid() ?? ''); tries++) await wait(100);
  await a.settle();
  for (const [width, height] of [[860, 600], [1280, 800]]) { await sizeTo(a, width, height); placesAfter[width] = await places(); }
  same('launched with nothing clicked, the Overview holds each figure’s room while the first reading runs: the line says it is collecting, the Skills card … where its count will be (its five lines’ room held by style.css), every sessions cell …',
    whileRunning, ['Collecting usage statistics: reading your tools’ session history on this computer. Nothing leaves it.', ['Used in the last 30 days: …'], ['…']]);
  same('the figures land by themselves, and no card, table row, header cell or the usage line moved, at 1280 and at 860', [placesAfter[1280], placesAfter[860]], [placesWhile[1280], placesWhile[860]]);
  same('the Skills card says the reading as its page does: 3 used, the No use seen chip’s 1 (delta; bravo is Off) as a link, and the three most used by sessions, equal ones by name; the line, when',
    [await cardLines(), await a.text('#overview-skills-unused'), /^Usage collected today at [^.]+\. Update usage statistics$/.test(await usageSaid() ?? '')], [['Used in the last 30 days: 3', 'No use seen in 30 days: 1', 'Most usedalpha2 sessions', 'echo2 sessions', 'charlie1 session'], 'No use seen in 30 days: 1', true]);
  check('every tool’s sessions cell has its figure, or why there is none', (await sessionsSaid()).every(said => said && said !== '…'), await sessionsSaid());
  await a.click('#overview-skills-unused');
  same('No use seen opens Skills on that chip, the rows the card counted', [await a.run(`document.querySelector('.chip-on')?.dataset.tip`), (await sectionsNow(a, 'skills'))[0]?.[1]], ['No use seen in 30 days', ['delta']]);
  await a.click('#nav-overview');
  await a.click('#overview-skills-top-1');
  same('a most used name opens its row on Skills, under All', [await a.run(`document.querySelector('.chip-on')?.dataset.tip ?? 'All'`), await a.run(`document.querySelector('.ov-row[data-key="${rowPart('', 'skills', 'echo')}"]')?.getAttribute('aria-expanded')`)], ['All', 'true']);
  await a.click('#nav-overview');
  await fullSize(a);
  await fitsAtMinimum(a, 'the Overview with usage collected');
  same('no page errors, the Overview', a.pageErrors, []);
  await a.quit();
  // Started at sign-in, with no window (--hidden): nothing is collected until the window first shows (a second launch shows it).
  a = await launch(data, ['--hidden'], real);
  await a.click('#nav-skills');
  await wait(2000);
  same('started with no window, it collects nothing until the window shows', [reading(), await a.text('#usage-when')], [false, 'Collecting…']);
  const again = spawn(command, [...(flag('--electron') ? [root] : []), `--user-data-dir=${data}`, ...(flag('--no-sandbox') ? ['--no-sandbox'] : [])],
    { env: { ...process.env, HOME: real, PATH: `${join(scratch, 'bin')}:/usr/bin:/bin`, TMPDIR: join(scratch, 'tmp') }, stdio: 'ignore' });
  await new Promise(done => again.once('exit', done));
  for (let tries = 0; tries < 100 && !reading(); tries++) await wait(50);
  await letGo();
  for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
  same('once the window shows, usage is collected', await collected(), true);
  // The window shown while its page isn't listening (a development run only: main's debugger reloads the page and shows the
  // window at once, so the message that it showed reaches no page): told again once the page has loaded, it still collects.
  if (a.inspect) {
    await a.quit();
    a = await launch(data, ['--hidden'], real);
    const main = await mainProcess(a.inspect);
    await main.run(`(electron.BrowserWindow.getAllWindows()[0].webContents.reload(), electron.app.emit('second-instance'), true)`);
    main.close();
    for (let tries = 0; tries < 100 && !(await a.exists('#nav-skills')); tries++) await wait(50);
    await a.click('#nav-skills');
    for (let tries = 0; tries < 100 && !reading(); tries++) await wait(50);
    await letGo();
    for (let tries = 0; tries < 100 && !(await collected()); tries++) await wait(100);
    same('started with no window, then shown while its page wasn’t listening: it still collects', await collected(), true);
  }
  same('no page errors, usage started at sign-in', a.pageErrors, []);
  await a.quit();
  rmSync(pipe);
}

const execChmod = () => spawnSync('chmod', ['-R', 'u+rwx', scratch]);

// ---------- Run ----------
// Every flow, in groups. A run with no --flows starts this script once per group, so each group has a throwaway home, data
// folders, stand-ins and debug ports of its own, and several run at once (runGroups). Four groups, as the Mac runner was
// measured with four apps at once, balanced by each flow's seconds there with four at once (each flow's line in a run gives
// them): practiceFlow, the longest, has little beside it. realHomeFlow is in its group, as both open the default data folder
// (launch) and realHomeFlow's preview-only branch reads the History window practiceFlow set there. crashFlow comes last in its
// group, as it deletes its copy's HOME. Inside a copy the flows run in this order on the HOME seeded for it (seedHome), so each
// group passes on its own.
const groups = [
  [practiceFlow, suggestedFlow, pluginRowsFitFlow, realHomeFlow],
  [releasedStartupFlow, updateFlow, otherAppsFlow, rowsKeepTheirPlacesFlow, pluginUpdatesFlow, overviewFlow],
  [fewToolsFlow, openCodeFlow, freedOtherWaysFlow, thisMacTakeOverFlow, pluginSwitchFlow, sourcesFlow, draftFlow, sharedCopiesFlow, syncEverythingFlow],
  [harnessFlow, manageFlow, otherBuildFlow, listDiffersFlow, repoBaseFlow, usageFlow, firstSetupFlow, crashFlow],
];
// crashFlow needs a home the app writes, and a round to kill in.
const runs = flow => flow !== crashFlow || (canWriteRealHome && crashRounds > 0);
const listed = groups.flat().map(flow => flow.name);
const written = [...readFileSync(import.meta.filename, 'utf8').matchAll(/^async function (\w+Flow)\(/gm)].map(([, name]) => name);
const refused = [...written.filter(name => listed.filter(each => each === name).length !== 1).map(name => `${name} is in no group or in two`),
  ...(named ?? []).filter(name => !listed.includes(name)).map(name => `--flows names ${name}, which is no flow`),
  ...(Number.isInteger(crashRounds) && crashRounds >= 0 ? [] : [`--crash-rounds takes a whole number, and was given ${option('--crash-rounds') ?? 'none'}`])];
if (refused.length) { rmSync(scratch, { recursive: true, force: true }); throw new Error(`Refused to start: ${refused.join('; ')}.`); }

/**
 * What a copy's output and its end say: its passes (undefined without a total line), its FAIL lines, among them one more when
 * the copy died (it ended without its total line, or with an exit other than its total's, or by a signal) or its total counts
 * more failures than its FAIL lines, and the flows it did not finish (one that began and stopped) and did not run. `number`
 * names the copy where no one flow can be named.
 */
function readCopy(names, number, output, code, signal) {
  const total = /^e2e: (\d+) passed, (\d+) failed/m.exec(output), ended = signal ? `ended by ${signal}` : `exit code ${code}`;
  const missed = names.filter(name => !new RegExp(`^${name}: \\d+s$`, 'm').test(output)), ran = names.filter(name => !missed.includes(name));
  const aborted = /^FAIL \[(\w+)\] aborted: /m.exec(output)?.[1];
  const failLines = output.split('\n').filter(line => line.startsWith('FAIL ')).length;
  let death;
  if (!total && missed.length) death = `FAIL [${missed[0]}] its copy ended in this flow without a total line (${ended})`;
  else if (!total) death = `FAIL [group ${number}] its copy ended after its flows without a total line (${ended})`;
  else if (signal || code !== (Number(total[2]) ? 1 : 0)) death = `FAIL [${ran.at(-1) ?? names[0]}] its copy died after its total (${ended})`;
  else if (Number(total[2]) > failLines) death = `FAIL [group ${number}] its total says ${total[2]} failed, and only ${failLines} of its lines say FAIL`;
  const unfinished = total ? missed.filter(name => name === aborted) : missed.slice(0, 1);
  const shown = death ? `${output.trimEnd()}\n${death}` : output.trimEnd();
  const fails = shown.split('\n').filter(line => line.startsWith('FAIL '));
  return { passes: total ? Number(total[1]) : undefined, shown, fails, unfinished, notRun: missed.filter(name => !unfinished.includes(name)) };
}

/**
 * The run with no --flows: this script once per group with that group's --flows and the run's other options,
 * CK_E2E_GROUPS_AT_ONCE copies at a time (default 1). Each copy's stdout and stderr, in the order they came, print as one
 * block when it ends; then the run's total, the flows not finished and not run, and every FAIL line again. The run's failures
 * are its copies' FAIL lines, one more for each copy that died or whose total counts more failures than its FAIL lines
 * (readCopy); the passes of a copy without a total line are not known, and the total says so. A signal is passed on to every
 * copy, and each one's block printed as it ends. Returns the exit code.
 */
async function runGroups() {
  const atOnce = Math.max(1, Number(process.env.CK_E2E_GROUPS_AT_ONCE) || 1);
  const waiting = groups.map(group => group.filter(runs).map(flow => flow.name)).filter(names => names.length);
  const count = waiting.length;
  const running = new Set(), unfinished = [], notRun = [], failLines = [], uncounted = [];
  let passed = 0, begun = 0, stoppedBy;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stoppedBy = signal; for (const copy of running) copy.kill(signal); });
  const runOne = names => new Promise(done => {
    const from = Date.now(), number = ++begun;
    const copy = spawn(process.execPath, [...process.execArgv, import.meta.filename, ...args, '--flows', names.join(',')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [copy.stdout, copy.stderr]) stream.on('data', chunk => { output += chunk; });
    running.add(copy);
    copy.on('close', (code, signal) => {
      running.delete(copy);
      const read = readCopy(names, number, output, code, signal);
      if (read.passes === undefined) uncounted.push(number); else passed += read.passes;
      unfinished.push(...read.unfinished);
      notRun.push(...read.notRun);
      failLines.push(...read.fails);
      console.log(`\n── group ${number} of ${count}, ${Math.round((Date.now() - from) / 1000)}s${stoppedBy ? `, stopped by ${stoppedBy}` : ''}: ${names.join(', ')}\n${read.shown}`);
      done();
    });
  });
  console.log(`${waiting.length} groups of flows, ${atOnce} at a time; each group's output follows when it ends.`);
  await Promise.all(Array.from({ length: atOnce }, async () => { while (waiting.length && !stoppedBy) await runOne(waiting.shift()); }));
  notRun.push(...waiting.flat());
  const notCounted = uncounted.length ? ` (the passes of group ${uncounted.join(' and group ')} are not counted: no total line)` : '';
  console.log(`\ne2e: ${passed} passed, ${failLines.length} failed, ${Math.round((Date.now() - started) / 1000)}s, ${process.platform}${notCounted}`);
  if (unfinished.length) console.error(`not finished: ${unfinished.join(', ')}`);
  if (notRun.length) console.error(`not run: ${notRun.join(', ')}`);
  if (failLines.length) console.error(failLines.join('\n'));
  return stoppedBy ? 130 : failLines.length ? 1 : 0;
}

const started = Date.now();
if (!named) {
  // The scratch folder and its stand-ins were made as this script loaded, as every flow's paths are built from them; the parent
  // runs no flow, so it deletes them.
  rmSync(scratch, { recursive: true, force: true });
  process.exitCode = await runGroups();
} else {
  try {
    seedHome();
    // Each flow's time is printed, so a run that grows slow says where (and a grouped run, which flows ran).
    for (const flow of groups.flat().filter(each => named.includes(each.name) && runs(each))) {
      flowRunning = flow.name;
      const from = Date.now();
      await flow();
      console.log(`${flow.name}: ${Math.round((Date.now() - from) / 1000)}s`);
    }
    execChmod();
  } catch (error) {
    check(`aborted: ${error.message}`, false);
    console.error(error);
  } finally {
    app?.child.kill('SIGKILL');
    execChmod();
    await mountsGone(scratch);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
  console.log(`e2e: ${passes} passed, ${failures.length} failed, ${Math.round((Date.now() - started) / 1000)}s, ${process.platform}`);
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
}
