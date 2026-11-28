// A page that names items, as a file panel's place (filepanel.ts pagePlace, itemFile, placePanel): a mark at each of a name's
// occurrences, with an id of its own, the panel at the one pressed, said to be the current version; two marks with one id refused;
// a mark only for an item Central Knot holds, unless the page opens found copies too; a deleted item's mark of its own (keptFile)
// for the last version kept; one file open on the page, forgotten on another home and on another visit; and Escape on the page,
// after whatever else on it heard that key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView } from '../src/types.ts';
import { findNode, installDom, textOf, type FakeNode } from './domstub.ts';

// Central Knot's store keeps notes's (h1), guide's (a2) and docs's (s2) current versions, gone's last version (h2), and no longer keeps old's (h3: let go at History's days); a tool's copy reads otherwise.
// It keeps scout's (an agent's: a1) and tracker's (a server's: s1) last versions too: each read by its key and hash.
const { dispatch } = installDom({
  skillVersionFile: async (key: string, hash: string) => (key === 'notes' && hash === 'h1' ? { files: ['SKILL.md'], text: 'notes, as Central Knot stores it' }
    : key === 'gone' && hash === 'h2' ? { files: ['SKILL.md'], text: 'gone, as Central Knot kept it' } : null),
  skillFoundFile: async () => ({ files: ['SKILL.md'], text: 'a tool’s copy of gone' }),
  agentVersion: async (key: string, hash: string) => (key === 'guide' && hash === 'a2' ? { name: 'guide', description: 'Guides.', prompt: 'Stored agent prompt.' }
    : key === 'scout' && hash === 'a1' ? { name: 'scout', description: 'Scouts.', prompt: 'Look around first.' } : null),
  agentFile: async () => ({ files: ['guide.md'], directory: '/home/.claude/agents', text: 'Edited agent in Claude Code.' }),
  serverStored: async (key: string, hash: string) => (key === 'docs' && hash === 's2' ? { files: [], text: '{ "command": "stored-docs" }' }
    : key === 'tracker' && hash === 's1' ? { files: [], text: '{ "command": "tracker" }' } : null),
  serverEntry: async () => ({ files: ['.claude.json'], directory: '/home', holder: 'mcpServers', text: '{ "command": "claude-edit" }' }),
  pluginItemTexts: async (plugin: string, _market: string, kind: string, name: string) => (name === 'missing' ? []
    : kind === 'mcp' ? [{ tool: 'claude-cli', text: `{\n  "command": "${plugin}-claude"\n}` }, { tool: 'codex-cli', text: `{\n  "command": "${plugin}-codex"\n}` }]
    : [{ tool: 'claude-cli', text: `${name} in Claude Code.` }, { tool: 'copilot-cli', text: `${name} in Copilot CLI.` }]),
});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first.
await import('../src/settingspage.ts');
const { setRenderer, state } = await import('../src/app.ts');
const { itemFile, keptFile, pagePlace, placePanel } = await import('../src/filepanel.ts');

const tools: HarnessId[] = ['claude-cli', 'codex-cli'];
const kind = { tools, items: [], library: {}, notices: [], gate: { state: 'open' }, unread: [], problems: [], access: { allowed: true } };
const stored = { versions: [], except: [], applied: {}, own: {} };
/** A home whose library holds notes, On, its version stored in Central Knot; gone, deleted, of which Claude Code holds a found copy; old, deleted long ago; scout, a deleted agent, and tracker, a deleted server. */
const homeAt = (home: string): HomeView => ({
  home, label: 'Test', syncOn: true, mode: 'fixture', readId: 1,
  snapshots: [{ harness: 'claude-cli', skills: [{ folder: 'gone', directory: '/found/gone', realDirectory: '/found/gone', rootLabel: '~/.claude/skills' }] }],
  sync: { managed: tools, present: tools, caughtUp: [], gate: { state: 'open' }, access: { allowed: true } },
  skills: { ...kind, items: [{ key: 'notes', name: 'notes', on: true, copies: { 'claude-cli': 'current' }, paths: { 'claude-cli': '/home/.claude/skills/notes' }, hashes: { 'claude-cli': 'h1' }, except: [] },
    { key: 'gone', name: 'gone', copies: {}, except: [] }],
    library: { notes: { key: 'notes', name: 'notes', on: true, hash: 'h1', ...stored }, gone: { key: 'gone', name: 'gone', on: false, deleted: true, hash: 'h2', ...stored },
      old: { key: 'old', name: 'old', on: false, deleted: true, hash: 'h3', ...stored } } },
  agents: { ...kind, items: [{ key: 'guide', name: 'guide', on: true, copies: { 'claude-cli': 'current' }, paths: { 'claude-cli': '/home/.claude/agents/guide.md' }, except: [] }],
    library: { guide: { key: 'guide', name: 'guide', on: true, hash: 'a2', ...stored }, scout: { key: 'scout', name: 'scout', on: false, deleted: true, hash: 'a1', ...stored } } },
  mcp: { ...kind, items: [{ key: 'docs', name: 'docs', on: true, copies: { 'claude-cli': 'current' }, paths: { 'claude-cli': '/home/.claude.json' }, except: [] }],
    library: { docs: { key: 'docs', name: 'docs', on: true, hash: 's2', ...stored }, tracker: { key: 'tracker', name: 'tracker', on: false, deleted: true, hash: 's1', ...stored } } }, pluginItems: [],
} as unknown as HomeView);

