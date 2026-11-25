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
import { hookTimeoutSec, pickStartSource, runHook, stopHookRun, stopHookRuns, whatHookWouldAdd, type HookRunContext } from '../src/hookrun.ts';
import { sessionSettings } from '../src/pluginitems.ts';
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
    assert.equal(startRes.added, 'Codex context\n');
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
    assert.equal(tomlRes.added, 'from-toml\n');
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
    whatHookWouldAdd({ tool, event, code, stdout, stderr: '', ...extra });

  // T4.22: exit 0, plain or valid nested context (Claude/Codex), top-level context (Copilot).
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, 'hello\n'), { outcome: 'adds', added: 'hello\n' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, 'hello\n'), { outcome: 'adds', added: 'hello\n' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ctx' } })), { outcome: 'adds', added: 'ctx' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ hookSpecificOutput: { additionalContext: 'ctx' } })), { outcome: 'adds', added: 'ctx' });
  assert.deepEqual(classify('codex-cli', 'UserPromptSubmit', 0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'codex ctx' } })), { outcome: 'adds', added: 'codex ctx' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, JSON.stringify({ additionalContext: 'copilot ctx' })), { outcome: 'adds', added: 'copilot ctx' });

  // T4.23: exit 0, empty stdout (never for non-empty JSON like {}).
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, ''), { outcome: 'empty' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, '   \n'), { outcome: 'empty' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, ''), { outcome: 'empty' });

  // T4.24: exit 0, Copilot CLI non-empty without usable top-level additionalContext.
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, 'plain text\n'), { outcome: 'copilot-ignored' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, JSON.stringify({ hookSpecificOutput: { additionalContext: 'wrong shape' } })), { outcome: 'copilot-ignored' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, '{}'), { outcome: 'copilot-ignored' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 0, JSON.stringify({ additionalContext: '' })), { outcome: 'copilot-ignored' });

  // T4.25: exit 2 from Claude Code start and prompt hooks.
  assert.deepEqual(classify('claude-cli', 'SessionStart', 2, '', { stderr: 'stderr line' }), { outcome: 'claude-exit-2' });
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 2, 'plain', { stderr: 'blocked!' }), { outcome: 'claude-exit-2' });

  // T4.26: other non-zero failure.
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, '', { stderr: 'boom' }), { outcome: 'failed' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 2, '', { stderr: 'boom' }), { outcome: 'failed' });
  assert.deepEqual(classify('copilot-cli', 'sessionStart', 2, '', { stderr: 'boom' }), { outcome: 'failed' });

  // T4.27: timeout, stopped, missing executable.
  assert.deepEqual(classify('claude-cli', 'SessionStart', 'timeout', '', { reason: 'timeout' }), { outcome: 'timeout' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 'timeout', '', { reason: 'aborted' }), { outcome: 'stopped' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 'missing', '', { reason: 'missing', program: 'no-such' }), { outcome: 'missing', program: 'no-such' });

  // Catch-all 'not-added': JSON without context, JSON blocks, mismatched hookEventName, invalid JSON-looking, non-zero JSON, Codex prompt exit 2, overflow, spawn error.
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '{}'), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ systemMessage: 'hi' })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ additionalContext: 'top level only' })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, JSON.stringify({ hookSpecificOutput: { additionalContext: '' } })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'wrong event' } })), { outcome: 'not-added', detail: 'json-no-context' });
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 0, JSON.stringify({ decision: 'block', reason: 'stop', hookSpecificOutput: { additionalContext: 'also' } })), { outcome: 'not-added', detail: 'json-block' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, JSON.stringify({ continue: false, stopReason: 'halt' })), { outcome: 'not-added', detail: 'json-block' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 0, '{ broken json'), { outcome: 'not-added', detail: 'invalid-json' });
  assert.deepEqual(classify('codex-cli', 'SessionStart', 0, '{}\n{}'), { outcome: 'not-added', detail: 'invalid-json' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, JSON.stringify({ continue: false })), { outcome: 'not-added', detail: 'nonzero-json' });
  assert.deepEqual(classify('claude-cli', 'UserPromptSubmit', 2, JSON.stringify({ decision: 'block' })), { outcome: 'not-added', detail: 'nonzero-json' });
  assert.deepEqual(classify('codex-cli', 'UserPromptSubmit', 2, '', { stderr: 'blocked in codex' }), { outcome: 'not-added', detail: 'codex-prompt-exit-2' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, 'huge', { reason: 'overflow' }), { outcome: 'not-added', detail: 'overflow' });
  assert.deepEqual(classify('claude-cli', 'SessionStart', 1, '', { reason: 'error', spawnError: 'EACCES' }), { outcome: 'not-added', detail: 'spawn-error', problem: 'EACCES' });

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
    // Plugin hooks refused in A1.
    const pluginRef: HookSourceRef = { from: 'installed', tool: 'claude-cli', plugin: 'p', marketName: 'm', declaredIn: '/x', event: 'SessionStart', at: 0, command: 'echo x' };
    assert.equal((await runHook(box.ctx(), pluginRef)).outcome, 'refused');
    const marketRef: HookSourceRef = { from: 'marketplace', plugin: 'p', marketName: 'm', declaredIn: '/x', event: 'SessionStart', at: 0, command: 'echo x' };
    assert.equal((await runHook(box.ctx(), marketRef)).outcome, 'refused');
    // Uninstalled tool refused (codex not installed in this sandbox).
    await put(join(box.home, '.codex/hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo codex >> ${JSON.stringify(marker)}` }] }] } }));
    const codexRef = await box.ownRef('codex-cli', 0);
    const missingTool = await runHook(box.ctx(), codexRef);
    assert.equal(missingTool.outcome, 'refused');
    assert.match(missingTool.problem ?? '', /Not installed here/);
    // Unmatched start matcher, unsupported Claude shell, non-text event refused.
    assert.equal((await runHook(box.ctx(), await box.ownRef('claude-cli', 1))).outcome, 'refused');
    assert.equal((await runHook(box.ctx(), await box.ownRef('claude-cli', 2))).outcome, 'refused');
    const preRef: HookSourceRef = { from: 'own', tool: 'claude-cli', declaredIn: settings, event: 'PreToolUse', at: 0, command: `echo pre >> ${JSON.stringify(marker)}` };
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

    // Non-command hook with stray command field is not classified as a command launch.
    await put(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'prompt', command: `echo stray >> ${JSON.stringify(marker)}` }] }] } }));
    const foundPrompt = await findHook({ home: box.home, mode: 'actual', dataDir: box.data }, { from: 'own', tool: 'claude-cli', declaredIn: settings, event: 'SessionStart', at: 0, command: '' });
    assert.equal('hook' in foundPrompt && foundPrompt.hook.launch, undefined);

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
