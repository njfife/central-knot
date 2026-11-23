// Where a row of the item lists came from (originOf), and the Library's From menu: its choice (From), the rows a choice shows
// (fromShows) and the choices it offers (fromChoices); the menu is drawn by matrix.ts fromChoice. Pure: no DOM. A row can come
// from several places: the person's own (found, or kept from no recorded source and linked to no plugin, even where a tool also
// gets it through a plugin); a Library source, by the link the row's view resolves (types.ts LibraryFacts fromSource; never the
// item's stored source id, which a removed source leaves behind), one that source dropped too; and plugins, each
// by its link (sourcelink.ts pluginLink): a plugin's own row, a tool that gets the item through a plugin (LibraryFacts plugin),
// an item linked to a plugin in Pi, OpenCode or Antigravity. Those two are what folds a plugin's item onto a row (pluginrows.ts onOwnRow).
// Never from version history: an item edited away from its plugin, which the pass let go, is the person's own.
import type { PageKind } from './app.ts';
import { kindSource } from './itemrow.ts';
import { pageRows, type PluginRow } from './pluginrows.ts';
import { heldKinds } from './presence.ts';
import { pluginLink, pluginOf, shortLabels } from './sourcelink.ts';
import type { HomeView, LibraryFacts } from './types.ts';

/** Where one row came from. */
export interface Origins {
  /** The person's own: from no recorded source and linked to no plugin. */
  yours: boolean;
  /** The Library source it came from, by its link (an item that source dropped too). */
  source?: string;
  /** The plugins it came from, each by its link (pluginLink), once each. */
  plugins: string[];
}

/** Where a row came from: a plugin's own row is that plugin's; a row of the person's own (the view's, or itemrow.ts ItemRow) is as the header says. */
export function originOf(row: Pick<LibraryFacts, 'fromSource' | 'plugin'> | PluginRow): Origins {
  if ('marketName' in row) return { yours: false, plugins: [pluginLink(row.plugin, row.marketName)] };
  const link = row.fromSource?.link, linkedToPlugin = !!link && pluginOf(link) !== undefined;
  const plugins = new Set([...(linkedToPlugin ? [link] : []), ...Object.values(row.plugin ?? {}).map(given => pluginLink(given.plugin, given.marketplace))]);
  return { yours: !link, ...(link && !linkedToPlugin ? { source: link } : {}), plugins: [...plugins] };
}

/** Each row of a kind in a home with where it came from: the person's own rows (the kind's view), then a plugin's own (pageRows). */
export const originsIn = (home: HomeView, kind: PageKind): Origins[] => [...kindSource(home, kind).facts, ...pageRows(home, kind).rows].map(originOf);

/** How many rows of a kind came from some plugin, each once: the Overview's card says it ("3 from plugins"). */
export const fromAnyPlugin = (home: HomeView, kind: PageKind) => originsIn(home, kind).filter(origins => origins.plugins.length > 0).length;

/**
 * The plugins with a row of a kind this home holds, an Off item linked to one too, by their links, once per read of the home:
 * the From menu names them, and a plugin's page and its row on Plugins link to its items (pluginparts.ts libraryLink).
 */
export function pluginsHere(home: HomeView): Set<string> {
  if (!found.has(home)) found.set(home, new Set(heldKinds(home).flatMap(kind => originsIn(home, kind).flatMap(origins => origins.plugins))));
  return found.get(home)!;
}
const found = new WeakMap<HomeView, Set<string>>();
/** The sources with a row of a kind this home holds, by their links: a source's row offers Show in the Library only then (sourcespage.ts). */
export const sourcesHere = (home: HomeView) => new Set(heldKinds(home).flatMap(kind => originsIn(home, kind).flatMap(origins => origins.source ?? [])));

/** The From menu's choice: Anywhere (every row), Your own, any plugin or one (pluginFrom), any Library source or one (sourceFrom). */
export type From = 'anywhere' | 'yours' | 'plugins' | 'sources' | `plugin:${string}` | `source:${string}`;
const SOURCE = 'source:';
/** The From choice of one plugin, by its name and its marketplace's: its link. */
export const pluginFrom = (plugin: string, marketName: string) => pluginLink(plugin, marketName) as `plugin:${string}`;
/** The From choice of one Library source, by its link as the home records it. */
export const sourceFrom = (link: string): From => `${SOURCE}${link}`;

/** Whether a choice of From shows a row that came from `origins`. */
export const fromShows = (from: From, origins: Origins): boolean => from === 'anywhere' || (from === 'yours' ? origins.yours
  : from === 'plugins' ? origins.plugins.length > 0 : from === 'sources' ? !!origins.source
  : from.startsWith(SOURCE) ? origins.source === from.slice(SOURCE.length) : origins.plugins.includes(from));

/** One entry of the menu: its choice, its words, and the whole of what they shorten (a source's link). */
export interface FromEntry { value: From; label: string; title?: string }

/**
 * The menu's two groups after Anywhere and Your own, each in alphabetical order, none with nothing to name: Plugins (Any plugin,
 * then each of pluginsHere by name, two of one name told apart by marketplace) and the sources' (Any source, then each the home
 * records, `sources` by link, labelled by sourcelink.ts shortLabels). Whatever Find and the kind switch say.
 */
export function fromChoices(home: HomeView, sources: readonly string[]): { plugins: FromEntry[]; sources: FromEntry[] } {
  const named = [...pluginsHere(home)].map(link => ({ link, name: pluginOf(link)!, marketName: link.slice(link.lastIndexOf('@') + 1) }));
  const twice = (name: string) => named.filter(each => each.name === name).length > 1;
  const plugins = named.map(({ link, name, marketName }) => ({ value: link as From, label: twice(name) ? `${name} (${marketName})` : name }));
  const labels = shortLabels(sources), byLabel = (first: FromEntry, second: FromEntry) => first.label.localeCompare(second.label);
  return {
    plugins: plugins.length ? [{ value: 'plugins', label: 'Any plugin' }, ...plugins.sort(byLabel)] : [],
    sources: sources.length ? [{ value: 'sources', label: 'Any source' }, ...sources.map(link => ({ value: sourceFrom(link), label: labels.get(link)!, title: link })).sort(byLabel)] : [],
  };
}
