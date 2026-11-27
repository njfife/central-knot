// What plugins installed whole bring, as rows of the Library (no DOM): one row per item of a
// plugin across every tool that has the plugin. An item the person also has as their own (the same skill, or the plugin's item
// linked to it in Pi, OpenCode and Antigravity) stays on that row, whose box says "Through a plugin" (types.ts LibraryFacts plugin); one
// that only shares a name is a row of its own here. These rows are never managed: no sync, no repo; each tool's line in the
// opened row turns the item on or off there, or installs the plugin, puts its items in or removes it (pluginline.ts), and a profile
// ticks the item by its own rows (profileplan.ts pluginLive). Which tools have such a row of his on through a plugin is decided here
// too (pluginOnIn), for the Library's rows and for what a profile switch leaves loaded.
import { DIRECTORY, loadsKind, partOfPage, samePart, versionWord } from './pluginstatus.ts';
import { lacksIt } from './pluginline.ts';
import { onNow, type PluginItemAt } from './pluginswitch.ts';
import { takesPlugins } from './presence.ts';
import { andList, byToolOrder, toolNames as names } from './words.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts, PartKind, PartRef, PluginItem, ThroughPlugin } from './types.ts';
import { kindSource } from './itemrow.ts';
import { pluginLink, pluginMarketOf, pluginOf } from './sourcelink.ts';

type Page = keyof typeof partOfPage;

/** One item of a plugin, by the plugin it comes with, and what each tool's installed copy of that plugin has of it. */
export interface PluginRow {
  /**
   * Unique beside the page's own keys: a folder or file name never holds "/". Not across kinds: a plugin's skill and MCP
   * server of one name share it, so a row is known by its kind and key (itemrow.ts rowId).
   */
  key: string;
  kind: PartKind;
  name: string;
  description: string;
  plugin: string;
  marketName: string;
  /** Each tool's copy of the item, in the tool's copy of the plugin. */
  copies: Partial<Record<HarnessId, PluginItem>>;
  /** The plugin as each tool that has it installed has it, whether or not its copy brings this item. */
  installs: Partial<Record<HarnessId, InstalledPlugin>>;
}

/**
 * A page's plugin rows (those no row of the person's own already shows), those a row of the person's own shows (`folded`,
 * by that row's key: word search reads their copies' texts), and copies that couldn't be read.
 */
export interface PageRows { rows: PluginRow[]; folded: Map<string, PluginRow[]>; unread: InstalledPlugin[] }

/** Whether this tool's copy of the plugin has this item turned off, and how: the whole plugin, or the item's own switch (a skill's, an MCP server's, an agent's). */
export function offIn(row: PluginRow, tool: HarnessId): 'plugin' | 'item' | undefined {
  const install = row.installs[tool];
  if (!install || !row.copies[tool]) return undefined;
  if (install.off) return 'plugin';
  const off = { skill: install.skillsOff, mcp: install.serversOff, agent: install.agentsOff }[row.kind];
  return off?.some(name => samePart({ kind: row.kind, name }, row)) ? 'item' : undefined;
}

/** A tool has its own copies, items its plugins give it, and skill copies it reads through a link or another folder, even when its own switch has the copy off. */
export const inTool = (fact: Pick<LibraryFacts, 'copies' | 'plugin' | 'loads'>, tool: HarnessId) =>
  fact.copies[tool] !== undefined || !!fact.plugin?.[tool] || !!fact.loads?.[tool];

/**
 * Whether a row of the person's own (of `row`'s kind) is this plugin's item already: some tool has that row's item through this
 * plugin (its box says so), or the row's item is linked to this plugin (library.ts A PLUGIN: its row says "from the plugin").
 * Find's catalog documents ask it too (searchdocs.ts catalogDocs).
 */
export const onOwnRow = (fact: LibraryFacts, row: Pick<PluginRow, 'kind' | 'name' | 'plugin' | 'marketName'>) => [fact.key, fact.name].some(name => !!name && samePart(row, { kind: row.kind, name }))
  && (Object.values(fact.plugin ?? {}).some(given => given.plugin === row.plugin && given.marketplace === row.marketName)
    || fact.fromSource?.link === pluginLink(row.plugin, row.marketName));

/** A row of the person's own as its tools have it through plugins: the kind's view's (types.ts LibraryFacts) or the page's (itemrow.ts ItemRow). */
type OwnRow = { key: string; name?: string; copies: Partial<Record<string, unknown>>; plugin?: Partial<Record<string, ThroughPlugin>> };
/** The plugin a tool has a row's item through, where the tool has no copy of its own (types.ts LibraryFacts plugin). */
export const throughPluginHere = (row: Pick<OwnRow, 'copies' | 'plugin'>, tool: string): ThroughPlugin | undefined => (row.copies[tool] === undefined ? row.plugin?.[tool] : undefined);
/** The item a tool has through a plugin on a row of the person's own (throughPluginHere), with that plugin as the tool has it installed in `home`. */
export function itemThrough(home: Pick<HomeView, 'pluginItems'> | undefined, page: Page, row: OwnRow, tool: string): PluginItemAt | undefined {
  const given = throughPluginHere(row, tool);
  const install = given && home?.pluginItems?.find(entry => entry.tool === tool && entry.plugin === given.plugin && entry.marketName === given.marketplace);
  return install ? { kind: partOfPage[page], name: given.name ?? row.name ?? row.key, tool: tool as HarnessId, install } : undefined;
}
/**
 * A row's `pluginOn` (libraryrow.ts LibraryRow): the tools of its kind with no copy of their own that have its item on through an
 * installed plugin (pluginswitch.ts onNow; with no install read, the plugin's own `off`). The Library's rows ask it (matrix.ts
 * rowsOf), and so does what a profile switch leaves loaded (profileplan.ts withLoads).
 */
