// Profiles' rules, pure (no files, no DOM). Read by profiles.ts (which carries a switch out), profilemigrate.ts, the Profiles
// page, History's page and the menus (main.ts), so each says the same. The profiles file and the switch itself are profiles.ts's.
// - A profile names library items (`skill:<key>`, `agent:<key>`, `mcp:<key>`) and, when `switchesPluginItems` is true, plugins'
//   items (`plugin:<kind>:<key>`, pluginItemId). Switching turns named items On and others Off (switchPlan), and when
//   `switchesPluginItems` is true each plugin copy wherever its tool has a switch for one item (pluginPlan).
// - Claude Code has no switch for one skill of a plugin, so there a profile that chooses plugin items has a plugin on while it
//   ticks any item the plugin brings there and off while it ticks none (takenWhole, the one rule; a skill it leaves out comes on
//   with a ticked one: PluginTurn `along`). One run per plugin carries it out (wholeRuns: its MCP servers' and agents' own
//   switches first, then the plugin's), whose steps History keeps for the Undo (`wholeSteps`, pluginUndo); said before by
//   wholeWords and the Profiles page's rows, after by wholeSaid.
// - In Copilot CLI a plugin's MCP server and any other server of the exact same bare name are one switch (`disabledMcpServers`;
//   while both his own and a plugin's are configured, Copilot CLI runs the plugin's). The same rule applies for each copy of a
//   name from what the switch will leave configured: kept on when the profile names it or another live member (`copilotKeptOnBy`),
//   or an unmanaged found entry holds that name; off otherwise. With `switchesPluginItems` false, `pluginPlan` includes only
//   Copilot CLI copies toward on sharing a named server (never held). Two writers share this rule without overlap (`withCopilotOff`):
//   when a switchable Copilot CLI plugin copy covers a name, `pluginPlan` / `pluginUndo` owns it and `plugins.ts setPart` writes it;
//   otherwise a standing rule rides on `LiveItem.copilotOff` (`switchPlan`, `inUse`, `switchPreview`, `copilotUndo`) and
//   `profiles.ts runCopilotRules` writes it.
// - `inUse` holds while a switch changes and holds nothing (never stored); `switchPreview` (`PLUGIN_ITEMS_STAY`, `pluginStayNote`)
//   gives the header and menu line, counting apart the items it turns off that still load from a copy Central Knot doesn't
//   write (a plugin's among them, while the switch turns that plugin's item nowhere), and how (`keptOn`, `stillLoadWords`,
//   `loadWords`; a switch's result asks the view after it: `stillLoadAfter`); `undoPlan`, `pluginUndo` and `copilotUndo` revert items still as left, never re-disabling a
//   Copilot CLI name a server of his uses now (`onAfterUndo`, `copilotHasYours`), and `undoOffered` (`undoInHome`) is the one rule
//   both History and the header ask. `itemRowState` words a library item's live state for its row tooltip (`profilespage.ts`; `switchPlan` puts any `copilotOff` item under Turns on or Turns off, so the Now column only sees on/off). Dormant ids
//   stay skipped; plugin-linked library items belong to `pluginLive` (`pluginItemKey`), not `liveItems`; found-only rows no
//   profile can tick are counted by `leftOut`.
import { earlierRootName, itemKey, type ItemKind, type LibraryItem } from './library.ts';
import { hashesOf, keptByOff, placeOf, type LoadWay } from './libraryrow.ts';
import { plural } from './model.ts';
import { itemThrough, pluginOnIn } from './pluginrows.ts';
import { isWhole, opposites, type PluginOp } from './pluginplan.ts';
import { loadsKind, pageOfPart, samePart } from './pluginstatus.ts';
import { cantSwitch, hasOwnSwitch, itemOffNow, itemSaid, onNow, ownSwitch, type PluginItemAt } from './pluginswitch.ts';
import { takesPlugins } from './presence.ts';
import { groupBy } from './model.ts';
import { andList, byToolOrder, kindNouns, orList, toolNames } from './words.ts';
import type { HarnessId, HistoryEvent, HomeView, InstalledPlugin, LibraryFacts, PluginItem, PluginSwitched, Profile } from './types.ts';

/** What every screen calls the state where no profile is in use. */
export const NO_PROFILE = 'No profile';

/** A profile's name for a library item: its kind and key, `skill:notes`. */
export const itemId = (kind: ItemKind, key: string) => `${kind}:${key}`;
/**
 * A plugin's item's plan key, one rule for each tool's copy, installed whole (a PluginItem, by its `keyName`) or placed in Pi or
 * OpenCode (a library item linked to the plugin, by its name, as pluginlibrary.ts readPlugin named it): `plugin@marketplace/item`,
 * a skill by its folder's name (one at the plugin's root by the plugin's) and an agent by its file's, compared as library keys
 * are (itemKey), an MCP server by its name as written. Not the name a tool's switch takes (PluginItem `name`).
 */
