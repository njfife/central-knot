// The item pages (Skills, MCP servers, Agents, and a harness's tabs for them): one On/Off switch per item, applied at once
// in every tool Central Knot manages. A row's marks only say what each tool has; each tool's own controls are in the item's
// details, and every click's result comes with an Undo of the whole click. A kind on Central Knot's library (agents) has a
// library row (`library()`): librarypages.ts says which kinds and what each supplies, libraryrow.ts what such a row says.
import { itemId } from './profileplan.ts';
import { brandMark } from './brand.ts';
import { caughtUpNames, DAY_MS, defaultHistoryDays, groupBy } from './model.ts';
import { cantUse, choiceEffect, nearestLine, shortQuote } from './copywords.ts';
import { andList, byToolOrder, capitalToolsPhrase, kindNouns, problemText, toolName, toolNames, toolsPhrase } from './words.ts';
import { readFlag, writeFlag } from './flags.ts';
import { whyReadOnly, otherOwnerSaid, saidInStatusBar, takeOverSync, takeOverTitle, tell, type Click, type Outcome, type PageKind, harnessKindShown, lastResult, flashRequests, showSkillsTable, applyClick, applyPluginSwitches, rerender, retireTip, announce, restoreEvent, setSync, shownPath, showFile, showPage, state, syncNow, writeClaudeNow } from './app.ts';
import { afterLayout, button, closeButton, emptyState, fileBlocks, findInput, h, icon, middle, pathText, toggle, withToolCount, type Child } from './dom.ts';
import { getsCopy as getsCopyNext, offPlan, stillOn } from './clickplan.ts';
import type { IconName } from './icons.ts';
import { byKey, loadedIn, standing } from './roworder.ts';
import { cellOf, comparedTools, kindSource, libraryView, needsCopyChoice, type ItemRow, type KindSource, type Tool } from './itemrow.ts';
import { canTakeIn, harnessIs, inLibrary, takeInWhere, madeFrom, needsChoice as libraryNeedsChoice, placeOf as libraryPlace, rowClicks, statusLine, switchLabel, versionClock, type HarnessIs, isPartial } from './libraryrow.ts';
import { libraryPages, type LibraryPage } from './librarypages.ts';
import { versionList, type VersionText } from './versionlist.ts';
import { listed, type Version } from './library.ts';
import type { Change, DestinationResult, SkillFacts, SyncNotice, SyncView, HarnessId, PartsInstall, ThroughPlugin } from './types.ts';
import { market } from './pluginstate.ts';
import { pluginKey, type PluginDraft } from './pluginplan.ts';
import { alongWords, cantSwitch, click as clickPluginItem, clickWords, itemSaid, onNow as itemOn, switchWords, turnEvery, type PluginItemAt } from './pluginswitch.ts';
import { partOfPage, samePart, versionWord } from './pluginstatus.ts';
import { cellWords, handledWhere, inTool, insideTitle, offIn, pageRows, pluginTools, toolWords, type PluginRow } from './pluginrows.ts';
import { folded, lineDiff } from './diff.ts';

const names = toolNames as Record<Tool, string>;

/**
 * The plugins this item came from as a part (parts.ts): each plugin once, with the tools it went into as a separate item
 * because they can't take the plugin. Empty for an ordinary item.
 */
function fromPlugins(skill: ItemRow, page: PageKind): { install: PartsInstall; tools: HarnessId[] }[] {
  const partKind = partOfPage[page];
  const named = [skill.key, skill.name].filter((name): name is string => !!name).map(name => ({ kind: partKind, name }) as const);
  const found = new Map<string, { install: PartsInstall; tools: HarnessId[] }>();
  for (const install of state.home?.parts ?? []) {
    // A copy removed from that tool by hand is no longer a part installed there.
    if ((toolList().includes(install.tool) && skill.copies[install.tool] === undefined) || !install.items.some(item => !item.removed && named.some(name => samePart(item, name)))) continue;
    const key = pluginKey(install.source, install.plugin);
    const entry = found.get(key) ?? { install, tools: [] };
    entry.tools.push(install.tool);
    found.set(key, entry);
  }
  // Tools in column order, as everywhere else ("Codex and Pi").
  return [...found.values()].map(entry => ({ ...entry, tools: entry.tools.sort(byToolOrder) }));
}

/**
 * Opens a plugin's page on Plugins, where the plugin and its parts are updated or removed together. `marketplace`: its
 * marketplace's name, to find it by when the page lists that marketplace under another spelling of its address.
 */
function openPlugin({ source, plugin, marketplace }: { source?: string; plugin: string; marketplace?: string }) {
  const lists = (entry: { plugins: { name: string }[] }) => entry.plugins.some(item => item.name === plugin);
  const listed = market.view?.marketplaces.find(entry => entry.source === source && lists(entry)) ?? market.view?.marketplaces.find(entry => !!marketplace && entry.name === marketplace && lists(entry));
  market.nav = { source: listed?.source ?? source, plugin, tab: 'plugins', find: '', category: undefined };
  showPage('plugins');
}

/** The tools that have this item through `plugin` itself (not as a separate item), in column order. */
const throughPluginIn = (skill: ItemRow, plugin: string) => toolList().filter(tool => skill.plugin?.[tool]?.plugin === plugin && skill.copies[tool] === undefined);

/** The note in an item's details: which plugin it is a part of, where, and where its parts are managed together. */
function partNote(skill: ItemRow) {
  // Once read, the Plugins page knows whether the plugin is still listed; a page that can't show it isn't linked to.
  const unlisted = (install: PartsInstall) => !!market.view && !market.view.marketplaces.some(entry => entry.source === install.source && entry.plugins.some(plugin => plugin.name === install.plugin));
  return fromPlugins(skill, kind).map(({ install, tools }) => h('p.details-limits.details-note.details-part', {}, icon('puzzle', 12, 'tone-muted'),
    h('span', {}, `From the plugin ${install.plugin}${install.version ? ` (${versionWord(install.version)})` : ''}, installed in ${andList(tools.map(tool => names[tool]))} as a separate item. `,
      throughPluginIn(skill, install.plugin).length ? `${andList(throughPluginIn(skill, install.plugin).map(tool => names[tool]))} ${throughPluginIn(skill, install.plugin).length > 1 ? 'have' : 'has'} it through the plugin itself. ` : '',
      ...(unlisted(install) ? ['Its marketplace no longer lists the plugin, so this is now an ordinary item.']
        : ['Update or remove its parts on ', h('button.inline-link', { type: 'button', id: `open-plugin-${skill.key}-${install.plugin}`, onclick: (event: Event) => { event.stopPropagation(); openPlugin(install); } }, 'the plugin’s page'), '. ',
          reach(skill, install.plugin)]))));
}

/**
 * What the row's own controls reach on an item that is a plugin's part: its switch also turns it on or off where a tool has it
 * through the plugin itself; Delete removes only the separate item.
 */
function reach(skill: ItemRow, plugin: string) {
  const through = throughPluginIn(skill, plugin);
  return through.length ? `Its switch also turns it on or off in ${andList(through.map(tool => names[tool]))}, through the plugin. Deleting here removes only this separate item.`
    : 'Its switch and Delete act on this separate item, never on the plugin itself.';
}

/** The one mark of a plugin's item on its row, a part's or one inside the installed plugin: the plugin's glyph and "from <plugin>"; its title says which. */
const pluginTag = (plugin: string, title: string) => h('span.row-tag.row-part', { title }, icon('puzzle', 12, 'tone-faint'), `from ${plugin}`);
/** A part's tag on its row, titled with the version and the tools it went into. */
const partTags = (skill: ItemRow) => fromPlugins(skill, kind).map(({ install, tools }) =>
  pluginTag(install.plugin, `Part of the plugin ${install.plugin}${install.version ? ` (${versionWord(install.version)})` : ''}, installed in ${andList(tools.map(tool => names[tool]))} as a separate item`));

// ---------- What a plugin installed whole brings (pluginrows.ts) ----------
/** This page's plugin rows for the home on screen. */
const plugged = () => (!state.home ? { rows: [] as PluginRow[], unread: [] } : pageRows(state.home, kind));
/** A row of a plugin's: one of its parts, or an item some tool has through the plugin itself. */
const fromAPlugin = (skill: ItemRow) => fromPlugins(skill, kind).length > 0 || Object.keys(skill.plugin ?? {}).length > 0;

/** The item a tool has through a plugin on a row of the person's own, with that plugin as the tool has it installed. */
function itemThrough(skill: ItemRow, tool: Tool): PluginItemAt | undefined {
  const given = throughPluginHere(skill, tool);
  const install = given && state.home?.pluginItems?.find(entry => entry.tool === tool && entry.plugin === given.plugin && entry.marketName === given.marketplace);
  return install ? { kind: partOfPage[kind], name: given.name ?? skill.name ?? skill.key, tool: tool as HarnessId, install } : undefined;
}


/** Turns a plugin's item on or off in its tool at once, with its own switch or the whole plugin's (pluginswitch.ts). */
function switchPluginItem(item: PluginItemAt) {
  pinRows(view.comparing);
  const draft: PluginDraft = new Map();
  const on = !itemOn(item);
  clickPluginItem(draft, item);
  const ops = [...draft.values()];
  void applyPluginSwitches(ops, draft, { said: itemSaid(item, on, ops), undone: undoneWords(item.name, on, names[item.tool]) });
}

/** Why an item a tool has through a plugin can't be switched on this page now, if it can't: the switch itself (pluginswitch.cantSwitch), or a home that can't be written. */
const cantSwitchHere = (item: PluginItemAt) => cantSwitch(item) ?? (state.home ? whyReadOnly(state.home) : undefined);

/**
 * The item's switch in one tool, in an opened row, where a person's own item has its switch there: on or off, applied at once,
 * with the tool's own switch for one item or (where it has none) the whole plugin's, which its line says first. `page`: a link
 * to the plugin's page beside it, on a row that has no other.
 */
function pluginItemControls(item: PluginItemAt, id: string, page?: () => void) {
  const on = itemOn(item);
  const why = cantSwitchHere(item);
  const label = `${item.name} in ${names[item.tool]}: ${on ? 'on' : 'off'}. ${why ?? clickWords(item)}`;
  return h('span.details-tool-actions', {},
    h('span.tool-switch', {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, on ? 'On' : 'Off'),
      toggle({ on, label, disabled: !!why || !canWrite(), onchange: () => switchPluginItem(item), id })),
    page ? smallAction('Plugin’s page', `${id}-page`, page, '.tool-link') : null);
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
    ...(where.listed ? [h('button.inline-link', { type: 'button', id, onclick: (event: Event) => { event.stopPropagation(); openWhole(row); } }, `${row.plugin}’s page on Plugins`), '. '] : [' ']),
    'Central Knot doesn’t copy it between tools; the switches below turn it on or off in each tool.'));
}


/** Plugin items whose file is shown, by row key (a redraw keeps it open), with each tool's text once read. */
const filesShown = new Map<string, { tool: HarnessId; text: string }[] | undefined>();
/** Shows or hides a plugin item's file; showing reads it from each tool's copy. */
function toggleFile(row: PluginRow) {
  if (filesShown.delete(row.key)) { rerender(); return; }
  filesShown.set(row.key, undefined);
  rerender();
  const read = (texts: { tool: HarnessId; text: string }[]) => { if (filesShown.has(row.key)) { filesShown.set(row.key, texts); rerender(); } };
  void window.centralKnot.pluginItemTexts(row.plugin, row.marketName, row.kind, row.name).then(read, () => read([]));
}

/** A plugin item's details: what it is, where it comes from and is handled, each tool's copy, and its file as each tool's copy has it. */
function pluginDetails(row: PluginRow, placement: 'row' | 'dock' = 'row') {
  const [type, ...rest] = row.description.split(' · ');
  const shown = filesShown.has(row.key), copies = filesShown.get(row.key);
  const file = row.kind === 'skill' ? 'SKILL.md' : 'agent file';
  // The file shows right under the link that shows it, below the tools' lines, as in the Files view: the switches stay in view.
  const fileShown = !shown ? null : !copies?.length ? h('p.details-limits', {}, copies ? 'Its file couldn’t be read.' : 'Reading…')
    : h('div.plugin-file', {}, fileBlocks(`pfile-${row.key}-text`, file, copies, holders => `${file} · ${andList(holders.map(holder => names[holder.tool]))}`, { named: copies.length > 1 }));
  return h(`div.compare.details.details-plugin.details-grid${placement === 'row' ? '' : '.details-bare'}`, { role: 'region', 'aria-label': `Details for ${row.name}` },
    h('div.details-head', {},
      h('p.details-status', {}, pluginStatus(row)),
      kind === 'mcp' && row.description ? h('dl.details-definition', {}, h('dt', {}, 'Type'), h('dd', {}, type === 'Command' ? 'Command (stdio)' : type), h('dt', {}, type === 'Command' ? 'Command' : 'URL'), h('dd.mono', {}, rest.join(' · ')))
        : row.description ? h('p.details-description', {}, row.description) : null,
      handledNote(row, '', `open-whole-${row.key}`)),
    h('div.details-tools', {}, toolList().map(tool => {
      const install = row.copies[tool as HarnessId] ? row.installs[tool as HarnessId] : undefined;
      const item: PluginItemAt | undefined = install && { kind: row.kind, name: row.name, tool: tool as HarnessId, install };
      return h('div.details-tool', {}, h('div.details-tool-head', {},
        h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
        h('span.details-tool-line', {}, [toolWords(row, tool as HarnessId), item ? cantSwitch(item) ?? switchWords(item) : ''].filter(Boolean).join(' ')),
        item ? pluginItemControls(item, `enable-${row.key}-${tool}`) : null));
    })),
    row.kind === 'mcp' ? null : h('div.details-file', {}, h('div.details-actions', {}, smallAction(shown ? `Hide its ${file}` : `Show its ${file}`, `pfile-${row.key}`, () => toggleFile(row))), fileShown));
}

/** A plugin's item's state in one line, as an ordinary item's opens: "On in Claude Code · off in Copilot CLI · from the plugin document-tools". */
function pluginStatus(row: PluginRow): string {
  const items = rowItems(row);
  const on = items.filter(itemOn).map(item => item.tool);
  const off = items.filter(item => !itemOn(item)).map(item => item.tool);
  return [on.length ? `On in ${toolsPhrase(on, toolList())}` : `Off in ${toolsPhrase(off, toolList())}`, on.length && off.length ? `off in ${toolsPhrase(off, toolList())}` : '', `from the plugin ${row.plugin}`].filter(Boolean).join(' · ');
}

/** A plugin item's row: its switch (each tool's switch for one item), its name with the plugin's mark, and a mark per tool. */
function pluginRowEl(row: PluginRow) {
  const open = view.comparing === row.key;
  const mark = (tool: Tool) => {
    const look: MarkLook = !row.copies[tool as HarnessId] ? 'none' : offIn(row, tool as HarnessId) ? 'off' : 'on';
    const drawn = toolMark(look, tool);
    drawn.id = `cell-${row.key}-${tool}`;
    drawn.title = cellWords(row, tool as HarnessId);
    Object.assign(drawn.dataset, { tool, look, state: { none: 'plugin-none', off: 'plugin-off' }[look as string] ?? 'plugin' });
    return drawn;
  };
  return [
    h(`div.ov-row.ov-switch-row.unmanaged.ov-plugin-row${open ? '.open' : ''}`, { role: 'row', 'data-key': row.key, 'aria-expanded': String(open), onclick: () => openRow(row.key) },
      h('div.ov-managed', { role: 'cell' }, pluginRowSwitch(row)),
      h('div.ov-name.ov-name-fit.ov-name-bare', { role: 'cell', title: row.description ? `${row.name}: ${row.description}` : row.name },
        h('span.ov-name-main', {}, h('span.ov-name-text', {}, row.name)),
        pluginTag(row.plugin, insideTitle(row)),
        row.description ? h('span.ov-name-about', { title: row.description }, row.description) : null),
      h('div.ov-marks', { role: 'cell' }, h('span.tool-marks', { role: 'img', 'aria-label': toolList().map(tool => cellWords(row, tool as HarnessId)).join('. ') }, toolList().map(mark))),
      h('div.ov-open', { role: 'cell' }, openButton(row.key, row.name))),
    open && !docked() ? pluginDetails(row) : null,
  ];
}

