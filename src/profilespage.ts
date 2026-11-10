// Profiles: named sets of skills and MCP servers, switched in one click (here, from the status bar, or from the menu bar).
// The list shows each profile and which one is in use; the open profile shows every item with a box (in the profile or not) and,
// per tool, whether it is on now and what a switch would change. Ticking only edits the profile; tools change on Switch.
import { deleteProfileDef, NONE, profileState, rerender, saveProfileDef, showPage, shownPath, state, switchToProfile, whyReadOnly } from './app.ts';
import { brandMark, outcomeBand } from './matrix.ts';
import { button, checkbox, emptyState, findInput, h, icon } from './dom.ts';
import { activeProfile, driftOf, flipCounts, flipWords, NO_PROFILE, offByHand, presentItems, profilesInUse, planSwitch, switchItems, type SwitchItem, type SwitchPlan } from './profileplan.ts';
import { andList, toolName } from './words.ts';
import { plural } from './model.ts';
import type { HarnessId, Profile } from './types.ts';

let find = '';

const onePane = () => document.body.classList.contains('one-pane');
const tools = (): HarnessId[] => { const home = state.home!; return [...new Set([...home.manage.tools, ...home.mcp.tools])]; };
const items = (): SwitchItem[] => switchItems(state.home!.manage, state.home!.mcp);
const profiles = () => state.home!.profiles;
/** Whether profiles can be changed now: nothing busy, the home writable, and its profiles file readable. */
const canEditProfiles = () => !state.busy && !whyReadOnly(state.home!) && !profiles().problem;
const danger = (control: HTMLElement) => { control.classList.add('text-danger'); return control; };

/** The profile shown: the one opened, else (two panes) the one in use or No profile; one pane shows the list instead. */
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
const newProfile = () => void saveProfileDef({ name: freshName(), items: [] }, 'New profile made. Name it, then tick what it turns on.').then(focusName);
const focusName = () => { const input = document.getElementById('profile-name') as HTMLInputElement | null; input?.focus(); input?.select(); };

// ---------- List ----------

/** One row of the list: a profile (or No profile), how many items it has, whether it is in use, and whether it is open. */
function listRow({ id, name, count, active, selected }: { id: string; name: string; count: string; active: boolean; selected: boolean }) {
  return h(`button.list-row.profile-row${selected ? '.selected' : ''}`, { type: 'button', id: `profile-row-${id}`, 'aria-current': selected ? 'true' : undefined,
    // Opening another profile starts it clean: the last switch's result belonged to the one before.
    onclick: () => { if (profileState.open !== id && state.outcome?.page === 'profiles') state.outcome = undefined; profileState.open = id; profileState.confirmDelete = undefined; profileState.renaming = undefined; rerender(); } },
    icon(id === NONE ? 'circle-dashed' : 'sliders-horizontal', 14, 'tone-muted'),
    h('span.list-name.profile-row-name', { title: name }, name),
    count ? h('span.list-fraction', {}, count) : null,
    active ? h('span.badge.badge-picked', { title: `${name} is in use` }, icon('check', 12), 'In use') : null);
}

function listColumn(open: string | undefined) {
  const view = profiles();
  const all = items();
  return h('div.list-column.profiles-list', {},
    h('div.toolbar.list-toolbar', {}, h('span.toolbar-title', {}, 'Profiles'),
      h('div.toolbar-end', {}, button({ variant: 'outline', size: 'small', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canEditProfiles(), onclick: newProfile }))),
    h('div.scroll', { id: 'profiles-list-scroll' },
      listRow({ id: NONE, name: NO_PROFILE, count: '', active: !view.active, selected: open === NONE }),
      view.profiles.map(profile => listRow({ id: profile.id, name: profile.name, count: plural(presentItems(profile, all).length, 'item'), active: view.active === profile.id, selected: open === profile.id }))));
}

// ---------- The open profile ----------

/**
 * How one tool's cell looks: its state now, or (in blue, ringed) the state the view's action leaves it in. The legend lists only
 * the looks a table shows.
 */
