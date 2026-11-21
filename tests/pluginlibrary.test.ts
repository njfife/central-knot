// A plugin's items in Pi and OpenCode as library items linked to it (library.ts A PLUGIN, pluginlibrary.ts), as worked examples
// on real files in a temp home, through the Plugins page's own calls (marketplaces.ts) with the tools' installers stood in for,
// as tests/marketplaces.test.ts stands them in. The table's rows alone, on single letters, are in tests/library.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { agentKind, agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { pluginFiles } from '../src/catalogdetail.ts';
import type { ItemKind } from '../src/library.ts';
import { readProfiles, saveProfile, switchProfile } from '../src/profiles.ts';
import { pluginLive } from '../src/profileplan.ts';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import { readPlugin } from '../src/pluginlibrary.ts';
import { notInWhy } from '../src/pluginstatus.ts';
import { readHistory } from '../src/history.ts';
import * as engine from '../src/plugins.ts';
import { applyServers, restoreServer, serverKind, serversView } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, restoreSkill, skillKind, skillsView } from '../src/skills.ts';
import type { HarnessId, HomeView, PluginTurn } from '../src/types.ts';
import { execFileSync } from 'node:child_process';
import { connectRepo, pushRepo } from '../src/gitrepo.ts';
import { addSource, previewSource } from '../src/sources.ts';
import { repository, standInHosts } from './sourcerepo.ts';

const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const exists = (path: string) => stat(path).then(() => true, () => false);
const skill = (name: string, body = name) => `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`;

/**
 * The marketplace `team` with the plugin kit: the skills notes and review in skills/, the skill tools in extra/ (its plugin.json
 * lists that folder), the agent helper, and two MCP servers: relay (a command) and local (it runs from the plugin's folder, so
 * it stays with the plugin).
 */
async function market(root: string) {
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'kit', source: './plugins/kit', version: '1.0.0' }] }));
  const kit = join(root, 'plugins/kit');
  await put(join(kit, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', skills: ['./extra/tools'] }));
  await put(join(kit, 'skills/notes/SKILL.md'), skill('notes'));
  await put(join(kit, 'skills/review/SKILL.md'), skill('review'));
  await put(join(kit, 'extra/tools/SKILL.md'), skill('tools'));
  await put(join(kit, 'agents/helper.md'), '---\nname: helper\ndescription: Helps.\n---\nHelp.\n');
  await put(join(kit, '.mcp.json'), JSON.stringify({ mcpServers: { relay: { command: 'npx', args: ['relay'] }, local: { command: '${CLAUDE_PLUGIN_ROOT}/bin/local' } } }));
  return kit;
}

/** A home with Claude Code and Pi (or `tools`), whose Claude Code installs kit for real as far as its records go. */
async function kitHome(options: { tools?: HarnessId[] } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-items-')));
  const home = join(base, 'home'), root = join(base, 'market'), tools = options.tools ?? ['claude-cli', 'pi-cli'];
  await mkdir(join(home, '.pi/agent'), { recursive: true });
  const calls: string[] = [], notices: string[] = [];
  const listed = async () => (JSON.parse(await readFile(join(home, '.claude/plugins/installed_plugins.json'), 'utf8').catch(() => '{"plugins":{}}')) as { plugins: Record<string, unknown> }).plugins;
  const write = async (plugins: Record<string, unknown>) => put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  const share: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  const host: MarketplaceHost = {
    home: () => ({ home, actual: true }), read: async () => ({ tools: [...tools], snapshots: [] }), writeAccess: async () => ({ allowed: true }),
    dataDir: join(base, 'data'), pickFolder: async () => undefined, openExternal: async () => {}, leftOut: async () => [], share: () => share,
    notices: (kind, told) => { notices.push(...told.map(notice => `${kind} ${notice.kind} ${'item' in notice ? notice.item : ''}`)); },
  };
  const use: MarketplaceEngine = {
    findClis: async () => ({ binaries: { 'claude-cli': '/bin/true' }, apps: {} }),
    checkAccess: engine.checkAccess, addMarketplace: async () => ({ outcome: 'added', message: 'Added.', runs: [] }), readCatalog: engine.readCatalog,
    readRemotePlugin: async () => ({ problem: 'not in tests' }),
    install: async (_context, catalog, plugin, tool) => {
      calls.push(`install ${plugin} ${tool}`);
      const copy = join(home, '.claude/plugins/cache', catalog.name, plugin, '1.0.0');
      await put(join(copy, 'skills/notes/SKILL.md'), skill('notes'));
      await write({ ...await listed(), [`${plugin}@${catalog.name}`]: [{ scope: 'user', installPath: copy, version: '1.0.0' }] });
      return { tool, outcome: 'installed', message: 'Installed.', runs: [], changed: true };
    },
    uninstall: async (_context, marketplace, plugin, tool) => {
      calls.push(`uninstall ${plugin} ${tool}`);
      const { [`${plugin}@${marketplace}`]: _gone, ...rest } = await listed();
      await write(rest);
      return { tool, outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true };
    },
    update: async () => { throw new Error('not in these tests'); }, setSkill: async () => { throw new Error('not in these tests'); },
    setPart: async () => { throw new Error('not in these tests'); }, setWhole: async () => { throw new Error('not in these tests'); },
  };
  const markets = createMarketplaces(host, use, []);
  const kit = await market(root);
  await markets.add(root);
  await put(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'git', url: root } } }));
  const turn = (what: PluginTurn, tool?: HarnessId) => markets.turn(root, 'kit', what, tool, home);
  const library = async () => ({ skill: (await skillKind.open(share)).library.items, agent: (await agentKind.open(share)).library.items, mcp: (await serverKind.open(share)).library.items });
  const view = async () => (await markets.view()).marketplaces.find(entry => entry.source === root)!;
  return {
    base, home, root, kit, calls, notices, share, markets, turn, library, view, tools,
    undo: (done: Awaited<ReturnType<typeof turn>>) => markets.undoTurn(root, 'kit', done.before!, done.back!, home),
    update: () => markets.items(root, 'team', 'kit', ['pi-cli'], home),
    pi: (path: string) => join(home, '.pi/agent', path),
    lines: async () => Object.fromEntries((await view()).items?.kit?.lines.map(line => [`${line.kind}:${line.key}`, line.state]) ?? []),
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

/** Every file under a folder, by its path in it, with its bytes: what an Undo must leave as it was. */
async function files(folder: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const walk = async (dir: string) => { for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) await walk(join(dir, entry.name)); else found[relative(folder, join(dir, entry.name))] = await readFile(join(dir, entry.name), 'utf8');
  } };
  await walk(folder);
  return found;
}

// ---------- The read ----------

