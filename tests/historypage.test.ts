// History page rendering (historypage.ts): Keep control in empty/no-managed states (via noToolsState),
// empty-state wording, recorded tool-list folds (all-tools, library & legacy conflicts), and zero-loser conflicts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppPreferences, HarnessId, HistoryEvent, HomeView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
let onRestore: ((choice?: string) => Partial<{ results: unknown[]; harnessWrites: number; reloads: unknown[]; made: string[]; stopped?: string }> | void) | undefined;
const settings: AppPreferences = { appearance: 'system', historyDays: 30, pluginUpdates: true, pluginText: true, signIn: { on: false, available: true } };
const noop = () => {};
installDom({
  getSettings: async () => ({ ...settings }),
  restore: async (_id: string, _home: string, choice?: string) => ({ results: [], harnessWrites: 1, reloads: [], made: [], ...(onRestore?.(choice) ?? {}) }),
  refresh: async () => state.home!,
  history: async () => ({ events: state.history.data ?? [], days: 30 }),
  onPluginTextChanged: noop, onUpdatesChanged: noop, onPluginUpdatesChanged: noop, onNavigate: noop,
  onSettingsChanged: noop, onSyncChanged: noop, onSessionCostsChanged: noop, onSaid: noop,
}, { byId: id => findById(rendered, id) ?? null });

const { restoreEvent, setRenderer, state } = await import('../src/app.ts');
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
    { ...conflictBase, id: 'lib-conflict-gone', key: 'agent:old-reviewer', of: 'agent', item: 'old-reviewer', losers: [{ tool: 'claude-cli', hash: 'p' }, { tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }, { tool: 'opencode-cli', hash: 'z' }] },
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
    ['lib-conflict', 'Codex’s edit was the latest, so it became the current version.'],
    ['lib-conflict-gone', 'Codex’s edit was the latest, so it became the current version. Edits from 3 of 6 tools are kept as versions.', 'Copilot CLI, Pi and OpenCode'],
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
  const trigger = findById(page, 'history-versions-lib-conflict');
  assert.equal(textOf(trigger), 'Use another version…');
  assert.equal(findById(page, 'history-lib-conflict-copilot-cli'), undefined);
});

test('History version fold: shared-tool line, file mark per kept version, 1-choice row with mark and no clause, acting() disables Use', () => {
  forgetHistoryFolds();
  state.page = 'history';
  state.busy = undefined;
  state.home = makeHome(six, six);
  const madeAt = '2026-11-27T10:00:00.000Z';
  const versions = (hashes: string[]) => hashes.map(hash => ({ hash, at: madeAt, from: { how: 'edited' as const, harness: 'codex-cli' as HarnessId } }));
  state.home.agents.library.reviewer = { key: 'reviewer', name: 'reviewer', on: true, hash: 'w', versions: versions(['w', 'x', 'y', 'z', 'p']), except: [], applied: {}, own: {} };
  const base = { at: madeAt, key: 'agent:reviewer', of: 'agent' as const, item: 'reviewer', orderProved: true };
  state.history.state = 'ready';
  state.history.data = [
    { ...base, id: 'c-dup', kind: 'conflict', winner: { tool: 'codex-cli', hash: 'w' }, previous: 'p', losers: [{ tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'x' }, { tool: 'opencode-cli', hash: 'z' }] },
    { ...base, id: 'c1', kind: 'conflict', winner: { tool: 'codex-cli', hash: 'w' }, previous: 'p', losers: [{ tool: 'pi-cli', hash: 'y' }] },
  ];

  let page = draw();
  // 1-choice row has link + file mark beside it and omits kept-versions clause.
  const row1 = findById(page, 'history-row-c1')!;
  assert.deepEqual([
    textOf(findById(row1, 'history-c1-pi-cli')),
    findNode(findNode(row1, el => el.classList.contains('history-choice-one')), el => el.classList.contains('row-file-btn'))?.attrs.title,
    textOf(findNode(row1, el => el.classList.contains('history-about'))),
  ], ['Use Pi’s version', 'Read Pi’s version', 'Codex’s edit was the latest, so it became the current version.']);

  // Shared hash shares one line with combined name, file mark, and Use (accessible name + hover).
  page = openFold(page, 'history-versions-fold-c-dup');
  const dupList = findById(page, 'history-versions-list-c-dup')!;
  const dupLines = dupList.children as FakeNode[];
  assert.deepEqual(dupLines.map(li => [
    textOf(findNode(li, el => el.classList.contains('history-version-who'))),
    findNode(li, el => el.classList.contains('row-file-btn'))?.attrs.title,
    textOf(findNode(li, el => el.classList.contains('btn'))),
    findNode(li, el => el.classList.contains('btn'))?.attrs['aria-label'],
    findNode(li, el => el.classList.contains('btn'))?.attrs.title,
  ]), [
    ['Copilot CLI and Pi’s version', 'Read Copilot CLI and Pi’s version', 'Use', 'Use Copilot CLI and Pi’s version', 'Use Copilot CLI and Pi’s version'],
    ['OpenCode’s version', 'Read OpenCode’s version', 'Use', 'Use OpenCode’s version', 'Use OpenCode’s version'],
  ]);

  // acting() disables Use with busy title.
  state.busy = 'Syncing…';
  page = draw();
  const busyUse = findById(page, 'history-c-dup-copilot-cli')!;
  assert.deepEqual(['disabled' in busyUse.attrs, busyUse.attrs.title], [true, 'Syncing…']);
  state.busy = undefined;
  forgetHistoryFolds();
});

