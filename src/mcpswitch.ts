// Turning an MCP server off in one tool with that tool's own switch, as profiles do. The server's entry stays where it is; the tool
// just doesn't start it. Each switch was exercised in a throwaway home on 2026-11-09 (notes: ck-feedback/profiles/evidence.md):
//   Claude Code  settings.json  "deniedMcpServers": [{ "serverName": "<name>" }]   (2.1.321: the server leaves `claude mcp list`)
//   Copilot CLI  settings.json  "disabledMcpServers": ["<name>"]                    (what `copilot mcp disable` writes on 1.0.107)
//   Codex        config.toml    [mcp_servers.<name>] enabled = false                (0.142.3: `codex mcp list` shows it disabled)
//   Pi           mcp.json       "mcpServers": { "<name>": { "enabled": false } }    (1.5.0: `pi mcp list` shows it disabled)
// Claude Code's ~/.claude.json is never touched: its switch lives in settings.json, which Claude Code does not rewrite while it runs.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configRoot, harnesses } from './harnesses.ts';
import { errorCode, type ShareContext } from './share.ts';
import { list, parseJson } from './skillswitch.ts';
import { readTomlTables, setJsonMember } from './textedit.ts';
import type { HarnessId } from './types.ts';

/**
 * The file that holds a tool's MCP switches: Claude Code's and Copilot's settings.json (beside their skill switches), Codex's
 * config.toml and Pi's mcp.json (each server's own entry, as mcp.ts reads them).
 */
export function mcpSwitchPath(context: ShareContext, tool: HarnessId): string {
  const root = configRoot(harnesses[tool], context.home, context.overrides?.[tool]);
  return join(root, { 'claude-cli': 'settings.json', 'copilot-cli': 'settings.json', 'codex-cli': 'config.toml', 'pi-cli': 'mcp.json' }[tool]);
}

/** Each tool's MCP switch file as read ('' when there is none yet), or why it can't be used. */
export async function readMcpSwitches(context: ShareContext, tools: HarnessId[]): Promise<Map<HarnessId, { text: string; problem?: string }>> {
  return new Map(await Promise.all(tools.map(async tool => {
    const path = mcpSwitchPath(context, tool);
    let text = '';
    try { text = await readFile(path, 'utf8'); } catch (error) { if (errorCode(error) !== 'ENOENT') return [tool, { text, problem: `${path} could not be read, so servers can’t be turned off in ${harnesses[tool].name}.` }] as const; }
    try { mcpDisabled(tool, text, ''); } catch { return [tool, { text, problem: `${path} could not be read as ${tool === 'codex-cli' ? 'TOML' : 'JSON'}, so servers can’t be turned off in ${harnesses[tool].name}.` }] as const; }
    return [tool, { text }] as const;
  })));
}

const deniesByName = (entry: unknown, name: string) => !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).serverName === name;

/** Codex: the server's own `[mcp_servers.<name>]` table, if it has one. */
const codexTable = (text: string, name: string) => readTomlTables(text).find(table => !table.array && table.path.length === 2 && table.path[0] === 'mcp_servers' && table.path[1] === name);

/** Whether the text turns this server off in the tool. Throws when the text isn't the tool's format. */
export function mcpDisabled(tool: HarnessId, text: string, name: string): boolean {
  switch (tool) {
    case 'claude-cli': return list(parseJson(text).deniedMcpServers).some(entry => deniesByName(entry, name));
    case 'copilot-cli': return list(parseJson(text).disabledMcpServers).includes(name);
    case 'codex-cli': return codexTable(text, name)?.entries.find(entry => entry.key === 'enabled')?.value === false;
    case 'pi-cli': {
      const servers = parseJson(text).mcpServers;
      const entry = servers && typeof servers === 'object' ? (servers as Record<string, unknown>)[name] : undefined;
      return !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).enabled === false;
    }
  }
}

/** The text with this server turned on or off in the tool. Only the switch changes; every other byte stays. */
export function withMcpSwitch(tool: HarnessId, text: string, name: string, disabled: boolean): string {
  if (mcpDisabled(tool, text, name) === disabled) return text;
  switch (tool) {
    case 'claude-cli': {
      const others = list(parseJson(text).deniedMcpServers).filter(entry => !deniesByName(entry, name));
      return setJsonMember(text, ['deniedMcpServers'], disabled ? [...others, { serverName: name }] : others.length ? others : undefined);
    }
    case 'copilot-cli': {
      const others = list(parseJson(text).disabledMcpServers).filter(entry => entry !== name);
      return setJsonMember(text, ['disabledMcpServers'], disabled ? [...others, name] : others.length ? others : undefined);
    }
    case 'codex-cli': {
      const table = codexTable(text, name);
      if (!table) throw new Error(`Codex has no [mcp_servers.${name}] table to switch.`);
      const line = table.entries.find(entry => entry.key === 'enabled');
      // An `enabled = …` line is replaced (or, to turn on, removed); otherwise one goes right after the table's last key.
      if (line) return `${text.slice(0, line.start)}${disabled ? 'enabled = false\n' : ''}${text.slice(line.end)}`;
      const at = table.entries.at(-1)?.end ?? (text.indexOf('\n', table.start) + 1 || text.length);
      const before = text.slice(0, at);
      return `${before}${before.endsWith('\n') ? '' : '\n'}enabled = false\n${text.slice(at)}`;
    }
    case 'pi-cli': return setJsonMember(text, ['mcpServers', name, 'enabled'], disabled ? false : undefined);
  }
}
