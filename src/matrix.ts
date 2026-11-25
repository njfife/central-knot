// The item tables (the Library, which lists every kind, and a harness's tabs of one kind): one On/Off switch per item, applied at once
// in every tool Central Knot manages. A row's marks only say what each tool has; each tool's own controls are in the item's
// details, and a click's result comes with an Undo of the whole click wherever History offers one (historyactions.ts says where
// it doesn't: Take over, a take-in from Claude Code's MCP settings). Every kind is on Central Knot's library: its row is a
// library row: librarypages.ts says what each kind supplies, libraryrow.ts what such a row says. The sync notices of the list on
// screen are said in the window's header, not above it: kept, seen and drawn here (the section that starts at toldNotices),
// placed by renderer.ts resultHere. First setup's walkthrough (firstsetup.ts) is a band among a table's bands, given copyQuestion
// to hold the question of the item it is at.
// Usage, collected when a home opens and on Update usage statistics (app.ts collectUsage): when it was collected and the button
// at the toolbar's end, a band an Update opens (closed by its button), a figure on each row and a line per tool in
// an opened row, the Last used and Most used orders (which a reading that lands never redraws: holdOrder), and the "No use seen in 30 days"
// chip with its band and one Turn these off (built from each row's own Off: rowClicks.off); what the reading says of a row, and
// the chip's rule, are usagerow.ts's.
// A table is told the kinds it lists and its tool by its caller (useLibrary, useTab give a Table): the Library's, its segment's
// kinds (its kind switch: kindSwitch; the segment is app.ts state.libraryKind), a tab's, its one kind. Its view is kept here
// (views): the Library's own, and each kind's for its tabs, apart. This module keeps no current kind, view or tool: the header, a
// reading as it lands and Escape ask for the table on screen (useTableShown). A row carries its kind (itemrow.ts ItemRow kind; a
// plugin's row: kindOf), and only a row's own kind says which it is: its words, its tools and its clicks.
// A row's switch or Add joins the page's list of clicks (flip, pluginRowSwitch → app.ts queueClick) and is worked out in its turn,
// perhaps while another table is drawn: its closures hold the row and the table it was clicked on, so it is worked out there.
// The Library's Find is answered by word search in main (search.ts, asked by askFind): while it has text the list is one list,
// best first, under one heading (foundRows), and after it the items of listed plugins installed in no managed tool, which are
// no rows of the Library's (catalogGroup). A tool's tabs match their Find here (holdsFindText); the Files view, itself.
// From (fromChoice: where a row came from, origins.ts) and the chip narrow what Find leaves (picked), and the counts of the kind
// switch, the chips and the headings, and Turn these off, go by that one list (listedRows). A choice of From, a chip or Find's text
// shows its list from the top (listFromTop).
// Select on the Library's list (selection.ts keeps its mode and ticks): a tick in each switch's place and on each heading, its bar
// under the toolbar, and Turn on, Turn off and Delete of many (selectControl, selectBar, turnTicked, deleteTicked), decided by
// cantTurn, alreadyAs and cantDelete; writing controls on an opened row (and Resume, Turn these off) dim via app.ts writeOff. It goes
// by the rows drawn, in their order on screen (drawTable: Table selectable), which holds a pinned row the chip dropped too.
import { brandMark } from './brand.ts';
import { caughtUpNames, clockTime, dayAndTime, dayWords, defaultHistoryDays, groupBy, holdingBuild, noticeNames, plural } from './model.ts';
import { cantUse, choiceEffect, nearestLine, shortQuote } from './copywords.ts';
import { andList, byToolOrder, fewNames, kindNouns, NOTHING_CHANGED, pageNames, profileLeftUse, rowNames, rowNouns, saidByKind, sentence, toolList as toolsInWords, toolNames, toolsPhrase, turnIt, withKind } from './words.ts';
import { allSay, figureFor, incompleteHistory, lastUse, leftToItsRow, pluginRowFacts, toolHistories, usageSummary, USAGE_DAYS, type CantSay, type KindUsage, type ToolHistory, type ToolSays, type UsageFacts, type UsageSummary } from './usagerow.ts';
import { copilotSharesYours, endedProfiles, homeItems, inUse, inUseInHome, itemId, pluginLive } from './profileplan.ts';
import { walkingAt, walkthroughBand } from './firstsetup.ts';
import { noteMove, acting, applyByKind, askFlash, closeResult, KINDS, notDoneFirst, problemKey, leftOutTools, collectUsage, unpin, whyKindReadOnly, whyReadOnly, writeOff, saidInStatusBar, selectOff, tell, toolWays, type Click, type Outcome, type Page, type PageKind, harnessKindShown, noToolManaged, pinnedRows, lastResult, flashRequests, leaveFiles, applyClick, queueClick, rerender, announce, restoreEvent, setSync, shownPath, showFile, showPage, state, syncNow } from './app.ts';
import { takeBack, wantedOn } from './clicklist.ts';
import { afterLayout, button, closeButton, emptyState, fileBlocks, findInput, h, icon, middle, pathText, toggle, whyOff, withToolCount, type Child } from './dom.ts';
import type { IconName } from './icons.ts';
import { byName, byUsage, inOrder, kindSource, lastUpdated, noPins, partId, pin, placeIn, rankIn, rowId, type ItemRow, type KindSource, type Pinned, type RowKey, type RowOrder, type RowUsage, type Tool } from './itemrow.ts';
import { readFlag, writeFlag } from './flags.ts';
import { addLabel, asksWhichCopy, canAdd, copiesDiffer, waitsForSync, fromSourceWords, harnessIs, hashesOf, inLibrary, loadingIn, madeFrom, otherReadLines, ownCopies, placeOf as libraryPlace, rowClicks, statusLine, stillIn, stillReadWords, switchedOffWords, switchLabel, versionClock, type HarnessIs, isPartial } from './libraryrow.ts';
import { libraryPages, type LibraryPage } from './librarypages.ts';
import { versionList, type VersionText } from './versionlist.ts';
import { itemKey, listed, type Version } from './library.ts';
import { keptBack } from './clickplan.ts';
import type { Change, DestinationResult, HomeView, ItemNotice, LibraryFacts, PluginItemNotice, PluginTextView, SearchHit, SyncGate, SyncNotice } from './types.ts';
import type { HarnessId, InstalledPlugin, PartKind, TakenInNotice, UsageReading } from './types.ts';
import { pluginMarketOf, pluginOf } from './sourcelink.ts';
import { heldKinds, takesPlugins } from './presence.ts';
import { closeLineResult, lineBox, lineBusy, listingOf, market, resultKey, resultOn, turnFromLine, wantView } from './pluginstate.ts';
import { lineControl, type LineFacts } from './pluginline.ts';
import { succeeded, type PluginDone, type PluginDraft } from './pluginplan.ts';
import { alongWords, cantSwitch, click as clickPluginItem, clickWords, copilotByName, itemSaid, onNow as itemOn, switchWords, turnEvery, wholeWords, type PluginItemAt } from './pluginswitch.ts';
import { loadsKind, pageOfPart, partOfPage } from './pluginstatus.ts';
import { cellWords, handledWhere, inTool, insideTitle, itemThrough, offIn, pageRows, pluginOnIn, rowCount, pluginTools, throughPluginHere, toolWords, withPluginOnly, yoursIn, type PluginRow } from './pluginrows.ts';
import { fromChoices, fromShows, originOf, type From, type FromEntry } from './origins.ts';
import { sources } from './sourcespage.ts';
import { folded, lineDiff } from './diff.ts';
import { reloadAdvice, rowReload, toItemKind, type ReloadAdvice } from './reload.ts';
import { pageData, readPageData, resetPageData } from './pagedata.ts';
import { ask, askedNow, cancelAsk, cantWords, deletedWords, DIFFERS_REASON, headingState, isTicked, ofListed, questionWords, selectedWords, selecting, listDrawn, startSelecting, stopSelecting, restoreWords, tickHeading, tickRow, toggleWhy, turnedWords, turnLabel, turnTail, whyLines, whyShown, type Listed } from './selection.ts';

const names = toolNames as Record<Tool, string>;

/**
 * Opens a plugin's page on Plugins, where the plugin itself is handled. `marketplace`: its
 * marketplace's name, to find it by when the page lists that marketplace under another spelling of its address.
 */
export function openPlugin({ source, plugin, marketplace }: { source?: string; plugin: string; marketplace?: string }) {
  const listed = listingOf(plugin, marketplace, source);
  market.nav = { source: listed?.source ?? source, marketName: listed ? undefined : marketplace, plugin, tab: 'plugins', find: '', category: undefined };
  showPage('plugins');
}

/** The one mark of a plugin's item on its row: the plugin's glyph and "from <plugin>"; its title says which. */
export const pluginTag = (plugin: string, title: string) => h('span.row-tag.row-part', { title }, icon('puzzle', 12, 'tone-faint'), `from ${plugin}`);

// ---------- What a plugin installed whole brings (pluginrows.ts) ----------
/** A table's plugin rows for the home on screen, every kind's together by name (itemrow.ts byName), and the installs whose copy couldn't be read, once each. */
const plugged = (t: Table) => {
  const each = state.home ? t.kinds.map(kind => pageRows(state.home!, kind)) : [], named = (row: PluginRow) => ({ key: row.name.toLowerCase(), kind: kindOf(row) });
  return { rows: each.flatMap(rows => rows.rows).sort((first, second) => byName(named(first), named(second))), unread: [...new Set(each.flatMap(rows => rows.unread))] };
};


/** Turns a plugin's item on or off in its tool at once, with its own switch or the whole plugin's (pluginswitch.ts). */
function switchPluginItem(item: PluginItemAt, row: ItemRow | PluginRow) {
  const draft: PluginDraft = new Map();
  const on = !itemOn(item);
  clickPluginItem(draft, item);
  const ops = [...draft.values()];
  void applyClick({ kind: kindOf(row), items: [item.name], rows: [rowKey(row)], changes: [], said: itemSaid(item, on, ops), pluginsOnly: true, plugins: { ops }, undone: undoneWords(item.name, on, names[item.tool]) });
}

/** Why an item a tool has through a plugin can't be switched on this page now, if it can't: the switch itself (pluginswitch.cantSwitch), or a home that can't be written. */
const cantSwitchHere = (item: PluginItemAt) => cantSwitch(item) ?? (state.home ? whyReadOnly(state.home) : undefined);

/**
 * The item's switch in one tool, in an opened row, where a click changes only this item there (pluginline.ts): on or off, applied
 * at once, with the tool's own switch for one item or (a skill in Claude Code) the whole plugin's, which its line says first.
 * `row`: the row it is drawn in, whose kind, key and ids it takes.
 */
function pluginItemControls(item: PluginItemAt, row: ItemRow | PluginRow) {
  const id = elId('enable', row, item.tool);
  const on = itemOn(item);
  const why = cantSwitchHere(item);
  const label = `${item.name} in ${names[item.tool]}: ${on ? 'on' : 'off'}. ${why ?? clickWords(item)}`;
  return h('span.details-tool-actions', {},
    h('span.tool-switch', {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, on ? 'On' : 'Off'),
      // A plugin item's own switch writes no kind's record: the home's gate (cantSwitchHere asks it too).
      toggle({ on, label, disabled: why ?? writeOff(homeStops()), onchange: () => switchPluginItem(item, row), id })));
}

/**
 * The plugin an opened row's item comes with, in one line: "varo-risk 1.10.0 · in Claude Code and Copilot CLI · Its page" (a link,
 * to look: each act is on its tool's line), each tool's version where they differ; where no marketplace here lists it, `handled`
 * says how the tools handle it instead (pluginrows.ts handledWhere).
 */
function pluginStrip(plugin: string, marketName: string, installs: InstalledPlugin[], id: string, handled?: string) {
  const versions = new Set(installs.map(install => install.version)), one = versions.size === 1 ? [...versions][0] : undefined;
  const tools = installs.sort((first, second) => byToolOrder(first.tool, second.tool)).map(install => `${names[install.tool]}${!one && install.version ? ` ${install.version}` : ''}`);
  const source = installs.find(install => install.listed)?.source, listed = installs.some(install => install.listed) || !!listingOf(plugin, marketName, source);
  const page = listed ? [h('button.inline-link', { type: 'button', id, onclick: (event: Event) => { event.stopPropagation(); openPlugin({ source, plugin, marketplace: marketName }); } }, 'Its page')] : [];
  const parts: Child[] = [`${plugin}${one ? ` ${one}` : ''}`, tools.length ? `in ${andList(tools)}` : 'installed in no tool here', ...page];
  return h('p.details-limits.details-note.details-part.plugin-strip', {}, icon('puzzle', 12, 'tone-muted'),
    h('span', {}, ...parts.flatMap((part, at) => (at ? [h('span.meta-dot', { 'aria-hidden': 'true' }, '·'), part] : [part])), listed || !handled ? '' : ` ${handled}`));
}

/**
 * The facts a tool's line on a plugin's item is drawn from (pluginline.ts LineFacts): the home's view, and the Plugins page's,
 * read for it while such a row is open (pluginstate.ts wantView, lineBox), with the listing's source a turn names.
 */
function lineFacts(kind: PartKind, plugin: string, marketName: string, tool: HarnessId, through?: PluginItemAt, installed?: InstalledPlugin): LineFacts & { source?: string } {
  wantView(state.home?.readId);
  // Its source as a tool that has it registered spells it, so the listing is this one's where two of one name list the plugin.
  const known = through?.install.source ?? installed?.source ?? state.home?.pluginItems?.find(install => install.plugin === plugin && install.marketName === marketName && install.source)?.source;
  const box = lineBox(plugin, marketName, known, tool), yours = state.home ? yoursIn(state.home, plugin, marketName, tool) : undefined;
  return { tool, kind, plugin, marketName, through, installed, box: box.box, parts: box.parts, source: box.source, ...(yours?.length ? { yours } : {}) };
}

/**
 * A tool's line on a plugin's item (pluginline.ts lineControl), after `lead` (what the tool has): its sentence and its control, the
 * item's switch or a button that names its act; while its click waits or runs, what it is doing, then its result with its Undo
 * (resultLine: pluginstate.ts LineResult). Install, Put its items here and Remove wait their turn (turnFromLine); Turn the plugin on or off is the
 * item's own switch's click (switchPluginItem).
 */
function pluginLine(row: ItemRow | PluginRow, facts: LineFacts & { source?: string }, lead: string, reload: string) {
  const control = lineControl(facts), item = facts.through, busy = lineBusy(facts.plugin, facts.marketName, facts.tool), result = resultLine(row, facts.tool);
  const words = control.control === 'switch' ? (item ? cantSwitch(item) ?? switchWords(item) : '') : control.sentence;
  const text = [lead, busy ?? words, result ? '' : reload].filter(Boolean).join(' ');
  if (control.control !== 'button') return { text, result, control: control.control === 'switch' && item ? pluginItemControls(item, row) : null };
  const { act } = control, whole = act === 'plugin-on' || act === 'plugin-off';
  const run = () => (whole ? switchPluginItem(item!, row) : turnFromLine({ home: state.home!.home, source: facts.source!, marketName: facts.marketName, plugin: facts.plugin, tool: facts.tool, act,
    item: { kind: facts.kind, name: nameOf(row) }, ...(facts.yours?.length ? { yours: facts.yours } : {}) }));
  // Turn the plugin on or off applies at once, as the switch it stands for; the others wait their turn in the page's list.
  const off = whole ? cantSwitchHere(item!) ?? writeOff(homeStops()) : !!busy || (selectOff() ?? queueOff(homeStops())) || (!facts.source && 'Not read yet.');
  return { text, result, control: h('span.details-tool-actions', {},
    button({ variant: 'outline', size: 'micro', label: control.label, id: elId('line', row, facts.tool), disabled: off, attrs: { title: control.sentence }, onclick: (event: MouseEvent) => { event.stopPropagation(); run(); } })) };
}

/**
 * A line's result (pluginstate.ts LineResult) on the tool's line of a row's item, whatever row shows it: a line of its own under the
 * tool's (in the usage line's place), its mark, its words with the one next step, its Undo, and × to close it.
 */
function resultLine(row: ItemRow | PluginRow, tool: Tool) {
  const said = resultOn(tool as HarnessId, { kind: partOfPage[kindOf(row)], name: nameOf(row) });
  return said ? h('p.details-tool-result', { 'data-result': resultKey(said.aim), 'data-failed': String(said.failed) }, icon(said.failed ? 'triangle-alert' : 'check', 12, said.failed ? 'tone-warning' : 'tone-success'),
    h('span.details-tool-result-text', {}, [said.words, said.next].filter(Boolean).join(' ')), said.undo ? smallAction('Undo', elId('line-undo', row, tool), said.undo, '', selectOff() ?? !!acting()) : null,
    closeButton(() => closeLineResult(said), { id: elId('line-close', row, tool), label: 'Close this result' })) : null;
}

/** A plugin's row: an item of a plugin installed whole, not the person's own (pluginrows.ts PluginRow). */
const isPluginRow = (row: ItemRow | PluginRow): row is PluginRow => 'marketName' in row;
/** The one way a drawn row's kind is learned: its own (ItemRow kind), or a plugin's row's page (pluginstatus.ts pageOfPart). */
const kindOf = (row: ItemRow | PluginRow): PageKind => (isPluginRow(row) ? pageOfPart[row.kind] : row.kind);
/** A drawn row's identity, from its kind and key (itemrow.ts rowId): its `data-key`. */
const idOf = (row: ItemRow | PluginRow) => rowId(kindOf(row), row.key);
/** A drawn row by its kind and key, as a click and its result name the rows they are about (app.ts Click rows). */
const rowKey = (row: ItemRow | PluginRow): RowKey => ({ kind: kindOf(row), key: row.key });
/** The id of a drawn row's element (itemrow.ts partId): its part, the row's id, and what within it, a tool or a place. */
const elId = (part: string, row: ItemRow | PluginRow, ...within: string[]) => partId(part, idOf(row), ...within);
/** Plugin items whose file is shown, by row id (a redraw keeps it open): each tool's text once read, and the versions read from. */
const filesShown = new Map<string, { from: string; texts?: { tool: HarnessId; text: string }[] }>();
/** The versions of its plugin a plugin item's file is read from: each tool's installed one. */
const versionsOf = (row: PluginRow) => Object.values(row.installs).map(install => install?.version).join();
/** Reads a plugin item's file from each tool's copy, as installed now. */
function readFile(row: PluginRow) {
  const id = idOf(row), from = versionsOf(row);
  filesShown.set(id, { from });
  const read = (texts: { tool: HarnessId; text: string }[]) => { if (filesShown.get(id)?.from === from) { filesShown.set(id, { from, texts }); rerender(); } };
  void window.centralKnot.pluginItemTexts(row.plugin, row.marketName, row.kind, row.name).then(read, () => read([]));
}
/** Shows or hides a plugin item's file. */
function toggleFile(row: PluginRow) {
  if (!filesShown.delete(idOf(row))) readFile(row);
  rerender();
}

/** A plugin item's details: what it is, where it comes from and is handled, each tool's copy, and its file as each tool's copy has it. */
function pluginDetails(t: Table, row: PluginRow, placement: 'row' | 'dock' = 'row') {
  const [type, ...rest] = row.description.split(' · ');
  // Shown, and its plugin's version changed in some tool since it was read (versionsOf): read again from the copies installed now.
  // A plugin whose version doesn't change with its content (one with none, one Copilot CLI loads live) keeps the text read first.
  if (filesShown.has(idOf(row)) && filesShown.get(idOf(row))!.from !== versionsOf(row)) readFile(row);
  const shown = filesShown.has(idOf(row)), copies = filesShown.get(idOf(row))?.texts;
  const file = row.kind === 'skill' ? 'SKILL.md' : 'agent file';
  // The file shows right under the link that shows it, below the tools' lines, as in the Files view: the switches stay in view.
  const fileShown = !shown ? null : !copies?.length ? h('p.details-limits', {}, copies ? 'Its file couldn’t be read.' : 'Reading…')
    : h('div.plugin-file', { id: elId('pfile', row, 'shown') }, fileBlocks(elId('pfile', row, 'text'), file, copies, holders => `${file} · ${andList(holders.map(holder => names[holder.tool]))}`, { named: copies.length > 1 }));
  return h(`div.compare.details.details-plugin.details-grid${placement === 'row' ? '' : '.details-bare'}`, { role: 'region', 'aria-label': `Details for ${row.name}` },
    h('div.details-head', {},
      h('p.details-status', {}, pluginStatus(t, row)),
      row.kind === 'mcp' && row.description ? h('dl.details-definition', {}, h('dt', {}, 'Type'), h('dd', {}, type === 'Command' ? 'Command (stdio)' : type), h('dt', {}, type === 'Command' ? 'Command' : 'URL'), h('dd.mono', {}, rest.join(' · ')))
        : row.description ? h('p.details-description', {}, row.description) : null,
      excerptLine(t, row),
      pluginStrip(row.plugin, row.marketName, Object.values(row.installs).filter(install => !!install), elId('open-whole', row), handledWhere(row))),
    h('div.details-tools', {}, toolsFor(t, kindOf(row)).map(tool => {
      const at = tool as HarnessId, install = row.installs[at], copy = row.copies[at] ? install : undefined;
      const item: PluginItemAt | undefined = copy && { kind: row.kind, name: row.name, tool: at, install: copy };
      const reload = state.outcome && outcomeShown(state.outcome, t)
        ? rowReload(state.outcome.reloads, row.kind, itemKey(row.name), at, `${row.plugin}@${row.marketName}`, toolWays()) : '';
      const line = pluginLine(row, lineFacts(row.kind, row.plugin, row.marketName, at, item, copy ? undefined : install), item ? toolWords(row, at) : '', reload);
      return h('div.details-tool', {}, h('div.details-tool-head', {},
        h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
        h('span.details-tool-line', {}, line.text), line.control), line.result ?? usageLine(t, row, tool));
    })),
    row.kind === 'mcp' ? null : h('div.details-file', {}, h('div.details-actions', {}, smallAction(shown ? `Hide its ${file}` : `Show its ${file}`, elId('pfile', row), () => toggleFile(row))), fileShown));
}

/** A plugin's item's state in one line, as an ordinary item's opens: "On in Claude Code · off in Copilot CLI · from the plugin document-tools". */
function pluginStatus(t: Table, row: PluginRow): string {
  const items = rowItems(row), tools = toolsFor(t, kindOf(row));
  const on = items.filter(itemOn).map(item => item.tool);
  const off = items.filter(item => !itemOn(item)).map(item => item.tool);
  return [on.length ? `On in ${toolsPhrase(on, tools)}` : `Off in ${toolsPhrase(off, tools)}`, on.length && off.length ? `off in ${toolsPhrase(off, tools)}` : '', `from the plugin ${row.plugin}`].filter(Boolean).join(' · ');
}

/** A plugin item's row: its switch (each tool's switch for one item), its name with the plugin's mark, and a mark per tool. */
function pluginRowEl(t: Table, row: PluginRow) {
  const open = t.view.comparing === idOf(row), tools = toolsFor(t, kindOf(row));
  const mark = (tool: Tool) => {
    const look: MarkLook = !row.copies[tool as HarnessId] ? 'none' : offIn(row, tool as HarnessId) ? 'off' : 'on';
    const drawn = toolMark(look, tool);
    drawn.id = elId('cell', row, tool);
    drawn.title = cellWords(row, tool as HarnessId);
    Object.assign(drawn.dataset, { tool, look, state: { none: 'plugin-none', off: 'plugin-off' }[look as string] ?? 'plugin' });
    return drawn;
  };
  return [
    h(`div.ov-row.ov-switch-row.unmanaged.ov-plugin-row${takeFlash(idOf(row)) ? '.row-flash' : ''}${open ? '.open' : ''}${t.used ? '.ov-usage' : ''}${tickedLook(t, row)}`, { role: 'row', 'data-key': idOf(row), 'aria-expanded': String(open), onclick: rowClick(t, row) },
      h('div.ov-managed', { role: 'cell' }, t.selectable ? tickOf(t, row) : pluginRowSwitch(t, row)),
      h('div.ov-name.ov-name-fit.ov-name-bare', { role: 'cell', title: row.description ? `${row.name}: ${row.description}` : row.name },
        h('span.ov-name-main', {}, kindMark(t, kindOf(row)), h('span.ov-name-text', {}, row.name), kindWord(t, kindOf(row), row.name)),
        pluginTag(row.plugin, insideTitle(row)),
        aboutLine(t, row)),
      t.used ? usedCell(t, row) : null,
      h('div.ov-marks', { role: 'cell' }, h('span.tool-marks', { role: 'img', 'aria-label': tools.map(tool => cellWords(row, tool as HarnessId)).join('. ') }, inColumns(t, tools, mark))),
      h('div.ov-open', { role: 'cell' }, openButton(t, row))),
    open && !docked() ? pluginDetails(t, row) : null,
  ];
}

/** The plugin items' own section, after the person's own items: counted apart, since they come and go with their plugin. */
function pluginSection(t: Table, list: PluginRow[]) {
  if (!list.length) return null;
  return h('div', { role: 'rowgroup' },
    h('div.ov-section.ov-section-plugins', { role: 'row' }, h('div.ov-section-label', { role: 'cell' }, headingTick(t, 'plugins', 'Only through a plugin', list), h('strong', {}, 'Only through a plugin'), h('span.ov-section-count', {}, String(list.length)),
      sectionNote(true, 'installed with their plugin · switched here like any other'))),
    list.flatMap(row => pluginRowEl(t, row)));
}

/** The Library's one heading while its Find has text, over its rows (foundRows), each drawn as under its own heading; its count is listedRows'. */
function foundSection(t: Table, rows: (ItemRow | PluginRow)[]) {
  if (!rows.length) return null;
  return h('div', { role: 'rowgroup' },
    h('div.ov-section', { role: 'row', 'data-section': 'results' }, h('div.ov-section-label', { role: 'cell' }, headingTick(t, 'results', 'Results', rows), h('strong', {}, 'Results'), h('span.ov-section-count', {}, String(listedRows(t).length)))),
    rows.flatMap(each => (isPluginRow(each) ? pluginRowEl(t, each) : row(t, each))));
}

/** Installed plugins whose copy couldn't be read in the tools this table is about: what they bring is missing, and why. */
function unreadBand(t: Table) {
  const list = plugged(t).unread.filter(install => !t.tool || install.tool === t.tool);
  if (!list.length) return null;
  return h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text', {}, list.slice(0, 3).map(install => `What ${install.plugin} brings in ${names[install.tool]} isn’t listed: ${install.problem}`).join(' · ') + (list.length > 3 ? ` · and ${list.length - 3} more` : '')));
}
/** How long ago a time was ("2 min ago", "3 h ago", "yesterday", "5 days ago"), or '' when it isn't known. */
const sinceThen = (at: number) => {
  if (!Number.isFinite(at)) return '';
  const minutes = Math.floor((Date.now() - at) / 60_000), days = Math.floor(minutes / 1440);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : days <= 0 ? `${Math.floor(minutes / 60)} h ago` : days === 1 ? 'yesterday'
    : days < 14 ? `${days} days ago` : days < 60 ? `${Math.floor(days / 7)} weeks ago` : `${Math.floor(days / 30)} months ago`;
};
const ago = (iso: string) => { const said = sinceThen(Date.parse(iso)); return said && `edited ${said}`; };

/** A kind's row in the shape the table works with (itemrow.ts ItemRow): the one place a row is given its kind. */
const fromFacts = (kind: PageKind, facts: LibraryFacts): ItemRow => ({
  kind, key: facts.key, name: facts.name, description: facts.description, fromSource: facts.fromSource, unseen: facts.unseen, plan: facts.plan, takeInAnswers: facts.takeInAnswers, versionChanges: facts.versionChanges, on: facts.on, except: facts.except, cannot: facts.cannot, plugin: facts.plugin, edited: facts.edited,
  blocks: facts.choiceBlocks, hashes: hashesOf(facts.copies), copies: hashesOf(facts.copies),
  paths: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.directory])),
  // An MCP entry has no lines or edit time of its own: the copy question quotes its summary alone.
  versions: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.lines ? { lines: `${copy!.lines} lines`, changed: ago(copy!.modified), at: copy!.modified, text: copy!.summary || facts.description, ...(copy!.body !== undefined ? { body: copy!.body } : {}) } : { lines: '', changed: '', text: copy!.summary }])),
  ownPart: Object.fromEntries(Object.entries(facts.copies).flatMap(([tool, copy]) => (copy!.ownPart?.length ? [[tool, copy!.ownPart]] : []))),
  loads: facts.loads, alsoLoads: facts.alsoLoads, anotherWay: facts.anotherWay, takeOver: facts.takeOver, switchedOff: facts.switchedOff,
});

/** The kind's column header ("Server") and its title ("MCP servers"), from words.ts kindNouns. */
const nouns = Object.fromEntries((['skills', 'mcp', 'agents'] as const).map(each => [each, [kindNouns[each].short[0].replace(/^./, first => first.toUpperCase()), kindNouns[each].title]])) as Record<PageKind, [string, string]>;
const factsCache: Partial<Record<PageKind, { from: unknown; list: ItemRow[] }>> = {};

