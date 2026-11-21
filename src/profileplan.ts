// Profiles' rules, pure (no files, no DOM). A profile names library items (library.ts) of the three kinds, as `skill:<key>`,
// `agent:<key>` and `mcp:<key>`, and, when `switchesPluginItems` is true, a plugin's items, as `plugin:<kind>:<key>`
// (pluginItemId). Switching to it turns each library item it names On and every other Off (switchPlan), and when
// `switchesPluginItems` is true each plugin's item, one tool at a time, on where it names it and off where it doesn't, wherever
// that tool can switch that one item (pluginPlan). In Copilot CLI a plugin's MCP server and any other server of the exact same
// bare name are one switch (disabledMcpServers; while both his own and a plugin's are configured, Copilot CLI uses the
// plugin's): pluginPlan works out that rule once per exact name from what the switch will leave configured — on when the
// profile names this server or another live member of its exact name (copilotKeptOnBy), left as it stands when an unmanaged
// personal entry holds that name there, off otherwise — and a profile with `switchesPluginItems` false (saved before plugin
// items could be ticked, until chosen) leaves every plugin copy as it stands except clearing a Copilot CLI off-switch blocking
// a server of his own that it names (`pluginPlan` is the guard switches, previews and `inUse` pass through; `namedCount` reads
// `switchesPluginItems` too, deciding whether Switch is offered). A profile is in use exactly while a switch would change
// nothing and nothing it asks is held (inUse), so which one is in use is worked out, never stored; a switch's preview line is
// `switchPreview` (using `PLUGIN_ITEMS_STAY` and `pluginStayNote`), shared by the page and both menus; and a switch's Undo
// turns back each item, and each plugin item's copy, still as the switch left it (undoPlan, pluginUndo). An id that names
// nothing live (an item only found in a tool, one deleted, a plugin's item no tool has now) is skipped by all of them and stays
// in the profile, dormant. A library item linked to a plugin the home records (library.ts A PLUGIN) is not one of the person's
// own (liveItems): it is that plugin's item, placed in Pi or OpenCode (pluginLive). What the Library lists that no profile can
// tick, items only found in a tool, is counted for the page (leftOut).
// Read by profiles.ts (which carries a switch out), profilemigrate.ts, the Profiles page, History's page and the menus
// (main.ts), so each says the same. The profiles file and the switch itself are profiles.ts's.
// A PLUGIN'S ITEMS: each item every tool has now with how a switch meets each copy (pluginLive), what a switch to a profile would
// turn of them, tool by tool (pluginPlan, per-tool `on` and `off`), and whether they agree with a profile (pluginItemsAgree). An
// item is one plan key (pluginItemKey) whichever way each tool has it, and a profile names it by pluginItemId, never as an item
// of the person's own. The Library's rows don't group by that key (pluginrows.ts pageRows has its own).
import { itemKey, type ItemKind, type LibraryItem } from './library.ts';
import { placeOf } from './libraryrow.ts';
import { plural } from './model.ts';
import { loadsKind, pageOfPart } from './pluginstatus.ts';
import { cantSwitch, onNow, ownSwitch, type PluginItemAt } from './pluginswitch.ts';
import { takesPlugins } from './presence.ts';
import { andList, kindNouns, toolNames } from './words.ts';
import type { HarnessId, HistoryEvent, HomeView, PluginItem, PluginSwitched, Profile } from './types.ts';

/** What every screen calls the state where no profile is in use. */
export const NO_PROFILE = 'No profile';

/** A profile's name for a library item: its kind and key, `skill:notes`. */
export const itemId = (kind: ItemKind, key: string) => `${kind}:${key}`;
/**
 * A plugin's item's plan key, one rule for each tool's copy, installed whole (a PluginItem, by its `keyName`) or placed in Pi or
 * OpenCode (a library item linked to the plugin, by placedKeyName): `plugin@marketplace/item`, a skill by its folder's name (one at
 * the plugin's root by the plugin's) and an agent by its file's, compared as library keys are (itemKey), an MCP server by its name
 * as written. Not the name a tool's switch takes (PluginItem `name`).
 */
