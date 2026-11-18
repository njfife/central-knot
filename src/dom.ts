// The page's element builder (h) and the small controls every page draws with: buttons, switches (toggle), checkboxes, icons,
// empty states, section headings, shortened paths and file blocks, the layout steps run after a render (afterLayout); a press and
// its release counting as one click when a redraw replaced the control between them (keepClicksAcrossRedraws), and whether a
// press on a text was a click or a drag, which every click on a text asks (pressWasDrag); and what a redraw keeps of what is
// selected (keepSelection). No words of the app's own: what a control says is its caller's, and the styles are style.css's.
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
  /** Off; a reason, as text, also says why it is off (its title and description: app.ts acting). */
  disabled?: boolean | string;
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
    type: 'button', id: options.id, disabled: !!options.disabled, onclick: options.onclick,
    'aria-label': name, title: label ? undefined : name, 'data-tip': tip, ...options.attrs, ...whyOff(options.disabled),
  }, options.icon && icon(options.icon, iconSize), label && h('span.btn-label', {}, label));
}
/** A control off for a reason says it, as its title and description. */
export const whyOff = (disabled: unknown) => (typeof disabled === 'string' ? { title: disabled, 'aria-description': disabled } : {});


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

/** The character offset in `text`'s whole text of the place (node, offset) inside it. */
const offsetOf = (text: Element, node: Node, offset: number) => {
  const before = document.createRange();
  before.selectNodeContents(text); before.setEnd(node, offset);
  return before.toString().length;
};
/** The character offset in `text`'s whole text of the point (x, y), as a caret would go there; undefined off the text. */
export function offsetIn(text: Element, x: number, y: number): number | undefined {
  const at = document.caretRangeFromPoint(x, y);
  return at && text.contains(at.startContainer) ? offsetOf(text, at.startContainer, at.startOffset) : undefined;
}
/** Selects `text`'s characters from `anchor` to `focus` (a focus before the anchor selects backwards). */
function selectIn(text: Element, anchor: number, focus: number) {
  const place = (at: number): [Node, number] => {
    const walk = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) { const length = node.textContent!.length; if (at <= length) return [node, at]; at -= length; }
    return [text, text.childNodes.length];
  };
  getSelection()?.setBaseAndExtent(...place(anchor), ...place(focus));
}

/** A press of the main button on a control a redraw may replace, from the press to its release (keepClicksAcrossRedraws). */
interface Press { control: Element; id: string; says: string | null; where: string; pointer: number; disabled: boolean; at?: number; dragged: boolean }
let pressed: Press | undefined;
/** A text's release whose own click is still to come, in the same task (the Mac measured it): was it a drag (pressWasDrag). */
let released: { id: string; drag: boolean } | undefined;
/** What a control says: a text (a `pre` with an id) its whole text, a button its `aria-checked`. */
const says = (control: Element) => (control.matches('pre') ? control.textContent : control.getAttribute('aria-checked'));
/**
 * Click or drag, for a press on a text: a click only when released on the character it pressed, never having moved off it, and
 * with Shift not held (Shift extends a selection), as the browser selects. Anything else is a drag. `releasedAt`: where the
 * release landed in the text now there (undefined off it).
 */
const isDrag = (press: Press, releasedAt: number | undefined) => press.dragged || releasedAt !== press.at;

/**
 * A press and its release count as one click even when a redraw replaced the pressed control between them (every redraw rebuilds
 * the page). The browser then sends no click at all, to the replaced control or the new one, so the release here is the only path
 * (measured on the Mac: judges/gesture-builder-report.md in the plan folder). The controls are a button with an id and a text (a
 * `pre` with an id: a card's shown text, whose click opens its editor at the character clicked, the log's lines, a file's
 * contents). The press notes the control's id, what it says (`says`), `where` it is (renderer.ts gives the page's place and the
 * home) and on a text the character it landed on. At the release, by the pointer and the main button that pressed, the record
 * ends, and if the pressed control is gone, the one now there with the same id, saying the same in the same place and not
 * disabled, takes its place: a button is clicked, at the release's point, when the release lands on it; a text is clicked when
 * the press was a click (isDrag), or else gets the drag's selection, from the press to the release, or none when the release is
 * off it. When no such control is there, a text's selection is cleared. A text still there keeps whether its press was a drag
 * for its own click, which comes next (pressWasDrag). A window that loses the focus keeps the record: on the Mac's four-window
 * run another window takes the focus in the middle of presses, and the release still comes here.
 */