/** A kind's rows in the home on screen, made once per read of its view. */
function rowsOf(kind: PageKind): ItemRow[] {
  if (!state.home) return [];
  const { facts } = kindSource(state.home, kind);
  // Where a plugin has it on is read from the plugins the tools have, beside the facts (an Off item's words say it).
  if (factsCache[kind]?.from !== facts) factsCache[kind] = { from: facts, list: facts.map(fact => fromFacts(kind, fact)).map(row => ({ ...row, pluginOn: pluginOnIn(state.home, kind, row), getsWithPlugin: withPluginOnly(state.home, kind, row) })) };
  return factsCache[kind]!.list;
}
/** A kind's row by its key, as the home on screen has it now: what a result reads of each row it changed (app.ts runOutcome, stillRead). */
export const rowByKey = (kind: PageKind, key: string) => rowsOf(kind).find(row => row.key === key);
/**
 * A table (useLibrary, useTab): the kinds it lists (the Library's segment's; a tab's one) and the harness whose page it is on
 * (`tool`, none on the Library: its column comes first, and the rows it has before the others), as its caller names them; its
 * view (views); and, as drawTable draws it, whether it has the Used column (`used`: usedColumn), the names rows of two kinds
 * share in it (`shared`: sharedNames) and, while Select's mode is on (selection.ts), the rows it can tick, by selectId, in
 * their order on screen (`selectable`: each row and heading then draws its tick), each worked out once per draw. A
 * row's drawing and its clicks read the row and its table.
 */
interface Table { kinds: PageKind[]; tool?: Tool; view: View; used?: boolean; shared?: Set<string>; selectable?: string[] }
/** Every row the table lists, of each of its kinds, as the kinds' views have them (rowsOf). */
const rowsIn = (t: Table) => t.kinds.flatMap(rowsOf);
/**
 * Each kind a table lists, with what it brings beside its rows: its own record's stop (the home's is said once, by listBands),
 * its problems beside that stop and its part of the usage reading (kindUsage). The bands (listBands), the Used column and
 * the chip's band (usedColumn, unusedBand) go over the kinds here. Kept for the last home, reading,
 * kinds and tool asked for, one entry: the asks for one table share it,
 * and on a segment of one kind the segment's asks and the chips' (overEveryKind) take turns, each working it out again. Not here:
 * a kind's notices, kept as they are first shown (toldNotices).
 */
function kindParts(t: Table) {
  const home = state.home, read = reading(t), of = `${t.kinds.join('+')} ${t.tool ?? ''}`;
  if (!home) return [];
  if (partsWorked?.of !== of || partsWorked.home !== home || partsWorked.read !== read) partsWorked = { of, home, read, parts: t.kinds.map(kind => {
    const gate = home[kind].gate;
    return { kind, stop: gate.state === 'stopped' ? gate.reason : undefined, problems: problemsBesideStop(home[kind].problems, gate),
      usage: kindUsage(t, kind) };
  }) };
  return partsWorked.parts;
}
let partsWorked: { of: string; home: HomeView; read?: UsageReading; parts: { kind: PageKind; stop?: string; problems: string[]; usage?: KindUsage }[] } | undefined;
/** The tools `kind` can be in (itemrow.ts kindSource), the table's tool first: a row's marks and lines are its kind's. */
const toolsFor = (t: Table, kind: PageKind): Tool[] => {
  const list: Tool[] = state.home ? kindSource(state.home, kind).tools : [];
  return t.tool && list.includes(t.tool) ? [t.tool, ...list.filter(tool => tool !== t.tool)] : list;
};
/** The table's columns: every tool one of its kinds can be in, in the home's order with its tool first. A row leaves blank a column its kind can't be in. */
const columns = (t: Table): Tool[] => {
  const any = new Set(t.kinds.flatMap(kind => toolsFor(t, kind)));
  return [...(t.tool && any.has(t.tool) ? [t.tool] : []), ...(state.home?.sync.managed ?? []).filter(tool => any.has(tool) && tool !== t.tool)];
};
/** Whether the table's tool has the item (pluginrows.ts inTool); on the Library, every item counts. */
const inTableTool = (t: Table, skill: ItemRow) => !t.tool || inTool(skill, t.tool as HarnessId);
/** An item as Central Knot's library holds it (library.ts), deleted or not; none for an item only found in a harness. */
const itemOf = (skill: ItemRow) => (state.home ? kindSource(state.home, skill.kind).library[skill.key] : undefined);
/** Where a row stands: 0 on, 1 found (in a tool, not in Central Knot), 2 off: its item's place (libraryrow.ts). */
const standingOf = (skill: ItemRow): 0 | 1 | 2 => ({ on: 0, found: 1, off: 2 } as const)[libraryPlace(itemOf(skill))];
/** The headings, by place. */
const placeNames = ['On', 'Found', 'Off'] as const;
/** A heading of a table: On, Found, Off, (on a harness's page) Not in it, or (on the Library while its Find has text) its one heading, Results (foundSection). */
type Role = 'on' | 'found' | 'off' | 'away' | 'results';
/** The heading a row's own state puts it under: Off; else On or Found; or, on a harness's page, Not in it while that harness has no copy. */
const sectionOf = (t: Table, skill: ItemRow): Role => (standingOf(skill) === 2 ? 'off' : !inTableTool(t, skill) ? 'away' : standingOf(skill) === 0 ? 'on' : 'found');
/** Whether its copies differ so that its Add must ask which copy every tool uses: a found item's only (libraryrow.ts asksWhichCopy). */
const differs = (skill: ItemRow) => asksWhichCopy(skill);
/** Copies differ and need a choice, among the items this page is about: on a harness's page, the ones it has. */
const needsChoice = (t: Table, skill: ItemRow) => inTableTool(t, skill) && differs(skill);

/**
 * How many items one tool has whose copies differ and need a choice: what the "Copies differ" chip counts on that tool's
 * Harnesses page, read from the facts the same way the table reads them.
 */
export function differingIn({ facts }: KindSource, tool: Tool) {
  return facts.filter(fact => inTool(fact, tool as HarnessId) && asksWhichCopy(fact)).length;
}
type Filter = 'all' | 'attention' | 'unused';
/** How many rows of the Library's group "In plugins you don't have" are drawn at first, and added by each "Show 10 more" (catalogGroup). */
const MORE = 10;
const newView = () => ({
  filter: 'all' as Filter,
  /** Where the rows shown came from (fromChoice): Anywhere at launch, and for a view started afresh or in another home. */
  from: 'anywhere' as From,
  /** Find's text: on the Library, asked of word search (askFind); on a tool's tab, matched here (holdsFindText). Changed through newFind. */
  find: '',
  /** How many rows of the Library's group "In plugins you don't have" are drawn (catalogGroup): MORE, and MORE more at each "Show 10 more". */
  revealed: MORE,
  // A row's fields name it by its row id (itemrow.ts rowId).
  /** The row whose details are open. */
  comparing: undefined as string | undefined,
  /** The row whose copy question shows every copy's body side by side (RowWords body). */
  reading: undefined as string | undefined,
  /** The row whose versions list shows every version, not only its newest few. */
  versionsUnfolded: undefined as string | undefined,
  /** The version being read in an opened row (its row, and its place in the list). */
  readingVersion: undefined as { id: string; index: number } | undefined,
  /** The harness whose page this view was last drawn on (undefined: the Library). */
  shownFor: undefined as Tool | undefined,
  /** What the Files view's list of skills is narrowed to (its own Find). */
  listFind: '',
  /** The row whose Delete from Central Knot is waiting for its confirming click. */
  confirmDelete: undefined as string | undefined,
  /** The visit on which a row was last opened or closed (state.visit): a copy question doesn't outlive it. */
  openedOn: 0,
  /** When a row was last opened (state.said.seq): its copy question hides only results said before it. */
  openedAt: 0,
  /** The Files view's "Where each copy is", once the person opens or closes it; until then it follows the pane's width. */
  whereOpen: undefined as boolean | undefined,
});
/** What one table keeps between draws. */
type View = ReturnType<typeof newView>;
/** The views tables keep between draws: the Library's (its Files view's too), and each kind's for its tabs under Harnesses, apart from the Library's. */
const views: Record<PageKind | 'library', View> = { library: newView(), skills: newView(), mcp: newView(), agents: newView() };
/**
 * Opens a harness's page already narrowed, for a harness card's "different copies" link (harnesspage.ts goHarness): the first
 * draw there keeps this filter. The Library opens through openKind.
 */
export const showFiltered = (which: PageKind, filter: Filter, harness: Tool) => { startFresh(views[which], harness); views[which].filter = filter; };
/** A view drawn for another place (a tool's tab, or the Library) starts with no filter, From, Find text, open row or menu from the last one. */
function startFresh(table: View, harness: Tool | undefined) {
  Object.assign(table, { filter: 'all', from: 'anywhere', comparing: undefined, shownFor: harness });
  newFind(table, '');
}
/**
 * The one way into the Library from elsewhere (the Overview's cards and lines, a plugin's page and its row on Plugins, History,
 * the Git repo, Sources): the Library with `which` chosen (a kind, or All: app.ts state.libraryKind), drawn afresh (startFresh:
 * no Find, no chip, From at Anywhere, no open row), narrowed by `filter` ("Copies differ", "No use seen in 30 days") or, on All,
 * by `from` (a plugin's or a source's items: origins.ts pluginFrom, sourceFrom); or with the row `key` open and scrolled into
 * view (a plugin's own row too; a key needs its kind, so All takes none), Find, the chip and From let go only where they hide it
 * (showRow). The row is opened once the page is drawn, as its own click opens it (markOpen): so the
 * first draw in another home, which drops that home's open row, can't drop it, and a row whose copies differ keeps its question.
 */
export function openKind(which: 'all', options?: { filter?: Filter; from?: From }): void;
export function openKind(which: PageKind, options?: { filter?: Filter; key?: string }): void;
export function openKind(which: PageKind | 'all', { filter, key, from }: { filter?: Filter; key?: string; from?: From } = {}) {
  state.libraryKind = which;
  if (key && which !== 'all') { showRow(which, key); return; }
  startFresh(views.library, undefined);
  if (filter) views.library.filter = filter;
  if (from) views.library.from = from;
  showPage('library');
}
/**
 * A link to an item on the Library (first setup's walkthrough: firstsetup.ts goOn; a notice's name; openKind's): the Library's list, out of its
 * Files view, with that item's row open and in view. The segment stays where it lists the item's kind, else goes to All; Find,
 * the chip and From are let go only where they hide the row.
 */
