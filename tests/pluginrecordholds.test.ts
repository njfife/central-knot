// A damaged, unreadable or newer plugins record (.central-knot/plugins.json) holds items linked to a plugin in every managed
// tool while personal items and items from a verified Git source keep syncing (sourcestore.ts pluginsRecordHold, librarypass.ts).
// Worked examples on real files in temp homes: spoiling plugins.json, personal and Git-source sync, Pi copies and Off states,
// recovery matching an undamaged twin home, first read with no plugins.json, profile switch, Pull and Push, and rule edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { agentKind, agentsView, applyAgents } from '../src/agents.ts';
import { discover } from '../src/discovery.ts';
import { connectRepo, pullRepo, pushRepo } from '../src/gitrepo.ts';
import { homePass } from '../src/homepass.ts';
import { joinCounts } from '../src/librarypass.ts';
import { hashesOf, libraryWords, sentences, statusLine } from '../src/libraryrow.ts';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import { readPluginRecord } from '../src/pluginrecord.ts';
import * as engine from '../src/plugins.ts';
import { NO_PLUGINS, saveProfile, switchProfile } from '../src/profiles.ts';
import { applyServers, serverKind, serversView } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, skillKind, skillsView } from '../src/skills.ts';
import { addSource, checkSource, previewSource, sourcesView } from '../src/sources.ts';
import { pluginsRecordHold, type Recorded } from '../src/sourcestore.ts';
import { newItem } from '../src/library.ts';
import type { HarnessId, PluginTurn } from '../src/types.ts';
import { repository, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

const ALL_FIVE: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const exists = (path: string) => stat(path).then(() => true, () => false);
const skill = (name: string, body = name) => `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`;
const agentMd = (name: string, body = 'Help.') => `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`;

const DAMAGED_REASON = 'The plugins record is damaged. Nothing was written or deleted. Put the record back, then try again. Its plugins’ items are held as they are until then. Sync takes them up again by itself once the record is back.';

/** Every file under `folder`, by relative path, with its bytes: for byte-for-byte "nothing changed" and twin-home checks. */
async function snapshotFiles(folder: string, exclude: string[] = []): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name), rel = relative(folder, full);
      if (exclude.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
      if (entry.isDirectory()) await walk(full);
      else found[rel] = await readFile(full, 'utf8');
    }
  };
  await walk(folder);
  return found;
}

/**
 * A home with all five tools, a local marketplace whose plugin `partial` brings one skill (`triage`), one agent (`reviewer`)
 * and one MCP server (`relay`), kept to Pi and OpenCode only (placed there as library items), plus a personal skill (`own-note`).
 */