export const pluginItemKey = ({ plugin, marketName }: { plugin: string; marketName: string }, item: Pick<PluginItem, 'kind' | 'name' | 'keyName'>) =>
  `${plugin}@${marketName}/${item.kind === 'mcp' ? item.name : itemKey(item.keyName ?? item.name)}`;

/**
 * A profile's name for a plugin's item: `plugin:`, its kind and pluginItemKey, `plugin:skill:document-tools@team-tools/pdf`.
 * A library item's id begins with its kind, so none is one of these, whatever its name holds.
 */
export const pluginItemId = (kind: ItemKind, key: string) => `plugin:${itemId(kind, key)}`;

/**
 * A live library item (not deleted) as profiles see it. `except`: tools kept out of; `copilotOff`: exact Copilot CLI name currently
 * disabled in settings.json; `loadsElsewhere`: each tool that still loads it once an Off removes what Central Knot wrote, and how
 * (libraryrow.ts keptByOff, from the view: homeItems).
 */
export interface LiveItem { id: string; kind: ItemKind; key: string; name: string; on: boolean; except: LibraryItem['except']; copilotOff?: string; loadsElsewhere?: LoadsThere[] }
/** One tool that still loads an item of his once Off, and how; `through`, for a plugin's copy (way `plugin`), that plugin's item (its pluginItemId), which keptOn asks the switch about. */
export interface LoadsThere { tool: HarnessId; way?: LoadWay; through?: string }
/**
 * The tools that keep an item on once a switch turns it off (keptOn): for his item, `how`, the one way all of them share
 * (libraryrow.ts LoadWay); for a plugin's, `turnsOn` where the switch itself turns one of them on (Copilot CLI's, by its shared name).
 */
export interface KeptOn { tools: HarnessId[]; how?: LoadWay; turnsOn?: true }

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

/** Exact Copilot CLI server name for a library server (`row`: its LibraryFacts, if read). Shared with servers.ts rowFacts. */
export const copilotServerName = (row: Pick<LibraryFacts, 'copies' | 'plugin' | 'copilotName'> | undefined, name: string) => row?.copies['copilot-cli']?.folder ?? row?.plugin?.['copilot-cli']?.name ?? row?.copilotName ?? name;
/** Whether `row` holds an unmanaged found entry of exact name `server` in Copilot CLI (not On or applied there). */
const isFoundCopilot = (row: LibraryFacts, server: string, lib: LibraryItem | undefined, managed: boolean) =>
  row.copies['copilot-cli']?.folder === server && !(managed && (lib?.on || !!lib?.applied?.['copilot-cli']));
const ownHomeItems = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents' | 'profiles'>) => liveItems({ skill: home.skills.library, mcp: home.mcp.library, agent: home.agents.library }, recordedPlugins(home));
/** Attaches uncovered Copilot CLI `disabledMcpServers` blocks (`copilotOff`) to live MCP items, excluding names a switchable Copilot CLI plugin copy covers (`plugins`: pluginLive). */
export function withCopilotOff(items: LiveItem[], rows: readonly LibraryFacts[], plugins: readonly PluginLive[]): LiveItem[] {
  const covered = new Set(plugins.flatMap(item => (item.kind === 'mcp' && item.copies.some(copy => copy.tool === 'copilot-cli' && copy.way === 'switch') ? [item.name] : [])));
  const off = new Map(rows.flatMap(row => (row.copilotOff && !covered.has(row.copilotOff) ? [[row.key, row.copilotOff]] : [])));
  return items.map(item => (item.kind === 'mcp' && off.has(item.key) ? { ...item, copilotOff: off.get(item.key) } : item));
}
/** A home view's live items that profiles act on, with any uncovered Copilot CLI `disabledMcpServers` block (`withCopilotOff`) and where each loads from a copy Central Knot doesn't write (`withLoads`). */
export const homeItems = (home: PluginHome, plugins: readonly PluginLive[] = pluginLive(home)): LiveItem[] =>
  withCopilotOff(ownHomeItems(home), home.mcp.items, plugins).map(item => withLoads(home, item));
/** A live item with the tools that still load it once Off (LiveItem `loadsElsewhere`), from its row in `home`: a plugin's copy where a plugin has it on (pluginrows.ts pluginOnIn). */
function withLoads(home: PluginHome, item: LiveItem): LiveItem {
  const page = pageOfPart[item.kind], view = home[page], facts = view.items.find(row => row.key === item.key);
  if (!facts) return item;
  const row = { ...facts, hashes: hashesOf(facts.copies), pluginOn: pluginOnIn(home, page, facts) };
  const kept = view.tools.flatMap((tool): LoadsThere[] => {
    const left = keptByOff(row, view.library[item.key], tool), through = left?.way === 'plugin' ? pluginItemThrough(home, item.kind, facts, tool) : undefined;
    return left ? [{ tool, ...left, ...(through ? { through } : {}) }] : [];
  });
  return kept.length ? { ...item, loadsElsewhere: kept } : item;
}
/** The plugin's item (its pluginItemId) whose copy a tool has a row of his through (pluginrows.ts itemThrough), where the tool has that plugin installed. */
function pluginItemThrough(home: PluginHome, kind: ItemKind, facts: LibraryFacts, tool: HarnessId): string | undefined {
  const at = itemThrough(home, pageOfPart[kind], facts, tool), part = at?.install.items.find(each => samePart(each, at));
  return part && pluginItemId(kind, pluginItemKey(at!.install, part));
}
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
 * - `whole`: in Claude Code, its whole plugin's switch there (takenWhole): a skill's always, an MCP server's or agent's while
 *   the plugin is off (its own switch is set before the plugin comes on: wholeRuns);
 * - `stays`: the tool has none for one item of its kind (an agent in Copilot CLI), so the copy is left as its plugin has it and
 *   agrees with any profile;
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
  & ({ way: 'switch' | 'whole' | 'stays' } | { way: 'plugin-off' | 'held' | 'unread'; why: string });

