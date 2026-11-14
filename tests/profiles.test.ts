// Profiles as sets of library items, worked examples: the rules (profileplan.ts), a switch and its Undo on real files in a temp
// home with three tools (profiles.ts), which profile is in use as the library changes, and the move of a profiles file from
// before (profilemigrate.ts). The temp home has Claude Code, Copilot CLI and Codex; Claude Code's MCP settings wait for Write
// to Claude Code, as in the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyAgents } from '../src/agents.ts';
import { readHistory } from '../src/history.ts';
import { newItem, type ItemKind } from '../src/library.ts';
import { readTool, writeEntry } from '../src/mcp.ts';
import { mcpSwitchPath, withMcpSwitch } from '../src/mcpswitch.ts';
import { migrateProfiles } from '../src/profilemigrate.ts';
import { inUse, inUseName, liveItems, switchable, switchPlan, turnsWords, undoPlan, type Libraries } from '../src/profileplan.ts';
import { deleteProfile, liveNow, readProfiles, saveProfile, switchProfile, undoSwitch } from '../src/profiles.ts';
import { applyServers, serversView, writeToClaude } from '../src/servers.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { setDisabled } from '../src/skillswitch.ts';
import type { Profile } from '../src/types.ts';
import { bytes, folderOf, put, sandbox, skillText, type Box, type Tool } from './skillclicks.ts';

// ---------- The rules ----------

const libraryOf = (items: [ItemKind, string, boolean, boolean?][]): Libraries => {
  const libraries: Libraries = { skill: {}, mcp: {}, agent: {} };
  for (const [kind, key, on, deleted] of items) libraries[kind][key] = { ...newItem(key, key), on, ...(deleted ? { deleted: { at: '' } } : {}) };
  return libraries;
};
const ids = (items: { id: string }[]) => items.map(item => item.id);
const profile = (name: string, items: string[]): Profile => ({ id: name, name, items });

test('A switch turns what the profile names On and every other library item Off; an id naming no live item is skipped', () => {
  const live = liveItems(libraryOf([['skill', 'dev', true], ['skill', 'pager', true], ['skill', 'gone', true, true], ['mcp', 'docs', false], ['agent', 'writer', true]]));
  assert.deepEqual(ids(live), ['skill:dev', 'skill:pager', 'mcp:docs', 'agent:writer'], 'a deleted item is not live');
  // skill:gone was deleted and skill:loose is only found in a tool: both skipped, and both stay in the profile.
  const turns = switchPlan(profile('Work', ['skill:dev', 'mcp:docs', 'skill:gone', 'skill:loose']), live);
  assert.deepEqual([ids(turns.on), ids(turns.off)], [['mcp:docs'], ['skill:pager', 'agent:writer']]);
  assert.equal(turnsWords(turns, 'will'), 'turns 1 item on and 2 off');
  assert.equal(turnsWords(turns, 'did'), '1 item turned on and 2 turned off');
  assert.equal(turnsWords({ on: [], off: [1] }, 'will'), 'turns 1 item off');
});

test('A profile is in use exactly while switching to it would change nothing: two with the same items both are, an empty one only while nothing is On', () => {
  const live = liveItems(libraryOf([['skill', 'dev', true], ['agent', 'writer', true], ['mcp', 'docs', false], ['skill', 'gone', false, true]]));
  const dev = profile('Dev', ['skill:dev', 'agent:writer']), same = profile('Same', ['agent:writer', 'skill:dev', 'skill:gone', 'skill:loose']);
  const all = profile('All', ['skill:dev', 'agent:writer', 'mcp:docs']), empty = profile('Empty', []);
  assert.deepEqual(inUse([dev, same, all, empty], live), [dev, same], 'ids naming no live item are skipped here too');
  assert.equal(inUseName([dev, same, all, empty], live), 'Dev and Same');
  assert.equal(inUseName([all, empty], live), 'No profile');
  const nothingOn = liveItems(libraryOf([['skill', 'dev', false]]));
  assert.deepEqual(inUse([dev, empty], nothingOn), [empty]);
  // A profile with nothing live in it is not offered to switch to: it would turn every item off.
  assert.deepEqual([dev, empty, profile('Gone', ['skill:gone', 'skill:loose'])].map(each => switchable(each, live)), [true, false, false]);
});

test('The Undo of a switch turns back each item still as the switch left it, decided from each item now', () => {
  const entry = { profile: { toName: 'Dev', on: [{ id: 'mcp:docs', name: 'docs' }], off: [{ id: 'skill:pager', name: 'pager' }, { id: 'skill:notes', name: 'notes' }, { id: 'agent:gone', name: 'gone' }] } };
  // Since the switch: pager was turned back on by hand, docs was turned off by hand, and agent gone was deleted.
  const live = liveItems(libraryOf([['skill', 'pager', true], ['skill', 'notes', false], ['mcp', 'docs', false], ['agent', 'gone', false, true]]));
  const back = undoPlan(entry, live);
  assert.deepEqual([ids(back.on), ids(back.off)], [['skill:notes'], []]);
  assert.deepEqual(undoPlan({ profile: { toName: 'Old' } }, live), { on: [], off: [] }, 'an entry from before profiles were sets of items has nothing to undo');
});

