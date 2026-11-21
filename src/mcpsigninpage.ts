// The MCP sign-in page (MAP.md, "MCP sign-in"): a row per MCP server some managed tool has, a column per such tool, each cell what
// that tool's own command said of the server at its column's last Check. Nothing runs when the page opens: Check runs one tool's
// command (main.ts mcp-signin:check → mcpsigninrun.ts checkSignin), Check all runs the columns one after another, one check at a
// time; a cell that needs a sign-in offers that tool's own command to copy, and nothing else is started. What each check said
// lives in app.ts state.mcpSignin for the home it was made in, until Central Knot quits; nothing is stored. The rows, the words
// and the commands are mcpsignin.ts's.
import { rerender, state } from './app.ts';
import { brandMark } from './brand.ts';
import { button, emptyState, h } from './dom.ts';
import { cellWords, columnNote, listCommand, saidOf, signInCommand, signinRows, type SigninCell, type SigninRow } from './mcpsignin.ts';
import { clockTime } from './model.ts';
import { copyButton, noToolsState, notRead } from './pages.ts';
import { toolNames } from './words.ts';
import type { HarnessId, HomeView, SigninAnswer } from './types.ts';

/** A column's last check: when it ended, what its tool answered, and the cells it was asked for (one changed or added since says Not checked). */
export interface ColumnCheck { at: string; answer: SigninAnswer; asked: string[] }
/** The page's state for the home it was made for (app.ts state.mcpSignin, made again when a home opens): each column's last check, and the one running. */
export interface SigninChecks { home: string; columns: Partial<Record<HarnessId, ColumnCheck>>; checking?: HarnessId }

/** A cell as a check asks for it: its row, the tool's name for it there, and whether it was switched off. */
const askedAs = (row: SigninRow, cell: SigninCell) => JSON.stringify([row.id, cell.name ?? null, cell.off]);
/** The tools with a column: the managed tools that have one of the servers, in the tools' order. */
const columnsOf = (home: HomeView, rows: SigninRow[]) => home.mcp.tools.filter(tool => rows.some(row => row.cells[tool]));

/**
 * Checks each of `tools` in turn, one at a time: a press while a check runs does nothing. Each answer is kept in the checks of the
 * home it was asked in, so one that comes back after another home was opened is shown nowhere, and the rest of a Check all is not run.
 */
async function checkColumns(tools: HarnessId[]) {
  const checks = state.mcpSignin;
  if (checks.checking) return;
  for (const tool of tools.filter(each => listCommand[each])) {
    if (state.mcpSignin !== checks || !state.home) return;
    const asked = signinRows(state.home).flatMap(row => (row.cells[tool] ? [askedAs(row, row.cells[tool]!)] : []));
    checks.checking = tool;
    rerender();
    const answer = await window.centralKnot.checkSignin(tool, checks.home).catch(() => null);
    checks.checking = undefined;
    if (answer) checks.columns[tool] = { at: new Date().toISOString(), answer, asked };
    rerender();
  }
}

/** The answer a cell is shown from: its column's last check, if the cell was there as it is now when that check began. */
function answerFor(tool: HarnessId, row: SigninRow, cell: SigninCell): SigninAnswer | undefined {
  const column = state.mcpSignin.columns[tool];
  return column?.asked.includes(askedAs(row, cell)) ? column.answer : undefined;
}

function columnHead(tool: HarnessId) {
  const checks = state.mcpSignin, column = checks.columns[tool], note = columnNote(tool), answer = column?.answer;
  const when = checks.checking === tool ? 'Checking…' : column ? `Checked ${clockTime(column.at)}` : '';
  const busy = checks.checking ? `Checking ${toolNames[checks.checking]}…` : false;
  return h('th.signin-head', { scope: 'col', 'data-tool': tool },
    h('span.signin-tool', {}, brandMark(tool, 14), toolNames[tool]),
    listCommand[tool] ? h('span.signin-check', {},
      button({ size: 'small', label: 'Check', name: `Check: run ${toolNames[tool]}’s own command for its MCP servers`, id: `signin-check-${tool}`, disabled: busy, onclick: () => void checkColumns([tool]) }),
      when ? h('span.signin-when', { id: `signin-when-${tool}` }, when) : null) : null,
    answer && 'unreadable' in answer ? h('span.signin-raw', { id: `signin-raw-${tool}` }, answer.unreadable ? `It printed: ${answer.unreadable}` : 'It printed nothing.') : null,
    note ? h('span.signin-note', {}, note) : null);
}

function cellView(tool: HarnessId, row: SigninRow, index: number) {
  const cell = row.cells[tool];
  if (!cell || !listCommand[tool]) return h('td.signin-cell', {});
  const answer = answerFor(tool, row, cell), said = cell.off ? undefined : saidOf(cell, answer);
  const command = said?.is === 'needs-sign-in' && cell.name !== undefined ? signInCommand(tool, cell.name) : undefined;
  return h(`td.signin-cell${said?.is === 'needs-sign-in' ? '.tone-warning' : !answer || cell.off ? '.tone-muted' : ''}`, { id: `signin-cell-${tool}-${index}` },
    h('span.signin-words', {}, cellWords(tool, cell, answer)),
    command ? h('span.signin-command', {}, h('code', {}, command), copyButton(command, command, `signin-copy-${tool}-${index}`, undefined, 'Copied. Run it in a terminal; then Check again.')) : null);
}

export function mcpSigninPage() {
  const home = state.home;
  if (!home) return notRead();
  if (!home.sync.managed.length) return h('div.page', {}, noToolsState('mcpsignin'));
  const rows = signinRows(home), tools = columnsOf(home, rows), checked = tools.filter(tool => listCommand[tool]);
  if (!rows.length) return h('div.page', {}, emptyState('plug', 'No MCP servers in your tools', 'When a tool here has an MCP server, it is listed here with a Check for that tool.'));
  const intro = h('p.signin-intro', {}, 'What each tool’s own command says of its MCP servers, kept only until Central Knot quits. Nothing runs until you press Check. Check runs each tool’s own command, which may write its own logs.');
  return h('div.page', {}, h('div.scroll.signin-scroll', { id: 'mcpsignin-scroll' },
    h('div.signin-top', {}, intro, button({ label: 'Check all', name: 'Check all: run each tool’s own command, one after another', id: 'signin-check-all',
      disabled: state.mcpSignin.checking ? `Checking ${toolNames[state.mcpSignin.checking]}…` : false, onclick: () => void checkColumns(checked) })),
    h('table.signin-table', { 'data-columns': String(tools.length) },
      h('thead', {}, h('tr', {}, h('th.signin-name', { scope: 'col' }, 'MCP server'), ...tools.map(columnHead))),
      h('tbody', {}, ...rows.map((row, index) => h('tr', { 'data-row': row.id },
        h('th.signin-name', { scope: 'row' }, h('span.signin-server', {}, row.name), row.plugin ? h('span.signin-plugin', {}, `In the plugin ${row.plugin}`) : null),
        ...tools.map(tool => cellView(tool, row, index))))))));
}
