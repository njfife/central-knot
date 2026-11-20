// Worked examples of the strip on each tool's card on the Instructions page, "Hooks that can add text" (or Pi's packages,
// OpenCode's plugins): what it says of the plugins installed in the tool (sessionhooks.ts sessionStrip, from HomeView
// pluginItems) and of what the tool's own settings name (read by pluginitems.ts sessionSettings). Nothing here runs a hook:
// the commands are plain strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ORIGIN_COLOURS, originMark, sessionStrip } from '../src/sessionhooks.ts';
import { sessionSettings } from '../src/pluginitems.ts';
import { outcomes, sessionTextNote } from '../src/pluginoutcomes.ts';
import type { DeclaredHook, HarnessId, InstalledPlugin } from '../src/types.ts';

const plugin = (tool: HarnessId, name: string, hooks: DeclaredHook[], extra: Partial<InstalledPlugin> = {}): InstalledPlugin =>
  ({ tool, plugin: name, marketName: 'team', source: '/markets/team', listed: true, items: [], hooks, ...extra });
/** A hook its plugin's hooks.json declares, run by a shell; `more` gives its matcher or another launch. */
const declared = (event: string, shell: string, at = 0, more: Partial<DeclaredHook> = {}): DeclaredHook => ({ declaredIn: '/copy/hooks/hooks.json', event, at, launch: { shell }, ...more });
const atStart = (...shells: string[]) => shells.map((shell, at) => declared('SessionStart', shell, at));
/** What the strip shows: each origin by name, with when each of its hooks runs and its command. */
const shown = (strip: ReturnType<typeof sessionStrip>) => strip?.groups.map(group => [group.name, group.hooks.map(hook => [hook.when, hook.command])]);
const START = 'when a session starts', PROMPT = 'when you send a prompt';
const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