setRenderer(() => {});
state.page = 'history';
const place = pagePlace('history');
/** The page drawn as History draws it: notes (or what `named` marks) named in two entries, older and newer; their marks, which of them is open, its panel. */
const draw = (named = (occurrenceId: string) => itemFile(place, 'skills', 'notes', occurrenceId)) => {
  const marks = ['older', 'newer'].map(named), open = placePanel(place, marks);
  return { marks: marks.map(mark => mark?.mark as unknown as FakeNode | undefined), open: open && marks.indexOf(open.mark), panel: open?.panel as unknown as FakeNode | undefined };
};

test('one item named twice on a page has a mark at each name, with its own id; its file opens at the one pressed, as the current version', () => {
  state.home = homeAt('/tmp/filepanel-two-names');
  let page = draw();
  assert.deepEqual(page.marks.map(mark => [mark?.attrs.id, mark?.attrs.title]), [['file-skills-notes-older', 'Open the current version'], ['file-skills-notes-newer', 'Open the current version']]);
  assert.equal(page.open, undefined);
  page.marks[1]!.click();
  page = draw();
  assert.deepEqual([page.open, page.marks.map(mark => mark?.attrs['aria-pressed'])], [1, ['false', 'true']]);
  assert.equal(textOf(findNode(page.panel, el => el.classList.contains('file-open-now'))), 'current version');
  page.marks[1]!.click();
  assert.equal(draw().open, undefined);
});

test('two names that would share a mark (one occurrence twice, or none where an item is named twice, as the Overview’s most used can): the first keeps it, the second has none, and its file opens', () => {
  state.home = homeAt('/tmp/filepanel-one-id');
  for (const occurrenceId of ['same', undefined]) {
    let marks = [itemFile(place, 'skills', 'notes', occurrenceId), itemFile(place, 'skills', 'notes', occurrenceId)];
    assert.deepEqual([!!marks[0], marks[1], placePanel(place, marks)], [true, undefined, undefined]);
    (marks[0]!.mark as unknown as FakeNode).click();
    marks = [itemFile(place, 'skills', 'notes', occurrenceId), itemFile(place, 'skills', 'notes', occurrenceId)];
    assert.equal(placePanel(place, marks)?.mark, marks[0]);
    (marks[0]!.mark as unknown as FakeNode).click();
    placePanel(place, []);
  }
});

test('a mark only for an item Central Knot holds now; a page that opens found copies too marks the found copy of a deleted item’s name', () => {
  state.home = homeAt('/tmp/filepanel-held');
  const anyRow = pagePlace('overview', { foundAndPlugins: true });
  assert.deepEqual([itemFile(place, 'skills', 'gone'), !!itemFile(anyRow, 'skills', 'gone')], [undefined, true]);
});

/** Every node under `node` that `match` takes, in order. */
const allOf = (node: FakeNode | undefined, match: (el: FakeNode) => boolean): FakeNode[] => (!node ? []
  : [...(match(node) ? [node] : []), ...(node.children ?? []).flatMap(child => (child && typeof child === 'object' ? allOf(child as FakeNode, match) : []))]);

