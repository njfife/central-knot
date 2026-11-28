// Runs one hook's command once on click (IPC hook:run / hook:stop) in main and classifies what the tool would add
// (whatHookWouldAdd, pure).
// Gate: re-finds the hook via hooksource.ts findHook; requires actual home, non-Windows, own hooks or installed Claude Code /
// Codex plugin hooks, installed tool binary, plugin on, tool hooks not disabled, command type, event adding text
// (pluginoutcomes.ts addsText), matching start source (pluginoutcomes.ts pickStartSource), and one run at a time per hook.
// Environment and launch: scrubs inherited control, session and plugin variables first, then sets tool and plugin variables
// (including plain declared Claude Code userConfig options from settings.json or manifest defaults) and creates Claude Code's
// plugin data folder on first use. Claude Code puts ${CLAUDE_PROJECT_DIR} (and for plugins, ${CLAUDE_PLUGIN_ROOT} and
// ${CLAUDE_PLUGIN_DATA}) into shell lines as text (for own hooks too) and into exec-form program and each argument separately;
// Codex puts its four plugin variables into the command before the shell. A Claude Code plugin command or argument holding
// ${user_config. is refused; Codex has no ${user_config.…} and leaves that as written. Runs through plugins.ts run (process
// group + launch.ts CLOSE_GRACE_MS drain), cleans up disposable Claude files, and stops active runs on Stop or Quit.
// Nothing here stores results or draws a page; source reading stays in hooksource.ts.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pluginManifest } from './catalogdetail.ts';
import { findBinary } from './discovery.ts';
import { harnesses, toolConfigRoot } from './harnesses.ts';
import { findHook, type HookSourceContext } from './hooksource.ts';
import { CLOSE_GRACE_MS } from './launch.ts';
import { addsText, pickStartSource } from './pluginoutcomes.ts';
import { run, type RunResult } from './plugins.ts';
import { readJsonc } from './textedit.ts';
import type { DeclaredHook, HarnessId, HookRunResult, HookSourceRef } from './types.ts';
import { record } from './values.ts';
import { HOOK_SOURCE_UNREADABLE, toolNames } from './words.ts';

/** Inputs needed to run one hook in main (plus optional test seams for platform, env, capture cap and drain wait). */
export interface HookRunContext extends HookSourceContext {
  toolsHome: string; searchPath: string | (() => Promise<string>);
  platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; stillOpen?: () => boolean; maxBytes?: number; drainMs?: number;
}
/** Raw process outcome fed to `whatHookWouldAdd`. */
export interface HookRunRaw {
  tool: HarnessId; event: string; code: RunResult['code']; reason?: RunResult['reason'];
  signal?: NodeJS.Signals; stdout: string; program?: string; spawnError?: string;
}

const MAX_TIMEOUT_SEC = 60;
const CLAUDE_CHAR_LIMIT = 10_000;
const CODEX_TOKEN_LIMIT = 2_500;
const SCRUB_PREFIXES = ['CK_', 'ELECTRON_', 'CLAUDE_PLUGIN_OPTION_'];
const SCRUB_EXACT = new Set([
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_ENV_FILE',
  'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'PLUGIN_ROOT', 'PLUGIN_DATA',
  'CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_BUN',
  'COPILOT_PLUGIN_ROOT', 'COPILOT_PLUGIN_DATA', 'COPILOT_SESSION_ID',
]);

/** Canonical key identifying one hook in one home for one-at-a-time gating and Stop. */
export const hookRunKey = (home: string, ref: HookSourceRef): string => JSON.stringify([
  home, ref.from, 'tool' in ref ? ref.tool : '', 'marketName' in ref ? ref.marketName : '', 'plugin' in ref ? ref.plugin : '',
  ref.declaredIn, ref.event, ref.at, ref.command, ref.fingerprint,
]);

/** Time limit enforced for one hook run, in seconds: positive configured timeout capped at 60 s, else tool default capped at 60 s. */
export function hookTimeoutSec(tool: HarnessId, isPrompt: boolean, configured?: number): number {
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) return Math.min(configured, MAX_TIMEOUT_SEC);
  return Math.min(tool === 'codex-cli' || (tool === 'claude-cli' && !isPrompt) ? 600 : 30, MAX_TIMEOUT_SEC);
}