/** A plugin's item some tool has now: its id in a profile (pluginItemId), the plugin's name and marketplace, and each tool's copy. */
export interface PluginLive { id: string; kind: ItemKind; name: string; plugin: string; marketName: string; copies: PluginCopy[] }

/** What pluginLive reads of a home: a page's view, or the read a switch makes (main.ts pluginSide). */
export type PluginHome = Pick<HomeView, 'pluginItems' | 'profiles' | 'skills' | 'mcp' | 'agents'>;

/** Why a copy can't be switched while its whole plugin is off in its tool (installed whole), or on Plugins (placed). */
const pluginOff = (plugin: string, tool: HarnessId) => `The whole plugin ${plugin} is off in ${toolNames[tool]}.`;
/** Other Copilot CLI servers sharing the exact bare name of a plugin's MCP server there (PluginCopy `sharesWith`). */
function copilotShares(home: PluginHome, at: PluginItemAt): PluginCopy['sharesWith'] {
  if (at.tool !== 'copilot-cli' || at.kind !== 'mcp') return undefined;
  const rows = new Map(home.mcp.items.map(row => [row.key, row]));
  const managed = ownHomeItems(home).filter(item => item.kind === 'mcp' && !item.except.includes(at.tool));
  const managedKeys = new Set(managed.map(item => item.key));
  const own = managed.filter(item => copilotServerName(rows.get(item.key), item.name) === at.name).map(item => item.id);
  const plugins = (home.pluginItems ?? []).flatMap(install => install !== at.install && install.tool === at.tool && !install.off
    ? install.items.filter(part => part.kind === 'mcp' && part.name === at.name).map(part => ({ id: pluginItemId('mcp', pluginItemKey(install, part)), plugin: install.plugin })) : []);
  const found = home.mcp.items.some(row => isFoundCopilot(row, at.name, home.mcp.library[row.key], managedKeys.has(row.key)));
  return own.length || plugins.length || found ? { own, plugins, ...(found ? { found: true as const } : {}) } : undefined;
}
/** Whether a plugin's MCP server in Copilot CLI shares its exact bare name with a live server of his own or a found one there. */
export const copilotSharesYours = (home: PluginHome, at: PluginItemAt): boolean => {
  const shared = copilotShares(home, at);
  return !!shared && (!!shared.found || ownHomeItems(home).some(item => item.on && shared.own.includes(item.id)));
};
/**
 * How a switch meets a copy installed whole: in Claude Code, by its whole plugin wherever its own switch alone can't turn it on;
 * elsewhere the whole plugin off in that tool first (the copy is off, whatever its own switch); then a tool with no switch for one
 * item of its kind; then a switch that can't be written (pluginswitch.ts cantSwitch); else the item's own switch (for a Copilot
 * CLI MCP server, carrying `sharesWith` for the exact-name rule).
 */
function installedWay(home: PluginHome, at: PluginItemAt): Pick<PluginCopy, 'way' | 'sharesWith'> & { why?: string } {
  if (at.tool === 'claude-cli' && (at.install.off || !ownSwitch(at))) return { way: 'whole' };
  if (at.install.off) return { way: 'plugin-off', why: pluginOff(at.install.plugin, at.tool) };
  if (!ownSwitch(at)) return { way: 'stays' };
  const why = cantSwitch(at);
  if (why) return { way: 'held', why };
  const sharesWith = copilotShares(home, at);
  return { way: 'switch', ...(sharesWith ? { sharesWith } : {}) };
}

/**
 * A root skill an earlier build placed under its copy's name (library.ts earlierRootName, without the folder) keeps, until its
 * plugin's next read moves it (library.ts A PLUGIN, THE MOVE), the key that build gave it: the plugin's name, where a tool has the
 * plugin installed whole as one skill at its root (its PluginItem `keyName`, the plugin's).
 */
