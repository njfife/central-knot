// Profiles: named sets of items, switched in one click (here, from the status bar, or from the menu bar or tray icon). The list
// shows each profile and which are in use (folding to a one-line picker under 880 px); the open profile shows a short header line
// with its full preview behind `(?)` when the card adds a clause, Find with `Changes N` (a pinned view grouped `Turns on` then
// `Turns off`), a short `leftOutBand` with its `(?)`, the save note behind `(?)` beside `In profile`, and every item it can tick
// under its kind (descriptions on name hover): the library's items, and when `switchesPluginItems` is true each plugin's item
// some tool has, from its plugin, with under its name each tool that doesn't switch it (copyNote; kindNote once at the head of
// its kind), and in Claude Code what comes on with a ticked item (wholeNote, withBrought; claudeBand under Find); an older
// profile with `switchesPluginItems` false hides plugin rows behind "Choose plugin items for this profile". Unchanged rows leave
// their state cell blank (hover keeps live state; `Off · on in …` stays on a plugin row in use; rows left out name tools that
// keep them on: keptOn). A profile held by a plugin off in a tool offers, in Switch's place and on each row it holds, the Library
// line's own press to turn it on there, its result and Undo in this page's band, else the link to its page (turnOnControl). Every
// rule and preview is profileplan.ts's (listedChanges, switchPlan, pluginPlan, inUse, switchPreview, keptOn, leftOutWords), as
// profiles.ts carries it out.
import { acting, deleteProfileDef, machine, profileState, rerender, saveProfileDef, showPage, state, switchToProfile, whyReadOnly } from './app.ts';
import { kindGlyph, lineFacts, openPlugin, outcomeBand, pluginTag, problemsBand } from './matrix.ts';
import { lineControl } from './pluginline.ts';
import { lineBusy, turnFromLine } from './pluginstate.ts';
import { button, checkbox, emptyState, findInput, h, icon, infoMark } from './dom.ts';
import { allTurns, changeWords, claudeInstall, comesWith, copilotKeptOnBy, heldWords, homeItems, inUse, inUseName, itemRowState, keptOn, leftOut, listedChanges, listedPlugins, loadWords, leftOutWords, namedCount, PLUGIN_ITEMS_STAY, pluginItemOn, pluginLive, pluginLiveState, pluginPlan, pluginRowState, pluginStayNote, switchable, switchPlan, switchPreview, takenWhole, wholeCounts, wholeTurns, type LiveItem, type PluginCopy, type PluginLive, type PluginTurn } from './profileplan.ts';
import { noSingleSwitch, pageOfPart } from './pluginstatus.ts';
import { counted } from './pluginswitch.ts';
import { andList, toolList, toolNames } from './words.ts';
import type { ItemKind } from './library.ts';
import { plural } from './model.ts';
import type { InstalledPlugin, PluginItem, Profile } from './types.ts';

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

/** Opens `id` cleanly, clearing any previous profile's result, confirmation and rename state. */
function openProfileById(id: string) {
  if (profileState.open !== id && state.outcome?.page === 'profiles') state.outcome = undefined;
  profileState.open = id;
  profileState.confirmDelete = undefined;
  profileState.renaming = undefined;
  rerender();
}

/** One row of the list: a profile, how many items it has, whether it is in use, and whether it is open. */
function listRow(profile: Profile, { count, isInUse, selected }: { count: number; isInUse: boolean; selected: boolean }) {
  return h(`button.list-row.profile-row${selected ? '.selected' : ''}`, { type: 'button', id: `profile-row-${profile.id}`, 'aria-current': selected ? 'true' : undefined,
    onclick: () => openProfileById(profile.id) },
    icon('sliders-horizontal', 14, 'tone-muted'),
    h('span.list-name.profile-row-name', { title: profile.name }, profile.name),
    h('span.list-fraction', {}, plural(count, 'item')),
    isInUse ? h('span.profile-in-use', { title: profile.switchesPluginItems
      ? `${profile.name} is in use: what it has is on, and every other item is off wherever it can be switched`
      : `${profile.name} is in use: what it has is on, and every other item of yours is off. ${PLUGIN_ITEMS_STAY}` }, icon('check', 12), 'In use') : null);
}

