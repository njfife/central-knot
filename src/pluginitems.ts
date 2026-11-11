// What each plugin installed whole in a tool brings: its skills, MCP servers and agents, read with the home (main process)
// from the tool's own records and its own copy of the plugin, as that tool reads it. Files only: nothing is run, and a copy
// that can't be read is said, never a reason the personal items go missing.
import { installedContents } from './catalogdetail.ts';
import { installedCopies, installedPlugins, registeredMarketplaces, type PluginContext } from './plugins.ts';
import { samePart } from './pluginstatus.ts';
import { readParts } from './share.ts';
import { takesPlugins } from './presence.ts';
import type { HarnessId, InstalledPlugin, PartKind, PluginItem } from './types.ts';

/** Why a copy's items couldn't be listed, when its record says it is there. */
export const UNREADABLE = 'Its files couldn’t be read.';

/**
 * Every plugin installed whole in these tools, with what it brings. Codex leaves a plugin's agents out (it copies them but
 * never loads them, capability-data Appendix D), so its copies list none. Commands, hooks and the rest stay on the plugin's page.
 * Names and descriptions only: the read runs often, and only an opened item shows its file (readItemTexts).
 */
export async function readPluginItems(context: PluginContext, tools: HarnessId[]): Promise<InstalledPlugin[]> {
  const read = { ...context, reads: context.reads ?? new Map() };
  // A marketplace whose plugins' parts are in some tool stays listed on the Plugins page, added in a tool or not.
  const parts = await readParts(context.home);
  const perTool = await Promise.all(tools.filter(takesPlugins).map(async tool => {
    const [plugins, markets] = await Promise.all([installedCopies(read, tool).catch(() => []), registeredMarketplaces(read, tool).catch(() => [])]);
    return plugins.map(({ plugin, marketplace, state, off, contents, serversOff }): InstalledPlugin => {
      const source = markets.find(market => market.name === marketplace)?.source ?? parts.find(install => install.marketName === marketplace)?.source;
      const base: InstalledPlugin = { tool, plugin, marketName: marketplace, ...(off ? { off } : {}), items: [], listed: !!source, ...(source ? { source } : {}) };
      if (state.state !== 'installed') return { ...base, problem: state.state === 'not-known' ? state.reason : UNREADABLE };
      if (!contents) return { ...base, problem: UNREADABLE };
      const file = (kind: 'skill' | 'agent') => (part: { name: string; description: string }): PluginItem => ({ kind, name: part.name, description: part.description });
      const items: PluginItem[] = [
        ...contents.skills.map(file('skill')),
        ...contents.mcpServers.map(server => ({ kind: 'mcp' as const, name: server.name, description: '', runs: server.runs })),
        ...(tool === 'codex-cli' ? [] : contents.agents.map(file('agent'))),
      ];
      const skillsOff = (state.skillsOff ?? []).map(entry => entry.skill);
      const skillsHeld = Object.fromEntries((state.skillsOff ?? []).flatMap(entry => (entry.held ? [[entry.skill, entry.held]] : [])));
      return { ...base, version: state.version, items, ...(skillsOff.length ? { skillsOff } : {}), ...(serversOff?.length ? { serversOff } : {}),
        ...(state.switchesHeld ? { switchesHeld: state.switchesHeld } : {}), ...(Object.keys(skillsHeld).length ? { skillsHeld } : {}) };
    });
  }));
  return perTool.flat();
}

/** One skill's or agent's file, as each tool's installed copy of its plugin has it: only that plugin's copies are read. */
export async function readItemTexts(context: PluginContext, tools: HarnessId[], item: { plugin: string; marketName: string; kind: PartKind; name: string }): Promise<{ tool: HarnessId; text: string }[]> {
  const found: { tool: HarnessId; text: string }[] = [];
  for (const tool of tools.filter(takesPlugins)) {
    // Codex copies a plugin's agents and never loads them, so it has none to show.
    if (item.kind === 'mcp' || (tool === 'codex-cli' && item.kind === 'agent')) continue;
    for (const install of (await installedPlugins(context, tool).catch(() => [])).filter(candidate => candidate.plugin === item.plugin && candidate.marketplace === item.marketName)) {
      if (install.state.state !== 'installed') continue;
      const contents = await installedContents(tool, install.state.path, install.entry, install.atMarketplaceRoot).catch(() => undefined);
      const part = (item.kind === 'skill' ? contents?.skills : contents?.agents)?.find(candidate => samePart({ kind: item.kind, name: candidate.name }, item));
      if (part) found.push({ tool, text: part.text });
    }
  }
  return found;
}
