// The page's one list of clicks (clicklist.ts), on the page's own code with a stand-in for main: each test clicks, then answers
// main's calls one at a time and reads what the page holds in between. First the Plugins page's switch (pluginstate.ts
// turnPlugin), then an item page's row switches (app.ts queueClick) and when their result goes by itself (app.ts FADE_MS); then,
// on the same code, a background notice taken during a click or a home read, and when the rows a click pins are let go (app.ts pinnedRows, drawPage).
import { mock, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Change, HarnessId, HomeView, ItemNotice, PassResult, PluginTurn, PluginTurnResult, PluginsView } from '../src/types.ts';
import type { PageKind } from '../src/app.ts';

/** Main, as the page sees it: each switch click waits until the test answers it; every other call is counted. */
const main = {
  sent: [] as string[], reads: { plugins: 0, home: 0 },
  /** The History entries an Undo asked main to put back, in the order asked. */
  restored: [] as string[],
  answers: [] as ((result: PluginTurnResult) => void)[],
  /** An item page's clicks, each a pass main runs (applySkills), answered by the test with what it did (pass). */
  passes: [] as ((result: PassResult) => void)[],
  pass(result: PassResult) { this.passes.shift()!(result); return settled(); },
  syncChanged: () => {},
  /** Run as the home is read: a click made meanwhile, say. */
  duringHomeRead: undefined as (() => void) | undefined,
  answer(result: PluginTurnResult = { done: [] }) { this.answers.shift()!(result); return settled(); },
};
const api = {
  turnPlugin: (_source: string, plugin: string, what: PluginTurn) => { main.sent.push(`${plugin} ${what}`); return new Promise<PluginTurnResult>(done => main.answers.push(done)); },
  applySkills: (changes: Change[]) => { main.sent.push(changes.map(change => `${change.key} ${change.on ? 'on' : 'off'}, seen ${change.seenOn ? 'on' : 'off'}`).join()); return new Promise<PassResult>(done => main.passes.push(done)); },
  history: async () => ({ events: [{ id: 'delete-bar', key: 'bar', kind: 'deleted' }], days: 30 }),
  applyAgents: (changes: Change[]) => { main.sent.push(`agent ${changes.map(change => `${change.key} ${change.on ? 'on' : 'off'}`).join()}`); return new Promise<PassResult>(done => main.passes.push(done)); },
  applyServers: (changes: Change[]) => { main.sent.push(`server ${changes.map(change => `${change.key} ${change.on ? 'on' : 'off'}`).join()}`); return new Promise<PassResult>(done => main.passes.push(done)); },
  restore: async (id: string) => { main.restored.push(id); return { results: [] }; },
  plugins: async () => { main.reads.plugins++; return view; },
  refresh: async (): Promise<HomeView | null> => { main.reads.home++; main.duringHomeRead?.(); return null; },
  setPluginSkill: async () => ({ reports: [report('skill-off', 'Turned off.')] }),
  selectHome: async (): Promise<HomeView | null> => null,
  undoPluginTurn: async (_source: string, plugin: string) => { main.sent.push(`${plugin} undone`); return { done: [] }; },
  onSyncChanged: (listener: () => void) => { main.syncChanged = listener; },
};
// The page's modules, loaded under node with no window: the little of the DOM they touch as they load and redraw.
const element = (): any => ({ dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, replaceChildren() {}, append() {}, appendChild() {}, focus() {} });
const announcement = element();
Object.assign(globalThis, {
  window: { centralKnot: new Proxy(api, { get: (known, name) => (known as Record<string | symbol, unknown>)[name] ?? (() => Promise.resolve(null)) }), addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  document: { body: element(), documentElement: element(), activeElement: null, getElementById: (id: string) => id === 'announcement' ? announcement : element(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: element, createTextNode: element },
  ResizeObserver: class { observe() {} disconnect() {} },
});
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Macintosh' } });
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first.
await import('../src/settingspage.ts');
const { acting, applyClick, askFlash, closeResult, drawPage, flashRequests, leaveResults, pinnedRows, whyReadOnly,
  loadHome, queueClick, readAgain, setRenderer, showPage, state: app } = await import('../src/app.ts');
const { clickOn, closeRun, lastLines, market, pluginBusy, resetMarket, shownPlugins, turnPlugin, undoLabel, undoLast } = await import('../src/pluginstate.ts');
const { clickList, drop, endRun, takeBack, wantedOn } = await import('../src/clicklist.ts');
const { pin } = await import('../src/itemrow.ts');
const { turnTheseOff } = await import('../src/matrix.ts');
const { leftToItsRow } = await import('../src/usagerow.ts');
const { newItem } = await import('../src/library.ts');
const { clickWords } = await import('../src/pluginparts.ts');

/** Lets the page's awaits run on to the next call to main (not by a timer: the fade's test holds them). */
const settled = async () => { for (let round = 0; round < 20; round++) await new Promise(done => setImmediate(done)); };
const plugin = (name: string) => ({ name, description: '' });
const view = {
  home: '/home', tools: ['claude-cli'] as HarnessId[], clis: {}, canWrite: true, desktopOnly: {}, via: {}, versions: {}, suggested: [],
  marketplaces: [{ source: '/market', name: 'team', origins: ['central-knot'], sourceLabel: 'team', kind: 'folder', plugins: ['alpha', 'beta', 'gamma'].map(plugin), states: {},
    switches: {} }],
} as unknown as PluginsView;
const entry = view.marketplaces[0]!;
const report = (outcome: 'installed' | 'skill-off' | 'failed', message: string) => ({ tool: 'claude-cli' as const, outcome, changed: outcome !== 'failed', message, runs: [] });
const installed = (name: string): PluginTurnResult => ({ done: [{ source: '/market', marketName: 'team', plugin: name, tool: 'claude-cli', action: 'install', report: report('installed', 'Installed.') }], before: null, back: [] });
const refused = (name: string): PluginTurnResult => ({ done: [{ source: '/market', marketName: 'team', plugin: name, tool: 'claude-cli', action: 'install', report: report('failed', `Not installed. Plugin "${name}" not found.`) }] });
const stopped = 'It is no longer listed here, so nothing was changed. Read the page again.';
const states = () => market.clicks.map(click => `${click.plugin} ${click.state}`);
const words = (name: string) => clickWords(clickOn('/market', name)!).text;

function start() {
  // Each test starts with no click in the list and no run open.
  drop(() => true);
  endRun();
  resetMarket();
  Object.assign(main, { sent: [], restored: [], reads: { plugins: 0, home: 0 }, answers: [], duringHomeRead: undefined });
  app.home = { home: '/home', sync: { managed: [], gate: { state: 'open' } } } as unknown as typeof app.home;
  Object.assign(app, { page: 'plugins', outcome: undefined });
  market.read.data = view;
}

test('Clicks wait their turn: main gets one at a time, in the order clicked, and the other plugin actions are off, saying why', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  turnPlugin(entry, 'beta', 'on');
  await settled();
  assert.deepEqual(states(), ['alpha running', 'beta waiting']);
  assert.deepEqual(main.sent, ['alpha on']);
  // Each clicked plugin's switch is off; another plugin's is not. The other plugin actions are off, and say why.
  assert.deepEqual([pluginBusy('/market', 'alpha'), pluginBusy('/market', 'beta'), pluginBusy('/market', 'gamma')], [true, true, false]);
  assert.equal(acting(), 'Waits until the switches clicked are done.');
  await main.answer(installed('alpha'));
  assert.deepEqual(main.sent, ['alpha on', 'beta on']);
  await main.answer(installed('beta'));
  assert.deepEqual([clickList.running, acting()], [false, undefined]);
  // The one Undo is the last click that finished: beta's.
  assert.equal(market.lastRun?.turn?.plugin, 'beta');
  // While the run's result is on screen, the next click joins the run; once it is closed, the next click starts a new one.
  closeRun();
  turnPlugin(entry, 'gamma', 'off');
  assert.deepEqual(states(), ['gamma running']);
  await settled();
  await main.answer();
});

test('A click that ended is read back at once: its switch is free while the next one runs, and the home waits for the list’s end', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  turnPlugin(entry, 'beta', 'on');
  await settled();
  await main.answer(installed('alpha'));
  assert.deepEqual(states(), ['alpha ended', 'beta running']);
  assert.deepEqual(main.reads, { plugins: 1, home: 0 });
  assert.equal(pluginBusy('/market', 'alpha'), false);
  assert.equal(pluginBusy('/market', 'beta'), true);
  await main.answer(installed('beta'));
  assert.deepEqual(main.reads, { plugins: 2, home: 1 });
});

