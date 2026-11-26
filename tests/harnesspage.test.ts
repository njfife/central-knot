// Harnesses card heading button (harnesspage.ts summaryCard, goHarness): the card body is a div, the heading is the
// button with the tool's accessible label, keyboard Back focuses it, and mouse Back leaves focus alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
installDom({}, { userAgent: 'Macintosh', byId: id => findById(rendered, id) ?? null });

const { setRenderer, state: app } = await import('../src/app.ts');
const { goHarness, harnessesPage } = await import('../src/harnesspage.ts');

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

function makeSixToolHome({
  managed = ALL_SIX,
  leftOut = [] as HarnessId[],
  allowed = true,
  syncOn = true,
  mode = 'actual' as 'actual' | 'fixture' | 'custom',
  withProfile = false,
}: {
  managed?: HarnessId[];
  leftOut?: HarnessId[];
  allowed?: boolean;
  syncOn?: boolean;
  mode?: 'actual' | 'fixture' | 'custom';
  withProfile?: boolean;
} = {}): HomeView {
  const emptyLib = (tools: HarnessId[], items: unknown[] = [], unread: HarnessId[] = []) => ({
    tools, items, notices: [], problems: [], unread, access: { allowed }, gate: { state: 'ready' }, library: {},
  });
  const skillsLib = emptyLib(ALL_SIX, [
    // 2 skills in Claude (both synced = all synced), 3 in OpenCode (none synced = 3 not synced), 0 in Pi (known zero).
    { key: 'a', name: 'a', on: true, except: ['opencode-cli'], copies: { 'claude-cli': { hash: '1' }, 'opencode-cli': { hash: '1' } }, anotherWay: {} },
    { key: 'b', name: 'b', on: true, except: ['opencode-cli'], copies: { 'claude-cli': { hash: '2' }, 'opencode-cli': { hash: '2' } }, anotherWay: {} },
    { key: 'c', name: 'c', on: false, except: [], copies: { 'opencode-cli': { hash: '3' } }, anotherWay: {} },
  ]);
  (skillsLib as { library: Record<string, unknown> }).library = {
    a: { applied: { 'claude-cli': '1' } },
    b: { applied: { 'claude-cli': '2' } },
  };
  // Codex MCP unread (unknown, must stay), Antigravity has no agents (unsupported, must stay).
  const mcpLib = emptyLib(ALL_SIX, [], ['codex-cli']);
  const agentsLib = emptyLib(['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'], []);
  return {
    home: '/home',
    mode,
    label: 'This computer',
    syncOn,
    snapshots: [
      { harness: 'claude-cli', root: '/home/.claude', discovery: 'found', detection: 'Installed', probe: { version: '2.1.330', detail: '' }, skills: [], issues: ['Read problem 1'] },
      { harness: 'copilot-cli', root: '/home/.copilot', discovery: 'found', detection: 'Installed', probe: { version: '', detail: '' }, skills: [], issues: [] },
      { harness: 'codex-cli', root: '/home/.codex', discovery: 'found', detection: 'Installed', probe: { version: '0.171.0', detail: '' }, skills: [], issues: [] },
      { harness: 'pi-cli', root: '/home/.pi/agent', discovery: 'found', detection: 'App only', app: { name: 'pi-gui (third-party)', version: '0.4.0' }, probe: { detail: '' }, skills: [], issues: [] },
      { harness: 'opencode-cli', root: '/home/.config/opencode', discovery: 'found', detection: 'Installed', probe: { version: '1.19.5', detail: '' }, app: { name: 'OpenCode desktop', version: '2.2.5' }, skills: [], issues: [] },
      { harness: 'antigravity-cli', root: '/home/.gemini/config', discovery: 'found', detection: 'Installed', probe: { version: '1.5.14', detail: '' }, skills: [], issues: [] },
    ],
    sync: {
      present: ALL_SIX,
      managed,
      leftOut,
      joining: { 'claude-cli': { written: 1, kept: 0, removed: 0, found: 1, takenIn: 0 } },
      writes: {},
      caughtUp: [],
      arrived: [],
      access: allowed ? { allowed: true } : { allowed: false, reason: 'Preview only' },
      gate: { state: 'ready' },
    },
    skills: skillsLib,
    mcp: mcpLib,
    agents: agentsLib,
    pluginItems: [],
    pluginRecordsUnread: ['copilot-cli'],
    profiles: { profiles: withProfile ? [{ id: 'p1', name: 'Everyday', items: [] }] : [] },
    otherApps: [],
  } as unknown as HomeView;
}

