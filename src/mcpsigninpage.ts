// The MCP sign-in page (MAP.md, "MCP sign-in"): a row per MCP server some managed tool has, a column per such tool, each cell what
// that tool's own command said of the server at its column's last Check. Nothing runs when the page opens: Check runs one tool's
// command (main.ts mcp-signin:check → mcpsigninrun.ts checkSignin), Check all runs the columns one after another, one check at a
// time, beside it a (?) holding what a check does on this computer (mcpsignin.ts checkLine) and how many cells need a sign-in now
// (signinsNeeded); a cell that needs a sign-in offers that tool's own command to copy, or, where its cell offers that tool's sign-in
// (mcpsignin.ts offersSignin), Sign in (signIn), with Stop while it waits;
// nothing else is started. Each server (your own or a plugin's) gets the file mark after its name, opening its entry in a full-width row
// under it (signinFiles → filepanel.ts itemFile, filepanel.ts placePanel). What each check
// and sign-in said lives in app.ts state.mcpSignin for the home it was made in, until
// Central Knot quits; nothing is stored. The rows keep the places they had when he came to the page (inPlace). The rows, which cells a check holds for, the
// cells' words, which cells a row has (cellTools), the count, a column's own time, a session-only head, the line, the cards and the
// commands are mcpsignin.ts's; the controls', `MCP server`, Local, `In the plugin …`, the marks' labels, a check's refusal and the
// empty state are this file's.
import { pinnedRows, rerender, state } from './app.ts';
import { brandMark } from './brand.ts';
import { button, emptyState, h, infoMark } from './dom.ts';
import { itemFile, pagePlace, placePanel, type FileMark } from './filepanel.ts';
import { pin } from './itemrow.ts';
import { askedNow, cannotRun, cellNow, cellTools, checkLine, connectedCard, grouped, IN_SESSION, listCommand, LOCAL_CARD, offersSignin, ownTime, SAID,
  SESSION_CARD, signinRows, signinsNeeded, signinStarted, type CellSays, type SigninRow } from './mcpsignin.ts';
import { pagePlatform } from './machine.ts';
import { timeOrDay } from './model.ts';
import { copyButton, noToolsState, notRead } from './pages.ts';
import { toolNames } from './words.ts';
import type { HarnessId, HomeView } from './types.ts';

/** The tools with a column: the managed tools with a cell in some row (mcpsignin.ts cellTools: a sign-in that waits keeps its own), in the tools' order. */
const columnsOf = (home: HomeView, rows: SigninRow[]) => home.mcp.tools.filter(tool => rows.some(row => cellTools(state.mcpSignin, row).includes(tool)));
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
    const checking = checks.checking = { tool, asked: askedNow(state.home, tool) }, began = new Date().toISOString();
    rerender();
    const answer = await window.centralKnot.checkSignin(tool, checks.home, names).catch((error: unknown) => { (checks.failed ??= {})[tool] = String(error instanceof Error ? error.message : error); return null; });
    if (answer) { checks.columns[tool] = { at: new Date().toISOString(), began, answer, asked: checking.asked }; delete checks.failed?.[tool]; }
    checks.checking = undefined;
    if (whole && tool === tools.at(-1)) checks.all = new Date().toISOString();
    rerender();
  }
}

/** Why every Sign in waits: one is under way (one at a time: mcpsigninrun.ts startSignin). */
const signingIn = () => (Object.values(state.mcpSignin.signins ?? {}).some(run => !run.end) ? 'Another sign-in is waiting: finish or stop it first' : false);
/**
 * Starts `tool`'s own sign-in for `row`'s server (main.ts mcp-signin:start → mcpsigninrun.ts startSignin, given the row and the
 * copy the cell shows, never a name, command or path) and keeps it, with how it ended and when, in the checks of the home it was
 * started in (mcpsignin.ts SigninRun). A second press while one is under way does nothing.
 */
async function signIn(tool: HarnessId, row: SigninRow) {
  const checks = state.mcpSignin;
  if (signingIn()) return;
  const run = signinStarted(checks, tool, row);
  rerender();
  run.end = await window.centralKnot.startSignin(tool, checks.home, row.id, run.copy).catch((error: unknown) => ({ notStarted: String(error instanceof Error ? error.message : error) }));
  run.at = new Date().toISOString();
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
  // A pin's `group` holds the row's place here (this list has no headings): the next free one, so a row new since goes last.
  for (const row of now) pin(pins, row.id, pins.rows.size);
  return now.sort((first, second) => pins.rows.get(first.id)!.group - pins.rows.get(second.id)!.group);
}

