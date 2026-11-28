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
let onNavigate: ((page: string) => void) | undefined;
let savedProfiles: unknown[] = [];
let nextHome: HomeView | null = null;
installDom({
  onNavigate: (fn: (page: string) => void) => { onNavigate = fn; },
  saveProfile: async (edit: unknown) => { savedProfiles.push(edit); return { profiles: app.home?.profiles }; },
  selectHome: async () => nextHome,
  readUsage: async () => ({ at: '2026-11-20T00:00:00.000Z', tools: [] }),
}, { byId: id => findById(rendered, id) ?? null });

const { state: app } = await import('../src/app.ts');
const { profilesPage } = await import('../src/profilespage.ts');
const { putPageData } = await import('../src/pagedata.ts');
const { market, resetMarket } = await import('../src/pluginstate.ts');

const triage = 'plugin:skill:alpha@team/triage';
/** A home where each tool has alpha installed, with its one skill triage, as `installs` says, and the profile Work ticks triage. */
function homeWith(installs: [HarnessId, Partial<InstalledPlugin>][]): HomeView {
  const kind = { tools: installs.map(([tool]) => tool), items: [], library: {}, gate: { state: 'ready' }, notices: [] };
  return { home: '/home', label: 'Home', mode: 'fixture', sync: { access: { allowed: true }, gate: { state: 'ready' }, caughtUp: [], takenIn: [], managed: installs.map(([tool]) => tool) }, skills: kind, mcp: kind, agents: kind,
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

const { newItem } = await import('../src/library.ts');
function changedHome(home = '/home') {
  const base = homeWith([]), kind = (library: Record<string, unknown>) => ({ ...base.skills, items: [], library });
  return { ...base, home, skills: kind({ notes: { ...newItem('notes', 'notes'), on: true }, standup: { ...newItem('standup', 'standup'), on: true } }), mcp: kind({}), agents: kind({}),
    profiles: { profiles: [{ id: 'last', name: 'Last', items: ['skill:notes'], switchesPluginItems: true }, { id: 'other', name: 'Other', items: ['skill:standup'], switchesPluginItems: true }], plugins: [], last: 'last' } } as unknown as HomeView;
}

test('Status bar menu renders a changed profile as heading + Switch back to <Name> with consequence + See changes…', async () => {
  const { profileStatus } = await import('../src/profilespage.ts');
  app.home = changedHome();
  const toggleMenu = () => { findById(profileStatus() as unknown as FakeNode, 'status-profile')?.onclick?.({ stopPropagation() {} }); return profileStatus() as unknown as FakeNode; };
  rendered = toggleMenu();
  try {
    const head = findNode(rendered, el => el.className.split(/\s+/).includes('pf-menu-head'));
    const back = findById(rendered, 'status-profile-switch-back'), see = findById(rendered, 'status-profile-see-changes');
    assert.deepEqual([head?.tag, textOf(head), !!findById(rendered, 'status-profile-last'), textOf(findNode(back, el => el.className.includes('pf-menu-name'))),
      textOf(findNode(back, el => el.className.includes('pf-menu-preview'))), textOf(findNode(see, el => el.className.includes('pf-menu-name'))), !!findById(rendered, 'status-profile-other')],
      ['div', 'Last · changed', false, 'Switch back to Last', 'Switching turns 1 item off', 'See changes…', true]);
    app.home = { ...app.home, sync: { ...app.home.sync, access: { allowed: false, reason: 'Preview only.' } } };
    rendered = profileStatus() as unknown as FakeNode;
    assert.deepEqual([textOf(findNode(rendered, el => el.className.split(/\s+/).includes('pf-menu-head'))), !!findById(rendered, 'status-profile-switch-back'), !!findById(rendered, 'status-profile-see-changes'), 'disabled' in (findById(profilesPage() as unknown as FakeNode, 'profile-switch')?.attrs ?? {})],
      ['Last · changed', false, true, true]);
  } finally { toggleMenu(); }
});

test('See changes… finishes an unblurred rename against its own profile, clears Find/delete and opens Changes pinned', async () => {
  const { profileState } = await import('../src/app.ts');
  const { profileStatus } = await import('../src/profilespage.ts');
  app.home = changedHome();
  app.page = 'profiles';
  profileState.open = 'other';
  (findById(profilesPage() as unknown as FakeNode, 'profile-find') as unknown as { oninput?: (e: unknown) => void })?.oninput?.({ target: { value: 'zzz' } });
  savedProfiles = [];
  profileState.confirmDelete = 'other';
  profileState.renaming = 'other';
  const input = findById(profilesPage() as unknown as FakeNode, 'profile-name') as unknown as { oninput?: (e: unknown) => void; onblur?: (e: unknown) => void };
  input?.oninput?.({ target: { value: 'Other Renamed' } });
  onNavigate?.('settings');
  input?.onblur?.({ target: { value: 'Other Renamed', isConnected: false } });
  assert.deepEqual(savedProfiles, [], 'disconnected blur on Settings shortcut did not save the rename');
  findById(profileStatus() as unknown as FakeNode, 'status-profile')?.onclick?.({ stopPropagation() {} });
  findById(profileStatus() as unknown as FakeNode, 'status-profile-see-changes')?.onclick?.({});
  await Promise.resolve();
  rendered = profilesPage() as unknown as FakeNode;
  assert.deepEqual([savedProfiles, app.page, profileState.open, profileState.confirmDelete, profileState.renaming, profileState.draft, (findById(rendered, 'profile-find') as unknown as { value?: string })?.value, profileState.changes?.off, !!findById(profileStatus() as unknown as FakeNode, 'status-profile-see-changes')],
    [[{ id: 'other', name: 'Other Renamed' }], 'profiles', 'last', undefined, undefined, undefined, '', ['skill:standup'], false]);
});

test('Leaving Profiles ends only See changes…’s pin; the page toggle’s pin survives leaving, and no pin survives another home', async () => {
  const { loadHome, profileState, showPage } = await import('../src/app.ts');
  const { profileStatus } = await import('../src/profilespage.ts');
  const homeA = changedHome();
  app.home = homeA;
  app.page = 'library';
  findById(profileStatus() as unknown as FakeNode, 'status-profile')?.onclick?.({ stopPropagation() {} });
  findById(profileStatus() as unknown as FakeNode, 'status-profile-see-changes')?.onclick?.({});
  const pinnedOff = () => profileState.changes?.off;
  assert.deepEqual(pinnedOff(), ['skill:standup'], 'See changes… pins Changes');
  showPage('library');
  showPage('profiles');
  assert.equal(pinnedOff(), undefined, 'See changes… pin ends on leaving Profiles');
  findById(profilesPage() as unknown as FakeNode, 'profile-changes')?.onclick?.({});
  assert.deepEqual(pinnedOff(), ['skill:standup'], 'page toggle pins Changes');
  showPage('library');
  showPage('profiles');
  const ownSurvived = pinnedOff();
  if (!profileState.changes) findById(profilesPage() as unknown as FakeNode, 'profile-changes')?.onclick?.({});
  nextHome = { ...homeWith([['codex-cli', {}]]), home: '/other-home', profiles: { profiles: [], plugins: [] } } as unknown as HomeView;
  await loadHome('actual');
  nextHome = homeA;
  await loadHome('fixture');
  assert.deepEqual([ownSurvived, profileState.changes], [['skill:standup'], undefined], 'page toggle pin survives leaving Profiles, and no pin survives switching to another home and back');
});