// ---------- A switch on real files ----------

type Three = 'claude-cli' | 'copilot-cli' | 'codex-cli';
const tools: Three[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const MCP: Record<Three, string> = { 'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml' };
const SETTINGS: Record<Three, string> = { 'claude-cli': '.claude/settings.json', 'copilot-cli': '.copilot/settings.json', 'codex-cli': '.codex/config.toml' };
const AGENTS: Record<Three, string> = { 'claude-cli': '.claude/agents/writer.md', 'copilot-cli': '.copilot/agents/writer.agent.md', 'codex-cli': '.codex/agents/writer.toml' };
const text = (box: Box, path: string) => readFile(join(box.home, path), 'utf8').catch(() => undefined);
/** A server's entry in each tool (its content, and its own fields), and the rest of each settings file without it. */
const entries = async (box: Box, name: string) => Object.fromEntries(await Promise.all(tools.map(async tool => {
  const entry = (await readTool(box.context, tool)).entries.find(each => each.name === name), file = await text(box, MCP[tool]);
  return [tool, { entry: entry && { hash: entry.hash, own: entry.extras }, rest: file && writeEntry(file, tool, name, undefined) }] as const;
})));
/** Every file the home's items live in, as a test compares them: skill folders byte for byte, agent files, settings files. */
const everything = async (box: Box, skills: string[], servers: string[]) => ({
  skills: Object.fromEntries(await Promise.all(skills.flatMap(name => tools.map(async tool => [`${tool}/${name}`, await bytes(folderOf(box, tool, name))] as const)))),
  servers: Object.fromEntries(await Promise.all(servers.map(async name => [name, await entries(box, name)] as const))),
  agents: await Promise.all(tools.map(tool => text(box, AGENTS[tool]))),
  settings: await Promise.all(tools.map(tool => (tool === 'codex-cli' ? undefined : text(box, SETTINGS[tool])))),
});
const history = async (box: Box) => readHistory(box.context);
const live = (box: Box) => liveNow(box.context);
const names = (items: { name: string }[]) => items.map(item => item.name);

/**
 * A home where everything is in Central Knot and On: skills dev and pager in every tool, the server sentry (Codex has fields of
 * its own; kept out of Copilot CLI), and the agent writer; Claude Code written.
 */
async function home() {
  const box = await sandbox(tools);
  for (const name of ['dev', 'pager']) for (const tool of tools) await put(box, tool, { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
  await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ numStartups: 3, mcpServers: { sentry: { type: 'stdio', command: 'sentry', timeout: 30 } } }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['codex-cli']), 'model = "gpt-6"\n\n[mcp_servers.sentry]\ncommand = "sentry"\n# mine\nstartup_timeout_sec = 9\n');
  await writeFile(join(box.home, SETTINGS['claude-cli']), '{\n  "theme": "dark"\n}\n');
  for (const tool of tools) await mkdir(join(box.home, AGENTS[tool], '..'), { recursive: true });
  await writeFile(join(box.home, AGENTS['claude-cli']), '---\nname: writer\ndescription: Writes docs\nmodel: opus\n---\n\nYou write docs.\n');
  await applySkills(box.context, box.tools, [{ key: 'dev', managed: true, off: [] }, { key: 'pager', managed: true, off: [] }]);
  await applyServers(box.context, box.tools, [{ key: 'sentry', managed: true, off: ['copilot-cli'] }]);
  await writeToClaude(box.context, box.tools, ['sentry']);
  await applyAgents(box.context, box.tools, [{ key: 'writer', managed: true, off: [] }]);
  const made = async (name: string, items: string[]) => (await saveProfile(box.context, { name, items })).id!;
  return { box, made, profiles: async () => (await readProfiles(box.home)).profiles };
}