test('The read: each kind’s items as the tools’ own layout gives them, a skill keyed by its folder, a server that runs from the plugin left out, and whole', async () => {
  const box = await kitHome();
  try {
    const entry = { id: 'kit-id', source: box.root, marketName: 'team', plugin: 'kit', on: true, except: [] };
    const read = await readPlugin(await pluginFiles(box.kit, { name: 'kit', source: './plugins/kit' }, box.root), entry, '2026-11-15T00:00:00.000Z', new Set(['kit-id']), []);
    const names = (kind: string) => [...read.find(each => each.kind === kind)!.names].map(([key, there]) => ('unreadable' in there ? `${key}: ${there.unreadable}` : key));
    assert.deepEqual(names('skill'), ['notes', 'review', 'tools'], 'skills/ and the folder its plugin.json lists');
    assert.deepEqual(names('agent'), ['helper']);
    assert.deepEqual(names('mcp'), ['relay', 'local: it names a plugin’s own folder or settings, which only Claude Code fills in, for a plugin']);
    assert.deepEqual(read.map(each => [each.kind, each.whole, each.link, each.plugin]), [['skill', true, 'plugin:kit@team', { on: true, outOf: [], into: [] }], ['agent', true, 'plugin:kit@team', { on: true, outOf: [], into: [] }], ['mcp', true, 'plugin:kit@team', { on: true, outOf: [], into: [] }]], 'a left-out server holds back no drop');
    // A folder named apart from its SKILL.md's name is keyed by its folder, as every tool's copy is; two folders of one name are both left out.
    await put(join(box.kit, 'skills/pdf-tools/SKILL.md'), skill('pdf'));
    await put(join(box.kit, 'more/notes/SKILL.md'), skill('notes', 'another'));
    await put(join(box.kit, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', skills: ['./extra/tools', './more'] }));
    const again = await readPlugin(await pluginFiles(box.kit, { name: 'kit', source: './plugins/kit' }, box.root), entry, '', new Set(), []);
    assert.deepEqual([...again[0].names.keys()].sort(), ['notes', 'pdf-tools', 'review', 'tools']);
    assert.deepEqual(again[0].names.get('notes'), { unreadable: 'two skills in the plugin are named notes' });
    assert.equal(again[0].whole, true, 'two of one name are read, and left out: no drop is held back');
    // Its folder gone from the marketplace's copy reads as nothing at all: no kind is whole, so nothing turns off.
    const gone = await readPlugin(await pluginFiles(join(box.base, 'nowhere'), {}, box.base), entry, '', new Set(), []);
    assert.deepEqual(gone.map(each => [each.kind, each.whole, each.names.size]), [['skill', false, 0], ['agent', false, 0], ['mcp', false, 0]]);
  } finally { await box.cleanup(); }
});

test('A read that isn’t whole turns nothing off: a plugin.json that can’t be read, one skill that can’t be read, the plugin’s folder gone, the plugin dropped from its catalog, the marketplace unreadable', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    const linkedOn = async () => Object.values((await box.library()).skill).filter(item => item.source && item.on).map(item => item.key).sort();
    assert.deepEqual(await linkedOn(), ['notes', 'review', 'tools']);
    // Each in turn, then Update: what is there may update, but nothing is gone.
    const breakAndRead = async (spoil: () => Promise<void>, mend: () => Promise<void>, why: string) => {
      await spoil();
      await box.update();
      assert.deepEqual(await linkedOn(), ['notes', 'review', 'tools'], why);
      assert.equal(await exists(box.pi('skills/notes/SKILL.md')), true, why);
      await mend();
    };
    const manifest = join(box.kit, '.claude-plugin/plugin.json'), text = await readFile(manifest, 'utf8');
    await breakAndRead(() => put(manifest, '{ not json'), () => put(manifest, text), 'plugin.json can’t be read: it may name other folders');
    await breakAndRead(() => put(join(box.kit, 'skills/review/SKILL.md'), '---\nname: [review\n---\n'), () => put(join(box.kit, 'skills/review/SKILL.md'), skill('review')), 'one skill unreadable');
    const moved = join(box.base, 'kit-away');
    await breakAndRead(async () => { await rm(moved, { recursive: true, force: true }); await writeFile(join(box.base, 'noop'), ''); await import('node:fs/promises').then(fs => fs.rename(box.kit, moved)); },
      () => import('node:fs/promises').then(fs => fs.rename(moved, box.kit)), 'its folder gone from the marketplace’s copy');
    const catalog = join(box.root, '.claude-plugin/marketplace.json'), listed = await readFile(catalog, 'utf8');
    await breakAndRead(() => put(catalog, JSON.stringify({ name: 'team', plugins: [] })), () => put(catalog, listed), 'dropped from its catalog: not read at all');
    await breakAndRead(() => put(catalog, '{'), () => put(catalog, listed), 'the marketplace unreadable');
  } finally { await box.cleanup(); }
});

// ---------- The switch on its items ----------

test('On makes its items and turns them On in Pi; Pi’s box unticked takes them out of Pi only; Off takes them out and keeps them; each Undo leaves every file as it was', async () => {
  const box = await kitHome();
  try {
    const before = await files(box.pi(''));
    const on = await box.turn('on');
    assert.deepEqual(on.done.map(step => [step.tool, step.action, step.report.outcome]), [['claude-cli', 'install', 'installed'], ['pi-cli', 'install-items', 'installed']]);
    assert.equal(await readFile(box.pi('skills/notes/SKILL.md'), 'utf8'), skill('notes'), 'byte for byte from the plugin');
    assert.equal(await exists(box.pi('skills/helper.md')), true, 'its agent, as a skill in Pi');
    assert.deepEqual(Object.keys(JSON.parse(await readFile(box.pi('mcp.json'), 'utf8')).mcpServers), ['relay'], 'the server that runs from the plugin stays with it');
    const items = await box.library();
    assert.deepEqual(Object.values(items.skill).map(item => [item.key, item.on, item.except, item.source === items.agent.helper!.source]), [['notes', true, [], true], ['review', true, [], true], ['tools', true, [], true]]);
    assert.equal(await exists(join(box.home, '.claude/skills/notes')), false, 'Claude Code has it with the plugin: no copy of its own');
    const onBytes = await files(box.pi(''));
    // Pi's box unticked, and its Undo.
    const out = await box.turn('keep-out', 'pi-cli');
    assert.deepEqual(out.done.map(step => [step.tool, step.action, step.report.changed]), [['pi-cli', 'remove-items', true]]);
    assert.deepEqual([await exists(box.pi('skills/notes')), box.calls.filter(call => call.startsWith('uninstall'))], [false, []], 'Pi only');
    assert.deepEqual(Object.values((await box.library()).skill).map(item => [item.on, item.except]), [[true, ['pi-cli']], [true, ['pi-cli']], [true, ['pi-cli']]]);
    await box.undo(out);
    assert.deepEqual(await files(box.pi('')), onBytes, 'the untick undone: every file as it was');
    // Off, and its Undo.
    const off = await box.turn('off');
    assert.equal(await exists(box.pi('skills/notes')), false);
    assert.deepEqual(Object.values((await box.library()).skill).map(item => [item.on, item.versions.length > 0, !!item.source]), [[false, true, true], [false, true, true], [false, true, true]], 'kept in Central Knot, linked, with its versions');
    await box.undo(off);
    assert.deepEqual(await files(box.pi('')), onBytes, 'Off undone: back byte for byte');
    // On's own Undo: the items it made go Off, linked; Pi is as before the click.
    await box.undo(on);
    assert.deepEqual(Object.keys(await files(box.pi(''))).filter(path => path.startsWith('skills/')), Object.keys(before).filter(path => path.startsWith('skills/')));
    assert.deepEqual(Object.values((await box.library()).skill).map(item => [item.on, !!item.source]), [[false, true], [false, true], [false, true]]);
  } finally { await box.cleanup(); }
});

test('Arriving On writes over nothing: Pi’s own skill review keeps Pi out of the plugin’s item; the person’s library item notes of the same content is never linked, and the plugin’s Off leaves it On', async () => {
  const box = await kitHome();
  try {
    await put(box.pi('skills/review/SKILL.md'), skill('review', 'mine'));
    await put(box.pi('skills/notes/SKILL.md'), skill('notes'));
    await applySkills(box.share, box.tools, [{ key: 'notes', on: true, except: [] }]);
    await box.turn('on');
    assert.equal(await readFile(box.pi('skills/review/SKILL.md'), 'utf8'), skill('review', 'mine'), 'his own copy, byte for byte');
    const items = (await box.library()).skill;
    assert.deepEqual([items.review!.except, items.review!.on, items.notes!.source], [['pi-cli'], true, undefined]);
    assert.deepEqual((await box.lines())['skill:notes'], 'alike', 'Its items says the name is his, the same as the plugin’s');
    await box.turn('off');
    assert.deepEqual([(await box.library()).skill.notes!.on, await exists(box.pi('skills/notes/SKILL.md'))], [true, true], 'his own notes stays On, in Pi');
    // A tick on one tool's box changes its except alone, and still not where Pi has a copy of its own.
    await box.turn('on');
    await box.turn('keep-out', 'pi-cli');
    await box.turn('let-in', 'pi-cli');
    assert.deepEqual([(await box.library()).skill.review!.except, await readFile(box.pi('skills/review/SKILL.md'), 'utf8')], [['pi-cli'], skill('review', 'mine')]);
  } finally { await box.cleanup(); }
});

test('An item turned off by itself comes back On with the plugin’s On: nothing stored says it was off before the plugin’s Off (the cost of that rule)', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await applySkills(box.share, box.tools, [{ key: 'review', on: false, except: [] }]);
    const { itemsOnWords } = await import('../src/pluginstatus.ts');
    assert.equal(itemsOnWords(await box.view(), 'kit', 'pi-cli'), '4 of its 5 items are on', 'the page counts the one off');
    await box.turn('off');
    await box.turn('on');
    assert.equal((await box.library()).skill.review!.on, true);
  } finally { await box.cleanup(); }
});

// ---------- Held in the tools with an installer ----------

