// What each plugin installed whole in a tool brings: its skills, MCP servers and agents, read with the home (main process)
// from the tool's own records and its own copy of the plugin, as that tool reads it. Files only: nothing is run, and a copy
// that can't be read is said, never a reason the personal items go missing.
import { codexManifest, pluginContents } from './catalogdetail.ts';
import { installedPlugins, registeredMarketplaces, type PluginContext } from './plugins.ts';
import { takesPlugins } from './presence.ts';
import type { HarnessId, InstalledPlugin, PluginItem } from './types.ts';

/** Why a copy's items couldn't be listed, when its record says it is there. */
export const UNREADABLE = 'Its files couldn’t be read.';

/**
 * Every plugin installed whole in these tools, with what it brings. Codex leaves a plugin's agents out (it copies them but
 * never loads them, capability-data Appendix D), so its copies list none. Commands, hooks and the rest stay on the plugin's page.
 */
export async function readPluginItems(context: PluginContext, tools: HarnessId[]): Promise<InstalledPlugin[]> {
  const read = { ...context, reads: context.reads ?? new Map() };
  const perTool = await Promise.all(tools.filter(takesPlugins).map(async tool => {
    const [plugins, markets] = await Promise.all([installedPlugins(read, tool).catch(() => []), registeredMarketplaces(read, tool).catch(() => [])]);
    return Promise.all(plugins.map(async ({ plugin, marketplace, state, off, entry, atMarketplaceRoot }): Promise<InstalledPlugin> => {
      const source = markets.find(market => market.name === marketplace)?.source;
      const base: InstalledPlugin = { tool, plugin, marketName: marketplace, ...(off ? { off } : {}), items: [], listed: !!source, ...(source ? { source } : {}) };
      if (state.state !== 'installed') return { ...base, problem: state.state === 'not-known' ? state.reason : UNREADABLE };
      try {
        const codex = tool === 'codex-cli' ? await codexManifest(state.path) : undefined;
        const contents = await pluginContents(state.path, entry ?? {}, state.path, { codex, skillsListReplaces: tool === 'copilot-cli', atMarketplaceRoot });
        const items: PluginItem[] = [
          ...contents.skills.map(part => ({ kind: 'skill' as const, name: part.name, description: part.description, text: part.text })),
          ...contents.mcpServers.map(server => ({ kind: 'mcp' as const, name: server.name, description: '', runs: server.runs })),
          ...(tool === 'codex-cli' ? [] : contents.agents.map(part => ({ kind: 'agent' as const, name: part.name, description: part.description, text: part.text }))),
        ];
        const skillsOff = (state.skillsOff ?? []).map(entry => entry.skill);
        return { ...base, version: state.version, items, ...(skillsOff.length ? { skillsOff } : {}) };
      } catch { return { ...base, problem: UNREADABLE }; }
    }));
  }));
  return perTool.flat();
}