interface PluginLaunch {
  id: string;
  root: string;
  data: string;
  vars: Record<string, string>;
}

const isPlainOption = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';

/** Computes a plugin's id, root, data folder and tool-supplied path variables for Claude Code or Codex. */
function pluginPaths(tool: 'claude-cli' | 'codex-cli', toolRoot: string, plugin: string, marketName: string, pluginRoot: string): PluginLaunch {
  const id = `${plugin}@${marketName}`;
  const root = resolve(pluginRoot);
  if (tool === 'claude-cli') {
    const safeId = id.replace(/[^A-Za-z0-9_-]/g, '-');
    const data = join(toolRoot, 'plugins', 'data', safeId);
    return { id, root, data, vars: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data } };
  }
  const data = join(toolRoot, 'plugins', 'data', `${plugin}-${marketName}`);
  return { id, root, data, vars: { PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root, PLUGIN_DATA: data, CLAUDE_PLUGIN_DATA: data } };
}

/** Reads a Claude Code plugin's declared userConfig options from settings.json (or manifest defaults); flags any declared option without a plain value. */
async function claudePluginOptions(pluginRoot: string, toolRoot: string, id: string): Promise<{ env: Record<string, string>; missing: boolean }> {
  const declared = record((await pluginManifest(pluginRoot))?.userConfig);
  const keys = declared ? Object.keys(declared) : [];
  if (!keys.length) return { env: {}, missing: false };
  let settings: Record<string, unknown> | undefined;
  try {
    settings = record(readJsonc(await readFile(join(toolRoot, 'settings.json'), 'utf8')));
  } catch { /* absent or unreadable settings.json: only manifest defaults apply */ }
  const configured = record(record(record(settings?.pluginConfigs)?.[id])?.options);
  const env: Record<string, string> = {};
  let missing = false;
  for (const key of keys) {
    const hasConfig = configured !== undefined && Object.hasOwn(configured, key) && configured[key] !== undefined;
    const value = hasConfig ? configured[key] : record(declared![key])?.default;
    if (isPlainOption(value)) env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] = String(value);
    else missing = true;
  }
  return { env, missing };
}

/** Builds the environment for one hook run: user env + tool overrides, scrubbed of app/session/plugin controls first, then tool and plugin vars. */
function buildHookEnv(
  tool: HarnessId, home: string, path: string, base: NodeJS.ProcessEnv,
  extra: { overrides?: Partial<Record<HarnessId, string>>; envFile?: string; copilotEnv?: Record<string, string>; pluginEnv?: Record<string, string> },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || SCRUB_EXACT.has(key) || SCRUB_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  env.HOME = home;
  if (path) env.PATH = path;
  const configVar = harnesses[tool].configEnv;
  if (configVar && extra.overrides?.[tool]) env[configVar] = extra.overrides[tool];
  if (tool === 'claude-cli') {
    env.CLAUDE_PROJECT_DIR = home;
    if (extra.envFile) env.CLAUDE_ENV_FILE = extra.envFile;
  }
  if (extra.pluginEnv) Object.assign(env, extra.pluginEnv);
  if (tool === 'copilot-cli' && extra.copilotEnv) {
    const snap = { ...env };
    for (const [name, raw] of Object.entries(extra.copilotEnv)) {
      env[name] = raw.replace(/\$\{([A-Za-z_]\w*)\}/g, (_all, key: string) => snap[key] ?? '');
    }
  }
  return env;
}

/** Builds the synthetic stdin JSON payload each tool writes and closes on the hook's standard input. */
function buildHookInput(tool: HarnessId, event: string, home: string, extra: { source?: string; transcriptPath?: string }): Record<string, unknown> {
  const sessionId = randomUUID();
  if (tool === 'claude-cli') {
    const base = { session_id: sessionId, transcript_path: extra.transcriptPath ?? '', cwd: home, permission_mode: 'default', hook_event_name: event };
    return event === 'UserPromptSubmit' ? { ...base, prompt: '', prompt_id: randomUUID() } : { ...base, source: extra.source ?? 'startup' };
  }
  if (tool === 'codex-cli') {
    const base = { session_id: sessionId, transcript_path: null, cwd: home, permission_mode: 'default', hook_event_name: event, model: 'preview' };
    return event === 'UserPromptSubmit' ? { ...base, turn_id: randomUUID(), prompt: '' } : { ...base, source: extra.source ?? 'startup' };
  }
  return event === 'SessionStart'
    ? { hook_event_name: 'SessionStart', session_id: sessionId, timestamp: new Date().toISOString(), cwd: home, source: 'startup' }
    : { sessionId, timestamp: Date.now(), cwd: home, source: 'startup' };
}

