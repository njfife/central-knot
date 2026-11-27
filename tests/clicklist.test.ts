// The page's one list of clicks (clicklist.ts), on the page's own code with a stand-in for main: each test clicks, then answers
// main's calls one at a time and reads what the page holds in between. First the Plugins page's switch (pluginstate.ts
// turnPlugin), then an item page's row switches (app.ts queueClick) and when their result goes by itself (app.ts FADE_MS); then,
// on the same code, a background notice taken during a click or a home read, and when the rows a click pins are let go (app.ts pinnedRows, drawPage).
import { mock, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Change, HarnessId, HomeView, ItemNotice, MarketplaceView, PassResult, PluginTurn, PluginTurnResult, PluginsView, ProfileSwitchResult } from '../src/types.ts';
import type { PageKind } from '../src/app.ts';
import { reverse, type PluginOp } from '../src/pluginplan.ts';

/** Main, as the page sees it: each switch click waits until the test answers it; every other call is counted. */
const main = {
  sent: [] as string[], reads: { plugins: 0, home: 0 }, followUps: { repo: 0, sources: 0 },
  /** The History entries an Undo asked main to put back, in the order asked. */
  restored: [] as string[],
  answers: [] as ((result: PluginTurnResult) => void)[],
  /** An item page's clicks, each a pass main runs (applySkills), answered by the test with what it did (pass). */
  passes: [] as ((result: PassResult) => void)[],
  pass(result: PassResult) { this.passes.shift()!(result); return settled(); },
  syncChanged: () => {},
  profileSwitched: (_result: ProfileSwitchResult) => {},
  windowShown: () => {},
  visibilityChange: () => {},
  /** Run as the home is read: a click made meanwhile, say. */
  duringHomeRead: undefined as (() => void) | undefined,
  answer(result: PluginTurnResult = { done: [] }) { this.answers.shift()!(result); return settled(); },
};
const api = {
  onNavigate(_callback: (command: string) => void) {},
  turnPlugin: (_source: string, plugin: string, what: PluginTurn) => { main.sent.push(`${plugin} ${what}`); return new Promise<PluginTurnResult>(done => main.answers.push(done)); },
  applySkills: (changes: Change[]) => { main.sent.push(changes.map(change => `${change.key} ${change.on ? 'on' : 'off'}, seen ${change.seenOn ? 'on' : 'off'}`).join()); return new Promise<PassResult>(done => main.passes.push(done)); },
  history: async () => ({ events: [{ id: 'delete-bar', key: 'bar', kind: 'deleted' }], days: 30 }),
  applyAgents: (changes: Change[]) => { main.sent.push(`agent ${changes.map(change => `${change.key} ${change.on ? 'on' : 'off'}`).join()}`); return new Promise<PassResult>(done => main.passes.push(done)); },
  applyServers: (changes: Change[]) => { main.sent.push(`server ${changes.map(change => `${change.key} ${change.on ? 'on' : 'off'}`).join()}`); return new Promise<PassResult>(done => main.passes.push(done)); },
  restore: async (id: string) => { main.restored.push(id); return { results: [], reloads: [] }; },
  plugins: async () => { main.reads.plugins++; return view; },
  refresh: async (): Promise<HomeView | null> => { main.reads.home++; main.duringHomeRead?.(); return null; },
  repo: async () => { main.followUps.repo++; return null; },
  sources: async () => { main.followUps.sources++; return null; },
  setPluginSkill: async () => ({ reports: [report('skill-off', 'Turned off.')] }),
  setPluginOn: async () => ({ reports: [report('plugin-off', 'Turned off.')] }),
  selectHome: async (): Promise<HomeView | null> => null,
  undoPluginTurn: async (_source: string, plugin: string) => { main.sent.push(`${plugin} undone`); return { done: [] }; },
  onSyncChanged: (listener: () => void) => { main.syncChanged = listener; },
  onProfileSwitched: (listener: (result: ProfileSwitchResult) => void) => { main.profileSwitched = listener; },
  onWindowShown: (listener: () => void) => { main.windowShown = listener; },
  syncNow: async (_home: string): Promise<unknown> => null,
  pullRepo: async (_home: string): Promise<unknown> => null,
  switchProfile: async (_id: string, _home: string): Promise<unknown> => null,
  saveProfile: async (_profile: unknown, _home: string): Promise<unknown> => null,
  deleteProfile: async (_id: string, _home: string): Promise<unknown> => null,
  setSyncEverything: async (_on: boolean, _home: string, _first?: boolean): Promise<unknown> => null,
  // A home's usage, read as it opens (app.ts collectUsage): none here; one that failed would be said in the status bar.
  readUsage: async () => ({ at: '2026-11-20T00:00:00.000Z', tools: [] }),
};
// The page's modules, loaded under node with no window: the little of the DOM they touch as they load and redraw. An element keeps
// what is appended to it, so a test can read the words a part draws (textOf).
const element = (): any => ({ attrs: {} as Record<string, string>, dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, children: [], content: {}, setAttribute(k: string, v: string) { this.attrs[k] = v; }, addEventListener() {}, replaceChildren(...kids: unknown[]) { this.children = kids; },
  append(...kids: unknown[]) { this.children.push(...kids); }, appendChild() {}, focus() {}, querySelector: () => element(), after() {} });
const findById = (node: any, id: string): any => {
  if (!node || typeof node === 'string') return undefined;
  if (node.id === id || node.attrs?.id === id) return node;
  for (const child of node.children ?? []) { const hit = findById(child, id); if (hit) return hit; }
  return undefined;
};
const textOf = (node: any): string => (typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join(''));
const announcement = element();
Object.assign(globalThis, {
  window: { centralKnot: new Proxy(api, { get: (known, name) => (known as Record<string | symbol, unknown>)[name] ?? (() => Promise.resolve(null)) }), addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  document: { body: element(), documentElement: element(), activeElement: null, hidden: false, hasFocus: () => true, getElementById: (id: string) => id === 'announcement' ? announcement : element(), querySelector: () => null, querySelectorAll: () => [], addEventListener(name: string, fn: () => void) { if (name === 'visibilitychange') main.visibilityChange = fn; }, createElement: element, createTextNode: element },
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: () => 0,
});
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Macintosh' } });
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first.
await import('../src/settingspage.ts');
const { acting, announce, applyByKind, applyClick, askFlash, busy, closeResult, deleteProfileDef, drawPage, flashRequests, lastResult, leaveResults, pinnedRows, profileEndedLine, profilesBefore, saveProfileDef, selectOff, switchToProfile, whyKindReadOnly, whyReadOnly,
  loadHome, problemKey, queueClick, readAgain, restoreEvent, setRenderer, showPage, syncNow, state: app } = await import('../src/app.ts');
const { repo, repoPage } = await import('../src/repopage.ts');
const { addMarketplace, applyPluginOps, clickOn, closeRun, lastLines, market, pluginBusy, resetMarket, resultOn, runReloads, shownPlugins, turnFromLine, turnPlugin, undoLabel, undoLast, usePlugins } = await import('../src/pluginstate.ts');
const { clickList, drop, endRun, takeBack, wantedOn } = await import('../src/clicklist.ts');
const { pin, rowId } = await import('../src/itemrow.ts');
const { backgroundProblems, copyQuestion, headerNotices, libraryTable, listResult, openKind, toTurnOff, turnTheseOff } = await import('../src/matrix.ts');
const { openWalkthrough, setupLead, walkthroughBand } = await import('../src/firstsetup.ts');
const { pluginsResult } = await import('../src/pluginspage.ts');
const { versionsList } = await import('../src/editparts.ts');
const { timesApart } = await import('../src/model.ts');
const { newItem } = await import('../src/library.ts');
const { keptBack } = await import('../src/clickplan.ts');
const { clickWords, toolBox } = await import('../src/pluginparts.ts');
const { owedTo } = await import('../src/pluginrecord.ts');
const { toolNow } = await import('../src/pluginstatus.ts');

/** Lets the page's awaits run on to the next call to main (not by a timer: the fade's test holds them). */
const settled = async () => { for (let round = 0; round < 20; round++) await new Promise(done => setImmediate(done)); };
const plugin = (name: string) => ({ name, description: '' });
const view = {
  home: '/home', tools: ['claude-cli'] as HarnessId[], clis: {}, canWrite: true, desktopOnly: {}, via: {}, versions: {}, suggested: [],
  marketplaces: [{ source: '/market', name: 'team', origins: ['central-knot'], sourceLabel: 'team', kind: 'folder', plugins: ['alpha', 'beta', 'gamma'].map(plugin), states: {},
    switches: {} }],
} as unknown as PluginsView;
const entry = view.marketplaces[0]!;
const report = (outcome: 'installed' | 'skill-off' | 'plugin-off' | 'failed', message: string) => ({ tool: 'claude-cli' as const, outcome, changed: outcome !== 'failed', message, runs: [] });
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
  Object.assign(main, { sent: [], restored: [], reads: { plugins: 0, home: 0 }, followUps: { repo: 0, sources: 0 }, answers: [], duringHomeRead: undefined });
  (document as unknown as { hidden: boolean }).hidden = false;
  const none = { tools: [], items: [], notices: [], library: {} };
  app.home = { home: '/home', sync: { managed: [], gate: { state: 'open' } }, skills: none, mcp: none, agents: none } as unknown as typeof app.home;
  Object.assign(app, { page: 'plugins', outcome: undefined, libraryKind: 'all' });
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
  assert.deepEqual([words('alpha'), words('beta'), words('gamma')], ['Turning on…', 'Waiting to turn off in Claude Code', 'Waiting to turn on in Claude Code']);
  await main.answer(installed('alpha'));
  assert.deepEqual([words('alpha'), words('beta')], ['Installed in Claude Code', 'Turning off in Claude Code…']);
  await main.answer({ stopped, done: [] });
  await main.answer(refused('gamma'));
  assert.deepEqual([words('beta'), words('gamma')], [stopped, 'Claude Code: Not installed. Plugin "gamma" not found.']);
  assert.deepEqual(['alpha', 'beta', 'gamma'].map(name => clickWords(clickOn('/market', name)!).failed), [false, true, true]);
  // On the list's row, in one short line: what it did and where; the reasons are in the band above and on the plugin's page.
  assert.deepEqual(['alpha', 'beta', 'gamma'].map(name => clickWords(clickOn('/market', name)!, true).text), ['Turned on in Claude Code', 'Not done', 'Not turned on in Claude Code']);
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

test('A later click on a plugin in a tool is what the run’s sentence says of that tool: a tick then an untick of Claude Code reads turned off', async () => {
  start();
  turnPlugin(entry, 'alpha', 'let-in', 'claude-cli');
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  await main.answer(installed('alpha'));
  await main.answer({ done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off', report: { tool: 'claude-cli', outcome: 'plugin-off', changed: true, message: '', runs: [] } }], before: null, back: [] });
  assert.deepEqual(lastLines().map(line => line.text), ['turned off in Claude Code']);
});

test('A box’s hover says only what its click and its Undo do there: a copy already off in its tool’s own settings; a tick on an Off plugin another tool has on', () => {
  const two = { ...view, tools: ['claude-cli', 'copilot-cli'], clis: { 'claude-cli': true, 'copilot-cli': true } } as PluginsView;
  const drawn = (on: boolean, states: MarketplaceView['states'][string]) => {
    const shown = { ...entry, states: { alpha: states } } as MarketplaceView;
    const tools = Object.fromEntries(two.tools.map(tool => [tool, owedTo({ on, except: [] }, tool, toolNow(two, shown, 'alpha', tool, undefined, false), two.tools)]));
    return { ...shown, switches: { alpha: { entry: { on, except: [] }, tools } } };
  };
  const hover = (shown: MarketplaceView, tool: HarnessId) => findById(toolBox(two, shown, plugin('alpha'), tool, 0, undefined), `pbox-0-alpha-${tool}`)?.attrs.title;
  // On here, and turned off in Claude Code with its own command: unticked kept-off box; one tick turns it on, Undo turns it off.
  assert.equal(hover(drawn(true, { 'claude-cli': { state: 'installed', path: '/x', off: true } }), 'claude-cli'),
    'Off in Claude Code: still installed, with its data and settings. Click to turn alpha on in Claude Code. Undo turns it off again.');
  // Off here, and on in Claude Code by its own command: a tick on Copilot CLI's kept copy turns it on there, not there alone.
  assert.equal(hover(drawn(false, { 'claude-cli': { state: 'installed', path: '/x' }, 'copilot-cli': { state: 'installed', path: '/y', off: true } }), 'copilot-cli'),
    'Off in Copilot CLI: still installed, with its data and settings. Click to turn alpha on in Copilot CLI. Undo turns it off again.');
  // Ticked on Copilot CLI's live folder copy: says turned off, kept installed, never taken out.
  assert.equal(hover(drawn(true, { 'copilot-cli': { state: 'installed', path: '/y', live: true } }), 'copilot-cli'),
    'Copilot CLI: installed, loaded live from the marketplace folder. Click to turn alpha off in Copilot CLI, kept installed: it stays off until you tick it again. Undo turns it on again.');
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

/** Each item On or Off as main last answered for it (On before), by its row id: what a row's state is now, as the page would read it from its view. */
const onNow = new Map<string, boolean>();
/** A skill's switch (or `kind`'s) clicked on the page open, as matrix.ts flip sends it: drawn as the row was (its latest unended click's state, else as it is now). */
function flip(name: string, on: boolean, made = () => {}, kind: PageKind = 'skills') {
  const id = rowId(kind, name), seen = wantedOn(kind, name) ?? onNow.get(id) ?? true;
  queueClick({ kind, key: name, on }, name, () => {
    made();
    return { kind, items: [name], rows: [{ kind, key: name }], changes: [{ key: name, on, except: [], seenOn: seen }], said: (notIn: HarnessId[]) => `${name} is ${on ? 'on' : 'off'}${notIn.length ? ', but still in Claude Code' : ''}.` };
  }, () => onNow.get(id) ?? true);
}
/** What main did of one click on `kind`'s row: the item written or removed in Claude Code, or the click refused as a whole, or a write that failed. */
const did = (name: string, on = false, kind: PageKind = 'skills'): PassResult => { onNow.set(rowId(kind, name), on); return { results: [{ item: name, harness: 'claude-cli', outcome: on ? 'written' : 'removed', message: '' }], writes: 1, reloads: [] }; };
const refusedAsStale = (name: string): PassResult => ({ results: [{ item: name, outcome: 'held', unchanged: true, message: `${name} changed since the page was read. Nothing was changed; read again.` }], writes: 0, reloads: [] });

const failedWrite = (name: string): PassResult => ({ results: [{ item: name, harness: 'claude-cli', outcome: 'failed', message: 'Its folder couldn’t be written.' }], writes: 0, reloads: [] });

function onLibrary() {
  start();
  onNow.clear();
  flashRequests.clear();
  Object.assign(app, { page: 'library', harness: undefined });
}

/** The Library, on a home of one skill (its notices in the header: headerNotices): the next read brings `change`, every read after it the home as it was. */
function backgroundWhileReading(t: TestContext, change: 'skills' | 'agents' | 'caught up' = 'skills') {
  onLibrary();
  const tools = ['copilot-cli'];
  const kind = { tools, items: [], notices: [], gate: { state: 'open' }, unread: [], problems: [] };
  const home = { home: '/home', label: 'Practice', sync: { managed: tools, present: tools, caughtUp: [], gate: { state: 'open' }, access: { allowed: true } },
    skills: { ...kind, items: [{ key: 'notes', name: 'notes', description: '', copies: {}, except: [], on: true }], library: { bar: { key: 'bar', name: 'bar', deleted: true, except: [] } } }, mcp: kind, agents: kind } as unknown as HomeView;
  app.home = home;
  const notice: ItemNotice = { kind: 'deleted-by-hand', key: 'notes', item: 'notes', history: 'deletion',
    winner: 'copilot-cli', losers: [], orderProved: true };
  const reads = t.mock.method(api, 'refresh', async () => home);
  const background: HomeView = change === 'caught up'
    ? { ...home, sync: { ...home.sync, caughtUp: [{ item: 'bar', harness: 'copilot-cli', outcome: 'written', message: '', of: 'skills' }] } }
    : { ...home, [change]: { ...home[change], notices: [notice] } };
  reads.mock.mockImplementationOnce(async () => background);
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

test('Refresh beside a notice an earlier read drew says what it read and stops there; once the notice is dismissed, it says "Nothing changed"', async t => {
  backgroundWhileReading(t);
  main.syncChanged();
  await settled();
  const noticeDrawn = () => textOf(headerNotices(false)?.lines).includes('notes was deleted in Copilot CLI');
  assert.equal(noticeDrawn(), true);
  await readAgain();
  assert.deepEqual([app.said.text, noticeDrawn()], ['Read 1 skill, 0 MCP servers and 0 agents from Practice.', true]);
  // Dismissed by its ×, or by its Undo, which History offers too, where the list isn't drawn again before the next Refresh.
  // (The tests after this one bring the same notice again.)
  app.dismissed.add('deletion');
  t.after(() => app.dismissed.delete('deletion'));
  await readAgain();
  assert.deepEqual([app.said.text, noticeDrawn()], ['Read 1 skill, 0 MCP servers and 0 agents from Practice. Nothing changed.', false]);
});

test('Another home opened from beside the last home’s notice says "Nothing changed": that notice goes with its home', async t => {
  const home = backgroundWhileReading(t);
  main.syncChanged();
  await settled();
  assert.match(textOf(headerNotices(false)?.lines), /notes was deleted in Copilot CLI/);
  t.mock.method(api, 'selectHome', async () => ({ ...home, home: '/other', label: 'Other' }));
  await loadHome('custom');
  assert.match(app.said.text, /^Opened Other\. Read 1 skill, 0 MCP servers and 0 agents\. Nothing changed\./);
});

test('A deletion notice held during Delete leaves the finished result and its Undo in the header: the notice is only counted', async t => {
  backgroundWhileReading(t);
  main.syncChanged();
  const click = applyClick({ kind: 'skills', items: ['bar'], rows: [{ kind: 'skills', key: 'bar' }], changes: [{ key: 'bar', on: true, except: [], deleted: true }], said: 'Deleted bar.' });
  await main.pass({ ...did('bar'), made: ['delete-bar'] });
  await click;
  assert.deepEqual([app.said.text, app.outcome?.text, app.outcome?.act?.label], ['Sync changed notes.', 'Deleted bar.', 'Undo']);
});

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
  onLibrary();
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
  onLibrary();
  flip('a', false);
  flip('b', false);
  await settled();
  assert.equal(takeBack('skills', 'b'), true);
  assert.equal(wantedOn('skills', 'b'), undefined);
  await main.pass(did('a'));
  assert.deepEqual([main.sent, app.outcome?.text], [['a off, seen on'], 'a is off.']);
});

test('A second click on a row whose click runs is not a take-back: it runs after, from the state its row was drawn in, and is said as it left the row', async () => {
  onLibrary();
  flip('a', false);
  await settled();
  assert.equal(takeBack('skills', 'a'), false);
  flip('a', true);
  assert.equal(wantedOn('skills', 'a'), true);
  await main.pass(did('a'));
  await main.pass(did('a', true));
  assert.deepEqual([main.sent, app.outcome?.text], [['a off, seen on', 'a on, seen off'], '1 skill is on: a.']);
});

test('Three clicks where the second is refused: the first and third are done, and the result says first that the second didn’t go through, its reason a problem line', async () => {
  onLibrary();
  for (const name of ['a', 'b', 'c']) flip(name, false);
  await settled();
  await main.pass(did('a'));
  await main.pass(refusedAsStale('b'));
  await main.pass(did('c'));
  assert.deepEqual([main.sent.length, app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], [3, '1 of 3 didn’t go through in every tool: b. 2 skills are off: a and c.', ['b changed since the page was read. Nothing was changed; read again.'], true]);
});

test('A click is worked out in its turn, after the home is read for the click before it', async () => {
  onLibrary();
  const readsWhenMade: number[] = [];
  flip('a', false, () => readsWhenMade.push(main.reads.home));
  flip('b', false, () => readsWhenMade.push(main.reads.home));
  await settled();
  await main.pass(did('a'));
  await main.pass(did('b'));
  assert.deepEqual(readsWhenMade, [0, 1]);
});

test('A click with nothing left to change in its turn (the click before it took its whole plugin with it) counts as asked: no problem line', async () => {
  onLibrary();
  flip('a', false);
  queueClick({ kind: 'skills', key: 'b', on: false }, 'b', () => undefined, () => false);
  await settled();
  await main.pass(did('a'));
  assert.deepEqual([main.sent, app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], [['a off, seen on'], '2 skills are off: a and b.', [], false]);
});

test('A click soon after the run’s last click ended joins the run; once its × ends it, the next click starts a new run', async () => {
  onLibrary();
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
  onLibrary();
  flip('a', false);
  flip('b', false);
  await settled();
  await main.pass(did('a'));
  // b's click, as main ran it, also put a back on (as a plugin's whole switch does).
  onNow.set(rowId('skills', 'a'), true);
  await main.pass(did('b'));
  assert.equal(app.outcome?.text, '1 skill is off: b; 1 skill is on: a.');
});

test('A click that failed is said first as not gone through in every tool, and not counted among those done; its own sentence is no reason (its problem line says it)', async () => {
  onLibrary();
  for (const name of ['a', 'b', 'c']) flip(name, false);
  await settled();
  await main.pass(did('a'));
  await main.pass(failedWrite('b'));
  await main.pass(did('c'));
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], ['1 of 3 didn’t go through in every tool: b. 2 skills are off: a and c.', [], true]);
});

// Off in Central Knot and in Codex, but Claude Code's folder couldn't be written: the click did part of its work.
const partly = (name: string): PassResult => { onNow.set(rowId('skills', name), false); return { results: [{ item: name, harness: 'codex-cli', outcome: 'removed', message: '' }, { item: name, harness: 'claude-cli', outcome: 'failed', message: 'Its folder couldn’t be written.' }], writes: 1, reloads: [] }; };

test('One click that left something undone says so first, before its name can take the header’s room', async () => {
  onLibrary();
  flip('a', false);
  await settled();
  await main.pass(failedWrite('a'));
  assert.deepEqual([app.outcome?.text, app.outcome?.warn], ['Didn’t go through in every tool: a is off, but still in Claude Code.', true]);
});

test('A row clicked again after its click failed is said as its last click left it: no lead, no reason and no problem line left from before', async () => {
  onLibrary();
  flip('a', false);
  await settled();
  await main.pass(failedWrite('a'));
  flip('a', true);
  await settled();
  await main.pass(did('a', true));
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn, app.skillsResult?.results.filter(keptBack)], ['1 skill is on: a.', [], false, []]);
});

test('A row whose next click is refused whole still says what its click before left undone: in the lead, its problem line, and no "Nothing changed"', async () => {
  onLibrary();
  flip('a', false);
  await settled();
  await main.pass(partly('a'));
  flip('a', true);
  await settled();
  await main.pass(refusedAsStale('a'));
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.skillsResult?.results.filter(keptBack).map(entry => entry.harness)],
    ['1 of 1 didn’t go through in every tool: a. 1 is off.', ['a changed since the page was read. Nothing was changed; read again.'], ['claude-cli']]);
});

test('A run where every row fell short names them once: the lead names them, the sentence after it counts them', async () => {
  onLibrary();
  for (const name of ['a', 'b', 'c']) flip(name, false);
  await settled();
  for (const name of ['a', 'b', 'c']) await main.pass(partly(name));
  assert.equal(app.outcome?.text, '3 of 3 didn’t go through in every tool: a, b and c. All 3 are off.');
});

/**
 * A home whose skills, now Off, are `keys`: those in `linked` read by Codex and Pi through links into the shared folder, with no copy
 * of Central Knot's (skills.ts anotherWay), and `draft`, found with copies that differ, waiting for a choice of copy.
 */
