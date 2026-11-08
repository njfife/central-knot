// The Overview table in design preview: three layout options with no row checkboxes.
// Managed says whether Central Knot keeps a skill in sync; each tool's cell says what that tool has.
// Changes collect until "Apply all".
import { rerender, announce } from './app.ts';
import { button, h, hiddenText, icon } from './dom.ts';
import { brands, type IconName } from './icons.ts';
import { applied, cellOf, sample, syncOf, tools, variant, type Cell, type SampleSkill } from './design.ts';
import type { HarnessId } from './types.ts';

const names: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI' };
const other = (tool: HarnessId) => tools.find(entry => entry !== tool)!;
type Filter = 'all' | 'managed' | 'unmanaged' | 'attention';
type Resolution = HarnessId | 'separate';
interface Draft { managed: boolean; off: HarnessId[]; resolve?: Resolution }

const view = {
  committed: sample.map(skill => ({ ...skill })),
  draft: new Map<string, Draft>(),
  filter: 'all' as Filter,
  find: '',
  /** The skill whose differing copies are open for comparison. */
  comparing: undefined as string | undefined,
};

const committedOf = (key: string) => view.committed.find(skill => skill.key === key)!;

/** A skill as it will be after Apply all. */
function effective(skill: SampleSkill): SampleSkill {
  const draft = view.draft.get(skill.key);
  if (!draft) return skill;
  const next: SampleSkill = { ...skill, managed: draft.managed, off: draft.off };
  if (draft.resolve === 'separate') next.separate = true;
  else if (draft.resolve) {
    const id = skill.copies[draft.resolve]!;
    next.copies = Object.fromEntries(Object.keys(skill.copies).map(tool => [tool, id]));
  }
  return next;
}

const rows = () => view.committed.map(effective);

function edit(key: string, change: (skill: SampleSkill, draft?: Draft) => Draft) {
  const base = committedOf(key);
  const next = change(effective(base), view.draft.get(key));
  const same = !next.resolve && next.managed === base.managed && [...next.off].sort().join() === [...base.off].sort().join();
  if (same) view.draft.delete(key); else view.draft.set(key, next);
  announce(view.draft.size ? `${view.draft.size} ${view.draft.size === 1 ? 'change' : 'changes'} not applied yet.` : 'No changes.');
}

function setManaged(keys: string[], managed: boolean) {
  for (const key of keys) edit(key, (skill, draft) => ({ managed, off: skill.off, resolve: draft?.resolve }));
  rerender();
}

function setTool(keys: string[], tool: HarnessId, on: boolean) {
  for (const key of keys) edit(key, (skill, draft) => ({ managed: on ? true : skill.managed, off: on ? skill.off.filter(entry => entry !== tool) : [...new Set([...skill.off, tool])], resolve: draft?.resolve }));
  rerender();
}

function resolve(key: string, choice: Resolution | undefined) {
  edit(key, (skill, draft) => ({ managed: choice === 'separate' ? false : choice ? true : committedOf(key).managed, off: draft?.off ?? skill.off, resolve: choice }));
  view.comparing = undefined;
  rerender();
}

function applyAll() {
  const count = view.draft.size;
  view.committed = view.committed.map(skill => applied(effective(skill)));
  view.draft.clear();
  announce(`${count} ${count === 1 ? 'change' : 'changes'} applied.`);
  rerender();
}

// ---------- Visual vocabulary ----------

