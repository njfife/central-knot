// Pieces the marketplace and plugin pages draw alike: a tool's install box, a README, and "a · b · c" lines. A box only
// chooses a change; Apply all runs it (pluginplan.ts, pluginstate.ts). What the boxes say comes from pluginstatus.ts.
import { rerender, state as app } from './app.ts';
import { h, icon } from './dom.ts';
import { markdown } from './markdown.ts';
import { queued, toggle } from './pluginplan.ts';
import { clearNotice, market, openLink } from './pluginstate.ts';
import { PREVIEW_ONLY, cantUninstall, stateOf, unavailable, versionDiffers } from './pluginstatus.ts';
import type { HarnessId, MarketplaceView, NamedPart, PluginView, PluginsView } from './types.ts';
import { toolNames as names } from './words.ts';

/** The name a plugin is shown by: its display name when the catalog gives one. */
export const pluginTitle = (plugin: PluginView) => plugin.displayName ?? plugin.name;

/**
 * One tool's box for one plugin: installed (with its version), not installed, chosen for Apply all, or not available,
 * each saying why. `marketIndex` is the marketplace's place in the list, so box ids stay unique across marketplaces.
 * `offered` is the version the marketplace offers, when known.
 */
export function toolBox(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, marketIndex: number, offered = plugin.version) {
  const id = `pcell-${marketIndex}-${plugin.name}-${tool}`;
  const working = market.working;
  if (working?.source === entry.source && working.plugin === plugin.name && working.tools.includes(tool)) {
    return h('div.ov-cell', { role: 'cell' },
      h('span.cell-button.cell-working', { id, 'aria-label': `${names[tool]}: working…`, title: 'Running that tool’s own command…' }, icon('refresh-cw', 14, 'spin')));
  }
  const status = stateOf(entry, plugin.name, tool);
  const pending = queued(market.draft, entry.source, plugin.name, tool);
  const name = names[tool];
  const choose = (action: 'install' | 'remove') => (event: Event) => {
    event.stopPropagation();
    toggle(market.draft, { source: entry.source, marketName: entry.name, plugin: plugin.name, tool, action });
    clearNotice();
    rerender();
  };
  /** look: the cell's classes; state: its data-state for tests and styles; action: what a click chooses (none: not clickable). */
  const box = ({ look, state, title, glyph, action, disabled = !!app.busy || !view.canWrite }: { look: string; state: string; title: string; glyph: Element; action?: 'install' | 'remove'; disabled?: boolean }) =>
    h('div.ov-cell', { role: 'cell' },
      h(`button.cell-button.${look}`, { type: 'button', id, title, 'aria-label': title, disabled, 'data-state': state, onclick: action ? choose(action) : undefined }, glyph));

  const why = unavailable(view, entry, plugin.name, tool);
  if (why) return box({ look: 'cell-cannot', state: 'cannot', title: `${name}: ${why}`, glyph: h('span.cannot-dash', { 'aria-hidden': 'true' }, '–'), disabled: true });
  // A box that can't be clicked says why, never "Click to …". An available tool has its CLI, so only a preview stops an install.
  const preview = view.canWrite ? '' : PREVIEW_ONLY;
  if (status.state === 'installed') {
    const version = status.version ? ` ${status.version}${versionDiffers(status.version, offered) ? ` (the marketplace has ${offered})` : ''}` : '';
    const text = `${name}: installed${version}${status.live ? ', loaded live from the marketplace folder' : ''}`;
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
