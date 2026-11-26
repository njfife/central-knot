// Pieces the marketplace and plugin pages draw: a plugin's switch and its click's line (clickNote), a tool's mark on the list
// and its box on the plugin's page, Update, the link to its items in the Library (libraryLink), a README, and "a · b · c"
// lines. The switch's and a box's click wait their turn (pluginstate.ts turnPlugin); Update acts at once (applyPluginOps).
// What they say comes from pluginstatus.ts.
import { acting, state as app } from './app.ts';
import { button, h, icon, toggle } from './dom.ts';
import { markdown } from './markdown.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { pluginKey, resultLines, succeeded, type PluginOp } from './pluginplan.ts';
import { applyPluginOps, clickOn, market, openLink, pluginBusy, shownDetail, turnPlugin, type PluginClick } from './pluginstate.ts';
import { PREVIEW_ONLY, addWords, boxOf, cantUninstall, copyStale, foundIn, inUseIn, itemsAllIn, itemsIn, outdated, stateOf, switchPartial, switchWords, toolMark, updateTools, versionToCompare, type ToolMark } from './pluginstatus.ts';
import { pluginUpdates } from './pluginupdateview.ts';
import type { Components, HarnessId, MarketplaceView, NamedPart, PluginTurn, PluginView, PluginsView } from './types.ts';
import { takesPlugins } from './presence.ts';
import { andList, toolNames as names } from './words.ts';
import { pluginFrom, pluginsHere } from './origins.ts';
import { openKind } from './matrix.ts';

/** The name a plugin is shown by: its display name when the catalog gives one. */
export const pluginTitle = (plugin: PluginView) => plugin.displayName ?? plugin.name;

/**
 * "Its items in the Library", on a plugin's page and its row on Plugins, where it has a row in the Library, an Off item linked
 * to it too (origins.ts pluginsHere; none for a plugin only listed): the Library on All, From set to it (matrix.ts openKind).
 */
export function libraryLink(entry: MarketplaceView, plugin: PluginView, id: string, look: 'page' | 'row') {
  const from = pluginFrom(plugin.name, entry.name);
  if (!app.home || !pluginsHere(app.home).has(from)) return null;
  const go = (event: Event) => { event.stopPropagation(); openKind('all', { from }); };
  return look === 'page' ? button({ variant: 'link', size: 'micro', label: 'Its items in the Library', id, onclick: go })
    : h('button.text-action.plugin-row-library', { type: 'button', id, title: 'Its items in the Library', onclick: go }, 'Its items in the Library');
}

/** What a plugin holds, as far as known: the catalog's counts, or its files once read (a plugin kept elsewhere). */
export function componentsOf(entry: MarketplaceView, plugin: PluginView): Components | undefined {
  if (plugin.components) return plugin.components;
  // A plugin kept elsewhere has no counts from the catalog; once the marketplace's copy of its files is read, they give them.
  const detail = shownDetail(pluginKey(entry.source, plugin.name));
  return detail?.offered ? componentsFrom(detail) : undefined;
}

/** How each mark looks (style.css's cell classes) and its glyph. */
const MARK_LOOKS: Record<ToolMark, { look: string; glyph: () => Element }> = {
  installed: { look: 'cell-synced.cell-on', glyph: () => icon('check', 16) },
  outdated: { look: 'cell-differs.cell-on', glyph: () => icon('refresh-cw', 14) },
  items: { look: 'cell-synced.cell-on', glyph: () => icon('check', 16) },
  'kept-off': { look: 'cell-not-brought', glyph: () => icon('unplug', 14) },
  stays: { look: 'cell-differs.cell-on', glyph: () => icon('circle-alert', 14) },
  waits: { look: 'cell-waiting', glyph: () => icon('clock', 14) },
  'not-brought': { look: 'cell-not-brought', glyph: () => icon('circle-off', 14) },
  missing: { look: 'cell-differs', glyph: () => icon('circle-alert', 14) },
  'parts-waiting': { look: 'cell-waiting', glyph: () => icon('clock', 14) },
  cannot: { look: 'cell-cannot', glyph: () => h('span.cannot-dash', { 'aria-hidden': 'true' }, '–') },
  absent: { look: 'cell-absent', glyph: () => h('span', { 'aria-hidden': 'true' }) },
  unknown: { look: 'cell-differs', glyph: () => icon('circle-question-mark', 16) },
  'not-known': { look: 'cell-differs', glyph: () => icon('circle-question-mark', 16) },
};

/** Whether plugins change by themselves now: the automatic updates on, and Automatic sync on (pluginupdates.ts). */
export const updatesRun = () => !!pluginUpdates.view?.on && !pluginUpdates.view.paused;

