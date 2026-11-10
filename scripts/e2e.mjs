// Drives the real app end to end over its debug port, in a throwaway HOME, so "This Mac's home" is disposable too.
// Usage: node scripts/e2e.mjs [--electron] [--no-sandbox] [--shots dir] [--crash-rounds n]
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, cpSync, existsSync, renameSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { writeClaudeInstall, writeMarket } from './fixture-market.mjs';
import { connect, DAY, holdQueue, keepFor, mainProcess, refocus, standIn } from './cdp.mjs';

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

// ---------- Disposable home ----------
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ck-e2e-')));
const HOME = join(scratch, 'home');
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

async function launch(userData = join(scratch, 'data'), extra = [], home = HOME) {
  const port = 9400 + randomInt(500);
  const env = { HOME: home, PATH: `${join(scratch, 'bin')}:/usr/bin:/bin`, TMPDIR: join(scratch, 'tmp') };
  mkdirSync(env.TMPDIR, { recursive: true });
  for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
  // A dev run also opens its main process to the checks (an installed app doesn't take --inspect).
  const inspect = flag('--electron') ? port + 1000 : undefined;
  const child = spawn(command, [...(flag('--electron') ? [root, `--inspect=${inspect}`] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ...(flag('--no-sandbox') ? ['--no-sandbox'] : []), ...extra], { env, stdio: 'ignore' });
  launched.add(child);
  child.once('exit', () => launched.delete(child));
  let targets;
  for (let attempt = 0; attempt < 150 && !targets; attempt++) {
    await wait(200);
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(target => target.type === 'page'); if (!targets.length) targets = undefined; } catch { /* still starting */ }
  }
  if (!targets) { child.kill('SIGKILL'); throw new Error('The app did not open a debug port.'); }
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
    restore: channel => run(`(() => { ${electron}.ipcMain._invokeHandlers.set(${JSON.stringify(channel)}, globalThis.ckAside); delete globalThis.ckAside; return true; })()`),
    close,
  };
}

// ---------- Flows ----------
const rowKeys = a => a.all('.ov-row[data-key]', 'e.dataset.key');
const cellState = (a, key, tool) => a.run(`document.querySelector('.ov-row[data-key=${JSON.stringify(key)}] [data-tool=${JSON.stringify(tool)}] .cell-button')?.dataset.state ?? null`);
const switchOn = (a, key) => a.run(`document.querySelector('.ov-row[data-key=${JSON.stringify(key)}] .switch')?.getAttribute('aria-checked') === 'true'`);
const applyAll = async a => { await a.click('#apply'); await a.settle(); };

