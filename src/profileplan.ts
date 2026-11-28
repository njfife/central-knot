// Profiles' rules, pure (no files, no DOM). Read by profiles.ts (which carries a switch out), profilemigrate.ts, the Profiles
// page, History's page and the menus (main.ts), so each says the same. The profiles file and the switch itself are profiles.ts's.
// - A profile names library items (`skill:<key>`, `agent:<key>`, `mcp:<key>`) and, when `switchesPluginItems` is true, plugins'
//   items (`plugin:<kind>:<key>`, pluginItemId). Switching turns named items On and others Off (switchPlan), and when
//   `switchesPluginItems` is true each plugin copy wherever its tool has a switch for one item (pluginPlan).
// - Where it keeps each of its library items out is effectiveOut's alone: of the tools the item's kind is managed in, those
//   outside its `tools` and its `out` for the item; a profile with neither, and any tool not managed, keep the Library's
//   keep-outs. switchPlan's `except` sets them, inUse compares them, listedChanges says them (`Changes tools`), undoPlan puts
//   them back; toolsOf is the tools its strip ticks, withTool a tick there; outNow fills `out` from the Library.
// - Claude Code has no switch for one skill of a plugin, so there a profile that chooses plugin items has a plugin on while it
//   ticks any item the plugin brings there and off while it ticks none (takenWhole, the one rule; a skill it leaves out comes on
//   with a ticked one: comesWith, PluginTurn `along`; the plugins a switch turns on or off there: wholeTurns). One run per plugin
//   carries it out (wholeRuns: its MCP servers' and agents' own switches first, then the plugin's), whose steps History keeps for
//   the Undo (`wholeSteps`, pluginUndo); said before by switchPreview and the Profiles page, after by wholeSaid.
// - In Copilot CLI a plugin's MCP server and any other server of the exact same bare name are one switch (`disabledMcpServers`;
//   while both his own and a plugin's are configured, Copilot CLI runs the plugin's). The same rule applies for each copy of a
//   name from what the switch will leave configured: kept on when the profile names it or another live member (`copilotKeptOnBy`),
//   or an unmanaged found entry holds that name; off otherwise. With `switchesPluginItems` false, `pluginPlan` includes only
//   Copilot CLI copies toward on sharing a named server (never held). Two writers share this rule without overlap (`withCopilotOff`):
//   when a switchable Copilot CLI plugin copy covers a name, `pluginPlan` / `pluginUndo` owns it and `plugins.ts setPart` writes it;
//   otherwise a standing rule rides on `LiveItem.copilotOff` (`switchPlan`, `inUse`, `switchPreview`, `copilotUndo`) and
//   `profiles.ts runCopilotRules` writes it.
// - `inUse` holds while a switch changes and holds nothing (never stored); while none is, the one last switched to is named
//   `Everyday · changed` (`lastSwitched`, from History, never stored either): `profileNow` is the one rule every place that names
//   the profile in use asks. `endedByChanges` says before a Library click which in use it would end (its changes projected over the
//   live and plugin items: projected), by the rule its result says after it (`endedProfiles`), and the name every place would then give;
//   `listedPlugins` is the one rule for which plugin rows
//   a profile lists and `listedChanges` gives each listed changing row once with its cell words (read by the header's short line,
//   `Changes N`, its headings and every row's cell); `switchPreview` (`PLUGIN_ITEMS_STAY`, `pluginStayNote`) gives
//   `{ line, card, tip? }` (short header line, full menu sentence, and `(?)` card only when `card` says more than its plain form),
//   counting apart the items it turns off that still load from a copy Central Knot doesn't
//   write (a plugin's among them, while the switch turns that plugin's item nowhere), and how (`keptOn`, `stillLoadWords`,
//   `loadWords`; a switch's result asks the view after it: `stillLoadAfter`); `undoPlan`, `pluginUndo` and `copilotUndo` revert items still as left, never re-disabling a
//   Copilot CLI name a server of his uses now (`onAfterUndo`, `copilotHasYours`), and `undoOffered` (`undoInHome`) is the one rule
//   both History and the header ask. `itemRowState` and `pluginLiveState` word an item's live state for its row tooltip (`pluginRowState` gives the `Off · on in <Tool>` tag for an in-use plugin row). Dormant ids
//   stay skipped; plugin-linked library items belong to `pluginLive` (`pluginItemKey`), not `liveItems`; found-only rows no
//   profile can tick are counted by `leftOut` (`leftOutWords`).
import { earlierRootName, itemKey, type ItemKind, type LibraryItem } from './library.ts';
import { hashesOf, keptByOff, placeOf, type LoadWay } from './libraryrow.ts';
import { plural } from './model.ts';
import { itemThrough, pluginOnIn } from './pluginrows.ts';
import { isWhole, opposites, type PluginOp } from './pluginplan.ts';
import { loadsKind, pageOfPart, pluginOff, samePart } from './pluginstatus.ts';
import { cantSwitch, hasOwnSwitch, itemOffNow, itemSaid, onNow, ownSwitch, type PluginItemAt } from './pluginswitch.ts';
import { holds, takesPlugins } from './presence.ts';
import { groupBy } from './model.ts';
import { andList, byToolOrder, changedName, harnessIds, keptOutWords, kindNouns, orList, sameTools, toolNames } from './words.ts';
import type { ExceptSwitched, HarnessId, HistoryEvent, HomeView, InstalledPlugin, LibraryFacts, PluginItem, PluginSwitched, Profile, ProfilesView, Change } from './types.ts';

/** What every screen calls the state where no profile is in use and none was last switched to, or that one is gone (profileNow). */
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
export interface LiveItem { id: string; kind: ItemKind; key: string; name: string; on: boolean; except: LibraryItem['except']; copilotOff?: string; loadsElsewhere?: LoadsThere[];
  /** The tools its kind is managed in here, where the caller knows them: only those are a profile's to decide (effectiveOut). */ managed?: HarnessId[] }
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
 * linked to a plugin (`plugins`: the ids of the plugins the home records), which are that plugin's items (pluginLive); where the
 * managed tools are given, each with those that hold its kind (presence.ts holds): the page and the switch decide the same.
 */
export function liveItems(libraries: Libraries, plugins: ReadonlySet<string>, managed?: readonly HarnessId[]): LiveItem[] {
  return KINDS.flatMap(kind => Object.values(libraries[kind]).filter(item => !item.deleted && !linkedToPlugin(item, plugins))
    .map(({ key, name, on, except }) => ({ id: itemId(kind, key), kind, key, name, on, except, ...(managed ? { managed: managed.filter(tool => holds(tool, kind)) } : {}) })));
}

/** Exact Copilot CLI server name for a library server (`row`: its LibraryFacts, if read). Shared with servers.ts rowFacts. */
export const copilotServerName = (row: Pick<LibraryFacts, 'copies' | 'plugin' | 'copilotName'> | undefined, name: string) => row?.copies['copilot-cli']?.folder ?? row?.plugin?.['copilot-cli']?.name ?? row?.copilotName ?? name;
/** Whether `row` holds an unmanaged found entry of exact name `server` in Copilot CLI (not On or applied there). */
const isFoundCopilot = (row: LibraryFacts, server: string, lib: LibraryItem | undefined, managed: boolean) =>
  row.copies['copilot-cli']?.folder === server && !(managed && (lib?.on || !!lib?.applied?.['copilot-cli']));
