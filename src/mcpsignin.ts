// MCP sign-in (MAP.md, "MCP sign-in"): what each tool's own command says of its MCP servers, read and put in words. Here: the
// command each tool reports with (listCommand; Copilot CLI has none), one reader per tool turning what it printed into what it
// said of each server it was asked about (readAnswer), the page's rows and cells from the view the Library already has
// (signinRows), those that need him first (grouped), which cells a check holds for as views come (askedNow, followView,
// answerFor), a cell's words (cellSays), the time a column shows of its own (ownTime), the line saying what
// a check does on this computer (checkLine), a session-only tool's head (IN_SESSION), the marks' cards (connectedCard, SESSION_CARD, LOCAL_CARD), and each tool's own
// sign-in command (signInCommand). Pure, for the page and main alike. Elsewhere: the run, in main (mcpsigninrun.ts
// checkSignin); the page, its clicks and the order it holds its rows in (mcpsigninpage.ts); its state (app.ts state.mcpSignin);
// the shapes (types.ts SigninAnswer, SigninSaid).
// Only what a tool's command prints is read, and what can't be read is said so, never made a status: Central Knot reads, keeps and
// shows no token, credential file, cache or keychain entry, and starts no sign-in. The words each tool prints were measured on
// 2026-11-21 against stand-in servers in throwaway homes (tests/mcpsignin/: Claude Code 2.1.330, Codex 0.169.1 and 0.171.0, Pi
// 1.6.0, OpenCode 1.19.6).
import { claudeServerName } from './pluginstatus.ts';
import { offIn, pageRows, pluginTools } from './pluginrows.ts';
import { record } from './values.ts';
import { andList, toolNames } from './words.ts';
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
const COLOUR = /\x1b\[[0-9;?]*[A-Za-z]/g;
/** A server's state kept as its own member whatever its name (`__proto__` too). */
const put = (servers: Servers, name: string, said: SigninSaid) => Object.defineProperty(servers, name, { value: said, enumerable: true, writable: true, configurable: true });
/** The server, of `names`, whose name a line gives before `after`: the longest first, so `foo: bar`'s line is never `foo`'s. */
const whose = (line: string, names: string[], after: string) => [...names].sort((first, second) => second.length - first.length).find(name => line.startsWith(`${name}${after}`));

// After a line saying it is checking: `<name>: <what it runs> - ✔ Connected`, `… - ! Needs authentication`, `… - ✘ Failed to
// connect — <why>`; with no servers, "No MCP servers configured". A line in another state is its server's unread line; an answer
// naming none of the servers asked about, and not saying none are configured, is no listing. A server its own switch turns off
// isn't listed.
const CLAUDE_STATE = / - (✔ Connected|! Needs authentication|✘ (?:Failed to connect(?: — )?)?(.*))$/;
function fromClaude(stdout: string, names: string[]): Servers | undefined {
  const servers: Servers = {};
  for (const line of lines(stdout)) {
    const name = whose(line, names, ': '), state = CLAUDE_STATE.exec(line);
    if (name !== undefined) put(servers, name, !state ? { is: 'unread', line } : state[1].startsWith('✔') ? { is: 'connected' } : state[1].startsWith('!') ? { is: 'needs-sign-in' } : { is: 'unreachable', why: state[2] || 'Failed to connect' });
  }
  return Object.keys(servers).length || stdout.includes('No MCP servers configured') ? servers : undefined;
}

// A list of `{ name, auth_status, … }`.
const CODEX = new Map<unknown, Exclude<SigninSaid['is'], 'unreachable' | 'unread'>>([['unsupported', 'no-sign-in'], ['o_auth', 'signed-in'], ['bearer_token', 'signed-in'], ['not_logged_in', 'needs-sign-in'], ['unknown', 'not-known']]);
function fromCodex(stdout: string): Servers | undefined {
  const list = json(stdout), servers: Servers = {};
  if (!Array.isArray(list)) return undefined;
  for (const entry of list.map(record)) {
    const is = CODEX.get(entry?.auth_status);
    if (typeof entry?.name !== 'string' || !is) return undefined;
    put(servers, entry.name, { is });
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
    if (entry.state === 'connected') put(servers, entry.name, { is: 'connected' });
    else if (entry.state === 'needs-auth') put(servers, entry.name, { is: 'needs-sign-in' });
    else if (entry.state === 'failed') put(servers, entry.name, { is: 'unreachable', why: typeof entry.error === 'string' && entry.error ? entry.error : 'failed' });
    else return undefined;
  }
  return servers;
}

// Under the heading "MCP Servers", in colour: `●  ✓ <name> connected`, `●  ⚠ <name> needs authentication`, `●  ✗ <name> failed` with
// its reason on the line under it, then what it runs; a whole list ends "└  <n> server(s)", or says "No MCP servers configured".
// A server's line in another state is its unread line.
const OPENCODE = new Map<string, (why: string) => SigninSaid>([['connected', () => ({ is: 'connected' })], ['needs authentication', () => ({ is: 'needs-sign-in' })], ['failed', why => ({ is: 'unreachable', why: why || 'failed' })]]);
function fromOpenCode(stdout: string, names: string[]): Servers | undefined {
  const text = lines(stdout.replace(COLOUR, '')).map(line => line.trim()), servers: Servers = {};
  if (!text.some(line => /^└\s+\d+ server\(s\)$/.test(line) || line.endsWith('No MCP servers configured'))) return undefined;
  text.forEach((line, at) => {
    const listed = /^●\s+\S+\s+(.*)$/.exec(line)?.[1] ?? '', name = whose(listed, names, ' ');
    const under = text[at + 1]?.startsWith('│') ? text[at + 1].slice(1).trim() : '';
    if (name !== undefined) put(servers, name, OPENCODE.get(listed.slice(name.length).trim())?.(under) ?? { is: 'unread', line });
  });
  return servers;
}

const readers: Partial<Record<HarnessId, (stdout: string, names: string[]) => Servers | undefined>> = { 'claude-cli': fromClaude, 'codex-cli': fromCodex, 'pi-cli': fromPi, 'opencode-cli': fromOpenCode };
/** The first line a tool printed that says something (its colours, frame and heading left out), cut at a word past 200 characters. */
function firstLine(text: string): string | undefined {
  const line = lines(text.replace(COLOUR, '')).map(each => each.replace(/^[┌│└●\s]+/, '').trim()).find(each => each && !/^(Checking MCP server health|MCP Servers$)/.test(each));
  if (!line || line.length <= 200) return line;
  const cut = line.lastIndexOf(' ', 200);
  return `${line.slice(0, cut > 100 ? cut : 200)}…`;
}

/**
 * What a tool's command said of the servers asked about (`names`, as it names them), read from what it printed on its standard
 * output; one in a shape not known keeps the first line it printed (`output`: both streams).
 */
export function readAnswer(tool: HarnessId, stdout: string, output: string, names: string[] = []): SigninAnswer {
  const servers = readers[tool]?.(stdout, names);
  return servers ? { servers } : { unreadable: firstLine(stdout) ?? firstLine(output) ?? '' };
}

// ---------- The page's rows ----------

/** One tool's cell: the tool's own name for the server there (none: its list doesn't name it), what the copy is (the hashes of its shared content and of that tool's own part, or its plugin's version), and whether that tool has it switched off. */
export interface SigninCell { name?: string; copy?: string; off: boolean }
/**
 * One server: a Library row of the person's own (its key) or of a plugin (the plugin's row key, and the plugin), how it runs where
 * that is known (stdio: on this computer; LibraryFacts and PluginItem transport), with a cell for each managed tool that has it.
 */
export interface SigninRow { id: string; name: string; plugin?: string; transport?: LibraryFacts['transport']; cells: Partial<Record<HarnessId, SigninCell>> }

/** A plugin's server in a tool: Claude Code's list names it `plugin:<plugin>:<server>`; Codex's doesn't name a plugin's server (0.169.1, 0.171.0). */
const pluginCell = (tool: HarnessId, plugin: string, server: string, off: boolean, version: string | undefined): SigninCell =>
  (tool === 'claude-cli' ? { name: claudeServerName(plugin, server), copy: version, off } : { copy: version, off });

/** A row of the person's own in one tool: its own copy there by the copy's name, or the plugin it has it through there. */
function ownCell(fact: LibraryFacts, tool: HarnessId): SigninCell | undefined {
  const copy = fact.copies[tool], given = fact.plugin?.[tool];
  if (copy) return { name: copy.folder, copy: `${copy.hash} ${copy.ownHash ?? ''}`, off: !!fact.switchedOff?.includes(tool) };
  return given ? pluginCell(tool, given.plugin, given.name ?? fact.name, !!given.off, given.version) : undefined;
}

/** The MCP servers some managed tool has, as the Library lists them (its own rows and plugins'), sorted by name. A plugin's runs as its first copy that says. */
export function signinRows(home: HomeView): SigninRow[] {
  const tools = home.mcp.tools, cells = (made: (tool: HarnessId) => SigninCell | undefined) => Object.fromEntries(tools.flatMap(tool => { const cell = made(tool); return cell ? [[tool, cell]] : []; }));
  const own = home.mcp.items.map(fact => ({ id: fact.key, name: fact.name, transport: fact.transport, cells: cells(tool => ownCell(fact, tool)) }));
  const plugins = pageRows(home, 'mcp').rows.map(row => ({ id: row.key, name: row.name, plugin: row.plugin,
    transport: Object.values(row.copies).find(copy => copy?.transport)?.transport,
    cells: cells(tool => (pluginTools(row).includes(tool) ? pluginCell(tool, row.plugin, row.copies[tool]!.name, !!offIn(row, tool), row.installs[tool]?.version) : undefined)) }));
  return [...own, ...plugins].filter(row => Object.keys(row.cells).length).sort((first, second) => first.name.localeCompare(second.name));
}

/** The rows that need him first (a cell that needs a sign-in or says what went wrong: CellSays heed), each group in the order given. */
export function grouped(rows: SigninRow[], checks: SigninChecks): SigninRow[] {
  const needed = rows.filter(row => (Object.keys(row.cells) as HarnessId[]).some(tool => cellSays(tool, row, answerFor(checks, tool, row)).heed));
  return [...needed, ...rows.filter(row => !needed.includes(row))];
}

// ---------- Which cells a check holds for ----------

/** A column's last check: when it ended, what its tool answered, and the cells it holds for: those asked about, unchanged at every view since. */
export interface ColumnCheck { at: string; answer: SigninAnswer; asked: string[] }
/**
 * The page's checks in one home (app.ts state.mcpSignin, made again when a home opens): each column's last, the one under way,
 * why one couldn't be run, and when the last whole Check all ended (`all`: each column it ran answered or said why it couldn't
 * run; mcpsigninpage.ts checkColumns). Never stored.
 */
export interface SigninChecks { home: string; columns: Partial<Record<HarnessId, ColumnCheck>>; checking?: { tool: HarnessId; asked: string[] }; failed?: Partial<Record<HarnessId, string>>; all?: string }
/** A cell as one copy: its row, the tool's name for the server, and what the copy is. */
const cellKey = (row: SigninRow, cell: SigninCell) => JSON.stringify([row.id, cell.name ?? null, cell.copy ?? null]);
/** The cells a check of `tool` asks about now: each one not switched off. */
export const askedNow = (home: HomeView, tool: HarnessId) => signinRows(home).flatMap(row => (row.cells[tool] && !row.cells[tool]!.off ? [cellKey(row, row.cells[tool]!)] : []));
/** At each view taken (app.ts setHome): a cell gone, switched off or another copy now is held for no more, by a check done or under way. */
export function followView(checks: SigninChecks, home: HomeView) {
  const still = (tool: HarnessId, asked: string[]) => { const now = new Set(askedNow(home, tool)); return asked.filter(key => now.has(key)); };
  for (const [tool, column] of Object.entries(checks.columns) as [HarnessId, ColumnCheck][]) column.asked = still(tool, column.asked);
  if (checks.checking) checks.checking.asked = still(checks.checking.tool, checks.checking.asked);
}
/** The answer a row's cell in `tool` is shown from: its column's last check, if that check holds for it. */
export function answerFor(checks: SigninChecks, tool: HarnessId, row: SigninRow): SigninAnswer | undefined {
  const column = checks.columns[tool], cell = row.cells[tool];
  return cell && column?.asked.includes(cellKey(row, cell)) ? column.answer : undefined;
}
/** The time a column's head shows of its own last check: before a whole Check all, or where its minute (or day) isn't that one's. */
export function ownTime(checks: SigninChecks, tool: HarnessId): string | undefined {
  const at = checks.columns[tool]?.at, minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);
  return at && (!checks.all || minute(at) !== minute(checks.all)) ? at : undefined;
}

