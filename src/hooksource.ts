// Shared hook identity lookup (parseHookRef, findHook — called by both readHookSource here and hookrun.ts runHook) and reading
// one hook's source on click (IPC hook:source): finds the hook again through the same readers the page was drawn with
// (own tool settings, an installed plugin copy, or a marketplace copy resolved by marketplace name through marketplaces.ts,
// without fetching), never reads a path or folder sent from the page, and shows only the hook's own entry (from JSON/JSONC,
// the file's own bytes with common leading indentation removed; from TOML, its own bytes with trailing whitespace trimmed;
// omitted for inline plugin manifest hooks) and the script its command names (by rule). Read-only: runs and writes nothing.
import { isAbsolute, join, resolve } from 'node:path';
import { READ_LIMIT, installedContents, pathIn, pluginContents, readCapped } from './catalogdetail.ts';
import { harnessIds, toolConfigRoot } from './harnesses.ts';
import { shownFromHome } from './machine.ts';
import { sessionSettings } from './pluginitems.ts';
import { installedPlugins, type PluginContext } from './plugins.ts';
import { takesPlugins } from './presence.ts';
import { hookFingerprint, hookLine } from './sessionhooks.ts';
import { jsonElements, members, ownEnd, readTomlTables, skipSpace } from './textedit.ts';
import type { DeclaredHook, HarnessId, HomeMode, HookSource, HookSourceRef } from './types.ts';
import { record, text as asText } from './values.ts';
import { HOOK_SOURCE_UNREADABLE, fileName } from './words.ts';

export interface HookSourceContext {
  home: string; mode: HomeMode; overrides?: Partial<Record<HarnessId, string>>; dataDir: string;
  marketplace?: (marketName: string, plugin: string) => Promise<{ folder: string; root: string; entry: Record<string, unknown>; atMarketplaceRoot: boolean } | undefined>;
}

const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'node', 'python', 'python3', 'ruby', 'cat']);
const SHELL_TOKEN = /([|&;<>])|(?:'[^']*(?:'|$)|"(?:\\.|[^"\\])*(?:"|$)|\\.|[^\s'"\\|&;<>])+/g;
const ENV_ASSIGN = /^[A-Za-z_]\w*=/;
const HOME_VAR = /^\$(?:HOME|\{HOME\})[\\/]/;
const PLUGIN_VAR = /^\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}[\\/]/;
type ShellWord = { text: string; head: 'raw' | 'dbl' | 'arg' | 'lit'; raw: string };

/** Validates an untrusted hook identity received over IPC. */
export function parseHookRef(value: unknown): HookSourceRef | undefined {
  const ref = record(value);
  if (!ref || typeof ref.declaredIn !== 'string' || typeof ref.event !== 'string' || typeof ref.command !== 'string' || typeof ref.fingerprint !== 'string' || !ref.fingerprint) return undefined;
  if (typeof ref.at !== 'number' || !Number.isInteger(ref.at) || ref.at < 0) return undefined;
  const base = { declaredIn: ref.declaredIn, event: ref.event, at: ref.at, command: ref.command, fingerprint: ref.fingerprint };
  const tool = harnessIds.includes(ref.tool as HarnessId) ? (ref.tool as HarnessId) : undefined;
  if (ref.from === 'own' && tool) return { ...base, from: 'own', tool };
  if (ref.from === 'installed' && tool && asText(ref.plugin) && asText(ref.marketName)) return { ...base, from: 'installed', tool, plugin: asText(ref.plugin), marketName: asText(ref.marketName) };
  if (ref.from === 'marketplace' && asText(ref.marketName) && asText(ref.plugin)) return { ...base, from: 'marketplace', marketName: asText(ref.marketName), plugin: asText(ref.plugin) };
  return undefined;
}