test('In Claude Code a linked item is held: with the plugin installed it has it another way; kept out or not installed it can’t be given it, and his own copy there stays as it is whichever way Claude Code’s record reads', async () => {
  const box = await kitHome();
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skill('notes', 'his own'));
    await box.turn('on');
    const own = () => readFile(join(box.home, '.claude/skills/notes/SKILL.md'), 'utf8');
    assert.equal(await own(), skill('notes', 'his own'));
    // Claude Code's record of its plugins can't be read for one look (it then reads as nothing installed), then reads again.
    const record = join(box.home, '.claude/plugins/installed_plugins.json'), text = await readFile(record, 'utf8');
    await put(record, '{ half written');
    await applySkills(box.share, box.tools, []);
    assert.equal(await own(), skill('notes', 'his own'), 'the record unreadable: nothing written over his file');
    await put(record, text);
    await applySkills(box.share, box.tools, []);
    assert.equal(await own(), skill('notes', 'his own'), 'readable again: nothing removed');
    // Kept out of Claude Code: still nothing written there, and its line says why.
    await rm(join(box.home, '.claude/skills'), { recursive: true });
    await box.turn('keep-out', 'claude-cli');
    await applySkills(box.share, box.tools, []);
    assert.equal(await exists(join(box.home, '.claude/skills/review')), false);
    const { skillsView } = await import('../src/skills.ts');
    const line = (await skillsView(box.share, box.tools)).items.find(item => item.key === 'review')!;
    assert.match(line.cannot['claude-cli'] ?? JSON.stringify(line), /only with the plugin kit, and the plugin is kept out of Claude Code/);
  } finally { await box.cleanup(); }
});

// ---------- An update, and a change made here ----------

test('An update follows: a changed skill updates in Pi, a new one arrives On, one gone turns Off with History’s entry and its notice; turning it on keeps it as his own', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await put(join(box.kit, 'skills/notes/SKILL.md'), skill('notes', 'v2'));
    await put(join(box.kit, 'skills/fresh/SKILL.md'), skill('fresh'));
    await rm(join(box.kit, 'skills/review'), { recursive: true });
    assert.deepEqual(await box.lines(), { 'skill:notes': 'update', 'skill:fresh': 'new', 'skill:review': 'going', 'skill:tools': 'linked', 'agent:helper': 'linked', 'mcp:relay': 'linked', 'mcp:local': 'not-brought' });
    const ran = await box.update();
    assert.deepEqual(ran.reports.map(report => [report.tool, report.outcome, report.changed]), [['pi-cli', 'updated', true]]);
    assert.equal(await readFile(box.pi('skills/notes/SKILL.md'), 'utf8'), skill('notes', 'v2'));
    assert.equal(await exists(box.pi('skills/fresh/SKILL.md')), true, 'new in the plugin: arrives with its On, in Pi where the plugin is');
    assert.equal(await exists(box.pi('skills/review')), false);
    const review = (await box.library()).skill.review!;
    assert.deepEqual([review.on, review.source], [false, undefined]);
    const dropped = (await readHistory(box.share)).find(event => event.key === 'review' && event.cause === 'source-dropped')!;
    assert.deepEqual([dropped.link, box.notices], ['plugin:kit@team', ['skill dropped review']], 'History’s entry, and the notice its page shows once');
    assert.equal((await box.lines())['skill:review'], 'removed');
    // Turning it on is the revert: his own from then on; the next read leaves it alone.
    await applySkills(box.share, box.tools, [{ key: 'review', on: true, except: [] }]);
    await box.update();
    assert.deepEqual([(await box.library()).skill.review!.on, (await box.library()).skill.review!.source], [true, undefined]);
  } finally { await box.cleanup(); }
});

test('An item changed here is let go at the look that sees it: his own from then on; the plugin’s update and Off leave it; deleted, the plugin’s comes back at the next read', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await put(box.pi('skills/notes/SKILL.md'), skill('notes', 'edited in Pi'));
    const looked = await applySkills(box.share, box.tools, []);
    assert.deepEqual(looked.notices?.flatMap(notice => ('link' in notice && notice.kind === 'let-go' ? [notice.item] : [])), ['notes'], 'said once, after the fact');
    const notes = (await box.library()).skill.notes!;
    assert.deepEqual([notes.source, notes.on], [undefined, true]);
    assert.equal((await readHistory(box.share)).find(event => event.key === 'notes' && event.cause === 'own-now')?.link, 'plugin:kit@team');
    await put(join(box.kit, 'skills/notes/SKILL.md'), skill('notes', 'v2'));
    await box.update();
    assert.equal(await readFile(box.pi('skills/notes/SKILL.md'), 'utf8'), skill('notes', 'edited in Pi'), 'the update changes nothing of his');
    assert.equal((await box.lines())['skill:notes'], 'not-brought');
    await box.turn('off');
    assert.equal(await readFile(box.pi('skills/notes/SKILL.md'), 'utf8'), skill('notes', 'edited in Pi'), 'the plugin’s Off leaves his own in Pi');
    await applySkills(box.share, box.tools, [{ key: 'notes', on: false, except: [], deleted: true }]);
    await box.turn('on');
    const back = (await box.library()).skill.notes!;
    assert.deepEqual([back.deleted, !!back.source, back.on], [undefined, true, true], 'a deleted name never blocks the plugin’s item');
    assert.equal(await readFile(box.pi('skills/notes/SKILL.md'), 'utf8'), skill('notes', 'v2'));
  } finally { await box.cleanup(); }
});

test('A copy that can’t be read just now lets nothing go', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await put(box.pi('skills/notes/SKILL.md'), '---\nname: [notes\n---\n');
    await applySkills(box.share, box.tools, []);
    assert.equal((await box.library()).skill.notes!.source !== undefined, true);
  } finally { await box.cleanup(); }
});

// ---------- New items and where they go ----------

test('A new item the check brings is kept out of each tool the plugin isn’t in: Pi kept out, Pi’s items each kept out on their own rows; one item switched off by itself keeps it in; the background never turns an item On', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await box.turn('keep-out', 'pi-cli');
    await put(join(box.kit, 'skills/fresh/SKILL.md'), skill('fresh'));
    await box.update();
    assert.deepEqual([(await box.library()).skill.fresh!.except, await exists(box.pi('skills/fresh'))], [['pi-cli'], false], 'kept out of Pi');
    await box.turn('let-in', 'pi-cli');
    // Every item kept out of Pi on its own row, the entry still wanting Pi: the plugin is not in Pi.
    const { applyAgents } = await import('../src/agents.ts'), { applyServers } = await import('../src/servers.ts');
    await applySkills(box.share, box.tools, ['notes', 'review', 'tools', 'fresh'].map(key => ({ key, on: true, except: ['pi-cli'] })));
    await applyAgents(box.share, box.tools, [{ key: 'helper', on: true, except: ['pi-cli'] }]);
    await applyServers(box.share, box.tools, [{ key: 'relay', on: true, except: ['pi-cli'] }]);
    await put(join(box.kit, 'skills/third/SKILL.md'), skill('third'));
    await box.update();
    assert.deepEqual([(await box.library()).skill.third!.except, await exists(box.pi('skills/third'))], [['pi-cli'], false], 'out of Pi by each item’s own except: a new one stays out too');
    await applySkills(box.share, box.tools, ['notes', 'tools', 'fresh', 'third'].map(key => ({ key, on: true, except: [] })));
    await applySkills(box.share, box.tools, [{ key: 'review', on: false, except: [] }]);
    await put(join(box.kit, 'skills/second/SKILL.md'), skill('second'));
    await box.update();
    assert.deepEqual([(await box.library()).skill.second!.except, (await box.library()).skill.review!.on], [[], false], 'one item off by itself: the plugin is still in Pi, and that item stays off');
  } finally { await box.cleanup(); }
});

test('A home whose plugin has no parts, with Pi managed: the first view and two checks make no item and change no tool file', async () => {
  const box = await kitHome();
  try {
    await box.markets.install(box.root, 'team', 'kit', ['claude-cli'], box.home);
    await rm(join(box.home, '.central-knot/plugins.json'), { force: true });
    const before = await files(box.home);
    await box.view();
    for (let check = 0; check < 2; check++) {
      const due = await box.markets.pendingUpdates(box.home);
      assert.deepEqual(due.ops, []);
    }
    const after = await files(box.home);
    assert.deepEqual(Object.keys(after).filter(path => !path.startsWith('.central-knot/')), Object.keys(before).filter(path => !path.startsWith('.central-knot/')));
    assert.deepEqual(Object.values((await box.library()).skill), []);
  } finally { await box.cleanup(); }
});