export const pluginItemKey = ({ plugin, marketName }: { plugin: string; marketName: string }, item: Pick<PluginItem, 'kind' | 'name' | 'keyName'>) =>
  `${plugin}@${marketName}/${item.kind === 'mcp' ? item.name : itemKey(item.keyName ?? item.name)}`;

/**
 * A profile's name for a plugin's item: `plugin:`, its kind and pluginItemKey, `plugin:skill:document-tools@team-tools/pdf`.
 * A library item's id begins with its kind, so none is one of these, whatever its name holds.
 */
export const pluginItemId = (kind: ItemKind, key: string) => `plugin:${itemId(kind, key)}`;

/** A live library item (not deleted) as profiles see it. `except`: the tools it is kept out of, which a switch keeps. */
export interface LiveItem { id: string; kind: ItemKind; key: string; name: string; on: boolean; except: LibraryItem['except'] }

/** Each kind's items as the library holds them, deleted ones too (types.ts LibraryView `library`, or a kind's record). */
export type Libraries = Record<ItemKind, Record<string, LibraryItem>>;

const KINDS = ['skill', 'mcp', 'agent'] as const;
/** Whether a library item is linked to a plugin the home records (`plugins`: their ids), so it follows that plugin's switch. */
const linkedToPlugin = (item: LibraryItem, plugins: ReadonlySet<string>) => !!item.source && plugins.has(item.source);

/**
 * Every live library item of the person's own that profiles act on, skills first, then MCP servers, then agents: all but those
 * linked to a plugin (`plugins`: the ids of the plugins the home records), which are that plugin's items (pluginLive).
 */
export function liveItems(libraries: Libraries, plugins: ReadonlySet<string>): LiveItem[] {
  return KINDS.flatMap(kind => Object.values(libraries[kind]).filter(item => !item.deleted && !linkedToPlugin(item, plugins))
    .map(({ key, name, on, except }) => ({ id: itemId(kind, key), kind, key, name, on, except })));
}

/** A home view's live items that profiles act on (each kind's `library` in types.ts HomeView), as the page and the menus read them. */
export const homeItems = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents' | 'profiles'>) =>
  liveItems({ skill: home.skills.library, mcp: home.mcp.library, agent: home.agents.library }, recordedPlugins(home));
/** The ids of the plugins the home records. */
const recordedPlugins = (home: Pick<HomeView, 'profiles'>) => new Set(home.profiles.plugins?.map(entry => entry.id));

/**
 * Of each kind, how many of the Library's rows no profile can tick: items found in a tool, not in Central Knot yet
 * (libraryrow.ts placeOf). A deleted item is not counted; a plugin's items are ticked as the plugin's (pluginLive).
 */
export function leftOut(home: HomeView): Record<ItemKind, number> {
  const count = (kind: ItemKind) => { const { items, library } = home[pageOfPart[kind]]; return items.filter(row => placeOf(library[row.key]) === 'found').length; };
  return { skill: count('skill'), mcp: count('mcp'), agent: count('agent') };
}

/**
 * The Profiles page's line on what its list leaves out, with leftOut's counts: what is found and where the Library shows it
 * (its Found heading, whose rows have Add, turned off on a row that can't be taken in: matrix.ts addButton); '' when it leaves
 * nothing out.
 */
export function leftOutWords(counts: Record<ItemKind, number>): string {
  const counted = andList(KINDS.filter(kind => counts[kind]).map(kind => plural(counts[kind], kindNouns[pageOfPart[kind]].one, kindNouns[pageOfPart[kind]].many)));
  const one = KINDS.reduce((sum, kind) => sum + counts[kind], 0) === 1;
  return counted ? `Not listed here: ${counted} found in your tools that ${one ? 'isn’t' : 'aren’t'} in Central Knot yet (under Found in the Library, with Add ${one ? 'if it' : 'on each that'} can be taken in).` : '';
}