function keyedAsBefore(home: PluginHome, kind: ItemKind, item: LibraryItem, entry: { plugin: string; marketName: string }): boolean {
  const atRoot = (install: InstalledPlugin) => install.items.some(part => part.kind === 'skill' && part.keyName === entry.plugin);
  return kind === 'skill' && earlierRootName(item.name) && !!home.pluginItems?.some(install => install.plugin === entry.plugin && install.marketName === entry.marketName && atRoot(install));
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
      const name = keyedAsBefore(home, kind, item, entry) ? entry.plugin : item.name;
      const key = pluginItemKey(entry, { kind, name }), row = home[pageOfPart[kind]].items.find(each => each.key === item.key);
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
  const other = profile.switchesPluginItems ? shared.plugins.find(entry => profile.items.includes(entry.id)) : undefined;
  if (other) return { by: 'plugin', plugin: other.plugin };
  if (shared.own.some(id => profile.items.includes(id))) return { by: 'own' };
  if (profile.switchesPluginItems && shared.found && copy.on) return { by: 'found' };
  return undefined;
}

/** Whether a personal server of exact name `server` (found, or his own On in `afterOn`) sits in Copilot CLI after Undo's turns. */
export const copilotHasYours = (server: string, rows: readonly LibraryFacts[], library: Record<string, LibraryItem>, afterOn: ReadonlySet<string>) =>
  rows.some(row => isFoundCopilot(row, server, library[row.key], !!library[row.key] && !library[row.key]!.deleted)
    || (afterOn.has(itemId('mcp', row.key)) && !library[row.key]?.except.includes('copilot-cli') && copilotServerName(row, library[row.key]?.name ?? row.name) === server));

/** An uncovered Copilot CLI off-switch cleared by a profile switch, as History keeps it. */
export type CopilotRule = { id: string; name: string; server: string };
/** Which uncovered Copilot CLI rules (`copilotCleared`) Undo puts back (`back`) or leaves off (`keptOff`, personal server present now); shared by `undoTurns` and `profiles.ts undoSwitch`. */
export function copilotUndo(event: Pick<HistoryEvent, 'profile'>, rows: readonly LibraryFacts[], library: Record<string, LibraryItem>, afterOn: ReadonlySet<string>): { back: CopilotRule[]; keptOff: string[] } {
  const back: CopilotRule[] = [], keptOff: string[] = [];
  for (const rule of event.profile?.copilotCleared ?? []) {
    if (rows.some(row => row.copilotOff === rule.server)) continue;
    if (copilotHasYours(rule.server, rows, library, afterOn)) { if (!keptOff.includes(rule.server)) keptOff.push(rule.server); }
    else back.push(rule);
  }
  return { back, keptOff };
}

/**
 * Claude Code's copy of a plugin as a profile has it, the one rule for a plugin there (it has no switch for one skill of one, so
 * the plugin is on or off whole): on while the profile ticks any item the copy brings (`ticked`), off while it ticks none; and
 * the skills it leaves out that come on there with a ticked one (`brought`). A plugin that brings nothing a profile can tick (only
 * hooks or commands) has no copy a profile sees, so it is left as it is.
 */
export function takenWhole(profile: Pick<Profile, 'items'>, install: InstalledPlugin): { ticked: PluginItem[]; brought: PluginItem[] } {
  const ticked = install.items.filter(part => profile.items.includes(pluginItemId(part.kind, pluginItemKey(install, part))));
  return { ticked, brought: ticked.length ? install.items.filter(part => part.kind === 'skill' && !ticked.includes(part)) : [] };
}
/** The plugin a plugin's item comes from as Claude Code has it installed and could read, if it does: what takenWhole is asked of. */
export const claudeInstall = (item: PluginLive): InstalledPlugin | undefined =>
  item.copies.flatMap(copy => (copy.tool === 'claude-cli' && copy.way !== 'unread' && 'install' in copy.target ? [copy.target.install] : []))[0];
/** How many skills a plugin brings in a tool: with more than one in Claude Code, a switch says what goes on or off with one (wholeWords, wholeSaid). */
const skillCount = (install: InstalledPlugin) => install.items.filter(part => part.kind === 'skill').length;

/**
 * What a switch to a profile would do to one plugin's item: the tools it turns on (`on`), those it turns off (`off`), and
 * those it can't (`held`); and where it comes on only with its whole plugin, the profile leaving it out (`along`: Claude Code,
 * takenWhole `brought`), which no count of the items a switch turns takes in. Direction is per tool: a shared Copilot CLI server
 * name can turn on there while turning off in Codex.
 */
export interface PluginTurn { id: string; on: HarnessId[]; off: HarnessId[]; held: { tool: HarnessId; why: string }[]; along?: HarnessId[] }

/**
 * What switching to `profile` would turn of the plugins' items, one item in one tool at a time. When
 * `profile.switchesPluginItems` is false, the only copies in its plan are Copilot CLI MCP copies toward on whose exact name
 * `profile` names among his own servers (never held); otherwise each copy that is not as wanted (on when `profile` names `item`,
 * when `copilotKeptOnBy` keeps that exact Copilot CLI name on, or for a skill in Claude Code when its plugin is on there:
 * takenWhole; off otherwise) is turned where its way is `switch` or `whole` (the whole plugin's: wholeRuns) and held, with why,
 * where it is `plugin-off` or `held`; an `unread` copy is held either way; a copy that `stays` is left. Only items with something
 * turned or held are listed; an id naming nothing any tool has now is dormant.
 */
