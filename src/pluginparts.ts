// Pieces the marketplace and plugin pages draw alike: a tool's install box, a README, and "a · b · c" lines. A box only
// chooses a change; Apply all runs it (pluginplan.ts, pluginstate.ts). What the boxes say comes from pluginstatus.ts.
import { rerender, state as app } from './app.ts';
import { h, icon } from './dom.ts';
import { markdown } from './markdown.ts';
import { queued, toggle } from './pluginplan.ts';
import { clearNotice, market, openLink } from './pluginstate.ts';
import { cliMissing, stateOf, unavailable } from './pluginstatus.ts';
import type { HarnessId, MarketplaceView, PluginView, PluginsView } from './types.ts';
import { toolNames as names } from './words.ts';

/** The name a plugin is shown by: its display name when the catalog gives one. */
export const pluginTitle = (plugin: PluginView) => plugin.displayName ?? plugin.name;

/**
 * One tool's box for one plugin: installed, not installed, chosen for Apply all, or not available, each saying why.
 * `marketIndex` is the marketplace's place in the list, so box ids stay unique across marketplaces.
 */
export function toolBox(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, marketIndex: number) {
  const id = `pcell-${marketIndex}-${plugin.name}-${tool}`;
  const working = market.working;
  if (working?.source === entry.source && working.plugin === plugin.name && working.tools.includes(tool)) {
    return h('div.ov-cell', { role: 'cell' }, h('span.cell-button.cell-working', { id, 'aria-label': `${names[tool]}: working…`, title: 'Running that tool’s own command…' }, icon('refresh-cw', 14, 'spin')));
  }
  const status = stateOf(entry, plugin.name, tool);
  const pending = queued(market.draft, entry.source, plugin.name, tool);
  const busy = !!app.busy || !view.canWrite;
  // A box that can't be clicked says why, never "Click to …".
  const cantWhy = !view.canWrite ? 'Preview only: nothing can be installed or uninstalled in this home.' : !view.clis[tool] ? `${cliMissing(tool)}.` : '';
  const choose = (action: 'install' | 'remove') => (event: Event) => {
    event.stopPropagation();
    toggle(market.draft, { source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action });
    clearNotice();
    rerender();
  };
  /** look: the cell's classes; state: its data-state for tests and styles; action: what a click chooses (none: not clickable). */
  const box = (look: string, state: string, title: string, glyph: Element | null, action?: 'install' | 'remove', disabled = busy) =>
    h('div.ov-cell', { role: 'cell' }, h(`button.cell-button.${look}`, { type: 'button', id, title, 'aria-label': title, disabled, 'data-state': state, onclick: action ? choose(action) : undefined }, glyph));
  const why = unavailable(view, entry, plugin.name, tool);
  if (why) return box('cell-cannot', 'cannot', `${names[tool]}: ${why}`, h('span.cannot-dash', { 'aria-hidden': 'true' }, '–'), undefined, true);
  if (status.state === 'installed') {
    const text = `${names[tool]}: installed${status.live ? ', loaded live from the marketplace folder' : ''}`;
    if (pending === 'remove') return box('cell-pending.cell-pending-remove', 'remove', `${names[tool]}: uninstalled on Apply all. Click to keep it.`, icon('x', 15), 'remove');
    return box('cell-synced.cell-on', 'installed', cantWhy ? `${text}. Can’t uninstall here: ${cantWhy}` : `${text}. Click to uninstall on Apply all.`, icon('check', 16), 'remove', busy || !view.clis[tool]);
  }
  // Chosen differs from empty by shape, not only colour: a dashed check where the empty box has a plus.
  if (pending === 'install') return box('cell-pending.cell-chosen.cell-on', 'install', `${names[tool]}: installed on Apply all. Click to leave it out.`, icon('check', 15), 'install');
  if (status.state === 'not-known') return box('cell-differs', 'not-known', cantWhy ? `${status.reason} ${cantWhy}` : `${status.reason} Click to install again on Apply all.`, icon('circle-question-mark', 16), 'install');
  return box('cell-absent.plugin-add', 'absent', cantWhy ? `Not installed in ${names[tool]}. ${cantWhy}` : `Not installed in ${names[tool]}. Click to install on Apply all.`, icon('plus', 14, 'plugin-add-glyph'), 'install');
}

/** Rendered READMEs by text and context: a redraw (every box click) reuses the built nodes instead of parsing again. */
const rendered = new Map<string, HTMLElement>();
/**
 * A README as page content. Its opening title, a first paragraph that mostly repeats a description already on the page,
 * and lists that only name parts the page already lists (`partNames`) are left out.
 */
export function readme(body: string, name: string, descriptions: string[] = [], partNames: string[] = []): HTMLElement {
  const cacheKey = JSON.stringify([name, descriptions, partNames, body]);
  const cached = rendered.get(cacheKey);
  if (cached) return cached;
  const node = markdown(body, openLink, { skipTitle: name, skipLead: descriptions.filter(Boolean), skipListsOf: partNames });
  if (rendered.size > 40) rendered.clear();
  rendered.set(cacheKey, node);
  return node;
}

/** Parts joined with a quiet middle dot between them: "Version 1.2 · by Docs crew · productivity". */
export const dotted = (parts: (string | Element)[]) => parts.flatMap((part, at) => (at ? [h('span.meta-dot', { 'aria-hidden': 'true' }, '·'), part] : [part]));
