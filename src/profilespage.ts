// Profiles: named sets of library items, switched in one click (here, from the status bar, or from the menu bar). The list
// shows each profile and which are in use; the open profile shows every library item (skills, MCP servers, agents) with a box
// (in the profile or not), whether it is On now, and what a switch would turn On and Off. Ticking only edits the profile; the
// library changes on Switch. Every rule shown here is profileplan.ts's (switchPlan, inUse), as profiles.ts carries it out.
import { deleteProfileDef, profileState, rerender, saveProfileDef, showPage, state, switchToProfile, whyReadOnly } from './app.ts';
import { outcomeBand, problemsBand } from './matrix.ts';
import { button, checkbox, emptyState, findInput, h, icon } from './dom.ts';
import { changes, homeItems, inUse, inUseName, namedItems, switchable, switchPlan, turnsWords, type LiveItem, type Turns } from './profileplan.ts';
import type { ItemKind } from './library.ts';
import { plural } from './model.ts';
import type { Profile } from './types.ts';

let find = '';
/** Whether the status bar's profile menu is open. */
let menuOpen = false;

const profiles = () => state.home!.profiles;
/** Every live library item, and each one's description from its page's row. */
const items = (): LiveItem[] => homeItems(state.home!);
const descriptionOf = (item: LiveItem) => state.home![({ skill: 'skills', mcp: 'mcp', agent: 'agents' } as const)[item.kind]].items.find(row => row.key === item.key)?.description ?? '';
/** Whether profiles can be changed now: nothing busy, the home writable, and its profiles file readable. */
const canEditProfiles = () => !state.busy && !whyReadOnly(state.home!) && !profiles().problem;
const withClass = (element: HTMLElement, name: string) => { element.classList.add(name); return element; };
const danger = (control: HTMLElement) => withClass(control, 'text-danger');

/** The profile shown: the one opened, else the first in use, else the first. */
function openProfile(): Profile | undefined {
  const all = profiles().profiles;
  return all.find(profile => profile.id === profileState.open) ?? inUse(all, items())[0] ?? all[0];
}

/** A name nobody uses yet: "New profile", then "New profile 2"… */
function freshName() {
  const taken = new Set(profiles().profiles.map(profile => profile.name.toLowerCase()));
  for (let n = 1; ; n++) { const name = n === 1 ? 'New profile' : `New profile ${n}`; if (!taken.has(name.toLowerCase())) return name; }
}
const newProfile = () => void saveProfileDef({ name: freshName(), items: [] }, 'New profile made. Name it, then tick what it has on.').then(focusName);
const focusName = () => { const input = document.getElementById('profile-name') as HTMLInputElement | null; input?.focus(); input?.select(); };

// ---------- List ----------

/** One row of the list: a profile, how many items it has, whether it is in use, and whether it is open. */
function listRow(profile: Profile, { count, isInUse, selected }: { count: number; isInUse: boolean; selected: boolean }) {
  return h(`button.list-row.profile-row${selected ? '.selected' : ''}`, { type: 'button', id: `profile-row-${profile.id}`, 'aria-current': selected ? 'true' : undefined,
    // Opening another profile starts it clean: the last switch's result belonged to the one before.
    onclick: () => { if (profileState.open !== profile.id && state.outcome?.page === 'profiles') state.outcome = undefined; profileState.open = profile.id; profileState.confirmDelete = undefined; profileState.renaming = undefined; rerender(); } },
    icon('sliders-horizontal', 14, 'tone-muted'),
    h('span.list-name.profile-row-name', { title: profile.name }, profile.name),
    h('span.list-fraction', {}, plural(count, 'item')),
    isInUse ? h('span.profile-in-use', { title: `${profile.name} is in use: what it has is on, and every other item is off` }, icon('check', 12), 'In use') : null);
}

