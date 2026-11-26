// Harnesses card heading button (harnesspage.ts summaryCard, goHarness) and a tool's Plugins tab version display
// (harnesspage.ts pluginsTab, pluginRow): the card body is a div, the heading is the button with the tool's accessible
// label, keyboard Back focuses it, mouse Back leaves focus alone, and Plugins tab rows show each tool's recorded version.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HomeView, PluginsView } from '../src/types.ts';
import { findById, findNode, installDom, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { userAgent: 'Macintosh', byId: id => findById(rendered, id) ?? null });

const { setRenderer, state: app } = await import('../src/app.ts');
const { goHarness, harnessesPage } = await import('../src/harnesspage.ts');
const { market } = await import('../src/pluginstate.ts');

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

test('a tool’s Plugins tab shows the tool’s installed version, and no version when the tool records none', () => {
  const prevMarket = market.read.data;
  const textOf = (node: unknown): string => (typeof node === 'string' ? node : (node as FakeNode).children.map(textOf).join(''));
  try {
    app.harness = 'claude-cli';
    app.harnessTab = 'plugins';
    market.read.data = {
      home: '/home',
      tools: ['claude-cli'],
      clis: { 'claude-cli': true },
      canWrite: true,
      marketplaces: [{
        source: 'team/plugins',
        origins: ['central-knot'],
        name: 'team-tools',
        kind: 'git',
        sourceLabel: 'GitHub: team/plugins',
        plugins: [
          { name: 'release-helper', description: 'Release notes.', version: '0.5.0' },
          { name: 'unversioned', description: 'No version recorded.', version: '1.0.0' },
        ],
        states: {
          'release-helper': { 'claude-cli': { state: 'installed', path: '/x', version: '0.4.1' } },
          unversioned: { 'claude-cli': { state: 'installed', path: '/y' } },
        },
      }],
    } as PluginsView;
    rendered = harnessesPage() as unknown as FakeNode;
    const rows: FakeNode[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const el = node as FakeNode;
      if (el.className.split(/\s+/).includes('harness-plugin')) rows.push(el);
      for (const child of el.children) walk(child);
    };
    walk(rendered);
    assert.deepEqual(
      rows.map(row => textOf(findNode(row, el => el.tag === 'strong')!)),
      ['release-helper 0.4.1', 'unversioned'],
    );
  } finally {
    market.read.data = prevMarket;
    app.harness = undefined;
    app.harnessTab = 'skills';
  }
});