async function partialHome(options: { gitSource?: boolean } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-record-holds-')));
  const home = join(base, 'home'), market = join(base, 'market');
  for (const dir of ['.claude/skills', '.copilot/skills', '.codex/skills', '.pi/agent/skills', '.config/opencode/skills']) {
    await mkdir(join(home, dir), { recursive: true });
  }
  await put(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'partial', source: './plugins/partial', version: '1.0.0' }] }));
  const pluginDir = join(market, 'plugins/partial');
  await put(join(pluginDir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'partial' }));
  await put(join(pluginDir, 'skills/triage/SKILL.md'), skill('triage', 'Triage from plugin.'));
  await put(join(pluginDir, 'agents/reviewer.md'), agentMd('reviewer', 'Review from plugin.'));
  await put(join(pluginDir, '.mcp.json'), JSON.stringify({ mcpServers: { relay: { command: 'npx', args: ['relay'] } } }));
  const share: ShareContext = {
    home, mode: 'custom', build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0,
    read: () => Promise.all(ALL_FIVE.map(harness => discover({ home, mode: 'custom', harness }))),
  };
  const host: MarketplaceHost = {
    home: () => ({ home, actual: true }), read: async () => ({ tools: [...ALL_FIVE], snapshots: [] }), writeAccess: async () => ({ allowed: true }),
    dataDir: join(base, 'data'), pickFolder: async () => undefined, openExternal: async () => {}, leftOut: async () => [], share: () => share,
  };
  const use: MarketplaceEngine = {
    findClis: async () => ({ binaries: { 'claude-cli': '/bin/true', 'copilot-cli': '/bin/true', 'codex-cli': '/bin/true' }, apps: {} }),
    checkAccess: engine.checkAccess, addMarketplace: async () => ({ outcome: 'added', message: 'Added.', runs: [] }), readCatalog: engine.readCatalog,
    readRemotePlugin: async () => ({ problem: 'not in tests' }),
    install: async (_ctx, _cat, _plugin, tool) => ({ tool, outcome: 'installed', message: 'Installed.', runs: [], changed: true }),
    uninstall: async (_ctx, _m, _p, tool) => ({ tool, outcome: 'uninstalled', message: 'Uninstalled.', runs: [], changed: true }),
    update: async () => { throw new Error('not in these tests'); }, setSkill: async () => { throw new Error('not in these tests'); },
    setPart: async () => { throw new Error('not in these tests'); }, setWhole: async () => { throw new Error('not in these tests'); },
  };
  const markets = createMarketplaces(host, use, []);
  await markets.add(market);
  // Turn partial on in Pi, then OpenCode: kept out of Claude Code, Copilot CLI and Codex.
  const turn = (what: PluginTurn, tool?: HarnessId) => markets.turn(market, 'partial', what, tool, home);
  assert.equal((await turn('let-in', 'pi-cli')).stopped, undefined);
  assert.equal((await turn('let-in', 'opencode-cli')).stopped, undefined);
  // Personal skill synced everywhere.
  await put(join(home, '.claude/skills/own-note/SKILL.md'), skill('own-note', 'Personal v1.'));
  assert.equal((await applySkills(share, ALL_FIVE, [{ key: 'own-note', on: true, except: [] }])).stopped, undefined);
  let sourceRepo: Awaited<ReturnType<typeof repository>> | undefined;
  let sourceId: string | undefined;
  if (options.gitSource) {
    const link = 'https://github.com/team/record-holds-source';
    sourceRepo = await repository(hosts, link);
    await sourceRepo.commit({ 'skills/git-skill/SKILL.md': skill('git-skill', 'From Git v1.') }, '2026-11-01T10:00:00Z');
    const look = await previewSource(share, ALL_FIVE, link);
    assert.ok('token' in look && !look.refused, `previewSource refused: ${'refused' in look ? look.refused : ''}`);
    const added = await addSource(share, ALL_FIVE, look.token);
    assert.equal(added.stopped, undefined);
    sourceId = (await sourcesView(share, ALL_FIVE)).sources[0]!.id;
    assert.equal((await applySkills(share, ALL_FIVE, [{ key: 'git-skill', on: true, except: [] }])).stopped, undefined);
  }
  await homePass(share, ALL_FIVE, true);
  const pluginsPath = join(home, '.central-knot/plugins.json');
  const goodPlugins = await readFile(pluginsPath, 'utf8');
  const library = async () => ({
    skill: (await skillKind.open(share)).library.items,
    agent: (await agentKind.open(share)).library.items,
    mcp: (await serverKind.open(share)).library.items,
  });
  const toolFiles = () => snapshotFiles(home, ['.central-knot']);
  const recordFiles = async () => Object.fromEntries(await Promise.all(['skills.json', 'agents.json', 'mcp.json', 'plugins.json']
    .map(async file => [file, await readFile(join(home, '.central-knot', file), 'utf8').catch(() => '')] as const)));
  return { base, home, market, share, markets, pluginsPath, goodPlugins, library, toolFiles, recordFiles, sourceRepo, sourceId, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Worked example 1: spoiling plugins.json (invalid JSON or unknown tool id in except) holds plugin items in every tool, keeps links and applied, and both Plugins and the Library say why', async () => {
  for (const [label, spoil] of [
    ['invalid JSON', () => '{ broken'],
    ['unknown tool id in except', (good: string) => {
      const parsed = JSON.parse(good) as { plugins: { except: string[] }[] };
      parsed.plugins[0]!.except.push('antigravity-cli');
      return `${JSON.stringify(parsed, null, 2)}\n`;
    }],
  ] as const) {
    const box = await partialHome();
    try {
      const beforeTools = await box.toolFiles(), beforeLib = await box.library();
      assert.equal(await exists(join(box.home, '.claude/skills/triage/SKILL.md')), false, `${label}: baseline has no triage in Claude Code`);
      assert.equal(await exists(join(box.home, '.pi/agent/skills/triage/SKILL.md')), true, `${label}: baseline has triage in Pi`);

      await writeFile(box.pluginsPath, spoil(box.goodPlugins));
      const passed = await homePass(box.share, ALL_FIVE, true);
      assert.equal(passed.synced?.skills?.stopped, undefined);
      assert.deepEqual(await box.toolFiles(), beforeTools, `${label}: no file of any tool changes at the pass`);
      const afterLib = await box.library();
      assert.deepEqual([afterLib.skill.triage?.source, afterLib.skill.triage?.seen, afterLib.skill.triage?.applied],
        [beforeLib.skill.triage?.source, beforeLib.skill.triage?.seen, beforeLib.skill.triage?.applied], `${label}: skill link and applied baseline kept`);
      assert.deepEqual([afterLib.agent.reviewer?.source, afterLib.agent.reviewer?.applied],
        [beforeLib.agent.reviewer?.source, beforeLib.agent.reviewer?.applied], `${label}: agent link and applied baseline kept`);
      assert.deepEqual([afterLib.mcp.relay?.source, afterLib.mcp.relay?.applied],
        [beforeLib.mcp.relay?.source, beforeLib.mcp.relay?.applied], `${label}: server link and applied baseline kept`);

      // Plugins page and Library rows say the same reason.
      const pluginsView = await box.markets.view();
      assert.equal(pluginsView.switchProblem, DAMAGED_REASON, `${label}: Plugins page says what is held and that sync retries`);
      const [skills, agents, servers] = await Promise.all([skillsView(box.share, ALL_FIVE), agentsView(box.share, ALL_FIVE), serversView(box.share, ALL_FIVE)]);
      for (const [kind, fact, item, words] of [
        ['skill', skills.items.find(r => r.key === 'triage')!, skills.library.triage!, libraryWords.skills],
        ['agent', agents.items.find(r => r.key === 'reviewer')!, agents.library.reviewer!, libraryWords.agents],
        ['mcp', servers.items.find(r => r.key === 'relay')!, servers.library.relay!, libraryWords.mcp],
      ] as const) {
        const row = { ...fact, hashes: hashesOf(fact.copies) };
        const expected = Object.fromEntries(ALL_FIVE.map(tool => [tool, DAMAGED_REASON]));
        assert.deepEqual(row.unseen, expected, `${label}: ${kind} row has the same hold reason on every tool`);
        assert.equal(statusLine(row, item, ALL_FIVE), 'On · left as it is (see below)', `${label}: ${kind} statusLine says left as it is`);
        assert.equal(sentences(words).harnessLine(row, item, 'claude-cli', 'Claude Code'), DAMAGED_REASON, `${label}: ${kind} tool line says why`);
      }

      // A click on a held plugin item is refused with the same reason and changes nothing; joinCounts writes none.
      const clicked = await applySkills(box.share, ALL_FIVE, [{ key: 'triage', on: false, except: [] }]);
      assert.deepEqual(clicked.results.map(r => [r.item, r.outcome, r.unchanged, r.message]), [['triage', 'held', true, DAMAGED_REASON]]);
      assert.equal((await box.library()).skill.triage?.on, true);
      assert.deepEqual(await box.toolFiles(), beforeTools);
      const counts = await joinCounts(skillKind, box.share, ALL_FIVE, 'claude-cli', false);
      assert.equal(counts.written, 0, `${label}: joinCounts does not count held plugin items`);
    } finally { await box.cleanup(); }
  }
});