/** The list column: New profile, then each profile, with `open` shown as selected. */
function listColumn(open: Profile | undefined) {
  const all = items(), inUseNow = inUse(profiles().profiles, all);
  return h('div.list-column.profiles-list', {},
    h('div.toolbar.list-toolbar', {}, h('span.toolbar-title', {}, 'Profiles'),
      h('div.toolbar-end', {}, button({ variant: 'outline', size: 'small', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canEditProfiles(), onclick: newProfile }))),
    // Stacked under a narrow window, the list keeps a few whole rows and scrolls (style.css .list-scroll).
    h('div.scroll.list-scroll', { id: 'profiles-list-scroll' },
      profiles().profiles.map(profile => listRow(profile, { count: namedItems(profile, all).length, isInUse: inUseNow.includes(profile), selected: profile === open }))));
}

// ---------- The open profile ----------

/** What a switch would do to one item, in a word or two, and whether it changes: the row's last column. */
function stateOf(item: LiveItem, turns: Turns, isInUse: boolean): { said: string; changes: boolean } {
  if (turns.on.includes(item)) return { said: 'Turns on', changes: true };
  if (turns.off.includes(item)) return { said: 'Turns off', changes: true };
  return { said: isInUse ? (item.on ? 'On' : 'Off') : item.on ? 'Stays on' : 'Stays off', changes: false };
}

/**
 * A profile's tick box: clicking saves `itemsAfterClick` as the profile's items at once (the profile only; the library changes on
 * Switch). `mixed` draws a section's box when only some of its items are in.
 */
function tick(profile: Profile, box: { id: string; checked: boolean; mixed?: boolean; label: string; help: string; itemsAfterClick: string[] }) {
  return checkbox({ id: box.id, checked: box.checked, mixed: box.mixed, name: box.label, help: box.help, look: 'pf-tick', disabled: !canEditProfiles(),
    onchange: () => void saveProfileDef({ id: profile.id, items: box.itemsAfterClick }) });
}

const kindWords: Record<ItemKind, { one: string; title: string }> = { skill: { one: 'skill', title: 'Skills' }, mcp: { one: 'MCP server', title: 'MCP servers' }, agent: { one: 'agent', title: 'Agents' } };

