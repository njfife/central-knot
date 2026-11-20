// Profiles' rules, pure (no files, no DOM). A profile names library items (library.ts) of the three kinds, as `skill:<key>`,
// `agent:<key>` and `mcp:<key>`. Switching to it turns each item it names On and every other library item Off (switchPlan);
// a profile is in use exactly while that would change nothing, so which one is in use is worked out, never stored (inUse);
// and a switch's Undo turns back each item still as the switch left it (undoPlan). An id that names no live library item
// (one only found in a tool, one a plugin brings, one deleted) is skipped by all three and stays in the profile; so is an item
// linked to a plugin the home records (library.ts A PLUGIN), which follows its plugin's switch alone (liveItems). What the
// Library lists that no profile can tick, a plugin's items and items only found in a tool, is counted for the page (leftOut).
// Read by profiles.ts (which carries a switch out), profilemigrate.ts, the Profiles page, History's page and the menus
// (main.ts), so each says the same. The profiles file and the switch itself are profiles.ts's.
// A PLUGIN'S ITEMS, the rules a profile is to switch them by, read by nothing but their tests yet: each item every tool has now
// with how a switch meets each copy (pluginLive), what a switch to a profile would turn of them, tool by tool (pluginPlan), and
// whether they agree with a profile (pluginItemsAgree). A profile names one as `skill:<plugin@marketplace/item>` (pluginrows.ts
// pluginItemKey), never as the person's own item of that name.
import { itemKey, type ItemKind, type LibraryItem } from './library.ts';
import { placeOf } from './libraryrow.ts';
import { plural } from './model.ts';
import { pageRows, pluginItemKey } from './pluginrows.ts';
import { pageOfPart } from './pluginstatus.ts';
import { cantSwitch, onNow, ownSwitch, type PluginItemAt } from './pluginswitch.ts';
import { takesPlugins } from './presence.ts';
import { andList, kindNouns, toolNames } from './words.ts';
import type { HarnessId, HistoryEvent, HomeView, Profile } from './types.ts';

/** What every screen calls the state where no profile is in use. */
export const NO_PROFILE = 'No profile';

/** A profile's name for a library item: its kind and key, `skill:notes`. */
export const itemId = (kind: ItemKind, key: string) => `${kind}:${key}`;

/** A live library item (not deleted) as profiles see it. `except`: the tools it is kept out of, which a switch keeps. */
export interface LiveItem { id: string; kind: ItemKind; key: string; name: string; on: boolean; except: LibraryItem['except'] }

/** Each kind's items as the library holds them, deleted ones too (types.ts LibraryView `library`, or a kind's record). */
export type Libraries = Record<ItemKind, Record<string, LibraryItem>>;

const KINDS = ['skill', 'mcp', 'agent'] as const;
/** Whether a library item is linked to a plugin the home records (`plugins`: their ids), so it follows that plugin's switch. */
const linkedToPlugin = (item: LibraryItem, plugins: ReadonlySet<string>) => !!item.source && plugins.has(item.source);

/**
 * Every live library item that profiles act on, skills first, then MCP servers, then agents: all but those linked to a plugin
 * (`plugins`: the ids of the plugins the home records), which a switch never turns On or Off and no profile counts.
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

/** Of one kind, how many of the Library's rows no profile lists, by why. */
export interface LeftOut { plugin: number; found: number }

/**
 * What the Library lists that no profile can tick, by kind: a plugin's items (`plugin`: those it brings into a tool it is
 * installed in, rows of their own, pluginrows.ts pageRows; and those linked to it, which liveItems skips), and items found in a
 * tool, not in Central Knot yet (`found`: libraryrow.ts placeOf). A deleted item is in neither list.
 */
export function leftOut(home: HomeView): Record<ItemKind, LeftOut> {
  const plugins = recordedPlugins(home), count = (kind: ItemKind) => {
    const page = pageOfPart[kind], { items, library } = home[page];
    return { plugin: pageRows(home, page).rows.length + Object.values(library).filter(item => !item.deleted && linkedToPlugin(item, plugins)).length,
      found: items.filter(row => placeOf(library[row.key]) === 'found').length };
  };
  return { skill: count('skill'), mcp: count('mcp'), agent: count('agent') };
}

