// The Overview table in design preview: three layout options with no row checkboxes.
// Managed says whether Central Knot keeps a skill in sync; each tool's cell says what that tool has.
// Changes collect until "Apply all".
import { brandMark } from './brand.ts';
import { andList, toolNames } from './words.ts';
import { convertAgent, flashRequests, applyAgentsChanges, applyManage, applyMcpChanges, deleteEverywhereKey, rerender, announce, restoreEvent, setSync, shownPath, showFile, showPage, state, syncNow, writeClaudeNow } from './app.ts';
import { button, closeButton, emptyState, h, icon, middle, withToolCount } from './dom.ts';
import type { IconName } from './icons.ts';
import { applied, cellOf, comparedTools, designMode, sample, syncOf, tools as sampleTools, variant, type Cell, type SampleSkill, type Tool } from './design.ts';
import type { Change, SkillFacts, SyncNotice, HarnessId } from './types.ts';
import { folded, lineDiff } from './diff.ts';
import { planAdd as planAddPure, withBoth } from './addplan.ts';

const names = toolNames as Record<Tool, string>;
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? 'edited today' : days === 1 ? 'edited yesterday' : days < 14 ? `edited ${days} days ago` : days < 60 ? `edited ${Math.floor(days / 7)} weeks ago` : `edited ${Math.floor(days / 30)} months ago`;
};

/** The real home's facts in the shape the page works with. */
const fromFacts = (facts: SkillFacts): SampleSkill => ({
  key: facts.key, name: facts.name, description: facts.description, converted: facts.converted, limits: facts.limits, kept: facts.kept, stopped: facts.stopped, managed: facts.managed, off: facts.off, cannot: facts.cannot, held: facts.held, separate: facts.separate, edited: facts.edited,
  blocks: facts.choiceBlocks, hashes: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.hash])),
  // A tool reading two different copies has copies that differ, even if one of them matches the other tool.
  copies: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, facts.extra.some(extra => extra.tool === tool && extra.hash !== copy!.hash) ? `mixed:${tool}` : copy!.hash])
    // A stopped one-way copy is the person's own now: it never makes the others look different. Its own box says it stopped.
    .map(([tool, hash]) => [tool, facts.stopped?.includes(tool as HarnessId) ? Object.entries(facts.copies).find(([other]) => !facts.stopped!.includes(other as HarnessId))?.[1]?.hash ?? hash : hash])),
  extra: facts.extra.map(extra => ({ tool: extra.tool, directory: extra.directory, summary: extra.summary, writable: extra.writable, same: extra.hash === facts.copies[extra.tool]?.hash })),
  paths: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.directory])),
  // An MCP entry has no lines or edit date of its own: its details name the file it lives in.
  versions: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.lines ? { lines: `${copy!.lines} lines`, changed: ago(copy!.modified), text: copy!.summary || facts.description } : { lines: copy!.directory.split('/').pop() ?? '', changed: 'MCP entry', text: copy!.summary }])),
});

/** What this table shows: skills, MCP servers or agents. Each keeps its own pending changes; the same marks mean the same things. */
type Kind = 'skills' | 'mcp' | 'agents';
/** The MCP or agents view behind this table; skills have their own. */
const listView = () => (kind === 'mcp' ? state.home?.mcp : kind === 'agents' ? state.home?.agents : undefined);
const nouns: Record<Kind, [string, string]> = { skills: ['Skill', 'Skills'], mcp: ['Server', 'MCP servers'], agents: ['Agent', 'Agents'] };
let kind: Kind = 'skills';
const factsCache: Partial<Record<Kind, { from: unknown; list: SampleSkill[] }>> = {};
function committedList(): SampleSkill[] {
  if (designMode) return view.committed;
  const source = kind === 'skills' ? state.home?.manage : listView();
  const facts = kind === 'skills' ? state.home?.manage.skills : listView()?.servers;
  if (!source || !facts) return [];
  // MCP: Claude Code's entries wait for Write now; their cells say so instead of reading as differing copies.
  const waiting = kind === 'mcp' ? new Set(listView()?.claudePending ?? []) : new Set<string>();
  if (factsCache[kind]?.from !== source) factsCache[kind] = { from: source, list: facts.map(fact => ({ ...fromFacts(fact), waits: waiting.has(fact.key) ? ['claude-cli' as Tool] : undefined })) };
  return factsCache[kind]!.list;
}
/** The harness a Harnesses page shows: its column comes first, and bulk actions keep to what it has. */
let focus: Tool | undefined;
const toolList = (): Tool[] => {
  const list = (designMode ? sampleTools : (kind === 'skills' ? state.home?.manage.tools : listView()?.tools) ?? []);
  return focus && list.includes(focus) ? [focus, ...list.filter(tool => tool !== focus)] : list;
};
/** Whether the focused harness has its own copy (as last read); with no focus, every item counts. */
const inFocus = (skill: SampleSkill) => !focus || committedOf(skill.key)?.copies[focus] !== undefined;
const other = (tool: Tool) => toolList().find(entry => entry !== tool)!;
const others = (tool: Tool) => toolList().filter(entry => entry !== tool);
type Filter = 'all' | 'managed' | 'unmanaged' | 'attention';
type Resolution = Tool | 'separate';
/** `prior` is the Managed state before a copy choice, so undoing the choice puts it back. */
interface Draft { managed: boolean; off: Tool[]; resolve?: Resolution; prior?: boolean; /** The chosen copy's content ID when it was chosen. */ seen?: string; /** Whether the skill was managed when this change was first made: a change made against an older state is dropped, never applied. */ seenManaged?: boolean }

const newView = () => ({
  committed: sample.map(skill => ({ ...skill })),
  draft: new Map<string, Draft>(),
  filter: 'all' as Filter,
  find: '',
  /** The skill whose details are open under its row. */
  comparing: undefined as string | undefined,
  /** The tool whose header menu is open. */
  toolMenu: undefined as Tool | undefined,
  /** Menu rows ("from>to") where Add also takes differing copies. Each menu opens with none. */
  addConflicts: new Set<string>(),
  /** Menu rows whose list of skills that can't be added is open. */
  addReasons: new Set<string>(),
  /** What the Skills page list is narrowed to. */
  listFind: '',
  /** The skill whose Delete everywhere is waiting for its confirming click. */
  confirmDelete: undefined as string | undefined,
});
const views: Record<Kind, ReturnType<typeof newView>> = { skills: newView(), mcp: newView(), agents: newView() };
/** Opens a page already narrowed, for links that point at a problem (the Overview's "has different copies"). */
export const showFiltered = (which: Kind, filter: Filter) => { views[which].filter = filter; };
let view = views.skills;
let draftHomes: Partial<Record<Kind, string>> = {};