export function keepClicksAcrossRedraws(where: () => string): void {
  const nowThere = (press: Press) => {
    if (press.control.isConnected) return press.control;
    const now = document.getElementById(press.id);
    return now && !press.disabled && !now.matches(':disabled') && says(now) === press.says && where() === press.where ? now : null;
  };
  document.addEventListener('pointerdown', event => {
    const control = event.button === 0 ? (event.target as Element | null)?.closest?.('button[id], pre[id]') : null;
    const at = control?.matches('pre') ? offsetIn(control, event.clientX, event.clientY) : undefined;
    released = undefined;
    pressed = control ? { control, id: control.id, says: says(control), where: where(), pointer: event.pointerId, disabled: control.matches(':disabled'), at, dragged: event.shiftKey } : undefined;
  }, true);
  document.addEventListener('pointermove', event => {
    const text = pressed?.at !== undefined && event.pointerId === pressed.pointer && event.buttons & 1 ? nowThere(pressed) : null;
    if (pressed && text && offsetIn(text, event.clientX, event.clientY) !== pressed.at) pressed.dragged = true;
  }, true);
  document.addEventListener('pointercancel', () => { pressed = released = undefined; }, true);
  document.addEventListener('pointerup', event => {
    const was = pressed;
    if (!was || event.pointerId !== was.pointer || event.button !== 0) return;
    pressed = undefined;
    const now = nowThere(was), text = was.at !== undefined, at = text && now ? offsetIn(now, event.clientX, event.clientY) : undefined;
    if (now === was.control) { if (text) released = { id: was.id, drag: isDrag(was, at) }; return; }
    if (!now) { if (text) getSelection()?.removeAllRanges(); return; }
    const click = () => now.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }));
    if (!text) { if (now.contains(event.target as Node)) click(); }
    else if (!isDrag(was, at)) click();
    else if (at === undefined) getSelection()?.removeAllRanges();
    else selectIn(now, was.at!, at);
  }, true);
  // The release's own click has been heard by its text: what the release kept for it ends here.
  window.addEventListener('click', () => { released = undefined; });
}
/** Whether the press on `text` was a drag (keepClicksAcrossRedraws isDrag): every click on a text asks it before acting. */
export const pressWasDrag = (text: Element): boolean => released?.id === text.id && released.drag;

/**
 * A redraw keeps what is selected, as it keeps the scroll places and the focus (renderer.ts render), and is the one place that
 * does: the focused text field's caret, selection and own scroll (both ways), when the field is drawn again holding the same
 * value; else a selection inside one text (a `pre` with an id), its direction kept, when that text is drawn again the same.
 * Returns what puts it back, which neither focuses nor scrolls the page.
 */
export function keepSelection(): () => void {
  const field = document.activeElement;
  if ((field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) && field.id && typeof field.selectionStart === 'number') {
    const { id, value, selectionStart, selectionEnd, selectionDirection, scrollTop, scrollLeft } = field;
    return () => {
      const again = document.getElementById(id);
      if (!(again instanceof HTMLTextAreaElement || again instanceof HTMLInputElement) || again.value !== value) return;
      again.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
      again.scrollTop = scrollTop; again.scrollLeft = scrollLeft;
    };
  }
  const chosen = getSelection(), holder = (node: Node | null | undefined) => (node instanceof Element ? node : node?.parentElement)?.closest('pre[id]');
  const text = holder(chosen?.anchorNode);
  if (!chosen || chosen.isCollapsed || !text || holder(chosen.focusNode) !== text) return () => {};
  const { id, textContent: words } = text, anchor = offsetOf(text, chosen.anchorNode!, chosen.anchorOffset), focus = offsetOf(text, chosen.focusNode!, chosen.focusOffset);
  return () => { const again = document.getElementById(id); if (again?.matches('pre') && again.textContent === words) selectIn(again, anchor, focus); };
}

/**
 * An on/off switch; its label is also its tooltip. `mixed`: neither, drawn in between (its knob in the middle); a click turns
 * it on. `attrs` adds to or replaces its attributes (Settings ties it to its row's hint).
 */
export function toggle({ on, mixed = false, partial = false, label, onchange, disabled = false, id, attrs = {} }: { on: boolean; mixed?: boolean; partial?: boolean; label: string; onchange: (on: boolean) => void; disabled?: boolean | string; id?: string; attrs?: Props }) {
  return h(`button.switch${partial ? '.switch-partial' : ''}`, { type: 'button', id, role: 'switch', 'aria-checked': mixed ? 'mixed' : String(on), 'aria-label': label, title: label, disabled: !!disabled, ...attrs, ...whyOff(disabled), onclick: (event: Event) => { event.stopPropagation(); onchange(mixed || !on); } },
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

/** What a crowded bar gives up, in order, until it fits: some padding, then button labels, then its single line. */
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