test('Switching turns what a profile leaves out Off in one History entry, and switching back puts every file back; Claude Code waits for Write', async () => {
  const { box, made, profiles } = await home();
  try {
    const before = await everything(box, ['dev', 'pager'], ['sentry']), entriesBefore = (await history(box)).length;
    const dev = await made('Dev', ['skill:dev', 'agent:writer']);
    const switched = await switchProfile(box.context, box.tools, dev);
    assert.deepEqual([switched.stopped, switched.on, switched.off, switched.waits, switched.results], [undefined, [], ['pager', 'sentry'], ['sentry'], []]);
    // One entry, the switch's: the items' own Off entries are not written for it.
    const told = (await history(box)).slice(entriesBefore);
    assert.deepEqual(told.map(entry => [entry.kind, entry.item, names(entry.profile?.off ?? [])]), [['profile', 'Dev', ['pager', 'sentry']]]);
    assert.deepEqual(await Promise.all(tools.map(tool => bytes(folderOf(box, tool, 'pager')))), [undefined, undefined, undefined]);
    const sentry = await entries(box, 'sentry');
    assert.deepEqual([!!sentry['claude-cli'].entry, sentry['codex-cli'].entry], [true, undefined], 'Claude Code still has it: its removal waits for Write to Claude Code');
    assert.deepEqual((await inUse(await profiles(), await live(box))).map(each => each.name), ['Dev']);
    await writeToClaude(box.context, box.tools, ['sentry']);
    assert.equal((await entries(box, 'sentry'))['claude-cli'].entry, undefined);
    // What Write to Claude Code took out is said in History too, as every removal no click of its pass asked for.
    assert.deepEqual((await history(box)).slice(-1).map(entry => [entry.kind, entry.item, entry.cause, entry.losers.map(loser => loser.tool)]), [['off', 'sentry', 'in-line', ['claude-cli']]]);
    // Switching to the profile in use changes nothing, and writes no entry.
    const count = (await history(box)).length;
    const again = await switchProfile(box.context, box.tools, dev);
    assert.deepEqual([again.event, (await history(box)).length], [undefined, count]);
    // Back: each item On where it was, sentry still kept out of Copilot CLI, every file as before.
    const all = await made('All', ['skill:dev', 'skill:pager', 'mcp:sentry', 'agent:writer']);
    const back = await switchProfile(box.context, box.tools, all);
    assert.deepEqual([back.on, back.off, back.waits], [['pager', 'sentry'], [], ['sentry']]);
    await writeToClaude(box.context, box.tools, ['sentry']);
    assert.deepEqual(await everything(box, ['dev', 'pager'], ['sentry']), before);
    assert.deepEqual((await inUse(await profiles(), await live(box))).map(each => each.name), ['All']);
  } finally { await box.cleanup(); }
});

