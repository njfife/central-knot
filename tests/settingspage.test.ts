// Settings page progress updates and live descriptions (settingspage.ts, updateview.ts):
// update check/download/prepare progress announces through role="status" and updates in place without redrawing or moving focus,
// and plugin-text reading progress updates in place without redrawing even when no download-estimate hint is drawn (elsewhere = 0).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppPreferences, HomeView, PluginTextView, UpdateView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let onPluginText: ((view: PluginTextView) => void) | undefined;
let rendered: FakeNode | undefined;
let redraws = 0;

const settings: AppPreferences = {
  appearance: 'system',
  historyDays: 30,
  pluginUpdates: true,
  pluginText: true,
  signIn: { on: false, available: true },
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

const byId = (id: string) => (rendered ? findById(rendered, id) ?? null : null);
installDom(api, { byId });

// Extend the stub querySelector for the two selectors paintProgress and showTextRead read (`#id .class` and `.class`).
const matchesClass = (node: FakeNode, name: string) => node.className.split(/\s+/).includes(name);
const queryIn = (root: FakeNode | undefined, selector: string): FakeNode | null => {
  if (!root) return null;
  const parts = selector.trim().split(/\s+/);
  let scope: FakeNode | undefined = root;
  for (const part of parts) {
    if (!scope) return null;
    if (part.startsWith('#')) scope = findById(scope, part.slice(1));
    else if (part.startsWith('.')) scope = findNode(scope, el => matchesClass(el, part.slice(1)));
    else return null;
  }
  return scope ?? null;
};
const origCreate = document.createElement;
(document as unknown as Record<string, unknown>).createElement = (tag: string) => {
  const node = (origCreate as unknown as (tag: string) => FakeNode)(tag);
  let textOverride: string | undefined;
  Object.defineProperty(node, 'textContent', {
    get() { return textOverride ?? textOf(node); },
    set(value: string) { textOverride = value; node.children = [value]; },
    configurable: true,
  });
  node.querySelector = (selector: string) => queryIn(node, selector) as unknown as FakeNode;
  return node;
};
(document as unknown as Record<string, unknown>).querySelector = (selector: string) => queryIn(rendered, selector);

const { setRenderer, state } = await import('../src/app.ts');
const { loadSettings, settingsPage } = await import('../src/settingspage.ts');
const { takeUpdates, updates } = await import('../src/updateview.ts');

const fakeHome = (): HomeView => ({
  home: '/tmp/fake-settings-home',
  mode: 'custom',
  label: 'Test home',
  readId: 1,
  syncOn: true,
  sync: {
    managed: ['claude-cli'],
    present: ['claude-cli'],
    leftOut: [],
    access: { allowed: true },
    gate: { state: 'ready' },
    syncEverything: false,
    caughtUp: [],
  },
  skills: { tools: ['claude-cli'], items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] },
  mcp: { tools: ['claude-cli'], items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] },
  agents: { tools: ['claude-cli'], items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] },
  pluginItems: [],
  profiles: { profiles: [], plugins: [] },
  sessionCosts: { home: '/tmp/fake-settings-home', on: false, collecting: false, seq: 1 },
} as unknown as HomeView);

const danglingIds = (root: FakeNode): string[] => {
  const missing: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const el = node as FakeNode;
    for (const attr of ['aria-describedby', 'aria-labelledby']) {
      for (const id of (el.attrs?.[attr] ?? '').split(/\s+/).filter(Boolean)) {
        if (!findById(root, id)) missing.push(`${el.attrs?.id || el.tag}[${attr}]->${id}`);
      }
    }
    for (const child of el.children ?? []) walk(child);
  };
  walk(root);
  return missing;
};

const draw = () => { redraws++; rendered = settingsPage() as unknown as FakeNode; };
setRenderer(draw);
state.home = fakeHome();
state.page = 'settings';
await loadSettings();

