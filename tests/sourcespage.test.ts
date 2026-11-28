// Library sources page (sourcespage.ts): row and band Turn on (matching the Library's click, live state at the press, exact Undo),
// waiting band and three-line info card, per-row Sync (?), mixed Add/Sync bands, profile-end forecast, and mixed-case keys.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyAgents, agentsView, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/history.ts';
import { libraryEntry } from '../src/historyactions.ts';
import { applyServers, restoreServer, serversView } from '../src/servers.ts';
import { applySkills, restoreSkill, skillsView } from '../src/skills.ts';
import { addSource, checkSource, previewSource, rowClick, sourcesView } from '../src/sources.ts';
import type { Change, HarnessId, HomeView, InstalledPlugin, Profile, SourceName, SourceResult, SourcesView, SourceView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';
import { everywhere, folderOf, put, sandbox, skillText, type Box } from './skillclicks.ts';
import { repository, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

let rendered: FakeNode | undefined;
let boxNow: Box | undefined;
let extraHome: Partial<HomeView> = {};
let patchSkills: ((skills: HomeView['skills']) => HomeView['skills']) | undefined;
let pluginCalls: unknown[][] = [];
let sourcesNow: SourcesView | undefined;
let pendingAdd: SourceResult | undefined;
let pendingCheck: SourceResult | undefined;

async function readBoxHome(box: Box): Promise<HomeView> {
  const [rawSkills, agents, mcp] = await Promise.all([
    skillsView(box.context, box.tools),
    agentsView(box.context, box.tools),
    serversView(box.context, box.tools),
  ]);
  const skills = patchSkills ? patchSkills(rawSkills) : rawSkills;
  return {
    home: box.home, mode: 'custom', label: 'Test home', readId: 1, syncOn: true, practice: false,
    snapshots: box.tools.map(harness => ({ harness, root: box.home, discovery: 'found', detection: 'Installed', probe: { version: '1.0', detail: '' }, skills: [], issues: [] })),
    sync: { managed: box.tools, present: box.tools, leftOut: [], access: { allowed: true, reason: '' }, gate: { state: 'ready' }, syncEverything: false, caughtUp: [] },
    skills, agents, mcp, pluginItems: [], profiles: { profiles: [], plugins: [] },
    ...extraHome,
  } as unknown as HomeView;
}

const api = {
  sources: async () => (boxNow ? sourcesView(boxNow.context, boxNow.tools) : sourcesNow ?? null),
  refresh: async () => (boxNow ? readBoxHome(boxNow) : state.home),
  applySkills: async (changes: Change[]) => applySkills(boxNow!.context, boxNow!.tools, changes),
  applyAgents: async (changes: Change[]) => applyAgents(boxNow!.context, boxNow!.tools, changes),
  applyServers: async (changes: Change[]) => applyServers(boxNow!.context, boxNow!.tools, changes),
  setPluginSkill: async (...args: unknown[]) => {
    pluginCalls.push(args);
    return { reports: [{ tool: args[4] as HarnessId, outcome: (args[5] ? 'skill-on' : 'skill-off') as const, changed: true, message: 'Switched.', runs: [] }] };
  },
  addSource: async (token: string) => (pendingAdd ?? addSource(boxNow!.context, boxNow!.tools, token)),
  checkSource: async (id: string) => (pendingCheck ?? checkSource(boxNow!.context, async () => boxNow!.tools, id, work => work())),
  history: async () => ({ events: boxNow ? await readHistory(boxNow.context) : [], days: 30 }),
  restore: async (id: string) => {
    const events = await readHistory(boxNow!.context);
    const entry = events.find(event => event.id === id);
    const kind = entry && libraryEntry(entry)?.kind;
    if (kind === 'agents') return restoreAgent(boxNow!.context, boxNow!.tools, id);
    if (kind === 'mcp') return restoreServer(boxNow!.context, boxNow!.tools, id);
    return restoreSkill(boxNow!.context, boxNow!.tools, id);
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

const { applyClick, setRenderer, state } = await import('../src/app.ts');
const { turnOnRow } = await import('../src/matrix.ts');
const { sources, sourcesPage, whatItDid } = await import('../src/sourcespage.ts');

const draw = () => { rendered = sourcesPage() as unknown as FakeNode; };
setRenderer(draw);

const flush = async () => {
  for (let i = 0; i < 60 && (i < 3 || state.busy); i++) await new Promise(resolve => setTimeout(resolve, 10));
};

const allNodes = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) allNodes(child, match, out);
  return out;
};

async function openOnBox(box: Box, extra: Partial<HomeView> = {}, onSkills?: (skills: HomeView['skills']) => HomeView['skills']) {
  boxNow = box;
  extraHome = extra;
  patchSkills = onSkills;
  pluginCalls = [];
  pendingAdd = undefined;
  pendingCheck = undefined;
  sourcesNow = undefined;
  state.page = 'sources';
  state.outcome = undefined;
  state.busy = undefined;
  state.home = await readBoxHome(box);
  sources.view = await sourcesView(box.context, box.tools);
  sources.preview = undefined;
  sources.confirmRemove = undefined;
  sources.problem = undefined;
  draw();
}

async function addViaPage(box: Box, link: string) {
  const look = await previewSource(box.context, box.tools, link);
  assert.ok('token' in look && !look.refused, `preview failed: ${'refused' in look ? look.refused : ''}`);
  sources.preview = look;
  draw();
  findById(rendered, 'source-add')!.click();
  await flush();
}

const sourceViewOf = (id: string, link: string, names: SourceName[]): SourceView => ({
  id, link, repository: link, ref: 'main', folder: '', commit: 'abcdef1234567', commitAt: '2026-11-26T10:00:00Z',
  addedAt: '2026-11-26T10:00:00Z', readAt: '2026-11-26T10:00:00Z', holds: 'items', names,
});

const kitFiles = {
  'notes/SKILL.md': skillText('Take notes.', 'notes'),
  'agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews code.\ntools: Read, Grep\n---\n\nYou review code.\n',
  '.mcp.json': `${JSON.stringify({ mcpServers: { relay: { command: 'relay-mcp', env: { A: '1' } } } }, null, 2)}\n`,
};

test('Turn it on on Library sources matches the Library switch by making the same disk writes and enabling a disabled plugin item', async () => {
  const repo = await repository(hosts, 'https://github.com/team/plugin-match');
  await repo.commit({ 'SKILL.md': skillText('Take notes.', 'notes') }, '2026-11-01T10:00:00Z');
  const pluginItems: InstalledPlugin[] = [{
    tool: 'copilot-cli', source: '/market', marketName: 'team', plugin: 'kit', off: false,
    skillsOff: ['notes'], listed: true,
    items: [{ kind: 'skill', name: 'notes' }],
  }];
  const withPlugin = (s: HomeView['skills']): HomeView['skills'] => ({
    ...s,
    items: s.items.map(fact => (fact.key === 'notes'
      ? { ...fact, plugin: { 'copilot-cli': { plugin: 'kit', marketplace: 'team', off: true as const } } } : fact)),
  });
  const fromSources = await sandbox(), fromLibrary = await sandbox();
  try {
    for (const box of [fromSources, fromLibrary]) {
      const look = await previewSource(box.context, box.tools, 'https://github.com/team/plugin-match');
      assert.ok('token' in look);
      await addSource(box.context, box.tools, look.token);
    }
    await openOnBox(fromSources, { pluginItems }, withPlugin);
    const sid = sources.view!.sources[0]!.id;
    findById(rendered, `source-turn-on-${sid}-skill-notes`)!.click();
    await flush();
    const sourcesPlugins = pluginCalls.map(call => call.slice(0, 6));
    const sourcesDisk = await everywhere(fromSources, 'notes');

    await openOnBox(fromLibrary, { pluginItems }, withPlugin);
    const libClick = turnOnRow('skills', 'notes', false);
    assert.ok(libClick);
    await applyClick(libClick);
    await flush();
    const libraryPlugins = pluginCalls.map(call => call.slice(0, 6));
    const libraryDisk = await everywhere(fromLibrary, 'notes');

    assert.equal(sourcesPlugins.length, 1, 'Sources row Turn it on turns on the matching disabled plugin skill in Copilot CLI');
    assert.deepEqual(sourcesPlugins, libraryPlugins, 'Sources row Turn it on and the Library switch make the exact same plugin switch calls');
    assert.deepEqual(sourcesDisk, libraryDisk, 'Sources row Turn it on and the Library switch make the exact same disk writes');
    assert.ok(existsSync(join(folderOf(fromSources, 'claude-cli', 'notes'), 'SKILL.md')));

    const multiBox = await sandbox();
    try {
      const kitRepo = await repository(hosts, 'https://github.com/team/plugin-match-multi');
      await kitRepo.commit(kitFiles, '2026-11-01T10:00:00Z');
      await openOnBox(multiBox, { pluginItems }, withPlugin);
      await addViaPage(multiBox, 'https://github.com/team/plugin-match-multi');
      findById(rendered, 'source-turn-made-on')!.click();
      await flush();
      assert.deepEqual(pluginCalls.map(call => call.slice(0, 6)), libraryPlugins, 'Sources band Turn them on also makes the same plugin switch call');
    } finally { await multiBox.cleanup(); }
  } finally {
    await fromSources.cleanup();
    await fromLibrary.cleanup();
  }
});

test('Band Turn them on skips an item turned on meanwhile without reporting a stale-page error', async () => {
  const repo = await repository(hosts, 'https://github.com/team/kit-already-on');
  await repo.commit(kitFiles, '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    await openOnBox(box);
    await addViaPage(box, 'https://github.com/team/kit-already-on');

    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);
    findById(rendered, 'source-turn-made-on')!.click();
    await flush();

    const text = textOf(findNode(rendered, el => el.className.includes('band-text')));
    assert.equal(state.outcome?.warn, false, `unexpected warning: ${text}`);
    assert.doesNotMatch(text, /changed since the page was read/);
    assert.match(text, /reviewer and relay/);
    assert.match(text, /1 was already on\./);
    assert.ok(existsSync(join(box.home, '.claude/agents/reviewer.md')));
  } finally { await box.cleanup(); }
});

test('Band Turn them on leaves out an item deleted meanwhile even when a tool holds its own copy of that key', async () => {
  const repo = await repository(hosts, 'https://github.com/team/kit-deleted');
  await repo.commit(kitFiles, '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    await openOnBox(box);
    await addViaPage(box, 'https://github.com/team/kit-deleted');

    // Delete notes from Central Knot and place a tool's own copy of notes in Claude Code.
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [], deleted: true }]);
    await put(box, 'claude-cli', { 'SKILL.md': skillText('My own copy.', 'notes') }, [], 'notes');
    const before = await everywhere(box, 'notes');

    findById(rendered, 'source-turn-made-on')!.click();
    await flush();

    const text = textOf(findNode(rendered, el => el.className.includes('band-text')));
    const view = await skillsView(box.context, box.tools);
    assert.equal(view.library.notes?.deleted !== undefined, true, 'deleted skill must not be taken in from the tool copy');
    assert.deepEqual(await everywhere(box, 'notes'), before, 'tool’s own copy stays untouched and is not copied to other tools');
    assert.equal(before['copilot-cli'], undefined);
    assert.equal(before['codex-cli'], undefined);
    assert.match(text, /reviewer and relay/);
    assert.match(text, /notes: no longer in Central Knot/);
    assert.ok(existsSync(join(box.home, '.claude/agents/reviewer.md')));
  } finally { await box.cleanup(); }
});