function linkedHome(keys: string[], linked: string[]) {
  const tools = ['claude-cli', 'codex-cli', 'pi-cli'], readers = ['codex-cli', 'pi-cli'];
  const reads = (key: string) => (linked.includes(key) ? { anotherWay: Object.fromEntries(readers.map(tool => [tool, 'It has it through a link in its skills folder, which is not Central Knot’s copy.'])),
    loads: Object.fromEntries(readers.map(tool => [tool, { folder: key, name: key, skillFile: `/home/.agents/skills/${key}/SKILL.md`, switchedOff: false }])) } : {});
  const draft = { key: 'draft', name: 'draft', copies: { 'claude-cli': { hash: 'x' }, 'codex-cli': { hash: 'y' } }, takeInAnswers: { click: { wait: 'copies-differ' }, rule: { wait: 'copies-differ' } } };
  const empty = { tools, items: [], notices: [], problems: [], unread: [], library: {} };
  app.home = { home: '/home', label: 'Practice', sync: { managed: tools, caughtUp: [], access: { allowed: true }, gate: { state: 'ready' } },
    skills: { ...empty, items: [...keys.map(key => ({ key, name: key, copies: {}, ...reads(key) })), draft], library: Object.fromEntries(keys.map(key => [key, newItem(key, key)])) }, mcp: empty, agents: empty } as unknown as HomeView;
}
/** draft's Add in its turn: its copies differ, so the pass waits for a choice (librarypass.ts addClicked). */
const waitsForChoice: PassResult = { results: [{ item: 'draft', outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' }], writes: 0, reloads: [] };

test('A run of four Offs, two of them still read by Codex and Pi through links: after what went through, one sentence names the two and the tools that still read them', async () => {
  onLibrary();
  linkedHome(['a', 'b', 'c', 'd'], ['a', 'b']);
  for (const name of ['a', 'b', 'c', 'd']) flip(name, false);
  await settled();
  for (const name of ['a', 'b', 'c', 'd']) await main.pass(did(name));
  // It is no failure: no warning, and no reason.
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.outcome?.reasons], ['4 skills are off: a, b, c and d. Codex and Pi still read a and b another way.', false, []]);
});

test('A run where one row waits for a choice of copy: it is not counted On or Off, it is no reason, and a sentence says it waits', async () => {
  onLibrary();
  linkedHome(['a'], ['a']);
  flip('a', false);
  flip('draft', true);
  await settled();
  await main.pass(did('a'));
  await main.pass(waitsForChoice);
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.outcome?.reasons],
    ['1 skill is off: a. Codex and Pi still read a another way. draft has differing copies. Choose which copy every tool uses.', false, []]);
});

test('A row a refusal left Off, which tools still read, says both: first that it didn’t go through, then among the rows still read', async () => {
  onLibrary();
  linkedHome(['a', 'b'], ['a', 'b']);
  flip('a', false);
  flip('b', false);
  await settled();
  // a is Off in Central Knot, and its removal failed in Claude Code.
  onNow.set(rowId('skills', 'a'), false);
  await main.pass(failedWrite('a'));
  await main.pass(did('b'));
  assert.equal(app.outcome?.text, '1 of 2 didn’t go through in every tool: a. 1 skill is off: b. Codex and Pi still read a and b another way.');
});

test('Sync once is a new result too: a refused Off’s line from before goes when its result lands', async t => {
  onLibrary();
  linkedHome(['a'], []);
  flip('a', false);
  await settled();
  await main.pass(failedWrite('a'));
  assert.equal(app.skillsResult?.results.filter(keptBack).length, 1);
  t.mock.method(api, 'syncNow', async () => ({ view: app.home, text: 'Synced once.', reasons: [], warn: false, history: false, reloads: [] }));
  await syncNow();
  assert.deepEqual([app.outcome?.text, app.skillsResult?.results.filter(keptBack) ?? []], ['Synced once.', []]);
});

test('The background’s line for a failed removal stands while the view still owes that removal, in Automatic sync’s own words while it is on; one no longer owed is not said', () => {
  onLibrary();
  linkedHome(['a', 'b'], []);
  // a's removal from Claude Code is still owed; b's went through at a later pass in the same delivered history (main.ts keepPass).
  const plan = (remove: string[]) => ({ orderProved: true, keep: [], write: [], remove, forget: [], current: [], ownCopy: [] });
  const items = app.home!.skills.items as unknown as { key: string; plan?: unknown }[];
  items.find(item => item.key === 'a')!.plan = plan(['claude-cli']);
  items.find(item => item.key === 'b')!.plan = plan([]);
  const failed = (item: string) => ({ item, harness: 'claude-cli' as const, outcome: 'failed' as const, removal: true, of: 'skills' as const, message: 'Could not remove Claude Code’s copy yet. Central Knot will try again.' });
  app.home!.sync.caughtUp = [failed('a'), failed('b'), { item: 'b', harness: 'claude-cli', outcome: 'removed', of: 'skills', message: 'Removed. Central Knot keeps it.' }];
  app.home!.syncOn = true;
  assert.deepEqual(backgroundProblems().map(({ problem, retried }) => [problem.item, retried]), [['a', true]]);
  app.home!.syncOn = false;
  assert.deepEqual(backgroundProblems().map(({ problem, retried }) => [problem.item, retried]), [['a', false]]);
});

test('Sync once from the menu on Plugin marketplaces, an older run’s result there: the header draws Sync once’s result and its reasons, not the run’s', () => {
  start();
  market.lastRun = { done: installed('alpha').done, undo: false, home: '/home' };
  app.outcome = { page: 'plugins', band: true, warn: true, text: 'Not everything was synced.', reasons: [['notes', ' (Codex): Could not remove Codex’s copy yet.']] };
  const drawn = pluginsResult().map(textOf).join(' | ');
  assert.match(drawn, /Not everything was synced\./);
  assert.match(drawn, /notes \(Codex\): Could not remove Codex’s copy yet\./);
  assert.doesNotMatch(drawn, /alpha/);
});

test('A new run lets go every kind’s earlier click reasons: after two refusals stood past their 8 seconds, an agent switched with no problem has no reason and no problem line, and the skills’ notices stay', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    onLibrary();
    homeWith(t, [{ kind: 'skills', key: 'a' }, { kind: 'skills', key: 'b' }, { kind: 'agents', key: 'helper' }]);
    const notice: ItemNotice = { kind: 'deleted-by-hand', key: 'notes', item: 'notes', history: 'deletion', winner: 'claude-cli', losers: [], orderProved: true };
    flip('a', false);
    flip('b', false);
    await settled();
    await main.pass(failedWrite('a'));
    await main.pass({ ...failedWrite('b'), notices: [notice] });
    assert.equal(app.skillsResult?.results.filter(keptBack).length, 2);
    mock.timers.tick(9000);
    flip('helper', false, undefined, 'agents');
    await settled();
    await main.pass(offMade('agents', 'helper'));
    assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.skillsResult?.results.filter(keptBack), app.skillsResult?.notices], ['helper is off.', [], [], [notice]]);
  } finally { mock.timers.reset(); }
});

test('An Undo lets go every kind’s earlier click reasons: after a run whose skill was refused and whose agent went off, its Undo shows no skill’s problem line', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'a' }, { kind: 'agents', key: 'helper' }]);
  flip('a', false);
  flip('helper', false, undefined, 'agents');
  await settled();
  await main.pass(failedWrite('a'));
  await main.pass(offMade('agents', 'helper'));
  assert.equal(app.skillsResult?.results.filter(keptBack).length, 1);
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([main.restored, app.outcome?.text, app.skillsResult?.results.filter(keptBack)], [['off-agents-helper'], 'Undone: helper is as before.', []]);
});

test('A run made on one tool’s page is said there only: on another tool’s page, the status bar says it, and no row there flashes', async () => {
  onLibrary();
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

test('A skill and an agent both named review are clicked apart: the agent’s click on Codex’s Agents tab waits; on the Library, review’s switch takes nothing back', async () => {
  onLibrary();
  Object.assign(app, { page: 'harnesses', harness: 'codex-cli', harnessTab: 'agents' });
  flip('a', false, undefined, 'agents');
  flip('review', false, undefined, 'agents');
  await settled();
  // To the Library before the agent's click runs: the skill's switch is a click of its own, not a take-back of the agent's.
  showPage('library');
  assert.equal(takeBack('skills', 'review'), false);
  flip('review', false);
  assert.deepEqual([wantedOn('agents', 'review'), wantedOn('skills', 'review')], [false, false]);
  await main.pass(did('a', false, 'agents'));
  await main.pass(did('review', false, 'agents'));
  await main.pass(did('review'));
  assert.deepEqual(main.sent, ['agent a off', 'agent review off', 'review off, seen on']);
  // The skill's row flashes on the Library; the agent's click was made on another page, said in the status bar, and flashes no row.
  assert.deepEqual([app.outcome?.text, flashRequests.has('skills-review'), flashRequests.has('agents-review')], ['review is off.', true, false]);
  // Back on Codex's Agents tab, an agent's click said there flashes the agent's row, not a skill's of its name.
  closeResult();
  Object.assign(app, { page: 'harnesses', harness: 'codex-cli', harnessTab: 'agents' });
  flip('notes', false, undefined, 'agents');
  await settled();
  await main.pass(did('notes', false, 'agents'));
  assert.deepEqual([app.outcome?.text, flashRequests.has('agents-notes'), flashRequests.has('skills-notes')], ['notes is off.', true, false]);
});

test('A click on Codex’s Agents tab that ends while Codex’s Skills tab is open is said in the status bar only: that header is the skills’', async () => {
  onLibrary();
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

test('A plugin’s skill named like your own: its switch’s click, and its Undo, ask for the plugin’s row’s flash, never your own’s', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'release-notes' }]);
  const key = 'issue-tracker@team/release-notes', theirs = `skills-${key}`;
  queueClick({ kind: 'skills', key, on: false }, 'release-notes', () => ({ kind: 'skills', items: ['release-notes'], rows: [{ kind: 'skills', key }], changes: [{ key: 'release-notes', on: false, except: [] }], said: 'release-notes is off in Claude Code.' }), () => false);
  await settled();
  await main.pass({ ...did('release-notes'), made: ['off-skills-release-notes'] });
  assert.deepEqual([flashRequests.has(theirs), flashRequests.has('skills-release-notes')], [true, false]);
  flashRequests.clear();
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, flashRequests.has(theirs), flashRequests.has('skills-release-notes')], ['Undone: release-notes is as before.', true, false]);
});

// ---------- Rows of several kinds in one result ----------

/**
 * A home whose library holds these items, Off as their clicks leave them (`on`: On, before a click), each with its row's facts
 * (`plugin`: a tool has it through a plugin too) and the History entry its Off made (`off-<kind>-<key>`, in this order, a second
 * apart): what an Undo decides its actions on (historyactions.ts libraryAction). `stopped`: a kind whose own record is damaged,
 * which stops its writes alone. Returns History's entries, which a test may change.
 */
function homeWith(t: TestContext, items: { kind: PageKind; key: string; plugin?: true }[], { stopped, on = false }: { stopped?: PageKind; on?: boolean } = {}) {
  const record = { 'skills': '', mcp: 'mcp:', agents: 'agent:' };
  const facts = (kind: PageKind) => items.filter(item => item.kind === kind).map(item => ({ key: item.key, name: item.key, copies: {}, ...(item.plugin ? { plugin: { 'claude-cli': { plugin: 'kit', marketplace: 'team' } } } : {}) }));
  const view = (kind: PageKind) => ({ tools: ['claude-cli', 'codex-cli'], items: facts(kind), notices: [], problems: [], unread: [], access: { allowed: true },
    gate: kind === stopped ? { state: 'stopped', reason: 'The MCP record is damaged. Nothing was written or deleted.' } : { state: 'ready' },
    library: Object.fromEntries(items.filter(item => item.kind === kind).map(item => [item.key, { ...newItem(item.key, item.key), on }])) });
  app.home = { home: '/home', label: 'Practice', sync: { managed: ['claude-cli', 'codex-cli'], caughtUp: [], access: { allowed: true }, gate: { state: 'ready' } },
    skills: view('skills'), mcp: view('mcp'), agents: view('agents') } as unknown as HomeView;
  const events = items.map((item, at) => ({ id: `off-${item.kind}-${item.key}`, key: `${record[item.kind]}${item.key}`, kind: 'off', at: new Date(Date.UTC(2026, 10, 18, 9, 0, at)).toISOString() }));
  t.mock.method(api, 'history', async () => ({ events, days: 30 }));
  return events;
}
/** What main did of one kind's click: `name` off in Claude Code, and the History entry its Off made. */
const offMade = (kind: PageKind, name: string): PassResult => ({ ...did(name, false, kind), made: [`off-${kind}-${name}`] });
/** A row of `kind` as the page draws it, On, in the tools named. */
const itemRow = (kind: PageKind, name: string, copies: Record<string, string> = { 'claude-cli': `${name}-1` }) => ({ kind, key: name, name, description: '', copies, on: true, except: [] });

test('Turn these off clicked on the Library, then History opened before it is done: its result and its Undo stay the Library’s', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  turnTheseOff([itemRow('skills', 'notes')]);
  await settled();
  showPage('history');
  app.home!.skills.library.notes!.on = false;
  await main.pass(offMade('skills', 'notes'));
  // Its result names the page it was clicked on, so History's header shows neither it nor its Undo (matrix.ts outcomeShown).
  assert.deepEqual([app.outcome?.page, app.outcome?.act?.label], ['library', 'Undo']);
});

test('Turn these off where one skill’s Off is refused as stale: the result says that one first, counts, names and flashes the one it turned off, and its Undo is about that one alone', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'skills', key: 'spare' }], { on: true });
  turnTheseOff([itemRow('skills', 'notes'), itemRow('skills', 'spare')]);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass({ results: [...did('notes').results, ...refusedAsStale('spare').results], writes: 1, reloads: [], made: ['off-skills-notes'] });
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, flashRequests.has('skills-notes'), flashRequests.has('skills-spare')],
    ['1 of 2 didn’t go through in every tool: spare. Turned off 1 skill with no use seen in the last 30 days: notes. Central Knot keeps it, and turning it on puts it back as it was.',
      ['spare changed since the page was read. Nothing was changed; read again.'], true, false]);
  // The result kept is about notes alone too: its names, which its band makes bold (matrix.ts outcomeBand), and its rows.
  assert.deepEqual([app.outcome?.items, app.outcome?.rows], [['notes'], [{ kind: 'skills', key: 'notes', name: 'notes' }]]);
  flashRequests.clear();
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([main.restored, app.outcome?.text, flashRequests.has('skills-notes'), flashRequests.has('skills-spare')], [['off-skills-notes'], 'Undone: notes is as before.', true, false]);
});

test('An Undo across kinds whose plugin switch can’t be turned back and whose agent’s entry is stopped names nothing as before', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'agents', key: 'review' }]);
  // A plugin's skill switched off in Claude Code; its Undo, turning it back on there, fails.
  let calls = 0;
  t.mock.method(api, 'setPluginSkill', async () => ({ reports: [calls++ ? report('failed', 'Couldn’t turn it on.') : report('skill-off', 'Turned off.')] }));
  t.mock.method(api, 'restore', async (id: string) => { main.restored.push(id); return { stopped: 'The agents record is damaged.', results: [], reloads: [] }; });
  queueClick({ kind: 'skills', key: 'bar', on: false }, 'bar', () => ({ kind: 'skills', items: ['bar'], rows: [{ kind: 'skills', key: 'bar' }], changes: [], said: 'bar is off in Claude Code.', pluginsOnly: true,
    plugins: { ops: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', skill: 'bar', action: 'skill-off' }] } }), () => false);
  flip('review', false, undefined, 'agents');
  await settled();
  await main.pass(offMade('agents', 'review'));
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, app.outcome?.warn], ['Not all of it could be undone.', true]);
});

test('An Undo started on the Library, then History opened before it is done: its confirmation stays the Library’s', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }]);
  flip('notes', false);
  await settled();
  await main.pass(offMade('skills', 'notes'));
  app.outcome!.act!.run();
  showPage('history');
  await settled();
  // Its result names the page it was started on (app.ts busy), so History's header doesn't show it (matrix.ts outcomeShown).
  assert.deepEqual([main.restored, app.outcome?.text, app.outcome?.page], [['off-skills-notes'], 'Undone: notes is as before.', 'library']);
});

test('Turn these off where every kind refuses: nothing is turned off; the result says first what didn’t go through, and each kind’s reason is a line led by its name', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'mcp', key: 'github' }], { on: true });
  turnTheseOff([itemRow('skills', 'notes'), itemRow('mcp', 'github')]);
  await settled();
  await main.pass({ stopped: 'The skills record is damaged.', results: [], writes: 0, reloads: [] });
  await main.pass({ stopped: 'The MCP record is damaged.', results: [], writes: 0, reloads: [] });
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.act, flashRequests.size],
    ['2 of 2 didn’t go through in every tool: notes and github. Nothing changed.', ['Skills: The skills record is damaged.', 'MCP servers: The MCP record is damaged.'], undefined, 0]);
});

test('An Undo one of whose History entries is gone says not all of it could be undone, and puts back the rest', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'skills', key: 'spare' }]);
  flip('notes', false);
  flip('spare', false);
  await settled();
  await main.pass(offMade('skills', 'notes'));
  await main.pass(offMade('skills', 'spare'));
  // The Undo is offered with both entries in History; spare's then goes from it (History's days pruned it, say) before the click.
  assert.equal(app.outcome?.act?.label, 'Undo');
  history.splice(history.findIndex(event => event.id === 'off-skills-spare'), 1);
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([main.restored, app.outcome?.text, app.outcome?.reasons, app.outcome?.warn],
    [['off-skills-notes'], 'Not all of it could be undone.', ['1 History entry it was to put back is no longer in History.'], true]);
});

test('A skill and an agent both named review, and a server, switched on one page: one run, three counted, each review with its kind, each row flashed, and one Undo puts back all three, newest first', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'review' }, { kind: 'agents', key: 'review' }, { kind: 'mcp', key: 'github' }]);
  // Three kinds clicked on the Library, one place whatever its segment: one run, whatever each row's kind.
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
  // The names it says, which its band makes bold, each review with its kind.
  assert.deepEqual(app.outcome?.items, ['review (skill)', 'review (agent)', 'github']);
  assert.deepEqual(['skills-review', 'agents-review', 'mcp-github'].map(id => flashRequests.has(id)), [true, true, true]);
  // Each kind's last result, which its problem lines are read from, holds its own clicks' results alone.
  assert.deepEqual((['skills', 'agents', 'mcp'] as const).map(kind => lastResult(kind)?.results.map(entry => entry.item)), [['review'], ['review'], ['github']]);
  flashRequests.clear();
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual(main.restored, ['off-mcp-github', 'off-agents-review', 'off-skills-review']);
  assert.equal(app.outcome?.text, 'Undone: review (skill), review (agent) and github are as before.');
  assert.deepEqual(['skills-review', 'agents-review', 'mcp-github'].map(id => flashRequests.has(id)), [true, true, true]);
});

test('Turn these off across kinds, from the No use seen chip: a skill only some tools have is turned off, an agent a plugin also brings is left to its row, a server whose record is damaged is skipped and named first, and the agents after it go on; Undo puts back what went', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'mcp', key: 'github' }, { kind: 'agents', key: 'planner' }, { kind: 'agents', key: 'reviewer', plugin: true }], { stopped: 'mcp', on: true });
  const notes = itemRow('skills', 'notes'), github = itemRow('mcp', 'github', { 'claude-cli': 'github-1', 'codex-cli': 'github-1' });
  const planner = itemRow('agents', 'planner', { 'claude-cli': 'planner-1', 'codex-cli': 'planner-1' }), reviewer = itemRow('agents', 'reviewer');
  // The chip's band hands Turn these off its rows but the agent a plugin also brings, which is left to its own row.
  const off = toTurnOff([planner, reviewer, github, notes]);
  assert.deepEqual(off.map(row => row.key), ['planner', 'github', 'notes']);
  // A row's controls ask their own kind's gate: the server's record stops servers only.
  assert.deepEqual([whyKindReadOnly(app.home!, 'mcp'), whyKindReadOnly(app.home!, 'skills'), whyReadOnly(app.home!)], ['The MCP record is damaged. Nothing was written or deleted.', undefined, undefined]);
  turnTheseOff(off);
  await settled();
  // Main turns each off; the home as it reads then has it Off, which its Undo is decided on.
  app.home!.skills.library.notes!.on = app.home!.agents.library.planner!.on = false;
  await main.pass(offMade('skills', 'notes'));
  // Kind by kind, in turn: the servers' click goes once the skills' is done, and main refuses it; the agents' goes after it.
  await main.pass({ stopped: 'The MCP record is damaged. Nothing was written or deleted.', results: [], writes: 0, reloads: [] });
  await main.pass(offMade('agents', 'planner'));
  assert.deepEqual(main.sent, ['notes off, seen on', 'server github off', 'agent planner off']);
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn, app.outcome?.act?.label],
    ['1 of 3 didn’t go through in every tool: github. Turned off 2 items with no use seen in the last 30 days: notes and planner. Central Knot keeps them, and turning one on puts it back as it was.',
      ['MCP servers: The MCP record is damaged. Nothing was written or deleted.'], true, 'Undo']);
  app.outcome!.act!.run();
  await settled();
  // Each entry's Undo puts its item back in the tools it had, and only those: tests/undo.test.ts, on real files.
  assert.deepEqual([main.restored, app.outcome?.text], [['off-agents-planner', 'off-skills-notes'], 'Undone: notes and planner are as before.']);
});

test('Turn these off with a skill and an agent of one name, the skill kept back by a tool: the lead names it by its kind, and the sentence after it names only what went through', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'review' }, { kind: 'agents', key: 'review' }], { on: true });
  turnTheseOff([itemRow('skills', 'review'), itemRow('agents', 'review')]);
  await settled();
  app.home!.skills.library.review!.on = app.home!.agents.library.review!.on = false;
  await main.pass({ ...partly('review'), made: ['off-skills-review'] });
  await main.pass(offMade('agents', 'review'));
  assert.equal(app.outcome?.text, '1 of 2 didn’t go through in every tool: review (skill). Turned off 1 agent with no use seen in the last 30 days: review. Central Knot keeps it, and turning it on puts it back as it was.');
});

test('Turn these off where every row it turned off is kept back by a tool: the lead names them, the sentence after it counts them', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'skills', key: 'spare' }], { on: true });
  turnTheseOff([itemRow('skills', 'notes'), itemRow('skills', 'spare')]);
  await settled();
  app.home!.skills.library.notes!.on = app.home!.skills.library.spare!.on = false;
  await main.pass({ results: [...partly('notes').results, ...partly('spare').results], writes: 2, reloads: [], made: ['off-skills-notes', 'off-skills-spare'] });
  assert.equal(app.outcome?.text, '2 of 2 didn’t go through in every tool: notes and spare. Both are off.');
});

test('Turn these off where one refreshed skill still loads in Codex from another copy: the result says Codex still reads that one another way, and leaves out the one with no other copy', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'spare' }, { kind: 'skills', key: 'standup' }], { on: true });
  const codexShared = {
    anotherWay: { 'codex-cli': 'Codex reads a copy in ~/.agents/skills, which is not Central Knot’s.' },
    loads: { 'codex-cli': { folder: 'spare', name: 'spare', skillFile: '/home/.agents/skills/spare/SKILL.md', switchedOff: false } },
  };
  t.mock.method(api, 'refresh', async () => ({
    ...app.home!,
    skills: {
      ...app.home!.skills,
      items: [{ key: 'spare', name: 'spare', copies: {}, ...codexShared }, { key: 'standup', name: 'standup', copies: {} }] as unknown as HomeView['skills']['items'],
      library: { spare: { ...newItem('spare', 'spare'), on: false }, standup: { ...newItem('standup', 'standup'), on: false } },
    },
  }));
  turnTheseOff([itemRow('skills', 'spare'), itemRow('skills', 'standup')]);
  await settled();
  await main.pass({ results: [...did('spare').results, ...did('standup').results], writes: 2, reloads: [], made: ['off-skills-spare', 'off-skills-standup'] });
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.outcome?.reasons, app.outcome?.act?.label],
    ['Turned off 2 skills with no use seen in the last 30 days: spare and standup. Codex still reads spare another way. Central Knot keeps them, and turning one on puts it back as it was.', false, [], 'Undo']);
});