test('A row says its click’s aim while it waits and runs, then what main returned, a failure once, starting with its tool', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  turnPlugin(entry, 'beta', 'keep-out', 'claude-cli');
  turnPlugin(entry, 'gamma', 'let-in', 'claude-cli');
  await settled();
  assert.deepEqual([words('alpha'), words('beta'), words('gamma')], ['Installing…', 'Waiting to uninstall from Claude Code', 'Waiting to install in Claude Code']);
  await main.answer(installed('alpha'));
  assert.deepEqual([words('alpha'), words('beta')], ['Installed in Claude Code', 'Uninstalling from Claude Code…']);
  await main.answer({ stopped, done: [] });
  await main.answer(refused('gamma'));
  assert.deepEqual([words('beta'), words('gamma')], [stopped, 'Claude Code: Not installed. Plugin "gamma" not found.']);
  assert.deepEqual(['alpha', 'beta', 'gamma'].map(name => clickWords(clickOn('/market', name)!).failed), [false, true, true]);
  // On the list's row, in one short line: what it did and where; the reasons are in the band above and on the plugin's page.
  assert.deepEqual(['alpha', 'beta', 'gamma'].map(name => clickWords(clickOn('/market', name)!, true).text), ['Installed in Claude Code', 'Not done', 'Not put in Claude Code']);
});

test('A click that fails in the middle says why on its row, the clicks after it still run, and the list’s end is said as a whole', async () => {
  start();
  for (const name of ['alpha', 'beta', 'gamma']) turnPlugin(entry, name, 'on');
  await settled();
  await main.answer(installed('alpha'));
  await main.answer({ stopped, done: [] });
  assert.deepEqual(states(), ['alpha ended', 'beta ended', 'gamma running']);
  await main.answer(installed('gamma'));
  assert.deepEqual(main.sent, ['alpha on', 'beta on', 'gamma on']);
  assert.deepEqual(main.reads, { plugins: 3, home: 1 });
  // The status line and the toolbar say the whole list; every failure of it is in the problems band, with its plugin.
  assert.equal(app.said.text, 'alpha: installed in Claude Code; gamma: installed in Claude Code. beta failed.');
  assert.deepEqual(lastLines().filter(line => !line.ok).map(line => `${line.plugin}: ${line.text}`), [`beta: ${stopped}`]);
  // The one Undo stays the last click's.
  assert.equal(market.lastRun?.turn?.plugin, 'gamma');
});