type Look = 'on' | 'by-profile' | 'hand' | 'blocked' | 'none' | 'to-off' | 'to-on';
const looks: Record<Look, { key: string; mark: () => Node }> = {
  'on': { key: 'On', mark: () => h('span.pf-dot', { 'aria-hidden': 'true' }) },
  'by-profile': { key: 'Off by a profile', mark: () => icon('sliders-horizontal', 14) },
  'hand': { key: 'Disabled by hand (profiles leave it)', mark: () => icon('circle-off', 14, 'tone-muted') },
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
interface TableView { profile?: Profile; plan: SwitchPlan; offByProfile: Record<string, HarnessId[]>; action: string; seen: Set<Look> }

/**
 * One tool's look for an item, and the same in words. A change the view's action would make wins over the state now, even over a
 * switch that can't be read (the plan never flips one of those, so the two don't meet in practice).
 */
function lookOf(item: SwitchItem, tool: HarnessId, view: TableView): { look: Look; said: string } {
  const now = item.tools[tool];
  const flip = view.plan.flips.find(entry => entry.item === item.id && entry.tool === tool);
  if (!now) return { look: 'none', said: 'no copy' };
  if (flip) return flip.disabled ? { look: 'to-off', said: `on now · turns off when you ${view.action}` } : { look: 'to-on', said: `off now · turns back on when you ${view.action}` };
  if (item.blocked[tool]) return { look: 'blocked', said: `can’t be switched: ${item.blocked[tool]}` };
  if (now === 'on') return { look: 'on', said: 'on' };
  return view.offByProfile[item.id]?.includes(tool) ? { look: 'by-profile', said: 'off (a profile turned it off)' } : { look: 'hand', said: 'off (turned off by hand; profiles leave it off)' };
}

/** One tool's cell in a row: its look's mark, with the look in words; the look is noted in `view.seen` so the key lists it. */
function cell(tool: HarnessId, { look, said }: { look: Look; said: string }, view: TableView) {
  view.seen.add(look);
  const text = `${toolName(tool)}: ${said}`;
  return h(`span.pf-cell${pending(look) ? '.pf-cell-pending' : ''}`, { role: 'cell', title: text, 'aria-label': text, 'data-col': tool }, looks[look].mark());
}

/**
 * A profile's tick box: clicking saves `itemsAfterClick` as the profile's items at once (the profile only; tools change on Switch
 * or Apply). `mixed` draws a section's box when only some of its items are in.
 */
function tick(profile: Profile, box: { id: string; checked: boolean; mixed?: boolean; label: string; help: string; itemsAfterClick: string[] }) {
  return checkbox({ id: box.id, checked: box.checked, mixed: box.mixed, name: box.label, help: box.help, look: 'pf-tick', disabled: !canEditProfiles(),
    onchange: () => void saveProfileDef({ id: profile.id, items: box.itemsAfterClick }) });
}

/** One item's row: its tick box (on a profile), name and description, and a cell per tool. */
function itemRow(item: SwitchItem, view: TableView) {
  const profile = view.profile;
  const included = !!profile?.items.includes(item.id);
  const help = included ? `Included in ${profile?.name}: switching to it leaves ${item.name} on, or turns it back on where a profile turned it off. A tool where you turned it off by hand stays off. Click to leave it out.`
    : `Not in ${profile?.name}: switching to it turns ${item.name} off. Click to include it.`;
  const each = tools().map(tool => ({ tool, ...lookOf(item, tool, view) }));
  const cells = each.map(entry => cell(entry.tool, entry, view));
  // What the cells and a cut-off description say, in words: read with the tick box, and shown under the row while it has
  // keyboard focus, so nothing here needs a mouse.
  const states = each.map(entry => `${toolName(entry.tool)}: ${entry.said}`).join(' · ');
  return h(`div.pf-row${included ? '.pf-included' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' },
      profile ? tick(profile, { id: `pf-${item.id}`, checked: included, label: `${item.name} (${item.kind === 'mcp' ? 'MCP server' : 'skill'}) in ${profile.name}`, help: `${help} ${states}.`,
        itemsAfterClick: included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id] }) : null,
      h('span.pf-name-text', { title: item.name }, item.name), item.description ? h('span.pf-desc', { title: item.description }, item.description) : null,
      profile ? h('span.pf-tip', { 'aria-hidden': 'true' }, item.description ? h('span.pf-tip-desc', {}, item.description) : null, h('span', {}, states)) : null),
    cells);
}

/**
 * A kind's rows (skills, or MCP servers) under a heading with a tick box for all of them. With Find in use, `list` is only the
 * rows shown, so the heading's count and tick-all are about those.
 */
function tableSection(title: string, list: SwitchItem[], view: TableView) {
  if (!list.length) return null;
  const profile = view.profile;
  const inside = profile ? list.filter(item => profile.items.includes(item.id)).length : 0;
  const all = !!profile && inside === list.length;
  const ids = new Set(list.map(item => item.id));
  const tickAll = profile ? tick(profile, { id: `pf-all-${title}`, checked: all, mixed: inside > 0, label: `${title}: all in ${profile.name}`, help: `${all ? 'Leave every one' : 'Put every one'}${find ? ' shown' : ''} ${all ? 'out of' : 'in'} ${profile.name}`,
    itemsAfterClick: all ? profile.items.filter(entry => !ids.has(entry)) : [...new Set([...profile.items, ...ids])] }) : null;
  return [h('div.pf-section', { role: 'row' }, h('span.pf-section-label', { role: 'cell' }, tickAll, h('strong', {}, title), h('span.pf-section-count', {}, profile ? `${inside} of ${list.length} ticked` : String(list.length)))),
    ...list.map(item => itemRow(item, view))];
}

/** The items with a column per tool, a key to the looks it shows, and why any switch can't be changed. */
function table(list: SwitchItem[], options: Pick<TableView, 'profile' | 'plan' | 'action'>) {
  const view: TableView = { ...options, offByProfile: profiles().offByProfile, seen: new Set() };
  const head = h('div.pf-row.pf-head', { role: 'row' }, h('span.pf-name', { role: 'columnheader' }, view.profile ? 'In profile' : 'Item'),
    tools().map(tool => h('span.pf-cell.pf-head-cell', { role: 'columnheader', 'data-col': tool }, brandMark(tool, 14), h('span.pf-head-name', {}, toolName(tool)))));
  const grid = h(`div.pf-table${view.profile ? '.pf-table-profile' : ''}`, { role: 'table', 'aria-label': view.profile ? `What ${view.profile.name} has on` : 'Turned off by profiles' }, head,
    tableSection('Skills', list.filter(item => item.kind === 'skill'), view), tableSection('MCP servers', list.filter(item => item.kind === 'mcp'), view));
  grid.style.setProperty('--pf-tools', String(tools().length));
  const legend = h('div.legend.pf-legend', { 'aria-label': 'Key' }, (Object.keys(looks) as Look[]).filter(look => view.seen.has(look)).map(look =>
    h('span.legend-item', {}, h(`span.pf-legend-mark${pending(look) ? '.pf-cell-pending' : ''}`, { 'aria-hidden': 'true' }, looks[look].mark()), pending(look) ? `${looks[look].key} ${view.action}` : looks[look].key)));
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
    const files = [...new Set(blocked.flatMap(item => item.blockedFile[tool] ?? []))];
    const kinds = andList([...new Set(blocked.map(item => (item.kind === 'mcp' ? 'MCP servers' : 'skills')))]);
    lines.push(h('li', {}, icon('circle-alert', 14, 'tone-warning'), h('span', {}, h('strong', {}, `${toolName(tool)}: `), `its settings can’t be read right now, so its ${kinds} can’t be switched. Central Knot leaves ${files.length === 1 ? 'that file' : 'those files'} as ${files.length === 1 ? 'it is' : 'they are'}: fix it (or let ${toolName(tool)} rewrite it), then Refresh.`,
      files.map(file => h('span.pf-note-path', { title: file }, shownPath(file))))));
  }
  if (view.profile) for (const item of list.filter(entry => view.profile!.items.includes(entry.id))) {
    const hand = offByHand(item, view.offByProfile);
    if (!hand.length) continue;
    const where = item.kind === 'skill' ? ['Enable it there on the ', h('button.inline-link', { type: 'button', id: `pf-to-skills-${item.key}`, onclick: () => showPage('skills') }, 'Skills page'), '.'] : [`Turn it on in ${hand.length === 1 ? 'that tool’s' : 'those tools’'} own MCP settings.`];
    lines.push(h('li', {}, looks.hand.mark(), h('span', {}, h('strong', {}, item.name), ` is disabled in ${andList(hand.map(toolName))}: profiles leave it off. `, ...where)));
  }
  return lines.length ? h('ul.pf-blocked', { 'aria-live': 'polite' }, lines) : null;
}

/** Find, the count, and (for a profile) when ticks take effect: they save at once; tools change on the header's action. */
function findBar(shown: number, total: number, saves?: string) {
  const input = findInput({ id: 'profile-find', label: 'Find a skill or MCP server', value: find, onInput: text => { find = text; rerender(); },
    onKeydown: event => { if (event.key === 'Escape' && find) { find = ''; rerender(); } } });
  return h('div.toolbar', {}, h('label.find', {}, icon('search', 16, 'find-glyph'), input,
    find ? button({ variant: 'ghost', size: 'micro', icon: 'x', name: 'Clear', id: 'profile-find-clear', onclick: () => { find = ''; rerender(); document.getElementById('profile-find')?.focus(); } }) : null),
    h('div.toolbar-end', {}, saves ? h('span.pf-save-note', {}, saves) : null, find ? h('span.result-count', {}, `${shown} of ${total}`) : null));
}

const matches = (item: SwitchItem) => !find || `${item.name} ${item.description}`.toLowerCase().includes(find.toLowerCase());

/** Whether a mouse button or finger is down right now (afterClick waits for its click). */
let pointerDown = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => { setTimeout(() => { pointerDown = false; }); }, true);
/**
 * Runs `work` once the click that took focus away has landed (a redraw on mouse-down would swallow that click), or at once when
 * focus left some other way (Tab).
 */
function afterClick(work: () => void) {
  if (!pointerDown) { setTimeout(work); return; }
  let done = false;
  const run = () => { if (!done) { done = true; setTimeout(work); } };
  document.addEventListener('click', run, { once: true });
  // A press that ends without a click (a drag): run when the pointer comes up.
  document.addEventListener('pointerup', () => setTimeout(run, 50), { once: true });
}

/**
 * The profile's name field while it is renamed. Enter saves, Escape cancels, and leaving the field saves once whatever was
 * clicked has had its click; each happens once (a field the redraw removes may still report leaving). The text typed is kept in
 * `profileState.draft`, so a redraw meanwhile (a background refresh) keeps it.
 */
function renameField(profile: Profile) {
  // Keyboard focus goes on with the task: to the setup step of an empty profile, else to Rename. After a click it stays put.
  const next = () => (document.getElementById('profile-from-now') ?? document.getElementById('profile-rename'))?.focus();
  let done = false;
  const finish = (save: boolean, input: HTMLInputElement, then: () => void) => {
    if (done) return;
    done = true;
    profileState.renaming = undefined;
    profileState.draft = undefined;
    const name = input.value.trim();
    if (save && name && name !== profile.name) void saveProfileDef({ id: profile.id, name }, `Renamed to ${name}.`).then(then);
    else { rerender(); then(); }
  };
  return h('input.profile-name-input', { id: 'profile-name', type: 'text', value: profileState.draft ?? profile.name, maxlength: '40', 'aria-label': 'Profile name', spellcheck: 'false',
    oninput: (event: Event) => { profileState.draft = (event.target as HTMLInputElement).value; },
    onkeydown: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === 'Escape') finish(event.key === 'Enter', event.target as HTMLInputElement, next); },
    onblur: (event: Event) => { const input = event.target as HTMLInputElement; if (input.isConnected) afterClick(() => finish(true, input, () => undefined)); } });
}

/** The pane header: the title (or `nameField` in its place), what the open view's action would do, and the actions. */
function header(pane: { title: string; subtitle: (Node | string | null)[]; actions: (Node | null)[]; nameField?: Node; glyph?: 'sliders-horizontal' | 'circle-dashed' }) {
  const back = button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Profiles', id: 'profile-back', onclick: () => { const was = profileState.open; profileState.open = undefined; rerender(); document.getElementById(`profile-row-${was}`)?.focus(); } });
  back.classList.add('profile-back');
  const line = h('p', {}, ...pane.subtitle);
  line.title = line.textContent ?? '';
  return h('div.pane-header.profile-header', {}, back, icon(pane.glyph ?? 'sliders-horizontal', 16, 'tone-muted'),
    h('div.pane-title', {}, pane.nameField ?? h('h2', { title: pane.title }, pane.title), line), h('div.detail-actions.profile-actions', {}, ...pane.actions));
}

/**
 * What the open profile's header says under its name: a caveat first (a tool that can't be switched, items disabled by hand),
 * then whether it is in use and what its action (Switch, or Apply to tools) changes.
 */
function subtitleOf(profile: Profile, all: SwitchItem[], plan: SwitchPlan, active: boolean, empty: boolean): (Node | string | null)[] {
  const change = flipCounts(plan.flips);
  const differ = plan.flips.length > 0;
  const blockedTools = [...new Set(all.flatMap(item => Object.keys(item.blocked) as HarnessId[]))];
  // Said in short here too, since the notes under the table can be below the fold in a small window.
  const byHand = profile.items.filter(id => { const item = all.find(entry => entry.id === id); return item && offByHand(item, profiles().offByProfile).length; }).length;
  const caveats = [blockedTools.length ? h('span.pf-sub-caveat', {}, icon('circle-alert', 12, 'tone-warning'), `${andList(blockedTools.map(toolName))} can’t be switched · `) : null, byHand ? `${plural(byHand, 'item')} disabled by hand · ` : null];
  // "New sessions use it" is the quiet part: left out beside a caveat, and in a narrow window.
  const sessions = (text: string) => (blockedTools.length || byHand ? null : h('span.pf-sub-sessions', {}, text));
  if (active) return [...caveats, ...(differ ? [`In use · Apply to tools ${flipWords(change, 'will')} to match it`] : ['In use', sessions(' · new sessions in your tools use it')])];
  if (empty) return [...caveats, '0 items'];
  return [...caveats, ...(differ ? [`Switching ${flipWords(change, 'will')}`, sessions(' · new sessions use it')] : ['Switching only makes it the profile in use; no tool changes'])];
}

/**
 * Delete's confirmation. The profile in use can't be deleted: it says so and offers Stop using profiles, naming what that turns
 * back on, so nothing in the tools changes unseen.
 */
function deleteActions(profile: Profile, active: boolean, backOn: number) {
  const cancel = button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'profile-delete-cancel', onclick: () => { profileState.confirmDelete = undefined; rerender(); document.getElementById('profile-delete')?.focus(); } });
  if (!active) return [h('span.profile-confirm', {}, `Delete ${profile.name}? Your tools stay as they are.`), danger(button({ variant: 'outline', size: 'small', label: 'Delete', id: 'profile-delete-confirm', onclick: () => void deleteProfileDef(profile.id) })), cancel];
  return [h('span.profile-confirm', { role: 'status' }, `${profile.name} is in use. Switch to No profile or another profile first, then delete it.`), h('span.profile-confirm-actions', {},
    button({ variant: 'outline', size: 'small', label: `Stop using profiles${backOn ? ` (turns ${plural(backOn, 'item')} back on)` : ''}`, id: 'profile-stop', attrs: { title: 'Turn back on what profiles turned off; then Delete works. One step in History, with Undo.' }, onclick: () => { profileState.confirmDelete = undefined; void switchToProfile(null); } }), cancel)];
}

/**
 * The header's main button: Switch to the profile, or Apply to tools when it is in use but the tools no longer match it. None while
 * there is nothing to do (in use and matching; empty and not in use) or while the name is edited.
 */
function primaryAction(profile: Profile, active: boolean, plan: SwitchPlan, empty: boolean): HTMLElement | null {
  if ((active && !plan.flips.length) || (empty && !active) || profileState.renaming === profile.id) return null;
  const will = flipWords(flipCounts(plan.flips), 'will');
  const label = active ? 'Apply to tools' : profile.name.length > 18 ? 'Switch to this profile' : `Switch to ${profile.name}`;
  const title = whyReadOnly(state.home!) ?? (active ? `Make your tools match ${profile.name} again: ${will}` : `Use ${profile.name}: ${will || 'nothing needs switching'}. One step in History, with Undo.`);
  return button({ variant: 'primary', size: 'small', label, id: 'profile-switch', disabled: !canEditProfiles(), attrs: { title }, onclick: () => void switchToProfile(profile.id) });
}

/** The header's actions: Delete's confirmation while it is asked, a hint while renaming, else the main button, Rename and Delete. */
function headerActions(profile: Profile, active: boolean, primary: HTMLElement | null, backOn: number): (Node | null)[] {
  if (profileState.confirmDelete === profile.id) return deleteActions(profile, active, backOn);
  if (profileState.renaming === profile.id) return [h('span.profile-confirm.tone-muted', {}, 'Enter to save · Esc to cancel')];
  return [primary,
    button({ variant: 'ghost', size: 'small', label: 'Rename', id: 'profile-rename', disabled: !canEditProfiles(), onclick: () => { profileState.renaming = profile.id; rerender(); focusName(); } }),
    danger(button({ variant: 'ghost', size: 'small', label: 'Delete', id: 'profile-delete', disabled: !canEditProfiles(), onclick: () => { profileState.confirmDelete = profile.id; rerender(); document.getElementById(active ? 'profile-delete-cancel' : 'profile-delete-confirm')?.focus(); } }))];
}

function profileDetail(profile: Profile) {
  const view = profiles();
  const all = items();
  const active = view.active === profile.id;
  const empty = !presentItems(profile, all).length;
  // An empty profile not in use can't be switched to yet, so it previews no switch: its first step is choosing what it has.
  // In use but not matching: the profile was edited since, an item turned up, or a switch was turned back by hand.
  const plan = empty && !active ? { flips: [], offByProfile: view.offByProfile, blocked: [] } : planSwitch(all, profile, view.offByProfile);
  const primary = primaryAction(profile, active, plan, empty);
  // What Stop using profiles would turn back on, said on its button where deleting the profile in use offers it.
  const backOn = active ? flipCounts(planSwitch(all, undefined, view.offByProfile).flips).on : 0;
  const actions = headerActions(profile, active, primary, backOn);
  const renaming = profileState.renaming === profile.id;
  const shown = all.filter(matches);
  return h('div.detail-column', {}, header({ title: profile.name, subtitle: subtitleOf(profile, all, plan, active, empty), actions, nameField: renaming ? renameField(profile) : undefined }),
    empty ? h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, `Nothing is in ${profile.name} yet. Tick what it should have on, or start from what is on now. Switching to it turns the rest off with each tool’s own switch; nothing is moved or deleted.`),
      button({ variant: 'primary', size: 'small', label: 'Start from what’s on now', id: 'profile-from-now', disabled: !canEditProfiles(), attrs: { title: 'Tick every skill and MCP server that is on in at least one tool' },
        onclick: () => void saveProfileDef({ id: profile.id, items: all.filter(item => Object.values(item.tools).includes('on')).map(item => item.id) }, `${profile.name} now has what is on.`) })) : null,
    findBar(shown.length, all.length, primary ? `Ticks save at once · tools change on ${active ? 'Apply' : 'Switch'}` : 'Ticks save at once'),
    h('div.scroll.pf-scroll', { id: 'profile-scroll' }, shown.length ? table(shown, { profile, plan, action: active ? 'apply' : 'switch' }) : h('p.pf-none', {}, find ? `Nothing matches “${find}”.` : 'This home has no skills or MCP servers yet.')));
}

/** No profile: everything as set by hand. Shows what profiles still hold off, and how profiles work. */
function noProfileDetail() {
  const view = profiles();
  const all = items();
  const plan = planSwitch(all, undefined, view.offByProfile);
  const offItems = all.filter(item => view.offByProfile[item.id]?.length);
  const active = !view.active;
  const primary = active && !plan.flips.length ? null : button({ variant: 'primary', size: 'small', label: active ? 'Apply to tools' : 'Stop using profiles', id: 'profile-switch', disabled: !canEditProfiles(),
    attrs: { title: `Turn back on the ${plural(flipCounts(plan.flips).on, 'item')} profiles turned off` }, onclick: () => void switchToProfile(null) });
  const subtitle = [active ? 'In use · everything is as you set it in each tool' : `Stop using profiles turns ${plural(flipCounts(plan.flips).on, 'item')} back on: everything a profile turned off`];
  return h('div.detail-column', {}, header({ title: NO_PROFILE, subtitle, actions: [primary], glyph: 'circle-dashed' }),
    h('div.scroll.pf-scroll', { id: 'profile-scroll' },
      h('ul.pf-how', {},
        h('li', {}, icon('sliders-horizontal', 14, 'tone-muted'), h('span', {}, 'A profile is the skills and MCP servers you want on for one kind of work. Switching to it turns everything else off with each tool’s own switch; nothing is moved or deleted.')),
        h('li', {}, icon('circle-off', 14, 'tone-muted'), h('span', {}, 'Something you disable by hand in one tool stays disabled. Profiles only turn back on what a profile turned off.')),
        h('li', {}, icon('refresh-cw', 14, 'tone-muted'), h('span', {}, 'Managed items keep syncing while they are off, so they are up to date when they come back.')),
        h('li', {}, icon('history', 14, 'tone-muted'), h('span', {}, 'Each switch is one step in History, with Undo. Switch here, from the status bar, or from Central Knot’s menu bar menu.'))),
      offItems.length ? [h('h3.eyebrow.pf-eyebrow', {}, 'Turned off by profiles', h('span.eyebrow-count', {}, String(offItems.length))), ...table(offItems, { plan, action: active ? 'apply' : 'stop using profiles' })] : null));
}

// ---------- Page ----------

export function profilesPage(): HTMLElement {
  const home = state.home;
  if (!home) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
  const view = home.profiles;
  const bands = [outcomeBand(),
    view.problem ? h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', { title: view.problem }, view.problem)) : null,
    whyReadOnly(home) ? h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, `${whyReadOnly(home)} Profiles can be looked at, not changed.`)) : null].filter(Boolean);
  // No profiles at all, and nothing a profile still holds off: the start page. With holds left (a profile deleted after a switch
  // that couldn't finish), No profile stays reachable, so they can still be turned back on.
  if (!profilesInUse(view)) {
    return h('div.page.profiles-page', {}, bands.length ? h('div.bands', {}, bands) : null, emptyState('sliders-horizontal', 'Switch between sets of skills and MCP servers',
      'Make a profile for each kind of work, such as Incident or Development, and tick what it needs. Switching to it, here, from the status bar or from the menu bar icon, turns everything else off in your tools, for their next sessions. Nothing is deleted, and Undo switches back.',
      button({ variant: 'primary', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canEditProfiles(), onclick: newProfile })));
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
  const choices = [...document.querySelectorAll<HTMLElement>('.pf-menu-item:not(:disabled)')];
  const at = choices.indexOf(document.activeElement as HTMLElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: choices.length - 1 }[event.key];
  if (to === undefined || !choices.length) return;
  event.preventDefault();
  choices[(to + choices.length) % choices.length].focus();
}

/**
 * One profile in the status bar's menu (`id` null: No profile). Choosing it switches; choosing the one in use applies it again
 * when its tools no longer match it (`drift`), as the menu bar's radio item does. An empty profile (`size` 0) would turn
 * everything off, so like the page, the menu offers it once it has something in it.
 */
function menuChoice(choice: { id: string | null; name: string; inUse: boolean; drift: number; size?: number }) {
  const empty = choice.size === 0 && !choice.inUse;
  return h('button.pf-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String(choice.inUse), id: `status-profile-${choice.id ?? NONE}`, disabled: !canEditProfiles() || empty,
    title: empty ? `${choice.name} has nothing in it yet. Tick what it should have on, on the Profiles page.` : choice.name,
    onclick: (event: MouseEvent) => {
      menuOpen = false;
      // Focus goes back to the status item only for a keyboard choice; after a click it would sit there ringed.
      if (event.detail === 0) document.getElementById('status-profile')?.focus(); else (document.activeElement as HTMLElement | null)?.blur();
      if (!choice.inUse || choice.drift) void switchToProfile(choice.id); else rerender();
    } },
    h('span.pf-menu-tick', {}, choice.inUse ? icon('check', 14) : null), h('span.pf-menu-name', {}, empty ? `${choice.name} (empty)` : choice.name),
    choice.size !== undefined && !empty ? h('span.pf-menu-size', {}, plural(choice.size, 'item')) : null,
    choice.inUse && choice.drift ? h('span.pf-menu-note', {}, `Apply to tools (${plural(choice.drift, 'item')})`) : null);
}

/** The status bar's profile item: the one in use, and a menu to switch in one click. */
let menuOpen = false;
export function profileStatus(): HTMLElement | null {
  const home = state.home;
  if (!home || !profilesInUse(home.profiles)) return null;
  const view = home.profiles;
  const active = activeProfile(view);
  // The tools no longer match the profile in use (edited since, something new, or turned back by hand): a dot says so.
  const all = items();
  const drift = driftOf(all, view);
  const close = () => { menuOpen = false; rerender(); document.getElementById('status-profile')?.focus(); };
  const menu = menuOpen ? h('div.pf-menu', { role: 'menu', 'aria-label': 'Switch profile', onkeydown: (event: KeyboardEvent) => menuKeys(event, close) },
    menuChoice({ id: null, name: NO_PROFILE, inUse: !view.active, drift }),
    view.profiles.map(profile => menuChoice({ id: profile.id, name: profile.name, inUse: profile.id === view.active, drift, size: presentItems(profile, all).length })), h('div.pf-menu-sep', { role: 'separator' }),
    h('button.pf-menu-item', { type: 'button', role: 'menuitem', id: 'status-profile-edit', onclick: () => { menuOpen = false; profileState.open = active?.id ?? NONE; showPage('profiles'); } }, h('span.pf-menu-tick'), h('span.pf-menu-name', {}, 'Edit profiles…'))) : null;
  return h('span.status-profile-wrap', {},
    h('button.status-item.status-profile', { type: 'button', id: 'status-profile', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), disabled: !!state.busy,
      title: `${active ? `Profile: ${active.name}.` : 'Profile: none in use.'}${drift ? ` ${plural(drift, 'item')} no longer ${drift === 1 ? 'matches' : 'match'} it.` : ''} Click to switch profiles${drift ? ' or apply this one' : ''}.`,
      onclick: (event: Event) => { event.stopPropagation(); menuOpen = !menuOpen; rerender(); if (menuOpen) (document.querySelector('.pf-menu-item[aria-checked="true"]') as HTMLElement | null)?.focus(); } },
      icon('sliders-horizontal', 14), h('span.status-clip', {}, active ? active.name : NO_PROFILE), drift ? [h('span.status-profile-drift', { 'aria-hidden': 'true' }), h('span.status-profile-drift-text', {}, `${plural(drift, 'item')} to apply`)] : null, icon('chevron-up', 12, 'status-profile-chevron')),
    menu);
}
// A click anywhere else closes the profile menu.
document.addEventListener('click', event => { if (menuOpen && !(event.target as Element).closest?.('.status-profile-wrap')) { menuOpen = false; rerender(); } });
