// Harnesses cards (harnesspage.ts summaryCard, goHarness): a managed card's main body is a plain div with its heading as the
// link button carrying the card's id, busy guard and goHarness(tool); keyboard Back returns focus to that heading; unmanaged
// and missing cards render no navigation button.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView } from '../src/types.ts';

interface FakeNode {
  tag: string;
  className: string;
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, unknown>;
  classList: { toggle: (name: string, on?: boolean) => void; add: (...names: string[]) => void; remove: (...names: string[]) => void };
  children: unknown[];
  content: { firstElementChild?: FakeNode };
  onclick?: (event: unknown) => void;
  focused: number;
  setAttribute: (key: string, value: string) => void;
  addEventListener: () => void;
  replaceChildren: (...kids: unknown[]) => void;
  append: (...kids: unknown[]) => void;
  focus: () => void;
  scrollTo: () => void;
  click: () => void;
}

const makeElement = (tag = 'div'): FakeNode => {
  const node: FakeNode = {
    tag,
    className: '',
    attrs: {},
    dataset: {},
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    children: [],
    content: {},
    focused: 0,
    setAttribute(key: string, value: string) { this.attrs[key] = value; },
    addEventListener() {},
    replaceChildren(...kids: unknown[]) { this.children = [...kids]; },
    append(...kids: unknown[]) { this.children.push(...kids); },
    focus() { this.focused++; },
    scrollTo() {},
    click() {
      if ('disabled' in this.attrs) return;
      this.onclick?.({ detail: 0, stopPropagation() {} });
    },
  };
  return node;
};

const walk = (node: unknown, visit: (el: FakeNode) => void) => {
  if (!node || typeof node !== 'object') return;
  const el = node as FakeNode;
  if (el.tag) visit(el);
  for (const child of el.children ?? []) walk(child, visit);
};

const hasClass = (el: FakeNode, name: string) => el.className.split(/\s+/).includes(name);

const findById = (root: unknown, id: string): FakeNode | undefined => {
  let hit: FakeNode | undefined;
  walk(root, el => { if (!hit && el.attrs.id === id) hit = el; });
  return hit;
};

const findAll = (root: unknown, match: (el: FakeNode) => boolean): FakeNode[] => {
  const out: FakeNode[] = [];
  walk(root, el => { if (match(el)) out.push(el); });
  return out;
};

let rendered: FakeNode | undefined;
const announcement = makeElement('span');

