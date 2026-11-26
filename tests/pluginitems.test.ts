import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readItemTexts, readPluginItems } from '../src/pluginitems.ts';
import { pluginFiles } from '../src/catalogdetail.ts';
import { readPlugin } from '../src/pluginlibrary.ts';
import { inTool, cellWords, handledWhere, offIn, pageRows, pluginItemCount, pluginKindNotLoaded, rowCount, toolWords, withPluginOnly } from '../src/pluginrows.ts';
import { newItem } from '../src/library.ts';
import { pluginItemKey, pluginLive } from '../src/profileplan.ts';
import type { PluginContext } from '../src/plugins.ts';
import { kindSource } from '../src/itemrow.ts';
import type { HarnessId, HomeView, InstalledPlugin, LibraryFacts } from '../src/types.ts';
import { slashPath } from './wincompat.ts';

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

test('Claude Code reads the marketplace entry from its own copy of the marketplace, so a plugin whose entry lists its skills shows them, and is on the Plugin marketplaces page', async () => {
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

test('A plugin’s item has one plan key by both routes, read on real files: installed in Claude Code and Codex, and placed in Pi from its marketplace', async () => {
  const box = await sandbox();
  try {
    // The marketplace m: demo, whose skill's folder is pdf with SKILL.md naming it pdf-reader, an agent named only by its file
    // (checker.agent.md) and a server; and solo, one skill with SKILL.md at its root, in a folder of another name, bundle.
    const market = join(box.home, 'market'), demo = join(market, 'plugins/demo'), bundle = join(market, 'plugins/bundle');
    await copy(demo);
    await rm(join(demo, 'skills/hello'), { recursive: true });
    await put(join(demo, 'skills/pdf/SKILL.md'), '---\nname: pdf-reader\ndescription: Reads PDFs.\n---\nRead.\n');
    await put(join(bundle, 'SKILL.md'), '---\nname: solo-skill\ndescription: One skill.\n---\nX\n');
    // Installed: each tool's copy of the plugin's folder.
    const installs = { demo: join(box.home, '.claude/plugins/cache/m/demo/1.2.0'), solo: join(box.home, '.claude/plugins/cache/m/solo/1.0.0') };
    await cp(demo, installs.demo, { recursive: true });
    await cp(bundle, installs.solo, { recursive: true });
    await cp(demo, join(box.home, '.codex/plugins/cache/m/demo/1.2.0'), { recursive: true });
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
      'demo@m': [{ scope: 'user', installPath: installs.demo, version: '1.2.0' }], 'solo@m': [{ scope: 'user', installPath: installs.solo, version: '1.0.0' }] } }));
    await put(join(box.home, '.codex/config.toml'), '[plugins."demo@m"]\nenabled = true\n');
    const read = await readPluginItems(box.context, ['claude-cli', 'codex-cli']);
    const installed = (tool: HarnessId, plugin: string) => {
      const install = read.find(found => found.tool === tool && found.plugin === plugin)!;
      return install.items.map(item => [item.name, pluginItemKey(install, item)]);
    };
    // Placed: the plugin's items as Pi gets them (pluginlibrary.ts readPlugin, the read that makes its library items), by name.
    const placed = async (plugin: string, folder: string) => {
      const entry = { id: `${plugin}-id`, source: market, marketName: 'm', plugin, on: true, except: [] };
      const reads = await readPlugin(await pluginFiles(folder, {}, market), entry, '', new Set(), []);
      return reads.flatMap(each => [...each.names.values()].flatMap(seen => ('name' in seen ? [{ key: pluginItemKey(entry, { kind: each.kind, name: seen.name }), name: seen.name }] : [])))
        .sort((first, second) => first.key.localeCompare(second.key));
    };
    // The name stays the one the tool loads it by, which its own switch takes (Codex: demo:pdf-reader); the key is the folder's.
    assert.deepEqual(installed('claude-cli', 'demo'), [['pdf-reader', 'demo@m/pdf'], ['tracker', 'demo@m/tracker'], ['checker', 'demo@m/checker']]);
    assert.deepEqual(installed('codex-cli', 'demo'), [['pdf-reader', 'demo@m/pdf'], ['tracker', 'demo@m/tracker']], 'Codex’s copy: the same key (and no agents)');
    // Skills keep their listed path relative to the plugin root ('.' included) and their real folder (no companion hashing).
    const claudePdf = read.find(found => found.tool === 'claude-cli' && found.plugin === 'demo')!.items.find(item => item.name === 'pdf-reader')!;
    const codexPdf = read.find(found => found.tool === 'codex-cli' && found.plugin === 'demo')!.items.find(item => item.name === 'pdf-reader')!;
    const claudeSolo = read.find(found => found.tool === 'claude-cli' && found.plugin === 'solo')!.items[0]!;
    assert.deepEqual([claudePdf.path, codexPdf.path, claudeSolo.path], ['skills/pdf', 'skills/pdf', '.']);
    assert.ok(claudePdf.realDirectory && codexPdf.realDirectory && claudePdf.realDirectory !== codexPdf.realDirectory);
    assert.deepEqual((await placed('demo', demo)).map(each => each.key), ['demo@m/checker', 'demo@m/pdf', 'demo@m/tracker'], 'Pi’s: the same keys');
    // A plugin that is one skill, in a folder of another name (bundle): installed and placed, keyed by the plugin's name.
    const [soloPlaced] = await placed('solo', bundle);
    assert.deepEqual([installed('claude-cli', 'solo'), soloPlaced], [[['solo-skill', 'solo@m/solo']], { key: 'solo@m/solo', name: 'solo' }]);
    const home = (installs: InstalledPlugin[]) => ({ pluginItems: installs, profiles: { profiles: [], plugins: [{ id: 'solo-id', plugin: 'solo', marketName: 'm', on: true }] },
      skills: { tools: ['claude-cli', 'pi-cli'], items: [], library: { solo: { ...newItem('solo', soloPlaced!.name), on: true, source: 'solo-id' } } },
      mcp: { tools: [], items: [], library: {} }, agents: { tools: [], items: [], library: {} } }) as unknown as HomeView;
    const plan = (view: HomeView) => pluginLive(view).map(item => [item.id, item.copies.map(copy => copy.tool)]);
    assert.deepEqual(plan(home(read.filter(install => install.plugin === 'solo'))), [['plugin:skill:solo@m/solo', ['claude-cli', 'pi-cli']]], 'one item, both routes');
    assert.deepEqual(plan(home([])), [['plugin:skill:solo@m/solo', ['pi-cli']]], 'with no tool having it installed, the same key');
    // The same plugin from another marketplace is another item; a skill's case is folded as library keys are, a server's kept.
    assert.equal(pluginItemKey({ plugin: 'demo', marketName: 'elsewhere' }, { kind: 'skill', name: 'PDF' }), 'demo@elsewhere/pdf');
    assert.equal(pluginItemKey({ plugin: 'demo', marketName: 'm' }, { kind: 'mcp', name: 'Tracker' }), 'demo@m/Tracker');
  } finally { await box.cleanup(); }
});

