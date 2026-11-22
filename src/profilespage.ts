// Profiles: named sets of items, switched in one click (here, from the status bar, or from the menu bar or tray icon). The list
// shows each profile and which are in use; the open profile shows every item it can tick, under its kind (skills, MCP servers,
// agents): the library's items, and when `switchesPluginItems` is true each plugin's item some tool has, from its plugin, with
// under its name each tool that doesn't switch it (copyNote; why, for a tool with no switch for one item, the head of its kind
// says once: kindNote); an older profile with `switchesPluginItems` false hides
// plugin rows behind "Choose plugin items for this profile" until chosen. Each row has its box (in the profile or not) and what
// a switch would do to it (one the profile leaves out names under its name the tools that keep it on: profileplan.ts keptOn),
// and under Find a line on what the Library lists beside them (items only found: profileplan.ts leftOut). Ticking only edits the
// profile; the tools change on Switch. Every rule and preview line shown here is profileplan.ts's (switchPlan, pluginPlan,
// inUse, switchPreview, keptOn), as profiles.ts carries it out.
import { acting, deleteProfileDef, machine, profileState, rerender, saveProfileDef, showPage, state, switchToProfile, whyReadOnly } from './app.ts';
import { openPlugin, outcomeBand, pluginTag, problemsBand } from './matrix.ts';
import { button, checkbox, emptyState, findInput, h, icon } from './dom.ts';
import { allTurns, changes, copilotKeptOnBy, heldWords, homeItems, inUse, inUseName, itemRowState, keptOn, leftOut, loadWords, leftOutWords, namedCount, PLUGIN_ITEMS_STAY, pluginItemOn, pluginLive, pluginPlan, pluginRowState, pluginStayNote, switchable, switchPlan, switchPreview, turnsWords, type LiveItem, type PluginCopy, type PluginLive, type PluginTurn, type Turns } from './profileplan.ts';
import { noSingleSwitch } from './pluginstatus.ts';
import { andList, toolList, toolNames } from './words.ts';
import type { ItemKind } from './library.ts';
import { plural } from './model.ts';
import type { HarnessId, Profile } from './types.ts';

let find = '';
/** Whether the status bar's profile menu is open. */
let menuOpen = false;

const profiles = () => state.home!.profiles;
/** Every live library item, and each one's description from its page's row; every plugin's item some tool has (profileplan.ts pluginLive). */
const items = (): LiveItem[] => homeItems(state.home!);
const plugins = (): PluginLive[] => pluginLive(state.home!);
const descriptionOf = (item: LiveItem) => state.home![({ skill: 'skills', mcp: 'mcp', agent: 'agents' } as const)[item.kind]].items.find(row => row.key === item.key)?.description ?? '';
/** Whether profiles can be changed now: nothing busy, the home writable, and its profiles file readable. */
const canEditProfiles = () => !acting() && !whyReadOnly(state.home!) && !profiles().problem;
const withClass = (element: HTMLElement, name: string) => { element.classList.add(name); return element; };
const danger = (control: HTMLElement) => withClass(control, 'text-danger');

/** The profile shown: the one opened, else the first in use, else the first. */
function openProfile(): Profile | undefined {
  const all = profiles().profiles;
  return all.find(profile => profile.id === profileState.open) ?? inUse(all, items(), plugins())[0] ?? all[0];
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
    isInUse ? h('span.profile-in-use', { title: profile.switchesPluginItems
      ? `${profile.name} is in use: what it has is on, and every other item is off wherever it can be switched`
      : `${profile.name} is in use: what it has is on, and every other item of yours is off. ${PLUGIN_ITEMS_STAY}` }, icon('check', 12), 'In use') : null);
}

