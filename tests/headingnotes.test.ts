// Library and tool-tab section heading rules not already held by scripts/e2e.mjs (matrix.ts section, foundNote, offNote):
// own-copy counting across tools, Off live-line branch priority and multi-row fallback, Found wait plural/zero counts,
// and suppressing live notes over mixed rows under Found while Synchronize everything is on.
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

test('Off heading counts own copies across tools rather than items', () => {
  const tools: HarnessId[] = ['claude-cli', 'codex-cli', 'opencode-cli'];
  const twoToolsOneSkill = makeFact('off-a', {
    copies: { 'codex-cli': makeCopy('off-a', 'h-codex'), 'opencode-cli': makeCopy('off-a', 'h-oc') },
  });
  const oneToolOneSkill = makeFact('off-b', {
    copies: { 'opencode-cli': makeCopy('off-b', 'h-oc-b') },
  });

  // One Off item with own copies in both Codex and OpenCode: 2 own copies, not 1.
  app.home = makeHome({
    homePath: '/heading-own-two-tools',
    tools,
    skills: [twoToolsOneSkill],
    library: { 'off-a': makeItem('off-a', false) },
  });
  openKind('skills');
  unpin();
  assert.equal(readHeading(libraryTable(), 'off').liveLine, '2 own copies in Codex and OpenCode');

  // One Off item in one tool stays singular.
  app.home = makeHome({
    homePath: '/heading-own-one-tool',
    tools,
    skills: [oneToolOneSkill],
    library: { 'off-b': makeItem('off-b', false) },
  });
  openKind('skills');
  assert.equal(readHeading(libraryTable(), 'off').liveLine, '1 own copy in OpenCode');

  // Two Off items totaling three own copies across Codex and OpenCode.
  app.home = makeHome({
    homePath: '/heading-own-three-copies',
    tools,
    skills: [twoToolsOneSkill, oneToolOneSkill],
    library: { 'off-a': makeItem('off-a', false), 'off-b': makeItem('off-b', false) },
  });
  openKind('skills');
  assert.equal(readHeading(libraryTable(), 'off').liveLine, '3 own copies in Codex and OpenCode');
});

test('Off live line keeps branch priority order and drops static fallback prose even with a left-out tool', () => {
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  const ownSkill = makeFact('off-own', { copies: { 'codex-cli': makeCopy('off-own') } });
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

  // 1. Plugin on beats pending removal, own copies and other-reader.
  const allFour = [pluginSkill, owedSkill, ownSkill, reader1];
  app.home = makeHome({
    homePath: '/heading-priority-1',
    tools,
    skills: allFour,
    library: libOf(allFour),
    pluginItems: [{ tool: 'copilot-cli', plugin: 'kit', source: '/market', marketName: 'local-market', off: false, listed: true, items: [{ kind: 'skill', name: 'off-plug', description: '' }] }],
  });
  openKind('skills');
  assert.equal(readHeading(libraryTable(), 'off').liveLine, 'some on in Copilot CLI through a plugin');

  // 2. Pending removal beats own copies and other-reader.
  const three = [owedSkill, ownSkill, reader1];
  app.home = makeHome({ homePath: '/heading-priority-2', tools, skills: three, library: libOf(three) });
  openKind('skills');
  assert.equal(readHeading(libraryTable(), 'off').liveLine, '1 still in Codex until sync runs');

  // 3. Own copies beat other-reader/switched-off.
  const two = [ownSkill, reader2];
  app.home = makeHome({ homePath: '/heading-priority-3', tools, skills: two, library: libOf(two) });
  openKind('skills');
  assert.equal(readHeading(libraryTable(), 'off').liveLine, '1 own copy in Codex');

  // 4. Multiple Off rows with other-reader/switched-off copies use the short summary without old fallback prose.
  const readers = [reader1, reader2];
  app.home = makeHome({ homePath: '/heading-priority-4', tools, skills: readers, library: libOf(readers) });
  openKind('skills');
  assert.equal(readHeading(libraryTable(), 'off').liveLine, 'some tools still have copies elsewhere');

  // 5. Plain Off with an unmanaged tool left out has no live line and no static fallback prose.
  app.home = makeHome({ homePath: '/heading-priority-5', tools, leftOut: ['pi-cli'], skills: [plainSkill], library: libOf([plainSkill]) });
  openKind('skills');
  const plain = readHeading(libraryTable(), 'off');
  assert.equal(plain.hasAfter, false);
  assert.doesNotMatch(plain.rawText, /no tool (it manages )?has these/);
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
