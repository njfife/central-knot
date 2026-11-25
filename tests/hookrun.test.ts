// Worked examples of running one hook's command on click as its tool would, and classifying what the tool would add
// (hookrun.ts runHook, stopHookRun, stopHookRuns, whatHookWouldAdd, pickStartSource, hookTimeoutSec):
// stand-in hooks in made-up homes under /tmp for Claude Code, Codex and Copilot CLI, stdin and environment checks
// (including control/stale variable scrubbing and CLAUDE_ENV_FILE cleanup), every row of the output classification table
// and its edge cases (limits, JSON blocks, invalid JSON, non-zero JSON, Codex prompt exit 2, overflow, spawn errors),
// all main-side gates (actual home, installed tool, fresh disk check matching hooksource.ts, disableAllHooks, non-text
// events, Windows, plugin hooks, concurrent runs), process-group cleanup on timeout/Stop/bounded drain, and Quit.
// No hook of this machine's own tools is ever run, and no real tool folder is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findHook, readHookSource } from '../src/hooksource.ts';
import { hookTimeoutSec, runHook, stopHookRun, stopHookRuns, whatHookWouldAdd, type HookRunContext } from '../src/hookrun.ts';
import { pickStartSource } from '../src/pluginoutcomes.ts';
import { readPluginItems, sessionSettings } from '../src/pluginitems.ts';
import { run } from '../src/plugins.ts';
import { sessionStrip } from '../src/sessionhooks.ts';
import type { HarnessId, HookSourceRef } from '../src/types.ts';
import { standIn } from './standin.ts';
import { slashPath } from './wincompat.ts';

const windows = process.platform === 'win32';
const unixSkip = windows && 'Hook execution and POSIX process-group checks are skipped on Windows in HOOK-RUN-A1 (Windows hook launching is a later step).';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const put = async (path: string, content: string, mode?: number) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, mode ? { mode } : undefined);
  if (mode && !windows) await chmod(path, mode);
};

const isRunning = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ready: () => Promise<boolean>, tries = 250) => {
  for (let i = 0; i < tries && !(await ready()); i++) await new Promise(done => setTimeout(done, 20));
};

async function sandbox(installed: ('claude' | 'codex' | 'copilot')[] = ['claude', 'codex', 'copilot']) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-hookrun-test-')));
  const home = join(base, 'home');
  const tools = join(base, 'tools');
  const data = join(base, 'data');
  await mkdir(home, { recursive: true });
  await mkdir(join(tools, '.local/bin'), { recursive: true });
  for (const bin of installed) await standIn(join(tools, '.local/bin', bin), '#!/bin/sh\necho "1.0.0"\n', 'console.log("1.0.0");');
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: '/some/unrelated/home',
    USER_CUSTOM: 'kept-value',
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'),
    COPILOT_HOME: join(home, '.copilot'),
    // App control, Electron, and stale session/plugin variables that must be stripped before spawning.
    CK_TEST_HOME: '/stale/ck-home',
    CK_TEST_APPS: '/stale/apps',
    CK_SPAWN_LOG: '/stale/spawn',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ASAR: '1',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_SESSION_ID: 'stale-session',
    CLAUDE_PROJECT_DIR: '/stale/project',
    CLAUDE_ENV_FILE: '/stale/env-file',
    CLAUDE_PLUGIN_ROOT: '/stale/plugin-root',
    CLAUDE_PLUGIN_DATA: '/stale/plugin-data',
    CLAUDE_PLUGIN_OPTION_API: 'stale-opt',
    PLUGIN_ROOT: '/stale/codex-root',
    PLUGIN_DATA: '/stale/codex-data',
    CODEX_THREAD_ID: 'stale-thread',
    COPILOT_PLUGIN_ROOT: '/stale/copilot-root',
    COPILOT_PLUGIN_DATA: '/stale/copilot-data',
    COPILOT_SESSION_ID: 'stale-copilot-session',
    CK_TEST_HOME_ONLY: 'claude,codex,copilot',
  };
  const ctx = (extra: Partial<HookRunContext> = {}): HookRunContext => ({
    home, mode: 'actual', dataDir: data, toolsHome: tools, searchPath: process.env.PATH ?? '/usr/bin:/bin',
    env: baseEnv, ...extra,
  });
  const ownRef = async (tool: HarnessId, index = 0): Promise<HookSourceRef> => {
    const dir = tool === 'claude-cli' ? '.claude' : tool === 'codex-cli' ? '.codex' : '.copilot';
    const strip = sessionStrip(tool, [], await sessionSettings(tool, join(home, dir)))!;
    return strip.groups.flatMap(group => group.hooks)[index]!.source;
  };
  const done = () => rm(base, { recursive: true, force: true });
  return { base, home, tools, data, baseEnv, ctx, ownRef, done };
}

test('Worked example 1: Claude Code SessionStart prints two lines, receives tool stdin & scrubbed env, and removes throwaway CLAUDE_ENV_FILE and transcript', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox();
  try {
    const stdinFile = join(box.base, 'stdin.json');
    const envFile = join(box.base, 'env.json');
    const script = join(box.home, 'bin/claude-start.mjs');
    await put(script, `#!/usr/bin/env node
import fs from 'node:fs';
const input = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(stdinFile)}, input);
const envPath = process.env.CLAUDE_ENV_FILE || '';
if (envPath) fs.appendFileSync(envPath, 'export FROM_HOOK=1\\n');
fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({
  cwd: fs.realpathSync(process.cwd()),
  env: process.env,
  envFileExists: !!envPath && fs.existsSync(envPath),
}));
process.stdout.write('Line one\\nLine two\\n');
process.stderr.write('note on stderr\\n');
`, 0o755);
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/claude-start.mjs' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: process.execPath, args: ['${CLAUDE_PROJECT_DIR}/bin/claude-prompt.mjs'] }] }],
      },
    }, null, 2));
    const promptStdin = join(box.base, 'prompt-stdin.json');
    const promptEnv = join(box.base, 'prompt-env.json');
    await put(join(box.home, 'bin/claude-prompt.mjs'), `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(promptStdin)}, fs.readFileSync(0, 'utf8'));
fs.writeFileSync(${JSON.stringify(promptEnv)}, JSON.stringify(process.env));
process.stdout.write('Prompt context\\n');
`);

    const startRef = await box.ownRef('claude-cli', 0);
    const result = await runHook(box.ctx(), startRef);
    assert.equal(result.outcome, 'adds');
    assert.equal(result.added, 'Line one\nLine two\n');
    assert.equal(result.allPrinted, 'Line one\nLine two\n');
    assert.equal(result.stderr, 'note on stderr\n');
    assert.equal(result.exitCode, 0);
    assert.equal(result.cwd, box.home);
    assert.equal(result.source, 'startup');
    assert.equal(result.emptyPrompt, false);
    assert.equal(result.overLimit, undefined);
    assert.equal(result.limitSec, 60);
    assert.ok(result.durationMs >= 0 && !Number.isNaN(Date.parse(result.at)));

    const stdin = JSON.parse(await readFile(stdinFile, 'utf8'));
    assert.match(stdin.session_id, UUID);
    assert.equal(stdin.cwd, box.home);
    assert.equal(stdin.permission_mode, 'default');
    assert.equal(stdin.hook_event_name, 'SessionStart');
    assert.equal(stdin.source, 'startup');
    assert.equal(typeof stdin.transcript_path, 'string');
    await assert.rejects(stat(stdin.transcript_path), { code: 'ENOENT' }, 'disposable transcript_path removed after run');

    const captured = JSON.parse(await readFile(envFile, 'utf8'));
    assert.equal(captured.cwd, box.home);
    assert.equal(captured.envFileExists, true, 'CLAUDE_ENV_FILE existed and was writable during SessionStart');
    await assert.rejects(stat(captured.env.CLAUDE_ENV_FILE), { code: 'ENOENT' }, 'throwaway CLAUDE_ENV_FILE removed after run');
    assert.equal(captured.env.HOME, box.home);
    assert.equal(captured.env.PATH, process.env.PATH);
    assert.equal(captured.env.CLAUDE_PROJECT_DIR, box.home);
    assert.equal(captured.env.USER_CUSTOM, 'kept-value');
    assert.equal(captured.env.CLAUDE_CONFIG_DIR, join(box.home, '.claude'));
    for (const forbidden of [
      'CK_TEST_HOME', 'CK_TEST_APPS', 'CK_SPAWN_LOG', 'CK_TEST_HOME_ONLY',
      'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR',
      'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_SESSION_ID',
      'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_PLUGIN_OPTION_API',
      'PLUGIN_ROOT', 'PLUGIN_DATA', 'CODEX_THREAD_ID', 'COPILOT_PLUGIN_ROOT', 'COPILOT_PLUGIN_DATA', 'COPILOT_SESSION_ID',
    ]) assert.equal(captured.env[forbidden], undefined, `${forbidden} must be scrubbed`);

    // Direct argv with ${CLAUDE_PROJECT_DIR} substitution + UserPromptSubmit input & no CLAUDE_ENV_FILE.
    const promptRef = await box.ownRef('claude-cli', 1);
    const promptRes = await runHook(box.ctx(), promptRef);
    assert.equal(promptRes.outcome, 'adds');
    assert.equal(promptRes.added, 'Prompt context\n');
    assert.equal(promptRes.source, undefined);
    assert.equal(promptRes.emptyPrompt, true);
    assert.equal(promptRes.limitSec, 30);
    const pIn = JSON.parse(await readFile(promptStdin, 'utf8'));
    assert.match(pIn.session_id, UUID);
    assert.match(pIn.prompt_id, UUID);
    assert.equal(pIn.prompt, '');
    assert.equal(pIn.hook_event_name, 'UserPromptSubmit');
    assert.equal(pIn.permission_mode, 'default');
    assert.equal(pIn.cwd, box.home);
    const pEnv = JSON.parse(await readFile(promptEnv, 'utf8'));
    assert.equal(pEnv.CLAUDE_ENV_FILE, undefined, 'prompt hook does not receive CLAUDE_ENV_FILE');
  } finally { await box.done(); }
});