test('app update check, download and prepare progress use role="status" and paint download progress in place without moving focus', () => {
  const available = { tag: 'v0.5.0-preview.5', download: 'https://example.test/u.zip', size: 1000, page: 'https://github.com/njfife/central-knot/releases/tag/v0.5.0-preview.5' };
  const base: UpdateView = { shown: true, version: '0.7.0', tag: 'v0.5.0-preview.4', checking: false, available };

  // Checking progress on Settings.
  takeUpdates({ ...base, checking: true });
  const focusHolder = findById(rendered, 'appearance-system')!;
  (document as unknown as Record<string, unknown>).activeElement = focusHolder;
  assert.equal(textOf(findById(rendered, 'setting-updates-hint')), 'This is Central Knot 0.5.0 preview 4.');
  assert.equal(findById(rendered, 'check-updates')?.attrs['aria-label'], 'Check for updates');
  assert.equal(findById(rendered, 'setting-updates-notice')?.attrs.role, 'status');
  assert.equal(textOf(queryIn(findById(rendered, 'setting-updates-notice'), '.setting-message-text')), 'Checking for updates…');
  assert.deepEqual(danglingIds(rendered!), []);

  // Entering download draws the progress notice with role="status"; further progress updates paint in place with no redraw and no focus change.
  takeUpdates({ ...base, step: 'downloading', progress: 0 });
  const noticeBefore = findById(rendered, 'setting-updates-notice')!;
  assert.equal(noticeBefore.attrs.role, 'status');
  assert.equal(textOf(queryIn(noticeBefore, '.setting-message-text')), 'Downloading 0.5.0 preview 5… 0%');
  const drawsBefore = redraws;
  const focusesBefore = focusHolder.focused;

  takeUpdates({ ...base, step: 'downloading', progress: 0.42 });
  assert.equal(redraws, drawsBefore, 'download progress updates in place without rerendering');
  assert.equal(findById(rendered, 'setting-updates-notice'), noticeBefore);
  assert.equal(textOf(queryIn(noticeBefore, '.setting-message-text')), 'Downloading 0.5.0 preview 5… 42%');
  assert.equal(document.activeElement, focusHolder);
  assert.equal(focusHolder.focused, focusesBefore);

  // Preparing renders role="status" without stealing focus.
  takeUpdates({ ...base, step: 'installing' });
  assert.equal(findById(rendered, 'setting-updates-notice')?.attrs.role, 'status');
  assert.equal(textOf(queryIn(findById(rendered, 'setting-updates-notice'), '.setting-message-text')), 'Preparing 0.5.0 preview 5…');
  assert.equal(document.activeElement, focusHolder);

  // Clean up shared update state.
  updates.view = undefined;
});

test('plugin text progress updates in place with no hint when elsewhere is zero, and rerenders once when elsewhere or reading state changes', () => {
  assert.ok(onPluginText, 'onPluginTextChanged registered');
  onPluginText!({ read: 2, of: 5, elsewhere: 0, reading: true, on: true });
  draw();

  const focusHolder = findById(rendered, 'plugin-text-on')!;
  (document as unknown as Record<string, unknown>).activeElement = focusHolder;
  assert.equal(findById(rendered, 'setting-plugin-text-hint'), undefined, 'no download estimate hint when elsewhere is zero');
  assert.equal(findById(rendered, 'setting-plugin-text-info')?.attrs['aria-label'], 'About Read what plugins hold');
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-info-card')), 'Keeps plugin items’ names, descriptions and first lines, so Find can search them.');
  assert.equal(focusHolder.attrs['aria-describedby'], 'setting-plugin-text-info-card setting-plugin-text-notice');
  assert.deepEqual(danglingIds(rendered!), []);

  const noticeBefore = findById(rendered, 'setting-plugin-text-notice')!;
  assert.equal(noticeBefore.attrs.role, 'status');
  assert.equal(textOf(noticeBefore), 'Reading: 2 of 5 plugins.');

  // Next progress tick with elsewhere still zero must update in place without rerendering or moving focus.
  const drawsBefore = redraws;
  onPluginText!({ read: 3, of: 5, elsewhere: 0, reading: true, on: true });
  assert.equal(redraws, drawsBefore, 'plugin text progress updates in place without rerendering when hint is absent');
  assert.equal(findById(rendered, 'setting-plugin-text-notice'), noticeBefore);
  assert.equal(textOf(noticeBefore), 'Reading: 3 of 5 plugins.');
  assert.equal(document.activeElement, focusHolder);

  // When elsewhere becomes non-zero, the row redraws once to add the download estimate hint and wire aria-describedby.
  onPluginText!({ read: 4, of: 5, elsewhere: 2, reading: true, on: true });
  assert.equal(redraws, drawsBefore + 1);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-hint')), 'The 2 outside their marketplace are downloaded once (under 1 MB), then only changes, or daily if on a branch.');
  assert.equal(findById(rendered, 'plugin-text-on')?.attrs['aria-describedby'], 'setting-plugin-text-info-card setting-plugin-text-hint setting-plugin-text-notice');
  assert.deepEqual(danglingIds(rendered!), []);

  // When reading finishes, the row redraws once and drops role="status" on the settled count.
  onPluginText!({ read: 5, of: 5, elsewhere: 2, reading: false, on: true });
  assert.equal(redraws, drawsBefore + 2);
  assert.equal(textOf(findById(rendered, 'setting-plugin-text-notice')), 'Read 5 of 5 plugins.');
  assert.equal(findById(rendered, 'setting-plugin-text-notice')?.attrs.role, undefined);
});
