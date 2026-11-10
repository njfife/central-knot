// What plugins installed whole bring, as rows of the Skills, MCP servers and Agents pages (no DOM): one row per item of a
// plugin across every tool that has the plugin, or, where that plugin also put the item into another tool as a separate
// part, laid onto that part's own row. A personal item that only shares a name stays a row of its own. These rows are
// never managed: no switch, no sync, no profile, no repo; the plugin's page is where they are handled.
import { partOfPage, samePart, versionWord } from './pluginstatus.ts';
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

/** A page's plugin rows: those shown apart, those laid onto a part's row (by that row's key), and copies that couldn't be read. */
export interface PageRows { rows: PluginRow[]; merged: Map<string, PluginRow[]>; unread: InstalledPlugin[] }

/** Whether this tool's copy of the plugin has this item turned off, and how: the whole plugin, or the skill's own switch. */
export function offIn(row: PluginRow, tool: HarnessId): 'plugin' | 'skill' | undefined {
  const install = row.installs[tool];
  if (!install || !row.copies[tool]) return undefined;
  if (install.off) return 'plugin';
  return row.kind === 'skill' && install.skillsOff?.some(name => samePart({ kind: 'skill', name }, row)) ? 'skill' : undefined;
}

/** Whether a fact is, in some tool, this plugin's item put in as a separate part (parts.ts), and still there. */
const isPartOf = (home: HomeView, fact: SkillFacts, row: PluginRow) => (home.parts ?? []).some(install => install.plugin === row.plugin && install.marketName === row.marketName
  && fact.copies[install.tool] !== undefined && install.items.some(item => !item.removed && [fact.key, fact.name].some(name => samePart(item, { kind: row.kind, name }))));

const memo = new WeakMap<HomeView, Partial<Record<Page, PageRows>>>();

/**
 * The page's plugin rows for a home, worked out once per read. A row joins a part's row only where that row has no copy of
 * its own, and doesn't sync, in every tool the plugin is in, so a cell never stands for two things.
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
  const rows: PluginRow[] = [], merged = new Map<string, PluginRow[]>();
  for (const row of [...byKey.values()].sort((first, second) => first.name.localeCompare(second.name))) {
    const tools = Object.keys(row.copies) as HarnessId[];
    const part = facts.find(fact => [fact.key, fact.name].some(name => samePart(row, { kind, name })) && isPartOf(home, fact, row)
      && tools.every(tool => fact.copies[tool] === undefined && (!fact.managed || fact.off.includes(tool))));
    if (part) merged.set(part.key, [...(merged.get(part.key) ?? []), row]); else rows.push(row);
  }
  const unread = (home.pluginItems ?? []).filter(install => install.problem);
  const made = { rows, merged, unread };
  memo.set(home, { ...known, [page]: made });
  return made;
}

/** How many items the page lists that come with plugins installed whole and aren't a part's row; in `tool`, every one it has there. */
export function pluginItemCount(home: HomeView, page: Page, tool?: HarnessId): number {
  const { rows, merged } = pageRows(home, page);
  if (!tool) return rows.length;
  return rows.filter(row => row.copies[tool]).length + [...merged.values()].filter(list => list.some(row => row.copies[tool])).length;
}

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
export const insideTitle = (row: PluginRow) => `Inside the plugin ${inWhere(row)}. Handled on the plugin’s page, not managed here`;

/** Why a tool has no copy of this item, as a sentence naming that tool: the plugin's files unread there, a kind it doesn't load, or not installed there. */
function missingWhy(row: PluginRow, tool: HarnessId): string {
  const name = names[tool];
  const install = row.installs[tool];
  if (install?.problem) return `${name} has ${row.plugin} installed, but its files couldn’t be read.`;
  if (install && tool === 'codex-cli' && row.kind === 'agent') return `${name} has ${row.plugin} installed, but Codex doesn’t load a plugin’s agents.`;
  if (install) return `${name} has ${row.plugin} installed, but its copy doesn’t have this ${row.kind === 'mcp' ? 'MCP server' : row.kind}.`;
  if (tool === 'pi-cli') return 'Pi takes no plugins. The plugin’s page can put its parts in Pi as separate items.';
  return `Not installed in ${name}.${handledWhere(row).listed ? ' The plugin’s page on Plugins installs it there.' : ''}`;
}

/** One tool's cell, in words: there through the plugin (on or off), or why not. */
export function cellWords(row: PluginRow, tool: HarnessId): string {
  if (!row.copies[tool]) return missingWhy(row, tool).replace(/\.$/, '');
  const name = names[tool];
  const off = offIn(row, tool);
  const version = row.installs[tool]?.version ? ` ${row.installs[tool]!.version}` : '';
  return `${name}: in the plugin ${row.plugin}${version}${off === 'plugin' ? `; the whole plugin is turned off in ${name}` : off === 'skill' ? `; turned off in ${name}` : ''}`;
}

/** One tool's line in the item's details: its copy in the plugin and whether it is on, or why that tool has none. */
export function toolWords(row: PluginRow, tool: HarnessId): string {
  if (!row.copies[tool]) return missingWhy(row, tool);
  const version = row.installs[tool]?.version;
  const off = offIn(row, tool);
  return `Inside ${row.plugin}${version ? ` ${version}` : ''}. ${off === 'plugin' ? 'The whole plugin is turned off here.' : off === 'skill' ? 'Turned off here with its own switch.' : 'On.'}`;
}

/** Where a plugin's item is handled, in one sentence: on its page, or, with its marketplace nowhere here, in the tool itself. */
export function handledWhere(row: PluginRow): { listed: boolean; text: string } {
  const listed = Object.values(row.installs).some(install => install?.listed);
  if (listed) return { listed, text: 'Installed, updated, turned off and removed with the plugin, on ' };
  const tools = pluginTools(row).map(tool => names[tool]);
  return { listed, text: `Installed in ${andList(tools)} from the marketplace “${row.marketName}”, which isn’t added in Central Knot or in ${tools.length === 1 ? 'that tool' : 'those tools'} now, so the plugin has no page here. ${tools.length === 1 ? `${tools[0]}’s` : 'Each tool’s'} own plugin commands update, turn off or remove it.` };
}
