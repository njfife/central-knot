// An agent as each harness's own file holds it: Claude Code Markdown, Copilot `.agent.md`, Codex TOML, OpenCode Markdown
// (AGT-01), and in Pi, which has no agents, the same Markdown as a skill in its skills folder (`suffixes`, below). This module
// reads those files and writes them; what is synced, and when, is agents.ts.
// An agent has two parts. The shared part is its name, description and prompt: every harness can hold it, and `agentHash`
// names it. Its own part is everything else in one harness's file (tools, model, hooks, Codex keys and tables, comments):
// no equivalent is recorded across harnesses, so it stays in that harness's file. `agentText` writes the shared part into a
// file and leaves every other byte of it as it was.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import type { LibraryItem } from './library.ts';
import { agentTools, agentsKeptIn, type AgentTool } from './presence.ts';
import { errorCode, itemKey, sha256, type ShareContext } from './share.ts';
import { readTomlTables, tomlValue } from './textedit.ts';
import type { HarnessId } from './types.ts';

export const isAgentTool = (tool: HarnessId): tool is AgentTool => agentTools.some(agentTool => agentTool === tool);

/** The shared part of an agent: what every harness holds, and what a version in Central Knot's library is. */
export interface SharedAgent { name: string; description: string; prompt: string }
export type SharedField = keyof SharedAgent;
/** Which of the shared part's fields differ between two versions: a version's note (library.ts VersionChange) names them. */
export const changedFields = (before: SharedAgent, after: SharedAgent): SharedField[] =>
  (['name', 'description', 'prompt'] as const).filter(field => before[field].replace(/\s+$/, '') !== after[field].replace(/\s+$/, ''));
/** One agent as read from a harness's file: its shared part, and `fields`, the own part's settings by name. */
export interface NeutralAgent extends SharedAgent { fields: Record<string, unknown> }
/**
 * One harness's file for an agent. `name` is the file's base name; `key` matches it across harnesses, ignoring case as macOS
 * does. `hash` names the shared part (agentHash), `bytes` the whole file; `at` is when the file was last changed (ms).
 */
export interface AgentEntry { name: string; key: string; tool: AgentTool; file: string; text: string; agent: NeutralAgent; hash: string; bytes: string; at: number }

/**
 * Where each tool keeps an agent: one file, its name the agent's and then this suffix, in its folder (agentsFolder: its own
 * agents folder, or Pi's skills folder: presence.ts agentsKeptIn). A skills folder is the person's too, and the skills kind
 * reads only the folders in it (skillfiles.ts): a loose file there is an agent's copy only when the agents record says Central
 * Knot applied that agent there (appliedThere). Every other one is the person's own skill, never read; readAgents names it
 * (`skills`), and it holds the agent out of that tool as a skill of its name does (agents.ts agentHeld). The name is written
 * exactly as the agent's, since it is part of the shared hash; Pi loads the file under it, capitals and spaces too, with a
 * warning (measured on 1.5.0).
 */
const suffixes: Record<AgentTool, string> = { 'claude-cli': '.md', 'copilot-cli': '.agent.md', 'codex-cli': '.toml', 'pi-cli': '.md', 'opencode-cli': '.md' };
/** A harness's folder for agents in this home: its agents folder, or its skills folder where it keeps agents as skills. */
export const agentsFolder = (context: ShareContext, tool: AgentTool) => (agentsKeptIn[tool] === 'skills folder'
  ? writeRoot(harnesses[tool], context.home, context.overrides?.[tool])
  : join(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), 'agents'));
export const fileFor = (context: ShareContext, tool: AgentTool, name: string) => join(agentsFolder(context, tool), `${name}${suffixes[tool]}`);
/**
 * Why an agent's name can't become a file name in a harness, in a few words ("é", "starts with “.”"); none when it can.
 * Agent names become file names: letters, digits, dot, dash, underscore and space only, no separators, no dot-files.
 */
export function nameProblem(name: string): string | undefined {
  const others = [...new Set(name.replace(/[A-Za-z0-9._ -]/g, ''))];
  if (others.length) return others.slice(0, 3).join(' ');
  if (!/^[A-Za-z0-9]/.test(name)) return `starts with “${name[0] ?? ''}”`;
  if (name.length > 128) return 'longer than 128 characters';
  return name.includes('..') ? 'has “..”' : undefined;
}
export const safeName = (name: string) => !nameProblem(name);
/** Whether a name is one file's name at all: no path in it. A name that is not is written nowhere, whatever else is on record. */
export const oneFileName = (name: string) => !/[\\/\0]/.test(name) && name !== '.' && name !== '..';