/** One tool's mark for a plugin, with its sentence (pluginstatus.ts toolMark), as the list and the plugin page show it. */
export function markOf(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, offered: string | undefined) {
  const detail = shownDetail(pluginKey(entry.source, plugin.name));
  return toolMark(view, entry, plugin.name, tool, entry.switches?.[plugin.name]?.tools[tool],
    { outdated: outdated(entry, plugin.name, tool, offered, detail) && !cantUninstall(view, entry, plugin.name, tool), stale: copyStale(entry, plugin.name, tool, offered, detail), auto: updatesRun() });
}

/** A tool's cell while a command runs there for the plugin, or undefined. */
function workingCell(entry: MarketplaceView, plugin: PluginView, tool: HarnessId, id: string) {
  const working = market.working;
  if (working?.source !== entry.source || working.plugin !== plugin.name || !working.tools.includes(tool)) return undefined;
  return h('div.ov-cell', { role: 'cell' },
    h('span.cell-button.cell-working', { id, 'aria-label': `${names[tool]}: working…`, title: 'Running that tool’s own command…' }, icon('refresh-cw', 14, 'spin')));
}
/** A tool's box while its click waits its turn in the page's list: the list's clock mark (pluginparts.ts clickNote), or undefined. */
function waitingCell(entry: MarketplaceView, plugin: PluginView, tool: HarnessId, id: string) {
  const click = clickOn(entry.source, plugin.name);
  if (click?.state !== 'waiting' || (click.tool && click.tool !== tool)) return undefined;
  return h('div.ov-cell', { role: 'cell' }, h('span.cell-button.cell-box.cell-waiting', { id, 'data-click': 'waiting', 'aria-label': `${names[tool]}: ${click.said.waiting}`, title: click.said.waiting }, icon('clock', 14)));
}

/**
 * One tool's mark for one plugin on the list: what it has, said by its glyph and its tooltip, drawn plain (no box: it changes
 * nothing; the plugin's switch and the boxes on its page do). `marketIndex` keeps ids unique across marketplaces; `offered`
 * is the version to compare with, when there is one (see versionToCompare).
 */
export function markCell(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, marketIndex: number, offered: string | undefined) {
  const id = `pcell-${marketIndex}-${plugin.name}-${tool}`;
  const { mark, words } = markOf(view, entry, plugin, tool, offered);
  const { look, glyph } = MARK_LOOKS[mark];
  return workingCell(entry, plugin, tool, id) ?? h('div.ov-cell', { role: 'cell' }, h(`span.cell-button.cell-mark.cell-plain.${look}`, { id, role: 'img', title: words, 'aria-label': words, 'data-state': mark }, glyph()));
}

/**
 * One tool's box on the plugin's page (pluginstatus.ts boxOf: ticked, or off with why), whose click joins the page's list
 * (pluginstate.ts turnPlugin; what it records: pluginrecord.ts A TOOL'S BOX). Its name and tooltip say what a click will do.
 */
export function toolBox(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, marketIndex: number, offered: string | undefined) {
  const id = `pbox-${marketIndex}-${plugin.name}-${tool}`;
  const { mark, words } = markOf(view, entry, plugin, tool, offered), box = boxOf(view, entry, plugin.name, tool, { mark, words });
  const label = box.held ? words : `${words} ${box.off ?? boxDoes(view, entry, plugin.name, tool, mark, box.ticked)}`;
  // Ticked with its items in full only where each is on there or the same as his (pluginstatus.ts itemsAllIn); else a dash, mixed.
  const some = mark === 'items' && !itemsAllIn(entry, plugin.name, tool), shown = some ? { ...MARK_LOOKS[mark], glyph: () => icon('minus', 16) } : MARK_LOOKS[mark];
  const { look, glyph } = box.ticked || box.held ? shown : { look: 'cell-absent', glyph: () => null };
  return workingCell(entry, plugin, tool, id) ?? waitingCell(entry, plugin, tool, id) ?? h('div.ov-cell', { role: 'cell' }, h(`button.cell-button.cell-box.${look}`, { type: 'button', id, role: 'checkbox', 'aria-checked': some ? 'mixed' : String(box.ticked),
    'aria-label': label, title: label, 'data-state': mark, disabled: !!box.off || pluginBusy(entry.source, plugin.name),
    onclick: () => turnPlugin(entry, plugin.name, box.ticked ? 'keep-out' : 'let-in', tool) }, glyph()));
}