export function showRow(which: PageKind, key: string) {
  if (segment() !== 'all' && segment() !== which) state.libraryKind = 'all';
  if (state.page !== 'library') showPage('library');
  if (state.libraryView === 'files') leaveFiles();
  const t = useLibrary(), id = rowId(which, key), row = [...rowsIn(t), ...plugged(t).rows].find(each => idOf(each) === id);
  if (row) reveal(t, row); else openFromAway(t.view, id);
}
/** A link to a row where the person is (a notice's name, the walkthrough): Find let go only if it hides the row, the chip only if it does, From too. */
function reveal(t: Table, row: ItemRow | PluginRow) {
  if (!matchesFind(t, row)) newFind(t.view, '');
  if (!chipShows(t, row)) t.view.filter = 'all';
  if (!fromHolds(t, row)) t.view.from = 'anywhere';
  openFromAway(t.view, idOf(row));
}
/** Opens a row once the page is drawn, as its own click opens it (markOpen), and brings it to the list's top: every link to a row ends here. */
function openFromAway(view: View, id: string) {
  markOpen(view, id);
  rerender();
  requestAnimationFrame(() => document.querySelector(`.ov-row[data-key="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' }));
}
/** The Library's segment as drawn: the kind chosen (app.ts state.libraryKind), or All where no tool here can hold it. */
export const segment = (): PageKind | 'all' => (state.home && state.libraryKind !== 'all' && heldKinds(state.home).includes(state.libraryKind) ? state.libraryKind : 'all');
/** The kinds the Library lists: its segment's; for All, each kind a managed tool here can hold (presence.ts heldKinds). */
const segmentKinds = (): PageKind[] => { const shown = segment(); return shown !== 'all' ? [shown] : state.home ? heldKinds(state.home) : [...KINDS]; };
/** The page the tables were last drawn on. */
let tablesVisit = -1;

// ---------- Visual vocabulary ----------

const smallAction = (label: string, id: string, onclick: () => void, extra = '', disabled: boolean | string = false) =>
  h(`button.text-action${extra}`, { type: 'button', id, disabled: !!disabled, ...whyOff(disabled), onclick: (event: Event) => { event.stopPropagation(); onclick(); } }, label);

// ---------- The toolbar ----------

/**
 * On the Library, the table over every kind it holds, whatever the segment (a tool's tab keeps its kind): what a chip is offered
 * over, so a segment it leaves at 0 doesn't drop it (each count is the segment's), and an empty Library's bands.
 */
const overEveryKind = (t: Table): Table => (t.tool || !state.home ? t : { ...t, kinds: heldKinds(state.home) });
const chipNames = { attention: 'Copies differ', unused: `No use seen in ${USAGE_DAYS} days` } as const;
/**
 * The chips: each shows only what it names and is a toggle, a second click letting go (one at a time; none shows every row). Each
 * has a short form, its mark, for a crowded toolbar: the whole group folds together (dom.ts fitBars), with each name as its tooltip.
 */
function filterBar(t: Table) {
  const view = t.view, over = overEveryKind(t);
  // How many a chip shows: of what Find and From leave, in the segment (listedRows with that chip on), as the kind switch counts.
  const shows = (id: Filter) => listedRows({ ...t, view: { ...view, filter: id } }).length;
  // `count`: how many it shows, amber when they need something (`warn`).
  const chip = (id: Filter, label: string, glyph: IconName, count: number, warn = false) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn && count ? '.chip-warn' : ''}`,
    { type: 'button', id: `chip-${id}`, 'aria-pressed': String(view.filter === id), 'aria-label': `${label} ${count}`, 'data-tip': label, onclick: () => relist(t, { filter: view.filter === id ? 'all' : id }) },
    icon(glyph, 13, 'chip-icon'), h('span.chip-label', {}, label), heldCount('span.chip-count', String(count), listedRows({ ...over, view: { ...view, filter: id, from: 'anywhere', find: '' } }).length));
  // A chip is offered while something matches it, over every kind the Library holds (overEveryKind), or while it is the one on.
  const offered = (id: Filter, matching: boolean) => matching || view.filter === id;
  const chips = [offered('attention', copiesDifferChipShown(over)) ? chip('attention', chipNames.attention, 'diff', shows('attention'), true) : null,
    offered('unused', !!reading(over) && !!unusedCount(over.kinds)) ? chip('unused', chipNames.unused, 'history', shows('unused')) : null].filter(Boolean);
  return chips.length ? h('div.chips', { role: 'group', 'aria-label': 'Show only' }, chips) : null;
}

/** The From menu's entries for the home on screen: Anywhere, Your own, then its groups (origins.ts fromChoices; its sources: sourcespage.ts sources). */
const fromMenu = (): FromEntry[][] => {
  const { plugins, sources: links } = state.home ? fromChoices(state.home, sources.view?.sources.map(source => source.link) ?? []) : { plugins: [], sources: [] };
  return [[{ value: 'anywhere', label: 'Anywhere' }, { value: 'yours', label: 'Your own' }], plugins, links];
};
/** Whether a choice of From is in the menu now: a plugin's while it has rows here, a source's while the home records it. */
const fromOffered = (from: From) => fromMenu().flat().some(entry => entry.value === from);
/**
 * From or a chip chosen (`choice`): an opened row the new list no longer holds is closed, its armed Delete with it, as Find's in
 * drawTable; and the new list shows from its top (listFromTop).
 */
function relist(t: Table, choice: Partial<Pick<View, 'from' | 'filter'>>) {
  Object.assign(t.view, choice);
  if (!listedRows(t).some(row => idOf(row) === t.view.comparing)) Object.assign(t.view, { comparing: undefined, confirmDelete: undefined });
  listFromTop(t);
  rerender();
}
/**
 * The one rule for a choice of which rows a table lists (From and a chip: relist; Find's text: findTyped): the new list shows from
 * its top, the place the old one was scrolled to meaning nothing in it. A draw keeps each list where it was (renderer.ts), and Back
 * lets go of a place it is putting back once its list moves (places.ts), so the list on screen is put at its top before the draw.
 * Not Sort, which lists the same rows under the same headings; nor the kind switch, whose list has an id of its own (tableId).
 */
const listFromTop = (t: Table) => { const list = document.getElementById(tableId(t)); if (list) list.scrollTop = 0; };
/** Whether the table's From shows a row, by where it came from (origins.ts originOf). */
const fromHolds = (t: Table, row: ItemRow | PluginRow) => fromShows(t.view.from, originOf(row));

/**
 * The From menu, between the chips and Sort, on the Library and a tool's tabs: kept in the table's view, applied with the chip
 * (picked). Closed, it is as wide as its widest entry whatever is chosen, so a choice never changes the bar's fit, and has a chip's
 * on look while it narrows the list (style.css .from-select). A choice shows its list from the top, the opened row closed if it hides it (relist).
 */
function fromChoice(t: Table) {
  const menu = fromMenu(), chosen = menu.flat().find(entry => entry.value === t.view.from) ?? menu[0]![0]!;
  const option = (entry: FromEntry) => h('option', { value: entry.value, selected: entry === chosen, title: entry.title }, entry.label);
  const [top, plugins, links] = menu, group = (label: string, entries: FromEntry[]) => (entries.length ? h('optgroup', { label }, entries.map(option)) : null);
  const choose = (event: Event) => relist(t, { from: (event.target as HTMLSelectElement).value as From });
  return h('span.from', {}, h('label.from-word', { for: 'item-from' }, 'From'),
    h(`span.select.select-bar.from-select${chosen.value === 'anywhere' ? '' : '.from-on'}`, {}, h('select', { id: 'item-from', 'aria-label': 'From', title: chosen.title ?? chosen.label, onchange: choose },
      top!.map(option), group('Plugins', plugins!), group(pageNames.sources, links!)), icon('chevrons-up-down', 14)));
}

/**
 * A count on the toolbar (the kind switch's, a chip's) holding the room of `most`, the most it says with no Find, From or chip:
 * what they leave never changes the bar's width, so a choice never changes its height (dom.ts fitBars).
 */
function heldCount(tag: string, counted: string, most: number) {
  const count = h(tag, {}, counted);
  count.style.minWidth = `${String(most).length}ch`;
  return count;
}

/** Each kind's mark: before a Library row's name, on the kind switch and on the Overview's cards. */
export const kindGlyph: Record<PageKind, IconName> = { skills: 'wand-sparkles', mcp: 'plug', agents: 'bot' };
/** A row's small, faint mark of its kind on the Library, named by its kind (a tab lists one kind, and has none). */
const kindMark = (t: Table, kind: PageKind) => (t.tool ? null : h('span.kind-mark', { role: 'img', 'aria-label': kindNouns[kind].one, title: kindNouns[kind].one }, icon(kindGlyph[kind], 13)));
/** A row's kind in words beside its name where a row of another kind in the list has that name ("review · agent"), as a run's words name it. */
const kindWord = (t: Table, kind: PageKind, name: string) => (t.shared?.has(name.toLowerCase()) ? h('span.row-kind', {}, kindNouns[kind].one) : null);
/** A row's name as its click's result says it: with its kind after it where kindWord writes the kind (words.ts withKind). */
const nameSaid = (t: Table, kind: PageKind, name: string) => (t.shared?.has(name.toLowerCase()) ? withKind({ kind, name }) : name);
/** The names rows of two kinds share in a table (a plugin's own rows too), lower-cased: where kindWord writes the kind. */
const sharedNames = (t: Table) => {
  const kindsOf = groupBy([...rowsIn(t), ...plugged(t).rows], row => nameOf(row).toLowerCase());
  return new Set([...kindsOf].filter(([, rows]) => new Set(rows.map(kindOf)).size > 1).map(([name]) => name));
};

/**
 * The Library's kind switch, first in its toolbar: All and each kind a managed tool here can hold (presence.ts heldKinds), its
 * words always shown (dom.ts fitBars folds the chips' words first, then the captions of From and Sort, then wraps the bar, the
 * switch first). Each counts the rows of its kind that Find, From and the chip leave (listedRows: a row kept only by a pin is
 * none), with "?" after it where its own record or a
 * tool's file of it couldn't be read, as the Overview's tools table says. None with one kind.
 */
function kindSwitch(t: Table) {
  const home = state.home, kinds = home ? heldKinds(home) : [];
  if (!home || t.tool || kinds.length < 2) return null;
  const every: Table = { ...t, kinds }, count = (kind: PageKind, view = t.view) => listedRows({ ...every, kinds: [kind], view }).length;
  const whole = (kind: PageKind) => count(kind, { ...t.view, filter: 'all', from: 'anywhere', find: '' });
  const unread = (kind: PageKind) => notAllRead(home, kind);
  // A kind not on show whose automatic change wasn't painted is marked, as the sidebar's dot says (renderer.ts).
  const news = (id: PageKind | 'all') => id !== 'all' && !t.kinds.includes(id) && unseenNotices(id).length > 0;
  const choice = (id: PageKind | 'all', label: string, glyph: IconName, counted: number, most: number, unsure: boolean) => h(`button.kind-seg${segment() === id ? '.kind-seg-on' : ''}`, {
    type: 'button', id: `library-kind-${id}`, 'aria-pressed': String(segment() === id), title: unsure ? `${label}: ${counted} known; some couldn’t be read` : news(id) ? `${label}: an automatic change to see` : undefined,
    onclick: () => { state.libraryKind = id; rerender(); } }, icon(glyph, 13, 'tone-muted'), h('span.kind-seg-label', {}, label), heldCount('span.kind-seg-count', `${counted}${unsure ? '?' : ''}`, most), news(id) ? h('span.kind-seg-news') : null);
  const sum = (each: (kind: PageKind) => number) => kinds.reduce((total, kind) => total + each(kind), 0);
  return h('div.kind-switch', { role: 'group', 'aria-label': 'Kind' }, choice('all', 'All', 'layers', sum(count), sum(whole), kinds.some(unread)),
    ...kinds.map(kind => choice(kind, kindNouns[kind].title, kindGlyph[kind], count(kind), whole(kind), unread(kind))));
}

/** Whether what this home holds of a kind isn't all known: a tool's file of it, or its own record, couldn't be read (not the home's record, which stops every kind alike). */
export const notAllRead = (home: HomeView, kind: PageKind) => !!home[kind].unread.length || (home[kind].gate.state === 'stopped' && home.sync.gate.state !== 'stopped');

/**
 * What stops a control's write, named at each control: a row's controls ask their kind's (kindStops: the home's, or that kind's
 * own record, which stops its writes alone: app.ts whyKindReadOnly); the few that write no kind's record ask the home's
 * (homeStops), each saying why where it does.
 */
const homeStops = () => !state.home || !!whyReadOnly(state.home);
const kindStops = (kind: PageKind) => !state.home || !!whyKindReadOnly(state.home, kind);
/** A row's own switch or Add takes a click while a run of clicks goes on (app.ts queueClick): off only under other work, or by `stops`. */
const queueOff = (stops: boolean) => stops || !!state.busy;
/**
 * Why Delete from Central Knot can't take a row now, in the row's own words, or none where it can: the one rule the Delete in an
 * opened row (libraryDelete) and Select's Delete of many (selection.ts ofListed) ask. Not a plugin's own row; not while its kind's
 * record, or the home's, stops writes (kindStops, said by stopFor); not a found item, which has nothing in Central Knot to delete.
 */
const cantDelete = (row: ItemRow | PluginRow): string | undefined => (isPluginRow(row) ? 'Only through a plugin'
  : stopFor(row.kind) ?? (inLibrary(itemOf(row)) ? undefined : 'not in Central Knot'));
/**
 * Why Turn on or Turn off of many can't take a row now, or none where it can: a plugin's row or a row whose turn would send a
 * plugin switch (pluginswitch.ts turnEvery); a kind stopped from writing (stopFor); a found row on Turn off; or, on Turn on, a
 * found row whose copies differ or that can't be added yet. The one function selectBar and headingTick ask.
 */
function cantTurn(t: Table, row: ItemRow | PluginRow, on: boolean): string | undefined {
  const pluginWhy = (plugin: string) => `comes with the plugin “${plugin}”: use its row’s own switch`;
  if (isPluginRow(row)) return pluginWhy(row.plugin);
  const through = throughItems(t, row);
  if (through.length) return pluginWhy(through[0]!.install.plugin);
  const stop = stopFor(row.kind);
  if (stop) return stop;
  if (libraryPlace(itemOf(row)) !== 'found') return undefined;
  if (!on) return 'not in Central Knot';
  if (isDiffering(row)) return DIFFERS_REASON;
  return canAdd(row) ? undefined : 'nothing can be added yet';
}
/** Whether a row is already in the state a bulk Turn asks for (a partly-on library row is already on; a plugin row follows its switch). */
const alreadyAs = (row: ItemRow | PluginRow, on: boolean) => (isPluginRow(row) ? rowItems(row).some(itemOn) === on : libraryPlace(itemOf(row)) === (on ? 'on' : 'off'));
/**
 * What stops a kind's writes (app.ts whyKindReadOnly) as a row's reason before anything is tried: the stop alone ("the agents
 * record is damaged"), without what its band adds of what was not done (words.ts NOTHING_CHANGED).
 */
function stopFor(kind: PageKind) {
  const why = state.home ? whyKindReadOnly(state.home, kind) : 'Not read yet.';
  return why?.replace(` ${NOTHING_CHANGED}`, '').replace(/\.$/, '').replace(/^./, first => first.toLowerCase());
}

/** What could not be done, item by item (the first four, then how many more), as a warning band. */
export const problemsBand = (problems: DestinationResult[]) => h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
  h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · ') + (problems.length > 4 ? ` · and ${problems.length - 4} more` : '')));

/** Where an item's details are drawn: under its row, docked beside the table, or in the Library's Files view. */
type Placement = 'row' | 'dock' | 'files';

/** An item whose copies differ between tools, so the person chooses one (never one held as it is). */
const isDiffering = (skill: ItemRow) => differs(skill);

/**
 * The Files view's parts for one skill, in the order they read: its details (status, versions), then where each copy is and
 * Delete from Central Knot. Stacked, the file comes first and all of them below it; a wide pane (style.css data-columns)
 * puts them in its column beside the file, one under the other.
 */
function filesLayout(t: Table, skill: ItemRow, where: Node[]): { head: Node | null; tail: Node[] } {
  const remove = libraryDelete(t, libraryPages[skill.kind], skill);
  return { head: details(t, skill, 'files'), tail: [wherePaths(t, skill, where, true), remove ? h('div.details-actions', {}, remove) : null].filter((part): part is HTMLElement => !!part) };
}

/** Where each copy lives, folded away: paths matter less than what each tool has. `extra` folds in more about them (Files view). */
function wherePaths(t: Table, skill: ItemRow, entries: Node[] = [], inFiles = false) {
  // The Files view names each copy once, with all it knows about it (pages.ts copyEntry); elsewhere a line per tool.
  const shown = inFiles ? [] : toolsFor(t, skill.kind).filter(tool => skill.paths?.[tool]);
  if (!shown.length && !entries.length) return null;
  // MCP: the settings files are where a server is changed, so they show open. Skills and agents fold them away, except in
  // the Files view's wide pane, whose details column has the room: there they start open, until the person says otherwise.
  // In the Files view an open or closed one stays as the person left it; until then it follows the pane (settleFilesColumns).
  const open = skill.kind === 'mcp' || (inFiles && t.view.whereOpen === true);
  const paths = h('details.details-paths', open ? { open: true } : {}, h('summary', { onclick: () => { if (inFiles) t.view.whereOpen = !(paths as HTMLDetailsElement).open; } }, icon('chevron-right', 12, 'tone-faint'), skill.kind === 'mcp' ? 'Settings files' : 'Where each copy is'),
    shown.map(tool => pathLine(tool, skill.paths![tool]!)), entries);
  return paths;
}

/** A path shown whole, wrapping only after a "/", never inside a folder's name (unless one name is wider than its column). */
export const wrappingPath = (path: string) => {
  const parts = shownPath(path).split('/');
  // Each folder name with its "/" is one unit (style.css .wrap-part): a line breaks only between them.
  return h('span.wrap-path', { title: path }, ...parts.map((part, index) => h('span.wrap-part', {}, index < parts.length - 1 ? `${part}/` : part)));
};

/** One file: the tool's name, its path in full, and a way to find it in the file manager. */
function pathLine(tool: Tool, path: string) {
  return h('p.details-path-line', {}, brandMark(tool, 12), h('span.details-path-tool', {}, names[tool]), pathText(shownPath(path), path), showInFolder(path));
}

/** Show in folder: reveals a file in the file manager; nothing is opened or changed. */
const showInFolder = (path: string) => h('button.inline-link.details-path-show', { type: 'button', title: 'Show this file in the file manager; nothing is opened or changed', onclick: (event: Event) => { event.stopPropagation(); showFile(path); } }, 'Show in folder');


/**
 * `to` with the words `from` lacks marked (`keep` 'added'), or `from` with the words `to` lacks ('removed'): what an MCP edit
 * changed in a command, and the words only one agent copy has.
 */
function markedWords(from: string, to: string, keep: 'removed' | 'added'): Child[] {
  const parts = lineDiff(from.split(/(\s+)/).join('\n'), to.split(/(\s+)/).join('\n')).filter(part => part.kind === 'same' || part.kind === keep);
  // Neighbouring marked words are one mark, the spaces between them inside it and those at either end left outside.
  const runs = parts.reduce<{ marked: boolean; text: string }[]>((all, part, index) => {
    const between = !part.text.trim() && parts[index - 1]?.kind === keep && parts[index + 1]?.kind === keep;
    const marked = part.kind === keep || between, last = all.at(-1);
    if (last?.marked === marked) last.text += part.text; else all.push({ marked, text: part.text });
    return all;
  }, []);
  return runs.flatMap(run => { if (!run.marked) return [run.text]; const [, lead, core, tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!; return [lead, core ? h(`span.change-${keep}`, {}, core) : '', tail].filter(Boolean); });
}

/**
 * The stretch of a marked line that starts at character `start` and is `length` long, each mark kept as it is around what is
 * left of its words. `parts` are markedWords' strings and marks: their text, joined, is the line character for character,
 * which is what the offsets rest on.
 */
function cutMarked(parts: Child[], start: number, length: number): Child[] {
  let at = 0;
  return parts.flatMap((part): Child[] => {
    const text = part instanceof Node ? part.textContent ?? '' : String(part);
    const kept = text.slice(Math.max(0, start - at), Math.max(0, start + length - at));
    at += text.length;
    if (!kept || !(part instanceof Node)) return kept ? [kept] : [];
    const mark = part.cloneNode(false);
    mark.textContent = kept;
    return [mark];
  });
}

/**
 * An MCP entry as a row of the copy question shows it: its kind in words ("Command", "HTTP"), then its command or address set
 * as one: whole, monospace, a line breaking only at a space or after a "/" (style.css .wrap-part), never inside "--flag". The
 * words only this entry has are marked against the other entry most like it.
 */
function entryWords(summary: string, others: string[]): Child[] {
  const split = (entry: string) => { const [label, ...rest] = entry.split(' · '); return { label, value: rest.join(' · ') }; };
  const { label, value } = split(summary);
  const nearest = nearestLine(value, others.map(other => split(other).value));
  // Each word is one unit, and so is each folder of a path with the "/" that ends it (a path's first "/" and an address's
  // "//" stay with what follows): a line breaks only between units. A run of marked words keeps one mark around its units.
  const units = (words: string) => words.split(/(\s+)/).filter(Boolean).flatMap((word): Child[] => (word.trim() ? word.split(/(?<=[^/:]\/)(?=[^/])/).map(part => h('span.wrap-part', {}, part)) : [' ']));
  const parts = nearest === undefined ? [value] : markedWords(nearest, value, 'added');
  return [h('span.version-entry-kind', {}, `${label} · `), h('code.version-command', {}, ...parts.flatMap(part => (part instanceof Node ? [h('span.change-added', {}, ...units(part.textContent ?? ''))] : units(String(part)))))];
}

/**
 * What a row of the copy question quotes from one copy, to tell it from the others. How much of it is copywords.ts shortQuote's
 * to decide; cutMarked only carries an agent line's marks across that cut.
 *  - an MCP server: its command or address (entryWords);
 *  - a library item: the first line of its body (an agent's prompt) only this copy has, the words only it has marked against
 *    the others' line most like it (or, with no such line, a line the others have that it lacks); with the same body, its
 *    summary (an agent's description);
 *  - a skill: the first line of its body.
 */
function copyQuote(skill: ItemRow, tool: Tool, others: Tool[]): Child[] | undefined {
  const versions = skill.versions ?? {};
  const text = versions[tool]?.text;
  // A command or address is quoted whole: its row is the only place the question shows it.
  if (skill.kind === 'mcp') return text ? entryWords(text, others.map(other => versions[other]?.text ?? '')) : undefined;
  const inMarks = (said: string) => { const { lead, words, tail } = shortQuote(skill.kind, said); return `“${lead}${words}${tail}”`; };
  const body = versions[tool]?.body;
  if (body !== undefined) {
    const lines = (from?: string) => (from ?? '').split('\n').map(line => line.trim()).filter(Boolean);
    const theirs = others.map(other => lines(versions[other]?.body));
    const [line, ...further] = lines(body).filter(mine => theirs.some(other => !other.includes(mine)));
    if (line !== undefined) {
      const nearest = nearestLine(line, theirs.flat());
      const marked = nearest === undefined ? [line] : markedWords(nearest, line, 'added');
      // Where this line parts from the one most like it, so a line too long to quote whole is quoted there: at the words only
      // this copy has or, having none, where that line's own words would go. Both rows then quote the same stretch of text.
      const partsAt = (parts: Child[]) => { const at = parts.findIndex(part => part instanceof Node); return at < 0 ? undefined : parts.slice(0, at).join('').length; };
      const differsAt = partsAt(marked) ?? (nearest === undefined ? undefined : partsAt(markedWords(line, nearest, 'added')));
      const { lead, words, tail, start } = shortQuote(skill.kind, line, differsAt);
      return [`“${lead}`, ...cutMarked(marked, start, words.length), `${tail}”${further.length ? ` and ${further.length} more ${further.length === 1 ? 'line' : 'lines'}` : ''}`];
    }
    const missing = theirs.flat().find(other => !lines(body).includes(other));
    if (missing) return [`Without ${inMarks(missing)}`];
  }
  return text ? [inMarks(text)] : undefined;
}

/**
 * The copy question, for an item whose copies differ: the question ("Which copy of <name> should every tool use?", or "both
 * tools") and its note, then one row per choice, each saying what it does, and doing it at once; the latest copy's is the main
 * one. Copies that are the same are one choice. Its layout at each width is style.css "The copy question"; its words' rules are
 * copywords.ts. `then`: run once a choice's click is done (first setup's walkthrough goes on). `prefix`: its controls' ids' own
 * part, "walk-" in first setup's walkthrough, which draws the question while the row's own may be open (copyQuestion).
 */
function compareChoices(t: Table, skill: ItemRow, inFiles = false, then?: () => void, prefix = '') {
  const versions = skill.versions ?? {}, tools = toolsFor(t, skill.kind), view = t.view;
  // The copies that count: each tool's own, but where a tool can't take the item (it keeps its own copy).
  const compared = tools.filter(tool => skill.copies[tool] !== undefined && !skill.cannot?.[tool]);
  const groups = [...groupBy(compared, tool => skill.hashes?.[tool] ?? tool).values()];
  // A choice turns it on everywhere: every tool that can hold it and has no copy gets the chosen one.
  const receiving = tools.filter(tool => !skill.cannot?.[tool] && skill.copies[tool] === undefined);
  // The copy changed last is the engine's answer (library.ts latestCopy, in the take-in answer); none where no date tells.
  const asked = skill.takeInAnswers?.click, waiting = asked && 'wait' in asked ? asked : undefined;
  const latest = groups.find(([tool]) => skill.hashes?.[tool] === waiting?.latest);
  // When a group's content was made, for its line, as latestCopy compared it: its files' time where those told the latest (the
  // copies' times tied), else when its earliest copy was changed.
  const dateByFiles = ([tool]: Tool[]) => waiting?.datedByFiles?.[skill.hashes?.[tool] ?? ''];
  const editedAt = groups.map(group => dateByFiles(group) ?? Math.min(...group.map(tool => Date.parse(versions[tool]?.at ?? ''))));
  // The line under each name, in one form: the copy's size (where the sizes differ) and when it was edited ("7 lines · edited
  // 2 days ago"); none for an MCP entry, which has neither. The copy edited most recently has the line's one emphasis.
  const sizesDiffer = new Set(groups.map(([tool]) => versions[tool]?.lines)).size > 1;
  const factsOf = (tool: Tool, at: number) => [sizesDiffer ? versions[tool]!.lines : '', Number.isFinite(at) ? `edited ${sinceThen(at)}` : versions[tool]!.changed];
  const facts = groups.map(([tool], index) => (versions[tool] ? factsOf(tool, editedAt[index]).filter(Boolean).join(' · ') : ''));
  // The copies say when each was edited, and the latest one is marked.
  const lib = libraryPages[skill.kind], id = idOf(skill);
  const newest = groups.length > 2 ? 'Newest' : 'Newer';
  const about = (group: Tool[]) => {
    const said = facts[groups.indexOf(group)];
    if (!said) return null;
    return group === latest ? h('span.version-meta.version-latest', {}, `${said} · ${newest}`) : h('span.version-meta', {}, said);
  };
  const choice = (group: Tool[]) => {
    const [tool] = group;
    const tools = andList(group.map(entry => names[entry]));
    // A row's columns: whose copy (and what tells it apart), what it says (and what choosing it does), then Use this copy.
    const who = h('span.version-who', {}, h('span.version-head', {}, ...group.map(entry => brandMark(entry, 14)), h('strong', {}, group.length > 1 ? `${tools} (same copy)` : `${tools}’s copy`)), about(group));
    // A block counts only for a tool it syncs to that can load the skill.
    const block = skill.blocks?.[tool]?.find(entry => !skill.except.includes(entry.tool) && !skill.cannot?.[entry.tool]);
    // A copy that can't be chosen keeps its row: why, where its quote would be, and no Use this copy.
    if (block) return h('button.version.version-blocked', { type: 'button', id: elId(`${prefix}use`, skill, tool), disabled: true, title: block.reason },
      who, h('span.version-says', {}, h('span.version-effect.version-why', {}, icon('circle-alert', 12, 'tone-warning'), cantUse(block.reason))));
    const others = compared.filter(entry => !group.includes(entry));
    // A tool whose copy is one it has another way keeps it: Central Knot writes nothing there (library.ts, "held").
    const replaced = others.filter(entry => !skill.anotherWay?.[entry]), keeping = others.filter(entry => skill.anotherWay?.[entry]);
    const said = copyQuote(skill, tool, others);
    return h('button.version', { type: 'button', id: elId(`${prefix}use`, skill, tool), 'aria-label': `Use ${tools}’s copy`, disabled: !!writeOff(kindStops(skill.kind)), ...whyOff(selectOff()), onclick: () => void applyClick(turnOn(t, skill, tool)).then(then) },
      who,
      h('span.version-says', {},
        said ? h('span.version-text', {}, ...said) : null,
        h('span.version-effect', {}, choiceEffect(replaced.map(entry => names[entry]), receiving.map(entry => names[entry]), keeping.map(entry => names[entry])))),
      h(`span.version-cta${group === latest ? '.version-cta-main' : ''}`, { 'aria-hidden': 'true' }, 'Use this copy'));
  };
  // Comparing comes before choosing: the full copies side by side, a click from the choices (the Files view shows them already;
  // a kind with one, skills, opens it there). A kind with neither (MCP servers) quotes each whole in its row.
  const every = compared.length > 2 ? 'Read every copy' : 'Read both copies';
  const read = inFiles ? null : lib.files ? smallAction(every, elId(`${prefix}diff`, skill), () => openFiles(skill.key), '.compare-read')
    : lib.words.body ? smallAction(view.reading === id ? 'Hide the copies' : every, elId(`${prefix}diff`, skill), () => { view.reading = view.reading === id ? undefined : id; rerender(); }, '.compare-read') : null;
  const bodies = lib.words.body && view.reading === id
    ? h('div.compare-copies', { id: elId(`${prefix}copies`, skill) }, fileBlocks(elId(`${prefix}body`, skill), lib.words.body, compared.map(tool => ({ tool, text: versions[tool]?.body ?? '' })), holders => `${lib.words.body} · ${andList(holders.map(holder => names[holder.tool]))}`, { named: true }))
    : null;
  return h('div.compare-block', {},
    h('p.compare-title', {}, icon('circle-question-mark', 14, 'tone-warning'), h('span', {}, 'Which copy of ', prefix ? `the ${lib.words.item} ` : '', h('strong.item-name', {}, skill.name ?? skill.key), ` should ${compared.length + receiving.length > 2 ? 'every tool' : 'both tools'} use?`)),
    // The choice takes it into Central Knot: the copies not chosen become its versions, each of which can be made current later.
    h('p.compare-note', {}, `Choosing applies at once: the ${lib.words.item} is taken into Central Knot with that copy, and turned on everywhere. The other copies are kept as its versions.`),
    h('div.compare-choices', {}, groups.map(choice)),
    read, bodies);
}

/** The copy question of the found item of `kind` keyed `key`, for first setup's walkthrough (firstsetup.ts): `then` runs once a choice's click is done. */
export function copyQuestion(t: Table, kind: PageKind, key: string, then: () => void): HTMLElement | null {
  const skill = rowByKey(kind, key);
  return skill && isDiffering(skill) ? compareChoices(t, skill, false, then, 'walk-') : null;
}

/** Whether an open row's details dock beside the table: the content is wide enough (renderer.ts sets state.wide). */
const docked = () => state.wide;
/**
 * Whether an open item's details sit under its row: always in a narrow window, and at every width for a copy question, so the
 * question opens where the switch was clicked.
 */
const underRow = (t: Table, id: string) => !docked() || rowsIn(t).some(skill => idOf(skill) === id && isDiffering(skill));

/**
 * The open row's details in a panel beside the table: its name and a close button, then everything the inline details
 * show, so the item's actions sit with it and a wide window's width is used.
 */
function itemDock(t: Table, skill: ItemRow) {
  const name = skill.name ?? skill.key;
  return h('aside.dock', { 'aria-label': `Details for ${name}` },
    h('header.dock-head', {},
      h('div.dock-title', {}, h('h2', {}, middle(name)), h('p', {}, nouns[skill.kind][0])),
      closeButton(() => { t.view.comparing = undefined; rerender(); }, { id: 'dock-close', label: `Close details for ${name}`, title: 'Close' })),
    h('div.scroll.dock-scroll', { id: 'dock-scroll' }, details(t, skill, 'dock')));
}

/** A plugin item's details docked beside the table, as an item's are. */
function pluginDock(t: Table, row: PluginRow) {
  return h('aside.dock', { 'aria-label': `Details for ${row.name}` },
    h('header.dock-head', {},
      h('div.dock-title', {}, h('h2', {}, middle(row.name)), h('p', {}, `${nouns[kindOf(row)][0]} · from ${row.plugin}`)),
      closeButton(() => { t.view.comparing = undefined; rerender(); }, { id: 'dock-close', label: `Close details for ${row.name}`, title: 'Close' })),
    h('div.scroll.dock-scroll', { id: 'dock-scroll' }, pluginDetails(t, row, 'dock')));
}

/** A row opened (or, `id` none, closed) on this visit: a copy question it asks stays until the page is left (itemsTable). */
const markOpen = (view: View, id: string | undefined) => Object.assign(view, { comparing: id, openedOn: state.visit, openedAt: state.said.seq });
/** Opening a row's details brings them into view, so a choice below the fold is not missed. */
function openRow(t: Table, row: ItemRow | PluginRow) {
  const id = idOf(row), view = t.view;
  markOpen(view, view.comparing === id ? undefined : id);
  rerender();
  // The table moves the least that shows the details: by what runs past its bottom, but never past the row's top (less its
  // scroll margin), so the row's name stays in view. At once, not gliding: a redraw meanwhile would stop a glide short. Docked
  // details sit beside the table and are always in view.
  if (view.comparing && underRow(t, id)) requestAnimationFrame(() => {
    const rowEl = document.querySelector(`.ov-row[data-key="${CSS.escape(id)}"]`), list = rowEl?.closest('.scroll');
    const details = rowEl?.nextElementSibling, box = list?.getBoundingClientRect();
    if (!rowEl || !details || !list || !box) return;
    const past = details.getBoundingClientRect().bottom - box.bottom;
    const room = rowEl.getBoundingClientRect().top - box.top - parseFloat(getComputedStyle(rowEl).scrollMarginTop);
    if (past > 0) list.scrollTop += Math.min(past, room);
  });
}

/** A library item's tag after its name, when it isn't plainly on everywhere (libraryrow.ts placeTag). */
function libraryTag(t: Table, skill: ItemRow) {
  const tag = libraryPages[skill.kind].say.placeTag(skill, itemOf(skill), toolsFor(t, skill.kind), leftOutTools());
  return tag ? h('span.row-tag', { title: tag.title }, tag.text) : null;
}
/** The tag after an item's name while a version waits at the source it is linked to, or once its source removed it (libraryrow.ts fromSourceWords). */
function sourceTag(skill: ItemRow) {
  const tag = skill.fromSource && fromSourceWords(skill.fromSource).tag, plugin = skill.fromSource && pluginOf(skill.fromSource.link);
  return tag ? h(`span.row-tag.row-tag-source${plugin ? '.row-tag-plugin' : ''}`, { title: tag.title }, icon('link-2', 12, plugin ? 'tone-muted' : 'tone-warning'), tag.text) : null;
}
/** The opened row's line saying which source an item is from, and whether a version waits there or it removed the item, with its link to that source's page (a plugin's: its strip, pluginStrip). */
function fromSourceLine(skill: ItemRow, from: NonNullable<ItemRow['fromSource']>) {
  const said = fromSourceWords(from), page = said.page;
  return h('p.details-limits.details-note', {}, icon('link-2', 12, from.waits || from.removed ? 'tone-warning' : 'tone-muted'), h('span', {}, said.before,
    page ? h('button.inline-link', { type: 'button', id: elId('from-source', skill), title: from.link, onclick: () => showPage(page) }, pageNames[page]) : null, said.after));
}

/** The plugins a library row's item comes with: the one it is from (library.ts A PLUGIN), and those a tool has it through, each once, with each tool's install of it. */
function rowPlugins(skill: ItemRow) {
  const link = skill.fromSource?.link ?? '', from = pluginOf(link) ? [{ plugin: pluginOf(link)!, marketName: pluginMarketOf(link)! }] : [];
  const named = [...from, ...Object.values(skill.plugin ?? {}).flatMap(given => (given ? [{ plugin: given.plugin, marketName: given.marketplace }] : []))];
  return named.filter((each, at) => named.findIndex(other => other.plugin === each.plugin && other.marketName === each.marketName) === at)
    .map(each => ({ ...each, installs: (state.home?.pluginItems ?? []).filter(install => install.plugin === each.plugin && install.marketName === each.marketName) }));
}

/**
 * An item's name cell. The name gives way last: as the column narrows, the description shortens (and in every row at
 * once steps aside, settleDescriptions: a name longer than half its cell is cut only while descriptions show), a tag after
 * the name wraps out of sight, and only then does the name shorten (style.css .ov-name-fit). Its full text is always in the tooltip. Nothing in it is a control: the row's switch and chevron
 * are its only ones, so Copies differ is said here, not clicked.
 */
function nameCell(t: Table, skill: ItemRow, attention: boolean) {
  const name = skill.name ?? skill.key;
  return h('div.ov-name.ov-name-fit.ov-name-bare', { role: 'cell', title: skill.description ? `${name}: ${skill.description}` : name },
    h('span.ov-name-main', {}, kindMark(t, skill.kind),
      h('span.ov-name-text', {}, name), kindWord(t, skill.kind, name),
      attention ? h('span.row-tag.row-tag-differs', { id: elId('decide', skill) }, 'Copies differ') : null),
    libraryTag(t, skill),
    sourceTag(skill),
    aboutLine(t, skill));
}
/**
 * The line after a row's name: its description; or where Find found the row only in its file's text, that text's excerpt,
 * marked "In its text:" (the description stays in the name's tooltip and the opened row). Cut to the row's one line as a
 * description is, and left out with every description where they have no room (settleDescriptions): the opened row has it then.
 */
const aboutLine = (t: Table, row: ItemRow | PluginRow) => about(excerptOf(t, row), row.description);
/** The line after a name, a catalog item's too (catalogRow): its text's excerpt, marked "In its text:", else its description. */
const about = (excerpt: string | undefined, description: string) => (excerpt ? h('span.ov-name-about.ov-excerpt', { title: `In its text: ${excerpt}` }, ...inItsText(excerpt))
  : description ? h('span.ov-name-about', { title: description }, description) : null);
/** An opened row's line of its file's text, where Find found the row only there (excerptOf). */
const excerptLine = (t: Table, row: ItemRow | PluginRow) => { const excerpt = excerptOf(t, row); return excerpt ? h('p.details-description.details-excerpt', {}, ...inItsText(excerpt)) : null; };
/** An excerpt as a row and its details show it: led by a faint "In its text:". */
const inItsText = (excerpt: string) => [h('span.excerpt-mark', {}, 'In its text:'), ` ${excerpt}`];

/** The chevron that opens or closes a row's details, at the row's end. */
function openButton(t: Table, row: ItemRow | PluginRow) {
  const open = t.view.comparing === idOf(row);
  return h('button.row-open', { type: 'button', id: elId('open', row), 'aria-label': `${open ? 'Hide' : 'Show'} details for ${nameOf(row)}`, 'aria-expanded': String(open), onclick: (event: Event) => { event.stopPropagation(); openRow(t, row); } },
    icon(open ? 'chevron-down' : 'chevron-right', 14, 'tone-faint'));
}

/** Moving to another harness starts its tabs' tables fresh, whichever was drawn last (the Library's is apart). */
export function resetTablesForHarness() {
  for (const each of KINDS) startFresh(views[each], views[each].shownFor);
}

/** A note after a section heading, after one separating dot spaced the same on both sides; not `shown`, only its room (section). */
const sectionNote = (shown: boolean, ...children: (Node | string)[]) => h(`span.ov-section-after${shown ? '' : '.ov-section-room'}`, shown ? {} : { 'aria-hidden': 'true' }, h('span.ov-section-dot', { 'aria-hidden': 'true' }, '·'), ...children);

export { brandMark };

/**
 * Whether the open page still shows a result. It stands until the page changes, the next action, or it is dismissed; it
 * steps aside while a copy choice of a row it is about is open, and in the Files view for a skill it is not about (its rows).
 */
function outcomeShown(outcome: Outcome, t: Table | undefined): boolean {
  if (outcome.page !== state.page) return false;
  const about = (id: string) => (outcome.rows ?? []).some(row => rowId(row.kind, row.key) === id);
  // A newer result (an Undo that brings the question back) is still said.
  const choosing = t?.view.comparing && (outcome.said ?? 0) <= t.view.openedAt && about(t.view.comparing) && rowsIn(t).some(skill => idOf(skill) === t.view.comparing && differs(skill));
  if (choosing) return false;
  return !(state.libraryView === 'files' && state.item && !about(rowId('skills', state.item)));
}

/**
 * The pages whose last result is in the window's header (renderer.ts resultHere), never in a band above their list: the item
 * pages, Harnesses (but a tool's Instructions tab, whose result sits on its card) and Plugins (pluginspage.ts pluginsResult).
 */
export const resultInHeader = () => state.page === 'library' || state.page === 'plugins'
  || (state.page === 'harnesses' && !(state.harness && state.harnessTab === 'instructions'));

/** One tool's Copy button (icon and title carry "Copy"); flashes check and announces on click. */
function reloadButton(item: { chip: string; command: string; title: string }, id: string): HTMLElement {
  const control = button({ variant: 'outline', size: 'micro', icon: 'copy', label: item.chip, name: `${item.chip}. ${item.title}`, id,
    attrs: { title: item.title, 'data-copy': item.command }, onclick: (event: Event) => {
      event.stopPropagation();
      void navigator.clipboard.writeText(item.command).then(() => {
        control.classList.add('is-copied'); control.firstElementChild?.replaceWith(icon('copy-check', 14)); announce(`Copied ${item.command}.`);
        setTimeout(() => { control.classList.remove('is-copied'); control.firstElementChild?.replaceWith(icon('copy', 14)); }, 1500);
      }, () => announce('Could not copy. Select the text instead.'));
    } });
  return control;
}

/** One non-wrapping line of per-tool reload chips for the folded header, with +N more opening Show all on overflow. */
export function reloadChips(advice: ReloadAdvice, of: typeof state.shownWhole): HTMLElement | null {
  const chips = advice.items.flatMap(item => [
    ...(item.chip ? [{ chip: item.chip, command: item.command, title: item.title!, id: `outcome-copy-${item.tool}` }] : []),
    ...(item.more ?? []).map((extra, at) => ({ ...extra, id: `outcome-copy-${item.tool}-${at + 1}` })),
  ]);
  const view = (chip: { chip: string; command?: string; title: string; id: string }) =>
    (chip.command ? reloadButton({ chip: chip.chip, command: chip.command, title: chip.title }, chip.id) : h('span.reload-chip', { title: chip.title }, chip.chip));
  return chips.length ? h('div.result-reloads', {},
    h('span.result-copies', {}, chips.map(view)),
    h('button.inline-link.reload-more', { type: 'button', id: 'outcome-reload-more', hidden: true, onclick: (event: Event) => { event.stopPropagation(); state.shownWhole = of; rerender(); } }, '')) : null;
}

/** Per-tool reload lines for Show all and off-header bands: the table's sentence, then its Copy buttons if it has any. */
export const reloadLines = (advice: ReloadAdvice): HTMLElement | null => (advice.items.length
  ? h('div.reload-list.result-copies', {}, advice.items.map(item => h('div.reload-row', {}, h('span.reload-row-text', {}, item.text),
    item.command ? reloadButton({ chip: item.chip!, command: item.command, title: item.title! }, `outcome-copy-${item.tool}`) : null,
    ...(item.more ?? []).flatMap((extra, at) => (extra.command ? [reloadButton({ ...extra, command: extra.command }, `outcome-copy-${item.tool}-${at + 1}`)] : []))))) : null);

/**
 * The last action's result as a band, when it offers something to do; a result that only tells is in the status bar. While a
 * table is on screen (useTableShown), its open copy choice hides an older result. On a list page it is drawn in the header only
 * (listResult); the pages that draw it in a band are the others. `cardResult`: a result said in the notices' card where the notice
 * acted on was (noticeLines), whatever the page shows; unmarked so the status bar says it too (app.ts paintStatusMessage), with no
 * ×, its actions only while it is the last result.
 */
export function outcomeBand(cardResult?: Outcome, omitProfile = false): HTMLElement | null {
  const outcome = cardResult ?? state.outcome;
  if (!outcome || (!cardResult && !outcomeShown(outcome, useTableShown())) || saidInStatusBar(outcome)) return null;
  // Item names are tokens in result text too, so "files" does not read as a word.
  const names = [...new Set([...(outcome.item ? [outcome.item] : []), ...(outcome.items ?? [])])].filter(Boolean).sort((a, b) => b.length - a.length);
  const text: (string | Node)[] = [];
  let rest = omitProfile && outcome.profileLine ? outcome.text.slice(0, -outcome.profileLine.length).trimEnd() : outcome.text;
  // Quoted text (a commit's subject, say) is shown as written: a name inside it isn't an item named.
  const quoted = (at: number) => { const open = rest.lastIndexOf('“', at); return open >= 0 && rest.indexOf('”', open) > at; };
  while (rest) {
    const firstOutside = (name: string) => [...rest.matchAll(new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'))].map(match => match.index!).find(at => !quoted(at)) ?? -1;
    const hits = names.map(name => ({ name, at: firstOutside(name) })).filter(hit => hit.at >= 0).sort((a, b) => a.at - b.at);
    if (!hits.length) { text.push(rest); break; }
    text.push(rest.slice(0, hits[0].at), h('strong.item-name', {}, hits[0].name));
    rest = rest.slice(hits[0].at + hits[0].name.length);
  }
  // In the header its reasons are its problem lines (listResult); in a band, each is a line of its own under it.
  const reasons = resultInHeader() ? [] : (outcome.reasons ?? []).flatMap(reason => [' ', h('span.band-reason', {}, typeof reason === 'string' ? reason : [h('strong.item-name', {}, reason[0]), reason[1]])]);
  // Two buttons take their own line under the words in a narrow window (style.css), so the sentence is never squeezed.
  return h(`div.band.band-done${outcome.next ? '.band-two' : ''}`, { role: 'status', 'data-outcome': cardResult ? undefined : outcome.kind ?? '' }, outcome.warn ? icon('triangle-alert', 14, 'tone-warning') : icon('check', 14, 'tone-success'), h('span.band-text', {}, ...text,
    // The space before the note sits outside it, so a note kept whole on its line never carries the last word with it.
    outcome.note ? [' ', h('span.tone-faint', {}, outcome.note.replace(/ History\.$/, ' '), h('button.inline-link', { type: 'button', id: 'outcome-note-history', onclick: (event: Event) => { event.stopPropagation(); showPage('history'); } }, 'History'), '.')] : null, reasons),
    outcome === state.outcome && h('span.band-actions', {},
      outcome.act ? button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, disabled: outcome.act.whyOff?.() ?? acting(), attrs: outcome.act.title ? { title: outcome.act.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.act!.run(); } })
        : outcome.undo ? smallAction(outcome.undo.label, 'outcome-undo', () => void restoreEvent(outcome.undo!.id), undefined, !!acting())
        : outcome.history ? smallAction(outcome.refused ? 'History' : 'Undo in History', 'outcome-history', () => showPage('history')) : null,
      outcome.next ? button({ variant: 'outline', size: 'small', label: outcome.next.label, id: outcome.next.id, attrs: outcome.next.title ? { title: outcome.next.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.next!.run(); } }) : null),
    cardResult ? null : closeButton(closeResult, { id: 'outcome-dismiss' }),
    outcome === state.outcome && !resultInHeader() && outcome.reloads ? reloadLines(reloadAdvice(outcome.reloads, toolWays())) : null);
}

/**
 * Sync off: what waits, and the two ways on. Shown on every managed page, since the switch covers all of them. One height whatever
 * it says (style.css .band-sync-off): one line, the count, then every name as far as the line goes, cut with "…"; the whole
 * sentence, every name in it, is its tooltip.
 */
function syncOffBand(t: Table): HTMLElement | null {
  if (!state.home || state.home.syncOn) return null;
  const waiting = rowsIn(t).filter(waitsForSync);
  const editedIn = (skill: ItemRow) => (skill.edited?.length ? `, edited in ${andList(skill.edited.map(tool => names[tool]))}` : '');
  const what = waiting.flatMap((skill, index) => [index ? ', ' : '', h('strong.item-name', {}, skill.name ?? skill.key), editedIn(skill)]);
  const text = h('span.band-text', {}, ...(waiting.length
    ? [`Automatic sync is off. ${waiting.length} ${waiting.length === 1 ? 'change' : 'changes'} waiting: `, ...what, '.']
    : ['Automatic sync is off. Edits and deletions in your tools will wait here.']));
  text.title = text.textContent!;
  return h('div.band.band-sync-off', { role: 'status' }, icon('circle-minus', 14, waiting.length ? 'tone-warning' : 'tone-muted'), text,
    waiting.length ? button({ variant: 'outline', size: 'small', label: 'Sync once', id: 'sync-now', disabled: acting(), attrs: { title: 'Copy the waiting change once; automatic sync stays off' }, onclick: () => void syncNow() }) : null,
    (() => { const on = smallAction('Turn sync on', 'sync-turn-on', () => void setSync(true)); on.title = 'Copy waiting changes now and keep syncing from here on'; return on; })());
}

/**
 * What the background passes copied where it was missing, every kind's items, and where (model.ts caughtUpNames): shown on the
 * Harnesses list with the view that brought it (the next read brings only what passes did since), until dismissed; once
 * dismissed, it comes back only for a different catch-up (other items, or other tools). Null when there is none, or once dismissed.
 */
export function caughtUpBand(home: HomeView): HTMLElement | null {
  const { items, tools } = caughtUpNames(home);
  const key = `caught-up:${items.join(',')}:${tools.join(',')}`;
  if (!items.length || state.dismissed.has(key)) return null;
  return h('div.band', { role: 'status' }, icon('check', 14, 'tone-success'),
    h('span.band-text', {}, `Caught up: copied ${items.length > 4 ? `${items.slice(0, 4).join(', ')} and ${items.length - 4} more` : andList(items)} to ${tools.length ? andList(tools.map(tool => names[tool])) : 'the tools that were missing them'}, because ${items.length === 1 ? 'it is' : 'they are'} on.`),
    closeButton(() => { state.dismissed.add(key); rerender(); }, { id: 'caught-up-dismiss' }));
}

/**
 * A kind's problems (what couldn't be read) but the reason of the stop a page says on its own line (`gate`), so it is said once:
 * the bands above a table say the kind's own stop (a library file that can't be read is both), the Overview the home's.
 */
export const problemsBesideStop = (problems: string[], gate: SyncGate) => problems.filter(problem => gate.state !== 'stopped' || problem !== gate.reason);

/** The bands above a table, from its kind's view (listView). Its sync notices are the header's (headerNotices). */
function listBands(t: Table) {
  const home = state.home!, parts = kindParts(t), several = parts.length > 1, bands: HTMLElement[] = [];
  const walk = walkthroughBand(t.kinds, (kind, key, then) => copyQuestion(t, kind, key, then));
  for (const band of [syncOffBand(t), walk]) if (band) bands.push(band);
  // What is the home's is said once, whatever the kinds listed.
  if (!home.sync.access.allowed) bands.push(h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, home.sync.access.reason)));
  // A record that stops every write (damaged, newer, another generation): the home's, or a kind's own (that kind's alone, led
  // by its kind where several are listed); said once, here, and not again among the problems.
  const stops = home.sync.gate.state === 'stopped' ? [home.sync.gate.reason] : saidByKind(parts.flatMap(part => (part.stop ? [[part.kind, part.stop] as [PageKind, string]] : [])), several);
  for (const stop of stops) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, stop)));
  const resume = resumeBand(t);
  if (resume) bands.push(resume);
  for (const problem of saidByKind(parts.flatMap(part => part.problems.map(problem => [part.kind, problem] as [PageKind, string])), several)) {
    bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), h('span.band-text', {}, problem)));
  }
  const unread = unreadBand(t);
  if (unread) bands.push(unread);
  return bands.length ? h('div.bands', {}, bands) : null;
}