test('Worked example 2: while plugins.json is damaged, personal items and verified Git source items keep syncing; unresolved links are held', async () => {
  const box = await partialHome({ gitSource: true });
  try {
    // Spoil plugins.json.
    await writeFile(box.pluginsPath, '{ broken');
    // Edit personal skill in Claude Code, and edit verified Git source skill in Copilot CLI.
    const ownEdited = skill('own-note', 'Personal v2 while plugins.json damaged.');
    const gitEdited = skill('git-skill', 'Git skill edited while plugins.json damaged.');
    await put(join(box.home, '.claude/skills/own-note/SKILL.md'), ownEdited);
    await put(join(box.home, '.copilot/skills/git-skill/SKILL.md'), gitEdited);

    await homePass(box.share, ALL_FIVE, true);

    // Personal skill and verified Git source skill both synced to every tool (OpenCode reads Claude Code's shared folder).
    for (const root of ['.claude/skills', '.copilot/skills', '.codex/skills', '.pi/agent/skills']) {
      assert.equal(await readFile(join(box.home, root, 'own-note/SKILL.md'), 'utf8'), ownEdited, `personal skill synced to ${root}`);
      assert.equal(await readFile(join(box.home, root, 'git-skill/SKILL.md'), 'utf8'), gitEdited, `verified Git source skill synced to ${root}`);
    }
    // Plugin items did not spread to Claude/Copilot/Codex.
    assert.equal(await exists(join(box.home, '.claude/skills/triage/SKILL.md')), false);
    assert.equal(await exists(join(box.home, '.copilot/skills/triage/SKILL.md')), false);
    assert.equal(await exists(join(box.home, '.codex/skills/triage/SKILL.md')), false);

    // If sources.json is ALSO damaged, git-skill's link can no longer be verified and is held too.
    await writeFile(join(box.home, '.central-knot/sources.json'), '{ broken');
    const gitV3 = skill('git-skill', 'Git skill edit while sources.json also damaged.');
    await put(join(box.home, '.claude/skills/git-skill/SKILL.md'), gitV3);
    await homePass(box.share, ALL_FIVE, true);
    assert.equal(await readFile(join(box.home, '.copilot/skills/git-skill/SKILL.md'), 'utf8'), gitEdited, 'unverified source link is held while plugins.json is damaged');
  } finally { await box.cleanup(); }
});

