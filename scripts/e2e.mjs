// Drives the real app end to end over its debug port, in a throwaway HOME, so "This Mac's home" is disposable too.
// Usage: node scripts/e2e.mjs [--electron] [--no-sandbox] [--shots dir] [--crash-rounds n] [--flows openCodeFlow,…]
// `--flows` runs only the named flows, for working on one; a run that counts has them all.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, cpSync, existsSync, renameSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeClaudeInstall, writeMarket } from './fixture-market.mjs';
import { serveReleases } from './update-fixture.mjs';
import { connect, DAY, debugPorts, holdQueue, keepFor, mainProcess, refocus, standIn } from './cdp.mjs';
import { standInMac } from '../tests/macstandins.ts';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const shots = option('--shots');
const crashRounds = Number(option('--crash-rounds', 6));
const canWriteRealHome = process.platform === 'darwin';
const root = resolve(import.meta.dirname, '..');
const packaged = join(root, 'release/Central Knot-darwin-arm64/Central Knot.app/Contents/MacOS/Central Knot');
const command = flag('--electron') ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : packaged;

// ---------- Checks ----------
const failures = [];
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures.push(name);
  console.error(`FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)?.slice(0, 500)}`}`);
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
// What stands in for /Applications, the running apps and the Trash in every launch (platform.ts macPlaces): no flow looks at
// or removes the real ones.
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
  mkdirSync(join(HOME, '.local/bin'), { recursive: true });
  for (const [name, output] of [['claude', '2.1.309 (Claude Code)'], ['copilot', 'GitHub Copilot CLI 1.0.107.'], ['codex', 'codex-cli 0.142.3']]) {
    writeFileSync(join(HOME, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${output}" && exit 0\nexit 9\n`);
    chmodSync(join(HOME, '.local/bin', name), 0o755);
  }
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
const opened = join(scratch, 'opened.txt');
if (process.platform === 'linux') {
  mkdirSync(join(scratch, 'bin'));
  writeFileSync(join(scratch, 'bin/xdg-open'), `#!/bin/sh\necho "$*" >> '${opened}'\n`);
  chmodSync(join(scratch, 'bin/xdg-open'), 0o755);
}
let app;
// Every app this run started is closed when the run ends, however it ends: a failed or interrupted run must not leave
// an app holding a debug port that a later run could attach to.
const launched = new Set();
process.on('exit', () => { for (const child of launched) { try { child.kill('SIGKILL'); } catch { /* already gone */ } } });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

async function launch(userData = join(scratch, 'data'), extra = [], home = HOME, more = {}) {
  // OpenCode's CLI is looked for only inside the throwaway home, and every app in the stand-in for /Applications (CK_TEST_APPS,
  // empty here): a machine that has them installed (the Mac these run on does) would otherwise bring them into every flow that
  // opens "This Mac's home".
  const env = { HOME: home, PATH: `${join(scratch, 'bin')}:/usr/bin:/bin`, TMPDIR: join(scratch, 'tmp'), CK_TEST_HOME_ONLY: 'opencode', CK_PLUGIN_UPDATES_EVERY_MS: 'never', CK_TEST_APPS: MAC.root, ...more };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  // The app picks its own free debug ports (port 0) and says them, so no other run on this machine can be on them (cdp.mjs
  // debugPorts). A dev run also opens its main process to the checks (an installed app doesn't take --inspect).
  const child = spawn(command, [...(flag('--electron') ? [root, '--inspect=0'] : []), '--remote-debugging-port=0', `--user-data-dir=${userData}`, ...(flag('--no-sandbox') ? ['--no-sandbox'] : []), ...extra], { env, stdio: ['ignore', 'ignore', 'pipe'] });
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
  const settle = async () => { await wait(120); await run(`new Promise((done, fail) => { const end = Date.now() + 30000; const c = () => (document.body.dataset.ready === 'true' || document.querySelector('.mx,.empty-state')) && document.body.dataset.busy !== 'true' ? done(true) : Date.now() > end ? fail(new Error('The page did not settle within 30 s.')) : setTimeout(c, 25); c(); })`); await wait(60); };
  app = {
    child, run, send, settle, pageErrors,
    inspect, main: inspect && (() => mainProcess(inspect)),
    click: async selector => { await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element: ' + ${JSON.stringify(selector)}); e.click(); })()`); await settle(); },
    exists: selector => run(`!!document.querySelector(${JSON.stringify(selector)})`),
    text: selector => run(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`),
    all: (selector, field = 'e.textContent') => run(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(e => ${field})`),
    press: async (key, code = key) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, text: type === 'keyDown' && key.length === 1 ? key : undefined }); await settle(); },
    shot: async name => { if (!shots) return; const reply = await send('Page.captureScreenshot', { format: 'png' }); mkdirSync(shots, { recursive: true }); writeFileSync(join(shots, `${name}.png`), Buffer.from(reply.result.data, 'base64')); },
    expand: async () => { await run(`[...document.querySelectorAll('button')].filter(b => /^Show \\d+ skill/.test(b.textContent.trim()) && b.getAttribute('aria-expanded') !== 'true').forEach(b => b.click())`); await settle(); },
    plan: () => run(`Object.fromEntries([...document.querySelectorAll('.plan-card')].map(e => [e.dataset.key, e.dataset.state]))`),
    pages: async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(target => target.type === 'page').length,
    quit: async () => { page.close(); child.kill('SIGTERM'); await new Promise(done => { child.once('exit', done); setTimeout(done, 5000); }); },
    crash: () => new Promise(done => { page.close(); child.once('exit', done); child.kill('SIGKILL'); }),
  };
  await settle();
  return app;
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
    /** Notes, for each sync:changed the page is sent, whether a `channel` request was under way (`told` reads it), until `restore` runs. */
    noteTells: channel => run(`(() => { const { ipcMain, BrowserWindow } = ${electron}; const contents = BrowserWindow.getAllWindows()[0].webContents, real = ipcMain._invokeHandlers.get(${JSON.stringify(channel)}); let open = 0; globalThis.ckAside = real; globalThis.ckTold = []; contents.send = function (name, ...rest) { if (name === 'sync:changed') globalThis.ckTold.push(open > 0); return Object.getPrototypeOf(contents).send.call(contents, name, ...rest); }; ipcMain._invokeHandlers.set(${JSON.stringify(channel)}, async (...rest) => { open++; try { return await real(...rest); } finally { open--; } }); return true; })()`),
    told: () => run(`(() => { delete ${electron}.BrowserWindow.getAllWindows()[0].webContents.send; return globalThis.ckTold; })()`),
    /** Sends the page a message, as the main process does after a background pass. */
    tellPage: channel => run(`(() => { ${electron}.BrowserWindow.getAllWindows()[0].webContents.send(${JSON.stringify(channel)}); return true; })()`),
    /** Notes the arguments of each `channel` request (`calls` reads them), until `restore` runs. */
    noteCalls: channel => run(`(() => { const handlers = ${electron}.ipcMain._invokeHandlers, real = handlers.get(${JSON.stringify(channel)}); globalThis.ckAside = real; globalThis.ckCalls = []; handlers.set(${JSON.stringify(channel)}, (event, ...args) => { globalThis.ckCalls.push(args); return real(event, ...args); }); return true; })()`),
    calls: () => run(`globalThis.ckCalls`),
    restore: channel => run(`(() => { ${electron}.ipcMain._invokeHandlers.set(${JSON.stringify(channel)}, globalThis.ckAside); delete globalThis.ckAside; return true; })()`),
    close,
  };
}

// ---------- Flows ----------
const rowKeys = a => a.all('.ov-row[data-key]', 'e.dataset.key');
// A tool's mark on an item's row (a box on a page that still has one per tool): what that tool has.
const cellState = (a, key, tool) => a.run(`document.getElementById(${JSON.stringify(`cell-${key}-${tool}`)})?.dataset.state ?? null`);
/** The tools whose mark on an item's row is drawn off: off with the copy kept, or (a library item) a state of that tool's own (held). */
const offMarks = (a, key) => a.all(`.ov-row[data-key=${JSON.stringify(key)}] .tool-mark:is([data-look="off"], [data-look="held"])`, 'e.dataset.tool');
const switchOn = (a, key) => a.run(`document.querySelector('.ov-row[data-key=${JSON.stringify(key)}] .switch')?.getAttribute('aria-checked') === 'true'`);
/** Each section on an item page, in order, with the keys of its rows. */
const sectionsNow = a => a.run(`[...document.querySelectorAll('.ov-section[data-section]')].map(head => [head.dataset.section, [...head.parentElement.querySelectorAll('.ov-row[data-key]')].map(row => row.dataset.key)])`);

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
  same('a card’s different-copies count is the Copies differ count on the tab it opens', [cardDiffer, parseInt(await a.text('.chip-warn .chip-count') ?? '', 10), (await rowKeys(a)).length], [1, 1, 1]);
  await a.click('#harness-switch-codex-cli');
  check('the switcher opens another harness with every row, not an empty filter', (await a.text('.title-harness')) === 'Codex' && ((await a.text('.chip-on')) ?? 'All') === 'All' && (await rowKeys(a)).length > 0, `${await a.text('#header')} ${await a.text('.chips')}`);
  await a.click('#harness-back');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-skills');
  const firstMark = () => a.run(`document.querySelector('.ov-row[data-key] .tool-mark')?.dataset.tool ?? null`);
  same('a harness’s skills put its own mark first on each row, and have no column heads', [await firstMark(), await a.exists('.ov-head')], ['copilot-cli', false]);
  const away = await a.run(`[...document.querySelectorAll('[role="rowgroup"]')].find(group => group.querySelector('.ov-section-label strong')?.textContent === 'Not in Copilot CLI')?.querySelector('[data-key="release-notes"]') ? true : false`);
  check('a skill only other tools have is under "Not in Copilot CLI"', away);
  check('a harness’s page has no menus or Add from… to bring items in: a found row’s Add does', !(await a.exists('.tool-menu, #harness-add-from, .tool-head-button')));
  await a.click('#add-release-notes');
  await a.shot('harness-switched');
  check('turning it on from a harness’s page copies it to every tool at once', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')) && existsSync(join(practice, '.codex/skills/release-notes/SKILL.md')));
  check('and says so there', await a.exists('.harness-page .band-done'), await a.text('.harness-page'));
  await a.click('#nav-harnesses');
  check('the sidebar’s Harnesses leaves that result behind', !(await a.exists('.band-done')), await a.text('#page'));
  await a.click('#nav-skills');
  check('the Skills page shows the same change and is its usual self: Claude Code first, no "Not in" section', (await switchOn(a, 'release-notes')) && (await firstMark()) === 'claude-cli' && !(await a.all('.ov-section-label strong')).some(label => label.startsWith('Not in')), await a.text('#page'));
  await a.click('#nav-harnesses');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-skills');
  await a.click('#nav-overview');
  await a.click('#overview-skills-differ');
  check('after a harness’s Skills tab, the Overview’s “different copies” link still opens Skills narrowed to them', (await a.text('.chip-on') ?? '').startsWith('Copies differ'), await a.text('.chips'));
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
 * meanwhile; then every tool left out; then another build's home, where no switch can be turned.
 */
async function manageFlow() {
  const a = await launch(join(scratch, 'manage-data'), ['--practice-copy']);
  const practice = await a.run(`document.querySelector('.status-home').title`);
  const switches = () => a.all('[id^="manage-"][role="switch"]', 'e.id + ":" + e.getAttribute("aria-checked")');
  // standup on in every tool first, so Codex has a copy of Central Knot's while it is left out.
  await a.click('#nav-skills');
  await a.click('#add-standup');
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
  check('the Overview names the managed tools and says Codex is left out', (await a.text('.overview-lead') ?? '').includes('the same in Claude Code and Copilot CLI. Codex is left out (its switch is on Harnesses).'), await a.text('.overview-lead'));
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
  same('with every tool left out, the sidebar holds only the pages that need no tool', await a.all('#nav [id^="nav-"]', 'e.id.slice(4)'), ['overview', 'harnesses', 'history', 'sources', 'repo', 'settings']);
  await a.click('#nav-overview');
  same('its Overview names the tools left out and opens Harnesses', [await a.text('.overview-lead'), await a.exists('#overview-open-harnesses'), await a.exists('#overview-choose-home')],
    ['Central Knot manages none of the tools here: Claude Code, Copilot CLI and Codex are left out.', true, false]);
  same('and the status bar’s switch has nothing to sync', await a.text('#sync-switch .sync-state'), 'Nothing to sync');
  await fitsAtMinimum(a, 'a home with every tool left out');
  await a.click('#overview-open-harnesses');
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli']) await a.click(`#manage-${tool}`);
  same('every tool managed again', await switches(), ['manage-claude-cli:true', 'manage-copilot-cli:true', 'manage-codex-cli:true']);
  // Another build syncs this home: every switch is disabled, and the list's note says why, once.
  const record = join(practice, '.central-knot/sync.json');
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), owner: 'another-build', ownerName: 'Central Knot Alpha' }));
  await a.click('#header-refresh');
  same('in another build’s home no Manage switch can be turned', await a.all('[id^="manage-"][role="switch"]', 'e.disabled'), [true, true, true]);
  check('and the note says why, once', ((await a.text('.tools-note')) ?? '').includes('Central Knot Alpha syncs this home, so which tools it manages can’t change from here.') && !(await a.exists('.harness-manage-line')), await a.text('.tools-note'));
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
 * The copy question of the skill `key`, open under its row: what its rows say (`words`), its shape at each window size, then in
 * the Files view's pane (where Read both copies leads), with nothing cut off. The pane is narrow at 1728×1117; at 2560×1440 the
 * file's column stops at the file's box and the question takes the rest. It ends back on the table at full size, the question
 * still open.
 */
