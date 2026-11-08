// The Overview table in design preview: three layout options with no row checkboxes.
// Managed says whether Central Knot keeps a skill in sync; each tool's cell says what that tool has.
// Changes collect until "Apply all".
import { applyManage, rerender, announce, shownPath, state } from './app.ts';
import { button, emptyState, h, icon, middle } from './dom.ts';
import { brands, type IconName } from './icons.ts';
import { applied, cellOf, comparedTools, designMode, sample, syncOf, tools as sampleTools, variant, type Cell, type SampleSkill, type Tool } from './design.ts';
import type { Change, SkillFacts } from './types.ts';

const names: Record<Tool, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex' };
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? 'edited today' : days === 1 ? 'edited yesterday' : days < 14 ? `edited ${days} days ago` : days < 60 ? `edited ${Math.floor(days / 7)} weeks ago` : `edited ${Math.floor(days / 30)} months ago`;
};

/** The real home's facts in the shape the page works with. */
const fromFacts = (facts: SkillFacts): SampleSkill => ({
  key: facts.key, name: facts.name, description: facts.description, managed: facts.managed, off: facts.off, cannot: facts.cannot, held: facts.held, separate: facts.separate,
  // A tool reading two different copies has copies that differ, even if one of them matches the other tool.
  copies: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, facts.extra.some(extra => extra.tool === tool && extra.hash !== copy!.hash) ? `mixed:${tool}` : copy!.hash])),
  extra: facts.extra.map(extra => ({ tool: extra.tool, directory: extra.directory, summary: extra.summary, writable: extra.writable, same: extra.hash === facts.copies[extra.tool]?.hash })),
  paths: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.directory])),
  versions: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, { lines: `${copy!.lines} lines`, changed: ago(copy!.modified), text: copy!.summary || facts.description }])),
});

let factsCache: { from: unknown; list: SampleSkill[] } | undefined;
function committedList(): SampleSkill[] {
  if (designMode) return view.committed;
  const manage = state.home?.manage;
  if (!manage) return [];
  if (factsCache?.from !== manage) factsCache = { from: manage, list: manage.skills.map(fromFacts) };
  return factsCache.list;
}
const toolList = (): Tool[] => (designMode ? sampleTools : state.home?.manage.tools ?? []);
const other = (tool: Tool) => toolList().find(entry => entry !== tool)!;
const others = (tool: Tool) => toolList().filter(entry => entry !== tool);
type Filter = 'all' | 'managed' | 'unmanaged' | 'attention';
type Resolution = Tool | 'separate';
/** `prior` is the Managed state before a copy choice, so undoing the choice puts it back. */
interface Draft { managed: boolean; off: Tool[]; resolve?: Resolution; prior?: boolean }

const view = {
  committed: sample.map(skill => ({ ...skill })),
  draft: new Map<string, Draft>(),
  filter: 'all' as Filter,
  find: '',
  /** The skill whose details are open under its row. */
  comparing: undefined as string | undefined,
  /** The tool whose header menu is open. */
  toolMenu: undefined as Tool | undefined,
  /** What the Skills page list is narrowed to. */
  listFind: '',
};