export const pluginOnIn = (home: Pick<HomeView, 'pluginItems' | Page> | undefined, page: Page, row: OwnRow): string[] => (home ? kindSource(home, page).tools : [])
  .filter(tool => { const given = throughPluginHere(row, tool), item = itemThrough(home, page, row, tool); return item ? onNow(item) : !!given && !given.off; });

const memo = new WeakMap<HomeView, Partial<Record<Page, PageRows>>>();

/**
 * The page's plugin rows for a home, worked out once per read: one per item of a plugin, across the tools that have it
 * installed, left out where a row of the person's own already shows that item as there through the plugin.
 */
export function pageRows(home: HomeView, page: Page): PageRows {
  const known = memo.get(home) ?? {};
  if (known[page]) return known[page]!;
  const kind = partOfPage[page];
  const { facts } = kindSource(home, page);
  const byKey = new Map<string, PluginRow>();
  for (const install of home.pluginItems ?? []) for (const item of install.items.filter(entry => entry.kind === kind)) {
    const id = `${install.plugin}@${install.marketName}/${kind === 'mcp' ? item.name : item.name.normalize('NFC').toLowerCase()}`;
    const row = byKey.get(id) ?? { key: id, kind, name: item.name, description: '', plugin: install.plugin, marketName: install.marketName, copies: {}, installs: {} };
    row.copies[install.tool] = item;
    // An MCP server reads as the page's own do: "Command · npx -y …", "URL · https://…".
    row.description ||= kind === 'mcp' ? (item.runs ? `${/^https?:/i.test(item.runs) ? 'URL' : 'Command'} · ${item.runs}` : '') : item.description;
    byKey.set(id, row);
  }
  // Every tool with the plugin, so a copy without this item (Codex and an agent, another version) says so in its cell.
  for (const row of byKey.values()) for (const install of home.pluginItems ?? []) if (install.plugin === row.plugin && install.marketName === row.marketName) row.installs[install.tool] = install;
  // One row, not two: an item that is already a row of the person's own stays that row's.
  const folded = new Map<string, PluginRow[]>();
  const rows = [...byKey.values()].filter(row => {
    const own = facts.find(fact => onOwnRow(fact, row));
    if (own) folded.set(own.key, [...(folded.get(own.key) ?? []), row]);
    return !own;
  }).sort((first, second) => first.name.localeCompare(second.name));
  const unread = (home.pluginItems ?? []).filter(install => install.problem);
  const made = { rows, folded, unread };
  memo.set(home, { ...known, [page]: made });
  return made;
}

/** How many plugin rows the page lists; in `tool`, those it has there. */
export const pluginItemCount = (home: HomeView, page: Page, tool?: HarnessId): number => pageRows(home, page).rows.filter(row => !tool || row.copies[tool]).length;

/** The rows a page has: its own items and a plugin's. None: the page shows its empty state instead. */
export const rowCount = (home: HomeView, page: Page): number => kindSource(home, page).facts.length + pluginItemCount(home, page);

/** The tools that have this item through the plugin, in column order. */
export const pluginTools = (row: PluginRow) => (Object.keys(row.copies) as HarnessId[]).sort(byToolOrder);

/** "varo-dev 1.2.0 in Claude Code and Copilot CLI", with each version where they differ. */
export function inWhere(row: PluginRow): string {
  const tools = pluginTools(row);
  const versions = new Set(tools.map(tool => row.installs[tool]?.version));
  if (versions.size === 1) { const [version] = versions; return `${row.plugin}${version ? ` (${versionWord(version)})` : ''}, installed in ${andList(tools.map(tool => names[tool]))}`; }
  return `${row.plugin}, installed in ${andList(tools.map(tool => `${names[tool]}${row.installs[tool]?.version ? ` (${row.installs[tool]!.version})` : ''}`))}`;
}

/** A row's tag's hover text: it is inside the installed plugin. */
export const insideTitle = (row: PluginRow) => `Inside the plugin ${inWhere(row)}. It comes and goes with the plugin${listedHere(row) ? ', on the plugin’s page' : ''}`;

/** Why a tool has no copy of this item, as a sentence naming that tool (a mark's tooltip; the opened row's line says what can be done: pluginline.ts). */
function missingWhy(row: PluginRow, tool: HarnessId): string {
  const install = row.installs[tool];
  if (install) return lacksIt(install, row.kind);
  return takesPlugins(tool) ? `Not installed in ${names[tool]}.` : `${names[tool]} takes no plugins.`;
}