/**
 * A list page's last result, for the header (renderer.ts resultHere): its band, then its problem lines (what its click could not
 * do, then its reasons: app.ts Outcome), or else, with neither on show, what a background pass could not do (any kind's), until its
 * × closes them or a read no longer has them (app.ts setHome).
 */
export function listResult(): HTMLElement[] {
  // The last results, the page's: on the Library every kind's, whatever the segment, as a run there is one (app.ts placeNow);
  // on a tool's tab its kind's. A line is led by its kind where the result is of several kinds (its lines', and a run's: app.ts
  // Outcome kinds), so two alike are told apart.
  const table = useTableShown(), kinds = !table ? [] : table.tool || !state.home ? table.kinds : heldKinds(state.home);
  const kept = kinds.flatMap(kind => (lastResult(kind)?.results ?? []).filter(keptBack).map(problem => ({ kind, problem })));
  const foldProfile = state.outcome !== undefined && state.shownWhole !== state.outcome && !!state.outcome.profileLine;
  const done = outcomeBand(undefined, foldProfile), several = new Set([...kept.map(each => each.kind), ...(done ? state.outcome?.kinds ?? [] : [])]).size > 1;
  // The background's lines wait while a result or a click's problem line is on show, and come back with the next read after it.
  const background = !table || done || kept.length ? [] : backgroundProblems();
  // A tool's refusal is said in parts (problemLines): its kind where several, the item's name, then its tool and what failed. A
  // removal Automatic sync keeps trying is said as its own, so it never reads as a click's result come back.
  const refusal = (problem: DestinationResult, kind?: PageKind): Child[] => [several && kind ? `${kindNouns[kind].title}: ` : '', h('strong.item-name', {}, problem.item), `${problem.harness ? ` (${names[problem.harness]})` : ''}: ${problem.message}`];
  const said = ({ problem, retried }: (typeof background)[number]): Child[] => (retried
    ? [`Automatic sync still couldn’t remove ${names[problem.harness!]}’s copy of `, h('strong.item-name', {}, problem.item), '. Central Knot will try again.'] : refusal(problem));
  const lines: (Child[] | string)[] = [...background.map(said), ...kept.map(({ kind, problem }) => refusal(problem, kind)),
    ...(done ? state.outcome?.reasons ?? [] : []).map(reason => (typeof reason === 'string' ? reason : [h('strong.item-name', {}, reason[0]), reason[1]]))];
  // With no result above them, their × closes them and the click's result they belong to.
  const close = () => { for (const { problem } of background) state.dismissed.add(problemKey(problem)); closeResult(); };
  const of = done ? state.outcome : kept.length ? lastResult(kept[0]!.kind) : background[0]?.problem;
  const whole = of !== undefined && state.shownWhole === of;
  const advice = done && state.outcome?.reloads ? reloadAdvice(state.outcome.reloads, toolWays()) : undefined;
  const hasAdvice = !!advice?.items.length;
  // With no problem line, Show all follows the sentence, for one the header cuts or whose reload sentences live under Show all.
  if (done && !lines.length) done.querySelector('.band-text')!.after(wholeToggle(state.outcome, 0, hasAdvice));
  const chips = !whole && advice ? reloadChips(advice, of) : null;
  const profileLine = done && !whole ? state.outcome?.profileLine : undefined;
  const profileAt = profileLine ? profileLine.lastIndexOf(' stopped being the ') : -1;
  const profile = profileLine ? h('span.band-profile', { title: profileLine }, h('span.band-profile-name', {}, profileLine.slice(0, profileAt)), h('span.band-profile-rest', {}, profileLine.slice(profileAt))) : null;
  const problem = lines.length ? h(`div.band${chips || profile ? '.result-row2' : ''}`, { role: 'status' }, profile, icon('triangle-alert', 14, 'tone-warning'), problemLines(lines, of, hasAdvice), chips, done ? null : closeButton(close, { id: 'problems-dismiss' })) : null;
  const row2 = whole && advice ? reloadLines(advice) : problem ? null : profile ? h('div.result-row2.result-profile-row', {}, profile, chips) : chips;
  return [done, row2, problem].filter((band): band is HTMLElement => !!band);
}

/**
 * What the background passes could not do, as the latest read reports it (types.ts SyncView caughtUp), but what its × closed: each
 * failure; a removal that failed, where the read names its kind (`of`), only while the item's row still owes it (its plan removes it
 * from that tool: a later pass may have done it, or the item is On or deleted since). `retried`: such a removal Automatic sync
 * keeps trying, said in its own words (listResult).
 */
export const backgroundProblems = () => (state.home?.sync.caughtUp ?? [])
  .filter(entry => entry.outcome !== 'written' && entry.outcome !== 'removed' && !state.dismissed.has(problemKey(entry)))
  .flatMap(problem => {
    const removal = problem.removal && problem.outcome === 'failed' && problem.harness;
    if (!removal || !problem.of) return [{ problem, retried: false }];
    const owed = !!rowByKey(problem.of, itemKey(problem.item))?.plan?.remove.includes(problem.harness!);
    return owed ? [{ problem, retried: !!state.home?.syncOn }] : [];
  });

/**
 * What went wrong, under a result in the header (renderer.ts resultHere): its first line, on the header's second line, then
 * Show all; shown whole (`of`, their result: app.ts state.shownWhole), every line whole. A line given in parts is what leads it,
 * its item's name (`.item-name`), then what happened to it (the last part): folded, only the name gives way (style.css).
 */
export function problemLines(lines: (Child | Child[])[], of: typeof state.shownWhole, hasAdvice = false): HTMLElement {
  const whole = of !== undefined && state.shownWhole === of, shown = whole ? lines : lines.slice(0, 1);
  const text = (line: Child | Child[]) => h('span.problem-text', {}, Array.isArray(line) ? [...line.slice(0, -1).map(part => (typeof part === 'string' ? h('span', {}, part) : part)), h('span.problem-rest', {}, line.at(-1))] : line);
  return h(`span.band-text.band-lines${whole ? '.lines-whole' : ''}`, {}, shown.map((line, at) => h('span.problem-line', {}, text(line), at === shown.length - 1 ? wholeToggle(of, lines.length, hasAdvice) : null)));
}

/**
 * The one Show all of a result in the header, after the last thing it shows (the sentence, or a problem line): "Show all 3 reasons"
 * where `count` lines wait, else drawn only when the header cuts what it shows or holds reload lines under Show all (renderer.ts, data-when-cut); Show less on the card.
 */
export function wholeToggle(of: typeof state.shownWhole, count: number, hasAdvice = false): HTMLElement {
  const whole = of !== undefined && state.shownWhole === of, more = count > 1;
  return h('button.inline-link', { type: 'button', id: 'problems-show-all', 'aria-expanded': String(whole), 'data-when-cut': whole || more ? undefined : '', 'data-has-advice': hasAdvice && !whole ? '' : undefined, onclick: () => { state.shownWhole = whole ? undefined : of; rerender(); } },
    whole ? 'Show less' : `Show all${more ? ` ${count} reasons` : ''}`);
}

/** The kind Resume's empty pass goes through, whatever is on show: a held one whose own record can run, so a kind's stop isn't read as Resume's answer. */
const resumeKind = (t: Table) => (state.home && heldKinds(state.home).find(kind => state.home![kind].gate.state !== 'stopped')) || t.kinds[0]!;
/** The record is intact but this app has no memory of it: Resume carries on from it (any switch does too). */
function resumeBand(t: Table): HTMLElement | null {
  const gate = state.home?.sync.gate;
  if (gate?.state !== 'needs-resume') return null;
  return h('div.band', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, gate.reason),
    // Resume carries on from the home's record: the home's gate.
    button({ variant: 'outline', size: 'small', label: 'Resume', id: 'resume', disabled: writeOff(homeStops()), onclick: () => void applyClick({ kind: resumeKind(t), changes: [], items: [], rows: [], said: 'Resumed: sync carries on from the record as it is.' }) }));
}

/** The bands above a table: every item list reads its table's view (listView). */
const bands = (t: Table) => (state.home ? listBands(t) : null);

/** The home each view, and the kept notices, were last drawn for. */
const tableHomes: Partial<Record<keyof typeof views | 'notices', string>> = {};
/**
 * What a table keeps belongs to one home: opening another starts each view with no open row, no armed Delete and From at Anywhere, and every
 * kind's kept notices go at once, whatever kinds were on show (the pins and the last results go in app.ts accept).
 */
function forgetOtherHomes(t: Table, name: keyof typeof views) {
  const now = state.home?.home, was = tableHomes[name];
  if (tableHomes.notices !== now) { keptNotices.clear(); foldedNotices.clear(); tableHomes.notices = now; }
  if (now === was) return;
  tableHomes[name] = now;
  // A view's first table has no other home's to forget (a link may have opened its row before it was drawn).
  if (was !== undefined) Object.assign(t.view, { comparing: undefined, confirmDelete: undefined, from: 'anywhere' });
}

// ---------- See change: what an edit did, before Undo ----------
const changes = new Map<string, { before: string; after: string } | null>();
const openChanges = new Set<string>();

/** A quiet link that opens the edit's before and after under the notice or History row. A skill's only (`kind`): its store keeps SKILL.md. */
export function seeChangeLink(eventId: string, kind: PageKind | undefined, asLink = false) {
  if (!eventId || kind !== 'skills' || changes.get(eventId) === null) return null;
  const open = openChanges.has(eventId);
  return h(`button.${asLink ? 'btn.link.small' : 'text-action'}.see-change`, { type: 'button', id: `see-change-${eventId}`, 'aria-expanded': String(open), onclick: (event: Event) => {
    event.stopPropagation();
    if (open) { openChanges.delete(eventId); rerender(); return; }
    openChanges.add(eventId);
    if (changes.has(eventId)) { rerender(); return; }
    void window.centralKnot.eventChange(eventId).then(found => { changes.set(eventId, found ?? null); rerender(); });
  } }, open ? 'Hide change' : 'See change');
}

/** The edit as a small diff: added and removed lines, with unchanged runs folded. */
export function changePanel(eventId: string) {
  if (!openChanges.has(eventId)) return null;
  const found = changes.get(eventId);
  if (found === undefined) return h('p.change-panel.tone-faint', {}, 'Reading the change…');
  if (found === null) return h('p.change-panel.tone-faint', {}, 'The earlier version is no longer kept, so the change can’t be shown.');
  const diff = lineDiff(found.before, found.after);
  const added = diff.filter(line => line.kind === 'added').length, removed = diff.filter(line => line.kind === 'removed').length;
  const counts = [added ? `${added} ${added === 1 ? 'line' : 'lines'} added` : '', removed ? `${removed} ${removed === 1 ? 'line' : 'lines'} removed` : ''].filter(Boolean).join(', ') || 'no line changed';
  return h('div.change-panel', {}, h('p.change-caption', {}, `The edit: ${counts}. Undo puts the earlier version back in every tool it syncs to.`), h('pre.ins-diff', { id: `change-${eventId}`, tabindex: '0', 'aria-label': 'What the edit changed' }, folded(diff, false).map(line => line.kind === 'fold'
    ? h('span.ins-fold-static', {}, `… ${line.count} unchanged ${line.count === 1 ? 'line' : 'lines'}\n`)
    : h(`span.ins-line.ins-${line.kind}`, {}, h('span.ins-mark', { 'aria-hidden': 'true' }, line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''), h('span.ins-code', {}, `${line.text}\n`)))));
}

// ---------- Sync notices: kept by the list on screen, said in the window's header ----------
// What sync changed by itself (a pass's notice, types.ts SyncNotice) lives in the header, never above a list, so no notice arriving
// moves a row; renderer.ts resultHere places what headerNotices gives: the Notices control (noticesControl), filled while a notice
// is unseen, the newest notice in the header's two lines while no result has them, marked as it comes (noticeLine), and every
// notice in the card either opens (noticesCard), where an Undo or Turn it on says what it did in its notice's place (noticeLines).
// Newest is last to arrive (noticeArrived). A list keeps a notice until its ×, its Undo, a later save's of its item (supersedes) or,
// the card closed, any newer one folds it into History (toldNotices); it is seen once drawn in the lines or the card (noticeUnseen),
// and until then it lives across reads in app.ts keepUnshown.

/** A notice as a table shows it: the kind it is about (`of`), whether it was said while sync was off (`once`), and its place in the order of arrival (`arrived`: noticeArrived). */
type Told = SyncNotice & { of: PageKind; once?: boolean; arrived: number };
/** Notices stay until read: each read brings only what is new, so the page keeps earlier ones until × or Undo, a newer one folds them, or another home. */
const keptNotices = new Map<PageKind, Map<string, Told>>();
/** Notices folded into History by a newer one: never shown again, though the read still lists them. */
const foldedNotices = new Map<PageKind, Set<string>>();
const keptSync = new Map<PageKind, boolean>();
/**
 * Each notice's place in the order of arrival, given as the page receives it: the view that brings it taken (app.ts setHome), or
 * the answer of the pass a click ran (app.ts received). The newest is the last to arrive, whatever its kind or the page open then.
 */
const arrivals = new Map<string, number>();
export const noticeArrived = (id: string) => { if (!arrivals.has(id)) arrivals.set(id, arrivals.size); return arrivals.get(id)!; };
/**
 * Whether `newer` tells of a later save of the item `older` tells of a save of (an edit, competing edits or a deletion by hand,
 * types.ts ItemNotice), later by the order they arrived in, and takes its place: one active notice per item's saves, so an Undo
 * undoes its own, every save in History. A plugin's notice of an item (its own now, or dropped) stays beside it.
 */
export const supersedes = (newer: SyncNotice, older: SyncNotice) => 'winner' in newer && 'winner' in older && newer.key === older.key && noticeArrived(newer.history) > noticeArrived(older.history);
/** One kind's notices, kept or folded as the header shows them; `cardOpen`, the card is open on them. */
function toldNotices(kind: PageKind, cardOpen: boolean): Told[] {
  if (!state.home) return [];
  // What the kind's view says sync did, and what its last click's result does.
  const fresh = [...state.home[kind].notices, ...(lastResult(kind)?.notices ?? [])];
  let kept = keptNotices.get(kind);
  if (!kept) keptNotices.set(kind, kept = new Map());
  let folded = foldedNotices.get(kind);
  if (!folded) foldedNotices.set(kind, folded = new Set());
  const keyOf = (notice: SyncNotice) => notice.history, retire = (key: string) => { folded!.add(key); kept!.delete(key); };
  // A newer event folds what was said before into History, where it stays with its Undo: notices never pile up. While the card is
  // open, nothing is taken from what it shows but a notice a newer one supersedes. A click's result folds none (it is said in the
  // header's lines), so a notice never goes at a click. Turning sync on or off retires the ones it no longer lists.
  const news = fresh.filter(notice => !kept!.has(keyOf(notice)) && !folded!.has(keyOf(notice)));
  if (news.length && !cardOpen) for (const key of [...kept.keys()]) retire(key);
  if (keptSync.get(kind) !== state.home.syncOn) for (const key of [...kept.keys()]) if (!fresh.some(notice => keyOf(notice) === key)) kept.delete(key);
  keptSync.set(kind, state.home.syncOn);
  // The wording is fixed when the notice first shows: a Sync once stays "Synced once" after sync is turned on.
  for (const notice of news) {
    // Of two saves of one item, the later to arrive is the one kept, whichever the list meets first.
    if ([...kept.values()].some(told => supersedes(told, notice))) { folded.add(keyOf(notice)); continue; }
    for (const [key, told] of kept) if (supersedes(notice, told)) retire(key);
    kept.set(keyOf(notice), { ...notice, of: kind, once: !state.home.syncOn, arrived: noticeArrived(keyOf(notice)) });
  }
  for (const key of [...kept.keys()]) if (state.dismissed.has(key)) kept.delete(key);
  return [...kept.values()];
}

/**
 * Seen, the one rule: a notice is seen once its sentence is drawn in the header's lines, cut or not, or in the opened card, while the
 * window has the focus, so he can see it (markSeen; renderer.ts draws again when it gets the focus), and one dismissed, undone or
 * folded into History by a newer one is no longer unseen. Asked by the sidebar's dot and the kind switch's (unseenNotices), the
 * Notices control's mark, app.ts keepUnshown and the "Sync changed" message (app.ts paintStatusMessage).
 */
export const noticeUnseen = (id: string) => !state.dismissed.has(id) && !state.seenNotices.has(id) && ![...foldedNotices.values()].some(folded => folded.has(id));
/** A notice drawn: seen now, and when (the arrival's clock: noticeLine), if the window has the focus; a hidden window has none. */
const markSeen = (id: string) => { if (document.hasFocus() && !state.seenNotices.has(id)) state.seenNotices.set(id, Date.now()); };
/** A kind's automatic changes not yet seen (noticeUnseen). */
export const unseenNotices = (kind: PageKind) => (state.home?.[kind].notices ?? []).filter(notice => noticeUnseen(notice.history));
/** Whether the header keeps a notice for the open home, not dismissed or undone (app.ts readFound: no "Nothing changed" beside it). */
export const noticesKept = () => tableHomes.notices === state.home?.home && [...keptNotices.values()].some(kept => [...kept.keys()].some(key => !state.dismissed.has(key)));
/** The card open on a list (app.ts state.shownWhole): the list it was opened on (cardOf) and how many notices had arrived by then (`upTo`). */
type NoticesCard = { noticesOf: string; upTo: number };
/** The notices a table shows: each of its kinds', those dismissed aside, in the card's order (cardOrder). */
function visibleNotices(t: Table, card?: NoticesCard) {
  if (!state.home) return [];
  return t.kinds.flatMap(kind => toldNotices(kind, !!card)).filter(notice => !state.dismissed.has(notice.history)).sort(cardOrder(card));
}
/** Newest first; with the card open (`card`), what arrived since it opened goes after what it showed, in the order it came, so nothing in it moves. */
const cardOrder = (card?: NoticesCard) => {
  const later = (notice: Told) => !!card && notice.arrived >= card.upTo;
  return (first: Told, second: Told) => Number(later(first)) - Number(later(second)) || (later(first) ? first.arrived - second.arrived : second.arrived - first.arrived);
};

/**
 * The table whose notices the header shows, where a list or its empty state is: the table on screen (useTableShown), over every
 * kind on a Library with nothing listed (as its empty state's bands are: emptyList); none on a tool's tab of a kind that tool
 * can't hold, nor with no tool managed.
 */
function noticesTable(): Table | undefined {
  const t = useTableShown(), home = state.home;
  if (!t || !home || noToolManaged() || (t.tool && !home[t.kinds[0]!].tools.some(tool => tool === t.tool))) return undefined;
  const every = overEveryKind(t);
  return every.kinds.some(kind => rowCount(home, kind)) || pluginsListed() ? t : every;
}

/** The kinds whose notices the header shows: the sidebar's dot leaves them to the Notices control (renderer.ts). */
export const noticeKindsShown = (): PageKind[] => noticesTable()?.kinds ?? [];

/**
 * The header's notices, for renderer.ts resultHere to place: the Notices control while the list keeps one, and in the header's two
 * lines either the card, while it is open, or the newest notice, while no result has them (`resultShown`). Drawn before the control,
 * whose mark asks what they left unseen. None where no list is drawn (noticesTable), or with no notice kept.
 */
export function headerNotices(resultShown: boolean): { lines?: HTMLElement; card: boolean; control: HTMLElement } | undefined {
  const t = noticesTable();
  const card = t && (state.shownWhole as NoticesCard | undefined)?.noticesOf === cardOf(t) ? state.shownWhole as NoticesCard : undefined;
  if (!card) actedOn = undefined;
  const list = t ? visibleNotices(t, card) : [];
  if (!t || !list.length) return undefined;
  // The names two kinds share, which a notice's words name its kind beside (kindWord).
  t.shared = sharedNames(t);
  const open = () => { state.shownWhole = { noticesOf: cardOf(t), upTo: arrivals.size }; rerender(); };
  const lines = card ? noticesCard(t, list, card) : resultShown ? undefined : noticeLine(t, list[0]!, open);
  return { lines, card: !!card, control: noticesControl(list, !!card, open) };
}
/**
 * The newest notice in the header's lines, a click on it opening the card (`open`). It comes on a stronger fill that settles into
 * the line's own (style.css .header-notice), its time counted from when it was seen (markSeen): a redraw carries it on, and one seen
 * 2.4 s before or more, here or in the card, is at rest.
 */
function noticeLine(t: Table, notice: Told, open: () => void) {
  const since = Date.now() - (state.seenNotices.get(notice.history) ?? Date.now());
  const line = h('div.header-notice', { title: 'Show every notice', onclick: open }, syncNotice(t, notice, false));
  line.style.animationDelay = `-${since}ms`;
  return line;
}
/**
 * Which view's notices the open card holds: its home, its table (a segment or a tool's tab) and, the Files view sharing the
 * Library's table, the skill shown there; so it opens on no other, and goes when that view is left, by Back too.
 */
const cardOf = (t: Table) => JSON.stringify([state.home?.home, tableId(t), state.libraryView === 'files' ? state.item : undefined]);

/** Notices: a button, as Refresh is, its count on a fill of its own, marked and filled (primary) while one is unseen; it opens the card (`open`) and closes it. */
function noticesControl(list: Told[], open: boolean, openCard: () => void) {
  const unseen = list.some(notice => noticeUnseen(notice.history));
  const control = button({ variant: unseen ? 'primary' : 'outline', label: 'Notices', id: 'notices', onclick: () => { if (!open) openCard(); else { state.shownWhole = undefined; rerender(); } },
    attrs: { 'aria-expanded': String(open), 'aria-label': `Notices: ${list.length}${unseen ? ', not all seen' : ''}`, title: `${plural(list.length, 'automatic change')}: ${list.flatMap(noticeNames).slice(0, 3).join(', ')}` } });
  control.classList.add('notices-control');
  control.append(h('span.notices-count', {}, String(list.length)));
  if (unseen) control.append(h('span.notices-unseen'));
  return control;
}

/**
 * Every notice whole, each with its actions (See change, Undo or Turn it on, History, Turn sync on), under a top line with their
 * count, Dismiss all and the card's ×: the card hanging from the header that Notices or the notice in the lines opens, as tall as
 * its notices up to the window's height less 120px, past which they scroll in it (style.css .notices-card); it grows with an arrival
 * rather than keep a height it opened at, which would hide the arrival in a small scrolling box. An action that stays
 * on this page leaves it open, its notice leaving the list once done, what it did said in its place (noticeLines); one that leaves
 * the page (History, a name's link) closes it, as do its ×, Escape and a press outside (renderer.ts foldResult). Empty, it goes.
 */
function noticesCard(t: Table, list: Told[], card: NoticesCard) {
  const close = closeButton(() => { state.shownWhole = undefined; document.getElementById('notices')?.focus({ preventScroll: true }); rerender(); }, { id: 'notices-close', label: 'Close the notices', title: 'Close' });
  return h('div.notices-card.result-whole', { id: 'notices-card', role: 'region', 'aria-label': 'Notices' },
    h('div.notices-head', {}, h('span.notices-title', {}, plural(list.length, 'notice')), dismissNotices(list), close), h('div.sync-notice-lines', {}, noticeLines(t, list, card)));
}

/**
 * A notice whose Undo or Turn it on was clicked in the open card: its place's height then, and, once another is acted on, the result
 * it was saying (`said`): its words alone from then on, the last result's actions being the last place's.
 */
type Acted = { notice: Told; height: number; said?: Outcome };
/** The notices acted on in the open card (`card`), in the order clicked: each keeps its place until the card closes (noticeLines). */
let actedOn: { card: NoticesCard; places: Acted[] } | undefined;
/** An Undo or Turn it on in the card: its notice's place is kept (actedOn), then History's action runs (app.ts restoreEvent). */
function actOn(event: Event, notice: Told) {
  const card = state.shownWhole as NoticesCard;
  const height = (event.currentTarget as Element).closest('.sync-notice')?.getBoundingClientRect().height ?? 0;
  const places = (actedOn?.card === card ? actedOn.places : []).filter(place => place.notice.history !== notice.history);
  const last = places.at(-1);
  if (last) last.said ??= state.outcome;
  actedOn = { card, places: [...places, { notice, height }] };
  void restoreEvent(notice.history);
}
/**
 * The card's notices, each whole, each acted on (actedOn) keeping its place, at least as tall as it was: a done one's result there
 * (outcomeBand); a refused one, still listed, saying why in its own words with its actions for another try (syncNotice); one still
 * acting, its notice, or the place empty once its notice has gone. app.ts busy lets the result on show go as an action starts:
 * one on show is the last action's or a later one's.
 */
function noticeLines(t: Table, list: Told[], card: NoticesCard) {
  const places = actedOn?.card === card ? actedOn.places : [], last = places.at(-1);
  const listed = (notice: Told) => list.some(each => each.history === notice.history);
  const gone = places.map(place => place.notice).filter(notice => !listed(notice));
  return [...list, ...gone].sort(cardOrder(card)).map(notice => {
    const place = places.find(each => each.notice.history === notice.history), said = place && (place === last ? state.outcome : place.said);
    if (!place) return syncNotice(t, notice, true);
    const drawn = listed(notice) ? syncNotice(t, notice, true, said) : h('div.notice-done', {}, said && outcomeBand(said));
    drawn.style.minHeight = `${place.height}px`;
    return drawn;
  });
}

/** A notice's kind, by its mark, where the table lists several kinds (the Library on All). */
const noticeKind = (t: Table, notice: SyncNotice & Pick<Told, 'of'>) => (t.kinds.length > 1 ? [kindMark(t, notice.of), noticeNames(notice).map(name => kindWord(t, notice.of, name)).find(Boolean) ?? null] : null);

/** Notices stay until read; a quiet × clears them. */
// Each notice has its own ×; with three or more, one more control dismisses them all.
const dismissNotices = (list: SyncNotice[]) => list.length < 3 ? null : smallAction('Dismiss all', 'notices-dismiss', () => { for (const notice of list) state.dismissed.add(notice.history); rerender(); });

