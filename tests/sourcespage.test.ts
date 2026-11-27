// Library sources page (sourcespage.ts): waiting band wording, WAIT_INFO and SYNC_INFO cards, every source row's Sync (?),
// Turn it on on every In Central Knot, Off line, and Turn it/them on on Add/Sync's band (with Undo and profile-left-use).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LibraryItem } from '../src/library.ts';
import type { Change, HistoryEvent, HomeView, PartKind, PassResult, SourceName, SourceResult, SourcesView, SourceView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
let applied: { kind: string; changes: Change[] }[] = [];
let restored: string[] = [];
let historyEvents: HistoryEvent[] = [];
let sourcesReloads = 0;
let homeNow!: HomeView;
let sourcesNow!: SourcesView;

const makeItem = (key: string, name: string, on: boolean): LibraryItem => ({
  key, name, on, hash: 'h1', versions: [], except: [], applied: {}, own: {},
});

const emptyKind = (items: LibraryItem[] = []) => ({
  tools: ['claude-cli', 'copilot-cli', 'codex-cli'],
  items: items.map(item => ({
    key: item.key, name: item.name, on: item.on, copies: {}, hashes: {},
    plan: { orderProved: true, keep: [], write: [], remove: [], forget: [], current: [], ownCopy: [] },
  })),
  library: Object.fromEntries(items.map(item => [item.key, item])),
  access: { allowed: true },
  gate: { state: 'ready' },
  problems: [],
  notices: [],
  unread: [],
});

function buildHome(items: { skills?: LibraryItem[]; agents?: LibraryItem[]; mcp?: LibraryItem[] }, profiles: HomeView['profiles']['profiles'] = []): HomeView {
  return {
    home: '/tmp/fake-sources-home',
    mode: 'custom',
    label: 'Test home',
    readId: 1,
    syncOn: true,
    snapshots: [
      { harness: 'claude-cli', root: '/tmp/fake-sources-home/.claude', discovery: 'found', detection: 'Installed', probe: { version: '2.0.0', detail: '' }, skills: [], issues: [] },
      { harness: 'copilot-cli', root: '/tmp/fake-sources-home/.copilot', discovery: 'found', detection: 'Installed', probe: { version: '1.0.0', detail: '' }, skills: [], issues: [] },
      { harness: 'codex-cli', root: '/tmp/fake-sources-home/.codex', discovery: 'found', detection: 'Installed', probe: { version: '1.0.0', detail: '' }, skills: [], issues: [] },
    ],
    sync: {
      managed: ['claude-cli', 'copilot-cli', 'codex-cli'],
      present: ['claude-cli', 'copilot-cli', 'codex-cli'],
      leftOut: [],
      access: { allowed: true },
      gate: { state: 'ready' },
      syncEverything: false,
      caughtUp: [],
    },
    skills: emptyKind(items.skills),
    agents: emptyKind(items.agents),
    mcp: emptyKind(items.mcp),
    pluginItems: [],
    profiles: { profiles, plugins: [] },
  } as unknown as HomeView;
}

const sourceRowOf = (id: string, link: string, names: SourceName[]): SourceView => ({
  id, link, repository: link, ref: 'main', folder: '', commit: 'abcdef1234567', commitAt: '2026-11-26T10:00:00Z',
  addedAt: '2026-11-26T10:00:00Z', readAt: '2026-11-26T10:00:00Z', holds: 'items', names,
});

function syncSourcesOnState() {
  const onOf = (kind: SourceName['kind'], key: string) => {
    const page = kind === 'skill' ? 'skills' : kind === 'agent' ? 'agents' : 'mcp';
    const item = homeNow[page].library[key];
    return item && !item.deleted ? item.on : undefined;
  };
  sourcesNow = {
    ...sourcesNow,
    sources: sourcesNow.sources.map(source => ({
      ...source,
      names: source.names.map(name => ({ ...name, on: onOf(name.kind, name.key) })),
    })),
  };
}

function runApply(kind: 'skills' | 'agents' | 'mcp', changes: Change[]): PassResult {
  applied.push({ kind, changes });
  const made: string[] = [];
  const results: PassResult['results'] = [];
  for (const change of changes) {
    const item = homeNow[kind].library[change.key];
    if (!item) continue;
    item.on = change.on;
    const fact = homeNow[kind].items.find(each => each.key === change.key);
    if (fact) fact.on = change.on;
    const id = `ev-${kind}-${change.key}-${historyEvents.length + 1}`;
    made.push(id);
    const part: PartKind = kind === 'skills' ? 'skill' : kind === 'agents' ? 'agent' : 'mcp';
    const eventKey = part === 'skill' ? change.key : `${part}:${change.key}`;
    historyEvents.push({
      id, at: new Date(Date.now() + historyEvents.length).toISOString(), key: eventKey, item: item.name,
      of: part, kind: change.on ? 'on' : 'off', version: item.hash, orderProved: true, losers: [],
    } as unknown as HistoryEvent);
    for (const harness of ['claude-cli', 'copilot-cli', 'codex-cli'] as const) {
      results.push({ item: item.name, harness, outcome: change.on ? 'written' : 'removed', message: '' });
    }
  }
  syncSourcesOnState();
  return { results, writes: results.length, reloads: [], made };
}

let pendingAddResult: SourceResult | undefined;

const api = {
  sources: async () => { sourcesReloads++; return sourcesNow; },
  refresh: async () => homeNow,
  applySkills: async (changes: Change[]) => runApply('skills', changes),
  applyAgents: async (changes: Change[]) => runApply('agents', changes),
  applyServers: async (changes: Change[]) => runApply('mcp', changes),
  addSource: async () => pendingAddResult!,
  history: async () => ({ events: historyEvents, days: 30 }),
  restore: async (id: string) => {
    restored.push(id);
    const event = historyEvents.find(each => each.id === id);
    if (event?.of) {
      const page = event.of === 'skill' ? 'skills' : event.of === 'agent' ? 'agents' : 'mcp';
      const key = event.of === 'skill' ? event.key : event.key.slice(`${event.of}:`.length);
      const item = homeNow[page].library[key];
      if (item) {
        item.on = false;
        const fact = homeNow[page].items.find(each => each.key === key);
        if (fact) fact.on = false;
      }
      syncSourcesOnState();
    }
    return { results: [], writes: 0, harnessWrites: 1, reloads: [], made: [] };
  },
  getSettings: async () => ({ historyDays: 30 }),
  onWindowShown() {},
  onSyncRequest() {},
  onNavigate() {},
  onSettingsChanged() {},
  onSessionCostsChanged() {},
  onSyncChanged() {},
  onSaid() {},
  onProfileSwitched() {},
  onPluginUpdatesChanged() {},
};

installDom(api, { byId: id => (rendered ? findById(rendered, id) ?? null : null) });

const { setRenderer, state } = await import('../src/app.ts');
const { sources, sourcesPage, whatItDid } = await import('../src/sourcespage.ts');

const draw = () => { rendered = sourcesPage() as unknown as FakeNode; };
setRenderer(draw);

const WAIT_CARD = 'Merge puts the source’s changes into yours, or changes nothing and names what clashes; Replace mine takes the source’s and keeps yours as a version. Keep mine leaves yours current, keeps the source’s as a version, and compares the source’s next change with that version.';
const SYNC_CARD = 'Syncs from the link now, and once a day while Automatic sync is on: changed items update unless changed here; removed ones turn off, with Undo.';

function reset(items: { skills?: LibraryItem[]; agents?: LibraryItem[]; mcp?: LibraryItem[] }, rows: SourceView[], profiles: HomeView['profiles']['profiles'] = []) {
  applied = [];
  restored = [];
  historyEvents = [];
  sourcesReloads = 0;
  homeNow = buildHome(items, profiles);
  sourcesNow = { sources: rows, kinds: ['skill', 'agent', 'mcp'], access: { allowed: true, reason: '' } };
  state.home = homeNow;
  state.page = 'sources';
  state.outcome = undefined;
  state.busy = undefined;
  sources.view = sourcesNow;
  sources.preview = undefined;
  sources.confirmRemove = undefined;
  sources.problem = undefined;
  draw();
}

const flush = async () => {
  for (let i = 0; i < 40 && (i < 2 || state.busy); i++) await new Promise(resolve => setTimeout(resolve, 5));
};

test('waiting Sync band names the items and directs to their rows without repeating the button explanations', () => {
  reset({ skills: [makeItem('deslop', 'deslop', true)] }, []);
  const one = whatItDid({ sourced: [{ kind: 'skill', name: 'deslop', answer: 'wait', written: [], removed: [] }] }, 'github.com/team/skills');
  assert.equal(one.text, 'deslop changed at the source: choose on its row.');
  const two = whatItDid({
    sourced: [
      { kind: 'skill', name: 'deslop', answer: 'wait', written: [], removed: [] },
      { kind: 'skill', name: 'notes', answer: 'wait', written: [], removed: [] },
    ],
  }, 'github.com/team/skills');
  assert.equal(two.text, 'deslop and notes changed at the source: choose on each one’s row.');
});

test('WAIT_INFO says what each button does and drops the two-causes claim; every source row gets its own Sync (?) with SYNC_INFO', () => {
  const s1 = sourceRowOf('s1', 'https://github.com/team/one', [
    { kind: 'skill', key: 'deslop', name: 'deslop', state: 'wait', on: true },
  ]);
  const s2 = sourceRowOf('s2', 'https://github.com/team/two', [
    { kind: 'skill', key: 'notes', name: 'notes', state: 'nothing', on: true },
  ]);
  reset({ skills: [makeItem('deslop', 'deslop', true), makeItem('notes', 'notes', true)] }, [s1, s2]);

  assert.equal(textOf(findById(rendered, 'source-wait-info-s1-skill-deslop-card')), WAIT_CARD);
  assert.equal(textOf(findById(rendered, 'source-sync-info-s1-card')), SYNC_CARD);
  assert.equal(textOf(findById(rendered, 'source-sync-info-s2-card')), SYNC_CARD);
  assert.equal(findById(rendered, 'source-check-s1')?.attrs['aria-describedby'], 'source-sync-info-s1-card');
  assert.equal(findById(rendered, 'source-check-s2')?.attrs['aria-describedby'], 'source-sync-info-s2-card');

  // Confirming remove on the first source leaves the second source's own Sync (?) intact.
  sources.confirmRemove = 's1';
  draw();
  assert.equal(findById(rendered, 'source-sync-info-s1'), undefined);
  assert.equal(textOf(findById(rendered, 'source-sync-info-s2-card')), SYNC_CARD);
});

test('every In Central Knot, Off line gets Turn it on; clicking it turns it on with profile-ended line and Undo restores it Off', async () => {
  const row = sourceRowOf('s1', 'https://github.com/team/one', [
    { kind: 'skill', key: 'deslop', name: 'deslop', state: 'nothing', on: false },
    { kind: 'skill', key: 'same-off', name: 'same-off', state: 'same', on: false },
    { kind: 'skill', key: 'already-on', name: 'already-on', state: 'nothing', on: true },
    { kind: 'mcp', key: 'local-only', name: 'local-only', state: 'leftOut', on: false, why: 'it runs files from the repository' },
  ]);
  reset(
    {
      skills: [makeItem('deslop', 'deslop', false), makeItem('same-off', 'same-off', false), makeItem('already-on', 'already-on', true)],
      mcp: [makeItem('local-only', 'local-only', false)],
    },
    [row],
    [{ id: 'p1', name: 'Everyday', items: ['skill:already-on'], switchesPluginItems: true }],
  );

  const btn1 = findById(rendered, 'source-turn-on-s1-skill-deslop');
  const btn2 = findById(rendered, 'source-turn-on-s1-skill-same-off');
  assert.equal(textOf(btn1), 'Turn it on');
  assert.equal(textOf(btn2), 'Turn it on');
  assert.match(btn1?.attrs.title ?? '', /Undo turns it off again\./);
  assert.equal(findById(rendered, 'source-turn-on-s1-skill-already-on'), undefined);
  assert.equal(findById(rendered, 'source-turn-on-s1-mcp-local-only'), undefined);

  btn1!.click();
  await flush();

  assert.deepEqual(applied, [{ kind: 'skills', changes: [{ key: 'deslop', on: true, except: [], seenOn: false }] }]);
  assert.equal(sourcesReloads, 1);
  assert.equal(state.outcome?.page, 'sources');
  assert.equal(textOf(findNode(rendered, el => el.className.includes('band-text'))), 'deslop is on in all 3 tools. Everyday stopped being the profile in use.');
  assert.equal(findById(rendered, 'source-turn-on-s1-skill-deslop'), undefined);
  assert.match(textOf(findNode(rendered, el => el.attrs['data-key'] === 'deslop')), /In Central Knot, On/);

  const undoBtn = findById(rendered, 'outcome-undo');
  assert.equal(textOf(undoBtn), 'Undo');
  undoBtn!.click();
  await flush();

  assert.equal(restored.length, 1);
  assert.equal(sourcesReloads, 2);
  assert.equal(textOf(findById(rendered, 'source-turn-on-s1-skill-deslop')), 'Turn it on');
  assert.match(textOf(findNode(rendered, el => el.className.includes('band-text'))), /Undone: deslop is as before\./);
});

test('Add band drops Turn it/them on in the Library, offers Turn them on across kinds with profile line and Undo, and never shadows a drop Turn on', async () => {
  const oneSaid = whatItDid({ sourced: [{ kind: 'skill', name: 'deslop', answer: 'make', written: [], removed: [] }] }, 'github.com/team/one');
  assert.equal(oneSaid.text, 'deslop is in Central Knot. It is off.');

  const renamed = whatItDid({
    sourced: [
      { kind: 'skill', name: 'deslop', answer: 'drop', history: 'ev-drop', written: [], removed: ['claude-cli'] },
      { kind: 'skill', name: 'unslop', answer: 'make', written: [], removed: [] },
    ],
  }, 'github.com/team/one');
  assert.equal(renamed.undo?.label, 'Turn deslop on');
  assert.match(renamed.text, /unslop is in Central Knot\. It is off\.$/);

  const kitRow = sourceRowOf('kit', 'https://github.com/team/kit', [
    { kind: 'skill', key: 'notes', name: 'notes', state: 'nothing', on: false },
    { kind: 'agent', key: 'reviewer', name: 'reviewer', state: 'nothing', on: false },
    { kind: 'mcp', key: 'relay', name: 'relay', state: 'nothing', on: false },
  ]);
  reset(
    {
      skills: [makeItem('kept', 'kept', true), makeItem('notes', 'notes', false)],
      agents: [makeItem('reviewer', 'reviewer', false)],
      mcp: [makeItem('relay', 'relay', false)],
    },
    [],
    [{ id: 'p1', name: 'Everyday', items: ['skill:kept'], switchesPluginItems: true }],
  );

  sources.preview = {
    token: 'tok-1', link: 'https://github.com/team/kit', repository: 'https://github.com/team/kit', ref: 'main', folder: '',
    holds: 'items', names: [
      { kind: 'skill', key: 'notes', name: 'notes', state: 'make' },
      { kind: 'agent', key: 'reviewer', name: 'reviewer', state: 'make' },
      { kind: 'mcp', key: 'relay', name: 'relay', state: 'make' },
    ],
  };
  sourcesNow = { sources: [kitRow], kinds: ['skill', 'agent', 'mcp'], access: { allowed: true, reason: '' } };
  pendingAddResult = {
    sourced: [
      { kind: 'skill', name: 'notes', answer: 'make', written: [], removed: [] },
      { kind: 'agent', name: 'reviewer', answer: 'make', written: [], removed: [] },
      { kind: 'mcp', name: 'relay', answer: 'make', written: [], removed: [] },
    ],
    reloads: [],
    view: sourcesNow,
  };
  draw();
  findById(rendered, 'source-add')!.click();
  await flush();

  assert.equal(textOf(findNode(rendered, el => el.className.includes('band-text'))), 'Added github.com/team/kit. notes, reviewer and relay are in Central Knot. All 3 are off.');
  const turnAll = findById(rendered, 'source-turn-made-on');
  assert.equal(textOf(turnAll), 'Turn them on');
  assert.equal(textOf(findById(rendered, 'source-open-library')), 'Open in the Library');

  turnAll!.click();
  await flush();

  assert.deepEqual(applied.map(call => [call.kind, call.changes.map(change => change.key)]), [
    ['skills', ['notes']], ['agents', ['reviewer']], ['mcp', ['relay']],
  ]);
  assert.equal(sourcesReloads, 1);
  assert.equal(textOf(findNode(rendered, el => el.className.includes('band-text'))), 'Turned on 3 items: notes, reviewer and relay. Everyday stopped being the profile in use.');
  assert.equal(findById(rendered, 'source-turn-on-kit-skill-notes'), undefined);
  assert.equal(findById(rendered, 'source-turn-on-kit-agent-reviewer'), undefined);
  assert.equal(findById(rendered, 'source-turn-on-kit-mcp-relay'), undefined);

  findById(rendered, 'outcome-undo')!.click();
  await flush();

  assert.equal(restored.length, 3);
  assert.equal(sourcesReloads, 2);
  assert.equal(textOf(findById(rendered, 'source-turn-on-kit-skill-notes')), 'Turn it on');
  assert.equal(textOf(findById(rendered, 'source-turn-on-kit-agent-reviewer')), 'Turn it on');
  assert.equal(textOf(findById(rendered, 'source-turn-on-kit-mcp-relay')), 'Turn it on');
});