test('Another home opened while clicks wait: those not yet sent are dropped, and nothing of the list shows there', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  turnPlugin(entry, 'beta', 'on');
  await settled();
  // As app.ts accept does when another home opens.
  resetMarket();
  await main.answer(installed('alpha'));
  assert.deepEqual(main.sent, ['alpha on']);
  assert.deepEqual([states(), clickList.running, market.lastRun], [[], false, undefined]);
  assert.deepEqual(main.reads, { plugins: 0, home: 0 });
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

test('A click made while the home is read at the list’s end runs too, and the home is read again after it', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  await settled();
  main.duringHomeRead = () => { main.duringHomeRead = undefined; turnPlugin(entry, 'beta', 'on'); };
  await main.answer(installed('alpha'));
  assert.deepEqual(states(), ['alpha ended', 'beta running']);
  assert.deepEqual([main.sent, clickList.running], [['alpha on', 'beta on'], true]);
  await main.answer(installed('beta'));
  assert.deepEqual([main.reads, clickList.running, pluginBusy('/market', 'beta')], [{ plugins: 2, home: 2 }, false, false]);
});

/** One click on alpha, run to the list's end. */
async function alphaInstalled() {
  start();
  turnPlugin(entry, 'alpha', 'on');
  await settled();
  await main.answer(installed('alpha'));
  await settled();
}

test('A list’s rows are its news: Undo, a plugin action, takes them away', async () => {
  await alphaInstalled();
  assert.deepEqual(states(), ['alpha ended']);
  undoLast();
  await settled();
  assert.deepEqual(main.sent, ['alpha on', 'alpha undone']);
  assert.deepEqual(states(), []);
});

test('A list’s rows are its news: the person’s Refresh takes them away', async () => {
  await alphaInstalled();
  await readAgain();
  assert.deepEqual(states(), []);
});

test('A list’s rows are its news: an item page’s switch for a plugin’s item takes them away', async () => {
  await alphaInstalled();
  await applyClick({ kind: 'skills', items: [], rows: [], changes: [], said: '', pluginsOnly: true, plugins: { ops: [] } });
  assert.deepEqual(states(), []);
});

test('Beside a sentence naming several plugins, Undo names the one it reverses: the last click’s', async () => {
  start();
  for (const name of ['alpha', 'beta']) turnPlugin(entry, name, 'on');
  await settled();
  await main.answer(installed('alpha'));
  await main.answer(installed('beta'));
  assert.equal(app.said.text, 'alpha: installed in Claude Code; beta: installed in Claude Code.');
  assert.equal(undoLabel(), 'Undo beta');
  // A list of one names one plugin: plain Undo.
  await alphaInstalled();
  assert.equal(undoLabel(), 'Undo');
});

test('A plugin that partly failed is said once at the list’s end, with where it went and where not', async () => {
  start();
  for (const name of ['alpha', 'beta']) turnPlugin(entry, name, 'on');
  await settled();
  await main.answer(installed('alpha'));
  const codexRefused = { ...report('failed', 'Not installed. Codex refused it.'), tool: 'codex-cli' as const };
  await main.answer({ done: [...installed('beta').done, { source: '/market', marketName: 'team', plugin: 'beta', tool: 'codex-cli', action: 'install', report: codexRefused }], before: null, back: [] });
  assert.equal(app.said.text, 'alpha: installed in Claude Code; beta: installed in Claude Code, not in Codex.');
  // Its failure, with why, is in the problems band, as any failure is.
  assert.deepEqual(lastLines().filter(line => !line.ok).map(line => `${line.plugin}: ${line.text}`), ['beta: Codex: Not installed. Codex refused it.']);
});

test('After two clicks on one plugin’s boxes, Undo names the click it reverses: the plugin and its tool', async () => {
  start();
  turnPlugin(entry, 'alpha', 'let-in', 'claude-cli');
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  await main.answer(installed('alpha'));
  await main.answer(installed('alpha'));
  assert.equal(undoLabel(), 'Undo alpha in Claude Code');
});

test('A new run on Plugins clears what an earlier action’s stop said, as before; a click joining a run leaves it', async () => {
  start();
  market.problem = 'Stopped before beta: Codex refused it.';
  market.lastRun = { done: [], undo: false, home: '/home' };
  turnPlugin(entry, 'alpha', 'on');
  assert.equal(market.problem, undefined);
  market.problem = 'Stopped: a later word.';
  turnPlugin(entry, 'beta', 'on');
  assert.equal(market.problem, 'Stopped: a later word.');
  await settled();
  await main.answer(installed('alpha'));
  await main.answer(installed('beta'));
});

// ---------- An item page's switches ----------

/** Each skill On or Off as main last answered for it (On before): what a row's state is now, as the page would read it from its view. */
const onNow = new Map<string, boolean>();
/** A skill's switch (or `kind`'s) clicked on the page open, as matrix.ts flip sends it: drawn as the row was (its latest unended click's state, else as it is now). */
function flip(name: string, on: boolean, made = () => {}, kind: PageKind = 'skills') {
  const seen = wantedOn(kind, name) ?? onNow.get(name) ?? true;
  queueClick({ kind, key: name, on }, name, () => {
    made();
    return { kind, items: [name], rows: [{ kind, key: name }], changes: [{ key: name, on, except: [], seenOn: seen }], said: (notIn: HarnessId[]) => `${name} is ${on ? 'on' : 'off'}${notIn.length ? ', but still in Claude Code' : ''}.` };
  }, () => onNow.get(name) ?? true);
}
/** What main did of one click: the item written or removed in Claude Code, or the click refused as a whole, or a write that failed. */
const did = (name: string, on = false): PassResult => { onNow.set(name, on); return { results: [{ item: name, harness: 'claude-cli', outcome: on ? 'written' : 'removed', message: '' }], writes: 1 }; };
const refusedAsStale = (name: string): PassResult => ({ results: [{ item: name, outcome: 'held', unchanged: true, message: `${name} changed since the page was read. Nothing was changed; read again.` }], writes: 0 });

