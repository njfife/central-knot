// Settings plugin-text row transitions (settingspage.ts showTextRead, pluginTextRow):
// download-estimate hint appearing and disappearing, reading-state tone transitions, and idle zero counts.
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

const settings: AppPreferences = {
  appearance: 'system',
  historyDays: 30,
  pluginUpdates: true,
  pluginText: true,
  signIn: { on: false, available: true },
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

const emptyKind = { tools: ['claude-cli'], items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] };
state.home = {
  home: '/tmp/fake-settings-home',
  mode: 'custom',
  label: 'Test home',
  readId: 1,
  syncOn: true,
  sync: { managed: ['claude-cli'], present: ['claude-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: false, caughtUp: [] },
  skills: emptyKind,
  mcp: emptyKind,
  agents: emptyKind,
  pluginItems: [],
  profiles: { profiles: [], plugins: [] },
  sessionCosts: { home: '/tmp/fake-settings-home', on: false, collecting: false, seq: 1 },
} as unknown as HomeView;

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

  // Hint appears when elsewhere grows from 0 to 2.
  onPluginText!({ read: 4, of: 5, elsewhere: 2, reading: true, on: true });
  assert.equal(redraws, drawsBefore + 1);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-hint')), 'The 2 outside their marketplace are downloaded once (under 1 MB), then only changes, or daily if on a branch.');
  assert.equal(findById(rendered, 'plugin-text-on')?.attrs['aria-describedby'], 'setting-plugin-text-info-card setting-plugin-text-hint setting-plugin-text-notice');

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

  // Reading finishes: redraws once to clear progress tone and role.
  onPluginText!({ read: 5, of: 5, elsewhere: 0, reading: false, on: true });
  assert.equal(redraws, drawsBefore + 1);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-notice')), 'Read 5 of 5 plugins.');
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.classList.contains('setting-progress'), false);
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.attrs.role, undefined);

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