/** The list column (and under 880 px, the one-line picker bar): New profile, then each profile, with `open` shown as selected. */
function listColumn(open: Profile | undefined) {
  const all = items(), plugged = plugins(), inUseNow = inUse(profiles().profiles, all, plugged);
  const picker = h('span.pf-picker', {}, h('label', { for: 'profile-picker' }, 'Profile'),
    h('span.select.select-bar', {},
      h('select', { id: 'profile-picker', 'aria-label': 'Profile',
        onchange: (event: Event) => openProfileById((event.target as HTMLSelectElement).value) },
        profiles().profiles.map(profile => h('option', { value: profile.id, selected: profile === open },
          `${profile.name}${inUseNow.includes(profile) ? ' · in use' : ''}`))),
      icon('chevrons-up-down', 14)));
  return h('div.list-column.profiles-list', {},
    h('div.toolbar.list-toolbar', {}, h('span.toolbar-title', {}, 'Profiles'), picker,
      h('div.toolbar-end', {}, button({ variant: 'outline', size: 'small', icon: 'plus', label: 'New profile', id: 'profile-new', disabled: !canEditProfiles(), onclick: newProfile }))),
    h('div.scroll.list-scroll', { id: 'profiles-list-scroll' },
      profiles().profiles.map(profile => listRow(profile, { count: namedCount(profile, all, plugged), isInUse: inUseNow.includes(profile), selected: profile === open }))));
}

// ---------- The open profile ----------

/**
 * A profile's tick box: clicking saves `itemsAfterClick` as the profile's items at once (the profile only; the library changes on
 * Switch). `mixed` draws a section's box when only some of its items are in.
 */
function tick(profile: Profile, box: { id: string; checked: boolean; mixed?: boolean; label: string; help: string; itemsAfterClick: string[] }) {
  return checkbox({ id: box.id, checked: box.checked, mixed: box.mixed, name: box.label, help: box.help, look: 'pf-tick', disabled: !canEditProfiles(),
    onchange: () => void saveProfileDef({ id: profile.id, items: box.itemsAfterClick }) });
}

const kindWords: Record<ItemKind, { one: string; many: string; title: string }> = { skill: { one: 'skill', many: 'skills', title: 'Skills' }, mcp: { one: 'MCP server', many: 'MCP servers', title: 'MCP servers' }, agent: { one: 'agent', many: 'agents', title: 'Agents' } };
/** In the Changes view, drop plain Turns on / Turns off (the section heading already says it) while keeping per-tool words. */
const cellWords = (said: string, inChanges: boolean) => (inChanges && (said === 'Turns on' || said === 'Turns off') ? '' : said);
/** Kind icon for a row in the Changes view, carrying its kind on hover. */
const kindMark = (kind: ItemKind) => h('span.kind-mark', { role: 'img', 'aria-label': kindWords[kind].one, title: kindWords[kind].one }, icon(kindGlyph[pageOfPart[kind]], 13));

/**
 * One item's row: its tick box, name (with its description on hover), and what a switch does to it; on a row the profile leaves
 * out, under its name, the tools that still load it from a copy Central Knot doesn't write, given what the switch turns of the
 * plugins' items (profileplan.ts keptOn).
 */