test('A server whose entry Claude Code lost while its removal waited turns Off again in the switch that turns it On: the result says so, and History says why', async () => {
  const { box, made, profiles } = await home();
  try {
    await switchProfile(box.context, box.tools, await made('Dev', ['skill:dev', 'agent:writer']));
    // Claude Code rewrote its file without servers before Write to Claude Code took sentry out.
    await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ numStartups: 4 })}\n`);
    const back = await switchProfile(box.context, box.tools, await made('All', ['skill:dev', 'skill:pager', 'mcp:sentry', 'agent:writer']));
    assert.deepEqual([back.on, back.off, back.left], [['pager'], [], ['sentry']]);
    assert.equal(inUseName(await profiles(), await live(box)), 'No profile');
    assert.deepEqual((await history(box)).slice(-2).map(entry => [entry.kind, entry.item, entry.cause]), [['profile', 'All', undefined], ['off', 'sentry', 'deleted-by-hand']]);
  } finally { await box.cleanup(); }
});

test('Undo of a switch turns back only what is still as the switch left it, each with its own entry', async () => {
  const { box, made } = await home();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillText('Notes.', 'notes') }, [], 'notes');
    await applySkills(box.context, box.tools, [{ key: 'notes', managed: true, off: [] }]);
    await applyServers(box.context, box.tools, [{ key: 'sentry', managed: false, off: ['copilot-cli'], seenManaged: true }]);
    // Dev turns sentry On and pager and notes Off.
    const switched = await switchProfile(box.context, box.tools, await made('Dev', ['skill:dev', 'mcp:sentry', 'agent:writer']));
    assert.deepEqual([switched.on, switched.off], [['sentry'], ['pager', 'notes']]);
    // Since then, by hand: pager On again, sentry Off again.
    await applySkills(box.context, box.tools, [{ key: 'pager', managed: true, off: [], seenManaged: false }]);
    await applyServers(box.context, box.tools, [{ key: 'sentry', managed: false, off: ['copilot-cli'], seenManaged: true }]);
    const count = (await history(box)).length;
    const undone = await undoSwitch(box.context, box.tools, switched.event!);
    assert.deepEqual([undone.stopped, undone.switched], [undefined, { on: ['notes'], off: [], left: [], waits: [] }]);
    const items = Object.fromEntries((await live(box)).map(item => [item.name, item.on]));
    assert.deepEqual([items.notes, items.pager, items.sentry], [true, true, false], 'pager and sentry stay as the person left them');
    const after = await history(box);
    assert.deepEqual(after.slice(count).map(entry => [entry.kind, entry.item]), [['on', 'notes']]);
    assert.equal(after.find(entry => entry.id === switched.event)?.undoneBy, after.at(-1)!.id);
    assert.match((await undoSwitch(box.context, box.tools, switched.event!)).stopped ?? '', /nothing to undo/);
  } finally { await box.cleanup(); }
});

test('Which profile is in use follows the library: Delete, a hand click, an item taken in or pulled, a copy deleted by hand; a newer or unreadable profiles file is left alone', async () => {
  const { box, made, profiles } = await home();
  const name = async () => inUseName(await profiles(), await live(box));
  try {
    await switchProfile(box.context, box.tools, await made('Dev', ['skill:dev', 'agent:writer']));
    await made('Also dev', ['agent:writer', 'skill:dev', 'skill:pager', 'skill:never-taken-in']);
    assert.equal(await name(), 'Dev', 'Also dev names pager, which is Off');
    await applySkills(box.context, box.tools, [{ key: 'pager', managed: false, off: [], deleted: true }]);
    assert.equal(await name(), 'Dev and Also dev', 'an id naming an item since deleted, or never taken in, is skipped');
    await applyAgents(box.context, box.tools, [{ key: 'writer', managed: false, off: [], seenManaged: true }]);
    assert.equal(await name(), 'No profile', 'a hand click');
    await applyAgents(box.context, box.tools, [{ key: 'writer', managed: true, off: [], seenManaged: false }]);
    await put(box, 'codex-cli', { 'SKILL.md': skillText('New.', 'fresh') }, [], 'fresh');
    await applySkills(box.context, box.tools, [{ key: 'fresh', managed: true, off: [] }]);
    assert.equal(await name(), 'No profile', 'an item taken in is On and in no profile');
    await applySkills(box.context, box.tools, [{ key: 'fresh', managed: true, off: [], deleted: true }]);
    await applyServers(box.context, box.tools, [], { pulled: new Map([['pulled', { name: 'pulled', server: { transport: 'stdio', command: 'pulled' } }]]) });
    assert.equal(await name(), 'No profile', 'a server new here that Pull brings is On and in no profile');
    await applyServers(box.context, box.tools, [{ key: 'pulled', managed: true, off: [], deleted: true }]);
    assert.equal(await name(), 'Dev and Also dev');
    await rm(folderOf(box, 'codex-cli', 'dev'), { recursive: true });
    await applySkills(box.context, box.tools, []);
    assert.equal(await name(), 'No profile', 'a copy deleted by hand turns its item Off');
    // A profiles file this Central Knot can't use is reported and never written.
    for (const file of ['{ not json', '{ "formatVersion": 3, "profiles": [] }']) {
      await writeFile(join(box.home, '.central-knot/profiles.json'), file);
      assert.ok((await readProfiles(box.home)).problem);
      assert.ok((await saveProfile(box.context, { name: 'Other' })).problem);
      assert.ok((await switchProfile(box.context, box.tools, 'Dev')).stopped);
      assert.equal(await text(box, '.central-knot/profiles.json'), file);
    }
  } finally { await box.cleanup(); }
});

test('Profiles save only the fields given, a deleted one comes back with its id, deleting one changes no item, and a switch waits for Resume', async () => {
  const { box, made, profiles } = await home();
  try {
    const dev = await made('Development', ['skill:dev']);
    await saveProfile(box.context, { id: dev, items: ['skill:dev', 'agent:writer', 'nonsense', 'tool:x'] });
    await saveProfile(box.context, { id: dev, name: '  Dev   work ' });
    assert.deepEqual(await profiles(), [{ id: dev, name: 'Dev work', items: ['skill:dev', 'agent:writer'] }]);
    assert.equal((await saveProfile(box.context, { name: 'dev WORK' })).problem, 'There is already a profile called “dev WORK”.');
    const before = await live(box);
    await switchProfile(box.context, box.tools, dev);
    const on = await live(box);
    await deleteProfile(box.context, dev);
    assert.deepEqual([await profiles(), await live(box)], [[], on]);
    assert.notDeepEqual(on, before);
    await saveProfile(box.context, { id: dev, name: 'Dev work', items: ['skill:dev'], restore: true });
    assert.equal((await profiles())[0]?.id, dev);
    // A record this app has no memory of: every pass would refuse, so the switch refuses first and writes no entry.
    await applySkills(box.context, box.tools, [{ key: 'pager', managed: true, off: [], seenManaged: false }]);
    const count = (await history(box)).length;
    const resumeFirst = await switchProfile({ ...box.context, settingsPath: join(box.home, 'elsewhere.json') }, box.tools, dev);
    assert.match(resumeFirst.stopped ?? '', /no memory of it.*Nothing was switched\./);
    assert.deepEqual([(await history(box)).length, (await live(box)).find(item => item.key === 'pager')?.on], [count, true]);
  } finally { await box.cleanup(); }
});

// ---------- A profiles file from before ----------

/**
 * A home as the earlier Central Knot left it with the profile Dev in use: what Dev left out was turned off by each tool's own
 * switch, and `offByProfile` lists those switches.
 *   pager   left out, held off in every tool                 → Off; its switches cleared; its folders taken out
 *   half    held off in Claude Code only (on in the others)  → stays On; Claude Code's switch cleared
 *   back    held off in every tool, then turned back on in Codex by hand (still listed) → stays On; the others cleared
 *   mine    switched off in Codex by hand (not listed)       → stays as it is, switch and all
 *   fresh   taken in since the last switch                   → stays On
 *   loose   only found in Codex, held off there              → its switch cleared, nothing else
 *   sentry  held off in every tool: Claude Code's deny, Copilot CLI's list, Codex's `enabled = false` in its table
 *           → Off; Codex's switch cleared before its entry goes; Claude Code's deny kept until the server is wanted there
 *   docs    held off in Codex only                           → stays On; Codex's switch cleared
 *   writer  an agent, On                                     → joins every profile
 */
async function oldHome(active?: string) {
  const box = await sandbox(tools);
  for (const name of ['pager', 'half', 'back', 'mine', 'fresh']) for (const tool of tools) await put(box, tool, { 'SKILL.md': skillText(`The ${name} skill.`, name) }, [], name);
  await put(box, 'codex-cli', { 'SKILL.md': skillText('Loose.', 'loose') }, [], 'loose');
  const entry = { 'claude-cli': { type: 'stdio', command: 'x' }, 'copilot-cli': { type: 'local', command: 'x', tools: ['*'] } };
  const servers = (tool: 'claude-cli' | 'copilot-cli') => ({ sentry: { ...entry[tool], command: 'sentry' }, docs: { ...entry[tool], command: 'docs' } });
  await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ mcpServers: servers('claude-cli') }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['copilot-cli']), `${JSON.stringify({ mcpServers: servers('copilot-cli') }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['codex-cli']), 'model = "gpt-6"\n\n[mcp_servers.sentry]\ncommand = "sentry"\nstartup_timeout_sec = 9\n\n[mcp_servers.docs]\ncommand = "docs"\n');
  for (const tool of tools) await mkdir(join(box.home, AGENTS[tool], '..'), { recursive: true });
  await writeFile(join(box.home, AGENTS['claude-cli']), '---\nname: writer\ndescription: Writes docs\n---\n\nYou write docs.\n');
  await applySkills(box.context, box.tools, ['pager', 'half', 'back', 'mine'].map(key => ({ key, managed: true, off: [] })));
  await applyServers(box.context, box.tools, ['sentry', 'docs'].map(key => ({ key, managed: true, off: [] })));
  await writeToClaude(box.context, box.tools, ['sentry', 'docs']);
  await applyAgents(box.context, box.tools, [{ key: 'writer', managed: true, off: [] }]);
  // The switches, as the earlier profile switch (and the person, for mine) set them.
  const skillOff = (tool: Tool, name: string) => setDisabled(box.context, tool, { folder: name, name, skillFile: join(folderOf(box, tool, name), 'SKILL.md') }, true);
  for (const tool of tools) await skillOff(tool, 'pager');
  for (const tool of ['claude-cli', 'copilot-cli'] as const) await skillOff(tool, 'back');
  await skillOff('claude-cli', 'half');
  await skillOff('codex-cli', 'mine');
  await skillOff('codex-cli', 'loose');
  const serverOff = async (tool: Tool, name: string) => writeFile(mcpSwitchPath(box.context, tool), withMcpSwitch(tool, await readFile(mcpSwitchPath(box.context, tool), 'utf8').catch(() => ''), name, true));
  for (const tool of tools) await serverOff(tool, 'sentry');
  await serverOff('codex-cli', 'docs');
  await applySkills(box.context, box.tools, [{ key: 'fresh', managed: true, off: [] }]);
  const old = { formatVersion: 1, profiles: [{ id: 'dev', name: 'Dev', items: ['skill:half', 'skill:mine', 'mcp:docs'] }, { id: 'all', name: 'All', items: ['skill:pager', 'mcp:Sentry'] }],
    ...(active ? { active } : {}), offByProfile: { 'skill:pager': tools, 'skill:half': ['claude-cli'], 'skill:back': tools, 'skill:loose': ['codex-cli'], 'mcp:sentry': tools, 'mcp:docs': ['codex-cli'] } };
  await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify(old, null, 2)}\n`);
  return { box, old: await text(box, '.central-knot/profiles.json') };
}
/** Every file the old home's items live in, by path, as text (a folder: its files). */
async function files(box: Box) {
  const found: Record<string, unknown> = {};
  for (const tool of tools) {
    for (const name of ['pager', 'half', 'back', 'mine', 'fresh', 'loose']) found[`${tool} skill ${name}`] = await bytes(folderOf(box, tool, name));
    found[`${tool} mcp`] = await text(box, MCP[tool]);
    found[`${tool} settings`] = await text(box, SETTINGS[tool]);
    found[`${tool} agent`] = await text(box, AGENTS[tool]);
  }
  return found;
}
const changed = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

test('Migration clears the switches profiles set and turns Off only what they held off in every tool; one pass after it writes nothing', async () => {
  const { box, old } = await oldHome('dev');
  try {
    const before = await files(box);
    await migrateProfiles(box.context, box.tools);
    const after = await files(box);
    // Changed: the settings that held the listed switches (Codex's config.toml holds its skill rules and servers), the MCP files
    // the server Off was taken out of, and pager's folders. Claude Code's MCP file waits for Write to Claude Code.
    assert.deepEqual(changed(before, after), ['claude-cli skill pager', 'claude-cli settings', 'copilot-cli skill pager', 'copilot-cli mcp', 'copilot-cli settings', 'codex-cli skill pager', 'codex-cli mcp', 'codex-cli settings']);
    const claude = JSON.parse(after['claude-cli settings'] as string);
    assert.deepEqual([claude.skillOverrides ?? {}, claude.deniedMcpServers], [{}, [{ serverName: 'sentry' }]], 'pager’s, half’s and back’s overrides cleared; sentry’s deny kept: its entry is still in Claude Code');
    assert.equal(await text(box, '.central-knot/claude-denies.json'), '["sentry"]\n');
    assert.deepEqual(JSON.parse(after['copilot-cli settings'] as string), {}, 'Copilot CLI’s lists emptied');
    assert.deepEqual(Object.keys(JSON.parse(after['copilot-cli mcp'] as string).mcpServers), ['docs']);
    const codex = after['codex-cli mcp'] as string;
    assert.match(codex, /\[mcp_servers\.docs\]\ncommand = "docs"\n\n\[\[skills/, 'docs’s switch cleared; sentry’s entry gone');
    assert.deepEqual(['sentry', 'pager/SKILL.md', 'loose/SKILL.md', 'mine/SKILL.md'].map(word => codex.includes(word)), [false, false, false, true], 'mine’s switch, set by hand, stays');
    const items = Object.fromEntries((await live(box)).map(item => [item.id, item.on]));
    assert.deepEqual(items, { 'skill:back': true, 'skill:half': true, 'skill:mine': true, 'skill:pager': false, 'skill:fresh': true, 'mcp:docs': true, 'mcp:sentry': false, 'agent:writer': true });
    // The old file is kept; the new one has no holds and no profile in use, MCP servers by key, and the agent On in each profile.
    assert.equal(await text(box, '.central-knot/profiles.v1.json'), old);
    assert.deepEqual(JSON.parse((await text(box, '.central-knot/profiles.json'))!), { formatVersion: 2, profiles: [
      { id: 'dev', name: 'Dev', items: ['skill:half', 'skill:mine', 'mcp:docs', 'agent:writer'] }, { id: 'all', name: 'All', items: ['skill:pager', 'mcp:sentry', 'agent:writer'] }] });
    const [told] = (await history(box)).filter(entry => entry.kind === 'profile');
    assert.deepEqual([told.item, told.profile?.migrated, names(told.profile?.off ?? [])], ['Dev', true, ['pager', 'sentry']]);
    // Once moved, nothing is left to do: the migration and a pass write nothing more.
    await migrateProfiles(box.context, box.tools);
    for (const pass of [applySkills, applyServers, applyAgents]) assert.equal((await pass(box.context, box.tools, [])).writes, 0);
    assert.deepEqual(await files(box), after);
  } finally { await box.cleanup(); }
});

test('Migration: a server held off in Codex comes back on with its entry; Claude Code’s deny goes once the server is wanted there, never before', async () => {
  const { box } = await oldHome('dev');
  try {
    await migrateProfiles(box.context, box.tools);
    const denied = async () => JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers ?? [];
    // Write to Claude Code takes sentry's entry out; its deny stays while it is Off.
    await writeToClaude(box.context, box.tools, ['sentry']);
    assert.equal((await entries(box, 'sentry'))['claude-cli'].entry, undefined);
    assert.deepEqual(await denied(), [{ serverName: 'sentry' }]);
    // On again: Codex's entry is back with its own field and no `enabled = false`, and Claude Code's deny is gone before Write puts it there.
    await applyServers(box.context, box.tools, [{ key: 'sentry', managed: true, off: [], seenManaged: false }]);
    assert.match((await text(box, MCP['codex-cli']))!, /\[mcp_servers\.sentry\]\ncommand = "sentry"\nstartup_timeout_sec = 9\n$/);
    assert.deepEqual([await denied(), await text(box, '.central-knot/claude-denies.json')], [[], '[]\n']);
    await writeToClaude(box.context, box.tools, ['sentry']);
    assert.ok((await entries(box, 'sentry'))['claude-cli'].entry);
  } finally { await box.cleanup(); }
});

test('Migration: the first switch after it turns no agent Off, and an old file with no profile in use moves the same way', async () => {
  const { box } = await oldHome();
  try {
    await migrateProfiles(box.context, box.tools);
    const [told] = (await history(box)).filter(entry => entry.kind === 'profile');
    assert.deepEqual([told.item, told.profile?.toName], ['Profiles', undefined]);
    const switched = await switchProfile(box.context, box.tools, 'dev');
    assert.deepEqual([switched.stopped, switched.on, switched.off], [undefined, [], ['back', 'fresh']]);
    assert.equal((await live(box)).find(item => item.id === 'agent:writer')?.on, true);
    assert.equal(inUseName((await readProfiles(box.home)).profiles, await live(box)), 'Dev');
    // Undo of the migration's entry turns back on what it turned off.
    const undone = await undoSwitch(box.context, box.tools, told.id);
    assert.deepEqual(undone.switched?.on, ['pager', 'sentry']);
  } finally { await box.cleanup(); }
});

test('Migration waits where a pass may not write, and does nothing to a file it can’t read', async () => {
  const { box, old } = await oldHome('dev');
  try {
    const before = await files(box);
    await migrateProfiles({ ...box.context, settingsPath: join(box.home, 'elsewhere.json') }, box.tools);
    assert.deepEqual([await files(box), await text(box, '.central-knot/profiles.json')], [before, old], 'a record this app has no memory of waits for Resume');
    assert.ok((await saveProfile(box.context, { name: 'New' })).problem, 'an old file is not edited before it is moved');
    await writeFile(join(box.home, '.central-knot/profiles.json'), '{ not json');
    await migrateProfiles(box.context, box.tools);
    assert.deepEqual([await files(box), await text(box, '.central-knot/profiles.json')], [before, '{ not json']);
  } finally { await box.cleanup(); }
});

// ---------- A profiles file from before, with copies that are not there now ----------

/**
 * A home where a format 1 profile held switches off whose copies are gone now: docs held off in Claude Code (its deny) and in
 * Codex (`enabled = false` in its table), then turned Off and written out of Claude Code, so Codex's own part keeps the switch;
 * web held off in Codex, then kept out of Codex; pager held off in Codex (its rule, by path), then turned Off.
 */
async function goneHome() {
  const box = await sandbox(tools);
  for (const tool of tools) await put(box, tool, { 'SKILL.md': skillText('The pager skill.', 'pager') }, [], 'pager');
  await writeFile(join(box.home, MCP['claude-cli']), `${JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'docs' } } }, null, 2)}\n`);
  await writeFile(join(box.home, MCP['codex-cli']), 'model = "gpt-6"\n\n[mcp_servers.docs]\ncommand = "docs"\nstartup_timeout_sec = 9\n\n[mcp_servers.web]\ncommand = "web"\n');
  await applySkills(box.context, box.tools, [{ key: 'pager', managed: true, off: [] }]);
  await applyServers(box.context, box.tools, ['docs', 'web'].map(key => ({ key, managed: true, off: [] })));
  await writeToClaude(box.context, box.tools, ['docs', 'web']);
  const serverOff = async (tool: Three, name: string) => writeFile(mcpSwitchPath(box.context, tool), withMcpSwitch(tool, await readFile(mcpSwitchPath(box.context, tool), 'utf8').catch(() => ''), name, true));
  await serverOff('claude-cli', 'docs'); await serverOff('codex-cli', 'docs'); await serverOff('codex-cli', 'web');
  await setDisabled(box.context, 'codex-cli', { folder: 'pager', name: 'pager', skillFile: join(folderOf(box, 'codex-cli', 'pager'), 'SKILL.md') }, true);
  await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify({ formatVersion: 1, profiles: [{ id: 'all', name: 'All', items: ['mcp:docs', 'mcp:web', 'skill:pager'] }],
    offByProfile: { 'mcp:docs': ['claude-cli', 'codex-cli'], 'mcp:web': ['codex-cli'], 'skill:pager': ['codex-cli'] } }, null, 2)}\n`);
  // Then, in the earlier build: docs and pager Off (and docs written out of Claude Code), web kept out of Codex.
  await applyServers(box.context, box.tools, [{ key: 'docs', managed: false, off: [], seenManaged: true }, { key: 'web', managed: true, off: ['codex-cli'], seenManaged: true }]);
  await writeToClaude(box.context, box.tools, ['docs']);
  await applySkills(box.context, box.tools, [{ key: 'pager', managed: false, off: [], seenManaged: true }]);
  return box;
}