// A click elsewhere or Escape closes a tool menu.
document.addEventListener('click', () => { if (view.toolMenu) { view.toolMenu = undefined; rerender(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && view.toolMenu) { const tool = view.toolMenu; view.toolMenu = undefined; rerender(); document.getElementById(`tool-${tool}`)?.focus(); } });

const committedOf = (key: string) => committedList().find(skill => skill.key === key)!;

/** A skill as it will be after Apply all. */
function effective(skill: SampleSkill): SampleSkill {
  const draft = view.draft.get(skill.key);
  if (!draft) return skill;
  const next: SampleSkill = { ...skill, managed: draft.managed, off: draft.off };
  // MCP: turning Claude Code on for a server means a Write to Claude Code after Apply all, so its cell says so before.
  if (kind === 'mcp' && draft.managed && !draft.off.includes('claude-cli') && toolList().includes('claude-cli') && !skill.waits?.length) {
    const others = Object.entries(skill.copies).filter(([tool]) => tool !== 'claude-cli' && !draft.off.includes(tool)).map(([, copy]) => copy);
    if (skill.copies['claude-cli'] === undefined || others.some(copy => copy !== skill.copies['claude-cli'])) next.waits = ['claude-cli'];
  }
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
  const before = view.draft.get(key);
  const next = { ...change(effective(base), before), seenManaged: before?.seenManaged ?? base.managed };
  const same = !next.resolve && next.managed === base.managed && [...next.off].sort().join() === [...base.off].sort().join();
  if (same) view.draft.delete(key); else view.draft.set(key, next);
  announce(view.draft.size ? `${view.draft.size} ${view.draft.size === 1 ? 'change' : 'changes'} not applied yet.` : 'No changes.', true);
}

// Turning a skill on undoes "keep both"; turning it off drops a chosen copy. The page then shows what Apply all will do.
const keepResolve = (managed: boolean, resolve?: Resolution) => (managed ? (resolve === 'separate' ? undefined : resolve) : undefined);

const keepPrior = (resolve: Resolution | undefined, draft?: Draft) => (resolve ? draft?.prior : undefined);
const keepChoice = (resolve: Resolution | undefined, draft?: Draft) => ({ resolve, prior: keepPrior(resolve, draft), seen: resolve ? draft?.seen : undefined });

function setManaged(keys: string[], managed: boolean) {
  for (const key of keys) edit(key, (skill, draft) => { return { managed, off: skill.off, ...keepChoice(keepResolve(managed, draft?.resolve), draft) }; });
  rerender();
}

function setTool(keys: string[], tool: Tool, on: boolean) {
  for (const key of keys) edit(key, (skill, draft) => { const managed = on ? true : skill.managed; return { managed, off: on ? skill.off.filter(entry => entry !== tool) : [...new Set([...skill.off, tool])], ...keepChoice(keepResolve(managed, draft?.resolve), draft) }; });
  rerender();
}

function resolve(key: string, choice: Resolution | undefined) {
  edit(key, (skill, draft) => {
    const prior = draft?.resolve ? draft.prior ?? committedOf(key).managed : skill.managed;
    const off = draft?.off ?? skill.off;
    return choice ? { managed: choice !== 'separate', off, resolve: choice, prior, seen: choice === 'separate' ? undefined : committedOf(key).hashes?.[choice] } : { managed: prior, off };
  });
  view.comparing = undefined;
  rerender();
}

function applyAll() {
  const count = view.draft.size;
  if (!designMode) {
    const changes = [...view.draft].map(([key, draft]) => ({ key, managed: draft.managed, off: draft.off, use: draft.resolve, useHash: draft.seen, seenManaged: draft.seenManaged })) as Change[];
    const drafts = view.draft;
    if (kind === 'mcp') void applyMcpChanges(changes, () => drafts.clear());
    else if (kind === 'agents') void applyAgentsChanges(changes, () => drafts.clear());
    else void applyManage(changes, () => drafts.clear());
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
  'will-sync': { glyph: 'check', tone: 'cell-pending', label: 'Will sync on Apply all' },
  edited: { glyph: 'pencil-line', tone: 'cell-waiting', label: 'Edited in that tool, waiting to spread' },
  waiting: { glyph: 'clock', tone: 'cell-waiting', label: 'Gets the edit when it spreads' },
  'write-now': { glyph: 'clock', tone: 'cell-waiting', label: 'Waits for Write to Claude Code' },
  differs: { glyph: 'diff', tone: 'cell-differs', label: 'Copies differ' },
  off: { tone: 'cell-present', label: 'Has a copy, not synced' },
  present: { glyph: 'circle-small', tone: 'cell-present', label: 'Has a copy, not synced' },
  'present-differs': { glyph: 'diff', tone: 'cell-differs', label: 'Copies differ' },
  absent: { tone: 'cell-absent', label: 'No copy' },
  cannot: { tone: 'cell-cannot', label: 'Cannot load it' },
};


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
  const hadAttention = list.some(skill => syncOf(skill, toolList()) === 'attention');
  const chip = (id: Filter, label: string, warn?: number) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn ? '.chip-warn' : ''}`, { type: 'button', 'aria-pressed': String(view.filter === id), onclick: () => { view.filter = id; rerender(); } },
    label, warn !== undefined ? h('span.chip-count', {}, String(warn)) : null);
  return h('div.chips', { role: 'group', 'aria-label': 'Show' },
    chip('all', 'All'), chip('managed', 'Managed'), chip('unmanaged', 'Unmanaged'), attention || (hadAttention && view.filter === 'attention') ? chip('attention', 'Copies differ', attention) : null);
}

// Edits waiting for Sync are not Apply all's to write: the Sync-off banner offers Sync now for them.
// MCP entries for Claude Code wait for Write now, not Apply all (MCP-02), so they are not counted here either.
const pendingSyncs = (list: SampleSkill[]) => list.filter(skill => !skill.edited?.length && toolList().some(tool => cellOf(skill, tool) === 'will-sync' && !(kind === 'mcp' && tool === 'claude-cli'))).length;
const manageable = () => committedList().filter(skill => !skill.held && inFocus(skill)).filter(skill => !effective(skill).managed && !effective(skill).separate && syncOf(effective(skill), toolList()) !== 'attention');

const canWrite = () => designMode || (!!state.home && state.home.manage.access.allowed && state.home.manage.gate.state !== 'stopped' && !state.busy);
const resumeNeeded = () => !designMode && state.home?.manage.gate.state === 'needs-resume';

/** Pending changes and Apply all. `bulk` adds Manage all, which belongs with the whole list. */
function changeBar(bulk = true) {
  const count = view.draft.size;
  const waiting = pendingSyncs(committedList());
  const ready = manageable();
  // Unmanaged items whose copies differ need a choice first, so Manage leaves them out and says so.
  const needChoice = committedList().filter(skill => !skill.held && inFocus(skill) && !effective(skill).managed && !effective(skill).separate && syncOf(effective(skill), toolList()) === 'attention').length;
  const word = (n: number) => (kind === 'mcp' ? (n === 1 ? 'MCP server' : 'MCP servers') : n === 1 ? nouns[kind][0].toLowerCase() : nouns[kind][1].toLowerCase());
  // On a harness's page the count names what it covers: only what that harness has.
  const manageLabel = focus ? `Manage ${ready.length} ${word(ready.length)}` : ready.length === 1 ? 'Manage 1' : ready.length === 2 ? 'Manage both' : needChoice ? `Manage ${ready.length} of ${ready.length + needChoice}` : `Manage all ${ready.length}`;
  const manageAll = bulk && variant !== 'c' && ready.length ? button({ variant: 'outline', size: 'small', label: manageLabel, attrs: needChoice ? { title: `${needChoice === 1 ? 'One skill needs' : `${needChoice} need`} a copy choice first` } : undefined, name: `Manage ${ready.length} unmanaged ${word(ready.length)}${needChoice ? `; ${needChoice} more ${needChoice === 1 ? 'needs' : 'need'} a copy choice first` : ''}`, id: 'manage-all', onclick: () => setManaged(ready.map(skill => skill.key), true) }) : null;
  const firstChoice = committedList().find(skill => !skill.held && !effective(skill).managed && !effective(skill).separate && syncOf(effective(skill), toolList()) === 'attention');
  // The Unmanaged section's note names the item that needs a copy choice; the toolbar no longer repeats it.
  const choiceNote: HTMLElement | null = null;
  const label = resumeNeeded() ? 'Resume and apply all' : 'Apply all';
  if (count) return h('div.apply', {}, manageAll,
    h('span.apply-count.apply-quiet', { title: 'Nothing is written until Apply all' }, (() => {
      const next = [...view.draft.keys()].map(key => effective(committedOf(key)));
      const fresh = next.reduce((total, skill) => total + toolList().filter(tool => cellOf(skill, tool) === 'will-sync' && skill.copies[tool] === undefined).length, 0);
      const replaced = [...view.draft.keys()].reduce((total, key) => total + toolList().filter(tool => replacedOnApply(effective(committedOf(key)), tool)).length, 0);
      return `${count} ${count === 1 ? shortNoun[kind][0] : shortNoun[kind][1]} to change${fresh ? ` · ${fresh} new ${fresh === 1 ? 'copy' : 'copies'}` : ''}${replaced ? ` · ${replaced} ${replaced === 1 ? 'copy' : 'copies'} to replace` : ''}`;
    })()),
    // A bulk Manage leaves differing items out; the bar still points at the one waiting for a choice.
    button({ variant: 'ghost', size: 'small', label: 'Discard', id: 'discard', onclick: () => { view.draft.clear(); announce('Changes discarded. Nothing was written.'); rerender(); } }),
    button({ variant: 'primary', size: 'small', label, id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  if (waiting) return h('div.apply', {}, manageAll, h('span.apply-count.apply-quiet', {}, `${waiting} to sync`), button({ variant: 'primary', size: 'small', label, id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  // Lost settings stop catch-up until the person resumes, even when nothing is waiting.
  if (resumeNeeded()) return h('div.apply', {}, manageAll, button({ variant: 'primary', size: 'small', label: 'Resume', id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  // "Up to date" only when nothing waits anywhere: an edit waiting for Sync, or an entry waiting for Write now, is said instead.
  const edits = committedList().filter(skill => skill.managed && skill.edited?.length).length;
  // A stopped copy whose notice is showing is said there; the toolbar says it once the notice is put aside.
  const stoppedAll = kind === 'agents' ? committedList().filter(skill => skill.managed && !view.draft.get(skill.key)?.resolve).flatMap(skill => stoppedLive(skill).map(tool => `stopped:${skill.key}:${tool}`)) : [];
  const stoppedCopies = stoppedAll.filter(key => state.dismissed.has(key)).length;
  // A copy that keeps its own edit is a settled choice, but not "the same everywhere": the toolbar counts it.
  const keptCopies = kind === 'agents' ? committedList().filter(skill => skill.managed && !view.draft.get(skill.key)?.resolve).reduce((total, skill) => total + (skill.stopped ?? []).filter(tool => !skill.off.includes(tool) && keptEdit(skill, tool)).length, 0) : 0;
  const writes = committedList().filter(skill => skill.managed && skill.waits?.length).length;
  const status = edits ? h('span.apply-state.apply-waiting', {}, icon('clock', 14, 'tone-warning'), `${edits} ${edits === 1 ? 'change' : 'changes'} waiting`)
    // The band below carries the Write action; the header only says it, so the page asks for one click in one place.
    : writes && !(kind === 'mcp' && listView()?.claudePending.length) ? h('span.apply-state.apply-waiting', { id: 'go-write-now' }, icon('clock', 14, 'tone-warning'), `${writes} ${writes === 1 ? 'server waits' : 'servers wait'} for Claude Code`)
    // The band below always carries the Write button while something waits, so the toolbar only says it, quietly.
    : writes ? h('span.apply-state.apply-quiet', {}, icon('clock', 14, 'tone-muted'), writes === 1 ? `${committedList().find(skill => skill.managed && skill.waits?.length)?.name ?? '1 server'} waits for Claude Code` : `${writes} servers wait for Claude Code`)
      // An unresolved copy choice is not "up to date", even while its chooser is open.
      : needChoice ? null
        : stoppedCopies ? h('button.apply-state.apply-waiting.text-action', { type: 'button', id: 'go-stopped', title: 'Show it', onclick: () => { const first = stoppedAll.find(key => state.dismissed.has(key))!.split(':')[1]; view.comparing = undefined; openRow(first); } }, icon('circle-pause', 14, 'tone-warning'), `${stoppedCopies} ${stoppedCopies === 1 ? 'copy' : 'copies'} stopped updating`)
          // Its notice is showing: the toolbar neither repeats it nor claims everything is synced.
          : stoppedAll.length ? h('span.apply-state.apply-waiting', {}, icon('circle-pause', 14, 'tone-warning'), `${stoppedAll.length} ${stoppedAll.length === 1 ? 'copy' : 'copies'} stopped updating`)
        : state.home && !state.home.syncOn ? h('span.apply-state.apply-quiet', {}, icon('circle-minus', 14, 'tone-muted'), 'Nothing waiting · sync off')
          : bulk ? h('span.apply-state', {}, icon('check', 14, 'tone-success'), keptCopies ? `Synced · ${keptCopies} kept ${keptCopies === 1 ? 'edit' : 'edits'}` : 'All synced') : null;
  if (manageAll || choiceNote) return h('div.apply', {}, choiceNote, manageAll, edits || writes ? status : null);
  return status;
}

/** Agents: a stopped one-way copy the person chose to keep. It stays theirs, quietly; a click can still queue the source's copy. */
const keptKey = (skill: SampleSkill, tool: Tool) => `ck-kept-edit:${state.home?.home ?? ''}:${skill.key}:${tool}`;
const keptEdit = (skill: SampleSkill, tool: Tool) => readFlag(keptKey(skill, tool));
const stoppedLive = (skill: SampleSkill) => (skill.stopped ?? []).filter(tool => !skill.off.includes(tool) && !keptEdit(skill, tool));

function cell(skill: SampleSkill, tool: Tool, inDetails = false) {
  const base = committedOf(skill.key);
  // Agents: a one-way copy edited in its own tool stopped updating. It shows amber, and a click queues the source's copy again.
  const source = kind === 'agents' ? oneWaySource(skill) : undefined;
  if (source && skill.stopped?.includes(tool) && !view.draft.get(skill.key)?.resolve && skill.managed && !skill.off.includes(tool)) {
    const kept = keptEdit(skill, tool);
    const text = kept ? `${names[tool]}: edited in ${names[tool]} and kept; not receiving updates. Click to use ${names[source]}’s copy again (on Apply all).`
      : `${names[tool]}: edited in ${names[tool]}, so it stopped updating. Click to use ${names[source]}’s copy again (on Apply all; this copy is kept in History).`;
    return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
      h(`button.cell-button.${kept ? cellLook.present.tone : cellLook.differs.tone}.cell-on`, { type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, title: text, 'aria-label': text, 'data-state': kept ? 'kept' : 'stopped',
        onclick: (event: Event) => { event.stopPropagation(); resolve(skill.key, source); view.comparing = skill.key; rerender(); } },
        icon('circle-pause', 15, kept ? 'tone-muted' : '')));
  }
  // Queued: the stopped copy is replaced on Apply all, so it shows the replace mark like any copy a choice overwrites.
  if (source && skill.stopped?.includes(tool) && view.draft.get(skill.key)?.resolve === source && !skill.off.includes(tool)) {
    const text = `${names[tool]}: its edited copy is replaced by ${names[source]}’s on Apply all (kept in History). Click to cancel.`;
    return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
      h(`button.cell-button.${cellLook['will-sync'].tone}.cell-on.cell-pending-edit`, { type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, title: text, 'aria-label': text, 'data-state': 'replace',
        onclick: (event: Event) => { event.stopPropagation(); resolve(skill.key, undefined); rerender(); } }, icon('refresh-cw', 14)));
  }
  const state = cellOf(skill, tool);
  const on = skill.managed && !skill.off.includes(tool);
  const wasOn = base.managed && !base.off.includes(tool);
  const pending = state !== 'cannot' && (state !== cellOf(base, tool) || on !== wasOn);
  const look = pending && state === 'synced' ? cellLook['will-sync'] : cellLook[state];
  const differs = state === 'differs' || state === 'present-differs';
  // A pending cell with no copy yet gets one written: a plus, where a plain tick only starts syncing what is there.
  const adds = state === 'will-sync' && skill.copies[tool] === undefined;
  // A chosen copy replaces this tool's different copy on Apply all: its own mark, since only this step overwrites.
  const replaces = replacedOnApply(skill, tool);
  // A cell whose copies differ opens the comparison instead of toggling: a decision comes first.
  const action = state === 'cannot' ? '' : differs ? 'Compare the copies' : on ? `Stop syncing to ${names[tool]}` : `Sync to ${names[tool]}`;
  const oneWay = !!skill.limits?.[tool] && on;
  const limited = oneWay ? ', one-way (with limits)' : '';
  const becomesSource = kind === 'agents' && pending && on && oneWaySource(skill) === tool && !committedOf(skill.key).managed;
  const text = skill.cannot?.[tool] ?? (becomesSource ? `${names[tool]}: becomes the source on Apply all; edits made in ${names[tool]} go to ${andList(Object.keys(skill.limits ?? {}).filter(entry => !skill.off.includes(entry as Tool)).map(entry => names[entry as Tool]))}` : null) ?? `${names[tool]}: ${state === 'will-sync' && skill.copies[tool] === undefined ? 'Gets a new copy on Apply all' : replaces ? 'Its copy is replaced on Apply all (kept in History)' : look.label}${limited}${pending ? ' (not applied yet)' : ''}`;
  return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
    h(`button.cell-button.${look.tone}${on ? '.cell-on' : ''}${pending ? '.cell-pending-edit' : ''}${oneWay ? '.cell-oneway' : ''}`, { type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, title: action ? `${text}. Click to ${action.charAt(0).toLowerCase()}${action.slice(1)}.` : text, 'aria-label': `${text}${action ? `. ${action}` : ''}`, disabled: state === 'cannot' || (!!skill.held && !differs), 'data-state': state,
      onclick: (event: Event) => { event.stopPropagation(); if (differs) { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); } else setTool([skill.key], tool, !on); } },
      adds ? icon('plus', 16) : replaces ? icon('refresh-cw', 14) : look.glyph ? icon(look.glyph, state === 'present' ? 13 : 16, state === 'present' ? 'glyph-fill' : '') : null,
      oneWay ? h('span.cell-oneway-mark', { 'aria-hidden': 'true' }, icon('arrow-up-right', 9)) : null,
      on && kind === 'agents' && skill.managed && oneWaySource(skill) === tool ? h('span.cell-source-mark', { 'aria-hidden': 'true' }) : null));
}

const toolLine = (skill: SampleSkill, tool: Tool): string => {
  if (skill.stopped?.includes(tool)) {
    const chosen = view.draft.get(skill.key)?.resolve;
    if (!(chosen && chosen !== 'separate') && keptEdit(skill, tool)) return `Edited in ${names[tool]} and kept: it doesn’t receive updates. To use ${names[oneWaySource(skill) ?? 'claude-cli']}’s copy again, click its box, then Apply all.`;
    return chosen && chosen !== 'separate' ? `Its edited copy is replaced by ${names[chosen]}’s on Apply all (kept in History); it then receives updates again.` : `Edited in ${names[tool]}, so it stopped updating.${state.dismissed.has(`stopped:${skill.key}:${tool}`) ? ' Either choice keeps your edit: in Codex, or in History if you use the source’s copy.' : ' Choose above. Either choice keeps your edit: in Codex, or in History if you use the source’s copy.'}`;
  }
  if (skill.waits?.includes(tool) && skill.managed) return `${skill.copies[tool] === undefined ? 'Doesn’t have it yet.' : `Has an older copy${skill.versions?.[tool]?.text ? `: ${skill.versions[tool]!.text.replace(/^[^·]+·\s*/, '')}` : ''}.`}${state.home?.mode === 'fixture' ? '' : ' Quit Claude Code first: it rewrites ~/.claude.json while it runs.'}`;
  if (skill.edited?.length && skill.managed) return skill.edited.includes(tool) ? `Edited in ${names[tool]}. It spreads to the other tools when sync runs.` : `Gets the edit from ${andList(skill.edited.map(entry => names[entry]))} when sync runs.`;
  const base = committedOf(skill.key);
  const cellState = cellOf(skill, tool);
  const was = cellOf(base, tool);
  const version = skill.versions?.[tool];
  if (skill.cannot?.[tool]) return skill.cannot[tool]!;
  const chosen = view.draft.get(skill.key)?.resolve;
  if (chosen && chosen !== 'separate' && base.copies[tool] !== undefined) return chosen === tool ? (kind === 'agents' && skill.stopped?.length ? `Source. Its copy goes to ${andList(skill.stopped.map(entry => names[entry]))} on Apply all.` : 'Its copy will be used by every tool when you Apply all.') : replacedOnApply(skill, tool) ? `Its copy will be replaced with ${names[chosen]}’s when you Apply all. The replaced copy is kept in Central Knot’s store.` : `Already has ${names[chosen]}’s copy; no change.`;
  if (cellState === 'synced' && skill.limits?.[tool] && skill.managed) return `Receives from ${oneWaySource(skill) ? names[oneWaySource(skill)!] : 'the source'}: name, description and prompt only.`;
  if (cellState === 'synced' && kind === 'agents' && skill.managed && Object.keys(skill.limits ?? {}).length) {
    const receivers = andList(Object.keys(skill.limits ?? {}).map(entry => names[entry as Tool]));
    return skill.kept?.length ? `Source; edit it in ${names[tool]}. ${receivers} can’t hold its ${andList(skill.kept).replace(/ and (?=[^,]*$)/, ' or ')}, so edits only flow out.` : `Source; edit it in ${names[tool]}. ${receivers} can’t hold its ${limitedFields(skill)} settings, so edits only flow out.`;
  }
  if (cellState === 'synced' && was === 'synced' && kind === 'mcp') return skill.waits?.includes('claude-cli') ? 'Has the new copy.' : '';
  const peers = toolList().filter(entry => entry !== tool && cellOf(skill, entry) === 'synced');
  if (cellState === 'synced' && was === 'synced' && peers.length && peers.length < toolList().length - 1) return `Synced. Same copy as ${andList(peers.map(entry => names[entry]))}.`;
  if (cellState === 'synced') return was === 'synced' ? `Synced. Same copy as the other ${toolList().length > 2 ? 'tools' : 'tool'}.` : 'Will be synced when you Apply all. It already has the same copy, so nothing needs copying.';
  if (cellState === 'will-sync') return was === 'will-sync' ? 'Set to sync, but it has no copy yet. Central Knot writes one when you Apply all.' : 'You turned syncing on. Central Knot writes a copy when you Apply all.';
  if (cellState === 'differs' || cellState === 'present-differs') {
    // Size and age are said only where they tell the copies apart.
    const others = comparedTools(skill).filter(entry => entry !== tool).map(entry => skill.versions?.[entry]);
    const tells = version && others.some(other => other && (other.lines !== version.lines || other.changed !== version.changed));
    return `Has a different copy${tells ? ` (${version!.lines}, ${version!.changed})` : ''}.`;
  }
  if (cellState === 'present') return skill.managed ? 'Has its own copy. Syncing to this tool is turned off.' : 'Has its own copy. Central Knot is not managing this skill.';
  return skill.managed ? 'No copy, and syncing here is turned off.' : 'No copy.';
};

/** Names shown as names, so a server called "files" does not read as a word in the sentence. */
const nameList = (items: string[]) => items.flatMap((item, index) => [index ? (index === items.length - 1 ? ' and ' : ', ') : '', h('strong.item-name', {}, item)]).filter(part => part !== '');

const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* the tip just shows again */ } };
const clearFlag = (key: string) => { try { localStorage.removeItem(key); } catch { /* nothing to clear */ } };

/** A tool's different copy that the chosen copy replaces on Apply all. */
function replacedOnApply(skill: SampleSkill, tool: Tool) {
  const chosen = view.draft.get(skill.key)?.resolve;
  if (!chosen || chosen === 'separate' || chosen === tool || skill.off.includes(tool)) return false;
  const base = committedOf(skill.key);
  // A stopped one-way copy counts as replaced: it holds the person's edit, though the table draws it like the source.
  if (kind === 'agents' && base.stopped?.includes(tool)) return true;
  return base.copies[tool] !== undefined && base.copies[tool] !== base.copies[chosen];
}

/** Delete everywhere (DEL-02) for a managed skill: two clicks, the second naming what goes. */
function deleteAction(skill: SampleSkill) {
  if (designMode || kind !== 'skills' || !committedOf(skill.key).managed) return null;
  return view.confirmDelete === skill.key
    ? smallAction(`Delete ${skill.name ?? skill.key} from every tool`, `delete-confirm-${skill.key}`, () => { view.confirmDelete = undefined; void deleteEverywhereKey(skill.key); }, '.text-danger')
    : smallAction('Delete everywhere…', `delete-${skill.key}`, () => { view.confirmDelete = skill.key; rerender(); }, '.text-danger');
}

/** Pi has no native agents (CD §5): an agent can reach it only as a skill, by an explicit, one-time Convert to skill (AGT-02). */
function convertBlock(skill: SampleSkill) {
  if (designMode || !state.home?.manage.tools.includes('pi-cli')) return null;
  const done = state.home.manage.skills.find(entry => entry.converted?.agent.toLowerCase() === skill.key.toLowerCase());
  if (done) return h('p.details-limits.details-note', {}, icon('check', 12, 'tone-muted'), `Converted to a Pi skill, “${done.name}”: see it on the Skills page.`);
  return h('div.convert-block', {},
    h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Pi has no agents. You can convert this one to a skill for Pi: a one-time copy of its name, description and prompt. A skill has no ${andList(['own isolated context', 'tool restrictions', 'model selection'])}, and it is invoked as a skill, not picked as an agent. The agent stays as it is.`),
    smallAction('Convert to a Pi skill', `convert-${skill.key}`, () => void convertAgent(skill.key, skill.name ?? skill.key)));
}

