// The Overview table in design preview: three layout options with no row checkboxes.
// Managed says whether Central Knot keeps a skill in sync; each tool's cell says what that tool has.
// Changes collect until "Apply all".
import { itemId } from './profileplan.ts';
import { brandMark } from './brand.ts';
import { caughtUpNames, DAY_MS } from './model.ts';
import { deletedText, deleteNote, linkTarget, managedSentence, manageSentence, pinnedSentence, readsOutside, replaceSentence, rowWords, whereSentence, type Shape } from './outsidewords.ts';
import { REPLACE_ACTION, andList, byToolOrder, capitalToolsPhrase, kindNouns, orList, problemText, toolName, toolNames, toolsPhrase } from './words.ts';
import { keptEditFlag, readFlag, writeFlag } from './flags.ts';
import { whyReadOnly, otherOwnerSaid, saidInStatusBar, takeOverSync, takeOverTitle, tell, type Click, type Outcome, type Kind, harnessKindShown, convertAgent, flashRequests, showSkillsTable, applyAgentsChanges, applyClick, applyMcpChanges, applyPluginSwitches, deleteEverywhereKey, putBack, rerender, announce, restoreEvent, setSync, shownPath, showFile, showPage, state, syncNow, writeClaudeNow } from './app.ts';
import { afterLayout, button, closeButton, emptyState, fileBlocks, findInput, fitInView, h, icon, middle, pathText, pendingCount, toggle, withToolCount, type Child } from './dom.ts';
import { getsCopy as getsCopyNext, offPlan, stillOn } from './clickplan.ts';
import type { IconName } from './icons.ts';
import { byKey, standing } from './roworder.ts';
import { applied, cellOf, comparedTools, designMode, sample, syncOf, tools as sampleTools, type Cell, type SampleSkill, type Tool } from './design.ts';
import type { Change, DestinationResult, HomeView, ManageView, Outside, SkillFacts, SyncNotice, HarnessId, PartsInstall, ThroughPlugin } from './types.ts';
import { market } from './pluginstate.ts';
import { pluginKey, type PluginDraft } from './pluginplan.ts';
import { cantSwitch, click as clickPluginItem, clickWords, pendingWords, prune as prunePluginSwitches, standing as pluginStanding, turnEvery, wholeWords, type PluginItemAt } from './pluginswitch.ts';
import { partOfPage, samePart, versionWord } from './pluginstatus.ts';
import { cellWords, handledWhere, inTool, insideTitle, offIn, pageRows, pluginTools, toolWords, type PluginRow } from './pluginrows.ts';
import { folded, lineDiff } from './diff.ts';
import { plural } from './model.ts';

const names = toolNames as Record<Tool, string>;

/**
 * The plugins this item came from as a part (parts.ts): each plugin once, with the tools it went into as a separate item
 * because they can't take the plugin. Empty for an ordinary item.
 */
function fromPlugins(skill: SampleSkill, page: Kind): { install: PartsInstall; tools: HarnessId[] }[] {
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
const throughPluginIn = (skill: SampleSkill, plugin: string) => toolList().filter(tool => skill.plugin?.[tool]?.plugin === plugin && skill.copies[tool] === undefined);

/** The note in an item's details: which plugin it is a part of, where, and where its parts are managed together. */
function partNote(skill: SampleSkill) {
  // Once read, the Plugins page knows whether the plugin is still listed; a page that can't show it isn't linked to.
  const unlisted = (install: PartsInstall) => !!market.view && !market.view.marketplaces.some(entry => entry.source === install.source && entry.plugins.some(plugin => plugin.name === install.plugin));
  return fromPlugins(skill, kind).map(({ install, tools }) => h('p.details-limits.details-note.details-part', {}, icon('puzzle', 12, 'tone-muted'),
    h('span', {}, `From the plugin ${install.plugin}${install.version ? ` (${versionWord(install.version)})` : ''}, installed in ${andList(tools.map(tool => names[tool]))} as a separate item. `,
      throughPluginIn(skill, install.plugin).length ? `${andList(throughPluginIn(skill, install.plugin).map(tool => names[tool]))} ${throughPluginIn(skill, install.plugin).length > 1 ? 'have' : 'has'} it through the plugin itself. ` : '',
      ...(unlisted(install) ? ['Its marketplace no longer lists the plugin, so this is now an ordinary item.']
        : ['Update or remove its parts on ', h('button.inline-link', { type: 'button', id: `open-plugin-${skill.key}-${install.plugin}`, onclick: (event: Event) => { event.stopPropagation(); openPlugin(install); } }, 'the plugin’s page'),
          // Managed and Delete here reach this separate item's copies only.
          '. Managing or deleting it here acts on this separate item, never on the plugin itself.']))));
}

/** The one mark of a plugin's item on its row, a part's or one inside the installed plugin: the plugin's glyph and "from <plugin>"; its title says which. */
const pluginTag = (plugin: string, title: string) => h('span.row-tag.row-part', { title }, icon('puzzle', 12, 'tone-faint'), `from ${plugin}`);
/** A part's tag on its row, titled with the version and the tools it went into. */
const partTags = (skill: SampleSkill) => fromPlugins(skill, kind).map(({ install, tools }) =>
  pluginTag(install.plugin, `Part of the plugin ${install.plugin}${install.version ? ` (${versionWord(install.version)})` : ''}, installed in ${andList(tools.map(tool => names[tool]))} as a separate item`));

// ---------- What a plugin installed whole brings (pluginrows.ts) ----------
/** This page's plugin rows for the home on screen; none in the design preview. */
const plugged = () => (designMode || !state.home ? { rows: [] as PluginRow[], unread: [] } : pageRows(state.home, kind));
/** A row of a plugin's: one of its parts, or an item some tool has through the plugin itself. */
const fromAPlugin = (skill: SampleSkill) => fromPlugins(skill, kind).length > 0 || Object.keys(skill.plugin ?? {}).length > 0;

/** One tool's box for a plugin's item: the item's switch there where the tool has the plugin (see pluginSwitchCell), else an empty box saying why not. Sync never copies or changes a plugin's own files. */
function pluginCell(row: PluginRow, tool: Tool, id: string) {
  const install = row.installs[tool as HarnessId];
  if (row.copies[tool as HarnessId] && install) return pluginSwitchCell({ kind: row.kind, name: row.name, tool: tool as HarnessId, install }, cellWords(row, tool as HarnessId), id);
  const words = cellWords(row, tool as HarnessId);
  return h('span.cell-button.cell-static.cell-absent', { id, role: 'img', title: words, 'aria-label': words, 'data-state': 'plugin-none' });
}

/** The item a tool has through a plugin on a row of the person's own, with that plugin as the tool has it installed. */
function itemThrough(skill: SampleSkill, tool: Tool): PluginItemAt | undefined {
  const given = throughPluginHere(skill, tool);
  const install = given && state.home?.pluginItems?.find(entry => entry.tool === tool && entry.plugin === given.plugin && entry.marketName === given.marketplace);
  return install ? { kind: partOfPage[kind], name: given.name ?? skill.name ?? skill.key, tool: tool as HarnessId, install } : undefined;
}

/**
 * One tool's box for an item it has through a plugin: the plugin's glyph, marked where it is off there, and a click turns
 * it on or off there on Apply all (pluginswitch.ts), dashed blue while that waits. `said`: what the box shows, in words.
 */
function pluginSwitchCell(item: PluginItemAt, said: string, id: string) {
  const { now, on } = pluginStanding(pluginDraft, item);
  const why = cantSwitchHere(item);
  const pending = on !== now;
  const text = `${said.replace(/\.$/, '')}. ${why ?? clickWords(pluginDraft, item)}`;
  return h(`button.cell-button.${PLUGIN_LOOK.tone}.cell-on${on ? '' : '.cell-disabled'}${pending ? '.cell-pending-edit' : ''}`, {
    type: 'button', id, title: text, 'aria-label': text, 'data-state': pending ? (on ? 'plugin-turns-on' : 'plugin-turns-off') : on ? 'plugin' : 'plugin-off', disabled: !!why || !!state.busy,
    onclick: (event: Event) => { event.stopPropagation(); flipPluginItem(item); } },
    icon(PLUGIN_LOOK.glyph, 14), on ? null : h('span.cell-disabled-mark', { 'aria-hidden': 'true' }, icon('circle-off', 9)));
}

/** Why an item a tool has through a plugin can't be switched on this page now, if it can't: the switch itself (pluginswitch.cantSwitch), or a home that can't be written. */
const cantSwitchHere = (item: PluginItemAt) => cantSwitch(item) ?? (state.home ? whyReadOnly(state.home) : undefined);

/** Nothing waiting: where a plugin's item stands on a page whose clicks apply at once. */
const NOW: PluginDraft = new Map();
/** The plugin draft a page shows: none on a page with one switch per item, where a click applies at once. */
const shownDraft = () => (oneSwitch() ? NOW : pluginDraft);

/** On a page with one switch per item: turns a plugin's item on or off in its tool at once, with its own switch or the whole plugin's (pluginswitch.ts). */
function switchPluginItem(item: PluginItemAt) {
  pinRows();
  const draft: PluginDraft = new Map();
  clickPluginItem(draft, item);
  void applyPluginSwitches([...draft.values()], draft);
}

/** A click on a plugin item's box or its switch: turns it on or off there on Apply all, or takes that choice back. */
function flipPluginItem(item: PluginItemAt) {
  clickPluginItem(pluginDraft, item);
  view.draftSaid = state.said.seq;
  const count = pluginSwitchCount() + view.draft.size;
  announce(count ? `${count} ${count === 1 ? 'change' : 'changes'} not applied yet.` : 'No changes.', true);
  rerender();
}

/**
 * The item's switch in an opened row, where a person's own item has its switch in that tool: on or off there, at once on a page
 * with one switch per item, else on Apply all. `page`: a link to the plugin's page beside it, on a row that has no other.
 */
function pluginItemControls(item: PluginItemAt, id: string, page?: () => void) {
  const now1 = oneSwitch();
  const draft = shownDraft();
  const { now, on } = pluginStanding(draft, item);
  const why = cantSwitchHere(item);
  const pending = on !== now;
  const word = now1 ? (on ? 'On' : 'Off') : on ? 'Enabled' : 'Disabled';
  const label = `${item.name} in ${names[item.tool]}: ${word.toLowerCase()}${pending ? ' on Apply all' : ''}. ${why ?? clickWords(draft, item, now1 ? '' : undefined)}`;
  return h('span.details-tool-actions', {},
    h(`span.tool-switch${pending ? '.tool-switch-pending' : ''}`, {}, h('span.tool-switch-word', { 'aria-hidden': 'true' }, word),
      toggle({ on, label, disabled: !!why || !canWrite(), onchange: () => (now1 ? switchPluginItem(item) : flipPluginItem(item)), id })),
    page ? smallAction('Plugin’s page', `${id}-page`, page, '.tool-link') : null);
}

/**
 * Items that tools have through a plugin, turned on or off on Apply all with each tool's own switch (pluginswitch.ts).
 * One draft for the Skills, MCP servers and Agents pages: a whole plugin chosen to go off on one page shows as waiting on
 * the others' rows of that plugin too, and Apply all on any of them runs them all.
 */
const pluginDraft: PluginDraft = new Map();
/** The home the plugin draft was chosen in: opening another starts clean. */
let pluginDraftHome: string | undefined;

/** Every item a tool has through a plugin, on whichever page it is listed: what the plugin draft may change. */
const pluginItemsAll = (): PluginItemAt[] => (state.home?.pluginItems ?? []).flatMap(install => install.items.map(entry => ({ kind: entry.kind, name: entry.name, tool: install.tool, install })));
/** How many of them turn on, and how many off, on Apply all. */
function pluginTurns(): { on: number; off: number } {
  const turning = pluginDraft.size ? pluginItemsAll().map(item => pluginStanding(pluginDraft, item)).filter(({ now, on }) => now !== on) : [];
  return { on: turning.filter(({ on }) => on).length, off: turning.filter(({ on }) => !on).length };
}
/** How many plugin items change on Apply all; at least one while any plugin switch is chosen. */
function pluginSwitchCount(): number {
  const { on, off } = pluginTurns();
  return pluginDraft.size ? Math.max(1, on + off) : 0;
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
    'Central Knot doesn’t sync it or change its files; its switch here is the tool’s own.'));
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
  return h(`div.compare.details.details-plugin${placement === 'row' ? '' : '.details-bare'}`, { role: 'region', 'aria-label': `Details for ${row.name}` },
    h('div.details-head', {},
      h('p.details-status', {}, `From the plugin ${row.plugin}`),
      kind === 'mcp' && row.description ? h('dl.details-definition', {}, h('dt', {}, 'Type'), h('dd', {}, type === 'Command' ? 'Command (stdio)' : type), h('dt', {}, type === 'Command' ? 'Command' : 'URL'), h('dd.mono', {}, rest.join(' · ')))
        : row.description ? h('p.details-description', {}, row.description) : null,
      handledNote(row, '', `open-whole-${row.key}`),
      row.kind === 'mcp' ? null : h('div.details-actions', {}, smallAction(shown ? `Hide its ${file}` : `Show its ${file}`, `pfile-${row.key}`, () => toggleFile(row)))),
    h('div.details-tools', {}, toolList().map(tool => {
      const install = row.copies[tool as HarnessId] ? row.installs[tool as HarnessId] : undefined;
      const item: PluginItemAt | undefined = install && { kind: row.kind, name: row.name, tool: tool as HarnessId, install };
      return h('div.details-tool', {}, h('div.details-tool-head', {},
        h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
        h('span.details-tool-line', {}, [toolWords(row, tool as HarnessId), item ? cantSwitch(item) ?? pendingWords(shownDraft(), item) : ''].filter(Boolean).join(' ')),
        item ? pluginItemControls(item, `enable-${row.key}-${tool}`) : null));
    })),
    !shown ? null : !copies?.length ? h('p.details-limits', {}, copies ? 'Its file couldn’t be read.' : 'Reading…')
      : h('div.plugin-file', {}, fileBlocks(`pfile-${row.key}-text`, file, copies, holders => `${file} · ${andList(holders.map(holder => names[holder.tool]))}`, { named: copies.length > 1 })));
}

/** A plugin item's row: its name with the plugin's mark and a box per tool (on a page with one switch: its switch, then a mark per tool). */
function pluginRowEl(row: PluginRow) {
  const open = view.comparing === row.key;
  if (oneSwitch()) return [
    h(`div.ov-row.ov-switch-row.unmanaged.ov-plugin-row${open ? '.open' : ''}`, { role: 'row', 'data-key': row.key, 'aria-expanded': String(open), onclick: () => openRow(row.key) },
      h('div.ov-managed', { role: 'cell' }, pluginRowSwitch(row)),
      h('div.ov-name.ov-name-fit.ov-name-bare', { role: 'cell', title: row.description ? `${row.name}: ${row.description}` : row.name },
        h('span.ov-name-main', {}, h('span.ov-name-text', {}, row.name)),
        pluginTag(row.plugin, insideTitle(row)),
        row.description ? h('span.ov-name-about', { title: row.description }, row.description) : null),
      h('div.ov-marks', { role: 'cell' }, h('span.tool-marks', { role: 'img', 'aria-label': toolList().map(tool => cellWords(row, tool as HarnessId)).join('. ') },
        toolList().map(tool => {
          const look: MarkLook = !row.copies[tool as HarnessId] ? 'none' : offIn(row, tool as HarnessId) ? 'off' : 'on';
          const mark = toolMark(look, tool);
          mark.id = `cell-${row.key}-${tool}`;
          mark.title = cellWords(row, tool as HarnessId);
          Object.assign(mark.dataset, { tool, look, state: { none: 'plugin-none', off: 'plugin-off' }[look as string] ?? 'plugin' });
          return mark;
        }))),
      h('div.ov-open', { role: 'cell' }, openButton(row.key, row.name))),
    open && !docked() ? pluginDetails(row) : null,
  ];
  return [
    h(`div.ov-row.unmanaged.ov-plugin-row${open ? '.open' : ''}`, { role: 'row', 'data-key': row.key, 'aria-expanded': String(open), onclick: () => openRow(row.key) },
      h('div.ov-name.ov-name-fit', { role: 'cell', title: row.description ? `${row.name}: ${row.description}` : row.name },
        h('button.row-open', { type: 'button', id: `open-${row.key}`, 'aria-label': `${open ? 'Hide' : 'Show'} details for ${row.name}`, onclick: (event: Event) => { event.stopPropagation(); openRow(row.key); } },
          icon(open ? 'chevron-down' : 'chevron-right', 14, 'tone-faint')),
        h('span.ov-name-main', {}, h('span.ov-name-text', {}, row.name)),
        pluginTag(row.plugin, insideTitle(row)),
        row.description ? h('span.ov-name-about', { title: row.description }, row.description) : null),
      h('div.ov-managed', { role: 'cell', title: 'Not managed: it comes with the plugin' }),
      toolList().map(tool => h('div.ov-cell', { role: 'cell', 'data-tool': tool }, pluginCell(row, tool, `cell-${row.key}-${tool}`)))),
    open && !docked() ? pluginDetails(row) : null,
  ];
}

/** The plugin items' own section, after the person's own items: counted apart, since nothing here manages them. */
function pluginSection(list: PluginRow[]) {
  if (!list.length) return null;
  return h('div', { role: 'rowgroup' },
    h('div.ov-section.ov-section-plugins', { role: 'row' }, h('div.ov-section-label', { role: 'cell' }, h('strong', {}, 'From plugins'), h('span.ov-section-count', {}, String(list.length)),
      sectionNote(oneSwitch() ? 'they come and go with their plugin' : 'they come and go with their plugin; a box turns it, or its plugin, on or off in that tool'))),
    list.flatMap(pluginRowEl));
}

/** Installed plugins whose copy couldn't be read in the tools this table is about: what they bring is missing, and why. */
function unreadBand() {
  const list = plugged().unread.filter(install => !focus || install.tool === focus);
  if (!list.length) return null;
  return h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
    h('span.band-text', {}, list.slice(0, 3).map(install => `What ${install.plugin} brings in ${names[install.tool]} isn’t listed: ${install.problem}`).join(' · ') + (list.length > 3 ? ` · and ${list.length - 3} more` : '')));
}
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY_MS);
  return days <= 0 ? 'edited today' : days === 1 ? 'edited yesterday' : days < 14 ? `edited ${days} days ago` : days < 60 ? `edited ${Math.floor(days / 7)} weeks ago` : `edited ${Math.floor(days / 30)} months ago`;
};

/** The real home's facts in the shape the page works with. */
const fromFacts = (facts: SkillFacts): SampleSkill => ({
  key: facts.key, name: facts.name, description: facts.description, gone: facts.gone, converted: facts.converted, limits: facts.limits, oneWay: facts.oneWay, kept: facts.kept, stopped: facts.stopped, managed: facts.managed, off: facts.off, cannot: facts.cannot, plugin: facts.plugin, held: facts.held, separate: facts.separate, edited: facts.edited,
  blocks: facts.choiceBlocks, hashes: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.hash])),
  // A tool reading two different copies has copies that differ, even if one of them matches the other tool.
  copies: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, facts.extra.some(extra => extra.tool === tool && extra.hash !== copy!.hash) ? `mixed:${tool}` : copy!.hash])
    // A stopped one-way copy is the person's own now: it never makes the others look different. Its own box says it stopped.
    .map(([tool, hash]) => [tool, facts.stopped?.includes(tool as HarnessId) ? Object.entries(facts.copies).find(([other]) => !facts.stopped!.includes(other as HarnessId))?.[1]?.hash ?? hash : hash])),
  extra: facts.extra.map(extra => ({ tool: extra.tool, directory: extra.directory, summary: extra.summary, writable: extra.writable, same: extra.hash === facts.copies[extra.tool]?.hash, ...(extra.outside ? { outside: extra.outside } : {}) })),
  paths: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.directory])),
  // An MCP entry has no lines or edit date of its own: its details name the file it lives in.
  versions: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.lines ? { lines: `${copy!.lines} lines`, changed: ago(copy!.modified), text: copy!.summary || facts.description } : { lines: copy!.directory.split('/').pop() ?? '', changed: 'MCP entry', text: copy!.summary }])),
  disabled: facts.disabled, switchProblem: facts.switchProblem, disableNote: facts.disableNote, writable: Object.fromEntries(Object.entries(facts.copies).map(([tool, copy]) => [tool, copy!.writable])),
  reads: Object.fromEntries(Object.entries(facts.copies).flatMap(([tool, copy]) => (copy!.readsFrom ? [[tool, copy!.readsFrom]] : []))),
  outside: Object.fromEntries(Object.entries(facts.copies).flatMap(([tool, copy]) => (copy!.outside ? [[tool, copy!.outside]] : []))),
  brokenLink: facts.brokenLink,
  ...(facts.outsideBack ? { outsideBack: true } : {}),
});

/** One item as a table row. `waiting`: MCP servers whose Claude Code entry waits for Write to Claude Code, which their cell says. */
const rowOf = (fact: SkillFacts, waiting: Set<string>): SampleSkill => ({ ...fromFacts(fact), waits: waiting.has(fact.key) ? ['claude-cli'] : undefined });

/** The MCP or agents view behind this table; skills have their own. */
const listView = () => (kind === 'mcp' ? state.home?.mcp : kind === 'agents' ? state.home?.agents : undefined);
/** The kind's column header ("Server") and its title ("MCP servers"), from words.ts kindNouns. */
const nouns = Object.fromEntries((['skills', 'mcp', 'agents'] as const).map(each => [each, [kindNouns[each].short[0].replace(/^./, first => first.toUpperCase()), kindNouns[each].title]])) as Record<Kind, [string, string]>;
/** The kind's noun for `n` of them: "skill", "MCP servers". */
const word = (n: number) => (n === 1 ? kindNouns[kind].one : kindNouns[kind].many);
/** `n` of the kind, counted: "1 skill", "2 MCP servers". */
const counted = (n: number) => plural(n, kindNouns[kind].one, kindNouns[kind].many);
/** What this table shows: skills, MCP servers or agents. Each keeps its own pending changes; the same marks mean the same things. */
let kind: Kind = 'skills';
/** Whether a profile switch turned this item off in this tool, not a Disable made by hand. */
const turnedOffByProfile = (key: string, tool: Tool) => kind !== 'agents' && !!state.home?.profiles.offByProfile[itemId(kind === 'mcp' ? 'mcp' : 'skill', key)]?.includes(tool as HarnessId);
const factsCache: Partial<Record<Kind, { from: unknown; gone: unknown; list: SampleSkill[] }>> = {};
/**
 * One kind in a home: its facts, the tools that can hold it (Pi has no agents), and the MCP servers whose Claude Code entries
 * wait for Write now (their cells say so instead of reading as differing copies). The tables and Harnesses both read it.
 */
export function kindSource(home: HomeView, which: Kind): { tools: Tool[]; facts: SkillFacts[]; waiting: string[]; gone: SkillFacts[] } {
  if (which === 'skills') return { tools: home.manage.tools, facts: home.manage.skills, waiting: [], gone: home.manage.gone ?? [] };
  const list = which === 'mcp' ? home.mcp : home.agents;
  return { tools: list.tools, facts: list.servers, waiting: which === 'mcp' ? list.claudePending : [], gone: [] };
}
function committedList(): SampleSkill[] {
  if (designMode) return view.committed;
  if (!state.home) return [];
  // Items with no copy left are rows too, switched off, while History can put them back.
  const { facts, waiting, gone } = kindSource(state.home, kind);
  if (factsCache[kind]?.from !== facts || factsCache[kind]?.gone !== gone) { const waits = new Set(waiting); factsCache[kind] = { from: facts, gone, list: [...facts, ...gone].map(fact => rowOf(fact, waits)) }; }
  return factsCache[kind]!.list;
}
/** The harness a Harnesses page shows: its column comes first, and bulk actions keep to what it has. */
let focus: Tool | undefined;
const toolList = (): Tool[] => {
  const list = designMode ? sampleTools : state.home ? kindSource(state.home, kind).tools : [];
  return focus && list.includes(focus) ? [focus, ...list.filter(tool => tool !== focus)] : list;
};
/** Whether the focused harness has its own copy; with no focus, every item counts. */
const inFocus = (skill: SampleSkill) => !focus || inTool(skill, focus as HarnessId);
/**
 * A row's place as things stand before pending changes, so it stays put until Apply all: 0 managed, 1 unmanaged, 2 no tool
 * uses it (roworder.ts). The bulk actions (Manage all, Add all) leave the last kind alone; each row's own controls still work.
 */
