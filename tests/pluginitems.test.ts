import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readItemTexts, readPluginItems } from '../src/pluginitems.ts';
import { inTool, cellWords, handledWhere, offIn, pageRows, pluginItemCount, rowCount, toolWords } from '../src/pluginrows.ts';
import type { PluginContext } from '../src/plugins.ts';
import type { HarnessId, HomeView, InstalledPlugin, PartsInstall, SkillFacts } from '../src/types.ts';

const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-items-')));
  const home = join(base, 'home');
  await mkdir(home, { recursive: true });
  return { home, context: { home, dataDir: join(base, 'data'), binaries: {} } as PluginContext, cleanup: () => rm(base, { recursive: true, force: true }) };
}

/** A plugin copy: a skill, an MCP server and an agent named only by its file, x.agent.md. */
async function copy(folder: string) {
  await put(join(folder, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'demo', version: '1.2.0' }));
  await put(join(folder, 'skills/hello/SKILL.md'), '---\nname: hello\ndescription: Says hello.\n---\nHi\n');
  await put(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { tracker: { command: 'npx', args: ['-y', 'tracker'] } } }));
  await put(join(folder, 'agents/checker.agent.md'), '---\ndescription: Checks things.\n---\nCheck.\n');
}
const brief = (installs: InstalledPlugin[]) => installs.map(({ tool, plugin, marketName, off, skillsOff, listed, problem, items }) => ({ tool, plugin, marketName, off, skillsOff, listed, problem, items: items.map(item => `${item.kind}:${item.name}`) }));

test('Claude Code: what an installed plugin brings, from its own record and copy, turned off with enabledPlugins, from a marketplace nothing here knows', async () => {
  const box = await sandbox();
  try {
    const cache = join(box.home, '.claude/plugins/cache/elsewhere/demo/1.2.0');
    await copy(cache);
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'demo@elsewhere': [{ scope: 'user', installPath: cache, version: '1.2.0' }], 'proj@elsewhere': [{ scope: 'project', installPath: cache }] } }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'demo@elsewhere': false } }));
    const [found, ...rest] = await readPluginItems(box.context, ['claude-cli', 'pi-cli']);
    assert.equal(rest.length, 0, 'a project-scope install is not this person’s everywhere');
    assert.deepEqual(brief([found!]), [{ tool: 'claude-cli', plugin: 'demo', marketName: 'elsewhere', off: true, skillsOff: undefined, listed: false, problem: undefined, items: ['skill:hello', 'mcp:tracker', 'agent:checker'] }]);
    assert.equal(found!.version, '1.2.0');
    // Its file is read only when asked for, by name as the page keys it (case aside), from that plugin's copies alone.
    const texts = await readItemTexts(box.context, ['claude-cli', 'pi-cli'], { plugin: 'demo', marketName: 'elsewhere', kind: 'skill', name: 'Hello' });
    assert.deepEqual([texts.map(copy => copy.tool), /Says hello/.test(texts[0]!.text)], [['claude-cli'], true]);
    assert.equal(found!.items[1]!.runs, 'npx -y tracker');
  } finally { await box.cleanup(); }
});

test('Claude Code reads the marketplace entry from its own copy of the marketplace, so a plugin whose entry lists its skills shows them, and is on the Plugins page', async () => {
  const box = await sandbox();
  try {
    const market = join(box.home, '.claude/plugins/marketplaces/team');
    await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'listed', source: './plugins/listed', strict: false, skills: ['./extra/only'] }] }));
    const cache = join(box.home, '.claude/plugins/cache/team/listed/1.0.0');
    await put(join(cache, 'extra/only/SKILL.md'), '---\nname: only\ndescription: Listed in the entry.\n---\nX\n');
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'github', repo: 'team/plugins' }, installLocation: market } }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'listed@team': [{ scope: 'user', installPath: cache, version: '1.0.0' }] } }));
    const [found] = await readPluginItems(box.context, ['claude-cli']);
    assert.deepEqual([found!.items.map(item => item.name), found!.listed, found!.source, found!.off], [['only'], true, 'team/plugins', undefined]);
  } finally { await box.cleanup(); }
});

