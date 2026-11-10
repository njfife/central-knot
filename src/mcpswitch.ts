// Turning an MCP server off in one tool with that tool's own switch, as profiles do. The server's entry stays where it is; the tool
// just doesn't start it. Each switch was exercised in a throwaway home on 2026-11-09 (notes: ck-feedback/profiles/evidence.md):
//   Claude Code  settings.json  "deniedMcpServers": [{ "serverName": "<name>" }]   (2.1.321: the server leaves `claude mcp list`)
//   Copilot CLI  settings.json  "disabledMcpServers": ["<name>"]                    (what `copilot mcp disable` writes on 1.0.107)
//   Codex        config.toml    [mcp_servers.<name>] enabled = false                (0.142.3: `codex mcp list` shows it disabled)
//   Pi           mcp.json       "mcpServers": { "<name>": { "enabled": false } }    (1.5.0: `pi mcp list` shows it disabled)
// Claude Code's ~/.claude.json is never touched: its switch lives in settings.json, which Claude Code does not rewrite while it runs.
import { readFile } from 'node:fs/promises';
import { mcpFile } from './mcp.ts';
import { errorCode, type ShareContext } from './share.ts';
import { switchPath, type SwitchFile } from './skillswitch.ts';
import { readTomlTables, setJsonMember } from './textedit.ts';
import { record, withoutBom } from './values.ts';
import type { HarnessId, SkillFacts } from './types.ts';

/**
 * The file that holds a tool's MCP switches: Claude Code's and Copilot's settings.json (beside their skill switches), Codex's
 * config.toml (beside its skill switches, and its servers) and Pi's mcp.json (each server's own entry).
 */
export function mcpSwitchPath(context: ShareContext, tool: HarnessId): string {
  return tool === 'pi-cli' ? mcpFile(context, tool) : switchPath(context, tool);
}

/** A settings file's JSON object ({} for an empty file). Throws when it is not one. */
const jsonOf = (text: string): Record<string, unknown> => {
  if (!text.trim()) return {};
  const json = record(JSON.parse(withoutBom(text)));
  if (!json) throw new Error('Not a JSON object.');
  return json;
};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** One tool's MCP switch file as read ('' when there is none yet), or why it can't be used: never written then. */
async function readMcpSwitchFile(context: ShareContext, tool: HarnessId): Promise<SwitchFile> {
  const path = mcpSwitchPath(context, tool);
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    return errorCode(error) === 'ENOENT' ? { tool, path, text: '', exists: false } : { tool, path, text: '', exists: true, problem: { file: path, reason: 'can’t be read.' } };
  }
  // A server named '' is asked about only to see whether the file parses as the tool's form.
  try { mcpDisabled(tool, text, ''); return { tool, path, text, exists: true }; }
  catch { return { tool, path, text, exists: true, problem: { file: path, reason: `isn’t valid ${tool === 'codex-cli' ? 'TOML' : 'JSON'}.` } }; }
}

/** Each tool's MCP switch file as read, or why it can't be used. */
export async function readMcpSwitches(context: ShareContext, tools: HarnessId[]): Promise<Map<HarnessId, SwitchFile>> {
  return new Map(await Promise.all(tools.map(async tool => [tool, await readMcpSwitchFile(context, tool)] as const)));
}

/** What a server's facts say about its tools' switches: the tools that have it off, and the tools whose file can't be used. */
export function mcpSwitchFacts(name: string, tools: HarnessId[], switches: Map<HarnessId, SwitchFile>): Pick<SkillFacts, 'disabled' | 'switchProblem'> {
  const facts: Pick<SkillFacts, 'disabled' | 'switchProblem'> = {};
  for (const tool of tools) {
    const file = switches.get(tool);
    if (!file) continue;
    if (file.problem) (facts.switchProblem ??= {})[tool] = file.problem;
    else if (mcpDisabled(tool, file.text, name)) (facts.disabled ??= []).push(tool);
  }
  return facts;
}

const deniesByName = (entry: unknown, name: string) => record(entry)?.serverName === name;

/** Pi: the server's own entry in mcp.json's `mcpServers`, if it is there as an object. */
const piEntry = (text: string, name: string) => record(record(jsonOf(text).mcpServers)?.[name]);

/** Codex: the server's own `[mcp_servers.<name>]` table, if it has one. */
const codexTable = (text: string, name: string) => readTomlTables(text).find(table => !table.array && table.path.length === 2 && table.path[0] === 'mcp_servers' && table.path[1] === name);

/** Whether the text turns this server off in the tool. Throws when the text isn't the tool's format. */
export function mcpDisabled(tool: HarnessId, text: string, name: string): boolean {
  switch (tool) {
    case 'claude-cli': return list(jsonOf(text).deniedMcpServers).some(entry => deniesByName(entry, name));
    case 'copilot-cli': return list(jsonOf(text).disabledMcpServers).includes(name);
    case 'codex-cli': return codexTable(text, name)?.entries.find(entry => entry.key === 'enabled')?.value === false;
    case 'pi-cli': return piEntry(text, name)?.enabled === false;
  }
}

/**
 * The text with this server turned on or off in the tool. Only the switch changes; every other byte stays, except that an explicit
 * Codex `enabled` line (with any comment on it) is replaced by `enabled = false`, or removed to turn the server on: on is the default.
 */
export function withMcpSwitch(tool: HarnessId, text: string, name: string, disabled: boolean): string {
  if (mcpDisabled(tool, text, name) === disabled) return text;
  switch (tool) {
    case 'claude-cli': {
      const others = list(jsonOf(text).deniedMcpServers).filter(entry => !deniesByName(entry, name));
      return setJsonMember(text, ['deniedMcpServers'], disabled ? [...others, { serverName: name }] : others.length ? others : undefined);
    }
    case 'copilot-cli': {
      const others = list(jsonOf(text).disabledMcpServers).filter(entry => entry !== name);
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
    case 'pi-cli': {
      // Only an entry that is there is switched: one removed meanwhile is never made again as a bare switch.
      if (!piEntry(text, name)) throw new Error(`Pi has no "${name}" server to switch.`);
      return setJsonMember(text, ['mcpServers', name, 'enabled'], disabled ? false : undefined);
    }
  }
}