/** One tool's cell, in words: there through the plugin (on or off), or why not. */
export function cellWords(row: PluginRow, tool: HarnessId): string {
  if (!row.copies[tool]) return missingWhy(row, tool).replace(/\.$/, '');
  const name = names[tool];
  const off = offIn(row, tool);
  const version = row.installs[tool]?.version ? ` ${row.installs[tool]!.version}` : '';
  return `${name}: in the plugin ${row.plugin}${version}${off === 'plugin' ? `; the whole plugin is turned off in ${name}` : off === 'item' ? `; turned off in ${name}` : ''}`;
}

/** Whether the plugin's marketplace is on the Plugins page (it is added in some tool that has it), so it has a page there. */
const listedHere = (row: PluginRow) => Object.values(row.installs).some(install => install?.listed);
/**
 * How a plugin whose marketplace is on no page here is handled, in one sentence (the opened row's strip says it: matrix.ts
 * pluginStrip): from the Anthropic Directory by Claude Code itself, else by each tool's own plugin commands; '' where it is listed.
 */
export function handledWhere(row: PluginRow): string {
  if (listedHere(row)) return '';
  const tools = pluginTools(row).map(tool => names[tool]);
  if (row.marketName === DIRECTORY) return `Installed in ${andList(tools)} from the Anthropic Directory. Claude Code’s own /plugin updates, turns off or removes it.`;
  return `Installed in ${andList(tools)} from the marketplace “${row.marketName}”, which isn’t added in Central Knot or in ${tools.length === 1 ? 'that tool' : 'those tools'} now, so the plugin has no page here. ${tools.length === 1 ? `${tools[0]}’s` : 'Each tool’s'} own plugin commands update, turn off or remove it.`;
}

type PluginRowRef = { fromSource?: { link: string }; on?: boolean; except?: readonly string[] };
/** Whether a library item from a plugin (library.ts A PLUGIN) goes through the plugin in `tool`, which takes plugins, unless it is On and kept out of `tool` (where its own switch lets it in). */
const pluginHandles = (row: PluginRowRef, tool: string) =>
  !!pluginOf(row.fromSource?.link ?? '') && takesPlugins(tool as HarnessId) && !(row.on && row.except?.includes(tool));

/**
 * The tools a library item from a plugin (library.ts A PLUGIN) gets only by installing that plugin: those that take plugins,
 * load its kind (pluginstatus.ts loadsKind) and don't have it installed, but one the item is On and kept out of, where its own
 * switch lets it in. There its row's line offers Install <plugin> (pluginline.ts), and its mark says it gets it with the
 * plugin (matrix.ts markOf); its switch's result doesn't count it among the tools it is on in (matrix.ts canHave).
 */
export function withPluginOnly(home: Pick<HomeView, 'pluginItems' | Page> | undefined, page: Page, row: PluginRowRef): HarnessId[] {
  const link = row.fromSource?.link ?? '', plugin = pluginOf(link), marketName = pluginMarketOf(link);
  if (!home || !plugin) return [];
  return kindSource(home, page).tools.filter(tool => pluginHandles(row, tool) && loadsKind(tool, partOfPage[page])
    && !home.pluginItems?.some(install => install.tool === tool && install.plugin === plugin && install.marketName === marketName));
}

/**
 * Whether a library item from a plugin (library.ts A PLUGIN) cannot load in `tool`, which takes plugins, because `tool` does
 * not load a plugin's items of this kind (pluginstatus.ts loadsKind), unless it is On and kept out of `tool` (where its own
 * switch lets it in). Asked by matrix.ts canHave (never counted as on in a click's result) and matrix.ts rowPluginFacts (its
 * opened-row line still explains why).
 */
export const pluginKindNotLoaded = (page: Page, row: PluginRowRef, tool: string): boolean =>
  pluginHandles(row, tool) && !loadsKind(tool as HarnessId, partOfPage[page]);

/**
 * The names of a plugin's items a tool has of his own (any copy there but Central Knot's current copy of an item from the plugin),
 * which an install or a placement leaves his (library.ts TAKE). Its names: its items as any tool has it installed, and its items in
 * the library. A line's sentence names them before its act (pluginline.ts yoursStay).
 */
export function yoursIn(home: HomeView, plugin: string, marketName: string, tool: HarnessId): PartRef[] {
  const link = pluginLink(plugin, marketName);
  const installed = (home.pluginItems ?? []).filter(install => install.plugin === plugin && install.marketName === marketName).flatMap(install => install.items);
  return (['skills', 'mcp', 'agents'] as const).flatMap(page => (home[page].tools.includes(tool) ? home[page].items : []).flatMap(fact => {
    const copy = fact.copies[tool], linked = fact.fromSource?.link === link, part = { kind: partOfPage[page], name: fact.name };
    return copy && (linked ? copy.hash !== home[page].library[fact.key]?.hash : installed.some(item => samePart(item, part))) ? [part] : [];
  }));
}
