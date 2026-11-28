// Library section heading rules (matrix.ts section, foundNote): Off heading stays quiet without a live note
// (rows carry their own tags and Off keeps its count and (?) card), Found wait zero/plural counts,
// and hiding the live wait over pinned mixed rows under Found while Synchronize everything is on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newItem, takeInAnswer, type FoundKey, type LibraryItem, type Plan } from '../src/library.ts';
import type { HarnessId, HomeView, LibraryFacts, ToolCopy } from '../src/types.ts';
import { installDom, textOf, type FakeNode } from './domstub.ts';

installDom({});

await import('../src/settingspage.ts');
const { drawPage, state: app, unpin } = await import('../src/app.ts');
const { pin, rowId } = await import('../src/itemrow.ts');
const { libraryTable, openKind } = await import('../src/matrix.ts');

const OLD_AT = '2026-09-01T00:00:00.000Z';

const makeCopy = (name: string, hash = `h-${name}`): ToolCopy => ({
  hash,
  directory: `/home/.claude/skills/${name}`,
  rootLabel: '~/.claude/skills',
  lines: 4,
  modified: OLD_AT,
  summary: `The ${name} skill.`,
  writable: true,
  folder: name,
});

const makeItem = (key: string, on: boolean): LibraryItem => ({
  ...newItem(key, key),
  on,
  versions: [{ hash: `h-${key}`, at: OLD_AT, from: { how: 'found', harness: 'claude-cli' } }],
});

const makePlan = (overrides: Partial<Plan> = {}): Plan => ({
  orderProved: true,
  keep: [],
  write: [],
  remove: [],
  forget: [],
  current: [],
  ownCopy: [],
  ...overrides,
});

const answersFor = (found: FoundKey): NonNullable<LibraryFacts['takeInAnswers']> => ({
  click: takeInAnswer('click', found),
  rule: takeInAnswer('rule', found),
});

const makeFact = (key: string, overrides: Partial<LibraryFacts> = {}): LibraryFacts => ({
  key,
  name: key,
  description: '',
  copies: {},
  on: false,
  except: [],
  cannot: {},
  edited: [],
  ...overrides,
});

const findAll = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) findAll(child, match, out);
  return out;
};

function readHeading(tree: unknown, which: 'found' | 'off') {
  const head = findAll(tree, el => el.attrs?.['data-section'] === which)[0];
  assert.ok(head, `expected ${which} section heading`);
  const count = findAll(head, el => el.className.includes('ov-section-count'))[0];
  const after = findAll(head, el => el.className.includes('ov-section-after'))[0];
  const roomHidden = !!after && after.className.includes('ov-section-room') && after.attrs['aria-hidden'] === 'true';
  return {
    count: textOf(count),
    liveLine: after && !roomHidden ? textOf(after).replace(/^·/, '') : undefined,
    hasAfter: !!after,
    roomHidden,
    rawText: textOf(head),
  };
}

function makeHome(opts: {
  homePath: string;
  tools?: HarnessId[];
  leftOut?: HarnessId[];
  syncEverything?: boolean;
  skills?: LibraryFacts[];
  library?: Record<string, LibraryItem>;
  pluginItems?: HomeView['pluginItems'];
}): HomeView {
  const tools: HarnessId[] = opts.tools ?? ['claude-cli', 'codex-cli', 'opencode-cli'];
  const emptyKind = { tools, items: [] as LibraryFacts[], library: {} as Record<string, LibraryItem>, access: { allowed: true }, gate: { state: 'ready' as const }, problems: [], notices: [], unread: [] };
  return {
    home: opts.homePath,
    mode: 'actual',
    label: 'Test home',
    syncOn: true,
    sync: {
      managed: tools,
      present: [...tools, ...(opts.leftOut ?? [])],
      leftOut: opts.leftOut ?? [],
      access: { allowed: true },
      gate: { state: 'ready' },
      syncEverything: opts.syncEverything ?? false,
      caughtUp: [],
    },
    skills: { ...emptyKind, items: opts.skills ?? [], library: opts.library ?? {} },
    mcp: emptyKind,
    agents: emptyKind,
    pluginItems: opts.pluginItems ?? [],
    profiles: { profiles: [], plugins: [] },
  } as unknown as HomeView;
}