test('Copilot CLI: a cached plugin turned off, a skill switched off, and a folder-marketplace plugin, which only enabledPlugins records and false means uninstalled', async () => {
  const box = await sandbox();
  try {
    const cached = join(box.home, '.copilot/installed-plugins/m/demo');
    await copy(cached);
    const market = join(box.home, 'market');
    await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'local', plugins: [{ name: 'live', source: './live' }] }));
    await put(join(market, 'live/skills/near/SKILL.md'), '---\nname: near\ndescription: Near.\n---\nX\n');
    await put(join(box.home, '.copilot/config.json'), `// This file is managed automatically.\n${JSON.stringify({ installedPlugins: [{ name: 'demo', marketplace: 'm', version: '1.2.0', cache_path: cached, enabled: false }] })}`);
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ disabledSkills: ['live:near'], enabledPlugins: { 'demo@m': false, 'live@local': true }, extraKnownMarketplaces: { local: { source: { source: 'directory', path: market } } } }));
    const settings = join(box.home, '.copilot/settings.json');
    assert.deepEqual(brief(await readPluginItems(box.context, ['copilot-cli'])), [
      { tool: 'copilot-cli', plugin: 'demo', marketName: 'm', off: true, skillsOff: undefined, listed: false, problem: undefined, items: ['skill:hello', 'mcp:tracker', 'agent:checker'] },
      { tool: 'copilot-cli', plugin: 'live', marketName: 'local', off: undefined, skillsOff: ['near'], listed: true, problem: undefined, items: ['skill:near'] },
    ]);
    // Copilot CLI's own uninstall of a folder marketplace's plugin leaves its record false: it brings nothing any more.
    await put(settings, (await readFile(settings, 'utf8')).replace('"live@local":true', '"live@local":false'));
    assert.deepEqual((await readPluginItems(box.context, ['copilot-cli'])).map(install => install.plugin), ['demo']);
  } finally { await box.cleanup(); }
});

test('Codex: its plugin table turned off, a skill switched off by name, and no agents (Codex never loads a plugin’s)', async () => {
  const box = await sandbox();
  try {
    await copy(join(box.home, '.codex/plugins/cache/m/demo/1.2.0'));
    await put(join(box.home, '.codex/config.toml'), '[plugins."demo@m"]\nenabled = false\n\n[[skills.config]]\nname = "demo:hello"\nenabled = false\n');
    assert.deepEqual(brief(await readPluginItems(box.context, ['codex-cli'])), [{ tool: 'codex-cli', plugin: 'demo', marketName: 'm', off: true, skillsOff: ['hello'], listed: false, problem: undefined, items: ['skill:hello', 'mcp:tracker'] }]);
  } finally { await box.cleanup(); }
});

test('a copy that can’t be read is said, and neither it nor broken records stop the read', async () => {
  const box = await sandbox();
  try {
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'gone@m': [{ scope: 'user', installPath: join(box.home, 'nowhere') }], '../x@m': [{ scope: 'user', installPath: box.home }] } }));
    await put(join(box.home, '.copilot/config.json'), '{ not json');
    await put(join(box.home, '.codex/config.toml'), '[plugins."demo@m"\n');
    const found = await readPluginItems(box.context, ['claude-cli', 'copilot-cli', 'codex-cli']);
    assert.deepEqual(brief(found), [{ tool: 'claude-cli', plugin: 'gone', marketName: 'm', off: undefined, skillsOff: undefined, listed: false, problem: 'Claude Code lists it, but its files are not where it records them.', items: [] }]);
  } finally { await box.cleanup(); }
});

// ---------- Rows ----------

const fact = (key: string, copies: Partial<Record<HarnessId, true>>, extra: Partial<SkillFacts> = {}): SkillFacts => ({ key, name: key, description: '', copies: Object.fromEntries(Object.keys(copies).map(tool => [tool, { hash: 'h', directory: '', rootLabel: '', lines: 1, modified: '', summary: '', writable: true, folder: key }])), extra: [], managed: false, off: [], cannot: {}, choiceBlocks: {}, ...extra });
const install = (tool: HarnessId, extra: Partial<InstalledPlugin> = {}): InstalledPlugin => ({ tool, plugin: 'issue-tracker', marketName: 'm', version: '2.0.0', listed: true, items: [{ kind: 'skill', name: 'triage', description: 'Sorts issues.' }, { kind: 'mcp', name: 'issues', description: '', runs: 'npx -y issues' }], ...extra });
const piPart: PartsInstall = { source: '/m', marketName: 'm', plugin: 'issue-tracker', tool: 'pi-cli', at: '', digest: '', items: [{ kind: 'skill', name: 'triage', hash: '' }] };
const homeOf = (skills: SkillFacts[], pluginItems: InstalledPlugin[], parts: PartsInstall[] = []) => ({ manage: { skills }, mcp: { servers: [] }, agents: { servers: [] }, parts, pluginItems }) as unknown as HomeView;

test('a page whose last skill was just removed still has a row: the skill with no copy left, switched off', () => {
  const home = { ...homeOf([], []), manage: { skills: [], gone: [fact('only', {}, { gone: { history: 'e1', at: '' } })] } } as unknown as HomeView;
  assert.deepEqual([rowCount(home, 'skills'), rowCount(homeOf([], []), 'skills')], [1, 0]);
});

test('an agent turned off with no copy left that a tool has through a plugin is that one row, the plugin’s item on it, not a second row', () => {
  const given = { plugin: 'release-helper', marketplace: 'm' };
  const helper: InstalledPlugin = { tool: 'claude-cli', plugin: 'release-helper', marketName: 'm', version: '0.4.1', listed: true, items: [{ kind: 'agent', name: 'release-reviewer', description: 'Reviews a release.' }] };
  const off = fact('release-reviewer', {}, { gone: { history: 'e1', at: '', turnedOff: true }, plugin: { 'claude-cli': given } });
  const home = (gone: SkillFacts[]) => ({ ...homeOf([], [helper]), agents: { servers: [], gone } }) as unknown as HomeView;
  assert.deepEqual([pageRows(home([off]), 'agents').rows.length, pageRows(home([]), 'agents').rows.length, rowCount(home([off]), 'agents')], [0, 1, 1]);
});