const standingOf = (skill: SampleSkill) => standing(committedOf(skill.key), toolList());
/** The visit, read and home a table's rows were last placed in (view.pinned): any of them changing regroups the rows. */
const pinKey = () => `${state.visit}:${state.reads}:${state.home?.home ?? ''}`;
/** A row's group: where it stood when a click on this visit first changed something (pinRows), else where it stands now. */
const placeOf = (skill: SampleSkill) => (view.pinned?.at === pinKey() ? view.pinned.places.get(skill.key) : undefined) ?? standingOf(skill);
/** The headings, by place: a page with one switch per item says On, Not synced and Off. */
const places = { switch: ['On', 'Not synced', 'Off'], managed: ['Managed', 'Unmanaged', 'Disabled everywhere'] } as const;
const placeNames = () => (oneSwitch() ? places.switch : places.managed);
/** Whether some tool uses the item once pending changes apply: it has or gets a copy there that isn't disabled (what a plugin brings is the plugin's, as roworder.ts standing has it). */
const usedAfter = (skill: SampleSkill) => toolList().some(tool => hasCopyAfterApply(skill, tool) && !skill.disabled?.includes(tool));
/** Copies differ and need a choice, among the items this page is about: on a harness's page, the ones it has. */
const needsChoice = (skill: SampleSkill) => inFocus(skill) && syncOf(skill, toolList()) === 'attention';

/**
 * How many items one tool has whose copies differ and need a choice: what the "Copies differ" chip counts on that tool's
 * Harnesses page, read from the facts the same way the table reads them. `waiting`: MCP servers waiting for Claude Code.
 */
export function differingIn({ facts, tools, waiting }: ReturnType<typeof kindSource>, tool: Tool) {
  const waits = new Set(waiting);
  return facts.filter(fact => fact.copies[tool as HarnessId] !== undefined && syncOf(rowOf(fact, waits), tools) === 'attention').length;
}
const other = (tool: Tool) => toolList().find(entry => entry !== tool)!;
const others = (tool: Tool) => toolList().filter(entry => entry !== tool);
type Filter = 'all' | 'managed' | 'unmanaged' | 'attention' | 'plugins';
type Resolution = Tool | 'separate';
/** `prior` is the Managed state before a copy choice, so undoing the choice puts it back. */
interface Draft { managed: boolean; off: Tool[]; resolve?: Resolution; prior?: boolean; /** The chosen copy's content ID when it was chosen. */ seen?: string; /** Whether the skill was managed when this change was first made: a change made against an older state is dropped, never applied. */ seenManaged?: boolean;
  /** Skills: the switches clicked here, by tool (true: disable). Only these are sent, so a switch flipped elsewhere meanwhile stays. */ switches?: Partial<Record<Tool, boolean>>;
  /** Skills: tools whose copy is removed. */ remove?: Tool[] }

const newView = () => ({
  committed: sample.map(skill => ({ ...skill })),
  draft: new Map<string, Draft>(),
  /** When the draft last changed (state.said.seq): a result said before that steps aside for the pending changes. */
  draftSaid: 0,
  filter: 'all' as Filter,
  find: '',
  /** The skill whose details are open under its row. */
  comparing: undefined as string | undefined,
  /** The harness whose page this view was last drawn on (undefined: the kind's own page). */
  shownFor: undefined as Tool | undefined,
  /** What the Skills page list is narrowed to. */
  listFind: '',
  /** The skill whose Delete everywhere is waiting for its confirming click. */
  confirmDelete: undefined as string | undefined,
  /** The managed skill whose Replace with managed copies is waiting for its confirming click. */
  confirmTakeOver: undefined as string | undefined,
  /** The Files view's "Where each copy is", once the person opens or closes it; until then it follows the pane's width. */
  whereOpen: undefined as boolean | undefined,
  /** Each row's group when a click on this visit first changed something (pinRows), and when that was (pinKey). */
  pinned: undefined as { at: string; places: Map<string, 0 | 1 | 2> } | undefined,
});
const views: Record<Kind, ReturnType<typeof newView>> = { skills: newView(), mcp: newView(), agents: newView() };
/** Changes chosen in the skills, MCP servers and agents tables and not yet applied. */
export const changesWaiting = () => Object.values(views).reduce((sum, view) => sum + view.draft.size, pluginDraft.size);
/**
 * Opens a page already narrowed, for links that point at a problem (the Overview's or a harness card's "different copies").
 * `harness`: the harness page it opens on (none: the kind's own page), so the first draw there keeps this filter.
 */