test('Migration releases a profile’s switch on a copy that is not there now: in a server’s kept own part, in Claude Code’s and Codex’s settings; turned On again, nothing is left switched off', async () => {
  const box = await goneHome();
  try {
    assert.deepEqual([(await entries(box, 'docs'))['codex-cli'].entry, (await entries(box, 'web'))['codex-cli'].entry, await bytes(folderOf(box, 'codex-cli', 'pager'))], [undefined, undefined, undefined]);
    await migrateProfiles(box.context, box.tools);
    // Claude Code no longer has docs's entry, so nothing can start there: its deny goes at once, and nothing is kept for later.
    assert.deepEqual([JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers, await text(box, '.central-knot/claude-denies.json')], [undefined, undefined]);
    await switchProfile(box.context, box.tools, 'all');
    await applyServers(box.context, box.tools, [{ key: 'web', managed: true, off: [], seenManaged: true }]);
    await writeToClaude(box.context, box.tools, ['docs']);
    const servers = await serversView(box.context, box.tools), skills = await skillsView(box.context, box.tools);
    assert.deepEqual(['docs', 'web'].map(key => servers.items.find(row => row.key === key)?.switchedOff ?? []), [[], []]);
    assert.deepEqual(Object.values(skills.items.find(row => row.key === 'pager')?.loads ?? {}).map(at => at?.off), [false, false, false]);
    assert.match((await text(box, MCP['codex-cli']))!, /\[mcp_servers\.docs\]\ncommand = "docs"\nstartup_timeout_sec = 9\n/, 'Codex’s other own field stays');
  } finally { await box.cleanup(); }
});