// A click elsewhere or Escape closes a tool menu.
document.addEventListener('click', () => { if (view.toolMenu) { view.toolMenu = undefined; rerender(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && view.toolMenu) { const tool = view.toolMenu; view.toolMenu = undefined; rerender(); document.getElementById(`tool-${tool}`)?.focus(); } });

const committedOf = (key: string) => committedList().find(skill => skill.key === key)!;

/** A skill as it will be after Apply all. */
function effective(skill: SampleSkill): SampleSkill {
  const draft = view.draft.get(skill.key);
  if (!draft) return skill;
  const next: SampleSkill = { ...skill, managed: draft.managed, off: draft.off };
  if (draft.managed && draft.resolve !== 'separate') next.separate = false;
  if (draft.resolve === 'separate') next.separate = true;
  else if (draft.resolve) {
    const id = skill.copies[draft.resolve]!;
    const compared = comparedTools(next);
    next.copies = Object.fromEntries(Object.entries(skill.copies).map(([tool, copy]) => [tool, compared.includes(tool) ? id : copy]));
  }
  return next;
}

const rows = () => committedList().map(effective);

function edit(key: string, change: (skill: SampleSkill, draft?: Draft) => Draft) {
  const base = committedOf(key);
  const next = change(effective(base), view.draft.get(key));
  const same = !next.resolve && next.managed === base.managed && [...next.off].sort().join() === [...base.off].sort().join();
  if (same) view.draft.delete(key); else view.draft.set(key, next);
  announce(view.draft.size ? `${view.draft.size} ${view.draft.size === 1 ? 'change' : 'changes'} not applied yet.` : 'No changes.');
}

// Turning a skill on undoes "keep both"; turning it off drops a chosen copy. The page then shows what Apply all will do.
const keepResolve = (managed: boolean, resolve?: Resolution) => (managed ? (resolve === 'separate' ? undefined : resolve) : undefined);

const keepPrior = (resolve: Resolution | undefined, draft?: Draft) => (resolve ? draft?.prior : undefined);

function setManaged(keys: string[], managed: boolean) {
  for (const key of keys) edit(key, (skill, draft) => { const resolve = keepResolve(managed, draft?.resolve); return { managed, off: skill.off, resolve, prior: keepPrior(resolve, draft) }; });
  rerender();
}

function setTool(keys: string[], tool: Tool, on: boolean) {
  for (const key of keys) edit(key, (skill, draft) => { const managed = on ? true : skill.managed; const resolve = keepResolve(managed, draft?.resolve); return { managed, off: on ? skill.off.filter(entry => entry !== tool) : [...new Set([...skill.off, tool])], resolve, prior: keepPrior(resolve, draft) }; });
  rerender();
}

function resolve(key: string, choice: Resolution | undefined) {
  edit(key, (skill, draft) => {
    const prior = draft?.resolve ? draft.prior ?? committedOf(key).managed : skill.managed;
    const off = draft?.off ?? skill.off;
    return choice ? { managed: choice !== 'separate', off, resolve: choice, prior } : { managed: prior, off };
  });
  view.comparing = undefined;
  rerender();
}

function applyAll() {
  const count = view.draft.size;
  if (!designMode) {
    const changes = [...view.draft].map(([key, draft]) => ({ key, managed: draft.managed, off: draft.off, use: draft.resolve })) as Change[];
    void applyManage(changes, () => view.draft.clear());
    return;
  }
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

export function brandMark(tool: Tool, size = 16): Element {
  const holder = document.createElement('template');
  const brand = (brands as Record<string, { color: string; path: string } | undefined>)[tool];
  if (!brand) return h(`span.mono-mark.mono-${size}`, { 'aria-hidden': 'true' }, names[tool].slice(0, 2));
  holder.innerHTML = `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="${brand.color}"><path d="${brand.path}"/></svg>`;
  return holder.content.firstElementChild as SVGElement;
}

function toggle(on: boolean, label: string, onchange: (on: boolean) => void, disabled = false, id?: string) {
  return h('button.switch', { type: 'button', id, role: 'switch', 'aria-checked': String(on), 'aria-label': label, title: label, disabled, onclick: (event: Event) => { event.stopPropagation(); onchange(!on); } },
    h('span.switch-knob'));
}

const smallAction = (label: string, id: string, onclick: () => void, extra = '') =>
  h(`button.text-action${extra}`, { type: 'button', id, onclick: (event: Event) => { event.stopPropagation(); onclick(); } }, label);

// ---------- Parts every option shares ----------

function filterBar() {
  const list = committedList();
  const attention = list.filter(skill => syncOf(effective(skill), toolList()) === 'attention').length;
  const chip = (id: Filter, label: string, warn?: number) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn ? '.chip-warn' : ''}`, { type: 'button', 'aria-pressed': String(view.filter === id), onclick: () => { view.filter = id; rerender(); } },
    label, warn ? h('span.chip-count', {}, String(warn)) : null);
  return h('div.chips', { role: 'group', 'aria-label': 'Show' },
    chip('all', 'All'), chip('managed', 'Managed'), chip('unmanaged', 'Unmanaged'), attention ? chip('attention', 'Copies differ', attention) : null);
}

const pendingSyncs = (list: SampleSkill[]) => list.filter(skill => toolList().some(tool => cellOf(skill, tool) === 'will-sync')).length;
const manageable = () => committedList().filter(skill => !skill.held).filter(skill => !effective(skill).managed && !effective(skill).separate && syncOf(effective(skill), toolList()) !== 'attention');

const canWrite = () => designMode || (!!state.home && state.home.manage.access.allowed && state.home.manage.gate.state !== 'stopped' && !state.busy);
const resumeNeeded = () => !designMode && state.home?.manage.gate.state === 'needs-resume';

/** Pending changes and Apply all. `bulk` adds Manage all, which belongs with the whole list. */
function changeBar(bulk = true) {
  const count = view.draft.size;
  const waiting = pendingSyncs(committedList());
  const ready = manageable();
  const manageAll = bulk && variant !== 'c' && ready.length ? button({ variant: 'outline', size: 'small', label: 'Manage all', name: `Manage all ${ready.length} unmanaged skills`, id: 'manage-all', onclick: () => setManaged(ready.map(skill => skill.key), true) }) : null;
  const label = resumeNeeded() ? 'Resume and apply all' : 'Apply all';
  if (count) return h('div.apply', {}, manageAll,
    h('span.apply-count.apply-quiet', {}, `${count} ${count === 1 ? 'change' : 'changes'}`),
    button({ variant: 'ghost', size: 'small', label: 'Discard', id: 'discard', onclick: () => { view.draft.clear(); announce('Changes discarded.'); rerender(); } }),
    button({ variant: 'primary', size: 'small', label, id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  if (waiting) return h('div.apply', {}, manageAll, h('span.apply-count.apply-quiet', {}, `${waiting} to sync`), button({ variant: 'primary', size: 'small', label, id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  // Lost settings stop catch-up until the person resumes, even when nothing is waiting.
  if (resumeNeeded()) return h('div.apply', {}, manageAll, button({ variant: 'primary', size: 'small', label: 'Resume', id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  if (manageAll) return h('div.apply', {}, manageAll);
  return h('span.apply-state', {}, icon('check', 14, 'tone-success'), 'Up to date');
}

function cell(skill: SampleSkill, tool: Tool) {
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
    h(`button.cell-button.${look.tone}${on ? '.cell-on' : ''}${pending ? '.cell-pending-edit' : ''}`, { type: 'button', id: `cell-${skill.key}-${tool}${view.comparing === skill.key ? '-details' : ''}`, title: action ? `${text}. Click to ${action.charAt(0).toLowerCase()}${action.slice(1)}.` : text, 'aria-label': `${text}${action ? `. ${action}` : ''}`, disabled: state === 'cannot' || (!!skill.held && !differs), 'data-state': state,
      onclick: (event: Event) => { event.stopPropagation(); if (differs) { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); } else setTool([skill.key], tool, !on); } },
      look.glyph ? icon(look.glyph, state === 'present' ? 13 : 16, state === 'present' ? 'ring-strong' : '') : null));
}

const toolLine = (skill: SampleSkill, tool: Tool): string => {
  const base = committedOf(skill.key);
  const state = cellOf(skill, tool);
  const was = cellOf(base, tool);
  const version = skill.versions?.[tool];
  if (skill.cannot?.[tool]) return skill.cannot[tool]!;
  const chosen = view.draft.get(skill.key)?.resolve;
  if (chosen && chosen !== 'separate' && base.copies[tool] !== undefined) return chosen === tool ? 'Its copy will be used by every tool when you Apply all.' : `Its copy will be replaced with ${names[chosen]}'s when you Apply all. The replaced copy is kept in Central Knot's store.`;
  if (state === 'synced') return was === 'synced' ? 'Synced. Same copy as the other tool.' : 'Will be synced when you Apply all. It already has the same copy, so nothing needs copying.';
  if (state === 'will-sync') return was === 'will-sync' ? 'Set to sync, but it has no copy yet. Central Knot writes one when you Apply all.' : 'You turned syncing on. Central Knot writes a copy when you Apply all.';
  if (state === 'differs' || state === 'present-differs') return `Has a different copy${version ? ` (${version.lines}, ${version.changed})` : ''}. Choose which copy both tools use, below.`;
  if (state === 'present') return skill.managed ? 'Has its own copy. Syncing to this tool is turned off.' : 'Has its own copy. Central Knot is not managing this skill.';
  return skill.managed ? 'No copy, and syncing here is turned off.' : 'No copy.';
};

/** Everything about one skill, opened in place under its row. Differing copies add the choice of which one to use. */
function details(skill: SampleSkill, closable = true) {
  const draft = view.draft.get(skill.key);
  const differs = !skill.held && toolList().some(tool => ['differs', 'present-differs'].includes(cellOf(skill, tool)));
  const status = skill.held ? `Can’t be managed: ${skill.held}` : skill.separate ? 'Unmanaged. Both copies are kept as they are.' : skill.managed
    ? `Managed. Syncing to ${toolList().filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool]).map(tool => names[tool]).join(' and ') || 'no tool'}.`
    : 'Unmanaged. Central Knot leaves every copy alone.';
  return h(`div.compare.details${differs ? '.details-differs' : ''}`, { role: 'region', 'aria-label': `Details for ${skill.key}` },
    h('div.details-head', {},
      h('p.details-description', {}, skill.description),
      h('p.details-status', {}, status, draft ? h('span.details-pending', {}, ' Not applied yet.') : null)),
    (skill.extra ?? []).length ? h('div.details-extra', {}, (skill.extra ?? []).map(extra => h('p.details-extra-line', {}, icon(extra.same ? 'check' : 'diff', 12, extra.same ? 'tone-muted' : 'tone-warning'),
      `${names[extra.tool]} also reads ${extra.same ? 'the same copy' : 'a different copy'} at `, h('span.details-path', { title: extra.directory }, shownPath(extra.directory)),
      extra.writable ? '' : '. Central Knot does not change it: it is a link or a folder other tools share.'))) : null,
    h('div.details-tools', {}, toolList().map(tool => h('div.details-tool', {},
      h('div.details-tool-head', {}, brandMark(tool, 14), h('strong', {}, names[tool]), h('span.details-path', { title: skill.paths?.[tool] ?? '' }, skill.paths?.[tool] ? shownPath(skill.paths[tool]!) : designMode ? `~/.${tool === 'claude-cli' ? 'claude' : 'copilot'}/skills/${skill.key}` : '')),
      h('div.details-tool-body', {}, cell(skill, tool), h('span', {}, toolLine(skill, tool)))))),
    differs ? compareChoices(skill) : null,
    closable ? h('div.compare-foot', {}, smallAction('Close', `close-${skill.key}`, () => { view.comparing = undefined; rerender(); })) : null);
}

/** The decision for differing copies. */
function compareChoices(skill: SampleSkill) {
  const versions = skill.versions ?? {};
  const choice = (tool: Tool) => {
    const version = versions[tool];
    return h('button.version', { type: 'button', id: `use-${skill.key}-${tool}`, onclick: () => resolve(skill.key, tool) },
      h('span.version-head', {}, brandMark(tool, 14), h('strong', {}, `Use ${names[tool]}'s copy`)),
      version ? h('span.version-meta', {}, `${version.lines} · ${version.changed}`) : null,
      version ? h('span.version-text', {}, `“${version.text}”`) : null,
      h('span.version-effect', {}, `Replaces the copy in ${comparedTools(skill).filter(entry => entry !== tool).map(entry => names[entry]).join(' and ')} on Apply all`));
  };
  const compared = toolList().filter(tool => comparedTools(skill).includes(tool));
  return h('div.compare-block', {},
    h('p.compare-title', {}, icon('diff', 14, 'tone-warning'), `The copies of ${skill.key} differ. Which one should ${compared.length > 2 ? 'every tool' : 'both tools'} use?`),
    h('div.compare-choices', {}, compared.map(choice),
      h('button.version.version-quiet', { type: 'button', id: `separate-${skill.key}`, onclick: () => resolve(skill.key, 'separate') },
        h('span.version-head', {}, h('strong', {}, 'Keep both as they are')),
        h('span.version-effect', {}, 'Each tool keeps its own copy; Central Knot leaves this skill unmanaged'))));
}