export const showFiltered = (which: Kind, filter: Filter, harness?: Tool) => { startFresh(views[which], harness); views[which].filter = filter; };
/** A table drawn for another page (a harness's, or the kind's own) starts with no filter, Find text, open row or menu from the last one. */
function startFresh(table: ReturnType<typeof newView>, harness: Tool | undefined) {
  Object.assign(table, { filter: 'all', find: '', comparing: undefined, confirmDelete: undefined, confirmTakeOver: undefined, shownFor: harness });
}
/** Opens an item's details on its own page (Skills, MCP servers or Agents), found by name, and scrolls it into view. */
export function openItem(which: Kind, name: string) {
  const facts = which === 'skills' ? state.home?.manage.skills : which === 'mcp' ? state.home?.mcp.servers : state.home?.agents.servers;
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
let draftHomes: Partial<Record<Kind, string>> = {};

const committedOf = (key: string) => committedList().find(skill => skill.key === key)!;

/** A skill as it will be after Apply all. */
function effective(skill: SampleSkill): SampleSkill {
  const draft = view.draft.get(skill.key);
  if (!draft) return skill;
  const next: SampleSkill = { ...skill, managed: draft.managed, off: draft.off, disabled: withSwitches(skill.disabled, draft.switches), removing: draft.remove };
  // MCP: turning Claude Code on for a server means a Write to Claude Code after Apply all, so its cell says so before.
  if (kind === 'mcp' && draft.managed && !draft.off.includes('claude-cli') && toolList().includes('claude-cli') && !skill.waits?.length) {
    const others = Object.entries(skill.copies).filter(([tool]) => tool !== 'claude-cli' && !draft.off.includes(tool)).map(([, copy]) => copy);
    if (skill.copies['claude-cli'] === undefined || others.some(copy => copy !== skill.copies['claude-cli'])) next.waits = ['claude-cli'];
  }
  if (draft.managed && draft.resolve !== 'separate') next.separate = false;
  if (draft.resolve === 'separate') next.separate = true;
  else if (draft.resolve) {
    const id = skill.copies[draft.resolve]!;
    const compared = comparedTools(next);
    next.copies = Object.fromEntries(Object.entries(skill.copies).map(([tool, copy]) => [tool, compared.includes(tool) ? id : copy]));
  }
  return next;
}

const rows = () => committedList().map(effective);

function edit(key: string, change: (skill: SampleSkill, draft?: Draft) => Draft) {
  const base = committedOf(key);
  const before = view.draft.get(key);
  // A pending Disable or Remove stays through other changes to the same item, unless the change itself sets it.
  const next: Draft = { switches: before?.switches, remove: before?.remove, ...change(effective(base), before), seenManaged: before?.seenManaged ?? base.managed };
  const sameSet = (first: Tool[] = [], second: Tool[] = []) => [...first].sort().join() === [...second].sort().join();
  const same = !next.resolve && next.managed === base.managed && sameSet(next.off, base.off) && !next.remove?.length && !Object.keys(next.switches ?? {}).length;
  if (same) view.draft.delete(key); else view.draft.set(key, next);
  announce(view.draft.size ? `${view.draft.size} ${view.draft.size === 1 ? 'change' : 'changes'} not applied yet.` : 'No changes.', true);
  view.draftSaid = state.said.seq;
}

// Turning a skill on undoes "keep both"; turning it off drops a chosen copy. The page then shows what Apply all will do.
const keepResolve = (managed: boolean, resolve?: Resolution) => (managed ? (resolve === 'separate' ? undefined : resolve) : undefined);

const keepPrior = (resolve: Resolution | undefined, draft?: Draft) => (resolve ? draft?.prior : undefined);
const keepChoice = (resolve: Resolution | undefined, draft?: Draft) => ({ resolve, prior: keepPrior(resolve, draft), seen: resolve ? draft?.seen : undefined });

function setManaged(keys: string[], managed: boolean) {
  for (const key of keys) edit(key, (skill, draft) => { return { managed, off: skill.off, ...keepChoice(keepResolve(managed, draft?.resolve), draft) }; });
  rerender();
}

function setTool(keys: string[], tool: Tool, on: boolean) {
  for (const key of keys) edit(key, (skill, draft) => {
    const managed = on ? true : skill.managed;
    // On a harness's page, ticking its own box for an unmanaged item adds it here without writing to tools that lack it.
    const off = on && tool === focus && !skill.managed ? toolList().filter(entry => entry !== tool && skill.copies[entry] === undefined) : on ? skill.off.filter(entry => entry !== tool) : [...new Set([...skill.off, tool])];
    return { managed, off, ...keepChoice(keepResolve(managed, draft?.resolve), draft) };
  });
  rerender();
}

/** The tools a skill is disabled in, with the switches clicked here laid over what each tool has now. */
const withSwitches = (now: Tool[] = [], switches: Draft['switches'] = {}) =>
  toolList().filter(tool => switches[tool] ?? now.includes(tool));

/** Skills: disable or enable one tool's copy on Apply all, with that tool's own switch. Clicking it back to how it is now drops it. */
function setDisabledIn(key: string, tool: Tool, disabled: boolean) {
  edit(key, (skill, draft) => {
    const switches = { ...draft?.switches };
    if (disabled === !!committedOf(key).disabled?.includes(tool)) delete switches[tool]; else switches[tool] = disabled;
    return { managed: skill.managed, off: skill.off, ...keepChoice(keepResolve(skill.managed, draft?.resolve), draft), switches };
  });
  rerender();
}

/** Whether a tool has (or gets on Apply all) a copy of this skill, so a switch there has something to act on. */
const hasCopyAfterApply = (skill: SampleSkill, tool: Tool) => !['absent', 'cannot'].includes(cellOf(skill, tool)) && !skill.removing?.includes(tool);

/** Skills: whether this tool's switch is clicked to change on Apply all. */
const switchQueued = (key: string, tool: Tool) => view.draft.get(key)?.switches?.[tool] !== undefined;

/** Skills: the switches a draft changes, as Apply all sends them; a Disable clicked for a tool that then won't have a copy is dropped. */
function switchChanges(key: string, draft: Draft): { disable?: Tool[]; enable?: Tool[] } {
  const after = effective(committedOf(key));
  const clicked = (Object.entries(draft.switches ?? {}) as [Tool, boolean][]).filter(([tool, off]) => !off || hasCopyAfterApply(after, tool));
  const disable = clicked.filter(([, off]) => off).map(([tool]) => tool), enable = clicked.filter(([, off]) => !off).map(([tool]) => tool);
  return { ...(disable.length ? { disable } : {}), ...(enable.length ? { enable } : {}) };
}

/** Skills: remove these tools' copies on Apply all, or keep them again. (For a managed skill, Apply all also stops syncing there.) */
function setRemoved(key: string, tools: Tool[], remove: boolean) {
  edit(key, (skill, draft) => {
    const removing = remove ? [...new Set([...(draft?.remove ?? []), ...tools])] : (draft?.remove ?? []).filter(tool => !tools.includes(tool));
    return { managed: skill.managed, off: skill.off, ...keepChoice(keepResolve(skill.managed, draft?.resolve), draft), remove: removing };
  });
  rerender();
}

/** Delete everywhere for an unmanaged skill: every copy Central Knot may change is removed now (kept in History), apart from other queued changes. */
const removeEverywhere = (key: string) => {
  const base = committedOf(key);
  const tools = removable(base);
  // Said like the synced skill's Delete everywhere: the tools, and the shared folder when its copy goes too.
  const shared = shapeOf(base).shared;
  return applyClick({ kind, items: [nameOf(base)], changes: [{ key, managed: false, off: base.off, remove: tools, everywhere: true, seenManaged: false }] as Change[],
    said: deletedText(nameOf(base), tools.map(tool => names[tool]), shared ? [folderOf(shared.path)] : []) });
};

/** Whether a tool's cell shows this skill as disabled there: the switch is off (or queued off) and the tool has, or gets, a copy. */
const shownDisabled = (skill: SampleSkill, tool: Tool) => !!skill.disabled?.includes(tool) && !['cannot', 'absent'].includes(cellOf(skill, tool)) && !skill.removing?.includes(tool);

/** Tools whose copy isn't queued for removal: a removal stops syncing there on Apply all, so status lines don't count it. */
const keptTools = (skill: SampleSkill) => toolList().filter(tool => !skill.removing?.includes(tool));

/** Tools whose copy Delete everywhere can remove: Central Knot's own kind of copy, or one outside it (a link, the shared folder's). */
const removable = (skill: SampleSkill) => toolList().filter(tool => skill.copies[tool] !== undefined && (skill.writable?.[tool] !== false || !!skill.outside?.[tool]));

/**
 * Tools whose copy Remove can take out on its own: not the shared folder's copy while another tool reads it there too (that
 * would take it from them as well; Disable or Delete everywhere is the way), nor the only copy a tool can have.
 */
const removableHere = (skill: SampleSkill, tool: Tool) => {
  if (!removable(skill).includes(tool)) return false;
  const outside = skill.outside?.[tool];
  if (outside?.kind !== 'shared') return true;
  return !outside.pinned && outsideCopies(skill).find(copy => copy.path === skill.paths?.[tool])?.tools.length === 1;
};

// ---------- Copies outside Central Knot's own: links in tools' folders, the copy in the shared ~/.agents/skills ----------

interface OutsideCopy extends Outside { path: string; tools: Tool[] }
/** Each copy outside Central Knot's own, once per folder, with every tool that reads it there. */
function outsideCopies(skill: SampleSkill): OutsideCopy[] {
  const found = new Map<string, OutsideCopy>();
  const add = (tool: Tool, path: string, outside: Outside) => {
    const known = found.get(path);
    if (!known) found.set(path, { ...outside, path, tools: [tool] });
    else if (!known.tools.includes(tool)) known.tools.push(tool);
  };
  for (const tool of toolList()) if (skill.outside?.[tool] && skill.paths?.[tool]) add(tool, skill.paths[tool]!, skill.outside[tool]!);
  for (const extra of skill.extra ?? []) if (extra.outside && toolList().includes(extra.tool)) add(extra.tool, extra.directory, extra.outside);
  return [...found.values()].map(copy => ({ ...copy, tools: toolList().filter(tool => copy.tools.includes(tool)) }));
}
/** The folder a copy sits in, as the page shows paths: "~/.agents/skills". */
const folderOf = (path: string) => shownPath(path.replace(/\/[^/]+$/, ''));
/** Whether a tool keeps a real copy of its own besides the outside ones (one Central Knot writes). */
const ownReal = (skill: SampleSkill, tool: Tool) => skill.copies[tool] !== undefined && skill.writable?.[tool] !== false && !skill.outside?.[tool];

/** A tool it syncs to: not left out, and able to hold the skill. */
const syncsTo = (skill: SampleSkill, tool: Tool) => !skill.off.includes(tool) && !skill.cannot?.[tool];

/**
 * Whether turning it on takes this skill over (OWN-02): when it wasn't synced, or a copy is chosen, and it has a link or shared
 * copy that can be replaced. Any other click on a synced skill (a tool's switch, Remove) leaves them; Replace with managed copies
 * does it on its own.
 */
const takesOver = (skill: SampleSkill, chosen = false) => (!skill.managed || chosen) && outsideCopies(skill).some(copy => !copy.pinned);

/**
 * What taking the skill over will do (turning it on, or Replace with managed copies), for the tools it syncs to: links that
 * become real copies, tools that read the shared copy and get their own, and tools left out that read it only there, which
 * lose it. As manage.ts takeOver does it: a copy that is the only one a tool can have (pinned) is never taken over.
 */
function takeOverPlan(skill: SampleSkill): { links: Tool[]; gets: Tool[]; loses: Tool[]; everyTool: boolean } {
  const copies = outsideCopies(skill).filter(copy => !copy.pinned);
  const ticked = (tool: Tool) => syncsTo(skill, tool);
  const links = copies.filter(copy => copy.kind === 'link').flatMap(copy => copy.tools).filter(ticked);
  const gets: Tool[] = [], loses: Tool[] = [];
  for (const copy of copies.filter(entry => entry.kind === 'shared')) {
    const has = (tool: Tool) => links.includes(tool) || ownReal(skill, tool) || !!skill.reads?.[tool];
    gets.push(...copy.tools.filter(tool => ticked(tool) && !has(tool) && !gets.includes(tool)));
    loses.push(...copy.tools.filter(tool => !ticked(tool) && !has(tool) && !loses.includes(tool)));
  }
  // Every tool it will sync to ends with a real copy of its own: replaced, given one, written afresh, or already there.
  const everyTool = toolList().filter(ticked).every(tool => links.includes(tool) || gets.includes(tool) || ownReal(skill, tool) || (skill.copies[tool] === undefined && !skill.reads?.[tool]));
  return { links, gets, loses, everyTool };
}
const namedPlan = (plan: ReturnType<typeof takeOverPlan>) => ({ links: plan.links.map(tool => names[tool]), gets: plan.gets.map(tool => names[tool]), loses: plan.loses.map(tool => names[tool]), everyTool: plan.everyTool });
/** The plan as it would be once turned on, synced to every tool: what turning it on would do. */
const planIfOn = (skill: SampleSkill) => takeOverPlan({ ...skill, managed: true, off: [] });

/** Whether a link leads to the shared copy (resolved against the folder it sits in), so taking the skill over removes what it leads to as well. */
const leadsTo = (link: OutsideCopy, shared: OutsideCopy | undefined) => {
  if (!shared || link.linkTo === undefined) return false;
  const target = linkTarget(link.path, link.linkTo);
  return target === shared.path || target.endsWith(`/.agents/skills/${shared.path.split('/').pop()}`);
};

/** The skill's copies outside Central Knot's own, said by who reaches the shared copy how, and which links lead elsewhere (outsidewords.ts). */
function shapeOf(skill: SampleSkill): { shape: Shape; shared?: OutsideCopy; linkers: Tool[]; elsewhere: Tool[]; pinnedBy?: Tool } {
  const copies = outsideCopies(skill);
  const shared = copies.find(copy => copy.kind === 'shared');
  const links = copies.filter(copy => copy.kind === 'link');
  const linkers = links.filter(link => leadsTo(link, shared)).flatMap(link => link.tools);
  const away = links.filter(link => !leadsTo(link, shared));
  const pinnedBy = shared?.pinnedBy && toolList().includes(shared.pinnedBy as Tool) ? shared.pinnedBy as Tool : undefined;
  const besides = shared ? shared.tools.filter(tool => ownReal(skill, tool) && !linkers.includes(tool) && tool !== pinnedBy) : [];
  const readers = shared ? shared.tools.filter(tool => !ownReal(skill, tool) && !linkers.includes(tool) && tool !== pinnedBy) : [];
  return {
    shape: {
      shared: shared ? { folder: folderOf(shared.path), readers: readers.map(tool => names[tool]), linkers: linkers.map(tool => names[tool]), besides: besides.map(tool => names[tool]), ...(pinnedBy ? { pinnedBy: names[pinnedBy] } : {}), ...(shared.linkTo !== undefined ? { isLink: true } : {}) } : undefined,
      elsewhere: away.flatMap(link => link.tools.map(tool => ({ tool: names[tool], target: shownPath(linkTarget(link.path, link.linkTo ?? '')) }))),
      ownCopies: toolList().some(tool => ownReal(skill, tool)),
    },
    shared, linkers, elsewhere: away.flatMap(link => link.tools), pinnedBy,
  };
}

/** A tool that has the skill only as a link or the shared copy: no real copy of its own, and none read in another tool's folder. */
const outsideOnly = (skill: SampleSkill, tool: Tool) => skill.copies[tool] !== undefined && !ownReal(skill, tool) && !skill.reads?.[tool]
  && (!!skill.outside?.[tool] || shapeOf(skill).pinnedBy === tool);

/** A synced skill's tools that have only a link or the shared copy, which Central Knot doesn't write: never called synced. */
function notSynced(skill: SampleSkill): Tool[] {
  if (kind !== 'skills' || !skill.managed) return [];
  return toolList().filter(tool => !skill.off.includes(tool) && outsideOnly(skill, tool));
}

/** Said after a synced skill's status when some tools read only a link or the shared copy: edits never reach them. */
function outsideStatus(skill: SampleSkill): string {
  const readers = notSynced(skill);
  if (!readers.length) return '';
  const away = shapeOf(skill).elsewhere;
  const via = readers.every(tool => !away.includes(tool)) ? 'shared' : readers.every(tool => away.includes(tool)) ? 'link' : 'both';
  return readsOutside(readers.map(tool => names[tool]), via);
}

/** One tool's row: where it gets the skill today, when that is a link or the shared copy. */
function outsideRow(skill: SampleSkill, tool: Tool): string {
  if (kind !== 'skills' || skill.copies[tool] === undefined) return '';
  const { shared, pinnedBy } = shapeOf(skill);
  const folder = shared ? folderOf(shared.path) : '~/.agents/skills';
  if (pinnedBy === tool) return rowWords.pinned(folder);
  const outside = skill.outside?.[tool];
  const path = skill.paths?.[tool];
  if (outside?.kind === 'link' && path) {
    const link: OutsideCopy = { ...outside, path, tools: [tool] };
    return leadsTo(link, shared) ? rowWords.linkToShared(folder) : rowWords.linkElsewhere(shownPath(linkTarget(path, outside.linkTo ?? '')));
  }
  if (outside?.kind === 'shared') return rowWords.readsShared(folder);
  return ownReal(skill, tool) && shared?.tools.includes(tool) ? rowWords.alsoShared(folder) : '';
}

/** What Delete everywhere removes besides each tool's own copy, and what it can't, said before the click. */
function deleteSteps(skill: SampleSkill): string {
  const { shape, linkers, shared } = shapeOf(skill);
  // A copy inside a skills folder that is itself a link: never changed, so it is said now rather than after.
  const stays = toolList().filter(tool => skill.copies[tool] !== undefined && skill.writable?.[tool] === false && !skill.outside?.[tool] && !skill.reads?.[tool] && !shared?.tools.includes(tool));
  const blocked = stays.map(tool => `${names[tool]}’s copy stays. ${state.home?.manage.writes[tool as HarnessId]?.blocked ?? `${names[tool]}’s skills folder is a link, so Central Knot does not change what is in it.`}`);
  return [deleteNote(shape, linkers.map(tool => names[tool])), ...blocked].filter(Boolean).join(' ') || 'History keeps it.';
}

function resolve(key: string, choice: Resolution | undefined) {
  edit(key, (skill, draft) => {
    const prior = draft?.resolve ? draft.prior ?? committedOf(key).managed : skill.managed;
    const off = draft?.off ?? skill.off;
    return choice ? { managed: choice !== 'separate', off, resolve: choice, prior, seen: choice === 'separate' ? undefined : committedOf(key).hashes?.[choice] } : { managed: prior, off };
  });
  view.comparing = undefined;
  rerender();
}

/** Applies the copies' changes chosen on this page (MCP servers and agents: skills apply each click at once); the draft is cleared once they are written. */
function applyCopies(): Promise<void> {
  const changes = [...view.draft].map(([key, draft]) => ({ key, managed: draft.managed, off: draft.off, use: draft.resolve, useHash: draft.seen, seenManaged: draft.seenManaged,
    ...switchChanges(key, draft), ...(draft.remove?.length ? { remove: draft.remove } : {}) })) as Change[];
  const drafts = view.draft;
  return kind === 'mcp' ? applyMcpChanges(changes, () => drafts.clear()) : applyAgentsChanges(changes, () => drafts.clear());
}

function applyAll() {
  const count = view.draft.size;
  if (designMode) {
    view.committed = view.committed.map(skill => applied(effective(skill)));
    view.draft.clear();
    announce(`${count} ${count === 1 ? 'change' : 'changes'} applied.`);
    rerender();
    return;
  }
  if (!pluginDraft.size) { void applyCopies(); return; }
  // Both kinds chosen: the copies first, then the plugin items' switches, whose result carries the copies' with it. Copies
  // that could not be applied (they stay chosen) stop it there, with the plugin switches still chosen.
  void (async () => {
    // As with no plugin switch chosen, Apply all also catches up what waits to sync and resumes after lost settings.
    const copies = count > 0 || pendingSyncs(committedList()) > 0 || resumeNeeded();
    if (copies) await applyCopies();
    if (copies && view.draft.size) return;
    await applyPluginSwitches([...pluginDraft.values()], pluginDraft, { before: copies ? state.outcome : undefined });
  })();
}

// ---------- Visual vocabulary ----------

const cellLook: Record<Cell, { glyph?: IconName; tone: string; label: string }> = {
  synced: { glyph: 'check', tone: 'cell-synced', label: 'Synced' },
  'will-sync': { glyph: 'check', tone: 'cell-pending', label: 'Will sync on Apply all' },
  edited: { glyph: 'pencil-line', tone: 'cell-waiting', label: 'Edited in that tool, waiting to spread' },
  waiting: { glyph: 'clock', tone: 'cell-waiting', label: 'Gets the edit when it spreads' },
  'write-now': { glyph: 'clock', tone: 'cell-waiting', label: 'Waits for Write to Claude Code' },
  differs: { glyph: 'diff', tone: 'cell-differs', label: 'Copies differ' },
  off: { tone: 'cell-present', label: 'Has a copy, not synced' },
  present: { glyph: 'circle-small', tone: 'cell-present', label: 'Has a copy, not synced' },
  'present-differs': { glyph: 'diff', tone: 'cell-differs', label: 'Copies differ' },
  absent: { tone: 'cell-absent', label: 'No copy' },
  cannot: { tone: 'cell-cannot', label: 'Cannot load it' },
};
/** A tool with no copy of its own that has the item through a plugin: drawn apart from Can’t load it, since the tool does have it. */
const PLUGIN_LOOK = { glyph: 'puzzle', tone: 'cell-plugin', label: 'Through a plugin' } as const;
const throughPluginHere = (skill: SampleSkill, tool: Tool): ThroughPlugin | undefined => (skill.copies[tool] === undefined ? skill.plugin?.[tool] : undefined);


const smallAction = (label: string, id: string, onclick: () => void, extra = '', disabled = false) =>
  h(`button.text-action${extra}`, { type: 'button', id, disabled, onclick: (event: Event) => { event.stopPropagation(); onclick(); } }, label);

// ---------- Parts every option shares ----------

function filterBar() {
  const list = committedList();
  const attention = list.filter(skill => needsChoice(effective(skill))).length;
  // Each chip has a short form, its mark, for a crowded toolbar: the whole group folds together (dom.ts fitBars), with each
  // name as its tooltip, so Apply all keeps the first line.
  const chip = (id: Filter, label: string, glyph: IconName, warn?: number) => h(`button.chip${view.filter === id ? '.chip-on' : ''}${warn ? '.chip-warn' : ''}`,
    { type: 'button', 'aria-pressed': String(view.filter === id), 'aria-label': warn !== undefined ? `${label} ${warn}` : label, 'data-tip': label, onclick: () => { view.filter = id; rerender(); } },
    icon(glyph, 13, 'chip-icon'), h('span.chip-label', {}, label), warn !== undefined ? h('span.chip-count', {}, String(warn)) : null);
  const narrowing = [oneSwitch() ? null : chip('managed', 'Managed', 'circle-check'), oneSwitch() ? null : chip('unmanaged', 'Unmanaged', 'circle-dashed'),
    copiesDifferChipShown() ? chip('attention', 'Copies differ', cellLook.differs.glyph!, attention) : null,
    pluginChipShown() ? chip('plugins', 'From plugins', 'puzzle') : null].filter(Boolean);
  // All alone narrows nothing: no chips then.
  return narrowing.length ? h('div.chips', { role: 'group', 'aria-label': 'Show' }, chip('all', 'All', 'list'), narrowing) : null;
}

// Edits waiting for Sync are not Apply all's to write: the Sync-off banner offers Sync now for them.
// MCP entries for Claude Code wait for Write now, not Apply all (MCP-02), so they are not counted here either.
const pendingSyncs = (list: SampleSkill[]) => list.filter(skill => !skill.edited?.length && toolList().some(tool => cellOf(skill, tool) === 'will-sync' && !(kind === 'mcp' && tool === 'claude-cli'))).length;
const manageable = () => committedList().filter(skill => !skill.held && inFocus(skill) && placeOf(skill) !== 2).filter(skill => !effective(skill).managed && !effective(skill).separate && syncOf(effective(skill), toolList()) !== 'attention');

const canWrite = () => designMode || (!!state.home && !whyReadOnly(state.home) && !state.busy);
const resumeNeeded = () => !designMode && state.home?.manage.gate.state === 'needs-resume';

/** What Apply all will do with the queued changes: "2 changes · 1 new copy · 1 copy to disable". */
function pendingSummary(count: number): string {
  const next = [...view.draft.keys()].map(key => effective(committedOf(key)));
  const fresh = next.reduce((total, skill) => total + toolList().filter(tool => cellOf(skill, tool) === 'will-sync' && skill.copies[tool] === undefined).length, 0);
  const replaced = next.reduce((total, skill) => total + toolList().filter(tool => replacedOnApply(skill, tool)).length, 0);
  // Skills: copies that go, and switches that flip, on Apply all.
  const removed = next.reduce((total, skill) => total + (skill.removing?.length ?? 0), 0);
  const flips = next.flatMap(skill => toolList().filter(tool => hasCopyAfterApply(skill, tool) && switchQueued(skill.key, tool)).map(tool => !!skill.disabled?.includes(tool)));
  const disabling = flips.filter(Boolean).length, enabling = flips.length - disabling;
  const copies = (n: number, what: string) => (n ? ` · ${n} ${n === 1 ? 'copy' : 'copies'} ${what}` : '');
  // Plugin items: how many turn on and off, and by name any whole plugin that goes or comes with them.
  const turns = pluginTurns();
  const whole = wholeWords(pluginDraft);
  const items = (n: number, way: string) => (n ? ` · ${n} plugin ${n === 1 ? 'item' : 'items'} to turn ${way}` : '');
  return `${plural(count, 'change')}${fresh ? ` · ${fresh} new ${fresh === 1 ? 'copy' : 'copies'}` : ''}${copies(replaced, 'to replace')}${copies(removed, 'to remove')}${copies(disabling, 'to disable')}${copies(enabling, 'to enable')}${items(turns.on, 'on')}${items(turns.off, 'off')}${whole.length ? ` (${whole.join(', ')})` : ''}`;
}

/**
 * Manage all: manages every unmanaged item that needs no copy choice. Its label counts them ("Manage both", "Manage 3 of
 * 5"); those whose copies differ are left for their own choice, and its tooltip says how many.
 */
function manageAllButton(ready: SampleSkill[], needChoice: number) {
  const label = ready.length === 1 ? 'Manage 1' : ready.length === 2 ? 'Manage both' : needChoice ? `Manage ${ready.length} of ${ready.length + needChoice}` : `Manage all ${ready.length}`;
  const waitsForChoice = needChoice ? `${needChoice} more ${needChoice === 1 ? 'needs' : 'need'} a copy choice first` : '';
  return button({ variant: 'outline', size: 'small', icon: 'circle-plus', collapse: true, label, id: 'manage-all',
    name: `Manage ${ready.length} unmanaged ${word(ready.length)}${waitsForChoice ? `; ${waitsForChoice}` : ''}`,
    attrs: needChoice ? { title: `${needChoice === 1 ? 'One skill needs' : `${needChoice} need`} a copy choice first` } : undefined,
    onclick: () => setManaged(ready.map(skill => skill.key), true) });
}

/** Pending changes and Apply all. `bulk` adds Manage all, which belongs with the whole list. */
function changeBar(bulk = true) {
  const count = view.draft.size + pluginSwitchCount();
  const waiting = pendingSyncs(committedList());
  const ready = manageable();
  // Unmanaged items whose copies differ need a choice first, so Manage leaves them out and says so.
  const needChoice = committedList().filter(skill => !skill.held && inFocus(skill) && placeOf(skill) !== 2 && !effective(skill).managed && !effective(skill).separate && syncOf(effective(skill), toolList()) === 'attention').length;
  // On a harness's page Manage steps aside under the Copies differ filter: every row shown needs a copy choice that Manage
  // leaves out, so it would act only on rows not shown.
  const manageAll = bulk && ready.length && !(focus && view.filter === 'attention') ? manageAllButton(ready, needChoice) : null;
  const label = resumeNeeded() ? 'Resume and apply all' : 'Apply all';
  if (count) {
    const pending = pendingSummary(count);
    // In a crowded toolbar the count shortens to "2 changes"; the full summary stays its tooltip and Apply all's.
    return h('div.apply', {}, manageAll,
      pendingCount(pending, plural(count, 'change')),
      button({ variant: 'ghost', size: 'small', label: 'Discard', name: 'Discard these changes', id: 'discard', onclick: () => { view.draft.clear(); pluginDraft.clear(); announce('Changes discarded. Nothing was written.'); rerender(); } }),
      button({ variant: 'primary', size: 'small', label, id: 'apply', disabled: !canWrite(), attrs: { title: `${pending}. Nothing is written until Apply all.` }, onclick: applyAll }));
  }
  if (waiting) return h('div.apply', {}, manageAll, h('span.apply-count.apply-quiet', {}, `${waiting} to sync`), button({ variant: 'primary', size: 'small', label, id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  // Lost settings stop catch-up until the person resumes, even when nothing is waiting.
  if (resumeNeeded()) return h('div.apply', {}, manageAll, button({ variant: 'primary', size: 'small', label: 'Resume', id: 'apply', disabled: !canWrite(), onclick: applyAll }));
  // "Up to date" only when nothing waits anywhere: an edit waiting for Sync, or an entry waiting for Write now, is said instead.
  const edits = committedList().filter(skill => skill.managed && skill.edited?.length).length;
  // A stopped copy whose notice is showing is said there; the toolbar says it once the notice is put aside.
  const stoppedAll = kind === 'agents' ? committedList().filter(skill => skill.managed && !view.draft.get(skill.key)?.resolve).flatMap(skill => stoppedLive(skill).map(tool => `stopped:${skill.key}:${tool}`)) : [];
  const stoppedCopies = stoppedAll.filter(key => state.dismissed.has(key)).length;
  // A copy that keeps its own edit is a settled choice, but not "the same everywhere": the toolbar counts it.
  const keptCopies = kind === 'agents' ? committedList().filter(skill => skill.managed && !view.draft.get(skill.key)?.resolve).reduce((total, skill) => total + (skill.stopped ?? []).filter(tool => !skill.off.includes(tool) && keptEdit(skill, tool)).length, 0) : 0;
  const writes = committedList().filter(skill => skill.managed && skill.waits?.length).length;
  const status = edits ? h('span.apply-state.apply-waiting', {}, icon('clock', 14, 'tone-warning'), `${edits} ${edits === 1 ? 'change' : 'changes'} waiting`)
    // The band below carries the Write action; the header only says it, so the page asks for one click in one place.
    : writes && !(kind === 'mcp' && listView()?.claudePending.length) ? h('span.apply-state.apply-waiting', { id: 'go-write-now' }, icon('clock', 14, 'tone-warning'), `${writes} ${writes === 1 ? 'server waits' : 'servers wait'} for Claude Code`)
    // The band below always carries the Write button while something waits, so the toolbar only says it, quietly.
    : writes ? h('span.apply-state.apply-quiet', {}, icon('clock', 14, 'tone-muted'), writes === 1 ? `${committedList().find(skill => skill.managed && skill.waits?.length)?.name ?? '1 server'} waits for Claude Code` : `${writes} servers wait for Claude Code`)
      // An unresolved copy choice is not "up to date", even while its chooser is open.
      : needChoice ? null
        : stoppedCopies ? h('button.apply-state.apply-waiting.text-action', { type: 'button', id: 'go-stopped', title: 'Show it', onclick: () => { const first = stoppedAll.find(key => state.dismissed.has(key))!.split(':')[1]; view.comparing = undefined; openRow(first); } }, icon('circle-pause', 14, 'tone-warning'), `${stoppedCopies} ${stoppedCopies === 1 ? 'copy' : 'copies'} stopped updating`)
          // Its notice is showing: the toolbar neither repeats it nor claims everything is synced.
          : stoppedAll.length ? h('span.apply-state.apply-waiting', {}, icon('circle-pause', 14, 'tone-warning'), `${stoppedAll.length} ${stoppedAll.length === 1 ? 'copy' : 'copies'} stopped updating`)
        : state.home && !state.home.syncOn ? h('span.apply-state.apply-quiet', {}, icon('circle-minus', 14, 'tone-muted'), 'Nothing waiting · sync off')
          : bulk ? h('span.apply-state', {}, icon('check', 14, 'tone-success'), keptCopies ? `Synced · ${keptCopies} kept ${keptCopies === 1 ? 'edit' : 'edits'}` : 'All synced') : null;
  if (manageAll) return h('div.apply', {}, manageAll, edits || writes ? status : null);
  return status;
}

/** Agents: a stopped one-way copy the person chose to keep. It stays theirs, quietly; a click can still queue the source's copy. */
const keptKey = (skill: SampleSkill, tool: Tool) => keptEditFlag(state.home?.home ?? '', skill.key, tool);
const keptEdit = (skill: SampleSkill, tool: Tool) => readFlag(keptKey(skill, tool));
const stoppedLive = (skill: SampleSkill) => (skill.stopped ?? []).filter(tool => !skill.off.includes(tool) && !keptEdit(skill, tool));

/**
 * One tool's box as drawn: its state, whether the item syncs there, and whether that waits for Apply all (a dashed blue
 * edge; a pending synced box is drawn as Starts syncing). The table and the Files list draw the same.
 */
function cellNow(skill: SampleSkill, tool: Tool) {
  const base = committedOf(skill.key);
  const cell = cellOf(skill, tool);
  const on = skill.managed && !skill.off.includes(tool);
  const syncPending = cell !== cellOf(base, tool) || on !== (base.managed && !base.off.includes(tool));
  // Disabled with the tool's own switch: the copy is there, and the box keeps its state, with a corner mark.
  const disabled = shownDisabled(skill, tool);
  const switching = disabled !== (!!base.disabled?.includes(tool) && cellOf(base, tool) !== 'absent') && switchQueued(skill.key, tool);
  const pending = cell !== 'cannot' && (syncPending || switching);
  // A queued switch alone doesn't change how the copy syncs: the box keeps its own look (a synced copy stays "Synced").
  return { cell, on, pending, disabled, switching, look: syncPending && cell === 'synced' ? cellLook['will-sync'] : cellLook[cell] };
}

function cell(skill: SampleSkill, tool: Tool, inDetails = false) {
  // Agents: a one-way copy edited in its own tool stopped updating. It shows amber, and a click queues the source's copy again.
  const source = kind === 'agents' ? skill.oneWay?.from : undefined;
  if (source && skill.stopped?.includes(tool) && !view.draft.get(skill.key)?.resolve && skill.managed && !skill.off.includes(tool)) {
    const kept = keptEdit(skill, tool);
    const text = kept ? `${names[tool]}: edited in ${names[tool]} and kept; not receiving updates. Click to use ${names[source]}’s copy again (on Apply all).`
      : `${names[tool]}: edited in ${names[tool]}, so it stopped updating. Click to use ${names[source]}’s copy again (on Apply all; this copy is kept in History).`;
    return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
      h(`button.cell-button.${kept ? cellLook.present.tone : cellLook.differs.tone}.cell-on`, { type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, title: text, 'aria-label': text, 'data-state': kept ? 'kept' : 'stopped',
        onclick: (event: Event) => { event.stopPropagation(); resolve(skill.key, source); view.comparing = skill.key; rerender(); } },
        icon('circle-pause', 15, kept ? 'tone-muted' : '')));
  }
  // Queued: the stopped copy is replaced on Apply all, so it shows the replace mark like any copy a choice overwrites.
  if (source && skill.stopped?.includes(tool) && view.draft.get(skill.key)?.resolve === source && !skill.off.includes(tool)) {
    const text = `${names[tool]}: its edited copy is replaced by ${names[source]}’s on Apply all (kept in History). Click to cancel.`;
    return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
      h(`button.cell-button.${cellLook['will-sync'].tone}.cell-on.cell-pending-edit`, { type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, title: text, 'aria-label': text, 'data-state': 'replace',
        onclick: (event: Event) => { event.stopPropagation(); resolve(skill.key, undefined); rerender(); } }, icon('refresh-cw', 14)));
  }
  // Removed on Apply all: its own mark, and a click keeps the copy after all.
  if (skill.removing?.includes(tool)) {
    const text = `${names[tool]}: its copy is removed on Apply all (kept in History). Click to keep it.`;
    return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
      h('button.cell-button.cell-removing.cell-pending-edit', { type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, title: text, 'aria-label': text, 'data-state': 'removing',
        onclick: (event: Event) => { event.stopPropagation(); setRemoved(skill.key, [tool], false); } }, icon('minus', 16)));
  }
  // Through a plugin installed in this tool: no copy of its own, and none is placed there. The box is the item's switch
  // there (its own, or the whole plugin's), for Apply all.
  const given = throughPluginHere(skill, tool);
  if (given) {
    const said = skill.cannot?.[tool] ?? `${names[tool]} has this through the plugin ${given.plugin}.`;
    const item = itemThrough(skill, tool);
    return h('div.ov-cell', { role: 'cell', 'data-tool': tool }, item
      ? pluginSwitchCell(item, said, `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`)
      : h(`button.cell-button.${PLUGIN_LOOK.tone}.cell-on${given.off ? '.cell-disabled' : ''}`, { type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, 'data-state': 'plugin', title: `${said} Click to open the plugin’s page.`, 'aria-label': `${said} Click to open the plugin’s page.`,
        onclick: (event: Event) => { event.stopPropagation(); openPlugin(given); } }, icon(PLUGIN_LOOK.glyph, 14), given.off ? h('span.cell-disabled-mark', { 'aria-hidden': 'true' }, icon('circle-off', 9)) : null));
  }
  const { cell: drawn, on, pending, look, disabled, switching } = cellNow(skill, tool);
  const differs = drawn === 'differs' || drawn === 'present-differs';
  // A pending cell with no copy yet gets one written: a plus, where a plain tick only starts syncing what is there.
  const adds = drawn === 'will-sync' && skill.copies[tool] === undefined;
  // A chosen copy replaces this tool's different copy on Apply all: its own mark, since only this step overwrites.
  const replaces = replacedOnApply(skill, tool);
  // A cell whose copies differ opens the comparison instead of toggling: a decision comes first.
  const action = drawn === 'cannot' ? '' : differs ? 'Compare the copies' : on ? `Stop syncing to ${names[tool]}` : `Sync to ${names[tool]}`;
  const oneWay = !!skill.limits?.[tool] && on;
  // Turned off by a profile switch (not by hand): said, and marked apart, so turning it back on here is not a surprise later.
  const byProfile = disabled && !switching && turnedOffByProfile(skill.key, tool);
  // Another tool's copy, read in that tool's folder: marked, and said first.
  const reads = skill.copies[tool] !== undefined ? skill.reads?.[tool] : undefined;
  const said = `${reads ? `Reads ${names[reads]}’s copy. ` : ''}${cellTooltip(skill, tool)}`;
  const text = byProfile ? `${said} by a profile (see Profiles)` : said;
  const glyph = adds ? icon('plus', 16) : replaces ? icon('refresh-cw', 14) : look.glyph ? icon(look.glyph, drawn === 'present' ? 13 : 16, drawn === 'present' ? 'glyph-fill' : '') : null;
  return h('div.ov-cell', { role: 'cell', 'data-tool': tool },
    h(`button.cell-button.${look.tone}${on ? '.cell-on' : ''}${pending ? '.cell-pending-edit' : ''}${oneWay ? '.cell-oneway' : ''}${disabled ? '.cell-disabled' : ''}${byProfile ? '.cell-profile-off' : ''}${switching ? '.cell-switch-queued' : ''}`, {
      type: 'button', id: `cell-${skill.key}-${tool}${inDetails ? '-details' : ''}`, 'data-state': drawn,
      title: action ? `${text}. Click to ${action.charAt(0).toLowerCase()}${action.slice(1)}.${openHint(skill, tool, disabled, switching)}` : text, 'aria-label': `${text}${action ? `. ${action}` : ''}`,
      disabled: drawn === 'cannot' || (!!skill.held && !differs),
      onclick: (event: Event) => { event.stopPropagation(); if (differs) { view.comparing = view.comparing === skill.key ? undefined : skill.key; rerender(); } else setTool([skill.key], tool, !on); } },
      glyph,
      oneWay ? h('span.cell-oneway-mark', { 'aria-hidden': 'true' }, icon('arrow-up-right', 9)) : null,
      disabled ? h(`span.cell-disabled-mark${byProfile ? '.cell-disabled-profile' : ''}`, { 'aria-hidden': 'true' }, icon(byProfile ? 'sliders-horizontal' : 'circle-off', 9)) : null,
      reads ? h('span.cell-reads-mark', { 'aria-hidden': 'true' }, icon('link-2', 9)) : null,
      on && kind === 'agents' && skill.managed && skill.oneWay?.from === tool ? h('span.cell-source-mark', { 'aria-hidden': 'true' }) : null));
}

/** After a box's own click: where this tool's switch is, since the box only starts and stops syncing. '' when it has none. */
function openHint(skill: SampleSkill, tool: Tool, disabled: boolean, switching: boolean): string {
  if (kind === 'agents' || skill.copies[tool] === undefined || switching) return '';
  if (kind === 'skills') return ' To disable or remove it here, open the skill.';
  return ` To ${disabled ? 'enable' : 'disable'} it here, open the server.`;
}

/**
 * What one tool's box says, before what a click does: why it can't hold the item, what Apply all will do to it (become the
 * one-way source, get a new copy, have its copy replaced, stop syncing), or else what it shows now.
 */
function cellTooltip(skill: SampleSkill, tool: Tool): string {
  const cannot = skill.cannot?.[tool];
  if (cannot) return cannot;
  const { cell: drawn, on, pending, look, disabled, switching } = cellNow(skill, tool);
  const switched = disabled ? (switching ? '; disabled on Apply all' : `; disabled in ${names[tool]}`) : switching ? '; enabled again on Apply all' : '';
  const receivers = Object.keys(skill.limits ?? {}).filter(entry => !skill.off.includes(entry as Tool)).map(entry => names[entry as Tool]);
  if (kind === 'agents' && pending && on && skill.oneWay?.from === tool && !committedOf(skill.key).managed) {
    return `${names[tool]}: becomes the source on Apply all; edits made in ${names[tool]} go to ${andList(receivers)}`;
  }
  if (drawn === 'will-sync' && skill.copies[tool] === undefined) return `${names[tool]}: Gets a new copy on Apply all${switched}`;
  if (replacedOnApply(skill, tool)) return `${names[tool]}: Its copy is replaced on Apply all (kept in History)${switched}`;
  if (stopsOnApply(skill, tool)) return `${names[tool]}: Stops syncing on Apply all; its copy stays${switched}`;
  const limited = skill.limits?.[tool] && on ? ', one-way (with limits)' : '';
  return `${names[tool]}: ${look.label}${limited}${switched}${pending ? ' (not applied yet)' : ''}`;
}

/** A one-way copy that stopped updating because it was edited in its own tool: kept, waiting to be replaced, or a choice. */
function stoppedLine(skill: SampleSkill, tool: Tool): string {
  const chosen = view.draft.get(skill.key)?.resolve;
  const replacing = chosen && chosen !== 'separate' ? chosen : undefined;
  if (replacing) return `Its edited copy is replaced by ${names[replacing]}’s on Apply all (kept in History); it then receives updates again.`;
  if (keptEdit(skill, tool)) return `Edited in ${names[tool]} and kept: it doesn’t receive updates. To use ${names[skill.oneWay?.from ?? 'claude-cli']}’s copy again, click its box, then Apply all.`;
  const either = `Either choice keeps your edit: in ${names[tool]}, or in History if you use the source’s copy.`;
  // While its notice is showing, the choice is offered there, above.
  return `Edited in ${names[tool]}, so it stopped updating. ${state.dismissed.has(`stopped:${skill.key}:${tool}`) ? '' : 'Choose above. '}${either}`;
}

/** Claude Code's copy of an MCP server, waiting for its own Write step: missing or older, and what to do first. */
function waitsLine(skill: SampleSkill, tool: Tool): string {
  const older = skill.versions?.[tool]?.text;
  const has = skill.copies[tool] === undefined ? 'Doesn’t have it yet.' : `Has an older copy${older ? `: ${older.replace(/^[^·]+·\s*/, '')}` : ''}.`;
  return `${has}${state.home?.mode === 'fixture' ? '' : ' Quit Claude Code first: it rewrites ~/.claude.json while it runs.'}`;
}

/** A tool's copy while a copy choice waits for Apply all: the chosen one, replaced by it, or already the same. */
function choiceLine(skill: SampleSkill, tool: Tool, chosen: Tool): string {
  if (chosen === tool) return kind === 'agents' && skill.stopped?.length ? `Source. Its copy goes to ${andList(skill.stopped.map(entry => names[entry]))} on Apply all.` : 'Its copy will be used by every tool when you Apply all.';
  if (replacedOnApply(skill, tool)) return `Its copy will be replaced with ${names[chosen]}’s when you Apply all. The replaced copy is kept in Central Knot’s store.`;
  return `Already has ${names[chosen]}’s copy; no change.`;
}

/** What one tool's row in an item's details says about its copy, the most pressing first. */
function toolLine(skill: SampleSkill, tool: Tool): string {
  if (skill.stopped?.includes(tool)) return stoppedLine(skill, tool);
  if (skill.waits?.includes(tool) && skill.managed) return waitsLine(skill, tool);
  if (skill.edited?.length && skill.managed) return skill.edited.includes(tool) ? `Edited in ${names[tool]}. It spreads to the other tools when sync runs.` : `Gets the edit from ${andList(skill.edited.map(entry => names[entry]))} when sync runs.`;
  const base = committedOf(skill.key);
  const cellState = cellOf(skill, tool);
  const was = cellOf(base, tool);
  const version = skill.versions?.[tool];
  if (skill.cannot?.[tool]) return skill.cannot[tool]!;
  const chosen = view.draft.get(skill.key)?.resolve;
  if (chosen && chosen !== 'separate' && base.copies[tool] !== undefined) return choiceLine(skill, tool, chosen);
  if (cellState === 'synced' && skill.limits?.[tool] && skill.managed) return `Receives from ${skill.oneWay ? names[skill.oneWay.from] : 'the source'}: name, description and prompt only.`;
  if (cellState === 'synced' && kind === 'agents' && skill.managed && Object.keys(skill.limits ?? {}).length) {
    const receivers = andList(Object.keys(skill.limits ?? {}).map(entry => names[entry as Tool]));
    return `Source; edit it in ${names[tool]}. ${receivers} can’t hold its ${skill.kept?.length ? orList(skill.kept) : `${limitedFields(skill)} settings`}, so edits only flow out.`;
  }
  if (cellState === 'synced' && was === 'synced' && kind === 'mcp') return skill.waits?.includes('claude-cli') ? 'Has the new copy.' : '';
  const peers = toolList().filter(entry => entry !== tool && cellOf(skill, entry) === 'synced');
  if (cellState === 'synced' && was === 'synced' && peers.length && peers.length < toolList().length - 1) return `Synced. Same copy as ${andList(peers.map(entry => names[entry]))}.`;
  if (cellState === 'synced') return was === 'synced' ? `Synced. Same copy as the other ${toolList().length > 2 ? 'tools' : 'tool'}.` : 'Starts syncing on Apply all; already the same copy.';
  if (cellState === 'will-sync') return was === 'will-sync' ? 'Set to sync, but it has no copy yet. Central Knot writes one when you Apply all.' : 'You turned syncing on. Central Knot writes a copy when you Apply all.';
  if (cellState === 'differs' || cellState === 'present-differs') {
    // Size and age are said only where they tell the copies apart.
    const others = comparedTools(skill).filter(entry => entry !== tool).map(entry => skill.versions?.[entry]);
    const tells = version && others.some(other => other && (other.lines !== version.lines || other.changed !== version.changed));
    return `Has a different copy${tells ? ` (${version!.lines}, ${version!.changed})` : ''}.`;
  }
  // A copy that stops syncing on Apply all is said as what will happen; it still syncs until then.
  if (cellState === 'present' && stopsOnApply(skill, tool)) return 'Keeps its copy, which stops updating on Apply all.';
  // A copy read in another tool's folder (said before this, rowLine) keeps loading whatever is ticked here.
  if (cellState === 'present' && skill.reads?.[tool]) return skill.managed ? 'Syncing to this tool is turned off; it still loads that copy.' : '';
  if (cellState === 'present') return skill.managed ? 'Has its own copy. Syncing to this tool is turned off.'
    // Skills say "Unmanaged" once, in the status above; each row stays quiet.
    : kind === 'skills' ? '' : `Has its own copy. Central Knot is not managing this ${kindNouns[kind].short[0]}.`;
  return skill.managed ? 'No copy, and syncing here is turned off.' : 'No copy.';
}

/** Skills: what Disable or Remove does to one tool's copy, now or on Apply all; '' when neither applies. */
function switchLine(skill: SampleSkill, tool: Tool): string {
  if (skill.removing?.includes(tool)) {
    const last = toolList().every(other => skill.copies[other] === undefined || skill.removing!.includes(other));
    return last ? `Removed on Apply all: its only copy, so ${skill.name ?? skill.key} leaves this list (History keeps it).` : committedOf(skill.key).managed ? 'Removed on Apply all; syncing stops here.' : 'Removed on Apply all.';
  }
  const problem = skill.switchProblem?.[tool];
  if (problem) return `${problemText(problem, shownPath)} Fix it, then Refresh.`;
  const disabled = !!skill.disabled?.includes(tool);
  const was = !!committedOf(skill.key).disabled?.includes(tool);
  if (disabled && skill.copies[tool] === undefined) return was ? `Gets a copy on Apply all, still disabled there from before: ${names[tool]} won’t load it.` : `Gets a copy on Apply all, disabled: ${names[tool]} won’t load it.`;
  if (disabled && !was) return 'Disabled on Apply all.';
  // "Still synced" only where the skill really syncs to this tool: its box can be off while the copy stays disabled.
  const syncing = skill.managed && !skill.off.includes(tool);
  // Applied: the switch says it. Only a managed skill whose box is off here needs the word that it doesn't sync here either.
  if (disabled) return skill.managed && !syncing ? 'Disabled, and not syncing here.' : '';
  return was ? 'Enabled again on Apply all.' : '';
}

/**
 * A tool row's sentence. `quiet` (the status above already says how the copies stand), a queued removal, or a new copy that
 * arrives disabled: only what Disable or Remove does there. Otherwise how the copies stand, then that.
 */
function rowLine(skill: SampleSkill, tool: Tool, quiet: boolean): string {
  // Through a plugin: where it comes from, then why its switch can't be used here, or what it does on Apply all.
  const through = itemThrough(skill, tool);
  if (through) return [skill.cannot?.[tool], cantSwitch(through) ?? pendingWords(pluginDraft, through)].filter(Boolean).join(' ');
  // Disable is best effort: on a build older than the one verified it is only said (an unread version: the switch's tooltip).
  const note = !skill.removing?.includes(tool) && !skill.switchProblem?.[tool] && !skill.cannot?.[tool]
    && (skill.copies[tool] !== undefined || cellOf(skill, tool) === 'will-sync') && skill.disableNote?.[tool]?.startsWith('Not checked') ? skill.disableNote[tool] : undefined;
  // A copy that is another tool's, read in that tool's folder: said first, since Disable is the only thing that changes it here.
  const reads = skill.reads?.[tool];
  // And on the owner's row, who else loads this copy: removing it here takes it from them too.
  const readers = skill.copies[tool] === undefined ? [] : toolList().filter(other => skill.reads?.[other] === tool);
  return [reads && !skill.removing?.includes(tool) ? `Reads ${names[reads]}’s copy.` : undefined, rowSentence(skill, tool, quiet),
    readers.length ? `${andList(readers.map(other => names[other]))} ${readers.length > 1 ? 'read' : 'reads'} this copy too.` : undefined, note].filter(Boolean).join(' ');
}

/** rowLine without the note on an unverified build. */
function rowSentence(skill: SampleSkill, tool: Tool, quiet: boolean): string {
  const switching = switchLine(skill, tool);
  // While a draft is pending, a row with no change of its own stays as quiet as it is once applied.
  const base = committedOf(skill.key);
  const syncsHere = (item: SampleSkill) => item.managed && !item.off.includes(tool);
  const ownChange = switchQueued(skill.key, tool) || !!skill.removing?.includes(tool) || !!view.draft.get(skill.key)?.resolve
    || cellOf(skill, tool) !== cellOf(base, tool) || syncsHere(skill) !== syncsHere(base);
  if (view.draft.has(skill.key) && !ownChange) quiet = true;
  if (quiet || skill.removing?.includes(tool) || (skill.copies[tool] === undefined && skill.disabled?.includes(tool))) return switching || (skill.copies[tool] === undefined ? 'No copy.' : '');
  // A Disable or Enable sentence replaces the routine "Synced. Same copy as …"; news about the copy itself (an edit, a choice) stays.
  const routine = ['synced', 'will-sync', 'present', 'absent'].includes(cellOf(skill, tool)) && !view.draft.get(skill.key)?.resolve;
  return switching && routine ? switching : [toolLine(skill, tool), switching].filter(Boolean).join(' ');
}

/**
 * Skills and MCP servers: one tool's switch (Enabled or Disabled, applied on Apply all), for a copy it has or gets. Skills have
 * Remove beside it; a server leaves a tool by its box and its settings file.
 */
function toolControls(skill: SampleSkill, tool: Tool) {
  if (designMode) return null;
  const key = skill.key;
  // Through a plugin: the item's switch in that tool, with the way to the plugin's page.
  const through = itemThrough(skill, tool);
  if (through) return pluginItemControls(through, `enable-${key}-${tool}`, () => openPlugin(throughPluginHere(skill, tool)!));
  if (kind === 'agents') return null;
  // Keep it takes Remove's id, so keyboard focus stays on the same spot when they swap.
  if (skill.removing?.includes(tool)) return h('span.details-tool-actions', {}, smallAction('Keep it', `remove-${key}-${tool}`, () => setRemoved(key, [tool], false)));
  const has = skill.copies[tool] !== undefined || cellOf(skill, tool) === 'will-sync';
  if (!has || skill.cannot?.[tool]) return null;
  const disabled = !!skill.disabled?.includes(tool);
  const pending = switchQueued(key, tool);
  // No switch at all when its file can't be used.
  const unavailable = !!skill.switchProblem?.[tool];
  // Queued and restorable, so it is a quiet action, not a red one; a row without it keeps its place so the switches line up.
  const canRemove = kind === 'skills' && removable(skill).includes(tool);
  const remove = kind !== 'skills' ? null : canRemove ? smallAction('Remove', `remove-${key}-${tool}`, () => setRemoved(key, [tool], true), '.tool-remove') : h('span.tool-remove-slot', { 'aria-hidden': 'true' });
  if (canRemove && remove) remove.title = `Remove ${names[tool]}’s copy on Apply all. History keeps it for Restore${skill.managed ? ', and Central Knot stops syncing it here' : ''}.`;
  return h('span.details-tool-actions', {},
    unavailable ? h('span.tool-switch-na', {}, icon('circle-alert', 12, 'tone-muted'), 'Disable unavailable')
      : h(`span.tool-switch${pending ? '.tool-switch-pending' : ''}`, { title: skill.disableNote?.[tool] }, h('span.tool-switch-word', { 'aria-hidden': 'true' }, disabled ? 'Disabled' : 'Enabled'),
        toggle({ on: !disabled, label: `${skill.name ?? key} in ${names[tool]}: ${disabled ? 'disabled' : 'enabled'}${pending ? ' on Apply all' : ''}. Click to ${disabled ? 'enable' : 'disable'} it there.`, onchange: on => setDisabledIn(key, tool, !on), id: `enable-${key}-${tool}` })),
    remove);
}

/** What could not be done, item by item (the first four, then how many more), as a warning band. */
export const problemsBand = (problems: DestinationResult[]) => h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'),
  h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · ') + (problems.length > 4 ? ` · and ${problems.length - 4} more` : '')));

/** Names shown as names, so a server called "files" does not read as a word in the sentence. */
const nameList = (items: string[]) => items.flatMap((item, index) => [index ? (index === items.length - 1 ? ' and ' : ', ') : '', h('strong.item-name', {}, item)]).filter(part => part !== '');

/** An item's change waiting for Apply all, with the item as it is before that change; undefined when nothing waits. */
function pendingFor(skill: SampleSkill) {
  const draft = view.draft.get(skill.key);
  return draft ? { draft, before: committedOf(skill.key) } : undefined;
}

/** A tool that a managed item syncs to now and stops syncing to on Apply all (switched off, or the item unmanaged). */
function stopsOnApply(skill: SampleSkill, tool: Tool) {
  const before = pendingFor(skill)?.before;
  return !!before && before.managed && !before.off.includes(tool) && (!skill.managed || skill.off.includes(tool));
}

/** A tool's different copy that the chosen copy replaces on Apply all. */
function replacedOnApply(skill: SampleSkill, tool: Tool) {
  const pending = pendingFor(skill);
  const chosen = pending?.draft.resolve;
  if (!pending || !chosen || chosen === 'separate' || chosen === tool || skill.off.includes(tool)) return false;
  const base = pending.before;
  // A stopped one-way copy counts as replaced: it holds the person's edit, though the table draws it like the source.
  if (kind === 'agents' && base.stopped?.includes(tool)) return true;
  return base.copies[tool] !== undefined && base.copies[tool] !== base.copies[chosen];
}

/**
 * What a skill's row controls mean, said once under them: only the terms the visible controls offer. A managed skill (as it
 * will be after Apply all) syncs, so a tool's box in the table is told apart too, except in the Files view, which has no table.
 */
function switchNote(skill: SampleSkill, inFiles: boolean) {
  if (kind === 'agents' || designMode) return null;
  const switchShown = toolList().some(tool => !skill.removing?.includes(tool) && !skill.cannot?.[tool] && !skill.switchProblem?.[tool]
    && (skill.copies[tool] !== undefined || cellOf(skill, tool) === 'will-sync'));
  const removeShown = kind === 'skills' && removable(skill).some(tool => !skill.removing?.includes(tool));
  if (!switchShown && !removeShown) return null;
  const parts = [
    switchShown ? [h('strong', {}, 'Disabled'), kind === 'mcp' ? `: the server stays in that tool’s settings${skill.managed ? ' and keeps syncing' : ''}, but that tool stops starting it, from its next session. `
      : `: the copy stays${skill.managed ? ' and keeps syncing' : ''}, but that tool stops loading it, starting with its next session. `] : null,
    removeShown ? [h('strong', {}, 'Remove'), skill.managed ? ': the copy is taken out and syncing there stops; History keeps it. ' : ': the copy is taken out; History keeps it. '] : null,
    skill.managed && !inFiles ? [h('strong', {}, 'Unticking a tool’s box'), ' in the table: syncing there stops; the copy stays.'] : null,
  ].filter(Boolean).flat() as (string | HTMLElement)[];
  return h('p.details-limits.details-note.details-switch-note', {}, icon('info', 12, 'tone-muted'), h('span', {}, ...parts));
}

/** Where an item's details are drawn: under its row, docked beside the table, or in the Skills page's Files view. */
type Placement = 'row' | 'dock' | 'files';

/**
 * A skill's own actions, kept together under its heading rather than at the panel's far edges: Files and contents (not
 * while a copy choice is open, which has its own Read both copies, nor in the Files view itself), and Delete everywhere.
 */
function itemActions(skill: SampleSkill, choosing: boolean) {
  if (designMode || kind !== 'skills') return null;
  const files = choosing ? null : smallAction('Files and contents', `files-${skill.key}`, () => openFiles(skill.key));
  const remove = deleteAction(skill);
  return files || remove ? h('div.details-actions', {}, files, remove) : null;
}

/** An item whose copies differ between tools, so the person chooses one (never one held as it is). */
const isDiffering = (skill: SampleSkill) => !skill.held && toolList().some(tool => ['differs', 'present-differs'].includes(cellOf(skill, tool)));

/**
 * The Files view's parts for one skill, in the order they read: its details (status, choices; none when every copy is
 * the same, which the pane's header already says), then where each copy is and Delete everywhere. Stacked, the details
 * sit above the file and the rest below it, so nothing to delete sits above the file; a wide pane (style.css
 * data-columns) puts both in its column beside the file, one under the other.
 */
function filesLayout(skill: SampleSkill, where: Node[]): { head: Node | null; tail: Node[] } {
  const remove = deleteAction(skill);
  return { head: details(skill, 'files'), tail: [wherePaths(skill, where, true), remove ? h('div.details-actions', {}, remove) : null].filter((part): part is HTMLElement => !!part) };
}

/**
 * Delete everywhere, two clicks, the second naming what goes. Managed: DEL-02's deletion, which sync spreads. Unmanaged: each
 * copy's removal, run at once. History keeps it for Restore either way.
 */
function deleteAction(skill: SampleSkill) {
  if (designMode || kind !== 'skills') return null;
  const base = committedOf(skill.key);
  if (!base.managed && !removable(base).length) return null;
  // Every copy already queued for removal: Apply all does it, and a second, immediate route would only confuse.
  if (removable(base).length && removable(base).every(tool => skill.removing?.includes(tool))) return null;
  // Quiet until it is armed: the last thing in an item's details, never the first thing the eye lands on.
  if (view.confirmDelete !== skill.key) return smallAction(fromPlugins(skill, kind).length ? 'Delete this separate item…' : 'Delete everywhere…', `delete-${skill.key}`, () => { view.confirmDelete = skill.key; rerender(); }, '.text-danger-quiet', !canWrite());
  // Armed: it runs at once (not on Apply all), so it says "now", with a plain way back beside it.
  const also = deleteSteps(base);
  return h('span.delete-armed', {},
    smallAction('Cancel', `delete-cancel-${skill.key}`, () => { view.confirmDelete = undefined; rerender(); }),
    // Short, so Cancel and it keep one line in the side panel; the panel names the skill, and the note under them says what else goes.
    Object.assign(smallAction('Delete from every tool now', `delete-confirm-${skill.key}`, () => { view.confirmDelete = undefined; pinRows(); void (base.managed ? deleteEverywhereKey(skill.key) : removeEverywhere(skill.key)); }, '.text-danger', !canWrite()),
      { title: `Delete ${skill.name ?? skill.key} from every tool now. History keeps it.` }),
    h('span.delete-armed-note', { id: `delete-note-${skill.key}` }, also));
}

/**
 * Skills: copies outside Central Knot's own, said plainly where they are (a link and where it leads, the shared folder other apps
 * read), then what the person can do about them. A synced skill that has them again (an installer put them back) offers
 * Replace with managed copies, two clicks, the second saying what goes. A shared copy that is the only one a tool can have
 * (its skills folder is that folder) is said as such, with nothing offered that could not work.
 */
function outsideNote(skill: SampleSkill) {
  const copies = outsideCopies(skill);
  if (!copies.length || skill.held) return null;
  const { shape, shared, pinnedBy } = shapeOf(skill);
  const takeable = copies.some(copy => !copy.pinned);
  let next = '';
  if (pinnedBy && shared && shape.shared) {
    // The only copy one tool can have: turning it on leaves it, so say what that means for edits.
    const gets = skill.managed ? [] : toolList().filter(tool => skill.copies[tool] === undefined && !skill.cannot?.[tool]);
    const own = toolList().filter(tool => ownReal(skill, tool) || gets.includes(tool));
    next = pinnedSentence(shape.shared, skill.managed, own.map(tool => names[tool]), shared.tools.map(tool => names[tool]), gets.map(tool => names[tool]));
  } else if (takeable && skill.managed) next = managedSentence(shape, !!skill.outsideBack, toolList().filter(tool => outsideOnly(skill, tool)).map(tool => names[tool]));
  else if (takeable) next = manageSentence(shape, namedPlan(planIfOn(skill)));
  const offer = takeable && skill.managed && view.confirmDelete !== skill.key;
  const armed = offer && view.confirmTakeOver === skill.key;
  const steps = armed ? replaceSentence(shape, namedPlan(takeOverPlan(skill))) : '';
  return h('div.details-outside', { id: `outside-${skill.key}` },
    h('p.details-limits.details-note', {}, icon('link', 12, 'tone-muted'), h('span', {}, [whereSentence(shape), next].filter(Boolean).join(' '))),
    !offer ? null : !armed ? h('div.details-actions', {}, smallAction(`${REPLACE_ACTION}…`, `takeover-${skill.key}`, () => { view.confirmTakeOver = skill.key; rerender(); }, '', !canWrite()))
      : h('div.details-actions', {}, h('span.delete-armed', {},
        smallAction('Cancel', `takeover-cancel-${skill.key}`, () => { view.confirmTakeOver = undefined; rerender(); }),
        smallAction('Replace them now', `takeover-confirm-${skill.key}`, () => {
          view.confirmTakeOver = undefined;
          pinRows();
          void applyClick({ kind, items: [nameOf(skill)], changes: [{ key: skill.key, managed: true, off: skill.off as HarnessId[], seenManaged: true, takeOver: true }], said: `${nameOf(skill)} has a copy of its own in each tool it syncs to again.` });
        }, '', !canWrite()),
        steps ? h('span.delete-armed-note', { id: `takeover-note-${skill.key}` }, steps) : null)));
}

/** Pi has no native agents (CD §5): an agent can reach it only as a skill, by an explicit, one-time Convert to skill (AGT-02). */
function convertBlock(skill: SampleSkill) {
  if (designMode || !state.home?.manage.tools.includes('pi-cli')) return null;
  const done = state.home.manage.skills.find(entry => entry.converted?.agent.toLowerCase() === skill.key.toLowerCase());
  if (done) return h('p.details-limits.details-note', {}, icon('check', 12, 'tone-muted'), `Converted to a Pi skill, “${done.name}”: see it on the Skills page.`);
  return h('div.convert-block', {},
    h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Pi has no agents. You can convert this one to a skill for Pi: a one-time copy of its name, description and prompt. A skill has no ${andList(['own isolated context', 'tool restrictions', 'model selection'])}, and it is invoked as a skill, not picked as an agent. The agent stays as it is.`),
    smallAction('Convert to a Pi skill', `convert-${skill.key}`, () => void convertAgent(skill.key, skill.name ?? skill.key)));
}

/** Tool rows, with tools that say exactly the same thing folded into one row naming them all ("All 4 tools"). */
function groupedRows(skill: SampleSkill, toolRow: (tool: Tool) => HTMLElement) {
  // MCP rows each carry their tool's settings file, and skill rows their own switch and Remove, so they never fold together.
  if (kind !== 'agents') return toolList().map(tool => toolRow(tool));
  const byLine = new Map<string, Tool[]>();
  for (const tool of toolList()) { const line = toolLine(skill, tool); byLine.set(line, [...(byLine.get(line) ?? []), tool]); }
  return [...byLine].map(([line, tools]) => tools.length === 1 ? toolRow(tools[0])
    : h('div.details-tool', {}, h('div.details-tool-head', {}, h('span.details-tool-label', {}, ...tools.map(tool => brandMark(tool, 14)), h('strong', {}, capitalToolsPhrase(tools, toolList()))), h('span.details-tool-line', {}, line))));
}

/** Where each copy lives, folded away: paths matter less than what each tool has. `extra` folds in more about them (Files view). */
function wherePaths(skill: SampleSkill, entries: Node[] = [], inFiles = false) {
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

/** Show in folder: reveals a file in the file manager; nothing is opened or changed. None in the design preview. */
const showInFolder = (path: string) => (designMode ? null : h('button.inline-link.details-path-show', { type: 'button', title: 'Show this file in the file manager; nothing is opened or changed', onclick: (event: Event) => { event.stopPropagation(); showFile(path); } }, 'Show in folder'));

function limitedFields(skill: SampleSkill) {
  return skill.oneWay ? skill.oneWay.lost.map(field => `“${field}”`).join(skill.oneWay.lost.length > 2 ? ', ' : ' or ') : 'other';
}

/** MCP: the server's definition as labelled lines ("Type HTTP", "URL …"), read from its one-line summary. */
function definition(summary: string, managed: boolean) {
  const [kind, ...rest] = summary.split(' · ');
  const value = rest.join(' · ');
  const isCommand = kind === 'Command';
  return h('dl.details-definition', {},
    h('dt', {}, 'Type'), h('dd', {}, isCommand ? 'Command (stdio)' : kind),
    h('dt', {}, isCommand ? 'Command' : 'URL'), h('dd.mono', {}, value),
    // An unmanaged server's copies are each tool's own: nothing spreads, so the hint says only where to edit.
    h('dd.details-definition-hint', {}, !managed ? 'To change it, edit a settings file below; each tool keeps its own copy.' : toolList().includes('claude-cli') && toolList().length > 1
      ? `To change it, edit any settings file below. ${andList(toolList().filter(tool => tool !== 'claude-cli').map(tool => names[tool]))} sync on their own; Claude Code updates when you click Write to Claude Code.`
      : 'To change it, edit any settings file below; the change syncs to the others.'));
}

/** Agents: what one-way means, said once for every receiving tool, with the way back. */
function oneWayNote(skill: SampleSkill) {
  const receiving = Object.keys(skill.limits ?? {}).filter(tool => !skill.stopped?.includes(tool as Tool)) as Tool[];
  const source = skill.oneWay?.from;
  if (!receiving.length || !source) return null;
  return h('p.details-limits.details-footnote', {},
    `Edit it in ${orList(receiving.map(tool => names[tool]))} and that copy stops updating (amber box). To use ${names[source]}’s copy again, click that box, then Apply all.`);
}

/** Where an earlier Undo went, said by what it undoes: "The undo for writing files to Claude Code moved to History." */
function movedUndoText(label: string, items: string[]): (string | HTMLElement)[] {
  const named = nameList(items.slice(0, 3));
  const what = /write/i.test(label) ? ['writing ', ...named, ' to Claude Code'] : /Apply all/.test(label) ? ['Apply all', ...(items.length ? [' (', ...named, ')'] : [])] : /choice/i.test(label) ? ['your copy choice', ...(items.length ? [' for ', ...named] : [])] : [label.replace(/^Undo\s*/, '') || 'your last change'];
  return ['Earlier: the undo for ', ...what, ' is in '];
}

/** The two ways forward for a stopped one-way copy, offered in its notice and, once that is put aside, in its details row. */
function stoppedActions(skill: SampleSkill, tool: Tool, source: Tool, where = '') {
  const replace = button({ variant: 'outline', size: 'small', label: `Use ${names[source]}’s copy`, id: `stopped-use-${skill.key}-${tool}${where}`, onclick: () => { resolve(skill.key, source); rerender(); } });
  replace.title = `On Apply all, ${names[tool]} gets ${names[source]}’s copy again; your edit is kept in History`;
  const keep = button({ variant: 'outline', size: 'small', label: `Keep ${names[tool]}’s edit`, id: `stopped-keep-${skill.key}-${tool}${where}`, onclick: () => {
    writeFlag(keptKey(skill, tool)); state.dismissed.add(`stopped:${skill.key}:${tool}`);
    // Keeping the edit is a lasting exception, so it is said with a way back, like every other choice here.
    const name = skill.name ?? skill.key;
    tell({ page: state.page, items: [name], text: `${names[tool]} keeps its own edit of ${name} and no longer receives updates from ${names[source]}. Nothing was written.`,
      act: { label: 'Undo', id: 'outcome-undo-keep', title: `Back to deciding: ${names[tool]}’s copy shows as stopped again`, run: () => { writeFlag(keptKey(skill, tool), false); state.dismissed.delete(`stopped:${skill.key}:${tool}`); state.outcome = undefined; announce(`${names[tool]}’s copy of ${name} is waiting for a choice again.`); rerender(); } } });
    rerender();
  } });
  keep.title = `Leave ${names[tool]}’s copy as you edited it; it stops receiving updates and the warning clears`;
  return [replace, keep];
}

/** The one-way part of an agent's status: tools that still receive, then any copy that stopped or keeps its own edit. */
function oneWayStatus(skill: SampleSkill): string {
  const resolving = !!view.draft.get(skill.key)?.resolve;
  const stopped = resolving ? [] : (skill.stopped ?? []).filter(tool => !skill.off.includes(tool));
  const receiving = Object.keys(skill.limits ?? {}).map(tool => tool as Tool).filter(tool => !skill.off.includes(tool) && !stopped.includes(tool));
  const live = stopped.filter(tool => !keptEdit(skill, tool));
  const kept = stopped.filter(tool => keptEdit(skill, tool));
  return [receiving.length ? ` · one-way to ${andList(receiving.map(tool => names[tool]))}` : '',
    live.length ? ` · ${andList(live.map(tool => `${names[tool]}’s copy`))} stopped updating` : '',
    kept.length ? ` · ${andList(kept.map(tool => names[tool]))} ${kept.length === 1 ? 'keeps its' : 'keep their'} own edit` : ''].join('');
}


/**
 * What a change waiting for Apply all will do to an item, said as the future. Undefined when nothing waits, or when what
 * waits is a copy choice, which says what it does itself.
 */
function pendingStatus(skill: SampleSkill): string | undefined {
  const draft = view.draft.get(skill.key);
  if (!draft || draft.resolve) return undefined;
  const committed = committedOf(skill.key);
  const to = keptTools(skill).filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool]);
  const where = to.length ? toolsPhrase(to, toolList()) : 'no tool';
  if (committed.managed && !skill.managed) return `On Apply all, this ${word(1)} becomes unmanaged; its copies stay where they are.`;
  if (!committed.managed && skill.managed) return `On Apply all, this ${word(1)} becomes managed in ${where}.`;
  return skill.managed ? `On Apply all, it syncs to ${where}.` : undefined;
}

/**
 * What an item is: held back and why, kept separate, unmanaged (and whether its copies differ), the source of a one-way
 * agent, an MCP server waiting for Claude Code's Write step, or managed and where it syncs.
 */
function committedStatus(skill: SampleSkill, differs: boolean): string {
  const waiting = view.draft.has(skill.key);
  if (skill.held) return `Can’t be managed: ${skill.held}`;
  if (skill.separate) return 'Unmanaged. Each tool keeps its own copy.';
  if (!skill.managed) return differs ? 'Not managed yet. Its copies differ.' : fromPlugins(skill, kind).length ? 'Unmanaged: Central Knot doesn’t sync its copies.' : 'Unmanaged. Central Knot leaves every copy alone until you manage it.';
  if (kind === 'agents' && skill.oneWay) return `Managed · ${names[skill.oneWay.from]} is the source${oneWayStatus(skill)}`;
  if (kind === 'mcp' && !waiting && skill.waits?.includes('claude-cli')) {
    return `Waits for Write to Claude Code · synced in ${toolsPhrase(toolList().filter(tool => tool !== 'claude-cli' && cellOf(skill, tool) === 'synced'), toolList())}`;
  }
  if (kind === 'mcp' && !waiting && toolList().every(tool => cellOf(skill, tool) === 'synced')) return `Synced in ${toolsPhrase(toolList(), toolList())}`;
  const to = keptTools(skill).filter(tool => !skill.off.includes(tool) && !skill.cannot?.[tool]);
  return to.length ? `Managed in ${toolsPhrase(to, toolList())}` : 'Managed · syncing to no tool';
}

/** Everything about one item, opened in place under its row. Differing copies put the choice first. */
function details(skill: SampleSkill, placement: 'files'): HTMLElement | null;
function details(skill: SampleSkill, placement?: Exclude<Placement, 'files'>): HTMLElement;
/**
 * One item's details: its status, the choice when copies differ, each tool's line, and where each copy is. In the Files
 * view (filesLayout) where each copy is and Delete everywhere are laid out apart, and nothing is drawn when nothing is
 * left to say.
 */
function details(skill: SampleSkill, placement: Placement = 'row'): HTMLElement | null {
  if (oneSwitch()) return switchDetails(skill, placement);
  const inFiles = placement === 'files';
  const draft = view.draft.get(skill.key);
  const differs = isDiffering(skill);
  const pending = pendingStatus(skill);
  const status = pending ?? committedStatus(skill, differs);
  // When every tool simply has the same synced copy, one line says so; per-tool rows are for when something differs.
  // MCP keeps one layout in every state (a row per tool with its status and settings file), so it never takes the one-line form.
  const allSame = kind !== 'mcp' && skill.managed && !draft && toolList().every(tool => cellOf(skill, tool) === 'synced' && !skill.limits?.[tool]);
  // MCP: each tool's row is a grid of its settings file and Show in folder, the links in one column; its status and
  // Claude Code's Write step sit under them.
  const settingsFile = (tool: Tool) => (kind === 'mcp' && skill.paths?.[tool] ? [wrappingPath(skill.paths[tool]!), showInFolder(skill.paths[tool]!)] : []);
  const whereHere = inFiles ? null : wherePaths(skill);
  // In the Files view, an item whose copies are all the same has nothing to add to the pane's header.
  // Skills keep their tool rows there too, since each holds that tool's switch and Remove.
  if (inFiles && allSame && !(skill.extra ?? []).length && !skill.converted && (kind !== 'skills' || designMode)) return null;
  // Skills list each tool even when the status already says how the copies stand (all the same, or a choice to make first).
  const quietRows = (allSame || (differs && !draft)) && kind === 'skills' && !designMode;
  // Skills: where a copy is disabled now, said after the status. What Apply all will change is said in each tool's row.
  const disabledIn = toolList().filter(tool => committedOf(skill.key).disabled?.includes(tool) && !switchQueued(skill.key, tool) && !skill.removing?.includes(tool) && skill.copies[tool] !== undefined);
  const disabledNote = disabledIn.length ? ` · disabled in ${toolsPhrase(disabledIn, toolList())}` : '';
  // `quiet`: the status above already says how the copies stand, so a row says only what Disable or Remove does there.
  const toolRow = (tool: Tool, { quiet = false } = {}) => h('div.details-tool', {},
    h('div.details-tool-head', {}, h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
      ...settingsFile(tool),
      h('span.details-tool-line', {}, rowLine(skill, tool, quiet),
        kind === 'mcp' && skill.managed && !draft && tool === 'claude-cli' && skill.waits?.includes(tool) ? h('span.details-tool-actions', {}, button({ variant: 'outline', size: 'small', label: 'Write to Claude Code', id: `write-claude-row-${skill.key}`, onclick: () => void writeClaudeNow([skill.key]) })) : null,
        // Deciding later keeps both choices: once the notice is put aside, the stopped copy's row offers them.
        kind === 'agents' && skill.managed && skill.oneWay && !draft?.resolve && stoppedLive(skill).includes(tool) && state.dismissed.has(`stopped:${skill.key}:${tool}`)
          ? h('span.details-tool-actions', {}, stoppedActions(skill, tool, skill.oneWay.from, '-details')) : null),
      toolControls(skill, tool)),
    // One-way limits are said once, under the rows (oneWayNote); other kinds keep a per-tool line.
    kind !== 'agents' && skill.limits?.[tool] && !skill.stopped?.includes(tool) ? h('p.details-limits', {}, icon('arrow-up-right', 12, 'tone-warning'), skill.limits[tool]!) : null,
    null);
  return h(`div.compare.details${placement === 'row' ? '' : '.details-bare'}${differs ? '.details-differs' : ''}${kind === 'mcp' ? '.details-mcp' : ''}${kind === 'skills' ? '.details-skills' : ''}${kind === 'agents' ? '.details-agents' : ''}`, { role: 'region', 'aria-label': `Details for ${skill.key}` },
    placement === 'row' && differs && !draft ? h('button.details-close', { type: 'button', id: `close-${skill.key}`, 'aria-label': `Close details for ${skill.key}`, title: 'Close', onclick: () => { view.comparing = undefined; rerender(); } }, icon('x', 14)) : null,
    h('div.details-head', {},
      (inFiles && allSame) || (differs && !skill.managed && !draft) ? null
        : h('p.details-status', {}, allSame ? `Synced · same copy in ${toolsPhrase(toolList(), toolList())}` : status, pending ? null : disabledNote, draft && !pending && !inFiles ? h('span.details-pending', {}, ' · not applied yet') : null),
      kind !== 'mcp' && skill.description && !(differs && !draft) && !inFiles ? h('p.details-description', {}, skill.description) : null,
      kind === 'mcp' && skill.description ? definition(skill.description, skill.managed) : null,
      partNote(skill),
      inFiles ? null : itemActions(skill, differs && !draft)),
    differs ? compareChoices(skill) : null,
    // Agents: each tool runs an agent its own way; Central Knot moves the name, description and prompt (AGT-01).
    kind === 'agents' && !Object.keys(skill.limits ?? {}).length && Object.keys(skill.copies).length + toolList().filter(tool => skill.managed && !skill.off.includes(tool) && !skill.copies[tool]).length > 1
      ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), 'Each tool runs agents its own way. Central Knot copies the name, description and prompt; each tool decides how to run them.') : null,
    (skill.extra ?? []).length ? h('div.details-extra', {}, (skill.extra ?? []).map(extra => h('p.details-extra-line', {}, icon(extra.same ? 'check' : 'diff', 12, extra.same ? 'tone-muted' : 'tone-warning'),
      `${names[extra.tool]} also reads ${extra.same ? 'the same copy' : 'a different copy'} at `, h('span.details-path', { title: extra.directory }, shownPath(extra.directory)),
      extra.writable ? '' : '. Central Knot does not change it: it is a link or a folder other tools share.'))) : null,
    // Skills always list each tool, so Disable and Remove are there for every copy, managed or not.
    quietRows ? [h('div.details-tools', {}, toolList().map(tool => toolRow(tool, { quiet: true }))), switchNote(skill, inFiles)] : null,
    allSame ? whereHere
      : differs && !draft ? whereHere : [h('div.details-tools', {}, groupedRows(skill, toolRow)), switchNote(skill, inFiles), kind === 'agents' && !skill.stopped?.length ? oneWayNote(skill) : null, kind === 'mcp' ? null : whereHere],
    kind === 'agents' ? convertBlock(skill) : null,
    kind === 'skills' && skill.converted ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Converted from ${names[skill.converted.origin] ?? skill.converted.origin}’s agent “${skill.converted.agent}”, as a one-time copy; ${names[skill.converted.origin] ?? skill.converted.origin} keeps the agent, and edits here never change it. As a skill it has no ${andList(skill.converted.losses)}.`) : null)
}

