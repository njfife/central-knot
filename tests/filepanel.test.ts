// A page that names items, as a file panel's place (filepanel.ts pagePlace, itemFile, placePanel): a mark at each of a name's
// occurrences, with an id of its own, the panel at the one pressed, said to be the current version; two marks with one id refused;
// a mark only for an item Central Knot holds, unless the page opens found copies too; one file open on the page, forgotten on
// another home and on another visit; and Escape on the page, after whatever else on it heard that key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView } from '../src/types.ts';
import { findNode, installDom, textOf, type FakeNode } from './domstub.ts';

const { dispatch } = installDom({});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first.
await import('../src/settingspage.ts');
const { setRenderer, state } = await import('../src/app.ts');
const { itemFile, pagePlace, placePanel } = await import('../src/filepanel.ts');

const tools: HarnessId[] = ['claude-cli', 'codex-cli'];
const kind = { tools, items: [], library: {}, notices: [], gate: { state: 'open' }, unread: [], problems: [], access: { allowed: true } };
const stored = { versions: [], except: [], applied: {}, own: {} };
/** A home whose library holds notes, On, its version stored in Central Knot, and gone, deleted, of which Claude Code holds a found copy. */
const homeAt = (home: string): HomeView => ({
  home, label: 'Test', syncOn: true, mode: 'fixture', readId: 1,
  snapshots: [{ harness: 'claude-cli', skills: [{ folder: 'gone', directory: '/found/gone', realDirectory: '/found/gone', rootLabel: '~/.claude/skills' }] }],
  sync: { managed: tools, present: tools, caughtUp: [], gate: { state: 'open' }, access: { allowed: true } },
  skills: { ...kind, items: [{ key: 'notes', name: 'notes', on: true, copies: {}, except: [] }, { key: 'gone', name: 'gone', copies: {}, except: [] }],
    library: { notes: { key: 'notes', name: 'notes', on: true, hash: 'h1', ...stored }, gone: { key: 'gone', name: 'gone', on: false, deleted: true, hash: 'h2', ...stored } } },
  mcp: kind, agents: kind, pluginItems: [],
} as unknown as HomeView);

setRenderer(() => {});
state.page = 'history';
const place = pagePlace('history');
/** The page drawn as History draws it: notes named in two entries, older and newer; their marks, which of them is open, its panel. */
const draw = () => {
  const marks = ['older', 'newer'].map(occurrenceId => itemFile(place, 'skills', 'notes', occurrenceId)), open = placePanel(place, marks);
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

test('two names drawn with one occurrence, or none where an item is named twice, would share a mark: the page is told at once', () => {
  state.home = homeAt('/tmp/filepanel-one-id');
  assert.throws(() => placePanel(place, ['same', 'same'].map(occurrenceId => itemFile(place, 'skills', 'notes', occurrenceId))), /file-skills-notes-same/);
  assert.throws(() => placePanel(place, [itemFile(place, 'skills', 'notes'), itemFile(place, 'skills', 'notes')]), /file-skills-notes\b/);
});

test('a mark only for an item Central Knot holds now; a page that opens found copies too marks the found copy of a deleted item’s name', () => {
  state.home = homeAt('/tmp/filepanel-held');
  const anyRow = pagePlace('overview', { foundAndPlugins: true });
  assert.deepEqual([itemFile(place, 'skills', 'gone'), !!itemFile(anyRow, 'skills', 'gone')], [undefined, true]);
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
