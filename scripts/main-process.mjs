// Reaches a dev run's main process through Node's inspector (`--inspect=<port>`), so a test can see what only main has: the
// menus it builds, the dialogs it opens, and what the system tells it. Test-side only: nothing in the app opens for it.
import { setTimeout as wait } from 'node:timers/promises';

/** Connects to the main process inspecting on `port`; `run(expression)` evaluates there (with `electron` in scope) and returns the value. */
export async function mainProcess(port) {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt++) {
    try { [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await wait(200); }
  }
  if (!target) throw new Error('The main process did not open an inspector port.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  let id = 0;
  socket.onmessage = message => { const data = JSON.parse(message.data); pending.get(data.id)?.(data); pending.delete(data.id); };
  const run = expression => new Promise((done, fail) => {
    const key = ++id;
    pending.set(key, reply => reply.result?.exceptionDetails ? fail(new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text)) : done(reply.result?.result.value));
    socket.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression: `(async electron => (${expression}))(process.mainModule.require('electron'))`, awaitPromise: true, returnByValue: true } }));
  });
  return { run, close: () => socket.close() };
}