test('History keyboard Use moves focus to the same row’s next Use, then surviving single link, then row', async () => {
  forgetHistoryFolds();
  state.page = 'history';
  state.busy = undefined;
  state.home = makeHome(six, six);
  const madeAt = '2026-11-27T10:00:00.000Z';
  const versions = (hashes: string[]) => hashes.map(hash => ({ hash, at: madeAt, from: { how: 'edited' as const, harness: 'codex-cli' as HarnessId } }));
  state.home.agents.library.reviewer = { key: 'reviewer', name: 'reviewer', on: true, hash: 'w', versions: versions(['w', 'x', 'y', 'z', 'p']), except: [], applied: {}, own: {} };
  const base = { at: madeAt, key: 'agent:reviewer', of: 'agent' as const, item: 'reviewer', orderProved: true };
  state.history.state = 'ready';
  state.history.data = [
    { ...base, id: 'c3', kind: 'conflict', winner: { tool: 'codex-cli', hash: 'w' }, previous: 'p', losers: [{ tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }, { tool: 'opencode-cli', hash: 'z' }] },
    { ...base, id: 'ch2', kind: 'chosen', winner: { tool: 'codex-cli', hash: 'w' }, losers: [{ tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }] },
  ];
  const pressKey = (id: string) => { const el = findById(rendered, id)!; el.focus(); el.onclick?.({ detail: 0, stopPropagation() {} }); };

  // 3→2: focuses next Use in same row.
  openFold(draw(), 'history-versions-fold-c3');
  onRestore = choice => { if (choice) state.home!.agents.library.reviewer!.hash = choice; };
  pressKey('history-c3-copilot-cli');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((document.activeElement as unknown as FakeNode)?.attrs.id, 'history-c3-pi-cli');

  // 2→1: focuses surviving single link; 1→0 (no choice left): focuses row with tabIndex -1.
  state.home.agents.library.reviewer.hash = 'w';
  openFold(draw(), 'history-versions-fold-ch2');
  pressKey('history-ch2-copilot-cli');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((document.activeElement as unknown as FakeNode)?.attrs.id, 'history-ch2-pi-cli');
  onRestore = choice => {
    state.home!.agents.library.reviewer!.hash = choice!;
    state.home!.agents.library.reviewer!.versions = versions(['w', choice!]);
  };
  pressKey('history-ch2-pi-cli');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual([(document.activeElement as unknown as FakeNode)?.attrs.id, findById(rendered, 'history-row-ch2')?.tabIndex], ['history-row-ch2', -1]);
  onRestore = undefined;
  forgetHistoryFolds();
});

const at = '2026-11-27T10:00:00.000Z';
const entry = (id: string, key: string, kind: 'on' | 'off' | 'deleted', minutes: number): HistoryEvent => ({ id, at: new Date(Date.parse(at) + minutes * 60_000).toISOString(),
  key, of: 'skill', item: key, kind, cause: 'switch', losers: [{ tool: 'claude-cli', hash: 'n' }], orderProved: true });
