// Pieces the marketplace and plugin pages share: why a tool can't take a plugin, its install box, a summary of what a
// plugin holds, and README rendering. A box only chooses a change; Apply all runs it (pluginplan.ts, pluginstate.ts).
import { rerender, state as app } from './app.ts';
import { h, icon } from './dom.ts';
import { markdown } from './markdown.ts';
import { queued, toggle } from './pluginplan.ts';
import { market, openLink } from './pluginstate.ts';
import type { HarnessId, InstallState, MarketplaceView, PluginView, PluginsView } from './types.ts';
import { plural } from './model.ts';
import { toolNames as names } from './words.ts';

/** Why a tool can't take this marketplace's plugins, if it can't. */
export function blocked(view: PluginsView, entry: MarketplaceView, tool: HarnessId): string | undefined {
  if (!view.clis[tool]) {
    return tool === 'codex-cli' && view.desktopOnly?.includes(tool)
      ? 'Only ChatGPT desktop was found. Installing there without the Codex CLI is not known yet.'
      : `${names[tool]}’s command-line tool wasn’t found, so its plugin commands can’t run.`;
  }
  if (tool === 'copilot-cli') return entry.plugins.find(plugin => plugin.copilotRefuses)?.copilotRefuses;
  return undefined;
}

export const installed = (entry: MarketplaceView, plugin: string, tool: HarnessId) => entry.states[plugin]?.[tool]?.state === 'installed';

/** Tools that can still take this plugin: found, allowed, and not installed yet. */
export const missingTools = (view: PluginsView, entry: MarketplaceView, plugin: string) => view.tools.filter(tool => !blocked(view, entry, tool) && !installed(entry, plugin, tool));

/** "3 skills · 1 MCP server", from the counts read with the catalog; empty when contents aren't known before install. */
export function contentsSummary(plugin: PluginView): string {
  const parts = plugin.components;
  if (!parts) return '';
  return [parts.skills && plural(parts.skills, 'skill'), parts.commands && plural(parts.commands, 'command'), parts.agents && plural(parts.agents, 'agent'),
    parts.hooks && 'hooks', parts.mcp && plural(parts.mcp, 'MCP server'), parts.bin && 'a bin/ folder'].filter(Boolean).join(' · ');
}

/** One tool's box for one plugin: installed, not installed, or chosen for Apply all. */
export function toolBox(view: PluginsView, entry: MarketplaceView, plugin: PluginView, tool: HarnessId, index: number) {
  const id = `pcell-${index}-${plugin.name}-${tool}`;
  const working = market.working;
  if (working?.source === entry.source && working.plugin === plugin.name && working.tools.includes(tool)) return h('div.ov-cell', { role: 'cell' }, h('span.cell-button.cell-working', { id, 'aria-label': `${names[tool]}: working…`, title: 'Running that tool’s own command…' }, icon('refresh-cw', 14, 'spin')));
  const status: InstallState = entry.states[plugin.name]?.[tool] ?? { state: 'not-installed' };
  const why = blocked(view, entry, tool);
  const busy = !!app.busy || !view.canWrite;
  const pending = queued(market.draft, entry.source, plugin.name, tool);
  const choose = (action: 'install' | 'remove') => (event: Event) => { event.stopPropagation(); toggle(market.draft, { source: entry.source, market: entry.name, plugin: plugin.name, tool, action }); if (app.outcome?.page === 'plugins') app.outcome = undefined; rerender(); };
  const box = (look: string, dataState: string, title: string, glyph: Element | null, action?: 'install' | 'remove', disabled = busy) =>
    h('div.ov-cell', { role: 'cell' }, h(`button.cell-button.${look}`, { type: 'button', id, title, 'aria-label': title, disabled, 'data-state': dataState, onclick: action ? choose(action) : undefined }, glyph));
  // A box that can't be clicked says why, never "Click to …".
  const cantWhy = !view.canWrite ? 'Preview only: nothing can be installed or uninstalled in this home.' : !view.clis[tool] ? `${names[tool]}’s command-line tool wasn’t found.` : '';
  if (status.state === 'installed') {
    const text = `${names[tool]}: installed${status.live ? ', loaded live from the marketplace folder' : ''}`;
    if (pending === 'remove') return box('cell-pending.cell-pending-remove', 'remove', `${names[tool]}: uninstalled on Apply all. Click to keep it.`, icon('x', 15), 'remove');
    return box('cell-synced.cell-on', 'installed', cantWhy ? `${text}. Can’t uninstall here: ${cantWhy}` : `${text}. Click to uninstall on Apply all.`, icon('check', 16), 'remove', busy || !view.clis[tool]);
  }
  if (why) return box('cell-cannot', 'cannot', `${names[tool]}: ${why}`, h('span.cannot-dash', { 'aria-hidden': 'true' }, '–'), undefined, true);
  if (pending === 'install') return box('cell-pending.cell-chosen.cell-on', 'install', `${names[tool]}: installed on Apply all. Click to leave it out.`, icon('plus', 15), 'install');
  if (status.state === 'not-known') return box('cell-differs', 'not-known', cantWhy ? `${status.reason} ${cantWhy}` : `${status.reason} Click to install again on Apply all.`, icon('circle-question-mark', 16), 'install');
  return box('cell-absent.plugin-add', 'absent', cantWhy ? `Not installed in ${names[tool]}. ${cantWhy}` : `Not installed in ${names[tool]}. Click to install on Apply all.`, icon('plus', 14, 'plugin-add-glyph'), 'install');
}

/** Rendered READMEs by text: a redraw (every box click) reuses the built nodes instead of parsing the README again. */
const rendered = new Map<string, HTMLElement>();
/**
 * A README as page content. Its opening title and first paragraph are left out when they only repeat the name and
 * description already shown above it.
 */
export function readme(body: string, name: string, description = ''): HTMLElement {
  const cacheKey = `${name}\u0000${description}\u0000${body}`;
  const cached = rendered.get(cacheKey);
  if (cached) return cached;
  const node = markdown(body, openLink, { skipTitle: name, skipLead: description });
  if (rendered.size > 40) rendered.clear();
  rendered.set(cacheKey, node);
  return node;
}