/** The shared part's identity: a harness's own fields never make two copies differ. */
export const agentHash = (agent: SharedAgent) => sha256(JSON.stringify([agent.name, agent.description, agent.prompt.replace(/\s+$/, '')]));

/** Frontmatter: `---` on its own first line, then up to the next line that is `---` (at a line start, as Claude Code reads it). */
const FRONT = /^(﻿?---\r?\n)((?:[^\n]*\n)*?)(---[ \t]*(?:\r?\n|$))([\s\S]*)$/;

/**
 * A Markdown file's front matter: none (`none`: its first line is not `---`), its fields and the text after it, or why it is
 * there and can't be read as fields (`broken`: no closing `---`, YAML that doesn't parse, or a value that is no mapping).
 */
export function frontMatter(text: string): { fields: Record<string, unknown>; rest: string } | 'none' | { broken: string } {
  if (!/^﻿?---\r?\n/.test(text)) return 'none';
  const match = FRONT.exec(text);
  if (!match) return { broken: 'its front matter has no closing ---' };
  // Its last newline is part of a `|+` value that ends the front matter: setFrontLines writes it so.
  const document = parseDocument(match[2]);
  if (document.errors.length) return { broken: document.errors[0].message.split('\n')[0].replace(/[.:]$/, '') };
  let fields: Record<string, unknown>;
  try { fields = (document.toJS() ?? {}) as Record<string, unknown>; } catch (error) { return { broken: (error as Error).message.split('\n')[0] }; }
  if (typeof fields !== 'object' || Array.isArray(fields)) return { broken: 'its front matter is no list of fields' };
  return { fields, rest: match[4] };
}

export function fromMarkdown(name: string, text: string): NeutralAgent | undefined {
  const read = frontMatter(text);
  if (read === 'none' || 'broken' in read) return undefined;
  const { name: named, description, ...fields } = read.fields;
  const prompt = read.rest.replace(/^\r?\n/, '');
  return { name: typeof named === 'string' && named ? named : name, description: typeof description === 'string' ? description : '', prompt, fields };
}

function fromToml(name: string, text: string): NeutralAgent | undefined {
  const tables = readTomlTables(text);
  const root = tables[0];
  const value = (key: string) => { const found = root.entries.find(entry => entry.key === key)?.value; return typeof found === 'string' ? found : undefined; };
  // No prompt: an empty file, or one cut off mid-save. Not an agent (yet), so it is held, never read as an edit that empties the others.
  if (value('developer_instructions') === undefined) return undefined;
  const own = root.entries.filter(entry => !['name', 'description', 'developer_instructions'].includes(entry.key));
  const fields: Record<string, unknown> = Object.fromEntries(own.map(entry => [entry.key, entry.value]));
  for (const table of tables.slice(1)) fields[table.array ? `[[${table.path.join('.')}]]` : `[${table.path.join('.')}]`] = true;
  return { name: value('name') || name, description: value('description') ?? '', prompt: value('developer_instructions') ?? '', fields };
}

/** One harness's file text as an agent; undefined when it can't be read as one (an empty or half-saved file, say). */
export function parseAgent(tool: AgentTool, name: string, text: string): NeutralAgent | undefined {
  try { return tool === 'codex-cli' ? fromToml(name, text) : fromMarkdown(name, text); } catch { return undefined; }
}

/**
 * One harness's agents as read: `unreadable` has each file that is there but can't be read as an agent, by key (`*`: the
 * whole folder); `skills`, in a skills folder, the key of each loose file there that is no agent's copy: the person's own skill.
 */
export interface AgentsRead { entries: AgentEntry[]; problems: string[]; unreadable: Map<string, string>; skills: Set<string> }

/** Whether the agents record says Central Knot applied this agent in the tool (LibraryItem applied), live or deleted. */
const appliedThere = (record: Record<string, LibraryItem>, key: string, tool: AgentTool) =>
  Object.hasOwn(record, key) && record[key].applied[tool] !== undefined;

/**
 * Reads one tool's agents. A file that cannot be read as an agent is reported in `unreadable` and never written or deleted.
 * In a skills folder only the agents `record` (its items) says were applied there are read (`suffixes`, above).
 */