// ---------- Words ----------

/**
 * What a cell says, its tone, the line under it where its answer couldn't be read, for one that needs a sign-in the tool's own
 * command, `heed` where it needs him (a sign-in, or what went wrong: grouped puts its row first), and a mark's whole meaning
 * (`title`, its hover).
 */
export interface CellSays { words: string; tone?: 'muted' | 'warning'; line?: string; command?: string; heed?: true; title?: string }
export const SAID = { 'no-sign-in': 'No sign-in needed', 'signed-in': 'Signed in', connected: 'Connected' };
/** Where each session-only tool's sign-in shows: its head, in place of a Check, and its mark's hover in a server's cell (Antigravity has no command known for it). */
export const IN_SESSION: Partial<Record<HarnessId, { head: string; hover: (server: string) => string }>> = {
  'copilot-cli': { head: 'In a session: /mcp auth <name>', hover: server => `In Copilot CLI. Sign in inside a session: /mcp auth ${server}` },
  'antigravity-cli': { head: 'In a session', hover: () => 'In Antigravity. Sign-in shows only inside a session.' },
};

/**
 * What a row's cell in `tool` says: its tool's switch first (never matched against an answer); for a session-only tool (no command
 * of its reports a sign-in) a mark, whose hover says where its sign-in shows or that the server is a local one; else its column's
 * answer of this server.
 */
