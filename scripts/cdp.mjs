// One DevTools-protocol client for the scripts that drive the real app: its page (Chrome's protocol) and, in a dev run, its
// main process (Node's inspector, `--inspect=<port>`), where a test can see what only main has: the menus it builds, the dialogs
// it opens, and what the system tells it. Test-side only: nothing in the app opens for it.
import { setTimeout as wait } from 'node:timers/promises';

/**
 * Connects to a debugger WebSocket. `send` makes one protocol call; `run(expression)` evaluates it (awaiting a promise) and
 * returns its value, or throws what it threw. `onEvent` hears everything that isn't a reply.
 */
export async function connect(url, onEvent = () => {}) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  let id = 0;
  socket.onmessage = message => {
    const data = JSON.parse(message.data);
    if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } else onEvent(data);
  };
  const send = (method, params = {}) => new Promise(done => { const key = ++id; pending.set(key, done); socket.send(JSON.stringify({ id: key, method, params })); });
  const run = async expression => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
    return reply.result.result.value;
  };
  return { send, run, close: () => socket.close() };
}

/**
 * The debug ports an app opened, for an app started with `--remote-debugging-port=0` (and `--inspect=0` in a dev run, `inspect`)
 * and its stderr piped: `port` for its page, `inspect` for its main process. Asked for port 0, each app gets free ports of its
 * own from the system and says them on stderr. A run that picked a number itself could pick one another run's app was already
 * listening on (two tours, or a tour and the e2e, on one machine), and then drove that app instead of its own.
 */
export function debugPorts(child, inspect = false) {
  return new Promise((done, fail) => {
    let said = '';
    const stop = setTimeout(() => fail(new Error('The app did not open a debug port.')), 30000);
    child.once('exit', () => { clearTimeout(stop); fail(new Error('The app closed before it opened a debug port.')); });
    // Read on after the ports are known too, so the app never waits on a full pipe.
    child.stderr.on('data', chunk => {
      if (said.length > 100000) return;
      said += chunk;
      const page = /DevTools listening on ws:\/\/[^/]*:(\d+)\//.exec(said)?.[1];
      const main = /Debugger listening on ws:\/\/[^/]*:(\d+)\//.exec(said)?.[1];
      if (page && (main || !inspect)) { clearTimeout(stop); done({ port: Number(page), inspect: inspect ? Number(main) : undefined }); }
    });
  });
}

/** Connects to the main process inspecting on `port`; its `run(expression)` has `electron` in scope. */
export async function mainProcess(port) {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt++) {
    try { [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await wait(200); }
  }
  if (!target) throw new Error('The main process did not open an inspector port.');
  const main = await connect(target.webSocketDebuggerUrl);
  return { run: expression => main.run(`(async electron => (${expression}))(process.mainModule.require('electron'))`), close: main.close };
}

/**
 * Makes a Linux dev run's main process act as an installed copy on `platform` (darwin, win32 or linux), for the checks that need
 * one, such as start at sign-in. Only safe on Linux, where the login-item calls stood in are Linux's own: elsewhere a stood-in
 * installed app could reach the real system's. Everything lives in `ck` in main:
 * - `ck.login` is the system's login item: `on`, `enabled` (false: turned off in Windows' Startup apps), `status` (macOS's,
 *   when not the plain enabled/not-registered), `ignore` (the system ignores changes);
 * - `ck.asked`, `ck.menus`, `ck.dialogs`, `ck.opened` record what main asked for, built, showed and opened (the first-close
 *   dialog answers OK at once; nothing really opens);
 * - `ck.as(platform)` switches system, and `ck.restore()` puts back every stand-in, so the rest of a run is unaffected (the
 *   records stay readable).
 */