/** The decision for differing copies: each choice says everything Apply all will do with it. */
function compareChoices(skill: SampleSkill, inFiles = false) {
  const versions = skill.versions ?? {};
  const compared = toolList().filter(tool => comparedTools(skill).includes(tool));
  const receiving = toolList().filter(tool => (!skill.off.includes(tool) || (oneSwitch() && !skill.managed)) && !skill.cannot?.[tool] && skill.copies[tool] === undefined && !skill.waits?.includes(tool));
  // Line counts and edit times are shown only where they tell the copies apart.
  const metaDiffers = new Set(compared.map(tool => `${versions[tool]?.lines}|${versions[tool]?.changed}`)).size > 1;
  const effect = (tool: Tool) => {
    const replaced = compared.filter(entry => entry !== tool).map(entry => names[entry]);
    const parts = [replaced.length ? `replaces ${andList(replaced.map(name => `${name}’s copy`))}` : '', receiving.length ? `adds it to ${andList(receiving.map(entry => names[entry]))}` : ''].filter(Boolean);
    return `${parts.join('; ').replace(/^./, first => first.toUpperCase())}.`;
  };
  const choice = (tool: Tool) => {
    const version = versions[tool];
    // A block counts only for a tool it syncs to that can load the skill.
    const block = skill.blocks?.[tool]?.find(entry => !skill.off.includes(entry.tool) && !skill.cannot?.[entry.tool]);
    if (block) return h('button.version.version-blocked', { type: 'button', id: `use-${skill.key}-${tool}`, disabled: true, title: block.reason },
      h('span.version-head', {}, brandMark(tool, 14), h('strong', {}, `Use ${names[tool]}’s copy`)),
      h('span.version-effect.version-why', {}, icon('circle-alert', 12, 'tone-warning'), block.reason));
    return h('button.version', { type: 'button', id: `use-${skill.key}-${tool}`, 'aria-label': `Use ${names[tool]}’s copy`, disabled: oneSwitch() && !canWrite(), onclick: () => (oneSwitch() ? turnOn(skill, tool) : resolve(skill.key, tool)) },
      h('span.version-head', {}, brandMark(tool, 14), h('strong', {}, `${names[tool]}’s copy`)),
      version && metaDiffers ? h('span.version-meta', {}, `${version.lines} · ${version.changed}`) : null,
      version ? h('span.version-text', {}, `“${version.text}”`) : null,
      h('span.version-effect', {}, effect(tool)),
      h('span.version-cta', { 'aria-hidden': 'true' }, 'Use this copy'));
  };
  // Comparing comes before choosing: the full files side by side, a click from the copies (the Files view shows them already).
  const read = !designMode && kind === 'skills' && !inFiles ? smallAction(compared.length > 2 ? 'Read every copy' : 'Read both copies', `diff-${skill.key}`, () => openFiles(skill.key), '.compare-read') : null;
  return h('div.compare-block', {},
    h('p.compare-title', {}, icon('diff', 14, 'tone-warning'), h('span', {}, 'Which copy of ', h('strong.item-name', {}, skill.name ?? skill.key), ` should ${compared.length + receiving.length > 2 ? 'every tool' : 'both tools'} use?`)),
    h('p.compare-note', {}, oneSwitch() ? 'Choosing applies at once, and turns it on everywhere. Replaced copies are kept in History.' : 'Nothing changes until Apply all. Replaced copies are kept in History, and the chosen copy then stays in sync everywhere.'),
    h('div.compare-choices', {}, compared.map(choice)),
    read,
    // The third way is quieter: it decides nothing about content, so it is a line, not a card.
    oneSwitch() ? null : h('p.compare-separate', {}, 'Or ', smallAction('keep separate copies', `separate-${skill.key}`, () => resolve(skill.key, 'separate')),
      ': each tool keeps its own, nothing is copied, and Central Knot stops flagging ', h('strong.item-name', {}, skill.name ?? skill.key), '.'));
}