const failedWrite = (name: string): PassResult => ({ results: [{ item: name, harness: 'claude-cli', outcome: 'failed', message: 'Its folder couldn’t be written.' }], writes: 0 });

function onSkills() {
  start();
  onNow.clear();
  flashRequests.clear();
  Object.assign(app, { page: 'skills', harness: undefined });
}

function backgroundWhileReading(t: TestContext, change: 'skills' | 'agents' | 'caught up' = 'skills') {
  onSkills();
  const tools = ['copilot-cli'];
  const kind = { tools, items: [], notices: [] };
  const home = { home: '/home', label: 'Practice', sync: { managed: tools, caughtUp: [], gate: { state: 'open' } },
    skills: { ...kind, items: [{ key: 'notes' }], library: { bar: { key: 'bar', name: 'bar', deleted: true, except: [] } } }, mcp: kind, agents: kind } as unknown as HomeView;
  app.home = home;
  const notice: ItemNotice = { kind: 'deleted-by-hand', key: 'notes', item: 'notes', history: 'deletion',
    winner: 'copilot-cli', losers: [], orderProved: true };
  const reads = t.mock.method(api, 'refresh');
  const background: HomeView = change === 'caught up'
    ? { ...home, sync: { ...home.sync, caughtUp: [{ item: 'bar', harness: 'copilot-cli', outcome: 'written', message: '' }] } }
    : { ...home, [change]: { ...home[change], notices: [notice] } };
  reads.mock.mockImplementationOnce(async () => background);
  reads.mock.mockImplementationOnce(async () => home, 1);
  return home;
}

test('Refresh draws the notice a background read brought while the page was busy', async t => {
  backgroundWhileReading(t);
  const draws: string[][] = [];
  setRenderer(() => { if (!acting()) draws.push(app.home!.skills.notices.map(n => n.history)); });
  try {
    main.syncChanged();
    await readAgain();
    assert.deepEqual(draws[0], ['deletion']);
    assert.doesNotMatch(app.said.text, /Nothing changed/);
  } finally { setRenderer(() => {}); }
});

test('A deletion notice held during Delete takes the finished result’s place and points its Undo to History', async t => {
  backgroundWhileReading(t);
  main.syncChanged();
  const click = applyClick({ kind: 'skills', items: ['bar'], rows: [{ kind: 'skills', key: 'bar' }], changes: [{ key: 'bar', on: true, except: [], deleted: true }], said: 'Deleted bar.' });
  await main.pass({ ...did('bar'), made: ['delete-bar'] });
  await click;
  assert.equal(app.said.text, 'Sync changed notes.');
  assert.equal(app.outcome, undefined);
  assert.deepEqual(app.undoMoved, { page: 'skills', label: 'Undo', items: ['bar'], notices: ['deletion'] });
});

test('An Agents notice leaves the Skills result and its Undo on screen', async t => {
  backgroundWhileReading(t, 'agents');
  main.syncChanged();
  const click = applyClick({ kind: 'skills', items: ['bar'], rows: [{ kind: 'skills', key: 'bar' }], changes: [{ key: 'bar', on: true, except: [], deleted: true }], said: 'Deleted bar.' });
  await main.pass({ ...did('bar'), made: ['delete-bar'] });
  await click;
  assert.equal(app.said.text, 'Sync changed notes.');
  assert.equal(app.outcome?.act?.label, 'Undo');
  assert.equal(app.undoMoved, undefined);
});

for (const pluginsOnly of [true, false]) {
  test(`A notice on Skills keeps the Undo for ${pluginsOnly ? 'a plugin item’s switch' : 'a switch that changed a copy and a plugin item'}`, async t => {
    backgroundWhileReading(t);
    main.syncChanged();
    const click = applyClick({ kind: 'skills', items: ['bar'], rows: [{ kind: 'skills', key: 'bar' }], said: 'Turned bar off.', pluginsOnly,
      changes: pluginsOnly ? [] : [{ key: 'bar', on: false, except: [] }],
      plugins: { ops: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', skill: 'bar', action: 'skill-off' }] } });
    if (!pluginsOnly) await main.pass({ ...did('bar'), made: ['delete-bar'] });
    await click;
    assert.equal(app.said.text, 'Sync changed notes.');
    assert.equal(app.outcome?.act?.label, 'Undo');
    assert.equal(app.undoMoved, undefined);
  });
}

for (const [change, status, notices] of [
  ['skills', 'Sync changed notes.', ['deletion']],
  ['caught up', 'Opened Practice. Read 1 skill, 0 MCP servers and 0 agents.', []],
] as const) {
  test(`Opening the selected home with a held ${change === 'skills' ? 'notice' : 'catch-up'}: the status and notices on its first finished draw`, async t => {
    const home = backgroundWhileReading(t, change);
    t.mock.method(api, 'selectHome', async () => home);
    const draws: { status: string; notices: string[] }[] = [];
    setRenderer(() => {
      if (!acting()) draws.push({ status: announcement.dataset.text, notices: app.home!.skills.notices.map(n => n.history) });
    });
    try {
      main.syncChanged();
      await loadHome('fixture');
      assert.deepEqual(draws[0], { status, notices });
    } finally { setRenderer(() => {}); }
  });
}

test('Four switches clicked in a row: each row is drawn as clicked at once, main gets one at a time, and the header says the run once', async () => {
  onSkills();
  for (const name of ['a', 'b', 'c', 'd']) flip(name, false);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(name => wantedOn('skills', name)), [false, false, false, false, undefined]);
  await settled();
  assert.deepEqual(main.sent, ['a off, seen on']);
  // The page acts, saying why its other writes are off; the rows' switches still take clicks (they join the list).
  assert.equal(acting(), 'Waits until the switches clicked are done.');
  await main.pass(did('a'));
  assert.equal(app.outcome?.text, '1 skill is off: a; 3 to go.');
  for (const name of ['b', 'c', 'd']) await main.pass(did(name));
  assert.deepEqual(main.sent, ['a off, seen on', 'b off, seen on', 'c off, seen on', 'd off, seen on']);
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, main.reads.home], ['4 skills are off: a, b, c and d.', false, 4]);
  assert.deepEqual([clickList.running, acting(), wantedOn('skills', 'a')], [false, undefined, undefined]);
});

