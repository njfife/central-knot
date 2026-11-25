// The MCP sign-in page (MAP.md, "MCP sign-in"): a row per MCP server some managed tool has, a column per such tool, each cell what
// that tool's own command said of the server at its column's last Check. Nothing runs when the page opens: Check runs one tool's
// command (main.ts mcp-signin:check → mcpsigninrun.ts checkSignin), Check all runs the columns one after another, one check at a
// time, beside it the line saying what a check does on this computer; a cell that needs a sign-in offers that tool's own command
// to copy, and nothing else is started. What each check said lives in app.ts state.mcpSignin for the home it was made in, until
// Central Knot quits; nothing is stored. The rows keep the places they had when he came to the page (inPlace). The rows, which
// cells a check holds for, the cells' and heads' words, the line, the cards and the commands are mcpsignin.ts's; the page's own
// words are its controls' (Check, Check all and its time, Copy and what it says), Local, a check's refusal and the empty state.
import { pinnedRows, rerender, state } from './app.ts';
import { brandMark } from './brand.ts';
import { button, emptyState, h, infoMark } from './dom.ts';
import { pin } from './itemrow.ts';
import { answerFor, askedNow, cannotRun, cellSays, checkLine, connectedCard, grouped,
  IN_SESSION, listCommand, LOCAL_CARD, ownTime, SAID, SESSION_CARD, signinRows, type SigninRow } from './mcpsignin.ts';
import { clockTime } from './model.ts';
import { copyButton, noToolsState, notRead } from './pages.ts';
import { toolNames } from './words.ts';
import type { HarnessId, HomeView } from './types.ts';

/** The tools with a column: the managed tools that have one of the servers, in the tools' order. */
const columnsOf = (home: HomeView, rows: SigninRow[]) => home.mcp.tools.filter(tool => rows.some(row => row.cells[tool]));
/** Why every Check waits: the check under way, if one is. */
const waitsFor = () => (state.mcpSignin.checking ? `Checking ${toolNames[state.mcpSignin.checking.tool]}…` : false);

/**
 * Checks each of `tools` in turn. One check runs at a time: while one does, every Check is off (waitsFor). Each answer is kept in
 * the checks of the home it was asked in, for the cells it was asked about that are unchanged when it comes (mcpsignin.ts
 * followView), so one that comes back after another home was opened is shown nowhere, and the rest of a Check all is not run.
 * A check that couldn't be run says why in its column's head. `whole`: Check all, whose end, every column answered or said why it
 * couldn't run, is the time beside it (SigninChecks all).
 */
async function checkColumns(tools: HarnessId[], whole = false) {
  const checks = state.mcpSignin;
  for (const tool of tools) {
    if (state.mcpSignin !== checks || !state.home) return;
    const names = signinRows(state.home).flatMap(row => row.cells[tool]?.name ?? []);
    const checking = checks.checking = { tool, asked: askedNow(state.home, tool) };
    rerender();
    const answer = await window.centralKnot.checkSignin(tool, checks.home, names).catch((error: unknown) => { (checks.failed ??= {})[tool] = String(error instanceof Error ? error.message : error); return null; });
    if (answer) { checks.columns[tool] = { at: new Date().toISOString(), answer, asked: checking.asked }; delete checks.failed?.[tool]; }
    checks.checking = undefined;
    rerender();
  }
  if (!whole) return;
  checks.all = new Date().toISOString();
  rerender();
}

/**
 * The rows where they were when he came to the page, those that need him first then (mcpsignin.ts grouped): a check moves none,
 * so the row under the pointer stays and each Copy stays its own row's. Held as the Library holds a clicked row (itemrow.ts
 * Pinned), let go on Refresh, on another page and when a home opens (app.ts accept); a row that arrives meanwhile goes after them.
 */
function inPlace(rows: SigninRow[]): SigninRow[] {
  const pins = pinnedRows<number>('mcpsignin');
  const now = grouped(rows, state.mcpSignin);
  // A pin's `group` holds the row's place here (this list has no groups): the next free one, so a row new since goes last.
  for (const row of now) pin(pins, row.id, pins.rows.size);
  return now.sort((first, second) => pins.rows.get(first.id)!.group - pins.rows.get(second.id)!.group);
}

/** A word and its mark on one line, a no-break space between: a (?) never stands alone on a line. */
const keep = (words: string | undefined, mark: HTMLElement | null) => (mark ? h('span.signin-keep', {}, words, '\u00a0', mark) : words);