/** When Central Knot first showed each notice, so a notice left up says how old it is. */
const firstShown = new Map<string, number>();
/** A row flashes on its first draw after it was asked for (app.ts flashRequests), once, unless the ask lapsed; later redraws leave it calm. */
const takeFlash = (id: string) => {
  const until = flashRequests.get(id); if (until === undefined) return false; flashRequests.delete(id); return Date.now() < until;
};
const age = (key: string) => {
  if (!firstShown.has(key)) firstShown.set(key, Date.now());
  const minutes = Math.floor((Date.now() - firstShown.get(key)!) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
};

type NoticeLook = [IconName, string, string, HTMLElement | null];

/** A library item's notice (libraryrow.ts noticeWords), with its button (`act`): Undo, or Turn it on after a copy deleted by hand turned it off. */
function libraryNotice(lib: LibraryPage, notice: ItemNotice | PluginItemNotice, undo: (title: string) => HTMLElement, act: (event: Event) => void): NoticeLook {
  const { text, action, help } = lib.say.noticeWords(notice);
  if (action === 'undo') return [notice.kind === 'conflict' ? 'diff' : 'check', notice.kind === 'conflict' ? 'tone-warning' : 'tone-success', text, undo(help)];
  if (!action) return ['link-2-off', 'tone-muted', text, null];
  const on = button({ variant: 'outline', size: 'small', label: turnIt(true), id: `notice-restore-${notice.history}`, onclick: act });
  on.title = help;
  return ['trash-2', 'tone-muted', text, on];
}

/** What leads a notice: in the card its mark; in the header's lines, where a click's result is said, its mark and that it is an automatic change. */
const noticeLead = (whole: boolean, glyph: IconName, tone: string) => (whole ? icon(glyph, 14, tone) : h('span.notice-source', {}, icon(glyph, 14), 'Automatic change:'));
/** In the header's lines, where the card has a notice's actions: the chevron of the card the line opens. */
const opensCard = () => icon('chevron-down', 14, 'notice-opens');

/**
 * A notice's sentence with its ×, drawn and so seen; `whole` (the card) adds its actions, its name's link to its row and See change's
 * panel. `refused`: its action's refusal, said by its mark and words in its sentence's place, its actions there for another try.
 */
function syncNotice(t: Table, notice: Told, whole: boolean, refused?: Outcome) {
  if (notice.kind === 'taken-in') return takenInNotice(t, notice, whole);
  // Undo is the one action here that writes files: a small outlined button, apart from the quieter links. It says "Undo", as
  // every strip's result does; its tooltip says where.
  const act = (event: Event) => actOn(event, notice);
  const undo = (title: string) => { const action = button({ variant: 'outline', size: 'small', label: 'Undo', id: `notice-undo-${notice.history}`, onclick: act }); action.title = title; action.setAttribute('aria-label', `Undo: ${title}`); return action; };
  const offNow = notice.once ?? (!!state.home && !state.home.syncOn);
  const look = libraryNotice(libraryPages[notice.of], notice, undo, act), action = look[3];
  const [glyph, tone, text] = refused ? ['triangle-alert', 'tone-warning', refused.text] as const : look;
  // The item's name opens its row here, so "what changed" is one click from the change itself.
  const told = rowsOf(notice.of).find(skill => skill.name === notice.item || skill.key === notice.item.toLowerCase());
  const noticeKey = notice.history;
  markSeen(notice.history);
  // The rows a notice just told about show a brief highlight: on a draw in the next 3 s.
  if (told && !firstShown.has(noticeKey)) askFlash(idOf(told), Date.now() + 3000);
  // In the card the item's name opens its row: one click from "what changed" to the item, with no separate Details link.
  const name = whole && told && t.view.comparing !== idOf(told)
    ? h('button.item-name.notice-name', { type: 'button', id: `notice-open-${notice.history}`, title: `Show ${notice.item}’s details`, onclick: (event: Event) => { event.stopPropagation(); if (t.tool) reveal(t, told); else showRow(told.kind, told.key); } }, notice.item)
    : h('strong.item-name', {}, notice.item);
  const said = notice.item && text.startsWith(notice.item) ? [name, text.slice(notice.item.length)] : [text];
  // With sync off, a notice can only come from Sync now: say sync stays off, and offer to turn it on.
  const off = !!state.home && !state.home.syncOn;
  const history = !off ? smallAction('History', `notice-history-${notice.history}`, () => showPage('history')) : null;
  return h('p.sync-notice', { 'data-kind': notice.kind }, noticeLead(whole, glyph, tone), noticeKind(t, notice),
    h('span.notice-text', {}, !refused && offNow && notice.kind !== 'deleted-by-hand' ? 'Synced once: ' : '', ...said.map(part => typeof part === 'string' && !/\.\s/.test(part) ? part.replace(/\.$/, '') : part), '', h('span.notice-age', {}, ` · ${age(notice.history)}`)),
    whole ? h('span.notice-actions', {},
      notice.kind === 'edit' || notice.kind === 'conflict' ? seeChangeLink(notice.history, notice.of) : null,
      action, history, off ? smallAction('Turn sync on', `notice-sync-on-${notice.history}`, () => void setSync(true)) : null) : opensCard(),
    closeButton(event => { event.stopPropagation(); state.dismissed.add(notice.history); rerender(); }, { id: `notice-dismiss-${notice.history}`, label: `Dismiss this notice about ${notice.item}`, title: 'Dismiss', look: '.notice-dismiss' }),
    whole && notice.history ? changePanel(notice.history) : null);
}

/**
 * Synchronize everything's notice for one pass (types.ts TakenInNotice): how many it took in, where it found them and their
 * names, with History (`whole`), where each one's own Undo is. Nothing to undo here: each item has its own entry.
 */
function takenInNotice(t: Table, notice: TakenInNotice & Pick<Told, 'of' | 'once'>, whole: boolean) {
  const off = !!state.home && !state.home.syncOn, once = notice.once ?? off;
  markSeen(notice.history);
  return h('p.sync-notice', { 'data-kind': notice.kind }, noticeLead(whole, 'plus', 'tone-success'), noticeKind(t, notice),
    h('span.notice-text', {}, once ? 'Synced once: ' : '', libraryPages[notice.of].say.takenInWords(notice), h('span.notice-age', {}, ` · ${age(notice.history)}`)),
    whole ? h('span.notice-actions', {}, smallAction('History', `notice-history-${notice.history}`, () => showPage('history'))) : opensCard(),
    closeButton(event => { event.stopPropagation(); state.dismissed.add(notice.history); rerender(); }, { id: `notice-dismiss-${notice.history}`, label: 'Dismiss this notice of what Synchronize everything took in', title: 'Dismiss', look: '.notice-dismiss' }));
}

/**
 * Every way into a table starts here, and gives the table: the kinds it lists, its view, and the harness whose page it is on (none
 * on the Library), having dropped what belonged to another home. A chip with nothing left to show (this harness has nothing that
 * differs, say) goes back to none, so the table is never empty under a pressed chip; not for the Files view (`files`), which
 * shows no chip and gives the Library's back as it was. Asking again for the table on screen changes nothing.
 */
function tableOf(name: keyof typeof views, kinds: PageKind[], harness?: Tool, files = false): Table {
  // An armed Delete belongs to the visit it was clicked on: another page disarms it.
  if (state.visit !== tablesVisit) { for (const each of Object.values(views)) each.confirmDelete = undefined; tablesVisit = state.visit; }
  const t: Table = { kinds, tool: harness, view: views[name] };
  forgetOtherHomes(t, name);
  if (t.view.shownFor !== harness) startFresh(t.view, harness);
  if (files) return t;
  // A plugin with no row left, or a source removed: From is let go, at once (a chip waits while rows are pinned, below).
  if (!fromOffered(t.view.from)) t.view.from = 'anywhere';
  // Not while rows are pinned under it: they stay listed (drawTable).
  if (pinnedHere(t).rows.size > 0) return t;
  const over = overEveryKind(t);
  if (t.view.filter === 'attention' && !copiesDifferChipShown(over)) t.view.filter = 'all';
  if (t.view.filter === 'unused' && (!reading(over) || !unusedCount(over.kinds))) t.view.filter = 'all';
  return t;
}
/** The segment the Library was last drawn for (useLibrary), so another one starts its list afresh. */
let drawnSegment: PageKind | 'all' | undefined;
/**
 * The Library's table: its segment's kinds. Another segment than the one drawn last starts its list afresh: at its top (its
 * table's id names the segment: tableId), its pins let go (its list's name names its kinds: listNow), its armed Delete
 * disarmed, and an opened row it no longer lists closed. Find, the chip and From stay (a chip is offered over every kind: overEveryKind).
 */
function useLibrary(): Table {
  const view = views.library, shown = segment(), moved = drawnSegment !== undefined && drawnSegment !== shown;
  drawnSegment = shown;
  const t = tableOf('library', segmentKinds());
  if (!moved) return t;
  view.confirmDelete = undefined;
  if (view.comparing && ![...rowsIn(t), ...plugged(t).rows].some(row => idOf(row) === view.comparing)) view.comparing = undefined;
  return t;
}
/** A tool's tab of one kind under Harnesses: that kind alone, with that tool first, in the kind's own view. */
const useTab = (kind: PageKind, tool: Tool) => tableOf(kind, [kind], tool);
/** The Library's Files view: a list of the skills beside one skill's files, in the Library's view, which it gives back as it was (backFromFiles). */
const useFiles = () => tableOf('library', ['skills'], undefined, true);
/**
 * The id of a table's list: the Library's names its segment, a tab's its kind and tool. A redraw keeps a list's scroll place by its
 * id (renderer.ts), so another segment or tab opens at its own top.
 */
const tableId = (t: Table) => (t.tool ? `table-${t.kinds[0]}-${t.tool}` : `table-library-${segment()}`);

/**
 * The table on screen, worked out from the page (the Library or its Files view, or a tool's tab of a kind under Harnesses), with
 * its resets (an armed Delete disarmed on another visit, a table started fresh for another page or home, a chip with nothing left
 * let go). Where the header shows the result (listResult, outcomeBand), it asks first, so the resets come before anything is
 * drawn; where it doesn't (a home another build holds: renderer.ts resultHere), a reading as it lands (holdOrder) can be the first
 * to ask, and the resets come then rather than at the table's next draw. Asked again for the table already drawn, nothing changes.
 */
const useTableShown = (): Table | undefined => {
  if (state.page === 'library') return state.libraryView === 'files' ? useFiles() : useLibrary();
  const kind = harnessKindShown();
  return kind && state.harness ? useTab(kind, state.harness) : undefined;
};

/** Whether a row's key (a plugin's own row: its name) or its description holds Find's text whole: a tool's tab's Find, and the Library's until main has answered it (matchesFind). */
const holdsFindText = (t: Table, row: ItemRow | PluginRow) => {
  const needle = t.view.find.trim().toLowerCase();
  return !needle || (isPluginRow(row) ? row.name.toLowerCase() : row.key).includes(needle) || row.description.toLowerCase().includes(needle);
};

// ---------- The Library's Find, answered by word search (search.ts, in main) ----------

/**
 * An answer to the Library's Find (askFind): the text asked, the home main answered for, the Library's own rows found by row id,
 * best first, and apart from them the catalog's (searchdocs.ts catalogDocs: the hits with a `kind`, which only theirs have), best first.
 */
interface FindAnswer { text: string; home: string; hits: Map<string, SearchHit>; catalog: SearchHit[] }
/**
 * The answer in hand: the latest ask's (an older ask's answer is dropped, pagedata.ts), kept across reads and through a reply
 * that main has no index yet, until another is kept or another home is taken (findInHome). Used only for its text and home (hitsFor).
 */
const findAnswer = pageData<FindAnswer>();
/** Two answers alike: the same text and home, and the same rows in the same order, with the same excerpts. */
const sameAnswer = (one?: FindAnswer, other?: FindAnswer) => !!one && !!other && JSON.stringify([one.text, one.home, [...one.hits.values()], one.catalog]) === JSON.stringify([other.text, other.home, [...other.hits.values()], other.catalog]);
/**
 * Asks main for the Library's Find text (preload.ts search), answered at once from the index last published, with excerpts for
 * the group's rows revealed (search.ts drawnAtOnce); it never causes a read of the home. What came of it: 'dropped' (a newer ask is on its way); 'same' (the answer in hand again, or no index again);
 * or 'new': another answer kept, which a hold in force follows (followHold), or no index (an answer in hand for this text and
 * home is still used, else holdsFindText).
 */
async function askFind(text: string): Promise<'dropped' | 'same' | 'new'> {
  const before = { data: findAnswer.data, noIndex: findAnswer.state === 'failed' };
  const read = await readPageData(findAnswer, async () => {
    const answer = await window.centralKnot.search(text, views.library.revealed);
    return answer.ready ? { text, home: answer.home, hits: new Map(answer.rows.filter(hit => !hit.kind).map(hit => [hit.id, hit])), catalog: answer.rows.filter(hit => hit.kind) } : null;
  });
  if (read === 'dropped') return 'dropped';
  if (read === 'ready' ? sameAnswer(before.data, findAnswer.data) : before.noIndex) return 'same';
  if (read === 'ready') followHold();
  return 'new';
}
/** The Library's Find asked again while it has text, wherever the person is (or for more of the group's rows); the Library is drawn again only for another answer. */
function askAgain() {
  const text = views.library.find;
  if (text.trim()) void askFind(text).then(came => { if (came === 'new' && state.page === 'library') rerender(); });
}
// At each index main publishes (search.ts searchFollower, at every view), so the answer in hand is the newest on return.
window.centralKnot.onSearchPublished(askAgain);
/** Another home taken (app.ts accept): the answer in hand, and an ask on its way, let go unless it is that home's already; asked again. */
export function findInHome(home: string) {
  if (findAnswer.data?.home !== home) resetPageData(findAnswer);
  askAgain();
}
/** Find given new text (typed, Escape, Clear Find, a link that lets it go, a view started afresh): an armed Delete disarms, the group's first rows only are drawn, and on the Library the rows held are let go. */
const newFind = (view: View, text: string) => { Object.assign(view, { find: text, confirmDelete: undefined, revealed: MORE }); if (view === views.library) unpin(); };
/**
 * Find typed, or emptied (Escape in it, Clear Find under "Nothing matches"): the new list shows from its top (listFromTop) as it is
 * drawn. A tool's tab is drawn at once; the Library's list once main has answered (askFind), at once with Find empty. Until
 * the page is next drawn (a draw builds it anew), the list on screen is the text before's, where it was, and nothing below the
 * toolbar acts (inert): this ask draws it when it returns, from its top only while Find still holds its text, unless the text
 * has changed since, whose own ask then does (emptied, Find has drawn the whole list already, and he may have scrolled it).
 */
function findTyped(t: Table, text: string) {
  newFind(t.view, text);
  if (!searching(t)) { listFromTop(t); rerender(); return; }
  for (const before of document.querySelectorAll<HTMLElement>('.ov-page .toolbar ~ *, .ov-page .dock-main ~ *')) before.inert = true;
  void askFind(text).then(came => { const current = t.view.find === text; if (current) listFromTop(t); if (came !== 'dropped' || current) rerender(); });
}
/** The Library's list while its Find has text: one list of the rows Find finds (foundRows), under one heading, Sort at Best match. */
const searching = (t: Table) => !t.tool && !filesView(t) && !!t.view.find.trim();
/** The answer in hand, on the Library's list while its Find has text and the answer is for that text and the home on screen; else none. */
const answerFor = (t: Table) => { const answer = findAnswer.data; return searching(t) && answer?.text === t.view.find && answer.home === state.home?.home ? answer : undefined; };
/** The Library's own rows the answer in hand found (answerFor), by row id, best first. */
const hitsFor = (t: Table) => answerFor(t)?.hits;
/** Whether Find finds a row: in the answer in hand (hitsFor), else as holdsFindText says. */
const matchesFind = (t: Table, row: ItemRow | PluginRow) => { const hits = hitsFor(t); return hits ? hits.has(idOf(row)) : holdsFindText(t, row); };
/** Where Find found a row only in its file's text, that text around the match (search.ts around), else none. */
const excerptOf = (t: Table, row: ItemRow | PluginRow) => hitsFor(t)?.get(idOf(row))?.excerpt;
/** The order of the Library's list while its Find has text: the rows held first, as they were held (holdFound); then best first, or until there is an answer, by name. */
function foundOrder(t: Table, rows: (ItemRow | PluginRow)[], pins: Pinned<Role>) {
  const place = new Map<string, number>();
  for (const id of [...pins.rows.keys(), ...(hitsFor(t)?.keys() ?? [])]) if (!place.has(id)) place.set(id, place.size);
  const named = (row: ItemRow | PluginRow) => ({ key: nameOf(row).toLowerCase(), kind: kindOf(row) });
  return [...rows].sort((one, other) => (place.get(idOf(one)) ?? place.size) - (place.get(idOf(other)) ?? place.size) || byName(named(one), named(other)));
}
/** The Library's list while its Find has text, as drawTable draws it (drawnRows, in foundOrder): what holdFound holds and Put in order compares. */
const foundRows = (t: Table, pins: Pinned<Role>) => { const { shown, plugins } = drawnRows(t, pins); return foundOrder(t, [...shown, ...plugins], pins); };
/** While the Library's Find has text, a click on a row (flip, pluginRowSwitch) or a reading as it lands (holdOrder) holds every row drawn where it is (itemrow.ts pin). */
function holdFound(t: Table) { const pins = pinnedHere(t); for (const row of foundRows(t, pins)) pin(pins, idOf(row), 'results'); }
/** A hold in force follows each new answer (askFind): a row held that it no longer finds is let go for good, and a row it brings is held below, as drawn. */
function followHold() {
  const t = useTableShown(), hits = t && hitsFor(t), pins = t && pinnedHere(t);
  if (!t || !hits || !pins?.rows.size) return;
  for (const id of pins.rows.keys()) if (!hits.has(id)) pins.rows.delete(id);
  holdFound(t);
}

// ---------- Find's group "In plugins you don't have" (searchdocs.ts catalogDocs) ----------

/**
 * The group's hits for the Library's Find (the answer in hand: answerFor), best first, of the kinds the kind switch shows; none
 * under a chip, or under From but on Anywhere and Any plugin (a plugin not installed is no one's own, no named plugin's here and no
 * source's): then the group isn't drawn. None of them is a row of the Library's, so the kind switch, the chips, Results, pins and
 * Turn these off (listedRows) count and touch none.
 */
const catalogHits = (t: Table) => (t.view.filter === 'all' && ['anywhere', 'plugins'].includes(t.view.from) ? answerFor(t)?.catalog.filter(hit => t.kinds.includes(pageOfPart[hit.kind!])) ?? [] : undefined);
/**
 * The group, after the Library's own results while Find has text: "Nothing in your Library matches" above it where nothing of
 * his does; its heading, with the count of its matches, how to get one, and how much is read (coverageLine), the heading shown
 * for that alone with no hit; its first `revealed` rows (catalogRow; after "Show 10 more", once main has sent their details);
 * "Show 10 more" while there are more.
 */
function catalogGroup(t: Table, hits: SearchHit[]) {
  const first = hits.slice(0, t.view.revealed), left = hits.length - first.length, rows = first.filter(hit => hit.item), said = coverageLine();
  const reading = said && said.map(part => sectionNote(true, part));
  const more = () => { t.view.revealed += MORE; rerender(); askAgain(); };
  return h('div', { role: 'rowgroup' },
    hits.length && answerFor(t)?.hits.size === 0 ? h('p.catalog-none', {}, 'Nothing in your Library matches') : null,
    hits.length || reading ? h('div.ov-section.catalog-head', { role: 'row', 'data-section': 'catalog' }, h('div.ov-section-label', { role: 'cell' },
      h('strong', {}, 'In plugins you don’t have'), h('span.ov-section-count', {}, plural(hits.length, 'match', 'matches')),
      hits.length ? sectionNote(true, 'a name opens its plugin’s page, to install it there') : null, reading)) : null,
    rows.map(hit => catalogRow(t, hit)),
    left ? h('div.ov-more', { role: 'row' }, h('div', { role: 'cell' }, button({ variant: 'ghost', size: 'small', label: `Show ${Math.min(MORE, left)} more`, id: 'catalog-more', onclick: more }))) : null);
}
/**
 * An item of the group: its kind's mark; its name, a link to its plugin's page (openPlugin), where the plugin's own switch installs
 * it (Back returns to Find's text and the rows revealed, both kept in the view); its plugin and marketplace; its text's excerpt
 * or its description. No switch: it is not here.
 */
function catalogRow(t: Table, hit: SearchHit) {
  const item = hit.item!;
  return h('div.ov-row.ov-catalog-row', { role: 'row', 'data-key': hit.id },
    h('div.ov-name.ov-name-fit.ov-name-bare', { role: 'cell' },
      h('span.ov-name-main', {}, kindMark(t, pageOfPart[item.kind]), h('button.inline-link.ov-name-text', { type: 'button', id: partId('name', hit.id), title: `Open the plugin ${item.plugin} in ${pageNames.plugins}`, onclick: () => openPlugin({ source: item.source, plugin: item.plugin, marketplace: item.marketName }) }, item.name)),
      h('span.row-tag.row-part', { title: `In the plugin ${item.plugin}, in the marketplace ${item.marketName}` }, icon('puzzle', 12, 'tone-faint'), `${item.plugin} · ${item.marketName}`),
      about(hit.excerpt, item.description)));
}
/** What main last said of the plugin text (plugintext.ts view): the reading's words on the group's heading (coverageWords), and whether an empty Library offers Find (pluginsListed). Asked once, then followed. */
let textNow: PluginTextView | undefined;
/**
 * How much is read while not every listed plugin is (more may show): "still reading" only while a run goes on (the view's
 * `reading`, as Settings says it: settingspage.ts textCoverage), else how many are read; or that reading is off; none once all are read.
 */
const coverageWords = (text = textNow) => (!text?.of || (text.on && text.read >= text.of) ? undefined
  : !text.on ? `reading plugins is off, ${text.read} of ${text.of} read`
  : text.reading ? `still reading plugins, ${text.read} of ${text.of}: more may show` : `${text.read} of ${plural(text.of, 'plugin')} read: more may show`);
/** Those words (coverageWords) and the way to its switch on Settings: on the group's heading, or under "Nothing matches". */
function coverageLine() {
  const words = coverageWords();
  const toSettings = () => { showPage('settings'); requestAnimationFrame(() => document.getElementById('setting-plugin-text')?.scrollIntoView({ block: 'center' })); };
  return words ? [h('span', { id: 'catalog-coverage' }, words), h('button.inline-link', { type: 'button', id: 'catalog-settings', onclick: toSettings }, 'Settings')] as const : undefined;
}
/** Whether a listed marketplace has plugins to read: a Library with nothing yet then offers Find (pages.ts libraryPage). */
export const pluginsListed = () => !!textNow?.of;
/** A new count from main: the line's words change in place (no click is lost to a redraw); the page is drawn again where the line, or an empty Library's Find, comes or goes, and the list acts. */
function takeText(view: PluginTextView) {
  const before = { words: coverageWords(), listed: pluginsListed() };
  textNow = view;
  const line = document.getElementById('catalog-coverage'), words = coverageWords();
  if (line && words) line.textContent = words;
  // While a keystroke's answer is awaited, what is below the toolbar is inert (findTyped): that answer's draw brings the line.
  else if (state.page === 'library' && !document.querySelector('.ov-page [inert]') && (!!words !== !!before.words || pluginsListed() !== before.listed)) rerender();
}
window.centralKnot.onPluginTextChanged(takeText);
void window.centralKnot.pluginText().then(takeText, () => undefined);

/** Whether the chip that is on shows a row (none on shows every row; a plugin's own row only then). */
const chipShows = (t: Table, row: ItemRow | PluginRow) => { const { filter } = t.view; return filter === 'all' || (!isPluginRow(row) && (filter === 'unused' ? inUnusedChip(t, row) : needsChoice(t, row))); };
/** Whether From (fromHolds) and the chip show a row: with Find, what every list and count on a table goes by (listedRows). */
const picked = (t: Table, row: ItemRow | PluginRow) => chipShows(t, row) && fromHolds(t, row);
/** A plugin's own row is listed as From and the chip say, on a harness's page where that tool has it, and as Find says. */
const pluginListed = (t: Table, row: PluginRow) => picked(t, row) && (!t.tool || !!row.copies[t.tool as HarnessId]) && matchesFind(t, row);
/**
 * The rows Find, From and the chip leave on a table, a plugin's own among them: what the kind switch, the chips (filterBar), the
 * Library's one heading while its Find has text, and Turn these off count. drawTable draws them and the rows pinned there.
 */
const listedRows = (t: Table): (ItemRow | PluginRow)[] => [...rowsIn(t).filter(row => picked(t, row) && matchesFind(t, row)), ...plugged(t).rows.filter(row => pluginListed(t, row))];
/**
 * The rows a table draws: the person's that Find finds and From and the chip show, or that are pinned there (a row stays listed
 * under the chip after its own click took it out of what the chip shows), and a plugin's own as pluginListed says.
 */
const drawnRows = (t: Table, pins: Pinned<Role>) => ({
  shown: rowsIn(t).filter(skill => (picked(t, skill) || pins.rows.has(idOf(skill))) && matchesFind(t, skill)),
  plugins: plugged(t).rows.filter(row => pluginListed(t, row)),
});

/** Whether the Copies differ chip is drawn: something here differs. A Copies differ filter whose chip is gone falls back to none. */
const copiesDifferChipShown = (t: Table) => rowsIn(t).some(skill => needsChoice(t, skill));

/** The list a Files view was opened from: the Library's, or a tool's Skills tab (`tool`). */
let filesFrom: { tool?: HarnessId } = {};
/**
 * A skill's files and contents: the Library's Files view, from wherever its details were opened. `placed`: by Back or Forward,
 * which put its list's scroll place back (places.ts), so the list is not moved to bring the skill into view (revealSelected), nor
 * by the first report of its size (listWatcher).
 */
export function openFiles(key: string, placed = false) {
  noteMove();
  filesFrom = { tool: state.page === 'harnesses' ? state.harness : undefined };
  if (placed) { revealed = key; listSize = ''; }
  if (state.page !== 'library') showPage('library');
  state.libraryView = 'files';
  state.item = key;
  rerender();
}
/** The Files view's back button's words: where it leads, the Library or the tool whose Skills tab it was opened from. */
const backWords = () => (filesFrom.tool ? { label: names[filesFrom.tool], name: `Back to ${names[filesFrom.tool]}’s skills` } : { label: 'Library', name: 'Back to the Library' });
/**
 * Back from the Files view (its button, or Escape: renderer.ts): the list it was opened from as it was, its segment or tab, Find,
 * chip and open row; its scroll place too, where the person came from there, as a Back through the visits (app.ts noteMove).
 */
export function backFromFiles() {
  const { tool } = filesFrom;
  noteMove('back');
  // Back to a tool's Skills tab as harnesspage.ts goHarness sets it (Harnesses opens on its list), its view as it was (Files
  // draws the Library's), its open row counted as opened on this visit, so a copy question stays open.
  if (tool) { showPage('harnesses'); Object.assign(state, { harness: tool, harnessTab: 'skills' }); views.skills.openedOn = state.visit; rerender(); } else leaveFiles();
}

/**
 * A list with nothing to list (the Library, or a tool's tab of one kind): its empty state under the same bands as its table (stops,
 * problems, Resume, results), the Library's over every kind it holds, whatever the segment.
 */
export function emptyList(empty: HTMLElement, tab?: { kind: PageKind; tool: Tool }) {
  return h('div.page', {}, bands(tab ? useTab(tab.kind, tab.tool) : overEveryKind(useLibrary())), empty);
}

/**
 * The Library's list: every kind's rows, or its segment's, under one toolbar (the kind switch first) and one set of bands; under a
 * segment whose kind has none here, `none` of that kind (pages.ts kindEmpty).
 */
export const libraryTable = (none?: (kind: PageKind) => HTMLElement) => drawTable(useLibrary(), none);
/** A tool's tab of one kind under Harnesses: its column first, and the rows it doesn't have under their own heading. */
export const itemsTable = (which: PageKind, harness: Tool) => drawTable(useTab(which, harness));

/**
 * A table: its toolbar, bands and rows, under the headings On, Found, Only through a plugin, (on a tab) Not in it, and Off; on the
 * Library while its Find has text, under one (foundSection).
 */
function drawTable(t: Table, none?: (kind: PageKind) => HTMLElement) {
  const { view, tool } = t;
  Object.assign(t, { used: usedColumn(t), shared: sharedNames(t) });
  const all = rowsIn(t);
  const pins = pinnedHere(t);
  const { shown, plugins } = drawnRows(t, pins);
  const found = searching(t) ? foundOrder(t, [...shown, ...plugins], pins) : undefined;
  // After the Library's own, while Find has text: the items of plugins installed nowhere, unless the chip hides them (catalogHits).
  const inPlugins = found && catalogHits(t);
  const find = findInput({ id: 'find', label: 'Find', value: view.find, onInput: text => findTyped(t, text) });
  // A copy question doesn't outlive the visit: back on the page, its row is closed. Nor does a row Find no longer lists stay open.
  const isOpen = (row: ItemRow | PluginRow) => idOf(row) === view.comparing;
  if (view.comparing && view.openedOn !== state.visit && all.some(skill => isOpen(skill) && isDiffering(skill))) view.comparing = undefined;
  if (found && view.comparing && !found.some(isOpen)) view.comparing = undefined;
  const open = docked() && view.comparing && !underRow(t, view.comparing) ? all.find(isOpen) : undefined;
  const openRow = docked() && !open ? plugins.find(isOpen) : undefined;
  // Off goes last, under its own heading. Of the rest, the rows a harness's page is about (it has a copy) split into On and
  // Found; the others, only other tools have. A row whose own switch was clicked here stays under the heading it was under.
  // Under each, its rows in the chosen order (itemrow.ts inOrder), then the rows whose own heading it is.
  const under = (role: Role) => [inOrder(shown.filter(skill => placeIn(pins, idOf(skill), sectionOf(t, skill)) === role), chosenOrder(t), itemOf, usageIn(t), pins), shown.filter(skill => sectionOf(t, skill) === role)] as const;
  const on = under('on'), foundHere = under('found'), away = under('away'), off = under('off');
  // Every row drawn, in its order on screen, but the catalog's (pinned rows the chip dropped too): what Select's mode lists (selection.ts).
  const rowsDrawn = found ?? [...on[0], ...foundHere[0], ...plugins, ...away[0], ...off[0]];
  if (!tool) listDrawn();
  t.selectable = !tool && selecting() ? rowsDrawn.map(selectId) : undefined;
  const sections = found ? [foundSection(t, found), inPlugins && catalogGroup(t, inPlugins)] : [section(t, 'on', ...on), section(t, 'found', ...foundHere), pluginSection(t, plugins), tool ? section(t, 'away', ...away) : null, section(t, 'off', ...off)];
  // Nothing listed: none of the segment's kind here (Find empty), or nothing Find, From and the chip leave, whatever the segment.
  const nothing = shown.length || plugins.length || inPlugins?.length ? null : !view.find.trim() && !all.length && !plugged(t).rows.length && none ? none(t.kinds[0]!)
    : emptyState('search-x', 'Nothing matches', [view.find.trim() ? `“${view.find.trim()}”` : '', view.filter !== 'all' ? `Only: ${chipNames[view.filter]}` : '',
      view.from !== 'anywhere' ? `From: ${fromMenu().flat().find(entry => entry.value === view.from)?.label}` : ''].filter(Boolean).join(' · '),
      view.find.trim() ? button({ variant: 'outline', size: 'small', label: 'Clear Find', id: 'find-clear', onclick: () => findTyped(t, '') }) : undefined);
  // With no hit at all, the group's line on the reading goes under those words, in view.
  const said = nothing && inPlugins && coverageLine();
  if (said) nothing!.append(h('p.catalog-coverage', {}, said[0], ' · ', said[1]));
  const table = [
    h('div.toolbar.fit-bar', {}, kindSwitch(t), h('div.find', {}, icon('search', 16, 'find-glyph'), find), filterBar(t), fromChoice(t), orderChoice(t), h('div.toolbar-end', {}, selectControl(t), toolbarState(t), usageControls(t))),
    t.selectable ? selectBar(t, rowsDrawn) : null,
    usageBand(t),
    view.filter === 'unused' ? unusedBand(t, listedRows(t).filter((row): row is ItemRow => !isPluginRow(row))) : null,
    bands(t),
    // Its id keeps it where it was scrolled across a redraw (the dock's breakpoint crossed, say): tableId.
    h('div.scroll.matrix', { id: tableId(t) },
      // No column heads: each row's switch comes first, and its marks name their tools.
      nothing ?? withToolCount(h('div.ov.ov-switched', { role: 'table', 'aria-label': `${tool ? nouns[t.kinds[0]!][1] : 'Items'} and where they are on` }, sections), columns(t).length),
      markLegend(t, all, plugins))];
  if (openRow) return h('div.page.ov-page.docked', {}, h('div.dock-main', {}, table), pluginDock(t, openRow));
  // An item's details hold its versions: its dock takes a share of the width that grows with the window (style.css .dock-wide).
  return open ? h('div.page.ov-page.docked.dock-wide', {}, h('div.dock-main', {}, table), itemDock(t, open))
    : h('div.page.ov-page', {}, table);
}

// ---------- Select: ticks, and a Delete of many (selection.ts) ----------

/**
 * Select, at the toolbar's end on the Library's list (not a tool's tab: a Delete of many takes items from every tool), left of
 * Update usage: it starts Select's mode, and reads Done while the mode is on, which ends it. Its two words hold one width
 * (style.css .band-stack). Select folds with the bar's controls (dom.ts fitBars, at bar-icons): its tick's icon alone, Select its
 * tooltip and name; Done is a word at every width, the way out always read.
 */
function selectControl(t: Table) {
  if (t.tool || !state.home) return null;
  const on = !!t.selectable;
  const go = button({ variant: 'outline', size: 'micro', label: 'Select', icon: on ? undefined : 'square-check', collapse: !on, id: 'library-select',
    onclick: () => { if (on) stopSelecting(); else startSelecting(); rerender(); } });
  go.querySelector('.btn-label')!.replaceChildren(h('span.band-stack', {}, h('span', {}, on ? 'Done' : 'Select'), h('span.band-unshown', {}, on ? 'Select' : 'Done')));
  return go;
}
/**
 * A drawn row as Select's mode knows it (selection.ts) and its tick's id: its row id, a plugin's own row's led by `plugin-`. A
 * plugin's row and one of his can share a kind and key (a server of his named `kit@local/search`, and the plugin kit@local's
 * server `search`), and are never one tick; no row id starts so (itemrow.ts rowId starts with a kind).
 */
const selectId = (row: ItemRow | PluginRow) => (isPluginRow(row) ? `plugin-${idOf(row)}` : idOf(row));
/** A tick, a row's or a heading's: a button with an id, so a click on it outlasts a redraw (dom.ts keepClicksAcrossRedraws), read as a checkbox. */
const tickButton = (id: string, checked: 'true' | 'mixed' | 'false', label: string, onclick: (event: MouseEvent) => void, title?: string) =>
  h('button.row-tick', { type: 'button', id, role: 'checkbox', 'aria-checked': checked, 'aria-label': label, title, onclick: (event: MouseEvent) => { event.stopPropagation(); onclick(event); } },
    icon(checked === 'true' ? 'square-check' : checked === 'mixed' ? 'square-minus' : 'square', 16));
/** A row's tick in Select's mode, in its switch's place and width: a click on it ticks the row, as a click on the row does (rowClick). */
const tickOf = (t: Table, row: ItemRow | PluginRow) => tickButton(partId('tick', selectId(row)), isTicked(selectId(row)) ? 'true' : 'false', nameOf(row), event => tick(t, row, event.shiftKey), 'Shift-click selects a run');
const tick = (t: Table, row: ItemRow | PluginRow, run: boolean) => { tickRow(selectId(row), t.selectable!, run); rerender(); };
/** A row's click: in Select's mode it ticks the row (with Shift, a run: selection.ts tickRow), else it opens or closes it. Its chevron always opens it (openButton). */
const rowClick = (t: Table, row: ItemRow | PluginRow) => (event: MouseEvent) => (t.selectable ? tick(t, row, event.shiftKey) : openRow(t, row));
/** A ticked row's look in Select's mode: its tick, and a tint stronger than a row's under the pointer (style.css .row-ticked). */
const tickedLook = (t: Table, row: ItemRow | PluginRow) => (t.selectable && isTicked(selectId(row)) ? '.row-ticked' : '');
/**
 * A heading's tick in Select's mode (`role` names it, `name` is its word), over the rows drawn under it (selection.ts
 * tickHeading); none out of the mode, nor over rows none of which passes cantDelete or cantTurn either way.
 */
function headingTick(t: Table, role: string, name: string, rows: (ItemRow | PluginRow)[]) {
  if (!t.selectable || !rows.some(row => !cantDelete(row) || !cantTurn(t, row, true) || !cantTurn(t, row, false))) return null;
  const ids = rows.map(selectId);
  return tickButton(`tick-heading-${role}`, headingState(ids), `Every row under ${name}`, () => { tickHeading(ids); rerender(); });
}

/**
 * Select's bar, after the toolbar and outside the list's scrolling box, while the mode is on: how many rows listed are ticked,
 * Turn on, Turn off, Delete… and how many of them can't be deleted; once Delete… is clicked, its question in the same place,
 * the focus on its Cancel. "N can't be deleted ›", beside Delete… and after the question, opens their names and reasons over the
 * rows (style.css .select-why). Turn on and Turn off act at once, showing their own count when they take fewer than are ticked.
 * From Select's click on, the bar holds the room of the question about every row listed, the longest it can ask here, drawn
 * unseen in the same place (style.css .band-stack): no tick and no question moves a row. `rows`: the rows listed, in their order on screen.
 */
function selectBar(t: Table, rows: (ItemRow | PluginRow)[]) {
  const base = rows.map(row => ({ row, id: selectId(row), name: nameSaid(t, kindOf(row), nameOf(row)) }));
  const listed: Listed[] = base.map(({ row, id, name }) => ({ id, name, cant: cantDelete(row) }));
  const turnOf = (on: boolean) => ofListed(base.map(({ row, id, name }) => ({ id, name, cant: cantTurn(t, row, on), already: alreadyAs(row, on) })));
  const { ticked, takes, leaves } = ofListed(listed);
  const toOn = turnOf(true);
  const toOff = turnOf(false);
  const days = state.historyDays ?? defaultHistoryDays;
  const takenOf = (list: Listed[]) => rows.filter((row): row is ItemRow => !isPluginRow(row) && list.some(each => each.id === selectId(row)));
  const offDelete = acting() ?? !takes.length;
  const idIf = (shown: boolean, id: string) => (shown ? id : undefined);
  const why = (shown: boolean, count: number) => (count ? h('button.inline-link', { type: 'button', id: idIf(shown, 'select-why'), 'aria-expanded': String(whyShown()),
    onclick: () => { toggleWhy(); rerender(); } }, `${cantWords(count)} ›`) : null);
  // Delete…: the question in the bar's place, the focus on its Cancel.
  const askNow = () => {
    ask(listed);
    rerender();
    document.getElementById('select-cancel')?.focus();
  };
  const turnBtn = (on: boolean, group: ReturnType<typeof turnOf>) => button({
    variant: 'outline', size: 'small', label: turnLabel(on, group.takes.length, ticked.length), id: on ? 'select-turn-on' : 'select-turn-off',
    disabled: acting() ?? !group.takes.length, onclick: () => turnTicked(on, takenOf(group.takes), group.already.length, group.leaves),
  });
  const counting = () => h('span.select-line', {}, h('span.select-text.select-count', {}, selectedWords(ticked.length)),
    turnBtn(true, toOn), turnBtn(false, toOff), button({ variant: 'outline', size: 'small', label: 'Delete…', id: 'select-delete', disabled: offDelete, onclick: askNow }), why(true, leaves.length));
  const question = (shown: boolean, deletes: number, cant: number) => {
    const now = button({ variant: 'outline', size: 'small', label: `Delete ${deletes}`, id: idIf(shown, 'select-delete-now'), disabled: offDelete, onclick: () => deleteTicked(takenOf(takes), leaves.length) });
    now.classList.add('delete-now');
    return h('span.select-line', {}, h('span.select-text', {}, questionWords(deletes, days), cant ? [' ', why(shown, cant)] : null),
      button({ variant: 'ghost', size: 'small', label: 'Cancel', id: idIf(shown, 'select-cancel'), onclick: () => { cancelAsk(); rerender(); } }), now);
  };
  const room = question(false, listed.filter(row => !row.cant).length, listed.filter(row => row.cant).length);
  room.classList.add('band-unshown');
  return h('div.select-place', {}, h('div.selection-bar.band-stack', { id: 'select-bar', role: 'group', 'aria-label': 'Selected rows' }, askedNow(listed) ? question(true, takes.length, leaves.length) : counting(), room),
    whyShown() && leaves.length ? h('div.select-why', { id: 'select-why-list' }, whyLines(leaves).map(line => h('p', {}, line))) : null);
}
/**
 * Delete N in the question: the rows it counted, each deleted as its own Delete would (rowClicks.remove), one click per kind with
 * one Undo (app.ts applyByKind), its result saying "deleted" and staying until closed. `left`: the ticked rows it leaves. The mode ends.
 */
function deleteTicked(rows: ItemRow[], left: number) {
  stopSelecting();
  void applyByKind(clicksByKind(rows, row => rowClicks.remove(row, itemOf(row))), deleted => deletedWords(rowNames(deleted), rowNouns(deleted.map(row => row.kind)), left),
    { now: 'deleted', withoutUndo: restoreWords, stays: true });
}
/**
 * Turn on or Turn off in Select's bar: the rows it takes, each as its own switch would (rowClicks.on / rowClicks.off), one
 * click per kind with one Undo (app.ts applyByKind), its result naming rows not taken in `reasons` and staying until closed.
 * The mode ends.
 */
function turnTicked(on: boolean, rows: ItemRow[], already: number, leaves: Listed[]) {
  stopSelecting();
  const change = on ? rowClicks.on : rowClicks.off;
  const tools = state.home?.sync.managed ?? [];
  void applyByKind(clicksByKind(rows, row => change(row, itemOf(row))),
    (changed, stayed) => turnedWords(on, rowNames(changed), rowNouns(changed.map(row => row.kind)), on ? [] : stayed),
    { now: on ? 'on' : 'off', stays: true, reasons: whyLines(leaves), tail: turnTail(on, already, leaves.length),
      failedRow: (name, failed) => `${name}: ${on ? 'not' : 'still'} in ${toolsPhrase(failed, tools)}` });
}

// ---------- One switch per item ----------

const nameOf = (row: ItemRow | PluginRow) => row.name ?? row.key;

/**
 * A click on this page other than a row's own switch or Add (a tool's switch in an opened row, Delete, Make current; Turn these
 * off is one per kind: turnTheseOff): it pins no row (flip does), so once its result is shown a row not pinned already is under
 * its own heading.
 */
const click = (what: Click) => { void applyClick(what); };

/** A table's list, as the rows pinned on it are named (app.ts pinnedRows): the Skills Files view's list or the table, with its Sort, chip and From. */
const listNow = (t: Table) => [filesView(t) ? 'files' : 'table', t.kinds.join('+'), t.tool, chosenOrder(t), t.view.filter, t.view.from].join(' ');
/** The rows pinned on a table's list, each with the heading it is pinned under. */
const pinnedHere = (t: Table) => pinnedRows<Role>(listNow(t));
/** The table is the Library's Files view: its list of skills, and the chosen skill's switch in its pane (`detail-` ids). */
const filesView = (t: Table) => !t.tool && state.page === 'library' && state.libraryView === 'files';
/** Add is drawn for a found item, until a click on it asks for it On (clicklist.ts wantedOn); its switch then. */
const drawnAsAdd = (skill: ItemRow) => libraryPlace(itemOf(skill)) === 'found' && wantedOn(skill.kind, skill.key) === undefined;
/** An item's one control as drawn now (itemSwitch): its switch, or Add. */
const controlId = (skill: ItemRow, prefix: string) => elId(`${prefix}${drawnAsAdd(skill) ? 'add' : 'switch'}`, skill);
/** Where the focus goes once a click on this row, or its Undo, is done: its control as then drawn (app.ts Click focus). */
const focusOn = (t: Table, skill: ItemRow) => { const prefix = filesView(t) ? 'detail-' : ''; return () => controlId(skill, prefix); };

/**
 * Off: Central Knot removes its copies and keeps the item (library.ts), with its switches in the tools that have it through a
 * plugin. `seen`: whether its row was drawn On when clicked (libraryrow.ts rowClicks: a click made from an older state is refused).
 */
function turnOff(t: Table, skill: ItemRow, seen: boolean): Click {
  const name = nameOf(skill), lib = libraryPages[skill.kind], tools = () => toolsFor(t, skill.kind);
  const plugins = turnEvery(throughItems(t, skill), false);
  // Where its plugin's item turned off too, said from what happened.
  const pluginSaid = (notIn: HarnessId[]) => {
    const off = plugins.turned.map(item => item.tool).filter(tool => !notIn.includes(tool));
    return off.length ? ` Its plugin’s copy is off in ${toolsPhrase(off, tools())}.` : '';
  };
  // "No tool has it" only where none does: a tool whose plugin switch can't be written still has it.
  // A tool's own copy, which Off leaves alone (library.ts), is still there too: said as its mark says it.
  const own = ownCopies(skill, itemOf(skill), tools());
  const said = (notIn: HarnessId[]) => {
    const now = rowByKey(skill.kind, skill.key);
    const ways = now ? [...stillReadWords([{ name, row: now }], tools()), ...switchedOffWords(now, tools())] : [];
    const still = stillIn(skill, itemOf(skill), [...notIn, ...plugins.leftIn], tools());
    return lib.say.said.off(name, still, tools(), leftOutTools(), own, ways) + pluginSaid(notIn);
  };
  return mainClick(t, skill, false, [{ ...rowClicks.off(skill, itemOf(skill)), seenOn: seen }], plugins, said, plugins.left, focusOn(t, skill));
}

/** Every tool that can have it: where it is on once it is on everywhere. */
const canHave = (t: Table, skill: ItemRow) => toolsFor(t, skill.kind).filter(tool => (!skill.cannot?.[tool] && !skill.getsWithPlugin?.includes(tool)) || throughPluginHere(skill, tool));
/** Where it is on once it is on everywhere, but `left`: tools it stays off in (a plugin's with no switch for one item, a write that failed). */
const onPhrase = (t: Table, skill: ItemRow, left: readonly string[] = []) => toolsPhrase(canHave(t, skill).filter(tool => !left.includes(tool)), toolsFor(t, skill.kind));

/**
 * On: in every harness it isn't kept out of. A found item is taken in by this click (`use`: the copy every harness takes where
 * they differ). Said from what happened (`notIn`: the harnesses where the write didn't go through: app.ts carryOut). `seen`:
 * as turnOff's.
 */
function turnOn(t: Table, skill: ItemRow, use?: Tool, seen?: boolean): Click {
  const name = nameOf(skill), lib = libraryPages[skill.kind], found = !inLibrary(itemOf(skill)), tools = () => toolsFor(t, skill.kind);
  const plugins = turnEvery(throughItems(t, skill), true);
  const said = (notIn: HarnessId[]) => {
    const left = [...plugins.leftIn, ...notIn, ...skill.except];
    const using = canHave(t, skill).filter(tool => !left.includes(tool));
    // A tool that has it another way gets nothing of Central Knot's: said apart, never as on (a plugin's item is on through it).
    const another = using.filter(tool => skill.anotherWay?.[tool] && skill.copies[tool] === undefined && !throughPluginHere(skill, tool));
    if (found) return lib.say.said.takenIn(name, using.filter(tool => !another.includes(tool)), tools(), use, another);
    const where = onPhrase(t, skill, left);
    return where ? `${name} is on in ${where}${notIn.length ? `; not in ${toolsPhrase(notIn, tools())}` : ''}.` : `${name} is not on in any tool yet.`;
  };
  const change = rowClicks.on(skill, itemOf(skill), use);
  return mainClick(t, skill, true, [seen === undefined ? change : { ...change, seenOn: seen }], plugins, said, plugins.left, focusOn(t, skill));
}

// ---------- Items tools have through a plugin ----------

/** The items a person's own row has through a plugin: in each tool with no copy of its own that has it through an installed plugin. */
const rowThroughItems = (skill: ItemRow, tools: readonly Tool[]): PluginItemAt[] => tools.flatMap(tool => { const item = itemThrough(state.home, skill.kind, skill, tool); return item ? [item] : []; });
const throughItems = (t: Table, skill: ItemRow): PluginItemAt[] => rowThroughItems(skill, toolsFor(t, skill.kind));
/** The same for one row looked up by kind and key (firstsetup.ts "Use the latest for the rest"). */
export const throughItemsFor = (kind: PageKind, key: string): PluginItemAt[] => { const skill = rowByKey(kind, key); return skill && state.home ? rowThroughItems(skill, kindSource(state.home, kind).tools) : []; };
/** The items a plugin's row stands for: one in each tool that has it through the plugin. */
const rowItems = (row: PluginRow): PluginItemAt[] => pluginTools(row).flatMap(tool => (row.installs[tool] ? [{ kind: row.kind, name: row.name, tool, install: row.installs[tool]! }] : []));

/**
 * One click of a main switch (app.ts Click): the item's own copies' `changes` with its switches in the tools that have it
 * through a plugin, one click with one Undo; or, with no copy to change, the plugins' part alone. `said`: what it did, given the
 * tools where it didn't, then what the plugins' part took with it (pluginswitch.ts alongWords: a whole plugin where a tool has
 * no switch for one item, named by the tool, as a run's result says it beside other clicks). `also`: what it left as it is,
 * said as a problem. Its words are worked out on the table it was clicked on (`t`), wherever the page is once it has run; its
 * kind, name and key are its row's.
 */
function mainClick(t: Table, row: ItemRow | PluginRow, on: boolean, changes: Change[], plugins: ReturnType<typeof turnEvery>, said: (notIn: HarnessId[]) => string, also?: string[], focus?: () => string, note?: (done: PluginDone[]) => string): Click {
  const along = plugins.turned.map(item => alongWords(item, plugins.ops)).filter(Boolean).join(' ') || undefined, kind = kindOf(row), name = nameOf(row);
  const pluginsOnly = !changes.length, undone = pluginsOnly ? undoneWords(name, on, toolsPhrase(plugins.turned.map(item => item.tool), toolsFor(t, kind))) : undefined;
  return { kind, items: [name], rows: [rowKey(row)], changes, said, also, focus, pluginsOnly, plugins: plugins.ops.length || pluginsOnly ? { ops: plugins.ops, said: along, ...(note ? { note } : {}) } : undefined, undone };
}


/** A plugin item's Undo, in one form on every page: what the click did, turned back ("Undone: triage is back on in Codex."). */
const undoneWords = (name: string, on: boolean, where: string) => (on ? `Undone: ${name} is off in ${where} again.` : `Undone: ${name} is back on in ${where}.`);

/**
 * A plugin's row's one switch: on while some tool has it on; a click turns it on or off in every tool, the whole plugin where a
 * tool has no switch for one item (its label says so first). One that changes nothing (every tool's switch can't be written)
 * is said as a problem.
 */
function pluginRowSwitch(t: Table, row: PluginRow) {
  const items = rowItems(row);
  const onTools = items.filter(itemOn).map(item => item.tool);
  const on = onTools.length > 0;
  const kind = kindOf(row), tools = () => toolsFor(t, kind);
  const label = [`${row.name}: ${on ? `on in ${toolsPhrase(onTools, tools())}` : 'off'}. Click to turn it ${on ? 'off' : 'on'} in every tool that can switch it.`, wholeWords(items, !on)].filter(Boolean).join(' ');
  const wanted = wantedOn(kind, row.key);
  // Its clicks turn the plugin's switches in each tool, no kind's record: the home's gate.
  return toggle({ on: wanted ?? on, label: wanted === undefined ? label : turningLabel(row.name, wanted), disabled: queueOff(homeStops()), id: elId('switch', row), onchange: next => {
    if (searching(t)) holdFound(t);
    if (takeBack(kind, row.key)) { rerender(); return; }
    // Drawn as a click on it asks, it is clicked from that state, and worked out in its turn; else from what each tool has now.
    const plugins = turnEvery(items, next);
    // Nothing it can turn: every tool's switch held (said first, a reason for each tool), or it is that way already.
    const named = nameSaid(t, kind, row.name), already = { page: state.page, item: row.name, rows: [rowKey(row)], warn: true, band: true, text: `${named}: nothing changed.` };
    if (wanted === undefined && !plugins.ops.length) { tell(plugins.left ? notDoneFirst({ ...already, reasons: plugins.left }) : { ...already, text: `${already.text} It is ${next ? 'on' : 'off'} already.` }); rerender(); return; }
    // Its part in each tool is worked out in its turn, from the plugins as the clicks before it left them. Its row is found again
    // by its kind and key (idOf): a plugin's skill and MCP server of one name have one key, and the Library's All lists both.
    const rowNow = () => plugged(t).rows.find(each => idOf(each) === idOf(row));
    queueClick({ kind, key: row.key, on: next }, row.name, () => {
      const now = rowNow(), turned = now && turnEvery(rowItems(now), next);
      const copilot = turned?.turned.find(item => item.tool === 'copilot-cli');
      // Only when Copilot CLI's server switch moves (a whole-plugin Off leaves his own server on).
      const shared = copilot && state.home && turned!.ops.some(op => op.tool === 'copilot-cli' && op.part?.kind === 'mcp' && op.part.name === now!.name) && copilotSharesYours(state.home, copilot)
        ? (done: PluginDone[]) => (done.some(entry => entry.tool === 'copilot-cli' && entry.part?.kind === 'mcp' && entry.part.name === now!.name && entry.report.changed && succeeded(entry.report)) ? copilotByName(now!.name, next, true) : '') : undefined;
      return now && turned?.ops.length ? mainClick(t, now, next, [], turned, () => `${named} is ${next ? 'on' : 'off'} in ${toolsPhrase(turned.turned.map(item => item.tool), tools())}.`, turned.left, undefined, shared) : undefined;
    }, () => { const now = rowNow(); return now && rowItems(now).some(itemOn); });
  } });
}

/** A switch's label while a click on its row is unfinished: what it is being turned to. */
const turningLabel = (name: string, on: boolean) => `${name}: being turned ${on ? 'on' : 'off'}.`;

/**
 * The switch's click: off everywhere, or on everywhere (a found item taken in, after a copy choice where its copies differ). It
 * joins the page's list (app.ts queueClick), its row drawn in its new state at once and worked out in its turn, from the view as
 * the clicks before it left it; a second click while it waits takes it back (clicklist.ts takeBack). Its row is pinned where it is
 * (itemrow.ts Pinned; while the Library's Find has text, every row drawn: holdFound) until app.ts pinnedRows lets it go.
 */
function flip(t: Table, skill: ItemRow, on: boolean) {
  const { kind, key } = skill;
  if (searching(t)) holdFound(t); else pin(pinnedHere(t), idOf(skill), sectionOf(t, skill), rankIn(skill, chosenOrder(t), itemOf, usageIn(t)));
  if (takeBack(kind, key)) { rerender(); return; }
  if (on && isDiffering(skill)) {
    // The question opens under its row; a second click on the switch closes it.
    if (t.view.comparing === idOf(skill)) { t.view.comparing = undefined; rerender(); return; }
    t.view.comparing = undefined;
    openRow(t, skill);
    announce(copiesDiffer([nameOf(skill)]), true);
    return;
  }
  // Refused in its turn if its row is no longer as it was drawn when clicked.
  const seen = wantedOn(kind, key) ?? libraryPlace(itemOf(skill)) === 'on', refocus = focusOn(t, skill);
  const rowNow = () => rowByKey(kind, key);
  queueClick({ kind, key, on }, nameOf(skill), () => { const now = rowNow(); return now && (on ? turnOn(t, now, undefined, seen) : turnOff(t, now, seen)); },
    () => { const now = rowNow(); return now && libraryPlace(itemOf(now)) === 'on'; });
  // Add gives way to the switch: the focus goes with it.
  if (document.activeElement === document.body) document.getElementById(refocus())?.focus({ preventScroll: true });
}

/**
 * An item's one control: its switch while it is in Central Knot (librarySwitch), or Add while it is found (addButton). `prefix`
 * keeps a second one apart (the Files view's header): ids `<prefix>switch-<row id>`, `<prefix>add-<row id>` (controlId).
 */
function itemSwitch(t: Table, skill: ItemRow, prefix = '') {
  return drawnAsAdd(skill) ? addButton(t, skill, controlId(skill, prefix)) : librarySwitch(t, skill, controlId(skill, prefix));
}

/**
 * The switch of an item in Central Knot: on (applied to every harness it isn't kept out of; partial, drawn striped, where it
 * is kept out of some or switched off in a tool's own settings: style.css .switch-partial), or off (in Central Knot only). While a
 * click on its row is unfinished, it is drawn as that click asks (clicklist.ts wantedOn); the tools' marks stay what is on disk.
 */
function librarySwitch(t: Table, skill: ItemRow, id: string) {
  const item = itemOf(skill), wanted = wantedOn(skill.kind, skill.key), on = wanted ?? libraryPlace(item) === 'on', tools = toolsFor(t, skill.kind);
  // Where a tool has it through a plugin with no switch for one item there, the click turns the whole plugin: said first.
  const label = wanted !== undefined ? turningLabel(nameOf(skill), wanted) : [switchLabel(skill, item, tools, leftOutTools()), wholeWords(throughItems(t, skill), !on)].filter(Boolean).join(' ');
  return toggle({ on, partial: wanted === undefined && isPartial(item, tools, skill), label, onchange: next => flip(t, skill, next), disabled: queueOff(kindStops(skill.kind)), id });
}

/**
 * A found item's Add, in the switch's place: a click takes it into Central Knot and turns it on, or (its copies differ) opens
 * the question of which copy, and a second click closes it (flip). As wide as the switch (style.css .add-item), so the name
 * starts where an On row's does. A found item none of whose copies can be read for sure has nothing to add: it waits.
 */
function addButton(t: Table, skill: ItemRow, id: string) {
  const question = isDiffering(skill) ? (t.view.comparing === idOf(skill) ? 'open' : 'closed') : undefined;
  const label = addLabel(skill, itemOf(skill), toolsFor(t, skill.kind), question);
  return h('button.btn.outline.small.add-item', { type: 'button', id, title: label, 'aria-label': label, disabled: queueOff(kindStops(skill.kind)) || !canAdd(skill),
    onclick: (event: Event) => { event.stopPropagation(); flip(t, skill, true); } }, 'Add');
}

/**
 * How a tool's mark looks: on there, off there, no copy, something waits or can't be read, or (`held`) a state of that tool's
 * own drawn with its glyph: kept out, switched off in its own settings, can't take it.
 */
type MarkLook = 'on' | 'off' | 'none' | 'differs' | 'waits' | 'held';

/** What a mark says in the key, by what it is (libraryrow.ts HarnessIs, and a plugin's item). */
const keyWords = {
  on: 'On there', 'plugin-off': 'Off there', none: 'No copy',
  'will-sync': 'Gets a copy when sync runs next',
  taken: 'Edited, becomes the current version', 'deleted-by-hand': 'Deleted there; turns off when sync runs', leaving: 'Removed when sync runs', own: 'Its own copy, not from Central Knot',
  current: 'Has the current version', has: 'Has it', 'kept-out': 'Kept out', 'off-in-ck': 'Off: Central Knot keeps it', unseen: 'Left as it is (its line says why)', 'cannot-take': 'Can’t take it',
  'with-plugin': 'Gets it with its plugin (its line installs it)',
  'another-way': 'Has it another way, not from Central Knot', switched: 'Switched off in its own settings',
} as const;

/**
 * One tool's mark on a row: its look, what it says, and a glyph in place of the tool's own mark where something waits
 * or differs. `state`: what the tool has, as a word ("plugin", or libraryrow.ts HarnessIs), for the page's checks; `key`: its
 * entry in the key.
 */
function markOf(skill: ItemRow, tool: Tool): { look: MarkLook; words: string; glyph?: IconName; state: string; key: keyof typeof keyWords } {
  const given = throughPluginHere(skill, tool), on = !!given && pluginOnIn(state.home, skill.kind, skill).includes(tool);
  // A plugin's part turned off there loads nothing: where the tool loads a copy it has another way, its mark is that copy's.
  if (given && (on || !skill.loads?.[tool as HarnessId])) {
    return { look: on ? 'on' : 'off', state: on ? 'plugin' : 'plugin-off', key: on ? 'on' : 'plugin-off', words: `${skill.anotherWay?.[tool] ?? skill.cannot?.[tool] ?? `${names[tool]} has it through the plugin ${given.plugin}.`}${on ? '' : ' It is turned off there.'}` };
  }
  // A tool that gets it only with its plugin, which it lacks (pluginrows.ts withPluginOnly): not "can't take it".
  if (skill.getsWithPlugin?.includes(tool) && loadsKind(tool as HarnessId, partOfPage[skill.kind])) return { look: 'none', state: 'with-plugin', key: 'with-plugin', words: `${names[tool]}: not there; it gets it with the plugin ${pluginOf(skill.fromSource!.link)}, which its line installs.` };
  return libraryMark(libraryPages[skill.kind], skill, tool);
}

/** An item's mark for one harness: what the library's rule says of it (libraryrow.ts harnessIs), drawn with the page's looks. */
const libraryMarks: Record<HarnessIs, { look: MarkLook; key: keyof typeof keyWords; glyph?: IconName }> = {
  current: { look: 'on', key: 'current' },
  'own-copy': { look: 'on', key: 'own' },
  'kept-out': { look: 'held', key: 'kept-out', glyph: 'circle-minus' },
  none: { look: 'none', key: 'none' },
  cannot: { look: 'held', key: 'cannot-take', glyph: 'circle-slash-2' },
  'gets-it': { look: 'waits', key: 'will-sync', glyph: 'clock' },
  edited: { look: 'waits', key: 'taken', glyph: 'pencil-line' },
  'deleted-by-hand': { look: 'waits', key: 'deleted-by-hand', glyph: 'trash-2' },
  leaving: { look: 'waits', key: 'leaving', glyph: 'clock' },
  unseen: { look: 'differs', key: 'unseen', glyph: 'circle-alert' },
  'another-way': { look: 'on', key: 'another-way', glyph: 'link-2' },
};
function libraryMark(lib: LibraryPage, skill: ItemRow, tool: Tool): ReturnType<typeof markOf> {
  const item = itemOf(skill), is = harnessIs(skill, item, tool);
  const words = `${names[tool]}: ${lib.say.harnessLine(skill, item, tool, names[tool]).replace(/^./, first => first.toLowerCase())}`;
  // Off, or found: a harness with no copy while Central Knot keeps the item is off there; a found item's own copy is simply on.
  const drawn = is === 'none' && inLibrary(item) ? { look: 'off' as const, key: 'off-in-ck' as const } : is === 'own-copy' && !inLibrary(item) ? { look: 'on' as const, key: 'has' as const } : libraryMarks[is];
  // Loaded there, but that tool's own switch turns it off: a mark of its own, whoever set the switch (libraryrow.ts `switchedOff`).
  const switched = skill.switchedOff?.includes(tool) && drawn.look === 'on' ? { look: 'held' as const, key: 'switched' as const, glyph: 'circle-off' as IconName } : undefined;
  return { ...(switched ?? drawn), state: is, words };
}

/**
 * A tool's mark drawn: the tool's own mark (or a glyph), plainly on, struck through and grey for off, faint for none. Never a
 * button. With no tool, a neutral sample for the key.
 */
function toolMark(look: MarkLook, tool: Tool | undefined, glyph?: IconName, size = 14) {
  return h(`span.tool-mark.mark-${look}`, { 'aria-hidden': 'true' }, glyph ? icon(glyph, size, look === 'differs' || look === 'waits' ? 'tone-warning' : look === 'held' ? 'tone-faint' : '') : tool ? brandMark(tool, size) : icon('blocks', size));
}

/** A row's marks: one per tool, quiet and small, each naming its tool and what it has in its tooltip. `table`: the table's own (with ids). */
function rowMarks(t: Table, skill: ItemRow, size = 14, table = true) {
  const holds = toolsFor(t, skill.kind), marks = holds.map(tool => ({ tool, ...markOf(skill, tool) }));
  return h('span.tool-marks', table ? { role: 'img', 'aria-label': marks.map(mark => mark.words).join('. ') } : { 'aria-hidden': 'true' },
    inColumns(t, holds, tool => {
      const { look, words, glyph, state } = marks.find(each => each.tool === tool)!;
      const mark = toolMark(look, tool, glyph, size);
      if (table) mark.id = elId('cell', skill, tool);
      Object.assign(mark.dataset, { tool, state, look });
      mark.title = words;
      return mark;
    }));
}
/** A row's marks in the table's columns (columns): `draw`'s for each tool its kind can be in, a blank of a mark's size in the others. */
const inColumns = (t: Table, holds: Tool[], draw: (tool: Tool) => HTMLElement) =>
  columns(t).map(tool => (holds.includes(tool) ? draw(tool) : h('span.tool-mark.mark-blank', { 'aria-hidden': 'true' })));

/** The key under the table: the marks it shows, each drawn with a neutral sample, since it is for every tool's mark. */
function markLegend(t: Table, list: ItemRow[], plugins: PluginRow[]) {
  if (!columns(t).length) return null;
  const seen = new Map<keyof typeof keyWords, { look: MarkLook; glyph?: IconName }>();
  for (const skill of list) for (const each of toolsFor(t, skill.kind)) { const { look, glyph, key } = markOf(skill, each); seen.set(key, { look, glyph }); }
  // A plugin's own rows: on there, or off there (no copy kept: a plugin's item has none of its own).
  for (const row of plugins) for (const each of toolsFor(t, kindOf(row))) if (row.copies[each as HarnessId]) seen.set(offIn(row, each as HarnessId) ? 'plugin-off' : 'on', { look: offIn(row, each as HarnessId) ? 'off' : 'on' });
  const keyed = h('div.legend', { 'aria-label': 'Key' }, (Object.keys(keyWords) as (keyof typeof keyWords)[]).filter(key => seen.has(key))
    .map(key => h('span.legend-item', {}, toolMark(seen.get(key)!.look, undefined, seen.get(key)!.glyph, 12), keyWords[key])));
  return keyed.childElementCount ? keyed : null;
}

/** One row: its switch (in Select's mode, its tick), its name, a mark per tool, and the chevron that opens its details. */
function row(t: Table, skill: ItemRow) {
  const id = idOf(skill), open = t.view.comparing === id, when = dated(t);
  return [
    h(`div.ov-row.ov-switch-row${takeFlash(id) ? '.row-flash' : ''}${skill.on ? '' : '.unmanaged'}${open ? '.open' : ''}${when ? '.ov-dated' : ''}${t.used ? '.ov-usage' : ''}${tickedLook(t, skill)}`, { role: 'row', 'data-key': id, 'aria-expanded': String(open), onclick: rowClick(t, skill) },
      h('div.ov-managed', { role: 'cell' }, t.selectable ? tickOf(t, skill) : itemSwitch(t, skill)),
      nameCell(t, skill, differs(skill)),
      when ? whenCell(skill) : null,
      t.used ? usedCell(t, skill) : null,
      h('div.ov-marks', { role: 'cell' }, rowMarks(t, skill)),
      h('div.ov-open', { role: 'cell' }, openButton(t, skill))),
    open && underRow(t, id) ? details(t, skill) : null,
  ];
}

// ---------- Usage, collected when a home opens and on Update (app.ts collectUsage; usagerow.ts says what it means for a row) ----------

/** The usage reading on show: the last one collected for this home, kept while another runs; none after a reading that failed. The item lists and the Overview read it. */
export const usageOnShow = () => (state.usage.state === 'failed' ? undefined : state.usage.data);
/** A home's first reading runs (none on show yet): what a reading fills holds its room meanwhile, here and on the Overview. */
export const firstReadingRuns = () => state.usage.state === 'reading' && !state.usage.data;
/** The reading on the Library (never on a harness's tab). */
const reading = (t: Table) => (t.tool ? undefined : usageOnShow());
/** A row's item as its kind's view has it (types.ts LibraryFacts), whose names in each tool usagerow.ts matches. */
const factsOf = (skill: ItemRow) => (state.home ? kindSource(state.home, skill.kind).facts.find(facts => facts.key === skill.key) : undefined);
/** What each tool the reading read says of a row's item (usagerow.ts allSay): a use in a tool not managed here counts too. */
function usageOf(t: Table, row: ItemRow | PluginRow): ToolSays[] {
  const read = reading(t), facts = usageFactsOf(row);
  return read && facts ? allSay(read, partOfPage[kindOf(row)], facts) : [];
}
/** A row's item as usagerow.ts reads it: its kind's view's facts, or a plugin's row's (usagerow.ts pluginRowFacts). */
const usageFactsOf = (row: ItemRow | PluginRow): UsageFacts | undefined => (isPluginRow(row) ? pluginRowFacts(row) : factsOf(row));

/** While a home's first reading runs, on the Library: its rows' cells and an opened row's lines hold their room, empty or saying so. */
const firstReading = (t: Table) => !t.tool && firstReadingRuns();

/**
 * At the Library's toolbar end: when usage was collected ("Collected 8:44 AM", "· no sessions yet" where no tool
 * keeps any), or that it is being collected, and the one button that collects it: Collect usage statistics until a reading is
 * on show, Update usage statistics after. Its click opens the band (usageBand). Short of room (dom.ts fitBars, style.css
 * .usage-words), "Collected" and "usage statistics" go first, then the time; the button keeps its verb.
 */
function usageControls(t: Table) {
  if (t.tool) return null;
  const collecting = state.usage.state === 'reading', read = reading(t), today = read && new Date(read.at).toDateString() === new Date().toDateString();
  const when = collecting ? ['Collecting…'] : read ? [h('span.usage-words', {}, 'Collected '), today ? clockTime(read.at) : dayWords(read.at), read.tools.every(each => !each.sessions && !incompleteHistory(each)) ? ' · no sessions yet' : ''] : [];
  const verb = read ? 'Update' : 'Collect';
  const go = button({ variant: 'outline', size: 'micro', label: `${verb} usage statistics`, id: 'collect-usage', disabled: collecting && 'Usage statistics are being collected.', onclick: () => void collectUsage({ asked: true }) });
  // In a crowded bar it keeps "Update usage" (never a bare "Update", which reads as the app's): only " statistics" folds (style.css).
  go.querySelector('.btn-label')!.replaceChildren(`${verb} usage`, h('span.usage-words', {}, ' statistics'));
  return [when.length ? h('span.apply-state', { id: 'usage-when' }, when) : null, go];
}

/** What the band says of a reading that failed; one collected by itself that fails is said in the status bar (app.ts collectUsage). */
export const usageNotCollected = 'Usage statistics couldn’t be collected: the tools’ session history couldn’t be read.';
/**
 * The band under the toolbar, while it is open (app.ts state.usageBand: an Update's click opens it, its close button closes
 * it): what collecting does while it collects, that it was collected, or that it couldn't be. Its three
 * sentences share one place, the others kept but not shown, so the band is as high in each and no row moves when a reading
 * lands. Closed, nothing is lost: the time is beside the button, each tool's reach in the chip's band (unusedBand), and each
 * tool's figure, or why it can't say, in an opened row (usageLine).
 */
function usageBand(t: Table) {
  if (t.tool || !state.usageBand) return null;
  const now = state.usage.state === 'reading' ? 0 : state.usage.state === 'failed' || !state.usage.data ? 2 : 1;
  const sentences = ['Collecting usage statistics: reading the tools’ own session history on this computer. Nothing leaves it.',
    'Usage statistics collected from the tools’ own session history on this computer. Nothing left it.',
    usageNotCollected];
  return h('div.band.band-quiet.usage-line', { role: 'status', id: 'usage-line' }, icon('history', 14, 'tone-muted'),
    h('span.band-text.band-stack', {}, sentences.map((words, index) => h(`span${index === now ? '' : '.band-unshown'}`, {}, words))),
    closeButton(() => { state.usageBand = false; rerender(); }, { id: 'usage-line-close', label: 'Close this line about usage statistics', title: 'Close' }));
}

/** How far back each tool's history goes (usagerow.ts toolHistories), as a sentence: "Each tool’s history: Claude Code, 30 days or more; Codex, from Nov 2." A tool's phrase never wraps inside. */
function reachWords(read: UsageReading) {
  const back = (each: ToolHistory) => (each.goes === 'unread' ? 'couldn’t be read' : each.goes === 'partial' ? 'partly read' : each.goes === 'none' ? 'no sessions'
    : each.goes === 'from' ? `from ${dayWords(each.from)}` : `${USAGE_DAYS} days or more`);
  const tools = state.home ? toolHistories(read, state.home) : [];
  return tools.length ? `Each tool’s history: ${tools.map(each => `${names[each.tool]}, ${back(each)}`.replace(/ /g, '\u00a0')).join('; ')}.` : '';
}

/**
 * A row's figure (usagerow.ts figureFor): used how long ago and, fainter, in how many sessions; no use seen in USAGE_DAYS days
 * (or since when the tools that have it on start); a faint "can't say" when none of them can tell; empty while a home's first
 * reading runs.
 */
const figureOf = (t: Table, row: ItemRow | PluginRow) => {
  const read = reading(t), facts = usageFactsOf(row), kind = kindOf(row);
  return read && facts ? figureFor(read, partOfPage[kind], facts, toolsFor(t, kind) as HarnessId[]) : undefined;
};
function usedCell(t: Table, row: ItemRow | PluginRow) {
  if (!reading(t)) return h('div.ov-used', { role: 'cell' });
  const figure = figureOf(t, row);
  const words = !figure ? 'can’t say' : 'used' in figure ? `used ${sinceThen(Date.parse(figure.used))}`
    : figure.since ? `no use seen since ${dayWords(figure.since)}` : `no use seen in ${USAGE_DAYS} days`;
  const count = figure && 'used' in figure ? ` · ${plural(figure.sessions, 'session')}` : '';
  const title = figure ? `${sentence(words + count)}. Open the row for each tool’s figure.` : 'No tool that has it on can tell whether it was used. Open the row for why.';
  return h(`div.ov-used${figure ? '' : '.ov-used-faint'}`, { role: 'cell', title }, words, count ? h('span.ov-used-count', {}, count) : null);
}

/**
 * Whether this page draws the Used column: while a home's first reading runs (its room held, the cells empty), and once a reading
 * is on show where some row here has a figure (usagerow.ts KindUsage figured). A page where every row would say "can't say" (no
 * tool that has its items on keeps sessions here, say) shows none; each opened row still says why. Asked once per draw of the
 * table (itemsTable: the table's `used`).
 */
function usedColumn(t: Table) {
  if (firstReading(t)) return true;
  return kindParts(t).some(part => !!part.usage?.figured);
}

/** The reading on show in sum (usagerow.ts usageSummary), worked out again only when the reading or the home's view changes: the item lists and the Overview read this one. */
let summed: { read: UsageReading; home: HomeView; sum: UsageSummary } | undefined;
export function usageSums(): UsageSummary | undefined {
  const read = usageOnShow(), home = state.home;
  if (!read || !home) return undefined;
  if (summed?.read !== read || summed.home !== home) summed = { read, home, sum: usageSummary(read, home) };
  return summed.sum;
}
/** A kind's items in the reading's sum, in a table: whether it has a Used column, the "No use seen in 30 days" chip's lists and what its band leaves out. */
const kindUsage = (t: Table, kind: PageKind): KindUsage | undefined => (reading(t) ? usageSums()?.kinds[kind] : undefined);
/** Whether a row is in the "No use seen in 30 days" chip. */
const inUnusedChip = (t: Table, skill: ItemRow) => !!kindUsage(t, skill.kind)?.noUseSeen.includes(skill.key);
/** How many items the "No use seen in 30 days" chip holds across `kinds`, for the Library and the Overview alike. */
export function unusedCount(kinds: readonly PageKind[]): number {
  const sum = usageSums();
  return sum ? kinds.reduce((total, kind) => total + sum.kinds[kind].noUseSeen.length, 0) : 0;
}

/**
 * The chip's band. Its lead: how many it holds, Turn these off and what it does (it skips a plugin's items and items linked to
 * a plugin), and a profile it stops being in use. Then, fainter: that a use elsewhere isn't seen, how far back each tool's
 * history goes, which of this page's tools never or not always record this kind, and what it left out (new, found). Turn these
 * off at the band's end.
 */
function unusedBand(t: Table, shown: ItemRow[]) {
  const read = reading(t), home = state.home, sums = kindParts(t).flatMap(({ kind, usage }) => (usage ? [{ kind, sum: usage }] : []));
  if (!read || !home || !sums.length) return null;
  // How many, in the nouns of the kinds counted ("3 skills", or "3 items" of several kinds: words.ts rowNouns).
  const counted = (rows: { kind: PageKind }[]) => { const { one, many } = rowNouns(rows.map(row => row.kind)); return plural(rows.length, one, many); };
  const left = (pick: (sum: KindUsage) => unknown[]) => sums.flatMap(({ kind, sum }) => pick(sum).map(() => ({ kind })));
  const off = toTurnOff(shown), kept = shown.filter(row => !off.includes(row));
  const fresh = left(sum => sum.tooNew), found = left(sum => sum.foundNoneSeen);
  // The page's tools that record a kind only sometimes ('seen'), or never (no entry), kind by kind.
  const record = (how: 'seen' | undefined, word: string) => sums.map(({ kind }) => {
    const list = read.tools.filter(each => toolsFor(t, kind).includes(each.tool) && each.sessions && !each.unread && each.tells[partOfPage[kind]] === how).map(each => each.tool);
    return list.length ? `${toolsInWords(list)} ${list.length === 1 ? 'doesn’t' : 'don’t'}${word} record which ${kindNouns[kind].one} was used.` : '';
  }).filter(Boolean).join(' ');
  const plugins = pluginLive(home), live = homeItems(home, plugins), ids = new Set(off.map(skill => itemId(partOfPage[skill.kind], skill.key)));
  const ending = endedProfiles(inUseInHome(home), inUse(home.profiles.profiles, live.map(item => (ids.has(item.id) ? { ...item, on: false } : item)), plugins));
  const lead = [`${counted(shown)} with no use seen in the last ${USAGE_DAYS} days.`,
    off.length ? 'Turn these off: Central Knot takes its copies out of every tool it manages and keeps them; Undo turns them all back on.' : '',
    kept.length ? `${counted(kept)} from a plugin skipped: turn each off on its own row.` : '',
    ending.length ? `With these off, ${profileLeftUse(ending.map(profile => profile.name), 'stops')}` : ''];
  const more = ['A use on another computer or in a tool not read isn’t seen.', reachWords(read), record('seen', ' always'), record(undefined, ''),
    fresh.length ? `Left out: ${counted(fresh)} under ${USAGE_DAYS} days old.` : '', found.length ? `Left out: ${counted(found)} found, not yet in Central Knot.` : ''];
  const turn = off.length ? button({ variant: 'outline', size: 'micro', label: 'Turn these off', id: 'turn-unused-off',
    // The home's gate: a kind whose own record stops its writes is skipped and named by the click (app.ts applyByKind).
    disabled: writeOff(homeStops()) || state.usage.state === 'reading', onclick: () => turnTheseOff(off) }) : null;
  return h('div.band.usage-band', { role: 'status', id: 'unused-band' }, icon('history', 14, 'tone-muted'),
    h('span.band-text', {}, h('span.usage-lead', {}, lead.filter(Boolean).join(' ')), h('span.usage-more', {}, more.filter(Boolean).join(' '))), turn);
}

/** The rows Turn these off takes of those the chip shows: all but a plugin's items and items linked to a plugin, each left to its own row (usagerow.ts leftToItsRow). */
export const toTurnOff = (shown: ItemRow[]) => shown.filter(row => !leftToItsRow(factsOf(row)!));

/**
 * One click per kind over `rows`, each row's change made by `change`, for app.ts applyByKind, whose `said` words the whole (each
 * click's own is empty): Turn these off (turnTheseOff), and Select's Delete, Turn on and Turn off of many (deleteTicked, turnTicked).
 */
const clicksByKind = (rows: ItemRow[], change: (row: ItemRow) => Change): Click[] => KINDS.map(kind => rows.filter(row => row.kind === kind)).filter(list => list.length)
  .map(list => ({ kind: list[0]!.kind, items: list.map(nameOf), rows: list.map(rowKey), regroups: true, changes: list.map(change), said: '' }));
/**
 * Turn these off, over rows of any kinds: each kind's rows one click with each row's own Off (libraryrow.ts rowClicks.off), the
 * kinds in turn (app.ts applyByKind: a kind that refuses is skipped and named), with one Undo that puts them all back. Its words
 * name the rows that went through (what didn't is said first: app.ts applyByKind; a row's kind named where another kind shares its
 * name: words.ts rowNames), then any tools still reading them another way (from applyByKind's stillRead), then that Central Knot keeps them.
 */
export function turnTheseOff(rows: ItemRow[]) {
  void applyByKind(clicksByKind(rows, row => rowClicks.off(row, itemOf(row))), (off, stayed) => {
    const { one, many } = rowNouns(off.map(row => row.kind));
    return [`Turned off ${plural(off.length, one, many)} with no use seen in the last ${USAGE_DAYS} days: ${fewNames(rowNames(off))}.`,
      ...stayed, `Central Knot keeps ${off.length === 1 ? 'it, and turning it on puts it' : 'them, and turning one on puts it'} back as it was.`].join(' ');
  });
}

/** Why a tool can't say an item wasn't used, in an opened row: for sessions that couldn't all be read, how many files were skipped. */
const cantSayWords: Record<CantSay, (nouns: { one: string }, says: ToolSays) => string> = {
  'no-record': ({ one }) => `can’t say: its sessions don’t record which ${one} was used`,
  'not-sure': ({ one }) => `can’t say: it doesn’t always record which ${one} was used`,
  'no-sessions': (_, says) => `can’t say: ${names[says.tool]} keeps no sessions here`,
  'unread': (_, says) => (says.skipped ? `can’t say: ${plural(says.skipped, 'session file')} couldn’t be read` : 'can’t say: its sessions couldn’t be read'),
};
/**
 * One tool's figure for a row in its opened details: its sessions and last use (and how many of its session files couldn't be
 * read, where some couldn't), or no use seen (since when its history starts), or why it can't say. While a home's first
 * reading runs, the line holds its place, saying so, so the row is as high before the reading lands as after.
 */
function usageLine(t: Table, row: ItemRow | PluginRow, tool: Tool) {
  const kind = kindOf(row), id = elId('usage', row, tool);
  if (firstReading(t)) return h('p.details-usage', { id }, icon('history', 12, 'tone-muted'), 'Collecting usage statistics…');
  const says = usageOf(t, row).find(each => each.tool === tool);
  if (!says) return null;
  const last = says.last ? `last used ${sinceThen(Date.parse(says.last))}` : '';
  const skipped = says.skipped ? `; ${plural(says.skipped, 'session file')} couldn’t be read` : '';
  const words = says.sessions ? `Used in ${plural(says.sessions, 'session')} in the last ${USAGE_DAYS} days, ${last}${skipped}`
    : [says.cantSay ? sentence(cantSayWords[says.cantSay](kindNouns[kind], says)) : `No use seen ${says.since ? `since ${dayWords(says.since)}, where its history starts` : `in the last ${USAGE_DAYS} days`}`, last].filter(Boolean).join('; ');
  return h('p.details-usage', { id }, icon('history', 12, 'tone-muted'), `${words}.`);
}
/** In an opened row, a use seen in a tool this page doesn't show (not managed here), which counts in the row's figure too. */
const usageElsewhere = (t: Table, skill: ItemRow) => usageOf(t, skill).filter(each => !toolsFor(t, skill.kind).includes(each.tool) && each.sessions).map(each =>
  h('p.details-usage', { id: elId('usage', skill, each.tool) }, icon('history', 12, 'tone-muted'),
    `${names[each.tool]}, not managed here: used in ${plural(each.sessions, 'session')} in the last ${USAGE_DAYS} days, last used ${sinceThen(Date.parse(each.last!))}.`));

// ---------- The order of the rows under each heading ----------

/** The flags (flags.ts) that remember a non-default Sort on the Library: one choice, kept.
 * Where more than one of the three flags is set, the first in `orderFlags` wins. */
const orderFlags: Record<Exclude<RowOrder, 'name'>, string> = { 'most-used': 'ck-items-by-most-used', used: 'ck-items-by-last-used', updated: 'ck-items-by-last-updated' };
/** The order of the rows under each heading (itemrow.ts inOrder): the one chosen, on the Library; by name on a harness's tab. */
const chosenOrder = (t: Table): RowOrder => (t.tool ? 'name' : (Object.entries(orderFlags) as [RowOrder, string][]).find(([, flag]) => readFlag(flag))?.[0] ?? 'name');
/** A row's usage on a table, for Last used and Most used (itemrow.ts inOrder): newest use at any time, and the sessions its Used cell shows. */
const usageIn = (t: Table) => (skill: ItemRow): RowUsage => {
  const figure = figureOf(t, skill);
  return figure && 'used' in figure ? { sessions: figure.sessions, at: Date.parse(figure.used) } : { at: lastUse(usageOf(t, skill)) };
};
/**
 * A reading about to land moves no row (app.ts collectUsage calls this once its answer is known to be kept, before the slot takes
 * it). A reading moves rows only through a usage order (Last used, Most used: itemrow.ts byUsage) or the "No use seen" chip, so
 * while the list on screen goes by one or that chip is on, each of its rows is pinned where it is now (itemrow.ts Pinned), as its
 * own switch would pin it (flip): its cell fills in place, and the new order is drawn when the pins are let go (app.ts pinnedRows:
 * another list or none drawn, Refresh, or Put in order: rowsHeld).
 */
export function holdOrder() {
  const t = useTableShown();
  if (!t) return;
  // While the Library's Find has text, its rows go by best match, which a reading doesn't change: only the chip can move them.
  if (searching(t)) { if (t.view.filter === 'unused') holdFound(t); return; }
  const order = chosenOrder(t);
  if (!byUsage(order) && t.view.filter !== 'unused') return;
  const pins = pinnedHere(t);
  for (const skill of filesView(t) ? rowsIn(t) : rowsIn(t).filter(each => picked(t, each))) pin(pins, idOf(skill), sectionOf(t, skill), rankIn(skill, order, itemOf, usageIn(t)));
}
/** Whether each row says when it was last updated: while the rows go by it (not while the Library's Find has text: they go by best match). */
const dated = (t: Table) => chosenOrder(t) === 'updated' && !searching(t);
/** The choice of order, after the filters on the Library. */
function orderChoice(t: Table) {
  if (t.tool) return null;
  const choose = (event: Event) => { const value = (event.target as HTMLSelectElement).value; for (const [key, flag] of Object.entries(orderFlags)) writeFlag(flag, value === key); rerender(); };
  const order = chosenOrder(t), option = (value: RowOrder, label: string) => h('option', { value, selected: order === value }, label);
  // While the Library's Find has text: Best match, greyed, its tooltip saying why.
  const best = searching(t), options = best ? [h('option', { value: 'best', selected: true }, 'Best match')]
    : [option('name', 'Name'), option('updated', 'Last updated'), option('used', 'Last used'), option('most-used', 'Most used')];
  return [h('span.order', { title: best ? 'Best match while Find has text; the Sort you chose comes back when Find is cleared' : 'The order of the rows under each heading' }, h('label.order-word', { for: 'item-order' }, 'Sort'),
    h('span.select.select-bar', {}, h('select', { id: 'item-order', 'aria-label': 'Sort by', title: best ? undefined : 'Sort by', disabled: best, onchange: choose }, options), best ? null : icon('chevrons-up-down', 14))),
    roomHeld(rowsHeld(t), held => button({ variant: 'ghost', size: 'small', icon: 'list', label: 'Put in order', id: held ? 'put-in-order' : undefined, collapse: true, onclick: () => { unpin(); rerender(); } }))];
}
/**
 * The ids of a table's rows as drawn, heading by heading, given the rows pinned on it (none: each row under its own heading,
 * in the order Sort names), as itemsTable draws them; Find, which moves no row, aside. On the Library while its Find has text,
 * its one list (foundRows; none pinned: best first).
 */
const listedIds = (t: Table, pins: Pinned<Role>) => (searching(t) ? foundRows(t, pins).map(idOf) : (['on', 'found', 'away', 'off'] as Role[]).flatMap(role =>
  inOrder(rowsIn(t).filter(skill => (picked(t, skill) || pins.rows.has(idOf(skill))) && placeIn(pins, idOf(skill), sectionOf(t, skill)) === role), chosenOrder(t), itemOf, usageIn(t), pins).map(idOf)));
/**
 * Whether rows on this list are held where they were (a row's own click pinned it, or a reading as it landed: holdOrder), so that
 * putting them in order would move one: the one place that says so. Put in order, beside Sort, lets them go (orderChoice).
 */
const rowsHeld = (t: Table) => pinnedHere(t).rows.size > 0 && listedIds(t, pinnedHere(t)).join('\n') !== listedIds(t, noPins()).join('\n');
/** A row's time while the rows go by it: how long ago (itemrow.ts lastUpdated), the day and time in its tooltip; empty with none. */
function whenCell(skill: ItemRow) {
  const at = lastUpdated(skill, itemOf(skill));
  if (at === undefined) return h('div.ov-when', { role: 'cell' });
  return h('div.ov-when', { role: 'cell', title: `Last updated ${dayAndTime(new Date(at).toISOString())}` }, sinceThen(at));
}

/**
 * Rows under one heading: On, Found, Off, or (on a harness's page) the ones only other tools have. `rows`: the rows drawn under
 * it, in their order (drawTable); `truly`: the rows whose own heading it is, which its count counts. They differ once a row's own switch is clicked: the row
 * stays under the heading it was under (itemrow.ts Pinned), and its switch and its line say its state, so "On 11" may head 12
 * rows, one drawn Off. The note speaks for every row under it, so it shows only while each is truly its own: no "no tool
 * has these" over a row just turned On, no "Add one" over one just added. While rows are pinned under it, its room stays
 * (hidden), so no row below moves.
 */
function section(t: Table, role: Role, rows: ItemRow[], truly: ItemRow[]) {
  if (!rows.length) return null;
  const label = role === 'away' ? `Not in ${names[t.tool!]}` : placeNames[role === 'on' ? 0 : role === 'found' ? 1 : 2];
  const own = rows.every(skill => truly.includes(skill)), about = own ? truly : rows;
  const note = role === 'found' ? foundNote(about) : role === 'off' ? offNote(t, about) : role === 'away' ? 'only other tools have these' : null;
  return h('div', { role: 'rowgroup' },
    h(`div.ov-section${role === 'off' || role === 'away' ? '.ov-section-away' : ''}`, { role: 'row', 'data-section': role },
      // Counts are of the rows that match (Find, From and the chip), as the kind switch's are: a pin keeps a row's place, not a count.
      h('div.ov-section-label', { role: 'cell' }, headingTick(t, role, label, rows), h('strong', {}, label), h('span.ov-section-count', {}, String(truly.filter(row => picked(t, row)).length)), note ? sectionNote(own, note) : null)),
    rows.flatMap(skill => row(t, skill)));
}

/**
 * The Found heading's note: which rule is in force. Off, Add takes each in, and Settings holds the rule that takes them all.
 * On, Synchronize everything has left these (the opened row says why), and how many wait for a choice of copy (the take-in table's answer for the rule: libraryrow.ts ruleSays).
 */
function foundNote(list: ItemRow[]) {
  if (!state.home?.sync.syncEverything) return 'in a tool, not in Central Knot yet. Add one to keep it in Central Knot and turn it on. Synchronize everything, in Settings, adds every one it can by itself.';
  const choosing = list.filter(skill => skill.takeInAnswers && 'wait' in skill.takeInAnswers.rule).length;
  return `in a tool, not in Central Knot: Synchronize everything leaves these (open a row to see why)${choosing ? `. ${choosing} ${choosing === 1 ? 'waits' : 'wait'} for your choice of copy` : ''}`;
}

/**
 * The Off heading's note: no tool has these, or the tools that still have some on through a plugin, or how many are still in a
 * tool until sync runs, whose removal there was held (Claude Code's lock, a file that couldn't be written), or how many a tool
 * has a copy of its own of, which Central Knot left alone (libraryrow.ts ownCopies, as each row's mark and tag say).
 */
function offNote(t: Table, list: ItemRow[]) {
  const through = columns(t).filter(tool => list.some(skill => skill.pluginOn?.includes(tool)));
  if (through.length) return `in Central Knot; some on in ${andList(through.map(tool => names[tool]))} through a plugin`;
  const owed = list.filter(skill => skill.plan?.remove.length), still = [...new Set(owed.flatMap(skill => skill.plan!.remove))];
  if (owed.length) return `in Central Knot; ${owed.length} still in ${andList(still.map(tool => names[tool]))} until sync runs`;
  const ownIn = (skill: ItemRow) => ownCopies(skill, itemOf(skill), toolsFor(t, skill.kind));
  const own = list.filter(skill => ownIn(skill).length), where = [...new Set(own.flatMap(ownIn))];
  if (own.length) return `in Central Knot; ${own.length} also in ${andList(where.map(tool => names[tool]))}, ${own.length === 1 ? 'a copy' : 'copies'} Central Knot didn’t put there`;
  // A tool that has a copy another way still has it, whether it reads it or its own switch has it off.
  const ways = list.flatMap(row => [...otherReadLines(row, toolsFor(t, row.kind)), ...switchedOffWords(row, toolsFor(t, row.kind))]);
  if (ways.length) return list.length === 1 ? ways.join(' ') : 'in Central Knot; some tools still have copies elsewhere (see each row)';
  return leftOutTools().length ? 'in Central Knot; no tool it manages has these' : 'in Central Knot only; no tool has these';
}

/** What the item is now, in one line (libraryrow.ts statusLine), and for a found one, what Synchronize everything does with it while it is on. */
const switchStatus = (t: Table, skill: ItemRow) => statusLine(skill, itemOf(skill), toolsFor(t, skill.kind), !!state.home?.sync.syncEverything, leftOutTools());

/**
 * A library row's line in one tool that is a plugin's (pluginline.ts): the tool has the item through a plugin, or the item is from a
 * plugin (library.ts A PLUGIN) that this tool gets only with the plugin (pluginrows.ts withPluginOnly), or, Off, that this tool,
 * which takes no plugins, has none of placed. An item On and kept out of a tool keeps the library's own switch there, which lets it in.
 */
function rowPluginFacts(skill: ItemRow, tool: Tool) {
  const through = itemThrough(state.home, skill.kind, skill, tool), kind = partOfPage[skill.kind];
  if (through) return lineFacts(kind, through.install.plugin, through.install.marketName, tool as HarnessId, through);
  const link = skill.fromSource?.link ?? '', plugin = pluginOf(link), marketName = pluginMarketOf(link);
  if (!plugin || !marketName) return undefined;
  if (skill.getsWithPlugin?.includes(tool)) return lineFacts(kind, plugin, marketName, tool as HarnessId);
  if (takesPlugins(tool) || skill.on) return undefined;
  // A tool that takes no plugins, the item Off, where none of the plugin's items is placed (its box on the plugin's page unticked:
  // after a placement's Undo they are in the Library, Off): its line puts them there again. On, its own switch is its line.
  const facts = lineFacts(kind, plugin, marketName, tool as HarnessId);
  return typeof facts.box === 'object' && !facts.box.ticked && !facts.box.off ? facts : undefined;
}

/**
 * One tool's line in an item's details: what it has, in a sentence (with any reload step from the active click result), and its own
 * controls, each applied at once: a plugin's line where it is one (rowPluginFacts); else the item's switch for that harness and what
 * its kind adds there (libraryHarnessSwitch), or nothing where the tool has it through a plugin whose copy isn't read.
 */
function harnessLine(skill: ItemRow, tool: Tool): { text: string; control: HTMLElement | null; result: HTMLElement | null } {
  const plugged = rowPluginFacts(skill, tool), through = plugged?.through;
  const reload = state.outcome && outcomeShown(state.outcome, useTableShown())
    ? rowReload(state.outcome.reloads, toItemKind(skill.kind), through ? itemKey(through.name) : skill.key, tool as HarnessId, through ? `${through.install.plugin}@${through.install.marketName}` : undefined, toolWays()) : '';
  // Through a plugin: where it comes from first.
  if (plugged) return pluginLine(skill, plugged, through ? skill.cannot?.[tool] ?? '' : '', reload);
  const lib = libraryPages[skill.kind], own = skill.ownPart?.[tool];
  return { text: [lib.say.harnessLine(skill, itemOf(skill), tool, names[tool]), own?.length ? lib.words.own(own) : '', reload].filter(Boolean).join(' '),
    control: throughPluginHere(skill, tool) ? null : libraryHarnessSwitch(lib, skill, tool), result: resultLine(skill, tool) };
}

/**
 * One harness's own switch for a library item that is On: off keeps the item out of that harness (its copy there goes, and
 * Central Knot keeps it for later), on lets it in again. An item that is Off or only found has one switch: its row's.
 */
function libraryHarnessSwitch(lib: LibraryPage, skill: ItemRow, tool: Tool) {
  const item = inLibrary(itemOf(skill)), own = lib.tool?.(skill, tool as HarnessId) ?? null;
  // Off, found, or a harness that can't take it: no switch there, only what the kind offers on its line.
  if (!item?.on || harnessIs(skill, item, tool) === 'cannot') return own && h('span.details-tool-actions', {}, own);
  const name = nameOf(skill), where = names[tool], out = item.except.includes(tool as HarnessId);
  // A state of the tool's own, said in its own word in place of Central Knot's switch: its own switch has it off (the kind's
  // action there lets it load it again), or it has it another way, where nothing of Central Knot's goes.
  const ownState = out ? undefined : skill.switchedOff?.includes(tool) ? 'Switched off' : harnessIs(skill, item, tool) === 'another-way' ? 'Another way' : undefined;
  if (ownState) return h('span.details-tool-actions', {}, own, h('span.tool-switch', {}, h('span.tool-switch-word.tool-switch-word-own', {}, ownState)));
  const said = (notIn: HarnessId[]) => lib.say.said.inHarness(name, tool, !out, notIn.includes(tool as HarnessId));
  const does = out ? `Click to put it in ${where} again, its ${lib.words.copy} as it was.` : `Click to keep it out of ${where}: its copy there goes, and Central Knot keeps it.`;
  const flipHere = (on: boolean) => click({ kind: skill.kind, items: [name], rows: [rowKey(skill)], changes: [rowClicks.inHarness(skill, item, tool, !on)], said });
  // Kept out, yet loading a copy Central Knot doesn't write there (a take leaves his so: library.ts TAKE), its own or another tool's:
  // said beside the switch, never as Off.
  const loads = loadingIn(skill, item, [tool]), runs = loads.own.length ? 'its own copy' : loads.another.length ? 'another way' : undefined;
  const now = out ? `kept out${runs ? `, running ${runs}` : ''}` : 'on', word = runs ? `${runs.charAt(0).toUpperCase()}${runs.slice(1)}` : out ? 'Off' : 'On';
  return h('span.details-tool-actions', {}, own, h('span.tool-switch', {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, word),
    toggle({ on: !out, disabled: writeOff(kindStops(skill.kind)), id: elId('enable', skill, tool), label: `${name} in ${where}: ${now}. ${does}`, onchange: flipHere })));
}

/**
 * Delete from Central Knot, the one real delete of a library item: quiet until armed, then it runs at once. The item leaves
 * every harness and its page; the library keeps it, deleted, and History's Restore (or this click's Undo) puts it back. Drawn
 * for an item in the library; off where cantDelete says it can't be deleted now (Select's Delete of many asks the same).
 */
function libraryDelete(t: Table, lib: LibraryPage, skill: ItemRow) {
  const item = inLibrary(itemOf(skill)), cant = !!cantDelete(skill);
  if (!item) return null;
  const name = nameOf(skill), id = idOf(skill), view = t.view, tools = toolsFor(t, skill.kind), disarm = () => { view.confirmDelete = undefined; rerender(); };
  if (view.confirmDelete !== id) {
    const arm = button({ variant: 'outline', size: 'micro', label: 'Delete from Central Knot…', id: elId('delete', skill), disabled: writeOff(cant), onclick: () => { view.confirmDelete = id; rerender(); } });
    arm.classList.add('delete-quiet');
    return h('span.delete-offer', {}, arm, h('span.delete-offer-note', {}, lib.say.said.deleteOffer));
  }
  const said = (notIn: HarnessId[]) => lib.say.said.deleted(name, item.on, stillIn(skill, item, notIn, tools), tools);
  const run = () => { view.confirmDelete = undefined; click({ kind: skill.kind, items: [name], rows: [rowKey(skill)], changes: [rowClicks.remove(skill, item)], said }); };
  // Armed, it is still a button (outlined in red); Cancel beside it is a link.
  const now = button({ variant: 'outline', size: 'micro', label: 'Delete it now', id: elId('delete-confirm', skill), disabled: writeOff(cant), onclick: run });
  now.classList.add('delete-now');
  now.title = selectOff() ?? `Delete ${name} from Central Knot now. History can restore it.`;
  return h('span.delete-armed', {}, smallAction('Cancel', elId('delete-cancel', skill), disarm), now,
    h('span.delete-armed-note', { id: elId('delete-note', skill) }, lib.say.said.deleteArmed(state.historyDays ?? defaultHistoryDays)));
}

/** Versions read in an opened row, by home, kind, item and version, so a version read once shows at once the next time. */
const versionTexts = new Map<string, VersionText>();

/** A library item's versions in its opened row (versionlist.ts): the list, Read (as its kind gives it), and Make current as the item's click. */
function libraryVersions(t: Table, lib: LibraryPage, skill: ItemRow) {
  const item = inLibrary(itemOf(skill));
  if (!item) return null;
  const name = nameOf(skill), id = idOf(skill), view = t.view, textKey = (hash: string) => `${state.home?.home}:${skill.kind}:${item.key}:${hash}`;
  const at = view.readingVersion?.id === id ? view.readingVersion.index : undefined;
  const fetch = (hash: string) => {
    if (versionTexts.has(textKey(hash))) return;
    versionTexts.set(textKey(hash), 'reading');
    void lib.version(item.key, hash).then(text => { versionTexts.set(textKey(hash), text); rerender(); });
  };
  // Reading a version reads the current one too, so what differs from it can be marked.
  const read = (index: number) => {
    view.readingVersion = at === index ? undefined : { id, index };
    if (view.readingVersion) { fetch(listed(item)[index].hash); fetch(item.hash); }
    rerender();
  };
  const textOf = (hash: string) => versionTexts.get(textKey(hash)) ?? 'reading';
  const on = (notIn: HarnessId[]) => (item.on ? canHave(t, skill).filter(tool => !notIn.includes(tool as HarnessId) && !skill.except.includes(tool)) : undefined);
  const makeCurrent = (version: Version) => click({ kind: skill.kind, items: [name], rows: [rowKey(skill)], changes: [rowClicks.makeCurrent(skill, item, version.hash)],
    // A version that was itself made current again is named by the one it came from.
    said: notIn => { const source = (version.from.how === 'made-current' && madeFrom(item, version)) || version;
      return lib.say.said.madeCurrent(name, source, versionClock(item, source), on(notIn), toolsFor(t, skill.kind)); } });
  const reading = at === undefined || !listed(item)[at] ? undefined : { index: at, text: textOf(listed(item)[at].hash), current: textOf(item.hash) };
  return versionList({ item, rowId: id, canWrite: !writeOff(kindStops(skill.kind)), why: selectOff(), unfolded: view.versionsUnfolded === id, onUnfold: () => { view.versionsUnfolded = id; rerender(); },
    changes: skill.versionChanges, reading, now: Date.now(), onRead: read, onMakeCurrent: makeCurrent });
}

/**
 * An item's details: its status, each tool with its own controls, its versions, where each copy is, what its kind shows of its
 * own (librarypages.ts), and its Delete from Central Knot last. While a found item's copies differ, only the question of which
 * copy every tool uses, and the copies.
 */
function details(t: Table, skill: ItemRow, placement: Placement = 'row'): HTMLElement {
  const inFiles = placement === 'files', lib = libraryPages[skill.kind], tools = toolsFor(t, skill.kind);
  const differs = isDiffering(skill);
  // MCP: each tool's row has its settings file and Show in folder, where a server is changed.
  const settingsFile = (tool: Tool) => (skill.kind === 'mcp' && skill.paths?.[tool] ? [wrappingPath(skill.paths[tool]!), showInFolder(skill.paths[tool]!)] : []);
  const toolRow = (tool: Tool) => {
    const line = harnessLine(skill, tool);
    return h('div.details-tool', {},
      h('div.details-tool-head', {},
        h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
        ...settingsFile(tool),
        h('span.details-tool-line', {}, line.text),
        line.control),
      lib.toolNote?.(skill, tool as HarnessId),
      line.result ?? usageLine(t, skill, tool));
  };
  const close = placement === 'row' ? h('button.details-close', { type: 'button', id: elId('close', skill), 'aria-label': `Close details for ${skill.key}`, title: 'Close', onclick: () => { t.view.comparing = undefined; rerender(); } }, icon('x', 14)) : null;
  const box = (...children: (Child | Child[])[]) => h(`div.compare.details${placement === 'row' ? '' : '.details-bare'}${differs ? '.details-differs' : ''}${skill.kind === 'mcp' ? '.details-mcp' : '.details-grid'}`, { role: 'region', 'aria-label': `Details for ${skill.key}` }, ...children);
  // The copy question is asked in one place: by first setup's walkthrough where it is at this row, else here.
  const asked = walkingAt();
  if (differs) return box(close, excerptLine(t, skill), asked?.kind === skill.kind && asked.key === skill.key ? h('p.compare-note', {}, 'Choosing copies, above, asks which copy to use.') : compareChoices(t, skill, inFiles));
  // A found row none of whose copies can be read has no files to show.
  const files = lib.files && !inFiles && (inLibrary(itemOf(skill)) || canAdd(skill)) ? smallAction('Files and contents', elId('files', skill), () => openFiles(skill.key)) : null;
  const remove = !inFiles ? libraryDelete(t, lib, skill) : null;
  return box(
    h('div.details-head', {},
      // The Files view's pane says it under the skill's name; the row already shows the description.
      inFiles ? null : h('p.details-status', {}, switchStatus(t, skill)),
      // Its description whole: the closed row cuts it.
      skill.description ? h('p.details-description.details-description-whole', {}, skill.description) : null,
      excerptLine(t, skill),
      rowPlugins(skill).map(({ plugin, marketName, installs }) => pluginStrip(plugin, marketName, installs, elId('strip', skill, plugin))),
      files ? h('div.details-actions', {}, files) : null),
    // What every tool shares of it, and what stays each harness's own, said where it is true: an item in Central Knot, or a
    // found one that can be taken in.
    tools.length > 1 && (inLibrary(itemOf(skill)) || canAdd(skill)) ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), lib.words.shared) : null,
    h('div.details-tools', {}, tools.map(tool => toolRow(tool)), usageElsewhere(t, skill)),
    libraryVersions(t, lib, skill),
    inFiles || skill.kind === 'mcp' ? null : wherePaths(t, skill),
    lib.own?.(skill) ?? null,
    skill.fromSource ? fromSourceLine(skill, skill.fromSource) : null,
    remove ? h('div.details-actions.details-danger', {}, remove) : null);
}