test('Off heading stays quiet with no live note across plugin-on, pending removal, own copies, other readers, switched-off copies, and left-out tools', () => {
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  const ownTwoTools = makeFact('off-own', {
    copies: { 'codex-cli': makeCopy('off-own', 'h-codex'), 'copilot-cli': makeCopy('off-own', 'h-cp') },
  });
  const owedSkill = makeFact('off-owed', {
    copies: { 'codex-cli': makeCopy('off-owed') },
    plan: makePlan({ remove: ['codex-cli'] }),
  });
  const pluginSkill = makeFact('off-plug', {
    plugin: { 'copilot-cli': { plugin: 'kit', marketplace: 'local-market', name: 'off-plug' } },
  });
  const reader1 = makeFact('off-read-1', {
    loads: { 'codex-cli': { folder: 'off-read-1', name: 'off-read-1', skillFile: '/home/.agents/skills/off-read-1/SKILL.md', in: 'codex-cli', switchedOff: false } },
    anotherWay: { 'codex-cli': 'Codex also reads a copy at …/.agents/skills, which is not Central Knot’s.' },
  });
  const reader2 = makeFact('off-read-2', {
    loads: { 'copilot-cli': { folder: 'off-read-2', name: 'off-read-2', skillFile: '/home/.agents/skills/off-read-2/SKILL.md', in: 'copilot-cli', switchedOff: true } },
    anotherWay: { 'copilot-cli': 'Copilot CLI also reads a copy at …/.agents/skills, which is not Central Knot’s.' },
  });
  const plainSkill = makeFact('off-plain');

  const libOf = (list: LibraryFacts[]) => Object.fromEntries(list.map(row => [row.key, makeItem(row.key, false)]));
  const cases: [string, LibraryFacts[], Partial<Parameters<typeof makeHome>[0]>][] = [
    ['/heading-off-plugin', [pluginSkill, owedSkill, ownTwoTools, reader1], {
      pluginItems: [{ tool: 'copilot-cli', plugin: 'kit', source: '/market', marketName: 'local-market', off: false, listed: true, items: [{ kind: 'skill', name: 'off-plug', description: '' }] }],
    }],
    ['/heading-off-owed', [owedSkill, ownTwoTools], {}],
    ['/heading-off-own', [ownTwoTools], {}],
    ['/heading-off-reader-single', [reader1], {}],
    ['/heading-off-switched-single', [reader2], {}],
    ['/heading-off-plain-leftout', [plainSkill], { leftOut: ['pi-cli'] }],
  ];
  for (const [homePath, skills, extra] of cases) {
    app.home = makeHome({ homePath, tools, skills, library: libOf(skills), ...extra });
    openKind('skills');
    unpin();
    const tree = libraryTable();
    const head = readHeading(tree, 'off');
    assert.equal(head.count, String(skills.length), `${homePath} keeps Off count`);
    assert.equal(head.hasAfter, false, `${homePath} has no live note beside Off heading`);
    assert.ok(findAll(tree, el => el.attrs?.id === 'section-off-info').length === 1, `${homePath} keeps Off (?) mark`);
  }
});

test('Found live line handles zero and plural differing rows with real takeInAnswer shapes, and hides wait over pinned mixed rows', t => {
  const tools: HarnessId[] = ['claude-cli', 'codex-cli'];
  const differing = (key: string): LibraryFacts => makeFact(key, {
    copies: { 'claude-cli': makeCopy(key, `${key}-a`), 'codex-cli': makeCopy(key, `${key}-b`) },
    takeInAnswers: answersFor({
      deleted: false,
      copies: [{ harness: 'claude-cli', hash: `${key}-a`, at: Date.parse(OLD_AT) }, { harness: 'codex-cli', hash: `${key}-b`, at: Date.parse(OLD_AT) }],
    }),
  });
  const switchedOffOnly = makeFact('quiet-off', {
    copies: { 'claude-cli': makeCopy('quiet-off') },
    takeInAnswers: answersFor({ deleted: false, copies: [{ harness: 'claude-cli', hash: 'h-quiet-off', switchedOff: true }] }),
  });

  // Zero waiting rows under Synchronize everything (only a switched-off Found item): no live line.
  app.home = makeHome({ homePath: '/heading-found-zero-wait', tools, syncEverything: true, skills: [switchedOffOnly] });
  openKind('skills');
  assert.equal(readHeading(libraryTable(), 'found').hasAfter, false);

  // Two differing rows under Synchronize everything: plural verb "wait".
  t.after(() => { openKind('all'); unpin(); });
  app.home = makeHome({ homePath: '/heading-found-two-wait', tools, syncEverything: true, skills: [differing('clash-1'), differing('clash-2')] });
  openKind('skills');
  drawPage(() => libraryTable());
  assert.equal(readHeading(libraryTable(), 'found').liveLine, '2 wait for your choice of copy');

  // After choosing clash-1 (now On, pinned under Found) alongside clash-2 (still Found, waiting): count drops to 1 and live wait hides in .ov-section-room.
  pin(app.pinned, rowId('skills', 'clash-1'), 'found');
  const chosenOne = makeFact('clash-1', { copies: { 'claude-cli': makeCopy('clash-1', 'clash-1-a'), 'codex-cli': makeCopy('clash-1', 'clash-1-a') }, on: true });
  app.home = makeHome({
    homePath: '/heading-found-two-wait',
    tools,
    syncEverything: true,
    skills: [chosenOne, differing('clash-2')],
    library: { 'clash-1': makeItem('clash-1', true) },
  });
  const mixed = readHeading(libraryTable(), 'found');
  assert.equal(mixed.count, '1');
  assert.equal(mixed.liveLine, undefined);
  assert.equal(mixed.roomHidden, true);
});

