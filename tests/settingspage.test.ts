// Settings row words and transitions (settingspage.ts, pluginupdateview.ts):
// download-estimate hint and unread-count tails, plugin-update card truth, and Synchronize everything copy and History link.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppPreferences, HomeView, PluginTextView } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

let onPluginText: ((view: PluginTextView) => void) | undefined;
let rendered: FakeNode | undefined;
let redraws = 0;

let settings: AppPreferences = {
  appearance: 'system',
  historyDays: 30,
  pluginUpdates: true,
  pluginText: true,
  signIn: { on: false, available: true },
  tray: true,
};

const api = {
  getSettings: async () => settings,
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
const { loadSettings, settingsPage } = await import('../src/settingspage.ts');
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
    'Keeps plugin items’ names, descriptions and first lines, so Find can search them. Plugins outside their marketplace fetch only changes after the first download (or daily on a branch); any that can’t be read are tried again later.');

  // Unread count drops the standing retry tail, which now lives in the card.
  onPluginText!({ read: 4, of: 5, elsewhere: 1, reading: false, on: true });
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-hint')), 'The one plugin outside its marketplace is downloaded once (under 1 MB).');
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-notice')), 'Read 4 of 5 plugins. 1 couldn’t be read.');

  // Hint disappears again when elsewhere drops back to 0.
  onPluginText!({ read: 4, of: 5, elsewhere: 0, reading: true, on: true });
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
    'Checks soon after opening and every four hours, window closed too. A plugin you turned off stays off.');
  assert.equal(textOf(findById(rendered, 'setting-plugin-updates-notice')), 'Not checked yet in this home.');

  // Without a system tray, closing the window quits, so "window closed too" is untrue.
  assert.equal(await setPrefs({ pluginUpdates: true, tray: false }),
    'Checks soon after opening and every four hours while this window stays open. A plugin you turned off stays off.');

  // Switch off: qualifies the schedule with "When on" and still respects tray absence.
  assert.equal(await setPrefs({ pluginUpdates: false, tray: true }),
    'When on, checks soon after opening and every four hours, window closed too. A plugin you turned off stays off.');
  assert.equal(await setPrefs({ pluginUpdates: false, tray: false }),
    'When on, checks soon after opening and every four hours while this window stays open. A plugin you turned off stays off.');

  // Automatic sync off: paused, so "every four hours" is not claimed (both from view.paused and from home.syncOn before view arrives).
  pluginUpdates.view = { on: true, paused: true, checking: false, updated: [], failed: [], first: true };
  assert.equal(await setPrefs({ pluginUpdates: true, tray: true }),
    'Paused while Automatic sync is off. A plugin you turned off stays off.');
  assert.equal(await setPrefs({ pluginUpdates: false, tray: true }),
    'Paused while Automatic sync is off. A plugin you turned off stays off.');
  pluginUpdates.view = undefined;
  state.home = makeHome({ syncOn: false });
  assert.equal(await setPrefs({ pluginUpdates: true, tray: true }),
    'Paused while Automatic sync is off. A plugin you turned off stays off.');

  state.home = makeHome();
  settings = { ...settings, pluginUpdates: true, tray: true };
  await loadSettings();
});

test('Synchronize everything card tells it apart from Automatic sync, puts waiting last, names the Library, and hides History during band Undo', () => {
  const deletedFact = (key: string) => ({
    key, name: key, description: '', copies: {}, except: [], cannot: {}, edited: [],
    takeInAnswers: { click: { take: 'h1' }, rule: { leave: 'deleted' } },
  });
  const waitingFact = (key: string) => ({
    key, name: key, description: '', copies: {}, except: [], cannot: {}, edited: [],
    takeInAnswers: { click: { wait: true }, rule: { wait: true } },
  });
  const notice = { kind: 'taken-in', items: ['notes'], from: ['claude-cli'], history: 'take-notes' };

  // Off, 1 taken out + 1 waiting: drops "earlier", names "its row in the Library", waiting last beside Choose copies.
  state.outcome = undefined;
  state.dismissed.clear();
  state.home = makeHome({
    skills: { ...emptyKind(), items: [deletedFact('old-one'), waitingFact('review')] },
  });
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-info-card')),
    'What turns up in a tool is turned on in every tool Central Knot manages; items whose copies differ wait for your choice. Automatic sync in the status bar keeps items already in Central Knot in step.');
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    'Nothing found in your tools now would be added. 1 found item was taken out of Central Knot and isn’t added by itself again: Add on its row in the Library, or Restore in History, brings it back. 1 found item has copies that differ and waits for your choice of copy.Choose copies');

  // Plural taken out: drops "earlier" and uses "its row in the Library".
  state.home = makeHome({
    skills: { ...emptyKind(), items: [deletedFact('old-one'), deletedFact('old-two'), waitingFact('review')] },
  });
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    'Nothing found in your tools now would be added. 2 found items were taken out of Central Knot and aren’t added by themselves again: Add on its row in the Library, or Restore in History, brings one back. 1 found item has copies that differ and waits for your choice of copy.Choose copies');

  // On with Automatic sync off + waiting: "later" comes before "waiting", so waiting stays last beside Choose copies.
  state.home = makeHome({
    syncOn: false,
    sync: { managed: ['claude-cli', 'codex-cli'], present: ['claude-cli', 'codex-cli'], leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: true, caughtUp: [] },
    skills: { ...emptyKind(), items: [waitingFact('review')], notices: [notice] },
  });
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-notice')),
    'Automatic sync is off, so it takes items in at Sync once. 1 found item has copies that differ and waits for your choice of copy.Choose copies');

  // While state.outcome holds this switch's Undo, the take-in line drops "History can undo it." and its History button.
  state.outcome = { page: 'settings', band: true, settingsBand: true, text: 'Synchronize everything is on.', act: { label: 'Undo', id: 'outcome-undo', run() {} } };
  draw();
  assert.equal(textOf(findById(rendered, 'setting-sync-everything-added-skills')),
    'Synchronize everything took in 1 skill, found in Claude Code: notes.');
  assert.equal(findById(rendered, 'setting-sync-everything-added-skills-action'), undefined);

  // Dismissed band, Undo's own result (no act), or a non-switch outcome on Settings (no settingsBand): History returns.
  for (const outcome of [
    undefined,
    { page: 'settings' as const, band: true, settingsBand: true, text: 'Undone: switched off.' },
    { page: 'settings' as const, band: true, text: 'Switched to Everyday.', act: { label: 'Undo switch', id: 'outcome-undo', run() {} } },
  ]) {
    state.outcome = outcome;
    draw();
    assert.equal(textOf(findById(rendered, 'setting-sync-everything-added-skills')),
      'Synchronize everything took in 1 skill, found in Claude Code: notes. History can undo it.History');
    assert.ok(findById(rendered, 'setting-sync-everything-added-skills-action'));
  }
  state.outcome = undefined;
});
