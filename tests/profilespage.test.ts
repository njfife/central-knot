// A profile held by a plugin that is off in a tool (profilespage.ts turnOnControl): the header's control in Switch's place and the
// held row's come from one helper, so they can't differ. Where one press turns the plugin on there (pluginline.ts lineControl's
// let-in, the Library line's own act) it is `Turn on <plugin> in <Tool>`; where it can't, and until the Plugins page's view is
// read, it is the link to the plugin's page, as before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView, InstalledPlugin, PluginsView } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { byId: id => findById(rendered, id) ?? null });

const { state: app } = await import('../src/app.ts');
const { profilesPage } = await import('../src/profilespage.ts');
const { putPageData } = await import('../src/pagedata.ts');
const { market, resetMarket } = await import('../src/pluginstate.ts');

const triage = 'plugin:skill:alpha@team/triage';
/** A home where `tool` has alpha installed with its one skill, triage, as `install` says, and the profile Work ticks triage. */
function homeWith(tool: HarnessId, install: Partial<InstalledPlugin>): HomeView {
  const kind = { tools: [tool], items: [], library: {}, gate: { state: 'ready' } };
  return { home: '/home', sync: { access: { allowed: true }, gate: { state: 'ready' }, caughtUp: [] }, skills: kind, mcp: kind, agents: kind,
    pluginItems: [{ tool, plugin: 'alpha', marketName: 'team', source: '/market', listed: true, items: [{ kind: 'skill', name: 'triage', description: '' }], ...install }],
    profiles: { profiles: [{ id: 'work', name: 'Work', items: [triage], switchesPluginItems: true }], plugins: [] } } as unknown as HomeView;
}
/** The Plugins page's view, where alpha is listed and installed off in `tool`, its box free to act unless `patch` says otherwise. */
const viewWith = (tool: HarnessId, patch: Partial<PluginsView> = {}) => ({ home: '/home', canWrite: true, tools: [tool], clis: { [tool]: true },
  marketplaces: [{ source: '/market', name: 'team', kind: 'folder', plugins: [{ name: 'alpha' }], states: { alpha: { [tool]: { state: 'installed', off: true } } },
    switches: { alpha: { entry: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [tool] }, tools: { [tool]: { wanted: false, has: 'whole', takes: true } } } } }],
  ...patch } as unknown as PluginsView);
/** The header's control and the held row's, as drawn: each one's id and words. */
function drawn(tool: HarnessId) {
  rendered = profilesPage() as unknown as FakeNode;
  return ['profile-turn-on', 'profile-open-plugin', `pf-turn-on-${triage}-${tool}`, `pf-plugin-${triage}-${tool}`].flatMap(id => (findById(rendered, id) ? [`${id}: ${textOf(findById(rendered, id))}`] : []));
}
const pressIn = (tool: HarnessId, name: string) => [`profile-turn-on: Turn on alpha in ${name}`, `pf-turn-on-${triage}-${tool}: Turn on alpha in ${name}`];
const linkIn = (tool: HarnessId) => ['profile-open-plugin: Open alpha', `pf-plugin-${triage}-${tool}: Open alpha`];

test('A held profile offers the one press that turns its plugin on where the Library line would, header and row alike; else the link', () => {
  // Off in Codex or Copilot CLI, or kept off in Claude Code by the plugins record: one press, once the Plugins page's view is read.
  for (const [tool, name, install] of [['codex-cli', 'Codex', { off: true }], ['copilot-cli', 'Copilot CLI', { off: true }], ['claude-cli', 'Claude Code', { off: true, keptOff: true }]] as const) {
    app.home = homeWith(tool, install);
    resetMarket();
    assert.deepEqual(drawn(tool), linkIn(tool), `${name}: while the Plugins page’s view is read, the link, never a button`);
    putPageData(market.read, viewWith(tool));
    assert.deepEqual(drawn(tool), pressIn(tool, name), `${name}: its box can act, so one press`);
  }
  assert.equal(findById(rendered, 'profile-turn-on')?.attrs.title, 'Turns alpha on in Claude Code, as its own switch there does.');
  app.home = homeWith('codex-cli', { off: true });
  putPageData(market.read, viewWith('codex-cli'));
  assert.equal(drawn('codex-cli').length, 2);
  assert.equal(findById(rendered, 'profile-turn-on')?.attrs.title, 'Turns alpha on in Codex, as its own switch there does. Its items come on with it there, except those their own switch keeps off; Switch then turns off the ones this profile leaves out, wherever they can be switched.');
  // Its box can't act here: no command-line tool, a home only previewed, no marketplace here listing it. The link stays, titled with why.
  for (const [why, patch] of [['no CLI', { clis: { 'codex-cli': false } }], ['previewed', { canWrite: false, reason: 'Preview only.' }], ['unlisted', { marketplaces: [] }]] as [string, Partial<PluginsView>][]) {
    putPageData(market.read, viewWith('codex-cli', patch));
    assert.deepEqual(drawn('codex-cli'), linkIn('codex-cli'), why);
  }
  assert.equal(findById(rendered, 'profile-open-plugin')?.attrs.title, 'Off in Codex. Its marketplace “team” isn’t added in Central Knot or in any tool here, so it can’t be turned on from here.');
  // Off in Claude Code without the record keeping it off: the profile turns the plugin whole there, so nothing is held.
  app.home = homeWith('claude-cli', { off: true });
  putPageData(market.read, viewWith('claude-cli'));
  assert.deepEqual(drawn('claude-cli'), []);
});