/** Tool rows, with tools that say exactly the same thing (an agent's receiving copies) folded into one row naming them all. */
function groupedRows(skill: SampleSkill, toolRow: (tool: Tool) => HTMLElement) {
  if (kind !== 'agents') return toolList().map(toolRow);
  const byLine = new Map<string, Tool[]>();
  for (const tool of toolList()) { const line = toolLine(skill, tool); byLine.set(line, [...(byLine.get(line) ?? []), tool]); }
  return [...byLine].map(([line, tools]) => tools.length === 1 ? toolRow(tools[0])
    : h('div.details-tool', {}, h('div.details-tool-head', {}, h('span.details-tool-label', {}, ...tools.map(tool => brandMark(tool, 14)), h('strong', {}, andList(tools.map(tool => names[tool])))), h('span.details-tool-line', {}, line))));
}

/** Where each copy lives, folded away: paths matter less than what each tool has. */
function wherePaths(skill: SampleSkill) {
  const shown = toolList().filter(tool => skill.paths?.[tool]);
  if (!shown.length) return null;
  // MCP: the settings files are where a server is changed, so they show open; skills and agents fold them away.
  return h('details.details-paths', kind === 'mcp' ? { open: true } : {}, h('summary', {}, icon('chevron-right', 12, 'tone-faint'), kind === 'mcp' ? 'Settings files' : 'Where each copy is'),
    shown.map(tool => pathLine(tool, skill.paths![tool]!)));
}

/** One file: the tool's name, its path in full, and a way to find it in the file manager. */
function pathLine(tool: Tool, path: string, bare = false) {
  return h(`p.details-path-line${bare ? '.details-path-bare' : ''}`, {}, bare ? null : brandMark(tool, 12), bare ? null : h('span.details-path-tool', {}, names[tool]),
    h('code.details-path-full', { title: path }, shownPath(path)),
    designMode ? null : h('button.inline-link.details-path-show', { type: 'button', title: 'Show this file in the file manager; nothing is opened or changed', onclick: (event: Event) => { event.stopPropagation(); showFile(path); } }, 'Show in folder'));
}

/** Agents: the settings a one-way copy does not get ("tools" or "model"), read from the limits text. */
function limitedFields(skill: SampleSkill) {
  const match = /setting for [^’']+[’']s (.+?), so it gets/.exec(Object.values(skill.limits ?? {})[0] ?? '');
  return match ? match[1] : 'other';
}

/** MCP: the server's definition as labelled lines ("Type HTTP", "URL …"), read from its one-line summary. */
function definition(summary: string) {
  const [kind, ...rest] = summary.split(' · ');
  const value = rest.join(' · ');
  const isCommand = kind === 'Command';
  return h('dl.details-definition', {},
    h('dt', {}, 'Type'), h('dd', {}, isCommand ? 'Command (stdio)' : kind),
    h('dt', {}, isCommand ? 'Command' : 'URL'), h('dd.mono', {}, value),
    h('dd.details-definition-hint', {}, toolList().includes('claude-cli') && toolList().length > 1
      ? `To change it, edit any settings file below. ${andList(toolList().filter(tool => tool !== 'claude-cli').map(tool => names[tool]))} sync on their own; Claude Code updates when you click Write to Claude Code.`
      : 'To change it, edit any settings file below; the change syncs to the others.'));
}

/** Agents: the tool whose copy the one-way copies come from, read from the limits text. */
const oneWaySource = (skill: SampleSkill): Tool | undefined => {
  const match = /^One-way from ([^.]+)\./.exec(Object.values(skill.limits ?? {})[0] ?? '');
  return match ? toolList().find(tool => names[tool] === match[1]) : undefined;
};

