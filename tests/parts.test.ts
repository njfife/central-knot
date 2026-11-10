import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pluginFiles } from '../src/catalogdetail.ts';
import { installParts, partsDigest, readParts, removeParts, undoParts } from '../src/parts.ts';
import type { ShareContext } from '../src/share.ts';
import { readTomlTables } from '../src/textedit.ts';

const SKILL = '---\nname: figma-design\ndescription: Designs from Figma\n---\n\nUse the figma server.\n';
const AGENT = '---\nname: designer\ndescription: Turns designs into code\ntools: Read\n---\n\nYou design.\n';

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-parts-')));
  const home = join(base, 'home');
  const plugin = join(base, 'market', 'figma');
  await mkdir(join(plugin, 'skills', 'figma-design'), { recursive: true });
  await mkdir(join(plugin, 'agents'), { recursive: true });
  await mkdir(join(plugin, 'commands'), { recursive: true });
  await writeFile(join(plugin, 'skills', 'figma-design', 'SKILL.md'), SKILL);
  await writeFile(join(plugin, 'agents', 'designer.md'), AGENT);
  await writeFile(join(plugin, 'commands', 'export.md'), '# export\n');
  await writeFile(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: {
    figma: { command: 'npx', args: ['-y', 'figma-mcp'], env: { FIGMA_TOKEN: 'figd_abc123' } },
    local: { command: '${CLAUDE_PLUGIN_ROOT}/bin/server' },
    script: { command: 'node', args: ['scripts/server.js'] },
    remote: { command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.example.com/sse'] },
  } }));
  await mkdir(join(plugin, 'scripts'), { recursive: true });
  await writeFile(join(plugin, 'scripts', 'server.js'), '');
  for (const folder of ['.codex', '.copilot', '.pi/agent']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const files = () => pluginFiles(plugin, {}, join(base, 'market'));
  return { home, plugin, context, files, cleanup: () => rm(base, { recursive: true, force: true }) };
}
const target = { source: '/market', marketName: 'design', plugin: 'figma', version: '1.0.0' };

