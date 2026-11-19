// Worked examples of "Also in every session", the strip on each tool's card on the Instructions page: what it says of the
// plugins installed in the tool (sessionhooks.ts sessionLines, from HomeView pluginItems) and of what the tool's own settings
// name (read by pluginitems.ts sessionSettings). Nothing here runs a hook: the commands are plain strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ORIGIN_COLOURS, originMark, sessionLines } from '../src/sessionhooks.ts';
import { sessionSettings } from '../src/pluginitems.ts';
import { outcomes, sessionTextNote } from '../src/pluginoutcomes.ts';
import type { DeclaredHook, HarnessId, InstalledPlugin } from '../src/types.ts';

const plugin = (tool: HarnessId, name: string, hooks: DeclaredHook[], extra: Partial<InstalledPlugin> = {}): InstalledPlugin =>
  ({ tool, plugin: name, marketName: 'team', source: '/markets/team', listed: true, items: [], hooks, ...extra });
/** A hook its plugin's hooks.json declares, run by a shell; `launch` in another form where given. */
const declared = (event: string, shell: string, at = 0, launch: DeclaredHook['launch'] = { shell }): DeclaredHook => ({ declaredIn: '/copy/hooks/hooks.json', event, at, launch });
const atStart = (...shells: string[]) => shells.map((shell, at) => declared('SessionStart', shell, at));
/** What each line shows: the name beside its mark, its sentence, and a hook's command. */
const shown = (strip: ReturnType<typeof sessionLines>) => strip?.lines.map(line => [line.name, line.says, line.command ?? null]);
const RUNS_AT_START = 'Runs when a session starts. What it adds is known only when it runs.';
const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

