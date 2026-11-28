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
  state.home.agents.library.reviewer = {
    key: 'reviewer', name: 'reviewer', on: true, hash: 'w',
    versions: ['w', 'x', 'y', 'z', 'p'].map(hash => ({ hash, at: '2026-11-27T10:00:00.000Z', from: { how: 'edited', tool: 'codex-cli' } })),
    except: [], applied: {}, own: {},
  };
  state.history.state = 'ready';
  const at = '2026-11-27T10:00:00.000Z';
  const five = ['claude-cli', 'copilot-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'] as HarnessId[];
  const conflictBase = { at, winner: { tool: 'codex-cli' as HarnessId, hash: 'w' }, previous: 'p', kind: 'conflict' as const, orderProved: true };
  state.history.data = [
    { id: 'unrecorded', at, key: 'instructions:old-del', item: 'old-del', kind: 'deleted', winner: { tool: 'claude-cli', hash: 'a' }, losers: [], orderProved: true },
    { id: 'all-six', at, key: 'notes', of: 'skill', item: 'notes', kind: 'off', cause: 'switch', losers: six.map(tool => ({ tool, hash: 'b' })), orderProved: true },
    { id: 'del-five', at, key: 'old-draft', of: 'skill', item: 'old-draft', kind: 'deleted', losers: five.map(tool => ({ tool, hash: 'b' })), orderProved: true },
    { id: 'on-over', at, key: 'draft-over', of: 'skill', item: 'draft-over', kind: 'on', cause: 'switch', losers: five.map(tool => ({ tool, hash: '' })), tookFrom: [{ tool: 'claude-cli', hash: 'old' }], orderProved: true },
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
    ['del-five', 'Deleted from Central Knot and removed from 5 of 6 tools', 'Claude Code, Copilot CLI, Pi, OpenCode and Antigravity'],
    ['on-over', 'Turned on: put in 5 of 6 tools — Claude Code’s own copy was written over and kept as a version.', 'Claude Code, Copilot CLI, Pi, OpenCode and Antigravity'],
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
  assert.deepEqual(
    ['copilot-cli', 'pi-cli', 'opencode-cli'].map(tool => textOf(findById(page, `history-lib-conflict-${tool}`))),
    ['Use Copilot CLI’s version', 'Use Pi’s version', 'Use OpenCode’s version'],
  );
});

test('History marks a name Central Knot holds now, the name of one it no longer holds saying so; its file opens under the row pressed, stays there through a newer entry, and goes with its row', () => {
  forgetHistoryFolds();
  state.home = makeHome(six, six);
  const held = { key: 'notes', name: 'notes', hash: 'n', versions: [], except: [], applied: {}, own: {} };
  // gone is deleted from Central Knot, and Claude Code still holds a found copy of that name.
  state.home.snapshots = [{ harness: 'claude-cli', skills: [{ folder: 'gone', directory: '/found/gone', realDirectory: '/found/gone', rootLabel: '~/.claude/skills' }] }] as unknown as HomeView['snapshots'];
  state.home.skills = { ...state.home.skills, items: [{ key: 'notes', name: 'notes', on: false, copies: {}, except: [] }, { key: 'gone', name: 'gone', copies: {}, except: [] }],
    library: { notes: { ...held, on: false }, gone: { ...held, key: 'gone', name: 'gone', on: false, deleted: true } } } as unknown as HomeView['skills'];
  const at = '2026-11-27T10:00:00.000Z';
  const entry = (id: string, key: string, kind: 'on' | 'off' | 'deleted', minutes: number): HistoryEvent => ({ id, at: new Date(Date.parse(at) + minutes * 60_000).toISOString(),
    key, of: 'skill', item: key, kind, cause: 'switch', losers: [{ tool: 'claude-cli', hash: 'n' }], orderProved: true });
  const entries = [entry('notes-on', 'notes', 'on', 0), entry('notes-off', 'notes', 'off', 1), entry('gone-deleted', 'gone', 'deleted', 2)];
  state.history.state = 'ready';
  state.history.data = entries;
  let page = draw();
  const inRow = (id: string, part: string) => findNode(findById(page, `history-row-${id}`), el => el.classList.contains(part));
  const name = (id: string) => findNode(findById(page, `history-row-${id}`), el => el.tag === 'strong')?.attrs.title;
  assert.deepEqual(['notes-on', 'notes-off', 'gone-deleted'].map(id => [!!inRow(id, 'row-file-btn'), name(id)]),
    [[true, 'notes'], [true, 'notes'], [false, 'gone: no longer in Central Knot']]);
  inRow('notes-on', 'row-file-btn')!.click();
  page = draw();
  assert.deepEqual(['notes-on', 'notes-off'].map(id => !!inRow(id, 'details-file-only')), [true, false]);
  state.history.data = [...entries, entry('notes-on-again', 'notes', 'on', 3)];
  page = draw();
  assert.deepEqual(['notes-on', 'notes-off', 'notes-on-again'].map(id => !!inRow(id, 'details-file-only')), [true, false, false]);
  // Keep shortened past its row, another row of notes still drawn: the file goes with its row, and does not come back with it.
  state.history.data = entries.slice(1);
  draw();
  state.history.data = entries;
  page = draw();
  assert.equal(findNode(page, el => el.classList.contains('details-file-only')), undefined);
  // Shortened until no entry is left: the same.
  inRow('notes-off', 'row-file-btn')!.click();
  state.history.data = [];
  draw();
  state.history.data = entries;
  page = draw();
  assert.equal(findNode(page, el => el.classList.contains('details-file-only')), undefined);
  // A stored file that holds one entry twice: History draws, the first of the two rows has the mark, and its file opens there.
  state.history.data = [entries[0], entries[0]];
  page = draw();
  const all = (node: unknown, part: string): FakeNode[] => (!node || typeof node !== 'object' ? []
    : [...((node as FakeNode).classList?.contains(part) ? [node as FakeNode] : []), ...((node as FakeNode).children ?? []).flatMap(child => all(child, part))]);
  assert.equal(all(page, 'row-file-btn').length, 1);
  all(page, 'row-file-btn')[0]!.click();
  assert.equal(all(draw(), 'details-file-only').length, 1);
});
