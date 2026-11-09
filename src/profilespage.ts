// Profiles: named sets of skills and MCP servers, switched in one click (here, from the status bar, or from the menu bar).
// The list shows each profile and which one is in use; the open profile shows every item with a box (in the profile or not) and,
// per tool, whether it is on now and what a switch would change. Ticking only edits the profile; tools change on Switch.
import { deleteProfileDef, profileState, rerender, saveProfileDef, showPage, state, switchToProfile } from './app.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import { button, emptyState, h, icon } from './dom.ts';
import { planSwitch, switchItems, type SwitchItem, type SwitchPlan } from './profileplan.ts';
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

/** Counts of items a plan turns off and back on. */
function counts(plan: SwitchPlan) {
  const size = (disabled: boolean) => new Set(plan.flips.filter(flip => flip.disabled === disabled).map(flip => flip.item)).size;
  return { off: size(true), on: size(false) };
}
const changeWords = ({ off, on }: { off: number; on: number }) => [off && `turns ${plural(off, 'item')} off`, on && `turns ${plural(on, 'item')} back on`].filter(Boolean).join(' and ');

// ---------- List ----------

function listRow(id: string, name: string, count: string, active: boolean, selected: boolean) {
  return h(`button.list-row.profile-row${selected ? '.selected' : ''}`, { type: 'button', id: `profile-row-${id}`, 'aria-current': selected ? 'true' : undefined,
    onclick: () => { profileState.open = id; profileState.confirmDelete = undefined; profileState.renaming = undefined; rerender(); } },
    icon(id === NONE ? 'circle-dashed' : 'sliders-horizontal', 14, 'tone-muted'),
    h('span.list-name.profile-row-name', { title: name }, name),
    active ? h('span.profile-in-use', { title: `${name} is in use` }, icon('check', 12), 'In use') : h('span.list-fraction', {}, count));
}

function listColumn(open: string | undefined) {
  const view = profiles();
  const known = new Set(items().map(item => item.id));
  return h('div.list-column.profiles-list', {},
    h('div.toolbar.list-toolbar', {}, h('span.toolbar-title', {}, 'Profiles'),
      h('div.toolbar-end', {}, button({ variant: 'outline', size: 'small', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canWrite(), onclick: newProfile }))),
    h('div.scroll', { id: 'profiles-list-scroll' },
      listRow(NONE, 'No profile', '', !view.active, open === NONE),
      view.profiles.map(profile => listRow(profile.id, profile.name, String(profile.items.filter(item => known.has(item)).length), view.active === profile.id, open === profile.id))));
}

// ---------- The open profile ----------

/** One tool's state for an item: on, off (by a profile or by hand), no copy, or no switch; and what a switch changes. */
function cell(item: SwitchItem, tool: HarnessId, plan: SwitchPlan | undefined, held: Record<string, HarnessId[]>) {
  const now = item.tools[tool];
  const flip = plan?.flips.find(entry => entry.item === item.id && entry.tool === tool);
  const blocked = item.blocked[tool];
  const byProfile = now === 'off' && held[item.id]?.includes(tool);
  const [glyph, tone, said] = !now ? ['minus', 'tone-faint', 'no copy']
    : blocked ? ['circle-alert', 'tone-warning', `can’t be switched: ${blocked}`]
      : now === 'on' ? ['dot', '', 'on']
        : byProfile ? ['circle-off', 'tone-warning', 'off (a profile turned it off)'] : ['circle-off', 'tone-muted', 'off (turned off by hand; profiles leave it off)'];
  const change = flip ? (flip.disabled ? ' · turns off when you switch' : ' · turns back on when you switch') : '';
  const text = `${named(tool)}: ${said}${change}`;
  return h(`span.pf-cell${flip ? '.pf-cell-pending' : ''}`, { role: 'cell', title: text, 'aria-label': text, 'data-col': tool },
    glyph === 'dot' ? h('span.pf-dot', { 'aria-hidden': 'true' }) : icon(glyph as 'minus', 14, tone));
}

