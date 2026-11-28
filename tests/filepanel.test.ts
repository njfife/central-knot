// A page that names items, as a file panel's place (filepanel.ts pagePlace, itemFile, placePanel): a mark at each of a name's
// occurrences, with an id of its own, the panel at the one pressed; one file open on the page, forgotten on another home and on
// another visit; and Escape on the page, unless something there took it first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView } from '../src/types.ts';
import { installDom, type FakeNode } from './domstub.ts';

const { dispatch } = installDom({});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first.
await import('../src/settingspage.ts');
const { setRenderer, state } = await import('../src/app.ts');
const { itemFile, pagePlace, placePanel } = await import('../src/filepanel.ts');

const tools: HarnessId[] = ['claude-cli', 'codex-cli'];
const kind = { tools, items: [], library: {}, notices: [], gate: { state: 'open' }, unread: [], problems: [], access: { allowed: true } };
/** A home whose library holds one skill, notes, On, its version stored in Central Knot. */
const homeAt = (home: string): HomeView => ({
  home, label: 'Test', syncOn: true, mode: 'fixture', readId: 1, snapshots: [],
  sync: { managed: tools, present: tools, caughtUp: [], gate: { state: 'open' }, access: { allowed: true } },
  skills: { ...kind, items: [{ key: 'notes', name: 'notes', on: true, copies: {}, except: [] }],
    library: { notes: { key: 'notes', name: 'notes', on: true, hash: 'h1', versions: [], except: [], applied: {}, own: {} } } },
  mcp: kind, agents: kind, pluginItems: [],
} as unknown as HomeView);

setRenderer(() => {});
state.page = 'history';
const place = pagePlace('history');
/** The page drawn as History draws it: notes named in two entries, older and newer; their marks, and where the panel goes. */
const draw = () => {
  const marks = ['older', 'newer'].map(at => itemFile(place, 'skills', 'notes', at));
  return { marks: marks.map(mark => mark?.mark as unknown as FakeNode | undefined), panelAt: placePanel(place, marks)?.at };
};

test('one item named twice on a page has a mark at each name, with its own id, and its file opens at the one pressed', () => {
  state.home = homeAt('/tmp/filepanel-two-names');
  let page = draw();
  assert.deepEqual(page.marks.map(mark => mark?.attrs.id), ['file-skills-notes-older', 'file-skills-notes-newer']);
  assert.equal(page.panelAt, undefined);
  page.marks[1]!.click();
  page = draw();
  assert.deepEqual([page.panelAt, page.marks.map(mark => mark?.attrs['aria-pressed'])], ['newer', ['false', 'true']]);
  // The other name's mark moves it there: still one file open on the page.
  page.marks[0]!.click();
  page = draw();
  assert.deepEqual([page.panelAt, page.marks.map(mark => mark?.attrs['aria-pressed'])], ['older', ['true', 'false']]);
  page.marks[0]!.click();
  assert.equal(draw().panelAt, undefined);
});

test('the file open on a page is forgotten on another visit and on another home', () => {
  state.home = homeAt('/tmp/filepanel-visit');
  draw().marks[0]!.click();
  assert.equal(draw().panelAt, 'older');
  state.visit += 1;
  assert.equal(draw().panelAt, undefined);
  draw().marks[0]!.click();
  state.home = homeAt('/tmp/filepanel-other-home');
  assert.deepEqual([draw().panelAt, place.view.openFile], [undefined, undefined]);
});

test('Escape on the page closes its file, unless something on the page took that Escape first', () => {
  state.home = homeAt('/tmp/filepanel-escape');
  draw().marks[1]!.click();
  dispatch('keydown', { key: 'Escape', defaultPrevented: true });
  assert.equal(draw().panelAt, 'newer');
  dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.equal(draw().panelAt, undefined);
});