test('a plugin’s hooks that can add text are one group under its name, each with when it runs and its command, arguments kept', () => {
  const helper = plugin('claude-cli', 'release-helper', [
    declared('PreToolUse', 'echo checked'),
    declared('SessionStart', 'echo hello'),
    declared('SessionStart', '', 1, { launch: { program: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/remind.mjs', '--days', '2'] } }),
    declared('UserPromptSubmit', './check "two words"'),
    // A hook that starts no program (a prompt hook, one that calls a URL) is not one of these.
    { declaredIn: '/copy/hooks/hooks.json', event: 'UserPromptSubmit', at: 1 },
  ]);
  const strip = sessionStrip('claude-cli', [helper], {});
  assert.deepEqual(shown(strip), [['release-helper', [
    [START, 'echo hello'], [START, 'node ${CLAUDE_PLUGIN_ROOT}/hooks/remind.mjs --days 2'], [PROMPT, './check "two words"'],
  ]]]);
  // Its page holds its switch; Claude Code takes a hook's text as it is, so it has no note.
  assert.deepEqual([strip!.groups[0]!.plugin, strip!.note], [helper, undefined]);
});

test('the strip says once what it lists and what it doesn’t, and no hook’s row repeats it', () => {
  const strip = sessionStrip('claude-cli', [plugin('claude-cli', 'a', atStart('one', 'two'))], {})!;
  assert.equal(strip.heading, 'Hooks that can add text');
  assert.equal(strip.about, 'These hooks run a program when a session starts or when you send a prompt, and what it prints can be added to the session; that is known only when it runs. Other kinds of hook (one that calls a URL or an MCP tool), and a project’s or an organisation’s hooks, aren’t listed.');
  assert.ok(strip.groups.every(group => group.hooks.every(hook => !/known only/.test(hook.when))));
});

test('can it add text is each tool’s own rule: Copilot CLI takes only start-of-session hooks, and each tool knows only its own event names', () => {
  const hooks = [declared('sessionStart', './start.sh'), declared('SessionStart', './Start.sh'), declared('userPromptSubmitted', './prompt.sh'), declared('UserPromptSubmit', './Prompt.sh')];
  const commands = (tool: HarnessId) => sessionStrip(tool, [plugin(tool, 'p', hooks)], {})?.groups.flatMap(group => group.hooks.map(hook => hook.command));
  assert.deepEqual(commands('copilot-cli'), ['./start.sh', './Start.sh']);
  assert.deepEqual(commands('claude-cli'), ['./Start.sh', './Prompt.sh']);
  assert.deepEqual(commands('codex-cli'), ['./Start.sh', './Prompt.sh']);
  // Copilot CLI with only prompt hooks: no row, and its note says why.
  const prompts = sessionStrip('copilot-cli', [plugin('copilot-cli', 'p', [declared('userPromptSubmitted', './prompt.sh')])], {})!;
  assert.deepEqual([prompts.groups, prompts.note], [[], sessionTextNote('copilot-cli')]);
  // Its sentence names only the hooks it takes.
  assert.match(prompts.about, /^These hooks run a program when a session starts, and what it prints/);
  // The outcome table asks the same rule, tool by tool.
  const table = (tool: HarnessId, sessionTextHooks: HarnessId[]) => outcomes(tool, { skills: 0, commands: 0, agents: 0, hooks: true, hooksIn: [tool], startHooksIn: [tool], mcp: 0, mcpRootVariable: false, bin: false, sessionTextHooks })
    .some(outcome => outcome.component === 'Session text');
  assert.deepEqual([table('claude-cli', ['claude-cli']), table('copilot-cli', ['claude-cli'])], [true, false]);
});

test('when a start-of-session hook runs is what its matcher says, in Claude Code’s and Codex’s words; a prompt hook’s matcher and Copilot CLI’s are ignored', () => {
  const when = (tool: HarnessId, event: string, matcher: string) => sessionStrip(tool, [plugin(tool, 'p', [declared(event, 'x', 0, { matcher })])], {})?.groups[0]?.hooks[0]?.when;
  assert.deepEqual([when('claude-cli', 'SessionStart', 'compact'), when('claude-cli', 'SessionStart', 'resume'), when('claude-cli', 'SessionStart', 'startup|resume'), when('claude-cli', 'SessionStart', '*')],
    ['after the conversation is compacted', 'when a session resumes', 'when a session starts or when a session resumes', START]);
  assert.deepEqual([when('codex-cli', 'SessionStart', 'fork'), when('claude-cli', 'SessionStart', 'start.*')], ['when a session is forked', `${START} (matcher “start.*”)`]);
  assert.deepEqual([when('claude-cli', 'UserPromptSubmit', 'compact'), when('copilot-cli', 'sessionStart', 'resume')], [PROMPT, START]);
});

test('only the tool’s own plugins that are on there have a group: one turned off has none; a copy or a hooks file that couldn’t be read is said', () => {
  const items = [
    plugin('claude-cli', 'quiet', atStart('echo off'), { off: true }),
    plugin('copilot-cli', 'elsewhere', [declared('sessionStart', './hello.sh')]),
    plugin('claude-cli', 'broken', [], { problem: 'Claude Code lists it, but its files are not where it records them.' }),
    plugin('claude-cli', 'garbled', atStart('echo still read'), { hooksUnread: ['/copy/hooks/extra.json'] }),
  ];
  const strip = sessionStrip('claude-cli', items, {})!;
  assert.deepEqual(strip.groups.map(group => [group.name, group.problem ?? null, group.unread, group.hooks.length]),
    [['broken', 'Claude Code lists it, but its files are not where it records them. What its hooks add isn’t known.', [], 0], ['garbled', null, ['/copy/hooks/extra.json'], 1]]);
  // With nothing to show, there is no strip.
  assert.equal(sessionStrip('claude-cli', items.slice(0, 2), {}), undefined);
});

test('one plugin name in two marketplaces gives two groups told apart by their marketplace', () => {
  const ours = plugin('claude-cli', 'style', atStart('cat ours.md')), theirs = plugin('claude-cli', 'style', atStart('cat theirs.md'), { marketName: 'vendor' });
  const strip = sessionStrip('claude-cli', [ours, theirs], {});
  assert.deepEqual(shown(strip), [['style (team)', [[START, 'cat ours.md']]], ['style (vendor)', [[START, 'cat theirs.md']]]]);
  assert.deepEqual(strip!.groups.map(group => group.plugin), [ours, theirs]);
});

test('a plugin whose marketplace isn’t added has no page here, and its group says where it is turned off', () => {
  const [group] = sessionStrip('claude-cli', [plugin('claude-cli', 'directory-one', atStart('echo hi'), { listed: false, marketName: 'anthropic-plugin-directory' })], {})!.groups;
  assert.equal(group!.says, 'Claude Code’s own plugin commands turn it off.');
});

test('Codex and Copilot CLI say once what they take of a hook, in the words their plugins’ outcome table uses', () => {
  const codex = sessionStrip('codex-cli', [plugin('codex-cli', 'a', atStart('one')), plugin('codex-cli', 'b', atStart('two'))], {});
  const copilot = sessionStrip('copilot-cli', [plugin('copilot-cli', 'c', [declared('sessionStart', 'three')])], {});
  assert.deepEqual([codex!.groups.length, codex!.note, copilot!.note], [2, sessionTextNote('codex-cli'), sessionTextNote('copilot-cli')]);
  // Trusting a project is not enough in Codex: each hook is trusted in its /hooks (https://learn.chatgpt.com/docs/hooks).
  assert.equal(codex!.note, 'Codex runs a hook only after you trust it in `/hooks`');
  assert.equal(copilot!.note, 'Copilot CLI uses only what a start-of-session hook prints as top-level `additionalContext`, not Claude Code’s `hookSpecificOutput` form; it ignores what prompt hooks print');
  const table = (tool: HarnessId) => outcomes(tool, { skills: 0, commands: 0, agents: 0, hooks: true, hooksIn: [tool], startHooksIn: [tool], mcp: 0, mcpRootVariable: false, bin: false, sessionTextHooks: [tool] })
    .find(outcome => outcome.component === 'Session text')!.text;
  assert.deepEqual([table('codex-cli'), table('copilot-cli')], [`waits for trust: ${codex!.note}`, `is limited: ${copilot!.note}`]);
});

test('the person’s own hooks are marked yours, a group for each file that holds them, before the plugins’, in each tool that keeps them', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-session-'));
  try {
    const claude = join(base, '.claude'), codex = join(base, '.codex'), copilot = join(base, '.copilot');
    await put(join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: {}, hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/bin/greet.sh', args: ['--short', 'two words'] }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }] } }));
    await put(join(codex, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/prompt.py' }] }] } }));
    // Codex's inline form in config.toml, its hooks in their own tables or as an inline list, beside the table where it keeps
    // which hooks are trusted (never read for the strip).
    await put(join(codex, 'config.toml'), 'model = "x"\n\n[[hooks.SessionStart]]\nmatcher = "startup|resume"\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "echo from toml"\ntimeout = 5\n\n'
      + '[[hooks.SessionStart]]\nmatcher = "compact"\nhooks = [{ type = "command", command = "echo inline" }]\n\n[hooks.state]\nabc = "trusted"\n');
    await put(join(copilot, 'hooks/team.json'), JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: './team.sh', powershell: './team.ps1' }] } }));
    await put(join(copilot, 'settings.json'), `// Copilot CLI's settings\n${JSON.stringify({ hooks: { sessionStart: [{ type: 'command', bash: 'echo mine' }] } })}`);
    const claudeFile = await sessionSettings('claude-cli', claude);
    const strip = sessionStrip('claude-cli', [plugin('claude-cli', 'helper', atStart('echo plugin'))], claudeFile);
    assert.deepEqual(shown(strip), [['yours', [[START, '~/bin/greet.sh --short "two words"']]], ['helper', [[START, 'echo plugin']]]]);
    assert.deepEqual([strip!.groups[0]!.settings, strip!.groups[0]!.mark, strip!.groups[0]!.plugin], [join(claude, 'settings.json'), 'origin-yours', undefined]);
    const codexFile = await sessionSettings('codex-cli', codex);
    assert.deepEqual(shown(sessionStrip('codex-cli', [], codexFile)), [['yours', [[PROMPT, 'python3 ~/.codex/hooks/prompt.py']]],
      ['yours', [['when a session starts or when a session resumes', 'echo from toml'], ['after the conversation is compacted', 'echo inline']]]]);
    // Each is kept as declared, for the step that runs one: where, its matcher, its place, how it starts, its time limit.
    assert.deepEqual(codexFile.ownHooks![1], { declaredIn: join(codex, 'config.toml'), event: 'SessionStart', matcher: 'startup|resume', at: 0, launch: { shell: 'echo from toml' }, timeout: 5 });
    const copilotStrip = sessionStrip('copilot-cli', [], await sessionSettings('copilot-cli', copilot));
    assert.deepEqual([shown(copilotStrip)!.map(([, hooks]) => hooks), copilotStrip!.groups.map(group => group.settings)],
      [[[[START, 'echo mine']], [[START, './team.sh']]], [join(copilot, 'settings.json'), join(copilot, 'hooks/team.json')]]);
    // A tool with no settings of its own adds nothing.
    assert.deepEqual(await sessionSettings('codex-cli', join(base, 'nowhere')), { ownHooks: [], ownHooksUnread: [] });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('the person’s own settings that can’t be read, or don’t parse, are said in their own group, never read as no hooks', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-session-'));
  try {
    const claude = join(base, '.claude'), copilot = join(base, '.copilot');
    await put(join(claude, 'settings.json'), '{ "hooks": ');
    const garbled = await sessionSettings('claude-cli', claude);
    assert.deepEqual(garbled, { ownHooks: [], ownHooksUnread: [join(claude, 'settings.json')] });
    assert.deepEqual(sessionStrip('claude-cli', [], garbled)!.groups.map(group => [group.name, group.settings, group.unread]),
      [['yours', join(claude, 'settings.json'), [join(claude, 'settings.json')]]]);
    await put(join(copilot, 'hooks/locked.json'), JSON.stringify({ hooks: { sessionStart: [{ type: 'command', bash: './x.sh' }] } }));
    await chmod(join(copilot, 'hooks/locked.json'), 0o000);
    assert.deepEqual((await sessionSettings('copilot-cli', copilot)).ownHooksUnread, process.getuid?.() === 0 ? [] : [join(copilot, 'hooks/locked.json')]);
    await chmod(join(copilot, 'hooks/locked.json'), 0o644);
    // Codex's config.toml that doesn't parse (a string left open): its inline hooks aren't known, so it is named.
    await put(join(base, '.codex/config.toml'), 'model = "unterminated\n');
    assert.deepEqual((await sessionSettings('codex-cli', join(base, '.codex'))).ownHooksUnread, [join(base, '.codex/config.toml')]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Pi’s packages and OpenCode’s plugins are named as their settings list them, under each tool’s own word, and only the running tool knows their text', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-session-'));
  try {
    const pi = join(base, '.pi/agent'), opencode = join(base, '.config/opencode');
    await put(join(pi, 'settings.json'), JSON.stringify({ packages: ['npm:@example/pi-tools@1.0.0', { source: 'git:github.com/example/pi-style@v1', skills: [] }, { source: './skills-only', extensions: [] }] }));
    await put(join(opencode, 'opencode.json'), '{\n  // mine\n  "plugin": ["opencode-wakatime", "file:///home/example/pkgs/plug-one"],\n}\n');
    const piStrip = sessionStrip('pi-cli', [], await sessionSettings('pi-cli', pi))!;
    // A package told to load no extensions (`"extensions": []`) can't add text, so it isn't named.
    assert.deepEqual(shown(piStrip), [['npm:@example/pi-tools@1.0.0', []], ['git:github.com/example/pi-style@v1', []]]);
    assert.deepEqual([piStrip.heading, piStrip.about, piStrip.note], ['Packages that can add text', 'Pi loads these packages into every session, and they can add text to it; what they add is known only when they run.', undefined]);
    const openCodeStrip = sessionStrip('opencode-cli', [], await sessionSettings('opencode-cli', opencode))!;
    assert.deepEqual([shown(openCodeStrip)!.map(([name]) => name), openCodeStrip.heading], [['opencode-wakatime', 'file:///home/example/pkgs/plug-one'], 'Plugins that can add text']);
    assert.equal(sessionStrip('pi-cli', [], await sessionSettings('pi-cli', join(base, 'nowhere'))), undefined);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a plugin’s mark comes from its name and marketplace, the same in every tool, one of the colours the CSS defines, drawn as a dot; yours is fixed', async () => {
  const marks = ['release-helper', 'superpowers', 'tavily', 'postman', 'stripe', 'zyte', 'outputai', 'learning-output-style', 'pdf', 'x'].map(name => originMark(`${name}@team`));
  const css = await readFile(join(import.meta.dirname, '../src/style.css'), 'utf8');
  assert.ok(marks.every(mark => new RegExp(`^origin-[0-${ORIGIN_COLOURS - 1}]$`).test(mark)), marks.join(' '));
  assert.ok(new Set(marks).size > 3, 'ten names spread over the colours');
  for (let colour = 0; colour < ORIGIN_COLOURS; colour++) assert.match(css, new RegExp(`\\.origin-${colour} \\{`), `style.css draws origin-${colour}`);
  assert.match(css, /\.origin-yours \{/);
  // A round mark: a filled square beside "yours" reads as a ticked box.
  assert.match(css, /\.origin-mark \{[^}]*border-radius: 50%/);
  const [inClaude] = sessionStrip('claude-cli', [plugin('claude-cli', 'tavily', atStart('x'))], {})!.groups;
  const [inCodex] = sessionStrip('codex-cli', [plugin('codex-cli', 'tavily', atStart('x'))], {})!.groups;
  assert.deepEqual([inClaude!.mark, inCodex!.mark], [originMark('tavily@team'), originMark('tavily@team')]);
});
