// MCP sign-in (MAP.md, "MCP sign-in"): what each tool's own command says of its MCP servers, read and put in words. Here: the
// command each tool reports with (listCommand; Copilot CLI has none), one reader per tool turning what it printed into what it
// said of each server it was asked about (readAnswer), the page's rows and cells from the view the Library already has
// (signinRows), those that need him first (grouped), which cells a check holds for as views come (askedNow, followView,
// answerFor), a cell's words (cellSays), the time a column shows of its own (ownTime), the line saying what a check does on this
// computer (checkLine, for the tools whose check can run here: cannotRun), a session-only tool's head (IN_SESSION), the marks'
// cards (connectedCard, SESSION_CARD, LOCAL_CARD), each tool's own sign-in command, run and copied (signInArgs, signInCommand),
// the tools whose sign-in Central Knot offers to start on a click (offersSignin), the address Pi and OpenCode print for main to
// open (addressAfter, printsAddress), how a sign-in ended by what its tool did (signinEnd), and a cell as the page shows it, a
// sign-in started there included (cellNow; what the page keeps of a sign-in: SigninRun). Pure, for the page and main alike.
// Elsewhere: the runs, in main (mcpsigninrun.ts
// checkSignin, startSignin); the page, its clicks and the order it holds its rows in (mcpsigninpage.ts); its state (app.ts
// state.mcpSignin); the shapes (types.ts SigninAnswer, SigninSaid, SigninEnd).
// Only what a tool's command prints is read, and what can't be read is said so, never made a status: Central Knot reads, keeps and
// shows no token, credential file, cache or keychain entry; a sign-in it starts is the tool's own. The words each tool prints were measured on
// 2026-11-21 against stand-in servers in throwaway homes (tests/mcpsignin/: Claude Code 2.1.330, Codex 0.169.1 and 0.171.0, Pi
// 1.6.0, OpenCode 1.19.6).
import { claudeServerName } from './pluginstatus.ts';
import { offIn, pageRows, pluginTools } from './pluginrows.ts';
import { record } from './values.ts';
import { clockTime } from './model.ts';
import { andList, toolNames } from './words.ts';
import type { HarnessId, HomeView, LibraryFacts, SigninAnswer, SigninEnd, SigninSaid } from './types.ts';

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
/** A line a tool printed, cut at a word past 200 characters. */
function cut(line: string): string {
  if (line.length <= 200) return line;
  const at = line.lastIndexOf(' ', 200);
  return `${line.slice(0, at > 100 ? at : 200)}…`;
}
/** The first line a tool printed that says something (its colours, frame and heading left out), cut. */
function firstLine(text: string): string | undefined {
  const line = lines(text.replace(COLOUR, '')).map(each => each.replace(/^[┌│└●\s]+/, '').trim()).find(each => each && !/^(Checking MCP server health|MCP Servers$)/.test(each));
  return line && cut(line);
}
/** Every control character but a line's end. */
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g;
/** The last line a tool printed (`output`: both streams) that says something, as text: its colours and every other control character left out, cut. */
export const lastSaid = (output: string) => cut(lines(output.replace(COLOUR, '').replace(CONTROL, '')).map(each => each.trim()).filter(Boolean).at(-1) ?? '');

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
export function signinRows(home: Pick<HomeView, 'pluginItems' | 'skills' | 'mcp' | 'agents'>): SigninRow[] {
  const tools = home.mcp.tools, cells = (made: (tool: HarnessId) => SigninCell | undefined) => Object.fromEntries(tools.flatMap(tool => { const cell = made(tool); return cell ? [[tool, cell]] : []; }));
  const own = home.mcp.items.map(fact => ({ id: fact.key, name: fact.name, transport: fact.transport, cells: cells(tool => ownCell(fact, tool)) }));
  const plugins = pageRows(home, 'mcp').rows.map(row => ({ id: row.key, name: row.name, plugin: row.plugin,
    transport: Object.values(row.copies).find(copy => copy?.transport)?.transport,
    cells: cells(tool => (pluginTools(row).includes(tool) ? pluginCell(tool, row.plugin, row.copies[tool]!.name, !!offIn(row, tool), row.installs[tool]?.version) : undefined)) }));
  return [...own, ...plugins].filter(row => Object.keys(row.cells).length).sort((first, second) => first.name.localeCompare(second.name));
}