function itemRow(profile: Profile, item: LiveItem, plan: Plan, inChanges = false, showKindWord = false) {
  const included = profile.items.includes(item.id), description = descriptionOf(item);
  const said = cellWords(plan.changes.byId.get(item.id)?.said ?? '', inChanges);
  const kept = included ? { tools: [] } : keptOn(item, plan.plugs), many = kept.tools.length > 1;
  const help = `${included ? `In ${profile.name}: switching to it turns ${item.name} on. Click to leave it out.` : `Not in ${profile.name}: switching to it turns ${item.name} off. Click to put it in.`} ${item.name} is ${itemRowState(item)} now.`;
  return h(`div.pf-row${included ? '.pf-included' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' },
      tick(profile, { id: `pf-${item.id}`, checked: included, label: `${item.name} (${kindWords[item.kind].one}) in ${profile.name}`, help,
        itemsAfterClick: included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id] }),
      inChanges ? kindMark(item.kind) : null,
      h('span.pf-name-text', { title: description || item.name }, item.name, showKindWord ? h('span.tone-muted', {}, ` · ${kindWords[item.kind].one}`) : null),
      kept.tools.length ? h('span.pf-notes', {}, h('span.pf-note', {}, `${toolList(kept.tools)} still ${many ? 'load' : 'loads'} it ${loadWords([kept])}.`)) : null),
    h(`span.pf-state${said ? '.pf-state-moves' : ''}`, { role: 'cell', 'data-state': said }, said));
}

/** At the head of a kind, once: each tool with no switch for one item of a plugin of that kind that has such an item here, which keeps those items on (Copilot CLI's agents; Claude Code takes a plugin whole instead: wholeNote). */
function kindNote(kind: ItemKind, plugged: PluginLive[]) {
  const tools = [...new Set(plugged.flatMap(item => item.copies.filter(copy => copy.way === 'stays').map(copy => copy.tool)))];
  return tools.length ? h('div.pf-kind-note', { role: 'note', id: `pf-note-${kind}` }, tools.map(tool => `${noSingleSwitch(tool, kind)}, so a plugin’s ${kindWords[kind].many} stay on there.`).join(' ')) : null;
}

/**
 * Under a plugin item's name, one tool's copy that a switch can't turn, or a Copilot CLI MCP server kept on by another member
 * sharing its exact name (profileplan.ts copilotKeptOnBy): on a row the profile leaves out, a copy that stays on in a tool with no
 * switch for one item (the head of the kind says it once for every row: kindNote); its whole plugin off there, with the press that
 * turns it on there where the switch is `held` by it (turnOnControl), else the way to the plugin's page; its own switch held
 * (pluginswitch.ts cantSwitch); its copy unreadable. Nothing for a copy that switches for this item alone, or with its whole plugin
 * in Claude Code (wholeNote says that once for the item).
 */
function copyNote(profile: Profile, item: PluginLive, copy: PluginCopy, held: boolean): HTMLElement | null {
  const tool = toolNames[copy.tool], note = (text: string, ...more: (Node | null)[]) => h('span.pf-note', { 'data-tool': copy.tool }, text, ...more);
  if (copy.way === 'switch') {
    const kept = copilotKeptOnBy(profile, item, copy);
    if (!kept) return null;
    const verb = copy.on ? 'Stays on' : 'Turns on';
    return kept.by === 'plugin' ? note(`${verb} in ${tool}: ${kept.plugin} shares the name “${item.name}” there.`)
      : h('span.pf-note', { 'data-tool': copy.tool, title: 'To use yours there, rename one of the two or turn the plugin off in Copilot CLI.' },
        `${verb} in ${tool}, which runs the plugin’s “${item.name}” instead of yours (same name).`);
  }
  if (copy.way === 'whole') return null;
  // Why, the head of its kind says once (kindNote).
  if (copy.way === 'stays') return profile.items.includes(item.id) ? null : note(`Stays on in ${tool}.`);
  if (copy.way === 'unread') return h('span.pf-note', { 'data-tool': copy.tool, title: copy.why }, `Not known in ${tool}: its copy couldn’t be read.`);
  if (copy.way === 'held') return note(`Stays ${copy.on ? 'on' : 'off'} in ${tool}: ${copy.why}`);
  return note(`Off in ${tool}: its plugin is off there. `, turnOnControl(item, copy, 'row', held));
}

/**
 * The way past a plugin off in a tool (a `plugin-off` copy), in Switch's place (`header`) and on a row (`row`), from this one
 * helper so the two can't differ. Where this copy holds the switch (`held`: profileplan.ts pluginPlan) and one press turns it on
 * there (pluginline.ts lineControl's let-in: the Library line's own act, run as that line's, pluginstate.ts turnFromLine, its
 * result and Undo in this page's band: LineAim page), `Turn on <plugin> in <Tool>`, saying while it waits and runs (lineBusy);
 * else, in Pi, OpenCode and Antigravity too, and until the Plugins page's view is read for it (matrix.ts lineFacts, pluginstate.ts
 * wantView), the link to its page.
 */
function turnOnControl(item: PluginLive, copy: PluginCopy, place: 'header' | 'row', held = true): HTMLElement {
  const at = 'install' in copy.target ? copy.target : undefined, tool = toolNames[copy.tool], row = place === 'row';
  const look = row ? { variant: 'link' as const, size: 'micro' as const } : { variant: 'outline' as const, size: 'small' as const };
  const facts = held && at ? lineFacts(item.kind, item.plugin, item.marketName, copy.tool, at) : undefined;
  const control = facts ? lineControl(facts) : undefined, source = facts?.source;
  if (source && control?.control === 'button') {
    const busy = lineBusy(item.plugin, item.marketName, copy.tool);
    const codex = copy.tool !== 'codex-cli' ? '' : ' Its items come on with it there, except those their own switch keeps off;'
      + ' Switch then turns off the ones this profile leaves out, wherever they can be switched.';
    const aim = { home: state.home!.home, source, marketName: item.marketName, plugin: item.plugin, tool: copy.tool, item: { kind: item.kind, name: item.name } };
    return button({ ...look, label: busy ?? `Turn on ${item.plugin} in ${tool}`, id: row ? `pf-turn-on-${item.id}-${copy.tool}` : 'profile-turn-on',
      disabled: !!acting() || !!whyReadOnly(state.home!), attrs: { title: `Turns ${item.plugin} on in ${tool}, as its own switch there does.${codex}` },
      onclick: () => turnFromLine({ ...aim, act: 'let-in', page: 'profiles' }) });
  }
  return button({ ...look, label: `Open ${item.plugin}`, id: row ? `pf-plugin-${item.id}-${copy.tool}` : 'profile-open-plugin',
    attrs: { title: control?.control === 'none' && control.sentence ? control.sentence : `Open ${item.plugin} on Plugins, where it is turned on or off in each tool` },
    onclick: () => openPlugin({ source: at?.install.source, plugin: item.plugin, marketplace: item.marketName, tool: copy.tool }) });
}

/**
 * Under a plugin item's name, where Claude Code takes its plugin whole (profileplan.ts takenWhole): on a ticked row, the skills the
 * profile leaves out that come on there with it; on such a skill's row, what it comes on with. Nothing where no skill comes on so.
 */
function wholeNote(profile: Profile, item: PluginLive): HTMLElement | null {
  const install = claudeInstall(item), { ticked, brought } = install ? takenWhole(profile, install) : { ticked: [], brought: [] };
  const names = (parts: PluginItem[]) => andList(parts.map(part => part.name)), note = (text: string) => h('span.pf-note', { 'data-tool': 'claude-cli' }, text);
  if (profile.items.includes(item.id)) return brought.length ? note(`Brings ${names(brought)} on in Claude Code.`) : null;
  return comesWith(profile, item) ? note(`Comes on in Claude Code too, with ${names(ticked)}.`) : null;
}

/**
 * A kind's plugin rows in their order, but each skill that comes on in Claude Code only with a ticked row of its plugin (wholeNote)
 * set in beneath the first such row of this list (`beneath`), as the owner pictured it; one whose ticked row isn't in the list
 * (another kind's, or hidden by Find) stays where it is.
 */
function withBrought(profile: Profile, rows: PluginLive[]): { item: PluginLive; beneath: boolean }[] {
  const ticked = (item: PluginLive) => profile.items.includes(item.id);
  const bringer = (item: PluginLive) => (comesWith(profile, item) ? rows.find(other => ticked(other) && claudeInstall(other) === claudeInstall(item)) : undefined);
  const under = new Map(rows.map(item => [item, bringer(item)]));
  return rows.flatMap(item => (under.get(item) ? [] : [{ item, beneath: false }, ...rows.filter(other => under.get(other) === item).map(other => ({ item: other, beneath: true }))]));
}

/** A plugin's item's row: its box (with live state on hover), its name and plugin (matrix.ts pluginTag), what a switch does to it (`profileplan.ts listedChanges`, or `pluginRowState` while in use), and under its name what comes on with it in Claude Code (wholeNote) and each tool whose copy it can't turn or keeps on by shared name (copyNote); set in beneath the row it comes on with (`beneath`: withBrought). */
function pluginRow(profile: Profile, item: PluginLive, plan: Plan, beneath = false, inChanges = false, showKindWord = false) {
  const included = profile.items.includes(item.id), change = plan.changes.byId.get(item.id);
  const said = change ? cellWords(change.said, inChanges) : plan.isInUse ? pluginRowState(profile, item) : '';
  const moves = !!change && !!said;
  const holds = new Set(plan.plugs.find(turn => turn.id === item.id)?.held.map(each => each.tool));
  const notes = [wholeNote(profile, item), ...item.copies.map(copy => copyNote(profile, item, copy, holds.has(copy.tool)))].flatMap(note => note ?? []);
  const kept = !included ? item.copies.map(copy => (copy.way === 'switch' ? copilotKeptOnBy(profile, item, copy) : undefined)).find(Boolean) : undefined;
  const except = kept ? `, except Copilot CLI (same name as ${kept.by === 'plugin' ? `${kept.plugin}’s` : 'yours'})`
    : comesWith(profile, item) ? ', except Claude Code, where it comes on with its plugin' : '';
  const help = `${included ? `In ${profile.name}: switching to it turns ${item.name} on` : `Not in ${profile.name}: switching to it turns ${item.name} off`} in each tool that can switch it${except}. Click to ${included ? 'leave it out' : 'put it in'}. ${item.name} is ${pluginLiveState(item)} now.`;
  return h(`div.pf-row${included ? '.pf-included' : ''}${beneath ? '.pf-beneath' : ''}`, { role: 'row', 'data-item': item.id },
    h('span.pf-name', { role: 'cell' },
      tick(profile, { id: `pf-${item.id}`, checked: included, label: `${item.name} (${kindWords[item.kind].one} from ${item.plugin}) in ${profile.name}`, help,
        itemsAfterClick: included ? profile.items.filter(entry => entry !== item.id) : [...profile.items, item.id] }),
      inChanges ? kindMark(item.kind) : null,
      h('span.pf-name-text', { title: item.name }, item.name, showKindWord ? h('span.tone-muted', {}, ` · ${kindWords[item.kind].one}`) : null),
      pluginTag(item.plugin, `From the plugin ${item.plugin}, in the marketplace ${item.marketName}`),
      notes.length ? h('span.pf-notes', {}, notes) : null),
    h(`span.pf-state${moves ? '.pf-state-moves' : ''}`, { role: 'cell', 'data-state': said }, said));
}

/**
 * What a switch to the open profile would do, as the page shows it: the plugins' items (`plugs`: pluginPlan), each listed
 * changing row once (`changes`: listedChanges), the plugins it turns whole in Claude Code (`whole`: wholeTurns), all of it in
 * words (`said`: changeWords, '' when it changes nothing), and whether it is in use (inUse).
 */
interface Plan { plugs: PluginTurn[]; changes: ReturnType<typeof listedChanges>; whole: InstalledPlugin[]; said: string; isInUse: boolean }
const planOf = (profile: Profile, all: LiveItem[], plugged: PluginLive[]): Plan => {
  const turns = switchPlan(profile, all), plugs = pluginPlan(profile, plugged), whole = wholeTurns(profile, plugged);
  return { plugs, changes: listedChanges(profile, all, plugged, turns, plugs), whole,
    said: changeWords(allTurns(turns, plugs), wholeCounts({ installs: whole }), 'will'), isInUse: inUse([profile], all, plugged).length > 0 };
};

/** A kind's rows under a heading with a tick box for all of them: the library's items, then the plugins' (with Find in use, `list` and `plugged` are the rows shown). */
function tableSection(profile: Profile, kind: ItemKind, list: LiveItem[], plugged: PluginLive[], plan: Plan) {
  if (!list.length && !plugged.length) return null;
  const ids = new Set([...list, ...plugged].map(item => item.id)), inside = [...ids].filter(id => profile.items.includes(id)).length, all = inside === ids.size;
  const title = kindWords[kind].title;
  const tickAll = tick(profile, { id: `pf-all-${kind}`, checked: all, mixed: inside > 0, label: `${title}: all in ${profile.name}`, help: `${all ? 'Leave every one' : 'Put every one'}${find ? ' shown' : ''} ${all ? 'out of' : 'in'} ${profile.name}`,
    itemsAfterClick: all ? profile.items.filter(entry => !ids.has(entry)) : [...new Set([...profile.items, ...ids])] });
  return [h('div.pf-section', { role: 'row' }, h('span.pf-section-label', { role: 'cell' }, tickAll, h('strong', {}, title), h('span.pf-section-count', {}, `${inside} of ${ids.size} ticked`))),
    kindNote(kind, plugged), ...list.map(item => itemRow(profile, item, plan)),
    ...withBrought(profile, plugged).map(({ item, beneath }) => pluginRow(profile, item, plan, beneath))];
}

/** The items under their kinds, or under Turns on / Turns off while Changes is open, each with what a switch does to it. */
function table(profile: Profile, list: LiveItem[], plugged: PluginLive[], plan: Plan, pinned?: { on: string[]; off: string[] }) {
  const byId = new Map<string, LiveItem | PluginLive>([...list, ...plugged].map(item => [item.id, item]));
  const visible = pinned ? [...pinned.on, ...pinned.off].flatMap(id => (byId.has(id) ? [byId.get(id)!] : [])) : [...list, ...plugged];
  const hasState = !plan.isInUse && visible.some(item => !!cellWords(plan.changes.byId.get(item.id)?.said ?? '', !!pinned));
  const head = h('div.pf-row.pf-head', { role: 'row' },
    h('span.pf-name', { role: 'columnheader', 'data-info-block': true }, 'In profile', infoMark('profile-save-info', 'Saving ticks', SAVE_NOTE_CARD)),
    h('span.pf-state', { role: 'columnheader' }, hasState ? 'Switching' : ''));
  if (!pinned) {
    return h('div.pf-table', { role: 'table', 'aria-label': `What ${profile.name} has on` }, head,
      (['skill', 'mcp', 'agent'] as const).flatMap(kind => tableSection(profile, kind, list.filter(item => item.kind === kind), plugged.filter(item => item.kind === kind), plan) ?? []));
  }
  const dupNames = new Set(visible.map(item => item.name).filter((name, at, names) => names.indexOf(name) !== at));
  const render = (item: LiveItem | PluginLive, dup = dupNames.has(item.name)) =>
    ('copies' in item ? pluginRow(profile, item, plan, false, true, dup) : itemRow(profile, item, plan, true, dup));
  const group = (label: string, ids: string[]) => {
    const rows = ids.flatMap(id => (byId.has(id) ? [render(byId.get(id)!)] : []));
    if (!rows.length) return [];
    const heading = h('div.pf-section', { role: 'row' },
      h('span.pf-section-label', { role: 'cell' }, h('strong', {}, label), h('span.pf-section-count', {}, String(rows.length))));
    return [heading, ...rows];
  };
  return h('div.pf-table', { role: 'table', 'aria-label': `What ${profile.name} changes` }, head, ...group('Turns on', pinned.on), ...group('Turns off', pinned.off));
}

/** Find, the Changes N view toggle while previewing, and the count while finding. */
function findBar(shown: number, total: number, changes: { show: boolean; count: number; open: boolean; onToggle: () => void }) {
  const input = findInput({ id: 'profile-find', label: 'Find a skill, MCP server or agent', value: find, onInput: text => { find = text; rerender(); },
    onKeydown: event => { if (event.key === 'Escape' && find) { find = ''; rerender(); } } });
  return h('div.toolbar', {}, h('label.find', {}, icon('search', 16, 'find-glyph'), input,
    find ? button({ variant: 'ghost', size: 'micro', icon: 'x', name: 'Clear', id: 'profile-find-clear', onclick: () => { find = ''; rerender(); document.getElementById('profile-find')?.focus(); } }) : null),
    h('div.toolbar-end', {},
      changes.show ? h(`button.chip.pf-changes-chip${changes.open ? '.chip-on' : ''}`, { type: 'button', id: 'profile-changes', 'aria-pressed': String(changes.open), onclick: changes.onToggle },
        'Changes ', h('span.chip-count', {}, String(changes.count))) : null,
      find ? h('span.result-count', {}, `${shown} of ${total}`) : null));
}

/**
 * On a profile that switches plugin items, while Claude Code has a plugin it lists: how Claude Code differs, said once
 * (profileplan.ts takenWhole), and under one heading each plugin a switch turns on or off there whole (`turns`: the Plan's
 * `whole`, while the profile can be switched to), by name, with what goes with it.
 */
function claudeBand(profile: Profile, plugged: PluginLive[], turns: InstalledPlugin[]) {
  if (!profile.switchesPluginItems || !plugged.some(claudeInstall)) return null;
  const line = (install: InstalledPlugin, brought = takenWhole(profile, install).brought) => (install.off
    ? `${install.plugin} on${brought.length ? `, with ${andList(brought.map(part => part.name))} too` : ''}`
    : `${install.plugin} off, with its ${counted(install.items)} and everything else it brings there`);
  return h('div.band.band-help', { role: 'note', id: 'profile-claude' }, icon('info', 14, 'tone-muted'), h('span.band-text', {},
    'Claude Code takes a plugin whole: it is on there while any of its items is ticked, and off while none is.',
    turns.length ? h('span.pf-claude-turns', {}, h('strong', {}, 'Switching turns, in Claude Code:'), h('ul', {}, turns.map(install => h('li', {}, line(install))))) : null));
}

/** Under Find, only while the Library lists items no profile can tick, items only found in a tool: short line + `(?)` card (profileplan.ts leftOut). */
function leftOutBand() {
  const said = leftOutWords(leftOut(state.home!));
  return said ? h('div.band.band-help', { role: 'note', id: 'profile-left-out', 'data-info-block': true },
    h('span.band-text', {}, said.line), infoMark('profile-left-out-info', 'Items not listed here', said.card)) : null;
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
 * plugin is off in a tool, the way past the first such plugin and tool its line names (heldWords `off`: turnOnControl) instead.
 */
function switchButton(profile: Profile, plan: Plan, all: LiveItem[], plugged: PluginLive[]): HTMLElement | null {
  if (profileState.renaming === profile.id) return null;
  const off = plan.said ? undefined : heldWords(plan.plugs, plugged).off;
  if (off) return turnOnControl(off.item, off.copy, 'header');
  if (!plan.said || !switchable(profile, all, plugged)) return null;
  const label = profile.name.length > 18 ? 'Switch to this profile' : `Switch to ${profile.name}`;
  const title = whyReadOnly(state.home!) ?? `Use ${profile.name}: ${plan.said}.${profile.switchesPluginItems ? '' : ` ${pluginStayNote(plan.plugs, plugged)}`} One step in History, with Undo.`;
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

const SAVE_NOTE_CARD = 'Ticks save to the profile at once. Nothing in your tools changes until Switch.';

/** The open profile: its header (short line with `(?)` when the card adds a clause, Rename, Delete), setup step when empty, Find with `Changes N`, and the items. */
function profileDetail(profile: Profile) {
  const all = items(), plugged = plugins(), visiblePlugins = listedPlugins(profile, plugged), plan = planOf(profile, all, plugged);
  if (profileState.changes && (profileState.changes.profileId !== profile.id || profileState.changes.home !== state.home!.home)) profileState.changes = undefined;
  const primary = switchButton(profile, plan, all, plugged), shown = all.filter(item => matches(`${item.name} ${descriptionOf(item)}`));
  const pluggedShown = visiblePlugins.filter(item => matches(`${item.name} ${item.plugin}`));
  const changeCount = plan.changes.on.length + plan.changes.off.length, pinned = profileState.changes;
  const pinnedIds = pinned ? new Set([...pinned.on, ...pinned.off]) : undefined;
  const inView = (list: { id: string }[]) => (pinnedIds ? list.filter(item => pinnedIds.has(item.id)).length : list.length);
  const shownCount = inView(shown) + inView(pluggedShown), totalCount = inView(all) + inView(visiblePlugins);
  const title = profileState.renaming === profile.id ? renameField(profile) : h('h2', { title: profile.name }, profile.name);
  const preview = switchPreview(profile, all, plugged);
  const toggleChanges = () => {
    profileState.changes = pinned ? undefined : { home: state.home!.home, profileId: profile.id, on: plan.changes.on.map(change => change.id), off: plan.changes.off.map(change => change.id) };
    rerender();
  };
  return h('div.detail-column', {},
    h('div.pane-header.profile-header', {}, icon('sliders-horizontal', 16, 'tone-muted'),
      h('div.pane-title', {}, title,
        h('div.profile-subtitle', { 'data-info-block': true }, h('p', { id: 'profile-preview' }, preview.line),
          preview.tip ? infoMark('profile-preview-info', 'Switch preview', preview.tip) : null)),
      h('div.detail-actions.profile-actions', {}, ...headerActions(profile, primary))),
    !switchable(profile, all, plugged) ? h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {}, `Nothing is in ${profile.name} yet. Tick at least one item to switch to it, or start from what is on now.`),
      button({ variant: 'primary', size: 'small', label: 'Start from what’s on now', id: 'profile-from-now', disabled: !canEditProfiles(),
        attrs: { title: profile.switchesPluginItems ? 'Tick every skill, MCP server and agent that is on now' : 'Tick every skill, MCP server and agent of yours that is on now' },
        onclick: () => void saveProfileDef({ id: profile.id, items: [...all.filter(item => item.on), ...visiblePlugins.filter(pluginItemOn)].map(item => item.id) }, `${profile.name} now has what is on.`) })) : null,
    findBar(shownCount, totalCount, {
      show: !!pinned || (!plan.isInUse && switchable(profile, all, plugged) && changeCount > 0), count: pinned ? totalCount : changeCount, open: !!pinned, onToggle: toggleChanges,
    }),
    leftOutBand(), claudeBand(profile, visiblePlugins, switchable(profile, all, plugged) ? plan.whole : []),
    !profile.switchesPluginItems ? choosePluginsBand(profile) : null,
    h('div.scroll.pf-scroll', { id: 'profile-scroll' }, shownCount ? table(profile, shown, pluggedShown, plan, pinned)
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
  const empty = !switchable(profile, all, plugged), preview = empty ? '' : switchPreview(profile, all, plugged).card;
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