test('Band Turn them on does not turn on an item replaced meanwhile by another source’s item of the same name', async () => {
  const repoA = await repository(hosts, 'https://github.com/team/kit-src-a');
  await repoA.commit(kitFiles, '2026-11-01T10:00:00Z');
  const repoB = await repository(hosts, 'https://github.com/team/kit-src-b');
  await repoB.commit({ 'SKILL.md': skillText('Other source notes.', 'notes') }, '2026-11-01T11:00:00Z');
  const box = await sandbox();
  try {
    await openOnBox(box);
    await addViaPage(box, 'https://github.com/team/kit-src-a');

    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [], deleted: true }]);
    const lookB = await previewSource(box.context, box.tools, 'https://github.com/team/kit-src-b');
    assert.ok('token' in lookB);
    await addSource(box.context, box.tools, lookB.token);
    const sourceB = (await sourcesView(box.context, box.tools)).sources.find(source => source.link.includes('kit-src-b'))!;
    await rowClick(box.context, box.tools, sourceB.id, 'skill', 'notes', 'bringBack');

    findById(rendered, 'source-turn-made-on')!.click();
    await flush();

    const view = await skillsView(box.context, box.tools);
    const text = textOf(findNode(rendered, el => el.className.includes('band-text')));
    assert.equal(view.library.notes?.source, sourceB.id);
    assert.equal(view.library.notes?.on, false, 'other source’s Off item must stay Off');
    assert.match(text, /notes: now from another source/);
    assert.ok(existsSync(join(box.home, '.claude/agents/reviewer.md')));
  } finally { await box.cleanup(); }
});

