// What each plugin installed whole in a tool brings: its skills, MCP servers, agents and hooks, read with the home (main
// process) from the tool's own records and its own copy of the plugin, as that tool reads it. Files only: nothing is run, and a
// copy that can't be read is said, never a reason the personal items go missing. Also what a tool's own settings add to its
// sessions besides those plugins (sessionSettings), read with its instruction file. The page's lines from both: sessionhooks.ts.
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { installedContents, readHooks } from './catalogdetail.ts';
import { openCodeSettings } from './harnesses.ts';
import { readJsonc, readTomlTables } from './textedit.ts';
import { nameOfFile, record, text } from './values.ts';
import { installedCopies, installedPlugins, registeredMarketplaces, type PluginContext } from './plugins.ts';
import { loadsKind, samePart } from './pluginstatus.ts';
import { takesPlugins } from './presence.ts';
import type { DeclaredHook, HarnessId, InstalledPlugin, InstructionFile, NamedPart, PartKind, PluginItem } from './types.ts';

/** Why a copy's items couldn't be listed, when its record says it is there. */
export const UNREADABLE = 'Its files couldn’t be read.';

/**
 * Every plugin installed whole in these tools, with what it brings. Codex leaves a plugin's agents out (it copies them but
 * never loads them, capability-data Appendix D), so its copies list none. Its hooks are kept as its copy declares them
 * (sessionhooks.ts draws those that can add text); commands and the rest stay on the plugin's page.
 * Names and descriptions only: the read runs often, and only an opened item shows its file (readItemTexts).
 */
export async function readPluginItems(context: PluginContext, tools: HarnessId[]): Promise<InstalledPlugin[]> {
  const read = { ...context, reads: context.reads ?? new Map() };
  const perTool = await Promise.all(tools.filter(takesPlugins).map(async tool => {
    const [plugins, markets] = await Promise.all([installedCopies(read, tool).catch(() => []), registeredMarketplaces(read, tool).catch(() => [])]);
    return plugins.map(({ plugin, marketplace, state, off, contents, serversOff, agentsOff, serversHeld }): InstalledPlugin => {
      const source = markets.find(market => market.name === marketplace)?.source;
      const base: InstalledPlugin = { tool, plugin, marketName: marketplace, ...(off ? { off } : {}), items: [], listed: !!source, ...(source ? { source } : {}) };
      if (state.state !== 'installed') return { ...base, problem: state.state === 'not-known' ? state.reason : UNREADABLE };
      if (!contents) return { ...base, problem: UNREADABLE };
      // `path`: the skill's folder ('.' for the plugin's root) or the agent's file, as each copy has it (catalogdetail.ts skillsIn).
      const file = (kind: 'skill' | 'agent') => (part: NamedPart): PluginItem => ({ kind, name: part.name, description: part.description,
        ...(part.path === '.' ? { keyName: plugin } : { keyName: kind === 'agent' ? nameOfFile(basename(part.path)) : basename(part.path) }) });
      const items: PluginItem[] = [
        ...contents.skills.map(file('skill')),
        ...contents.mcpServers.map(server => ({ kind: 'mcp' as const, name: server.name, description: '', runs: server.runs })),
        ...(loadsKind(tool, 'agent') ? contents.agents.map(file('agent')) : []),
      ];
      const skillsOff = (state.skillsOff ?? []).map(entry => entry.skill);
      const skillsHeld = Object.fromEntries((state.skillsOff ?? []).flatMap(entry => (entry.held ? [[entry.skill, entry.held]] : [])));
      return { ...base, version: state.version, items, ...(contents.hooks.length ? { hooks: contents.hooks } : {}), ...(contents.hooksUnread ? { hooksUnread: contents.hooksUnread } : {}), ...(skillsOff.length ? { skillsOff } : {}), ...(serversOff?.length ? { serversOff } : {}), ...(agentsOff?.length ? { agentsOff } : {}),
        ...(state.switchesHeld ? { switchesHeld: state.switchesHeld } : {}), ...(serversHeld ? { serversHeld } : {}), ...(state.live ? { live: true } : {}), ...(Object.keys(skillsHeld).length ? { skillsHeld } : {}) };
    });
  }));
  return perTool.flat();
}

