import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPluginItems } from '../src/pluginitems.ts';
import { cellWords, handledWhere, offIn, pageRows, pluginItemCount } from '../src/pluginrows.ts';
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
    assert.match(found!.items[0]!.text!, /Says hello/);
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

test('Copilot CLI: a cached plugin turned off, a skill switched off, and a folder-marketplace plugin turned off that only enabledPlugins records', async () => {
  const box = await sandbox();
  try {
    const cached = join(box.home, '.copilot/installed-plugins/m/demo');
    await copy(cached);
    const market = join(box.home, 'market');
    await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'local', plugins: [{ name: 'live', source: './live' }] }));
    await put(join(market, 'live/skills/near/SKILL.md'), '---\nname: near\ndescription: Near.\n---\nX\n');
    await put(join(box.home, '.copilot/config.json'), `// This file is managed automatically.\n${JSON.stringify({ installedPlugins: [{ name: 'demo', marketplace: 'm', version: '1.2.0', cache_path: cached, enabled: false }] })}`);
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ disabledSkills: ['live:near'], enabledPlugins: { 'demo@m': false, 'live@local': false }, extraKnownMarketplaces: { local: { source: { source: 'directory', path: market } } } }));
    assert.deepEqual(brief(await readPluginItems(box.context, ['copilot-cli'])), [
      { tool: 'copilot-cli', plugin: 'demo', marketName: 'm', off: true, skillsOff: undefined, listed: false, problem: undefined, items: ['skill:hello', 'mcp:tracker', 'agent:checker'] },
      { tool: 'copilot-cli', plugin: 'live', marketName: 'local', off: true, skillsOff: ['near'], listed: true, problem: undefined, items: ['skill:near'] },
    ]);
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

test('a plugin’s skill installed whole and put into Pi as a part is one row: the part’s, with the plugin’s copies laid onto it', () => {
  const home = homeOf([fact('triage', { 'pi-cli': true })], [install('claude-cli'), install('copilot-cli')], [piPart]);
  const { rows, merged } = pageRows(home, 'skills');
  assert.deepEqual([rows.length, Object.keys(merged.get('triage')![0]!.copies)], [0, ['claude-cli', 'copilot-cli']]);
  assert.deepEqual([pluginItemCount(home, 'skills'), pluginItemCount(home, 'skills', 'claude-cli'), pluginItemCount(home, 'skills', 'pi-cli')], [0, 1, 0]);
});

test('a personal skill that only shares the name stays its own row; so does a part whose row has its own copy where the plugin is', () => {
  for (const home of [homeOf([fact('triage', { 'claude-cli': true })], [install('claude-cli')]), homeOf([fact('triage', { 'pi-cli': true, 'claude-cli': true })], [install('claude-cli')], [piPart])]) {
    const { rows, merged } = pageRows(home, 'skills');
    assert.deepEqual([rows.map(row => row.key), merged.size, pluginItemCount(home, 'skills')], [['issue-tracker@m/triage'], 0, 1]);
  }
});

test('each tool’s cell says whether it is on: the skill’s own switch, the whole plugin, or not there and why', () => {
  const home = homeOf([], [install('claude-cli', { off: true }), install('copilot-cli', { skillsOff: ['Triage'] }), install('codex-cli', { items: [] })]);
  const [row] = pageRows(home, 'skills').rows;
  assert.deepEqual((['claude-cli', 'copilot-cli', 'codex-cli'] as const).map(tool => offIn(row!, tool)), ['plugin', 'skill', undefined]);
  assert.match(cellWords(row!, 'codex-cli'), /has issue-tracker installed, but its copy doesn’t have this skill/);
  assert.match(cellWords(row!, 'pi-cli'), /Pi takes no plugins/);
  assert.equal(cellWords(row!, 'claude-cli'), 'Claude Code: in the plugin issue-tracker 2.0.0; the whole plugin is turned off in Claude Code');
  const [server] = pageRows(home, 'mcp').rows;
  assert.equal(server!.description, 'Command · npx -y issues');
  assert.deepEqual([offIn(server!, 'copilot-cli'), offIn(server!, 'claude-cli')], [undefined, 'plugin']);
});

test('a plugin whose marketplace is on no tool any more says where it is handled instead of linking to a page', () => {
  const [row] = pageRows(homeOf([], [install('claude-cli', { listed: false })]), 'skills').rows;
  const where = handledWhere(row!);
  assert.equal(where.listed, false);
  assert.match(where.text, /^Installed in Claude Code from the marketplace “m”, which isn’t added in Central Knot or in that tool now/);
});
