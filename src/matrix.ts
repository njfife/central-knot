// The item tables (the Library, which lists every kind, and a harness's tabs of one kind): one On/Off switch per item, applied at once
// in every tool Central Knot manages. A row's marks only say what each tool has; each tool's own controls are in the item's
// details, and a click's result comes with an Undo of the whole click wherever History offers one (historyactions.ts says where
// it doesn't: Take over, a take-in from Claude Code's MCP settings). Every kind is on Central Knot's library: its row is a
// library row: librarypages.ts says what each kind supplies, libraryrow.ts what such a row says. A sync notice is
// kept or folded once its page shows it (toldNotices); until then it lives across reads in app.ts keepUnshown. First setup's
// walkthrough (firstsetup.ts) is a band among a table's bands, given copyQuestion to hold the question of the item it is at.
// Usage, collected when a home opens and on Update usage statistics (app.ts collectUsage): when it was collected and the button
// at the toolbar's end, a band an Update or a failure opens (closed by its button), a figure on each row and a line per tool in
// an opened row, the Last used order (which a reading that lands never redraws: holdOrder), and the "No use seen in 30 days"
// chip with its band and one Turn these off (built from each row's own Off: rowClicks.off); what the reading says of a row, and
// the chip's rule, are usagerow.ts's.
// A table is told the kinds it lists and its tool by its caller (useLibrary, useTab give a Table): the Library's, its segment's
// kinds (its kind switch: kindSwitch; the segment is app.ts state.libraryKind), a tab's, its one kind. Its view is kept here
// (views): the Library's own, and each kind's for its tabs, apart. This module keeps no current kind, view or tool: the header, a
// reading as it lands and Escape ask for the table on screen (useTableShown). A row carries its kind (itemrow.ts ItemRow kind; a
// plugin's row: kindOf), and only a row's own kind says which it is: its words, its tools and its clicks.
// A row's switch or Add joins the page's list of clicks (flip, pluginRowSwitch → app.ts queueClick) and is worked out in its turn,
// perhaps while another table is drawn: its closures hold the row and the table it was clicked on, so it is worked out there.
import { brandMark } from './brand.ts';
import { caughtUpNames, clockTime, dayAndTime, dayWords, defaultHistoryDays, groupBy, holdingBuild, noticeNames, plural } from './model.ts';
import { cantUse, choiceEffect, nearestLine, shortQuote } from './copywords.ts';
import { andList, fewNames, kindNouns, pageNames, rowNames, rowNouns, saidByKind, sentence, toolList as toolsInWords, toolNames, toolsPhrase, turnIt } from './words.ts';
import { allSay, figureFor, incompleteHistory, lastUse, leftToItsRow, pluginRowFacts, toolHistories, usageSummary, USAGE_DAYS, type CantSay, type KindUsage, type ToolHistory, type ToolSays, type UsageFacts, type UsageSummary } from './usagerow.ts';
import { homeItems, inUse, itemId } from './profileplan.ts';
import { walkingAt, walkthroughBand } from './firstsetup.ts';
import { noteMove, acting, applyByKind, askFlash, closeResult, KINDS, problemKey, leftOutTools, collectUsage, unpin, whyKindReadOnly, whyReadOnly, saidInStatusBar, tell, type Click, type Outcome, type Page, type PageKind, harnessKindShown, pinnedRows, lastResult, flashRequests, leaveFiles, applyClick, queueClick, rerender, announce, restoreEvent, setSync, shownPath, showFile, showPage, state, syncNow } from './app.ts';
import { takeBack, wantedOn } from './clicklist.ts';
import { afterLayout, button, closeButton, emptyState, fileBlocks, findInput, h, icon, middle, pathText, toggle, withToolCount, type Child } from './dom.ts';
import type { IconName } from './icons.ts';
import { byName, inOrder, kindSource, lastUpdated, noPins, partId, pin, placeIn, rowId, timeIn, type ItemRow, type KindSource, type Pinned, type RowKey, type RowOrder, type Tool } from './itemrow.ts';
import { readFlag, writeFlag } from './flags.ts';
import { addLabel, asksWhichCopy, canAdd, waitsForSync, fromSourceWords, harnessIs, inLibrary, madeFrom, otherReadLines, ownCopies, placeOf as libraryPlace, rowClicks, statusLine, stillIn, switchLabel, versionClock, type HarnessIs, isPartial } from './libraryrow.ts';
import { libraryPages, type LibraryPage } from './librarypages.ts';
import { versionList, type VersionText } from './versionlist.ts';
import { listed, type Version } from './library.ts';
import { keptBack } from './clickplan.ts';
import type { Change, DestinationResult, HomeView, ItemNotice, LibraryFacts, PluginItemNotice, SyncGate, SyncNotice } from './types.ts';
import type { HarnessId, TakenInNotice, ThroughPlugin, UsageReading } from './types.ts';
import { pluginOf } from './sourcelink.ts';
import { heldKinds } from './presence.ts';
import { market } from './pluginstate.ts';
import type { PluginDraft } from './pluginplan.ts';
import { alongWords, cantSwitch, click as clickPluginItem, clickWords, itemSaid, onNow as itemOn, switchWords, turnEvery, wholeWords, type PluginItemAt } from './pluginswitch.ts';
import { pageOfPart, partOfPage } from './pluginstatus.ts';
import { cellWords, fromAPlugin, fromPluginsCount, handledWhere, inTool, insideTitle, offIn, pageRows, rowCount, pluginTools, toolWords, type PluginRow } from './pluginrows.ts';
import { folded, lineDiff } from './diff.ts';

const names = toolNames as Record<Tool, string>;

/**
 * Opens a plugin's page on Plugins, where the plugin itself is handled. `marketplace`: its
 * marketplace's name, to find it by when the page lists that marketplace under another spelling of its address.
 */
function openPlugin({ source, plugin, marketplace }: { source?: string; plugin: string; marketplace?: string }) {
  const lists = (entry: { plugins: { name: string }[] }) => entry.plugins.some(item => item.name === plugin);
  const listed = market.view?.marketplaces.find(entry => entry.source === source && lists(entry)) ?? market.view?.marketplaces.find(entry => !!marketplace && entry.name === marketplace && lists(entry));
  market.nav = { source: listed?.source ?? source, marketName: listed ? undefined : marketplace, plugin, tab: 'plugins', find: '', category: undefined };
  showPage('plugins');
}

/** The one mark of a plugin's item on its row: the plugin's glyph and "from <plugin>"; its title says which. */
const pluginTag = (plugin: string, title: string) => h('span.row-tag.row-part', { title }, icon('puzzle', 12, 'tone-faint'), `from ${plugin}`);

// ---------- What a plugin installed whole brings (pluginrows.ts) ----------
/** A table's plugin rows for the home on screen, every kind's together by name (itemrow.ts byName), and the installs whose copy couldn't be read, once each. */
const plugged = (t: Table) => {
  const each = state.home ? t.kinds.map(kind => pageRows(state.home!, kind)) : [], named = (row: PluginRow) => ({ key: row.name.toLowerCase(), kind: kindOf(row) });
  return { rows: each.flatMap(rows => rows.rows).sort((first, second) => byName(named(first), named(second))), unread: [...new Set(each.flatMap(rows => rows.unread))] };
};

/** The item a tool has through a plugin on a row of the person's own, with that plugin as the tool has it installed. */
function itemThrough(skill: ItemRow, tool: Tool): PluginItemAt | undefined {
  const given = throughPluginHere(skill, tool);
  const install = given && state.home?.pluginItems?.find(entry => entry.tool === tool && entry.plugin === given.plugin && entry.marketName === given.marketplace);
  return install ? { kind: partOfPage[skill.kind], name: given.name ?? skill.name ?? skill.key, tool: tool as HarnessId, install } : undefined;
}


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
 * The item's switch in one tool, in an opened row, where a person's own item has its switch there: on or off, applied at once,
 * with the tool's own switch for one item or (where it has none) the whole plugin's, which its line says first. `page`: a link
 * to the plugin's page beside it, on a row that has no other. `row`: the row it is drawn in, whose kind, key and ids it takes.
 */
function pluginItemControls(item: PluginItemAt, row: ItemRow | PluginRow, page?: () => void) {
  const id = elId('enable', row, item.tool);
  const on = itemOn(item);
  const why = cantSwitchHere(item);
  const label = `${item.name} in ${names[item.tool]}: ${on ? 'on' : 'off'}. ${why ?? clickWords(item)}`;
  return h('span.details-tool-actions', {},
    h('span.tool-switch', {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, on ? 'On' : 'Off'),
      // A plugin item's own switch writes no kind's record: the home's gate (cantSwitchHere asks it too).
      toggle({ on, label, disabled: why ?? writeOff(homeStops()), onchange: () => switchPluginItem(item, row), id })),
    page ? smallAction('Plugin’s page', elId('enable', row, item.tool, 'page'), page, '.tool-link') : null);
}

/** Opens the plugin's page on Plugins, found by its marketplace's name where the source each tool recorded is spelled otherwise. */
function openWhole(row: PluginRow) {
  const source = Object.values(row.installs).find(install => install?.listed)?.source;
  market.nav = { source, plugin: row.plugin, tab: 'plugins', find: '', category: undefined, marketName: row.marketName };
  showPage('plugins');
}