export function pluginPlan(profile: Pick<Profile, 'items' | 'switchesPluginItems'>, items: PluginLive[]): PluginTurn[] {
  if (!profile.switchesPluginItems) {
    return items.flatMap(item => {
      const on = item.copies.filter(copy => copy.way === 'switch' && !copy.on && copilotKeptOnBy(profile, item, copy)?.by === 'own').map(copy => copy.tool);
      return on.length ? [{ id: item.id, on, off: [], held: [] }] : [];
    });
  }
  return items.flatMap(item => {
    const ticked = profile.items.includes(item.id);
    const along = (copy: PluginCopy) => !ticked && copy.way === 'whole' && 'install' in copy.target && takenWhole(profile, copy.target.install).brought.some(part => samePart(part, item));
    const want = (copy: PluginCopy) => ticked || along(copy) || !!copilotKeptOnBy(profile, item, copy);
    const differ = item.copies.filter(copy => copy.way === 'unread' || (copy.way !== 'stays' && copy.on !== want(copy)));
    const turned = differ.filter(copy => copy.way === 'switch' || copy.way === 'whole'), tools = (copies: PluginCopy[]) => copies.map(copy => copy.tool);
    const on = tools(turned.filter(copy => want(copy) && !along(copy))), off = tools(turned.filter(copy => !want(copy))), comes = tools(turned.filter(along));
    const held = differ.flatMap(copy => ('why' in copy ? [{ tool: copy.tool, why: copy.why }] : []));
    return on.length || off.length || held.length || comes.length ? [{ id: item.id, on, off, held, ...(comes.length ? { along: comes } : {}) }] : [];
  });
}

/** A plugin Claude Code takes whole, as one run of a switch or its Undo: the copies of it the run turns, and its steps, run together (pluginplan.ts runPlan). */
export interface WholeRun { copies: CopyTurn[]; ops: PluginOp[] }

/**
 * How a switch carries out its turns in Claude Code (CopyTurn, from pluginPlan), one run per plugin there: while the profile ticks
 * any item of it (takenWhole), each MCP server's and agent's own switch toward its tick, then the plugin's own on (pluginplan.ts
 * batches runs them in that order, so nothing the profile leaves out loads meanwhile); while it ticks none, the plugin's own off,
 * the parts' switches left as they are. Each step only where Claude Code has it otherwise now.
 */
export function wholeRuns(profile: Pick<Profile, 'items'>, copies: CopyTurn[]): WholeRun[] {
  const claude = copies.filter(turn => turn.copy.tool === 'claude-cli' && 'install' in turn.copy.target);
  return [...groupBy(claude, turn => (turn.copy.target as PluginItemAt).install).entries()].map(([install, turns]) => {
    const { ticked } = takenWhole(profile, install), on = ticked.length > 0;
    const at = { source: install.source ?? '', marketName: install.marketName, plugin: install.plugin, tool: install.tool };
    const parts = on ? install.items.filter(part => hasOwnSwitch(install.tool, part.kind) && itemOffNow(install, part) === ticked.includes(part)) : [];
    return { copies: turns, ops: [...parts.map((part): PluginOp => ({ ...at, part: { kind: part.kind, name: part.name }, action: ticked.includes(part) ? 'part-on' : 'part-off' })),
      ...(on === !!install.off ? [{ ...at, action: on ? 'plugin-on' as const : 'plugin-off' as const }] : [])] };
  });
}

/** Whether the plugins' items agree with a profile (their part of "in use"): a switch to it would turn none, and hold none. */
export const pluginItemsAgree = (profile: Pick<Profile, 'items' | 'switchesPluginItems'>, items: PluginLive[]) => !pluginPlan(profile, items).length;

/** One copy of a plugin's item to turn in one tool, toward `on`: a switch's (pluginPlan) or its Undo's (pluginUndo), as profiles.ts carries it out. */
export interface CopyTurn { item: PluginLive; copy: PluginCopy; on: boolean }

/** The live library item ids that will be On once an Undo's `turns` run. */
export const onAfterUndo = (live: LiveItem[], turns: Turns) => new Set(live.filter(item => (item.on && !turns.off.includes(item)) || turns.on.includes(item)).map(item => item.id));

/** Whether Claude Code has a plugin as a switch's steps on it left it: on unless they turned it off, each part's own switch as they set it. */
const asLeft = (install: InstalledPlugin, steps: PluginOp[]) => !install.off === !steps.some(op => op.action === 'plugin-off')
  && steps.every(op => !op.part || itemOffNow(install, op.part) === (op.action === 'part-off'));

