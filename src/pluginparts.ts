// Pieces the marketplace and plugin pages draw alike: a plugin's one switch, a tool's mark, Update, a README, and "a · b · c"
// lines. The switch acts at once (pluginstate.ts turnPlugin); Update only chooses, and Apply all runs it (pluginplan.ts). What
// the marks and the switch say comes from pluginstatus.ts.
import { rerender, state as app } from './app.ts';
import { button, h, icon, toggle } from './dom.ts';
import { markdown } from './markdown.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { allQueued, pluginKey, toggleMany, type PluginOp } from './pluginplan.ts';
import { clearNotice, market, openLink, shownDetail, turnPlugin } from './pluginstate.ts';
import { PREVIEW_ONLY, addWords, cantUninstall, copyStale, foundIn, outdated, switchPartial, switchWords, toolMark, updateTools, versionToCompare, type ToolMark } from './pluginstatus.ts';
import { pluginUpdates } from './pluginupdateview.ts';
import type { Components, HarnessId, MarketplaceView, NamedPart, PluginView, PluginsView } from './types.ts';
import { andList, toolNames as names } from './words.ts';

/** The name a plugin is shown by: its display name when the catalog gives one. */
export const pluginTitle = (plugin: PluginView) => plugin.displayName ?? plugin.name;

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
  parts: { look: 'cell-synced.cell-on.cell-parts', glyph: () => icon('blocks', 15) },
  'parts-changed': { look: 'cell-differs.cell-on', glyph: () => icon('refresh-cw', 14) },
  stays: { look: 'cell-differs.cell-on', glyph: () => icon('circle-alert', 14) },
  waits: { look: 'cell-waiting', glyph: () => icon('clock', 14) },
  'not-brought': { look: 'cell-kept', glyph: () => icon('circle-off', 14) },
  missing: { look: 'cell-differs', glyph: () => icon('circle-alert', 14) },
  cannot: { look: 'cell-cannot', glyph: () => h('span.cannot-dash', { 'aria-hidden': 'true' }, '–') },
  'kept-out': { look: 'cell-kept', glyph: () => icon('circle-minus', 14) },
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

/**
 * One tool's mark for one plugin: what it has, said by its look and its tooltip; it changes nothing (the plugin's switch
 * and its page's tool lines do). `marketIndex` keeps ids unique across marketplaces; `offered` is the version to compare
 * with, when there is one (see versionToCompare).
 */
export function markCell(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, marketIndex: number, offered: string | undefined) {
  const id = `pcell-${marketIndex}-${plugin.name}-${tool}`;
  const working = market.working;
  if (working?.source === entry.source && working.plugin === plugin.name && working.tools.includes(tool)) {
    return h('div.ov-cell', { role: 'cell' },
      h('span.cell-button.cell-working', { id, 'aria-label': `${names[tool]}: working…`, title: 'Running that tool’s own command…' }, icon('refresh-cw', 14, 'spin')));
  }
  const { mark, words } = markOf(view, entry, plugin, tool, offered);
  const { look, glyph } = MARK_LOOKS[mark];
  return h('div.ov-cell', { role: 'cell' }, h(`span.cell-button.cell-mark.${look}`, { id, role: 'img', title: words, 'aria-label': words, 'data-state': mark }, glyph()));
}

/**
 * A plugin's one switch (pluginrecord.ts): On (striped where it is kept out of a tool that takes it) or Off; for a plugin
 * found in a tool with no entry here, Add in its place. A click records it and runs what its table owes, at once.
 */
export function pluginSwitch(view: PluginsView, entry: MarketplaceView, plugin: PluginView, id: string) {
  const sw = entry.switches?.[plugin.name];
  const found = foundIn(view, sw);
  const stopped = !view.canWrite ? view.reason ?? PREVIEW_ONLY : view.switchProblem;
  if (found.length) {
    const label = stopped ?? addWords(plugin.name, found);
    return h('button.btn.outline.small.add-item', { type: 'button', id: id.replace(/^pswitch/, 'padd'), title: label, 'aria-label': label, disabled: !!app.busy || !!stopped,
      onclick: (event: Event) => { event.stopPropagation(); void turnPlugin(entry, plugin.name, 'add'); } }, 'Add');
  }
  const words = switchWords(view, entry, plugin.name);
  return toggle({ on: !!sw?.entry?.on, partial: switchPartial(view, sw), label: stopped ? `${words.slice(0, words.indexOf('.') + 1)} ${stopped}` : words, disabled: !!app.busy || !!stopped, id,
    onchange: on => void turnPlugin(entry, plugin.name, on ? 'on' : 'off') });
}

/**
 * What Update chooses for one plugin: an update in each tool whose installed copy is older than the marketplace's or
 * differs from it at the same version (pluginstatus.outdated), and
 * its parts brought up to date in each tool holding them out of date. Empty when nothing is out of date.
 */
export function updateOps(view: PluginsView, entry: MarketplaceView, plugin: PluginView): PluginOp[] {
  const detail = shownDetail(pluginKey(entry.source, plugin.name));
  const { plugin: tools, parts } = updateTools(view, entry, plugin.name, versionToCompare(plugin, detail), componentsOf(entry, plugin), detail);
  const op = (tool: PluginOp['tool'], action: PluginOp['action']): PluginOp => ({ source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action });
  return [...tools.map(tool => op(tool, 'update')), ...parts.map(tool => op(tool, 'install-parts'))];
}

/** "Update in Claude Code and Codex" (or in 3 tools) for these ops, or once they are all chosen, the way to take them back. `row`: on a list row. */
export function updateButton(ops: PluginOp[], id: string, { row = false } = {}) {
  const tools = [...new Set(ops.map(op => op.tool))];
  const chosen = allQueued(market.draft, ops);
  // On a list row it is a link, so the row keeps its height, and a click on it doesn't open the plugin.
  return button({ variant: row ? 'link' : chosen ? 'ghost' : 'outline', size: row ? 'micro' : 'small', icon: chosen || row ? undefined : 'refresh-cw', id, disabled: !!app.busy,
    label: chosen ? 'Don’t update' : `Update in ${tools.length > 2 ? `${tools.length} tools` : andList(tools.map(tool => names[tool]))}`,
    attrs: { title: chosen ? 'Leaves it as it is.' : `Chooses the update for ${andList(tools.map(tool => names[tool]))}; it runs on Apply all, and an update can’t be undone.` },
    onclick: (event: Event) => { if (row) event.stopPropagation(); toggleMany(market.draft, ops); clearNotice(); rerender(); } });
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