/** What a click on a tool's box does there, and its Undo, in the state it is drawn in (pluginrecord.ts A TOOL'S BOX and row 9). */
function boxDoes(view: PluginsView, entry: MarketplaceView, plugin: string, tool: HarnessId, mark: ToolMark, ticked: boolean): string {
  const what = takesPlugins(tool) ? plugin : `${plugin}’s items`, where = names[tool], sw = entry.switches?.[plugin], on = !!sw?.entry?.on, state = stateOf(entry, plugin, tool);
  if (ticked && state.state === 'installed' && state.off) return `Click to keep ${what} out of ${where}, where it is off already and stays installed. Undo lets it in again.`;
  if (ticked && sw?.tools[tool]?.keeps) return `Click to turn ${what} off in ${where}, kept installed: it stays off until you tick it again. Undo turns it on again.`;
  if (ticked) return `Click to take ${what} out of ${where}: it stays out until you tick it again. Undo puts it back.`;
  if (on && mark !== 'kept-off') return `Click to put ${what} in ${where}. Undo takes it out again.`;
  // A tick on an Off plugin turns it On where another tool has it in use too (marketplaces.ts turnedEntry): "alone" only where none does.
  const alone = on || view.tools.some(other => other !== tool && inUseIn(entry, plugin, other)) ? '' : ' alone';
  return `Click to turn ${plugin} on in ${where}${alone}. Undo ${mark === 'kept-off' ? 'turns it off' : 'takes it out'} again.`;
}

/**
 * A plugin's one switch (pluginrecord.ts): On (striped where it is kept out of a tool that takes it) or Off; for a plugin
 * found in a tool with no entry here, Add in its place. A click joins the page's list (pluginstate.ts turnPlugin).
 */
export function pluginSwitch(view: PluginsView, entry: MarketplaceView, plugin: PluginView, id: string) {
  const sw = entry.switches?.[plugin.name];
  const found = foundIn(view, sw);
  const stopped = !view.canWrite ? view.reason ?? PREVIEW_ONLY : view.switchProblem;
  // Off while its click waits or runs, yet it keeps the focus (aria-disabled), so the keyboard stays on its row; a click is dropped.
  const busy = pluginBusy(entry.source, plugin.name), waits = busy ? { 'aria-disabled': 'true' } : {};
  if (found.length) {
    const label = stopped ?? addWords(plugin.name, found);
    return h('button.btn.outline.small.add-item', { type: 'button', id: id.replace(/^pswitch/, 'padd'), title: label, 'aria-label': label, disabled: !!stopped, ...waits,
      onclick: (event: Event) => { event.stopPropagation(); if (!busy) turnPlugin(entry, plugin.name, 'add'); } }, 'Add');
  }
  const words = switchWords(view, entry, plugin.name);
  return toggle({ on: !!sw?.entry?.on, partial: switchPartial(view, sw), label: stopped ? `${words.slice(0, words.indexOf('.') + 1)} ${stopped}` : words, disabled: !!stopped, id, attrs: waits,
    onchange: on => { if (!busy) turnPlugin(entry, plugin.name, on ? 'on' : 'off'); } });
}

/**
 * What a plugin's click in the page's list says on its row and its page: its aim while it waits ("Waiting to install") and while
 * main runs it ("Installing…"), then what main returned. On its page, every step whole, a failure starting with its tool (the
 * problems band has each whole too). On the list's row (`onRow`), what fits the row's one line: what it did and where, past one
 * tool counted ("Installed in 3 tools", "Installed in 2 tools, not in Codex", "Not installed in Codex"); each tool's reason and
 * the items put in Pi, OpenCode and Antigravity are in the band above and on its page. It stays until the list's news ends
 * (pluginstate.ts endListNews).
 */
export function clickWords(click: PluginClick, onRow = false): { text: string; failed: boolean } {
  if (!click.ran) return { text: click.state === 'waiting' ? click.said.waiting : click.said.running, failed: false };
  const lines = resultLines(click.ran.done), failed = !!click.ran.stopped || lines.some(line => !line.ok);
  if (onRow) return { text: rowWords(click.what, click.ran), failed };
  const text = [...lines.map(line => line.short), click.ran.stopped].filter(Boolean).join('; ') || 'Nothing changed';
  return { text: `${text.charAt(0).toUpperCase()}${text.slice(1)}`, failed };
}
/** Each click's verb on a row, and the word before its tools. */
const ROW_VERBS: Record<PluginTurn, [string, string]> = { on: ['Turned on', 'in'], 'let-in': ['Turned on', 'in'], add: ['Added', 'in'], off: ['Turned off', 'in'], 'keep-out': ['Turned off', 'in'] };
function rowWords(what: PluginTurn, { done, stopped }: NonNullable<PluginClick['ran']>): string {
  const [verb, to] = ROW_VERBS[what], missed = [...new Set(done.filter(step => !succeeded(step.report)).map(step => step.tool))];
  const went = [...new Set(done.map(step => step.tool))].filter(tool => !missed.includes(tool));
  const tools = (list: HarnessId[]) => (list.length === 1 ? names[list[0]!] : `${list.length} tools`);
  if (!went.length) return missed.length ? `Not ${verb.toLowerCase()} ${to} ${tools(missed)}` : stopped ? 'Not done' : 'Nothing changed';
  return `${verb} ${to} ${tools(went)}${missed.length ? `, not ${to} ${tools(missed)}` : ''}`;
}