test('Worked example 2 (let-go & same-name Git source): a former plugin item now personal syncs; checking a Git source with a held plugin item’s name does not overwrite its link', async () => {
  const box = await partialHome({ gitSource: true });
  try {
    // Add a second plugin skill `keep-plugin` via partial, then let `triage` go by editing it in Pi while plugins.json is healthy.
    await put(join(box.market, 'plugins/partial/skills/keep-plugin/SKILL.md'), skill('keep-plugin', 'Still plugin.'));
    const updated = await box.markets.items(box.market, 'team', 'partial', ['pi-cli', 'opencode-cli'], box.home);
    assert.ok(!updated.reports.some(report => report.outcome === 'failed'));
    await put(join(box.home, '.pi/agent/skills/triage/SKILL.md'), skill('triage', 'Edited in Pi so let go.'));
    await homePass(box.share, ALL_FIVE, true);
    const libHealthy = await box.library();
    assert.equal(libHealthy.skill.triage?.source, undefined, 'triage was let go (personal now)');
    assert.ok(libHealthy.skill['keep-plugin']?.source, 'keep-plugin stays linked to the plugin');
    const keepPluginSource = libHealthy.skill['keep-plugin']!.source;

    // Add keep-plugin with the same content to the Git source, then spoil plugins.json and check the Git source.
    await box.sourceRepo!.commit({ 'skills/keep-plugin/SKILL.md': skill('keep-plugin', 'Still plugin.') }, '2026-11-02T10:00:00Z', 'add keep-plugin');
    await writeFile(box.pluginsPath, '{ broken');
    await checkSource(box.share, async () => ALL_FIVE, box.sourceId!, work => work());
    assert.equal((await box.library()).skill['keep-plugin']?.source, keepPluginSource, 'Git source check did not overwrite held plugin item’s link');

    // Editing the let-go personal `triage` in Pi still syncs to OpenCode (and any tool it isn't kept out of).
    const triageV3 = skill('triage', 'Personal triage edited while plugins.json damaged.');
    await put(join(box.home, '.pi/agent/skills/triage/SKILL.md'), triageV3);
    await homePass(box.share, ALL_FIVE, true);
    assert.equal(await readFile(join(box.home, '.config/opencode/skills/triage/SKILL.md'), 'utf8'), triageV3, 'let-go item (no active source id) syncs even with plugin provenance in versions');
    assert.equal(await exists(join(box.home, '.claude/skills/keep-plugin/SKILL.md')), false, 'linked plugin item stays held');
  } finally { await box.cleanup(); }
});