test('Turn these off where a kind with a shared skill is refused and an MCP server goes through: only rows Off afterwards get the still-read sentence', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'spare' }, { kind: 'mcp', key: 'github' }], { stopped: 'skills', on: true });
  app.home!.skills.items = [{
    key: 'spare', name: 'spare', copies: {},
    anotherWay: { 'codex-cli': 'Codex reads a copy in ~/.agents/skills, which is not Central Knot’s.' },
    loads: { 'codex-cli': { folder: 'spare', name: 'spare', skillFile: '/home/.agents/skills/spare/SKILL.md', switchedOff: false } },
  }] as unknown as HomeView['skills']['items'];
  turnTheseOff([itemRow('skills', 'spare'), itemRow('mcp', 'github')]);
  await settled();
  await main.pass({ stopped: 'The skills record is damaged. Nothing was written or deleted.', results: [], writes: 0, reloads: [] });
  app.home!.mcp.library.github!.on = false;
  await main.pass(offMade('mcp', 'github'));
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn, app.outcome?.act?.label],
    ['1 of 2 didn’t go through in every tool: spare. Turned off 1 MCP server with no use seen in the last 30 days: github. Central Knot keeps it, and turning it on puts it back as it was.',
      ['Skills: The skills record is damaged. Nothing was written or deleted.'], true, 'Undo']);
  // Even if a kind went through, a row that is On again in the refreshed view does not get the still-read sentence.
  app.home!.skills.gate = { state: 'ready' };
  turnTheseOff([itemRow('skills', 'spare'), itemRow('mcp', 'github')]);
  await settled();
  await main.pass(offMade('skills', 'spare'));
  app.home!.mcp.library.github!.on = false;
  await main.pass(offMade('mcp', 'github'));
  assert.equal(app.outcome?.text, 'Turned off 2 items with no use seen in the last 30 days: spare and github. Central Knot keeps them, and turning one on puts it back as it was.');
});

test('An Undo across kinds whose agent’s entry is stopped: the agents’ entries before it are left, the skill’s and the server’s still go back, and it says so, the stop led by its kind', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'review' }, { kind: 'agents', key: 'review' }, { kind: 'agents', key: 'notes' }, { kind: 'mcp', key: 'github' }]);
  const stop = 'The agents record is damaged. Nothing was written or deleted.';
  t.mock.method(api, 'restore', async (id: string) => { main.restored.push(id); return id === 'off-agents-notes' ? { stopped: stop, results: [], reloads: [] } : { results: [], reloads: [] }; });
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
  assert.deepEqual([app.outcome?.text, app.outcome?.reasons, app.outcome?.warn], ['Not all of it could be undone; review (skill) and github are as before.', [`Agents: ${stop}`], true]);
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
    onLibrary();
    flip('a', false);
    await settled();
    await main.pass(refusedAsStale('a'));
    mock.timers.tick(8000);
    assert.equal(app.outcome?.text, 'Didn’t go through in every tool: a changed since the page was read. Nothing was changed; read again.');
    flip('b', false);
    await settled();
    await main.pass(did('b'));
    assert.deepEqual([app.outcome?.text, app.outcome?.reasons], ['b is off.', []]);
  } finally { mock.timers.reset(); }
});

test('× ends the run: its clicks still waiting go on as a run of their own, whose result names only them', async () => {
  onLibrary();
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

test('Another page opened and left while a run is carried out does not end it: the run is said whole, and its one Undo puts back all of it', async t => {
  onLibrary();
  homeWith(t, ['a', 'b', 'c'].map(key => ({ kind: 'skills', key })));
  for (const name of ['a', 'b', 'c']) flip(name, false);
  await settled();
  await main.pass(offMade('skills', 'a'));
  showPage('history');
  showPage('library');
  await main.pass(offMade('skills', 'b'));
  await main.pass(offMade('skills', 'c'));
  assert.equal(app.outcome?.text, '3 skills are off: a, b and c.');
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual(main.restored, ['off-skills-c', 'off-skills-b', 'off-skills-a']);
});

test('A run left for another page: its result is said in the status bar, never in the header of the page open', async () => {
  onLibrary();
  flip('a', false);
  await settled();
  showPage('history');
  await main.pass(did('a'));
  assert.deepEqual([app.outcome, app.said.text], [undefined, 'a is off.']);
});

test('A result with no problem goes 8 seconds after the run’s last click has finished; one with a problem line stays', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    onLibrary();
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
    assert.equal(app.outcome?.text, 'Didn’t go through in every tool: c changed since the page was read. Nothing was changed; read again.');
  } finally { mock.timers.reset(); }
});

test('A result whose time runs out while a later click runs stays, and that click joins its run', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    onLibrary();
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

test('A background problem closed with its × is remembered by its kind too: a skill’s and an agent’s of one name and reason are two', () => {
  const failed = { item: 'review', harness: 'claude-cli', outcome: 'failed', message: 'Could not write.' } as const;
  assert.notEqual(problemKey({ ...failed, of: 'skills' }), problemKey({ ...failed, of: 'agents' }));
});

test('× on an item list’s result closes what its click could not do too', () => {
  start();
  app.outcome = { page: 'library', text: 'docs is on in Claude Code.' } as typeof app.outcome;
  app.mcpResult = { results: [{ item: 'docs', harness: 'codex-cli', outcome: 'failed', message: 'Could not write.' }], writes: 0 } as unknown as typeof app.mcpResult;
  closeResult();
  assert.deepEqual([app.outcome, app.mcpResult], [undefined, undefined]);
});

test('a tool left out names the harness list even before the old selection clears', async () => {
  start();
  const { fullPlace } = await import('../src/places.ts');
  Object.assign(app, { page: 'harnesses', harness: 'codex-cli', harnessTab: 'skills' });
  assert.deepEqual(fullPlace(), { page: 'harnesses' });
});

/** Render just the history record and capture the window command listener on the stand-in page. */
async function watchTravel(t: TestContext) {
  const { listenForTravel, recordDraw } = await import('../src/places.ts');
  let navigate!: (command: string) => void;
  t.mock.method(window.centralKnot, 'onNavigate', (callback: typeof navigate) => { navigate = callback; });
  t.mock.method(document, 'getElementById', (id: string) => id === 'announcement' ? announcement : { ...element(), scrollTo() {} });
  listenForTravel();
  // A draw over a page with no scrolling areas.
  const draw = () => recordDraw(new Map());
  setRenderer(draw);
  t.after(() => setRenderer(() => {}));
  return { navigate, recordDraw: draw };
}

test('Back returns to the MCP explanation tab of a tool absent from the MCP view', async t => {
  start();
  homeWith(t, []);
  app.home!.mcp.tools = ['claude-cli'];
  Object.assign(app, { page: 'harnesses', harness: undefined });
  const { goHarness } = await import('../src/harnesspage.ts');
  const { navigate, recordDraw } = await watchTravel(t);
  recordDraw();
  await settled();
  goHarness('codex-cli', 'mcp');
  await settled();
  goHarness('codex-cli', 'about');
  await settled();
  navigate('browser-backward');
  assert.equal(app.harnessTab, 'mcp');
});

for (const stale of [false, true]) test(`a plugin link left during a read returns by marketplace name (catalog ${stale ? 'stale' : 'unread'})`, async t => {
  start();
  homeWith(t, []);
  app.home!.home = stale ? '/stale-catalog' : '/unread-catalog';
  const { navigate } = await watchTravel(t);
  const { fullPlace } = await import('../src/places.ts');
  const beta = { ...entry, source: '/beta', name: 'Beta' };
  const catalog = { ...view, marketplaces: [entry, beta] };
  let finishRead!: (v: PluginsView) => void;
  t.mock.method(api, 'plugins', () => new Promise<PluginsView>(resolve => { finishRead = resolve; }));
  const { loadPlugins } = await import('../src/pluginstate.ts');
  market.read.data = stale ? view : undefined; // The old catalog lists gamma only in the other marketplace.
  market.nav = { source: '/alternate-spelling', marketName: 'Beta', plugin: 'gamma', tab: 'plugins', find: '' };
  const first = loadPlugins();
  await settled();
  assert.equal(fullPlace().marketName, 'Beta');
  showPage('history');
  await settled();
  const finishFirst = finishRead;
  if (stale) navigate('browser-backward');
  finishFirst(catalog);
  await first;
  if (!stale) navigate('browser-backward');
  finishRead(catalog);
  await settled();
  const { source, plugin } = fullPlace();
  assert.deepEqual([source, plugin], ['/beta', 'gamma']);
});

test('Reload advice settles on final state across one run and its combined Undo (Item 1a: On then Off, then Undo)', async t => {
  onLibrary();
  const events = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: false });
  events.splice(0, events.length,
    { id: 'on-skills-notes', key: 'notes', kind: 'on', at: '2026-11-21T10:00:00.000Z' },
    { id: 'off-skills-notes', key: 'notes', kind: 'off', at: '2026-11-21T10:00:01.000Z' });
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    // Undo replays newest first: undoing Off writes the skill, then undoing On removes it again.
    return id === 'off-skills-notes'
      ? { results: [], reloads: [{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: true }, { tool: 'codex-cli', kind: 'skill', key: 'notes', on: true }] }
      : { results: [], reloads: [{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: false }, { tool: 'codex-cli', kind: 'skill', key: 'notes', on: false }] };
  });
  onNow.set(rowId('skills', 'notes'), false);
  flip('notes', true);
  await settled();
  app.home!.skills.library.notes!.on = true;
  onNow.set(rowId('skills', 'notes'), true);
  await main.pass({ results: [{ item: 'notes', harness: 'pi-cli', outcome: 'written', message: '' }], writes: 1, made: ['on-skills-notes'], reloads: [{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: true }, { tool: 'codex-cli', kind: 'skill', key: 'notes', on: true }] });
  assert.deepEqual(app.outcome?.reloads?.map(each => each.tool), ['pi-cli', 'codex-cli']);
  flip('notes', false);
  await settled();
  app.home!.skills.library.notes!.on = false;
  onNow.set(rowId('skills', 'notes'), false);
  await main.pass({ results: [{ item: 'notes', harness: 'pi-cli', outcome: 'removed', message: '' }], writes: 1, made: ['off-skills-notes'], reloads: [{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: false }, { tool: 'codex-cli', kind: 'skill', key: 'notes', on: false }] });
  assert.equal(app.outcome?.reloads, undefined, 'turning Off in the same run cancels the earlier On reload advice');
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual(main.restored, ['off-skills-notes', 'on-skills-notes']);
  assert.equal(app.outcome?.reloads, undefined, 'combined Undo of On then Off ends back at Off and advises nothing');
});

test('Plugin runReloads settles tick Pi, tick OpenCode, untick Pi in one run to OpenCode only (Item 1b)', async () => {
  start();
  resetMarket();
  const step = (tool: 'pi-cli' | 'opencode-cli', on: boolean): PluginTurnResult => ({
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool, action: on ? 'install-items' : 'remove-items',
      report: { tool, outcome: on ? 'installed' : 'uninstalled', changed: true, message: on ? 'Installed.' : 'Removed.', runs: [],
        reloads: [{ tool, kind: 'skill', key: 'helper', on, plugin: 'alpha@team' }] } }],
    before: null, back: [],
  });
  turnPlugin(entry, 'alpha', 'on', 'pi-cli');
  turnPlugin(entry, 'alpha', 'on', 'opencode-cli');
  turnPlugin(entry, 'alpha', 'off', 'pi-cli');
  await settled();
  await main.answer(step('pi-cli', true));
  await main.answer(step('opencode-cli', true));
  await main.answer(step('pi-cli', false));
  assert.deepEqual(runReloads().items.map(item => [item.tool, item.chip]), [['opencode-cli', 'OpenCode: opencode --continue']]);
});

test('Resume with empty click.changes preserves confirmed writes from its pass for reload advice (Short list 1b)', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  applyClick({ kind: 'skills', changes: [], items: [], rows: [], said: 'Resumed: sync carries on from the record as it is.' });
  await settled();
  await main.pass({ results: [{ item: 'notes', harness: 'pi-cli', outcome: 'written', message: 'Added.' }], writes: 1, reloads: [{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: true }] });
  assert.deepEqual(app.outcome?.reloads, [{ tool: 'pi-cli', kind: 'skill', key: 'notes', on: true }]);
});

test('A refused profile Undo says that nothing was undone, naming the profile, without doubling it on a gate refusal', async t => {
  start();
  const events = homeWith(t, []);
  (events as unknown[]).splice(0, events.length, { id: 'sw-1', kind: 'profile', item: 'PluginOnly', at: '2026-11-21T00:00:00.000Z',
    profile: { toName: 'PluginOnly', on: [], off: [], copilotCleared: [{ id: 'mcp:issues', name: 'issues', server: 'issues' }] } });
  app.page = 'profiles';
  let reply: { results: never[]; stopped?: string; harnessWrites: number; reloads: never[] } = {
    stopped: 'Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.',
    results: [], harnessWrites: 0, reloads: [],
  };
  t.mock.method(api, 'restore', async () => reply);
  await restoreEvent('sw-1');
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.outcome?.refused, app.outcome?.history],
    ['Undo switch to PluginOnly: nothing was undone. Copilot CLI’s off-switch for “issues” was left off: a server of yours has that name there now.', true, true, true]);
  reply = { stopped: 'Automatic sync is paused. Nothing was undone.', results: [], harnessWrites: 0, reloads: [] };
  await restoreEvent('sw-1');
  assert.equal(app.outcome?.text, 'Undo switch to PluginOnly: nothing was undone. Automatic sync is paused.');
});

test('A menu-bar profile switch waits while the page is busy, then lands its view, result and follow-ups once the action ends', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  const afterView = { ...app.home!, label: 'AfterMenu', profiles: { profiles: [], plugins: [] } } as unknown as HomeView;
  const switchResult: ProfileSwitchResult = { name: 'Focus', on: ['notes'], off: [], left: [], results: [], event: 'sw-menu',
    profile: { toName: 'Focus', on: [{ id: 'skill:notes', name: 'notes' }], off: [] }, view: afterView, reloads: [] };
  flip('notes', false);
  await settled();
  try {
    assert.ok(acting());
    main.profileSwitched(switchResult);
    await settled();
    assert.notEqual(app.home?.label, 'AfterMenu');
    assert.equal(app.outcome?.text, undefined);
    app.page = 'sources';
    await main.pass(did('notes'));
    await settled();
    assert.deepEqual([app.home?.label, app.outcome?.text, main.followUps.sources], ['AfterMenu', 'Switched to Focus: 1 item turned on.', 1]);
  } finally { while (main.passes.length) await main.pass(did('notes')); }
});

test('A menu-bar profile switch whose view brings a fresh sync notice announces “Sync changed” while keeping the switch’s result', async t => {
  const home = backgroundWhileReading(t);
  const notice: ItemNotice = { kind: 'deleted-by-hand', key: 'notes', item: 'notes', history: 'menu-deletion',
    winner: 'copilot-cli', losers: [], orderProved: true };
  const withNotice = { ...home, skills: { ...home.skills, notices: [notice] }, mcp: { ...home.mcp, library: {} }, agents: { ...home.agents, library: {} },
    profiles: { profiles: [], plugins: [] } } as unknown as HomeView;
  main.profileSwitched({ name: 'Focus', on: ['notes'], off: [], left: [], results: [], event: 'sw-notice',
    profile: { toName: 'Focus', on: [{ id: 'skill:notes', name: 'notes' }], off: [] }, view: withNotice, reloads: [] });
  await settled();
  assert.deepEqual([app.said.text, app.said.notices, app.outcome?.text],
    ['Sync changed notes.', ['menu-deletion'], 'Switched to Focus: 1 item turned on.']);
});

test('A result that lands while the window is hidden does not fade until the window shows again', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    onLibrary();
    homeWith(t, [{ kind: 'skills', key: 'notes' }]);
    const afterView = { ...app.home!, profiles: { profiles: [], plugins: [] } } as unknown as HomeView;
    (document as unknown as { hidden: boolean }).hidden = true;
    main.visibilityChange();
    main.profileSwitched({ name: 'Focus', on: ['notes'], off: [], left: [], results: [], event: 'sw-hidden',
      profile: { toName: 'Focus', on: [{ id: 'skill:notes', name: 'notes' }], off: [] }, view: afterView, reloads: [] });
    await settled();
    mock.timers.tick(60_000);
    assert.equal(app.outcome?.text, 'Switched to Focus: 1 item turned on.');
    (document as unknown as { hidden: boolean }).hidden = false;
    main.visibilityChange();
    mock.timers.tick(7999);
    assert.equal(app.outcome?.text, 'Switched to Focus: 1 item turned on.');
    mock.timers.tick(1);
    assert.equal(app.outcome?.text, undefined);
  } finally {
    (document as unknown as { hidden: boolean }).hidden = false;
    mock.timers.reset();
  }
});

test('A clean profile Undo confirmation fades on Profiles as other Undo confirmations do; a warning, refusal or switch result stays', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    start();
    const events = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
    const outcome = () => app.outcome;
    (events as unknown[]).splice(0, events.length, { id: 'sw-2', kind: 'profile', item: 'Focus', at: '2026-11-21T00:00:00.000Z',
      profile: { toName: 'Focus', on: [{ id: 'skill:notes', name: 'notes' }], off: [] } });
    app.page = 'profiles';
    let reply: { results: never[]; harnessWrites: number; stopped?: string; switched?: { on: string[]; off: string[]; left: string[] }; reloads: never[] } = { results: [], harnessWrites: 1, switched: { on: [], off: ['notes'], left: [] }, reloads: [] };
    t.mock.method(api, 'restore', async () => reply);
    await restoreEvent('sw-2');
    assert.deepEqual([outcome()?.text, outcome()?.fade], ['Undone: 1 item turned off.', true]);
    mock.timers.tick(7999);
    assert.equal(outcome()?.text, 'Undone: 1 item turned off.');
    mock.timers.tick(1);
    assert.equal(outcome(), undefined);
    reply = { results: [], harnessWrites: 0, switched: { on: [], off: ['notes'], left: ['standup'] }, reloads: [] };
    await restoreEvent('sw-2');
    mock.timers.tick(60_000);
    assert.equal(outcome()?.warn, true);
    assert.match(outcome()?.text ?? '', /^Undone:/);
    reply = { stopped: 'Automatic sync is paused. Nothing was undone.', results: [], harnessWrites: 0, reloads: [] };
    await restoreEvent('sw-2');
    mock.timers.tick(60_000);
    assert.equal(outcome()?.refused, true);
    const afterView = { ...app.home!, profiles: { profiles: [], plugins: [] } } as unknown as HomeView;
    main.profileSwitched({ name: 'Focus', on: ['notes'], off: [], left: [], results: [], event: 'sw-2',
      profile: { toName: 'Focus', on: [{ id: 'skill:notes', name: 'notes' }], off: [] }, view: afterView, reloads: [] });
    await settled();
    mock.timers.tick(60_000);
    assert.deepEqual([outcome()?.text, outcome()?.act?.label], ['Switched to Focus: 1 item turned on.', 'Undo switch']);
  } finally { mock.timers.reset(); }
});

// ---------- Results that say what happened: queued Add waiting for a choice, and superseded Undo problems ----------

test('A queued Add whose copies differ on disk says the copy question alone and runs no plugin switches', async t => {
  onLibrary();
  linkedHome(['a'], []);
  const pluginCalls = t.mock.method(api, 'setPluginSkill', async () => ({ reports: [report('skill-off', 'Turned off.')] }));
  queueClick({ kind: 'skills', key: 'draft', on: true }, 'draft', () => ({
    kind: 'skills', items: ['draft'], rows: [{ kind: 'skills', key: 'draft' }],
    changes: [{ key: 'draft', on: true, except: [], seenOn: false }],
    said: () => 'draft is in Central Knot now, and on in all 3 tools.',
    also: ['A plugin note that should not appear before a choice.'],
    plugins: { ops: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', skill: 'draft', action: 'skill-on' }], said: 'Turned on alpha.' },
  }), () => false);
  await settled();
  await main.pass(waitsForChoice);
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.outcome?.reasons, app.outcome?.act, pluginCalls.mock.callCount()],
    ['draft has differing copies. Choose which copy every tool uses.', false, undefined, undefined, 0]);
});

test('A run of three clicks (an On, a queued Add whose copies differ, an Off): the On and Off are counted, the Add’s wait is said once, and its plugin switches do not run', async t => {
  onLibrary();
  linkedHome(['a', 'b'], []);
  onNow.set(rowId('skills', 'a'), false);
  onNow.set(rowId('skills', 'b'), true);
  const pluginCalls = t.mock.method(api, 'setPluginSkill', async () => ({ reports: [report('skill-off', 'Turned off.')] }));
  flip('a', true);
  queueClick({ kind: 'skills', key: 'draft', on: true }, 'draft', () => ({
    kind: 'skills', items: ['draft'], rows: [{ kind: 'skills', key: 'draft' }],
    changes: [{ key: 'draft', on: true, except: [], seenOn: false }],
    said: () => 'draft is in Central Knot now, and on in all 3 tools.',
    plugins: { ops: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', skill: 'draft', action: 'skill-on' }], said: 'Turned on alpha.' },
  }), () => false);
  flip('b', false);
  await settled();
  await main.pass(did('a', true));
  await main.pass(waitsForChoice);
  await main.pass(did('b', false));
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.outcome?.reasons, pluginCalls.mock.callCount()],
    ['1 skill is off: b; 1 skill is on: a. draft has differing copies. Choose which copy every tool uses.', false, [], 0]);
});

test('An Undo after two clicks on one item drops an earlier tool failure once a later restore of that item puts it right', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  history.push({ id: 'on-skills-notes', key: 'notes', kind: 'on', at: '2026-11-18T09:00:02.000Z' });
  const claudeFail = { item: 'notes', harness: 'claude-cli' as const, outcome: 'failed' as const, removal: true, message: 'Could not remove Claude Code’s copy yet. Central Knot will try again.' };
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    if (id === 'on-skills-notes') {
      app.home!.skills.library.notes!.on = false;
      return { results: [{ item: 'notes', harness: 'codex-cli' as const, outcome: 'removed' as const, message: '' }, claudeFail], reloads: [] };
    }
    // Turning notes back On finds Claude Code already holding the current version, so restore emits no result for Claude Code.
    app.home!.skills.library.notes!.on = true;
    return { results: [{ item: 'notes', harness: 'codex-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] };
  });
  flip('notes', false);
  flip('notes', true);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass({ results: [{ item: 'notes', harness: 'codex-cli', outcome: 'removed', message: '' }, claudeFail], writes: 1, made: ['off-skills-notes'], reloads: [] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes'] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([main.restored, app.outcome?.text, app.outcome?.warn, app.outcome?.reasons, app.skillsResult?.results.filter(keptBack)],
    [['on-skills-notes', 'off-skills-notes'], 'Undone: notes is as before.', false, [], []]);
});

test('An Undo keeps an earlier tool failure when the refreshed view still shows that tool unsettled', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  history.push({ id: 'on-skills-notes', key: 'notes', kind: 'on', at: '2026-11-18T09:00:02.000Z' });
  const claudeFail = { item: 'notes', harness: 'claude-cli' as const, outcome: 'failed' as const, removal: true, message: 'Could not remove Claude Code’s copy yet. Central Knot will try again.' };
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    if (id === 'on-skills-notes') return { results: [claudeFail], reloads: [] };
    // The refreshed view still owes a removal in Claude Code, so the earlier failure was not put right.
    (app.home!.skills.items[0] as unknown as { plan: { write: string[]; remove: string[] } }).plan = { write: [], remove: ['claude-cli'] };
    return { results: [], reloads: [] };
  });
  flip('notes', false);
  flip('notes', true);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass({ results: [claudeFail], writes: 1, made: ['off-skills-notes'], reloads: [] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes'] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.skillsResult?.results.filter(keptBack).map(entry => [entry.item, entry.harness])],
    ['Not all of notes could be put back.', true, [['notes', 'claude-cli']]]);
});

