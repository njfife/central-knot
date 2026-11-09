// Profiles: named sets of skills and MCP servers, switched in one click (here, from the status bar, or from the menu bar).
// The list shows each profile and which one is in use; the open profile shows every item with a box (in the profile or not) and,
// per tool, whether it is on now and what a switch would change. Ticking only edits the profile; tools change on Switch.
import { deleteProfileDef, profileState, rerender, saveProfileDef, showPage, shownPath, state, switchToProfile } from './app.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import { button, emptyState, h, icon } from './dom.ts';
import { driftOf, flipCounts, offByHand, planSwitch, switchItems, type SwitchItem, type SwitchPlan } from './profileplan.ts';
import { toolName } from './words.ts';
import { plural } from './model.ts';
import type { HarnessId, Profile } from './types.ts';

let find = '';
const NONE = 'none';

const onePane = () => document.body.classList.contains('one-pane');
const tools = (): HarnessId[] => { const home = state.home!; return [...new Set([...home.manage.tools, ...home.mcp.tools])]; };
const items = (): SwitchItem[] => switchItems(state.home!.manage, state.home!.mcp);
const profiles = () => state.home!.profiles;
const canWrite = () => !state.busy && state.home!.manage.access.allowed && !profiles().problem;
const flipKey = (item: string, tool: HarnessId) => `${item}|${tool}`;
const named = (tool: HarnessId) => toolName(tool) ?? tool;
const danger = (control: HTMLElement) => { control.classList.add('text-danger'); return control; };

/** The profile shown: the one opened, else (two panes) the one in use, the first, or No profile. */
function openId(): string | undefined {
  const view = profiles();
  if (profileState.open && (profileState.open === NONE || view.profiles.some(profile => profile.id === profileState.open))) return profileState.open;
  if (onePane()) return undefined;
  return view.active ?? NONE;
}

/** A name nobody uses yet: "New profile", then "New profile 2"… */
function freshName() {
  const taken = new Set(profiles().profiles.map(profile => profile.name.toLowerCase()));
  for (let n = 1; ; n++) { const name = n === 1 ? 'New profile' : `New profile ${n}`; if (!taken.has(name.toLowerCase())) return name; }
}
const newProfile = () => { profileState.renaming = 'new'; void saveProfileDef({ name: freshName(), items: [] }, 'New profile made. Name it, then tick what it turns on.').then(() => { profileState.renaming = profileState.open; rerender(); focusName(); }); };
const focusName = () => { const input = document.getElementById('profile-name') as HTMLInputElement | null; input?.focus(); input?.select(); };

const changeWords = ({ off, on }: { off: number; on: number }) => [off && `turns ${plural(off, 'item')} off`, on && `turns ${plural(on, 'item')} back on`].filter(Boolean).join(' and ');

// ---------- List ----------

function listRow(id: string, name: string, count: string, active: boolean, selected: boolean) {
  return h(`button.list-row.profile-row${selected ? '.selected' : ''}`, { type: 'button', id: `profile-row-${id}`, 'aria-current': selected ? 'true' : undefined,
    // Opening another profile starts it clean: the last switch's result belonged to the one before.
    onclick: () => { if (profileState.open !== id && state.outcome?.page === 'profiles') state.outcome = undefined; profileState.open = id; profileState.confirmDelete = undefined; profileState.renaming = undefined; rerender(); } },
    icon(id === NONE ? 'circle-dashed' : 'sliders-horizontal', 14, 'tone-muted'),
    h('span.list-name.profile-row-name', { title: name }, name),
    count ? h('span.list-fraction', {}, count) : null,
    active ? h('span.profile-in-use', { title: `${name} is in use` }, icon('check', 12), 'In use') : null);
}

function listColumn(open: string | undefined) {
  const view = profiles();
  const known = new Set(items().map(item => item.id));
  return h('div.list-column.profiles-list', {},
    h('div.toolbar.list-toolbar', {}, h('span.toolbar-title', {}, 'Profiles'),
      h('div.toolbar-end', {}, button({ variant: 'outline', size: 'small', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canWrite(), onclick: newProfile }))),
    h('div.scroll', { id: 'profiles-list-scroll' },
      listRow(NONE, 'No profile', '', !view.active, open === NONE),
      view.profiles.map(profile => listRow(profile.id, profile.name, plural(profile.items.filter(item => known.has(item)).length, 'item'), view.active === profile.id, open === profile.id))));
}

