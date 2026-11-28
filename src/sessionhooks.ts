// A hook as the pages show it (hookLine, hookFingerprint, textHookRows, on a plugin's page and the Instructions page alike), the strip on
// each tool's card on the Instructions page ("Hooks that can add text", Pi's packages, OpenCode's plugins; its standing warning
// HOOK_RUN_WARN / hookRunWarn, info-card text hookStripHelp / hookStripCard, and refusal HOOK_RUN_ACTUAL_ONLY),
// and what a hook run's result says in words (hookRunWords), drawn by instructionspage.ts sessionStripView, pluginpage.ts sessionHookStrip and hooksourceview.ts. Pure: nothing here reads a file or runs a hook. Its facts:
// - each plugin installed whole in the tool and On there, with its hooks as its installed copy declares them (HomeView
//   pluginItems, read by pluginitems.ts readPluginItems);
// - the person's own hooks, and Pi's packages and OpenCode's plugins, as the tool's own settings name them (InstructionFile
//   ownHooks and extensions, read by pluginitems.ts sessionSettings).
// What it lists: hooks that start a program when a session starts or with a prompt, by each tool's rule (pluginoutcomes.ts
// addsText, whenItRuns, and the tool's card note, sessionTextCardNote). A hook's text is known only when it runs, so the strip says
// when it runs, never what it adds. Not listed: other kinds of hook (one that calls a URL or an MCP tool, or asks a model), a
// project's or an organisation's hooks, a skill's or an agent's own hooks, and `additionalContext` printed by other events.
import { clockTime } from './model.ts';
import { addsText, hookEventLabel, ignoresText, sessionTextCardNote } from './pluginoutcomes.ts';
import { commandLine, toolNames } from './words.ts';
import type { DeclaredHook, HarnessId, HookRunResult, HookSourceOwner, HookSourceRef, InstalledPlugin, InstructionFile } from './types.ts';

/** How a hook starts, in one line: its shell command as written, or its program with its arguments; '' for one that starts nothing here. */
export const hookLine = (hook: DeclaredHook) => (!hook.launch ? '' : 'shell' in hook.launch ? hook.launch.shell : commandLine(hook.launch.program, hook.launch.args));