test('a deleted item named twice has a mark of its own (keptFile) at each name: it opens the last version Central Knot kept at the one pressed, said with the bin, never a tool’s copy of that name; a version let go says so, its header only that the item is deleted', async () => {
  state.home = homeAt('/tmp/filepanel-kept');
  const kept = (key: string) => draw(occurrenceId => keptFile(place, 'skills', key, occurrenceId));
  let page = kept('gone');
  assert.deepEqual([keptFile(place, 'skills', 'notes'), page.marks.map(mark => [mark?.attrs.id, mark?.attrs.title])],
    [undefined, [['file-kept-skills-gone-h2-older', 'Open the last version kept'], ['file-kept-skills-gone-h2-newer', 'Open the last version kept']]]);
  page.marks[0]!.click();
  await new Promise(resolve => setTimeout(resolve));
  page = kept('gone');
  const header = allOf(page.panel, el => el.classList.contains('file-open-now'));
  assert.deepEqual([page.open, page.marks.map(mark => mark?.attrs['aria-pressed']), header.map(textOf), !!findNode(header[0], el => el.tag === 'svg'),
    textOf(findNode(page.panel, el => el.tag === 'pre')), !!findNode(page.panel, el => el.tag === 'select')],
  [0, ['true', 'false'], ['deleted', 'last version kept'], true, 'gone, as Central Knot kept it', false]);
  page.marks[1]!.click();
  page = kept('gone');
  assert.deepEqual([page.open, page.marks.map(mark => mark?.attrs['aria-pressed'])], [1, ['false', 'true']]);
  page.marks[1]!.click();
  kept('old').marks[0]!.click();
  await new Promise(resolve => setTimeout(resolve));
  page = kept('old');
  const letGo = allOf(page.panel, el => el.classList.contains('file-open-now'));
  assert.deepEqual([letGo.map(textOf), !!findNode(letGo[0], el => el.tag === 'svg'), !!findNode(page.panel, el => el.classList.contains('file-tab')),
    textOf(findNode(page.panel, el => el.classList.contains('file-open-state')))], [['deleted'], true, false, 'Central Knot no longer keeps this version.']);
  page.marks[0]!.click();
});

test('a deleted agent’s and a deleted server’s last version kept is its definition, under a label as a held one’s is, read by the tombstone’s hash', async () => {
  state.home = homeAt('/tmp/filepanel-kept-definition');
  for (const [kind, key, text] of [['agents', 'scout', 'Look around first.'], ['mcp', 'tracker', '{ "command": "tracker" }']] as const) {
    const draw = () => { const mark = keptFile(place, kind, key); return { mark: mark?.mark as unknown as FakeNode, panel: placePanel(place, [mark])?.panel as unknown as FakeNode | undefined }; };
    draw().mark.click();
    await new Promise(resolve => setTimeout(resolve));
    const panel = draw().panel;
    assert.deepEqual([textOf(findNode(panel, el => el.classList.contains('file-open-name'))), !!findNode(panel, el => el.attrs.role === 'tablist'), allOf(panel, el => el.tag === 'pre').map(textOf).at(-1)],
      ['Central Knot’s definition', false, text], key);
    draw().mark.click();
  }
});