/** A plugin's latest click in the page's list, on its row (`onRow`: in one line, clickWords) and its page (its whole words, wrapping: style.css .plugin-click). */
export function clickNote(entry: MarketplaceView, plugin: string, onRow = false): HTMLElement | null {
  const click = clickOn(entry.source, plugin);
  if (!click) return null;
  const { text, failed } = clickWords(click, onRow);
  const glyph = click.state === 'waiting' ? icon('clock', 12) : !click.ran ? icon('refresh-cw', 12, 'spin') : icon(failed ? 'triangle-alert' : 'check', 12);
  return h(`span.plugin-click${failed ? '.failed' : ''}`, { 'data-click': click.state }, glyph, h('span', {}, text));
}

/**
 * What Update runs for one plugin: an update in each tool whose installed copy is older than the marketplace's or
 * differs from it at the same version (pluginstatus.outdated), and its items read again where the plugin has something for
 * them. Empty when nothing is out of date.
 */
export function updateOps(view: PluginsView, entry: MarketplaceView, plugin: PluginView): PluginOp[] {
  const detail = shownDetail(pluginKey(entry.source, plugin.name));
  const tools = updateTools(view, entry, plugin.name, versionToCompare(plugin, detail), detail);
  const op = (tool: PluginOp['tool'], action: PluginOp['action']): PluginOp => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action });
  // Its items, read again where the plugin has something for them (pluginlibrary.ts itemsView `ready`).
  const itemTools = view.tools.filter(tool => !takesPlugins(tool)), holding = itemTools.filter(tool => itemsIn(entry, plugin.name, tool));
  const items = view.canWrite && entry.items?.[plugin.name]?.ready ? (holding.length ? holding : itemTools.slice(0, 1)) : [];
  return [...tools.map(tool => op(tool, 'update')), ...items.map(tool => op(tool, 'update-items'))];
}

/** "Update in Claude Code and Codex" (or in 3 tools) for these ops; a click runs them at once. `row`: on a list row. */
export function updateButton(ops: PluginOp[], id: string, { row = false } = {}) {
  const tools = [...new Set(ops.map(op => op.tool))];
  const named = (action: PluginOp['action']) => andList(ops.filter(op => op.action === action).map(op => names[op.tool]));
  const title = [named('update') && `Updates it in ${named('update')} now. An update can’t be undone.`,
    named('update-items') && `Brings its items up to date from the plugin now, in ${named('update-items')}; History can undo each.`];
  // On a list row it is a link, so the row keeps its height, and a click on it doesn't open the plugin.
  return button({ variant: row ? 'link' : 'outline', size: row ? 'micro' : 'small', icon: row ? undefined : 'refresh-cw', id, disabled: acting(),
    label: `Update in ${tools.length > 2 ? `${tools.length} tools` : andList(tools.map(tool => names[tool]))}`, attrs: { title: title.filter(Boolean).join(' ') },
    onclick: (event: Event) => { if (row) event.stopPropagation(); void applyPluginOps(ops); } });
}

/** Rendered READMEs by text and context: a redraw (every click) reuses the built nodes instead of parsing again. */
const rendered = new Map<string, HTMLElement>();
/**
 * A README as page content. Its opening title, a first paragraph that mostly repeats a description already on the page,
 * and what only repeats the parts the page lists (`parts`, see markdown.trimRepeats) are left out.
 */
export function readme(body: string, name: string, descriptions: string[] = [], parts: Pick<NamedPart, 'name' | 'description'>[] = []): HTMLElement {
  const cacheKey = JSON.stringify([name, descriptions, parts, body]);
  const cached = rendered.get(cacheKey);
  if (cached) return cached;
  const node = markdown(body, openLink, { skipTitle: name, skipLead: descriptions.filter(Boolean), skipParts: parts });
  if (rendered.size > 40) rendered.clear();
  rendered.set(cacheKey, node);
  return node;
}

/** A note in the warning tone with its icon: a tool on another version, or a copy that differs. */
export const versionNote = (text: string | Node, extra = '') => h(`span.plugin-version-differs${extra}`, {}, icon('circle-alert', 12), text);

/** Parts joined with a quiet middle dot between them: "Version 1.2 · by Docs crew · productivity". */
export const dotted = (parts: (string | Element)[]) => parts.flatMap((part, at) => (at ? [h('span.meta-dot', { 'aria-hidden': 'true' }, '·'), part] : [part]));
