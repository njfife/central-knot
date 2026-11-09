import { icons, type IconName } from './icons.ts';

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/** `h('button.btn.ghost', { id: 'x', onclick }, 'Label')`. Keys starting with "on", and value and checked, are set as properties. */
export function h(spec: string, props: Props = {}, ...children: (Child | Child[])[]): HTMLElement {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag);
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') || key === 'value' || key === 'checked') (node as unknown as Record<string, unknown>)[key] = value;
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

export function icon(name: IconName, size = 16, extraClass = ''): SVGElement {
  const holder = document.createElement('template');
  holder.innerHTML = `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  return holder.content.firstElementChild as SVGElement;
}

export const hiddenText = (text: string) => h('span.hidden-text', {}, text);

interface ButtonOptions {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link';
  size?: 'micro' | 'small' | 'default';
  icon?: IconName;
  label?: string;
  /** Accessible name where the visible label is not enough, and the name of an icon-only button. */
  name?: string;
  id?: string;
  disabled?: boolean;
  /** A toolbar button with an icon and a label: when its toolbar can't fit (fitToolbars), only the icon shows, the label as its tooltip. */
  collapse?: boolean;
  onclick: (event: MouseEvent) => void;
  attrs?: Props;
}

/** A button: an optional icon, then its label. An icon-only button is named by `name`, shown on hover. */
export function button(options: ButtonOptions): HTMLElement {
  const { variant = 'outline', size = 'default', label, name } = options;
  const iconSize = size === 'default' ? 16 : 14;
  const collapses = !!(options.collapse && options.icon && label);
  return h(`button.btn.${variant}.${size}${label ? '' : '.square'}${collapses ? '.collapsible' : ''}`, {
    type: 'button', id: options.id, disabled: options.disabled, onclick: options.onclick,
    'aria-label': name, title: label && !collapses ? undefined : name ?? label, ...options.attrs,
  }, options.icon && icon(options.icon, iconSize), label && h('span.btn-label', {}, label));
}

/** Keeps the start and the distinguishing tail: the start ellipsizes, the tail stays. */
export function middle(text: string, tailLength = 12, extraClass = ''): HTMLElement {
  const characters = Array.from(text);
  const tail = characters.length > tailLength + 4 ? characters.slice(-tailLength).join('') : '';
  return h(`span.middle${extraClass ? `.${extraClass}` : ''}`, { title: text },
    h('span.middle-head', {}, tail ? characters.slice(0, -tailLength).join('') : text),
    tail && h('span.middle-tail', {}, tail));
}

export const pathText = (text: string, full = text) => {
  const node = middle(text, 26, 'mono');
  node.title = full;
  return node;
};

export function checkbox(options: { id: string; checked: boolean; disabled?: boolean; onchange: (checked: boolean) => void }, ...label: Child[]): HTMLElement {
  return h('label.tick', {},
    h('input.hidden-input', {
      type: 'checkbox', id: options.id, checked: options.checked, disabled: options.disabled,
      onchange: (event: Event) => options.onchange((event.target as HTMLInputElement).checked),
    }),
    icon(options.checked ? 'square-check' : 'square', 14, 'tick-box'),
    h('span.tick-label', {}, ...label));
}

export function emptyState(glyph: IconName, title: string, body: string | undefined, action?: Node): HTMLElement {
  return h('div.empty', {}, h('div.empty-tile', {}, icon(glyph)), h('h2.empty-title', {}, title), body && h('p.empty-body', {}, body), action);
}

export const eyebrow = (text: string, count?: number) => h('h3.eyebrow', {}, text, count === undefined ? null : h('span.eyebrow-count', {}, String(count)));
export const section = (title: string, ...body: (Child | Child[])[]) => h('section.section', {}, eyebrow(title), ...body);

/**
 * Keeps an open popover inside the scrolling area it opens in, now and whenever that area changes size (a window resize
 * included). It opens below its anchor, or above when there is more room there (.popover-above), with the height that
 * side really has (--fit-height), and moves sideways rather than run past an edge (--fit-shift). Values go through the
 * style object: the page's security policy refuses inline style attributes.
 */
export function fitInView(popover: HTMLElement): HTMLElement {
  const fit = () => {
    const frame = popover.closest('.scroll'), anchor = popover.parentElement;
    if (!popover.isConnected || !frame || !anchor) { watcher.disconnect(); return; }
    // The area's inside, without its scrollbar gutter: a popover over the gutter would make the area scroll sideways.
    const outer = frame.getBoundingClientRect(), around = anchor.getBoundingClientRect();
    const area = { left: outer.left + frame.clientLeft, right: outer.left + frame.clientLeft + frame.clientWidth, top: outer.top + frame.clientTop, bottom: outer.top + frame.clientTop + frame.clientHeight };
    const below = area.bottom - around.bottom, above = around.top - area.top;
    popover.classList.toggle('popover-above', above > below);
    popover.style.setProperty('--fit-height', `${Math.max(0, Math.max(above, below) - 8)}px`);
    popover.style.setProperty('--fit-shift', '0px');
    const box = popover.getBoundingClientRect();
    popover.style.setProperty('--fit-shift', `${Math.min(0, area.right - 8 - box.right) + Math.max(0, area.left + 8 - box.left)}px`);
  };
  const watcher = new ResizeObserver(fit);
  // Observed once drawn; the first observation fits it.
  requestAnimationFrame(() => { const frame = popover.closest('.scroll'); if (frame) watcher.observe(frame); });
  return popover;
}

/** A pending-change count that shortens first in a crowded toolbar (fitToolbars): `short` replaces `full`, which stays its tooltip. */
export const pendingCount = (full: string, short: string): HTMLElement =>
  h('span.apply-count.apply-quiet', { title: full }, h('span.count-full', {}, full), h('span.count-short', {}, short));

/** What a crowded toolbar gives up, in order, until it fits: long pending counts, then button labels, then its single line. */
const TOOLBAR_STEPS = ['toolbar-short', 'toolbar-icons', 'toolbar-wrap'];

/**
 * Fits each toolbar to its width. A step applies only while the toolbar still overflows without it, so every label stays
 * as long as there is room for it. The renderer calls this after each draw and on every resize.
 */
export function fitToolbars(): void {
  for (const bar of document.querySelectorAll<HTMLElement>('.toolbar')) {
    bar.classList.remove(...TOOLBAR_STEPS);
    for (const step of TOOLBAR_STEPS) {
      if (bar.scrollWidth <= bar.clientWidth) break;
      bar.classList.add(step);
    }
  }
}

/** Sets a table's column count (--tool-count) through the style object: the page's security policy refuses inline style attributes. */
export function withToolCount(table: HTMLElement, count: number): HTMLElement {
  table.style.setProperty('--tool-count', String(count));
  return table;
}

/** The small × that closes a band, notice or result. `label` is read out and, unless `title` differs, shown on hover. */
export const closeButton = (onclick: (event: Event) => void, { id, label = 'Dismiss', title = label, look = '' }: { id?: string; label?: string; title?: string; look?: string } = {}) =>
  h(`button.band-dismiss${look}`, { type: 'button', id, 'aria-label': label, title, onclick }, icon('x', 12));
