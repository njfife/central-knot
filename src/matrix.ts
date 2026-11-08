// The Overview table in design preview. Status says whether Central Knot manages a skill; each tool's
// cell says what that tool has. Changes collect until Apply.
import { rerender, announce } from './app.ts';
import { button, h, hiddenText, icon } from './dom.ts';
import { brands, type IconName } from './icons.ts';
import { applied, cellOf, sample, syncOf, tools, type Cell, type SampleSkill, type Sync } from './design.ts';
import type { HarnessId } from './types.ts';

const names: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI' };
type Filter = 'all' | 'managed' | 'unmanaged' | 'attention';

const view = {
  committed: sample.map(skill => ({ ...skill })),
  draft: new Map<string, { managed: boolean; off: HarnessId[] }>(),
  selected: new Set<string>(),
  filter: 'all' as Filter,
  find: '',
};

const effective = (skill: SampleSkill): SampleSkill => ({ ...skill, ...view.draft.get(skill.key) });
const rows = () => view.committed.map(effective);
const changed = (key: string) => view.draft.has(key);

function edit(key: string, change: (skill: SampleSkill) => { managed: boolean; off: HarnessId[] }) {
  const base = view.committed.find(skill => skill.key === key)!;
  const next = change(effective(base));
  const same = next.managed === base.managed && [...next.off].sort().join() === [...base.off].sort().join();
  if (same) view.draft.delete(key); else view.draft.set(key, next);
  announce(view.draft.size ? `${view.draft.size} ${view.draft.size === 1 ? 'change' : 'changes'} not applied yet.` : 'No changes.');
}

const setManaged = (keys: string[], managed: boolean) => { for (const key of keys) edit(key, skill => ({ managed, off: skill.off })); rerender(); };
function setTool(keys: string[], tool: HarnessId, on: boolean) {
  for (const key of keys) edit(key, skill => ({ managed: on ? true : skill.managed, off: on ? skill.off.filter(entry => entry !== tool) : [...new Set([...skill.off, tool])] }));
  rerender();
}

function apply() {
  const count = view.draft.size;
  view.committed = view.committed.map(skill => applied(effective(skill)));
  view.draft.clear();
  announce(`${count} ${count === 1 ? 'change' : 'changes'} applied.`);
  rerender();
}

// ---------- Visual vocabulary ----------

/** A cell is a toggle. Filled means syncing to that tool is on, and its tint says how far that got.
 * Outlined means off. Green = synced, blue = waits for Apply, amber = copies differ. */
const cellLook: Record<Cell, { glyph?: IconName; tone: string; label: string; box: boolean }> = {
  synced: { glyph: 'check', tone: 'cell-synced', label: 'Synced', box: true },
  'will-sync': { glyph: 'check', tone: 'cell-pending', label: 'Syncs on Apply', box: true },
  differs: { glyph: 'diff', tone: 'cell-differs', label: 'Different copy', box: true },
  off: { tone: 'cell-present', label: 'Has it, not synced', box: true },
  present: { glyph: 'circle', tone: 'cell-present', label: 'Has a copy, not synced', box: true },
  'present-differs': { glyph: 'diff', tone: 'cell-differs', label: 'Different copy, not synced', box: true },
  absent: { tone: 'cell-absent', label: 'No copy', box: true },
  cannot: { tone: 'cell-cannot', label: 'Cannot load it', box: false },
};

export function brandMark(tool: HarnessId, size = 16) {
  const holder = document.createElement('template');
  const brand = brands[tool];
  holder.innerHTML = `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="${brand.color}"><path d="${brand.path}"/></svg>`;
  return holder.content.firstElementChild as SVGElement;
}

function toggle(on: boolean, label: string, onchange: (on: boolean) => void) {
  return h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, title: label, onclick: (event: Event) => { event.stopPropagation(); onchange(!on); } },
    h('span.switch-knob'));
}