test('Undo of Turn them on leaves an item turned off and on again by hand and still turns off siblings of the same kind and other kinds', async () => {
  const repo = await repository(hosts, 'https://github.com/team/kit-undo-hand');
  await repo.commit({
    'notes/SKILL.md': skillText('Take notes.', 'notes'),
    'spare/SKILL.md': skillText('Spare notes.', 'spare'),
    'agents/reviewer.md': kitFiles['agents/reviewer.md'],
  }, '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    await openOnBox(box);
    await addViaPage(box, 'https://github.com/team/kit-undo-hand');
    findById(rendered, 'source-turn-made-on')!.click();
    await flush();

    // Turn notes off and back on again by hand before clicking Undo.
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [] }]);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [] }]);

    findById(rendered, 'outcome-undo')!.click();
    await flush();

    const skills = await skillsView(box.context, box.tools);
    const agents = await agentsView(box.context, box.tools);
    const text = textOf(findNode(rendered, el => el.className.includes('band-text')));
    assert.equal(skills.library.notes?.on, true, 'item toggled off and on by hand stays On');
    assert.equal(skills.library.spare?.on, false, 'same-kind sibling still as left turns Off');
    assert.equal(agents.library.reviewer?.on, false, 'other-kind item still as left turns Off');
    assert.match(text, /Left as it is: notes/);
  } finally { await box.cleanup(); }
});