/** What waits, in the toolbar: the changes waiting for sync (libraryrow.ts waitsForSync, as the Overview's card counts them), or that sync is off. */
function toolbarState(t: Table) {
  const waiting = rowsIn(t).filter(waitsForSync).length, said = (n: number) => [`${n}`, h('span.apply-words', {}, ` ${n === 1 ? 'change' : 'changes'} waiting`)];
  // One slot, as wide as the widest it can say (a count of two figures; with sync off, that nothing waits), so a change a click
  // leaves waiting changes nothing of the bar's fit.
  const quiet = state.home && !state.home.syncOn ? h(`span.apply-state.apply-quiet${waiting ? '.band-unshown' : ''}`, {}, icon('circle-minus', 14, 'tone-muted'), 'Nothing waiting · sync off') : null;
  return h('span.band-stack', {}, h('span.apply-state.band-unshown', {}, icon('clock', 14), ...said(99)), quiet,
    waiting ? h('span.apply-state.apply-waiting', { title: `${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting` }, icon('clock', 14, 'tone-warning'), ...said(waiting)) : null);
}
/**
 * What a click can make appear in the toolbar (Put in order) has its room held from the start, drawn but unseen until it is
 * `shown` (style.css .band-unshown: hidden from the eye, the mouse, the keyboard and screen readers): so a click never changes
 * how the bar fits (dom.ts fitBars), and no row moves for it.
 */