async function copyQuestionFits(a, key, words) {
  same('each row quotes its copy’s first line, in quotation marks, and says what choosing it does', await copyQuestionWords(a, false), words);
  for (const [width, height, shape] of [[...SMALLEST, 'under'], [1280, 800, 'under'], [1728, 1117, 'beside'], [2560, 1440, 'beside']]) {
    await sizeTo(a, width, height);
    same(`at ${width}×${height} the copy question’s list is ${shape} the question, as wide as its box, clear of the close button, nothing cut off`, [...await a.run(copyQuestionMisfits(shape)), ...await a.run(CUT_OFF)], []);
  }
  await a.click(`#diff-${key}`);
  await sizeTo(a, 1728, 1117);
  same('in the Files view’s pane, beside the file, each row has its name and Use this copy on one line and what it says under both', [...await a.run(copyQuestionMisfits('pane')), ...await a.run(CUT_OFF)], []);
  await sizeTo(a, 2560, 1440);
  same('at 2560×1440 the file’s column ends with the file’s box, and the question beside it has the rest: its list under the question', [...await a.run(FILE_COLUMN_BLANK), ...await a.run(copyQuestionMisfits('under')), ...await a.run(CUT_OFF)], []);
  await a.click('#skills-table');
  await fullSize(a);
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
  await a.click('#add-changelog');
  same('an agent’s rows quote one stretch of a long line, each copy’s own words tinted, with when it was edited under its name (all are 3 lines, so no size)', await copyQuestionWords(a), [
    { quote: '“…change what someone sees. One line each.”', tinted: [], does: 'Replaces Copilot CLI’s copy and Codex’s copy.', under: 'edited 9 days ago' },
    { quote: '“…change what someone sees. One line each. Say who asked.”', tinted: ['Say who asked.'], does: 'Replaces Claude Code’s copy and Codex’s copy.', under: 'edited 5 days ago' },
    { quote: '“…change what someone sees. One line each. Link the pull request.”', tinted: ['Link the pull request.'], does: 'Replaces Claude Code’s copy and Copilot CLI’s copy.', under: 'edited 2 days ago · Newest' },
  ]);
  await a.click('#diff-changelog');
  check('Read every copy opens each of the three prompts in full', (await a.all('.compare-copies .content', 'e.textContent')).length === 3, await a.text('.details-differs'));
  for (const [width, height, shape, copies] of [[1280, 800, 'under', 'one under the other'], [1728, 1117, 'beside', 'one under the other'], [2560, 1440, 'beside', 'beside each other']]) {
    await sizeTo(a, width, height);
    same(`at ${width}×${height} an agent’s three copies in full are under the list and as wide as it, ${copies}, the list ${shape} the question`,
      [...await a.run(copyQuestionMisfits(shape)), ...await a.run(CUT_OFF), await a.run(`new Set([...document.querySelectorAll('.compare-copies .content')].map(e => Math.round(e.getBoundingClientRect().top))).size`)], [copies === 'beside each other' ? 1 : 3]);
  }
  await fullSize(a);
  await a.click('#close-changelog');
  for (const [file] of files) rmSync(join(practice, file), { force: true });
  await a.click('#header-refresh');
  check('the check’s own agent is gone again', !(await rowKeys(a)).includes('changelog'), await rowKeys(a));
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
  await a.click('#add-loose');
  same('a copy another tool will not load keeps its row, disabled, with no Use this copy; the other two have theirs',
    await a.run(`[...document.querySelectorAll('.details-differs .version')].map(row => [row.id, row.disabled, !!row.querySelector('.version-cta')])`),
    [['use-loose-claude-cli', true, false], ['use-loose-copilot-cli', false, true], ['use-loose-codex-cli', false, true]]);
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
  await a.click('#close-loose');
  for (const root of Object.keys(folders)) rmSync(join(practice, root, 'loose'), { recursive: true, force: true });
  await a.click('#header-refresh');
  check('the check’s own skill is gone again', !(await rowKeys(a)).includes('loose'), await rowKeys(a));
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
  same('rows', (await rowKeys(a)).sort(), ['notes', 'release-notes', 'review', 'standup']);
  same('nothing is on at first', await Promise.all(['notes', 'release-notes', 'review', 'standup'].map(key => switchOn(a, key))), [false, false, false, false]);
  same('every skill is found: under Found, with Add where a switch would be, saying what a click does', [await sectionsNow(a), await a.all('.ov-row[data-key] .add-item', 'e.textContent'), await a.exists('.ov-row[data-key] .switch'), await a.run(`document.querySelector('#add-notes').title`)],
    [[['found', ['notes', 'release-notes', 'review', 'standup']]], ['Add', 'Add', 'Add', 'Add'], false, 'Add notes to Central Knot and put it in every tool']);
  same('a found row’s name starts where an On row’s does: Add is as wide as the switch', await a.run(`document.querySelector('#add-notes').getBoundingClientRect().width`), 32);
  same('no column heads, and no filter chips while All would be alone with Copies differ', [await a.exists('.ov-head'), await a.all('.chip', 'e.dataset.tip')], [false, ['All', 'Copies differ']]);
  same('marks say what each tool has', [await cellState(a, 'release-notes', 'claude-cli'), await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'review', 'copilot-cli')], ['own-copy', 'none', 'own-copy']);
  same('a found row’s only controls are its Add and its chevron: marks and Copies differ are only said', await a.all('.ov-row[data-key="review"] button', 'e.id'), ['add-review', 'open-review']);
  check('copies differ is flagged', await a.exists('#decide-review'));
  await a.shot('practice-overview');
  const practice = await a.run(`document.querySelector('.status-home').title`);
  check('practice home is not the disposable real home', practice !== HOME && existsSync(practice), practice);
  const reviewClaude = readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8');
  const reviewCopilot = readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8');
  /** Opens a row's details (`open` false: closes them), whichever way they are now. */
  const opened = async (key, open = true) => { if ((await a.run(`document.querySelector('#open-${key}')?.getAttribute('aria-expanded')`) === 'true') !== open) await a.click(`#open-${key}`); };
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
  // the list, as it is for a real click; each row still goes under the heading true for it at once.
  const pointerOver = async selector => {
    const at = await a.run(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return box ? [box.left + box.width / 2, box.top + box.height / 2] : null; })()`);
    if (at) await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] });
  };
  await pointerOver('.ov-row[data-key="notes"]');
  // The strip's Undo of taking it in leaves every folder as it was before the click: the copies it made go, the tools it was
  // found in keep theirs, and notes is found again. Then it is taken in again for the checks below.
  const notesFound = folders('notes');
  await a.click('#add-notes');
  await a.click('#outcome-undo');
  same('Undo of taking a found skill in leaves every folder as before, and it is found again', [folders('notes'), await a.exists('#add-notes'), /^Undone: notes is as before\./.test(await a.text('.band-done') ?? '')], [notesFound, true, true]);
  await pointerOver('.ov-row[data-key="notes"]');
  await a.click('#add-notes');
  same('adding a found skill takes it in and writes it to every tool at once, byte for byte', [await switchOn(a, 'notes'), folders('notes')[2], folders('notes')[1]], [true, folders('notes')[0], folders('notes')[0]]);
  const statusBarShows = () => a.run(`(() => { const region = document.querySelector('#announcement'); return region.classList.contains('visually-hidden') ? '' : region.dataset.text; })()`);
  check('the result says where it is now, in the strip at the top only', (await a.text('.band-done') ?? '').includes('notes is in Central Knot now, and on in all 3 tools.') && !(await statusBarShows()), [await a.text('.bands'), await statusBarShows()]);
  same('and its row is under On at once, the pointer over the list too: each heading is true for its rows and counts them', [(await sectionsNow(a))[0], await a.text('.ov-section[data-section="on"] .ov-section-count')], [['on', ['notes']], '1']);
  await pointerOver('.toolbar');
  // Off takes the folder out of every tool; Central Knot keeps it. Its Undo (On) puts every folder back, byte for byte.
  const notesOn = folders('notes');
  await a.click('#switch-notes');
  same('Off takes its folder out of every tool; its row stays, off, in Central Knot only', [folders('notes'), await a.run(`document.querySelector('#switch-notes').getAttribute('aria-checked')`), /in Central Knot only/.test(await a.text('.ov-row[data-key="notes"]') ?? '')], [[null, null, null], 'false', true]);
  check('the result says Central Knot keeps it, with Undo', /notes is off: no tool has it\. Central Knot keeps it/.test(await a.text('.band-done') ?? '') && await a.exists('#outcome-undo'), await a.text('.bands'));
  await a.click('#outcome-undo');
  same('Undo puts each folder back, byte for byte', [folders('notes'), await switchOn(a, 'notes')], [notesOn, true]);
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
  await a.click('#add-same-everywhere');
  same('a skill already the same everywhere is taken in with nothing written', [await switchOn(a, 'same-everywhere'), sameStats()], [true, sameBefore]);
  await opened('same-everywhere');
  await a.click('#delete-same-everywhere');
  await a.click('#delete-confirm-same-everywhere');
  same('Delete from Central Knot takes it out of every tool and off the page', [sameStats(), (await rowKeys(a)).includes('same-everywhere')], [[null, null, null], false]);
  for (const key of ['release-notes', 'standup']) await a.click(`#add-${key}`);
  await a.click('#header-refresh');
  same('Refresh regroups the rows: the three are On', (await sectionsNow(a))[0], ['on', ['notes', 'release-notes', 'standup']]);
  same('copies written every way', [existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), existsSync(join(practice, '.claude/skills/standup/SKILL.md')), existsSync(join(practice, '.codex/skills/standup/SKILL.md'))], [true, true, true]);
  same('copy bytes match', tree(join(practice, '.copilot/skills/release-notes')), tree(join(practice, '.claude/skills/release-notes')));
  check('Codex’s own .system skills stay untouched and unlisted', existsSync(join(practice, '.codex/skills/.system/openai-docs/SKILL.md')) && !(await rowKeys(a)).includes('openai-docs'));

  await blockedCopyKeepsItsRow(a, practice);
  // Copies differ: Add opens the question and writes nothing; a choice takes the skill in with that copy, and the copy it
  // replaced is kept as a version.
  await a.click('#add-review');
  check('Add on a differing row opens the choice instead of taking it in', await a.exists('#use-review-copilot-cli') && !(await switchOn(a, 'review')) && readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') === reviewClaude);
  await a.shot('practice-compare');
  await fitsAtMinimum(a, 'a copy choice open');
  await copyQuestionFits(a, 'review', [
    { quote: '“Read the supplied changes. Explain what changed, what to check, and what is still unknown.”', tinted: [], does: 'Replaces Copilot CLI’s copy; adds it to Codex.' },
    { quote: '“Read the pull request. List defects first, then missing tests. Ignore style unless it hides a bug.”', tinted: [], does: 'Replaces Claude Code’s copy; adds it to Codex.' },
  ]);
  await a.click('#use-review-copilot-cli');
  same('the chosen copy is used in every tool, and it is on', [readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), readNow(join(practice, '.codex/skills/review/SKILL.md')), await switchOn(a, 'review')], [reviewCopilot, reviewCopilot, true]);
  check('the result names the copy chosen and says the others are kept as versions', (await a.text('.band-done') ?? '').includes('review is in Central Knot now, with Copilot CLI’s copy, and on in all 3 tools. The other copies are kept as its versions.'), await a.text('.bands'));
  const reviewVersions = join(practice, '.central-knot/items/skills/review/versions');
  check('the replaced copy is kept in Central Knot’s store', readdirSync(reviewVersions).some(version => readNow(join(reviewVersions, version, 'SKILL.md')) === reviewClaude), readdirSync(reviewVersions));
  check('no longer flagged', !(await a.exists('#decide-review')));
  // Make current writes the replaced copy everywhere. Claude Code's skills folder can't be written for a moment: its write
  // waits there, its line says why, and it catches up once the folder can be written.
  await opened('review');
  /** Each version's line as the opened row shows it: where it came from, what it changed, and the current mark. */
  const versionsShown = () => a.all('.version-row', `e.querySelector('.version-from').textContent`);
  same('the opened row lists two versions: the chosen copy, current, then Claude Code’s', [(await versionsShown()).length, /Current$/.test((await versionsShown())[0] ?? ''), /Claude Code/.test((await versionsShown())[1] ?? '')], [2, true, true]);
  const claudeSkills = join(practice, '.claude/skills');
  chmodSync(claudeSkills, 0o555);
  await a.click('#version-current-review-1');
  for (let tries = 0; tries < 30 && readNow(join(practice, '.codex/skills/review/SKILL.md')) !== reviewClaude; tries++) await wait(100);
  same('Make current writes the earlier version everywhere it can; Claude Code’s write waits, and its mark says it can’t take it yet', [readNow(join(practice, '.codex/skills/review/SKILL.md')), readNow(join(practice, '.claude/skills/review/SKILL.md')), await cellState(a, 'review', 'claude-cli')], [reviewClaude, reviewCopilot, 'cannot']);
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
  for (let tries = 0; tries < 80 && !(await offMarks(a, 'release-notes')).length; tries++) await wait(100);
  same('a switch set in Claude Code’s settings reaches the open page, and is read, not undone: the folder stays, the mark is off, the tag says so', [folders('release-notes').every(Boolean), await offMarks(a, 'release-notes'), /switched off in Claude Code/.test(await a.text('.ov-row[data-key="release-notes"]') ?? ''), await switchOn(a, 'release-notes')], [true, ['claude-cli'], true, true]);
  await opened('release-notes');
  check('its line in the opened row says the tool doesn’t load it', /Claude Code doesn’t load it, and Central Knot leaves that switch as it is/.test(await a.text('.details') ?? ''), await a.text('.details'));
  await a.click('#clear-switch-release-notes-claude-cli');
  same('Clear the switch clears it in Claude Code’s settings, and the mark is on again', [JSON.parse(readSwitches()[0]).skillOverrides?.['release-notes'], await offMarks(a, 'release-notes')], [undefined, []]);
  await opened('release-notes', false);

  // A tool's own switch in the opened row keeps the skill out of that tool alone: partial, which its tag and switch say. Its
  // Undo puts the same folder back.
  const standupOn = folders('standup');
  await opened('standup');
  await a.click('#enable-standup-codex-cli');
  same('Codex’s switch takes Codex’s folder out, leaves the others, and marks Codex as kept out', [folders('standup').map(Boolean), await cellState(a, 'standup', 'codex-cli')], [[true, true, false], 'kept-out']);
  same('the row says where it is, and its switch shows it partial', [/in 2 of 3 tools · kept out of Codex/.test(await a.text('.ov-row[data-key="standup"]') ?? ''), await a.exists('#switch-standup.switch-partial'), await a.run(`document.querySelector('#switch-standup').title`)],
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
  await a.click('#profile-new');
  await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = 'Incident'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await a.settle();
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
  const openRow = async (key, probe) => { if (!(await a.exists(probe))) await a.click(`#open-${key}`); };
  await switchFromBar('Incident');
  check('the switch’s result shows on Skills, with Undo switch', /^Switched to Incident/.test(await a.text('.band-done') ?? '') && await a.exists('#outcome-undo'), await a.text('.bands'));
  same('a skill it leaves out is under Off, in Central Knot only', [(await sectionsNow(a)).find(([section]) => section === 'off')?.[1], folders('standup')], [['release-notes', 'review', 'standup'], gone]);
  // Turned back on by hand: the profile in use is worked out, so the status bar follows at once.
  await a.click('#switch-standup');
  same('after a hand click no profile is in use, and the status bar says so', (await a.text('#status-profile'))?.trim(), 'No profile');
  // On History, the switch's Undo turns back only what is still as the switch left it: standup, turned on since, stays.
  await a.click('#nav-history');
  await a.run(`document.querySelector('.history-row[data-kind="profile"] .history-actions button').click()`); await a.settle();
  check('its Undo from History says what it did, in the status bar', /^Undone: 2 items turned on\./.test(await statusShown() ?? ''), await statusShown());
  same('…and every skill is on again', skillsOn.map(key => folders(key).every(Boolean)), [true, true, true, true]);
  await a.click('#nav-skills');
  // An armed Delete from Central Knot stays on the visit it was clicked on.
  const standupOpen = () => openRow('standup', '#delete-standup, #delete-confirm-standup');
  await standupOpen(); await a.click('#delete-standup');
  await a.click('#nav-overview'); await a.click('#nav-skills'); await standupOpen();
  check('an armed Delete from Central Knot is disarmed by leaving the page', await a.exists('#delete-standup') && !(await a.exists('#delete-confirm-standup')), await a.all('.delete-armed button'));

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
  await a.run(`document.querySelector('.sync-notice[data-kind="edit"] [id^="notice-undo-"]').click()`);
  await a.settle();
  same('Undo makes the version before it current again, everywhere', [readFileSync(standupPath('claude'), 'utf8'), readFileSync(standupPath('copilot'), 'utf8')], [standupBefore, standupBefore]);
  const releaseNotesIn = () => ['claude', 'copilot', 'codex'].map(tool => existsSync(join(practice, `.${tool}/skills/release-notes/SKILL.md`)));
  const releaseNotesOn = folders('release-notes');
  rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
  await a.click('#header-refresh');
  check('a fresh deletion waits for the settle window: nothing removed or put back yet', existsSync(join(practice, '.claude/skills/release-notes')) && !existsSync(join(practice, '.copilot/skills/release-notes')));
  await wait(2200);
  await a.click('#header-refresh');
  same('then the skill turns off everywhere', releaseNotesIn(), [false, false, false]);
  check('with a notice that Central Knot keeps it, offering Turn on', (await a.text('.sync-notices') ?? '').includes('release-notes was deleted in Copilot CLI, so it is off and was taken out of Claude Code and Codex. Central Knot keeps it') && /Turn on/.test(await a.text('.sync-notices') ?? ''), await a.text('.bands'));
  check('and the table keeps it under Off, in Central Knot only', ((await sectionsNow(a)).find(([role]) => role === 'off')?.[1] ?? []).includes('release-notes') && /in Central Knot only/.test(await a.text('.ov-row[data-key="release-notes"]') ?? '') && !(await switchOn(a, 'release-notes')), await sectionsNow(a));
  await a.click('#nav-history');
  check('History lists it', (await a.text('#history-scroll') ?? '').includes('release-notes'), await a.text('#history-scroll'));
  await a.shot('practice-history');
  await a.click('#nav-skills');
  await a.click('#switch-release-notes');
  same('turning it on puts every folder back as it was', [folders('release-notes'), await switchOn(a, 'release-notes')], [releaseNotesOn, true]);
  check('with Undo', await a.exists('#outcome-undo'), await a.text('.bands'));
  await a.click('#outcome-undo');
  same('whose Undo takes it out of every tool again: off, in Central Knot only', [releaseNotesIn(), /in Central Knot only/.test(await a.text('.ov-row[data-key="release-notes"]') ?? ''), await switchOn(a, 'release-notes')], [[false, false, false], true, false]);
  await a.click('#switch-release-notes');
  same('and on again puts it back once more', releaseNotesIn(), [true, true, true]);

  // A damaged record stops every write, and the page says so in its bands; put back, sync carries on.
  const syncRecord = join(practice, '.central-knot/sync.json'), goodRecord = readFileSync(syncRecord, 'utf8');
  writeFileSync(syncRecord, '{ damaged');
  await a.click('#header-refresh');
  same('a damaged record is said in the bands, and every switch is off', [/The sync record is damaged/.test(await a.text('.bands') ?? ''), await a.run(`[...document.querySelectorAll('.ov-row[data-key] :is(.switch, .add-item)')].every(item => item.disabled)`)], [true, true]);
  writeFileSync(syncRecord, goodRecord);
  await a.click('#header-refresh');
  check('put back, the switches work again', !(await a.run(`document.querySelector('#switch-notes').disabled`)), await a.text('.bands'));
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
  await wait(800);
  check('and the page hears about it without a click', (await a.text('.sync-notices') ?? '').includes("standup was edited in Copilot CLI"), await a.text('.bands'));
  // A background read whose reply arrives while an action runs is set aside, but the notice it carried still reaches the page. (A dev run only: it slows a reply in the main process.)
  if (main) {
    check('the refresh reply is slowed', await main.slowReply('discovery:refresh', 1500));
    writeFileSync(standupPath('codex'), standupBefore.replace(/\n*$/, '\nEdited in Codex during an action.\n'));
    await main.tellPage('sync:changed');
    await wait(300);
    await a.run(`(document.querySelector('#header-refresh').click(), true)`);
    await wait(3500);
    await main.restore('discovery:refresh');
    let keptNotice = false;
    for (let tries = 0; tries < 40 && !keptNotice; tries++) { await wait(250); keptNotice = (await a.text('.sync-notices') ?? '').includes('standup was edited in Codex'); }
    check('a notice from a background read set aside for an action is still shown', keptNotice, await a.text('.bands'));
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
  // Sync off: edits are noted, not spread; the page shows them pending; Sync once spreads them once.
  await a.click('#sync-switch');
  same('Sync turns off', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'false');
  writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited with Sync off.\n'));
  let shownPending = false;
  for (let tries = 0; tries < 40 && !shownPending; tries++) { await wait(250); shownPending = (await cellState(a, 'standup', 'claude-cli')) === 'edited'; }
  check('with Sync off the page shows the edit as pending on its own, without Read again', shownPending);
  await a.click('#header-refresh');
  check('with Sync off nothing spreads', !readFileSync(standupPath('copilot'), 'utf8').includes('Sync off'));
  same('the edit shows as waiting to spread, not as a choice', [await cellState(a, 'standup', 'claude-cli'), await cellState(a, 'standup', 'copilot-cli'), await a.exists('#decide-standup')], ['edited', 'gets-it', false]);
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
  same('History says the deletion turned it off everywhere, and offers Turn on', await a.run(`[${standupDeleted}?.querySelector('.history-about')?.textContent, ${standupDeleted}?.querySelector('.history-actions button')?.textContent]`),
    ['Its copy was deleted in Claude Code, so it was turned off and removed from Copilot CLI and Codex. Central Knot keeps it.', 'Turn on']);
  await a.run(`${standupDeleted}.querySelector('.history-actions button').click()`);
  await a.settle();
  check('Turn on brings standup back', existsSync(join(practice, '.claude/skills/standup/SKILL.md')) && existsSync(join(practice, '.copilot/skills/standup/SKILL.md')));
  await a.click('#nav-skills');
  await a.click('#nav-skills');
  same('review keeps the version made current, in every tool', ['claude', 'copilot', 'codex'].map(tool => readNow(join(practice, `.${tool}/skills/review/SKILL.md`))), [reviewClaude, reviewClaude, reviewClaude]);
  same('each tool has the current version', [await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'standup', 'claude-cli'), await cellState(a, 'notes', 'claude-cli')], ['current', 'current', 'current']);
  same('on', await switchOn(a, 'release-notes'), true);
  await a.shot('practice-applied');

  // Details open under a row.
  await a.click('#open-release-notes');
  check('details say it is on in every tool', (await a.text('.details')).includes('On in all 3 tools'), await a.text('.details'));
  await a.click('#open-release-notes');

  // With four tools beside an open sidebar the name column is narrowest: a flagged name still fits. The found skill whose
  // copies differ is the check's own: it is taken out again.
  for (const [root, body] of [['.claude/skills', 'Ask a second reviewer.'], ['.copilot/skills', 'Ask someone else to look.']]) skill(join(practice, root), 'second-opinion', text('second-opinion', body));
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.click('#header-refresh');
  check('a Pi folder gives each row a fourth mark', await a.exists('#cell-review-pi-cli') && await a.exists('#decide-second-opinion'));
  await fitsAtMinimum(a, 'Skills with four tools');
  await a.click('#decide-second-opinion');
  await fitsAtMinimum(a, 'a copy choice with four tools');
  await a.click('#decide-second-opinion');
  rmSync(join(practice, '.pi'), { recursive: true, force: true });
  await a.click('#header-refresh');
  const nameFits = await a.run(`(() => { const cell = document.querySelector('.ov-row[data-key="second-opinion"] .ov-name'); return cell.scrollWidth <= cell.clientWidth + 1 && cell.getBoundingClientRect().height < 44; })()`);
  check('the name cell does not overflow or wrap', nameFits);
  for (const root of ['.claude/skills', '.copilot/skills']) rmSync(join(practice, root, 'second-opinion'), { recursive: true, force: true });
  await a.click('#header-refresh');

  // Focus stays on the switch after its click redraws the page.
  await a.run(`document.querySelector('#switch-release-notes').focus()`);
  await a.press(' ', 'Space');
  same('focus stays on the switch', [await a.run(`document.activeElement?.id`), await switchOn(a, 'release-notes')], ['switch-release-notes', false]);
  await a.press(' ', 'Space');
  same('and it turns back on', await switchOn(a, 'release-notes'), true);

  // Skills Files view: every skill in a list, and one skill's files and contents with the same switch and controls as the table.
  await a.click('#nav-skills');
  const tableOrder = await rowKeys(a);
  await a.click('#open-standup');
  await a.click('#files-standup');
  same('the Skills list has every skill, in the table’s order', await a.run(`[...document.querySelectorAll('.list-row')].map(row => row.id.replace(/^list-/, ''))`), tableOrder);
  await a.click('#list-standup');
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
  await a.click('#detail-switch-standup');
  same('its switch here applies at once, as the table’s does', [await a.run(`document.querySelector('#detail-switch-standup').getAttribute('aria-checked')`), existsSync(standupPath('claude'))], ['false', false]);
  await fitsAtMinimum(a, 'the Files view');
  await a.shot('practice-skills');
  await a.press('Escape');
  check('Escape leaves the Files view for the table, which agrees', !(await a.exists('.split')) && await a.exists('.ov-row[data-key="standup"]') && !(await switchOn(a, 'standup')));
  await a.click('#switch-standup');
  // A later skill chosen in the side-by-side Files view stays in view when the window narrows into the stacked list.
  for (let n = 1; n <= 6; n++) { mkdirSync(join(practice, `.claude/skills/zz-${n}`), { recursive: true }); writeFileSync(join(practice, `.claude/skills/zz-${n}/SKILL.md`), text(`zz-${n}`)); }
  await a.click('#header-refresh');
  if (!(await a.exists('#files-standup'))) await a.click('#open-standup');
  await a.click('#files-standup');
  await a.click('#list-zz-6');
  await sizeTo(a, ...SMALLEST);
  check('the chosen row stays in view in the stacked list', await a.run(`(() => { const list = document.querySelector('#skills-list'), row = document.querySelector('#list-zz-6'), head = list.querySelector('.list-head'); const area = list.getBoundingClientRect(), box = row.getBoundingClientRect(); return box.top >= area.top + head.offsetHeight - 1 && box.bottom <= area.top + list.clientHeight + 1; })()`));
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
  await fullSize(a);
  for (let n = 1; n <= 6; n++) rmSync(join(practice, `.claude/skills/zz-${n}`), { recursive: true, force: true });
  await a.click('#header-refresh');
  // A large display docks an open row's details beside the table, and nothing on it is cut off; laptop full screen docks too.
  await sizeTo(a, 2560, 1440);
  if (!(await a.exists('.ov-row.open[data-key="standup"]'))) await a.click('#open-standup');
  check('at 2560 the details dock beside the table', await a.exists('.ov-page.docked .dock .details') && !(await a.exists('.ov-row + .details')));
  same('nothing cut off at 2560×1440 with details docked', await a.run(CUT_OFF), []);
  await sizeTo(a, 1728, 1117);
  check('at 1728 the details dock too', await a.exists('.dock .details'));
  check('and hold each tool’s own switch', await a.exists('.dock #enable-standup-codex-cli'));
  await a.click('#dock-close');
  await fullSize(a);
  // Open details never repeat an id.
  await a.click('#open-review');
  same('no duplicate ids with details open', await a.run(`(() => { const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return ids.filter((id, index) => ids.indexOf(id) !== index); })()`), []);
  await a.click('#open-review');
  // Slash finds in the Files view too.
  await a.click('#open-review');
  await a.click('#files-review, #diff-review');
  await a.run(`document.activeElement?.blur()`);
  await a.press('/', 'Slash');
  same('slash focuses find in the Files view', await a.run(`document.activeElement?.id`), 'skills-find');
  await a.click('#skills-table');

  // Keyboard and find.
  await a.press('/', 'Slash');
  same('slash focuses find', await a.run(`document.activeElement?.id`), 'find');
  await a.run(`(() => { const i = document.querySelector('#find'); i.value = 'stand'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.settle();
  same('find filters', await rowKeys(a), ['standup']);
  await a.press('Escape');
  same('Escape clears find', (await rowKeys(a)).length, 4);
  // MCP servers: on Central Knot's library, as skills and agents are. A server a tool has is found: Add takes it in and puts it
  // in every tool by editing only that entry; Claude Code's file waits for Write to Claude Code, one band for every server that owes it.
  await a.click('#nav-mcp');
  same('MCP servers from every tool, found', [(await rowKeys(a)).sort(), await sectionsNow(a)], [['docs', 'files'], [['found', ['docs', 'files']]]]);
  same('files is in Copilot and Codex, not in Claude Code', [await cellState(a, 'files', 'copilot-cli'), await cellState(a, 'files', 'codex-cli'), await cellState(a, 'files', 'claude-cli')], ['own-copy', 'own-copy', 'none']);
  check('a found server has Add where a switch would be, and there is no Apply all', await a.exists('#add-docs') && !(await a.exists('#switch-docs')) && !(await a.exists('#apply, #manage-all')));
  const tomlBefore = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  await a.click('#add-docs');
  // files is added from the keyboard (focus on its Add, as Tab leaves it): its row moves under On at once, and each heading counts its rows.
  await a.run(`document.querySelector('#add-files').focus()`);
  await a.press('Shift');
  await a.click('#add-files');
  same('after a click each row is under the heading true for it, from the keyboard too, and the headings count their rows', [await sectionsNow(a), await a.text('.ov-section[data-section="on"] .ov-section-count')], [[['on', ['docs', 'files']]], '2']);
  check('taking files in says where it is on, and that Claude Code waits for Write, as a plain note, not a warning', /^files is in Central Knot now, and on in Copilot CLI and Codex\. Claude Code waits for Write to Claude Code\./.test(await a.text('.band-done .band-text') ?? '')
    && !(await a.exists('.band-done .tone-warning')), [await a.text('.bands'), await a.text('.toolbar')]);
  const copilotMcp = JSON.parse(readFileSync(join(practice, '.copilot/mcp-config.json'), 'utf8')).mcpServers;
  same('docs reached Copilot with its header as-is', copilotMcp.docs, { type: 'http', url: 'https://docs.example.test/mcp', headers: { Authorization: 'Bearer practice-token' }, tools: ['*'] });
  const tomlAfter = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  check('docs reached Codex, and config.toml kept its comment and the files table byte for byte', tomlAfter.startsWith(tomlBefore) && tomlAfter.includes('[mcp_servers.docs]') && tomlAfter.includes('url = "https://docs.example.test/mcp"'), tomlAfter);
  const claudeBefore = readFileSync(join(practice, '.claude.json'), 'utf8');
  check('Claude Code waits for Write to Claude Code: one band, which says what it writes, and the row’s mark says so too', /wait for Write to Claude Code, to add files\./.test(await a.text('.band-write-now') ?? '') && !JSON.parse(claudeBefore).mcpServers.files
    && await cellState(a, 'files', 'claude-cli') === 'waits', await a.text('.bands'));
  await a.shot('practice-mcp');
  await a.click('#mcp-write-claude');
  const claudeAfter = JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8'));
  same('Write to Claude Code adds files there and keeps its other settings; the band goes', [claudeAfter.mcpServers.files?.command, claudeAfter.theme, claudeAfter.numStartups, await a.exists('#mcp-write-claude')], ['npx', 'dark', 3, false]);
  // Off: out of every tool, Central Knot keeps it; Claude Code's entry goes with Write. Undo puts each entry back as it was.
  const mcpFiles = ['.claude.json', '.copilot/mcp-config.json', '.codex/config.toml'].map(file => join(practice, file));
  const mcpBefore = mcpFiles.map(readNow);
  // Turned off with the pointer over the list, its row open: it moves under Off at once.
  await a.click('#open-files');
  await pointerOver('#switch-files');
  await a.click('#switch-files');
  same('after a click with the pointer over the list too, each row is under the heading true for it', [await sectionsNow(a), await a.text('.ov-section[data-section="on"] .ov-section-count'), await a.text('.ov-section[data-section="off"] .ov-section-count')], [[['on', ['docs']], ['off', ['files']]], '1', '1']);
  await pointerOver('.toolbar');
  await a.click('#open-files');
  same('Off takes files out of Copilot and Codex at once; Claude Code’s entry waits for Write, and the band says it removes it', [!!JSON.parse(readNow(mcpFiles[1])).mcpServers.files, readNow(mcpFiles[2]).includes('[mcp_servers.files]'), !!JSON.parse(readNow(mcpFiles[0])).mcpServers.files, /to remove files/.test(await a.text('.band-write-now') ?? '')],
    [false, false, true, true]);
  await a.click('#outcome-undo');
  same('Undo puts files back in each tool, every file as it was but for the entry’s place, with nothing left to write', [mcpFiles.map(readNow).map(entriesSorted), await switchOn(a, 'files'), await a.exists('#mcp-write-claude')], [mcpBefore.map(entriesSorted), true, false]);
  // A server turned off in one tool, outside Central Knot (as `copilot mcp disable` writes it), is marked so; Central Knot leaves
  // that switch as it is, and its line says so. The opened row keeps a server out of one tool.
  const copilotMcpSwitch = join(practice, '.copilot/settings.json');
  writeFileSync(copilotMcpSwitch, `${JSON.stringify({ ...JSON.parse(readNow(copilotMcpSwitch) || '{}'), disabledMcpServers: ['docs'] }, null, 2)}\n`);
  await a.click('#header-refresh');
  same('a server off in Copilot CLI is marked there', await offMarks(a, 'docs'), ['copilot-cli']);
  await a.click('#open-docs');
  await a.shot('practice-mcp-disabled');
  // Full screen on a 1728×1117 display: the details dock beside the table, and a row's line, its tag and URL here, still shows whole.
  await sizeTo(a, 1728, 1117);
  same('docked at full screen, a row’s line is shortened only when it has no room', await a.all('.ov-row[data-key] .ov-name-about', 'e.scrollWidth <= e.clientWidth'), [true, true]);
  await fullSize(a);
  check('its line says Central Knot leaves that switch as it is', /switched off in Copilot CLI’s own settings: Copilot CLI doesn’t start it\. Central Knot leaves that switch as it is/.test(await a.text('.details') ?? ''), await a.text('.details'));
  const codexBefore = readNow(mcpFiles[2]);
  await a.click('#enable-docs-codex-cli');
  same('its Codex switch keeps it out of Codex at once', [readNow(mcpFiles[2]).includes('[mcp_servers.docs]'), /docs is kept out of Codex/.test(await a.text('.band-done') ?? '')], [false, true]);
  await a.click('#outcome-undo');
  same('Undo puts it back in Codex, every table byte for byte', entriesSorted(readNow(mcpFiles[2])), entriesSorted(codexBefore));
  writeFileSync(copilotMcpSwitch, readNow(copilotMcpSwitch).replace(/,?\n\s*"disabledMcpServers": \[\s*"docs"\s*\]/, ''));
  if (await a.exists('#enable-docs-codex-cli')) await a.click('#open-docs');
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
  same('agents from every tool', (await rowKeys(a)).sort(), ['code-reviewer', 'release-notes']);
  const switchState = key => a.run(`document.querySelector('#switch-${key}').getAttribute('aria-checked')`);
  const agentRow = key => a.text(`.ov-row[data-key="${key}"]`);
  same('an agent only a harness has is found: under Found, with Add, said not to be in Central Knot, and the section says what Add does',
    [await a.text('#add-code-reviewer'), /^Found\s*2/.test((await a.text('[data-section="found"]') ?? '').trim()), /not in Central Knot/.test(await agentRow('code-reviewer') ?? ''),
      /Add one to keep it in Central Knot and turn it on\./.test(await a.text('[data-section="found"]') ?? '')], ['Add', true, true, true]);
  await a.click('#add-code-reviewer');
  // release-notes is added from the keyboard: the rows are shared with Skills and MCP servers, so it is under On at once too.
  await a.run(`document.querySelector('#add-release-notes').focus()`);
  await a.press('Shift');
  await a.click('#add-release-notes');
  same('after a click each agent is under the heading true for it, from the keyboard too', await sectionsNow(a), [['on', ['code-reviewer', 'release-notes']]]);
  const reviewerFiles = ['.claude/agents/code-reviewer.md', '.copilot/agents/code-reviewer.agent.md', '.codex/agents/code-reviewer.toml'].map(file => join(practice, file));
  const [claudeAgent, , codexAgent] = reviewerFiles;
  const reviewerNow = () => reviewerFiles.map(file => (existsSync(file) ? readFileSync(file, 'utf8') : null));
  const taken = reviewerNow();
  check('code-reviewer reached Copilot with name, description and prompt, without Claude Code’s own fields', taken[1].includes('description: Reviews a change') && taken[1].includes('You are a careful code reviewer.') && !taken[1].includes('tools:') && !taken[1].includes('model:'), taken[1]);
  check('release-notes reached Claude Code from Codex', readFileSync(join(practice, '.claude/agents/release-notes.md'), 'utf8').includes('Group them as Added, Changed and Fixed.'));
  check('code-reviewer reached Codex as TOML', taken[2].includes('developer_instructions = """'));
  same('taken in, they are On, and the result says where', [await switchOn(a, 'code-reviewer'), /release-notes is in Central Knot now, and on in all 3 tools/.test(await a.text('main') ?? '')], [true, true]);
  // Off takes the agent out of every harness. Central Knot keeps it: its row stays, off, with its description; On (here the
  // result's Undo) writes every harness's file back byte for byte, Claude Code's own fields included.
  await a.click('#switch-code-reviewer');
  same('Off takes the agent out of every harness; its row moves under Off, in Central Knot only, with its description',
    [reviewerNow(), await switchState('code-reviewer'), /in Central Knot only/.test(await agentRow('code-reviewer') ?? ''), /Reviews a change/.test(await agentRow('code-reviewer') ?? ''), await sectionsNow(a)],
    [[null, null, null], 'false', true, true, [['on', ['release-notes']], ['off', ['code-reviewer']]]]);
  check('the result says Central Knot keeps it', /code-reviewer is off: no tool has it\. Central Knot keeps it/.test(await a.text('main') ?? ''), (await a.text('main') ?? '').slice(0, 300));
  await a.click('#outcome-undo');
  same('Undo turns it on again: every harness’s file is back byte for byte', reviewerNow(), taken);
  await agentCopiesUnderTheList(a, practice);
  // The opened row: each harness's line with what stays its own, and the agent's versions.
  await a.click('#open-code-reviewer');
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
  await a.click('#version-read-code-reviewer-1');
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
  await a.click('#version-current-code-reviewer-1');
  for (let tries = 0; tries < 30 && readFileSync(codexAgent, 'utf8').includes('Edited in Codex.'); tries++) await wait(100);
  same('Make current writes the earlier version to every harness, each file as it was', reviewerNow(), taken);
  same('it is the current version, first, naming the one it went back to, into which that one is folded (one row per content)', [(await versionsShown()).length, /^back to: found in Claude Code, .*Current$/.test((await versionsShown())[0])], [2, true]);
  check('the result names the version and offers Undo', /code-reviewer: the version found in Claude Code, .* is current again, in all 3 tools/.test(await a.text('main') ?? '') && await a.exists('#outcome-undo'), (await a.text('main') ?? '').slice(0, 300));
  // A harness's own switch keeps the agent out of that harness alone; its Undo puts the same file back.
  await a.click('#enable-code-reviewer-codex-cli');
  same('Codex’s own switch takes Codex’s copy out, leaves the others, and marks Codex as kept out, on the closed row too',
    [reviewerNow().map(text => text !== null), await cellState(a, 'code-reviewer', 'codex-cli'), /kept out of Codex/.test(await agentRow('code-reviewer') ?? '')], [[true, true, false], 'kept-out', true]);
  await a.click('#outcome-undo');
  same('its Undo puts Codex’s file back as it was', reviewerNow(), taken);
  // Delete from Central Knot is the one real delete (main.ts passes the click's `deleted` through): out of every harness and
  // off the page. History restores it, every file as it was.
  const notesFiles = ['.claude/agents/release-notes.md', '.copilot/agents/release-notes.agent.md', '.codex/agents/release-notes.toml'].map(file => join(practice, file));
  const notesBefore = notesFiles.map(file => readFileSync(file, 'utf8'));
  await a.click('#open-release-notes');
  await a.click('#delete-release-notes');
  check('armed, it says History keeps it, with its versions, for History’s days', /History keeps it, with its versions, for 30 days, and can restore it\./.test(await a.text('#delete-note-release-notes') ?? ''), await a.text('#delete-note-release-notes'));
  await a.click('#delete-confirm-release-notes');
  same('Delete from Central Knot takes the agent out of every harness and off the page', [notesFiles.map(file => existsSync(file)), (await rowKeys(a)).includes('release-notes')], [[false, false, false], false]);
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
  same('and it is on its page again, on', [(await rowKeys(a)).includes('release-notes'), await switchOn(a, 'release-notes')], [true, true]);
  // A tool uninstalled and back (its folder taken away, then put back) is a tool managed again: Central Knot's version wins
  // there. Turned off while Codex was away, code-reviewer keeps its Codex copy there; edited meanwhile, that copy is kept as a
  // version ("was in Codex") and removed once Codex is back, and the current version stays.
  const openReviewer = async () => { if (await a.run(`document.querySelector('#open-code-reviewer')?.getAttribute('aria-expanded')`) !== 'true') await a.click('#open-code-reviewer'); };
  await openReviewer();
  const reviewerHere = reviewerNow(), currentHere = (await versionsShown())[0];
  renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && await cellState(a, 'code-reviewer', 'codex-cli') !== null; tries++) await wait(100);
  await a.click('#switch-code-reviewer');
  for (let tries = 0; tries < 30 && existsSync(claudeAgent); tries++) await wait(100);
  const awayCopy = join(practice, '.codex-away/agents/code-reviewer.toml');
  writeFileSync(awayCopy, readFileSync(awayCopy, 'utf8').replace('description = "', 'description = "Edited while away. '));
  renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && existsSync(codexAgent); tries++) await wait(100);
  await openReviewer();
  same('a tool managed again: the Off agent’s copy edited there meanwhile is removed and kept as a version, and the current version stays',
    [reviewerNow(), await switchState('code-reviewer'), (await versionsShown())[0], (await versionsShown()).some(line => /^was in Codex/.test(line))], [[null, null, null], 'false', currentHere, true]);
  await a.click('#switch-code-reviewer');
  for (let tries = 0; tries < 30 && !reviewerNow().every(text => text !== null); tries++) await wait(100);
  same('turned on again, every tool has its file back as it was', reviewerNow(), reviewerHere);
  await fitsAtMinimum(a, 'Agents');
  await a.click('#nav-skills');

  // What a plugin installed whole brings shows on Skills and MCP servers with the plugin's mark, before Plugins was ever
  // opened, from a marketplace nothing here has added: Claude Code's own record and copy are enough.
  writeClaudeInstall(practice, 'ck-outside', 'outside-tools', '0.3.0', {
    'skills/outside-skill/SKILL.md': '---\nname: outside-skill\ndescription: Comes with a plugin.\n---\n\nSteps.\n',
    '.mcp.json': JSON.stringify({ mcpServers: { 'outside-server': { command: 'npx', args: ['-y', 'outside'] } } }),
  });
  await a.click('#header-refresh');
  const outside = 'outside-tools@ck-outside/outside-skill', outsideRow = `.ov-row[data-key="${outside}"]`;
  for (let tries = 0; tries < 40 && !(await a.exists(outsideRow)); tries++) await wait(100);
  same('a plugin’s skill is a row with its mark, filled under Claude Code, empty elsewhere, and a switch that is on',
    [/from outside-tools/.test(await a.text(outsideRow) ?? ''), await cellState(a, outside, 'claude-cli'), await cellState(a, outside, 'copilot-cli'), await switchOn(a, outside), await a.exists('.ov-section-plugins')],
    [true, 'plugin', 'plugin-none', true, true]);
  // Its switch turns it off only where a tool has a switch for one skill of a plugin: Claude Code has none, so nothing is
  // written there, and the band says where the whole plugin's switch is.
  const outsideSettings = readNow(join(practice, '.claude/settings.json'));
  await a.click(`${outsideRow} .switch`);
  check('the row’s switch never turns a whole plugin off: Claude Code is left on, and said', readNow(join(practice, '.claude/settings.json')) === outsideSettings && await switchOn(a, outside)
    && /outside-skill: nothing changed\. Still on in Claude Code: it has no switch for one skill of a plugin, only one for the whole plugin, outside-tools\./.test(await a.text('.bands') ?? '')
    && await a.text('#outcome-whole') === 'Turn outside-tools off in Claude Code', [await a.text('.bands'), await a.text('#outcome-whole')]);
  await a.click(`[id="open-${outside}"]`);
  check('its details open with where it is on and which plugin it is from, then where it is handled', /On in Claude Code · from the plugin outside-tools[\s\S]*marketplace “ck-outside”, which isn’t added in Central Knot/.test(await a.text('main') ?? ''), await a.text('main'));
  await a.click('#nav-mcp');
  same('its MCP server too, on the MCP servers page', await cellState(a, 'outside-tools@ck-outside/outside-server', 'claude-cli'), 'plugin');
  rmSync(join(practice, '.claude/plugins'), { recursive: true, force: true });
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && await a.exists('[data-key="outside-tools@ck-outside/outside-server"]'); tries++) await wait(100);
  check('and gone once the plugin is', !(await a.exists('[data-key="outside-tools@ck-outside/outside-server"]')));
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
    check('the refresh request is slowed', await main.slowRequest('discovery:refresh', 3000));
    await a.run(`(document.querySelector('#header-refresh').click(), true)`);
    await wait(1000);
    const busyThen = await a.run(`document.body.dataset.busy`);
    renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
    await main.tellPage('sync:changed');
    await main.restore('discovery:refresh');
    for (let tries = 0; tries < 80 && (await columns()) !== 2; tries++) await wait(100);
    same('a tool change told while the page is busy is read once the work is done', [busyThen, await columns()], ['true', 2]);
    renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
    await a.click('#header-refresh');
    for (let tries = 0; tries < 30 && (await columns()) !== 3; tries++) await wait(100);
    // Two tool changes told back to back, on Skills (whose marks are the home's tools): the first read sees Codex gone,
    // and the second change (Codex back) arrives while that read is still on its way. It is owed, and read as soon as the
    // first ends, so the page ends right.
    await a.click('#nav-skills');
    const heads = () => a.run(`[...(document.querySelector('.ov-row[data-key] .tool-marks')?.children ?? [])].map(mark => mark.dataset.tool)`);
    const all = (await heads()).length;
    check('the refresh reply is slowed', await main.slowReply('discovery:refresh', 1500));
    renameSync(join(practice, '.codex'), join(practice, '.codex-away'));
    await main.tellPage('sync:changed');
    await wait(300);
    renameSync(join(practice, '.codex-away'), join(practice, '.codex'));
    await main.tellPage('sync:changed');
    await main.restore('discovery:refresh');
    for (let tries = 0; tries < 80 && (await heads()).length !== all - 1; tries++) await wait(50);
    const between = (await heads()).length;
    for (let tries = 0; tries < 80 && (await heads()).length !== all; tries++) await wait(100);
    same('two tool changes told back to back: the first read shows, then the second', [between, (await heads()).length], [all - 1, all]);
    // Nothing is left owed: a later action's result stays, rather than being wiped by a read that ran late.
    await wait(2500);
    await a.click('#header-refresh');
    const result = await a.text('#announcement');
    await wait(2500);
    same('and a later result stays said', [await a.text('#announcement'), (await heads()).length], [result, all]);
    check('that result says what was read', /^Read \d/.test(result ?? ''), result);
    // A sync:changed right after an action keeps that action's message: the read it starts brings no new notice.
    await a.click('#nav-skills');
    await a.click('#switch-notes');
    const switched = await a.run(`document.querySelector('#announcement').dataset.text`);
    await main.tellPage('sync:changed');
    await wait(1500);
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
  // Update: Claude Code's 1.9.0 is behind, so its box and one button offer the update; Apply all runs Claude Code's own
  // `plugin update` (a stand-in that moves its record to 2.0.0), and the page reads the new version back from that record.
  same('an out-of-date copy offers Update, for every tool behind', [await a.run(`document.querySelector('#pcell-0-issue-tracker-claude-cli')?.dataset.state`), await a.text('#pupdate-0-issue-tracker')], ['outdated', 'Update in Claude Code']);
  const claudeStub = join(HOME, '.local/bin/claude'), stubBefore = readFileSync(claudeStub, 'utf8');
  const newCopy = join(practice, '.claude/plugins/cache/ck-test-market/issue-tracker/2.0.0');
  writeFileSync(claudeStub, `#!/bin/sh\n[ "$*" = "plugin update issue-tracker@ck-test-market --scope user" ] || exit 9\nmkdir -p '${newCopy}/skills/triage' && cp '${join(market, 'plugins/issue-tracker/skills/triage/SKILL.md')}' '${newCopy}/skills/triage/'\nprintf '{"version":2,"plugins":{"issue-tracker@ck-test-market":[{"scope":"user","installPath":"${newCopy}","version":"2.0.0"}]}}' > "$HOME/.claude/plugins/installed_plugins.json"\necho 'Plugin "issue-tracker" updated from 1.9.0 to 2.0.0 for scope user.'\n`);
  await a.click('#pupdate-0-issue-tracker');
  check('Update only chooses it', await a.run(`document.querySelector('#pcell-0-issue-tracker-claude-cli')?.dataset.state`) === 'update' && /1 update/.test(await a.text('.toolbar') ?? '') && /Will update to 2\.0\.0/.test(await a.text('.plugin-panel') ?? ''), await a.text('.plugin-panel'));
  await a.click('#plugins-apply');
  for (let tries = 0; tries < 30 && !/Installed · 2\.0\.0/.test(await a.text('.plugin-panel') ?? ''); tries++) await wait(100);
  check('Apply all updates it, read back from Claude Code’s record, and says it can’t be undone', /Installed · 2\.0\.0/.test(await a.text('.plugin-panel') ?? '') && !/Marketplace has/.test(await a.text('.plugin-panel') ?? '')
    && /updated to 2\.0\.0 in Claude Code, which can’t be undone/i.test(await a.run(`document.querySelector('#announcement')?.dataset.text ?? ''`)) && !(await a.exists('#plugins-undo')), [await a.text('.plugin-panel'), await a.run(`document.querySelector('#announcement')?.dataset.text`), await a.text('.bands')]);
  // The copy changes at the same version (2.0.0): once read again, the page says so and offers Update. Claude Code's own
  // update keeps its copy ("already at the latest"), so Apply all uninstalls and installs it again, and compares after.
  const triage = join(newCopy, 'skills/triage/SKILL.md'), record = readFileSync(join(practice, '.claude/plugins/installed_plugins.json'), 'utf8');
  writeFileSync(triage, readFileSync(triage, 'utf8') + '\nA line added by hand.\n');
  writeFileSync(claudeStub, `#!/bin/sh\ncase "$*" in\n  "plugin update issue-tracker@ck-test-market --scope user") echo 'issue-tracker is already at the latest version (2.0.0).' ;;\n  "plugin uninstall issue-tracker@ck-test-market --scope user") printf '{"version":2,"plugins":{}}' > "$HOME/.claude/plugins/installed_plugins.json" ;;\n  "plugin install issue-tracker@ck-test-market --scope user") cp '${join(market, 'plugins/issue-tracker/skills/triage/SKILL.md')}' '${triage}' && printf '%s' '${record}' > "$HOME/.claude/plugins/installed_plugins.json" ;;\n  *) exit 9 ;;\nesac\n`);
  await a.click('#nav-skills');
  await a.click('#nav-plugins');
  if (!(await a.exists('#pfile-0-skills-triage'))) await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 30 && !/differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? ''); tries++) await wait(100);
  same('a copy that differs at the same version says so and offers Update', [/Installed · 2\.0\.0 · differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? ''), await a.run(`document.querySelector('#pcell-0-issue-tracker-claude-cli')?.dataset.state`), await a.text('#pupdate-0-issue-tracker')], [true, 'outdated', 'Update in Claude Code']);
  await a.click('#pupdate-0-issue-tracker');
  await a.click('#plugins-apply');
  for (let tries = 0; tries < 30 && /differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? 'differs from the marketplace’s copy'); tries++) await wait(100);
  check('Apply all reinstalls it where Claude Code keeps its copy, and the result says so', !/differs from the marketplace’s copy/.test(await a.text('.plugin-panel') ?? '') && readFileSync(triage, 'utf8') === readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8')
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
  check('a plugin page names what it holds', /release-notes[\s\S]*Drafts release notes/.test(await a.text('.plugin-page')) && (await a.text('.plugin-page')).includes('release-reviewer') && (await a.text('.plugin-page')).includes('Runs on PreToolUse'), await a.text('.plugin-page'));
  await a.click('#plugin-back');
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-readme')); tries++) await wait(100);
  check('and shows the plugin’s own README and skill descriptions', (await a.text('.plugin-page')).includes('Two skills for everyday documents') && (await a.text('.plugin-page')).includes('Reads PDF files'), await a.text('.plugin-page'));
  // A description cut at two lines offers Show more; a width change with the page open, and no redraw, measures it again.
  // Narrower than any window here, with the sidebar open, so the description is held to its two lines; then wide enough
  // for it, still below the sidebar's and the dock's breakpoints, so nothing redraws the page.
  const pdfCut = () => a.run(`(() => { const li = [...document.querySelectorAll('.plugin-parts li')].find(li => li.textContent.includes('pdf-reader')); const what = li?.querySelector('.plugin-part-what'); return [li?.classList.contains('clamped') ?? null, what?.clientWidth]; })()`);
  await sizeTo(a, 720, 560); await a.click('#sidebar-toggle'); await wait(200);
  const narrow = await pdfCut();
  await sizeTo(a, 960, 560); await wait(200);
  const wide = await pdfCut();
  same('Show more follows the description’s width with the same plugin open', [narrow[0], wide[0]], [true, false]);
  if (narrow[0] !== true || wide[0] !== false) console.error('description widths', narrow[1], wide[1]);
  await a.click('#sidebar-toggle'); await fullSize(a);
  await a.click('#pinstall-0-document-tools');
  same('Choose all only chooses: every box waits for Apply all', await a.run(`[...document.querySelectorAll('.plugin-tool .cell-button')].map(cell => cell.dataset.state)`), ['install', 'install', 'install']);
  check('the change bar counts what will run', /1 change · 3 installs/.test(await a.text('.toolbar') ?? ''), await a.text('.toolbar'));
  await fitsAtMinimum(a, 'a plugin page with changes waiting for Apply all');
  await a.click('#plugin-back');
  await fitsAtMinimum(a, 'the plugin table with its tool labels and changes waiting');
  check('a crowded toolbar keeps a short count, with the full summary as its tooltip', await a.run(`(() => { const count = document.querySelector('.plugins-toolbar .apply-count'); return !!count && count.title.includes('3 installs'); })()`));
  await a.click('#popen-0-document-tools');
  for (let tries = 0; tries < 30 && !(await a.exists('.plugin-readme')); tries++) await wait(100);
  await a.click('#pcell-0-document-tools-codex-cli');
  same('clicking a chosen box takes it back', await a.run(`[...document.querySelectorAll('.plugin-tool .cell-button')].map(cell => cell.dataset.state)`), ['install', 'install', 'absent']);
  await a.click('#pcell-0-document-tools-codex-cli');
  await a.click('#plugins-apply');
  check('a refused install is reported as such', /Could not add the marketplace\. It stopped with exit code 9/.test(await a.text('.plugin-problems')), await a.text('.bands'));
  await a.shot('practice-plugins');
  same('and nothing is claimed installed', await a.run(`[...document.querySelectorAll('.plugin-tool .cell-button')].filter(cell => cell.dataset.state === 'installed').length`), 0);
  // A plugin's parts in a tool without plugins (Pi): its skill and MCP server go in as ordinary items, marked as from it, and Undo takes them out.
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.run('window.centralKnot.refresh()');
  await a.click('#nav-skills');
  await a.click('#nav-plugins');
  await a.click('#plugin-back');
  same('Pi is a column whose box offers the plugin’s parts', await a.run(`document.querySelector('#pcell-0-issue-tracker-pi-cli')?.dataset.state`), 'parts-offer');
  await a.click('#popen-0-issue-tracker');
  for (let tries = 0; tries < 40 && !/Can go in/.test(await a.text('.plugin-parts-section') ?? ''); tries++) await wait(100);
  check('its page says what goes into Pi', /takes no plugins[\s\S]*Can go in: skill triage · MCP server issues/.test(await a.text('.plugin-parts-section') ?? ''), await a.text('.plugin-parts-section'));
  await a.click('#pcell-0-issue-tracker-pi-cli');
  await a.click('#plugins-apply');
  const piMcp = join(practice, '.pi/agent/mcp.json');
  check('the skill and MCP server are in Pi, values as they are', existsSync(join(practice, '.pi/agent/skills/triage/SKILL.md')) && existsSync(piMcp) && JSON.parse(readFileSync(piMcp, 'utf8')).mcpServers?.issues?.args?.[1] === '@example/issues-mcp', existsSync(piMcp) ? readFileSync(piMcp, 'utf8') : await a.text('.bands'));
  same('Pi’s box shows its parts', await a.run(`document.querySelector('#pcell-0-issue-tracker-pi-cli')?.dataset.state`), 'parts');
  await a.shot('practice-plugin-parts');
  await a.click('#nav-skills');
  check('the skill says which plugin it came from', /from issue-tracker/.test(await a.text('[data-key="triage"]') ?? ''), await a.text('[data-key="triage"]'));
  // Claude Code has the plugin itself: on Skills its mark says the skill comes through it (never "No copy" or "Can't load
  // it"), and its row in the details opens the plugin's page, where the plugin and its parts are updated together.
  const installRecord = join(practice, '.claude/plugins/installed_plugins.json');
  const installsBefore = existsSync(installRecord) ? readFileSync(installRecord, 'utf8') : undefined;
  writeClaudeInstall(practice, 'ck-test-market', 'issue-tracker', '9.9.9', { 'skills/triage/SKILL.md': readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8'), '.mcp.json': JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp'] } } }) });
  await a.click('#header-refresh');
  for (let tries = 0; tries < 30 && (await a.run(`document.querySelector('#cell-triage-claude-cli')?.dataset.state`)) !== 'plugin'; tries++) await wait(100);
  same('a tool with the plugin itself has the skill through it', await a.run(`[document.querySelector('#cell-triage-claude-cli')?.dataset.state, document.querySelector('#cell-triage-pi-cli')?.dataset.state]`), ['plugin', 'own-copy']);
  const throughTitle = await a.run(`document.querySelector('#cell-triage-claude-cli')?.title`);
  check('its mark says which plugin, and is drawn on', /^Claude Code has this skill through the plugin issue-tracker \(version 9\.9\.9\), so no separate copy is placed there\.$/.test(throughTitle ?? '') && await a.exists('#cell-triage-claude-cli[data-look="on"]'), [throughTitle, await a.text('.legend')]);
  await fitsAtMinimum(a, 'a skill a tool has through a plugin');
  await a.shot('skill-through-plugin');
  // Its opened row has the item's switch in Claude Code. Claude Code has none for one skill of a plugin, so it is the whole
  // plugin's there, and both its line and its label say so first (the click runs Claude Code's own command, not run here).
  const pluginSettings = join(practice, '.claude/settings.json');
  const pluginSettingsBefore = existsSync(pluginSettings) ? readFileSync(pluginSettings, 'utf8') : undefined;
  const pluginSettingsNow = () => (existsSync(pluginSettings) ? readFileSync(pluginSettings, 'utf8') : undefined);
  if (!(await a.exists('#enable-triage-claude-cli'))) await a.click('#open-triage');
  const triageLine = await a.text('.details-tool:has(#enable-triage-claude-cli) .details-tool-line') ?? '';
  const triageSwitch = await a.run(`document.querySelector('#enable-triage-claude-cli')?.getAttribute('aria-label')`) ?? '';
  check('the opened row’s Claude Code switch says it is the whole plugin’s', /Claude Code has no switch for one skill of a plugin, so this switch turns the whole plugin off there\./.test(triageLine)
    && /Click to turn the whole plugin issue-tracker off in Claude Code, with its 1 MCP server\.$/.test(triageSwitch), [triageLine, triageSwitch]);
  // A click on it applies at once, with Claude Code's own command (a stand-in here): the result leads with the skill clicked,
  // and its Undo turns the plugin back on there.
  const settingsAt = pluginSettingsNow() ?? '{}';
  writeFileSync(claudeStub, `#!/bin/sh\ncase "$*" in\n  "plugin disable issue-tracker@ck-test-market --scope user") printf '{"enabledPlugins":{"issue-tracker@ck-test-market":false}}' > "$HOME/.claude/settings.json" ;;\n  "plugin enable issue-tracker@ck-test-market --scope user") printf '%s' '${settingsAt}' > "$HOME/.claude/settings.json" ;;\n  *) exit 9 ;;\nesac\n`);
  const wholeOff = () => JSON.parse(pluginSettingsNow() ?? '{}').enabledPlugins?.['issue-tracker@ck-test-market'] === false;
  await a.click('#enable-triage-claude-cli');
  for (let tries = 0; tries < 60 && !(await a.exists('#outcome-undo-plugin')); tries++) await wait(100);
  check('the opened row’s switch applies at once, and its result leads with the skill', wholeOff() && await cellState(a, 'triage', 'claude-cli') === 'plugin-off'
    && /triage is off in Claude Code\. Its whole plugin issue-tracker was turned off there, with its MCP server issues\./.test(await a.text('.bands') ?? ''), [pluginSettingsNow(), await a.text('.bands')]);
  await a.click('#outcome-undo-plugin');
  for (let tries = 0; tries < 60 && (wholeOff() || !/Undone: triage/.test(await a.text('.bands') ?? '')); tries++) await wait(100);
  check('its Undo turns the plugin back on there', !wholeOff() && /Undone: triage is back on in Claude Code\./.test(await a.text('.bands') ?? ''), [pluginSettingsNow(), await a.text('.bands')]);
  writeFileSync(claudeStub, stubBefore);
  // Codex has the plugin too, and a switch for one skill of it: the row's switch takes Pi's copy out and turns Codex's skill
  // off in one click (Claude Code left on, and said), and its one Undo puts both back.
  const codexPlugin = join(practice, '.codex/plugins/cache/ck-test-market/issue-tracker/9.9.9'), codexToml = join(practice, '.codex/config.toml');
  const codexTomlBefore = readNow(codexToml);
  mkdirSync(join(codexPlugin, 'skills/triage'), { recursive: true });
  writeFileSync(join(codexPlugin, 'skills/triage/SKILL.md'), readFileSync(join(market, 'plugins/issue-tracker/skills/triage/SKILL.md'), 'utf8'));
  writeFileSync(codexToml, `${codexTomlBefore ?? ''}\n[plugins."issue-tracker@ck-test-market"]\nenabled = true\n`);
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && await cellState(a, 'triage', 'codex-cli') !== 'plugin'; tries++) await wait(100);
  // Pi's copy, found, is added to Central Knot first, so the click is the row's Off.
  if (await a.exists('#add-triage')) { await a.click('#add-triage'); for (let tries = 0; tries < 60 && !(await switchOn(a, 'triage')); tries++) await wait(100); }
  const piTriage = join(practice, '.pi/agent/skills/triage/SKILL.md');
  await a.click('.ov-row[data-key="triage"] .switch');
  for (let tries = 0; tries < 60 && !(await a.exists('#outcome-undo')); tries++) await wait(100);
  const codexItemOff = () => /name = "issue-tracker:triage"[^[]*enabled = false/.test(readNow(codexToml));
  check('one click takes Pi’s copy out and turns the plugin’s skill off in Codex, and says what it left on', codexItemOff() && !existsSync(piTriage) && await cellState(a, 'triage', 'codex-cli') === 'plugin-off'
    && /Still on in Claude Code: it has no switch for one skill of a plugin, only one for the whole plugin, issue-tracker\./.test(await a.text('.bands') ?? ''), [await a.text('.bands'), readNow(codexToml)]);
  await a.click('#outcome-undo');
  for (let tries = 0; tries < 60 && (codexItemOff() || !existsSync(piTriage)); tries++) await wait(100);
  same('its one Undo puts both back', [codexItemOff(), existsSync(piTriage), await cellState(a, 'triage', 'codex-cli'), await switchOn(a, 'triage')], [false, true, 'plugin', true]);
  // The same Off from a page read before triage was turned off elsewhere is refused as a whole: the plugin's skill in Codex
  // is never switched beside the refusal. On again after, as it was.
  await a.run(`(async () => { const view = await window.centralKnot.refresh(); await window.centralKnot.applySkills([{ key: 'triage', managed: false, off: [], seenManaged: true }], false, view.home); document.querySelector('.ov-row[data-key="triage"] .switch').click(); })()`);
  for (let tries = 0; tries < 60 && !/changed since the page was read/.test(await a.text('.bands') ?? ''); tries++) await wait(100);
  check('an Off from a stale page is refused, and the plugin’s skill in Codex stays on', !codexItemOff() && /triage changed since the page was read/.test(await a.text('.bands') ?? ''), [await a.text('.bands'), readNow(codexToml)]);
  await a.run(`(async () => { const view = await window.centralKnot.refresh(); await window.centralKnot.applySkills([{ key: 'triage', managed: true, off: [], seenManaged: false }], false, view.home); })()`);
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !(await switchOn(a, 'triage')); tries++) await wait(100);
  rmSync(join(practice, '.codex/plugins'), { recursive: true, force: true });
  if (codexTomlBefore === undefined) rmSync(codexToml, { force: true }); else writeFileSync(codexToml, codexTomlBefore);
  await a.click('#header-refresh');
  // Its MCP server has a switch of its own in Claude Code: the opened row's switch turns that one server off at once, by the
  // name Claude Code gives a plugin's server; the row's mark only shows it.
  await a.click('#nav-mcp');
  same('so does its MCP server, on MCP servers, and its mark is no button', await a.run(`[document.querySelector('#cell-issues-claude-cli')?.dataset.state, /through the plugin issue-tracker/.test(document.querySelector('#cell-issues-claude-cli')?.title ?? ''), document.querySelector('#cell-issues-claude-cli')?.tagName]`), ['plugin', true, 'SPAN']);
  if (!(await a.exists('#enable-issues-claude-cli'))) await a.click('#open-issues');
  same('the opened row has its switch in Claude Code, on', [await a.run(`document.querySelector('#enable-issues-claude-cli')?.getAttribute('aria-checked')`), /Click to turn it off in Claude Code\.$/.test(await a.run(`document.querySelector('#enable-issues-claude-cli')?.getAttribute('aria-label')`) ?? '')], ['true', true]);
  await a.click('#enable-issues-claude-cli');
  for (let tries = 0; tries < 40 && (await cellState(a, 'issues', 'claude-cli')) !== 'plugin-off'; tries++) await wait(100);
  check('a click turns that one server off at once with Claude Code’s own switch, and the page says so, with Undo', JSON.stringify(JSON.parse(pluginSettingsNow() ?? '{}').deniedMcpServers) === '[{"serverName":"plugin:issue-tracker:issues"}]'
    && await cellState(a, 'issues', 'claude-cli') === 'plugin-off' && /issues is off in Claude Code\./.test(await a.text('.bands') ?? '') && await a.exists('#outcome-undo-plugin'), [pluginSettingsNow(), await a.text('.bands')]);
  await a.click('#nav-skills');
  same('the plugin’s skill is still on there', await cellState(a, 'triage', 'claude-cli'), 'plugin');
  await a.click('#nav-mcp');
  if (!(await a.exists('#enable-issues-claude-cli'))) await a.click('#open-issues');
  same('the opened row shows it off in Claude Code', await a.run(`[document.querySelector('#enable-issues-claude-cli')?.getAttribute('aria-checked'), document.querySelector('#enable-issues-claude-cli')?.closest('.tool-switch')?.textContent]`), ['false', 'Off']);
  await fitsAtMinimum(a, 'a server a tool has through a plugin, opened');
  await a.shot('server-through-plugin-off');
  await a.click('#enable-issues-claude-cli');
  for (let tries = 0; tries < 40 && (await cellState(a, 'issues', 'claude-cli')) !== 'plugin'; tries++) await wait(100);
  check('its switch turns it back on: the settings are as they were', (pluginSettingsNow() === pluginSettingsBefore || JSON.parse(pluginSettingsNow() ?? '{}').deniedMcpServers === undefined) && await cellState(a, 'issues', 'claude-cli') === 'plugin', pluginSettingsNow());
  await a.click('#outcome-undo-plugin');
  for (let tries = 0; tries < 40 && (await cellState(a, 'issues', 'claude-cli')) !== 'plugin-off'; tries++) await wait(100);
  same('Undo turns it off again', [await cellState(a, 'issues', 'claude-cli'), JSON.parse(pluginSettingsNow() ?? '{}').deniedMcpServers?.length], ['plugin-off', 1]);
  await a.settle();
  if (pluginSettingsBefore === undefined) rmSync(pluginSettings, { force: true }); else writeFileSync(pluginSettings, pluginSettingsBefore);
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && (await a.run(`document.querySelector('#cell-issues-claude-cli')?.dataset.state`)) !== 'plugin'; tries++) await wait(100);
  if (!(await a.exists('#enable-issues-claude-cli-page'))) await a.click('#open-issues');
  await a.click('#enable-issues-claude-cli-page');
  for (let tries = 0; tries < 30 && !(await a.exists('#plugin-back')); tries++) await wait(100);
  check('and its opened row leads to the plugin’s page', await a.exists('#plugin-back') && /issue[- ]tracker/i.test(await a.text('.plugin-page h2') ?? ''), await a.text('.plugin-page h2'));
  // Taken in above, triage is no plugin part in Pi any more (parts.ts leaves a managed one to its page): Delete from Central
  // Knot takes Pi's copy out again, and leaves the plugin's own skill in Claude Code.
  await a.click('#nav-skills');
  if (await a.run(`document.querySelector('#open-triage')?.getAttribute('aria-expanded')`) !== 'true') await a.click('#open-triage');
  await a.click('#delete-triage');
  await a.click('#delete-confirm-triage');
  same('Delete from Central Knot takes Pi’s copy out, and leaves the plugin’s skill in Claude Code', [existsSync(piTriage), existsSync(join(practice, '.claude/plugins/cache/ck-test-market/issue-tracker/9.9.9/skills/triage/SKILL.md'))], [false, true]);
  if (installsBefore === undefined) rmSync(installRecord); else writeFileSync(installRecord, installsBefore);
  rmSync(join(practice, '.claude/plugins/cache/ck-test-market/issue-tracker/9.9.9'), { recursive: true, force: true });
  await a.click('#header-refresh');
  await a.click('#nav-plugins');
  await a.click('#plugins-undo');
  check('Undo takes the parts out of Pi', !readFileSync(piMcp, 'utf8').includes('issues'), readFileSync(piMcp, 'utf8'));
  // A part left out because its name was taken goes in with Update parts once the name is free.
  mkdirSync(join(practice, '.pi/agent/skills/triage'), { recursive: true });
  writeFileSync(join(practice, '.pi/agent/skills/triage/SKILL.md'), '---\nname: triage\ndescription: Mine.\n---\nMine.\n');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !/Can’t go in: skill triage/.test(await a.text('.plugin-parts-section') ?? ''); tries++) await wait(100);
  await a.click('#pcell-0-issue-tracker-pi-cli');
  await a.click('#plugins-apply');
  check('a taken name leaves that part out', readFileSync(join(practice, '.pi/agent/skills/triage/SKILL.md'), 'utf8').includes('Mine.') && readFileSync(piMcp, 'utf8').includes('issues'), readFileSync(piMcp, 'utf8'));
  rmSync(join(practice, '.pi/agent/skills/triage'), { recursive: true, force: true });
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !/Can go in now/.test(await a.text('.plugin-parts-section') ?? ''); tries++) await wait(100);
  check('once the name is free, the page offers it with Update parts', /Can go in now: skill triage/.test(await a.text('.plugin-parts-section') ?? '') && /Update parts in Pi/.test(await a.text('#pparts-issue-tracker') ?? ''), await a.text('.plugin-parts-section'));
  await a.click('#pparts-issue-tracker');
  await a.click('#plugins-apply');
  check('Update parts adds it', existsSync(join(practice, '.pi/agent/skills/triage/SKILL.md')) && !readFileSync(join(practice, '.pi/agent/skills/triage/SKILL.md'), 'utf8').includes('Mine.'), await a.text('.bands'));
  await a.click('#punparts-issue-tracker');
  await a.click('#plugins-apply');
  // Single parts: a switch under Pi puts in that one skill alone, over a link there that leads nowhere; the rest stays out.
  rmSync(join(practice, '.pi/agent/skills/triage'), { recursive: true, force: true });
  mkdirSync(join(practice, '.pi/agent/skills'), { recursive: true });
  symlinkSync(join(practice, 'gone/triage'), join(practice, '.pi/agent/skills/triage'));
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !/would replace a broken link/.test(await a.text('.plugin-parts-section') ?? ''); tries++) await wait(100);
  check('a broken link in a part’s place is said, not a reason to leave the part out', /The skill triage: it would replace a broken link there, which led to .*gone\/triage/.test(await a.text('.plugin-parts-section') ?? ''), await a.text('.plugin-parts-section'));
  const partSwitch = part => `#ppart-0-issue-tracker-${part}-pi-cli`;
  const standOf = part => a.run(`(() => { const s = document.querySelector('${partSwitch(part)}'); return s ? s.closest('.skill-switch').dataset.state + ' ' + s.getAttribute('aria-checked') : 'missing'; })()`);
  same('each part has a switch under Pi, off', [await standOf('skill-triage'), await standOf('mcp-issues')], ['out false', 'out false']);
  await a.click(partSwitch('skill-triage'));
  check('a part’s switch chooses it alone, and the page says what Apply all will do', await standOf('skill-triage') === 'part-on true' && /Will add 1 part/.test(await a.text('.plugin-panel') ?? '') && /1 part to add/.test(await a.text('.toolbar') ?? '')
    && /Goes into Pi as a separate item/.test(await a.text('.plugin-skills') ?? ''), `${await standOf('skill-triage')} | ${await a.text('.plugin-panel')} | ${await a.text('.toolbar')}`);
  await a.click('#plugins-apply');
  check('only that part goes in, in place of the broken link', existsSync(join(practice, '.pi/agent/skills/triage/SKILL.md')) && !lstatSync(join(practice, '.pi/agent/skills/triage')).isSymbolicLink() && !readFileSync(piMcp, 'utf8').includes('issues')
    && /skill triage put into Pi/i.test(await a.text('.toolbar') ?? ''), await a.text('.toolbar'));
  const logged = readFileSync(join(scratch, 'data', 'central-knot.log'), 'utf8');
  check('the log file says what that change came to: the plugin, the parts picked, the tool, and the broken link replaced',
    /plugins:parts issue-tracker@[\w-]+ \(on: skill triage\) in pi-cli: installed: .*A broken link named “triage” in Pi’s skills folder was replaced/.test(logged), logged.split('\n').filter(line => line.includes('plugins:parts')).slice(-3).join('\n'));
  for (let tries = 0; tries < 40 && !/Left out by you/.test(await a.text('.plugin-parts-section') ?? ''); tries++) await wait(100);
  check('the part left out is said, with its switch off', /Installed[^:]*: skill triage/.test(await a.text('.plugin-parts-section') ?? '') && /Left out by you: MCP server issues/.test(await a.text('.plugin-parts-section') ?? '') && await standOf('mcp-issues') === 'out false' && await standOf('skill-triage') === 'in true', await a.text('.plugin-parts-section'));
  await a.click(partSwitch('skill-triage'));
  await a.click('#plugins-apply');
  check('turning its switch off takes it out again', !existsSync(join(practice, '.pi/agent/skills/triage')), await a.text('.bands'));
  rmSync(join(practice, '.pi'), { recursive: true, force: true });
  await a.run('window.centralKnot.refresh()');
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
  check('turning one off only chooses it', /1 skill to turn off/.test(await a.text('.toolbar') ?? '') && readFileSync(codexConfig, 'utf8') === configBefore, await a.text('.toolbar'));
  await a.click('#plugins-apply');
  check('Apply all turns it off with Codex’s own switch, by name', readFileSync(codexConfig, 'utf8') === `${configBefore}\n[[skills.config]]\nname = "document-tools:pdf-reader"\nenabled = false\n`, readFileSync(codexConfig, 'utf8'));
  check('and the page shows it off', await a.run(`document.querySelector('#pskill-0-document-tools-pdf-reader-codex-cli').getAttribute('aria-checked')`) === 'false' && /Installed (· [^·]+ )?· 1 skill off/.test(await a.text('.plugin-panel')) && /pdf-reader turned off in Codex/.test(await a.text('.toolbar') ?? ''), await a.text('.plugin-page'));
  // The Skills page shows the same switch in Codex's box for the plugin's skill.
  const pdfRow = 'document-tools@ck-test-market/pdf-reader';
  await a.click('#nav-skills');
  for (let tries = 0; tries < 40 && await cellState(a, pdfRow, 'codex-cli') !== 'plugin-off'; tries++) await wait(100);
  same('on the Skills page its Codex box shows it off, the plugin’s other skill on', [await cellState(a, pdfRow, 'codex-cli'), await cellState(a, 'document-tools@ck-test-market/spreadsheet', 'codex-cli')], ['plugin-off', 'plugin']);
  await a.click('#nav-plugins');
  await a.click('#plugins-undo');
  same('Undo turns it back on: config.toml is as it was', [readFileSync(codexConfig, 'utf8') === configBefore, await a.run(`document.querySelector('#pskill-0-document-tools-pdf-reader-codex-cli').getAttribute('aria-checked')`)], [true, 'true']);
  writeFileSync(codexConfig, configBefore.slice(0, configBefore.indexOf('\n[marketplaces.ck-test-market]')));
  await a.click('#plugin-back');
  // About has every fact about the marketplace, and Remove.
  await a.click('#market-tab-about');
  check('About names who made the marketplace and where it comes from', /By Platform team[\s\S]*market/.test(await a.text('.market-about-head') ?? ''), await a.text('.market-about-head'));
  await a.click('#forget-0');
  check('Remove forgets it here only', (await a.text('#plugins-scroll')).includes('No marketplaces yet'));
  // A marketplace with a long name and long facts, with a change waiting: nothing is cut off at the smallest window, and
  // where the facts don't fit beside the name they drop whole rather than being cut mid-word.
  const longMarket = join(scratch, 'market-long');
  writeMarket(longMarket, 'platform-engineering-shared-developer-tools-marketplace', 'The Platform Engineering and Developer Experience Group');
  await a.run(`(() => { const input = document.querySelector('#marketplace-source'); input.value = ${JSON.stringify(longMarket)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#add-marketplace');
  await a.click('#pcell-0-document-tools-claude-cli');
  await fitsAtMinimum(a, 'a long-named marketplace with a change waiting');
  await sizeTo(a, 1280, 800);
  const factsWhole = `(() => { const line = document.querySelector('.market-title-line'); if (!line) return 'no title line'; const box = line.getBoundingClientRect();
    return [...line.querySelectorAll('.market-fact')].every(fact => { const at = fact.getBoundingClientRect(); return at.top >= box.bottom - 1 || (at.right <= box.right + 1 && at.bottom <= box.bottom + 1); }); })()`;
  same('the long marketplace’s facts show whole or not at all', await a.run(factsWhole), true);
  await fullSize(a);
  await a.click('#plugins-discard');
  await a.click('#market-tab-about');
  await a.click('#forget-0');
  // Instructions (INS-01, INS-02): each tool's own file, a diff before saving, the replaced version kept.
  await a.click('#nav-instructions');
  for (let tries = 0; tries < 40 && !(await a.exists('#ins-edit-claude-cli')); tries++) await wait(100);
  check('Instructions show Claude Code’s CLAUDE.md and who reads it', (await a.text('#instructions-scroll')).includes('Explain the plan in two or three lines') && (await a.text('#instructions-scroll')).includes('Claude Code reads this in every session'), await a.text('#instructions-scroll'));
  check('a tool with no file says so', (await a.text('#instructions-scroll')).includes('No file yet'));
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
  // A tool's own instructions edited afterwards: its base block and the other files stay as they are.
  await a.click('#ins-edit-claude-cli');
  await a.run(`(() => { const area = document.querySelector('#ins-text-claude-cli'); area.value += '- Own line after the base.\\n'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await a.click('#ins-review-claude-cli'); await a.click('#ins-save-claude-cli');
  const ownEdited = readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8');
  check('editing a tool’s own text keeps its base block after it, unchanged', ownEdited === baseClaude1.replace('\n\n<!-- Central Knot', '\n- Own line after the base.\n\n<!-- Central Knot') && readFileSync(join(practice, '.codex/AGENTS.md'), 'utf8') === baseCodex1, ownEdited);
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
  await a.click('#nav-skills');
  await a.click('#home-actual');
  check('a home switch with a typed base draft asks first and stays', await a.exists('#base-discard') && (await a.run(`document.querySelector('#base-text')?.value`) ?? '').includes('- Not saved.') && await a.run(`document.querySelector('#home-fixture')?.getAttribute('aria-current') === 'true'`), await a.text('.bands'));
  await a.click('#base-discard');
  await a.click('#base-edit');
  await a.click('#base-tool-claude-cli'); await a.click('#base-tool-codex-cli');
  await a.click('#base-review'); await a.click('#base-save');
  const codexAfter = readFileSync(join(practice, '.codex/AGENTS.md'), 'utf8');
  check('Taking every tool off restores Claude Code’s own text and leaves Codex’s hand-edited copy where it is', readFileSync(join(practice, '.claude/CLAUDE.md'), 'utf8') === baseClaude0 && codexAfter.startsWith(baseCodex0) && codexAfter.includes('- Shared, edited in Codex.'), codexAfter);
  // A card's edit, review and discard-confirm rows wrap by its width: nothing spills out around the cards' column breakpoints.
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
      Math.round(box.right - parseFloat(getComputedStyle(row).paddingRight) - document.querySelector('#show-log').getBoundingClientRect().right),
      Math.round(document.querySelector('#setting-log-title').getBoundingClientRect().left - page.getBoundingClientRect().left)];
  })()`), [0, 0, 16]);
  const appSettings = join(scratch, 'data/app-settings.json');
  // The app rewrites this file in place, so a read can land mid-write: read again until it parses.
  const savedSettings = () => { for (let tries = 0; ; tries++) { try { return JSON.parse(readFileSync(appSettings, 'utf8')); } catch (error) { if (tries > 50) throw error; } } };
  // Every writer saves through one chain: saves sent together land in order, the file stays whole, and other fields stay.
  // They bypass the page, so the open page (showing System) can only come to show Light by hearing that main saved it.
  await a.run(`Promise.all(['light', 'system', 'dark', 'system', 'light'].map(choice => window.centralKnot.setAppearance(choice)))`);
  let followed = false;
  for (let tries = 0; tries < 20 && !followed; tries++) { await wait(100); followed = await a.exists('#appearance-light[aria-checked="true"]'); }
  check('settings saved at once keep the other settings, and the open page follows the last', followed && savedSettings().appearance === 'light' && savedSettings().home?.mode === 'fixture', savedSettings());
  chmodSync(appSettings, 0o444);
  await a.click('#appearance-dark');
  check('a save that fails says why in plain words in its row, and the saved choice stays', await dark() === false && await a.exists('#appearance-light[aria-checked="true"]')
    && await a.text('#setting-appearance .setting-failure') === 'Couldn’t save: Central Knot can’t write its settings file. Light is still in use. Check the file’s permissions, then try again.', await a.text('#setting-appearance'));
  chmodSync(appSettings, 0o644);
  await a.click('#appearance-system');
  check('the next save clears the failure', !(await a.exists('.setting-failure')) && savedSettings().appearance === 'system');
  // Show log file opens the folder the log is in, and says so (macOS and Windows select the file: the Mac check covers that).
  if (process.platform === 'linux') {
    await a.click('#show-log');
    for (let tries = 0; tries < 30 && !existsSync(opened); tries++) await wait(100);
    same('Show log file opens the log’s folder and names the file', [existsSync(opened) && readFileSync(opened, 'utf8').trim(), await a.text('#setting-log .setting-note')],
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
    [savedSettings().historyDays, await a.exists('#history-shorten'), await agedShown()], [90, false, ['aged-60', 'aged-20', 'aged-5']]);
  await keepFor(a, 7);
  const question = await a.text('#history-shorten-text') ?? '';
  same('a shorter window asks first, naming from when, and keeps the saved choice until confirmed (which its other button names)',
    [/^History before .+ will be removed and can’t be restored\. Your other homes remove it too the next time they record a change\.$/.test(question), await a.text('#history-shorten'), await a.text('#history-shorten-cancel'), await a.run(`document.querySelector('#history-days').value`), savedSettings().historyDays],
    [true, 'Shorten to 7 days', 'Keep 90 days', '90', 90]);
  await a.shot('settings-history-confirm');
  await a.run(`document.querySelector('#history-days').focus()`);
  for (const type of ['keyDown', 'keyUp']) await a.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await a.settle();
  const escaped = await a.exists('#history-shorten');
  await keepFor(a, 7);
  await a.click('#history-shorten-cancel');
  same('Escape or Cancel closes the question and writes nothing', [escaped, await a.exists('#history-shorten'), savedSettings().historyDays, agedOnFile(), await a.run(`document.activeElement.id`)], [false, false, 90, ['aged-60', 'aged-20', 'aged-5'], 'history-days']);
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
      await a.run(`window.ckNewestDone === true`), savedSettings().historyDays, await a.exists('#appearance-light[aria-checked="true"]')];
    // Not a.click: it waits for the page to be idle, and History's read waits behind the held queue.
    await a.run(`document.querySelector('#nav-history').click()`);
    await held.release();
    const [overtaken, newest] = [await a.run('window.ckOvertaken'), await a.run('window.ckNewest')];
    await a.settle();
    const listedMeanwhile = await a.text('#history-scroll') ?? '';
    same('while main is busy the row says it is updating and takes no other change; the newest request wins, the overtaken shorter ones remove nothing, and History opened meanwhile agrees with the window that won',
      [during, savedSettings().historyDays, agedOnFile(), [overtaken.pruned ?? 'none', newest.pruned], listedMeanwhile.includes('aged-20-days'), listedMeanwhile.includes('aged-60-days'), await a.text('.history-intro')],
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
  for (let tries = 0; tries < 30 && savedSettings().historyDays !== 7; tries++) await wait(100);
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
    [savedSettings().historyDays, agedOnFile(), /^Saved\. History before .+ was removed\.$/.test(removedNote), noteAfterOtherRow, listed.includes('aged-5-days'), listed.includes('aged-20-days'), intro, await a.exists('#history-days')],
    [7, ['aged-5'], true, false, true, false, 'What sync, your switches, Pull, sources and profile switches changed, newest first. Undo puts the earlier version back; Restore brings back what was deleted or removed. Kept for 7 days. Change in Settings.', true]);
  // Start at sign-in: only an installed app can register a login item, so here the row is off, can't be changed, and says why
  // in its hint's place. Main refuses a change too, and nothing about it is saved.
  const signInReason = flag('--electron') ? 'Only the installed app can start at sign-in.' : 'Move Central Knot to the Applications folder first.';
  const refused = await a.run(`window.centralKnot.setStartAtSignIn(true).then(() => 'saved', error => String(error))`);
  same('Start at sign-in that can’t be changed is off and disabled, says why, and main refuses a change', [
    await a.run(`(({ disabled, ariaChecked }) => [ariaChecked, disabled])(document.querySelector('#start-at-sign-in'))`),
    await a.run(`document.getElementById(document.querySelector('#start-at-sign-in').getAttribute('aria-describedby'))?.textContent`),
    refused.includes(signInReason), 'startAtSignIn' in savedSettings()], [['false', true], signInReason, true, false]);
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
    const saved = savedSettings().startAtSignIn;
    await refocus(main);
    const reread = await until('Not available on Linux yet.', () => a.text('#setting-sign-in-hint'));
    const menuItem = await main.run(`(({ label, visible, enabled, checked }) => ({ label, visible, enabled, checked }))(ck.menus.at(-1).find(item => item.label?.startsWith('Start at sign-in')))`);
    // The first close explains where the app went; on Linux it offers no start at sign-in.
    await main.run(`electron.BrowserWindow.getAllWindows()[0].close()`);
    for (let tries = 0; tries < 20 && !savedSettings().closeExplained; tries++) await wait(100);
    const dialogs = await main.run(`ck.dialogs.map(options => 'checkboxLabel' in options)`);
    // The rest of the run has the real system back: platform, packaging, login items, menus, dialogs and links.
    await main.run(`(ck.restore(), electron.BrowserWindow.getAllWindows()[0].show())`);
    same('an installed app on Linux: the row (read again on focus), the menu (hidden) and the first-close dialog agree it isn’t available; no login-item call, nothing saved',
      [reread, menuItem, dialogs, await main.run(`ck.asked`), savedSettings().startAtSignIn === saved],
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
  // Every card grid at full screen: as many columns as its cards, up to four, so four tools sit in one row. (Settings is rows.)
  for (const [page, grid] of [['harnesses', '.harness-cards'], ['instructions', '.card-grid']]) {
    await a.click(`#nav-${page}`);
    for (let tries = 0; tries < 30 && !(await a.exists(grid)); tries++) await wait(100);
    const rows = await a.run(`(() => { const cards = [...document.querySelectorAll('${grid} > *')]; return [cards.length, new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size]; })()`);
    same(`at 2560×1440 the ${page} cards (${rows[0]}) sit in one row`, rows[1], 1);
  }
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
 * and its versions say where it is from; On gives every tool all of it, byte for byte; a change there comes in at Check now; a
 * rename there turns it Off with an entry in History; a link that is a plugin is refused; the page fits at the smallest window;
 * Remove leaves the skill as it is.
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
  commit(plugin, { '.claude-plugin/plugin.json': '{"name":"plugin"}', 'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: PDFs.\n---\nPDFs.\n' });
  const home = join(scratch, 'sources-home'), data = join(scratch, 'sources-data');
  const roots = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills' };
  for (const root of Object.values(roots)) mkdirSync(join(home, root), { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  const a = await launch(data, [], join(scratch, 'sources-real'), { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${join(hosts, 'github.com')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/' });
  const record = () => JSON.parse(readNow(join(home, '.central-knot/skills.json')) || '{"items":{}}').items.deslop;
  const until = async (test, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await wait(100); } return false; };
  const type = async (text) => a.run(`(() => { const input = document.querySelector('#source-link'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

  await a.click('#nav-sources');
  check('the Sources page opens empty, with its field', await a.exists('#source-link') && /No sources yet/.test(await a.text('.page') ?? ''), await a.text('.page'));
  await type('https://github.com/stephenturner/skill-deslop/tree/main');
  await a.click('#source-look');
  await until(() => a.exists('#source-preview'));
  const offered = await a.text('.source-name[data-key="deslop"]') ?? '';
  check('Look offers one skill, deslop, at the root of skill-deslop, coming in Off, with the files beside its SKILL.md', (await a.all('#source-preview .source-name', 'e.dataset.key')).join() === 'deslop' && /deslop\s*at the root of skill-deslop/.test(offered) && /Comes in, Off/.test(offered) && /8 files/.test(offered) && /references\/checklist\.md/.test(offered), offered);
  same('a look keeps nothing and writes no tool', [record(), existsSync(join(home, roots['claude-cli'], 'deslop'))], [undefined, false]);
  await a.shot('sources-look');
  await a.click('#source-add');
  await until(() => a.exists('.source-row'));
  check('Add says deslop is in Central Knot, Off', /Added github\.com\/stephenturner\/skill-deslop \(main\)\. deslop is in Central Knot, Off: turn it on in Skills\./.test(await a.text('.band-done .band-text') ?? ''), await a.text('.band-done'));
  same('in Central Knot, Off, in no tool', [record()?.on, Object.values(roots).some(root => existsSync(join(home, root, 'deslop')))], [false, false]);
  check('its row says it is in Central Knot, Off, and says beforehand that Check now can change skills in the tools', /In Central Knot, Off/.test(await a.text('.source-row .source-name[data-key="deslop"]') ?? '')
    && /Check now reads the link again: a skill changed there is updated in the tools it is on in; one no longer there is turned off and taken out of them\./.test(await a.text('.source-row') ?? ''), await a.text('.source-row'));
  const id = await a.run(`document.querySelector('.source-row').dataset.source`);

  await a.click('#nav-skills');
  await a.click('#open-deslop');
  const opened = await a.text('.details') ?? '';
  check('its opened row on Skills says which source it is from, and its version says so too', /From github\.com\/stephenturner\/skill-deslop \(main\), a source\. Check now on Sources brings in what changes there\./.test(opened) && /from github\.com\/stephenturner\/skill-deslop \(main\)/.test(opened), opened);
  await a.click('#switch-deslop');
  const asGiven = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text]));
  const inTool = root => Object.fromEntries(Object.keys(files).map(path => [path, readNow(join(home, root, 'deslop', path))]));
  check('turned On, every tool gets SKILL.md and all four reference files, byte for byte', await until(() => Object.values(roots).every(root => JSON.stringify(inTool(root)) === JSON.stringify(asGiven))), Object.values(roots).map(inTool));

  commit(deslop, { 'SKILL.md': files['SKILL.md'].replace('Remove slop.', 'Remove slop, gently.') });
  await a.click('#nav-sources');
  await a.click(`#source-check-${id}`);
  check('Check now brings the change in, and the band says it was updated and where it went, with its Undo', /deslop was updated from its source, now in all 3 tools\./.test(await a.text('.band-done .band-text') ?? '') && await a.exists('#outcome-undo') && await until(() => Object.values(roots).every(root => readNow(join(home, root, 'deslop/SKILL.md')).includes('gently'))), await a.text('.band-done'));

  commit(deslop, { 'SKILL.md': files['SKILL.md'].replace('name: deslop', 'name: unslop') });
  await a.click(`#source-check-${id}`);
  check('renamed there, Check now turns deslop Off and takes it out of every tool, said first, as a warning, with Turn on; unslop comes in Off', /^deslop is no longer at github\.com\/stephenturner\/skill-deslop \(main\): it was turned off and taken out of all 3 tools; Central Knot keeps it\./.test(await a.text('.band-done .band-text') ?? '')
    && /unslop is in Central Knot, Off/.test(await a.text('.band-done .band-text') ?? '') && await a.exists('.band-done svg.tone-warning') && (await a.text('#outcome-undo')) === 'Turn deslop on'
    && await until(() => Object.values(roots).every(root => !existsSync(join(home, root, 'deslop')))) && record()?.on === false, await a.text('.band-done'));
  await a.click('#nav-history');
  check('History says the source dropped it', await until(async () => /github\.com\/stephenturner\/skill-deslop \(main\) no longer has it, so it is off and removed from all 3 tools/.test(await a.text('.page') ?? '')), await a.text('.page'));

  await a.click('#nav-sources');
  await type('https://github.com/team/plugin');
  await a.click('#source-look');
  await until(() => a.exists('#source-preview'));
  check('a link that is a plugin is named as one, and nothing there is added', /The link holds a plugin/.test(await a.text('#source-preview') ?? '') && !(await a.exists('#source-add')), await a.text('#source-preview'));
  await fitsAtMinimum(a, 'Sources, with a source and a look open');
  for (const [width, height] of [[1280, 800], [1728, 1117], [2560, 1440]]) { await sizeTo(a, width, height); same(`nothing cut off on Sources at ${width}×${height}`, await a.run(CUT_OFF), []); }
  await fullSize(a);

  await a.click(`#source-remove-${id}`);
  await a.click(`#source-remove-confirm-${id}`);
  check('Remove takes the row away, and deslop stays in Central Knot as it was', await until(async () => !(await a.exists('.source-row'))) && record()?.on === false && !!record()?.versions.length, await a.text('.page'));
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
    same('the row’s buttons are the size of the page’s other row buttons', await a.run(`['setting-update', 'check-updates', 'show-log'].map(id => document.getElementById(id).getBoundingClientRect().height)`), [32, 32, 32]);
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
    same('the click says it won’t restart by itself, with changes waiting', await a.run(`document.getElementById('announcement').dataset.text`), 'Downloading 0.5.0 preview 5. Something here isn’t saved yet, so Central Knot will wait for you to restart.');
    same('downloaded and prepared, it waits to restart', await reaches('held'), 'held');
    const looks = await a.run('window.ckLooks');
    check('one click downloads, with progress on the control, then prepares', looks.filter(look => /^working Downloading… \d+%$/.test(look)).length >= 2 && looks.includes('working Preparing update…'), looks);
    same('an unsaved draft holds the restart', (await control()).label, 'Restart to update…');
    same('the control, disabled while it worked, takes the focus back', await focused(), 'update-control');
    await wait(1500);
    check('and the app is still running', a.child.exitCode === null);
    check('the status bar says what restarting loses, first', /^Restarting now loses your unsaved instructions draft\./.test(await a.text('#announcement') ?? ''), await a.text('#announcement'));
    check('so does the control, whose name says it too', /unsaved instructions draft\. Click to open Settings, where you can restart anyway\.$/.test((await control()).title) && /^Restart to update: Restarting now loses your unsaved instructions draft\. Opens Settings$/.test((await control()).name), await control());
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
    await a.click('#profile-new');
    await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = 'Incident response on call'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await a.settle();
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

/** A released build starts on this computer's home and offers no Practice copy, and its main process refuses one. */
async function releasedStartupFlow() {
  // A development build (--electron) starts as a released one with --as-released; a packaged build needs no switch.
  const a = await launch(join(scratch, 'released-data'), flag('--electron') ? ['--as-released'] : []);
  const realHome = process.platform === 'darwin' ? 'This Mac’s home' : 'This computer’s home';
  same('a released build opens this computer’s home, never the practice copy', [await a.text('#home-label'), await a.exists('#home-fixture')], [realHome, false]);
  same('and its main process refuses the practice copy', await a.run(`window.centralKnot.selectHome('fixture').then(() => 'opened', () => 'refused')`), 'refused');
  await a.quit();
}

/**
 * A home with no tools, then with Pi alone, then with Claude Code too. With no tools every page stays, each saying so; a
 * kind no tool here can hold (agents, plugins with Pi alone) is left out of the sidebar and the Overview, named once; a
 * tool that holds it brings it back.
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
  same('a home with no tools shows only the pages that hold no kind', await pages(), ['overview', 'harnesses', 'history', 'sources', 'repo', 'settings']);
  same('its Overview says no tools were found, once, with another home to choose, and no "Also here"', [await a.text('.overview-lead'), await a.exists('#overview-choose-home'), await a.exists('#overview-instructions')], ['No tools were found in this home.', true, false]);
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
  same('a tool’s folder alone, with no CLI or app, makes no tool', await pages(), ['overview', 'harnesses', 'history', 'sources', 'repo', 'settings']);
  mkdirSync(join(home, '.pi/agent/skills/notes'), { recursive: true });
  writeFileSync(join(home, '.pi/agent/skills/notes/SKILL.md'), text('notes'));
  cli('.pi/agent/bin/pi', 'pi 1.5.0');
  await a.click('#header-refresh');
  // Codex, whose folder is still here, holds agents and plugins: were it counted, both pages would be back.
  same('with Pi alone, Agents and Plugins are left out', await pages(), ['overview', 'harnesses', 'skills', 'mcp', 'instructions', 'profiles', 'history', 'sources', 'repo', 'settings']);
  check('and the Overview names them once', (await a.text('#overview-absent') ?? '').includes('No tool here holds agents or plugins') && !(await a.exists('#overview-agents')), await a.text('#overview-absent'));
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
  same('a tool that holds agents and plugins brings them back', await pages(), ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'profiles', 'history', 'sources', 'repo', 'settings']);
  await a.click('#nav-harnesses');
  check('Claude Code’s CLI alone says nothing of Cowork', !(await a.text('#harness-claude-cli')).includes('Cowork'), await a.text('#harness-claude-cli'));
  // On Agents, its only tool goes away: the page it was on no longer exists here, so the Overview opens.
  await a.click('#nav-agents');
  rmSync(join(home, '.claude'), { recursive: true, force: true });
  rmSync(join(home, '.local/bin/claude'));
  await a.click('#header-refresh');
  same('when the open page’s kind leaves the home, the Overview opens', [await a.text('.page-title'), await pages()], ['Overview', ['overview', 'harnesses', 'skills', 'mcp', 'instructions', 'profiles', 'history', 'sources', 'repo', 'settings']]);
  const moved = await a.run(`document.querySelector('#announcement').dataset.text`);
  check('and the status bar says what was read and why the page moved', /^Read .*No tool here holds agents now\.$/.test(moved ?? ''), moved);
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
  check('with only Claude desktop, the plugin box names its route, its Code tab, and offers no parts instead', box.includes('Claude CodePlugin not installedThrough Claude desktop’s Code tab 2.1.317') && !box.includes('Only Claude desktop'), box);
  check('and says once that Cowork uses the Claude account’s plugins, with no box for it', box.includes('Cowork in Claude desktop uses the plugins in your Claude account, so Central Knot doesn’t install there.') && (await a.all('.plugin-tool-name')).every(name => !name.includes('Cowork')), box);
  same('no page errors, few tools', a.pageErrors, []);
  await a.quit();
  // In the Practice copy (a real home is preview only off macOS) the install runs through that copy and its record counts.
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
    [await cellState(a, 'notes', 'opencode-cli'), await cellState(a, 'oc-only', 'opencode-cli'), await cellState(a, 'shared', 'opencode-cli'), await cellState(a, 'notes', 'claude-cli'), await cellState(a, 'oc-only', 'claude-cli')],
    ['another-way', 'own-copy', 'another-way', 'own-copy', 'none']);
  await a.click('#open-notes');
  check('a skill OpenCode reads in Claude Code’s folder says so: the copy is Claude Code’s', (await a.text('.ov-row[data-key="notes"] + *') ?? '').includes('Not in Central Knot · OpenCode reads Claude Code’s copy, in Claude Code’s skills folder.'), await a.text('.ov-row[data-key="notes"] + *'));
  await fitsAtMinimum(a, 'Skills with OpenCode, a skill open');
  await pictures(a, 'opencode-skill-open');
  const view = await a.run('window.centralKnot.refresh()');
  same('its MCP server is read from its settings, off as its settings say', view.mcp.items.map(item => [item.key, item.switchedOff]), [['oc-docs', ['opencode-cli']]]);
  same('its agent is read from its agents folder', view.agents.items.map(item => [item.key, Object.keys(item.copies)]), [['helper', ['opencode-cli']]]);
  await a.click('#nav-mcp'); await a.click('#open-oc-docs'); await pictures(a, 'opencode-mcp-open');
  await a.click('#nav-agents'); await pictures(a, 'opencode-agents');
  await a.click('#nav-instructions'); await pictures(a, 'opencode-instructions');
  check('its instruction file is AGENTS.md in its own folder', (await a.text('.page') ?? '').includes('~/.config/opencode/AGENTS.md') && (await a.text('.page') ?? '').includes('Be brief.'), await a.text('.page'));
  await a.click('#nav-plugins');
  check('marketplaces are said to come from the tools that have them, not OpenCode', /Marketplaces you added in Claude Code show up here/.test(await a.text('.page') ?? ''), await a.text('.page'));
  await a.click('#nav-harnesses'); await a.click('#harness-opencode-cli');
  await pictures(a, 'opencode-page-skills');
  await a.click('#harness-tab-plugins');
  await pictures(a, 'opencode-page-plugins');
  check('its Plugins tab says where plugins install and that its parts can go in', /installs marketplace plugins into Claude Code\. A plugin’s page on Plugins can put its parts in OpenCode as separate items\./.test(await a.text('#harness-body') ?? ''), await a.text('#harness-body'));
  await a.click('#harness-tab-about');
  const about = await a.text('#harness-body');
  check('About names its folders and its settings file', ['~/.config/opencode/skills', '~/.claude/skills', '~/.config/opencode/opencode.json', '~/.config/opencode/agents', '~/.config/opencode/AGENTS.md'].every(path => about.includes(path)), about);
  await fitsAtMinimum(a, 'OpenCode’s page, About');
  await pictures(a, 'opencode-page-about');
  same('no page errors, OpenCode', a.pageErrors, []);
  await a.quit();

  // Writes, in the Practice copy (a real home is preview only off macOS): OpenCode joins it by its folder.
  const p = await launch(join(scratch, 'opencode-practice-data'), ['--practice-copy'], home, onlyHere);
  const practice = await p.run(`document.querySelector('.status-home').title`);
  const mine = join(practice, '.config/opencode');
  skill(join(mine, 'skills'), 'oc-only');
  writeFileSync(join(mine, 'opencode.json'), settingsBefore);
  await p.click('#header-refresh');
  await p.click('#nav-skills');
  check('an OpenCode folder gives OpenCode a mark on each row', await p.exists('.tool-mark[data-tool="opencode-cli"]'));
  same('a Claude Code skill is one OpenCode already reads', await cellState(p, 'notes', 'opencode-cli'), 'another-way');
  await p.click('#add-oc-only');
  check('adding OpenCode’s own skill copies it to the other tools', readNow(join(practice, '.claude/skills/oc-only/SKILL.md')) === text('oc-only') && readNow(join(practice, '.copilot/skills/oc-only/SKILL.md')) === text('oc-only'), await p.text('.bands'));
  // Taken in, notes goes to every tool but OpenCode, which reads Claude Code's copy: OpenCode's line says so, with no switch
  // of Central Knot's (nothing of it goes there), and its settings are untouched.
  await p.click('#add-notes');
  same('a skill OpenCode reads in Claude Code’s folder gets no second copy in OpenCode', [existsSync(join(mine, 'skills/notes')), await cellState(p, 'notes', 'opencode-cli')], [false, 'another-way']);
  if (await p.run(`document.querySelector('#open-notes')?.getAttribute('aria-expanded')`) !== 'true') await p.click('#open-notes');
  same('OpenCode’s line says it reads Claude Code’s copy, has no switch there, and its settings are untouched',
    [/OpenCode reads Claude Code’s copy/.test(await p.text('.ov-row[data-key="notes"] + *') ?? ''), await p.exists('#enable-notes-opencode-cli'), readNow(join(mine, 'opencode.json')) === settingsBefore], [true, false, true]);
  // Its server goes to the other tools in their own forms, values as they are; Claude Code's waits for Write to Claude Code.
  await p.click('#nav-mcp');
  await p.click('#add-oc-docs');
  const inCopilot = JSON.parse(readNow(join(practice, '.copilot/mcp-config.json')) || '{}').mcpServers?.['oc-docs'];
  same('OpenCode’s server reaches Copilot CLI in Copilot’s form', [inCopilot?.command, inCopilot?.args, inCopilot?.env], ['npx', ['-y', 'docs'], { DOCS_TOKEN: 'value-123' }]);
  // OpenCode takes no plugin whole: a plugin's skills, MCP servers and agents go in as ordinary items, in OpenCode's forms.
  const market = join(scratch, 'opencode-market');
  writeMarket(market);
  await p.run(`window.centralKnot.addMarketplace(${JSON.stringify(market)})`);
  await p.click('#nav-plugins');
  await p.click('#header-refresh');
  const box = plugin => `[id^="pcell-"][id$="-${plugin}-opencode-cli"]`;
  for (let tries = 0; tries < 50 && !(await p.exists(box('issue-tracker'))); tries++) await wait(100);
  same('OpenCode is a column whose boxes offer a plugin’s parts', [await p.run(`document.querySelector('${box('issue-tracker')}')?.dataset.state`), await p.run(`document.querySelector('${box('release-helper')}')?.dataset.state`)], ['parts-offer', 'parts-offer']);
  await p.click(box('issue-tracker'));
  await p.click(box('release-helper'));
  await p.click('#plugins-apply');
  for (let tries = 0; tries < 50 && (await p.run(`document.querySelector('${box('release-helper')}')?.dataset.state`)) !== 'parts'; tries++) await wait(100);
  const withParts = readNow(join(mine, 'opencode.json'));
  check('the plugin’s skill and MCP server are in OpenCode, the server in OpenCode’s form', existsSync(join(mine, 'skills/triage/SKILL.md')) && /"issues": \{\s*"type": "local",\s*"command": \[\s*"npx",\s*"-y",\s*"@example\/issues-mcp"\s*\]\s*\}/.test(withParts) && withParts.includes('// mine'), withParts || await p.text('.bands'));
  const partAgent = readNow(join(mine, 'agents/release-reviewer.md'));
  check('and a plugin’s agent is an OpenCode agent', partAgent.includes('description: Reviews a release branch before it ships.') && partAgent.includes('mode: all') && partAgent.includes('Review it.'), partAgent || await p.text('.bands'));
  await pictures(p, 'opencode-parts-four-tools');
  // Five tools is the widest table: nothing is cut off at the smallest window.
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await p.click('#header-refresh');
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
  for (let tries = 0; tries < 40 && !/Can go in|Its parts/.test(await p.text('.plugin-page') ?? ''); tries++) await wait(100);
  await fitsAtMinimum(p, 'a plugin’s page with five tools');
  await pictures(p, 'opencode-five-plugin-page');
  same('no page errors, OpenCode in the Practice copy', p.pageErrors, []);
  await p.quit();
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
  check('with a note and Undo', /claude-plugins-official won’t be suggested again\./.test(await a.text('.plugins-page') ?? '') && await a.exists('#outcome-suggest-again'), await a.text('.plugins-page'));
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
  check('with a note that it won’t be suggested again, and Undo', /copilot-plugins won’t be suggested again\./.test(await a.text('.plugins-page') ?? '') && await a.exists('#outcome-suggest-again'), await a.text('.plugins-page'));
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

/**
 * Another build of Central Knot on this Mac (otherbuilds.ts), as made-up bundles in a stand-in for /Applications: offered on
 * the Overview and in Settings, removed into the stand-in's Trash, gone from both pages after; an app of another id under the
 * product's name is offered nowhere. Where the build syncs the home, Take over syncing is two choices, and the first removes it.
 */
async function otherBuildFlow() {
  const mac = standInMac(join(scratch, 'mac-builds'));
  const alpha = () => mac.bundle(mac.applications, 'Central Knot Alpha', 'com.centralknot.alpha');
  const helper = mac.bundle(mac.applications, 'Central Knot Helper', 'com.example.helper');
  alpha();
  const inTrash = () => (existsSync(mac.trash) ? readdirSync(mac.trash) : []);
  const a = await launch(join(scratch, 'builds-data'), ['--practice-copy'], HOME, { CK_TEST_APPS: mac.root });
  const practice = await a.run(`document.querySelector('.status-home').title`);
  const bandText = () => a.text('#other-build-com-centralknot-alpha .band-text');
  const band = await bandText() ?? '';
  const path = `${mac.applications}/Central Knot Alpha.app`;
  check('the Overview names the other build, where it is, that one build syncs a home, which app Remove takes and what stays', band === `Central Knot Alpha is installed here too, in ${mac.applications}. Only one build of Central Knot syncs a home at a time. Removing quits every running copy of Central Knot Alpha, then moves ${path} to the Trash, where it stays until you empty the Trash. Your skills, MCP servers and agents, the record of them and History stay: they’re kept in this home, not in an app. Central Knot Alpha’s own settings folder stays too, and Central Knot itself is not touched.`, band);
  check('with Remove and Keep both beside it', await a.text('#other-build-action-com-centralknot-alpha') === 'Remove Central Knot Alpha' && await a.text('#other-build-hide-com-centralknot-alpha') === 'Keep both');
  check('an app of another id under the product’s name is offered nowhere', !(await a.run('document.body.innerText')).includes('Helper'));
  await fitsAtMinimum(a, 'the Overview with another build’s band');
  await a.click('#nav-settings');
  const rowId = `#setting-other-build-${`${mac.applications}/Central Knot Alpha.app`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const row = await a.text(rowId) ?? '', rowAction = rowId.replace('#setting-other-build-', '#other-build-row-');
  check('Settings has a row for it: what it is, where, that one build syncs a home, which app Remove takes, and Remove', row.startsWith(`Central Knot AlphaInstalled in ${mac.applications}. Only one build of Central Knot syncs a home at a time. Removing quits every running copy of Central Knot Alpha, then moves ${path} to the Trash`) && row.endsWith('Remove Central Knot Alpha'), row);
  check('and nothing for the other app', !(await a.run('document.body.innerText')).includes('Helper'));
  await fitsAtMinimum(a, 'Settings with another build’s row');
  await a.click('#nav-overview');
  await a.click('#other-build-action-com-centralknot-alpha');
  check('Remove moves the bundle to the Trash: gone from the folder, in the stand-in’s Trash', !existsSync(join(mac.applications, 'Central Knot Alpha.app')) && inTrash().join() === 'Central Knot Alpha.app', inTrash());
  const said = await a.text('[data-outcome] .band-text') ?? '';
  check('the band says where it went and what stays, and is gone', said.startsWith('Central Knot Alpha is in the Trash, where it stays until you empty the Trash. Your skills, MCP servers and agents') && said.endsWith('turn it off in System Settings › General › Login Items.') && !(await a.exists('#other-build-com-centralknot-alpha')), said);
  await a.click('#nav-settings');
  check('Settings has no row for it after', !(await a.exists(rowId)));
  check('the other app is where it was', existsSync(join(helper, 'Contents/Info.plist')));
  // Put back from the Trash: found again. The home's record now names it as the one that syncs this home.
  alpha();
  mkdirSync(join(practice, '.central-knot'), { recursive: true });
  writeFileSync(join(practice, '.central-knot/sync.json'), `${JSON.stringify({ formatVersion: 2, generation: 'from-the-alpha', owner: 'com.centralknot.alpha', ownerName: 'Central Knot Alpha' })}\n`);
  await a.click('#nav-skills');
  await a.click('#header-refresh');
  const owner = await a.text('#other-owner') ?? '';
  check('where it syncs the home, Take over syncing is two choices, each saying what it does', owner.includes('Central Knot Alpha is installed here too: take over and remove it, or take over and keep both. Removing quits every running copy')
    && await a.text('#take-over-remove') === 'Take over and remove Central Knot Alpha' && await a.text('#take-over-sync') === 'Take over, keep both', owner);
  await a.click('#nav-settings');
  const synced = await a.text(rowId) ?? '';
  check('its Settings row says it synced this home last, and offers the same two choices', synced.includes('Central Knot Alpha synced this home last and isn’t open, so removing it takes over syncing first.')
    && await a.text(rowAction) === 'Take over and remove Central Knot Alpha' && await a.text(`${rowAction}-keep`) === 'Take over, keep both', synced);
  await a.click('#nav-overview');
  check('and the Overview offers the same two choices, with no band of its own for it', !(await a.exists('#other-build-com-centralknot-alpha')) && await a.exists('#overview-take-over-remove'));
  await fitsAtMinimum(a, 'the Overview with the two take-over choices');
  await a.click('#nav-skills');
  await fitsAtMinimum(a, 'Skills with the two take-over choices');
  await a.click('#take-over-remove');
  const record = JSON.parse(readFileSync(join(practice, '.central-knot/sync.json'), 'utf8'));
  check('Take over and remove: this build syncs the home, and the other is in the Trash', record.owner !== 'com.centralknot.alpha' && !existsSync(join(mac.applications, 'Central Knot Alpha.app')) && inTrash().length === 2, { owner: record.owner, trash: inTrash() });
  check('said in that order, where the click was', (await a.text('[data-outcome] .band-text') ?? '').startsWith('Central Knot now syncs this home. Central Knot Alpha is in the Trash'), await a.text('[data-outcome] .band-text'));
  same('no page errors, another build', a.pageErrors, []);
  await a.quit();
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
  await a.click('#nav-skills');
  const rows = await rowKeys(a);
  for (const name of ['rich', '名前-skill', '.dot-skill', 'linked', 'from-copilot', 'has-link']) check(`row for ${name}`, rows.includes(name), rows);
  check('names keep their case', (await a.text('.ov-row[data-key="mixedcase"]')).includes('MixedCase'), await a.text('.ov-row[data-key="mixedcase"]'));
  check('malformed skill is no row', !rows.includes('bad-yaml'));
  same('the linked skill is the shared copy, which Claude Code has through its link and Copilot CLI reads: neither is Central Knot’s', [await cellState(a, 'linked', 'claude-cli'), await cellState(a, 'linked', 'copilot-cli')], ['another-way', 'another-way']);
  same('refused names and dot folders cannot go to Copilot', [await cellState(a, '名前-skill', 'copilot-cli'), await cellState(a, '.dot-skill', 'copilot-cli'), await cellState(a, 'plain', 'copilot-cli')], ['cannot', 'cannot', 'cannot']);
  same('a skill with a link inside can’t be copied as it is: its mark says so, and its Add waits', [await cellState(a, 'has-link', 'claude-cli'), await a.run(`document.querySelector('#add-has-link')?.disabled`)], ['unseen', true]);
  await fitsAtMinimum(a, 'Skills in a real home');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  await a.click(`[id="open-very-long-${'n'.repeat(150)}"]`);
  const fits = await a.run(`({ page: document.documentElement.scrollWidth, window: innerWidth })`);
  check('a very long name stays on screen at 960', fits.page <= fits.window, fits);
  await a.send('Emulation.clearDeviceMetricsOverride');
  await a.click(`[id="open-very-long-${'n'.repeat(150)}"]`);
  await a.shot('real-overview');
  if (!canWriteRealHome) {
    same('the switches and Add are off here', await a.run(`[...document.querySelectorAll('.ov-row[data-key] :is(.switch, .add-item)')].every(item => item.disabled)`), true);
    const refused = await a.run(`window.centralKnot.applySkills([{ key: 'rich', managed: true, off: [] }], false, document.querySelector('.status-home').title)`);
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
    same('the History window survives a restart; shortening it never writes a preview-only home, whose History still shows only the window, and the row says another copy removes the older History later rather than that it was removed',
      [restarted, readFileSync(previewHistory, 'utf8') === before, (await a.run('window.centralKnot.history()')).events.length, (await a.run('window.centralKnot.getSettings()')).historyDays, previewNote],
      [7, true, 0, 7, 'Saved. Older History in this home is removed the next time Central Knot records a change in it.']);
    await a.run('window.centralKnot.setHistoryDays(30)');
    rmSync(join(HOME, '.central-knot'), { recursive: true });
    await a.quit();
    return;
  }
  const wrongHome = await a.run(`window.centralKnot.applySkills([{ key: 'rich', managed: true, off: [] }], false, '/somewhere/else')`);
  check('an apply for another home is refused', wrongHome.writes === 0 && /not the one open/.test(wrongHome.stopped ?? ''), wrongHome);
  // Every skill turned on, one switch at a time, but private-one and those whose copies differ (each needs its own choice).
  const turnOn = await a.run(`[...document.querySelectorAll('.ov-row[data-key]')].filter(row => row.querySelector(':is(.add-item, .switch:not([aria-checked="true"])):not([disabled])') && !row.querySelector('[id^="decide-"]') && row.dataset.key !== 'private-one').map(row => row.dataset.key)`);
  for (const key of turnOn) await a.click(`.ov-row[data-key=${JSON.stringify(key)}] :is(.add-item, .switch)`);
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
  same('a skill that can’t be copied as it is stays found, written nowhere', [await switchOn(a, 'has-link'), await cellState(a, 'has-link', 'copilot-cli')], [false, 'none']);
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
  same('damaged record keeps every switch and Add off', await b.run(`document.querySelector('#add-private-one').disabled`), true);
  await b.quit();
  writeFileSync(record, good);
  b = await launch(join(scratch, 'other-data'));
  await b.click('#home-actual');
  await b.click('#nav-skills');
  check('lost settings ask to resume', await b.exists('#resume'), await b.text('.bands'));
  await b.click('#add-private-one');
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
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'app-settings.json'), JSON.stringify({ home: { mode: 'custom', path: home } }));
  const a = await launch(data);
  await a.click('#nav-skills');
  const row = `.ov-row[data-key="${name}"]`;
  const rowLineOf = tool => a.run(`[...document.querySelectorAll('.details-tool')].find(row => row.querySelector('strong')?.textContent === ${JSON.stringify(tool)})?.querySelector('.details-tool-line')?.textContent?.trim() ?? ''`);
  const opened = async () => { if (await a.run(`document.querySelector('#open-${name}')?.getAttribute('aria-expanded')`) !== 'true') await a.click(`#open-${name}`); };
  /** Copilot CLI's entry (a link, where it leads), the shared copy, Pi's own folder and Claude Code's, as they are on disk. */
  const onDisk = () => [lstatSync(join(copilot, name), { throwIfNoEntry: false })?.isSymbolicLink() ? `link:${readlinkSync(join(copilot, name))}` : existsSync(join(copilot, name, 'SKILL.md')) ? 'folder' : null,
    existsSync(join(agents, name, 'SKILL.md')), existsSync(join(pi, name, 'SKILL.md')), existsSync(join(claude, name, 'SKILL.md'))];
  check('the installer’s skill is a row, found', (await rowKeys(a)).includes(name) && !(await switchOn(a, name)), await rowKeys(a));
  await opened();
  same('each tool’s row says how it has the skill, and that it isn’t Central Knot’s', [await rowLineOf('Pi'), await rowLineOf('Copilot CLI')],
    ['Not in Central Knot · Pi also reads a copy at …/.agents/skills, which is not Central Knot’s.', 'Not in Central Knot · Copilot CLI also reads a copy at …/.agents/skills, which is not Central Knot’s.']);
  await a.shot('shared-unmanaged');
  // Add takes it in: Claude Code gets a copy; the link and the shared copy stay as they are.
  await a.click(`${row} .add-item`);
  for (let tries = 0; tries < 40 && !(await switchOn(a, name)); tries++) await wait(100);
  same('turning it on takes it in, gives Claude Code a copy, and leaves the link and the shared copy alone', onDisk(), [`link:${link}`, true, false, true]);
  check('the result says where it is on, and which tools have it another way', /opus-sol-loop is in Central Knot now, and on in Claude Code; Copilot CLI and Pi have it another way\./.test(await a.text('.bands') ?? ''), await a.text('.bands'));
  same('Copilot CLI and Pi are marked as having it another way', [await cellState(a, name, 'copilot-cli'), await cellState(a, name, 'pi-cli')], ['another-way', 'another-way']);
  await opened();
  check('each of their lines says nothing of Central Knot’s goes there while it does', /Nothing of Central Knot’s goes there while it does\./.test(await rowLineOf('Pi')) && /Nothing of Central Knot’s goes there while it does\./.test(await rowLineOf('Copilot CLI')), [await rowLineOf('Pi'), await rowLineOf('Copilot CLI')]);
  await fitsAtMinimum(a, 'a skill two tools have another way, opened');
  await a.shot('shared-taken-in');
  // Take over the shared copy, once confirmed: it is removed, Pi gets Central Knot's copy in its own folder, and so does
  // Copilot CLI, in place of its link (which led to the shared copy, and so nowhere now).
  await opened();
  const armedTitle = await a.run(`document.querySelector('#take-over-${name}-copilot-cli')?.title ?? ''`);
  await a.click(`#take-over-${name}-copilot-cli`);
  check('taking over the shared copy asks first, and says other apps won’t find it there', await a.exists(`#take-over-confirm-${name}-copilot-cli`) && /Other apps that read that folder won’t find it there/.test(armedTitle ?? ''), [armedTitle, await a.text('.details')]);
  await fitsAtMinimum(a, 'a take-over of the shared copy, asked');
  await a.shot('shared-take-over-armed');
  await a.click(`#take-over-confirm-${name}-copilot-cli`);
  for (let tries = 0; tries < 40 && (onDisk()[1] || onDisk()[0] !== 'folder'); tries++) await wait(100);
  same('confirmed, the shared copy goes, and Copilot CLI and Pi have Central Knot’s copy', [onDisk(), await cellState(a, name, 'copilot-cli'), await cellState(a, name, 'pi-cli')], [['folder', false, true, true], 'current', 'current']);
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
  same('came back: still on, Copilot CLI and Pi have it another way, the link and the shared copy as the installer left them', [await switchOn(a, name), await cellState(a, name, 'copilot-cli'), await cellState(a, name, 'pi-cli'), onDisk()], [true, 'another-way', 'another-way', [`link:${link}`, true, false, true]]);
  await a.shot('shared-came-back');
  // Delete from Central Knot removes only Central Knot's copy (Claude Code's); the link and the shared copy stay, and the
  // skill is found again.
  await opened();
  await a.click(`#delete-${name}`);
  await a.click(`#delete-confirm-${name}`);
  same('Delete from Central Knot removes Claude Code’s copy and leaves the link and the shared copy', onDisk(), [`link:${link}`, true, false, false]);
  check('and the skill is found again, as the installer’s', (await rowKeys(a)).includes(name) && !(await switchOn(a, name)), await rowKeys(a));
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
  check('Overview’s sync line says the rule in force', /edits spread between tools in seconds, and what turns up in a tool is taken in by Synchronize everything/.test(await a.text('.overview-more') ?? ''), await a.text('.overview-more'));
  await a.click('#nav-skills');
  same('on the Skills page notes and fresh are On and review stays found', await sectionsNow(a), [['on', ['fresh', 'notes']], ['found', ['review']]]);
  check('the Found heading says the rule in force: Synchronize everything leaves these, and how many wait for a choice', /Synchronize everything leaves these \(open a row to see why\)\. 1 waits for your choice of copy/.test(await foundNote() ?? ''), await foundNote());
  const notice = '.sync-notice[data-kind="taken-in"] .notice-text';
  same('one notice per pass says how many it took in, where they were found, and their names', await a.all(notice, 'e.textContent.replace(/ · .*$/, "")'),
    ['Synchronize everything took in 1 skill, found in Claude Code: fresh. History can undo it.', 'Synchronize everything took in 1 skill, found in Claude Code: notes. History can undo it.']);
  same('review’s row says why the rule leaves it: its copies differ, and opening it asks which', [await a.text('#decide-review'), await (async () => { await a.click('#open-review'); return a.exists('.details-differs'); })()], ['Copies differ', true]);
  await fitsAtMinimum(a, 'Skills with Synchronize everything on');
  await a.shot('everything-skills');
  await a.click('#nav-mcp');
  same('on the MCP servers page files, found in Codex, is On; Claude Code’s part waits for Write to Claude Code', [await sectionsNow(a), await a.exists('#mcp-write-claude')], [[['on', ['files']]], true]);
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
  same('and no pass takes it back: it is found, for good', [await sectionsNow(a), existsSync(join(codex, 'notes'))], [[['on', ['fresh']], ['found', ['notes', 'review']]], false]);
  await a.click('#open-notes');
  check('its line says why: deleted, so it is not added by itself again; Add or Restore brings it back', /It was deleted from Central Knot, so it will not be added by itself again\. Add, or Restore in History, brings it back\./.test(await a.text('.details-status') ?? ''), await a.text('.details-status'));
  // Two tools gain one new name with different content while Skills is open: the rule leaves it for a choice and writes
  // nothing, and the open page still shows it, with no click.
  skill(claude, 'split', text('split', 'One way.'));
  skill(codex, 'split', text('split', 'Another way.'));
  for (let tries = 0; tries < 80 && !(await rowKeys(a)).includes('split'); tries++) await wait(100);
  check('a new item the rule leaves waiting reaches the open page by itself', (await rowKeys(a)).includes('split') && await a.exists('#decide-split'), await rowKeys(a));
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
 * switch-on's one Undo in History and its Restore. Then a second home: Resume first, another build's home not asked, and No.
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
  check('a home never asked shows the question, counted as the pass counts: 2 items it takes in now and the tools that get them, then 2 more that wait with nothing chosen, the server Claude Code gets at Write, and what the one Undo covers',
    /^Yes takes in now the 2 items found in your tools .* \(Claude Code and Codex\);/.test(question) && /2 more items have copies that differ and wait for you: nothing is chosen for you\. You’re asked about each, one at a time, with the latest copy marked where one can be told/.test(question)
      && /Claude Code gets the MCP server when you click Write to Claude Code\. One Undo in History takes back what it takes in; a copy you choose has its own Undo\.$/.test(question), question);
  same('and says what No leaves', await a.text('#setup-no-says'), 'No changes nothing: what is already on stays on and keeps syncing, and each found item waits on its page for Add.');
  check('the lead no longer says to open a card and turn something on where the question stands', !/Open one below/.test(await a.text('.overview-lead') ?? ''), await a.text('.overview-lead'));
  same('Synchronize everything is the main button', await a.run(`document.querySelector('#setup-yes')?.className.includes('primary')`), true);
  await fitsAtMinimum(a, 'the Overview with first setup’s question');
  await a.shot('setup-question');
  await a.click('#setup-yes');
  for (let tries = 0; tries < 40 && !(await a.exists('#walkthrough')); tries++) await wait(100);
  same('Yes stores the rule on, takes in what it may (notes is in Codex now), and opens the walkthrough on Skills at 1 of 2, review, its latest copy (Codex’s) the main button',
    [record().syncEverything, readNow(join(codex, 'notes/SKILL.md')), await a.text('#walkthrough .walk-place'), await a.exists('#use-review-codex-cli .version-cta-main'), await a.exists('#use-review-claude-cli .version-cta-main')],
    [true, text('notes', 'Take notes.'), ' · 1 of 2', true, false]);
  check('the band after Yes says what it took in and what the one Undo covers', /^Synchronize everything is on: it took in 2 items, and 2 items with copies that differ wait for your choice\. One Undo in History takes back what it takes in; a copy you choose has its own Undo\./.test(await a.text('[data-outcome] .band-text') ?? ''), await a.text('[data-outcome] .band-text'));
  same('beside Skip, the walkthrough says it changes no copy', await a.text('#walk-note'), 'Skip changes no copy.');
  await fitsAtMinimum(a, 'the walkthrough at its first item');
  await a.shot('setup-walkthrough');
  await a.click('#use-review-codex-cli');
  same('a choice is the row’s own click: review is taken in with Codex’s copy, and the walkthrough says the next is on MCP servers',
    [readNow(join(claude, 'review/SKILL.md')), await a.text('#walkthrough .band-text')], [text('review', 'Review hard.'), 'Next: docs, on MCP servers.']);
  await a.click('#walk-go-on');
  same('at docs, 2 of 2: its entries have no dates to go by, nothing is preselected, and Use the latest for the rest can’t be used',
    [await a.text('#walkthrough .walk-place'), await a.text('#walk-note'), await a.exists('#walkthrough .version-cta-main'), await a.run(`document.querySelector('#walk-use-latest').disabled`)], [' · 2 of 2', 'No dates to go by: choose one, or skip it. Skip changes no copy.', false, true]);
  await fitsAtMinimum(a, 'the walkthrough at an item with no dates');
  await a.click('#walk-skip');
  same('skipped, the last: the band says what still waits and where, and docs stays found, its entries as they were',
    [await a.text('#walkthrough .band-text'), (await sectionsNow(a)).find(([place]) => place === 'found')?.[1]], ['1 skipped item still waits for a choice, its copies as they are: docs on MCP servers. Each row still asks.', ['docs']]);
  await a.click('#nav-overview');
  same('the Overview’s line counts what waits and starts choosing again, the last item having been skipped', [await a.text('#setup-choosing'), await a.exists('#setup-question')], ['1 found item has copies that differ and waits for your choice. Choose copies', false]);
  await a.click('#setup-choose');
  same('which opens the walkthrough at docs again', [await a.text('#walkthrough .walk-place'), await a.exists('#use-docs-codex-cli')], [' · 1 of 1', true]);
  await a.click('#walk-leave');
  await a.click('#nav-history');
  for (let tries = 0; tries < 30 && !(await a.exists('.history-row[data-kind="everything"]')); tries++) await wait(100);
  const ruleRow = '.history-row[data-kind="everything"]';
  same('History has the switch-on’s one entry, with its Undo', [await a.text(`${ruleRow} .history-about`), await a.text(`${ruleRow} .history-actions button`)],
    ['Switched on: a skill, MCP server or agent that turns up in a tool is taken into Central Knot by itself. Its Undo takes back what it takes in; a copy you choose has its own Undo, and an MCP server found in Claude Code has none (its entry says why).', 'Undo']);
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

  // A second home: a record made by a tool's Manage switch, then opened with no memory of it (Resume first); another build's home;
  // and No, which changes no file.
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
  await c.click('#setup-resume-button');
  check('resumed: the question', await c.exists('#setup-question'), await c.text('.overview-scroll'));
  const sync = join(other.home, '.central-knot/sync.json'), mine = readNow(sync);
  writeFileSync(sync, JSON.stringify({ ...JSON.parse(mine), owner: 'another-build', ownerName: 'Central Knot Alpha' }));
  await c.click('#header-refresh');
  same('another build’s home is not asked', await c.exists('#setup-question'), false);
  writeFileSync(sync, mine);
  await c.click('#header-refresh');
  const before = tree(other.home);
  await c.click('#setup-no');
  same('No stores the rule off, changes no file in the tools, and the question goes for good', [JSON.parse(readNow(sync)).syncEverything, Object.fromEntries(Object.entries(tree(other.home)).filter(([path]) => !path.startsWith('.central-knot'))), await c.exists('#setup-question')],
    [false, Object.fromEntries(Object.entries(before).filter(([path]) => !path.startsWith('.central-knot'))), false]);
  check('and says so: nothing changed, what is on stays on, found items wait for Add, Settings is the way to change it', /^Left off, and nothing changed: what is already on stays on and keeps syncing, and what Central Knot finds in your tools waits on its page for Add\./.test(await c.text('[data-outcome] .band-text') ?? ''), await c.text('[data-outcome] .band-text'));
  same('no page errors, first setup in a second home', c.pageErrors, []);
  await c.quit();

  // A third home, with Automatic sync off: Yes says nothing is added until Sync once, and offers it.
  const third = homeFor('home-setup-three');
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
  same('no page errors, first setup with Automatic sync off', d.pageErrors, []);
  await d.quit();
}

/** Force-kills the app part-way through real copies, then checks nothing half-written is visible to a tool. */
async function crashFlow() {
  execChmod();
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(COPILOT, { recursive: true });
  const expected = {};
  for (let number = 0; number < 40; number++) {
    const directory = skill(CLAUDE, `bulk-${number}`);
    for (let file = 0; file < 60; file++) writeFileSync(join(directory, `file-${file}.txt`), `${number}:${file}\n`.repeat(2000));
    expected[`bulk-${number}`] = tree(directory);
  }
  let interrupted = 0;
  for (let round = 0; round < crashRounds; round++) {
    const a = await launch(join(scratch, 'crash-data'));
    await a.click('#home-actual');
  await a.click('#nav-skills');
    // Each skill a click takes in is on record once it is carried out, one after another, so a kill leaves some taken in
    // (opening catches their copies up) and the rest still found: those are taken in again, in one request (no bulk switch on
    // the page), not waited for, so the kill lands while it copies.
    const record = join(HOME, '.central-knot/skills.json');
    await a.run(`(() => { const found = [...document.querySelectorAll('.ov-row[data-key^="bulk-"]')].filter(row => row.querySelector('.add-item')).map(row => ({ key: row.dataset.key, managed: true, off: [] }));
      if (found.length) window.centralKnot.applySkills(found, false, document.querySelector('.status-home').title); else document.querySelector('#header-refresh').click(); return true; })()`);
    await wait(30 + Math.round(round * 700 / Math.max(1, crashRounds - 1)) + randomInt(40));
    await a.crash();
    if (readdirSync(COPILOT).length < 40) interrupted++;
    for (const name of readdirSync(COPILOT)) {
      check(`round ${round}: nothing half-written in a loaded folder (${name})`, !name.startsWith('.'), name);
      if (expected[name]) same(`round ${round}: ${name} is complete or absent`, tree(join(COPILOT, name)), expected[name]);
    }
    if (existsSync(record)) { try { JSON.parse(readFileSync(record, 'utf8')); passes++; } catch { check(`round ${round}: record stays valid`, false); } }
  }
  const onRecord = (() => { try { return Object.values(JSON.parse(readFileSync(join(HOME, '.central-knot/skills.json'), 'utf8')).items).filter(item => item.on).length; } catch { return 0; } })();
  const a = await launch(join(scratch, 'crash-data'));
  await a.click('#home-actual');
  await a.click('#nav-skills');
  // Opening catches up every skill on record; the ones a kill left found are turned on, each.
  for (const key of await rowKeys(a)) if (key.startsWith('bulk-') && await a.exists(`#add-${key}`)) await a.click(`#add-${key}`);
  console.log(`crash finish: ${onRecord} of 40 on record before opening, caught up on open; the rest turned on again`);
  same('after crashes, opening again completes every copy', readdirSync(COPILOT).filter(name => name.startsWith('bulk-')).length, 40);
  for (const name of Object.keys(expected)) same(`final ${name} bytes`, tree(join(COPILOT, name)), expected[name]);
  same('stale stages are cleared', readdirSync(join(HOME, '.copilot')).filter(name => name.startsWith('.ck-')), []);
  same('no page errors, crashes', a.pageErrors, []);
  await a.quit();
  console.log(`crash rounds: ${crashRounds}, interrupted a copy in ${interrupted}`);
  check('at least one round really interrupted copying', interrupted > 0, interrupted);
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
  const mode = join(realHome, 'draft-mode'), got = join(realHome, 'draft-got');
  const draft = ['<<<CENTRAL KNOT: base>>>', '# Style', 'Be brief.', '<<<CENTRAL KNOT: claude-cli>>>', '# Claude', 'Use the Task tool.', '<<<CENTRAL KNOT: codex-cli>>>', 'Run codex review before pushing.', '<<<CENTRAL KNOT: end>>>'].join('\n');
  const answers = `case "$(cat '${mode}')" in\n  fail) echo "Not logged in · Please run /login" >&2; exit 1 ;;\n  slow) cat > /dev/null; sleep 60 ;;\nesac\ncat > '${got}'\npwd > '${got}.cwd'\n`;
  const stub = (name, version, answer) => { writeFileSync(join(realHome, '.local/bin', name), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${version}" && exit 0\n${answers}${answer}\n`); chmodSync(join(realHome, '.local/bin', name), 0o755); };
  stub('claude', '2.1.322 (Claude Code)', `[ "$1" = "-p" ] || exit 9\ncat <<'EOF'\n${draft}\nEOF`);
  stub('codex', 'codex-cli 0.167.0', `[ "$1" = "exec" ] || exit 9\nprev=""\nfor arg; do [ "$prev" = "-o" ] && out="$arg"; prev="$arg"; done\necho "working"\ncat > "$out" <<'EOF'\n${draft}\nEOF`);
  writeFileSync(mode, 'fail');

  const a = await launch(data, [], realHome);
  const says = async selector => (await a.text(selector)) ?? '';
  const untilThere = async selector => { for (let tries = 0; tries < 80 && !(await a.exists(selector)); tries++) await wait(100); return a.exists(selector); };
  await a.click('#nav-instructions');
  check('with tools that can write one, the base card offers a draft', await untilThere('#base-draft'), await says('#base-card'));
  await a.shot('draft-entry');
  await a.click('#base-draft');
  // Claude Code and Codex have a CLI in the HOME the app is given. Copilot CLI has only its folder in the home on screen, so
  // it is offered only on a machine that has its CLI in a system folder (which no test home can hide).
  const offered = await a.all('#base-card [id^="base-draft-by-"]', 'e.textContent');
  check('each tool with a CLI on this computer is offered by name', offered.includes('Draft with Claude Code') && offered.includes('Draft with Codex') && offered.every(label => label.startsWith('Draft with ')), offered);
  if (!existsSync('/opt/homebrew/bin/copilot') && !existsSync('/usr/local/bin/copilot')) check('and a tool with no CLI is not', !offered.includes('Draft with Copilot CLI'), offered);
  check('before a tool is chosen, the card says what it will do and that the draft is seen first', /splits them/.test(await says('#base-card')) && /before anything is saved/.test(await says('#base-card')), await says('#base-card'));
  await a.click('#base-draft-by-claude-cli');
  check('a tool that can’t answer says why in its own words, and the other tool can still be tried', (await says('#base-draft-problem')).includes('Claude Code could not write a draft: “Not logged in · Please run /login”. Nothing was changed.') && await a.exists('#base-draft-by-codex-cli'), await says('#base-card'));
  same('and nothing was written', [readNow(claudeMd), readNow(agentsMd), existsSync(copilotMd), existsSync(join(home, '.central-knot/instructions/base.md'))], [claude0, codex0, false, false]);
  await a.shot('draft-problem');

  // A tool that takes its time: the card says it is writing, and Stop ends it.
  writeFileSync(mode, 'slow');
  await a.run(`document.querySelector('#base-draft-by-codex-cli').click()`);
  check('while a tool writes, the card says so and offers Stop', await untilThere('#base-draft-stop') && /Codex is writing a draft of the base instructions/.test(await says('#base-card')), await says('#base-card'));
  await a.shot('draft-writing');
  await a.click('#base-draft-stop');
  check('Stop goes back to choosing a tool, with nothing said to be wrong', await untilThere('#base-draft-by-codex-cli') && !(await a.exists('#base-draft-problem')), await says('#base-card'));

  // A draft: reviewed first, each file's change said, and what the draft carried nowhere pointed out.
  writeFileSync(mode, 'ok');
  await a.click('#base-draft-by-codex-cli');
  check('the draft opens as a review that names who wrote it', await untilThere('#base-save') && (await says('.ins-review-title')) === 'Codex’s draft. Check it, then save.', await says('#base-card'));
  const prompt = readNow(got);
  check('the tool was sent each file’s own text', prompt.includes(`<<<FILE: claude-cli, Claude Code’s CLAUDE.md>>>\n${claude0}<<<END OF FILE>>>`) && prompt.includes(`<<<FILE: codex-cli, Codex’s AGENTS.md>>>\n${codex0}<<<END OF FILE>>>`), prompt);
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
  await a.shot('draft-entry-with-base');
  await a.click('#outcome-undo-base');
  same('Undo puts every file back as it was', [readNow(claudeMd), readNow(agentsMd), existsSync(copilotMd)], [claude0, codex0, false]);

  // A file that changes after the draft was written: the draft knows nothing of it, so it can't be saved.
  await a.click('#base-draft'); await a.click('#base-draft-by-claude-cli');
  await untilThere('#base-save');
  writeFileSync(claudeMd, `${claude0}Typed after the draft.\n`);
  await a.click('#header-refresh');
  check('a file changed after the draft was written stops its save, and says so', await untilThere('#base-draft-stale') && await a.run(`document.querySelector('#base-save').disabled`) && /Claude Code’s file changed after this draft was written/.test(await says('#base-draft-stale')), await says('#base-card'));
  await a.click('#base-review-discard'); await a.click('#base-review-discard-yes');
  check('discarding the draft leaves the card as it was', await a.exists('#base-draft') && !(await a.exists('#base-save')) && readNow(claudeMd) === `${claude0}Typed after the draft.\n`, await says('#base-card'));
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
  same('the plugins show as up to date, and the dropped one as no longer offered, still installed in Claude Code',
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
  check('Check now says what it came to: one update couldn’t be made, with the way to the note', /Last checked today at .*\. 1 update couldn’t be made\./.test(await a.text('#setting-plugin-updates-notice') ?? '') && (await a.text('#setting-plugin-updates-notice-action')) === 'See Plugins', await a.text('#setting-plugin-updates'));
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
  await a.click('#plugins-apply');
  check('Update on the page makes it, and the failure’s note goes with no check in between', await until(() => versions()['issue-tracker'] === '4.0.0' && noted().failures?.length === 0, 10000) && await until(async () => !(await a.exists('#plugin-updates-failed')), 5000), JSON.stringify([versions(), noted().failures, await a.text('#plugin-updates-failed')]));
  same('no page errors, plugin updates on a schedule', a.pageErrors, []);
  await a.quit();
}

const execChmod = () => spawnSync('chmod', ['-R', 'u+rwx', scratch]);

// ---------- Run ----------
const started = Date.now();
try {
  seedHome();
  // Each flow's time is printed, so a run that grows slow says where.
  const flows = [harnessFlow, manageFlow, practiceFlow, releasedStartupFlow, updateFlow, fewToolsFlow, openCodeFlow, suggestedFlow, otherAppsFlow, otherBuildFlow, listDiffersFlow, pluginUpdatesFlow, repoBaseFlow, sourcesFlow, draftFlow, sharedCopiesFlow, syncEverythingFlow, firstSetupFlow, realHomeFlow, ...(canWriteRealHome && crashRounds > 0 ? [crashFlow] : [])];
  const named = option('--flows')?.split(',');
  for (const flow of flows.filter(each => !named || named.includes(each.name))) {
    const from = Date.now();
    await flow();
    console.log(`${flow.name}: ${Math.round((Date.now() - from) / 1000)}s`);
  }
  execChmod();
} catch (error) {
  failures.push(`aborted: ${error.message}`);
  console.error(error);
} finally {
  app?.child.kill('SIGKILL');
  execChmod();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}
console.log(`e2e: ${passes} passed, ${failures.length} failed, ${Math.round((Date.now() - started) / 1000)}s, ${process.platform}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