test('Worked example 3: a plugin item already in Pi stays untouched, and an Off set there stays Off while damaged and after restore', async () => {
  const box = await partialHome();
  try {
    // Turn `reviewer` (agent) Off in Pi (`except: ['pi-cli']`) and turn `relay` (MCP) Off whole while healthy.
    assert.equal((await applyAgents(box.share, ALL_FIVE, [{ key: 'reviewer', on: true, except: ['pi-cli'] }])).stopped, undefined);
    assert.equal((await applyServers(box.share, ALL_FIVE, [{ key: 'relay', on: false, except: [] }])).stopped, undefined);
    await homePass(box.share, ALL_FIVE, true);
    assert.equal(await exists(join(box.home, '.pi/agent/skills/triage/SKILL.md')), true);
    assert.equal(await exists(join(box.home, '.pi/agent/skills/reviewer.md')), false);
    const piTriageBefore = await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8');
    const piMcpBefore = await readFile(join(box.home, '.pi/agent/mcp.json'), 'utf8').catch(() => '');

    await writeFile(box.pluginsPath, '{ broken');
    await homePass(box.share, ALL_FIVE, true);
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8'), piTriageBefore, 'triage in Pi stays untouched');
    assert.equal(await exists(join(box.home, '.pi/agent/skills/reviewer.md')), false, 'reviewer kept out of Pi stays Off there');
    assert.equal(await readFile(join(box.home, '.pi/agent/mcp.json'), 'utf8').catch(() => ''), piMcpBefore, 'relay Off stays Off in Pi');
    assert.equal((await box.library()).agent.reviewer?.except.includes('pi-cli'), true);
    assert.equal((await box.library()).mcp.relay?.on, false);

    // Put plugins.json back: still Off in Pi, triage still untouched.
    await writeFile(box.pluginsPath, box.goodPlugins);
    await homePass(box.share, ALL_FIVE, true);
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8'), piTriageBefore);
    assert.equal(await exists(join(box.home, '.pi/agent/skills/reviewer.md')), false);
    assert.equal((await box.library()).mcp.relay?.on, false);
  } finally { await box.cleanup(); }
});

test('Worked example 4: putting plugins.json back matches a twin home that never had the problem (files and records equal)', async () => {
  const damaged = await partialHome();
  try {
    const twinBase = await realpath(await mkdtemp(join(tmpdir(), 'ck-record-holds-twin-')));
    try {
      const twinHome = join(twinBase, 'home');
      // Copy damaged's entire home (files + .central-knot records) to twinHome so both start byte-identical.
      const startFiles = await snapshotFiles(damaged.home);
      for (const [rel, content] of Object.entries(startFiles)) await put(join(twinHome, rel), content);
      const twinShare: ShareContext = {
        home: twinHome, mode: 'custom', build: 'test', settingsPath: join(twinBase, 'settings.json'), realHome: join(twinBase, 'real'), settleMs: 0,
        read: () => Promise.all(ALL_FIVE.map(harness => discover({ home: twinHome, mode: 'custom', harness }))),
      };
      // Register the same generation under twinHome's path so libraryGate accepts twinHome without waiting for Resume.
      await put(twinShare.settingsPath, (await readFile(damaged.share.settingsPath, 'utf8')).replaceAll(damaged.home, twinHome));

      // Spoil damaged's plugins.json and run a pass while damaged, then put plugins.json back and run a pass.
      await writeFile(damaged.pluginsPath, '{ broken');
      await homePass(damaged.share, ALL_FIVE, true);
      await writeFile(damaged.pluginsPath, damaged.goodPlugins);
      await homePass(damaged.share, ALL_FIVE, true);

      // Run a pass on the twin home that never had the problem.
      await homePass(twinShare, ALL_FIVE, true);

      assert.deepEqual(await snapshotFiles(damaged.home, ['.central-knot']), await snapshotFiles(twinHome, ['.central-knot']), 'every tool file matches the home that never had the problem');
      const normalize = (records: Record<string, string>) => Object.fromEntries(Object.entries(records).map(([file, text]) => {
        if (!text) return [file, text];
        const parsed = JSON.parse(text) as { folders?: Record<string, { path?: string; ino?: number; birth?: number }> };
        // Folder paths/inodes differ per temp directory; every item, version, link, applied baseline and plugin entry must be identical.
        if (parsed.folders) delete parsed.folders;
        return [file, parsed];
      }));
      const twinRecords = Object.fromEntries(await Promise.all(['skills.json', 'agents.json', 'mcp.json', 'plugins.json']
        .map(async file => [file, await readFile(join(twinHome, '.central-knot', file), 'utf8').catch(() => '')] as const)));
      assert.deepEqual(normalize(await damaged.recordFiles()), normalize(twinRecords), 'every library and plugins record matches the home that never had the problem');
    } finally { await rm(twinBase, { recursive: true, force: true }); }
  } finally {
    await damaged.cleanup();
  }
});