test('Worked example 2: Claude Code JSON hookSpecificOutput.additionalContext extracts added text and keeps full stdout', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox();
  try {
    const payload = JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Follow the team style guide.' },
      systemMessage: 'Extra status',
    });
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'resume|compact', hooks: [{ type: 'command', command: `printf '%s\\n' ${JSON.stringify(payload)}` }] }] },
    }));
    const ref = await box.ownRef('claude-cli', 0);
    const res = await runHook(box.ctx(), ref);
    assert.equal(res.outcome, 'adds');
    assert.equal(res.source, 'resume');
    assert.equal(res.added, 'Follow the team style guide.');
    assert.equal(res.allPrinted, `${payload}\n`);
    assert.notEqual(res.added, res.allPrinted);
    assert.equal(res.exitCode, 0);
  } finally { await box.done(); }
});

test('Worked example 3: Copilot CLI ignores plain stdout, adds top-level additionalContext, honours cwd and expanded env, and formats camelCase and PascalCase inputs', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox();
  try {
    const sub = join(box.home, 'sub');
    const absDir = join(box.base, 'abs-cwd');
    await mkdir(sub, { recursive: true });
    await mkdir(absDir, { recursive: true });
    const camelStdin = join(box.base, 'copilot-camel.json');
    const camelMeta = join(box.base, 'copilot-meta.json');
    const pascalStdin = join(box.base, 'copilot-pascal.json');
    const script = join(box.home, 'bin/copilot-json.mjs');
    await put(script, `import fs from 'node:fs';
fs.writeFileSync(process.argv[2], fs.readFileSync(0, 'utf8'));
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ cwd: fs.realpathSync(process.cwd()), greeting: process.env.GREETING, kept: process.env.USER_CUSTOM, pluginData: process.env.COPILOT_PLUGIN_DATA }));
process.stdout.write(JSON.stringify({ additionalContext: 'Copilot context line' }) + '\\n');
`);
    await put(join(box.home, '.copilot/hooks/team.json'), JSON.stringify({
      version: 1,
      hooks: {
        sessionStart: [
          { type: 'command', bash: 'echo "plain output ignored by copilot"' },
          { type: 'command', exec: process.execPath, args: [script, camelStdin, camelMeta], cwd: 'sub', env: { GREETING: 'hello-${USER_CUSTOM}' } },
        ],
        SessionStart: [
          { type: 'command', exec: process.execPath, args: [script, pascalStdin], cwd: absDir },
        ],
      },
    }, null, 2));

    const dir = join(box.home, '.copilot');
    const strip = sessionStrip('copilot-cli', [], await sessionSettings('copilot-cli', dir))!;
    const hooks = strip.groups.flatMap(group => group.hooks).map(entry => entry.source);
    const find = (event: string, at: number) => hooks.find(ref => ref.event === event && ref.at === at)!;

    const plainRef = find('sessionStart', 0);
    const plainRes = await runHook(box.ctx(), plainRef);
    assert.equal(plainRes.outcome, 'copilot-ignored');
    assert.equal(plainRes.added, undefined);
    assert.equal(plainRes.allPrinted, 'plain output ignored by copilot\n');
    assert.equal(plainRes.exitCode, 0);
    assert.equal(plainRes.limitSec, 30);

    const jsonRef = find('sessionStart', 1);
    const jsonRes = await runHook(box.ctx(), jsonRef);
    assert.equal(jsonRes.outcome, 'adds');
    assert.equal(jsonRes.added, 'Copilot context line');
    assert.equal(slashPath(jsonRes.cwd), slashPath(sub));
    const cIn = JSON.parse(await readFile(camelStdin, 'utf8'));
    assert.match(cIn.sessionId, UUID);
    assert.equal(typeof cIn.timestamp, 'number');
    assert.equal(cIn.cwd, box.home);
    assert.equal(cIn.source, 'startup');
    assert.equal('initialPrompt' in cIn, false, 'optional initialPrompt omitted');
    const cMeta = JSON.parse(await readFile(camelMeta, 'utf8'));
    assert.equal(cMeta.cwd, sub);
    assert.equal(cMeta.greeting, 'hello-kept-value');
    assert.equal(cMeta.kept, 'kept-value');
    assert.equal(cMeta.pluginData, undefined);

    const pascalRef = find('SessionStart', 0);
    const pascalRes = await runHook(box.ctx(), pascalRef);
    assert.equal(pascalRes.outcome, 'adds');
    assert.equal(slashPath(pascalRes.cwd), slashPath(absDir));
    const pIn = JSON.parse(await readFile(pascalStdin, 'utf8'));
    assert.equal(pIn.hook_event_name, 'SessionStart');
    assert.match(pIn.session_id, UUID);
    assert.equal(typeof pIn.timestamp, 'string');
    assert.ok(!Number.isNaN(Date.parse(pIn.timestamp)));
    assert.equal(pIn.cwd, box.home);
    assert.equal(pIn.source, 'startup');
    assert.equal('initial_prompt' in pIn, false);

    // Missing cwd reports spawn-error rather than falsely claiming bash is missing.
    await put(join(box.home, '.copilot/hooks/badcwd.json'), JSON.stringify({
      version: 1,
      hooks: { sessionStart: [{ type: 'command', bash: 'echo hi', cwd: 'no-such-folder' }] },
    }));
    const badCwdStrip = sessionStrip('copilot-cli', [], await sessionSettings('copilot-cli', dir))!;
    const badCwdRef = badCwdStrip.groups.find(g => g.settings?.endsWith('badcwd.json'))!.hooks[0]!.source;
    const badCwdRes = await runHook(box.ctx(), badCwdRef);
    assert.equal(badCwdRes.outcome, 'not-added');
    assert.equal(badCwdRes.detail, 'spawn-error');
  } finally { await box.done(); }
});

test('Worked example 4 (Codex): runs via $SHELL -lc with fallback to /bin/sh, sends Codex stdin fields, and runs untrusted hooks', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox();
  try {
    const shellLog = join(box.base, 'shell-args.txt');
    const customShell = join(box.base, 'my-shell.sh');
    await put(customShell, `#!/bin/sh
printf '%s\\n' "$1" >> ${JSON.stringify(shellLog)}
shift
exec /bin/sh -c "$1"
`, 0o755);
    const startStdin = join(box.base, 'codex-start.json');
    const promptStdin = join(box.base, 'codex-prompt.json');
    const envOut = join(box.base, 'codex-env.json');
    const helper = join(box.home, 'bin/codex-hook.mjs');
    await put(helper, `import fs from 'node:fs';
fs.writeFileSync(process.argv[2], fs.readFileSync(0, 'utf8'));
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(process.env));
process.stdout.write('Codex context\\n');
`);
    await put(join(box.home, '.codex/hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: 'compact', hooks: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(helper)} ${JSON.stringify(startStdin)} ${JSON.stringify(envOut)}` }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(helper)} ${JSON.stringify(promptStdin)}` }] }],
      },
    }));

    const startRef = await box.ownRef('codex-cli', 0);
    const startRes = await runHook(box.ctx({ env: { ...box.baseEnv, SHELL: customShell } }), startRef);
    assert.equal(startRes.outcome, 'adds');
    assert.equal(startRes.added, 'Codex context');
    assert.equal(startRes.source, 'compact');
    assert.equal(startRes.limitSec, 60);
    assert.equal(startRes.emptyPrompt, false);
    assert.equal((await readFile(shellLog, 'utf8')).trim(), '-lc');
    const sIn = JSON.parse(await readFile(startStdin, 'utf8'));
    assert.match(sIn.session_id, UUID);
    assert.equal(sIn.transcript_path, null);
    assert.equal(sIn.cwd, box.home);
    assert.equal(sIn.permission_mode, 'default');
    assert.equal(sIn.hook_event_name, 'SessionStart');
    assert.equal(sIn.model, 'preview');
    assert.equal(sIn.source, 'compact');
    const cEnv = JSON.parse(await readFile(envOut, 'utf8'));
    assert.equal(cEnv.CODEX_HOME, join(box.home, '.codex'));
    assert.equal(cEnv.PLUGIN_ROOT, undefined);
    assert.equal(cEnv.CLAUDE_PLUGIN_ROOT, undefined);
    assert.equal(cEnv.CLAUDE_PROJECT_DIR, undefined);

    // Fallback to /bin/sh when SHELL is unset or not executable, on UserPromptSubmit.
    const promptRef = await box.ownRef('codex-cli', 1);
    const promptRes = await runHook(box.ctx({ env: { ...box.baseEnv, SHELL: '/no/such/shell' } }), promptRef);
    assert.equal(promptRes.outcome, 'adds');
    assert.equal(promptRes.emptyPrompt, true);
    assert.equal(promptRes.limitSec, 60);
    const pIn = JSON.parse(await readFile(promptStdin, 'utf8'));
    assert.match(pIn.session_id, UUID);
    assert.match(pIn.turn_id, UUID);
    assert.equal(pIn.transcript_path, null);
    assert.equal(pIn.model, 'preview');
    assert.equal(pIn.prompt, '');
    assert.equal(pIn.hook_event_name, 'UserPromptSubmit');

    // Codex inline hook declared in config.toml also runs through the shared lookup.
    await put(join(box.home, '.codex/config.toml'), '[[hooks.SessionStart]]\nmatcher = "startup"\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "echo from-toml"\n');
    const tomlRef = await box.ownRef('codex-cli', 2);
    const tomlRes = await runHook(box.ctx(), tomlRef);
    assert.equal(tomlRes.outcome, 'adds');
    assert.equal(tomlRes.added, 'from-toml');
    assert.equal(tomlRes.source, 'startup');
  } finally { await box.done(); }
});