test('An edit no pass has seen yet, then the plugin’s Off: the Off’s own pass lets it go first, and the Off’s click on it is not taken', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await put(box.pi('skills/notes/SKILL.md'), skill('notes', 'edited just now'));
    await box.turn('off');
    const notes = (await box.library()).skill.notes!;
    assert.deepEqual([notes.on, notes.source, await readFile(box.pi('skills/notes/SKILL.md'), 'utf8')], [true, undefined, skill('notes', 'edited just now')]);
    assert.equal((await box.library()).skill.review!.on, false, 'the plugin’s other items are Off');
  } finally { await box.cleanup(); }
});

test('A Git source and a plugin with one name: neither takes the other’s item, and the source’s line names the plugin', async () => {
  const box = await kitHome(), hosts = await standInHosts();
  try {
    await box.turn('on');
    const repo = await repository(hosts, 'https://github.com/team/notes');
    await repo.commit({ 'SKILL.md': skill('notes') });
    const look = await previewSource(box.share, box.tools, 'https://github.com/team/notes');
    if (!('token' in look)) return assert.fail(look.refused);
    assert.deepEqual(look.names.map(name => [name.key, name.state, name.why]), [['notes', 'another', 'plugin:kit@team']], 'the same content, and still not linked: it is the plugin’s');
    await addSource(box.share, box.tools, look.token);
    const pluginId = JSON.parse(await readFile(join(box.home, '.central-knot/plugins.json'), 'utf8')).plugins[0].id;
    assert.equal((await box.library()).skill.notes!.source, pluginId, 'still the plugin’s after Add');
  } finally { await box.cleanup(); await hosts.cleanup(); }
});

test('Push leaves out an item linked to a plugin: each machine gets it from the plugin there; the person’s own goes', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await put(box.pi('skills/mine/SKILL.md'), skill('mine'));
    await applySkills(box.share, box.tools, [{ key: 'mine', on: true, except: [] }]);
    const remote = join(box.base, 'config.git');
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    await connectRepo(box.share, remote, '');
    await pushRepo(box.share);
    const clone = join(box.base, 'clone');
    execFileSync('git', ['clone', '--quiet', remote, clone]);
    assert.deepEqual([await readdir(join(clone, 'skills')), await exists(join(clone, 'agents/helper.md')), await exists(join(clone, 'mcp/relay.json'))], [['mine'], false, false]);
  } finally { await box.cleanup(); }
});

test('A tool new here is owed the plugin’s items by the automatic updates: they are made there, On; what the library has already reaches it by the library’s own rule', async () => {
  const tools: HarnessId[] = ['claude-cli'];
  const box = await kitHome({ tools });
  try {
    await box.turn('on');
    assert.deepEqual(Object.keys((await box.library()).skill), [], 'no tool takes its items yet: none is made');
    tools.push('pi-cli');
    const due = await box.markets.pendingUpdates(box.home);
    assert.deepEqual(due.ops.map(op => [op.tool, op.action, op.newHere]), [['pi-cli', 'install-items', true]]);
    const ran = await box.markets.items(box.root, 'team', 'kit', ['pi-cli'], box.home, true);
    assert.deepEqual(ran.reports.map(report => [report.tool, report.outcome]), [['pi-cli', 'installed']]);
    assert.deepEqual([await exists(box.pi('skills/notes/SKILL.md')), (await box.library()).skill.notes!.except], [true, []]);
  } finally { await box.cleanup(); }
});

test('A plugin’s agent and server are held in Claude Code too: no agent file of Central Knot’s there, and no entry of its in Claude Code’s MCP file', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    const { applyAgents } = await import('../src/agents.ts'), { applyServers } = await import('../src/servers.ts');
    await applyAgents(box.share, box.tools, []);
    const servers = await applyServers(box.share, box.tools, []);
    assert.deepEqual([await exists(join(box.home, '.claude/agents/helper.md')), servers.results.filter(result => result.harness === 'claude-cli').map(result => result.item)], [false, []]);
    assert.equal((await readFile(join(box.home, '.claude.json'), 'utf8').catch(() => '')).includes('relay'), false);
    assert.equal(await exists(box.pi('skills/helper.md')), true, 'Pi has the agent, as a skill');
  } finally { await box.cleanup(); }
});

// ---------- Found by the break-it pass and the code read ----------

test('A plugin’s item he deleted stays deleted through the automatic check, and its page says he deleted it; a click that brings the plugin in brings it back', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await applySkills(box.share, box.tools, [{ key: 'review', on: false, except: [], deleted: true }]);
    const due = await box.markets.pendingUpdates(box.home);
    assert.deepEqual(due.ops.filter(op => op.action === 'update-items'), [], 'nothing for the check to read');
    await box.update();
    assert.deepEqual([(await box.library()).skill.review!.deleted !== undefined, await exists(box.pi('skills/review'))], [true, false], 'a read that is no click leaves it deleted');
    assert.equal((await box.lines())['skill:review'], 'deleted');
    await box.turn('off');
    await box.turn('on');
    assert.deepEqual([(await box.library()).skill.review!.deleted, await exists(box.pi('skills/review/SKILL.md'))], [undefined, true], 'the plugin’s On brings it back');
  } finally { await box.cleanup(); }
});

test('On, its Undo, then On again: every item is On in Pi again', async () => {
  const box = await kitHome();
  try {
    const on = await box.turn('on');
    await box.undo(on);
    assert.equal(await exists(box.pi('skills/notes')), false);
    const again = await box.turn('on');
    assert.deepEqual([again.done.find(step => step.tool === 'pi-cli')?.report.outcome, await exists(box.pi('skills/notes/SKILL.md')), Object.values((await box.library()).skill).every(item => item.on)], ['installed', true, true]);
  } finally { await box.cleanup(); }
});

test('Every item switched off on its own row: ticking Pi’s box turns them on there', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    const { applyAgents } = await import('../src/agents.ts'), { applyServers } = await import('../src/servers.ts');
    await applySkills(box.share, box.tools, ['notes', 'review', 'tools'].map(key => ({ key, on: false, except: [] })));
    await applyAgents(box.share, box.tools, [{ key: 'helper', on: false, except: [] }]);
    await applyServers(box.share, box.tools, [{ key: 'relay', on: false, except: [] }]);
    assert.equal((await box.view()).switches?.kit?.tools['pi-cli']?.act, 'install-items', 'its box is empty, though the plugin is on');
    const tick = await box.turn('let-in', 'pi-cli');
    assert.deepEqual([tick.done.map(step => step.report.outcome), await exists(box.pi('skills/notes/SKILL.md'))], [['installed'], true]);
  } finally { await box.cleanup(); }
});

test('An edit in Pi lets notes go, kept where it is: nothing of it reaches Claude Code by itself, and its row lets it in there', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await put(box.pi('skills/notes/SKILL.md'), skill('notes', 'edited in Pi'));
    for (let look = 0; look < 3; look++) await applySkills(box.share, box.tools, []);
    const notes = (await box.library()).skill.notes!;
    assert.deepEqual([notes.source, notes.except, await exists(join(box.home, '.claude/skills/notes'))], [undefined, ['claude-cli'], false]);
    await applySkills(box.share, box.tools, [{ key: 'notes', on: true, except: [] }]);
    assert.equal(await readFile(join(box.home, '.claude/skills/notes/SKILL.md'), 'utf8'), skill('notes', 'edited in Pi'));
  } finally { await box.cleanup(); }
});

// ---------- Found by the confirming read ----------

test('Ticking Pi’s box turns its items On there as the plugin’s On does, so a name he deleted comes back; the automatic check never brings it back', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await box.turn('keep-out', 'pi-cli');
    await applySkills(box.share, box.tools, [{ key: 'review', on: false, except: [], deleted: true }]);
    await box.update();
    assert.deepEqual([(await box.library()).skill.review!.deleted !== undefined, await exists(box.pi('skills/review'))], [true, false], 'the check leaves it deleted');
    await box.turn('let-in', 'pi-cli');
    assert.deepEqual([(await box.library()).skill.review!.deleted, await exists(box.pi('skills/review'))], [undefined, true]);
  } finally { await box.cleanup(); }
});