/** Harnesses: one tool's page manages its items with the same engine as the Skills page. */
async function harnessFlow() {
  // A packaged build starts on this computer's home: the switch puts it on the Practice copy, as a dev build starts.
  const a = await launch(join(scratch, 'harness-data'), ['--practice-copy']);
  const practice = await a.run(`document.querySelector('.status-home').title`);
  await a.click('#nav-harnesses');
  const list = await a.text('#harnesses-scroll') ?? '';
  check('Harnesses sums up each tool found', ['Claude Code', 'Copilot CLI', 'Codex'].every(name => list.includes(name)) && list.includes('none managed'), list.slice(0, 400));
  // The card's count and the tab it opens agree; another harness starts with the filter off.
  const cardDiffer = parseInt(await a.text('#harness-claude-cli-differ-skills') ?? '', 10);
  await a.click('#harness-claude-cli-differ-skills');
  same('a card’s different-copies count is the Copies differ count on the tab it opens', [cardDiffer, parseInt(await a.text('.chip-warn .chip-count') ?? '', 10), (await rowKeys(a)).length], [1, 1, 1]);
  await a.click('#harness-switch-codex-cli');
  check('the switcher opens another harness with every row, not an empty filter', (await a.text('.title-harness')) === 'Codex' && (await a.text('.chip-on')) === 'All' && (await rowKeys(a)).length > 0, `${await a.text('#header')} ${await a.text('.chips')}`);
  await a.click('#harness-back');
  await a.click('#harness-copilot-cli');
  await a.click('#harness-tab-skills');
  check('a harness’s skills put its own column first', (await a.text('.ov-head .ov-tool-head') ?? '').includes('Copilot CLI'), await a.text('.ov-head'));
  const away = await a.run(`[...document.querySelectorAll('[role="rowgroup"]')].find(group => group.querySelector('.ov-section-label strong')?.textContent === 'Not in Copilot CLI')?.querySelector('[data-key="release-notes"]') ? true : false`);
  check('a skill only other tools have is under "Not in Copilot CLI"', away);
  await a.click('#cell-release-notes-copilot-cli');
  same('its box here adds it here only', [await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'release-notes', 'codex-cli')], ['will-sync', 'absent']);
  await a.click('#discard');
  await a.click('#manage-all');
  same('Manage on a harness page takes what it has and leaves items only other tools have', [await switchOn(a, 'notes'), await switchOn(a, 'release-notes')], [true, false]);
  await a.click('#discard');
  await a.click('#harness-add-from');
  await a.click('#menu-add-claude-cli-copilot-cli');
  const queued = await cellState(a, 'release-notes', 'copilot-cli');
  await a.shot('harness-pending');
  await applyAll(a);
  check('Add from… queues a copy here, and Apply all writes it only where the menu said', queued === 'will-sync' && existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')) && !existsSync(join(practice, '.codex/skills/release-notes')), queued);
  check('and says so there', await a.exists('.harness-page .band-done'), await a.text('.harness-page'));
  await a.click('#nav-harnesses');
  check('the sidebar’s Harnesses leaves that result behind', !(await a.exists('.band-done')), await a.text('#page'));
  await a.click('#nav-skills');
  check('the Skills page shows the same change and is its usual self: Claude Code first, no "Not in" section', (await switchOn(a, 'release-notes')) && (await a.text('.ov-head .ov-tool-head') ?? '').includes('Claude Code') && !(await a.all('.ov-section-label strong')).some(label => label.startsWith('Not in')), await a.text('.ov-head'));
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

// ---------- Fit: nothing is cut off ----------
// In the page, on both axes: each control (button, switch, input, filter chip, tool label) that the window or a clipping
// ancestor cuts. A control a scroll area can bring into view is reachable there, but that scroll area's own viewport must
// still be visible within every clipping boundary outside it, up to the window. Also each region that scrolls sideways,
// each bar the app's own fitting (dom.ts fitBars) marks as still too wide, and an open menu outside its scroll area.
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
  for (const menu of document.querySelectorAll('.tool-menu')) {
    const box = menu.getBoundingClientRect(), area = menu.closest('.scroll').getBoundingClientRect();
    if (!inside(box, area, 'x') || !inside(box, area, 'y')) out.push('menu outside its area: ' + menu.getAttribute('aria-label'));
  }
  return out;
})()`;

/** Sizes the page as the window would be, and lets the app hear the resize. */
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
 * At the smallest window, first with the sidebar folded to its rail and then open, nothing on this page is cut off.
 * `again` puts back what the sidebar toggle's click closes, such as an open menu.
 */
async function fitsAtMinimum(a, where, again = async () => {}) {
  await sizeTo(a, 860, 560); await again();
  same(`nothing cut off at 860×560 with the rail: ${where}`, await a.run(CUT_OFF), []);
  await a.click('#sidebar-toggle'); await again();
  same(`nothing cut off at 860×560 with the sidebar open: ${where}`, await a.run(CUT_OFF), []);
  await a.click('#sidebar-toggle');
  await fullSize(a);
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
  // The newest message wins: Discard right after opening a home says so, rather than the home's "Opened …" standing.
  await a.click('#home-fixture');
  await a.click('#nav-skills');
  const openedSaid = await a.run(`document.querySelector('#announcement').dataset.text`);
  await a.click('#manage-all');
  await a.click('#discard');
  same('Discard right after opening a home says so', [/^Opened Practice copy\./.test(openedSaid ?? ''), await a.run(`document.querySelector('#announcement').dataset.text`)], [true, 'Changes discarded. Nothing was written.']);
  await a.click('#nav-overview');
  await a.click('#overview-skills');
  same('rows', (await rowKeys(a)).sort(), ['notes', 'release-notes', 'review', 'standup']);
  same('nothing is managed at first', await Promise.all(['notes', 'release-notes', 'review', 'standup'].map(key => switchOn(a, key))), [false, false, false, false]);
  same('cells say what each tool has', [await cellState(a, 'release-notes', 'claude-cli'), await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'review', 'copilot-cli')], ['present', 'absent', 'present-differs']);
  check('copies differ is flagged', await a.exists('#decide-review'));
  await a.shot('practice-overview');
  const practice = await a.run(`document.querySelector('.status-home').title`);
  check('practice home is not the disposable real home', practice !== HOME && existsSync(practice), practice);
  const reviewClaude = readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8');
  const reviewCopilot = readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8');

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
  // An open column menu fits at the smallest window, and keeps fitting while the window shrinks and grows under it.
  await fitsAtMinimum(a, 'Skills with Codex’s menu open', async () => { if (!(await a.exists('.tool-menu'))) await a.click('#tool-codex-cli'); });
  await a.click('#tool-codex-cli');
  for (const [width, height] of [[860, 560], [1728, 1117], [860, 560], [1280, 800]]) {
    await sizeTo(a, width, height);
    same(`the open menu still fits after resizing to ${width}×${height}`, [await a.exists('.tool-menu'), ...(await a.run(CUT_OFF))], [true]);
  }
  await a.press('Escape');
  await fullSize(a);
  // Add all from Copilot CLI to Claude Code: new, same and different are told apart, and differing copies are opt-in.
  await a.click('#tool-copilot-cli');
  const groups = await a.run(`[...document.querySelectorAll('.add-target[data-target="claude-cli"] [data-group]')].map(group => group.dataset.group + ':' + (group.dataset.count ?? '1'))`);
  same('Add all groups for Claude Code', groups, ['new: will be copied:1', 'identical: starts syncing:1', 'different:1']);
  same('Add leaves differing copies out at first', [await a.text('#menu-add-copilot-cli-claude-cli'), await a.exists('#menu-conflicts-note-copilot-cli-claude-cli')], ['Add 2', false]);
  await a.click('#menu-conflicts-copilot-cli-claude-cli');
  const note = await a.text('#menu-conflicts-note-copilot-cli-claude-cli') ?? '';
  check('opting in says whose copy is accepted and that the replaced one is kept', note.includes('You accept Copilot CLI’s copy') && note.includes('Claude Code') && note.includes('store keeps'), note);
  same('and counts it', await a.text('#menu-add-copilot-cli-claude-cli'), 'Add 3');
  await a.click('#menu-add-copilot-cli-claude-cli');
  same('Add all queues all three as managed', await Promise.all(['notes', 'standup', 'review'].map(key => switchOn(a, key))), [true, true, true]);
  check('the differing copy is chosen from Copilot CLI, as a choice you can undo', (await a.exists('#undo-review')) && (await a.text('.ov-row[data-key="review"] .decided') ?? '').includes('Copilot CLI'));
  same('Add all writes nothing before Apply all', [existsSync(join(practice, '.claude/skills/standup')), readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8')], [false, reviewClaude]);
  await a.shot('practice-add-all-conflicts');
  await a.click('#discard');

  // Manage all, then Discard: nothing changes.
  await a.click('#manage-all');
  same('Manage all queues the three it can', await Promise.all(['notes', 'release-notes', 'standup', 'review'].map(key => switchOn(a, key))), [true, true, true, false]);
  check('nothing written before Apply all', !existsSync(join(practice, '.copilot/skills/release-notes')));
  await a.click('#discard');
  same('Discard clears every change', await switchOn(a, 'notes'), false);

  // Manage all, Apply all.
  await a.click('#manage-all');
  await a.shot('practice-pending');
  await applyAll(a);
  same('copies written both ways', [existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), existsSync(join(practice, '.claude/skills/standup/SKILL.md'))], [true, true]);
  same('copy bytes match', tree(join(practice, '.copilot/skills/release-notes')), tree(join(practice, '.claude/skills/release-notes')));
  same('Codex is a column and gets its copies too', [await a.exists('#tool-codex-cli'), existsSync(join(practice, '.codex/skills/notes/SKILL.md')), existsSync(join(practice, '.codex/skills/standup/SKILL.md'))], [true, true, true]);
  check('Codex’s own .system skills stay untouched and unlisted', existsSync(join(practice, '.codex/skills/.system/openai-docs/SKILL.md')) && !(await rowKeys(a)).includes('openai-docs'));

  // Disable and Remove, per tool: Codex's own switch turns standup off there while its copy stays; Undo flips it back, byte for byte.
  // Remove takes only Codex's copy of notes out, and Restore puts it back.
  const switchConfig = join(practice, '.codex/config.toml');
  const switchBefore = readFileSync(switchConfig, 'utf8');
  await a.click('#open-standup');
  await a.click('#enable-standup-codex-cli');
  check('Disable waits for Apply all', readFileSync(switchConfig, 'utf8') === switchBefore && (await a.text('.apply-count') ?? '').includes('1 copy to disable'), await a.text('.apply-count'));
  await applyAll(a);
  check('Disable writes Codex’s own switch and keeps the copy', readFileSync(switchConfig, 'utf8').endsWith(`[[skills.config]]\npath = ${JSON.stringify(join(practice, '.codex/skills/standup/SKILL.md'))}\nenabled = false\n`) && existsSync(join(practice, '.codex/skills/standup/SKILL.md')), readFileSync(switchConfig, 'utf8'));
  same('the Codex cell is marked disabled, the others are not', [await a.exists('.ov-row[data-key="standup"] [data-tool="codex-cli"] .cell-disabled'), await a.exists('.ov-row[data-key="standup"] [data-tool="claude-cli"] .cell-disabled')], [true, false]);
  await a.click('#outcome-undo-switch');
  same('Undo enables it again and leaves config.toml as it was', readFileSync(switchConfig, 'utf8'), switchBefore);
  await a.click('#open-notes');
  await a.click('#remove-notes-codex-cli');
  await applyAll(a);
  same('Remove takes out only Codex’s copy', [existsSync(join(practice, '.codex/skills/notes')), existsSync(join(practice, '.claude/skills/notes/SKILL.md')), existsSync(join(practice, '.copilot/skills/notes/SKILL.md'))], [false, true, true]);
  await a.click('#nav-history');
  await a.run(`document.querySelector('.history-row[data-kind="removed"] button').click()`);
  await a.settle();
  same('Restore in History puts it back', readFileSync(join(practice, '.codex/skills/notes/SKILL.md'), 'utf8'), readFileSync(join(practice, '.claude/skills/notes/SKILL.md'), 'utf8'));
  check('and names the tool as people know it', (await a.run(`document.querySelector('#announcement').dataset.text`) ?? '').startsWith('notes is back in Codex.'), await a.run(`document.querySelector('#announcement').dataset.text`));
  await a.click('#nav-skills');

  // Profiles: a profile with only notes in it turns every other skill and MCP server off with each tool's own switch, in one
  // History step; the copies and MCP entries stay where they are, and Undo puts every switch back.
  const switchFiles = ['.claude/settings.json', '.copilot/settings.json', '.codex/config.toml'].map(file => join(practice, file));
  const readSwitches = () => switchFiles.map(file => (existsSync(file) ? readFileSync(file, 'utf8') : ''));
  const switchesBefore = readSwitches();
  const claudeJsonBefore = readFileSync(join(practice, '.claude.json'), 'utf8');
  await a.click('#nav-profiles');
  await a.click('#profile-new');
  await a.run(`(() => { const input = document.querySelector('#profile-name'); input.value = 'Incident'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await a.settle();
  await a.click('#pf-skill\\:notes');
  check('ticking only edits the profile', JSON.stringify(readSwitches()) === JSON.stringify(switchesBefore));
  await a.click('#profile-switch');
  const [claudeSwitches, copilotSwitches, codexSwitches] = readSwitches();
  same('the switch turns the rest off in each tool’s own settings, and leaves notes (ticked) on', [JSON.parse(claudeSwitches).skillOverrides?.notes ?? 'on', (JSON.parse(copilotSwitches).disabledSkills ?? []).includes('notes'), JSON.parse(claudeSwitches).skillOverrides?.standup, JSON.parse(claudeSwitches).deniedMcpServers, JSON.parse(copilotSwitches).disabledMcpServers, codexSwitches.split(/\n(?=\[)/).find(table => table.startsWith('[mcp_servers.files]'))?.includes('\nenabled = false\n')],
    ['on', false, 'off', [{ serverName: 'docs' }], ['files'], true]);
  same('nothing is moved: copies and MCP entries stay', [existsSync(join(practice, '.claude/skills/standup/SKILL.md')), readFileSync(join(practice, '.claude.json'), 'utf8') === claudeJsonBefore], [true, true]);
  same('the status bar names the profile in use', (await a.text('#status-profile'))?.trim(), 'Incident');
  await a.click('#outcome-undo');
  // settings.json files the switch made hold only emptied switch lists afterwards; Codex's config.toml is byte for byte as it was.
  const settled = (text, index) => (index === 2 ? text : JSON.stringify(Object.fromEntries(Object.entries(text.trim() ? JSON.parse(text) : {}).filter(([, value]) => !(value && typeof value === 'object' && !Object.keys(value).length)))));
  same('Undo switch puts every switch back', readSwitches().map(settled), switchesBefore.map(settled));
  same('…and No profile is in use again', (await a.text('#status-profile'))?.trim(), 'No profile');
  await a.click('#nav-skills');
  // A switch from the status bar with changes queued: a queued Disable the switch already made is dropped, saying so; the other
  // stays; and the switch's result shows over the pending changes, with its Undo.
  const switchFromBar = async name => { await a.click('#status-profile'); await a.run(`[...document.querySelectorAll('.pf-menu-item')].find(item => item.textContent.includes(${JSON.stringify(name)})).click()`); await a.settle(); };
  const statusShown = () => a.run(`(() => { const region = document.querySelector('#announcement'); return region.classList.contains('visually-hidden') ? '' : region.dataset.text; })()`);
  const openRow = async (key, probe) => { if (!(await a.exists(probe))) await a.click(`#open-${key}`); };
  await openRow('notes', '#enable-notes-claude-cli'); await a.click('#enable-notes-claude-cli');
  await openRow('standup', '#enable-standup-claude-cli'); await a.click('#enable-standup-claude-cli');
  await switchFromBar('Incident');
  check('a queued Disable that the profile switch already made is dropped; the other stays', (await a.text('.apply-count .count-full')) === '1 change · 1 copy to disable', await a.text('.apply-count .count-full'));
  check('the switch’s result shows over pending changes, with Undo switch', (await a.text('.band-done') ?? '').includes('Incident is the profile now') && await a.exists('#outcome-undo'), await a.text('.bands'));
  await a.click('#outcome-undo');
  await a.click('#discard');
  // On History (no result band) the switch is listed at once and its result is said in the status bar, as is its Undo from there.
  await a.click('#nav-history');
  const profileRows = async () => (await a.all('.history-row[data-kind="profile"]')).length;
  const rowsBeforeSwitch = await profileRows();
  await switchFromBar('Incident');
  check('a switch from the status bar on History is listed at once and said', (await profileRows()) === rowsBeforeSwitch + 1 && /^Incident is the profile now/.test(await statusShown() ?? ''), [rowsBeforeSwitch, await profileRows(), await statusShown()]);
  // Claude Code's switch for standup is turned back on by hand: the Undo leaves it, and says so where it can be seen.
  const claudeSettings = JSON.parse(readFileSync(switchFiles[0], 'utf8'));
  delete claudeSettings.skillOverrides.standup;
  writeFileSync(switchFiles[0], JSON.stringify(claudeSettings, null, 2));
  await a.run(`document.querySelector('.history-row[data-kind="profile"] .history-actions button').click()`); await a.settle();
  check('its Undo from History says what it did, and what it left, in the status bar', /^Undone:/.test(await statusShown() ?? '') && /changed since, so it was left as it is/.test(await statusShown() ?? '') && (await a.text('#status-profile'))?.trim() === 'No profile', await statusShown());
  await a.click('#nav-skills');
  // An armed Delete everywhere stays on the visit it was clicked on.
  const standupOpen = () => openRow('standup', '#delete-standup, #delete-confirm-standup');
  await standupOpen(); await a.click('#delete-standup');
  await a.click('#nav-overview'); await a.click('#nav-skills'); await standupOpen();
  check('an armed Delete everywhere is disarmed by leaving the page', await a.exists('#delete-standup') && !(await a.exists('#delete-confirm-standup')), await a.all('.delete-armed button'));

  // Two-way: an edit in one tool spreads on the next read, Undo puts it back; a deletion spreads after the settle window; Restore returns it.
  const standupPath = tool => join(practice, `.${tool}/skills/standup/SKILL.md`);
  const standupBefore = readFileSync(standupPath('claude'), 'utf8');
  writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited in Claude Code.\n'));
  await a.click('#header-refresh');
  same('an edit spreads to every tool on the next read', [readFileSync(standupPath('copilot'), 'utf8'), readFileSync(standupPath('codex'), 'utf8')].map(text => text.includes('Edited in Claude Code.')), [true, true]);
  check('and says so, with Undo', (await a.text('.sync-notices') ?? '').includes("standup was edited in Claude Code and copied to"), await a.text('.bands'));
  check('without also calling it a catch-up', !(await a.text('.bands') ?? '').includes('Caught up'), await a.text('.bands'));
  await a.shot('practice-edit-spread');
  await a.run(`document.querySelector('.sync-notice[data-kind="edit"] .see-change').click()`);
  for (let tries = 0; tries < 20 && !(await a.exists('.sync-notice .change-panel .ins-added')); tries++) await wait(100);
  check('See change shows the edit before Undo', (await a.text('.sync-notice .change-panel .ins-added') ?? '').includes('Edited in Claude Code.'), await a.text('.sync-notices'));
  await a.run(`document.querySelector('.sync-notice[data-kind="edit"] [id^="notice-undo-"]').click()`);
  await a.settle();
  same('Undo puts the old version back everywhere', [readFileSync(standupPath('claude'), 'utf8'), readFileSync(standupPath('copilot'), 'utf8')], [standupBefore, standupBefore]);
  rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
  await a.click('#header-refresh');
  check('a fresh deletion waits for the settle window: nothing deleted or recreated yet', existsSync(join(practice, '.claude/skills/release-notes')) && !existsSync(join(practice, '.copilot/skills/release-notes')));
  await wait(2200);
  await a.click('#header-refresh');
  same('then the deletion spreads', [existsSync(join(practice, '.claude/skills/release-notes')), existsSync(join(practice, '.codex/skills/release-notes'))], [false, false]);
  check('with a notice offering Restore', (await a.text('.sync-notices') ?? '').includes('release-notes was deleted in Copilot CLI'), await a.text('.bands'));
  check('and the table keeps a trace with Restore', await a.exists('[data-ghost="release-notes"] button'));
  await a.click('#nav-history');
  check('History lists it', (await a.text('#history-scroll') ?? '').includes('release-notes'), await a.text('#history-scroll'));
  await a.shot('practice-history');
  await a.run(`document.querySelector('.history-row[data-kind="deleted"] button').click()`);
  await a.settle();
  same('Restore brings it back to every tool', [existsSync(join(practice, '.claude/skills/release-notes/SKILL.md')), existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), existsSync(join(practice, '.codex/skills/release-notes/SKILL.md'))], [true, true, true]);

  // The practice copy has no Pi folder, only a skill in the shared .agents folder that Pi (and others) read: that makes no
  // tool present, so Pi is no column, box or menu, and Tools shows no card for it.
  mkdirSync(join(practice, '.agents/skills/shared-only'), { recursive: true });
  writeFileSync(join(practice, '.agents/skills/shared-only/SKILL.md'), text('shared-only'));
  await a.click('#nav-skills');
  await a.click('#header-refresh');
  check('a tool not in this home has no column or box', !(await a.exists('[data-tool="pi-cli"], #tool-pi-cli')));
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
  // Sync off: edits are noted, not spread; the page shows them pending; Sync now spreads once; Apply all still works.
  await a.click('#sync-switch');
  same('Sync turns off', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'false');
  writeFileSync(standupPath('claude'), standupBefore.replace(/\n*$/, '\nEdited with Sync off.\n'));
  let shownPending = false;
  for (let tries = 0; tries < 40 && !shownPending; tries++) { await wait(250); shownPending = (await cellState(a, 'standup', 'claude-cli')) === 'edited'; }
  check('with Sync off the page shows the edit as pending on its own, without Read again', shownPending);
  await a.click('#header-refresh');
  check('with Sync off nothing spreads', !readFileSync(standupPath('copilot'), 'utf8').includes('Sync off'));
  same('the edit shows as waiting to spread, not as a choice', [await cellState(a, 'standup', 'claude-cli'), await cellState(a, 'standup', 'copilot-cli'), await a.exists('#decide-standup')], ['edited', 'waiting', false]);
  check('and a banner says automatic sync is off', (await a.text('.bands') ?? '').includes('Automatic sync is off'));
  check('Apply all does not claim it', !(await a.exists('#apply')), await a.text('.toolbar-end'));
  await a.shot('practice-sync-off');
  await a.click('#sync-now');
  check('Sync now spreads it once', readFileSync(standupPath('copilot'), 'utf8').includes('Sync off'));
  await a.click('#sync-switch');
  same('Sync turns back on', await a.run(`document.querySelector('#sync-switch').getAttribute('aria-checked')`), 'true');
  // A pending change on the page never brings back a skill the background just deleted.
  await a.click('#cell-standup-codex-cli');
  check('a change is pending', await a.exists('#discard'));
  rmSync(join(practice, '.claude/skills/standup'), { recursive: true });
  let spread = false;
  for (let tries = 0; tries < 60 && !spread; tries++) { await wait(250); spread = !existsSync(join(practice, '.copilot/skills/standup')); }
  check('the deletion spreads in the background', spread);
  await wait(1000);
  same('and the pending change is gone, so Apply all cannot revive it', [await a.exists('#apply'), existsSync(join(practice, '.claude/skills/standup'))], [false, false]);
  await a.click('#nav-history');
  await a.run(`document.querySelector('.history-row[data-kind="deleted"] button').click()`);
  await a.settle();
  check('Restore brings standup back', existsSync(join(practice, '.claude/skills/standup/SKILL.md')) && existsSync(join(practice, '.copilot/skills/standup/SKILL.md')));
  await a.click('#nav-skills');
  await a.click('#nav-skills');
  same('differing copies untouched', [readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8')], [reviewClaude, reviewCopilot]);
  same('now synced', [await cellState(a, 'release-notes', 'copilot-cli'), await cellState(a, 'standup', 'claude-cli'), await cellState(a, 'notes', 'claude-cli')], ['synced', 'synced', 'synced']);
  same('managed after Apply all', await switchOn(a, 'release-notes'), true);
  await a.shot('practice-applied');

  // Details open under a row.
  await a.click('#open-release-notes');
  check('details say every tool has the same copy', (await a.text('.details')).includes('same copy in all 3 tools'), await a.text('.details'));
  await a.click('#open-release-notes');

  // Choose which copy to use.
  await a.click('#decide-review');
  check('the choice opens', await a.exists('#use-review-copilot-cli'));
  await a.shot('practice-compare');
  await a.click('#use-review-copilot-cli');
  check('the choice waits for Apply all', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') === reviewClaude);
  same('the choice previews as a pending sync', [await cellState(a, 'review', 'claude-cli'), await cellState(a, 'review', 'copilot-cli')], ['synced', 'synced']);
  check('the pill gives way to the choice', !(await a.exists('#decide-review')) && (await a.exists('#undo-review')));
  // With four tools beside an open sidebar the name column is narrowest: the chosen copy still fits, Change included.
  mkdirSync(join(practice, '.pi/agent'), { recursive: true });
  await a.click('#header-refresh');
  check('a Pi folder makes Pi a fourth column', await a.exists('#tool-pi-cli') && await a.exists('#undo-review'));
  await fitsAtMinimum(a, 'a chosen copy waiting, with four tools');
  // Keeping separate copies is a choice waiting too; its short form keeps Change in the narrowest table.
  await a.click('#undo-review');
  await a.click('#separate-review');
  check('keeping separate waits for Apply all', ((await a.text('.ov-row[data-key="review"] .decided')) ?? '').includes('Keeping separate'));
  await fitsAtMinimum(a, 'keeping separate copies waiting, with four tools');
  await a.click('#undo-review');
  await a.click('#use-review-copilot-cli');
  rmSync(join(practice, '.pi'), { recursive: true, force: true });
  await a.click('#header-refresh');
  const nameFits = await a.run(`(() => { const cell = document.querySelector('.ov-row[data-key="review"] .ov-name'); return cell.scrollWidth <= cell.clientWidth + 1 && cell.getBoundingClientRect().height < 44; })()`);
  check('the name cell does not overflow or wrap', nameFits);
  await a.shot('practice-choice-made');
  await applyAll(a);
  same('the chosen copy is used in both tools', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), reviewCopilot);
  check('the replaced copy is kept in the store', readdirSync(join(practice, '.central-knot/items/review')).some(revision => readFileSync(join(practice, '.central-knot/items/review', revision, 'SKILL.md'), 'utf8') === reviewClaude));
  check('no longer flagged', !(await a.exists('#decide-review')));
  // The choice has its own Undo right there: Claude Code's copy back in Claude Code only, the skill unmanaged and differing again.
  // Seconds later, after any background pass, the result and its Undo are still there.
  await wait(3500);
  check('a copy choice offers an inline Undo', await a.exists('#outcome-undo-choice'), await a.text('.bands'));
  await a.click('#outcome-undo-choice');
  for (let tries = 0; tries < 30 && readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') !== reviewClaude; tries++) await wait(100);
  check('Undo puts the replaced copy back in its own tool only', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8') === reviewClaude && readFileSync(join(practice, '.copilot/skills/review/SKILL.md'), 'utf8') === reviewCopilot);
  check('and review is flagged again', await a.exists('#decide-review'));
  // Choosing again from the Files view ("Read both copies"): the result and its Undo show there too.
  await a.click('#decide-review');
  await a.click('#diff-review');
  await a.click('#use-review-copilot-cli');
  await applyAll(a);
  same('choosing again works', readFileSync(join(practice, '.claude/skills/review/SKILL.md'), 'utf8'), reviewCopilot);
  check('a choice applied from the Files view shows its result and Undo', await a.exists('#outcome-undo-choice'), await a.text('.detail-column'));
  if (await a.exists('#skills-table')) await a.click('#skills-table');

  // Stop all for Copilot: copies stay, syncing stops.
  await a.click('#tool-copilot-cli');
  check('the tool menu opens', await a.exists('#menu-stop-copilot-cli'));
  await a.shot('practice-tool-menu');
  await a.click('#menu-stop-copilot-cli');
  await applyAll(a);
  same('Stop all keeps the copies', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), true);
  rmSync(join(practice, '.copilot/skills/release-notes'), { recursive: true });
  await a.click('#header-refresh');
  same('and stops bringing them back', existsSync(join(practice, '.copilot/skills/release-notes')), false);
  check('and a deletion in a tool that no longer syncs stays there', existsSync(join(practice, '.claude/skills/release-notes/SKILL.md')));

  // Add all from Claude Code to Copilot turns it back on.
  await a.click('#tool-claude-cli');
  await a.click('#menu-add-claude-cli-copilot-cli');
  await applyAll(a);
  same('Add all copies again', existsSync(join(practice, '.copilot/skills/release-notes/SKILL.md')), true);

  // Unmanage keeps copies.
  await a.click(`.ov-row[data-key="standup"] .switch`);
  await applyAll(a);
  same('unmanaged', await switchOn(a, 'standup'), false);
  same('unmanaging keeps both copies', [existsSync(join(practice, '.claude/skills/standup')), existsSync(join(practice, '.copilot/skills/standup'))], [true, true]);

  // Keep both, then turning it on: the switch and Apply all agree. An unmanaged skill's local edit is a difference to decide;
  // a managed one's would simply spread.
  await a.click(`.ov-row[data-key="notes"] .switch`);
  await applyAll(a);
  writeFileSync(join(practice, '.claude/skills/notes/SKILL.md'), readFileSync(join(practice, '.claude/skills/notes/SKILL.md'), 'utf8') + '\nLocal edit.\n');
  await a.click('#header-refresh');
  await a.click('#decide-notes');
  await a.click('#separate-notes');
  same('keep both leaves it off', await switchOn(a, 'notes'), false);
  await a.click('#switch-notes');
  check('turning it on drops keep both', !(await a.text('.ov-row[data-key="notes"]')).includes('Keeping separate'), await a.text('.ov-row[data-key="notes"]'));
  same('and turning it on is a pending change', await a.exists('#discard'), true);
  await a.click('#discard');
  // Choosing a copy, then switching it off: the choice goes too.
  await a.click('#decide-notes');
  await a.click('#use-notes-claude-cli');
  await a.click('#switch-notes');
  check('switching off drops the chosen copy', !(await a.text('.ov-row[data-key="notes"]')).includes('Using'), await a.text('.ov-row[data-key="notes"]'));
  if (await a.exists('#discard')) await a.click('#discard');

  // Focus stays on the control after a re-render.
  await a.run(`document.querySelector('#switch-release-notes').focus()`);
  await a.press(' ', 'Space');
  same('focus stays on the switch', await a.run(`document.activeElement?.id`), 'switch-release-notes');
  if (await a.exists('#discard')) await a.click('#discard');

  // Skills Files view: every skill in a list, and one skill's files and contents with the same choices and Apply all as the table.
  await a.click('#nav-skills');
  await a.click('#open-standup');
  await a.click('#files-standup');
  same('the Skills list has every skill', await a.run(`[...document.querySelectorAll('.list-row')].map(row => row.id)`), ['list-notes', 'list-release-notes', 'list-review', 'list-standup']);
  await a.click('#list-standup');
  check('the details show the skill', (await a.text('.pane-title')).includes('standup') && (await a.exists('#detail-scroll .details-paths')), await a.text('.pane-title'));
  check('its folders and contents are shown', (await a.text('#detail-scroll .details-paths')).includes('/.copilot/skills/standup') && (await a.text('#detail-scroll pre.content')).includes('name:'), await a.text('#detail-scroll'));
  // Stacked (this window), the file comes before where each copy is, and nothing to delete sits above the file (an unmanaged
  // skill's Delete everywhere comes last).
  same('stacked, the file comes first, then where each copy is', await a.run(`(() => { const order = [...document.querySelectorAll('#detail-scroll pre.content, #detail-scroll .details-paths, #detail-scroll [id^="delete-"]')].map(e => e.matches('pre') ? 'file' : e.matches('.details-paths') ? 'where' : 'delete'); return order.filter((entry, index) => order.indexOf(entry) === index); })()`), ['file', 'where', 'delete']);
  // A wide pane (here at 1728) puts the details in a column at the right: where each copy is open from the start, the
  // file's box spanning to meet it.
  await sizeTo(a, 1728, 1117);
  for (let tries = 0; tries < 20 && !(await a.exists('#detail-scroll .files-tail .details-paths[open]')); tries++) await wait(50);
  const filesWide = await a.run(`(() => { const pane = document.querySelector('#detail-scroll').getBoundingClientRect(), file = document.querySelector('#detail-scroll pre.content').getBoundingClientRect(), details = document.querySelector('#detail-scroll .files-tail').getBoundingClientRect(); return { open: !!document.querySelector('#detail-scroll .files-tail .details-paths[open]'), beside: details.left > file.right, gap: Math.round(details.left - file.right), edge: Math.round(pane.right - details.right) }; })()`);
  check('at 1728 the details sit beside the file, open, with the file spanning to them', filesWide.open && filesWide.beside && filesWide.gap <= 40 && filesWide.edge <= 40, JSON.stringify(filesWide));
  await fullSize(a);
  const standupManaged = await a.run(`document.querySelector('#detail-switch-standup').getAttribute('aria-checked') === 'true'`);
  await a.click('#detail-switch-standup');
  check('a change here waits for Apply all', (await a.exists('#discard')) && (await a.exists('#list-standup.list-changed')));
  await fitsAtMinimum(a, 'the Files view with a change waiting');
  await a.shot('practice-skills');
  await a.press('Escape');
  check('Escape leaves the Files view for the table', !(await a.exists('.split')) && await a.exists('.ov-row[data-key="standup"]'));
  // A later skill chosen in the side-by-side Files view stays in view when the window narrows into the stacked list.
  for (let n = 1; n <= 6; n++) { mkdirSync(join(practice, `.claude/skills/zz-${n}`), { recursive: true }); writeFileSync(join(practice, `.claude/skills/zz-${n}/SKILL.md`), text(`zz-${n}`)); }
  await a.click('#header-refresh');
  if (!(await a.exists('#files-standup'))) await a.click('#open-standup');
  await a.click('#files-standup');
  await a.click('#list-zz-6');
  await sizeTo(a, 860, 560);
  check('the chosen row stays in view in the stacked list', await a.run(`(() => { const list = document.querySelector('#skills-list'), row = document.querySelector('#list-zz-6'), head = list.querySelector('.list-head'); const area = list.getBoundingClientRect(), box = row.getBoundingClientRect(); return box.top >= area.top + head.offsetHeight - 1 && box.bottom <= area.top + list.clientHeight + 1; })()`));
  await fullSize(a);
  await a.press('Escape');
  // A scrolled table keeps its place when the window crosses the dock's breakpoint (a redraw), both ways.
  const tableTop = () => a.run(`document.querySelector('#table-skills')?.scrollTop ?? -1`);
  await sizeTo(a, 1280, 560);
  // Partway down, so the same position exists however tall the table's area is at either width.
  await a.run(`(() => { const table = document.querySelector('#table-skills'); table.scrollTop = Math.min(100, table.scrollHeight - table.clientHeight); })()`);
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
  await a.click('#dock-close');
  await fullSize(a);
  same('the table shows the same pending change', await switchOn(a, 'standup'), !standupManaged);
  await a.click('#discard');
  same('discarding there clears it everywhere', await switchOn(a, 'standup'), standupManaged);
  // Undoing a copy choice puts Managed back as it was before the choice.
  const notesManaged = await switchOn(a, 'notes');
  // On a row whose copies differ, the Managed switch opens the copy choice first and stays off until a copy is picked.
  await a.click('#switch-notes');
  if (await a.exists('#use-notes-claude-cli') || await a.exists('#decide-notes')) {
    check('the switch on a differing row opens the choice instead of turning on', await a.exists('#use-notes-claude-cli') && await switchOn(a, 'notes') === notesManaged);
    await a.click('#use-notes-claude-cli');
    same('choosing a copy turns Managed on', await switchOn(a, 'notes'), true);
    await a.click('#undo-notes');
    same('undoing the choice puts Managed back', await switchOn(a, 'notes'), notesManaged);
  } else check('notes offers a copy choice here', false, await a.text('.ov-row[data-key="notes"]'));
  if (await a.exists('#discard')) await a.click('#discard');
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
  // MCP: each tool's servers on one page; Apply all writes Copilot and Codex by editing only that entry; Claude Code waits for Write now.
  await a.click('#nav-mcp');
  same('MCP servers from every tool', (await rowKeys(a)).sort(), ['docs', 'files']);
  same('files is the same in Copilot and Codex, absent in Claude', [await cellState(a, 'files', 'copilot-cli'), await cellState(a, 'files', 'codex-cli'), await cellState(a, 'files', 'claude-cli')], ['present', 'present', 'absent']);
  const tomlBefore = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  await a.click('#manage-all');
  await applyAll(a);
  const copilotMcp = JSON.parse(readFileSync(join(practice, '.copilot/mcp-config.json'), 'utf8')).mcpServers;
  same('docs reached Copilot with its header as-is', copilotMcp.docs, { type: 'http', url: 'https://docs.example.test/mcp', headers: { Authorization: 'Bearer practice-token' }, tools: ['*'] });
  const tomlAfter = readFileSync(join(practice, '.codex/config.toml'), 'utf8');
  check('docs reached Codex, and config.toml kept its comment and the files table byte for byte', tomlAfter.startsWith(tomlBefore) && tomlAfter.includes('[mcp_servers.docs]') && tomlAfter.includes('url = "https://docs.example.test/mcp"'), tomlAfter);
  const claudeBefore = readFileSync(join(practice, '.claude.json'), 'utf8');
  check('Claude Code waits for Write now', (await a.text('.bands') ?? '').includes('Claude Code doesn’t have the files server yet') && !JSON.parse(claudeBefore).mcpServers.files, await a.text('.bands'));
  await a.shot('practice-mcp');
  await a.click('#mcp-write-claude');
  const claudeAfter = JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8'));
  same('Write now adds files to Claude Code and keeps its other settings', [claudeAfter.mcpServers.files?.command, claudeAfter.theme, claudeAfter.numStartups], ['npx', 'dark', 3]);
  // Write has its own Undo: the entry comes out again (it was new), the rest of the file stays, and files waits for Write again.
  check('Write offers Undo', await a.exists('#outcome-undo-write'), await a.text('.bands'));
  await a.click('#outcome-undo-write');
  const claudeUndone = JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8'));
  same('Undo takes files back out of Claude Code and keeps its other settings', [claudeUndone.mcpServers?.files, claudeUndone.theme], [undefined, 'dark']);
  check('and files waits for Write again', await a.exists('#mcp-write-claude'));
  await a.click('#mcp-write-claude');
  check('Write works again after Undo', JSON.parse(readFileSync(join(practice, '.claude.json'), 'utf8')).mcpServers.files?.command === 'npx');
  // A server turned off in one tool, outside Central Knot (as `copilot mcp disable` writes it), is marked so, and its row has
  // that tool's switch to turn it on again: Apply all changes only Copilot's own switch, and Undo flips it back.
  const copilotMcpSwitch = join(practice, '.copilot/settings.json');
  const offBefore = `${JSON.stringify({ ...JSON.parse(readNow(copilotMcpSwitch) || '{}'), disabledMcpServers: ['docs'] }, null, 2)}\n`;
  writeFileSync(copilotMcpSwitch, offBefore);
  await a.click('#header-refresh');
  check('a server disabled in Copilot CLI is marked there', await a.exists('.ov-row[data-key="docs"] [data-tool="copilot-cli"] .cell-disabled'), await a.text('.ov-row[data-key="docs"]'));
  await a.click('#open-docs');
  await a.shot('practice-mcp-disabled');
  const docsSwitches = Object.fromEntries(await a.all('.details-mcp .tool-switch .switch', '[e.id, e.getAttribute("aria-checked")]'));
  same('its row offers each tool’s switch, off only for Copilot CLI', [docsSwitches['enable-docs-copilot-cli'], docsSwitches['enable-docs-claude-cli'], docsSwitches['enable-docs-codex-cli']], ['false', 'true', 'true']);
  await a.click('#enable-docs-copilot-cli');
  check('Enable waits for Apply all', readFileSync(copilotMcpSwitch, 'utf8') === offBefore && (await a.text('.apply-count') ?? '').includes('1 copy to enable'), await a.text('.apply-count'));
  await applyAll(a);
  same('Apply all turns it on in Copilot CLI and keeps the rest of its settings', [JSON.parse(readFileSync(copilotMcpSwitch, 'utf8')).disabledMcpServers, await a.exists('.ov-row[data-key="docs"] .cell-disabled')], [undefined, false]);
  check('the result says so, with Undo', /docs enabled in Copilot CLI/.test(await a.text('.band-outcome, .bands') ?? ''), await a.text('.bands'));
  await a.shot('practice-mcp-enabled');
  await a.click('#outcome-undo-switch');
  same('Undo turns it off again, byte for byte', readFileSync(copilotMcpSwitch, 'utf8'), offBefore);
  if (!(await a.exists('#enable-docs-copilot-cli'))) await a.click('#open-docs');
  await a.click('#enable-docs-copilot-cli');
  await applyAll(a);
  check('and it can be enabled once more', !readFileSync(copilotMcpSwitch, 'utf8').includes('disabledMcpServers'), readFileSync(copilotMcpSwitch, 'utf8'));
  if (await a.exists('#enable-docs-copilot-cli')) await a.click('#open-docs');
  // An MCP edit spreads within seconds: settings files are watched, not left to the 20 s poll.
  const copilotFile = join(practice, '.copilot/mcp-config.json');
  writeFileSync(copilotFile, readFileSync(copilotFile, 'utf8').replace('"command": "npx"', '"command": "npx-edited"'));
  let mcpSpread = false;
  for (let tries = 0; tries < 24 && !mcpSpread; tries++) { await wait(250); mcpSpread = readNow(join(practice, '.codex/config.toml')).includes('command = "npx-edited"'); }
  check('an MCP edit in Copilot reaches Codex within 6 s', mcpSpread);
  for (let tries = 0; tries < 20 && !(await a.exists('.sync-notice[data-kind="edit"]')); tries++) await wait(250);
  await fitsAtMinimum(a, 'MCP servers with the edit’s notice and its actions');

  // Agents: each tool's agents on one page. A plain agent is two-way; one with Claude-only fields reaches the others With limits.
  await a.click('#nav-agents');
  same('agents from every tool', (await rowKeys(a)).sort(), ['code-reviewer', 'release-notes']);
  await a.click('#manage-all');
  await applyAll(a);
  const copilotAgent = readFileSync(join(practice, '.copilot/agents/code-reviewer.agent.md'), 'utf8');
  check('code-reviewer reached Copilot with name, description and prompt, without Claude-only fields', copilotAgent.includes('description: Reviews a change') && copilotAgent.includes('You are a careful code reviewer.') && !copilotAgent.includes('tools:') && !copilotAgent.includes('model:'), copilotAgent);
  check('release-notes reached Claude Code from Codex', readFileSync(join(practice, '.claude/agents/release-notes.md'), 'utf8').includes('Group them as Added, Changed and Fixed.'));
  check('code-reviewer reached Codex as TOML', readFileSync(join(practice, '.codex/agents/code-reviewer.toml'), 'utf8').includes('developer_instructions = """'));
  await a.click('#open-code-reviewer');
  check('the details name the limits', /can’t hold its tools \(.*model \(.*edits only flow out/.test(await a.text('.details') ?? ''), await a.text('.details'));
  await a.shot('practice-agents');
  // One-way edge: an edit in a receiving tool stays there and stops updating; its amber box queues the source's copy again.
  const codexAgent = join(practice, '.codex/agents/code-reviewer.toml');
  const codexAgentBefore = readFileSync(codexAgent, 'utf8');
  writeFileSync(codexAgent, codexAgentBefore.replace('description = "', 'description = "Edited in Codex. '));
  await a.click('#header-refresh');
  check('the edited one-way copy stays and shows amber', readFileSync(codexAgent, 'utf8').includes('Edited in Codex.') && await a.exists('#cell-code-reviewer-codex-cli[data-state="stopped"]'));
  check('Claude Code’s copy was not touched', !readFileSync(join(practice, '.claude/agents/code-reviewer.md'), 'utf8').includes('Edited in Codex.'));
  // Keep my edit settles it: the box turns quiet and the warning count goes away; the box can still bring the source back.
  check('the stopped copy has its own notice with both choices', await a.exists('#stopped-keep-code-reviewer-codex-cli') && await a.exists('#stopped-use-code-reviewer-codex-cli'));
  check('while its notice shows, the toolbar says it without a link', (await a.text('.toolbar') ?? '').includes('1 copy stopped updating') && !(await a.exists('#go-stopped')), await a.text('.toolbar'));
  check('the status line no longer lists the stopped copy as receiving', /one-way to Copilot CLI · Codex’s copy stopped updating/.test(await a.text('.details-status') ?? ''), await a.text('.details-status'));
  await a.click('#stopped-dismiss-code-reviewer-codex-cli');
  check('deciding later keeps both choices in the Codex row', await a.exists('#stopped-keep-code-reviewer-codex-cli-details') && await a.exists('#stopped-use-code-reviewer-codex-cli-details') && await a.exists('#go-stopped'));
  await a.click('#stopped-keep-code-reviewer-codex-cli-details');
  check('keeping the edit is said with an Undo, and the toolbar counts it', /Codex keeps its own edit of code-reviewer/.test(await a.text('main') ?? '') && await a.exists('#outcome-undo-keep') && /Synced · 1 kept edit/.test(await a.text('.toolbar') ?? ''), await a.text('.toolbar'));
  check('Keep my edit clears the warning and leaves the edit', await a.exists('#cell-code-reviewer-codex-cli[data-state="kept"]') && !(await a.text('.toolbar') ?? '').includes('stopped updating') && readFileSync(codexAgent, 'utf8').includes('Edited in Codex.'));
  await a.click('#cell-code-reviewer-codex-cli');
  await applyAll(a);
  check('the result says Codex resumed, not that an agent was newly managed', /Codex has Claude Code’s copy of code-reviewer again/.test(await a.text('main') ?? ''), (await a.text('main') ?? '').slice(0, 300));
  check('its amber box puts Claude Code’s copy back in Codex', !readFileSync(codexAgent, 'utf8').includes('Edited in Codex.') && !(await a.exists('#cell-code-reviewer-codex-cli[data-state="stopped"]')), readFileSync(codexAgent, 'utf8'));
  check('the resume result offers to restore Codex’s edit', await a.exists('#outcome-restore-edit'));
  await a.click('#outcome-restore-edit');
  check('Restore Codex’s edit puts the edit back, and the copy stops again', readFileSync(codexAgent, 'utf8').includes('Edited in Codex.') && await a.exists('#cell-code-reviewer-codex-cli[data-state="stopped"]'), JSON.stringify(await a.all('[id^=cell-code-reviewer]', 'e.id + "=" + e.dataset.state')) + ' ' + (await a.text('main'))?.slice(0, 400));
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
  await a.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 1, mobile: false });
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
    // Two tool changes told back to back, on Skills (whose columns are the home's tools): the first read sees Codex gone,
    // and the second change (Codex back) arrives while that read is still on its way. It is owed, and read as soon as the
    // first ends, so the page ends right.
    await a.click('#nav-skills');
    const heads = () => a.all('.tool-head-button', 'e.id');
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
    await a.run(`(document.querySelector('.ov-row[data-key] .cell-button:not([disabled])').click(), true)`);
    await a.click('#discard');
    await main.tellPage('sync:changed');
    await wait(1500);
    same('a sync:changed right after an action keeps its message', await a.run(`document.querySelector('#announcement').dataset.text`), 'Changes discarded. Nothing was written.');
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
  await a.click('#nav-plugins');
  await a.click('#plugins-undo');
  check('Undo takes the parts out of Pi', !existsSync(join(practice, '.pi/agent/skills/triage')) && !readFileSync(piMcp, 'utf8').includes('issues'), readFileSync(piMcp, 'utf8'));
  // A part left out because its name was taken goes in with Update parts once the name is free.
  mkdirSync(join(practice, '.pi/agent/skills/triage'), { recursive: true });
  writeFileSync(join(practice, '.pi/agent/skills/triage/SKILL.md'), '---\nname: triage\ndescription: Mine.\n---\nMine.\n');
  await a.click('#header-refresh');
  for (let tries = 0; tries < 40 && !/Not the skill triage/.test(await a.text('.plugin-parts-section') ?? ''); tries++) await wait(100);
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
  same('an installed plugin’s skills each get a switch in the tool that has it, on', await a.all('.plugin-skills .switch', 'e.id + "=" + e.getAttribute("aria-checked")'), ['pskill-0-document-tools-pdf-reader-codex-cli=true', 'pskill-0-document-tools-spreadsheet-codex-cli=true']);
  await a.click('#pskill-0-document-tools-pdf-reader-codex-cli');
  check('turning one off only chooses it', /1 skill to turn off/.test(await a.text('.toolbar') ?? '') && readFileSync(codexConfig, 'utf8') === configBefore, await a.text('.toolbar'));
  await a.click('#plugins-apply');
  check('Apply all turns it off with Codex’s own switch, by name', readFileSync(codexConfig, 'utf8') === `${configBefore}\n[[skills.config]]\nname = "document-tools:pdf-reader"\nenabled = false\n`, readFileSync(codexConfig, 'utf8'));
  check('and the page shows it off', await a.run(`document.querySelector('#pskill-0-document-tools-pdf-reader-codex-cli').getAttribute('aria-checked')`) === 'false' && /Installed (· [^·]+ )?· 1 skill off/.test(await a.text('.plugin-panel')) && /pdf-reader turned off in Codex/.test(await a.text('.toolbar') ?? ''), await a.text('.plugin-page'));
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
      [[true, 'Updating History…', false, false, 90, true], 30, ['aged-20', 'aged-5'], ['none', 'done'], true, false, 'What sync, Apply all, Pull and profile switches changed in your tools, newest first. Undo puts the earlier version back; Restore puts a removed copy back. Kept for 30 days. Change in Settings.']);
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
    [7, ['aged-5'], true, false, true, false, 'What sync, Apply all, Pull and profile switches changed in your tools, newest first. Undo puts the earlier version back; Restore puts a removed copy back. Kept for 7 days. Change in Settings.', true]);
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
  await a.run(`setTimeout(() => window.close(), 50), true`);
  await wait(800);
  same('with the window gone the app keeps running', a.child.exitCode, null);
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

  same('the first home deletes the base and pushes', [await setBase(first, ''), await push(first)], ['saved', 'pushed']);
  const deleting = await rowSays(second, 'Removed in the repo');
  check('before Pull, the page says the base is deleted in the repo and what Pull does', deleting.includes('Removed in the repo') && deleting.includes('Pull empties the base instructions'), deleting);
  await pull(second, '');
  same('Pull empties the base and takes it out of Claude Code, which keeps its own text', [baseText('second'), claudeText('second').includes('Be briefer.'), claudeText('second').includes('My own notes.')], ['', false, true]);
  await second.click('#nav-history');
  const event = await api(second, `return (await api.history()).events.find(event => event.key === 'instructions:base')?.id ?? null;`);
  await until(async () => second.exists(`#history-${event}`));
  check('History has the deletion, with an Undo', event && /Pull emptied the base instructions/.test(await second.text('.history-list') ?? ''), await second.text('.history-list'));
  await second.click(`#history-${event}`);
  same('Undo puts the base back, and Claude Code gets it again', [baseText('second'), claudeText('second').includes('Be briefer.'), await api(second, `return (await api.instructionBase()).tools;`)], ['Be briefer.\n', true, ['claude-cli']]);
  check('and the row reads as undone', await until(async () => (await second.text('.history-row.history-undone') ?? '').includes('Base instructions')), await second.text('.history-list'));
  await second.quit();
  await first.quit();
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
  same('a home with no tools shows only the pages that hold no kind', await pages(), ['overview', 'harnesses', 'history', 'repo', 'settings']);
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
  mkdirSync(join(home, '.pi/agent/skills/notes'), { recursive: true });
  writeFileSync(join(home, '.pi/agent/skills/notes/SKILL.md'), text('notes'));
  await a.click('#header-refresh');
  same('with Pi alone, Agents and Plugins are left out', await pages(), ['overview', 'harnesses', 'skills', 'mcp', 'instructions', 'profiles', 'history', 'repo', 'settings']);
  check('and the Overview names them once', (await a.text('#overview-absent') ?? '').includes('No tool here holds agents or plugins') && !(await a.exists('#overview-agents')), await a.text('#overview-absent'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  await a.click('#header-refresh');
  same('a tool that holds agents and plugins brings them back', await pages(), ['overview', 'harnesses', 'skills', 'mcp', 'agents', 'instructions', 'plugins', 'profiles', 'history', 'repo', 'settings']);
  // On Agents, its only tool goes away: the page it was on no longer exists here, so the Overview opens.
  await a.click('#nav-agents');
  rmSync(join(home, '.claude'), { recursive: true, force: true });
  await a.click('#header-refresh');
  same('when the open page’s kind leaves the home, the Overview opens', [await a.text('.page-title'), await pages()], ['Overview', ['overview', 'harnesses', 'skills', 'mcp', 'instructions', 'profiles', 'history', 'repo', 'settings']]);
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
  for (const [width, height] of [[860, 560], [1728, 1117]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(300);
    await a.shot(`app-only-plugin-${width}`);
    check(`at ${width}×${height} the app-only plugin box’s route line is not cut off`, await a.run(`(() => { const line = document.querySelector('.plugin-tool-via'); const box = line.getBoundingClientRect(); return box.width > 0 && line.scrollWidth <= line.clientWidth + 1 && box.right <= innerWidth; })()`));
  }
  await a.send('Emulation.clearDeviceMetricsOverride');
  check('with only Claude desktop, the plugin box names its route, its Code tab, and offers no parts instead', box.includes('Claude CodePlugin not installedThrough Claude desktop’s Code tab 2.1.317') && !box.includes('Only Claude desktop'), box);
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
  await a.click('#harness-codex-cli');
  await a.click('#harness-tab-about');
  const codexAbout = await a.text('#harness-body');
  check('Codex says where new copies go', codexAbout.includes('/.codex/skills'), codexAbout.slice(0, 600));
  await a.click('#nav-skills');
  const rows = await rowKeys(a);
  for (const name of ['rich', '名前-skill', '.dot-skill', 'linked', 'from-copilot', 'has-link']) check(`row for ${name}`, rows.includes(name), rows);
  check('names keep their case', (await a.text('.ov-row[data-key="mixedcase"]')).includes('MixedCase'), await a.text('.ov-row[data-key="mixedcase"]'));
  check('malformed skill is no row', !rows.includes('bad-yaml'));
  same('the linked skill is already one copy', [await cellState(a, 'linked', 'claude-cli'), await cellState(a, 'linked', 'copilot-cli')], ['present', 'present']);
  same('refused names and dot folders cannot go to Copilot', [await cellState(a, '名前-skill', 'copilot-cli'), await cellState(a, '.dot-skill', 'copilot-cli'), await cellState(a, 'plain', 'copilot-cli')], ['cannot', 'cannot', 'cannot']);
  check('a skill with a link inside is held', await a.exists('.ov-row[data-key="has-link"] .held-pill'));
  // Changes waiting for Apply all fill the toolbar most: still nothing is cut off at the smallest window.
  await a.click('#manage-all');
  await fitsAtMinimum(a, 'Skills with changes waiting for Apply all');
  await sizeTo(a, 860, 560);
  check('the pending count stays at the smallest window, its full summary as its tooltip', await a.run(`(() => { const count = document.querySelector('.toolbar .apply-count'); return !!count && count.getBoundingClientRect().width > 0 && /\\d+ changes?/.test(count.title); })()`));
  await fullSize(a);
  await a.click('#discard');
  await a.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  await a.click(`[id="open-very-long-${'n'.repeat(150)}"]`);
  const fits = await a.run(`({ page: document.documentElement.scrollWidth, window: innerWidth })`);
  check('a very long name stays on screen at 960', fits.page <= fits.window, fits);
  await a.send('Emulation.clearDeviceMetricsOverride');
  await a.click(`[id="open-very-long-${'n'.repeat(150)}"]`);
  await a.shot('real-overview');
  if (!canWriteRealHome) {
    same('Apply all is off here', await a.run(`(() => { document.querySelector('#manage-all').click(); return document.querySelector('#apply').disabled; })()`), true);
    const refused = await a.run(`window.centralKnot.apply([{ key: 'rich', managed: true, off: [] }], false, document.querySelector('.status-home').title)`);
    same('main process refuses too', refused.harnessWrites, 0);
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
  const wrongHome = await a.run(`window.centralKnot.apply([{ key: 'rich', managed: true, off: [] }], false, '/somewhere/else')`);
  check('an apply for another home is refused', wrongHome.harnessWrites === 0 && /not the one open/.test(wrongHome.stopped ?? ''), wrongHome);
  await a.click('#manage-all');
  await a.click(`.ov-row[data-key="private-one"] .switch`);
  await applyAll(a);
  same('bytes and modes copied, .git left out', tree(join(COPILOT, 'rich')), before.rich);
  same('exec bit kept', statSync(join(COPILOT, 'rich/scripts/run.sh')).mode & 0o777, 0o755);
  same('Codex gets the same bytes in its own folder', tree(join(CODEX, 'rich')), before.rich);
  check('a dot folder never reaches Codex', !existsSync(join(CODEX, '.dot-skill')));
  same('nothing new in the shared .agents folder', readdirSync(AGENTS).sort(), ['linked']);
  check('Copilot-only skill reached Claude', existsSync(join(CLAUDE, 'from-copilot/SKILL.md')));
  check('the one switched back off was not copied', !existsSync(join(COPILOT, 'private-one')));
  check('refused name not copied', !existsSync(join(COPILOT, '名前-skill')));
  check('held skill not copied', !existsSync(join(COPILOT, 'has-link')));
  check('a skill with a read-only folder copied', existsSync(join(COPILOT, 'read-only-inside/refs/a.md')));
  check('an unreadable skill not copied', !existsSync(join(COPILOT, 'unreadable-file')));
  same('differing copies untouched', readFileSync(join(COPILOT, 'clash/SKILL.md'), 'utf8'), text('clash', 'Copilot version.'));
  same('link stays a link', lstatSync(join(CLAUDE, 'linked')).isSymbolicLink(), true);
  same('nothing staged in a loaded folder', [...readdirSync(COPILOT), ...readdirSync(CLAUDE)].filter(name => name.startsWith('.ck-')), []);
  same('unrelated bytes unchanged', readFileSync(join(HOME, '.claude/unrelated.json'), 'utf8'), before.unrelated);
  check('expected holds do not raise a warning band', !(await a.text('.bands') ?? '').includes('does not load'), await a.text('.bands'));
  same('a held skill shows it cannot go to the tool that lacks it', await cellState(a, 'has-link', 'copilot-cli'), 'cannot');
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
  await b.click(`.ov-row[data-key="private-one"] .switch`);
  same('damaged record keeps Apply all off', await b.run(`document.querySelector('#apply')?.disabled ?? true`), true);
  await b.quit();
  writeFileSync(record, good);
  b = await launch(join(scratch, 'other-data'));
  await b.click('#home-actual');
  await b.click('#nav-skills');
  await b.click(`.ov-row[data-key="private-one"] .switch`);
  same('lost settings ask to resume', (await b.text('#apply')).trim(), 'Resume and apply all');
  await applyAll(b);
  same('resuming keeps the record', JSON.parse(readFileSync(record, 'utf8')).generation, JSON.parse(good).generation);
  check('and applies', existsSync(join(COPILOT, 'private-one/SKILL.md')));
  same('no page errors, stops', b.pageErrors, []);
  await b.quit();
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
    // Until the choices are on record (a kill can land before Apply all saves them), choose again; after that, opening catches up.
    const record = join(HOME, '.central-knot/sync.json');
    const chosen = existsSync(record) && (() => { try { return Object.values(JSON.parse(readFileSync(record, 'utf8')).items).some(item => item.state === 'shared'); } catch { return false; } })();
    if (!chosen) {
      await a.click('#manage-all');
      await a.run(`document.querySelector('#apply').click()`);
    } else await a.run(`document.querySelector('#header-refresh').click()`);
    await wait(30 + Math.round(round * 700 / Math.max(1, crashRounds - 1)) + randomInt(40));
    await a.crash();
    if (readdirSync(COPILOT).length < 40) interrupted++;
    for (const name of readdirSync(COPILOT)) {
      check(`round ${round}: nothing half-written in a loaded folder (${name})`, !name.startsWith('.'), name);
      if (expected[name]) same(`round ${round}: ${name} is complete or absent`, tree(join(COPILOT, name)), expected[name]);
    }
    if (existsSync(record)) { try { JSON.parse(readFileSync(record, 'utf8')); passes++; } catch { check(`round ${round}: record stays valid`, false); } }
  }
  const onRecord = existsSync(join(HOME, '.central-knot/sync.json'));
  const a = await launch(join(scratch, 'crash-data'));
  await a.click('#home-actual');
  await a.click('#nav-skills');
  // If every kill landed before the choices were saved, there is nothing to catch up: finish with a real Apply all.
  if (!onRecord) { await a.click('#manage-all'); await applyAll(a); }
  console.log(`crash finish: ${onRecord ? 'caught up on open' : 'no choices were saved before the kills; applied again'}`);
  same('after crashes, opening again completes every copy', readdirSync(COPILOT).filter(name => name.startsWith('bulk-')).length, 40);
  for (const name of Object.keys(expected)) same(`final ${name} bytes`, tree(join(COPILOT, name)), expected[name]);
  same('stale stages are cleared', readdirSync(join(HOME, '.copilot')).filter(name => name.startsWith('.ck-')), []);
  same('no page errors, crashes', a.pageErrors, []);
  await a.quit();
  console.log(`crash rounds: ${crashRounds}, interrupted a copy in ${interrupted}`);
  check('at least one round really interrupted copying', interrupted > 0, interrupted);
}

const execChmod = () => spawnSync('chmod', ['-R', 'u+rwx', scratch]);

// ---------- Run ----------
const started = Date.now();
try {
  seedHome();
  await harnessFlow();
  await practiceFlow();
  await releasedStartupFlow();
  await fewToolsFlow();
  await repoBaseFlow();
  await realHomeFlow();
  if (canWriteRealHome && crashRounds > 0) await crashFlow();
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