/** Splits the first simple shell command (stopping at the first operator outside quotes), tracking how each word starts. */
function firstCommandWords(command: string): ShellWord[] {
  const words: ShellWord[] = [];
  for (const [raw, op] of command.matchAll(SHELL_TOKEN)) {
    if (op) break;
    const head: ShellWord['head'] = raw.startsWith('~/') || raw.startsWith('~\\') ? 'raw' : raw.startsWith('$') || raw.startsWith('"$') ? 'dbl' : 'lit';
    const text = raw.replace(/'([^']*)'?|"((?:\\.|[^"\\])*)"?|\\(.)/g, (_all, single, dbl, esc) =>
      single ?? esc ?? dbl.replace(/\\(["\\$`])/g, '$1'));
    words.push({ text, head, raw });
  }
  return words;
}

/** Resolves a word naming an absolute, unquoted ~/…, non-single-quoted $HOME/${HOME}/… or plugin-root path (direct args expand plugin-root only). */
function resolveScriptPath({ text, head }: ShellWord, home: string, pluginRoot?: string): string | undefined {
  if (!text || text.includes('\0')) return undefined;
  if (head === 'raw' && (text.startsWith('~/') || text.startsWith('~\\'))) return join(home, text.slice(2));
  if (head === 'dbl' && HOME_VAR.test(text)) return join(home, text.replace(HOME_VAR, ''));
  if ((head === 'dbl' || head === 'arg') && pluginRoot && PLUGIN_VAR.test(text)) return resolve(pluginRoot, text.replace(PLUGIN_VAR, ''));
  return isAbsolute(text) ? text : undefined;
}

/** Finds the script path named by a hook's launch by rule (never by guess); undefined when none is found. */
export function scriptInLaunch(launch: DeclaredHook['launch'], home: string, pluginRoot?: string): string | undefined {
  if (!launch) return undefined;
  const words: ShellWord[] = 'shell' in launch ? firstCommandWords(launch.shell) : [launch.program, ...launch.args].map(text => ({ text, head: 'arg', raw: text }));
  let at = 0;
  if ('shell' in launch) while (at < words.length && ENV_ASSIGN.test(words[at]!.raw)) at++;
  if (words[at] && fileName(words[at]!.text) === 'env') {
    const next = words[at + 1];
    if (!next || next.text.startsWith('-')) return undefined;
    at++;
    while (at < words.length && ENV_ASSIGN.test(words[at]!.text)) at++;
  }
  const first = words[at];
  if (!first) return undefined;
  if (!INTERPRETERS.has(fileName(first.text))) return resolveScriptPath(first, home, pluginRoot);
  const target = words[at + 1];
  return !target || target.text.startsWith('-') ? undefined : resolveScriptPath(target, home, pluginRoot);
}

/** Reads a regular text file up to READ_LIMIT bytes via catalogdetail.ts readCapped; refuses non-regular files and NUL-byte binaries. */
async function readScript(path: string): Promise<NonNullable<HookSource['script']>> {
  const read = await readCapped(path);
  if (!read) return { path, problem: HOOK_SOURCE_UNREADABLE };
  if (read.bytes.includes(0)) return { path, problem: 'Not a text file.' };
  const text = read.bytes.toString('utf8');
  return { path, text: read.whole ? text : `${text}\n\n[Central Knot shows the first ${READ_LIMIT / 1024} KB of this file.]` };
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

/** Cuts the `at`-th hook object (groups flattened, matching catalogdetail.ts readHooks) from a JSON/JSONC file and moves it left. */
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
  } catch { return undefined; }
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
  } catch { return undefined; }
}

/** Result of re-finding one hook on disk through its owner's readers (shared by readHookSource and hookrun.ts runHook). */
export type FoundHook = { hook: DeclaredHook; pluginRoot?: string; hooksDisabled?: string; pluginOff?: boolean } | { file?: string; problem: string };

