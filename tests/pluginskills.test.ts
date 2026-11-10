import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { agentsView, applyAgents } from '../src/agents.ts';
import { applyChanges, manageView } from '../src/manage.ts';
import { applyMcp, mcpView } from '../src/mcp.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const text = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`;
const exists = (path: string) => lstat(path).then(() => true, () => false);
const put = async (path: string, content: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); };

test('a tool that has a skill through an installed plugin is shown as that, and gets no separate copy', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-skills-')));
  const home = join(base, 'home');
  try {
    // Pi has the skill as its own item (as a plugin's parts leave it); Copilot CLI is here with nothing.
    await put(join(home, '.pi/agent/skills/triage/SKILL.md'), text('triage'));
    await put(join(home, '.pi/agent/skills/notes/SKILL.md'), text('notes'));
    await mkdir(join(home, '.copilot'), { recursive: true });
    // Claude Code has the plugin: its copy holds `triage` and `notes`, and Claude Code also has its own copy of `notes`.
    const copy = join(home, '.claude/plugins/cache/team/issue-tracker/1.2.0');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'issue-tracker', version: '1.2.0' }));
    await put(join(copy, 'skills/triage/SKILL.md'), text('triage'));
    await put(join(copy, 'skills/notes/SKILL.md'), text('notes'));
    await put(join(home, '.claude/skills/notes/SKILL.md'), text('notes'));
    // A skill of Pi's own that only shares its name with one of the plugin's: another skill.
    await put(join(home, '.pi/agent/skills/standup/SKILL.md'), text('standup'));
    await put(join(copy, 'skills/standup/SKILL.md'), '---\nname: standup\ndescription: Something else entirely.\n---\n\nOther.\n');
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'issue-tracker@team': [{ scope: 'user', installPath: copy, version: '1.2.0' }] } }));
    const read = () => Promise.all(harnessIds.map(harness => discover({ home, mode: 'custom', harness })));
    const context: ShareContext = { home, mode: 'custom', read, build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };

    const facts = (await manageView(context)).skills;
    const triage = facts.find(skill => skill.key === 'triage')!;
    assert.deepEqual(triage.plugin, { 'claude-cli': { plugin: 'issue-tracker', marketplace: 'team', version: '1.2.0' } });
    assert.match(triage.cannot['claude-cli'] ?? '', /^Claude Code has this skill through the plugin issue-tracker \(version 1\.2\.0\), so no separate copy is placed there\.$/);
    // A copy of its own is an ordinary copy, whatever a plugin also holds.
    assert.equal(facts.find(skill => skill.key === 'notes')!.plugin, undefined);
    // A name alone doesn't make two skills one: Pi's own standup stays an ordinary skill Claude Code has no copy of.
    const standup = facts.find(skill => skill.key === 'standup')!;
    assert.deepEqual([standup.plugin, standup.cannot['claude-cli']], [undefined, undefined]);

    // Managed: the tool without it gets a copy; the tool with the plugin gets none beside it.
    const result = await applyChanges(context, [{ key: 'triage', managed: true, off: [] }]);
    assert.equal(result.stopped, undefined);
    assert.deepEqual([await exists(join(home, '.copilot/skills/triage/SKILL.md')), await exists(join(home, '.claude/skills/triage'))], [true, false]);

    // The plugin turned off in Claude Code still holds the skill there: said so, and still no separate copy.
    await put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'issue-tracker@team': false } }));
    const off = (await manageView(context)).skills.find(skill => skill.key === 'triage')!;
    assert.equal(off.plugin?.['claude-cli']?.off, true);
    assert.match(off.cannot['claude-cli'] ?? '', /turned off there/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('an MCP server or agent a tool has through a plugin gets no entry or file of its own there', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-parts-')));
  const home = join(base, 'home');
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  try {
    // Codex has both as its own items (as a plugin's parts leave them); Copilot CLI has neither.
    await put(join(home, '.codex/config.toml'), '[mcp_servers.issues]\ncommand = "npx"\nargs = ["-y", "@example/issues-mcp"]\n');
    await put(join(home, '.codex/agents/triager.toml'), 'name = "triager"\ndescription = "Sorts issues"\ndeveloper_instructions = "Sort new issues."\n');
    await mkdir(join(home, '.copilot/agents'), { recursive: true });
    await put(join(home, '.claude.json'), '{}\n');
    // Claude Code has the plugin, which holds a server and an agent of those names.
    const copy = join(home, '.claude/plugins/cache/team/issue-tracker/1.2.0');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'issue-tracker', version: '1.2.0' }));
    await put(join(copy, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['-y', '@example/issues-mcp'] } } }));
    await put(join(copy, 'agents/triager.md'), '---\nname: triager\ndescription: Sorts issues\n---\n\nSort new issues.\n');
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'issue-tracker@team': [{ scope: 'user', installPath: copy, version: '1.2.0' }] } }));
    const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
    const from = { plugin: 'issue-tracker', marketplace: 'team', version: '1.2.0' };

    // A name alone could be another server or agent: nothing is claimed until they are on record as that plugin's parts.
    assert.equal((await mcpView(context, tools)).servers.find(item => item.key === 'issues')!.plugin, undefined);
    assert.equal((await agentsView(context, tools)).servers.find(item => item.key === 'triager')!.plugin, undefined);
    await put(join(home, '.central-knot/plugin-parts.json'), JSON.stringify({ installs: [{ source: '/markets/team', marketName: 'team', plugin: 'issue-tracker', version: '1.2.0', tool: 'codex-cli', at: '2026-11-10T00:00:00.000Z', digest: 'd',
      items: [{ kind: 'mcp', name: 'issues', hash: 'h' }, { kind: 'agent', name: 'triager', hash: 'h' }] }] }));

    const server = (await mcpView(context, tools)).servers.find(item => item.key === 'issues')!;
    assert.deepEqual([server.plugin, server.cannot['claude-cli']], [{ 'claude-cli': from }, 'Claude Code has this MCP server through the plugin issue-tracker (version 1.2.0), so no separate copy is placed there.']);
    const served = await applyMcp(context, tools, [{ key: 'issues', managed: true, off: [] }], { claudeNow: ['issues'] });
    assert.equal(served.stopped, undefined);
    assert.ok(JSON.parse(await readFile(join(home, '.copilot/mcp-config.json'), 'utf8')).mcpServers.issues, 'the tool without it gets the server');
    assert.equal(await readFile(join(home, '.claude.json'), 'utf8'), '{}\n', 'Claude Code, which has it through the plugin, is not written');

    const agent = (await agentsView(context, tools)).servers.find(item => item.key === 'triager')!;
    assert.deepEqual([agent.plugin, agent.cannot['claude-cli']], [{ 'claude-cli': from }, 'Claude Code has this agent through the plugin issue-tracker (version 1.2.0), so no separate copy is placed there.']);
    const sorted = await applyAgents(context, tools, [{ key: 'triager', managed: true, off: [] }]);
    assert.equal(sorted.stopped, undefined);
    assert.deepEqual([await exists(join(home, '.copilot/agents/triager.agent.md')), await exists(join(home, '.claude/agents/triager.md'))], [true, false]);
    // Settled: a later pass neither writes there nor reads the missing copy as a deletion.
    const again = await applyAgents({ ...context, settleMs: 0 }, tools, []);
    assert.deepEqual([again.writes, await exists(join(home, '.copilot/agents/triager.agent.md')), await exists(join(home, '.codex/agents/triager.toml'))], [0, true, true]);
    assert.equal((await applyMcp({ ...context, settleMs: 0 }, tools, [], { settleMs: 0 })).writes, 0);
    assert.ok(JSON.parse(await readFile(join(home, '.copilot/mcp-config.json'), 'utf8')).mcpServers.issues);
  } finally { await rm(base, { recursive: true, force: true }); }
});