function roomHeld(shown: boolean, draw: (shown: boolean) => HTMLElement) {
  const drawn = draw(shown);
  if (!shown) drawn.classList.add('band-unshown');
  return drawn;
}

// ---------- The Library's Files view ----------

/** The skill whose row was last scrolled into view, or whose list Back or Forward put back as it was (openFiles), so the list moves only when the selection changes. */
let revealed: string | undefined;

/**
 * Scrolls the skills list just enough to show the selected row below its sticky header, moving nothing else. A short
 * stacked list can hide it: when the selection changes, and whenever the list resizes (the window narrowing into the
 * stacked layout, say).
 */
function revealSelected() {
  const list = document.getElementById('skills-list'), row = list?.querySelector('.list-row.selected');
  if (!list || !row) return;
  const area = list.getBoundingClientRect(), box = row.getBoundingClientRect();
  const top = area.top + (list.querySelector('.list-head')?.getBoundingClientRect().height ?? 0), bottom = area.top + list.clientHeight;
  if (box.top < top) list.scrollTop -= top - box.top;
  else if (box.bottom > bottom) list.scrollTop += box.bottom - bottom;
}

/**
 * Watches the skills list drawn last, so a resize keeps its selected row in view. A ResizeObserver also reports each new
 * list when it starts watching it, and every redraw makes a new list: that report counts only when the list's size
 * differs from the last one's (the layout changed with the redraw), so a plain redraw leaves the list where it was scrolled.
 * A list that leaves the page reports 0×0, so the next list drawn would always differ from it: after Back or Forward, whose
 * list's place is put back (openFiles `placed`), there is no last size (`listSize` ''), and the new list's first report is only
 * the size later ones are compared with.
 */
