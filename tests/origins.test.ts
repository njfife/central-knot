// Where a row of the item lists came from (src/origins.ts originOf), and which rows each choice of the Library's From menu
// shows (fromShows) and offers (fromChoices), as worked examples on a home's view as the page gets it (types.ts LibraryFacts,
// types.ts InstalledPlugin). A row can come from more than one place, and each choice counts it once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromAnyPlugin, fromChoices, fromShows, originOf, originsIn, pluginFrom, sourceFrom, type From } from '../src/origins.ts';
import { pageRows } from '../src/pluginrows.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts } from '../src/types.ts';

/** A row of the person's own as the kind's view gives it; `copies`: the tools with a copy of their own. */
const fact = (key: string, copies: HarnessId[], extra: Partial<LibraryFacts> = {}): LibraryFacts => ({ key, name: key, description: '', on: false, except: [], cannot: {}, edited: [],
  copies: Object.fromEntries(copies.map(tool => [tool, { hash: 'h', directory: '', rootLabel: '', lines: 1, modified: '', summary: '', writable: true, folder: key }])), ...extra });
/** A plugin installed whole in a tool, bringing these items. */
const install = (tool: HarnessId, plugin: string, marketName: string, items: InstalledPlugin['items']): InstalledPlugin => ({ tool, plugin, marketName, listed: true, items });
const skillIn = (name: string) => ({ kind: 'skill' as const, name, description: '' });
/** A home's view: its skills and agents (as the Library's view gives them), the plugins its tools have installed; Claude Code, Copilot CLI and Pi managed. */
const homeOf = (skills: LibraryFacts[], pluginItems: InstalledPlugin[] = [], agents: LibraryFacts[] = []) => {
  const tools = ['claude-cli', 'copilot-cli', 'pi-cli'];
  return { sync: { managed: tools }, snapshots: [], skills: { tools, items: skills, library: {} }, mcp: { tools, items: [], library: {} },
    agents: { tools, items: agents, library: {} }, pluginItems } as unknown as HomeView;
};
/** Each skill row's key with the choices of `from` that show it, in the order given. */
const shownBy = (home: HomeView, choices: From[]) => {
  const each = [...home.skills.items, ...pageRows(home, 'skills').rows].map(row => ({ key: row.key, origins: originOf(row) }));
  return Object.fromEntries(choices.map(from => [from, each.filter(row => fromShows(from, row.origins)).map(row => row.key)]));
};
const pdf = pluginFrom('pdf', 'team-tools'), review = pluginFrom('review', 'market-one'), otherReview = pluginFrom('review', 'market-two');

test('A found skill is the person’s own: Your own shows it, no plugin or source does', () => {
  const home = homeOf([fact('notes', ['claude-cli'])]);
  assert.deepEqual(originOf(home.skills.items[0]!), { yours: true, plugins: [] });
  assert.deepEqual(shownBy(home, ['anywhere', 'yours', 'plugins', 'sources']), { anywhere: ['notes'], yours: ['notes'], plugins: [], sources: [] });
});

test('A skill kept on its own that a tool also gets through a plugin is the person’s own and that plugin’s; the plugin’s other skill is its alone', () => {
  // Claude Code has notes only through pdf (no copy of its own); Pi has its own; pdf also brings forms, which no row of his has.
  const home = homeOf([fact('notes', ['pi-cli'], { on: true, plugin: { 'claude-cli': { plugin: 'pdf', marketplace: 'team-tools' } } })],
    [install('claude-cli', 'pdf', 'team-tools', [skillIn('notes'), skillIn('forms')])]);
  assert.deepEqual(shownBy(home, ['yours', 'plugins', pdf]), { yours: ['notes'], plugins: ['notes', 'pdf@team-tools/forms'], [pdf]: ['notes', 'pdf@team-tools/forms'] });
  assert.equal(fromAnyPlugin(home, 'skills'), 2, 'the Overview’s “from plugins” counts the two rows, once each');
});

