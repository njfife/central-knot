// The Plugins page's switch clicks waiting their turn (pluginstate.ts turnPlugin), on the page's own code with a stand-in for
// main: each test clicks, then answers main's calls one at a time and reads what the page holds in between.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessId, PluginTurn, PluginTurnResult, PluginsView } from '../src/types.ts';

/** Main, as the page sees it: each switch click waits until the test answers it; every other call is counted. */
const main = {
  sent: [] as string[], reads: { plugins: 0, home: 0 },
  answers: [] as ((result: PluginTurnResult) => void)[],
  syncChanged: () => {},
  /** Run as the view is read: a click made meanwhile, say. */
  duringRead: undefined as (() => void) | undefined,
  answer(result: PluginTurnResult = { done: [] }) { this.answers.shift()!(result); return settled(); },
};
const api = {
  turnPlugin: (_source: string, plugin: string, what: PluginTurn) => { main.sent.push(`${plugin} ${what}`); return new Promise<PluginTurnResult>(done => main.answers.push(done)); },
  plugins: async () => { main.reads.plugins++; main.duringRead?.(); return view; },
  refresh: async () => { main.reads.home++; return null; },
  onSyncChanged: (listener: () => void) => { main.syncChanged = listener; },
};
// The page's modules, loaded under node with no window: the little of the DOM they touch as they load and redraw.
const element = (): any => ({ dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, replaceChildren() {}, append() {}, appendChild() {} });
Object.assign(globalThis, {
  window: { centralKnot: new Proxy(api, { get: (known, name) => (known as Record<string | symbol, unknown>)[name] ?? (() => Promise.resolve(null)) }), addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  document: { body: element(), documentElement: element(), activeElement: null, getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: element, createTextNode: element },
  ResizeObserver: class { observe() {} disconnect() {} },
});
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Macintosh' } });
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first.
await import('../src/settingspage.ts');
const { acting, state: app } = await import('../src/app.ts');
const { clickOn, market, resetMarket, switchHeld, turnPlugin } = await import('../src/pluginstate.ts');

/** Lets the page's awaits run on to the next call to main. */
const settled = () => new Promise(done => setTimeout(done, 5));
const plugin = (name: string) => ({ name, description: '' });
const view = {
  home: '/home', tools: ['claude-cli'] as HarnessId[], clis: {}, canWrite: true, desktopOnly: {}, via: {}, versions: {}, suggested: [],
  marketplaces: [{ source: '/market', name: 'team', origins: ['central-knot'], sourceLabel: 'team', kind: 'folder', plugins: ['alpha', 'beta', 'gamma'].map(plugin), states: {}, switches: {} }],
} as unknown as PluginsView;
const entry = view.marketplaces[0]!;
const installed = (name: string): PluginTurnResult => ({ done: [{ source: '/market', marketName: 'team', plugin: name, tool: 'claude-cli', action: 'install', report: { tool: 'claude-cli', outcome: 'installed', changed: true, message: 'Installed.', runs: [] } }], before: null, back: [] });
const states = () => market.clicks.map(click => `${click.plugin} ${click.state}`);

function start() {
  resetMarket();
  Object.assign(main, { sent: [], reads: { plugins: 0, home: 0 }, answers: [], duringRead: undefined });
  app.home = { home: '/home' } as typeof app.home;
  market.read.data = view;
}

test('Clicks wait their turn: main gets one at a time, in the order clicked, and the view and the home are read once, at the end', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  turnPlugin(entry, 'beta', 'on');
  await settled();
  assert.deepEqual([states(), main.sent], [['alpha running', 'beta waiting'], ['alpha on']]);
  // Each clicked plugin's switch is held; another plugin's is not, and the page is acting (the other plugin actions are off).
  assert.deepEqual([switchHeld('/market', 'alpha'), switchHeld('/market', 'beta'), switchHeld('/market', 'gamma'), acting()], [true, true, false, true]);
  await main.answer(installed('alpha'));
  assert.deepEqual([states(), main.sent, main.reads], [['alpha ended', 'beta running'], ['alpha on', 'beta on'], { plugins: 0, home: 0 }]);
  // alpha's row says its result now, from what main returned, and its switch stays held until the list's read.
  assert.deepEqual([clickOn('/market', 'alpha')?.ran?.done[0]?.report.outcome, switchHeld('/market', 'alpha')], ['installed', true]);
  await main.answer(installed('beta'));
  assert.deepEqual([main.reads, market.clicking, acting(), switchHeld('/market', 'alpha')], [{ plugins: 1, home: 1 }, false, false, false]);
  // The one Undo is the last click that finished: beta's. Each row keeps its result until the next list starts.
  assert.deepEqual([market.lastRun?.turn?.plugin, states()], ['beta', ['alpha ended', 'beta ended']]);
  // The next click starts a new list, with nothing ahead of it: the last list's rows go.
  turnPlugin(entry, 'gamma', 'off');
  assert.deepEqual(states(), ['gamma running']);
  await settled();
  await main.answer();
});

test('A click that fails in the middle says why on its row, and the clicks after it still run', async () => {
  start();
  for (const name of ['alpha', 'beta', 'gamma']) turnPlugin(entry, name, 'on');
  await settled();
  await main.answer(installed('alpha'));
  await main.answer({ stopped: 'It is no longer listed here, so nothing was changed. Read the page again.', done: [] });
  assert.deepEqual([states(), market.problem], [['alpha ended', 'beta ended', 'gamma running'], 'It is no longer listed here, so nothing was changed. Read the page again.']);
  // The problem band says the last click's; beta's row keeps its own.
  await main.answer(installed('gamma'));
  assert.deepEqual([main.sent, clickOn('/market', 'beta')?.ran?.stopped, market.problem, main.reads], [['alpha on', 'beta on', 'gamma on'], 'It is no longer listed here, so nothing was changed. Read the page again.', undefined, { plugins: 1, home: 1 }]);
});

test('Another home opened while clicks wait: those not yet sent are dropped, and nothing of the list shows there', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  turnPlugin(entry, 'beta', 'on');
  await settled();
  // As app.ts accept does when another home opens.
  resetMarket();
  await main.answer(installed('alpha'));
  assert.deepEqual([main.sent, states(), market.clicking, market.lastRun, main.reads], [['alpha on'], [], false, undefined, { plugins: 0, home: 0 }]);
});

test('A pass that changes the home while the list runs is read once, by the list’s own read at its end', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  await settled();
  // The click wrote a tool's settings file: main's pass says the home changed.
  main.syncChanged();
  await settled();
  assert.equal(main.reads.home, 0);
  await main.answer(installed('alpha'));
  await settled();
  assert.deepEqual(main.reads, { plugins: 1, home: 1 });
});

test('A click made while the list is read at its end runs too, and the list is read again after it', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  await settled();
  main.duringRead = () => { main.duringRead = undefined; turnPlugin(entry, 'beta', 'on'); };
  await main.answer(installed('alpha'));
  assert.deepEqual([states(), main.sent, market.clicking], [['alpha ended', 'beta running'], ['alpha on', 'beta on'], true]);
  await main.answer(installed('beta'));
  assert.deepEqual([main.reads, market.clicking, switchHeld('/market', 'beta')], [{ plugins: 2, home: 2 }, false, false]);
});