function row(skill: SampleSkill) {
  const draft = view.draft.get(skill.key);
  const attention = syncOf(skill, toolList()) === 'attention';
  const decided = draft?.resolve;
  return [
    h(`div.ov-row${draft ? '.changed' : ''}${skill.managed ? '' : '.unmanaged'}${view.comparing === skill.key ? '.open' : ''}`, { role: 'row', 'data-key': skill.key, 'aria-expanded': String(view.comparing === skill.key), onclick: () => { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); } },
      h('div.ov-name', { role: 'cell', title: skill.description },
        h('button.row-open', { type: 'button', id: `open-${skill.key}`, 'aria-label': `${view.comparing === skill.key ? 'Hide' : 'Show'} details for ${skill.key}`, onclick: (event: Event) => { event.stopPropagation(); view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); } },
          icon(view.comparing === skill.key ? 'chevron-down' : 'chevron-right', 14, 'tone-faint')),
        h('span.ov-name-text', {}, skill.name ?? skill.key),
        skill.held ? h('span.held-pill', { title: skill.held }, 'Can’t manage') : null,
        attention && !decided ? smallAction('Copies differ', `decide-${skill.key}`, () => { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); }, '.decide') : null,
        decided ? h('span.decided', { title: decided === 'separate' ? 'Keeping both copies as they are, on Apply all' : `Every tool will use ${names[decided]}'s copy, on Apply all` },
          decided === 'separate' ? h('span', {}, 'Keeping both') : [brandMark(decided, 12), h('span', {}, `${names[decided]}'s copy`)],
          h('button.decided-undo', { type: 'button', id: `undo-${skill.key}`, 'aria-label': 'Undo this choice', title: 'Undo this choice', onclick: (event: Event) => { event.stopPropagation(); resolve(skill.key, undefined); } }, icon('undo-2', 12))) : null),
      h(`div.ov-managed${draft && skill.managed !== committedOf(skill.key).managed ? '.managed-pending' : ''}`, { role: 'cell' }, toggle(skill.managed, `Manage ${skill.name ?? skill.key}`, on => setManaged([skill.key], on), !!skill.held, `switch-${skill.key}`)),
      toolList().map(tool => cell(skill, tool)),
      h('div.ov-fill')),
    view.comparing === skill.key ? details(skill) : null,
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
const sendable = (from: Tool, to: Tool, list: SampleSkill[]) => list.filter(skill => {
  const now = effective(skill);
  return now.copies[from] !== undefined && !now.held && !now.cannot?.[to] && !now.cannot?.[from] && syncOf(now, toolList()) !== 'attention' && !now.separate && !(now.managed && !now.off.includes(to) && now.copies[to] !== undefined) && !(now.managed && !now.off.includes(to));
});
const send = (from: Tool, to: Tool, list: SampleSkill[]) => {
  const keys = sendable(from, to, list).map(skill => skill.key);
  for (const key of keys) edit(key, (skill, draft) => ({ managed: true, off: skill.off.filter(entry => entry !== to), resolve: draft?.resolve }));
  rerender();
};