/** Agents: what one-way means, said once for every receiving tool, with the way back. */
function oneWayNote(skill: SampleSkill) {
  const receiving = Object.keys(skill.limits ?? {}).filter(tool => !skill.stopped?.includes(tool as Tool)) as Tool[];
  const source = oneWaySource(skill);
  if (!receiving.length || !source) return null;
  const fields = /setting for [^']+'s (.+?), so it gets/.exec(skill.limits![receiving[0]]!)?.[1] ?? 'some settings';
  return h('p.details-limits.details-footnote', {},
    `Edit it in ${receiving.length === 1 ? names[receiving[0]] : andList(receiving.map(tool => names[tool])).replace(' and ', ' or ')} and that copy stops updating (amber box). To use ${names[source]}’s copy again, click that box, then Apply all.`);
}

/** Where an earlier Undo went, said by what it undoes: "The undo for writing files to Claude Code moved to History." */
function movedUndoText(label: string, items: string[]): (string | HTMLElement)[] {
  const named = nameList(items.slice(0, 3));
  const what = /write/i.test(label) ? ['writing ', ...named, ' to Claude Code'] : /Apply all/.test(label) ? ['Apply all', ...(items.length ? [' (', ...named, ')'] : [])] : /choice/i.test(label) ? ['your copy choice', ...(items.length ? [' for ', ...named] : [])] : [label.replace(/^Undo\s*/, '') || 'your last change'];
  return ['Earlier: the undo for ', ...what, ' is in '];
}

/** The two ways forward for a stopped one-way copy, offered in its notice and, once that is put aside, in its details row. */
function stoppedActions(skill: SampleSkill, tool: Tool, source: Tool, where = '') {
  const replace = button({ variant: 'outline', size: 'small', label: `Use ${names[source]}’s copy`, id: `stopped-use-${skill.key}-${tool}${where}`, onclick: () => { resolve(skill.key, source); rerender(); } });
  replace.title = `On Apply all, ${names[tool]} gets ${names[source]}’s copy again; your edit is kept in History`;
  const keep = button({ variant: 'outline', size: 'small', label: `Keep ${names[tool]}’s edit`, id: `stopped-keep-${skill.key}-${tool}${where}`, onclick: () => {
    writeFlag(keptKey(skill, tool)); state.dismissed.add(`stopped:${skill.key}:${tool}`);
    // Keeping the edit is a lasting exception, so it is said with a way back, like every other choice here.
    const name = skill.name ?? skill.key;
    state.outcome = { page: state.page, items: [name], text: `${names[tool]} keeps its own edit of ${name} and no longer receives updates from ${names[source]}. Nothing was written.`,
      act: { label: 'Undo', id: 'outcome-undo-keep', title: `Back to deciding: ${names[tool]}’s copy shows as stopped again`, run: () => { clearFlag(keptKey(skill, tool)); state.dismissed.delete(`stopped:${skill.key}:${tool}`); state.outcome = undefined; announce(`${names[tool]}’s copy of ${name} is waiting for a choice again.`); rerender(); } } };
    announce(state.outcome.text);
    rerender();
  } });
  keep.title = `Leave ${names[tool]}’s copy as you edited it; it stops receiving updates and the warning clears`;
  return [replace, keep];
}

/** The one-way part of an agent's status: tools that still receive, then any copy that stopped or keeps its own edit. */
function oneWayStatus(skill: SampleSkill): string {
  const resolving = !!view.draft.get(skill.key)?.resolve;
  const stopped = resolving ? [] : (skill.stopped ?? []).filter(tool => !skill.off.includes(tool));
  const receiving = Object.keys(skill.limits ?? {}).map(tool => tool as Tool).filter(tool => !skill.off.includes(tool) && !stopped.includes(tool));
  const live = stopped.filter(tool => !keptEdit(skill, tool));
  const kept = stopped.filter(tool => keptEdit(skill, tool));
  return [receiving.length ? ` · one-way to ${andList(receiving.map(tool => names[tool]))}` : '',
    live.length ? ` · ${andList(live.map(tool => `${names[tool]}’s copy`))} stopped updating` : '',
    kept.length ? ` · ${andList(kept.map(tool => names[tool]))} ${kept.length === 1 ? 'keeps its' : 'keep their'} own edit` : ''].join('');
}

/** Everything about one item, opened in place under its row. Differing copies put the choice first. */
function details(skill: SampleSkill, closable = true) {
  const draft = view.draft.get(skill.key);
  const differs = !skill.held && toolList().some(tool => ['differs', 'present-differs'].includes(cellOf(skill, tool)));
  const syncingTo = toolList().filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool]).map(tool => names[tool]);
  const status = skill.held ? `Can’t be managed: ${skill.held}` : skill.separate ? 'Unmanaged. Each tool keeps its own copy.' : skill.managed
    ? (kind === 'agents' && Object.keys(skill.limits ?? {}).length && oneWaySource(skill) ? `Managed · ${names[oneWaySource(skill)!]} is the source${oneWayStatus(skill)}`
      : kind === 'mcp' && skill.waits?.includes('claude-cli') && !draft ? `Waits for Write to Claude Code · synced in ${andList(toolList().filter(tool => tool !== 'claude-cli' && cellOf(skill, tool) === 'synced').map(tool => names[tool]))}`
      : kind === 'mcp' && !draft && toolList().every(tool => cellOf(skill, tool) === 'synced') ? `Synced in ${andList(toolList().map(tool => names[tool]))}`
      : syncingTo.length ? `Managed in ${syncingTo.length === toolList().length && syncingTo.length > 2 ? `all ${syncingTo.length} tools` : andList(syncingTo)}` : 'Managed · syncing to no tool')
    : differs ? 'Not managed yet. Its copies differ.' : 'Unmanaged. Central Knot leaves every copy alone until you manage it.';
  // When every tool simply has the same synced copy, one line says so; per-tool rows are for when something differs.
  // MCP keeps one layout in every state (a row per tool with its status and settings file), so it never takes the one-line form.
  const allSame = kind !== 'mcp' && skill.managed && !draft && toolList().every(tool => cellOf(skill, tool) === 'synced' && !skill.limits?.[tool]);
  const paused = '';
  const toolRow = (tool: Tool) => h('div.details-tool', {},
    h('div.details-tool-head', {}, h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
      h('span.details-tool-line', {}, toolLine(skill, tool),
        // MCP: the settings file sits on the same line as the status, and Claude Code's row can finish the Write step itself.
        kind === 'mcp' && skill.paths?.[tool] ? pathLine(tool, skill.paths[tool]!, true) : null,
        kind === 'mcp' && skill.managed && !draft && tool === 'claude-cli' && skill.waits?.includes(tool) ? h('span.details-tool-actions', {}, button({ variant: 'outline', size: 'small', label: 'Write to Claude Code', id: `write-claude-row-${skill.key}`, onclick: () => void writeClaudeNow([skill.key]) })) : null,
        // Deciding later keeps both choices: once the notice is put aside, the stopped copy's row offers them.
        kind === 'agents' && skill.managed && oneWaySource(skill) && !draft?.resolve && stoppedLive(skill).includes(tool) && state.dismissed.has(`stopped:${skill.key}:${tool}`)
          ? h('span.details-tool-actions', {}, stoppedActions(skill, tool, oneWaySource(skill)!, '-details')) : null)),
    // One-way limits are said once, under the rows (oneWayNote); other kinds keep a per-tool line.
    kind !== 'agents' && skill.limits?.[tool] && !skill.stopped?.includes(tool) ? h('p.details-limits', {}, icon('arrow-up-right', 12, 'tone-warning'), skill.limits[tool]!) : null,
    null);
  // The Write step already sits in the band above whenever an entry waits, so the details only say it, once, in Claude Code's row.
  const waitsHere = false;
  return h(`div.compare.details${differs ? '.details-differs' : ''}${kind === 'mcp' ? '.details-mcp' : ''}`, { role: 'region', 'aria-label': `Details for ${skill.key}` },
    closable && differs && !draft ? h('button.details-close', { type: 'button', id: `close-${skill.key}`, 'aria-label': `Close details for ${skill.key}`, title: 'Close', onclick: () => { view.comparing = undefined; rerender(); } }, icon('x', 14)) : null,
    h('div.details-head', {},
      (!closable && allSame) || (differs && !skill.managed && !draft) ? null : h('p.details-status', {}, allSame ? (kind === 'mcp' ? `Synced in ${andList(toolList().map(tool => names[tool]))}` : `Synced · same copy in ${andList(toolList().map(tool => names[tool]))}${paused}`) : status, draft ? h('span.details-pending', {}, ' · not applied yet') : null),
      kind !== 'mcp' && skill.description && !(differs && !draft) && closable ? h('p.details-description', {}, skill.description) : null,
      kind === 'mcp' && skill.description ? definition(skill.description) : null),
    differs ? compareChoices(skill) : null,
    waitsHere ? h('div.details-waits', {}, icon('clock', 14, 'tone-warning'),
      h('span', {}, `${skill.copies['claude-cli'] === undefined ? 'Claude Code doesn’t have it yet.' : 'Claude Code has an older copy.'}${state.home?.mode === 'fixture' ? '' : ' Quit Claude Code first.'}`),
      button({ variant: 'primary', size: 'small', label: 'Write to Claude Code', id: `write-claude-${skill.key}`, onclick: () => void writeClaudeNow([skill.key]) })) : null,
    // Agents: each tool runs an agent its own way; Central Knot moves the name, description and prompt (AGT-01).
    kind === 'agents' && !Object.keys(skill.limits ?? {}).length && Object.keys(skill.copies).length + toolList().filter(tool => skill.managed && !skill.off.includes(tool) && !skill.copies[tool]).length > 1
      ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), 'Each tool runs agents its own way. Central Knot copies the name, description and prompt; each tool decides how to run them.') : null,
    (skill.extra ?? []).length ? h('div.details-extra', {}, (skill.extra ?? []).map(extra => h('p.details-extra-line', {}, icon(extra.same ? 'check' : 'diff', 12, extra.same ? 'tone-muted' : 'tone-warning'),
      `${names[extra.tool]} also reads ${extra.same ? 'the same copy' : 'a different copy'} at `, h('span.details-path', { title: extra.directory }, shownPath(extra.directory)),
      extra.writable ? '' : '. Central Knot does not change it: it is a link or a folder other tools share.'))) : null,
    allSame
      ? (!closable ? h('div.details-where-row', {}, wherePaths(skill), deleteAction(skill)) : wherePaths(skill))
      : differs && !draft ? wherePaths(skill) : [h('div.details-tools', {}, groupedRows(skill, toolRow)), kind === 'agents' && !skill.stopped?.length ? oneWayNote(skill) : null, kind === 'mcp' ? null : wherePaths(skill)],
    kind === 'agents' ? convertBlock(skill) : null,
    kind === 'skills' && skill.converted ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Converted from ${names[skill.converted.origin] ?? skill.converted.origin}’s agent “${skill.converted.agent}”, as a one-time copy; ${names[skill.converted.origin] ?? skill.converted.origin} keeps the agent, and edits here never change it. As a skill it has no ${andList(skill.converted.losses)}.`) : null,
    // Only skills have foot actions (Files, Delete everywhere); other kinds end at the last line, with no empty foot.
    kind !== 'skills' || designMode || (!closable && allSame) ? null : h('div.compare-foot', {},
      h('span.compare-foot-start', {},
        // Skills have files: the Files view shows each copy's files and contents, and differing copies side by side.
        !designMode && kind === 'skills' && closable && !(differs && !draft) ? smallAction('Files and contents', `files-${skill.key}`, () => { state.skillsView = 'files'; state.item = skill.key; rerender(); }) : null),
      // Delete everywhere (DEL-02): removes a managed skill from every tool it syncs to; History keeps it for Restore.
      !designMode && kind === 'skills' && committedOf(skill.key).managed
        ? view.confirmDelete === skill.key
          ? smallAction(`Delete ${skill.name ?? skill.key} from every tool`, `delete-confirm-${skill.key}`, () => { view.confirmDelete = undefined; void deleteEverywhereKey(skill.key); }, '.text-danger')
          : smallAction('Delete everywhere…', `delete-${skill.key}`, () => { view.confirmDelete = skill.key; rerender(); }, '.text-danger')
        : null));
}

/** The decision for differing copies: each choice says everything Apply all will do with it. */
function compareChoices(skill: SampleSkill) {
  const versions = skill.versions ?? {};
  const compared = toolList().filter(tool => comparedTools(skill).includes(tool));
  const receiving = toolList().filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool] && skill.copies[tool] === undefined && !skill.waits?.includes(tool));
  // Line counts and edit times are shown only where they tell the copies apart.
  const metaDiffers = new Set(compared.map(tool => `${versions[tool]?.lines}|${versions[tool]?.changed}`)).size > 1;
  const effect = (tool: Tool) => {
    const replaced = compared.filter(entry => entry !== tool).map(entry => names[entry]);
    const parts = [replaced.length ? `replaces ${andList(replaced.map(name => `${name}’s copy`))}` : '', receiving.length ? `adds it to ${andList(receiving.map(entry => names[entry]))}` : ''].filter(Boolean);
    return `${parts.join('; ').replace(/^./, first => first.toUpperCase())}.`;
  };
  const choice = (tool: Tool) => {
    const version = versions[tool];
    // A block counts only for a tool it syncs to that can load the skill.
    const block = skill.blocks?.[tool]?.find(entry => !skill.off.includes(entry.tool) && !skill.cannot?.[entry.tool]);
    if (block) return h('button.version.version-blocked', { type: 'button', id: `use-${skill.key}-${tool}`, disabled: true, title: block.reason },
      h('span.version-head', {}, brandMark(tool, 14), h('strong', {}, `Use ${names[tool]}’s copy`)),
      h('span.version-effect.version-why', {}, icon('circle-alert', 12, 'tone-warning'), block.reason));
    return h('button.version', { type: 'button', id: `use-${skill.key}-${tool}`, 'aria-label': `Use ${names[tool]}’s copy`, onclick: () => resolve(skill.key, tool) },
      h('span.version-head', {}, brandMark(tool, 14), h('strong', {}, `${names[tool]}’s copy`)),
      version && metaDiffers ? h('span.version-meta', {}, `${version.lines} · ${version.changed}`) : null,
      version ? h('span.version-text', {}, `“${version.text}”`) : null,
      h('span.version-effect', {}, effect(tool)),
      h('span.version-cta', { 'aria-hidden': 'true' }, 'Use this copy'));
  };
  return h('div.compare-block', {},
    h('p.compare-title', {}, icon('diff', 14, 'tone-warning'), h('span', {}, 'Which copy of ', h('strong.item-name', {}, skill.name ?? skill.key), ` should ${compared.length + receiving.length > 2 ? 'every tool' : 'both tools'} use?`),
      // Comparing comes before choosing: the full files side by side, next to the question.
      !designMode && kind === 'skills' ? smallAction('Read both copies', `diff-${skill.key}`, () => { state.skillsView = 'files'; state.item = skill.key; rerender(); }) : null),
    h('p.compare-note', {}, 'Nothing changes until Apply all. Replaced copies are kept in History, and the chosen copy then stays in sync everywhere.'),
    h('div.compare-choices', {}, compared.map(choice)),
    // The third way is quieter: it decides nothing about content, so it is a line, not a card.
    h('p.compare-separate', {}, 'Or ', smallAction('keep separate copies', `separate-${skill.key}`, () => resolve(skill.key, 'separate')),
      ': each tool keeps its own, nothing is copied, and Central Knot stops flagging ', h('strong.item-name', {}, skill.name ?? skill.key), '.'));
}

/** Opening a row's details brings them into view, so a choice below the fold is not missed. */
function openRow(key: string) {
  view.comparing = view.comparing === key ? undefined : key;
  rerender();
  // Bring the details into view without losing the row (its name and close button) under the sticky header.
  if (view.comparing) requestAnimationFrame(() => {
    const rowEl = document.querySelector(`.ov-row[data-key="${CSS.escape(key)}"]`);
    const details = rowEl?.nextElementSibling;
    const box = rowEl?.closest('.scroll')?.getBoundingClientRect();
    if (!rowEl || !details || !box) return;
    if (details.getBoundingClientRect().bottom > box.bottom) rowEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

function row(skill: SampleSkill) {
  const draft = view.draft.get(skill.key);
  const attention = syncOf(skill, toolList()) === 'attention';
  const decided = draft?.resolve;
  // Resuming a stopped one-way copy has nothing to choose between: its chip cancels.
  const resumeOnly = kind === 'agents' && !!skill.stopped?.length && decided === oneWaySource(skill);
  return [
    h(`div.ov-row${takeFlash(skill.key) ? '.row-flash' : ''}${draft ? '.changed' : ''}${skill.managed ? '' : '.unmanaged'}${view.comparing === skill.key ? '.open' : ''}`, { role: 'row', 'data-key': skill.key, 'aria-expanded': String(view.comparing === skill.key), onclick: () => openRow(skill.key) },
      h('div.ov-name', { role: 'cell', title: skill.description },
        h('button.row-open', { type: 'button', id: `open-${skill.key}`, 'aria-label': `${view.comparing === skill.key ? 'Hide' : 'Show'} details for ${skill.key}`, onclick: (event: Event) => { event.stopPropagation(); openRow(skill.key); } },
          icon(view.comparing === skill.key ? 'chevron-down' : 'chevron-right', 14, 'tone-faint')),
        h('span.ov-name-text', {}, skill.name ?? skill.key),
        // A harness's page gives the name column the free width, so the description fills it.
        focus && skill.description ? h('span.ov-name-desc', {}, skill.description) : null,
        kind === 'agents' && Object.keys(skill.limits ?? {}).length && oneWaySource(skill) && !decided ? h('span.row-tag', { title: `${skill.managed ? 'Syncs' : 'Would sync'} one-way: it uses ${names[oneWaySource(skill)!]}’s ${limitedFields(skill).replace(' or ', ' and ')} settings, which the other tools can’t hold, so they get only its name, description and prompt` }, `one-way from ${names[oneWaySource(skill)!]}`) : null,
        skill.held ? h('span.held-pill', { title: skill.held }, 'Can’t manage') : null,
        attention && !decided ? smallAction('Copies differ', `decide-${skill.key}`, () => { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); }, '.decide') : null,
        decided ? h('span.decided', { title: decided === 'separate' ? 'Keeping separate copies, on Apply all' : `Every tool will use ${names[decided]}’s copy, on Apply all` },
          decided === 'separate' ? h('span', {}, 'Keeping separate')
            : resumeOnly ? h('span', {}, 'Resumes on Apply all')
            : [h('span.decided-uses', {}, 'Uses'), brandMark(decided, 12), h('span', {}, `${names[decided]}’s copy`)],
          h('button.decided-undo', { type: 'button', id: `undo-${skill.key}`, 'aria-label': resumeOnly ? 'Cancel this' : 'Change this choice', title: resumeOnly ? 'Cancel: keep the edited copy' : 'Change this choice', onclick: (event: Event) => { event.stopPropagation(); resolve(skill.key, undefined); view.comparing = resumeOnly ? view.comparing : skill.key; rerender(); } }, h('span', {}, resumeOnly ? 'Cancel' : 'Change'))) : null),
      h(`div.ov-managed${draft && skill.managed !== committedOf(skill.key).managed ? '.managed-pending' : ''}`, { role: 'cell' }, toggle(skill.managed, `Manage ${skill.name ?? skill.key}`, on => { if (on && attention && !decided && !skill.managed) { view.comparing = undefined; openRow(skill.key); return; } setManaged([skill.key], on); }, !!skill.held, `switch-${skill.key}`)),
      toolList().map(tool => cell(skill, tool)),
      h('div.ov-fill')),
    view.comparing === skill.key ? details(skill) : null,
  ];
}

/** A cell's look, small, for keys and counts. */
const swatch = (state: Cell, on: boolean) => h(`span.legend-cell.${cellLook[state].tone}${on ? '.cell-on' : ''}`, { 'aria-hidden': 'true' }, cellLook[state].glyph ? icon(cellLook[state].glyph!, state === 'present' ? 10 : 12, state === 'present' ? 'glyph-fill' : '') : null);

function legend(list: SampleSkill[]) {
  const entry = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  // What is drawn: a pending synced cell is drawn as Starts syncing, a replaced one with its own mark.
  const seen = new Set(list.flatMap(skill => toolList().map(tool => {
    const state = cellOf(skill, tool);
    return state === 'synced' && view.draft.has(skill.key) && cellOf(committedOf(skill.key), tool) !== 'synced' ? 'will-sync' as Cell : state;
  })));
  const replaced = list.some(skill => toolList().some(tool => replacedOnApply(skill, tool)));
  const source = kind === 'agents' && list.some(skill => skill.managed && oneWaySource(skill));
  const oneWay = list.some(skill => skill.managed && Object.keys(skill.limits ?? {}).length);
  const oneWaySwatch = h('span.legend-cell.legend-plain', { 'aria-hidden': 'true' });
  oneWaySwatch.classList.add('cell-oneway');
  oneWaySwatch.append(h('span.cell-oneway-mark', {}, icon('arrow-up-right', 8)));
  const fresh = list.some(skill => toolList().some(tool => cellOf(skill, tool) === 'will-sync' && skill.copies[tool] === undefined));
  const plus = swatch('will-sync', true);
  plus.replaceChildren(icon('plus', 12));
  // Only the marks this table shows, so the key explains exactly what is on screen.
  const keyed = h('div.legend', { 'aria-label': 'Key' },
    seen.has('synced') ? entry('Synced', swatch('synced', true)) : null,
    seen.has('will-sync') ? entry('Starts syncing on Apply all', swatch('will-sync', true)) : null,
    fresh ? entry('New copy on Apply all', plus) : null,
    replaced ? entry('Replaced on Apply all (kept in History)', (() => { const mark = swatch('will-sync', true); mark.replaceChildren(icon('refresh-cw', 11)); return mark; })()) : null,
    seen.has('edited') ? entry('Edited in that tool', swatch('edited', true)) : null,
    seen.has('waiting') ? entry('Waiting for sync', swatch('waiting', true)) : null,
    source ? entry('Source (one-way)', h('span.legend-cell.legend-plain', { 'aria-hidden': 'true' }, h('span.cell-source-mark'))) : null,
    seen.has('write-now') ? entry('Waits for Write to Claude Code', swatch('write-now', true)) : null,
    oneWay ? entry('Receives one-way', oneWaySwatch) : null,
    kind === 'agents' && list.some(skill => skill.managed && stoppedLive(skill).length && !view.draft.get(skill.key)?.resolve) ? entry('Stopped updating (edited in that tool)', (() => { const mark = swatch('differs', true); mark.replaceChildren(icon('circle-pause', 11)); return mark; })()) : null,
    kind === 'agents' && list.some(skill => skill.managed && (skill.stopped ?? []).some(tool => !skill.off.includes(tool) && keptEdit(skill, tool)) && !view.draft.get(skill.key)?.resolve) ? entry('Keeps its own edit', (() => { const mark = swatch('present', true); mark.replaceChildren(icon('circle-pause', 11)); return mark; })()) : null,
    seen.has('differs') || seen.has('present-differs') ? entry('Copies differ', swatch('differs', true)) : null,
    seen.has('present') || seen.has('off') ? entry('Has its own copy', swatch('present', false)) : null,
    seen.has('absent') ? entry('No copy', swatch('absent', false)) : null,
    seen.has('cannot') ? entry('Can’t load it', swatch('cannot', false)) : null,
    // The dashed blue Managed switch is a pending mark too.
    list.some(skill => view.draft.has(skill.key) && skill.managed && !committedOf(skill.key).managed) ? entry('Becomes Managed on Apply all', h('span.legend-switch', { 'aria-hidden': 'true' }, h('span.switch-knob'))) : null);
  // A legend with only "Synced" explains nothing under an all-green table.
  const pendingEntries = [...keyed.children].filter(child => / on Apply all/.test(child.textContent ?? ''));
  if (pendingEntries.length) {
    // Plain states first, then one lead-in and the marks that happen on Apply all, so the lead-in governs only those.
    keyed.append(h('span.legend-lead', {}, 'On Apply all:'), ...pendingEntries);
    for (const entry of pendingEntries) for (const node of [...entry.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = (node.textContent ?? '').replace(/ ?\(?on Apply all\)?/, '').replace(/^./, first => first.toLowerCase());
  }
  return keyed.childElementCount ? keyed : null;
}

// ---------- What differs between the options ----------

// On a harness's page, adding to that harness enrols only the source and that harness, as its menu says.
const pairOnly = (to: Tool) => (to === focus ? toolList() : undefined);
const planAdd = (from: Tool, to: Tool, list: SampleSkill[]) => planAddPure(list.map(effective), from, to, toolList(), !!pairOnly(to));

/** Skills one tool can add to another without deciding between differing copies. */
const sendable = (from: Tool, to: Tool, list: SampleSkill[]) => { const plan = planAdd(from, to, list); return [...plan.fresh, ...plan.same, ...plan.resume]; };

/**
 * Adds a tool's skills to another as pending changes. New and same copies become managed with both tools on.
 * With `conflicts`, differing copies also become managed, choosing the source's copy, tied to the copy seen now.
 */
function send(from: Tool, to: Tool, list: SampleSkill[], conflicts = false) {
  const plan = planAdd(from, to, list);
  for (const skill of [...plan.fresh, ...plan.same, ...plan.resume]) edit(skill.key, (now, draft) => ({ managed: true, off: withBoth(now, from, to, pairOnly(to)).off, ...keepChoice(keepResolve(true, draft?.resolve), draft) }));
  if (conflicts) for (const { skill } of plan.differ) edit(skill.key, (now, draft) => ({
    managed: true, off: withBoth(now, from, to, pairOnly(to)).off, resolve: from,
    // As choosing a copy by hand: undoing the choice puts Managed back as it was.
    prior: draft?.resolve ? draft.prior ?? committedOf(skill.key).managed : now.managed,
    seen: committedOf(skill.key).hashes?.[from],
  }));
  rerender();
}

const skillNames = (list: SampleSkill[]) => list.slice(0, 12).map(skill => skill.name ?? skill.key).join(', ') + (list.length > 12 ? ` and ${list.length - 12} more` : '');

/** One count in a menu row, drawn with the cell the target's column shows for those skills today. */
function addGroup(state: Cell, on: boolean, count: number, word: string, title: string, extra = '', who: string[] = []) {
  if (!count) return null;
  const mark = swatch(state, on);
  // No copy yet: a plus says one will be written, so it does not read as an empty checkbox.
  if (state === 'absent') { mark.classList.add('add-new'); mark.append(icon('plus', 11)); }
  // Up to three are named, so the menu says which skills each group holds; more than that are counted.
  return h(`span.add-group${extra}`, { title, 'data-group': word, 'data-count': String(count) }, mark, h('strong', {}, who.length && who.length <= 3 && who.length === count ? `${who.join(', ')}:` : String(count)), h('span', {}, who.length && who.length <= 3 && who.length === count ? word.replace(': ', ', ') : word));
}

/** One other tool in a tool's menu: what adding this tool's skills there would do, and Add. */
/** `shown` is the tool the row is named for: the target in a tool's own menu, the source in a harness's "Add from" menu. */
function addRow(from: Tool, to: Tool, list: SampleSkill[], shown: Tool = to) {
  const plan = planAdd(from, to, list);
  const key = `${from}>${to}`;
  const conflicts = view.addConflicts.has(key) && plan.differ.length > 0;
  const count = plan.fresh.length + plan.same.length + plan.resume.length + (conflicts ? plan.differ.length : 0);
  // Nothing is copied when every skill is already there: then the button only manages.
  const copies = plan.fresh.length > 0 || conflicts;
  const replaced = toolList().filter(tool => plan.differ.some(entry => entry.replaced.includes(tool)));
  const unavailable = [...plan.skip, ...plan.blocked];
  const showWhy = view.addReasons.has(key);
  const idle = !count && !plan.differ.length;
  const label = count ? `${copies ? 'Add' : 'Manage'} ${count}` : 'Add';
  return h(`div.add-target${conflicts ? '.add-target-conflicts' : ''}`, { 'data-target': to },
    h('div.tool-menu-row', {},
      brandMark(shown, 16), h('span.tool-menu-name', {}, names[shown]),
      idle ? h('span.tool-menu-count', {}, plan.synced.length ? 'Has them all' : 'Nothing to add') : null,
      button({ variant: count ? 'outline' : 'ghost', size: 'small', label, name: `${copies ? 'Add' : 'Manage'} ${count} ${names[from]} skills in ${names[to]}`, id: `menu-add-${from}-${to}`, disabled: !count,
        onclick: () => { send(from, to, list, conflicts); view.toolMenu = undefined; rerender(); } })),
    h('div.add-groups', {},
      addGroup('absent', false, plan.fresh.length, 'new: will be copied', `New in ${names[to]}: a copy is written there on Apply all.\n${skillNames(plan.fresh)}`, '', plan.fresh.map(skill => skill.name ?? skill.key)),
      addGroup('present', false, plan.same.length, 'identical: starts syncing', `${names[to]} already has the same copy. Adding only makes them managed; nothing is copied.\n${skillNames(plan.same)}`, '', plan.same.map(skill => skill.name ?? skill.key)),
      addGroup('present', false, plan.resume.length, 'off here', `Managed, but syncing between ${names[from]} and ${names[to]} is turned off. Adding turns it back on.\n${skillNames(plan.resume)}`),
      addGroup('synced', true, plan.synced.length, 'synced', `Already managed and syncing to ${names[to]}. Nothing to do.\n${skillNames(plan.synced)}`, '.add-group-quiet'),
      unavailable.length ? h('button.add-group.add-group-quiet.add-why', { type: 'button', id: `menu-why-${from}-${to}`, 'data-group': 'can’t', 'aria-expanded': String(showWhy), title: 'Show why',
        onclick: (event: Event) => { event.stopPropagation(); if (showWhy) view.addReasons.delete(key); else view.addReasons.add(key); rerender(); } },
        swatch('cannot', false), h('strong', {}, String(unavailable.length)), h('span', {}, 'can’t'), icon(showWhy ? 'chevron-down' : 'chevron-right', 11)) : null),
    showWhy && unavailable.length ? h('ul.add-why-list', { id: `menu-why-list-${from}-${to}` }, unavailable.slice(0, 20).map(entry => h('li', {}, h('strong', {}, entry.skill.name ?? entry.skill.key), `: ${entry.reason}`)),
      unavailable.length > 20 ? h('li', {}, `and ${unavailable.length - 20} more`) : null) : null,
    plan.differ.length ? h('div.add-conflict', {},
      h('span.add-group', { 'data-group': 'different', title: plan.differ.map(entry => `${entry.skill.name ?? entry.skill.key}: ${entry.here ? `${names[to]}’s copy differs` : `no copy in ${names[to]}; ${andList(entry.replaced.map(tool => names[tool]))} differs`}`).slice(0, 12).join('\n') },
        swatch('differs', true), plan.differ.length === 1 ? null : h('strong', {}, String(plan.differ.length)), h('span', {}, plan.differ.length === 1 ? plan.differ[0].here ? `${plan.differ[0].skill.name ?? plan.differ[0].skill.key}: ${names[from]}’s copy would replace this one` : `${plan.differ[0].skill.name ?? plan.differ[0].skill.key}: added from ${names[from]}’s copy; ${andList(plan.differ[0].replaced.map(tool => `${names[tool]}’s`))} is replaced too` : `with different copies; ${plan.differ.length === 2 ? 'both get' : 'all get'} ${names[from]}’s copy if included`)),
      h('span.add-conflict-label', {}, 'Include'),
      toggle(conflicts, `Also add the ${plan.differ.length} with different copies, using ${names[from]}’s copy`, on => { if (on) view.addConflicts.add(key); else view.addConflicts.delete(key); rerender(); }, false, `menu-conflicts-${from}-${to}`)) : null,
    conflicts ? h('p.add-conflict-note', { id: `menu-conflicts-note-${from}-${to}`, role: 'note' }, icon('triangle-alert', 13, 'tone-warning'),
      h('span', {}, `You accept ${names[from]}’s copy: on Apply all, every tool ${plan.differ.length === 1 ? 'it syncs' : `these ${plan.differ.length} sync`} to uses it. The differing ${replaced.length === 1 && plan.differ.length === 1 ? 'copy' : 'copies'} in ${andList(replaced.map(tool => names[tool]))} ${replaced.length === 1 && plan.differ.length === 1 ? 'is' : 'are'} replaced; Central Knot’s store keeps ${replaced.length === 1 && plan.differ.length === 1 ? 'it' : 'them'}.`)) : null);
}

/** Option B: a tool's header opens a menu offering to use all its skills in each other tool. It grows by one line per tool. */
function toolMenu(tool: Tool, list: SampleSkill[]) {
  const mine = list.filter(skill => effective(skill).copies[tool] !== undefined).length;
  // Stop all: every managed skill stops syncing to this tool. Copies already there stay as they are.
  const syncingHere = list.filter(skill => { const now = effective(skill); return now.managed && !now.off.includes(tool) && !now.cannot?.[tool]; });
  const noun = (n: number) => (n === 1 ? nouns[kind][0].toLowerCase() : nouns[kind][1].toLowerCase());
  return h('div.tool-menu', { role: 'dialog', 'aria-label': `${names[tool]} actions`, onclick: (event: Event) => event.stopPropagation() },
    h('div.tool-menu-head', {}, brandMark(tool, 16), h('strong', {}, names[tool]), h('span.tool-menu-count', {}, `has ${mine} ${noun(mine)}`)),
    // On a harness's own page its menu brings things in: each other tool's items, added here.
    tool === focus ? h('p.tool-menu-label', {}, `Add to ${names[tool]} from…`) : h('p.tool-menu-label', {}, `Add ${names[tool]}’s ${kind === 'mcp' ? 'MCP servers' : nouns[kind][1].toLowerCase()} to…`),
    tool === focus ? others(tool).map(source => addRow(source, tool, list, source)) : others(tool).map(target => addRow(tool, target, list)),
    h('p.tool-menu-foot', {}, 'Adding only queues the change; nothing is written until Apply all.'),
    // Stopping only exists once something syncs to this tool; before that, the foot would be a dead control.
    !syncingHere.length ? null : h('div.tool-menu-stop', {},
      h('span.tool-menu-note', {}, syncingHere.length ? `${syncingHere.length} managed ${syncingHere.length === 1 ? `${noun(1)} syncs` : `${noun(2)} sync`} here. Stopping keeps their copies here but stops updating them.` : `Nothing syncs to ${names[tool]} yet.`),
      button({ variant: 'ghost', size: 'small', label: 'Stop syncing here', name: `Stop syncing all ${syncingHere.length} ${noun(syncingHere.length)} to ${names[tool]}`, id: `menu-stop-${tool}`, disabled: !syncingHere.length, onclick: () => { setTool(syncingHere.map(skill => skill.key), tool, false); view.toolMenu = undefined; rerender(); } })));
}

/** A harness's page: the same menu as its column header, from the toolbar, so bringing items in is never hidden. */
function addFromButton(tool: Tool) {
  return button({ variant: 'outline', size: 'small', icon: 'plus', label: 'Add from…', name: `Add to ${names[tool]} from another tool`, id: 'harness-add-from', attrs: { 'aria-expanded': String(view.toolMenu === tool), 'aria-haspopup': 'dialog' },
    onclick: event => { event.stopPropagation(); view.toolMenu = view.toolMenu === tool ? undefined : tool; view.addConflicts.clear(); view.addReasons.clear(); rerender(); } });
}

/** Moving to another harness starts its tables closed: no row details or menu carried over from the last one. */
export function closeOpenRows() { for (const each of Object.values(views)) { each.comparing = undefined; each.toolMenu = undefined; } }

/** Option A: the actions sit in the headers. A tool's header adds everything the other tool has; a group header manages the group. */
function toolHead(tool: Tool, list: SampleSkill[]) {
  const count = sendable(other(tool), tool, list).length;
  if (variant === 'b') {
    const open = view.toolMenu === tool;
    return h(`div.ov-cell.ov-tool-head.tool-head-b${tool === focus ? '.tool-head-focus' : ''}`, { role: 'columnheader' },
      h('button.tool-head-button', { type: 'button', id: `tool-${tool}`, 'aria-expanded': String(open), 'aria-haspopup': 'dialog', title: tool === focus ? `Options for ${names[tool]}: add other tools’ ${nouns[kind][1].toLowerCase()} here, or stop syncing here` : `Options for ${names[tool]}: copy its ${nouns[kind][1].toLowerCase()} to other tools, or stop syncing here`, onclick: (event: Event) => { event.stopPropagation(); view.toolMenu = open ? undefined : tool; view.addConflicts.clear(); view.addReasons.clear(); rerender(); } },
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

const shortNoun: Record<Kind, [string, string]> = { skills: ['skill', 'skills'], mcp: ['server', 'servers'], agents: ['agent', 'agents'] };

/** Whether the table draws a Managed section, so a move is told on it rather than on Unmanaged. */
let managedDrawn = false;

function section(label: string, list: SampleSkill[], after: number) {
  if (!list.length) return null;
  const sorted = [...list].sort((first, second) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, '')));
  const managing = label === 'Unmanaged';
  const target = managing ? sorted.filter(skill => !skill.managed && !skill.separate && syncOf(skill, toolList()) !== 'attention') : sorted.filter(skill => skill.managed);
  return h('div', { role: 'rowgroup' },
    h('div.ov-section', { role: 'row' },
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(list.length)),
        // A move is told once: on the section it joins, or on Unmanaged when everything there joins Managed.
        after > list.length ? h('span.ov-section-after', {}, `· ${after - list.length} ${after - list.length === 1 ? 'joins' : 'join'} on Apply all`)
          : managing && after < list.length && !managedDrawn ? h('span.ov-section-after', {}, after === 0 ? `· ${list.length === 1 ? 'becomes' : list.length === 2 ? 'both become' : 'all become'} Managed on Apply all` : `· ${list.length - after} become Managed on Apply all`) : null,
        // A bulk Manage leaves items with differing copies out: name them, with the way to choose.
        managing ? (() => {
          const waiting = sorted.filter(skill => !effective(skill).managed && syncOf(skill, toolList()) === 'attention' && !view.draft.get(skill.key)?.resolve);
          return waiting.length ? h('span.ov-section-after', {}, '· ', smallAction(waiting.length === 1 ? `${waiting[0].name ?? waiting[0].key} needs a copy choice first` : `${waiting.length} need a copy choice first`, 'section-choose', () => openRow(waiting[0].key))) : null;
        })() : null),
      variant === 'a' && target.length ? h('div.ov-section-action', {}, smallAction(managing ? `Manage all ${target.length}` : `Unmanage all ${target.length}`, `group-${managing ? 'manage' : 'unmanage'}`, () => setManaged(target.map(skill => skill.key), managing))) : null),
    sorted.flatMap(row));
}


/** What the last action did, where it was done, with History when there is something to undo. */
export { brandMark };

export function outcomeBand(withAction = true): HTMLElement | null {
  const outcome = state.outcome;
  // A result stands until something new is queued, the page changes, or it is dismissed.
  const matrixPage = state.page === 'skills' || state.page === 'mcp' || state.page === 'agents' || state.page === 'harnesses';
  if (!outcome || outcome.page !== state.page || (matrixPage && (view.draft.size || (view.comparing && committedList().some(skill => skill.key === view.comparing && syncOf(skill, toolList()) === 'attention' && [outcome.item, ...(outcome.items ?? [])].some(name => name && (name === skill.name || name.toLowerCase() === skill.key)))))) || (state.skillsView === 'files' && state.item && ![outcome.item, ...(outcome.items ?? [])].some(name => name && name.toLowerCase() === state.item))) return null;
  // Item names are tokens in result text too, so "files" does not read as a word.
  const names = [...new Set([...(outcome.item ? [outcome.item] : []), ...(outcome.items ?? [])])].filter(Boolean).sort((a, b) => b.length - a.length);
  const text: (string | Node)[] = [];
  let rest = outcome.text;
  while (rest) {
    const hits = names.map(name => ({ name, at: rest.search(new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)) })).filter(hit => hit.at >= 0).sort((a, b) => a.at - b.at);
    if (!hits.length) { text.push(rest); break; }
    text.push(rest.slice(0, hits[0].at), h('strong.item-name', {}, hits[0].name));
    rest = rest.slice(hits[0].at + hits[0].name.length);
  }
  return h('div.band.band-done', { role: 'status' }, icon('check', 14, 'tone-success'), h('span.band-text', {}, ...text,
    outcome.note ? h('span.tone-faint', {}, ' ', outcome.note.replace(/ History\.$/, ' '), h('button.inline-link', { type: 'button', id: 'outcome-note-history', onclick: (event: Event) => { event.stopPropagation(); showPage('history'); } }, 'History'), '.') : null),
    !withAction ? null : outcome.act ? button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, attrs: outcome.act.title ? { title: outcome.act.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.act!.run(); } })
      : outcome.undo ? smallAction(outcome.undo.label, 'outcome-undo', () => void restoreEvent(outcome.undo!.id), undefined)
      : outcome.history ? smallAction('Undo in History', 'outcome-history', () => showPage('history')) : null,
    closeButton(() => { state.outcome = undefined; rerender(); }, { id: 'outcome-dismiss' }));
}

/** Sync off: what waits, and the two ways on. Shown on every managed page, since the switch covers all of them. */
function syncOffBand(): HTMLElement | null {
  if (!state.home || state.home.syncOn) return null;
  const waiting = committedList().filter(skill => skill.managed && skill.edited?.length);
  const what = waiting.slice(0, 3).flatMap((skill, index) => [index ? ', ' : '', h('strong.item-name', {}, skill.name ?? skill.key), `, edited in ${andList((skill.edited ?? []).map(tool => names[tool]))}`]).concat(waiting.length > 3 ? [` and ${waiting.length - 3} more`] : []);
  // Right after a sync, its notice says what spread; the idle banner comes back once that is dismissed.
  if (!waiting.length && visibleNotices().length) return null;
  return h('div.band.band-sync-off', { role: 'status' }, icon('circle-minus', 14, waiting.length ? 'tone-warning' : 'tone-muted'),
    h('span.band-text', {}, ...(waiting.length ? [`Automatic sync is off. ${waiting.length} ${waiting.length === 1 ? 'change' : 'changes'} waiting: `, ...what, '.'] : ['Automatic sync is off. Edits and deletions in your tools will wait here.'])),
    waiting.length ? button({ variant: 'outline', size: 'small', label: 'Sync once', id: 'sync-now', attrs: { title: 'Copy the waiting change once; automatic sync stays off' }, onclick: () => void syncNow() }) : null,
    (() => { const on = smallAction('Turn sync on', 'sync-turn-on', () => void setSync(true)); on.title = 'Copy waiting changes now and keep syncing from here on'; return on; })());
}

/** First use of a page: one line on what Managed means and what a click does. */
function helpBand(): HTMLElement | null {
  const list = committedList();
  // Shown until dismissed, so it does not come and go as rows change.
  const key = `ck-help-dismissed-${kind}`;
  if (designMode || !list.length || readFlag(key) || state.skillsView === 'files' || (kind === 'mcp' && view.draft.size)) return null;
  const one = kind === 'mcp' ? 'an MCP server' : kind === 'agents' ? 'an agent' : 'a skill';
  return h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'),
    h('span.band-text.band-lines', {},
      h('span', {}, `Turn on Managed to keep ${one} the same in every tool you include. Nothing is written until Apply all.`),
      h('span.tone-muted', {}, ...(kind === 'agents' && list.some(skill => Object.keys(skill.limits ?? {}).length)
        ? ['Once it’s Managed, click a tool’s box to leave that tool out.']
        : ['Click a tool’s box to include it or leave it out. Turning Managed off keeps existing copies.']))),
    closeButton(() => { writeFlag(key); rerender(); }, { id: 'help-dismiss', label: 'Hide this tip' }));
}

/** Preview-only, stopped and resume states, and what the last Apply all or catch-up did. */
function mcpNotices() {
  const mcp = listView()!;
  const bands: HTMLElement[] = [];
  for (const band of [syncOffBand(), outcomeBand()]) if (band) bands.push(band);
  if (!mcp.access.allowed) bands.push(h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, mcp.access.reason)));
  for (const problem of mcp.problems) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), h('span.band-text', {}, problem)));
  const result = kind === 'agents' ? state.agentsResult : state.mcpResult;
  const told = toldNotices();
  const shownNotices = told.filter(notice => !state.dismissed.has(notice.history || notice.item));
  const pendingClaude = kind === 'mcp' ? mcp.claudePending : [];
  // An Apply result that stepped aside for this notice took its Undo to History: one muted line says so.
  // An earlier result's Undo that stepped aside for this notice: one faint closing line inside the notice, not a band of its own.
  const moved = state.undoMoved?.page === state.page && !state.outcome && shownNotices.some(notice => state.undoMoved!.notices.includes(notice.history || notice.item))
    ? h('span.notice-tail.tone-faint', { id: 'undo-moved' }, ...movedUndoText(state.undoMoved!.label, state.undoMoved!.items), h('button.inline-link', { type: 'button', id: 'notice-undo-moved', onclick: () => showPage('history') }, 'History'), '.') : null;
  if (shownNotices.length) {
    const lines = shownNotices.slice(0, 6).map(notice => syncNotice(notice, pendingClaude.includes(notice.item) ? () => void writeClaudeNow(pendingClaude) : undefined));
    if (moved) {
      const link = lines.at(-1)!.querySelector<HTMLElement>('[id^="notice-history-"]');
      if (link) link.title = `${moved.textContent?.replace(/^Earlier: the undo/, 'The earlier undo').replace(/ is in History\.$/, ' is here too')}.`;
      else lines.at(-1)!.append(moved);
    }
    bands.push(h('div.band.sync-notices', { role: 'status' }, h('div.sync-notice-lines', {}, lines), dismissNotices(shownNotices)));
  }
  // Agents: a one-way copy edited in its receiving tool gets its own notice, with both ways forward.
  const decisions: HTMLElement[] = [];
  if (kind === 'agents') for (const skill of committedList()) {
    const source = oneWaySource(skill);
    if (!source || !skill.managed || view.draft.get(skill.key)?.resolve) continue;
    for (const tool of stoppedLive(skill)) {
      const key = `stopped:${skill.key}:${tool}`;
      if (state.dismissed.has(key)) continue;
      decisions.push(h('div.band.sync-notices', { role: 'status' }, h('div.sync-notice-lines', {}, h('p.sync-notice', { 'data-kind': 'stopped' }, icon('circle-pause', 14, 'tone-warning'),
        h('span.notice-text', {}, h('strong.item-name', {}, skill.name ?? skill.key), ` was edited in ${names[tool]}, so ${names[tool]}’s copy stopped updating`, h('span.notice-age', {}, ` · ${age(key)}`)),
        h('span.notice-actions', {}, stoppedActions(skill, tool, source)),
        closeButton(() => { state.dismissed.add(key); rerender(); }, { id: `stopped-dismiss-${skill.key}-${tool}`, label: 'Decide later', title: 'Decide later; the amber box stays', look: '.notice-dismiss' })))));
    }
  }
  // A notice that needs a choice comes before the ones that only tell.
  if (decisions.length) { const at = bands.findIndex(band => band.classList.contains('sync-notices')); bands.splice(at < 0 ? bands.length : at, 0, ...decisions); }
  // Claude Code rewrites ~/.claude.json while it runs, so its entries wait for an explicit write with Claude closed (MCP-02).
  const toldHere = new Set(shownNotices.map(notice => notice.item));
  const rest = mcp.claudePending.filter(name => !toldHere.has(name));
  if (rest.length) {
    const missing = rest.filter(name => committedList().find(skill => skill.key === name)?.copies['claude-cli'] === undefined);
    const servers = rest.length === 1 ? 'server' : 'servers';
    const what = missing.length === rest.length ? ['Claude Code doesn’t have the ', ...nameList(rest), ` ${servers} yet.`] : [`Claude Code has ${rest.length === 1 ? 'an older copy' : 'older copies'} of the `, ...nameList(rest), ` ${servers}.`];
    // The same inset amber notice as a waiting edit: one look and one place for Write, wherever the step is waiting.
    bands.push(h('div.band.sync-notices.band-write-now', { role: 'status' }, h('div.sync-notice-lines', {}, h('p.sync-notice.notice-stacked.notice-inline', { 'data-kind': 'write' }, icon('clock', 14, 'tone-warning'),
      h('span.notice-text', {}, ...what, state.home?.mode === 'fixture' ? h('span.tone-faint', {}, ' On your real tools, quit Claude Code first.') : ' Quit Claude Code first; it rewrites its settings file while open.'),
      h('span.notice-actions', {}, button({ variant: 'primary', size: 'small', label: 'Write to Claude Code', id: 'mcp-write-claude', attrs: { title: 'Claude Code rewrites ~/.claude.json while it is open, so Central Knot writes it only when Claude Code is closed.' }, onclick: () => void writeClaudeNow(mcp.claudePending) }))))));
  }
  // Before Apply all: say that Claude Code takes a second step, so it is no surprise after.
  if (kind === 'mcp' && [...view.draft].some(([, draft]) => draft.managed && !draft.off.includes('claude-cli')) && toolList().includes('claude-cli'))
  {
    // Name the servers that need the extra step: the ones Claude Code will lack or have an older copy of after Apply all.
    const needs = [...view.draft].filter(([key, draft]) => draft.managed && !draft.off.includes('claude-cli') && committedList().find(skill => skill.key === key)?.copies['claude-cli'] === undefined).map(([key]) => key);
    const who = needs.length ? needs.map(name => h('strong.item-name', {}, name)).flatMap((node, index) => index ? [index === needs.length - 1 ? ' and ' : ', ', node] : [node]) : ['Claude Code'];
    bands.push(h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, 'Apply all writes to Copilot CLI and Codex now. After that, ', ...who, needs.length === 1 ? ' needs' : ' need', ' one more step: ', state.home?.mode === 'fixture' ? 'Write to Claude Code.' : 'quit Claude Code, then click Write to Claude Code.', state.home?.mode === 'fixture' ? h('span.band-why', {}, ' On your real tools, quit Claude Code first.') : h('span.band-why', {}, ' Claude Code rewrites its settings file while running, so it is written only when you click Write.'))));
  }
  const applied = result;
  if (applied?.stopped) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, applied.stopped)));
  const problems = (applied?.results ?? []).filter(result => result.outcome === 'failed' || (result.outcome === 'held' && !/Copies differ|Write now/.test(result.message)));
  if (problems.length) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · '))));
  const tip = helpBand();
  if (tip) bands.push(tip);
  return bands.length ? h('div.bands', {}, bands) : null;
}

function notices() {
  if (designMode || !state.home) return null;
  if (kind !== 'skills') return mcpNotices();
  const manage = state.home.manage;
  const bands: HTMLElement[] = [];
  for (const band of [syncOffBand(), outcomeBand()]) if (band) bands.push(band);
  if (!manage.access.allowed) bands.push(h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, manage.access.reason)));
  if (manage.gate.state === 'stopped') bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, manage.gate.reason)));
  if (manage.gate.state === 'needs-resume') bands.push(h('div.band', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, manage.gate.reason)));
  const applied = state.applied;
  // Skills that cannot go somewhere, or whose copies differ, already show that in their row; the band is for failures.
  const problems = applied ? applied.results.filter(result => result.outcome === 'failed' || (result.outcome === 'held' && !/^Copies differ\./.test(result.message))) : [];
  if (applied?.stopped) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, applied.stopped)));
  else if (problems.length) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · ') + (problems.length > 4 ? ` · and ${problems.length - 4} more` : ''))));
  // What sync did on its own (CON-02): each notice names the item, the winning action and where, says whether the order was proved,
  // and offers its Undo, Restore or Delete everywhere right there.
  const syncNotices = toldNotices().filter(notice => !state.dismissed.has(notice.history || notice.item));
  if (syncNotices.length) bands.push(h('div.band.sync-notices', { role: 'status' }, h('div.sync-notice-lines', {}, syncNotices.slice(0, 6).map(notice => syncNotice(notice)),
    syncNotices.length > 6 ? h('p.sync-notice', {}, `and ${syncNotices.length - 6} more in `, smallAction('History', 'notices-history', () => showPage('history'))) : null), dismissNotices(syncNotices)));
  const caughtProblems = applied ? [] : manage.caughtUp.filter(result => result.outcome !== 'written' && result.outcome !== 'removed');
  if (caughtProblems.length) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text', {}, caughtProblems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · ') + (caughtProblems.length > 4 ? ` · and ${caughtProblems.length - 4} more` : ''))));
  // A spread edit or a restore is already told by its notice; catch-up is only copies that were missing.
  const told = new Set(syncNotices.map(notice => notice.item));
  const caughtNames = [...new Set(manage.caughtUp.filter(result => result.outcome === 'written' && !told.has(result.item)).map(result => result.item))];
  if (caughtNames.length && !applied) bands.push(h('div.band', { role: 'status' }, icon('check', 14, 'tone-success'),
    h('span.band-text', {}, `Caught up: copied ${caughtNames.slice(0, 4).join(', ')}${caughtNames.length > 4 ? ` and ${caughtNames.length - 4} more` : ''} to tools that were missing them. To stop a tool getting a skill back, turn that tool off for it.`)));
  const tip = helpBand();
  if (tip) bands.push(tip);
  return bands.length ? h('div.bands', {}, bands) : null;
}

/** Pending changes belong to one home: opening another starts clean. */
function forgetOtherHomes() {
  if (!designMode && state.home?.home !== draftHomes[kind]) { view.draft.clear(); view.comparing = undefined; draftHomes[kind] = state.home?.home; keptNotices.delete(kind); }
  // A change for a skill that is no longer there has nothing to apply to.
  // So is a choice of a copy that has gone or changed since it was chosen.
  const byKey = new Map(committedList().map(skill => [skill.key, skill]));
  for (const [key, draft] of [...view.draft]) {
    const skill = byKey.get(key);
    const stale = draft.resolve && draft.resolve !== 'separate' && skill?.hashes && skill.hashes[draft.resolve] !== draft.seen;
    // A background change to this skill (deleted, or managed state changed elsewhere) drops the change made against the old state.
    const moved = skill && !designMode && draft.seenManaged !== undefined && draft.seenManaged !== skill.managed;
    if (!skill || stale || moved) {
      view.draft.delete(key);
      if (stale) announce(`${skill!.name ?? key}: the copy you chose changed, so that choice was dropped. Choose again.`);
      else if (moved) announce(`${skill!.name ?? key} changed since you edited it, so your change to it was dropped.`);
    }
  }
}

/** The sync notices on screen now, not yet dismissed. */
// ---------- See change: what an edit did, before Undo ----------
const changes = new Map<string, { before: string; after: string } | null>();
const openChanges = new Set<string>();

/** A quiet link that opens the edit's before and after under the notice or History row. Skills only: their store keeps SKILL.md. */
export function seeChangeLink(eventId: string, key: string, asLink = false) {
  if (!eventId || key.includes(':') || changes.get(eventId) === null) return null;
  const open = openChanges.has(eventId);
  return h(`button.${asLink ? 'btn.link.small' : 'text-action'}.see-change`, { type: 'button', id: `see-change-${eventId}`, 'aria-expanded': String(open), onclick: (event: Event) => {
    event.stopPropagation();
    if (open) { openChanges.delete(eventId); rerender(); return; }
    openChanges.add(eventId);
    if (changes.has(eventId)) { rerender(); return; }
    void window.centralKnot.eventChange(eventId).then(found => { changes.set(eventId, found ?? null); rerender(); });
  } }, open ? 'Hide change' : 'See change');
}

/** The edit as a small diff: added and removed lines, with unchanged runs folded. */
export function changePanel(eventId: string) {
  if (!openChanges.has(eventId)) return null;
  const found = changes.get(eventId);
  if (found === undefined) return h('p.change-panel.tone-faint', {}, 'Reading the change…');
  if (found === null) return h('p.change-panel.tone-faint', {}, 'The earlier version is no longer kept, so the change can’t be shown.');
  const diff = lineDiff(found.before, found.after);
  const added = diff.filter(line => line.kind === 'added').length, removed = diff.filter(line => line.kind === 'removed').length;
  const counts = [added ? `${added} ${added === 1 ? 'line' : 'lines'} added` : '', removed ? `${removed} ${removed === 1 ? 'line' : 'lines'} removed` : ''].filter(Boolean).join(', ') || 'no line changed';
  return h('div.change-panel', {}, h('p.change-caption', {}, `The edit: ${counts}. Undo puts the earlier version back in every tool it syncs to.`), h('pre.ins-diff', { tabindex: '0', 'aria-label': 'What the edit changed' }, folded(diff, false).map(line => line.kind === 'fold'
    ? h('span.ins-fold-static', {}, `… ${line.count} unchanged ${line.count === 1 ? 'line' : 'lines'}\n`)
    : h(`span.ins-line.ins-${line.kind}`, {}, h('span.ins-mark', { 'aria-hidden': 'true' }, line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''), h('span.ins-code', {}, `${line.text}\n`)))));
}

/** A deletion that spread leaves a trace in the table while its notice stands: the name, where it was deleted, and Restore. */
function ghostRows() {
  if (designMode) return null;
  const present = new Set(committedList().map(skill => (skill.name ?? skill.key).toLowerCase()));
  // Not tied to the notice's ×: dismissing the message keeps the way back, until Restore or leaving the page.
  const told = toldNotices();
  const gone = told.filter(notice => notice.kind === 'deleted' && notice.history && notice.item && !present.has(notice.item.toLowerCase()));
  if (!gone.length) return null;
  return h('div', { role: 'rowgroup' }, gone.map(notice => h('div.ov-row.ov-ghost', { role: 'row', 'data-ghost': notice.item },
    h('div.ov-name', { role: 'cell' }, h('span.row-open-spacer'), h('s.ov-name-text', {}, notice.item), h('span.ov-ghost-why', {}, `deleted in ${names[notice.winner] ?? notice.winner}`)),
    h('div.ov-ghost-text', { role: 'cell' }, h('span'),
      button({ variant: 'link', size: 'small', label: 'Restore in all tools', id: `ghost-restore-${notice.history}`, attrs: { title: `Put ${notice.item} back in every tool it synced to` }, onclick: () => void restoreEvent(notice.history) })))));
}

/** Notices stay until read: each read brings only what is new, so the page keeps earlier ones until × or Undo, or another home. */
type Told = SyncNotice & { once?: boolean };
const keptNotices = new Map<Kind, Map<string, Told>>();
const keptSync = new Map<Kind, boolean>();
function toldNotices(): Told[] {
  if (!state.home) return [];
  const fresh = kind === 'skills' ? [...state.home.manage.notices, ...(state.applied?.notices ?? [])] : [...(listView()?.notices ?? []), ...((kind === 'agents' ? state.agentsResult : state.mcpResult)?.notices ?? [])];
  let kept = keptNotices.get(kind);
  if (!kept) keptNotices.set(kind, kept = new Map());
  // A newer event, or turning sync on or off, retires what was said before: it stays in History.
  const news = fresh.filter(notice => !kept!.has(notice.history || notice.item));
  if (news.length || keptSync.get(kind) !== state.home.syncOn) for (const key of [...kept.keys()]) if (!fresh.some(notice => (notice.history || notice.item) === key)) kept.delete(key);
  keptSync.set(kind, state.home.syncOn);
  // The wording is fixed when the notice first shows: a Sync once stays "Synced once" after sync is turned on.
  for (const notice of fresh) { const key = notice.history || notice.item; if (!kept.has(key)) kept.set(key, { ...notice, once: !state.home.syncOn }); }
  for (const key of [...kept.keys()]) if (state.dismissed.has(key)) kept.delete(key);
  return [...kept.values()].reverse();
}

function visibleNotices() {
  if (!state.home) return [];
  const told = toldNotices();
  return told.filter(notice => !state.dismissed.has(notice.history || notice.item));
}

/** Notices stay until read; a quiet × clears them. */
// Each notice has its own ×; with three or more, one more control dismisses them all.
const dismissNotices = (list: SyncNotice[]) => list.length < 3 ? null : smallAction('Dismiss all', 'notices-dismiss', () => { for (const notice of list) state.dismissed.add(notice.history || notice.item); rerender(); });

/** When Central Knot first showed each notice, so a notice left up says how old it is. */
const firstShown = new Map<string, number>();
/** Rows a notice just told about, so they can show a brief highlight. */
const flashed = new Map<string, number>();
/** A row flashes on the first draw after its notice, once; later redraws leave it calm. */
const takeFlash = (key: string) => {
  if (flashRequests.delete(key)) return true;
  const at = flashed.get(key); if (at === undefined) return false; flashed.delete(key); return Date.now() - at < 3000;
};
const age = (key: string) => {
  if (!firstShown.has(key)) firstShown.set(key, Date.now());
  const minutes = Math.floor((Date.now() - firstShown.get(key)!) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
};

function syncNotice(notice: Told, writeClaude?: () => void) {
  const who = (tool: string) => names[tool] ?? tool;
  const list = (tools: string[]) => andList(tools.map(who));
  const order = notice.orderProved ? '' : ' The order could not be proved, so the fixed tool order decided.';
  // The button names the tools it changes: all of them, or only those the event touched.
  const involved = [...new Set([notice.winner, ...notice.losers].filter(Boolean))] as string[];
  const scope = involved.length >= toolList().length ? 'in all tools' : `in ${list(involved)}`;
  // Undo is the one action here that writes files: a small outlined button, apart from the quieter links.
  const undo = (title: string) => { const action = button({ variant: 'outline', size: 'small', label: writeClaude ? `Undo edit in ${list(notice.losers.length ? [notice.winner, ...notice.losers] : [notice.winner])}` : `Undo ${notice.kind === 'edit' ? 'edit ' : ''}${scope}`, id: `notice-undo-${notice.history}`, onclick: () => void restoreEvent(notice.history) }); action.title = title; action.setAttribute('aria-label', `Undo: ${title}`); return action; };
  const offNow = notice.once ?? (!!state.home && !state.home.syncOn);
  const [glyph, tone, text, action] = ({
    edit: ['check', 'tone-success', offNow ? `${notice.item} copied from ${who(notice.winner)} to ${list(notice.losers)}.` : `${notice.item} was edited in ${who(notice.winner)} and copied to ${list(notice.losers)}.`, undo(`Put ${notice.item} back as it was before ${who(notice.winner)}’s edit, in every tool it syncs to (${who(notice.winner)} too)`)],
    conflict: ['diff', 'tone-warning', `${notice.item}: ${who(notice.winner)}’s edit won over ${list(notice.losers)}’s.${order}`, undo(`Use ${list(notice.losers)}’s version of ${notice.item} instead, in every tool it syncs to`)],
    deleted: ['trash-2', 'tone-muted', `${notice.item} was deleted in ${who(notice.winner)}, so it was removed from ${list(notice.losers) || 'nowhere else'} too.`, button({ variant: 'outline', size: 'small', label: `Restore ${scope}`, id: `notice-restore-${notice.history}`, onclick: () => void restoreEvent(notice.history) })],
    'kept-edit': ['diff', 'tone-warning', `${notice.item}: ${who(notice.winner)}’s edit was kept over its deletion in ${list(notice.losers)}.${order}`, notice.orderProved || notice.key.includes(':') ? null : smallAction('Delete everywhere', `notice-delete-${notice.key}`, () => void deleteEverywhereKey(notice.key))],
    reset: ['triangle-alert', 'tone-warning', kind === 'mcp' ? `${who(notice.winner)}’s settings file lost every managed server at once, so Central Knot put them back instead of deleting them everywhere. To delete one, remove it in one tool while the others still have it.` : `${who(notice.winner)}’s skills folder lost every managed skill at once, so Central Knot put them back instead of deleting them everywhere. To delete one, use Delete everywhere in its details.`, null],
  } as Record<SyncNotice['kind'], [IconName, string, string, HTMLElement | null]>)[notice.kind];
  // The item's name opens its row here, so "what changed" is one click from the change itself.
  const rowKey = committedList().find(skill => skill.name === notice.item || skill.key === notice.item.toLowerCase())?.key;
  const noticeKey = notice.history || `${notice.kind}:${notice.item}`;
  state.seenNotices.add(notice.history || notice.item);
  if (rowKey && !firstShown.has(noticeKey)) flashed.set(rowKey, Date.now());
  // The item's name opens its row: one click from "what changed" to the item, with no separate Details link.
  const name = rowKey && view.comparing !== rowKey
    ? h('button.item-name.notice-name', { type: 'button', id: `notice-open-${notice.history || notice.item}`, title: `Show ${notice.item}’s details`, onclick: (event: Event) => { event.stopPropagation(); view.comparing = undefined; openRow(rowKey); } }, notice.item)
    : h('strong.item-name', {}, notice.item);
  const said = notice.item && text.startsWith(notice.item) ? [name, text.slice(notice.item.length)] : [text];
  // With sync off, a notice can only come from Sync now: say sync stays off, and offer to turn it on.
  const off = state.home && !state.home.syncOn && notice.kind !== 'reset';
  const history = !off && (notice.kind === 'deleted' || notice.kind === 'edit' || notice.kind === 'conflict') ? smallAction('History', `notice-history-${notice.history}`, () => showPage('history')) : null;
  // MCP: an edit Claude Code still lacks is one band with its write step, in the waiting tone.
  const quiet = off;
  // Waiting for Claude Code: the sentence takes the full width, and the actions sit on their own line, Write first.
  return h(`p.sync-notice${writeClaude ? '.notice-stacked' : ''}`, { 'data-kind': notice.kind }, icon(writeClaude ? 'clock' : glyph, 14, writeClaude ? 'tone-warning' : tone),
    h('span.notice-text', {}, offNow && notice.kind !== 'deleted' && notice.kind !== 'reset' ? 'Synced once: ' : '', ...said.map(part => typeof part === 'string' ? part.replace(/\.$/, '') : part), '', h('span.notice-age', {}, ` · ${age(notice.history || `${notice.kind}:${notice.item}`)}`)),
    writeClaude ? (() => {
      const row = committedList().find(skill => skill.name === notice.item || skill.key === notice.item);
      const before = row?.versions?.['claude-cli']?.text, after = row?.versions?.[notice.winner as Tool]?.text;
      if (!before || !after || before === after) return null;
      const bare = (summary: string) => summary.replace(/^[^·]+·\s*/, '');
      const field = /^Command/.test(after) ? 'command' : 'URL';
      // Words that differ are marked: struck in Claude Code's entry, tinted in the new one.
      const words = (from: string, to: string, keep: 'removed' | 'added') => lineDiff(from.split(/(\s+)/).join('\n'), to.split(/(\s+)/).join('\n'))
        .filter(part => part.kind === 'same' || part.kind === keep).map(part => part.kind === 'same' ? part.text : h(`span.change-${keep}`, {}, part.text));
      // The field is named once, above the pair; short tool labels keep the old and new values side by side.
      return h('span.notice-change', {},
        h('span.notice-change-caption', {}, field === 'URL' ? 'URL' : 'Command'),
        h('span.tone-faint', {}, 'Claude Code (older)'), h('code', {}, ...words(bare(before), bare(after), 'removed')),
        h('span.tone-faint', {}, `${[notice.winner, ...notice.losers].map(who).join(', ')} (new)`), h('code.notice-change-new', {}, ...words(bare(before), bare(after), 'added')));
    })() : null,
    h('span.notice-actions', {},
      writeClaude ? button({ variant: 'primary', size: 'small', label: 'Write to Claude Code', id: 'mcp-write-claude', onclick: writeClaude }) : null,
      notice.kind === 'edit' || notice.kind === 'conflict' ? seeChangeLink(notice.history, notice.key) : null,
      action, history, quiet ? smallAction('Turn sync on', `notice-sync-on-${notice.history || notice.item}`, () => void setSync(true)) : null,
      writeClaude ? h('span.tone-faint.notice-quit', {}, state.home?.mode === 'fixture' ? 'On your real tools, quit Claude Code first.' : 'Quit Claude Code first.') : null),
    closeButton(event => { event.stopPropagation(); state.dismissed.add(notice.history || notice.item); rerender(); }, { id: `notice-dismiss-${notice.history || notice.item}`, label: `Dismiss this notice about ${notice.item || 'the reset'}`, title: 'Dismiss', look: '.notice-dismiss' }),
    notice.history ? changePanel(notice.history) : null);
}

/** `harness`: the Harnesses page's view of one tool: its column first, and the rows split by whether it has a copy. */
export function designOverview(which: Kind = 'skills', harness?: Tool) {
  kind = which;
  view = views[which];
  focus = harness;
  forgetOtherHomes();
  const all = rows();
  const needle = view.find.trim().toLowerCase();
  const shown = all.filter(skill => (view.filter === 'all' || (view.filter === 'managed' ? committedOf(skill.key).managed : view.filter === 'unmanaged' ? !committedOf(skill.key).managed : syncOf(skill, toolList()) === 'attention'))
    && (!needle || skill.key.includes(needle) || skill.description.toLowerCase().includes(needle)));
  const find = h('input.find-input', { id: 'find', type: 'text', placeholder: 'Find', 'aria-label': 'Find', value: view.find, spellcheck: 'false',
    oninput: (event: Event) => { view.find = (event.target as HTMLInputElement).value; rerender(); document.getElementById('find')?.focus(); } });
  return h('div.page.ov-page', { 'data-variant': variant },
    h('div.toolbar', {}, h('div.find', {}, icon('search', 16, 'find-glyph'), find), filterBar(), h('div.toolbar-end', {}, focus && others(focus).length ? addFromButton(focus) : null, changeBar())),
    notices(),
    h('div.scroll.matrix', {},
      variant === 'c' ? shownStrip(shown) : null,
      withToolCount(h('div.ov', { role: 'table', 'aria-label': `${nouns[kind][1]} and where they sync` },
        h('div.ov-row.ov-head', { role: 'row' },
          h('div.ov-name', { role: 'columnheader' }, nouns[kind][0]),
          h('div.ov-managed', { role: 'columnheader' }, 'Managed'),
          toolList().map(tool => toolHead(tool, shown)),
          h('div.ov-fill')),
        ...(() => {
          const here = shown.filter(inFocus), away = shown.filter(skill => !inFocus(skill));
          managedDrawn = here.some(skill => committedOf(skill.key).managed);
          return [
            section('Managed', here.filter(skill => committedOf(skill.key).managed), here.filter(skill => skill.managed).length),
            section('Unmanaged', here.filter(skill => !committedOf(skill.key).managed), here.filter(skill => !skill.managed).length),
            // Items only other tools have: their box in this tool's column adds them here.
            focus ? section(`Not in ${names[focus]}`, away, away.length) : null];
        })(),
        ghostRows()), toolList().length),
      legend(all)));
}


// ---------- Skills page ----------

/** A small cell for the list: the same look as the Overview's, without the button. */
const miniCell = (skill: SampleSkill, tool: Tool) => {
  const state = cellOf(skill, tool);
  const base = committedOf(skill.key);
  const pending = state !== 'cannot' && (state !== cellOf(base, tool) || (skill.managed && !skill.off.includes(tool)) !== (base.managed && !base.off.includes(tool)));
  const look = pending && state === 'synced' ? cellLook['will-sync'] : cellLook[state];
  const on = skill.managed && !skill.off.includes(tool);
  return h(`span.legend-cell.mini-cell.${look.tone}${on ? '.cell-on' : ''}`, { title: `${names[tool]}: ${look.label}` }, look.glyph ? icon(look.glyph, state === 'present' ? 9 : 11, state === 'present' ? 'glyph-fill' : '') : null);
};

/** A list of every skill beside one skill's details: the same choices as the Overview, and the same Apply all. `more` adds files and contents. */
export function skillsBrowser(more: (key: string) => (Node | null | false)[], select: (key: string | undefined) => void) {
  kind = 'skills';
  view = views.skills;
  focus = undefined;
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
      h('div.toolbar.list-toolbar', {}, button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Table', name: 'Back to the skills table', id: 'skills-table', onclick: () => { state.skillsView = 'table'; state.item = undefined; rerender(); } }), h('div.find', {}, icon('search', 16, 'find-glyph'), find)),
      h('div.list-head', { 'aria-hidden': 'true' }, h('span', {}, 'Skill'), h('span.list-cells', {}, toolList().map(tool => h('span.list-head-tool', { title: names[tool] }, brandMark(tool, 12))))),
      h('div.scroll.list-scroll', { id: 'skills-list' }, list)),
    h('section.detail-column', { 'aria-label': 'Skill details' },
      h('div.pane-header', {},
        h('div.crumb', {},
          button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Skills', id: 'detail-back', onclick: () => select(undefined) }),
          h('span.crumb-sep', { 'aria-hidden': 'true' }, '/')),
        h('div.pane-title', {}, h('h2', {}, middle(skill.name ?? skill.key)), draft ? h('p', {}, 'Not applied yet')
          : h('p', {}, skill.managed && toolList().every(tool => cellOf(skill, tool) === 'synced') ? `Synced · same copy in ${andList(toolList().map(tool => names[tool]))}` : skill.managed ? 'Managed' : 'Unmanaged')),
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