test('first managed card after an unmanaged one carries the one Managed (?) card; six switches keep tool names locked or not with no dangling descriptions', () => {
  app.home = makeSixToolHome({ managed: ALL_SIX.slice(1), leftOut: ['claude-cli'], syncOn: false });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;

  // Exactly one Managed (?) mark, on Copilot CLI (first managed card after unmanaged Claude Code).
  const marks = findAll(rendered, el => el.className.split(/\s+/).includes('info-mark'));
  assert.deepEqual(marks.map(m => m.attrs.id), ['manage-info']);
  assert.equal(textOf(findById(rendered, 'manage-info-card')), 'Off leaves Copilot CLI as it is; nothing is written there until it is on again.');
  const copilotHead = findNode(rendered, el => 'data-info-block' in el.attrs && !!findById(el, 'manage-info'));
  assert.ok(copilotHead && findById(copilotHead, 'manage-copilot-cli'), 'Managed (?) sits in Copilot CLI’s data-info-block');

  // Unmanaged Claude Code keeps true rejoin consequences + SYNC_OFF, and drops "Its instruction file is back on Instructions."
  const claudeLine = textOf(findById(rendered, 'manage-claude-cli-line'));
  assert.match(claudeLine, /^On: Central Knot’s version written there for 1 item; 1 found item shown under Found\. With Automatic sync off, Sync once brings it into line; a click on an item brings that item\.$/);
  assert.doesNotMatch(claudeLine, /Its instruction file is back on Instructions\./);

  // Managed cards have no #manage-*-line and no dangling aria-describedby.
  for (const tool of ALL_SIX.slice(1)) {
    assert.equal(findById(rendered, `manage-${tool}-line`), undefined, `${tool} has no standing manage line`);
  }
  const switches = findAll(rendered, el => el.attrs.role === 'switch');
  assert.equal(switches.length, 6);
  for (const tool of ALL_SIX) {
    const sw: FakeNode = findById(rendered, `manage-${tool}`)!;
    assert.ok(sw.attrs['aria-label']?.includes(`Manage ${SIX_NAMES[tool]}`), `${tool} switch named for its tool`);
    if (sw.attrs['aria-describedby']) {
      assert.ok(findById(rendered, sw.attrs['aria-describedby']), `${tool} aria-describedby target exists`);
    }
  }

  // Locked home: every switch STILL keeps its tool's accessible name, has lock reason in title/aria-description, and zero dangling descriptions.
  app.home = makeSixToolHome({ managed: ALL_SIX.slice(1), leftOut: ['claude-cli'], allowed: false });
  rendered = harnessesPage() as unknown as FakeNode;
  for (const tool of ALL_SIX) {
    const sw: FakeNode = findById(rendered, `manage-${tool}`)!;
    assert.ok(sw.attrs['aria-label']?.includes(`Manage ${SIX_NAMES[tool]}`), `locked ${tool} switch keeps tool name`);
    assert.match(sw.attrs['aria-description'] ?? '', /Preview only/);
    assert.equal(sw.attrs['aria-describedby'], undefined, `locked ${tool} switch has no dangling aria-describedby`);
  }
  assert.match(textOf(findNode(rendered, el => el.className.split(/\s+/).includes('tools-note'))), /^Preview only:/);
});