// ---------- A plugin's items ----------

/**
 * One tool's copy of a plugin's item as a switch to a profile meets it. `on`: on there now (pluginswitch.ts onNow; in Pi and
 * OpenCode its library item's On). `way`:
 * - `switch`: the item's own switch there (pluginswitch.ts ownSwitch; in Pi and OpenCode its library item's On and Off);
 * - `stays`: the tool has none for one item of its kind (a skill in Claude Code, an agent in Copilot CLI), so the copy is left
 *   as its plugin has it and agrees with any profile;
 * - `plugin-off`: the whole plugin is off in that tool (placed: Off on Plugins), so the copy is off; no switch turns it on;
 * - `held`: its own switch can't be used now, and `why`;
 * - `unread`: that tool's copy of the plugin couldn't be read (types.ts InstalledPlugin `problem`), so whether it is on isn't
 *   known (`on` is false): it agrees with no profile, and nothing is written there.
 * `target`: what a switch turns, the copy installed whole as pluginswitch.ts click takes it, or the placed copy's library item.
 * `sharesWith`, a server in Copilot CLI: the other members sharing its exact bare name there — `own` (profile ids of his own
 * live servers in Central Knot Copilot CLI has or will have under that exact name, not kept out), `plugins` (other enabled
 * plugins' servers of that exact name there), and `found` (an unmanaged entry of his in Copilot CLI's file that no profile
 * switches).
 * `gone`, a placed copy: its item is On and was applied there, and the tool has no copy now: deleted by hand since.
 */
export type PluginCopy = { tool: HarnessId; on: boolean; target: PluginItemAt | { libraryKey: string }; sharesWith?: { own: string[]; plugins: { id: string; plugin: string }[]; found?: true }; gone?: true }
  & ({ way: 'switch' | 'stays' } | { way: 'plugin-off' | 'held' | 'unread'; why: string });

/** A plugin's item some tool has now: its id in a profile (pluginItemId), the plugin's name and marketplace, and each tool's copy. */
export interface PluginLive { id: string; kind: ItemKind; name: string; plugin: string; marketName: string; copies: PluginCopy[] }

/** What pluginLive reads of a home: a page's view, or the read a switch makes (main.ts pluginSide). */
export type PluginHome = Pick<HomeView, 'pluginItems' | 'profiles' | 'skills' | 'mcp' | 'agents'>;

/** Why a copy can't be switched while its whole plugin is off in its tool (installed whole), or on Plugins (placed). */
const pluginOff = (plugin: string, tool: HarnessId) => `The whole plugin ${plugin} is off in ${toolNames[tool]}.`;
/**
 * How a switch meets a copy installed whole: the whole plugin off in that tool first (the copy is off, whatever its own
 * switch); then a tool with no switch for one item of its kind; then a switch that can't be written (pluginswitch.ts
 * cantSwitch); else the item's own switch (for a Copilot CLI MCP server, carrying `sharesWith` for the exact-name rule).
 */
