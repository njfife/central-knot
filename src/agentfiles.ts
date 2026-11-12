// An agent as each harness's own file holds it: Claude Code Markdown, Copilot `.agent.md`, Codex TOML, OpenCode Markdown
// (AGT-01). This module reads those files and writes them; what is synced, and when, is agents.ts.
// An agent has two parts. The shared part is its name, description and prompt: every harness can hold it, and `agentHash`
// names it. Its own part is everything else in one harness's file (tools, model, hooks, Codex keys and tables, comments):
// no equivalent is recorded across harnesses, so it stays in that harness's file. `agentText` writes the shared part into a
// file and leaves every other byte of it as it was.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { configRoot, harnesses } from './harnesses.ts';
import { agentTools, type AgentTool } from './presence.ts';
import { errorCode, sha256, type ShareContext } from './share.ts';
import { readTomlTables, tomlValue } from './textedit.ts';
import type { HarnessId } from './types.ts';

export const isAgentTool = (tool: HarnessId): tool is AgentTool => agentTools.some(agentTool => agentTool === tool);

/** The shared part of an agent: what every harness holds, and what a version in Central Knot's library is. */
export interface SharedAgent { name: string; description: string; prompt: string }
/** One agent as read from a harness's file: its shared part, and `fields`, the own part's settings by name. */
export interface NeutralAgent extends SharedAgent { fields: Record<string, unknown> }
/**
 * One harness's file for an agent. `name` is the file's base name; `key` matches it across harnesses, ignoring case as macOS
 * does. `hash` names the shared part (agentHash), `bytes` the whole file; `at` is when the file was last changed (ms).
 */
export interface AgentEntry { name: string; key: string; tool: AgentTool; file: string; text: string; agent: NeutralAgent; hash: string; bytes: string; at: number }

const suffixes: Record<AgentTool, string> = { 'claude-cli': '.md', 'copilot-cli': '.agent.md', 'codex-cli': '.toml', 'opencode-cli': '.md' };
/** A harness's agents folder in this home. */
export const agentsFolder = (context: ShareContext, tool: HarnessId) => join(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), 'agents');
export const fileFor = (context: ShareContext, tool: AgentTool, name: string) => join(agentsFolder(context, tool), `${name}${suffixes[tool]}`);
export const keyOf = (name: string) => name.normalize('NFC').toLowerCase();
/** Agent names become file names: no separators, no dot-files. */
export const safeName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name) && !name.includes('..');

/** The shared part's identity: a harness's own fields never make two copies differ. */
export const agentHash = (agent: SharedAgent) => sha256(JSON.stringify([agent.name, agent.description, agent.prompt.replace(/\s+$/, '')]));

/** Frontmatter: `---` on its own first line, then up to the next line that is `---` (at a line start, as Claude Code reads it). */
const FRONT = /^(﻿?---\r?\n)((?:[^\n]*\n)*?)(---[ \t]*(?:\r?\n|$))([\s\S]*)$/;

export function fromMarkdown(name: string, text: string): NeutralAgent | undefined {
  const match = FRONT.exec(text);
  if (!match) return undefined;
  const document = parseDocument(match[2].replace(/\r?\n$/, ''));
  if (document.errors.length) return undefined;
  const front = (document.toJS() ?? {}) as Record<string, unknown>;
  if (typeof front !== 'object' || Array.isArray(front)) return undefined;
  const { name: named, description, ...fields } = front;
  return { name: typeof named === 'string' && named ? named : name, description: typeof description === 'string' ? description : '', prompt: match[4].replace(/^\r?\n/, ''), fields };
}

function fromToml(name: string, text: string): NeutralAgent | undefined {
  const tables = readTomlTables(text);
  const root = tables[0];
  const value = (key: string) => { const found = root.entries.find(entry => entry.key === key)?.value; return typeof found === 'string' ? found : undefined; };
  // No prompt: an empty file, or one cut off mid-save. Not an agent (yet), so it is held, never read as an edit that empties the others.
  if (value('developer_instructions') === undefined) return undefined;
  const fields: Record<string, unknown> = Object.fromEntries(root.entries.filter(entry => !['name', 'description', 'developer_instructions'].includes(entry.key)).map(entry => [entry.key, entry.value]));
  for (const table of tables.slice(1)) fields[table.array ? `[[${table.path.join('.')}]]` : `[${table.path.join('.')}]`] = true;
  return { name: value('name') || name, description: value('description') ?? '', prompt: value('developer_instructions') ?? '', fields };
}

/** One harness's file text as an agent; undefined when it can't be read as one (an empty or half-saved file, say). */
export function parseAgent(tool: AgentTool, name: string, text: string): NeutralAgent | undefined {
  try { return tool === 'codex-cli' ? fromToml(name, text) : fromMarkdown(name, text); } catch { return undefined; }
}