const replaceBraced = (value: string, vars: Record<string, string>) =>
  value.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name: string) => (Object.hasOwn(vars, name) ? vars[name]! : whole));

/** Resolves the executable and arguments for a hook by its tool's launch rules on macOS and Linux. */
function buildHookLaunch(tool: HarnessId, hook: DeclaredHook, home: string, codexShell: string, plugin?: PluginLaunch): { file: string; args: string[] } | { problem: string } {
  const launch = hook.launch!;
  if (tool === 'claude-cli') {
    if (plugin) {
      const parts = 'program' in launch ? [launch.program, ...launch.args] : [launch.shell];
      if (parts.some(part => part.includes('${user_config.'))) return { problem: 'This hook’s command uses a plugin option, which isn’t supported here.' };
    }
    const vars = { CLAUDE_PROJECT_DIR: home, ...plugin?.vars };
    if ('program' in launch) {
      const sub = (value: string) => replaceBraced(value, vars).replace(/\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g, () => home);
      return { file: sub(launch.program), args: launch.args.map(sub) };
    }
    if (hook.shell && hook.shell !== 'bash' && hook.shell !== 'sh') return { problem: `Uses shell “${hook.shell}”, which isn’t run here.` };
    return { file: hook.shell === 'bash' ? 'bash' : '/bin/sh', args: ['-c', replaceBraced(launch.shell, vars)] };
  }
  if (tool === 'codex-cli') {
    const cmd = plugin ? replaceBraced((launch as { shell: string }).shell, plugin.vars) : (launch as { shell: string }).shell;
    return { file: codexShell, args: ['-lc', cmd] };
  }
  return 'program' in launch ? { file: launch.program, args: launch.args } : { file: 'bash', args: ['-c', launch.shell] };
}

const nonEmpty = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
const BAD_JSON = Symbol('bad-json');
function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return BAD_JSON;
  }
}

/** Copilot CLI strips single-line JSON objects with `"type": "progress"` before parsing the remaining stdout as one JSON object. */
function stripCopilotProgress(stdout: string): string {
  return stdout.split(/\r?\n/).filter(line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return true;
    return record(tryJson(trimmed))?.type !== 'progress';
  }).join('\n').trim();
}

/** Claude Code stdout JSON rule (hooks#exit-code-0): one JSON object; non-{…} or multi-line JSON with no fields set is plain text. */
function parseClaudeJson(trimmed: string): Record<string, unknown> | 'invalid' | undefined {
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  const single = tryJson(trimmed);
  if (single !== BAD_JSON) return record(single) ?? 'invalid';
  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return 'invalid';
  const items = lines.map(tryJson);
  if (items.includes(BAD_JSON)) return 'invalid';
  const setsField = items.some(item => {
    const obj = record(item);
    return obj !== undefined && Object.keys(obj).length > 0;
  });
  return setsField ? 'invalid' : undefined;
}

/** Codex stdout JSON rule (output_parser.rs): anything starting with `{` or `[` is parsed as JSON, else plain text. */
function parseCodexJson(trimmed: string): Record<string, unknown> | 'invalid' | undefined {
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  return record(tryJson(trimmed)) ?? 'invalid';
}

function toolLimit(tool: HarnessId, added: string): Pick<HookRunResult, 'overLimit'> {
  if (tool === 'claude-cli' && added.length > CLAUDE_CHAR_LIMIT) return { overLimit: { limit: CLAUDE_CHAR_LIMIT, unit: 'chars' } };
  if (tool === 'codex-cli' && Math.ceil(Buffer.byteLength(added, 'utf8') / 4) > CODEX_TOKEN_LIMIT) return { overLimit: { limit: CODEX_TOKEN_LIMIT, unit: 'tokens' } };
  return {};
}