/**
 * The Profiles page's line on what its list leaves out, with leftOut's counts: what is found and where the Library shows it
 * (its Found heading, whose rows have Add, turned off on a row that can't be taken in: matrix.ts addButton), then how many of a
 * plugin's items are not listed, in a clause of its own; '' when it leaves nothing out.
 */
export function leftOutWords(counts: Record<ItemKind, LeftOut>): string {
  const counted = (why: keyof LeftOut) => andList(KINDS.filter(kind => counts[kind][why]).map(kind => {
    const nouns = kindNouns[pageOfPart[kind]];
    return plural(counts[kind][why], nouns.one, nouns.many);
  }));
  const one = (why: keyof LeftOut) => KINDS.reduce((sum, kind) => sum + counts[kind][why], 0) === 1;
  const parts = [counted('found') && `${counted('found')} found in your tools that ${one('found') ? 'isn’t' : 'aren’t'} in Central Knot yet `
    + `(under Found in the Library, with Add ${one('found') ? 'if it' : 'on each that'} can be taken in)`,
    counted('plugin') && `${counted('plugin')} from ${one('plugin') ? 'a plugin' : 'plugins'}, which a profile doesn’t switch yet`].filter(Boolean);
  return parts.length ? `Not listed here: ${parts.join('; ')}.` : '';
}

// ---------- A plugin's items ----------

/**
 * One tool's copy of a plugin's item as a switch to a profile meets it. `on`: on there now (pluginswitch.ts onNow; in Pi and
 * OpenCode its library item's On). `way`: `switch`, the item's own switch there (pluginswitch.ts ownSwitch; in Pi and OpenCode its
 * library item's On and Off); `stays`, the tool has none for one item of its kind (a skill in Claude Code, an agent in Copilot
 * CLI), so the copy is left as its plugin has it and agrees with any profile; `held`, its switch can't be used now, and `why`.
 */
export type PluginCopy = { tool: HarnessId; on: boolean } & ({ way: 'switch' | 'stays' } | { way: 'held'; why: string });

/** A plugin's item some tool has now: its id in a profile, the plugin's name, and each tool's copy. */
export interface PluginLive { id: string; kind: ItemKind; name: string; plugin: string; copies: PluginCopy[] }

/**
 * Why a copy installed whole can't be switched now, if it can't: the whole plugin is off in that tool (so the copy is off); its
 * switch can't be written (pluginswitch.ts cantSwitch); or Copilot CLI, which turns a server off by its bare name
 * (partswitch.ts), has one of the person's own of that name (the Library's row, by its key) that would go with it.
 */
function heldWhy(home: HomeView, at: PluginItemAt): string | undefined {
  if (at.install.off) return `The whole plugin ${at.install.plugin} is off in ${toolNames[at.tool]}.`;
  const named = at.tool === 'copilot-cli' && at.kind === 'mcp' && home.mcp.items.some(row => row.key === itemKey(at.name) && row.copies['copilot-cli']);
  return cantSwitch(at) ?? (named ? `Copilot CLI turns a server off by its name, and a server of your own there is named “${at.name}” too.` : undefined);
}

/**
 * Every plugin's item a tool has now, one per pluginItemKey whichever way each tool has it: installed whole (a copy that can't be
 * read has none), then placed in Pi or OpenCode, a library item linked to a plugin the home records, in each of those managed
 * tools it isn't kept out of (Off too: its On brings it back there).
 */
export function pluginLive(home: HomeView): PluginLive[] {
  const found = new Map<string, PluginLive>();
  const add = (kind: ItemKind, key: string, name: string, plugin: string, copy: PluginCopy) => {
    const id = itemId(kind, key);
    if (!found.has(id)) found.set(id, { id, kind, name, plugin, copies: [] });
    found.get(id)!.copies.push(copy);
  };
  for (const install of home.pluginItems ?? []) for (const item of install.items) {
    const at = { kind: item.kind, name: item.name, tool: install.tool, install }, why = heldWhy(home, at);
    const way = !ownSwitch(at) ? { way: 'stays' as const } : why ? { way: 'held' as const, why } : { way: 'switch' as const };
    add(item.kind, pluginItemKey(install, item), item.name, install.plugin, { tool: install.tool, on: onNow(at), ...way });
  }
  for (const kind of KINDS) {
    const { tools, library } = home[pageOfPart[kind]];
    for (const item of Object.values(library)) {
      const entry = !item.deleted && home.profiles.plugins?.find(each => each.id === item.source);
      if (!entry) continue;
      const key = pluginItemKey(entry, { kind, name: item.name });
      for (const tool of tools.filter(each => !takesPlugins(each) && !item.except.includes(each))) add(kind, key, item.name, entry.plugin, { tool, on: item.on, way: 'switch' });
    }
  }
  return [...found.values()];
}