test('Every item of a plugin let go: its page still lists them, Pi says why none goes in, and its box is off, saying so; the check finds nothing', async () => {
  const box = await kitHome();
  try {
    // kit holding one skill, notes, alone.
    for (const path of ['skills/review', 'extra', 'agents', '.mcp.json']) await rm(join(box.kit, path), { recursive: true, force: true });
    await box.turn('on');
    await put(box.pi('skills/notes/SKILL.md'), skill('notes', 'edited in Pi'));
    await applySkills(box.share, box.tools, []);
    assert.deepEqual(await box.lines(), { 'skill:notes': 'not-brought' });
    const pi = (await box.view()).switches!.kit!.tools['pi-cli']!;
    assert.deepEqual([pi.act, pi.held], [undefined, KEEPS_NOTES], 'his own now: kept, said as a state, with Use the plugin’s beside it on the page');
    assert.deepEqual((await box.view()).items!.kit!.yours, { 'pi-cli': [{ kind: 'skill', key: 'notes', name: 'notes' }] });
    assert.deepEqual((await box.markets.pendingUpdates(box.home)).ops, []);
  } finally { await box.cleanup(); }
});

test('An item that is Off when it is let go keeps its except as it was: turned On, it goes where it is wanted', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    const first = (await box.library()).skill.notes!.hash;
    await put(join(box.kit, 'skills/notes/SKILL.md'), skill('notes', 'v2'));
    await box.update();
    await applySkills(box.share, box.tools, [{ key: 'notes', on: false, except: [] }]);
    await applySkills(box.share, box.tools, [{ key: 'notes', on: false, except: [], version: first }]);
    await applySkills(box.share, box.tools, []);
    const notes = (await box.library()).skill.notes!;
    assert.deepEqual([notes.source, notes.except], [undefined, []]);
    // Claude Code has the same SKILL.md through the installed plugin, so it gets no copy of its own beside it (skills.ts anotherWay).
    await applySkills(box.share, box.tools, [{ key: 'notes', on: true, except: [] }]);
    assert.equal(await exists(box.pi('skills/notes/SKILL.md')), true);
  } finally { await box.cleanup(); }
});

// ---------- Why none of its items is on in a tool (pluginstatus.ts notInWhy), as the run's report and the page say it ----------

/** kit holding one skill, notes, alone; `piSays`: what Pi's report says after `click`, and what its line on the plugin's page says. */
async function notesOnly() {
  const box = await kitHome();
  for (const path of ['skills/review', 'extra', 'agents', '.mcp.json']) await rm(join(box.kit, path), { recursive: true, force: true });
  const piSays = async (done: Awaited<ReturnType<typeof box.turn>>) => {
    const owed = (await box.view()).switches!.kit!.tools['pi-cli']!;
    return { report: done.done.filter(step => step.tool === 'pi-cli').map(step => `${step.report.outcome}: ${step.report.message}`), box: owed.act ? 'empty, a tick acts' : `off: ${owed.held}` };
  };
  return { ...box, piSays };
}
/** The run's report leads with this; the page says the reasons alone, under Pi's box. */
const LEAD = 'Nothing of kit is on in Pi.';
const OWN = 'notes: Pi has a skill of its own by that name, never written over; turn it on in Pi on its row to put the plugin’s there, keeping Pi’s as a version.';
const KEPT = 'notes is kept out of Pi: tick to let it in, unless Pi has its own by that name.';
/** His own notes in the Library, the plugin's of other content: kept, said as a state (pluginstatus.ts notInWhy `yours`, yourSaid). */
const KEEPS_NOTES = 'notes: you keep your own skill by that name, not the plugin’s.';

test('Pi has a skill of its own named as the plugin’s: never written over; the report and its box, off, name it and the way', async () => {
  const box = await notesOnly();
  try {
    await put(box.pi('skills/notes/SKILL.md'), skill('notes', 'mine'));
    assert.deepEqual(await box.piSays(await box.turn('on')), { report: [`held: ${LEAD} ${OWN}`], box: `off: ${OWN}` });
    assert.equal(await readFile(box.pi('skills/notes/SKILL.md'), 'utf8'), skill('notes', 'mine'));
  } finally { await box.cleanup(); }
});

test('Pi’s own copy gone since, the plugin Off and On again: kept out of Pi, said so, and a tick on Pi’s box lets it in', async () => {
  const box = await notesOnly();
  try {
    await put(box.pi('skills/notes/SKILL.md'), skill('notes', 'mine'));
    await box.turn('on');
    await rm(box.pi('skills/notes'), { recursive: true });
    await box.turn('off');
    assert.deepEqual(await box.piSays(await box.turn('on')), { report: [`held: ${LEAD} ${KEPT}`], box: 'empty, a tick acts' });
    assert.deepEqual((await box.view()).items!.kit!.notIn!['pi-cli']!.reasons, [KEPT], 'the page says it under Pi’s box');
    assert.deepEqual((await box.piSays(await box.turn('let-in', 'pi-cli'))).report, ['installed: 1 of its 1 items is on in Pi.']);
  } finally { await box.cleanup(); }
});

test('His own skill of that name already in Central Knot: the plugin’s isn’t brought in; Its items lists it, and the report and its box, off, say he keeps his', async () => {
  const box = await notesOnly();
  try {
    await put(box.pi('skills/notes/SKILL.md'), skill('notes', 'mine'));
    await applySkills(box.share, box.tools, [{ key: 'notes', on: true, except: [] }]);
    assert.deepEqual(await box.piSays(await box.turn('on')), { report: [`held: ${LEAD} ${KEEPS_NOTES}`], box: `off: ${KEEPS_NOTES}` });
    assert.deepEqual(await box.lines(), { 'skill:notes': 'not-brought' });
  } finally { await box.cleanup(); }
});

test('A plugin with no skill, agent or MCP server: nothing of it goes into Pi, and its page says what it brings stays with the tools that take plugins', async () => {
  const box = await notesOnly();
  try {
    await rm(join(box.kit, 'skills'), { recursive: true });
    await put(join(box.kit, 'commands/ship.md'), '---\ndescription: Ship it.\n---\nShip.\n');
    const nothing = 'kit has no skill, agent or MCP server, which is all Pi takes of a plugin: what it brings (1 command) stays with the tools that take plugins.';
    assert.deepEqual(await box.piSays(await box.turn('on')), { report: [`held: ${nothing}`], box: `off: ${nothing}` });
  } finally { await box.cleanup(); }
});

test('Each reason said once for the names it holds, a long list cut, the reasons of a mix in turn', () => {
  const names = (out: Parameters<typeof notInWhy>[2][number]['out'], kind: 'skill' | 'mcp', ...list: string[]) => list.map(name => ({ name, kind, out }));
  assert.deepEqual(notInWhy('opencode-cli', 'kit', [...names('another', 'skill', 'notes'), ...names({ cannot: 'OpenCode can’t hold an SSE server.' }, 'mcp', 'relay'), ...names('own', 'skill', 'a', 'b', 'c', 'd', 'e'), ...names('deleted', 'skill', 'charts', 'sheets')]), [
    'notes: another source has a skill by that name here; delete it on its row to take the plugin’s.',
    'relay: OpenCode can’t hold an SSE server.',
    'a, b, c and 2 more: OpenCode has skills of its own by that name, never written over; turn each on in OpenCode on its row to put the plugin’s there, keeping OpenCode’s as a version.',
    'charts and sheets were deleted here: tick to bring them back.']);
  assert.deepEqual(notInWhy('pi-cli', 'kit', names({ cannot: 'Its SKILL.md isn’t valid.' }, 'skill', 'broken')), ['broken: Its SKILL.md isn’t valid.']);
});

// ---------- A name he has: Use the plugin's (library.ts A PLUGIN, the take row; pluginlibrary.ts ItemsAsk `take`) ----------

/**
 * His case: kit holds the MCP server maps alone (`same`: of the same content as his, else other), and his own maps, found in
 * Claude Code and Added, is On in Claude Code, Pi and OpenCode. `take`: Use the plugin's for one name under one tool's box.
 * `toolFiles`: every file those tools keep his items in, as an Undo must leave them.
 */