test('A real failure at Undo stays warned and names the tool and copy', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  const claudeFail = { item: 'notes', harness: 'claude-cli' as const, outcome: 'failed' as const, removal: true, message: 'Could not remove Claude Code’s copy yet. Central Knot will try again.' };
  t.mock.method(api, 'restore', async (id: string) => { main.restored.push(id); return { results: [claudeFail], reloads: [] }; });
  flip('notes', false);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass(offMade('skills', 'notes'));
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.skillsResult?.results.filter(keptBack)],
    ['Not all of notes could be put back.', true, [claudeFail]]);
});

test('An Undo over two different items warns only about the one that truly could not be undone', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'skills', key: 'spare' }], { on: true });
  history.push({ id: 'on-skills-notes', key: 'notes', kind: 'on', at: '2026-11-18T09:00:05.000Z' });
  const failFor = (item: string) => ({ item, harness: 'claude-cli' as const, outcome: 'failed' as const, removal: true, message: 'Could not remove Claude Code’s copy yet. Central Knot will try again.' });
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    if (id === 'on-skills-notes') return { results: [failFor('notes')], reloads: [] };
    if (id === 'off-skills-notes') return { results: [{ item: 'notes', harness: 'codex-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] };
    return { results: [failFor('spare')], reloads: [] };
  });
  flip('spare', false);
  flip('notes', false);
  flip('notes', true);
  await settled();
  app.home!.skills.library.spare!.on = false;
  await main.pass(offMade('skills', 'spare'));
  app.home!.skills.library.notes!.on = false;
  await main.pass({ results: [failFor('notes')], writes: 1, made: ['off-skills-notes'], reloads: [] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes'] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.skillsResult?.results.filter(keptBack).map(entry => [entry.item, entry.harness])],
    ['Not all of spare could be put back.', true, [['spare', 'claude-cli']]]);
});

test('An Undo whose two restores of one item both fail in the same tool keeps only the latest failure', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  history.push({ id: 'on-skills-notes', key: 'notes', kind: 'on', at: '2026-11-18T09:00:02.000Z' });
  const firstFail = { item: 'notes', harness: 'claude-cli' as const, outcome: 'failed' as const, removal: true, message: 'First failure.' };
  const secondFail = { item: 'notes', harness: 'claude-cli' as const, outcome: 'held' as const, message: 'Second failure.' };
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    return { results: [id === 'on-skills-notes' ? firstFail : secondFail], reloads: [] };
  });
  flip('notes', false);
  flip('notes', true);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass({ ...did('notes', false), made: ['off-skills-notes'] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes'] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.skillsResult?.results.filter(keptBack)],
    ['Not all of notes could be put back.', true, [secondFail]]);
});

test('An Undo after a single Off warns and names a tool whose locked folder left its copy missing even when restore emitted no result', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  app.home!.sync.managed = ['claude-cli', 'copilot-cli', 'codex-cli'];
  app.home!.skills.tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
  const copilotLocked = 'Copilot CLI’s skills folder can’t be written, so Central Knot can’t change the skill there.';
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    app.home!.skills.library.notes!.on = true;
    app.home!.skills.items[0]!.cannot = { 'copilot-cli': copilotLocked };
    // Locked folder holding no file is `held` in librarypass.ts, so restore emits no DestinationResult for Copilot CLI.
    return { results: [{ item: 'notes', harness: 'claude-cli' as const, outcome: 'written' as const, message: '' }, { item: 'notes', harness: 'codex-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] };
  });
  flip('notes', false);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass(offMade('skills', 'notes'));
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.skillsResult?.results.filter(keptBack).map(entry => [entry.item, entry.harness, entry.message])],
    ['Not all of notes could be put back.', true, [['notes', 'copilot-cli', copilotLocked]]]);
});

test('An Undo after three alternating clicks drops Claude Code’s settled failure and warns about Copilot CLI’s missing copy', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  app.home!.sync.managed = ['claude-cli', 'copilot-cli', 'codex-cli'];
  app.home!.skills.tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
  history.push(
    { id: 'on-skills-notes-2', key: 'notes', kind: 'on', at: '2026-11-18T09:00:02.000Z' },
    { id: 'off-skills-notes-3', key: 'notes', kind: 'off', at: '2026-11-18T09:00:03.000Z' },
  );
  const claudeFail = { item: 'notes', harness: 'claude-cli' as const, outcome: 'failed' as const, removal: true, message: 'Could not remove Claude Code’s copy yet.' };
  const copilotLocked = 'Copilot CLI’s skills folder can’t be written, so Central Knot can’t change the skill there.';
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    if (id === 'off-skills-notes-3') { app.home!.skills.library.notes!.on = true; return { results: [{ item: 'notes', harness: 'codex-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] }; }
    if (id === 'on-skills-notes-2') { app.home!.skills.library.notes!.on = false; return { results: [{ item: 'notes', harness: 'codex-cli' as const, outcome: 'removed' as const, message: '' }, claudeFail], reloads: [] }; }
    app.home!.skills.library.notes!.on = true;
    app.home!.skills.items[0]!.cannot = { 'copilot-cli': copilotLocked };
    return { results: [{ item: 'notes', harness: 'codex-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] };
  });
  flip('notes', false);
  flip('notes', true);
  flip('notes', false);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass({ results: [claudeFail], writes: 1, made: ['off-skills-notes'], reloads: [] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes-2'] });
  app.home!.skills.library.notes!.on = false;
  await main.pass({ results: [claudeFail], writes: 1, made: ['off-skills-notes-3'], reloads: [] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([main.restored, app.outcome?.text, app.outcome?.warn, app.skillsResult?.results.filter(keptBack).map(entry => [entry.item, entry.harness, entry.message])],
    [['off-skills-notes-3', 'on-skills-notes-2', 'off-skills-notes'], 'Not all of notes could be put back.', true, [['notes', 'copilot-cli', copilotLocked]]]);
});

test('An Undo after four alternating clicks drops Copilot CLI’s settled failure and warns about Claude Code’s missing copy', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  app.home!.sync.managed = ['claude-cli', 'copilot-cli', 'codex-cli'];
  app.home!.skills.tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
  history.push(
    { id: 'on-skills-notes-2', key: 'notes', kind: 'on', at: '2026-11-18T09:00:02.000Z' },
    { id: 'off-skills-notes-3', key: 'notes', kind: 'off', at: '2026-11-18T09:00:03.000Z' },
    { id: 'on-skills-notes-4', key: 'notes', kind: 'on', at: '2026-11-18T09:00:04.000Z' },
  );
  const copilotFail = { item: 'notes', harness: 'copilot-cli' as const, outcome: 'failed' as const, removal: true, message: 'Could not remove Copilot CLI’s copy yet.' };
  const claudeLocked = 'Claude Code’s skills folder can’t be written, so Central Knot can’t change the skill there.';
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    if (id === 'on-skills-notes-4') { app.home!.skills.library.notes!.on = false; return { results: [{ item: 'notes', harness: 'claude-cli' as const, outcome: 'removed' as const, message: '' }], reloads: [] }; }
    if (id === 'off-skills-notes-3') { app.home!.skills.library.notes!.on = true; return { results: [{ item: 'notes', harness: 'copilot-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] }; }
    if (id === 'on-skills-notes-2') { app.home!.skills.library.notes!.on = false; return { results: [copilotFail], reloads: [] }; }
    app.home!.skills.library.notes!.on = true;
    app.home!.skills.items[0]!.cannot = { 'claude-cli': claudeLocked };
    return { results: [{ item: 'notes', harness: 'codex-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] };
  });
  flip('notes', false);
  flip('notes', true);
  flip('notes', false);
  flip('notes', true);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass({ ...did('notes', false), made: ['off-skills-notes'] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes-2'] });
  app.home!.skills.library.notes!.on = false;
  await main.pass({ ...did('notes', false), made: ['off-skills-notes-3'] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes-4'] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([main.restored, app.outcome?.text, app.outcome?.warn, app.skillsResult?.results.filter(keptBack).map(entry => [entry.item, entry.harness, entry.message])],
    [['on-skills-notes-4', 'off-skills-notes-3', 'on-skills-notes-2', 'off-skills-notes'], 'Not all of notes could be put back.', true, [['notes', 'claude-cli', claudeLocked]]]);
});

test('An Undo does not warn about a tool that holds an MCP server through a plugin', async t => {
  onLibrary();
  homeWith(t, [{ kind: 'mcp', key: 'issues' }], { on: true });
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    app.home!.mcp.library.issues!.on = true;
    app.home!.mcp.items[0]!.plugin = { 'codex-cli': { plugin: 'kit', marketplace: 'team' } };
    app.home!.mcp.items[0]!.cannot = { 'codex-cli': 'Codex has this MCP server through plugin kit.' };
    return { results: [{ item: 'issues', harness: 'claude-cli' as const, outcome: 'written' as const, message: '' }], reloads: [] };
  });
  flip('issues', false, undefined, 'mcp');
  await settled();
  app.home!.mcp.library.issues!.on = false;
  await main.pass(offMade('mcp', 'issues'));
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.text, app.outcome?.warn, app.mcpResult?.results.filter(keptBack)],
    ['Undone: issues is as before.', false, []]);
});

test('An Undo restores History entries written in the same millisecond newest-first', async t => {
  onLibrary();
  const history = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  const sameMs = '2026-11-18T09:00:01.000Z';
  history[0]!.at = sameMs;
  history.push({ id: 'on-skills-notes', key: 'notes', kind: 'on', at: sameMs });
  flip('notes', false);
  flip('notes', true);
  await settled();
  app.home!.skills.library.notes!.on = false;
  await main.pass({ ...did('notes', false), made: ['off-skills-notes'] });
  app.home!.skills.library.notes!.on = true;
  await main.pass({ ...did('notes', true), made: ['on-skills-notes'] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual(main.restored, ['on-skills-notes', 'off-skills-notes']);
});

/** A differing found skill `draft` in Claude Code and Copilot CLI, with Codex holding `draft` switched off through plugin `kit`. */
function differingPluginHome(t: TestContext) {
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  const empty = { tools, items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} };
  const draftFact = {
    key: 'draft', name: 'draft', description: 'Draft skill.', on: false, except: [], cannot: {}, edited: [],
    copies: {
      'claude-cli': { hash: 'h1', directory: '/home/.claude/skills/draft', rootLabel: 'Claude Code', lines: 3, modified: '2026-11-18T08:00:00.000Z', summary: 'Older.', writable: true, folder: 'draft' },
      'copilot-cli': { hash: 'h2', directory: '/home/.copilot/skills/draft', rootLabel: 'Copilot CLI', lines: 3, modified: '2026-11-18T09:00:00.000Z', summary: 'Newer.', writable: true, folder: 'draft' },
    },
    plugin: { 'codex-cli': { plugin: 'kit', marketplace: 'team', off: true } },
    anotherWay: { 'codex-cli': 'Codex has it through plugin kit.' },
    takeInAnswers: { click: { wait: 'copies-differ', latest: 'h2' }, rule: { wait: 'copies-differ', latest: 'h2' } },
  };
  const pluginInstall = { tool: 'codex-cli' as const, plugin: 'kit', source: '/market', marketName: 'team', off: false, skillsOff: ['draft'], items: [{ kind: 'skill' as const, name: 'draft' }] };
  app.home = {
    home: '/home', label: 'Practice', sync: { managed: tools, caughtUp: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: true },
    skills: { ...empty, items: [draftFact], library: {} }, mcp: empty, agents: empty, pluginItems: [pluginInstall],
  } as unknown as HomeView;
  t.mock.method(api, 'refresh', async () => app.home);
  const switched: unknown[][] = [];
  t.mock.method(api, 'setPluginSkill', async (...args: unknown[]) => {
    switched.push(args);
    pluginInstall.skillsOff = [];
    return { reports: [report('skill-off', 'Turned on.')] };
  });
  return {
    switched,
    takeIn: () => {
      app.home!.skills.library.draft = { ...newItem('draft', 'draft'), on: true };
      const chosen = { ...draftFact, on: true, copies: { ...draftFact.copies, 'claude-cli': { ...draftFact.copies['claude-cli'], hash: 'h2' } } };
      delete (chosen as Record<string, unknown>).takeInAnswers;
      app.home!.skills.items = [chosen as unknown as typeof app.home.skills.items[0]];
    },
  };
}

test('Choosing a copy on a row runs the plugin switch for another tool holding that skill off through a plugin', async t => {
  onLibrary();
  const { switched, takeIn } = differingPluginHome(t);
  const question = copyQuestion({ kinds: ['skills'], view: { filter: 'all', order: 'name', from: 'anywhere', find: '' } } as any, 'skills', 'draft', () => {});
  const button = findById(question, 'walk-use-skills-draft-copilot-cli');
  assert.ok(button, 'row copy choice button exists');
  button.onclick();
  await settled();
  takeIn();
  await main.pass({ results: [{ item: 'draft', harness: 'claude-cli', outcome: 'written', message: '' }], writes: 1, made: ['chosen-draft'], reloads: [] });
  assert.equal(switched.length, 1);
  assert.deepEqual(switched[0]?.slice(0, 6), ['/market', 'team', 'kit', 'draft', 'codex-cli', true]);
});

test('Use the latest for the rest runs the plugin switch for chosen items held off through a plugin', async t => {
  onLibrary();
  const { switched, takeIn } = differingPluginHome(t);
  openWalkthrough();
  const band = walkthroughBand(['skills'], () => null);
  const button = findById(band, 'walk-use-latest');
  assert.ok(button, 'Use the latest for the rest button exists');
  button.onclick();
  await settled();
  takeIn();
  await main.pass({ results: [{ item: 'draft', harness: 'claude-cli', outcome: 'written', message: '' }], writes: 1, made: ['chosen-draft'], reloads: [] });
  assert.equal(switched.length, 1);
  assert.deepEqual(switched[0]?.slice(0, 6), ['/market', 'team', 'kit', 'draft', 'codex-cli', true]);
});

test('Use the latest for the rest carries reloads from both its chosen library writes and its plugin switches through tellWritten', async t => {
  onLibrary();
  const { takeIn } = differingPluginHome(t);
  const pluginReload = { tool: 'codex-cli' as const, kind: 'skill' as const, key: 'draft', on: true, plugin: 'kit@team' };
  const chosenReload = { tool: 'pi-cli' as const, kind: 'skill' as const, key: 'draft', on: true };
  const bystanderReload = { tool: 'opencode-cli' as const, kind: 'skill' as const, key: 'unrelated', on: true };
  t.mock.method(api, 'setPluginSkill', async () => ({ reports: [{ ...report('skill-off', 'Turned on.'), tool: 'codex-cli' as const, reloads: [pluginReload] }] }));
  openWalkthrough();
  const band = walkthroughBand(['skills'], () => null);
  findById(band, 'walk-use-latest').onclick();
  await settled();
  takeIn();
  await main.pass({ results: [{ item: 'draft', harness: 'pi-cli', outcome: 'written', message: '' }], writes: 1, made: ['chosen-draft'], reloads: [chosenReload, bystanderReload] });
  assert.deepEqual(app.outcome?.reloads, [chosenReload, pluginReload]);
});

test('Profile Undo and menu-bar profile switches carry reloads through turnedOutcome and tellWritten (and coalesced menu switches settle)', async t => {
  onLibrary();
  const events = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  (events as unknown[]).splice(0, events.length, { id: 'sw-rel', kind: 'profile', item: 'Focus', at: '2026-11-21T00:00:00.000Z',
    profile: { toName: 'Focus', on: [{ id: 'skill:notes', name: 'notes' }], off: [] } });
  const piOn = { tool: 'pi-cli' as const, kind: 'skill' as const, key: 'notes', on: true };
  const piOff = { tool: 'pi-cli' as const, kind: 'skill' as const, key: 'notes', on: false };
  const claudeMcp = { tool: 'claude-cli' as const, kind: 'mcp' as const, key: 'docs', on: true };
  t.mock.method(api, 'restore', async () => ({ results: [], harnessWrites: 1, switched: { on: ['notes'], off: [], left: [] }, reloads: [piOn] }));
  app.page = 'profiles';
  await restoreEvent('sw-rel');
  assert.deepEqual(app.outcome?.reloads, [piOn]);
  // Menu-bar switch while idle carries its reloads through switchOutcome -> turnedOutcome -> tellWritten.
  const afterView = { ...app.home!, profiles: { profiles: [], plugins: [] } } as unknown as HomeView;
  main.profileSwitched({ name: 'Focus', on: ['notes'], off: [], left: [], results: [], event: 'sw-rel',
    profile: { toName: 'Focus', on: [{ id: 'skill:notes', name: 'notes' }], off: [] }, view: afterView, reloads: [piOn] });
  await settled();
  assert.deepEqual(app.outcome?.reloads, [piOn]);
  // Two menu-bar switches arriving while busy coalesce and settle chronologically (piOn then piOff drops Pi, keeps Copilot skill and Claude MCP).
  const copilotOn = { tool: 'copilot-cli' as const, kind: 'skill' as const, key: 'standup', on: true };
  onLibrary();
  flip('notes', false);
  await settled();
  try {
    main.profileSwitched({ name: 'First', on: ['notes', 'standup'], off: [], left: [], results: [], event: 'sw-1',
      profile: { toName: 'First', on: [{ id: 'skill:notes', name: 'notes' }, { id: 'skill:standup', name: 'standup' }], off: [] }, view: afterView, reloads: [piOn, copilotOn] });
    main.profileSwitched({ name: 'Second', on: ['docs'], off: ['notes'], left: [], results: [], event: 'sw-2',
      profile: { toName: 'Second', on: [{ id: 'mcp:docs', name: 'docs' }], off: [{ id: 'skill:notes', name: 'notes' }] }, view: afterView, reloads: [piOff, claudeMcp] });
    await main.pass(did('notes'));
    await settled();
    assert.deepEqual(app.outcome?.reloads, [copilotOn, claudeMcp]);
  } finally { while (main.passes.length) await main.pass(did('notes')); }
});

test('An editor’s earlier-versions list floors how long ago each version was, matching model.ts timesApart (and floors days too)', () => {
  const now = new Date(2026, 10, 22, 12, 0, 0, 0).getTime();
  mock.timers.enable({ apis: ['Date'], now });
  try {
    const agoSeconds = (seconds: number) => new Date(now - seconds * 1000).toISOString();
    const cases: [number, string][] = [
      [30, 'just now'], [59, 'just now'], [60, '1 min ago'], [90, '1 min ago'],
      [59 * 60, '59 min ago'], [60 * 60, '1 h ago'], [119 * 60, '1 h ago'],
      [1439 * 60, '23 h ago'], [1440 * 60, '1 d ago'], [36 * 3600, '1 d ago'],
    ];
    const versions = cases.map(([seconds], index) => ({ id: `v${index}`, at: agoSeconds(seconds), firstLine: '', lines: 1, differs: 1 }));
    const list = versionsList(versions, { id: id => `r-${id}`, disabled: false, run: () => {} }) as unknown as { children: { children: unknown[] }[] };
    const shown = list.children[1]!.children.map(row => textOf(row).match(/\(([^)]+)\)/)?.[1]);
    assert.deepEqual(shown, cases.map(([, expected]) => expected));
    // Every sub-day case matches timesApart's own words for that same moment.
    for (const [seconds, expected] of cases.slice(0, 7)) assert.deepEqual(timesApart([agoSeconds(seconds)], now), [expected]);
  } finally { mock.timers.reset(); }
});

test('On another plugin’s page (or after Refresh), the header omits "Last change" / "Undone" when nothing succeeded, and names what changed or was undone when it did', () => {
  const resultText = () => {
    const run = pluginsResult()[0] as unknown as { children?: { className?: string }[] } | undefined;
    return textOf(run?.children?.find(child => child?.className === 'toolbar-result-text'));
  };
  // Nothing changed (every tool refused), viewed on another plugin's page and after Refresh: no empty "Last change: .".
  start();
  market.lastRun = { done: refused('alpha').done, undo: false, home: '/home' };
  market.nav = { source: '/market', tab: 'plugins', find: '', plugin: 'beta' };
  assert.equal(resultText(), '1 of 1 didn’t go through in every tool: alpha. ');
  market.nav.plugin = undefined;
  market.lastRun.reread = true;
  assert.equal(resultText(), '1 of 1 didn’t go through in every tool: alpha. ');
  // One thing changed, viewed on another plugin's page: "Last change: alpha.".
  start();
  market.lastRun = { done: installed('alpha').done, undo: false, home: '/home' };
  market.nav = { source: '/market', tab: 'plugins', find: '', plugin: 'beta' };
  assert.equal(resultText(), 'Last change: alpha.');
  // An Undo that undid one plugin (with another step still left to undo), viewed on another plugin's page: "Undone: alpha.".
  start();
  const undoneAlpha: PluginTurnResult['done'][number] = { source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'remove',
    report: { tool: 'claude-cli', outcome: 'uninstalled', changed: true, message: 'Uninstalled.', runs: [] } };
  market.lastRun = { done: [undoneAlpha], undo: true, home: '/home', rest: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'codex-cli', action: 'remove' }] };
  market.nav = { source: '/market', tab: 'plugins', find: '', plugin: 'beta' };
  assert.equal(resultText(), 'Undone: alpha.');
  // An Undo where every tool refused, viewed on another plugin's page: no empty "Undone: .".
  start();
  market.lastRun = { done: refused('alpha').done, undo: true, home: '/home', rest: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'remove' }] };
  market.nav = { source: '/market', tab: 'plugins', find: '', plugin: 'beta' };
  assert.equal(resultText(), '1 of 1 didn’t go through in every tool: alpha. ');
});

/** Builds a History-page restore fixture with `notes` and `standup`, mocked restore/refresh replies, and profiles. */
function historyRestoreWorld(t: TestContext, events: Record<string, unknown>[],
  { beforeOn, afterOn, beforeDeleted = [], profiles, reply }: {
    beforeOn: Record<string, boolean>; afterOn: Record<string, boolean>; beforeDeleted?: string[];
    profiles: { id: string; name: string; items: string[] }[]; reply: Record<string, unknown>;
  }) {
  start();
  const slot = homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'skills', key: 'standup' }], { on: false });
  (slot as unknown[]).splice(0, slot.length, ...events);
  app.page = 'history';
  const base = app.home!;
  const viewWith = (on: Record<string, boolean>, deleted: string[]): HomeView => {
    const view = structuredClone(base);
    for (const [key, isOn] of Object.entries(on)) view.skills.library[key]!.on = isOn;
    for (const key of deleted) view.skills.library[key]!.deleted = { at: '2026-11-25T09:00:00.000Z' };
    view.profiles = { profiles: profiles.map(profile => ({ ...profile, switchesPluginItems: true })), plugins: [] };
    return view;
  };
  app.home = viewWith(beforeOn, beforeDeleted);
  const nextView = viewWith(afterOn, []);
  t.mock.method(api, 'restore', async () => reply as never);
  t.mock.method(api, 'refresh', async () => nextView);
}

const HISTORY_STANDUP_OFF = [
  { id: 'off-1', kind: 'off', item: 'standup', key: 'standup', of: 'skill', at: '2026-11-25T10:02:00.000Z', losers: [], orderProved: true, undoneBy: 'on-1' },
  { id: 'on-1', kind: 'on', item: 'standup', key: 'standup', of: 'skill', at: '2026-11-25T10:03:00.000Z', losers: [{ tool: 'claude-cli', hash: 'h1' }], orderProved: true },
];
const STANDUP_WRITTEN = { results: [{ item: 'standup', harness: 'claude-cli', outcome: 'written', message: 'Written.' }], harnessWrites: 1, made: ['on-1'], reloads: [] };

test('History Undo that stops Everyday matching says so even when another profile (Focus) now matches', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const focus = { id: 'p-2', name: 'Focus', items: ['skill:notes', 'skill:standup'] };
  historyRestoreWorld(t, HISTORY_STANDUP_OFF, { beforeOn: { notes: true, standup: false }, afterOn: { notes: true, standup: true }, profiles: [everyday, focus], reply: STANDUP_WRITTEN });
  await restoreEvent('off-1');
  assert.match(app.outcome?.text ?? '', /Everyday stopped being the profile in use\.$/);
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');
});

test('History Undo compares profiles by id, not name, when another profile of the same name matches after', async t => {
  const first = { id: 'p-1', name: 'Work', items: ['skill:notes'] };
  const second = { id: 'p-2', name: 'Work', items: ['skill:notes', 'skill:standup'] };
  historyRestoreWorld(t, HISTORY_STANDUP_OFF, { beforeOn: { notes: true, standup: false }, afterOn: { notes: true, standup: true }, profiles: [first, second], reply: STANDUP_WRITTEN });
  await restoreEvent('off-1');
  assert.match(app.outcome?.text ?? '', /Work stopped being the profile in use\.$/);
  assert.equal(app.outcome?.profileLine, 'Work stopped being the profile in use.');
});

test('History Restore of a deleted library item that ends Everyday appends the profile sentence and sets profileLine', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const events = [
    { id: 'del-1', kind: 'deleted', item: 'standup', key: 'standup', of: 'skill', at: '2026-11-25T10:00:00.000Z', losers: [], orderProved: true, undoneBy: 'res-1' },
    { id: 'res-1', kind: 'restored', item: 'standup', key: 'standup', of: 'skill', at: '2026-11-25T10:01:00.000Z', losers: [{ tool: 'claude-cli', hash: '' }], orderProved: true },
  ];
  const reply = { results: [{ item: 'standup', harness: 'claude-cli', outcome: 'written', message: 'Restored.' }], harnessWrites: 1, made: ['res-1'], reloads: [] };
  historyRestoreWorld(t, events, { beforeOn: { notes: true, standup: true }, afterOn: { notes: true, standup: true }, beforeDeleted: ['standup'], profiles: [everyday], reply });
  await restoreEvent('del-1');
  assert.match(app.outcome?.text ?? '', /^standup: restored to Central Knot.*Everyday stopped being the profile in use\.$/);
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');
});

test('History Undo ending two matching profiles uses the plural sentence', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const backup = { id: 'p-2', name: 'Backup', items: ['skill:notes'] };
  historyRestoreWorld(t, HISTORY_STANDUP_OFF, { beforeOn: { notes: true, standup: false }, afterOn: { notes: true, standup: true }, profiles: [everyday, backup], reply: STANDUP_WRITTEN });
  await restoreEvent('off-1');
  assert.match(app.outcome?.text ?? '', /Everyday and Backup stopped being the profiles in use\.$/);
  assert.equal(app.outcome?.profileLine, 'Everyday and Backup stopped being the profiles in use.');
});

test('History Restore when two profiles matched before and one of them still matches after adds no profile sentence', async t => {
  // While standup is deleted, both Everyday and Focus match; restoring standup leaves Focus still matching.
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const focus = { id: 'p-2', name: 'Focus', items: ['skill:notes', 'skill:standup'] };
  const events = [
    { id: 'del-1', kind: 'deleted', item: 'standup', key: 'standup', of: 'skill', at: '2026-11-25T10:00:00.000Z', losers: [], orderProved: true, undoneBy: 'res-1' },
    { id: 'res-1', kind: 'restored', item: 'standup', key: 'standup', of: 'skill', at: '2026-11-25T10:01:00.000Z', losers: [{ tool: 'claude-cli', hash: '' }], orderProved: true },
  ];
  const reply = { results: [{ item: 'standup', harness: 'claude-cli', outcome: 'written', message: 'Restored.' }], harnessWrites: 1, made: ['res-1'], reloads: [] };
  historyRestoreWorld(t, events, { beforeOn: { notes: true, standup: true }, afterOn: { notes: true, standup: true }, beforeDeleted: ['standup'], profiles: [everyday, focus], reply });
  await restoreEvent('del-1');
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.profileLine, undefined);
});