test('Worked example 4b (through runHook): Claude Code exit 2 on start and prompt, exit 1 failure, and empty stdout with stderr verbatim', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['claude']);
  try {
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [
            { type: 'command', command: 'echo "start error text" >&2; exit 2' },
            { type: 'command', command: 'echo "other failure" >&2; echo "ignored out"; exit 1' },
            { type: 'command', command: 'echo "quiet stderr" >&2; exit 0' },
          ],
        }],
        UserPromptSubmit: [{
          hooks: [
            { type: 'command', command: 'echo "block prompt reason" >&2; exit 2' },
          ],
        }],
      },
    }));
    const rStart2 = await runHook(box.ctx(), await box.ownRef('claude-cli', 0));
    assert.equal(rStart2.outcome, 'claude-exit-2');
    assert.equal(rStart2.emptyPrompt, false);
    assert.equal(rStart2.exitCode, 2);
    assert.equal(rStart2.stderr, 'start error text\n');

    const rFail = await runHook(box.ctx(), await box.ownRef('claude-cli', 1));
    assert.equal(rFail.outcome, 'failed');
    assert.equal(rFail.exitCode, 1);
    assert.equal(rFail.stderr, 'other failure\n');
    assert.equal(rFail.allPrinted, 'ignored out\n');

    const rEmpty = await runHook(box.ctx(), await box.ownRef('claude-cli', 2));
    assert.equal(rEmpty.outcome, 'empty');
    assert.equal(rEmpty.exitCode, 0);
    assert.equal(rEmpty.allPrinted, '');
    assert.equal(rEmpty.stderr, 'quiet stderr\n');

    const rPrompt2 = await runHook(box.ctx(), await box.ownRef('claude-cli', 3));
    assert.equal(rPrompt2.outcome, 'claude-exit-2');
    assert.equal(rPrompt2.emptyPrompt, true);
    assert.equal(rPrompt2.exitCode, 2);
    assert.equal(rPrompt2.stderr, 'block prompt reason\n');
  } finally { await box.done(); }
});

test('Pure classification table (whatHookWouldAdd): every row, edge case and tool limit boundary', () => {
  const classify = (tool: HarnessId, event: string, code: number | 'timeout' | 'missing', stdout: string, extra: Partial<Parameters<typeof whatHookWouldAdd>[0]> = {}) =>
    whatHookWouldAdd({ tool, event, code, stdout, ...extra });

  // T4.22: exit 0, plain or valid nested context (Claude/Codex), top-level context (Copilot).
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, 'hello\n'), { outcome: 'adds', added: 'hello\n' });
  // Codex trims plain stdout (codex-rs/hooks/src/events/user_prompt_submit.rs:159,219: `let trimmed_stdout = run_result.stdout.trim()`).
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, 'hello\n'), { outcome: 'adds', added: 'hello' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ctx' } })), { outcome: 'adds', added: 'ctx' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ hookSpecificOutput: { additionalContext: 'ctx' } })), { outcome: 'adds', added: 'ctx' });
  assert.deepEqual(classify('codex-cli', 'UserPromptSubmit', 0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'codex ctx' } })), { outcome: 'adds', added: 'codex ctx' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, JSON.stringify({ additionalContext: 'copilot ctx' })), { outcome: 'adds', added: 'copilot ctx' });
  // Copilot CLI strips single-line JSON progress events before JSON.parse (hooks-reference#progress-messages:
  // "Any line that, after trimming, is a single complete JSON object with \"type\": \"progress\" is consumed as a progress event and removed from the hook's output stream.").
  assert.deepEqual(
    classify('copilot-cli', 'sessionStart', 0, '{"type":"progress","message":"Preparing"}\n{"additionalContext":"top text"}\n'),
    { outcome: 'adds', added: 'top text' },
  );
  // Multi-line progress object is not recognized as progress and falls through to ignored (hooks-reference#progress-messages:
  // "Multi-line / pretty-printed progress objects are not recognized as progress and will be left in the output stream").
  assert.deepEqual(
    classify('copilot-cli', 'sessionStart', 0, '{\n"type":"progress"\n}\n{"additionalContext":"top text"}'),
    { outcome: 'copilot-ignored' },
  );
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, '{"type":"progress","message":"Only progress"}\n'), { outcome: 'copilot-ignored' });

  // T4.23: exit 0, empty stdout (never for non-empty JSON like {}).
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, ''), { outcome: 'empty' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, '   \n'), { outcome: 'empty' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, ''), { outcome: 'empty' });

  // T4.24: exit 0, Copilot CLI non-empty without usable top-level additionalContext.
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, 'plain text\n'), { outcome: 'copilot-ignored' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, JSON.stringify({ hookSpecificOutput: { additionalContext: 'wrong shape' } })), { outcome: 'copilot-ignored' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, '{}'), { outcome: 'copilot-ignored' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, JSON.stringify({ additionalContext: '' })), { outcome: 'copilot-ignored' });

  // T4.25: exit 2 from Claude Code start and prompt hooks, decided before JSON is looked at
  // (code.claude.com/docs/en/hooks#exit-code-output: "Exit code 2 still blocks with most JSON your hook prints." / Table: "Blocking error.").
  assert.deepEqual(classify('claude-cli', 'SessionStart', 2, ''), { outcome: 'claude-exit-2' });
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 2, 'plain'), { outcome: 'claude-exit-2' });
  assert.deepEqual(
    classify('claude-cli', 'UserPromptSubmit', 2, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'nested' } })),
    { outcome: 'claude-exit-2' },
  );

  // Claude Code other non-zero exit with valid JSON: Claude ignores the exit code and the JSON fields decide
  // (code.claude.com/docs/en/hooks#exit-code-output table: "Success. Claude Code ignores the exit code, and the fields alone decide.").
  assert.deepEqual(
    classify('claude-cli', 'UserPromptSubmit', 1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'still added' } })),
    { outcome: 'adds', added: 'still added' },
  );
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, JSON.stringify({ continue: false })), { outcome: 'not-added', detail: 'json-block' });
  // Claude Code other non-zero exit with unparseable JSON: non-blocking error -> failed
  // (code.claude.com/docs/en/hooks#exit-code-output table: "JSON that can't be parsed ... | Any other exit code: Non-blocking error.").
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 1, '{ broken }'), { outcome: 'failed' });

  // T4.26: other non-zero failure. Codex parses JSON only on Some(0) (user_prompt_submit.rs:158-252);
  // Copilot parses stdout JSON only on exit 0 (hooks-reference#exit-codes-for-command-hooks).
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, ''), { outcome: 'failed' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 2, ''), { outcome: 'failed' });
  assert.deepEqual(classify('codex-cli', 'UserPromptSubmit', 1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'x' } })), { outcome: 'failed' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 1, JSON.stringify({ additionalContext: 'x' })), { outcome: 'failed' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 2, JSON.stringify({ additionalContext: 'x' })), { outcome: 'failed' });

  // T4.27: timeout, stopped, missing executable.
  assert.deepEqual(classify('claude-cli', 'SessionStart', 'timeout', '', { reason: 'timeout' }), { outcome: 'timeout' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 'timeout', '', { reason: 'aborted' }), { outcome: 'stopped' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 'missing', '', { reason: 'missing', program: 'no-such' }), { outcome: 'missing', program: 'no-such' });

  // Claude Code stdout that is not one JSON object (code.claude.com/docs/en/hooks#exit-code-0):
  // - "Output that doesn't start with `{`, or that starts with `{` and doesn't end with `}`: plain text. A JSON array and a quoted JSON string are plain text by this rule."
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '{a normal note'), { outcome: 'adds', added: '{a normal note' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '[]'), { outcome: 'adds', added: '[]' });
  // - "Two or more lines that each parse as JSON on their own, the first starting with `{` and the last ending with `}`:
  //    plain text when no line is a JSON output object that sets a field. When one line is, the output is a parse failure"
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '{}\n{}'), { outcome: 'adds', added: '{}\n{}' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '{}\n{"systemMessage":"hi"}'), { outcome: 'not-added', detail: 'invalid-json' });
  // - "Anything else that starts with `{` and ends with `}` but isn't valid JSON: a parse failure."
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '{ broken }'), { outcome: 'not-added', detail: 'invalid-json' });

  // Catch-all 'not-added': JSON without context, JSON blocks, mismatched hookEventName, Codex invalid JSON-looking, Codex prompt exit 2 (including with JSON), overflow, spawn error.
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '{}'), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ systemMessage: 'hi' })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ additionalContext: 'top level only' })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ hookSpecificOutput: { additionalContext: '' } })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'wrong event' } })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 0, JSON.stringify({ decision: 'block', reason: 'stop', hookSpecificOutput: { additionalContext: 'also' } })), { outcome: 'not-added', detail: 'json-block' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, JSON.stringify({ continue: false, stopReason: 'halt' })), { outcome: 'not-added', detail: 'json-block' });
  // Codex looks_like_json treats brace- or bracket-prefixed output as JSON (codex-rs/hooks/src/engine/output_parser.rs:321-339).
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, '{ broken json'), { outcome: 'not-added', detail: 'invalid-json' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, '{}\n{}'), { outcome: 'not-added', detail: 'invalid-json' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, '[ready] loaded instructions\n'), { outcome: 'not-added', detail: 'invalid-json' });
  assert.deepEqual(classify('codex-cli', 'UserPromptSubmit', 0, '["one","two"]\n'), { outcome: 'not-added', detail: 'invalid-json' });
  // Intentional cut: a JSON object carrying additionalContext is treated as added without judging other fields' types.
  assert.deepEqual(
    classify('claude-cli', 'UserPromptSubmit', 0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'nested' }, systemMessage: false })),
    { outcome: 'adds', added: 'nested' },
  );
  assert.deepEqual(classify('codex-cli', 'UserPromptSubmit', 2, ''), { outcome: 'not-added', detail: 'codex-prompt-exit-2' });
  assert.deepEqual(
    classify('codex-cli', 'UserPromptSubmit', 2, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'ignored' } })),
    { outcome: 'not-added', detail: 'codex-prompt-exit-2' },
  );
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, 'huge', { reason: 'overflow' }), { outcome: 'not-added', detail: 'overflow' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, '', { reason: 'error', spawnError: 'EACCES' }), { outcome: 'not-added', detail: 'spawn-error', problem: 'EACCES' });
  // Signal termination has no exit code and reports the signal (Codex user_prompt_submit.rs:253: "hook exited without a status code"; Claude/Copilot pages are silent beyond non-zero failure).
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, 'partial', { signal: 'SIGTERM' }), { outcome: 'failed', signal: 'SIGTERM' });

  // Tool context limits: exact boundary passes without overLimit; 1 past carries overLimit AND whole text.
  const claudeAt = 'a'.repeat(10_000), claudeOver = 'a'.repeat(10_001);
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, claudeAt), { outcome: 'adds', added: claudeAt });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, claudeOver), { outcome: 'adds', added: claudeOver, overLimit: { limit: 10_000, unit: 'chars' } });
  const codexAt = 'b'.repeat(10_000), codexOver = 'b'.repeat(10_001);
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, codexAt), { outcome: 'adds', added: codexAt });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, codexOver), { outcome: 'adds', added: codexOver, overLimit: { limit: 2_500, unit: 'tokens' } });
});