async function mapsHome(same = false, kitMaps: object = { command: 'npx', args: [same ? 'maps' : 'maps-of-kit'] }) {
  const box = await kitHome({ tools: ['claude-cli', 'pi-cli', 'opencode-cli'] });
  await mkdir(join(box.home, '.config/opencode'), { recursive: true });
  for (const path of ['skills', 'extra', 'agents']) await rm(join(box.kit, path), { recursive: true, force: true });
  await put(join(box.kit, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit' }));
  await put(join(box.kit, '.mcp.json'), JSON.stringify({ mcpServers: { maps: kitMaps } }));
  await put(join(box.home, '.claude.json'), `${JSON.stringify({ mcpServers: { maps: { command: 'npx', args: ['maps'] } } }, null, 2)}\n`);
  await applyServers(box.share, box.tools, [{ key: 'maps', on: true, except: [] }]);
  const take = (kind: ItemKind, key: string, tool: HarnessId = 'pi-cli') => box.markets.take(box.root, 'kit', { kind, key }, tool, box.home);
  const toolFiles = async (): Promise<Record<string, string>> => ({ claude: await readFile(join(box.home, '.claude.json'), 'utf8'),
    ...Object.fromEntries(Object.entries(await files(box.pi(''))).map(([path, text]) => [`pi/${path}`, text])),
    ...Object.fromEntries(Object.entries(await files(join(box.home, '.config/opencode'))).map(([path, text]) => [`opencode/${path}`, text])) });
  const taken = async () => (await readHistory(box.share)).filter(event => event.cause === 'plugin-taken' && event.kind === 'edit');
  return { ...box, take, toolFiles, taken, maps: async () => (await box.library()).mcp.maps! };
}
const piMaps = (files: Record<string, string>) => JSON.parse(files['pi/mcp.json']!).mcpServers.maps;

test('His case: his server maps meets the plugin’s maps of other content in Pi; doing nothing keeps his, said as a state; Use the plugin’s puts the plugin’s in Pi alone and lets his copies elsewhere go; the header’s Undo gives every file back, his own again', async () => {
  const box = await mapsHome();
  try {
    const before = await box.toolFiles(), his = (await box.maps()).hash;
    const ticked = await box.turn('let-in', 'pi-cli');
    // Doing nothing: the plugin on, his maps untouched in every tool, the reason a state beside its action.
    assert.deepEqual([await box.toolFiles(), (await box.maps()).source, (await box.view()).items!.kit!.yours], [before, undefined, { 'pi-cli': [{ kind: 'mcp', key: 'maps', name: 'maps' }] }]);
    assert.deepEqual([(await box.view()).items!.kit!.on, (await box.view()).items!.kit!.of], [{ 'pi-cli': 0, 'opencode-cli': 0 }, 1], 'its items for Pi: maps, not on there');
    assert.deepEqual([ticked.done.map(step => step.report.message), (await box.view()).switches!.kit!.tools['pi-cli']!.held],
      [['Nothing of kit is on in Pi. maps: you keep your own MCP server by that name, not the plugin’s.'], 'maps: you keep your own MCP server by that name, not the plugin’s.']);
    const took = await box.take('mcp', 'maps');
    assert.deepEqual(took.done.map(step => `${step.tool} ${step.report.outcome}: ${step.report.message}`), ['pi-cli installed: 1 of its 1 items is on in Pi.']);
    const after = await box.toolFiles();
    assert.deepEqual([piMaps(after).args, after.claude, after['opencode/opencode.json']], [['maps-of-kit'], before.claude, before['opencode/opencode.json']],
      'Pi has the plugin’s entry; Claude Code and OpenCode keep his, untouched');
    const maps = await box.maps();
    assert.deepEqual([!!maps.source, maps.on, maps.except, Object.keys(maps.applied), maps.versions.some(version => version.hash === his)], [true, true, ['claude-cli', 'opencode-cli'], ['pi-cli'], true],
      'the plugin’s, linked; his version kept; kept out of the tools with his copy, which are theirs now');
    assert.deepEqual((await box.taken()).map(event => [event.previous, event.version, event.took, event.losers.map(loser => loser.tool)]), [[his, maps.hash, { on: true, except: [] }, ['pi-cli']]], 'one History entry');
    assert.deepEqual([(await box.view()).items!.kit!.yours, (await box.view()).items!.kit!.on['pi-cli']], [undefined, 1], 'no clash left to say; the plugin’s maps is on in Pi');
    await box.undo(took);
    assert.deepEqual(await box.toolFiles(), before, 'every file as before the click');
    const back = await box.maps();
    assert.deepEqual([back.source, back.on, back.except, back.hash], [undefined, true, [], his], 'his own again, On everywhere: not Off and still linked');
    assert.deepEqual([(await box.view()).switches!.kit!.tools['pi-cli']!.has, (await box.view()).items!.kit!.yours], ['none', { 'pi-cli': [{ kind: 'mcp', key: 'maps', name: 'maps' }] }], 'Pi’s box unticked, the clash said again');
  } finally { await box.cleanup(); }
});

test('Synchronize everything after Use the plugin’s: his copies in Claude Code and OpenCode are no found item (maps is in Central Knot), so nothing is taken in or written', async () => {
  const box = await mapsHome();
  try {
    const { setSyncEverything } = await import('../src/everything.ts');
    await box.turn('let-in', 'pi-cli');
    await box.take('mcp', 'maps');
    const before = [await box.toolFiles(), await box.maps()];
    assert.deepEqual(await setSyncEverything(box.share, true), {});
    await applyServers(box.share, box.tools, [], { background: true });
    assert.deepEqual([await box.toolFiles(), await box.maps()], before);
  } finally { await box.cleanup(); }
});

test('The plugin’s maps the same as his: nothing changes, no link, no write, no History; the box counts it on and says so with no action; Off and a later read leave it his; once the plugin’s differs, the clash and its action', async () => {
  const box = await mapsHome(true);
  try {
    const mine = async () => { const { source, hash, on, except, versions } = await box.maps(); return { source, hash, on, except, versions }; };
    const before = await box.toolFiles(), his = await mine();
    assert.deepEqual((await box.turn('let-in', 'pi-cli')).done.map(step => [step.report.outcome, step.report.message]), [['installed', '1 of its 1 items is on in Pi.']], 'the tick goes through: his counts on');
    await box.update();
    const items = (await box.view()).items!.kit!;
    assert.deepEqual([await box.toolFiles(), await mine(), await box.taken()], [before, his, []], 'his, as he had it, in every tool');
    assert.deepEqual([items.yours, items.on['pi-cli'], items.of, (await box.view()).switches!.kit!.tools['pi-cli']!.has], [{ 'pi-cli': [{ kind: 'mcp', key: 'maps', name: 'maps', same: true }] }, 1, 1, 'items']);
    const { yourSaid } = await import('../src/pluginstatus.ts');
    assert.equal(yourSaid(items.yours!['pi-cli']![0]!, 'pi-cli'), 'maps is the same as yours, so yours stays.');
    await box.turn('off');
    assert.deepEqual([await box.toolFiles(), await mine()], [before, his], 'the plugin’s Off removes nothing of his');
    await box.turn('on');
    await put(join(box.kit, '.mcp.json'), JSON.stringify({ mcpServers: { maps: { command: 'npx', args: ['maps', '--v2'] } } }));
    assert.deepEqual((await box.view()).items!.kit!.yours, { 'pi-cli': [{ kind: 'mcp', key: 'maps', name: 'maps' }] }, 'the plugin’s now differs: Use the plugin’s is offered');
  } finally { await box.cleanup(); }
});

test('A skill and an agent of his meet the plugin’s in Pi: each has its action; the plugin’s goes over his at the same path, Pi’s list as he had it; History’s Undo of each gives Pi his back, byte for byte', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.kit, 'skills/mapper/SKILL.md'), skill('mapper', 'of kit'));
    await put(join(box.kit, 'agents/cartographer.md'), '---\nname: cartographer\ndescription: Draws.\n---\nOf kit.\n');
    await put(join(box.home, '.claude/skills/mapper/SKILL.md'), skill('mapper', 'mine'));
    await put(join(box.home, '.claude/agents/cartographer.md'), '---\nname: cartographer\ndescription: Draws.\n---\nMine.\n');
    // Pi's settings with a pattern that keeps every skill out: the pass lets his in by name.
    await put(box.pi('settings.json'), `${JSON.stringify({ skills: ['!*'] }, null, 2)}\n`);
    await applySkills(box.share, box.tools, [{ key: 'mapper', on: true, except: [] }]);
    await applyAgents(box.share, box.tools, [{ key: 'cartographer', on: true, except: [] }]);
    await box.turn('let-in', 'pi-cli');
    const before = await box.toolFiles();
    assert.deepEqual((await box.view()).items!.kit!.yours!['pi-cli']!.map(clash => `${clash.kind} ${clash.name}`).sort(), ['agent cartographer', 'mcp maps', 'skill mapper']);
    await box.take('skill', 'mapper');
    await box.take('agent', 'cartographer');
    const after = await box.toolFiles(), changed = Object.keys(after).filter(path => after[path] !== before[path]).sort();
    assert.deepEqual(changed, ['pi/skills/cartographer.md', 'pi/skills/mapper/SKILL.md'], 'Pi’s two copies alone: its list, Claude Code and OpenCode as they were');
    assert.deepEqual([after['pi/skills/mapper/SKILL.md'], /Of kit/.test(after['pi/skills/cartographer.md']!)], [skill('mapper', 'of kit'), true]);
    const [skillTook, agentTook] = (await box.taken()).map(event => event.id);
    await restoreSkill(box.share, box.tools, skillTook!);
    await restoreAgent(box.share, box.tools, agentTook!);
    assert.deepEqual(await box.toolFiles(), before);
    assert.deepEqual([(await box.library()).skill.mapper!.source, (await box.library()).agent.cartographer!.source], [undefined, undefined]);
  } finally { await box.cleanup(); }
});

