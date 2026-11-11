// One MCP server or agent of an installed plugin, turned off or on in one tool with that tool's own switch. The plugin's
// files are never touched, and each switch outlives a plugin update. Measured on the real programs on 2026-11-11
// (capability data, Appendix B: Claude Code 2.1.311 and 2.1.322, Copilot CLI 1.0.109, Codex 0.142.3 and 0.167.1):
//   MCP server
//     Claude Code  settings.json  "deniedMcpServers": [{ "serverName": "plugin:<plugin>:<server>" }]   (the bare name does nothing to a plugin's server)
//     Copilot CLI  settings.json  "disabledMcpServers": ["<server>"]                                   (what `copilot mcp disable` writes; by bare name)
//     Codex        config.toml    [plugins."<plugin>@<marketplace>".mcp_servers.<server>] enabled = false
//   Agent
//     Claude Code  settings.json  "permissions": { "deny": ["Agent(<plugin>:<agent>)"] }   (Claude is no longer offered it and its call is
//                                 refused; a session the person starts as that agent, `claude --agent`, still runs)
//     Copilot CLI has no switch for one agent, and Codex loads no plugin's agents.
// (One skill of a plugin is the older switch, plugins.setSkill: Copilot CLI and Codex have one, Claude Code has none.)
// Text in, text out: the engine (plugins.setPart) reads, writes and reads back.
import { mcpDisabled, withMcpSwitch } from './mcpswitch.ts';
import { readTomlTables, setJsonMember, setTomlTable, tomlHeader, type TomlTable } from './textedit.ts';
import { hasPartSwitch } from './pluginstatus.ts';
import { record, withoutBom } from './values.ts';
import type { HarnessId, PartKind } from './types.ts';

/** One MCP server or agent of a plugin, as the tools' switches name it. */
export interface PluginPartAt { plugin: string; marketplace: string; kind: PartKind; name: string }

/** The name Claude Code gives a plugin's server, which its denied list goes by. */
const claudeServer = ({ plugin, name }: PluginPartAt) => `plugin:${plugin}:${name}`;
/** Claude Code's rules that deny a plugin's agent: `Agent(…)`, and `Task(…)`, the tool's older name, which it reads the same. */
const claudeAgentRules = ({ plugin, name }: PluginPartAt) => [`Agent(${plugin}:${name})`, `Task(${plugin}:${name})`];
const denyList = (text: string): unknown[] => {
  const deny = record(record(text.trim() ? JSON.parse(withoutBom(text)) : {})?.permissions)?.deny;
  return Array.isArray(deny) ? deny : [];
};

/** Where Codex keeps a plugin's server's own settings: `[plugins."p@m".mcp_servers.<server>]`. */
const codexPath = ({ plugin, marketplace, name }: PluginPartAt) => ['plugins', `${plugin}@${marketplace}`, 'mcp_servers', name];
const startsWith = (path: string[], start: string[]) => start.length <= path.length && start.every((part, index) => path[index] === part);
const codexTable = (tables: TomlTable[], path: string[]) => tables.find(table => !table.array && table.path.length === path.length && startsWith(table.path, path));

/**
 * Whether Codex's config.toml sets this server's settings somewhere other than its own table: as a value in a table above
 * it (`mcp_servers = { … }` under the plugin, `<server>.enabled = …` under `mcp_servers`). A table added beside that
 * would define the same key twice, which makes the file invalid, so such a file is read and never edited.
 */
const setElsewhere = (tables: TomlTable[], path: string[]) => tables.some(table => !table.array && table.path.length < path.length && startsWith(path, table.path)
  && table.entries.some(entry => { const rest = path.slice(table.path.length); return entry.keys.slice(0, rest.length).every((key, index) => key === rest[index]); }));

/**
 * What Codex's config.toml says for `enabled` of the table at `path`, however it is written: a line in that table, a
 * dotted key in a table above it (`<server>.enabled = false` under `mcp_servers`), or inside a value there
 * (`mcp_servers = { <server> = { enabled = false } }`). Undefined when it says nothing.
 */