/** The list column: New profile, then each profile, with `open` shown as selected. */
function listColumn(open: Profile | undefined) {
  const all = items(), plugged = plugins(), inUseNow = inUse(profiles().profiles, all, plugged);
  return h('div.list-column.profiles-list', {},
    h('div.toolbar.list-toolbar', {}, h('span.toolbar-title', {}, 'Profiles'),
      h('div.toolbar-end', {}, button({ variant: 'outline', size: 'small', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canEditProfiles(), onclick: newProfile }))),
    // Stacked under a narrow window, the list keeps a few whole rows and scrolls (style.css .list-scroll).
    h('div.scroll.list-scroll', { id: 'profiles-list-scroll' },
      profiles().profiles.map(profile => listRow(profile, { count: namedCount(profile, all, plugged), isInUse: inUseNow.includes(profile), selected: profile === open }))));
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

const kindWords: Record<ItemKind, { one: string; many: string; title: string }> = { skill: { one: 'skill', many: 'skills', title: 'Skills' }, mcp: { one: 'MCP server', many: 'MCP servers', title: 'MCP servers' }, agent: { one: 'agent', many: 'agents', title: 'Agents' } };

/**
 * One item's row: its tick box, name and description, and what a switch does to it; on a row the profile leaves out, under its
 * name, the tools that still load it from a copy Central Knot doesn't write, given what the switch turns of the plugins' items
 * (profileplan.ts keptOn).
 */
function itemRow(profile: Profile, item: LiveItem, plan: Plan) {
  const included = profile.items.includes(item.id), description = descriptionOf(item), { said, changes: moves } = stateOf(item, plan.turns, plan.isInUse);
  const kept = included ? { tools: [] } : keptOn(item, plan.plugs), many = kept.tools.length > 1;
  const help = `${included ? `In ${profile.name}: switching to it turns ${item.name} on. Click to leave it out.` : `Not in ${profile.name}: switching to it turns ${item.name} off. Click to put it in.`} ${item.name} is ${itemRowState(item)} now.`;
  return h(`div.pf-row${included ? '.pf-included' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' },
      tick(profile, { id: `pf-${item.id}`, checked: included, label: `${item.name} (${kindWords[item.kind].one}) in ${profile.name}`, help,
        itemsAfterClick: included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id] }),
      h('span.pf-name-text', { title: item.name }, item.name), description ? h('span.pf-desc', { title: description }, description) : null,
      kept.tools.length ? h('span.pf-notes', {}, h('span.pf-note', {}, `${toolList(kept.tools)} still ${many ? 'load' : 'loads'} it ${loadWords([kept])}.`)) : null),
    h(`span.pf-state${moves ? '.pf-state-moves' : ''}`, { role: 'cell', 'data-state': said }, said));
}

/**
 * What a switch does to a plugin's item, in its column: Turns on or off where some tool turns it (pluginPlan), naming those tools
 * when others don't turn ("Turns off in Codex and Pi"); else what the row shows while in use (profileplan.ts pluginRowState), or
 * No change. A tool that keeps it on because it can't switch one item says so under the row's name (copyNote).
 */
function pluginState(profile: Profile, item: PluginLive, turn: PluginTurn | undefined, isInUse: boolean): { said: string; changes: boolean } {
  if (!turn?.on.length && !turn?.off.length) return { said: isInUse ? pluginRowState(profile, item) : 'No change', changes: false };
  const part = (dir: 'on' | 'off', list: HarnessId[]) => `turns ${dir}${list.length < item.copies.length ? ` in ${andList(list.map(tool => toolNames[tool]))}` : ''}`;
  const both = [turn.on.length && part('on', turn.on), turn.off.length && part('off', turn.off)].filter(Boolean).join('; ');
  return { said: `${both.charAt(0).toUpperCase()}${both.slice(1)}`, changes: true };
}

/** At the head of a kind, once: each tool with no switch for one item of a plugin of that kind that has such an item here, which keeps those items on. */
function kindNote(kind: ItemKind, plugged: PluginLive[]) {
  const tools = [...new Set(plugged.flatMap(item => item.copies.filter(copy => copy.way === 'stays').map(copy => copy.tool)))];
  return tools.length ? h('div.pf-kind-note', { role: 'note', id: `pf-note-${kind}` }, tools.map(tool => `${noSingleSwitch(tool, kind)}, so a plugin’s ${kindWords[kind].many} stay on there.`).join(' ')) : null;
}

/**
 * Under a plugin item's name, one tool's copy that a switch can't turn, or a Copilot CLI MCP server kept on by another member
 * sharing its exact name (profileplan.ts copilotKeptOnBy): on a row the profile leaves out, a copy that stays on in a tool with no
 * switch for one item (the head of the kind says it once for every row: kindNote); its whole plugin off there, with the way to
 * the plugin's page; its own switch held (pluginswitch.ts cantSwitch); its copy unreadable. Nothing for a copy that switches for
 * this item alone.
 */
function copyNote(profile: Profile, item: PluginLive, copy: PluginCopy): HTMLElement | null {
  const tool = toolNames[copy.tool], note = (text: string, ...more: (Node | null)[]) => h('span.pf-note', { 'data-tool': copy.tool }, text, ...more);
  if (copy.way === 'switch') {
    const kept = copilotKeptOnBy(profile, item, copy);
    if (!kept) return null;
    const verb = copy.on ? 'Stays on' : 'Turns on';
    return kept.by === 'plugin' ? note(`${verb} in ${tool}: ${kept.plugin} shares the name “${item.name}” there.`)
      : h('span.pf-note', { 'data-tool': copy.tool, title: 'To use yours there, rename one of the two or turn the plugin off in Copilot CLI.' },
        `${verb} in ${tool}, which runs the plugin’s “${item.name}” instead of yours (same name).`);
  }
  // Why, the head of its kind says once (kindNote).
  if (copy.way === 'stays') return profile.items.includes(item.id) ? null : note(`Stays on in ${tool}.`);
  if (copy.way === 'unread') return h('span.pf-note', { 'data-tool': copy.tool, title: copy.why }, `Not known in ${tool}: its copy couldn’t be read.`);
  if (copy.way === 'held') return note(`Stays ${copy.on ? 'on' : 'off'} in ${tool}: ${copy.why}`);
  const source = 'install' in copy.target ? copy.target.install.source : undefined;
  return note(`Off in ${tool}: its plugin is off there. `, button({ variant: 'link', size: 'micro', label: 'Open its plugin', id: `pf-plugin-${item.id}-${copy.tool}`,
    attrs: { title: `Open ${item.plugin} on Plugins, where it is turned on or off in each tool` }, onclick: () => openPlugin({ source, plugin: item.plugin, marketplace: item.marketName }) }));
}

/** A plugin's item's row: its box, its name and plugin (the Library's mark, matrix.ts pluginTag), what a switch does to it, and under its name each tool whose copy it can't turn or keeps on by shared name (copyNote). */
function pluginRow(profile: Profile, item: PluginLive, turn: PluginTurn | undefined, isInUse: boolean) {
  const included = profile.items.includes(item.id), { said, changes: moves } = pluginState(profile, item, turn, isInUse), notes = item.copies.flatMap(copy => copyNote(profile, item, copy) ?? []);
  const kept = !included ? item.copies.map(copy => (copy.way === 'switch' ? copilotKeptOnBy(profile, item, copy) : undefined)).find(Boolean) : undefined;
  const except = kept ? `, except Copilot CLI (same name as ${kept.by === 'plugin' ? `${kept.plugin}’s` : 'yours'})` : '';
  const help = `${included ? `In ${profile.name}: switching to it turns ${item.name} on` : `Not in ${profile.name}: switching to it turns ${item.name} off`} in each tool that can switch it${except}. Click to ${included ? 'leave it out' : 'put it in'}.`;
  return h(`div.pf-row${included ? '.pf-included' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' },
      tick(profile, { id: `pf-${item.id}`, checked: included, label: `${item.name} (${kindWords[item.kind].one} from ${item.plugin}) in ${profile.name}`, help,
        itemsAfterClick: included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id] }),
      h('span.pf-name-text', { title: item.name }, item.name),
      pluginTag(item.plugin, `From the plugin ${item.plugin}, in the marketplace ${item.marketName}`),
      notes.length ? h('span.pf-notes', {}, notes) : null),
    h(`span.pf-state${moves ? '.pf-state-moves' : ''}`, { role: 'cell', 'data-state': said }, said));
}

