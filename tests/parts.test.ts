import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  } }));
  for (const folder of ['.codex', '.pi/agent']) await mkdir(join(home, folder), { recursive: true });
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
    assert.match(await readFile(join(box.home, '.codex/agents/designer.toml'), 'utf8'), /developer_instructions/);

    const pi = await installParts(box.context, { ...target, tool: 'pi-cli' }, await box.files());
    assert.equal(pi.outcome, 'installed', pi.message);
    const piMcp = JSON.parse(await readFile(join(box.home, '.pi/agent/mcp.json'), 'utf8'));
    assert.deepEqual(piMcp.mcpServers.figma, { type: 'stdio', command: 'npx', args: ['-y', 'figma-mcp'], env: { FIGMA_TOKEN: 'figd_abc123' } });
    assert.match(pi.message, /designer: Pi has no agents/);

    const record = await readParts(box.home);
    assert.deepEqual(record.find(entry => entry.tool === 'codex-cli')?.items.map(item => `${item.kind}:${item.name}`).sort(), ['agent:designer', 'mcp:figma', 'skill:figma-design']);
    assert.equal(record[0]?.version, '1.0.0');

    const undone = await undoParts(box.context, codex.partsRun ?? '');
    assert.equal(undone?.outcome, 'uninstalled', undone?.message ?? '');
    await assert.rejects(readFile(join(box.home, '.codex/skills/figma-design/SKILL.md')));
    await assert.rejects(readFile(join(box.home, '.codex/agents/designer.toml')));
    assert.doesNotMatch(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /figma/);
    assert.deepEqual((await readParts(box.home)).map(entry => entry.tool), ['pi-cli']);
  } finally { await box.cleanup(); }
});

test('Parts never replace what was there, removing keeps an edited or managed part, and Undo of a removal puts the rest back', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.pi/agent/skills/figma-design'), { recursive: true });
    await writeFile(join(box.home, '.pi/agent/skills/figma-design/SKILL.md'), '---\ndescription: mine\n---\nMine.\n');
    const pi = await installParts(box.context, { ...target, tool: 'pi-cli' }, await box.files());
    assert.equal(pi.outcome, 'installed');
    assert.match(pi.notes?.join(' ') ?? '', /Pi already has one of that name/);
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/figma-design/SKILL.md'), 'utf8'), '---\ndescription: mine\n---\nMine.\n');

    await installParts(box.context, { ...target, tool: 'codex-cli' }, await box.files());
    await writeFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), `${SKILL}Edited.\n`);
    // The MCP server was managed since: removing it would spread a deletion through sync, so it stays.
    await writeFile(join(box.home, '.central-knot/mcp.json'), JSON.stringify({ formatVersion: 1, items: { figma: { state: 'shared', off: [], hash: '', copies: [] } } }));
    const removed = await removeParts(box.context, { ...target, tool: 'codex-cli' });
    assert.equal(removed.outcome, 'uninstalled', removed.message);
    assert.match(removed.notes?.join(' ') ?? '', /changed after it was installed[\s\S]*managed now/);
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /figma-mcp/);
    assert.match(await readFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), 'utf8'), /Edited/);
    await assert.rejects(readFile(join(box.home, '.codex/agents/designer.toml')));

    const back = await undoParts(box.context, removed.partsRun ?? '');
    assert.equal(back?.outcome, 'installed', back?.message ?? '');
    assert.match(await readFile(join(box.home, '.codex/agents/designer.toml'), 'utf8'), /You design/);
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /figma-mcp/);
  } finally { await box.cleanup(); }
});

test('A changed plugin shows as changed, and updating replaces unchanged parts and drops ones it no longer has', async () => {
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
  } finally { await box.cleanup(); }
});