test('History Undo refused whole (heldWhole, no made) adds no profile sentence even if the refreshed view matches no profile', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const reply = { results: [{ item: 'standup', outcome: 'held', message: 'Waits for the shared skills folder.' }], harnessWrites: 0, made: [], reloads: [] };
  historyRestoreWorld(t, HISTORY_STANDUP_OFF, { beforeOn: { notes: true, standup: false }, afterOn: { notes: false, standup: false }, profiles: [everyday], reply });
  await restoreEvent('off-1');
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.refused, true);
});

test('Synchronize everything Undo ending Everyday appends the profile sentence and sets profileLine', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const events = [
    { id: 'ev-on', kind: 'everything', item: 'Synchronize everything', key: 'home:everything', at: '2026-11-25T10:00:00.000Z', losers: [], orderProved: true, everything: { ruleOn: true } },
    { id: 'ev-undo', kind: 'everything', item: 'Synchronize everything', key: 'home:everything', at: '2026-11-25T10:01:00.000Z', losers: [], orderProved: true,
      everything: { ruleOn: false, undo: { switchedOff: true, itemUndos: ['u-1'], left: [], keptIn: [] } } },
  ];
  historyRestoreWorld(t, events, { beforeOn: { notes: true, standup: false }, afterOn: { notes: false, standup: false }, profiles: [everyday], reply: { results: [], harnessWrites: 1, made: ['ev-undo'], reloads: [] } });
  await restoreEvent('ev-on');
  assert.match(app.outcome?.text ?? '', /Everyday stopped being the profile in use\.$/);
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');
});

test('Synchronize everything Restore ending Everyday appends the profile sentence and sets profileLine', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const events = [
    { id: 'ev-undo', kind: 'everything', item: 'Synchronize everything', key: 'home:everything', at: '2026-11-25T10:01:00.000Z', losers: [], orderProved: true,
      everything: { ruleOn: false, undo: { switchedOff: true, itemUndos: ['u-1'], left: [], keptIn: [] } } },
  ];
  historyRestoreWorld(t, events, { beforeOn: { notes: true, standup: false }, afterOn: { notes: true, standup: true }, profiles: [everyday], reply: { results: [], harnessWrites: 1, made: ['r-1'], reloads: [] } });
  await restoreEvent('ev-undo');
  assert.match(app.outcome?.text ?? '', /Everyday stopped being the profile in use\.$/);
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');
});

test('Synchronize everything Restore that puts nothing back (made empty, 0 writes) adds no profile sentence', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const events = [
    { id: 'ev-undo', kind: 'everything', item: 'Synchronize everything', key: 'home:everything', at: '2026-11-25T10:01:00.000Z', losers: [], orderProved: true,
      everything: { ruleOn: false, undo: { switchedOff: true, itemUndos: ['u-1'], left: [], keptIn: [] } } },
  ];
  const none = { results: [{ item: 'standup', outcome: 'held', message: 'standup was added, changed or deleted since the Undo, so it stays as it is.' }], harnessWrites: 0, made: [], reloads: [] };
  historyRestoreWorld(t, events, { beforeOn: { notes: true, standup: false }, afterOn: { notes: true, standup: true }, profiles: [everyday], reply: none });
  await restoreEvent('ev-undo');
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.profileLine, undefined);
});

test('Bulk Turn failure, differing Add, and already-on plugin row say exact facts on every path', async t => {
  const { startSelecting, stopSelecting, tickRow } = await import('../src/selection.ts');
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  const empty = { tools, items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} };
  const skillFact = (key: string, extra: Record<string, unknown> = {}) => ({ key, name: key, description: '', copies: {}, except: [], cannot: {}, edited: [], ...extra });
  const setupSelectHome = () => {
    onLibrary();
    app.libraryView = 'list';
    app.libraryKind = 'all';
    app.home = {
      home: '/home', label: 'Practice', sync: { managed: tools, present: tools, caughtUp: [], access: { allowed: true }, gate: { state: 'ready' } },
      skills: {
        ...empty,
        items: [
          skillFact('alpha', { on: true, copies: { 'claude-cli': {}, 'copilot-cli': {}, 'codex-cli': {} } }),
          skillFact('charlie', { on: true, copies: { 'claude-cli': {}, 'copilot-cli': {}, 'codex-cli': {} } }),
          skillFact('delta', { on: false }),
          skillFact('clash', { on: false, copies: { 'claude-cli': { hash: 'a' }, 'copilot-cli': { hash: 'b' } }, takeInAnswers: { click: { wait: 'copies-differ' }, rule: { wait: 'copies-differ' } } }),
          skillFact('lima', { on: false, copies: { 'claude-cli': { hash: 'l' } }, takeInAnswers: { click: { take: 'claude-cli' }, rule: { take: 'claude-cli' } } }),
        ],
        library: {
          alpha: { ...newItem('alpha', 'alpha'), on: true },
          charlie: { ...newItem('charlie', 'charlie'), on: true },
          delta: { ...newItem('delta', 'delta'), on: false },
        },
      },
      mcp: empty,
      agents: empty,
      pluginItems: [{ tool: 'claude-cli', plugin: 'kit', source: '/market', marketName: 'team', off: false, items: [{ kind: 'skill', name: 'zulu' }] }],
    } as unknown as HomeView;
    t.mock.method(api, 'refresh', async () => app.home);
  };
  try {
    await t.test('1c. Two rows failing in two different tools each get their own reason line with no pooled sentence; mixed path also names the failed row’s tool', async () => {
      setupSelectHome();
      startSelecting();
      const order = ['skills-alpha', 'skills-charlie', 'skills-delta', 'skills-clash'];
      for (const row of order) tickRow(row, order, false);
      findById(libraryTable(), 'select-turn-off').onclick();
      await settled();
      await main.pass({ results: [
        { item: 'alpha', harness: 'claude-cli', outcome: 'failed', message: 'couldn’t remove' },
        { item: 'alpha', harness: 'copilot-cli', outcome: 'removed', message: '' },
        { item: 'alpha', harness: 'codex-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'claude-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'copilot-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'codex-cli', outcome: 'failed', message: 'couldn’t remove' },
      ], writes: 4, made: ['off-alpha', 'off-charlie'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, '2 of 2 didn’t go through in every tool: alpha and charlie. 1 was already off. 1 not turned off.');
      assert.deepEqual(app.outcome?.reasons, ['alpha: still in Claude Code', 'charlie: still in Codex', 'clash: not in Central Knot']);

      // Mixed path: alpha goes through, charlie fails in Copilot CLI -> charlie still has its own reason line.
      setupSelectHome();
      startSelecting();
      for (const row of order) tickRow(row, order, false);
      findById(libraryTable(), 'select-turn-off').onclick();
      await settled();
      await main.pass({ results: [
        { item: 'alpha', harness: 'claude-cli', outcome: 'removed', message: '' },
        { item: 'alpha', harness: 'copilot-cli', outcome: 'removed', message: '' },
        { item: 'alpha', harness: 'codex-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'claude-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'codex-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'copilot-cli', outcome: 'failed', message: 'couldn’t remove' },
      ], writes: 5, made: ['off-alpha', 'off-charlie'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, '1 of 2 didn’t go through in every tool: charlie. Turned off 1 skill: alpha. 1 was already off. 1 not turned off.');
      assert.deepEqual(app.outcome?.reasons, ['charlie: still in Copilot CLI', 'clash: not in Central Knot']);
    });

    await t.test('1. Only taken row fails in a tool: names Copilot CLI, never claims "1 is off", keeps already/not-turned-off counts', async () => {
      setupSelectHome();
      startSelecting();
      const order1 = ['skills-charlie', 'skills-clash', 'skills-delta'];
      for (const row of order1) tickRow(row, order1, false);
      const bar1 = libraryTable();
      findById(bar1, 'select-turn-off').onclick();
      await settled();
      await main.pass({ results: [
        { item: 'charlie', harness: 'claude-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'codex-cli', outcome: 'removed', message: '' },
        { item: 'charlie', harness: 'copilot-cli', outcome: 'failed', message: 'couldn’t remove' },
      ], writes: 2, made: ['off-charlie'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, '1 of 1 didn’t go through in every tool: charlie. 1 was already off. 1 not turned off.');
      assert.deepEqual(app.outcome?.reasons, ['charlie: still in Copilot CLI', 'clash: not in Central Knot']);
    });

    await t.test('2. Found row whose copies came to differ before Refresh: not counted as turned on, named with its reason', async () => {
      setupSelectHome();
      startSelecting();
      const order2 = ['skills-delta', 'skills-lima'];
      for (const row of order2) tickRow(row, order2, false);
      const bar2 = libraryTable();
      findById(bar2, 'select-turn-on').onclick();
      await settled();
      await main.pass({ results: [
        { item: 'delta', harness: 'claude-cli', outcome: 'written', message: '' },
        { item: 'lima', outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' },
      ], writes: 1, made: ['on-delta'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, '1 of 2 didn’t go through in every tool: lima. Turned on 1 skill: delta.');
      assert.deepEqual(app.outcome?.items, ['delta']);
      assert.deepEqual(app.outcome?.reasons, ['lima: its copies differ (its row asks which to use)']);
      assert.equal(app.outcome?.warn, true);
    });

    await t.test('3. Plugin row already on is counted as "already on" for Turn on, not listed under "not turned on"', async () => {
      setupSelectHome();
      startSelecting();
      const zuluId = 'plugin-skills-kit@team/zulu';
      const order3 = ['skills-delta', zuluId];
      for (const row of order3) tickRow(row, order3, false);
      const bar3 = libraryTable();
      findById(bar3, 'select-turn-on').onclick();
      await settled();
      await main.pass({ results: [{ item: 'delta', harness: 'claude-cli', outcome: 'written', message: '' }], writes: 1, made: ['on-delta'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, 'Turned on 1 skill: delta. 1 was already on.');
      assert.deepEqual(app.outcome?.reasons, []);
      // selectOff is active only on the Library's list while Select's mode is on, never on the Files view or another page.
      app.page = 'library';
      app.libraryView = 'list';
      assert.equal(selectOff(), undefined);
      startSelecting();
      assert.equal(selectOff(), 'Done ends selecting');
      app.libraryView = 'files';
      assert.equal(selectOff(), undefined);
      app.libraryView = 'list';
      app.page = 'harnesses';
      assert.equal(selectOff(), undefined);
    });
    await t.test('1b. Turn on failure path names missing tool, never claims "1 is on", and differing-only Add keeps already count', async () => {
      setupSelectHome();
      startSelecting();
      const order = ['skills-charlie', 'skills-delta', 'skills-clash'];
      for (const row of order) tickRow(row, order, false);
      const bar = libraryTable();
      findById(bar, 'select-turn-on').onclick();
      await settled();
      await main.pass({ results: [
        { item: 'delta', harness: 'claude-cli', outcome: 'written', message: '' },
        { item: 'delta', harness: 'codex-cli', outcome: 'written', message: '' },
        { item: 'delta', harness: 'copilot-cli', outcome: 'failed', message: 'locked' },
      ], writes: 2, made: ['on-delta'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, '1 of 1 didn’t go through in every tool: delta. 1 was already on. 1 not turned on.');
      assert.deepEqual(app.outcome?.reasons, ['delta: not in Copilot CLI', 'clash: its copies differ (its row asks which to use)']);

      // Only taken row is a found skill whose copies came to differ before Refresh, alongside an already-on row.
      setupSelectHome();
      startSelecting();
      const orderDiff = ['skills-charlie', 'skills-lima'];
      for (const row of orderDiff) tickRow(row, orderDiff, false);
      findById(libraryTable(), 'select-turn-on').onclick();
      await settled();
      await main.pass({ results: [{ item: 'lima', outcome: 'held', differs: true, message: 'Copies differ.' }], writes: 0, reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, '1 of 1 didn’t go through in every tool: lima. Nothing changed. 1 was already on.');
      assert.deepEqual(app.outcome?.reasons, ['lima: its copies differ (its row asks which to use)']);
      assert.equal(app.outcome?.warn, true);
    });

    await t.test('4. Loose plugin-origin item (no throughItems) is taken; throughItems row and unaddable found row are left with their reasons; bar puts reasons beside Delete', async () => {
      setupSelectHome();
      app.home!.skills.items.push(
        skillFact('loose', { on: true, fromSource: { link: 'plugin:team/kit' }, copies: { 'claude-cli': {} } }) as any,
        skillFact('bound', { on: true, plugin: { 'claude-cli': { plugin: 'kit', marketplace: 'team' } }, anotherWay: { 'claude-cli': 'Through kit.' }, copies: { 'codex-cli': {} } }) as any,
        skillFact('unreadable', { on: false, copies: {}, takeInAnswers: { click: { leave: 'no-readable' }, rule: { leave: 'no-readable' } } }) as any,
      );
      app.home!.skills.library.loose = { ...newItem('loose', 'loose'), on: true };
      app.home!.skills.library.bound = { ...newItem('bound', 'bound'), on: true };
      app.home!.pluginItems!.push({ tool: 'claude-cli', plugin: 'kit', source: '/market', marketName: 'team', off: false, listed: true, items: [{ kind: 'skill', name: 'bound', description: '' }] });
      startSelecting();
      const order = ['skills-loose', 'skills-bound', 'skills-unreadable'];
      for (const row of order) tickRow(row, order, false);
      const tree = libraryTable();
      // Bar places "1 can't be deleted ›" right after Delete… (not before Turn on).
      const line = findById(tree, 'select-bar').children[0];
      assert.deepEqual(line.children.map((child: unknown) => textOf(child)).filter(Boolean), ['3 selected', 'Turn on', 'Turn off 1', 'Delete…', '1 can’t be deleted ›']);
      // Turn off takes loose (no tool has it through a plugin), leaves bound (plugin switch) and unreadable (found).
      findById(tree, 'select-turn-off').onclick();
      await settled();
      await main.pass({ results: [{ item: 'loose', harness: 'claude-cli', outcome: 'removed', message: '' }], writes: 1, made: ['off-loose'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, 'Turned off 1 skill: loose. 2 not turned off.');
      assert.deepEqual(app.outcome?.reasons, [
        'bound comes with the plugin “kit”: use its row’s own switch',
        'unreadable: not in Central Knot',
      ]);
      // Turn on with delta (off) + unreadable (!canAdd) leaves unreadable with "nothing can be added yet".
      startSelecting();
      const orderOn = ['skills-delta', 'skills-unreadable'];
      for (const row of orderOn) tickRow(row, orderOn, false);
      findById(libraryTable(), 'select-turn-on').onclick();
      await settled();
      await main.pass({ results: [{ item: 'delta', harness: 'claude-cli', outcome: 'written', message: '' }], writes: 1, made: ['on-delta'], reloads: [] });
      await settled();
      assert.equal(app.outcome?.text, 'Turned on 1 skill: delta. 1 not turned on.');
      assert.deepEqual(app.outcome?.reasons, ['unreadable: nothing can be added yet']);
    });

    await t.test('5. Outside Select mode, busy controls keep their own tooltips and armed Take over Cancel disables while busy (and stays live in Select)', async () => {
      const { libraryPages } = await import('../src/librarypages.ts');
      const { versionList } = await import('../src/versionlist.ts');
      setupSelectHome();
      const charlie = app.home!.skills.items.find(each => each.key === 'charlie')!;
      charlie.switchedOff = ['claude-cli'];
      charlie.takeOver = { 'claude-cli': { kind: 'shared', path: '/home/.agents/skills/charlie' } } as any;
      const charlieRow = { kind: 'skills' as const, ...charlie };
      // Arm Take over… while idle.
      const idleBox = libraryPages.skills.tool!(charlieRow as any, 'claude-cli')!;
      findById(idleBox, 'take-over-skills-charlie-claude-cli').onclick({ stopPropagation() {} });
      // Busy outside Select mode: tooltips stay their own words, Cancel is disabled.
      app.busy = 'Applying…';
      try {
        const busyActions = libraryPages.skills.tool!(charlieRow as any, 'claude-cli')!;
        const clearBtn = findById(busyActions, 'clear-switch-skills-charlie-claude-cli');
        const cancelBtn = findById(busyActions, 'take-over-cancel-skills-charlie-claude-cli');
        const confirmBtn = findById(busyActions, 'take-over-confirm-skills-charlie-claude-cli');
        assert.equal(clearBtn.attrs.title.startsWith('Clear Claude Code’s own switch'), true);
        assert.equal(confirmBtn.attrs.title.startsWith('Remove the copy'), true);
        assert.equal(cancelBtn.attrs.disabled, '');
        const item = { ...newItem('charlie', 'charlie'), on: true, versions: [
          { hash: 'h2', at: '2026-11-25T10:00:00Z', from: { how: 'found', in: 'claude-cli' } },
          { hash: 'h1', at: '2026-11-24T10:00:00Z', from: { how: 'found', in: 'claude-cli' } },
        ] };
        const busyVersions = versionList({ item: item as any, rowId: 'skills-charlie', canWrite: false, unfolded: true, onUnfold: () => {}, now: Date.now(), onRead: () => {}, onMakeCurrent: () => {} });
        const makeCur = findById(busyVersions, 'version-current-skills-charlie-1');
        assert.equal(makeCur.title, 'Make this the current version of charlie, in every tool it is on in. Undo makes today’s current again.');
      } finally { app.busy = undefined; }
      // Inside Select mode (idle): writing buttons show "Done ends selecting", Cancel stays live.
      startSelecting();
      const selActions = libraryPages.skills.tool!(charlieRow as any, 'claude-cli')!;
      assert.equal(findById(selActions, 'clear-switch-skills-charlie-claude-cli').attrs.title, 'Done ends selecting');
      assert.equal(findById(selActions, 'take-over-confirm-skills-charlie-claude-cli').attrs.title, 'Done ends selecting');
      assert.equal(findById(selActions, 'take-over-cancel-skills-charlie-claude-cli').attrs.disabled, undefined);
      // Disarm armed state for clean teardown.
      findById(selActions, 'take-over-cancel-skills-charlie-claude-cli').onclick({ stopPropagation() {} });
    });
  } finally { stopSelecting(); }
});

// ---------- Every result that ends the profile in use says so (app.ts tell, clicklist.ts Run, repopage.ts Pull) ----------

/** Builds a Library world with `notes` and `standup` and named profiles, returning a helper that clones the home with updated on-states. */
function profileActWorld(t: TestContext, { beforeOn, profiles }: {
  beforeOn: Record<string, boolean>; profiles: { id: string; name: string; items: string[] }[];
}) {
  onLibrary();
  const events = homeWith(t, [{ kind: 'skills', key: 'notes' }, { kind: 'skills', key: 'standup' }], { on: false });
  const base = app.home!;
  const viewWith = (on: Record<string, boolean>, homePath = base.home): HomeView => {
    const view = structuredClone(base);
    view.home = homePath;
    for (const [key, isOn] of Object.entries(on)) view.skills.library[key]!.on = isOn;
    view.profiles = { profiles: profiles.map(profile => ({ ...profile, switchesPluginItems: true })), plugins: [] };
    return view;
  };
  app.home = viewWith(beforeOn);
  return { events, viewWith };
}

test('Row switch ending Everyday appends profileLeftUse; on then off in one run adds none; whole-refused adds none', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday] });
  let nextView = viewWith({ notes: true, standup: true });
  t.mock.method(api, 'refresh', async () => nextView);

  // Single row switch turning standup on ends Everyday.
  flip('standup', true);
  await settled();
  await main.pass(did('standup', true));
  assert.equal(app.outcome?.text, 'standup is on. Everyday stopped being the profile in use.');
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');

  // Turning standup back off in the same run brings Everyday back: no profile sentence.
  nextView = viewWith({ notes: true, standup: false });
  flip('standup', false);
  await settled();
  await main.pass(did('standup', false));
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.profileLine, undefined);

  // New run: refused whole click adds no sentence even when the refreshed view matches no profile.
  closeResult();
  nextView = viewWith({ notes: false, standup: false });
  flip('standup', true);
  await settled();
  await main.pass(refusedAsStale('standup'));
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.profileLine, undefined);
});

test('Leaving the Library mid-run still announces the ended profile in the status bar', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday] });
  t.mock.method(api, 'refresh', async () => viewWith({ notes: true, standup: true }));
  flip('standup', true);
  await settled();
  showPage('history');
  await main.pass(did('standup', true));
  assert.equal(app.outcome, undefined);
  assert.equal(app.said.text, 'standup is on. Everyday stopped being the profile in use.');
});

test('applyClick (tool switch / plugin switch) appends profileLeftUse when it ends the profile and skips when refused', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday] });
  let nextView = viewWith({ notes: false, standup: false });
  t.mock.method(api, 'refresh', async () => nextView);

  // Effective applyClick ends Everyday.
  applyClick({ kind: 'skills', items: ['notes'], rows: [{ kind: 'skills', key: 'notes' }], changes: [{ key: 'notes', on: false, except: [], seenOn: true }], said: 'notes is off.' });
  await settled();
  await main.pass(did('notes', false));
  assert.equal(app.outcome?.text, 'notes is off. Everyday stopped being the profile in use.');
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');

  // Stopped applyClick adds no profile sentence even if refreshed home matches no profile.
  app.home = viewWith({ notes: true, standup: false });
  nextView = viewWith({ notes: false, standup: false });
  applyClick({ kind: 'skills', items: ['notes'], rows: [{ kind: 'skills', key: 'notes' }], changes: [{ key: 'notes', on: false, except: [], seenOn: true }], said: 'notes is off.' });
  await settled();
  await main.pass({ stopped: 'The skills record is damaged.', results: [], writes: 0, reloads: [] });
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.profileLine, undefined);
});

test('applyByKind (Turn these off) and Library Undo append profileLeftUse only when they end the profile in use', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday] });
  let nextView = viewWith({ notes: false, standup: false });
  t.mock.method(api, 'refresh', async () => nextView);

  // Turn these off ends Everyday.
  turnTheseOff([itemRow('skills', 'notes')]);
  await settled();
  await main.pass(offMade('skills', 'notes'));
  assert.match(app.outcome?.text ?? '', /Everyday stopped being the profile in use\.$/);
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');

  // Its Undo restores Everyday (no profile before): no sentence.
  nextView = viewWith({ notes: true, standup: false });
  app.outcome!.act!.run();
  await settled();
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);

  // Clicking standup off brings Everyday into use; its Undo turns standup back on and ends Everyday.
  app.home = viewWith({ notes: true, standup: true });
  nextView = viewWith({ notes: true, standup: false });
  flip('standup', false);
  await settled();
  await main.pass(offMade('skills', 'standup'));
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  nextView = viewWith({ notes: true, standup: true });
  app.outcome!.act!.run();
  await settled();
  assert.equal(app.outcome?.text, 'Undone: standup is as before. Everyday stopped being the profile in use.');
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');

  // applyByKind refused whole adds no sentence.
  app.home = viewWith({ notes: true, standup: false });
  nextView = viewWith({ notes: false, standup: false });
  turnTheseOff([itemRow('skills', 'notes')]);
  await settled();
  await main.pass({ stopped: 'The skills record is damaged.', results: [], writes: 0, reloads: [] });
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
});