test('Undo of Turn them on does not stop at an item already off and still turns off same-kind and other-kind siblings', async () => {
  const repo = await repository(hosts, 'https://github.com/team/kit-undo-off');
  await repo.commit({
    'notes/SKILL.md': skillText('Take notes.', 'notes'),
    'spare/SKILL.md': skillText('Spare notes.', 'spare'),
    'agents/reviewer.md': kitFiles['agents/reviewer.md'],
  }, '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    await openOnBox(box);
    await addViaPage(box, 'https://github.com/team/kit-undo-off');
    findById(rendered, 'source-turn-made-on')!.click();
    await flush();

    await applySkills(box.context, box.tools, [{ key: 'spare', on: false, except: [] }]);

    findById(rendered, 'outcome-undo')!.click();
    await flush();

    const skills = await skillsView(box.context, box.tools);
    const agents = await agentsView(box.context, box.tools);
    const text = textOf(findNode(rendered, el => el.className.includes('band-text')));
    assert.equal(skills.library.notes?.on, false, 'same-kind sibling still on turns Off even though spare was already Off');
    assert.equal(skills.library.spare?.on, false);
    assert.equal(agents.library.reviewer?.on, false);
    assert.match(text, /Left as it is: spare/);
  } finally { await box.cleanup(); }
});