/** One item's row: its tick box, name and description, and what a switch does to it. */
function itemRow(profile: Profile, item: LiveItem, turns: Turns, isInUse: boolean) {
  const included = profile.items.includes(item.id), description = descriptionOf(item), { said, changes: moves } = stateOf(item, turns, isInUse);
  const help = `${included ? `In ${profile.name}: switching to it turns ${item.name} on. Click to leave it out.` : `Not in ${profile.name}: switching to it turns ${item.name} off. Click to put it in.`} ${item.name} is ${item.on ? 'on' : 'off'} now.`;
  return h(`div.pf-row${included ? '.pf-included' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' },
      tick(profile, { id: `pf-${item.id}`, checked: included, label: `${item.name} (${kindWords[item.kind].one}) in ${profile.name}`, help,
        itemsAfterClick: included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id] }),
      h('span.pf-name-text', { title: item.name }, item.name), description ? h('span.pf-desc', { title: description }, description) : null),
    h(`span.pf-state${moves ? '.pf-state-moves' : ''}`, { role: 'cell', 'data-state': said }, said));
}

/** A kind's rows under a heading with a tick box for all of them (with Find in use, `list` is the rows shown). */
function tableSection(profile: Profile, kind: ItemKind, list: LiveItem[], turns: Turns, isInUse: boolean) {
  if (!list.length) return null;
  const inside = list.filter(item => profile.items.includes(item.id)).length, all = inside === list.length, ids = new Set(list.map(item => item.id));
  const title = kindWords[kind].title;
  const tickAll = tick(profile, { id: `pf-all-${kind}`, checked: all, mixed: inside > 0, label: `${title}: all in ${profile.name}`, help: `${all ? 'Leave every one' : 'Put every one'}${find ? ' shown' : ''} ${all ? 'out of' : 'in'} ${profile.name}`,
    itemsAfterClick: all ? profile.items.filter(entry => !ids.has(entry)) : [...new Set([...profile.items, ...ids])] });
  return [h('div.pf-section', { role: 'row' }, h('span.pf-section-label', { role: 'cell' }, tickAll, h('strong', {}, title), h('span.pf-section-count', {}, `${inside} of ${list.length} ticked`))),
    ...list.map(item => itemRow(profile, item, turns, isInUse))];
}

/** The items under their kinds, each with what a switch does to it. */
function table(profile: Profile, list: LiveItem[], turns: Turns, isInUse: boolean) {
  const head = h('div.pf-row.pf-head', { role: 'row' }, h('span.pf-name', { role: 'columnheader' }, 'In profile'), h('span.pf-state', { role: 'columnheader' }, isInUse ? 'Now' : 'Switching'));
  return h('div.pf-table', { role: 'table', 'aria-label': `What ${profile.name} has on` }, head,
    (['skill', 'mcp', 'agent'] as const).flatMap(kind => tableSection(profile, kind, list.filter(item => item.kind === kind), turns, isInUse) ?? []));
}

/** Find, the count, and when ticks take effect: they save at once; the library changes on Switch. */
function findBar(shown: number, total: number, onSwitch: boolean) {
  const input = findInput({ id: 'profile-find', label: 'Find a skill, MCP server or agent', value: find, onInput: text => { find = text; rerender(); },
    onKeydown: event => { if (event.key === 'Escape' && find) { find = ''; rerender(); } } });
  return h('div.toolbar', {}, h('label.find', {}, icon('search', 16, 'find-glyph'), input,
    find ? button({ variant: 'ghost', size: 'micro', icon: 'x', name: 'Clear', id: 'profile-find-clear', onclick: () => { find = ''; rerender(); document.getElementById('profile-find')?.focus(); } }) : null),
    h('div.toolbar-end', {}, h('span.pf-save-note', {}, onSwitch ? 'Ticks save at once · items change on Switch' : 'Ticks save at once'), find ? h('span.result-count', {}, `${shown} of ${total}`) : null));
}

const matches = (item: LiveItem) => !find || `${item.name} ${descriptionOf(item)}`.toLowerCase().includes(find.toLowerCase());

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

/**
 * Whether a switch's MCP servers wait for Write to Claude Code (servers.ts: Claude Code's MCP settings are written only then):
 * one turning On that Claude Code doesn't have and isn't kept out of, or one turning Off that Claude Code still has.
 */
function claudeWaits(turns: Turns): boolean {
  const mcp = state.home!.mcp, inClaude = (item: LiveItem) => !!mcp.items.find(row => row.key === item.key)?.copies['claude-cli'];
  const servers = (items: LiveItem[]) => items.filter(item => item.kind === 'mcp');
  return mcp.tools.includes('claude-cli') && (servers(turns.on).some(item => !item.except.includes('claude-cli') && !inClaude(item)) || servers(turns.off).some(inClaude));
}

/**
 * What the open profile's header says under its name: whether it is in use, else what Switch would turn On and Off, and when
 * that changes an MCP server in Claude Code, that it waits for Write to Claude Code (never that it is done).
 */
function subtitleOf(profile: Profile, turns: Turns, isInUse: boolean, all: LiveItem[]): string {
  const count = namedItems(profile, all).length, others = all.length - count;
  if (isInUse) return `In use · ${plural(count, 'item')} on${others ? `, the other ${others} off` : ''}`;
  if (!switchable(profile, all)) return '0 items';
  return `Switching ${turnsWords(turns, 'will')}${claudeWaits(turns) ? ' · Claude Code’s MCP servers change when you press Write to Claude Code' : ''}`;
}

/** Delete's confirmation: deleting a profile changes nothing in Central Knot or the tools, and Undo makes it again. */
function deleteActions(profile: Profile) {
  const cancel = button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'profile-delete-cancel', onclick: () => { profileState.confirmDelete = undefined; rerender(); document.getElementById('profile-delete')?.focus(); } });
  return [h('span.profile-confirm', {}, `Delete ${profile.name}? No item changes.`), danger(button({ variant: 'outline', size: 'small', label: 'Delete', id: 'profile-delete-confirm', onclick: () => void deleteProfileDef(profile.id) })), cancel];
}

/**
 * The header's main button, Switch to the profile: none while it is in use (a switch would change nothing), while it is not
 * offered (profileplan.ts switchable: nothing in it), or while the name is edited.
 */
function switchButton(profile: Profile, turns: Turns, all: LiveItem[]): HTMLElement | null {
  if (!changes(turns) || !switchable(profile, all) || profileState.renaming === profile.id) return null;
  const label = profile.name.length > 18 ? 'Switch to this profile' : `Switch to ${profile.name}`;
  const title = whyReadOnly(state.home!) ?? `Use ${profile.name}: ${turnsWords(turns, 'will')}. One step in History, with Undo.`;
  return button({ variant: 'primary', size: 'small', label, id: 'profile-switch', disabled: !canEditProfiles(), attrs: { title }, onclick: () => void switchToProfile(profile.id) });
}

/** The header's actions: Delete's confirmation while it is asked, a hint while renaming, else Switch, Rename and Delete. */
function headerActions(profile: Profile, primary: HTMLElement | null): (Node | null)[] {
  if (profileState.confirmDelete === profile.id) return deleteActions(profile);
  if (profileState.renaming === profile.id) return [h('span.profile-confirm.tone-muted', {}, 'Enter to save · Esc to cancel')];
  return [primary,
    button({ variant: 'ghost', size: 'small', label: 'Rename', id: 'profile-rename', disabled: !canEditProfiles(), onclick: () => { profileState.renaming = profile.id; rerender(); focusName(); } }),
    danger(button({ variant: 'ghost', size: 'small', label: 'Delete', id: 'profile-delete', disabled: !canEditProfiles(), onclick: () => { profileState.confirmDelete = profile.id; rerender(); document.getElementById('profile-delete-confirm')?.focus(); } }))];
}

/** The open profile: its header (what Switch would change, Rename, Delete), the setup step while nothing is in it, Find, and the items. */
function profileDetail(profile: Profile) {
  const all = items(), turns = switchPlan(profile, all), isInUse = !changes(turns);
  const primary = switchButton(profile, turns, all), shown = all.filter(matches);
  const title = profileState.renaming === profile.id ? renameField(profile) : h('h2', { title: profile.name }, profile.name);
  const subtitle = subtitleOf(profile, turns, isInUse, all);
  return h('div.detail-column', {},
    h('div.pane-header.profile-header', {}, icon('sliders-horizontal', 16, 'tone-muted'),
      h('div.pane-title', {}, title, h('p', { title: subtitle }, subtitle)), h('div.detail-actions.profile-actions', {}, ...headerActions(profile, primary))),
    !switchable(profile, all) ? h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, `Nothing is in ${profile.name} yet. Tick at least one item to switch to it, or start from what is on now.`),
      button({ variant: 'primary', size: 'small', label: 'Start from what’s on now', id: 'profile-from-now', disabled: !canEditProfiles(), attrs: { title: 'Tick every skill, MCP server and agent that is on now' },
        onclick: () => void saveProfileDef({ id: profile.id, items: all.filter(item => item.on).map(item => item.id) }, `${profile.name} now has what is on.`) })) : null,
    findBar(shown.length, all.length, !!primary),
    h('div.scroll.pf-scroll', { id: 'profile-scroll' }, shown.length ? table(profile, shown, turns, isInUse) : h('p.pf-none', {}, find ? `Nothing matches “${find}”.` : 'Central Knot has no skills, MCP servers or agents yet.')));
}

// ---------- Page ----------

export function profilesPage(): HTMLElement {
  const home = state.home;
  if (!home) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
  const view = home.profiles, readOnly = whyReadOnly(home);
  // What couldn't be done since the last read, told here too: sync's failures, or a menu bar switch that couldn't start.
  const problems = home.sync.caughtUp.filter(result => result.outcome === 'failed' || result.outcome === 'held');
  const bands = [outcomeBand(),
    view.problem ? h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', { title: view.problem }, view.problem)) : null,
    problems.length ? problemsBand(problems) : null,
    readOnly ? h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, `${readOnly} Profiles can be looked at, not changed.`)) : null].filter(Boolean);
  if (!view.profiles.length) {
    return h('div.page.profiles-page', {}, bands.length ? h('div.bands', {}, bands) : null, emptyState('sliders-horizontal', 'Switch between sets of skills, MCP servers and agents',
      'Make a profile for each kind of work, such as Incident or Development, and tick what it needs. Switching to it, here, from the status bar or from the menu bar icon, turns those on and everything else off: Central Knot keeps each item, and Undo switches back.',
      button({ variant: 'primary', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canEditProfiles(), onclick: newProfile })));
  }
  const open = openProfile();
  return h('div.page.profiles-page', {}, bands.length ? h('div.bands', {}, bands) : null,
    h('div.page.split.profiles-split', {}, listColumn(open), open ? profileDetail(open) : h('div.detail-column')));
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
 * One profile in the status bar's menu: choosing it switches, unless it is in use already. One not offered (profileplan.ts
 * switchable: nothing in it) is shown disabled, as on the page.
 */
function menuChoice(profile: Profile, isInUse: boolean, all: LiveItem[]) {
  const size = namedItems(profile, all).length, empty = !switchable(profile, all);
  return h('button.pf-menu-item', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(isInUse), id: `status-profile-${profile.id}`, disabled: !canEditProfiles() || empty,
    title: empty ? `${profile.name} has nothing in it yet. Tick what it should have on, on the Profiles page.` : profile.name,
    onclick: (event: MouseEvent) => {
      menuOpen = false;
      // Focus goes back to the status item only for a keyboard choice; after a click it would sit there ringed.
      if (event.detail === 0) document.getElementById('status-profile')?.focus(); else (document.activeElement as HTMLElement | null)?.blur();
      if (!isInUse) void switchToProfile(profile.id); else rerender();
    } },
    h('span.pf-menu-tick', {}, isInUse ? icon('check', 14) : null), h('span.pf-menu-name', {}, empty ? `${profile.name} (empty)` : profile.name),
    empty ? null : h('span.pf-menu-size', {}, plural(size, 'item')));
}

/** The status bar's profile item: the profile in use (worked out: profileplan.ts inUse), and a menu to switch in one click. */
export function profileStatus(): HTMLElement | null {
  const home = state.home;
  if (!home?.profiles.profiles.length) return null;
  const all = items(), list = home.profiles.profiles, inUseNow = inUse(list, all), name = inUseName(list, all);
  const close = () => { menuOpen = false; rerender(); document.getElementById('status-profile')?.focus(); };
  const menu = menuOpen ? h('div.pf-menu', { role: 'menu', 'aria-label': 'Switch profile', onkeydown: (event: KeyboardEvent) => menuKeys(event, close) },
    list.map(profile => menuChoice(profile, inUseNow.includes(profile), all)), h('div.pf-menu-sep', { role: 'separator' }),
    h('button.pf-menu-item', { type: 'button', role: 'menuitem', id: 'status-profile-edit', onclick: () => { menuOpen = false; profileState.open = inUseNow[0]?.id; showPage('profiles'); } }, h('span.pf-menu-tick'), h('span.pf-menu-name', {}, 'Edit profiles…'))) : null;
  return h('span.status-profile-wrap', {},
    h('button.status-item.status-profile', { type: 'button', id: 'status-profile', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), disabled: !!state.busy,
      title: `Profile in use: ${name}. Click to switch profiles.`,
      onclick: (event: Event) => { event.stopPropagation(); menuOpen = !menuOpen; rerender(); if (menuOpen) (document.querySelector('.pf-menu-item[aria-checked="true"], .pf-menu-item:not(:disabled)') as HTMLElement | null)?.focus(); } },
      icon('sliders-horizontal', 14), h('span.status-clip', {}, name), icon('chevron-up', 12, 'status-profile-chevron')),
    menu);
}
// A click anywhere else closes the profile menu.
document.addEventListener('click', event => { if (menuOpen && !(event.target as Element).closest?.('.status-profile-wrap')) { menuOpen = false; rerender(); } });
