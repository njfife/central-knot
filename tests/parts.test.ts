import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pluginFiles } from '../src/catalogdetail.ts';
import { discover } from '../src/discovery.ts';
import { applyChanges } from '../src/manage.ts';
import { installParts, partsDigest, planParts, readParts, removeParts, undoParts } from '../src/parts.ts';
import { saveProfile, switchProfile } from '../src/profiles.ts';
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
    await writeFile(config, (await readFile(config, 'utf8')).replace('[mcp_servers.figma]\n', '[mcp_servers.figma]\nstartup_timeout_sec = 30\n'));
    const removed = await removeParts(box.context, { ...target, tool: 'codex-cli' });
    assert.match(removed.notes?.join(' ') ?? '', /MCP server “figma” as it is: it was changed/);
    assert.match(await readFile(config, 'utf8'), /startup_timeout_sec = 30/);

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

test('A Disable of a part skill in its tool keeps the kept copy that Undo of Remove parts needs', async () => {
  const box = await sandbox();
  box.context.read = async () => [await discover({ home: box.home, mode: 'custom', harness: 'codex-cli' })];
  box.context.settleMs = 0;
  try {
    assert.equal((await installParts(box.context, { ...target, tool: 'codex-cli' }, await box.files())).outcome, 'installed');
    // The Disable makes a sync record entry for the name, and its History write prunes the store.
    const disabled = await applyChanges(box.context, [{ key: 'figma-design', managed: false, off: [], disable: ['codex-cli'] }]);
    assert.equal(disabled.results[0]?.outcome, 'switched');
    const removed = await removeParts(box.context, { ...target, tool: 'codex-cli' });
    const undone = await undoParts(box.context, removed.partsRun!);
    assert.equal(undone?.outcome, 'installed', undone?.message ?? '');
    assert.equal(await readFile(join(box.home, '.codex/skills/figma-design/SKILL.md'), 'utf8'), SKILL);
  } finally { await box.cleanup(); }
});

test('A profile turning a part MCP server off is no edit: Remove parts still takes it out of Codex and Pi', async () => {
  const box = await sandbox();
  box.context.settleMs = 0;
  try {
    for (const tool of ['codex-cli', 'pi-cli'] as const) {
      box.context.read = async () => [await discover({ home: box.home, mode: 'custom', harness: tool })];
      assert.equal((await installParts(box.context, { ...target, tool }, await box.files())).outcome, 'installed');
      const profile = (await saveProfile(box.context, { name: `Off ${tool}`, items: [] })).id!;
      assert.equal((await switchProfile(box.context, profile)).stopped, undefined);
      const file = join(box.home, tool === 'codex-cli' ? '.codex/config.toml' : '.pi/agent/mcp.json');
      assert.match(await readFile(file, 'utf8'), /"?enabled"?\s*[=:]\s*false/);
      const removed = await removeParts(box.context, { ...target, tool });
      assert.equal(removed.outcome, 'uninstalled', removed.message);
      assert.doesNotMatch(await readFile(file, 'utf8'), /mcp_servers\.figma\b|"figma"/);
      await switchProfile(box.context, null);
    }
  } finally { await box.cleanup(); }
});

test('Claude Code with no CLI takes a plugin’s skills and agents as they are, and no MCP servers, which only Write to Claude Code writes', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.claude'), { recursive: true });
    const claude = await installParts(box.context, { ...target, tool: 'claude-cli' }, await box.files());
    assert.equal(claude.outcome, 'installed', claude.message);
    assert.equal(await readFile(join(box.home, '.claude/skills/figma-design/SKILL.md'), 'utf8'), SKILL);
    assert.equal(await readFile(join(box.home, '.claude/agents/designer.md'), 'utf8'), AGENT);
    await assert.rejects(readFile(join(box.home, '.claude.json')));
    assert.match(claude.message, /figma: Claude Code’s MCP servers are written only with Write to Claude Code/);
  } finally { await box.cleanup(); }
});