test('Add band states the kinds covered, caps long lists, and forecasts an ended profile before the press', async () => {
  const repo = await repository(hosts, 'https://github.com/team/kit-kinds');
  await repo.commit(kitFiles, '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Kept.', 'kept') }, [], 'kept');
    await applySkills(box.context, box.tools, [{ key: 'kept', on: true, except: [] }]);
    const everyday: Profile = { id: 'p1', name: 'Everyday', items: ['skill:kept'], switchesPluginItems: true };
    await openOnBox(box, { profiles: { profiles: [everyday], plugins: [] } });

    await addViaPage(box, 'https://github.com/team/kit-kinds');
    const bandText = textOf(findNode(rendered, el => el.className.includes('band-text')));
    assert.equal(bandText, 'Added github.com/team/kit-kinds. 1 skill, 1 agent and 1 MCP server (notes, reviewer and relay) are in Central Knot. All 3 are off.');
    assert.match(textOf(findById(rendered, 'source-turn-made-profile')), /Would leave Everyday/);

    const bandBtn = findById(rendered, 'source-turn-made-on')! as FakeNode & { onmouseenter?: (e: unknown) => void };
    bandBtn.onmouseenter?.({ currentTarget: bandBtn });
    assert.match(bandBtn.attrs.title ?? '', /Everyday stays saved but stops being the profile in use\./);

    const sid = sources.view!.sources[0]!.id;
    const rowBtn = findById(rendered, `source-turn-on-${sid}-skill-notes`)! as FakeNode & { onfocus?: (e: unknown) => void };
    rowBtn.onfocus?.({ currentTarget: rowBtn });
    assert.match(rowBtn.attrs['aria-description'] ?? '', /Everyday stays saved but stops being the profile in use\./);

    const many = whatItDid({
      sourced: [
        { kind: 'skill', key: 'a', name: 'a', answer: 'make', written: [], removed: [] },
        { kind: 'skill', key: 'b', name: 'b', answer: 'make', written: [], removed: [] },
        { kind: 'skill', key: 'c', name: 'c', answer: 'make', written: [], removed: [] },
        { kind: 'skill', key: 'd', name: 'd', answer: 'make', written: [], removed: [] },
        { kind: 'skill', key: 'e', name: 'e', answer: 'make', written: [], removed: [] },
        { kind: 'agent', key: 'rev', name: 'rev', answer: 'make', written: [], removed: [] },
      ],
    }, 'github.com/team/many');
    assert.equal(many.text, '5 skills and 1 agent (a, b, c and 3 more) are in Central Knot. All 6 are off.');
  } finally { await box.cleanup(); }
});

test('A Sync bringing a new item alongside an update or drop keeps Undo (as an outline button), Turn it on, and the History link without filler', async () => {
  const repo = await repository(hosts, 'https://github.com/team/mixed-sync');
  await repo.commit({ 'deslop/SKILL.md': skillText('One.', 'deslop') }, '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    await openOnBox(box);
    await addViaPage(box, 'https://github.com/team/mixed-sync');
    await applySkills(box.context, box.tools, [{ key: 'deslop', on: true, except: [] }]);
    await openOnBox(box);

    await repo.commit({
      'deslop/SKILL.md': skillText('Two.', 'deslop'),
      'unslop/SKILL.md': skillText('New.', 'unslop'),
    }, '2026-11-02T10:00:00Z');
    const sid = sources.view!.sources[0]!.id;
    findById(rendered, `source-check-${sid}`)!.click();
    await flush();

    const bandText = textOf(findNode(rendered, el => el.className.includes('band-text')));
    assert.doesNotMatch(bandText, /See each change, or undo it, in History\./);
    assert.equal(textOf(findById(rendered, 'outcome-note-history')), 'History');
    const undoBtn = findById(rendered, 'outcome-undo')!;
    assert.equal(textOf(undoBtn), 'Undo the update');
    assert.ok(undoBtn.className.includes('btn') && undoBtn.className.includes('outline'), `expected outline button, got ${undoBtn.className}`);
    assert.equal(textOf(findById(rendered, 'source-turn-made-on')), 'Turn it on');
    assert.equal(textOf(findById(rendered, 'source-open-skills')), 'Open Skills');
  } finally { await box.cleanup(); }
});

