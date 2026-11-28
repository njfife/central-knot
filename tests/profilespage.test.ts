// A profile held by a plugin that is off in a tool (profilespage.ts wayPast, turnOnControl): the header's line, its control in
// Switch's place and its `(?)` card come from one decision. Where one press turns the plugin on there (pluginline.ts lineControl's
// let-in, the Library line's own act) on the Plugins page's view read for the home on screen, it is `Turn on <plugin> in <Tool>`;
// where it can't, the header says why in view, with the link to the plugin's page. A held row has a control of its own only where
// its plugin or tool isn't the header's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView, InstalledPlugin, PluginsView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
const openedFiles: string[] = [];
const { dispatch } = installDom({
  skillVersionFile: async (key: string) => { openedFiles.push(`own:${key}`); return null; },
  skillPluginFile: async (ref: { plugin: string; part: string }) => { openedFiles.push(`plugin:${ref.plugin}/${ref.part}`); return null; },
}, { byId: id => findById(rendered, id) ?? null });

const { state: app } = await import('../src/app.ts');
const { profilesPage, rowKey } = await import('../src/profilespage.ts');
const { putPageData } = await import('../src/pagedata.ts');
const { market, resetMarket } = await import('../src/pluginstate.ts');

const triage = 'plugin:skill:alpha@team/triage';
/** A home where each tool has alpha installed, with its one skill triage, as `installs` says, and the profile Work ticks triage. */
function homeWith(installs: [HarnessId, Partial<InstalledPlugin>][]): HomeView {
  const kind = { tools: installs.map(([tool]) => tool), items: [], library: {}, gate: { state: 'ready' } };
  return { home: '/home', sync: { access: { allowed: true }, gate: { state: 'ready' }, caughtUp: [], managed: installs.map(([tool]) => tool) }, skills: kind, mcp: kind, agents: kind,
    pluginItems: installs.map(([tool, install]) => ({ tool, plugin: 'alpha', marketName: 'team', source: '/market', listed: true, items: [{ kind: 'skill', name: 'triage', description: '' }], ...install })),
    profiles: { profiles: [{ id: 'work', name: 'Work', items: [triage], switchesPluginItems: true }], plugins: [] } } as unknown as HomeView;
}
/** The Plugins page's view, read for the home on screen: alpha listed and installed off in each of `tools`, its boxes free to act unless `patch` says otherwise. */
const viewWith = (tools: HarnessId[], patch: Partial<PluginsView> = {}) => ({ home: '/home', canWrite: true, tools, clis: Object.fromEntries(tools.map(tool => [tool, true])),
  marketplaces: [{ source: '/market', name: 'team', kind: 'folder', plugins: [{ name: 'alpha' }], states: { alpha: Object.fromEntries(tools.map(tool => [tool, { state: 'installed', off: true }])) },
    switches: { alpha: { entry: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: tools }, tools: Object.fromEntries(tools.map(tool => [tool, { wanted: false, has: 'whole', takes: true }])) } } }],
  ...patch } as unknown as PluginsView);
const all = (node: unknown, match: (el: FakeNode) => boolean): FakeNode[] => (!node || typeof node !== 'object' ? []
  : [...((node as FakeNode).tag && match(node as FakeNode) ? [node as FakeNode] : []), ...((node as FakeNode).children ?? []).flatMap(child => all(child, match))]);
/** As drawn: the header's line, then each way past it, header first, as its id and words, then the held row's note. */
function drawn() {
  rendered = profilesPage() as unknown as FakeNode;
  const ways = all(rendered, el => /^(profile-turn-on|profile-open-plugin|pf-turn-on-|pf-plugin-)/.test(el.attrs?.id ?? '')).map(el => `${el.attrs.id}: ${textOf(el)}`);
  return [textOf(findById(rendered, 'profile-preview')), ...ways, ...all(rendered, el => el.className.split(/\s+/).includes('pf-note')).map(textOf)];
}
const card = () => textOf(findById(rendered, 'profile-preview-info-card'));

