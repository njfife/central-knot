// Screenshots of the design preview for review rounds. Usage: node scripts/design-shots.mjs <outDir> [--electron] [--no-sandbox]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const out = resolve(process.argv[2] ?? 'design-shots');
const root = resolve(import.meta.dirname, '..');
const electron = process.argv.includes('--electron');
const command = electron ? join(root, 'node_modules/electron/dist', readFileSync(join(root, 'node_modules/electron/path.txt'), 'utf8').trim()) : join(root, 'release/Central Knot-darwin-arm64/Central Knot.app/Contents/MacOS/Central Knot');
const scratch = mkdtempSync(join(tmpdir(), 'ck-design-'));
mkdirSync(join(scratch, 'home')); mkdirSync(out, { recursive: true });
const env = { HOME: join(scratch, 'home'), PATH: '/usr/bin:/bin', TMPDIR: scratch };
for (const name of ['DISPLAY', 'XAUTHORITY']) if (process.env[name]) env[name] = process.env[name];
const port = 9600 + Math.floor(Math.random() * 300);
const large = process.argv.includes('--large');
const child = spawn(command, [...(electron ? [root] : []), large ? '--design-preview=large' : '--design-preview', `--remote-debugging-port=${port}`, `--user-data-dir=${join(scratch, 'data')}`, ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : [])], { env, stdio: 'ignore' });
let target;
for (let i = 0; i < 150 && !target; i++) { await wait(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
const settle = async () => { await wait(150); await run(`new Promise(d => { const c = () => document.body.dataset.ready === 'true' && document.body.dataset.busy !== 'true' ? d(true) : setTimeout(c, 30); c(); })`); await wait(250); };
const click = async selector => { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
const shot = async name => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 790 }); await wait(120); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
const theme = value => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
await settle();
await theme('dark'); await settle(); await shot('1-default-dark');
await theme('light'); await settle(); await shot('2-default-light');
await theme('dark');
const steps = JSON.parse(readFileSync(join(import.meta.dirname, 'design-steps.json'), 'utf8'));
for (const step of steps) {
  for (const action of step.actions) await click(action);
  for (const action of step.shiftActions ?? []) { await run(`document.querySelector(${JSON.stringify(action)}).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`); await settle(); }
  await shot(step.name);
  for (const action of step.reset ?? []) await click(action);
}
ws.close(); child.kill('SIGKILL'); rmSync(scratch, { recursive: true, force: true });
console.log(`shots in ${out}`);