test('A second click on a row whose click still waits takes it back: nothing is sent for it, and it is drawn as it was', async () => {
  onSkills();
  flip('a', false);
  flip('b', false);
  await settled();
  assert.equal(takeBack('skills', 'b'), true);
  assert.equal(wantedOn('skills', 'b'), undefined);
  await main.pass(did('a'));
  assert.deepEqual([main.sent, app.outcome?.text], [['a off, seen on'], 'a is off.']);
});

test('A second click on a row whose click runs is not a take-back: it runs after, from the state its row was drawn in, and is said as it left the row', async () => {
  onSkills();
  flip('a', false);
  await settled();
  assert.equal(takeBack('skills', 'a'), false);
  flip('a', true);
  assert.equal(wantedOn('skills', 'a'), true);
  await main.pass(did('a'));
  await main.pass(did('a', true));
  assert.deepEqual([main.sent, app.outcome?.text], [['a off, seen on', 'a on, seen off'], '1 skill is on: a.']);
});

test('Three clicks where the second is refused: the first and third are done, and the result names the second in a problem line', async () => {
  onSkills();
  for (const name of ['a', 'b', 'c']) flip(name, false);
  await settled();
  await main.pass(did('a'));
  await main.pass(refusedAsStale('b'));
  await main.pass(did('c'));
  assert.deepEqual([main.sent.length, app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], [3, '2 skills are off: a and c.', ['b changed since the page was read. Nothing was changed; read again.'], true]);
});

test('A click is worked out in its turn, after the home is read for the click before it', async () => {
  onSkills();
  const readsWhenMade: number[] = [];
  flip('a', false, () => readsWhenMade.push(main.reads.home));
  flip('b', false, () => readsWhenMade.push(main.reads.home));
  await settled();
  await main.pass(did('a'));
  await main.pass(did('b'));
  assert.deepEqual(readsWhenMade, [0, 1]);
});

test('A click with nothing left to change in its turn (the click before it took its whole plugin with it) counts as asked: no problem line', async () => {
  onSkills();
  flip('a', false);
  queueClick({ kind: 'skills', key: 'b', on: false }, 'b', () => undefined, () => false);
  await settled();
  await main.pass(did('a'));
  assert.deepEqual([main.sent, app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], [['a off, seen on'], '2 skills are off: a and b.', [], false]);
});

test('A click soon after the run’s last click ended joins the run; once its × ends it, the next click starts a new run', async () => {
  onSkills();
  flip('a', false);
  await settled();
  await main.pass(did('a'));
  flip('b', false);
  await settled();
  await main.pass(did('b'));
  assert.equal(app.outcome?.text, '2 skills are off: a and b.');
  closeResult();
  flip('c', false);
  await settled();
  await main.pass(did('c'));
  assert.equal(app.outcome?.text, 'c is off.');
});

test('Each row is said as the run left it: a row a later click turned back on is said on', async () => {
  onSkills();
  flip('a', false);
  flip('b', false);
  await settled();
  await main.pass(did('a'));
  // b's click, as main ran it, also put a back on (as a plugin's whole switch does).
  onNow.set('a', true);
  await main.pass(did('b'));
  assert.equal(app.outcome?.text, '1 skill is off: b; 1 skill is on: a.');
});

test('A click that failed is said as failed, not counted among those done', async () => {
  onSkills();
  for (const name of ['a', 'b', 'c']) flip(name, false);
  await settled();
  await main.pass(did('a'));
  await main.pass(failedWrite('b'));
  await main.pass(did('c'));
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], ['2 skills are off: a and c.', ['b is off, but still in Claude Code.'], true]);
});

test('A run made on one tool’s page is said there only: on another tool’s page, the status bar says it, and no row there flashes', async () => {
  onSkills();
  Object.assign(app, { page: 'harnesses', harness: 'claude-cli' });
  flip('a', false);
  await settled();
  // As harnesspage.ts goHarness does: another tool's page, its header empty, the run ended.
  app.harness = 'codex-cli';
  leaveResults();
  await main.pass(did('a'));
  assert.deepEqual([app.outcome, app.said.text, flashRequests.has('skills-a')], [undefined, 'a is off.', false]);
  // A click there is a run of its own, said in its own header.
  flip('b', false);
  await settled();
  await main.pass(did('b'));
  assert.equal(app.outcome?.text, 'b is off.');
});