/** What a switch to the open profile would do, as the page shows it: to the library items (switchPlan), to the plugins' items (pluginPlan), each item counted once (allTurns), and whether it is in use (inUse). */
interface Plan { turns: Turns; plugs: PluginTurn[]; counted: ReturnType<typeof allTurns>; isInUse: boolean }
const planOf = (profile: Profile, all: LiveItem[], plugged: PluginLive[]): Plan => {
  const turns = switchPlan(profile, all), plugs = pluginPlan(profile, plugged);
  return { turns, plugs, counted: allTurns(turns, plugs), isInUse: inUse([profile], all, plugged).length > 0 };
};

/** A kind's rows under a heading with a tick box for all of them: the library's items, then the plugins' (with Find in use, `list` and `plugged` are the rows shown). */
function tableSection(profile: Profile, kind: ItemKind, list: LiveItem[], plugged: PluginLive[], plan: Plan) {
  if (!list.length && !plugged.length) return null;
  const ids = new Set([...list, ...plugged].map(item => item.id)), inside = [...ids].filter(id => profile.items.includes(id)).length, all = inside === ids.size;
  const title = kindWords[kind].title;
  const tickAll = tick(profile, { id: `pf-all-${kind}`, checked: all, mixed: inside > 0, label: `${title}: all in ${profile.name}`, help: `${all ? 'Leave every one' : 'Put every one'}${find ? ' shown' : ''} ${all ? 'out of' : 'in'} ${profile.name}`,
    itemsAfterClick: all ? profile.items.filter(entry => !ids.has(entry)) : [...new Set([...profile.items, ...ids])] });
  return [h('div.pf-section', { role: 'row' }, h('span.pf-section-label', { role: 'cell' }, tickAll, h('strong', {}, title), h('span.pf-section-count', {}, `${inside} of ${ids.size} ticked`))),
    kindNote(kind, plugged), ...list.map(item => itemRow(profile, item, plan)), ...plugged.map(item => pluginRow(profile, item, plan.plugs.find(turn => turn.id === item.id), plan.isInUse))];
}

