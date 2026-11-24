// A damaged, unreadable or newer plugins record (.central-knot/plugins.json) holds items linked to a plugin in every managed
// tool while personal items and items from a verified Git source keep syncing (sourcestore.ts pluginsRecordHold, librarypass.ts).
// Worked examples on real files in temp homes: spoiling plugins.json, personal and Git-source sync, Pi copies and Off states,
// recovery matching an undamaged twin home, first read with no plugins.json, profile switch, Pull and Push, and rule edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { agentKind, agentsView, applyAgents } from '../src/agents.ts';
import { discover } from '../src/discovery.ts';
import { connectRepo, pullRepo, pushRepo, repoView } from '../src/gitrepo.ts';
import { readHistory } from '../src/history.ts';
import { homePass } from '../src/homepass.ts';
import { joinCounts } from '../src/librarypass.ts';
import { hashesOf, libraryWords, sentences, statusLine } from '../src/libraryrow.ts';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import { readPluginRecord } from '../src/pluginrecord.ts';
import * as engine from '../src/plugins.ts';
import { NO_PLUGINS, saveProfile, switchProfile } from '../src/profiles.ts';
import { applyServers, serverKind, serversView } from '../src/servers.ts';
import { readTree, type ShareContext } from '../src/share.ts';
import { applySkills, skillKind, skillsView, takeOver } from '../src/skills.ts';
import { addSource, checkSource, previewSource, removeSource, sourcesView } from '../src/sources.ts';
import { pluginsRecordHold, type Recorded } from '../src/sourcestore.ts';
import { chooseTools } from '../src/toolchoice.ts';
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

const DAMAGED_REASON = 'The plugins record is damaged. Nothing was written or deleted. Put the record back, then try again. Its plugins’ items are held as they are until then. The next sync takes them up again once the record is back.';
const REPO_HOLD_CLAUSE = 'Pull and Push wait until then, for your own items too.';
const DAMAGED_REPO_REASON = `${DAMAGED_REASON} ${REPO_HOLD_CLAUSE}`;

/** Every file under `folder`, by relative path, with its bytes: for byte-for-byte "nothing changed" and twin-home checks. */
async function snapshotFiles(folder: string, exclude: string[] = []): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name), rel = relative(folder, full).replaceAll('\\', '/');
      if (exclude.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
      if (entry.isSymbolicLink()) found[rel] = `symlink:${await readlink(full)}`;
      else if (entry.isDirectory()) await walk(full);
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
      parsed.plugins[0]!.except.push('future-tool-cli');
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
      await put(twinShare.settingsPath, (await readFile(damaged.share.settingsPath, 'utf8')).replaceAll(JSON.stringify(damaged.home), JSON.stringify(twinHome)));

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
    // Fix item 4: History records only what actually switched, not the held plugin items, and switchProfile returns that settled payload.
    const entry = (await readHistory(box.share)).find(event => event.id === switched.event);
    assert.deepEqual(entry?.profile?.on, [{ id: 'skill:draft', name: 'draft' }]);
    assert.deepEqual(entry?.profile?.off, [{ id: 'skill:own-note', name: 'own-note' }]);
    assert.deepEqual(switched.profile, entry?.profile);
    // And when a profile switch leaves every planned item held, History records empty on/off lists.
    const onlyHeld = await saveProfile(box.share, { name: 'OnlyHeld', items: ['skill:draft'] });
    assert.equal(onlyHeld.problem, undefined);
    const heldSwitch = await switchProfile(box.share, ALL_FIVE, onlyHeld.id!, NO_PLUGINS);
    const heldEntry = (await readHistory(box.share)).find(event => event.id === heldSwitch.event);
    assert.deepEqual(heldEntry?.profile?.on, []);
    assert.deepEqual(heldEntry?.profile?.off, []);
    assert.deepEqual(heldSwitch.profile, heldEntry?.profile);
  } finally { await box.cleanup(); }
});