test('Sync once appends profileLeftUse when it ends the profile and skips when nothing was synced', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday] });
  const afterView = viewWith({ notes: true, standup: true });

  t.mock.method(api, 'syncNow', async () => ({ view: afterView, text: 'Took in standup.', reasons: [], warn: false, history: false, reloads: [], did: true }));
  await syncNow();
  assert.equal(app.outcome?.text, 'Took in standup. Everyday stopped being the profile in use.');
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');

  // Sync once with nothing synced (did: false) adds no sentence even if the returned view matches no profile.
  app.home = viewWith({ notes: true, standup: false });
  t.mock.method(api, 'syncNow', async () => ({ view: afterView, text: 'Not everything was synced.', reasons: ['The skills record is damaged.'], warn: true, history: false, reloads: [], did: false }));
  await syncNow();
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.profileLine, undefined);
});

test('Git repo Pull appends profileLeftUse when it ends the profile, keeping History note, and skips when nothing moved', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday] });
  app.page = 'repo';
  const connected = {
    connected: true, url: 'https://example.com/cfg.git', branch: 'main', access: { allowed: true },
    latest: { id: 'abcdef1234567', subject: 'Add standup' }, incoming: [{ kind: 'skill', key: 'standup', name: 'standup', change: 'added' }], outgoing: [],
  } as any;
  repo.view = connected;
  let afterView = viewWith({ notes: true, standup: true });
  t.mock.method(api, 'refresh', async () => afterView);
  let reply: Record<string, unknown> = { view: { ...connected, base: connected.latest, incoming: [] }, results: [{ item: 'standup', harness: 'claude-cli', outcome: 'written', message: 'Written.' }], pulled: 1 };
  t.mock.method(api as any, 'pullRepo', async () => reply);

  findById(repoPage(), 'repo-pull').onclick({ detail: 1 });
  await settled();
  assert.equal(app.outcome?.text, 'Pulled 1 change into your tools. Everyday stopped being the profile in use.');
  assert.equal(app.outcome?.note, 'Undo it in History.');
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');

  // Pull that moved nothing adds no profile sentence.
  app.home = viewWith({ notes: true, standup: false });
  repo.view = connected;
  reply = { view: { ...connected, base: connected.latest, incoming: [] }, results: [], pulled: 0 };
  findById(repoPage(), 'repo-pull').onclick({ detail: 1 });
  await settled();
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
  assert.equal(app.outcome?.profileLine, undefined);
});

test('Profile switches, profile definition edits/deletes, and home changes add no profile sentence', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const focus = { id: 'p-2', name: 'Focus', items: ['skill:notes', 'skill:standup'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday, focus] });
  const focusView = viewWith({ notes: true, standup: true });

  // Switching from Everyday to Focus via Profiles / status bar: no sentence.
  t.mock.method(api as any, 'switchProfile', async () => ({ name: 'Focus', on: ['standup'], off: [], left: [], results: [], reloads: [], view: focusView }));
  await switchToProfile('p-2');
  assert.match(app.outcome?.text ?? '', /^Switched to Focus:/);
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);

  // Saving a profile edit with band=true that changes matching: no sentence.
  app.home = viewWith({ notes: true, standup: false });
  t.mock.method(api as any, 'saveProfile', async () => ({ id: 'p-1', profiles: { profiles: [{ ...everyday, items: ['skill:notes', 'skill:standup'], switchesPluginItems: true }], plugins: [] } }));
  await saveProfileDef({ id: 'p-1', switchesPluginItems: true }, 'Everyday now switches plugin items for good.', true);
  assert.equal(app.outcome?.text, 'Everyday now switches plugin items for good.');

  // Deleting the profile in use: no sentence.
  app.home = viewWith({ notes: true, standup: false });
  t.mock.method(api as any, 'deleteProfile', async () => ({ profiles: { profiles: [focus], plugins: [] } }));
  await deleteProfileDef('p-1');
  assert.equal(app.outcome?.text, 'Deleted the profile Everyday. No item changed.');

  // Home changed mid-act: no sentence.
  app.home = viewWith({ notes: true, standup: false }, '/home-a');
  t.mock.method(api, 'refresh', async () => viewWith({ notes: true, standup: true }, '/home-b'));
  applyClick({ kind: 'skills', items: ['standup'], rows: [{ kind: 'skills', key: 'standup' }], changes: [{ key: 'standup', on: true, except: [], seenOn: false }], said: 'standup is on.' });
  await settled();
  await main.pass(did('standup', true));
  assert.equal(app.outcome?.text, 'standup is on.');

  // Opening a home via loadHome (even the same path): no sentence.
  app.home = viewWith({ notes: true, standup: false }, '/home-a');
  t.mock.method(api, 'selectHome', async () => viewWith({ notes: true, standup: true }, '/home-a'));
  await loadHome('fixture');
  assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);
});

test('Two runs queued side by side on two tabs: only the first run says the profile stopped being in use', async t => {
  start();
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:standup', 'mcp:github'] };
  homeWith(t, [{ kind: 'skills', key: 'standup' }, { kind: 'mcp', key: 'github' }], { on: true });
  const base = app.home!;
  const viewWith = (skillOn: boolean, mcpOn: boolean): HomeView => {
    const view = structuredClone(base);
    view.skills.library.standup!.on = skillOn;
    view.mcp.library.github!.on = mcpOn;
    view.profiles = { profiles: [{ ...everyday, switchesPluginItems: true }], plugins: [] };
    return view;
  };
  app.home = viewWith(true, true);
  app.page = 'harnesses';
  app.harness = 'claude-cli';
  app.harnessTab = 'skills';
  const refreshed = [viewWith(false, true), viewWith(false, false)];
  t.mock.method(api, 'refresh', async () => refreshed.shift()!);

  // First run starts on Claude Code's Skills tab (turning standup off ends Everyday).
  queueClick({ kind: 'skills', key: 'standup', on: false }, 'standup',
    () => ({ kind: 'skills', items: ['standup'], rows: [{ kind: 'skills', key: 'standup' }], changes: [{ key: 'standup', on: false, except: [], seenOn: true }], said: 'standup is off.' }),
    () => false);
  await settled();
  // While the first run is still running, switch to the MCP tab and queue a second run turning github off.
  app.harnessTab = 'mcp';
  queueClick({ kind: 'mcp', key: 'github', on: false }, 'github',
    () => ({ kind: 'mcp', items: ['github'], rows: [{ kind: 'mcp', key: 'github' }], changes: [{ key: 'github', on: false, except: [], seenOn: true }], said: 'github is off.' }),
    () => false);
  await settled();

  // First run finishes (announced in status bar since MCP tab is open): names Everyday leaving use.
  await main.pass(did('standup', false));
  assert.equal(app.said.text, 'standup is off. Everyday stopped being the profile in use.');
  // Second run starts and finishes after Everyday already left use: must NOT say Everyday stopped being in use.
  await main.pass(did('github', false));
  assert.equal(app.outcome?.text, 'github is off.');
  assert.equal(app.outcome?.profileLine, undefined);

  // Clicking × (endRun) while a click is in flight still preserves that click's before-snapshot.
  app.home = viewWith(true, true);
  app.harnessTab = 'skills';
  refreshed.push(viewWith(false, true));
  queueClick({ kind: 'skills', key: 'standup', on: false }, 'standup',
    () => ({ kind: 'skills', items: ['standup'], rows: [{ kind: 'skills', key: 'standup' }], changes: [{ key: 'standup', on: false, except: [], seenOn: true }], said: 'standup is off.' }),
    () => false);
  await settled();
  endRun();
  await main.pass(did('standup', false));
  assert.equal(app.outcome?.text, 'standup is off. Everyday stopped being the profile in use.');
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');
});

test('First setup Yes opening the walkthrough carries its result without appending the profile sentence a second time', async t => {
  const everyday = { id: 'p-1', name: 'Everyday', items: ['skill:notes'] };
  const { viewWith } = profileActWorld(t, { beforeOn: { notes: true, standup: false }, profiles: [everyday] });
  const clash = {
    key: 'clash', name: 'clash', description: '', on: false, copies: { 'claude-cli': { hash: 'a' }, 'copilot-cli': { hash: 'b' } },
    except: [], cannot: {}, edited: [], takeInAnswers: { click: { wait: 'copies-differ' }, rule: { wait: 'copies-differ' } },
  };
  const before = viewWith({ notes: true, standup: false });
  before.syncOn = true;
  before.sync.syncEverything = undefined;
  before.skills.items.push(clash as never);
  const after = viewWith({ notes: true, standup: true });
  after.syncOn = true;
  after.sync.syncEverything = true;
  after.skills.items.push(clash as never);
  after.skills.notices = [{ kind: 'taken-in', items: ['standup'] } as never];
  app.home = before;
  app.page = 'overview';
  t.mock.method(api, 'setSyncEverything', async () => ({ view: after, reloads: [] }));

  findById(setupLead(app.home!)!, 'setup-yes').onclick();
  await settled();
  assert.equal(app.page, 'library');
  const matches = (app.outcome?.text ?? '').match(/Everyday stopped being the profile in use\./g) ?? [];
  assert.equal(matches.length, 1, `expected sentence once, got: ${app.outcome?.text}`);
  assert.equal(app.outcome?.profileLine, 'Everyday stopped being the profile in use.');
});

test('Unused band: skipped rows marked, unread managed tool cue, 3-line disclosure, all-plugin own-row wording, emptied kind and misses', async t => {
  const oldAt = '2026-09-01T00:00:00.000Z', newAt = '2026-11-23T00:00:00.000Z', readAt = '2026-11-25T00:00:00.000Z';
  const copy = (name: string) => ({ directory: `/home/.claude/skills/${name}`, hash: `h-${name}`, modified: oldAt });
  const oldItem = (key: string, on = true) => ({ ...newItem(key, key), on, versions: [{ hash: `h-${key}`, at: oldAt, from: { how: 'found' as const, in: 'claude-cli' as const } }] });
  const findAll = (node: any, match: (node: any) => boolean, out: any[] = []): any[] => {
    if (!node || typeof node === 'string') return out;
    if (match(node)) out.push(node);
    for (const child of node.children ?? []) findAll(child, match, out);
    return out;
  };
  const usedCells = (tree: any) => Object.fromEntries(findAll(tree, n => !!n.attrs?.['data-key']).map(row => {
    const cell = findAll(row, n => String(n.className ?? '').includes('ov-used'))[0];
    return [row.attrs['data-key'], { text: textOf(cell), skip: String(cell?.className ?? '').includes('ov-used-skip') }];
  }));
  const makeHome = (opts: { skillsOn?: string[]; agentsOn?: string[]; mcpOn?: string[]; homePath?: string; managed?: HarnessId[]; extraAgents?: string[] } = {}) => {
    const tools: HarnessId[] = opts.managed ?? ['claude-cli', 'codex-cli'];
    const skillKeys = ['old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6'];
    const skillsOn = new Set(opts.skillsOn ?? skillKeys);
    const agentKeys = ['plug-1', 'plug-2', ...(opts.extraAgents ?? [])];
    const agentsOn = new Set(opts.agentsOn ?? agentKeys);
    const mcpOn = new Set(opts.mcpOn ?? []);
    const skillFacts = [
      ...skillKeys.map(key => ({ key, name: key, description: '', copies: { 'claude-cli': copy(key) }, on: skillsOn.has(key), except: [], cannot: {}, edited: [] })),
      { key: 'young', name: 'young', description: '', copies: { 'claude-cli': copy('young') }, on: true, except: [], cannot: {}, edited: [] },
      { key: 'found-one', name: 'found-one', description: '', copies: { 'claude-cli': copy('found-one') }, on: false, except: [], cannot: {}, edited: [] },
    ];
    const skillLib: Record<string, ReturnType<typeof oldItem>> = {
      ...Object.fromEntries(skillKeys.map(key => [key, oldItem(key, skillsOn.has(key))])),
      young: { ...newItem('young', 'young'), on: true, versions: [{ hash: 'h-young', at: newAt, from: { how: 'found' as const, in: 'claude-cli' as const } }] },
    };
    const agentFacts = agentKeys.map(key => ({
      key, name: key, description: '', copies: { 'codex-cli': copy(key) }, on: agentsOn.has(key), except: [], cannot: {}, edited: [],
      plugin: { 'claude-cli': { plugin: 'team-kit', marketplace: 'local-market', name: key } },
    }));
    const agentLib = Object.fromEntries(agentKeys.map(key => [key, oldItem(key, agentsOn.has(key))]));
    const mcpFacts = [{ key: 'quiet-srv', name: 'quiet-srv', description: '', copies: { 'claude-cli': copy('quiet-srv') }, on: mcpOn.has('quiet-srv'), except: [], cannot: {}, edited: [] }];
    const mcpLib = { 'quiet-srv': oldItem('quiet-srv', mcpOn.has('quiet-srv')) };
    const allItems = [...skillKeys.map(key => `skill:${key}`), 'skill:young', ...agentKeys.map(key => `agent:${key}`)];
    return {
      home: opts.homePath ?? '/unused-band-test-home',
      mode: 'actual',
      syncOn: true,
      sync: { managed: tools, present: ['claude-cli', 'codex-cli', 'copilot-cli'], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: false },
      skills: { tools, items: skillFacts, library: skillLib, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] },
      mcp: { tools, items: mcpFacts, library: mcpLib, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] },
      agents: { tools, items: agentFacts, library: agentLib, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] },
      pluginItems: [{ tool: 'claude-cli', plugin: 'team-kit', source: '/market', marketName: 'local-market', off: false, items: agentKeys.map(name => ({ kind: 'agent', name })) }],
      profiles: { profiles: [
        { id: 'p-1', name: 'Everyday', items: allItems, switchesPluginItems: false },
        { id: 'p-2', name: 'Focus', items: allItems, switchesPluginItems: false },
      ], plugins: [] },
    } as unknown as HomeView;
  };
  const makeReading = (tools: any[] = [
    { tool: 'claude-cli' as const, sessions: 5, recent: 5, from: oldAt, tells: { skill: 'sure' as const, mcp: 'sure' as const, agent: 'sure' as const }, used: [] },
    { tool: 'codex-cli' as const, sessions: 2, recent: 2, from: '2026-11-12T00:00:00.000Z', tells: { skill: 'seen' as const, mcp: 'sure' as const, agent: 'seen' as const }, used: [] },
  ]) => ({ at: readAt, tools });
  const prevUsage = app.usage;
  t.after(() => { app.usage = prevUsage; app.libraryKind = 'all'; });
  const reset = (homeOpts?: Parameters<typeof makeHome>[0], readTools?: any[], kind: PageKind | 'all' = 'all', filter: 'all' | 'unused' = 'unused') => {
    app.home = makeHome(homeOpts);
    app.usage = { state: 'ready', data: makeReading(readTools), gen: 1 };
    app.outcome = undefined;
    main.sent.length = 0;
    openKind(kind as any, filter === 'unused' ? { filter: 'unused' } : {});
  };

  await t.test('one-line band for 8/2/6 and skipped plugin rows marked on the row while unused filter is on', () => {
    reset();
    const tree = libraryTable();
    const band = findById(tree, 'unused-band');
    assert.ok(band, 'unused-band should render');
    const bandText = textOf(band);
    assert.ok(bandText.includes('8 with no use seen in 30 days. 2 from a plugin skipped.'), bandText);
    assert.equal(bandText.includes('Undo'), false, 'Undo explanation must be gone');
    assert.equal(bandText.includes('Everyday'), false, 'profile sentence must be gone from band');
    assert.equal(bandText.includes('another computer'), false, 'limits must start closed');
    assert.equal(bandText.includes('not counted'), false, 'no unread cue when every managed tool was read');
    const toggle = findById(band, 'unused-counted-toggle');
    assert.ok(toggle, 'disclosure button must exist');
    assert.equal(textOf(toggle), 'What’s counted');
    assert.equal(toggle.attrs['aria-expanded'], 'false');
    assert.equal(findById(band, 'unused-counted'), undefined);
    assert.equal(textOf(findById(band, 'turn-unused-off')), 'Turn 6 off everywhere');
  });

  await t.test('skipped plugin rows are marked on the row while unused filter is on, hidden while selecting, and normal when filter is off', () => {
    reset();
    const cells = usedCells(libraryTable());
    for (const key of ['old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6']) {
      assert.deepEqual(cells[rowId('skills', key)], { text: 'no use seen in 30 days', skip: false });
    }
    for (const key of ['plug-1', 'plug-2']) {
      assert.deepEqual(cells[rowId('agents', key)], { text: 'from a plugin · skipped', skip: true });
    }
    findById(libraryTable(), 'library-select').onclick();
    const selectCells = usedCells(libraryTable());
    for (const key of ['plug-1', 'plug-2']) {
      assert.deepEqual(selectCells[rowId('agents', key)], { text: 'no use seen in 30 days', skip: false });
    }
    findById(libraryTable(), 'library-select').onclick();
    openKind('all');
    const allCells = usedCells(libraryTable());
    for (const key of ['plug-1', 'plug-2']) {
      assert.deepEqual(allCells[rowId('agents', key)], { text: 'no use seen in 30 days', skip: false });
    }
  });

  await t.test('What’s counted disclosure opens as a 3-line list with Codex caveats merged, writes nothing, and closes when chip turns off', () => {
    reset();
    findById(libraryTable(), 'unused-counted-toggle').onclick();
    const openedBand = findById(libraryTable(), 'unused-band');
    assert.equal(findById(openedBand, 'unused-counted-toggle').attrs['aria-expanded'], 'true');
    const counted = findById(openedBand, 'unused-counted');
    const lines = (counted.children ?? []).map((child: any) => textOf(child).replace(/\u00a0/g, ' '));
    assert.deepEqual(lines, [
      'History read: Claude Code, 30 days or more; Codex, only since Nov 12.',
      'Not seen from here: uses on another computer or in tools not read; Codex doesn’t always record skills or agents.',
      'Not counted: 1 skill under 30 days old; 1 skill found, not yet in Central Knot.',
    ]);
    assert.deepEqual(main.sent, []);
    // Turning the unused chip off resets the disclosure so re-enabling the chip starts closed.
    findById(libraryTable(), 'chip-unused').onclick();
    libraryTable();
    findById(libraryTable(), 'chip-unused').onclick();
    assert.equal(findById(libraryTable(), 'unused-counted'), undefined);
  });

  await t.test('What’s counted keeps each tool’s caveat truthful (Copilot CLI, OpenCode, Codex) and marks other-computer use as not seen from here', () => {
    const tools: HarnessId[] = ['claude-cli', 'codex-cli', 'copilot-cli', 'opencode-cli'];
    reset({ managed: tools }, [
      { tool: 'claude-cli', sessions: 5, recent: 5, from: oldAt, tells: { skill: 'sure', mcp: 'sure', agent: 'sure' }, used: [] },
      { tool: 'codex-cli', sessions: 2, recent: 2, from: '2026-11-12T00:00:00.000Z', tells: { skill: 'seen', mcp: 'sure', agent: 'seen' }, used: [] },
      { tool: 'copilot-cli', sessions: 2, recent: 2, from: oldAt, tells: { skill: 'sure', mcp: 'seen' }, used: [] },
      { tool: 'opencode-cli', sessions: 2, recent: 2, from: oldAt, tells: { skill: 'sure', agent: 'sure' }, used: [] },
    ]);
    findById(libraryTable(), 'unused-counted-toggle').onclick();
    const lines = (findById(libraryTable(), 'unused-counted').children ?? []).map((child: any) => textOf(child).replace(/\u00a0/g, ' '));
    assert.equal(lines[1],
      'Not seen from here: uses on another computer or in tools not read; Codex doesn’t always record skills or agents; Copilot CLI doesn’t always record MCP servers and doesn’t record agents; OpenCode doesn’t record MCP servers.');
  });

  await t.test('unread managed tool history is cued on the band line; no sessions, partial, late start and unread unmanaged tools add nothing', () => {
    const claude = { tool: 'claude-cli' as const, sessions: 5, recent: 5, from: oldAt, tells: { skill: 'sure' as const, mcp: 'sure' as const, agent: 'sure' as const }, used: [] };
    const codexBase = { tool: 'codex-cli' as const, tells: { skill: 'seen' as const, mcp: 'sure' as const, agent: 'seen' as const }, used: [] };

    reset({}, [claude, { ...codexBase, sessions: 0, recent: 0, unread: true }]);
    const unreadBand = findById(libraryTable(), 'unused-band');
    assert.ok(textOf(unreadBand).includes('Use in Codex not counted.'), textOf(unreadBand));
    findById(unreadBand, 'unused-counted-toggle').onclick();
    const unreadLine1 = textOf(findById(libraryTable(), 'unused-counted').children[0]).replace(/\u00a0/g, ' ');
    assert.ok(unreadLine1.includes('Codex, not read'), unreadLine1);

    reset({ managed: ['claude-cli', 'copilot-cli', 'codex-cli'] }, [
      claude,
      { tool: 'copilot-cli' as const, sessions: 0, recent: 0, tells: { skill: 'sure' as const, mcp: 'seen' as const }, used: [], unread: true },
      { ...codexBase, sessions: 0, recent: 0, unread: true },
    ]);
    assert.ok(textOf(findById(libraryTable(), 'unused-band')).includes('Use in Copilot CLI and Codex not counted.'));

    reset({}, [claude, { ...codexBase, sessions: 0, recent: 0 }]);
    const noneBand = findById(libraryTable(), 'unused-band');
    assert.equal(textOf(noneBand).includes('not counted'), false, textOf(noneBand));
    findById(noneBand, 'unused-counted-toggle').onclick();
    const noneLine1 = textOf(findById(libraryTable(), 'unused-counted').children[0]).replace(/\u00a0/g, ' ');
    assert.ok(noneLine1.includes('Codex, no sessions found'), noneLine1);

    reset({}, [claude, { ...codexBase, sessions: 2, recent: 2, from: '2026-11-12T00:00:00.000Z', skipped: 1 }]);
    assert.equal(textOf(findById(libraryTable(), 'unused-band')).includes('not counted'), false);

    reset({ managed: ['claude-cli', 'codex-cli'] }, [
      claude,
      { ...codexBase, sessions: 2, recent: 2, from: '2026-11-12T00:00:00.000Z' },
      { tool: 'copilot-cli' as const, sessions: 0, recent: 0, tells: { skill: 'sure' as const, mcp: 'seen' as const }, used: [], unread: true },
    ]);
    assert.equal(textOf(findById(libraryTable(), 'unused-band')).includes('not counted'), false);
  });

  await t.test('Turn 6 off everywhere result names both ended profiles; refused click names none', async sub => {
    reset();
    let nextView = makeHome({});
    sub.mock.method(api, 'refresh', async () => nextView);
    findById(libraryTable(), 'turn-unused-off').onclick();
    await settled();
    await main.pass({ stopped: 'The skills record is damaged.', results: [], writes: 0, reloads: [] });
    assert.doesNotMatch(app.outcome?.text ?? '', /stopped being the profile/);

    nextView = makeHome({ skillsOn: [] });
    findById(libraryTable(), 'turn-unused-off').onclick();
    await settled();
    await main.pass({
      results: ['old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6'].map(item => ({ item, harness: 'claude-cli' as const, outcome: 'removed' as const, message: '' })),
      writes: 6, reloads: [], made: ['off-skills-all'],
    });
    assert.match(app.outcome?.text ?? '', /Everyday and Focus stopped being the profiles in use\.$/);
  });

  await t.test('emptied kind offers Show Agents and lands on all-plugin band without skipping words (1, 2, 3+); singular and two-kind forms work', () => {
    reset({ skillsOn: [], agentsOn: ['plug-1', 'plug-2'] }, undefined, 'skills', 'unused');
    const emptyOne = findById(libraryTable(), 'unused-band');
    assert.ok(emptyOne, 'emptied kind band should render');
    assert.equal(textOf(emptyOne), 'No unused skills left. 2 agents have no use seen in 30 days.Show Agents');
    assert.equal(findById(emptyOne, 'unused-counted-toggle'), undefined);
    assert.equal(findById(emptyOne, 'turn-unused-off'), undefined);
    const showOther = findById(emptyOne, 'unused-show-other');
    assert.equal(textOf(showOther), 'Show Agents');
    showOther.onclick();
    assert.equal(app.libraryKind, 'agents');
    const agentsTree = libraryTable();
    assert.equal(findById(agentsTree, 'chip-unused').attrs['aria-pressed'], 'true');
    const allPluginBand = findById(agentsTree, 'unused-band');
    assert.equal(findById(allPluginBand, 'turn-unused-off'), undefined);
    assert.ok(textOf(allPluginBand).includes('2 with no use seen in 30 days, both from a plugin: turn each off on its own row.'), textOf(allPluginBand));
    const agentCells = usedCells(agentsTree);
    assert.deepEqual(agentCells[rowId('agents', 'plug-1')], { text: 'from a plugin', skip: true });
    assert.deepEqual(agentCells[rowId('agents', 'plug-2')], { text: 'from a plugin', skip: true });
    assert.deepEqual(main.sent, []);

    reset({ skillsOn: [], agentsOn: ['plug-1'] }, undefined, 'agents', 'unused');
    const onePluginTree = libraryTable();
    assert.ok(textOf(findById(onePluginTree, 'unused-band')).includes('1 with no use seen in 30 days, from a plugin: turn it off on its own row.'));
    assert.deepEqual(usedCells(onePluginTree)[rowId('agents', 'plug-1')], { text: 'from a plugin', skip: true });

    reset({ skillsOn: [], extraAgents: ['plug-3'], agentsOn: ['plug-1', 'plug-2', 'plug-3'] }, undefined, 'agents', 'unused');
    assert.ok(textOf(findById(libraryTable(), 'unused-band')).includes('3 with no use seen in 30 days, all from a plugin: turn each off on its own row.'));

    reset({ skillsOn: [], agentsOn: ['plug-1'] }, undefined, 'skills', 'unused');
    assert.equal(textOf(findById(libraryTable(), 'unused-band')), 'No unused skills left. 1 agent has no use seen in 30 days.Show Agents');

    reset({ skillsOn: [], agentsOn: ['plug-1', 'plug-2'], mcpOn: ['quiet-srv'] }, undefined, 'skills', 'unused');
    const emptyTwo = findById(libraryTable(), 'unused-band');
    assert.equal(textOf(emptyTwo), 'No unused skills left. 1 MCP server and 2 agents have no use seen in 30 days.Show all 3');
    findById(emptyTwo, 'unused-show-other').onclick();
    assert.equal(app.libraryKind, 'all');
    assert.equal(findById(libraryTable(), 'chip-unused').attrs['aria-pressed'], 'true');
  });

  await t.test('Find miss and From miss omit the unused band', async sub => {
    reset({ skillsOn: [], agentsOn: ['plug-1', 'plug-2'], mcpOn: ['quiet-srv'] }, undefined, 'skills', 'unused');
    findById(libraryTable(), 'item-from').onchange({ target: { value: 'yours' } });
    assert.equal(findById(libraryTable(), 'unused-band'), undefined);
    reset({ skillsOn: [], agentsOn: ['plug-1', 'plug-2'], mcpOn: ['quiet-srv'] }, undefined, 'skills', 'unused');
    const prevSearch = (api as Record<string, unknown>).search;
    sub.after(() => {
      if (prevSearch === undefined) delete (api as Record<string, unknown>).search;
      else (api as Record<string, unknown>).search = prevSearch;
    });
    (api as Record<string, unknown>).search = async () => ({ ready: true, home: '/unused-band-test-home', rows: [] });
    findById(libraryTable(), 'find').oninput({ target: { value: 'zzz' } });
    await settled();
    assert.equal(findById(libraryTable(), 'unused-band'), undefined);
  });
});