/**
 * What the Undo of a switch's History entry turns back of the plugins' items (HistoryEvent profile `plugins`), decided from each
 * copy now: each still as the switch left it, still the plugin's and still turned by its own switch there goes back (`back`),
 * unless putting a Copilot CLI rule back would turn off a server of his there now (`afterOn` or found: `keptOff`); each other
 * is left (`left`), with why (`gone`, or changed since). A copy in Claude Code turned with its whole plugin (the entry's
 * `wholeSteps`) goes back with that plugin's steps reversed, one run (`whole`), while the plugin is as they left it (asLeft).
 */
export function pluginUndo(event: Pick<HistoryEvent, 'profile'>, items: PluginLive[], afterOn?: ReadonlySet<string>): { back: CopyTurn[]; whole: WholeRun[]; left: { copy: PluginSwitched; why: string }[]; keptOff: string[] } {
  const back: CopyTurn[] = [], left: { copy: PluginSwitched; why: string }[] = [], keptOff: string[] = [], whole = new Map<InstalledPlugin, WholeRun>();
  const afterProfile = { items: [...(afterOn ?? [])], switchesPluginItems: true };
  for (const done of event.profile?.plugins ?? []) {
    const item = items.find(each => each.id === done.id), copy = item?.copies.find(each => each.tool === done.tool);
    const steps = (event.profile?.wholeSteps ?? []).filter(op => op.tool === done.tool && op.plugin === item?.plugin && op.marketName === item.marketName);
    if (steps.length) {
      const install = copy && copy.way !== 'unread' && 'install' in copy.target ? copy.target.install : undefined;
      if (!install || !asLeft(install, steps)) { left.push({ copy: done, why: copy?.way === 'unread' ? 'its copy couldn’t be read' : 'changed since the switch' }); continue; }
      back.push({ item: item!, copy: copy!, on: !done.on });
      (whole.get(install) ?? whole.set(install, { copies: [], ops: opposites(steps) }).get(install)!).copies.push(back.at(-1)!);
      continue;
    }
    const kept =done.on && copy?.way === 'switch' && copy.on && copy.tool === 'copilot-cli' && item?.kind === 'mcp' ? copilotKeptOnBy(afterProfile, item, copy) : undefined;
    if (done.on && copy?.gone) left.push({ copy: done, why: 'deleted by hand since' });
    else if (kept?.by === 'own' || kept?.by === 'found') { if (!keptOff.includes(item!.name)) keptOff.push(item!.name); }
    else if (item && copy?.way === 'switch' && copy.on === done.on) back.push({ item, copy, on: !done.on });
    else left.push({ copy: done, why: 'changed since the switch' });
  }
  return { back, whole: [...whole.values()], left, keptOff };
}

/** Whether a plugin's item is on for "Start from what’s on now": on in some tool that switches it; where no tool does, in any tool. */
export function pluginItemOn(item: PluginLive): boolean {
  const switched = item.copies.filter(copy => copy.way === 'switch');
  return (switched.length ? switched : item.copies).some(copy => copy.on);
}

/** What an in-use profile's Now column says for a plugin's item (profilespage.ts). */
export function pluginRowState(profile: Pick<Profile, 'items' | 'switchesPluginItems'>, item: PluginLive): 'On' | 'Off' | 'Off · on in Copilot CLI' {
  const switched = item.copies.filter(copy => copy.way === 'switch');
  const own = switched.filter(copy => !copilotKeptOnBy(profile, item, copy));
  if (!switched.length || !own.length || own.some(copy => copy.on)) return pluginItemOn(item) ? 'On' : 'Off';
  return switched.some(copy => copy.on) ? 'Off · on in Copilot CLI' : 'Off';
}

/** What a library item's row tooltip says for its state now (`profilespage.ts`; `switchPlan` puts any `copilotOff` item under Turns on or Turns off, so the Now column never sees it). */
export const itemRowState = (item: Pick<LiveItem, 'on' | 'copilotOff'>): 'on' | 'off' | 'off in Copilot CLI' =>
  (!item.on ? 'off' : item.copilotOff ? 'off in Copilot CLI' : 'on');

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

/** What switching to `profile` changes: each item it names that is Off (or blocked by an orphan Copilot CLI off-switch) turns On, and every other On item turns Off. */
export function switchPlan(profile: Pick<Profile, 'items'>, live: LiveItem[]): Turns {
  const named = new Set(profile.items);
  return { on: live.filter(item => named.has(item.id) && (!item.on || !!item.copilotOff)), off: live.filter(item => !named.has(item.id) && item.on) };
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
 * of the plugins' items (`plugins`: pluginLive; pluginItemsAgree). A copy that `stays` (a plugin's agent in Copilot CLI) is left
 * out of that, so two profiles that differ only by such an item are both in use. In Claude Code a plugin is on or off whole
 * (takenWhole): a profile that ticks one of its skills stops being in use when the plugin is turned off there by hand, and is in
 * use again once it is back on; two that tick different items of it are both in use while it is on.
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
 * The tools that keep an item on once a switch turns it off, from a copy Central Knot doesn't write, given the plugins' items the
 * switch turns (`plugs`: its pluginPlan; after a switch, those its entry turned: entryPlugs):
 * - his item's (`loadsElsewhere`), a plugin's copy only while `plugs` turns that plugin's item nowhere: where it turns it, that item
 *   is in the switch's own count, said once there (turned on, or turned off with where it stays on);
 * - a plugin's (from its copies' own fields), each copy on now or that its turn turns on, and not one it turns off.
 * Asked before a switch it projects; after one, it reads back.
 */
