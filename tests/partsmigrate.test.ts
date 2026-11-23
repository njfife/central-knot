// Plugin parts from before the library becoming items linked to their plugin (partsmigrate.ts), one worked example per row of its
// header's table, on real files in a temp home with Pi and OpenCode. Each home is written as alpha 1's engine left one: plugin-parts.json,
// each part's content kept in the store, the copies in the tools, and the plugins record its first read made. The same over a
// whole home alpha 1 made is tests/upgrade.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { agentKind, applyAgents } from '../src/agents.ts';
import { pluginFiles } from '../src/catalogdetail.ts';
import { setSyncEverything } from '../src/everything.ts';
import { readHistory } from '../src/history.ts';
import { itemKey, type ItemKind, type LibraryItem } from '../src/library.ts';
import { serverHash } from '../src/mcp.ts';
import { hideParts, migrateParts, type PartItem } from '../src/partsmigrate.ts';
import { readPlugin } from '../src/pluginlibrary.ts';
import { readPluginRecord, savePluginRecord, type PluginEntry } from '../src/pluginrecord.ts';
import { NO_PLUGINS, readLibraries, saveProfile, switchProfile } from '../src/profiles.ts';
import { inUse, liveItems } from '../src/profileplan.ts';
import { applyServers, serverKind } from '../src/servers.ts';
import { copyTree, exists, libraryGate, readTree, storeFolder, type ShareContext } from '../src/share.ts';
import { applySkills, skillKind } from '../src/skills.ts';
import type { HarnessId } from '../src/types.ts';

const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const skill = (name: string, body = `Use ${name}.`) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const ROOTS: Record<HarnessId, string> = { 'pi-cli': '.pi/agent', 'opencode-cli': '.config/opencode', 'claude-cli': '.claude', 'copilot-cli': '.copilot', 'codex-cli': '.codex', 'antigravity-cli': '.gemini/config' };

/** A part on the record, as alpha 1 wrote it. */
type Part = { tool: HarnessId; plugin?: string; version?: string; at?: string; item: PartItem };

/**
 * A home with Pi and OpenCode (and `tools`), a sync record, and the plugin kit recorded On by the plugins record's first read.
 * `skills` folder identities on record for Pi and OpenCode where `identity` (a skills pass ran there before).
 */
