// A hook as the pages show it (hookLine, on a plugin's page and the Instructions page alike), and the strip on each tool's card on
// the Instructions page, "Hooks that can add text" (Pi's packages, OpenCode's plugins), drawn by instructionspage.ts
// sessionStripView. Pure: nothing here reads a file or runs a hook. Its facts:
// - each plugin installed whole in the tool and On there, with its hooks as its installed copy declares them (HomeView
//   pluginItems, read by pluginitems.ts readPluginItems);
// - the person's own hooks, and Pi's packages and OpenCode's plugins, as the tool's own settings name them (InstructionFile
//   ownHooks and extensions, read by pluginitems.ts sessionSettings).
// What it lists: hooks that start a program when a session starts or with a prompt, by each tool's rule (pluginoutcomes.ts
// addsText, whenItRuns, and the tool's own note, sessionTextNote). A hook's text is known only when it runs, so the strip says
// when it runs, never what it adds. Not listed: other kinds of hook (one that calls a URL or an MCP tool, or asks a model), a
// project's or an organisation's hooks, a skill's or an agent's own hooks, and `additionalContext` printed by other events.
import { addsText, ignoresText, sessionTextNote, textEventsWords, whenItRuns } from './pluginoutcomes.ts';
import { commandLine, toolNames } from './words.ts';
import type { DeclaredHook, HarnessId, InstalledPlugin, InstructionFile } from './types.ts';

/** How a hook starts, in one line: its shell command as written, or its program with its arguments; '' for one that starts nothing here. */
export const hookLine = (hook: DeclaredHook) => (!hook.launch ? '' : 'shell' in hook.launch ? hook.launch.shell : commandLine(hook.launch.program, hook.launch.args));

/** How many colours a plugin's or an extension's mark is drawn in: style.css .origin-0 onwards, light and dark. */
export const ORIGIN_COLOURS = 8;
/**
 * The class of an origin's mark, from its name (a plugin's `name@marketplace`, as the tools key it; an extension's name as
 * listed): one of ORIGIN_COLOURS by a hash, so nothing is stored and a plugin has one colour under every tool. Two may share a
 * colour, so the name is always written beside the mark. The person's own hooks have a fixed mark outside that list (`YOURS`).
 */
export function originMark(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return `origin-${hash % ORIGIN_COLOURS}`;
}
const YOURS = 'origin-yours';

/** One origin on the strip: whose it is (`name`, beside its `mark`), where it is turned off, and its hooks beneath. */
export interface SessionGroup {
  name: string;
  mark: string;
  /** The plugin it comes with, whose page holds its switch when its marketplace is listed (InstalledPlugin listed). */
  plugin?: InstalledPlugin;
  /** The person's own settings file that declares its hooks. */
  settings?: string;
  /** Where else it is turned off: a plugin whose marketplace isn't listed here. */
  says?: string;
  /** Why its hooks aren't known: its installed copy couldn't be read. */
  problem?: string;
  /** Each of its hooks files that couldn't be read: what those declare isn't known. */
  unread: string[];
  /** Each hook that can add text: when it runs, and its command (hookLine). */
  hooks: { when: string; command: string }[];
}
export interface SessionStrip { heading: string; about: string; note?: string; groups: SessionGroup[] }

/** Each tool's own word for what it loads into every session from its settings: Pi's packages, OpenCode's plugins. */
const EXTENSIONS: Partial<Record<HarnessId, string>> = { 'pi-cli': 'packages', 'opencode-cli': 'plugins' };

/**
 * The strip on a tool's card: its heading, one sentence on what it lists and what it doesn't, the tool's note, then the person's
 * own hooks that can add text (a group per settings file), each plugin installed whole in the tool and On there, by name (its
 * hooks, or why they aren't known), and Pi's or OpenCode's extensions. Undefined with nothing to show; a tool whose note says
 * why its hooks have no rows (Copilot CLI's prompt hooks) shows the note alone.
 */
export function sessionStrip(tool: HarnessId, items: InstalledPlugin[], file: Pick<InstructionFile, 'ownHooks' | 'ownHooksUnread' | 'extensions'>): SessionStrip | undefined {
  const rows = (hooks: DeclaredHook[] = []) => hooks.filter(hook => addsText(tool, hook)).map(hook => ({ when: whenItRuns(tool, hook), command: hookLine(hook) }));
  const plugins = items.filter(install => install.tool === tool && !install.off)
    .sort((first, second) => first.plugin.localeCompare(second.plugin) || first.marketName.localeCompare(second.marketName));
  // One plugin name in two marketplaces is told apart by its marketplace.
  const named = (install: InstalledPlugin) => (plugins.some(other => other !== install && other.plugin === install.plugin) ? `${install.plugin} (${install.marketName})` : install.plugin);
  const own = file.ownHooks ?? [], unread = file.ownHooksUnread ?? [];
  const groups: SessionGroup[] = [
    ...[...new Set([...own.filter(hook => addsText(tool, hook)).map(hook => hook.declaredIn), ...unread])].map(settings =>
      ({ name: 'yours', mark: YOURS, settings, unread: unread.filter(path => path === settings), hooks: rows(own.filter(hook => hook.declaredIn === settings)) })),
    ...plugins.map((install): SessionGroup => ({ name: named(install), mark: originMark(`${install.plugin}@${install.marketName}`), plugin: install,
      ...(install.listed ? {} : { says: `${toolNames[tool]}’s own plugin commands turn it off.` }),
      ...(install.problem ? { problem: `${install.problem} What its hooks add isn’t known.` } : {}), unread: install.hooksUnread ?? [], hooks: rows(install.hooks) }))
      .filter(group => group.problem || group.unread.length || group.hooks.length),
    ...(file.extensions ?? []).map(name => ({ name, mark: originMark(name), unread: [], hooks: [] })),
  ];
  const note = sessionTextNote(tool), word = EXTENSIONS[tool];
  if (!groups.length && ![...own, ...plugins.flatMap(install => install.hooks ?? [])].some(hook => ignoresText(tool, hook))) return undefined;
  return word
    ? { heading: `${word[0]!.toUpperCase()}${word.slice(1)} that can add text`, about: `${toolNames[tool]} loads these ${word} into every session, and they can add text to it; what they add is known only when they run.`, groups }
    : { heading: 'Hooks that can add text', groups, ...(note ? { note } : {}),
      about: `These hooks run a program ${textEventsWords(tool)}, and what it prints can be added to the session; that is known only when it runs. Other kinds of hook (one that calls a URL or an MCP tool), and a project’s or an organisation’s hooks, aren’t listed.` };
}
