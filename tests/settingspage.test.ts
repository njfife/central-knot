// Settings row words and transitions (settingspage.ts, pluginupdateview.ts):
// download-estimate hint and unread-count tails, plugin-update card truth, and Synchronize everything copy and History link.
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

test('Synchronize everything agrees on managed tools and puts not-added-again first after Undo', () => {
  state.outcome = undefined;
  state.history.data = undefined;
  state.dismissed.clear();
  state.home = makeHome({
    skills: { ...emptyKind(), items: [takeFact('new-one'), deletedFact('old-one'), waitingFact('review')] },
  });
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    'Turning it on puts the 1 item found in your tools into every tool Central Knot manages now. 1 found item isn’t added by itself again (taken out of Central Knot). Add on its row in the Library, or Restore in History, brings it back. 1 found item has copies that differ and waits for your choice of copy.Choose copies');

  // After Undo (nothing ready to add, 2 taken out, 1 waiting): leads directly with not added again by themselves.
  state.home = makeHome({
    skills: { ...emptyKind(), items: [deletedFact('old-one'), deletedFact('old-two'), waitingFact('review')] },
  });
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    '2 found items aren’t added by themselves again (taken out of Central Knot). Add on their rows in the Library, or Restore in History, brings them back. 1 found item has copies that differ and waits for your choice of copy.Choose copies');

  // With nothing found at all while off, still says nothing would be added.
  state.home = makeHome();
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    'Nothing found in your tools now would be added.');
});