async function partsHome(options: { tools?: HarnessId[]; identity?: boolean } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-parts-'))), home = join(base, 'home');
  const managed: HarnessId[] = options.tools ?? ['pi-cli', 'opencode-cli'];
  for (const tool of managed) await mkdir(join(home, ROOTS[tool], 'skills'), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  await libraryGate(context, { start: true });
  if (options.identity) await applySkills(context, managed, []);
  const entries: PluginEntry[] = [{ id: 'kit-id', source: join(base, 'market'), marketName: 'team', plugin: 'kit', on: true, except: [] }];
  const at = (tool: HarnessId, path: string) => join(home, ROOTS[tool], path);
  return {
    base, home, context, managed, entries, at,
    cleanup: () => rm(base, { recursive: true, force: true }),
    /** A skill's content kept as alpha 1 kept it, in the Skills store of its time: its hash. */
    keep: async (name: string, body?: string) => {
      const folder = join(base, 'keep', sha(`${name}${body}`), name);
      await put(join(folder, 'SKILL.md'), skill(name, body));
      const tree = await readTree(folder), kept = join(home, '.central-knot/items', storeFolder(itemKey(name)), tree.hash);
      if (!(await exists(kept))) { await mkdir(dirname(kept), { recursive: true }); await copyTree(folder, kept, tree); }
      return tree.hash;
    },
    copy: (tool: HarnessId, name: string, body?: string) => put(at(tool, `skills/${name}/SKILL.md`), skill(name, body)),
    /** plugin-parts.json with these parts (one install per plugin and tool, in this order), and plugins.json with `entries`. */
    record: async (parts: Part[]) => {
      const installs: object[] = [];
      for (const { tool, plugin = 'kit', version = '1.0.0', at: when = '2026-11-01T00:00:00.000Z', item } of parts) {
        const install = installs.find(each => (each as { tool: string; plugin: string }).tool === tool && (each as { plugin: string }).plugin === plugin) as { items: PartItem[] } | undefined;
        if (install) install.items.push(item);
        else installs.push({ source: join(base, 'market'), marketName: 'team', plugin, version, tool, at: when, digest: 'd', items: [item] });
      }
      await put(join(home, '.central-knot/plugin-parts.json'), `${JSON.stringify({ installs }, null, 2)}\n`);
      await savePluginRecord(home, { tools: managed, plugins: entries });
    },
    /** The migration as homepass.ts runs it; with `plugin`, the plugin kit's folder read as its marketplace's copy. */
    migrate: (plugin?: string) => migrateParts(context, managed, [skillKind, agentKind, serverKind],
      plugin ? async entry => ({ reads: await readPlugin(await pluginFiles(plugin, {}, join(base, 'market')), entry, '', new Set(), []), commitAt: '' }) : undefined),
    library: async (kind: ItemKind = 'skill'): Promise<Record<string, LibraryItem>> => (await ({ skill: skillKind, mcp: serverKind, agent: agentKind })[kind].open(context)).library.items,
    /** The pass of the whole home, every kind, as homepass.ts runs it with Sync on. */
    pass: async () => { for (const apply of [applySkills, applyServers, applyAgents]) await apply(context, managed, [], { background: true }); },
  };
}
type Box = Awaited<ReturnType<typeof partsHome>>;
const part = (name: string, hash: string, more: Partial<PartItem> = {}): PartItem => ({ kind: 'skill', name, hash, seen: 'written', ...more });
/** Every file under the home, by its path, with a stamp that changes whenever it is written. */
async function stamps(box: Box, under = ''): Promise<Record<string, string>> {
  const { readdir } = await import('node:fs/promises');
  const found: Record<string, string> = {};
  for (const entry of await readdir(join(box.home, under), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name), info = await stat(path);
    found[path.slice(box.home.length + 1)] = `${info.ino}:${info.mtimeMs}:${sha(await readFile(path, 'utf8'))}`;
  }
  return found;
}
const toolFiles = async (box: Box) => Object.fromEntries(Object.entries(await stamps(box)).filter(([path]) => !path.startsWith('.central-knot')));

test('An unedited part in Pi and OpenCode: one item linked to its plugin, applied in both, at its content; nothing is written, then or by two passes', async () => {
  const box = await partsHome();
  try {
    const hash = await box.keep('pdf');
    await box.copy('pi-cli', 'pdf'); await box.copy('opencode-cli', 'pdf');
    await box.record([{ tool: 'pi-cli', item: part('pdf', hash) }, { tool: 'opencode-cli', item: part('pdf', hash) }]);
    const before = await toolFiles(box);
    assert.deepEqual(await box.migrate(), {});
    const pdf = (await box.library()).pdf;
    assert.deepEqual([pdf.on, pdf.source, pdf.seen, pdf.hash, pdf.except, pdf.applied], [true, 'kit-id', hash, hash, [], { 'pi-cli': hash, 'opencode-cli': hash }]);
    assert.deepEqual(pdf.versions.map(version => version.from), [{ how: 'source', link: 'plugin:kit@team' }]);
    await setSyncEverything(box.context, true);
    const told = await readHistory(box.context);
    await box.pass(); await box.pass();
    assert.deepEqual([await toolFiles(box), await readHistory(box.context)], [before, told]);
  } finally { await box.cleanup(); }
});

test('A skill only Pi had keeps OpenCode out, and an OpenCode agent keeps Pi out: nothing goes where the part never was', async () => {
  const box = await partsHome();
  try {
    await box.copy('pi-cli', 'pdf');
    const agent = '---\ndescription: Writes.\nmode: all\n---\n\nWrite.\n';
    await put(box.at('opencode-cli', 'agents/writer.md'), agent);
    await put(join(box.home, '.central-knot/items/plugin-parts/agent', `${sha(agent)}.txt`), agent);
    await box.record([{ tool: 'pi-cli', item: part('pdf', await box.keep('pdf')) }, { tool: 'opencode-cli', item: { kind: 'agent', name: 'writer', hash: sha(agent), seen: sha(agent) } }]);
    await box.migrate();
    const [pdf, writer] = [(await box.library()).pdf, (await box.library('agent')).writer];
    assert.deepEqual([pdf.except, Object.keys(pdf.applied), writer.except, Object.keys(writer.applied), writer.own['opencode-cli'] !== undefined], [['opencode-cli'], ['pi-cli'], ['pi-cli'], ['opencode-cli'], true]);
    const before = await toolFiles(box);
    await box.pass();
    assert.deepEqual(await toolFiles(box), before);
  } finally { await box.cleanup(); }
});

test('A tool the plugin is kept out of, neither managed nor on the record, is kept out of its items, so it gets none when it appears', async () => {
  const box = await partsHome({ tools: ['pi-cli'] });
  try {
    box.entries[0].except = ['opencode-cli'];
    await box.copy('pi-cli', 'pdf');
    await box.record([{ tool: 'pi-cli', item: part('pdf', await box.keep('pdf')) }]);
    await box.migrate();
    assert.deepEqual((await box.library()).pdf.except, ['opencode-cli']);
  } finally { await box.cleanup(); }
});

test('Two versions: the one the plugin’s files hold now is current, else the higher version on record, never the later time; the other is kept, and brought up at the pass', async () => {
  for (const files of [true, false]) {
    const box = await partsHome();
    try {
      const [one, two] = [await box.keep('sheet', 'Version one.'), await box.keep('sheet', 'Version two.')];
      await box.copy('pi-cli', 'sheet', 'Version two.'); await box.copy('opencode-cli', 'sheet', 'Version one.');
      // OpenCode's later time is a single-part pick's, which kept its version on record.
      await box.record([{ tool: 'pi-cli', version: files ? '1.0.0' : '2.0.0', at: '2026-11-01T00:00:00.000Z', item: part('sheet', two) },
        { tool: 'opencode-cli', version: '1.0.0', at: '2026-11-09T00:00:00.000Z', item: part('sheet', one) }]);
      const plugin = join(box.base, 'market/plugins/kit');
      await put(join(plugin, 'skills/sheet/SKILL.md'), skill('sheet', 'Version two.'));
      await box.migrate(files ? plugin : undefined);
      const sheet = (await box.library()).sheet;
      assert.deepEqual([sheet.hash, sheet.versions.map(version => version.hash), sheet.applied], [two, [two, one], { 'pi-cli': two, 'opencode-cli': one }], files ? 'by the plugin’s files' : 'by the version');
      await box.pass();
      assert.equal(await readFile(box.at('opencode-cli', 'skills/sheet/SKILL.md'), 'utf8'), skill('sheet', 'Version two.'));
    } finally { await box.cleanup(); }
  }
});

test('Edited where the skills record knows that tool’s folder: let go once, his own, and with Sync on his edit reaches OpenCode’s unedited copy', async () => {
  const box = await partsHome({ identity: true });
  try {
    const hash = await box.keep('pdf');
    await box.copy('pi-cli', 'pdf', 'Mine now.'); await box.copy('opencode-cli', 'pdf');
    await box.record([{ tool: 'pi-cli', item: part('pdf', hash) }, { tool: 'opencode-cli', item: part('pdf', hash) }]);
    await box.migrate();
    assert.deepEqual((await box.library()).pdf.applied, { 'pi-cli': hash, 'opencode-cli': hash });
    await box.pass(); await box.pass();
    const pdf = (await box.library()).pdf;
    assert.deepEqual([pdf.source, pdf.on, (await readHistory(box.context)).map(entry => entry.cause ?? entry.kind)], [undefined, true, ['own-now', 'edit']]);
    assert.equal(await readFile(box.at('opencode-cli', 'skills/pdf/SKILL.md'), 'utf8'), skill('pdf', 'Mine now.'));
  } finally { await box.cleanup(); }
});

test('Edited where the record holds no folder identity for that tool: kept out there, the edit left as that tool’s own, nothing let go or written', async () => {
  const box = await partsHome();
  try {
    const hash = await box.keep('pdf');
    await box.copy('pi-cli', 'pdf', 'Mine now.'); await box.copy('opencode-cli', 'pdf');
    await box.record([{ tool: 'pi-cli', item: part('pdf', hash) }, { tool: 'opencode-cli', item: part('pdf', hash) }]);
    await box.migrate();
    const before = await toolFiles(box);
    await box.pass(); await box.pass();
    const pdf = (await box.library()).pdf;
    assert.deepEqual([pdf.source, pdf.except, pdf.applied, await readHistory(box.context)], ['kit-id', ['pi-cli'], { 'opencode-cli': hash }, []]);
    assert.deepEqual(await toolFiles(box), before);
  } finally { await box.cleanup(); }
});

test('Left out by him, or deleted by hand: kept out there and applied nowhere; the item stays On and the other tool’s copy stays; removed everywhere, still an item', async () => {
  const box = await partsHome();
  try {
    const [forms, review, gone] = [await box.keep('forms'), await box.keep('review'), await box.keep('gone')];
    await box.copy('pi-cli', 'forms'); await box.copy('opencode-cli', 'review');
    await box.record([{ tool: 'pi-cli', item: part('forms', forms) }, { tool: 'opencode-cli', item: part('forms', forms, { removed: true, seen: undefined }) },
      { tool: 'pi-cli', item: part('review', review) }, { tool: 'opencode-cli', item: part('review', review) },
      { tool: 'pi-cli', item: part('gone', gone, { removed: true, seen: undefined }) }, { tool: 'opencode-cli', item: part('gone', gone, { removed: true, seen: undefined }) }]);
    await box.migrate();
    const before = await toolFiles(box);
    await box.pass(); await box.pass();
    const items = await box.library();
    assert.deepEqual(['forms', 'review', 'gone'].map(key => [key, items[key].on, items[key].except, Object.keys(items[key].applied)]),
      [['forms', true, ['opencode-cli'], ['pi-cli']], ['review', true, ['pi-cli'], ['opencode-cli']], ['gone', true, ['pi-cli', 'opencode-cli'], []]]);
    assert.deepEqual(await toolFiles(box), before);
  } finally { await box.cleanup(); }
});

test('Left out on a first pick, never written or kept: its content from the plugin’s files now; with those unreadable, no item (the known miss), and a deleted one stays deleted', async () => {
  for (const readable of [true, false]) {
    const box = await partsHome();
    try {
      const plugin = join(box.base, 'market/plugins/kit');
      await put(join(plugin, 'skills/two/SKILL.md'), skill('two'));
      await box.copy('pi-cli', 'old');
      await applySkills(box.context, box.managed, [{ key: 'old', on: true, except: [] }]);
      await applySkills(box.context, box.managed, [{ key: 'old', on: true, except: [], deleted: true }]);
      await box.record([{ tool: 'pi-cli', item: part('two', 'never-kept', { removed: true, seen: undefined }) }, { tool: 'pi-cli', item: part('old', 'never-kept', { removed: true, seen: undefined }) }]);
      await box.migrate(readable ? plugin : undefined);
      const { two, old } = await box.library();
      assert.deepEqual(two && [two.source, two.except, two.applied], readable ? ['kit-id', ['pi-cli', 'opencode-cli'], {}] : undefined);
      if (!readable) assert.ok(old.deleted, 'a deleted item of a name with no content anywhere stays deleted');
    } finally { await box.cleanup(); }
  }
});

test('Claimed by a run that stopped: with a copy, a part like any other; with none, neither applied nor kept out, so the pass writes it as the next run would have', async () => {
  const box = await partsHome();
  try {
    const hash = await box.keep('memo');
    await box.copy('pi-cli', 'memo');
    await box.record([{ tool: 'pi-cli', item: part('memo', hash, { seen: undefined }) }, { tool: 'opencode-cli', item: part('memo', hash, { seen: undefined }) }]);
    await box.migrate();
    assert.deepEqual([(await box.library()).memo.applied, (await box.library()).memo.except], [{ 'pi-cli': hash }, []]);
    await box.pass();
    assert.equal(await readFile(box.at('opencode-cli', 'skills/memo/SKILL.md'), 'utf8'), skill('memo'));
  } finally { await box.cleanup(); }
});

test('A name the library has a live item of stays his; a deleted one is made over, keeping its versions; one name from two plugins goes to the first on record', async () => {
  const box = await partsHome();
  try {
    box.entries.push({ id: 'other-id', source: join(box.base, 'market'), marketName: 'team', plugin: 'other', on: true, except: [] });
    const [mine, old, pdf] = [await box.keep('mine'), await box.keep('old'), await box.keep('pdf')];
    for (const name of ['mine', 'old']) await box.copy('pi-cli', name);
    await box.copy('pi-cli', 'pdf'); await box.copy('opencode-cli', 'pdf', 'The other plugin’s.');
    await applySkills(box.context, box.managed, [{ key: 'mine', on: true, except: [] }, { key: 'old', on: true, except: [] }]);
    await applySkills(box.context, box.managed, [{ key: 'old', on: true, except: [], deleted: true }]);
    await box.copy('pi-cli', 'old');
    await box.record([{ tool: 'pi-cli', item: part('mine', mine) }, { tool: 'pi-cli', item: part('old', old) }, { tool: 'pi-cli', item: part('pdf', pdf) },
      { tool: 'opencode-cli', plugin: 'other', item: part('pdf', await box.keep('pdf', 'The other plugin’s.')) }]);
    const was = (await box.library()).old.versions.length;
    await box.migrate();
    const items = await box.library();
    assert.deepEqual([items.mine.source, items.old.source, items.old.deleted, items.old.versions.length > was, items.pdf.source, items.pdf.except], [undefined, 'kit-id', undefined, true, 'kit-id', ['opencode-cli']]);
  } finally { await box.cleanup(); }
});

test('A plugin Off makes its items Off; one with no entry (its parts only in a tool not managed) gets the first read’s entry, saved before any item names it, and that tool is decided as the record knew it', async () => {
  const box = await partsHome({ tools: ['pi-cli'] });
  try {
    box.entries[0].on = false;
    await mkdir(box.at('opencode-cli', 'skills'), { recursive: true });
    const [pdf, lone] = [await box.keep('pdf'), await box.keep('lone')];
    await box.copy('pi-cli', 'pdf'); await box.copy('opencode-cli', 'lone');
    await box.record([{ tool: 'pi-cli', item: part('pdf', pdf) }, { tool: 'opencode-cli', plugin: 'lone-kit', item: part('lone', lone) }, { tool: 'codex-cli', plugin: 'lone-kit', item: part('lone', lone) }]);
    // Stopped once its skills are saved: the next run finds the same entry, so its items stay linked to it.
    box.context.fault = step => { if (step === 'parts-kind-saved') throw new Error('crash'); };
    await assert.rejects(box.migrate(), /crash/);
    delete box.context.fault;
    await box.migrate();
    const items = await box.library(), made = (await readPluginRecord(box.home)).record!.plugins.filter(entry => entry.plugin === 'lone-kit');
    // OpenCode, not managed, is decided as the record knew it: lone's copy there is applied, so managing OpenCode again changes nothing.
    // Codex holds only a part's loose copy: it hasn't the plugin, so the entry keeps it out (no install is owed there beside it).
    assert.deepEqual([items.pdf.on, made.length, made[0].on, made[0].except, items.lone.source, items.lone.except, items.lone.applied],
      [false, 1, true, ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'antigravity-cli'], made[0].id, ['pi-cli', 'antigravity-cli'], { 'opencode-cli': lone }]);
  } finally { await box.cleanup(); }
});

