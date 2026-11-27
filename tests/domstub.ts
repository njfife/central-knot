// Shared minimal fake DOM for renderer page unit tests (sessionspage.test.ts, harnesspage.test.ts, settingspage.test.ts).
export interface FakeNode {
  tag: string;
  className: string;
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, unknown>;
  classList: { toggle: (name: string, on?: boolean) => void; add: () => void; remove: () => void; contains: (name: string) => boolean };
  children: unknown[];
  content: { firstElementChild?: FakeNode };
  onclick?: (event: unknown) => void;
  focused: number;
  textContent: string;
  setAttribute: (key: string, value: string) => void;
  addEventListener: () => void;
  replaceChildren: (...kids: unknown[]) => void;
  append: (...kids: unknown[]) => void;
  after: (...kids: unknown[]) => void;
  focus: () => void;
  scrollTo: () => void;
  click: () => void;
  querySelector: (selector: string) => FakeNode | null;
}

const queryIn = (root: FakeNode, selector: string): FakeNode | null => {
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
    },
    append(...kids: unknown[]) {
      this.children.push(...kids);
    },
    after() {},
    focus() {
      this.focused++;
    },
    scrollTo() {},
    click() {
      if ('disabled' in this.attrs) return;
      this.onclick?.({ stopPropagation() {} });
    },
    querySelector(selector: string) {
      return queryIn(node, selector);
    },
  };
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
      addEventListener() {},
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
  return { announcement };
}