/** The items under their kinds, each with what a switch does to it. */
function table(profile: Profile, list: LiveItem[], plugged: PluginLive[], plan: Plan) {
  const head = h('div.pf-row.pf-head', { role: 'row' }, h('span.pf-name', { role: 'columnheader' }, 'In profile'), h('span.pf-state', { role: 'columnheader' }, plan.isInUse ? 'Now' : 'Switching'));
  return h('div.pf-table', { role: 'table', 'aria-label': `What ${profile.name} has on` }, head,
    (['skill', 'mcp', 'agent'] as const).flatMap(kind => tableSection(profile, kind, list.filter(item => item.kind === kind), plugged.filter(item => item.kind === kind), plan) ?? []));
}

/** Find, the count, and when ticks take effect: they save at once; the library changes on Switch. */
function findBar(shown: number, total: number, onSwitch: boolean) {
  const input = findInput({ id: 'profile-find', label: 'Find a skill, MCP server or agent', value: find, onInput: text => { find = text; rerender(); },
    onKeydown: event => { if (event.key === 'Escape' && find) { find = ''; rerender(); } } });
  return h('div.toolbar', {}, h('label.find', {}, icon('search', 16, 'find-glyph'), input,
    find ? button({ variant: 'ghost', size: 'micro', icon: 'x', name: 'Clear', id: 'profile-find-clear', onclick: () => { find = ''; rerender(); document.getElementById('profile-find')?.focus(); } }) : null),
    h('div.toolbar-end', {}, h('span.pf-save-note', {}, onSwitch ? 'Ticks save at once · items change on Switch' : 'Ticks save at once'), find ? h('span.result-count', {}, `${shown} of ${total}`) : null));
}

/** Under Find, only while the Library lists items no profile can tick, items only found in a tool: how many (profileplan.ts leftOut). */
function leftOutBand() {
  const said = leftOutWords(leftOut(state.home!));
  return said ? h('div.band.band-help', { role: 'note', id: 'profile-left-out' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, said)) : null;
}

const matches = (text: string) => !find || text.toLowerCase().includes(find.toLowerCase());

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

/** Shown on an older profile until chosen: plugin rows stay hidden and untouched until the person opts in. */
function choosePluginsBand(profile: Profile) {
  return h('div.band.band-help', { role: 'note', id: 'profile-plugins-note' }, icon('info', 14, 'tone-muted'),
    h('span.band-text', {}, 'This profile leaves plugin items as they are, so they aren’t listed. Choosing them is for good: they are listed unticked, and from the next switch the ones left unticked turn off wherever they can be switched.'),
    button({ variant: 'outline', size: 'small', label: 'Choose plugin items for this profile', id: 'profile-choose-plugins', disabled: !canEditProfiles(),
      attrs: { title: `Lists plugin items for ${profile.name}, none ticked. This can’t be taken back. Only the profile changes now; tools change on Switch.` },
      onclick: () => void saveProfileDef({ id: profile.id, switchesPluginItems: true }, `${profile.name} now switches plugin items for good. Tick the ones you want on before switching.`, true) }));
}

/** Delete's confirmation: deleting a profile changes nothing in Central Knot or the tools, and Undo makes it again. */
function deleteActions(profile: Profile) {
  const cancel = button({ variant: 'ghost', size: 'small', label: 'Cancel', id: 'profile-delete-cancel', onclick: () => { profileState.confirmDelete = undefined; rerender(); document.getElementById('profile-delete')?.focus(); } });
  return [h('span.profile-confirm', {}, `Delete ${profile.name}? No item changes.`), danger(button({ variant: 'outline', size: 'small', label: 'Delete', id: 'profile-delete-confirm', onclick: () => void deleteProfileDef(profile.id) })), cancel];
}

