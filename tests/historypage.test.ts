// History page rendering (historypage.ts): Keep control in empty and no-managed states, empty-state wording,
// all-tools folds for recorded tool lists, conflict loser folds (library and legacy), and no manufactured names.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppPreferences, HarnessId, HistoryEvent, HomeView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
const settings: AppPreferences = {
  appearance: 'system',
  historyDays: 30,
  pluginUpdates: true,
  pluginText: true,
  signIn: { on: false, available: true },
};

installDom({
  getSettings: async () => ({ ...settings }),
  onPluginTextChanged() {},
  onUpdatesChanged() {},
  onPluginUpdatesChanged() {},
  onNavigate() {},
  onSettingsChanged() {},
  onSyncChanged() {},
  onSessionCostsChanged() {},
  onSaid() {},
}, { byId: id => (rendered ? findById(rendered, id) ?? null : null) });

const { setRenderer, state } = await import('../src/app.ts');
const { loadSettings } = await import('../src/settingspage.ts');
const { forgetHistoryFolds, historyPage } = await import('../src/historypage.ts');

const six: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'];
const makeHome = (present: HarnessId[], managed: HarnessId[]): HomeView => {
  const kind = { tools: managed, items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] };
  return {
    home: '/tmp/fake-history-home',
    mode: 'custom',
    label: 'Test home',
    readId: 1,
    syncOn: true,
    sync: {
      managed,
      present,
      leftOut: present.filter(tool => !managed.includes(tool)),
      access: { allowed: true },
      gate: { state: 'ready' },
      syncEverything: false,
      caughtUp: [],
    },
    skills: kind,
    mcp: kind,
    agents: kind,
    pluginItems: [],
    profiles: { profiles: [], plugins: [] },
  } as unknown as HomeView;
};

const draw = () => { rendered = historyPage() as unknown as FakeNode; return rendered; };
setRenderer(() => { draw(); });
state.page = 'history';
await loadSettings();

const allFolds = (node: unknown): FakeNode[] => {
  if (!node || typeof node !== 'object') return [];
  const el = node as FakeNode;
  const own = el.tag === 'details' && el.classList.contains('fold') ? [el] : [];
  return [...own, ...(el.children ?? []).flatMap(allFolds)];
};

const toggleFold = (node: FakeNode, id: string, open: boolean) => {
  const details = findById(node, id) as unknown as { open: boolean; ontoggle?: (event: unknown) => void };
  assert.ok(details, `expected fold #${id}`);
  details.open = open;
  details.ontoggle?.({ currentTarget: details });
};

test('History keeps the Keep selector reachable in empty/no-managed states alongside the home or Harnesses action', () => {
  state.history.state = 'ready';
  state.history.data = [];

  // No tools installed: Keep selector + Choose another home…
  state.home = makeHome([], []);
  let page = draw();
  assert.equal(textOf(findById(page, 'history-keep-label')), 'Keep history for');
  assert.ok(findById(page, 'history-days'));
  assert.equal(textOf(findById(page, 'history-choose-home')), 'Choose another home…');

  // Tools present, all left out: Keep selector + Open Harnesses
  state.home = makeHome(['claude-cli', 'codex-cli'], []);
  page = draw();
  assert.equal(textOf(findById(page, 'history-keep-label')), 'Keep history for');
  assert.ok(findById(page, 'history-days'));
  assert.equal(textOf(findById(page, 'history-open-harnesses')), 'Open Harnesses');

  // Managed tools, no events yet: Keep selector + plain empty-state sentence
  state.home = makeHome(['claude-cli', 'codex-cli'], ['claude-cli', 'codex-cli']);
  page = draw();
  assert.equal(textOf(findById(page, 'history-keep-label')), 'Keep history for');
  assert.equal(textOf(findNode(page, el => el.classList.contains('empty-body'))), 'Changes by sync and by you appear here, with Undo.');
});

