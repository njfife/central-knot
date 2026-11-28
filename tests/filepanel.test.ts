// A page that names items, as a file panel's place (filepanel.ts pagePlace, itemFile, placePanel): a mark at each of a name's
// occurrences, with an id of its own, the panel at the one pressed, said to be the current version; two marks with one id refused;
// a mark only for an item Central Knot holds, unless the page opens found copies too; a deleted item's mark of its own (keptFile)
// for the last version kept; one file open on the page, forgotten on another home and on another visit; and Escape on the page,
// after whatever else on it heard that key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView } from '../src/types.ts';
import { findNode, installDom, textOf, type FakeNode } from './domstub.ts';

// Central Knot's store keeps gone's last version (h2), and no longer keeps old's (h3: let go at History's days); a tool's found copy of gone reads otherwise.
// It keeps scout's (an agent's: a1) and tracker's (a server's: s1) last versions too: each read by its key and hash.
const { dispatch } = installDom({
  skillVersionFile: async (key: string, hash: string) => (key === 'gone' && hash === 'h2' ? { files: ['SKILL.md'], text: 'gone, as Central Knot kept it' } : null),
  skillFoundFile: async () => ({ files: ['SKILL.md'], text: 'a tool’s copy of gone' }),
  agentVersion: async (key: string, hash: string) => (key === 'scout' && hash === 'a1' ? { name: 'scout', description: 'Scouts.', prompt: 'Look around first.' } : null),
  serverStored: async (key: string, hash: string) => (key === 'tracker' && hash === 's1' ? { files: [], text: '{ "command": "tracker" }' } : null),
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
  skills: { ...kind, items: [{ key: 'notes', name: 'notes', on: true, copies: {}, except: [] }, { key: 'gone', name: 'gone', copies: {}, except: [] }],
    library: { notes: { key: 'notes', name: 'notes', on: true, hash: 'h1', ...stored }, gone: { key: 'gone', name: 'gone', on: false, deleted: true, hash: 'h2', ...stored },
      old: { key: 'old', name: 'old', on: false, deleted: true, hash: 'h3', ...stored } } },
  agents: { ...kind, library: { scout: { key: 'scout', name: 'scout', on: false, deleted: true, hash: 'a1', ...stored } } },
  mcp: { ...kind, library: { tracker: { key: 'tracker', name: 'tracker', on: false, deleted: true, hash: 's1', ...stored } } }, pluginItems: [],
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