Object.assign(globalThis, {
  window: {
    centralKnot: new Proxy({}, { get: () => () => Promise.resolve(null) }),
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  },
  document: {
    body: makeElement('body'),
    documentElement: makeElement('html'),
    activeElement: null,
    hidden: false,
    hasFocus: () => true,
    getElementById: (id: string) => (id === 'announcement' ? announcement : findById(rendered, id) ?? null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: makeElement,
    createTextNode: (text: string) => text,
  },
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: () => 0,
});
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Macintosh' } });

const { setRenderer, state: app } = await import('../src/app.ts');
const { goHarness, harnessesPage } = await import('../src/harnesspage.ts');

const emptyKind = (tools: HarnessId[]) => ({
  tools,
  items: [],
  notices: [],
  problems: [],
  unread: [],
  access: { allowed: true },
  gate: { state: 'ready' },
  library: {},
});

const snapshotOf = (harness: HarnessId, detection: string, issues: string[] = []) => ({
  harness,
  root: `/home/.${harness}`,
  discovery: detection === 'Not found' ? 'missing' : 'found',
  detection,
  probe: { version: detection === 'Installed' ? '1.2.3' : undefined, detail: '' },
  skills: [],
  issues,
});

function seedHome() {
  const managed: HarnessId[] = ['claude-cli'];
  const present: HarnessId[] = ['claude-cli', 'codex-cli'];
  app.home = {
    home: '/home',
    mode: 'actual',
    label: 'This computer',
    syncOn: true,
    snapshots: [
      snapshotOf('claude-cli', 'Installed', ['Could not read a skill']),
      snapshotOf('codex-cli', 'Installed'),
      snapshotOf('pi-cli', 'Not found'),
    ],
    sync: {
      present,
      managed,
      leftOut: ['codex-cli'],
      joining: { 'codex-cli': { written: 0, kept: 0, removed: 0, found: 0, takenIn: 0 } },
      writes: {},
      caughtUp: [],
      arrived: [],
      access: { allowed: true },
      gate: { state: 'ready' },
    },
    skills: emptyKind(managed),
    mcp: emptyKind(managed),
    agents: emptyKind(managed),
    pluginItems: [],
    pluginRecordsUnread: [],
    profiles: { profiles: [] },
    otherApps: [],
  } as unknown as HomeView;
  app.page = 'harnesses';
  app.harness = undefined;
  app.harnessTab = 'skills';
  app.busy = undefined;
  app.instructions = { state: 'ready', data: [], gen: 0 };
}

test('managed card uses a plain div main and a heading button that opens the tool, honours busy, and regains focus on keyboard Back', () => {
  seedHome();
  setRenderer(() => { rendered = harnessesPage() as unknown as FakeNode; });
  rendered = harnessesPage() as unknown as FakeNode;

  const cards = findAll(rendered, el => hasClass(el, 'harness-card'));
  assert.equal(cards.length, 3);
  const [claudeCard, codexCard, piCard] = cards;

  // Managed card: plain div .harness-card-main, heading button carries id and comes first in keyboard order, no nested buttons.
  const claudeMain = findAll(claudeCard, el => hasClass(el, 'harness-card-main'))[0]!;
  assert.equal(claudeMain.tag, 'div');
  assert.equal(claudeMain.onclick, undefined);
  const claudeHead = findById(claudeCard, 'harness-claude-cli')!;
  assert.equal(claudeHead.tag, 'button');
  assert.equal(claudeHead.attrs.type, 'button');
  assert.ok(hasClass(claudeHead, 'harness-card-head'));
  assert.equal(claudeMain.children[0], claudeHead);
  assert.equal(findAll(claudeHead, el => el !== claudeHead && el.tag === 'button').length, 0);
  assert.deepEqual(
    findAll(claudeCard, el => el.tag === 'button').map(el => el.attrs.id),
    ['harness-claude-cli', 'harness-claude-cli-problems', 'manage-claude-cli'],
  );

  // Clicking the heading opens the tool; keyboard Back returns focus to that heading button, mouse Back does not.
  claudeHead.click();
  assert.equal(app.harness, 'claude-cli');
  goHarness(undefined, undefined, { fromKeyboard: true });
  assert.equal(app.harness, undefined);
  assert.equal(findById(rendered, 'harness-claude-cli')!.focused, 1);

  findById(rendered, 'harness-claude-cli')!.click();
  assert.equal(app.harness, 'claude-cli');
  goHarness(undefined, undefined, { fromKeyboard: false });
  assert.equal(app.harness, undefined);
  assert.equal(findById(rendered, 'harness-claude-cli')!.focused, 0);

  // Busy guard disables the heading button and prevents navigation.
  app.busy = 'Working…';
  rendered = harnessesPage() as unknown as FakeNode;
  const busyHead = findById(rendered, 'harness-claude-cli')!;
  assert.equal(busyHead.tag, 'button');
  assert.equal('disabled' in busyHead.attrs, true);
  busyHead.click();
  assert.equal(app.harness, undefined);
  app.busy = undefined;

  // Unmanaged and missing cards keep a non-button span heading and never navigate.
  for (const [card, id] of [[codexCard, 'harness-codex-cli'], [piCard, 'harness-pi-cli']] as const) {
    assert.equal(card.attrs.id, id);
    const main = findAll(card, el => hasClass(el, 'harness-card-main'))[0]!;
    const head = findAll(card, el => hasClass(el, 'harness-card-head'))[0]!;
    assert.equal(main.tag, 'div');
    assert.equal(main.onclick, undefined);
    assert.equal(head.tag, 'span');
    assert.equal(head.onclick, undefined);
    assert.equal(findAll(card, el => el.tag === 'button' && el.attrs.id === id).length, 0);
  }
  setRenderer(() => {});
});