/** Whether an open row's details dock beside the table: the content is wide enough (renderer.ts sets state.wide). */
const docked = () => state.wide;

/**
 * The open row's details in a panel beside the table: its name and a close button, then everything the inline details
 * show, so the item's actions sit with it and a wide window's width is used.
 */
function itemDock(skill: SampleSkill) {
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
  rerender();
  // Bring the details into view without losing the row (its name and close button) under the sticky header. Docked
  // details sit beside the table and are always in view.
  if (view.comparing && !docked()) requestAnimationFrame(() => {
    const rowEl = document.querySelector(`.ov-row[data-key="${CSS.escape(key)}"]`);
    const details = rowEl?.nextElementSibling;
    const box = rowEl?.closest('.scroll')?.getBoundingClientRect();
    if (!rowEl || !details || !box) return;
    if (details.getBoundingClientRect().bottom > box.bottom) rowEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

/**
 * A copy choice waiting for Apply all, as a pill beside the item's name: what was chosen (a short form in a narrow table,
 * style.css) and a button to change it. Resuming a stopped one-way copy has nothing to choose between: its button cancels.
 */
function decidedPill(skill: SampleSkill, decided: Resolution) {
  const resumeOnly = kind === 'agents' && !!skill.stopped?.length && decided === skill.oneWay?.from;
  const what = decided === 'separate' ? [h('span.decided-what', {}, 'Keeping separate'), h('span.decided-short', {}, 'Separate')]
    : resumeOnly ? [h('span.decided-what', {}, 'Resumes on Apply all'), h('span.decided-short', {}, 'Resumes')]
    : [h('span.decided-uses', {}, 'Uses'), brandMark(decided, 12), h('span.decided-what', {}, `${names[decided]}’s copy`), h('span.decided-short', {}, names[decided])];
  const change = h('button.decided-undo', {
    type: 'button', id: `undo-${skill.key}`, 'aria-label': resumeOnly ? 'Cancel this' : 'Change this choice', title: resumeOnly ? 'Cancel: keep the edited copy' : 'Change this choice',
    onclick: (event: Event) => { event.stopPropagation(); resolve(skill.key, undefined); view.comparing = resumeOnly ? view.comparing : skill.key; rerender(); },
  }, h('span.decided-undo-text', {}, resumeOnly ? 'Cancel' : 'Change'), icon(resumeOnly ? 'x' : 'pencil-line', 12, 'decided-undo-icon'));
  return h('span.decided', { title: decided === 'separate' ? 'Keeping separate copies, on Apply all' : `Every tool will use ${names[decided]}’s copy, on Apply all` }, what, change);
}

/** An agent that syncs one-way: a quiet tag after its name, its tooltip saying what the other tools get. */
function oneWayTag(skill: SampleSkill, from: Tool) {
  const title = `${skill.managed ? 'Syncs' : 'Would sync'} one-way: it uses ${names[from]}’s ${limitedFields(skill).replace(' or ', ' and ')} settings, which the other tools can’t hold, so they get only its name, description and prompt`;
  return h('span.row-tag', { title }, `one-way from ${names[from]}`);
}

/**
 * An item's name cell. The name never gives way first: as the column narrows, the description shortens (and in every row
 * at once steps aside, settleDescriptions), the one-way tag wraps out of sight, and only then does the name shorten
 * (style.css .ov-name-fit). Its full text is always in the tooltip.
 */
function nameCell(skill: SampleSkill, attention: boolean, chevron = true) {
  const decided = view.draft.get(skill.key)?.resolve;
  const open = view.comparing === skill.key;
  const name = skill.name ?? skill.key;
  return h(`div.ov-name.ov-name-fit${chevron ? '' : '.ov-name-bare'}`, { role: 'cell', title: skill.description ? `${name}: ${skill.description}` : name },
    chevron ? openButton(skill.key, skill.key) : null,
    h('span.ov-name-main', {},
      h('span.ov-name-text', {}, name),
      skill.held ? h('span.held-pill', { title: skill.held }, oneSwitch() ? 'Can’t sync' : 'Can’t manage') : null,
      // On a page with one switch the row's only controls are its switch and chevron: Copies differ is said, not clicked.
      attention && !decided ? (chevron ? smallAction('Copies differ', `decide-${skill.key}`, () => { view.comparing = open ? undefined : skill.key; rerender(); }, '.decide') : h('span.row-tag.row-tag-differs', { id: `decide-${skill.key}` }, 'Copies differ')) : null,
      decided ? decidedPill(skill, decided) : null),
    kind === 'agents' && skill.oneWay && !decided ? oneWayTag(skill, skill.oneWay.from) : null,
    partTags(skill),
    skill.gone ? h('span.row-tag', { title: 'No tool has a copy now. Turn it on to put it back from History.' }, 'no copy left') : null,
    skill.description ? h('span.ov-name-about', { title: skill.description }, skill.description) : null);
}

function row(skill: SampleSkill) {
  if (oneSwitch()) return switchRow(skill);
  const draft = view.draft.get(skill.key);
  const attention = syncOf(skill, toolList()) === 'attention';
  const open = view.comparing === skill.key;
  // Turning on Managed for an item whose copies differ opens the choice first.
  const manage = (on: boolean) => { if (on && attention && !draft?.resolve && !skill.managed) { view.comparing = undefined; openRow(skill.key); return; } setManaged([skill.key], on); };
  return [
    h(`div.ov-row${takeFlash(skill.key) ? '.row-flash' : ''}${draft ? '.changed' : ''}${skill.managed ? '' : '.unmanaged'}${open ? '.open' : ''}`, { role: 'row', 'data-key': skill.key, 'aria-expanded': String(open), onclick: () => openRow(skill.key) },
      nameCell(skill, attention),
      h(`div.ov-managed${draft && skill.managed !== committedOf(skill.key).managed ? '.managed-pending' : ''}`, { role: 'cell' }, toggle({ on: skill.managed, label: `Manage ${skill.name ?? skill.key}`, onchange: manage, disabled: !!skill.held, id: `switch-${skill.key}` })),
      toolList().map(tool => cell(skill, tool))),
    open && !docked() ? details(skill) : null,
  ];
}

/** A cell's look, small, for keys and counts. */
const swatch = (cell: Cell, on: boolean) => {
  const look = cellLook[cell];
  return h(`span.legend-cell.${look.tone}${on ? '.cell-on' : ''}`, { 'aria-hidden': 'true' }, look.glyph ? icon(look.glyph, cell === 'present' ? 10 : 12, cell === 'present' ? 'glyph-fill' : '') : null);
};

/** A key swatch: a box with its own copy, dashed blue because what happens to it waits for Apply all. */
const pendingOwnCopy = () => { const mark = swatch('present', false); mark.classList.add('cell-pending-edit'); return mark; };

/** The key's entries for a box that is there through a plugin, on a person's own row or a plugin's, when the table draws any: through a plugin, and turned off in that tool. */
function pluginLegend(list: SampleSkill[], entry: (label: string, node: HTMLElement) => HTMLElement) {
  const offs = [...plugged().rows.flatMap(row => (toolList() as HarnessId[]).filter(tool => row.copies[tool]).map(tool => !!offIn(row, tool))),
    ...list.flatMap(skill => toolList().flatMap(tool => { const given = throughPluginHere(skill, tool); return given ? [!!given.off] : []; }))];
  const mark = (off: boolean) => h(`span.legend-cell.cell-plugin.cell-on${off ? '.cell-disabled' : ''}`, { 'aria-hidden': 'true' }, icon(PLUGIN_LOOK.glyph, 11), off ? h('span.cell-disabled-mark', {}, icon('circle-off', 8)) : null);
  return offs.length ? [entry(PLUGIN_LOOK.label, mark(false)), offs.some(Boolean) ? entry('Through a plugin, turned off there', mark(true)) : null] : [];
}

function legend(list: SampleSkill[]) {
  const entry = (label: string, node: HTMLElement) => h('span.legend-item', {}, node, label);
  // What is drawn: a pending synced cell is drawn as Starts syncing, a replaced one with its own mark.
  const seen = new Set(list.flatMap(skill => toolList().map(tool => {
    const cell = cellOf(skill, tool);
    // A box drawn as Through a plugin is keyed as that, not as Can’t load it.
    if (throughPluginHere(skill, tool)) return undefined;
    return cell === 'synced' && view.draft.has(skill.key) && cellOf(committedOf(skill.key), tool) !== 'synced' ? 'will-sync' as Cell : cell;
  })));
  const replaced = list.some(skill => toolList().some(tool => replacedOnApply(skill, tool)));
  // A tool switched off for a managed item, waiting for Apply all: drawn with the same blue dashed edge as any change.
  const stops = list.some(skill => toolList().some(tool => stopsOnApply(skill, tool)));
  const source = kind === 'agents' && list.some(skill => skill.managed && skill.oneWay);
  const oneWay = list.some(skill => skill.managed && Object.keys(skill.limits ?? {}).length);
  // Drawn as the cell it explains: a synced box with the one-way arrow at its corner.
  const oneWaySwatch = swatch('synced', true);
  oneWaySwatch.classList.add('cell-oneway');
  oneWaySwatch.append(h('span.cell-oneway-mark', {}, icon('arrow-up-right', 8)));
  const fresh = list.some(skill => toolList().some(tool => cellOf(skill, tool) === 'will-sync' && skill.copies[tool] === undefined));
  const shownOff = (skill: SampleSkill, tool: Tool) => shownDisabled(skill, tool) && !switchQueued(skill.key, tool);
  const disabledShown = list.some(skill => toolList().some(tool => shownOff(skill, tool) && !turnedOffByProfile(skill.key, tool)));
  // A switch a profile turned off is marked apart, and keyed apart, so it reads as the profile's doing.
  const profileShown = list.some(skill => toolList().some(tool => shownOff(skill, tool) && turnedOffByProfile(skill.key, tool)));
  const profileSwatch = swatch('synced', true);
  profileSwatch.classList.add('cell-disabled');
  profileSwatch.append(h('span.cell-disabled-mark.cell-disabled-profile', {}, icon('sliders-horizontal', 8)));
  const disabledSwatch = swatch('synced', true);
  disabledSwatch.classList.add('cell-disabled');
  disabledSwatch.append(h('span.cell-disabled-mark', {}, icon('circle-off', 8)));
  const removingSwatch = h('span.legend-cell.cell-removing.cell-pending-edit', { 'aria-hidden': 'true' }, icon('minus', 12));
  // Queued switches: a synced cell with the queued outline, with the mark for Disable and without it for Enable, as the cells look.
  const queuedSwitch = (disabled: boolean) => list.some(skill => toolList().some(tool => switchQueued(skill.key, tool) && !!skill.disabled?.includes(tool) === disabled));
  const queuedSwatch = (disabled: boolean) => {
    const mark = swatch('synced', true);
    mark.classList.add('cell-switch-queued', ...(disabled ? ['cell-disabled'] : []));
    if (disabled) mark.append(h('span.cell-disabled-mark', {}, icon('circle-off', 8)));
    return mark;
  };
  const plus = swatch('will-sync', true);
  plus.replaceChildren(icon('plus', 12));
  // Only the marks this table shows, so the key explains exactly what is on screen.
  const keyed = h('div.legend', { 'aria-label': 'Key' },
    seen.has('synced') ? entry('Synced', swatch('synced', true)) : null,
    seen.has('will-sync') ? entry(oneSwitch() ? NEXT_SYNC : 'Starts syncing on Apply all', swatch('will-sync', true)) : null,
    fresh && !oneSwitch() ? entry('New copy on Apply all', plus) : null,
    replaced ? (() => { const mark = swatch('will-sync', true); mark.replaceChildren(icon('refresh-cw', 11)); const made = entry('Replaced on Apply all', mark); made.title = 'The replaced copy is kept in History'; return made; })() : null,
    stops ? entry('Stops syncing on Apply all', pendingOwnCopy()) : null,
    // Differing copies chosen to stay separate: each keeps its own copy, drawn dashed until Apply all.
    list.some(skill => view.draft.get(skill.key)?.resolve === 'separate') ? entry('Keeps copies separate on Apply all', pendingOwnCopy()) : null,
    disabledShown ? entry(oneSwitch() ? 'Off there (copy kept)' : 'Disabled (copy kept)', disabledSwatch) : null,
    profileShown ? entry('Off by a profile (see Profiles)', profileSwatch) : null,
    list.some(skill => skill.removing?.length) ? (() => { const made = entry('Removed on Apply all', removingSwatch); made.title = 'The removed copy is kept in History'; return made; })() : null,
    queuedSwitch(true) ? entry('Disabled on Apply all', queuedSwatch(true)) : null,
    queuedSwitch(false) ? entry('Enabled again on Apply all', queuedSwatch(false)) : null,
    seen.has('edited') ? entry('Edited in that tool', swatch('edited', true)) : null,
    seen.has('waiting') ? entry('Waiting for sync', swatch('waiting', true)) : null,
    // Drawn as the cell it explains: the source's synced box, with its dot.
    source ? entry('Source (one-way)', (() => { const mark = swatch('synced', true); mark.append(h('span.cell-source-mark')); return mark; })()) : null,
    seen.has('write-now') ? entry('Waits for Write to Claude Code', swatch('write-now', true)) : null,
    oneWay ? entry('Receives one-way', oneWaySwatch) : null,
    kind === 'agents' && list.some(skill => skill.managed && stoppedLive(skill).length && !view.draft.get(skill.key)?.resolve) ? entry('Stopped updating (edited in that tool)', (() => { const mark = swatch('differs', true); mark.replaceChildren(icon('circle-pause', 11)); return mark; })()) : null,
    kind === 'agents' && list.some(skill => skill.managed && (skill.stopped ?? []).some(tool => !skill.off.includes(tool) && keptEdit(skill, tool)) && !view.draft.get(skill.key)?.resolve) ? entry('Keeps its own edit', (() => { const mark = swatch('present', true); mark.replaceChildren(icon('circle-pause', 11)); return mark; })()) : null,
    seen.has('differs') || seen.has('present-differs') ? entry('Copies differ', swatch('differs', true)) : null,
    seen.has('present') || seen.has('off') ? entry('Has its own copy', swatch('present', false)) : null,
    list.some(skill => toolList().some(tool => skill.copies[tool] !== undefined && skill.reads?.[tool])) ? entry('Reads another tool’s copy', (() => { const mark = swatch('present', false); mark.append(h('span.cell-reads-mark', {}, icon('link-2', 9))); return mark; })()) : null,
    seen.has('absent') ? entry('No copy', swatch('absent', false)) : null,
    ...pluginLegend(list, entry),
    seen.has('cannot') ? entry('Can’t load it', swatch('cannot', false)) : null,
    // The dashed blue Managed switch is a pending mark too.
    list.some(skill => view.draft.has(skill.key) && skill.managed && !committedOf(skill.key).managed) ? entry('Becomes Managed on Apply all', h('span.legend-switch', { 'aria-hidden': 'true' }, h('span.switch-knob'))) : null);
  // A legend with only "Synced" explains nothing under an all-green table.
  const pendingEntries = [...keyed.children].filter(child => / on Apply all/.test(child.textContent ?? ''));
  if (pendingEntries.length) {
    // Plain states first, then one lead-in and the marks that happen on Apply all, so the lead-in governs only those. They
    // are one group, which moves to its own line as a whole rather than leaving the lead-in at the end of a line.
    // The lead-in keeps its first entry beside it, so the group wraps by whole entries and never strands the lead-in.
    keyed.append(h('span.legend-group', {}, h('span.legend-first', {}, h('span.legend-lead', {}, 'On Apply all:'), pendingEntries[0]), ...pendingEntries.slice(1)));
    for (const entry of pendingEntries) for (const node of [...entry.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = (node.textContent ?? '').replace(/ ?\(?on Apply all\)?/, '').replace(/^./, first => first.toLowerCase());
  }
  return keyed.childElementCount ? keyed : null;
}

/** Moving to another harness starts every table fresh (the kind pages' too, which share them), whichever was drawn last. */
export function resetTablesForHarness() {
  for (const each of Object.values(views)) startFresh(each, each.shownFor);
}

/** A tool's column header: its mark and name. */
const toolHead = (tool: Tool) => h(`div.ov-cell.ov-tool-head${tool === focus ? '.tool-head-focus' : ''}`, { role: 'columnheader', id: `tool-${tool}` }, brandMark(tool, 16), h('span.tool-head-name', {}, names[tool]));

/** Whether the table draws a Managed section, so a move is told on it rather than on Unmanaged. */
let managedDrawn = false;

/** A note after a section heading, after one separating dot that is spaced the same on both sides for every note. */
const sectionNote = (...children: (Node | string)[]) => h('span.ov-section-after', {}, h('span.ov-section-dot', { 'aria-hidden': 'true' }, '·'), ...children);

/**
 * Rows grouped under one heading. `role`: managed or unmanaged (in use; on a harness's page, the ones it has), away (in use,
 * only other tools have them), or unused (every tool that has them has them disabled, managed or not), which comes last.
 */
function section(role: 'managed' | 'unmanaged' | 'away' | 'unused', list: SampleSkill[], after: number) {
  if (!list.length) return null;
  const label = role === 'managed' ? 'Managed' : role === 'unmanaged' ? 'Unmanaged' : role === 'unused' ? placeNames()[2] : `Not in ${names[focus!]}`;
  const sorted = [...list].sort(byKey);
  const managing = role === 'unmanaged';
  const toManaged = managing ? list.filter(skill => skill.managed).length : 0;
  const leaving = role === 'unused' ? list.filter(usedAfter).length : 0;
  const becoming = role === 'away' ? list.filter(skill => skill.managed && !committedOf(skill.key).managed).length : 0;
  return h('div', { role: 'rowgroup' },
    h(`div.ov-section${role === 'away' || role === 'unused' ? '.ov-section-away' : ''}`, { role: 'row', 'data-section': role },
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(list.length)),
        // A move is told once: on the section it joins, or on Unmanaged when everything there joins Managed.
        after > list.length ? sectionNote(`${after - list.length} ${after - list.length === 1 ? 'joins' : 'join'} on Apply all`)
          : toManaged && !managedDrawn ? sectionNote(toManaged === list.length ? `${list.length === 1 ? 'becomes' : list.length === 2 ? 'both become' : 'all become'} Managed on Apply all` : `${toManaged} become Managed on Apply all`) : null,
        // Rows some tool uses again once the changes apply (enabled there, or managed and copied to another tool).
        leaving ? sectionNote(`${leaving} ${leaving === 1 ? 'leaves' : 'leave'} on Apply all`) : null,
        // Items only other tools have, turned on here: told on their own section, so the counts add up.
        becoming ? sectionNote(h('span', {}, `${becoming} ${becoming === 1 ? 'becomes' : 'become'} Managed on Apply all`))
          : role === 'away' ? sectionNote(h('span', {}, `tick a ${names[focus!]} box to add and manage it here`)) : null,
        // A bulk Manage leaves items with differing copies out: name them, with the way to choose.
        managing ? (() => {
          const waiting = sorted.filter(skill => !effective(skill).managed && syncOf(skill, toolList()) === 'attention' && !view.draft.get(skill.key)?.resolve);
          return waiting.length ? sectionNote(smallAction(waiting.length === 1 ? `${waiting[0].name ?? waiting[0].key} needs a copy choice first` : `${waiting.length} need a copy choice first`, 'section-choose', () => openRow(waiting[0].key))) : null;
        })() : null)),
    sorted.flatMap(row));
}


/** What the last action did, where it was done, with History when there is something to undo. */
export { brandMark };

/**
 * Whether the open page still shows a result. It stands until the page changes, something new is queued, or it is dismissed;
 * it steps aside while a copy choice it names is open, and in the Files view for a skill it doesn't name.
 */
function outcomeShown(outcome: Outcome, matrixPage: boolean): boolean {
  if (outcome.page !== state.page) return false;
  const named = [outcome.item, ...(outcome.items ?? [])].filter((name): name is string => !!name);
  if (matrixPage && (view.draft.size || pluginDraft.size) && (outcome.said ?? 0) < view.draftSaid) return false;
  const choosing = matrixPage && view.comparing && committedList().some(skill => skill.key === view.comparing && syncOf(skill, toolList()) === 'attention' && named.some(name => name === skill.name || name.toLowerCase() === skill.key));
  if (choosing) return false;
  return !(state.skillsView === 'files' && state.item && !named.some(name => name.toLowerCase() === state.item));
}

/**
 * The last action's result as a band, when it offers something to do; a result that only tells is in the status bar.
 * `table`: a table is on screen, so its pending changes or open copy choice hide an older result (guessed from the page;
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
  return h('div.band.band-done', { role: 'status', 'data-outcome': '' }, outcome.warn ? icon('triangle-alert', 14, 'tone-warning') : icon('check', 14, 'tone-success'), h('span.band-text', {}, ...text,
    // The space before the note sits outside it, so a note kept whole on its line never carries the last word with it.
    outcome.note ? [' ', h('span.tone-faint', {}, outcome.note.replace(/ History\.$/, ' '), h('button.inline-link', { type: 'button', id: 'outcome-note-history', onclick: (event: Event) => { event.stopPropagation(); showPage('history'); } }, 'History'), '.')] : null),
    outcome.act ? button({ variant: 'outline', size: 'small', label: outcome.act.label, id: outcome.act.id, attrs: outcome.act.title ? { title: outcome.act.title } : undefined, onclick: (event: Event) => { event.stopPropagation(); outcome.act!.run(); } })
      : outcome.undo ? smallAction(outcome.undo.label, 'outcome-undo', () => void restoreEvent(outcome.undo!.id), undefined)
      : outcome.history && state.page !== 'history' ? smallAction('Undo in History', 'outcome-history', () => showPage('history')) : null,
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

/** First use of a page: one line on what Managed means and what a click does. */
function helpBand(): HTMLElement | null {
  const list = committedList();
  // Shown until dismissed, so it does not come and go as rows change.
  const key = `ck-help-dismissed-${kind}`;
  if (designMode || !list.length || readFlag(key) || state.skillsView === 'files' || (kind === 'mcp' && view.draft.size)) return null;
  const one = kindNouns[kind].a;
  if (oneSwitch()) return h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'),
    h('span.band-text.band-lines', {},
      h('span', {}, `Turn ${one} on and every tool has it, kept the same; turn it off and no tool loads it. Each click applies at once, with Undo.`),
      h('span.tone-muted', {}, `A switch halfway means not synced yet: each tool keeps its own copy. Open ${one} for each tool’s own switch.`)),
    closeButton(() => { writeFlag(key); rerender(); }, { id: 'help-dismiss', label: 'Hide this tip' }));
  return h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'),
    h('span.band-text.band-lines', {},
      h('span', {}, `Turn on Managed to keep ${one} the same in every tool you include. Nothing is written until Apply all.`),
      h('span.tone-muted', {}, ...(kind === 'agents' && list.some(skill => Object.keys(skill.limits ?? {}).length)
        ? [focus ? 'Tick a tool’s box to add an agent there; once it’s Managed, untick a box to leave that tool out. “One-way” means edits flow only from the tool named.' : 'Once it’s Managed, click a tool’s box to leave that tool out.']
        : kind === 'skills' ? ['Click a tool’s box to include it or leave it out. Open a skill to disable or remove it in one tool.']
          : [`Click a tool’s box to include it or leave it out. Turning Managed off keeps existing copies.${kind === 'mcp' ? ' Open a server to disable or enable it in one tool.' : ''}`]))),
    closeButton(() => { writeFlag(key); rerender(); }, { id: 'help-dismiss', label: 'Hide this tip' }));
}

/**
 * What the catch-up after a read copied, and where: shown on the Skills tables and the Harnesses list, until dismissed (it
 * comes back only for a different catch-up). Null once dismissed.
 */
export function caughtUpBand(manage: ManageView): HTMLElement | null {
  // Notices already tell a spread edit or a restore; both places that show this band count the same ones, so a dismiss holds in both.
  const items = caughtUpNames(manage, new Set(manage.notices.map(notice => notice.item)));
  const key = `caught-up:${items.join(',')}`;
  if (!items.length || state.dismissed.has(key)) return null;
  const tools = [...new Set(manage.caughtUp.filter(result => items.includes(result.item) && result.outcome === 'written' && result.harness).map(result => names[result.harness!]))];
  return h('div.band', { role: 'status' }, icon('check', 14, 'tone-success'),
    h('span.band-text', {}, `Caught up: copied ${items.length > 4 ? `${items.slice(0, 4).join(', ')} and ${items.length - 4} more` : andList(items)} to ${tools.length ? andList(tools) : 'the tools that were missing them'}, because ${items.length === 1 ? 'it is' : 'they are'} on. To turn one off in a tool, open it on the Skills page.`),
    closeButton(() => { state.dismissed.add(key); rerender(); }, { id: 'caught-up-dismiss' }));
}

/**
 * MCP servers waiting for Claude Code's own Write step, not already told by a notice: the same inset amber notice as a
 * waiting edit, so Write has one look wherever the step waits. `all` is every waiting server, which Write writes.
 */
function writeStepBand(rest: string[], all: string[]) {
  const missing = rest.filter(name => committedList().find(skill => skill.key === name)?.copies['claude-cli'] === undefined);
  const servers = rest.length === 1 ? 'server' : 'servers';
  const what = missing.length === rest.length
    ? ['Claude Code doesn’t have the ', ...nameList(rest), ` ${servers} yet.`]
    : [`Claude Code has ${rest.length === 1 ? 'an older copy' : 'older copies'} of the `, ...nameList(rest), ` ${servers}.`];
  const quitFirst = state.home?.mode === 'fixture' ? h('span.band-why', {}, ' On your real tools, quit Claude Code first.') : ' Quit Claude Code first; it rewrites its settings file while open.';
  const write = button({ variant: 'primary', size: 'small', label: 'Write to Claude Code', id: 'mcp-write-claude', onclick: () => void writeClaudeNow(all),
    attrs: { title: 'Claude Code rewrites ~/.claude.json while it is open, so Central Knot writes it only when Claude Code is closed.' } });
  return h('div.band.sync-notices.band-write-now', { role: 'status' }, h('div.sync-notice-lines', {},
    h('p.sync-notice.notice-stacked.notice-inline', { 'data-kind': 'write' }, icon('clock', 14, 'tone-warning'),
      h('span.notice-text', {}, ...what, quitFirst), h('span.notice-actions', {}, write))));
}

/**
 * Before Apply all, on MCP: when a waiting change reaches Claude Code, says that Claude Code then takes a second step,
 * so it is no surprise after. Names the servers Claude Code will lack after Apply all.
 */
function secondStepNote() {
  // A draft that only flips a tool's switch copies nothing, so Claude Code has no step to wait for.
  const copies = (key: string, draft: Draft) => { const base = committedOf(key); return !!draft.resolve || draft.managed !== base.managed || [...draft.off].sort().join() !== [...base.off].sort().join(); };
  const reachesClaude = [...view.draft].filter(([key, draft]) => draft.managed && !draft.off.includes('claude-cli') && copies(key, draft));
  if (kind !== 'mcp' || !toolList().includes('claude-cli') || !reachesClaude.length) return null;
  const needs = reachesClaude.filter(([key]) => committedList().find(skill => skill.key === key)?.copies['claude-cli'] === undefined).map(([key]) => key);
  const writtenNow = others('claude-cli').map(tool => names[tool]);
  const practice = state.home?.mode === 'fixture';
  return h('div.band.band-help', { role: 'note' }, icon('info', 14, 'tone-muted'), h('span.band-text', {},
    writtenNow.length ? `Apply all writes to ${andList(writtenNow)} now. After that, ` : 'After Apply all, ',
    ...(needs.length ? nameList(needs) : ['Claude Code']), needs.length === 1 ? ' needs' : ' need', ' one more step: ',
    practice ? 'Write to Claude Code.' : 'quit Claude Code, then click Write to Claude Code.',
    h('span.band-why', {}, practice ? ' On your real tools, quit Claude Code first.' : ' Claude Code rewrites its settings file while running, so it is written only when you click Write.')));
}

/**
 * Another build syncs this home (ORG-08): who, whether it is open now, and Take over syncing. Only one build syncs a home
 * at a time; this one changes no skill, MCP server or agent here until it is told to take over.
 */
function otherOwnerBand(): HTMLElement | null {
  const gate = state.home?.manage.gate;
  if (gate?.state !== 'stopped' || !gate.owner) return null;
  const take = button({ variant: 'outline', size: 'small', label: 'Take over syncing', id: 'take-over-sync', disabled: !!state.busy || !state.home!.manage.access.allowed, onclick: () => void takeOverSync() });
  take.title = takeOverTitle(gate.owner);
  return h('div.band', { role: 'status', id: 'other-owner' }, icon('circle-alert', 14, 'tone-warning'), h('span.band-text', {}, otherOwnerSaid(gate.owner)), take);
}

function mcpNotices() {
  const mcp = listView()!;
  const bands: HTMLElement[] = [];
  for (const band of [syncOffBand(), outcomeBand()]) if (band) bands.push(band);
  if (!mcp.access.allowed) bands.push(h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, mcp.access.reason)));
  const owned = otherOwnerBand();
  if (owned) bands.push(owned);
  for (const problem of mcp.problems) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), h('span.band-text', {}, problem)));
  const unread = unreadBand();
  if (unread) bands.push(unread);
  const result = kind === 'agents' ? state.agentsResult : state.mcpResult;
  const told = toldNotices();
  const shownNotices = told.filter(notice => !state.dismissed.has(notice.history || notice.item));
  const pendingClaude = kind === 'mcp' ? mcp.claudePending : [];
  // An Apply result that stepped aside for this notice took its Undo to History: one muted line says so.
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
  // Agents: a one-way copy edited in its receiving tool gets its own notice, with both ways forward.
  const decisions: HTMLElement[] = [];
  if (kind === 'agents') for (const skill of committedList()) {
    const source = skill.oneWay?.from;
    if (!source || !skill.managed || view.draft.get(skill.key)?.resolve) continue;
    for (const tool of stoppedLive(skill)) {
      const key = `stopped:${skill.key}:${tool}`;
      if (state.dismissed.has(key)) continue;
      decisions.push(h('div.band.sync-notices', { role: 'status' }, h('div.sync-notice-lines', {}, h('p.sync-notice', { 'data-kind': 'stopped' }, icon('circle-pause', 14, 'tone-warning'),
        h('span.notice-text', {}, h('strong.item-name', {}, skill.name ?? skill.key), ` was edited in ${names[tool]}, so ${names[tool]}’s copy stopped updating`, h('span.notice-age', {}, ` · ${age(key)}`)),
        h('span.notice-actions', {}, stoppedActions(skill, tool, source)),
        closeButton(() => { state.dismissed.add(key); rerender(); }, { id: `stopped-dismiss-${skill.key}-${tool}`, label: 'Decide later', title: 'Decide later; the amber box stays', look: '.notice-dismiss' })))));
    }
  }
  // A notice that needs a choice comes before the ones that only tell.
  if (decisions.length) { const at = bands.findIndex(band => band.classList.contains('sync-notices')); bands.splice(at < 0 ? bands.length : at, 0, ...decisions); }
  // Claude Code rewrites ~/.claude.json while it runs, so its entries wait for an explicit write with Claude closed (MCP-02).
  const toldHere = new Set(shownNotices.map(notice => notice.item));
  const rest = mcp.claudePending.filter(name => !toldHere.has(name));
  if (rest.length) bands.push(writeStepBand(rest, mcp.claudePending));
  const second = secondStepNote();
  if (second) bands.push(second);
  const applied = result;
  if (applied?.stopped) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, applied.stopped)));
  const problems = (applied?.results ?? []).filter(result => result.outcome === 'failed' || (result.outcome === 'held' && !/Copies differ|Write now/.test(result.message)));
  if (problems.length) bands.push(h('div.band', { role: 'status' }, icon('triangle-alert', 14, 'tone-warning'), h('span.band-text', {}, problems.slice(0, 4).map(result => `${result.item}${result.harness ? ` (${names[result.harness]})` : ''}: ${result.message}`).join(' · '))));
  const tip = helpBand();
  if (tip) bands.push(tip);
  return bands.length ? h('div.bands', {}, bands) : null;
}