/** What a switch to a profile would do to one plugin's item: toward `on` (the profile has it), the tools it turns (`turn`), and those it can't (`held`). */
export interface PluginTurn { id: string; on: boolean; turn: HarnessId[]; held: { tool: HarnessId; why: string }[] }

/**
 * What switching to `profile` would turn of the plugins' items, one item in one tool at a time, never a whole plugin: each copy
 * that is not as the profile has the item (on for one it has, off for one it leaves out) is turned where its way is `switch` and
 * held where it is `held`; a copy that `stays` is left. Only items with something turned or held are listed; an id the profile
 * names that no tool has now is in none (dormant, as a deleted item's is).
 */
export function pluginPlan(profile: Pick<Profile, 'items'>, items: PluginLive[]): PluginTurn[] {
  return items.flatMap(item => {
    const on = profile.items.includes(item.id), differ = item.copies.filter(copy => copy.on !== on);
    const turn = differ.filter(copy => copy.way === 'switch').map(copy => copy.tool);
    const held = differ.flatMap(copy => (copy.way === 'held' ? [{ tool: copy.tool, why: copy.why }] : []));
    return turn.length || held.length ? [{ id: item.id, on, turn, held }] : [];
  });
}

/** Whether the plugins' items agree with a profile (their part of "in use"): a switch to it would turn none, and hold none. */
export const pluginItemsAgree = (profile: Pick<Profile, 'items'>, items: PluginLive[]) => !pluginPlan(profile, items).length;

/** What a switch, or its Undo, changes: the items it turns On, and those it turns Off. */
export interface Turns { on: LiveItem[]; off: LiveItem[] }

/** What switching to `profile` changes: each item it names that is Off turns On, and every other item that is On turns Off. */
export function switchPlan(profile: Pick<Profile, 'items'>, live: LiveItem[]): Turns {
  const named = new Set(profile.items);
  return { on: live.filter(item => named.has(item.id) && !item.on), off: live.filter(item => !named.has(item.id) && item.on) };
}

/** The live items a profile names: what it has. */
export const namedItems = (profile: Pick<Profile, 'items'>, live: LiveItem[]) => live.filter(item => profile.items.includes(item.id));

/**
 * Whether a profile is offered to switch to (the page's Switch, the status bar's and the menu bar's menus): one with nothing in
 * it would turn every item off, so it is offered once it has an item.
 */
export const switchable = (profile: Pick<Profile, 'items'>, live: LiveItem[]) => namedItems(profile, live).length > 0;

/** The profiles in use: each one switching to which would change nothing. Two that name the same items are both in use. */
export const inUse = (profiles: Profile[], live: LiveItem[]) => profiles.filter(profile => !changes(switchPlan(profile, live)));

/** The names of the profiles in use, as the menus and the status bar say them ("Development and Incident"), or No profile. */
export function inUseName(profiles: Profile[], live: LiveItem[]): string {
  const names = inUse(profiles, live).map(profile => profile.name);
  return names.length ? andList(names) : NO_PROFILE;
}

/** How many items a plan turns On and Off together. */
export const changes = (turns: Turns) => turns.on.length + turns.off.length;

/**
 * What the Undo of a switch's History entry turns back, decided from each item now: each item it turned On that is still On
 * goes Off, each it turned Off that is still Off goes On. An item whose On or Off differs now, or one no longer in the library,
 * is left (one turned back and forth since, and now as the switch left it, is turned back like any other).
 */
export function undoPlan(event: Pick<HistoryEvent, 'profile'>, live: LiveItem[]): Turns {
  const still = (named: { id: string }[] | undefined, on: boolean) => live.filter(item => item.on === on && !!named?.some(entry => entry.id === item.id));
  return { on: still(event.profile?.off, false), off: still(event.profile?.on, true) };
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