const cellLook: Record<Cell, { glyph?: IconName; tone: string; label: string }> = {
  synced: { glyph: 'check', tone: 'cell-synced', label: 'Synced' },
  'will-sync': { glyph: 'check', tone: 'cell-pending', label: 'Syncs on Apply all' },
  differs: { glyph: 'diff', tone: 'cell-differs', label: 'Copies differ' },
  off: { tone: 'cell-present', label: 'Has a copy, not synced' },
  present: { glyph: 'circle', tone: 'cell-present', label: 'Has a copy, not synced' },
  'present-differs': { glyph: 'diff', tone: 'cell-differs', label: 'Copies differ' },
  absent: { tone: 'cell-absent', label: 'No copy' },
  cannot: { tone: 'cell-cannot', label: 'Cannot load it' },
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

const smallAction = (label: string, id: string, onclick: () => void, extra = '') =>
  h(`button.text-action${extra}`, { type: 'button', id, onclick: (event: Event) => { event.stopPropagation(); onclick(); } }, label);

// ---------- Parts every option shares ----------

function filterBar() {
  const list = view.committed;
  const attention = list.filter(skill => syncOf(effective(skill)) === 'attention').length;
  const chip = (id: Filter, label: string, warn?: number) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn ? '.chip-warn' : ''}`, { type: 'button', 'aria-pressed': String(view.filter === id), onclick: () => { view.filter = id; rerender(); } },
    label, warn ? h('span.chip-count', {}, String(warn)) : null);
  return h('div.chips', { role: 'group', 'aria-label': 'Show' },
    chip('all', 'All'), chip('managed', 'Managed'), chip('unmanaged', 'Unmanaged'), attention ? chip('attention', 'Copies differ', attention) : null);
}

const pendingSyncs = (list: SampleSkill[]) => list.filter(skill => tools.some(tool => cellOf(skill, tool) === 'will-sync')).length;
const manageable = () => view.committed.filter(skill => !effective(skill).managed && !effective(skill).separate && syncOf(effective(skill)) !== 'attention');

function changeBar() {
  const count = view.draft.size;
  const waiting = pendingSyncs(view.committed);
  const ready = manageable();
  const manageAll = variant !== 'c' && ready.length ? button({ variant: 'outline', size: 'small', label: 'Manage all', name: `Manage all ${ready.length} unmanaged skills`, id: 'manage-all', onclick: () => setManaged(ready.map(skill => skill.key), true) }) : null;
  if (count) return h('div.apply', {}, manageAll,
    h('span.apply-count.apply-quiet', {}, `${count} ${count === 1 ? 'change' : 'changes'}`),
    button({ variant: 'ghost', size: 'small', label: 'Discard', id: 'discard', onclick: () => { view.draft.clear(); announce('Changes discarded.'); rerender(); } }),
    button({ variant: 'primary', size: 'small', label: 'Apply all', id: 'apply', onclick: applyAll }));
  if (waiting) return h('div.apply', {}, manageAll, h('span.apply-count.apply-quiet', {}, `${waiting} to sync`), button({ variant: 'primary', size: 'small', label: 'Apply all', id: 'apply', onclick: applyAll }));
  if (manageAll) return h('div.apply', {}, manageAll);
  return h('span.apply-state', {}, icon('check', 14, 'tone-success'), 'Up to date');
}

function cell(skill: SampleSkill, tool: HarnessId) {
  const base = committedOf(skill.key);
  const state = cellOf(skill, tool);
  const on = skill.managed && !skill.off.includes(tool);
  const wasOn = base.managed && !base.off.includes(tool);
  const pending = state !== 'cannot' && (state !== cellOf(base, tool) || on !== wasOn);
  const look = pending && state === 'synced' ? cellLook['will-sync'] : cellLook[state];
  const differs = state === 'differs' || state === 'present-differs';
  // A cell whose copies differ opens the comparison instead of toggling: a decision comes first.
  const action = state === 'cannot' ? '' : differs ? 'Compare the copies' : on ? `Stop syncing to ${names[tool]}` : `Sync to ${names[tool]}`;
  const text = skill.cannot?.[tool] ?? `${names[tool]}: ${look.label}${pending ? ' (not applied yet)' : ''}`;
  return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
    h(`button.cell-button.${look.tone}${on ? '.cell-on' : ''}${pending ? '.cell-pending-edit' : ''}`, { type: 'button', title: action ? `${text}. Click to ${action.charAt(0).toLowerCase()}${action.slice(1)}.` : text, 'aria-label': `${text}${action ? `. ${action}` : ''}`, disabled: state === 'cannot', 'data-state': state,
      onclick: (event: Event) => { event.stopPropagation(); if (differs) { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); } else setTool([skill.key], tool, !on); } },
      look.glyph ? icon(look.glyph, state === 'present' ? 13 : 16, state === 'present' ? 'ring-strong' : '') : null));
}

/** The decision for differing copies, opened in place under the row. */
function compare(skill: SampleSkill) {
  const versions = skill.versions ?? {};
  const choice = (tool: HarnessId) => {
    const version = versions[tool];
    return h('button.version', { type: 'button', id: `use-${skill.key}-${tool}`, onclick: () => resolve(skill.key, tool) },
      h('span.version-head', {}, brandMark(tool, 14), h('strong', {}, `Use ${names[tool]}'s copy`)),
      version ? h('span.version-meta', {}, `${version.lines} · ${version.changed}`) : null,
      version ? h('span.version-text', {}, `“${version.text}”`) : null,
      h('span.version-effect', {}, `Replaces the copy in ${names[other(tool)]} on Apply all`));
  };
  return h('div.compare', { role: 'region', 'aria-label': `Copies of ${skill.key} differ` },
    h('p.compare-title', {}, icon('diff', 14, 'tone-warning'), `The two copies of ${skill.key} differ. Which one should both tools use?`),
    h('div.compare-choices', {}, tools.map(choice),
      h('button.version.version-quiet', { type: 'button', id: `separate-${skill.key}`, onclick: () => resolve(skill.key, 'separate') },
        h('span.version-head', {}, h('strong', {}, 'Keep both as they are')),
        h('span.version-effect', {}, 'Each tool keeps its own copy; Central Knot leaves this skill unmanaged'))),
    h('div.compare-foot', {}, smallAction('Close', `close-${skill.key}`, () => { view.comparing = undefined; rerender(); })));
}