test('A server alpha 1 kept with `args: []`, and parts in a tool with its own installer: the server stays linked, the other tool’s part is its own', async () => {
  const box = await partsHome({ tools: ['pi-cli', 'opencode-cli', 'codex-cli'] });
  try {
    const kept = { transport: 'stdio', command: 'lookup-mcp', args: [] }, hash = serverHash(kept as never);
    await put(join(box.home, `.central-knot/items/mcp/lookup/${hash}.json`), JSON.stringify(kept));
    await put(box.at('pi-cli', 'mcp.json'), JSON.stringify({ mcpServers: { lookup: { command: 'lookup-mcp', args: [] } } }));
    await box.copy('codex-cli', 'pdf');
    await box.record([{ tool: 'pi-cli', item: { kind: 'mcp', name: 'lookup', hash, seen: 'alpha' } }, { tool: 'codex-cli', item: part('pdf', await box.keep('pdf')) }]);
    await box.migrate();
    const [lookup, pdf] = [(await box.library('mcp')).lookup, (await box.library()).pdf];
    const read = serverHash({ transport: 'stdio', command: 'lookup-mcp' });
    assert.deepEqual([lookup.hash, lookup.applied, lookup.except, pdf.except, pdf.applied], [read, { 'pi-cli': read }, ['opencode-cli'], ['codex-cli', 'pi-cli', 'opencode-cli'], {}]);
  } finally { await box.cleanup(); }
});