/** The rows that need him first (a cell that needs a sign-in or says what went wrong: CellSays heed), each group in the order given. */
export function grouped(rows: SigninRow[], checks: SigninChecks): SigninRow[] {
  const needed = rows.filter(row => (Object.keys(row.cells) as HarnessId[]).some(tool => cellNow(checks, tool, row, false).heed));
  return [...needed, ...rows.filter(row => !needed.includes(row))];
}

// ---------- Which cells a check holds for ----------

/** A column's last check: when it was asked and when it ended, what its tool answered, and the cells it holds for: those asked about, unchanged at every view since. */
export interface ColumnCheck { at: string; answer: SigninAnswer; asked: string[]; began?: string }
/**
 * What the page keeps of a sign-in started from a cell (signinStarted), said here alone: one a cell, by its tool and row
 * (SigninChecks signins, signinKey), so one started there takes the place of the one before; its cell's copy (cellKey), and once
 * it ended, when and how. One under way is its row's, whatever became of the copy or of that tool's cell, so its Stop stays
 * (signinWaits). One ended is shown only in a cell of that very copy, and only while no view since it started was without that
 * copy on (`gone`: another copy, Off or gone) and no Check of its column was asked after it ended (ColumnCheck began): cellNow.
 * An ended one that is gone is forgotten at a view (followView); a new home's checks start with none.
 */
export interface SigninRun { tool: HarnessId; row: string; copy: string; at?: string; end?: SigninEnd; gone?: true }
/** A cell's place among the sign-ins kept: its tool and its row (SigninRun). */
export const signinKey = (tool: HarnessId, row: string) => `${tool} ${row}`;
/** A sign-in started from `row`'s cell in `tool`, kept in `checks` in the place of any before it there (SigninRun). */
export function signinStarted(checks: SigninChecks, tool: HarnessId, row: SigninRow): SigninRun {
  const run: SigninRun = { tool, row: row.id, copy: cellKey(row, row.cells[tool]!) };
  (checks.signins ??= {})[signinKey(tool, row.id)] = run;
  return run;
}
/** Whether a sign-in started from `row`'s cell in `tool` is under way (SigninRun). */
export const signinWaits = (checks: SigninChecks, tool: HarnessId, row: SigninRow) => { const run = checks.signins?.[signinKey(tool, row.id)]; return !!run && !run.end; };
/**
 * The page's checks in one home (app.ts state.mcpSignin, made again when a home opens): each column's last, the one under way,
 * why one couldn't be run, when the last whole Check all ended (`all`: each column it ran answered or said why it couldn't
 * run; mcpsigninpage.ts checkColumns), and the sign-ins started there (SigninRun). Never stored.
 */
export interface SigninChecks { home: string; columns: Partial<Record<HarnessId, ColumnCheck>>; checking?: { tool: HarnessId; asked: string[] };
  failed?: Partial<Record<HarnessId, string>>; all?: string; signins?: Record<string, SigninRun> }
/** A cell as one copy: its row, the tool's name for the server, and what the copy is. Main checks a sign-in's against it (mcpsigninrun.ts signinRefusal). */
export const cellKey = (row: SigninRow, cell: SigninCell) => JSON.stringify([row.id, cell.name ?? null, cell.copy ?? null]);
/** The cells a check of `tool` asks about now: each one not switched off. */
export const askedNow = (home: HomeView, tool: HarnessId) => signinRows(home).flatMap(row => (row.cells[tool] && !row.cells[tool]!.off ? [cellKey(row, row.cells[tool]!)] : []));
/** At each view taken (app.ts setHome): a cell gone, switched off or another copy now is held for no more, by a check done or under way. */
export function followView(checks: SigninChecks, home: HomeView) {
  const still = (tool: HarnessId, asked: string[]) => { const now = new Set(askedNow(home, tool)); return asked.filter(key => now.has(key)); };
  for (const [tool, column] of Object.entries(checks.columns) as [HarnessId, ColumnCheck][]) column.asked = still(tool, column.asked);
  if (checks.checking) checks.checking.asked = still(checks.checking.tool, checks.checking.asked);
  // Sign-ins too, as SigninRun says.
  for (const [key, run] of Object.entries(checks.signins ?? {})) {
    if (!still(run.tool, [run.copy]).length) run.gone = true;
    if (run.end && run.gone) delete checks.signins![key];
  }
  // A check that found no command line is older than this view's probe that finds one: the newer word decides, so that answer goes.
  const found = (tool: HarnessId) => home.snapshots.some(each => each.harness === tool && each.probe.state === 'ok');
  for (const tool of Object.keys(checks.columns) as HarnessId[]) if (cannotRun(checks, home, tool) && found(tool)) delete checks.columns[tool];
}
/** The answer a row's cell in `tool` is shown from: its column's last check, if that check holds for it. */
export function answerFor(checks: SigninChecks, tool: HarnessId, row: SigninRow): SigninAnswer | undefined {
  const column = checks.columns[tool], cell = row.cells[tool];
  return cell && column?.asked.includes(cellKey(row, cell)) ? column.answer : undefined;
}
/** The time a column's head shows of its own last check: before a whole Check all, or where its minute (or day) isn't that one's. */
export function ownTime(checks: SigninChecks, tool: HarnessId): string | undefined {
  const at = checks.columns[tool]?.at;
  const minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);
  return at && (!checks.all || minute(at) !== minute(checks.all)) ? at : undefined;
}