test('A source’s skill that two plugins also bring is found once under each plugin’s name and under the source; an agent of its name stays apart', () => {
  const link = 'https://github.com/team/skills';
  // shared came from a source, Off, so no tool has a copy of its own: Claude Code gets it through review from market-one, Copilot
  // CLI through review from market-two. Both plugins' items fold onto its row. An agent called shared is the person’s own.
  const home = homeOf([fact('shared', [], { fromSource: { link }, plugin: { 'claude-cli': { plugin: 'review', marketplace: 'market-one' }, 'copilot-cli': { plugin: 'review', marketplace: 'market-two' } } })],
    [install('claude-cli', 'review', 'market-one', [skillIn('shared')]), install('copilot-cli', 'review', 'market-two', [skillIn('shared')])],
    [fact('shared', ['claude-cli'])]);
  assert.deepEqual(pageRows(home, 'skills').rows, [], 'one row: each plugin’s copy folds onto it');
  assert.deepEqual(shownBy(home, [review, otherReview, 'plugins', sourceFrom(link), 'yours']), { [review]: ['shared'], [otherReview]: ['shared'], plugins: ['shared'], [sourceFrom(link)]: ['shared'], yours: [] });
  const [agent] = originsIn(home, 'agents');
  assert.deepEqual(agent, { yours: true, plugins: [] }, 'the agent of the same name is the person’s own and no plugin’s');
});

test('A skill folded onto two plugins is counted once under Any plugin and once under each', () => {
  // Pi’s item is linked to pdf (no whole install there); Claude Code gets it through review: one row, two plugins.
  const home = homeOf([fact('notes', ['pi-cli'], { fromSource: { link: 'plugin:pdf@team-tools' }, plugin: { 'claude-cli': { plugin: 'review', marketplace: 'market-one' } } })],
    [install('claude-cli', 'review', 'market-one', [skillIn('notes')])]);
  assert.deepEqual(originOf(home.skills.items[0]!), { yours: false, plugins: [pdf, review] });
  assert.deepEqual(shownBy(home, ['plugins', pdf, review, 'yours']), { plugins: ['notes'], [pdf]: ['notes'], [review]: ['notes'], yours: [] });
});

test('An item linked to a plugin in Pi, with no whole install anywhere, is that plugin’s by its full name; once the pass unlinks it, it is the person’s own', () => {
  const linked = homeOf([], [], [fact('auditor', [], { fromSource: { link: 'plugin:audit-kit@market-two' } })]);
  assert.deepEqual(originsIn(linked, 'agents'), [{ yours: false, plugins: [pluginFrom('audit-kit', 'market-two')] }]);
  assert.deepEqual(fromChoices(linked, []).plugins.map(entry => [entry.value, entry.label]), [['plugins', 'Any plugin'], [pluginFrom('audit-kit', 'market-two'), 'audit-kit']]);
  // Edited in Pi, the pass let it go from its plugin: its versions still say where it came from, and nothing reads them.
  assert.deepEqual(originsIn(homeOf([], [], [fact('auditor', ['claude-cli'])]), 'agents'), [{ yours: true, plugins: [] }]);
});

test('A source removed from the home leaves its items the person’s own; an item a source dropped keeps that source, marked removed', () => {
  const link = 'https://github.com/team/skills';
  // After Remove, the view no longer resolves the item's stored source id: it has no fromSource.
  assert.deepEqual(originOf(fact('kept', ['claude-cli'])), { yours: true, plugins: [] });
  const dropped = originOf(fact('gone', [], { fromSource: { link, removed: true } }));
  assert.deepEqual(dropped, { yours: false, source: { link, removed: true }, plugins: [] });
  assert.deepEqual([fromShows(sourceFrom(link), dropped), fromShows('sources', dropped), fromShows('yours', dropped)], [true, true, false]);
});

test('The menu names each plugin with rows here once, two of one name told apart by marketplace, and each recorded source by a label that tells it apart', () => {
  const home = homeOf([fact('lint', [], { plugin: { 'claude-cli': { plugin: 'review', marketplace: 'market-one' } } })],
    [install('claude-cli', 'review', 'market-one', [skillIn('lint')]), install('claude-cli', 'review', 'market-two', [skillIn('style')]), install('claude-cli', 'pdf', 'team-tools', [])]);
  const { plugins, sources } = fromChoices(home, ['https://github.com/zed/long-repository-of-shared-skills/tree/main/review', 'https://github.com/ann/skills', 'https://github.com/bob/skills']);
  // pdf brings nothing here: no entry. In alphabetical order within each group, the Any entry first.
  assert.deepEqual(plugins.map(entry => entry.label), ['Any plugin', 'review (market-one)', 'review (market-two)']);
  assert.deepEqual(sources.map(entry => [entry.label, entry.title]), [['Any source', undefined], ['github.com/ann/skills', 'https://github.com/ann/skills'], ['github.com/bob/skills', 'https://github.com/bob/skills'],
    ['long-repository-of-shared-skills (review)', 'https://github.com/zed/long-repository-of-shared-skills/tree/main/review']]);
  assert.deepEqual(fromChoices(homeOf([fact('notes', ['claude-cli'])]), []), { plugins: [], sources: [] }, 'nothing from a plugin or a source: no group');
});