function row(skill: SampleSkill) {
  const draft = view.draft.get(skill.key);
  const attention = syncOf(skill) === 'attention';
  const decided = draft?.resolve;
  return [
    h(`div.ov-row${draft ? '.changed' : ''}${skill.managed ? '' : '.unmanaged'}`, { role: 'row', 'data-key': skill.key },
      h('div.ov-name', { role: 'cell', title: skill.description },
        h('span.ov-name-text', {}, skill.key),
        attention ? smallAction('Copies differ', `decide-${skill.key}`, () => { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); }, '.decide') : null,
        decided ? h('span.decided', {}, decided === 'separate' ? 'Keeping both' : `Using ${names[decided]}`, smallAction('Undo', `undo-${skill.key}`, () => resolve(skill.key, undefined))) : null),
      h(`div.ov-managed${draft && skill.managed !== committedOf(skill.key).managed ? '.managed-pending' : ''}`, { role: 'cell' }, toggle(skill.managed, `Manage ${skill.key}`, on => setManaged([skill.key], on))),
      tools.map(tool => cell(skill, tool)),
      h('div.ov-fill')),
    view.comparing === skill.key ? compare(skill) : null,
  ];
}

function legend() {
  const swatch = (state: Cell, on: boolean) => h(`span.legend-cell.${cellLook[state].tone}${on ? '.cell-on' : ''}`, { 'aria-hidden': 'true' }, cellLook[state].glyph ? icon(cellLook[state].glyph!, state === 'present' ? 10 : 12, state === 'present' ? 'ring-strong' : '') : null);
  const entry = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  return h('div.legend', { 'aria-label': 'Key' },
    h('span.legend-rule', {}, h('span.legend-cell.cell-synced.cell-on', { 'aria-hidden': 'true' }), 'Filled: syncing on'),
    entry('Synced', swatch('synced', true)), entry('Syncs on Apply all', swatch('will-sync', true)), entry('Copies differ', swatch('differs', true)),
    entry('Has a copy', swatch('present', false)), entry('No copy', swatch('absent', false)), entry('Can’t load it', swatch('cannot', false)));
}

// ---------- What differs between the options ----------

/** Skills one tool has and the other lacks (or does not sync), ready to send across. */
const sendable = (from: HarnessId, to: HarnessId, list: SampleSkill[]) => list.filter(skill => {
  const now = effective(skill);
  return now.copies[from] !== undefined && !now.cannot?.[to] && syncOf(now) !== 'attention' && !now.separate && !(now.managed && !now.off.includes(to) && now.copies[to] !== undefined) && !(now.managed && !now.off.includes(to));
});
const send = (from: HarnessId, to: HarnessId, list: SampleSkill[]) => {
  const keys = sendable(from, to, list).map(skill => skill.key);
  for (const key of keys) edit(key, (skill, draft) => ({ managed: true, off: skill.off.filter(entry => entry !== to), resolve: draft?.resolve }));
  rerender();
};

/** Option A: the actions sit in the headers. A tool's header adds everything the other tool has; a group header manages the group. */
function toolHead(tool: HarnessId, list: SampleSkill[]) {
  const count = sendable(other(tool), tool, list).length;
  return h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool]),
    variant === 'a' ? h('button.head-action', { type: 'button', id: `fill-${tool}`, disabled: !count, title: count ? `Use all ${count} ${names[other(tool)]} skills in ${names[tool]}` : `${names[tool]} already has everything ${names[other(tool)]} has`, onclick: () => send(other(tool), tool, list) },
      icon('arrow-down', 12), count ? `Add ${count}` : 'All here') : null);
}