test('A skill and an agent both named review are clicked apart: the agent’s click on Codex’s Agents tab waits; on Skills, review’s switch takes nothing back', async () => {
  onSkills();
  Object.assign(app, { page: 'harnesses', harness: 'codex-cli', harnessTab: 'agents' });
  flip('a', false, undefined, 'agents');
  flip('review', false, undefined, 'agents');
  await settled();
  // To Skills before the agent's click runs: the skill's switch is a click of its own, not a take-back of the agent's.
  showPage('skills');
  assert.equal(takeBack('skills', 'review'), false);
  flip('review', false);
  assert.deepEqual([wantedOn('agents', 'review'), wantedOn('skills', 'review')], [false, false]);
  await main.pass(did('a'));
  await main.pass(did('review'));
  await main.pass(did('review'));
  assert.deepEqual(main.sent, ['agent a off', 'agent review off', 'review off, seen on']);
  // The skill's row flashes on Skills; the agent's click was made on another page, said in the status bar, and flashes no row.
  assert.deepEqual([app.outcome?.text, flashRequests.has('skills-review'), flashRequests.has('agents-review')], ['review is off.', true, false]);
  // Back on Codex's Agents tab, an agent's click said there flashes the agent's row, not a skill's of its name.
  closeResult();
  Object.assign(app, { page: 'harnesses', harness: 'codex-cli', harnessTab: 'agents' });
  flip('notes', false, undefined, 'agents');
  await settled();
  await main.pass(did('notes'));
  assert.deepEqual([app.outcome?.text, flashRequests.has('agents-notes'), flashRequests.has('skills-notes')], ['notes is off.', true, false]);
});

test('A click on Codex’s Agents tab that ends while Codex’s Skills tab is open is said in the status bar only: that header is the skills’', async () => {
  onSkills();
  app.home!.sync.managed = ['codex-cli'];
  Object.assign(app, { page: 'harnesses', harness: 'codex-cli', harnessTab: 'agents' });
  flip('release-notes', false, undefined, 'agents');
  await settled();
  // As harnesspage.ts goHarness does for another tab: the header emptied, the run ended.
  app.harnessTab = 'skills';
  leaveResults();
  await main.pass(did('release-notes'));
  assert.deepEqual([app.outcome, app.said.text, flashRequests.has('agents-release-notes')], [undefined, 'release-notes is off.', false]);
});

test('A plugin’s skill named like your own: its switch’s click, and its Undo, ask for the plugin’s row’s flash, never your own’s', async () => {
  onSkills();
  const key = 'issue-tracker@team/release-notes', theirs = `skills-${key}`;
  queueClick({ kind: 'skills', key, on: false }, 'release-notes', () => ({ kind: 'skills', items: ['release-notes'], rows: [{ kind: 'skills', key }], changes: [{ key: 'release-notes', on: false, except: [] }], said: 'release-notes is off in Claude Code.' }), () => false);
  await settled();
  await main.pass({ ...did('release-notes'), made: ['event-1'] });
  assert.deepEqual([flashRequests.has(theirs), flashRequests.has('skills-release-notes')], [true, false]);
  flashRequests.clear();
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, flashRequests.has(theirs), flashRequests.has('skills-release-notes')], ['Undone: release-notes is as before.', true, false]);
});

// ---------- Rows of several kinds in one result ----------

/**
 * A home whose library holds these items, Off as their clicks leave them (`on`: On, before a click), each with the History entry
 * its Off made (`off-<kind>-<key>`, in this order, a second apart): what an Undo decides its actions on (historyactions.ts
 * libraryAction). `stopped`: a kind whose own record is damaged, which stops its writes alone.
 */