/** Option B: a tool's header opens a menu offering to use all its skills in each other tool. It grows by one line per tool. */
function toolMenu(tool: Tool, list: SampleSkill[]) {
  const mine = list.filter(skill => effective(skill).copies[tool] !== undefined).length;
  // Stop all: every managed skill stops syncing to this tool. Copies already there stay as they are.
  const syncingHere = list.filter(skill => { const now = effective(skill); return now.managed && !now.off.includes(tool) && !now.cannot?.[tool]; });
  return h('div.tool-menu', { role: 'dialog', 'aria-label': `${names[tool]} actions`, onclick: (event: Event) => event.stopPropagation() },
    h('div.tool-menu-head', {}, brandMark(tool, 16), h('strong', {}, names[tool]), h('span.tool-menu-count', {}, `${mine} ${mine === 1 ? 'skill' : 'skills'}`),
      button({ variant: 'ghost', size: 'small', label: 'Stop all', name: `Stop syncing all ${syncingHere.length} skills to ${names[tool]}`, id: `menu-stop-${tool}`, disabled: !syncingHere.length, onclick: () => { setTool(syncingHere.map(skill => skill.key), tool, false); view.toolMenu = undefined; rerender(); } })),
    h('p.tool-menu-note', {}, syncingHere.length ? `${syncingHere.length} managed ${syncingHere.length === 1 ? 'skill syncs' : 'skills sync'} here. Stop all keeps their copies but stops updating them.` : 'No managed skills sync here.'),
    h('p.tool-menu-label', {}, `Add all ${names[tool]} skills to`),
    others(tool).map(target => {
      const count = sendable(tool, target, list).length;
      return h('div.tool-menu-row', {},
        brandMark(target, 16), h('span.tool-menu-name', {}, names[target]),
        h('span.tool-menu-count', {}, count ? `${count} to add` : 'Has them all'),
        button({ variant: count ? 'outline' : 'ghost', size: 'small', label: 'Add all', name: `Add all ${names[tool]} skills to ${names[target]}`, id: `menu-add-${tool}-${target}`, disabled: !count, onclick: () => { send(tool, target, list); view.toolMenu = undefined; rerender(); } }));
    }));
}