export function cellSays(tool: HarnessId, row: SigninRow, answer: SigninAnswer | undefined): CellSays {
  const name = toolNames[tool], cell = row.cells[tool]!;
  if (cell.off) return { words: `Off in ${name}`, tone: 'muted' };
  if (!listCommand[tool]) return { words: '•', tone: 'muted', title: row.transport === 'stdio' ? `In ${name}. Local server.` : IN_SESSION[tool]?.hover(cell.name ?? row.name) };
  if (!answer) return { words: 'Not checked', tone: 'muted' };
  if ('failed' in answer) return { words: answer.failed === 'missing' ? `No ${name} command line here` : `Didn’t answer in ${CHECK_LIMIT_MS / 1000} s`, heed: true };
  if ('unreadable' in answer) return { words: `Couldn’t read ${name}’s answer`, line: answer.unreadable, heed: true };
  const said = cell.name !== undefined && Object.hasOwn(answer.servers, cell.name) ? answer.servers[cell.name] : undefined;
  if (!said) return { words: `Not reported by ${name}`, heed: true };
  if (said.is === 'unread') return { words: `Couldn’t read ${name}’s answer`, line: said.line, heed: true };
  if (said.is === 'unreachable') return { words: `Couldn’t reach: ${said.why}`, heed: true };
  if (said.is === 'needs-sign-in') return { words: 'Needs sign-in', tone: 'warning', command: signInCommand(tool, cell.name!), heed: true };
  return { words: said.is === 'not-known' ? `${name} can’t tell if it needs a sign-in` : SAID[said.is] };
}

