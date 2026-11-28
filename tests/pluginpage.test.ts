// Plugin page pure-rule unit tests (pluginpage.ts): catalog componentsOf precedence, shut fold summary,
// formatted MCP JSON entry, In each tool limits-first order + severity-led limit note, and box hover + (?) reason rules.
// Interactive presses, scrolling, grid track widths, Uninstall… sizing and popover opening are covered in scripts/e2e.mjs pluginPageSaysLessFlow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';
import type { HarnessId, MarketplaceView, PluginDetail, PluginsView } from '../src/types.ts';

let renderedRoot: FakeNode | undefined;
const findAll = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) findAll(child, match, out);
  return out;
};

installDom({}, {
  userAgent: 'Linux',
  byId: id => (renderedRoot ? findById(renderedRoot, id) : undefined),
});

const { state } = await import('../src/app.ts');
const { market, resetMarket } = await import('../src/pluginstate.ts');
const { afterPluginPageDrawn, pluginPage } = await import('../src/pluginpage.ts');
const { FROM_DIRECTORY, PREVIEW_ONLY, toolNow } = await import('../src/pluginstatus.ts');
const { owedTo } = await import('../src/pluginrecord.ts');

const withSwitches = (view: PluginsView, entry: MarketplaceView, swEntry?: { on: boolean; except: HarnessId[] }): MarketplaceView => ({
  ...entry,
  switches: Object.fromEntries(entry.plugins.map(plugin => [
    plugin.name,
    {
      ...(swEntry ? { entry: swEntry } : {}),
      tools: Object.fromEntries(view.tools.map(tool => [tool, owedTo(swEntry, tool, toolNow(view, entry, plugin.name, tool, undefined, false), view.tools)])),
    },
  ])),
});

const baseHome = (tools: HarnessId[]) => ({
  home: '/tmp/h',
  mode: 'custom' as const,
  sync: { managed: tools, present: tools, gate: { state: 'open' } },
  snapshots: tools.map(harness => ({ harness, detection: 'Installed', probe: { version: '1.0.0' }, root: `/tmp/h/.${harness}`, skills: [], issues: [] })),
  skills: { tools, items: [], notices: [], library: {} },
  mcp: { tools, items: [], notices: [], library: {} },
  agents: { tools, items: [], notices: [], library: {} },
  pluginItems: [],
});

const baseView = (tools: HarnessId[], entry: MarketplaceView): PluginsView => ({
  home: '/tmp/h',
  tools,
  clis: Object.fromEntries(tools.map(tool => [tool, true])),
  canWrite: true,
  desktopOnly: {},
  via: {},
  versions: {},
  suggested: [],
  marketplaces: [entry],
} as unknown as PluginsView);

const renderPage = (view: PluginsView, entry: MarketplaceView, index = 0) => {
  renderedRoot = pluginPage(view, entry, 0, entry.plugins[index]!) as unknown as FakeNode;
  return renderedRoot;
};

function setup(tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli']) {
  resetMarket();
  afterPluginPageDrawn();
  renderedRoot = undefined;
  state.home = baseHome(tools) as unknown as typeof state.home;
}

test('Plugin page reads catalog componentsOf over detail, starts In each tool shut naming limited tools, and formats an MCP server JSON entry', () => {
  setup();
  const hook = { declaredIn: '/markets/team/plugins/catalog-sync/hooks/hooks.json', event: 'SessionStart', at: 0, launch: { shell: 'echo start' } };
  const mcpEntry = JSON.stringify({ url: 'https://tracker.example.test/mcp', headers: { Authorization: 'Bearer keep-as-written-123' } });
  const detail: PluginDetail = {
    skills: [], commands: [], agents: [], instructions: [], onlyInstructions: false,
    hooks: [hook],
    hooksByTool: { 'claude-cli': [hook], 'copilot-cli': [hook], 'codex-cli': [hook] },
    mcpServers: [{ name: 'tracker-api', runs: 'https://tracker.example.test/mcp', transport: 'http', entry: mcpEntry }],
    mcpUsesPluginRoot: false, lspServers: [], bin: false, version: '0.5.0', offered: true,
  };
  market.details.set('/markets/team\u0000catalog-sync', { reading: false, value: detail });
  const entry: MarketplaceView = {
    source: '/markets/team', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: 'Folder: team',
    plugins: [{
      name: 'catalog-sync', version: '0.5.0', description: 'Catalog test', folder: 'plugins/catalog-sync',
      components: {
        skills: 0, commands: 0, agents: 0, hooks: true, mcp: 1, mcpRootVariable: false, bin: false,
        hooksIn: ['claude-cli', 'copilot-cli'], startHooksIn: ['claude-cli', 'copilot-cli'], promptHooksIn: [], sessionTextHooks: ['claude-cli', 'copilot-cli'],
      },
    }],
    states: { 'catalog-sync': { 'copilot-cli': { state: 'installed', version: '0.5.0', path: '/tmp/c' } } },
  };
  const view = baseView(['claude-cli', 'copilot-cli', 'codex-cli'], entry);
  const page = renderPage(view, entry);

  const hookNote = textOf(findAll(page, n => n.className === 'plugin-group-note')[0]);
  assert.equal(hookNote, 'These run when a session starts; what they add is known only when they run. In Codex, none of them adds text.');

  const outcomesFold = findById(page, 'plugin-outcomes')!;
  assert.equal(outcomesFold.attrs.open, undefined);
  assert.equal(textOf(findById(page, 'plugin-outcomes-toggle')), 'In each tool · limits in Copilot CLI and Codex');

  const mcpToggle = findById(page, 'pfile-0-mcp-tracker-api')!;
  assert.equal(mcpToggle.attrs['aria-expanded'], 'false');
  mcpToggle.onclick!({});

  const opened = renderPage(view, entry);
  assert.equal(textOf(findAll(opened, n => n.className === 'content-owner')[0]), 'Entry · Marketplace (0.5.0)');
  assert.equal(textOf(findById(opened, 'pfile-0-mcp-tracker-api-text-0')), [
    '{',
    '  "url": "https://tracker.example.test/mcp",',
    '  "headers": {',
    '    "Authorization": "Bearer keep-as-written-123"',
    '  }',
    '}',
  ].join('\n'));
});