/**
 * A home whose library holds notes, Off, and gone, deleted (a tombstone), of which Claude Code still holds a found copy; draft
 * it has no record of. Each named in History, notes twice.
 */
function markedHome() {
  forgetHistoryFolds();
  state.home = makeHome(six, six);
  const held = { key: 'notes', name: 'notes', hash: 'n', versions: [], except: [], applied: {}, own: {} };
  state.home.snapshots = [{ harness: 'claude-cli', skills: [{ folder: 'gone', directory: '/found/gone', realDirectory: '/found/gone', rootLabel: '~/.claude/skills' }] }] as unknown as HomeView['snapshots'];
  state.home.skills = { ...state.home.skills, items: [{ key: 'notes', name: 'notes', on: false, copies: {}, except: [] }, { key: 'gone', name: 'gone', copies: {}, except: [] }],
    library: { notes: { ...held, on: false }, gone: { ...held, key: 'gone', name: 'gone', on: false, deleted: { at } } } } as unknown as HomeView['skills'];
  const entries = [entry('notes-on', 'notes', 'on', 0), entry('notes-off', 'notes', 'off', 1), entry('gone-deleted', 'gone', 'deleted', 2), entry('draft-off', 'draft', 'off', 2.5)];
  state.history.state = 'ready';
  state.history.data = entries;
  let page = draw();
  return { entries, draw: () => (page = draw()),
    inRow: (id: string, part: string) => findNode(findById(page, `history-row-${id}`), el => el.classList.contains(part)),
    name: (id: string) => findNode(findById(page, `history-row-${id}`), el => el.tag === 'strong')?.attrs.title };
}

test('History marks a name Central Knot holds now, and one it deleted (its last version kept); the name of one it no longer holds is muted and says so, one with no record has no mark; a file opens under the row pressed, stays there through a newer entry, and goes with its row', () => {
  const marked = markedHome(), { entries, inRow, name } = marked;
  assert.deepEqual(['notes-on', 'notes-off', 'gone-deleted', 'draft-off'].map(id => [!!inRow(id, 'row-file-btn'), name(id)]),
    [[true, 'notes'], [true, 'notes'], [true, 'gone: no longer in Central Knot'], [false, 'draft: no longer in Central Knot']]);
  inRow('notes-on', 'row-file-btn')!.click();
  marked.draw();
  assert.deepEqual(['notes-on', 'notes-off'].map(id => !!inRow(id, 'details-file-only')), [true, false]);
  state.history.data = [...entries, entry('notes-on-again', 'notes', 'on', 3)];
  marked.draw();
  assert.deepEqual(['notes-on', 'notes-off', 'notes-on-again'].map(id => !!inRow(id, 'details-file-only')), [true, false, false]);
  // Keep shortened past its row, another row of notes still drawn: the file goes with its row, and does not come back with it.
  state.history.data = entries.slice(1);
  marked.draw();
  state.history.data = entries;
  assert.equal(findNode(marked.draw(), el => el.classList.contains('details-file-only')), undefined);
  // Shortened until no entry is left: the same.
  inRow('notes-off', 'row-file-btn')!.click();
  state.history.data = [];
  marked.draw();
  state.history.data = entries;
  assert.equal(findNode(marked.draw(), el => el.classList.contains('details-file-only')), undefined);
  // A stored file that holds one entry twice: History draws, the first of the two rows has the mark, and its file opens there.
  state.history.data = [entries[0], entries[0]];
  const page = marked.draw();
  const all = (node: unknown, part: string): FakeNode[] => (!node || typeof node !== 'object' ? []
    : [...((node as FakeNode).classList?.contains(part) ? [node as FakeNode] : []), ...((node as FakeNode).children ?? []).flatMap(child => all(child, part))]);
  assert.equal(all(page, 'row-file-btn').length, 1);
  all(page, 'row-file-btn')[0]!.click();
  assert.equal(all(draw(), 'details-file-only').length, 1);
});

