// Pieces the marketplace and plugin pages draw alike: a tool's install box, a README, and "a · b · c" lines. A box only
// chooses a change; Apply all runs it (pluginplan.ts, pluginstate.ts). What the boxes say comes from pluginstatus.ts.
import { rerender, state as app } from './app.ts';
import { button, h, icon } from './dom.ts';
import { markdown } from './markdown.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { allQueued, clear, pickOf, pluginKey, queued, toggle, toggleMany, type PluginAction, type PluginOp } from './pluginplan.ts';
import { clearNotice, market, openLink, shownDetail } from './pluginstate.ts';
import { PREVIEW_ONLY, cantUninstall, copyStale, outdated, partsMark, partsOf, partsSummary, pickWords, stateOf, unavailable, updateTools, versionDiffers, versionToCompare, versionWord } from './pluginstatus.ts';
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

/** "Parts from version 1.1; the plugin is now 1.2", or the same without versions, for parts whose plugin has changed. */
export const changedWords = (parts: { version?: string; now?: string }) => (parts.now && parts.version ? `Parts are from version ${parts.version}; the plugin is now ${parts.now}` : 'The plugin’s parts have changed since they were installed');

/**
 * One tool's box for one plugin: installed (with its version), out of date, not installed, chosen for Apply all, or not
 * available, each saying why. An out-of-date box looks like parts out of date and, like it, a click chooses the update;
 * a second click turns that into an uninstall, a third leaves it as it is. Single parts picked for the tool show as a choice too. `marketIndex` is the marketplace's place in the list, so box ids stay unique across marketplaces.
 * `offered` is the version to compare with, when there is one (see versionToCompare).
 */