/** The card on the first session-only head. */
export const SESSION_CARD = 'Sign-in shows only inside a session of that tool. • means the tool has the server; blank means it doesn’t.';
/** The card on the first Local: where the server runs, and nothing of signing in, which its transport doesn't tell. */
export const LOCAL_CARD = 'Runs on this computer.';

/** The tools whose Connected doesn't tell a sign-in from none needed. */
const CONNECTED_ONLY: HarnessId[] = ['claude-cli', 'pi-cli', 'opencode-cli'];
/** The card on the first Connected, naming those of the three that are columns (a Connected comes only from one of them). */
export function connectedCard(columns: HarnessId[]): string {
  const these = CONNECTED_ONLY.filter(tool => columns.includes(tool)).map(tool => toolNames[tool]);
  return `The server answered. ${andList(these)} ${these.length === 1 ? 'doesn’t' : 'don’t'} say whether it needed a sign-in.`;
}

/**
 * The tools whose check starts each local server it has: `claude mcp list` and `pi mcp list` launch them
 * (docs/capability-data.md, "Commands never run for discovery"), and OpenCode's did on 1.19.6 and 2.2.5 alike; Codex's starts none.
 */
const STARTS_LOCAL: HarnessId[] = ['claude-cli', 'pi-cli', 'opencode-cli'];
/** What OpenCode's check leaves besides, by its version (measured: 1.19.6 adds $schema to each config it loads, 2.2.5 leaves its service running); either, where that isn't known. */
function openCodeLeaves(version: string | undefined): string {
  const line = Number(version?.split('.')[0]);
  if (line === 1) return 'OpenCode adds $schema to its config files';
  return line >= 2 ? 'OpenCode leaves a service running' : 'OpenCode may leave a service running or add $schema to its config files (its version isn’t known)';
}
/**
 * What a Check or Check all does on this computer, said before it is pressed, each part only where it is true for these rows: the
 * checked tools of STARTS_LOCAL with a server not known to be remote start their local servers, or else the checked tools with a
 * remote one contact it; then, where OpenCode is checked, what it leaves (`openCode`: its probed version, Snapshot probe.version).
 * None where neither: only session-only tools, or a tool with nothing a check would start or contact.
 */