function notices() {
  if (designMode || !state.home) return null;
  if (kind !== 'skills') return mcpNotices();
  const manage = state.home.manage;
  const bands: HTMLElement[] = [];
  for (const band of [syncOffBand(), outcomeBand()]) if (band) bands.push(band);
  if (!manage.access.allowed) bands.push(h('div.band', { role: 'status' }, icon('eye', 14), h('span.band-text', {}, manage.access.reason)));
  const owned = otherOwnerBand();
  if (owned) bands.push(owned);
  else if (manage.gate.state === 'stopped') bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, manage.gate.reason)));
  if (manage.gate.state === 'needs-resume') bands.push(h('div.band', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, manage.gate.reason),
    button({ variant: 'outline', size: 'small', label: 'Resume', id: 'resume', disabled: !canWrite(), onclick: () => void applyClick({ kind: 'skills', changes: [], items: [], said: 'Resumed: sync carries on from the record as it is.' }) })));
  const unread = unreadBand();
  if (unread) bands.push(unread);
  const applied = state.applied;
  // Skills that cannot go somewhere, or whose copies differ, already show that in their row; the band is for failures. A
  // click's refusal is its result, said once, in the result's band.
  const problems = applied ? applied.results.filter(result => (result.outcome === 'failed' || (result.outcome === 'held' && !result.differs)) && !state.outcome?.text.includes(result.message)) : [];
  if (applied?.stopped) bands.push(h('div.band.band-danger', { role: 'status' }, icon('circle-alert', 14), h('span.band-text', {}, applied.stopped)));
  else if (problems.length) bands.push(problemsBand(problems));
  // What sync did on its own (CON-02): each notice names the item, the winning action and where, says whether the order was proved,
  // and offers its Undo, Restore or Delete everywhere right there.
  const syncNotices = toldNotices().filter(notice => !state.dismissed.has(notice.history || notice.item));
  if (syncNotices.length) bands.push(h('div.band.sync-notices', { role: 'status' }, h('div.sync-notice-lines', {}, syncNotices.slice(0, 6).map(notice => syncNotice(notice)),
    syncNotices.length > 6 ? h('p.sync-notice', {}, `and ${syncNotices.length - 6} more in `, smallAction('History', 'notices-history', () => showPage('history'))) : null), dismissNotices(syncNotices)));
  const caughtProblems = applied ? [] : manage.caughtUp.filter(result => result.outcome !== 'written' && result.outcome !== 'removed');
  if (caughtProblems.length) bands.push(problemsBand(caughtProblems));
  const caughtBand = applied ? null : caughtUpBand(manage);
  if (caughtBand) bands.push(caughtBand);
  const tip = helpBand();
  if (tip) bands.push(tip);
  return bands.length ? h('div.bands', {}, bands) : null;
}