/** A JSON object carrying context is given as what would be added; whether the tool would reject it for another field is not judged here. */
function classifyJsonContext(tool: HarnessId, event: string, parsed: Record<string, unknown>): Pick<HookRunResult, 'outcome' | 'detail' | 'added' | 'overLimit'> {
  if (parsed.decision === 'block' || parsed.continue === false) return { outcome: 'not-added', detail: 'json-block' };
  const specific = record(parsed.hookSpecificOutput);
  const eventOk = specific?.hookEventName === undefined || specific.hookEventName === event;
  const context = specific && eventOk ? nonEmpty(specific.additionalContext) : undefined;
  return context ? { outcome: 'adds', added: context, ...toolLimit(tool, context) } : { outcome: 'not-added', detail: 'json-no-context' };
}

/** Pure output classifier: works out what `raw.tool` would add (or why it wouldn't) from the hook's exit state and stdout. */
export function whatHookWouldAdd(raw: HookRunRaw): Pick<HookRunResult, 'outcome' | 'detail' | 'added' | 'overLimit' | 'program' | 'problem' | 'signal'> {
  if (raw.reason === 'aborted') return { outcome: 'stopped' };
  if (raw.reason === 'timeout') return { outcome: 'timeout' };
  if (raw.reason === 'missing') return { outcome: 'missing', ...(raw.program ? { program: raw.program } : {}) };
  if (raw.reason === 'overflow') return { outcome: 'not-added', detail: 'overflow' };
  if (raw.reason === 'error') return { outcome: 'not-added', detail: 'spawn-error', ...(raw.spawnError ? { problem: raw.spawnError } : {}) };
  if (raw.signal) return { outcome: 'failed', signal: raw.signal };
  const trimmed = raw.stdout.trim();
  if (raw.tool === 'claude-cli') {
    if (raw.code === 2) return { outcome: 'claude-exit-2' };
    const parsed = parseClaudeJson(trimmed);
    if (raw.code !== 0) return parsed && parsed !== 'invalid' ? classifyJsonContext(raw.tool, raw.event, parsed) : { outcome: 'failed' };
    if (!trimmed) return { outcome: 'empty' };
    if (parsed === 'invalid') return { outcome: 'not-added', detail: 'invalid-json' };
    if (parsed) return classifyJsonContext(raw.tool, raw.event, parsed);
    return { outcome: 'adds', added: raw.stdout, ...toolLimit(raw.tool, raw.stdout) };
  }
  if (raw.code !== 0) {
    if (raw.tool === 'codex-cli' && raw.event === 'UserPromptSubmit' && raw.code === 2) return { outcome: 'not-added', detail: 'codex-prompt-exit-2' };
    return { outcome: 'failed' };
  }
  if (!trimmed) return { outcome: 'empty' };
  if (raw.tool === 'copilot-cli') {
    const body = stripCopilotProgress(raw.stdout);
    const parsed = body ? record(tryJson(body)) : undefined;
    const context = parsed ? nonEmpty(parsed.additionalContext) : undefined;
    return context ? { outcome: 'adds', added: context } : { outcome: 'copilot-ignored' };
  }
  const parsed = parseCodexJson(trimmed);
  if (parsed === 'invalid') return { outcome: 'not-added', detail: 'invalid-json' };
  if (parsed) return classifyJsonContext(raw.tool, raw.event, parsed);
  return { outcome: 'adds', added: trimmed, ...toolLimit(raw.tool, trimmed) };
}

/** Active hook runs keyed by hookRunKey, each with its AbortController and cleanup promise; quitting blocks new starts. */
const active = new Map<string, { stop: AbortController; ended: Promise<unknown> }>();
let quitting = false;

/** Stops one running hook by home and ref; returns true when a matching run was active. */
export function stopHookRun(home: string, ref: HookSourceRef): boolean {
  const entry = active.get(hookRunKey(home, ref));
  if (!entry) return false;
  entry.stop.abort();
  return true;
}