/** Option B: one band that says what each tool is missing from the other, with one button each way. */
function directionBand(list: SampleSkill[]) {
  const lane = (from: HarnessId, to: HarnessId) => {
    const count = sendable(from, to, list).length;
    return h('div.lane', {},
      brandMark(from, 16), h('span.lane-name', {}, names[from]), icon('arrow-right', 14, 'tone-muted'), brandMark(to, 16), h('span.lane-name', {}, names[to]),
      h('span.lane-count', {}, count ? `${count} ${count === 1 ? 'skill' : 'skills'} to add` : 'Nothing to add'),
      button({ variant: 'outline', size: 'small', label: `Use all in ${names[to]}`, id: `lane-${to}`, disabled: !count, onclick: () => send(from, to, list) }));
  };
  return h('div.band-lanes', {}, lane('claude-cli', 'copilot-cli'), lane('copilot-cli', 'claude-cli'));
}

/** Option C: whatever the filter or search shows is the set the actions apply to. */
function shownStrip(shown: SampleSkill[]) {
  const unmanaged = shown.filter(skill => !skill.managed && !skill.separate && syncOf(skill) !== 'attention');
  const managed = shown.filter(skill => skill.managed);
  return h('div.shown-strip', {},
    h('strong', {}, view.find || view.filter !== 'all' ? `${shown.length} shown` : `All ${shown.length}`),
    button({ variant: 'outline', size: 'small', label: unmanaged.length ? `Manage ${unmanaged.length}` : 'Manage', id: 'shown-manage', disabled: !unmanaged.length, onclick: () => setManaged(unmanaged.map(skill => skill.key), true) }),
    button({ variant: 'ghost', size: 'small', label: managed.length ? `Unmanage ${managed.length}` : 'Unmanage', id: 'shown-unmanage', disabled: !managed.length, onclick: () => setManaged(managed.map(skill => skill.key), false) }),
    h('span.bulk-divider', { 'aria-hidden': 'true' }),
    tools.map(tool => {
      const count = sendable(other(tool), tool, shown).length;
      return button({ variant: 'ghost', size: 'small', label: count ? `Use ${count} in ${names[tool]}` : `All in ${names[tool]}`, id: `shown-${tool}`, disabled: !count, onclick: () => send(other(tool), tool, shown) });
    }));
}

function section(label: string, list: SampleSkill[], after: number) {
  if (!list.length) return null;
  const sorted = [...list].sort((first, second) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, '')));
  const managing = label === 'Unmanaged';
  const target = managing ? sorted.filter(skill => !skill.managed && !skill.separate && syncOf(skill) !== 'attention') : sorted.filter(skill => skill.managed);
  return h('div', { role: 'rowgroup' },
    h('div.ov-section', { role: 'row' },
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(list.length)),
        after !== list.length ? h('span.ov-section-after', { title: 'After Apply all' }, icon('arrow-right', 12), String(after)) : null),
      variant === 'a' && target.length ? h('div.ov-section-action', {}, smallAction(managing ? `Manage all ${target.length}` : `Unmanage all ${target.length}`, `group-${managing ? 'manage' : 'unmanage'}`, () => setManaged(target.map(skill => skill.key), managing))) : null),
    sorted.flatMap(row));
}

export function designOverview() {
  const all = rows();
  const needle = view.find.trim().toLowerCase();
  const shown = all.filter(skill => (view.filter === 'all' || (view.filter === 'managed' ? committedOf(skill.key).managed : view.filter === 'unmanaged' ? !committedOf(skill.key).managed : syncOf(skill) === 'attention'))
    && (!needle || skill.key.includes(needle) || skill.description.toLowerCase().includes(needle)));
  const find = h('input.find-input', { id: 'find', type: 'text', placeholder: 'Find', 'aria-label': 'Find', value: view.find, spellcheck: 'false',
    oninput: (event: Event) => { view.find = (event.target as HTMLInputElement).value; rerender(); document.getElementById('find')?.focus(); } });
  return h('div.page.ov-page', { 'data-variant': variant },
    h('div.toolbar', {}, h('div.find', {}, icon('search', 16, 'find-glyph'), find), filterBar(), h('div.toolbar-end', {}, changeBar())),
    h('div.scroll.matrix', {},
      variant === 'b' ? directionBand(all) : null,
      variant === 'c' ? shownStrip(shown) : null,
      h('div.ov', { role: 'table', 'aria-label': 'Skills and where they sync' },
        h('div.ov-row.ov-head', { role: 'row' },
          h('div.ov-name', { role: 'columnheader' }, 'Skill'),
          h('div.ov-managed', { role: 'columnheader' }, 'Managed'),
          tools.map(tool => toolHead(tool, shown)),
          h('div.ov-fill')),
        section('Managed', shown.filter(skill => committedOf(skill.key).managed), shown.filter(skill => skill.managed).length),
        section('Unmanaged', shown.filter(skill => !committedOf(skill.key).managed), shown.filter(skill => !skill.managed).length)),
      legend()));
}

void hiddenText;