export const standIn = (main, platform) => main.run(`(() => {
  const { app, dialog, shell, Menu } = electron;
  const real = { platform: Object.getOwnPropertyDescriptor(process, 'platform'), packaged: Object.getOwnPropertyDescriptor(app, 'isPackaged'), getPath: app.getPath, get: app.getLoginItemSettings, set: app.setLoginItemSettings, build: Menu.buildFromTemplate, setMenu: Menu.setApplicationMenu, dialog: dialog.showMessageBox, open: shell.openExternal };
  const exes = { darwin: '/Applications/Central Knot.app/Contents/MacOS/Central Knot', win32: 'C:\\\\Program Files\\\\Central Knot\\\\Central Knot.exe', linux: '/opt/Central Knot/central-knot' };
  const ck = globalThis.ck = { login: { on: false, enabled: true }, asked: [], menus: [], dialogs: [], opened: [] };
  ck.as = platform => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    Object.defineProperty(app, 'isPackaged', { get: () => true, configurable: true });
    app.getPath = name => name === 'exe' ? exes[platform] : real.getPath.call(app, name);
  };
  app.getLoginItemSettings = () => {
    const { on, enabled, status } = ck.login;
    return process.platform === 'darwin' ? { openAtLogin: on, status: status ?? (on ? 'enabled' : 'not-registered') }
      : { openAtLogin: on, launchItems: on ? [{ path: exes[process.platform], args: ['--hidden'], enabled }] : [] };
  };
  app.setLoginItemSettings = ({ openAtLogin }) => { ck.asked.push(openAtLogin); if (!ck.login.ignore) ck.login.on = openAtLogin; };
  Menu.buildFromTemplate = template => (ck.menus.push(template), real.build.call(Menu, template));
  // The macOS app menu's roles (Hide, Services) aren't Linux's: it is built, and kept, but never set.
  Menu.setApplicationMenu = menu => process.platform === 'darwin' ? undefined : real.setMenu.call(Menu, menu);
  dialog.showMessageBox = options => (ck.dialogs.push(options), Promise.resolve({ response: 0, checkboxChecked: true }));
  shell.openExternal = url => (ck.opened.push(url), Promise.resolve());
  ck.restore = () => {
    Object.assign(app, { getPath: real.getPath, getLoginItemSettings: real.get, setLoginItemSettings: real.set });
    Object.assign(Menu, { buildFromTemplate: real.build, setApplicationMenu: real.setMenu });
    Object.assign(dialog, { showMessageBox: real.dialog });
    Object.assign(shell, { openExternal: real.open });
    Object.defineProperty(process, 'platform', real.platform);
    if (real.packaged) Object.defineProperty(app, 'isPackaged', real.packaged); else delete app.isPackaged;
  };
  ck.as(${JSON.stringify(platform)});
})()`);

/** Blurs and focuses the window, as coming back to it from the system's settings does: the page and menus read again. */
export const refocus = main => main.run(`(window => { window.blur(); window.focus(); })(electron.BrowserWindow.getAllWindows()[0])`);

/** One day in milliseconds, for History events made to look days old. */
export const DAY = 24 * 60 * 60 * 1000;

/** Chooses `days` in Settings' Keep history for select, as picking it from the system's own menu (which can't be driven) would. */
export async function keepFor(page, days) {
  await page.run(`(select => { select.value = '${days}'; select.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#history-days'))`);
  await page.settle();
}

/**
 * Holds main's queue, where sync passes and the page's requests take turns, as a long sync pass would, until `release()`. The
 * page asks to open a folder as its home; main's folder dialog for it answers only on release, cancelled, so nothing changes.
 */
export async function holdQueue(main, page) {
  await main.run(`(() => {
    const { dialog } = electron, real = dialog.showOpenDialog;
    globalThis.ckHeld = new Promise(held => { dialog.showOpenDialog = () => new Promise(answer => {
      globalThis.ckRelease = () => { dialog.showOpenDialog = real; answer({ canceled: true, filePaths: [] }); };
      held();
    }); });
  })()`);
  await page.run(`void window.centralKnot.selectHome('custom')`);
  await main.run('ckHeld');
  return { release: async () => { await main.run('ckRelease()'); await page.settle(); } };
}
