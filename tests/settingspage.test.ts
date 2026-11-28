// Settings row words and transitions (settingspage.ts, pluginupdateview.ts):
// download-estimate hint and unread-count tails, plugin-update card truth, and Synchronize everything copy, its added lines' Undo and the taken-out fold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppPreferences, HistoryDays, HistoryEvent, HistoryWindowSaved, HomeView, PluginTextView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let onPluginText: ((view: PluginTextView) => void) | undefined;
let rendered: FakeNode | undefined;
let redraws = 0;
let historyReads = 0;
let saveHistoryImpl: (days: HistoryDays) => Promise<HistoryWindowSaved> = async days => ({ settings: { ...settings, historyDays: days }, pruned: 'done' });
let historyEvents: HistoryEvent[] = [];

let settings: AppPreferences = {
  appearance: 'system',
  historyDays: 30,
  pluginUpdates: true,
  pluginText: true,
  signIn: { on: false, available: true },
  tray: true,
};

const api = {
  getSettings: async () => ({ ...settings }),
  setHistoryDays: (days: HistoryDays) => saveHistoryImpl(days),
  history: async () => { historyReads++; return { events: historyEvents, days: settings.historyDays }; },
  pluginText: async (): Promise<PluginTextView> => ({ read: 0, of: 0, elsewhere: 0, reading: false, on: true }),
  onPluginTextChanged: (listener: (view: PluginTextView) => void) => { onPluginText = listener; },
  onUpdatesChanged() {},
  onPluginUpdatesChanged() {},
  onNavigate() {},
  onSettingsChanged() {},
  onSyncChanged() {},
  onSessionCostsChanged() {},
  onSaid() {},
};

installDom(api, { byId: id => (rendered ? findById(rendered, id) ?? null : null) });

const { setRenderer, state } = await import('../src/app.ts');
const { historyWindowControl, loadSettings, openHistoryWindow, settingsPage } = await import('../src/settingspage.ts');
const { checkedWords, pluginUpdates } = await import('../src/pluginupdateview.ts');

