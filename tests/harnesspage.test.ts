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
      joining: {},
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
  agentsTools,
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
  agentsTools?: HarnessId[];
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
      present, managed, leftOut, joining: {}, writes: {}, caughtUp: [], arrived: [],
      access: allowed ? { allowed: true } : { allowed: false, reason: 'Preview only' },
      gate: { state: 'ready' },
    },
    skills: lib(present, skills, [], skillsLibrary),
    mcp: lib(present, mcp, mcpUnread),
    agents: lib(agentsTools ?? present.filter(tool => tool !== 'antigravity-cli')),
    pluginItems,
    pluginRecordsUnread,
    profiles: { profiles: [] },
    otherApps: [],
  } as unknown as HomeView;
}

test('locked home keeps every Manage switch named for its tool with lock reason and no card, line or dangling description', () => {
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
    assert.equal(findById(rendered, `manage-${tool}-line`), undefined);
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

test('capability reasons live on a keyboard-accessible dash button with no inline prose', () => {
  app.home = makeHome({ managed: ['pi-cli', 'antigravity-cli'] });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  const antigravity = findById(rendered, 'harness-card-antigravity-cli')!;
  const agentsRow = findAll(antigravity, el => el.classList.contains('harness-count')).find(row => textOf(row.children[0]) === 'Agents')!;
  const agentsDash = findById(agentsRow, 'harness-antigravity-cli-agents-reason')!;
  const agentsCard = findById(agentsRow, 'harness-antigravity-cli-agents-reason-card')!;
  assert.equal(agentsDash.tag, 'button');
  assert.equal(textOf(agentsDash), '—');
  assert.equal(agentsDash.attrs['aria-describedby'], 'harness-antigravity-cli-agents-reason-card');
  assert.match(agentsDash.attrs['aria-label'] ?? '', /Antigravity Agents/);
  assert.equal(agentsCard.attrs.role, 'tooltip');
  assert.equal(agentsCard.attrs.popover, 'manual');
  assert.equal(textOf(agentsCard), 'Agents aren’t handled for Antigravity');
  assert.equal(textOf(findNode(agentsRow, el => el.classList.contains('harness-count-note'))), '');

  const pi = findById(rendered, 'harness-card-pi-cli')!;
  const pluginsRow = findAll(pi, el => el.classList.contains('harness-count')).find(row => textOf(row.children[0]) === 'Plugins')!;
  const pluginsDash = findById(pluginsRow, 'harness-pi-cli-plugins-reason')!;
  const pluginsCard = findById(pluginsRow, 'harness-pi-cli-plugins-reason-card')!;
  assert.equal(pluginsDash.tag, 'button');
  assert.equal(textOf(pluginsDash), '—');
  assert.equal(pluginsDash.attrs['aria-describedby'], 'harness-pi-cli-plugins-reason-card');
  assert.equal(textOf(pluginsCard), 'Pi takes a plugin’s items, not the plugin');
  assert.equal(textOf(findNode(pluginsRow, el => el.classList.contains('harness-count-note'))), '');
});

test('plugin count hides installed, bare counts carry accessible descriptions, and filenames span value and note tracks', () => {
  const skillFact = (key: string, tool: HarnessId, on: boolean) => ({
    key, name: key, description: '', on, except: [], copies: { [tool]: { contentId: 'h1', directory: `/home/${key}` } },
  });
  const mcpFact = (key: string, tool: HarnessId) => ({
    key, name: key, description: '', on: true, except: [], copies: { [tool]: { contentId: 'h2', directory: `/home/${key}` } },
  });
  app.home = makeHome({
    managed: ['claude-cli', 'copilot-cli', 'pi-cli'],
    skills: [skillFact('alpha', 'pi-cli', true), skillFact('beta', 'pi-cli', true), skillFact('draft', 'claude-cli', false)],
    skillsLibrary: { alpha: { applied: { 'pi-cli': 'h1' } }, beta: { applied: { 'pi-cli': 'h1' } } },
    mcp: [mcpFact('docs', 'pi-cli')],
    pluginItems: [
      { tool: 'claude-cli', plugin: 'kit-a', marketName: 'team', source: 'team/m', items: [] },
      { tool: 'claude-cli', plugin: 'kit-b', marketName: 'team', source: 'team/m', items: [] },
      { tool: 'copilot-cli', plugin: 'kit-a', marketName: 'team', source: 'team/m', items: [] },
    ],
  });
  Object.assign(app, {
    page: 'harnesses', harness: undefined, busy: undefined,
    instructions: {
      state: 'ready', gen: 0,
      data: [
        { tool: 'claude-cli', path: '/home/.claude/CLAUDE.md', exists: true, text: 'Be brief.\n' },
        { tool: 'copilot-cli', path: '/home/.copilot/copilot-instructions.md', exists: true, text: 'Rules.\n' },
        { tool: 'pi-cli', path: '/home/.pi/agent/AGENTS.md', exists: false, text: '' },
      ],
    },
  });
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
  assert.equal(textOf(claudeSkillsVal), '1');
  assert.equal(claudeSkillsVal.attrs['aria-description'], undefined);
  assert.equal(textOf(findNode(claudeSkills, el => el.classList.contains('harness-count-note'))), '1 not synced');

  const copilot = findById(rendered, 'harness-card-copilot-cli')!;
  const copilotPluginsVal = findNode(rowIn(copilot, 'Plugins'), el => el.classList.contains('harness-count-value'))!;
  assert.equal(copilotPluginsVal.attrs['aria-description'], '1 installed plugin');
  const copilotIns = rowIn(copilot, 'Instructions');
  assert.equal(findNode(copilotIns, el => el.classList.contains('harness-count-value')), undefined);
  const copilotInsNote = findNode(copilotIns, el => el.classList.contains('harness-count-note'))!;
  assert.equal(copilotInsNote.classList.contains('harness-count-span'), true);
  assert.equal(textOf(copilotInsNote), 'copilot-instructions.md');

  const pi = findById(rendered, 'harness-card-pi-cli')!;
  const piSkillsVal = findNode(rowIn(pi, 'Skills'), el => el.classList.contains('harness-count-value'))!;
  assert.equal(textOf(piSkillsVal), '2');
  assert.equal(piSkillsVal.attrs['aria-description'], '2 synced skills');
  const piMcpVal = findNode(rowIn(pi, 'MCP servers'), el => el.classList.contains('harness-count-value'))!;
  assert.equal(textOf(piMcpVal), '1');
  assert.equal(piMcpVal.attrs['aria-description'], '1 synced MCP server');
  const piIns = rowIn(pi, 'Instructions');
  assert.equal(findNode(piIns, el => el.classList.contains('harness-count-value')), undefined);
  assert.equal(findNode(piIns, el => el.classList.contains('harness-count-span'))?.textContent, 'no file yet');
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
  assert.ok(findNode(claudeFoot, el => el.classList.contains('harness-card-path')));

  const piCard = findById(rendered, 'harness-card-pi-cli')!;
  assert.equal(textOf(piCard).includes('pi-gui (third-party) 0.4.0 · no CLI found'), true);

  const copilotCard = findById(rendered, 'harness-card-copilot-cli')!;
  assert.equal(copilotCard.classList.contains('harness-card-out'), true);
  assert.equal(findById(rendered, 'harness-copilot-cli'), undefined);
  const copilotFoot = findNode(copilotCard, el => el.classList.contains('harness-card-foot'))!;
  assert.ok(findNode(copilotFoot, el => el.classList.contains('harness-manage')));
  assert.ok(findNode(copilotFoot, el => el.classList.contains('harness-card-path')));

  const codexCard = findById(rendered, 'harness-card-codex-cli')!;
  assert.equal(codexCard.classList.contains('harness-card-missing'), true);
  assert.equal(findById(rendered, 'harness-codex-cli'), undefined);
  assert.equal(textOf(codexCard).includes('Not found · only its folder is here'), true);
  assert.equal(textOf(codexCard).includes('Install Codex, then Refresh.'), true);
});