test('Worked example 5: a home with no plugins.json at all (first read) works as today', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-no-plugins-')));
  try {
    const home = join(base, 'home');
    for (const dir of ['.claude/skills', '.copilot/skills', '.pi/agent/skills']) await mkdir(join(home, dir), { recursive: true });
    const share: ShareContext = { home, mode: 'custom', build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0, read: async () => [] };
    assert.deepEqual(await readPluginRecord(home), {});
    await put(join(home, '.claude/skills/plain/SKILL.md'), skill('plain', 'No plugins here.'));
    assert.equal((await applySkills(share, ['claude-cli', 'copilot-cli', 'pi-cli'], [{ key: 'plain', on: true, except: [] }])).stopped, undefined);
    await homePass(share, ['claude-cli', 'copilot-cli', 'pi-cli'], true);
    assert.equal(await exists(join(home, '.central-knot/plugins.json')), false);
    assert.equal(await readFile(join(home, '.pi/agent/skills/plain/SKILL.md'), 'utf8'), skill('plain', 'No plugins here.'));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Worked example 6a: a profile switch while plugins.json is damaged switches personal items, holds plugin items, and says so in the result', async () => {
  const box = await partialHome();
  try {
    // Second personal skill `draft`, Off; `own-note` is On; plugin skill `triage` is On (in Pi & OpenCode).
    await put(join(box.home, '.claude/skills/draft/SKILL.md'), skill('draft', 'Draft.'));
    assert.equal((await applySkills(box.share, ALL_FIVE, [{ key: 'draft', on: true, except: [] }])).stopped, undefined);
    assert.equal((await applySkills(box.share, ALL_FIVE, [{ key: 'draft', on: false, except: [] }])).stopped, undefined);
    const saved = await saveProfile(box.share, { name: 'Focus', items: ['skill:draft'] });
    assert.equal(saved.problem, undefined);

    await writeFile(box.pluginsPath, '{ broken');
    const piTriageBefore = await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8');
    const switched = await switchProfile(box.share, ALL_FIVE, saved.id!, NO_PLUGINS);

    assert.equal(switched.stopped, undefined);
    assert.deepEqual(switched.on, ['draft'], 'personal item in profile turned On');
    assert.deepEqual(switched.off, ['own-note'], 'personal item outside profile turned Off');
    assert.ok(switched.left.includes('triage'), `plugin item reported as left: ${JSON.stringify(switched.left)}`);
    assert.ok(switched.results.some(r => r.item === 'triage' && r.outcome === 'held' && r.message === DAMAGED_REASON),
      `profile switch result names the hold reason: ${JSON.stringify(switched.results)}`);
    // Disk & library reflect personal switch only; plugin items untouched.
    assert.equal(await exists(join(box.home, '.claude/skills/draft/SKILL.md')), true);
    assert.equal(await exists(join(box.home, '.claude/skills/own-note/SKILL.md')), false);
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8'), piTriageBefore);
    assert.equal(await exists(join(box.home, '.claude/skills/triage/SKILL.md')), false);
    assert.equal((await box.library()).skill.triage?.on, true);
  } finally { await box.cleanup(); }
});

