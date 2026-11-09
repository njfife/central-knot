import { icons, type IconName } from './icons.ts';
import { groupBy } from './model.ts';

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

/**
 * Blocks showing a file's text as written, one per distinct text, for any kind of copy (a skill in each tool, a plugin's
 * copy in the marketplace and in each tool). Texts are the same when `same` gives the same key (by default, exactly the
 * same). `name` says who holds a block (given how many distinct texts there are); it shows above each block when the
 * copies differ, or always with `named`. `warn` marks a block whose holders are the odd ones out. Ids are `${id}-0`, `-1`….
 */
export function fileBlocks<Copy extends { text: string }>(id: string, label: string, copies: Copy[], name: (holders: Copy[], distinct: number) => string,
  { named = false, warn, same = text => text }: { named?: boolean; warn?: (holders: Copy[]) => boolean; same?: (text: string) => string } = {}): HTMLElement[] {
  const distinct = groupBy(copies, copy => same(copy.text));
  return [...distinct].map(([, holders], index) => {
    const text = holders[0]!.text;
    const who = name(holders, distinct.size);
    const odd = warn?.(holders) ?? false;
    return h('div.content-block', {},
      (named || distinct.size > 1) && h(`p.content-owner${odd ? '.tone-warning' : ''}`, {}, odd ? icon('circle-alert', 12) : null, who),
      h('pre.content.mono', { tabindex: '0', id: `${id}-${index}`, 'aria-label': `${label}, ${who}` }, text));
  });
}