/** Option A: the actions sit in the headers. A tool's header adds everything the other tool has; a group header manages the group. */
function toolHead(tool: Tool, list: SampleSkill[]) {
  const count = sendable(other(tool), tool, list).length;
  if (variant === 'b') {
    const open = view.toolMenu === tool;
    return h('div.ov-cell.ov-tool-head.tool-head-b', { role: 'columnheader' },
      h('button.tool-head-button', { type: 'button', id: `tool-${tool}`, 'aria-expanded': String(open), 'aria-haspopup': 'dialog', title: `${names[tool]}: add its skills to other tools, or stop syncing here`, onclick: (event: Event) => { event.stopPropagation(); view.toolMenu = open ? undefined : tool; rerender(); } },
        brandMark(tool, 16), h('span.tool-head-name', {}, names[tool], icon('chevron-down', 12, 'tone-faint'))),
      open ? toolMenu(tool, list) : null);
  }
  return h('div.ov-cell.ov-tool-head', { role: 'columnheader' }, brandMark(tool, 16), h('span', {}, names[tool]),
    variant === 'a' ? h('button.head-action', { type: 'button', id: `fill-${tool}`, disabled: !count, title: count ? `Use all ${count} ${names[other(tool)]} skills in ${names[tool]}` : `${names[tool]} already has everything ${names[other(tool)]} has`, onclick: () => send(other(tool), tool, list) },
      icon('arrow-down', 12), count ? `Add ${count}` : 'All here') : null);
}