// Skills are held by every managed tool, so their page's tools are the managed ones.
const ownHomeItems = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents' | 'profiles'>) => liveItems({ skill: home.skills.library, mcp: home.mcp.library, agent: home.agents.library },
  recordedPlugins(home), home.skills.tools);
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
 * The Profiles page's short line and `(?)` card on what its list leaves out, with leftOut's counts (`line`, and `card` for
 * Found in the Library with Add); undefined when it leaves nothing out.
 */
export function leftOutWords(counts: Record<ItemKind, number>): { line: string; card: string } | undefined {
  const counted = andList(KINDS.filter(kind => counts[kind]).map(kind => plural(counts[kind], kindNouns[pageOfPart[kind]].one, kindNouns[pageOfPart[kind]].many)));
  if (!counted) return undefined;
  const one = KINDS.reduce((sum, kind) => sum + counts[kind], 0) === 1;
  return { line: `${counted} in your tools ${one ? 'isn’t' : 'aren’t'} in Central Knot`,
    card: `${one ? 'It is' : 'They are'} under Found in the Library, with Add ${one ? 'if it' : 'on each that'} can be taken in.` };
}

/** The tools `profile` itself keeps item `id` out of, any tool: outside its `tools`, and its `out` for it; undefined with neither. */
const keptOutBy = (profile: Pick<Profile, 'tools' | 'out'>, id: string) => (!profile.tools && !profile.out ? undefined
  : new Set([...profile.out?.[id] ?? [], ...harnessIds.filter(tool => profile.tools && !profile.tools.includes(tool))]));
/**
 * Where switching to `profile` keeps `item` out, in tool order: in each tool its kind is managed in (LiveItem `managed`; every
 * one where not given), as the profile keeps it out (keptOutBy); in the others, as the Library does. Undefined for a profile
 * with neither field (all saved before they were stored): the item's keep-outs stay as the Library has them.
 */
export function effectiveOut(profile: Pick<Profile, 'tools' | 'out'>, item: Pick<LiveItem, 'id' | 'except' | 'managed'>): HarnessId[] | undefined {
  const own = keptOutBy(profile, item.id);
  return own && harnessIds.filter(tool => (!item.managed || item.managed.includes(tool) ? own.has(tool) : item.except.includes(tool)));
}
/** A profile's `tools` once `tool` is ticked (`on`) or unticked on its strip: an untick leaves out that one, every other tool still in. */
export const withTool = (profile: Pick<Profile, 'tools'>, tool: HarnessId, on: boolean) =>
  (on ? [...profile.tools ?? [], tool] : (profile.tools ?? harnessIds).filter(other => other !== tool));
/** Whether a profile applies in `tool` (its `tools` names it, or it has none): a switch to it changes nothing in a tool it doesn't, a plugin's copy there included. */
export const appliesIn = (profile: Pick<Profile, 'tools'>, tool: HarnessId) => !profile.tools || profile.tools.includes(tool);
/** The managed tools a profile applies to (appliesIn): what its Tools strip ticks and the list counts. */
export const toolsOf = (profile: Pick<Profile, 'tools'>, managed: readonly HarnessId[]) => managed.filter(tool => appliesIn(profile, tool));
/** A profile's `out` as the Library has its ticked items now (`live`): each one's keep-outs, where it has any (profiles.ts saveProfile fills one in so). */
export const outNow = (profile: Pick<Profile, 'items'>, live: LiveItem[]) =>
  Object.fromEntries(live.filter(item => profile.items.includes(item.id) && item.except.length).map(item => [item.id, [...item.except]]));

// ---------- A plugin's items ----------

/**
 * One tool's copy of a plugin's item as a switch to a profile meets it. `on`: on there now (pluginswitch.ts onNow; in Pi,
 * OpenCode and Antigravity its library item's On). `way`:
 * - `switch`: the item's own switch there (pluginswitch.ts ownSwitch; in Pi, OpenCode and Antigravity its library item's On and Off);
 * - `whole`: in Claude Code, its whole plugin's switch there (takenWhole): a skill's always, an MCP server's or agent's while
 *   the plugin is off (its own switch is set before the plugin comes on: wholeRuns), but not while the plugins record keeps it off;
 * - `stays`: the tool has none for one item of its kind (an agent in Copilot CLI), so the copy is left as its plugin has it and
 *   agrees with any profile;
 * - `plugin-off`: the whole plugin is off in that tool (placed: Off on Plugins; in Claude Code, only where the plugins record keeps it
 *   off: InstalledPlugin `keptOff`), so the copy is off; no switch turns it on;
 * - `held`: its own switch can't be used now, and `why`;
 * - `unread`: that tool's copy of the plugin couldn't be read (types.ts InstalledPlugin `problem`), so whether it is on isn't
 *   known (`on` is false): it agrees with no profile, and nothing is written there.
 * `target`: what a switch turns, the copy installed whole as pluginswitch.ts click takes it, or the placed copy's library item.
 * `sharesWith`, a server in Copilot CLI: the other members sharing its exact bare name there — `own` (profile ids of his own
 * live servers in Central Knot Copilot CLI has or will have under that exact name; `out`, those kept out of it now), `plugins` (other enabled
 * plugins' servers of that exact name there), and `found` (an unmanaged entry of his in Copilot CLI's file that no profile
 * switches).
 * `gone`, a placed copy: its item is On and was applied there, and the tool has no copy now: deleted by hand since.
 */
export type PluginCopy = { tool: HarnessId; on: boolean; target: PluginItemAt | { libraryKey: string }; sharesWith?: { own: string[]; out?: string[]; plugins: { id: string; plugin: string }[]; found?: true }; gone?: true }
  & ({ way: 'switch' | 'whole' | 'stays' } | { way: 'plugin-off' | 'held' | 'unread'; why: string });

/** A plugin's item some tool has now: its id in a profile (pluginItemId), the plugin's name and marketplace, and each tool's copy. */
export interface PluginLive { id: string; kind: ItemKind; name: string; plugin: string; marketName: string; copies: PluginCopy[] }

/** What pluginLive reads of a home: a page's view, or the read a switch makes (main.ts pluginSide). */
export type PluginHome = Pick<HomeView, 'pluginItems' | 'profiles' | 'skills' | 'mcp' | 'agents'>;

/** Other Copilot CLI servers sharing the exact bare name of a plugin's MCP server there (PluginCopy `sharesWith`). */
function copilotShares(home: PluginHome, at: PluginItemAt): PluginCopy['sharesWith'] {
  if (at.tool !== 'copilot-cli' || at.kind !== 'mcp') return undefined;
  const rows = new Map(home.mcp.items.map(row => [row.key, row]));
  const servers = ownHomeItems(home).filter(item => item.kind === 'mcp'), managed = servers.filter(item => !item.except.includes(at.tool));
  const managedKeys = new Set(managed.map(item => item.key));
  const named = servers.filter(item => copilotServerName(rows.get(item.key), item.name) === at.name), own = named.map(item => item.id);
  const out = named.filter(item => item.except.includes(at.tool)).map(item => item.id);
  const plugins = (home.pluginItems ?? []).flatMap(install => install !== at.install && install.tool === at.tool && !install.off
    ? install.items.filter(part => part.kind === 'mcp' && part.name === at.name).map(part => ({ id: pluginItemId('mcp', pluginItemKey(install, part)), plugin: install.plugin })) : []);
  const found = home.mcp.items.some(row => isFoundCopilot(row, at.name, home.mcp.library[row.key], managedKeys.has(row.key)));
  return own.length || plugins.length || found ? { own, plugins, out, ...(found ? { found: true as const } : {}) } : undefined;
}
/** Whether a plugin's MCP server in Copilot CLI shares its exact bare name with a live server of his own or a found one there. */
export const copilotSharesYours = (home: PluginHome, at: PluginItemAt): boolean => {
  const shared = copilotShares(home, at);
  return !!shared && (!!shared.found || ownHomeItems(home).some(item => item.on && shared.own.includes(item.id) && !shared.out?.includes(item.id)));
};
/**
 * How a switch meets a copy installed whole: in Claude Code, by its whole plugin wherever its own switch alone can't turn it on;
 * elsewhere the whole plugin off in that tool first (the copy is off, whatever its own switch); then a tool with no switch for one
 * item of its kind; then a switch that can't be written (pluginswitch.ts cantSwitch); else the item's own switch (for a Copilot
 * CLI MCP server, carrying `sharesWith` for the exact-name rule).
 */
