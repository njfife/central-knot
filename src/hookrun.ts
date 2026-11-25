// Running one hook's command once on click (IPC hook:run / hook:stop), in main, and classifying what the tool would add
// (whatHookWouldAdd, pure): re-finds the hook on disk through hooksource.ts findHook, enforces the main-side gate (actual
// home, non-Windows in this step, own hooks only in this step, tool installed, hooks not disabled, command type, event adds
// text by pluginoutcomes.ts addsText, matching start source by pluginoutcomes.ts pickStartSource, one run at a time per hook),
// builds each tool's environment, launch form and stdin JSON, runs through plugins.ts run (process group + launch.ts
// CLOSE_GRACE_MS drain), cleans up disposable Claude files and stops active runs on Stop or Quit (stopHookRun, stopHookRuns).
// Nothing here stores results or draws a page; hook source extraction stays in hooksource.ts.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { findBinary } from './discovery.ts';
import { harnesses } from './harnesses.ts';
import { findHook, type HookSourceContext } from './hooksource.ts';
import { CLOSE_GRACE_MS } from './launch.ts';
import { addsText, pickStartSource } from './pluginoutcomes.ts';
import { run, type RunResult } from './plugins.ts';
import type { DeclaredHook, HarnessId, HookRunResult, HookSourceRef } from './types.ts';
import { record } from './values.ts';
import { HOOK_SOURCE_UNREADABLE } from './words.ts';

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
  ref.declaredIn, ref.event, ref.at, ref.command,
]);

/** Time limit enforced for one hook run, in seconds: positive configured timeout capped at 60 s, else tool default capped at 60 s. */
export function hookTimeoutSec(tool: HarnessId, isPrompt: boolean, configured?: number): number {
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) return Math.min(configured, MAX_TIMEOUT_SEC);
  return Math.min(tool === 'codex-cli' || (tool === 'claude-cli' && !isPrompt) ? 600 : 30, MAX_TIMEOUT_SEC);
}

/** Builds the environment for one own-hook run: user env + tool overrides, scrubbed of app/session/plugin controls, then tool vars. */
function buildHookEnv(
  tool: HarnessId, home: string, path: string, base: NodeJS.ProcessEnv,
  extra: { overrides?: Partial<Record<HarnessId, string>>; envFile?: string; copilotEnv?: Record<string, string> },
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

/** Resolves the executable and arguments for a hook by its tool's launch rules on macOS and Linux. */
function buildHookLaunch(tool: HarnessId, hook: DeclaredHook, home: string, codexShell: string): { file: string; args: string[] } | { problem: string } {
  const launch = hook.launch!;
  if (tool === 'claude-cli') {
    if ('program' in launch) {
      const sub = (value: string) => value.replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g, home);
      return { file: sub(launch.program), args: launch.args.map(sub) };
    }
    if (hook.shell && hook.shell !== 'bash' && hook.shell !== 'sh') return { problem: `Uses shell “${hook.shell}”, which isn’t run here.` };
    return { file: hook.shell === 'bash' ? 'bash' : '/bin/sh', args: ['-c', launch.shell] };
  }
  if (tool === 'codex-cli') return 'shell' in launch ? { file: codexShell, args: ['-lc', launch.shell] } : { problem: 'Codex hooks must declare a shell command.' };
  return 'program' in launch ? { file: launch.program, args: launch.args } : { file: 'bash', args: ['-c', launch.shell] };
}

const nonEmpty = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);

/** Copilot CLI strips single-line JSON objects with `"type": "progress"` before parsing the remaining stdout as one JSON object. */
function stripCopilotProgress(stdout: string): string {
  return stdout.split(/\r?\n/).filter(line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return true;
    try { return record(JSON.parse(trimmed))?.type !== 'progress'; } catch { return true; }
  }).join('\n').trim();
}

/** Claude Code stdout JSON rule (hooks#exit-code-0): one JSON object; non-{…} or multi-line JSON with no fields set is plain text. */
function parseClaudeJson(trimmed: string): Record<string, unknown> | 'invalid' | undefined {
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try { return record(JSON.parse(trimmed)) ?? 'invalid'; } catch { /* check multi-line rule */ }
  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return 'invalid';
  const items: unknown[] = [];
  for (const line of lines) {
    try { items.push(JSON.parse(line)); } catch { return 'invalid'; }
  }
  const setsField = items.some(item => {
    const obj = record(item);
    return obj !== undefined && Object.keys(obj).length > 0;
  });
  return setsField ? 'invalid' : undefined;
}