let listSize = '';
const listWatcher = new ResizeObserver(entries => {
  const size = entries.map(entry => `${Math.round(entry.contentRect.width)}×${Math.round(entry.contentRect.height)}`).join();
  if (listSize && size !== listSize) revealSelected();
  listSize = size;
});

/** The least room a description gets beside its name before every row leaves it out: about twelve characters. */
const ABOUT_MIN = 90;

/**
 * A table's descriptions are all shown or all left out, so rows never differ: when the narrowest one has room for fewer
 * than about twelve characters, every row leaves its description out (.no-about); its name's tooltip still has it.
 * A description pushed onto the cell's hidden second line, after a tag or pill that took the room, has none. A name that
 * takes more than half its name cell is cut first (.name-cut), so one long name doesn't take every description away; once
 * every description is left out, the cut is taken off again and the name has its whole cell.
 * Run after layout (dom.ts afterLayout).
 */
function settleDescriptions(): void {
  const short = (about: HTMLElement) => about.offsetTop >= about.offsetHeight || about.clientWidth < ABOUT_MIN;
  for (const table of document.querySelectorAll<HTMLElement>('.ov')) {
    table.classList.remove('no-about');
    for (const cut of table.querySelectorAll('.name-cut')) cut.classList.remove('name-cut');
    const abouts = [...table.querySelectorAll<HTMLElement>('.ov-name-about')];
    for (const cell of abouts.filter(short).map(about => about.parentElement!)) {
      if (cell.querySelector<HTMLElement>('.ov-name-main')!.offsetWidth > cell.clientWidth / 2) cell.classList.add('name-cut');
    }
    table.classList.toggle('no-about', abouts.some(short));
    if (table.classList.contains('no-about')) for (const cut of table.querySelectorAll('.name-cut')) cut.classList.remove('name-cut');
  }
}
afterLayout(settleDescriptions);

/** The Files view's pane width from which the file and the skill's details sit in two columns. */
const DETAIL_COLUMNS_FROM = 1040;

/**
 * Decides the Files view's columns from its pane's width (data-columns, which style.css keys off). "Where each copy is"
 * starts open in two columns, where the column has room for it, and closed when stacked, until the person opens or closes
 * it. Run after layout (dom.ts afterLayout), before the page is painted, so a wide window never shows the stacked layout.
 */
function settleFilesColumns(): void {
  const pane = document.getElementById('skill-detail');
  if (!pane) return;
  const wide = pane.clientWidth >= DETAIL_COLUMNS_FROM;
  pane.dataset.columns = wide ? '2' : '1';
  const where = pane.querySelector<HTMLDetailsElement>('.files-tail > details.details-paths');
  if (where && views.library.whereOpen === undefined) where.open = wide;
}
afterLayout(settleFilesColumns);

/**
 * The Library's Files view: a list of every skill beside (or, in narrow content, above) one skill's details, with the same switch
 * and controls as the table, and its own Find. `more` adds files and contents.
 */
export function skillsBrowser(more: (key: string) => { where: Node[]; contents: (Node | null | false)[] }, select: (key: string | undefined) => void) {
  const t = useFiles(), view = t.view;
  const all = rowsIn(t);
  const needle = view.listFind.trim().toLowerCase();
  const matches = all.filter(skill => !needle || skill.key.includes(needle) || (skill.name ?? '').toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle));
  // The table's headings, on, then found, then off (a row whose switch was clicked here under the one it was under), and its
  // order under each (inOrder's, which the stable sort keeps).
  const pins = pinnedHere(t), place = new Map(all.map(skill => [idOf(skill), (['on', 'found', 'off'] as Role[]).indexOf(placeIn(pins, idOf(skill), sectionOf(t, skill)))]));
  const shown = inOrder(matches, chosenOrder(t), itemOf, usageIn(t), pins).sort((first, second) => place.get(idOf(first))! - place.get(idOf(second))!);
  const chosen = all.find(skill => skill.key === state.item);
  // The detail always shows a skill: the chosen one, else the first listed. In narrow content it sits below the list.
  const shownDetail = chosen ?? shown[0] ?? all[0];
  // Record the implicit first selection too, so fullPlace names the skill actually drawn.
  state.item = shownDetail.key;
  const listRow = (skill: ItemRow) => h(`button.list-row${skill === shownDetail ? '.selected' : ''}`, {
    type: 'button', id: elId('list', skill), 'data-key': idOf(skill), 'aria-pressed': String(skill === shownDetail),
    'aria-label': `${skill.name ?? skill.key}, ${placeNames[standingOf(skill)].toLowerCase()}`,
    onclick: () => select(skill.key),
  },
    middle(skill.name ?? skill.key, 12, 'list-name'),
    // The same marks as the table's rows, smaller.
    h('span.list-cells', {}, rowMarks(t, skill, 12, false)));
  const find = findInput({ id: 'skills-find', label: 'Find a skill', value: view.listFind, onInput: text => { view.listFind = text; rerender(); } });
  const list = shown.length
    ? h('div', { role: 'group', 'aria-label': 'Skills' }, shown.flatMap((skill, index) => [
      index && place.get(idOf(shown[index - 1])) === place.get(idOf(skill)) ? null : h('div.list-group', {}, placeNames[place.get(idOf(skill))!]), listRow(skill)]))
    : emptyState('search-x', 'Nothing matches', `“${view.listFind}”`);
  const skill = shownDetail;
  // At the next frame, only if it is still the skill to reveal: Back or Forward may have opened another by then (openFiles `placed`).
  if (skill.key !== revealed) { const key = revealed = skill.key; requestAnimationFrame(() => { if (revealed === key) revealSelected(); }); }
  requestAnimationFrame(() => {
    listWatcher.disconnect();
    const list = document.getElementById('skills-list'); if (list) listWatcher.observe(list);
  });
  const { where, contents } = more(skill.key);
  const layout = filesLayout(t, skill, where);
  // Its whole text on hover too, for a pane too narrow to show it.
  const paneStatus = switchStatus(t, skill);
  // The result and its Undo are in the window's header, as on the table; the list and the skill's pane below it.
  return h('div.page', {}, bands(t), h('div.split', {},
    h('div.list-column', {},
      h('div.toolbar.list-toolbar.fit-bar', {}, button({ variant: 'ghost', size: 'small', icon: 'arrow-left', ...backWords(), id: 'files-back', collapse: true, onclick: backFromFiles }), h('div.find', {}, icon('search', 16, 'find-glyph'), find)),
      // The header rides inside the list's scroll area, so it has the rows' exact width, gutter and columns.
      h('div.scroll.list-scroll', { id: 'skills-list' },
        h('div.list-head', { 'aria-hidden': 'true' }, h('span', {}, 'Skill')),
        list)),
    h('section.detail-column', { id: 'skill-detail', 'aria-label': 'Skill details' },
      // The skill's own switch comes first, before its name, as on its row.
      h('div.pane-header.pane-header-switched', {},
        h('div.detail-switch', {}, itemSwitch(t, skill, 'detail-')),
        h('div.pane-title', {}, h('h2', {}, middle(skill.name ?? skill.key)), h('p', { title: paneStatus }, paneStatus))),
      // A wide pane puts the skill's details beside its files, as a plugin's page puts its README beside what it holds.
      h('div.scroll.detail-scroll', { id: 'detail-scroll' },
        h('div.detail-files', {}, ...contents),
        layout.head ? h('div.files-details', {}, layout.head) : null,
        layout.tail.length ? h('div.files-tail', {}, layout.tail) : null))));
}

// Escape in a find box with text clears it. Elsewhere on the Library's list in Select's mode, it closes a Delete of many's
// question, or else ends the mode. A card open (an info card, the header's) is closed first, and this doesn't hear it (renderer.ts).
document.addEventListener('keydown', event => {
  const id = (event.target as HTMLElement | null)?.id;
  if (event.key !== 'Escape') return;
  const t = useTableShown(), view = t?.view;
  if (id === 'skills-find' && view?.listFind) { view.listFind = ''; rerender(); }
  else if (id === 'find' && t && view?.find) findTyped(t, '');
  else if (state.page === 'library' && state.libraryView === 'list' && selecting()) { if (!cancelAsk()) stopSelecting(); rerender(); }
});