export function keptOn(item: LiveItem | PluginLive, plugs: readonly Pick<PluginTurn, 'id' | 'on' | 'off'>[] = []): KeptOn {
  if (!('copies' in item)) {
    const turned = new Set(plugs.filter(turn => turn.on.length || turn.off.length).map(turn => turn.id));
    const kept = (item.loadsElsewhere ?? []).filter(each => !each.through || !turned.has(each.through)), ways = new Set(kept.map(each => each.way));
    return { tools: kept.map(each => each.tool), ...(ways.size === 1 && kept[0]!.way ? { how: kept[0]!.way } : {}) };
  }
  const turn = plugs.find(each => each.id === item.id);
  const tools = item.copies.filter(copy => (copy.on || !!turn?.on.includes(copy.tool)) && copy.way !== 'unread' && !turn?.off.includes(copy.tool)).map(copy => copy.tool);
  return { tools, ...(tools.some(tool => turn?.on.includes(tool)) ? { turnsOn: true as const } : {}) };
}

/** How items of his still load (keptOn), said once: the way they all share, else "another way". */
export const loadWords = (kept: KeptOn[]) => (new Set(kept.map(each => each.how)).size === 1 && kept[0]?.how
  ? { shared: 'from the shared skills folder', link: 'through a link', yours: 'from a copy of yours there', tool: 'from another tool’s folder', plugin: 'through a plugin' }[kept[0].how] : 'another way');
/** After the count of items a switch turns off, or turned: how many of his (`yours`) still load, and how, and how many plugins' items stay on, in which tools; '' for none. */
export function stillLoadWords(yours: KeptOn[], plugins: KeptOn[]): string {
  const where = (list: KeptOn[]) => orList([...new Set(list.flatMap(each => each.tools))].sort(byToolOrder).map(tool => toolNames[tool]));
  const own = yours.filter(each => each.tools.length), plugin = plugins.filter(each => each.tools.length);
  // One the switch turns on was off there: it is on, it doesn't stay on.
  const [one, many] = plugin.some(each => each.turnsOn) ? ['is', 'are'] : ['stays', 'stay'];
  return [own.length ? `${own.length} still ${own.length === 1 ? 'loads' : 'load'} ${loadWords(own)}, in ${where(own)}` : '',
    plugin.length ? `${plugin.length} ${plugin.length === 1 ? one : many} on in ${where(plugin)}, through ${plugin.length === 1 ? 'its plugin' : 'their plugins'}` : '']
    .filter(Boolean).map(part => `; ${part}`).join('');
}

/** What a switch's result adds of the items its entry turned off that still load, asked of the view after it (`home`). */
export function stillLoadAfter(entry: NonNullable<HistoryEvent['profile']>, home: PluginHome): string {
  const off = new Set(entryTurns(entry).off.map(each => each.id)), plugins = pluginLive(home), plugs = entryPlugs(entry);
  const kept = (items: (LiveItem | PluginLive)[]) => items.filter(item => off.has(item.id)).map(item => keptOn(item, plugs));
  return stillLoadWords(kept(homeItems(home, plugins).filter(item => !item.on)), kept(plugins));
}
/** The plugins' items a switch's entry turned, each with the tools it turned on and off there (as pluginPlan's turns). */
const entryPlugs = (entry: NonNullable<HistoryEvent['profile']>) => [...new Set((entry.plugins ?? []).map(copy => copy.id))]
  .map(id => { const copies = entry.plugins!.filter(copy => copy.id === id); return { id, on: copies.filter(copy => copy.on).map(copy => copy.tool), off: copies.filter(copy => !copy.on).map(copy => copy.tool) }; });

/**
 * What the Undo of a switch's History entry turns back, decided from each item now: each item it turned On that is still On
 * goes Off, each it turned Off that is still Off goes On. An item whose On or Off differs now, or one no longer in the library,
 * is left (one turned back and forth since, and now as the switch left it, is turned back like any other).
 */
export function undoPlan(event: Pick<HistoryEvent, 'profile'>, live: LiveItem[]): Turns {
  const still = (named: { id: string }[] | undefined, on: boolean) => live.filter(item => item.on === on && !!named?.some(entry => entry.id === item.id));
  return { on: still(event.profile?.off, false), off: still(event.profile?.on, true) };
}