// ---------- Step UX-6D: plugin acts say when a profile stops being in use ----------

test('profileEndedLine gives the line when all profiles before stop being in use, and falls back to busy’s actBefore when before is omitted', async t => {
  const { viewWith } = pluginProfileWorld(t);
  const work = app.home!.profiles.profiles[0]!;
  const before = profilesBefore();
  assert.deepEqual(before?.profiles.map(profile => profile.name), ['Work']);
  assert.equal(profileEndedLine(before, viewWith(false)), 'Work stopped being the profile in use.');
  assert.equal(profileEndedLine(before, viewWith(true)), undefined);
  assert.equal(profileEndedLine(before, viewWith(false, '/other-home')), undefined);
  assert.equal(profileEndedLine({ home: '/home', profiles: [] }, viewWith(false)), undefined);
  // Outside busy (actBefore unset), omitted/undefined before gives undefined; inside busy, it defaults to busy's actBefore.
  assert.equal(profileEndedLine(undefined, viewWith(false)), undefined);
  let insideBusy: string | undefined;
  await busy('Working…', async () => { insideBusy = profileEndedLine(undefined, viewWith(false)); });
  assert.equal(insideBusy, 'Work stopped being the profile in use.');
  assert.equal(profileEndedLine(before, undefined), undefined);
  const focus = { id: 'p-focus', name: 'Focus', items: ['skill:notes'], switchesPluginItems: true };
  assert.equal(profileEndedLine({ home: '/home', profiles: [work, focus] }, viewWith(false)), 'Work and Focus stopped being the profiles in use.');
  const bothHome = viewWith(true);
  bothHome.profiles.profiles = [work, focus];
  assert.equal(profileEndedLine({ home: '/home', profiles: [work, focus] }, bothHome), undefined);
});

function pluginProfileWorld(t: TestContext, { profileName = 'Work', inUseBefore = true }: { profileName?: string; inUseBefore?: boolean } = {}) {
  start();
  const base = homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  void base;
  const viewWith = (on: boolean, homePath = '/home'): HomeView => {
    const home = structuredClone(app.home!);
    home.home = homePath;
    home.skills.library.notes!.on = on;
    home.profiles = { profiles: [{ id: 'p-work', name: profileName, items: ['skill:notes'], switchesPluginItems: true }], plugins: [] };
    return home;
  };
  app.home = viewWith(inUseBefore);
  app.page = 'plugins';
  return { viewWith };
}

test('Plugin switch / box (runEnded): 1-click ending Work shows profileLine on #plugins-result and speaks it; 2-click restoring Work says nothing; failed click says nothing', async t => {
  const { viewWith } = pluginProfileWorld(t);
  let nextHome = viewWith(false);
  t.mock.method(api, 'refresh', async () => { main.reads.home++; return nextHome; });

  // Single click ending Work.
  const turnedOff: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off', report: { tool: 'claude-cli', outcome: 'plugin-off', changed: true, message: 'Turned off.', runs: [] } }],
    before: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [] },
    back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-on' }],
  };
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  await main.answer(turnedOff);
  await settled();
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);
  const shown = pluginsResult();
  assert.ok(shown.some(node => findById(node, 'plugins-result')), 'pluginsResult draws #plugins-result');
  assert.ok(shown.some(node => textOf(node).includes('Work stopped being the profile in use.')), `pluginsResult draws profileLine: ${shown.map(textOf).join(' | ')}`);

  // Second click in the same run brings Work back into use: run's end says no profile sentence.
  nextHome = viewWith(true);
  const turnedOn: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-on', report: { tool: 'claude-cli', outcome: 'plugin-on', changed: true, message: 'Turned on.', runs: [] } }],
    before: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: ['claude-cli'] },
    back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off' }],
  };
  turnPlugin(entry, 'alpha', 'let-in', 'claude-cli');
  await settled();
  await main.answer(turnedOn);
  await settled();
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, undefined);
  assert.doesNotMatch(app.said.text, /stopped being the profile/);

  // New run: failed single click says no profile sentence even if refreshed home matches no profile.
  closeRun();
  app.home = viewWith(true);
  nextHome = viewWith(false);
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  await main.answer(refused('alpha'));
  await settled();
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, undefined);
  assert.doesNotMatch(app.said.text, /stopped being the profile/);
});

test('Plugin act (applyPluginOps, usePlugins, undoTurn): plain Undo and Update draw #plugins-result with profileLine and speak it; whole refusal says nothing', async t => {
  const { viewWith } = pluginProfileWorld(t);
  let nextHome = viewWith(false);
  t.mock.method(api, 'refresh', async () => nextHome);

  // Skill switch ending Work (applyPluginOps).
  await applyPluginOps([{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', skill: 'triage', action: 'skill-off' }]);
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);

  // Plain Undo (undoTurn, no Undo button left) ending Work still draws #plugins-result with profileLine.
  app.home = viewWith(true);
  nextHome = viewWith(false);
  market.lastRun = {
    done: [], undo: false, home: '/home',
    turn: { source: '/market', plugin: 'alpha', before: null, back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off' }] },
  };
  t.mock.method(api, 'undoPluginTurn', async () => ({
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off', report: { tool: 'claude-cli', outcome: 'plugin-off', changed: true, message: 'Off again.', runs: [] } }],
  }));
  undoLast();
  await settled();
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);
  const undoShown = pluginsResult();
  assert.ok(undoShown.some(node => findById(node, 'plugins-result')), 'plain Undo with profileLine draws #plugins-result');
  assert.ok(undoShown.some(node => textOf(node).includes('Work stopped being the profile in use.')), `plain Undo draws profileLine: ${undoShown.map(textOf).join(' | ')}`);
  // Show all puts profileLine inside #plugins-result once (not also on Row 2).
  app.shownWhole = market.lastRun;
  const wholeShown = pluginsResult();
  assert.equal(wholeShown.length, 1);
  assert.ok(textOf(findById(wholeShown[0], 'plugins-result')).includes('Work stopped being the profile in use.'));
  app.shownWhole = undefined;

  // Update (no Undo) ending Work draws #plugins-result with profileLine.
  app.home = viewWith(true);
  nextHome = viewWith(false);
  (api as Record<string, unknown>).updatePlugin = async () => ({ reports: [{ tool: 'claude-cli', outcome: 'updated', changed: true, version: '2.0.0', message: 'Updated.', runs: [] }] });
  t.after(() => { delete (api as Record<string, unknown>).updatePlugin; });
  await applyPluginOps([{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'update' }]);
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);
  assert.ok(pluginsResult().some(node => findById(node, 'plugins-result')), 'Update ending profile draws #plugins-result');

  // Use the plugin's ending Work sets profileLine; stopped whole sets none.
  app.home = viewWith(true);
  nextHome = viewWith(false);
  (api as Record<string, unknown>).takePluginItem = async () => ({
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'pi-cli', action: 'install-items', report: { tool: 'pi-cli', outcome: 'installed', changed: true, message: 'Put in Pi.', runs: [] } }],
    before: null, back: [],
  });
  t.after(() => { delete (api as Record<string, unknown>).takePluginItem; });
  await usePlugins(entry, 'alpha', 'pi-cli', { kind: 'skill', key: 'notes' });
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);

  app.home = viewWith(true);
  nextHome = viewWith(false);
  (api as Record<string, unknown>).takePluginItem = async () => ({ stopped: 'Stopped.', done: [] });
  await usePlugins(entry, 'alpha', 'pi-cli', { kind: 'skill', key: 'notes' });
  assert.equal((market.lastRun as { profileLine?: string } | undefined)?.profileLine, undefined);
  assert.doesNotMatch(app.said.text, /stopped being the profile/);
});

test('Library plugin line (sayResult): carries profileLine on LineResult when line is on screen and passes before to tell when in header', async t => {
  const { viewWith } = pluginProfileWorld(t);
  app.page = 'library';
  const prevCss = (globalThis as Record<string, unknown>).CSS;
  (globalThis as Record<string, unknown>).CSS = { escape: (value: string) => value };
  t.after(() => {
    if (prevCss === undefined) delete (globalThis as Record<string, unknown>).CSS;
    else (globalThis as Record<string, unknown>).CSS = prevCss;
  });
  let nextHome = viewWith(false);
  t.mock.method(api, 'refresh', async () => nextHome);
  const installedAlpha: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'copilot-cli', action: 'install', report: { tool: 'copilot-cli', outcome: 'installed', changed: true, message: 'Installed.', runs: [] } }],
    before: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: ['copilot-cli'] },
    back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'copilot-cli', action: 'remove' }],
  };
  const aim = { home: '/home', source: '/market', marketName: 'team', plugin: 'alpha', tool: 'copilot-cli' as HarnessId, act: 'install' as const, item: { kind: 'agent' as const, name: 'lead' } };

  // Line on screen: LineResult carries profileLine; spoken text has the whole result while the visible status bar keeps the prior wording.
  t.mock.method(document, 'querySelector', () => element());
  turnFromLine(aim);
  await settled();
  await main.answer(installedAlpha);
  await settled();
  const onLine = resultOn('copilot-cli', { kind: 'agent', name: 'lead' }) as { profileLine?: string } | undefined;
  assert.equal(onLine?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);
  assert.match(textOf(announcement), /Work stopped being the profile in use\.$/);
  const visibleStatus = announcement.children.filter((kid: any) => !String(kid?.className ?? '').includes('visually-hidden')).map(textOf).join('');
  assert.doesNotMatch(visibleStatus, /stopped being the profile/);
  assert.doesNotMatch(String(announcement.title ?? ''), /stopped being the profile/);
  assert.match(visibleStatus, /^Installed alpha in Copilot CLI\./);

  // Line off screen (header path): tell receives before, sets app.outcome.profileLine, and resultOn stays hidden while header shows it.
  app.home = viewWith(true);
  nextHome = viewWith(false);
  t.mock.method(document, 'querySelector', () => null);
  turnFromLine(aim);
  await settled();
  await main.answer(installedAlpha);
  await settled();
  assert.equal(app.outcome?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.outcome?.text ?? '', /Work stopped being the profile in use\.$/);
  assert.equal(resultOn('copilot-cli', { kind: 'agent', name: 'lead' }), undefined);

  // Turn the plugin on (let-in) and line Undo ending Work also carry profileLine; failed line act carries none.
  app.home = viewWith(true);
  nextHome = viewWith(false);
  t.mock.method(document, 'querySelector', () => element());
  const letInAim = { ...aim, act: 'let-in' as const, tool: 'codex-cli' as HarnessId, item: { kind: 'skill' as const, name: 'triage' } };
  const turnedOn: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'codex-cli', action: 'plugin-on', report: { tool: 'codex-cli', outcome: 'plugin-on', changed: true, message: 'Turned on.', runs: [] } }],
    before: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: ['codex-cli'] },
    back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'codex-cli', action: 'plugin-off' }],
  };
  turnFromLine(letInAim);
  await settled();
  await main.answer(turnedOn);
  await settled();
  const letInRes = resultOn('codex-cli', { kind: 'skill', name: 'triage' });
  assert.equal(letInRes?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);

  app.home = viewWith(true);
  nextHome = viewWith(false);
  t.mock.method(api, 'undoPluginTurn', async () => ({
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'codex-cli', action: 'plugin-off', report: { tool: 'codex-cli', outcome: 'plugin-off', changed: true, message: 'Off again.', runs: [] } }],
  }));
  letInRes!.undo!();
  await settled();
  assert.equal(resultOn('codex-cli', { kind: 'skill', name: 'triage' })?.profileLine, 'Work stopped being the profile in use.');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);

  app.home = viewWith(true);
  nextHome = viewWith(false);
  turnFromLine(letInAim);
  await settled();
  await main.answer({ stopped: 'Refused.', done: [] });
  await settled();
  assert.equal(resultOn('codex-cli', { kind: 'skill', name: 'triage' })?.profileLine, undefined);
  assert.doesNotMatch(app.said.text, /stopped being the profile/);
});

test('One plugin click announces once, with its result and profile sentence together; a successful click leaving Work in use says nothing', async t => {
  const { viewWith } = pluginProfileWorld(t);
  let nextHome = viewWith(false);
  t.mock.method(api, 'refresh', async () => { main.reads.home++; return nextHome; });
  const turnedOff: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off', report: { tool: 'claude-cli', outcome: 'plugin-off', changed: true, message: 'Turned off.', runs: [] } }],
    before: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [] },
    back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-on' }],
  };
  const seqBefore = app.said.seq;
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  await main.answer(turnedOff);
  await settled();
  assert.equal(app.said.seq - seqBefore, 1, 'one click announces once, not before and after reading home');
  assert.match(app.said.text, /Work stopped being the profile in use\.$/);

  // One successful click leaving Work in use says nothing about any profile and announces once.
  closeRun();
  app.home = viewWith(true);
  nextHome = viewWith(true);
  const seqStay = app.said.seq;
  turnPlugin(entry, 'alpha', 'let-in', 'claude-cli');
  await settled();
  await main.answer(installed('alpha'));
  await settled();
  assert.equal(app.said.seq - seqStay, 1);
  assert.equal(market.lastRun?.profileLine, undefined);
  assert.doesNotMatch(app.said.text, /stopped being the profile/);
});

test('Overlapping plugin click and Library line act: only the act that ended Work says so (both orders)', async t => {
  const { viewWith } = pluginProfileWorld(t);
  const prevCss = (globalThis as Record<string, unknown>).CSS;
  (globalThis as Record<string, unknown>).CSS = { escape: (value: string) => value };
  t.after(() => {
    if (prevCss === undefined) delete (globalThis as Record<string, unknown>).CSS;
    else (globalThis as Record<string, unknown>).CSS = prevCss;
  });
  t.mock.method(document, 'querySelector', () => element());
  let diskHome = viewWith(true);
  t.mock.method(api, 'refresh', async () => { main.reads.home++; return diskHome; });
  const turnedOff: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'codex-cli', action: 'plugin-off', report: { tool: 'codex-cli', outcome: 'plugin-off', changed: true, message: 'Turned off.', runs: [] } }],
    before: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [] },
    back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'codex-cli', action: 'plugin-on' }],
  };
  const installedBeta: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'beta', tool: 'copilot-cli', action: 'install', report: { tool: 'copilot-cli', outcome: 'installed', changed: true, message: 'Installed.', runs: [] } }],
    before: { id: 'e2', source: '/market', marketName: 'team', plugin: 'beta', on: true, except: ['copilot-cli'] },
    back: [{ source: '/market', marketName: 'team', plugin: 'beta', tool: 'copilot-cli', action: 'remove' }],
  };
  const betaAim = { home: '/home', source: '/market', marketName: 'team', plugin: 'beta', tool: 'copilot-cli' as HarnessId, act: 'install' as const, item: { kind: 'agent' as const, name: 'lead' } };

  // (a) Forward: alpha untick ends Work; while it runs, Install on beta's line queues behind it. Only alpha's run credits Work ending.
  turnPlugin(entry, 'alpha', 'keep-out', 'codex-cli');
  await settled();
  turnFromLine(betaAim);
  await settled();
  diskHome = viewWith(false);
  await main.answer(turnedOff);
  await main.answer(installedBeta);
  await settled();
  assert.equal(market.lastRun?.profileLine, 'Work stopped being the profile in use.');
  assert.equal(resultOn('copilot-cli', { kind: 'agent', name: 'lead' })?.profileLine, undefined);

  // (a) Reverse: alpha untick ends Work; while it runs, let-in on beta's line restores Work. Alpha's run still credits Work ending.
  closeRun();
  app.home = viewWith(true);
  diskHome = viewWith(true);
  const letInBeta = { ...betaAim, act: 'let-in' as const, tool: 'codex-cli' as HarnessId, item: { kind: 'skill' as const, name: 'other' } };
  const onBeta: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'beta', tool: 'codex-cli', action: 'plugin-on', report: { tool: 'codex-cli', outcome: 'plugin-on', changed: true, message: 'Turned on.', runs: [] } }],
    before: { id: 'e2', source: '/market', marketName: 'team', plugin: 'beta', on: true, except: ['codex-cli'] },
    back: [{ source: '/market', marketName: 'team', plugin: 'beta', tool: 'codex-cli', action: 'plugin-off' }],
  };
  turnPlugin(entry, 'alpha', 'keep-out', 'codex-cli');
  await settled();
  turnFromLine(letInBeta);
  await settled();
  diskHome = viewWith(false);
  await main.answer(turnedOff);
  // Before beta's turnPlugin finishes, alpha's run has already read diskHome=false and ended.
  diskHome = viewWith(true);
  await main.answer(onBeta);
  await settled();
  assert.equal(market.lastRun?.profileLine, 'Work stopped being the profile in use.');
  assert.equal(resultOn('codex-cli', { kind: 'skill', name: 'other' })?.profileLine, undefined);
});

test('Overlapping slow plugin install and Library skill switch: only the Library switch says Work ended', async t => {
  const { viewWith } = pluginProfileWorld(t);
  let diskHome = viewWith(true);
  t.mock.method(api, 'refresh', async () => { main.reads.home++; return diskHome; });
  // Start a slow plugin install that leaves Work in use; while it runs, open Library and switch off skill "notes" (which ends Work).
  turnPlugin(entry, 'alpha', 'on');
  await settled();
  showPage('library');
  flip('notes', false);
  await settled();
  // Alpha finishes first with diskHome still having Work in use.
  await main.answer(installed('alpha'));
  // Now the Library switch runs and turns notes off, ending Work.
  diskHome = viewWith(false);
  await main.pass(offMade('skills', 'notes'));
  await settled();
  assert.equal(app.outcome?.profileLine, 'Work stopped being the profile in use.');
  assert.equal(market.lastRun?.profileLine, undefined);
});