/**
 * The header's main button, Switch to the profile: none while it is in use (a switch would change nothing), while it is not
 * offered (profileplan.ts switchable: nothing in it), or while the name is edited; where a switch could turn nothing because a
 * plugin is off in a tool, the way to that plugin's page instead.
 */
function switchButton(profile: Profile, plan: Plan, all: LiveItem[], plugged: PluginLive[]): HTMLElement | null {
  if (profileState.renaming === profile.id) return null;
  const off = changes(plan.counted) ? undefined : heldWords(plan.plugs, plugged).off;
  if (off) return button({ variant: 'outline', size: 'small', label: 'Open its plugin', id: 'profile-open-plugin', attrs: { title: `Open ${off.item.plugin} on Plugins, where it is turned on or off in each tool` },
    onclick: () => openPlugin({ source: 'install' in off.copy.target ? off.copy.target.install.source : undefined, plugin: off.item.plugin, marketplace: off.item.marketName }) });
  if (!changes(plan.counted) || !switchable(profile, all, plugged)) return null;
  const label = profile.name.length > 18 ? 'Switch to this profile' : `Switch to ${profile.name}`;
  const title = whyReadOnly(state.home!) ?? `Use ${profile.name}: ${turnsWords(plan.counted, 'will')}.${profile.switchesPluginItems ? '' : ` ${pluginStayNote(plan.plugs, plugged)}`} One step in History, with Undo.`;
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
  const all = items(), plugged = plugins(), visiblePlugins = profile.switchesPluginItems ? plugged : [], plan = planOf(profile, all, plugged);
  const primary = switchButton(profile, plan, all, plugged), shown = all.filter(item => matches(`${item.name} ${descriptionOf(item)}`));
  const pluggedShown = visiblePlugins.filter(item => matches(`${item.name} ${item.plugin}`)).sort((first, second) => first.name.localeCompare(second.name) || first.plugin.localeCompare(second.plugin));
  const title = profileState.renaming === profile.id ? renameField(profile) : h('h2', { title: profile.name }, profile.name);
  const subtitle = switchPreview(profile, all, plugged);
  return h('div.detail-column', {},
    h('div.pane-header.profile-header', {}, icon('sliders-horizontal', 16, 'tone-muted'),
      h('div.pane-title', {}, title, h('p', { title: subtitle }, subtitle)), h('div.detail-actions.profile-actions', {}, ...headerActions(profile, primary))),
    !switchable(profile, all, plugged) ? h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, `Nothing is in ${profile.name} yet. Tick at least one item to switch to it, or start from what is on now.`),
      button({ variant: 'primary', size: 'small', label: 'Start from what’s on now', id: 'profile-from-now', disabled: !canEditProfiles(),
        attrs: { title: profile.switchesPluginItems ? 'Tick every skill, MCP server and agent that is on now' : 'Tick every skill, MCP server and agent of yours that is on now' },
        onclick: () => void saveProfileDef({ id: profile.id, items: [...all.filter(item => item.on), ...visiblePlugins.filter(pluginItemOn)].map(item => item.id) }, `${profile.name} now has what is on.`) })) : null,
    findBar(shown.length + pluggedShown.length, all.length + visiblePlugins.length, !!primary), leftOutBand(),
    !profile.switchesPluginItems ? choosePluginsBand(profile) : null,
    h('div.scroll.pf-scroll', { id: 'profile-scroll' }, shown.length || pluggedShown.length ? table(profile, shown, pluggedShown, plan)
      : h('p.pf-none', {}, find ? `Nothing matches “${find}”.` : !profile.switchesPluginItems && plugged.length ? 'Central Knot has no skills, MCP servers or agents of your own yet.' : 'Central Knot has no skills, MCP servers or agents yet, and no tool has one through a plugin.')));
}

// ---------- Page ----------