// ---------- Words ----------

/**
 * What a cell says, its tone, the line under it (an answer that couldn't be read), the tool's own sign-in command to copy, `heed`
 * where it needs him (a sign-in, or what went wrong: grouped puts its row first), a mark's whole meaning (`title`, its hover),
 * and why a sign-in didn't finish (`why`: what its tool said last, behind a (?) after the words).
 */
export interface CellSays { words: string; tone?: 'muted' | 'warning'; line?: string; command?: string; heed?: true; title?: string; why?: string;
  /** A sign-in's button (cellNow): Sign in or Try again, which runs `runs`, or Stop while one waits. */
  act?: { label: 'Sign in' | 'Try again' | 'Stop'; runs?: string };
  /** Reopen beside Stop, while a sign-in whose tool printed its address waits (printsAddress): main opens that address again. */
  reopen?: true }
export const SAID = { 'no-sign-in': 'No sign-in needed', 'signed-in': 'Signed in', connected: 'Connected' };
/** Where each session-only tool's sign-in shows: its head, in place of a Check, and its mark's hover in a server's cell (Antigravity has no command known for it). */
export const IN_SESSION: Partial<Record<HarnessId, { head: string; hover: (server: string) => string }>> = {
  'copilot-cli': { head: 'In a session: /mcp auth <name>', hover: server => `In Copilot CLI. Sign in inside a session: /mcp auth ${server}` },
  'antigravity-cli': { head: 'Sign in inside a session', hover: () => 'In Antigravity. Sign-in shows only inside a session.' },
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
 * What a Check or Check all does on this computer, said before it is pressed, each part only where it is true for these rows and
 * `checked`, the tools whose check can run here (cannotRun): those of STARTS_LOCAL with a server on there that isn't known to be
 * remote start their local servers, or else those with a remote one on contact it; then, wherever OpenCode is checked, what its
 * command leaves as it runs (`openCode`: its probed version, Snapshot probe.version). A server switched off in a tool is neither
 * started nor contacted there. None where nothing is said: only session-only tools, or nothing a check would start or contact.
 */
export function checkLine(rows: SigninRow[], checked: HarnessId[], openCode: string | undefined): string | undefined {
  const knownRemote = (row: SigninRow) => row.transport === 'http' || row.transport === 'sse';
  /** Whether `tool` has a server on (not switched off there) that passes `test`. */
  const hasOn = (tool: HarnessId, test: (row: SigninRow) => boolean) => rows.some(row => !!row.cells[tool] && !row.cells[tool]!.off && test(row));
  const named = (tools: HarnessId[]) => andList(tools.map(tool => toolNames[tool]));
  const starts = checked.filter(tool => STARTS_LOCAL.includes(tool) && hasOn(tool, row => !knownRemote(row)));
  const contacts = checked.filter(tool => hasOn(tool, knownRemote));
  const first = starts.length ? `Check starts local servers in ${named(starts)}` : contacts.length ? `Check contacts remote servers in ${named(contacts)}` : undefined;
  const parts = [first, checked.includes('opencode-cli') ? openCodeLeaves(openCode) : undefined].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : undefined;
}
/** Whether `tool`'s check can't run on this computer: its column's last check found no command line (until a probe finds one: followView), or, before one, the tool's own probe found none. */
export function cannotRun(checks: SigninChecks, home: HomeView, tool: HarnessId): boolean {
  const answer = checks.columns[tool]?.answer;
  if (answer) return 'failed' in answer && answer.failed === 'missing';
  return home.snapshots.find(snapshot => snapshot.harness === tool)?.probe.state === 'missing';
}

/** One literal argument a shell accepts: as it is with only letters, digits and `. _ : / @ -`, else in single quotes (one inside as '\''). */
const shellWord = (text: string) => (/^[A-Za-z0-9._:/@-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);
/**
 * Each tool's own command that signs in to one server (Copilot CLI's is typed inside a session: IN_SESSION). Codex's ends its
 * options with `--`, so a server's name that begins with a dash is never taken for one (its `--help` ends with exit 0); the
 * other three are copied as their tools take them.
 */
const SIGN_IN: Partial<Record<HarnessId, string[]>> = { 'claude-cli': ['claude', 'mcp', 'login'], 'codex-cli': ['codex', 'mcp', 'login', '--'], 'pi-cli': ['pi', 'mcp', 'login'], 'opencode-cli': ['opencode', 'mcp', 'auth'] };
/** The command to copy or name, as a shell takes it, the server one shell word. */
export const signInCommand = (tool: HarnessId, server: string) => (SIGN_IN[tool] ? [...SIGN_IN[tool]!, shellWord(server)].join(' ') : undefined);
/** How long a sign-in started here waits for its tool to end, the browser's part in it included, before it is stopped. */
export const SIGNIN_LIMIT_MS = 180_000;
/** What a sign-in's run gives a tool after the server's name, and its Copy doesn't: Pi waits for the browser that long, as Central Knot does. */
const RUN_ALSO: Partial<Record<HarnessId, string[]>> = { 'pi-cli': ['--timeout', String(SIGNIN_LIMIT_MS / 1000)] };
/** The same command's arguments after its binary, as a sign-in runs them (mcpsigninrun.ts startSignin): the server one argument whatever it holds. */
export const signInArgs = (tool: HarnessId, server: string) => (SIGN_IN[tool] ? [...SIGN_IN[tool]!.slice(1), server, ...(RUN_ALSO[tool] ?? [])] : undefined);

/**
 * Where Central Knot starts each tool's sign-in on a click, by platform (process.platform's names), said here alone; elsewhere,
 * and in every other tool, the cell keeps its Copy. Codex opens the browser itself and needs no terminal (measured on Linux,
 * Codex 0.172.0; offered on macOS too, where it is owed a measure before a release). Pi and OpenCode print the address for main
 * to open (printsAddress): on Linux alone, as who owns the browser opened on macOS isn't measured. None on Windows.
 */
const STARTS_SIGNIN: Partial<Record<HarnessId, (platform: string) => boolean>> = {
  'codex-cli': platform => platform !== 'win32', 'pi-cli': platform => platform === 'linux', 'opencode-cli': platform => platform === 'linux',
};
/**
 * Whether a cell of `tool` offers Sign in, on `platform`, in a home that is this computer's own and one Central Knot may write
 * (`here`: not the Practice copy, another folder or a home it may only preview, as share.ts writeAccess says), as STARTS_SIGNIN
 * says. Main refuses a start by it too (mcpsigninrun.ts signinRefusal).
 */
export const offersSignin = (tool: HarnessId, here: boolean, platform: string) => here && !!STARTS_SIGNIN[tool]?.(platform);

/**
 * The tools whose sign-in prints the address to sign in at, for main to open (mcpsigninrun.ts startSignin), by the end of their
 * own line just before it, read in their code: Pi 1.7.0 `Sign in to MCP server "<name>" in your browser:`, OpenCode 1.19.6
 * `◇  Authorize in your browser:`. Both also hand the address to xdg-open themselves, which main's run of them turns to nothing.
 */
const ADDRESS_AFTER: Partial<Record<HarnessId, string>> = { 'pi-cli': 'in your browser:', 'opencode-cli': 'Authorize in your browser:' };
/** Whether `tool`'s sign-in prints the address main opens: its waiting cell offers Reopen (cellNow). */
export const printsAddress = (tool: HarnessId) => !!ADDRESS_AFTER[tool];
/**
 * A reader of `tool`'s sign-in output, given its whole lines as they come (plugins.ts RunOptions heard): it hands `found` the
 * first http or https address on a line after the tool's own line (ADDRESS_AFTER), once, so an address it printed before that
 * line, or after the first, is never the one. None for a tool that prints no address for main.
 */
export function addressAfter(tool: HarnessId, found: (address: string) => void): ((lines: string) => void) | undefined {
  const prompt = ADDRESS_AFTER[tool];
  if (!prompt) return undefined;
  let asked = false, given = false;
  return text => {
    for (const line of lines(text.replace(COLOUR, ''))) {
      const address = asked && !given ? /https?:\/\/[^\s"<>]+/.exec(line)?.[0] : undefined;
      if (address) { given = true; found(address); }
      if (line.trimEnd().endsWith(prompt)) asked = true;
    }
  };
}
/** The port a tool's sign-in listens on for the browser's answer, where it is one alone: OpenCode's own (19876, its default). */
export const SIGNIN_PORT: Partial<Record<HarnessId, number>> = { 'opencode-cli': 19876 };
/**
 * Where a tool's exit code alone doesn't say it signed in: OpenCode 1.19.6 ends with exit 0 and its closing `└  Done` whether it
 * did or not (read in its code), so it signed in only where it printed `signedIn`, and what it said last before `closing`,
 * its mark left out, is why not.
 */
const SAYS_IT: Partial<Record<HarnessId, { signedIn: string; closing: RegExp }>> = { 'opencode-cli': { signedIn: 'Authentication successful!', closing: /[\s│]*└\s+Done[\s│]*$/ } };
/**
 * How a sign-in ended, its tool having ended with `code` after printing `said` (both streams, by arrival): its port taken where
 * it listens on one alone (SIGNIN_PORT) and said its address was in use; else exit 0, and its own words where it has them
 * (SAYS_IT), is Signed in; anything else the last line it said (lastSaid).
 */
export function signinEnd(tool: HarnessId, code: number | 'timeout' | 'missing', said: string): SigninEnd {
  const own = SAYS_IT[tool], plain = said.replace(COLOUR, '');
  if (SIGNIN_PORT[tool] && /EADDRINUSE/.test(plain)) return { failed: 'port' };
  if (code === 0 && (!own || plain.includes(own.signedIn))) return { signedIn: true };
  return { unfinished: own ? lastSaid(plain.replace(own.closing, '')).replace(/^[■▲●◇│]\s+/, '') : lastSaid(said) };
}
/** A sign-in's end in a cell's words, after its tool ended or was stopped, or main started nothing. */
function endWords(tool: HarnessId, end: Exclude<SigninEnd, { signedIn: true }>): string {
  if ('notStarted' in end) return end.notStarted;
  if ('unfinished' in end) return 'Sign-in didn’t finish';
  return { timeout: `Not finished in ${SIGNIN_LIMIT_MS / 60_000} minutes`, stopped: 'Stopped', missing: `No ${toolNames[tool]} command line here`,
    port: `Port ${SIGNIN_PORT[tool]} is in use`, browser: 'Couldn’t open the sign-in page' }[end.failed];
}
/**
 * A cell as the page shows it, and whether it needs him: a sign-in under way there (Stop); else the newest that ended and still
 * shows there (SigninRun says which: Signed in and its time; else what happened, Try again and the command to copy); else its
 * column's answer (cellSays), whose need of a sign-in offers Sign in in place of Copy where `offers`.
 */
export function cellNow(checks: SigninChecks, tool: HarnessId, row: SigninRow, offers: boolean): CellSays {
  if (signinWaits(checks, tool, row)) return { words: 'Finish in your browser…', act: { label: 'Stop' }, ...(printsAddress(tool) ? { reopen: true as const } : {}), heed: true };
  const said = cellSays(tool, row, answerFor(checks, tool, row)), cell = row.cells[tool]!, began = checks.columns[tool]?.began;
  const run = checks.signins?.[signinKey(tool, row.id)];
  if (!run?.end || run.gone || run.copy !== cellKey(row, cell) || (began && began > run.at!)) {
    return said.command && offers ? { words: said.words, tone: said.tone, act: { label: 'Sign in', runs: said.command }, heed: true } : said;
  }
  if ('signedIn' in run.end) return { words: `Signed in ${clockTime(run.at!)}` };
  const command = signInCommand(tool, cell.name!)!;
  return { words: endWords(tool, run.end), tone: 'warning', ...('unfinished' in run.end && run.end.unfinished ? { why: run.end.unfinished } : {}), command,
    act: { label: 'Try again', runs: command }, heed: true };
}