test('Migration with Automatic sync off leaves an item that stays On to the ordinary sync rule: a waiting hand edit is not copied', async () => {
  const box = await sandbox(['claude-cli', 'codex-cli']);
  try {
    await put(box, 'claude-cli');
    await applySkills(box.context, box.tools, [{ key: 'notes', managed: true, off: [] }]);
    await setDisabled(box.context, 'claude-cli', { folder: 'notes', name: 'notes', skillFile: join(folderOf(box, 'claude-cli'), 'SKILL.md') }, true);
    await writeFile(join(box.home, '.central-knot/profiles.json'), JSON.stringify({ formatVersion: 1, profiles: [{ id: 'dev', name: 'Dev', items: [] }], offByProfile: { 'skill:notes': ['claude-cli'] } }));
    const claudeCopy = await bytes(folderOf(box, 'claude-cli'));
    await writeFile(join(folderOf(box, 'codex-cli'), 'SKILL.md'), skillText('A hand edit, waiting while Automatic sync is off.'));
    await migrateProfiles(box.context, box.tools);
    assert.deepEqual([await bytes(folderOf(box, 'claude-cli')), (await skillsView(box.context, box.tools)).items[0]?.loads?.['claude-cli']?.off], [claudeCopy, false]);
  } finally { await box.cleanup(); }
});

