// Reading one hook's source on click (IPC hook:source): re-finds the hook from disk by its owner (own tool settings, an
// installed plugin copy, or a marketplace copy without fetching), cuts its entry verbatim from JSON/JSONC or TOML (omitted for
// inline plugin manifest hooks), and resolves and reads the script named by its command. Read-only: runs nothing, writes
// nothing, and never trusts a path sent from the page to read outside the owner's own files.
import { open, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inside, installedContents, pluginContents } from './catalogdetail.ts';
import { harnessIds, toolConfigRoot } from './harnesses.ts';
import { shownFromHome } from './machine.ts';
import { sessionSettings } from './pluginitems.ts';
import { cachedCatalog, installedPlugins, parseCatalog, remoteCopyFolder, type PluginContext } from './plugins.ts';
import { takesPlugins } from './presence.ts';
import { hookLine } from './sessionhooks.ts';
import { jsonElements, members, ownEnd, readTomlTables, skipSpace } from './textedit.ts';
import type { DeclaredHook, HarnessId, HomeMode, HookSource, HookSourceRef } from './types.ts';
import { isFolder, record } from './values.ts';
import { fileName } from './words.ts';

export interface HookSourceContext { home: string; mode: HomeMode; overrides?: Partial<Record<HarnessId, string>>; dataDir: string }

const SCRIPT_LIMIT = 256 * 1024;
const UNREADABLE = 'This file couldn’t be read.';
const NO_SCRIPT = 'No script file found in the command.';
const NOT_TEXT = 'Not a text file.';
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'node', 'python', 'python3', 'ruby', 'cat']);
const NO_FILE_OPTIONS = new Set(['-c', '-e', '-m']);
const PLUGIN_VAR = /^\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}[\\/]/;

/** Validates an untrusted hook identity received over IPC. */
export function parseHookRef(value: unknown): HookSourceRef | undefined {
  const ref = record(value);
  if (!ref || typeof ref.declaredIn !== 'string' || typeof ref.event !== 'string' || typeof ref.command !== 'string') return undefined;
  if (typeof ref.at !== 'number' || !Number.isInteger(ref.at) || ref.at < 0) return undefined;
  const base = { declaredIn: ref.declaredIn, event: ref.event, at: ref.at, command: ref.command };
  const tool = harnessIds.includes(ref.tool as HarnessId) ? (ref.tool as HarnessId) : undefined;
  const nonEmpty = (text: unknown): text is string => typeof text === 'string' && text.length > 0;
  if (ref.from === 'own' && tool) return { ...base, from: 'own', tool };
  if (ref.from === 'installed' && tool && nonEmpty(ref.plugin) && nonEmpty(ref.marketName)) return { ...base, from: 'installed', tool, plugin: ref.plugin, marketName: ref.marketName };
  if (ref.from === 'marketplace' && nonEmpty(ref.source) && nonEmpty(ref.plugin)) return { ...base, from: 'marketplace', source: ref.source, plugin: ref.plugin };
  return undefined;
}