function selectBox(checked: boolean | 'mixed', label: string, onchange: (on: boolean) => void) {
  const glyph: IconName = checked === 'mixed' ? 'square-minus' : checked ? 'square-check' : 'square';
  return h('button.select-box', { type: 'button', role: 'checkbox', 'aria-checked': String(checked), 'aria-label': label, onclick: (event: Event) => { event.stopPropagation(); onchange(checked !== true); } },
    icon(glyph, 16, checked ? 'tone-accent' : 'tone-faint'));
}

// ---------- Parts ----------

function counts(list: SampleSkill[]) {
  return {
    all: list.length,
    managed: list.filter(skill => skill.managed).length,
    unmanaged: list.filter(skill => !skill.managed).length,
    attention: list.filter(skill => syncOf(skill) === 'attention').length,
  };
}

function filterBar(list: SampleSkill[]) {
  const total = counts(view.committed);
  void list;
  const chip = (id: Filter, label: string, count: number, warn = false) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn ? '.chip-warn' : ''}`, { type: 'button', 'aria-pressed': String(view.filter === id), 'aria-label': `${label}, ${count}`, onclick: () => { view.filter = id; rerender(); } },
    label, warn ? h('span.chip-count', {}, String(count)) : null);
  return h('div.chips', { role: 'group', 'aria-label': 'Show' },
    chip('all', 'All', total.all), chip('managed', 'Managed', total.managed), chip('unmanaged', 'Not managed', total.unmanaged),
    total.attention ? chip('attention', 'Needs attention', total.attention, true) : null);
}

function bulkBar(keys: string[]) {
  const picked = rows().filter(skill => keys.includes(skill.key));
  const managed = picked.filter(skill => skill.managed).length;
  const stateOf = (tool: HarnessId): boolean | 'mixed' => {
    const on = picked.filter(skill => skill.managed && !skill.off.includes(tool)).length;
    return on === 0 ? false : on === picked.length ? true : 'mixed';
  };
  return h('div.bulk', { role: 'toolbar', 'aria-label': `${keys.length} selected` },
    h('strong.bulk-count', {}, `${keys.length} selected`),
    managed < picked.length && button({ variant: 'outline', size: 'small', label: 'Manage', id: 'bulk-manage', onclick: () => setManaged(keys, true) }),
    managed > 0 && button({ variant: 'outline', size: 'small', label: 'Stop managing', id: 'bulk-unmanage', onclick: () => setManaged(keys, false) }),
    h('span.bulk-divider', { 'aria-hidden': 'true' }),
    h('span.bulk-label', {}, 'Sync to'),
    tools.map(tool => {
      const state = stateOf(tool);
      const said = state === true ? `All selected sync to ${names[tool]}. Click to stop.` : state === 'mixed' ? `Some selected sync to ${names[tool]}. Click to sync all.` : `None of the selected sync to ${names[tool]}. Click to sync all.`;
      return h('button.bulk-tool', { type: 'button', role: 'checkbox', 'aria-checked': String(state), 'aria-label': said, title: said, id: `bulk-${tool}`, onclick: () => setTool(keys, tool, state !== true) },
        brandMark(tool, 14),
        h(`span.legend-cell.bulk-cell${state === true ? '.cell-synced.cell-on' : state === 'mixed' ? '.cell-mixed.cell-synced' : ''}`, { 'aria-hidden': 'true' }, state === true ? icon('check', 14) : state === 'mixed' ? icon('minus', 14) : null));
    }),
    button({ variant: 'ghost', size: 'small', icon: 'x', name: 'Clear selection', id: 'bulk-clear', onclick: () => { view.selected.clear(); rerender(); } }));
}

function changeBar(list: SampleSkill[], shown: SampleSkill[]) {
  const count = view.draft.size;
  const waiting = pendingSyncs(view.committed);
  if (count) return h('div.apply', {},
    h('span.apply-count.apply-quiet', {}, `${count} ${count === 1 ? 'change' : 'changes'}`),
    button({ variant: 'outline', size: 'small', label: 'Discard', id: 'discard', onclick: () => { view.draft.clear(); announce('Changes discarded.'); rerender(); } }),
    button({ variant: 'primary', size: 'small', label: 'Apply', id: 'apply', onclick: apply }));
  const hidden = waiting - pendingSyncs(view.committed.filter(skill => shown.some(entry => entry.key === skill.key)));
  if (waiting) return h('div.apply', {},
    h('span.apply-count.apply-quiet', {}, `${waiting} to sync`, hidden ? h('span.apply-hidden', {}, ` · ${hidden} not shown`) : null),
    button({ variant: 'primary', size: 'small', label: 'Apply', id: 'apply', onclick: apply }));
  void list;
  return h('span.apply-state', {}, icon('check', 14, 'tone-success'), 'Up to date');
}

function cell(skill: SampleSkill, tool: HarnessId) {
  const base = view.committed.find(entry => entry.key === skill.key)!;
  const state = cellOf(skill, tool);
  const on = skill.managed && !skill.off.includes(tool);
  const wasOn = base.managed && !base.off.includes(tool);
  const pending = state !== cellOf(base, tool) || on !== wasOn;
  // Green means applied. Anything turned on but not applied yet is blue: a check if the copy is there, an arrow if one must be written.
  const look = pending && state === 'synced' ? cellLook['will-sync'] : cellLook[state];
  const usable = state !== 'cannot';
  const action = !usable ? '' : on ? `Stop syncing to ${names[tool]}` : `Sync to ${names[tool]}`;
  const text = skill.cannot?.[tool] ?? `${names[tool]}: ${look.label}${pending ? ' (not applied yet)' : ''}`;
  return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
    h(`button.cell-button.${look.tone}${on ? '.cell-on' : ''}${look.box ? '' : '.cell-bare'}${pending ? '.cell-pending-edit' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), title: action ? `${text}. Click to ${action.charAt(0).toLowerCase()}${action.slice(1)}.` : text, 'aria-label': `${text}${action ? `. ${action}` : ''}`, disabled: !usable, 'data-state': state,
      onclick: (event: Event) => { event.stopPropagation(); setTool([skill.key], tool, !on); } },
      look.glyph ? icon(look.glyph, state === 'present' ? 13 : 16, state === 'present' ? 'ring-strong' : '') : null));
}