const emptyKind = () => ({ tools: ['claude-cli', 'codex-cli'], items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] });
const makeHome = (overrides: Record<string, unknown> = {}) => ({
  home: '/tmp/fake-settings-home',
  mode: 'custom',
  label: 'Test home',
  readId: 1,
  syncOn: true,
  sync: { managed: ['claude-cli', 'codex-cli'], present: ['claude-cli', 'codex-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: false, caughtUp: [] },
  skills: emptyKind(),
  mcp: emptyKind(),
  agents: emptyKind(),
  pluginItems: [],
  profiles: { profiles: [], plugins: [] },
  sessionCosts: { home: '/tmp/fake-settings-home', on: false, collecting: false, seq: 1 },
  ...overrides,
}) as unknown as HomeView;
state.home = makeHome();

const draw = () => { redraws++; rendered = settingsPage() as unknown as FakeNode; };
setRenderer(draw);
state.page = 'settings';
await loadSettings();

test('plugin text hint comes and goes once per transition and keeps aria-describedby live', () => {
  assert.ok(onPluginText, 'onPluginTextChanged registered');
  onPluginText!({ read: 2, of: 5, elsewhere: 0, reading: true, on: true });
  draw();
  const drawsBefore = redraws;
  assert.equal(findById(rendered, 'setting-plugin-text-hint'), undefined);
  assert.equal(findById(rendered, 'plugin-text-on')?.attrs['aria-describedby'], 'setting-plugin-text-info-card setting-plugin-text-notice');

  // Hint appears when elsewhere grows from 0 to 2 (only the download estimate stays on the page; the refresh rule sits in the card).
  onPluginText!({ read: 4, of: 5, elsewhere: 2, reading: true, on: true });
  assert.equal(redraws, drawsBefore + 1);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-hint')), 'The 2 outside their marketplace are downloaded once (under 1 MB).');
  assert.equal(findById(rendered, 'plugin-text-on')?.attrs['aria-describedby'], 'setting-plugin-text-info-card setting-plugin-text-hint setting-plugin-text-notice');
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-info-card')),
    'Keeps plugin items’ names, descriptions and first lines, so Find can search them. After the first download, only changes are fetched (daily on a branch). Any plugin that can’t be read is tried again later.');

  // Changing count while hint stays visible updates in place with no redraw.
  onPluginText!({ read: 4, of: 5, elsewhere: 1, reading: true, on: true });
  assert.equal(redraws, drawsBefore + 1);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-hint')), 'The one plugin outside its marketplace is downloaded once (under 1 MB).');

  // Hint disappears again when elsewhere drops back to 0.
  onPluginText!({ read: 4, of: 5, elsewhere: 0, reading: true, on: true });
  assert.equal(redraws, drawsBefore + 2);
  assert.equal(findById(rendered, 'setting-plugin-text-hint'), undefined);
  assert.equal(findById(rendered, 'plugin-text-on')?.attrs['aria-describedby'], 'setting-plugin-text-info-card setting-plugin-text-notice');
});

test('plugin text reading state transitions redraw once on each change and stay idle at zero counts', () => {
  onPluginText!({ read: 4, of: 5, elsewhere: 0, reading: true, on: true });
  draw();
  const drawsBefore = redraws;
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.classList.contains('setting-progress'), true);

  // Reading finishes: redraws once to clear progress tone and role; unread count drops the standing retry tail.
  onPluginText!({ read: 4, of: 5, elsewhere: 0, reading: false, on: true });
  assert.equal(redraws, drawsBefore + 1);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-notice')), 'Read 4 of 5 plugins. 1 couldn’t be read.');
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.classList.contains('setting-progress'), false);
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.attrs.role, undefined);

  // In-place update once all plugins read stays at one redraw.
  onPluginText!({ read: 5, of: 5, elsewhere: 0, reading: false, on: true });
  assert.equal(redraws, drawsBefore + 1);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-notice')), 'Read 5 of 5 plugins.');

  // Reading resumes for a new plugin: redraws once to restore progress tone and role.
  onPluginText!({ read: 5, of: 6, elsewhere: 0, reading: true, on: true });
  assert.equal(redraws, drawsBefore + 2);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-notice')), 'Reading: 5 of 6 plugins.');
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.classList.contains('setting-progress'), true);
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.attrs.role, 'status');

  // Counts clear to zero: redraws once, then a repeated zero update skips redraw.
  onPluginText!({ read: 0, of: 0, elsewhere: 0, reading: false, on: true });
  assert.equal(redraws, drawsBefore + 3);
  assert.equal(findById(rendered, 'setting-plugin-text-notice'), undefined);
  assert.equal(findById(rendered, 'plugin-text-on')?.attrs['aria-describedby'], 'setting-plugin-text-info-card');

  onPluginText!({ read: 0, of: 0, elsewhere: 0, reading: false, on: true });
  assert.equal(redraws, drawsBefore + 3);
});