/** The plugin items' own section, after the person's own items: counted apart, since they come and go with their plugin. */
function pluginSection(list: PluginRow[]) {
  if (!list.length) return null;
  return h('div', { role: 'rowgroup' },
    h('div.ov-section.ov-section-plugins', { role: 'row' }, h('div.ov-section-label', { role: 'cell' }, h('strong', {}, 'Only through a plugin'), h('span.ov-section-count', {}, String(list.length)),
      sectionNote('installed with their plugin · switched here like any other'))),
    list.flatMap(pluginRowEl));
}

/** Installed plugins whose copy couldn't be read in the tools this table is about: what they bring is missing, and why. */
function unreadBand() {
  const list = plugged().unread.filter(install => !focus || install.tool === focus);
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

/** The real home's facts in the shape the page works with. */
const fromFacts = (facts: SkillFacts): ItemRow => ({
  key: facts.key, name: facts.name, description: facts.description, gone: facts.gone, converted: facts.converted, unseen: facts.unseen, plan: facts.plan, differs: facts.differs, versionChanges: facts.versionChanges, managed: facts.managed, off: facts.off, cannot: facts.cannot, plugin: facts.plugin, held: facts.held, separate: facts.separate, edited: facts.edited,
  blocks: facts.choiceBlocks, hashes: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.hash])),
  copies: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.hash])),
  paths: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.directory])),
  // An MCP entry has no lines or edit date of its own: its details name the file it lives in.
  versions: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.lines ? { lines: `${copy!.lines} lines`, changed: ago(copy!.modified), at: copy!.modified, text: copy!.summary || facts.description, ...(copy!.body !== undefined ? { body: copy!.body } : {}) } : { lines: copy!.directory.split('/').pop() ?? '', changed: 'MCP entry', text: copy!.summary }])),
  disabled: facts.disabled, switchProblem: facts.switchProblem,
  ownPart: Object.fromEntries(Object.entries(facts.copies).flatMap(([tool, copy]) => (copy!.ownPart?.length ? [[tool, copy!.ownPart]] : []))),
  anotherWay: facts.anotherWay, takeOver: facts.takeOver, switched: facts.switched,
});

/** One item as a table row. `waiting`: MCP servers whose Claude Code entry waits for Write to Claude Code, which their cell says. */
const rowOf = (fact: SkillFacts, waiting: Set<string>): ItemRow => ({ ...fromFacts(fact), waits: waiting.has(fact.key) ? ['claude-cli'] : undefined });

/** The view behind the table, whose bands are listNotices': a library kind's (itemrow.ts libraryView), or MCP's. */
const listView = () => (state.home && (libraryView(state.home, kind) ?? (kind === 'mcp' ? state.home.mcp : undefined)));
/** The kind's column header ("Server") and its title ("MCP servers"), from words.ts kindNouns. */
const nouns = Object.fromEntries((['skills', 'mcp', 'agents'] as const).map(each => [each, [kindNouns[each].short[0].replace(/^./, first => first.toUpperCase()), kindNouns[each].title]])) as Record<PageKind, [string, string]>;
/** What this table shows: skills, MCP servers or agents. The same marks mean the same things on each. */
let kind: PageKind = 'skills';
/** The kinds profiles switch (profileplan.ts), by their profile name. */
const profiled = { skills: 'skill', mcp: 'mcp' } as const;
/** Whether a profile switch turned this item off in this tool, not a switch turned by hand. */
const turnedOffByProfile = (key: string, tool: Tool) => kind in profiled && !!state.home?.profiles.offByProfile[itemId(profiled[kind as keyof typeof profiled], key)]?.includes(tool as HarnessId);
const factsCache: Partial<Record<PageKind, { from: unknown; gone: unknown; list: ItemRow[] }>> = {};

/** This table's kind as the library carries it (librarypages.ts), when it is on the library. */
const library = () => libraryPages[kind];

function committedList(): ItemRow[] {
  if (!state.home) return [];
  // Items with no copy left are rows too, switched off, while History can put them back.
  const { facts, waiting, gone } = kindSource(state.home, kind);
  if (factsCache[kind]?.from !== facts || factsCache[kind]?.gone !== gone) { const waits = new Set(waiting); factsCache[kind] = { from: facts, gone, list: [...facts, ...gone].map(fact => rowOf(fact, waits)) }; }
  return factsCache[kind]!.list;
}
/** The harness a Harnesses page shows: its column comes first, and the rows it has come before the others. */
let focus: Tool | undefined;
const toolList = (): Tool[] => {
  const list: Tool[] = state.home ? kindSource(state.home, kind).tools : [];
  return focus && list.includes(focus) ? [focus, ...list.filter(tool => tool !== focus)] : list;
};
/** Whether the focused harness has its own copy; with no focus, every item counts. */
const inFocus = (skill: ItemRow) => !focus || inTool(skill, focus as HarnessId);
/** Where a row stands now (roworder.ts): 0 on, 1 not synced, 2 off. Its switch shows this. */
/** The tools that have a person's own item through a plugin and have it on there. */
const pluginOnIn = (skill: ItemRow) => toolList().filter(tool => { const given = throughPluginHere(skill, tool); if (!given) return false; const item = itemThrough(skill, tool); return item ? itemOn(item) : !given.off; });
/** An item as roworder.ts places it: with the tools that load it through a plugin. */
const placed = (skill: ItemRow) => ({ ...skill, pluginOn: pluginOnIn(skill) });
/** The tools that use it (roworder.ts loadedIn): its row's place, its switch and its status line all go by these. */
const onIn = (skill: ItemRow) => loadedIn(placed(skill), toolList());
/** An item as Central Knot's library holds it (library.ts); none for a kind not on the library, or for an item only found in a harness. */
const itemOf = (skill: ItemRow) => (state.home ? kindSource(state.home, kind).library?.[skill.key] : undefined);
/** Where a row stands: 0 on, 1 in between (not synced; a library item: found, not in Central Knot), 2 off. A library item's place is its item's (libraryrow.ts). */
const standingOf = (skill: ItemRow): 0 | 1 | 2 => (library() ? ({ on: 0, found: 1, off: 2 } as const)[libraryPlace(itemOf(skill))] : standing(placed(skill), toolList()));
/** The visit, read and home a table's rows were last placed in (view.pinned): any of them changing regroups the rows. */
const pinKey = () => `${state.visit}:${state.reads}:${state.home?.home ?? ''}`;
/** A row's group: where it stood when a click on this visit first changed something (pinRows), else where it stands now. */
const placeOf = (skill: ItemRow) => (view.pinned?.at === pinKey() ? view.pinned.places.get(skill.key) : undefined) ?? standingOf(skill);
/** The headings, by place. */
const placeNames = ['On', 'Not synced', 'Off'] as const;
/** Whether its copies differ so that its switch must ask which copy every tool uses. An item in the library never asks. */
const differs = (skill: ItemRow, tools: Tool[] = toolList()) => (library() ? libraryNeedsChoice(skill, itemOf(skill)) : needsCopyChoice(skill, tools));
/** Copies differ and need a choice, among the items this page is about: on a harness's page, the ones it has. */
const needsChoice = (skill: ItemRow) => inFocus(skill) && differs(skill);

/**
 * How many items one tool has whose copies differ and need a choice: what the "Copies differ" chip counts on that tool's
 * Harnesses page, read from the facts the same way the table reads them. `waiting`: MCP servers waiting for Claude Code.
 */
export function differingIn({ facts, tools, waiting, library: items }: KindSource, tool: Tool) {
  const waits = new Set(waiting);
  const asks = (row: ItemRow) => (items ? libraryNeedsChoice(row, items[row.key]) : needsCopyChoice(row, tools));
  return facts.filter(fact => fact.copies[tool as HarnessId] !== undefined && asks(rowOf(fact, waits))).length;
}
type Filter = 'all' | 'attention' | 'plugins';
const newView = () => ({
  filter: 'all' as Filter,
  find: '',
  /** The skill whose details are open under its row. */
  comparing: undefined as string | undefined,
  /** A library kind: the item whose copy question shows every copy's body side by side (RowWords body). */
  reading: undefined as string | undefined,
  /** A library kind: the item whose versions list shows every version, not only its newest few. */
  versionsUnfolded: undefined as string | undefined,
  /** A library kind: the version being read in an opened row (its item, and its place in the list). */
  readingVersion: undefined as { key: string; index: number } | undefined,
  /** The harness whose page this view was last drawn on (undefined: the kind's own page). */
  shownFor: undefined as Tool | undefined,
  /** What the Skills page list is narrowed to. */
  listFind: '',
  /** The item whose Delete from Central Knot is waiting for its confirming click. */
  confirmDelete: undefined as string | undefined,
  /** The visit on which a row was last opened or closed (state.visit): a copy question doesn't outlive it. */
  openedOn: 0,
  /** When a row was last opened (state.said.seq): its copy question hides only results said before it. */
  openedAt: 0,
  /** The Files view's "Where each copy is", once the person opens or closes it; until then it follows the pane's width. */
  whereOpen: undefined as boolean | undefined,
  /** Each row's group when a click on this visit first changed something (pinRows), and when that was (pinKey). */
  pinned: undefined as { at: string; places: Map<string, 0 | 1 | 2>; key?: string } | undefined,
});
const views: Record<PageKind, ReturnType<typeof newView>> = { skills: newView(), mcp: newView(), agents: newView() };
/**
 * Opens a page already narrowed, for links that point at a problem (the Overview's or a harness card's "different copies").
 * `harness`: the harness page it opens on (none: the kind's own page), so the first draw there keeps this filter.
 */