test('A held profile offers in Switch’s place the one press that turns its plugin on where the Library line would; its row says why, with no second press', () => {
  // Off in Codex or Copilot CLI, or kept off in Claude Code by the plugins record: one press, once the view read for this home is in.
  for (const [tool, name, install] of [['codex-cli', 'Codex', { off: true }], ['copilot-cli', 'Copilot CLI', { off: true }], ['claude-cli', 'Claude Code', { off: true, keptOff: true }]] as const) {
    app.home = homeWith([[tool, install]]);
    resetMarket();
    assert.deepEqual(drawn(), [`Can’t switch · alpha is off in ${name}`, 'profile-open-plugin: Open alpha', `Its plugin is off in ${name}.`], `${name}: before the Plugins page’s view is read, the link`);
    putPageData(market.read, viewWith([tool]));
    assert.deepEqual(drawn(), [`Can’t switch · alpha is off in ${name}`, `profile-turn-on: Turn on alpha in ${name}`, `Its plugin is off in ${name}.`], `${name}: its box can act, so one press`);
  }
  // The (?) card says what the press does, as its hover does: not that it can't be switched from here.
  assert.equal(card(), 'Turns alpha on in Claude Code, as its own switch there does.');
  app.home = homeWith([['codex-cli', { off: true }]]);
  putPageData(market.read, viewWith(['codex-cli']));
  drawn();
  assert.equal(card(), 'Turns alpha on in Codex, as its own switch there does. Its items come on with it there, except those their own switch keeps off; Switch then turns off the ones this profile leaves out, wherever they can be switched.');
  assert.equal(findById(rendered, 'profile-turn-on')?.attrs.title, card());
  // While that view is read again, or after a read that failed, what it says may be gone: the link, until a read answers.
  for (const state of ['reading', 'failed'] as const) {
    market.read.state = state;
    assert.deepEqual(drawn().slice(1, 2), ['profile-open-plugin: Open alpha'], state);
  }
});

test('Where one press can’t clear it, the header says why in view, with the link; a second plugin or tool held gets its own press on its row', () => {
  app.home = homeWith([['codex-cli', { off: true }]]);
  const off = (patch: Partial<PluginsView>) => { putPageData(market.read, viewWith(['codex-cli'], patch)); return drawn().slice(0, 2); };
  assert.deepEqual(off({ clis: { 'codex-cli': false } }), ['Can’t switch · No Codex command-line tool here', 'profile-open-plugin: Open alpha']);
  assert.deepEqual(off({ canWrite: false, reason: 'Preview only.' }), ['Can’t switch · this home can only be previewed', 'profile-open-plugin: Open alpha']);
  assert.deepEqual(off({ marketplaces: [] }), ['Can’t switch · alpha’s marketplace isn’t added here', 'profile-open-plugin: Open alpha']);
  assert.equal(findById(rendered, 'profile-open-plugin')?.attrs.title, 'Off in Codex. Its marketplace “team” isn’t added in Central Knot or in any tool here, so it can’t be turned on from here.');
  // Off in Codex and in Copilot CLI: the header's press is for the first its line names; Copilot CLI's row has its own.
  app.home = homeWith([['copilot-cli', { off: true }], ['codex-cli', { off: true }]]);
  putPageData(market.read, viewWith(['copilot-cli', 'codex-cli']));
  assert.deepEqual(drawn(), ['Can’t switch · alpha is off in Copilot CLI and 1 more', 'profile-turn-on: Turn on alpha in Copilot CLI', `pf-turn-on-${triage}-codex-cli: Turn on alpha in Codex`,
    'Its plugin is off in Copilot CLI.', 'Its plugin is off in Codex. Turn on alpha in Codex']);
  // Off in Claude Code without the record keeping it off: the profile turns the plugin whole there, so nothing is held.
  app.home = homeWith([['claude-cli', { off: true }]]);
  putPageData(market.read, viewWith(['claude-cli']));
  assert.deepEqual(drawn().filter(said => said.startsWith('profile-') || said.startsWith('pf-')), []);
});

