// The MCP sign-in page (MAP.md, "MCP sign-in"): a row per MCP server some managed tool has, a column per such tool, each cell what
// that tool's own command said of the server at its column's last Check. Nothing runs when the page opens: Check runs one tool's
// command (main.ts mcp-signin:check → mcpsigninrun.ts checkSignin), Check all runs the columns one after another, one check at a
// time; a cell that needs a sign-in offers that tool's own command to copy, and nothing else is started. What each check said
// lives in app.ts state.mcpSignin for the home it was made in, until Central Knot quits; nothing is stored. The rows, which cells a
// check holds for, the words and the commands are mcpsignin.ts's.
import { rerender, state } from './app.ts';
import { brandMark } from './brand.ts';
import { button, emptyState, h } from './dom.ts';
import { answerFor, askedNow, cellSays, connectedLine, COPILOT_HEAD, listCommand, signinRows, type SigninRow } from './mcpsignin.ts';
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
 * A check that couldn't be run says why in its column's head.
 */
async function checkColumns(tools: HarnessId[]) {
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
}

/** A column's head: the tool's name, then its Check and its last check's time (Copilot CLI: where its sign-in is). */
function columnHead(tool: HarnessId) {
  const checks = state.mcpSignin, column = checks.columns[tool], failed = checks.failed?.[tool];
  const when = checks.checking?.tool === tool ? 'Checking…' : failed ? `Couldn’t run the check: ${failed}` : column ? `Checked ${clockTime(column.at)}` : '';
  return h('th.signin-head', { scope: 'col', 'data-tool': tool },
    h('span.signin-tool', {}, brandMark(tool, 14), toolNames[tool]),
    listCommand[tool] ? h('span.signin-check', {},
      button({ size: 'small', label: 'Check', name: `Check: run ${toolNames[tool]}’s own command for its MCP servers`, id: `signin-check-${tool}`, disabled: waitsFor(), onclick: () => void checkColumns([tool]) }),
      when ? h('span.signin-when', { id: `signin-when-${tool}` }, when) : null) : h('span.signin-when', {}, COPILOT_HEAD));
}

function cellView(tool: HarnessId, row: SigninRow, index: number) {
  const cell = row.cells[tool];
  if (!cell) return h('td.signin-cell', {});
  const says = cellSays(tool, cell, answerFor(state.mcpSignin, tool, row)), shown = says.command ?? says.line;
  return h(`td.signin-cell${says.tone ? `.tone-${says.tone}` : ''}`, { id: `signin-cell-${tool}-${index}` },
    // The command or the unread line under the words, with the cell's whole width; Copy beside the words.
    h('span.signin-words', {}, says.words, says.command ? copyButton(says.command, says.command, `signin-copy-${tool}-${index}`, 'Copy', 'Copied. Run it in a terminal; then Check again.') : null),
    shown ? h('code.signin-command', {}, shown) : null);
}

export function mcpSigninPage() {
  const home = state.home;
  if (!home) return notRead();
  if (!home.sync.managed.length) return h('div.page', {}, noToolsState('mcpsignin'));
  const rows = signinRows(home), tools = columnsOf(home, rows), checked = tools.filter(tool => listCommand[tool]), note = connectedLine(tools);
  if (!rows.length) return h('div.page', {}, emptyState('plug', 'No MCP servers in your tools', 'When a tool here has an MCP server, it is listed here with a Check for that tool.'));
  return h('div.page', {}, h('div.scroll.signin-scroll', { id: 'mcpsignin-scroll' },
    h('div.signin-top', {}, h('div.signin-about', {},
      h('p.signin-intro', {}, 'Whether each tool is signed in to its MCP servers, as the tool’s own command reports it. Nothing runs until you press Check; a check may write the tool’s own logs. Results are kept until Central Knot quits or another home is opened.'),
      note ? h('p.signin-intro', { id: 'signin-connected' }, note) : null),
    checked.length ? button({ label: 'Check all', name: 'Check all: run each tool’s own command, one after another', id: 'signin-check-all', disabled: waitsFor(), onclick: () => void checkColumns(checked) }) : null),
    h('table.signin-table', {},
      h('thead', {}, h('tr', {}, h('th.signin-name', { scope: 'col' }, 'MCP server'), ...tools.map(columnHead))),
      h('tbody', {}, ...rows.map((row, index) => h('tr', { 'data-row': row.id },
        h('th.signin-name', { scope: 'row' }, h('span.signin-server', {}, row.name), row.plugin ? h('span.signin-plugin', {}, `In the plugin ${row.plugin}`) : null),
        ...tools.map(tool => cellView(tool, row, index))))))));
}