test('In each tool lists tools with limits first in tool order using data-outcome-tools, and a box’s limit note leads with the worst limit', () => {
  setup(['claude-cli', 'copilot-cli', 'codex-cli']);
  const entry: MarketplaceView = {
    source: '/markets/team', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: 'Folder: team',
    plugins: [{
      name: 'helper', version: '1.0.0', description: 'Helper', folder: 'plugins/helper',
      components: {
        skills: 1, commands: 1, agents: 1, hooks: false, mcp: 1, mcpRootVariable: true, bin: false,
        hooksIn: [], startHooksIn: [], promptHooksIn: [], sessionTextHooks: [],
      },
    }],
    states: { helper: {} },
  };
  const base = baseView(['claude-cli', 'copilot-cli', 'codex-cli'], entry);
  const switched = withSwitches(base, entry);
  const page = renderPage({ ...base, marketplaces: [switched] }, switched);

  const rows = findAll(page, n => n.className.split(/\s+/).includes('plugin-outcome-row'));
  assert.deepEqual(rows.map(row => [row.attrs['data-outcome-tools'], textOf(findNode(row, el => el.tag === 'strong'))]),
    [['copilot-cli', 'Copilot CLI'], ['codex-cli', 'Codex'], ['claude-cli', 'Claude Code']]);
  assert.equal(rows.every(row => row.attrs['data-tools'] === undefined), true, 'outcome rows use data-outcome-tools, never data-tools');
  assert.equal(textOf(findById(page, 'plimit-0-helper-codex-cli')), 'MCP servers won’t start +2');
});

test('A box’s hover carries the box’s reason and a (?) only when the line is the reason’s own; other lines keep their own words', () => {
  setup(['claude-cli', 'codex-cli']);
  const entry: MarketplaceView = {
    source: '/markets/team', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: 'Folder: team',
    plugins: [{ name: 'both', version: '1.0.0', description: 'Both', folder: 'plugins/both' }],
    states: {
      both: {
        'claude-cli': { state: 'installed', version: '1.0.0', path: '/tmp/c', directory: 'both@anthropic-plugin-directory' },
        'codex-cli': { state: 'installed', version: '1.0.0', path: '/tmp/x' },
      },
    },
  };
  const base = baseView(['claude-cli', 'codex-cli'], entry);
  const switched = withSwitches(base, entry, { on: true, except: [] });
  const page = renderPage({ ...base, marketplaces: [switched] }, switched);

  // Anthropic Directory copy (box.line set): hover holds FROM_DIRECTORY and a (?) sits beside the line with the same reason.
  const claudeBox = findNode(page, el => el.className.split(/\s+/).includes('plugin-tool') && el.attrs['data-tool'] === 'claude-cli')!;
  const stateLine = findNode(claudeBox, el => el.className.split(/\s+/).includes('plugin-tool-state'))!;
  assert.equal(textOf(stateLine), 'Can’t be turned off here');
  assert.equal(stateLine.attrs.title, FROM_DIRECTORY);
  const whyBtn = findById(claudeBox, 'pwhy-0-both-claude-cli')!;
  assert.ok(whyBtn, '(?) mark sits beside Can’t be turned off here');
  assert.equal(textOf(findById(claudeBox, 'pwhy-0-both-claude-cli-card')), FROM_DIRECTORY);

  // Preview-only home (canWrite: false, box.line undefined): a box's state line keeps its own words on hover, not PREVIEW_ONLY, with no (?).
  setup(['claude-cli', 'codex-cli']);
  const previewEntry: MarketplaceView = {
    source: '/markets/team', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: 'Folder: team',
    plugins: [{ name: 'kept', version: '1.0.0', description: 'Kept', folder: 'plugins/kept' }],
    states: { kept: { 'claude-cli': { state: 'installed', version: '1.0.0', path: '/tmp/c' } } },
  };
  const previewBase = { ...baseView(['claude-cli', 'codex-cli'], previewEntry), canWrite: false };
  const previewSwitched = withSwitches(previewBase, previewEntry, { on: true, except: ['codex-cli'] });
  const previewPage = renderPage({ ...previewBase, marketplaces: [previewSwitched] }, previewSwitched);
  const codexBox = findNode(previewPage, el => el.className.split(/\s+/).includes('plugin-tool') && el.attrs['data-tool'] === 'codex-cli')!;
  const codexState = findNode(codexBox, el => el.className.split(/\s+/).includes('plugin-tool-state'))!;
  assert.equal(textOf(codexState), 'Not installed');
  assert.equal(codexState.attrs.title, 'Not installed in Codex, and kept out of it: nothing puts it there by itself.');
  assert.notEqual(codexState.attrs.title, PREVIEW_ONLY);
  assert.equal(findById(codexBox, 'pwhy-0-kept-codex-cli'), undefined);
});