export function toolBox(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, marketIndex: number, offered: string | undefined) {
  const id = `pcell-${marketIndex}-${plugin.name}-${tool}`;
  const working = market.working;
  if (working?.source === entry.source && working.plugin === plugin.name && working.tools.includes(tool)) {
    return h('div.ov-cell', { role: 'cell' },
      h('span.cell-button.cell-working', { id, 'aria-label': `${names[tool]}: working…`, title: 'Running that tool’s own command…' }, icon('refresh-cw', 14, 'spin')));
  }
  const status = stateOf(entry, plugin.name, tool);
  const pending = queued(market.draft, entry.source, plugin.name, tool);
  const name = names[tool];
  const choose = (action: PluginAction) => (event: Event) => {
    event.stopPropagation();
    toggle(market.draft, { source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action });
    clearNotice();
    rerender();
  };
  /** look: the cell's classes; state: its data-state for tests and styles; action: what a click chooses (none: not clickable). */
  const box = ({ look, state, title, glyph, action, disabled = !!app.busy || !view.canWrite }: { look: string; state: string; title: string; glyph: Element; action?: PluginAction; disabled?: boolean }) =>
    h('div.ov-cell', { role: 'cell' },
      h(`button.cell-button.${look}`, { type: 'button', id, title, 'aria-label': title, disabled, 'data-state': state, onclick: action ? choose(action) : undefined }, glyph));

  // Single parts picked for this tool on the plugin's page, and nothing chosen for the tool as a whole: the box shows that, and a click takes it back.
  const pick = pickOf(market.draft, entry.source, plugin.name, tool);
  if (pick && !pending) {
    const title = `${name}: ${pickWords(pick).replace(/^W/, 'w')} on Apply all, as chosen under “What it holds”. Click to take that back.`;
    const takeBack = (event: Event) => { event.stopPropagation(); clear(market.draft, { source: entry.source, plugin: plugin.name, tool, action: 'pick-parts' }); clearNotice(); rerender(); };
    return h('div.ov-cell', { role: 'cell' }, h('button.cell-button.cell-pending.cell-chosen.cell-on', { type: 'button', id, title, 'aria-label': title, disabled: !!app.busy, 'data-state': 'parts-picked', onclick: takeBack }, icon('blocks', 15)));
  }
  const why = unavailable(view, entry, plugin.name, tool);
  // A tool that can't take the plugin may take its parts as separate items (parts.ts): its box chooses those instead.
  const mark = partsMark(view, entry, plugin.name, tool, componentsOf(entry, plugin));
  if (mark) {
    const parts = partsOf(entry, plugin.name, tool);
    const preview = view.canWrite ? '' : ` ${PREVIEW_ONLY}`;
    if (pending === 'remove-parts') return box({ look: 'cell-pending.cell-pending-remove', state: 'remove-parts', title: `${name}: its parts are removed on Apply all. Click to keep them.`, glyph: icon('x', 15), action: 'remove-parts' });
    if (pending === 'install-parts') return box({ look: 'cell-pending.cell-chosen.cell-on', state: 'parts-chosen', title: `${name}: its parts are ${parts ? 'updated' : 'installed as separate items'} on Apply all. Click to leave ${parts ? 'them as they are' : 'them out'}.`, glyph: icon('blocks', 15), action: 'install-parts' });
    if (mark === 'changed' && parts) return box({ look: 'cell-differs.cell-on', state: 'parts-changed', title: `${name}: ${changedWords(parts)}. ${preview.trim() || 'Click to update them on Apply all.'}`, glyph: icon('refresh-cw', 14), action: 'install-parts' });
    if (mark === 'installed' && parts) {
      const from = [partsSummary(parts.items), versionWord(parts.version) && `from ${versionWord(parts.version)}`].filter(Boolean).join(', ');
      return box({ look: 'cell-synced.cell-on.cell-parts', state: 'parts', title: `${name}: its parts are installed as separate items (${from}). ${preview.trim() || 'Click to remove them on Apply all.'}`, glyph: icon('blocks', 15), action: 'remove-parts' });
    }
    return box({ look: 'cell-parts-offer', state: 'parts-offer', title: `${name}: ${why} ${preview.trim() || 'Click to install its parts (skills, MCP servers, agents) as separate items on Apply all.'}`, glyph: icon('plus', 13, 'plugin-add-glyph'), action: 'install-parts' });
  }
  if (why) return box({ look: 'cell-cannot', state: 'cannot', title: `${name}: ${why}`, glyph: h('span.cannot-dash', { 'aria-hidden': 'true' }, '–'), disabled: true });
  // A box that can't be clicked says why, never "Click to …". An available tool has its CLI, so only a preview stops an install.
  const preview = view.canWrite ? '' : PREVIEW_ONLY;
  if (status.state === 'installed') {
    const detail = shownDetail(pluginKey(entry.source, plugin.name));
    const stale = copyStale(entry, plugin.name, tool, offered, detail);
    const version = status.version ? ` ${status.version}${versionDiffers(status.version, offered) ? ` (the marketplace has ${offered})` : ''}` : '';
    const text = `${name}: installed${version}${status.live ? ', loaded live from the marketplace folder' : ''}${status.directory ? ', from the Anthropic Directory' : ''}${stale ? ', which differs from the marketplace’s copy' : ''}`;
    if (pending === 'remove') return box({ look: 'cell-pending.cell-pending-remove', state: 'remove', title: `${name}: uninstalled on Apply all. Click to keep it.`, glyph: icon('x', 15), action: 'remove' });
    const stuck = cantUninstall(view, entry, plugin.name, tool);
    if (pending === 'update') return box({ look: 'cell-pending.cell-chosen.cell-on', state: 'update', title: `${name}: updated to ${stale || !offered ? 'the marketplace’s copy' : offered} on Apply all. Click to uninstall it instead.`, glyph: icon('refresh-cw', 14), action: 'remove' });
    if (outdated(entry, plugin.name, tool, offered, detail)) return box({ look: 'cell-differs.cell-on', state: 'outdated', title: stuck ? `${text}. Can’t update here: ${stuck}` : `${text}. Click to update it on Apply all.`, glyph: icon('refresh-cw', 14), action: 'update', disabled: !!app.busy || !!stuck });
    return box({ look: 'cell-synced.cell-on', state: 'installed', title: stuck ? `${text}. Can’t uninstall here: ${stuck}` : `${text}. Click to uninstall on Apply all.`,
      glyph: icon('check', 16), action: 'remove', disabled: !!app.busy || !!stuck });
  }
  // Chosen differs from empty by shape, not only colour: a dashed check where the empty box has a plus.
  if (pending === 'install') return box({ look: 'cell-pending.cell-chosen.cell-on', state: 'install', title: `${name}: installed on Apply all. Click to leave it out.`, glyph: icon('check', 15), action: 'install' });
  if (status.state === 'not-known') {
    return box({ look: 'cell-differs', state: 'not-known', title: `${status.reason} ${preview || 'Click to install again on Apply all.'}`, glyph: icon('circle-question-mark', 16), action: 'install' });
  }
  return box({ look: 'cell-absent.plugin-add', state: 'absent', title: `Plugin not installed in ${name}. ${preview || 'Click to install on Apply all.'}`, glyph: icon('plus', 14, 'plugin-add-glyph'), action: 'install' });
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

/** Rendered READMEs by text and context: a redraw (every box click) reuses the built nodes instead of parsing again. */
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
