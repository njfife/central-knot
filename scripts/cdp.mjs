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