function itemRow(item: SwitchItem, profile: Profile | undefined, plan: SwitchPlan | undefined, held: Record<string, HarnessId[]>) {
  const included = !!profile?.items.includes(item.id);
  const toggle = profile ? h('label.pf-tick', { title: included ? `In ${profile.name}: on when you switch to it. Click to leave it out.` : `Not in ${profile.name}: off when you switch to it. Click to include it.` },
    h('input.hidden-input', { type: 'checkbox', id: `pf-${item.id}`, checked: included, disabled: !canWrite(),
      onchange: () => void saveProfileDef({ id: profile.id, name: profile.name, items: included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id] }, `${item.name} ${included ? 'left out of' : 'added to'} ${profile.name}.`) }),
    icon(included ? 'square-check' : 'square', 14, 'tick-box')) : null;
  return h(`div.pf-row${included ? '.pf-included' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' }, toggle, h('span.pf-name-text', { title: item.name }, item.name), item.description ? h('span.pf-desc', { title: item.description }, item.description) : null),
    tools().map(tool => cell(item, tool, plan, held)));
}

function section(title: string, list: SwitchItem[], profile: Profile | undefined, plan: SwitchPlan | undefined, held: Record<string, HarnessId[]>) {
  if (!list.length) return null;
  const inside = profile ? list.filter(item => profile.items.includes(item.id)).length : 0;
  const all = profile && inside === list.length;
  const ids = new Set(list.map(item => item.id));
  const tickAll = profile ? h('label.pf-tick', { title: all ? `Leave every one out of ${profile.name}` : `Put every one in ${profile.name}` },
    h('input.hidden-input', { type: 'checkbox', id: `pf-all-${title}`, checked: !!all, disabled: !canWrite(), 'aria-label': `${title}: all in ${profile.name}`,
      onchange: () => void saveProfileDef({ id: profile.id, name: profile.name, items: all ? profile.items.filter(entry => !ids.has(entry)) : [...new Set([...profile.items, ...ids])] }) }),
    icon(all ? 'square-check' : inside ? 'square-minus' : 'square', 14, 'tick-box')) : null;
  return [h('div.pf-section', { role: 'row' }, h('span.pf-section-label', { role: 'cell' }, tickAll, h('strong', {}, title), h('span.pf-section-count', {}, profile ? `${inside} of ${list.length} in ${profile.name}` : String(list.length)))),
    ...list.map(item => itemRow(item, profile, plan, held))];
}

function table(list: SwitchItem[], profile: Profile | undefined, plan: SwitchPlan | undefined) {
  const held = profiles().held;
  const head = h('div.pf-row.pf-head', { role: 'row' }, h('span.pf-name', { role: 'columnheader' }, profile ? 'In profile' : 'Item'),
    tools().map(tool => h('span.pf-cell.pf-head-cell', { role: 'columnheader', 'data-col': tool }, brandMark(tool, 14), h('span.pf-head-name', {}, named(tool)))));
  const table = h('div.pf-table', { role: 'table', 'aria-label': profile ? `What ${profile.name} has on` : 'Turned off by profiles' }, head,
    section('Skills', list.filter(item => item.kind === 'skill'), profile, plan, held), section('MCP servers', list.filter(item => item.kind === 'mcp'), profile, plan, held));
  table.style.setProperty('--pf-tools', String(tools().length));
  return table;
}

const legend = () => h('div.pf-legend', { 'aria-label': 'Key' },
  h('span', {}, h('span.pf-dot', { 'aria-hidden': 'true' }), 'On'),
  h('span', {}, icon('circle-off', 14, 'tone-warning'), 'Off by a profile'),
  h('span', {}, icon('circle-off', 14, 'tone-muted'), 'Off by hand (profiles leave it)'),
  h('span', {}, h('span.pf-cell.pf-cell-pending.pf-legend-ring', { 'aria-hidden': 'true' }), 'Changes when you switch'),
  h('span', {}, icon('minus', 14, 'tone-faint'), 'No copy'));

function findBar(shown: number, total: number) {
  const input = h('input.find-input', { id: 'profile-find', type: 'text', placeholder: 'Find', 'aria-label': 'Find a skill or MCP server', value: find, spellcheck: 'false',
    oninput: (event: Event) => { find = (event.target as HTMLInputElement).value; rerender(); },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Escape' && find) { find = ''; rerender(); } } });
  return h('div.toolbar', {}, h('label.find', {}, icon('search', 16, 'find-glyph'), input,
    find ? button({ variant: 'ghost', size: 'micro', icon: 'x', name: 'Clear', id: 'profile-find-clear', onclick: () => { find = ''; rerender(); document.getElementById('profile-find')?.focus(); } }) : null),
    h('div.toolbar-end', {}, h('span.result-count', {}, find ? `${shown} of ${total}` : plural(total, 'item'))));
}

const matches = (item: SwitchItem) => !find || `${item.name} ${item.description}`.toLowerCase().includes(find.toLowerCase());

/** The pane header: name (or its field while renaming), what a switch would do, and the actions. */
function header(title: string, subtitle: string, actions: (Node | null)[], editable?: Profile) {
  const back = button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Profiles', id: 'profile-back', onclick: () => { profileState.open = undefined; rerender(); } });
  back.classList.add('profile-back');
  const renaming = editable && profileState.renaming === editable.id;
  const save = (input: HTMLInputElement) => { profileState.renaming = undefined; if (input.value.trim() && input.value.trim() !== editable!.name) void saveProfileDef({ ...editable!, name: input.value }, `Renamed to ${input.value.trim()}.`); else rerender(); };
  const name = renaming ? h('input.profile-name-input', { id: 'profile-name', type: 'text', value: editable!.name, maxlength: '40', 'aria-label': 'Profile name', spellcheck: 'false',
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') save(event.target as HTMLInputElement); if (event.key === 'Escape') { profileState.renaming = undefined; rerender(); } },
    onblur: (event: Event) => { if (profileState.renaming) save(event.target as HTMLInputElement); } }) : h('h2', { title }, title);
  return h('div.pane-header.profile-header', {}, back, icon('sliders-horizontal', 16, 'tone-muted'),
    h('div.pane-title', {}, name, h('p', { title: subtitle }, subtitle)), h('div.detail-actions.profile-actions', {}, ...actions));
}

function profileDetail(profile: Profile) {
  const view = profiles();
  const all = items();
  const plan = planSwitch(all, profile, view.held);
  const active = view.active === profile.id;
  const change = counts(plan);
  const differ = plan.flips.length;
  const subtitle = active ? (differ ? `In use · ${plural(differ, 'switch', 'switches')} no longer match it: something new, or turned back on by hand` : 'In use · new sessions in your tools use it')
    : differ ? `Switching ${changeWords(change)}` : 'Switching changes nothing right now';
  const writeReason = !state.home!.manage.access.allowed ? state.home!.manage.access.reason : undefined;
  const primary = active && !differ ? null : button({ variant: 'primary', size: 'small', label: active ? 'Apply again' : `Switch to ${profile.name}`, id: 'profile-switch', disabled: !canWrite(),
    attrs: { title: writeReason ?? (active ? `Turn off what is on but not in ${profile.name}, and back on what it turned off` : `Use ${profile.name}: ${changeWords(change) || 'nothing needs switching'}. One step in History, with Undo.`) },
    onclick: () => void switchToProfile(profile.id) });
  const confirming = profileState.confirmDelete === profile.id;
  const actions = confirming
    ? [h('span.profile-confirm', {}, `Delete ${profile.name}? Your tools stay as they are.`), danger(button({ variant: 'outline', size: 'small', label: 'Delete', id: 'profile-delete-confirm', onclick: () => void deleteProfileDef(profile.id) })),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'profile-delete-cancel', onclick: () => { profileState.confirmDelete = undefined; rerender(); } })]
    : [primary, button({ variant: 'ghost', size: 'small', label: 'Rename', id: 'profile-rename', disabled: !canWrite(), onclick: () => { profileState.renaming = profile.id; rerender(); focusName(); } }),
      danger(button({ variant: 'ghost', size: 'small', label: 'Delete', id: 'profile-delete', disabled: !canWrite() || active, attrs: active ? { title: 'It is in use. Switch to another profile first.' } : undefined, onclick: () => { profileState.confirmDelete = profile.id; rerender(); } }))];
  const shown = all.filter(matches);
  const empty = !profile.items.some(item => all.some(entry => entry.id === item));
  return h('div.detail-column', {}, header(profile.name, subtitle, actions, profile),
    empty ? h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, `Nothing is in ${profile.name} yet. Tick what it turns on; switching to it turns the rest off.`),
      button({ variant: 'outline', size: 'small', label: 'Start from what’s on now', id: 'profile-from-now', disabled: !canWrite(), attrs: { title: 'Tick every skill and MCP server that is on in at least one tool' },
        onclick: () => void saveProfileDef({ ...profile, items: all.filter(item => Object.values(item.tools).includes('on')).map(item => item.id) }, `${profile.name} now has what is on.`) })) : null,
    findBar(shown.length, all.length),
    h('div.scroll.pf-scroll', { id: 'profile-scroll' }, shown.length ? table(shown, profile, plan) : h('p.pf-none', {}, find ? `Nothing matches “${find}”.` : 'This home has no skills or MCP servers yet.'), legend()));
}

/** No profile: everything as set by hand. Shows what profiles still hold off, and how profiles work. */
function noProfileDetail() {
  const view = profiles();
  const all = items();
  const plan = planSwitch(all, undefined, view.held);
  const heldItems = all.filter(item => view.held[item.id]?.length);
  const active = !view.active;
  const primary = active && !plan.flips.length ? null : button({ variant: 'primary', size: 'small', label: active ? 'Apply again' : 'Switch to No profile', id: 'profile-switch', disabled: !canWrite(),
    attrs: { title: `Turn back on the ${plural(new Set(plan.flips.map(flip => flip.item)).size, 'item')} profiles turned off` }, onclick: () => void switchToProfile(null) });
  const subtitle = active ? 'In use · everything is as you set it in each tool' : `Switching turns ${plural(new Set(plan.flips.map(flip => flip.item)).size, 'item')} back on: everything a profile turned off`;
  return h('div.detail-column', {}, header('No profile', subtitle, [primary]),
    h('div.scroll.pf-scroll', { id: 'profile-scroll' },
      h('ul.pf-how', {},
        h('li', {}, icon('sliders-horizontal', 14, 'tone-muted'), h('span', {}, 'A profile is the skills and MCP servers you want on for one kind of work. Switching to it turns everything else off with each tool’s own switch; nothing is moved or deleted.')),
        h('li', {}, icon('circle-off', 14, 'tone-muted'), h('span', {}, 'Something you turned off yourself in one tool stays off. Profiles only turn back on what a profile turned off.')),
        h('li', {}, icon('refresh-cw', 14, 'tone-muted'), h('span', {}, 'Managed items keep syncing while they are off, so they are up to date when they come back.')),
        h('li', {}, icon('history', 14, 'tone-muted'), h('span', {}, 'Each switch is one step in History, with Undo. Switch here, from the status bar, or from Central Knot’s menu bar menu.'))),
      heldItems.length ? [h('h3.eyebrow.pf-eyebrow', {}, 'Turned off by profiles', h('span.eyebrow-count', {}, String(heldItems.length))), table(heldItems, undefined, plan), legend()] : null));
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
    return h('div.page', {}, bands.length ? h('div.bands', {}, bands) : null, emptyState('sliders-horizontal', 'Switch between sets of skills and MCP servers',
      'Make a profile for each kind of work, such as Incident or Development, and tick what it needs. Switching to it, here or from the menu bar, turns everything else off in your tools. Nothing is deleted, and Undo switches back.',
      button({ variant: 'outline', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canWrite(), onclick: newProfile })));
  }
  const open = openId();
  if (open) document.body.classList.add('has-item');
  const profile = view.profiles.find(entry => entry.id === open);
  return h('div.page', {}, bands.length ? h('div.bands', {}, bands) : null,
    h('div.page.split.profiles-split', {}, listColumn(open), open === NONE ? noProfileDetail() : profile ? profileDetail(profile) : h('div.detail-column')));
}

/** The status bar's profile item: the one in use, and a menu to switch in one click. */
let menuOpen = false;
export function profileStatus(): HTMLElement | null {
  const home = state.home;
  if (!home || !home.profiles.profiles.length) return null;
  const view = home.profiles;
  const active = view.profiles.find(profile => profile.id === view.active);
  const close = () => { menuOpen = false; rerender(); document.getElementById('status-profile')?.focus(); };
  const choice = (id: string | null, name: string) => h('button.pf-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String((id ?? undefined) === view.active), id: `status-profile-${id ?? NONE}`, disabled: !canWrite(),
    onclick: () => { menuOpen = false; if ((id ?? undefined) !== view.active) void switchToProfile(id); else rerender(); } },
    h('span.pf-menu-tick', {}, (id ?? undefined) === view.active ? icon('check', 14) : null), h('span.pf-menu-name', {}, name));
  const menu = menuOpen ? h('div.pf-menu', { role: 'menu', 'aria-label': 'Switch profile', onkeydown: (event: KeyboardEvent) => { if (event.key === 'Escape') close(); } },
    choice(null, 'No profile'), view.profiles.map(profile => choice(profile.id, profile.name)), h('div.pf-menu-sep', { role: 'separator' }),
    h('button.pf-menu-item', { type: 'button', role: 'menuitem', id: 'status-profile-edit', onclick: () => { menuOpen = false; profileState.open = active?.id ?? NONE; showPage('profiles'); } }, h('span.pf-menu-tick'), h('span.pf-menu-name', {}, 'Edit profiles…'))) : null;
  return h('span.status-profile-wrap', {},
    h('button.status-item.status-profile', { type: 'button', id: 'status-profile', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), disabled: !!state.busy,
      title: active ? `Profile in use: ${active.name}. Click to switch.` : 'No profile in use. Click to switch.',
      onclick: (event: Event) => { event.stopPropagation(); menuOpen = !menuOpen; rerender(); if (menuOpen) (document.querySelector('.pf-menu-item[aria-checked="true"]') as HTMLElement | null)?.focus(); } },
      icon('sliders-horizontal', 14), h('span.status-clip', {}, active ? active.name : 'No profile')),
    menu);
}
// A click anywhere else closes the profile menu.
document.addEventListener('click', event => { if (menuOpen && !(event.target as Element).closest?.('.status-profile-wrap')) { menuOpen = false; rerender(); } });