/** A mark kept on one line with the last word before it, the words before still wrapping: a (?) never stands alone on a line. */
const keep = (words = '', mark: HTMLElement | null) => (mark ? [words.replace(/\S+$/, ''), h('span.signin-keep', {}, words.match(/\S+$/)?.[0], '\u00a0', mark)] : words);

/** The page's three marks, each with its card on the first place it fits and nowhere after: Connected's, Local's and the session-only heads'. */
function marksOnce(tools: HarnessId[]) {
  const cards = { connected: { label: 'Connected', text: connectedCard(tools) }, local: { label: 'Local', text: LOCAL_CARD }, session: { label: 'session-only columns', text: SESSION_CARD } };
  const placed = new Set<keyof typeof cards>();
  return (which: keyof typeof cards) => {
    if (placed.has(which)) return null;
    placed.add(which);
    return infoMark(`signin-${which}-mark`, cards[which].label, cards[which].text);
  };
}
type Mark = ReturnType<typeof marksOnce>;

/**
 * A column's head: the tool's name, then its Check, whose hover is what that check does here (`does`: mcpsignin.ts checkLine of this
 * column), and its own time where it shows one (mcpsignin.ts ownTime); or where a session-only tool's sign-in shows.
 */
function columnHead(tool: HarnessId, mark: Mark, does: string | undefined) {
  const own = ownTime(state.mcpSignin, tool);
  const failed = state.mcpSignin.failed?.[tool];
  const when = state.mcpSignin.checking?.tool === tool ? 'Checking…' : failed ? `Couldn’t run the check: ${failed}` : own ? `Checked ${own}` : '';
  return h('th.signin-head', { scope: 'col', 'data-tool': tool },
    h('span.signin-tool', {}, brandMark(tool, 14), toolNames[tool]),
    listCommand[tool] ? h('span.signin-check', {},
      button({ size: 'small', label: 'Check', name: `Check: run ${toolNames[tool]}’s own command for its MCP servers`, id: `signin-check-${tool}`, disabled: waitsFor(), attrs: { title: does }, onclick: () => void checkColumns([tool]) }),
      when ? h('span.signin-when', { id: `signin-when-${tool}` }, when) : null) : h('span.signin-when', {}, keep(IN_SESSION[tool]?.head, mark('session'))));
}

/** MCP sign-in as a file panel's place (filepanel.ts pagePlace): each server (your own, found or a plugin's) opens its entry under its row. */
const signinFiles = pagePlace('mcpsignin', { foundAndPlugins: true });

/** A row's first cell: the server's name with its file mark bound to its last few letters (or short last segment) so wrapping never orphans it or widens the column, Local, and the plugin it comes in. */
const nameCell = (row: SigninRow, mark: Mark, file?: FileMark) => {
  const seg = file ? /(?:^|[\s-])([^\s-]+-*)$/.exec(row.name)?.[1] ?? row.name : '';
  const tail = seg.length <= 5 ? seg : [...seg].slice(-3).join('');
  return h('th.signin-name', { scope: 'row' },
    h('span.signin-server', {}, ...(file ? [row.name.slice(0, row.name.length - tail.length), h('span.signin-keep', {}, tail, file.mark)] : [row.name])),
    row.transport === 'stdio' ? h('span.signin-local', {}, 'Local', mark('local')) : null,
    row.plugin ? h('span.signin-plugin', {}, `In the plugin ${row.plugin}`) : null);
};

/** Sign in or Try again, which starts the tool's own sign-in, or Stop: a cell's sign-in button (mcpsignin.ts CellSays act). */
function actButton(tool: HarnessId, row: SigninRow, act: NonNullable<CellSays['act']>, id: string) {
  const stop = act.label === 'Stop';
  return button({ size: 'micro', label: act.label, name: stop ? 'Stop the sign-in' : `${act.label}: ${act.runs}`, id, disabled: stop ? false : signingIn(),
    attrs: { title: stop ? 'Ends the sign-in. Closed the browser’s tab before finishing? Stop, then Try again.' : `Runs ${act.runs}; the sign-in opens in your browser` },
    onclick: () => void (stop ? window.centralKnot.stopSignin(state.mcpSignin.home) : signIn(tool, row)) });
}