test('Update plugins automatically card says its schedule only while true and checkedWords drops the first-check tail', async () => {
  assert.deepEqual(checkedWords({ on: true, paused: false, checking: false, updated: [], failed: [], first: true }),
    { text: 'Not checked yet in this home.', tone: 'info' });

  const setPrefs = async (patch: Partial<AppPreferences>) => {
    settings = { ...settings, ...patch };
    await loadSettings();
    draw();
    return textOf(findById(rendered, 'setting-plugin-updates-info-card'));
  };

  pluginUpdates.view = { on: true, paused: false, checking: false, updated: [], failed: [], first: true };
  assert.equal(await setPrefs({ pluginUpdates: true, tray: true }),
    'Checks every four hours (soon after opening when one is due), window closed too. A plugin you turned off stays off.');
  assert.equal(textOf(findById(rendered, 'setting-plugin-updates-notice')), 'Not checked yet in this home.');

  // Without a system tray, closing the window quits, so "window closed too" is untrue.
  assert.equal(await setPrefs({ pluginUpdates: true, tray: false }),
    'Checks every four hours (soon after opening when one is due) while this window stays open. A plugin you turned off stays off.');

  // Switch off: qualifies the schedule with "When on" and still respects tray absence.
  assert.equal(await setPrefs({ pluginUpdates: false, tray: true }),
    'When on, checks every four hours (soon after opening when one is due), window closed too. A plugin you turned off stays off.');
  assert.equal(await setPrefs({ pluginUpdates: false, tray: false }),
    'When on, checks every four hours (soon after opening when one is due) while this window stays open. A plugin you turned off stays off.');

  // Automatic sync off: when on, the page already shows the paused line so the card says only what stays off; when off, the card says it waits while Automatic sync is off.
  pluginUpdates.view = { on: true, paused: true, checking: false, updated: [], failed: [], first: true };
  assert.equal(await setPrefs({ pluginUpdates: true, tray: true }),
    'A plugin you turned off stays off.');
  assert.equal(await setPrefs({ pluginUpdates: false, tray: true }),
    'When on, checks every four hours (soon after opening when one is due), window closed too. It waits while Automatic sync is off. A plugin you turned off stays off.');
  assert.equal(await setPrefs({ pluginUpdates: false, tray: false }),
    'When on, checks every four hours (soon after opening when one is due) while this window stays open. It waits while Automatic sync is off. A plugin you turned off stays off.');
  pluginUpdates.view = undefined;
  state.home = makeHome({ syncOn: false });
  assert.equal(await setPrefs({ pluginUpdates: true, tray: true }),
    'A plugin you turned off stays off.');

  state.home = makeHome();
  settings = { ...settings, pluginUpdates: true, tray: true };
  await loadSettings();
});

const takeFact = (key: string) => ({
  key, name: key, description: '', copies: {}, except: [], cannot: {}, edited: [],
  takeInAnswers: { click: { take: 'claude-cli' }, rule: { take: 'claude-cli' } },
});
const deletedFact = (key: string) => ({
  key, name: key, description: '', copies: {}, except: [], cannot: {}, edited: [],
  takeInAnswers: { click: { take: 'h1' }, rule: { leave: 'deleted' } },
});
const waitingFact = (key: string) => ({
  key, name: key, description: '', copies: {}, except: [], cannot: {}, edited: [],
  takeInAnswers: { click: { wait: true }, rule: { wait: true } },
});

test('Synchronize everything shows the switch difference on the page', () => {
  state.outcome = undefined;
  state.history.data = undefined;
  state.dismissed.clear();
  state.home = makeHome({
    skills: { ...emptyKind(), items: [takeFact('new-one'), deletedFact('old-one'), waitingFact('review')] },
  });
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-hint')),
    'Also adds what turns up in a tool; Automatic sync in the status bar keeps what’s already in Central Knot in step.');
  assert.equal(findById(rendered, 'sync-everything-on')?.attrs['aria-describedby'],
    'setting-sync-everything-info-card setting-sync-everything-hint setting-sync-everything-notice');
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-info-card')),
    'What turns up in a tool is turned on in every tool Central Knot manages; items whose copies differ wait for your choice.');
});