test('Migration keeps no Claude Code deny for a listed switch a person had turned back on: a deny set by hand later stays', async () => {
  const { box } = await oldHome('dev');
  try {
    const settings = mcpSwitchPath(box.context, 'claude-cli');
    const deny = async (off: boolean) => writeFile(settings, withMcpSwitch('claude-cli', await readFile(settings, 'utf8'), 'sentry', off));
    // sentry is turned Off (its Claude Code entry waits for Write) and its switch in Claude Code is turned back on by hand, before the upgrade.
    await applyServers(box.context, box.tools, [{ key: 'sentry', managed: false, off: [] }]);
    await deny(false);
    await migrateProfiles(box.context, box.tools);
    assert.doesNotMatch((await text(box, '.central-knot/claude-denies.json')) ?? '', /sentry/);
    // A deny the person sets later is theirs: turning sentry On leaves it.
    await deny(true);
    await applyServers(box.context, box.tools, [{ key: 'sentry', managed: true, off: [], seenManaged: false }]);
    assert.deepEqual(JSON.parse((await text(box, SETTINGS['claude-cli']))!).deniedMcpServers, [{ serverName: 'sentry' }]);
  } finally { await box.cleanup(); }
});

test('A migration stopped part-way is finished by the next pass, with one History entry', async () => {
  const box = await goneHome();
  try {
    // pager is On again before the upgrade and held off in every tool: the migration turns it Off, with its one entry; docs stays Off.
    await applySkills(box.context, box.tools, [{ key: 'pager', managed: true, off: [], seenManaged: false }]);
    await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify({ formatVersion: 1, profiles: [], offByProfile: { 'mcp:sentry': tools, 'skill:pager': tools } }, null, 2)}\n`);
    for (const tool of tools) await setDisabled(box.context, tool, { folder: 'pager', name: 'pager', skillFile: join(folderOf(box, tool, 'pager'), 'SKILL.md') }, true);
    const crash = { ...box.context, fault: (at: string) => { if (at === 'before-remove') throw new Error('crash'); } };
    await assert.rejects(migrateProfiles(crash, box.tools), /crash/);
    assert.equal(JSON.parse((await text(box, '.central-knot/profiles.json'))!).formatVersion, 1);
    await migrateProfiles(box.context, box.tools);
    assert.equal(JSON.parse((await text(box, '.central-knot/profiles.json'))!).formatVersion, 2);
    assert.deepEqual([(await live(box)).find(item => item.key === 'pager')?.on, await bytes(folderOf(box, 'codex-cli', 'pager'))], [false, undefined]);
    assert.equal((await history(box)).filter(entry => entry.profile?.migrated).length, 1);
  } finally { await box.cleanup(); }
});