test('Pure helpers: start matcher picking and timeout capping', () => {
  assert.equal(pickStartSource('claude-cli', undefined), 'startup');
  assert.equal(pickStartSource('claude-cli', '*'), 'startup');
  assert.equal(pickStartSource('claude-cli', 'resume|compact'), 'resume');
  assert.equal(pickStartSource('claude-cli', 'compact'), 'compact');
  assert.equal(pickStartSource('claude-cli', 'start.*'), 'startup');
  assert.equal(pickStartSource('claude-cli', 'unmatched-only'), undefined);
  assert.equal(pickStartSource('copilot-cli', 'unmatched-only'), 'startup');

  assert.equal(hookTimeoutSec('claude-cli', false, undefined), 60);
  assert.equal(hookTimeoutSec('claude-cli', true, undefined), 30);
  assert.equal(hookTimeoutSec('codex-cli', false, undefined), 60);
  assert.equal(hookTimeoutSec('codex-cli', true, undefined), 60);
  assert.equal(hookTimeoutSec('copilot-cli', false, undefined), 30);
  assert.equal(hookTimeoutSec('claude-cli', false, 120), 60);
  assert.equal(hookTimeoutSec('claude-cli', false, 15), 15);
  assert.equal(hookTimeoutSec('claude-cli', true, 0), 30);
  assert.equal(hookTimeoutSec('claude-cli', true, -5), 30);
});

test('Gates and refusals: wrong home mode, Windows, uninstalled tool, plugin hooks, changed/removed/disabled/unsupported hooks, and concurrent runs', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['claude']);
  try {
    const marker = join(box.base, 'ran.marker');
    const settings = join(box.home, '.claude/settings.json');
    await put(settings, JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: `echo ran >> ${JSON.stringify(marker)} && echo hi` }] },
          { matcher: 'never-matches', hooks: [{ type: 'command', command: `echo bad >> ${JSON.stringify(marker)}` }] },
          { matcher: 'startup', hooks: [{ type: 'command', command: `echo ps >> ${JSON.stringify(marker)}`, shell: 'powershell' }] },
        ],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `echo pre >> ${JSON.stringify(marker)}` }] }],
      },
    }));
    const ref = await box.ownRef('claude-cli', 0);

    // Non-actual home refused.
    for (const mode of ['custom', 'fixture'] as const) {
      const res = await runHook(box.ctx({ mode }), ref);
      assert.equal(res.outcome, 'refused');
      assert.match(res.problem ?? '', /this computer’s home/);
    }
    // Windows refused.
    const winRes = await runHook(box.ctx({ platform: 'win32' }), ref);
    assert.equal(winRes.outcome, 'refused');
    assert.match(winRes.problem ?? '', /Windows/);
    // Unmatched installed plugin ref, Copilot CLI installed plugin ref, and marketplace ref are refused.
    const pluginRef: HookSourceRef = { from: 'installed', tool: 'claude-cli', plugin: 'p', marketName: 'm', declaredIn: '/x', event: 'SessionStart', at: 0, command: 'echo x', fingerprint: 'fp' };
    assert.equal((await runHook(box.ctx(), pluginRef)).outcome, 'refused');
    const copilotPluginRef: HookSourceRef = { from: 'installed', tool: 'copilot-cli', plugin: 'p', marketName: 'm', declaredIn: '/x', event: 'sessionStart', at: 0, command: 'echo x', fingerprint: 'fp' };
    const copilotPluginRes = await runHook(box.ctx(), copilotPluginRef);
    assert.equal(copilotPluginRes.outcome, 'refused');
    assert.equal(copilotPluginRes.problem, 'Copilot CLI plugin hooks aren’t supported here.');
    const marketRef: HookSourceRef = { from: 'marketplace', plugin: 'p', marketName: 'm', declaredIn: '/x', event: 'SessionStart', at: 0, command: 'echo x', fingerprint: 'fp' };
    const marketRes = await runHook(box.ctx(), marketRef);
    assert.equal(marketRes.outcome, 'refused');
    assert.equal(marketRes.problem, 'Marketplace hooks aren’t run.');
    // Uninstalled tool refused (codex not installed in this sandbox).
    await put(join(box.home, '.codex/hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo codex >> ${JSON.stringify(marker)}` }] }] } }));
    const codexRef = await box.ownRef('codex-cli', 0);
    const missingTool = await runHook(box.ctx(), codexRef);
    assert.equal(missingTool.outcome, 'refused');
    assert.match(missingTool.problem ?? '', /Not installed here/);
    // Unmatched start matcher, unsupported Claude shell, non-text event refused.
    assert.equal((await runHook(box.ctx(), await box.ownRef('claude-cli', 1))).outcome, 'refused');
    assert.equal((await runHook(box.ctx(), await box.ownRef('claude-cli', 2))).outcome, 'refused');
    const preRef: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: settings, event: 'PreToolUse', at: 0, command: `echo pre >> ${JSON.stringify(marker)}`, fingerprint: 'fp' };
    assert.equal((await runHook(box.ctx(), preRef)).outcome, 'refused');

    // disableAllHooks: View source still reads it, Run it refuses.
    await put(settings, JSON.stringify({
      disableAllHooks: true,
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: `echo ran >> ${JSON.stringify(marker)} && echo hi` }] }] },
    }));
    const srcDisabled = await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, ref);
    assert.equal(srcDisabled.problem, undefined);
    const runDisabled = await runHook(box.ctx(), ref);
    assert.equal(runDisabled.outcome, 'refused');
    assert.match(runDisabled.problem ?? '', /disableAllHooks/);

    // Changed on disk between page read and click: same refusal words as readHookSource!
    await put(settings, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo inserted' }, { type: 'command', command: `echo ran >> ${JSON.stringify(marker)} && echo hi` }] }] },
    }));
    const movedSrc = await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, ref);
    const movedRun = await runHook(box.ctx(), ref);
    assert.equal(movedRun.outcome, 'refused');
    assert.equal(movedRun.problem, movedSrc.problem);

    // Removed hook: same refusal words as readHookSource.
    await put(settings, JSON.stringify({ hooks: {} }));
    const goneSrc = await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, ref);
    const goneRun = await runHook(box.ctx(), ref);
    assert.equal(goneRun.outcome, 'refused');
    assert.equal(goneRun.problem, goneSrc.problem);

    // Non-command hook with stray command field stays listed on pages (launch preserved), but runHook refuses it.
    await put(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'prompt', command: `echo stray >> ${JSON.stringify(marker)}` }] }] } }));
    const promptStrip = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(box.home, '.claude')));
    assert.equal(promptStrip?.groups[0]?.hooks.length, 1, 'non-command entry with command stays listed on Instructions');
    assert.equal(promptStrip?.groups[0]?.hooks[0]?.command, `echo stray >> ${JSON.stringify(marker)}`);
    const strayRef = promptStrip!.groups[0]!.hooks[0]!.source;
    const strayRun = await runHook(box.ctx(), strayRef);
    assert.equal(strayRun.outcome, 'refused');
    assert.match(strayRun.problem ?? '', /not a command hook/i);

    // Codex [features] hooks = false (and deprecated alias codex_hooks = false): View source reads it, runHook refuses it.
    const codexBox = await sandbox(['codex']);
    try {
      const codexMarker = join(codexBox.base, 'codex-off.marker');
      await put(join(codexBox.home, '.codex/hooks.json'), JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo ran > ${JSON.stringify(codexMarker)}` }] }] },
      }));
      await put(join(codexBox.home, '.codex/config.toml'), '[features]\nhooks = false\n');
      const cRef = await codexBox.ownRef('codex-cli', 0);
      assert.equal((await readHookSource({ home: codexBox.home, mode: 'actual', dataDir: codexBox.data }, cRef)).problem, undefined);
      const offRes = await runHook(codexBox.ctx(), cRef);
      assert.equal(offRes.outcome, 'refused');
      assert.match(offRes.problem ?? '', /\[features\] hooks = false/);
      // Deprecated alias codex_hooks = false also disables hooks and names the key that was read.
      await put(join(codexBox.home, '.codex/config.toml'), '[features]\ncodex_hooks = false\n');
      const aliasRes = await runHook(codexBox.ctx(), cRef);
      assert.equal(aliasRes.outcome, 'refused');
      assert.match(aliasRes.problem ?? '', /\[features\] codex_hooks = false/);
      assert.doesNotMatch(aliasRes.problem ?? '', /\bhooks = false/);
      await assert.rejects(stat(codexMarker), { code: 'ENOENT' }, 'disabled Codex hook did not execute');
      // Explicit hooks = true wins over deprecated codex_hooks = false.
      await put(join(codexBox.home, '.codex/config.toml'), '[features]\nhooks = true\ncodex_hooks = false\n');
      assert.equal((await runHook(codexBox.ctx(), cRef)).outcome, 'empty');
      assert.equal(await readFile(codexMarker, 'utf8'), 'ran\n');
    } finally { await codexBox.done(); }

    // Marker file was never written by any of the refused calls above.
    await assert.rejects(stat(marker), { code: 'ENOENT' });

    // Concurrent runs of one hook: second is refused while first runs, succeeds after first finishes.
    const started = join(box.base, 'started.flag');
    const release = join(box.base, 'release.flag');
    await put(settings, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${JSON.stringify(started)}; while [ ! -f ${JSON.stringify(release)} ]; do sleep 0.05; done; echo done` }] }] },
    }));
    const concRef = await box.ownRef('claude-cli', 0);
    const first = runHook(box.ctx(), concRef);
    await until(async () => stat(started).then(() => true, () => false));
    const second = await runHook(box.ctx(), concRef);
    assert.equal(second.outcome, 'refused');
    assert.match(second.problem ?? '', /already running/i);
    await writeFile(release, 'go');
    assert.equal((await first).outcome, 'adds');
    assert.equal((await runHook(box.ctx(), concRef)).outcome, 'adds');
  } finally { await box.done(); }
});