/** Codex stdout JSON rule (user_prompt_submit.rs): anything starting with `{` is parsed as JSON, else plain text. */
function parseCodexJson(trimmed: string): Record<string, unknown> | 'invalid' | undefined {
  if (!trimmed.startsWith('{')) return undefined;
  try { return record(JSON.parse(trimmed)) ?? 'invalid'; } catch { return 'invalid'; }
}

function toolLimit(tool: HarnessId, added: string): Pick<HookRunResult, 'overLimit'> {
  if (tool === 'claude-cli' && added.length > CLAUDE_CHAR_LIMIT) return { overLimit: { limit: CLAUDE_CHAR_LIMIT, unit: 'chars' } };
  if (tool === 'codex-cli' && Math.ceil(Buffer.byteLength(added, 'utf8') / 4) > CODEX_TOKEN_LIMIT) return { overLimit: { limit: CODEX_TOKEN_LIMIT, unit: 'tokens' } };
  return {};
}

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
    let parsed: Record<string, unknown> | undefined;
    try { parsed = body ? record(JSON.parse(body)) : undefined; } catch { /* non-JSON ignored by Copilot */ }
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

/** Runs one own hook once after enforcing the main-side gate; registered synchronously so Stop and Quit reach it before any await. */
export async function runHook(ctx: HookRunContext, ref: HookSourceRef): Promise<HookRunResult> {
  if (quitting) return hookRunRefused('Central Knot is quitting.');
  if ((ctx.platform ?? process.platform) === 'win32') return hookRunRefused('Not run on Windows yet.');
  if (ctx.mode !== 'actual') return hookRunRefused('Runs only on this computer’s home.');
  if (ref.from !== 'own') return hookRunRefused(ref.from === 'installed' ? 'Plugin hooks aren’t run yet.' : 'Marketplace hooks aren’t run.');
  const key = hookRunKey(ctx.home, ref);
  if (active.has(key)) return hookRunRefused('This hook is already running.');
  const stop = new AbortController();
  const work = executeHook(ctx, ref, stop.signal);
  active.set(key, { stop, ended: work.catch(() => undefined) });
  try { return await work; } finally { active.delete(key); }
}

async function executeHook(ctx: HookRunContext, ref: Extract<HookSourceRef, { from: 'own' }>, signal: AbortSignal): Promise<HookRunResult> {
  const started = Date.now();
  const baseEnv = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  const halt = (cwd = '', isPrompt = false, limitSec?: number, source?: string) => {
    if (signal.aborted) {
      return makeResult({
        outcome: 'stopped', durationMs: Date.now() - started, cwd, emptyPrompt: isPrompt,
        ...(limitSec !== undefined ? { limitSec } : {}), ...(source ? { source } : {}),
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
  if (found.hooksDisabled) {
    const why = ref.tool === 'codex-cli' ? 'Codex’s settings ([features] hooks = false)' : 'Claude Code’s settings (disableAllHooks)';
    return hookRunRefused(`Hooks are turned off in ${why}.`);
  }
  const { hook } = found;
  if (hook.type && hook.type !== 'command') return hookRunRefused(`Not a command hook (type “${hook.type}”).`);
  if (!addsText(ref.tool, hook)) return hookRunRefused('This hook does not add text to sessions.');
  const isPrompt = hook.event === 'UserPromptSubmit';
  const source = isPrompt ? undefined : pickStartSource(ref.tool, hook.matcher);
  if (!isPrompt && !source) return hookRunRefused('No session start matches this hook’s matcher.');
  const shellCandidate = baseEnv.SHELL?.trim();
  const codexShell = ref.tool === 'codex-cli' && shellCandidate && isAbsolute(shellCandidate)
    ? await access(shellCandidate, constants.X_OK).then(() => shellCandidate, () => '/bin/sh') : '/bin/sh';
  const launch = buildHookLaunch(ref.tool, hook, ctx.home, codexShell);
  if ('problem' in launch) return hookRunRefused(launch.problem, isPrompt);
  const cwd = ref.tool === 'copilot-cli' && hook.cwd ? resolve(ctx.home, hook.cwd) : ctx.home;
  const limitSec = hookTimeoutSec(ref.tool, isPrompt, hook.timeout);
  if (ref.tool === 'copilot-cli' && hook.cwd && !(await stat(cwd).then(info => info.isDirectory(), () => false))) {
    return makeResult({ outcome: 'not-added', detail: 'spawn-error', problem: `Working folder not found: ${cwd}`, durationMs: Date.now() - started, cwd, emptyPrompt: isPrompt, limitSec, ...(source ? { source } : {}) });
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
    const env = buildHookEnv(ref.tool, ctx.home, path, baseEnv, { overrides: ctx.overrides, envFile, copilotEnv: hook.env });
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
      ...(typeof ran.code === 'number' && !ran.reason && !ran.signal ? { exitCode: ran.code } : {}),
    });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