/** Where a plugin's item is handled, as a sentence: a link to the plugin's page, or how the tool itself does it. */
function handledNote(row: PluginRow, lead: string, id: string) {
  const where = handledWhere(row);
  return h('p.details-limits.details-note.details-part', {}, icon('puzzle', 12, 'tone-muted'), h('span', {}, lead, where.text,
    ...(where.listed ? [h('button.inline-link', { type: 'button', id, onclick: (event: Event) => { event.stopPropagation(); openWhole(row); } }, `${row.plugin}’s page on ${pageNames.plugins}`), '. '] : [' ']),
    'Central Knot doesn’t copy it between tools; the switches below turn it on or off in each tool.'));
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
    : h('div.plugin-file', {}, fileBlocks(elId('pfile', row, 'text'), file, copies, holders => `${file} · ${andList(holders.map(holder => names[holder.tool]))}`, { named: copies.length > 1 }));
  return h(`div.compare.details.details-plugin.details-grid${placement === 'row' ? '' : '.details-bare'}`, { role: 'region', 'aria-label': `Details for ${row.name}` },
    h('div.details-head', {},
      h('p.details-status', {}, pluginStatus(t, row)),
      row.kind === 'mcp' && row.description ? h('dl.details-definition', {}, h('dt', {}, 'Type'), h('dd', {}, type === 'Command' ? 'Command (stdio)' : type), h('dt', {}, type === 'Command' ? 'Command' : 'URL'), h('dd.mono', {}, rest.join(' · ')))
        : row.description ? h('p.details-description', {}, row.description) : null,
      handledNote(row, '', elId('open-whole', row))),
    h('div.details-tools', {}, toolsFor(t, kindOf(row)).map(tool => {
      const install = row.copies[tool as HarnessId] ? row.installs[tool as HarnessId] : undefined;
      const item: PluginItemAt | undefined = install && { kind: row.kind, name: row.name, tool: tool as HarnessId, install };
      return h('div.details-tool', {}, h('div.details-tool-head', {},
        h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
        h('span.details-tool-line', {}, [toolWords(row, tool as HarnessId), item ? cantSwitch(item) ?? switchWords(item) : ''].filter(Boolean).join(' ')),
        item ? pluginItemControls(item, row) : null), usageLine(t, row, tool));
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
    h(`div.ov-row.ov-switch-row.unmanaged.ov-plugin-row${takeFlash(idOf(row)) ? '.row-flash' : ''}${open ? '.open' : ''}${t.used ? '.ov-usage' : ''}`, { role: 'row', 'data-key': idOf(row), 'aria-expanded': String(open), onclick: () => openRow(t, row) },
      h('div.ov-managed', { role: 'cell' }, pluginRowSwitch(t, row)),
      h('div.ov-name.ov-name-fit.ov-name-bare', { role: 'cell', title: row.description ? `${row.name}: ${row.description}` : row.name },
        h('span.ov-name-main', {}, kindMark(t, kindOf(row)), h('span.ov-name-text', {}, row.name), kindWord(t, kindOf(row), row.name)),
        pluginTag(row.plugin, insideTitle(row)),
        row.description ? h('span.ov-name-about', { title: row.description }, row.description) : null),
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
    h('div.ov-section.ov-section-plugins', { role: 'row' }, h('div.ov-section-label', { role: 'cell' }, h('strong', {}, 'Only through a plugin'), h('span.ov-section-count', {}, String(list.length)),
      sectionNote(true, 'installed with their plugin · switched here like any other'))),
    list.flatMap(row => pluginRowEl(t, row)));
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
  blocks: facts.choiceBlocks, hashes: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.hash])),
  copies: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.hash])),
  paths: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.directory])),
  // An MCP entry has no lines or edit time of its own: the copy question quotes its summary alone.
  versions: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.lines ? { lines: `${copy!.lines} lines`, changed: ago(copy!.modified), at: copy!.modified, text: copy!.summary || facts.description, ...(copy!.body !== undefined ? { body: copy!.body } : {}) } : { lines: '', changed: '', text: copy!.summary }])),
  ownPart: Object.fromEntries(Object.entries(facts.copies).flatMap(([tool, copy]) => (copy!.ownPart?.length ? [[tool, copy!.ownPart]] : []))),
  loads: facts.loads, anotherWay: facts.anotherWay, takeOver: facts.takeOver, switchedOff: facts.switchedOff,
});

/** The kind's column header ("Server") and its title ("MCP servers"), from words.ts kindNouns. */
const nouns = Object.fromEntries((['skills', 'mcp', 'agents'] as const).map(each => [each, [kindNouns[each].short[0].replace(/^./, first => first.toUpperCase()), kindNouns[each].title]])) as Record<PageKind, [string, string]>;
const factsCache: Partial<Record<PageKind, { from: unknown; list: ItemRow[] }>> = {};

/** A kind's rows in the home on screen, made once per read of its view. */
function rowsOf(kind: PageKind): ItemRow[] {
  if (!state.home) return [];
  const { facts } = kindSource(state.home, kind);
  // Where a plugin has it on is read from the plugins the tools have, beside the facts (an Off item's words say it).
  if (factsCache[kind]?.from !== facts) factsCache[kind] = { from: facts, list: facts.map(fact => fromFacts(kind, fact)).map(row => ({ ...row, pluginOn: pluginOnIn(row) })) };
  return factsCache[kind]!.list;
}
/**
 * A table (useLibrary, useTab): the kinds it lists (the Library's segment's; a tab's one) and the harness whose page it is on
 * (`tool`, none on the Library: its column comes first, and the rows it has before the others), as its caller names them; its
 * view (views); and, as drawTable draws it, whether it has the Used column (`used`: usedColumn) and the names rows of two kinds
 * share in it (`shared`: sharedNames), each worked out once per draw. A
 * row's drawing and its clicks read the row and its table.
 */
interface Table { kinds: PageKind[]; tool?: Tool; view: View; used?: boolean; shared?: Set<string> }
/** Every row the table lists, of each of its kinds, as the kinds' views have them (rowsOf). */
const rowsIn = (t: Table) => t.kinds.flatMap(rowsOf);
/**
 * Each kind a table lists, with what it brings beside its rows: its own record's stop (the home's is said once, by listNotices),
 * its problems beside that stop, its part of the usage reading (kindUsage) and the From plugins chip's count. The bands
 * (listNotices), the From plugins and No use seen chips' counts and the No use seen band (usedColumn, unusedCount, unusedBand)
 * go over the kinds here. Kept for the last home, reading, kinds and tool asked for, one entry: the asks for one table share it,
 * and on a segment of one kind the segment's asks and the chips' (overEveryKind) take turns, each working it out again. Not here:
 * a kind's notices, kept as they are first shown (toldNotices).
 */
