// MCP sign-in (MAP.md, "MCP sign-in"): what each tool's own command says of its MCP servers, read and put in words. Here: the
// command each tool reports with (listCommand; Copilot CLI has none), one reader per tool turning what it printed into what it
// said of each server (readAnswer), a cell's words (cellWords) and its column's note (columnNote), the page's rows and cells from
// the view the Library already has (signinRows), and each tool's own sign-in command (signInCommand). Pure, for the page and
// main alike. Elsewhere: the run, in main (mcpsigninrun.ts checkSignin); the page and its clicks (mcpsigninpage.ts); its state
// (app.ts state.mcpSignin); the shapes (types.ts SigninAnswer, SigninSaid).
// Only what a tool's command prints is read: Central Knot reads, keeps and shows no token, credential file, cache or keychain
// entry, and starts no sign-in. The words each tool prints were measured on 2026-11-21 against stand-in servers in throwaway homes
// (tests/mcpsignin/: Claude Code 2.1.330, Codex 0.169.1 and 0.171.0, Pi 1.6.0, OpenCode 1.19.6).
import { claudeServerName } from './pluginstatus.ts';
import { offIn, pageRows, pluginTools } from './pluginrows.ts';
import { record } from './values.ts';
import { commandLine, toolNames } from './words.ts';
import type { HarnessId, HomeView, LibraryFacts, SigninAnswer, SigninSaid } from './types.ts';

/** The command each tool reports its MCP servers' state with; Copilot CLI's list and get give its configuration only. */
export const listCommand: Partial<Record<HarnessId, string[]>> = {
  'claude-cli': ['mcp', 'list'], 'codex-cli': ['mcp', 'list', '--json'], 'pi-cli': ['mcp', 'list', '--json'], 'opencode-cli': ['mcp', 'list'],
};
/** How long one check may take before it is stopped: Pi and OpenCode wait 60 s for a server that never answers. */
export const CHECK_LIMIT_MS = 70_000;

// ---------- Each tool's answer ----------

type Servers = Record<string, SigninSaid>;
const lines = (text: string) => text.replace(/\r/g, '').split('\n');
const json = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

// `<name>: <what it runs> - ✔ Connected`, `… - ! Needs authentication`, `… - ✘ Failed to connect — <why>`, after a line saying it
// is checking; with no servers, "No MCP servers configured". A server its own switch turns off isn't listed.
const CLAUDE_LINE = /^(.+?): .* - (✔ Connected|! Needs authentication|✘ (?:Failed to connect(?: — )?)?(.*))$/;
function fromClaude(stdout: string): Servers | undefined {
  const servers: Servers = {};
  for (const line of lines(stdout)) {
    const found = CLAUDE_LINE.exec(line);
    if (found) servers[found[1]] = found[2].startsWith('✔') ? { is: 'connected' } : found[2].startsWith('!') ? { is: 'needs-sign-in' } : { is: 'unreachable', why: found[3] || 'Failed to connect' };
  }
  return Object.keys(servers).length || stdout.includes('No MCP servers configured') ? servers : undefined;
}

// A list of `{ name, auth_status, … }`.
const CODEX: Record<string, Exclude<SigninSaid['is'], 'unreachable'>> = { unsupported: 'no-sign-in', o_auth: 'signed-in', bearer_token: 'signed-in', not_logged_in: 'needs-sign-in', unknown: 'not-known' };
function fromCodex(stdout: string): Servers | undefined {
  const list = json(stdout), servers: Servers = {};
  if (!Array.isArray(list)) return undefined;
  for (const entry of list.map(record)) {
    const is = typeof entry?.auth_status === 'string' ? CODEX[entry.auth_status] : undefined;
    if (typeof entry?.name !== 'string' || !is) return undefined;
    servers[entry.name] = { is };
  }
  return servers;
}

// `{ servers: [{ name, enabled, state, error }] }`, exit code 1 when any failed. One its own switch turns off (`"enabled": false`) is
// left out whatever its state says: the page says Off for it from the Library's own mark.
function fromPi(stdout: string): Servers | undefined {
  const list = record(json(stdout))?.servers, servers: Servers = {};
  if (!Array.isArray(list)) return undefined;
  for (const entry of list.map(record)) {
    if (typeof entry?.name !== 'string') return undefined;
    if (entry.enabled === false) continue;
    if (entry.state === 'connected') servers[entry.name] = { is: 'connected' };
    else if (entry.state === 'needs-auth') servers[entry.name] = { is: 'needs-sign-in' };
    else if (entry.state === 'failed') servers[entry.name] = { is: 'unreachable', why: typeof entry.error === 'string' && entry.error ? entry.error : 'failed' };
    else return undefined;
  }
  return servers;
}

