// Profiles' rules, pure (no files, no DOM). A profile names library items (library.ts) of the three kinds, as `skill:<key>`,
// `agent:<key>` and `mcp:<key>`. Switching to it turns each item it names On and every other library item Off (switchPlan);
// a profile is in use exactly while that would change nothing, so which one is in use is worked out, never stored (inUse);
// and a switch's Undo turns back each item still as the switch left it (undoPlan). An id that names no live library item
// (one only found in a tool, one a plugin brings, one deleted) is skipped by all three and stays in the profile.
// Read by profiles.ts (which carries a switch out), profilemigrate.ts, the Profiles page, History's page and the menus
// (main.ts), so each says the same. The profiles file and the switch itself are profiles.ts's.
import type { ItemKind, LibraryItem } from './library.ts';
import { plural } from './model.ts';
import { andList } from './words.ts';
import type { HistoryEvent, HomeView, Profile } from './types.ts';

/** What every screen calls the state where no profile is in use. */
export const NO_PROFILE = 'No profile';

/** A profile's name for a library item: its kind and key, `skill:notes`. */
export const itemId = (kind: ItemKind, key: string) => `${kind}:${key}`;

/** A live library item (not deleted) as profiles see it. `except`: the tools it is kept out of, which a switch keeps. */
export interface LiveItem { id: string; kind: ItemKind; key: string; name: string; on: boolean; except: LibraryItem['except'] }

/** Each kind's items as the library holds them, deleted ones too (types.ts LibraryView `library`, or a kind's record). */
export type Libraries = Record<ItemKind, Record<string, LibraryItem>>;

/** Every live library item, skills first, then MCP servers, then agents. */
export function liveItems(libraries: Libraries): LiveItem[] {
  return (['skill', 'mcp', 'agent'] as const).flatMap(kind => Object.values(libraries[kind]).filter(item => !item.deleted)
    .map(({ key, name, on, except }) => ({ id: itemId(kind, key), kind, key, name, on, except })));
}

/** A home view's live items (each kind's `library` in types.ts HomeView), as the page and the menus read them. */
export const homeItems = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents'>) => liveItems({ skill: home.skills.library, mcp: home.mcp.library, agent: home.agents.library });

/** What a switch, or its Undo, changes: the items it turns On, and those it turns Off. */
export interface Turns { on: LiveItem[]; off: LiveItem[] }

/** What switching to `profile` changes: each item it names that is Off turns On, and every other item that is On turns Off. */
export function switchPlan(profile: Pick<Profile, 'items'>, live: LiveItem[]): Turns {
  const named = new Set(profile.items);
  return { on: live.filter(item => named.has(item.id) && !item.on), off: live.filter(item => !named.has(item.id) && item.on) };
}

/** The live items a profile names: what it has. */
export const namedItems = (profile: Pick<Profile, 'items'>, live: LiveItem[]) => live.filter(item => profile.items.includes(item.id));

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
 * goes Off, each it turned Off that is still Off goes On. An item changed since, or no longer in the library, is left.
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