/** The page's three marks, each with its card on the first place it fits and nowhere after: Connected's, Local's and the session-only heads'. */
function marksOnce(tools: HarnessId[]) {
  const cards = { connected: ['Connected', connectedCard(tools)], local: ['Local', LOCAL_CARD], session: ['session-only columns', SESSION_CARD] } as const;
  const placed = new Set<keyof typeof cards>();
  return (which: keyof typeof cards) => {
    if (placed.has(which)) return null;
    placed.add(which);
    const [label, text] = cards[which];
    return infoMark(`signin-${which}-mark`, label, text);
  };
}
type Mark = ReturnType<typeof marksOnce>;

/** A column's head: the tool's name, then its Check and its own time where it shows one (mcpsignin.ts ownTime), or where a session-only tool's sign-in shows. */
function columnHead(tool: HarnessId, mark: Mark) {
  const checks = state.mcpSignin, own = ownTime(checks, tool), failed = checks.failed?.[tool];
  const when = checks.checking?.tool === tool ? 'Checking…' : failed ? `Couldn’t run the check: ${failed}` : own ? `Checked ${clockTime(own)}` : '';
  return h('th.signin-head', { scope: 'col', 'data-tool': tool },
    h('span.signin-tool', {}, brandMark(tool, 14), toolNames[tool]),
    listCommand[tool] ? h('span.signin-check', {},
      button({ size: 'small', label: 'Check', name: `Check: run ${toolNames[tool]}’s own command for its MCP servers`, id: `signin-check-${tool}`, disabled: waitsFor(), onclick: () => void checkColumns([tool]) }),
      when ? h('span.signin-when', { id: `signin-when-${tool}` }, when) : null) : h('span.signin-when', {}, keep(IN_SESSION[tool]?.head, mark('session'))));
}

/** A row's first cell: the server's name, Local where it runs on this computer (by its transport alone), and the plugin it comes in. */
const nameCell = (row: SigninRow, mark: Mark) => h('th.signin-name', { scope: 'row' }, h('span.signin-server', {}, row.name),
  row.transport === 'stdio' ? h('span.signin-local', {}, 'Local', mark('local')) : null,
  row.plugin ? h('span.signin-plugin', {}, `In the plugin ${row.plugin}`) : null);

/** A cell, its id and its Copy's by its row's id, so neither follows a place in the list. */
function cellView(tool: HarnessId, row: SigninRow, mark: Mark) {
  if (!row.cells[tool]) return h('td.signin-cell', {});
  const says = cellSays(tool, row, answerFor(state.mcpSignin, tool, row));
  const shown = says.command ?? says.line;
  const id = `${tool}-${row.id}`;
  return h(`td.signin-cell${says.tone ? `.tone-${says.tone}` : ''}`, { id: `signin-cell-${id}`, title: says.title },
    // The command or the unread line under the words, with the cell's whole width; Copy beside the words.
    h('span.signin-words', {}, says.words === SAID.connected ? keep(says.words, mark('connected')) : says.words,
      says.command ? copyButton(says.command, says.command, `signin-copy-${id}`, 'Copy', 'Copied: run it in a terminal') : null),
    shown ? h('code.signin-command', {}, shown) : null);
}

export function mcpSigninPage() {
  const home = state.home;
  if (!home) return notRead();
  if (!home.sync.managed.length) return h('div.page', {}, noToolsState('mcpsignin'));
  const rows = inPlace(signinRows(home));
  const tools = columnsOf(home, rows);
  const checked = tools.filter(tool => listCommand[tool]);
  const mark = marksOnce(tools);
  if (!rows.length) return h('div.page', {}, emptyState('plug', 'No MCP servers in your tools.', undefined));
  const runs = checked.filter(tool => !cannotRun(state.mcpSignin, home, tool));
  const line = checkLine(rows, runs, home.snapshots.find(snapshot => snapshot.harness === 'opencode-cli')?.probe.version);
  const all = state.mcpSignin.all;
  return h('div.page', {}, h('div.scroll.signin-scroll', { id: 'mcpsignin-scroll' },
    checked.length ? h('div.signin-top', {},
      button({ label: 'Check all', name: 'Check all: run each tool’s own command, one after another', id: 'signin-check-all', disabled: waitsFor(), onclick: () => void checkColumns(checked, true) }),
      all ? h('span.signin-when', { id: 'signin-checked' }, `Checked ${clockTime(all)}`) : null,
      line ? h('span.signin-line', { id: 'signin-line' }, line) : null) : null,
    h('table.signin-table', {},
      h('thead', {}, h('tr', {}, h('th.signin-name', { scope: 'col' }, 'MCP server'), ...tools.map(tool => columnHead(tool, mark)))),
      h('tbody', {}, ...rows.map(row => h('tr', { 'data-row': row.id }, nameCell(row, mark), ...tools.map(tool => cellView(tool, row, mark))))))));
}