/** What a switch's entry says it did, each item once: its library items, its orphan Copilot CLI clears, and its plugins' items. */
export function entryTurns(was: NonNullable<HistoryEvent['profile']>) {
  const add = (base: { id: string }[] | undefined, extra: { id: string }[]) => [...(base ?? []), ...extra.filter(item => !base?.some(other => other.id === item.id))];
  return { on: [...add(was.on, was.undoOf ? [] : was.copilotCleared ?? []), ...itemsToward(was.plugins ?? [], true)],
    off: [...add(was.off, was.undoOf ? was.copilotCleared ?? [] : []), ...itemsToward(was.plugins ?? [], false)] };
}

/** What the Undo of a switch's entry will turn back, each item once: its library items (undoPlan), uncovered Copilot CLI rules (`copilotUndo`) and plugins' items (pluginUndo). */
export function undoTurns(event: Pick<HistoryEvent, 'profile'>, live: LiveItem[], plugins: PluginLive[], mcp: Pick<HomeView['mcp'], 'items' | 'library'> = { items: [], library: {} }) {
  const library = undoPlan(event, live), afterOn = onAfterUndo(live, library), back = pluginUndo(event, plugins, afterOn).back.map(turn => ({ id: turn.item.id, on: turn.on }));
  const rules = copilotUndo(event, mcp.items, mcp.library, afterOn).back.filter(rule => !library.off.some(item => item.id === rule.id));
  return { on: [...library.on, ...itemsToward(back, true)], off: [...library.off, ...rules, ...itemsToward(back, false)] };
}

/** What undoing a profile entry turns back in `home` as the page read it: its live items, plugins' items and MCP servers from that one read. */
export function undoInHome(event: Pick<HistoryEvent, 'profile'>, home: PluginHome) {
  const plugins = pluginLive(home);
  return undoTurns(event, homeItems(home, plugins), plugins, home.mcp);
}

/** Whether Undo is offered for a profile entry in `home`: true only while at least one item, plugin copy or Copilot CLI rule can be turned back (shared by the header and History). */
export const undoOffered = (event: Pick<HistoryEvent, 'profile'>, home: PluginHome): boolean => changes(undoInHome(event, home)) > 0;

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
  return `Plugin items stay as they are, except the ${names.length === 1 ? `plugin’s “${names[0]}” turns` : `plugins’ ${andList(names.map(name => `“${name}”`))} turn`} on in Copilot CLI (same name as yours).`;
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
  const kept = stillLoadWords(turns.off.map(item => keptOn(item, plugs)), plugs.filter(turn => turn.off.length).map(turn => keptOn(plugins.find(item => item.id === turn.id)!, plugs)));
  return changes(counted) ? `Switching ${turnsWords(counted, 'will')}${kept}${wholeWords(profile, plugins)}${keep}` : `Not in use · ${heldWords(plugs, plugins).text}`;
}

/**
 * After switchPreview's count, what a switch to `profile` does to each plugin it turns on or off whole in Claude Code
 * (takenWhole) with more than one skill there (one skill's switch is the plugin's), a sentence each: ". Also turns on 2 other
 * skills of docs in Claude Code" (its skills the profile leaves out), ". Turns docs off in Claude Code, with its 3 skills and
 * everything else it brings there" (its hooks and commands stop too); '' for none.
 */
export function wholeWords(profile: Pick<Profile, 'items' | 'switchesPluginItems'>, plugins: PluginLive[]): string {
  if (!profile.switchesPluginItems) return '';
  return [...new Set(plugins.map(claudeInstall))].flatMap(install => {
    if (!install || skillCount(install) < 2) return [];
    const { ticked, brought } = takenWhole(profile, install), other = ticked.some(part => part.kind === 'skill') ? 'other skill' : 'skill';
    if (!ticked.length) return install.off ? [] : [`. Turns ${install.plugin} off in Claude Code, with its ${skillCount(install)} skills and everything else it brings there`];
    return install.off && brought.length ? [`. Also turns on ${plural(brought.length, other)} of ${install.plugin} in Claude Code`] : [];
  }).join('');
}

/**
 * What a switch's result adds for each plugin whose whole switch in Claude Code its steps turned (HistoryEvent profile
 * `wholeSteps`), with more than one skill there, in the Library's words (pluginswitch.ts itemSaid), read from the view after it
 * (`home`): " a is on in Claude Code. Its whole plugin docs was turned on there, with its 2 other skills."; '' for none.
 */
export function wholeSaid(entry: NonNullable<HistoryEvent['profile']>, home: PluginHome): string {
  const steps = entry.wholeSteps ?? [];
  return steps.filter(op => isWhole(op.action)).flatMap(op => {
    const on = op.action === 'plugin-on', install = home.pluginItems?.find(each => each.tool === op.tool && each.plugin === op.plugin && each.marketName === op.marketName);
    const part = install?.items.find(each => entry.plugins?.some(copy => copy.tool === op.tool && copy.on === on && copy.id === pluginItemId(each.kind, pluginItemKey(install, each))));
    return install && part && skillCount(install) > 1 ? [` ${itemSaid({ kind: part.kind, name: part.name, tool: op.tool, install }, on, steps)}`] : [];
  }).join('');
}
