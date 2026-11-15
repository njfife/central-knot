// One install at a time: a build held by another (share.ts ShareContext held, from main.ts heldReason) writes nothing in the
// home or the tools. One home with something waiting for every route (an edit to spread, a found skill to take in, a profile
// to switch to), each route run held, and every byte of the home compared before and after. Only the build's own settings file
// lies outside the home. What counts as another build, and Replace: tests/otherbuilds.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { applyAgents } from '../src/agents.ts';
import { setSyncEverything } from '../src/everything.ts';
import { connectRepo } from '../src/gitrepo.ts';
import { pruneHistory } from '../src/history.ts';
import { homePass } from '../src/homepass.ts';
import { saveInstruction } from '../src/instructions.ts';
import { createMarketplaces, type MarketplaceEngine } from '../src/marketplaces.ts';
import { saveProfile, switchProfile } from '../src/profiles.ts';
import { applyServers } from '../src/servers.ts';
import { takeOverSync, writeAccess, type ShareContext } from '../src/share.ts';
import { checkSource } from '../src/sources.ts';
import { chooseTools } from '../src/toolchoice.ts';

import { bytes, put, sandbox, send, skillText, turnOn } from './skillclicks.ts';

const HELD = 'Central Knot Alpha is also installed on this Mac, and only one build of Central Knot works at a time, so Central Knot changes nothing in this home or your tools until one of the two is gone.';

test('A held build writes nothing in the home or the tools, by any route: each is refused at writeAccess, in the held sentence', async () => {
  const box = await sandbox();
  try {
    // Something waiting for every route: "notes" On and then edited in Claude Code (a pass would spread it), "found" in one
    // tool only (Synchronize everything would take it in), and a profile to switch to.
    await put(box, 'claude-cli');
    assert.notEqual(await turnOn(box), 'choose');
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Edited in Claude Code.') });
    await put(box, 'codex-cli', { 'SKILL.md': skillText('Found.', 'found') }, [], 'found');
    const profile = (await saveProfile(box.context, { name: 'Writing', items: [] })).id!;
    const plugins = join(box.base, 'market');
    await mkdir(join(plugins, '.claude-plugin'), { recursive: true });
    await writeFile(join(plugins, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: [{ name: 'pdf', source: './pdf' }] }));
    const before = await bytes(box.home);

    const held: ShareContext = { ...box.context, held: HELD };
    assert.deepEqual(await writeAccess(held), { allowed: false, reason: HELD });
    const tools = box.tools, toolsNow = async () => tools, turn = <T>(work: () => Promise<T>) => work();
    // The plugins' every write asks the host's writeAccess, which main gives as share.ts writeAccess of the held context.
    const calls: string[] = [];
    const call = (name: string) => async () => { calls.push(name); throw new Error(`${name} ran while held`); };
    const use = { findClis: async () => ({ binaries: { 'claude-cli': '/bin/true' }, apps: {} }), checkAccess: call('checkAccess'), addMarketplace: call('addMarketplace'), readCatalog: call('readCatalog'),
      readRemotePlugin: call('readRemotePlugin'), install: call('install'), uninstall: call('uninstall'), update: call('update'), setSkill: call('setSkill'), setPart: call('setPart'), setWhole: call('setWhole') } as unknown as MarketplaceEngine;
    const markets = createMarketplaces({
      home: () => ({ home: box.home, actual: true }), read: async () => ({ tools, snapshots: [] }), writeAccess: () => writeAccess(held), leftOut: async () => [],
      dataDir: join(box.base, 'data'), pickFolder: async () => undefined, openExternal: async () => {}, share: () => held,
      bundled: () => ({ source: plugins, view: { app: 'Acme Knot', release: 'November 15, 2026', unpackaged: [] } }),
    }, use, []);

    const routes: [string, () => Promise<unknown>][] = [
      ['a background pass', async () => homePass(held, tools, true)],
      ['a click on Skills', async () => (await send(box, { key: 'found', on: true, except: [] }, held)).stopped],
      ['a click on MCP servers', async () => (await applyServers(held, tools, [{ key: 'server', on: true, except: [] }])).stopped],
      ['a click on Agents', async () => (await applyAgents(held, tools, [{ key: 'agent', on: true, except: [] }])).stopped],
      ['a profile switch', async () => (await switchProfile(held, tools, profile)).stopped],
      ['a profile saved', async () => (await saveProfile(held, { name: 'Another', items: [] })).problem],
      ['a tool’s Manage switch', async () => (await chooseTools(held, 'codex-cli', false)).stopped],
      ['Synchronize everything', async () => (await setSyncEverything(held, true, true)).stopped],
      ['a source’s check (the daily one is the same call)', async () => (await checkSource(held, toolsNow, 'a-source', turn)).stopped],
      ['a plugin installed, as an owed install is', async () => (await markets.install(plugins, 'team', 'pdf', ['claude-cli'], box.home)).stopped],
      ['a plugin updated by itself', async () => (await markets.update(plugins, 'team', 'pdf', ['claude-cli'], box.home, { reinstall: false })).stopped],
      ['the bundled marketplace added to the tools', async () => markets.addCarried(['claude-cli'], turn)],
      ['the plugins record’s first write (the Plugins view)', async () => (await markets.view()).marketplaces.length],
      ['a tool new to the plugins record', async () => markets.noteJoined(['codex-cli'], box.home)],
      ['an instruction file saved', async () => (await saveInstruction(held, [], 'claude-cli', 'New.\n', '')).stopped],
      ['the Git repo connected', async () => (await connectRepo(held, 'https://github.com/example/library', '')).stopped],
      ['a take-over of the record (the look’s, main.ts takeOverHome)', async () => (await takeOverSync(held)).stopped],
      ['History kept to its days', async () => pruneHistory(held)],
    ];
    const answers: Record<string, unknown> = {};
    for (const [route, run] of routes) answers[route] = await run();
    assert.deepEqual(await bytes(box.home), before, 'every byte of the home and its tools’ folders is as it was');
    assert.deepEqual(calls, [], 'no tool command ran');
    // Where a route answers in words, they are the held sentence.
    for (const route of ['a click on Skills', 'a click on MCP servers', 'a click on Agents', 'a profile switch', 'a profile saved', 'a tool’s Manage switch', 'Synchronize everything',
      'a source’s check (the daily one is the same call)', 'a plugin installed, as an owed install is', 'a plugin updated by itself', 'an instruction file saved', 'the Git repo connected', 'a take-over of the record (the look’s, main.ts takeOverHome)']) assert.equal(answers[route], HELD, route);
    assert.deepEqual(answers['the bundled marketplace added to the tools'], []);
    assert.equal(answers['History kept to its days'], 'later');
  } finally { await box.cleanup(); }
});