test('Synchronize everything puts what was taken in before what waits with Choose copies last', () => {
  const notice = { kind: 'taken-in', items: ['notes'], from: ['claude-cli'], history: 'take-notes', histories: ['take-notes'] };
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

test('Synchronize everything drops History only on take-in lines the band’s Undo takes back as items stand now', () => {
  const oldNotice = { kind: 'taken-in' as const, items: ['early'], from: ['claude-cli' as const], history: 'take-early', histories: ['take-early'] };
  const notesNotice = { kind: 'taken-in' as const, items: ['notes'], from: ['claude-cli' as const], history: 'take-notes', histories: ['take-notes'] };
  const editedNotice = { kind: 'taken-in' as const, items: ['edited'], from: ['claude-cli' as const], history: 'take-edited', histories: ['take-edited'] };
  const mcpNotice = { kind: 'taken-in' as const, items: ['files'], from: ['codex-cli' as const], history: 'take-files', histories: ['take-files'] };
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
  draw();
  assert.deepEqual(addedLines().map(textOf), [
    'Added skill early from Claude Code. History can undo it.History',
    'Added skill notes from Claude Code.',
    'Added skill edited from Claude Code.',
    'Added MCP server files from Codex.',
  ]);
  assert.deepEqual(addedLines().map(line => !!line.querySelector('.text-action')), [true, false, false, false]);

  // Edit `edited` in its tool while Settings stays open and sw2's band still stands: Undo would leave `edited` in,
  // so `edited`'s surviving notice immediately shows History again while untouched `notes` and `files` still omit it.
  state.home.skills.library.edited = live('edited', 'v2') as never;
  draw();
  assert.deepEqual(addedLines().map(textOf), [
    'Added skill early from Claude Code. History can undo it.History',
    'Added skill notes from Claude Code.',
    'Added skill edited from Claude Code. History can undo it.History',
    'Added MCP server files from Codex.',
  ]);
  assert.deepEqual(addedLines().map(line => !!line.querySelector('.text-action')), [true, false, true, false]);

  // An un-synced edit on disk (pending change while library hash is still v1) also keeps History on that line.
  state.home.skills.library.edited = live('edited', 'v1') as never;
  state.home.skills.items = [{
    key: 'edited', name: 'edited', description: '', copies: {}, except: [], cannot: {}, edited: ['claude-cli'],
    plan: { takeIn: 'claude-cli', keep: [] },
  }] as never;
  draw();
  assert.equal(!!addedLines()[2].querySelector('.text-action'), true, 'pending edit on disk restores History before pass runs');

  // Multi-item notice: if even one item on it was changed since, the line keeps History.
  state.home.skills.items = [];
  state.home.skills.library.edited = live('edited', 'v2') as never;
  state.home.skills.notices = [{ kind: 'taken-in', items: ['notes', 'edited'], from: ['claude-cli'], history: 'take-notes', histories: ['take-notes', 'take-edited'] }];
  draw();
  assert.equal(textOf(addedLines()[0]), 'Added 2 skills from Claude Code: notes and edited. History can undo each.History');

  // Dismissed band, Undo's own result, or another Settings band with id 'outcome-undo' but no everythingUndo: every line keeps History.
  state.home.skills.library.edited = live('edited', 'v1') as never;
  state.home.skills.notices = [oldNotice, notesNotice];
  for (const outcome of [
    undefined,
    { page: 'settings' as const, band: true, settingsBand: true, text: 'Undone: switched off.' },
    { page: 'settings' as const, band: true, settingsBand: true, text: 'Other Undo.', act: { label: 'Undo', id: 'outcome-undo', run() {} } },
  ]) {
    state.outcome = outcome;
    draw();
    const lines = addedLines();
    assert.ok(lines.every(line => /History can undo it\.History$/.test(textOf(line))), `expected History on all lines: ${lines.map(textOf).join(' | ')}`);
  }
  state.outcome = undefined;
  state.history.data = undefined;
});

test('editing a taken-in skill in its tool restores History on its line while the band’s Undo still stands', () => {
  const live = (key: string, hash: string) => ({
    key, name: key, on: true, hash, except: [], versions: [{ hash, at: '2026-11-27T19:00:00Z', from: { how: 'found', harness: 'claude-cli' } }],
    applied: { 'claude-cli': hash, 'codex-cli': hash },
  });
  const ev = (id: string, kind: HistoryEvent['kind'], extra: Partial<HistoryEvent> = {}) =>
    ({ id, at: '2026-11-27T19:00:00Z', kind, item: id, key: id, losers: [], ...extra }) as HistoryEvent;
  state.dismissed.clear();
  state.home = makeHome({
    sync: { managed: ['claude-cli', 'codex-cli'], present: ['claude-cli', 'codex-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: true, caughtUp: [] },
    skills: {
      ...emptyKind(),
      library: { notes: live('notes', 'v1'), edited: live('edited', 'v2') },
      notices: [
        { kind: 'taken-in', items: ['notes'], from: ['claude-cli'], history: 'take-notes', histories: ['take-notes'] },
        { kind: 'taken-in', items: ['edited'], from: ['claude-cli'], history: 'take-edited', histories: ['take-edited'] },
      ],
    },
  });
  state.history.data = [
    ev('sw', 'everything', { everything: { ruleOn: true } }),
    ev('take-notes', 'on', { of: 'skill', key: 'notes', item: 'notes', cause: 'sync-everything', version: 'v1', winner: { tool: 'claude-cli', hash: 'v1' }, tookFrom: [{ tool: 'claude-cli', hash: 'v1' }], foundIn: ['claude-cli'] }),
    ev('take-edited', 'on', { of: 'skill', key: 'edited', item: 'edited', cause: 'sync-everything', version: 'v1', winner: { tool: 'claude-cli', hash: 'v1' }, tookFrom: [{ tool: 'claude-cli', hash: 'v1' }], foundIn: ['claude-cli'] }),
  ];
  state.outcome = { page: 'settings', band: true, settingsBand: true, everythingUndo: 'sw', text: 'Synchronize everything is on: it added 2 items.', act: { label: 'Undo', id: 'outcome-undo', run() {} } };
  draw();
  const lines = (findById(rendered, 'setting-sync-everything')?.querySelector('.setting-added')?.children ?? [])
    .filter((child): child is FakeNode => !!child && typeof child === 'object' && 'tag' in child);
  assert.deepEqual(lines.map(line => !!line.querySelector('.text-action')), [false, true], 'untouched notes hides History while edited skill restores History');
  state.outcome = undefined;
  state.history.data = undefined;
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