test('History folds all-tools when recorded, folds conflict losers (library and legacy), and never manufactures unrecorded names', () => {
  forgetHistoryFolds();
  state.home = makeHome(six, six);
  state.history.state = 'ready';
  const at = '2026-11-27T10:00:00.000Z';
  const events: HistoryEvent[] = [
    // Legacy deletion with no recorded tool list: must stay unfolded and never manufacture names.
    { id: 'unrecorded', at, key: 'instructions:old-del', item: 'old-del', kind: 'deleted', winner: { tool: 'claude-cli', hash: 'a' }, losers: [], orderProved: true },
    // All 6 tools recorded on a switch event: folds to "all 6 tools" and opens to their names.
    { id: 'all-six', at, key: 'notes', of: 'skill', item: 'notes', kind: 'off', cause: 'switch', losers: six.map(tool => ({ tool, hash: 'b' })), orderProved: true },
    // Library conflict with 3 losing tools: folds via touchedTools.
    {
      id: 'lib-conflict', at, key: 'agent:reviewer', of: 'agent', item: 'reviewer', kind: 'conflict',
      winner: { tool: 'codex-cli', hash: 'w' }, previous: 'p',
      losers: [{ tool: 'claude-cli', hash: 'p' }, { tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }, { tool: 'opencode-cli', hash: 'z' }],
      orderProved: true,
    },
    // Legacy conflict with 3 losing tools including an old tool id no longer in the home (no library key -> historypage.ts describe).
    {
      id: 'legacy-conflict', at, key: '', item: 'clash', kind: 'conflict',
      winner: { tool: 'codex-cli', hash: 'w' }, previous: 'p',
      losers: [{ tool: 'claude-cli', hash: 'p' }, { tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }, { tool: 'old-cli' as HarnessId, hash: 'z' }],
      orderProved: true,
    },
  ];
  state.history.data = events;
  let page = draw();

  const row = (id: string) => findById(page, `history-row-${id}`);
  const about = (id: string) => findNode(row(id), el => el.classList.contains('history-about'));

  // Unrecorded tool list: 0 folds, literal text preserved.
  assert.equal(allFolds(about('unrecorded')).length, 0);
  assert.equal(textOf(about('unrecorded')), 'Deleted in Claude Code, then removed from the other tools it synced to.');

  // All 6 tools: 1 fold with label "all 6 tools", opens to exact recorded names.
  assert.equal(allFolds(about('all-six')).length, 1);
  assert.equal(textOf(about('all-six')), 'Turned off: removed from all 6 tools');
  toggleFold(page, 'history-tools-all-six-0', true);
  page = rendered!;
  assert.equal(textOf(findById(page, 'history-tools-names-all-six-0')), 'Claude Code, Copilot CLI, Codex, Pi, OpenCode and Antigravity');

  // Library conflict: 3 of 6 tools folded and opens to losing tools only (not unchanged Claude Code).
  assert.equal(allFolds(about('lib-conflict')).length, 1);
  assert.equal(textOf(about('lib-conflict')), 'Codex’s edit was the latest, so it became the current version. Edits from 3 of 6 tools are kept as versions.');
  toggleFold(page, 'history-tools-lib-conflict-0', true);
  page = rendered!;
  assert.equal(textOf(findById(page, 'history-tools-names-lib-conflict-0')), 'Copilot CLI, Pi and OpenCode');

  // Legacy conflict: 3 tools folded (old-cli not in home) and opens to exact recorded names.
  assert.equal(allFolds(about('legacy-conflict')).length, 1);
  assert.equal(textOf(about('legacy-conflict')), 'Codex’s edit won over edits in 3 tools');
  toggleFold(page, 'history-tools-legacy-conflict-0', true);
  page = rendered!;
  assert.equal(textOf(findById(page, 'history-tools-names-legacy-conflict-0')), 'Copilot CLI, Pi and old-cli');
});