test('Parts go into Codex and Pi in their own formats, values as they are, and Undo takes them out', async () => {
  const box = await sandbox();
  try {
    const codex = await installParts(box.context, { ...target, tool: 'codex-cli' }, await box.files());
    assert.equal(codex.outcome, 'installed', codex.message);
    assert.equal(await readFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), 'utf8'), SKILL);
    const toml = readTomlTables(await readFile(join(box.home, '.codex/config.toml'), 'utf8'));
    assert.equal(toml.find(table => table.path.join('.') === 'mcp_servers.figma')?.entries.find(entry => entry.key === 'command')?.value, 'npx');
    assert.equal(toml.find(table => table.path.join('.') === 'mcp_servers.figma.env')?.entries[0]?.value, 'figd_abc123');
    assert.ok(!toml.some(table => table.path[1] === 'local'), 'a server needing the plugin folder stays behind');
    assert.match(codex.message, /local: It runs from the plugin’s own folder/);
    // A script in the plugin's folder isn't copied, so that server stays behind; a URL argument is no such file.
    assert.match(codex.message, /script: It runs files from the plugin’s own folder/);
    assert.ok(toml.some(table => table.path.join('.') === 'mcp_servers.remote'));
    assert.match(await readFile(join(box.home, '.codex/agents/designer.toml'), 'utf8'), /developer_instructions/);

    const copilot = await installParts(box.context, { ...target, tool: 'copilot-cli' }, await box.files());
    assert.equal(copilot.outcome, 'installed', copilot.message);
    const copilotMcp = JSON.parse(await readFile(join(box.home, '.copilot/mcp-config.json'), 'utf8'));
    assert.deepEqual(copilotMcp.mcpServers.figma, { type: 'local', command: 'npx', args: ['-y', 'figma-mcp'], env: { FIGMA_TOKEN: 'figd_abc123' }, tools: ['*'] });
    assert.match(await readFile(join(box.home, '.copilot/agents/designer.agent.md'), 'utf8'), /description: Turns designs into code/);

    // Pi's skills folder is a link into the shared .agents folder: never written through, as on the Skills page.
    await mkdir(join(box.home, '.agents/skills'), { recursive: true });
    await rm(join(box.home, '.pi/agent/skills'), { recursive: true, force: true });
    await symlink(join(box.home, '.agents/skills'), join(box.home, '.pi/agent/skills'));
    const pi = await installParts(box.context, { ...target, tool: 'pi-cli' }, await box.files());
    assert.equal(pi.outcome, 'installed', pi.message);
    assert.match(pi.notes?.join(' ') ?? '', /skills folder is a link/);
    await assert.rejects(readFile(join(box.home, '.agents/skills/figma-design/SKILL.md')));
    const piMcp = JSON.parse(await readFile(join(box.home, '.pi/agent/mcp.json'), 'utf8'));
    assert.deepEqual(piMcp.mcpServers.figma, { type: 'stdio', command: 'npx', args: ['-y', 'figma-mcp'], env: { FIGMA_TOKEN: 'figd_abc123' } });
    assert.match(pi.message, /designer: Pi has no agents/);

    const record = await readParts(box.home);
    assert.deepEqual(record.find(entry => entry.tool === 'codex-cli')?.items.map(item => `${item.kind}:${item.name}`).sort(), ['agent:designer', 'mcp:figma', 'mcp:remote', 'skill:figma-design']);
    assert.equal(record[0]?.version, '1.0.0');

    // An agent whose front matter stops parsing is no sign the plugin dropped it: the installed copy stays.
    await writeFile(join(box.plugin, 'agents', 'designer.md'), '---\nname: [\n---\n\nBroken.\n');
    await installParts(box.context, { ...target, tool: 'codex-cli' }, await box.files());
    assert.match(await readFile(join(box.home, '.codex/agents/designer.toml'), 'utf8'), /You design/);
    await writeFile(join(box.plugin, 'agents', 'designer.md'), AGENT);

    const undone = await undoParts(box.context, codex.partsRun ?? '');
    assert.equal(undone?.outcome, 'uninstalled', undone?.message ?? '');
    await assert.rejects(readFile(join(box.home, '.codex/skills/figma-design/SKILL.md')));
    await assert.rejects(readFile(join(box.home, '.codex/agents/designer.toml')));
    assert.doesNotMatch(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /figma/);
    assert.deepEqual((await readParts(box.home)).map(entry => entry.tool), ['copilot-cli', 'pi-cli']);
  } finally { await box.cleanup(); }
});