export async function readAgents(context: ShareContext, tool: AgentTool, record: Record<string, LibraryItem> = {}): Promise<AgentsRead> {
  const entries: AgentEntry[] = [];
  const problems: string[] = [];
  const unreadable = new Map<string, string>(), skills = new Set<string>();
  let names: string[];
  try { names = await readdir(agentsFolder(context, tool)); }
  catch (error) {
    const gone = errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR';
    // A folder that is there but can't be listed is not absent: its agents are all treated as unreadable (held, never deleted).
    if (!gone) { problems.push(`${agentsFolder(context, tool)} could not be read.`); unreadable.set('*', agentsFolder(context, tool)); }
    return { entries, problems, unreadable, skills };
  }
  const suffix = suffixes[tool];
  for (const file of names.filter(entry => entry.endsWith(suffix) && !entry.startsWith('.') && !entry.includes('.ck-'))) {
    const name = file.slice(0, -suffix.length);
    if (agentsKeptIn[tool] === 'skills folder' && !appliedThere(record, itemKey(name), tool)) { skills.add(itemKey(name)); continue; }
    const path = join(agentsFolder(context, tool), file);
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch { problems.push(`${path} could not be read.`); unreadable.set(itemKey(name), path); continue; }
    const agent = parseAgent(tool, name, text);
    if (!agent) { problems.push(`${path} could not be read as an agent, so it is left alone.`); unreadable.set(itemKey(name), path); continue; }
    const at = await stat(path).then(info => info.mtimeMs, () => 0);
    entries.push({ name, key: itemKey(name), tool, file: path, text, agent, hash: agentHash(agent), bytes: sha256(text), at });
  }
  return { entries, problems, unreadable, skills };
}

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)/;
/** A TOML string for a prompt: a multi-line basic string when it can be one, else a one-line basic string. */
function tomlPrompt(prompt: string) {
  if (CONTROL.test(prompt)) return tomlValue(prompt);
  const body = prompt.replace(/\\/g, '\\\\').replace(/"(?="")/g, '\\"');
  return `"""\n${body}${body.endsWith('\n') ? '' : '\n'}"""`;
}
/** One `key: value` entry of front matter, a value of several lines as a block indented under its key. */
const yamlEntry = (key: string, value: string) => stringifyYaml({ [key]: value }, { lineWidth: 0 }).replace(/\n$/, '');

/**
 * A `key:` line whose value is a block that keeps its trailing blank lines (`|+`, `>+`, the value's first characters): those
 * lines are its value, not separators. A quoted value that only contains `|+` is no such block.
 */
const keepsBlanks = (line: string | undefined) => /^[^:]*:\s*[|>](?:[1-9]?\+|\+[1-9])\s*(?:#.*)?$/.test(line ?? '');
/**
 * Replaces top-level `key:` lines (with their indented continuation) in YAML frontmatter, or adds them first. Other lines stay
 * byte for byte. Blank lines after an entry are separators the person left, kept, unless the old or the new value is a `|+`
 * block: then they are (or would become) its value, so they go with it, and the value reads back exactly as written.
 */
function setFrontLines(front: string, values: [string, string][]): string {
  const newline = front.includes('\r\n') ? '\r\n' : '\n';
  let lines = front.length ? front.split(/\r?\n/) : [];
  const missing: string[] = [];
  for (const [key, value] of values) {
    const line = yamlEntry(key, value).split('\n');
    const at = lines.findIndex(candidate => new RegExp(`^(["']?)${key}\\1\\s*:`).test(candidate));
    if (at < 0) { missing.push(...line); continue; }
    let end = at + 1;
    while (end < lines.length && (/^\s+\S/.test(lines[end]) || (lines[end].trim() === '' && end + 1 < lines.length && /^\s+\S/.test(lines[end + 1])))) end++;
    if (keepsBlanks(lines[at]) || keepsBlanks(line[0])) while (end < lines.length && lines[end].trim() === '') end++;
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
    const lines: Record<string, string> = {
      name: `name = ${tomlValue(agent.name)}\n`,
      description: `description = ${tomlValue(agent.description)}\n`,
      developer_instructions: `developer_instructions = ${tomlPrompt(agent.prompt)}\n`,
    };
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
  const mode = tool === 'opencode-cli' ? 'mode: all\n' : '';
  if (!match) return `---\n${yamlEntry('name', agent.name)}\n${yamlEntry('description', agent.description)}\n${mode}---\n\n${agent.prompt}`;
  const newline = match[1].endsWith('\r\n') ? '\r\n' : '\n';
  const front = setFrontLines(match[2].replace(/\r?\n$/, ''), [['name', agent.name], ['description', agent.description]]);
  const gap = /^\r?\n/.exec(match[4])?.[0] ?? '\n';
  return `${match[1]}${front}${newline}${match[3]}${gap}${agent.prompt}`;
}