/** Quit: refuses all new hook runs, aborts every active one and returns a promise settling once cleanup finishes (undefined when idle). */
export function stopHookRuns(): Promise<unknown> | undefined {
  quitting = true;
  if (!active.size) return undefined;
  return Promise.all([...active.values()].map(entry => {
    entry.stop.abort();
    return entry.ended;
  }));
}

const makeResult = (fields: Pick<HookRunResult, 'outcome'> & Partial<HookRunResult>): HookRunResult =>
  ({ allPrinted: '', stderr: '', durationMs: 0, at: new Date().toISOString(), cwd: '', emptyPrompt: false, ...fields });

/** Refusal answer for main.ts and runHook when a request fails its gate before starting. */
export const hookRunRefused = (problem: string, emptyPrompt = false): HookRunResult => makeResult({ outcome: 'refused', problem, emptyPrompt });

/** Runs one own or installed plugin hook once after enforcing the main-side gate; registered synchronously so Stop and Quit reach it before any await. */
export async function runHook(ctx: HookRunContext, ref: HookSourceRef): Promise<HookRunResult> {
  if (quitting) return hookRunRefused('Central Knot is quitting.');
  if ((ctx.platform ?? process.platform) === 'win32') return hookRunRefused('Not run on Windows yet.');
  if (ctx.mode !== 'actual') return hookRunRefused('Runs only on this computer’s home.');
  if (ref.from === 'marketplace') return hookRunRefused('Marketplace hooks aren’t run.');
  if (ref.from === 'installed' && ref.tool === 'copilot-cli') return hookRunRefused('Copilot CLI plugin hooks aren’t supported here.');
  const key = hookRunKey(ctx.home, ref);
  if (active.has(key)) return hookRunRefused('This hook is already running.');
  const stop = new AbortController();
  const work = executeHook(ctx, ref, stop.signal);
  active.set(key, { stop, ended: work.catch(() => undefined) });
  try {
    return await work;
  } finally {
    active.delete(key);
  }
}