test('Synchronize everything counts the items taken out earlier on a fold that names each, its text a click away, with its kind and Add, or Choose copy where its copies differ', () => {
  state.outcome = undefined;
  state.history.data = undefined;
  state.dismissed.clear();
  state.home = makeHome({
    skills: { ...emptyKind(), items: [takeFact('new-one'), deletedFact('old-one'), waitingFact('review')] },
  });
  draw();
  assert.deepEqual([textOf(findById(rendered, 'setting-sync-everything-notice')), textOf(findById(rendered, 'setting-taken-out-toggle'))],
    ['Turning it on puts the 1 item found in your tools into every tool Central Knot manages now. 1 found item has copies that differ and waits for your choice of copy.Choose copies',
      '1 removed item stays out of Central Knot.']);

  // After Undo (nothing ready to add, 3 taken out, 1 waiting): the fold stands in for "nothing would be added"; opened, it names
  // each by kind, its kept version's mark after its name, Add on those it takes at once, and Choose copy on the one whose copies
  // differ, which waits for no walkthrough.
  const differing = { ...deletedFact('split'), takeInAnswers: { click: { wait: 'choice' }, rule: { leave: 'deleted' } } };
  const kept = { key: 'old-one', name: 'old-one', on: false, hash: 'h-old', versions: [{ hash: 'h-old', at: '2026-11-27T19:00:00Z', from: { how: 'found', harness: 'claude-cli' } }], except: [], applied: {}, deleted: { at: '2026-11-28T00:00:00Z' } };
  state.home = makeHome({
    skills: { ...emptyKind(), items: [deletedFact('old-one'), differing, waitingFact('review')], library: { 'old-one': kept } },
    agents: { ...emptyKind(), items: [deletedFact('helper')] },
  });
  draw();
  const rows = () => (findById(rendered, 'setting-taken-out')?.querySelector('.setting-taken-out-list')?.children ?? []) as FakeNode[];
  assert.deepEqual([textOf(findById(rendered, 'setting-sync-everything-notice')), textOf(findById(rendered, 'setting-taken-out-toggle')), findById(rendered, 'setting-taken-out')?.attrs.open],
    ['1 found item has copies that differ and waits for your choice of copy.Choose copies', '3 removed items stay out of Central Knot.', undefined]);
  assert.deepEqual(rows().map(row => [textOf(row), row.querySelector('.setting-taken-out-act')?.querySelector('button')?.attrs.id]),
    [['old-one skillAdd', 'setting-taken-out-add-skills-old-one'], ['split skillcopies differChoose copy', 'setting-taken-out-choose-skills-split'], ['helper agentAdd', 'setting-taken-out-add-agents-helper']]);
  assert.deepEqual([!!rows()[0].querySelector('.row-file-btn'), rows()[1].querySelector('.row-tag')?.attrs.title],
    [true, 'Its tools’ copies differ, so adding it needs a choice of copy.']);

  // With nothing found at all while off, still says nothing would be added.
  state.home = makeHome();
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    'Nothing found in your tools now would be added.');
});