/** Re-reads the owner's hooks through the same readers the page uses (no network) and returns the folder bounding its declaring files. */
async function findOwner(ctx: HookSourceContext, ref: HookSourceRef): Promise<{ hooks: DeclaredHook[]; unread: string[]; pluginRoot?: string; within: string; hooksDisabled?: string; pluginOff?: boolean } | undefined> {
  if (ref.from === 'own') {
    const root = toolConfigRoot(ctx, ref.tool);
    const { ownHooks = [], ownHooksUnread = [], ownHooksDisabled } = await sessionSettings(ref.tool, root);
    return { hooks: ownHooks, unread: ownHooksUnread, within: root, ...(ownHooksDisabled ? { hooksDisabled: ownHooksDisabled } : {}) };
  }
  if (ref.from === 'installed') {
    if (!takesPlugins(ref.tool)) return undefined;
    const pluginCtx: PluginContext = { home: ctx.home, dataDir: ctx.dataDir, binaries: {}, overrides: ctx.overrides };
    const install = (await installedPlugins(pluginCtx, ref.tool).catch(() => [])).find(candidate => candidate.plugin === ref.plugin && candidate.marketplace === ref.marketName);
    if (!install || install.state.state !== 'installed') return undefined;
    const [{ hooks, hooksUnread = [] }, { ownHooksDisabled }] = await Promise.all([
      installedContents(ref.tool, install.state.path, install.entry, install.atMarketplaceRoot),
      sessionSettings(ref.tool, toolConfigRoot(ctx, ref.tool)),
    ]);
    return {
      hooks, unread: hooksUnread, pluginRoot: install.state.path, within: install.state.path,
      ...(ownHooksDisabled ? { hooksDisabled: ownHooksDisabled } : {}),
      ...(install.off ? { pluginOff: true } : {}),
    };
  }
  const copy = await ctx.marketplace?.(ref.marketName, ref.plugin);
  if (!copy) return undefined;
  const { hooks, hooksUnread = [] } = await pluginContents(copy.folder, copy.entry, copy.root, { atMarketplaceRoot: copy.atMarketplaceRoot });
  return { hooks, unread: hooksUnread, pluginRoot: copy.folder, within: copy.root };
}

/** Finds a hook's live declaration on disk through its owner's readers; refuses unknown owners, unreadable files and mismatched places/commands. */
export async function findHook(ctx: HookSourceContext, ref: HookSourceRef): Promise<FoundHook> {
  const owner = await findOwner(ctx, ref);
  if (!owner) return { problem: HOOK_SOURCE_UNREADABLE };
  if (owner.unread.includes(ref.declaredIn)) return { file: ref.declaredIn, problem: HOOK_SOURCE_UNREADABLE };
  const hook = owner.hooks.find(candidate => candidate.declaredIn === ref.declaredIn && candidate.event === ref.event && candidate.at === ref.at && hookLine(candidate) === ref.command && hookFingerprint(candidate) === ref.fingerprint);
  if (!hook) {
    if (!pathIn(owner.within, ref.declaredIn)) return { problem: HOOK_SOURCE_UNREADABLE };
    const shown = shownFromHome(ref.declaredIn, ctx);
    const moved = owner.hooks.some(candidate => candidate.declaredIn === ref.declaredIn && candidate.event === ref.event && hookLine(candidate) === ref.command);
    return { problem: moved ? `${shown} changed since this page was read. Refresh to see it.` : `This hook is no longer in ${shown}.` };
  }
  return {
    hook,
    ...(owner.pluginRoot ? { pluginRoot: owner.pluginRoot } : {}),
    ...(owner.hooksDisabled ? { hooksDisabled: owner.hooksDisabled } : {}),
    ...(owner.pluginOff ? { pluginOff: true } : {}),
  };
}

/** Reads one hook's declaring entry and script text from disk on demand. */
export async function readHookSource(ctx: HookSourceContext, ref: HookSourceRef): Promise<HookSource> {
  const found = await findHook(ctx, ref);
  if ('problem' in found) return found;
  const { hook: match, pluginRoot } = found;
  const scriptPath = scriptInLaunch(match.launch, ctx.home, pluginRoot);
  const script = scriptPath ? await readScript(scriptPath) : undefined;
  if (match.declaredIn === pluginRoot) return script ? { script } : {};
  const file = await readCapped(match.declaredIn, 4 * 1024 * 1024);
  if (!file?.whole) return { file: match.declaredIn, problem: HOOK_SOURCE_UNREADABLE };
  const raw = file.bytes.toString('utf8');
  const entry = match.declaredIn.endsWith('.toml') ? tomlHookEntry(raw, match.event, match.at) : jsonHookEntry(raw, match.event, match.at, !!pluginRoot);
  return entry === undefined ? { file: match.declaredIn, problem: HOOK_SOURCE_UNREADABLE } : { file: match.declaredIn, entry, ...(script ? { script } : {}) };
}