/** Pending changes belong to one home: opening another starts clean. */
function forgetOtherHomes() {
  if (!designMode && state.home?.home !== pluginDraftHome) { pluginDraft.clear(); pluginDraftHome = state.home?.home; }
  if (!designMode && state.home?.home !== draftHomes[kind]) { view.draft.clear(); view.comparing = undefined; draftHomes[kind] = state.home?.home; keptNotices.delete(kind); }
  if (!designMode) prunePluginSwitches(pluginDraft, state.home?.pluginItems ?? []);
  // A change for a skill that is no longer there has nothing to apply to.
  // So is a choice of a copy that has gone or changed since it was chosen.
  const byKey = new Map(committedList().map(skill => [skill.key, skill]));
  for (const [key, draft] of [...view.draft]) {
    const skill = byKey.get(key);
    const stale = draft.resolve && draft.resolve !== 'separate' && skill?.hashes && skill.hashes[draft.resolve] !== draft.seen;
    // A background change to this skill (deleted, or managed state changed elsewhere) drops the change made against the old state.
    const moved = skill && !designMode && draft.seenManaged !== undefined && draft.seenManaged !== skill.managed;
    if (!skill || stale || moved) {
      view.draft.delete(key);
      if (stale) announce(`${skill!.name ?? key}: the copy you chose changed, so that choice was dropped. Choose again.`);
      else if (moved) announce(`${skill!.name ?? key} changed since you edited it, so your change to it was dropped.`);
      continue;
    }
    // A switch clicked here that the tool now has anyway (a profile switch flipped it meanwhile) has nothing left to do.
    const done = (Object.entries(draft.switches ?? {}) as [Tool, boolean][]).filter(([tool, off]) => off === !!skill.disabled?.includes(tool));
    if (!done.length) continue;
    const switches = Object.fromEntries(Object.entries(draft.switches!).filter(([tool]) => !done.some(([gone]) => gone === tool)));
    const next = { ...draft, switches };
    if (!next.resolve && next.managed === skill.managed && [...next.off].sort().join() === [...skill.off].sort().join() && !next.remove?.length && !Object.keys(switches).length) view.draft.delete(key); else view.draft.set(key, next);
    const [, off] = done[0];
    announce(`${skill.name ?? key} is already ${off ? 'disabled' : 'enabled'} in ${andList(done.map(([tool]) => names[tool]))} now, so that change was dropped.`);
  }
}

/** The sync notices on screen now, not yet dismissed. */
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

/** A deletion that spread leaves a trace in the table while its notice stands: the name, where it was deleted, and Restore. */
function ghostRows() {
  if (designMode) return null;
  const present = new Set(committedList().map(skill => (skill.name ?? skill.key).toLowerCase()));
  // Not tied to the notice's ×: dismissing the message keeps the way back, until Restore or leaving the page.
  const told = toldNotices();
  const gone = told.filter(notice => notice.kind === 'deleted' && notice.history && notice.item && !present.has(notice.item.toLowerCase()));
  if (!gone.length) return null;
  return h('div', { role: 'rowgroup' }, gone.map(notice => h('div.ov-row.ov-ghost', { role: 'row', 'data-ghost': notice.item },
    h('div.ov-name', { role: 'cell' }, h('span.row-open-spacer'), h('s.ov-name-text', {}, notice.item), h('span.ov-ghost-why', {}, `deleted in ${names[notice.winner] ?? notice.winner}`)),
    h('div.ov-ghost-text', { role: 'cell' }, h('span'),
      button({ variant: 'link', size: 'small', label: 'Restore in all tools', id: `ghost-restore-${notice.history}`, attrs: { title: `Put ${notice.item} back in every tool it synced to` }, onclick: () => void restoreEvent(notice.history) })))));
}

