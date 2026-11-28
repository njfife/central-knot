// Plugin page unit tests (pluginpage.ts, pluginparts.ts): box limit links, In each tool row order,
// tool-count grid attribute, Uninstall… link look, Can’t be turned off here line tooltip, catalog componentsOf,
// shut fold headings, and formatted MCP server JSON entries.
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
// Match `.plugin-outcome-row[data-tools~="<tool>"]` against the currently rendered plugin page.
(globalThis.document as unknown as { querySelector: (selector: string) => FakeNode | null }).querySelector = (selector: string) => {
  const match = /^\.plugin-outcome-row\[data-tools~="([^"]+)"\]$/.exec(selector);
  if (!match || !renderedRoot) return null;
  const tool = match[1]!;
  return findNode(renderedRoot, el => el.className.split(/\s+/).includes('plugin-outcome-row') && (el.attrs['data-tools'] ?? '').split(/\s+/).includes(tool)) ?? null;
};

const { state } = await import('../src/app.ts');
const { market, resetMarket } = await import('../src/pluginstate.ts');
const { afterPluginPageDrawn, pluginPage } = await import('../src/pluginpage.ts');
const { FROM_DIRECTORY, toolNow } = await import('../src/pluginstatus.ts');
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

test('A tool’s limit note is a control that opens In each tool at that tool, and tools with limits come first in tool order', () => {
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
  const view = { ...base, marketplaces: [switched] };
  const page = renderPage(view, switched);

  // Opened order in In each tool: tools with limits first (Copilot CLI, Codex), tools without limits after (Claude Code).
  const rowTools = findAll(page, n => n.className.split(/\s+/).includes('plugin-outcome-row'))
    .map(row => textOf(findNode(row, el => el.tag === 'strong')));
  assert.deepEqual(rowTools, ['Copilot CLI', 'Codex', 'Claude Code']);

  // Codex's limit note is a button; clicking it opens #plugin-outcomes and scrolls Codex's row into sight.
  const limitBtn = findById(page, 'plimit-0-helper-codex-cli')!;
  assert.ok(limitBtn, 'Codex limit note is a button control');
  assert.equal(limitBtn.tag, 'button');
  assert.equal(textOf(limitBtn), 'Commands limited +2');

  const details = findById(page, 'plugin-outcomes') as FakeNode & { open?: boolean };
  const codexRow = findNode(page, el => el.className.split(/\s+/).includes('plugin-outcome-row') && (el.attrs['data-tools'] ?? '').split(/\s+/).includes('codex-cli'))!;
  assert.ok(codexRow, 'Codex row carries data-tools="codex-cli"');
  let scrolled: unknown;
  codexRow.scrollIntoView = ((opts?: unknown) => { scrolled = opts ?? true; }) as () => void;

  // Mouse click opens the fold and scrolls without forcing focus onto the row.
  limitBtn.onclick!({ detail: 1 });
  assert.equal(details.open, true);
  assert.ok(scrolled, 'scrollIntoView called on Codex outcome row');
  assert.equal(codexRow.focused, 0);

  // Keyboard activation also moves focus to the tool's outcome row.
  limitBtn.onclick!({ detail: 0 });
  assert.equal(codexRow.focused, 1);

  // Subsequent redraw keeps In each tool open.
  const redrawn = renderPage(view, switched);
  assert.equal(findById(redrawn, 'plugin-outcomes')!.attrs.open, '');
});

test('Your tools sets --tool-count and data-tools for 1 and 2 tools so boxes spread across the panel width', () => {
  for (const tools of [['claude-cli'] as HarnessId[], ['claude-cli', 'codex-cli'] as HarnessId[]]) {
    setup(tools);
    const entry: MarketplaceView = {
      source: '/markets/team', origins: ['central-knot'], name: 'team', kind: 'folder', sourceLabel: 'Folder: team',
      plugins: [{ name: 'plain', version: '1.0.0', description: 'Plain', folder: 'plugins/plain' }],
      states: { plain: {} },
    };
    const setProps: Record<string, string> = {};
    const origCreate = globalThis.document.createElement;
    (globalThis.document as unknown as { createElement: (tag: string) => FakeNode }).createElement = (tag: string) => {
      const node = origCreate(tag) as unknown as FakeNode;
      node.style = { setProperty(k: string, v: string) { setProps[`${node.className}:${k}`] = v; } };
      return node;
    };
    try {
      const page = renderPage(baseView(tools, entry), entry);
      const rows = findNode(page, el => el.className.split(/\s+/).includes('plugin-tool-rows'))!;
      assert.equal(rows.dataset.tools, String(tools.length));
      assert.equal(setProps['plugin-tool-rows:--tool-count'], String(tools.length));
    } finally {
      (globalThis.document as unknown as { createElement: typeof origCreate }).createElement = origCreate;
    }
  }
});

test('Uninstall… uses the link variant, and Can’t be turned off here puts the box’s reason on the line’s hover', () => {
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
  const view = { ...base, marketplaces: [switched] };
  const page = renderPage(view, switched);

  // Codex's Uninstall… is a link button (not ghost).
  const uninstall = findById(page, 'puninstall-0-both-codex-cli')!;
  assert.ok(uninstall, 'Uninstall… button present for Codex');
  assert.equal(uninstall.classList.contains('link'), true);
  assert.equal(uninstall.classList.contains('ghost'), false);

  // Claude Code's Anthropic Directory copy shows "Can’t be turned off here" with FROM_DIRECTORY on its title.
  const claudeBox = findNode(page, el => el.className.split(/\s+/).includes('plugin-tool') && el.attrs['data-tool'] === 'claude-cli')!;
  const stateLine = findNode(claudeBox, el => el.className.split(/\s+/).includes('plugin-tool-state'))!;
  assert.equal(textOf(stateLine), 'Can’t be turned off here');
  assert.equal(stateLine.attrs.title, FROM_DIRECTORY);
});