function codexEnabled(tables: TomlTable[], path: string[]): unknown {
  for (const table of tables) {
    if (table.array || !startsWith(path, table.path)) continue;
    const rest = [...path.slice(table.path.length), 'enabled'];
    for (const entry of table.entries) {
      if (entry.keys.length > rest.length || !entry.keys.every((key, index) => key === rest[index])) continue;
      const found = rest.slice(entry.keys.length).reduce<unknown>((value, key) => record(value)?.[key], entry.value);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Why this server of the plugin can't be switched in Codex's config.toml `text`, if it can't: its settings are written as a value (SERVER_FORM). Undefined for a file that can't be read at all. */
export function serverHeld(text: string, at: PluginPartAt): string | undefined {
  try { return setElsewhere(readTomlTables(text), codexPath(at)) ? SERVER_FORM : undefined; } catch { return undefined; }
}

/** Why Codex's switch for this server isn't written. */
export const SERVER_FORM = 'Codex’s config.toml sets this plugin’s MCP servers in a form Central Knot doesn’t edit, so this server can’t be switched here.';
const noSwitch = () => Object.assign(new Error('That tool has no switch for this.'), { code: 'CK_FORM' });

/** Whether the tool's switch file `text` turns this server or agent of the plugin off. Throws when the text isn't the tool's format. */
export function partOff(tool: HarnessId, text: string, at: PluginPartAt): boolean {
  if (!hasPartSwitch(tool, at.kind)) return false;
  if (at.kind === 'agent') return denyList(text).some(rule => claudeAgentRules(at).includes(rule as string));
  if (tool === 'claude-cli') return mcpDisabled(tool, text, claudeServer(at));
  if (tool === 'copilot-cli') return mcpDisabled(tool, text, at.name);
  return codexEnabled(readTomlTables(text), codexPath(at)) === false;
}

/**
 * The switch file's text with this server or agent of the plugin turned off or on. Only the switch changes (a JSON list
 * is written back as a list, with the same entries). Claude Code's deny list, left empty, goes, and `permissions` with it
 * when it held nothing else. Codex: a table that holds nothing but the switch goes whole when the server is turned on
 * (on is the default); one with the person's own keys keeps them. Throws SERVER_FORM for a Codex file that sets the
 * server's settings as a value.
 */
export function withPartSwitch(tool: HarnessId, text: string, at: PluginPartAt, off: boolean): string {
  if (!hasPartSwitch(tool, at.kind)) throw noSwitch();
  if (tool === 'codex-cli' && setElsewhere(readTomlTables(text), codexPath(at))) throw Object.assign(new Error(SERVER_FORM), { code: 'CK_FORM' });
  if (partOff(tool, text, at) === off) return text;
  if (at.kind === 'agent') {
    const rules = claudeAgentRules(at);
    const others = denyList(text).filter(rule => !rules.includes(rule as string));
    if (off) return setJsonMember(text, ['permissions', 'deny'], [...others, rules[0]!]);
    if (others.length) return setJsonMember(text, ['permissions', 'deny'], others);
    const permissions = record(record(JSON.parse(withoutBom(text)))?.permissions) ?? {};
    return setJsonMember(text, Object.keys(permissions).length > 1 ? ['permissions', 'deny'] : ['permissions'], undefined);
  }
  if (tool === 'claude-cli') return withMcpSwitch(tool, text, claudeServer(at), off);
  if (tool === 'copilot-cli') return withMcpSwitch(tool, text, at.name, off);
  const path = codexPath(at);
  const tables = readTomlTables(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const table = codexTable(tables, path);
  const subtables = tables.filter(other => other !== table && !other.array && startsWith(other.path, path));
  if (!table) {
    const own = `${tomlHeader(path)}${eol}enabled = false${eol}`;
    // The person's own subtables (`[….<server>.env]`) written without the server's table: the table goes in above the
    // first of them, and they stay as they are.
    if (subtables.length) { const first = Math.min(...subtables.map(other => other.start)); return `${text.slice(0, first)}${own}${eol}${text.slice(first)}`; }
    return setTomlTable(text, path.slice(0, -1), at.name, own, { endGap: true });
  }
  const line = table.entries.find(entry => entry.key === 'enabled');
  // Turned on, a table that held only the switch has nothing left to say.
  if (!off && line && table.entries.length === 1 && !subtables.length) return setTomlTable(text, path.slice(0, -1), at.name, undefined, { endGap: true });
  if (line) return `${text.slice(0, line.start)}${off ? `enabled = false${eol}` : ''}${text.slice(line.end)}`;
  const insertAt = table.entries.at(-1)?.end ?? (text.indexOf('\n', table.start) + 1 || text.length);
  const before = text.slice(0, insertAt);
  return `${before}${before.endsWith('\n') ? '' : eol}enabled = false${eol}${text.slice(insertAt)}`;
}