function installedWay(home: PluginHome, at: PluginItemAt): Pick<PluginCopy, 'way' | 'sharesWith'> & { why?: string } {
  if (at.install.off) return { way: 'plugin-off', why: pluginOff(at.install.plugin, at.tool) };
  if (!ownSwitch(at)) return { way: 'stays' };
  const why = cantSwitch(at);
  if (why) return { way: 'held', why };
  if (at.tool !== 'copilot-cli' || at.kind !== 'mcp') return { way: 'switch' };
  const rows = new Map(home.mcp.items.map(row => [row.key, row]));
  const managed = homeItems(home).filter(item => item.kind === 'mcp' && !item.except.includes(at.tool));
  const managedKeys = new Set(managed.map(item => item.key));
  const copilotSpell = (item: LiveItem) => { const row = rows.get(item.key); return row?.copies[at.tool]?.folder ?? row?.plugin?.[at.tool]?.name ?? row?.copilotName ?? item.name; };
  const own = managed.filter(item => copilotSpell(item) === at.name).map(item => item.id);
  const plugins = (home.pluginItems ?? []).flatMap(install => install !== at.install && install.tool === at.tool && !install.off
    ? install.items.filter(part => part.kind === 'mcp' && part.name === at.name).map(part => ({ id: pluginItemId('mcp', pluginItemKey(install, part)), plugin: install.plugin })) : []);
  const found = home.mcp.items.some(row => row.copies[at.tool]?.folder === at.name && !(managedKeys.has(row.key) && (home.mcp.library[row.key]?.on || !!home.mcp.library[row.key]?.applied?.[at.tool])));
  return { way: 'switch', ...(own.length || plugins.length || found ? { sharesWith: { own, plugins, ...(found ? { found: true as const } : {}) } } : {}) };
}

/** A plugin as the home records it (types.ts ProfilesView `plugins`). */
type Recorded = NonNullable<HomeView['profiles']['plugins']>[number];
/**
 * The name a placed copy's plan key is made of: its library item's name, which is its key's (as atlink.ts pluginItems named it),
 * or the plugin's for a plugin that is one skill at its root. Placed, that skill is named by the plugin's folder in the
 * marketplace's copy; the plan knows it is the root skill when a tool's installed copy of the plugin read its one skill at the
 * root (PluginItem `root`) and the plugin has one skill placed. With no tool having it installed, it keeps its own name.
 */
function placedKeyName(home: PluginHome, kind: ItemKind, item: LibraryItem, entry: Recorded): string {
  const atRoot = (home.pluginItems ?? []).some(install => install.plugin === entry.plugin && install.marketName === entry.marketName && install.items.some(part => part.root));
  const placed = Object.values(home.skills.library).filter(skill => !skill.deleted && skill.source === entry.id).length;
  return kind === 'skill' && atRoot && placed === 1 ? entry.plugin : item.name;
}

/**
 * Every plugin's item a tool has now, one per pluginItemKey whichever way each tool has it: installed whole, then placed in Pi or
 * OpenCode, a library item linked to a plugin the home records, in each of those managed tools it isn't kept out of (Off too:
 * its On brings it back there; `plugin-off` while the plugin is Off on Plugins, whose Off turned the item Off:
 * pluginlibrary.ts runItems). A tool whose copy of a plugin couldn't be read has an `unread` copy of each of that plugin's items
 * another tool has, of the kinds it loads (pluginstatus.ts loadsKind); an item only that copy has isn't known, so isn't listed.
 */
export function pluginLive(home: PluginHome): PluginLive[] {
  const found = new Map<string, PluginLive>();
  const add = (kind: ItemKind, key: string, name: string, of: { plugin: string; marketName: string }, copy: PluginCopy) => {
    const id = pluginItemId(kind, key);
    if (!found.has(id)) found.set(id, { id, kind, name, plugin: of.plugin, marketName: of.marketName, copies: [] });
    found.get(id)!.copies.push(copy);
  };
  for (const install of home.pluginItems ?? []) for (const item of install.items) {
    const at = { kind: item.kind, name: item.name, tool: install.tool, install };
    add(item.kind, pluginItemKey(install, item), item.name, install, { tool: install.tool, on: onNow(at), target: at, ...installedWay(home, at) } as PluginCopy);
  }
  for (const kind of KINDS) {
    const { tools, library } = home[pageOfPart[kind]];
    for (const item of Object.values(library)) {
      const entry = !item.deleted && home.profiles.plugins?.find(each => each.id === item.source);
      if (!entry) continue;
      const key = pluginItemKey(entry, { kind, name: placedKeyName(home, kind, item, entry) }), row = home[pageOfPart[kind]].items.find(each => each.key === item.key);
      for (const tool of tools.filter(each => !takesPlugins(each) && !item.except.includes(each))) {
        const way = entry.on ? { way: 'switch' as const } : { way: 'plugin-off' as const, why: pluginOff(entry.plugin, tool) };
        const gone = item.on && !!item.applied[tool] && !row?.copies[tool] ? { gone: true as const } : {};
        add(kind, key, item.name, entry, { tool, on: item.on, target: { libraryKey: item.key }, ...way, ...gone });
      }
    }
  }
  for (const install of (home.pluginItems ?? []).filter(each => each.problem)) {
    for (const item of [...found.values()].filter(each => each.plugin === install.plugin && each.marketName === install.marketName && loadsKind(install.tool, each.kind))) {
      item.copies.push({ tool: install.tool, on: false, target: { kind: item.kind, name: item.name, tool: install.tool, install }, way: 'unread', why: `${toolNames[install.tool]}’s copy of ${install.plugin} couldn’t be read: ${install.problem}` });
    }
  }
  return [...found.values()];
}