/** Option C: whatever the filter or search shows is the set the actions apply to. */
function shownStrip(shown: SampleSkill[]) {
  const unmanaged = shown.filter(skill => !skill.managed && !skill.separate && syncOf(skill, toolList()) !== 'attention');
  const managed = shown.filter(skill => skill.managed);
  return h('div.shown-strip', {},
    h('strong', {}, view.find || view.filter !== 'all' ? `${shown.length} shown` : `All ${shown.length}`),
    button({ variant: 'outline', size: 'small', label: unmanaged.length ? `Manage ${unmanaged.length}` : 'Manage', id: 'shown-manage', disabled: !unmanaged.length, onclick: () => setManaged(unmanaged.map(skill => skill.key), true) }),
    button({ variant: 'ghost', size: 'small', label: managed.length ? `Unmanage ${managed.length}` : 'Unmanage', id: 'shown-unmanage', disabled: !managed.length, onclick: () => setManaged(managed.map(skill => skill.key), false) }),
    h('span.bulk-divider', { 'aria-hidden': 'true' }),
    toolList().map(tool => {
      const count = sendable(other(tool), tool, shown).length;
      return button({ variant: 'ghost', size: 'small', label: count ? `Use ${count} in ${names[tool]}` : `All in ${names[tool]}`, id: `shown-${tool}`, disabled: !count, onclick: () => send(other(tool), tool, shown) });
    }));
}

function section(label: string, list: SampleSkill[], after: number) {
  if (!list.length) return null;
  const sorted = [...list].sort((first, second) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, '')));
  const managing = label === 'Unmanaged';
  const target = managing ? sorted.filter(skill => !skill.managed && !skill.separate && syncOf(skill, toolList()) !== 'attention') : sorted.filter(skill => skill.managed);
  return h('div', { role: 'rowgroup' },
    h('div.ov-section', { role: 'row' },
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(list.length)),
        after !== list.length ? h('span.ov-section-after', { title: 'After Apply all' }, icon('arrow-right', 12), String(after)) : null),
      variant === 'a' && target.length ? h('div.ov-section-action', {}, smallAction(managing ? `Manage all ${target.length}` : `Unmanage all ${target.length}`, `group-${managing ? 'manage' : 'unmanage'}`, () => setManaged(target.map(skill => skill.key), managing))) : null),
    sorted.flatMap(row));
}

let draftHome: string | undefined;