export function checkLine(rows: SigninRow[], checked: HarnessId[], openCode: string | undefined): string | undefined {
  const has = (tool: HarnessId, remote: boolean) => rows.some(row => row.cells[tool] && (row.transport === 'http' || row.transport === 'sse') === remote);
  const named = (tools: HarnessId[]) => andList(tools.map(tool => toolNames[tool]));
  const starts = checked.filter(tool => STARTS_LOCAL.includes(tool) && has(tool, false)), contacts = checked.filter(tool => has(tool, true));
  const first = starts.length ? `Check starts local servers in ${named(starts)}` : contacts.length ? `Check contacts remote servers in ${named(contacts)}` : undefined;
  if (!first) return undefined;
  return `${first}${checked.includes('opencode-cli') ? `; ${openCodeLeaves(openCode)}` : ''}.`;
}

/** One literal argument a shell accepts: as it is with only letters, digits and `. _ : / @ -`, else in single quotes (one inside as '\''). */
const shellWord = (text: string) => (/^[A-Za-z0-9._:/@-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);
/** Each tool's own command that signs in to one server (Copilot CLI's is typed inside a session: IN_SESSION). */
const SIGN_IN: Partial<Record<HarnessId, string[]>> = { 'claude-cli': ['claude', 'mcp', 'login'], 'codex-cli': ['codex', 'mcp', 'login'], 'pi-cli': ['pi', 'mcp', 'login'], 'opencode-cli': ['opencode', 'mcp', 'auth'] };
export const signInCommand = (tool: HarnessId, server: string) => (SIGN_IN[tool] ? [...SIGN_IN[tool]!, shellWord(server)].join(' ') : undefined);