// ---------- The open profile ----------

/**
 * How one tool's cell looks: its state now, or (in blue, ringed) the state the view's action leaves it in. The legend lists only
 * the looks a table shows.
 */
type Look = 'on' | 'held' | 'hand' | 'blocked' | 'none' | 'to-off' | 'to-on';
const looks: Record<Look, { key: string; mark: () => Node }> = {
  'on': { key: 'On', mark: () => h('span.pf-dot', { 'aria-hidden': 'true' }) },
  'held': { key: 'Off by a profile', mark: () => icon('sliders-horizontal', 14) },
  'hand': { key: 'Off by hand (profiles leave it)', mark: () => icon('circle-pause', 14, 'tone-muted') },
  'blocked': { key: 'Can’t be switched (reason below)', mark: () => icon('circle-alert', 14, 'tone-warning') },
  'none': { key: 'No copy', mark: () => icon('minus', 14, 'tone-faint') },
  'to-off': { key: 'Turns off when you', mark: () => icon('sliders-horizontal', 14, 'tone-accent') },
  'to-on': { key: 'Turns back on when you', mark: () => h('span.pf-dot.pf-dot-accent', { 'aria-hidden': 'true' }) },
};
const pending = (look: Look) => look === 'to-off' || look === 'to-on';

/**
 * One table's context: the profile being edited (none on the No profile view), the plan its action would carry out, what profiles
 * hold off, how that action is said after "when you" (switch, apply, stop using profiles), and the looks drawn so far.
 */
interface TableView { profile?: Profile; plan: SwitchPlan; held: Record<string, HarnessId[]>; action: string; seen: Set<Look> }

function lookOf(item: SwitchItem, tool: HarnessId, view: TableView): { look: Look; said: string } {
  const now = item.tools[tool];
  const flip = view.plan.flips.find(entry => entry.item === item.id && entry.tool === tool);
  if (!now) return { look: 'none', said: 'no copy' };
  if (flip) return flip.disabled ? { look: 'to-off', said: `on now · turns off when you ${view.action}` } : { look: 'to-on', said: `off now · turns back on when you ${view.action}` };
  if (item.blocked[tool]) return { look: 'blocked', said: `can’t be switched: ${item.blocked[tool]}` };
  if (now === 'on') return { look: 'on', said: 'on' };
  return view.held[item.id]?.includes(tool) ? { look: 'held', said: 'off (a profile turned it off)' } : { look: 'hand', said: 'off (turned off by hand; profiles leave it off)' };
}

function cell(item: SwitchItem, tool: HarnessId, view: TableView) {
  const { look, said } = lookOf(item, tool, view);
  view.seen.add(look);
  const text = `${named(tool)}: ${said}`;
  return h(`span.pf-cell${pending(look) ? '.pf-cell-pending' : ''}`, { role: 'cell', title: text, 'aria-label': text, 'data-col': tool }, looks[look].mark());
}

/** A profile's tick box: saved at once, to the profile only; tools change on Switch or Apply. */
function tick(profile: Profile, id: string, checked: boolean, mixed: boolean, label: string, help: string, items: string[]) {
  return h('label.pf-tick', { title: help },
    h('input.hidden-input', { type: 'checkbox', id, checked, disabled: !canWrite(), 'aria-label': label, 'aria-description': help,
      onchange: () => void saveProfileDef({ id: profile.id, name: profile.name, items }) }),
    icon(checked ? 'square-check' : mixed ? 'square-minus' : 'square', 14, 'tick-box'));
}