test('an installed plugin keeps its hooks as each tool’s installed copy declares them, in that tool’s form, not as its marketplace has them now; a hooks file it can’t read is named', async () => {
  const box = await sandbox();
  try {
    const market = join(box.home, '.claude/plugins/marketplaces/team');
    await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'demo', source: './plugins/demo' }] }));
    await put(join(market, 'plugins/demo/hooks/hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo a newer version' }] }] } }));
    const hooks = (start: Record<string, unknown>) => JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', ...start }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } });
    const claudeCopy = join(box.home, '.claude/plugins/cache/team/demo/1.2.0'), codexCopy = join(box.home, '.codex/plugins/cache/team/demo/1.2.0');
    for (const folder of [claudeCopy, codexCopy]) await copy(folder);
    // Claude Code's form keeps a program's arguments apart; Codex's is one command line.
    await put(join(claudeCopy, 'hooks/hooks.json'), hooks({ command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/start.mjs', '--mode', 'full text'] }));
    await put(join(codexCopy, 'hooks/hooks.json'), hooks({ command: 'node "${PLUGIN_ROOT}/start.mjs"' }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'demo@team': [{ scope: 'user', installPath: claudeCopy, version: '1.2.0' }] } }));
    await put(join(box.home, '.codex/config.toml'), '[plugins."demo@team"]\nenabled = true\n');
    const declared = (copy: string, launch: Record<string, unknown>) => [
      { declaredIn: join(copy, 'hooks/hooks.json'), event: 'SessionStart', at: 0, launch },
      { declaredIn: join(copy, 'hooks/hooks.json'), event: 'Stop', at: 0, launch: { shell: 'echo bye' } },
    ];
    assert.deepEqual((await readPluginItems(box.context, ['claude-cli', 'codex-cli'])).map(found => [found.tool, found.hooks]), [
      ['claude-cli', declared(claudeCopy, { program: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/start.mjs', '--mode', 'full text'] })],
      ['codex-cli', declared(codexCopy, { shell: 'node "${PLUGIN_ROOT}/start.mjs"' })],
    ]);
    await put(join(codexCopy, 'hooks/hooks.json'), '{ "hooks": ');
    const codex = (await readPluginItems(box.context, ['codex-cli']))[0]!;
    assert.deepEqual([codex.hooks, codex.hooksUnread], [undefined, [join(codexCopy, 'hooks/hooks.json')]]);
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

const fact = (key: string, copies: Partial<Record<HarnessId, true>>, extra: Partial<LibraryFacts> = {}): LibraryFacts => ({ key, name: key, description: '', copies: Object.fromEntries(Object.keys(copies).map(tool => [tool, { hash: 'h', directory: '', rootLabel: '', lines: 1, modified: '', summary: '', writable: true, folder: key }])), on: false, except: [], cannot: {}, edited: [], ...extra });
const install = (tool: HarnessId, extra: Partial<InstalledPlugin> = {}): InstalledPlugin => ({ tool, plugin: 'issue-tracker', marketName: 'm', version: '2.0.0', listed: true, items: [{ kind: 'skill', name: 'triage', description: 'Sorts issues.' }, { kind: 'mcp', name: 'issues', description: '', runs: 'npx -y issues' }], ...extra });
/** A home's view with these skills (as the Library's view gives them: types.ts LibraryFacts). */
const homeOf = (skills: LibraryFacts[], pluginItems: InstalledPlugin[]) => ({
  skills: { tools: [], items: skills, library: {} },
  mcp: { items: [], library: {} }, agents: { items: [], library: {} }, pluginItems }) as unknown as HomeView;

test('a plugin’s skill the person also has (in Pi, shown there as through the plugin elsewhere) is that one row, not a second', () => {
  const through = { plugin: 'issue-tracker', marketplace: 'm' };
  const home = homeOf([fact('triage', { 'pi-cli': true }, { plugin: { 'claude-cli': through, 'copilot-cli': through } })], [install('claude-cli'), install('copilot-cli')]);
  assert.deepEqual([pageRows(home, 'skills').rows.length, pluginItemCount(home, 'skills'), pluginItemCount(home, 'skills', 'claude-cli')], [0, 0, 0]);
  // That row is the tools' too: each one's page draws it and each one's count has it (one rule, inTool).
  const [triage] = kindSource(home, 'skills').facts;
  assert.deepEqual((['claude-cli', 'copilot-cli', 'pi-cli', 'codex-cli'] as const).map(tool => inTool(triage!, tool)), [true, true, true, false]);
});

test('a shared skill belongs to a tool that loads it now, even through a link, but not one that could read a future copy', () => {
  const file = { folder: 'review', name: 'review', skillFile: '/home/example/.agents/skills/review/SKILL.md', switchedOff: false };
  const review = fact('review', {}, {
    loads: { 'claude-cli': file, 'codex-cli': file },
    anotherWay: { 'opencode-cli': 'OpenCode gets it once it is on in Claude Code.' },
  });
  assert.deepEqual((['claude-cli', 'codex-cli', 'opencode-cli'] as const).map(tool => inTool(review, tool)), [true, true, false]);
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
  assert.match(handledWhere(row!), /^Installed in Claude Code from the marketplace “m”, which isn’t added in Central Knot or in that tool now/);
  // A plugin from the Anthropic Directory is said to be from there, not from a marketplace that went missing.
  const [directory] = pageRows(homeOf([], [{ ...install('claude-cli', { listed: false }), marketName: 'anthropic-plugin-directory' }]), 'skills').rows;
  assert.equal(handledWhere(directory!), 'Installed in Claude Code from the Anthropic Directory. Claude Code’s own /plugin updates, turns off or removes it.');
});

test('withPluginOnly and pluginKindNotLoaded follow loadsKind: Codex for a plugin’s agent is unloaded, while Codex for a skill or own agent is not', () => {
  const five: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
  const installed: InstalledPlugin = {
    tool: 'claude-cli',
    plugin: 'release-helper',
    marketName: 'team-tools',
    version: '0.4.1',
    listed: true,
    items: [{ kind: 'agent', name: 'release-reviewer', description: '' }],
  };
  const home = {
    skills: { tools: five, items: [], library: {} },
    mcp: { tools: five, items: [], library: {} },
    agents: { tools: five, items: [], library: {} },
    pluginItems: [installed],
  } as unknown as HomeView;
  const linked = { fromSource: { link: 'plugin:release-helper@team-tools' }, on: true, except: ['pi-cli', 'opencode-cli'] };
  assert.deepEqual(withPluginOnly(home, 'agents', linked), ['copilot-cli']);
  assert.deepEqual(withPluginOnly(home, 'skills', linked), ['copilot-cli', 'codex-cli']);
  assert.deepEqual(
    [
      pluginKindNotLoaded('agents', { ...linked, on: false }, 'codex-cli'),
      pluginKindNotLoaded('agents', linked, 'codex-cli'),
      pluginKindNotLoaded('agents', { ...linked, except: ['codex-cli'] }, 'codex-cli'),
      pluginKindNotLoaded('skills', linked, 'codex-cli'),
      pluginKindNotLoaded('agents', { on: false, except: [] }, 'codex-cli'),
      pluginKindNotLoaded('agents', linked, 'claude-cli'),
      pluginKindNotLoaded('agents', linked, 'pi-cli'),
    ],
    [true, true, false, false, false, false, false],
  );
});

test('reading plugin items for one plugin in two tools walks and hashes no files of its skill folders beyond SKILL.md', async () => {
  const box = await sandbox();
  try {
    const claudeCopy = join(box.home, '.claude/plugins/cache/m/demo/1.2.0');
    const codexCopy = join(box.home, '.codex/plugins/cache/m/demo/1.2.0');
    for (const folder of [claudeCopy, codexCopy]) {
      await copy(folder);
      await put(join(folder, 'skills/hello/extra.md'), 'Companion file.\n');
      await put(join(folder, 'skills/hello/notes/rubric.md'), 'Nested companion.\n');
    }
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'demo@m': [{ scope: 'user', installPath: claudeCopy, version: '1.2.0' }] } }));
    await put(join(box.home, '.codex/config.toml'), '[plugins."demo@m"]\nenabled = true\n');
    const opened: string[] = [];
    const hashed: string[] = [];
    const origOpen = fs.open;
    const origPromiseOpen = fs.promises.open;
    const note = (list: string[], path: fs.PathLike) => {
      if (typeof path !== 'string') return;
      try {
        list.push(realpathSync(path));
      } catch {
        list.push(path);
      }
    };
    fs.open = ((path: fs.PathLike, ...rest: unknown[]) => {
      note(hashed, path);
      note(opened, path);
      return (origOpen as (...args: unknown[]) => unknown).call(fs, path, ...rest);
    }) as typeof fs.open;
    fs.promises.open = ((path: fs.PathLike, ...rest: unknown[]) => {
      note(opened, path);
      return (origPromiseOpen as (...args: unknown[]) => unknown).call(fs.promises, path, ...rest);
    }) as typeof fs.promises.open;
    syncBuiltinESMExports();
    let installs: InstalledPlugin[];
    try {
      installs = await readPluginItems(box.context, ['claude-cli', 'codex-cli']);
    } finally {
      fs.open = origOpen;
      fs.promises.open = origPromiseOpen;
      syncBuiltinESMExports();
    }
    const skillOpens = opened.map(slashPath).filter(path => path.includes('/skills/hello/'));
    assert.deepEqual(hashed.map(slashPath).filter(path => path.includes('/skills/hello/')), [], 'no file in either tool’s skill folder is hashed');
    assert.deepEqual(skillOpens.filter(path => !path.endsWith('/SKILL.md')), [], 'no companion file in either tool’s skill folder is opened');
    assert.ok(skillOpens.length >= 2, 'spy observed SKILL.md reads for both tools');
    assert.deepEqual(installs.map(entry => [entry.tool, entry.version, entry.items.find(item => item.kind === 'skill')?.path]),
      [['claude-cli', '1.2.0', 'skills/hello'], ['codex-cli', '1.2.0', 'skills/hello']]);
  } finally { await box.cleanup(); }
});
