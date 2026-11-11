import { icons, type IconName } from './icons.ts';
import { groupBy } from './model.ts';

export type Child = Node | string | null | undefined | false;
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

/** A Find field: each keystroke hands the text to `onInput` (which redraws), and the redrawn field keeps the focus. */
export const findInput = (field: { id: string; label: string; value: string; onInput: (text: string) => void; onKeydown?: (event: KeyboardEvent) => void }) =>
  h('input.find-input', { id: field.id, type: 'text', placeholder: 'Find', 'aria-label': field.label, value: field.value, spellcheck: 'false', onkeydown: field.onKeydown,
    oninput: (event: Event) => { field.onInput((event.target as HTMLInputElement).value); document.getElementById(field.id)?.focus(); } });

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
  /** A bar button with an icon and a label: when its bar can't fit (fitBars), only the icon shows, the label as its tooltip. */
  collapse?: boolean;
  onclick: (event: MouseEvent) => void;
  attrs?: Props;
}

/** A button: an optional icon, then its label. An icon-only button is named by `name`, shown on hover. */
export function button(options: ButtonOptions): HTMLElement {
  const { variant = 'outline', size = 'default', label, name } = options;
  const iconSize = size === 'default' ? 16 : 14;
  const collapses = !!(options.collapse && options.icon && label);
  // A collapsible button keeps its tooltip text aside (data-tip); fitBars shows it only while the label is hidden. The
  // tooltip then stands in for the label, so it starts with it unless its name already says it.
  const tip = !collapses ? undefined : name && !name.toLowerCase().includes(label!.toLowerCase()) ? `${label}: ${name}` : name ?? label;
  return h(`button.btn.${variant}.${size}${label ? '' : '.square'}${collapses ? '.collapsible' : ''}`, {
    type: 'button', id: options.id, disabled: options.disabled, onclick: options.onclick,
    'aria-label': name, title: label ? undefined : name, 'data-tip': tip, ...options.attrs,
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

/**
 * A path that fits the space it has: its folders give way first, with an ellipsis, then its last name; the full path is
 * the tooltip. No character count decides where it is cut.
 */
export const pathText = (text: string, full = text): HTMLElement => {
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return h('span.middle.mono.path-text', { title: full },
    h('span.middle-head', {}, cut > 0 ? text.slice(0, cut) : text), cut > 0 ? h('span.middle-tail', {}, text.slice(cut)) : null);
};

/** A disabled control's reason, as its tooltip and its accessible description. */
export const lockAttrs = (why: string | undefined) => (why ? { title: why, 'aria-description': why } : undefined);

/**
 * An on/off switch; its label is also its tooltip. `mixed`: neither, drawn in between (its knob in the middle); a click turns
 * it on. `attrs` adds to or replaces its attributes (Settings ties it to its row's hint).
 */
export function toggle({ on, mixed = false, label, onchange, disabled = false, id, attrs = {} }: { on: boolean; mixed?: boolean; label: string; onchange: (on: boolean) => void; disabled?: boolean; id?: string; attrs?: Props }) {
  return h('button.switch', { type: 'button', id, role: 'switch', 'aria-checked': mixed ? 'mixed' : String(on), 'aria-label': label, title: label, disabled, ...attrs, onclick: (event: Event) => { event.stopPropagation(); onchange(mixed || !on); } },
    h('span.switch-knob'));
}

/**
 * A tick box drawn with the app's icons over a hidden native checkbox. `mixed` draws a box for a group with only some ticked;
 * `name` and `help` are read with it (`help` also shows on hover) when it has no visible `label`; `look` is the label's class.
 */
export function checkbox(options: { id: string; checked: boolean; disabled?: boolean; onchange: (checked: boolean) => void; mixed?: boolean; name?: string; help?: string; look?: string }, ...label: Child[]): HTMLElement {
  return h(`label.${options.look ?? 'tick'}`, { title: options.help },
    h('input.hidden-input', {
      type: 'checkbox', id: options.id, checked: options.checked, disabled: options.disabled, 'aria-label': options.name, 'aria-description': options.help,
      onchange: (event: Event) => options.onchange((event.target as HTMLInputElement).checked),
    }),
    icon(options.checked ? 'square-check' : options.mixed ? 'square-minus' : 'square', 14, 'tick-box'),
    label.length ? h('span.tick-label', {}, ...label) : null);
}

export function emptyState(glyph: IconName, title: string, body: string | undefined, action?: Node): HTMLElement {
  return h('div.empty', {}, h('div.empty-tile', {}, icon(glyph)), h('h2.empty-title', {}, title), body && h('p.empty-body', {}, body), action);
}

export const eyebrow = (text: string, count?: number) => h('h3.eyebrow', {}, text, count === undefined ? null : h('span.eyebrow-count', {}, String(count)));
export const section = (title: string, ...body: (Child | Child[])[]) => h('section.section', {}, eyebrow(title), ...body);

/** A pending-change count that shortens first in a crowded bar (fitBars): `short` replaces `full`, which stays its tooltip. */
export const pendingCount = (full: string, short: string): HTMLElement =>
  h('span.apply-count.apply-quiet', { title: full }, h('span.count-full', {}, full), h('span.count-short', {}, short));

/** What a crowded bar gives up, in order, until it fits: long pending counts, then button labels, then its single line. */
const FIT_STEPS = ['bar-short', 'bar-icons', 'bar-wrap'];

/**
 * Whether anything in a bar reaches past its content box, into its padding or beyond, or a part of the bar holds more
 * than it shows (its own content overflows it, though the part itself fits).
 */
function overflows(bar: HTMLElement): boolean {
  const box = bar.getBoundingClientRect();
  // A bar that isn't drawn (a toolbar holding only a title, in narrow content) has nothing to overflow.
  if (!box.width) return false;
  const inner = box.right - parseFloat(getComputedStyle(bar).paddingRight);
  return [...bar.children].some(child => child.getBoundingClientRect().right > inner + 0.5 || child.scrollWidth > child.clientWidth + 1);
}

/**
 * Fits each bar marked .fit-bar (toolbars, the Files view's header) to its width. A step applies only while the bar still
 * overflows without it, so every label stays as long as there is room. The renderer calls this after each draw and
 * whenever the content area resizes.
 */
export function fitBars(): void {
  for (const bar of document.querySelectorAll<HTMLElement>('.fit-bar')) {
    bar.classList.remove(...FIT_STEPS);
    for (const step of FIT_STEPS) {
      if (!overflows(bar)) break;
      bar.classList.add(step);
    }
    // Still too wide after every step: marked, so tests (scripts/e2e.mjs) read the same measurement instead of a copy of it.
    bar.toggleAttribute('data-overflows', overflows(bar));
    // A button or filter chip showing only its icon gets its label as a tooltip; one whose label shows needs none (a title it
    // was given stays).
    const iconsOnly = bar.classList.contains('bar-icons');
    for (const button of bar.querySelectorAll<HTMLElement>('.btn[data-tip], .chip[data-tip]')) {
      if (iconsOnly && !button.title) { button.title = button.dataset.tip!; button.dataset.tipShown = ''; }
      else if (!iconsOnly && 'tipShown' in button.dataset) { button.removeAttribute('title'); delete button.dataset.tipShown; }
    }
  }
}

/**
 * Cards side by side: the grid knows how many it holds (data-count), so style.css chooses the columns from the count and
 * the width, and no cell is left empty.
 */
export const cardGrid = (cards: Node[]): HTMLElement => h('div.card-grid', { 'data-count': String(cards.length) }, cards);

/**
 * Tells an element laid out in tool columns (a table, a plugin's "Your tools") how many tools it has: --tool-count for its
 * grid, set through the style object (the page's security policy refuses inline style attributes), and data-tools for
 * the CSS steps that depend on it. Returns the element.
 */
export function withToolCount(element: HTMLElement, count: number): HTMLElement {
  element.style.setProperty('--tool-count', String(count));
  element.dataset.tools = String(count);
  return element;
}

/**
 * What a page with its own data (pagedata.ts) says above what it shows, once something was read: a quiet band while it
 * reads again (`reading`, for a page whose read can take seconds), or that the last read again failed, so what shows is
 * the read before. Nothing while there is nothing read: the page itself then says it is reading or couldn't.
 */
export function rereadBand(slot: { state: string; data?: unknown }, reading?: string): HTMLElement | null {
  if (slot.data === undefined) return null;
  if (slot.state === 'failed') return h('div.band.band-quiet.reread-failed', { role: 'status' }, icon('circle-alert', 14, 'tone-muted'), h('span.band-text', {}, 'Could not read again; showing the last read.'));
  if (slot.state === 'reading' && reading) return h('div.band.band-quiet.rereading', { role: 'status' }, icon('refresh-cw', 14, 'spin tone-muted'), h('span.band-text', {}, reading));
  return null;
}

/** Steps that measure the drawn page and mark it (afterLayout). */
const layoutSteps: (() => void)[] = [];

/**
 * Registers a step that reads what the drawn page measures and marks it with an attribute or class (columns from a
 * width, whether a line wrapped). The renderer runs every step right after drawing, before the page is painted, and
 * again whenever the content area changes width (runAfterLayout); a step that finds nothing of its own on the page does
 * nothing.
 */
export const afterLayout = (step: () => void): void => { layoutSteps.push(step); };
export const runAfterLayout = (): void => { for (const step of layoutSteps) step(); };

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
