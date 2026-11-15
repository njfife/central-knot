import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { harnessIds } from '../src/harnesses.ts';
import { agentsView, applyAgents } from '../src/agents.ts';
import { managedNow } from '../src/share.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { applyServers, serversView } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const text = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`;
const exists = (path: string) => lstat(path).then(() => true, () => false);
const put = async (path: string, content: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); };

test('a tool that has a skill through an installed plugin has it another way, and gets no separate copy', async () => {
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

    const tools = await managedNow(context, await read());
    const facts = (await skillsView(context, tools)).items;
    const triage = facts.find(skill => skill.key === 'triage')!;
    assert.deepEqual(triage.plugin, { 'claude-cli': { plugin: 'issue-tracker', marketplace: 'team', version: '1.2.0', name: 'triage' } });
    assert.match(triage.anotherWay?.['claude-cli'] ?? '', /^Claude Code has this skill through the plugin issue-tracker \(version 1\.2\.0\), so no separate copy is placed there\.$/);
    // A copy of its own is the tool's copy, whatever a plugin also holds: no plugin row for it there.
    assert.equal(facts.find(skill => skill.key === 'notes')!.plugin, undefined);
    // A name alone doesn't make two skills one: Pi's own standup stays an ordinary skill Claude Code has no copy of.
    const standup = facts.find(skill => skill.key === 'standup')!;
    assert.deepEqual([standup.plugin, standup.anotherWay?.['claude-cli']], [undefined, undefined]);

    // Taken in: the tool without it gets a copy; the tool with the plugin gets none beside it.
    const result = await applySkills(context, tools, [{ key: 'triage', on: true, except: [] }]);
    assert.equal(result.stopped, undefined);
    assert.deepEqual([await exists(join(home, '.copilot/skills/triage/SKILL.md')), await exists(join(home, '.claude/skills/triage'))], [true, false]);
    assert.equal((await applySkills({ ...context, settleMs: 0 }, tools, [])).writes, 0, 'and it stays so');
    // Taken in where a tool has it through the plugin and a copy of its own: that copy, never Central Knot's, stays (both ways).
    await applySkills(context, tools, [{ key: 'notes', on: true, except: [] }]);
    assert.equal(await readFile(join(home, '.claude/skills/notes/SKILL.md'), 'utf8'), text('notes'));

    // The plugin turned off in Claude Code still holds the skill there: said so, and still no separate copy.
    await put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'issue-tracker@team': false } }));
    const off = (await skillsView(context, tools)).items.find(skill => skill.key === 'triage')!;
    assert.equal(off.plugin?.['claude-cli']?.off, true);
    assert.match(off.anotherWay?.['claude-cli'] ?? '', /turned off there/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('an MCP server or agent a tool has through a plugin is not claimed by its name alone, nor by a part of its name waiting to be moved to the library, and while one waits nothing of that name is taken in or written', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-parts-')));
  const home = join(base, 'home');
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
  try {
    // Codex has both as its own items (as a plugin's parts leave them); Copilot CLI has the server as the person's own, and no agent.
    await put(join(home, '.codex/config.toml'), '[mcp_servers.issues]\ncommand = "npx"\nargs = ["-y", "@example/issues-mcp"]\n');
    await put(join(home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'npx', args: ['-y', '@example/issues-mcp'], tools: ['*'] } } }));
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
    // A name alone could be another server or agent: nothing is claimed until the library's item is linked to that plugin
    // (plugins.ts linkedToPlugin), which for a part from before the library is at its move.
    assert.equal((await serversView(context, tools)).items.find(item => item.key === 'issues')!.plugin, undefined);
    assert.equal((await agentsView(context, tools)).items.find(item => item.key === 'triager')!.plugin, undefined);
    await put(join(home, '.central-knot/plugin-parts.json'), JSON.stringify({ installs: [{ source: '/markets/team', marketName: 'team', plugin: 'issue-tracker', version: '1.2.0', tool: 'codex-cli', at: '2026-11-10T00:00:00.000Z', digest: 'd',
      items: [{ kind: 'mcp', name: 'issues', hash: 'h' }, { kind: 'agent', name: 'triager', hash: 'h' }] }] }));

    const server = (await serversView(context, tools)).items.find(item => item.key === 'issues')!;
    // Codex's entry is the plugin's part there, and Copilot CLI's of that name his own: both wait (partsmigrate.ts hideParts).
    const waiting = 'A plugin’s part of this name is waiting to be moved to the library, so nothing changes here until it is.';
    assert.deepEqual([server.plugin, server.unseen?.['codex-cli'], server.unseen?.['copilot-cli']], [undefined, waiting, waiting]);
    const agent = (await agentsView(context, tools)).items.find(item => item.key === 'triager')!;
    assert.deepEqual([agent.plugin, agent.unseen?.['codex-cli']], [undefined, waiting]);
    const before = [await readFile(join(home, '.claude.json'), 'utf8'), await readFile(join(home, '.codex/config.toml'), 'utf8'), await readFile(join(home, '.copilot/mcp-config.json'), 'utf8')];
    const served = await applyServers(context, tools, [{ key: 'issues', on: true, except: [] }]);
    const sorted = await applyAgents(context, tools, [{ key: 'triager', on: true, except: [] }]);
    assert.deepEqual([served.results[0]?.message, sorted.results[0]?.message], ['No tool has a copy of it to take in any more.', 'No tool has a copy of it to take in any more.']);
    assert.deepEqual([await readFile(join(home, '.claude.json'), 'utf8'), await readFile(join(home, '.codex/config.toml'), 'utf8'), await readFile(join(home, '.copilot/mcp-config.json'), 'utf8')], before);
    assert.deepEqual([await exists(join(home, '.copilot/agents/triager.agent.md')), await exists(join(home, '.claude/agents/triager.md'))], [false, false]);
  } finally { await rm(base, { recursive: true, force: true }); }
});