export function profilesPage(): HTMLElement {
  const home = state.home;
  if (!home) return h('div.page', {}, h('div.toolbar'), h('div.scroll', {}, h('p.empty', {}, 'Reading…')));
  const view = home.profiles, readOnly = whyReadOnly(home);
  // What couldn't be done since the last read, told here too: sync's failures, or a switch from the menu bar or tray icon that couldn't start.
  const problems = home.sync.caughtUp.filter(result => result.outcome === 'failed' || result.outcome === 'held');
  const bands = [outcomeBand(),
    view.problem ? h('div.band.band-danger', { role: 'alert' }, icon('circle-alert', 14), h('span.band-text', { title: view.problem }, view.problem)) : null,
    problems.length ? problemsBand(problems) : null,
    readOnly ? h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, `${readOnly} Profiles can be looked at, not changed.`)) : null].filter(Boolean);
  if (!view.profiles.length) {
    return h('div.page.profiles-page', {}, bands.length ? h('div.bands', {}, bands) : null, emptyState('sliders-horizontal', 'Switch between sets of skills, MCP servers and agents',
      `Make a profile for each kind of work, such as Incident or Development, and tick what it needs. Switching to it, here, from the status bar or from the ${machine.trayIcon}, turns those on and everything else off: Central Knot keeps each item, and Undo switches back.`,
      button({ variant: 'primary', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canEditProfiles(), onclick: newProfile })));
  }
  const open = openProfile();
  return h('div.page.profiles-page', {}, bands.length ? h('div.bands', {}, bands) : null,
    h('div.page.split.profiles-split', { id: 'profiles-split' }, listColumn(open), open ? profileDetail(open) : h('div.detail-column')));
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
function menuChoice(profile: Profile, isInUse: boolean, all: LiveItem[], plugged: PluginLive[]) {
  const empty = !switchable(profile, all, plugged), preview = empty ? '' : switchPreview(profile, all, plugged);
  return h('button.pf-menu-item', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(isInUse), id: `status-profile-${profile.id}`, disabled: !canEditProfiles() || empty,
    title: empty ? `${profile.name} has nothing in it yet. Tick what it should have on, on the Profiles page.` : `${profile.name} · ${preview}`,
    onclick: (event: MouseEvent) => {
      menuOpen = false;
      // Focus goes back to the status item only for a keyboard choice; after a click it would sit there ringed.
      if (event.detail === 0) document.getElementById('status-profile')?.focus(); else (document.activeElement as HTMLElement | null)?.blur();
      if (!isInUse) void switchToProfile(profile.id); else rerender();
    } },
    h('span.pf-menu-tick', {}, isInUse ? icon('check', 14) : null),
    h('span.pf-menu-body', {}, h('span.pf-menu-name', {}, empty ? `${profile.name} (empty)` : profile.name),
      preview ? h('span.pf-menu-preview', {}, preview) : null));
}

/** The status bar's profile item: the profile in use (worked out: profileplan.ts inUse), and a menu to switch in one click. */
export function profileStatus(): HTMLElement | null {
  const home = state.home;
  if (!home?.profiles.profiles.length) return null;
  const all = items(), plugged = plugins(), list = home.profiles.profiles, inUseNow = inUse(list, all, plugged), name = inUseName(list, all, plugged);
  const close = () => { menuOpen = false; rerender(); document.getElementById('status-profile')?.focus(); };
  const menu = menuOpen ? h('div.pf-menu', { role: 'menu', 'aria-label': 'Switch profile', onkeydown: (event: KeyboardEvent) => menuKeys(event, close) },
    list.map(profile => menuChoice(profile, inUseNow.includes(profile), all, plugged)), h('div.pf-menu-sep', { role: 'separator' }),
    h('button.pf-menu-item', { type: 'button', role: 'menuitem', id: 'status-profile-edit', onclick: () => { menuOpen = false; profileState.open = inUseNow[0]?.id; showPage('profiles'); } }, h('span.pf-menu-tick'), h('span.pf-menu-name', {}, 'Edit profiles…'))) : null;
  return h('span.status-profile-wrap', {},
    h('button.status-item.status-profile', { type: 'button', id: 'status-profile', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), disabled: !!acting(),
      title: `Profile in use: ${name}. Click to switch profiles.`,
      onclick: (event: Event) => { event.stopPropagation(); menuOpen = !menuOpen; rerender(); if (menuOpen) (document.querySelector('.pf-menu-item[aria-checked="true"], .pf-menu-item:not(:disabled)') as HTMLElement | null)?.focus(); } },
      icon('sliders-horizontal', 14), h('span.status-clip', {}, name), icon('chevron-up', 12, 'status-profile-chevron')),
    menu);
}
// A click anywhere else closes the profile menu.
document.addEventListener('click', event => { if (menuOpen && !(event.target as Element).closest?.('.status-profile-wrap')) { menuOpen = false; rerender(); } });