test('a plugin’s skill the person also has (its part in Pi, shown there as through the plugin elsewhere) is that one row, not a second', () => {
  const through = { plugin: 'issue-tracker', marketplace: 'm' };
  const home = homeOf([fact('triage', { 'pi-cli': true }, { plugin: { 'claude-cli': through, 'copilot-cli': through } })], [install('claude-cli'), install('copilot-cli')], [piPart]);
  assert.deepEqual([pageRows(home, 'skills').rows.length, pluginItemCount(home, 'skills'), pluginItemCount(home, 'skills', 'claude-cli')], [0, 0, 0]);
  // That row is the tools' too: each one's page draws it and each one's count has it (one rule, inTool).
  const [triage] = home.manage.skills;
  assert.deepEqual((['claude-cli', 'copilot-cli', 'pi-cli', 'codex-cli'] as const).map(tool => inTool(triage!, tool)), [true, true, true, false]);
});

test('a Codex plugin’s MCP server that is also the plugin’s part in Pi is that one row (no box shows Codex has it through the plugin)', () => {
  const part: PartsInstall = { ...piPart, items: [{ kind: 'mcp', name: 'issues', hash: '' }] };
  const home = { ...homeOf([], [install('codex-cli')], [part]), mcp: { servers: [fact('issues', { 'pi-cli': true })] } } as unknown as HomeView;
  assert.deepEqual([pageRows(home, 'mcp').rows.length, pageRows(homeOf([], [install('codex-cli')]), 'mcp').rows.map(row => row.name)], [0, ['issues']]);
});

test('a personal skill that only shares the name stays its own row beside the plugin’s', () => {
  const home = homeOf([fact('triage', { 'claude-cli': true })], [install('claude-cli')]);
  assert.deepEqual([pageRows(home, 'skills').rows.map(row => row.key), pluginItemCount(home, 'skills'), pluginItemCount(home, 'skills', 'claude-cli'), pluginItemCount(home, 'skills', 'pi-cli')], [['issue-tracker@m/triage'], 1, 1, 0]);
});

test('each tool’s cell says whether it is on: the skill’s own switch, the whole plugin, or not there and why', () => {
  const home = homeOf([], [install('claude-cli', { off: true }), install('copilot-cli', { skillsOff: ['Triage'], serversOff: ['issues'] }), install('codex-cli', { items: [] })]);
  const [row] = pageRows(home, 'skills').rows;
  assert.deepEqual((['claude-cli', 'copilot-cli', 'codex-cli'] as const).map(tool => offIn(row!, tool)), ['plugin', 'item', undefined]);
  assert.match(cellWords(row!, 'codex-cli'), /has issue-tracker installed, but its copy doesn’t have this skill/);
  assert.match(cellWords(row!, 'pi-cli'), /Pi takes no plugins/);
  assert.equal(cellWords(row!, 'claude-cli'), 'Claude Code: in the plugin issue-tracker 2.0.0; the whole plugin is turned off in Claude Code');
  const [server] = pageRows(home, 'mcp').rows;
  assert.equal(server!.description, 'Command · npx -y issues');
  assert.deepEqual([offIn(server!, 'copilot-cli'), offIn(server!, 'claude-cli')], ['item', 'plugin']);
  assert.equal(toolWords(server!, 'copilot-cli'), 'Inside issue-tracker 2.0.0. Turned off here with its own switch.');
  // An agent turned off by itself (Claude Code) is said the same way.
  const agents = homeOf([], [{ ...install('claude-cli', { agentsOff: ['reviewer'] }), items: [{ kind: 'agent', name: 'reviewer', description: '' }] }]);
  const [agent] = pageRows(agents, 'agents').rows;
  assert.deepEqual([offIn(agent!, 'claude-cli'), toolWords(agent!, 'claude-cli')], ['item', 'Inside issue-tracker 2.0.0. Turned off here with its own switch.']);
});

test('a plugin whose marketplace is on no tool any more says where it is handled instead of linking to a page', () => {
  const [row] = pageRows(homeOf([], [install('claude-cli', { listed: false })]), 'skills').rows;
  const where = handledWhere(row!);
  assert.equal(where.listed, false);
  assert.match(where.text, /^Installed in Claude Code from the marketplace “m”, which isn’t added in Central Knot or in that tool now/);
  // A plugin from the Anthropic Directory is said to be from there, not from a marketplace that went missing.
  const [directory] = pageRows(homeOf([], [{ ...install('claude-cli', { listed: false }), marketName: 'anthropic-plugin-directory' }]), 'skills').rows;
  assert.equal(handledWhere(directory!).text, 'Installed in Claude Code from the Anthropic Directory. Claude Code’s own /plugin updates, turns off or removes it.');
});