test('Off card names left-out tools and unreadBand folds plural plugin reasons into its card', () => {
  const cardText = (tree: unknown, id: string) => textOf(findAll(tree, el => el.attrs?.id === `${id}-card`)[0]);
  const bandText = (tree: unknown) => {
    const band = findAll(tree, el => el.className.split(' ').includes('band') && !!findAll(el, c => c.attrs?.id === 'unread-plugins-info').length)[0];
    return textOf(findAll(band, el => el.className.split(' ').includes('band-text'))[0]);
  };
  const plainOff = makeFact('plain-off');
  const library = { 'plain-off': makeItem('plain-off', false) };
  const unread = (pairs: [HarnessId, string][]): HomeView['pluginItems'] => pairs.map(([tool, plugin]) => (
    { tool, plugin, source: '/m', marketName: 'm', listed: true, problem: `${plugin} missing.`, items: [] }
  ));

  // Left-out tool in Off card, and 4 unread plugins folded to 1 name + "and 3 more" with every reason in the card.
  app.home = makeHome({ homePath: '/list-words-leftout', tools: ['claude-cli', 'codex-cli'], leftOut: ['pi-cli'], skills: [plainOff], library, pluginItems: unread([['claude-cli', 'p1'], ['claude-cli', 'p2'], ['claude-cli', 'p3'], ['claude-cli', 'p4']]) });
  openKind('skills');
  unpin();
  const fourTree = libraryTable();
  assert.equal(cardText(fourTree, 'section-off-info'), 'Kept in Central Knot with its versions, switched off. Where a tool still has it, its row says so; Pi, left out, keeps whatever it has.');
  assert.equal(bandText(fourTree), 'What 4 plugins bring isn’t listed: p1 and 3 more');
  assert.equal(cardText(fourTree, 'unread-plugins-info'), 'p1 (Claude Code): p1 missing.\np2 (Claude Code): p2 missing.\np3 (Claude Code): p3 missing.\np4 (Claude Code): p4 missing.');

  // Same plugin unread in 2 distinct tools counts tools; same plugin from 2 marketplaces in 1 tool names that tool (never "2 tools").
  app.home = makeHome({ homePath: '/list-words-same', tools: ['claude-cli', 'codex-cli'], skills: [plainOff], library, pluginItems: unread([['claude-cli', 'p1'], ['codex-cli', 'p1']]) });
  openKind('skills');
  const sameTree = libraryTable();
  assert.equal(bandText(sameTree), 'What the plugin p1 brings in 2 tools isn’t listed');
  assert.equal(cardText(sameTree, 'unread-plugins-info'), 'p1 (Claude Code): p1 missing.\np1 (Codex): p1 missing.');

  const twoMarketsOneTool: HomeView['pluginItems'] = ['m1', 'm2'].map(marketName => (
    { tool: 'claude-cli', plugin: 'p1', source: `/${marketName}`, marketName, listed: true, problem: 'Claude Code lists it, but its files are not where it records them.', items: [] }
  ));
  app.home = makeHome({ homePath: '/list-words-same-tool', tools: ['claude-cli', 'codex-cli'], skills: [plainOff], library, pluginItems: twoMarketsOneTool });
  openKind('skills');
  const sameToolTree = libraryTable();
  assert.equal(bandText(sameToolTree), 'What the plugin p1 brings in Claude Code isn’t listed');
  assert.equal(cardText(sameToolTree, 'unread-plugins-info'),
    'Claude Code lists p1, but its files are not where Claude Code records them.\nClaude Code lists p1, but its files are not where Claude Code records them.');
});
