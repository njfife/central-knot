import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { inside, installedContents, marketplacePage, pluginContents, pluginFiles, readmeIn, remoteOf, sourceOf } from '../src/catalogdetail.ts';
import { componentsFrom, outcomes } from '../src/pluginoutcomes.ts';
import { hookLine } from '../src/sessionhooks.ts';

const noLinks = process.platform === 'win32';
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
async function box() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-detail-')));
  return { base, root: join(base, 'market'), cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Parts are found as Claude Code and Codex find them: what plugin.json and the entry list, and which default folders stay', async () => {
  const { root, cleanup } = await box();
  try {
    for (const name of ['hello', 'unlisted']) await put(join(root, `skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: Says ${name}\n---\n`);
    await put(join(root, 'extra-skills/more/SKILL.md'), '---\nname: more\ndescription: More\n---\n');
    await put(join(root, 'tools/notes.md'), '---\ndescription: Takes notes\n---\n');
    await put(join(root, 'commands/ignored.md'), '---\ndescription: Not read\n---\n');
    await put(join(root, 'tools/status.md'), '---\ndescription: Shows status\n---\n');
    // commands may also be a map of name to { source } or inline { content }.
    await put(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ version: '0.9.0', skills: './extra-skills', commands: { status: { source: './tools/status.md' }, about: { content: 'About.' } }, hooks: './config/hooks.json', mcpServers: './config/servers.json' }));
    await put(join(root, 'config/hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }], PreToolUse: [{ hooks: [{ type: 'command', command: 'echo tool' }] }] } }));
    await put(join(root, 'config/servers.json'), JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', 'files-mcp'] } } }));
    const contents = await pluginContents(root, { source: './', version: '1.0.0', skills: ['./skills/hello'], commands: ['./tools/notes.md'] }, root);
    // Skills: the default folder, plugin.json's list and the entry's, each skill once. Commands: the lists replace commands/.
    assert.deepEqual(contents.skills.map(skill => skill.name), ['hello', 'more', 'unlisted']);
    // Each part carries its whole file as written and its place in the plugin, the same in every copy of it.
    assert.deepEqual(contents.skills[0], { name: 'hello', description: 'Says hello', text: '---\nname: hello\ndescription: Says hello\n---\n', path: join('skills', 'hello') });
    assert.deepEqual(contents.commands[0], { name: 'notes', description: 'Takes notes', text: '---\ndescription: Takes notes\n---\n', path: join('tools', 'notes.md') });
    assert.deepEqual(contents.commands.map(command => command.name), ['notes', 'status']);
    // plugin.json's version wins over the entry's.
    assert.equal(contents.version, '0.9.0');
    assert.deepEqual(contents.hooks.map(hook => hook.event), ['PreToolUse', 'SessionStart']);
    assert.deepEqual(contents.mcpServers, [{ name: 'files', runs: 'npx -y files-mcp', entry: '{"command":"npx","args":["-y","files-mcp"]}' }]);
    // A marketplace's root plugin whose entry lists skills loads only those.
    assert.deepEqual((await pluginContents(root, { skills: ['./skills/hello'] }, root, { atMarketplaceRoot: true })).skills.map(skill => skill.name), ['hello']);
    // Codex: its manifest's list replaces skills/, and an empty list falls back to it.
    assert.deepEqual((await pluginContents(root, {}, root, { codex: { skills: './extra-skills' } })).skills.map(skill => skill.name), ['more']);
    assert.deepEqual((await pluginContents(root, {}, root, { codex: { skills: [] } })).skills.map(skill => skill.name), ['hello', 'unlisted']);
    // A plugin that is one skill: SKILL.md at its root.
    await put(join(root, 'single/SKILL.md'), '---\nname: single\ndescription: One skill\n---\n');
    assert.deepEqual((await pluginContents(join(root, 'single'), {}, root)).skills.map(skill => [skill.name, skill.path]), [['single', '.']]);
  } finally { await cleanup(); }
});

test('Agents and Codex skills nested deeper than one folder are read, as far down as Codex looks, hidden folders aside', async () => {
  const { root, cleanup } = await box();
  try {
    await put(join(root, 'agents/review/security/deep.md'), '---\ndescription: Deep\n---\n');
    await put(join(root, 'skills/group/inner/nested/SKILL.md'), '---\nname: nested\ndescription: N\n---\n');
    await put(join(root, 'skills/a/b/c/d/e/SKILL.md'), '---\nname: sixth\ndescription: S\n---\n');
    await put(join(root, 'skills/a/b/c/d/e/f/SKILL.md'), '---\nname: seventh\ndescription: S\n---\n');
    await put(join(root, 'skills/.hidden/tucked/SKILL.md'), '---\nname: hidden\ndescription: H\n---\n');
    assert.deepEqual((await pluginContents(root, {}, root)).agents.map(agent => agent.name), ['deep']);
    // Copilot's naming: reviewer.agent.md is the agent "reviewer", on the page and as a part.
    await put(join(root, 'agents/reviewer.agent.md'), '---\ndescription: Reviews\n---\n');
    assert.deepEqual((await pluginContents(root, {}, root)).agents.map(agent => agent.name), ['deep', 'reviewer']);
    assert.deepEqual((await pluginFiles(root, {}, root)).agents.map(agent => agent.name).sort(), ['deep', 'reviewer']);
    assert.deepEqual((await pluginContents(root, {}, root, { codex: {} })).skills.map(skill => skill.name), ['nested', 'sixth']);
  } finally { await cleanup(); }
});

test('Server and hook files are read in every shape plugins use: flat or wrapped, a list of paths, and LSP servers', async () => {
  const { root, cleanup } = await box();
  try {
    // A flat .mcp.json (servers at the top, as GitHub's plugin in the official marketplace has it).
    await put(join(root, '.mcp.json'), JSON.stringify({ github: { url: 'https://api.example/mcp' } }));
    await put(join(root, 'extra/one.json'), JSON.stringify({ mcpServers: { one: { command: '${CLAUDE_PLUGIN_ROOT}/one' } } }));
    await put(join(root, 'extra/two.json'), JSON.stringify({ two: { command: 'two' } }));
    await put(join(root, '.lsp.json'), JSON.stringify({ gopls: { command: 'gopls' } }));
    await put(join(root, 'hooks/hooks.json'), JSON.stringify({ PreToolUse: [{ hooks: [{ type: 'command', command: 'check' }] }] }));
    await put(join(root, 'commands/git/commit.md'), '---\ndescription: Commits\n---\n');
    await put(join(root, 'commands/docs/commit.md'), '---\ndescription: Commits the docs\n---\n');
    const contents = await pluginContents(root, { mcpServers: ['./extra/one.json', './extra/two.json'], lspServers: { rust: { command: 'ra' } } }, root);
    assert.deepEqual(contents.mcpServers.map(server => server.name), ['github', 'one', 'two']);
    assert.equal(contents.mcpUsesPluginRoot, true);
    assert.deepEqual(contents.lspServers, ['gopls', 'rust']);
    assert.deepEqual(contents.hooks.map(hook => hook.event), ['PreToolUse']);
    // Two commands may share a name in different folders; their places in the plugin tell them apart.
    assert.deepEqual(contents.commands.map(command => [command.name, command.path]), [['commit', join('commands', 'docs', 'commit.md')], ['commit', join('commands', 'git', 'commit.md')]]);
  } finally { await cleanup(); }
});

test('A plugin’s instruction files are listed by their path in it, from the fixed places only, in the plugin’s own repository too', async () => {
  const { root, cleanup } = await box();
  try {
    const plugin = join(root, 'plugins/notes');
    for (const path of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.claude/CLAUDE.md', '.github/copilot-instructions.md', 'com.github.copilot/rules/plain.md', 'com.github.copilot/rules/scoped.instructions.md']) await put(join(plugin, path), `Read me: ${path}\n`);
    // Not instruction files here: a rules/ or instructions/ folder at the root (plugins keep other things there), a file
    // deeper in Copilot's rules folder, one that isn't Markdown, one inside a skill, and a manifest field naming one.
    for (const path of ['rules/style.md', 'instructions/style.instructions.md', 'com.github.copilot/rules/deeper/more.md', 'com.github.copilot/rules/notes.txt', 'skills/s/AGENTS.md']) await put(join(plugin, path), 'Not listed.\n');
    await put(join(plugin, 'skills/s/SKILL.md'), '---\nname: s\n---\n');
    await put(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'notes', instructions: './rules/style.md' }));
    const contents = await pluginContents(plugin, {}, root);
    assert.deepEqual(contents.instructions.map(file => file.path), ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', join('.claude', 'CLAUDE.md'), join('.github', 'copilot-instructions.md'), join('com.github.copilot', 'rules', 'plain.md'), join('com.github.copilot', 'rules', 'scoped.instructions.md')]);
    // Each is named by its path and holds its whole text, as a skill's file does.
    assert.deepEqual(contents.instructions[3], { name: join('.claude', 'CLAUDE.md'), description: '', text: 'Read me: .claude/CLAUDE.md\n', path: join('.claude', 'CLAUDE.md') });
  } finally { await cleanup(); }
});

test('A plugin holding only a CLAUDE.md holds that file and nothing else, and no tool has a line for it', async () => {
  const { root, cleanup } = await box();
  try {
    await put(join(root, 'plugins/atlas/CLAUDE.md'), 'You have access to Atlas through MCP tools.\n');
    const contents = await pluginContents(join(root, 'plugins/atlas'), {}, root);
    assert.deepEqual([contents.instructions.map(file => [file.name, file.text]), contents.skills, contents.commands, contents.agents, contents.hooks, contents.mcpServers],
      [[['CLAUDE.md', 'You have access to Atlas through MCP tools.\n']], [], [], [], [], []]);
    // No tool reads it, so "In each tool" has nothing to say of it (and so nothing to show as a limit on a tool's line).
    const components = componentsFrom(contents);
    assert.deepEqual((['claude-cli', 'copilot-cli', 'codex-cli'] as const).map(tool => outcomes(tool, components)), [[], [], []]);
  } finally { await cleanup(); }
});

test('A plugin holds only instruction files when nothing else in it could be a part: a manifest that only describes it, a README and a licence don’t count; an output style, Copilot’s hooks, a manifest naming another kind of part or holding a server, or a skill do', async () => {
  const { root, cleanup } = await box();
  try {
    const plugin = join(root, 'plugins/notes');
    await put(join(plugin, 'CLAUDE.md'), 'House style.\n');
    await put(join(plugin, 'com.github.copilot/rules/style.md'), 'House style.\n');
    await put(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'notes', version: '1.0.0', description: 'House style.', author: { name: 'Docs' } }));
    await put(join(plugin, 'README.md'), '# notes\n');
    await put(join(plugin, 'LICENSE'), 'MIT\n');
    const read = () => pluginContents(plugin, { name: 'notes', source: './plugins/notes', category: 'style' }, root);
    assert.equal((await read()).onlyInstructions, true);
    // A forced output style: Claude Code adds it to every session, though this reader names no such part.
    await put(join(plugin, 'output-styles/house.md'), '---\nname: House\nforce-for-plugin: true\n---\nWrite short sentences.\n');
    assert.equal((await read()).onlyInstructions, false, 'an output style');
    await rm(join(plugin, 'output-styles'), { recursive: true });
    // Copilot's own hooks folder, beside its rules: a part this reader doesn't read.
    await put(join(plugin, 'com.github.copilot/hooks/hooks.json'), '{"version":1,"hooks":{}}');
    assert.equal((await read()).onlyInstructions, false, 'Copilot’s hooks folder');
    await rm(join(plugin, 'com.github.copilot/hooks'), { recursive: true });
    // A manifest naming a kind of part this reader doesn't know, wherever its files are.
    await put(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'notes', outputStyles: './CLAUDE.md' }));
    assert.equal((await read()).onlyInstructions, false, 'a manifest naming output styles');
    // An MCP server written in the manifest itself: no file of its own, yet a part.
    await put(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'notes', mcpServers: { style: { command: 'style-mcp' } } }));
    assert.equal((await read()).onlyInstructions, false, 'a server in the manifest');
    // And a plugin with a skill holds more than instruction files.
    await put(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'notes' }));
    await put(join(plugin, 'skills/style/SKILL.md'), '---\nname: style\n---\n');
    assert.equal((await read()).onlyInstructions, false, 'a skill');
  } finally { await cleanup(); }
});

