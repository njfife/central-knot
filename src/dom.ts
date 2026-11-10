import { icons, type IconName } from './icons.ts';

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/** The page runs on a Mac: shortcuts say ⌘, and the app lives in the menu bar rather than the system tray. */
export const onMac = navigator.userAgent.includes('Mac');
/** Where Central Knot's icon sits while its window is closed. */
export const trayName = onMac ? 'menu bar' : 'system tray';

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
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'danger';
  size?: 'micro' | 'small' | 'default';
  icon?: IconName;
  label?: string;
  /** Accessible name where the visible label is not enough, and the name of an icon-only button. */
  name?: string;
  id?: string;
  disabled?: boolean;
  onclick: (event: MouseEvent) => void;
  attrs?: Props;
}

export function button(options: ButtonOptions): HTMLElement {
  const { variant = 'outline', size = 'default', label, name } = options;
  const iconSize = size === 'default' ? 16 : 14;
  return h(`button.btn.${variant}.${size}${label ? '' : '.square'}`, {
    type: 'button', id: options.id, disabled: options.disabled, onclick: options.onclick,
    'aria-label': name, title: label ? undefined : name, ...options.attrs,
  }, options.icon && icon(options.icon, iconSize), label);
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

/** An on/off switch; its label is also its tooltip. `attrs` adds to or replaces its attributes (Settings ties it to its row's hint). */
export function toggle({ on, label, onchange, disabled = false, id, attrs = {} }: { on: boolean; label: string; onchange: (on: boolean) => void; disabled?: boolean; id?: string; attrs?: Props }) {
  return h('button.switch', { type: 'button', id, role: 'switch', 'aria-checked': String(on), 'aria-label': label, title: label, disabled, ...attrs, onclick: (event: Event) => { event.stopPropagation(); onchange(!on); } },
    h('span.switch-knob'));
}

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

/** Sets a table's column count (--tool-count) through the style object: the page's security policy refuses inline style attributes. */
export function withToolCount(table: HTMLElement, count: number): HTMLElement {
  table.style.setProperty('--tool-count', String(count));
  return table;
}

/** The small × that closes a band, notice or result. `label` is read out and, unless `title` differs, shown on hover. */
export const closeButton = (onclick: (event: Event) => void, { id, label = 'Dismiss', title = label, look = '' }: { id?: string; label?: string; title?: string; look?: string } = {}) =>
  h(`button.band-dismiss${look}`, { type: 'button', id, 'aria-label': label, title, onclick }, icon('x', 12));