function row(skill: SampleSkill) {
  const picked = view.selected.has(skill.key);
  const attention = syncOf(skill) === 'attention';
  return h(`div.ov-row${view.selected.size ? '.selecting' : ''}${picked ? '.picked' : ''}${changed(skill.key) ? '.changed' : ''}${skill.managed ? '' : '.unmanaged'}`, { role: 'row', 'data-key': skill.key },
    h('div.ov-select', { role: 'cell' }, selectBox(picked, `Select ${skill.key}`, on => { if (on) view.selected.add(skill.key); else view.selected.delete(skill.key); rerender(); })),
    h('div.ov-name', { role: 'cell', title: skill.description },
      h('span.ov-name-text', {}, skill.key),
      attention && h('span.attention-dot', { title: 'Copies differ: needs a decision' }, hiddenText('Copies differ: needs a decision'))),
    h(`div.ov-managed${skill.managed !== view.committed.find(entry => entry.key === skill.key)!.managed ? '.managed-pending' : ''}`, { role: 'cell' }, toggle(skill.managed, `Manage ${skill.key}`, on => setManaged([skill.key], on))),
    tools.map(tool => cell(skill, tool)),
    h('div.ov-fill'));
}

function legend() {
  const swatch = (state: Cell, on: boolean) => {
    const look = cellLook[state];
    return h(`span.legend-cell.${look.tone}${on ? '.cell-on' : ''}`, { 'aria-hidden': 'true' }, look.glyph ? icon(look.glyph, state === 'present' ? 10 : 12, state === 'present' ? 'ring-strong' : '') : null);
  };
  const entry = (label: string, ...swatches: HTMLElement[]) => h('span.legend-item', {}, ...swatches, label);
  return h('div.legend', { 'aria-label': 'Key' },
    h('span.legend-rule', {}, h('span.legend-cell.cell-synced.cell-on', { 'aria-hidden': 'true' }), 'Filled: syncing on', h('span.legend-cell', { 'aria-hidden': 'true' }), 'Outlined: off'),
    entry('Synced', swatch('synced', true)),
    entry('Syncs on Apply', swatch('will-sync', true)),
    entry('Copies differ', swatch('differs', true)),
    entry('Has a copy', swatch('present', false)),
    entry('No copy', swatch('absent', false)),
    entry('Can’t load it', swatch('cannot', false)));
}