test('Parts never replace what was there, removing keeps an edited or managed part, and Undo of a removal puts back only what it took', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.pi/agent/skills/figma-design'), { recursive: true });
    await writeFile(join(box.home, '.pi/agent/skills/figma-design/SKILL.md'), '---\ndescription: mine\n---\nMine.\n');
    // A server of this name is managed (it syncs from another tool): its own page decides where it goes.
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    await writeFile(join(box.home, '.central-knot/mcp.json'), JSON.stringify({ formatVersion: 1, items: { remote: { state: 'shared', off: ['pi-cli'], hash: '', copies: [] } } }));
    const pi = await installParts(box.context, { ...target, tool: 'pi-cli' }, await box.files());
    assert.equal(pi.outcome, 'installed');
    assert.match(pi.notes?.join(' ') ?? '', /Pi already has one of that name[\s\S]*“remote”: one of that name is managed/);
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/figma-design/SKILL.md'), 'utf8'), '---\ndescription: mine\n---\nMine.\n');

    // A part the person deletes stays out: neither this update nor the next one puts it back.
    await installParts(box.context, { ...target, tool: 'copilot-cli' }, await box.files());
    await rm(join(box.home, '.copilot/agents/designer.agent.md'));
    const update = await installParts(box.context, { ...target, tool: 'copilot-cli' }, await box.files());
    assert.match(update.notes?.join(' ') ?? '', /Left out the agent “designer”: it was removed/);
    await installParts(box.context, { ...target, tool: 'copilot-cli' }, await box.files());
    await assert.rejects(readFile(join(box.home, '.copilot/agents/designer.agent.md')));
    // Every part removed by hand: an update finds none left, says so, and leaves nothing to undo that would bring them back.
    await rm(join(box.home, '.copilot/skills/figma-design'), { recursive: true });
    await rm(join(box.home, '.copilot/mcp-config.json'));
    const none = await installParts(box.context, { ...target, version: '1.1.0', tool: 'copilot-cli' }, await box.files());
    assert.match(none.message, /None of its parts are in Copilot CLI any more/);
    assert.equal(none.partsRun, undefined);

    // The managed "remote" was only for Pi's step; Codex gets every part.
    await rm(join(box.home, '.central-knot/mcp.json'));
    await installParts(box.context, { ...target, tool: 'codex-cli' }, await box.files());
    await writeFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), `${SKILL}Edited.\n`);
    // Deleted by hand before the removal below: its Undo must not bring it back.
    await rm(join(box.home, '.codex/agents/designer.toml'));
    // The MCP server was managed since: removing it would spread a deletion through sync, so it stays.
    await writeFile(join(box.home, '.central-knot/mcp.json'), JSON.stringify({ formatVersion: 1, items: { figma: { state: 'shared', off: [], hash: '', copies: [] } } }));
    const removed = await removeParts(box.context, { ...target, tool: 'codex-cli' });
    assert.equal(removed.outcome, 'uninstalled', removed.message);
    assert.match(removed.notes?.join(' ') ?? '', /changed after it was installed[\s\S]*managed now/);
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /figma-mcp/);
    assert.match(await readFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), 'utf8'), /Edited/);
    await assert.rejects(readFile(join(box.home, '.codex/agents/designer.toml')));

    assert.doesNotMatch(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /mcp-remote/);

    // Undo puts back what the removal took out (the remote server), not what the person had deleted before it (the agent).
    const back = await undoParts(box.context, removed.partsRun ?? '');
    assert.equal(back?.outcome, 'installed', back?.message ?? '');
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /mcp-remote/);
    await assert.rejects(readFile(join(box.home, '.codex/agents/designer.toml')));
  } finally { await box.cleanup(); }
});

