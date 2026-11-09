// Pieces the marketplace and plugin pages share: tool names, why a tool can't take a plugin, its install box, and a
// one-line summary of what a plugin holds. A box only chooses a change; Apply all runs it (pluginplan.ts).
import { rerender, state } from './app.ts';
import { h, icon } from './dom.ts';
import { queued, toggle } from './pluginplan.ts';
import type { HarnessId, InstallState, MarketplaceView, PluginView, PluginsView } from './types.ts';

export const names: Record<HarnessId, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };
export const andList = (items: string[]) => (items.length > 2 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(' and '));
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Why a tool can't take this marketplace's plugins, if it can't. */
export function blocked(view: PluginsView, market: MarketplaceView, tool: HarnessId): string | undefined {
  if (!view.clis[tool]) {
    return tool === 'codex-cli' && state.home?.snapshots.find(snapshot => snapshot.harness === 'codex-cli')?.probe.detail.startsWith('ChatGPT desktop')
      ? 'Only ChatGPT desktop was found. Installing there without the Codex CLI is not known yet.'
      : `${names[tool]}’s command-line tool wasn’t found, so its plugin commands can’t run.`;
  }
  if (tool === 'copilot-cli') return market.plugins.find(plugin => plugin.copilotRefuses)?.copilotRefuses;
  return undefined;
}

export const installed = (market: MarketplaceView, plugin: string, tool: HarnessId) => market.states[plugin]?.[tool]?.state === 'installed';

/** Tools that can still take this plugin: found, allowed, and not installed yet. */
export const missingTools = (view: PluginsView, market: MarketplaceView, plugin: string) => view.tools.filter(tool => !blocked(view, market, tool) && !installed(market, plugin, tool));

/** "3 skills · 1 MCP server", from the counts read with the catalog; empty when contents aren't known before install. */
export function contentsSummary(plugin: PluginView): string {
  const parts = plugin.components;
  if (!parts) return '';
  return [parts.skills && plural(parts.skills, 'skill'), parts.commands && plural(parts.commands, 'command'), parts.agents && plural(parts.agents, 'agent'),
    parts.hooks && 'hooks', parts.mcp && plural(parts.mcp, 'MCP server'), parts.bin && 'a bin/ folder'].filter(Boolean).join(' · ');
}

/** One tool's box for one plugin: installed, not installed, or chosen for Apply all. */
export function toolBox(view: PluginsView, market: MarketplaceView, plugin: PluginView, tool: HarnessId, index: number) {
  if (state.pluginWorking?.plugin === plugin.name && state.pluginWorking.tools.includes(tool)) return h('div.ov-cell', { role: 'cell' }, h('span.cell-button.cell-working', { 'aria-label': `${names[tool]}: working…`, title: 'Running that tool’s own command…' }, icon('refresh-cw', 14, 'spin')));
  const status: InstallState = market.states[plugin.name]?.[tool] ?? { state: 'not-installed' };
  const why = blocked(view, market, tool);
  const busy = !!state.busy || !view.canWrite;
  const id = `pcell-${index}-${plugin.name}-${tool}`;
  const pending = queued(state.pluginDraft, market.source, plugin.name, tool);
  const choose = (action: 'install' | 'remove') => (event: Event) => { event.stopPropagation(); toggle(state.pluginDraft, { source: market.source, market: market.name, plugin: plugin.name, tool, action }); rerender(); };
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
  if (pending === 'install') return box('cell-pending.cell-on', 'install', `${names[tool]}: installed on Apply all. Click to leave it out.`, icon('plus', 15), 'install');
  if (status.state === 'not-known') return box('cell-differs', 'not-known', cantWhy ? `${status.reason} ${cantWhy}` : `${status.reason} Click to install again on Apply all.`, icon('circle-question-mark', 16), 'install');
  return box('cell-absent.plugin-add', 'absent', cantWhy ? `Not installed in ${names[tool]}. ${cantWhy}` : `Not installed in ${names[tool]}. Click to install on Apply all.`, icon('plus', 14, 'plugin-add-glyph'), 'install');
}