/** The column count goes through the style object: the page's security policy refuses inline style attributes. */
function withToolCount(table: HTMLElement) {
  table.style.setProperty('--tool-count', String(toolList().length));
  return table;
}

/** Preview-only, stopped and resume states, and what the last Apply all or catch-up did. */
function notices() {
  if (designMode || !state.home) return null;
  const manage = state.home.manage;
  const bands: HTMLElement[] = [];
  if (!manage.access.allowed) bands.push(h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, manage.access.reason)));
  if (manage.gate.state === 'stopped') bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, manage.gate.reason)));
  if (manage.gate.state === 'needs-resume') bands.push(h('div.band', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, manage.gate.reason)));
  const applied = state.applied;
  // Skills that cannot go somewhere, or whose copies differ, already show that in their row; the band is for failures.
  const problems = applied ? applied.results.filter(result => result.outcome === 'failed' || (result.outcome === 'held' && !/^Copies differ\./.test(result.message))) : [];
  if (applied?.stopped) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, applied.stopped)));
  else if (problems.length) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · ') + (problems.length > 4 ? ` · and ${problems.length - 4} more` : ''))));
  const caughtNames = [...new Set(manage.caughtUp.filter(result => result.outcome === 'written').map(result => result.item))];
  if (caughtNames.length && !applied) bands.push(h('div.band', { role: 'status' }, icon('check', 14, 'tone-success'),
    h('span.band-text', {}, `Caught up: copied ${caughtNames.slice(0, 4).join(', ')}${caughtNames.length > 4 ? ` and ${caughtNames.length - 4} more` : ''} to tools that were missing them. To stop a tool getting a skill back, turn that tool off for it.`)));
  return bands.length ? h('div.bands', {}, bands) : null;
}

/** Pending changes belong to one home: opening another starts clean. */
function forgetOtherHomes() {
  if (!designMode && state.home?.home !== draftHome) { view.draft.clear(); view.comparing = undefined; draftHome = state.home?.home; }
  // A change for a skill that is no longer there has nothing to apply to.
  const keys = new Set(committedList().map(skill => skill.key));
  for (const key of [...view.draft.keys()]) if (!keys.has(key)) view.draft.delete(key);
}

export function designOverview() {
  forgetOtherHomes();
  const all = rows();
  const needle = view.find.trim().toLowerCase();
  const shown = all.filter(skill => (view.filter === 'all' || (view.filter === 'managed' ? committedOf(skill.key).managed : view.filter === 'unmanaged' ? !committedOf(skill.key).managed : syncOf(skill, toolList()) === 'attention'))
    && (!needle || skill.key.includes(needle) || skill.description.toLowerCase().includes(needle)));
  const find = h('input.find-input', { id: 'find', type: 'text', placeholder: 'Find', 'aria-label': 'Find', value: view.find, spellcheck: 'false',
    oninput: (event: Event) => { view.find = (event.target as HTMLInputElement).value; rerender(); document.getElementById('find')?.focus(); } });
  return h('div.page.ov-page', { 'data-variant': variant },
    h('div.toolbar', {}, h('div.find', {}, icon('search', 16, 'find-glyph'), find), filterBar(), h('div.toolbar-end', {}, changeBar())),
    notices(),
    h('div.scroll.matrix', {},
      variant === 'c' ? shownStrip(shown) : null,
      withToolCount(h('div.ov', { role: 'table', 'aria-label': 'Skills and where they sync' },
        h('div.ov-row.ov-head', { role: 'row' },
          h('div.ov-name', { role: 'columnheader' }, 'Skill'),
          h('div.ov-managed', { role: 'columnheader' }, 'Managed'),
          toolList().map(tool => toolHead(tool, shown)),
          h('div.ov-fill')),
        section('Managed', shown.filter(skill => committedOf(skill.key).managed), shown.filter(skill => skill.managed).length),
        section('Unmanaged', shown.filter(skill => !committedOf(skill.key).managed), shown.filter(skill => !skill.managed).length))),
      legend()));
}


// ---------- Skills page ----------