test('Updates: changed parts replaced, dropped ones removed, unreadable sources and edited settings left alone', async () => {
  const box = await sandbox();
  try {
    await installParts(box.context, { ...target, tool: 'codex-cli' }, await box.files());
    const installed = (await readParts(box.home))[0]!;
    assert.equal(await partsDigest(box.context, await box.files(), 'codex-cli'), installed.digest);
    await writeFile(join(box.plugin, 'skills', 'figma-design', 'SKILL.md'), SKILL.replace('Use the figma server.', 'Use the figma server, v2.'));
    await rm(join(box.plugin, 'agents'), { recursive: true });
    assert.notEqual(await partsDigest(box.context, await box.files(), 'codex-cli'), installed.digest);

    const updated = await installParts(box.context, { ...target, version: '2.0.0', tool: 'codex-cli' }, await box.files());
    assert.equal(updated.outcome, 'installed', updated.message);
    assert.match(await readFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), 'utf8'), /v2/);
    await assert.rejects(readFile(join(box.home, '.codex/agents/designer.toml')));
    assert.equal((await readParts(box.home))[0]?.version, '2.0.0');

    const back = await undoParts(box.context, updated.partsRun ?? '');
    assert.equal(back?.outcome, 'installed', back?.message ?? '');
    assert.doesNotMatch(await readFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), 'utf8'), /v2/);
    assert.match(await readFile(join(box.home, '.codex/agents/designer.toml'), 'utf8'), /You design/);
    assert.equal((await readParts(box.home))[0]?.version, '1.0.0');

    // A SKILL.md that can't be opened now is no sign the plugin dropped its skill: the installed copy stays.
    const pluginSkill = join(box.plugin, 'skills', 'figma-design', 'SKILL.md');
    await chmod(pluginSkill, 0o000);
    await installParts(box.context, { ...target, version: '2.0.0', tool: 'codex-cli' }, await box.files());
    await chmod(pluginSkill, 0o644);
    assert.ok((await readParts(box.home))[0]?.items.some(item => item.kind === 'skill'));
    // Nor is a skills folder that can't be listed.
    await chmod(join(box.plugin, 'skills'), 0o000);
    await installParts(box.context, { ...target, version: '2.0.0', tool: 'codex-cli' }, await box.files());
    await chmod(join(box.plugin, 'skills'), 0o755);
    assert.ok((await readParts(box.home))[0]?.items.some(item => item.kind === 'skill'));
    // A servers file that can't be read now is no sign the plugin dropped its server: the installed one stays.
    for (const unreadable of ['{ not json', '{ "mcpServers": null }', '{ "mcpServers": { "figma": null } }']) {
      await writeFile(join(box.plugin, '.mcp.json'), unreadable);
      await installParts(box.context, { ...target, version: '2.0.0', tool: 'codex-cli' }, await box.files());
      assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /figma-mcp/, unreadable);
    }
    await writeFile(join(box.plugin, '.mcp.json'), JSON.stringify({ mcpServers: { figma: { command: 'npx', args: ['-y', 'figma-mcp'] } } }));
    // A plugin.json that can't be read may declare other folders for any part: nothing installed is read as dropped.
    await mkdir(join(box.plugin, '.claude-plugin'), { recursive: true });
    await writeFile(join(box.plugin, '.claude-plugin', 'plugin.json'), '{ broken');
    await installParts(box.context, { ...target, version: '2.0.0', tool: 'codex-cli' }, await box.files());
    assert.deepEqual((await readParts(box.home))[0]?.items.map(item => item.kind).sort(), ['mcp', 'skill']);
    await rm(join(box.plugin, '.claude-plugin'), { recursive: true });
    const config = join(box.home, '.codex/config.toml');
    // A settings file that can't be read right now is a failure, not an edit: the parts stay on record to try again.
    const good = await readFile(config, 'utf8');
    await writeFile(config, `${good}\n[broken`);
    assert.equal((await removeParts(box.context, { ...target, tool: 'codex-cli' })).outcome, 'failed');
    assert.ok((await readParts(box.home)).some(entry => entry.items.some(item => item.kind === 'mcp')));
    await writeFile(config, good);
    // A setting of Codex's own added to the server is an edit: removing the parts leaves that server.
    await writeFile(config, (await readFile(config, 'utf8')).replace('[mcp_servers.figma]\n', '[mcp_servers.figma]\nenabled = false\n'));
    const removed = await removeParts(box.context, { ...target, tool: 'codex-cli' });
    assert.match(removed.notes?.join(' ') ?? '', /MCP server “figma” as it is: it was changed/);
    assert.match(await readFile(config, 'utf8'), /enabled = false/);

    // A skills folder made a link later: the skill needs no write, so an update that changes only another part still succeeds.
    await writeFile(config, '');
    await installParts(box.context, { ...target, tool: 'codex-cli' }, await box.files());
    await rename(join(box.home, '.codex/skills'), join(box.home, 'linked-skills'));
    await symlink(join(box.home, 'linked-skills'), join(box.home, '.codex/skills'));
    await writeFile(join(box.plugin, '.mcp.json'), JSON.stringify({ mcpServers: { figma: { command: 'npx', args: ['-y', 'figma-mcp@2'] } } }));
    const linked = await installParts(box.context, { ...target, version: '3.0.0', tool: 'codex-cli' }, await box.files());
    assert.equal(linked.outcome, 'installed', linked.message);
    assert.match(await readFile(config, 'utf8'), /figma-mcp@2/);
  } finally { await box.cleanup(); }
});