/** Canonical fingerprint of every field of a hook's declaration that decides how it runs (checked by hooksource.ts findHook and keyed on the page). */
export function hookFingerprint(hook: DeclaredHook): string {
  const env = hook.env ? Object.entries(hook.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : null;
  return JSON.stringify([hook.event, hook.matcher ?? null, hook.type ?? null, hook.shell ?? null, hook.launch ?? null, hook.cwd ?? null, env, hook.timeout ?? null]);
}

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

/** One text-adding hook row as Instructions and a plugin's own page draw it: when it runs, its command, and its HookSourceRef. */
export interface TextHookRow { when: string; command: string; source: HookSourceRef; tag?: string }

/** Hooks of `hooks` that can add text in `tool`, mapped to their rows and HookSourceRefs for `owner`. */
export function textHookRows(tool: HarnessId, hooks: DeclaredHook[] | undefined, owner: HookSourceOwner): TextHookRow[] {
  return (hooks ?? []).filter(hook => addsText(tool, hook)).map(hook => {
    const command = hookLine(hook);
    return { when: hookEventLabel(hook, tool), command, source: { ...owner, declaredIn: hook.declaredIn, event: hook.event, at: hook.at, command, fingerprint: hookFingerprint(hook) } };
  });
}

/** One origin on the strip: whose it is (`name`, beside its `mark`), where it is turned off, and its hooks beneath. */
export interface SessionGroup {
  name: string;
  mark: string;
  /** The plugin it comes with, whose page holds its switch when its marketplace is listed (InstalledPlugin listed). */
  plugin?: InstalledPlugin;
  /** The person's own settings file that declares its hooks. */
  settings?: string;
  /** Why its hooks aren't known: its installed copy couldn't be read. */
  problem?: string;
  /** Each of its hooks files that couldn't be read: what those declare isn't known. */
  unread: string[];
  /** Each hook that can add text: when it runs, its command (hookLine), and what identifies it for View source. */
  hooks: TextHookRow[];
}
export interface SessionStrip { heading: string; note?: string; groups: SessionGroup[] }

/** Each tool's own word for what it loads into every session from its settings: Pi's packages, OpenCode's plugins. */
const EXTENSIONS: Partial<Record<HarnessId, string>> = { 'pi-cli': 'packages', 'opencode-cli': 'plugins' };

/**
 * The strip on a tool's card: its heading, the tool's note, then the person's own hooks that can add text (a group per
 * settings file), each plugin installed whole in the tool and On there, by name (its hooks, or why they aren't known), and
 * Pi's or OpenCode's extensions. Undefined with nothing to show; a tool whose note says why its hooks have no rows (Copilot
 * CLI's prompt hooks) shows the note alone.
 */
export function sessionStrip(tool: HarnessId, items: InstalledPlugin[], file: Pick<InstructionFile, 'ownHooks' | 'ownHooksUnread' | 'extensions'>): SessionStrip | undefined {
  const plugins = items.filter(install => install.tool === tool && !install.off)
    .sort((first, second) => first.plugin.localeCompare(second.plugin) || first.marketName.localeCompare(second.marketName));
  // One plugin name in two marketplaces is told apart by its marketplace.
  const named = (install: InstalledPlugin) => (plugins.some(other => other !== install && other.plugin === install.plugin) ? `${install.plugin} (${install.marketName})` : install.plugin);
  const own = file.ownHooks ?? [], unread = file.ownHooksUnread ?? [];
  const groups: SessionGroup[] = [
    ...[...new Set([...own.filter(hook => addsText(tool, hook)).map(hook => hook.declaredIn), ...unread])].map(settings =>
      ({ name: 'yours', mark: YOURS, settings, unread: unread.filter(path => path === settings), hooks: textHookRows(tool, own.filter(hook => hook.declaredIn === settings), { from: 'own', tool }) })),
    ...plugins.map((install): SessionGroup => ({ name: named(install), mark: originMark(`${install.plugin}@${install.marketName}`), plugin: install,
      ...(install.problem ? { problem: `${install.problem} What its hooks add isn’t known.` } : {}), unread: install.hooksUnread ?? [],
      hooks: textHookRows(tool, install.hooks, { from: 'installed', tool, plugin: install.plugin, marketName: install.marketName }) }))
      .filter(group => group.problem || group.unread.length || group.hooks.length),
    ...(file.extensions ?? []).map(name => ({ name, mark: originMark(name), unread: [], hooks: [] })),
  ];
  const note = sessionTextCardNote(tool, groups.length > 0), word = EXTENSIONS[tool];
  if (!groups.length && ![...own, ...plugins.flatMap(install => install.hooks ?? [])].some(hook => ignoresText(tool, hook))) return undefined;
  return word
    ? { heading: `${word[0]!.toUpperCase()}${word.slice(1)} that can add text`, groups }
    : { heading: 'Hooks that can add text', groups, ...(note ? { note } : {}) };
}

/** One source for main's hookrun.ts refusal and hooksourceview.ts stripCantRunReason outside this computer's home. */
export const HOOK_RUN_ACTUAL_ONLY = 'See what it adds works only on this computer’s home.';

/** Standing line above the first row of every strip that has a runnable hook. */
export const HOOK_RUN_WARN = '“See what it adds” runs the hook’s command on this computer to collect what it prints. Nothing is added to any session, but the command may change your files.';
/** Standing line for a runnable strip: Codex also says it runs regardless of trust in Codex's /hooks command. */
export const hookRunWarn = (tool: HarnessId): string =>
  tool === 'codex-cli' ? '“See what it adds” runs the hook’s command on this computer to collect what it prints, whether or not you have trusted it in Codex’s /hooks command. Nothing is added to any session, but the command may change your files.' : HOOK_RUN_WARN;

/** Whole-sentence parts for the first hooks strip's (?) card (at most 2 sentences, ≤30 words). */
const hookStripHelpParts = (tool: HarnessId, runnable: boolean): string[] => [
  `This lists ${tool === 'copilot-cli' ? 'session-start' : 'session-start and prompt'} hooks, not URL, MCP, project or organisation.`,
  ...(runnable ? ['“See what it adds” uses your home or the hook’s folder, and plugin hooks can change installed files.'] : []),
];

/** Information-mark card text on the first hooks strip of a page (≤2 sentences, ≤30 words). */
export const hookStripHelp = (tool: HarnessId, runnable: boolean): string => hookStripHelpParts(tool, runnable).join(' ');

/** Standing text for one hooks strip's (?) card: at most two whole sentences, in order (why not runnable, tool note, then first-strip help if room). */
export function hookStripCard(tool: HarnessId, strip: Pick<SessionStrip, 'note'>,
  info: { first: boolean; anyRunnable: boolean; cantRun?: string }): string | undefined {
  const parts = [info.cantRun, strip.note, ...(info.first ? hookStripHelpParts(tool, info.anyRunnable) : [])]
    .filter((part): part is string => !!part).slice(0, 2);
  return parts.length ? parts.join(' ') : undefined;
}

const KEEP_CAP = /^(?:Central Knot|Claude Code|Codex|Copilot CLI|See what it adds|Windows)\b|^\S+ is turned off in /;
const lowerLead = (text: string) => (KEEP_CAP.test(text) ? text : text.replace(/^[A-Z](?=[a-z])/, ch => ch.toLowerCase()));

/** What a hook run's result block shows (sentence, quiet trailing run place/time, notes, and output slots), pure. */
export interface HookRunView {
  sentence: string;
  meta?: string;
  notes: string[];
  added?: string;
  allFold?: string;
  errFold?: string;
  errDirect?: string;
}

/** Maps one HookRunResult to its exact sentence, quiet trailing run tool/plugin-version/place/time (only when known), notes, and stdout/stderr display slots. */
export function hookRunWords(tool: HarnessId, result: HookRunResult, shownCwd: string, time = clockTime(result.at), runAs?: HarnessId): HookRunView {
  if (result.outcome === 'refused') return { sentence: result.problem ? `Not run: ${lowerLead(result.problem)}` : 'Couldn’t run it.', notes: [] };
  const place = shownCwd || '~';
  const promptPart = result.emptyPrompt ? ' with an empty prompt' : '';
  const started = result.outcome !== 'missing' && result.detail !== 'spawn-error';
  const version = result.pluginVersion?.trim();
  const who = runAs ? `as ${toolNames[runAs]}${version ? `, plugin ${version}` : ''}, ` : '';
  const meta = `${who}${started ? `run in ${place}${promptPart}, ${time}` : `tried at ${time}`}`;
  const baseNotes = started && result.missingOptions ? ['Ran without some of the plugin’s options.'] : [];
  const err = result.stderr || undefined;
  const out = result.allPrinted || undefined;
  const view = (sentence: string, more: Partial<HookRunView> = {}): HookRunView => ({ sentence, meta, ...more, notes: [...(more.notes ?? []), ...baseNotes] });
  if (result.outcome === 'adds') {
    const notes: string[] = [];
    if (tool === 'codex-cli') notes.push('Codex adds it only once trusted in /hooks.');
    if (result.overLimit) {
      const unit = result.overLimit.unit === 'chars' ? 'characters' : 'tokens';
      const limit = result.overLimit.limit.toLocaleString('en-US');
      notes.push(`Longer than ${toolNames[tool]}’s limit of ${limit} ${unit}: it would add only part.`);
    }
    const added = result.added ?? '';
    const allFold = out && out.trim() !== added.trim() ? out : undefined;
    return view('Would add', { notes, added, allFold, errFold: err });
  }
  if (result.outcome === 'empty') {
    const why = result.allPrinted.length ? 'it printed only blank lines.' : 'it printed nothing.';
    return view(`Would add nothing: ${why}`, { errDirect: err });
  }
  if (result.outcome === 'copilot-ignored') return view('Copilot CLI would ignore this: no top-level additionalContext.', { allFold: out, errDirect: err });
  if (result.outcome === 'claude-exit-2') {
    const hasErr = !!err?.trim();
    const what = result.emptyPrompt
      ? (hasErr ? 'Claude Code would block the prompt and show this error.' : 'Claude Code would block the prompt.')
      : (hasErr ? 'Claude Code would show you this error and add nothing.' : 'Claude Code would add nothing.');
    return view(`Exited 2: ${what}`, { errDirect: hasErr ? err : undefined });
  }
  if (result.outcome === 'failed' || result.detail === 'codex-prompt-exit-2') {
    const lead = result.signal ? `Ended by ${result.signal}: it` : result.exitCode !== undefined ? `Exited ${result.exitCode}: it` : 'It';
    return view(`${lead} would add nothing.`, { allFold: out, errDirect: err });
  }
  if (result.outcome === 'timeout') {
    const after = result.limitSec !== undefined ? `after ${result.limitSec} s, its time limit` : 'at its time limit';
    return view(`Stopped ${after}: it would add nothing.`, { errDirect: err });
  }
  if (result.outcome === 'stopped') return view('Stopped. What it changed stays; a program it started may still be running.');
  if (result.outcome === 'missing') return view(result.program ? `Couldn’t start: ${result.program} not found.` : 'Couldn’t start.');
  if (result.detail === 'spawn-error') return view(result.problem ? `Couldn’t start: ${result.problem}` : 'Couldn’t start.', { errDirect: err });
  const detailLine = result.detail === 'json-no-context' ? 'Would add nothing: its JSON has no additionalContext.'
    : result.detail === 'json-block' ? 'Would add nothing: its JSON says to block or stop.'
    : result.detail === 'invalid-json' ? `Would add nothing: ${toolNames[tool]} can’t read its JSON.`
    : result.detail === 'overflow' ? 'Stopped: it printed more than Central Knot reads.'
    : 'Would add nothing.';
  return view(detailLine, { allFold: out, errDirect: err });
}