/** Why a Copilot CLI copy of a plugin's MCP server is kept on even when `profile` leaves this plugin's item out (pluginPlan, profilespage.ts copyNote, profiles.ts). */
export type CopilotKeptOn = { by: 'own' } | { by: 'plugin'; plugin: string } | { by: 'found' };

/**
 * Whether `copy` (a Copilot CLI MCP server) is kept on by another member sharing its exact bare name even though `profile`
 * leaves `item` out: his own server in Central Knot (`own`), another enabled plugin's server (`plugin`), or an unmanaged
 * personal entry already on there (`found`). Undefined when `profile` names `item` itself or nothing else keeps it on.
 */
export function copilotKeptOnBy(profile: Pick<Profile, 'items' | 'switchesPluginItems'>, item: Pick<PluginLive, 'id'>, copy: PluginCopy): CopilotKeptOn | undefined {
  const shared = copy.sharesWith;
  if (!shared || (profile.switchesPluginItems && profile.items.includes(item.id))) return undefined;
  if (shared.own.some(id => profile.items.includes(id))) return { by: 'own' };
  const other = profile.switchesPluginItems ? shared.plugins.find(entry => profile.items.includes(entry.id)) : undefined;
  if (other) return { by: 'plugin', plugin: other.plugin };
  if (profile.switchesPluginItems && shared.found && copy.on) return { by: 'found' };
  return undefined;
}

/**
 * What a switch to a profile would do to one plugin's item: the tools it turns on (`on`), those it turns off (`off`), and
 * those it can't (`held`). Direction is per tool: a shared Copilot CLI server name can turn on there while turning off in Codex.
 */
export interface PluginTurn { id: string; on: HarnessId[]; off: HarnessId[]; held: { tool: HarnessId; why: string }[] }

/**
 * What switching to `profile` would turn of the plugins' items, one item in one tool at a time, never a whole plugin. When
 * `profile.switchesPluginItems` is false, the only copies in its plan are Copilot CLI MCP copies toward on whose exact name
 * `profile` names among his own servers (never held); otherwise each copy that is not as wanted (on when `profile` names `item`
 * or `copilotKeptOnBy` keeps that exact Copilot CLI name on, off otherwise) is turned where its way is `switch` and held, with
 * why, where it is `plugin-off` or `held`; an `unread` copy is held either way; a copy that `stays` is left. Only items with
 * something turned or held are listed; an id naming nothing any tool has now is dormant.
 */
