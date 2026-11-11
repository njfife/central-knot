// What plugins installed whole bring, as rows of the Skills, MCP servers and Agents pages (no DOM): one row per item of a
// plugin across every tool that has the plugin. An item the person also has as their own (the same skill, or the plugin's
// part in another tool) stays on that row, whose box says "Through a plugin" (SkillFacts.plugin); one that only shares a
// name is a row of its own here. These rows are never managed: no sync, no profile, no repo; a box turns the item on or
// off in that tool (pluginswitch.ts), and the plugin's page is where the plugin itself is handled.
import { DIRECTORY, partOfPage, samePart, versionWord } from './pluginstatus.ts';
import { takesPlugins } from './presence.ts';
import { andList, byToolOrder, toolNames as names } from './words.ts';
import type { HarnessId, HomeView, InstalledPlugin, PartKind, PluginItem, SkillFacts } from './types.ts';

type Page = keyof typeof partOfPage;

/** One item of a plugin, by the plugin it comes with, and what each tool's installed copy of that plugin has of it. */
export interface PluginRow {
  /** Unique beside the page's own keys: a folder or file name never holds "/". */
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

/** A page's plugin rows (those no row of the person's own already shows), and copies that couldn't be read. */
export interface PageRows { rows: PluginRow[]; unread: InstalledPlugin[] }

/** Whether this tool's copy of the plugin has this item turned off, and how: the whole plugin, or the item's own switch (a skill's, an MCP server's, an agent's). */
export function offIn(row: PluginRow, tool: HarnessId): 'plugin' | 'item' | undefined {
  const install = row.installs[tool];
  if (!install || !row.copies[tool]) return undefined;
  if (install.off) return 'plugin';
  const off = { skill: install.skillsOff, mcp: install.serversOff, agent: install.agentsOff }[row.kind];
  return off?.some(name => samePart({ kind: row.kind, name }, row)) ? 'item' : undefined;
}

/** Whether a tool has an item of the person's: a copy of its own there, or through a plugin installed there (its box says so). The tables and every count ask this. */
export const inTool = (fact: Pick<SkillFacts, 'copies' | 'plugin'>, tool: HarnessId) => fact.copies[tool] !== undefined || !!fact.plugin?.[tool];

/**
 * Whether a row of the person's own is this plugin's item already: some tool has that row's item through this plugin (its
 * box says so), or the row's copy in some tool is on record as this plugin's part (a Codex plugin's MCP server put into
 * Pi, which no box shows as through the plugin, since Codex may not start a plugin's servers).
 */
const onOwnRow = (home: HomeView, fact: SkillFacts, row: PluginRow) => [fact.key, fact.name].some(name => !!name && samePart(row, { kind: row.kind, name }))
  && (Object.values(fact.plugin ?? {}).some(given => given.plugin === row.plugin && given.marketplace === row.marketName)
    || (home.parts ?? []).some(install => install.plugin === row.plugin && install.marketName === row.marketName && fact.copies[install.tool] !== undefined && install.items.some(item => !item.removed && samePart(item, row))));

const memo = new WeakMap<HomeView, Partial<Record<Page, PageRows>>>();

/**
 * The page's plugin rows for a home, worked out once per read: one per item of a plugin, across the tools that have it
 * installed, left out where a row of the person's own already shows that item as there through the plugin.
 */
export function pageRows(home: HomeView, page: Page): PageRows {
  const known = memo.get(home) ?? {};
  if (known[page]) return known[page]!;
  const kind = partOfPage[page];
  const facts = page === 'skills' ? home.manage.skills : page === 'mcp' ? home.mcp.servers : home.agents.servers;
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
  const rows = [...byKey.values()].filter(row => !facts.some(fact => onOwnRow(home, fact, row))).sort((first, second) => first.name.localeCompare(second.name));
  const unread = (home.pluginItems ?? []).filter(install => install.problem);
  const made = { rows, unread };
  memo.set(home, { ...known, [page]: made });
  return made;
}

/** How many plugin rows the page lists; in `tool`, those it has there. */
export const pluginItemCount = (home: HomeView, page: Page, tool?: HarnessId): number => pageRows(home, page).rows.filter(row => !tool || row.copies[tool]).length;

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
export const insideTitle = (row: PluginRow) => `Inside the plugin ${inWhere(row)}. It comes and goes with the plugin${handledWhere(row).listed ? ', on the plugin’s page' : ''}`;

/** Why a tool has no copy of this item, as a sentence naming that tool: the plugin's files unread there, a kind it doesn't load, or not installed there. */
function missingWhy(row: PluginRow, tool: HarnessId): string {
  const name = names[tool];
  const install = row.installs[tool];
  if (install?.problem) return `${name} has ${row.plugin} installed, but its files couldn’t be read.`;
  if (install && tool === 'codex-cli' && row.kind === 'agent') return `${name} has ${row.plugin} installed, but Codex doesn’t load a plugin’s agents.`;
  if (install) return `${name} has ${row.plugin} installed, but its copy doesn’t have this ${row.kind === 'mcp' ? 'MCP server' : row.kind}.`;
  if (!takesPlugins(tool)) return `${name} takes no plugins.${handledWhere(row).listed ? ` The plugin’s page can put its parts in ${name} as separate items.` : ''}`;
  return `Not installed in ${name}.${handledWhere(row).listed ? ' The plugin’s page on Plugins installs it there.' : ''}`;
}

/** One tool's cell, in words: there through the plugin (on or off), or why not. */
export function cellWords(row: PluginRow, tool: HarnessId): string {
  if (!row.copies[tool]) return missingWhy(row, tool).replace(/\.$/, '');
  const name = names[tool];
  const off = offIn(row, tool);
  const version = row.installs[tool]?.version ? ` ${row.installs[tool]!.version}` : '';
  return `${name}: in the plugin ${row.plugin}${version}${off === 'plugin' ? `; the whole plugin is turned off in ${name}` : off === 'item' ? `; turned off in ${name}` : ''}`;
}

/** One tool's line in the item's details: its copy in the plugin and whether it is on, or why that tool has none. */
export function toolWords(row: PluginRow, tool: HarnessId): string {
  if (!row.copies[tool]) return missingWhy(row, tool);
  const version = row.installs[tool]?.version;
  const off = offIn(row, tool);
  return `Inside ${row.plugin}${version ? ` ${version}` : ''}. ${off === 'plugin' ? 'The whole plugin is turned off here.' : off === 'item' ? 'Turned off here with its own switch.' : 'On.'}`;
}

/** Where a plugin's item is handled, in one sentence: on its page, or, with its marketplace nowhere here, in the tool itself. */
export function handledWhere(row: PluginRow): { listed: boolean; text: string } {
  const listed = Object.values(row.installs).some(install => install?.listed);
  if (listed) return { listed, text: 'Installed, updated, turned off and removed with the plugin, on ' };
  const tools = pluginTools(row).map(tool => names[tool]);
  if (row.marketName === DIRECTORY) return { listed, text: `Installed in ${andList(tools)} from the Anthropic Directory. Claude Code’s own /plugin updates, turns off or removes it.` };
  return { listed, text: `Installed in ${andList(tools)} from the marketplace “${row.marketName}”, which isn’t added in Central Knot or in ${tools.length === 1 ? 'that tool' : 'those tools'} now, so the plugin has no page here. ${tools.length === 1 ? `${tools[0]}’s` : 'Each tool’s'} own plugin commands update, turn off or remove it.` };
}