test('With no profile in use, the page opens the one last switched to, titled as changed with its (?), and so does Edit profiles… in the status bar’s menu', async () => {
  const { newItem } = await import('../src/library.ts');
  const { profileState } = await import('../src/app.ts');
  const { profileStatus } = await import('../src/profilespage.ts');
  // notes is On and neither First nor Last has it, so neither is in use; Last was switched to last (ProfilesView `last`).
  const base = homeWith([]), kind = (library: Record<string, unknown>) => ({ ...base.skills, items: [], library });
  app.home = { ...base, skills: kind({ notes: { ...newItem('notes', 'notes'), on: true } }), mcp: kind({}), agents: kind({}),
    profiles: { profiles: [{ id: 'first', name: 'First', items: [], switchesPluginItems: true }, { id: 'last', name: 'Last', items: [], switchesPluginItems: true }], plugins: [], last: 'last' } } as unknown as HomeView;
  profileState.open = undefined;
  rendered = profilesPage() as unknown as FakeNode;
  const title = all(rendered, el => el.tag === 'h2')[0];
  assert.equal(title?.children.slice(0, 2).map(textOf).join(''), 'Last · changed', 'opened by default, before First');
  // Nothing is in Last, so it can't be switched to: its card makes no promise of a switch.
  assert.equal(textOf(findById(rendered, 'profile-changed-title-info-card')), 'What is on differs from Last, the profile you last switched to. Last itself is as you saved it.');
  // Its row in the list says it as every other place does, its name cut, never the words.
  const row = findById(rendered, 'profile-row-last');
  assert.deepEqual([textOf(findNode(row, el => el.className.split(/\s+/).includes('profile-row-head'))), findNode(row, el => el.className.includes('profile-changed '))], ['Last · changed', undefined]);
  // Edit profiles… opens it too, whichever profile was open.
  rendered = profileStatus() as unknown as FakeNode;
  findById(rendered, 'status-profile')?.onclick?.({ stopPropagation() {} });
  rendered = profileStatus() as unknown as FakeNode;
  profileState.open = 'first';
  app.page = 'library';
  findById(rendered, 'status-profile-edit')?.onclick?.({});
  assert.deepEqual([app.page, profileState.open], ['profiles', 'last'], 'it lands on Profiles, with Last open');
});