/** A sandbox whose plugin has three skills (figma-design, tdd, grill-me) and nothing else Pi takes. */
async function threeSkills() {
  const box = await sandbox();
  for (const name of ['tdd', 'grill-me']) {
    await mkdir(join(box.plugin, 'skills', name), { recursive: true });
    await writeFile(join(box.plugin, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n\n${name}\n`);
  }
  await rm(join(box.plugin, '.mcp.json'));
  const pi = (name: string) => join(box.home, '.pi/agent/skills', name);
  const inPi = async () => (await Promise.all(['figma-design', 'grill-me', 'tdd'].map(async name => (await readFile(join(pi(name), 'SKILL.md'), 'utf8').then(() => name, () => ''))))).filter(Boolean);
  return { ...box, pi, inPi, to: { ...target, tool: 'pi-cli' as const } };
}
const skill = (name: string) => ({ kind: 'skill' as const, name });

test('A link that leads nowhere in a skill’s place is replaced and said; a file there, or a link to a real folder, is named and left', async () => {
  const box = await threeSkills();
  try {
    await mkdir(join(box.home, '.pi/agent/skills'), { recursive: true });
    // What an uninstalled skills manager leaves behind: links into a folder that is gone.
    await symlink(join(box.home, '.agents/skills/tdd'), box.pi('tdd'));
    await writeFile(box.pi('grill-me'), 'not a folder');
    const plans = await planParts(box.context, await box.files(), ['pi-cli'], []);
    const plan = (name: string) => plans['pi-cli']!.find(part => part.name === name)!;
    assert.match(plan('tdd').limit ?? '', /replaces a broken link there, which led to .*\.agents\/skills\/tdd/);
    assert.equal(plan('tdd').why, undefined);
    assert.match(plan('grill-me').why ?? '', /A file is in its place in Pi \(.*\.pi\/agent\/skills\/grill-me\)/);

    const report = await installParts(box.context, box.to, await box.files());
    assert.equal(report.outcome, 'failed', report.message);
    assert.match(report.message, /Couldn’t change the skill “grill-me”: a file is in its place in Pi \(.*grill-me\), where its folder would go\./);
    assert.match(report.message, /Replaced a broken link named “tdd” in Pi’s skills folder \(it led to .*\.agents\/skills\/tdd, which isn’t there\)/);
    assert.deepEqual(await box.inPi(), ['figma-design', 'tdd']);
    assert.equal(await readFile(box.pi('grill-me'), 'utf8'), 'not a folder');

    // A link that leads somewhere is someone's skill: never replaced, and never read as a broken one.
    await removeParts(box.context, box.to);
    await mkdir(join(box.home, 'elsewhere/tdd'), { recursive: true });
    await writeFile(join(box.home, 'elsewhere/tdd/SKILL.md'), 'theirs');
    await symlink(join(box.home, 'elsewhere/tdd'), box.pi('tdd'));
    await rm(box.pi('grill-me'));
    const again = await installParts(box.context, box.to, await box.files());
    assert.match(again.notes?.join(' ') ?? '', /Left the skill “tdd”: Pi already has one of that name/);
    assert.equal(await readFile(join(box.home, 'elsewhere/tdd/SKILL.md'), 'utf8'), 'theirs');
  } finally { await box.cleanup(); }
});

test('Single parts: a first pick leaves the rest out, an update keeps them out, each can be turned on or off, and Undo goes back', async () => {
  const box = await threeSkills();
  try {
    const first = await installParts(box.context, box.to, await box.files(), { on: [skill('tdd')], off: [] });
    assert.equal(first.outcome, 'installed', first.message);
    assert.match(first.message, /Parts changed: Pi now has 1 skill\./);
    assert.deepEqual(await box.inPi(), ['tdd']);
    // The rest are out by choice: the plan says so, and an update brings none of them in.
    const out = async () => (await planParts(box.context, await box.files(), ['pi-cli'], await readParts(box.home)))['pi-cli']!.filter(part => part.out).map(part => part.name).sort();
    assert.deepEqual(await out(), ['figma-design', 'grill-me']);
    const second = '---\nname: tdd\ndescription: tdd\n---\n\ntdd, second edition\n';
    await writeFile(join(box.plugin, 'skills/tdd/SKILL.md'), second);
    const update = await installParts(box.context, box.to, await box.files());
    assert.equal(update.outcome, 'installed', update.message);
    assert.deepEqual(await box.inPi(), ['tdd']);
    assert.equal(await readFile(join(box.pi('tdd'), 'SKILL.md'), 'utf8'), second);

    // One more on, one off, in one run; its Undo puts both back as they were.
    const swap = await installParts(box.context, box.to, await box.files(), { on: [skill('grill-me')], off: [skill('tdd')] });
    assert.equal(swap.outcome, 'installed', swap.message);
    assert.deepEqual(await box.inPi(), ['grill-me']);
    assert.deepEqual(await out(), ['figma-design', 'tdd']);
    const undone = await undoParts(box.context, swap.partsRun!);
    assert.equal(undone?.outcome, 'installed', undone?.message ?? 'no report');
    assert.deepEqual(await box.inPi(), ['tdd']);
    assert.deepEqual(await out(), ['figma-design', 'grill-me']);

    // A part removed from the tool by hand is out too, and turning it on writes it again.
    await rm(box.pi('tdd'), { recursive: true });
    assert.deepEqual(await out(), ['figma-design', 'grill-me', 'tdd']);
    const back = await installParts(box.context, box.to, await box.files(), { on: [skill('tdd')], off: [] });
    assert.equal(back.outcome, 'installed', back.message);
    assert.deepEqual(await box.inPi(), ['tdd']);

    // Turning the last one off leaves nothing of the plugin in the tool, and no record.
    const none = await installParts(box.context, box.to, await box.files(), { on: [], off: [skill('tdd')] });
    assert.equal(none.outcome, 'uninstalled', none.message);
    assert.deepEqual([await box.inPi(), await readParts(box.home)], [[], []]);
    // Undo of a first pick takes out what it put in.
    const only = await installParts(box.context, box.to, await box.files(), { on: [skill('grill-me')], off: [] });
    await undoParts(box.context, only.partsRun!);
    assert.deepEqual([await box.inPi(), await readParts(box.home)], [[], []]);
  } finally { await box.cleanup(); }
});

test('A pick beside an install of all the parts is that install with exceptions; a part that can’t go in fails by name', async () => {
  const box = await threeSkills();
  try {
    const most = await installParts(box.context, box.to, await box.files(), { on: [], off: [skill('grill-me')], rest: true });
    assert.equal(most.outcome, 'installed', most.message);
    assert.match(most.message, /Parts installed: 2 skills/);
    assert.deepEqual(await box.inPi(), ['figma-design', 'tdd']);
    // The one left out stays out on the next update, until it is turned on with the rest.
    assert.deepEqual(await (async () => { await installParts(box.context, box.to, await box.files()); return box.inPi(); })(), ['figma-design', 'tdd']);
    const all = await installParts(box.context, box.to, await box.files(), { on: [skill('grill-me')], off: [], rest: true });
    assert.equal(all.outcome, 'installed', all.message);
    assert.deepEqual(await box.inPi(), ['figma-design', 'grill-me', 'tdd']);
    // Pi has no agents: asking for one changes nothing else and says why.
    const agent = await installParts(box.context, box.to, await box.files(), { on: [{ kind: 'agent', name: 'designer' }], off: [] });
    assert.equal(agent.outcome, 'failed');
    assert.match(agent.message, /Couldn’t add the agent “designer”: Pi has no agents\./);
    assert.deepEqual(await box.inPi(), ['figma-design', 'grill-me', 'tdd']);
  } finally { await box.cleanup(); }
});