export const showFiltered = (which: PageKind, filter: Filter, harness?: Tool) => { startFresh(views[which], harness); views[which].filter = filter; };
/** A table drawn for another page (a harness's, or the kind's own) starts with no filter, Find text, open row or menu from the last one. */
function startFresh(table: ReturnType<typeof newView>, harness: Tool | undefined) {
  Object.assign(table, { filter: 'all', find: '', comparing: undefined, confirmDelete: undefined, shownFor: harness });
}
/** Opens an item's details on its own page (Skills, MCP servers or Agents), found by name, and scrolls it into view. */
export function openItem(which: PageKind, name: string) {
  const facts = state.home && kindSource(state.home, which).facts;
  const partKind = partOfPage[which];
  const key = facts?.find(item => samePart({ kind: partKind, name: item.key }, { kind: partKind, name }) || samePart({ kind: partKind, name: item.name }, { kind: partKind, name }))?.key;
  // Drawn for the kind's own page (startFresh), so its first draw there keeps this row open.
  startFresh(views[which], undefined);
  views[which].comparing = key;
  showPage(which);
  if (key) requestAnimationFrame(() => document.querySelector(`.ov-row[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center' }));
}
let view = views.skills;
/** The page the tables were last drawn on. */
let tablesVisit = -1;
const committedOf = (key: string) => committedList().find(skill => skill.key === key)!;
const rows = committedList;

/** Whether a tool's mark shows the item off there: its own switch is off, and it has (or gets) a copy. */
const shownDisabled = (skill: ItemRow, tool: Tool) => !!skill.disabled?.includes(tool) && !['cannot', 'absent'].includes(cellOf(skill, tool));

// ---------- Visual vocabulary ----------

const throughPluginHere = (skill: ItemRow, tool: Tool): ThroughPlugin | undefined => (skill.copies[tool] === undefined ? skill.plugin?.[tool] : undefined);


const smallAction = (label: string, id: string, onclick: () => void, extra = '', disabled = false) =>
  h(`button.text-action${extra}`, { type: 'button', id, disabled, onclick: (event: Event) => { event.stopPropagation(); onclick(); } }, label);

// ---------- The toolbar ----------

function filterBar() {
  const list = committedList();
  const attention = list.filter(needsChoice).length;
  // Each chip has a short form, its mark, for a crowded toolbar: the whole group folds together (dom.ts fitBars), with each
  // name as its tooltip.
  // `count`: how many it shows, amber when they need something (`warn`).
  const chip = (id: Filter, label: string, glyph: IconName, count?: number, warn = false) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn && count ? '.chip-warn' : ''}`,
    { type: 'button', 'aria-pressed': String(view.filter === id), 'aria-label': count !== undefined ? `${label} ${count}` : label, 'data-tip': label, onclick: () => { view.filter = id; rerender(); } },
    icon(glyph, 13, 'chip-icon'), h('span.chip-label', {}, label), count !== undefined ? h('span.chip-count', {}, String(count)) : null);
  const narrowing = [copiesDifferChipShown() ? chip('attention', 'Copies differ', 'diff', attention, true) : null, pluginChipShown() ? chip('plugins', 'From plugins', 'puzzle', pluginCount()) : null].filter(Boolean);
  // All alone narrows nothing: no chips then.
  return narrowing.length ? h('div.chips', { role: 'group', 'aria-label': 'Show' }, chip('all', 'All', 'list'), narrowing) : null;
}

const canWrite = () => !!state.home && !whyReadOnly(state.home) && !state.busy;

/** What could not be done, item by item (the first four, then how many more), as a warning band. */
export const problemsBand = (problems: DestinationResult[]) => h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
  h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · ') + (problems.length > 4 ? ` · and ${problems.length - 4} more` : '')));

/** Names shown as names, so a server called "files" does not read as a word in the sentence. */
const nameList = (items: string[]) => items.flatMap((item, index) => [index ? (index === items.length - 1 ? ' and ' : ', ') : '', h('strong.item-name', {}, item)]).filter(part => part !== '');

/** Where an item's details are drawn: under its row, docked beside the table, or in the Skills page's Files view. */
type Placement = 'row' | 'dock' | 'files';

/** An item whose copies differ between tools, so the person chooses one (never one held as it is). */
const isDiffering = (skill: ItemRow) => differs(skill);

/**
 * The Files view's parts for one skill, in the order they read: its details (status, versions), then where each copy is and
 * Delete from Central Knot. Stacked, the file comes first and all of them below it; a wide pane (style.css data-columns)
 * puts them in its column beside the file, one under the other.
 */
function filesLayout(skill: ItemRow, where: Node[]): { head: Node | null; tail: Node[] } {
  const lib = library(), remove = lib ? libraryDelete(lib, skill) : null;
  return { head: details(skill, 'files'), tail: [wherePaths(skill, where, true), remove ? h('div.details-actions', {}, remove) : null].filter((part): part is HTMLElement => !!part) };
}

/** Where each copy lives, folded away: paths matter less than what each tool has. `extra` folds in more about them (Files view). */
function wherePaths(skill: ItemRow, entries: Node[] = [], inFiles = false) {
  // The Files view names each copy once, with all it knows about it (pages.ts copyEntry); elsewhere a line per tool.
  const shown = inFiles ? [] : toolList().filter(tool => skill.paths?.[tool]);
  if (!shown.length && !entries.length) return null;
  // MCP: the settings files are where a server is changed, so they show open. Skills and agents fold them away, except in
  // the Files view's wide pane, whose details column has the room: there they start open, until the person says otherwise.
  // In the Files view an open or closed one stays as the person left it; until then it follows the pane (settleFilesColumns).
  const open = kind === 'mcp' || (inFiles && view.whereOpen === true);
  const paths = h('details.details-paths', open ? { open: true } : {}, h('summary', { onclick: () => { if (inFiles) view.whereOpen = !(paths as HTMLDetailsElement).open; } }, icon('chevron-right', 12, 'tone-faint'), kind === 'mcp' ? 'Settings files' : 'Where each copy is'),
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

/** MCP: the server's definition as labelled lines ("Type HTTP", "URL …"), read from its one-line summary. */
function definition(summary: string, managed: boolean) {
  const [kind, ...rest] = summary.split(' · ');
  const value = rest.join(' · ');
  const isCommand = kind === 'Command';
  return h('dl.details-definition', {},
    h('dt', {}, 'Type'), h('dd', {}, isCommand ? 'Command (stdio)' : kind),
    h('dt', {}, isCommand ? 'Command' : 'URL'), h('dd.mono', {}, value),
    // A server that isn't synced is each tool's own: nothing spreads, so the hint says only where to edit.
    h('dd.details-definition-hint', {}, !managed ? 'To change it, edit a settings file below; each tool keeps its own copy.' : toolList().includes('claude-cli') && toolList().length > 1
      ? `To change it, edit any settings file below. ${andList(toolList().filter(tool => tool !== 'claude-cli').map(tool => names[tool]))} sync on their own; Claude Code updates when you click Write to Claude Code.`
      : 'To change it, edit any settings file below; the change syncs to the others.'));
}

/** Where an earlier Undo went, said by what it undoes: "The undo for writing files to Claude Code moved to History." */
function movedUndoText(label: string, items: string[]): (string | HTMLElement)[] {
  const named = nameList(items.slice(0, 3));
  const what = /write/i.test(label) ? ['writing ', ...named, ' to Claude Code'] : label === 'Undo' && items.length ? ['your change to ', ...named] : [label.replace(/^Undo\s*/, '') || 'your last change'];
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
  if (kind === 'mcp') return text ? entryWords(text, others.map(other => versions[other]?.text ?? '')) : undefined;
  const inMarks = (said: string) => { const { lead, words, tail } = shortQuote(kind, said); return `“${lead}${words}${tail}”`; };
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
      const { lead, words, tail, start } = shortQuote(kind, line, differsAt);
      return [`“${lead}`, ...cutMarked(marked, start, words.length), `${tail}”${further.length ? ` and ${further.length} more ${further.length === 1 ? 'line' : 'lines'}` : ''}`];
    }
    const missing = theirs.flat().find(other => !lines(body).includes(other));
    if (missing) return [`Without ${inMarks(missing)}`];
  }
  return text ? [inMarks(text)] : undefined;
}

/**
 * The copy question, for an item whose copies differ: the question ("Which copy of <name> should every tool use?", or "both
 * tools") and its note, then one row per choice, each saying what it does, and doing it at once. Copies that are the same are
 * one choice. Its layout at each width is style.css "The copy question"; its words' rules are copywords.ts.
 */
function compareChoices(skill: ItemRow, inFiles = false) {
  const versions = skill.versions ?? {};
  const compared = toolList().filter(tool => comparedTools(skill).includes(tool));
  const groups = [...groupBy(compared, tool => skill.hashes?.[tool] ?? tool).values()];
  // A choice turns it on everywhere: every tool that can hold it and has no copy gets the chosen one.
  const receiving = toolList().filter(tool => !skill.cannot?.[tool] && skill.copies[tool] === undefined && !skill.waits?.includes(tool));
  // A group's content was made when its earliest copy was: a copy sync wrote is newer than the edit it carries. Marked only when
  // every copy's time is known and one group's is the latest. A copy an Undo of a choice puts back has its earlier time again.
  // Left so: a copy sync wrote into a tool that was behind, alone in its group, carries the time of that write, not of the edit
  // it holds; "most recent" gets its full meaning with first setup (one-switch step 7).
  const editedAt = groups.map(group => Math.min(...group.map(tool => Date.parse(versions[tool]?.at ?? ''))));
  const last = Math.max(...editedAt);
  const latest = groups.length > 1 && kind !== 'mcp' && editedAt.every(Number.isFinite) && editedAt.filter(at => at === last).length === 1 ? groups[editedAt.indexOf(last)] : undefined;
  // The line under each name, in one form: the copy's size (where the sizes differ) and when it was edited ("7 lines · edited
  // 2 days ago"), or an MCP entry's file. It shows on every row or on none: only where it tells the copies apart. The copy
  // edited most recently has the line's one emphasis.
  const sizesDiffer = new Set(groups.map(([tool]) => versions[tool]?.lines)).size > 1;
  const factsOf = (tool: Tool, at: number) => [sizesDiffer ? versions[tool]!.lines : '', Number.isFinite(at) ? `edited ${sinceThen(at)}` : versions[tool]!.changed];
  const facts = groups.map(([tool], index) => (versions[tool] ? factsOf(tool, editedAt[index]).filter(Boolean).join(' · ') : ''));
  // A library item's copies always say when each was edited, and the newer one is marked: latest wins everywhere else in the library.
  const lib = library();
  const factsDiffer = !!lib || !!latest || new Set(facts).size > 1;
  const newest = lib ? (groups.length > 2 ? 'Newest' : 'Newer') : 'most recent';
  const about = (group: Tool[]) => {
    const said = facts[groups.indexOf(group)];
    if (!factsDiffer || !said) return null;
    return group === latest ? h('span.version-meta.version-latest', {}, `${said} · ${newest}`) : h('span.version-meta', {}, said);
  };
  const choice = (group: Tool[]) => {
    const [tool] = group;
    const tools = andList(group.map(entry => names[entry]));
    // A row's columns: whose copy (and what tells it apart), what it says (and what choosing it does), then Use this copy.
    const who = h('span.version-who', {}, h('span.version-head', {}, ...group.map(entry => brandMark(entry, 14)), h('strong', {}, group.length > 1 ? `${tools} (same copy)` : `${tools}’s copy`)), about(group));
    // A block counts only for a tool it syncs to that can load the skill.
    const block = skill.blocks?.[tool]?.find(entry => !skill.off.includes(entry.tool) && !skill.cannot?.[entry.tool]);
    // A copy that can't be chosen keeps its row: why, where its quote would be, and no Use this copy.
    if (block) return h('button.version.version-blocked', { type: 'button', id: `use-${skill.key}-${tool}`, disabled: true, title: block.reason },
      who, h('span.version-says', {}, h('span.version-effect.version-why', {}, icon('circle-alert', 12, 'tone-warning'), cantUse(block.reason))));
    const others = compared.filter(entry => !group.includes(entry));
    const said = copyQuote(skill, tool, others);
    return h('button.version', { type: 'button', id: `use-${skill.key}-${tool}`, 'aria-label': `Use ${tools}’s copy`, disabled: !canWrite(), onclick: () => turnOn(skill, tool) },
      who,
      h('span.version-says', {},
        said ? h('span.version-text', {}, ...said) : null,
        h('span.version-effect', {}, choiceEffect(others.map(entry => names[entry]), receiving.map(entry => names[entry])))),
      h(`span.version-cta${lib && group === latest ? '.version-cta-main' : ''}`, { 'aria-hidden': 'true' }, 'Use this copy'));
  };
  // Comparing comes before choosing: the full copies side by side, a click from the choices (the Files view shows them already;
  // a kind with one, skills, opens it there).
  const every = compared.length > 2 ? 'Read every copy' : 'Read both copies';
  const read = inFiles || kind === 'mcp' ? null : lib?.files ? smallAction(every, `diff-${skill.key}`, () => openFiles(skill.key), '.compare-read') : smallAction(view.reading === skill.key ? 'Hide the copies' : every, `diff-${skill.key}`, () => { view.reading = view.reading === skill.key ? undefined : skill.key; rerender(); }, '.compare-read');
  const bodies = lib?.words.body && view.reading === skill.key
    ? h('div.compare-copies', {}, fileBlocks(`body-${skill.key}`, lib.words.body, compared.map(tool => ({ tool, text: versions[tool]?.body ?? '' })), holders => `${lib.words.body} · ${andList(holders.map(holder => names[holder.tool]))}`, { named: true }))
    : null;
  return h('div.compare-block', {},
    h('p.compare-title', {}, icon(lib ? 'circle-question-mark' : 'diff', 14, 'tone-warning'), h('span', {}, 'Which copy of ', h('strong.item-name', {}, skill.name ?? skill.key), ` should ${compared.length + receiving.length > 2 ? 'every tool' : 'both tools'} use?`)),
    // A library item's choice takes it into Central Knot: the copies not chosen become its versions, each of which can be made current later.
    h('p.compare-note', {}, lib ? `Choosing applies at once: the ${lib.words.item} is taken into Central Knot with that copy, and turned on everywhere. The other copies are kept as its versions.`
      : `Choosing applies at once, with Undo, and turns it on everywhere. Replaced copies are kept in History.${kind === 'mcp' && receiving.includes('claude-cli') ? ` ${CLAUDE_LATER}` : ''}`),
    h('div.compare-choices', {}, groups.map(choice)),
    read, bodies);
}

/** Whether an open row's details dock beside the table: the content is wide enough (renderer.ts sets state.wide). */
const docked = () => state.wide;
/**
 * Whether an open item's details sit under its row: always in a narrow window, and at every width for a copy question, so the
 * question opens where the switch was clicked.
 */
const underRow = (key: string) => !docked() || committedList().some(skill => skill.key === key && isDiffering(skill));

/**
 * The open row's details in a panel beside the table: its name and a close button, then everything the inline details
 * show, so the item's actions sit with it and a wide window's width is used.
 */
function itemDock(skill: ItemRow) {
  const name = skill.name ?? skill.key;
  return h('aside.dock', { 'aria-label': `Details for ${name}` },
    h('header.dock-head', {},
      h('div.dock-title', {}, h('h2', {}, middle(name)), h('p', {}, nouns[kind][0])),
      closeButton(() => { view.comparing = undefined; rerender(); }, { id: 'dock-close', label: `Close details for ${name}`, title: 'Close' })),
    h('div.scroll.dock-scroll', { id: 'dock-scroll' }, details(skill, 'dock')));
}

/** A plugin item's details docked beside the table, as an item's are. */
function pluginDock(row: PluginRow) {
  return h('aside.dock', { 'aria-label': `Details for ${row.name}` },
    h('header.dock-head', {},
      h('div.dock-title', {}, h('h2', {}, middle(row.name)), h('p', {}, `${nouns[kind][0]} · from ${row.plugin}`)),
      closeButton(() => { view.comparing = undefined; rerender(); }, { id: 'dock-close', label: `Close details for ${row.name}`, title: 'Close' })),
    h('div.scroll.dock-scroll', { id: 'dock-scroll' }, pluginDetails(row, 'dock')));
}

/** Opening a row's details brings them into view, so a choice below the fold is not missed. */
function openRow(key: string) {
  view.comparing = view.comparing === key ? undefined : key;
  view.openedOn = state.visit;
  view.openedAt = state.said.seq;
  rerender();
  // Bring the details into view without losing the row (its name and close button) under the sticky header. Docked
  // details sit beside the table and are always in view.
  if (view.comparing && underRow(key)) requestAnimationFrame(() => {
    const rowEl = document.querySelector(`.ov-row[data-key="${CSS.escape(key)}"]`);
    const details = rowEl?.nextElementSibling;
    const box = rowEl?.closest('.scroll')?.getBoundingClientRect();
    if (!rowEl || !details || !box) return;
    if (details.getBoundingClientRect().bottom > box.bottom) rowEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

/** A library item's tag after its name, when it isn't plainly on everywhere (libraryrow.ts placeTag). */
function libraryTag(skill: ItemRow) {
  const tag = library()?.say.placeTag(skill, itemOf(skill), toolList());
  return tag ? h('span.row-tag', { title: tag.title }, tag.text) : null;
}

/**
 * An item's name cell. The name gives way last: as the column narrows, the description shortens (and in every row at
 * once steps aside, settleDescriptions, after any name longer than half its row is cut), a tag after the name wraps out
 * of sight, and only then does the name shorten (style.css .ov-name-fit). Its full text is always in the tooltip. Nothing in it is a control: the row's switch and chevron
 * are its only ones, so Copies differ is said here, not clicked.
 */
function nameCell(skill: ItemRow, attention: boolean) {
  const name = skill.name ?? skill.key;
  return h('div.ov-name.ov-name-fit.ov-name-bare', { role: 'cell', title: skill.description ? `${name}: ${skill.description}` : name },
    h('span.ov-name-main', {},
      h('span.ov-name-text', {}, name),
      skill.held ? h('span.held-pill', { title: skill.held }, 'Can’t sync') : null,
      attention ? h('span.row-tag.row-tag-differs', { id: `decide-${skill.key}` }, 'Copies differ') : null),
    libraryTag(skill),
    partTags(skill),
    skill.gone ? h('span.row-tag', { title: 'No tool has a copy now. Turn it on to put it back from History.' }, 'no copy left') : null,
    skill.description ? h('span.ov-name-about', { title: skill.description }, skill.description) : null);
}

/** The chevron that opens or closes a row's details, at the row's end. */
function openButton(key: string, name: string) {
  const open = view.comparing === key;
  return h('button.row-open', { type: 'button', id: `open-${key}`, 'aria-label': `${open ? 'Hide' : 'Show'} details for ${name}`, 'aria-expanded': String(open), onclick: (event: Event) => { event.stopPropagation(); openRow(key); } },
    icon(open ? 'chevron-down' : 'chevron-right', 14, 'tone-faint'));
}

/** Moving to another harness starts every table fresh (the kind pages' too, which share them), whichever was drawn last. */
export function resetTablesForHarness() {
  for (const each of Object.values(views)) startFresh(each, each.shownFor);
}

/** A note after a section heading, after one separating dot that is spaced the same on both sides for every note. */
const sectionNote = (...children: (Node | string)[]) => h('span.ov-section-after', {}, h('span.ov-section-dot', { 'aria-hidden': 'true' }, '·'), ...children);

export { brandMark };

/**
 * Whether the open page still shows a result. It stands until the page changes, the next action, or it is dismissed; it
 * steps aside while a copy choice it names is open, and in the Files view for a skill it doesn't name.
 */
function outcomeShown(outcome: Outcome, matrixPage: boolean): boolean {
  if (outcome.page !== state.page) return false;
  const named = [outcome.item, ...(outcome.items ?? [])].filter((name): name is string => !!name);
  // A newer result (an Undo that brings the question back) is still said.
  const choosing = matrixPage && view.comparing && (outcome.said ?? 0) <= view.openedAt && committedList().some(skill => skill.key === view.comparing && needsCopyChoice(skill, toolList()) && named.some(name => name === skill.name || name.toLowerCase() === skill.key));
  if (choosing) return false;
  return !(state.skillsView === 'files' && state.item && !named.some(name => name.toLowerCase() === state.item));
}

/**
 * The last action's result as a band, when it offers something to do; a result that only tells is in the status bar.
 * `table`: a table is on screen, so its open copy choice hides an older result (guessed from the page;
 * a harness tab without a table passes false).
 */
export function outcomeBand(table = state.page === 'skills' || state.page === 'mcp' || state.page === 'agents' || !!harnessKindShown()): HTMLElement | null {
  const outcome = state.outcome;
  if (!outcome || !outcomeShown(outcome, table) || saidInStatusBar(outcome)) return null;
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
  // Two buttons take their own line under the words in a narrow window (style.css), so the sentence is never squeezed.
  return h(`div.band.band-done${outcome.next ? '.band-two' : ''}`, { role: 'status', 'data-outcome': '' }, outcome.warn ? icon('triangle-alert', 14, 'tone-warning') : outcome.info ? icon('info', 14, 'tone-muted') : icon('check', 14, 'tone-success'), h('span.band-text', {}, ...text,
    // The space before the note sits outside it, so a note kept whole on its line never carries the last word with it.
    outcome.note ? [' ', h('span.tone-faint', {}, outcome.note.replace(/ History\.$/, ' '), h('button.inline-link', { type: 'button', id: 'outcome-note-history', onclick: (event: Event) => { event.stopPropagation(); showPage('history'); } }, 'History'), '.')] : null),
    h('span.band-actions', {},
      outcome.act ? button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, attrs: outcome.act.title ? { title: outcome.act.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.act!.run(); } })
        : outcome.undo ? smallAction(outcome.undo.label, 'outcome-undo', () => void restoreEvent(outcome.undo!.id), undefined)
        : outcome.history ? smallAction('Undo in History', 'outcome-history', () => showPage('history')) : null,
      outcome.next ? button({ variant: 'outline', size: 'small', label: outcome.next.label, id: outcome.next.id, attrs: outcome.next.title ? { title: outcome.next.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.next!.run(); } }) : null),
    closeButton(() => { state.outcome = undefined; rerender(); }, { id: 'outcome-dismiss' }));
}

/** Sync off: what waits, and the two ways on. Shown on every managed page, since the switch covers all of them. */
function syncOffBand(): HTMLElement | null {
  if (!state.home || state.home.syncOn) return null;
  const waiting = committedList().filter(skill => skill.managed && skill.edited?.length);
  const what = waiting.slice(0, 3).flatMap((skill, index) => [index ? ', ' : '', h('strong.item-name', {}, skill.name ?? skill.key), `, edited in ${andList((skill.edited ?? []).map(tool => names[tool]))}`]).concat(waiting.length > 3 ? [` and ${waiting.length - 3} more`] : []);
  // Right after a sync, its notice says what spread; the idle banner comes back once that is dismissed.
  if (!waiting.length && visibleNotices().length) return null;
  return h('div.band.band-sync-off', { role: 'status' }, icon('circle-minus', 14, waiting.length ? 'tone-warning' : 'tone-muted'),
    h('span.band-text', {}, ...(waiting.length ? [`Automatic sync is off. ${waiting.length} ${waiting.length === 1 ? 'change' : 'changes'} waiting: `, ...what, '.'] : ['Automatic sync is off. Edits and deletions in your tools will wait here.'])),
    waiting.length ? button({ variant: 'outline', size: 'small', label: 'Sync once', id: 'sync-now', attrs: { title: 'Copy the waiting change once; automatic sync stays off' }, onclick: () => void syncNow() }) : null,
    (() => { const on = smallAction('Turn sync on', 'sync-turn-on', () => void setSync(true)); on.title = 'Copy waiting changes now and keep syncing from here on'; return on; })());
}

/** First use of a page: one line on what the switch does, and where each tool's own controls are. */
function helpBand(): HTMLElement | null {
  const list = committedList();
  // Shown until dismissed, so it does not come and go as rows change.
  const key = `ck-help-dismissed-${kind}`;
  if (!list.length || readFlag(key) || state.skillsView === 'files') return null;
  const one = kindNouns[kind].a, words = library()?.words;
  const first = words
    ? `Turn ${words.an} on and every tool has it, kept the same. Turn it off and no tool has it: Central Knot keeps it, with its versions, and puts each ${words.copy} back when you turn it on.`
    : `Turn ${one} on and every tool has it, kept the same; turn it off and no tool ${kind === 'mcp' ? 'starts' : 'loads'} it. Each click applies at once, with Undo.`;
  const second = words ? `A switch halfway is ${words.an} a tool has that Central Knot doesn’t yet: turning it on takes it in. Open ${words.an} for its versions.`
    : `A switch halfway means not synced yet: each tool keeps its own copy. Open ${one} for each tool’s own switch.`;
  return h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'),
    h('span.band-text.band-lines', {}, h('span', {}, first), h('span.tone-muted', {}, second)),
    closeButton(() => { writeFlag(key); rerender(); }, { id: 'help-dismiss', label: 'Hide this tip' }));
}

/**
 * What the background passes copied where it was missing, and where: shown on the Harnesses list until dismissed (it comes back
 * only for a different catch-up). `told`: the notices that already say an item's change. Null once dismissed.
 */
export function caughtUpBand(sync: SyncView, told: SyncNotice[]): HTMLElement | null {
  const items = caughtUpNames(sync, new Set(told.map(notice => notice.item)));
  const key = `caught-up:${items.join(',')}`;
  if (!items.length || state.dismissed.has(key)) return null;
  const tools = [...new Set(sync.caughtUp.filter(result => items.includes(result.item) && result.outcome === 'written' && result.harness).map(result => names[result.harness!]))];
  return h('div.band', { role: 'status' }, icon('check', 14, 'tone-success'),
    h('span.band-text', {}, `Caught up: copied ${items.length > 4 ? `${items.slice(0, 4).join(', ')} and ${items.length - 4} more` : andList(items)} to ${tools.length ? andList(tools) : 'the tools that were missing them'}, because ${items.length === 1 ? 'it is' : 'they are'} on.`),
    closeButton(() => { state.dismissed.add(key); rerender(); }, { id: 'caught-up-dismiss' }));
}

/**
 * MCP servers waiting for Claude Code's own Write step, not already told by a notice: the same inset amber notice as a
 * waiting edit, so Write has one look wherever the step waits. `all` is every waiting server, which Write writes.
 */
function writeStepBand(rest: string[], all: string[]) {
  const missing = rest.filter(name => committedList().find(skill => skill.key === name)?.copies['claude-cli'] === undefined);
  const older = rest.filter(name => !missing.includes(name));
  const servers = (names: string[]) => (names.length === 1 ? 'server' : 'servers');
  // Each server said as what Claude Code has of it: an older copy, or none yet ("…an older copy of the files server and doesn't have search yet.").
  const what = !older.length ? ['Claude Code doesn’t have the ', ...nameList(missing), ` ${servers(missing)} yet.`]
    : [`Claude Code has ${older.length === 1 ? 'an older copy' : 'older copies'} of the `, ...nameList(older), ` ${servers(older)}`, ...(missing.length ? [' and doesn’t have ', ...nameList(missing), ' yet.'] : ['.'])];
  const quitFirst = state.home?.mode === 'fixture' ? h('span.band-why', {}, ' On your real tools, quit Claude Code first.') : ' Quit Claude Code first; it rewrites its settings file while open.';
  const write = button({ variant: 'primary', size: 'small', label: 'Write to Claude Code', id: 'mcp-write-claude', onclick: () => void writeClaudeNow(all),
    attrs: { title: 'Claude Code rewrites ~/.claude.json while it is open, so Central Knot writes it only when Claude Code is closed.' } });
  return h('div.band.sync-notices.band-write-now', { role: 'status' }, h('div.sync-notice-lines', {},
    h('p.sync-notice.notice-stacked.notice-inline', { 'data-kind': 'write' }, icon('clock', 14, 'tone-warning'),
      h('span.notice-text', {}, ...what, quitFirst), h('span.notice-actions', {}, write))));
}

/**
 * Another build syncs this home (ORG-08): who, whether it is open now, and Take over syncing. Only one build syncs a home
 * at a time; this one changes no skill, MCP server or agent here until it is told to take over.
 */
function otherOwnerBand(): HTMLElement | null {
  const gate = state.home?.sync.gate;
  if (gate?.state !== 'stopped' || !gate.owner) return null;
  const take = button({ variant: 'outline', size: 'small', label: 'Take over syncing', id: 'take-over-sync', disabled: !!state.busy || !state.home!.sync.access.allowed, onclick: () => void takeOverSync() });
  take.title = takeOverTitle(gate.owner);
  return h('div.band', { role: 'status', id: 'other-owner' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, otherOwnerSaid(gate.owner)), take);
}

/** The bands of a page whose items aren't skills: MCP servers, or a library kind's. */
function listNotices() {
  const mcp = listView()!;
  const bands: HTMLElement[] = [];
  for (const band of [syncOffBand(), outcomeBand()]) if (band) bands.push(band);
  if (!mcp.access.allowed) bands.push(h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, mcp.access.reason)));
  const owned = otherOwnerBand();
  if (owned) bands.push(owned);
  // A record that stops every write (damaged, newer, another generation): said once, unless a problem below says it already.
  else if (mcp.gate.state === 'stopped' && !mcp.problems.includes(mcp.gate.reason)) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, mcp.gate.reason)));
  const resume = resumeBand();
  if (resume) bands.push(resume);
  for (const problem of mcp.problems) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), h('span.band-text', {}, problem)));
  const unread = unreadBand();
  if (unread) bands.push(unread);
  const result = lastResult(kind);
  // What a background pass could not do (any kind's), until the next click's result is said instead.
  const background = result ? [] : (state.home?.sync.caughtUp ?? []).filter(entry => entry.outcome !== 'written' && entry.outcome !== 'removed');
  if (background.length) bands.push(problemsBand(background));
  const told = toldNotices();
  const shownNotices = told.filter(notice => !state.dismissed.has(notice.history || notice.item));
  const pendingClaude = 'claudePending' in mcp ? mcp.claudePending : [];
  // An earlier result's Undo that stepped aside for this notice: one faint closing line inside the notice, not a band of its own.
  const moved = state.undoMoved?.page === state.page && !state.outcome && shownNotices.some(notice => state.undoMoved!.notices.includes(notice.history || notice.item))
    ? h('span.notice-tail.tone-faint', { id: 'undo-moved' }, ...movedUndoText(state.undoMoved!.label, state.undoMoved!.items), h('button.inline-link', { type: 'button', id: 'notice-undo-moved', onclick: () => showPage('history') }, 'History'), '.') : null;
  if (shownNotices.length) {
    const lines = shownNotices.slice(0, 6).map(notice => syncNotice(notice, pendingClaude.includes(notice.item) ? () => void writeClaudeNow(pendingClaude) : undefined));
    if (moved) {
      const link = lines.at(-1)!.querySelector<HTMLElement>('[id^="notice-history-"]');
      if (link) link.title = `${moved.textContent?.replace(/^Earlier: the undo/, 'The earlier undo').replace(/ is in History\.$/, ' is here too')}.`;
      else lines.at(-1)!.append(moved);
    }
    bands.push(h('div.band.sync-notices', { role: 'status' }, h('div.sync-notice-lines', {}, lines), dismissNotices(shownNotices)));
  }
  // Claude Code rewrites ~/.claude.json while it runs, so its entries wait for an explicit write with Claude closed (MCP-02).
  const toldHere = new Set(shownNotices.map(notice => notice.item));
  const rest = pendingClaude.filter(name => !toldHere.has(name));
  if (rest.length) bands.push(writeStepBand(rest, pendingClaude));
  if (result?.stopped) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, result.stopped)));
  // A click's refusal is its result, said once, in the result's band (app.ts applyClick leaves it out of these).
  const problems = (result?.results ?? []).filter(result => result.outcome === 'failed' || (result.outcome === 'held' && !result.differs && !result.waits));
  if (problems.length) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · '))));
  const tip = helpBand();
  if (tip) bands.push(tip);
  return bands.length ? h('div.bands', {}, bands) : null;
}