test('Single plugin click that fails or partly fails speaks the failure (never Nothing changed) and stays quiet on Plugins', async t => {
  const { viewWith } = pluginProfileWorld(t);
  let diskHome = viewWith(true);
  t.mock.method(api, 'refresh', async () => { main.reads.home++; return diskHome; });

  // Complete refusal on Plugins: spoken text names the failure, never "Nothing changed", and is quiet on Plugins.
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  await main.answer(refused('alpha'));
  await settled();
  assert.doesNotMatch(app.said.text, /Nothing changed/);
  assert.match(app.said.text, /alpha: Claude Code: /);
  assert.equal(app.said.quiet, true);

  // Partial failure with Undo on Plugins: spoken text includes "not in Codex", and stays quiet on Plugins.
  closeRun();
  const codexRefused = { ...report('failed', 'Not installed. Codex refused it.'), tool: 'codex-cli' as const };
  turnPlugin(entry, 'alpha', 'on');
  await settled();
  await main.answer({ ...installed('alpha'), done: [...installed('alpha').done, { source: '/market', marketName: 'team', plugin: 'alpha', tool: 'codex-cli', action: 'install', report: codexRefused }] });
  await settled();
  assert.equal(app.said.text, 'alpha: installed in Claude Code, not in Codex.');
  assert.equal(app.said.quiet, true);

  // Off Plugins: a failed single click is shown in the status bar (not quiet).
  closeRun();
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  showPage('library');
  await main.answer(refused('alpha'));
  await settled();
  assert.doesNotMatch(app.said.text, /Nothing changed/);
  assert.match(app.said.text, /alpha: Claude Code: /);
  assert.equal(app.said.quiet, false);

  // announce's shown prefix guard: when shown is not a prefix of text, paintStatusMessage emits no sliced hidden tail.
  announce('Completely different full sentence.', false, undefined, undefined, 'Prefix.');
  assert.equal(announcement.children.some((kid: any) => String(kid?.className ?? '').includes('visually-hidden')), false);
});

test('Undo hover after a fresh live Copilot CLI install says turns it off, kept installed; Claude Code and cached copies still say uninstalls', async t => {
  pluginProfileWorld(t);
  const titleFor = (done: PluginTurnResult['done']) => {
    market.lastRun = { done, undo: false, home: '/home', turn: { source: '/market', plugin: 'alpha', before: null, back: reverse(done) } };
    const shown = pluginsResult();
    return findById(shown[0], 'plugins-undo')?.title;
  };
  const install = (tool: HarnessId, live?: true): PluginTurnResult['done'][number] => ({
    source: '/market', marketName: 'team', plugin: 'alpha', tool, action: 'install',
    report: { tool, outcome: 'installed', changed: true, message: 'Installed.', runs: [], ...(live ? { live } : {}) },
  });
  assert.equal(titleFor([install('copilot-cli', true)]),
    'Reverses what changed for alpha, through each tool’s own command or switch: turns it off in Copilot CLI, kept installed.');
  assert.equal(titleFor([install('claude-cli'), install('copilot-cli', true)]),
    'Reverses what changed for alpha, through each tool’s own command or switch: uninstalls it from Claude Code and turns it off in Copilot CLI, kept installed.');
  assert.equal(titleFor([install('copilot-cli')]),
    'Reverses what changed for alpha, through each tool’s own command or switch: uninstalls it from Copilot CLI.');
  assert.equal(titleFor([install('claude-cli', true)]),
    'Reverses what changed for alpha, through each tool’s own command or switch: uninstalls it from Claude Code.');
});

test('Whole-plugin Off from a row switch routes through turnPlugin keep-out and its Undo routes through undoPluginTurn newest-first', async t => {
  pluginProfileWorld(t);
  const calls: string[] = [];
  let record: { id: string; source: string; marketName: string; plugin: string; on: boolean; except: HarnessId[] } =
    { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [] };
  t.mock.method(api, 'turnPlugin', async (source: string, plugin: string, what: PluginTurn, tool?: HarnessId) => {
    calls.push(`turn:${source}:${plugin}:${what}:${tool}`);
    const before = { ...record, except: [...record.except] };
    record = { ...record, except: [...record.except, tool!] };
    return {
      done: [{ source, marketName: 'team', plugin, tool: tool!, action: 'plugin-off', report: { tool: tool!, outcome: 'plugin-off', changed: true, message: 'Turned off.', runs: [] } }],
      before,
      back: [{ source, marketName: 'team', plugin, tool: tool!, action: 'plugin-on' }],
    };
  });
  t.mock.method(api, 'undoPluginTurn', async (source: string, plugin: string, before: unknown, back: PluginOp[]) => {
    const prev = before as typeof record;
    calls.push(`undo:${source}:${plugin}:${back.map(op => `${op.tool}:${op.action}`).join(',')}:except=${prev.except.join(',')}`);
    record = { ...prev, except: [...prev.except] };
    return { done: back.map(op => ({ ...op, report: { tool: op.tool, outcome: 'plugin-on', changed: true, message: 'Back on.', runs: [] } })) };
  });
  const setWholeMock = t.mock.method(api, 'setPluginOn', async () => { calls.push('setPluginOn'); return { reports: [report('plugin-off', 'Turned off.')] }; });
  await applyClick({
    kind: 'agents', items: ['lead'], rows: [{ kind: 'agents', key: 'alpha@team/lead' }], changes: [],
    said: 'lead is off in Claude Code and Copilot CLI.', pluginsOnly: true,
    plugins: { ops: [
      { source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off' },
      { source: '/market', marketName: 'team', plugin: 'alpha', tool: 'copilot-cli', action: 'plugin-off' },
    ] },
    undone: 'Undone: lead is back on in Claude Code and Copilot CLI.',
  });
  assert.equal(setWholeMock.mock.callCount(), 0, 'listed plugin whole-off never bypasses turnPlugin');
  assert.deepEqual(calls, ['turn:/market:alpha:keep-out:claude-cli', 'turn:/market:alpha:keep-out:copilot-cli']);
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual(calls, [
    'turn:/market:alpha:keep-out:claude-cli',
    'turn:/market:alpha:keep-out:copilot-cli',
    'undo:/market:alpha:copilot-cli:plugin-on:except=claude-cli',
    'undo:/market:alpha:claude-cli:plugin-on:except=',
  ]);
  assert.deepEqual(record.except, [], 'Undo restores the original record before the first turn');
});

test('A run of two row-switch clicks on the same plugin undoes whole-plugin turns newest-first once', async t => {
  pluginProfileWorld(t);
  const calls: string[] = [];
  let record: { id: string; source: string; marketName: string; plugin: string; on: boolean; except: HarnessId[] } =
    { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [] };
  const pending: (() => void)[] = [];
  t.mock.method(api, 'turnPlugin', (source: string, plugin: string, what: PluginTurn, tool?: HarnessId) => new Promise<PluginTurnResult>(resolve => {
    calls.push(`turn:${source}:${plugin}:${what}:${tool}`);
    pending.push(() => {
      const before = { ...record, except: [...record.except] };
      record = { ...record, except: [...record.except, tool!] };
      resolve({
        done: [{ source, marketName: 'team', plugin, tool: tool!, action: 'plugin-off', report: { tool: tool!, outcome: 'plugin-off', changed: true, message: 'Turned off.', runs: [] } }],
        before,
        back: [{ source, marketName: 'team', plugin, tool: tool!, action: 'plugin-on' }],
      });
    });
  }));
  t.mock.method(api, 'undoPluginTurn', async (source: string, plugin: string, before: unknown, back: PluginOp[]) => {
    const prev = before as typeof record;
    calls.push(`undo:${source}:${plugin}:${back.map(op => `${op.tool}:${op.action}`).join(',')}:except=${prev.except.join(',')}`);
    record = { ...prev, except: [...prev.except] };
    return { done: back.map(op => ({ ...op, report: { tool: op.tool, outcome: 'plugin-on', changed: true, message: 'Back on.', runs: [] } })) };
  });
  queueClick({ kind: 'skills', key: 'alpha@team/triage', on: false }, 'triage', () => ({
    kind: 'skills', items: ['triage'], rows: [{ kind: 'skills', key: 'alpha@team/triage' }], changes: [],
    said: 'triage is off in Claude Code.', pluginsOnly: true,
    plugins: { ops: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off' }] },
  }), () => false);
  queueClick({ kind: 'agents', key: 'alpha@team/lead', on: false }, 'lead', () => ({
    kind: 'agents', items: ['lead'], rows: [{ kind: 'agents', key: 'alpha@team/lead' }], changes: [],
    said: 'lead is off in Copilot CLI.', pluginsOnly: true,
    plugins: { ops: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'copilot-cli', action: 'plugin-off' }] },
  }), () => false);
  await settled();
  pending.shift()!();
  await settled();
  pending.shift()!();
  await settled();
  assert.deepEqual(calls, ['turn:/market:alpha:keep-out:claude-cli', 'turn:/market:alpha:keep-out:copilot-cli']);
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual(calls, [
    'turn:/market:alpha:keep-out:claude-cli',
    'turn:/market:alpha:keep-out:copilot-cli',
    'undo:/market:alpha:copilot-cli:plugin-on:except=claude-cli',
    'undo:/market:alpha:claude-cli:plugin-on:except=',
  ]);
  assert.deepEqual(record.except, [], 'Undo of a two-click run leaves no tool stuck in except');
});

test('Undo of a one-tool switch on a plugin-linked skill checks only that tool, does not blame Claude Code, and names Pi only', async t => {
  start();
  showPage('plugins');
  const events: any[] = [];
  const item = { ...newItem('tdd', 'tdd'), on: true, except: ['pi-cli' as HarnessId], source: 'plugin-kit-id', hash: 'plugin-h' };
  const fact: any = {
    key: 'tdd', name: 'tdd', copies: {}, on: true, except: ['pi-cli'],
    fromSource: { link: 'plugin:kit-own@team' },
    cannot: { 'claude-cli': 'Claude Code gets it only with the plugin kit-own, and the plugin is kept out of Claude Code.' },
    plan: { orderProved: true, keep: [], write: ['opencode-cli'], remove: [], forget: [], current: [], ownCopy: [] },
  };
  app.home = {
    home: '/home', label: 'Practice',
    sync: { managed: ['claude-cli', 'pi-cli', 'opencode-cli'], caughtUp: [], access: { allowed: true }, gate: { state: 'ready' } },
    skills: { tools: ['claude-cli', 'pi-cli', 'opencode-cli'], items: [fact], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: { tdd: item } },
    mcp: { tools: ['claude-cli', 'pi-cli', 'opencode-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} },
    agents: { tools: ['claude-cli', 'pi-cli', 'opencode-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} },
  } as unknown as HomeView;
  t.mock.method(api, 'history', async () => ({ events, days: 30 }));
  t.mock.method(api, 'refresh', async () => app.home);
  t.mock.method(api, 'restore', async (id: string) => {
    main.restored.push(id);
    const past = events.find(e => e.id === id);
    const made = { id: 'off-pi-tdd', at: '2026-11-18T09:01:00.000Z', key: 'tdd', of: 'skill', item: 'tdd', kind: 'off', cause: 'switch', only: 'pi-cli', gaveBack: ['pi-cli'], losers: [], orderProved: true };
    if (past) past.undoneBy = made.id;
    events.push(made);
    item.except = ['pi-cli'];
    fact.except = ['pi-cli'];
    return { results: [{ item: 'tdd', harness: 'pi-cli' as const, outcome: 'written' as const, message: 'Pi has its own copy back, as before.' }], writes: 1, made: [made.id], reloads: [] };
  });
  void applyClick({ kind: 'skills', items: ['tdd'], rows: [{ kind: 'skills', key: 'tdd' }], undoSentence: true, changes: [{ key: 'tdd', on: true, except: [], seenOn: true }], said: 'tdd: turned on in Pi.' });
  await settled();
  item.except = [];
  fact.except = [];
  events.push({ id: 'on-pi-tdd', at: '2026-11-18T09:00:00.000Z', key: 'tdd', of: 'skill', item: 'tdd', kind: 'on', cause: 'switch', only: 'pi-cli', version: 'plugin-h', tookFrom: [{ tool: 'pi-cli', hash: 'mine-h' }], losers: [{ tool: 'pi-cli', hash: 'mine-h' }], orderProved: true });
  await main.pass({ results: [{ item: 'tdd', harness: 'pi-cli', outcome: 'written', message: 'Added.' }], writes: 1, made: ['on-pi-tdd'], reloads: [] });
  assert.ok(app.outcome?.act, 'click offers Undo');
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.warn, app.skillsResult?.results.filter(keptBack)], [false, []]);
  assert.equal(app.outcome?.text, 'tdd: kept out of Pi: Pi has its own copy back, as before. Central Knot keeps it.');
});

test('listResult on History does not add extra kept-back problem bands from outcome rows', async t => {
  homeWith(t, [{ kind: 'skills', key: 'notes' }], { on: true });
  showPage('history');
  app.skillsResult = { results: [{ item: 'notes', harness: 'claude-cli', outcome: 'held', message: 'Could not write Claude Code’s copy yet.' }], notices: [], writes: 0, reloads: [] };
  app.outcome = { page: 'history', item: 'notes', rows: [{ kind: 'skills', key: 'notes' }], warn: true, text: 'notes: restored.' };
  const bands = listResult();
  assert.equal(bands.some(band => textOf(band).includes('Could not write Claude Code’s copy yet.')), false, 'History gains no kept-back listResult header line');
});

test('Library row one-tool Undo keeps next wording (“Undone: notes is as before.”)', async t => {
  start();
  showPage('library');
  const events: any[] = [];
  const item = { ...newItem('notes', 'notes'), on: true, except: [] as HarnessId[], hash: 'h1' };
  const fact: any = { key: 'notes', name: 'notes', copies: {}, on: true, except: [] as HarnessId[] };
  app.home = {
    home: '/home', label: 'Practice',
    sync: { managed: ['claude-cli', 'pi-cli'], caughtUp: [], access: { allowed: true }, gate: { state: 'ready' } },
    skills: { tools: ['claude-cli', 'pi-cli'], items: [fact], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: { notes: item } },
    mcp: { tools: ['claude-cli', 'pi-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} },
    agents: { tools: ['claude-cli', 'pi-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} },
  } as unknown as HomeView;
  t.mock.method(api, 'history', async () => ({ events, days: 30 }));
  t.mock.method(api, 'refresh', async () => app.home);
  t.mock.method(api, 'restore', async (id: string) => {
    const past = events.find(e => e.id === id);
    const made = { id: 'on-pi-notes', at: '2026-11-18T09:01:00.000Z', key: 'notes', of: 'skill', item: 'notes', kind: 'on', cause: 'switch', only: 'pi-cli', losers: [{ tool: 'pi-cli', hash: 'h1' }], orderProved: true };
    if (past) past.undoneBy = made.id;
    events.push(made);
    item.except = [];
    fact.except = [];
    return { results: [{ item: 'notes', harness: 'pi-cli' as const, outcome: 'written' as const, message: 'Added.' }], writes: 1, made: [made.id], reloads: [] };
  });
  void applyClick({ kind: 'skills', items: ['notes'], rows: [{ kind: 'skills', key: 'notes' }], changes: [{ key: 'notes', on: true, except: ['pi-cli'], seenOn: true }], said: 'notes is off in Pi.' });
  await settled();
  item.except = ['pi-cli'];
  fact.except = ['pi-cli'];
  events.push({ id: 'off-pi-notes', at: '2026-11-18T09:00:00.000Z', key: 'notes', of: 'skill', item: 'notes', kind: 'off', cause: 'switch', only: 'pi-cli', losers: [{ tool: 'pi-cli', hash: 'h1' }], orderProved: true });
  await main.pass({ results: [{ item: 'notes', harness: 'pi-cli', outcome: 'removed', message: 'Removed.' }], writes: 1, made: ['off-pi-notes'], reloads: [] });
  assert.ok(app.outcome?.act, 'Library row one-tool click offers Undo');
  app.outcome!.act!.run();
  await settled();
  assert.equal(app.outcome?.warn, false);
  assert.equal(app.outcome?.text, 'Undone: notes is as before.');
});

test('Whole-item Undo still checks every managed tool while settling a plugin-held cannot in Claude Code', async t => {
  start();
  showPage('library');
  const events: any[] = [];
  const item = { ...newItem('tdd', 'tdd'), on: true, except: [] as HarnessId[], source: 'plugin-kit-id', hash: 'plugin-h' };
  const fact: any = {
    key: 'tdd', name: 'tdd', copies: {}, on: true, except: [] as HarnessId[],
    fromSource: { link: 'plugin:kit-own@team' },
    cannot: { 'claude-cli': 'Claude Code gets it only with the plugin kit-own, and the plugin is kept out of Claude Code.' },
    plan: { orderProved: true, keep: [], write: ['opencode-cli'], remove: [], forget: [], current: [], ownCopy: [] },
  };
  app.home = {
    home: '/home', label: 'Practice',
    sync: { managed: ['claude-cli', 'pi-cli', 'opencode-cli'], caughtUp: [], access: { allowed: true }, gate: { state: 'ready' } },
    skills: { tools: ['claude-cli', 'pi-cli', 'opencode-cli'], items: [fact], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: { tdd: item } },
    mcp: { tools: ['claude-cli', 'pi-cli', 'opencode-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} },
    agents: { tools: ['claude-cli', 'pi-cli', 'opencode-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} },
  } as unknown as HomeView;
  t.mock.method(api, 'history', async () => ({ events, days: 30 }));
  t.mock.method(api, 'refresh', async () => app.home);
  t.mock.method(api, 'restore', async (id: string) => {
    const past = events.find(e => e.id === id);
    const made = { id: `on-all-${id}`, at: '2026-11-18T09:01:00.000Z', key: 'tdd', of: 'skill', item: 'tdd', kind: 'on', cause: 'switch', losers: [{ tool: 'pi-cli', hash: 'plugin-h' }], orderProved: true };
    if (past) past.undoneBy = made.id;
    events.push(made);
    item.on = true;
    fact.on = true;
    return { results: [{ item: 'tdd', harness: 'pi-cli' as const, outcome: 'written' as const, message: 'Added.' }], writes: 1, made: [made.id], reloads: [] };
  });
  // Unsettled OpenCode on a whole-item Undo (no `only`) is still caught and reported.
  void applyClick({ kind: 'skills', items: ['tdd'], rows: [{ kind: 'skills', key: 'tdd' }], changes: [{ key: 'tdd', on: false, except: [], seenOn: true }], said: 'tdd is off.' });
  await settled();
  item.on = false;
  fact.on = false;
  events.push({ id: 'off-all-1', at: '2026-11-18T09:00:00.000Z', key: 'tdd', of: 'skill', item: 'tdd', kind: 'off', cause: 'switch', losers: [], orderProved: true });
  await main.pass({ results: [{ item: 'tdd', harness: 'pi-cli', outcome: 'removed', message: 'Removed.' }], writes: 1, made: ['off-all-1'], reloads: [] });
  app.outcome!.act!.run();
  await settled();
  assert.equal(app.outcome?.warn, true, 'whole-item Undo warns when OpenCode stays unsettled');
  assert.equal(app.outcome?.text, 'Not all of tdd could be put back.');
  assert.deepEqual(app.skillsResult?.results.filter(keptBack).map(entry => entry.harness), ['opencode-cli']);

  // Once OpenCode is settled, Claude Code's plugin-held cannot counts as settled: no false warning on a plugin's Library row.
  fact.plan = { orderProved: true, keep: [], write: [], remove: [], forget: [], current: [], ownCopy: [] };
  void applyClick({ kind: 'skills', items: ['tdd'], rows: [{ kind: 'skills', key: 'tdd' }], changes: [{ key: 'tdd', on: false, except: [], seenOn: true }], said: 'tdd is off.' });
  await settled();
  item.on = false;
  fact.on = false;
  events.push({ id: 'off-all-2', at: '2026-11-18T09:02:00.000Z', key: 'tdd', of: 'skill', item: 'tdd', kind: 'off', cause: 'switch', losers: [], orderProved: true });
  await main.pass({ results: [{ item: 'tdd', harness: 'pi-cli', outcome: 'removed', message: 'Removed.' }], writes: 1, made: ['off-all-2'], reloads: [] });
  app.outcome!.act!.run();
  await settled();
  assert.deepEqual([app.outcome?.warn, app.skillsResult?.results.filter(keptBack), app.outcome?.text], [false, [], 'Undone: tdd is as before.']);
});

test('Harnesses Plugins tab scopes pluginsResult and problems to the place made, avoids stale market.nav.plugin, and restores Undo focus to that tab’s switch', async t => {
  const { viewWith } = pluginProfileWorld(t);
  t.mock.method(api, 'refresh', async () => {
    main.reads.home++;
    return viewWith(true);
  });
  app.page = 'harnesses';
  app.harness = 'claude-cli';
  app.harnessTab = 'plugins';
  market.nav.plugin = 'beta';
  const turnedOff: PluginTurnResult = {
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-off', report: { tool: 'claude-cli', outcome: 'plugin-off', changed: true, message: 'Turned off.', runs: [] } }],
    before: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [] },
    back: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-on' }],
  };
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  await main.answer(turnedOff);
  await settled();
  const shown = pluginsResult();
  const resultText = textOf(findById(shown[0], 'plugins-result')).trim();
  assert.match(resultText, /^alpha: turned off in Claude Code\./);
  assert.ok(findById(shown[0], 'plugins-undo'), 'Undo button shows on Claude Code Plugins tab');
  assert.equal(app.said.quiet, true, 'announcement stays quiet while Claude Code Plugins tab shows #plugins-result');

  // Moving to Plugin marketplaces or Codex's Plugins tab hides Claude Code's result and Undo; returning shows them again.
  app.page = 'plugins';
  assert.deepEqual(pluginsResult(), [], 'Claude Code tab result must not show on Plugin marketplaces');
  app.page = 'harnesses';
  app.harness = 'codex-cli';
  app.harnessTab = 'plugins';
  assert.deepEqual(pluginsResult(), [], 'Claude Code tab result must not show on Codex Plugins tab');
  app.harness = 'claude-cli';
  assert.ok(findById(pluginsResult()[0], 'plugins-undo'), 'Claude Code tab result returns when back on Claude Code Plugins tab');

  // Undo from Claude Code's Plugins tab targets its switch id for focus restoration (not #pswitch-…).
  let focusedId = '';
  const fakeSwitch = { focus: () => { focusedId = 'harness-plugin-switch-team-alpha'; } };
  const prevGet = document.getElementById;
  document.getElementById = ((id: string) => (id === 'harness-plugin-switch-team-alpha' ? fakeSwitch : prevGet(id))) as typeof document.getElementById;
  t.mock.method(api, 'undoPluginTurn', async () => ({
    done: [{ source: '/market', marketName: 'team', plugin: 'alpha', tool: 'claude-cli', action: 'plugin-on', report: { tool: 'claude-cli', outcome: 'plugin-on', changed: true, message: 'Turned on.', runs: [] } }],
  }));
  try {
    undoLast();
    await settled();
  } finally {
    document.getElementById = prevGet;
  }
  assert.equal(focusedId, 'harness-plugin-switch-team-alpha');

  // A click started on Claude Code's Plugins tab whose work ends after moving to Codex's Plugins tab draws nothing on Codex and appears on return.
  closeRun();
  app.page = 'harnesses';
  app.harness = 'claude-cli';
  app.harnessTab = 'plugins';
  turnPlugin(entry, 'alpha', 'keep-out', 'claude-cli');
  await settled();
  app.harness = 'codex-cli';
  await main.answer(turnedOff);
  await settled();
  assert.deepEqual(pluginsResult(), []);
  assert.equal(app.said.quiet, false);
  app.harness = 'claude-cli';
  assert.ok(findById(pluginsResult()[0], 'plugins-undo'));

  // A problem recorded on Plugin marketplaces stays off Codex's Plugins tab and shows on Plugin marketplaces.
  closeRun();
  app.page = 'plugins';
  t.mock.method(api, 'addMarketplace', async () => ({ problem: 'Marketplace folder not found.', view: market.view }));
  await addMarketplace('/missing');
  assert.ok(pluginsResult().some(node => textOf(node).includes('Marketplace folder not found.')));
  app.page = 'harnesses';
  app.harness = 'codex-cli';
  app.harnessTab = 'plugins';
  assert.deepEqual(pluginsResult(), []);
  app.page = 'plugins';
  assert.ok(pluginsResult().some(node => textOf(node).includes('Marketplace folder not found.')));
  closeRun();
});


