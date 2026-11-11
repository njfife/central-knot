// One MCP server of an installed plugin, turned off or on in one tool with that tool's own switch. The plugin's files are
// never touched, and each switch outlives a plugin update. Measured on the real programs on 2026-11-11 (capability data,
// Appendix B: Claude Code 2.1.311 and 2.1.322, Copilot CLI 1.0.109, Codex 0.142.3 and 0.167.1):
//   Claude Code  settings.json  "deniedMcpServers": [{ "serverName": "plugin:<plugin>:<server>" }]   (the bare name does nothing to a plugin's server)
//   Copilot CLI  settings.json  "disabledMcpServers": ["<server>"]                                   (what `copilot mcp disable` writes; by bare name)
//   Codex        config.toml    [plugins."<plugin>@<marketplace>".mcp_servers.<server>] enabled = false
// Text in, text out: the engine (plugins.setServer) reads, writes and reads back.
import { mcpDisabled, withMcpSwitch } from './mcpswitch.ts';
import { readTomlTables, setTomlTable, tomlHeader, type TomlTable } from './textedit.ts';
import type { PluginTool } from './presence.ts';

/** A plugin's server, as the tools' switches name it. */
export interface PluginServer { plugin: string; marketplace: string; server: string }

/** The name Claude Code gives a plugin's server, which its denied list goes by. */
const claudeName = ({ plugin, server }: PluginServer) => `plugin:${plugin}:${server}`;

/** Where Codex keeps a plugin's server's own settings: `[plugins."p@m".mcp_servers.<server>]`. */
const codexPath = ({ plugin, marketplace, server }: PluginServer) => ['plugins', `${plugin}@${marketplace}`, 'mcp_servers', server];
const startsWith = (path: string[], start: string[]) => start.length <= path.length && start.every((part, index) => path[index] === part);
const codexTable = (tables: TomlTable[], path: string[]) => tables.find(table => !table.array && table.path.length === path.length && startsWith(table.path, path));

/**
 * Whether Codex's config.toml sets this server's settings somewhere other than its own table: as a value in a table above
 * it (`mcp_servers = { … }` under the plugin, `<server>.enabled = …` under `mcp_servers`). A table added beside that
 * would define the same key twice, which makes the file invalid, so such a file is read and never edited.
 */
const setElsewhere = (tables: TomlTable[], path: string[]) => tables.some(table => !table.array && table.path.length < path.length && startsWith(path, table.path)
  && table.entries.some(entry => { const rest = path.slice(table.path.length); return entry.keys.slice(0, rest.length).every((key, index) => key === rest[index]); }));

/** Why Codex's switch for this server isn't written. */
export const SERVER_FORM = 'Codex’s config.toml sets this plugin’s MCP servers in a form Central Knot doesn’t edit, so this server can’t be switched here.';

/** Whether the tool's switch file `text` turns this server of the plugin off. Throws when the text isn't the tool's format. */
export function serverOff(tool: PluginTool, text: string, at: PluginServer): boolean {
  if (tool === 'claude-cli') return mcpDisabled(tool, text, claudeName(at));
  if (tool === 'copilot-cli') return mcpDisabled(tool, text, at.server);
  return codexTable(readTomlTables(text), codexPath(at))?.entries.find(entry => entry.key === 'enabled')?.value === false;
}

/**
 * The switch file's text with this server of the plugin turned off or on. Only the switch changes. Codex: a table that
 * holds nothing but the switch goes whole when the server is turned on (on is the default); one with the person's own
 * keys keeps them. Throws SERVER_FORM for a Codex file that sets the server's settings as a value.
 */
export function withServerSwitch(tool: PluginTool, text: string, at: PluginServer, off: boolean): string {
  if (tool === 'claude-cli') return withMcpSwitch(tool, text, claudeName(at), off);
  if (tool === 'copilot-cli') return withMcpSwitch(tool, text, at.server, off);
  if (serverOff(tool, text, at) === off) return text;
  const path = codexPath(at);
  const tables = readTomlTables(text);
  if (setElsewhere(tables, path)) throw Object.assign(new Error(SERVER_FORM), { code: 'CK_FORM' });
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const table = codexTable(tables, path);
  if (!table) return setTomlTable(text, path.slice(0, -1), at.server, `${tomlHeader(path)}${eol}enabled = false${eol}`, { endGap: true });
  const line = table.entries.find(entry => entry.key === 'enabled');
  const subtables = tables.some(other => other !== table && startsWith(other.path, path));
  // Turned on, a table that held only the switch has nothing left to say.
  if (!off && line && table.entries.length === 1 && !subtables) return setTomlTable(text, path.slice(0, -1), at.server, undefined, { endGap: true });
  if (line) return `${text.slice(0, line.start)}${off ? `enabled = false${eol}` : ''}${text.slice(line.end)}`;
  const insertAt = table.entries.at(-1)?.end ?? (text.indexOf('\n', table.start) + 1 || text.length);
  const before = text.slice(0, insertAt);
  return `${before}${before.endsWith('\n') ? '' : eol}enabled = false${eol}${text.slice(insertAt)}`;
}