test('Synchronize everything puts what was taken in before what waits with Choose copies last', () => {
  const notice = { kind: 'taken-in', items: ['notes'], keys: ['notes'], from: ['claude-cli'], history: 'take-notes', histories: ['take-notes'] };
  state.outcome = undefined;
  state.history.data = undefined;
  state.dismissed.clear();
  state.home = makeHome({
    syncOn: false,
    sync: { managed: ['claude-cli', 'codex-cli'], present: ['claude-cli', 'codex-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: true, caughtUp: [] },
    skills: { ...emptyKind(), items: [waitingFact('review')], notices: [notice] },
  });
  draw();
  const rowKids = (findById(rendered, 'setting-sync-everything')?.children ?? [])
    .filter((child): child is FakeNode => !!child && typeof child === 'object' && 'tag' in child);
  const addedIndex = rowKids.findIndex(child => child.className.split(/\s+/).includes('setting-added'));
  const noticeIndex = rowKids.findIndex(child => child.attrs.id === 'setting-sync-everything-notice');
  assert.ok(addedIndex >= 0 && noticeIndex > addedIndex, `expected .setting-added (${addedIndex}) before #setting-sync-everything-notice (${noticeIndex})`);
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    'Automatic sync is off, so it takes items in at Sync once. 1 found item has copies that differ and waits for your choice of copy.Choose copies');
});

test('An added line has its own Undo once History is read, where one of its take-ins still offers it, and none on a line the band’s Undo takes back as items stand now', () => {
  const oldNotice = { kind: 'taken-in' as const, items: ['early'], keys: ['early'], from: ['claude-cli' as const], history: 'take-early', histories: ['take-early'] };
  const notesNotice = { kind: 'taken-in' as const, items: ['notes'], keys: ['notes'], from: ['claude-cli' as const], history: 'take-notes', histories: ['take-notes'] };
  const editedNotice = { kind: 'taken-in' as const, items: ['edited'], keys: ['edited'], from: ['claude-cli' as const], history: 'take-edited', histories: ['take-edited'] };
  const mcpNotice = { kind: 'taken-in' as const, items: ['files'], keys: ['files'], from: ['codex-cli' as const], history: 'take-files', histories: ['take-files'] };
  const live = (key: string, hash = 'v1') => ({
    key, name: key, on: true, hash, except: [], versions: [{ hash, at: '2026-11-27T19:00:00Z', from: { how: 'found', harness: 'claude-cli' } }],
    applied: { 'claude-cli': hash, 'codex-cli': hash },
  });
  const ev = (id: string, kind: HistoryEvent['kind'], extra: Partial<HistoryEvent> = {}) =>
    ({ id, at: '2026-11-27T19:00:00Z', kind, item: id, key: id, losers: [], ...extra }) as HistoryEvent;
  const takeEv = (id: string, of: 'skill' | 'mcp', key: string, tool: 'claude-cli' | 'codex-cli') => ev(id, 'on', {
    of, key: of === 'mcp' ? `mcp:${key}` : key, item: key, cause: 'sync-everything', version: 'v1', winner: { tool, hash: 'v1' },
    tookFrom: [{ tool, hash: 'v1' }], foundIn: [tool],
  });
  const addedLines = () => (findById(rendered, 'setting-sync-everything')?.querySelector('.setting-added')?.children ?? [])
    .filter((child): child is FakeNode => !!child && typeof child === 'object' && 'tag' in child);
  // What each line has in its Undo's place: the Undo, why there is none, or nothing.
  const undos = () => addedLines().map(line => textOf(line.querySelector('.text-action') ?? line.querySelector('.setting-added-why') ?? undefined));

  state.dismissed.clear();
  state.home = makeHome({
    sync: { managed: ['claude-cli', 'codex-cli'], present: ['claude-cli', 'codex-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: true, caughtUp: [] },
    skills: {
      ...emptyKind(),
      library: { early: live('early'), notes: live('notes'), edited: live('edited') },
      notices: [oldNotice, notesNotice, editedNotice],
    },
    mcp: { ...emptyKind(), library: { files: live('files') }, notices: [mcpNotice] },
  });

  // Switch on -> take-early -> off -> switch on again (sw2) -> take-notes, take-edited, take-files.
  state.history.data = [
    ev('sw1', 'everything', { everything: { ruleOn: true } }),
    takeEv('take-early', 'skill', 'early', 'claude-cli'),
    ev('sw-off', 'everything', { everything: { ruleOn: false } }),
    ev('sw2', 'everything', { everything: { ruleOn: true } }),
    takeEv('take-notes', 'skill', 'notes', 'claude-cli'),
    takeEv('take-edited', 'skill', 'edited', 'claude-cli'),
    takeEv('take-files', 'mcp', 'files', 'codex-cli'),
  ];
  state.outcome = { page: 'settings', band: true, settingsBand: true, everythingUndo: 'sw2', text: 'Synchronize everything is on: it added 3 items.', act: { label: 'Undo', id: 'outcome-undo', run() {} } };
  // While History is being read (the read the first draw asked for), a line names what it added and offers nothing yet.
  state.history.state = 'reading';
  draw();
  draw();
  assert.deepEqual([addedLines().map(textOf), undos()], [
    ['Added skill early from Claude Code.', 'Added skill notes from Claude Code.', 'Added skill edited from Claude Code.', 'Added MCP server files from Codex.'], ['', '', '', '']]);
  state.history.state = 'ready';
  draw();
  assert.deepEqual(undos(), ['Undo', '', '', ''], 'only early, which the band’s Undo doesn’t take back, has its own');
  // Two lines of one kind each have their own ids, so a redraw puts the focus back on the line it was on.
  assert.deepEqual(addedLines().map(line => line.attrs.id), ['take-early', 'take-notes', 'take-edited', 'take-files'].map((id, at) => `setting-sync-everything-added-${at < 3 ? 'skills' : 'mcp'}-${id}`));
  assert.equal(findById(rendered, 'setting-sync-everything-added-skills-take-early-action')?.attrs.title, 'Take early out of Central Knot again: the copies it put in tools go, and each tool it was found in keeps its own');

  // Edit `edited` in its tool while the band stands: the band's Undo leaves it in, and its own action is Turn it off now, so its
  // line says why it has no Undo, in Undo's place, with what an Undo would cost on its hover.
  state.home.skills.library.edited = live('edited', 'v2') as never;
  draw();
  assert.deepEqual(undos(), ['Undo', '', 'edited since', '']);
  assert.equal(addedLines()[2].querySelector('.setting-added-why')?.attrs.title, 'Edited since it was added, so an Undo would lose the edit; its switch in the Library turns it off.');

  // A line of two, one changed since: the band leaves it; its Undo says how many it takes, and its hover names that one alone.
  state.home.skills.notices = [{ kind: 'taken-in', items: ['notes', 'edited'], keys: ['notes', 'edited'], from: ['claude-cli'], history: 'take-notes', histories: ['take-notes', 'take-edited'] }];
  draw();
  assert.deepEqual([textOf(addedLines()[0]), undos()], ['Added 2 skills from Claude Code: notes and edited.Undo 1', ['Undo 1', '']]);
  assert.equal(addedLines()[0].querySelector('.text-action')?.attrs.title, 'Take notes out of Central Knot again: the copies it put in tools go, and each tool it was found in keeps its own');

  // No band, or a band holding no switch-on's Undo: every line whose take-ins offer it has its own Undo; of several, all of them.
  state.home.skills.library.edited = live('edited', 'v1') as never;
  state.home.skills.notices = [oldNotice, { ...notesNotice, items: ['notes', 'edited'], keys: ['notes', 'edited'], histories: ['take-notes', 'take-edited'] }];
  for (const outcome of [undefined, { page: 'settings' as const, band: true, settingsBand: true, text: 'Other Undo.', act: { label: 'Undo', id: 'outcome-undo', run() {} } }]) {
    state.outcome = outcome;
    draw();
    assert.deepEqual(undos(), ['Undo', 'Undo all 2', 'Undo'], `${outcome?.text}`);
  }
  state.outcome = undefined;
  state.history.data = undefined;
});

test('A line of two, the first undone in History: it names the other alone, where it was found, its mark, and the band covers it by that one alone; History is read once for it', async () => {
  const live = (key: string) => ({ key, name: key, on: true, hash: 'v1', except: [], versions: [{ hash: 'v1', at: '2026-11-27T19:00:00Z', from: { how: 'found', harness: 'claude-cli' } }], applied: { 'claude-cli': 'v1', 'codex-cli': 'v1' } });
  const take = (id: string, key: string, tool: 'claude-cli' | 'codex-cli', more: Partial<HistoryEvent> = {}) => ({ id, at: '2026-11-27T19:00:00Z', kind: 'on', of: 'skill', key, item: key, losers: [], cause: 'sync-everything',
    version: 'v1', winner: { tool, hash: 'v1' }, tookFrom: [{ tool, hash: 'v1' }], foundIn: [tool], ...more }) as HistoryEvent;
  state.dismissed.clear();
  state.home = makeHome({
    sync: { managed: ['claude-cli', 'codex-cli'], present: ['claude-cli', 'codex-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: true, caughtUp: [] },
    skills: { ...emptyKind(), items: [{ key: 'lint', name: 'lint', description: '', copies: {}, except: [], cannot: {}, edited: [] }], library: { deploy: { ...live('deploy'), deleted: { at: '2026-11-27T19:01:00Z' } }, lint: live('lint') },
      notices: [{ kind: 'taken-in', items: ['deploy', 'lint'], keys: ['deploy', 'lint'], from: ['claude-cli', 'codex-cli'], history: 'take-deploy', histories: ['take-deploy', 'take-lint'] }] },
  });
  state.history.data = [{ id: 'sw', at: '2026-11-27T19:00:00Z', kind: 'everything', item: 'Synchronize everything', key: 'home:everything', losers: [], orderProved: true, everything: { ruleOn: true } } as HistoryEvent,
    take('take-deploy', 'deploy', 'claude-cli', { undoneBy: 'gone-deploy' }), take('take-lint', 'lint', 'codex-cli')];
  state.history.state = 'ready';
  state.outcome = { page: 'settings', band: true, settingsBand: true, everythingUndo: 'sw', text: 'Synchronize everything is on: it added 2 items.' };
  const reads = historyReads;
  historyEvents = state.history.data!;
  draw();
  draw();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(historyReads - reads, 1, 'a line naming take-ins History wasn’t read for in this visit reads it, once');
  const line = findById(rendered, 'setting-sync-everything-added-skills-take-deploy');
  assert.deepEqual([textOf(line), !!findById(rendered, 'file-skills-lint-take-deploy'), !!line?.querySelector('.text-action')], ['Added skill lint from Codex.', true, false]);
  state.outcome = undefined;
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-added-skills-take-deploy')), 'Added skill lint from Codex.Undo');
  state.history.data = undefined;
  historyEvents = [];
});

test('Synchronize everything marks added items Central Knot holds, opens the file under that line, and drops it when gone', () => {
  const held = (key: string, name = key, deleted = false) => ({ key, name, on: !deleted, hash: `h-${key}`, versions: [], except: [], applied: {}, own: {}, ...(deleted ? { deleted: { at: '2026-11-28T00:00:00Z' } } : {}) });
  const fact = (key: string, name = key) => ({ key, name, description: '', on: key !== 'gone', copies: {}, except: [], cannot: {}, edited: [] });
  state.dismissed.clear();
  state.home = makeHome({
    snapshots: [{ harness: 'claude-cli', skills: [{ folder: 'gone', directory: '/found/gone', realDirectory: '/found/gone', rootLabel: '~/.claude/skills' }] }],
    sync: { managed: ['claude-cli', 'codex-cli'], present: ['claude-cli', 'codex-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: true, caughtUp: [] },
    skills: {
      ...emptyKind(),
      items: [fact('notes', 'Notes'), fact('lint'), fact('tidy'), fact('gone', 'Gone')],
      library: { notes: held('notes', 'Notes'), lint: held('lint'), tidy: held('tidy'), gone: held('gone', 'Gone', true) },
      notices: [
        { kind: 'taken-in', items: ['Notes', 'Gone'], keys: ['notes', 'gone'], from: ['claude-cli'], history: 'take-1', histories: ['take-1', 'take-gone'] },
        { kind: 'taken-in', items: ['Notes', 'lint', 'tidy'], keys: ['notes', 'lint', 'tidy'], from: ['claude-cli', 'codex-cli'], history: 'take-2', histories: ['take-2', 'take-lint', 'take-tidy'] },
      ],
    },
  });
  draw();
  const kids = () => (findById(rendered, 'setting-sync-everything')?.querySelector('.setting-added')?.children ?? [])
    .filter((child): child is FakeNode => !!child && typeof child === 'object' && 'tag' in child);
  // Held items get marks (by key even when name differs), deleted/found-only gets none, same item on two lines gets distinct ids.
  assert.deepEqual(['file-skills-notes-take-1', 'file-skills-gone-take-1', 'file-skills-notes-take-2', 'file-skills-lint-take-2', 'file-skills-tidy-take-2'].map(id => !!findById(rendered, id)), [true, false, true, true, true]);
  assert.equal(textOf(kids()[0]), 'Added 2 skills from Claude Code: Notes and Gone.');
  const partsOf = (node: unknown): string[] => {
    if (typeof node === 'string') return node ? [node] : [];
    if (!node || typeof node !== 'object') return [];
    const el = node as FakeNode;
    if (el.tag === 'button') return [`[${el.attrs.id}]`];
    const inner = (el.children ?? []).flatMap(partsOf);
    return el.classList.contains('setting-added-name') ? [`(${inner.join('')})`] : inner;
  };
  assert.deepEqual(partsOf(kids()[1].querySelector('.setting-message-text')),
    ['Added 3 skills from Claude Code and Codex: ', '(Notes[file-skills-notes-take-2],)', ' ', '(lint[file-skills-lint-take-2])', ' and ', '(tidy[file-skills-tidy-take-2].)']);
  findById(rendered, 'file-skills-notes-take-1')!.click();
  assert.deepEqual(kids().map(el => [el.attrs.id, el.classList.contains('file-anchored')]), [['setting-sync-everything-added-skills-take-1', true], ['file-panel-settings', false], ['setting-sync-everything-added-skills-take-2', false]]);
  findById(rendered, 'file-skills-notes-take-2')!.click();
  assert.deepEqual(kids().map(el => [el.attrs.id, el.classList.contains('file-anchored')]), [['setting-sync-everything-added-skills-take-1', false], ['setting-sync-everything-added-skills-take-2', true], ['file-panel-settings', false]]);
  // Clearing notices (and drawing without a home) calls placePanel and drops the open file.
  const savedHome = state.home, savedNotices = savedHome.skills.notices;
  for (const clear of [() => { savedHome.skills.notices = []; }, () => { state.home = undefined; }]) {
    findById(rendered, 'file-skills-lint-take-2')!.click();
    assert.ok(findById(rendered, 'file-panel-settings'), 'clearing case starts with the file open');
    clear();
    draw();
    state.home = savedHome;
    savedHome.skills.notices = savedNotices;
    draw();
    assert.equal(findById(rendered, 'file-panel-settings'), undefined);
  }
});

test('History and Settings share one Keep label and one-sentence shortening warning with icon beside text', () => {
  draw();
  const settingsLabel = textOf(findById(rendered, 'setting-history-title'));
  const control = historyWindowControl() as unknown as FakeNode;
  const historyLabel = textOf(findById(control, 'history-keep-label'));
  assert.equal(historyLabel, 'Keep history for');
  assert.equal(settingsLabel, historyLabel);

  const select = findById(control, 'history-days') as unknown as { onchange?: (event: unknown) => void };
  select.onchange?.({ target: { value: '7' } });
  const withWarn = historyWindowControl() as unknown as FakeNode;
  const question = findById(withWarn, 'setting-history-question');
  assert.ok(question);
  assert.equal(question.classList.contains('notice'), false);
  const body = findNode(question, el => el.classList.contains('setting-confirm-body'));
  assert.ok(body, 'icon and text share a non-wrapping body');
  assert.equal(
    textOf(findById(body, 'history-shorten-text')),
    'In every home, History entries older than 7 days will be removed and can’t be restored.',
  );
  findById(withWarn, 'history-shorten-cancel')?.click();
});

test('a failed Keep save on History keeps prior History and shows a retryable error, and retry succeeds', async () => {
  const keptEvent: HistoryEvent = { id: 'kept-1', at: new Date().toISOString(), key: 'notes', of: 'skill', item: 'notes', kind: 'on', cause: 'switch', losers: [], orderProved: true };
  state.page = 'history';
  state.history.data = [keptEvent];
  state.history.state = 'ready';
  historyEvents = [keptEvent];
  openHistoryWindow();
  setRenderer(() => { rendered = historyWindowControl() as unknown as FakeNode; });
  rendered = historyWindowControl() as unknown as FakeNode;

  saveHistoryImpl = async () => { throw new Error('EACCES: permission denied'); };
  const select = findById(rendered, 'history-days') as unknown as { onchange?: (event: unknown) => void };
  select.onchange?.({ target: { value: '90' } });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(state.history.data, [keptEvent]);
  assert.equal(
    textOf(findById(rendered, 'setting-history-message')),
    'Couldn’t save: Central Knot can’t write its settings file. History is still kept for 30 days. Check the file’s permissions, then try again.',
  );
  assert.equal('disabled' in (findById(rendered, 'history-days')?.attrs ?? {}), false);

  const readsBefore = historyReads;
  saveHistoryImpl = async days => {
    settings.historyDays = days;
    return { settings: { ...settings }, pruned: 'failed' };
  };
  const retrySelect = findById(rendered, 'history-days') as unknown as { onchange?: (event: unknown) => void };
  retrySelect.onchange?.({ target: { value: '7' } });
  findById(rendered, 'history-shorten')?.click();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(settings.historyDays, 7);
  assert.equal(historyReads, readsBefore + 1);
  assert.match(textOf(findById(rendered, 'setting-history-message')), /^Saved, but History before .+ couldn’t be removed\./);
});