test('Harnesses cards drop introductions, Installed · with versions, all synced, none yet, none installed and known zeros, while keeping counts, unknowns, unsupported titles and notices', () => {
  app.home = makeSixToolHome({ managed: ALL_SIX, leftOut: [] });
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  rendered = harnessesPage() as unknown as FakeNode;
  const pageText = textOf(rendered);

  // Introductions gone; no empty .tools-note on actual unlocked home without profiles.
  assert.doesNotMatch(pageText, /Each AI coding tool and what it has\./);
  assert.doesNotMatch(pageText, /Central Knot manages none of your tools here\./);
  assert.equal(findNode(rendered, el => el.className.split(/\s+/).includes('tools-note')), undefined);

  // Detection lines: drop "Installed ·" only when a version follows; keep bare "Installed" and desktop-only detection.
  assert.doesNotMatch(pageText, /Installed ·/);
  assert.match(pageText, /2\.1\.330/);
  assert.match(pageText, /1\.19\.5; OpenCode desktop 2\.2\.5/);
  assert.match(pageText, /1\.5\.14/);
  assert.match(pageText, /pi-gui \(third-party\) 0\.4\.0 · no CLI found/);
  const copilotCard = findNode(rendered, el => el.className.split(/\s+/).includes('harness-card') && !!findById(el, 'harness-copilot-cli'))!;
  assert.equal(textOf(findNode(copilotCard, el => el.className.split(/\s+/).includes('harness-card-status'))), 'Installed');

  // Counts: drop all synced / none yet / none installed / known zeros; replace none synced with actual unsynced count; keep unknowns, unsupported titles and attention links.
  assert.doesNotMatch(pageText, /all synced|none yet|none installed|none synced/);
  const claudeCard = findNode(rendered, el => el.className.split(/\s+/).includes('harness-card') && !!findById(el, 'harness-claude-cli'))!;
  const claudeRows = findAll(claudeCard, el => el.className.split(/\s+/).includes('harness-count')).map(r => textOf(r));
  assert.ok(claudeRows.some(r => r === 'Skills2'), `all-synced skills drops "all synced": ${claudeRows.join(' | ')}`);
  assert.equal(claudeRows.some(r => r.startsWith('MCP servers')), false, 'known-zero MCP row omitted');
  assert.equal(claudeRows.some(r => r.startsWith('Agents')), false, 'known-zero Agents row omitted');
  assert.equal(claudeRows.some(r => r.startsWith('Plugins')), false, 'known-zero Plugins row omitted');
  assert.ok(findById(claudeCard, 'harness-claude-cli-problems'), 'attention link kept');

  const openCodeCard = findNode(rendered, el => el.className.split(/\s+/).includes('harness-card') && !!findById(el, 'harness-opencode-cli'))!;
  assert.match(textOf(openCodeCard), /Skills33 not synced/);

  const codexCard = findNode(rendered, el => el.className.split(/\s+/).includes('harness-card') && !!findById(el, 'harness-codex-cli'))!;
  assert.match(textOf(codexCard), /MCP servers\?couldn’t be read/);
  assert.match(textOf(copilotCard), /Plugins\?its record couldn’t be read/);

  const antigravityCard = findNode(rendered, el => el.className.split(/\s+/).includes('harness-card') && !!findById(el, 'harness-antigravity-cli'))!;
  assert.match(textOf(antigravityCard), /Agents—Agents aren’t handled for Antigravity/);
  assert.match(textOf(antigravityCard), /Plugins—Antigravity takes a plugin’s items, not the plugin/);

  // Practice notice and profile action stay with no leading space.
  app.home = makeSixToolHome({ managed: ALL_SIX, mode: 'fixture', withProfile: true });
  rendered = harnessesPage() as unknown as FakeNode;
  const note = textOf(findNode(rendered, el => el.className.split(/\s+/).includes('tools-note')));
  assert.match(note, /^Practice copy: installed apps aren’t checked; .* shows their versions\. Profile in use: .+\.$/);

  // Zero managed tools: unmanaged introduction is gone too.
  app.home = makeSixToolHome({ managed: [], leftOut: ALL_SIX });
  rendered = harnessesPage() as unknown as FakeNode;
  assert.doesNotMatch(textOf(rendered), /Central Knot manages none of your tools here\./);
  assert.equal(findById(rendered, 'manage-info'), undefined);
});