test('Timeout, Stop, process-group cleanup, bounded drain, missing program, overflow and spawn error', { skip: unixSkip, timeout: 20_000 }, async () => {
  const box = await sandbox(['claude']);
  try {
    const pidFile = join(box.base, 'child.pid');
    const settings = join(box.home, '.claude/settings.json');
    const nonExec = join(box.home, 'bin/not-exec.sh');
    await put(nonExec, '#!/bin/sh\necho hi\n', 0o644);
    await put(settings, JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [
            { type: 'command', command: `sleep 300 & echo $! > ${JSON.stringify(pidFile)}; wait`, timeout: 0.4 },
            { type: 'command', command: `sleep 300 & echo $! > ${JSON.stringify(pidFile)}; wait`, timeout: 30 },
            { type: 'command', command: `(sleep 300) & echo $! > ${JSON.stringify(pidFile)}; echo "before-bg"; exit 0` },
            { type: 'command', command: '/no/such/program-ck-hookrun', args: [] },
            { type: 'command', command: nonExec, args: [] },
            { type: 'command', command: `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(8192))"` },
          ],
        }],
      },
    }));

    // 1. Timeout kills child process group.
    const tRef = await box.ownRef('claude-cli', 0);
    const tRes = await runHook(box.ctx(), tRef);
    assert.equal(tRes.outcome, 'timeout');
    assert.equal(tRes.limitSec, 0.4);
    assert.equal(tRes.exitCode, undefined);
    const tPid = Number((await readFile(pidFile, 'utf8')).trim());
    await until(async () => !isRunning(tPid));
    assert.equal(isRunning(tPid), false, 'timed-out hook child process was killed');
    await rm(pidFile, { force: true });

    // 2. Stop kills child process group.
    const sRef = await box.ownRef('claude-cli', 1);
    const running = runHook(box.ctx(), sRef);
    await until(async () => !!(await readFile(pidFile, 'utf8').catch(() => '')).trim());
    assert.equal(stopHookRun(box.home, sRef), true);
    const sRes = await running;
    assert.equal(sRes.outcome, 'stopped');
    assert.equal(sRes.exitCode, undefined);
    const sPid = Number((await readFile(pidFile, 'utf8')).trim());
    await until(async () => !isRunning(sPid));
    assert.equal(isRunning(sPid), false, 'stopped hook child process was killed');
    await rm(pidFile, { force: true });

    // 3. Background child holding stdout open ends after bounded drainMs and is killed.
    const dRef = await box.ownRef('claude-cli', 2);
    const dRes = await runHook(box.ctx({ drainMs: 250 }), dRef);
    assert.equal(dRes.outcome, 'adds');
    assert.equal(dRes.added, 'before-bg\n');
    const dPid = Number((await readFile(pidFile, 'utf8')).trim());
    await until(async () => !isRunning(dPid));
    assert.equal(isRunning(dPid), false, 'lingering background child killed after bounded drain');

    // 4. Missing executable in direct-exec form.
    const mRef = await box.ownRef('claude-cli', 3);
    const mRes = await runHook(box.ctx(), mRef);
    assert.equal(mRes.outcome, 'missing');
    assert.equal(mRes.program, '/no/such/program-ck-hookrun');

    // 5. Other spawn error (non-executable file -> EACCES).
    const eRef = await box.ownRef('claude-cli', 4);
    const eRes = await runHook(box.ctx(), eRef);
    assert.equal(eRes.outcome, 'not-added');
    assert.equal(eRes.detail, 'spawn-error');

    // 6. Output overflow -> not-added ('overflow') with capped output kept.
    const oRef = await box.ownRef('claude-cli', 5);
    const oRes = await runHook(box.ctx({ maxBytes: 1024 }), oRef);
    assert.equal(oRes.outcome, 'not-added');
    assert.equal(oRes.detail, 'overflow');
    assert.equal(oRes.allPrinted.length, 1024);
  } finally { await box.done(); }
});

