// Harnesses card heading button (harnesspage.ts summaryCard, goHarness): the card body is a div, the heading is the
// button with the tool's accessible label, keyboard Back focuses it, and mouse Back leaves focus alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView, PluginsView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { userAgent: 'Macintosh', byId: id => findById(rendered, id) ?? null });

const { setRenderer, state: app } = await import('../src/app.ts');
const { goHarness, harnessesPage } = await import('../src/harnesspage.ts');
const { putPageData } = await import('../src/pagedata.ts');
const { clickList, drop } = await import('../src/clicklist.ts');
const { market, resetMarket } = await import('../src/pluginstate.ts');

const findAll = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) findAll(child, match, out);
  return out;
};

const ALL_SIX: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'];
const SIX_NAMES: Record<HarnessId, string> = {
  'claude-cli': 'Claude Code',
  'copilot-cli': 'Copilot CLI',
  'codex-cli': 'Codex',
  'pi-cli': 'Pi',
  'opencode-cli': 'OpenCode',
  'antigravity-cli': 'Antigravity',
};

test('managed card has a div body and heading button; keyboard Back focuses it and mouse Back leaves focus alone', () => {
  const empty = {
    tools: ['claude-cli'],
    items: [],
    notices: [],
    problems: [],
    unread: [],
    access: { allowed: true },
    gate: { state: 'ready' },
    library: {},
  };
  app.home = {
    home: '/home',
    mode: 'actual',
    label: 'This computer',
    syncOn: true,
    snapshots: [{
      harness: 'claude-cli',
      root: '/home/.claude',
      discovery: 'found',
      detection: 'Installed',
      probe: { version: '2.1.330', detail: '' },
      skills: [],
      issues: [],
    }],
    sync: {
      present: ['claude-cli'],
      managed: ['claude-cli'],
      leftOut: [],
      writes: {},
      caughtUp: [],
      arrived: [],
      access: { allowed: true },
      gate: { state: 'ready' },
    },
    skills: empty,
    mcp: empty,
    agents: empty,
    pluginItems: [],
    pluginRecordsUnread: [],
    profiles: { profiles: [] },
    otherApps: [],
  } as unknown as HomeView;
  Object.assign(app, {
    page: 'harnesses',
    harness: undefined,
    harnessTab: 'skills',
    busy: undefined,
    instructions: { state: 'ready', data: [], gen: 0 },
  });
  setRenderer(() => {
    rendered = harnessesPage() as unknown as FakeNode;
  });
  rendered = harnessesPage() as unknown as FakeNode;

  const main = findNode(rendered, el => el.className.split(/\s+/).includes('harness-card-main'))!;
  const head = findById(rendered, 'harness-claude-cli')!;
  assert.equal(main.tag, 'div');
  assert.equal(main.onclick, undefined);
  assert.equal(head.tag, 'button');
  assert.equal(head.attrs['aria-label'], 'Claude Code. Open its page.');

  head.onclick!({});
  assert.equal(app.harness, 'claude-cli');
  goHarness(undefined, undefined, { fromKeyboard: true });
  assert.equal(app.harness, undefined);
  assert.equal(findById(rendered, 'harness-claude-cli')!.focused, 1);

  findById(rendered, 'harness-claude-cli')!.onclick!({});
  goHarness(undefined, undefined, { fromKeyboard: false });
  assert.equal(app.harness, undefined);
  assert.equal(findById(rendered, 'harness-claude-cli')!.focused, 0);

  app.busy = 'Working…';
  rendered = harnessesPage() as unknown as FakeNode;
  assert.equal('disabled' in findById(rendered, 'harness-claude-cli')!.attrs, true);
  app.busy = undefined;
  setRenderer(() => {});
});

function makeHome({
  managed = ['claude-cli', 'codex-cli'] as HarnessId[],
  leftOut = [] as HarnessId[],
  missing = [] as HarnessId[],
  allowed = true,
  mcpUnread = [] as HarnessId[],
  pluginItems = [] as unknown[],
  pluginRecordsUnread = [] as HarnessId[],
  skills = [] as unknown[],
  skillsLibrary = {} as Record<string, unknown>,
  mcp = [] as unknown[],
  snapshots,
}: {
  managed?: HarnessId[];
  leftOut?: HarnessId[];
  missing?: HarnessId[];
  allowed?: boolean;
  mcpUnread?: HarnessId[];
  pluginItems?: unknown[];
  pluginRecordsUnread?: HarnessId[];
  skills?: unknown[];
  skillsLibrary?: Record<string, unknown>;
  mcp?: unknown[];
  snapshots?: unknown[];
} = {}): HomeView {
  const present = [...managed, ...leftOut];
  const all = [...present, ...missing];
  const lib = (tools: HarnessId[], items: unknown[] = [], unread: HarnessId[] = [], library: Record<string, unknown> = {}) => ({
    tools, items, notices: [], problems: [], unread, access: { allowed }, gate: { state: 'ready' }, library,
  });
  return {
    home: '/home',
    mode: 'actual',
    label: 'This computer',
    syncOn: true,
    snapshots: snapshots ?? all.map(harness => ({
      harness, root: `/home/.${harness}`,
      discovery: missing.includes(harness) ? 'missing' : 'found',
      detection: missing.includes(harness) ? 'Not found' : 'Installed',
      probe: { version: missing.includes(harness) ? undefined : '1.0.0', detail: '' },
      skills: [], issues: [],
    })),
    sync: {
      present, managed, leftOut, writes: {}, caughtUp: [], arrived: [],
      access: allowed ? { allowed: true } : { allowed: false, reason: 'Preview only' },
      gate: { state: 'ready' },
    },
    skills: lib(present, skills, [], skillsLibrary),
    mcp: lib(present, mcp, mcpUnread),
    agents: lib(present.filter(tool => tool !== 'antigravity-cli')),
    pluginItems,
    pluginRecordsUnread,
    profiles: { profiles: [] },
    otherApps: [],
  } as unknown as HomeView;
}