test('His skill kept out of Pi under Pi’s pattern: Use the plugin’s places a fresh copy and lets it in by name; its Undo takes the copy and exactly that entry out again', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.kit, 'skills/mapper/SKILL.md'), skill('mapper', 'of kit'));
    await put(join(box.home, '.claude/skills/mapper/SKILL.md'), skill('mapper', 'mine'));
    await put(box.pi('settings.json'), `${JSON.stringify({ skills: ['!*', '+skills/other/SKILL.md'] }, null, 2)}\n`);
    await applySkills(box.share, box.tools, [{ key: 'mapper', on: true, except: ['pi-cli'] }]);
    await box.turn('let-in', 'pi-cli');
    const before = await box.toolFiles();
    await box.take('skill', 'mapper');
    const after = await box.toolFiles();
    assert.deepEqual([after['pi/skills/mapper/SKILL.md'], JSON.parse(after['pi/settings.json']!).skills], [skill('mapper', 'of kit'), ['!*', '+skills/other/SKILL.md', '+skills/mapper/SKILL.md']]);
    await restoreSkill(box.share, box.tools, (await box.taken())[0]!.id);
    assert.deepEqual(await box.toolFiles(), before);
  } finally { await box.cleanup(); }
});

test('Three names of his at once: each has its action and its own way back; taking one back leaves the other two the plugin’s', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.kit, 'skills/mapper/SKILL.md'), skill('mapper', 'of kit'));
    await put(join(box.kit, 'skills/globe/SKILL.md'), skill('globe', 'of kit'));
    for (const name of ['mapper', 'globe']) await put(join(box.home, `.claude/skills/${name}/SKILL.md`), skill(name, 'mine'));
    await applySkills(box.share, box.tools, [{ key: 'mapper', on: true, except: [] }, { key: 'globe', on: true, except: [] }]);
    await box.turn('let-in', 'pi-cli');
    assert.equal((await box.view()).items!.kit!.yours!['pi-cli']!.length, 3);
    for (const [kind, key] of [['mcp', 'maps'], ['skill', 'mapper'], ['skill', 'globe']] as const) await box.take(kind, key);
    const entries = await box.taken();
    assert.deepEqual(entries.map(event => event.item), ['maps', 'mapper', 'globe']);
    await restoreSkill(box.share, box.tools, entries[1]!.id);
    const library = await box.library();
    assert.deepEqual([!!library.mcp.maps!.source, !!library.skill.mapper!.source, !!library.skill.globe!.source], [true, false, true]);
    assert.equal(await readFile(box.pi('skills/mapper/SKILL.md'), 'utf8'), skill('mapper', 'mine'));
    assert.deepEqual((await box.view()).items!.kit!.yours, { 'pi-cli': [{ kind: 'skill', key: 'mapper', name: 'mapper' }] });
  } finally { await box.cleanup(); }
});

test('Edited in Pi after Use the plugin’s: his own again, by the let-go, with the plugin’s version and his first both kept; History’s Undo then makes his first current everywhere, Pi’s edit kept too', async () => {
  const box = await mapsHome();
  try {
    const his = (await box.maps()).hash, before = await box.toolFiles();
    await box.turn('let-in', 'pi-cli');
    await box.take('mcp', 'maps');
    const plugins = (await box.maps()).hash;
    await put(box.pi('mcp.json'), `${JSON.stringify({ mcpServers: { maps: { command: 'npx', args: ['edited-in-pi'] } } }, null, 2)}\n`);
    await applyServers(box.share, box.tools, []);
    const edited = await box.maps();
    assert.deepEqual([edited.source, [his, plugins].every(hash => edited.versions.some(version => version.hash === hash)), edited.hash === plugins], [undefined, true, false]);
    const took = (await box.taken())[0]!;
    await restoreServer(box.share, box.tools, took.id);
    const back = await box.maps(), after = await box.toolFiles();
    assert.deepEqual([back.hash, back.except, back.versions.some(version => version.hash === edited.hash)], [his, [], true], 'his first current, in every tool again; Pi’s edit is a version');
    assert.deepEqual([piMaps(after), after.claude, after['opencode/opencode.json']], [piMaps(before), before.claude, before['opencode/opencode.json']]);
  } finally { await box.cleanup(); }
});

test('Undo after the plugin’s update: History offers Go back before this, which makes his current again, his own, in every tool; both of the plugin’s versions are kept', async () => {
  const box = await mapsHome();
  try {
    const his = (await box.maps()).hash, before = await box.toolFiles();
    await box.turn('let-in', 'pi-cli');
    await box.take('mcp', 'maps');
    const first = (await box.maps()).hash;
    await put(join(box.kit, '.mcp.json'), JSON.stringify({ mcpServers: { maps: { command: 'npx', args: ['maps-of-kit', '--v2'] } } }));
    await box.update();
    const updated = await box.maps();
    assert.deepEqual([!!updated.source, piMaps(await box.toolFiles()).args], [true, ['maps-of-kit', '--v2']]);
    const took = (await box.taken())[0]!, { libraryAction } = await import('../src/historyactions.ts');
    assert.equal(libraryAction(took, updated, { managed: box.tools, pending: [], linked: true })?.label, 'Go back before this');
    await restoreServer(box.share, box.tools, took.id);
    const back = await box.maps();
    assert.deepEqual([back.hash, back.source, back.except, [first, updated.hash].every(hash => back.versions.some(version => version.hash === hash))], [his, undefined, [], true]);
    assert.deepEqual(await box.toolFiles(), before);
  } finally { await box.cleanup(); }
});

test('Use the plugin’s, then the plugin Off, or Pi unticked: the plugin’s copy leaves Pi; Claude Code and OpenCode keep his, untouched', async () => {
  for (const what of ['off', 'keep-out'] as const) {
    const box = await mapsHome();
    try {
      const before = await box.toolFiles();
      await box.turn('let-in', 'pi-cli');
      await box.take('mcp', 'maps');
      await box.turn(what, what === 'off' ? undefined : 'pi-cli');
      const after = await box.toolFiles();
      assert.deepEqual([piMaps(after), after.claude, after['opencode/opencode.json']], [undefined, before.claude, before['opencode/opencode.json']], what);
    } finally { await box.cleanup(); }
  }
});

test('A skill he has in Pi and OpenCode only through the shared folder: no Use the plugin’s under either box, each saying so', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.kit, 'skills/mapper/SKILL.md'), skill('mapper', 'of kit'));
    await put(join(box.home, '.agents/skills/mapper/SKILL.md'), skill('mapper', 'mine'));
    await applySkills(box.share, box.tools, [{ key: 'mapper', on: true, except: [] }]);
    assert.deepEqual(Object.keys((await box.library()).skill.mapper!.throughShared ?? {}), ['pi-cli', 'opencode-cli'], 'Pi and OpenCode read his from the shared folder');
    await box.turn('let-in', 'pi-cli');
    await box.turn('let-in', 'opencode-cli');
    const clashes = (await box.view()).items!.kit!.yours!;
    assert.deepEqual([clashes['pi-cli']!, clashes['opencode-cli']!].map(names => names.find(name => name.key === 'mapper')?.held?.shared), [true, true]);
    const { yourSaid } = await import('../src/pluginstatus.ts');
    assert.equal(yourSaid(clashes['pi-cli']!.find(name => name.key === 'mapper')!, 'pi-cli'), 'mapper: Pi reads yours from the shared skills folder, which Central Knot never writes. Take it over on its Library row to use the plugin’s.');
  } finally { await box.cleanup(); }
});

