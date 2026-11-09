// Pieces the marketplace and plugin pages draw alike: a tool's install box, a README, and "a · b · c" lines. A box only
// chooses a change; Apply all runs it (pluginplan.ts, pluginstate.ts). What the boxes say comes from pluginstatus.ts.
import { rerender, state as app } from './app.ts';
import { h, icon } from './dom.ts';
import { markdown } from './markdown.ts';
import { componentsFrom } from './pluginoutcomes.ts';
import { pluginKey, queued, toggle, type PluginAction } from './pluginplan.ts';
import { clearNotice, market, openLink } from './pluginstate.ts';
import { PREVIEW_ONLY, cantUninstall, partsOf, partsOffer, partsSummary, stateOf, unavailable, versionWord } from './pluginstatus.ts';
import type { Components, HarnessId, MarketplaceView, NamedPart, PluginView, PluginsView } from './types.ts';
import { toolNames as names } from './words.ts';

/** The name a plugin is shown by: its display name when the catalog gives one. */
export const pluginTitle = (plugin: PluginView) => plugin.displayName ?? plugin.name;

/** What a plugin holds, as far as known: the catalog's counts, or its files once read (a plugin kept elsewhere). */
export function componentsOf(entry: MarketplaceView, plugin: PluginView): Components | undefined {
  if (plugin.components) return plugin.components;
  const read = market.details.get(pluginKey(entry.source, plugin.name));
  return read && !read.reading && read.value && !read.value.problem ? componentsFrom(read.value) : undefined;
}

/** "Parts from version 1.1; the plugin is now 1.2", or the same without versions, for parts whose plugin has changed. */
export const changedWords = (parts: { version?: string; now?: string }) => (parts.now && parts.version ? `Parts are from version ${parts.version}; the plugin is now ${parts.now}` : 'The plugin’s parts have changed since they were installed');

/**
 * One tool's box for one plugin: installed, not installed, chosen for Apply all, or not available, each saying why.
 * `marketIndex` is the marketplace's place in the list, so box ids stay unique across marketplaces.
 */
export function toolBox(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, marketIndex: number) {
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

  const why = unavailable(view, entry, plugin.name, tool);
  // A tool that can't take the plugin may take its parts as separate items (parts.ts): its box chooses those instead.
  if (partsOffer(view, entry, plugin.name, tool, componentsOf(entry, plugin))) {
    const parts = partsOf(entry, plugin.name, tool);
    const preview = view.canWrite ? '' : ` ${PREVIEW_ONLY}`;
    if (pending === 'remove-parts') return box({ look: 'cell-pending.cell-pending-remove', state: 'remove-parts', title: `${name}: its parts are removed on Apply all. Click to keep them.`, glyph: icon('x', 15), action: 'remove-parts' });
    if (pending === 'install-parts') return box({ look: 'cell-pending.cell-chosen.cell-on', state: 'parts-chosen', title: `${name}: its parts are ${parts ? 'updated' : 'installed as separate items'} on Apply all. Click to leave ${parts ? 'them as they are' : 'them out'}.`, glyph: icon('blocks', 15), action: 'install-parts' });
    if (parts?.changed) return box({ look: 'cell-differs.cell-on', state: 'parts-changed', title: `${name}: ${changedWords(parts)}. ${preview.trim() || 'Click to update them on Apply all.'}`, glyph: icon('refresh-cw', 14), action: 'install-parts' });
    if (parts) {
      const from = [partsSummary(parts.items), versionWord(parts.version) && `from ${versionWord(parts.version)}`].filter(Boolean).join(', ');
      return box({ look: 'cell-synced.cell-on.cell-parts', state: 'parts', title: `${name}: its parts are installed as separate items (${from}). ${preview.trim() || 'Click to remove them on Apply all.'}`, glyph: icon('blocks', 15), action: 'remove-parts' });
    }
    return box({ look: 'cell-parts-offer', state: 'parts-offer', title: `${name}: ${why} ${preview.trim() || 'Click to install its parts (skills, MCP servers, agents) as separate items on Apply all.'}`, glyph: icon('plus', 13, 'plugin-add-glyph'), action: 'install-parts' });
  }
  if (why) return box({ look: 'cell-cannot', state: 'cannot', title: `${name}: ${why}`, glyph: h('span.cannot-dash', { 'aria-hidden': 'true' }, '–'), disabled: true });
  // A box that can't be clicked says why, never "Click to …". An available tool has its CLI, so only a preview stops an install.
  const preview = view.canWrite ? '' : PREVIEW_ONLY;
  if (status.state === 'installed') {
    const text = `${name}: installed${status.live ? ', loaded live from the marketplace folder' : ''}`;
    if (pending === 'remove') return box({ look: 'cell-pending.cell-pending-remove', state: 'remove', title: `${name}: uninstalled on Apply all. Click to keep it.`, glyph: icon('x', 15), action: 'remove' });
    const stuck = cantUninstall(view, entry, plugin.name, tool);
    return box({ look: 'cell-synced.cell-on', state: 'installed', title: stuck ? `${text}. Can’t uninstall here: ${stuck}` : `${text}. Click to uninstall on Apply all.`,
      glyph: icon('check', 16), action: 'remove', disabled: !!app.busy || !!stuck });
  }
  // Chosen differs from empty by shape, not only colour: a dashed check where the empty box has a plus.
  if (pending === 'install') return box({ look: 'cell-pending.cell-chosen.cell-on', state: 'install', title: `${name}: installed on Apply all. Click to leave it out.`, glyph: icon('check', 15), action: 'install' });
  if (status.state === 'not-known') {
    return box({ look: 'cell-differs', state: 'not-known', title: `${status.reason} ${preview || 'Click to install again on Apply all.'}`, glyph: icon('circle-question-mark', 16), action: 'install' });
  }
  return box({ look: 'cell-absent.plugin-add', state: 'absent', title: `Not installed in ${name}. ${preview || 'Click to install on Apply all.'}`, glyph: icon('plus', 14, 'plugin-add-glyph'), action: 'install' });
}

/** Rendered READMEs by text and context: a redraw (every box click) reuses the built nodes instead of parsing again. */
const rendered = new Map<string, HTMLElement>();
/**
 * A README as page content. Its opening title, a first paragraph that mostly repeats a description already on the page,
 * and what only repeats the parts the page lists (`parts`, see markdown.trimRepeats) are left out.
 */
export function readme(body: string, name: string, descriptions: string[] = [], parts: NamedPart[] = []): HTMLElement {
  const cacheKey = JSON.stringify([name, descriptions, parts, body]);
  const cached = rendered.get(cacheKey);
  if (cached) return cached;
  const node = markdown(body, openLink, { skipTitle: name, skipLead: descriptions.filter(Boolean), skipParts: parts });
  if (rendered.size > 40) rendered.clear();
  rendered.set(cacheKey, node);
  return node;
}

/** Parts joined with a quiet middle dot between them: "Version 1.2 · by Docs crew · productivity". */
export const dotted = (parts: (string | Element)[]) => parts.flatMap((part, at) => (at ? [h('span.meta-dot', { 'aria-hidden': 'true' }, '·'), part] : [part]));