test('Nothing in main.ts starts a hook run except the one hook:run channel', async () => {
  const main = await readFile(join(import.meta.dirname, '../src/main.ts'), 'utf8');
  const calls = [...main.matchAll(/\brunHook\s*\(/g)];
  assert.equal(calls.length, 1, 'runHook is called in exactly one place in main.ts');
  const start = main.lastIndexOf("handleNow('hook:run'", calls[0]!.index);
  assert.ok(start >= 0 && calls[0]!.index - start < 600, 'the sole runHook call lives inside handleNow(\'hook:run\', …)');
});

test('Fix list checks: signal exit, plugins.ts sync throw rejection, Codex disabled, non-command display, and shared start sources', { skip: unixSkip, timeout: 15_000 }, async t => {
  await t.test('Item 1 (signal): a hook killed by SIGTERM reports signal with no exitCode', async () => {
    const box = await sandbox(['claude']);
    try {
      await put(join(box.home, '.claude/settings.json'), JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: process.execPath, args: ['-e', "process.stdout.write('partial'); process.kill(process.pid, 'SIGTERM')"] }] }] },
      }));
      const sigRes = await runHook(box.ctx(), await box.ownRef('claude-cli', 0));
      assert.equal(sigRes.outcome, 'failed');
      assert.equal(sigRes.exitCode, undefined);
      assert.equal(sigRes.signal, 'SIGTERM');
    } finally { await box.done(); }
  });

  await t.test('Item 2 (Codex [features] hooks = false): refused while View source still reads it', async () => {
    const box = await sandbox(['codex']);
    try {
      const marker = join(box.base, 'codex-off-2.marker');
      await put(join(box.home, '.codex/hooks.json'), JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo ran > ${JSON.stringify(marker)}` }] }] },
      }));
      await put(join(box.home, '.codex/config.toml'), '[features]\nhooks = false\n');
      const ref = await box.ownRef('codex-cli', 0);
      assert.equal((await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, ref)).problem, undefined);
      const res = await runHook(box.ctx(), ref);
      assert.equal(res.outcome, 'refused');
      assert.match(res.problem ?? '', /\[features\] hooks = false/);
      await assert.rejects(stat(marker), { code: 'ENOENT' });
    } finally { await box.done(); }
  });

  await t.test('Item 3 (plugins.ts run): non-hook callers reject on sync start throw and keep next’s abort-over-missing precedence; catchStart resolves reason error', async () => {
    await assert.rejects(() => run('echo', ['bad\0arg'], { timeoutMs: 5_000 }));
    const caught = await run('echo', ['bad\0arg'], { timeoutMs: 5_000, catchStart: true });
    assert.equal(caught.reason, 'error');
    assert.ok(caught.spawnError);
    const abort = new AbortController();
    abort.abort();
    const missingAborted = await run('/no/such/program-ck-aborted', [], { timeoutMs: 5_000, signal: abort.signal });
    assert.equal(missingAborted.code, 'timeout');
    assert.equal(missingAborted.reason, 'aborted');
  });

  await t.test('Item 4 (catalogdetail.ts): non-command hook with command stays listed on pages, refused at run', async () => {
    const box = await sandbox(['claude']);
    try {
      const marker = join(box.base, 'stray-4.marker');
      await put(join(box.home, '.claude/settings.json'), JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'prompt', command: `echo stray > ${JSON.stringify(marker)}` }] }] },
      }));
      const strip = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(box.home, '.claude')));
      assert.equal(strip?.groups[0]?.hooks.length, 1);
      const res = await runHook(box.ctx(), strip!.groups[0]!.hooks[0]!.source);
      assert.equal(res.outcome, 'refused');
      assert.match(res.problem ?? '', /not a command hook/i);
      await assert.rejects(stat(marker), { code: 'ENOENT' });
    } finally { await box.done(); }
  });

  await t.test('Item 5 (pluginoutcomes.ts): start-of-session sources live in one home alongside whenItRuns', async () => {
    const outcomesMod = await import('../src/pluginoutcomes.ts') as Record<string, unknown>;
    assert.equal(typeof outcomesMod.pickStartSource, 'function', 'pluginoutcomes.ts exports pickStartSource');
    const hookrunSrc = await readFile(join(import.meta.dirname, '../src/hookrun.ts'), 'utf8');
    assert.equal(hookrunSrc.includes('START_SOURCES'), false, 'hookrun.ts does not duplicate START_SOURCES');
  });
});

test('Installed Claude Code plugin hook runs from installed copy with CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA (created on first use) and declared option', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['claude']);
  try {
    const marketCopy = join(box.base, 'market/plugins/helper');
    const installPath = join(box.home, '.claude/plugins/cache/team.tools/helper/1.0.0');
    const expectedData = join(box.home, '.claude/plugins/data/helper-team-tools');
    await put(join(marketCopy, 'hooks/hello.sh'), '#!/bin/sh\necho "WRONG_MARKETPLACE_COPY"\n', 0o755);
    await put(join(installPath, '.claude-plugin/plugin.json'), JSON.stringify({
      name: 'helper',
      version: '1.0.0',
      userConfig: {
        greeting: { description: 'Greeting text', default: 'default-hi' },
        retries: { type: 'number', default: 3 },
        strict: { type: 'boolean', default: true },
        prefix: { type: 'string', default: 'x' },
      },
    }));
    await put(join(installPath, 'hooks/hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/hello.sh' }] }] },
    }));
    await put(join(installPath, 'hooks/hello.sh'), '#!/bin/sh\nprintf "root=%s\\ndata=%s\\ngreeting=%s\\nretries=%s\\nstrict=%s\\nprefix=[%s]\\n" "$CLAUDE_PLUGIN_ROOT" "$CLAUDE_PLUGIN_DATA" "$CLAUDE_PLUGIN_OPTION_GREETING" "$CLAUDE_PLUGIN_OPTION_RETRIES" "$CLAUDE_PLUGIN_OPTION_STRICT" "$CLAUDE_PLUGIN_OPTION_PREFIX"\n', 0o755);
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'helper@team.tools': [{ scope: 'user', installPath, version: '1.0.0' }] },
    }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      pluginConfigs: {
        'helper@team.tools': {
          options: { greeting: 'hello-team', retries: 0, strict: false, prefix: '' },
        },
      },
    }));

    const items = await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['claude-cli']);
    const strip = sessionStrip('claude-cli', items, {})!;
    const ref = strip.groups[0]!.hooks[0]!.source;
    await assert.rejects(stat(expectedData), { code: 'ENOENT' }, 'data folder absent before first use');

    const res = await runHook(box.ctx(), ref);
    assert.equal(res.outcome, 'adds');
    assert.equal(res.missingOptions, undefined);
    assert.equal(res.added, `root=${installPath}\ndata=${expectedData}\ngreeting=hello-team\nretries=0\nstrict=false\nprefix=[]\n`);
    assert.equal((await stat(expectedData)).isDirectory(), true, 'Claude Code data folder created on first use');

    // Data folder creation failure (a file blocks the data folder path) refuses cleanly.
    const blockedInstall = join(box.home, '.claude/plugins/cache/team.tools/blocked/1.0.0');
    const blockedData = join(box.home, '.claude/plugins/data/blocked-team-tools');
    await put(join(blockedInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo should-not-run' }] }] },
    }));
    await put(blockedData, 'not-a-directory');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'helper@team.tools': [{ scope: 'user', installPath, version: '1.0.0' }],
        'blocked@team.tools': [{ scope: 'user', installPath: blockedInstall, version: '1.0.0' }],
      },
    }));
    const blockedItems = await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['claude-cli']);
    const blockedRef = sessionStrip('claude-cli', blockedItems, {})!.groups.find(g => g.name === 'blocked')!.hooks[0]!.source;
    const blockedRes = await runHook(box.ctx(), blockedRef);
    assert.equal(blockedRes.outcome, 'refused');
    assert.equal(blockedRes.problem, 'Couldn’t create the plugin’s data folder.');
  } finally { await box.done(); }
});

test('Installed Codex plugin hook substitutes all four braced variables, exports them in env, and does not create its data folder', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['codex']);
  try {
    const installPath = join(box.home, '.codex/plugins/cache/team.tools/helper/1.0.0');
    const expectedData = join(box.home, '.codex/plugins/data/helper-team.tools');
    await put(join(installPath, 'hooks/hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: '${PLUGIN_ROOT}/hooks/hello.sh "${CLAUDE_PLUGIN_ROOT}" "${PLUGIN_DATA}" "${CLAUDE_PLUGIN_DATA}"' }],
        }],
      },
    }));
    await put(join(installPath, 'hooks/hello.sh'), '#!/bin/sh\nprintf "args=%s|%s|%s\\nenv=%s|%s|%s|%s\\n" "$1" "$2" "$3" "$PLUGIN_ROOT" "$CLAUDE_PLUGIN_ROOT" "$PLUGIN_DATA" "$CLAUDE_PLUGIN_DATA"\n', 0o755);
    await put(join(box.home, '.codex/config.toml'), '[features]\nhooks = true\n\n[plugins."helper@team.tools"]\nenabled = true\n');

    const items = await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['codex-cli']);
    const ref = sessionStrip('codex-cli', items, {})!.groups[0]!.hooks[0]!.source;
    await assert.rejects(stat(expectedData), { code: 'ENOENT' }, 'Codex data folder absent before run');

    const res = await runHook(box.ctx(), ref);
    assert.equal(res.outcome, 'adds');
    assert.equal(res.added, `args=${installPath}|${expectedData}|${expectedData}\nenv=${installPath}|${installPath}|${expectedData}|${expectedData}`);
    await assert.rejects(stat(expectedData), { code: 'ENOENT' }, 'Codex data folder stays absent after run');
  } finally { await box.done(); }
});

test('Installed plugin refusals: turned off in tool, tool hooks disabled after render, and changed declaration timeout', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['claude', 'codex']);
  try {
    const marker = join(box.base, 'plugin-refused.marker');
    const claudeInstall = join(box.home, '.claude/plugins/cache/team/ReleaseHelper/1.0.0');
    const claudeData = join(box.home, '.claude/plugins/data/ReleaseHelper-team');
    const claudeHooks = join(claudeInstall, 'hooks/hooks.json');
    await put(claudeHooks, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: `echo ran >> ${JSON.stringify(marker)} && echo hi`, timeout: 10 }] }] },
    }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'ReleaseHelper@team': [{ scope: 'user', installPath: claudeInstall, version: '1.0.0' }] },
    }));
    const claudeRef = sessionStrip('claude-cli', await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['claude-cli']), {})!.groups[0]!.hooks[0]!.source;

    // 1. Plugin turned off in Claude Code after page read: View source still works, Run it refuses, no marker, no data dir.
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ReleaseHelper@team': false } }));
    assert.equal((await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, claudeRef)).problem, undefined);
    const claudeOff = await runHook(box.ctx(), claudeRef);
    assert.equal(claudeOff.outcome, 'refused');
    assert.equal(claudeOff.problem, 'ReleaseHelper is turned off in Claude Code.');
    await assert.rejects(stat(claudeData), { code: 'ENOENT' });

    // 2. Claude Code disableAllHooks after page read: View source works, Run it refuses, no data dir.
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ disableAllHooks: true }));
    assert.equal((await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, claudeRef)).problem, undefined);
    const claudeDisabled = await runHook(box.ctx(), claudeRef);
    assert.equal(claudeDisabled.outcome, 'refused');
    assert.equal(claudeDisabled.problem, 'Hooks are turned off in Claude Code’s settings (disableAllHooks).');
    await assert.rejects(stat(claudeData), { code: 'ENOENT' });

    // 3. Declaration timeout edited in place: refused with changed-since-read message matching readHookSource.
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({}));
    await put(claudeHooks, JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: `echo ran >> ${JSON.stringify(marker)} && echo hi`, timeout: 25 }] }] },
    }));
    const changedSrc = await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, claudeRef);
    const changedRun = await runHook(box.ctx(), claudeRef);
    assert.equal(changedRun.outcome, 'refused');
    assert.equal(changedRun.problem, changedSrc.problem);
    assert.match(changedRun.problem ?? '', /changed since this page was read\. Refresh to see it\.$/);
    await assert.rejects(stat(claudeData), { code: 'ENOENT' });

    // 4. Codex: plugin turned off and tool hooks turned off after page read.
    const codexInstall = join(box.home, '.codex/plugins/cache/team/helper/1.0.0');
    await put(join(codexInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: `echo ran >> ${JSON.stringify(marker)} && echo hi` }] }] },
    }));
    await put(join(box.home, '.codex/config.toml'), '[features]\nhooks = true\n\n[plugins."helper@team"]\nenabled = true\n');
    const codexRef = sessionStrip('codex-cli', await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['codex-cli']), {})!.groups[0]!.hooks[0]!.source;

    await put(join(box.home, '.codex/config.toml'), '[features]\nhooks = true\n\n[plugins."helper@team"]\nenabled = false\n');
    assert.equal((await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, codexRef)).problem, undefined);
    const codexOff = await runHook(box.ctx(), codexRef);
    assert.equal(codexOff.outcome, 'refused');
    assert.equal(codexOff.problem, 'helper is turned off in Codex.');

    await put(join(box.home, '.codex/config.toml'), '[features]\nhooks = false\n\n[plugins."helper@team"]\nenabled = true\n');
    const codexHooksOff = await runHook(box.ctx(), codexRef);
    assert.equal(codexHooksOff.outcome, 'refused');
    assert.equal(codexHooksOff.problem, 'Hooks are turned off in Codex’s settings ([features] hooks = false).');

    await put(join(box.home, '.codex/config.toml'), '[features]\ncodex_hooks = false\n\n[plugins."helper@team"]\nenabled = true\n');
    const codexAliasOff = await runHook(box.ctx(), codexRef);
    assert.equal(codexAliasOff.outcome, 'refused');
    assert.equal(codexAliasOff.problem, 'Hooks are turned off in Codex’s settings ([features] codex_hooks = false).');

    await assert.rejects(stat(marker), { code: 'ENOENT' }, 'no refused plugin hook ever executed');
  } finally { await box.done(); }
});

test('Anthropic Directory plugin resolves View source and Run it; declared options without plain value flag missingOptions; ${user_config.} refused', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['claude']);
  try {
    // 1. Anthropic Directory plugin: View source and Run it both work.
    const dirInstall = join(box.home, '.claude/plugins/cache/anthropic-plugin-directory/dir-helper/2.0.0');
    const dirData = join(box.home, '.claude/plugins/data/dir-helper-anthropic-plugin-directory');
    await put(join(dirInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/run.sh' }] }] },
    }));
    await put(join(dirInstall, 'hooks/run.sh'), '#!/bin/sh\nprintf "dir=%s|%s\\n" "$CLAUDE_PLUGIN_ROOT" "$CLAUDE_PLUGIN_DATA"\n', 0o755);

    // 2. Plugin with declared options: one manifest default, one list-valued in settings.json, one unset (with stale env scrubbed), plus ${user_config.} hooks.
    const optInstall = join(box.home, '.claude/plugins/cache/team/opt-plug/1.0.0');
    const optData = join(box.home, '.claude/plugins/data/opt-plug-team');
    await put(join(optInstall, '.claude-plugin/plugin.json'), JSON.stringify({
      name: 'opt-plug',
      version: '1.0.0',
      userConfig: {
        mode: { description: 'Mode', default: 'fast' },
        tags: { description: 'List option' },
        api_key: { description: 'Stored elsewhere' },
      },
    }));
    await put(join(optInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [
            { type: 'command', command: 'printf "mode=%s|tags=[%s]|key=[%s]|stale=[%s]\\n" "$CLAUDE_PLUGIN_OPTION_MODE" "$CLAUDE_PLUGIN_OPTION_TAGS" "$CLAUDE_PLUGIN_OPTION_API_KEY" "$CLAUDE_PLUGIN_OPTION_API"' },
            { type: 'command', command: 'echo ${user_config.mode}' },
            { type: 'command', command: process.execPath, args: ['-e', 'console.log(process.argv[1])', '${user_config.mode}'] },
          ],
        }],
      },
    }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'dir-helper@anthropic-plugin-directory': [{ scope: 'user', installPath: dirInstall, version: '2.0.0' }],
        'opt-plug@team': [{ scope: 'user', installPath: optInstall, version: '1.0.0' }],
      },
    }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      pluginConfigs: { 'opt-plug@team': { options: { tags: ['a', 'b'] } } },
    }));

    const items = await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['claude-cli']);
    const strip = sessionStrip('claude-cli', items, {})!;
    const dirRef = strip.groups.find(g => g.name === 'dir-helper')!.hooks[0]!.source;
    const dirSrc = await readHookSource({ home: box.home, mode: 'actual', dataDir: box.data }, dirRef);
    assert.equal(dirSrc.problem, undefined);
    assert.match(dirSrc.script?.text ?? '', /dir=/);
    const dirRes = await runHook(box.ctx(), dirRef);
    assert.equal(dirRes.outcome, 'adds');
    assert.equal(dirRes.added, `dir=${dirInstall}|${dirData}\n`);

    const optHooks = strip.groups.find(g => g.name === 'opt-plug')!.hooks.map(h => h.source);
    // ${user_config.} in shell form and exec form both refused before creating data folder!
    const shellUc = await runHook(box.ctx(), optHooks[1]!);
    assert.equal(shellUc.outcome, 'refused');
    assert.equal(shellUc.problem, 'This hook’s command uses a plugin option, which isn’t supported here.');
    const execUc = await runHook(box.ctx(), optHooks[2]!);
    assert.equal(execUc.outcome, 'refused');
    assert.equal(execUc.problem, 'This hook’s command uses a plugin option, which isn’t supported here.');
    await assert.rejects(stat(optData), { code: 'ENOENT' }, 'data folder not created on ${user_config.} refusal');

    // Missing/list options: runs with manifest default, scrubs stale CLAUDE_PLUGIN_OPTION_API, sets missingOptions: true.
    const optRes = await runHook(box.ctx({ env: { ...box.baseEnv, CLAUDE_PLUGIN_OPTION_API_KEY: 'inherited-stale' } }), optHooks[0]!);
    assert.equal(optRes.outcome, 'adds');
    assert.equal(optRes.missingOptions, true);
    assert.equal(optRes.added, 'mode=fast|tags=[]|key=[]|stale=[]\n');
  } finally { await box.done(); }
});

test('Spaced install paths work in both shell and exec launch forms, and one plugin installed in two tools runs each tool’s own copy', { skip: unixSkip, timeout: 15_000 }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-hookrun-space dir-')));
  try {
    const home = join(base, 'my home');
    const tools = join(base, 'tools');
    const data = join(base, 'data');
    await mkdir(home, { recursive: true });
    await mkdir(join(tools, '.local/bin'), { recursive: true });
    for (const bin of ['claude', 'codex']) await standIn(join(tools, '.local/bin', bin), '#!/bin/sh\necho "1.0.0"\n', 'console.log("1.0.0");');

    // Same plugin installed in Claude Code and Codex, inside a home path containing a space.
    const claudeInstall = join(home, '.claude/plugins/cache/team/dual/1.0.0');
    const claudeData = join(home, '.claude/plugins/data/dual-team');
    const codexInstall = join(home, '.codex/plugins/cache/team/dual/1.0.0');
    const codexData = join(home, '.codex/plugins/data/dual-team');
    await put(join(claudeInstall, 'hooks/hello.sh'), '#!/bin/sh\nprintf "claude-shell|%s|%s\\n" "$1" "$2"\n', 0o755);
    await put(join(claudeInstall, 'hooks/exec.mjs'), 'console.log(`claude-exec|${process.argv.slice(2).length}|${process.argv[2]}|${process.argv[3]}`);\n');
    await put(join(claudeInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [
            { type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/hello.sh" "${CLAUDE_PLUGIN_DATA}" "${CLAUDE_PROJECT_DIR}"' },
            { type: 'command', command: process.execPath, args: ['${CLAUDE_PLUGIN_ROOT}/hooks/exec.mjs', '${CLAUDE_PLUGIN_DATA}', '${CLAUDE_PLUGIN_ROOT}'] },
            { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/hello.sh', args: ['${CLAUDE_PLUGIN_DATA}', '${CLAUDE_PROJECT_DIR}'] },
          ],
        }],
      },
    }));
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'dual@team': [{ scope: 'user', installPath: claudeInstall, version: '1.0.0' }] },
    }));

    await put(join(codexInstall, 'hooks/hello.sh'), '#!/bin/sh\nprintf "codex-copy|%s|%s\\n" "$1" "$2"\n', 0o755);
    await put(join(codexInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: '"${PLUGIN_ROOT}/hooks/hello.sh" "${PLUGIN_DATA}" "${CLAUDE_PLUGIN_ROOT}"' }],
        }],
      },
    }));
    await put(join(home, '.codex/config.toml'), '[features]\nhooks = true\n\n[plugins."dual@team"]\nenabled = true\n');

    const ctx: HookRunContext = {
      home, mode: 'actual', dataDir: data, toolsHome: tools, searchPath: process.env.PATH ?? '/usr/bin:/bin',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home },
    };
    const items = await readPluginItems({ home, dataDir: data, binaries: {} }, ['claude-cli', 'codex-cli']);
    const claudeHooks = sessionStrip('claude-cli', items, {})!.groups[0]!.hooks.map(h => h.source);
    const codexHook = sessionStrip('codex-cli', items, {})!.groups[0]!.hooks[0]!.source;

    const shellRes = await runHook(ctx, claudeHooks[0]!);
    assert.equal(shellRes.outcome, 'adds');
    assert.equal(shellRes.added, `claude-shell|${claudeData}|${home}\n`);

    const execNodeRes = await runHook(ctx, claudeHooks[1]!);
    assert.equal(execNodeRes.outcome, 'adds');
    assert.equal(execNodeRes.added, `claude-exec|2|${claudeData}|${claudeInstall}\n`);

    const execProgRes = await runHook(ctx, claudeHooks[2]!);
    assert.equal(execProgRes.outcome, 'adds');
    assert.equal(execProgRes.added, `claude-shell|${claudeData}|${home}\n`);

    const codexRes = await runHook(ctx, codexHook);
    assert.equal(codexRes.outcome, 'adds');
    assert.equal(codexRes.added, `codex-copy|${codexData}|${codexInstall}`);
    await assert.rejects(stat(codexData), { code: 'ENOENT' }, 'Codex data folder stays absent even when Claude created its own');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Codex top-level dotted and inline-table features.hooks / features.codex_hooks disable hooks in sessionSettings and refuse plugin Run it', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['codex']);
  try {
    const codexDir = join(box.home, '.codex');
    const codexConfig = join(codexDir, 'config.toml');
    const marker = join(box.base, 'codex-dotted.marker');
    const codexInstall = join(codexDir, 'plugins/cache/team/helper/1.0.0');
    await put(join(codexInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: `echo ran >> ${JSON.stringify(marker)} && echo dotted-ran` }] }] },
    }));
    await put(codexConfig, 'features.hooks = true\n\n[plugins."helper@team"]\nenabled = true\n');
    const ref = sessionStrip('codex-cli', await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['codex-cli']), {})!.groups[0]!.hooks[0]!.source;

    // Reader checks: top-level dotted features.hooks, features.codex_hooks, boolean hooks precedence, and unrelated table ignored.
    await put(codexConfig, 'features.hooks = false\n\n[plugins."helper@team"]\nenabled = true\n');
    assert.equal((await sessionSettings('codex-cli', codexDir)).ownHooksDisabled, '[features] hooks = false');

    // Run check (exact break-it pass sequence): clicking Run it refuses and writes no marker.
    const refusedHooks = await runHook(box.ctx(), ref);
    assert.equal(refusedHooks.outcome, 'refused');
    assert.equal(refusedHooks.problem, 'Hooks are turned off in Codex’s settings ([features] hooks = false).');
    await assert.rejects(stat(marker), { code: 'ENOENT' });

    await put(codexConfig, 'features.codex_hooks = false\n\n[plugins."helper@team"]\nenabled = true\n');
    assert.equal((await sessionSettings('codex-cli', codexDir)).ownHooksDisabled, '[features] codex_hooks = false');
    const refusedAlias = await runHook(box.ctx(), ref);
    assert.equal(refusedAlias.outcome, 'refused');
    assert.equal(refusedAlias.problem, 'Hooks are turned off in Codex’s settings ([features] codex_hooks = false).');
    await assert.rejects(stat(marker), { code: 'ENOENT' });

    // Inline table at the top: features = { hooks = false }, features = { codex_hooks = false }, and boolean hooks precedence.
    await put(codexConfig, 'features = { hooks = false }\n\n[plugins."helper@team"]\nenabled = true\n');
    assert.equal((await sessionSettings('codex-cli', codexDir)).ownHooksDisabled, '[features] hooks = false');
    const refusedInlineHooks = await runHook(box.ctx(), ref);
    assert.equal(refusedInlineHooks.outcome, 'refused');
    assert.equal(refusedInlineHooks.problem, 'Hooks are turned off in Codex’s settings ([features] hooks = false).');
    await assert.rejects(stat(marker), { code: 'ENOENT' });

    await put(codexConfig, 'features = { codex_hooks = false }\n\n[plugins."helper@team"]\nenabled = true\n');
    assert.equal((await sessionSettings('codex-cli', codexDir)).ownHooksDisabled, '[features] codex_hooks = false');
    const refusedInlineAlias = await runHook(box.ctx(), ref);
    assert.equal(refusedInlineAlias.outcome, 'refused');
    assert.equal(refusedInlineAlias.problem, 'Hooks are turned off in Codex’s settings ([features] codex_hooks = false).');
    await assert.rejects(stat(marker), { code: 'ENOENT' });

    await put(codexConfig, 'features = { hooks = true, codex_hooks = false }\n\n[plugins."helper@team"]\nenabled = true\n');
    assert.equal((await sessionSettings('codex-cli', codexDir)).ownHooksDisabled, undefined);

    // Explicit boolean features.hooks = true overrides features.codex_hooks = false (and [features] codex_hooks = false).
    await put(codexConfig, 'features.hooks = true\nfeatures.codex_hooks = false\n\n[plugins."helper@team"]\nenabled = true\n');
    assert.equal((await sessionSettings('codex-cli', codexDir)).ownHooksDisabled, undefined);

    // Dotted key or inline table inside another table is not top-level features.hooks.
    await put(codexConfig, '[other]\nfeatures.hooks = false\nfeatures = { hooks = false }\n\n[plugins."helper@team"]\nenabled = true\n');
    assert.equal((await sessionSettings('codex-cli', codexDir)).ownHooksDisabled, undefined);
    const allowed = await runHook(box.ctx(), ref);
    assert.equal(allowed.outcome, 'adds');
    assert.equal(allowed.added, 'dotted-ran');
  } finally { await box.done(); }
});

test('Own Claude Code shell hook substitutes ${CLAUDE_PROJECT_DIR} as text; Codex plugin runs ${user_config.} as written; plugin options preserve false, 0 and empty string in both settings and manifest defaults', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['claude', 'codex']);
  try {
    // Own Claude Code shell hook: ${CLAUDE_PROJECT_DIR} is put into the shell line as text (even inside single quotes).
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: "echo '${CLAUDE_PROJECT_DIR}'" }] }] },
    }));
    const ownShellRes = await runHook(box.ctx(), await box.ownRef('claude-cli', 0));
    assert.equal(ownShellRes.outcome, 'adds');
    assert.equal(ownShellRes.added, `${box.home}\n`);

    // Codex plugin hook has no ${user_config.} placeholder and runs the command as written.
    const codexInstall = join(box.home, '.codex/plugins/cache/team/lit/1.0.0');
    await put(join(codexInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: "echo '${user_config.mode}'" }] }] },
    }));
    await put(join(box.home, '.codex/config.toml'), '[features]\nhooks = true\n\n[plugins."lit@team"]\nenabled = true\n');
    const codexRef = sessionStrip('codex-cli', await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['codex-cli']), {})!.groups[0]!.hooks[0]!.source;
    const codexLitRes = await runHook(box.ctx(), codexRef);
    assert.equal(codexLitRes.outcome, 'adds');
    assert.equal(codexLitRes.added, '${user_config.mode}');

    // Claude Code plugin options: false, 0 and empty string preserved from both settings.json and manifest defaults without setting missingOptions.
    const optInstall = join(box.home, '.claude/plugins/cache/team/falsy-opts/1.0.0');
    await put(join(optInstall, '.claude-plugin/plugin.json'), JSON.stringify({
      name: 'falsy-opts',
      version: '1.0.0',
      userConfig: {
        cfg_bool: { default: true },
        cfg_num: { default: 9 },
        cfg_str: { default: 'nonempty' },
        def_bool: { default: false },
        def_num: { default: 0 },
        def_str: { default: '' },
      },
    }));
    await put(join(optInstall, 'hooks/hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{
            type: 'command',
            command: `${JSON.stringify(process.execPath)} -e "const keys = ['CFG_BOOL','CFG_NUM','CFG_STR','DEF_BOOL','DEF_NUM','DEF_STR']; console.log(JSON.stringify(Object.fromEntries(keys.map(k => [k, process.env['CLAUDE_PLUGIN_OPTION_' + k]]))));"`,
          }],
        }],
      },
    }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'falsy-opts@team': [{ scope: 'user', installPath: optInstall, version: '1.0.0' }] },
    }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      pluginConfigs: {
        'falsy-opts@team': { options: { cfg_bool: false, cfg_num: 0, cfg_str: '' } },
      },
    }));
    const falsyRef = sessionStrip('claude-cli', await readPluginItems({ home: box.home, dataDir: box.data, binaries: {} }, ['claude-cli']), {})!.groups[0]!.hooks[0]!.source;
    const falsyRes = await runHook(box.ctx(), falsyRef);
    assert.equal(falsyRes.outcome, 'not-added');
    assert.equal(falsyRes.missingOptions, undefined);
    assert.deepEqual(JSON.parse(falsyRes.allPrinted), {
      CFG_BOOL: 'false',
      CFG_NUM: '0',
      CFG_STR: '',
      DEF_BOOL: 'false',
      DEF_NUM: '0',
      DEF_STR: '',
    });
  } finally { await box.done(); }
});

// Last in this file: Quit closes the door to new hook runs for the rest of the process, as it does for the app.
test('Quit aborts running hooks and pending runs before spawn, kills their children, removes temp files, and blocks further runs', { skip: unixSkip, timeout: 15_000 }, async () => {
  const box = await sandbox(['claude']);
  try {
    const pidFile = join(box.base, 'quit-child.pid');
    const envPathFile = join(box.base, 'quit-env-path.txt');
    const neverRan = join(box.base, 'never-ran.marker');
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [
            { type: 'command', command: `printf '%s' "$CLAUDE_ENV_FILE" > ${JSON.stringify(envPathFile)}; sleep 300 & echo $! > ${JSON.stringify(pidFile)}; wait` },
            { type: 'command', command: `echo ran > ${JSON.stringify(neverRan)}` },
          ],
        }],
      },
    }));
    const ref0 = await box.ownRef('claude-cli', 0);
    const ref1 = await box.ownRef('claude-cli', 1);
    const running = runHook(box.ctx(), ref0);
    await until(async () => !!(await readFile(pidFile, 'utf8').catch(() => '')).trim());

    // Second hook registered before a slow searchPath() wait: Quit must reach it before spawn!
    let releasePath!: (value: string) => void;
    const pending = runHook(box.ctx({ searchPath: () => new Promise(done => { releasePath = done; }) }), ref1);

    const first = stopHookRuns(), second = stopHookRuns();
    assert.ok(first && second, 'both Quits wait for active hook runs');
    releasePath(process.env.PATH ?? '/usr/bin:/bin');
    await second;

    const r0 = await running;
    const r1 = await pending;
    assert.equal(r0.outcome, 'stopped');
    assert.equal(r1.outcome, 'stopped');
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    await until(async () => !isRunning(pid));
    assert.equal(isRunning(pid), false, 'running hook child killed at Quit');
    const envPath = await readFile(envPathFile, 'utf8');
    await assert.rejects(stat(envPath), { code: 'ENOENT' }, 'throwaway CLAUDE_ENV_FILE removed at Quit');
    await assert.rejects(stat(neverRan), { code: 'ENOENT' }, 'pending hook never spawned after Quit');
    // Further runs refused after Quit.
    assert.equal((await runHook(box.ctx(), ref1)).outcome, 'refused');
  } finally { await box.done(); }
});