function kindParts(t: Table) {
  const home = state.home, read = reading(t), of = `${t.kinds.join('+')} ${t.tool ?? ''}`;
  if (!home) return [];
  if (partsWorked?.of !== of || partsWorked.home !== home || partsWorked.read !== read) partsWorked = { of, home, read, parts: t.kinds.map(kind => {
    const gate = home[kind].gate;
    return { kind, stop: gate.state === 'stopped' ? gate.reason : undefined, problems: problemsBesideStop(home[kind].problems, gate),
      usage: kindUsage(t, kind), fromPlugins: fromPluginsCount(home, kind, t.tool as HarnessId | undefined) };
  }) };
  return partsWorked.parts;
}
let partsWorked: { of: string; home: HomeView; read?: UsageReading; parts: { kind: PageKind; stop?: string; problems: string[]; usage?: KindUsage; fromPlugins: number }[] } | undefined;
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
/** A row's `pluginOn`: the tools of its kind with no copy of their own that have it on through an installed plugin (libraryrow.ts LibraryRow). */
const pluginOnIn = (skill: ItemRow): Tool[] => (state.home ? kindSource(state.home, skill.kind).tools : []).filter(tool => { const given = throughPluginHere(skill, tool); if (!given) return false; const item = itemThrough(skill, tool); return item ? itemOn(item) : !given.off; });
/** An item as Central Knot's library holds it (library.ts), deleted or not; none for an item only found in a harness. */
const itemOf = (skill: ItemRow) => (state.home ? kindSource(state.home, skill.kind).library[skill.key] : undefined);
/** Where a row stands: 0 on, 1 found (in a tool, not in Central Knot), 2 off: its item's place (libraryrow.ts). */
const standingOf = (skill: ItemRow): 0 | 1 | 2 => ({ on: 0, found: 1, off: 2 } as const)[libraryPlace(itemOf(skill))];
/** The headings, by place. */
const placeNames = ['On', 'Found', 'Off'] as const;
/** A heading of a table: On, Found, Off, or (on a harness's page) Not in it. */
type Role = 'on' | 'found' | 'off' | 'away';
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
type Filter = 'all' | 'attention' | 'plugins' | 'unused';
const newView = () => ({
  filter: 'all' as Filter,
  find: '',
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
/** A view drawn for another place (a tool's tab, or the Library) starts with no filter, Find text, open row or menu from the last one. */
function startFresh(table: View, harness: Tool | undefined) {
  Object.assign(table, { filter: 'all', find: '', comparing: undefined, confirmDelete: undefined, shownFor: harness });
}
/**
 * The one way into the Library from elsewhere (the Overview's cards and lines, a plugin's page, History, the Git repo, Sources):
 * the Library with `which` chosen (a kind, or All: app.ts state.libraryKind), drawn afresh (startFresh: no Find, no
 * chip, no open row), narrowed by `filter` ("Copies differ", "No use seen in 30 days"), or with the row `key` open and scrolled
 * into view (a plugin's own row too; a key needs its kind, so All takes none). The row is opened once the page is drawn, as its own click opens it (markOpen): so the
 * first draw in another home, which drops that home's open row, can't drop it, and a row whose copies differ keeps its question.
 */
export function openKind(which: 'all', options?: { filter?: Filter }): void;
export function openKind(which: PageKind, options?: { filter?: Filter; key?: string }): void;
export function openKind(which: PageKind | 'all', { filter, key }: { filter?: Filter; key?: string } = {}) {
  state.libraryKind = which;
  startFresh(views.library, undefined);
  if (filter) views.library.filter = filter;
  showPage('library');
  if (key && which !== 'all') openFromAway(views.library, rowId(which, key));
}
/**
 * A link to an item on the Library (first setup's walkthrough: firstsetup.ts goOn; a notice's name): the Library's list, out of its
 * Files view, with that item's row open and in view. The segment stays where it lists the item's kind, else goes to All; Find and
 * the chip are let go only where they hide the row.
 */
export function showRow(which: PageKind, key: string) {
  if (segment() !== 'all' && segment() !== which) state.libraryKind = 'all';
  if (state.page !== 'library') showPage('library');
  if (state.libraryView === 'files') leaveFiles();
  const t = useLibrary(), id = rowId(which, key), row = rowsIn(t).find(each => idOf(each) === id);
  if (row) reveal(t, row); else openFromAway(t.view, id);
}
/** A link to a row where the person is (a notice's name, the walkthrough): Find and the chip let go only where they hide it. */
function reveal(t: Table, row: ItemRow) {
  if (!(onChip(t, row) && findMatches(t, row))) Object.assign(t.view, { find: '', filter: 'all' });
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

const throughPluginHere = (skill: ItemRow, tool: Tool): ThroughPlugin | undefined => (skill.copies[tool] === undefined ? skill.plugin?.[tool] : undefined);


const smallAction = (label: string, id: string, onclick: () => void, extra = '', disabled = false) =>
  h(`button.text-action${extra}`, { type: 'button', id, disabled, onclick: (event: Event) => { event.stopPropagation(); onclick(); } }, label);

// ---------- The toolbar ----------

/**
 * On the Library, the table over every kind it holds, whatever the segment (a tool's tab keeps its kind): what a chip is offered
 * over, so a segment it leaves at 0 doesn't drop it (each count is the segment's), and an empty Library's bands.
 */
const overEveryKind = (t: Table): Table => (t.tool || !state.home ? t : { ...t, kinds: heldKinds(state.home) });
const chipNames = { attention: 'Copies differ', plugins: 'From plugins', unused: `No use seen in ${USAGE_DAYS} days` } as const;
/**
 * The chips: each shows only what it names and is a toggle, a second click letting go (one at a time; none shows every row). Each
 * has a short form, its mark, for a crowded toolbar: the whole group folds together (dom.ts fitBars), with each name as its tooltip.
 */
function filterBar(t: Table) {
  const view = t.view, attention = rowsIn(t).filter(skill => needsChoice(t, skill)).length;
  // `count`: how many it shows, amber when they need something (`warn`).
  const chip = (id: Filter, label: string, glyph: IconName, count: number, warn = false) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn && count ? '.chip-warn' : ''}`,
    { type: 'button', id: `chip-${id}`, 'aria-pressed': String(view.filter === id), 'aria-label': `${label} ${count}`, 'data-tip': label, onclick: () => { view.filter = view.filter === id ? 'all' : id; rerender(); } },
    icon(glyph, 13, 'chip-icon'), h('span.chip-label', {}, label), h('span.chip-count', {}, String(count)));
  // A chip is offered while something matches it, over every kind the Library holds (overEveryKind), or while it is the one on.
  const over = overEveryKind(t), offered = (id: Filter, matching: boolean) => matching || view.filter === id;
  const chips = [offered('attention', copiesDifferChipShown(over)) ? chip('attention', chipNames.attention, 'diff', attention, true) : null, offered('plugins', pluginChipShown(over)) ? chip('plugins', chipNames.plugins, 'puzzle', pluginCount(t)) : null,
    offered('unused', !!unusedCount(over)) ? chip('unused', chipNames.unused, 'history', unusedCount(t)) : null].filter(Boolean);
  return chips.length ? h('div.chips', { role: 'group', 'aria-label': 'Show only' }, chips) : null;
}

/** Each kind's mark: before a Library row's name, on the kind switch and on the Overview's cards. */
export const kindGlyph: Record<PageKind, IconName> = { skills: 'wand-sparkles', mcp: 'plug', agents: 'bot' };
/** A row's small, faint mark of its kind on the Library, named by its kind (a tab lists one kind, and has none). */
const kindMark = (t: Table, kind: PageKind) => (t.tool ? null : h('span.kind-mark', { role: 'img', 'aria-label': kindNouns[kind].one, title: kindNouns[kind].one }, icon(kindGlyph[kind], 13)));
/** A row's kind in words beside its name where a row of another kind in the list has that name ("review · agent"), as a run's words name it. */
const kindWord = (t: Table, kind: PageKind, name: string) => (t.shared?.has(name.toLowerCase()) ? h('span.row-kind', {}, kindNouns[kind].one) : null);
/** The names rows of two kinds share in a table (a plugin's own rows too), lower-cased: where kindWord writes the kind. */
const sharedNames = (t: Table) => {
  const kindsOf = groupBy([...rowsIn(t), ...plugged(t).rows], row => nameOf(row).toLowerCase());
  return new Set([...kindsOf].filter(([, rows]) => new Set(rows.map(kindOf)).size > 1).map(([name]) => name));
};

/**
 * The Library's kind switch, first in its toolbar: All and each kind a managed tool here can hold (presence.ts heldKinds), its
 * words always shown (dom.ts fitBars folds the chips and Sort first, then wraps the bar, the switch first). Each counts the rows
 * of its kind that Find and the chip leave (listed: a row kept only by a pin is none), with "?" after it where its own record or a
 * tool's file of it couldn't be read, as the Overview's tools table says. None with one kind.
 */
function kindSwitch(t: Table) {
  const home = state.home, kinds = home ? heldKinds(home) : [];
  if (!home || t.tool || kinds.length < 2) return null;
  const every: Table = { ...t, kinds }, count = (kind: PageKind) => listedRows({ ...every, kinds: [kind] }).length;
  const unread = (kind: PageKind) => notAllRead(home, kind);
  // A kind not on show whose automatic change wasn't painted is marked, as the sidebar's dot says (renderer.ts).
  const news = (id: PageKind | 'all') => id !== 'all' && !t.kinds.includes(id) && unseenNotices(id).length > 0;
  const choice = (id: PageKind | 'all', label: string, glyph: IconName, counted: number, unsure: boolean) => h(`button.kind-seg${segment() === id ? '.kind-seg-on' : ''}`, {
    type: 'button', id: `library-kind-${id}`, 'aria-pressed': String(segment() === id), title: unsure ? `${label}: ${counted} known; some couldn’t be read` : news(id) ? `${label}: an automatic change to see` : undefined,
    onclick: () => { state.libraryKind = id; rerender(); } }, icon(glyph, 13, 'tone-muted'), h('span.kind-seg-label', {}, label), h('span.kind-seg-count', {}, `${counted}${unsure ? '?' : ''}`), news(id) ? h('span.kind-seg-news') : null);
  return h('div.kind-switch', { role: 'group', 'aria-label': 'Kind' }, choice('all', 'All', 'layers', kinds.reduce((sum, kind) => sum + count(kind), 0), kinds.some(unread)),
    ...kinds.map(kind => choice(kind, kindNouns[kind].title, kindGlyph[kind], count(kind), unread(kind))));
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
/** Why a write other than a row's own switch or Add is off now, if it is: the page acts (app.ts acting says why), or `stops`. */
const writeOff = (stops: boolean): string | boolean => acting() ?? stops;
/** A row's own switch or Add takes a click while a run of clicks goes on (app.ts queueClick): off only under other work, or by `stops`. */
const queueOff = (stops: boolean) => stops || !!state.busy;

/** What could not be done, item by item (the first four, then how many more), as a warning band. */
export const problemsBand = (problems: DestinationResult[]) => h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
  h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · ') + (problems.length > 4 ? ` · and ${problems.length - 4} more` : '')));

/** Names shown as names, so a server called "files" does not read as a word in the sentence. */
const nameList = (items: string[]) => items.flatMap((item, index) => [index ? (index === items.length - 1 ? ' and ' : ', ') : '', h('strong.item-name', {}, item)]).filter(part => part !== '');

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

/** Where an earlier Undo went, said by what it undoes: "The undo for your change to files moved to History." */
function movedUndoText(label: string, items: string[]): (string | HTMLElement)[] {
  const named = nameList(items.slice(0, 3));
  const what = label === 'Undo' && items.length ? ['your change to ', ...named] : [label.replace(/^Undo\s*/, '') || 'your last change'];
  return ['Earlier: the undo for ', ...what, ' is in '];
}

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
  const asked = skill.takeInAnswers?.click, latestHash = asked && 'wait' in asked ? asked.latest : undefined;
  const latest = groups.find(([tool]) => skill.hashes?.[tool] === latestHash);
  // When a group's content was made, for its line: when its earliest copy was changed (as latestCopy reads it).
  const editedAt = groups.map(group => Math.min(...group.map(tool => Date.parse(versions[tool]?.at ?? ''))));
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
    return h('button.version', { type: 'button', id: elId(`${prefix}use`, skill, tool), 'aria-label': `Use ${tools}’s copy`, disabled: !!writeOff(kindStops(skill.kind)), onclick: () => void applyClick(turnOn(t, skill, tool)).then(then) },
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
    ? h('div.compare-copies', {}, fileBlocks(elId(`${prefix}body`, skill), lib.words.body, compared.map(tool => ({ tool, text: versions[tool]?.body ?? '' })), holders => `${lib.words.body} · ${andList(holders.map(holder => names[holder.tool]))}`, { named: true }))
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
  const skill = rowsOf(kind).find(row => row.key === key);
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
  // Details that run past the table's bottom are brought into view with their row at its top, so the row's name and the
  // details' close button are in view too. Docked details sit beside the table and are always in view.
  if (view.comparing && underRow(t, id)) requestAnimationFrame(() => {
    const rowEl = document.querySelector(`.ov-row[data-key="${CSS.escape(id)}"]`);
    const details = rowEl?.nextElementSibling;
    const box = rowEl?.closest('.scroll')?.getBoundingClientRect();
    if (!rowEl || !details || !box) return;
    if (details.getBoundingClientRect().bottom > box.bottom) rowEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
/** The opened row's line saying which source an item is from, and whether a version waits there or it removed the item, with its link to that source's page. */
function fromSourceLine(skill: ItemRow, from: NonNullable<ItemRow['fromSource']>) {
  const said = fromSourceWords(from);
  return h('p.details-limits.details-note', {}, icon('link-2', 12, from.waits || from.removed ? 'tone-warning' : 'tone-muted'), h('span', {}, said.before,
    h('button.inline-link', { type: 'button', id: elId('from-source', skill), title: from.link, onclick: () => showPage(said.page) }, pageNames[said.page]), said.after));
}

/**
 * An item's name cell. The name gives way last: as the column narrows, the description shortens (and in every row at
 * once steps aside, settleDescriptions, after any name longer than half its row is cut), a tag after the name wraps out
 * of sight, and only then does the name shorten (style.css .ov-name-fit). Its full text is always in the tooltip. Nothing in it is a control: the row's switch and chevron
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
    skill.description ? h('span.ov-name-about', { title: skill.description }, skill.description) : null);
}

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

/**
 * The last action's result as a band, when it offers something to do; a result that only tells is in the status bar. While a
 * table is on screen (useTableShown), its open copy choice hides an older result. On a list page it is drawn in the header only
 * (listResult); the pages that draw it in a band are the others.
 */
export function outcomeBand(): HTMLElement | null {
  const outcome = state.outcome;
  if (!outcome || !outcomeShown(outcome, useTableShown()) || saidInStatusBar(outcome)) return null;
  // Item names are tokens in result text too, so "files" does not read as a word.
  const names = [...new Set([...(outcome.item ? [outcome.item] : []), ...(outcome.items ?? [])])].filter(Boolean).sort((a, b) => b.length - a.length);
  const text: (string | Node)[] = [];
  let rest = outcome.text;
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
  const reasons = resultInHeader() ? [] : (outcome.reasons ?? []).flatMap(reason => [' ', h('span.band-reason', {}, reason)]);
  // Two buttons take their own line under the words in a narrow window (style.css), so the sentence is never squeezed.
  return h(`div.band.band-done${outcome.next ? '.band-two' : ''}`, { role: 'status', 'data-outcome': outcome.kind ?? '' }, outcome.warn ? icon('triangle-alert', 14, 'tone-warning') : icon('check', 14, 'tone-success'), h('span.band-text', {}, ...text,
    // The space before the note sits outside it, so a note kept whole on its line never carries the last word with it.
    outcome.note ? [' ', h('span.tone-faint', {}, outcome.note.replace(/ History\.$/, ' '), h('button.inline-link', { type: 'button', id: 'outcome-note-history', onclick: (event: Event) => { event.stopPropagation(); showPage('history'); } }, 'History'), '.')] : null, reasons),
    h('span.band-actions', {},
      outcome.act ? button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, disabled: outcome.act.whyOff?.() ?? acting(), attrs: outcome.act.title ? { title: outcome.act.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.act!.run(); } })
        : outcome.undo ? smallAction(outcome.undo.label, 'outcome-undo', () => void restoreEvent(outcome.undo!.id), undefined, !!acting())
        : outcome.history ? smallAction('Undo in History', 'outcome-history', () => showPage('history')) : null,
      outcome.next ? button({ variant: 'outline', size: 'small', label: outcome.next.label, id: outcome.next.id, attrs: outcome.next.title ? { title: outcome.next.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.next!.run(); } }) : null),
    closeButton(closeResult, { id: 'outcome-dismiss' }));
}

/** Sync off: what waits, and the two ways on. Shown on every managed page, since the switch covers all of them. */
function syncOffBand(t: Table): HTMLElement | null {
  if (!state.home || state.home.syncOn) return null;
  const waiting = rowsIn(t).filter(waitsForSync);
  const editedIn = (skill: ItemRow) => (skill.edited?.length ? `, edited in ${andList(skill.edited.map(tool => names[tool]))}` : '');
  const what = waiting.slice(0, 3).flatMap((skill, index) => [index ? ', ' : '', h('strong.item-name', {}, skill.name ?? skill.key), editedIn(skill)]).concat(waiting.length > 3 ? [` and ${waiting.length - 3} more`] : []);
  // Right after a sync, its notice says what spread; the idle banner comes back once that is dismissed.
  if (!waiting.length && visibleNotices(t).length) return null;
  return h('div.band.band-sync-off', { role: 'status' }, icon('circle-minus', 14, waiting.length ? 'tone-warning' : 'tone-muted'),
    h('span.band-text', {}, ...(waiting.length ? [`Automatic sync is off. ${waiting.length} ${waiting.length === 1 ? 'change' : 'changes'} waiting: `, ...what, '.'] : ['Automatic sync is off. Edits and deletions in your tools will wait here.'])),
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

/** The bands above a table, from its kind's view (listView). */
function listNotices(t: Table) {
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
  const shownNotices = visibleNotices(t);
  const onScreen = shownNotices.slice(0, noticeLineLimit);
  // An earlier result's Undo that stepped aside for this notice: one faint closing line inside the notice, not a band of its own.
  const moved = state.undoMoved?.page === state.page && !state.outcome && onScreen.some(notice => state.undoMoved!.notices.includes(notice.history))
    ? h('span.notice-tail.tone-faint', { id: 'undo-moved' }, ...movedUndoText(state.undoMoved!.label, state.undoMoved!.items), h('button.inline-link', { type: 'button', id: 'notice-undo-moved', onclick: () => showPage('history') }, 'History'), '.') : null;
  if (shownNotices.length) {
    const lines = onScreen.map(notice => syncNotice(t, notice));
    if (moved) {
      const link = lines.at(-1)!.querySelector<HTMLElement>('[id^="notice-history-"]');
      if (link) link.title = `${moved.textContent?.replace(/^Earlier: the undo/, 'The earlier undo').replace(/ is in History\.$/, ' is here too')}.`;
      else lines.at(-1)!.append(moved);
    }
    // While the walkthrough asks, each notice keeps to its first line, with the way to see them whole, as a long result folds.
    const whole = walk ? smallAction(noticesWhole ? 'Show less' : 'Show all', 'notices-show-all', () => { noticesWhole = !noticesWhole; rerender(); }) : null;
    bands.push(h(`div.band.sync-notices${walk && !noticesWhole ? '.notices-folded' : ''}`, { role: 'status' }, h('div.sync-notice-lines', {}, lines), whole, dismissNotices(shownNotices)));
  }
  return bands.length ? h('div.bands', {}, bands) : null;
}

/**
 * A list page's last result, for the header (renderer.ts resultHere): its band, then its problem lines (what its click could not
 * do, then its reasons: app.ts Outcome), or else what a background pass could not do (any kind's), until a click or × ends them.
 */
export function listResult(): HTMLElement[] {
  // The last results, the page's: on the Library every kind's, whatever the segment, as a run there is one (app.ts placeNow);
  // on a tool's tab its kind's. A line is led by its kind where the result is of several kinds (its lines', and a run's: app.ts
  // Outcome kinds), so two alike are told apart.
  const table = useTableShown(), kinds = !table ? [] : table.tool || !state.home ? table.kinds : heldKinds(state.home);
  const kept = kinds.flatMap(kind => (lastResult(kind)?.results ?? []).filter(keptBack).map(problem => ({ kind, problem })));
  const result = kinds.map(lastResult).find(Boolean), done = outcomeBand(), several = new Set([...kept.map(each => each.kind), ...(done ? state.outcome?.kinds ?? [] : [])]).size > 1;
  const background = !table || result ? [] : (state.home?.sync.caughtUp ?? []).filter(entry => entry.outcome !== 'written' && entry.outcome !== 'removed' && !state.dismissed.has(problemKey(entry)));
  // A tool's refusal is said in parts (problemLines): its kind where several, the item in bold and its tool, then what failed.
  const lines = [...background.map(problem => ({ kind: undefined, problem })), ...kept]
    .map(({ kind, problem }): Child[] | string => [several && kind ? `${kindNouns[kind].title}: ` : '', h('strong.item-name', {}, problem.item), problem.harness ? ` (${names[problem.harness]})` : '', `: ${problem.message}`])
    .concat(done ? state.outcome?.reasons ?? [] : []);
  // With no result above them, their × closes them and the click's result they belong to.
  const close = () => { for (const entry of background) state.dismissed.add(problemKey(entry)); closeResult(); };
  // With no problem line, Show all follows the sentence, for one the header's two lines cut.
  if (done && !lines.length) done.querySelector('.band-text')!.after(wholeToggle(state.outcome, 0));
  return [done, lines.length ? h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), problemLines(lines, done ? state.outcome : result ?? background[0]), done ? null : closeButton(close, { id: 'problems-dismiss' })) : null]
    .filter((band): band is HTMLElement => !!band);
}

/**
 * What went wrong, under a result in the header (renderer.ts resultHere): its first line, on the header's second line, then
 * Show all; shown whole (`of`, their result: app.ts state.shownWhole), every line whole. A line given in parts is its item, then
 * what happened to it (the last part): folded, the item is what is shortened first (style.css .problem-head).
 */
export function problemLines(lines: (Child | Child[])[], of: typeof state.shownWhole): HTMLElement {
  const whole = of !== undefined && state.shownWhole === of, shown = whole ? lines : lines.slice(0, 1);
  const text = (line: Child | Child[]) => h('span.problem-text', {}, Array.isArray(line) ? [h('span.problem-head', {}, line.slice(0, -1)), h('span.problem-rest', {}, line.at(-1))] : line);
  return h(`span.band-text.band-lines${whole ? '.lines-whole' : ''}`, {}, shown.map((line, at) => h('span.problem-line', {}, text(line), at === shown.length - 1 ? wholeToggle(of, lines.length) : null)));
}

/**
 * The one Show all of a result in the header, after the last thing it shows (the sentence, or a problem line): "Show all 3 reasons"
 * where `count` lines wait, else drawn only when the header cuts what it shows (renderer.ts, data-when-cut); Show less on the card.
 */
export function wholeToggle(of: typeof state.shownWhole, count: number): HTMLElement {
  const whole = of !== undefined && state.shownWhole === of, more = count > 1;
  return h('button.inline-link', { type: 'button', id: 'problems-show-all', 'aria-expanded': String(whole), 'data-when-cut': whole || more ? undefined : '', onclick: () => { state.shownWhole = whole ? undefined : of; rerender(); } },
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
const notices = (t: Table) => (state.home ? listNotices(t) : null);

/** The home each view, and the kept notices, were last drawn for. */
const tableHomes: Partial<Record<keyof typeof views | 'notices', string>> = {};
/**
 * What a table keeps belongs to one home: opening another starts each view with no open row and no armed Delete, and every
 * kind's kept notices go at once, whatever kinds were on show (the pins and the last results go in app.ts accept).
 */
function forgetOtherHomes(t: Table, name: keyof typeof views) {
  const now = state.home?.home, was = tableHomes[name];
  if (tableHomes.notices !== now) { keptNotices.clear(); foldedNotices.clear(); tableHomes.notices = now; }
  if (now === was) return;
  tableHomes[name] = now;
  // A view's first table has no other home's to forget (a link may have opened its row before it was drawn).
  if (was !== undefined) Object.assign(t.view, { comparing: undefined, confirmDelete: undefined });
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
  return h('div.change-panel', {}, h('p.change-caption', {}, `The edit: ${counts}. Undo puts the earlier version back in every tool it syncs to.`), h('pre.ins-diff', { tabindex: '0', 'aria-label': 'What the edit changed' }, folded(diff, false).map(line => line.kind === 'fold'
    ? h('span.ins-fold-static', {}, `… ${line.count} unchanged ${line.count === 1 ? 'line' : 'lines'}\n`)
    : h(`span.ins-line.ins-${line.kind}`, {}, h('span.ins-mark', { 'aria-hidden': 'true' }, line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''), h('span.ins-code', {}, `${line.text}\n`)))));
}

/** A notice as a table shows it: the kind it is about (`of`), whether it was said while sync was off (`once`), and when it first showed (`seq`: state.said.seq). */
type Told = SyncNotice & { of: PageKind; once?: boolean; seq: number };
/** Notices stay until read: each read brings only what is new, so the page keeps earlier ones until × or Undo, or another home. */
const keptNotices = new Map<PageKind, Map<string, Told>>();
/** Notices folded into History by a newer one: never shown again, though the read still lists them. */
const foldedNotices = new Map<PageKind, Set<string>>();
const keptSync = new Map<PageKind, boolean>();
/** One kind's notices, kept or folded as a table of it shows them. */
function toldNotices(kind: PageKind): Told[] {
  if (!state.home) return [];
  // What the kind's view says sync did, and what its last click's result does.
  const fresh = [...state.home[kind].notices, ...(lastResult(kind)?.notices ?? [])];
  let kept = keptNotices.get(kind);
  if (!kept) keptNotices.set(kind, kept = new Map());
  let folded = foldedNotices.get(kind);
  if (!folded) foldedNotices.set(kind, folded = new Set());
  const keyOf = (notice: SyncNotice) => notice.history;
  // A newer event folds what was said before into History, where it stays with its Undo: notices never pile up. A click's result
  // folds none (it is said in the header), so a notice never goes from above the list at a click. Turning sync on or off retires
  // the ones it no longer lists.
  const news = fresh.filter(notice => !kept!.has(keyOf(notice)) && !folded!.has(keyOf(notice)));
  for (const key of [...kept.keys()]) if (news.length) { folded.add(key); kept.delete(key); }
  if (keptSync.get(kind) !== state.home.syncOn) for (const key of [...kept.keys()]) if (!fresh.some(notice => keyOf(notice) === key)) kept.delete(key);
  keptSync.set(kind, state.home.syncOn);
  // The wording is fixed when the notice first shows: a Sync once stays "Synced once" after sync is turned on.
  for (const notice of fresh) { const key = keyOf(notice); if (!kept.has(key) && !folded.has(key)) kept.set(key, { ...notice, of: kind, once: !state.home.syncOn, seq: state.said.seq }); }
  for (const key of [...kept.keys()]) if (state.dismissed.has(key)) kept.delete(key);
  return [...kept.values()].reverse();
}

/** A kind's automatic changes not yet painted on any page (a painted notice is seen: syncNotice), those dismissed aside. */
export const unseenNotices = (kind: PageKind) => (state.home?.[kind].notices ?? []).filter(notice => !state.dismissed.has(notice.history) && !state.seenNotices.has(notice.history));
/** The notices a table shows: each of its kinds', newest first, those dismissed aside. */
function visibleNotices(t: Table) {
  if (!state.home) return [];
  return t.kinds.flatMap(toldNotices).sort((first, second) => second.seq - first.seq).filter(notice => !state.dismissed.has(notice.history));
}

const noticeLineLimit = 6;
/** The notices shown whole while first setup's walkthrough folds them (listNotices): this window's, until changed. */
let noticesWhole = false;

/** Which of this news the open table will draw, where it can tell the person where their Undo went. */
export function noticeLinesOnPage(news: { kind: PageKind; notice: SyncNotice }[], outcome: Outcome): string[] {
  const home = state.home;
  if (!home || holdingBuild(home.otherBuilds)) return [];
  const t = useTableShown();
  if (!t || !outcomeShown(outcome, t)) return [];
  const fresh = new Set(news.filter(each => t.kinds.includes(each.kind)).map(each => each.notice.history));
  if (!fresh.size) return [];
  if (t.tool ? !home[t.kinds[0]!].tools.some(tool => tool === t.tool) : !t.kinds.some(kind => rowCount(home, kind))) return [];
  return visibleNotices(t).slice(0, noticeLineLimit).map(notice => notice.history).filter(id => fresh.has(id));
}

/** The kinds of the table on screen, whose notices it shows (app.ts sayBackgroundNews: news it shows is said quietly). */
export const kindsShown = (): PageKind[] => useTableShown()?.kinds ?? [];

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

/** A library item's notice (libraryrow.ts noticeWords), with its button: Undo, or Turn it on after a copy deleted by hand turned it off. */
function libraryNotice(lib: LibraryPage, notice: ItemNotice | PluginItemNotice, undo: (title: string) => HTMLElement): NoticeLook {
  const { text, action, help } = lib.say.noticeWords(notice);
  if (action === 'undo') return [notice.kind === 'conflict' ? 'diff' : 'check', notice.kind === 'conflict' ? 'tone-warning' : 'tone-success', text, undo(help)];
  if (!action) return ['link-2-off', 'tone-muted', text, null];
  const on = button({ variant: 'outline', size: 'small', label: turnIt(true), id: `notice-restore-${notice.history}`, onclick: () => void restoreEvent(notice.history) });
  on.title = help;
  return ['trash-2', 'tone-muted', text, on];
}

function syncNotice(t: Table, notice: Told) {
  if (notice.kind === 'taken-in') return takenInNotice(t, notice);
  // Undo is the one action here that writes files: a small outlined button, apart from the quieter links. It says "Undo", as
  // every strip's result does; its tooltip says where.
  const undo = (title: string) => { const action = button({ variant: 'outline', size: 'small', label: 'Undo', id: `notice-undo-${notice.history}`, onclick: () => void restoreEvent(notice.history) }); action.title = title; action.setAttribute('aria-label', `Undo: ${title}`); return action; };
  const offNow = notice.once ?? (!!state.home && !state.home.syncOn);
  const [glyph, tone, text, action] = libraryNotice(libraryPages[notice.of], notice, undo);
  // The item's name opens its row here, so "what changed" is one click from the change itself.
  const told = rowsOf(notice.of).find(skill => skill.name === notice.item || skill.key === notice.item.toLowerCase());
  const noticeKey = notice.history;
  state.seenNotices.add(notice.history);
  // The rows a notice just told about show a brief highlight: on a draw in the next 3 s.
  if (told && !firstShown.has(noticeKey)) askFlash(idOf(told), Date.now() + 3000);
  // The item's name opens its row: one click from "what changed" to the item, with no separate Details link.
  const name = told && t.view.comparing !== idOf(told)
    ? h('button.item-name.notice-name', { type: 'button', id: `notice-open-${notice.history}`, title: `Show ${notice.item}’s details`, onclick: (event: Event) => { event.stopPropagation(); if (t.tool) reveal(t, told); else showRow(told.kind, told.key); } }, notice.item)
    : h('strong.item-name', {}, notice.item);
  const said = notice.item && text.startsWith(notice.item) ? [name, text.slice(notice.item.length)] : [text];
  // With sync off, a notice can only come from Sync now: say sync stays off, and offer to turn it on.
  const off = !!state.home && !state.home.syncOn;
  const history = !off ? smallAction('History', `notice-history-${notice.history}`, () => showPage('history')) : null;
  return h('p.sync-notice', { 'data-kind': notice.kind }, icon(glyph, 14, tone), noticeKind(t, notice),
    h('span.notice-text', {}, offNow && notice.kind !== 'deleted-by-hand' ? 'Synced once: ' : '', ...said.map(part => typeof part === 'string' && !/\.\s/.test(part) ? part.replace(/\.$/, '') : part), '', h('span.notice-age', {}, ` · ${age(notice.history)}`)),
    h('span.notice-actions', {},
      notice.kind === 'edit' || notice.kind === 'conflict' ? seeChangeLink(notice.history, notice.of) : null,
      action, history, off ? smallAction('Turn sync on', `notice-sync-on-${notice.history}`, () => void setSync(true)) : null),
    closeButton(event => { event.stopPropagation(); state.dismissed.add(notice.history); rerender(); }, { id: `notice-dismiss-${notice.history}`, label: `Dismiss this notice about ${notice.item}`, title: 'Dismiss', look: '.notice-dismiss' }),
    notice.history ? changePanel(notice.history) : null);
}

/**
 * Synchronize everything's notice for one pass (types.ts TakenInNotice): how many it took in, where it found them and their
 * names, with History, where each one's own Undo is. Nothing to undo here: each item has its own entry.
 */
function takenInNotice(t: Table, notice: TakenInNotice & Pick<Told, 'of' | 'once'>) {
  const off = !!state.home && !state.home.syncOn, once = notice.once ?? off;
  state.seenNotices.add(notice.history);
  return h('p.sync-notice', { 'data-kind': notice.kind }, icon('plus', 14, 'tone-success'), noticeKind(t, notice),
    h('span.notice-text', {}, once ? 'Synced once: ' : '', libraryPages[notice.of].say.takenInWords(notice), h('span.notice-age', {}, ` · ${age(notice.history)}`)),
    h('span.notice-actions', {}, smallAction('History', `notice-history-${notice.history}`, () => showPage('history'))),
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
  // Not while rows are pinned under it: they stay listed (drawTable).
  if (files || pinnedHere(t).rows.size > 0) return t;
  const over = overEveryKind(t);
  if (t.view.filter === 'attention' && !copiesDifferChipShown(over)) t.view.filter = 'all';
  if (t.view.filter === 'plugins' && !pluginChipShown(over)) t.view.filter = 'all';
  if (t.view.filter === 'unused' && !unusedCount(over)) t.view.filter = 'all';
  return t;
}
/** The segment the Library was last drawn for (useLibrary), so another one starts its list afresh. */
let drawnSegment: PageKind | 'all' | undefined;
/**
 * The Library's table: its segment's kinds. Another segment than the one drawn last starts its list afresh: at its top (its
 * table's id names the segment: libraryTableId), its pins let go (its list's name names its kinds: listNow), its armed Delete
 * disarmed, and an opened row it no longer lists closed. Find and the chip stay (a chip is offered over every kind: overEveryKind).
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
/** The id of the Library's table, its segment in it, so a redraw keeps its scroll place and another segment opens at its top. */
const libraryTableId = () => `table-library-${segment()}`;

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

/** Whether a row is one the chip that is on shows (none on shows every row). */
const onChip = (t: Table, skill: ItemRow) => { const { filter } = t.view; return filter === 'all' || (filter === 'plugins' ? fromAPlugin(skill) : filter === 'unused' ? inUnusedChip(t, skill) : needsChoice(t, skill)); };
/** Whether Find's text is in a row's key (a plugin's own row: its name) or its description, whatever its kind. */
const findMatches = (t: Table, row: ItemRow | PluginRow) => {
  const needle = t.view.find.trim().toLowerCase();
  return !needle || (isPluginRow(row) ? row.name.toLowerCase() : row.key).includes(needle) || row.description.toLowerCase().includes(needle);
};
/** A plugin's own row is listed with no chip or From plugins, on a harness's page where that tool has it, and as Find says. */
const pluginListed = (t: Table, row: PluginRow) => (t.view.filter === 'all' || t.view.filter === 'plugins') && (!t.tool || !!row.copies[t.tool as HarnessId]) && findMatches(t, row);
/** The rows Find and the chip leave on a table, a plugin's own among them: what drawTable lists (with the rows pinned there) and the kind switch counts. */
const listedRows = (t: Table): (ItemRow | PluginRow)[] => [...rowsIn(t).filter(row => onChip(t, row) && findMatches(t, row)), ...plugged(t).rows.filter(row => pluginListed(t, row))];
/** The From plugins chip's count (pluginrows.ts fromPluginsCount: a plugin's own rows, and the person's own a plugin also brings), here. */
const pluginCount = (t: Table) => kindParts(t).reduce((sum, part) => sum + part.fromPlugins, 0);
/** Whether the From plugins chip is drawn: some row here is a plugin's. */
const pluginChipShown = (t: Table) => pluginCount(t) > 0;

/** Whether the Copies differ chip is drawn: something here differs. A Copies differ filter whose chip is gone falls back to none. */
const copiesDifferChipShown = (t: Table) => rowsIn(t).some(skill => needsChoice(t, skill));

/** The list a Files view was opened from (the Library's, or a tool's Skills tab: `tool`), and its scroll place. */
let filesFrom: { top: number; tool?: Tool } = { top: 0 };
const fromTable = () => (filesFrom.tool ? `table-skills-${filesFrom.tool}` : libraryTableId());
/** A skill's files and contents: the Library's Files view, from wherever its details were opened. */
export function openFiles(key: string) {
  noteMove();
  filesFrom = { top: 0, tool: state.page === 'harnesses' ? state.harness : undefined };
  filesFrom.top = document.getElementById(fromTable())?.scrollTop ?? 0;
  if (state.page !== 'library') showPage('library');
  state.libraryView = 'files';
  state.item = key;
  rerender();
}
/** The Files view's back button's words: where it leads, the Library or the tool whose Skills tab it was opened from. */
const backWords = () => (filesFrom.tool ? { label: names[filesFrom.tool], name: `Back to ${names[filesFrom.tool]}’s skills` } : { label: 'Library', name: 'Back to the Library' });
/** Back from the Files view (its button, or Escape: renderer.ts): the list it was opened from as it was, its segment or tab, Find, chip, open row and scroll place. */
export function backFromFiles() {
  const { top, tool } = filesFrom;
  // Back to a tool's Skills tab as harnesspage.ts goHarness sets it (Harnesses opens on its list), its view as it was (Files
  // draws the Library's), its open row counted as opened on this visit, so a copy question stays open.
  if (tool) { showPage('harnesses'); Object.assign(state, { harness: tool, harnessTab: 'skills' }); views.skills.openedOn = state.visit; rerender(); } else leaveFiles();
  const table = document.getElementById(fromTable());
  if (table) table.scrollTop = top;
}

/**
 * A list with nothing to list (the Library, or a tool's tab of one kind): its empty state under the same bands as its table (stops,
 * problems, Resume, results), the Library's over every kind it holds, whatever the segment.
 */
export function emptyList(empty: HTMLElement, tab?: { kind: PageKind; tool: Tool }) {
  return h('div.page', {}, notices(tab ? useTab(tab.kind, tab.tool) : overEveryKind(useLibrary())), empty);
}

/**
 * The Library's list: every kind's rows, or its segment's, under one toolbar (the kind switch first) and one set of bands; under a
 * segment whose kind has none here, `none` of that kind (pages.ts kindEmpty).
 */
export const libraryTable = (none?: (kind: PageKind) => HTMLElement) => drawTable(useLibrary(), none);
/** A tool's tab of one kind under Harnesses: its column first, and the rows it doesn't have under their own heading. */
export const itemsTable = (which: PageKind, harness: Tool) => drawTable(useTab(which, harness));

/** A table: its toolbar, bands and rows, under the headings On, Found, Only through a plugin, (on a tab) Not in it, and Off. */
function drawTable(t: Table, none?: (kind: PageKind) => HTMLElement) {
  const { view, tool } = t;
  Object.assign(t, { used: usedColumn(t), shared: sharedNames(t) });
  const all = rowsIn(t);
  const pins = pinnedHere(t);
  // A row pinned here stays listed under the chip after its own click took it out of what the chip shows.
  const shown = all.filter(skill => (onChip(t, skill) || pins.rows.has(idOf(skill))) && findMatches(t, skill));
  // A plugin's items follow Find and the chips: shown with no chip and From plugins, on a harness's page where it has them.
  const plugins = plugged(t).rows.filter(row => pluginListed(t, row));
  const find = findInput({ id: 'find', label: 'Find', value: view.find, onInput: text => { view.find = text; rerender(); } });
  // A copy question doesn't outlive the visit: back on the page, its row is closed.
  const isOpen = (row: ItemRow | PluginRow) => idOf(row) === view.comparing;
  if (view.comparing && view.openedOn !== state.visit && all.some(skill => isOpen(skill) && isDiffering(skill))) view.comparing = undefined;
  const open = docked() && view.comparing && !underRow(t, view.comparing) ? all.find(isOpen) : undefined;
  const openRow = docked() && !open ? plugins.find(isOpen) : undefined;
  // Off goes last, under its own heading. Of the rest, the rows a harness's page is about (it has a copy) split into On and
  // Found; the others, only other tools have. A row whose own switch was clicked here stays under the heading it was under.
  const under = (role: Role) => [shown.filter(skill => placeIn(pins, idOf(skill), sectionOf(t, skill)) === role), shown.filter(skill => sectionOf(t, skill) === role)] as const;
  const sections = [section(t, 'on', ...under('on')), section(t, 'found', ...under('found')), pluginSection(t, plugins), tool ? section(t, 'away', ...under('away')) : null, section(t, 'off', ...under('off'))];
  // Nothing listed: none of the segment's kind here, or nothing Find and the chip leave (said apart from a home with nothing).
  const nothing = shown.length || plugins.length ? null : !all.length && !plugged(t).rows.length && none ? none(t.kinds[0]!)
    : emptyState('search-x', 'Nothing matches', [view.find.trim() ? `“${view.find.trim()}”` : '', view.filter !== 'all' ? `Only: ${chipNames[view.filter]}` : ''].filter(Boolean).join(' · '));
  const table = [
    h('div.toolbar.fit-bar', {}, kindSwitch(t), h('div.find', {}, icon('search', 16, 'find-glyph'), find), filterBar(t), orderChoice(t), h('div.toolbar-end', {}, toolbarState(t), usageControls(t))),
    usageBand(t),
    view.filter === 'unused' ? unusedBand(t, shown.filter(skill => onChip(t, skill))) : null,
    notices(t),
    // A stable id per segment (and per harness and kind), so a redraw (the dock's breakpoint crossed, say) keeps the table where it
    // was scrolled, and another segment or harness's table opens at its own top.
    h('div.scroll.matrix', { id: tool ? `table-${t.kinds[0]}-${tool}` : libraryTableId() },
      // No column heads: each row's switch comes first, and its marks name their tools.
      nothing ?? withToolCount(h('div.ov.ov-switched', { role: 'table', 'aria-label': `${tool ? nouns[t.kinds[0]!][1] : 'Items'} and where they are on` }, sections), columns(t).length),
      markLegend(t, all, plugins))];
  if (openRow) return h('div.page.ov-page.docked', {}, h('div.dock-main', {}, table), pluginDock(t, openRow));
  // An item's details hold its versions: its dock takes a share of the width that grows with the window (style.css .dock-wide).
  return open ? h('div.page.ov-page.docked.dock-wide', {}, h('div.dock-main', {}, table), itemDock(t, open))
    : h('div.page.ov-page', {}, table);
}



// ---------- One switch per item ----------

const nameOf = (row: ItemRow | PluginRow) => row.name ?? row.key;

/**
 * A click on this page other than a row's own switch or Add (a tool's switch in an opened row, Delete, Make current; Turn these
 * off is one per kind: turnTheseOff): it pins no row (flip does), so once its result is shown a row not pinned already is under
 * its own heading.
 */
const click = (what: Click) => { void applyClick(what); };

/** A table's list, as the rows pinned on it are named (app.ts pinnedRows): the Skills Files view's list or the table, with its Sort and chip. */
const listNow = (t: Table) => [filesView(t) ? 'files' : 'table', t.kinds.join('+'), t.tool, chosenOrder(t), t.view.filter].join(' ');
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
    const now = rowsOf(skill.kind).find(row => row.key === skill.key);
    const ways = now ? otherReadLines(now, tools()) : [];
    const still = stillIn(skill, itemOf(skill), [...notIn, ...plugins.leftIn], tools());
    return lib.say.said.off(name, still, tools(), leftOutTools(), own, ways) + pluginSaid(notIn);
  };
  return mainClick(t, skill, false, [{ ...rowClicks.off(skill, itemOf(skill)), seenOn: seen }], plugins, said, plugins.left, focusOn(t, skill));
}

/** Every tool that can have it: where it is on once it is on everywhere. */
const canHave = (t: Table, skill: ItemRow) => toolsFor(t, skill.kind).filter(tool => !skill.cannot?.[tool] || throughPluginHere(skill, tool));
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
const throughItems = (t: Table, skill: ItemRow): PluginItemAt[] => toolsFor(t, skill.kind).flatMap(tool => { const item = itemThrough(skill, tool); return item ? [item] : []; });
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
function mainClick(t: Table, row: ItemRow | PluginRow, on: boolean, changes: Change[], plugins: ReturnType<typeof turnEvery>, said: (notIn: HarnessId[]) => string, also?: string, focus?: () => string): Click {
  const along = plugins.turned.map(item => alongWords(item, plugins.ops)).filter(Boolean).join(' ') || undefined, kind = kindOf(row), name = nameOf(row);
  const pluginsOnly = !changes.length, undone = pluginsOnly ? undoneWords(name, on, toolsPhrase(plugins.turned.map(item => item.tool), toolsFor(t, kind))) : undefined;
  return { kind, items: [name], rows: [rowKey(row)], changes, said, also, focus, pluginsOnly, plugins: plugins.ops.length || pluginsOnly ? { ops: plugins.ops, said: along } : undefined, undone };
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
    if (takeBack(kind, row.key)) { rerender(); return; }
    // Drawn as a click on it asks, it is clicked from that state, and worked out in its turn; else from what each tool has now.
    const plugins = turnEvery(items, next);
    if (wanted === undefined && !plugins.ops.length) { tell({ page: state.page, item: row.name, rows: [rowKey(row)], warn: true, band: true, text: `${row.name}: nothing changed. ${plugins.left ?? `It is ${next ? 'on' : 'off'} already.`}` }); rerender(); return; }
    // Its part in each tool is worked out in its turn, from the plugins as the clicks before it left them.
    const rowNow = () => plugged(t).rows.find(each => each.key === row.key);
    queueClick({ kind, key: row.key, on: next }, row.name, () => {
      const now = rowNow(), turned = now && turnEvery(rowItems(now), next);
      return now && turned?.ops.length ? mainClick(t, now, next, [], turned, () => `${row.name} is ${next ? 'on' : 'off'} in ${toolsPhrase(turned.turned.map(item => item.tool), tools())}.`, turned.left) : undefined;
    }, () => { const now = rowNow(); return now && rowItems(now).some(itemOn); });
  } });
}

/** A switch's label while a click on its row is unfinished: what it is being turned to. */
const turningLabel = (name: string, on: boolean) => `${name}: being turned ${on ? 'on' : 'off'}.`;

/**
 * The switch's click: off everywhere, or on everywhere (a found item taken in, after a copy choice where its copies differ). It
 * joins the page's list (app.ts queueClick), its row drawn in its new state at once and worked out in its turn, from the view as
 * the clicks before it left it; a second click while it waits takes it back (clicklist.ts takeBack). Its row is pinned where it is
 * (itemrow.ts Pinned) until another list or none is drawn, or Refresh (app.ts pinnedRows).
 */
function flip(t: Table, skill: ItemRow, on: boolean) {
  const { kind, key } = skill;
  pin(pinnedHere(t), idOf(skill), sectionOf(t, skill), timeIn(skill, chosenOrder(t), itemOf, usedAt(t)));
  if (takeBack(kind, key)) { rerender(); return; }
  if (on && isDiffering(skill)) {
    // The question opens under its row; a second click on the switch closes it.
    if (t.view.comparing === idOf(skill)) { t.view.comparing = undefined; rerender(); return; }
    t.view.comparing = undefined;
    openRow(t, skill);
    announce(`${nameOf(skill)}’s copies differ. Choose which copy every tool uses.`, true);
    return;
  }
  // Refused in its turn if its row is no longer as it was drawn when clicked.
  const seen = wantedOn(kind, key) ?? libraryPlace(itemOf(skill)) === 'on', refocus = focusOn(t, skill);
  const rowNow = () => rowsOf(kind).find(row => row.key === key);
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
  const label = wanted !== undefined ? turningLabel(nameOf(skill), wanted) : [switchLabel(skill, item, tools), wholeWords(throughItems(t, skill), !on)].filter(Boolean).join(' ');
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
  'another-way': 'Has it another way, not from Central Knot', switched: 'Switched off in its own settings',
} as const;

/**
 * One tool's mark on a row: its look, what it says, and a glyph in place of the tool's own mark where something waits
 * or differs. `state`: what the tool has, as a word ("plugin", or libraryrow.ts HarnessIs), for the page's checks; `key`: its
 * entry in the key.
 */
function markOf(skill: ItemRow, tool: Tool): { look: MarkLook; words: string; glyph?: IconName; state: string; key: keyof typeof keyWords } {
  const given = throughPluginHere(skill, tool);
  if (given) {
    const on = pluginOnIn(skill).includes(tool);
    return { look: on ? 'on' : 'off', state: on ? 'plugin' : 'plugin-off', key: on ? 'on' : 'plugin-off', words: `${skill.anotherWay?.[tool] ?? skill.cannot?.[tool] ?? `${names[tool]} has it through the plugin ${given.plugin}.`}${on ? '' : ' It is turned off there.'}` };
  }
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

/** One row: its switch, its name, a mark per tool, and the chevron that opens its details. */
function row(t: Table, skill: ItemRow) {
  const id = idOf(skill), open = t.view.comparing === id, when = dated(t);
  return [
    h(`div.ov-row.ov-switch-row${takeFlash(id) ? '.row-flash' : ''}${skill.on ? '' : '.unmanaged'}${open ? '.open' : ''}${when ? '.ov-dated' : ''}${t.used ? '.ov-usage' : ''}`, { role: 'row', 'data-key': id, 'aria-expanded': String(open), onclick: () => openRow(t, skill) },
      h('div.ov-managed', { role: 'cell' }, itemSwitch(t, skill)),
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

/**
 * The band under the toolbar, while it is open (app.ts state.usageBand: an Update's click or a failed reading opens it, its
 * close button closes it): what collecting does while it collects, that it was collected, or that it couldn't be. Its three
 * sentences share one place, the others kept but not shown, so the band is as high in each and no row moves when a reading
 * lands. Closed, nothing is lost: the time is beside the button, each tool's reach in the chip's band (unusedBand), and each
 * tool's figure, or why it can't say, in an opened row (usageLine).
 */
function usageBand(t: Table) {
  if (t.tool || !state.usageBand) return null;
  const now = state.usage.state === 'reading' ? 0 : state.usage.state === 'failed' || !state.usage.data ? 2 : 1;
  const sentences = ['Collecting usage statistics: reading the tools’ own session history on this computer. Nothing leaves it.',
    'Usage statistics collected from the tools’ own session history on this computer. Nothing left it.',
    'Usage statistics couldn’t be collected: the tools’ session history couldn’t be read.'];
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
/** Whether a row is in the "No use seen in 30 days" chip, and how many it holds (no chip at 0). */
const inUnusedChip = (t: Table, skill: ItemRow) => !!kindUsage(t, skill.kind)?.noUseSeen.includes(skill.key);
const unusedCount = (t: Table) => kindParts(t).reduce((sum, part) => sum + (part.usage?.noUseSeen.length ?? 0), 0);

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
  const live = homeItems(home), ids = new Set(off.map(skill => itemId(partOfPage[skill.kind], skill.key))), before = inUse(home.profiles.profiles, live);
  const ending = before.filter(profile => !inUse(home.profiles.profiles, live.map(item => (ids.has(item.id) ? { ...item, on: false } : item))).includes(profile));
  const lead = [`${counted(shown)} with no use seen in the last ${USAGE_DAYS} days.`,
    off.length ? 'Turn these off: off in every tool; Central Knot keeps them, and Undo turns them all back on.' : '',
    kept.length ? `${counted(kept)} from a plugin skipped: turn each off on its own row.` : '',
    ending.length ? `With these off, ${andList(ending.map(profile => profile.name))} ${ending.length === 1 ? 'stops' : 'stop'} being the profile in use.` : ''];
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
 * Turn these off, over rows of any kinds: each kind's rows one click with each row's own Off (libraryrow.ts rowClicks.off), the
 * kinds in turn (app.ts applyByKind: a kind that refuses is skipped and named), with one Undo that puts them all back. Its words
 * are one sentence over the rows that went through (what didn't is said before it: app.ts applyByKind), a row's kind named where a
 * row of another kind has its name (words.ts rowNames).
 */
export function turnTheseOff(rows: ItemRow[]) {
  const clicks = KINDS.map(kind => rows.filter(row => row.kind === kind)).filter(list => list.length).map((list): Click => ({
    // Its words are the whole click's, over every kind (applyByKind's `said`, below).
    kind: list[0]!.kind, items: list.map(nameOf), rows: list.map(rowKey), regroups: true, changes: list.map(row => rowClicks.off(row, itemOf(row))), said: '' }));
  void applyByKind(clicks, off => {
    const { one, many } = rowNouns(off.map(row => row.kind));
    return `Turned off ${plural(off.length, one, many)} with no use seen in the last ${USAGE_DAYS} days: ${fewNames(rowNames(off))}. Central Knot keeps ${off.length === 1 ? 'it, and turning it on puts it' : 'them, and turning one on puts it'} back as it was.`;
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

/** The flags (flags.ts) that put the Library's rows by last updated, or by last used: one choice, kept. */
const BY_UPDATED = 'ck-items-by-last-updated', BY_USED = 'ck-items-by-last-used';
/** The order of the rows under each heading (itemrow.ts inOrder): the one chosen, on the Library (by Last used, a row with no use seen goes by name); by name on a harness's tab. */
const chosenOrder = (t: Table): RowOrder => (t.tool ? 'name' : readFlag(BY_USED) ? 'used' : readFlag(BY_UPDATED) ? 'updated' : 'name');
/** A row's last use on a table, for the Last used order (itemrow.ts inOrder). */
const usedAt = (t: Table) => (skill: ItemRow) => lastUse(usageOf(t, skill));
/**
 * A reading about to land moves no row (app.ts collectUsage calls this once its answer is known to be kept, before the slot takes
 * it). A reading moves rows only through the Last used order or the "No use seen" chip, so while the list on screen goes by last
 * used or that chip is on, each of its rows is pinned where it is now (itemrow.ts Pinned), as its own switch would pin it
 * (flip): its cell fills in place, and the new order is drawn when the pins are let go (app.ts pinnedRows: another list or none
 * drawn, Refresh, or Put in order: rowsHeld).
 */
export function holdOrder() {
  const t = useTableShown();
  if (!t || (chosenOrder(t) !== 'used' && t.view.filter !== 'unused')) return;
  const pins = pinnedHere(t);
  for (const skill of filesView(t) ? rowsIn(t) : rowsIn(t).filter(each => onChip(t, each))) pin(pins, idOf(skill), sectionOf(t, skill), timeIn(skill, chosenOrder(t), itemOf, usedAt(t)));
}
/** Whether each row says when it was last updated: while the rows go by it. */
const dated = (t: Table) => chosenOrder(t) === 'updated';
/** The choice of order, after the filters on the Library. */
function orderChoice(t: Table) {
  if (t.tool) return null;
  const choose = (event: Event) => { const value = (event.target as HTMLSelectElement).value; writeFlag(BY_UPDATED, value === 'updated'); writeFlag(BY_USED, value === 'used'); rerender(); };
  const order = chosenOrder(t), option = (value: RowOrder, label: string) => h('option', { value, selected: order === value }, label);
  const options = [option('name', 'Name'), option('updated', 'Last updated'), option('used', 'Last used')];
  return [h('span.order', { title: 'The order of the rows under each heading' }, h('label.order-word', { for: 'item-order' }, 'Sort'),
    h('span.select.select-bar', {}, h('select', { id: 'item-order', 'aria-label': 'Sort by', title: 'Sort by', onchange: choose }, options), icon('chevrons-up-down', 14))),
    roomHeld(rowsHeld(t), held => button({ variant: 'ghost', size: 'small', icon: 'list', label: 'Put in order', id: held ? 'put-in-order' : undefined, collapse: true, onclick: () => { unpin(); rerender(); } }))];
}
/**
 * The ids of a table's rows as drawn, heading by heading, given the rows pinned on it (none: each row under its own heading,
 * in the order Sort names), as itemsTable draws them; Find, which moves no row, aside.
 */
const listedIds = (t: Table, pins: Pinned<Role>) => (['on', 'found', 'away', 'off'] as Role[]).flatMap(role =>
  inOrder(rowsIn(t).filter(skill => (onChip(t, skill) || pins.rows.has(idOf(skill))) && placeIn(pins, idOf(skill), sectionOf(t, skill)) === role), chosenOrder(t), itemOf, usedAt(t), pins).map(idOf));
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
 * it; `truly`: the rows whose own heading it is, which its count counts. They differ once a row's own switch is clicked: the row
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
      // Counts are of the rows that match (Find and the chip), as the kind switch's are: a pin keeps a row's place, not a count.
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(truly.filter(row => onChip(t, row)).length)), note ? sectionNote(own, note) : null)),
    inOrder(rows, chosenOrder(t), itemOf, usedAt(t), pinnedHere(t)).flatMap(skill => row(t, skill)));
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
  const ways = list.flatMap(row => otherReadLines(row, toolsFor(t, row.kind)));
  if (ways.length) return list.length === 1 ? ways.join(' ') : 'in Central Knot; some tools still read copies elsewhere (see each row)';
  return leftOutTools().length ? 'in Central Knot; no tool it manages has these' : 'in Central Knot only; no tool has these';
}

/** What the item is now, in one line (libraryrow.ts statusLine), and for a found one, what Synchronize everything does with it while it is on. */
const switchStatus = (t: Table, skill: ItemRow) => statusLine(skill, itemOf(skill), toolsFor(t, skill.kind), !!state.home?.sync.syncEverything, leftOutTools());

/** What one tool has, for its row in the item's details: what its copy is, then whether its own switch has it off. */
function harnessLine(skill: ItemRow, tool: Tool): string {
  // Through a plugin: where it comes from, then why its switch can't be used here, or that it is the whole plugin's.
  const through = itemThrough(skill, tool);
  if (through) return [skill.cannot?.[tool], cantSwitch(through) ?? switchWords(through)].filter(Boolean).join(' ');
  const lib = libraryPages[skill.kind], own = skill.ownPart?.[tool];
  return [lib.say.harnessLine(skill, itemOf(skill), tool, names[tool]), own?.length ? lib.words.own(own) : ''].filter(Boolean).join(' ');
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
  return h('span.details-tool-actions', {}, own, h('span.tool-switch', {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, out ? 'Off' : 'On'),
    toggle({ on: !out, disabled: writeOff(kindStops(skill.kind)), id: elId('enable', skill, tool), label: `${name} in ${where}: ${out ? 'kept out' : 'on'}. ${does}`, onchange: flipHere })));
}

/**
 * Delete from Central Knot, the one real delete of a library item: quiet until armed, then it runs at once. The item leaves
 * every harness and its page; the library keeps it, deleted, and History's Restore (or this click's Undo) puts it back.
 */
function libraryDelete(t: Table, lib: LibraryPage, skill: ItemRow) {
  const item = inLibrary(itemOf(skill));
  if (!item) return null;
  const name = nameOf(skill), id = idOf(skill), view = t.view, tools = toolsFor(t, skill.kind), disarm = () => { view.confirmDelete = undefined; rerender(); };
  if (view.confirmDelete !== id) {
    const arm = button({ variant: 'outline', size: 'micro', label: 'Delete from Central Knot…', id: elId('delete', skill), disabled: writeOff(kindStops(skill.kind)), onclick: () => { view.confirmDelete = id; rerender(); } });
    arm.classList.add('delete-quiet');
    return h('span.delete-offer', {}, arm, h('span.delete-offer-note', {}, lib.say.said.deleteOffer));
  }
  const said = lib.say.said.deleted(name, item.on, stillIn(skill, item, [], tools), tools);
  const run = () => { view.confirmDelete = undefined; click({ kind: skill.kind, items: [name], rows: [rowKey(skill)], changes: [rowClicks.remove(skill, item)], said }); };
  // Armed, it is still a button (outlined in red); Cancel beside it is a link.
  const now = button({ variant: 'outline', size: 'micro', label: 'Delete it now', id: elId('delete-confirm', skill), disabled: writeOff(kindStops(skill.kind)), onclick: run });
  now.classList.add('delete-now');
  now.title = `Delete ${name} from Central Knot now. History can restore it.`;
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
  return versionList({ item, rowId: id, canWrite: !writeOff(kindStops(skill.kind)), unfolded: view.versionsUnfolded === id, onUnfold: () => { view.versionsUnfolded = id; rerender(); },
    changes: skill.versionChanges, reading, now: Date.now(), onRead: read, onMakeCurrent: makeCurrent });
}

/**
 * One tool's own controls in an item's details, each applied at once: the item's switch for that harness and what its kind
 * adds there (libraryHarnessSwitch); the plugin's page, for a tool that has it through one. Each says what it does on hover.
 */
function harnessControls(skill: ItemRow, tool: Tool) {
  const given = throughPluginHere(skill, tool);
  // Through a plugin: the item's switch in that tool (its own, or the whole plugin's), with the way to the plugin's page.
  const through = itemThrough(skill, tool);
  if (through) return pluginItemControls(through, skill, () => openPlugin(given!));
  if (given) return h('span.details-tool-actions', {}, smallAction('Plugin’s page', elId('plugin', skill, tool), () => openPlugin(given)));
  return libraryHarnessSwitch(libraryPages[skill.kind], skill, tool);
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
  const toolRow = (tool: Tool) => h('div.details-tool', {},
    h('div.details-tool-head', {},
      h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
      ...settingsFile(tool),
      h('span.details-tool-line', {}, harnessLine(skill, tool)),
      harnessControls(skill, tool)),
    lib.toolNote?.(skill, tool as HarnessId),
    usageLine(t, skill, tool));
  const close = placement === 'row' ? h('button.details-close', { type: 'button', id: elId('close', skill), 'aria-label': `Close details for ${skill.key}`, title: 'Close', onclick: () => { t.view.comparing = undefined; rerender(); } }, icon('x', 14)) : null;
  const box = (...children: (Child | Child[])[]) => h(`div.compare.details${placement === 'row' ? '' : '.details-bare'}${differs ? '.details-differs' : ''}${skill.kind === 'mcp' ? '.details-mcp' : '.details-grid'}`, { role: 'region', 'aria-label': `Details for ${skill.key}` }, ...children);
  // The copy question is asked in one place: by first setup's walkthrough where it is at this row, else here.
  const asked = walkingAt();
  if (differs) return box(close, asked?.kind === skill.kind && asked.key === skill.key ? h('p.compare-note', {}, 'Choosing copies, above, asks which copy to use.') : compareChoices(t, skill, inFiles));
  // A found row none of whose copies can be read has no files to show.
  const files = lib.files && !inFiles && (inLibrary(itemOf(skill)) || canAdd(skill)) ? smallAction('Files and contents', elId('files', skill), () => openFiles(skill.key)) : null;
  const remove = !inFiles ? libraryDelete(t, lib, skill) : null;
  return box(
    h('div.details-head', {},
      // The Files view's pane says it under the skill's name; the row already shows the description.
      inFiles ? null : h('p.details-status', {}, switchStatus(t, skill)),
      // Its description whole: the closed row cuts it.
      skill.description ? h('p.details-description.details-description-whole', {}, skill.description) : null,
      files ? h('div.details-actions', {}, files) : null),
    // What every tool shares of it, and what stays each harness's own, said where it is true: an item in Central Knot, or a
    // found one that can be taken in.
    tools.length > 1 && (inLibrary(itemOf(skill)) || canAdd(skill)) ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), lib.words.shared) : null,
    h('div.details-tools', {}, tools.map(toolRow), usageElsewhere(t, skill)),
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

/** The skill whose row was last scrolled into view, so the list moves only when the selection changes. */
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
 */
let listSize = '';
const listWatcher = new ResizeObserver(entries => {
  const size = entries.map(entry => `${Math.round(entry.contentRect.width)}×${Math.round(entry.contentRect.height)}`).join();
  if (size !== listSize) revealSelected();
  listSize = size;
});

/** The least room a description gets beside its name before every row leaves it out: about twelve characters. */
const ABOUT_MIN = 90;

/**
 * A table's descriptions are all shown or all left out, so rows never differ: when the narrowest one has room for fewer
 * than about twelve characters, every row leaves its description out (.no-about); its name's tooltip still has it.
 * A description pushed onto the cell's hidden second line, after a tag or pill that took the room, has none. A name that
 * takes more than half its row is cut first (.name-cut), so one long name doesn't take every description away.
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
  const shown = inOrder(matches, chosenOrder(t), itemOf, usedAt(t), pins).sort((first, second) => place.get(idOf(first))! - place.get(idOf(second))!);
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
  if (skill.key !== revealed) { revealed = skill.key; requestAnimationFrame(revealSelected); }
  requestAnimationFrame(() => {
    listWatcher.disconnect();
    const list = document.getElementById('skills-list'); if (list) listWatcher.observe(list);
  });
  const { where, contents } = more(skill.key);
  const layout = filesLayout(t, skill, where);
  // Its whole text on hover too, for a pane too narrow to show it.
  const paneStatus = switchStatus(t, skill);
  // The result and its Undo are in the window's header, as on the table; the list and the skill's pane below it.
  return h('div.page', {}, notices(t), h('div.split', {},
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

// Escape in a find box clears it.
document.addEventListener('keydown', event => {
  const id = (event.target as HTMLElement | null)?.id;
  if (event.key !== 'Escape' || (id !== 'find' && id !== 'skills-find')) return;
  const view = useTableShown()?.view;
  if (id === 'skills-find' && view?.listFind) { view.listFind = ''; rerender(); }
  if (id === 'find' && view?.find) { view.find = ''; rerender(); }
});