/** Reads one tool's agents. A file that cannot be read as an agent is reported in `unreadable` and never written or deleted. */
export async function readAgents(context: ShareContext, tool: AgentTool): Promise<{ entries: AgentEntry[]; problems: string[]; unreadable: Map<string, string>; folderExists: boolean }> {
  const entries: AgentEntry[] = [];
  const problems: string[] = [];
  const unreadable = new Map<string, string>();
  let names: string[];
  try { names = await readdir(agentsFolder(context, tool)); }
  catch (error) {
    const gone = errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR';
    // A folder that is there but can't be listed is not absent: its agents are all treated as unreadable (held, never deleted).
    if (!gone) { problems.push(`${agentsFolder(context, tool)} could not be read.`); unreadable.set('*', agentsFolder(context, tool)); }
    return { entries, problems, unreadable, folderExists: !gone };
  }
  const suffix = suffixes[tool];
  for (const file of names.filter(entry => entry.endsWith(suffix) && !entry.startsWith('.') && !entry.includes('.ck-'))) {
    const name = file.slice(0, -suffix.length);
    const path = join(agentsFolder(context, tool), file);
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch { problems.push(`${path} could not be read.`); unreadable.set(keyOf(name), path); continue; }
    const agent = parseAgent(tool, name, text);
    if (!agent) { problems.push(`${path} could not be read as an agent, so it is left alone.`); unreadable.set(keyOf(name), path); continue; }
    const at = await stat(path).then(info => info.mtimeMs, () => 0);
    entries.push({ name, key: keyOf(name), tool, file: path, text, agent, hash: agentHash(agent), bytes: sha256(text), at });
  }
  return { entries, problems, unreadable, folderExists: true };
}

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)/;
/** A TOML string for a prompt: a multi-line basic string when it can be one, else a one-line basic string. */
function tomlPrompt(prompt: string) {
  if (CONTROL.test(prompt)) return tomlValue(prompt);
  const body = prompt.replace(/\\/g, '\\\\').replace(/"(?="")/g, '\\"');
  return `"""\n${body}${body.endsWith('\n') ? '' : '\n'}"""`;
}
const yamlScalar = (value: string) => stringifyYaml(value, { lineWidth: 0 }).replace(/\n$/, '');

/** Replaces top-level `key:` lines (with their indented continuation) in YAML frontmatter, or adds them first. Other lines stay byte for byte. */
function setFrontLines(front: string, values: [string, string][]): string {
  const newline = front.includes('\r\n') ? '\r\n' : '\n';
  let lines = front.length ? front.split(/\r?\n/) : [];
  const missing: string[] = [];
  for (const [key, value] of values) {
    const line = `${key}: ${yamlScalar(value)}`.split('\n');
    const at = lines.findIndex(candidate => new RegExp(`^(["']?)${key}\\1\\s*:`).test(candidate));
    if (at < 0) { missing.push(...line); continue; }
    let end = at + 1;
    while (end < lines.length && (/^\s+\S/.test(lines[end]) || (lines[end].trim() === '' && end + 1 < lines.length && /^\s+\S/.test(lines[end + 1])))) end++;
    lines = [...lines.slice(0, at), ...line, ...lines.slice(end)];
  }
  return [...missing, ...lines].join(newline);
}

/**
 * The file text for an agent at a harness. With `existing` (that harness's file, as it is or as the library kept it), only the
 * name, description and prompt change, at their own positions; every other field, comment and table stays as written.
 */
export function agentText(tool: HarnessId, agent: SharedAgent, existing?: string): string {
  if (tool === 'codex-cli') {
    const lines: Record<string, string> = { name: `name = ${tomlValue(agent.name)}\n`, description: `description = ${tomlValue(agent.description)}\n`, developer_instructions: `developer_instructions = ${tomlPrompt(agent.prompt)}\n` };
    const keys = Object.keys(lines);
    if (!existing) return keys.map(key => lines[key]).join('');
    const root = readTomlTables(existing)[0];
    let text = existing;
    // By position, last first, so earlier offsets stay right; never by searching for text that may also sit inside the prompt.
    for (const entry of root.entries.filter(candidate => keys.includes(candidate.key)).sort((first, second) => second.start - first.start)) {
      text = text.slice(0, entry.start) + lines[entry.key] + text.slice(entry.end);
    }
    const missing = keys.filter(key => !root.entries.some(entry => entry.key === key)).map(key => lines[key]).join('');
    return missing + text;
  }
  const match = existing ? FRONT.exec(existing) : undefined;
  // A new OpenCode agent says `mode: all`: with no mode, 1.19.5 offers it both to choose and to hand work to, while 2.2.5
  // makes it one to choose only (measured), and an agent from another tool is one work is handed to there.
  if (!match) return `---\nname: ${yamlScalar(agent.name)}\ndescription: ${yamlScalar(agent.description)}\n${tool === 'opencode-cli' ? 'mode: all\n' : ''}---\n\n${agent.prompt}`;
  const newline = match[1].endsWith('\r\n') ? '\r\n' : '\n';
  const front = setFrontLines(match[2].replace(/\r?\n$/, ''), [['name', agent.name], ['description', agent.description]]);
  const gap = /^\r?\n/.exec(match[4])?.[0] ?? '\n';
  return `${match[1]}${front}${newline}${match[3]}${gap}${agent.prompt}`;
}