test('a storedOnly place opens Central Knot’s stored version for skills, agents and servers with no tool’s copy, chooser or path; another place keeps current version and copies', async () => {
  state.home = homeAt('/tmp/filepanel-stored-only');
  const storedPlace = pagePlace('harnesses', { storedOnly: true });
  for (const [kind, key, label, text] of [
    ['skills', 'notes', 'SKILL.md', 'notes, as Central Knot stores it'],
    ['agents', 'guide', 'Central Knot’s definition', 'Stored agent prompt.'],
    ['mcp', 'docs', 'Central Knot’s definition', '{ "command": "stored-docs" }'],
  ] as const) {
    const drawHere = () => {
      const mark = itemFile(storedPlace, kind, key);
      return { mark: mark?.mark as unknown as FakeNode, panel: placePanel(storedPlace, [mark])?.panel as unknown as FakeNode | undefined };
    };
    const before = drawHere();
    assert.equal(before.mark.attrs.title, 'Open Central Knot’s version', kind);
    before.mark.click();
    await new Promise(resolve => setTimeout(resolve));
    const panel = drawHere().panel;
    const shown = kind === 'skills' ? findNode(panel, el => el.classList.contains('file-tab') && el.classList.contains('is-active')) : findNode(panel, el => el.classList.contains('file-open-name'));
    assert.deepEqual([
      allOf(panel, el => el.classList.contains('file-open-now')).map(textOf), textOf(shown), allOf(panel, el => el.tag === 'pre').map(textOf).at(-1),
      !!findNode(panel, el => el.tag === 'select'), !!findNode(panel, el => el.classList.contains('file-open-foot')),
    ], [['Central Knot’s version'], label, text, false, false], kind);
    drawHere().mark.click();
  }
  const drawRegular = () => {
    const mark = itemFile(place, 'mcp', 'docs', 'regular');
    return { mark: mark?.mark as unknown as FakeNode, panel: placePanel(place, [mark])?.panel as unknown as FakeNode | undefined };
  };
  const regular = drawRegular();
  assert.equal(regular.mark.attrs.title, 'Open the current version');
  regular.mark.click();
  await new Promise(resolve => setTimeout(resolve));
  const regularPanel = drawRegular().panel;
  assert.deepEqual([
    allOf(regularPanel, el => el.classList.contains('file-open-now')).map(textOf), textOf(findNode(regularPanel, el => el.tag === 'pre')),
    !!findNode(regularPanel, el => el.tag === 'select'), !!findNode(regularPanel, el => el.classList.contains('file-open-foot')),
  ], [['current version'], '{ "command": "claude-edit" }', true, true]);
  drawRegular().mark.click();
});

test('the file open on a page is forgotten on another visit and on another home', () => {
  state.home = homeAt('/tmp/filepanel-visit');
  draw().marks[0]!.click();
  assert.equal(draw().open, 0);
  state.visit += 1;
  assert.equal(draw().open, undefined);
  draw().marks[0]!.click();
  state.home = homeAt('/tmp/filepanel-other-home');
  assert.deepEqual([draw().open, place.view.openFile], [undefined, undefined]);
});

test('Escape on the page closes its file after whatever else on the page heard it: a question that takes it keeps the file open', () => {
  state.home = homeAt('/tmp/filepanel-escape');
  draw().marks[1]!.click();
  // A question on the page whose listener was added after the place's, as one from a module loaded later would be: it takes one Escape.
  let asking = true;
  document.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Escape' && asking) { asking = false; event.preventDefault(); } });
  const escape = () => { const event = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; dispatch('keydown', event); };
  escape();
  assert.deepEqual([asking, draw().open], [false, 1]);
  escape();
  assert.equal(draw().open, undefined);
});