function itemRow(item: SwitchItem, view: TableView) {
  const profile = view.profile;
  const included = !!profile?.items.includes(item.id);
  const help = included ? `Included in ${profile?.name}: switching to it leaves ${item.name} on, or turns it back on where a profile turned it off. A tool where you turned it off by hand stays off. Click to leave it out.`
    : `Not in ${profile?.name}: switching to it turns ${item.name} off. Click to include it.`;
  const cells = tools().map(tool => cell(item, tool, view));
  // What the cells and a cut-off description say, in words: read with the tick box, and shown under the row while it has
  // keyboard focus, so nothing here needs a mouse.
  const states = tools().map(tool => `${named(tool)}: ${lookOf(item, tool, view).said}`).join(' · ');
  return h(`div.pf-row${included ? '.pf-included' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' },
      profile ? tick(profile, `pf-${item.id}`, included, false, `${item.name} (${item.kind === 'mcp' ? 'MCP server' : 'skill'}) in ${profile.name}`, `${help} ${states}.`, included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id]) : null,
      h('span.pf-name-text', { title: item.name }, item.name), item.description ? h('span.pf-desc', { title: item.description }, item.description) : null,
      profile ? h('span.pf-tip', { 'aria-hidden': 'true' }, item.description ? h('span.pf-tip-desc', {}, item.description) : null, h('span', {}, states)) : null),
    cells);
}

function section(title: string, list: SwitchItem[], view: TableView) {
  if (!list.length) return null;
  const profile = view.profile;
  const inside = profile ? list.filter(item => profile.items.includes(item.id)).length : 0;
  const all = !!profile && inside === list.length;
  const ids = new Set(list.map(item => item.id));
  const tickAll = profile ? tick(profile, `pf-all-${title}`, all, inside > 0, `${title}: all in ${profile.name}`, all ? `Leave every one out of ${profile.name}` : `Put every one in ${profile.name}`,
    all ? profile.items.filter(entry => !ids.has(entry)) : [...new Set([...profile.items, ...ids])]) : null;
  return [h('div.pf-section', { role: 'row' }, h('span.pf-section-label', { role: 'cell' }, tickAll, h('strong', {}, title), h('span.pf-section-count', {}, profile ? `${inside} of ${list.length} ticked` : String(list.length)))),
    ...list.map(item => itemRow(item, view))];
}

/** The items with a column per tool, a key to the looks it shows, and why any switch can't be changed. */
function table(list: SwitchItem[], options: Pick<TableView, 'profile' | 'plan' | 'action'>) {
  const view: TableView = { ...options, held: profiles().held, seen: new Set() };
  const head = h('div.pf-row.pf-head', { role: 'row' }, h('span.pf-name', { role: 'columnheader' }, view.profile ? 'In profile' : 'Item'),
    tools().map(tool => h('span.pf-cell.pf-head-cell', { role: 'columnheader', 'data-col': tool }, brandMark(tool, 14), h('span.pf-head-name', {}, named(tool)))));
  const grid = h(`div.pf-table${view.profile ? '.pf-table-profile' : ''}`, { role: 'table', 'aria-label': view.profile ? `What ${view.profile.name} has on` : 'Turned off by profiles' }, head,
    section('Skills', list.filter(item => item.kind === 'skill'), view), section('MCP servers', list.filter(item => item.kind === 'mcp'), view));
  grid.style.setProperty('--pf-tools', String(tools().length));
  const legend = h('div.pf-legend', { 'aria-label': 'Key' }, (Object.keys(looks) as Look[]).filter(look => view.seen.has(look)).map(look =>
    h('span', {}, h(`span.pf-legend-mark${pending(look) ? '.pf-cell-pending' : ''}`, { 'aria-hidden': 'true' }, looks[look].mark()), pending(look) ? `${looks[look].key} ${view.action}` : looks[look].key)));
  return [grid, legend, notes(list, view)];
}

/**
 * What the marks can't say on their own, in words under the key: each tool that can't be switched (once, with the file that
 * stops it), and each ticked item a tool has off by hand.
 */
function notes(list: SwitchItem[], view: TableView) {
  const lines: Node[] = [];
  for (const tool of tools()) {
    const blocked = list.filter(item => item.blocked[tool]);
    if (!blocked.length) continue;
    const files = [...new Set(blocked.flatMap(item => item.blocked[tool]!.match(/\S+\.(?:json|toml)\b/g) ?? []))];
    const kinds = [...new Set(blocked.map(item => (item.kind === 'mcp' ? 'MCP servers' : 'skills')))].join(' and ');
    lines.push(h('li', {}, icon('circle-alert', 14, 'tone-warning'), h('span', {}, h('strong', {}, `${named(tool)}: `), `its settings can’t be read right now, so its ${kinds} can’t be switched. Central Knot doesn’t change ${files.length === 1 ? 'that file' : 'those files'}.`,
      files.map(file => h('span.pf-note-path', { title: file }, shownPath(file))))));
  }
  if (view.profile) for (const item of list.filter(entry => view.profile!.items.includes(entry.id))) {
    const hand = offByHand(item, view.held);
    if (hand.length) lines.push(h('li', {}, looks.hand.mark(), h('span', {}, h('strong', {}, item.name), ` is off by hand in ${hand.map(named).join(' and ')}: profiles leave it off. ${item.kind === 'skill' ? 'Turn it on there from the Skills page.' : `Turn it on in ${hand.length === 1 ? 'that tool’s' : 'those tools’'} own MCP settings.`}`)));
  }
  return lines.length ? h('ul.pf-blocked', {}, lines) : null;
}

/** Find, the count, and (for a profile) when ticks take effect: they save at once; tools change on the header's action. */
function findBar(shown: number, total: number, saves?: string) {
  const input = h('input.find-input', { id: 'profile-find', type: 'text', placeholder: 'Find', 'aria-label': 'Find a skill or MCP server', value: find, spellcheck: 'false',
    oninput: (event: Event) => { find = (event.target as HTMLInputElement).value; rerender(); },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Escape' && find) { find = ''; rerender(); } } });
  return h('div.toolbar', {}, h('label.find', {}, icon('search', 16, 'find-glyph'), input,
    find ? button({ variant: 'ghost', size: 'micro', icon: 'x', name: 'Clear', id: 'profile-find-clear', onclick: () => { find = ''; rerender(); document.getElementById('profile-find')?.focus(); } }) : null),
    h('div.toolbar-end', {}, saves ? h('span.pf-save-note', {}, saves) : null, find ? h('span.result-count', {}, `${shown} of ${total}`) : null));
}

const matches = (item: SwitchItem) => !find || `${item.name} ${item.description}`.toLowerCase().includes(find.toLowerCase());

/** The pane header: name (or its field while renaming), what a switch would do, and the actions. */
function header(title: string, subtitle: string, actions: (Node | null)[], editable?: Profile, glyph: 'sliders-horizontal' | 'circle-dashed' = 'sliders-horizontal') {
  const back = button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Profiles', id: 'profile-back', onclick: () => { const was = profileState.open; profileState.open = undefined; rerender(); document.getElementById(`profile-row-${was}`)?.focus(); } });
  back.classList.add('profile-back');
  const renaming = editable && profileState.renaming === editable.id;
  // When the field goes, keyboard focus goes on with the task: to the setup step of an empty profile, else to Rename.
  const next = () => (document.getElementById('profile-from-now') ?? document.getElementById('profile-rename'))?.focus();
  // Enter, Escape or leaving the field finishes it once (a field removed by the redraw may still report leaving).
  let done = false;
  const save = (input: HTMLInputElement, then = next) => { if (done) return; done = true; profileState.renaming = undefined; profileState.draft = undefined; if (input.value.trim() && input.value.trim() !== editable!.name) void saveProfileDef({ ...editable!, name: input.value }, `Renamed to ${input.value.trim()}.`).then(then); else { rerender(); then(); } };
  const name = renaming ? h('input.profile-name-input', { id: 'profile-name', type: 'text', value: profileState.draft ?? editable!.name, maxlength: '40', 'aria-label': 'Profile name', spellcheck: 'false',
    // Kept as typed, so a redraw while renaming (a background refresh) keeps the text.
    oninput: (event: Event) => { profileState.draft = (event.target as HTMLInputElement).value; },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') save(event.target as HTMLInputElement); if (event.key === 'Escape') { done = true; profileState.renaming = undefined; profileState.draft = undefined; rerender(); next(); } },
    // Leaving the field saves it, once whatever was clicked has had its click (a redraw on mouse-down would swallow it);
    // focus stays where the person put it.
    onblur: (event: Event) => { const input = event.target as HTMLInputElement; if (input.isConnected) setTimeout(() => save(input, () => undefined)); } }) : h('h2', { title }, title);
  return h('div.pane-header.profile-header', {}, back, icon(glyph, 16, 'tone-muted'),
    h('div.pane-title', {}, name, h('p', { title: subtitle }, subtitle)), h('div.detail-actions.profile-actions', {}, ...actions));
}

function profileDetail(profile: Profile) {
  const view = profiles();
  const all = items();
  const active = view.active === profile.id;
  const empty = !profile.items.length;
  // An empty profile not in use can't be switched to yet, so it previews no switch: its first step is choosing what it has.
  const plan = empty && !active ? { flips: [], held: view.held, blocked: [] } : planSwitch(all, profile, view.held);
  const change = flipCounts(plan.flips);
  const differ = plan.flips.length;
  // In use but not matching: the profile was edited since, an item turned up, or a switch was turned back by hand.
  // A tool whose settings file can't be used is named here too; why, and items off by hand, are under the table.
  const blockedTools = [...new Set(all.flatMap(item => Object.keys(item.blocked) as HarnessId[]))];
  const stuck = blockedTools.length ? ` · ${blockedTools.map(named).join(' and ')} can’t be switched` : '';
  // Said in short here too, since the notes under the table can be below the fold in a small window.
  const byHand = profile.items.filter(id => { const item = all.find(entry => entry.id === id); return item && offByHand(item, view.held).length; }).length;
  const handNote = byHand ? ` · ${byHand} off by hand` : '';
  const subtitle = (active ? (differ ? `In use · Apply to tools ${changeWords(change)} to match it` : 'In use · new sessions in your tools use it')
    : empty ? 'Tick what it should have on' : differ ? `Switching ${changeWords(change)} · new sessions use it` : 'Switching only makes it the profile in use; no tool changes') + handNote + stuck;
  const writeReason = !state.home!.manage.access.allowed ? state.home!.manage.access.reason : undefined;
  // While renaming, the name field has the header to itself.
  const renaming = profileState.renaming === profile.id;
  const primary = (active && !differ) || (empty && !active) || renaming ? null : button({ variant: 'primary', size: 'small', label: active ? 'Apply to tools' : profile.name.length > 18 ? 'Switch to this profile' : `Switch to ${profile.name}`, id: 'profile-switch', disabled: !canWrite(),
    attrs: { title: writeReason ?? (active ? `Make your tools match ${profile.name} again: ${changeWords(change)}` : `Use ${profile.name}: ${changeWords(change) || 'nothing needs switching'}. One step in History, with Undo.`) },
    onclick: () => void switchToProfile(profile.id) });
  const confirming = profileState.confirmDelete === profile.id;
  const cancel = button({ variant: 'ghost', size: 'small', label: active ? 'OK' : 'Cancel', id: 'profile-delete-cancel', onclick: () => { profileState.confirmDelete = undefined; rerender(); document.getElementById('profile-delete')?.focus(); } });
  const actions = confirming
    ? active ? [h('span.profile-confirm', { role: 'status' }, `${profile.name} is in use. Switch to No profile or another profile first, then delete it.`),
        button({ variant: 'outline', size: 'small', label: 'Stop using profiles', id: 'profile-stop', attrs: { title: 'Turn back on what profiles turned off; then Delete works. One step in History, with Undo.' }, onclick: () => { profileState.confirmDelete = undefined; void switchToProfile(null); } }), cancel]
      : [h('span.profile-confirm', {}, `Delete ${profile.name}? Your tools stay as they are.`), danger(button({ variant: 'outline', size: 'small', label: 'Delete', id: 'profile-delete-confirm', onclick: () => void deleteProfileDef(profile.id) })), cancel]
    : renaming ? [h('span.profile-confirm.tone-muted', {}, 'Enter to save · Esc to cancel')] : [primary, button({ variant: 'ghost', size: 'small', label: 'Rename', id: 'profile-rename', disabled: !canWrite(), onclick: () => { profileState.renaming = profile.id; rerender(); focusName(); } }),
      danger(button({ variant: 'ghost', size: 'small', label: 'Delete', id: 'profile-delete', disabled: !canWrite(), onclick: () => { profileState.confirmDelete = profile.id; rerender(); document.getElementById(active ? 'profile-delete-cancel' : 'profile-delete-confirm')?.focus(); } }))];
  const shown = all.filter(matches);
  return h('div.detail-column', {}, header(profile.name, subtitle, actions, profile),
    empty ? h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, `Nothing is in ${profile.name} yet. Tick what it should have on, or start from what is on now. Switching to it turns the rest off.`),
      button({ variant: 'primary', size: 'small', label: 'Start from what’s on now', id: 'profile-from-now', disabled: !canWrite(), attrs: { title: 'Tick every skill and MCP server that is on in at least one tool' },
        onclick: () => void saveProfileDef({ ...profile, items: all.filter(item => Object.values(item.tools).includes('on')).map(item => item.id) }, `${profile.name} now has what is on.`) })) : null,
    findBar(shown.length, all.length, primary && !active ? 'Ticks save at once · tools change on Switch' : 'Ticks save at once'),
    h('div.scroll.pf-scroll', { id: 'profile-scroll' }, shown.length ? table(shown, { profile, plan, action: active ? 'apply' : 'switch' }) : h('p.pf-none', {}, find ? `Nothing matches “${find}”.` : 'This home has no skills or MCP servers yet.')));
}

/** No profile: everything as set by hand. Shows what profiles still hold off, and how profiles work. */
function noProfileDetail() {
  const view = profiles();
  const all = items();
  const plan = planSwitch(all, undefined, view.held);
  const heldItems = all.filter(item => view.held[item.id]?.length);
  const active = !view.active;
  const primary = active && !plan.flips.length ? null : button({ variant: 'primary', size: 'small', label: active ? 'Apply to tools' : 'Stop using profiles', id: 'profile-switch', disabled: !canWrite(),
    attrs: { title: `Turn back on the ${plural(new Set(plan.flips.map(flip => flip.item)).size, 'item')} profiles turned off` }, onclick: () => void switchToProfile(null) });
  const subtitle = active ? 'In use · everything is as you set it in each tool' : `Switching turns ${plural(new Set(plan.flips.map(flip => flip.item)).size, 'item')} back on: everything a profile turned off`;
  return h('div.detail-column', {}, header('No profile', subtitle, [primary], undefined, 'circle-dashed'),
    h('div.scroll.pf-scroll', { id: 'profile-scroll' },
      h('ul.pf-how', {},
        h('li', {}, icon('sliders-horizontal', 14, 'tone-muted'), h('span', {}, 'A profile is the skills and MCP servers you want on for one kind of work. Switching to it turns everything else off with each tool’s own switch; nothing is moved or deleted.')),
        h('li', {}, icon('circle-pause', 14, 'tone-muted'), h('span', {}, 'Something you turned off yourself in one tool stays off. Profiles only turn back on what a profile turned off.')),
        h('li', {}, icon('refresh-cw', 14, 'tone-muted'), h('span', {}, 'Managed items keep syncing while they are off, so they are up to date when they come back.')),
        h('li', {}, icon('history', 14, 'tone-muted'), h('span', {}, 'Each switch is one step in History, with Undo. Switch here, from the status bar, or from Central Knot’s menu bar menu.'))),
      heldItems.length ? [h('h3.eyebrow.pf-eyebrow', {}, 'Turned off by profiles', h('span.eyebrow-count', {}, String(heldItems.length))), ...table(heldItems, { plan, action: active ? 'apply' : 'stop using profiles' })] : null));
}

// ---------- Page ----------

export function profilesPage(): HTMLElement {
  const home = state.home;
  if (!home) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
  const view = home.profiles;
  const bands = [outcomeBand(),
    view.problem ? h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', { title: view.problem }, view.problem)) : null,
    !home.manage.access.allowed ? h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, `${home.manage.access.reason} Profiles can be looked at, not changed.`)) : null].filter(Boolean);
  if (!view.profiles.length) {
    return h('div.page.profiles-page', {}, bands.length ? h('div.bands', {}, bands) : null, emptyState('sliders-horizontal', 'Switch between sets of skills and MCP servers',
      'Make a profile for each kind of work, such as Incident or Development, and tick what it needs. Switching to it, here, from the status bar or from the menu bar icon, turns everything else off in your tools, for their next sessions. Nothing is deleted, and Undo switches back.',
      button({ variant: 'primary', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canWrite(), onclick: newProfile })));
  }
  const open = openId();
  if (open) document.body.classList.add('has-item');
  const profile = view.profiles.find(entry => entry.id === open);
  return h('div.page.profiles-page', {}, bands.length ? h('div.bands', {}, bands) : null,
    h('div.page.split.profiles-split', {}, listColumn(open), open === NONE ? noProfileDetail() : profile ? profileDetail(profile) : h('div.detail-column')));
}

/** Arrow keys, Home and End move between the menu's items; Escape closes it; Tab closes it once focus has moved on. */
function menuKeys(event: KeyboardEvent, close: () => void) {
  if (event.key === 'Escape') { close(); return; }
  // A click elsewhere already closes it (the document listener below); Tab leaving it does too, after focus has moved.
  if (event.key === 'Tab') { setTimeout(() => { if (menuOpen && !document.activeElement?.closest('.pf-menu')) { menuOpen = false; rerender(); } }); return; }
  const items = [...document.querySelectorAll<HTMLElement>('.pf-menu-item:not(:disabled)')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
  if (to === undefined || !items.length) return;
  event.preventDefault();
  items[(to + items.length) % items.length].focus();
}

/** The status bar's profile item: the one in use, and a menu to switch in one click. */
let menuOpen = false;
export function profileStatus(): HTMLElement | null {
  const home = state.home;
  if (!home || !home.profiles.profiles.length) return null;
  const view = home.profiles;
  const active = view.profiles.find(profile => profile.id === view.active);
  // The tools no longer match the profile in use (edited since, something new, or turned back by hand): a dot says so.
  const drift = driftOf(items(), view);
  const close = () => { menuOpen = false; rerender(); document.getElementById('status-profile')?.focus(); };
  // An empty profile would turn everything off: like the page, the menu offers it only once it has something in it.
  const choice = (id: string | null, name: string, empty = false, size?: number) => h('button.pf-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String((id ?? undefined) === view.active), id: `status-profile-${id ?? NONE}`, disabled: !canWrite() || empty,
    title: empty ? `${name} has nothing in it yet. Tick what it should have on, on the Profiles page.` : name,
    // Focus goes back to the status item only for a keyboard choice; after a click it would sit there ringed.
    // The profile in use, chosen again while its tools no longer match it, applies it (as the menu bar's radio item does).
    onclick: (event: MouseEvent) => { menuOpen = false; if (event.detail === 0) document.getElementById('status-profile')?.focus(); else (document.activeElement as HTMLElement | null)?.blur(); if ((id ?? undefined) !== view.active || drift) void switchToProfile(id); else rerender(); } },
    h('span.pf-menu-tick', {}, (id ?? undefined) === view.active ? icon('check', 14) : null), h('span.pf-menu-name', {}, empty ? `${name} (empty)` : name), size !== undefined && !empty ? h('span.pf-menu-size', {}, plural(size, 'item')) : null,
    (id ?? undefined) === view.active && drift ? h('span.pf-menu-note', {}, `Apply to tools (${drift})`) : null);
  const menu = menuOpen ? h('div.pf-menu', { role: 'menu', 'aria-label': 'Switch profile', onkeydown: (event: KeyboardEvent) => menuKeys(event, close) },
    choice(null, 'No profile'), view.profiles.map(profile => choice(profile.id, profile.name, !profile.items.length && profile.id !== view.active, profile.items.length)), h('div.pf-menu-sep', { role: 'separator' }),
    h('button.pf-menu-item', { type: 'button', role: 'menuitem', id: 'status-profile-edit', onclick: () => { menuOpen = false; profileState.open = active?.id ?? NONE; showPage('profiles'); } }, h('span.pf-menu-tick'), h('span.pf-menu-name', {}, 'Edit profiles…'))) : null;
  return h('span.status-profile-wrap', {},
    h('button.status-item.status-profile', { type: 'button', id: 'status-profile', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), disabled: !!state.busy,
      title: `${active ? `Profile: ${active.name}.` : 'Profile: none in use.'}${drift ? ` ${plural(drift, 'switch', 'switches')} no longer match it: Apply to tools on the Profiles page.` : ''} Click to switch profile.`,
      onclick: (event: Event) => { event.stopPropagation(); menuOpen = !menuOpen; rerender(); if (menuOpen) (document.querySelector('.pf-menu-item[aria-checked="true"]') as HTMLElement | null)?.focus(); } },
      icon('sliders-horizontal', 14), h('span.status-clip', {}, active ? active.name : 'No profile'), drift ? [h('span.status-profile-drift', { 'aria-hidden': 'true' }), h('span.status-profile-drift-text', {}, `${drift} to apply`)] : null, icon('chevron-up', 12, 'status-profile-chevron')),
    menu);
}
// A click anywhere else closes the profile menu.
document.addEventListener('click', event => { if (menuOpen && !(event.target as Element).closest?.('.status-profile-wrap')) { menuOpen = false; rerender(); } });