test('Marks cover own items, folded plugin skills, and Pi-linked copies, never whole-only plugin agents or servers; rowKey keeps server case; Escape and empty draws keep state true', async t => {
  const { newItem } = await import('../src/library.ts');
  const { profileState, setRenderer } = await import('../src/app.ts');
  const { pageRows } = await import('../src/pluginrows.ts');
  const { pluginLive } = await import('../src/profileplan.ts');
  const draw = () => (rendered = profilesPage() as unknown as FakeNode);
  setRenderer(() => { draw(); });
  const tools: HarnessId[] = ['claude-cli', 'pi-cli'];
  const held = (key: string, source?: string) => ({ ...newItem(key, key), on: true, hash: `h-${key}`, ...(source ? { source } : {}) });
  const fact = (key: string, extra = {}) => ({ key, name: key, on: true, copies: {}, except: [], ...extra });
  // Own triage has Claude Code through plugin alpha so pageRows folds alpha@team/triage onto it; both Profiles rows still get marks and open their own text.
  const home = app.home = {
    home: '/tmp/profiles-files-home', readId: 1, snapshots: [],
    sync: { access: { allowed: true }, gate: { state: 'ready' }, caughtUp: [], managed: tools },
    skills: { tools, items: [fact('triage', { plugin: { 'claude-cli': { plugin: 'alpha', marketplace: 'team' } } }), fact('placed')],
      library: { triage: held('triage'), placed: held('placed', 'p1') }, gate: { state: 'ready' } },
    mcp: { tools, items: [fact('docs')], library: { docs: held('docs') }, gate: { state: 'ready' } },
    agents: { tools, items: [fact('reviewer')], library: { reviewer: held('reviewer') }, gate: { state: 'ready' } },
    pluginItems: [{ tool: 'claude-cli', plugin: 'alpha', marketName: 'team', source: '/market', listed: true,
      items: [{ kind: 'skill', name: 'Triage', description: '', path: 'skills/triage' }, { kind: 'mcp', name: 'Issues', description: '' }, { kind: 'agent', name: 'Helper', description: '' }] }],
    profiles: { profiles: [{ id: 'work', name: 'Work', items: ['skill:triage'], switchesPluginItems: true }, { id: 'other', name: 'Other', items: ['skill:triage'], switchesPluginItems: true }],
      plugins: [{ id: 'p1', source: '/market', marketName: 'team', plugin: 'alpha', on: true }] },
  } as unknown as HomeView;
  app.page = 'profiles';
  profileState.open = 'work';
  const rowOfItem = (id: string) => findNode(rendered, el => el.dataset?.item === id);
  const has = (id: string, part: string) => !!findNode(rowOfItem(id), el => el.classList.contains(part));
  const markOf = (id: string) => findNode(rowOfItem(id), el => el.classList.contains('row-file-btn'));
  draw();
  await t.test('rowKey shares the Library’s key rule (keeps MCP server case)', () => {
    const plugged = pluginLive(home);
    assert.deepEqual([rowKey(plugged.find(item => item.kind === 'mcp')!), pageRows(home, 'mcp').rows[0]!.key, rowKey(plugged.find(item => item.name === 'Triage')!)],
      ['alpha@team/Issues', 'alpha@team/Issues', 'alpha@team/triage']);
  });
  await t.test('marks cover folded plugin skills and each same-named row opens its own text', () => {
    assert.equal(pageRows(home, 'skills').rows.length, 0);
    assert.deepEqual(['skill:triage', 'mcp:docs', 'agent:reviewer', 'plugin:skill:alpha@team/triage', 'plugin:skill:alpha@team/placed', 'plugin:mcp:alpha@team/Issues', 'plugin:agent:alpha@team/helper'].map(id => has(id, 'row-file-btn')),
      [true, true, true, true, true, false, false]);
    openedFiles.length = 0;
    markOf('skill:triage')!.click();
    markOf('plugin:skill:alpha@team/triage')!.click();
    assert.deepEqual(openedFiles, ['own:triage', 'plugin:alpha/skills/triage']);
  });
  await t.test('Rename and Delete confirmation claim Escape while the file stays open, and switching/empty draws clear the place', () => {
    markOf('skill:triage')!.click();
    const esc = (extra = {}) => ({ key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra });
    profileState.renaming = 'work';
    draw();
    const renameEsc = esc({ target: { value: 'Work' } });
    (findById(rendered, 'profile-name') as FakeNode & { onkeydown?: (e: unknown) => void }).onkeydown?.(renameEsc);
    dispatch('keydown', renameEsc);
    assert.deepEqual([profileState.renaming, has('skill:triage', 'details-file-only')], [undefined, true]);
    profileState.confirmDelete = 'work';
    draw();
    dispatch('keydown', esc());
    assert.deepEqual([profileState.confirmDelete, has('skill:triage', 'details-file-only'), findById(rendered, 'profile-delete')?.focused], [undefined, true, 1]);
    findById(rendered, 'profile-row-other')!.click();
    assert.equal(findNode(rendered, el => el.classList.contains('details-file-only')), undefined);
    markOf('skill:triage')!.click();
    (findById(rendered, 'profile-find') as FakeNode & { oninput?: (e: unknown) => void }).oninput?.({ target: { value: 'zzz-none' } });
    findById(rendered, 'profile-find-clear')!.click();
    assert.equal(findNode(rendered, el => el.classList.contains('details-file-only')), undefined);
    markOf('skill:triage')!.click();
    const savedProfiles = home.profiles.profiles;
    home.profiles.profiles = [];
    draw();
    home.profiles.profiles = savedProfiles;
    draw();
    assert.equal(findNode(rendered, el => el.classList.contains('details-file-only')), undefined);
  });
});