test('A profile that named his maps before Use the plugin’s: its id is dormant while maps is the plugin’s, so a switch to it turns the plugin’s out of Pi, Claude Code and OpenCode keeping his; one naming the plugin’s maps turns it on in Pi; after the Undo his id is live again', async () => {
  const box = await mapsHome();
  try {
    const mine = (await saveProfile(box.share, { name: 'Mine', items: ['mcp:maps'] })).id!, plugins = (await saveProfile(box.share, { name: 'Plugin’s', items: ['plugin:mcp:kit@team/maps'] })).id!;
    const before = await box.toolFiles();
    await box.turn('let-in', 'pi-cli');
    const took = await box.take('mcp', 'maps');
    const side = { live: async () => pluginLive({ pluginItems: [], profiles: await readProfiles(box.home), skills: await skillsView(box.share, box.tools), mcp: await serversView(box.share, box.tools), agents: await agentsView(box.share, box.tools) } as unknown as HomeView), run: async () => [] };
    await switchProfile(box.share, box.tools, mine, side);
    let now = await box.toolFiles();
    assert.deepEqual([piMaps(now), now.claude, now['opencode/opencode.json'], (await box.maps()).on], [undefined, before.claude, before['opencode/opencode.json'], false], 'Mine leaves the plugin’s maps out: Off, so out of Pi');
    await switchProfile(box.share, box.tools, plugins, side);
    assert.deepEqual(piMaps(await box.toolFiles()).args, ['maps-of-kit'], 'the plugin’s maps by its own id');
    await box.undo(took);
    now = await box.toolFiles();
    assert.deepEqual([(await box.maps()).source, (await box.maps()).except, now], [undefined, [], before], 'the Undo gives his back as before the click, in every tool');
    await switchProfile(box.share, box.tools, mine, side);
    assert.deepEqual([(await box.maps()).on, await box.toolFiles()], [true, before], 'his id is live again: Mine has it on');
  } finally { await box.cleanup(); }
});

// ---------- A take is one item, in one tool, by one click (library.ts TAKE): the cases the break-it pass reached ----------

test('A tool not managed at the click that holds his copy: managed again, its copy stays his, untouched', async () => {
  const box = await mapsHome();
  try {
    const { chooseTools } = await import('../src/toolchoice.ts');
    const before = await box.toolFiles();
    await box.turn('let-in', 'pi-cli');
    await chooseTools(box.share, 'opencode-cli', false);
    box.tools.splice(box.tools.indexOf('opencode-cli'), 1);
    await box.take('mcp', 'maps');
    await chooseTools(box.share, 'opencode-cli', true);
    box.tools.push('opencode-cli');
    await applyServers(box.share, box.tools, []);
    assert.equal((await box.toolFiles())['opencode/opencode.json'], before['opencode/opencode.json']);
  } finally { await box.cleanup(); }
});

test('His maps changed in Claude Code to a form Pi and OpenCode can’t hold, so they keep the older one: the take in Pi leaves OpenCode’s as it is, and its Undo gives Pi back what it held', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.home, '.claude.json'), `${JSON.stringify({ mcpServers: { maps: { type: 'sse', url: 'https://example.invalid/sse' } } }, null, 2)}\n`);
    await applyServers(box.share, box.tools, []);
    const before = await box.toolFiles();
    await box.turn('let-in', 'pi-cli');
    await box.take('mcp', 'maps');
    const after = await box.toolFiles();
    assert.deepEqual([piMaps(after).args, after['opencode/opencode.json'], after.claude], [['maps-of-kit'], before['opencode/opencode.json'], before.claude]);
    await restoreServer(box.share, box.tools, (await box.taken())[0]!.id);
    assert.deepEqual(await box.toolFiles(), before);
  } finally { await box.cleanup(); }
});

test('A take that can’t land is not offered and changes nothing: the plugin’s server in a form Pi can’t hold, said in the action’s place; clicked anyway, refused with why', async () => {
  const box = await mapsHome(false, { type: 'sse', url: 'https://example.invalid/sse' });
  try {
    await box.turn('let-in', 'pi-cli');
    const before = await box.toolFiles(), his = await box.maps(), yours = (await box.view()).items!.kit!.yours!['pi-cli']!;
    const { yourSaid } = await import('../src/pluginstatus.ts');
    assert.deepEqual(yours.map(name => yourSaid(name, 'pi-cli')), ['maps: you keep your own MCP server by that name, not the plugin’s. Pi has no SSE transport.']);
    const took = await box.take('mcp', 'maps');
    assert.deepEqual(took.done.map(step => [step.report.outcome, step.report.message]), [['held', 'maps: Pi has no SSE transport.']]);
    assert.deepEqual([await box.toolFiles(), await box.maps(), await box.taken()], [before, his, []]);
  } finally { await box.cleanup(); }
});

test('An agent of his that a skill of Pi’s holds out of Pi: no Use the plugin’s, the hold said; clicked anyway, nothing changes', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.kit, 'agents/cartographer.md'), '---\nname: cartographer\ndescription: Draws.\n---\nOf kit.\n');
    await put(join(box.home, '.claude/agents/cartographer.md'), '---\nname: cartographer\ndescription: Draws.\n---\nMine.\n');
    await put(box.pi('skills/cartographer/SKILL.md'), skill('cartographer', 'a skill of his in Pi'));
    await applyAgents(box.share, box.tools, [{ key: 'cartographer', on: true, except: [] }]);
    await box.turn('let-in', 'pi-cli');
    const before = await box.toolFiles(), name = (await box.view()).items!.kit!.yours!['pi-cli']!.find(each => each.key === 'cartographer')!;
    assert.ok(name.held && !name.held.shared, 'held, with the hold’s reason');
    const took = await box.take('agent', 'cartographer');
    assert.deepEqual([took.done[0]!.report.outcome, await box.toolFiles(), (await box.library()).agent.cartographer!.source], ['held', before, undefined]);
  } finally { await box.cleanup(); }
});

test('A skill he has only through the shared folder and keeps out of Pi: no Use the plugin’s for Pi; clicked anyway, nothing changes', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.kit, 'skills/mapper/SKILL.md'), skill('mapper', 'of kit'));
    await put(join(box.home, '.agents/skills/mapper/SKILL.md'), skill('mapper', 'mine'));
    await applySkills(box.share, box.tools, [{ key: 'mapper', on: true, except: ['pi-cli'] }]);
    await box.turn('let-in', 'pi-cli');
    const before = await box.toolFiles(), name = (await box.view()).items!.kit!.yours!['pi-cli']!.find(each => each.key === 'mapper')!;
    assert.equal(name.held?.shared, true);
    const took = await box.take('skill', 'mapper');
    assert.deepEqual([took.done[0]!.report.outcome, await box.toolFiles(), (await box.library()).skill.mapper!.source], ['held', before, undefined]);
  } finally { await box.cleanup(); }
});

test('Pi’s own copy written over by the take, then the plugin Off: History’s Undo gives Pi its own copy back', async () => {
  const box = await mapsHome();
  try {
    await applyServers(box.share, box.tools, [{ key: 'maps', on: true, except: ['pi-cli'] }]);
    await put(box.pi('mcp.json'), `${JSON.stringify({ mcpServers: { maps: { command: 'npx', args: ['pi-independent'] } } }, null, 2)}\n`);
    const before = await box.toolFiles();
    await box.turn('let-in', 'pi-cli');
    await box.take('mcp', 'maps');
    await box.turn('off');
    await restoreServer(box.share, box.tools, (await box.taken())[0]!.id);
    // His entry back, written in Pi's form (a give-back writes the version, as Pi's own: librarypass.ts giveBackCopy).
    const after = await box.toolFiles();
    assert.deepEqual([{ ...after, 'pi/mcp.json': '' }, piMaps(after)], [{ ...before, 'pi/mcp.json': '' }, { type: 'stdio', ...piMaps(before) }]);
  } finally { await box.cleanup(); }
});

test('The click brings in its item alone: another item’s update waits for Update, and the header’s Undo leaves Pi as before the click; the box counts 1 of its 2 items on in Pi', async () => {
  const box = await mapsHome();
  try {
    await put(join(box.kit, 'skills/globe/SKILL.md'), skill('globe', 'v1'));
    await box.turn('let-in', 'pi-cli');
    await put(join(box.kit, 'skills/globe/SKILL.md'), skill('globe', 'v2'));
    const before = await box.toolFiles(), took = await box.take('mcp', 'maps');
    assert.equal(await readFile(box.pi('skills/globe/SKILL.md'), 'utf8'), skill('globe', 'v1'));
    await box.undo(took);
    const { itemsAllIn, itemsOnWords } = await import('../src/pluginstatus.ts'), view = await box.view();
    assert.deepEqual([await box.toolFiles(), itemsOnWords(view, 'kit', 'pi-cli', ' in Pi'), itemsAllIn(view, 'kit', 'pi-cli')], [before, '1 of its 2 items is on in Pi', false], 'a part tick');
  } finally { await box.cleanup(); }
});