test('Nothing kept: an unedited skill tells by its recorded hash; a server can’t tell, so its copy is his own item, kept out of every other tool', async () => {
  const box = await partsHome();
  try {
    await box.copy('pi-cli', 'pdf');
    const tree = (await readTree(box.at('pi-cli', 'skills/pdf'))).hash;
    await put(box.at('pi-cli', 'mcp.json'), JSON.stringify({ mcpServers: { lookup: { command: 'lookup-mcp' } } }));
    await box.record([{ tool: 'pi-cli', item: part('pdf', tree) }, { tool: 'pi-cli', item: { kind: 'mcp', name: 'lookup', hash: 'not-kept', seen: 'x' } }]);
    await box.migrate();
    const [pdf, lookup] = [(await box.library()).pdf, (await box.library('mcp')).lookup];
    assert.deepEqual([pdf.source, pdf.applied, lookup.source, lookup.on, lookup.except, Object.keys(lookup.applied)], ['kit-id', { 'pi-cli': tree }, undefined, true, ['opencode-cli'], ['pi-cli']]);
  } finally { await box.cleanup(); }
});

test('It waits whole while a copy on record can’t be read, the record can’t, plugins.json isn’t made, or there is no sync record; then a run finishes it', async () => {
  const box = await partsHome();
  try {
    const hash = await box.keep('pdf');
    await box.record([{ tool: 'pi-cli', item: part('pdf', hash) }]);
    await mkdir(box.at('pi-cli', 'skills/pdf'), { recursive: true });
    await put(box.at('pi-cli', 'skills/pdf/SKILL.md'), '');
    const { chmod } = await import('node:fs/promises');
    await chmod(box.at('pi-cli', 'skills/pdf/SKILL.md'), 0);
    assert.ok((await box.migrate()).waits, 'a copy that can’t be read');
    await chmod(box.at('pi-cli', 'skills/pdf/SKILL.md'), 0o644);
    await box.copy('pi-cli', 'pdf');
    const text = await readFile(join(box.home, '.central-knot/plugin-parts.json'), 'utf8');
    await writeFile(join(box.home, '.central-knot/plugin-parts.json'), '{"installs":');
    assert.ok((await box.migrate()).waits, 'the record half written');
    await writeFile(join(box.home, '.central-knot/plugin-parts.json'), text);
    await rm(join(box.home, '.central-knot/plugins.json'));
    assert.ok((await box.migrate()).waits, 'no plugins.json');
    assert.deepEqual(Object.keys(await box.library()), [], 'nothing made while it waited');
    await savePluginRecord(box.home, { tools: box.managed, plugins: box.entries });
    assert.deepEqual(await box.migrate(), {});
    assert.equal((await box.library()).pdf.source, 'kit-id');
  } finally { await box.cleanup(); }
});