function installedWay(home: PluginHome, at: PluginItemAt): Pick<PluginCopy, 'way' | 'sharesWith'> & { why?: string } {
  // Kept off by the plugins record (InstalledPlugin `keptOff`): no profile turns it on, in Claude Code either.
  if (at.install.keptOff) return { way: 'plugin-off', why: pluginOff(at.install.plugin, at.tool) };
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
 * Every plugin's item a tool has now, one per pluginItemKey whichever way each tool has it: installed whole, then placed in Pi,
 * OpenCode or Antigravity, a library item linked to a plugin the home records, in each of those managed tools it isn't kept out of (Off too:
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
 * leaves `item` out: his own server in Central Knot the switch leaves there (`own`), another enabled plugin's server (`plugin`), or an unmanaged
 * personal entry already on there (`found`). Undefined when `profile` names `item` itself or nothing else keeps it on.
 */
export function copilotKeptOnBy(profile: Pick<Profile, 'items' | 'switchesPluginItems' | 'tools' | 'out'>, item: Pick<PluginLive, 'id'>, copy: PluginCopy): CopilotKeptOn | undefined {
  const shared = copy.sharesWith;
  if (!shared || (profile.switchesPluginItems && profile.items.includes(item.id))) return undefined;
  const other = profile.switchesPluginItems ? shared.plugins.find(entry => profile.items.includes(entry.id)) : undefined;
  if (other) return { by: 'plugin', plugin: other.plugin };
  // His own counts where the switch leaves it in Copilot CLI: as the profile keeps it out, else as it is kept out now.
  if (shared.own.some(id => profile.items.includes(id) && !(keptOutBy(profile, id)?.has(copy.tool) ?? shared.out?.includes(id)))) return { by: 'own' };
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
/** The plugin a plugin's item comes from as Claude Code has it installed, could read and may turn (not kept off), if it does: what takenWhole is asked of. */
export const claudeInstall = (item: PluginLive): InstalledPlugin | undefined =>
  item.copies.flatMap(copy => (copy.tool === 'claude-cli' && copy.way !== 'unread' && copy.way !== 'plugin-off' && 'install' in copy.target ? [copy.target.install] : []))[0];
/** Whether a plugin's skill comes on in Claude Code only with a ticked item of its plugin there, the profile leaving it out (takenWhole `brought`). */
export const comesWith = (profile: Pick<Profile, 'items'>, item: PluginLive) => {
  const install = claudeInstall(item);
  return !!install && !profile.items.includes(item.id) && takenWhole(profile, install).brought.some(part => samePart(part, item));
};
/** Each plugin in Claude Code a switch to `profile` turns on or off there whole (takenWhole against its own switch now), whether or not an item of it changes. */
export const wholeTurns = (profile: Pick<Profile, 'items' | 'switchesPluginItems' | 'tools'>, plugins: PluginLive[]) => (!profile.switchesPluginItems || !appliesIn(profile, 'claude-cli') ? []
  : [...new Set(plugins.map(claudeInstall))].filter((install): install is InstalledPlugin => !!install && (takenWhole(profile, install).ticked.length > 0) === !!install.off));

/**
 * What a switch to a profile would do to one plugin's item: the tools it turns on (`on`), those it turns off (`off`), and
 * those it can't (`held`); and where it comes on only with its whole plugin, the profile leaving it out (`along`: Claude Code,
 * takenWhole `brought`), which no count of the items a switch turns takes in. Direction is per tool: a shared Copilot CLI server
 * name can turn on there while turning off in Codex.
 */
export interface PluginTurn { id: string; on: HarnessId[]; off: HarnessId[]; held: { tool: HarnessId; why: string }[]; along?: HarnessId[] }

/**
 * What switching to `profile` would turn of the plugins' items, one item in one tool at a time, in the tools it applies in (appliesIn). When
 * `profile.switchesPluginItems` is false, the only copies in its plan are Copilot CLI MCP copies toward on whose exact name
 * `profile` names among his own servers (never held); otherwise each copy that is not as wanted (on when `profile` names `item`,
 * when `copilotKeptOnBy` keeps that exact Copilot CLI name on, or for a skill in Claude Code when its plugin is on there:
 * takenWhole; off otherwise) is turned where its way is `switch` or `whole` (the whole plugin's: wholeRuns) and held, with why,
 * where it is `plugin-off` or `held`; an `unread` copy is held either way; a copy that `stays` is left. Only items with something
 * turned or held are listed; an id naming nothing any tool has now is dormant.
 */
export function pluginPlan(profile: Pick<Profile, 'items' | 'switchesPluginItems' | 'tools' | 'out'>, items: PluginLive[]): PluginTurn[] {
  if (!profile.switchesPluginItems) {
    return items.flatMap(item => {
      const on = item.copies.filter(copy => copy.way === 'switch' && !copy.on && appliesIn(profile, copy.tool) && copilotKeptOnBy(profile, item, copy)?.by === 'own').map(copy => copy.tool);
      return on.length ? [{ id: item.id, on, off: [], held: [] }] : [];
    });
  }
  return items.flatMap(item => {
    const ticked = profile.items.includes(item.id), brought = comesWith(profile, item);
    const along = (copy: PluginCopy) => brought && copy.way === 'whole';
    const want = (copy: PluginCopy) => ticked || along(copy) || !!copilotKeptOnBy(profile, item, copy);
    const differ = item.copies.filter(copy => appliesIn(profile, copy.tool) && (copy.way === 'unread' || (copy.way !== 'stays' && copy.on !== want(copy))));
    const turned = differ.filter(copy => copy.way === 'switch' || copy.way === 'whole'), tools = (copies: PluginCopy[]) => copies.map(copy => copy.tool);
    const on = tools(turned.filter(copy => want(copy) && !along(copy))), off = tools(turned.filter(copy => !want(copy))), comes = tools(turned.filter(along));
    const held = differ.flatMap(copy => ('why' in copy ? [{ tool: copy.tool, why: copy.why }] : []));
    return on.length || off.length || held.length || comes.length ? [{ id: item.id, on, off, held, ...(comes.length ? { along: comes } : {}) }] : [];
  });
}

/** A plugin Claude Code takes whole, as one run of a switch or its Undo: the copies of it the run turns, and its steps, run together (pluginplan.ts runPlan). */
export interface WholeRun { copies: CopyTurn[]; ops: PluginOp[] }

/**
 * How a switch to a profile that switches plugin items carries out its turns in Claude Code (CopyTurn, from pluginPlan; `live`:
 * pluginLive), one run per plugin there with a step to take: while the profile ticks any item of it (takenWhole), each MCP
 * server's and agent's own switch toward its tick, then the plugin's own on (profiles.ts turnTogether runs the parts' first, and
 * the plugin's only once they all went through, so nothing the profile leaves out loads meanwhile); while it ticks none, the
 * plugin's own off, the parts' switches left as they are. Each step only where Claude Code has it otherwise now.
 */
export function wholeRuns(profile: Pick<Profile, 'items' | 'switchesPluginItems' | 'tools'>, copies: CopyTurn[], live: PluginLive[]): WholeRun[] {
  return !profile.switchesPluginItems || !appliesIn(profile, 'claude-cli') ? [] : [...new Set(live.map(claudeInstall))].flatMap(install => {
    if (!install) return [];
    const { ticked } = takenWhole(profile, install), on = ticked.length > 0, turns = copies.filter(turn => 'install' in turn.copy.target && turn.copy.target.install === install);
    const at = { source: install.source ?? '', marketName: install.marketName, plugin: install.plugin, tool: install.tool };
    const parts = on ? install.items.filter(part => hasOwnSwitch(install.tool, part.kind) && itemOffNow(install, part) === ticked.includes(part)) : [];
    const ops = [...parts.map((part): PluginOp => ({ ...at, part: { kind: part.kind, name: part.name }, action: ticked.includes(part) ? 'part-on' : 'part-off' })),
      ...(on === !!install.off ? [{ ...at, action: on ? 'plugin-on' as const : 'plugin-off' as const }] : [])];
    return ops.length || turns.length ? [{ copies: turns, ops }] : [];
  });
}

/** Whether the plugins' items agree with a profile (their part of "in use"): a switch to it would turn none, hold none, and turn no plugin whole in Claude Code. */
export const pluginItemsAgree = (profile: Pick<Profile, 'items' | 'switchesPluginItems' | 'tools' | 'out'>, items: PluginLive[]) => !pluginPlan(profile, items).length && !wholeTurns(profile, items).length;

/**
 * One copy of a plugin's item to turn in one tool, toward `on`: a switch's (pluginPlan) or its Undo's (pluginUndo), as profiles.ts
 * carries it out; `along`, one that comes on in Claude Code only with its whole plugin (PluginTurn `along`), which no count takes in.
 */
export interface CopyTurn { item: PluginLive; copy: PluginCopy; on: boolean; along?: true }

/** The live library item ids that will be On once an Undo's `turns` run. */
export const onAfterUndo = (live: LiveItem[], turns: Turns) => new Set(live.filter(item => (item.on && !turns.off.includes(item)) || turns.on.includes(item)).map(item => item.id));

/** Whether Claude Code has a plugin as a switch's steps on it left it: on unless they turned it off, each part's own switch as they set it. */
const asLeft = (install: InstalledPlugin, steps: PluginOp[]) => !install.off === !steps.some(op => op.action === 'plugin-off')
  && steps.every(op => !op.part || itemOffNow(install, op.part) === (op.action === 'part-off'));

/**
 * What the Undo of a switch's History entry turns back of the plugins' items (HistoryEvent profile `plugins`), decided from each
 * copy now: each still as the switch left it, still the plugin's and still turned by its own switch there goes back (`back`),
 * unless putting a Copilot CLI rule back would turn off a server of his there now (`afterOn` or found: `keptOff`); each other
 * is left (`left`), with why (`gone`, or changed since). Each plugin in Claude Code the switch's steps turned (the entry's
 * `wholeSteps`) goes back with those steps reversed, one run with its copies (`whole`), while it is as they left it (asLeft).
 */
export function pluginUndo(event: Pick<HistoryEvent, 'profile'>, items: PluginLive[], afterOn?: ReadonlySet<string>): { back: CopyTurn[]; whole: WholeRun[]; left: { copy: PluginSwitched; why: string }[]; keptOff: string[] } {
  const back: CopyTurn[] = [], left: { copy: PluginSwitched; why: string }[] = [], keptOff: string[] = [];
  const afterProfile = { items: [...(afterOn ?? [])], switchesPluginItems: true };
  const installs = items.flatMap(item => item.copies.flatMap(copy => (copy.tool === 'claude-cli' && 'install' in copy.target ? [copy.target.install] : [])));
  const runs = [...groupBy(event.profile?.wholeSteps ?? [], op => `${op.tool}\u0000${op.marketName}\u0000${op.plugin}`).values()].map(steps => {
    const install = installs.find(each => each.tool === steps[0]!.tool && each.plugin === steps[0]!.plugin && each.marketName === steps[0]!.marketName);
    // A plugin the plugins record keeps off there since (InstalledPlugin `keptOff`) is not turned on by the Undo.
    return { steps, install, asLeft: !!install && !install.problem && !install.keptOff && asLeft(install, steps), run: { copies: [] as CopyTurn[], ops: opposites(steps) } };
  });
  for (const done of event.profile?.plugins ?? []) {
    const item = items.find(each => each.id === done.id), copy = item?.copies.find(each => each.tool === done.tool);
    const mine = runs.find(({ steps: [op] }) => op!.tool === done.tool && op!.plugin === item?.plugin && op!.marketName === item.marketName);
    if (mine?.asLeft && item && copy) { back.push({ item, copy, on: !done.on, ...(done.along ? { along: true as const } : {}) }); mine.run.copies.push(back.at(-1)!); continue; }
    if (mine) { left.push({ copy: done, why: mine.install?.problem ? 'its copy couldn’t be read' : 'changed since the switch' }); continue; }
    const kept = done.on && copy?.way === 'switch' && copy.on && copy.tool === 'copilot-cli' && item?.kind === 'mcp' ? copilotKeptOnBy(afterProfile, item, copy) : undefined;
    if (done.on && copy?.gone) left.push({ copy: done, why: 'deleted by hand since' });
    else if (kept?.by === 'own' || kept?.by === 'found') { if (!keptOff.includes(item!.name)) keptOff.push(item!.name); }
    else if (item && copy?.way === 'switch' && copy.on === done.on) back.push({ item, copy, on: !done.on });
    else left.push({ copy: done, why: 'changed since the switch' });
  }
  return { back, whole: runs.filter(each => each.asLeft).map(each => each.run), left, keptOff };
}

/** Whether a plugin's item is on for "Start from what’s on now": on in some tool that switches it; where no tool does, in any tool. */
export function pluginItemOn(item: PluginLive): boolean {
  const switched = item.copies.filter(copy => copy.way === 'switch');
  return (switched.length ? switched : item.copies).some(copy => copy.on);
}

/**
 * The `Off · on in <Tool>` cell tag for an in-use plugin row (`profilespage.ts`) when off in every tool with its own switch for
 * it and on only by another server of its name or with its whole plugin, else `''`.
 */
export function pluginRowState(profile: Pick<Profile, 'items' | 'switchesPluginItems'>, item: PluginLive): '' | `Off · on in ${string}` {
  const switched = item.copies.filter(copy => copy.way === 'switch');
  const own = switched.filter(copy => !copilotKeptOnBy(profile, item, copy));
  if (!switched.length || !own.length || own.some(copy => copy.on)) return '';
  const elsewhere = item.copies.find(copy => copy.on && (copy.way === 'whole' || switched.includes(copy)));
  return elsewhere ? `Off · on in ${toolNames[elsewhere.tool]}` : '';
}

/** What a plugin item's row tooltip says for its live state now (`profilespage.ts`): `on`, `off`, or `on in <Tools>` where any copy is on. */
export function pluginLiveState(item: PluginLive): string {
  const on = item.copies.filter(copy => copy.on);
  return !on.length ? 'off' : on.length === item.copies.length ? 'on' : `on in ${andList(on.map(copy => copy.tool).sort(byToolOrder).map(tool => toolNames[tool]))}`;
}

/** What a library item's row tooltip says for its live state now (`profilespage.ts`). */
export const itemRowState = (item: Pick<LiveItem, 'on' | 'copilotOff'>): 'on' | 'off' | 'off in Copilot CLI' =>
  (!item.on ? 'off' : item.copilotOff ? 'off in Copilot CLI' : 'on');

/**
 * Why a switch to a profile can't turn what it holds (pluginPlan `held`), in the words the page's header (`short`) and card /
 * menus (`text`) share, without a full stop: each plugin off in a tool, with how many of its items that stops, then how many
 * items are held otherwise; '' when nothing is held. `off`: the first plugin off in a tool, for the way to its page.
 */
export function heldWords(plan: PluginTurn[], items: PluginLive[]): { text: string; short: string; off?: { item: PluginLive; copy: PluginCopy } } {
  const off = new Map<string, { item: PluginLive; copy: PluginCopy; ids: Set<string> }>(), other = new Set<string>();
  for (const { id, held } of plan) for (const { tool } of held) {
    const item = items.find(each => each.id === id)!, copy = item.copies.find(each => each.tool === tool)!, key = `${item.plugin}@${item.marketName}\u0000${tool}`;
    if (copy.way !== 'plugin-off') other.add(id); else (off.get(key) ?? off.set(key, { item, copy, ids: new Set() }).get(key)!).ids.add(id);
  }
  const offList = [...off.values()];
  const parts = [...offList.map(({ item, copy, ids }) => `${item.plugin} is off in ${toolNames[copy.tool]}, so ${ids.size} of its items can’t be switched from here`),
    ...(other.size ? [`${plural(other.size, 'item')} can’t be switched in a tool, as ${other.size === 1 ? 'its row says' : 'their rows say'}`] : [])];
  const shortParts = [...offList.map(({ item, copy }) => `${item.plugin} is off in ${toolNames[copy.tool]}`), ...(other.size ? [`${plural(other.size, 'item')} can’t be switched`] : [])];
  return { text: parts.join('; '), short: shortParts.length > 1 ? `${shortParts[0]} and ${shortParts.length - 1} more` : shortParts[0] ?? '', off: offList[0] };
}

/** Plugin items' copies counted as items, one per item, toward `on`: a copy turned in two tools is one item; one that came on only with its whole plugin (`along`) is none. */
const itemsToward = <Copy extends { id: string; on: boolean; along?: true }>(copies: Copy[], on: boolean) => [...new Map(copies.filter(copy => copy.on === on && !copy.along).map(copy => [copy.id, copy])).values()];

/** An item a switch, or its Undo, sets other keep-outs on than it has now: those it sets (`to`). */
export interface ExceptTurn { item: LiveItem; to: HarnessId[] }
/**
 * What a switch, or its Undo, changes: the items it turns On, those it turns Off, and the keep-outs it sets (`except`: a
 * switch's, on each item it turns On or leaves On whose effectiveOut differs from now; an Undo's, those it puts back, on an
 * item it turns Off too).
 */
export interface Turns { on: LiveItem[]; off: LiveItem[]; except: ExceptTurn[] }
/** Of a plan's `except`, the items On before and after: those whose tools alone change, which the counts and rows take in. */
export const toolsChanged = (turns: Turns) => turns.except.filter(turn => !turns.on.includes(turn.item) && !turns.off.includes(turn.item));
/** Whether switching to `profile` clears the Copilot CLI off-switch blocking `item` (LiveItem `copilotOff`): where it leaves the item in Copilot CLI. */
export const clearsCopilotOff = (profile: Pick<Profile, 'tools' | 'out'>, item: LiveItem) => !!item.copilotOff && !effectiveOut(profile, item)?.includes('copilot-cli');
/** Whether a plan changes nothing: no item turned On or Off, and no keep-out set. */
export const unchanged = (turns: Turns) => !changes(turns) && !turns.except.length;

/**
 * What switching to `profile` changes: each item it names that is Off (or blocked by an orphan Copilot CLI off-switch, unless the
 * profile keeps it out of Copilot CLI) turns On, every other On item turns Off, and each item it names is kept out where
 * effectiveOut says, where that differs from now.
 */
export function switchPlan(profile: Pick<Profile, 'items' | 'tools' | 'out'>, live: LiveItem[]): Turns {
  const named = new Set(profile.items), outOf = (item: LiveItem) => (named.has(item.id) ? effectiveOut(profile, item) : undefined);
  return { on: live.filter(item => named.has(item.id) && (!item.on || clearsCopilotOff(profile, item))), off: live.filter(item => !named.has(item.id) && item.on),
    except: live.flatMap(item => { const to = outOf(item); return to && !sameTools(to, item.except) ? [{ item, to }] : []; }) };
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
 * The profiles in use: each one switching to which would change nothing and hold nothing, of its library items (switchPlan, their
 * keep-outs too for a profile that holds them: effectiveOut) and
 * of the plugins' items (`plugins`: pluginLive; pluginItemsAgree). A copy that `stays` (a plugin's agent in Copilot CLI) is left
 * out of that, so two profiles that differ only by such an item are both in use. In Claude Code a plugin is on or off whole
 * (takenWhole): a profile that ticks one of its skills stops being in use when the plugin is turned off there by hand, and is in
 * use again once it is back on; two that tick different skills of it are both in use while it is on, as long as neither leaves out
 * an MCP server or agent of it that is on there by its own switch.
 */
export const inUse = (profiles: Profile[], live: LiveItem[], plugins: PluginLive[]) =>
  profiles.filter(profile => unchanged(switchPlan(profile, live)) && pluginItemsAgree(profile, plugins));

/**
 * The profile last switched to (types.ts ProfilesView `last`), by id: the newest profile entry of `events` (History, newest last)
 * that is not an Undo's own (`undoOf`) and was not undone (`undoneBy`), naming its profile by `toId`, else, written before
 * switches kept it, by `toName`; undefined where that profile is gone or History holds none (its days, or unreadable: []). Never
 * stored: an Undo of a switch marks it undone, so the switch before it is last again.
 */
export function lastSwitched(events: readonly HistoryEvent[], profiles: readonly Profile[]): string | undefined {
  const entry = events.findLast(event => event.kind === 'profile' && !!event.profile && !event.profile.undoOf && !event.undoneBy)?.profile;
  if (!entry) return undefined;
  return (entry.toId ? profiles.find(profile => profile.id === entry.toId) : profiles.find(profile => profile.name === entry.toName))?.id;
}

/**
 * The profiles now, as profileNow gives them: those in use, else the one last switched to (`changed`, with whether it can be
 * switched to now: `canSwitchBack`, the menus' and the page's rule, switchable), and the name every place says.
 */
export interface ProfileNow { inUse: Profile[]; changed?: Profile; canSwitchBack?: boolean; name: string }
/**
 * The profiles now, the one rule every place that names the profile in use asks (the status bar and its menu, the menu bar's
 * Profile menu, the tray's tooltip and title, the Profiles list, picker, title and the profile it opens, Harnesses' line, an
 * act's result and the Library's forecast of it): those in use, by name ("Development and Incident"); else, while none is, the
 * one last switched to (`changed`: ProfilesView `last`, from History: lastSwitched), named `Everyday · changed` (words.ts
 * changedName); else No profile.
 */
export function profileNow(view: Pick<ProfilesView, 'profiles' | 'last'>, live: LiveItem[], plugins: PluginLive[]): ProfileNow {
  const now = inUse(view.profiles, live, plugins), changed = now.length ? undefined : view.profiles.find(profile => profile.id === view.last);
  const name = now.length ? andList(now.map(profile => profile.name)) : changed ? changedName(changed.name) : NO_PROFILE;
  return { inUse: now, ...(changed ? { changed, canSwitchBack: switchable(changed, live, plugins) } : {}), name };
}
/** One profile's name where profiles are listed (both menus, the picker): `Everyday · changed` for profileNow's `changed`. */
export const nameNow = (now: ProfileNow, profile: Profile) => (profile.id === now.changed?.id ? changedName(profile.name) : profile.name);
/** What leads profileNow's name where a sentence says it (the status bar's hover, Harnesses' line): "Profile in use", or for `Everyday · changed` "Profile". */
export const nowLead = (now: ProfileNow) => (now.changed ? 'Profile' : 'Profile in use');

/** profileNow in `home` (its `inUse`: the profiles in use there), from its live and plugin items as the status bar works them out. */
export function profileNowIn(home: PluginHome): ProfileNow {
  if (!home.profiles?.profiles?.length) return { inUse: [], name: NO_PROFILE };
  const plugins = pluginLive(home);
  return profileNow(home.profiles, homeItems(home, plugins), plugins);
}

/** One item's change in a Library click, as libraryrow.ts rowClicks makes it (types.ts Change), with the item's kind. */
export interface ItemChange { kind: ItemKind; change: Pick<Change, 'key' | 'on' | 'deleted' | 'except'> }
/**
 * The live and plugins' items as a click's changes would leave them, each item by its last change (nothing is written): a deleted
 * item goes; a live one takes its change's `on` and `except`, and so does a copy placed from it (pluginLive `libraryKey`); one the library doesn't
 * hold, or holds deleted, comes in On when turned on (Add); a server of his deleted or kept out of Copilot CLI no longer shares its name there (`sharesWith.own`).
 */
function projected(home: PluginHome, live: LiveItem[], plugins: PluginLive[], changes: readonly ItemChange[]) {
  const last = new Map(changes.map(each => [itemId(each.kind, each.change.key), each])), to = (id: string) => last.get(id)?.change;
  const after = live.flatMap(item => (to(item.id)?.deleted ? [] : to(item.id) ? [{ ...item, on: to(item.id)!.on, except: to(item.id)!.except }] : [item]));
  for (const [id, { kind, change: { key, on } }] of last) {
    const held = home[pageOfPart[kind]].library[key];
    if (on && !live.some(item => item.id === id) && (!held || held.deleted)) after.push({ id, kind, key, name: key, on, except: [] });
  }
  const left = (id: string) => !!to(id)?.deleted || !!to(id)?.except.includes('copilot-cli');
  return { live: after, plugins: plugins.map(item => ({ ...item, copies: item.copies.flatMap((copy): PluginCopy[] => {
    const own = 'libraryKey' in copy.target ? to(itemId(item.kind, copy.target.libraryKey)) : undefined;
    const sharesWith = copy.sharesWith && { ...copy.sharesWith, own: copy.sharesWith.own.filter(id => !left(id)) };
    return own?.deleted ? [] : [{ ...copy, on: own ? own.on : copy.on, ...(sharesWith ? { sharesWith } : {}) }];
  }) })) };
}
/**
 * What a Library click's `changes` would do to the profiles, from one projection of them (a click never changes which was last
 * switched to): the profiles in use it would end (`ended`, by the rule its result says after it: endedProfiles), and the one
 * every place would then name `<Profile> · changed` (`changed`: profileNow), if one. matrix.ts endsOf says both before the click.
 */
export function endedByChanges(home: PluginHome, changes: readonly ItemChange[]): { ended: Profile[]; changed?: Profile } {
  if (!home.profiles?.profiles?.length) return { ended: [] };
  const plugins = pluginLive(home), live = homeItems(home, plugins), after = projected(home, live, plugins, changes);
  const now = profileNow(home.profiles, after.live, after.plugins), ended = endedProfiles(inUse(home.profiles.profiles, live, plugins), now.inUse);
  return now.changed ? { ended, changed: now.changed } : { ended };
}

/** Every profile in `before` when none of its ids still matches in `after` (even if another now matches), else empty. */
export function endedProfiles(before: readonly Profile[], after: readonly Profile[]): Profile[] {
  if (!before.length) return [];
  const still = new Set(after.map(profile => profile.id));
  return before.some(profile => still.has(profile.id)) ? [] : [...before];
}

/**
 * A switch's items in three lists, each item once per direction: the library items it turns On and Off (switchPlan) and the
 * plugins' items some tool turns on or off (pluginPlan `on` and `off`), and the library items whose tools alone change, each
 * with its keep-outs before and after (`retooled`: toolsChanged). What the page's Switch offers and changeWords counts.
 */
export const allTurns = (turns: Turns, plugins: PluginTurn[]) => ({ on: [...turns.on, ...plugins.filter(item => item.on.length)],
  off: [...turns.off, ...plugins.filter(item => item.off.length)], retooled: retools(toolsChanged(turns)) });
/** Keep-outs a plan sets (Turns `except`), as History and a result keep them: each item's before and after. */
export const retools = (list: ExceptTurn[]): ExceptSwitched[] => list.map(({ item, to }) => ({ id: item.id, name: item.name, wasExcept: [...item.except], nowExcept: [...to] }));

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
/** What the Undo of a switch's entry left loading, read from the view after it (`home`): each item it turned on that is Off now and that a tool still loads, by name, where and how. */
export const leftLoadingAfter = (entry: NonNullable<HistoryEvent['profile']>, home: PluginHome) => homeItems(home).filter(item => !item.on && !!entry.on?.some(each => each.id === item.id))
  .flatMap(item => { const kept = keptOn(item); return kept.tools.length ? [`${item.name} in ${andList(kept.tools.map(tool => toolNames[tool]))}, still loading ${loadWords([kept])}`] : []; });
/** The plugins' items a switch's entry turned, each with the tools it turned on and off there (as pluginPlan's turns). */
const entryPlugs = (entry: NonNullable<HistoryEvent['profile']>) => [...new Set((entry.plugins ?? []).map(copy => copy.id))]
  .map(id => { const copies = entry.plugins!.filter(copy => copy.id === id); return { id, on: copies.filter(copy => copy.on).map(copy => copy.tool), off: copies.filter(copy => !copy.on).map(copy => copy.tool) }; });

/**
 * What the Undo of a switch's History entry turns back, decided from each item now: each item it turned On that is still On
 * goes Off, each it turned Off that is still Off goes On, and each whose keep-outs it changed (`except`) that is still kept out
 * exactly so gets its keep-outs before back, On or Off as it is now. An item whose On or Off, or keep-outs, differ now, or one no
 * longer in the library, is left (one turned back and forth since, and now as the switch left it, is turned back like any other).
 */
export function undoPlan(event: Pick<HistoryEvent, 'profile'>, live: LiveItem[]): Turns {
  const kept = event.profile?.except ?? [], toolsAsLeft = (item: LiveItem) => kept.every(each => each.id !== item.id || sameTools(item.except, each.nowExcept));
  const still = (named: { id: string }[] | undefined, on: boolean) => live.filter(item => item.on === on && !!named?.some(entry => entry.id === item.id) && toolsAsLeft(item));
  const except = kept.flatMap(({ id, wasExcept }) => {
    const item = live.find(each => each.id === id);
    return item && toolsAsLeft(item) ? [{ item, to: [...wasExcept] }] : [];
  });
  return { on: still(event.profile?.off, false), off: still(event.profile?.on, true), except };
}

/** What a switch's entry says it did, each item once: its library items, its orphan Copilot CLI clears, and its plugins' items; and the items whose tools alone it changed. */
export function entryTurns(was: NonNullable<HistoryEvent['profile']>) {
  const add = (base: { id: string }[] | undefined, extra: { id: string }[]) => [...(base ?? []), ...extra.filter(item => !base?.some(other => other.id === item.id))];
  const turned = (each: { id: string }) => [...was.on ?? [], ...was.off ?? []].some(item => item.id === each.id);
  return { on: [...add(was.on, was.undoOf ? [] : was.copilotCleared ?? []), ...itemsToward(was.plugins ?? [], true)],
    off: [...add(was.off, was.undoOf ? was.copilotCleared ?? [] : []), ...itemsToward(was.plugins ?? [], false)], retooled: (was.except ?? []).filter(each => !turned(each)) };
}

/** What the Undo of a switch's entry will turn back, each item once: its library items (undoPlan, those whose keep-outs alone go back as `retooled`), uncovered Copilot CLI rules (`copilotUndo`) and plugins' items (pluginUndo). */
export function undoTurns(event: Pick<HistoryEvent, 'profile'>, live: LiveItem[], plugins: PluginLive[], mcp: Pick<HomeView['mcp'], 'items' | 'library'> = { items: [], library: {} }) {
  const library = undoPlan(event, live), afterOn = onAfterUndo(live, library), back = pluginUndo(event, plugins, afterOn).back.map(turn => ({ id: turn.item.id, on: turn.on, ...(turn.along ? { along: turn.along } : {}) }));
  const rules = copilotUndo(event, mcp.items, mcp.library, afterOn).back.filter(rule => !library.off.some(item => item.id === rule.id));
  return { on: [...library.on, ...itemsToward(back, true)], off: [...library.off, ...rules, ...itemsToward(back, false)], retooled: retools(toolsChanged(library)) };
}

/** What undoing a profile entry turns back in `home` as the page read it: its live items, plugins' items and MCP servers from that one read. */
export function undoInHome(event: Pick<HistoryEvent, 'profile'>, home: PluginHome) {
  const plugins = pluginLive(home);
  return undoTurns(event, homeItems(home, plugins), plugins, home.mcp);
}

/** What undoing a profile entry would turn back in `home`, in words (changeWords): its items, and the plugins it turns back whole in Claude Code; '' for nothing. */
export const undoWords = (event: Pick<HistoryEvent, 'profile'>, home: PluginHome) =>
  changeWords(undoInHome(event, home), wholeCounts({ steps: pluginUndo(event, pluginLive(home)).whole.flatMap(run => run.ops) }), 'will');

/** Whether Undo is offered for a profile entry in `home`: only while it would turn something back (undoWords; shared by the header and History). */
export const undoOffered = (event: Pick<HistoryEvent, 'profile'>, home: PluginHome): boolean => !!undoWords(event, home);

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

/** The plugins' items a profile lists on the page, in display order: none while `switchesPluginItems` is false. */
export const listedPlugins = (profile: Pick<Profile, 'switchesPluginItems'>, plugins: PluginLive[]): PluginLive[] =>
  (profile.switchesPluginItems ? [...plugins].sort((first, second) => first.name.localeCompare(second.name) || first.plugin.localeCompare(second.plugin)) : []);

/** One listed row's change on switch: its id and its state-cell words, and where those count tools, the words naming each (`full`, the cell's hover). */
export interface RowChange { id: string; said: string; full?: string }

/**
 * Each listed row a switch changes, once, in `on` then `off` then `retooled` (`on` before `off`; skills coming on with a plugin
 * in Claude Code turn on; plugin rows follow `listedPlugins`; `retooled`, his items it leaves On kept out elsewhere:
 * toolsChanged) with its cell words (`said`; one of his turning On kept out of a managed tool, by the profile or the Library, says where it won't be). The one rule
 * read by `switchPreview`'s short line, `Changes N`, its headings and every row's state cell.
 */
export function listedChanges(profile: Pick<Profile, 'items' | 'switchesPluginItems' | 'tools' | 'out'>, live: LiveItem[], plugins: PluginLive[],
  turns = switchPlan(profile, live), plugs = pluginPlan(profile, plugins)) {
  const words = (lead: string, was: HarnessId[], now: HarnessId[]) => {
    const said = keptOutWords(was, now, lead, true), full = keptOutWords(was, now, lead);
    return { said, ...(full !== said ? { full } : {}) };
  };
  const on: RowChange[] = turns.on.map(item => {
    const notIn = (effectiveOut(profile, item) ?? item.except).filter(tool => !item.managed || item.managed.includes(tool));
    return { id: item.id, ...(notIn.length ? words('Turns on, not in', [], notIn) : { said: 'Turns on' }) };
  });
  const off: RowChange[] = turns.off.map(item => ({ id: item.id, said: 'Turns off' }));
  const retooled: RowChange[] = toolsChanged(turns).map(({ item, to }) => ({ id: item.id, ...words('Out of', item.except, to) }));
  for (const item of listedPlugins(profile, plugins)) {
    const turn = plugs.find(each => each.id === item.id);
    const up = [...turn?.on ?? [], ...turn?.along ?? []], down = turn?.off ?? [];
    if (!up.length && !down.length) continue;
    const part = (dir: 'on' | 'off', list: HarnessId[]) => `turns ${dir}${list.length < item.copies.length ? ` in ${andList(list.map(tool => toolNames[tool]))}` : ''}`;
    const text = [up.length && part('on', up), down.length && part('off', down)].filter(Boolean).join('; ');
    (up.length ? on : off).push({ id: item.id, said: `${text.charAt(0).toUpperCase()}${text.slice(1)}` });
  }
  return { on, off, retooled, byId: new Map([...on, ...off, ...retooled].map(change => [change.id, change])) };
}

/** What the Profiles page's header (`line`, with `tip` in its `(?)` only when `card` says more than its plain form) and both profile menus (`card`) say for `profile`. */
export interface PreviewWords { line: string; card: string; tip?: string }

/**
 * What the Profiles page's header (`line`, with `tip` in its `(?)` when `card` says more than its plain form) and both profile
 * menus (`card`, unchanged for native menus) say for `profile`, from the same rules (`listedChanges`, `switchPlan`, `pluginPlan`,
 * `inUse`): whether it is in use, empty, what switching turns on and off, or why it can't switch.
 */
export function switchPreview(profile: Profile, live: LiveItem[], plugins: PluginLive[]): PreviewWords {
  const turns = switchPlan(profile, live), plugs = pluginPlan(profile, plugins), counted = allTurns(turns, plugs), whole = wholeTurns(profile, plugins);
  const keep = profile.switchesPluginItems ? '' : `. ${pluginStayNote(plugs, plugins)}`;
  const count = namedCount(profile, live, plugins);
  const pack = (line: string, card: string, plain = line): PreviewWords => (card !== plain ? { line, card, tip: card } : { line, card });
  if (unchanged(turns) && !plugs.length && !whole.length) {
    // In Claude Code a skill left out is on while its plugin is (comesWith): counted apart, not among those off.
    const brought = plugins.filter(item => comesWith(profile, item)), others = live.length + (profile.switchesPluginItems ? plugins.length : 0) - count - brought.length;
    const one = new Set(brought.map(item => `${item.plugin}@${item.marketName}`)).size === 1;
    const more = brought.length ? `, ${brought.length} more on in Claude Code with ${brought.length === 1 ? 'its' : 'their'} plugin${one ? '' : 's'}` : '';
    const rest = !others ? '' : profile.switchesPluginItems ? `, the other ${others} off wherever they can be switched` : `, the other ${others} of yours off`;
    const parts = [`${count} on`, brought.length ? `${brought.length} with ${one ? 'plugin' : 'plugins'}` : '', others ? `${others} off` : ''].filter(Boolean);
    return pack(`In use · ${parts.join(', ')}`, `In use · ${plural(count, 'item')} on${more}${rest}${keep}`, `In use · ${plural(count, 'item')} on${rest}`);
  }
  if (!count) return pack('0 items', `0 items${keep}`);
  const kept = stillLoadWords(turns.off.map(item => keptOn(item, plugs)), plugs.filter(turn => turn.off.length).map(turn => keptOn(plugins.find(item => item.id === turn.id)!, plugs)));
  const wholeCount = wholeCounts({ installs: whole });
  const said = changeWords(counted, wholeCount, 'will', kept);
  if (!said) { const held = heldWords(plugs, plugins); return pack(`Can’t switch · ${held.short}`, `Not in use · ${held.text}`); }
  const listed = listedChanges(profile, live, plugins, turns, plugs);
  const listedParts = [listed.on.length && `${listed.on.length} on`, listed.off.length && `${listed.off.length} off`].filter(Boolean);
  const onlyWhole = [wholeCount.on && `${plural(wholeCount.on, 'plugin')} on`, wholeCount.off && `${plural(wholeCount.off, 'plugin')} off`].filter(Boolean);
  const unlisted = [counted.on.length && `${plural(counted.on.length, 'plugin item')} on`, counted.off.length && `${plural(counted.off.length, 'plugin item')} off`].filter(Boolean);
  const turned = listedParts.length ? listedParts : onlyWhole.length ? onlyWhole : unlisted;
  const line = [turned.length ? `Switching turns ${turned.join(', ')}` : 'Switching', retoolWords(counted.retooled, 'line')].filter(Boolean).join(' · ');
  return pack(line, `Switching ${said}${keep}`, `Switching ${changeWords({ ...listed, retooled: counted.retooled }, { on: 0, off: 0 }, 'will')}`);
}

/** How many plugins a switch turns on and off whole in Claude Code: before it, those wholeTurns finds (`installs`); after it, its entry's `wholeSteps` (`steps`). */
export const wholeCounts = ({ installs = [], steps = [] }: { installs?: InstalledPlugin[]; steps?: Pick<PluginOp, 'action'>[] }) => ({
  on: installs.filter(install => install.off).length + steps.filter(op => op.action === 'plugin-on').length,
  off: installs.filter(install => !install.off).length + steps.filter(op => op.action === 'plugin-off').length });

/** What the save that moves profiles to holding their keep-outs says of the others it filled in (profiles.ts saveProfile `filled`). */
export const filledWords = (names: string[]) => `Saved. Nothing in your tools changed. Switching back to ${names.length > 2 ? 'your other profiles' : orList(names)} still puts each item where it is now.`;

/** A keep-out change, before and after (an ExceptSwitched's, as retools makes it). */
type Retool = Pick<ExceptSwitched, 'wasExcept' | 'nowExcept'>;
/**
 * How many items' tools alone a switch changes, in words: where each only leaves the same one or two tools, those tools in the
 * rows' words ("4 items out of Codex", after: "4 items now out of Codex"), else counted ("4 items change tools"); '' for none.
 * `line`: the header's short form, without "items".
 */
export function retoolWords(list: readonly Retool[], tense: 'will' | 'did' | 'line'): string {
  if (!list.length) return '';
  const gone = (each: Retool) => each.nowExcept.filter(tool => !each.wasExcept.includes(tool)), [first] = list;
  const only = list.every(each => sameTools(gone(each), gone(first!)) && each.wasExcept.every(tool => each.nowExcept.includes(tool))) && gone(first!).length <= 2;
  const count = tense === 'line' ? String(list.length) : plural(list.length, 'item'), where = andList(gone(first!).sort(byToolOrder).map(tool => toolNames[tool]));
  if (only && where) return `${count} ${tense === 'did' ? 'now ' : ''}out of ${where}`;
  return `${count} ${tense === 'did' ? 'changed' : list.length === 1 ? 'changes' : 'change'} tools`;
}

/**
 * What a switch or its Undo does or did, in words: its items' counts (turnsWords, then `kept`: how many of them still load), then
 * how many items' tools alone change, and where (retoolWords), then a sentence for each direction it turns
 * plugins whole in Claude Code ("Turns 1 plugin off in Claude Code", "1 plugin turned off in Claude Code"); '' for nothing. The one
 * answer to "does it change anything?" that the preview, the Switch button and its title, the result, History's line and its
 * Undo's all ask.
 */
export function changeWords(items: { on: unknown[]; off: unknown[]; retooled?: readonly Retool[] }, plugins: { on: number; off: number }, tense: 'will' | 'did', kept = ''): string {
  const whole = (['on', 'off'] as const).filter(way => plugins[way])
    .map(way => `${tense === 'will' ? `turns ${plural(plugins[way], 'plugin')} ${way}` : `${plural(plugins[way], 'plugin')} turned ${way}`} in Claude Code`);
  const said = [changes(items) ? `${turnsWords(items, tense)}${kept}` : '', retoolWords(items.retooled ?? [], tense), ...whole].filter(Boolean);
  return said.map((sentence, at) => (at ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence)).join('. ');
}

/**
 * What a switch's result adds for each plugin whose whole switch in Claude Code its steps turned (HistoryEvent profile
 * `wholeSteps`), in the Library's words (pluginswitch.ts itemSaid) where an item it asked for came or went with it, read from the
 * view after it (`home`): " a is on in Claude Code. Its whole plugin docs was turned on there, with its 2 other skills."; else
 * " The whole plugin docs was turned off in Claude Code."; '' for none.
 */
export function wholeSaid(entry: NonNullable<HistoryEvent['profile']>, home: PluginHome): string {
  const steps = entry.wholeSteps ?? [];
  return steps.filter(op => isWhole(op.action)).flatMap(op => {
    const on = op.action === 'plugin-on', install = home.pluginItems?.find(each => each.tool === op.tool && each.plugin === op.plugin && each.marketName === op.marketName);
    const part = install?.items.find(each => entry.plugins?.some(copy => !copy.along && copy.tool === op.tool && copy.on === on && copy.id === pluginItemId(each.kind, pluginItemKey(install, each))));
    if (!install) return [];
    return [` ${part ? itemSaid({ kind: part.kind, name: part.name, tool: op.tool, install }, on, steps) : `The whole plugin ${op.plugin} was turned ${on ? 'on' : 'off'} in Claude Code.`}`];
  }).join('');
}