test('a plugin’s start-of-session hook is one line per command, its arguments kept, and a hook that adds no text has none', () => {
  const helper = plugin('claude-cli', 'release-helper', [
    declared('PreToolUse', 'echo checked'),
    declared('SessionStart', 'echo hello'),
    declared('SessionStart', '', 1, { program: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/remind.mjs', '--days', '2'] }),
    declared('UserPromptSubmit', './check "two words"'),
    // A prompt hook starts no program, so it has no line.
    { declaredIn: '/copy/hooks/hooks.json', event: 'UserPromptSubmit', at: 1 },
  ]);
  const strip = sessionLines('claude-cli', [helper], {});
  assert.deepEqual(shown(strip), [
    ['release-helper', RUNS_AT_START, 'echo hello'],
    ['release-helper', RUNS_AT_START, 'node ${CLAUDE_PLUGIN_ROOT}/hooks/remind.mjs --days 2'],
    ['release-helper', 'Runs when you send a prompt. What it adds is known only when it runs.', './check "two words"'],
  ]);
  // Its page holds its switch; Claude Code takes a hook's text as it is, so it has no note.
  assert.deepEqual([strip!.lines.every(line => line.plugin === helper), strip!.note], [true, undefined]);
});

test('only the tool’s own plugins that are on there have lines: one turned off has none, one whose copy couldn’t be read is said', () => {
  const items = [
    plugin('claude-cli', 'quiet', atStart('echo off'), { off: true }),
    plugin('copilot-cli', 'elsewhere', [declared('sessionStart', './hello.sh')]),
    plugin('claude-cli', 'broken', [], { problem: 'Claude Code lists it, but its files are not where it records them.' }),
  ];
  assert.deepEqual(shown(sessionLines('claude-cli', items, {})),
    [['broken', 'Claude Code lists it, but its files are not where it records them. What its hooks add isn’t known.', null]]);
  // With nothing to show, there is no strip.
  assert.equal(sessionLines('claude-cli', items.slice(0, 2), {}), undefined);
});

test('one plugin name in two marketplaces gives two lines told apart by their marketplace', () => {
  const ours = plugin('claude-cli', 'style', atStart('cat ours.md')), theirs = plugin('claude-cli', 'style', atStart('cat theirs.md'), { marketName: 'vendor' });
  const strip = sessionLines('claude-cli', [ours, theirs], {});
  assert.deepEqual(shown(strip)!.map(([name, , command]) => [name, command]), [['style (team)', 'cat ours.md'], ['style (vendor)', 'cat theirs.md']]);
  assert.deepEqual(strip!.lines.map(line => line.plugin), [ours, theirs]);
});

test('a plugin whose marketplace isn’t added has no page here, and its line says where it is turned off', () => {
  const [line] = sessionLines('claude-cli', [plugin('claude-cli', 'directory-one', atStart('echo hi'), { listed: false, marketName: 'anthropic-plugin-directory' })], {})!.lines;
  assert.equal(line!.says, `${RUNS_AT_START} Claude Code’s own plugin commands turn it off.`);
});

test('Codex and Copilot CLI say once, after the lines, what they take of a hook, in the words their plugins’ outcome table uses', () => {
  const codex = sessionLines('codex-cli', [plugin('codex-cli', 'a', atStart('one')), plugin('codex-cli', 'b', atStart('two'))], {});
  const copilot = sessionLines('copilot-cli', [plugin('copilot-cli', 'c', [declared('sessionStart', 'three')])], {});
  assert.deepEqual([codex!.lines.length, codex!.note, copilot!.note], [2, sessionTextNote('codex-cli'), sessionTextNote('copilot-cli')]);
  // Trusting a project is not enough in Codex: each hook is trusted in its /hooks (https://learn.chatgpt.com/docs/hooks).
  assert.equal(codex!.note, 'Codex runs a hook only after you trust it in `/hooks`');
  assert.match(copilot!.note!, /^Copilot CLI adds only what a start-of-session hook prints as `\{"additionalContext": …\}`/);
  const table = (tool: HarnessId) => outcomes(tool, { skills: 0, commands: 0, agents: 0, hooks: true, mcp: 0, mcpRootVariable: false, bin: false, sessionTextHooks: true })
    .find(outcome => outcome.component === 'Session text')!.text;
  assert.deepEqual([table('codex-cli'), table('copilot-cli')], [`waits for trust: ${codex!.note}`, `is limited: ${copilot!.note}`]);
});

test('the person’s own hooks are marked yours, with the file that holds them, before the plugins’, in each tool that keeps them', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-session-'));
  try {
    const claude = join(base, '.claude'), codex = join(base, '.codex'), copilot = join(base, '.copilot');
    await put(join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: {}, hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/greet.sh', args: ['--short', 'two words'] }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }] } }));
    await put(join(codex, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/prompt.py' }] }] } }));
    // Codex's inline form in config.toml, beside the table where it keeps which hooks are trusted (never read for the strip).
    await put(join(codex, 'config.toml'), 'model = "x"\n\n[[hooks.SessionStart]]\nmatcher = "startup|resume"\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "echo from toml"\ntimeout = 5\n\n[hooks.state]\nabc = "trusted"\n');
    await put(join(copilot, 'hooks/team.json'), JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: './team.sh', powershell: './team.ps1' }] } }));
    await put(join(copilot, 'settings.json'), `// Copilot CLI's settings\n${JSON.stringify({ hooks: { sessionStart: [{ type: 'command', bash: 'echo mine' }] } })}`);
    const claudeFile = await sessionSettings('claude-cli', claude);
    const strip = sessionLines('claude-cli', [plugin('claude-cli', 'helper', atStart('echo plugin'))], claudeFile);
    assert.deepEqual(shown(strip), [['yours', RUNS_AT_START, '~/bin/greet.sh --short "two words"'], ['helper', RUNS_AT_START, 'echo plugin']]);
    assert.deepEqual([strip!.lines[0]!.settings, strip!.lines[0]!.mark, strip!.lines[0]!.plugin], [join(claude, 'settings.json'), 'origin-yours', undefined]);
    const codexFile = await sessionSettings('codex-cli', codex);
    assert.deepEqual(shown(sessionLines('codex-cli', [], codexFile)), [['yours', 'Runs when you send a prompt. What it adds is known only when it runs.', 'python3 ~/.codex/hooks/prompt.py'], ['yours', RUNS_AT_START, 'echo from toml']]);
    // Each is kept as declared, for the step that runs one: where, its matcher, its place, how it starts, its time limit.
    assert.deepEqual(codexFile.ownHooks![1], { declaredIn: join(codex, 'config.toml'), event: 'SessionStart', matcher: 'startup|resume', at: 0, launch: { shell: 'echo from toml' }, timeout: 5 });
    const copilotStrip = sessionLines('copilot-cli', [], await sessionSettings('copilot-cli', copilot));
    assert.deepEqual([shown(copilotStrip)!.map(([, , command]) => command), copilotStrip!.lines.map(line => line.settings)],
      [['echo mine', './team.sh'], [join(copilot, 'settings.json'), join(copilot, 'hooks/team.json')]]);
    // A tool with no settings of its own, or settings that can't be read as JSON, adds no line and stops nothing.
    await put(join(claude, 'settings.json'), '{ "hooks": ');
    assert.deepEqual(await sessionSettings('claude-cli', claude), { ownHooks: [] });
    assert.deepEqual(await sessionSettings('codex-cli', join(base, 'nowhere')), { ownHooks: [] });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Pi’s packages and OpenCode’s plugins are named as their settings list them, and only the running tool knows their text', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-session-'));
  try {
    const pi = join(base, '.pi/agent'), opencode = join(base, '.config/opencode');
    await put(join(pi, 'settings.json'), JSON.stringify({ packages: ['npm:@example/pi-tools@1.0.0', { source: 'git:github.com/example/pi-style@v1', skills: [] }, { source: './skills-only', extensions: [] }] }));
    await put(join(opencode, 'opencode.json'), '{\n  // mine\n  "plugin": ["opencode-wakatime", "file:///home/example/pkgs/plug-one"],\n}\n');
    const piStrip = sessionLines('pi-cli', [], await sessionSettings('pi-cli', pi));
    // A package told to load no extensions (`"extensions": []`) can't add text, so it has no line.
    assert.deepEqual(shown(piStrip), [
      ['npm:@example/pi-tools@1.0.0', 'An extension’s text is known only to the running tool.', null],
      ['git:github.com/example/pi-style@v1', 'An extension’s text is known only to the running tool.', null],
    ]);
    assert.deepEqual(shown(sessionLines('opencode-cli', [], await sessionSettings('opencode-cli', opencode)))!.map(([name]) => name), ['opencode-wakatime', 'file:///home/example/pkgs/plug-one']);
    assert.deepEqual([piStrip!.note, sessionLines('pi-cli', [], await sessionSettings('pi-cli', join(base, 'nowhere')))], [undefined, undefined]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a plugin’s mark comes from its name and marketplace, the same in every tool, one of the colours the CSS defines; yours is fixed', async () => {
  const marks = ['release-helper', 'superpowers', 'tavily', 'postman', 'stripe', 'zyte', 'outputai', 'learning-output-style', 'pdf', 'x'].map(name => originMark(`${name}@team`));
  const css = await readFile(join(import.meta.dirname, '../src/style.css'), 'utf8');
  assert.ok(marks.every(mark => new RegExp(`^origin-[0-${ORIGIN_COLOURS - 1}]$`).test(mark)), marks.join(' '));
  assert.ok(new Set(marks).size > 3, 'ten names spread over the colours');
  for (let colour = 0; colour < ORIGIN_COLOURS; colour++) assert.match(css, new RegExp(`\\.origin-${colour} \\{`), `style.css draws origin-${colour}`);
  assert.match(css, /\.origin-yours \{/);
  const [inClaude] = sessionLines('claude-cli', [plugin('claude-cli', 'tavily', atStart('x'))], {})!.lines;
  const [inCodex] = sessionLines('codex-cli', [plugin('codex-cli', 'tavily', atStart('x'))], {})!.lines;
  assert.deepEqual([inClaude!.mark, inCodex!.mark], [originMark('tavily@team'), originMark('tavily@team')]);
});