test('Worked example 6b: while plugins.json has a problem, Pull and Push refuse before reading or writing anything (including personal items and retry records)', async () => {
  for (const [label, spoil, expected] of [
    ['damaged JSON', '{ broken', DAMAGED_REPO_REASON],
    ['newer formatVersion', `${JSON.stringify({ formatVersion: 99, tools: [], knows: [], plugins: [] })}\n`,
      `The plugins record was written by a newer Central Knot. Nothing was written or deleted. Put the record back, then try again. Its plugins’ items are held as they are until then. The next sync takes them up again once the record is back. ${REPO_HOLD_CLAUSE}`],
  ] as const) {
    const box = await partialHome();
    try {
      const remote = join(box.base, 'config.git'), author = join(box.base, 'author');
      execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
      assert.equal((await connectRepo(box.share, remote, '')).stopped, undefined);
      assert.equal((await pushRepo(box.share)).stopped, undefined);
      // Upstream commit adding a personal change and a colliding plugin item.
      execFileSync('git', ['clone', '--quiet', remote, author]);
      await put(join(author, 'skills/own-note/SKILL.md'), skill('own-note', 'Personal upstream edit.'));
      await put(join(author, 'skills/triage/SKILL.md'), skill('triage', 'From repo, collides with plugin.'));
      execFileSync('git', ['-C', author, 'add', '-A']);
      execFileSync('git', ['-C', author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', 'upstream']);
      execFileSync('git', ['-C', author, 'push', '--quiet', 'origin', 'HEAD:main']);
      // Local personal edit and a pre-existing retry record in repo.json that must stay untouched during the hold.
      await put(join(box.home, '.claude/skills/own-note/SKILL.md'), skill('own-note', 'Personal local edit.'));
      await homePass(box.share, ALL_FIVE, true);
      const repoStatePath = join(box.home, '.central-knot/repo.json');
      const seededState = { ...JSON.parse(await readFile(repoStatePath, 'utf8')), unfinished: { 'mcp:relay': { reason: 'Earlier hold.', here: 'h0' } } };
      await writeFile(repoStatePath, `${JSON.stringify(seededState, null, 2)}\n`);

      await writeFile(box.pluginsPath, spoil);
      const beforeTools = await box.toolFiles();
      const beforeStore = await snapshotFiles(join(box.home, '.central-knot'));
      const beforeRemoteHead = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();

      const view = await repoView(box.share, { check: true });
      assert.ok(view.connected, `${label}: repo stays connected`);
      assert.equal(view.held, expected, `${label}: Git page view carries the hold sentence`);
      assert.deepEqual([view.incoming, view.outgoing], [[], []], `${label}: no pull/push lists staged while held`);

      const pulled = await pullRepo(box.share);
      assert.equal(pulled.stopped, expected, `${label}: Pull refuses with the record’s sentence + personal-items clause`);
      assert.deepEqual(pulled.results, []);
      assert.ok(pulled.view.connected && pulled.view.held === expected);

      const pushed = await pushRepo(box.share);
      assert.equal(pushed.stopped, expected, `${label}: Push refuses with the record’s sentence + personal-items clause`);
      assert.deepEqual(pushed.results, []);
      assert.ok(pushed.view.connected && pushed.view.held === expected);

      assert.deepEqual(await box.toolFiles(), beforeTools, `${label}: no tool file changed`);
      assert.deepEqual(await snapshotFiles(join(box.home, '.central-knot')), beforeStore, `${label}: no store file, clone file or retry record changed`);
      assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim(), beforeRemoteHead, `${label}: remote repo untouched`);
    } finally { await box.cleanup(); }
  }
});

test('Git recovery matches a sound twin for both an upstream edit of a linked plugin agent and an upstream deletion of a linked plugin server', async () => {
  const gitTree = (bare: string) => Object.fromEntries(
    execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).sort()
      .map(path => [path, execFileSync('git', ['--git-dir', bare, 'show', `main:${path}`], { encoding: 'utf8' })]),
  );
  const runCase = async (scenario: 'upstream-edit' | 'upstream-delete', spoil: boolean) => {
    const box = await partialHome();
    try {
      const remote = join(box.base, 'config.git'), author = join(box.base, 'author');
      execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
      execFileSync('git', ['clone', '--quiet', remote, author]);
      await put(join(author, 'skills/own-note/SKILL.md'), skill('own-note', 'Personal v1.'));
      await put(join(author, 'agents/reviewer.md'), agentMd('reviewer', 'Review from plugin.'));
      await put(join(author, 'mcp/relay.json'), `${JSON.stringify({ command: 'npx', args: ['relay'] }, null, 2)}\n`);
      await put(join(author, 'mcp/own-srv.json'), `${JSON.stringify({ command: 'npx', args: ['own-srv'] }, null, 2)}\n`);
      execFileSync('git', ['-C', author, 'add', '-A']);
      execFileSync('git', ['-C', author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', 'seed']);
      execFileSync('git', ['-C', author, 'push', '--quiet', 'origin', 'HEAD:main']);
      assert.equal((await connectRepo(box.share, remote, '')).stopped, undefined);
      assert.equal((await pullRepo(box.share)).stopped, undefined);
      // Upstream change while the record will be damaged on the spoiled twin.
      if (scenario === 'upstream-edit') {
        await put(join(author, 'agents/reviewer.md'), agentMd('reviewer', 'Review edited upstream.'));
        await put(join(author, 'skills/from-team/SKILL.md'), skill('from-team', 'Team skill from upstream.'));
      } else {
        await rm(join(author, 'mcp/relay.json'));
        await rm(join(author, 'mcp/own-srv.json'));
      }
      execFileSync('git', ['-C', author, 'add', '-A']);
      execFileSync('git', ['-C', author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', scenario]);
      execFileSync('git', ['-C', author, 'push', '--quiet', 'origin', 'HEAD:main']);

      // Personal edit made locally.
      await put(join(box.home, '.claude/skills/own-note/SKILL.md'), skill('own-note', `Personal after ${scenario}.`));
      if (spoil) {
        await writeFile(box.pluginsPath, '{ broken');
        await homePass(box.share, ALL_FIVE, true);
        assert.equal((await pullRepo(box.share)).stopped, DAMAGED_REPO_REASON);
        assert.equal((await pushRepo(box.share)).stopped, DAMAGED_REPO_REASON);
        const heldView = await repoView(box.share, { check: true });
        assert.ok(heldView.connected && heldView.held === DAMAGED_REPO_REASON);
        // Put the record back; check incoming list before Pull, then sync + Pull + Push.
        await writeFile(box.pluginsPath, box.goodPlugins);
        await homePass(box.share, ALL_FIVE, true);
      } else {
        await homePass(box.share, ALL_FIVE, true);
      }
      const beforePull = await repoView(box.share, { check: true });
      assert.ok(beforePull.connected && !beforePull.held);
      const pulled = await pullRepo(box.share);
      assert.equal(pulled.stopped, undefined);
      const pushed = await pushRepo(box.share);
      assert.equal(pushed.stopped, undefined);
      const treeAfterPush = gitTree(remote);
      await homePass(box.share, ALL_FIVE, true);
      await pushRepo(box.share);
      const lib = await box.library();
      return {
        beforePullIncoming: beforePull.incoming,
        treeAfterPush,
        treeFinal: gitTree(remote),
        tools: await box.toolFiles(),
        relayDeleted: !!lib.mcp.relay?.deleted,
        ownSrvDeleted: !!lib.mcp['own-srv']?.deleted,
        reviewerHash: lib.agent.reviewer?.hash,
        reviewerLinked: !!lib.agent.reviewer?.source,
        ownHash: lib.skill['own-note']?.hash,
        history: (await readHistory(box.share)).map(event => [event.kind, event.key, event.cause, event.via]),
      };
    } finally { await box.cleanup(); }
  };

  for (const scenario of ['upstream-edit', 'upstream-delete'] as const) {
    const [repaired, twin] = [await runCase(scenario, true), await runCase(scenario, false)];
    assert.deepEqual(repaired, twin, `${scenario}: repaired home matches sound twin after Pull then Push`);
    if (scenario === 'upstream-edit') {
      assert.match(repaired.tools['.pi/agent/skills/reviewer.md'] ?? '', /Review edited upstream\./);
      assert.ok(repaired.treeFinal['agents/reviewer.md'], 'upstream edit of linked agent kept in repo after settle');
    }
    if (scenario === 'upstream-delete') {
      assert.equal(repaired.beforePullIncoming.find(row => row.key === 'mcp:own-srv')?.change, 'removed');
      assert.equal(repaired.ownSrvDeleted, true);
    }
  }
});

test('Rule edges: pluginsRecordHold distinguishes removed Git sources from plugins and unreadable sources.json; restoring a deleted plugin item is held', async () => {
  const damaged: Recorded = { ids: new Set(['git-1']), links: new Map([['git-1', 'https://example.test/org/repo']]), plugins: [], sources: new Set(['git-1']), pluginsProblem: DAMAGED_REASON };
  const bothDamaged: Recorded = { ...damaged, ids: new Set(), links: new Map(), sources: new Set(), sourcesProblem: 'The sources record is damaged.' };
  const withOrigin = (source: string | undefined, link?: string) => ({
    ...newItem('x', 'x'), ...(source ? { source } : {}),
    versions: link ? [{ hash: 'h1', at: '2026-11-23T00:00:00.000Z', from: { how: 'source' as const, link } }] : [],
  });
  assert.equal(pluginsRecordHold(withOrigin(undefined, 'plugin:kit@team'), damaged), undefined, 'no active source id: personal item (even with old plugin provenance) is not held');
  assert.equal(pluginsRecordHold(withOrigin('git-1', 'https://example.test/org/repo'), damaged), undefined, 'verified Git source with Git provenance is not held');
  assert.equal(pluginsRecordHold(withOrigin('removed-git', 'https://example.test/org/removed'), damaged), undefined, 'removed Git source with readable sources.json and non-plugin provenance is his own, not held');
  assert.equal(pluginsRecordHold(withOrigin('removed-git', 'https://example.test/org/removed'), bothDamaged), DAMAGED_REASON, 'unreadable sources.json holds unresolved source id');
  assert.equal(pluginsRecordHold(withOrigin('plug-1', 'plugin:kit@team'), damaged), DAMAGED_REASON, 'plugin item is held');
  assert.equal(pluginsRecordHold(withOrigin('unknown-1'), damaged), DAMAGED_REASON, 'unresolved active source id with no provenance is held');
  assert.equal(pluginsRecordHold(withOrigin('git-1', 'plugin:kit@team'), damaged), DAMAGED_REASON, 'stored plugin provenance holds even if source id collided with sources.json');

  // Restore of a deleted plugin item is also refused while plugins.json is damaged.
  const box = await partialHome();
  try {
    assert.equal((await applySkills(box.share, ALL_FIVE, [{ key: 'triage', on: false, except: [], deleted: true }])).stopped, undefined);
    await writeFile(box.pluginsPath, '{ broken');
    const restored = await applySkills(box.share, ALL_FIVE, [{ key: 'triage', on: true, except: [], deleted: false }]);
    assert.deepEqual(restored.results.map(r => [r.item, r.outcome, r.unchanged, r.message]), [['triage', 'held', true, DAMAGED_REASON]]);
    assert.ok((await box.library()).skill.triage?.deleted, 'deleted plugin item stays deleted while plugins.json is damaged');
  } finally { await box.cleanup(); }
});

test('Fix item 2: after repair, returning Pi to Manage after its copy went away — or replacing Pi’s skills folder — restores Pi and keeps OpenCode, matching a sound twin', async () => {
  // Case A: Pi unmanaged -> copy removed -> Pi managed again while damaged -> repair.
  const results = [];
  for (const damaged of [true, false]) {
    const box = await partialHome();
    try {
      if (damaged) await writeFile(box.pluginsPath, '{ broken');
      assert.equal((await chooseTools(box.share, 'pi-cli', false)).stopped, undefined);
      await homePass(box.share, ALL_FIVE.filter(tool => tool !== 'pi-cli'), true);
      await rm(join(box.home, '.pi/agent/skills/triage'), { recursive: true, force: true });
      assert.equal((await chooseTools(box.share, 'pi-cli', true)).stopped, undefined);
      await homePass(box.share, ALL_FIVE, true);
      if (damaged) {
        assert.equal(await exists(join(box.home, '.pi/agent/skills/triage/SKILL.md')), false, 'nothing written to Pi while damaged');
        await writeFile(box.pluginsPath, box.goodPlugins);
        await homePass(box.share, ALL_FIVE, true);
      }
      const item = (await box.library()).skill.triage!;
      const history = (await readHistory(box.share)).filter(event => event.key === 'triage').map(event => [event.kind, event.cause]);
      results.push({ on: item.on, pi: await exists(join(box.home, '.pi/agent/skills/triage/SKILL.md')), open: await exists(join(box.home, '.config/opencode/skills/triage/SKILL.md')), history });
    } finally { await box.cleanup(); }
  }
  assert.deepEqual(results[0], results[1], 'damaged-then-repaired matches never-damaged twin');
  assert.equal(results[0]!.on, true);
  assert.equal(results[0]!.pi, true);
  assert.equal(results[0]!.open, true);

  // Case B: Pi's entire skills folder replaced by an empty one while damaged -> repair restores Pi and keeps OpenCode.
  const box = await partialHome();
  try {
    await writeFile(box.pluginsPath, '{ broken');
    await rm(join(box.home, '.pi/agent/skills'), { recursive: true, force: true });
    await mkdir(join(box.home, '.pi/agent/skills'), { recursive: true });
    await homePass(box.share, ALL_FIVE, true);
    assert.equal(await exists(join(box.home, '.pi/agent/skills/triage/SKILL.md')), false, 'nothing written to Pi while damaged');
    await writeFile(box.pluginsPath, box.goodPlugins);
    await homePass(box.share, ALL_FIVE, true);
    assert.equal((await box.library()).skill.triage?.on, true);
    assert.equal(await exists(join(box.home, '.pi/agent/skills/triage/SKILL.md')), true);
    assert.equal(await exists(join(box.home, '.config/opencode/skills/triage/SKILL.md')), true);
  } finally { await box.cleanup(); }
});

test('Fix item 3: takeOver of a held plugin skill’s shared copy or outside link refuses before removing anything and appends no History entry', async () => {
  const box = await partialHome();
  try {
    const shared = join(box.home, '.agents/skills/triage/SKILL.md');
    const piCopy = await readFile(join(box.home, '.pi/agent/skills/triage/SKILL.md'), 'utf8');
    await put(shared, piCopy);
    const outsideTarget = join(box.base, 'outside-triage');
    await put(join(outsideTarget, 'SKILL.md'), piCopy);
    await symlink(outsideTarget, join(box.home, '.codex/skills/triage'));
    await homePass(box.share, ALL_FIVE, true);
    await writeFile(box.pluginsPath, '{ broken');
    const beforeFiles = await box.toolFiles();

    const sharedTake = await takeOver(box.share, ALL_FIVE, 'triage', 'copilot-cli');
    assert.equal(sharedTake.stopped, DAMAGED_REASON);
    assert.equal(await readFile(shared, 'utf8'), piCopy, 'shared copy stayed intact');

    const linkTake = await takeOver(box.share, ALL_FIVE, 'triage', 'codex-cli');
    assert.equal(linkTake.stopped, DAMAGED_REASON);
    assert.equal(await exists(join(box.home, '.codex/skills/triage/SKILL.md')), true, 'outside symlink stayed intact');

    assert.deepEqual(await box.toolFiles(), beforeFiles);
    assert.equal((await readHistory(box.share)).some(event => event.kind === 'took-over' && event.key === 'triage'), false);
  } finally { await box.cleanup(); }
});

test('Fix item 5: an item from a Git source removed by the user is his own and keeps syncing while plugins.json is damaged, then pushes once the record is back', async () => {
  const box = await partialHome({ gitSource: true });
  try {
    assert.equal((await removeSource(box.share, ALL_FIVE, box.sourceId!)).stopped, undefined);
    // Source id remains on the item after removeSource, while sources.json no longer lists it.
    assert.ok((await box.library()).skill['git-skill']?.source);

    await writeFile(box.pluginsPath, '{ broken');
    const edited = skill('git-skill', 'Removed Git source skill edited while plugins.json damaged.');
    await put(join(box.home, '.claude/skills/git-skill/SKILL.md'), edited);
    await homePass(box.share, ALL_FIVE, true);
    for (const root of ['.claude/skills', '.copilot/skills', '.codex/skills', '.pi/agent/skills']) {
      assert.equal(await readFile(join(box.home, root, 'git-skill/SKILL.md'), 'utf8'), edited, `removed Git source skill synced to ${root}`);
    }
    // Plugin skill still held, and Push refuses until plugins.json is back.
    assert.equal(await exists(join(box.home, '.claude/skills/triage/SKILL.md')), false);
    const remote = join(box.base, 'config.git');
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    assert.equal((await connectRepo(box.share, remote, '')).stopped, undefined);
    assert.equal((await pushRepo(box.share)).stopped, DAMAGED_REPO_REASON);
    // Once plugins.json is back, Push sends the removed Git source skill as his own.
    await writeFile(box.pluginsPath, box.goodPlugins);
    assert.equal((await pushRepo(box.share)).stopped, undefined);
    assert.equal(execFileSync('git', ['--git-dir', remote, 'show', 'main:skills/git-skill/SKILL.md'], { encoding: 'utf8' }), edited);
  } finally { await box.cleanup(); }
});

test('A tool holding an older copy it refused to replace is not called "not in" on the row (only Codex managed)', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-codex-old-copy-')));
  try {
    const home = join(base, 'home');
    await mkdir(join(home, '.codex/skills'), { recursive: true });
    const oldCopy = skill('demo', 'Old valid copy Codex runs.');
    await put(join(home, '.codex/skills/demo/SKILL.md'), oldCopy);
    const share: ShareContext = {
      home, mode: 'custom', build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0,
      read: () => Promise.all(['codex-cli' as HarnessId].map(harness => discover({ home, mode: 'custom', harness }))),
    };
    assert.equal((await applySkills(share, ['codex-cli'], [{ key: 'demo', on: true, except: [] }])).stopped, undefined);
    // Pull a version with no YAML frontmatter: Codex refuses to replace its older copy and keeps running oldCopy.
    const badFolder = join(base, 'pulled-demo');
    await put(join(badFolder, 'SKILL.md'), '# No frontmatter\nCodex will not load this.\n');
    const pulled = await applySkills(share, ['codex-cli'], [], {
      only: new Set(['demo']), pulled: new Map([['demo', { name: 'demo', folder: badFolder, hash: (await readTree(badFolder)).hash }]]),
    });
    assert.equal(pulled.stopped, undefined);
    assert.equal(await readFile(join(home, '.codex/skills/demo/SKILL.md'), 'utf8'), oldCopy, 'Codex kept its older copy on disk');
    const view = await skillsView(share, ['codex-cli']), fact = view.items.find(item => item.key === 'demo')!;
    const row = { ...fact, hashes: hashesOf(fact.copies) };
    assert.ok(row.hashes['codex-cli'], 'row records Codex’s older copy');
    assert.match(row.cannot['codex-cli'] ?? '', /YAML frontmatter/);
    assert.equal(statusLine(row, view.library.demo, ['codex-cli']), 'On · Codex can’t take it (see below)');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Fix item 6: in a sound home with Pi and OpenCode left out in Manage, triage’s status agrees with the plugin-only lines below it', async () => {
  const box = await partialHome();
  try {
    const managed = ALL_FIVE.filter(tool => tool !== 'pi-cli' && tool !== 'opencode-cli');
    assert.equal((await chooseTools(box.share, 'pi-cli', false)).stopped, undefined);
    assert.equal((await chooseTools(box.share, 'opencode-cli', false)).stopped, undefined);
    await homePass(box.share, managed, true);
    const view = await skillsView(box.share, managed), fact = view.items.find(item => item.key === 'triage')!;
    const row = { ...fact, hashes: hashesOf(fact.copies) };
    const say = sentences(libraryWords.skills);
    assert.deepEqual(managed.map(tool => say.harnessLine(row, view.library.triage, tool, tool === 'claude-cli' ? 'Claude Code' : tool === 'copilot-cli' ? 'Copilot CLI' : 'Codex')), [
      'Claude Code gets it only with the plugin partial, and the plugin is kept out of Claude Code.',
      'Copilot CLI gets it only with the plugin partial, and the plugin is kept out of Copilot CLI.',
      'Codex gets it only with the plugin partial, and the plugin is kept out of Codex.',
    ]);
    assert.equal(statusLine(row, view.library.triage, view.tools), 'On · not in Claude Code, Copilot CLI or Codex (see below)');
  } finally { await box.cleanup(); }
});