async function executeHook(ctx: HookRunContext, ref: Extract<HookSourceRef, { from: 'own' | 'installed' }>, signal: AbortSignal): Promise<HookRunResult> {
  const started = Date.now();
  const baseEnv = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  let pluginVersion: string | undefined;
  const halt = (cwd = '', isPrompt = false, limitSec?: number, source?: string) => {
    if (signal.aborted) {
      return makeResult({
        outcome: 'stopped', durationMs: Date.now() - started, cwd, emptyPrompt: isPrompt,
        ...(limitSec !== undefined ? { limitSec } : {}), ...(source ? { source } : {}), ...(pluginVersion ? { pluginVersion } : {}),
      });
    }
    if (ctx.stillOpen && !ctx.stillOpen()) return hookRunRefused(HOOK_SOURCE_UNREADABLE, isPrompt);
    return undefined;
  };
  const path = typeof ctx.searchPath === 'function' ? await ctx.searchPath() : ctx.searchPath;
  const afterPath = halt();
  if (afterPath) return afterPath;
  if (!(await findBinary(ref.tool, ctx.toolsHome, path, platform, baseEnv))) return hookRunRefused('Not installed here: source only.');
  const afterBin = halt();
  if (afterBin) return afterBin;
  const found = await findHook(ctx, ref);
  const afterFind = halt();
  if (afterFind) return afterFind;
  if ('problem' in found) return hookRunRefused(found.problem);
  if (ref.from === 'installed' && found.pluginOff) return hookRunRefused(`${ref.plugin} is turned off in ${toolNames[ref.tool]}.`);
  if (found.hooksDisabled) return hookRunRefused(`Hooks are turned off in ${toolNames[ref.tool]}’s settings (${found.hooksDisabled}).`);
  pluginVersion = found.pluginVersion;
  const toolRoot = toolConfigRoot(ctx, ref.tool);
  const { hook } = found;
  if (hook.type && hook.type !== 'command') return hookRunRefused(`Not a command hook (type “${hook.type}”).`);
  if (!addsText(ref.tool, hook)) return hookRunRefused('This hook does not add text to sessions.');
  const isPrompt = hook.event === 'UserPromptSubmit';
  const source = isPrompt ? undefined : pickStartSource(ref.tool, hook.matcher);
  if (!isPrompt && !source) return hookRunRefused('No session start matches this hook’s matcher.');
  let plugin: PluginLaunch | undefined;
  if (ref.from === 'installed') {
    if (!found.pluginRoot || (ref.tool !== 'claude-cli' && ref.tool !== 'codex-cli')) return hookRunRefused(HOOK_SOURCE_UNREADABLE);
    plugin = pluginPaths(ref.tool, toolRoot, ref.plugin, ref.marketName, found.pluginRoot);
  }
  const shellCandidate = baseEnv.SHELL?.trim();
  const codexShell = ref.tool === 'codex-cli' && shellCandidate && isAbsolute(shellCandidate)
    ? await access(shellCandidate, constants.X_OK).then(() => shellCandidate, () => '/bin/sh') : '/bin/sh';
  const launch = buildHookLaunch(ref.tool, hook, ctx.home, codexShell, plugin);
  if ('problem' in launch) return hookRunRefused(launch.problem, isPrompt);
  const cwd = ref.tool === 'copilot-cli' && hook.cwd ? resolve(ctx.home, hook.cwd) : ctx.home;
  const limitSec = hookTimeoutSec(ref.tool, isPrompt, hook.timeout);
  if (ref.tool === 'copilot-cli' && hook.cwd && !(await stat(cwd).then(info => info.isDirectory(), () => false))) {
    return makeResult({ outcome: 'not-added', detail: 'spawn-error', problem: `Working folder not found: ${cwd}`, durationMs: Date.now() - started, cwd, emptyPrompt: isPrompt, limitSec, ...(source ? { source } : {}) });
  }
  let pluginEnv: Record<string, string> | undefined = plugin?.vars;
  let missingOptions = false;
  if (plugin && ref.tool === 'claude-cli') {
    const opts = await claudePluginOptions(plugin.root, toolRoot, plugin.id);
    const afterOpts = halt(cwd, isPrompt, limitSec, source);
    if (afterOpts) return afterOpts;
    pluginEnv = { ...plugin.vars, ...opts.env };
    missingOptions = opts.missing;
    try {
      await mkdir(plugin.data, { recursive: true });
    } catch {
      return hookRunRefused('Couldn’t create the plugin’s data folder.', isPrompt);
    }
  }
  let tempDir: string | undefined;
  try {
    let transcriptPath: string | undefined;
    let envFile: string | undefined;
    if (ref.tool === 'claude-cli') {
      tempDir = await mkdtemp(join(tmpdir(), 'ck-hook-run-'));
      transcriptPath = join(tempDir, 'transcript.jsonl');
      await writeFile(transcriptPath, '');
      if (!isPrompt) {
        envFile = join(tempDir, 'claude-env');
        await writeFile(envFile, '');
      }
    }
    const beforeRun = halt(cwd, isPrompt, limitSec, source);
    if (beforeRun) return beforeRun;
    const env = buildHookEnv(ref.tool, ctx.home, path, baseEnv, { overrides: ctx.overrides, envFile, copilotEnv: hook.env, pluginEnv });
    const input = JSON.stringify(buildHookInput(ref.tool, hook.event, ctx.home, { source, transcriptPath }));
    const runStart = Date.now();
    const ran = await run(launch.file, launch.args, {
      cwd, env, input, timeoutMs: Math.round(limitSec * 1000), group: true, signal, catchStart: true,
      drainMs: ctx.drainMs ?? CLOSE_GRACE_MS, ...(ctx.maxBytes ? { maxBytes: ctx.maxBytes } : {}),
    });
    const stdout = ran.stdout.toString('utf8');
    const stderr = ran.stderr.toString('utf8');
    const classified = whatHookWouldAdd({ tool: ref.tool, event: hook.event, code: ran.code, reason: ran.reason, signal: ran.signal, stdout, program: launch.file, spawnError: ran.spawnError });
    return makeResult({
      ...classified, allPrinted: stdout, stderr, durationMs: Date.now() - runStart, cwd, emptyPrompt: isPrompt, limitSec,
      ...(source ? { source } : {}),
      ...(pluginVersion ? { pluginVersion } : {}),
      ...(missingOptions ? { missingOptions: true } : {}),
      ...(typeof ran.code === 'number' && !ran.reason && !ran.signal ? { exitCode: ran.code } : {}),
    });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