/** The record is intact but this app has no memory of it: Resume carries on from it (any switch does too). */
function resumeBand(): HTMLElement | null {
  const gate = state.home?.sync.gate;
  if (gate?.state !== 'needs-resume') return null;
  return h('div.band', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, gate.reason),
    button({ variant: 'outline', size: 'small', label: 'Resume', id: 'resume', disabled: !canWrite(), onclick: () => void applyClick({ kind, changes: [], items: [], said: 'Resumed: sync carries on from the record as it is.' }) }));
}

/** The bands above a table: every item page reads its kind's view (listView), a library kind's or MCP servers'. */
const notices = () => (state.home && listView() ? listNotices() : null);

/** What a table keeps belongs to one home: opening another starts with no open row and none of the last home's notices. */
const tableHomes: Partial<Record<PageKind, string>> = {};
function forgetOtherHomes() {
  if (state.home?.home === tableHomes[kind]) return;
  view.comparing = undefined;
  tableHomes[kind] = state.home?.home;
  keptNotices.delete(kind);
  foldedNotices.delete(kind);
}

// ---------- See change: what an edit did, before Undo ----------
const changes = new Map<string, { before: string; after: string } | null>();
const openChanges = new Set<string>();

/** A quiet link that opens the edit's before and after under the notice or History row. Skills only: their store keeps SKILL.md. */
export function seeChangeLink(eventId: string, key: string, asLink = false) {
  if (!eventId || key.includes(':') || changes.get(eventId) === null) return null;
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

/** Notices stay until read: each read brings only what is new, so the page keeps earlier ones until × or Undo, or another home. */
/** A notice as told: `once`, said while sync was off; `seq`, when it was first said (state.said.seq). */
type Told = SyncNotice & { once?: boolean; seq: number };
const keptNotices = new Map<PageKind, Map<string, Told>>();
/** Notices folded into History by a newer one: never shown again, though the read still lists them. */
const foldedNotices = new Map<PageKind, Set<string>>();
const keptSync = new Map<PageKind, boolean>();
function toldNotices(): Told[] {
  if (!state.home) return [];
  // What the table's view says sync did, and what its last click's result does.
  const fresh = [...(listView()?.notices ?? []), ...(lastResult(kind)?.notices ?? [])];
  let kept = keptNotices.get(kind);
  if (!kept) keptNotices.set(kind, kept = new Map());
  let folded = foldedNotices.get(kind);
  if (!folded) foldedNotices.set(kind, folded = new Set());
  const keyOf = (notice: SyncNotice) => notice.history || notice.item;
  // A newer event, or a newer click's result, folds what was said before into History, where it stays with its Undo: notices never
  // pile up. Turning sync on or off retires the ones it no longer lists.
  const news = fresh.filter(notice => !kept!.has(keyOf(notice)) && !folded!.has(keyOf(notice)));
  const clicked = state.outcome?.band && state.outcome.page === state.page ? state.outcome.said ?? 0 : 0;
  for (const [key, notice] of [...kept]) if (news.length || notice.seq < clicked) { folded.add(key); kept.delete(key); }
  if (keptSync.get(kind) !== state.home.syncOn) for (const key of [...kept.keys()]) if (!fresh.some(notice => keyOf(notice) === key)) kept.delete(key);
  keptSync.set(kind, state.home.syncOn);
  // The wording is fixed when the notice first shows: a Sync once stays "Synced once" after sync is turned on.
  for (const notice of fresh) { const key = keyOf(notice); if (!kept.has(key) && !folded.has(key)) kept.set(key, { ...notice, once: !state.home.syncOn, seq: state.said.seq }); }
  for (const key of [...kept.keys()]) if (state.dismissed.has(key)) kept.delete(key);
  return [...kept.values()].reverse();
}

function visibleNotices() {
  if (!state.home) return [];
  const told = toldNotices();
  return told.filter(notice => !state.dismissed.has(notice.history || notice.item));
}

/** Notices stay until read; a quiet × clears them. */
// Each notice has its own ×; with three or more, one more control dismisses them all.
const dismissNotices = (list: SyncNotice[]) => list.length < 3 ? null : smallAction('Dismiss all', 'notices-dismiss', () => { for (const notice of list) state.dismissed.add(notice.history || notice.item); rerender(); });

/** When Central Knot first showed each notice, so a notice left up says how old it is. */
const firstShown = new Map<string, number>();
/** Rows a notice just told about, so they can show a brief highlight. */
const flashed = new Map<string, number>();
/** A row flashes on the first draw after its notice, once; later redraws leave it calm. */
const takeFlash = (key: string) => {
  if (flashRequests.delete(key)) return true;
  const at = flashed.get(key); if (at === undefined) return false; flashed.delete(key); return Date.now() - at < 3000;
};
const age = (key: string) => {
  if (!firstShown.has(key)) firstShown.set(key, Date.now());
  const minutes = Math.floor((Date.now() - firstShown.get(key)!) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
};

type NoticeLook = [IconName, string, string, HTMLElement | null];
type NoticeLooks = Record<SyncNotice['kind'], NoticeLook>;

/** A library item's notice (libraryrow.ts noticeWords), with its button: Undo, or Turn on after a copy deleted by hand turned it off. */
function libraryNotice(lib: LibraryPage, notice: Told, undo: (title: string) => HTMLElement): NoticeLook {
  const { text, action, help } = lib.say.noticeWords(notice);
  if (action === 'undo') return [notice.kind === 'conflict' ? 'diff' : 'check', notice.kind === 'conflict' ? 'tone-warning' : 'tone-success', text, undo(help)];
  const on = button({ variant: 'outline', size: 'small', label: 'Turn on', id: `notice-restore-${notice.history}`, onclick: () => void restoreEvent(notice.history) });
  on.title = help;
  return ['trash-2', 'tone-muted', text, on];
}

function syncNotice(notice: Told, writeClaude?: () => void) {
  const who = toolName, list = (tools: string[]) => andList(tools.map(toolName));
  const order = notice.orderProved ? '' : ' The order could not be proved, so the fixed tool order decided.';
  // The button names the tools it changes: all of them, or only those the event touched.
  const involved = [...new Set([notice.winner, ...notice.losers].filter(Boolean))] as string[];
  const scope = `in ${toolsPhrase(involved, toolList())}`;
  // Undo is the one action here that writes files: a small outlined button, apart from the quieter links.
  // A library item's notice says "Undo", as every strip's result does; its tooltip says where. MCP servers' name their scope.
  const undoLabel = library() ? 'Undo' : `Undo ${writeClaude || notice.kind === 'edit' ? 'edit ' : ''}${scope}`;
  const undo = (title: string) => { const action = button({ variant: 'outline', size: 'small', label: undoLabel, id: `notice-undo-${notice.history}`, onclick: () => void restoreEvent(notice.history) }); action.title = title; action.setAttribute('aria-label', `Undo: ${title}`); return action; };
  const offNow = notice.once ?? (!!state.home && !state.home.syncOn);
  const lib = library();
  const [glyph, tone, text, action] = lib ? libraryNotice(lib, notice, undo) : ({
    edit: ['check', 'tone-success', offNow ? `${notice.item} copied from ${who(notice.winner)} to ${list(notice.losers)}.` : `${notice.item} was edited in ${who(notice.winner)} and copied to ${list(notice.losers)}.`, undo(`Put ${notice.item} back as it was before ${who(notice.winner)}’s edit, in every tool it syncs to (${who(notice.winner)} too)`)],
    conflict: ['diff', 'tone-warning', `${notice.item}: ${who(notice.winner)}’s edit won over ${list(notice.losers)}’s.${order}`, undo(`Use ${list(notice.losers)}’s version of ${notice.item} instead, in every tool it syncs to`)],
    deleted: ['trash-2', 'tone-muted', `${notice.item} was deleted in ${who(notice.winner)}, so it was removed from ${list(notice.losers) || 'nowhere else'} too.`, button({ variant: 'outline', size: 'small', label: `Restore ${scope}`, id: `notice-restore-${notice.history}`, onclick: () => void restoreEvent(notice.history) })],
    'kept-edit': ['diff', 'tone-warning', `${notice.item}: ${who(notice.winner)}’s edit was kept over its deletion in ${list(notice.losers)}.${order}`, null],
    reset: ['triangle-alert', 'tone-warning', `${who(notice.winner)}’s settings file lost every managed server at once, so Central Knot put them back instead of deleting them everywhere. To delete one, remove it in one tool while the others still have it.`, null],
  } as NoticeLooks)[notice.kind];
  // The item's name opens its row here, so "what changed" is one click from the change itself.
  const rowKey = committedList().find(skill => skill.name === notice.item || skill.key === notice.item.toLowerCase())?.key;
  const noticeKey = notice.history || `${notice.kind}:${notice.item}`;
  state.seenNotices.add(notice.history || notice.item);
  if (rowKey && !firstShown.has(noticeKey)) flashed.set(rowKey, Date.now());
  // The item's name opens its row: one click from "what changed" to the item, with no separate Details link.
  const name = rowKey && view.comparing !== rowKey
    ? h('button.item-name.notice-name', { type: 'button', id: `notice-open-${notice.history || notice.item}`, title: `Show ${notice.item}’s details`, onclick: (event: Event) => { event.stopPropagation(); view.comparing = undefined; openRow(rowKey); } }, notice.item)
    : h('strong.item-name', {}, notice.item);
  const said = notice.item && text.startsWith(notice.item) ? [name, text.slice(notice.item.length)] : [text];
  // With sync off, a notice can only come from Sync now: say sync stays off, and offer to turn it on.
  const off = state.home && !state.home.syncOn && notice.kind !== 'reset';
  const history = !off && (notice.kind === 'deleted' || notice.kind === 'edit' || notice.kind === 'conflict') ? smallAction('History', `notice-history-${notice.history}`, () => showPage('history')) : null;
  // MCP: an edit Claude Code still lacks is one band with its write step, in the waiting tone.
  const quiet = off;
  // Waiting for Claude Code: the sentence takes the full width, and the actions sit on their own line, Write first.
  return h(`p.sync-notice${writeClaude ? '.notice-stacked' : ''}`, { 'data-kind': notice.kind }, icon(writeClaude ? 'clock' : glyph, 14, writeClaude ? 'tone-warning' : tone),
    h('span.notice-text', {}, offNow && notice.kind !== 'deleted' && notice.kind !== 'reset' ? 'Synced once: ' : '', ...said.map(part => typeof part === 'string' && !/\.\s/.test(part) ? part.replace(/\.$/, '') : part), '', h('span.notice-age', {}, ` · ${age(notice.history || `${notice.kind}:${notice.item}`)}`)),
    writeClaude ? (() => {
      const row = committedList().find(skill => skill.name === notice.item || skill.key === notice.item);
      const before = row?.versions?.['claude-cli']?.text, after = row?.versions?.[notice.winner as Tool]?.text;
      if (!before || !after || before === after) return null;
      const bare = (summary: string) => summary.replace(/^[^·]+·\s*/, '');
      const field = /^Command/.test(after) ? 'command' : 'URL';
      // The field is named once, above the pair; short tool labels keep the old and new values side by side.
      return h('span.notice-change', {},
        h('span.notice-change-caption', {}, field === 'URL' ? 'URL' : 'Command'),
        // Words that differ are marked: struck in Claude Code's entry, tinted in the new one.
        h('span.tone-faint', {}, 'Claude Code (older)'), h('code', {}, ...markedWords(bare(before), bare(after), 'removed')),
        h('span.tone-faint', {}, `${[notice.winner, ...notice.losers].map(who).join(', ')} (new)`), h('code.notice-change-new', {}, ...markedWords(bare(before), bare(after), 'added')));
    })() : null,
    h('span.notice-actions', {},
      writeClaude ? button({ variant: 'primary', size: 'small', label: 'Write to Claude Code', id: 'mcp-write-claude', onclick: writeClaude }) : null,
      notice.kind === 'edit' || notice.kind === 'conflict' ? seeChangeLink(notice.history, notice.key) : null,
      action, history, quiet ? smallAction('Turn sync on', `notice-sync-on-${notice.history || notice.item}`, () => void setSync(true)) : null,
      writeClaude ? h('span.band-why.notice-quit', {}, state.home?.mode === 'fixture' ? 'On your real tools, quit Claude Code first.' : 'Quit Claude Code first.') : null),
    closeButton(event => { event.stopPropagation(); state.dismissed.add(notice.history || notice.item); rerender(); }, { id: `notice-dismiss-${notice.history || notice.item}`, label: `Dismiss this notice about ${notice.item || 'the reset'}`, title: 'Dismiss', look: '.notice-dismiss' }),
    notice.history ? changePanel(notice.history) : null);
}

/**
 * Every way into a table starts here: which kind it shows, and the harness whose page it is on (none on the Skills, MCP
 * servers and Agents pages), then drops what belonged to another home. A Copies differ filter whose chip is not drawn
 * (this harness has nothing that differs) goes back to All, so the table is never empty with no chip pressed.
 */
function useTable(which: PageKind, harness?: Tool) {
  // An armed Delete belongs to the visit it was clicked on: another page disarms it.
  if (state.visit !== tablesVisit) { for (const each of Object.values(views)) each.confirmDelete = undefined; tablesVisit = state.visit; }
  kind = which;
  view = views[which];
  focus = harness;
  forgetOtherHomes();
  if (view.shownFor !== harness) startFresh(view, harness);
  if (view.filter === 'attention' && !copiesDifferChipShown()) view.filter = 'all';
  if (view.filter === 'plugins' && !pluginChipShown()) view.filter = 'all';
}

/** How many rows here are a plugin's (its own rows, and the person's own items that are a plugin's part or come through one): the From plugins chip's count. */
const pluginCount = () => plugged().rows.filter(row => !focus || row.copies[focus as HarnessId]).length + committedList().filter(skill => inFocus(skill) && fromAPlugin(skill)).length;
/** Whether the From plugins chip is drawn: some row here is a plugin's. */
const pluginChipShown = () => plugged().rows.some(row => !focus || row.copies[focus as HarnessId]) || committedList().some(skill => inFocus(skill) && fromAPlugin(skill));

/** Whether the Copies differ chip is drawn: something here differs. A Copies differ filter whose chip is gone falls back to All. */
const copiesDifferChipShown = () => committedList().some(needsChoice);

/** A skill's files and contents: the Skills page's files view, from wherever its details were opened. */
function openFiles(key: string) {
  if (state.page !== 'skills') showPage('skills');
  state.skillsView = 'files';
  state.item = key;
  rerender();
}

/** A kind with nothing in any tool, on a harness's page: the empty state under the same bands (problems, access, results) as its table. */
export function emptyKind(which: PageKind, harness: Tool, empty: HTMLElement) {
  useTable(which, harness);
  return h('div.page', {}, notices(), empty);
}

/**
 * One kind's page: its toolbar, bands and table. `harness`: the Harnesses page's view of one tool: its column first, and the
 * rows it doesn't have under their own heading.
 */
export function itemsTable(which: PageKind, harness?: Tool) {
  useTable(which, harness);
  const all = rows();
  const needle = view.find.trim().toLowerCase();
  const shown = all.filter(skill => (view.filter === 'all' || (view.filter === 'plugins' ? fromAPlugin(skill) : needsChoice(skill)))
    && (!needle || skill.key.includes(needle) || skill.description.toLowerCase().includes(needle)));
  // A plugin's items follow Find and the chips: shown with All and From plugins, on a harness's page where it has them.
  const plugins = plugged().rows.filter(row => (view.filter === 'all' || view.filter === 'plugins') && (!focus || row.copies[focus as HarnessId])
    && (!needle || row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle)));
  const find = findInput({ id: 'find', label: 'Find', value: view.find, onInput: text => { view.find = text; rerender(); } });
  // A copy question doesn't outlive the visit: back on the page, its row is closed.
  if (view.comparing && view.openedOn !== state.visit && all.some(skill => skill.key === view.comparing && isDiffering(skill))) view.comparing = undefined;
  const open = docked() && view.comparing && !underRow(view.comparing) ? all.find(skill => skill.key === view.comparing) : undefined;
  const openRow = docked() && !open ? plugins.find(row => row.key === view.comparing) : undefined;
  // Off goes last, under its own heading. Of the rest, the rows a harness's page is about (it has a copy) split into On and
  // Not synced; the others, only other tools have.
  const idle = shown.filter(skill => placeOf(skill) === 2), used = shown.filter(skill => placeOf(skill) !== 2);
  const here = used.filter(inFocus), away = used.filter(skill => !inFocus(skill));
  const sections = [section('on', here.filter(skill => placeOf(skill) === 0)), section('not-synced', here.filter(skill => placeOf(skill) === 1)), pluginSection(plugins),
    focus ? section('away', away) : null, section('off', idle)];
  const table = [
    h('div.toolbar.fit-bar', {}, h('div.find', {}, icon('search', 16, 'find-glyph'), find), filterBar(), h('div.toolbar-end', {}, toolbarState())),
    notices(),
    // A stable id per kind (and per harness), so a redraw (the dock's breakpoint crossed, say) keeps the table where it was
    // scrolled, and another harness's table opens at its own top.
    h('div.scroll.matrix', { id: `table-${kind}${focus ? `-${focus}` : ''}` },
      // No column heads: each row's switch comes first, and its marks name their tools.
      withToolCount(h('div.ov.ov-switched', { role: 'table', 'aria-label': `${nouns[kind][1]} and where they are on` }, sections), toolList().length),
      markLegend(all, plugins))];
  if (openRow) return h('div.page.ov-page.docked', {}, h('div.dock-main', {}, table), pluginDock(openRow));
  // A library item's details hold its versions: its dock takes a share of the width that grows with the window (style.css .dock-wide).
  return open ? h(`div.page.ov-page.docked${library() ? '.dock-wide' : ''}`, {}, h('div.dock-main', {}, table), itemDock(open))
    : h('div.page.ov-page', {}, table);
}



// ---------- One switch per item ----------

/** A tool that has no copy yet, and gets one when sync runs next. */
const NEXT_SYNC = 'Gets a copy when sync runs next';
const nameOf = (skill: ItemRow) => skill.name ?? skill.key;
/** The tools with a copy of it: their own, or one they read in another tool's folder. */
const holders = (skill: ItemRow) => toolList().filter(tool => skill.copies[tool] !== undefined);
const getsCopy = (skill: ItemRow, tool: Tool) => getsCopyNext(skill, tool, toolList());
/** What a tool does with an item it has on: loads a skill or an agent, starts an MCP server. */
const uses = () => (kind === 'mcp' ? 'start' : 'load');

/** "today", "yesterday", "3 days ago": when something happened, for an item's status. */
const daysAgo = (iso: string) => { const days = Math.floor((Date.now() - Date.parse(iso)) / DAY_MS); return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`; };

/** The item as it is now, for a change that keeps how it syncs and only flips switches or removes a copy. */
const asItIs = (skill: ItemRow) => ({ key: skill.key, managed: skill.managed, off: skill.off as HarnessId[], seenManaged: skill.managed });

/**
 * Before a click changes anything, every row's place is kept, so nothing moves under the pointer: rows stay where they are
 * (their look follows) only while the person is still at them, the pointer over the list or keyboard focus in the row they
 * changed (`key`). Once neither holds, or the page is left, read again or an Undo runs, the list regroups and its headings
 * count again (regroupIfLeft).
 */
const pinRows = (key?: string) => {
  if (!pointerInList && !(keyboard && focusIn(key))) { view.pinned = undefined; return; }
  if (view.pinned?.at !== pinKey()) view.pinned = { at: pinKey(), places: new Map(committedList().map(skill => [skill.key, standingOf(skill)])), key };
};

/** Whether the person last used the keyboard (not a pointer): only then does focus in a changed row keep the rows still. */
let keyboard = false;
/** Whether the pointer is over a list of items (the table, or the Files view's list). */
let pointerInList = false;
const inList = (node: EventTarget | null) => node instanceof Element && !!node.closest('.ov, #skills-list');
/** Whether keyboard focus is in an item's row, its details under it, or its line in the Files view's list. */
const focusIn = (key: string | undefined) => {
  const at = document.activeElement;
  return !!key && !!at && !!(at.closest(`[data-key="${CSS.escape(key)}"]`) || at.closest(`[aria-label="Details for ${CSS.escape(key)}"]`));
};
/** Regroups the rows once the person has left them: the pointer is off the list and keyboard focus is not in the changed row. */
function regroupIfLeft() {
  if (!view.pinned || view.pinned.at !== pinKey() || pointerInList || (keyboard && focusIn(view.pinned.key))) return;
  view.pinned = undefined;
  rerender();
}
document.addEventListener('keydown', () => { keyboard = true; }, true);
document.addEventListener('pointerdown', () => { keyboard = false; }, true);
// Moves only: a list that shifts under a still pointer (a band appearing above it) is not the person leaving it.
document.addEventListener('pointermove', event => { pointerInList = inList(event.target); if (!pointerInList) regroupIfLeft(); }, true);
document.addEventListener('pointerout', event => { if (!(event as PointerEvent).relatedTarget) { pointerInList = false; regroupIfLeft(); } }, true);
document.addEventListener('focusin', () => regroupIfLeft(), true);

/** A click on this page: rows keep their places first. */
const click = (what: Click) => { pinRows(what.changes[0]?.key); void applyClick(what); };

/**
 * Turns it off in every tool it is on in, each with its own switch: the copies stay (a synced one keeps syncing), and no tool
 * uses it. A tool whose switch can't be used is left on, and the result says why. A library item has no such switch: it
 * leaves every harness, and Central Knot keeps it (library.ts).
 */
function turnOff(skill: ItemRow) {
  const name = nameOf(skill), lib = library();
  const plugins = turnEvery(throughItems(skill), false);
  pinRows(skill.key);
  // Where its plugin's item turned off too, said from what happened.
  const pluginsOff = (notIn: HarnessId[]) => plugins.turned.map(item => item.tool).filter(tool => !notIn.includes(tool));
  if (lib) {
    const pluginSaid = (notIn: HarnessId[]) => { const off = pluginsOff(notIn); return off.length ? ` Its plugin’s copy is off in ${toolsPhrase(off, toolList())}.` : ''; };
    mainClick(name, false, [rowClicks.off(skill, itemOf(skill))], plugins, notIn => `${lib.say.said.off(name, notIn, toolList())}${pluginSaid(notIn)}`, plugins.left);
    return;
  }
  const { disable, held } = offPlan(skill, toolList());
  const also = [stillOn(skill, held, tool => names[tool as Tool], problem => problemText(problem, shownPath)), plugins.left].filter(Boolean).join(' ') || undefined;
  if (!disable.length && !plugins.ops.length) { nothingChanged(name, plugins, false, also); return; }
  // Said from what happened: a tool whose switch couldn't be written is not called off.
  const said = (notIn: HarnessId[]) => {
    const off = [...disable.filter(tool => !notIn.includes(tool as HarnessId)), ...pluginsOff(notIn)];
    return off.length ? `${name} is off in ${toolsPhrase(off, toolList())}.${kind === 'mcp' ? ' Its entries are kept.' : ''}` : `${name} couldn’t be turned off.`;
  };
  mainClick(name, false, disable.length ? [{ ...asItIs(skill), disable: disable as HarnessId[] }] : [], plugins, said, also);
}

/**
 * The change that turns it on everywhere: synced to every tool Central Knot manages, none left out, and on in each. `use`: the
 * copy every tool takes where copies differ. A skill with a link or shared copy is taken over as it is turned on (OWN-02).
 * A library item: its library's On (libraryrow.ts), which takes a found one in.
 */
function onChange(skill: ItemRow, use?: Tool): Change {
  if (library()) return rowClicks.on(skill, itemOf(skill), use);
  const enable = toolList().filter(tool => skill.disabled?.includes(tool) && !skill.switchProblem?.[tool]);
  return { key: skill.key, managed: true, off: [], seenManaged: skill.managed, ...(enable.length ? { enable: enable as HarnessId[] } : {}), ...(use ? { use: use as HarnessId, useHash: skill.hashes?.[use] } : {}) };
}

/** MCP: Claude Code's copy waits for its own Write step, as it should: said as a plain note, never as a warning. */
const CLAUDE_LATER = 'Claude Code gets it when you click Write to Claude Code.';

/** Every tool that can have it: where it is on once it is on everywhere. */
const canHave = (skill: ItemRow) => toolList().filter(tool => !skill.cannot?.[tool] || throughPluginHere(skill, tool));
/** Where it is on once it is on everywhere, but `left`: tools it stays off in (a plugin's with no switch for one item, a write that failed). */
const onPhrase = (skill: ItemRow, left: readonly string[] = []) => toolsPhrase(canHave(skill).filter(tool => !left.includes(tool)), toolList());

/** Turns it on everywhere: synced to every tool Central Knot manages and on in each. `use`: the copy every tool takes where copies differ. */
function turnOn(skill: ItemRow, use?: Tool) {
  const name = nameOf(skill);
  const to = canHave(skill);
  const later = kind === 'mcp' && to.includes('claude-cli') && skill.copies['claude-cli'] !== skill.copies[use ?? toolList().find(tool => tool !== 'claude-cli' && skill.copies[tool] !== undefined) ?? 'claude-cli'];
  const plugins = turnEvery(throughItems(skill), true);
  pinRows(skill.key);
  // Said from what happened: a tool whose copy couldn't be written is not called on, nor Claude Code while it waits for Write.
  // An item a harness has that Central Knot's library doesn't yet is taken in by this click.
  const lib = library(), found = !!lib && !inLibrary(itemOf(skill));
  const said = (notIn: HarnessId[]) => {
    const left = [...plugins.leftIn, ...notIn, ...(later ? ['claude-cli'] : []), ...(lib ? skill.off : [])];
    const using = canHave(skill).filter(tool => !left.includes(tool));
    // A tool that has it another way gets nothing of Central Knot's: said apart, never as on (a plugin's item is on through it).
    const another = using.filter(tool => skill.anotherWay?.[tool] && skill.copies[tool] === undefined && !throughPluginHere(skill, tool));
    if (lib && found) return lib.say.said.takenIn(name, using.filter(tool => !another.includes(tool)), toolList(), use, another);
    return use && using.length ? `${capitalToolsPhrase(using, toolList())} now ${using.length === 1 ? 'uses' : 'use'} ${names[use]}’s copy of ${name}. Replaced copies are kept in History.` : `${name} is on in ${onPhrase(skill, left)}.`;
  };
  mainClick(name, true, [onChange(skill, use)], plugins, said, plugins.left, later ? CLAUDE_LATER : undefined);
}

// ---------- Items tools have through a plugin ----------

/** The items a person's own row has through a plugin: in each tool with no copy of its own that has it through an installed plugin. */
const throughItems = (skill: ItemRow): PluginItemAt[] => toolList().flatMap(tool => { const item = itemThrough(skill, tool); return item ? [item] : []; });
/** The items a plugin's row stands for: one in each tool that has it through the plugin. */
const rowItems = (row: PluginRow): PluginItemAt[] => pluginTools(row).flatMap(tool => (row.installs[tool] ? [{ kind: row.kind, name: row.name, tool, install: row.installs[tool]! }] : []));

/**
 * One click of a main switch: the item's own copies' `changes` with its switches in the tools that have it through a plugin,
 * applied as one click with one Undo (app.ts applyClick); or, with no copy to change, the plugins' part alone. `said`: what it
 * did, given the tools where it didn't. Said after it, what it left as it is: `also`, a problem; `note`, what is still to come;
 * the tools with no switch for one item of a plugin (pluginswitch.ts turnEvery), plainly, with the whole plugin's switch there
 * offered beside the Undo.
 */
function mainClick(name: string, on: boolean, changes: Change[], plugins: ReturnType<typeof turnEvery>, said: (notIn: HarnessId[]) => string, also?: string, note?: string) {
  // Said as "there" when the result is about that one tool, as after a tool's own switch; else by the tool's name.
  const there = !changes.length && new Set(plugins.turned.map(item => item.tool)).size === 1;
  const along = plugins.turned.map(item => alongWords(item, plugins.ops, there)).filter(Boolean).join(' ') || undefined;
  const next = wholePluginAct(name, plugins.whole, on);
  if (changes.length) { void applyClick({ kind, items: [name], changes, said, also, note: [note, plugins.limit].filter(Boolean).join(' ') || undefined, next, plugins: plugins.ops.length ? { ops: plugins.ops, draft: plugins.draft, said: along } : undefined }); return; }
  const where = toolsPhrase(plugins.turned.map(item => item.tool), toolList());
  void applyPluginSwitches(plugins.ops, plugins.draft, { also, note: plugins.limit, next, said: [said([]), along].filter(Boolean).join(' '), undone: undoneWords(name, on, where) });
}

/** A plugin item's Undo, in one form on every page: what the click did, turned back ("Undone: triage is back on in Codex."). */
const undoneWords = (name: string, on: boolean, where: string) => (on ? `Undone: ${name} is off in ${where} again.` : `Undone: ${name} is back on in ${where}.`);

/** The whole plugin's switch in the tools that have no switch for one of its items (`whole`), as a result's second button. */
function wholePluginAct(name: string, whole: PluginItemAt[], on: boolean) {
  if (!whole.length) return undefined;
  const plugin = [...new Set(whole.map(item => item.install.plugin))];
  const where = toolsPhrase(whole.map(item => item.tool), toolList());
  return { label: `Turn ${plugin.length === 1 ? plugin[0] : 'its plugins'} ${on ? 'on' : 'off'} in ${where}`, id: 'outcome-whole', title: 'Turn the whole plugin there, with everything it brings; Undo turns it back', run: () => {
    const draft: PluginDraft = new Map();
    for (const item of whole) clickPluginItem(draft, item);
    const ops = [...draft.values()];
    void applyPluginSwitches(ops, draft, { said: whole.map(item => itemSaid(item, on, ops)).join(' '), undone: undoneWords(name, on, where) });
  } };
}

/**
 * A main switch's click that changes nothing: every tool it is still on (or off) in has no switch for one item of a plugin, or
 * one that can't be written. Said plainly, naming the item; where a whole plugin's switch does it, that is offered, with Undo.
 */
function nothingChanged(name: string, plugins: ReturnType<typeof turnEvery>, on: boolean, also?: string) {
  const left = [also, plugins.limit].filter(Boolean).join(' ');
  retireTip(kind);
  // A known limit (no switch for one item) is said plainly, as information; a switch that can't be written is a problem.
  tell({ page: state.page, item: name, warn: !!also, info: !also, band: true, text: `${name}: nothing changed.${left ? ` ${left}` : ` It is ${on ? 'on' : 'off'} already.`}`, act: wholePluginAct(name, plugins.whole, on) });
  rerender();
}

/** A plugin's row's one switch: on while some tool has it on; a click turns it on or off in every tool with a switch for one item. */
function pluginRowSwitch(row: PluginRow) {
  const items = rowItems(row);
  const onTools = items.filter(itemOn).map(item => item.tool);
  const on = onTools.length > 0;
  const label = `${row.name}: ${on ? `on in ${toolsPhrase(onTools, toolList())}` : 'off'}. Click to turn it ${on ? 'off' : 'on'} in every tool that can switch it.`;
  return toggle({ on, label, disabled: !canWrite(), id: `switch-${row.key}`, onchange: next => {
    const plugins = turnEvery(items, next);
    pinRows(row.key);
    if (!plugins.ops.length) { nothingChanged(row.name, plugins, next, plugins.left); return; }
    mainClick(row.name, next, [], plugins, () => `${row.name} is ${next ? 'on' : 'off'} in ${toolsPhrase(plugins.turned.map(item => item.tool), toolList())}.`, plugins.left);
  } });
}

/**
 * On for an item with no copy left: every removal of it still open goes back from History, then it is on everywhere like
 * any other, or its copy choice opens when what came back differs.
 */
function putItBack(skill: ItemRow) {
  const name = nameOf(skill);
  pinRows(skill.key);
  // MCP: Claude Code gets it back with its own Write step.
  const later = kind === 'mcp' && canHave(skill).includes('claude-cli');
  void applyClick({ kind, items: [name], changes: [], said: notIn => `${name} is back, and on in ${onPhrase(skill, [...notIn, ...(later ? ['claude-cli'] : [])])}.`, note: later ? CLAUDE_LATER : undefined,
    putBack: { key: skill.key, ids: [skill.gone!.history, ...(skill.gone!.also ?? [])], then: () => {
      const back = committedList().find(entry => entry.key === skill.key && !entry.gone);
      if (!back) return [];
      if (isDiffering(back)) { view.comparing = back.key; return 'choose'; }
      const change = onChange(back);
      return back.managed && !back.off.length && !change.enable ? [] : [change];
    } } });
}

/** The switch's click: off everywhere, or on everywhere (put back from History when no copy is left, or after a copy choice). */
function flip(skill: ItemRow, on: boolean) {
  if (!on) { turnOff(skill); return; }
  if (skill.gone) { putItBack(skill); return; }
  if (isDiffering(skill)) {
    // The question opens under its row; a second click on the switch closes it.
    if (view.comparing === skill.key) { view.comparing = undefined; rerender(); return; }
    view.comparing = undefined;
    openRow(skill.key);
    announce(`${nameOf(skill)}’s copies differ. Choose which copy every tool uses.`, true);
    return;
  }
  turnOn(skill);
}

/** Where an item that is not synced is on (its own copy, or a plugin's item that is on: onIn), and where a copy of its own is off. */
const notSyncedIn = (skill: ItemRow) => {
  const on = onIn(skill), off = holders(skill).filter(tool => !on.includes(tool));
  return ['Not synced · ', on.length ? `on in ${toolsPhrase(on, toolList())}` : '', on.length && off.length ? '; ' : '', off.length ? `off in ${toolsPhrase(off, toolList())}` : ''].join('');
};

/**
 * An item's one switch: on (synced, some tool uses it), in between (not synced: some tools have their own copies), or off
 * (no tool uses it). Clicking an in-between switch turns it on everywhere.
 */
function itemSwitch(skill: ItemRow, id = `switch-${skill.key}`) {
  if (library()) return librarySwitch(skill, id);
  const place = standingOf(skill);
  const name = nameOf(skill);
  const now = place === 0 ? 'on' : place === 1 ? notSyncedIn(skill) : skill.gone ? 'off, with no copy left' : 'off';
  const asking = isDiffering(skill) && place !== 0;
  const what = skill.held ? skill.held : place === 0 ? 'Click to turn it off in every tool.'
    : skill.gone ? 'Click to put it back in every tool.'
      : asking ? (view.comparing === skill.key ? 'Its copies differ. Click to close the question.' : 'Its copies differ. Click to choose which copy every tool uses.') : 'Click to turn it on in every tool.';
  return toggle({ on: place === 0, mixed: place === 1, label: `${name}: ${now}. ${what}`, onchange: next => flip(skill, next), disabled: !canWrite() || (!!skill.held && place !== 0), id });
}

/**
 * A library item's one switch: on (in Central Knot, applied to every harness), halfway (found: a harness has it and Central
 * Knot doesn't yet; a click takes it in, or asks which copy where they differ), or off (in Central Knot only).
 */
function librarySwitch(skill: ItemRow, id: string) {
  const item = itemOf(skill), place = libraryPlace(item);
  const question = isDiffering(skill) ? (view.comparing === skill.key ? 'open' : 'closed') : undefined;
  const label = switchLabel(skill, item, toolList(), question);
  // Partial (kept out of some tools in the opened row): on, drawn apart from on everywhere (style.css .switch-partial).
  // A found item none of whose copies can be read for sure has nothing to take in: its switch waits, saying why.
  const nothingToTake = place === 'found' && !canTakeIn(skill);
  const knob = toggle({ on: place === 'on', mixed: place === 'found', partial: isPartial(item, toolList(), skill), label, onchange: next => flip(skill, next), disabled: !canWrite() || nothingToTake, id });
  // The halfway switch says on hover what a click does: it isn't blocked, it takes the item in.
  if (place === 'found' && !nothingToTake) knob.title = question ? 'Its copies differ: click to choose which one Central Knot takes in' : `Click to ${takeInWhere(skill, item, toolList()).replace(/^take it in/, 'take it into Central Knot')}`;
  return knob;
}

/**
 * How a tool's mark looks: on there, off there (copy kept), no copy, copies differ, something waits, or (`held`, a library
 * item's) a state of that tool's own drawn with its glyph: kept out, switched off in its own settings, can't take it.
 */
type MarkLook = 'on' | 'off' | 'none' | 'differs' | 'waits' | 'held';

/** What a mark says in the key, by what it is. */
const keyWords = {
  on: 'On there', off: 'Off, copy kept', 'plugin-off': 'Off there', profile: 'Off by a profile (see Profiles)', none: 'No copy', differs: 'Copies differ', edited: 'Edited, waiting to spread',
  waiting: 'Gets the edit when sync runs', 'will-sync': NEXT_SYNC, 'write-now': 'Waits for Write to Claude Code',
  // A library item's (libraryrow.ts HarnessIs).
  taken: 'Edited, becomes the current version', deleted: 'Deleted there; turns off when sync runs', leaving: 'Removed when sync runs', own: 'Its own copy, not from Central Knot',
  current: 'Has the current version', has: 'Has it', 'kept-out': 'Kept out', 'off-in-ck': 'Off: in Central Knot only', unseen: 'Can’t be read', 'cannot-take': 'Can’t take it',
  'another-way': 'Has it another way, not from Central Knot', switched: 'Switched off in its own settings',
} as const;

/**
 * One tool's mark on a row: its look, what it says, and a glyph in place of the tool's own mark where something waits
 * or differs. `state`: what the tool has, as a word (the table's Cell, "plugin", or a library item's HarnessIs), for the page's
 * checks; `key`: its entry in the key.
 */
function markOf(skill: ItemRow, tool: Tool): { look: MarkLook; words: string; glyph?: IconName; state: string; key: keyof typeof keyWords } {
  const given = throughPluginHere(skill, tool);
  if (given) {
    const on = pluginOnIn(skill).includes(tool);
    return { look: on ? 'on' : 'off', state: on ? 'plugin' : 'plugin-off', key: on ? 'on' : 'plugin-off', words: `${skill.anotherWay?.[tool] ?? skill.cannot?.[tool] ?? `${names[tool]} has it through the plugin ${given.plugin}.`}${on ? '' : ' It is turned off there.'}` };
  }
  const lib = library();
  if (lib) return libraryMark(lib, skill, tool);
  const drawn = cellOf(skill, tool);
  const off = shownDisabled(skill, tool);
  const byProfile = off && turnedOffByProfile(skill.key, tool);
  const offWords = off ? `, off there${byProfile ? ' by a profile (see Profiles)' : ''} (copy kept)` : '';
  const mark = (look: MarkLook, key: keyof typeof keyWords, words: string, glyph?: IconName) => ({ look, key, words: `${names[tool]}: ${words}`, glyph, state: drawn });
  if (drawn === 'cannot') return { ...mark('none', 'none', ''), words: skill.cannot?.[tool] ?? `${names[tool]} can’t ${uses()} it` };
  if (drawn === 'absent') return mark('none', 'none', `no copy${skill.managed && skill.off.includes(tool) ? ', not synced there' : ''}`);
  if (drawn === 'differs' || drawn === 'present-differs') return mark('differs', 'differs', `copies differ${offWords}`, 'diff');
  if (drawn === 'will-sync') return mark('waits', 'will-sync', NEXT_SYNC.toLowerCase(), 'clock');
  if (drawn === 'edited') return mark('waits', 'edited', `edited here, waiting to spread${offWords}`, 'pencil-line');
  if (drawn === 'waiting') return mark('waits', 'waiting', `gets the edit when sync runs${offWords}`, 'clock');
  if (drawn === 'write-now') return mark('waits', 'write-now', 'waits for Write to Claude Code', 'clock');
  const own = drawn === 'synced' ? 'synced' : skill.managed && skill.off.includes(tool) ? 'its own copy, left out of sync' : 'its own copy, not synced';
  return mark(off ? 'off' : 'on', byProfile ? 'profile' : off ? 'off' : 'on', `${off ? '' : 'on, '}${own}${offWords}`);
}

/** A library item's mark for one harness: what the library's rule says of it (libraryrow.ts harnessIs), drawn with the page's looks. */
const libraryMarks: Record<HarnessIs, { look: MarkLook; key: keyof typeof keyWords; glyph?: IconName }> = {
  current: { look: 'on', key: 'current' },
  'own-copy': { look: 'on', key: 'own' },
  'kept-out': { look: 'held', key: 'kept-out', glyph: 'circle-minus' },
  none: { look: 'none', key: 'none' },
  cannot: { look: 'held', key: 'cannot-take', glyph: 'circle-slash-2' },
  'gets-it': { look: 'waits', key: 'will-sync', glyph: 'clock' },
  edited: { look: 'waits', key: 'taken', glyph: 'pencil-line' },
  deleted: { look: 'waits', key: 'deleted', glyph: 'trash-2' },
  leaving: { look: 'waits', key: 'leaving', glyph: 'clock' },
  unseen: { look: 'differs', key: 'unseen', glyph: 'circle-alert' },
  'another-way': { look: 'on', key: 'another-way', glyph: 'link-2' },
};
function libraryMark(lib: LibraryPage, skill: ItemRow, tool: Tool): ReturnType<typeof markOf> {
  const item = itemOf(skill), is = harnessIs(skill, item, tool);
  const words = `${names[tool]}: ${lib.say.harnessLine(skill, item, tool, names[tool]).replace(/^./, first => first.toLowerCase())}`;
  // Off, or found: a harness with no copy while Central Knot keeps the item is off there; a found item's own copy is simply on.
  const drawn = is === 'none' && inLibrary(item) ? { look: 'off' as const, key: 'off-in-ck' as const } : is === 'own-copy' && !inLibrary(item) ? { look: 'on' as const, key: 'has' as const } : libraryMarks[is];
  // Loaded there, but that tool's own switch turns it off: a mark of its own, whoever set the switch (libraryrow.ts `switched`).
  const switched = skill.switched?.[tool] && drawn.look === 'on' ? { look: 'held' as const, key: (turnedOffByProfile(skill.key, tool) ? 'profile' : 'switched') as keyof typeof keyWords, glyph: 'circle-off' as IconName } : undefined;
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
function rowMarks(skill: ItemRow, size = 14, table = true) {
  const marks = toolList().map(tool => ({ tool, ...markOf(skill, tool) }));
  return h('span.tool-marks', table ? { role: 'img', 'aria-label': marks.map(mark => mark.words).join('. ') } : { 'aria-hidden': 'true' },
    marks.map(({ tool, look, words, glyph, state }) => {
      const mark = toolMark(look, tool, glyph, size);
      if (table) mark.id = `cell-${skill.key}-${tool}`;
      Object.assign(mark.dataset, { tool, state, look });
      mark.title = words;
      return mark;
    }));
}

/** The key under the table: the marks it shows, each drawn with a neutral sample, since it is for every tool's mark. */
function markLegend(list: ItemRow[], plugins: PluginRow[]) {
  if (!toolList().length) return null;
  const seen = new Map<keyof typeof keyWords, { look: MarkLook; glyph?: IconName }>();
  for (const skill of list) for (const each of toolList()) { const { look, glyph, key } = markOf(skill, each); seen.set(key, { look, glyph }); }
  // A plugin's own rows: on there, or off there (no copy kept: a plugin's item has none of its own).
  for (const row of plugins) for (const each of toolList()) if (row.copies[each as HarnessId]) seen.set(offIn(row, each as HarnessId) ? 'plugin-off' : 'on', { look: offIn(row, each as HarnessId) ? 'off' : 'on' });
  const keyed = h('div.legend', { 'aria-label': 'Key' }, (Object.keys(keyWords) as (keyof typeof keyWords)[]).filter(key => seen.has(key))
    .map(key => h('span.legend-item', {}, toolMark(seen.get(key)!.look, undefined, seen.get(key)!.glyph, 12), keyWords[key])));
  return keyed.childElementCount ? keyed : null;
}

/** One row: its switch, its name, a mark per tool, and the chevron that opens its details. */
function row(skill: ItemRow) {
  const open = view.comparing === skill.key;
  return [
    h(`div.ov-row.ov-switch-row${takeFlash(skill.key) ? '.row-flash' : ''}${skill.managed ? '' : '.unmanaged'}${open ? '.open' : ''}`, { role: 'row', 'data-key': skill.key, 'aria-expanded': String(open), onclick: () => openRow(skill.key) },
      h('div.ov-managed', { role: 'cell' }, itemSwitch(skill)),
      nameCell(skill, needsCopyChoice(skill, toolList())),
      h('div.ov-marks', { role: 'cell' }, rowMarks(skill)),
      h('div.ov-open', { role: 'cell' }, openButton(skill.key, nameOf(skill)))),
    open && underRow(skill.key) ? details(skill) : null,
  ];
}

/** Rows under one heading: On, Not synced, Off, or (on a harness's page) the ones only other tools have. */
function section(role: 'on' | 'not-synced' | 'off' | 'away', list: ItemRow[]) {
  if (!list.length) return null;
  const onLibrary = !!library();
  const label = role === 'away' ? `Not in ${names[focus!]}` : onLibrary && role === 'not-synced' ? 'Found' : placeNames[role === 'on' ? 0 : role === 'not-synced' ? 1 : 2];
  const note = role === 'not-synced' ? (onLibrary ? 'in a tool, not in Central Knot yet. Turn one on to take it in; its row says where it goes.' : 'each tool keeps its own copy')
    : role === 'off' ? (onLibrary ? 'in Central Knot only; no tool has these' : `no tool ${uses()}s these`) : role === 'away' ? 'only other tools have these' : null;
  return h('div', { role: 'rowgroup' },
    h(`div.ov-section${role === 'off' || role === 'away' ? '.ov-section-away' : ''}`, { role: 'row', 'data-section': role },
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(list.length)), note ? sectionNote(note) : null)),
    [...list].sort(byKey).flatMap(row));
}

/** What the item is now, in one line: on and where, not synced and where its copies are, or off. */
function switchStatus(skill: ItemRow): string {
  if (library()) return statusLine(skill, itemOf(skill), toolList());
  if (skill.gone) return `Off · no copy left: ${skill.gone.kind === 'deleted' ? 'deleted' : 'removed'} ${daysAgo(skill.gone.at)}. Turn it on to put it back from History.`;
  if (skill.held) return `Can’t be synced: ${skill.held}`;
  const on = onIn(skill);
  // Off: its own copies turned off with each tool's switch, and a plugin's item off where a tool has it through the plugin.
  const off = toolList().filter(tool => !on.includes(tool) && (skill.disabled?.includes(tool) && skill.copies[tool] !== undefined || !!throughPluginHere(skill, tool)));
  const kept = off.filter(tool => skill.copies[tool] !== undefined).length;
  const place = standingOf(skill);
  if (place === 0) {
    const loaded = on.filter(tool => !(skill.waits?.includes(tool) && skill.copies[tool] === undefined));
    const waits = kind === 'mcp' && skill.waits?.includes('claude-cli') ? ' · waits for Write to Claude Code' : '';
    return `On in ${toolsPhrase(loaded, toolList())}${off.length ? ` · off in ${toolsPhrase(off, toolList())}` : ''}${waits}`;
  }
  // Not every tool takes a copy: one that has it through a plugin, or can't use it, is not synced to.
  const every = toolList().some(tool => skill.cannot?.[tool]) ? 'every tool that takes a copy' : 'every tool';
  if (place === 1) return `${notSyncedIn(skill)}${isDiffering(skill) ? ', with different copies' : ''}. Turn it on to sync it to ${every}.`;
  return `Off in ${toolsPhrase(off, toolList())}.${kept ? ` The ${kept === 1 ? 'copy is' : 'copies are'} kept.` : ''}`;
}

/** What one tool has, for its row in the item's details: what its copy is, then whether its own switch has it off. */
function harnessLine(skill: ItemRow, tool: Tool): string {
  // Through a plugin: where it comes from, then why its switch can't be used here, or that it is the whole plugin's.
  const through = itemThrough(skill, tool);
  if (through) return [skill.cannot?.[tool], cantSwitch(through) ?? switchWords(through)].filter(Boolean).join(' ');
  const lib = library();
  if (lib) {
    const own = skill.ownPart?.[tool];
    return [lib.say.harnessLine(skill, itemOf(skill), tool, names[tool]), own?.length ? lib.words.own(own) : ''].filter(Boolean).join(' ');
  }
  if (skill.cannot?.[tool]) return skill.cannot[tool]!;
  const has = skill.copies[tool] !== undefined;
  const drawn = cellOf(skill, tool);
  const version = skill.versions?.[tool];
  const tells = version && comparedTools(skill).filter(other => other !== tool).some(other => { const them = skill.versions?.[other]; return them && (them.lines !== version.lines || them.changed !== version.changed); });
  const copy = drawn === 'write-now' ? waitsLine(skill, tool)
    : !has ? (skill.managed && skill.off.includes(tool) ? 'Not synced here.' : getsCopy(skill, tool) ? `${NEXT_SYNC}.` : skill.gone ? 'No copy.' : 'No copy. Turning it on adds it here.')
      // Off with its own switch: said once, the entry kept, whatever else it is.
      : skill.disabled?.includes(tool) ? `Off here${turnedOffByProfile(skill.key, tool) ? ' by a profile' : ''} · entry kept`
      : drawn === 'edited' ? `Edited in ${names[tool]}. It spreads to the other tools when sync runs.`
        : drawn === 'waiting' ? `Gets the edit from ${andList((skill.edited ?? []).map(entry => names[entry]))} when sync runs.`
          : drawn === 'differs' || drawn === 'present-differs' ? `Has a different copy${tells ? ` (${version!.lines}, ${version!.changed})` : ''}.`
            : skill.managed && skill.off.includes(tool) ? 'Has its own copy, not synced.'
              // Synced everywhere: the status above says so once, not again on each tool's line.
              : skill.managed ? (everySynced(skill) ? '' : 'Synced.') : 'Has its own copy.';
  const problem = has && skill.switchProblem?.[tool] ? `${problemText(skill.switchProblem[tool]!, shownPath)} Fix it, then Refresh.` : '';
  return [copy, problem].filter(Boolean).join(' ');
}

/** Whether every tool that can have it holds the synced copy: nothing for a tool's line to add. */
const everySynced = (skill: ItemRow) => toolList().every(tool => skill.cannot?.[tool] || cellOf(skill, tool) === 'synced');

/** MCP: Claude Code's copy, waiting for its own Write step: missing or older, and what to do first. */
function waitsLine(skill: ItemRow, tool: Tool): string {
  const older = skill.versions?.[tool]?.text;
  const has = skill.copies[tool] === undefined ? 'Doesn’t have it yet.' : `Has an older copy${older ? `: ${older.replace(/^[^·]+·\s*/, '')}` : ''}.`;
  return `${has}${state.home?.mode === 'fixture' ? '' : ' Quit Claude Code first: it rewrites ~/.claude.json while it runs.'}`;
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
  const ownState = out ? undefined : skill.switched?.[tool] ? 'Switched off' : harnessIs(skill, item, tool) === 'another-way' ? 'Another way' : undefined;
  if (ownState) return h('span.details-tool-actions', {}, own, h('span.tool-switch', {}, h('span.tool-switch-word.tool-switch-word-own', {}, ownState)));
  const said = (notIn: HarnessId[]) => lib.say.said.inHarness(name, tool, !out, notIn.includes(tool as HarnessId));
  const does = out ? `Click to put it in ${where} again, its ${lib.words.copy} as it was.` : `Click to keep it out of ${where}: its copy there goes, and Central Knot keeps it.`;
  const flipHere = (on: boolean) => click({ kind, items: [name], changes: [rowClicks.inHarness(skill, item, tool, !on)], said });
  return h('span.details-tool-actions', {}, own, h('span.tool-switch', {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, out ? 'Off' : 'On'),
    toggle({ on: !out, disabled: !canWrite(), id: `enable-${skill.key}-${tool}`, label: `${name} in ${where}: ${out ? 'kept out' : 'on'}. ${does}`, onchange: flipHere })));
}

/**
 * Delete from Central Knot, the one real delete of a library item: quiet until armed, then it runs at once. The item leaves
 * every harness and its page; the library keeps it, deleted, and History's Restore (or this click's Undo) puts it back.
 */
function libraryDelete(lib: LibraryPage, skill: ItemRow) {
  const item = inLibrary(itemOf(skill));
  if (!item) return null;
  const name = nameOf(skill), disarm = () => { view.confirmDelete = undefined; rerender(); };
  if (view.confirmDelete !== skill.key) {
    const arm = button({ variant: 'outline', size: 'micro', label: 'Delete from Central Knot…', id: `delete-${skill.key}`, disabled: !canWrite(), onclick: () => { view.confirmDelete = skill.key; rerender(); } });
    arm.classList.add('delete-quiet');
    return h('span.delete-offer', {}, arm, h('span.delete-offer-note', {}, lib.say.said.deleteOffer));
  }
  const said = lib.say.said.deleted(name, item.on);
  const run = () => { view.confirmDelete = undefined; click({ kind, items: [name], changes: [rowClicks.remove(skill, item)], said }); };
  // Armed, it is still a button (outlined in red); Cancel beside it is a link.
  const now = button({ variant: 'outline', size: 'micro', label: 'Delete it now', id: `delete-confirm-${skill.key}`, disabled: !canWrite(), onclick: run });
  now.classList.add('delete-now');
  now.title = `Delete ${name} from Central Knot now. History can restore it.`;
  return h('span.delete-armed', {}, smallAction('Cancel', `delete-cancel-${skill.key}`, disarm), now,
    h('span.delete-armed-note', { id: `delete-note-${skill.key}` }, lib.say.said.deleteArmed(state.historyDays ?? defaultHistoryDays)));
}

/** Versions read in an opened row, by home, kind, item and version, so a version read once shows at once the next time. */
const versionTexts = new Map<string, VersionText>();

/** A library item's versions in its opened row (versionlist.ts): the list, Read (as its kind gives it), and Make current as the item's click. */
function libraryVersions(lib: LibraryPage, skill: ItemRow) {
  const item = inLibrary(itemOf(skill));
  if (!item) return null;
  const name = nameOf(skill), textKey = (hash: string) => `${state.home?.home}:${kind}:${item.key}:${hash}`;
  const at = view.readingVersion?.key === item.key ? view.readingVersion.index : undefined;
  const fetch = (hash: string) => {
    if (versionTexts.has(textKey(hash))) return;
    versionTexts.set(textKey(hash), 'reading');
    void lib.version(item.key, hash).then(text => { versionTexts.set(textKey(hash), text); rerender(); });
  };
  // Reading a version reads the current one too, so what differs from it can be marked.
  const read = (index: number) => {
    view.readingVersion = at === index ? undefined : { key: item.key, index };
    if (view.readingVersion) { fetch(listed(item)[index].hash); fetch(item.hash); }
    rerender();
  };
  const textOf = (hash: string) => versionTexts.get(textKey(hash)) ?? 'reading';
  const on = (notIn: HarnessId[]) => (item.on ? canHave(skill).filter(tool => !notIn.includes(tool as HarnessId) && !skill.off.includes(tool)) : undefined);
  const makeCurrent = (version: Version) => click({ kind, items: [name], changes: [rowClicks.makeCurrent(skill, item, version.hash)],
    // A version that was itself made current again is named by the one it came from.
    said: notIn => { const source = (version.from.how === 'made-current' && madeFrom(item, version)) || version;
      return lib.say.said.madeCurrent(name, source, versionClock(item, source), on(notIn), toolList()); } });
  const reading = at === undefined || !listed(item)[at] ? undefined : { index: at, text: textOf(listed(item)[at].hash), current: textOf(item.hash) };
  return versionList({ item, canWrite: canWrite(), unfolded: view.versionsUnfolded === item.key, onUnfold: () => { view.versionsUnfolded = item.key; rerender(); },
    changes: skill.versionChanges, reading, now: Date.now(), onRead: read, onMakeCurrent: makeCurrent });
}

/**
 * One tool's own controls in an item's details, each applied at once: an MCP server's switch there; Sync here for a tool a
 * synced server leaves out; a library item's switch for that harness and what its kind adds there (libraryHarnessSwitch);
 * Claude Code's Write step; the plugin's page, for a tool that has it through one. Each says what it does on hover.
 */
function harnessControls(skill: ItemRow, tool: Tool) {
  const given = throughPluginHere(skill, tool);
  // Through a plugin: the item's switch in that tool (its own, or the whole plugin's), with the way to the plugin's page.
  const through = itemThrough(skill, tool);
  if (through) return pluginItemControls(through, `enable-${skill.key}-${tool}`, () => openPlugin(given!));
  if (given) return h('span.details-tool-actions', {}, smallAction('Plugin’s page', `plugin-${skill.key}-${tool}`, () => openPlugin(given)));
  const lib = library();
  if (lib) return libraryHarnessSwitch(lib, skill, tool);
  if (skill.gone || skill.cannot?.[tool]) return null;
  const name = nameOf(skill), where = names[tool];
  const now = asItIs(skill);
  const has = skill.copies[tool] !== undefined;
  // Said from what happened: a tool whose write failed or was held is not said to have it.
  const failedHere = (notIn: HarnessId[]) => notIn.includes(tool as HarnessId);
  // Left out of sync, with a copy of its own or none: Sync here takes it back in (a copy that differs then asks which copy).
  const rejoin = () => click({ kind, items: [name], changes: [{ ...now, off: now.off.filter(other => other !== tool), ...(skill.disabled?.includes(tool) && !skill.switchProblem?.[tool] ? { enable: [tool as HarnessId] } : {}) }],
    said: notIn => (failedHere(notIn) ? `${name} couldn’t be synced to ${where}.` : `${name} syncs to ${where} again.`) });
  const syncHere = skill.managed && skill.off.includes(tool) ? smallAction('Sync here', `sync-here-${skill.key}-${tool}`, rejoin, '', !canWrite()) : null;
  if (syncHere) syncHere.title = `Sync it to ${where} again${has ? '; if its copy there differs, you choose which copy every tool uses' : ''}`;
  const write = kind === 'mcp' && tool === 'claude-cli' && skill.managed && skill.waits?.includes(tool)
    ? button({ variant: 'outline', size: 'small', label: 'Write to Claude Code', id: `write-claude-row-${skill.key}`, disabled: !canWrite(), onclick: () => void writeClaudeNow([skill.key]) }) : null;
  if (!has) return syncHere || write ? h('span.details-tool-actions', {}, write, syncHere) : null;
  // Claude Code waiting for its Write step: its line says how, and Write is its one action.
  if (write) return h('span.details-tool-actions', {}, write);
  const off = !!skill.disabled?.includes(tool);
  const stays = kind === 'mcp' ? `the server stays in ${where}’s settings` : 'the copy stays';
  const toggleHere = skill.switchProblem?.[tool] ? h('span.tool-switch-na', {}, icon('circle-alert', 12, 'tone-muted'), 'Can’t switch here')
    : h('span.tool-switch', {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, off ? 'Off' : 'On'),
      toggle({ on: !off, disabled: !canWrite(), id: `enable-${skill.key}-${tool}`,
        label: `${name} in ${where}: ${off ? 'off' : 'on'}. ${off ? 'Click to turn it on there.' : `Click to turn it off there: ${stays}${skill.managed ? ' and keeps syncing' : ''}, and ${where} stops ${kind === 'mcp' ? 'starting' : 'loading'} it from its next session.`}`,
        onchange: next => click({ kind, items: [name], changes: [{ ...now, ...(next ? { enable: [tool as HarnessId] } : { disable: [tool as HarnessId] }) }],
          said: notIn => (failedHere(notIn) ? `${name} couldn’t be turned ${next ? 'on' : 'off'} in ${where}.` : `${name} is ${next ? 'on' : 'off'} in ${where}${kind === 'mcp' ? ', from its next session' : ''}.`) }) }));
  return h('span.details-tool-actions', {}, write, syncHere, toggleHere);
}

/**
 * An item's details: its status, each tool with its own controls, a library item's versions, where each copy is, what its
 * kind shows of its own (librarypages.ts), and a library item's Delete from Central Knot last.
 * While its copies differ, only the question of which copy every tool uses, and the copies.
 */
function details(skill: ItemRow, placement: Placement = 'row'): HTMLElement {
  const inFiles = placement === 'files', lib = library();
  const differs = isDiffering(skill);
  // MCP: each tool's row has its settings file and Show in folder, where a server is changed.
  const settingsFile = (tool: Tool) => (kind === 'mcp' && skill.paths?.[tool] ? [wrappingPath(skill.paths[tool]!), showInFolder(skill.paths[tool]!)] : []);
  const toolRow = (tool: Tool) => h('div.details-tool', {},
    h('div.details-tool-head', {},
      h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
      ...settingsFile(tool),
      h('span.details-tool-line', {}, harnessLine(skill, tool)),
      harnessControls(skill, tool)),
    lib?.toolNote?.(skill, tool as HarnessId));
  const close = placement === 'row' ? h('button.details-close', { type: 'button', id: `close-${skill.key}`, 'aria-label': `Close details for ${skill.key}`, title: 'Close', onclick: () => { view.comparing = undefined; rerender(); } }, icon('x', 14)) : null;
  const box = (...children: (Child | Child[])[]) => h(`div.compare.details${placement === 'row' ? '' : '.details-bare'}${differs ? '.details-differs' : ''}${kind === 'mcp' ? '.details-mcp' : '.details-grid'}`, { role: 'region', 'aria-label': `Details for ${skill.key}` }, ...children);
  if (differs) return box(close, compareChoices(skill, inFiles));
  // A found row none of whose copies can be read has no files to show.
  const files = lib?.files && !inFiles && (inLibrary(itemOf(skill)) || canTakeIn(skill)) ? smallAction('Files and contents', `files-${skill.key}`, () => openFiles(skill.key)) : null;
  const remove = lib && !inFiles ? libraryDelete(lib, skill) : null;
  return box(
    h('div.details-head', {},
      // The Files view's pane says it under the skill's name; the row already shows the description.
      inFiles ? null : h('p.details-status', {}, switchStatus(skill)),
      // A library item's description whole: the closed row cuts it.
      lib && skill.description ? h('p.details-description.details-description-whole', {}, skill.description) : null,
      kind === 'mcp' && skill.description ? definition(skill.description, skill.managed) : null,
      partNote(skill),
      files ? h('div.details-actions', {}, files) : null),
    // A library item: what is kept the same, and what stays each harness's own (for agents, AGT-01).
    // What every tool shares of it, said where it is true: an item in Central Knot, or a found one that can be taken in.
    lib && toolList().length > 1 && (inLibrary(itemOf(skill)) || canTakeIn(skill)) ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), lib.words.shared) : null,
    skill.gone ? null : h('div.details-tools', {}, toolList().map(toolRow)),
    lib ? libraryVersions(lib, skill) : null,
    inFiles || kind === 'mcp' ? null : wherePaths(skill),
    lib?.own?.(skill) ?? null,
    skill.converted ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Converted from ${names[skill.converted.origin] ?? skill.converted.origin}’s agent “${skill.converted.agent}”, as a one-time copy; ${names[skill.converted.origin] ?? skill.converted.origin} keeps the agent, and edits here never change it. As a skill it has no ${andList(skill.converted.losses)}.`) : null,
    remove ? h('div.details-actions.details-danger', {}, remove) : null);
}