/** Notices stay until read: each read brings only what is new, so the page keeps earlier ones until × or Undo, or another home. */
type Told = SyncNotice & { once?: boolean };
const keptNotices = new Map<Kind, Map<string, Told>>();
const keptSync = new Map<Kind, boolean>();
function toldNotices(): Told[] {
  if (!state.home) return [];
  const fresh = kind === 'skills' ? [...state.home.manage.notices, ...(state.applied?.notices ?? [])] : [...(listView()?.notices ?? []), ...((kind === 'agents' ? state.agentsResult : state.mcpResult)?.notices ?? [])];
  let kept = keptNotices.get(kind);
  if (!kept) keptNotices.set(kind, kept = new Map());
  // A newer event, or turning sync on or off, retires what was said before: it stays in History.
  const news = fresh.filter(notice => !kept!.has(notice.history || notice.item));
  if (news.length || keptSync.get(kind) !== state.home.syncOn) for (const key of [...kept.keys()]) if (!fresh.some(notice => (notice.history || notice.item) === key)) kept.delete(key);
  keptSync.set(kind, state.home.syncOn);
  // The wording is fixed when the notice first shows: a Sync once stays "Synced once" after sync is turned on.
  for (const notice of fresh) { const key = notice.history || notice.item; if (!kept.has(key)) kept.set(key, { ...notice, once: !state.home.syncOn }); }
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

function syncNotice(notice: Told, writeClaude?: () => void) {
  const who = toolName, list = (tools: string[]) => andList(tools.map(toolName));
  const order = notice.orderProved ? '' : ' The order could not be proved, so the fixed tool order decided.';
  // The button names the tools it changes: all of them, or only those the event touched.
  const involved = [...new Set([notice.winner, ...notice.losers].filter(Boolean))] as string[];
  const scope = `in ${toolsPhrase(involved, toolList())}`;
  // Undo is the one action here that writes files: a small outlined button, apart from the quieter links.
  const undo = (title: string) => { const action = button({ variant: 'outline', size: 'small', label: `Undo ${writeClaude || notice.kind === 'edit' ? 'edit ' : ''}${scope}`, id: `notice-undo-${notice.history}`, onclick: () => void restoreEvent(notice.history) }); action.title = title; action.setAttribute('aria-label', `Undo: ${title}`); return action; };
  const offNow = notice.once ?? (!!state.home && !state.home.syncOn);
  const [glyph, tone, text, action] = ({
    edit: ['check', 'tone-success', offNow ? `${notice.item} copied from ${who(notice.winner)} to ${list(notice.losers)}.` : `${notice.item} was edited in ${who(notice.winner)} and copied to ${list(notice.losers)}.`, undo(`Put ${notice.item} back as it was before ${who(notice.winner)}’s edit, in every tool it syncs to (${who(notice.winner)} too)`)],
    conflict: ['diff', 'tone-warning', `${notice.item}: ${who(notice.winner)}’s edit won over ${list(notice.losers)}’s.${order}`, undo(`Use ${list(notice.losers)}’s version of ${notice.item} instead, in every tool it syncs to`)],
    deleted: ['trash-2', 'tone-muted', `${notice.item} was deleted in ${who(notice.winner)}, so it was removed from ${list(notice.losers) || 'nowhere else'} too.`, button({ variant: 'outline', size: 'small', label: `Restore ${scope}`, id: `notice-restore-${notice.history}`, onclick: () => void restoreEvent(notice.history) })],
    'kept-edit': ['diff', 'tone-warning', `${notice.item}: ${who(notice.winner)}’s edit was kept over its deletion in ${list(notice.losers)}.${order}`, notice.orderProved || notice.key.includes(':') ? null : smallAction('Delete everywhere', `notice-delete-${notice.key}`, () => void deleteEverywhereKey(notice.key))],
    reset: ['triangle-alert', 'tone-warning', kind === 'mcp' ? `${who(notice.winner)}’s settings file lost every managed server at once, so Central Knot put them back instead of deleting them everywhere. To delete one, remove it in one tool while the others still have it.` : `${who(notice.winner)}’s skills folder lost every managed skill at once, so Central Knot put them back instead of deleting them everywhere. To delete one, use Delete everywhere in its details.`, null],
  } as Record<SyncNotice['kind'], [IconName, string, string, HTMLElement | null]>)[notice.kind];
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
    h('span.notice-text', {}, offNow && notice.kind !== 'deleted' && notice.kind !== 'reset' ? 'Synced once: ' : '', ...said.map(part => typeof part === 'string' ? part.replace(/\.$/, '') : part), '', h('span.notice-age', {}, ` · ${age(notice.history || `${notice.kind}:${notice.item}`)}`)),
    writeClaude ? (() => {
      const row = committedList().find(skill => skill.name === notice.item || skill.key === notice.item);
      const before = row?.versions?.['claude-cli']?.text, after = row?.versions?.[notice.winner as Tool]?.text;
      if (!before || !after || before === after) return null;
      const bare = (summary: string) => summary.replace(/^[^·]+·\s*/, '');
      const field = /^Command/.test(after) ? 'command' : 'URL';
      // Words that differ are marked: struck in Claude Code's entry, tinted in the new one.
      const words = (from: string, to: string, keep: 'removed' | 'added') => lineDiff(from.split(/(\s+)/).join('\n'), to.split(/(\s+)/).join('\n'))
        .filter(part => part.kind === 'same' || part.kind === keep).map(part => part.kind === 'same' ? part.text : h(`span.change-${keep}`, {}, part.text));
      // The field is named once, above the pair; short tool labels keep the old and new values side by side.
      return h('span.notice-change', {},
        h('span.notice-change-caption', {}, field === 'URL' ? 'URL' : 'Command'),
        h('span.tone-faint', {}, 'Claude Code (older)'), h('code', {}, ...words(bare(before), bare(after), 'removed')),
        h('span.tone-faint', {}, `${[notice.winner, ...notice.losers].map(who).join(', ')} (new)`), h('code.notice-change-new', {}, ...words(bare(before), bare(after), 'added')));
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
function useTable(which: Kind, harness?: Tool) {
  // An armed Delete everywhere belongs to the visit it was clicked on: another page disarms it.
  if (state.visit !== tablesVisit) { for (const each of Object.values(views)) each.confirmDelete = undefined; tablesVisit = state.visit; }
  kind = which;
  view = views[which];
  focus = harness;
  forgetOtherHomes();
  if (view.shownFor !== harness) startFresh(view, harness);
  if (view.filter === 'attention' && !copiesDifferChipShown()) view.filter = 'all';
  if (view.filter === 'plugins' && !pluginChipShown()) view.filter = 'all';
}

/** Whether the From plugins chip is drawn: some row here is a plugin's. */
const pluginChipShown = () => plugged().rows.some(row => !focus || row.copies[focus as HarnessId]) || committedList().some(skill => inFocus(skill) && fromAPlugin(skill));

/**
 * Whether the Copies differ chip is drawn: something differs once pending changes apply, or differed before them while the
 * filter is on (so it stays to turn off). A Copies differ filter whose chip is gone falls back to All.
 */
const copiesDifferChipShown = () => {
  const list = committedList();
  return list.some(skill => needsChoice(effective(skill))) || (view.filter === 'attention' && list.some(needsChoice));
};

/** A skill's files and contents: the Skills page's files view, from wherever its details were opened. */
function openFiles(key: string) {
  if (state.page !== 'skills') showPage('skills');
  state.skillsView = 'files';
  state.item = key;
  rerender();
}

/** A kind with nothing in any tool, on a harness's page: the empty state under the same bands (problems, access, results) as its table. */
export function emptyKind(which: Kind, harness: Tool, empty: HTMLElement) {
  useTable(which, harness);
  return h('div.page', {}, notices(), empty);
}

/** `harness`: the Harnesses page's view of one tool: its column first, and the rows split by whether it has a copy. */
export function designOverview(which: Kind = 'skills', harness?: Tool) {
  useTable(which, harness);
  const all = rows();
  const needle = view.find.trim().toLowerCase();
  const shown = all.filter(skill => (view.filter === 'all' || (view.filter === 'managed' ? committedOf(skill.key).managed : view.filter === 'unmanaged' ? !committedOf(skill.key).managed : view.filter === 'plugins' ? fromAPlugin(skill) : needsChoice(skill)))
    && (!needle || skill.key.includes(needle) || skill.description.toLowerCase().includes(needle)));
  // A plugin's items follow Find and the chips: shown with All and From plugins, on a harness's page where it has them.
  const plugins = plugged().rows.filter(row => (view.filter === 'all' || view.filter === 'plugins') && (!focus || row.copies[focus as HarnessId])
    && (!needle || row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle)));
  const find = findInput({ id: 'find', label: 'Find', value: view.find, onInput: text => { view.find = text; rerender(); } });
  const open = docked() ? all.find(skill => skill.key === view.comparing) : undefined;
  const openRow = docked() && !open ? plugins.find(row => row.key === view.comparing) : undefined;
  // What no tool uses goes last, under its own heading. Of the rest, the rows a harness's page is about (it has a copy)
  // split into Managed and Unmanaged; the others, only other tools have.
  const idle = shown.filter(skill => placeOf(skill) === 2), used = shown.filter(skill => placeOf(skill) !== 2);
  const here = used.filter(inFocus), away = used.filter(skill => !inFocus(skill));
  // Rows in use that stay in use once the changes apply; the others join the last section, which says so.
  const staying = here.filter(usedAfter);
  managedDrawn = here.some(skill => placeOf(skill) === 0);
  const sections = oneSwitch()
    ? [switchSection('on', here.filter(skill => placeOf(skill) === 0)), switchSection('not-synced', here.filter(skill => placeOf(skill) === 1)), pluginSection(plugins),
      focus ? switchSection('away', away) : null, switchSection('off', idle)]
    : [section('managed', here.filter(skill => placeOf(skill) === 0), staying.filter(skill => skill.managed).length),
      section('unmanaged', here.filter(skill => placeOf(skill) === 1), staying.filter(skill => !skill.managed).length),
      pluginSection(plugins),
      // Items only other tools have: their box in this tool's column adds them here (see setTool).
      focus ? section('away', away, away.length) : null,
      section('unused', idle, idle.length + used.filter(skill => !usedAfter(skill)).length),
      ghostRows()];
  const table = [
    h('div.toolbar.fit-bar', {}, h('div.find', {}, icon('search', 16, 'find-glyph'), find), filterBar(), h('div.toolbar-end', {}, oneSwitch() ? switchToolbarState() : changeBar())),
    notices(),
    // A stable id per kind (and per harness), so a redraw (the dock's breakpoint crossed, say) keeps the table where it was
    // scrolled, and another harness's table opens at its own top.
    h('div.scroll.matrix', { id: `table-${kind}${focus ? `-${focus}` : ''}` },
      withToolCount(h(`div.ov${oneSwitch() ? '.ov-switched' : ''}`, { role: 'table', 'aria-label': `${nouns[kind][1]} and where they ${oneSwitch() ? 'are on' : 'sync'}` },
        // One switch per item: no column heads. Each row's switch comes first, and its marks name their tools.
        oneSwitch() ? null : h('div.ov-row.ov-head', { role: 'row' },
          h('div.ov-name', { role: 'columnheader' }, nouns[kind][0]),
          h('div.ov-managed', { role: 'columnheader' }, 'Managed'),
          toolList().map(toolHead)),
        sections), toolList().length),
      oneSwitch() ? markLegend(all) : legend(all))];
  if (openRow) return h('div.page.ov-page.docked', {}, h('div.dock-main', {}, table), pluginDock(openRow));
  return open ? h('div.page.ov-page.docked', {}, h('div.dock-main', {}, table), itemDock(open))
    : h('div.page.ov-page', {}, table);
}



// ---------- One switch per item ----------
// Skills have one On/Off switch per item, at the start of its row, applied at once in every tool Central Knot manages; the
// row's marks only show where it is on, and each tool's own controls are in its details. (MCP servers and agents still have
// Managed, a box per tool and Apply all.)

/** Whether this page has one switch per item. */
const oneSwitch = () => kind === 'skills';
/** A tool that has no copy yet, and gets one when sync runs next. */
const NEXT_SYNC = 'Gets a copy when sync runs next';
const nameOf = (skill: SampleSkill) => skill.name ?? skill.key;
/** The tools with a copy of it: their own, or one they read in another tool's folder. */
const holders = (skill: SampleSkill) => toolList().filter(tool => skill.copies[tool] !== undefined);
const getsCopy = (skill: SampleSkill, tool: Tool) => getsCopyNext(skill, tool, toolList());

/** "today", "yesterday", "3 days ago": when something happened, for an item's status. */
const daysAgo = (iso: string) => { const days = Math.floor((Date.now() - Date.parse(iso)) / DAY_MS); return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`; };

/**
 * Before a click changes anything, every row's place is kept: rows stay where they are (their look follows) until the page is
 * left or read again, and only then regroup, so nothing moves under the pointer.
 */
const pinRows = () => { if (view.pinned?.at !== pinKey()) view.pinned = { at: pinKey(), places: new Map(committedList().map(skill => [skill.key, standingOf(skill)])) }; };

/**
 * Turns it off in every tool it is on in, each with its own switch: the copies stay (a synced one keeps syncing), and no tool
 * loads it. A tool whose switch can't be used is left on, and the result says why.
 */
function turnOff(skill: SampleSkill) {
  const name = nameOf(skill);
  const { disable, held } = offPlan(skill, toolList());
  const also = stillOn(skill, held, tool => names[tool as Tool], problem => problemText(problem, shownPath));
  const plugins = turnEvery(throughItems(skill), false);
  pinRows();
  if (!disable.length && !plugins.ops.length) { tell({ page: state.page, item: name, warn: true, band: true, text: [also, plugins.left].filter(Boolean).join(' ') || `${name} is off already.` }); rerender(); return; }
  void withPlugins(disable.length ? { kind, items: [name], changes: [{ key: skill.key, managed: skill.managed, off: skill.off as HarnessId[], seenManaged: skill.managed, disable: disable as HarnessId[] }],
    said: `${name} is off in ${toolsPhrase(disable, toolList())}.`, also } : undefined, plugins, also);
}

/**
 * The change that turns it on everywhere: synced to every tool Central Knot manages, none left out, and on in each. `use`: the
 * copy every tool takes where copies differ. A skill with a link or shared copy is taken over as it is turned on (OWN-02).
 */
function onChange(skill: SampleSkill, use?: Tool): Change {
  const enable = toolList().filter(tool => skill.disabled?.includes(tool) && !skill.switchProblem?.[tool]);
  return { key: skill.key, managed: true, off: [], seenManaged: skill.managed, ...(enable.length ? { enable: enable as HarnessId[] } : {}), ...(use ? { use: use as HarnessId, useHash: skill.hashes?.[use] } : {}),
    ...(takesOver(skill, !!use) ? { takeOver: true } : {}) };
}

/** Where it is on once it is on everywhere: every tool that can load it, but `left`, tools that have it through a plugin it stays off in. */
const onPhrase = (skill: SampleSkill, left: Tool[] = []) => toolsPhrase(toolList().filter(tool => (!skill.cannot?.[tool] || throughPluginHere(skill, tool)) && !left.includes(tool)), toolList());

/** Turns it on everywhere: synced to every tool Central Knot manages and on in each. `use`: the copy every tool takes where copies differ. */
function turnOn(skill: SampleSkill, use?: Tool) {
  const name = nameOf(skill);
  const plugins = turnEvery(throughItems(skill), true);
  pinRows();
  const where = onPhrase(skill, plugins.leftIn);
  void withPlugins({ kind, items: [name], changes: [onChange(skill, use)],
    said: use ? `Every tool now uses ${names[use]}’s copy of ${name}, and it is on in ${where}. Replaced copies are kept in History.` : `${name} is on in ${where}.` }, plugins);
}

// ---------- Items tools have through a plugin, on a page with one switch ----------

/** The items a person's own row has through a plugin: in each tool with no copy of its own that has it through an installed plugin. */
const throughItems = (skill: SampleSkill): PluginItemAt[] => toolList().flatMap(tool => { const item = itemThrough(skill, tool); return item ? [item] : []; });
/** The items a plugin's row stands for: one in each tool that has it through the plugin. */
const rowItems = (row: PluginRow): PluginItemAt[] => pluginTools(row).flatMap(tool => (row.installs[tool] ? [{ kind: row.kind, name: row.name, tool, install: row.installs[tool]! }] : []));
/** Whether a plugin's item is on in its tool now. */
const itemOn = (item: PluginItemAt) => pluginStanding(NOW, item).now;

/**
 * One click of a main switch: the item's own copies' change (`click`), then its switches in the tools that have it through a
 * plugin, said together with one Undo for both. `also`: what the click left as it is, when only the plugins' part runs.
 */
async function withPlugins(click: Click | undefined, plugins: ReturnType<typeof turnEvery>, also?: string) {
  if (!plugins.ops.length) { if (click) await applyClick({ ...click, also: [click.also, plugins.left].filter(Boolean).join(' ') || undefined }); return; }
  if (click) await applyClick(click);
  await applyPluginSwitches(plugins.ops, plugins.draft, { before: click ? state.outcome : undefined, also: [click ? undefined : also, plugins.left].filter(Boolean).join(' ') || undefined });
}

/** A plugin's row's one switch: on while some tool has it on; a click turns it on or off in every tool with a switch for one item. */
function pluginRowSwitch(row: PluginRow) {
  const items = rowItems(row);
  const onIn = items.filter(itemOn).map(item => item.tool);
  const on = onIn.length > 0;
  const label = `${row.name}: ${on ? `on in ${toolsPhrase(onIn, toolList())}` : 'off'}. Click to turn it ${on ? 'off' : 'on'} in every tool that can switch it.`;
  return toggle({ on, label, disabled: !canWrite(), id: `switch-${row.key}`, onchange: next => {
    const plugins = turnEvery(items, next);
    pinRows();
    if (!plugins.ops.length) { tell({ page: state.page, item: row.name, warn: true, band: true, text: plugins.left ?? `${row.name} is ${next ? 'on' : 'off'} already.` }); rerender(); return; }
    void withPlugins(undefined, plugins);
  } });
}

/**
 * On for an item with no copy left: every removal of it still open goes back from History, then it is on everywhere like
 * any other, or its copy choice opens when what came back differs.
 */
function putItBack(skill: SampleSkill) {
  const name = nameOf(skill);
  pinRows();
  void putBack({ kind, items: [name], changes: [{ key: skill.key, managed: true, off: [] }], said: `${name} is back, and on in ${onPhrase(skill)}.` }, [skill.gone!.history, ...(skill.gone!.also ?? [])], () => {
    const back = committedList().find(entry => entry.key === skill.key && !entry.gone);
    if (!back) return undefined;
    if (isDiffering(back)) { view.comparing = back.key; return 'choose'; }
    const change = onChange(back);
    return back.managed && !back.off.length && !change.enable ? undefined : change;
  });
}

/** The switch's click: off everywhere, or on everywhere (put back from History when no copy is left, or after a copy choice). */
function flip(skill: SampleSkill, on: boolean) {
  if (!on) { turnOff(skill); return; }
  if (skill.gone) { putItBack(skill); return; }
  if (isDiffering(skill)) {
    view.comparing = undefined;
    openRow(skill.key);
    announce(`${nameOf(skill)}’s copies differ. Choose which copy every tool uses.`, true);
    return;
  }
  turnOn(skill);
}

/** Where an item is not synced: the tools with a copy. */
const notSyncedIn = (skill: SampleSkill) => `Not synced · in ${toolsPhrase(holders(skill), toolList())}`;

/**
 * An item's one switch: on (synced, some tool loads it), in between (not synced: some tools have their own copies), or off
 * (no tool loads it). Clicking an in-between switch turns it on everywhere.
 */
function itemSwitch(skill: SampleSkill, id = `switch-${skill.key}`) {
  const place = standingOf(skill);
  const name = nameOf(skill);
  const now = place === 0 ? 'on' : place === 1 ? notSyncedIn(skill) : skill.gone ? 'off, with no copy left' : 'off';
  const what = skill.held ? skill.held : place === 0 ? 'Click to turn it off in every tool.' : skill.gone ? 'Click to put it back in every tool.' : 'Click to turn it on in every tool.';
  return toggle({ on: place === 0, mixed: place === 1, label: `${name}: ${now}. ${what}`, onchange: next => flip(skill, next), disabled: !canWrite() || (!!skill.held && place !== 0), id });
}

/** How a tool's mark looks: on there, off there (copy kept), no copy, copies differ, or waiting for sync. */
type MarkLook = 'on' | 'off' | 'none' | 'differs' | 'waits';

/**
 * One tool's mark on a row: its look, what it says, and a glyph in place of the tool's own mark where something waits or
 * differs. `state`: what the tool has, as a word (the table's Cell, or "plugin"), for the page's checks.
 */
function markOf(skill: SampleSkill, tool: Tool): { look: MarkLook; words: string; glyph?: IconName; state: string } {
  const given = throughPluginHere(skill, tool);
  if (given) {
    const item = itemThrough(skill, tool);
    const on = item ? itemOn(item) : !given.off;
    return { look: on ? 'on' : 'off', state: on ? 'plugin' : 'plugin-off', words: `${skill.cannot?.[tool] ?? `${names[tool]} has it through the plugin ${given.plugin}.`}${on ? '' : ' It is turned off there.'}` };
  }
  const drawn = cellOf(skill, tool);
  const look = lookOf(skill, tool, drawn);
  // Only a link or the shared copy, on a synced skill: loaded there, but edits never reach it, so it is never called synced.
  if (drawn === 'synced' && notSynced(skill).includes(tool)) {
    const where = outsideRow(skill, tool).replace(/\.$/, '');
    return { ...look, state: 'outside', words: `${names[tool]}: ${look.look === 'off' ? 'off there' : 'on'}; ${where.charAt(0).toLowerCase()}${where.slice(1)}, which Central Knot doesn’t write` };
  }
  return { state: drawn, ...look };
}

function lookOf(skill: SampleSkill, tool: Tool, drawn: Cell): { look: MarkLook; words: string; glyph?: IconName } {
  const reads = skill.copies[tool] !== undefined ? skill.reads?.[tool] : undefined;
  const reading = reads ? `; reads ${names[reads]}’s copy` : '';
  const off = shownDisabled(skill, tool);
  const offWords = off ? `, off there${turnedOffByProfile(skill.key, tool) ? ' by a profile (see Profiles)' : ''} (copy kept)` : '';
  if (drawn === 'cannot') return { look: 'none', words: skill.cannot?.[tool] ?? `${names[tool]} can’t load it` };
  if (drawn === 'absent') return { look: 'none', words: `${names[tool]}: no copy${skill.managed && skill.off.includes(tool) ? ', not synced there' : ''}` };
  if (drawn === 'differs' || drawn === 'present-differs') return { look: 'differs', glyph: 'diff', words: `${names[tool]}: copies differ${offWords}${reading}` };
  if (drawn === 'will-sync') return { look: 'waits', glyph: 'clock', words: `${names[tool]}: ${NEXT_SYNC.toLowerCase()}` };
  if (drawn === 'edited') return { look: 'waits', glyph: 'pencil-line', words: `${names[tool]}: edited here, waiting to spread${offWords}` };
  if (drawn === 'waiting') return { look: 'waits', glyph: 'clock', words: `${names[tool]}: gets the edit when sync runs${offWords}` };
  if (drawn === 'write-now') return { look: 'waits', glyph: 'clock', words: `${names[tool]}: waits for Write to Claude Code` };
  const own = drawn === 'synced' ? 'synced' : skill.managed && skill.off.includes(tool) ? 'its own copy, left out of sync' : 'its own copy, not synced';
  return { look: off ? 'off' : 'on', words: `${names[tool]}: ${off ? '' : 'on, '}${own}${offWords}${reading}` };
}

/** A tool's mark drawn: the tool's own mark (or a glyph), plainly on, struck through and grey for off, faint for none. Never a button. */
function toolMark(look: MarkLook, tool: Tool, glyph?: IconName, size = 14) {
  return h(`span.tool-mark.mark-${look}`, { 'aria-hidden': 'true' }, glyph ? icon(glyph, size, look === 'differs' || look === 'waits' ? 'tone-warning' : '') : brandMark(tool, size));
}

/** A row's marks: one per tool, quiet and small, each naming its tool and what it has in its tooltip. `table`: the table's own (with ids). */
function rowMarks(skill: SampleSkill, size = 14, table = true) {
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

/** The chevron that opens or closes a row's details. */
function openButton(key: string, name: string) {
  const open = view.comparing === key;
  return h('button.row-open', { type: 'button', id: `open-${key}`, 'aria-label': `${open ? 'Hide' : 'Show'} details for ${name}`, 'aria-expanded': String(open), onclick: (event: Event) => { event.stopPropagation(); openRow(key); } },
    icon(open ? 'chevron-down' : 'chevron-right', 14, 'tone-faint'));
}

/** One row: its switch, its name, a mark per tool, and the chevron that opens its details. */
function switchRow(skill: SampleSkill) {
  const open = view.comparing === skill.key;
  return [
    h(`div.ov-row.ov-switch-row${takeFlash(skill.key) ? '.row-flash' : ''}${skill.managed ? '' : '.unmanaged'}${open ? '.open' : ''}`, { role: 'row', 'data-key': skill.key, 'aria-expanded': String(open), onclick: () => openRow(skill.key) },
      h('div.ov-managed', { role: 'cell' }, itemSwitch(skill)),
      nameCell(skill, syncOf(skill, toolList()) === 'attention', false),
      h('div.ov-marks', { role: 'cell' }, rowMarks(skill)),
      h('div.ov-open', { role: 'cell' }, openButton(skill.key, nameOf(skill)))),
    open && !docked() ? details(skill) : null,
  ];
}

/** Rows under one heading: On, Not synced, Off, or (on a harness's page) the ones only other tools have. */
function switchSection(role: 'on' | 'not-synced' | 'off' | 'away', list: SampleSkill[]) {
  if (!list.length) return null;
  const label = role === 'away' ? `Not in ${names[focus!]}` : placeNames()[role === 'on' ? 0 : role === 'not-synced' ? 1 : 2];
  const note = role === 'not-synced' ? 'each tool keeps its own copy' : role === 'off' ? 'every copy off, or none left' : role === 'away' ? 'only other tools have these' : null;
  return h('div', { role: 'rowgroup' },
    h(`div.ov-section${role === 'off' || role === 'away' ? '.ov-section-away' : ''}`, { role: 'row', 'data-section': role },
      h('div.ov-section-label', { role: 'cell' }, h('strong', {}, label), h('span.ov-section-count', {}, String(list.length)), note ? sectionNote(note) : null)),
    [...list].sort(byKey).flatMap(switchRow));
}

/** What the item is now, in one line: on and where, not synced and where its copies are, or off. */
function switchStatus(skill: SampleSkill): string {
  if (skill.gone) return `Off · no copy left: ${skill.gone.kind === 'deleted' ? 'deleted' : 'removed'} ${daysAgo(skill.gone.at)}. Turn it on to put it back from History.`;
  if (skill.held) return `Can’t be synced: ${skill.held}`;
  const off = holders(skill).filter(tool => skill.disabled?.includes(tool));
  const place = standingOf(skill);
  if (place === 0) return [`On in ${toolsPhrase(holders(skill).filter(tool => !skill.disabled?.includes(tool)), toolList())}`, off.length ? `off in ${toolsPhrase(off, toolList())}` : '', outsideStatus(skill)].filter(Boolean).join(' · ');
  if (place === 1) return `${notSyncedIn(skill)}${isDiffering(skill) ? ', with different copies' : ''}. Turn it on to sync it to every tool.`;
  return `Off in ${toolsPhrase(off, toolList())}. The ${off.length === 1 ? 'copy stays' : 'copies stay'}${skill.managed ? ' and keep syncing' : ''}.`;
}

/** What one tool has, for its row in the item's details: what its copy is, then whether its own switch has it off. */
function harnessLine(skill: SampleSkill, tool: Tool): string {
  // Through a plugin: where it comes from, then why its switch can't be used here, or that it is the whole plugin's.
  const through = itemThrough(skill, tool);
  if (through) return [skill.cannot?.[tool], cantSwitch(through) ?? pendingWords(NOW, through)].filter(Boolean).join(' ');
  if (skill.cannot?.[tool]) return skill.cannot[tool]!;
  const has = skill.copies[tool] !== undefined;
  const reads = has ? skill.reads?.[tool] : undefined;
  const readers = has ? toolList().filter(other => skill.reads?.[other] === tool) : [];
  const drawn = cellOf(skill, tool);
  const version = skill.versions?.[tool];
  const tells = version && comparedTools(skill).filter(other => other !== tool).some(other => { const them = skill.versions?.[other]; return them && (them.lines !== version.lines || them.changed !== version.changed); });
  // A broken link by its name in that tool's skills folder: a copy written there replaces it.
  const broken = skill.brokenLink?.[tool] !== undefined ? ` Its skills folder has a broken link by this name${skill.brokenLink[tool] ? ` (to ${skill.brokenLink[tool]})` : ''}; a copy written there replaces it.` : '';
  // Only a link or the shared copy: said where it is (outsideRow), not as a copy of its own.
  const copy = !has ? `${skill.managed && skill.off.includes(tool) ? 'Not synced here.' : getsCopy(skill, tool) ? `${NEXT_SYNC}.` : 'No copy.'}${broken}`
    : outsideOnly(skill, tool) ? ''
    : drawn === 'edited' ? `Edited in ${names[tool]}. It spreads to the other tools when sync runs.`
      : drawn === 'waiting' ? `Gets the edit from ${andList((skill.edited ?? []).map(entry => names[entry]))} when sync runs.`
        : drawn === 'differs' || drawn === 'present-differs' ? `Has a different copy${tells ? ` (${version!.lines}, ${version!.changed})` : ''}.`
          : skill.managed && skill.off.includes(tool) ? 'Has its own copy, not synced.' : skill.managed ? 'Synced.' : 'Has its own copy.';
  const off = has && skill.disabled?.includes(tool) ? `Off here${turnedOffByProfile(skill.key, tool) ? ' by a profile' : ''}: ${names[tool]} doesn’t load its copy.` : '';
  const problem = has && skill.switchProblem?.[tool] ? `${problemText(skill.switchProblem[tool]!, shownPath)} Fix it, then Refresh.` : '';
  const note = has && skill.disableNote?.[tool]?.startsWith('Not checked') ? skill.disableNote[tool] : '';
  return [reads ? `Reads ${names[reads]}’s copy.` : '', outsideRow(skill, tool), copy, off, problem, readers.length ? `${andList(readers.map(other => names[other]))} ${readers.length > 1 ? 'read' : 'reads'} this copy too.` : '', note].filter(Boolean).join(' ');
}

/** One tool's own controls in an item's details, each applied at once: its switch, Remove, or Sync here for a tool left out. */
function harnessControls(skill: SampleSkill, tool: Tool) {
  const given = throughPluginHere(skill, tool);
  // Through a plugin: the item's switch in that tool (its own, or the whole plugin's), with the way to the plugin's page.
  const through = itemThrough(skill, tool);
  if (through && !designMode) return pluginItemControls(through, `enable-${skill.key}-${tool}`, () => openPlugin(given!));
  if (given && !designMode) return h('span.details-tool-actions', {}, smallAction('Plugin’s page', `plugin-${skill.key}-${tool}`, () => openPlugin(given)));
  if (designMode || skill.gone || skill.cannot?.[tool]) return null;
  const name = nameOf(skill), where = names[tool];
  const now = { key: skill.key, managed: skill.managed, off: skill.off as HarnessId[], seenManaged: skill.managed };
  const run = (click: Parameters<typeof applyClick>[0]) => { pinRows(); void applyClick(click); };
  const has = skill.copies[tool] !== undefined;
  // Left out of sync, with a copy of its own or none: Sync here takes it back in (a copy that differs then asks which copy).
  const syncHere = skill.managed && skill.off.includes(tool)
    ? smallAction('Sync here', `sync-here-${skill.key}-${tool}`, () => run({ kind, items: [name], changes: [{ ...now, off: now.off.filter(other => other !== tool), ...(skill.disabled?.includes(tool) && !skill.switchProblem?.[tool] ? { enable: [tool as HarnessId] } : {}) }], said: `${name} syncs to ${where} again.` }), '', !canWrite())
    : null;
  if (syncHere) syncHere.title = `Sync it to ${where} again${has ? '; if its copy there differs, you choose which copy every tool uses' : ''}`;
  if (!has) return syncHere ? h('span.details-tool-actions', {}, syncHere) : null;
  const off = !!skill.disabled?.includes(tool);
  const toggleHere = skill.switchProblem?.[tool] ? h('span.tool-switch-na', {}, icon('circle-alert', 12, 'tone-muted'), 'Can’t switch here')
    : h('span.tool-switch', { title: skill.disableNote?.[tool] }, h('span.tool-switch-word', { 'aria-hidden': 'true' }, off ? 'Off' : 'On'),
      toggle({ on: !off, disabled: !canWrite(), id: `enable-${skill.key}-${tool}`,
        label: `${name} in ${where}: ${off ? 'off' : 'on'}. ${off ? `Click to turn it on there.` : `Click to turn it off there: the copy stays${skill.managed ? ' and keeps syncing' : ''}, and ${where} stops loading it from its next session.`}`,
        onchange: next => run({ kind, items: [name], changes: [{ ...now, ...(next ? { enable: [tool as HarnessId] } : { disable: [tool as HarnessId] }) }], said: `${name} is ${next ? 'on' : 'off'} in ${where}.` }) }));
  const canRemove = kind === 'skills' && removableHere(skill, tool);
  const remove = canRemove ? smallAction('Remove', `remove-${skill.key}-${tool}`, () => run({ kind, items: [name], changes: [{ ...now, remove: [tool as HarnessId] }], said: `${name} removed from ${where}. History keeps it.` }), '.tool-remove', !canWrite())
    : kind === 'skills' ? h('span.tool-remove-slot', { 'aria-hidden': 'true' }) : null;
  if (canRemove && remove) remove.title = `Take ${where}’s copy out now${skill.managed ? ', and stop syncing it there' : ''}. History keeps it.`;
  return h('span.details-tool-actions', {}, syncHere, toggleHere, remove);
}

/**
 * An item's details on a page with one switch: its status, each tool with its own controls, where each copy is, and Delete
 * everywhere last. While its copies differ, only the question of which copy every tool uses, and the copies.
 */
function switchDetails(skill: SampleSkill, placement: Placement): HTMLElement {
  const inFiles = placement === 'files';
  const differs = isDiffering(skill);
  const toolRow = (tool: Tool) => h('div.details-tool', {}, h('div.details-tool-head', {},
    h('span.details-tool-label', {}, brandMark(tool, 14), h('strong', {}, names[tool])),
    h('span.details-tool-line', {}, harnessLine(skill, tool)),
    harnessControls(skill, tool)));
  const close = placement === 'row' ? h('button.details-close', { type: 'button', id: `close-${skill.key}`, 'aria-label': `Close details for ${skill.key}`, title: 'Close', onclick: () => { view.comparing = undefined; rerender(); } }, icon('x', 14)) : null;
  const box = (...children: (Child | Child[])[]) => h(`div.compare.details.details-skills${placement === 'row' ? '' : '.details-bare'}${differs ? '.details-differs' : ''}`, { role: 'region', 'aria-label': `Details for ${skill.key}` }, ...children);
  if (differs) return box(close, compareChoices(skill, inFiles));
  const files = inFiles || skill.gone || designMode ? null : smallAction('Files and contents', `files-${skill.key}`, () => openFiles(skill.key));
  return box(
    h('div.details-head', {},
      // The Files view's pane says it under the skill's name.
      inFiles ? null : h('p.details-status', {}, switchStatus(skill)),
      partNote(skill),
      designMode || skill.gone ? null : outsideNote(skill),
      files ? h('div.details-actions', {}, files) : null),
    // A copy outside Central Knot's own (a link, the shared copy) is said in the note above, and its path under Where each copy is.
    (skill.extra ?? []).some(extra => !extra.outside) ? h('div.details-extra', {}, (skill.extra ?? []).filter(extra => !extra.outside).map(extra => h('p.details-extra-line', {}, icon(extra.same ? 'check' : 'diff', 12, extra.same ? 'tone-muted' : 'tone-warning'),
      `${names[extra.tool]} also reads ${extra.same ? 'the same copy' : 'a different copy'} at `, h('span.details-path', { title: extra.directory }, shownPath(extra.directory)),
      extra.writable ? '' : '. Central Knot does not change it: it is inside a skills folder that is a link or another tool’s.'))) : null,
    skill.gone ? null : h('div.details-tools', {}, toolList().map(toolRow)),
    inFiles ? null : wherePaths(skill),
    skill.converted ? h('p.details-limits.details-note', {}, icon('info', 12, 'tone-muted'), `Converted from ${names[skill.converted.origin] ?? skill.converted.origin}’s agent “${skill.converted.agent}”, as a one-time copy; ${names[skill.converted.origin] ?? skill.converted.origin} keeps the agent, and edits here never change it. As a skill it has no ${andList(skill.converted.losses)}.`) : null,
    inFiles || skill.gone ? null : (() => { const remove = deleteAction(skill); return remove ? h('div.details-actions.details-danger', {}, remove) : null; })());
}

/** What waits, in the toolbar: edits waiting for sync, or that sync is off. Rows say the rest. */
function switchToolbarState() {
  const edits = committedList().filter(skill => skill.managed && skill.edited?.length).length;
  if (edits) return h('span.apply-state.apply-waiting', {}, icon('clock', 14, 'tone-warning'), `${edits} ${edits === 1 ? 'change' : 'changes'} waiting`);
  return state.home && !state.home.syncOn ? h('span.apply-state.apply-quiet', {}, icon('circle-minus', 14, 'tone-muted'), 'Nothing waiting · sync off') : null;
}

/** The key under a table with one switch per item: the marks it shows, drawn with the first tool's mark. */
function markLegend(list: SampleSkill[]) {
  const looks = new Map<string, { look: MarkLook; glyph?: IconName }>();
  for (const skill of list) for (const tool of toolList()) {
    const { look, glyph } = markOf(skill, tool);
    const byProfile = look === 'off' && turnedOffByProfile(skill.key, tool);
    looks.set(byProfile ? 'profile' : glyph ?? look, { look, glyph });
  }
  const tool = toolList()[0];
  if (!tool) return null;
  const entry = (key: string, label: string) => (looks.has(key) ? h('span.legend-item', {}, toolMark(looks.get(key)!.look, tool, looks.get(key)!.glyph, 12), label) : null);
  const keyed = h('div.legend', { 'aria-label': 'Key' },
    entry('on', 'On there'), entry('off', 'Off, copy kept'), entry('profile', 'Off by a profile (see Profiles)'), entry('none', 'No copy'), entry('diff', 'Copies differ'),
    entry('pencil-line', 'Edited, waiting to spread'), entry('clock', 'Waits for sync'));
  return keyed.childElementCount ? keyed : null;
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
 * A description pushed onto the cell's hidden second line, after a tag or pill that took the room, has none.
 * Run after layout (dom.ts afterLayout).
 */
function settleDescriptions(): void {
  for (const table of document.querySelectorAll<HTMLElement>('.ov')) {
    table.classList.remove('no-about');
    const widths = [...table.querySelectorAll<HTMLElement>('.ov-name-about')].map(about => (about.offsetTop >= about.offsetHeight ? 0 : about.clientWidth));
    table.classList.toggle('no-about', widths.length > 0 && Math.min(...widths) < ABOUT_MIN);
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
  if (!all.length) { state.skillsView = 'table'; return designOverview('skills'); }
  const needle = view.listFind.trim().toLowerCase();
  // The table's order and headings: on, then not synced, then off.
  const place = new Map(all.map(skill => [skill.key, placeOf(skill)]));
  const shown = all.filter(skill => !needle || skill.key.includes(needle) || (skill.name ?? '').toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle))
    .sort((first, second) => place.get(first.key)! - place.get(second.key)! || byKey(first, second));
  const chosen = all.find(skill => skill.key === state.item);
  // The detail always shows a skill: the chosen one, else the first listed. In narrow content it sits below the list.
  const shownDetail = chosen ?? shown[0] ?? all[0];
  const listRow = (skill: SampleSkill) => h(`button.list-row${skill === shownDetail ? '.selected' : ''}`, {
    type: 'button', id: `list-${skill.key}`, 'aria-pressed': String(skill === shownDetail),
    'aria-label': `${skill.name ?? skill.key}, ${placeNames()[standingOf(skill)].toLowerCase()}`,
    onclick: () => select(skill.key),
  },
    middle(skill.name ?? skill.key, 12, 'list-name'),
    // The same marks as the table's rows, smaller.
    h('span.list-cells', {}, rowMarks(skill, 12, false)));
  const find = findInput({ id: 'skills-find', label: 'Find a skill', value: view.listFind, onInput: text => { view.listFind = text; rerender(); } });
  const list = shown.length
    ? h('div', { role: 'group', 'aria-label': 'Skills' }, shown.flatMap((skill, index) => [
      index && place.get(shown[index - 1].key) === place.get(skill.key) ? null : h('div.list-group', {}, placeNames()[place.get(skill.key)!]), listRow(skill)]))
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
  return h('div.page.split', {},
    h('div.list-column', {},
      h('div.toolbar.list-toolbar.fit-bar', {}, button({ variant: 'ghost', size: 'small', icon: 'arrow-left', label: 'Table', name: 'Back to the skills table', id: 'skills-table', collapse: true, onclick: showSkillsTable }), h('div.find', {}, icon('search', 16, 'find-glyph'), find)),
      // The header rides inside the list's scroll area, so it has the rows' exact width, gutter and columns.
      h('div.scroll.list-scroll', { id: 'skills-list' },
        h('div.list-head', { 'aria-hidden': 'true' }, h('span', {}, 'Skill')),
        list)),
    h('section.detail-column', { id: 'skill-detail', 'aria-label': 'Skill details' },
      // The skill's own switch comes first, before its name, as on its row.
      h('div.pane-header.pane-header-switched', {},
        h('div.detail-switch', {}, itemSwitch(skill, `detail-switch-${skill.key}`)),
        h('div.pane-title', {}, h('h2', {}, middle(skill.name ?? skill.key)), h('p', { title: paneStatus }, paneStatus))),
      notices(),
      // A wide pane puts the skill's details beside its files, as a plugin's page puts its README beside what it holds.
      h('div.scroll.detail-scroll', { id: 'detail-scroll' },
        layout.head ? h('div.files-details', {}, layout.head) : null,
        h('div.detail-files', {}, ...contents),
        layout.tail.length ? h('div.files-tail', {}, layout.tail) : null)));
}

// Escape in a find box clears it.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const id = (event.target as HTMLElement | null)?.id;
  if (id === 'skills-find' && view.listFind) { view.listFind = ''; rerender(); }
  if (id === 'find' && view.find) { view.find = ''; rerender(); }
});