export function pluginPlan(profile: Pick<Profile, 'items' | 'switchesPluginItems'>, items: PluginLive[]): PluginTurn[] {
  if (!profile.switchesPluginItems) {
    return items.flatMap(item => {
      const on = item.copies.filter(copy => copy.way === 'switch' && !copy.on && copilotKeptOnBy(profile, item, copy)?.by === 'own').map(copy => copy.tool);
      return on.length ? [{ id: item.id, on, off: [], held: [] }] : [];
    });
  }
  return items.flatMap(item => {
    const want = (copy: PluginCopy) => profile.items.includes(item.id) || !!copilotKeptOnBy(profile, item, copy);
    const differ = item.copies.filter(copy => copy.way === 'unread' || (copy.way !== 'stays' && copy.on !== want(copy)));
    const on = differ.filter(copy => copy.way === 'switch' && want(copy)).map(copy => copy.tool);
    const off = differ.filter(copy => copy.way === 'switch' && !want(copy)).map(copy => copy.tool);
    const held = differ.flatMap(copy => ('why' in copy ? [{ tool: copy.tool, why: copy.why }] : []));
    return on.length || off.length || held.length ? [{ id: item.id, on, off, held }] : [];
  });
}

/** Whether the plugins' items agree with a profile (their part of "in use"): a switch to it would turn none, and hold none. */
export const pluginItemsAgree = (profile: Pick<Profile, 'items' | 'switchesPluginItems'>, items: PluginLive[]) => !pluginPlan(profile, items).length;

/** One copy of a plugin's item to turn in one tool, toward `on`: a switch's (pluginPlan) or its Undo's (pluginUndo), as profiles.ts carries it out. */
export interface CopyTurn { item: PluginLive; copy: PluginCopy; on: boolean }

/**
 * What the Undo of a switch's History entry turns back of the plugins' items (HistoryEvent profile `plugins`), decided from each
 * copy now: each still as the switch left it, still the plugin's and still turned by its own switch there goes back the other
 * way (`back`); each other is left (`left`), with why: deleted by hand since (`gone`), or changed since (turned, let go as his
 * own, or gone from the tool with its plugin).
 */
export function pluginUndo(event: Pick<HistoryEvent, 'profile'>, items: PluginLive[]): { back: CopyTurn[]; left: { copy: PluginSwitched; why: string }[] } {
  const back: CopyTurn[] = [], left: { copy: PluginSwitched; why: string }[] = [];
  for (const done of event.profile?.plugins ?? []) {
    const item = items.find(each => each.id === done.id), copy = item?.copies.find(each => each.tool === done.tool);
    if (done.on && copy?.gone) left.push({ copy: done, why: 'deleted by hand since' });
    else if (item && copy?.way === 'switch' && copy.on === done.on) back.push({ item, copy, on: !done.on });
    else left.push({ copy: done, why: 'changed since the switch' });
  }
  return { back, left };
}

/** Whether a plugin's item is on, as Start from what's on now and its row count it: on in some tool that switches it; where no tool does, in any tool. */
export function pluginItemOn(item: PluginLive): boolean {
  const switched = item.copies.filter(copy => copy.way === 'switch');
  return (switched.length ? switched : item.copies).some(copy => copy.on);
}

/**
 * Why a switch to a profile can't turn what it holds (pluginPlan `held`), in the words the page's header and a menu's refusal
 * share, without a full stop: each plugin off in a tool, with how many of its items that stops ("docs is off in Codex, so 3 of its
 * items can’t be switched from here"), then how many items are held otherwise; '' when nothing is held. `off`: the first plugin
 * off in a tool, for the way to its page.
 */
export function heldWords(plan: PluginTurn[], items: PluginLive[]): { text: string; off?: { item: PluginLive; copy: PluginCopy } } {
  const off = new Map<string, { item: PluginLive; copy: PluginCopy; ids: Set<string> }>(), other = new Set<string>();
  for (const { id, held } of plan) for (const { tool } of held) {
    const item = items.find(each => each.id === id)!, copy = item.copies.find(each => each.tool === tool)!, key = `${item.plugin}@${item.marketName}\u0000${tool}`;
    if (copy.way !== 'plugin-off') other.add(id); else (off.get(key) ?? off.set(key, { item, copy, ids: new Set() }).get(key)!).ids.add(id);
  }
  const parts = [...[...off.values()].map(({ item, copy, ids }) => `${item.plugin} is off in ${toolNames[copy.tool]}, so ${ids.size} of its items can’t be switched from here`),
    ...(other.size ? [`${plural(other.size, 'item')} can’t be switched in a tool, as ${other.size === 1 ? 'its row says' : 'their rows say'}`] : [])];
  return { text: parts.join('; '), off: [...off.values()][0] };
}