test('locked home keeps every Manage switch named for its tool with lock reason and no card, question or dangling description', () => {
  app.home = makeHome({ managed: ALL_SIX.slice(1), leftOut: ['claude-cli'], allowed: false });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  assert.equal(findById(rendered, 'manage-info'), undefined);
  assert.equal(findById(rendered, 'manage-claude-cli-info'), undefined);
  for (const tool of ALL_SIX) {
    const sw: FakeNode = findById(rendered, `manage-${tool}`)!;
    assert.ok(sw.attrs['aria-label']?.includes(`Manage ${SIX_NAMES[tool]}`), `locked ${tool} switch keeps tool name`);
    assert.match(sw.attrs.title ?? '', /Preview only/);
    assert.match(sw.attrs['aria-description'] ?? '', /Preview only/);
    assert.equal(sw.attrs['aria-describedby'], undefined, `locked ${tool} switch has no dangling aria-describedby`);
    assert.equal(findById(rendered, `manage-${tool}-text`), undefined);
  }
  assert.match(textOf(findNode(rendered, el => el.className.split(/\s+/).includes('tools-note'))), /^Preview only:/);
});

test('an unread kind shows ? even when a plugin supplies an item of that kind (matches Overview)', () => {
  app.home = makeHome({
    managed: ['codex-cli'],
    mcpUnread: ['codex-cli'],
    pluginItems: [{
      tool: 'codex-cli',
      plugin: 'doc-kit',
      marketName: 'team',
      source: 'team/plugins',
      items: [{ kind: 'mcp', name: 'tracker-api', description: '', runs: 'npx -y tracker' }],
    }],
  });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  const codexCard = findNode(rendered, el => el.className.split(/\s+/).includes('harness-card') && !!findById(el, 'harness-codex-cli'))!;
  const mcpRow = findAll(codexCard, el => el.className.split(/\s+/).includes('harness-count')).find(row => textOf(row).startsWith('MCP servers'));
  assert.equal(textOf(mcpRow), 'MCP servers?couldn’t be read');
});