const pendingSyncs = (list: SampleSkill[]) => list.filter(skill => tools.some(tool => cellOf(skill, tool) === 'will-sync')).length;

function section(label: string, list: SampleSkill[], after: number) {
  if (!list.length) return null;
  const keys = list.map(skill => skill.key);
  const picked = keys.filter(key => view.selected.has(key)).length;
  const state: boolean | 'mixed' = picked === 0 ? false : picked === keys.length ? true : 'mixed';
  return h('div', { role: 'rowgroup' },
    h('div.ov-section', { role: 'row' },
      h('div.ov-select', { role: 'cell' }, selectBox(state, `Select all ${label.toLowerCase()}`, on => { for (const key of keys) if (on) view.selected.add(key); else view.selected.delete(key); rerender(); })),
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(list.length)),
        after !== list.length ? h('span.ov-section-after', { title: 'After Apply' }, icon('arrow-right', 12), String(after)) : null)),
    [...list].sort((first, second) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, ''))).map(row));
}

export function designOverview() {
  const all = rows();
  const needle = view.find.trim().toLowerCase();
  const committedOf = (skill: SampleSkill) => view.committed.find(entry => entry.key === skill.key)!;
  const shown = all.filter(skill => (view.filter === 'all' || (view.filter === 'managed' ? committedOf(skill).managed : view.filter === 'unmanaged' ? !committedOf(skill).managed : syncOf(skill) === 'attention'))
    && (!needle || skill.key.includes(needle) || skill.description.toLowerCase().includes(needle)));
  // Rows stay where they were until Apply; a group header shows its size after Apply when that differs.
  const wasManaged = (skill: SampleSkill) => view.committed.find(entry => entry.key === skill.key)!.managed;
  const keys = [...view.selected].filter(key => shown.some(skill => skill.key === key));
  const find = h('input.find-input', { id: 'find', type: 'text', placeholder: 'Find', 'aria-label': 'Find', value: view.find, spellcheck: 'false',
    oninput: (event: Event) => { view.find = (event.target as HTMLInputElement).value; rerender(); document.getElementById('find')?.focus(); } });
  return h('div.page.ov-page', {},
    h('div.toolbar', {},
      h('div.find', {}, icon('search', 16, 'find-glyph'), find),
      keys.length ? bulkBar(keys) : filterBar(all),
      h('div.toolbar-end', {}, changeBar(all, shown))),
    h('div.scroll.matrix', {},
      h('div.ov', { role: 'table', 'aria-label': 'Skills and where they are synced' },
        h('div.ov-row.ov-head', { role: 'row' },
          h('div.ov-select', { role: 'columnheader' }),
          h('div.ov-name', { role: 'columnheader' }, 'Skill'),
          h('div.ov-managed', { role: 'columnheader' }, 'Managed'),
          tools.map(tool => h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool]))),
          h('div.ov-fill')),
        section('Managed', shown.filter(wasManaged), shown.filter(skill => skill.managed).length),
        section('Not managed', shown.filter(skill => !wasManaged(skill)), shown.filter(skill => !skill.managed).length)),
      legend()));
}