/** Splits a shell command line into words while honouring single quotes, double quotes and backslash escapes. */
function splitShell(command: string): string[] {
  return [...command.matchAll(/(?:'[^']*'|"[^"\\]*(?:\\.[^"\\]*)*"|\\.|[^\s'"\\])+/g)].map(match =>
    match[0].replace(/'([^']*)'|"((?:\\.|[^"\\])*)"|\\(.)/g, (_all, single, dbl, esc) =>
      single ?? esc ?? dbl.replace(/\\(["\\$`])/g, '$1')));
}

/** Resolves a word naming an absolute, ~/… (against `home`), or plugin-root path; undefined otherwise. */
function resolveScriptPath(word: string, home: string, pluginRoot?: string): string | undefined {
  if (!word || word.includes('\0')) return undefined;
  if (word.startsWith('~/') || word.startsWith('~\\')) return join(home, word.slice(2));
  const match = pluginRoot ? PLUGIN_VAR.exec(word) : null;
  if (match) return resolve(pluginRoot!, word.slice(match[0].length));
  return isAbsolute(word) ? word : undefined;
}

/** Finds the script path named by a hook's launch by rule (never by guess); undefined when none is found. */
export function scriptInLaunch(launch: DeclaredHook['launch'], home: string, pluginRoot?: string): string | undefined {
  if (!launch) return undefined;
  const words = 'shell' in launch ? splitShell(launch.shell) : [launch.program, ...launch.args];
  let at = 0;
  if (words[0] && fileName(words[0]) === 'env') {
    at = 1;
    while (at < words.length && (words[at]!.startsWith('-') || /^[A-Za-z_]\w*=/.test(words[at]!))) at++;
  }
  const first = words[at];
  if (!first) return undefined;
  if (!INTERPRETERS.has(fileName(first))) return resolveScriptPath(first, home, pluginRoot);
  for (at++; at < words.length; at++) {
    const arg = words[at]!;
    if (arg === '--') return words[at + 1] ? resolveScriptPath(words[at + 1]!, home, pluginRoot) : undefined;
    if (NO_FILE_OPTIONS.has(arg)) return undefined;
    if (arg.startsWith('-') && arg.length > 1) continue;
    return resolveScriptPath(arg, home, pluginRoot);
  }
  return undefined;
}

/** Reads a regular text file up to SCRIPT_LIMIT bytes; refuses non-regular files (folders, FIFOs) and NUL-byte binaries. */
async function readScript(path: string): Promise<NonNullable<HookSource['script']>> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return { path, problem: UNREADABLE };
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(Math.min(info.size, SCRIPT_LIMIT) + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, Math.min(bytesRead, SCRIPT_LIMIT));
    if (slice.includes(0)) return { path, problem: NOT_TEXT };
    const text = slice.toString('utf8');
    return { path, text: bytesRead <= SCRIPT_LIMIT ? text : `${text}\n\n[Central Knot shows the first ${SCRIPT_LIMIT / 1024} KB of this file.]` };
  } catch {
    return { path, problem: UNREADABLE };
  } finally {
    await handle?.close();
  }
}

/** Shifts a multi-line JSON slice left by the indent on its opening line when every following non-empty line shares it. */
function dedent(raw: string, span: { start: number; end: number }): string {
  const slice = raw.slice(span.start, span.end);
  const indent = raw.slice(raw.lastIndexOf('\n', span.start - 1) + 1, span.start);
  if (!/^[ \t]+$/.test(indent) || !slice.includes('\n')) return slice;
  const [first, ...rest] = slice.split('\n');
  if (!rest.every(line => !line.trim() || line.startsWith(indent))) return slice;
  return [first, ...rest.map(line => (line.startsWith(indent) ? line.slice(indent.length) : line))].join('\n');
}

/** Cuts the `at`-th hook object (groups flattened, matching catalogdetail.ts readHooks) verbatim from a JSON/JSONC file. */
function jsonHookEntry(raw: string, event: string, at: number, allowTopLevel: boolean): string | undefined {
  try {
    const root = skipSpace(raw, raw.charCodeAt(0) === 0xfeff ? 1 : 0);
    if (raw[root] !== '{') return undefined;
    const hooksKey = members(raw, root).members.findLast(member => member.key === 'hooks');
    const section = hooksKey && raw[hooksKey.value.start] === '{' ? hooksKey.value.start : allowTopLevel ? root : -1;
    if (section < 0) return undefined;
    const eventList = members(raw, section).members.findLast(member => member.key === event);
    if (!eventList || raw[eventList.value.start] !== '[') return undefined;
    const spans = jsonElements(raw, eventList.value.start).flatMap(item => {
      const inner = raw[item.start] === '{' ? members(raw, item.start).members.findLast(member => member.key === 'hooks') : undefined;
      return inner && raw[inner.value.start] === '[' ? jsonElements(raw, inner.value.start) : [item];
    });
    return spans[at] ? dedent(raw, spans[at]) : undefined;
  } catch {
    return undefined;
  }
}

/** Cuts the `at`-th Codex hook for `event` from config.toml: a `[[hooks.<event>.hooks]]` table or an inline `hooks = [...]` line. */
function tomlHookEntry(raw: string, event: string, at: number): string | undefined {
  try {
    const entries: string[] = [];
    let hasGroup = false;
    for (const table of readTomlTables(raw)) {
      const [top, name, inner, ...more] = table.path;
      if (top !== 'hooks' || name !== event || !table.array || more.length) continue;
      if (inner === undefined) {
        hasGroup = true;
        const inline = table.entries.findLast(entry => entry.keys.join('.') === 'hooks');
        if (inline && Array.isArray(inline.value)) entries.push(...inline.value.map(() => inline.raw.trimEnd()));
      } else if (inner === 'hooks' && hasGroup) {
        entries.push(raw.slice(table.start, ownEnd(raw, table)).trimEnd());
      }
    }
    return entries[at];
  } catch {
    return undefined;
  }
}

const withinFolder = (folder: string, target: string) => {
  const way = relative(folder, target);
  return way === '' || (!isAbsolute(way) && way !== '..' && !way.startsWith(`..${sep}`));
};

/** Re-reads the owner's hooks from disk (no network) and returns the folder bounding its declaring files. */
async function findOwner(ctx: HookSourceContext, ref: HookSourceRef): Promise<{ hooks: DeclaredHook[]; unread: string[]; pluginRoot?: string; within: string } | undefined> {
  const pluginCtx: PluginContext = { home: ctx.home, dataDir: ctx.dataDir, binaries: {}, overrides: ctx.overrides };
  if (ref.from === 'own') {
    const root = toolConfigRoot(ctx, ref.tool);
    const { ownHooks = [], ownHooksUnread = [] } = await sessionSettings(ref.tool, root);
    return { hooks: ownHooks, unread: ownHooksUnread, within: root };
  }
  if (ref.from === 'installed') {
    if (!takesPlugins(ref.tool)) return undefined;
    const install = (await installedPlugins(pluginCtx, ref.tool).catch(() => [])).find(candidate => candidate.plugin === ref.plugin && candidate.marketplace === ref.marketName);
    if (!install || install.state.state !== 'installed') return undefined;
    const folder = install.state.path;
    const { hooks, hooksUnread = [] } = await installedContents(ref.tool, folder, install.entry, install.atMarketplaceRoot);
    return { hooks, unread: hooksUnread, pluginRoot: folder, within: folder };
  }
  const catalog = isFolder(ref.source) ? await parseCatalog(ref.source, ref.source, 'folder', { counts: false }) : await cachedCatalog(pluginCtx, ref.source);
  const item = catalog?.root ? catalog.plugins.find(entry => entry.name === ref.plugin) : undefined;
  if (!catalog?.root || !item) return undefined;
  const remoteRoot = !item.folder && item.remote ? remoteCopyFolder(pluginCtx, item.remote) : undefined;
  const root = remoteRoot ?? catalog.root;
  const folder = item.folder ?? (remoteRoot ? resolve(remoteRoot, item.remote!.path || '.') : undefined);
  if (!folder || (remoteRoot && !(await inside(root, folder)))) return undefined;
  const { source: _where, ...remoteEntry } = item.entry ?? {};
  const { hooks, hooksUnread = [] } = await pluginContents(folder, remoteRoot ? remoteEntry : item.entry ?? {}, root, { atMarketplaceRoot: !!item.folder && !!item.isMarketplaceRoot });
  return { hooks, unread: hooksUnread, pluginRoot: folder, within: root };
}

/** Reads one hook's declaring entry and script text from disk on demand. */
export async function readHookSource(ctx: HookSourceContext, ref: HookSourceRef): Promise<HookSource> {
  const owner = await findOwner(ctx, ref);
  if (!owner) return { problem: UNREADABLE };
  if (owner.unread.includes(ref.declaredIn)) return { file: ref.declaredIn, problem: UNREADABLE };
  const match = owner.hooks.find(hook => hook.declaredIn === ref.declaredIn && hook.event === ref.event && hook.at === ref.at && hookLine(hook) === ref.command);
  if (!match) return withinFolder(owner.within, ref.declaredIn) ? { problem: `This hook is no longer in ${shownFromHome(ref.declaredIn, ctx)}.` } : { problem: UNREADABLE };
  const scriptPath = scriptInLaunch(match.launch, ctx.home, owner.pluginRoot);
  const script = scriptPath ? await readScript(scriptPath) : { problem: NO_SCRIPT };
  if (match.declaredIn === owner.pluginRoot) return { script };
  const raw = await readFile(match.declaredIn, 'utf8').catch(() => undefined);
  if (raw === undefined) return { file: match.declaredIn, problem: UNREADABLE };
  const entry = match.declaredIn.endsWith('.toml') ? tomlHookEntry(raw, match.event, match.at) : jsonHookEntry(raw, match.event, match.at, !!owner.pluginRoot);
  return entry === undefined ? { file: match.declaredIn, problem: UNREADABLE } : { file: match.declaredIn, entry, script };
}