test('Each hook is kept as declared, in Claude Code’s form and Copilot CLI’s, and shown as it starts; start-of-session and prompt hooks are the ones that can add text, and each tool’s line says how', async () => {
  const { root, cleanup } = await box();
  try {
    const claudeStart = 'echo \'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Use the team style."}}\'';
    await put(join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: claudeStart }, { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/fresh.sh', timeout: 20 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'prompt', prompt: 'Is this safe?' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check-bash' }] }],
      // A command with its arguments (stripe's and zyte's form) is started directly, its arguments kept apart.
      Stop: [{ hooks: [{ type: 'command', command: 'uv', args: ['run', '--directory', '${CLAUDE_PLUGIN_ROOT}/hooks', 'end of turn.py'] }] }],
      // Copilot CLI's form: bash on macOS and Linux, else the command for every shell; a program started directly (exec) with
      // its own folder, variables and time limit.
      sessionStart: [{ type: 'command', bash: './start.sh', powershell: './start.ps1' }, { type: 'command', command: './any-shell.sh' },
        { type: 'command', exec: 'node', args: ['start.mjs', '--fast'], cwd: 'scripts', env: { MODE: 'quick' }, timeoutSec: 10 }],
      userPromptSubmitted: [{ type: 'command', powershell: './prompt.ps1' }],
    } }));
    const contents = await pluginContents(root, {}, root);
    const file = join(root, 'hooks/hooks.json');
    assert.deepEqual(contents.hooks, [
      { declaredIn: file, event: 'PreToolUse', matcher: 'Bash', at: 0, launch: { shell: 'check-bash' } },
      { declaredIn: file, event: 'SessionStart', matcher: 'startup', at: 0, launch: { shell: claudeStart } },
      { declaredIn: file, event: 'SessionStart', matcher: 'startup', at: 1, launch: { shell: '${CLAUDE_PLUGIN_ROOT}/hooks/fresh.sh' }, timeout: 20 },
      { declaredIn: file, event: 'Stop', at: 0, launch: { program: 'uv', args: ['run', '--directory', '${CLAUDE_PLUGIN_ROOT}/hooks', 'end of turn.py'] } },
      // A hook that starts no program (a prompt hook; one for PowerShell alone, on macOS and Linux) has no launch.
      { declaredIn: file, event: 'UserPromptSubmit', at: 0 },
      { declaredIn: file, event: 'sessionStart', at: 0, launch: { shell: './start.sh' } },
      { declaredIn: file, event: 'sessionStart', at: 1, launch: { shell: './any-shell.sh' } },
      { declaredIn: file, event: 'sessionStart', at: 2, launch: { program: 'node', args: ['start.mjs', '--fast'] }, timeout: 10, cwd: 'scripts', env: { MODE: 'quick' } },
      { declaredIn: file, event: 'userPromptSubmitted', at: 0 },
    ]);
    // Each is shown as it starts, an argument with a space quoted.
    assert.deepEqual(contents.hooks.map(hookLine).slice(3, 4), ['uv run --directory ${CLAUDE_PLUGIN_ROOT}/hooks "end of turn.py"']);
    const sessionText = (components: ReturnType<typeof componentsFrom>) => (['claude-cli', 'copilot-cli', 'codex-cli'] as const).map(tool => outcomes(tool, components).filter(outcome => outcome.component === 'Session text').map(outcome => [outcome.result, outcome.text]));
    assert.deepEqual(sessionText(componentsFrom(contents)), [
      [['works', 'comes from start-of-session and prompt hooks']],
      [['limited', 'is limited: Copilot CLI adds only what a start-of-session hook prints as `{"additionalContext": …}` at the top level; Claude Code’s `hookSpecificOutput` form and prompt hooks’ output are ignored']],
      [['limited', 'waits for trust: Codex runs a hook only after you trust it in `/hooks`']],
    ]);
    // A plugin whose hooks all listen elsewhere has hooks, and no Session text line.
    await put(join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'check-bash' }] }], Stop: [] } }));
    const only = componentsFrom(await pluginContents(root, {}, root));
    assert.deepEqual([only.hooks, only.sessionTextHooks, sessionText(only)], [true, false, [[], [], []]]);
    // An event listed with nothing under it declares no hook: nothing runs, so no hooks and no Session text line.
    await put(join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
    const none = componentsFrom(await pluginContents(root, {}, root));
    assert.deepEqual([none.hooks, none.sessionTextHooks], [false, false]);
    // A plugin in Copilot CLI's form alone: its start-of-session hook can add text too.
    await put(join(root, 'hooks/hooks.json'), JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: './start.sh' }] } }));
    assert.equal(componentsFrom(await pluginContents(root, {}, root)).sessionTextHooks, true);
  } finally { await cleanup(); }
});