test('Stopped between kinds or before the rename: the next run finishes, nothing is made twice, and plugin-parts.v1.json is the old file, never one written over', async () => {
  for (const at of ['parts-kind-saved', 'parts-before-rename'] as const) {
    const box = await partsHome();
    try {
      const hash = await box.keep('pdf');
      await box.copy('pi-cli', 'pdf');
      await put(box.at('pi-cli', 'mcp.json'), JSON.stringify({ mcpServers: { lookup: { command: 'lookup-mcp' } } }));
      const server = serverHash({ transport: 'stdio', command: 'lookup-mcp' });
      await put(join(box.home, `.central-knot/items/plugin-parts/mcp/${server}.json`), JSON.stringify({ transport: 'stdio', command: 'lookup-mcp' }));
      await box.record([{ tool: 'pi-cli', item: part('pdf', hash) }, { tool: 'pi-cli', item: { kind: 'mcp', name: 'lookup', hash: server, seen: 'x' } }]);
      await put(join(box.home, '.central-knot/plugin-parts.v1.json'), 'a home migrated before');
      const old = await readFile(join(box.home, '.central-knot/plugin-parts.json'), 'utf8');
      box.context.fault = step => { if (step === at) throw new Error('crash'); };
      await assert.rejects(box.migrate(), /crash/);
      delete box.context.fault;
      const after = await stamps(box, '.central-knot');
      assert.deepEqual(await box.migrate(), {});
      const items = await box.library(), servers = await box.library('mcp');
      assert.deepEqual([items.pdf.versions.length, servers.lookup.source, await readFile(join(box.home, '.central-knot/plugin-parts.v1-2.json'), 'utf8'), await readFile(join(box.home, '.central-knot/plugin-parts.v1.json'), 'utf8')],
        [1, 'kit-id', old, 'a home migrated before'], at);
      if (at === 'parts-before-rename') assert.equal((await stamps(box, '.central-knot'))['.central-knot/skills.json'], after['.central-knot/skills.json'], 'a kind already moved is not written again');
    } finally { await box.cleanup(); }
  }
});

