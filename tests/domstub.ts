// Shared minimal fake DOM for renderer page unit tests (sessionspage.test.ts, harnesspage.test.ts, settingspage.test.ts).
export interface FakeNode {
  tag: string;
  className: string;
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, unknown>;
  classList: { toggle: (name: string, on?: boolean) => void; add: () => void; remove: () => void; contains: (name: string) => boolean };
  children: unknown[];
  parent?: FakeNode;
  content: { firstElementChild?: FakeNode };
  onclick?: (event: unknown) => void;
  focused: number;
  scrollTop: number;
  rect: { top: number; bottom: number; height: number };
  textContent: string;
  setAttribute: (key: string, value: string) => void;
  addEventListener: () => void;
  replaceChildren: (...kids: unknown[]) => void;
  append: (...kids: unknown[]) => void;
  after: (...kids: unknown[]) => void;
  focus: (opts?: { preventScroll?: boolean }) => void;
  scrollTo: () => void;
  scrollIntoView: (opts?: unknown) => void;
  closest: (selector: string) => FakeNode | null;
  getBoundingClientRect: () => { top: number; bottom: number; height: number };
  click: () => void;
  querySelector: (selector: string) => FakeNode | null;
}

const isDisabled = (el: FakeNode) => 'disabled' in el.attrs;
const canFocus = (el: FakeNode) => !isDisabled(el) && (['button', 'input', 'textarea', 'select', 'summary', 'a'].includes(el.tag) || 'tabindex' in el.attrs);

const matchesSimple = (el: FakeNode, raw: string): boolean => {
  const notDisabled = raw.includes(':not(:disabled)');
  const sel = raw.replace(':not(:disabled)', '');
  if (notDisabled && isDisabled(el)) return false;
  if (sel === '[tabindex="0"]') return el.attrs.tabindex === '0';
  if (sel.startsWith('#')) return el.attrs.id === sel.slice(1);
  if (sel.startsWith('.')) return el.className.split(/\s+/).includes(sel.slice(1));
  return el.tag === sel;
};

const queryIn = (root: FakeNode, selector: string): FakeNode | null => {
  const parts = selector.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length > 1 || parts[0]?.includes(':not(') || parts[0]?.startsWith('[') || /^[a-z]+$/i.test(parts[0] ?? '')) {
    return findNode(root, el => el !== root && parts.some(part => matchesSimple(el, part))) ?? null;
  }
  let scope: FakeNode | undefined = root;
  for (const part of selector.trim().split(/\s+/)) {
    if (!scope) return null;
    if (part.startsWith('#')) scope = findById(scope, part.slice(1));
    else if (part.startsWith('.')) scope = findNode(scope, el => el.className.split(/\s+/).includes(part.slice(1)));
    else return makeElement();
  }
  return scope ?? null;
};

export const makeElement = (tag = 'div'): FakeNode => {
  const node: FakeNode = {
    tag,
    className: '',
    attrs: {},
    dataset: {},
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {}, contains(name: string) { return node.className.split(/\s+/).includes(name); } },
    children: [],
    content: {},
    focused: 0,
    scrollTop: 0,
    rect: { top: 0, bottom: 0, height: 0 },
    get textContent() {
      return textOf(node);
    },
    set textContent(value: string) {
      node.children = [value];
    },
    setAttribute(key: string, value: string) {
      this.attrs[key] = value;
    },
    addEventListener() {},
    replaceChildren(...kids: unknown[]) {
      this.children = [...kids];
      for (const kid of kids) if (kid && typeof kid === 'object' && 'tag' in kid) (kid as FakeNode).parent = this;
    },
    append(...kids: unknown[]) {
      this.children.push(...kids);
      for (const kid of kids) if (kid && typeof kid === 'object' && 'tag' in kid) (kid as FakeNode).parent = this;
    },
    after() {},
    focus() {
      if (!canFocus(this)) return;
      this.focused++;
      const doc = (globalThis as { document?: { activeElement?: FakeNode | null } }).document;
      if (doc) doc.activeElement = this;
    },
    scrollTo() {},
    scrollIntoView() {},
    closest(selector: string) {
      let cur: FakeNode | undefined = this;
      while (cur) {
        if (matchesSimple(cur, selector)) return cur;
        cur = cur.parent;
      }
      return null;
    },
    getBoundingClientRect() {
      return this.rect;
    },
    click() {
      if ('disabled' in this.attrs) return;
      this.onclick?.({ stopPropagation() {} });
    },
    querySelector(selector: string) {
      return queryIn(node, selector);
    },
  };
  if (tag === 'template') {
    Object.defineProperty(node, 'innerHTML', {
      set(html: string) {
        const svg = makeElement('svg');
        svg.className = /class="([^"]*)"/.exec(html)?.[1] ?? '';
        node.content.firstElementChild = svg;
      },
    });
  }
  return node;
};

export const findNode = (node: unknown, match: (el: FakeNode) => boolean): FakeNode | undefined => {
  if (!node || typeof node !== 'object') return undefined;
  const el = node as FakeNode;
  if (el.tag && match(el)) return el;
  for (const child of el.children ?? []) {
    const hit = findNode(child, match);
    if (hit) return hit;
  }
  return undefined;
};

export const findById = (node: unknown, id: string): FakeNode | undefined =>
  findNode(node, el => el.attrs?.id === id);

export const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  return ((node as FakeNode).children ?? []).map(textOf).join('');
};

export function installDom(
  api: Record<string, unknown>,
  { userAgent = 'Linux', byId }: { userAgent?: string; byId?: (id: string) => FakeNode | null | undefined } = {},
) {
  const announcement = makeElement('span');
  const docListeners: Record<string, ((event: unknown) => void)[]> = {};
  Object.assign(globalThis, {
    window: {
      centralKnot: new Proxy(api, { get: (known, name) => known[name as string] ?? (() => Promise.resolve(null)) }),
      addEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
    },
    document: {
      body: makeElement('body'),
      documentElement: makeElement('html'),
      activeElement: null,
      hidden: false,
      hasFocus: () => true,
      getElementById: (id: string) => (id === 'announcement' ? announcement : (byId ? byId(id) : makeElement('span'))),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(name: string, fn: (event: unknown) => void) { (docListeners[name] ??= []).push(fn); },
      createElement: makeElement,
      createTextNode: (text: string) => text,
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 0,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
  return { announcement, dispatch(name: string, event: unknown) { for (const fn of docListeners[name] ?? []) fn(event); } };
}