test('a plugin’s agent or server opens through pluginItemTexts: differing versions offer each tool’s copy, same versions collapse to one, a turned-off plugin still opens, and an empty read says it couldn’t be read', async () => {
  const three: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  const withPlugins = (home: string, versions: [string, string], off = false): HomeView => ({
    ...homeAt(home),
    sync: { managed: three, present: three, caughtUp: [], gate: { state: 'open' }, access: { allowed: true } },
    skills: { ...homeAt(home).skills, tools: three },
    agents: { ...homeAt(home).agents, tools: three },
    mcp: { ...homeAt(home).mcp, tools: three },
    pluginItems: [
      { tool: 'claude-cli', plugin: 'kit', marketName: 'team', version: versions[0], ...(off ? { off: true } : {}), listed: true,
        items: [{ kind: 'agent', name: 'helper', description: '' }, { kind: 'agent', name: 'missing', description: '' }, { kind: 'mcp', name: 'issues', description: '' }] },
      { tool: 'copilot-cli', plugin: 'kit', marketName: 'team', version: versions[1], ...(off ? { off: true } : {}), listed: true,
        items: [{ kind: 'agent', name: 'helper', description: '' }] },
      { tool: 'codex-cli', plugin: 'kit', marketName: 'team', version: versions[1], ...(off ? { off: true } : {}), listed: true,
        items: [{ kind: 'mcp', name: 'issues', description: '' }] },
    ],
  } as unknown as HomeView);
  const anyRow = pagePlace('profiles', { foundAndPlugins: true });
  state.page = 'profiles';
  const drawRow = (of: 'agents' | 'mcp', key: string) => {
    const mark = itemFile(anyRow, of, key);
    return { mark: mark?.mark as unknown as FakeNode | undefined, panel: placePanel(anyRow, [mark])?.panel as unknown as FakeNode | undefined };
  };
  // Differing versions of an agent (2.0.0 vs 1.0.0) while plugin is turned off: both copies offered, chooser switches copy, no footer or tablist.
  state.home = withPlugins('/tmp/filepanel-plugin-diff', ['2.0.0', '1.0.0'], true);
  let shown = drawRow('agents', 'kit@team/helper');
  assert.ok(shown.mark, 'turned-off plugin agent gets a mark');
  shown.mark!.click();
  await new Promise(resolve => setTimeout(resolve));
  shown = drawRow('agents', 'kit@team/helper');
  const select = findNode(shown.panel, el => el.tag === 'select') as (FakeNode & { onchange?: (e: unknown) => void }) | undefined;
  assert.deepEqual([
    select?.attrs['aria-label'], allOf(select, el => el.tag === 'option').map(textOf),
    allOf(shown.panel, el => el.classList.contains('file-open-now')).map(textOf),
    textOf(findNode(shown.panel, el => el.tag === 'pre')), !!findNode(shown.panel, el => el.attrs.role === 'tablist'),
    !!findNode(shown.panel, el => el.classList.contains('file-open-foot')),
  ], ['Copy to show', ['Claude Code’s copy · 2.0.0', 'Copilot CLI’s copy · 1.0.0'], ['current version'], 'helper in Claude Code.', false, false]);
  select!.onchange?.({ target: { value: '1' } });
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(textOf(findNode(drawRow('agents', 'kit@team/helper').panel, el => el.tag === 'pre')), 'helper in Copilot CLI.');
  shown.mark!.click();
  // Same version in both tools (2.0.0): collapsed to one copy, no chooser, label shows Claude Code's copy · 2.0.0.
  state.home = withPlugins('/tmp/filepanel-plugin-same', ['2.0.0', '2.0.0']);
  shown = drawRow('agents', 'kit@team/helper');
  shown.mark!.click();
  await new Promise(resolve => setTimeout(resolve));
  shown = drawRow('agents', 'kit@team/helper');
  assert.deepEqual([!!findNode(shown.panel, el => el.tag === 'select'), textOf(findNode(shown.panel, el => el.classList.contains('file-open-name'))), textOf(findNode(shown.panel, el => el.tag === 'pre'))],
    [false, 'Claude Code’s copy · 2.0.0', 'helper in Claude Code.']);
  shown.mark!.click();
  // Plugin server with differing versions: Entry to show chooser, formatted entry, no footer; empty read shows unread note.
  state.home = withPlugins('/tmp/filepanel-plugin-mcp', ['2.0.0', '1.0.0']);
  shown = drawRow('mcp', 'kit@team/issues');
  shown.mark!.click();
  await new Promise(resolve => setTimeout(resolve));
  shown = drawRow('mcp', 'kit@team/issues');
  const mcpSelect = findNode(shown.panel, el => el.tag === 'select') as (FakeNode & { onchange?: (e: unknown) => void }) | undefined;
  assert.deepEqual([mcpSelect?.attrs['aria-label'], allOf(mcpSelect, el => el.tag === 'option').map(textOf), textOf(findNode(shown.panel, el => el.tag === 'pre')), !!findNode(shown.panel, el => el.classList.contains('file-open-foot'))],
    ['Entry to show', ['Claude Code’s copy · 2.0.0', 'Codex’s copy · 1.0.0'], '{\n  "command": "kit-claude"\n}', false]);
  mcpSelect!.onchange?.({ target: { value: '1' } });
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(textOf(findNode(drawRow('mcp', 'kit@team/issues').panel, el => el.tag === 'pre')), '{\n  "command": "kit-codex"\n}');
  shown.mark!.click();
  shown = drawRow('agents', 'kit@team/missing');
  shown.mark!.click();
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(textOf(findNode(drawRow('agents', 'kit@team/missing').panel, el => el.classList.contains('file-open-state'))), 'Its file couldn’t be read.');
  shown.mark!.click();
});