/** What waits, in the toolbar: edits waiting for sync, or that sync is off. */
function toolbarState() {
  const edits = committedList().filter(skill => skill.managed && skill.edited?.length).length;
  if (edits) return h('span.apply-state.apply-waiting', {}, icon('clock', 14, 'tone-warning'), `${edits} ${edits === 1 ? 'change' : 'changes'} waiting`);
  // A server waiting for Claude Code is said once, by the band that carries Write to Claude Code, and by its row's mark.
  if (state.home && !state.home.syncOn) return h('span.apply-state.apply-quiet', {}, icon('circle-minus', 14, 'tone-muted'), 'Nothing waiting · sync off');
  return null;
}

// ---------- Skills page ----------

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
  if (where && view.whereOpen === undefined) where.open = wide;
}
afterLayout(settleFilesColumns);

/** A list of every skill beside (or, in narrow content, above) one skill's details: the same switch and controls as the table. `more` adds files and contents. */
export function skillsBrowser(more: (key: string) => { where: Node[]; contents: (Node | null | false)[] }, select: (key: string | undefined) => void) {
  useTable('skills');
  // A skill with no copy left has no files to show: it stays on the table, switched off.
  const all = rows().filter(skill => !skill.gone);
  // Only skills with no copy left (the last one just deleted): the table, where they are, switched off.
  if (!all.length) return itemsTable('skills');
  const needle = view.listFind.trim().toLowerCase();
  // The table's order and headings: on, then not synced, then off.
  const place = new Map(all.map(skill => [skill.key, placeOf(skill)]));
  const shown = all.filter(skill => !needle || skill.key.includes(needle) || (skill.name ?? '').toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle))
    .sort((first, second) => place.get(first.key)! - place.get(second.key)! || byKey(first, second));
  const chosen = all.find(skill => skill.key === state.item);
  // The detail always shows a skill: the chosen one, else the first listed. In narrow content it sits below the list.
  const shownDetail = chosen ?? shown[0] ?? all[0];
  const listRow = (skill: ItemRow) => h(`button.list-row${skill === shownDetail ? '.selected' : ''}`, {
    type: 'button', id: `list-${skill.key}`, 'data-key': skill.key, 'aria-pressed': String(skill === shownDetail),
    'aria-label': `${skill.name ?? skill.key}, ${placeNames[standingOf(skill)].toLowerCase()}`,
    onclick: () => select(skill.key),
  },
    middle(skill.name ?? skill.key, 12, 'list-name'),
    // The same marks as the table's rows, smaller.
    h('span.list-cells', {}, rowMarks(skill, 12, false)));
  const find = findInput({ id: 'skills-find', label: 'Find a skill', value: view.listFind, onInput: text => { view.listFind = text; rerender(); } });
  const list = shown.length
    ? h('div', { role: 'group', 'aria-label': 'Skills' }, shown.flatMap((skill, index) => [
      index && place.get(shown[index - 1].key) === place.get(skill.key) ? null : h('div.list-group', {}, placeNames[place.get(skill.key)!]), listRow(skill)]))
    : emptyState('search-x', 'Nothing matches', `“${view.listFind}”`);
  const skill = shownDetail;
  if (skill.key !== revealed) { revealed = skill.key; requestAnimationFrame(revealSelected); }
  requestAnimationFrame(() => {
    listWatcher.disconnect();
    const list = document.getElementById('skills-list'); if (list) listWatcher.observe(list);
  });
  const { where, contents } = more(skill.key);
  const layout = filesLayout(skill, where);
  // Its whole text on hover too, for a pane too narrow to show it.
  const paneStatus = switchStatus(skill);
  // The result and its Undo in the strip at the top, as on every other page; the list and the skill's pane below it.
  return h('div.page', {}, notices(), h('div.split', {},
    h('div.list-column', {},
      h('div.toolbar.list-toolbar.fit-bar', {}, button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Skills', name: 'Back to Skills', id: 'skills-table', collapse: true, onclick: showSkillsTable }), h('div.find', {}, icon('search', 16, 'find-glyph'), find)),
      // The header rides inside the list's scroll area, so it has the rows' exact width, gutter and columns.
      h('div.scroll.list-scroll', { id: 'skills-list' },
        h('div.list-head', { 'aria-hidden': 'true' }, h('span', {}, 'Skill')),
        list)),
    h('section.detail-column', { id: 'skill-detail', 'aria-label': 'Skill details' },
      // The skill's own switch comes first, before its name, as on its row.
      h('div.pane-header.pane-header-switched', {},
        h('div.detail-switch', {}, itemSwitch(skill, `detail-switch-${skill.key}`)),
        h('div.pane-title', {}, h('h2', {}, middle(skill.name ?? skill.key)), h('p', { title: paneStatus }, paneStatus))),
      // A wide pane puts the skill's details beside its files, as a plugin's page puts its README beside what it holds.
      h('div.scroll.detail-scroll', { id: 'detail-scroll' },
        h('div.detail-files', {}, ...contents),
        layout.head ? h('div.files-details', {}, layout.head) : null,
        layout.tail.length ? h('div.files-tail', {}, layout.tail) : null))));
}

// Escape in a find box clears it.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const id = (event.target as HTMLElement | null)?.id;
  if (id === 'skills-find' && view.listFind) { view.listFind = ''; rerender(); }
  if (id === 'find' && view.find) { view.find = ''; rerender(); }
});
