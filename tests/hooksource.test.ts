// Worked examples of reading a hook's source on click (hooksource.ts readHookSource, scriptInLaunch, parseHookRef):
// own hooks in Claude Code, Codex (hooks.json and config.toml) and Copilot CLI (settings.json and hooks/*.json),
// installed plugins' hooks and marketplace copies' hooks, inline hooks, script resolution rules, size and binary guards,
// missing/edited/unreadable files and path refusal. Nothing here runs a hook or touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHookRef, readHookSource, scriptInLaunch, type HookSourceContext } from '../src/hooksource.ts';
import { sessionSettings } from '../src/pluginitems.ts';
import { sessionStrip } from '../src/sessionhooks.ts';
import { slashPath } from './wincompat.ts';

const put = async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const makeCtx = (home: string, dataDir: string, mode: 'actual' | 'custom' = 'actual'): HookSourceContext => ({ home, mode, dataDir });

test('Example 1: own Claude Code hook with ~/… script returns the declaring file, exact entry and script text', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hooksrc-'));
  try {
    const home = join(base, 'home');
    const settings = join(home, '.claude', 'settings.json');
    const script = join(home, 'bin', 'session-brief.sh');
    await put(settings, `{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "~/bin/session-brief.sh --workspace"
          }
        ]
      }
    ]
  }
}
`);
    await put(script, '#!/bin/sh\necho "Workspace notes"\n');
    const strip = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(home, '.claude')))!;
    const ref = strip.groups[0]!.hooks[0]!.source;
    const result = await readHookSource(makeCtx(home, join(base, 'data')), ref);
    assert.deepEqual(result, {
      file: settings,
      entry: '{\n  "type": "command",\n  "command": "~/bin/session-brief.sh --workspace"\n}',
      script: { path: script, text: '#!/bin/sh\necho "Workspace notes"\n' },
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Examples 2, 5 and 13: inline commands, bare names, relative paths, options and -c/-e/-m rules', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hooksrc-'));
  try {
    const home = join(base, 'home');
    const settings = join(home, '.claude', 'settings.json');
    const scriptA = join(home, 'bin', 'a.sh');
    await put(scriptA, 'echo from-a\n');
    await put(settings, JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [
            { type: 'command', command: 'echo "Remember the style guide"' },
            { type: 'command', command: 'session-notes' },
            { type: 'command', command: './start.sh' },
            { type: 'command', command: 'bash -x ~/bin/a.sh' },
            { type: 'command', command: 'bash -c "~/bin/a.sh"' },
          ],
        }],
      },
    }, null, 2));
    const strip = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(home, '.claude')))!;
    const ctx = makeCtx(home, join(base, 'data'));
    const results = await Promise.all(strip.groups[0]!.hooks.map(hook => readHookSource(ctx, hook.source)));
    for (const at of [0, 1, 2, 4]) {
      assert.equal(results[at]!.file, settings);
      assert.ok(results[at]!.entry);
      assert.deepEqual(results[at]!.script, { problem: 'No script file found in the command.' });
    }
    assert.deepEqual(results[3]!.script, { path: scriptA, text: 'echo from-a\n' });

    // Direct unit checks of scriptInLaunch for interpreter basename, /usr/bin/env, cat, -e/-m, deno/bun and quotes.
    const root = join(base, 'plugin');
    assert.equal(scriptInLaunch({ shell: '/usr/bin/python3 ~/bin/a.py' }, home), join(home, 'bin', 'a.py'));
    assert.equal(scriptInLaunch({ shell: '/usr/bin/python3 ./local.py' }, home), undefined);
    assert.equal(scriptInLaunch({ shell: '/usr/bin/env python3 -u ~/bin/a.py' }, home), join(home, 'bin', 'a.py'));
    assert.equal(scriptInLaunch({ shell: '/usr/bin/env -S bash ~/bin/a.sh' }, home), join(home, 'bin', 'a.sh'));
    assert.equal(scriptInLaunch({ shell: '/usr/bin/env' }, home), undefined);
    assert.equal(scriptInLaunch({ shell: 'cat "${CLAUDE_PLUGIN_ROOT}/STYLE.md"' }, home, root), join(root, 'STYLE.md'));
    assert.equal(scriptInLaunch({ shell: 'cat -- "${CLAUDE_PLUGIN_ROOT}/STYLE.md"' }, home, root), join(root, 'STYLE.md'));
    assert.equal(scriptInLaunch({ shell: 'node -e "console.log(1)"' }, home), undefined);
    assert.equal(scriptInLaunch({ shell: 'python3 -m mymod ~/bin/a.py' }, home), undefined);
    assert.equal(scriptInLaunch({ shell: 'deno run ~/bin/a.ts' }, home), undefined);
    assert.equal(scriptInLaunch({ shell: 'bun run ~/bin/a.ts' }, home), undefined);
    assert.equal(scriptInLaunch({ shell: '"${CLAUDE_PLUGIN_ROOT}/hooks/my script.sh" --flag' }, home, root), join(root, 'hooks', 'my script.sh'));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Example 3 and 9: Codex hooks.json and config.toml (table and inline hooks list)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hooksrc-'));
  try {
    const home = join(base, 'home');
    const codex = join(home, '.codex');
    const hooksJson = join(codex, 'hooks.json');
    const promptPy = join(codex, 'hooks', 'prompt.py');
    const toml = join(codex, 'config.toml');
    await put(hooksJson, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/prompt.py' }] }] },
    }, null, 2));
    await put(promptPy, 'print("check prompt")\n');
    await put(toml, [
      'model = "gpt-5"',
      '',
      '[[hooks.SessionStart]]',
      'matcher = "startup|resume"',
      '',
      '[[hooks.SessionStart.hooks]]',
      'type = "command"',
      'command = "echo from toml"',
      'timeout = 5',
      '',
      '# comment for the next table',
      '[[hooks.SessionStart]]',
      'matcher = "compact"',
      'hooks = [{ type = "command", command = "echo inline" }]',
      '',
    ].join('\n'));

    const strip = sessionStrip('codex-cli', [], await sessionSettings('codex-cli', codex))!;
    const ctx = makeCtx(home, join(base, 'data'));
    const fromJson = await readHookSource(ctx, strip.groups[0]!.hooks[0]!.source);
    assert.equal(fromJson.file, hooksJson);
    assert.match(fromJson.entry!, /"command": "python3 ~\/\.codex\/hooks\/prompt\.py"/);
    assert.deepEqual(fromJson.script, { path: promptPy, text: 'print("check prompt")\n' });

    const fromTomlTable = await readHookSource(ctx, strip.groups[1]!.hooks[0]!.source);
    assert.equal(fromTomlTable.file, toml);
    assert.equal(fromTomlTable.entry, '[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "echo from toml"\ntimeout = 5');
    assert.deepEqual(fromTomlTable.script, { problem: 'No script file found in the command.' });

    const fromTomlInline = await readHookSource(ctx, strip.groups[1]!.hooks[1]!.source);
    assert.equal(fromTomlInline.file, toml);
    assert.equal(fromTomlInline.entry, 'hooks = [{ type = "command", command = "echo inline" }]');
    assert.deepEqual(fromTomlInline.script, { problem: 'No script file found in the command.' });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Example 4 and 17: installed plugin copy vs marketplace copy, and inline plugin manifest hooks', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hooksrc-'));
  try {
    const home = join(base, 'home');
    const market = join(base, 'market');
    const mPlugin = join(market, 'plugins', 'helper');
    const iPlugin = join(home, '.claude', 'plugins', 'cache', 'team', 'helper', '1.0.0');
    const inlinePlugin = join(market, 'plugins', 'inline-one');
    await put(join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      name: 'team',
      plugins: [
        { name: 'helper', source: './plugins/helper', version: '1.0.0' },
        { name: 'inline-one', source: './plugins/inline-one', version: '1.0.0' },
      ],
    }));
    // Marketplace copy and installed copy hold distinct scripts and entries.
    await put(join(mPlugin, 'hooks', 'hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-context.sh' }] }] },
    }, null, 2));
    await put(join(mPlugin, 'hooks', 'session-context.sh'), '#!/bin/sh\necho "marketplace version"\n');

    await put(join(iPlugin, 'hooks', 'hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-context.sh', timeout: 10 }] }] },
    }, null, 2));
    await put(join(iPlugin, 'hooks', 'session-context.sh'), '#!/bin/sh\necho "installed version"\n');
    await put(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'helper@team': [{ scope: 'user', installPath: iPlugin, version: '1.0.0' }] },
    }));

    // Example 17: inline hook in plugin.json -> no entry shown, script only.
    await put(join(inlinePlugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'inline-one',
      version: '1.0.0',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/run.sh' }] }] },
    }));
    await put(join(inlinePlugin, 'run.sh'), '#!/bin/sh\necho "inline hook script"\n');
    // Unwrapped top-level plugin hooks file ({ "SessionStart": [...] } without outer "hooks" key).
    const flatPlugin = join(market, 'plugins', 'flat-hooks');
    await put(join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      name: 'team',
      plugins: [
        { name: 'helper', source: './plugins/helper', version: '1.0.0' },
        { name: 'inline-one', source: './plugins/inline-one', version: '1.0.0' },
        { name: 'flat-hooks', source: './plugins/flat-hooks', version: '1.0.0' },
      ],
    }));
    await put(join(flatPlugin, 'hooks', 'hooks.json'), JSON.stringify({
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo flat' }] }],
    }, null, 2));

    const ctx = makeCtx(home, join(base, 'data'));
    const installedRes = await readHookSource(ctx, {
      from: 'installed', tool: 'claude-cli', plugin: 'helper', marketName: 'team',
      declaredIn: join(iPlugin, 'hooks', 'hooks.json'), event: 'SessionStart', at: 0,
      command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-context.sh',
    });
    assert.equal(installedRes.file, join(iPlugin, 'hooks', 'hooks.json'));
    assert.match(installedRes.entry!, /"timeout": 10/);
    assert.deepEqual(installedRes.script, { path: join(iPlugin, 'hooks', 'session-context.sh'), text: '#!/bin/sh\necho "installed version"\n' });

    const marketRes = await readHookSource(ctx, {
      from: 'marketplace', source: market, plugin: 'helper',
      declaredIn: join(mPlugin, 'hooks', 'hooks.json'), event: 'SessionStart', at: 0,
      command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-context.sh',
    });
    assert.equal(marketRes.file, join(mPlugin, 'hooks', 'hooks.json'));
    assert.doesNotMatch(marketRes.entry!, /timeout/);
    assert.deepEqual(marketRes.script, { path: join(mPlugin, 'hooks', 'session-context.sh'), text: '#!/bin/sh\necho "marketplace version"\n' });

    const inlineRes = await readHookSource(ctx, {
      from: 'marketplace', source: market, plugin: 'inline-one',
      declaredIn: inlinePlugin, event: 'SessionStart', at: 0,
      command: '${CLAUDE_PLUGIN_ROOT}/run.sh',
    });
    assert.equal(inlineRes.file, undefined);
    assert.equal(inlineRes.entry, undefined);
    assert.deepEqual(inlineRes.script, { path: join(inlinePlugin, 'run.sh'), text: '#!/bin/sh\necho "inline hook script"\n' });

    const flatRes = await readHookSource(ctx, {
      from: 'marketplace', source: market, plugin: 'flat-hooks',
      declaredIn: join(flatPlugin, 'hooks', 'hooks.json'), event: 'SessionStart', at: 0,
      command: 'echo flat',
    });
    assert.equal(flatRes.file, join(flatPlugin, 'hooks', 'hooks.json'));
    assert.match(flatRes.entry!, /"command": "echo flat"/);
    assert.deepEqual(flatRes.script, { problem: 'No script file found in the command.' });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Examples 6, 7 and 16: missing script, folder at path, binary file, 256 KB limit, removed/changed hook and unreadable/tampered files', async t => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hooksrc-'));
  try {
    const home = join(base, 'home');
    const settings = join(home, '.claude', 'settings.json');
    const missing = join(home, 'bin', 'missing.sh');
    const folder = join(home, 'bin', 'a-folder');
    const binary = join(home, 'bin', 'bin.dat');
    const exact = join(home, 'bin', 'exact.txt');
    const huge = join(home, 'bin', 'huge.txt');
    await mkdir(folder, { recursive: true });
    await put(binary, new Uint8Array([0x23, 0x21, 0x00, 0x61]));
    await put(exact, 'a'.repeat(256 * 1024));
    await put(huge, 'b'.repeat(256 * 1024 + 1));
    await put(settings, JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [
            { type: 'command', command: '~/bin/missing.sh' },
            { type: 'command', command: '~/bin/a-folder' },
            { type: 'command', command: '~/bin/bin.dat' },
            { type: 'command', command: '~/bin/exact.txt' },
            { type: 'command', command: '~/bin/huge.txt' },
          ],
        }],
      },
    }, null, 2));
    const ctx = makeCtx(home, join(base, 'data'));
    const strip = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(home, '.claude')))!;
    const refs = strip.groups[0]!.hooks.map(hook => hook.source);

    const rMissing = await readHookSource(ctx, refs[0]!);
    assert.deepEqual(rMissing.script, { path: missing, problem: 'This file couldn’t be read.' });

    const rFolder = await readHookSource(ctx, refs[1]!);
    assert.deepEqual(rFolder.script, { path: folder, problem: 'This file couldn’t be read.' });

    const rBinary = await readHookSource(ctx, refs[2]!);
    assert.deepEqual(rBinary.script, { path: binary, problem: 'Not a text file.' });

    const rExact = await readHookSource(ctx, refs[3]!);
    assert.equal(rExact.script?.text?.length, 256 * 1024);
    assert.ok(!rExact.script?.text?.includes('Central Knot shows'));

    const rHuge = await readHookSource(ctx, refs[4]!);
    assert.equal(rHuge.script?.text, `${'b'.repeat(256 * 1024)}\n\n[Central Knot shows the first 256 KB of this file.]`);

    // Example 7a: hook removed after page drawn -> "This hook is no longer in ~/.claude/settings.json."
    await put(settings, JSON.stringify({ hooks: {} }));
    assert.deepEqual(await readHookSource(ctx, refs[0]!), { problem: 'This hook is no longer in ~/.claude/settings.json.' });

    // Example 7b: hook at same index replaced by a different command -> "This hook is no longer in ~/.claude/settings.json."
    await put(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '~/bin/other.sh' }] }] } }));
    assert.deepEqual(await readHookSource(ctx, refs[0]!), { problem: 'This hook is no longer in ~/.claude/settings.json.' });

    // Declaring file stops parsing -> file + "This file couldn’t be read."
    await put(settings, '{ broken');
    assert.deepEqual(await readHookSource(ctx, refs[0]!), { file: settings, problem: 'This file couldn’t be read.' });

    // Tampered declaredIn outside tool's own files -> never read, refused.
    const outside = join(base, 'other.json');
    await put(outside, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '~/bin/exact.txt' }] }] } }));
    assert.deepEqual(await readHookSource(ctx, { ...refs[3]!, declaredIn: outside }), { problem: 'This file couldn’t be read.' });

    // Non-regular file (FIFO on POSIX): must not block or open.
    await t.test('a named pipe is not opened and reports unreadable', { skip: process.platform === 'win32' && 'Named pipes (mkfifo) are POSIX-only.' }, async () => {
      const fifo = join(home, 'bin', 'pipe.sh');
      execFileSync('mkfifo', [fifo]);
      await put(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '~/bin/pipe.sh' }] }] } }));
      const rPipe = await readHookSource(ctx, { from: 'own', tool: 'claude-cli', declaredIn: settings, event: 'SessionStart', at: 0, command: '~/bin/pipe.sh' });
      assert.deepEqual(rPipe.script, { path: fifo, problem: 'This file couldn’t be read.' });
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Examples 8, 10, 14 and 15: two hooks of one event, custom backup home, {program,args} launch, and Copilot CLI hooks/*.json', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-hooksrc-'));
  try {
    const backup = join(base, 'backup-home');
    const claudeSettings = join(backup, '.claude', 'settings.json');
    const firstScript = join(backup, 'bin', 'first.sh');
    const spacedScript = join(backup, 'bin', 'my script.sh');
    await put(firstScript, 'echo first\n');
    await put(spacedScript, 'echo spaced\n');
    // Example 8 & 14: two matcher groups for one event, and { program, args } launch with spaces.
    await put(claudeSettings, JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/first.sh' }] },
          { matcher: 'resume', hooks: [{ type: 'command', command: '~/bin/my script.sh', args: ['--flag'] }] },
        ],
      },
    }, null, 2));
    const strip = sessionStrip('claude-cli', [], await sessionSettings('claude-cli', join(backup, '.claude')))!;
    const customCtx = makeCtx(backup, join(base, 'data'), 'custom');
    const r0 = await readHookSource(customCtx, strip.groups[0]!.hooks[0]!.source);
    const r1 = await readHookSource(customCtx, strip.groups[0]!.hooks[1]!.source);
    assert.match(r0.entry!, /first\.sh/);
    assert.deepEqual(r0.script, { path: firstScript, text: 'echo first\n' });
    assert.match(r1.entry!, /my script\.sh/);
    assert.deepEqual(r1.script, { path: spacedScript, text: 'echo spaced\n' });

    // Custom home shows …/… when a hook is removed.
    await put(claudeSettings, JSON.stringify({ hooks: {} }));
    assert.deepEqual(await readHookSource(customCtx, strip.groups[0]!.hooks[0]!.source), { problem: 'This hook is no longer in …/.claude/settings.json.' });

    // Example 15: Copilot CLI hook from hooks/*.json (and exec+args).
    const copilot = join(backup, '.copilot');
    const copilotFile = join(copilot, 'hooks', 'team.json');
    const copilotScript = join(backup, 'bin', 'copilot-start.sh');
    await put(copilotScript, '#!/bin/sh\necho copilot\n');
    await put(copilotFile, JSON.stringify({
      version: 1,
      hooks: {
        sessionStart: [
          { type: 'command', bash: '~/bin/copilot-start.sh' },
          { type: 'command', exec: 'node', args: ['~/bin/first.sh'] },
        ],
      },
    }, null, 2));
    const copStrip = sessionStrip('copilot-cli', [], await sessionSettings('copilot-cli', copilot))!;
    const c0 = await readHookSource(customCtx, copStrip.groups[0]!.hooks[0]!.source);
    const c1 = await readHookSource(customCtx, copStrip.groups[0]!.hooks[1]!.source);
    assert.equal(slashPath(c0.file!), slashPath(copilotFile));
    assert.match(c0.entry!, /"bash": "~\/bin\/copilot-start\.sh"/);
    assert.deepEqual(c0.script, { path: copilotScript, text: '#!/bin/sh\necho copilot\n' });
    assert.match(c1.entry!, /"exec": "node"/);
    assert.deepEqual(c1.script, { path: firstScript, text: 'echo first\n' });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('parseHookRef rejects malformed requests and accepts valid own, installed and marketplace refs', () => {
  assert.equal(parseHookRef(null), undefined);
  assert.equal(parseHookRef({ from: 'own', tool: 'bogus', declaredIn: '/a', event: 'E', at: 0, command: 'x' }), undefined);
  assert.equal(parseHookRef({ from: 'own', tool: 'claude-cli', declaredIn: '/a', event: 'E', at: -1, command: 'x' }), undefined);
  assert.equal(parseHookRef({ from: 'own', tool: 'claude-cli', declaredIn: '/a', event: 'E', at: 1.5, command: 'x' }), undefined);
  assert.equal(parseHookRef({ from: 'installed', tool: 'claude-cli', plugin: '', marketName: 'm', declaredIn: '/a', event: 'E', at: 0, command: 'x' }), undefined);
  assert.equal(parseHookRef({ from: 'marketplace', source: '', plugin: 'p', declaredIn: '/a', event: 'E', at: 0, command: 'x' }), undefined);
  assert.ok(parseHookRef({ from: 'own', tool: 'claude-cli', declaredIn: '/a', event: 'SessionStart', at: 0, command: 'x' }));
  assert.ok(parseHookRef({ from: 'installed', tool: 'codex-cli', plugin: 'p', marketName: 'm', declaredIn: '/a', event: 'SessionStart', at: 0, command: 'x' }));
  assert.ok(parseHookRef({ from: 'marketplace', source: '/m', plugin: 'p', declaredIn: '/a', event: 'SessionStart', at: 0, command: 'x' }));
});