function homeWith(t: TestContext, items: { kind: PageKind; key: string }[], { stopped, on = false }: { stopped?: PageKind; on?: boolean } = {}) {
  const record = { 'skills': '', mcp: 'mcp:', agents: 'agent:' };
  const view = (kind: PageKind) => ({ tools: ['claude-cli', 'codex-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true },
    gate: kind === stopped ? { state: 'stopped', reason: 'The MCP record is damaged. Nothing was written or deleted.' } : { state: 'ready' },
    library: Object.fromEntries(items.filter(item => item.kind === kind).map(item => [item.key, { ...newItem(item.key, item.key), on }])) });
  app.home = { home: '/home', label: 'Practice', sync: { managed: ['claude-cli', 'codex-cli'], caughtUp: [], access: { allowed: true }, gate: { state: 'ready' } },
    skills: view('skills'), mcp: view('mcp'), agents: view('agents') } as unknown as HomeView;
  const events = items.map((item, at) => ({ id: `off-${item.kind}-${item.key}`, key: `${record[item.kind]}${item.key}`, kind: 'off', at: new Date(Date.UTC(2026, 10, 18, 9, 0, at)).toISOString() }));
  t.mock.method(api, 'history', async () => ({ events, days: 30 }));
}
/** What main did of one kind's click: `name` off in Claude Code, and the History entry its Off made. */
const offMade = (kind: PageKind, name: string): PassResult => ({ ...did(name), made: [`off-${kind}-${name}`] });

test('A skill and an agent both named review, and a server, switched on one page: one run, three counted, each review with its kind, each row flashed, and one Undo puts back all three, newest first', async t => {
  onSkills();
  homeWith(t, [{ kind: 'skills', key: 'review' }, { kind: 'agents', key: 'review' }, { kind: 'mcp', key: 'github' }]);
  // Three kinds clicked where the page is one place (the Library will be): one run, whatever each row's kind.
  flip('review', false);
  flip('review', false, undefined, 'agents');
  flip('github', false, undefined, 'mcp');
  // Two rows of one name are two rows: each is drawn as its own click asks.
  assert.deepEqual([wantedOn('skills', 'review'), wantedOn('agents', 'review'), wantedOn('mcp', 'github')], [false, false, false]);
  await settled();
  await main.pass(offMade('skills', 'review'));
  await main.pass(offMade('agents', 'review'));
  await main.pass(offMade('mcp', 'github'));
  assert.deepEqual(main.sent, ['review off, seen on', 'agent review off', 'server github off']);
  assert.equal(app.outcome?.text, '3 items are off: review (skill), review (agent) and github.');
  assert.deepEqual(['skills-review', 'agents-review', 'mcp-github'].map(id => flashRequests.has(id)), [true, true, true]);
  flashRequests.clear();
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual(main.restored, ['off-mcp-github', 'off-agents-review', 'off-skills-review']);
  assert.equal(app.outcome?.text, 'Undone: review (skill), review (agent) and github are as before.');
  assert.deepEqual(['skills-review', 'agents-review', 'mcp-github'].map(id => flashRequests.has(id)), [true, true, true]);
});

test('Turn these off across kinds, from the No use seen chip: a skill only some tools have is turned off, an agent a plugin also brings is left to its row, a server whose record is damaged is skipped and named, and the agents after it go on; Undo puts back what went', async t => {
  onSkills();
  homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'mcp', key: 'github' }, { kind: 'agents', key: 'planner' }], { stopped: 'mcp', on: true });
  const row = (kind: PageKind, name: string, copies: Record<string, string>) => ({ kind, key: name, name, description: '', copies, on: true, except: [] });
  const notes = row('skills', 'notes', { 'claude-cli': 'notes-1' }), github = row('mcp', 'github', { 'claude-cli': 'github-1', 'codex-cli': 'github-1' });
  const planner = row('agents', 'planner', { 'claude-cli': 'planner-1', 'codex-cli': 'planner-1' });
  // The chip's band leaves to its own row an item a tool has through a plugin: the agent is not among what it turns off.
  assert.equal(leftToItsRow({ key: 'reviewer', name: 'reviewer', copies: {}, plugin: { 'claude-cli': { plugin: 'kit', marketplace: 'team' } } } as never), true);
  // A row's controls ask their own kind's gate: the server's record stops servers only.
  assert.deepEqual([whyReadOnly(app.home!, 'mcp'), whyReadOnly(app.home!, 'skills'), whyReadOnly(app.home!)], ['The MCP record is damaged. Nothing was written or deleted.', undefined, undefined]);
  turnTheseOff([planner, github, notes]);
  await settled();
  // Main turns each off; the home as it reads then has it Off, which its Undo is decided on.
  app.home!.skills.library.notes!.on = app.home!.agents.library.planner!.on = false;
  await main.pass(offMade('skills', 'notes'));
  // Kind by kind, in turn: the servers' click goes once the skills' is done, and main refuses it; the agents' goes after it.
  await main.pass({ stopped: 'The MCP record is damaged. Nothing was written or deleted.', results: [], writes: 0 });
  await main.pass(offMade('agents', 'planner'));
  assert.deepEqual(main.sent, ['notes off, seen on', 'server github off', 'agent planner off']);
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn, app.outcome?.act?.label],
    ['Turned off 2 items with no use seen in the last 30 days: notes and planner. Central Knot keeps them, and turning one on puts it back as it was.',
      ['MCP servers: The MCP record is damaged. Nothing was written or deleted.'], true, 'Undo']);
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([main.restored, app.outcome?.text], [['off-agents-planner', 'off-skills-notes'], 'Undone: notes and planner are as before.']);
});

test('An Undo across kinds whose agent’s entry is stopped: the agents’ entries before it are left, the skill’s and the server’s still go back, and the stop is said once', async t => {
  onSkills();
  homeWith(t, [{ kind: 'skills', key: 'review' }, { kind: 'agents', key: 'review' }, { kind: 'agents', key: 'notes' }, { kind: 'mcp', key: 'github' }]);
  const stop = 'The agents record is damaged. Nothing was written or deleted.';
  t.mock.method(api, 'restore', async (id: string) => { main.restored.push(id); return id === 'off-agents-notes' ? { stopped: stop, results: [] } : { results: [] }; });
  flip('review', false);
  flip('review', false, undefined, 'agents');
  flip('notes', false, undefined, 'agents');
  flip('github', false, undefined, 'mcp');
  await settled();
  for (const [kind, name] of [['skills', 'review'], ['agents', 'review'], ['agents', 'notes'], ['mcp', 'github']] as const) await main.pass(offMade(kind, name));
  app.outcome!.act!.run();
  await settled();
  // Newest first: the server's, then the agent notes's, which stops; the agent review's is left, and the skill's goes back.
  assert.deepEqual(main.restored, ['off-mcp-github', 'off-agents-notes', 'off-skills-review']);
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], ['Not all of it could be undone.', [stop], true]);
});

test('A notice’s ask to flash a row lapses after its time, and a fresh ask then takes its place; Undo’s ask waits for the row', () => {
  flashRequests.clear();
  askFlash('skills-notes', Date.now() - 1);
  askFlash('skills-notes', Date.now() + 3000);
  assert.ok(flashRequests.get('skills-notes')! > Date.now());
  flashRequests.set('skills-standup', Infinity);
  askFlash('skills-standup', Date.now() + 3000);
  assert.equal(flashRequests.get('skills-standup'), Infinity);
});