test('Waiting band warns and states both sides changed; Update waiting card has three plain lines; every source has its own Sync (?) naming Turn on', async () => {
  const box = await sandbox();
  try {
    await openOnBox(box);
    const waiting = whatItDid({ sourced: [{ kind: 'skill', key: 'deslop', name: 'deslop', answer: 'wait', written: [], removed: [] }] }, 'github.com/team/one');
    assert.equal(waiting.warns, true);
    assert.equal(waiting.text, 'deslop changed at the source and here: choose on its row.');
    const twoWaiting = whatItDid({
      sourced: [
        { kind: 'skill', key: 'deslop', name: 'deslop', answer: 'wait', written: [], removed: [] },
        { kind: 'skill', key: 'notes', name: 'notes', answer: 'wait', written: [], removed: [] },
      ],
    }, 'github.com/team/one');
    assert.equal(twoWaiting.text, 'deslop and notes changed at the source and here: choose on each one’s row.');

    boxNow = undefined;
    sources.view = {
      kinds: ['skill', 'agent', 'mcp'], access: { allowed: true, reason: '' },
      sources: [
        sourceViewOf('s1', 'https://github.com/team/one', [{ kind: 'skill', key: 'deslop', name: 'deslop', state: 'wait', on: true }]),
        sourceViewOf('s2', 'https://github.com/team/two', [{ kind: 'skill', key: 'notes', name: 'notes', state: 'nothing', on: false }]),
      ],
    };
    draw();

    const waitCard = findById(rendered, 'source-wait-info-s1-skill-deslop-card')!;
    const lines = allNodes(waitCard, el => el.className.includes('info-line')).map(textOf);
    assert.equal(lines.length, 3, 'Update waiting card is three plain lines');
    assert.match(lines[0]!, /^Merge:.*keeps yours as a version.*Undo.*clashes\./);
    assert.match(lines[1]!, /^Replace mine:.*keeps yours as a version.*Undo/);
    assert.match(lines[2]!, /^Keep mine:.*keeps the source’s as a version.*Undo.*changes further\./);
    assert.doesNotMatch(textOf(waitCard), /two causes|compares the source’s next change/);

    const sync1 = textOf(findById(rendered, 'source-sync-info-s1-card'));
    const sync2 = textOf(findById(rendered, 'source-sync-info-s2-card'));
    assert.equal(sync1, sync2);
    assert.match(sync1, /Automatic sync is on/);
    assert.match(sync1, /Turn on/);
    assert.doesNotMatch(sync1, /with Undo/);
    assert.equal(findById(rendered, 'source-check-s2')?.attrs['aria-describedby'], 'source-sync-info-s2-card');

    sources.confirmRemove = 's1';
    draw();
    assert.equal(findById(rendered, 'source-sync-info-s1'), undefined);
    assert.ok(findById(rendered, 'source-sync-info-s2-card'));
  } finally { await box.cleanup(); }
});

test('Mixed-case item names carry the engine key from fromSourceStep and fall back to lowercase itemKey', async () => {
  const repo = await repository(hosts, 'https://github.com/team/mixed-case');
  await repo.commit({ 'SKILL.md': skillText('Mixed case.', 'MySkill') }, '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/mixed-case');
    assert.ok('token' in look);
    const added = await addSource(box.context, box.tools, look.token);
    assert.equal(added.sourced?.[0]?.key, 'myskill');
    const derived = whatItDid({ sourced: [{ kind: 'skill', name: 'MySkill', answer: 'make', written: [], removed: [] }] }, 'github.com/team/mixed-case');
    assert.equal(derived.made?.[0]?.key, 'myskill');
    const carried = whatItDid({ sourced: [{ kind: 'skill', key: 'custom-folder', name: 'MySkill', answer: 'make', written: [], removed: [] }] }, 'github.com/team/mixed-case');
    assert.equal(carried.made?.[0]?.key, 'custom-folder');
  } finally { await box.cleanup(); }
});