/** Plugin items' copies counted as items, one per item, toward `on`: a copy turned in two tools is one item. */
const itemsToward = <Copy extends { id: string; on: boolean }>(copies: Copy[], on: boolean) => [...new Map(copies.filter(copy => copy.on === on).map(copy => [copy.id, copy])).values()];

/** What a switch, or its Undo, changes: the items it turns On, and those it turns Off. */
export interface Turns { on: LiveItem[]; off: LiveItem[] }

/** What switching to `profile` changes: each item it names that is Off turns On, and every other item that is On turns Off. */
export function switchPlan(profile: Pick<Profile, 'items'>, live: LiveItem[]): Turns {
  const named = new Set(profile.items);
  return { on: live.filter(item => named.has(item.id) && !item.on), off: live.filter(item => !named.has(item.id) && item.on) };
}

/** How many of the live items, and when the profile switches them the plugins' items (pluginLive), a profile names: what it has now. */
export const namedCount = (profile: Pick<Profile, 'items' | 'switchesPluginItems'>, live: LiveItem[], plugins: PluginLive[]) =>
  (profile.switchesPluginItems ? [...live, ...plugins] : live).filter(item => profile.items.includes(item.id)).length;

/**
 * Whether a profile is offered to switch to (the page's Switch, the status bar's and the menu bar's menus): one with nothing in
 * it would turn every item off, so it is offered once it has an item.
 */
export const switchable = (profile: Pick<Profile, 'items' | 'switchesPluginItems'>, live: LiveItem[], plugins: PluginLive[]) => namedCount(profile, live, plugins) > 0;

/**
 * The profiles in use: each one switching to which would change nothing and hold nothing, of its library items (switchPlan) and
 * of the plugins' items (`plugins`: pluginLive; pluginItemsAgree). A tool that can't switch one item of a plugin is left out of
 * that, so two profiles that differ only by such an item are both in use.
 */
export const inUse = (profiles: Profile[], live: LiveItem[], plugins: PluginLive[]) => profiles.filter(profile => !changes(switchPlan(profile, live)) && pluginItemsAgree(profile, plugins));

/** The names of the profiles in use, as the menus and the status bar say them ("Development and Incident"), or No profile. */
export function inUseName(profiles: Profile[], live: LiveItem[], plugins: PluginLive[]): string {
  const names = inUse(profiles, live, plugins).map(profile => profile.name);
  return names.length ? andList(names) : NO_PROFILE;
}

/**
 * A switch's items in two lists, each item once per direction: the library items it turns On and Off (switchPlan) and the
 * plugins' items some tool turns on or off (pluginPlan `on` and `off`). What the page's Switch offers and turnsWords counts.
 */
export const allTurns = (turns: Turns, plugins: PluginTurn[]) =>
  ({ on: [...turns.on, ...plugins.filter(item => item.on.length)], off: [...turns.off, ...plugins.filter(item => item.off.length)] });

/** How many items a plan turns On and Off together. */
export const changes = (turns: { on: unknown[]; off: unknown[] }) => turns.on.length + turns.off.length;

/**
 * What the Undo of a switch's History entry turns back, decided from each item now: each item it turned On that is still On
 * goes Off, each it turned Off that is still Off goes On. An item whose On or Off differs now, or one no longer in the library,
 * is left (one turned back and forth since, and now as the switch left it, is turned back like any other).
 */
export function undoPlan(event: Pick<HistoryEvent, 'profile'>, live: LiveItem[]): Turns {
  const still = (named: { id: string }[] | undefined, on: boolean) => live.filter(item => item.on === on && !!named?.some(entry => entry.id === item.id));
  return { on: still(event.profile?.off, false), off: still(event.profile?.on, true) };
}

