// History page rendering (historypage.ts): Keep control in empty/no-managed states (via noToolsState),
// empty-state wording, recorded tool-list folds (all-tools, library & legacy conflicts), and zero-loser conflicts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppPreferences, HarnessId, HistoryEvent, HomeView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
const settings: AppPreferences = { appearance: 'system', historyDays: 30, pluginUpdates: true, pluginText: true, signIn: { on: false, available: true } };
const noop = () => {};
installDom({
  getSettings: async () => ({ ...settings }),
  onPluginTextChanged: noop, onUpdatesChanged: noop, onPluginUpdatesChanged: noop, onNavigate: noop,
  onSettingsChanged: noop, onSyncChanged: noop, onSessionCostsChanged: noop, onSaid: noop,
}, { byId: id => (rendered ? findById(rendered, id) ?? null : null) });

const { setRenderer, state } = await import('../src/app.ts');
const { loadSettings } = await import('../src/settingspage.ts');
const { forgetHistoryFolds, historyPage } = await import('../src/historypage.ts');

const six: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'];
const makeHome = (present: HarnessId[], managed: HarnessId[]): HomeView => {
  const kind = { tools: managed, items: [], library: {}, access: { allowed: true }, gate: { state: 'ready' }, problems: [], notices: [], unread: [] };
  return {
    home: '/tmp/fake-history-home', mode: 'custom', label: 'Test home', readId: 1, syncOn: true,
    sync: { managed, present, leftOut: present.filter(tool => !managed.includes(tool)), access: { allowed: true }, gate: { state: 'ready' }, syncEverything: false, caughtUp: [] },
    skills: kind, mcp: kind, agents: kind, pluginItems: [], profiles: { profiles: [], plugins: [] },
  } as unknown as HomeView;
};

const draw = () => (rendered = historyPage() as unknown as FakeNode);
setRenderer(() => { draw(); });
state.page = 'history';
await loadSettings();

const allFolds = (node: unknown): FakeNode[] => {
  if (!node || typeof node !== 'object') return [];
  const el = node as FakeNode;
  return [...(el.tag === 'details' && el.classList.contains('fold') ? [el] : []), ...(el.children ?? []).flatMap(allFolds)];
};
const openFold = (node: FakeNode, id: string) => {
  const details = findById(node, id) as unknown as { open: boolean; ontoggle?: (event: unknown) => void };
  assert.ok(details, `expected fold #${id}`);
  details.open = true;
  details.ontoggle?.({ currentTarget: details });
  return rendered!;
};

test('History keeps the Keep selector reachable in empty/no-managed states via noToolsState', () => {
  state.history.state = 'ready';
  state.history.data = [];
  for (const [present, buttonId, label] of [[[], 'history-choose-home', 'Choose another home…'], [['claude-cli', 'codex-cli'], 'history-open-harnesses', 'Open Harnesses']] as [HarnessId[], string, string][]) {
    state.home = makeHome(present, []);
    const page = draw();
    assert.equal(textOf(findById(page, 'history-keep-label')), 'Keep history for');
    assert.ok(findById(page, 'history-days'));
    assert.equal(textOf(findById(page, buttonId)), label);
    assert.equal(findById(page, 'history-scroll'), undefined);
    assert.equal(findById(page, 'history-no-tools-scroll')?.classList.contains('scroll'), true);
  }
  state.home = makeHome(['claude-cli', 'codex-cli'], ['claude-cli', 'codex-cli']);
  const page = draw();
  assert.equal(textOf(findById(page, 'history-keep-label')), 'Keep history for');
  assert.equal(textOf(findNode(page, el => el.classList.contains('empty-body'))), 'Changes by sync and by you appear here, with Undo.');
});

test('History folds all-tools and conflict losers, leaves unrecorded and zero-loser conflicts unfolded', () => {
  forgetHistoryFolds();
  state.home = makeHome(six, six);
  state.history.state = 'ready';
  const at = '2026-11-27T10:00:00.000Z';
  const conflictBase = { at, winner: { tool: 'codex-cli' as HarnessId, hash: 'w' }, previous: 'p', kind: 'conflict' as const, orderProved: true };
  state.history.data = [
    { id: 'unrecorded', at, key: 'instructions:old-del', item: 'old-del', kind: 'deleted', winner: { tool: 'claude-cli', hash: 'a' }, losers: [], orderProved: true },
    { id: 'all-six', at, key: 'notes', of: 'skill', item: 'notes', kind: 'off', cause: 'switch', losers: six.map(tool => ({ tool, hash: 'b' })), orderProved: true },
    { ...conflictBase, id: 'lib-conflict', key: 'agent:reviewer', of: 'agent', item: 'reviewer', losers: [{ tool: 'claude-cli', hash: 'p' }, { tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }, { tool: 'opencode-cli', hash: 'z' }] },
    { ...conflictBase, id: 'legacy-conflict', key: '', item: 'clash', losers: [{ tool: 'claude-cli', hash: 'p' }, { tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }, { tool: 'old-cli' as HarnessId, hash: 'z' }] },
    { ...conflictBase, id: 'legacy-no-losers', key: '', item: 'lone-clash', losers: [] },
    { ...conflictBase, id: 'legacy-no-losers-order', key: '', item: 'lone-clash-2', losers: [{ tool: 'claude-cli', hash: 'p' }], orderProved: false },
  ] satisfies HistoryEvent[];

  let page = draw();
  const about = (id: string) => findNode(findById(page, `history-row-${id}`), el => el.classList.contains('history-about'));

  for (const [id, text, opened] of [
    ['unrecorded', 'Deleted in Claude Code, then removed from the other tools it synced to.'],
    ['all-six', 'Turned off: removed from all 6 tools', 'Claude Code, Copilot CLI, Codex, Pi, OpenCode and Antigravity'],
    ['lib-conflict', 'Codex’s edit was the latest, so it became the current version. Edits from 3 of 6 tools are kept as versions.', 'Copilot CLI, Pi and OpenCode'],
    ['legacy-conflict', 'Codex’s edit won over edits in 3 tools', 'Copilot CLI, Pi and old-cli'],
    ['legacy-no-losers', 'Codex’s edit won over another’s.'],
    ['legacy-no-losers-order', 'Codex’s edit won over another’s. Order not proved; the fixed tool order decided.'],
  ] as [string, string, string?][]) {
    assert.equal(allFolds(about(id)).length, opened ? 1 : 0, id);
    assert.equal(textOf(about(id)), text, id);
    if (opened) {
      page = openFold(page, `history-tools-${id}-0`);
      assert.equal(textOf(findById(page, `history-tools-names-${id}-0`)), opened, id);
    }
  }
});