/** A cell, its id and its buttons' by its row's id, so none follows a place in the list. */
function cellView(tool: HarnessId, row: SigninRow, mark: Mark, offers: boolean) {
  if (!cellTools(state.mcpSignin, row).includes(tool)) return h('td.signin-cell', {});
  const says = cellNow(state.mcpSignin, tool, row, offers);
  // Under the words, with the cell's whole width: an unread line, or the command to copy where no sign-in's button holds it.
  const shown = says.line ?? (says.act ? undefined : says.command);
  const id = `${tool}-${row.id}`;
  const copy = says.command ? copyButton(says.command, says.command, `signin-copy-${id}`, says.act ? 'Copy command' : 'Copy', 'Copied: run it in a terminal') : null;
  // A sign-in's button, with Copy where it has one, on a line of their own under the words; else Copy beside the words. A card
  // opens below the words (dom.ts infoMark data-info-block), a reason's below the whole cell, clear of its Try again.
  const block = { 'data-info-block': '' };
  return h(`td.signin-cell${says.tone ? `.tone-${says.tone}` : ''}`, { id: `signin-cell-${id}`, title: says.title, ...(says.why ? block : {}) },
    h('span.signin-words', says.why ? {} : block, says.words === SAID.connected ? keep(says.words, mark('connected'))
      : says.why ? keep(says.words, infoMark(`signin-why-${id}`, `what ${toolNames[tool]} said`, says.why)) : says.words, says.act ? null : copy),
    says.act ? h('span.signin-acts', {}, actButton(tool, row, says.act, `signin-act-${id}`), copy) : null,
    shown ? h('code.signin-command', {}, shown) : null);
}

export function mcpSigninPage() {
  const home = state.home;
  if (!home || !home.sync.managed.length) {
    placePanel(signinFiles, []);
    return home ? h('div.page', {}, noToolsState('mcpsignin')) : notRead();
  }
  const rows = inPlace(signinRows(home));
  const marks = rows.map(row => itemFile(signinFiles, 'mcp', row.id));
  const file = placePanel(signinFiles, marks);
  if (!rows.length) return h('div.page', {}, emptyState('plug', 'No MCP servers in your tools.', undefined));
  const tools = columnsOf(home, rows);
  const checked = tools.filter(tool => listCommand[tool]);
  const mark = marksOnce(tools);
  const runs = checked.filter(tool => !cannotRun(state.mcpSignin, home, tool));
  const openCode = home.snapshots.find(snapshot => snapshot.harness === 'opencode-cli')?.probe.version, line = checkLine(rows, runs, openCode);
  const all = state.mcpSignin.all, needed = signinsNeeded(rows, state.mcpSignin, runs);
  const platform = pagePlatform(navigator.userAgent), offers = Object.fromEntries(tools.map(tool => [tool, offersSignin(tool, home.mode === 'actual' && home.sync.access.allowed, platform)]));
  return h('div.page', {}, h('div.scroll.signin-scroll', { id: 'mcpsignin-scroll' },
    checked.length ? h('div.signin-top', {},
      h('span.signin-check-all', {},
        button({ label: 'Check all', name: 'Check all: run each tool’s own command, one after another', id: 'signin-check-all', disabled: waitsFor(), onclick: () => void checkColumns(checked, true) }),
        line ? infoMark('signin-line-mark', 'what Check does', line) : null),
      all ? h('span.signin-when', { id: 'signin-checked' }, `Checked ${timeOrDay(all)}`) : null,
      needed ? h('span.signin-need.tone-warning', { id: 'signin-needed' },
        keep(needed.words, needed.stillToCheck ? infoMark('signin-needed-mark', 'the columns still to check', needed.stillToCheck) : null)) : null) : null,
    h('table.signin-table', {},
      h('thead', {}, h('tr', {}, h('th.signin-name', { scope: 'col' }, 'MCP server'), ...tools.map(tool => columnHead(tool, mark, runs.includes(tool) ? checkLine(rows, [tool], openCode) : undefined)))),
      h('tbody', {}, ...rows.flatMap((row, index) => {
        const panel = file && file.mark === marks[index] ? file.panel : null;
        return [
          h(`tr${panel ? '.file-anchored' : ''}`, { 'data-row': row.id }, nameCell(row, mark, marks[index]), ...tools.map(tool => cellView(tool, row, mark, offers[tool]!))),
          panel ? h('tr.signin-file', {}, h('td', { colspan: tools.length + 1 }, panel)) : null,
        ];
      })))));
}
