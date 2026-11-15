// A plugin's items in Pi and OpenCode as library items linked to it (library.ts A PLUGIN, pluginlibrary.ts), as worked examples
// on real files in a temp home, through the Plugins page's own calls (marketplaces.ts) with the tools' installers stood in for,
// as tests/marketplaces.test.ts stands them in. The table's rows alone, on single letters, are in tests/library.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { agentKind } from '../src/agents.ts';
import { pluginFiles } from '../src/catalogdetail.ts';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import { readPlugin } from '../src/pluginlibrary.ts';
import { readHistory } from '../src/history.ts';
import * as engine from '../src/plugins.ts';
import { serverKind } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, skillKind } from '../src/skills.ts';
import type { HarnessId, PluginTurn } from '../src/types.ts';
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
    assert.deepEqual(read.map(each => [each.kind, each.whole, each.link, each.plugin]), [['skill', true, 'plugin:kit@team', { on: true, outOf: [] }], ['agent', true, 'plugin:kit@team', { on: true, outOf: [] }], ['mcp', true, 'plugin:kit@team', { on: true, outOf: [] }]], 'a left-out server holds back no drop');
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

test('On makes its items and turns them On in Pi; Keep out of Pi takes them out of Pi only; Off takes them out and keeps them; each Undo leaves every file as it was', async () => {
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
    // Keep out of Pi, and its Undo.
    const out = await box.turn('keep-out', 'pi-cli');
    assert.deepEqual(out.done.map(step => [step.tool, step.action, step.report.changed]), [['pi-cli', 'remove-items', true]]);
    assert.deepEqual([await exists(box.pi('skills/notes')), box.calls.filter(call => call.startsWith('uninstall'))], [false, []], 'Pi only');
    assert.deepEqual(Object.values((await box.library()).skill).map(item => [item.on, item.except]), [[true, ['pi-cli']], [true, ['pi-cli']], [true, ['pi-cli']]]);
    await box.undo(out);
    assert.deepEqual(await files(box.pi('')), onBytes, 'Keep out undone: every file as it was');
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
    assert.deepEqual((await box.lines())['skill:notes'], 'not-brought', 'Its items says the name is his');
    await box.turn('off');
    assert.deepEqual([(await box.library()).skill.notes!.on, await exists(box.pi('skills/notes/SKILL.md'))], [true, true], 'his own notes stays On, in Pi');
    // Let in on one tool changes its except alone, and still not where Pi has a copy of its own.
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

test('A new item the check brings is kept out of each tool the plugin isn’t in: Pi kept out, Pi taken out by Take out there; one item switched off by itself keeps it in; the background never turns an item On', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    await box.turn('keep-out', 'pi-cli');
    await put(join(box.kit, 'skills/fresh/SKILL.md'), skill('fresh'));
    await box.update();
    assert.deepEqual([(await box.library()).skill.fresh!.except, await exists(box.pi('skills/fresh'))], [['pi-cli'], false], 'kept out of Pi');
    await box.turn('let-in', 'pi-cli');
    // Every item kept out of Pi on its own row (as Take out there leaves them, the entry still wanting Pi): the plugin is not in Pi.
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

test('A plugin’s agent and server are held in Claude Code too: no agent file of Central Knot’s there, and the server never waits for Write to Claude Code', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    const { applyAgents } = await import('../src/agents.ts'), { applyServers } = await import('../src/servers.ts');
    await applyAgents(box.share, box.tools, []);
    const servers = await applyServers(box.share, box.tools, []);
    assert.deepEqual([await exists(join(box.home, '.claude/agents/helper.md')), servers.results.filter(result => result.waits).map(result => result.item)], [false, []]);
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
    assert.equal((await box.lines())['skill:review'], 'not-brought');
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

test('Every item switched off on its own row: Install there on Pi turns them on there', async () => {
  const box = await kitHome();
  try {
    await box.turn('on');
    const { applyAgents } = await import('../src/agents.ts'), { applyServers } = await import('../src/servers.ts');
    await applySkills(box.share, box.tools, ['notes', 'review', 'tools'].map(key => ({ key, on: false, except: [] })));
    await applyAgents(box.share, box.tools, [{ key: 'helper', on: false, except: [] }]);
    await applyServers(box.share, box.tools, [{ key: 'relay', on: false, except: [] }]);
    assert.equal((await box.view()).switches?.kit?.tools['pi-cli']?.act, 'install-items', 'its line offers Install there');
    const fix = await box.turn('fix', 'pi-cli');
    assert.deepEqual([fix.done.map(step => step.report.outcome), await exists(box.pi('skills/notes/SKILL.md'))], [['installed'], true]);
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