test('History: a deleted item restored while its last version kept is open under its row: its mark is the current version’s, and the kept one closes', () => {
  const marked = markedHome(), { inRow } = marked;
  inRow('gone-deleted', 'row-file-btn')!.click();
  marked.draw();
  assert.equal(!!inRow('gone-deleted', 'details-file-only'), true);
  // Restore lifts the tombstone (librarypass.ts): the item is held again, at the version it kept.
  delete (state.home!.skills.library.gone as { deleted?: unknown }).deleted;
  marked.draw();
  assert.deepEqual([!!inRow('gone-deleted', 'details-file-only'), inRow('gone-deleted', 'row-file-btn')?.attrs.id], [false, 'file-skills-gone-gone-deleted']);
});

test('History band after Use names the pressed version choice with Undo, groups shared tools, keeps the new row’s sentence, and leaves refusals as today', async () => {
  forgetHistoryFolds();
  state.page = 'history';
  state.busy = undefined;
  state.outcome = undefined;
  state.home = makeHome(six, six);
  const madeAt = '2026-11-27T10:00:00.000Z';
  const versions = [
    { hash: 'w', at: madeAt, from: { how: 'edited' as const, harness: 'codex-cli' as HarnessId } },
    { hash: 'x', at: madeAt, from: { how: 'edited' as const, harness: 'copilot-cli' as HarnessId } },
    { hash: 'y', at: madeAt, from: { how: 'edited' as const, harness: 'pi-cli' as HarnessId } },
    { hash: 'p', at: madeAt, from: { how: 'found' as const, harness: 'claude-cli' as HarnessId } },
  ];
  state.home.skills.library['active-skill'] = { key: 'active-skill', name: 'active-skill', on: true, hash: 'w', versions, except: [], applied: {}, own: {} };
  const base = { at: madeAt, key: 'active-skill', of: 'skill' as const, item: 'active-skill', kind: 'conflict' as const, winner: { tool: 'codex-cli' as HarnessId, hash: 'w' }, previous: 'p', orderProved: true };
  state.history.state = 'ready';
  state.history.data = [
    { ...base, id: 'c1', losers: [{ tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'y' }] },
    { ...base, id: 'c-shared', losers: [{ tool: 'copilot-cli', hash: 'x' }, { tool: 'pi-cli', hash: 'x' }] },
  ];
  let seq = 0;
  onRestore = choice => {
    const id = `made-${++seq}`;
    state.home!.skills.library['active-skill']!.hash = choice!;
    state.history.data = [...state.history.data!, {
      id, at: madeAt, key: 'active-skill', of: 'skill', item: 'active-skill', kind: 'current', version: choice!, previous: 'w',
      losers: [{ tool: 'claude-cli', hash: 'w' }, { tool: 'codex-cli', hash: 'w' }], orderProved: true,
    }];
    return { results: [], harnessWrites: 2, reloads: [], made: [id] };
  };
  await restoreEvent('c1', 'x');
  let page = draw();
  assert.equal(textOf(findNode(page, el => el.classList.contains('band-text'))), 'active-skill: Copilot CLI’s version is now current.');
  assert.equal(textOf(findById(page, 'outcome-undo')), 'Undo');
  assert.match(textOf(findNode(findById(page, 'history-row-made-1'), el => el.classList.contains('history-about'))), /^The version edited in Copilot CLI \(.*\) was made current, in Claude Code and Codex\.$/);

  state.home.skills.library['active-skill']!.hash = 'w';
  await restoreEvent('c-shared', 'x');
  page = draw();
  assert.equal(textOf(findNode(page, el => el.classList.contains('band-text'))), 'active-skill: Copilot CLI and Pi’s version is now current.');
  assert.equal(textOf(findById(page, 'outcome-undo')), 'Undo');

  onRestore = () => ({ results: [], harnessWrites: 0, reloads: [], made: [], stopped: 'That version is no longer in Central Knot’s store, so it can’t be made current.' });
  await restoreEvent('c1', 'x');
  page = draw();
  assert.deepEqual([
    textOf(findNode(page, el => el.classList.contains('band-text'))),
    findById(page, 'outcome-undo'),
    state.outcome?.warn,
  ], ['active-skill: That version is no longer in Central Knot’s store, so it can’t be made current.', undefined, true]);
  onRestore = undefined;
  state.outcome = undefined;
  forgetHistoryFolds();
});