/**
 * What a tool's own settings (in its folder, `root`) add to its sessions besides plugins installed whole: the person's own hooks
 * (`ownHooks`), as Claude Code keeps them (settings.json, https://code.claude.com/docs/en/hooks), Codex (hooks.json, or inline in
 * config.toml, https://learn.chatgpt.com/docs/hooks) and Copilot CLI (settings.json, and each hooks/*.json,
 * https://docs.github.com/en/copilot/reference/hooks-reference); Pi's packages (settings.json `packages`, but one told to load no
 * extensions) and OpenCode's plugins (its settings file's `plugin`), as each is listed (`extensions`). A file missing adds nothing;
 * a hooks file that is there but can't be read, or doesn't parse, is named (`ownHooksUnread`), so it never reads as no hooks.
 * Read with the tool's instruction file (instructions.ts instructionsView); its lines are sessionhooks.ts's.
 */
export async function sessionSettings(tool: HarnessId, root: string): Promise<Pick<InstructionFile, 'ownHooks' | 'ownHooksUnread' | 'extensions'>> {
  const unread: string[] = [];
  /** A file's text: '' where there is none; undefined, and named in `unread`, where it is there but can't be read. */
  const textOf = (file: string) => readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? '' : void unread.push(file)));
  const json = async (file: string) => { try { return record(readJsonc((await textOf(file)) ?? '')); } catch { return undefined; } };
  const hooksIn = async (file: string) => {
    const raw = await textOf(file);
    let settings: Record<string, unknown> | undefined;
    try { settings = raw ? record(readJsonc(raw)) : {}; } catch { /* named below */ }
    if (raw !== undefined && !settings) unread.push(file);
    return readHooks(tool, file, record(settings?.hooks) ?? {});
  };
  switch (tool) {
    case 'claude-cli': return { ownHooks: await hooksIn(join(root, 'settings.json')), ownHooksUnread: unread };
    case 'codex-cli': {
      const toml = join(root, 'config.toml'), inToml = tomlHooks((await textOf(toml)) ?? '');
      if (!inToml) unread.push(toml);
      return { ownHooks: [...await hooksIn(join(root, 'hooks.json')), ...readHooks(tool, toml, inToml ?? {})], ownHooksUnread: unread };
    }
    case 'copilot-cli': {
      const files = (await readdir(join(root, 'hooks')).catch(() => [])).filter(name => name.endsWith('.json')).sort().map(name => join(root, 'hooks', name));
      const ownHooks: DeclaredHook[] = [];
      for (const file of [join(root, 'settings.json'), ...files]) ownHooks.push(...await hooksIn(file));
      return { ownHooks, ownHooksUnread: unread };
    }
    case 'pi-cli': {
      const packages = (await json(join(root, 'settings.json')))?.packages;
      // A package is listed by its source, or as an object with `source` and what of it to load (Pi 1.5.2's docs/packages.md).
      const loading = (entry: unknown) => {
        const listed = record(entry);
        if (!listed) return text(entry);
        return Array.isArray(listed.extensions) && !listed.extensions.length ? '' : text(listed.source);
      };
      return { extensions: (Array.isArray(packages) ? packages : []).map(loading).filter(Boolean) };
    }
    case 'opencode-cli': {
      const plugins = (await json(openCodeSettings(root)))?.plugin;
      return { extensions: (Array.isArray(plugins) ? plugins : []).map(text).filter(Boolean) };
    }
    // Antigravity's own hooks (its hooks.json) are not read yet.
    case 'antigravity-cli': return {};
  }
}

/**
 * Codex's hooks written inline in config.toml (`[[hooks.Event]]` groups, each with `[[hooks.Event.hooks]]` or an inline
 * `hooks = [{ … }]` list), as the JSON form reads them; undefined where the file isn't TOML this reader follows.
 */
function tomlHooks(toml: string): Record<string, unknown> | undefined {
  const hooks: Record<string, { hooks: unknown[] }[]> = {};
  let tables: ReturnType<typeof readTomlTables>;
  try { tables = readTomlTables(toml); } catch { return undefined; }
  for (const { path: [top, event, inner, ...more], array, entries } of tables) {
    const fields = Object.fromEntries(entries.map(entry => [entry.keys.join('.'), entry.value]));
    if (top !== 'hooks' || !event || !array || more.length) continue;
    if (inner === undefined) (hooks[event] ??= []).push({ ...fields, hooks: Array.isArray(fields.hooks) ? fields.hooks : [] });
    else if (inner === 'hooks') hooks[event]?.at(-1)?.hooks.push(fields);
  }
  return hooks;
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