/** What a switch's entry says it did, each item once: its library items, and its plugins' items by the copies it turned. */
export const entryTurns = (was: NonNullable<HistoryEvent['profile']>) =>
  ({ on: [...(was.on ?? []), ...itemsToward(was.plugins ?? [], true)], off: [...(was.off ?? []), ...itemsToward(was.plugins ?? [], false)] });

/** What the Undo of a switch's entry will turn back, each item once: its library items (undoPlan) and its plugins' items' copies (pluginUndo). */
export function undoTurns(event: Pick<HistoryEvent, 'profile'>, live: LiveItem[], plugins: PluginLive[]) {
  const library = undoPlan(event, live), back = pluginUndo(event, plugins).back.map(turn => ({ id: turn.item.id, on: turn.on }));
  return { on: [...library.on, ...itemsToward(back, true)], off: [...library.off, ...itemsToward(back, false)] };
}

/**
 * A plan's counts in words: what it will do ("turns 2 items on and 5 off") or did ("2 items turned on and 5 turned off"); ''
 * for nothing.
 */
export function turnsWords({ on, off }: { on: unknown[]; off: unknown[] }, tense: 'will' | 'did'): string {
  if (tense === 'did') return [on.length && `${plural(on.length, 'item')} turned on`, off.length && `${on.length ? off.length : plural(off.length, 'item')} turned off`].filter(Boolean).join(' and ');
  const both = on.length && off.length;
  return [on.length && `turns ${plural(on.length, 'item')} on`, off.length && (both ? `${off.length} off` : `turns ${plural(off.length, 'item')} off`)].filter(Boolean).join(' and ');
}

/** Shown beside a non-managing profile's count and in its tooltips (switchPreview, profilespage.ts). */
export const PLUGIN_ITEMS_STAY = 'Plugin items stay as they are.';

/** Shown beside a non-managing profile's count and in its tooltips (switchPreview, profilespage.ts): `PLUGIN_ITEMS_STAY`, or its exception when switching clears a shared Copilot CLI off-switch. */
export function pluginStayNote(plugs: PluginTurn[], plugins: PluginLive[]): string {
  const names = [...new Set(plugs.map(turn => plugins.find(item => item.id === turn.id)?.name).filter((name): name is string => !!name))];
  if (!names.length) return PLUGIN_ITEMS_STAY;
  return `Plugin items stay as they are, but for ${andList(names.map(name => `“${name}”`))} in Copilot CLI, which ${names.length === 1 ? 'shares its name' : 'share their names'} with yours.`;
}

/**
 * What the Profiles page's header and both profile menus say for `profile`, from the same rules (switchPlan, pluginPlan, inUse):
 * whether it is in use, empty, what switching turns on and off, or why it is held; for a profile that does not switch plugin
 * items, `pluginStayNote` sits beside it.
 */
export function switchPreview(profile: Profile, live: LiveItem[], plugins: PluginLive[]): string {
  const turns = switchPlan(profile, live), plugs = pluginPlan(profile, plugins), counted = allTurns(turns, plugs);
  const keep = profile.switchesPluginItems ? '' : `. ${pluginStayNote(plugs, plugins)}`;
  const count = namedCount(profile, live, plugins);
  if (!changes(turns) && !plugs.length) {
    const others = live.length + (profile.switchesPluginItems ? plugins.length : 0) - count;
    const rest = !others ? '' : profile.switchesPluginItems ? `, the other ${others} off wherever they can be switched` : `, the other ${others} of yours off`;
    return `In use · ${plural(count, 'item')} on${rest}${keep}`;
  }
  if (!count) return `0 items${keep}`;
  return changes(counted) ? `Switching ${turnsWords(counted, 'will')}${keep}` : `Not in use · ${heldWords(plugs, plugins).text}`;
}