test('Worked example 6b: Pull while plugins.json is damaged pulls personal changes, holds plugin items (never pushing them either), and reports why', async () => {
  const box = await partialHome();
  try {
    const remote = join(box.base, 'config.git');
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    assert.equal((await connectRepo(box.share, remote, '')).stopped, undefined);
    assert.equal((await pushRepo(box.share)).stopped, undefined);

    // Clone the remote as another machine: edit personal `own-note`, and add `triage` (colliding with the plugin's skill) and `reviewer` (colliding with the plugin's agent, with Claude-only model setting).
    const author = join(box.base, 'author');
    execFileSync('git', ['clone', '--quiet', remote, author]);
    const pulledOwn = skill('own-note', 'Personal updated from Git repo.');
    await put(join(author, 'skills/own-note/SKILL.md'), pulledOwn);
    await put(join(author, 'skills/triage/SKILL.md'), skill('triage', 'From repo, must be held.'));
    await put(join(author, 'agents/reviewer.md'), '---\nname: reviewer\ndescription: reviewer\nmodel: opus\n---\nReview from plugin.\n');
    execFileSync('git', ['-C', author, 'add', '-A']);
    execFileSync('git', ['-C', author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', 'update']);
    execFileSync('git', ['-C', author, 'push', '--quiet', 'origin', 'HEAD:main']);

    // Place a hand-made copy of reviewer.md in Claude Code with matching prompt and another model: pullClaudeSettings must not touch it either.
    const claudeReviewerBefore = '---\nname: reviewer\ndescription: reviewer\nmodel: sonnet\n---\nReview from plugin.\n';
    await put(join(box.home, '.claude/agents/reviewer.md'), claudeReviewerBefore);
    // Spoil plugins.json, then Pull.
    const piTriageBefore = await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8');
    const piReviewerBefore = await readFile(join(box.home, '.pi/agent/skills/reviewer.md'), 'utf8');
    const libBefore = await box.library();
    await writeFile(box.pluginsPath, '{ broken');

    const pulled = await pullRepo(box.share);
    assert.equal(pulled.stopped, undefined);
    assert.equal(pulled.pulled, 1, 'only the personal item pulled');
    // Personal skill pulled to every tool (OpenCode reads Claude Code's shared folder).
    for (const root of ['.claude/skills', '.copilot/skills', '.codex/skills', '.pi/agent/skills']) {
      assert.equal(await readFile(join(box.home, root, 'own-note/SKILL.md'), 'utf8'), pulledOwn, `pulled personal skill in ${root}`);
    }
    // Plugin skill and agent stayed untouched on disk and in the library records.
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8'), piTriageBefore);
    assert.equal(await exists(join(box.home, '.claude/skills/triage/SKILL.md')), false);
    assert.equal(await readFile(join(box.home, '.pi/agent/skills/reviewer.md'), 'utf8'), piReviewerBefore);
    assert.equal(await readFile(join(box.home, '.claude/agents/reviewer.md'), 'utf8'), claudeReviewerBefore, 'pullClaudeSettings did not write a held plugin agent');
    const libAfter = await box.library();
    assert.equal(libAfter.skill.triage?.hash, libBefore.skill.triage?.hash);
    assert.equal(libAfter.skill.triage?.source, libBefore.skill.triage?.source);
    assert.equal(libAfter.agent.reviewer?.hash, libBefore.agent.reviewer?.hash);
    // Pull's result and view say why each plugin item was held.
    assert.ok(pulled.results.some(r => r.item === 'triage' && r.outcome === 'held' && r.message === DAMAGED_REASON),
      `Pull result names triage hold: ${JSON.stringify(pulled.results)}`);
    assert.ok(pulled.results.some(r => r.item === 'reviewer' && r.outcome === 'held' && r.message === DAMAGED_REASON),
      `Pull result names reviewer hold: ${JSON.stringify(pulled.results)}`);
    assert.ok(pulled.view.connected);
    assert.equal(pulled.view.incoming.find(row => row.name === 'triage')?.held, DAMAGED_REASON);
    assert.equal(pulled.view.incoming.find(row => row.name === 'reviewer')?.held, DAMAGED_REASON);
    // And Push does not offer plugin items as outgoing additions while plugins.json is damaged.
    assert.deepEqual(pulled.view.outgoing.filter(row => ['triage', 'reviewer', 'relay'].includes(row.name)), []);
  } finally { await box.cleanup(); }
});

test('Rule edges: pluginsRecordHold checks active source id, verified Git sources and stored plugin provenance; guardFolders and cameBack keep applied baselines while plugins.json is damaged', async () => {
  const damaged: Recorded = { ids: new Set(['git-1']), links: new Map([['git-1', 'https://example.test/org/repo']]), plugins: [], sources: new Set(['git-1']), pluginsProblem: DAMAGED_REASON };
  const withOrigin = (source: string | undefined, link?: string) => ({
    ...newItem('x', 'x'), ...(source ? { source } : {}),
    versions: link ? [{ hash: 'h1', at: '2026-11-23T00:00:00.000Z', from: { how: 'source' as const, link } }] : [],
  });
  assert.equal(pluginsRecordHold(withOrigin(undefined, 'plugin:kit@team'), damaged), undefined, 'no active source id: personal item (even with old plugin provenance) is not held');
  assert.equal(pluginsRecordHold(withOrigin('git-1', 'https://example.test/org/repo'), damaged), undefined, 'verified Git source with Git provenance is not held');
  assert.equal(pluginsRecordHold(withOrigin('plug-1', 'plugin:kit@team'), damaged), DAMAGED_REASON, 'plugin item is held');
  assert.equal(pluginsRecordHold(withOrigin('unknown-1'), damaged), DAMAGED_REASON, 'unresolved active source id is held');
  assert.equal(pluginsRecordHold(withOrigin('git-1', 'plugin:kit@team'), damaged), DAMAGED_REASON, 'stored plugin provenance holds even if source id collided with sources.json');

  // Folder reset (guardFolders forget) and tool managed again (cameBack) preserve applied baselines of held plugin items.
  const box = await partialHome();
  try {
    const before = (await box.library()).skill.triage!;
    assert.ok(before.applied['pi-cli'], 'baseline applied in Pi');
    await writeFile(box.pluginsPath, '{ broken');
    // Remove Pi's skills folder (guardFolders away -> forget), run pass: applied['pi-cli'] stays intact.
    await rm(join(box.home, '.pi/agent/skills'), { recursive: true, force: true });
    await homePass(box.share, ALL_FIVE, true);
    assert.equal((await box.library()).skill.triage?.applied['pi-cli'], before.applied['pi-cli'], 'guardFolders forget skips held plugin item');
    // Simulate tool managed again (folder back, no folder identity on record -> cameBack): applied['pi-cli'] still intact.
    await mkdir(join(box.home, '.pi/agent/skills'), { recursive: true });
    const skillsPath = join(box.home, '.central-knot/skills.json');
    const raw = JSON.parse(await readFile(skillsPath, 'utf8')) as { folders: Record<string, unknown> };
    delete raw.folders['pi-cli'];
    await writeFile(skillsPath, `${JSON.stringify(raw, null, 2)}\n`);
    await homePass(box.share, ALL_FIVE, true);
    assert.equal((await box.library()).skill.triage?.applied['pi-cli'], before.applied['pi-cli'], 'cameBack skips held plugin item');
    // Restore of a deleted plugin item is also refused while plugins.json is damaged.
    await writeFile(box.pluginsPath, box.goodPlugins);
    assert.equal((await applySkills(box.share, ALL_FIVE, [{ key: 'triage', on: false, except: [], deleted: true }])).stopped, undefined);
    await writeFile(box.pluginsPath, '{ broken');
    const restored = await applySkills(box.share, ALL_FIVE, [{ key: 'triage', on: true, except: [], deleted: false }]);
    assert.deepEqual(restored.results.map(r => [r.item, r.outcome, r.unchanged, r.message]), [['triage', 'held', true, DAMAGED_REASON]]);
    assert.ok((await box.library()).skill.triage?.deleted, 'deleted plugin item stays deleted while plugins.json is damaged');
  } finally { await box.cleanup(); }
});