test('Plugins tab matches boxOf disabled rule, shows box.line on locked rows, and says whole-view stop reasons once above the list', () => {
  const makeView = (patch: Partial<PluginsView> = {}): PluginsView => ({
    home: '/home',
    canWrite: true,
    tools: ['claude-cli'],
    clis: { 'claude-cli': true },
    marketplaces: [{
      source: '/market',
      name: 'team',
      kind: 'folder',
      sourceLabel: '/market',
      origins: ['central-knot'],
      readAt: '2026-11-26T00:00:00.000Z',
      plugins: [{ name: 'alpha', description: 'Alpha plugin.' }],
      states: { alpha: { 'claude-cli': { state: 'installed', version: '1.0.0', path: '/p' } } },
      switches: { alpha: { entry: { id: 'e1', source: '/market', marketName: 'team', plugin: 'alpha', on: true, except: [] }, tools: { 'claude-cli': { wanted: true, has: 'whole', takes: true } } } },
    }],
    ...patch,
  } as unknown as PluginsView);

  // Home whose record is stopped while plugin view can write: Plugins tab switch follows boxOf (enabled, no second rule).
  resetMarket();
  app.home = makeHome({ managed: ['claude-cli'] });
  app.home.sync.gate = { state: 'stopped', reason: 'Sync record stopped.' };
  Object.assign(app, { page: 'harnesses', harness: 'claude-cli', harnessTab: 'plugins', busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  putPageData(market.read, makeView({ canWrite: true }));
  rendered = harnessesPage() as unknown as FakeNode;
  const enabledSw = findById(rendered, 'harness-plugin-switch-team-alpha')!;
  assert.equal('disabled' in enabledSw.attrs, false, 'switch is enabled whenever boxOf leaves box.off undefined');
  assert.equal(findById(rendered, 'harness-plugins-stopped'), undefined);

  // Missing CLI: box.line shows on the row and full box.off stays on hover/aria-description.
  putPageData(market.read, makeView({ canWrite: true, clis: { 'claude-cli': false } }));
  rendered = harnessesPage() as unknown as FakeNode;
  const lockedSw = findById(rendered, 'harness-plugin-switch-team-alpha')!;
  const lockedState = findNode(rendered, el => el.className.split(/\s+/).includes('harness-plugin-state'))!;
  assert.equal('disabled' in lockedSw.attrs, true);
  assert.equal(textOf(lockedState), 'No Claude Code command-line tool here');
  assert.match(lockedSw.attrs['aria-description'] ?? '', /command-line tool/);

  // Preview-only home: reason appears once above the list, not repeated on each row, and switches stay disabled with that reason.
  const preview = 'Preview only: changes are off here.';
  putPageData(market.read, makeView({ canWrite: false, reason: preview }));
  rendered = harnessesPage() as unknown as FakeNode;
  const previewNote = findById(rendered, 'harness-plugins-stopped')!;
  const previewSw = findById(rendered, 'harness-plugin-switch-team-alpha')!;
  assert.equal(textOf(previewNote), preview);
  assert.equal(findNode(rendered, el => el.className.split(/\s+/).includes('harness-plugin-state')), undefined);
  assert.equal('disabled' in previewSw.attrs, true);
  assert.equal(previewSw.attrs.title, preview);

  // Whole-view switchProblem: said once above the list.
  const problem = 'Plugins record could not be read.';
  putPageData(market.read, makeView({ canWrite: true, switchProblem: problem }));
  rendered = harnessesPage() as unknown as FakeNode;
  assert.equal(textOf(findById(rendered, 'harness-plugins-stopped')), problem);
  resetMarket();
});

const mkMarket = (source: string, name: string, plugins: { name: string; description: string; displayName?: string }[], states: Record<string, unknown>, switches: Record<string, unknown>) => ({
  source, name, kind: 'folder', sourceLabel: source, origins: ['central-knot'], readAt: '2026-11-26T00:00:00.000Z', plugins, states, switches,
});

function pluginsTabFixture(extra: { versions?: Record<string, string>; markets?: unknown[] } = {}) {
  resetMarket();
  drop(() => true);
  app.home = makeHome({
    managed: ['claude-cli'],
    pluginItems: [
      { tool: 'claude-cli', plugin: 'incident.io', marketName: 'anthropic-plugin-directory', listed: false, items: [] },
      { tool: 'claude-cli', plugin: 'shared-tool', marketName: 'private-market', listed: false, items: [] },
      { tool: 'claude-cli', plugin: 'lone-dir', marketName: 'anthropic-plugin-directory', listed: false, items: [] },
    ],
  });
  Object.assign(app, { page: 'harnesses', harness: 'claude-cli', harnessTab: 'plugins', busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  putPageData(market.read, {
    home: '/home',
    canWrite: true,
    tools: ['claude-cli'],
    clis: { 'claude-cli': true },
    ...(extra.versions ? { versions: extra.versions } : {}),
    marketplaces: [
      mkMarket('/m1', 'team-one', [
        { name: 'shared-tool', description: 'One.' },
        { name: 'kept-off-tool', description: 'Off.' },
        { name: 'stays-tool', description: 'Stays.' },
        { name: 'unread-tool', description: 'Unread.' },
      ], {
        'shared-tool': { 'claude-cli': { state: 'installed', version: '1.0.0', path: '/p1' } },
        'kept-off-tool': { 'claude-cli': { state: 'installed', version: '1.1.0', path: '/p2', off: true } },
        'stays-tool': { 'claude-cli': { state: 'installed', version: '1.2.0', path: '/p3' } },
        'unread-tool': { 'claude-cli': { state: 'installed', version: '1.3.0', path: '/p4' } },
      }, {
        'shared-tool': { entry: { id: 'e1', source: '/m1', marketName: 'team-one', plugin: 'shared-tool', on: true, except: [] }, tools: { 'claude-cli': { wanted: true, has: 'whole', takes: true } } },
        'kept-off-tool': { entry: { id: 'e2', source: '/m1', marketName: 'team-one', plugin: 'kept-off-tool', on: false, except: [] }, tools: { 'claude-cli': { wanted: false, has: 'whole', takes: true } } },
        'stays-tool': { entry: { id: 'e3', source: '/m1', marketName: 'team-one', plugin: 'stays-tool', on: false, except: [] }, tools: { 'claude-cli': { wanted: false, has: 'whole', takes: true } } },
        'unread-tool': { entry: { id: 'e4', source: '/m1', marketName: 'team-one', plugin: 'unread-tool', on: true, except: [] }, tools: { 'claude-cli': { wanted: true, has: 'unknown', takes: true } } },
      }),
      mkMarket('/m2', 'team-two', [
        { name: 'shared-tool', description: 'Two.' },
        { name: 'incident-io', description: 'From dir.' },
      ], {
        'shared-tool': { 'claude-cli': { state: 'installed', version: '2.0.0', path: '/p5' } },
        'incident-io': { 'claude-cli': { state: 'installed', version: '3.0.0', path: '/p6', directory: 'incident.io@anthropic-plugin-directory' } },
      }, {
        'shared-tool': { entry: { id: 'e5', source: '/m2', marketName: 'team-two', plugin: 'shared-tool', on: true, except: [] }, tools: { 'claude-cli': { wanted: true, has: 'whole', takes: true } } },
        'incident-io': { entry: { id: 'e6', source: '/m2', marketName: 'team-two', plugin: 'incident-io', on: true, except: [] }, tools: { 'claude-cli': { wanted: true, has: 'whole', takes: true } } },
      }),
      ...(extra.markets ?? []),
    ],
  } as unknown as PluginsView);
  const draw = () => {
    rendered = harnessesPage() as unknown as FakeNode;
    const rows = findAll(rendered, el => el.className.split(/\s+/).includes('harness-plugin'));
    return { rows, rowOf: (id: string) => rows.find(row => !!findById(row, id))! };
  };
  return { draw };
}

test('Plugins tab switch carries its consequence on title and aria-description while aria-label stays concise', () => {
  const { draw } = pluginsTabFixture();
  try {
    draw();
    const onSw = findById(rendered, 'harness-plugin-switch-team-one-shared-tool')!;
    assert.equal(onSw.attrs['aria-label'], 'shared-tool (team-one) in Claude Code');
    assert.equal(onSw.attrs.title, 'Click to turn shared-tool (team-one) off in Claude Code, kept installed: it stays off until you turn it on again. Undo turns it on again.');
    assert.equal(onSw.attrs['aria-description'], onSw.attrs.title);
    const onPage = findById(rendered, 'harness-plugin-team-one-shared-tool')!;
    assert.equal(onPage.attrs['aria-label'], 'Open shared-tool (team-one) in Plugin marketplaces');
    const offSw = findById(rendered, 'harness-plugin-switch-team-one-kept-off-tool')!;
    assert.equal(offSw.attrs['aria-label'], 'kept-off-tool in Claude Code');
    assert.equal(offSw.attrs.title, 'Click to turn kept-off-tool on in Claude Code alone. Undo turns it off again.');
    assert.equal(offSw.attrs['aria-description'], offSw.attrs.title);
  } finally { resetMarket(); }
});

test('Plugins tab shows stays, unknown and stuck/held state lines with an accessible info mark carrying the full reason', () => {
  // Anthropic Directory installs are stuck (cantUninstall -> FROM_DIRECTORY): on shows 'Can’t be turned off here', off shows 'Off, kept installed · can’t be changed here'.
  const { draw } = pluginsTabFixture({
    markets: [mkMarket('/m3', 'dir-off', [{ name: 'dir-off-tool', description: 'Off dir.' }], {
      'dir-off-tool': { 'claude-cli': { state: 'installed', version: '1.0.0', path: '/p7', off: true, directory: 'dir.off@anthropic-plugin-directory' } },
    }, {
      'dir-off-tool': { entry: { id: 'e7', source: '/m3', marketName: 'dir-off', plugin: 'dir-off-tool', on: false, except: [] }, tools: { 'claude-cli': { wanted: false, has: 'whole', takes: true } } },
    })],
  });
  try {
    const { rowOf } = draw();
    const staysState = findNode(rowOf('harness-plugin-team-one-stays-tool'), el => el.className.split(/\s+/).includes('harness-plugin-state'))!;
    assert.equal(textOf(staysState), 'Still installed');
    assert.match(staysState.attrs.title ?? '', /The plugin is off/);

    const unreadState = findNode(rowOf('harness-plugin-team-one-unread-tool'), el => el.className.split(/\s+/).includes('harness-plugin-state'))!;
    assert.equal(textOf(unreadState), 'Can’t be read now');
    assert.match(unreadState.attrs.title ?? '', /record of its plugins can’t be read now/);

    const stuckOnRow = rowOf('harness-plugin-team-two-incident-io');
    const stuckOnState = findNode(stuckOnRow, el => el.className.split(/\s+/).includes('harness-plugin-state'))!;
    assert.equal(textOf(stuckOnState), 'Can’t be turned off here');
    const stuckOnMark = findById(stuckOnRow, 'harness-plugin-why-team-two-incident-io')!;
    const stuckOnCard = findById(stuckOnRow, 'harness-plugin-why-team-two-incident-io-card')!;
    assert.equal(stuckOnMark.classList.contains('info-mark'), true);
    assert.match(textOf(stuckOnCard), /Anthropic Directory.*\/plugin/);

    const stuckOffRow = rowOf('harness-plugin-dir-off-dir-off-tool');
    const stuckOffState = findNode(stuckOffRow, el => el.className.split(/\s+/).includes('harness-plugin-state'))!;
    assert.equal(textOf(stuckOffState), 'Off, kept installed · can’t be changed here');
    const stuckOffMark = findById(stuckOffRow, 'harness-plugin-why-dir-off-dir-off-tool')!;
    const stuckOffCard = findById(stuckOffRow, 'harness-plugin-why-dir-off-dir-off-tool-card')!;
    assert.equal(stuckOffMark.classList.contains('info-mark'), true);
    assert.match(textOf(stuckOffCard), /Anthropic Directory.*\/plugin/);

    assert.equal(findNode(rowOf('harness-plugin-team-one-kept-off-tool'), el => el.classList.contains('info-mark')), undefined);
  } finally { resetMarket(); }
});

test('Plugins tab names the marketplace on row, question, switch and Its page whenever another listed catalog shares the title, even with only one installed', () => {
  const { draw } = pluginsTabFixture();
  try {
    // Uninstall team-two's copy so only team-one's shared-tool is installed while both catalogs still list shared-tool.
    market.view!.marketplaces[1]!.states['shared-tool']!['claude-cli'] = { state: 'not-installed' };
    const { rowOf } = draw();
    const row = rowOf('harness-plugin-team-one-shared-tool');
    assert.equal(textOf(findNode(row, el => el.className.split(/\s+/).includes('harness-plugin-market'))), ' · team-one');
    assert.equal(findById(row, 'harness-plugin-switch-team-one-shared-tool')!.attrs['aria-label'], 'shared-tool (team-one) in Claude Code');
    assert.equal(findById(row, 'harness-plugin-team-one-shared-tool')!.attrs['aria-label'], 'Open shared-tool (team-one) in Plugin marketplaces');
    assert.equal(findNode(rowOf('harness-plugin-team-one-kept-off-tool'), el => el.className.split(/\s+/).includes('harness-plugin-market')), undefined);

    const detail = { skills: [], commands: [], agents: [], instructions: [], offered: true, installed: { 'claude-cli': { skills: [], commands: [], agents: [], instructions: [], version: '1.0.0' } } };
    market.details.set('/m1\u0000shared-tool', { reading: false, value: detail as never });
    market.asking = '/m1\u0000shared-tool\u0000claude-cli';
    const { rowOf: rowAfterAsk } = draw();
    const sharedAsk = findNode(rowAfterAsk('harness-plugin-team-one-shared-tool'), el => el.className.split(/\s+/).includes('uninstall-ask'))!;
    assert.match(textOf(sharedAsk), /^Uninstall shared-tool \(team-one\) from Claude Code\?/);

    market.details.set('/m1\u0000kept-off-tool', { reading: false, value: detail as never });
    market.asking = '/m1\u0000kept-off-tool\u0000claude-cli';
    const { rowOf: rowUniqueAsk } = draw();
    const uniqueAsk = findNode(rowUniqueAsk('harness-plugin-team-one-kept-off-tool'), el => el.className.split(/\s+/).includes('uninstall-ask'))!;
    assert.match(textOf(uniqueAsk), /^Uninstall kept-off-tool from Claude Code\?/);
  } finally { resetMarket(); }
});

test('Plugins tab deduplicates real installed identities and filters the unlisted notice by real installId', () => {
  const { draw } = pluginsTabFixture({
    markets: [{
      source: '/m3', name: 'team-mirror', kind: 'folder', sourceLabel: '/m3', origins: ['central-knot'], readAt: '2026-11-26T00:00:00.000Z',
      plugins: [{ name: 'incident-io', description: 'Mirror of same directory install.' }],
      states: { 'incident-io': { 'claude-cli': { state: 'installed', version: '3.0.0', path: '/p6', directory: 'incident.io@anthropic-plugin-directory' } } },
      switches: { 'incident-io': { entry: { id: 'e7', source: '/m3', marketName: 'team-mirror', plugin: 'incident-io', on: true, except: [] }, tools: { 'claude-cli': { wanted: true, has: 'whole', takes: true } } } },
    }],
  });
  try {
    const { rows } = draw();
    const incidentRows = rows.filter(row => textOf(row).includes('incident-io'));
    assert.equal(incidentRows.length, 1, 'two catalogs matching one Anthropic Directory install must produce one row');
    const unlistedText = textOf(findById(rendered, 'harness-plugins-unlisted'));
    assert.doesNotMatch(unlistedText, /incident\.io/);
    assert.match(unlistedText, /shared-tool \(private-market\)/);
    assert.match(unlistedText, /lone-dir \(anthropic-plugin-directory\)/);
  } finally { resetMarket(); }
});

test('Plugins tab keeps Its page quiet (ghost) and placed between Uninstall… and the switch', () => {
  const { draw } = pluginsTabFixture();
  try {
    const { rowOf } = draw();
    const sharedRow = rowOf('harness-plugin-team-one-shared-tool');
    const pageBtn = findById(sharedRow, 'harness-plugin-team-one-shared-tool')!;
    const uninstallBtn = findById(sharedRow, 'harness-plugin-uninstall-team-one-shared-tool')!;
    const onSw = findById(sharedRow, 'harness-plugin-switch-team-one-shared-tool')!;
    assert.ok(pageBtn.className.split(/\s+/).includes('ghost'), `Its page should use ghost variant, got: ${pageBtn.className}`);
    assert.equal(pageBtn.className.split(/\s+/).includes('link'), false);
    const direct = sharedRow.children as FakeNode[];
    assert.ok(direct.indexOf(uninstallBtn) < direct.indexOf(pageBtn) && direct.indexOf(pageBtn) < direct.indexOf(onSw), 'order must be uninstall, Its page, switch');
  } finally { resetMarket(); }
});

test('Plugins tab shows live waiting and running clicks on rows and describes their disabled switches', () => {
  const { draw } = pluginsTabFixture();
  try {
    clickList.turns.push(
      { state: 'running', run: { place: 'plugins:claude-cli', lastAt: 0 }, place: 'claude-cli', work: async () => {}, source: '/m1', plugin: 'shared-tool', what: 'keep-out', tool: 'claude-cli', said: { waiting: 'Waiting to turn off in Claude Code', running: 'Turning off in Claude Code…' } } as never,
      { state: 'waiting', run: { place: 'plugins:claude-cli', lastAt: 0 }, place: 'claude-cli', work: async () => {}, source: '/m1', plugin: 'kept-off-tool', what: 'let-in', tool: 'claude-cli', said: { waiting: 'Waiting to turn on in Claude Code', running: 'Turning on in Claude Code…' } } as never,
    );
    const { rowOf } = draw();
    const runningClick = findNode(rowOf('harness-plugin-team-one-shared-tool'), el => el.attrs['data-click'] === 'running')!;
    const waitingClick = findNode(rowOf('harness-plugin-team-one-kept-off-tool'), el => el.attrs['data-click'] === 'waiting')!;
    assert.equal(textOf(runningClick), 'Turning off in Claude Code…');
    assert.equal(textOf(waitingClick), 'Waiting to turn on in Claude Code');
    assert.equal(findById(rendered, 'harness-plugin-switch-team-one-shared-tool')!.attrs.title, 'Turning off in Claude Code…');
    assert.equal(findById(rendered, 'harness-plugin-switch-team-one-kept-off-tool')!.attrs.title, 'Waiting to turn on in Claude Code');
  } finally {
    drop(() => true);
    resetMarket();
  }
});

test('tool page tabs keep full labels and switcher buttons carry accessible tool names', () => {
  app.home = makeHome({ managed: ALL_SIX });
  Object.assign(app, { page: 'harnesses', harness: 'claude-cli', harnessTab: 'skills', busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  const tabLabels = findAll(rendered, el => el.className.split(/\s+/).includes('harness-tab')).map(el => textOf(el));
  assert.deepEqual(tabLabels, ['Skills', 'MCP servers', 'Agents', 'Instructions', 'Plugins', 'About']);
  for (const tool of ALL_SIX) {
    const sw: FakeNode = findById(rendered, `harness-switch-${tool}`)!;
    assert.equal(sw.attrs['aria-label'], SIX_NAMES[tool]);
    assert.equal(sw.attrs.title, SIX_NAMES[tool]);
    assert.equal(textOf(findNode(sw, el => el.className.split(/\s+/).includes('harness-switch-name'))!), SIX_NAMES[tool]);
  }
});

test('capability reasons live on a keyboard-accessible dash mark naming whose limit it is with no inline prose', () => {
  app.home = makeHome({ managed: ['pi-cli', 'antigravity-cli'] });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  const antigravity = findById(rendered, 'harness-card-antigravity-cli')!;
  const agentsRow = findAll(antigravity, el => el.classList.contains('harness-count')).find(row => textOf(row.children[0]) === 'Agents')!;
  const agentsVal = findNode(agentsRow, el => el.classList.contains('harness-count-value'))!;
  const agentsDash = findById(agentsRow, 'harness-antigravity-cli-agents-reason')!;
  const agentsCard = findById(agentsRow, 'harness-antigravity-cli-agents-reason-card')!;
  assert.equal(agentsVal.classList.contains('harness-count-span'), true);
  assert.equal(agentsVal.classList.contains('tone-faint'), false);
  assert.equal(agentsDash.tag, 'button');
  assert.equal(agentsDash.classList.contains('info-mark'), true);
  assert.equal(agentsDash.classList.contains('harness-count-dash'), true);
  assert.equal(textOf(agentsDash), '—');
  assert.equal(agentsDash.attrs['aria-describedby'], 'harness-antigravity-cli-agents-reason-card');
  assert.match(agentsDash.attrs['aria-label'] ?? '', /Antigravity Agents/);
  assert.equal(agentsCard.attrs.role, 'tooltip');
  assert.equal(agentsCard.attrs.popover, 'manual');
  assert.equal(textOf(agentsCard), 'Central Knot doesn’t handle agents for Antigravity.');
  assert.equal(findNode(agentsRow, el => el.classList.contains('harness-count-note')), undefined);

  const pi = findById(rendered, 'harness-card-pi-cli')!;
  const pluginsRow = findAll(pi, el => el.classList.contains('harness-count')).find(row => textOf(row.children[0]) === 'Plugins')!;
  const pluginsVal = findNode(pluginsRow, el => el.classList.contains('harness-count-value'))!;
  const pluginsDash = findById(pluginsRow, 'harness-pi-cli-plugins-reason')!;
  const pluginsCard = findById(pluginsRow, 'harness-pi-cli-plugins-reason-card')!;
  assert.equal(pluginsVal.classList.contains('harness-count-span'), true);
  assert.equal(pluginsVal.classList.contains('tone-faint'), false);
  assert.equal(pluginsDash.tag, 'button');
  assert.equal(textOf(pluginsDash), '—');
  assert.equal(pluginsDash.attrs['aria-describedby'], 'harness-pi-cli-plugins-reason-card');
  assert.equal(textOf(pluginsCard), 'Pi takes a plugin’s items, not the plugin');
  assert.equal(findNode(pluginsRow, el => el.classList.contains('harness-count-note')), undefined);
});

test('existing instruction files link to their Instructions tab, empty files keep (empty) plain, and no file yet stays plain', () => {
  app.home = makeHome({ managed: ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'] });
  Object.assign(app, {
    page: 'harnesses', harness: undefined, harnessTab: 'skills', busy: undefined,
    instructions: {
      state: 'ready', gen: 0,
      data: [
        { tool: 'claude-cli', path: '/home/.claude/CLAUDE.md', exists: true, text: 'Be brief.\n' },
        { tool: 'copilot-cli', path: '/home/.copilot/copilot-instructions.md', exists: true, text: 'Rules.\n' },
        { tool: 'codex-cli', path: '/home/.codex/AGENTS.md', exists: true, text: '   \n' },
        { tool: 'pi-cli', path: '/home/.pi/agent/AGENTS.md', exists: false, text: '' },
      ],
    },
  });
  rendered = harnessesPage() as unknown as FakeNode;

  const rowIn = (card: FakeNode, label: string) => findAll(card, el => el.classList.contains('harness-count')).find(row => textOf(row.children[0]) === label)!;
  const claude = findById(rendered, 'harness-card-claude-cli')!;
  const claudeInsLink = findById(claude, 'harness-claude-cli-instructions')!;
  assert.equal(claudeInsLink.tag, 'button');
  assert.equal(claudeInsLink.classList.contains('harness-count-link'), true);
  assert.equal(textOf(claudeInsLink), 'CLAUDE.md');
  assert.equal(claudeInsLink.attrs.title, 'Open Claude Code’s Instructions tab');
  claudeInsLink.onclick!({});
  assert.equal(app.harness, 'claude-cli');
  assert.equal(app.harnessTab, 'instructions');
  app.harness = undefined;
  app.harnessTab = 'skills';

  app.busy = 'Working…';
  rendered = harnessesPage() as unknown as FakeNode;
  assert.equal('disabled' in findById(rendered, 'harness-claude-cli-instructions')!.attrs, true);
  app.busy = undefined;
  rendered = harnessesPage() as unknown as FakeNode;

  const copilotIns = rowIn(findById(rendered, 'harness-card-copilot-cli')!, 'Instructions');
  assert.equal(findNode(copilotIns, el => el.classList.contains('harness-count-value')), undefined);
  const copilotInsNote = findNode(copilotIns, el => el.classList.contains('harness-count-note'))!;
  assert.equal(copilotInsNote.classList.contains('harness-count-span'), true);
  assert.equal(textOf(copilotInsNote), 'copilot-instructions.md');
  assert.equal(findById(copilotIns, 'harness-copilot-cli-instructions')?.attrs.title, 'Open Copilot CLI’s Instructions tab');

  const codexIns = rowIn(findById(rendered, 'harness-card-codex-cli')!, 'Instructions');
  assert.equal(textOf(findNode(codexIns, el => el.classList.contains('harness-count-span'))), 'AGENTS.md (empty)');
  assert.equal(textOf(findById(codexIns, 'harness-codex-cli-instructions')), 'AGENTS.md');

  const piIns = rowIn(findById(rendered, 'harness-card-pi-cli')!, 'Instructions');
  assert.equal(findNode(piIns, el => el.classList.contains('harness-count-value')), undefined);
  assert.equal(findNode(piIns, el => el.classList.contains('harness-count-span'))?.textContent, 'no file yet');
  assert.equal(findById(piIns, 'harness-pi-cli-instructions'), undefined);
});

test('failed instructions read shows ? with couldn’t be read, matching every other unread row', () => {
  app.home = makeHome({ managed: ['claude-cli'] });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'failed', data: undefined, gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  const claude = findById(rendered, 'harness-card-claude-cli')!;
  const insRow = findAll(claude, el => el.classList.contains('harness-count')).find(row => textOf(row.children[0]) === 'Instructions')!;
  assert.equal(textOf(findNode(insRow, el => el.classList.contains('harness-count-value'))), '?');
  assert.equal(textOf(findNode(insRow, el => el.classList.contains('harness-count-note'))), 'couldn’t be read');
  assert.equal(findById(insRow, 'harness-claude-cli-instructions'), undefined);
});

test('plugin count hides installed and bare counts describe what they count without claiming copies match', () => {
  const skillFact = (key: string, tool: HarnessId, on: boolean) => ({
    key, name: key, description: '', on, except: [], copies: { [tool]: { contentId: 'h1', directory: `/home/${key}` } },
  });
  const mcpFact = (key: string, tool: HarnessId) => ({
    key, name: key, description: '', on: true, except: [], copies: { [tool]: { contentId: 'h2', directory: `/home/${key}` } },
  });
  app.home = makeHome({
    managed: ['claude-cli', 'copilot-cli', 'pi-cli'],
    skills: [skillFact('alpha', 'pi-cli', true), skillFact('beta', 'pi-cli', true), skillFact('draft', 'claude-cli', false), skillFact('synced-one', 'claude-cli', true)],
    skillsLibrary: { alpha: { applied: { 'pi-cli': 'h1' } }, beta: { applied: { 'pi-cli': 'h1' } }, 'synced-one': { applied: { 'claude-cli': 'h1' } } },
    mcp: [mcpFact('docs', 'pi-cli')],
    pluginItems: [
      { tool: 'claude-cli', plugin: 'kit-a', marketName: 'team', source: 'team/m', items: [{ kind: 'skill', name: 'p1', description: '' }] },
      { tool: 'claude-cli', plugin: 'kit-b', marketName: 'team', source: 'team/m', items: [] },
      { tool: 'copilot-cli', plugin: 'kit-a', marketName: 'team', source: 'team/m', items: [] },
    ],
  });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  const rowIn = (card: FakeNode, label: string) => findAll(card, el => el.classList.contains('harness-count')).find(row => textOf(row.children[0]) === label)!;
  const claude = findById(rendered, 'harness-card-claude-cli')!;
  const claudePlugins = rowIn(claude, 'Plugins');
  const claudePluginsVal = findNode(claudePlugins, el => el.classList.contains('harness-count-value'))!;
  assert.equal(textOf(claudePluginsVal), '2');
  assert.equal(claudePluginsVal.attrs['aria-description'], '2 installed plugins');
  assert.equal(textOf(findNode(claudePlugins, el => el.classList.contains('harness-count-note'))), '');

  const claudeSkills = rowIn(claude, 'Skills');
  const claudeSkillsVal = findNode(claudeSkills, el => el.classList.contains('harness-count-value'))!;
  assert.equal(textOf(claudeSkillsVal), '3');
  assert.equal(claudeSkillsVal.attrs['aria-description'], undefined);
  const claudeSkillParts = findAll(claudeSkills, el => el.classList.contains('harness-count-part')).map(textOf);
  assert.deepEqual(claudeSkillParts, ['1 synced', '1 not synced', '1 from plugins']);

  const copilotPluginsVal = findNode(rowIn(findById(rendered, 'harness-card-copilot-cli')!, 'Plugins'), el => el.classList.contains('harness-count-value'))!;
  assert.equal(copilotPluginsVal.attrs['aria-description'], '1 installed plugin');

  const pi = findById(rendered, 'harness-card-pi-cli')!;
  const piSkillsVal = findNode(rowIn(pi, 'Skills'), el => el.classList.contains('harness-count-value'))!;
  assert.equal(textOf(piSkillsVal), '2');
  assert.equal(piSkillsVal.attrs['aria-description'], '2 skills');
  const piMcpVal = findNode(rowIn(pi, 'MCP servers'), el => el.classList.contains('harness-count-value'))!;
  assert.equal(textOf(piMcpVal), '1');
  assert.equal(piMcpVal.attrs['aria-description'], '1 MCP server');
});

test('wrapper ids stay distinct from the managed heading id, Manage shares the footer with path, and Cowork, unread, desktop-only and folder-only meanings stay available', () => {
  app.home = makeHome({
    managed: ['claude-cli', 'pi-cli'],
    leftOut: ['copilot-cli'],
    missing: ['codex-cli'],
    pluginRecordsUnread: ['claude-cli'],
    snapshots: [
      { harness: 'claude-cli', root: '/home/.claude', discovery: 'found', detection: 'App only', probe: { detail: '' }, app: { name: 'Claude desktop', version: '4.16336.0', carries: 'Code tab', carriedVersion: '2.1.317' }, skills: [], issues: [] },
      { harness: 'pi-cli', root: '/home/.pi/agent', discovery: 'found', detection: 'App only', probe: { detail: '' }, app: { name: 'pi-gui (third-party)', version: '0.4.0' }, skills: [], issues: [] },
      { harness: 'copilot-cli', root: '/home/.copilot', discovery: 'found', detection: 'Installed', probe: { version: '1.0.114', detail: '' }, skills: [], issues: [] },
      { harness: 'codex-cli', root: '/home/.codex', discovery: 'found', detection: 'Config found but app not detected', probe: { detail: '' }, skills: [], issues: [] },
    ],
  });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  const claudeCard = findById(rendered, 'harness-card-claude-cli')!;
  const claudeHead = findById(rendered, 'harness-claude-cli')!;
  assert.equal(claudeCard.tag, 'div');
  assert.equal(claudeHead.tag, 'button');
  assert.equal(textOf(claudeCard).includes('Cowork—uses the plugins in your Claude account'), true);
  assert.equal(textOf(claudeCard).includes('Plugins?its record couldn’t be read'), true);
  const claudeFoot = findNode(claudeCard, el => el.classList.contains('harness-card-foot'))!;
  assert.ok(findNode(claudeFoot, el => el.classList.contains('harness-manage')));
  const claudePath = findNode(claudeFoot, el => el.classList.contains('harness-card-path'))!;
  assert.equal(textOf(findNode(claudePath, el => el.classList.contains('middle-tail'))), '/.claude');

  const piCard = findById(rendered, 'harness-card-pi-cli')!;
  assert.equal(textOf(piCard).includes('pi-gui (third-party) 0.4.0 · no CLI found'), true);

  const copilotCard = findById(rendered, 'harness-card-copilot-cli')!;
  assert.equal(copilotCard.classList.contains('harness-card-out'), true);
  assert.equal(findById(rendered, 'harness-copilot-cli'), undefined);
  assert.equal(findById(rendered, 'harness-copilot-cli-instructions'), undefined);
  assert.equal(textOf(findNode(copilotCard, el => el.classList.contains('harness-card-next'))), 'Left out');
  assert.equal(textOf(findById(copilotCard, 'manage-copilot-cli-info-card')),
    'Central Knot doesn’t read or write Copilot CLI while it’s left out, so its copies and every item stay as they are. Its switch asks before managing it again.');
  const copilotFoot = findNode(copilotCard, el => el.classList.contains('harness-card-foot'))!;
  assert.ok(findNode(copilotFoot, el => el.classList.contains('harness-manage')));
  assert.ok(findNode(copilotFoot, el => el.classList.contains('harness-card-path')));

  const codexCard = findById(rendered, 'harness-card-codex-cli')!;
  assert.equal(codexCard.classList.contains('harness-card-missing'), true);
  assert.equal(findById(rendered, 'harness-codex-cli'), undefined);
  assert.equal(findById(rendered, 'harness-codex-cli-instructions'), undefined);
  assert.equal(textOf(codexCard).includes('Not found · only its folder is here'), true);
  assert.equal(textOf(codexCard).includes('Install Codex, then Refresh.'), true);
});
