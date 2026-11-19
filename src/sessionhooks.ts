// A hook as the pages show it (hookLine, on a plugin's page and the Instructions page alike), and "Also in every session": what
// else adds text to a tool's sessions besides its instruction file and the base, as the lines the Instructions page draws on
// each tool's card (instructionspage.ts alsoInEverySession). Pure: nothing here reads a file or runs a hook. Its facts:
// - each plugin installed whole in the tool and On there, with its hooks as its installed copy declares them (HomeView
//   pluginItems, read by pluginitems.ts readPluginItems);
// - the person's own hooks, and Pi's packages and OpenCode's plugins, as the tool's own settings name them (InstructionFile
//   ownHooks and extensions, read by pluginitems.ts sessionSettings).
// Which events can add text, when each runs and each tool's own note are pluginoutcomes.ts's (canAddText, whenItRuns,
// sessionTextNote). A hook's text is known only when it runs, so a line says when it runs, never what it adds.
import { canAddText, sessionTextNote, whenItRuns } from './pluginoutcomes.ts';
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

/** One line of the strip: whose it is (`name`, written beside its `mark`), what it says of it, and where it is turned off. */
export interface SessionLine {
  name: string;
  mark: string;
  /** When its hook runs and that what it adds is known only then; or why its hooks aren't known; or that only the running tool knows an extension's text. */
  says: string;
  /** A hook's launch, in one line (hookLine). */
  command?: string;
  /** The plugin it comes with, whose page holds its switch when its marketplace is listed (InstalledPlugin listed). */
  plugin?: InstalledPlugin;
  /** The person's own settings file that declares the hook. */
  settings?: string;
}

/**
 * The strip on a tool's card: the person's own hooks that can add text, then each plugin installed whole in the tool and On
 * there, by name (a line per such hook that starts a program, or one saying its installed copy couldn't be read), then Pi's or
 * OpenCode's extensions; and the tool's note, once. Undefined with nothing to show.
 */
export function sessionLines(tool: HarnessId, items: InstalledPlugin[], file: Pick<InstructionFile, 'ownHooks' | 'extensions'>): { lines: SessionLine[]; note?: string } | undefined {
  const adding = (hooks: DeclaredHook[] = []) => hooks.filter(hook => canAddText(hook.event) && hook.launch);
  const runs = (hook: DeclaredHook, after = '') => ({ says: `Runs ${whenItRuns(hook.event)}. What it adds is known only when it runs.${after}`, command: hookLine(hook) });
  const plugins = items.filter(install => install.tool === tool && !install.off)
    .sort((first, second) => first.plugin.localeCompare(second.plugin) || first.marketName.localeCompare(second.marketName));
  // One plugin name in two marketplaces is told apart by its marketplace.
  const named = (install: InstalledPlugin) => (plugins.some(other => other !== install && other.plugin === install.plugin) ? `${install.plugin} (${install.marketName})` : install.plugin);
  const offHere = (install: InstalledPlugin) => (install.listed ? '' : ` ${toolNames[tool]}’s own plugin commands turn it off.`);
  const lines: SessionLine[] = [
    ...adding(file.ownHooks).map(hook => ({ name: 'yours', mark: YOURS, ...runs(hook), settings: hook.declaredIn })),
    ...plugins.flatMap(install => {
      const origin = { name: named(install), mark: originMark(`${install.plugin}@${install.marketName}`), plugin: install };
      if (install.problem) return [{ ...origin, says: `${install.problem} What its hooks add isn’t known.${offHere(install)}` }];
      return adding(install.hooks).map(hook => ({ ...origin, ...runs(hook, offHere(install)) }));
    }),
    ...(file.extensions ?? []).map(name => ({ name, mark: originMark(name), says: 'An extension’s text is known only to the running tool.' })),
  ];
  const note = sessionTextNote(tool);
  return lines.length ? { lines, ...(note ? { note } : {}) } : undefined;
}
