// A link to a plugin or a marketplace, on real files in a temp home and made-up Git repositories standing in for links
// (tests/sourcerepo.ts: nothing reaches the network): what at a link is a plugin's own folder, a marketplace or a plugin one
// lists (atlink.ts holdsAt), a plugin's items read by the one plugin reader (atlink.ts pluginItems), Look's hand-off of a
// marketplace to the Plugins page (sources.ts handOff) and that page's own add (marketplaces.ts add, with the tools' installers
// stood in for as tests/marketplaces.test.ts stands them in), and an agent, a server or a skill that arrives both from a source
// and through an installed plugin. Skills, agents and servers at an ordinary link are tests/sources.test.ts's,
// tests/sourceagents.test.ts's and tests/sourceservers.test.ts's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { lockPath } from './fslock.ts';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { agentKind, agentsView, applyAgents } from '../src/agents.ts';
import { holdsAt, readOf } from '../src/atlink.ts';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import * as engine from '../src/plugins.ts';
import { applyServers, serverKind, serversView } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, skillKind } from '../src/skills.ts';
import { addSource, checkSource, previewSource, removeSource, sourceKinds, sourcesView } from '../src/sources.ts';
import type { HarnessId, SourcePreview, SourceResult } from '../src/types.ts';
import { deslopFiles, repository, skillMd, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const exists = (path: string) => stat(path).then(() => true, () => false);
const mcpJson = (servers: Record<string, unknown>) => `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
const helperMd = (prompt = 'Help.') => `---\nname: helper\ndescription: Helps.\n---\n\n${prompt}\n`;

/** A home with all five tools' folders; `tools`: those Central Knot manages here. */
async function sandbox(tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-source-plugins-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/skills', '.claude/agents', '.copilot/skills', '.copilot/agents', '.codex/skills', '.codex/agents', '.pi/agent/skills', '.config/opencode']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { base, home, context, tools, cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof sandbox>>;
type Look = Extract<SourcePreview, { token: string }>;
const look = async (box: Box, link: string) => await previewSource(box.context, box.tools, link) as Look;
async function add(box: Box, link: string) {
  const seen = await look(box, link);
  assert.ok('token' in seen && !seen.refused, `the look is refused: ${seen.refused}`);
  const added = await addSource(box.context, box.tools, seen.token);
  return { look: seen, added, id: (await sourcesView(box.context, box.tools)).sources.find(source => source.link === link)!.id };
}
const check = (box: Box, id: string) => checkSource(box.context, async () => box.tools, id, work => work());
const answered = (result: SourceResult) => (result.sourced ?? []).map(({ kind, name, answer }) => `${kind} ${name}: ${answer}`).sort();
const linesOf = (found: { names: { kind: string; name?: string; key: string; state: string; why?: string }[] }) =>
  found.names.map(name => `${name.kind} ${name.name ?? name.key}: ${name.state}${name.why ? ` (${name.why})` : ''}`).sort();
const library = async (box: Box) => ({ skill: (await skillKind.open(box.context)).library.items, agent: (await agentKind.open(box.context)).library.items, mcp: (await serverKind.open(box.context)).library.items });

/**
 * The plugin kit as its own repository holds it: the skills notes (skills/) and tools (extra/, which its plugin.json names), the
 * agent helper, the MCP servers relay and local (.mcp.json; local runs from the plugin's folder) and inline (in plugin.json), and
 * what never comes as an item: three commands, its hooks, an LSP server and a bin folder.
 */
const KIT: Record<string, string> = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'kit', skills: ['./extra/tools'], mcpServers: { inline: { command: 'inline-mcp' } } }),
  'skills/notes/SKILL.md': skillMd('notes'), 'extra/tools/SKILL.md': skillMd('tools'), 'agents/helper.md': helperMd(),
  '.mcp.json': mcpJson({ relay: { command: 'npx', args: ['relay'] }, local: { command: '${CLAUDE_PLUGIN_ROOT}/bin/local' } }),
  'commands/go.md': '---\ndescription: Go.\n---\nGo.\n', 'commands/stop.md': '---\ndescription: Stop.\n---\nStop.\n', 'commands/status.md': '---\ndescription: Status.\n---\nStatus.\n',
  'hooks/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check-bash' }] }] } }), '.lsp.json': JSON.stringify({ rust: { command: 'rust-analyzer' } }), 'bin/kit': '#!/bin/sh\n',
  'README.md': '# kit\n',
};

// ---------- A plugin's own folder ----------

test('A plugin’s own folder brings its skills (skills/ and the folder its plugin.json names), its agent and its servers (.mcp.json and plugin.json’s), Off; its commands, hooks, LSP server and bin folder are never items and are named; a server that runs from the plugin is left out, and the others still turn Off when dropped', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit(KIT);
    const seen = await look(box, 'https://github.com/team/kit');
    assert.deepEqual([seen.holds, seen.refused, seen.toPlugins], ['plugin', undefined, undefined]);
    assert.deepEqual(linesOf(seen), ['agent helper: make', 'mcp inline: make', 'mcp local: leftOut (it names a plugin’s own folder or settings, which only Claude Code fills in, for a plugin)', 'mcp relay: make', 'skill notes: make', 'skill tools: make']);
    assert.deepEqual(['tools', 'inline'].map(key => seen.names.find(name => name.key === key)?.there), [{ folder: 'extra/tools', folderName: 'tools', files: ['SKILL.md'] }, { folder: '', folderName: 'kit', files: [] }],
      'named by its folder in the repository, and the repository’s name for its root');
    assert.deepEqual(seen.notComing, { commands: 3, hooks: true, lspServers: 1, bin: true });

    const { added, id } = await add(box, 'https://github.com/team/kit');
    assert.deepEqual(answered(added), ['agent helper: make', 'mcp inline: make', 'mcp relay: make', 'skill notes: make', 'skill tools: make']);
    const items = await library(box);
    assert.deepEqual([items.skill.notes.on, items.agent.helper.on, items.mcp.relay.on, items.mcp.local], [false, false, false, undefined]);
    assert.deepEqual((await sourcesView(box.context, box.tools)).sources[0].notComing, seen.notComing, 'its row says so too');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    assert.ok(await exists(join(box.home, '.claude/skills/notes/SKILL.md')), 'turned On, it is in the tools');

    await repo.commit({ '.mcp.json': mcpJson({ local: { command: '${CLAUDE_PLUGIN_ROOT}/bin/local' } }) });
    assert.deepEqual(answered(await check(box, id)), ['mcp relay: drop'], 'the left-out server holds back no drop');
  } finally { await box.cleanup(); }
});

test('A plugin that is one skill at its repository’s root is named by the repository, never by Central Knot’s copy; one that gains a plugin.json later keeps its key: one update (the folder has a new file), no drop', async () => {
  const box = await sandbox();
  try {
    const plugin = await repository(hosts, 'https://github.com/team/one-skill');
    await plugin.commit({ ...deslopFiles(), '.claude-plugin/plugin.json': '{"name":"deslop"}' });
    const seen = await look(box, 'https://github.com/team/one-skill');
    assert.deepEqual([seen.holds, seen.names.map(name => [name.key, name.there?.folder, name.there?.folderName, name.state])], ['plugin', [['deslop', '', 'one-skill', 'make']]]);

    const repo = await repository(hosts, 'https://github.com/stephenturner/skill-deslop');
    await repo.commit(deslopFiles());
    const { id } = await add(box, 'https://github.com/stephenturner/skill-deslop');
    await repo.commit({ '.claude-plugin/plugin.json': '{"name":"deslop"}' });
    assert.deepEqual(answered(await check(box, id)), ['skill deslop: update']);
    const row = (await sourcesView(box.context, box.tools)).sources[0];
    assert.deepEqual([row.holds, row.names.map(name => [name.key, name.there?.folderName, name.state])], ['plugin', [['deslop', 'skill-deslop', 'nothing']]]);
  } finally { await box.cleanup(); }
});

test('A source never loses an item because its repository gained a plugin.json: a top-level skill folder and .claude/agents/x.md stay as they are, and skills/ under a plugin.json that names it reads as unchanged', async () => {
  const box = await sandbox();
  try {
    const mixed = await repository(hosts, 'https://github.com/team/mixed');
    // Its .mcp.json, which a plugin's files read too, makes the read whole: an item lost would be dropped.
    await mixed.commit({ 'foo/SKILL.md': skillMd('foo'), '.claude/agents/x.md': '---\nname: x\ndescription: X.\n---\n\nX.\n', '.mcp.json': mcpJson({ relay: { command: 'npx' } }) });
    const first = await add(box, 'https://github.com/team/mixed');
    assert.deepEqual(answered(first.added), ['agent x: make', 'mcp relay: make', 'skill foo: make']);
    await mixed.commit({ '.claude-plugin/plugin.json': '{"name":"mixed"}' });
    const done = await check(box, first.id);
    assert.deepEqual([answered(done), done.notWhole], [[], undefined], 'read whole, and nothing turns Off or is updated');
    const row = (await sourcesView(box.context, box.tools)).sources.find(source => source.id === first.id)!;
    assert.deepEqual([row.holds, linesOf(row)], ['plugin', ['agent x: nothing', 'mcp relay: nothing', 'skill foo: nothing']]);

    const listed = await repository(hosts, 'https://github.com/team/listed-skills');
    await listed.commit({ 'skills/a/SKILL.md': skillMd('a'), 'skills/b/SKILL.md': skillMd('b') });
    const second = await add(box, 'https://github.com/team/listed-skills');
    await listed.commit({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'listed', skills: ['./skills'] }) });
    assert.deepEqual(answered(await check(box, second.id)), []);
  } finally { await box.cleanup(); }
});

test('A plugin’s skill whose folder (pdf-tools) and SKILL.md name (pdf) differ is the item pdf, the same item a link to the folder that holds it brings', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/pdf-kit');
    await repo.commit({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'pdf-kit', skills: ['./extra/pdf-tools'] }), 'extra/pdf-tools/SKILL.md': skillMd('pdf') });
    const { look: seen } = await add(box, 'https://github.com/team/pdf-kit');
    assert.deepEqual(seen.names.map(name => [name.kind, name.key, name.there?.folder]), [['skill', 'pdf', 'extra/pdf-tools']]);
    const folder = await look(box, 'https://github.com/team/pdf-kit/tree/main/extra');
    assert.deepEqual(folder.names.map(name => [name.key, name.state, name.why]), [['pdf', 'another', 'https://github.com/team/pdf-kit']], 'one item, pdf: the other link brought it');
  } finally { await box.cleanup(); }
});

test('A plugin.json that can’t be read holds back every kind: each item gone says so on its line, and nothing turns Off though everything else went', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ '.claude-plugin/plugin.json': '{"name":"kit"}', 'skills/notes/SKILL.md': skillMd('notes'), 'agents/helper.md': helperMd(), '.mcp.json': mcpJson({ relay: { command: 'npx' } }) });
    const { id } = await add(box, 'https://github.com/team/kit');
    await repo.commit({ '.claude-plugin/plugin.json': '{ "name": ', 'skills/notes/SKILL.md': null, 'agents/helper.md': null, '.mcp.json': mcpJson({}) });
    const done = await check(box, id);
    assert.deepEqual([answered(done), done.notWhole], [[], ['skill', 'agent', 'mcp']]);
    // Each kind's one line for its plugin.json stands for the one item of that kind the read no longer holds (sources.ts namesOf).
    assert.deepEqual(linesOf((await sourcesView(box.context, box.tools)).sources[0]), ['agent helper: unreadable (its .claude-plugin/plugin.json can’t be read, so where its agents are isn’t known)', 'mcp relay: unreadable (its .claude-plugin/plugin.json can’t be read, so where its MCP servers are isn’t known)', 'skill notes: unreadable (its .claude-plugin/plugin.json can’t be read, so where its skills are isn’t known)']);
    assert.deepEqual(Object.values(await library(box)).map(items => Object.values(items).map(item => item.source === id)), [[true], [true], [true]], 'each still from the source');
  } finally { await box.cleanup(); }
});

test('An agents folder in a plugin that can’t be listed holds back only the agents’ drops: skills and servers are read whole', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-copy-')));
  let unlock: (() => Promise<void>) | undefined;
  try {
    for (const [path, text] of Object.entries({ '.claude-plugin/plugin.json': '{"name":"kit"}', 'skills/notes/SKILL.md': skillMd('notes'), 'agents/helper.md': helperMd(), '.mcp.json': mcpJson({ relay: { command: 'npx' } }) })) await put(join(root, path), text);
    unlock = await lockPath(join(root, 'agents'), 'dir-unreadable');
    const found = await holdsAt(root, '', 'https://github.com/team/kit.git', sourceKinds());
    const source = { id: 's', link: 'https://github.com/team/kit', repository: 'https://github.com/team/kit.git', ref: 'main', folder: '', commit: 'c', commitAt: '', readAt: '', addedAt: '' };
    assert.deepEqual(sourceKinds().map(entry => [entry.kind.kind, readOf(source, found, entry, new Set()).whole]), [['skill', true], ['agent', false], ['mcp', true]]);
  } finally { await unlock?.().catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('Known miss: a plugin with only .codex-plugin/plugin.json is read at the default places, not at the paths that manifest names', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/codex-kit');
    await repo.commit({ '.codex-plugin/plugin.json': JSON.stringify({ name: 'codex-kit', skills: './custom' }), 'custom/x/SKILL.md': skillMd('x'), 'skills/y/SKILL.md': skillMd('y') });
    const seen = await look(box, 'https://github.com/team/codex-kit');
    assert.deepEqual([seen.holds, linesOf(seen)], ['plugin', ['skill y: make']], 'x, which only its manifest names, is not read');
  } finally { await box.cleanup(); }
});

// ---------- A marketplace, and a plugin one lists ----------

/**
 * The marketplace acme-tools at github.com/team/market: kit (its own plugin.json) and lean (an entry with no plugin.json), both in
 * plugins/, and a skills/ folder no plugin of it holds; `branch` also gets it.
 */
async function acme(link = 'https://github.com/team/market') {
  const repo = await repository(hosts, link);
  await repo.commit({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'acme-tools', plugins: [{ name: 'kit', source: './plugins/kit' }, { name: 'lean', source: './plugins/lean', strict: false }] }),
    'plugins/kit/.claude-plugin/plugin.json': '{"name":"kit"}', 'plugins/kit/skills/notes/SKILL.md': skillMd('notes'), 'plugins/kit/agents/helper.md': helperMd(),
    'plugins/lean/skills/brief/SKILL.md': skillMd('brief'), 'skills/shared/SKILL.md': skillMd('shared'),
  });
  return repo;
}

test('A marketplace’s link, bare or /tree/<its default branch>, is offered to the Plugins page with owner/repo, its name and its count; Add with that look is refused and changes nothing; on another branch, or in a folder, it is refused with why; GitLab’s is handed over as git fetches it', async () => {
  const box = await sandbox();
  try {
    const repo = await acme();
    for (const link of ['https://github.com/team/market', 'https://github.com/team/market/tree/main']) {
      const seen = await look(box, link);
      assert.deepEqual([seen.holds, seen.toPlugins, seen.names], ['marketplace', { address: 'team/market', name: 'acme-tools', plugins: 2 }, []], link);
      assert.equal(seen.refused, 'The link holds a marketplace, acme-tools, with 2 plugins: it goes on the Plugin marketplaces page, where each of its plugins has a switch of its own, so a source doesn’t read it.');
      const added = await addSource(box.context, box.tools, seen.token);
      assert.equal(added.stopped, seen.refused, 'Add of its look is refused');
    }
    assert.deepEqual([(await sourcesView(box.context, box.tools)).sources, Object.values(await library(box)).map(items => Object.keys(items))], [[], [[], [], []]]);

    repo.branch('dev');
    await repo.commit({ 'README.md': 'dev\n' });
    repo.branch('main', false);
    const dev = await look(box, 'https://github.com/team/market/tree/dev');
    assert.equal(dev.toPlugins, undefined);
    assert.match(dev.refused ?? '', / It was read on dev, not the default branch, main, and the Plugin marketplaces page adds a marketplace from its repository’s default branch, at its root\. To use it, clone that branch and add the clone’s folder with Folder… on Plugin marketplaces\.$/);

    const nested = await repository(hosts, 'https://github.com/team/nested');
    await nested.commit({ 'market/.claude-plugin/marketplace.json': JSON.stringify({ name: 'inner', plugins: [] }) });
    const inFolder = await look(box, 'https://github.com/team/nested/tree/main/market');
    assert.deepEqual([inFolder.holds, inFolder.toPlugins], ['marketplace', undefined]);
    assert.match(inFolder.refused ?? '', /It is in the folder market, not at its repository’s root/);

    await acme('https://gitlab.example.com/team/market');
    assert.equal((await look(box, 'https://gitlab.example.com/team/market')).toPlugins?.address, 'https://gitlab.example.com/team/market.git');
  } finally { await box.cleanup(); }
});

test('A plugin its repository’s marketplace lists is refused and handed to the Plugins page with that marketplace, an entry with no plugin.json too; on another branch both reasons are said; another folder of that repository is read as today', async () => {
  const box = await sandbox();
  try {
    const repo = await acme();
    const kit = await look(box, 'https://github.com/team/market/tree/main/plugins/kit');
    assert.deepEqual([kit.holds, kit.names, kit.toPlugins], ['listed', [], { address: 'team/market', name: 'acme-tools', plugins: 2 }]);
    assert.equal(kit.refused, 'The link’s folder is the plugin kit, which its repository’s marketplace, acme-tools, lists: it goes on the Plugin marketplaces page with that marketplace (2 plugins), where it has a switch of its own, so a source doesn’t read it.');
    assert.equal((await look(box, 'https://github.com/team/market/tree/main/plugins/lean')).holds, 'listed', 'listed with no plugin.json of its own');

    repo.branch('dev');
    await repo.commit({ 'README.md': 'dev\n' });
    repo.branch('main', false);
    const dev = await look(box, 'https://github.com/team/market/tree/dev/plugins/kit');
    assert.deepEqual([dev.holds, dev.toPlugins], ['listed', undefined]);
    assert.match(dev.refused ?? '', /^The link’s folder is the plugin kit, .* It was read on dev, not the default branch, main/);

    assert.deepEqual(linesOf(await look(box, 'https://github.com/team/market/tree/main/skills')), ['skill shared: make']);
  } finally { await box.cleanup(); }
});

/** The Plugins page's own calls (marketplaces.ts), with each tool's installer stood in for: what they were asked is in `calls`. */
function pluginsPage(box: Box, tools: HarnessId[]) {
  const calls: string[] = [];
  const listed = async () => (JSON.parse(await readFile(join(box.home, '.claude/plugins/installed_plugins.json'), 'utf8').catch(() => '{"plugins":{}}')) as { plugins: Record<string, unknown> }).plugins;
  const host: MarketplaceHost = {
    home: () => ({ home: box.home, actual: true }), read: async () => ({ tools: [...tools], snapshots: [] }), writeAccess: async () => ({ allowed: true }),
    dataDir: join(box.base, 'data'), pickFolder: async () => undefined, openExternal: async () => {}, leftOut: async () => [], share: () => box.context, notices: () => {},
  };
  const use: MarketplaceEngine = {
    findClis: async () => ({ binaries: { 'claude-cli': '/bin/true' }, apps: {} }), checkAccess: engine.checkAccess, readCatalog: engine.readCatalog,
    addMarketplace: async (_context, _catalog, tool) => { calls.push(`marketplace add ${tool}`); return { outcome: 'added', message: 'Added.', runs: [] }; },
    readRemotePlugin: async () => ({ problem: 'not in tests' }),
    // Claude Code's install as far as its record goes: the plugin's folder copied into its cache, and listed.
    install: async (_context, catalog, plugin, tool) => {
      calls.push(`install ${plugin} ${tool}`);
      const copy = join(box.home, '.claude/plugins/cache', catalog.name, plugin, '1.0.0');
      await cp(catalog.plugins.find(each => each.name === plugin)!.folder!, copy, { recursive: true });
      await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { ...await listed(), [`${plugin}@${catalog.name}`]: [{ scope: 'user', installPath: copy, version: '1.0.0' }] } }));
      return { tool, outcome: 'installed', message: 'Installed.', runs: [], changed: true };
    },
    uninstall: async () => { throw new Error('not in these tests'); }, update: async () => { throw new Error('not in these tests'); },
    setSkill: async () => { throw new Error('not in these tests'); }, setPart: async () => { throw new Error('not in these tests'); }, setWhole: async () => { throw new Error('not in these tests'); },
  };
  return { calls, markets: createMarketplaces(host, use, []) };
}

test('Add to Plugin marketplaces is that page’s own add: the marketplace is listed, no installer or tool command runs, no plugin gets an entry, no tool’s record changes, and Sources keeps nothing; added again, or added in a tool before, it is listed once and said to be there already; its Remove there leaves Sources as it was', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    await acme();
    const handed = (await look(box, 'https://github.com/team/market')).toPlugins!;
    const { calls, markets } = pluginsPage(box, box.tools);
    const added = await markets.add(handed.address);
    assert.deepEqual([added.problem, added.already, added.view?.marketplaces.map(entry => [entry.name, entry.plugins.length])], [undefined, undefined, [['acme-tools', 2]]]);
    assert.deepEqual(calls, [], 'no installer and no tool command');
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.central-knot/plugins.json'), 'utf8')).plugins, [], 'no plugin has an entry');
    assert.deepEqual(await Promise.all(['.claude/plugins', '.copilot/config.json', '.codex/config.toml'].map(path => exists(join(box.home, path)))), [false, false, false]);
    assert.deepEqual([(await sourcesView(box.context, box.tools)).sources, Object.values(await library(box)).map(items => Object.keys(items))], [[], [[], [], []]]);

    const again = await markets.add('https://github.com/team/market');
    assert.deepEqual([again.already, again.view?.marketplaces.length], [true, 1]);
    await acme('https://github.com/team/other');
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ other: { source: { source: 'github', repo: 'team/other' } } }));
    const toolsOwn = await markets.add('team/other');
    assert.deepEqual([toolsOwn.already, toolsOwn.view?.marketplaces.length], [true, 2], 'a marketplace Claude Code added is on the page already');

    const removed = await markets.forget('team/market');
    assert.deepEqual(removed.marketplaces.map(entry => entry.source), ['team/other']);
    assert.deepEqual((await markets.forget('team/other')).marketplaces.map(entry => entry.source), ['team/other'], 'Claude Code keeps the one it added');
    assert.deepEqual((await sourcesView(box.context, box.tools)).sources, []);
  } finally { await box.cleanup(); }
});

test('Look succeeds, then the repository can’t be read when Add to Plugin marketplaces runs: that page’s words, nothing listed', async () => {
  const box = await sandbox(['claude-cli']);
  try {
    const repo = await acme('https://github.com/team/private');
    const handed = (await look(box, 'https://github.com/team/private')).toPlugins!;
    await rm(repo.dir, { recursive: true, force: true });
    const { markets } = pluginsPage(box, box.tools);
    const added = await markets.add(handed.address);
    assert.equal(added.problem, engine.gitFailure(128, 'fatal: repository not found').message);
    assert.deepEqual((await markets.view()).marketplaces, []);
  } finally { await box.cleanup(); }
});

test('The Plugins page’s add refuses a link to a branch or a folder, and says to paste it on Library sources', async () => {
  const box = await sandbox(['claude-cli']);
  try {
    const { markets } = pluginsPage(box, box.tools);
    for (const link of ['https://github.com/team/market/tree/main', 'https://gitlab.example.com/team/market/-/tree/main/plugins']) {
      const added = await markets.add(link);
      assert.match(added.problem ?? '', /^That link names a branch or a folder, .* Paste the link on Library sources instead/, link);
    }
    assert.deepEqual((await markets.view()).marketplaces, []);
  } finally { await box.cleanup(); }
});

// ---------- One item through two routes ----------

test('A marketplace, a source on its plugin’s skills/ folder, and the plugin On: Claude Code has the skill once, through the plugin, the library’s copy held as had another way; Pi has one item', async () => {
  const box = await sandbox(['claude-cli', 'pi-cli']);
  try {
    await acme();
    const { markets } = pluginsPage(box, box.tools);
    await markets.add('team/market');
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'acme-tools': { source: { source: 'github', repo: 'team/market' } } }));
    await add(box, 'https://github.com/team/market/tree/main/plugins/kit/skills');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await markets.turn('team/market', 'kit', 'on', undefined, box.home);
    await applySkills(box.context, box.tools, []);
    assert.equal(await exists(join(box.home, '.claude/skills/notes')), false, 'no copy of Central Knot’s beside the plugin’s');
    const notes = (await library(box)).skill.notes;
    assert.deepEqual([notes.on, notes.applied['claude-cli'], await exists(join(box.home, '.pi/agent/skills/notes/SKILL.md'))], [true, undefined, true]);
    assert.deepEqual(Object.keys((await library(box)).skill), ['notes'], 'one item: the plugin’s notes in Pi is the source’s');
  } finally { await box.cleanup(); }
});

/** Claude Code and Copilot CLI with the plugin kit installed from the marketplace team, its copy holding these files; `enabled`: turned on in both. */
async function installedKit(box: Box, files: Record<string, string>, enabled = true) {
  const copy = join(box.base, 'kit-copy'), market = { team: { source: { source: 'directory', path: '/m' } } };
  for (const [path, text] of Object.entries(files)) await put(join(copy, path), text);
  await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'kit@team': [{ scope: 'user', installPath: copy, version: '1.0.0' }] } }));
  await put(join(box.home, '.claude/settings.json'), JSON.stringify({ extraKnownMarketplaces: market, enabledPlugins: { 'kit@team': enabled } }));
  await put(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'kit', marketplace: 'team', version: '1.0.0', cache_path: copy, enabled }] }));
  await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ extraKnownMarketplaces: market }));
}

test('The same plugin added as a source, its agent and server On, then installed in Claude Code and Copilot CLI: Central Knot’s copies leave both, so each has one of each name (the plugin’s), and Codex, which loads neither from a plugin, keeps Central Knot’s; an agent of that name that differs is the known miss, placed beside the plugin’s', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    const files = { '.claude-plugin/plugin.json': '{"name":"kit"}', 'agents/helper.md': helperMd(), '.mcp.json': mcpJson({ relay: { command: 'npx', args: ['relay'] } }) };
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit(files);
    const { id } = await add(box, 'https://github.com/team/kit');
    await applyAgents(box.context, box.tools, [{ key: 'helper', on: true, except: [], seenOn: false }]);
    await applyServers(box.context, box.tools, [{ key: 'relay', on: true, except: [], seenOn: false }]);
    const agentFiles = () => Promise.all(['.claude/agents/helper.md', '.copilot/agents/helper.agent.md', '.codex/agents/helper.toml'].map(path => exists(join(box.home, path))));
    const serverIn = async (file: string) => Object.keys(JSON.parse(await readFile(join(box.home, file), 'utf8').catch(() => '{}')).mcpServers ?? {}).includes('relay');
    const servers = async () => [await serverIn('.claude.json'), await serverIn('.copilot/mcp-config.json'), (await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('[mcp_servers.relay]')];
    assert.deepEqual([await agentFiles(), await servers()], [[true, true, true], [true, true, true]], 'Central Knot’s copies, before the plugin');

    await installedKit(box, files);
    await applyAgents(box.context, box.tools, []);
    await applyServers(box.context, box.tools, []);
    assert.deepEqual([await agentFiles(), await servers()], [[false, false, true], [false, false, true]], 'the plugin’s alone in Claude Code and Copilot CLI');

    await repo.commit({ 'agents/helper.md': helperMd('Help, differently.') });
    assert.deepEqual(answered(await check(box, id)), ['agent helper: update']);
    // The check's pass read the tools before the update: the next pass places the new version.
    await applyAgents(box.context, box.tools, []);
    assert.deepEqual(await agentFiles(), [true, true, true], 'twice in Claude Code and Copilot CLI: Central Knot’s and the plugin’s');
  } finally { await box.cleanup(); }
});

/** A source's agent helper and server relay On, from the plugin kit's own folder: the pass, Central Knot's copies in each tool, and each row's facts. */
async function kitBothWays(box: Box) {
  const files = { '.claude-plugin/plugin.json': '{"name":"kit"}', 'agents/helper.md': helperMd(), '.mcp.json': mcpJson({ relay: { command: 'npx', args: ['relay'] } }) };
  const repo = await repository(hosts, 'https://github.com/team/kit');
  await repo.commit(files);
  await add(box, 'https://github.com/team/kit');
  await applyAgents(box.context, box.tools, [{ key: 'helper', on: true, except: [], seenOn: false }]);
  await applyServers(box.context, box.tools, [{ key: 'relay', on: true, except: [], seenOn: false }]);
  const serverIn = async (file: string) => Object.keys(JSON.parse(await readFile(join(box.home, file), 'utf8').catch(() => '{}')).mcpServers ?? {}).includes('relay');
  return {
    files,
    pass: async () => { await applyAgents(box.context, box.tools, []); await applyServers(box.context, box.tools, []); },
    /** Central Knot's agent file in Claude Code and Copilot CLI, then its relay entry in each. */
    copies: async () => [...await Promise.all(['.claude/agents/helper.md', '.copilot/agents/helper.agent.md'].map(path => exists(join(box.home, path)))), await serverIn('.claude.json'), await serverIn('.copilot/mcp-config.json')],
    rows: async () => [(await agentsView(box.context, box.tools)).items.find(item => item.key === 'helper')!, (await serversView(box.context, box.tools)).items.find(item => item.key === 'relay')!],
  };
}

test('A plugin turned off in a tool keeps holding the item there, as for every kind: the source’s agent and server stay out of Claude Code and Copilot CLI, and each row says it comes through kit, turned off there; uninstalled, Central Knot’s copies come back', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    const kit = await kitBothWays(box);
    await installedKit(box, kit.files);
    await kit.pass();
    assert.deepEqual(await kit.copies(), [false, false, false, false], 'the plugin’s alone, while it is on');
    await installedKit(box, kit.files, false);
    await kit.pass();
    assert.deepEqual(await kit.copies(), [false, false, false, false], 'turned off in both tools: still the plugin’s, its box the item’s switch there');
    for (const row of await kit.rows()) {
      assert.deepEqual(Object.entries(row.plugin ?? {}).map(([tool, given]) => [tool, given?.plugin, given?.off]), [['claude-cli', 'kit', true], ['copilot-cli', 'kit', true]], row.key);
      for (const tool of ['claude-cli', 'copilot-cli'] as const) assert.match(row.cannot[tool] ?? '', /through the plugin kit \(version 1\.0\.0\), turned off there, so no separate copy is placed there\.$/, `${row.key} in ${tool}`);
    }
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {} }));
    await put(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [] }));
    await kit.pass();
    assert.deepEqual(await kit.copies(), [true, true, true, true], 'the plugin uninstalled: Central Knot’s copies are back');
  } finally { await box.cleanup(); }
});

test('The row’s Through a plugin switch turned Off in Claude Code for kit’s helper and relay sticks over a pass: Central Knot’s copies stay out there', async () => {
  const box = await sandbox(['claude-cli']);
  try {
    const kit = await kitBothWays(box);
    await installedKit(box, kit.files);
    await kit.pass();
    // What the row's box writes for Off in Claude Code (partswitch.ts): the plugin's agent and server each turned off there.
    const plugins: engine.PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: {} };
    for (const part of [{ kind: 'agent' as const, name: 'helper' }, { kind: 'mcp' as const, name: 'relay' }]) assert.equal((await engine.setPart(plugins, 'team', 'kit', part, 'claude-cli', false, '/m')).outcome, 'part-off');
    await kit.pass();
    assert.deepEqual((await kit.copies()).filter((_, index) => index % 2 === 0), [false, false], 'no agent file and no relay entry of Central Knot’s in Claude Code');
  } finally { await box.cleanup(); }
});

test('A README, or any page with no front matter, in a plugin’s agents/ folder is no agent: no line for it, the agents are read whole, and an agent the source removes turns Off', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/crew');
    await repo.commit({ '.claude-plugin/plugin.json': '{"name":"crew"}', 'agents/helper.md': helperMd(), 'agents/other.md': helperMd().replace('name: helper', 'name: other'), 'agents/README.md': '# The crew\n', 'agents/index.md': 'What each agent does.\n' });
    const { look: seen, id } = await add(box, 'https://github.com/team/crew');
    assert.deepEqual(linesOf(seen), ['agent helper: make', 'agent other: make']);
    await repo.commit({ 'agents/other.md': null });
    const done = await check(box, id);
    assert.deepEqual([answered(done), done.notWhole], [['agent other: drop'], undefined]);
  } finally { await box.cleanup(); }
});

// ---------- A source that changes what it is, and Remove ----------

test('A source whose link now holds a marketplace turns nothing Off, and its row says why', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/notes');
    await repo.commit({ 'SKILL.md': skillMd('notes') });
    const { id } = await add(box, 'https://github.com/team/notes');
    await repo.commit({ 'SKILL.md': null, '.claude-plugin/marketplace.json': JSON.stringify({ name: 'notes-market', plugins: [] }) });
    const done = await check(box, id);
    assert.deepEqual([answered(done), done.notWhole], [[], ['skill', 'agent', 'mcp']]);
    const row = (await sourcesView(box.context, box.tools)).sources[0];
    assert.deepEqual([row.holds, row.unread, (await library(box)).skill.notes.source], ['marketplace', 'The link holds a marketplace, notes-market, with 0 plugins: it goes on the Plugin marketplaces page, where each of its plugins has a switch of its own, so a source doesn’t read it.', id]);
  } finally { await box.cleanup(); }
});

test('Removing a plugin’s-folder source leaves each item it brought as it is, On or Off, no longer from it', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit(KIT);
    const { id } = await add(box, 'https://github.com/team/kit');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await removeSource(box.context, box.tools, id);
    const items = await library(box);
    assert.deepEqual([items.skill.notes.on, items.skill.tools.on, items.agent.helper.on, items.mcp.relay.on], [true, false, false, false]);
    assert.ok(await exists(join(box.home, '.claude/skills/notes/SKILL.md')));
    assert.deepEqual((await sourcesView(box.context, box.tools)).sources, []);
  } finally { await box.cleanup(); }
});
