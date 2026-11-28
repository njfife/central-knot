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
  allowed = true,
  mcpUnread = [] as HarnessId[],
  pluginItems = [] as unknown[],
}: {
  managed?: HarnessId[];
  leftOut?: HarnessId[];
  allowed?: boolean;
  mcpUnread?: HarnessId[];
  pluginItems?: unknown[];
} = {}): HomeView {
  const present = [...managed, ...leftOut];
  const emptyLib = (tools: HarnessId[], unread: HarnessId[] = []) => ({
    tools, items: [], notices: [], problems: [], unread, access: { allowed }, gate: { state: 'ready' }, library: {},
  });
  return {
    home: '/home',
    mode: 'actual',
    label: 'This computer',
    syncOn: true,
    snapshots: present.map(harness => ({
      harness, root: `/home/.${harness}`, discovery: 'found', detection: 'Installed', probe: { version: '1.0.0', detail: '' }, skills: [], issues: [],
    })),
    sync: {
      present, managed, leftOut, writes: {}, caughtUp: [], arrived: [],
      access: allowed ? { allowed: true } : { allowed: false, reason: 'Preview only' },
      gate: { state: 'ready' },
    },
    skills: emptyLib(present),
    mcp: emptyLib(present, mcpUnread),
    agents: emptyLib(present),
    pluginItems,
    pluginRecordsUnread: [],
    profiles: { profiles: [] },
    otherApps: [],
  } as unknown as HomeView;
}

test('locked home keeps every Manage switch named for its tool with lock reason and no card, question or dangling description', () => {
  app.home = makeHome({ managed: ALL_SIX.slice(1), leftOut: ['claude-cli'], allowed: false });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  assert.equal(findById(rendered, 'manage-info'), undefined);
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
    assert.equal(onSw.attrs['aria-label'], 'shared-tool in Claude Code');
    assert.equal(onSw.attrs.title, 'Click to turn shared-tool off in Claude Code, kept installed: it stays off until you turn it on again. Undo turns it on again.');
    assert.equal(onSw.attrs['aria-description'], onSw.attrs.title);
    const offSw = findById(rendered, 'harness-plugin-switch-team-one-kept-off-tool')!;
    assert.equal(offSw.attrs.title, 'Click to turn kept-off-tool on in Claude Code alone. Undo turns it off again.');
    assert.equal(offSw.attrs['aria-description'], offSw.attrs.title);
  } finally { resetMarket(); }
});

test('Plugins tab shows stays, unknown and stuck/held state lines with the full reason on hover', () => {
  // Anthropic Directory installs are stuck (cantUninstall -> FROM_DIRECTORY): on shows 'Can’t be taken out here', off shows 'Off, kept installed · can’t be changed here'.
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
    assert.equal(textOf(stuckOnState), 'Can’t be taken out here');
    assert.match(stuckOnState.attrs.title ?? '', /Anthropic Directory.*\/plugin/, 'held row state hover explains why it cannot be taken out');
    assert.match(stuckOnRow.attrs.title ?? '', /Anthropic Directory.*\/plugin/, 'held row hover carries the reason');

    const stuckOffRow = rowOf('harness-plugin-dir-off-dir-off-tool');
    const stuckOffState = findNode(stuckOffRow, el => el.className.split(/\s+/).includes('harness-plugin-state'))!;
    assert.equal(textOf(stuckOffState), 'Off, kept installed · can’t be changed here');
    assert.match(stuckOffState.attrs.title ?? '', /Off in Claude Code/);
    assert.match(stuckOffState.attrs.title ?? '', /Anthropic Directory.*\/plugin/, 'stuck kept-off hover explains why it cannot be changed');
  } finally { resetMarket(); }
});

test('Plugins tab shows marketplace inline for ambiguous titles only, and names the marketplace in their Uninstall… question', () => {
  const { draw } = pluginsTabFixture();
  try {
    const { rowOf } = draw();
    assert.equal(textOf(findNode(rowOf('harness-plugin-team-one-shared-tool'), el => el.className.split(/\s+/).includes('harness-plugin-market'))), ' · team-one');
    assert.equal(textOf(findNode(rowOf('harness-plugin-team-two-shared-tool'), el => el.className.split(/\s+/).includes('harness-plugin-market'))), ' · team-two');
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