/** A small cell for the list: the same look as the Overview's, without the button. */
const miniCell = (skill: SampleSkill, tool: Tool) => {
  const state = cellOf(skill, tool);
  const base = committedOf(skill.key);
  const pending = state !== 'cannot' && (state !== cellOf(base, tool) || (skill.managed && !skill.off.includes(tool)) !== (base.managed && !base.off.includes(tool)));
  const look = pending && state === 'synced' ? cellLook['will-sync'] : cellLook[state];
  const on = skill.managed && !skill.off.includes(tool);
  return h(`span.legend-cell.mini-cell.${look.tone}${on ? '.cell-on' : ''}`, { title: `${names[tool]}: ${look.label}` }, look.glyph ? icon(look.glyph, state === 'present' ? 9 : 11, state === 'present' ? 'ring-strong' : '') : null);
};

/** A list of every skill beside one skill's details: the same choices as the Overview, and the same Apply all. `more` adds files and contents. */
export function skillsBrowser(more: (key: string) => (Node | null | false)[], select: (key: string | undefined) => void) {
  forgetOtherHomes();
  const all = rows();
  const needle = view.listFind.trim().toLowerCase();
  const shown = all.filter(skill => !needle || skill.key.includes(needle) || (skill.name ?? '').toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle));
  const chosen = all.find(skill => skill.key === state.item);
  // Two panes always show a skill. One pane shows the list until a skill is chosen.
  const onePane = document.body.classList.contains('one-pane');
  const shownDetail = chosen ?? shown[0] ?? all[0];
  const highlighted = chosen ?? (onePane ? undefined : shownDetail);
  document.body.classList.toggle('has-item', !!chosen);
  const listRow = (skill: SampleSkill) => h(`button.list-row${skill === highlighted ? '.selected' : ''}${view.draft.has(skill.key) ? '.list-changed' : ''}`, {
    type: 'button', id: `list-${skill.key}`, 'aria-pressed': String(skill === highlighted),
    'aria-label': `${skill.name ?? skill.key}, ${skill.managed ? 'managed' : 'unmanaged'}${view.draft.has(skill.key) ? ', changed, not applied yet' : ''}`,
    onclick: () => select(skill.key),
  },
    h(`span.list-managed${skill.managed ? '.on' : ''}`, { 'aria-hidden': 'true', title: skill.managed ? 'Managed' : 'Unmanaged' }),
    middle(skill.name ?? skill.key, 12, 'list-name'),
    h('span.list-cells', { 'aria-hidden': 'true' }, toolList().map(tool => miniCell(skill, tool))));
  const find = h('input.find-input', { id: 'skills-find', type: 'text', placeholder: 'Find', 'aria-label': 'Find a skill', value: view.listFind, spellcheck: 'false',
    oninput: (event: Event) => { view.listFind = (event.target as HTMLInputElement).value; rerender(); document.getElementById('skills-find')?.focus(); } });
  const list = shown.length
    ? h('div', { role: 'group', 'aria-label': 'Skills' }, shown.map(listRow))
    : emptyState('search-x', 'Nothing matches', `“${view.listFind}”`);
  const skill = shownDetail;
  const draft = view.draft.get(skill.key);
  return h('div.page.split', {},
    h('div.list-column', {},
      h('div.toolbar.list-toolbar', {}, h('div.find', {}, icon('search', 16, 'find-glyph'), find)),
      h('div.scroll.list-scroll', { id: 'skills-list' }, list)),
    h('section.detail-column', { 'aria-label': 'Skill details' },
      h('div.pane-header', {},
        h('div.crumb', {},
          button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Skills', id: 'detail-back', onclick: () => select(undefined) }),
          h('span.crumb-sep', { 'aria-hidden': 'true' }, '/')),
        h('div.pane-title', {}, h('h2', {}, middle(skill.name ?? skill.key)), h('p', {}, `${skill.managed ? 'Managed' : 'Unmanaged'}${draft ? ' · not applied yet' : ''}`)),
        h('div.detail-actions', {},
          h('span.detail-switch-label', { 'aria-hidden': 'true' }, 'Managed'),
          toggle(skill.managed, `Manage ${skill.name ?? skill.key}`, on => setManaged([skill.key], on), !!skill.held, `detail-switch-${skill.key}`),
          changeBar(false))),
      notices(),
      h('div.scroll.detail-scroll', { id: 'detail-scroll' }, details(skill, false), ...more(skill.key))));
}

// Escape in a find box clears it.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const id = (event.target as HTMLElement | null)?.id;
  if (id === 'skills-find' && view.listFind) { view.listFind = ''; rerender(); }
  if (id === 'find' && view.find) { view.find = ''; rerender(); }
});