// Under the heading "MCP Servers", in colour: `●  ✓ <name> connected`, `●  ⚠ <name> needs authentication`, `●  ✗ <name> failed`
// with its reason on the line under it, then what it runs. Any other line is not a server's state.
const OPENCODE_LINE = /^●\s+\S+\s+(.+?)\s+(connected|needs authentication|failed)$/;
function fromOpenCode(stdout: string): Servers | undefined {
  const text = lines(stdout.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')).map(line => line.trim()), servers: Servers = {};
  if (!text.some(line => line.endsWith('MCP Servers'))) return undefined;
  text.forEach((line, at) => {
    const [, name, state] = OPENCODE_LINE.exec(line) ?? [];
    const under = text[at + 1]?.startsWith('│') ? text[at + 1].slice(1).trim() : '';
    if (state === 'connected') servers[name] = { is: 'connected' };
    else if (state === 'needs authentication') servers[name] = { is: 'needs-sign-in' };
    else if (state === 'failed') servers[name] = { is: 'unreachable', why: under || 'failed' };
  });
  return servers;
}

const readers: Partial<Record<HarnessId, (stdout: string) => Servers | undefined>> = { 'claude-cli': fromClaude, 'codex-cli': fromCodex, 'pi-cli': fromPi, 'opencode-cli': fromOpenCode };
/** The first line a tool printed, cut at a word past 200 characters. */
function firstLine(text: string): string | undefined {
  const line = lines(text).map(each => each.trim()).find(Boolean);
  if (!line || line.length <= 200) return line;
  const cut = line.lastIndexOf(' ', 200);
  return `${line.slice(0, cut > 100 ? cut : 200)}…`;
}

/** What a tool's command said, read from what it printed on its standard output; one in a shape not known keeps the first line it printed (`output`: both streams). */
export function readAnswer(tool: HarnessId, stdout: string, output: string): SigninAnswer {
  const servers = readers[tool]?.(stdout);
  return servers ? { servers } : { unreadable: firstLine(stdout) ?? firstLine(output) ?? '' };
}

// ---------- The page's rows ----------

/** One tool's cell: the tool's own name for the server there (none: its list doesn't name it), and whether that tool has it switched off. */
export interface SigninCell { name?: string; off: boolean }
/** One server: a Library row of the person's own (its key) or of a plugin (the plugin's row key, and the plugin), with a cell for each managed tool that has it. */
export interface SigninRow { id: string; name: string; plugin?: string; cells: Partial<Record<HarnessId, SigninCell>> }

/** A plugin's server in a tool: Claude Code's list names it `plugin:<plugin>:<server>`; Codex's doesn't name a plugin's server (0.169.1, 0.171.0). */
const pluginCell = (tool: HarnessId, plugin: string, server: string, off: boolean): SigninCell => (tool === 'claude-cli' ? { name: claudeServerName(plugin, server), off } : { off });

/** A row of the person's own in one tool: its own copy there by the copy's name, or the plugin it has it through there. */
function ownCell(fact: LibraryFacts, tool: HarnessId): SigninCell | undefined {
  const copy = fact.copies[tool], given = fact.plugin?.[tool];
  if (copy) return { name: copy.folder, off: !!fact.switchedOff?.includes(tool) };
  return given ? pluginCell(tool, given.plugin, given.name ?? fact.name, !!given.off) : undefined;
}

/** The MCP servers some managed tool has, as the Library lists them (its own rows, then plugins'), by name. */
export function signinRows(home: HomeView): SigninRow[] {
  const tools = home.mcp.tools, cells = (made: (tool: HarnessId) => SigninCell | undefined) => Object.fromEntries(tools.flatMap(tool => { const cell = made(tool); return cell ? [[tool, cell]] : []; }));
  const own = home.mcp.items.map(fact => ({ id: fact.key, name: fact.name, cells: cells(tool => ownCell(fact, tool)) }));
  const plugins = pageRows(home, 'mcp').rows.map(row => ({ id: row.key, name: row.name, plugin: row.plugin,
    cells: cells(tool => (pluginTools(row).includes(tool) ? pluginCell(tool, row.plugin, row.copies[tool]!.name, !!offIn(row, tool)) : undefined)) }));
  return [...own, ...plugins].filter(row => Object.keys(row.cells).length).sort((first, second) => first.name.localeCompare(second.name));
}

// ---------- Words ----------

/** What the tool said of this cell's server, if its answer says anything of it. */
export const saidOf = (cell: SigninCell, answer: SigninAnswer | undefined): SigninSaid | undefined =>
  (answer && 'servers' in answer && cell.name !== undefined && Object.hasOwn(answer.servers, cell.name) ? answer.servers[cell.name] : undefined);

const SAID: Record<Exclude<SigninSaid['is'], 'unreachable' | 'not-known'>, string> = { 'no-sign-in': 'No sign-in needed', 'signed-in': 'Signed in', connected: 'Connected', 'needs-sign-in': 'Needs sign-in' };

/** What a cell says: its tool's switch, else its column's last answer as it concerns this server. */
export function cellWords(tool: HarnessId, cell: SigninCell, answer: SigninAnswer | undefined): string {
  const name = toolNames[tool], said = saidOf(cell, answer);
  if (cell.off) return `Off in ${name}`;
  if (!answer) return 'Not checked';
  if ('failed' in answer) return answer.failed === 'missing' ? `${name} isn’t installed` : `Didn’t answer in ${CHECK_LIMIT_MS / 1000} s`;
  if ('unreadable' in answer) return `Couldn’t read ${name}’s answer`;
  if (!said) return `Not reported by ${name}`;
  return said.is === 'unreachable' ? `Couldn’t reach: ${said.why}` : said.is === 'not-known' ? `Not known to ${name}` : SAID[said.is];
}

/** What a column's head says once of its tool's answers. */
export function columnNote(tool: HarnessId): string | undefined {
  if (tool === 'copilot-cli') return 'Copilot CLI shows sign-in only inside a session: type /mcp auth <name> there.';
  return tool === 'codex-cli' ? undefined : `Connected means the server answered; ${toolNames[tool]} does not say whether it needed a sign-in.`;
}

/** Each tool's own command that signs in to one server (Copilot CLI's is typed inside a session: columnNote). */
const SIGN_IN: Partial<Record<HarnessId, [string, ...string[]]>> = { 'claude-cli': ['claude', 'mcp', 'login'], 'codex-cli': ['codex', 'mcp', 'login'], 'pi-cli': ['pi', 'mcp', 'login'], 'opencode-cli': ['opencode', 'mcp', 'auth'] };
export function signInCommand(tool: HarnessId, server: string): string | undefined {
  const [binary, ...args] = SIGN_IN[tool] ?? [];
  return binary ? commandLine(binary, [...args, server]) : undefined;
}