test('How a hook starts on macOS and Linux, by each tool’s rule: `args`, even empty, starts the program directly; Copilot CLI’s `bash` comes before its `command`', async () => {
  const { root, cleanup } = await box();
  try {
    await put(join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/start.sh', args: [] }, { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/start.sh' }] }],
      sessionStart: [{ type: 'command', bash: './unix.sh', command: './any-shell.sh' }],
    } }));
    assert.deepEqual((await pluginContents(root, {}, root)).hooks.map(hook => hook.launch), [
      { program: '${CLAUDE_PLUGIN_ROOT}/start.sh', args: [] }, { shell: '${CLAUDE_PLUGIN_ROOT}/start.sh' }, { shell: './unix.sh' },
    ]);
  } finally { await cleanup(); }
});

test('A plugin’s hooks are read from every place they are declared: Copilot CLI’s own hooks files in its copy, and inline in a manifest or the marketplace entry', async () => {
  const { root, cleanup } = await box();
  try {
    // Copilot CLI's copy: hooks.json at its root, and an Agent Plugin's com.github.copilot/hooks/hooks.json. Claude Code reads neither.
    await put(join(root, 'hooks.json'), JSON.stringify({ hooks: { sessionStart: [{ type: 'command', bash: './root.sh' }] } }));
    await put(join(root, 'com.github.copilot/hooks/hooks.json'), JSON.stringify({ hooks: { userPromptSubmitted: [{ type: 'command', bash: './prompt.sh' }] } }));
    assert.deepEqual((await installedContents('copilot-cli', root)).hooks.map(hook => [hook.declaredIn, hookLine(hook)]),
      [[join(root, 'hooks.json'), './root.sh'], [join(root, 'com.github.copilot/hooks/hooks.json'), './prompt.sh']]);
    assert.deepEqual((await installedContents('claude-cli', root)).hooks, []);
    // Written inline in the marketplace entry: declared in the plugin's folder.
    const inline = await pluginContents(root, { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo inline' }] }] } }, root);
    assert.deepEqual(inline.hooks.map(hook => [hook.declaredIn, hookLine(hook)]), [[root, 'echo inline']]);
  } finally { await cleanup(); }
});

test('Nothing outside the marketplace is read, through a listed path or a link', { skip: noLinks }, async () => {
  const { base, root, cleanup } = await box();
  try {
    await put(join(base, 'private/notes.txt'), 'private');
    await put(join(base, 'private/SKILL.md'), '---\nname: leaked\n---\n');
    await mkdir(join(root, 'plugins/p/skills'), { recursive: true });
    await symlink(join(base, 'private/notes.txt'), join(root, 'plugins/p/README.md'));
    await symlink(join(base, 'private'), join(root, 'plugins/p/skills/linked'));
    await symlink(join(base, 'private/notes.txt'), join(root, 'plugins/p/CLAUDE.md'));
    assert.equal(await readmeIn(join(root, 'plugins/p'), root), undefined);
    assert.deepEqual((await pluginContents(join(root, 'plugins/p'), {}, root)).instructions, [], 'an instruction file linked to one outside is not read');
    const contents = await pluginContents(join(root, 'plugins/p'), { skills: ['../../../private'] }, root);
    assert.deepEqual(contents.skills, []);
    assert.deepEqual((await pluginContents(join(root, 'plugins/p'), {}, root)).skills, []);
    assert.equal(await inside(root, join(root, '..foo')), false);
    await mkdir(join(root, '..foo'));
    assert.equal(await inside(root, join(root, '..foo')), true, 'a folder named ..foo is still inside');
  } finally { await cleanup(); }
});

test('Only https links come back for sources and pages', () => {
  assert.deepEqual(sourceOf({ source: 'github', repo: 'example/notes', path: 'plugin' }), { label: 'GitHub: example/notes/plugin', url: 'https://github.com/example/notes/tree/HEAD/plugin' });
  assert.equal(sourceOf({ source: 'url', url: 'git@github.com:example/x.git' })?.url, undefined);
  assert.equal(sourceOf({ source: 'url', url: 'http://example.com/x.git' })?.url, undefined);
  assert.equal(remoteOf({ source: 'url', url: 'file:///etc' }), undefined);
  assert.deepEqual(remoteOf({ source: 'git-subdir', url: 'https://github.com/a/b.git', path: './plugins/x', ref: 'main' }), { url: 'https://github.com/a/b.git', path: 'plugins/x', ref: 'main', sha: undefined });
  assert.equal(marketplacePage('anthropics/skills'), 'https://github.com/anthropics/skills');
  assert.equal(marketplacePage('/Users/me/market'), undefined);
});

test('A skills path may name a folder of skills; a ref or sha that looks like an option is ignored', async () => {
  const { root, cleanup } = await box();
  try {
    for (const name of ['one', 'two']) await put(join(root, `custom/skills/${name}/SKILL.md`), `---\nname: ${name}\n---\n`);
    assert.deepEqual((await pluginContents(root, { skills: './custom/skills/' }, root)).skills.map(skill => skill.name), ['one', 'two']);
    assert.deepEqual(remoteOf({ source: 'github', repo: 'a/b', ref: '--upload-pack=x', sha: 'zz' }), { url: 'https://github.com/a/b.git', path: '', ref: undefined, sha: undefined });
  } finally { await cleanup(); }
});