test('A click 8 seconds after the run’s last click ended starts a new run, though a result with a problem line still shows', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    onSkills();
    flip('a', false);
    await settled();
    await main.pass(refusedAsStale('a'));
    mock.timers.tick(8000);
    assert.equal(app.outcome?.text, 'a changed since the page was read. Nothing was changed; read again.');
    flip('b', false);
    await settled();
    await main.pass(did('b'));
    assert.deepEqual([app.outcome?.text, app.outcome?.reasons], ['b is off.', []]);
  } finally { mock.timers.reset(); }
});

test('× ends the run: its clicks still waiting go on as a run of their own, whose result names only them', async () => {
  onSkills();
  for (const name of ['a', 'b', 'c']) flip(name, false);
  await settled();
  await main.pass(did('a'));
  assert.equal(app.outcome?.text, '1 skill is off: a; 2 to go.');
  closeResult();
  await main.pass(did('b'));
  assert.equal(app.outcome?.text, '1 skill is off: b; 1 to go.');
  await main.pass(did('c'));
  assert.equal(app.outcome?.text, '2 skills are off: b and c.');
});

test('A run left for another page: its result is said in the status bar, never in the header of the page open', async () => {
  onSkills();
  flip('a', false);
  await settled();
  showPage('mcp');
  await main.pass(did('a'));
  assert.deepEqual([app.outcome, app.said.text], [undefined, 'a is off.']);
});

test('A result with no problem goes 8 seconds after the run’s last click has finished; one with a problem line stays', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    onSkills();
    flip('a', false);
    flip('b', false);
    await settled();
    await main.pass(did('a'));
    // Nothing goes while clicks run.
    mock.timers.tick(9000);
    assert.equal(app.outcome?.text, '1 skill is off: a; 1 to go.');
    await main.pass(did('b'));
    mock.timers.tick(7999);
    assert.equal(app.outcome?.text, '2 skills are off: a and b.');
    mock.timers.tick(1);
    assert.equal(app.outcome?.text, undefined);
    flip('c', false);
    await settled();
    await main.pass(refusedAsStale('c'));
    mock.timers.tick(60_000);
    assert.equal(app.outcome?.text, 'c changed since the page was read. Nothing was changed; read again.');
  } finally { mock.timers.reset(); }
});

test('A result whose time runs out while a later click runs stays, and that click joins its run', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    onSkills();
    flip('a', false);
    await settled();
    await main.pass(did('a'));
    mock.timers.tick(7000);
    flip('b', false);
    await settled();
    mock.timers.tick(2000);
    assert.equal(app.outcome?.text, 'a is off.');
    await main.pass(did('b'));
    assert.equal(app.outcome?.text, '2 skills are off: a and b.');
  } finally { mock.timers.reset(); }
});

// ---------- Rows pinned where they were ----------

/** The keys pinned on the list on screen now. */
const pinnedNow = () => [...app.pinned.rows.keys()];
/** A draw of MCP servers on which docs's own switch was clicked. */
const docsPinned = () => drawPage(() => pin(pinnedRows('MCP servers'), 'docs', 'on'));

test('A draw of the same list keeps the rows pinned on it; a draw of another list, or of none, lets them go', () => {
  start();
  docsPinned();
  drawPage(() => pinnedRows('MCP servers'));
  assert.deepEqual(pinnedNow(), ['docs']);
  drawPage(() => pinnedRows('Agents'));
  assert.deepEqual(pinnedNow(), []);
  docsPinned();
  drawPage(() => {});
  assert.deepEqual(pinnedNow(), []);
});

test('A read outside a draw only reads: the Plugins list read in the background leaves the rows pinned on MCP servers alone', () => {
  start();
  docsPinned();
  shownPlugins(entry);
  assert.deepEqual(pinnedNow(), ['docs']);
});

test('Refresh lets every pinned row go', async () => {
  start();
  docsPinned();
  await readAgain();
  assert.deepEqual(pinnedNow(), []);
});

test('Find keeps a pinned plugin where it was: gamma, pinned first, stays first with Find typed', () => {
  start();
  drawPage(() => { shownPlugins(entry); pin(app.pinned, 'gamma', 0); });
  market.nav.find = 'a';
  let order: string[] = [];
  drawPage(() => { order = shownPlugins(entry).map(plugin => plugin.name); });
  market.nav.find = '';
  assert.deepEqual(order, ['gamma', 'alpha', 'beta']);
});

// ---------- × on a result ----------

test('× on the run’s result closes its problem lines too', async () => {
  start();
  turnPlugin(entry, 'alpha', 'on');
  await settled();
  await main.answer(refused('alpha'));
  market.problem = stopped;
  assert.equal(lastLines().filter(line => !line.ok).length, 1);
  closeRun();
  assert.deepEqual([lastLines(), market.problem], [[], undefined]);
});

test('× on an item page’s result closes what its click could not do too', () => {
  start();
  app.outcome = { page: 'mcp', text: 'docs is on in Claude Code.' } as typeof app.outcome;
  app.mcpResult = { results: [{ item: 'docs', harness: 'codex-cli', outcome: 'failed', message: 'Could not write.' }], writes: 0 } as unknown as typeof app.mcpResult;
  closeResult();
  assert.deepEqual([app.outcome, app.mcpResult], [undefined, undefined]);
});