test('The guard: while the record is there, every copy of a part’s name is unseen in every managed tool, and one that can’t be read hides every copy', async () => {
  const unseen = new Map<string, string>(), box = await partsHome();
  try {
    await box.record([{ tool: 'pi-cli', item: part('pdf', 'h') }, { tool: 'pi-cli', item: part('out', 'h', { removed: true }) }]);
    await hideParts(box.home, 'skill', box.managed, unseen);
    assert.deepEqual([...unseen.keys()], ['pi-cli:pdf', 'opencode-cli:pdf'], 'not a removed part’s, nor another kind’s');
    // His own pdf in OpenCode with Synchronize everything on: not taken in during the wait.
    await box.copy('pi-cli', 'pdf'); await box.copy('opencode-cli', 'pdf', 'His own.');
    await setSyncEverything(box.context, true);
    await box.pass();
    assert.deepEqual(Object.keys(await box.library()), []);
    await writeFile(join(box.home, '.central-knot/plugin-parts.json'), 'half');
    const all = new Map<string, string>();
    await hideParts(box.home, 'mcp', box.managed, all);
    assert.deepEqual([...all.keys()], ['pi-cli:*', 'opencode-cli:*']);
  } finally { await box.cleanup(); }
});

test('An item linked to a plugin is outside profiles: a switch never turns it Off, and a profile in use before stays in use', async () => {
  const box = await partsHome();
  try {
    const hash = await box.keep('pdf');
    await box.copy('pi-cli', 'pdf'); await box.copy('pi-cli', 'notes');
    await applySkills(box.context, box.managed, [{ key: 'notes', on: true, except: [] }]);
    const made = await saveProfile(box.context, { name: 'Focus', items: ['skill:notes'] });
    await box.record([{ tool: 'pi-cli', item: part('pdf', hash) }]);
    await box.migrate();
    const read = await readLibraries(box.context);
    assert.ok('libraries' in read);
    assert.deepEqual(inUse([{ id: made.id!, name: 'Focus', items: ['skill:notes'], switchesPluginItems: true }], liveItems(read.libraries, read.plugins), []).map(profile => profile.name), ['Focus']);
    await switchProfile(box.context, box.managed, made.id!, NO_PLUGINS);
    assert.equal((await box.library()).pdf.on, true);
  } finally { await box.cleanup(); }
});
